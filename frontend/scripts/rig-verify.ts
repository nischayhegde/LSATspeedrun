/**
 * Numeric verification of the humanoid animation system.
 *
 * Screenshots show what a pose looks like; they cannot show whether a foot is
 * sliding by two centimetres a frame or whether a joint's angular velocity
 * jumps at a keyframe. Those are the two things this system exists to fix, and
 * both are directly measurable, so they are measured here rather than
 * eyeballed. The legacy driver is simulated alongside on the same rig so every
 * number has a baseline.
 *
 * Runs headless: nothing here needs WebGL, only the scene graph maths.
 */

import * as THREE from 'three'

import { buildStylizedCounsel, type StylizedCounselRig } from '../src/art/stylized-counsel'
import { HumanoidActor } from '../src/art/rig/humanoid-actor'
import { HumanoidBehaviorDirector } from '../src/art/rig/humanoid-behavior'
import { ANIM_META_NODE, humanoidClipLibrary } from '../src/art/rig/humanoid-clips'
import { HUMANOID_BONES, type HumanoidBone } from '../src/art/rig/humanoid-rig'

const STEP = 1 / 60
const failures: string[] = []
const report: string[] = []

function check(label: string, pass: boolean, detail: string) {
  report.push(`${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`)
  if (!pass) failures.push(label)
}

/**
 * Finds the worst discontinuity in a series of per-frame pose travel.
 *
 * The question is "does one frame jump", and the tempting way to ask it -
 * compare each frame against the median of its neighbours - answers a
 * different question and gets it wrong in both directions. A walk settling
 * into an idle legitimately slows, dips, and then speeds up again as the last
 * leg swing plays out under the fade; every frame in that profile is smooth
 * and continuous, and every one of them is also several times the median of a
 * window that spans the dip. Scoring that as a pop trains you to raise the
 * threshold until the check stops meaning anything.
 *
 * Curvature asks the right question. A frame that sits on the straight line
 * between its neighbours is continuous no matter how fast it is moving or how
 * hard it is accelerating; a frame that does not is a spike. So the score is
 * how far each step departs from the average of the two either side, relative
 * to the local scale. `verifyDetector` below proves this still fires on a real
 * one-frame jump.
 */
function worstDiscontinuity(steps: number[]) {
  let ratio = 0
  let excess = 0
  let at = -1
  for (let index = 1; index < steps.length - 1; index += 1) {
    const expected = (steps[index - 1] + steps[index + 1]) / 2
    const departure = Math.abs(steps[index] - expected)
    // Below this the departure is smaller than a tenth of a degree spread
    // across sixteen joints, which no eye resolves on a moving figure at one
    // frame's exposure. Without the floor this fires on arithmetic noise.
    if (departure < .02) continue
    const scale = Math.max(expected, .004)
    if (departure / scale > ratio) {
      ratio = departure / scale
      excess = departure
      at = index
    }
  }
  return { ratio, excess, at }
}

/**
 * The ratio above which a frame counts as a pop, and the absolute departure
 * below which nothing counts at all.
 *
 * `verifyDetector` sets the ratio: a single frame displaced by 0.5 rad summed
 * over sixteen joints - about 1.8 degrees each, which is roughly the smallest
 * one-frame jump anyone notices on a moving figure - scores 3.9x, so a limit
 * of 2.5 catches a pop at the threshold of visibility while sitting well above
 * the 0.95x that the fastest real transition produces. The rad limit is the
 * same judgement expressed absolutely, as a backstop for the case where a pop
 * arrives in the middle of motion fast enough to flatter the ratio.
 */
const POP_RATIO_LIMIT = 2.5
const POP_EXCESS_LIMIT = .6

/** A smooth profile with one frame displaced, to show the detector fires. */
function verifyDetector() {
  const smooth: number[] = []
  for (let index = 0; index < 60; index += 1) {
    // A dip and a recovery, which is the shape that fooled the median test.
    smooth.push(.09 + .12 * Math.abs(Math.sin(index / 9)) + .05 * Math.cos(index / 4))
  }
  const clean = worstDiscontinuity(smooth)
  const spiked = [...smooth]
  spiked[30] += .5
  const dirty = worstDiscontinuity(spiked)
  return { clean: clean.ratio, dirty: dirty.ratio, dirtyAt: dirty.at }
}

function makeRig(scale = 1) {
  const rig = buildStylizedCounsel('male', 4, { role: 'visitor', paletteSeed: 7 })
  rig.root.scale.setScalar(scale)
  const holder = new THREE.Group()
  holder.add(rig.root)
  holder.updateWorldMatrix(true, true)
  return { rig, holder }
}

// ---------------------------------------------------------------------------
// 1. Foot sliding during stance.
//
// The defining failure of the old system: the body advanced along a path at
// one rate while the legs swung at a fixed unrelated frequency, so a planted
// foot was dragged across the floor every frame. Measured here as the mean
// horizontal speed of a foot while it is bearing weight - which for a real
// stance phase should be essentially zero.
// ---------------------------------------------------------------------------

