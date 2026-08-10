import * as THREE from 'three'

/**
 * Draws the firm's seated cast in a fixed number of submissions.
 *
 * ## The problem, priced
 *
 * `buildStylizedCounsel` hangs about sixty small meshes off a joint hierarchy:
 * a skull, a hair shell, two eyes and their pupils, lapels, a tie, a shoe and
 * a sole per foot, a hand and a finger mass and a thumb per arm. Measured by
 * the scene's own census at tier fourteen, that is **58.3 parts and 11,506
 * triangles a body**, and the top-tier Practice Floor seats sixteen of them:
 * 933 of the room's 1,798 submissions are the people in it.
 *
 * Merging a body's parts together is the obvious answer and the wrong one.
 * Every joint in the hierarchy is animated — these characters are posed by
 * rotating groups, not by skinning — so a merge can only ever join parts that
 * share a joint, and it has to bake per-character colour and proportion into
 * the vertices, which means thirty bodies stop sharing geometry and the
 * geometry cache that pays for the whole cast is thrown away.
 *
 * ## What is actually shared
 *
 * Two people are not the same body, but the *parts* they are cut from are
 * overwhelmingly the same parts. `stylized-counsel` already caches geometry by
 * shape and render scale, so the paralegal's shoe and the partner's shoe are
 * one `BufferGeometry` seen twice at two transforms in two colours. That is
 * exactly what an `InstancedMesh` draws in one call.
 *
 * So the unit that has to be shared is a **geometry paired with a material
 * finish** — roughness, metalness, transparency, side — and never with a
 * colour, because colour rides per instance in `instanceColor`. Folding colour
 * into the key is what shatters a cast into hundreds of batches; leaving it
 * out is what makes the count saturate, since the sixteenth body introduces
 * almost no pair the first fifteen did not already have.
 *
 * This is the same trick `map-crowd-rig` plays on the district pavements, and
 * it is played here for the same reason and against the same geometry cache.
 * What differs is that the office's actors stay parented in the scene graph —
 * the focus ring, the earnings pick and the plan-view probes all read their
 * world positions — so instead of being kept out of the graph they are left in
 * it and hidden, which costs the renderer one visibility test per body and
 * keeps every consumer of those transforms working unchanged.
 *
 * ## What is not batched, and why
 *
 * The consulting client is one body and is raycast directly when the player
 * points at it, so it stays an ordinary mesh tree. One body is not worth a
 * special case in the pick path.
 */

/**
 * Which instances can share one draw.
 *
 * Colour is deliberately absent — it is carried per instance. Everything that
 * genuinely has to be one value for a whole submission is here, including the
 * shadow flags, which are a property of the mesh rather than of the material
 * and would otherwise be silently taken from whichever part happened to be
 * first into the batch.
 */
function finishKey(mesh: THREE.Mesh, material: THREE.Material) {
  const standard = material as THREE.MeshStandardMaterial
  return [
    material.type,
    standard.roughness?.toFixed(3) ?? '',
    standard.metalness?.toFixed(3) ?? '',
    material.transparent ? `t${material.opacity.toFixed(3)}` : '',
    material.side,
    material.toneMapped ? 'tm' : '',
    mesh.castShadow ? 'c' : '',
    mesh.receiveShadow ? 'r' : '',
  ].join('|')
}

type BatchEntry = {
  /** The part in the character's own hierarchy, whose world matrix is the
   *  instance. Still animated, still hidden. */
  node: THREE.Mesh
  /**
   * Everything between the part and its character that can be switched off.
   *
   * The renderer used to answer "is this drawn" by walking the graph, and
   * hiding the character's root took that answer away from it. A part is an
   * instance only while nothing above it is hidden — the satchel a visitor
   * carries only sometimes, the arms the consulting client sheds — so the
   * chain is recorded once here rather than rediscovered per frame.
   */
  chain: THREE.Object3D[]
}

type Batch = {
  entries: BatchEntry[]
  mesh: THREE.InstancedMesh
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0)

export class OfficeCastBatch {
  /** Add this to the scene. Its own transform is honoured, so it does not have
   *  to sit at the origin. */
  readonly group = new THREE.Group()
  /** How many draws the whole cast costs, for the harness and the census. */
  readonly batchCount: number
  /** How many parts those draws stand in for. */
  readonly partCount: number
  private readonly bodies: THREE.Object3D[]
  private readonly batches: Batch[] = []
  private readonly materials: THREE.Material[] = []
  private readonly toGroup = new THREE.Matrix4()
  private readonly local = new THREE.Matrix4()

