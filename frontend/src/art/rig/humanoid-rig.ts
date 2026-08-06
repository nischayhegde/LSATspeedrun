import * as THREE from 'three'

/**
 * A humanoid skeleton definition layered over the app's existing stylized
 * characters.
 *
 * The art does not change. `buildStylizedCounsel` already produces a valid
 * joint hierarchy - nested `THREE.Group`s with the rigid stylized parts
 * parented under them - and this module reinterprets that hierarchy as a
 * standard humanoid skeleton so it can be driven by retargeted animation
 * clips through `THREE.AnimationMixer` instead of hand-written per-frame
 * joint math. Segmented rigid-part characters bind to a skeleton perfectly
 * well; smooth vertex skinning is not a prerequisite for fluid motion, and
 * avoiding it is what keeps the existing silhouette pixel-identical.
 */

/** The canonical humanoid joints this system drives. */
export type HumanoidBone =
  | 'hips' | 'spine' | 'chest' | 'head'
  | 'leftShoulder' | 'leftElbow' | 'leftHand'
  | 'rightShoulder' | 'rightElbow' | 'rightHand'
  | 'leftHip' | 'leftKnee' | 'leftFoot'
  | 'rightHip' | 'rightKnee' | 'rightFoot'

export const HUMANOID_BONES: readonly HumanoidBone[] = [
  'hips', 'spine', 'chest', 'head',
  'leftShoulder', 'leftElbow', 'leftHand',
  'rightShoulder', 'rightElbow', 'rightHand',
  'leftHip', 'leftKnee', 'leftFoot',
  'rightHip', 'rightKnee', 'rightFoot',
]

/**
 * Track-binding names, deliberately using the Mixamo/glTF humanoid convention
 * rather than this app's internal field names.
 *
 * Two reasons. `AnimationMixer` resolves a track like `"LeftForeArm.quaternion"`
 * by object name, so every actor must name its joints identically for a single
 * shared clip to bind to all of them - that clip sharing is what keeps the
 * memory cost flat as actor count grows. And using the industry-standard names
 * means a real humanoid glTF clip, if we ever license one, retargets onto this
 * skeleton through a name map alone rather than a rewrite.
 */
export const HUMANOID_NODE_NAMES: Record<HumanoidBone, string> = {
  hips: 'Hips',
  spine: 'Spine',
  chest: 'Spine2',
  head: 'Head',
  leftShoulder: 'LeftArm',
  leftElbow: 'LeftForeArm',
  leftHand: 'LeftHand',
  rightShoulder: 'RightArm',
  rightElbow: 'RightForeArm',
  rightHand: 'RightHand',
  leftHip: 'LeftUpLeg',
  leftKnee: 'LeftLeg',
  leftFoot: 'LeftFoot',
  rightHip: 'RightUpLeg',
  rightKnee: 'RightLeg',
  rightFoot: 'RightFoot',
}

/**
 * Measured proportions of one bound skeleton, in that skeleton's own units.
 *
 * Retargeting a humanoid clip authored for standard proportions onto a
 * stylized character is the hard part of this whole system: the stylized cast
 * has a larger head, shorter limbs and different hip/shoulder spacing than the
 * clips assume. Rotations transfer directly, but anything expressed as a
 * distance - stride length, hip rise and fall, how far a hand reaches - has to
 * be scaled by these measurements or the feet slide and the hands miss.
 */