function measureFootSlide(mode: 'skeletal' | 'legacy', scale = 1) {
  const { rig, holder } = makeRig(scale)
  const actor = new HumanoidActor(rig, { seed: 11, state: 'walk' })
  actor.setLod('full')
  const speed = actor.naturalWalkSpeed
  actor.setGroundSpeed(speed)

  // Track the parts of the foot that actually touch the floor, not the ankle
  // joint.
  //
  // The ankle is the wrong thing to measure: through the second half of stance
  // a real foot pivots on the ball, so the ankle sweeps forward and up while
  // the foot itself has not moved an inch. Scoring the ankle would count that
  // correct behaviour as sliding. Watching the heel and the toe instead asks
  // the question that matters - is some part of this foot stationary on the
  // ground? - and asks it identically of both drivers.
  // The proportions are in the character's own units, and the foot's world
  // matrix already carries the rig's scale, so these offsets are applied to the
  // foot's world *position* under the world rotation rather than pushed through
  // `matrixWorld` - which would apply the scale to them a second time and, at
  // any scale but one, measure the wrong points on the foot entirely.
  const { ankleHeight, toeLength } = actor.skeleton.proportions
  // Sample the whole sole, not just its two ends.
  //
  // Through the roll from heel strike to toe-off the point actually bearing on
  // the floor migrates continuously along the sole, so at mid-stance neither
  // the heel nor the toe tip is the pivot and both are moving. Watching only
  // those two therefore scores a correctly rolling foot as sliding for the
  // middle third of its stance. The physical question is whether *any* part of
  // the sole is stationary, so the whole sole is sampled and the slowest point
  // wins.
  const SOLE = 5
  const solePoints = Array.from({ length: SOLE }, (_, index) => new THREE.Vector3(
    0,
    -ankleHeight * scale,
    (-toeLength * .5 + (index / (SOLE - 1)) * toeLength * 1.5) * scale,
  ))
  const footWorldQuaternion = new THREE.Quaternion()
  const tmpWorld = new THREE.Vector3()
  const scratch = new THREE.Vector3()
  const track: Record<'left' | 'right', number[][]> = { left: [], right: [] }

  for (let frame = 0; frame < 840; frame += 1) {
    // The rig faces +Z, so the body must travel along +Z. Walking it along a
    // different axis than the legs swing would drag every planted foot
    // sideways and measure the harness's own bug rather than the animation.
    holder.position.z += speed * STEP
    if (mode === 'skeletal') actor.update(STEP)
    else legacyStep(rig, frame * STEP, 1)
    holder.updateMatrixWorld(true)
    if (frame < 240) continue
    for (const side of ['left', 'right'] as const) {
      const bone = side === 'left' ? rig.leftFoot : rig.rightFoot
      bone.getWorldQuaternion(footWorldQuaternion)
      tmpWorld.setFromMatrixPosition(bone.matrixWorld)
      const row: number[] = []
      for (const point of solePoints) {
        scratch.copy(point).applyQuaternion(footWorldQuaternion).add(tmpWorld)
        row.push(scratch.x, scratch.z)
      }
      track[side].push(row)
    }
  }
  actor.dispose()

  // Per frame, how fast is the slower of the heel and the toe moving? If
  // either is stationary the foot has a fixed purchase on the floor.
  const speeds: number[] = []
  let plantedFrames = 0
  let totalFrames = 0
  for (const side of ['left', 'right'] as const) {
    const series = track[side]
    const perFrame: number[] = []
    for (let index = 1; index < series.length; index += 1) {
      const previous = series[index - 1]
      const current = series[index]
      let slowest = Infinity
      for (let point = 0; point < previous.length; point += 2) {
        slowest = Math.min(slowest, Math.hypot(
          current[point] - previous[point],
          current[point + 1] - previous[point + 1],
        ) / STEP)
      }
      perFrame.push(slowest)
    }
    totalFrames += perFrame.length
    plantedFrames += perFrame.filter((value) => value < speed * .2).length
    perFrame.sort((a, b) => a - b)
    speeds.push(...perFrame.slice(0, Math.floor(perFrame.length * .5)))
  }

  const mean = speeds.reduce((sum, value) => sum + value, 0) / Math.max(1, speeds.length)
  return { mean, plantedFraction: plantedFrames / Math.max(1, totalFrames), speed }
}

/** The current in-app approach, reproduced exactly enough to be a fair
 *  baseline: one sine per joint, mirrored left/right, at a fixed frequency
 *  with no relationship to ground speed. */
function legacyStep(rig: StylizedCounselRig, elapsed: number, locomotion: number) {
  const stride = Math.sin(elapsed * 6.5) * locomotion
  const step = Math.abs(Math.sin(elapsed * 6.5)) * locomotion
  rig.hips.position.y = rig.base.hipsY + step * .045
  rig.leftHip.rotation.x = stride * .34
  rig.rightHip.rotation.x = -stride * .34
  rig.leftKnee.rotation.x = Math.max(0, -stride) * .44
  rig.rightKnee.rotation.x = Math.max(0, stride) * .44
  rig.leftFoot.rotation.x = -Math.max(0, -stride) * .16
  rig.rightFoot.rotation.x = -Math.max(0, stride) * .16
  rig.leftShoulder.rotation.x = -stride * .24
  rig.rightShoulder.rotation.x = stride * .24
}

// ---------------------------------------------------------------------------
// 2. Motion smoothness.
//
// Jerk - the rate of change of acceleration - is what the eye reads as
// jitteriness. A curve built from linearly interpolated keyframes has velocity
// steps at every keyframe and so spikes here; a C1-continuous spline does not.
// ---------------------------------------------------------------------------

function measureJerk(mode: 'skeletal' | 'legacy', lod: 'full' | 'medium' = 'full') {
  const { rig, holder } = makeRig()
  const actor = new HumanoidActor(rig, { seed: 3, state: 'walk' })
  actor.setLod(lod)
  actor.setGroundSpeed(actor.naturalWalkSpeed)

  const tracked: HumanoidBone[] = ['leftHip', 'leftKnee', 'leftFoot', 'rightHip', 'rightKnee', 'spine', 'head']
  const history = new Map<HumanoidBone, number[]>()
  tracked.forEach((bone) => history.set(bone, []))

  for (let frame = 0; frame < 600; frame += 1) {
    holder.position.z += actor.naturalWalkSpeed * STEP
    if (mode === 'skeletal') actor.update(STEP)
    else legacyStep(rig, frame * STEP, 1)
    holder.updateMatrixWorld(true)
    for (const bone of tracked) {
      const node = actor.skeleton.bones[bone]
      history.get(bone)!.push(node.rotation.x)
    }
  }
  actor.dispose()

  // Third difference of the angle series, normalized to per-second units.
  let peak = 0
  let total = 0
  let count = 0
  // Velocity ripple: how much high-frequency noise rides on top of the
  // intended motion, as a fraction of that motion's own peak speed.
  //
  // This is the number that corresponds to what anyone can actually see. Raw
  // jerk is a useful smoke alarm but a terrible acceptance test: it is a
  // single-sample statistic, it is dominated by whichever joint moves fastest,
  // and a real footfall legitimately produces a large spike. Ripple asks the
  // question a viewer asks - is the motion buzzing? - by comparing each
  // joint's velocity against a smoothed version of itself.
  let rippleTotal = 0
  let rippleCount = 0
  for (const series of history.values()) {
    for (let index = 3; index < series.length; index += 1) {
      const jerk = Math.abs(
        series[index] - 3 * series[index - 1] + 3 * series[index - 2] - series[index - 3],
      ) / (STEP * STEP * STEP)
      peak = Math.max(peak, jerk)
      total += jerk
      count += 1
    }

    const velocity: number[] = []
    for (let index = 1; index < series.length; index += 1) velocity.push((series[index] - series[index - 1]) / STEP)
    const peakSpeed = Math.max(...velocity.map(Math.abs))
    if (peakSpeed < 1e-4) continue
    let noise = 0
    let samples = 0
    for (let index = 2; index < velocity.length - 2; index += 1) {
      const smoothed = (velocity[index - 2] + 4 * velocity[index - 1] + 6 * velocity[index]
        + 4 * velocity[index + 1] + velocity[index + 2]) / 16
      noise += (velocity[index] - smoothed) ** 2
      samples += 1
    }
    rippleTotal += Math.sqrt(noise / Math.max(1, samples)) / peakSpeed
    rippleCount += 1
  }
  return {
    peak,
    mean: total / Math.max(1, count),
    ripple: rippleTotal / Math.max(1, rippleCount),
  }
}