  constructor(bodies: THREE.Object3D[]) {
    this.bodies = bodies
    this.group.name = 'office-cast-batch'
    const grouped = new Map<string, BatchEntry[]>()
    const source = new Map<string, THREE.Mesh>()
    let parts = 0

    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index]
      // Traversal order is a pure function of how the rig was built, so two
      // bodies contribute their parts in the same order and a batch's instance
      // list is stable and reproducible.
      body.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return
        const material = object.material
        // A part with a material array would need its own group table inside
        // the batch, and nothing in this cast has one. Leaving it visible is
        // the safe failure: it costs one draw and looks right.
        if (Array.isArray(material)) return
        parts += 1
        const chain: THREE.Object3D[] = [object]
        for (let node = object.parent; node && node !== body; node = node.parent) chain.push(node)
        const key = `${object.geometry.uuid}|${finishKey(object, material)}`
        const entry = { node: object, chain }
        const list = grouped.get(key)
        if (list) list.push(entry)
        else {
          grouped.set(key, [entry])
          source.set(key, object)
        }
      })
      // The parts are drawn from the batches now, but the hierarchy stays
      // exactly where it was: the mixer still poses it, the focus ring still
      // reads its world position, and the plan-view probe still measures the
      // real geometry. Hiding the root rather than each part is what makes the
      // renderer skip the whole subtree in one test.
      body.visible = false
    }

    for (const [key, entries] of grouped) {
      const template = source.get(key) as THREE.Mesh
      const material = (template.material as THREE.Material).clone() as THREE.MeshStandardMaterial
      // A copy with its colour neutralised, never a mutation of the shared
      // original: the cast's materials are cached across every character
      // surface in the game, and writing to one here would repaint the
      // portrait and the map crowd as well. The shader multiplies the instance
      // colour into the diffuse term, so white means each instance renders in
      // exactly the colour its own material carried while roughness, metalness
      // and the rest stay as the art authored them.
      material.color = new THREE.Color(0xffffff)
      // The scene's teardown skips anything the character cache owns. These
      // clones are this batch's own and have to be released with it.
      material.userData = { ...material.userData, characterShared: false }
      this.materials.push(material)

      const mesh = new THREE.InstancedMesh(template.geometry, material, entries.length)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.castShadow = template.castShadow
      mesh.receiveShadow = template.receiveShadow
      // A batch spans the whole floor and its parts move every frame, so a
      // bounding-sphere test would be both wrong and wasted work. The bodies
      // it replaces were submitted unconditionally for the same reason.
      mesh.frustumCulled = false
      // Characters are not furniture: the obstacle scan that paves the floor
      // must not find a whole cast's worth of geometry sitting on it.
      mesh.userData.navIgnore = true

      // Colour never changes after construction, so it is written once here
      // rather than alongside the matrices every frame.
      for (let index = 0; index < entries.length; index += 1) {
        mesh.setColorAt(index, (entries[index].node.material as THREE.MeshStandardMaterial).color)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

      this.batches.push({ entries, mesh })
      this.group.add(mesh)
    }

    this.batchCount = this.batches.length
    this.partCount = parts
    this.sync()
  }

  /** Copy the cast's current pose into the batches. */
  sync() {
    const bodies = this.bodies
    // Resolved once per body rather than once per part: a character is sixty
    // parts and the chain above it is the same chain for all of them.
    for (let index = 0; index < bodies.length; index += 1) bodies[index].updateWorldMatrix(true, true)
    this.group.updateWorldMatrix(true, false)
    this.toGroup.copy(this.group.matrixWorld).invert()
    for (const batch of this.batches) {
      const entries = batch.entries
      for (let index = 0; index < entries.length; index += 1) {
        const chain = entries[index].chain
        let shown = true
        for (let link = 0; link < chain.length; link += 1) {
          if (chain[link].visible) continue
          shown = false
          break
        }
        batch.mesh.setMatrixAt(
          index,
          shown ? this.local.multiplyMatrices(this.toGroup, entries[index].node.matrixWorld) : hidden,
        )
      }
      batch.mesh.instanceMatrix.needsUpdate = true
    }
  }

  dispose() {
    for (const batch of this.batches) batch.mesh.dispose()
    for (const material of this.materials) material.dispose()
    this.group.clear()
  }
}