export type HumanoidProportions = {
  /** Rest height of the hip joint above the character's ground plane. */
  hipHeight: number
  thighLength: number
  shinLength: number
  /**
   * Height of the ankle joint above the sole of the shoe, in the character's
   * own units. This is deliberately measured from the foot geometry rather
   * than from the ankle's position in root space: it is the lever between the
   * lowest joint the solver can move and the floor the shoe has to touch, and
   * it must not vary with where the pelvis happens to sit.
   */
  ankleHeight: number
  /** Ankle joint to the ball of the foot. Sets how far the ankle rises as the
   *  heel lifts. */
  toeLength: number
  /**
   * Signed height of the bind pose's soles above the rig root's origin, in the
   * character's own units.
   *
   * Every consumer of this system places a character by putting its root on
   * the floor, and therefore assumes the soles are at the root's origin. They
   * are not: this rig hangs fixed-length legs off a pelvis whose height varies
   * per seed, so the soles float a fifth of a unit above the origin by an
   * amount that differs for every character. `HumanoidActor` subtracts this
   * from the pelvis so that the assumption becomes true.
   */
  soleOffset: number
  /**
   * The rectangle of shoe that has to stay on top of the floor, expressed in
   * the ankle joint's own frame and in the character's units.
   *
   * `ankleHeight` alone describes a foot as a single point directly under the
   * ankle, which is only the whole truth while the sole is level. Pitch the
   * foot and the part of it nearest the ground is a corner of this rectangle,
   * not the point below the joint, so a solver that only knows `ankleHeight`
   * will happily bury a toe cap. These extents let the floor be enforced
   * against the shoe that is actually there.
   */
  sole: {
    /** Ankle joint down to the sole. Same quantity as `ankleHeight`. */
    depth: number
    /** Ankle joint forward to the toe cap. */
    toe: number
    /** Ankle joint back to the heel. */
    heel: number
    /** Half the width of the sole. */
    halfWidth: number
  }
  upperArmLength: number
  forearmLength: number
  shoulderWidth: number
  hipWidth: number
  /** Full leg reach, hip joint to ankle. Used to clamp IK targets. */
  legLength: number
}

export type HumanoidSkeleton = {
  root: THREE.Object3D
  bones: Record<HumanoidBone, THREE.Object3D>
  proportions: HumanoidProportions
  /**
   * Per-bone cosmetic rest offsets that the shared clips do not encode.
   *
   * The stylized rig ships small authored tilts (an open shoulder stance, a
   * slight head tilt that differs by gender, a knee that is not perfectly
   * square). Baking those into the clips would either force one clip set per
   * variant or quietly flatten the character's authored posture. Instead the
   * clips animate a canonical rest pose and these deltas are re-applied after
   * the mixer writes, so the shared clip library stays shared and every
   * character keeps the exact resting posture the art defines.
   */
  restOffsets: Array<{ bone: THREE.Object3D; offset: THREE.Quaternion }>
}

/**
 * The canonical rest pose the shared clip library is authored against.
 *
 * These are the resting joint rotations `buildStylizedCounsel` applies today.
 * Clips are baked as absolute local quaternions relative to this pose, which
 * is what lets one clip drive every actor.
 */
const CANONICAL_REST: Partial<Record<HumanoidBone, THREE.Euler>> = {
  leftShoulder: new THREE.Euler(0, 0, .035),
  rightShoulder: new THREE.Euler(0, 0, -.035),
  leftElbow: new THREE.Euler(0, 0, .025),
  rightElbow: new THREE.Euler(0, 0, -.025),
  leftHip: new THREE.Euler(0, 0, -.025),
  rightHip: new THREE.Euler(0, 0, .025),
  rightKnee: new THREE.Euler(0, 0, -.012),
}

export function canonicalRestQuaternion(bone: HumanoidBone) {
  const euler = CANONICAL_REST[bone]
  return euler ? new THREE.Quaternion().setFromEuler(euler) : new THREE.Quaternion()
}

/**
 * Anatomical joint limits, in radians, in each joint's local frame.
 *
 * A pose that reaches somewhere a real spine or elbow cannot go reads as wrong
 * even when the motion between poses is smooth, and it is the failure mode
 * retargeting produces most often: a clip authored for long arms, replayed on
 * short stylized ones, folds the forearm through the jacket. Clamping is the
 * cheap guard that keeps a retargeting error looking merely stiff rather than
 * broken.
 */
const JOINT_LIMITS: Partial<Record<HumanoidBone, { x?: [number, number]; y?: [number, number]; z?: [number, number] }>> = {
  // The lumbar spine flexes far more than it extends, and rotates very little.
  spine: { x: [-.30, .62], y: [-.42, .42], z: [-.28, .28] },
  chest: { x: [-.22, .38], y: [-.34, .34], z: [-.24, .24] },
  // Cervical range, kept just short of the true anatomical extreme.
  head: { x: [-.62, .70], y: [-1.20, 1.20], z: [-.42, .42] },
  // The elbow is a hinge. In this rig the forearm folds forward on negative X
  // and curls up and inward on Z, mirrored per side, and it must never
  // hyperextend past straight in either channel.
  leftElbow: { x: [-2.55, .10], y: [-.35, .35], z: [-2.60, .20] },
  rightElbow: { x: [-2.55, .10], y: [-.35, .35], z: [-.20, 2.60] },
  // The knee likewise only flexes, and only backwards.
  leftKnee: { x: [-.02, 2.35], y: [-.12, .12], z: [-.14, .14] },
  rightKnee: { x: [-.02, 2.35], y: [-.12, .12], z: [-.14, .14] },
  leftFoot: { x: [-.62, .52], y: [-.35, .35], z: [-.22, .22] },
  rightFoot: { x: [-.62, .52], y: [-.35, .35], z: [-.22, .22] },
  leftHip: { x: [-.95, 1.95], y: [-.45, .45], z: [-.50, .40] },
  rightHip: { x: [-.95, 1.95], y: [-.45, .45], z: [-.40, .50] },
}

