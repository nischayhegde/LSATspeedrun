import * as THREE from 'three'

import {
  HUMANOID_BONES,
  HUMANOID_NODE_NAMES,
  applyWorldQuaternion,
  canonicalRestQuaternion,
  clampJoint,
  solveLegIK,
  type HumanoidBone,
  type HumanoidSkeleton,
} from '../app-art/rig'

/**
 * Bake a rigged character's animation onto the deck's own stylized counsel.
 *
 * ## Why this exists
 *
 * The deck's art direction is the stylized cast: the office is full of them,
 * the close slide is one of them, and slide 10 has to be the *same man*. What
 * that rig cannot do is walk. It is posed by writing joint angles, and ten
 * passes of hand-authored gait produced either a sliding statue or a torso
 * shearing off its hips — because a walk is a whole-body pose per frame and
 * hand-authored joint curves are written one joint at a time.
 *
 * So the motion comes from somewhere else. `counsel-suit.glb` (Quaternius,
 * CC0) ships an animator's Idle, Walk and backpedal, and none of its geometry
 * appears anywhere in this deck: it is loaded, sampled, and thrown away. What
 * survives is three `AnimationClip`s expressed entirely in the stylized rig's
 * own joints, which the scene then plays through an ordinary `AnimationMixer`.
 *
 * ## How a pose crosses between two different skeletons
 *
 * Not by copying local rotations. The two rigs have different bind poses — the
 * source hangs its arms 30° off vertical, the stylized rig 9° — and different
 * proportions, so a local quaternion means a different thing on each. What
 * transfers is the *change from rest*, in world space:
 *
 *     delta      = sourceWorld(t) · sourceRest⁻¹
 *     wantWorld  = delta · targetRest
 *     local      = parentWorld⁻¹ · wantWorld
 *
 * Read that as: however far this joint has turned away from the way its own
 * body stands at rest, turn the other body's joint that far away from *its*
 * rest. A shoulder that swings 20° forward in the clip swings 20° forward
 * here, whatever either arm's resting angle happens to be. Bones are walked
 * parents-first so each one's parent is already in its new pose when its local
 * rotation is worked out.
 *
 * Two details make it work rather than nearly work:
 *
 * **Rest is the idle's average pose, not either rig's bind.** What the formula
 * needs on the source side is the pose that rig considers "standing about",
 * because that is what gets equated with this rig's own clean stance. A bind
 * pose is not that. It is a modelling convenience, and the difference between
 * it and the way the animator actually stands the character up transfers as a
 * permanent offset on every frame of every clip: this export binds with the
 * shoulders higher and the feet turned further out than its idle ever uses, and
 * against a bind reference the counsel stood with his shoulders up around his
 * jaw, no neck, and his feet splayed — a posture no clip asked for, present
 * even on the frames where the source looked fine.
 *
 * Averaging the idle removes exactly that and nothing else. The mean of a loop
 * that breathes and shifts its weight *is* the pose it breathes around, so the
 * animator's motion survives in full as deviation from it, while the offset it
 * was riding on goes to zero by construction. It also makes the whole thing
 * robust to how the source happened to be bound — a T-posed export would now
 * retarget correctly rather than dropping both arms 60° — so what `assertRest`
 * guards is no longer an assumption about the file but a sanity check on the
 * idle itself.
 *
 * Every clip is referenced against that same neutral, which is what lets the
 * idle→walk crossfade work: both clips agree where standing is, so a foot that
 * is square at rest turns into its first stride instead of popping to a new
 * yaw the moment the walk gains weight.
 *
 * **The legs are solved, not copied.** Rotations retarget; distances do not.
 * The stylized cast is a big head on short legs, so the source's leg angles
 * replayed on this skeleton put the feet through the floor on one frame and in
 * the air on the next, which is precisely the "sliding statue" the whole
 * exercise is trying to leave behind. Instead each ankle is placed: the
 * source's ankle position relative to its own hip joint is scaled by the ratio
 * of the two leg lengths, its height above the floor is scaled about the rest
 * ankle height so a planted foot lands planted, and `solveLegIK` finds the hip
 * and knee angles that put the ankle there. The retargeted foot rotation is
 * then written back as a world orientation, so the sole keeps the roll the
 * animator gave it instead of inheriting the solver's shin angle.
 */

