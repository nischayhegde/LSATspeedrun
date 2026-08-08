import * as THREE from 'three'

import { buildStylizedCounsel, type StylizedCounselRig } from './stylized-counsel'
import type { CharacterGender } from '../types'

/**
 * Pedestrians for the districts — the same characters the rest of the game is
 * cast from, drawn at a price a crowd can afford.
 *
 * ## What this replaced, and why the old reasoning no longer holds
 *
 * This file used to build a *proxy*: the counsel's skeleton with empty nodes
 * where its meshes should be, posed by the shared `HumanoidActor` clips and
 * harvested into two `InstancedMesh` batches of capsules and spheres. Its
 * argument was that `buildStylizedCounsel` is 62 meshes, so twelve of them
 * would be 744 draw calls against a district that draws in 618 — the single
 * most expensive thing on the map.
 *
 * That arithmetic was right, and its conclusion — batch the crowd — was right.
 * What it got wrong was the *unit*: it batched two primitives that a body was
 * then approximated out of, when it could have batched the body's own parts.
 *
 * An `InstancedMesh` needs one geometry and one material, and per-instance
 * colour rides on `instanceColor`. So the thing that has to be shared between
 * two people is not a shape, it is a **geometry paired with a material
 * finish** — roughness and metalness, not colour. `buildStylizedCounsel`
 * already caches its geometry per render scale, so two pedestrians in
 * different clothes with different builds are, to a batcher, the same handful
 * of parts in different colours at different transforms.
 *
 * Measured over 24 decorrelated seeds (`.maps/charcost.mjs`), a body at map
 * scale is 30-33 such pairs, and the set across the whole cast saturates at
 * **48**. Not 48 per person — 48 for any crowd of any size, because the 25th
 * body introduces no pair the first 24 did not already have. Against 954 draw
 * calls for eighteen hand-parented bodies, and 2 for the capsule proxy, that
 * is a price a district can pay for real people.
 *
 * Batching by the exact material instead, and keeping the authored colours,
 * was measured as the simpler alternative and rejected: it costs 142 calls for
 * the Old Quarter and 121 for a crowd of nine, so it grows with the population
 * rather than saturating.
 *
 * ## The other half: what a body costs in triangles
 *
 * Batching fixes draw calls and does nothing for triangles, and eighteen
 * portrait-detail bodies is 167k of them. The fix belongs in the art rather
 * than here: `stylized-counsel.ts` grew a `.25` rung, cut against the measured
 * size of a pedestrian at the tightest zoom the camera allows rather than
 * against a guess. A map body is **6,514 triangles against the portrait's
 * 16,596** — 117k for the Old Quarter's eighteen — and no surface above that
 * rung is touched: the office quantises to `.5` and the portrait to `1`, both
 * byte-identical to before.
 *
 * ## What is unchanged, deliberately
 *
 * The proxy's central trick was right and is kept exactly: **the skeletons are
 * never parented into the scene graph.** They are updated by hand, which keeps
 * them clear of the scene's static batching and its matrix freeze, and means
 * the only thing the renderer sees of the crowd is the batches. `Crowd` in
 * `map-agents.ts` needed no change at all — it asks for `{ root, rig, seed }`
 * and a real rig satisfies that as well as a proxy did.
 */

function hashUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123
  return value - Math.floor(value)
}

/**
 * The scale the caller will draw these at. It has to be passed *into* the build
 * as well as applied to the root: it is what selects the map detail rung, and
 * a body built at portrait detail and then shrunk costs three and a half times
 * as much for pixels nobody can see.
 *
 * The crowd multiplies this by a per-walker height of .93-1.09, which
 * `setRenderScale` quantises back onto the same rung, so every pedestrian
 * shares one set of geometry however tall they are.
 */
export const CROWD_RENDER_SCALE = .278

export type CrowdWalker = {
  root: THREE.Object3D
  rig: StylizedCounselRig
  seed: number
}

/**
 * One pedestrian, deterministic in its seed.
 *
 * Everything that makes this person look like themselves — skin, hair colour
 * and cut, clothing, height, build, face proportions, stance, what they carry
 * — is derived inside `buildStylizedCounsel` from `paletteSeed` through
 * independently salted hashes, so the traits are decorrelated rather than all
 * turning over together. Nothing here needs to re-roll any of it; the seed is
 * the whole description of the person, and the same seed is the same person on
 * every frame and across a remount.
 *
 * `paletteSeed` is scaled to an integer because the salted hash is integer
 * arithmetic: the caller's seeds are 3.7, 11.01, 18.32..., which truncate to
 * three distinct people out of the first four.
 */
