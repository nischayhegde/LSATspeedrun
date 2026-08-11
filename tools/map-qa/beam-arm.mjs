/**
 * The walker beam, arm and control in one server lifetime.
 *
 * `WALKER_HALF_BEAM` decides how much ground every setback in every plan
 * reserves for a person, so it cannot be A/B'd by editing the file: the two
 * arms would land in two server lifetimes, and the whole reason this map's
 * numbers were untrustworthy for a week is that two lifetimes are two different
 * worlds. The scene reads the figure through `walkerHalfBeam()`, which in
 * development prefers `window.__mapWalkerBeam`, and `region()` rebuilds a
 * district on demand — so both arms are built from the same code, in the same
 * page, against the same crowd, minutes apart.
 *
 * The metric is `inside.mjs`'s: the share of walker-frames in which a walker's
 * body overlaps solid geometry, with the body taken as the median over every
 * walker in the district rather than off whichever one happened to be standing
 * with its legs together.
 *
 * Alongside it, and reported for every arm because taking ground away is
 * exactly what disconnects a network: how many walkers cannot move, and how
 * much walkable width the plan has left.
 *
 * Usage: node tools/map-qa/beam-arm.mjs <tag> <beam,beam,…> [region…]
 *   e.g. node tools/map-qa/beam-arm.mjs beam .16,.25 city nation continent
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'beam'
const beams = (process.argv[3] ?? '.16,.25').split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)
const keys = process.argv.slice(4).filter((argument) => TABS[argument])
const REGIONS = keys.length ? keys : ['city', 'nation', 'continent']
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)

/**
 * One district, ticked, with every walker-frame tested against every solid.
 *
 * Lifted from `inside.mjs` rather than imported because that file is a script
 * with its own argument handling. The containment test, the body derivation and
 * the exclusions are the same, deliberately, so a number here is comparable
 * with one from there.
 */
async function measure(settings) {
  const { frames } = settings
  const scene = window.__mapScene
  const THREE = window.__mapThree
  const world = scene.world
  const crowd = scene.crowd
  scene.renderer.render = () => {}

  const excluded = new Set()
  const markExcluded = (root) => root.traverse((child) => excluded.add(child))
  ;(scene.trafficSims ?? []).forEach((sim) => sim.agents.forEach((agent) => markExcluded(agent.object)))
  ;(scene.transports ?? []).forEach((path) => markExcluded(path.object))
  if (scene.lawyer) markExcluded(scene.lawyer)
  if (scene.crowdRenderer?.group) markExcluded(scene.crowdRenderer.group)

  const decoration = (object) => {
    for (let node = object; node; node = node.parent) {
      const data = node.userData ?? {}
      if (data.horizonRing || data.navIgnore || data.decoration) return true
    }
    return false
  }

  /** Every solid, as an oriented box or a triangle soup, exactly as inside.mjs. */
  const boxes = []
  const soups = []
  world.updateWorldMatrix(true, true)
  world.traverse((child) => {
    if (!child.isMesh || excluded.has(child) || decoration(child) || !child.visible) return
    const geometry = child.geometry
    if (!geometry) return
    if (child.isInstancedMesh) {
      const matrix = new THREE.Matrix4()
      geometry.computeBoundingBox()
      const local = geometry.boundingBox
      for (let index = 0; index < child.count; index += 1) {
        child.getMatrixAt(index, matrix)
        const world4 = new THREE.Matrix4().multiplyMatrices(child.matrixWorld, matrix)
        const box = local.clone().applyMatrix4(world4)
        boxes.push(box)
      }
      return
    }
    if (geometry.type === 'BoxGeometry') {
      geometry.computeBoundingBox()
      boxes.push(geometry.boundingBox.clone().applyMatrix4(child.matrixWorld))
      return
    }
    const position = geometry.getAttribute('position')
    if (!position) return
    const box = new THREE.Box3().setFromBufferAttribute(position).applyMatrix4(child.matrixWorld)
    soups.push(box)
  })
  const solids = boxes.concat(soups)

  // The body: the median over every active walker, which repeats to the digit.
  const radii = []
  for (const walker of crowd?.walkers ?? []) {
    if (!walker.active) continue
    const root = walker.rig?.root ?? walker.root
    if (!root || !root.visible) continue
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty() || box.max.y - box.min.y < .5) continue
    radii.push(Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2)
  }
  radii.sort((a, b) => a - b)
  const radius = radii.length ? radii[radii.length >> 1] : .16

  const entry = {
    unpinnedBuilds: window.__unpinnedBuilds ?? 0,
    elapsed: crowd?.elapsed ?? null,
    spawnCursor: crowd?.spawnCursor ?? null,
    walkers: crowd?.walkers?.length ?? 0,
    active: (crowd?.walkers ?? []).filter((walker) => walker.active).length,
  }

  let samples = 0
  let hits = 0
  const sites = new Map()
  const point = new THREE.Vector3()
  for (let frame = 0; frame < frames; frame += 1) {
    window.__clock.tick(1)
    for (const walker of crowd?.walkers ?? []) {
      if (!walker.active) continue
      const root = walker.rig?.root ?? walker.root
      if (!root) continue
      root.getWorldPosition(point)
      samples += 1
      for (const box of solids) {
        if (point.y + 1.2 < box.min.y || point.y > box.max.y) continue
        const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x)
        const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z)
        if (dx * dx + dz * dz >= radius * radius) continue
        hits += 1
        const key = `${Math.round(point.x)},${Math.round(point.z)}`
        sites.set(key, (sites.get(key) ?? 0) + 1)
        break
      }
    }
  }

  // Walkable width the plan left, and who cannot move. `stranded.mjs`'s own
  // two questions, taken here so every arm carries them.
  const ways = crowd?.ways ?? []
  const network = {
    ways: ways.length,
    length: Number(ways.reduce((total, way) => {
      let run = 0
      for (let index = 1; index < (way.points?.length ?? 0); index += 1) {
        run += Math.hypot(way.points[index].x - way.points[index - 1].x, way.points[index].z - way.points[index - 1].z)
      }
      return total + run
    }, 0).toFixed(1)),
    zeroWidth: ways.filter((way) => (way.half ?? 0) <= 1e-6).length,
  }

  return {
    share: Number((hits / Math.max(1, samples)).toFixed(4)),
    hits, samples,
    solids: solids.length,
    radius: Number(radius.toFixed(4)),
    entry,
    network,
    worst: [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
  }
}

