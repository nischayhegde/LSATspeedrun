/**
 * The two pedestrian metrics, in one place, so an arm and a baseline are the
 * same measurement.
 *
 * Both of these were page functions inside `inside.mjs` and `stranded.mjs`.
 * They are here because `beam-arm.mjs` needs them too, and the first attempt at
 * that copied them — which is a mistake this file exists to make impossible.
 * The copy looked faithful and was not: it tested a walker's root position
 * against whole bounding boxes rather than against the per-triangle boxes a
 * static batch has to be broken into, and against the full height of a solid
 * rather than against the band of a body between its shins and its shoulders.
 * The Circuit came back at a share of 1.0 — every walker inside something on
 * every frame — and the Old Quarter at .3369 against a known 0.
 *
 * That failure is worth recording because it is the same class of error the
 * whole map audit was rebuilt to remove: a number that is precise, stable,
 * reproducible and measuring something other than what it is named after. A
 * second implementation of a metric is a second baseline, and this map has
 * already lost a week to comparing two of those.
 *
 * These are `page.evaluate` bodies: plain functions with no closure over module
 * scope, because Playwright ships their source to the browser and the browser
 * has none of this file.
 */

/**
 * The share of walker-frames in which a walker's body overlaps solid geometry,
 * with every hit attributed to a place.
 *
 * Settings: `{ frames, floorY, rideOver, radius, height, foot }`. `inside.mjs`
 * calls it with `floorY: .16` and `rideOver: .18`, which are the values every
 * recorded baseline was taken at, and with none of the last three, which
 * measures the body the arm actually draws. Supplying any of them pins that
 * dimension of the test body across arms; see the notes where they are read.
 */
