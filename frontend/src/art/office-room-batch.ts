import * as THREE from 'three'

/**
 * Draws the room the cast sits in — desks, chairs, shelving, fittings, shell —
 * in as few submissions as the shapes allow.
 *
 * ## The problem, priced
 *
 * `office-cast-batch` took the sixteen people on the top-tier Practice Floor
 * from 933 submissions to 109. What that left behind is the furniture: 929 of
 * the room's remaining meshes are not people, and on Chambers 685 are. That is
 * now the larger half of the frame, and unlike the cast none of it moves.
 *
 * ## Why the obvious grouping is not enough
 *
 * The cast batches well because `stylized-counsel` cuts every body from one
 * cached set of parts, so a shoe is one geometry seen thirty times. The room is
 * the opposite: it is authored inline, prop by prop, at whatever size the prop
 * wants. Grouping the Practice Floor by geometry identity and material yields
 * 517 batches from 929 meshes — barely two meshes a batch, and 381 of those
 * batches hold exactly one mesh, because 506 distinct geometries were cut for
 * 929 meshes.
 *
 * ## What is actually shared
 *
 * A drawer front two hundred millimetres wide and a drawer front three hundred
 * wide are not two shapes. They are one shape at two sizes, and three's
 * instancing shader already carries a full matrix per instance — including a
 * non-uniform scale, whose normals it corrects by dividing each column of the
 * instance basis by its own squared length, which is the inverse transpose that
 * a scale needs.
 *
 * So a geometry is restated as **a shape plus the size that produced it**.
 * `BoxGeometry(2, .4, 1)` is the same shape as `BoxGeometry(.3, .3, .3)` under
 * a scale of `(6.67, 1.33, 3.33)`; a sphere of any radius is any other sphere
 * with the same segment counts; a rounded box is homogeneous of degree one in
 * width, height, depth *and* fillet radius together, so two rounded boxes share
 * a shape exactly when those four are in the same proportion. Restated that
 * way, the Practice Floor's 506 room geometries become 248 shapes and its 929
 * meshes fall into 304 groups.
 *
 * Nothing is approximated to get there. Every geometry three cuts from
 * parameters is a pure function of them, and every one used here is homogeneous
 * in the dimensions this restates, so the vertices of the smaller box really are
 * the vertices of the larger one scaled — which is why the class does not take
 * that on faith. Before two geometries are allowed to share a submission their
 * position and texture attributes are sampled and compared under the scale that
 * is claimed to relate them, and a pair that does not agree is refused and left
 * as two ordinary meshes. That check is what makes a geometry someone has
 * translated or rewritten after cutting safe rather than silently misplaced.
 *
 * ## What this does not do that the cast batcher does
 *
 * It does not clone materials and it does not use `instanceColor`. The cast had
 * to, because thirty people are thirty colours over the same shoe. The room's
 * materials are already interned — the same `MeshStandardMaterial` object is
 * handed to every mesh that wants that finish — so a batch can simply hold the
 * material the meshes were already using. That keeps the colour exact, keeps
 * every map and emissive setting exact, and keeps the draw loop's writes
 * working: the screens dim and brighten by one write to a shared material per
 * frame, and a batch holding that same object dims with them.
 *
 * It also does not copy transforms per frame. The furniture is placed at build
 * time and stays there, so the matrices are written once. Anything that does
 * move is kept out by `batchSkip` (below), and `drift()` exists to check that
 * claim rather than assert it.
 *
 * ## What is kept out, and why
 *
 * - Anything under an object marked `userData.batchSkip`: the draggable chair,
 *   the cat, the district beyond the window, the clock's minute hand, the
 *   lantern flame, the hearth ember, the shelf books that lean as time passes,
 *   and every actor. A batched instance is a matrix written once; a thing that
 *   moves would freeze at the pose it was captured in.
 * - Transparent surfaces. Three sorts transparent objects against each other
 *   back to front, one object at a time, and a batch is one object — so folding
 *   the glass, the dust sheet and the lamp bloom together would fix their order
 *   relative to each other for good. The glass in this room overlaps the view
 *   through it, which is precisely the case that ordering decides.
 * - Groups of one. An `InstancedMesh` of a single instance costs the same draw
 *   as the mesh it replaces, and gives up that mesh's own frustum test to do it.
 */

/** A geometry restated as a shape and the size that produced it. */
type Restated = { shape: string; size: THREE.Vector3 }

const round = (value: number) => Number(value.toFixed(6))

