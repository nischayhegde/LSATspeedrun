// Which object is the walker standing in?
//
// `collide.mjs` rasterises the district into a grid, which is the right shape
// for "how often" and throws away the one thing needed for "why": the identity
// of the thing being stood in. Its worst-site list can only say that something
// 2.89 tall at (-12,-7) had people in it for 229 frames.
//
// This keeps every solid as a named box instead. Slower, and it only has to run
// when a number needs explaining rather than on every arm.
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'inside'
const keys = process.argv.slice(3).filter((argument) => !argument.startsWith('--'))
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)
const dir = `${OUT}/inside-${tag}`

async function attribute(settings) {
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
        if (wide) triangles(child.geometry, world, isFacade ? 'facade' : 'instanced', name)
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

  let radius = .12
  let low = .1
  let high = .5
  const sample = crowd?.walkers?.[0]
  const root = sample?.rig?.root ?? sample?.root
  if (root) {
    const box = new THREE.Box3().setFromObject(root)
    if (!box.isEmpty()) {
      radius = Math.max(.06, Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2)
      const height = Math.max(.1, box.max.y - box.min.y)
      low = box.min.y + height * .3
      high = box.min.y + height * .92
    }
  }

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
    body: { radius: +radius.toFixed(4), low: +low.toFixed(4), high: +high.toFixed(4) },
    samples,
    hits,
    share: +(hits / Math.max(1, samples)).toFixed(4),
    worst: Object.entries(tally)
      .sort((a, b) => b[1].frames - a[1].frames)
      .slice(0, 30)
      .map(([what, value]) => ({ what, ...value })),
  }
}

const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(attribute, { frames: FRAMES, floorY: .16, rideOver: .18 })
    console.log(`\n=== ${key} === solids ${report[key].solids} (facade ${report[key].facades}) share ${report[key].share}`)
    console.log(`  entry ${JSON.stringify(report[key].entry)}`)
    for (const row of report[key].worst) {
      console.log(`  ${String(row.frames).padStart(5)}  ${row.what.padEnd(22)} ${row.box}  depth ${row.depth}  near ${row.near}`)
    }
    report._errors = errors.slice(0, 10)
    save(`${dir}/report.json`, report)
  }
} finally {
  await browser.close().catch(() => {})
}