const clampEuler = new THREE.Euler()

/** Clamps one joint into its anatomical range, in place. */
export function clampJoint(bone: HumanoidBone, quaternion: THREE.Quaternion) {
  const limit = JOINT_LIMITS[bone]
  if (!limit) return quaternion
  clampEuler.setFromQuaternion(quaternion, 'XYZ')
  let changed = false
  if (limit.x) {
    const clamped = THREE.MathUtils.clamp(clampEuler.x, limit.x[0], limit.x[1])
    if (clamped !== clampEuler.x) { clampEuler.x = clamped; changed = true }
  }
  if (limit.y) {
    const clamped = THREE.MathUtils.clamp(clampEuler.y, limit.y[0], limit.y[1])
    if (clamped !== clampEuler.y) { clampEuler.y = clamped; changed = true }
  }
  if (limit.z) {
    const clamped = THREE.MathUtils.clamp(clampEuler.z, limit.z[0], limit.z[1])
    if (clamped !== clampEuler.z) { clampEuler.z = clamped; changed = true }
  }
  if (changed) quaternion.setFromEuler(clampEuler)
  return quaternion
}

/**
 * The subset of a stylized rig this system needs. Declared structurally rather
 * than importing `StylizedCounselRig` so that any rig exposing the same joints
 * - the office rigs, the portrait rigs, a future map pedestrian - can bind
 * without this module taking a dependency on files other agents own.
 */
export type BindableRig = {
  root: THREE.Object3D
  hips: THREE.Object3D
  spine: THREE.Object3D
  chest: THREE.Object3D
  head: THREE.Object3D
  leftShoulder: THREE.Object3D
  rightShoulder: THREE.Object3D
  leftElbow: THREE.Object3D
  rightElbow: THREE.Object3D
  leftHand: THREE.Object3D
  rightHand: THREE.Object3D
  leftHip: THREE.Object3D
  rightHip: THREE.Object3D
  leftKnee: THREE.Object3D
  rightKnee: THREE.Object3D
  leftFoot: THREE.Object3D
  rightFoot: THREE.Object3D
}

/**
 * Reinterprets an existing stylized rig as a humanoid skeleton.
 *
 * Nothing about the rig's geometry, materials or hierarchy is modified. The
 * joints are named for track binding, their authored rest pose is measured so
 * it can be preserved, and the character's real proportions are read off the
 * bind pose so clips can be retargeted against them.
 */