// ---------------------------------------------------------------------------
// 3. Crossfade continuity.
//
// A pop at a state change is a single frame where the pose moves far more than
// the frames either side of it. Comparing the largest step during a transition
// against the largest step in steady state is a direct test for that.
// ---------------------------------------------------------------------------

function measureTransitionPop() {
  const { rig, holder } = makeRig()
  const actor = new HumanoidActor(rig, { seed: 5, state: 'idle' })
  actor.setLod('full')

  const snapshot = () => HUMANOID_BONES.map((bone) => actor.skeleton.bones[bone].quaternion.clone())
  const distance = (a: THREE.Quaternion[], b: THREE.Quaternion[]) =>
    a.reduce((sum, value, index) => sum + value.angleTo(b[index]), 0)

  // Warm up first. The very first update moves the rig from its bind pose into
  // the clip, which is a large and entirely expected one-off change; including
  // it would set the steady-state baseline so high that a real pop could hide
  // underneath it.
  for (let frame = 0; frame < 120; frame += 1) {
    actor.update(STEP)
    holder.updateMatrixWorld(true)
  }

  let previous = snapshot()
  let steadyPeak = 0
  for (let frame = 0; frame < 180; frame += 1) {
    actor.update(STEP)
    holder.updateMatrixWorld(true)
    const current = snapshot()
    steadyPeak = Math.max(steadyPeak, distance(previous, current))
    previous = current
  }

  // A transition legitimately moves the body fast, so a large per-frame step
  // is not by itself a fault. A *pop* is a discontinuity: one frame that moves
  // far more than the frames immediately around it. Comparing each step
  // against its local neighbourhood detects that and ignores honest speed.
  let transitionPeak = 0
  let worstSpike = 0
  let worstExcess = 0
  let largestExcess = 0
  let worstSpikeAt = ''
  const sequence: Array<'walk' | 'idle' | 'confer' | 'presentBoard' | 'seatedIdle'> = [
    'walk', 'idle', 'confer', 'presentBoard', 'seatedIdle', 'idle',
  ]
  for (const state of sequence) {
    actor.setState(state)
    actor.setGroundSpeed(actor.naturalWalkSpeed)
    const steps: number[] = []
    for (let frame = 0; frame < 90; frame += 1) {
      actor.update(STEP)
      holder.updateMatrixWorld(true)
      const current = snapshot()
      const step = distance(previous, current)
      steps.push(step)
      transitionPeak = Math.max(transitionPeak, step)
      previous = current
    }
    const worst = worstDiscontinuity(steps)
    if (worst.ratio > worstSpike) {
      worstSpike = worst.ratio
      worstExcess = worst.excess
      worstSpikeAt = `${state} frame ${worst.at}`
    }
    largestExcess = Math.max(largestExcess, worst.excess)
  }
  actor.dispose()
  return { steadyPeak, transitionPeak, worstSpike, worstExcess, largestExcess, worstSpikeAt }
}

// ---------------------------------------------------------------------------
// 4. Loop seams. A looping clip whose first and last samples disagree stutters
//    once per cycle, which reads as a regular tick.
// ---------------------------------------------------------------------------

function measureLoopSeams() {
  const library = humanoidClipLibrary()
  let worst = 0
  let worstName = ''
  const a = new THREE.Quaternion()
  const b = new THREE.Quaternion()
  for (const [name, clip] of library.clips) {
    if (!library.meta.get(name)?.loop) continue
    for (const track of clip.tracks) {
      if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue
      const values = track.values
      const last = values.length / 4 - 1
      a.set(values[0], values[1], values[2], values[3])
      b.set(values[last * 4], values[last * 4 + 1], values[last * 4 + 2], values[last * 4 + 3])
      // With the wrapped final sample in place, a looping track's first and
      // last keys should be the same pose to within floating-point noise.
      const stepAngle = a.angleTo(b)
      if (stepAngle > worst) {
        worst = stepAngle
        worstName = `${name}/${track.name}`
      }
    }
  }
  return { worst, worstName }
}

// ---------------------------------------------------------------------------
// 5. Reduced motion lands a real pose.
//
// The specific regression to guard against: freezing at t=0 produced the
// neutral stance for every clip, so reduced-motion users saw no gesture at
// all. A correct held pose must differ measurably from the bind pose.
// ---------------------------------------------------------------------------

function measureReducedPose() {
  const results: Array<{ label: string; delta: number }> = []
  for (const state of ['walk', 'confer', 'presentBoard', 'seatedIdle'] as const) {
    const { rig, holder } = makeRig()
    const bind = HUMANOID_BONES.map((bone) => {
      const node = { hips: rig.hips, spine: rig.spine, chest: rig.chest, head: rig.head, leftShoulder: rig.leftShoulder, leftElbow: rig.leftElbow, leftHand: rig.leftHand, rightShoulder: rig.rightShoulder, rightElbow: rig.rightElbow, rightHand: rig.rightHand, leftHip: rig.leftHip, leftKnee: rig.leftKnee, leftFoot: rig.leftFoot, rightHip: rig.rightHip, rightKnee: rig.rightKnee, rightFoot: rig.rightFoot }[bone]
      return node.quaternion.clone()
    })
    const actor = new HumanoidActor(rig, { seed: 2, state, reduced: true })
    actor.update(STEP)
    holder.updateMatrixWorld(true)
    const delta = HUMANOID_BONES.reduce(
      (sum, bone, index) => sum + actor.skeleton.bones[bone].quaternion.angleTo(bind[index]),
      0,
    )
    results.push({ label: state, delta })
    actor.dispose()
  }

  // And the same for a one-shot gesture, which is where the original bug bit.
  const { rig } = makeRig()
  const actor = new HumanoidActor(rig, { seed: 2, state: 'idle', reduced: true })
  actor.update(STEP)
  const before = HUMANOID_BONES.map((bone) => actor.skeleton.bones[bone].quaternion.clone())
  actor.playGesture('celebrate')
  actor.update(STEP)
  const gestureDelta = HUMANOID_BONES.reduce(
    (sum, bone, index) => sum + actor.skeleton.bones[bone].quaternion.angleTo(before[index]),
    0,
  )
  actor.dispose()
  return { results, gestureDelta }
}