/**
 * The shape a parametric geometry is, apart from how big it is.
 *
 * The size returned is the scale that turns the shape into this geometry, so
 * two geometries with the same shape string are related by the ratio of their
 * sizes. Anything three did not cut from parameters — a lathe, a tube along a
 * curve, a wall with a window cut out of it — has no shape here and is matched
 * on its own identity instead.
 *
 * Segment counts, arc starts and arc lengths are all part of the shape rather
 * than the size, because no scale relates a twelve-sided cylinder to an
 * eighteen-sided one.
 */
function restate(geometry: THREE.BufferGeometry): Restated | null {
  const p = (geometry as unknown as { parameters?: Record<string, number & boolean> }).parameters
  if (!p) return null
  switch (geometry.type) {
    case 'BoxGeometry':
      return { shape: `box:${p.widthSegments}:${p.heightSegments}:${p.depthSegments}`, size: new THREE.Vector3(p.width, p.height, p.depth) }
    case 'PlaneGeometry':
      return { shape: `plane:${p.widthSegments}:${p.heightSegments}`, size: new THREE.Vector3(p.width, p.height, 1) }
    case 'CircleGeometry':
      return { shape: `circle:${p.segments}:${round(p.thetaStart)}:${round(p.thetaLength)}`, size: new THREE.Vector3(p.radius, p.radius, 1) }
    case 'RingGeometry':
      return {
        shape: `ring:${round(p.innerRadius / p.outerRadius)}:${p.thetaSegments}:${p.phiSegments}:${round(p.thetaStart)}:${round(p.thetaLength)}`,
        size: new THREE.Vector3(p.outerRadius, p.outerRadius, 1),
      }
    case 'SphereGeometry':
      return {
        shape: `sphere:${p.widthSegments}:${p.heightSegments}:${round(p.phiStart)}:${round(p.phiLength)}:${round(p.thetaStart)}:${round(p.thetaLength)}`,
        size: new THREE.Vector3(p.radius, p.radius, p.radius),
      }
    case 'CylinderGeometry': {
      // A cylinder's two radii are one shape and one size only if they stay in
      // proportion, so the taper goes in the shape and the wider end is the
      // size. A cone written as a cylinder with a zero top falls out of this
      // correctly: its taper is 0, which no untapered cylinder shares.
      const span = Math.max(p.radiusTop, p.radiusBottom)
      if (!(span > 0) || !(p.height > 0)) return null
      return {
        shape: `cyl:${round(p.radiusTop / span)}:${round(p.radiusBottom / span)}:${p.radialSegments}:${p.heightSegments}:${p.openEnded}:${round(p.thetaStart)}:${round(p.thetaLength)}`,
        size: new THREE.Vector3(span, p.height, span),
      }
    }
    case 'ConeGeometry':
      if (!(p.radius > 0) || !(p.height > 0)) return null
      return {
        shape: `cone:${p.radialSegments}:${p.heightSegments}:${p.openEnded}:${round(p.thetaStart)}:${round(p.thetaLength)}`,
        size: new THREE.Vector3(p.radius, p.height, p.radius),
      }
    case 'TorusGeometry':
      if (!(p.radius > 0)) return null
      return {
        shape: `torus:${round(p.tube / p.radius)}:${p.radialSegments}:${p.tubularSegments}:${round(p.arc)}`,
        size: new THREE.Vector3(p.radius, p.radius, p.radius),
      }
    case 'CapsuleGeometry': {
      const length = p.length ?? (p as unknown as { height: number }).height
      if (!(p.radius > 0)) return null
      return {
        shape: `capsule:${round(length / p.radius)}:${p.capSegments}:${p.radialSegments}`,
        size: new THREE.Vector3(p.radius, p.radius, p.radius),
      }
    }
    case 'RoundedBoxGeometry':
      // Every vertex is `halfExtent * sign + unitNormal * radius`, and the unit
      // normal does not depend on any of the four numbers, so the whole surface
      // scales with them together. The fillet is therefore part of the shape,
      // not free to differ.
      if (!(p.width > 0)) return null
      return {
        shape: `rbox:${round(p.height / p.width)}:${round(p.depth / p.width)}:${round(p.radius / p.width)}:${p.segments}`,
        size: new THREE.Vector3(p.width, p.width, p.width),
      }
    default:
      return null
  }
}

/**
 * Whether one geometry really is another one scaled.
 *
 * `restate` reads the numbers a geometry was *asked* for, and a geometry that
 * was translated, rotated or had an attribute rewritten after it was cut still
 * carries the parameters it was cut with. Sharing a submission on that basis
 * would put a prop somewhere it is not, silently, in a room nobody is going to
 * diff vertex by vertex.
 *
 * So the relation is checked rather than assumed: the vertices are sampled at a
 * stride across the whole buffer and compared under the scale that is claimed
 * to relate them, together with the texture coordinates, which the scale must
 * leave alone. Every geometry here is either small or regular, so a few dozen
 * samples spread over the buffer cannot plausibly agree by accident while the
 * rest disagrees.
 */
