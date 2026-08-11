/*
 * Who is inside the vehicle, and what were they doing at the time?
 *
 * `collide.mjs` counts `bodyInVehicleFrames` and names the site. It cannot say
 * whether the body it found was a walker halfway across a road — a crossing
 * timing fault, fixable in the crossing rules — or a walker on a pavement that
 * happens to lie inside a carriageway, which no amount of timing can fix
 * because the walker is not crossing anything.
 *
 * The Sovereign Arc's residue was attributed to "pavement at crossings" from
 * site coordinates alone, and a coordinate cannot tell those two apart. This
 * probe reads the walker's own state at the moment of contact instead.
 *
 * Containment is the same test `collide.mjs` uses: the walker's shoulder disc
 * against the hull's oriented rectangle, no margin, so the counts here are
 * comparable with `bodyInVehicleFrames` on the same frame budget.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'attrib'
const only = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const keys = only.length ? only : ['continent']
const FRAMES = Number(process.env.MAPS_FRAMES ?? 3600)

async function measure(frames) {
  const scene = window.__mapScene
  const THREE = window.__mapThree
  const sims = scene.trafficSims ?? []
  const crowd = scene.crowd ?? null
  const originalRender = scene.renderer.render.bind(scene.renderer)
  scene.renderer.render = () => {}

  const movers = []
  const localExtent = (root) => {
    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    const inverse = new THREE.Matrix4()
    root.updateWorldMatrix(true, true)
    inverse.copy(root.matrixWorld).invert()
    root.traverse((child) => {
      if (!child.isMesh || !child.geometry) return
      if (child.material?.transparent && child.material?.depthWrite === false) return
      const geometry = child.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      const local = geometry.boundingBox
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld)
      for (let corner = 0; corner < 8; corner += 1) {
        point.set(
          corner & 1 ? local.max.x : local.min.x,
          corner & 2 ? local.max.y : local.min.y,
          corner & 4 ? local.max.z : local.min.z,
        ).applyMatrix4(matrix)
        box.expandByPoint(point)
      }
    })
    return box
  }
  sims.forEach((sim, simIndex) => {
    sim.agents.forEach((agent, agentIndex) => {
      const box = localExtent(agent.object)
      if (!Number.isFinite(box.min.x)) return
      movers.push({
        object: agent.object,
        agent,
        kind: sim.kind,
        label: `${sim.kind}-${simIndex}-${agentIndex}`,
        cx: (box.min.x + box.max.x) / 2,
        cz: (box.min.z + box.max.z) / 2,
        hx: (box.max.x - box.min.x) / 2,
        hz: (box.max.z - box.min.z) / 2,
      })
    })
  })

  // Read off a live rig, as `collide.mjs` does, so the disc is the same body.
  let walkerRadius = .12
  if (crowd?.walkers?.length) {
    const radii = []
    for (const walker of crowd.walkers) {
      const scale = walker.root?.scale?.x
      if (scale > 0) radii.push(.12 * (scale / (walker.baseScale || scale)))
    }
    if (radii.length) walkerRadius = .12
  }

  const buckets = {}
  const bump = (key, depth, x, z, extra) => {
    const slot = buckets[key] ?? (buckets[key] = { frames: 0, depth: 0, where: {}, extra: {} })
    slot.frames += 1
    if (depth > slot.depth) slot.depth = +depth.toFixed(3)
    const at = `${Math.round(x)},${Math.round(z)}`
    slot.where[at] = (slot.where[at] ?? 0) + 1
    if (extra) for (const [name, value] of Object.entries(extra)) {
      slot.extra[name] = (slot.extra[name] ?? 0) + (value ? 1 : 0)
    }
  }

  let contactFrames = 0
  let hits = 0
  const events = []
  let liveVehicleFrames = 0
  let walkerFrames = 0
  const crossingLinks = crowd?.crossings ?? []
  const conflicts = crowd?.conflicts ?? []

  for (let frame = 0; frame < frames; frame += 1) {
    window.__clock.tick(1)
    let any = false
    for (const mover of movers) {
      const agent = mover.agent
      if (agent && agent.active === false) continue
      liveVehicleFrames += 1
      const object = mover.object
      const scale = object.scale?.x ?? 1
      const angle = object.rotation.y
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const ox = mover.cx * scale
      const oz = mover.cz * scale
      const hullX = object.position.x + ox * cos + oz * sin
      const hullZ = object.position.z - ox * sin + oz * cos
      const hullHalfX = Math.max(0, mover.hx * scale)
      const hullHalfZ = Math.max(0, mover.hz * scale)
      if (!crowd?.walkers) continue
      for (let index = 0; index < crowd.walkers.length; index += 1) {
        const walker = crowd.walkers[index]
        if (!walker.active) continue
        const root = walker.rig?.root ?? walker.root
        if (!root) continue
        const dx = root.position.x - hullX
        const dz = root.position.z - hullZ
        const localX = dx * cos - dz * sin
        const localZ = dx * sin + dz * cos
        const clampedX = Math.min(Math.max(localX, -hullHalfX), hullHalfX)
        const clampedZ = Math.min(Math.max(localZ, -hullHalfZ), hullHalfZ)
        const inside = walkerRadius - Math.hypot(localX - clampedX, localZ - clampedZ)
        if (inside <= 0) continue
        hits += 1
        any = true
        // A contact is a disagreement between two subsystems, so record both
        // sides of it: what the crossing believed about this road, and where
        // the vehicle actually was. Capped, because the interesting question is
        // the shape of the failure and thirty examples show it.
        if (walker.crossing >= 0 && events.length < 40) {
          const list = conflicts[walker.crossing] ?? []
          const sim = sims[0]
          const onConflictEdge = list.some((conflict) => conflict.edge === agent?.edge
            || sim?.graph?.edges?.[conflict.edge]?.twin === agent?.edge)
          const inApproaches = list.some((conflict) => conflict.approaches
            .some((approach) => approach.edge === agent?.edge))
          events.push({
            frame,
            at: [+root.position.x.toFixed(2), +root.position.z.toFixed(2)],
            progress: +walker.crossProgress.toFixed(3),
            phase: walker.crossPhase,
            depth: +inside.toFixed(3),
            link: { length: +(crossingLinks[walker.crossing]?.length ?? 0).toFixed(2) },
            conflicts: list.map((conflict) => ({
              edge: conflict.edge,
              at: +conflict.at.toFixed(2),
              approaches: conflict.approaches.length,
            })),
            vehicle: {
              kind: mover.kind,
              edge: agent?.edge ?? -1,
              nextEdge: agent?.nextEdge ?? -1,
              distance: +(agent?.distance ?? 0).toFixed(2),
              speed: +(agent?.speed ?? 0).toFixed(2),
              onConflictEdge,
              inApproaches,
            },
          })
        }
        // The whole point of the probe: the walker's own state, not its
        // coordinates.
        let key
        let extra = null
        if (walker.crossing >= 0) {
          const link = crossingLinks[walker.crossing]
          const list = conflicts[walker.crossing] ?? []
          key = `crossing-${walker.crossPhase}`
          extra = {
            kerbside: Boolean(link?.kerbside),
            noConflicts: list.length === 0,
            pastEnd: walker.crossProgress >= 1,
          }
        } else {
          key = 'pavement'
          extra = { obstructedWay: Boolean(crowd.ways?.[walker.way]?.obstructed) }
        }
        bump(key, inside, root.position.x, root.position.z, extra)
      }
    }
    if (crowd?.walkers) for (const walker of crowd.walkers) if (walker.active) walkerFrames += 1
    if (any) contactFrames += 1
  }

  scene.renderer.render = originalRender
  const summary = {}
  for (const [key, slot] of Object.entries(buckets)) {
    summary[key] = {
      hits: slot.frames,
      worstDepth: slot.depth,
      sites: Object.entries(slot.where).sort((a, b) => b[1] - a[1]).slice(0, 6),
      flags: slot.extra,
    }
  }
  return {
    region: scene.region,
    frames,
    vehicles: movers.length,
    // Non-zero is the evidence the probe is reading a live scene rather than
    // failing open: a run with no vehicle-frames and no walker-frames reports
    // zero contacts for the same reason a broken probe does.
    liveVehicleFrames,
    walkerFrames,
    contactFrames,
    hits,
    crossings: crossingLinks.length,
    byState: summary,
    events,
    network: crowd?.networkReport?.() ?? null,
  }
}

const report = {}
const { browser, page, errors } = await open()
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(measure, FRAMES)
    console.log(key, JSON.stringify({
      frames: report[key].frames,
      vehicles: report[key].vehicles,
      walkerFrames: report[key].walkerFrames,
      contactFrames: report[key].contactFrames,
      hits: report[key].hits,
    }))
    for (const [state, value] of Object.entries(report[key].byState)) {
      console.log(`   ${state}: hits ${value.hits} depth ${value.worstDepth} flags ${JSON.stringify(value.flags)}`)
      console.log(`      sites ${JSON.stringify(value.sites)}`)
    }
    for (const event of report[key].events.slice(0, 12)) console.log('   ev', JSON.stringify(event))
    save(`${OUT}/attrib-${tag}/${key}.json`, report[key])
  }
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 5))
  await browser.close().catch(() => {})
}