// ---------------------------------------------------------------------------
// 6. Anatomical limits hold across every clip.
// ---------------------------------------------------------------------------

function measureJointLimits() {
  const { rig, holder } = makeRig()
  const actor = new HumanoidActor(rig, { seed: 9, state: 'idle' })
  actor.setLod('full')
  let worstKnee = 0
  let worstElbow = 0
  const states = ['idle', 'idleWeightShift', 'walk', 'confer', 'reviewDocument', 'presentBoard', 'seatedIdle', 'seatedType'] as const
  for (const state of states) {
    actor.setState(state, .01)
    actor.setGroundSpeed(actor.naturalWalkSpeed)
    for (let frame = 0; frame < 420; frame += 1) {
      actor.update(STEP)
      holder.updateMatrixWorld(true)
      // A knee bending the wrong way, or an elbow hyperextending, is the most
      // visible retargeting failure there is.
      worstKnee = Math.min(worstKnee, actor.skeleton.bones.leftKnee.rotation.x, actor.skeleton.bones.rightKnee.rotation.x)
      worstElbow = Math.max(worstElbow, actor.skeleton.bones.leftElbow.rotation.x, actor.skeleton.bones.rightElbow.rotation.x)
    }
  }
  actor.dispose()
  return { worstKnee, worstElbow }
}

// ---------------------------------------------------------------------------
// 7. Additive beats layer over a base that keeps running.
//
// The whole point of the additive layer is that a nod does not stop a
// character breathing. That is a claim about two clips being evaluated at once
// and it is easy to get wrong in a way no screenshot shows: an override
// gesture also produces a perfectly good nod, it just quietly freezes
// everything else for its duration. Running the same actor twice from the same
// seed - once with the beat, once without - isolates the beat's own
// contribution exactly, and the base motion has to still be there underneath
// it.
// ---------------------------------------------------------------------------

function measureAdditiveLayering(gesture: 'cuffAdjust' | 'nod' | 'glance') {
  const build = () => {
    const { rig, holder } = makeRig()
    const actor = new HumanoidActor(rig, { seed: 21, state: 'idle' })
    actor.setLod('full')
    for (let frame = 0; frame < 180; frame += 1) {
      actor.update(STEP)
      holder.updateMatrixWorld(true)
    }
    return { rig, holder, actor }
  }

  const withBeat = build()
  const without = build()
  withBeat.actor.playGesture(gesture, { amplitude: 1, timeScale: 1 })

  const snapshot = (actor: HumanoidActor) =>
    HUMANOID_BONES.map((bone) => actor.skeleton.bones[bone].quaternion.clone())
  const distance = (a: THREE.Quaternion[], b: THREE.Quaternion[]) =>
    a.reduce((sum, value, index) => sum + value.angleTo(b[index]), 0)

  // Three series, all sampled on the same frames: how far the beat pushes the
  // pose away from the un-beaten twin, how much the base is still moving
  // underneath, and how far the pose travels frame to frame.
  const separation: number[] = []
  const baseTravel: number[] = []
  const steps: number[] = []
  let previous = snapshot(withBeat.actor)
  let previousBase = snapshot(without.actor)
  for (let frame = 0; frame < 300; frame += 1) {
    withBeat.actor.update(STEP)
    without.actor.update(STEP)
    withBeat.holder.updateMatrixWorld(true)
    without.holder.updateMatrixWorld(true)
    const current = snapshot(withBeat.actor)
    const currentBase = snapshot(without.actor)
    separation.push(distance(current, currentBase))
    baseTravel.push(distance(previousBase, currentBase))
    steps.push(distance(previous, current))
    previous = current
    previousBase = currentBase
  }
  withBeat.actor.dispose()
  without.actor.dispose()

  const peak = Math.max(...separation)
  // The tail has to come back to zero, or the beat has permanently displaced
  // the character's rest pose - which over a few minutes of ambient beats
  // would accumulate into a visibly wrong posture.
  const settled = separation.slice(-30).reduce((sum, value) => sum + value, 0) / 30
  // Was the base still alive while the beat played? Measured over the window
  // where the beat is actually applied, so an idle that stopped dead cannot
  // hide behind the frames before and after.
  const activeWindow = baseTravel.filter((_, index) => separation[index] > peak * .3)
  const baseAlive = activeWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, activeWindow.length)

  // And no pop at either end of the beat's own fade.
  const { ratio: worstRatio } = worstDiscontinuity(steps)

  return { peak, settled, baseAlive, worstRatio }
}

// ---------------------------------------------------------------------------
// 8. Swim.
//
// A new locomotion state gets the same treatment the walk got, plus the checks
// specific to what makes a stroke read as swimming rather than as a walk
// played on its side: the arms have to alternate rather than move together,
// the torso has to counter-rotate with them, the legs have to beat faster than
// the arms do, and the head has to turn to breathe on a slower period than
// either. Each of those is a phase relationship, and a phase relationship is
// measurable.
// ---------------------------------------------------------------------------