function relatedByScale(reference: THREE.BufferGeometry, candidate: THREE.BufferGeometry, scale: THREE.Vector3) {
  if (reference === candidate) return true
  const referencePosition = reference.getAttribute('position')
  const candidatePosition = candidate.getAttribute('position')
  if (!referencePosition || !candidatePosition) return false
  if (referencePosition.count !== candidatePosition.count) return false
  if (Boolean(reference.index) !== Boolean(candidate.index)) return false
  if (reference.index && candidate.index && reference.index.count !== candidate.index.count) return false
  const referenceUv = reference.getAttribute('uv')
  const candidateUv = candidate.getAttribute('uv')
  if (Boolean(referenceUv) !== Boolean(candidateUv)) return false

  const count = referencePosition.count
  const samples = Math.min(count, 48)
  const stride = Math.max(1, Math.floor(count / samples))
  for (let index = 0; index < count; index += stride) {
    const x = referencePosition.getX(index) * scale.x
    const y = referencePosition.getY(index) * scale.y
    const z = referencePosition.getZ(index) * scale.z
    // Relative to the size of the value, because a two-metre panel and a
    // two-millimetre bevel cannot share one absolute tolerance.
    const tolerance = 1e-4 * Math.max(1, Math.abs(x), Math.abs(y), Math.abs(z))
    if (Math.abs(x - candidatePosition.getX(index)) > tolerance) return false
    if (Math.abs(y - candidatePosition.getY(index)) > tolerance) return false
    if (Math.abs(z - candidatePosition.getZ(index)) > tolerance) return false
    if (referenceUv && candidateUv) {
      if (Math.abs(referenceUv.getX(index) - candidateUv.getX(index)) > 1e-4) return false
      if (Math.abs(referenceUv.getY(index) - candidateUv.getY(index)) > 1e-4) return false
    }
  }
  return true
}

type Candidate = {
  mesh: THREE.Mesh
  material: THREE.Material
  /** How much bigger this mesh's geometry is than the shape it is cut from. */
  size: THREE.Vector3 | null
}

type Instance = { node: THREE.Mesh; scale: THREE.Vector3 }

export type OfficeRoomBatchCensus = {
  /** Visible, still meshes the walk reached. */
  reached: number
  /** Of those, the ones a batch was allowed to hold at all. */
  candidates: number
  /** Of those, how many ended up drawn from a batch. */
  batched: number
  /** How many submissions those cost. */
  batches: number
  /** Instances that only found their batch because the geometry was restated
   *  as a shape and a size rather than matched on identity. */
  resized: number
  /** Instances refused because the vertices did not agree with the parameters
   *  they were cut from. */
  refused: number
  /** Left as ordinary meshes: transparent, or the only one of their kind. */
  left: number
}

export class OfficeRoomBatch {
  /** Add this to the scene. Its own transform is honoured. */
  readonly group = new THREE.Group()
  readonly census: OfficeRoomBatchCensus
  private readonly batches: Array<{ mesh: THREE.InstancedMesh; instances: Instance[] }> = []
  /** Meshes handed back to the scene graph by `release`. */
  private readonly released = new Set<THREE.Mesh>()

