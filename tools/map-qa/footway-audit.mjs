// How much of each district's pavement network is inside a building.
//
// The walkers-in-buildings complaint has survived two measured fix attempts.
// This asks the question those attempts never asked directly: not "how often is
// a walker in a wall", which depends on where the eighteen of them happen to
// be, but "how much of the pavement they are bound to is inside solid geometry
// in the first place". A walker is held to its footway polyline and may only
// shift within that footway's half-width, so any pavement inside a building is
// a place people *will* be seen inside a building, and no steering fixes it.
//
// Two obstacle populations are reported separately, because they have different
// owners and different fixes:
//
//   facade  — planned buildings, drawn as `InstancedMesh` by `buildFacadeGroup`.
//             `collide.mjs` skipped instanced meshes entirely until this
//             session, so these have never appeared in any measurement.
//   solid   — everything else with height: authored props, hero buildings,
//             the non-instanced articulated blocks near the region centre.
//
// No simulation frames: this is pure geometry, so it is quick even on a loaded
// machine and its numbers do not depend on the clock at all.
import { open, region, save, TABS } from './lib.mjs'
import { mkdirSync } from 'node:fs'

const tag = process.argv[2] ?? 'base'
const only = process.argv.slice(3)
const keys = only.length ? only : ['city', 'nation', 'continent']
const dir = `/Users/alan/LSATspeedrun/.maps/footway-${tag}`
mkdirSync(dir, { recursive: true })