function measureSwim() {
  const { rig, holder } = makeRig()
  const actor = new HumanoidActor(rig, { seed: 13, state: 'swim' })
  actor.setLod('full')
  actor.setGroundSpeed(actor.naturalSwimSpeed)

  const track = {
    leftShoulder: [] as number[],
    rightShoulder: [] as number[],
    spineY: [] as number[],
    headY: [] as number[],
    leftHip: [] as number[],
    hipPitch: [] as number[],
  }
  for (let frame = 0; frame < 480; frame += 1) {
    holder.position.z += actor.naturalSwimSpeed * STEP
    actor.update(STEP)
    holder.updateMatrixWorld(true)
    if (frame < 120) continue
    track.leftShoulder.push(actor.skeleton.bones.leftShoulder.rotation.x)
    track.rightShoulder.push(actor.skeleton.bones.rightShoulder.rotation.x)
    track.spineY.push(actor.skeleton.bones.spine.rotation.y)
    track.headY.push(actor.skeleton.bones.head.rotation.y)
    track.leftHip.push(actor.skeleton.bones.leftHip.rotation.x)
    track.hipPitch.push(actor.skeleton.bones.hips.rotation.x)
  }
  actor.dispose()

  const centred = (series: number[]) => {
    const mean = series.reduce((sum, value) => sum + value, 0) / series.length
    return series.map((value) => value - mean)
  }
  // Normalized cross-correlation at zero lag. Near -1 means the two joints
  // move in opposition, which is what "alternating" means numerically.
  const correlate = (a: number[], b: number[]) => {
    const x = centred(a)
    const y = centred(b)
    const dot = x.reduce((sum, value, index) => sum + value * y[index], 0)
    const norm = Math.sqrt(x.reduce((sum, value) => sum + value * value, 0))
      * Math.sqrt(y.reduce((sum, value) => sum + value * value, 0))
    return norm < 1e-9 ? 0 : dot / norm
  }
  // Zero crossings are a cheap frequency estimate, and frequency is the whole
  // question for the kick: a flutter is several beats per arm stroke.
  const crossings = (series: number[]) => {
    const x = centred(series)
    let count = 0
    for (let index = 1; index < x.length; index += 1) if (x[index - 1] < 0 && x[index] >= 0) count += 1
    return count
  }
  const amplitude = (series: number[]) => (Math.max(...series) - Math.min(...series)) / 2

  return {
    armAlternation: correlate(track.leftShoulder, track.rightShoulder),
    torsoCounterRotation: Math.abs(correlate(track.spineY, centred(track.leftShoulder))),
    kickCycles: crossings(track.leftHip),
    strokeCycles: crossings(track.leftShoulder),
    breathCycles: crossings(track.headY),
    headTurn: amplitude(track.headY),
    hipPitch: track.hipPitch.reduce((sum, value) => sum + value, 0) / track.hipPitch.length,
    speed: actor.naturalSwimSpeed,
  }
}

/** Continuity across the whole water sequence, entry and exit included. */
function measureSwimTransitions() {
  const { rig, holder } = makeRig()
  const actor = new HumanoidActor(rig, { seed: 17, state: 'idle' })
  actor.setLod('full')
  const snapshot = () => HUMANOID_BONES.map((bone) => actor.skeleton.bones[bone].quaternion.clone())
  const distance = (a: THREE.Quaternion[], b: THREE.Quaternion[]) =>
    a.reduce((sum, value, index) => sum + value.angleTo(b[index]), 0)

  for (let frame = 0; frame < 120; frame += 1) {
    actor.update(STEP)
    holder.updateMatrixWorld(true)
  }

  const steps: number[] = []
  let previous = snapshot()
  // The sequence a map traversal actually runs: push off, swim, climb out.
  const script: Array<[number, () => void]> = [
    [0, () => { actor.playGesture('swimEnter'); actor.setState('swim') }],
    [90, () => actor.setGroundSpeed(actor.naturalSwimSpeed)],
    [420, () => { actor.playGesture('swimExit'); actor.setState('idle') }],
  ]
  let cursor = 0
  for (let frame = 0; frame < 600; frame += 1) {
    while (cursor < script.length && script[cursor][0] === frame) {
      script[cursor][1]()
      cursor += 1
    }
    actor.update(STEP)
    holder.updateMatrixWorld(true)
    const current = snapshot()
    steps.push(distance(previous, current))
    previous = current
  }
  actor.dispose()

  const { ratio: worstRatio, excess: worstExcess, at: worstAt } = worstDiscontinuity(steps)
  return { worstRatio, worstExcess, worstAt, peakStep: Math.max(...steps) }
}

// ---------------------------------------------------------------------------
// 9. The ambient layer does not repeat.
//
// "Never plays twice identically" is the actual requirement, and it is not
// satisfied by having a lot of clips - a shuffled list of twelve is still
// twelve performances a viewer learns. What makes it true is that each
// occurrence picks its own size and speed, so the test is on the stream of
// (beat, amplitude, rate) triples the director emits over a long run: no
// immediate repeats, no short cycle, and a genuinely continuous spread of
// amplitudes rather than a handful of discrete values.
// ---------------------------------------------------------------------------

function measureBeatVariety() {
  const { rig, holder } = makeRig()
  const actor = new HumanoidActor(rig, { seed: 31, state: 'idle' })
  actor.setLod('medium')
  const director = new HumanoidBehaviorDirector()
  director.add(actor, 'portrait', 31)

  const fired: Array<{ gesture: string; amplitude: number; timeScale: number }> = []
  const original = actor.playGesture.bind(actor)
  actor.playGesture = (gesture, options) => {
    fired.push({
      gesture,
      amplitude: options?.amplitude ?? 1,
      timeScale: options?.timeScale ?? 1,
    })
    return original(gesture, options)
  }

  // Twenty minutes of screen time.
  for (let frame = 0; frame < 60 * 20 * 60; frame += 1) {
    director.update(STEP)
    actor.update(STEP)
    holder.updateMatrixWorld(true)
  }
  actor.dispose()

  let immediateRepeats = 0
  for (let index = 1; index < fired.length; index += 1) {
    if (fired[index].gesture === fired[index - 1].gesture) immediateRepeats += 1
  }

  // Recognisable repeats, scored the way a viewer would score them.
  //
  // Counting near-identical pairs anywhere in the run is the obvious test and
  // it is the wrong one. Amplitude and rate are drawn from continuous ranges,
  // so over a few hundred beats a handful of pairs land within a couple of
  // percent of each other purely by arithmetic - that is what a continuous
  // distribution does, and a generator that never produced such pairs would
  // have to be quantising, which is the actual defect. What matters is whether
  // a repeat is *noticeable*, and nobody compares a nod against one they saw
  // nine minutes ago. So the window is short: within the last eight beats -
  // roughly a minute of screen time - no two performances may be close enough
  // to read as the same one.
  const RECENT = 8
  let recognisableRepeats = 0
  // Also worth knowing, and stronger than a pass/fail: how close did the two
  // most similar performances in any window actually get?
  let closest = Infinity
  for (let index = 0; index < fired.length; index += 1) {
    for (let back = Math.max(0, index - RECENT); back < index; back += 1) {
      if (fired[index].gesture !== fired[back].gesture) continue
      const separation = Math.max(
        Math.abs(fired[index].amplitude - fired[back].amplitude),
        Math.abs(fired[index].timeScale - fired[back].timeScale),
      )
      closest = Math.min(closest, separation)
      if (separation <= .02) recognisableRepeats += 1
    }
  }

  // And the other way the ambient layer can betray itself: the beats can all
  // be individually distinct and still arrive in a repeating order, which is
  // a loop with extra steps.
  let period = 0
  for (let candidate = 1; candidate <= 40 && candidate * 2 <= fired.length; candidate += 1) {
    let periodic = true
    for (let index = candidate; index < fired.length && periodic; index += 1) {
      if (fired[index].gesture !== fired[index - candidate].gesture) periodic = false
    }
    if (periodic) { period = candidate; break }
  }

  const distinct = new Set(fired.map((entry) => entry.gesture)).size
  // How many performances are distinguishable at all, quantised at the 2%
  // resolution used above: this is the size of the space the director draws
  // from, versus the twelve clips it draws with.
  const performances = new Set(fired.map((entry) =>
    `${entry.gesture}:${Math.round(entry.amplitude * 50)}:${Math.round(entry.timeScale * 50)}`)).size
  const amplitudes = fired.map((entry) => entry.amplitude).sort((a, b) => a - b)
  const spread = amplitudes.length ? amplitudes[amplitudes.length - 1] - amplitudes[0] : 0
  return {
    total: fired.length,
    immediateRepeats,
    recognisableRepeats,
    closest: Number.isFinite(closest) ? closest : 1,
    period,
    distinct,
    performances,
    spread,
  }
}