export function bindHumanoidSkeleton(rig: BindableRig): HumanoidSkeleton {
  const bones = {
    hips: rig.hips,
    spine: rig.spine,
    chest: rig.chest,
    head: rig.head,
    leftShoulder: rig.leftShoulder,
    leftElbow: rig.leftElbow,
    leftHand: rig.leftHand,
    rightShoulder: rig.rightShoulder,
    rightElbow: rig.rightElbow,
    rightHand: rig.rightHand,
    leftHip: rig.leftHip,
    leftKnee: rig.leftKnee,
    leftFoot: rig.leftFoot,
    rightHip: rig.rightHip,
    rightKnee: rig.rightKnee,
    rightFoot: rig.rightFoot,
  } satisfies Record<HumanoidBone, THREE.Object3D>

  const restOffsets: HumanoidSkeleton['restOffsets'] = []
  for (const bone of HUMANOID_BONES) {
    const node = bones[bone]
    node.name = HUMANOID_NODE_NAMES[bone]
    // offset = authoredRest * inverse(canonicalRest). Applying this after the
    // mixer restores each character's own resting posture on top of whatever
    // the shared clip asked for.
    const offset = node.quaternion.clone().multiply(canonicalRestQuaternion(bone).invert())
    // Skip identity offsets so the per-frame pass only touches joints that
    // actually differ from canonical.
    if (1 - Math.abs(offset.w) > 1e-6) restOffsets.push({ bone: node, offset })
  }

  // Limb lengths are measured between joints in the bind pose rather than read
  // off each joint's local position.
  //
  // The two are not the same here, and assuming they were is a subtle trap:
  // this rig squashes each leg with a 0.97 vertical scale on the hip joint, so
  // the thigh's local offset says 1.09 while the distance the leg actually
  // spans is 1.06. Three percent sounds ignorable but it is a systematic
  // error, and a foot-planting solver built on a wrong leg length holds every
  // "planted" foot a visible distance off the floor.
  rig.root.updateMatrixWorld(true)
  const toHips = new THREE.Matrix4().copy(rig.hips.matrixWorld).invert()
  const inHips = (node: THREE.Object3D) =>
    new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(toHips)
  const hipPoint = inHips(rig.leftHip)
  const kneePoint = inHips(rig.leftKnee)
  const footPoint = inHips(rig.leftFoot)
  const thighLength = hipPoint.distanceTo(kneePoint)
  const shinLength = kneePoint.distanceTo(footPoint)
  const hipHeight = rig.hips.position.y

  // Where is the floor, and how tall is the shoe?
  //
  // Both questions have the same wrong answer available and the same right
  // one. The wrong answer is to read the ankle's Y in root space and call that
  // the height of the ankle above the ground, which is only true if the rig is
  // authored with its soles exactly at the root origin. This rig is not:
  // `buildStylizedCounsel` varies a character's height by moving the pelvis up
  // or down by up to 0.056 units while the leg segments stay a fixed length,
  // so the bind pose's soles sit roughly 0.21 units above the origin, by a
  // different amount for every seed. The solver dutifully held every planted
  // foot that far off the ground - about 9cm at office scale, differing per
  // character, so two people standing side by side hovered at visibly
  // different heights.
  //
  // The second trap is subtler. The bind pose is a contrapposto stance: one
  // knee is bent by 0.135rad and which knee it is depends on the seed. That
  // pitches the foot on that side, and an axis-aligned box around a pitched
  // shoe is taller than the shoe. Measured naively, `ankleHeight` came out as
  // one of two values 29% apart depending on nothing but seed parity.
  //
  // So the measurement is taken with the leg chain temporarily straightened.
  // A rest rotation is part of a character's *pose*; where its floor is, and
  // how thick its sole is, are properties of its *skeleton*, and must not move
  // when the pose does. Rigs whose feet carry no geometry - the map's proxy
  // crowd rigs - have nothing to measure and keep the old estimate.
  const legChain = [
    rig.leftHip, rig.leftKnee, rig.leftFoot,
    rig.rightHip, rig.rightKnee, rig.rightFoot,
  ]
  const posedLeg = legChain.map((node) => node.quaternion.clone())
  legChain.forEach((node) => node.quaternion.identity())
  rig.root.updateMatrixWorld(true)

  const toRoot = new THREE.Matrix4().copy(rig.root.matrixWorld).invert()
  const ankleNeutral = new THREE.Vector3()
    .setFromMatrixPosition(rig.leftFoot.matrixWorld)
    .applyMatrix4(toRoot)
  const footBox = new THREE.Box3().setFromObject(rig.leftFoot)
  const hasShoe = !footBox.isEmpty()
  if (hasShoe) footBox.applyMatrix4(toRoot)
  const ankleHeight = Math.max(.01, hasShoe ? ankleNeutral.y - footBox.min.y : ankleNeutral.y)
  // Lever arm for the roll onto the ball of the foot during push-off, taken
  // from where the shoe actually ends. The ball sits about seven tenths of the
  // way from the ankle to the toe cap.
  const toeLength = hasShoe
    ? Math.max(.01, Math.abs(footBox.max.z - ankleNeutral.z) * .7)
    : ankleHeight * .75
  const soleOffset = hasShoe ? footBox.min.y : 0

  // The same shoe again, this time in the ankle's own frame, so the floor can
  // be enforced against its corners once the foot is pitched. Measured
  // per-mesh rather than by re-boxing the root-space box: an axis-aligned box
  // rotated into another frame and re-boxed grows, and this one is used to
  // decide how far a toe is buried.
  const soleBox = new THREE.Box3()
  if (hasShoe) {
    const toFoot = new THREE.Matrix4().copy(rig.leftFoot.matrixWorld).invert()
    const meshMatrix = new THREE.Matrix4()
    const meshBox = new THREE.Box3()
    rig.leftFoot.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const bounds = mesh.geometry.boundingBox
      if (!bounds) return
      meshMatrix.multiplyMatrices(toFoot, mesh.matrixWorld)
      meshBox.copy(bounds).applyMatrix4(meshMatrix)
      soleBox.union(meshBox)
    })
  }
  // Foot-local units are not root units - this rig squashes each leg with a
  // 0.97 scale at the hip - so convert before storing alongside the other
  // root-space measurements.
  const footBasis = rig.leftFoot.matrixWorld.elements
  const rootBasis = rig.root.matrixWorld.elements
  const footToRootScale = (Math.hypot(footBasis[0], footBasis[1], footBasis[2]) || 1)
    / (Math.hypot(rootBasis[0], rootBasis[1], rootBasis[2]) || 1)
  const sole = soleBox.isEmpty()
    ? { depth: ankleHeight, toe: ankleHeight * 1.1, heel: ankleHeight * .6, halfWidth: ankleHeight * .5 }
    : {
      depth: Math.max(.01, -soleBox.min.y * footToRootScale),
      toe: Math.max(.01, soleBox.max.z * footToRootScale),
      heel: Math.max(.01, -soleBox.min.z * footToRootScale),
      halfWidth: Math.max(.01, Math.max(Math.abs(soleBox.min.x), Math.abs(soleBox.max.x)) * footToRootScale),
    }

  legChain.forEach((node, index) => { node.quaternion.copy(posedLeg[index]) })
  rig.root.updateMatrixWorld(true)

  const proportions: HumanoidProportions = {
    hipHeight,
    thighLength,
    shinLength,
    ankleHeight,
    toeLength,
    soleOffset,
    sole,
    upperArmLength: rig.leftElbow.position.length(),
    forearmLength: rig.leftHand.position.length(),
    shoulderWidth: Math.abs(rig.leftShoulder.position.x) + Math.abs(rig.rightShoulder.position.x),
    hipWidth: Math.abs(rig.leftHip.position.x) + Math.abs(rig.rightHip.position.x),
    legLength: thighLength + shinLength,
  }

  return { root: rig.root, bones, proportions, restOffsets }
}