/** Which bone of the source rig drives each humanoid joint. */
const SOURCE_OF: Record<HumanoidBone, string> = {
  hips: 'Hips',
  // The source carries a four-segment spine (Abdomen → Torso → Chest → Neck).
  // Only two of those have a counterpart here, and none of the motion is lost:
  // world-space transfer means `Torso` arrives carrying `Abdomen`'s rotation
  // and `Head` arrives carrying `Neck`'s, because that is what their world
  // orientations already include.
  spine: 'Torso',
  chest: 'Chest',
  head: 'Head',
  leftShoulder: 'UpperArmL',
  leftElbow: 'LowerArmL',
  leftHand: 'WristL',
  rightShoulder: 'UpperArmR',
  rightElbow: 'LowerArmR',
  rightHand: 'WristR',
  leftHip: 'UpperLegL',
  leftKnee: 'LowerLegL',
  leftFoot: 'FootL',
  rightHip: 'UpperLegR',
  rightKnee: 'LowerLegR',
  rightFoot: 'FootR',
}

/** The stylized rig's knees hinge about local X, both sides. */
const BEND_AXIS = new THREE.Vector3(1, 0, 0)

/** Samples per second of source clip. The source itself is keyed at 24. */
const BAKE_FPS = 30

type Side = { hip: HumanoidBone; knee: HumanoidBone; foot: HumanoidBone; source: string }

const SIDES: readonly Side[] = [
  { hip: 'leftHip', knee: 'leftKnee', foot: 'leftFoot', source: 'UpperLegL' },
  { hip: 'rightHip', knee: 'rightKnee', foot: 'rightFoot', source: 'UpperLegR' },
]

/** Which clip's average pose stands for "this character, standing about". */
const REST_CLIP = 'Idle_Neutral'

/** Poses averaged over the rest clip. More than a loop this smooth needs. */
const REST_SAMPLES = 32

/**
 * Refuse to retarget from an idle that is not somebody standing.
 *
 * Everything above equates the source's average idle pose with this rig's clean
 * stance. That is sound for any idle worth the name, and nonsense for a clip
 * that happens to be a T-pose, a sit, or a single unposed frame — in which case
 * the arms come out of the shoulders at an angle no clip asked for, and it looks
 * like a bug in the animation rather than a bad premise in this file.
 */
function assertRest(at: (name: string) => THREE.Vector3) {
  const degrees = THREE.MathUtils.radToDeg(Math.acos(
    THREE.MathUtils.clamp(
      at('LowerArmL').sub(at('UpperArmL')).normalize().dot(new THREE.Vector3(0, -1, 0)),
      -1, 1,
    ),
  ))
  if (degrees > 55) {
    throw new Error(
      `counsel-retarget: "${REST_CLIP}" averages to arms ${degrees.toFixed(0)}° off vertical, `
      + 'which is not a character standing about. Retargeting against it would splay both arms by that much.',
    )
  }
}

/**
 * The source's average pose over its rest clip, in world space.
 *
 * Quaternions are summed and normalised, with each sample's sign aligned to the
 * first. That is the cheap approximation to a proper rotational mean, and it is
 * the right one here: the samples are a metre of breathing apart at most, well
 * inside the arc where the cheap answer and the exact one agree.
 */