export function insideMetric(settings) {
  const { frames, floorY, rideOver } = settings
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

  /*
   * A readable identity for a mesh.
   *
   * Most of this geometry is built rather than loaded, so `name` is usually
   * empty and the useful label is whichever ancestor was given one, plus any
   * `userData` key the scene tags its own structures with. Both are collected
   * and the nearest one wins, so a wall in an unnamed group under a named
   * landmark still reports the landmark.
   */
  const label = (object) => {
    const parts = []
    let node = object
    let depth = 0
    while (node && depth < 8) {
      if (node.name) parts.push(node.name)
      const data = node.userData ?? {}
      for (const key of Object.keys(data)) {
        if (key === 'propAudit' || key === 'placements') continue
        const value = data[key]
        if (value === true) parts.push(`@${key}`)
        else if (typeof value === 'string' && value.length < 40) parts.push(`@${key}=${value}`)
      }
      node = node.parent
      depth += 1
    }
    return parts.length ? parts.slice(0, 4).join('/') : '(unnamed)'
  }

  /*
   * Named props, at any distance.
   *
   * `collide.mjs` only attributes a site to a prop within .8 of it, which is
   * the right rule for "was it this bench" and the wrong one for "what is this
   * thing at all" — it answers `null` for every one of The Circuit's worst
   * sites. Here the nearest prop is always reported, with its distance, so a
   * far one can be recognised as far rather than as absent.
   */
  const placements = world.userData.propAudit?.placements ?? []
  const nearestProp = (x, z) => {
    let best = null
    let bestDistance = Infinity
    for (const prop of placements) {
      const dx = Math.max(0, Math.abs(prop.x - x) - prop.width / 2)
      const dz = Math.max(0, Math.abs(prop.z - z) - prop.depth / 2)
      const distance = Math.hypot(dx, dz)
      if (distance < bestDistance) { bestDistance = distance; best = prop.name }
    }
    return best ? `${best}~${bestDistance.toFixed(1)}` : 'no-props'
  }

  // Every solid as a box in its own frame, named.
  const solids = []
  world.updateMatrixWorld(true)
  // `horizonRing` is the painted backdrop past the last block. It is 58 units
  // out at its nearest and the crowd network stops at 29, so nothing in it is
  // reachable — but its hills are 25 m across and a box drawn round one covered
  // a corner of the district. See `createHorizonRing`.
  const decoration = (data) => data.cloud || data.skyUniforms || data.auroraUniforms || data.waterUniforms
    || data.horizonRing
    || data.atmosphere || data.mapLabelKind || data.mapLabelAlways || data.mapEmphasisKind || data.destinationMarker
    || data.lawyerBeacon || data.playerMarker || data.lighthouseBeam || data.heldLandmarkAccent
    || data.ambientActor || data.ambientWing || data.planet || data.orbitalRing || data.flagUniforms

  /** One box per triangle, in world space. See the two callers for why. */
  const triangles = (geometry, matrixWorld, kind, name) => {
    const position = geometry.attributes?.position
    if (!position) return
    const index = geometry.index
    const count = index ? index.count : position.count
    const vertex = new THREE.Vector3()
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let corner = 0; corner < 3; corner += 1) {
        const at = index ? index.getX(triangle + corner) : triangle + corner
        vertex.fromBufferAttribute(position, at).applyMatrix4(matrixWorld)
        if (vertex.x < minX) minX = vertex.x
        if (vertex.x > maxX) maxX = vertex.x
        if (vertex.y < minY) minY = vertex.y
        if (vertex.y > maxY) maxY = vertex.y
        if (vertex.z < minZ) minZ = vertex.z
        if (vertex.z > maxZ) maxZ = vertex.z
      }
      if (maxY <= floorY) continue
      const midX = (minX + maxX) / 2
      const midZ = (minZ + maxZ) / 2
      if (midX < -70 || midX > 70 || midZ < -70 || midZ > 70) continue
      solids.push({
        name, kind,
        x: midX, z: midZ,
        hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2,
        low: minY, high: maxY,
        cos: 1, sin: 0,
      })
    }
  }

  world.traverse((child) => {
    if (excluded.has(child) || !child.isMesh || !child.geometry) return
    if (child.isSkinnedMesh) return
    if (decoration(child.userData ?? {})) return
    if (child.material?.depthWrite === false) return
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
    const local = child.geometry.boundingBox
    const half = {
      x: (local.max.x - local.min.x) / 2,
      y: (local.max.y - local.min.y) / 2,
      z: (local.max.z - local.min.z) / 2,
    }
    const centre = {
      x: (local.max.x + local.min.x) / 2,
      y: (local.max.y + local.min.y) / 2,
      z: (local.max.z + local.min.z) / 2,
    }
    const name = label(child)
    const push = (matrix, kind) => {
      const translation = new THREE.Vector3()
      const rotation = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      matrix.decompose(translation, rotation, scale)
      const euler = new THREE.Euler().setFromQuaternion(rotation, 'YXZ')
      const offset = new THREE.Vector3(centre.x, centre.y, centre.z).applyMatrix4(matrix)
      const halfY = half.y * Math.abs(scale.y)
      const high = offset.y + halfY
      if (high <= floorY) return
      if (offset.x < -70 || offset.x > 70 || offset.z < -70 || offset.z > 70) return
      solids.push({
        name, kind,
        x: offset.x, z: offset.z,
        hx: half.x * Math.abs(scale.x),
        hz: half.z * Math.abs(scale.z),
        low: offset.y - halfY, high,
        cos: Math.cos(euler.y), sin: Math.sin(euler.y),
      })
    }
    if (child.isInstancedMesh) {
      // Wall batches carry `aFacadeTile`; the rest of a facade group is roof and
      // ridge, which sit above head height and are not walked through.
      const isFacade = Boolean(child.geometry.attributes?.aFacadeTile)
      const matrix = new THREE.Matrix4()
      for (let index = 0; index < child.count; index += 1) {
        child.getMatrixAt(index, matrix)
        const world = matrix.clone().premultiply(child.matrixWorld)
        /*
         * A box per instance is right for a cottage and wrong for a hill.
         *
         * The bounding-box mistake this instrument was rewritten to remove came
         * back through the instanced path: the Old Quarter's outskirts include
         * landform cones 25 m across, and one instance's box covered a quarter
         * of the district. 119 of the district's 147 hits were walkers standing
         * on open grass inside that box — 81% of the figure, and it is what the
         * old .0021 / .0109 bimodality was flipping between.
         *
         * Anything whose footprint is over four metres is an envelope rather
         * than a shape, so it goes in a triangle at a time like a static batch.
         * A tree, a bollard or a cottage stays one cheap box.
         */
        const scale = new THREE.Vector3().setFromMatrixScale(world)
        const wide = half.x * Math.abs(scale.x) > 2 || half.z * Math.abs(scale.z) > 2
        /*
         * A box's own bounding box is the box. Anything tapered — a hip roof, a
         * tree crown, a horizon hill — fills a fraction of one, and the corners
         * of that fraction are open air a walker is entitled to stand in. The
         * Old Quarter's terraces read as 62 and 83 frames of walker-inside-roof
         * on the strength of it.
         */
        const tapered = child.geometry.type !== 'BoxGeometry'
        if (wide || tapered) triangles(child.geometry, world, isFacade ? 'facade' : 'instanced', name)
        else push(world, isFacade ? 'facade' : 'instanced')
      }
      return
    }
    /*
     * Unbatched meshes go in whole; a static batch goes in a triangle at a
     * time.
     *
     * `bakeBatches` merges every district mesh that shares a material family
     * into one, so a batch's bounding box is most of the district and testing
     * against it reports every walker as inside a building. That is not a
     * near-miss in the attribution — it is a 100% share, which is how it was
     * caught. Per-triangle boxes cost more and are the only thing that survives
     * the merge.
     */
    if (child.userData?.staticBatch) {
      triangles(child.geometry, child.matrixWorld, 'static', name)
      return
    }
    push(child.matrixWorld.clone(), 'static')
  })

  /*
   * The body the audit tests, taken from the whole crowd rather than from
   * `walkers[0]`.
   *
   * One walker's world box is its box in the pose it is standing in. Mid-stride
   * the legs are apart and the arms are out, so the narrowest horizontal extent
   * — which is what a half-beam is — swings between .06 and .32 depending on
   * which frame of which animation that one figure happens to be on. It was
   * deciding the metric: the same untouched Sovereign Arc was tested at radius
   * .3183 in one arm and .3 in the next, and The Circuit was tested for three
   * sessions with an eighteen-centimetre body, because its first walker was
   * caught with nothing but its shoes in the box. Three districts were being
   * compared against each other with three different people.
   *
   * The median over every walker is stable to the digit across lifetimes and is
   * an honest description of the figure actually drawn.
   */
  const middle = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    if (!sorted.length) return null
    const half = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
  }
  const bodies = (crowd?.walkers ?? []).map((walker) => {
    const root = walker.rig?.root ?? walker.root
    if (!root) return null
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return null
    return {
      half: Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
      height: box.max.y - box.min.y,
      foot: box.min.y,
    }
  }).filter(Boolean)
  /*
   * A fixed test body, when the caller supplies one.
   *
   * The median over the whole crowd is stable to the digit across lifetimes for
   * one configuration, which is what it was introduced to fix. It is still the
   * wrong body for an A/B, and `beam-arm.mjs` found out how: the median is taken
   * over the poses the walkers happen to be in, two arms send them along
   * different routes, and The Circuit was therefore measured with a body of
   * radius .2514 in one arm and .2727 in the other. Eight percent more body is
   * two centimetres more overlap at every solid in the district, and that alone
   * can move a share concentrated on a handful of sites by a third — so the arm
   * that widened the plan appeared to make containment worse partly because it
   * was being tested with a fatter person.
   *
   * The drawn walker's width does not depend on how much ground the plan
   * reserves for it, so for a comparison it should not be re-derived per arm.
   * Passing a radius pins it; leaving it out keeps the measured median, which is
   * what a single unpaired reading wants.
   */
  const measuredRadius = Math.max(.06, middle(bodies.map((body) => body.half)) ?? .12)
  const radius = settings.radius ?? measuredRadius
  const measuredHeight = Math.max(.1, middle(bodies.map((body) => body.height)) ?? .5)
  /*
   * How tall the test body is, pinnable for the same reason the radius is.
   *
   * `beam-arm.mjs` only ever needed the radius pinned, because both of its arms
   * drew the same person and changed the ground under them. `crowd-arm.mjs`
   * changes the person: at half scale a walker is .245 units tall instead of
   * .49, so the band between its shins and its shoulders drops from .147-.451
   * to .073-.225 — and a solid is only counted when it reaches into that band
   * and stands `rideOver` above its floor. Half the district's kerbs and plinths
   * leave the figure entirely, so an unpinned pair moves for two reasons at once
   * and neither can be told from the other.
   *
   * Pinning both makes a control that answers one question only: did the plan
   * change. It must not, because a render scale is a scale on a root.
   */
  const height = settings.height ?? measuredHeight
  /*
   * And where the band starts, which is the third dimension of the test body and
   * the one that was missed.
   *
   * `radius` and `height` pinned the figure's size and left its *elevation*
   * derived: the band is measured up from the median walker's box floor, and a
   * body drawn at half scale sits with its box floor five centimetres lower. So
   * `crowd-arm.mjs`'s "pinned control" — the arm whose entire job was to show
   * that a render scale does not touch the plan — was still testing two
   * different volumes, one of them straddling a different set of the district's
   * kerbs, and it duly reported the plan changing in three regions at once
   * (city .0058 to .0173, continent .0118 to .0289) when nothing in the plan
   * had been touched.
   *
   * Pinning all three makes the control a genuine null: same radius, same
   * height, same height above the pavement, so the only thing left that can move
   * the share is where the walkers went.
   */
  const measuredFoot = middle(bodies.map((body) => body.foot)) ?? 0
  const foot = settings.foot ?? measuredFoot
  const low = foot + height * .3
  const high = foot + height * .92

  // The sim's own state at the moment capture starts. If this is not the same
  // on every lifetime then the crowd is not starting from the same place, and
  // no amount of pinning the *build* will make the walk reproducible.
  const entry = {
    // Non-zero means some district on the way here had to be built with real
    // frames, so this run's crowd did not start from the same place as anyone
    // else's. Treat the whole run as uncomparable.
    unpinnedBuilds: window.__unpinnedBuilds ?? 0,
    elapsed: crowd?.elapsed ?? null,
    spawnCursor: crowd?.spawnCursor ?? null,
    walkers: crowd?.walkers?.length ?? null,
    active: crowd?.walkers?.filter((walker) => walker.active).length ?? null,
    firstSeeds: (crowd?.walkers ?? []).slice(0, 3).map((walker) => +Number(walker.seed ?? 0).toFixed(4)),
    firstAt: (crowd?.walkers ?? []).slice(0, 3).map((walker) => {
      const body = walker.rig?.root ?? walker.root
      return body ? `${body.position.x.toFixed(3)},${body.position.z.toFixed(3)}` : null
    }),
  }

  const tally = {}
  let samples = 0
  let hits = 0
  for (let frame = 0; frame < frames; frame += 1) {
    window.__clock.tick(1)
    if (!crowd?.walkers) continue
    for (const walker of crowd.walkers) {
      if (!walker.active) continue
      const body = walker.rig?.root ?? walker.root
      if (!body) continue
      samples += 1
      const x = body.position.x
      const z = body.position.z
      let worst = null
      for (const solid of solids) {
        if (solid.high <= low || solid.low >= high) continue
        if (solid.high - low < rideOver) continue
        const dx = x - solid.x
        const dz = z - solid.z
        const localX = dx * solid.cos - dz * solid.sin
        const localZ = dx * solid.sin + dz * solid.cos
        const clampedX = Math.min(Math.max(localX, -solid.hx), solid.hx)
        const clampedZ = Math.min(Math.max(localZ, -solid.hz), solid.hz)
        const depth = radius - Math.hypot(localX - clampedX, localZ - clampedZ)
        if (depth > 0 && (!worst || depth > worst.depth)) worst = { depth, solid }
      }
      if (!worst) continue
      hits += 1
      // Grouped by where it is rather than by which mesh it came from: the
      // merge has already thrown the mesh away, so a place and a height is the
      // identity available, and the nearest named prop tells us what stands
      // there.
      const spot = `${Math.round(worst.solid.x)},${Math.round(worst.solid.z)}`
      const key = `${worst.solid.kind}@${spot}`
      const found = tally[key] ?? (tally[key] = {
        frames: 0,
        depth: 0,
        top: +worst.solid.high.toFixed(2),
        near: nearestProp(worst.solid.x, worst.solid.z),
        // The box itself, so the site can be looked up rather than guessed at.
        // `whatis` takes a rounded coordinate and a radius, and a site whose
        // solid is 5 cm wide is a different search from one 4 m wide.
        box: `${(worst.solid.hx * 2).toFixed(2)}x${(worst.solid.hz * 2).toFixed(2)} at ${worst.solid.x.toFixed(2)},${worst.solid.z.toFixed(2)} y${worst.solid.low.toFixed(2)}-${worst.solid.high.toFixed(2)}`,
        where: `${worst.solid.x.toFixed(2)},${worst.solid.z.toFixed(2)}`,
      })
      found.frames += 1
      if (worst.depth > found.depth) found.depth = +worst.depth.toFixed(3)
      if (worst.solid.high > found.top) found.top = +worst.solid.high.toFixed(2)
    }
  }

  return {
    region: scene.region,
    entry,
    solids: solids.length,
    facades: solids.filter((solid) => solid.kind === 'facade').length,
    body: {
      radius: +radius.toFixed(4),
      // Kept alongside, because a pinned radius hides the thing it was pinned to
      // suppress and the size of that thing is itself a finding.
      measuredRadius: +measuredRadius.toFixed(4),
      pinned: settings.radius !== undefined,
      height: +height.toFixed(4),
      measuredHeight: +measuredHeight.toFixed(4),
      pinnedHeight: settings.height !== undefined,
      foot: +foot.toFixed(4),
      measuredFoot: +measuredFoot.toFixed(4),
      pinnedFoot: settings.foot !== undefined,
      low: +low.toFixed(4),
      high: +high.toFixed(4),
    },
    samples,
    hits,
    share: +(hits / Math.max(1, samples)).toFixed(4),
    worst: Object.entries(tally)
      .sort((a, b) => b[1].frames - a[1].frames)
      .slice(0, 30)
      .map(([what, value]) => ({ what, ...value })),
  }
}

