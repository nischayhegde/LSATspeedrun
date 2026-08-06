import * as THREE from 'three'

import type { StylizedCounselRig } from './stylized-counsel'

/**
 * Pedestrians for the districts.
 *
 * The obvious way to put people on the pavement is to call
 * `buildStylizedCounsel` a dozen times. That rig is 62 meshes — it is the
 * player's own counsel, seen from shoulder height, and every one of those
 * meshes is earned at that distance. Twelve of them is 744 extra draw calls
 * against a district that currently draws in 618, for figures that occupy
 * about forty pixels each. It would be the single most expensive thing on the
 * map by a wide margin.
 *
 * So the crowd reuses the rig without reusing the body. Each walker is the
 * same skeleton, with the same joint offsets and driven by the shared
 * `HumanoidActor` walk clip, but its joints carry empty proxy nodes rather
 * than meshes. Once a frame the proxies' world matrices are copied into two
 * InstancedMeshes — one capsule, one sphere — so the entire population of
 * every district costs two draw calls no matter how many people are in it.
 * Per-instance colour still gives each walker its own skin, hair and suit, and
 * because the matrices come from a real skeleton the limbs bend at the knee
 * and the arms swing on the same trailing lag the player's counsel uses.
 *
 * The proxy hierarchies are deliberately NOT parented into the scene graph.
 * They are updated by hand, which keeps them clear of the scene's static
 * batching and its matrix freeze, and means the only thing the renderer ever
 * sees of the crowd is the two batches.
 */

function hashUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123
  return value - Math.floor(value)
}

/** Which of the two batches an instance belongs to. */
type PartShape = 'capsule' | 'sphere'

type CrowdPart = {
  node: THREE.Object3D
  shape: PartShape
  color: THREE.Color
}

export type CrowdWalker = {
  root: THREE.Object3D
  rig: StylizedCounselRig
  seed: number
  parts: CrowdPart[]
}

/**
 * Joint offsets copied from `buildStylizedCounsel`. They have to match: the
 * walk clip's rotations are retargeted against these lengths, and a skeleton
 * with different proportions driven by the same curves walks like a different
 * animal. `hipsY` is the bind-pose hip height the foot solver reads.
 */
const HIPS_Y = 2.62
const KNEE_DROP = -1.09
const ANKLE_DROP = -1.12
const SHOULDER_Y = 1.43
const ELBOW_DROP = -.94
const NECK_Y = 1.68
const HEAD_Y = .58

const SKIN = [0xf6d2b8, 0xf2bda2, 0xe0a883, 0xd89473, 0xc48660, 0xb87556, 0x9c6248, 0x6f4632]
const HAIR = [0x1b1613, 0x2c2523, 0x3a2925, 0x5b3a2a, 0x7a4a30, 0x9c7645, 0xab8f5c, 0x8b8b8d]
/**
 * Ordinary people in the street, not more lawyers. The counsel palette is six
 * shades of the same navy on purpose; a pavement painted in it reads as a
 * conference rather than as a city.
 */
const COAT = [
  0x5a6b81, 0x836350, 0x47695f, 0x93765b, 0x625d80, 0xa47f68,
  0x4e7181, 0x855e66, 0x69735a, 0x435469, 0x958a70, 0x765269,
]
const LEG = [0x50505a, 0x685e50, 0x434c5a, 0x756855, 0x585261, 0x3e444e]

function proxy(parent: THREE.Object3D, position: [number, number, number]) {
  const node = new THREE.Object3D()
  node.position.set(...position)
  parent.add(node)
  return node
}

/**
 * A part is a proxy whose local transform IS the instance transform, so the
 * capsule/sphere unit primitives are stretched into limbs here rather than by
 * baking a geometry per body part.
 */
function part(
  parts: CrowdPart[],
  parent: THREE.Object3D,
  shape: PartShape,
  color: THREE.Color,
  position: [number, number, number],
  scale: [number, number, number],
) {
  const node = new THREE.Object3D()
  node.position.set(...position)
  node.scale.set(...scale)
  parent.add(node)
  parts.push({ node, shape, color })
  return node
}

