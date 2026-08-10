// Objective collision count for the map scenes.
//
// Two measurements, both deterministic:
//
//   static  — every frame, every mover's oriented box is tested against a grid
//             built from the triangles of the static district. Nothing in the
//             count depends on wall-clock timing.
//   mover   — the same boxes tested against each other, and against the crowd.
//
// Determinism comes from `lib.mjs`'s synthetic frame clock: the scene's only
// nondeterminism is the rAF timestamp it derives its delta from, so pinning
// that makes the whole simulation a pure function of the code. Verified by
// running the same arm twice and comparing the JSON byte for byte (see
// `--repeat`).
import { open, region, save, TABS } from './lib.mjs'
import { mkdirSync } from 'node:fs'

const tag = process.argv[2] ?? 'before'
const only = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const keys = only.length ? only : ['city', 'nation', 'continent', 'ocean']
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)

const dir = `/Users/alan/LSATspeedrun/.maps/collide-${tag}`
mkdirSync(dir, { recursive: true })

/**
 * Runs entirely inside the page. Kept as one function so Playwright can
 * serialise it; everything it needs comes in through `settings`.
 */
async function measure(settings) {
  const { frames, cell, floorY, skin, shrink, rideOver } = settings
  const scene = window.__mapScene
  // Under SwiftShader a frame is almost entirely rasterisation, and the
  // collision count never reads a pixel. Stubbing the draw makes a frame nearly
  // free without touching the simulation: nothing in `TrafficSim`, `Crowd` or
  // the transport update reads the renderer, and the camera — which the spawn
  // logic's visibility test does depend on — is driven by the animate loop
  // either way. So this is the same simulation, just not drawn.
  const originalRender = scene.renderer.render.bind(scene.renderer)
  if (shrink) scene.renderer.render = () => {}
  const THREE = window.__mapThree
  const world = scene.world
  const sims = scene.trafficSims ?? []
  const transports = scene.transports ?? []
  const crowd = scene.crowd ?? null
  const graph = scene.roadGraph ?? null

  // ---------------------------------------------------------------- movers
  // Everything the simulations drive, with its own local half-extents so a
  // rotated body is tested as an oriented box rather than as the inflated
  // axis-aligned one `Box3.setFromObject` would give.
  const movers = []
  const localExtent = (root) => {
    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    const inverse = new THREE.Matrix4()
    root.updateWorldMatrix(true, true)
    inverse.copy(root.matrixWorld).invert()
    root.traverse((child) => {
      if (!child.isMesh || !child.geometry) return
      // Wakes and contact shadows are decals, not hull.
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
  const registerMover = (object, label, kind, extra) => {
    const box = localExtent(object)
    if (!Number.isFinite(box.min.x)) return null
    const entry = {
      object,
      label,
      kind,
      // Centre offset in local space: hulls are not always centred on origin.
      cx: (box.min.x + box.max.x) / 2,
      cy: (box.min.y + box.max.y) / 2,
      cz: (box.min.z + box.max.z) / 2,
      hx: (box.max.x - box.min.x) / 2,
      hy: (box.max.y - box.min.y) / 2,
      hz: (box.max.z - box.min.z) / 2,
      ...extra,
    }
    movers.push(entry)
    return entry
  }
  sims.forEach((sim, simIndex) => {
    sim.agents.forEach((agent, agentIndex) => {
      registerMover(agent.object, `${sim.kind}-${simIndex}-${agentIndex}`, sim.kind, { agent, sim })
    })
  })
  transports.forEach((path, index) => {
    registerMover(path.object, `transport-${index}`, 'transport', { transport: path })
  })

  const moverObjects = new Set(movers.map((m) => m.object))
  const moverRoots = movers.map((m) => m.object)

  // ------------------------------------------------------------ static grid
  // Triangles of the district, bucketed into an XZ grid with the vertical span
  // of whatever landed in each cell. Anything lying entirely below `floorY` is
  // skipped, which is what removes the ground plane, the carriageways, the
  // pavements and the water surfaces without needing to name them.
  const excluded = new Set()
  const markExcluded = (root) => root.traverse((child) => excluded.add(child))
  moverRoots.forEach(markExcluded)
  if (scene.lawyer) markExcluded(scene.lawyer)
  if (scene.crowdRenderer?.group) markExcluded(scene.crowdRenderer.group)

  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  const triangles = []
  const vertex = new THREE.Vector3()
  world.updateMatrixWorld(true)
  world.traverse((child) => {
    if (excluded.has(child)) return
    if (!child.isMesh || !child.geometry) return
    if (child.isInstancedMesh || child.isSkinnedMesh) return
    const data = child.userData ?? {}
    // Decoration that nothing can drive into: sky, clouds, labels, rings,
    // beams, birds, and the animated water surfaces themselves.
    if (
      data.cloud || data.skyUniforms || data.auroraUniforms || data.waterUniforms || data.atmosphere
      || data.mapLabelKind || data.mapLabelAlways || data.mapEmphasisKind || data.destinationMarker
      || data.lawyerBeacon || data.playerMarker || data.lighthouseBeam || data.heldLandmarkAccent
      || data.ambientActor || data.ambientWing || data.planet || data.orbitalRing || data.flagUniforms
    ) return
    if (child.material?.depthWrite === false) return
    const geometry = child.geometry
    const position = geometry.attributes?.position
    if (!position) return
    const index = geometry.index
    const count = index ? index.count : position.count
    const matrix = child.matrixWorld
    for (let i = 0; i + 2 < count; i += 3) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = index ? index.getX(i + corner) : i + corner
        vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix)
        if (vertex.x < minX) minX = vertex.x
        if (vertex.x > maxX) maxX = vertex.x
        if (vertex.y < minY) minY = vertex.y
        if (vertex.y > maxY) maxY = vertex.y
        if (vertex.z < minZ) minZ = vertex.z
        if (vertex.z > maxZ) maxZ = vertex.z
      }
      if (maxY <= floorY) continue
      // Terrain beyond the district: mountains and the horizon ring stand well
      // outside anything with a lane on it and would otherwise dominate the
      // grid's memory.
      if (minX < -70 || maxX > 70 || minZ < -70 || maxZ > 70) continue
      triangles.push(minX, maxX, minY, maxY, minZ, maxZ)
      if (minX < bounds.minX) bounds.minX = minX
      if (maxX > bounds.maxX) bounds.maxX = maxX
      if (minZ < bounds.minZ) bounds.minZ = minZ
      if (maxZ > bounds.maxZ) bounds.maxZ = maxZ
    }
  })

  const originX = Math.floor(bounds.minX) - 1
  const originZ = Math.floor(bounds.minZ) - 1
  const columns = Math.ceil((bounds.maxX - originX) / cell) + 2
  const rows = Math.ceil((bounds.maxZ - originZ) / cell) + 2
  const cellLow = new Float32Array(columns * rows).fill(Infinity)
  const cellHigh = new Float32Array(columns * rows).fill(-Infinity)
  for (let t = 0; t < triangles.length; t += 6) {
    const c0 = Math.max(0, Math.floor((triangles[t] - originX) / cell))
    const c1 = Math.min(columns - 1, Math.floor((triangles[t + 1] - originX) / cell))
    const r0 = Math.max(0, Math.floor((triangles[t + 4] - originZ) / cell))
    const r1 = Math.min(rows - 1, Math.floor((triangles[t + 5] - originZ) / cell))
    const low = triangles[t + 2]
    const high = triangles[t + 3]
    for (let r = r0; r <= r1; r += 1) {
      const base = r * columns
      for (let c = c0; c <= c1; c += 1) {
        const slot = base + c
        if (low < cellLow[slot]) cellLow[slot] = low
        if (high > cellHigh[slot]) cellHigh[slot] = high
      }
    }
  }
  let occupiedCells = 0
  for (let slot = 0; slot < cellHigh.length; slot += 1) if (cellHigh[slot] > -Infinity) occupiedCells += 1

  // ------------------------------------------------------- instanced facades
  /*
   * The blind spot that let "walkers are inside buildings" survive three
   * reports and two measured fix attempts.
   *
   * The static grid above skips `isInstancedMesh` — and `renderPlannedBuildings`
   * puts every planned building in the district through `buildFacadeGroup`,
   * which returns a group of `InstancedMesh`. So the planned buildings, which
   * are the overwhelming majority of the solid volume in every region, have
   * never been in the measurement at all. That is why the building-clearance
   * arm "agreed to the last digit" with its control: the only thing it moves is
   * invisible to the only test that would have shown it working.
   *
   * These are collected as oriented boxes rather than rasterised into the grid,
   * for two reasons: a building carries an arbitrary `rotationY`, so an
   * axis-aligned cell fill would over-report a rotated block by its corners;
   * and at a few hundred boxes against eighteen walkers the exact test is
   * cheaper than the grid fill would be.
   *
   * The facade box is the wall volume specifically. Roof and ridge batches are
   * deliberately excluded — they sit above head height and a walker under an
   * eave is not a walker in a building.
   */
  const facadeBoxes = []
  {
    const matrix = new THREE.Matrix4()
    const translation = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const euler = new THREE.Euler()
    world.traverse((child) => {
      if (!child.isInstancedMesh || excluded.has(child)) return
      // The per-instance facade attributes are only ever set by
      // `buildFacadeGroup`, so this identifies wall batches exactly, without
      // the harness having to know a material or a colour.
      if (!child.geometry?.attributes?.aFacadeTile) return
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
      const local = child.geometry.boundingBox
      const localHalfX = (local.max.x - local.min.x) / 2
      const localHalfY = (local.max.y - local.min.y) / 2
      const localHalfZ = (local.max.z - local.min.z) / 2
      for (let index = 0; index < child.count; index += 1) {
        child.getMatrixAt(index, matrix)
        matrix.premultiply(child.matrixWorld)
        matrix.decompose(translation, rotation, scale)
        euler.setFromQuaternion(rotation, 'YXZ')
        const halfY = localHalfY * Math.abs(scale.y)
        const centreY = translation.y
        const high = centreY + halfY
        if (high <= floorY) continue
        if (translation.x < -70 || translation.x > 70 || translation.z < -70 || translation.z > 70) continue
        facadeBoxes.push({
          x: translation.x,
          z: translation.z,
          hx: localHalfX * Math.abs(scale.x),
          hz: localHalfZ * Math.abs(scale.z),
          low: centreY - halfY,
          high,
          cos: Math.cos(euler.y),
          sin: Math.sin(euler.y),
        })
      }
    })
  }

  /** A walker's disc against one oriented wall footprint. */
  const facadeHit = (x, z, radius, low, high) => {
    let worst = 0
    let atX = 0
    let atZ = 0
    let atHigh = 0
    for (let index = 0; index < facadeBoxes.length; index += 1) {
      const box = facadeBoxes[index]
      if (box.high <= low || box.low >= high) continue
      // Same ride-over rule the grid test uses: a doorstep is stepped onto.
      if (box.high - low < rideOver) continue
      const dx = x - box.x
      const dz = z - box.z
      // Into the building's own frame, then nearest point on the rectangle.
      const localX = dx * box.cos - dz * box.sin
      const localZ = dx * box.sin + dz * box.cos
      const clampedX = Math.min(Math.max(localX, -box.hx), box.hx)
      const clampedZ = Math.min(Math.max(localZ, -box.hz), box.hz)
      const distance = Math.hypot(localX - clampedX, localZ - clampedZ)
      const depth = radius - distance
      if (depth > worst) { worst = depth; atX = box.x; atZ = box.z; atHigh = box.high }
    }
    return worst > 0 ? { depth: worst, x: atX, z: atZ, high: atHigh } : null
  }

  // ------------------------------------------------------------------- tests
  /** Does an oriented XZ box, at a vertical span, meet solid static geometry? */
  const staticHit = (mover) => {
    const object = mover.object
    const scale = object.scale.x
    const angle = object.rotation.y
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // Local centre offset rotated into world space (y rotation only).
    const ox = mover.cx * scale
    const oz = mover.cz * scale
    const centreX = object.position.x + ox * cos + oz * sin
    const centreZ = object.position.z - ox * sin + oz * cos
    const centreY = object.position.y + mover.cy * scale
    const halfX = Math.max(0, mover.hx * scale - skin)
    const halfZ = Math.max(0, mover.hz * scale - skin)
    const halfY = Math.max(0, mover.hy * scale - skin)
    const low = centreY - halfY
    const high = centreY + halfY
    // Axis-aligned sweep of the oriented box, then an exact per-cell test.
    const reach = Math.abs(cos) * halfX + Math.abs(sin) * halfZ
    const reachZ = Math.abs(sin) * halfX + Math.abs(cos) * halfZ
    const c0 = Math.max(0, Math.floor((centreX - reach - originX) / cell))
    const c1 = Math.min(columns - 1, Math.floor((centreX + reach - originX) / cell))
    const r0 = Math.max(0, Math.floor((centreZ - reachZ - originZ) / cell))
    const r1 = Math.min(rows - 1, Math.floor((centreZ + reachZ - originZ) / cell))
    // Solid and straddled hits are tracked apart, because a bridge deck under a
    // whole car has a bigger horizontal overlap than the corner of the building
    // it is also clipping, and taking the single worst cell would report the
    // deck and hide the building.
    let worst = 0
    let atX = 0
    let atZ = 0
    let atLow = 0
    let atHigh = 0
    let flatWorst = 0
    let flatX = 0
    let flatZ = 0
    let flatLow = 0
    let flatHigh = 0
    for (let r = r0; r <= r1; r += 1) {
      const base = r * columns
      const cellZ0 = originZ + r * cell
      for (let c = c0; c <= c1; c += 1) {
        const slot = base + c
        const high2 = cellHigh[slot]
        if (high2 === -Infinity) continue
        if (high2 <= low || cellLow[slot] >= high) continue
        // Exact 2D test of the cell square against the oriented box: project
        // the cell's centre into the box's frame and allow for its own extent.
        const cellX0 = originX + c * cell
        const dx = cellX0 + cell / 2 - centreX
        const dz = cellZ0 + cell / 2 - centreZ
        const localX = Math.abs(dx * cos - dz * sin)
        const localZ = Math.abs(dx * sin + dz * cos)
        const pad = cell / 2 * (Math.abs(cos) + Math.abs(sin))
        const overlapX = halfX + pad - localX
        const overlapZ = halfZ + pad - localZ
        if (overlapX <= 0 || overlapZ <= 0) continue
        const depth = Math.min(overlapX, overlapZ)
        if (high2 - low < rideOver) {
          if (depth > flatWorst) { flatWorst = depth; flatX = cellX0; flatZ = cellZ0; flatLow = cellLow[slot]; flatHigh = high2 }
        } else if (depth > worst) {
          worst = depth; atX = cellX0; atZ = cellZ0; atLow = cellLow[slot]; atHigh = high2
        }
      }
    }
    return {
      solid: worst > 0 ? { depth: worst, x: atX, z: atZ, hitLow: atLow, hitHigh: atHigh, bodyLow: low, bodyHigh: high } : null,
      straddle: flatWorst > 0 ? { depth: flatWorst, x: flatX, z: flatZ, hitLow: flatLow, hitHigh: flatHigh, bodyLow: low, bodyHigh: high } : null,
    }
  }

  /** Oriented-box overlap between two movers, in XZ with a vertical gate. */
  const moverPair = (a, b) => {
    const boxOf = (mover) => {
      const object = mover.object
      const scale = object.scale.x
      const angle = object.rotation.y
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const ox = mover.cx * scale
      const oz = mover.cz * scale
      return {
        x: object.position.x + ox * cos + oz * sin,
        z: object.position.z - ox * sin + oz * cos,
        y: object.position.y + mover.cy * scale,
        hx: Math.max(0, mover.hx * scale - skin),
        hz: Math.max(0, mover.hz * scale - skin),
        hy: Math.max(0, mover.hy * scale - skin),
        cos, sin,
      }
    }
    const one = boxOf(a)
    const two = boxOf(b)
    if (Math.abs(one.y - two.y) > one.hy + two.hy) return null
    const dx = two.x - one.x
    const dz = two.z - one.z
    // Separating-axis test on the four box axes.
    let least = Infinity
    for (const box of [one, two]) {
      const axes = [[box.cos, -box.sin], [box.sin, box.cos]]
      for (const [ax, az] of axes) {
        const centre = Math.abs(dx * ax + dz * az)
        const spanOne = Math.abs((one.cos * ax - one.sin * az)) * one.hx + Math.abs((one.sin * ax + one.cos * az)) * one.hz
        const spanTwo = Math.abs((two.cos * ax - two.sin * az)) * two.hx + Math.abs((two.sin * ax + two.cos * az)) * two.hz
        const overlap = spanOne + spanTwo - centre
        if (overlap <= 0) return null
        if (overlap < least) least = overlap
      }
    }
    return { depth: least, x: (one.x + two.x) / 2, z: (one.z + two.z) / 2 }
  }

  const isLive = (mover) => {
    if (mover.agent) return mover.agent.active && mover.object.visible && mover.object.scale.x > mover.agent.baseScale * .8
    return mover.object.visible
  }

  // ------------------------------------------------------------------- lanes
  /** How far outside its own carriageway an agent's body is sitting. */
  const laneExcursion = (mover) => {
    const agent = mover.agent
    if (!agent || agent.edge < 0 || !graph) return 0
    const edge = graph.edges[agent.edge]
    if (!edge) return 0
    const from = graph.nodes[edge.from]
    const dx = mover.object.position.x - from.x
    const dz = mover.object.position.z - from.z
    // Signed lateral offset from the centreline; right of travel is (-dz, dx).
    const lateral = dx * -edge.dz + dz * edge.dx
    const half = (edge.width ?? (edge.kind === 'water' ? 2.8 : 1.5)) / 2
    const scale = mover.object.scale.x
    const bodyHalf = Math.min(mover.hx, mover.hz) * scale
    return Math.max(0, Math.abs(lateral) + bodyHalf - half)
  }

  // ------------------------------------------------------------------ sample
  const state = {
    frames: 0,
    staticFrames: 0,
    staticHits: 0,
    staticDepthMax: 0,
    rideOverHits: 0,
    rideOverFrames: 0,
    moverFrames: 0,
    moverHits: 0,
    moverDepthMax: 0,
    pedestrianHits: 0,
    pedestrianDepthMax: 0,
    bodyInVehicleHits: 0,
    bodyInVehicleFrames: 0,
    bodyInVehicleDepthMax: 0,
    walkerStaticHits: 0,
    walkerStaticFrames: 0,
    walkerStaticDepthMax: 0,
    walkerSamples: 0,
    // Planned buildings, counted separately so every previously recorded
    // `walkerStatic*` figure stays directly comparable with its baseline.
    walkerFacadeHits: 0,
    walkerFacadeFrames: 0,
    walkerFacadeDepthMax: 0,
    walkerAnyHits: 0,
    wrongSideHits: 0,
    wrongSideFrames: 0,
    wrongSideMax: 0,
    excursionFrames: 0,
    excursionMax: 0,
    spawnInView: 0,
    sites: {},
    straddles: {},
    pairs: {},
    walkers: {},
    facades: {},
    offside: {},
    inVehicle: {},
  }
  const note = (bucket, label, depth, x, z, span) => {
    const key = `${label}@${Math.round(x)},${Math.round(z)}`
    const found = state[bucket][key]
    if (found) {
      found.n += 1
      if (depth > found.depth) { found.depth = +depth.toFixed(3); if (span) found.span = span }
    } else {
      state[bucket][key] = { n: 1, depth: +depth.toFixed(3), span }
    }
  }

  // Named props, so a site can be attributed rather than just located. Only
  // available on a dev build, where `conformAndAuditProps` runs its audit.
  const placements = scene.world.userData.propAudit?.placements ?? []
  const nearestProp = (x, z) => {
    let best = null
    let bestDistance = Infinity
    for (const prop of placements) {
      const dx = Math.max(0, Math.abs(prop.x - x) - prop.width / 2)
      const dz = Math.max(0, Math.abs(prop.z - z) - prop.depth / 2)
      const distance = Math.hypot(dx, dz)
      if (distance < bestDistance) { bestDistance = distance; best = prop.name }
    }
    return bestDistance < .8 ? { prop: best, away: +bestDistance.toFixed(2) } : null
  }

  const walkerPoints = []
  const collectWalkers = () => {
    walkerPoints.length = 0
    if (!crowd?.walkers) return
    for (const walker of crowd.walkers) {
      if (!walker.active) continue
      const root = walker.rig?.root ?? walker.root
      if (!root) continue
      walkerPoints.push(root.position.x, root.position.z)
    }
  }

  /*
   * A person against the district's solid geometry.
   *
   * This test did not exist until the user reported walkers inside buildings, and
   * its absence is the whole reason they got to report it: the harness tested
   * every *vehicle* against the static grid and tested people only as things
   * vehicles might hit. A walker could stand in a wall for the entire run and
   * every number here would have read clean. It is the same grid and the same
   * cells as `staticHit`; only the body differs, being a disc at shoulder radius
   * rather than an oriented box.
   *
   * `WALKER_HALF_HEIGHT` and the shoulder radius are read off the rig's own
   * scale, so a change to walker size cannot silently decouple the two.
   */
  const walkerHit = (x, z, radius, low, high) => {
    const c0 = Math.max(0, Math.floor((x - radius - originX) / cell))
    const c1 = Math.min(columns - 1, Math.floor((x + radius - originX) / cell))
    const r0 = Math.max(0, Math.floor((z - radius - originZ) / cell))
    const r1 = Math.min(rows - 1, Math.floor((z + radius - originZ) / cell))
    let worst = 0
    let atX = 0
    let atZ = 0
    let atHigh = 0
    for (let r = r0; r <= r1; r += 1) {
      const base = r * columns
      const cellZ0 = originZ + r * cell
      for (let c = c0; c <= c1; c += 1) {
        const slot = base + c
        const cellTop = cellHigh[slot]
        if (cellTop === -Infinity) continue
        if (cellTop <= low || cellLow[slot] >= high) continue
        // A kerb or a doorstep is something a person steps onto, not something
        // they are inside, so the same ride-over rule the vehicles use applies.
        if (cellTop - low < rideOver) continue
        const cellX0 = originX + c * cell
        // Disc against the cell square: nearest point on the square to the
        // centre, then compare with the radius.
        const nearestX = Math.min(Math.max(x, cellX0), cellX0 + cell)
        const nearestZ = Math.min(Math.max(z, cellZ0), cellZ0 + cell)
        const distance = Math.hypot(x - nearestX, z - nearestZ)
        const depth = radius - distance
        if (depth > worst) { worst = depth; atX = cellX0; atZ = cellZ0; atHigh = cellTop }
      }
    }
    return worst > 0 ? { depth: worst, x: atX, z: atZ, high: atHigh } : null
  }

  /*
   * Is a vehicle on the correct side of its carriageway?
   *
   * "Cars don't follow traffic rules" needs a number, and this is the most basic
   * one: on a two-way street, traffic keeps right of the centreline. An agent's
   * edge is directed, so right of travel is (-dz, dx) and a lawful vehicle has a
   * positive lateral offset. A negative one is a car on the wrong side of the
   * road, which is both a rule broken and the direct cause of head-on contact
   * with anything coming the other way.
   *
   * Only two-way edges are counted. Where `twin` is -1 the street is one-way, the
   * whole carriageway is legitimately available, and there is no wrong side.
   */
  const wrongSide = (mover) => {
    const agent = mover.agent
    if (!agent || agent.edge < 0 || !graph) return 0
    const edge = graph.edges[agent.edge]
    if (!edge || edge.twin < 0) return 0
    if (edge.kind !== 'road') return 0
    const from = graph.nodes[edge.from]
    const dx = mover.object.position.x - from.x
    const dz = mover.object.position.z - from.z
    const lateral = dx * -edge.dz + dz * edge.dx
    // A body straddling the centreline is over it by however much of its beam
    // is on the wrong side; dead-centre counts as no offence, since on a lane
    // too narrow to offset into that is the only lawful place to be.
    const beam = Math.min(mover.hx, mover.hz) * mover.object.scale.x
    return Math.max(0, -(lateral - beam))
  }

  // A person's body, measured off an actual rig rather than assumed, so this
  // cannot drift if walker scale changes.
  let walkerRadius = .12
  let walkerLow = .1
  let walkerHigh = .5
  if (crowd?.walkers?.length) {
    const sample = crowd.walkers[0]
    const root = sample.rig?.root ?? sample.root
    if (root) {
      const box = new THREE.Box3().setFromObject(root)
      if (!box.isEmpty()) {
        walkerRadius = Math.max(.06, Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2)
        const height = Math.max(.1, box.max.y - box.min.y)
        // From knee to shoulder. Starting at the feet would make every kerb and
        // doorstep a hit; stopping short of the crown ignores a hat brushing an
        // eave, which is not what anyone means by walking through a building.
        walkerLow = box.min.y + height * .3
        walkerHigh = box.min.y + height * .92
      }
    }
  }

  const step = () => {
    state.frames += 1
    collectWalkers()
    let staticThisFrame = 0
    let rideOverThisFrame = 0
    let moverThisFrame = 0
    // People against the buildings. The walker's own scale sets the body: these
    // rigs stand about .58 tall at map scale with roughly a .12 shoulder radius,
    // and the span starts a little above the pavement so a kerb is not a hit.
    let walkerThisFrame = 0
    let facadeThisFrame = 0
    let wrongSideThisFrame = 0
    let bodyInVehicleThisFrame = 0
    for (let w = 0; w < walkerPoints.length; w += 2) {
      state.walkerSamples += 1
      const x = walkerPoints[w]
      const z = walkerPoints[w + 1]
      const hit = walkerHit(x, z, walkerRadius, walkerLow, walkerHigh)
      if (hit) {
        walkerThisFrame += 1
        state.walkerStaticHits += 1
        if (hit.depth > state.walkerStaticDepthMax) state.walkerStaticDepthMax = hit.depth
        note('walkers', 'walker', hit.depth, hit.x, hit.z, { top: +hit.high.toFixed(2) })
      }
      const inFacade = facadeHit(x, z, walkerRadius, walkerLow, walkerHigh)
      if (inFacade) {
        facadeThisFrame += 1
        state.walkerFacadeHits += 1
        if (inFacade.depth > state.walkerFacadeDepthMax) state.walkerFacadeDepthMax = inFacade.depth
        note('facades', 'facade', inFacade.depth, inFacade.x, inFacade.z, { top: +inFacade.high.toFixed(2) })
      }
      if (hit || inFacade) state.walkerAnyHits += 1
    }
    if (walkerThisFrame) state.walkerStaticFrames += 1
    if (facadeThisFrame) state.walkerFacadeFrames += 1
    for (let i = 0; i < movers.length; i += 1) {
      const mover = movers[i]
      if (!isLive(mover)) continue
      const { solid, straddle } = staticHit(mover)
      const span = (hit) => ({
        hit: [+hit.hitLow.toFixed(2), +hit.hitHigh.toFixed(2)],
        body: [+hit.bodyLow.toFixed(2), +hit.bodyHigh.toFixed(2)],
      })
      if (solid) {
        staticThisFrame += 1
        state.staticHits += 1
        if (solid.depth > state.staticDepthMax) state.staticDepthMax = solid.depth
        note('sites', mover.kind, solid.depth, solid.x, solid.z, span(solid))
      }
      if (straddle) {
        rideOverThisFrame += 1
        state.rideOverHits += 1
        note('straddles', mover.kind, straddle.depth, straddle.x, straddle.z, span(straddle))
      }
      const excursion = laneExcursion(mover)
      if (excursion > .02) {
        state.excursionFrames += 1
        if (excursion > state.excursionMax) state.excursionMax = excursion
      }
      const offside = wrongSide(mover)
      if (offside > .02) {
        state.wrongSideHits += 1
        wrongSideThisFrame += 1
        if (offside > state.wrongSideMax) state.wrongSideMax = offside
        note('offside', 'offside', offside, mover.object.position.x, mover.object.position.z)
      }
      // Bodies on foot. A pedestrian is a point with a shoulder radius rather
      // than a box; the vehicle box is grown by that radius instead.
      const object = mover.object
      const scale = object.scale.x
      const radius = Math.max(mover.hx, mover.hz) * scale
      /*
       * Two different questions, and only the second one is a safety gate.
       *
       * `pedestrianHits` is a *contact*: a circumscribed radius plus a
       * shoulder, so a walker passing close along the flank of a stationary
       * tram counts. It is useful for attribution and useless as a gate,
       * because it moves whenever the crowd's density does.
       *
       * `bodyInVehicle` is containment: the walker's shoulder disc against the
       * hull's own oriented rectangle, no margin. That is the metric the
       * untimed-crossing fix drove to zero everywhere, and the one this session
       * must not regress. It is a strict subset of the contact count, so the
       * two can be read side by side.
       */
      const angle = object.rotation.y
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const ox = mover.cx * scale
      const oz = mover.cz * scale
      const hullX = object.position.x + ox * cos + oz * sin
      const hullZ = object.position.z - ox * sin + oz * cos
      const hullHalfX = Math.max(0, mover.hx * scale - skin)
      const hullHalfZ = Math.max(0, mover.hz * scale - skin)
      for (let w = 0; w < walkerPoints.length; w += 2) {
        const dx = walkerPoints[w] - object.position.x
        const dz = walkerPoints[w + 1] - object.position.z
        const distance = Math.hypot(dx, dz)
        const overlap = radius + .16 - distance
        if (overlap > 0) {
          state.pedestrianHits += 1
          if (overlap > state.pedestrianDepthMax) state.pedestrianDepthMax = overlap
          note('sites', 'pedestrian', overlap, object.position.x, object.position.z)
        }
        const hullDx = walkerPoints[w] - hullX
        const hullDz = walkerPoints[w + 1] - hullZ
        const localX = hullDx * cos - hullDz * sin
        const localZ = hullDx * sin + hullDz * cos
        const clampedX = Math.min(Math.max(localX, -hullHalfX), hullHalfX)
        const clampedZ = Math.min(Math.max(localZ, -hullHalfZ), hullHalfZ)
        const inside = walkerRadius - Math.hypot(localX - clampedX, localZ - clampedZ)
        if (inside > 0) {
          state.bodyInVehicleHits += 1
          bodyInVehicleThisFrame += 1
          if (inside > state.bodyInVehicleDepthMax) state.bodyInVehicleDepthMax = inside
          note('inVehicle', mover.kind, inside, object.position.x, object.position.z)
        }
      }
      for (let j = i + 1; j < movers.length; j += 1) {
        const other = movers[j]
        if (!isLive(other)) continue
        const pair = moverPair(mover, other)
        if (!pair) continue
        moverThisFrame += 1
        state.moverHits += 1
        if (pair.depth > state.moverDepthMax) state.moverDepthMax = pair.depth
        note('pairs', `${mover.kind}|${other.kind}`, pair.depth, pair.x, pair.z)
      }
    }
    if (staticThisFrame) state.staticFrames += 1
    if (rideOverThisFrame) state.rideOverFrames += 1
    if (moverThisFrame) state.moverFrames += 1
    if (wrongSideThisFrame) state.wrongSideFrames += 1
    if (bodyInVehicleThisFrame) state.bodyInVehicleFrames += 1
  }

  // Watch for a body that materialises inside the view: the brief's other
  // requirement is that entries and exits read plausibly.
  const frustum = new THREE.Frustum()
  const projection = new THREE.Matrix4()
  const wasVisible = new Map()
  const checkEntries = () => {
    scene.camera.updateMatrixWorld()
    projection.multiplyMatrices(scene.camera.projectionMatrix, scene.camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projection)
    for (const mover of movers) {
      if (!mover.agent) continue
      const live = mover.agent.active
      const before = wasVisible.get(mover.label) ?? false
      if (live && !before) {
        const inView = frustum.containsPoint(mover.object.position)
        if (inView) state.spawnInView += 1
      }
      wasVisible.set(mover.label, live)
    }
  }

  for (let frame = 0; frame < frames; frame += 1) {
    window.__clock.tick(1)
    step()
    checkEntries()
  }

  const top = (bucket, limit) => Object.entries(bucket)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([where, value]) => {
      const [, coords] = where.split('@')
      const [x, z] = coords.split(',').map(Number)
      return { where, frames: value.n, depth: value.depth, span: value.span, ...(nearestProp(x, z) ?? {}) }
    })

  scene.renderer.render = originalRender

  return {
    region: scene.region,
    frames: state.frames,
    movers: movers.length,
    staticTriangles: triangles.length / 6,
    occupiedCells,
    grid: { cell, columns, rows, originX: +originX.toFixed(2), originZ: +originZ.toFixed(2) },
    // Headline number: bodies intersecting solid static geometry.
    staticHitFrames: state.staticFrames,
    staticHitsPerFrame: +(state.staticHits / state.frames).toFixed(3),
    staticWorstDepth: +state.staticDepthMax.toFixed(3),
    // Bodies straddling a raised flat surface — a datum fault, counted apart.
    straddleFrames: state.rideOverFrames,
    straddlesPerFrame: +(state.rideOverHits / state.frames).toFixed(3),
    moverHitFrames: state.moverFrames,
    moverHitsPerFrame: +(state.moverHits / state.frames).toFixed(3),
    moverWorstDepth: +state.moverDepthMax.toFixed(3),
    pedestrianHits: state.pedestrianHits,
    pedestrianWorstDepth: +state.pedestrianDepthMax.toFixed(3),
    // Containment rather than contact: the safety gate. Zero everywhere is the
    // state the untimed-crossing fix reached and the state to hold.
    bodyInVehicleFrames: state.bodyInVehicleFrames,
    bodyInVehicleHits: state.bodyInVehicleHits,
    bodyInVehicleWorstDepth: +state.bodyInVehicleDepthMax.toFixed(3),
    worstInVehicle: top(state.inVehicle, 8),
    // People inside buildings. `walkerSamples` is the denominator: without it a
    // count of zero cannot be told apart from a district with nobody in it.
    walkerSamples: state.walkerSamples,
    // The body the two walker tests use, reported rather than assumed: it is
    // read off a live rig, and a rig that has not finished loading gives a
    // different one, which would silently rescale every share below.
    walkerBody: { radius: +walkerRadius.toFixed(4), low: +walkerLow.toFixed(4), high: +walkerHigh.toFixed(4) },
    walkerStaticFrames: state.walkerStaticFrames,
    walkerStaticPerFrame: +(state.walkerStaticHits / state.frames).toFixed(3),
    walkerStaticShare: +(state.walkerStaticHits / Math.max(1, state.walkerSamples)).toFixed(4),
    walkerStaticWorstDepth: +state.walkerStaticDepthMax.toFixed(3),
    // People inside *planned* buildings, which the line above cannot see. This
    // is the number the user has actually been looking at on screen.
    facadeBoxes: facadeBoxes.length,
    walkerFacadeFrames: state.walkerFacadeFrames,
    walkerFacadePerFrame: +(state.walkerFacadeHits / state.frames).toFixed(3),
    walkerFacadeShare: +(state.walkerFacadeHits / Math.max(1, state.walkerSamples)).toFixed(4),
    walkerFacadeWorstDepth: +state.walkerFacadeDepthMax.toFixed(3),
    // Either kind of solid. The honest headline.
    walkerAnyShare: +(state.walkerAnyHits / Math.max(1, state.walkerSamples)).toFixed(4),
    worstFacadeSites: top(state.facades, 18),
    // Vehicles on the wrong side of a two-way carriageway.
    wrongSideFrames: state.wrongSideFrames,
    wrongSidePerFrame: +(state.wrongSideHits / state.frames).toFixed(3),
    wrongSideWorst: +state.wrongSideMax.toFixed(3),
    laneExcursionFrames: state.excursionFrames,
    laneExcursionMax: +state.excursionMax.toFixed(3),
    spawnsInView: state.spawnInView,
    worstStaticSites: top(state.sites, 24),
    worstWalkerSites: top(state.walkers, 18),
    worstOffside: top(state.offside, 10),
    worstStraddles: top(state.straddles, 14),
    worstMoverPairs: top(state.pairs, 14),
  }
}