// ---------------------------------------------------------------------------
// 10. Reduced motion arrives, and then stays.
//
// The original bug froze the clock at t=0. The fix has to satisfy two
// properties that pull in opposite directions and so are checked separately:
// the pose must be the *finished* one on the very first frame after a request,
// and it must then not move at all. A held pose that drifts is just a slow
// animation, which is the thing the preference asks not to happen.
// ---------------------------------------------------------------------------

function measureReducedStillness() {
  const { rig, holder } = makeRig()
  const actor = new HumanoidActor(rig, { seed: 4, state: 'idle', reduced: true })
  const snapshot = () => HUMANOID_BONES.map((bone) => actor.skeleton.bones[bone].quaternion.clone())
  const distance = (a: THREE.Quaternion[], b: THREE.Quaternion[]) =>
    a.reduce((sum, value, index) => sum + value.angleTo(b[index]), 0)

  actor.update(STEP)
  holder.updateMatrixWorld(true)

  // A state change: the new pose must be present immediately, not faded into.
  const beforeState = snapshot()
  actor.setState('presentBoard')
  actor.update(STEP)
  holder.updateMatrixWorld(true)
  const firstFrame = snapshot()
  const arrivalStep = distance(beforeState, firstFrame)

  let drift = 0
  for (let frame = 0; frame < 120; frame += 1) {
    actor.update(STEP)
    holder.updateMatrixWorld(true)
    drift = Math.max(drift, distance(firstFrame, snapshot()))
  }

  // The same for an additive beat, which is where the freeze originally bit.
  const beforeGesture = snapshot()
  actor.playGesture('considerTilt')
  actor.update(STEP)
  holder.updateMatrixWorld(true)
  const gestureFirst = snapshot()
  const gestureArrival = distance(beforeGesture, gestureFirst)
  let gestureDrift = 0
  for (let frame = 0; frame < 120; frame += 1) {
    actor.update(STEP)
    holder.updateMatrixWorld(true)
    gestureDrift = Math.max(gestureDrift, distance(gestureFirst, snapshot()))
  }
  actor.dispose()
  return { arrivalStep, drift, gestureArrival, gestureDrift }
}

// ---------------------------------------------------------------------------

const slideSkeletal = measureFootSlide('skeletal')
const slideLegacy = measureFootSlide('legacy')
report.push('')
report.push('--- Foot sliding during stance (lower is better) ---')
report.push(`  walking ground speed          ${slideSkeletal.speed.toFixed(2)} units/s`)
report.push(`  legacy   stance-half slip     ${slideLegacy.mean.toFixed(3)} units/s  (${(slideLegacy.mean / slideLegacy.speed * 100).toFixed(0)}% of body speed)`)
report.push(`  skeletal stance-half slip     ${slideSkeletal.mean.toFixed(3)} units/s  (${(slideSkeletal.mean / slideSkeletal.speed * 100).toFixed(0)}% of body speed)`)
report.push(`  legacy   frames truly planted ${(slideLegacy.plantedFraction * 100).toFixed(0)}%`)
report.push(`  skeletal frames truly planted ${(slideSkeletal.plantedFraction * 100).toFixed(0)}%  (a real walk is ~60% per foot)`)
check(
  'planted foot does not slide',
  slideSkeletal.mean < slideLegacy.mean * .25,
  `${(slideLegacy.mean / Math.max(1e-6, slideSkeletal.mean)).toFixed(1)}x less slip than legacy`,
)
// Measured against what the clip asks for, not against a number picked in
// advance. The walk's contact curve declares a stance window; the question
// worth asking is whether the foot is actually still for as much of the cycle
// as the animation says it should be. A fixed target would instead be
// measuring how the clip was authored, which is not what this check is for.
// Read the duty factor off the contact track itself rather than the derived
// window, which is expressed as a start/end pair and so cannot describe a
// stance that straddles the loop boundary - which a walk's does.
const walkClip = humanoidClipLibrary().clips.get('walk')
const contactTrack = walkClip?.tracks.find((track) => track.name.startsWith(ANIM_META_NODE))
const contactValues = contactTrack ? Array.from(contactTrack.values) : []
const leftContact = contactValues.filter((_, index) => index % 3 === 0)
// Two different questions. The mean of the curve is the clip's duty factor,
// which should land near the ~60% a real walk spends in stance. The share at
// full weight is the window where the solver actually owns the foot; contact
// deliberately ramps in and out so the leg hands over to and from the clip
// smoothly, and during those ramps the foot is expected to still be moving.
// Only the window where the weight has actually reached one is a fair target
// for "held completely still": at a weight of 0.9 the leg is still carrying a
// tenth of the clip's pose, and a tenth of a foot travelling at several times
// body speed is not stationary.
const meanDuty = leftContact.length
  ? leftContact.reduce((sum, value) => sum + value, 0) / leftContact.length
  : .45