/**
 * Who cannot move, and how much walkable width the plan left.
 *
 * The counterpart to `insideMetric`, and it has to be read next to it: a change
 * that constrains the router can improve every containment number by the simple
 * expedient of leaving people unable to go anywhere at all, and a walker
 * standing still is inside nothing.
 *
 * Settings: `{ frames }`.
 */
export function strandedMetric(settings) {
  const { frames } = settings
  const scene = window.__mapScene
  scene.renderer.render = () => {}
  const crowd = scene.crowd

  const ways = crowd?.ways ?? []
  let length = 0
  let zeroWidth = 0
  for (const way of ways) {
    length += way.length ?? 0
    const half = way.halfWidth ?? way.half ?? null
    if (half !== null && half <= 0) zeroWidth += 1
  }

  const body = (walker) => walker.rig?.root ?? walker.root
  const seen = new Map()
  const note = () => {
    for (const walker of crowd?.walkers ?? []) {
      const object = body(walker)
      if (!object) continue
      const record = seen.get(walker) ?? (seen.set(walker, {
        travelled: 0, activeFrames: 0, lastX: object.position.x, lastZ: object.position.z,
        recentX: object.position.x, recentZ: object.position.z, recent: 0,
      }), seen.get(walker))
      if (!walker.active) continue
      record.activeFrames += 1
      record.travelled += Math.hypot(object.position.x - record.lastX, object.position.z - record.lastZ)
      record.lastX = object.position.x
      record.lastZ = object.position.z
    }
  }

  note()
  for (let frame = 0; frame < frames; frame += 1) {
    window.__clock.tick(1)
    note()
    // The last quarter on its own, so a walker that moved early and has since
    // parked is not hidden by the distance it covered before it stopped.
    if (frame === Math.floor(frames * .75)) {
      for (const [walker, record] of seen) {
        const object = body(walker)
        record.recentX = object ? object.position.x : record.lastX
        record.recentZ = object ? object.position.z : record.lastZ
        record.recent = 0
      }
    }
  }
  for (const [walker, record] of seen) {
    const object = body(walker)
    if (object) record.recent = Math.hypot(object.position.x - record.recentX, object.position.z - record.recentZ)
  }

  const rows = [...seen.values()].filter((record) => record.activeFrames > frames * .5)
  const travelled = rows.map((record) => record.travelled)
  const parked = rows.filter((record) => record.recent < .25).length
  travelled.sort((a, b) => a - b)
  return {
    region: scene.region,
    ways: ways.length,
    wayLength: +length.toFixed(1),
    zeroWidthWays: zeroWidth,
    walkers: crowd?.walkers?.length ?? 0,
    tracked: rows.length,
    parked,
    parkedShare: +(parked / Math.max(1, rows.length)).toFixed(4),
    travelledMedian: +(travelled[Math.floor(travelled.length / 2)] ?? 0).toFixed(2),
    travelledMin: +(travelled[0] ?? 0).toFixed(2),
  }
}

/** The settings every recorded `inside.mjs` baseline was taken at. */
export const INSIDE_SETTINGS = { floorY: .16, rideOver: .18 }