/**
 * Analytic two-bone IK, used to plant a foot on a specific spot.
 *
 * Given where the hip is and where we need the ankle to be, this solves the
 * hip and knee angles that put it there. The knee is a hinge, so there is a
 * closed-form answer via the law of cosines - no iteration, no solver, a fixed
 * and very small cost per leg. `bendAxis` is the local axis the knee flexes
 * around and `bendSign` which way, so the same routine serves both legs.
 */
const ikTargetLocal = new THREE.Vector3()
const ikParentInverse = new THREE.Matrix4()
const ikDir = new THREE.Vector3()
const ikThighRest = new THREE.Vector3()
const ikShinRest = new THREE.Vector3()
const ikKneeDir = new THREE.Vector3()
const ikFootDir = new THREE.Vector3()
const ikBend = new THREE.Quaternion()
const ikHipInverse = new THREE.Quaternion()

const ikGoal = new THREE.Vector3()
const ikActual = new THREE.Vector3()

/**
 * Places a foot on a world-space target by rotating the hip and knee.
 *
 * The closed-form pass below is only exact for an idealised two-segment chain.
 * Real rigs carry extras - a non-uniform scale on the hip, an ankle offset
 * forward of the shin - that bend that assumption slightly. Rather than
 * special-casing each quirk, the solved target is corrected by whatever the
 * chain actually produced and re-solved; two passes take the residual from a
 * few centimetres to under a millimetre, and it stays correct if the rig's
 * proportions ever change.
 */
export function solveLegIK(
  hip: THREE.Object3D,
  knee: THREE.Object3D,
  foot: THREE.Object3D,
  thighLength: number,
  shinLength: number,
  targetWorld: THREE.Vector3,
  bendAxis: THREE.Vector3,
  passes = 2,
) {
  ikGoal.copy(targetWorld)
  for (let pass = 0; pass < passes; pass += 1) {
    solveLegIKOnce(hip, knee, foot, thighLength, shinLength, ikGoal, bendAxis)
    if (pass === passes - 1) break
    // Only the hip's own subtree moved, so only it needs refreshing.
    hip.updateWorldMatrix(false, true)
    ikActual.setFromMatrixPosition(foot.matrixWorld)
    ikGoal.add(targetWorld).sub(ikActual)
  }
}