function meanRestPose(source: THREE.Object3D, src: Record<string, THREE.Object3D>, clip: THREE.AnimationClip) {
  const names = [...new Set(Object.values(SOURCE_OF))]
  const rotation = new Map(names.map((name) => [name, new THREE.Quaternion(0, 0, 0, 0)]))
  const position = new Map(names.map((name) => [name, new THREE.Vector3()]))
  const mixer = new THREE.AnimationMixer(source)
  const action = mixer.clipAction(clip)
  action.reset().setEffectiveWeight(1).play()

  const sample = new THREE.Quaternion()
  for (let index = 0; index < REST_SAMPLES; index += 1) {
    mixer.setTime((index / REST_SAMPLES) * clip.duration)
    source.updateWorldMatrix(true, true)
    for (const name of names) {
      const sum = rotation.get(name)!
      src[name].getWorldQuaternion(sample).normalize()
      const sign = sum.w === 0 && sum.x === 0 && sum.y === 0 && sum.z === 0 ? 1
        : Math.sign(sample.x * sum.x + sample.y * sum.y + sample.z * sum.z + sample.w * sum.w) || 1
      sum.set(
        sum.x + sample.x * sign, sum.y + sample.y * sign,
        sum.z + sample.z * sign, sum.w + sample.w * sign,
      )
      position.get(name)!.add(new THREE.Vector3().setFromMatrixPosition(src[name].matrixWorld))
    }
  }

  mixer.stopAllAction()
  mixer.uncacheRoot(source)
  for (const q of rotation.values()) q.normalize()
  for (const v of position.values()) v.divideScalar(REST_SAMPLES)
  return { rotation, position }
}

export type RetargetResult = {
  clips: Map<string, THREE.AnimationClip>
  /** Source leg length → target leg length. Everything positional is scaled by it. */
  scale: number
}

/**
 * @param source a loaded rig with the clips on it. Modified while sampling.
 * @param skeleton the stylized rig, already bound and standing on its soles.
 */