export function buildCrowdWalker(seed: number): CrowdWalker {
  const skin = new THREE.Color(SKIN[Math.floor(hashUnit(seed * 1.7) * SKIN.length) % SKIN.length])
  const hair = new THREE.Color(HAIR[Math.floor(hashUnit(seed * 2.9) * HAIR.length) % HAIR.length])
  const coat = new THREE.Color(COAT[Math.floor(hashUnit(seed * 4.1) * COAT.length) % COAT.length])
  const leg = new THREE.Color(LEG[Math.floor(hashUnit(seed * 5.3) * LEG.length) % LEG.length])
  const shoe = new THREE.Color(0x1f1c1b)
  // Build differs from height, which the crowd applies as a root scale. This
  // is the axis that makes two same-height walkers read as different people.
  const build = .88 + hashUnit(seed * 6.7) * .3
  const shoulderX = .58 + hashUnit(seed * 7.9) * .14
  const carries = hashUnit(seed * 9.1) < .42

  const parts: CrowdPart[] = []
  const root = new THREE.Group()
  const hips = new THREE.Group()
  hips.position.y = HIPS_Y
  root.add(hips)
  part(parts, hips, 'capsule', leg, [0, -.06, 0], [.52 * build, .30, .40 * build])

  const makeLeg = (side: -1 | 1) => {
    const hip = proxy(hips, [side * .275, -.08, 0])
    part(parts, hip, 'capsule', leg, [0, -.57, 0], [.26, .68, .26])
    const knee = proxy(hip, [0, KNEE_DROP, 0])
    part(parts, knee, 'capsule', leg, [0, -.54, 0], [.245, .66, .245])
    const foot = proxy(knee, [0, ANKLE_DROP, .04])
    part(parts, foot, 'capsule', shoe, [0, -.05, .13], [.24, .13, .38])
    return { hip, knee, foot }
  }
  const leftLeg = makeLeg(-1)
  const rightLeg = makeLeg(1)

  const spine = new THREE.Group()
  hips.add(spine)
  const chest = new THREE.Group()
  spine.add(chest)
  part(parts, chest, 'capsule', coat, [0, .86, 0], [.60 * build, .82, .42 * build])

  const makeArm = (side: -1 | 1) => {
    const shoulder = proxy(chest, [side * shoulderX, SHOULDER_Y, 0])
    part(parts, shoulder, 'capsule', coat, [0, -.45, 0], [.19, .50, .18])
    const elbow = proxy(shoulder, [0, ELBOW_DROP, 0])
    part(parts, elbow, 'capsule', coat, [0, -.45, 0], [.165, .52, .16])
    const hand = proxy(elbow, [0, -.98, 0])
    part(parts, hand, 'sphere', skin, [0, 0, 0], [.16, .18, .14])
    const thumb = proxy(hand, [side * .1, -.05, .05])
    return { shoulder, elbow, hand, thumb }
  }
  const leftArm = makeArm(-1)
  const rightArm = makeArm(1)
  const leftShoulderZ = .035
  const rightShoulderZ = -.035
  const leftElbowZ = .025
  const rightElbowZ = -.025
  leftArm.shoulder.rotation.z = leftShoulderZ
  rightArm.shoulder.rotation.z = rightShoulderZ
  leftArm.elbow.rotation.z = leftElbowZ
  rightArm.elbow.rotation.z = rightElbowZ

  const neck = proxy(chest, [0, NECK_Y, 0])
  part(parts, neck, 'capsule', skin, [0, .12, 0], [.14, .18, .12])
  const head = new THREE.Group()
  head.position.set(0, HEAD_Y, .015)
  neck.add(head)
  part(parts, head, 'sphere', skin, [0, 0, 0], [.46, .53, .41])
  // One squashed sphere set back and up off the crown. At the distances a
  // pedestrian is read at, hair is a silhouette and a colour, and this is both.
  part(parts, head, 'sphere', hair, [0, .1, -.07], [.48, .46, .44])

  const satchel = new THREE.Group()
  satchel.position.set(.68, .30, .25)
  chest.add(satchel)
  if (carries) part(parts, satchel, 'capsule', new THREE.Color(0x4a3a2e), [0, 0, 0], [.28, .34, .16])

  const eyes = [new THREE.Group(), new THREE.Group()]
  eyes.forEach((eye) => head.add(eye))

  const rig: StylizedCounselRig = {
    root,
    hips,
    spine,
    chest,
    head,
    leftShoulder: leftArm.shoulder as THREE.Group,
    rightShoulder: rightArm.shoulder as THREE.Group,
    leftElbow: leftArm.elbow as THREE.Group,
    rightElbow: rightArm.elbow as THREE.Group,
    leftHip: leftLeg.hip as THREE.Group,
    rightHip: rightLeg.hip as THREE.Group,
    leftKnee: leftLeg.knee as THREE.Group,
    rightKnee: rightLeg.knee as THREE.Group,
    leftFoot: leftLeg.foot as THREE.Group,
    rightFoot: rightLeg.foot as THREE.Group,
    leftHand: leftArm.hand as THREE.Group,
    rightHand: rightArm.hand as THREE.Group,
    leftThumb: leftArm.thumb,
    rightThumb: rightArm.thumb,
    satchel,
    eyes,
    pupils: [],
    base: { hipsY: HIPS_Y, leftShoulderZ, rightShoulderZ, leftElbowZ, rightElbowZ },
  }
  return { root, rig, seed, parts }
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0)

