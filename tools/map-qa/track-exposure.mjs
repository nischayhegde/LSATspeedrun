/*
 * Why does one district's tram hit people when another's, with more pavement in
 * its path, does not?
 *
 * A contact needs two things to coincide: somebody standing in the swept path,
 * and the vehicle arriving while they are there. `rail-overlap.mjs` measured
 * whether the pavement is in the path, which is neither of those — it is only
 * whether the coincidence is *possible* — and it came out higher on the Old
 * Quarter, which scores zero. So the answer is in the two rates, and this
 * measures both separately:
 *
 *   occupancy — walker-frames spent inside a transport's swept path, whatever
 *               the transport is doing. "How much time do people spend standing
 *               on the tracks."
 *   service   — how far each transport travels, in whole traversals of its own
 *               line. "How often does anything come."
 *
 * Their product is the exposure. Reported apart as well as together, because a
 * fix for a busy line is not a fix for a populated pavement and the two want
 * opposite work.
 *
 * Occupancy is answered against a cell mask of the swept path rather than by
 * walking the polyline per walker per frame, which is the difference between a
 * probe that runs in twenty seconds and one that runs in ten minutes.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'exposure'
const only = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const keys = only.length ? only : ['city', 'nation', 'continent']
const FRAMES = Number(process.env.MAPS_FRAMES ?? 3600)

async function measure(frames) {
  const scene = window.__mapScene
  const THREE = window.__mapThree
  const crowd = scene.crowd
  const transports = scene.transports ?? []
  const sims = scene.trafficSims ?? []
  const originalRender = scene.renderer.render.bind(scene.renderer)
  scene.renderer.render = () => {}

  // Same body the collision harness uses, read off a live rig.
  let walkerRadius = .12
  {
    const radii = []
    for (const walker of crowd?.walkers ?? []) {
      if (!walker.active) continue
      const root = walker.rig?.root ?? walker.root
      if (!root || !root.visible) continue
      const box = new THREE.Box3().setFromObject(root)
      if (box.isEmpty() || box.max.y - box.min.y < .5) continue
      radii.push(Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2)
    }
    if (radii.length) {
      radii.sort((a, b) => a - b)
      walkerRadius = Math.max(.06, radii[radii.length >> 1])
    }
  }

  const CELL = .25
  const paths = transports.map((path, index) => {
    const object = path.object
    object.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(object)
    const halfBeam = Number.isFinite(box.min.x)
      ? Math.max(.3, Math.min((box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2))
      : .5
    /*
     * The hull the contact test actually uses, in the carriage's own frame.
     *
     * `collide.mjs` and `crossing-attrib.mjs` both take the local extent of the
     * whole transport object and treat it as one oriented rectangle. If that
     * object carries anything besides the carriage — a rake of coaches, a
     * canopy, a wire — the rectangle is the union, and a "body inside a
     * vehicle" can be a body inside empty air between two parts of it. Recorded
     * here so the two probes can be checked against each other rather than
     * believed.
     */
    const local = new THREE.Box3()
    const point = new THREE.Vector3()
    const inverse = new THREE.Matrix4()
    object.updateWorldMatrix(true, true)
    inverse.copy(object.matrixWorld).invert()
    object.traverse((child) => {
      if (!child.isMesh || !child.geometry) return
      if (child.material?.transparent && child.material?.depthWrite === false) return
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
      const bounds = child.geometry.boundingBox
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld)
      for (let corner = 0; corner < 8; corner += 1) {
        point.set(
          corner & 1 ? bounds.max.x : bounds.min.x,
          corner & 2 ? bounds.max.y : bounds.min.y,
          corner & 4 ? bounds.max.z : bounds.min.z,
        ).applyMatrix4(matrix)
        local.expandByPoint(point)
      }
    })
    const hull = Number.isFinite(local.min.x)
      ? {
        hx: +((local.max.x - local.min.x) / 2).toFixed(3),
        hz: +((local.max.z - local.min.z) / 2).toFixed(3),
        cx: +((local.max.x + local.min.x) / 2).toFixed(3),
        cz: +((local.max.z + local.min.z) / 2).toFixed(3),
      }
      : null
    const samples = 600
    const points = []
    let length = 0
    let previous = null
    for (let i = 0; i <= samples; i += 1) {
      const point = path.curve.getPointAt(i / samples)
      points.push(point.x, point.z)
      if (previous) length += Math.hypot(point.x - previous.x, point.z - previous.z)
      previous = point
    }
    // Cells whose centre is within the swept half-beam plus a body, so a hit on
    // the mask means the walker's disc overlaps the path.
    const mask = new Set()
    const reach = halfBeam + walkerRadius
    const span = Math.ceil(reach / CELL)
    for (let i = 0; i < points.length; i += 2) {
      const cx = Math.round(points[i] / CELL)
      const cz = Math.round(points[i + 1] / CELL)
      for (let dz = -span; dz <= span; dz += 1) {
        for (let dx = -span; dx <= span; dx += 1) {
          if (Math.hypot(dx, dz) * CELL > reach) continue
          mask.add(`${cx + dx},${cz + dz}`)
        }
      }
    }
    return { index, halfBeam: +halfBeam.toFixed(3), lineLength: +length.toFixed(2), mask, points, hull, object, mode: path.mode, speed: path.speed }
  })

  const inAnyPath = (x, z) => {
    const key = `${Math.round(x / CELL)},${Math.round(z / CELL)}`
    for (const path of paths) if (path.mask.has(key)) return path.index
    return -1
  }

  // Road traffic, for the same two rates against the carriageways, so the tram
  // answer can be read beside a control that is not a tram.
  let roadDistance = 0
  const roadPrevious = new Map()

  const transportDistance = paths.map(() => 0)
  const transportPrevious = paths.map(() => null)
  /*
   * Does the vehicle actually run on the line the mask was built from?
   *
   * The mask is the curve the scene hands the transport, and everything below
   * assumes the carriage is on it. If it is not — a lateral offset for a second
   * track, a carriage hung off an anchor — then a zero from the mask means the
   * probe is looking in the wrong place, which is indistinguishable from a
   * district where nobody stands on the tracks.
   */
  const offCurve = paths.map(() => 0)
  const curveGap = (path, x, z) => {
    let best = Infinity
    for (let i = 2; i < path.points.length; i += 2) {
      const ax = path.points[i - 2]
      const az = path.points[i - 1]
      const dx = path.points[i] - ax
      const dz = path.points[i + 1] - az
      const span = dx * dx + dz * dz
      if (span < 1e-9) continue
      let t = ((x - ax) * dx + (z - az) * dz) / span
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const gap = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
      if (gap < best) best = gap
    }
    return best
  }

  let walkerFrames = 0
  let onTrackFrames = 0
  let nearestWalkerToCurve = Infinity
  const onTrackByWay = {}
  const onTrackByState = {}
  const onTrackSites = {}
  let crossingFrames = 0

  for (let frame = 0; frame < frames; frame += 1) {
    window.__clock.tick(1)
    paths.forEach((path, index) => {
      const position = path.object.position
      const previous = transportPrevious[index]
      if (previous) transportDistance[index] += Math.hypot(position.x - previous.x, position.z - previous.z)
      transportPrevious[index] = { x: position.x, z: position.z }
      if (frame % 20 === 0) {
        const gap = curveGap(path, position.x, position.z)
        if (gap > offCurve[index]) offCurve[index] = gap
      }
    })
    for (const sim of sims) {
      for (const agent of sim.agents) {
        if (!agent.active) continue
        const position = agent.object.position
        const previous = roadPrevious.get(agent)
        if (previous) roadDistance += Math.hypot(position.x - previous.x, position.z - previous.z)
        roadPrevious.set(agent, { x: position.x, z: position.z })
      }
    }
    for (const walker of crowd?.walkers ?? []) {
      if (!walker.active) continue
      walkerFrames += 1
      if (walker.crossing >= 0) crossingFrames += 1
      const root = walker.rig?.root ?? walker.root
      if (!root) continue
      if (frame % 40 === 0) {
        for (const path of paths) {
          const gap = curveGap(path, root.position.x, root.position.z)
          if (gap < nearestWalkerToCurve) nearestWalkerToCurve = gap
        }
      }
      const path = inAnyPath(root.position.x, root.position.z)
      if (path < 0) continue
      onTrackFrames += 1
      const state = walker.crossing >= 0 ? `crossing-${walker.crossPhase}` : 'pavement'
      onTrackByState[state] = (onTrackByState[state] ?? 0) + 1
      if (walker.crossing < 0) {
        onTrackByWay[walker.way] = (onTrackByWay[walker.way] ?? 0) + 1
      }
      const site = `${Math.round(root.position.x)},${Math.round(root.position.z)}`
      onTrackSites[site] = (onTrackSites[site] ?? 0) + 1
    }
  }

  scene.renderer.render = originalRender
  const ways = crowd?.ways ?? []
  return {
    region: scene.region,
    frames,
    walkerRadius: +walkerRadius.toFixed(4),
    walkerFrames,
    crossingFrames,
    transports: paths.map((path, index) => ({
      index,
      mode: path.mode,
      halfBeam: path.halfBeam,
      lineLength: path.lineLength,
      travelled: +transportDistance[index].toFixed(1),
      // Whole traversals of its own line in this run: the service frequency,
      // in the only unit that compares a long line with a short one.
      traversals: +(transportDistance[index] / Math.max(1e-3, path.lineLength)).toFixed(2),
      worstOffCurve: +offCurve[index].toFixed(3),
      hull: path.hull,
    })),
    nearestWalkerToCurve: Number.isFinite(nearestWalkerToCurve) ? +nearestWalkerToCurve.toFixed(3) : -1,
    roadDistanceTravelled: +roadDistance.toFixed(1),
    // The two factors, and the product.
    onTrackFrames,
    onTrackShare: +(onTrackFrames / Math.max(1, walkerFrames)).toFixed(4),
    onTrackByState,
    topOnTrackWays: Object.entries(onTrackByWay)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([way, count]) => ({
        way: Number(way),
        frames: count,
        halfWidth: +(ways[Number(way)]?.halfWidth ?? 0).toFixed(3),
        street: ways[Number(way)]?.street ?? -1,
        obstructed: Boolean(ways[Number(way)]?.obstructed),
      })),
    topOnTrackSites: Object.entries(onTrackSites).sort((a, b) => b[1] - a[1]).slice(0, 6),
  }
}

const report = {}
const { browser, page, errors } = await open()
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(measure, FRAMES)
    const value = report[key]
    console.log(key, JSON.stringify({
      walkerFrames: value.walkerFrames,
      onTrackFrames: value.onTrackFrames,
      onTrackShare: value.onTrackShare,
      transports: value.transports.map((t) => ({ traversals: t.traversals, len: t.lineLength, beam: t.halfBeam, offCurve: t.worstOffCurve })),
      roadDistance: value.roadDistanceTravelled,
      nearestWalkerToCurve: value.nearestWalkerToCurve,
    }))
    console.log('   hulls', JSON.stringify(value.transports.map((t) => t.hull)))
    console.log('   byState', JSON.stringify(value.onTrackByState))
    console.log('   ways', JSON.stringify(value.topOnTrackWays))
    console.log('   sites', JSON.stringify(value.topOnTrackSites))
    save(`${OUT}/exposure-${tag}/${key}.json`, value)
  }
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 3))
  await browser.close().catch(() => {})
}