const authoredStance = leftContact.length
  ? leftContact.filter((value) => value > .99).length / leftContact.length
  : .45
report.push(`  clip duty factor              ${(meanDuty * 100).toFixed(0)}% of the cycle in contact (a real walk is ~60%)`)
report.push(`  solver has full authority for ${(authoredStance * 100).toFixed(0)}% of the cycle`)
check(
  'each foot stays planted for the whole stance the clip asks for',
  slideSkeletal.plantedFraction > authoredStance * .85,
  `${(slideSkeletal.plantedFraction * 100).toFixed(0)}% of frames held still against ${(authoredStance * 100).toFixed(0)}% asked for, versus ${(slideLegacy.plantedFraction * 100).toFixed(0)}% legacy`,
)

// The office scene shrinks its staff to 0.46, and the skeleton takes all its
// limb lengths and its floor height from world-space measurements of the bind
// pose. A scale factor is therefore exactly the kind of thing that silently
// breaks foot planting - the legs reach in one unit system and the floor is in
// another - so the scale the real consumer uses is tested rather than assumed.
const slideScaled = measureFootSlide('skeletal', .46)
report.push(`  skeletal at office scale .46  ${(slideScaled.mean / slideScaled.speed * 100).toFixed(0)}% of body speed, ${(slideScaled.plantedFraction * 100).toFixed(0)}% planted`)
check(
  'foot planting survives a scaled rig',
  slideScaled.mean / slideScaled.speed < .2 && slideScaled.plantedFraction > .35,
  `${(slideScaled.mean / slideScaled.speed * 100).toFixed(0)}% slip at the scale the office scene uses`,
)

const jerkSkeletal = measureJerk('skeletal', 'full')
const jerkClipOnly = measureJerk('skeletal', 'medium')
const jerkLegacy = measureJerk('legacy')
report.push('')
report.push('--- Motion smoothness ---')
report.push(`  legacy                        ripple ${(jerkLegacy.ripple * 100).toFixed(2).padStart(5)}%   peak jerk ${jerkLegacy.peak.toFixed(0).padStart(6)} rad/s^3`)
report.push(`  skeletal, clips only          ripple ${(jerkClipOnly.ripple * 100).toFixed(2).padStart(5)}%   peak jerk ${jerkClipOnly.peak.toFixed(0).padStart(6)} rad/s^3`)
report.push(`  skeletal, clips + foot IK     ripple ${(jerkSkeletal.ripple * 100).toFixed(2).padStart(5)}%   peak jerk ${jerkSkeletal.peak.toFixed(0).padStart(6)} rad/s^3`)
report.push('  (ripple is high-frequency noise as a share of the joint\'s own peak speed)')
check(
  'clip playback carries no buzz',
  jerkClipOnly.ripple < .03,
  `${(jerkClipOnly.ripple * 100).toFixed(2)}% velocity ripple`,
)
check(
  'foot IK adds no visible jitter',
  jerkSkeletal.ripple < .05,
  `${(jerkSkeletal.ripple * 100).toFixed(2)}% velocity ripple`,
)

const detector = verifyDetector()
report.push('')
report.push('--- Discontinuity detector, checked against a known spike ---')
report.push(`  smooth dip-and-recover        ${detector.clean.toFixed(2)}x  (a legitimate acceleration profile must not fire)`)
report.push(`  same series, one frame +0.5   ${detector.dirty.toFixed(2)}x at frame ${detector.dirtyAt}`)
report.push(`  limit used below              ${POP_RATIO_LIMIT.toFixed(1)}x, or ${POP_EXCESS_LIMIT} rad in one frame`)
check(
  'the pop detector fires on a real pop and not on honest speed',
  detector.clean < .5 && detector.dirty > POP_RATIO_LIMIT,
  `${detector.clean.toFixed(2)}x on smooth motion, ${detector.dirty.toFixed(1)}x on a barely-visible injected jump`,
)

const pop = measureTransitionPop()
report.push('')
report.push('--- Crossfade continuity ---')
report.push(`  steady-state peak step        ${pop.steadyPeak.toFixed(4)} rad/frame`)
report.push(`  transition peak step          ${pop.transitionPeak.toFixed(4)} rad/frame`)
report.push(`  worst discontinuity           ${pop.worstSpike.toFixed(2)}x local median (${pop.worstSpikeAt || 'none above visibility floor'})
  largest single-frame excess   ${pop.largestExcess.toFixed(4)} rad summed over 16 bones`)
check(
  'state changes do not pop',
  pop.worstSpike < POP_RATIO_LIMIT && pop.largestExcess < POP_EXCESS_LIMIT,
  pop.worstSpikeAt
    ? `worst frame is ${pop.worstSpike.toFixed(2)}x its neighbours, ${pop.worstExcess.toFixed(3)} rad excess`
    : `no visible discontinuity; largest excess ${pop.largestExcess.toFixed(4)} rad over 16 bones`,
)

const seam = measureLoopSeams()
report.push('')
report.push('--- Loop seams ---')
report.push(`  worst first/last sample gap   ${seam.worst.toFixed(5)} rad (${seam.worstName})`)
check('looping clips loop seamlessly', seam.worst < .002, `${(seam.worst * 180 / Math.PI).toFixed(4)} degrees`)

const reduced = measureReducedPose()
report.push('')
report.push('--- Reduced motion held pose (must not be the neutral bind pose) ---')
reduced.results.forEach(({ label, delta }) => {
  report.push(`  ${label.padEnd(28)}  ${delta.toFixed(3)} rad from bind pose`)
})
report.push(`  celebrate gesture change      ${reduced.gestureDelta.toFixed(3)} rad`)
check(
  'reduced motion holds a real pose',
  reduced.results.every((entry) => entry.delta > .25) && reduced.gestureDelta > .25,
  'every state and gesture differs from bind pose',
)