export function buildCrowdWalker(seed: number): CrowdWalker {
  // Drawn from its own hash rather than from `paletteSeed`, so gender does not
  // ride along with the wardrobe the way an unsalted lookup would make it.
  const gender: CharacterGender = hashUnit(seed * 3.17) < .5 ? 'female' : 'male'
  const rig = buildStylizedCounsel(gender, 0, {
    // Not `counsel`: the counsel palette is six shades of the same navy, and a
    // pavement painted in it reads as a conference rather than as a city. The
    // visitor palette is the eight-way one the office dresses its clients from.
    role: 'visitor',
    paletteSeed: Math.abs(Math.round(seed * 1000)),
    renderScale: CROWD_RENDER_SCALE,
    // Never the signed-in player's wardrobe, whoever is walking past.
    cosmetics: null,
  })
  return { root: rig.root, rig, seed }
}

/**
 * Which instances can share one batch.
 *
 * Colour is deliberately absent: it is carried per instance, and folding it in
 * here is exactly what shatters a crowd into a hundred batches. Everything
 * that genuinely has to be one value for a whole draw call is present.
 */
function finishKey(material: THREE.Material) {
  const standard = material as THREE.MeshStandardMaterial
  return [
    material.type,
    standard.roughness?.toFixed(3) ?? '',
    standard.metalness?.toFixed(3) ?? '',
    material.transparent ? `t${material.opacity.toFixed(3)}` : '',
    material.side,
  ].join('|')
}

type BatchEntry = {
  /** The part in a walker's own skeleton, whose world matrix is the instance. */
  node: THREE.Mesh
  /** Index into `walkers`, so a hidden walker hides all of its parts. */
  walker: number
}

type Batch = {
  entries: BatchEntry[]
  mesh: THREE.InstancedMesh
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0)

/**
 * Draws a whole crowd of real bodies in a fixed number of calls.
 *
 * The renderer owns nothing about how walkers move; it reads whatever the
 * `Crowd` simulation has already put on their roots. That split is what lets
 * the simulation stay in `map-agents.ts` alongside the traffic it shares its
 * spawning discipline with, while the cost control lives here.
 */
export class CrowdRenderer {
  readonly group = new THREE.Group()
  /** For a harness: how many draw calls the crowd actually costs. */
  readonly batchCount: number
  private readonly walkers: CrowdWalker[]
  private readonly batches: Batch[] = []
  private readonly materials: THREE.Material[] = []

  constructor(walkers: CrowdWalker[]) {
    this.walkers = walkers
    const grouped = new Map<string, BatchEntry[]>()
    const sourceMaterial = new Map<string, THREE.Material>()

    for (let index = 0; index < walkers.length; index += 1) {
      // Traversal order is a pure function of how the rig was built, so two
      // bodies contribute their parts in the same order and a batch's instance
      // list stays in a stable, reproducible order.
      walkers[index].root.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return
        const material = object.material as THREE.Material
        const key = `${object.geometry.uuid}|${finishKey(material)}`
        let list = grouped.get(key)
        if (!list) {
          list = []
          grouped.set(key, list)
          sourceMaterial.set(key, material)
        }
        list.push({ node: object, walker: index })
      })
    }

    for (const [key, entries] of grouped) {
      const source = sourceMaterial.get(key) as THREE.MeshStandardMaterial
      // A copy of the real material with its colour neutralised, because the
      // shader multiplies the instance colour into the diffuse term. White here
      // means each instance renders in exactly the colour its own material
      // carried, while roughness, metalness and every other property stay as
      // the art authored them.
      const material = source.clone()
      material.color = new THREE.Color(0xffffff)
      this.materials.push(material)

      const mesh = new THREE.InstancedMesh(entries[0].node.geometry, material, entries.length)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      // Matching the proxy crowd this replaces. Eighteen bodies in thirty-odd
      // batches would otherwise be drawn a second time into the shadow map, for
      // contact shadows on figures whose feet are a couple of pixels across.
      mesh.castShadow = false
      mesh.receiveShadow = false
      // The crowd is spread over the whole district and its bounds change every
      // frame, so a per-frame bounding-sphere test would be both wrong and
      // wasted work. The batches are always submitted.
      mesh.frustumCulled = false

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
    this.sync()
  }

  /** Copy the skeletons' current pose into the batches. */
  sync() {
    const walkers = this.walkers
    // Hoisted out of the per-part loop: a body is twenty-odd parts and the
    // world matrix of the whole skeleton only has to be resolved once.
    for (let index = 0; index < walkers.length; index += 1) {
      if (walkers[index].root.visible) walkers[index].root.updateMatrixWorld(true)
    }
    for (const batch of this.batches) {
      const entries = batch.entries
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        const visible = walkers[entry.walker].root.visible
        batch.mesh.setMatrixAt(index, visible ? entry.node.matrixWorld : hidden)
      }
      batch.mesh.instanceMatrix.needsUpdate = true
    }
  }

  dispose() {
    for (const batch of this.batches) {
      // The geometry belongs to `stylized-counsel`'s shared cache and is reused
      // by the next region and by every other character surface, which is the
      // same contract `userData.characterShared` states for the scene's own
      // teardown pass. Only what this class created is released.
      batch.mesh.dispose()
    }
    for (const material of this.materials) material.dispose()
  }
}