export function retargetHumanoidClips(
  source: THREE.Object3D,
  clips: ReadonlyMap<string, THREE.AnimationClip>,
  skeleton: HumanoidSkeleton,
): RetargetResult {
  const src: Record<string, THREE.Object3D> = {}
  source.traverse((node) => { src[node.name] = node })
  for (const name of Object.values(SOURCE_OF)) {
    if (!src[name]) throw new Error(`counsel-retarget: the source rig has no "${name}" bone`)
  }

  source.updateWorldMatrix(true, true)

  // --- both rigs at rest, measured once --------------------------------------
  const rest = clips.get(REST_CLIP)
  if (!rest) throw new Error(`counsel-retarget: the source has no "${REST_CLIP}" clip to take rest from`)
  const mean = meanRestPose(source, src, rest)
  const at = (name: string) => mean.position.get(name)!.clone()
  assertRest(at)

  /** Inverted on the way in: the transfer only ever uses `restᐨ¹`. */
  const srcRest = new Map<string, THREE.Quaternion>()
  for (const name of Object.values(SOURCE_OF)) {
    srcRest.set(name, mean.rotation.get(name)!.clone().invert())
  }
  const srcRestHips = at('Hips')
  const srcLegLength = at('UpperLegL').distanceTo(at('LowerLegL')) + at('LowerLegL').distanceTo(at('FootL'))
  /** Ankle relative to its own hip joint, at rest, per side. */
  const srcRestLeg = SIDES.map((side) => at(SOURCE_OF[side.foot]).sub(at(side.source)))

  const bones = skeleton.bones
  for (const bone of HUMANOID_BONES) bones[bone].quaternion.copy(canonicalRestQuaternion(bone))
  skeleton.root.updateWorldMatrix(true, true)

  const dstRest = new Map<HumanoidBone, THREE.Quaternion>()
  for (const bone of HUMANOID_BONES) {
    dstRest.set(bone, bones[bone].getWorldQuaternion(new THREE.Quaternion()).normalize())
  }
  const scale = skeleton.proportions.legLength / srcLegLength

  // --- stand the target the way the source stands, to scale -------------------
  //
  // The two rigs do not carry the same slack in the knee. This one binds with
  // its legs locked straight; the source binds at 97% of full extension, and
  // its walk spends that last 3% — so replaying the walk against locked legs
  // asks for an ankle further away than the leg can reach, the solver clamps,
  // and both legs come out straight and splayed on every long stride. That is
  // not a subtle artefact: it is the "sliding statue" silhouette, arriving
  // from a rig that has no room left to move.
  //
  // Dropping the pelvis until this leg carries the same proportional slack
  // costs about three centimetres of standing height and buys an ankle that is
  // always reachable, and knees that are never locked. Both rigs then agree
  // about where the floor is, at rest and therefore in every frame that plants
  // a foot there.
  const restAnkleY = new THREE.Vector3().setFromMatrixPosition(bones.leftFoot.matrixWorld).y
  const restHipJointY = new THREE.Vector3().setFromMatrixPosition(bones.leftHip.matrixWorld).y
  bones.hips.position.y += restAnkleY - srcRestLeg[0].y * scale - restHipJointY
  skeleton.root.updateWorldMatrix(true, true)
  const restHips = bones.hips.position.clone()

  /**
   * Where each ankle sits relative to its own hip joint at rest: this rig's own
   * stance sideways and fore-and-aft, the source's to scale vertically.
   *
   * Sideways and fore-and-aft it has to be this rig's own, because the source
   * binds with one foot a quarter of a leg length in front of the other and
   * inheriting that leaves the counsel standing with his feet crossed. What
   * the clips do *from* their own rest still transfers; only the stance they
   * depart from is local.
   */
  const restLeg = SIDES.map((side, index) => {
    const ankle = new THREE.Vector3().setFromMatrixPosition(bones[side.foot].matrixWorld)
    const hip = new THREE.Vector3().setFromMatrixPosition(bones[side.hip].matrixWorld)
    return new THREE.Vector3(ankle.x - hip.x, srcRestLeg[index].y * scale, ankle.z - hip.z)
  })

  // --- scratch ---------------------------------------------------------------
  const mixer = new THREE.AnimationMixer(source)
  const delta = new THREE.Quaternion()
  const want = new THREE.Quaternion()
  const parent = new THREE.Quaternion()
  const world = new THREE.Quaternion()
  const srcHips = new THREE.Vector3()
  const srcAnkle = new THREE.Vector3()
  const srcHipJoint = new THREE.Vector3()
  const hipJoint = new THREE.Vector3()
  const footGoal = new THREE.Vector3()
  const footWorld = new Map<HumanoidBone, THREE.Quaternion>()
  for (const side of SIDES) footWorld.set(side.foot, new THREE.Quaternion())

  /** Pose the stylized rig to whatever the source is doing right now. */
  const transfer = () => {
    source.updateWorldMatrix(true, true)

    srcHips.setFromMatrixPosition(src.Hips.matrixWorld).sub(srcRestHips).multiplyScalar(scale)
    bones.hips.position.copy(restHips).add(srcHips)

    for (const bone of HUMANOID_BONES) {
      const node = bones[bone]
      src[SOURCE_OF[bone]].getWorldQuaternion(world).normalize()
      delta.copy(world).multiply(srcRest.get(SOURCE_OF[bone])!)
      want.copy(delta).multiply(dstRest.get(bone)!)
      const saved = footWorld.get(bone)
      if (saved) saved.copy(want)
      if (node.parent) {
        node.parent.getWorldQuaternion(parent).normalize()
        want.premultiply(parent.invert())
      }
      clampJoint(bone, node.quaternion.copy(want).normalize())
      // The subtree, not just this node. Two of these joints are separated by
      // a link this system does not drive — the head hangs off a neck, which
      // hangs off the chest — and a child read against a parent whose world
      // matrix is still the one from the rest pose comes out carrying its
      // grandparent's rotation twice. It showed up as a head that pitched
      // further forward the further the chest leaned.
      node.updateWorldMatrix(false, true)
    }

    for (let index = 0; index < SIDES.length; index += 1) {
      const side = SIDES[index]
      const hip = bones[side.hip]
      const knee = bones[side.knee]
      const foot = bones[side.foot]

      srcAnkle.setFromMatrixPosition(src[SOURCE_OF[side.foot]].matrixWorld)
      srcHipJoint.setFromMatrixPosition(src[side.source].matrixWorld)
      hipJoint.setFromMatrixPosition(hip.matrixWorld)
      // The ankle is placed relative to its own hip joint: this rig's resting
      // stance, plus however far the source's ankle has moved from *its* rest,
      // to scale. Vertically that reduces to the source's own hip-to-ankle
      // vector scaled — which is what keeps a planted foot on the floor, since
      // the pelvis above was set so the two agree at rest.
      footGoal.copy(srcAnkle).sub(srcHipJoint).sub(srcRestLeg[index]).multiplyScalar(scale)
        .add(restLeg[index]).add(hipJoint)
      solveLegIK(
        hip,
        knee,
        foot,
        skeleton.proportions.thighLength,
        skeleton.proportions.shinLength,
        footGoal,
        BEND_AXIS,
      )
      hip.updateWorldMatrix(false, true)
      applyWorldQuaternion(foot, footWorld.get(side.foot)!)
      // The hip node carries a 0.97 vertical squash, so a quaternion that has
      // been through its world matrix comes back a few parts in ten thousand
      // off unit length — which three composes straight into the bone as a
      // scale on the shoe.
      foot.quaternion.normalize()
      foot.updateWorldMatrix(false, false)
    }
  }

  const baked = new Map<string, THREE.AnimationClip>()
  for (const [name, clip] of clips) {
    const action = mixer.clipAction(clip)
    mixer.stopAllAction()
    action.reset().setEffectiveWeight(1).play()

    const steps = Math.max(8, Math.round(clip.duration * BAKE_FPS))
    const times = new Float32Array(steps + 1)
    const rotations = new Map<HumanoidBone, Float32Array>()
    for (const bone of HUMANOID_BONES) rotations.set(bone, new Float32Array((steps + 1) * 4))
    const hipsTrack = new Float32Array((steps + 1) * 3)

    for (let step = 0; step <= steps; step += 1) {
      // The last sample is the first one again, so the clip closes on itself
      // and a loop has no seam. Sampling `duration` directly would work for a
      // well-authored cycle and quietly not for one that is a frame long.
      const at = (step % steps) / steps * clip.duration
      times[step] = (step / steps) * clip.duration
      mixer.setTime(at)
      transfer()
      for (const bone of HUMANOID_BONES) {
        bones[bone].quaternion.toArray(rotations.get(bone)!, step * 4)
      }
      bones.hips.position.toArray(hipsTrack, step * 3)
    }

    const tracks: THREE.KeyframeTrack[] = [
      new THREE.VectorKeyframeTrack(`${HUMANOID_NODE_NAMES.hips}.position`, times as unknown as number[], hipsTrack as unknown as number[]),
    ]
    for (const bone of HUMANOID_BONES) {
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${HUMANOID_NODE_NAMES[bone]}.quaternion`,
        times as unknown as number[],
        rotations.get(bone)! as unknown as number[],
      ))
    }
    baked.set(name, new THREE.AnimationClip(name, clip.duration, tracks))
    action.stop()
  }

  mixer.stopAllAction()
  mixer.uncacheRoot(source)

  // Leave the rig standing rather than holding the last frame of the last clip
  // baked: the caller measures its height off this pose.
  for (const bone of HUMANOID_BONES) bones[bone].quaternion.copy(canonicalRestQuaternion(bone))
  bones.hips.position.copy(restHips)
  skeleton.root.updateWorldMatrix(true, true)

  return { clips: baked, scale }
}