/**
 * Draws a whole crowd in two calls.
 *
 * The renderer owns nothing about how walkers move; it reads whatever the
 * `Crowd` simulation has already put on their roots. That split is what lets
 * the simulation stay in `map-agents.ts` alongside the traffic it shares its
 * spawning discipline with, while the cost control lives here.
 */
export class CrowdRenderer {
  readonly group = new THREE.Group()
  private readonly walkers: CrowdWalker[]
  private readonly capsules: THREE.InstancedMesh
  private readonly spheres: THREE.InstancedMesh
  private readonly capsuleParts: CrowdPart[][] = []
  private readonly sphereParts: CrowdPart[][] = []

  constructor(walkers: CrowdWalker[]) {
    this.walkers = walkers
    let capsuleCount = 0
    let sphereCount = 0
    for (const walker of walkers) {
      const capsuleGroup: CrowdPart[] = []
      const sphereGroup: CrowdPart[] = []
      for (const item of walker.parts) {
        if (item.shape === 'capsule') capsuleGroup.push(item)
        else sphereGroup.push(item)
      }
      this.capsuleParts.push(capsuleGroup)
      this.sphereParts.push(sphereGroup)
      capsuleCount += capsuleGroup.length
      sphereCount += sphereGroup.length
    }

    // Deliberately coarse primitives. A limb is a handful of pixels wide; the
    // segment counts here are what keep a hundred-and-fifty instance crowd
    // under fifteen thousand triangles.
    const capsuleGeometry = new THREE.CapsuleGeometry(.5, 1, 2, 8)
    const sphereGeometry = new THREE.SphereGeometry(.5, 10, 7)
    const skinMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: .82,
      metalness: .02,
      // The districts light for architecture, not for faces, and a pedestrian
      // is a forty-pixel figure standing in the shadow of a four-storey
      // terrace. Without a floor under it the crowd reads as a row of black
      // marks on the pavement rather than as people.
      emissive: 0x4a423a,
      emissiveIntensity: .62,
    })

    this.capsules = new THREE.InstancedMesh(capsuleGeometry, skinMaterial, Math.max(1, capsuleCount))
    this.spheres = new THREE.InstancedMesh(sphereGeometry, skinMaterial, Math.max(1, sphereCount))
    for (const batch of [this.capsules, this.spheres]) {
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      batch.castShadow = false
      batch.receiveShadow = false
      // The crowd is spread over the whole district and its bounds change every
      // frame, so a per-frame bounding-sphere test would be both wrong and
      // wasted work. The two batches are always submitted.
      batch.frustumCulled = false
      this.group.add(batch)
    }

    // Colour never changes after construction, so it is written once here
    // rather than alongside the matrices every frame.
    let capsuleIndex = 0
    let sphereIndex = 0
    for (let walker = 0; walker < walkers.length; walker += 1) {
      for (const item of this.capsuleParts[walker]) this.capsules.setColorAt(capsuleIndex++, item.color)
      for (const item of this.sphereParts[walker]) this.spheres.setColorAt(sphereIndex++, item.color)
    }
    if (this.capsules.instanceColor) this.capsules.instanceColor.needsUpdate = true
    if (this.spheres.instanceColor) this.spheres.instanceColor.needsUpdate = true
    this.sync()
  }

  /** Copy the skeletons' current pose into the two batches. */
  sync() {
    let capsuleIndex = 0
    let sphereIndex = 0
    for (let index = 0; index < this.walkers.length; index += 1) {
      const walker = this.walkers[index]
      const visible = walker.root.visible
      if (visible) walker.root.updateMatrixWorld(true)
      for (const item of this.capsuleParts[index]) {
        this.capsules.setMatrixAt(capsuleIndex++, visible ? item.node.matrixWorld : hidden)
      }
      for (const item of this.sphereParts[index]) {
        this.spheres.setMatrixAt(sphereIndex++, visible ? item.node.matrixWorld : hidden)
      }
    }
    this.capsules.instanceMatrix.needsUpdate = true
    this.spheres.instanceMatrix.needsUpdate = true
  }

  dispose() {
    for (const batch of [this.capsules, this.spheres]) {
      batch.geometry.dispose()
      batch.dispose()
    }
    // One material backs both batches, so it is disposed once.
    ;(this.capsules.material as THREE.Material).dispose()
  }
}