  constructor(root: THREE.Object3D) {
    this.group.name = 'office-room-batch'
    root.updateWorldMatrix(true, true)

    const candidates: Candidate[] = []
    const grouped = new Map<string, Candidate[]>()
    let reached = 0

    const walk = (object: THREE.Object3D) => {
      // A hidden ancestor is not something an `InstancedMesh` can be told
      // about — it holds matrices, not a graph — so the visibility of the whole
      // chain is resolved here, on the way down, and anything switched off is
      // simply never a candidate.
      if (!object.visible || object.userData.batchSkip) return
      if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh)) {
        reached += 1
        const material = object.material
        // A material array wants a group table inside the batch, and a surface
        // that does not write depth is one three has to order by hand.
        if (!Array.isArray(material) && !material.transparent && material.depthWrite !== false) {
          const restated = restate(object.geometry)
          const size = restated?.size ?? null
          const shape = restated ? restated.shape : `geometry:${object.geometry.uuid}`
          // Material by identity rather than by finish. The room interns its
          // materials, so identity already groups everything a finish would,
          // and holding the original object rather than a neutralised copy is
          // what lets the draw loop keep writing to it.
          const key = `${shape}|${material.uuid}|${object.castShadow ? 'c' : ''}|${object.receiveShadow ? 'r' : ''}|${object.renderOrder}`
          const candidate: Candidate = { mesh: object, material, size }
          candidates.push(candidate)
          const list = grouped.get(key)
          if (list) list.push(candidate)
          else grouped.set(key, [candidate])
        }
      }
      for (const child of object.children) walk(child)
    }
    walk(root)

    this.group.updateWorldMatrix(true, false)
    const toGroup = new THREE.Matrix4().copy(this.group.matrixWorld).invert()
    const local = new THREE.Matrix4()
    const sizing = new THREE.Matrix4()
    let batched = 0
    let resized = 0
    let refused = 0

    for (const group of grouped.values()) {
      if (group.length < 2) continue
      const reference = group[0]
      const instances: Instance[] = []
      // Memoised per geometry pair rather than per mesh: a group of thirty
      // drawer fronts is usually three or four distinct geometries.
      const verdicts = new Map<string, boolean>()
      for (const candidate of group) {
        const scale = new THREE.Vector3(1, 1, 1)
        if (candidate.mesh.geometry !== reference.mesh.geometry) {
          if (!candidate.size || !reference.size) continue
          scale.copy(candidate.size).divide(reference.size)
          const pair = `${reference.mesh.geometry.uuid}>${candidate.mesh.geometry.uuid}`
          let verdict = verdicts.get(pair)
          if (verdict === undefined) {
            verdict = relatedByScale(reference.mesh.geometry, candidate.mesh.geometry, scale)
            verdicts.set(pair, verdict)
          }
          if (!verdict) { refused += 1; continue }
          resized += 1
        }
        instances.push({ node: candidate.mesh, scale })
      }
      // A group can be emptied out by refusals, and one survivor is not worth a
      // batch.
      if (instances.length < 2) continue

      const mesh = new THREE.InstancedMesh(reference.mesh.geometry, reference.material, instances.length)
      mesh.castShadow = reference.mesh.castShadow
      mesh.receiveShadow = reference.mesh.receiveShadow
      mesh.renderOrder = reference.mesh.renderOrder
      // Written once and never again, which is the whole difference between
      // this and the cast: the room is placed at build time and stays put.
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      // The floor's own obstacle probes walk meshes, and a batch is a whole
      // room's worth of geometry standing at the origin as far as a bounding
      // box is concerned.
      mesh.userData.navIgnore = true
      for (let index = 0; index < instances.length; index += 1) {
        const instance = instances[index]
        sizing.makeScale(instance.scale.x, instance.scale.y, instance.scale.z)
        // The scale is applied in the mesh's own space, after its placement,
        // which is exactly where `mesh.scale` would have applied it.
        mesh.setMatrixAt(index, local.multiplyMatrices(toGroup, instance.node.matrixWorld).multiply(sizing))
        instance.node.visible = false
      }
      mesh.instanceMatrix.needsUpdate = true
      // Culled as a unit, against a sphere that covers where the instances
      // actually are rather than where the shape sits at the origin. Batches
      // that span the room will always be in view and batches that are one
      // department's shelving will not, which is the part of per-mesh culling
      // worth keeping.
      mesh.computeBoundingSphere()
      batched += instances.length
      this.batches.push({ mesh, instances })
      this.group.add(mesh)
    }

    this.census = {
      reached,
      candidates: candidates.length,
      batched,
      batches: this.batches.length,
      resized,
      refused,
      left: reached - batched,
    }
  }

  /**
   * Hand a subtree back to the scene graph, so it is free to move.
   *
   * The room is batched on the theory that furniture stays where it was put,
   * and the player can now pick some of it up. The obvious way to allow that
   * is `batchSkip` on everything draggable, which pays for the possibility of
   * a drag on every frame of every session whether or not anyone ever drags
   * anything — measured on the top-tier Practice Floor, the seven movable
   * cosmetics are 116 meshes, most of which do batch.
   *
   * So they stay batched until they are actually grabbed. This drops each of
   * the subtree's instances to a zero scale — the cheapest way to remove one
   * instance from a batch without rebuilding the buffer — and turns the real
   * mesh back on in its place. The cost of a movable object is therefore paid
   * by the player who moves it, at the moment they move it, and a room nobody
   * has rearranged submits exactly what it submitted before.
   *
   * Returns how many meshes were handed back, which is how a harness can tell
   * a release that did nothing from one that worked.
   */
  release(root: THREE.Object3D) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    const inside = new Set<THREE.Object3D>()
    root.traverse((node) => inside.add(node))
    let restored = 0
    for (const batch of this.batches) {
      let touched = false
      for (let index = 0; index < batch.instances.length; index += 1) {
        const instance = batch.instances[index]
        if (!inside.has(instance.node) || this.released.has(instance.node)) continue
        batch.mesh.setMatrixAt(index, zero)
        instance.node.visible = true
        this.released.add(instance.node)
        touched = true
        restored += 1
      }
      if (touched) batch.mesh.instanceMatrix.needsUpdate = true
    }
    return restored
  }

  /**
   * Fold a released subtree back into its batches, wherever it now stands.
   *
   * The other half of `release`, and the reason a rearranged room costs what
   * an untouched one does. Dropping a piece ends the only period in which it
   * needs its own submissions: it is furniture again, standing still, at a new
   * matrix instead of its old one. So the instance is rewritten from where the
   * mesh actually is and the mesh goes back to being invisible.
   *
   * The bounding sphere is recomputed because it is the thing that decides
   * whether the batch is drawn at all: a batch culled against where its
   * instances used to be would drop a piece the player has just carried out of
   * that volume, at whatever camera angle happens to expose it.
   *
   * Returns how many meshes were folded back in.
   */
  reclaim(root: THREE.Object3D) {
    const inside = new Set<THREE.Object3D>()
    root.traverse((node) => inside.add(node))
    const local = new THREE.Matrix4()
    const sizing = new THREE.Matrix4()
    this.group.updateWorldMatrix(true, false)
    const toGroup = new THREE.Matrix4().copy(this.group.matrixWorld).invert()
    let folded = 0
    for (const batch of this.batches) {
      let touched = false
      for (let index = 0; index < batch.instances.length; index += 1) {
        const instance = batch.instances[index]
        if (!inside.has(instance.node) || !this.released.has(instance.node)) continue
        instance.node.updateWorldMatrix(true, false)
        sizing.makeScale(instance.scale.x, instance.scale.y, instance.scale.z)
        batch.mesh.setMatrixAt(index, local.multiplyMatrices(toGroup, instance.node.matrixWorld).multiply(sizing))
        instance.node.visible = false
        this.released.delete(instance.node)
        touched = true
        folded += 1
      }
      if (touched) {
        batch.mesh.instanceMatrix.needsUpdate = true
        batch.mesh.computeBoundingSphere()
      }
    }
    return folded
  }

  /** Meshes currently out of their batch and drawing themselves. */
  get releasedCount() {
    return this.released.size
  }

  /**
   * Anything that has moved or been hidden since its matrix was captured.
   *
   * A static batch is a bet that the room stands still, and the cost of losing
   * that bet is a prop frozen in the pose it had at build time while the mesh
   * the rest of the scene reasons about goes on moving — a bug that shows up as
   * a screenshot nobody can explain rather than as an error. This settles it by
   * measurement: after the room has been running for a while, ask.
   */
  drift() {
    const current = new THREE.Matrix4()
    const stored = new THREE.Matrix4()
    const sizing = new THREE.Matrix4()
    const toGroup = new THREE.Matrix4().copy(this.group.matrixWorld).invert()
    const moved: string[] = []
    for (const batch of this.batches) {
      for (let index = 0; index < batch.instances.length; index += 1) {
        const instance = batch.instances[index]
        // A released instance is *meant* to have left its batch behind, so it
        // is not drift. It is the one case where the mesh moving and the
        // matrix not following is the intended outcome.
        if (this.released.has(instance.node)) continue
        instance.node.updateWorldMatrix(true, false)
        sizing.makeScale(instance.scale.x, instance.scale.y, instance.scale.z)
        current.multiplyMatrices(toGroup, instance.node.matrixWorld).multiply(sizing)
        batch.mesh.getMatrixAt(index, stored)
        let shown = true
        for (let node: THREE.Object3D | null = instance.node.parent; node; node = node.parent) {
          if (node.visible) continue
          shown = false
          break
        }
        const drifted = current.elements.some((value, slot) => Math.abs(value - stored.elements[slot]) > 1e-5)
        if (drifted || !shown) {
          moved.push(`${instance.node.name || instance.node.geometry.type}@${instance.node.id}${drifted ? ' moved' : ''}${shown ? '' : ' hidden'}`)
        }
      }
    }
    return moved
  }

  dispose() {
    // Only the instance buffers are this batch's own. The geometry and the
    // material belong to the meshes still sitting in the graph, and the scene's
    // teardown pass is what releases those.
    for (const batch of this.batches) batch.mesh.dispose()
    this.group.clear()
  }
}