const stillness = measureReducedStillness()
report.push(`  state change arrives in        1 frame, ${stillness.arrivalStep.toFixed(3)} rad of pose change`)
report.push(`  then drifts by                 ${stillness.drift.toFixed(6)} rad over the next 2s`)
report.push(`  additive beat arrives in       1 frame, ${stillness.gestureArrival.toFixed(3)} rad of pose change`)
report.push(`  then drifts by                 ${stillness.gestureDrift.toFixed(6)} rad over the next 2s`)
check(
  'reduced motion lands the finished pose on frame one',
  stillness.arrivalStep > .25 && stillness.gestureArrival > .05,
  `${stillness.arrivalStep.toFixed(2)} rad state change, ${stillness.gestureArrival.toFixed(2)} rad beat, both in a single frame`,
)
check(
  'reduced motion then holds completely still',
  stillness.drift < 1e-4 && stillness.gestureDrift < 1e-4,
  `${Math.max(stillness.drift, stillness.gestureDrift).toExponential(1)} rad of drift over 2s`,
)

report.push('')
report.push('--- Additive beats layer over a running base ---')
for (const gesture of ['nod', 'glance', 'cuffAdjust'] as const) {
  const layered = measureAdditiveLayering(gesture)
  report.push(`  ${gesture.padEnd(28)}  peak ${layered.peak.toFixed(3)} rad over base, base still moving ${(layered.baseAlive * 1000).toFixed(2)} mrad/frame beneath it, returns to ${layered.settled.toFixed(4)} rad`)
  check(
    `${gesture} is visible without stopping the idle`,
    layered.peak > .04 && layered.baseAlive > 1e-4 && layered.settled < .01,
    `${layered.peak.toFixed(3)} rad of beat, ${(layered.baseAlive * 1000).toFixed(2)} mrad/frame of base underneath`,
  )
  check(
    `${gesture} blends in and out without a pop`,
    layered.worstRatio < POP_RATIO_LIMIT,
    layered.worstRatio > 0
      ? `worst frame ${layered.worstRatio.toFixed(2)}x its neighbours`
      : 'no frame above the visibility floor',
  )
}

const swim = measureSwim()
const swimTransitions = measureSwimTransitions()
report.push('')
report.push('--- Swim ---')
report.push(`  natural swim speed            ${swim.speed.toFixed(2)} units/s`)
report.push(`  mean hip pitch                ${(swim.hipPitch * 180 / Math.PI).toFixed(1)} degrees (prone in the water)`)
report.push(`  arm correlation               ${swim.armAlternation.toFixed(2)} (-1 is perfect alternation)`)
report.push(`  torso counter-rotation        ${swim.torsoCounterRotation.toFixed(2)} correlation with the lead arm`)
report.push(`  cycles over 6s                ${swim.strokeCycles} strokes, ${swim.kickCycles} kicks, ${swim.breathCycles} breaths`)
report.push(`  head turn amplitude           ${(swim.headTurn * 180 / Math.PI).toFixed(1)} degrees`)
check(
  'the arms alternate rather than paddle together',
  swim.armAlternation < -.5,
  `${swim.armAlternation.toFixed(2)} correlation between shoulders`,
)
check(
  'the torso counter-rotates with the stroke',
  swim.torsoCounterRotation > .4,
  `${swim.torsoCounterRotation.toFixed(2)} correlation between spine yaw and the lead arm`,
)
check(
  'the legs flutter faster than the arms stroke',
  swim.kickCycles > swim.strokeCycles * 1.5,
  `${swim.kickCycles} kicks per ${swim.strokeCycles} strokes`,
)
check(
  'the head turns to breathe, on its own slower beat',
  swim.headTurn > .1 && swim.breathCycles > 0 && swim.breathCycles < swim.strokeCycles,
  `${(swim.headTurn * 180 / Math.PI).toFixed(0)} degrees every ${(swim.strokeCycles / Math.max(1, swim.breathCycles)).toFixed(1)} strokes`,
)
report.push(`  entry/exit worst frame        ${swimTransitions.worstRatio.toFixed(2)}x local median (${swimTransitions.worstExcess.toFixed(3)} rad excess, frame ${swimTransitions.worstAt})`)
check(
  'entering and leaving the water does not pop',
  swimTransitions.worstRatio < POP_RATIO_LIMIT && swimTransitions.worstExcess < POP_EXCESS_LIMIT,
  swimTransitions.worstRatio > 0
    ? `worst frame is ${swimTransitions.worstRatio.toFixed(2)}x its neighbours`
    : 'no frame above the visibility floor across the whole sequence',
)

const variety = measureBeatVariety()
report.push('')
report.push('--- Ambient beats do not repeat ---')
report.push(`  beats fired in 20 minutes     ${variety.total} drawn from ${variety.distinct} distinct gestures`)
report.push(`  distinguishable performances  ${variety.performances} of ${variety.total} were unique in gesture, size and rate`)
report.push(`  back-to-back repeats          ${variety.immediateRepeats}`)
report.push(`  repeats within a minute       ${variety.recognisableRepeats}`)
report.push(`  closest two ever came         ${(variety.closest * 100).toFixed(1)}% apart in size or rate`)
report.push(`  shortest repeating period     ${variety.period || 'none up to 40 beats'}`)
report.push(`  amplitude spread              ${variety.spread.toFixed(2)}`)
check(
  'no beat ever follows itself',
  variety.immediateRepeats === 0,
  `${variety.total} beats, ${variety.distinct} distinct, none repeated back to back`,
)
check(
  'no performance recurs while it is still recognisable',
  variety.recognisableRepeats === 0,
  `nearest pair in any 8-beat window is ${(variety.closest * 100).toFixed(1)}% apart, across ${variety.total} beats`,
)
check(
  'the beat order never falls into a cycle',
  variety.period === 0,
  'no repeating period up to 40 beats',
)

const limits = measureJointLimits()
report.push('')
report.push('--- Anatomical limits across all clips ---')
report.push(`  most negative knee flexion    ${limits.worstKnee.toFixed(4)} rad`)
report.push(`  most positive elbow extension ${limits.worstElbow.toFixed(4)} rad`)
check('knees never bend backwards', limits.worstKnee > -.05, `min ${limits.worstKnee.toFixed(4)} rad`)
check('elbows never hyperextend', limits.worstElbow < .15, `max ${limits.worstElbow.toFixed(4)} rad`)

report.push('')
process.stdout.write(`${report.join('\n')}\n`)
if (failures.length) {
  process.stdout.write(`\n${failures.length} CHECK(S) FAILED: ${failures.join(', ')}\n`)
  process.exit(1)
}
process.stdout.write('\nAll checks passed.\n')