function audit(settings) {
  const { floorY, headroom, stride } = settings
  const THREE = window.__mapThree
  const scene = window.__mapScene
  const world = scene.world
  const crowd = scene.crowd
  if (!crowd?.ways?.length) return { failed: 'no crowd ways' }
  world.updateMatrixWorld(true)

  // ---------------------------------------------------------------- obstacles
  const excluded = new Set()
  const mark = (root) => root?.traverse((child) => excluded.add(child))
  for (const sim of scene.trafficSims ?? []) for (const agent of sim.agents) mark(agent.object)
  for (const path of scene.transports ?? []) mark(path.object)
  mark(scene.lawyer)
  mark(scene.crowdRenderer?.group)
  mark(scene.rivalGuardRenderer?.group)

  /** Oriented footprints of the planned buildings. */
  const facades = []
  /** Axis-aligned footprints of everything else solid. */
  const solids = []

  const matrix = new THREE.Matrix4()
  const translation = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scaleVec = new THREE.Vector3()
  const euler = new THREE.Euler()
  const vertex = new THREE.Vector3()

  world.traverse((child) => {
    if (excluded.has(child)) return
    if (!child.isMesh || !child.geometry) return
    const data = child.userData ?? {}
    if (
      data.cloud || data.skyUniforms || data.auroraUniforms || data.waterUniforms || data.atmosphere
      || data.mapLabelKind || data.mapLabelAlways || data.mapEmphasisKind || data.destinationMarker
      || data.lawyerBeacon || data.playerMarker || data.lighthouseBeam || data.heldLandmarkAccent
      || data.ambientActor || data.ambientWing || data.planet || data.orbitalRing || data.flagUniforms
    ) return
    if (child.material?.depthWrite === false) return

    if (child.isInstancedMesh) {
      // Only the wall batches. Roofs and ridges sit above a walker's head.
      if (!child.geometry.attributes?.aFacadeTile) return
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
      const local = child.geometry.boundingBox
      const hx = (local.max.x - local.min.x) / 2
      const hy = (local.max.y - local.min.y) / 2
      const hz = (local.max.z - local.min.z) / 2
      for (let index = 0; index < child.count; index += 1) {
        child.getMatrixAt(index, matrix)
        matrix.premultiply(child.matrixWorld)
        matrix.decompose(translation, quaternion, scaleVec)
        euler.setFromQuaternion(quaternion, 'YXZ')
        const top = translation.y + hy * Math.abs(scaleVec.y)
        if (top < floorY + headroom) continue
        if (Math.abs(translation.x) > 70 || Math.abs(translation.z) > 70) continue
        facades.push({
          x: translation.x, z: translation.z,
          hx: hx * Math.abs(scaleVec.x), hz: hz * Math.abs(scaleVec.z),
          cos: Math.cos(euler.y), sin: Math.sin(euler.y), top,
        })
      }
      return
    }
    if (child.isSkinnedMesh) return

    /*
     * A static batch goes in a triangle at a time, an ordinary mesh whole.
     *
     * `batchStaticScenery` merges every prop sharing a material family into one
     * mesh, so a batch's bounding box is the union of props that may stand
     * thirty metres apart, and pavement inside that box need not be inside any
     * of them. Measured against the whole box, one batch on The Circuit claimed
     * 10.94 of 32.5 blocked metres on its own, which made the headline share an
     * upper bound rather than a number. `inside.mjs` has always done this the
     * honest way; this is that branch, ported, so the two probes can at least be
     * argued about on the same terms.
     */
    if (child.userData?.staticBatch) {
      const position = child.geometry.attributes?.position
      if (!position) return
      const indices = child.geometry.index
      const count = indices ? indices.count : position.count
      for (let triangle = 0; triangle + 2 < count; triangle += 3) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = -Infinity
        for (let corner = 0; corner < 3; corner += 1) {
          const at = indices ? indices.getX(triangle + corner) : triangle + corner
          vertex.fromBufferAttribute(position, at).applyMatrix4(child.matrixWorld)
          if (vertex.x < minX) minX = vertex.x
          if (vertex.x > maxX) maxX = vertex.x
          if (vertex.z < minZ) minZ = vertex.z
          if (vertex.z > maxZ) maxZ = vertex.z
          if (vertex.y > top) top = vertex.y
        }
        if (top < floorY + headroom) continue
        if (minX < -70 || maxX > 70 || minZ < -70 || maxZ > 70) continue
        solids.push({ minX, maxX, minZ, maxZ, top, name: 'static-batch' })
      }
      return
    }

    // A non-instanced mesh: use its world axis-aligned footprint, which is what
    // the collision harness's grid effectively does too.
    const geometry = child.geometry
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const local = geometry.boundingBox
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = -Infinity
    for (let corner = 0; corner < 8; corner += 1) {
      vertex.set(
        corner & 1 ? local.max.x : local.min.x,
        corner & 2 ? local.max.y : local.min.y,
        corner & 4 ? local.max.z : local.min.z,
      ).applyMatrix4(child.matrixWorld)
      if (vertex.x < minX) minX = vertex.x
      if (vertex.x > maxX) maxX = vertex.x
      if (vertex.z < minZ) minZ = vertex.z
      if (vertex.z > maxZ) maxZ = vertex.z
      if (vertex.y > top) top = vertex.y
    }
    if (top < floorY + headroom) return
    if (minX < -70 || maxX > 70 || minZ < -70 || maxZ > 70) return
    // Sprawling meshes are terrain or a batched scenery merge covering half the
    // district; their bounding box says nothing useful about where the solid
    // parts are, so counting them would drown the measurement in false hits.
    if (maxX - minX > 12 || maxZ - minZ > 12) return
    solids.push({ minX, maxX, minZ, maxZ, top, name: child.userData?.propAudit?.name ?? null })
  })

  const inFacade = (x, z) => {
    for (let index = 0; index < facades.length; index += 1) {
      const box = facades[index]
      const dx = x - box.x
      const dz = z - box.z
      if (Math.abs(dx) > box.hx + box.hz || Math.abs(dz) > box.hx + box.hz) continue
      const localX = dx * box.cos - dz * box.sin
      const localZ = dx * box.sin + dz * box.cos
      if (Math.abs(localX) <= box.hx && Math.abs(localZ) <= box.hz) return box
    }
    return null
  }
  /*
   * Splitting the batches turned a few hundred solid boxes into a few hundred
   * thousand, and a linear scan per sample is then hours rather than seconds.
   * A one-metre bucket grid over the same ±70 the collector already clips to
   * keeps the probe at the speed its "no frames, so it is quick" promise was
   * made at.
   */
  const CELL = 1
  const ORIGIN = -72
  const SPAN = 145
  const cellOf = (x, z) => (
    Math.min(SPAN - 1, Math.max(0, Math.floor((z - ORIGIN) / CELL))) * SPAN
    + Math.min(SPAN - 1, Math.max(0, Math.floor((x - ORIGIN) / CELL)))
  )
  const buckets = new Map()
  for (let index = 0; index < solids.length; index += 1) {
    const box = solids[index]
    const x0 = Math.min(SPAN - 1, Math.max(0, Math.floor((box.minX - ORIGIN) / CELL)))
    const x1 = Math.min(SPAN - 1, Math.max(0, Math.floor((box.maxX - ORIGIN) / CELL)))
    const z0 = Math.min(SPAN - 1, Math.max(0, Math.floor((box.minZ - ORIGIN) / CELL)))
    const z1 = Math.min(SPAN - 1, Math.max(0, Math.floor((box.maxZ - ORIGIN) / CELL)))
    for (let cz = z0; cz <= z1; cz += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const key = cz * SPAN + cx
        const found = buckets.get(key)
        if (found) found.push(box)
        else buckets.set(key, [box])
      }
    }
  }
  const inSolid = (x, z) => {
    const bucket = buckets.get(cellOf(x, z))
    if (!bucket) return null
    for (let index = 0; index < bucket.length; index += 1) {
      const box = bucket[index]
      if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) return box
    }
    return null
  }

  // ----------------------------------------------------------------- pavement
  let total = 0
  let samples = 0
  let facadeSamples = 0
  let solidSamples = 0
  let eitherSamples = 0
  // Blocked length is counted on the centreline only, so it is a length rather
  // than an area and can be compared with the network's own total.
  let blockedLength = 0
  const sites = {}
  const noteSite = (x, z, what, top) => {
    const key = `${Math.round(x)},${Math.round(z)}`
    const found = sites[key]
    if (found) { found.n += 1; return }
    sites[key] = { n: 1, at: [Math.round(x * 10) / 10, Math.round(z * 10) / 10], what, top: Math.round(top * 100) / 100 }
  }

  // Per-way, because "38% of the network" can be one systematic rule applied to
  // forty pavements or one pavement drawn through a cathedral, and those are
  // different jobs. A way is identified by its ends rather than by an index, so
  // the same pavement can be recognised across a change that renumbers them.
  const byWay = []

  for (let wayIndex = 0; wayIndex < crowd.ways.length; wayIndex += 1) {
    const way = crowd.ways[wayIndex]
    let wayBlocked = 0
    total += way.length
    const count = Math.max(2, Math.ceil(way.length / stride))
    const half = way.halfWidth
    for (let step = 0; step <= count; step += 1) {
      const distance = (step / count) * way.length
      // Walk the polyline to the point at this arc length.
      let index = 1
      while (index < way.cumulative.length - 1 && way.cumulative[index] < distance) index += 1
      const back = way.cumulative[index - 1]
      const span = Math.max(1e-6, way.cumulative[index] - back)
      const t = Math.min(1, Math.max(0, (distance - back) / span))
      const ax = way.points[(index - 1) * 2]
      const az = way.points[(index - 1) * 2 + 1]
      const bx = way.points[index * 2]
      const bz = way.points[index * 2 + 1]
      const px = ax + (bx - ax) * t
      const pz = az + (bz - az) * t
      const dx = bx - ax
      const dz = bz - az
      const magnitude = Math.hypot(dx, dz) || 1
      // Across the pavement, so a walker offset to the building side is tested
      // as well as one down the middle.
      const nx = -dz / magnitude
      const nz = dx / magnitude

      let anyFacade = null
      let anySolid = null
      for (const lateral of [-half * .8, 0, half * .8]) {
        const sx = px + nx * lateral
        const sz = pz + nz * lateral
        samples += 1
        const facade = inFacade(sx, sz)
        const solid = facade ? null : inSolid(sx, sz)
        if (facade) { facadeSamples += 1; anyFacade = facade }
        if (solid) { solidSamples += 1; anySolid = solid }
        if (facade || solid) eitherSamples += 1
      }
      if (anyFacade || anySolid) {
        blockedLength += way.length / count
        wayBlocked += way.length / count
        const hit = anyFacade ?? anySolid
        noteSite(px, pz, anyFacade ? 'facade' : (hit.name ?? 'solid'), hit.top)
      }
    }
    const points = way.points
    byWay.push({
      way: wayIndex,
      from: [Math.round(points[0] * 100) / 100, Math.round(points[1] * 100) / 100],
      to: [Math.round(points[points.length - 2] * 100) / 100, Math.round(points[points.length - 1] * 100) / 100],
      length: +way.length.toFixed(2),
      half: +way.halfWidth.toFixed(3),
      centre: +(way.centre ?? 0).toFixed(3),
      obstructed: Boolean(way.obstructed),
      blocked: +wayBlocked.toFixed(2),
      share: +(wayBlocked / Math.max(1e-6, way.length)).toFixed(3),
    })
  }

  const worst = Object.values(sites).sort((a, b) => b.n - a.n).slice(0, 20)
  return {
    region: scene.region,
    ways: crowd.ways.length,
    facadeBoxes: facades.length,
    solidBoxes: solids.length,
    totalFootwayLength: +total.toFixed(1),
    blockedLength: +blockedLength.toFixed(1),
    blockedLengthShare: +(blockedLength / Math.max(1e-6, total)).toFixed(4),
    bandSamples: samples,
    facadeShare: +(facadeSamples / Math.max(1, samples)).toFixed(4),
    solidShare: +(solidSamples / Math.max(1, samples)).toFixed(4),
    blockedBandShare: +(eitherSamples / Math.max(1, samples)).toFixed(4),
    byWay: byWay.sort((a, b) => b.blocked - a.blocked),
    worstSites: worst,
    pedestrianPlan: world.userData.pedestrianPlan ?? null,
  }
}

const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    try {
      await region(page, TABS[key], { key })
      report[key] = await page.evaluate(audit, { floorY: .16, headroom: .25, stride: .12 })
      const r = report[key]
      console.log(key, JSON.stringify({
        ways: r.ways, facadeBoxes: r.facadeBoxes, solidBoxes: r.solidBoxes,
        length: r.totalFootwayLength, blocked: r.blockedLength,
        blockedShare: r.blockedLengthShare, facadeShare: r.facadeShare, solidShare: r.solidShare,
      }))
      console.log('   worst:', JSON.stringify(r.worstSites?.slice(0, 8)))
    } catch (error) {
      report[key] = { failed: String(error).split('\n')[0] }
      console.log(key, 'FAILED', String(error).split('\n')[0])
    }
    report._errors = errors.slice(0, 10)
    save(`${dir}/report.json`, report)
  }
} finally {
  await browser.close().catch(() => {})
}