const { browser, page, errors } = await open()
const report = {}
// Written after every region rather than once at the end: on a loaded machine a
// later region can fail to build at all, and a run that measured the Old
// Quarter for ten minutes should not throw that away because The Circuit timed
// out behind it.
const flush = () => {
  report._errors = errors.slice(0, 10)
  report._frames = FRAMES
  save(`${dir}/report.json`, report)
}
for (const key of keys) {
  try {
    await region(page, TABS[key], { key })
  } catch (error) {
    report[key] = { failed: String(error).split('\n')[0] }
    console.log(key, 'FAILED', String(error).split('\n')[0])
    flush()
    continue
  }
  report[key] = await page.evaluate(measure, {
    frames: FRAMES,
    cell: .14,
    floorY: .16,
    skin: .02,
    // How far up into a body an obstruction must reach to count as solid.
    // Below it, the body is straddling a raised surface — a bridge deck or a
    // plaza kerb a few centimetres above the flat lane height — which is a
    // vertical-datum fault rather than something driven into, and would
    // otherwise swamp the number that matters.
    rideOver: .18,
    shrink: !process.env.MAPS_DRAW,
  })
  console.log(key, JSON.stringify({
    solidPerFrame: report[key].staticHitsPerFrame,
    solidFrames: report[key].staticHitFrames,
    straddlePerFrame: report[key].straddlesPerFrame,
    moverPerFrame: report[key].moverHitsPerFrame,
    ped: report[key].pedestrianHits,
    excursionFrames: report[key].laneExcursionFrames,
    spawnsInView: report[key].spawnsInView,
    movers: report[key].movers,
  }))
  // The two numbers this harness was blind to until people were reported inside
  // buildings, printed rather than left in the JSON: a fix for either is only
  // credible against a before figure someone actually read.
  console.log('   walkers:', JSON.stringify({
    samples: report[key].walkerSamples,
    inBuildingFrames: report[key].walkerStaticFrames,
    perFrame: report[key].walkerStaticPerFrame,
    share: report[key].walkerStaticShare,
    worstDepth: report[key].walkerStaticWorstDepth,
  }))
  console.log('   facades:', JSON.stringify({
    boxes: report[key].facadeBoxes,
    frames: report[key].walkerFacadeFrames,
    perFrame: report[key].walkerFacadePerFrame,
    share: report[key].walkerFacadeShare,
    worstDepth: report[key].walkerFacadeWorstDepth,
    anyShare: report[key].walkerAnyShare,
  }))
  console.log('   offside:', JSON.stringify({
    frames: report[key].wrongSideFrames,
    perFrame: report[key].wrongSidePerFrame,
    worst: report[key].wrongSideWorst,
  }))
  console.log('   inVehicle:', JSON.stringify({
    contacts: report[key].pedestrianHits,
    bodyInsideFrames: report[key].bodyInVehicleFrames,
    bodyInsideHits: report[key].bodyInVehicleHits,
    worstDepth: report[key].bodyInVehicleWorstDepth,
    where: report[key].worstInVehicle.slice(0, 4),
  }))
  console.log('   solid:', JSON.stringify(report[key].worstStaticSites.slice(0, 10)))
  console.log('   walkerSites:', JSON.stringify(report[key].worstWalkerSites.slice(0, 10)))
  console.log('   pairs:', JSON.stringify(report[key].worstMoverPairs.slice(0, 6)))
  flush()
}
flush()
await browser.close()