/** Who is parked: a walker whose position has not moved over the window. */
async function stranded(settings) {
  const scene = window.__mapScene
  const crowd = scene.crowd
  const start = new Map()
  for (const walker of crowd?.walkers ?? []) {
    const root = walker.rig?.root ?? walker.root
    if (root) start.set(walker, { x: root.position.x, z: root.position.z, travelled: 0, last: { x: root.position.x, z: root.position.z } })
  }
  for (let frame = 0; frame < settings.frames; frame += 1) {
    window.__clock.tick(1)
    for (const [walker, record] of start) {
      const root = walker.rig?.root ?? walker.root
      if (!root) continue
      record.travelled += Math.hypot(root.position.x - record.last.x, root.position.z - record.last.z)
      record.last = { x: root.position.x, z: root.position.z }
    }
  }
  let parked = 0
  let active = 0
  const distances = []
  for (const [walker, record] of start) {
    if (!walker.active) continue
    active += 1
    distances.push(Number(record.travelled.toFixed(2)))
    if (record.travelled < .25) parked += 1
  }
  distances.sort((a, b) => a - b)
  return { active, parked, medianTravel: distances.length ? distances[distances.length >> 1] : null }
}

const report = { tag, beams, frames: FRAMES, at: new Date().toISOString(), arms: {} }
const { browser, page, errors } = await open()
try {
  for (const beam of beams) {
    report.arms[beam] = {}
    for (const key of REGIONS) {
      // Set before the rebuild, because the plan is built from it.
      await page.evaluate((value) => { window.__mapWalkerBeam = value }, beam)
      await region(page, TABS[key], { key })
      const applied = await page.evaluate(() => window.__mapWalkerBeam)
      const inside = await page.evaluate(measure, { frames: FRAMES })
      const park = await page.evaluate(stranded, { frames: 600 })
      report.arms[beam][key] = { applied, ...inside, stranded: park }
      console.log(
        `=== ${key} beam ${beam} === share ${inside.share} hits ${inside.hits}/${inside.samples}`,
        `radius ${inside.radius} solids ${inside.solids}`,
      )
      console.log(`    entry ${JSON.stringify(inside.entry)}`)
      console.log(`    network ${JSON.stringify(inside.network)} stranded ${JSON.stringify(park)}`)
      for (const [site, count] of inside.worst) console.log(`    ${String(count).padStart(5)}  ${site}`)
    }
  }
} finally {
  report.errors = errors.slice(0, 10)
  save(`${OUT}/beam-${tag}.json`, report)
  await browser.close()
}
console.log(`\nwrote ${OUT}/beam-${tag}.json`)