const worldQuaternionScratch = new THREE.Quaternion()
const localQuaternionScratch = new THREE.Quaternion()

/**
 * Forces a joint to a specific world orientation, whatever its parents did.
 *
 * This exists because of a division of labour the two-bone solver above does
 * not enforce on its own. `solveLegIK` moves the ankle to a *place* by turning
 * the hip and the knee, and the ankle is a child of the knee, so the foot is
 * carried along with the shin: every degree the solver bends the knee to
 * absorb a dip in the hips also pitches the shoe, and drives its toe or heel
 * through the floor.
 *
 * A real ankle does not do that - it dorsiflexes to keep the sole flat while
 * the knee bends over it - and neither should this one. The clip already
 * authored the orientation the foot should have relative to the ground
 * (flat through stance, rolled onto the toe at push-off); the solver's job is
 * the ankle's position only. So the caller samples the foot's world
 * orientation before solving and restores it afterwards through this.
 *
 * The caller must have refreshed the chain's world matrices since the solve,
 * or the parent orientation read here is stale.
 */
export function applyWorldQuaternion(node: THREE.Object3D, desiredWorld: THREE.Quaternion, weight = 1) {
  if (weight <= 0) return
  const parent = node.parent
  if (parent) {
    parent.getWorldQuaternion(worldQuaternionScratch)
    localQuaternionScratch.copy(worldQuaternionScratch).invert().multiply(desiredWorld)
  } else {
    localQuaternionScratch.copy(desiredWorld)
  }
  if (weight >= 1) node.quaternion.copy(localQuaternionScratch)
  else node.quaternion.slerp(localQuaternionScratch, weight)
}

function solveLegIKOnce(
  hip: THREE.Object3D,
  knee: THREE.Object3D,
  foot: THREE.Object3D,
  thighLength: number,
  shinLength: number,
  targetWorld: THREE.Vector3,
  bendAxis: THREE.Vector3,
) {
  const parent = hip.parent
  if (!parent) return
  // Work in the hip's parent space so the result can be written straight to
  // the hip's local quaternion.
  ikParentInverse.copy(parent.matrixWorld).invert()
  ikTargetLocal.copy(targetWorld).applyMatrix4(ikParentInverse).sub(hip.position)

  const reach = thighLength + shinLength
  let distance = ikTargetLocal.length()
  if (distance < 1e-4) return
  // Never fully straighten: a locked-out leg both looks wrong and makes the
  // knee angle numerically unstable right at the singularity.
  distance = THREE.MathUtils.clamp(distance, Math.abs(thighLength - shinLength) + 1e-3, reach * .9995)
  ikDir.copy(ikTargetLocal).normalize()

  // Angle at the hip between the thigh and the straight hip-to-target line.
  const hipCos = THREE.MathUtils.clamp(
    (thighLength * thighLength + distance * distance - shinLength * shinLength) / (2 * thighLength * distance),
    -1,
    1,
  )
  // Swinging the thigh off the hip-to-target line by this angle puts the knee
  // in front, which is the only direction a knee can go.
  ikBend.setFromAxisAngle(bendAxis, -Math.acos(hipCos))
  ikKneeDir.copy(ikDir).applyQuaternion(ikBend).normalize()

  // Rotate each segment from its own rest direction to its solved direction,
  // rather than assuming both segments hang straight down.
  //
  // That assumption is tempting and slightly wrong: this rig's shin runs from
  // the knee to an ankle that is offset forward as well as down, so treating
  // it as vertical leaves a systematic couple of degrees of error - about four
  // centimetres at the foot, which is enough to hold a "planted" foot visibly
  // off the floor. Using the real rest vectors removes it exactly and costs
  // nothing extra.
  ikThighRest.copy(knee.position).normalize()
  hip.quaternion.setFromUnitVectors(ikThighRest, ikKneeDir)

  // Where the knee now is, and therefore which way the shin has to point.
  ikFootDir.copy(ikDir).multiplyScalar(distance).addScaledVector(ikKneeDir, -thighLength).normalize()
  ikHipInverse.copy(hip.quaternion).invert()
  ikFootDir.applyQuaternion(ikHipInverse)
  ikShinRest.copy(foot.position).normalize()
  knee.quaternion.setFromUnitVectors(ikShinRest, ikFootDir)
}
