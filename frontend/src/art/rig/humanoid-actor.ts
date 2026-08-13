import * as THREE from 'three'

import {
  ANIM_META_NODE,
  ROOT_MOTION_NODE,
  humanoidClipLibrary,
  type ClipLibrary,
  type ClipMeta,
} from './humanoid-clips'
import {
  HUMANOID_BONES,
  REST_OFFSET_GROUPS,
  applyWorldQuaternion,
  bindHumanoidSkeleton,
  clampJoint,
  solveLegIK,
  type BindableRig,
  type HumanoidBone,
  type HumanoidSkeleton,
  type RestOffsetGroup,
} from './humanoid-rig'

/**
 * Drives one stylized character from the shared humanoid clip library.
 *
 * The character's geometry, materials and silhouette are exactly what
 * `buildStylizedCounsel` produced - this class never creates or edits a single
 * mesh. All it replaces is the motion source: instead of a few hundred lines
 * of per-frame trigonometry writing joint rotations directly, an
 * `AnimationMixer` plays authored humanoid clips and crossfades between them,
 * and a small post-pass handles the things a mixer cannot: retargeting
 * normalized root motion onto this character's measured proportions, planting
 * the stance foot so it does not slide, and keeping joints inside anatomical
 * limits.
 */

/** States that loop until something else is requested. */
export type HumanoidState =
  | 'idle'
  | 'idleWeightShift'
  | 'idleRelaxed'
  | 'idleAlert'
  | 'walk'
  | 'swim'
  | 'seatedIdle'
  | 'seatedType'
  // The four desk tasks. Everyone seated in the office is doing exactly one of
  // these, so between them they carry most of the motion anybody ever sees in
  // that room; they are authored at correspondingly more length than the rest
  // of the library. See their specs in `humanoid-clips.ts`.
  | 'deskWrite'
  | 'deskType'
  | 'deskRead'
  | 'deskSort'
  | 'confer'
  | 'reviewDocument'
  | 'presentBoard'

/** The resting stances the ambient idle drifts between. */
export const IDLE_STATES: readonly HumanoidState[] = ['idle', 'idleWeightShift', 'idleRelaxed', 'idleAlert']

/** The four things anybody seated at a desk in the office is ever doing. */
export const DESK_STATES: readonly HumanoidState[] = ['deskWrite', 'deskType', 'deskRead', 'deskSort']

/**
 * One-shot beats.
 *
 * They come in two kinds and the difference is visible. The first five are
 * whole-body events - sitting, standing, a victory - which genuinely replace
 * what the body was doing, so they crossfade the base state out and back. The
 * rest are additive: they are deltas layered over a base state that keeps
 * running underneath, so the character carries on breathing and shifting its
 * weight while it nods.
 */
export type HumanoidGesture =
  | 'sitDown'
  | 'standUp'
  | 'celebrate'
  | 'swimEnter'
  | 'swimExit'
  | 'nod'
  | 'glance'
  | 'glanceMirrored'
  | 'breathDeep'
  | 'weightSettle'
  | 'weightSettleMirrored'
  | 'cuffAdjust'
  | 'cuffAdjustMirrored'
  | 'postureReset'
  | 'considerTilt'
  | 'considerTiltMirrored'
  | 'handFlex'
  | 'acknowledge'
  | 'acknowledgeMirrored'
  | 'courtBow'
  | 'checkWatch'
  | 'checkWatchMirrored'
  | 'stretch'
  | 'rollShoulders'
  | 'scanRoom'
  | 'scanRoomMirrored'
  | 'resolve'
  | 'doubleTake'
  | 'doubleTakeMirrored'
  | 'breathSigh'
  | 'weightTransfer'
  | 'weightTransferMirrored'
  // The six silhouette beats. Large enough to change the outline of the body,
  // which is what the close framings needed and the small fidgets could not
  // give them.
  | 'handToChin'
  | 'handToChinMirrored'
  | 'foldArms'
  | 'emphasise'
  | 'emphasiseMirrored'
  | 'braceUp'
  | 'turnAway'
  | 'turnAwayMirrored'
  | 'neckRelease'
  | 'neckReleaseMirrored'
  | 'shoulderDrop'

/**
 * The layered idle repertoire, in the order a director should reach for it:
 * the cheapest and least noticeable beats first.
 */
export const IDLE_GESTURES: readonly HumanoidGesture[] = [
  'handFlex', 'breathDeep', 'breathSigh', 'nod', 'glance', 'glanceMirrored',
  'weightSettle', 'weightSettleMirrored', 'weightTransfer', 'weightTransferMirrored',
  'postureReset', 'resolve', 'doubleTake', 'doubleTakeMirrored',
  'cuffAdjust', 'cuffAdjustMirrored', 'considerTilt', 'considerTiltMirrored',
  'neckRelease', 'neckReleaseMirrored', 'shoulderDrop', 'emphasise',
  'emphasiseMirrored', 'braceUp', 'turnAway', 'turnAwayMirrored',
  'handToChin', 'handToChinMirrored', 'foldArms',
]

/**
 * How expensive this actor is allowed to be this frame.
 *
 * Skeletal playback costs meaningfully more than the old inline math, and the
 * office and map can both hold a lot of characters, so cost is graded rather
 * than uniform. The expensive parts - foot IK, joint clamping, the extra world
 * matrix update they need - only run for characters close enough for anyone to
 * notice, and distant background actors drop to a lower update rate. Nothing
 * about the pose changes between levels, only how often and how precisely it
 * is computed, so an actor changing level does not visibly pop.
 */
export type HumanoidLod = 'full' | 'medium' | 'low' | 'frozen'

const LOD_INTERVAL: Record<HumanoidLod, number> = {
  full: 0,
  medium: 0,
  low: 1 / 18,
  frozen: Infinity,
}

/** Crossfade durations, in seconds, keyed `from>to`. */
const TRANSITIONS: Record<string, number> = {
  'idle>walk': .22,
  'walk>idle': .30,
  'idleWeightShift>walk': .24,
  'walk>idleWeightShift': .32,
  'idle>idleWeightShift': 1.10,
  'idleWeightShift>idle': 1.10,
  'idle>idleRelaxed': 1.25,
  'idleRelaxed>idle': 1.25,
  'idleWeightShift>idleRelaxed': 1.30,
  'idleRelaxed>idleWeightShift': 1.30,
  'idleRelaxed>walk': .24,
  'walk>idleRelaxed': .32,
  // Drifts into and out of the attentive stance.
  //
  // Longer than the fades between the three relaxed stances, and deliberately
  // asymmetric: a body settles out of attention more slowly than it comes to
  // it, because coming to attention is something you decide and relaxing is
  // something you stop doing. The pair also carries the largest pelvis travel
  // of any idle-to-idle fade, since this stance stands furthest forward, and
  // the crossfade is where that weight transfer actually happens.
  'idle>idleAlert': 1.05,
  'idleAlert>idle': 1.30,
  'idleWeightShift>idleAlert': 1.15,
  'idleAlert>idleWeightShift': 1.40,
  'idleRelaxed>idleAlert': 1.20,
  'idleAlert>idleRelaxed': 1.50,
  'idleAlert>walk': .22,
  'walk>idleAlert': .30,
  'seatedIdle>seatedType': .45,
  'seatedType>seatedIdle': .55,
  // Changing state directly between sitting and standing, without going
  // through the authored `sitDown` / `standUp` beats.
  //
  // Nothing in the app does this - the office plays the beat - but the state
  // machine allows it and it must not snap when it happens. It needs far more
  // time than a normal crossfade because the legs are not simply blending two
  // poses: the hips travel half a hip-height vertically, and the foot solver
  // has to keep the feet where they are throughout, so the knee angle is
  // driven by the body's height rather than by the fade weight. That
  // relationship is steep near standing, which means a short fade arrives at
  // full extension almost instantly and then stops dead.
  'seatedIdle>idle': .95,
  'idle>seatedIdle': .95,
  'seatedType>idle': .95,
  'idle>seatedType': .95,
  'idle>confer': .40,
  'confer>idle': .45,
  // Entering and leaving the water go through their own authored transitions
  // rather than a crossfade, so these are near-instant handovers onto a clip
  // that already starts in the pose the transition finished in.
  'swim>idle': .30,
  'idle>swim': .30,
}
const DEFAULT_FADE = .34

/**
 * How long a crossfade between two states takes, before any per-actor jitter.
 *
 * Exported because the behaviour director wants to vary it. A drift between
 * resting stances that always takes exactly 1.10 seconds is a metronome the
 * moment a viewer has seen it twice, and the only way for the director to
 * scale that number is to be able to read it - hard-coding a second copy of
 * the table there is how the two would drift apart.
 */
export function humanoidTransitionFade(from: HumanoidState, to: HumanoidState) {
  return TRANSITIONS[`${from}>${to}`] ?? DEFAULT_FADE
}

export type HumanoidActorOptions = {
  /** Per-actor variation seed. Two actors with different seeds never fall
   *  into visible lockstep even while sharing the same clips. */
  seed?: number
  /** Starting looping state. */
  state?: HumanoidState
  reduced?: boolean
  /** See `setExpressionGain`. */
  expression?: number
  /** See `setSecondaryMotion`. */
  secondary?: number
}

// ---------------------------------------------------------------------------
// Secondary motion, as a physical layer rather than more keyframes.
//
// Overlapping action and follow-through are authored into the clip library as
// phase offsets down each chain, which is the right place for the part of the
// effect that belongs to a specific performance. It cannot be the whole story,
// though, for a reason that is structural rather than a matter of how well the
// curves are tuned: a baked phase offset only exists inside a clip. The moment
// two clips crossfade, the mixer is interpolating two poses and the lag in
// each of them is being blended away along with everything else, so precisely
// at a transition - which is where a body most obviously has mass, and where
// this system has been criticised for snapping - there is no follow-through at
// all.
//
// The fix is to let the distal joints be dragged rather than driven. Each
// lagging joint keeps a damped-spring follower of whatever is pulling it, and
// expresses the gap between the two as a counter-rotation. That single
// mechanism produces every part of the read:
//
//   - the parent accelerates, the follower falls behind, the child lags;
//   - the parent holds a constant rate, the lag settles to a constant offset;
//   - the parent stops, the follower coasts past it and the child overshoots;
//   - the error rings down at the spring's own frequency and the child settles.
//
// It is also exactly zero when nothing is moving, which is the property that
// matters most here. A noise-driven or oscillator-driven "aliveness" layer
// keeps producing output in a still pose and reads as a tremor; this one has
// the still pose as its fixed point, so the standing requirement of zero
// jitter is a consequence of the model rather than something to tune for.
// ---------------------------------------------------------------------------

type LagBone = {
  node: THREE.Object3D
  /** Index into the driver table built each frame. */
  driver: number
  /** What fraction of the driver's overshoot this joint expresses. */
  gain: number
  /** Natural frequency of the follower, rad/s. Heavier segments are slower. */
  omega: number
  /**
   * Damping ratio. Deliberately below one - a critically damped follower has
   * no overshoot at all, and overshoot is half of what follow-through means -
   * but well above the point where the ring is audible as a wobble.
   */
  zeta: number
  /** Hard ceiling on the lag angle, radians. */
  limit: number
  /** Visible in a head-and-shoulders crop, and so worth a `medium` actor's
   *  time. Everything else waits for `full`. */
  close: boolean
  /** The follower's orientation, in the same frame as its driver. */
  filter: THREE.Quaternion
  /** The follower's angular velocity, in its own local frame. */
  velocity: THREE.Vector3
  seeded: boolean
}

/**
 * Which joints are dragged, by what, and how heavily.
 *
 * Successive breaking of joints, stated as data: each entry names the driver
 * one link up the chain, so the head trails the chest, the upper arm trails
 * the chest a little less, the forearm trails the upper arm, and the hand
 * trails the forearm most of all. Frequency falls and the ring gets longer the
 * further out the chain a joint sits, which is what having progressively less
 * muscle holding a progressively floppier segment produces.
 *
 * `close` marks the joints a head-and-shoulders crop can actually see. They
 * are the only ones a `medium` actor pays for, which is what lets the portrait
 * carry the whole effect at a fraction of the cost of the full set.
 */
const LAG_PLAN: ReadonlyArray<{
  bone: HumanoidBone
  driver: number
  gain: number
  omega: number
  zeta: number
  limit: number
  close: boolean
}> = [
  // The head is the payload. It is the heaviest thing on the end of the most
  // flexible joint in the body, it is what a portrait is pointed at, and a
  // head that arrives exactly with the shoulders is the single clearest tell
  // that a figure is one rigid piece.
  { bone: 'head', driver: 0, gain: .62, omega: 12.5, zeta: .58, limit: .16, close: true },
  { bone: 'leftShoulder', driver: 0, gain: .40, omega: 18, zeta: .68, limit: .11, close: true },
  { bone: 'rightShoulder', driver: 0, gain: .40, omega: 18, zeta: .68, limit: .11, close: true },
  { bone: 'leftElbow', driver: 1, gain: .46, omega: 15, zeta: .60, limit: .16, close: false },
  { bone: 'rightElbow', driver: 2, gain: .46, omega: 15, zeta: .60, limit: .16, close: false },
  { bone: 'leftHand', driver: 3, gain: .52, omega: 13, zeta: .52, limit: .20, close: false },
  { bone: 'rightHand', driver: 4, gain: .52, omega: 13, zeta: .52, limit: .20, close: false },
]

/**
 * How far each joint's animated rotation is scaled at full expression gain.
 *
 * The clip library is authored for a full-body framing, and correctly so: two
 * degrees of head sway is what quiet standing actually looks like, and at a
 * figure standing in a room it reads as a person breathing. The portrait crop
 * is a different picture of the same body - a head and a collar filling five
 * hundred pixels - and the same two degrees moves the crown of the head by
 * about three pixels over five and a half seconds, which is to say it does not
 * read as anything.
 *
 * This file already has that argument on record about the hands, where the
 * conclusion was to author bigger numbers. That is the wrong lever for a crop,
 * because it would enlarge the motion on every surface to fix one of them. A
 * gain applied to the animated delta - the rotation away from this character's
 * own authored rest, not the rest itself - keeps the posture and the shape of
 * every curve exactly as authored and only changes how far it travels, so one
 * clip library serves both framings and the close-up gets a performance scaled
 * to the lens it is seen through.
 *
 * The shares fall off down the body because the crop does: the head is
 * entirely in frame, the shoulders are at its bottom edge, and the pelvis is
 * a metre below it, so amplifying the hips would buy nothing and cost the
 * grounding pass real work.
 */
const EXPRESSION_SHARE: Partial<Record<HumanoidBone, number>> = {
  head: 1,
  chest: .62,
  spine: .48,
  leftShoulder: .55,
  rightShoulder: .55,
  leftElbow: .32,
  rightElbow: .32,
}

/**
 * Scales a rotation's angle about its own axis, in place.
 *
 * Done as an explicit angle rather than by slerping away from the identity,
 * because the interesting case is `gain > 1` and that is extrapolation:
 * `Quaternion.slerp` handles it, but falls back to a normalized linear blend
 * whenever the angle is small, which is most of an idle. Reading the angle out
 * and putting a multiple of it back is exact everywhere and about the same
 * cost.
 */
const MAX_SCALED_HALF_ANGLE = 1.15

function scaleRotation(quaternion: THREE.Quaternion, gain: number) {
  if (gain === 1) return quaternion
  let { x, y, z, w } = quaternion
  // Both signs describe the same rotation; picking the positive-w one puts the
  // half-angle in [0, pi/2] so scaling it cannot silently take the short way
  // round a rotation that was stored the long way.
  if (w < 0) { x = -x; y = -y; z = -z; w = -w }
  const sin = Math.hypot(x, y, z)
  if (sin < 1e-7) return quaternion
  const half = Math.min(Math.atan2(sin, w) * gain, MAX_SCALED_HALF_ANGLE)
  const scale = Math.sin(half) / sin
  return quaternion.set(x * scale, y * scale, z * scale, Math.cos(half))
}

const CLAMPED_BONES = HUMANOID_BONES.filter((bone) => bone !== 'hips')

/**
 * How much of a character's own resting stance each pose keeps.
 *
 * Absent from this table means all of it, which is what every pose did before
 * the table existed, so nothing already shipped changes. The desk poses are
 * the exception and the reason it exists: their arms are on a keyboard, a pen
 * or a page and their legs are folded under a chair, and the resting stance
 * describes neither - it describes how this person stands in a corridor. See
 * `RestOffsetGroup` for the full argument.
 *
 * Torso stays at one throughout. The head tilt and ribcage lean are what make
 * two characters at identical desks read as two people.
 */
const STATE_REST_WEIGHT: Partial<Record<HumanoidState, Partial<Record<RestOffsetGroup, number>>>> = {
  deskWrite: { arms: 0, legs: 0 },
  deskType: { arms: 0, legs: 0 },
  deskRead: { arms: 0, legs: 0 },
  deskSort: { arms: 0, legs: 0 },
}

const FULL_REST_WEIGHT: Record<RestOffsetGroup, number> = { torso: 1, arms: 1, legs: 1 }
const scaledRest = new THREE.Quaternion()

/**
 * How a look-at is shared out along the spine, and how far each joint will go.
 *
 * Nobody turns their head to look at something and leaves their chest facing
 * where it was - past about thirty degrees the shoulders come round too, and a
 * head that swivels alone on a still torso is the owl-neck effect that makes a
 * character read as a puppet. So the chest takes a third of the turn and the
 * head takes the rest, and both are clamped to angles a neck can actually
 * reach. The chest's pitch limit is deliberately small: leaning back to look
 * up is a whole-body action this layer has no business attempting.
 *
 * Ordered proximal to distal, and applied in that order, because each joint
 * aims at the target from wherever the one above it has already put it.
 */
const LOOK_CHAIN: readonly [HumanoidBone, number, number, number][] = [
  ['chest', .34, .52, .16],
  ['head', 1, .82, .46],
]

const lookMatrix = new THREE.Matrix4()
const lookLocal = new THREE.Vector3()
const lookEuler = new THREE.Euler()
const lookQuaternion = new THREE.Quaternion()

const tmpFootWorld = new THREE.Vector3()
const tmpTarget = new THREE.Vector3()
const tmpHipWorld = new THREE.Vector3()
const seatedForward = new THREE.Vector3()
const bendAxis = new THREE.Vector3(1, 0, 0)
const fkHip = new THREE.Quaternion()
const fkKnee = new THREE.Quaternion()
const ikHip = new THREE.Quaternion()
const ikKnee = new THREE.Quaternion()

const soleAnkle = new THREE.Vector3()
const soleCorner = new THREE.Vector3()
const soleHeading = new THREE.Vector3()
const soleBasis = new THREE.Matrix4()
const soleOrigin = new THREE.Vector3()
const soleUp = new THREE.Vector3(0, 1, 0)
const soleCurrent = new THREE.Quaternion()
const soleFlat = new THREE.Quaternion()
const soleCandidate = new THREE.Quaternion()

/** Scratch for the secondary-motion and expression passes. */
const lagDrivers = [
  new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(),
  new THREE.Quaternion(), new THREE.Quaternion(),
]
const lagError = new THREE.Quaternion()
const lagStep = new THREE.Quaternion()
const lagApply = new THREE.Quaternion()
const lagAxis = new THREE.Vector3()
const hairDriver = new THREE.Quaternion()

/**
 * The hair follower's own constants.
 *
 * Slower and looser than any joint in `LAG_PLAN`, which is the point: a neck
 * holds a head, and nothing holds hair. `omega` is a little over half the
 * head's, so the settle is visible as a settle rather than as a twitch; `zeta`
 * is well under critical so it swings past and comes back; and the ceiling is
 * twice the head's, because a lag of nine degrees at the crown is a couple of
 * centimetres at the ends of a long cut and reads as almost nothing.
 *
 * The ceiling is what keeps this honest against the one failure this technique
 * has. The shell is rigid geometry sitting a centimetre or two off the skull,
 * so a large enough rotation pushes the scalp through it. Nine degrees at the
 * pivot moves the nape by about two centimetres against a nape standoff of
 * eleven to seventeen, so the mass stays outside the head at full deflection on
 * every one of the six cuts.
 */
const HAIR_OMEGA = 7.4
const HAIR_ZETA = .34
const HAIR_LIMIT = .16
/** Radians of pitch per unit of vertical head speed. See `advanceHair`. */
const HAIR_BOB = .085
const gainDelta = new THREE.Quaternion()
/** The four corners of the sole, as multipliers of (halfWidth, depth, toe/heel). */
const SOLE_CORNERS: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

/**
 * One action's weight on its way somewhere, eased rather than ramped.
 *
 * `AnimationAction.crossFadeTo` moves weight linearly, and linear is the wrong
 * shape for a crossfade. While a fade runs, the blended pose travels between
 * the two clips' poses at a speed proportional to the rate of weight change,
 * so a linear ramp means that travel starts at full speed on the first frame
 * of the fade and stops dead on the last. The pose is continuous throughout -
 * which is why this is invisible to any check that only looks at poses - but
 * its velocity steps twice, and a velocity step is exactly what an eye reads
 * as a snap. It is the largest remaining source of the jerk this system was
 * built to remove, and it is present on every single state change.
 *
 * Easing the weight with a curve whose first and second derivatives both
 * vanish at each end removes both steps: the blend accelerates away from the
 * old pose and decelerates into the new one.
 */
type FadeChannel = {
  action: THREE.AnimationAction
  start: number
  target: number
  elapsed: number
  duration: number
}

type PlantedFoot = {
  active: boolean
  anchor: THREE.Vector3
  /**
   * How much the IK solution overrides the clip for this leg, 0 to 1.
   *
   * Engaging IK the instant a contact flag flips produces a one-frame jump in
   * the hip and knee - the clip's idea of where the leg should be and the
   * solver's differ slightly, and switching between them abruptly is itself a
   * pop. Ramping the weight makes the handover invisible, and ramping it back
   * down on toe-off means the leg is already following the clip again by the
   * time it swings.
   */
  weight: number
  /** Foot world position sampled before any IK ran this frame. */
  sampled: THREE.Vector3
}

/** How fast an anchor that engaged in mid-air sinks to the floor, as a damping
 *  rate. Roughly a tenth of a second to close the gap: fast enough to look
 *  like the foot found the ground, slow enough that no single frame jumps. */
const ANCHOR_SETTLE_RATE = 22

/** Depth and angular rate of the resting-clip rate wander. See
 *  `driftRestingRate`. The rate is 2*pi/37.3s, which shares no factor with any
 *  clip period in the library, and the depth is four percent. */
const REST_RATE_DRIFT = .04
const REST_RATE_DRIFT_RATE = Math.PI * 2 / 37.3

/** How far one full front-crawl stroke carries the body, in hip-heights. */
const SWIM_STROKE_BODY_LENGTHS = 2.15
/**
 * Fastest the stroke may be driven, as a multiple of its authored rate.
 *
 * A ceiling exists so that a consumer feeding a speed the clip cannot represent
 * gets a fast swimmer rather than a blur. Where it sits is a measurement, not a
 * taste: the Treaty Sea traversal cruises counsel at 1.90 world units per
 * second against a natural swim speed of 0.617, so it demands 3.08, and at the
 * old ceiling of 2.0 the stroke accounted for only 64% of the travel — the
 * swimmer was being towed by the traversal curve. Set from the fastest thing
 * that actually swims on any map, with headroom for the ramp either side of the
 * cruise, so the clamp no longer binds in normal play.
 *
 * Raising it is the right half of the fix to reach for. The alternative, a
 * larger `SWIM_STROKE_BODY_LENGTHS`, would make the same ratio read 1.0 by
 * asserting each stroke carries the body further, while the arms kept turning
 * over at exactly the rate that looked towed: that improves the number and not
 * the animation. 2.15 hip-heights is a real front crawl and stays.
 */
const SWIM_RATE_CEILING = 3.6

export class HumanoidActor {
  readonly skeleton: HumanoidSkeleton
  readonly root: THREE.Object3D
  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private readonly library: ClipLibrary
  private readonly meta: Map<string, ClipMeta>
  private readonly rootMotionNode: THREE.Object3D
  private readonly animMetaNode: THREE.Object3D
  private readonly baseHipPosition = new THREE.Vector3()
  /** The character's world orientation, refreshed once per frame so the foot
   *  solver can work in the character's own forward/up axes. */
  private readonly rootQuaternion = new THREE.Quaternion()
  private readonly fades = new Map<THREE.AnimationAction, FadeChannel>()
  /**
   * Uniform world scale of the character, refreshed each frame.
   *
   * The skeleton measures its own proportions in the character's local space,
   * which is the only sensible place to measure them - they have to survive a
   * consumer parenting the rig under anything. Foot planting, though, happens
   * in world space, because that is where the floor is. The two agree only
   * while the character is at scale one, and the office scene runs its staff
   * at 0.46, so every local length crossing into a world-space calculation
   * goes through here. Getting this wrong does not look like a unit bug; it
   * looks like the feet skating again, only at some scales and not others.
   */
  private worldScale = 1
  private readonly planted: Record<'left' | 'right', PlantedFoot> = {
    left: { active: false, anchor: new THREE.Vector3(), weight: 0, sampled: new THREE.Vector3() },
    right: { active: false, anchor: new THREE.Vector3(), weight: 0, sampled: new THREE.Vector3() },
  }

  /**
   * Distance one walk cycle covers, in hip-heights, measured from the clip
   * rather than declared alongside it.
   *
   * Declaring it by hand is how foot sliding creeps back in: the number and
   * the curves drift apart the moment anyone retunes a hip angle, and the
   * mismatch shows up as skating that looks like an easing problem and is not
   * one. Deriving it from the clip's own leg swing means the two cannot
   * disagree, and it retargets for free, since a character with shorter legs
   * measures a proportionally shorter stride.
   */
  private strideLength = 0

  private current: HumanoidState
  private gesture: HumanoidGesture | null = null
  private lodLevel: HumanoidLod = 'full'
  private accumulated = 0
  private reduced: boolean
  private settled = false
  /** Small per-actor timing and posture offsets, described below. */
  private readonly rateJitter: number
  private readonly asymmetry: number
  /** The slow rate wander applied to resting states. See `driftRestingRate`. */
  private restClock = 0
  /** Live per-group rest-offset weight, eased toward the current state's. */
  private restWeights: Record<RestOffsetGroup, number> = { ...FULL_REST_WEIGHT }
  /** Look-at layer. `lookWanted` is the requested weight, `lookWeight` the
   *  eased one; both stay at zero for every character that never opts in. */
  private lookTarget: THREE.Vector3 | null = null
  private lookWanted = 0
  private lookWeight = 0
  private readonly restPhaseOffset: number
  /** A base action to restart at the top of the next update. See `onGestureFinished`. */
  private pendingRestart: THREE.AnimationAction | null = null
  /** The mixer's own output, and what the post pass left, per bone. See `reclaimMixerPose`. */
  private readonly mixerPose = HUMANOID_BONES.map(() => new THREE.Quaternion())
  private readonly appliedPose = HUMANOID_BONES.map(() => new THREE.Quaternion())
  private posed = false

  /**
   * Each joint's authored rest orientation, captured before anything animates.
   *
   * This is the reference the expression gain scales away from, and it has to
   * be the character's *own* rest rather than the library's canonical one:
   * scaling from canonical would treat every character's authored posture -
   * an open shoulder stance, a head carried slightly to one side - as part of
   * the performance and amplify that too, which would change how the character
   * looks standing still rather than how much it moves.
   */
  private readonly bindPose = new Map<THREE.Object3D, THREE.Quaternion>()
  private readonly lagBones: LagBone[] = []
  private expressionGain = 1
  private secondaryGain = 1
  /** The hair follower. See `advanceHair`. */
  private readonly hairFilter = new THREE.Quaternion()
  private readonly hairVelocity = new THREE.Vector3()
  private hairSeeded = false
  private hairLastLift = 0
  private hairLastRise = 0

  constructor(rig: BindableRig, options: HumanoidActorOptions = {}) {
    this.skeleton = bindHumanoidSkeleton(rig)
    this.root = rig.root
    for (const bone of HUMANOID_BONES) {
      const node = this.skeleton.bones[bone]
      this.bindPose.set(node, node.quaternion.clone())
    }
    for (const plan of LAG_PLAN) {
      this.lagBones.push({
        node: this.skeleton.bones[plan.bone],
        driver: plan.driver,
        gain: plan.gain,
        omega: plan.omega,
        zeta: plan.zeta,
        limit: plan.limit,
        close: plan.close,
        filter: new THREE.Quaternion(),
        velocity: new THREE.Vector3(),
        seeded: false,
      })
    }
    this.expressionGain = Math.max(.25, options.expression ?? 1)
    this.secondaryGain = THREE.MathUtils.clamp(options.secondary ?? 1, 0, 2)
    this.baseHipPosition.copy(rig.hips.position)
    // Put the soles on the floor.
    //
    // Everything downstream - this class's own foot planting, the office's
    // placement of a character on the boards, the portrait's contact shadow -
    // treats the rig root's origin as the ground the character stands on. The
    // bind pose does not honour that: `buildStylizedCounsel` varies height by
    // raising the pelvis over fixed-length legs, so the soles rest a fifth of
    // a unit above the origin, by a different amount for every seed. Left
    // alone, characters hovered several centimetres over the floor at visibly
    // different heights, and the foot solver could not correct it because it
    // measured its own floor from the same wrong assumption.
    //
    // Lowering the pelvis by that offset moves the whole body down onto the
    // ground with the legs still straight, which is the pose the art intended;
    // it changes where the character sits relative to its root, and nothing
    // about the character itself.
    this.baseHipPosition.y -= this.skeleton.proportions.soleOffset
    rig.hips.position.y = this.baseHipPosition.y
    // Establish the scale immediately. `naturalWalkSpeed` reports in world
    // units and consumers read it to size their routes before the first
    // update has run, so leaving this at one until then hands out a speed in
    // the wrong unit system at exactly the moment it is used.
    this.refreshWorldScale()

    // Both proxy nodes are empty and hidden, so they cost nothing to render.
    // They exist purely so that root translation and foot-contact state pass
    // through the mixer and get blended by the same weights as the joint
    // rotations during a crossfade.
    this.rootMotionNode = new THREE.Object3D()
    this.rootMotionNode.name = ROOT_MOTION_NODE
    this.rootMotionNode.visible = false
    this.rootMotionNode.matrixAutoUpdate = false
    rig.root.add(this.rootMotionNode)

    this.animMetaNode = new THREE.Object3D()
    this.animMetaNode.name = ANIM_META_NODE
    this.animMetaNode.visible = false
    this.animMetaNode.matrixAutoUpdate = false
    rig.root.add(this.animMetaNode)

    this.library = humanoidClipLibrary()
    this.meta = this.library.meta
    this.mixer = new THREE.AnimationMixer(rig.root)

    const seed = options.seed ?? 0
    // A few percent of playback-rate spread is enough that a room of people
    // sharing one idle clip drifts apart within seconds instead of breathing
    // in unison, which is an instant giveaway that they are copies.
    this.rateJitter = 1 + (((Math.imul(seed ^ 0x9e3779b1, 2654435761) >>> 0) % 1000) / 1000 - .5) * .13
    // Real bodies are not mirror-symmetric. A degree or two of persistent
    // left/right difference removes the uncanny perfection of a pose computed
    // as an exact reflection.
    this.asymmetry = (((Math.imul(seed ^ 0x85ebca6b, 2246822519) >>> 0) % 1000) / 1000 - .5) * .05
    // Where in the rate wander this character starts, so two of them do not
    // speed up and slow down together.
    this.restPhaseOffset = ((Math.imul(seed ^ 0x27d4eb2f, 2654435761) >>> 0) % 1000) / 1000 * Math.PI * 2

    this.strideLength = this.measureStride()

    this.reduced = options.reduced ?? false
    this.current = options.state ?? 'idle'
    const start = this.action(this.current)!
    start.reset()
    start.setEffectiveWeight(1)
    // Per-actor playback rate on the base clip, not just a phase offset. Two
    // actors sharing one idle clip drift apart only slowly if they run at the
    // same frequency a phase apart; giving each its own rate means their cycles
    // are genuinely incommensurate and they never fall back into step.
    start.setEffectiveTimeScale(this.rateJitter)
    // Start every actor at a different point in its cycle.
    start.time = ((Math.imul(seed ^ 0xc2b2ae35, 2654435761) >>> 0) % 1000) / 1000 * (this.meta.get(this.current)?.duration ?? 1)
    start.play()

    this.mixer.addEventListener('finished', this.onGestureFinished)
    if (this.reduced) this.applyReducedPose()
  }

  /**
   * The mixer action for a clip, created the first time it is wanted.
   *
   * Both halves of the cost are deferred: the library bakes the keyframes on
   * first request, and `clipAction` binds them to this rig's nodes on first
   * creation. An actor that spends its life typing at a desk therefore never
   * pays for the forty-odd clips it is never going to play, and a room of six
   * of them never pays six times over for the ones it does.
   */
  private action(name: string) {
    const existing = this.actions.get(name)
    if (existing) return existing
    const clip = this.library.clip(name)
    if (!clip) return undefined
    const action = this.mixer.clipAction(clip)
    if (this.meta.get(name)?.loop) {
      action.setLoop(THREE.LoopRepeat, Infinity)
    } else {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    this.actions.set(name, action)
    return action
  }

  /**
   * Poses the rig through the walk clip's stance phase and reads how far the
   * planted foot travels backwards through the body. That distance, divided by
   * the fraction of the cycle the foot is down, is exactly how far the body
   * must move per cycle for the foot to stay still on the ground.
   */
  private measureStride() {
    const walk = this.action('walk')
    const info = this.meta.get('walk')
    if (!walk || !info?.contact.left) return 0

    const saved = new Map<THREE.Object3D, THREE.Quaternion>()
    for (const bone of HUMANOID_BONES) {
      const node = this.skeleton.bones[bone]
      saved.set(node, node.quaternion.clone())
    }

    walk.reset()
    walk.setEffectiveWeight(1)
    walk.paused = true
    walk.play()

    const [start, end] = info.contact.left
    const sampleAt = (phase: number) => {
      walk.time = phase * info.duration
      this.mixer.update(0)
      this.root.updateWorldMatrix(true, true)
      tmpFootWorld.setFromMatrixPosition(this.skeleton.bones.leftFoot.matrixWorld)
      return this.root.worldToLocal(tmpFootWorld).z
    }
    // Sample just inside the contact window; the exact endpoints sit on the
    // discrete contact flag's own transitions.
    const front = sampleAt(start + .02)
    const back = sampleAt(end - .02)
    const contactFraction = Math.max(.2, (end - start) - .04)

    walk.stop()
    walk.paused = false
    walk.setEffectiveWeight(0)
    for (const [node, quaternion] of saved) node.quaternion.copy(quaternion)
    this.skeleton.bones.hips.position.copy(this.baseHipPosition)
    this.root.updateWorldMatrix(true, true)

    // The character faces +Z, so a planted foot moves from in front of the
    // body to behind it over stance.
    const travel = Math.max(.05, front - back)
    return travel / contactFraction / this.skeleton.proportions.hipHeight
  }

  private onGestureFinished = (event: { action?: THREE.AnimationAction }) => {
    if (!this.gesture) return
    const finished = this.action(this.gesture)
    if (event.action !== finished) return
    const additive = this.meta.get(this.gesture)?.additive ?? false
    const fade = this.gesture === 'celebrate' ? .5 : additive ? .34 : .3
    if (finished) this.fadeTo(finished, 0, fade)
    // An additive gesture never displaced the base state, so there is nothing
    // to bring back: the body has been breathing underneath the whole time and
    // all that happens here is the delta releasing to nothing.
    if (!additive) {
      const base = this.action(this.current)
      // `sitDown` and `standUp` change which base state makes sense, and the
      // caller has already switched it; the others hand back to whatever was
      // running underneath.
      if (base) {
        // Restart it only if it really is dormant. A base that is already
        // carrying weight is already contributing to the pose on screen, and
        // rewinding it to phase zero mid-frame would move every joint it
        // drives in a single step.
        //
        // And restart it *after* this update rather than during it. This
        // handler runs from inside `mixer.update`, part-way through the pass
        // that is evaluating the actions, and an action played from in there
        // is activated while that loop is still walking the list: three.js
        // takes it as a newly bound action, gives it the reference pose for
        // one frame, and blends the result against a cumulative weight that
        // now includes it. The symptom is a single frame - exactly one - in
        // which the body flicks to the rest pose and back, which on the
        // celebration measured 1.6 radians summed over sixteen joints out and
        // the same amount back on the frame after. It is the largest single
        // discontinuity anywhere in the system and it lands on the last frame
        // of the most emphatic beat in the library.
        //
        // Deferring costs nothing: the fade is queued now and the first weight
        // it applies is on the next update anyway.
        if (base.getEffectiveWeight() <= 0) this.pendingRestart = base
        this.fadeTo(base, 1, fade)
      }
    }
    this.gesture = null
  }

  /**
   * Sends an action's weight to a target over `duration`, easing both ends.
   *
   * Starting from the action's present weight rather than an assumed one is
   * what makes interrupting a fade safe: a state change part-way through an
   * earlier transition picks up the weight where it currently is, so the pose
   * carries on from where it is rather than jumping back to where the previous
   * fade began.
   */
  private fadeTo(action: THREE.AnimationAction, target: number, duration: number) {
    if (duration <= 0) {
      this.fades.delete(action)
      action.setEffectiveWeight(target)
      if (target === 0) action.stop()
      return
    }
    this.fades.set(action, {
      action,
      start: action.getEffectiveWeight(),
      target,
      elapsed: 0,
      duration,
    })
  }

  private advanceFades(delta: number) {
    if (this.fades.size === 0) return
    for (const channel of [...this.fades.values()]) {
      channel.elapsed += delta
      const t = THREE.MathUtils.clamp(channel.elapsed / channel.duration, 0, 1)
      // Smootherstep: zero first and second derivative at t=0 and t=1.
      const eased = t * t * t * (t * (t * 6 - 15) + 10)
      channel.action.setEffectiveWeight(channel.start + (channel.target - channel.start) * eased)
      if (t < 1) continue
      this.fades.delete(channel.action)
      // A fully faded-out action would otherwise keep being evaluated and
      // accumulated at zero weight for the rest of the session.
      if (channel.target === 0) channel.action.stop()
    }
  }

  get state() {
    return this.current
  }

  get isPlayingGesture() {
    return this.gesture !== null
  }

  /** Which one-shot beat is playing, if any. */
  get activeGesture(): HumanoidGesture | null {
    return this.gesture
  }

  /**
   * Whether this actor is holding a still pose for `prefers-reduced-motion`.
   *
   * Exposed so an ambient scheduler can tell the difference between a beat
   * worth freezing on and one that is only there to stop a loop looking like a
   * loop. A reduced-motion actor holds whichever gesture was last requested,
   * for as long as the page is open, because nothing ever advances to end it.
   */
  get isReduced() {
    return this.reduced
  }

  /** Crossfades to a looping state. Re-requesting the current state is a no-op,
   *  so callers can drive this from a render loop without restarting a clip
   *  every frame. */
  setState(next: HumanoidState, fadeOverride?: number) {
    if (next === this.current) return
    const from = this.action(this.current)
    const to = this.action(next)
    if (!to) return
    const fade = fadeOverride ?? TRANSITIONS[`${this.current}>${next}`] ?? DEFAULT_FADE
    to.reset()
    to.play()
    // Carry the actor's own base rate onto the new looping state too. `walk`
    // and `swim` have their rate driven by `setGroundSpeed` while they move, so
    // this is only the resting value they fall back to; every other looping
    // state keeps its per-actor frequency, which is what stops a room of people
    // sharing a clip from breathing in unison.
    to.setEffectiveTimeScale(this.rateJitter)

    // If an override gesture currently owns the body, swap what is underneath
    // it silently rather than crossfading into it.
    //
    // This is the composition every authored transition uses - `swimEnter`
    // with `setState('swim')`, `sitDown` with `setState('seatedIdle')` - and
    // getting it wrong is invisible until it is not. Fading the new base up
    // while the gesture is playing puts two clips that describe different
    // postures at full weight at once, so the mixer shows a half-standing,
    // half-prone average of them; then the gesture ends, hands over to a base
    // it assumes was dormant, and the pose jumps the whole distance it had
    // been splitting. Parking the new base at zero weight instead leaves the
    // gesture in sole control for its full duration and gives
    // `onGestureFinished` exactly the dormant base it expects.
    if (this.gesture && !this.meta.get(this.gesture)?.additive && !this.reduced) {
      to.setEffectiveWeight(0)
      if (from && from !== to) this.fadeTo(from, 0, fade)
      this.current = next
      this.settled = false
      return
    }

    if (from && !this.reduced) {
      to.setEffectiveWeight(from === to ? 1 : 0)
      this.fadeTo(to, 1, fade)
      if (from !== to) this.fadeTo(from, 0, fade)
    } else {
      to.setEffectiveWeight(1)
      if (from && from !== to) this.fadeTo(from, 0, 0)
    }
    this.current = next
    this.settled = false
    if (this.reduced) this.applyReducedPose()
  }

  /**
   * Plays a one-shot beat.
   *
   * `amplitude` and `timeScale` are the whole point of this signature. A
   * repertoire of gestures fired in a random order still reads as a loop if
   * each one is byte-identical every time it plays, because what an audience
   * actually recognises is the *shape* of a motion, not which one it was. For
   * an additive gesture the weight the delta settles at is literally its
   * amplitude, so asking for 0.7 gives a smaller version of the same beat
   * rather than a differently-authored one, and the playback rate stretches
   * its timing independently. Between those two and the mirrored variants, a
   * dozen authored clips cover a space large enough that the same performance
   * does not recur.
   */
  playGesture(
    next: HumanoidGesture,
    options: { fade?: number; amplitude?: number; timeScale?: number } = {},
  ) {
    const action = this.action(next)
    if (!action) return
    const additive = this.meta.get(next)?.additive ?? false
    const previous = this.gesture ? this.action(this.gesture) : undefined
    if (previous && previous !== action) this.fadeTo(previous, 0, .18)
    const amplitude = THREE.MathUtils.clamp(options.amplitude ?? 1, 0, 1)
    const fade = options.fade ?? (next === 'celebrate' ? .16 : additive ? .30 : .22)
    action.reset()
    action.setEffectiveTimeScale(options.timeScale ?? 1)
    action.play()
    if (this.reduced) {
      action.setEffectiveWeight(amplitude)
    } else {
      action.setEffectiveWeight(0)
      this.fadeTo(action, amplitude, fade)
      // Only an override gesture displaces the base state. An additive one
      // rides on top of it, which is what keeps the breath and the weight
      // shift running through the beat instead of the body going still to
      // perform and then starting up again afterwards.
      if (!additive) {
        const base = this.action(this.current)
        if (base && base !== action) this.fadeTo(base, 0, fade)
      }
    }
    this.gesture = next
    this.settled = false
    if (this.reduced) this.applyReducedPose()
  }

  /** Whether a gesture layers over the base state rather than replacing it. */
  isAdditiveGesture(gesture: HumanoidGesture) {
    return this.meta.get(gesture)?.additive ?? false
  }

  /** True while any weight is still travelling, which a consumer can use to
   *  decide it needs to render at full rate for a moment. */
  get isTransitioning() {
    return this.fades.size > 0
  }

  /**
   * Matches the gait to a real ground speed.
   *
   * This is the fix for foot sliding at its source. The old system moved a
   * character along a path at one rate and swung its legs at a fixed, wholly
   * unrelated frequency, so the feet could never agree with the ground no
   * matter how the curves were shaped. Here the walk clip declares how far one
   * cycle travels, so playing it at `speed / strideSpeed` makes the body
   * advance exactly one stride per cycle by construction, and the foot-planting
   * pass below only has to absorb rounding error.
   *
   * The 0.35 floor looks like a skate source and was tested as one: below it
   * the stance foot travels at `natural * 0.35` however slowly the body is
   * going, which on the office rig is 0.45 u/s. Dropping it to 0.12 changed
   * the measured office skate by nothing (the seated associate's creeping
   * planted foot went 0.400 -> 0.395 u/s, inside run-to-run noise), because
   * `office-three.tsx` only calls this while its own `walking` flag is set and
   * the sub-threshold frames are therefore never fed. Left at 0.35 rather than
   * carrying an unmeasurable change through shared rig code.
   */
  /**
   * Point this character's head and chest at a place in the world.
   *
   * Opt-in, and off by default. With no target ever set, the whole pass is one
   * float comparison per frame and the clip's own head motion is bit-for-bit
   * what it was - which is the property that let this be added to a shared rig
   * without re-verifying every character that uses it.
   *
   * Pass a world-space point to have the body turn toward it and hold; pass
   * `null` to release it back to whatever it was doing. Both directions ease
   * over roughly a third of a second rather than snapping, and because the
   * turn is layered on top of the running clip rather than replacing it, the
   * character keeps breathing and shifting while it holds the look. Releasing
   * does not restart or interrupt anything: the layer's weight simply falls
   * back to zero and the clip is left as the only thing posing the joints.
   *
   * The target is copied, not retained, so a caller may hand over a scratch
   * vector it is about to reuse.
   */
  setLookTarget(target: THREE.Vector3 | null) {
    if (!target) {
      this.lookWanted = 0
      return
    }
    this.lookTarget = (this.lookTarget ?? new THREE.Vector3()).copy(target)
    this.lookWanted = 1
  }

  /** True while any part of a look-at is still being applied, including the
   *  ease-out after the target is cleared. */
  get looking() {
    return this.lookWeight > .002 || this.lookWanted > 0
  }

  /**
   * Move this actor's playhead forward inside its own loop without simulating
   * the elapsed time.
   *
   * Called once at spawn. Five characters constructed on the same frame all
   * start their clip at zero, and if two of them drew the same task they will
   * strike the same key in unison for as long as anyone is watching. Per-
   * character rate jitter does separate them, but it does so over tens of
   * seconds, which is no help at all for the first thing a player sees.
   *
   * This nudges the clip time only - no mixer pass, no fades, no gesture
   * bookkeeping - which is what makes it both safe before the first `update`
   * and cheap enough to call on every body in the room.
   */
  advance(seconds: number) {
    const action = this.actions.get(this.current)
    if (!action) return
    const duration = action.getClip().duration
    if (duration > 0) action.time = ((seconds % duration) + duration) % duration
  }

  setGroundSpeed(speed: number) {
    const walk = this.action('walk')
    const natural = this.naturalWalkSpeed
    if (walk && natural > 0) {
      const scale = THREE.MathUtils.clamp(Math.abs(speed) / natural, .35, 2.2)
      walk.setEffectiveTimeScale(scale * this.rateJitter)
    }
    // Swimming has the same relationship between travel and cycle rate, and
    // the same failure if they disagree: a stroke that does not match the
    // speed the body is actually making reads as the swimmer being towed. It
    // is measured differently only because there is no contact to measure a
    // stride from.
    const swim = this.action('swim')
    const naturalSwim = this.naturalSwimSpeed
    if (swim && naturalSwim > 0) {
      const scale = THREE.MathUtils.clamp(Math.abs(speed) / naturalSwim, .4, SWIM_RATE_CEILING)
      swim.setEffectiveTimeScale(scale * this.rateJitter)
    }
  }

  /** The ground speed at which the walk clip plays at its authored rate. */
  get naturalWalkSpeed() {
    const info = this.meta.get('walk')
    if (!info || this.strideLength <= 0) return 0
    return this.strideLength * this.skeleton.proportions.hipHeight * this.worldScale / info.duration
  }

  /**
   * The travel speed at which the swim clip plays at its authored rate.
   *
   * Derived rather than declared, on the same principle as the walk's stride:
   * a front crawl covers a bit over one body length per full stroke cycle, and
   * this rig's body is a fixed multiple of its own hip height, so the distance
   * scales with the character instead of being a world constant that is wrong
   * for anyone the clips were not authored against.
   */
  get naturalSwimSpeed() {
    const info = this.meta.get('swim')
    if (!info) return 0
    return SWIM_STROKE_BODY_LENGTHS * this.skeleton.proportions.hipHeight * this.worldScale / info.duration
  }

  /**
   * How far the authored upper-body motion is scaled for this camera.
   *
   * One is the authored performance and is right for anything framed as a
   * whole figure. Above one is for a crop: the same curves, the same timing,
   * the same posture, travelling further because the lens is closer. See
   * `EXPRESSION_SHARE` for why this is a scale on the animated delta rather
   * than a second set of larger clips.
   */
  setExpressionGain(gain: number) {
    const next = Math.max(.25, gain)
    if (next === this.expressionGain) return
    this.expressionGain = next
    // The followers track the amplified pose, so changing the amplification
    // moves their target under them. Re-seeding costs one frame of lag and
    // avoids handing the springs a step input they would answer with a lurch.
    for (const lag of this.lagBones) lag.seeded = false
  }

  /** How strongly the dragged joints express their lag. Zero disables the
   *  pass outright. */
  setSecondaryMotion(strength: number) {
    this.secondaryGain = THREE.MathUtils.clamp(strength, 0, 2)
  }

  setLod(level: HumanoidLod) {
    this.lodLevel = level
  }

  get lod() {
    return this.lodLevel
  }

  setReduced(reduced: boolean) {
    if (reduced === this.reduced) return
    this.reduced = reduced
    this.settled = false
    if (reduced) this.applyReducedPose()
  }

  /**
   * Lands a correct, legible held pose for `prefers-reduced-motion`.
   *
   * The trap here is already documented in this codebase: freezing at t=0
   * showed nothing, because every gesture curve starts at zero amplitude and
   * so frame zero is just the neutral stance. Each clip therefore names a
   * representative phase - the apex of a celebration, a settled mid-stance for
   * a walk - and reduced motion samples that instead of the first frame. The
   * result is a still character in a pose that actually communicates what they
   * are doing.
   */
  private applyReducedPose() {
    // Which clips make up the held pose. An override gesture is the whole
    // pose; an additive one is a delta that means nothing without the base
    // state underneath it, so both are held. Getting this wrong is the same
    // bug as freezing at t=0 wearing a different hat: hold a nod on its own
    // and a reduced-motion user sees a character in a rest pose that no state
    // ever displays, with a seven-degree head tilt bolted to it.
    const overlay = this.gesture && this.meta.get(this.gesture)?.additive ? this.gesture : null
    const base = this.gesture && !overlay ? this.gesture : this.current
    const held = overlay ? [base, overlay] : [base]

    for (const [name, other] of this.actions) {
      if (held.includes(name as HumanoidGesture & HumanoidState)) continue
      other.setEffectiveWeight(0)
      other.stop()
    }
    for (const name of held) {
      const info = this.meta.get(name)
      const action = this.action(name)
      if (!info || !action) continue
      action.reset()
      action.setEffectiveWeight(1)
      action.setEffectiveTimeScale(1)
      // `paused` rather than a zero time scale, and the time set to the phase
      // that best represents the clip rather than to zero. Both halves matter:
      // a paused action still contributes its pose to the mixer every update,
      // and every gesture curve starts at zero amplitude, so the finished
      // state is somewhere in the middle of the clip and never at its start.
      action.paused = true
      action.time = info.restPhase * info.duration
      action.play()
    }
    this.mixer.update(0)
    this.applyPostPass(0, true)
    this.settled = true
  }

  /**
   * Advances the actor. Call after the consumer has positioned and oriented
   * `root` for this frame, because foot planting works in world space and
   * needs the body's final placement to know where the foot should stay.
   */
  update(delta: number) {
    if (this.reduced) {
      // A reduced-motion actor still needs one pass to establish its pose, but
      // must not keep animating afterwards.
      if (!this.settled) this.applyReducedPose()
      return
    }
    if (this.lodLevel === 'frozen') return

    const interval = LOD_INTERVAL[this.lodLevel]
    this.accumulated += delta
    if (this.accumulated < interval) return
    const step = this.accumulated
    this.accumulated = 0

    // A base state handed back to by a finished gesture, restarted here where
    // no mixer pass is in flight. See `onGestureFinished`.
    if (this.pendingRestart) {
      const base = this.pendingRestart
      this.pendingRestart = null
      if (base.getEffectiveWeight() <= 0) {
        base.reset().play()
        base.setEffectiveWeight(0)
      }
    }

    this.advanceFades(step)
    this.driftRestingRate(step)
    this.advanceRestWeights(step)
    this.mixer.update(step)
    this.applyPostPass(step, false)
  }

  /**
   * Eases the rest-offset weights toward what the current state asks for.
   *
   * Over roughly the same window as a state crossfade, so the stance fades out
   * as the pose that does not want it fades in. Switching them outright would
   * drop nineteen degrees of shoulder rotation in one frame, which is exactly
   * the kind of snap this system exists to avoid.
   */
  private advanceRestWeights(delta: number) {
    const wanted = STATE_REST_WEIGHT[this.current]
    for (const group of REST_OFFSET_GROUPS) {
      const target = wanted?.[group] ?? 1
      this.restWeights[group] = THREE.MathUtils.damp(this.restWeights[group], target, 4.5, delta)
    }
  }

  /**
   * Keeps a resting clip from ever playing the same cycle twice.
   *
   * Every other defence against a visible loop is above the base clip: more
   * stances, more beats, each at its own size and speed. Underneath all of it
   * a looping idle is still a loop, and in a quiet stretch with no beat firing
   * the pose returns to exactly where it was one period ago - measurably
   * exactly, to four decimal places, which is what a long capture of the
   * portrait shows. Nobody watches a face for six seconds and consciously
   * notices, but the eye is very good at periodicity and it is the residue of
   * mechanism left after the rest of the work is done.
   *
   * A slow wander in playback rate removes it for one sine per frame. The
   * period is a little over half a minute and shares no factor with any clip
   * in the library, and four percent is far too small to read as the character
   * speeding up or slowing down - what it does is keep the phase sliding, so
   * the cycle a viewer sees now is never quite the one they saw before.
   * Because the rate moves continuously the pose stays C1: there is no frame
   * at which anything jumps, only one where it is travelling slightly
   * differently than it would have been.
   *
   * Only the resting states get this. `walk` and `swim` derive their rate from
   * how fast the body is actually moving, and detuning that is exactly the
   * foot-slide this system exists to prevent.
   */
  private driftRestingRate(delta: number) {
    // The desk tasks opt in for the same reason the idles do, and with more
    // reason than any of them: they are the longest-running loops in the app
    // and the ones a player stares at. `walk` and `swim` still must not, since
    // their rate is what keeps a foot or a hand from sliding.
    if (!IDLE_STATES.includes(this.current) && !DESK_STATES.includes(this.current)) return
    const action = this.action(this.current)
    if (!action) return
    this.restClock += delta
    const wander = 1 + Math.sin(this.restClock * REST_RATE_DRIFT_RATE + this.restPhaseOffset) * REST_RATE_DRIFT
    action.setEffectiveTimeScale(this.rateJitter * wander)
  }

  /**
   * Turn the head and chest toward `lookTarget`, by `lookWeight`.
   *
   * Each joint is aimed in its own local frame: inverting its world matrix
   * puts the target in the space the joint's rotation is expressed in, where
   * aiming is just a yaw and a pitch about that joint's own axes. Doing it
   * that way means the layer needs to know nothing about which way the
   * character is facing, how its parent is scaled, or where in the scene graph
   * it hangs - all of which are already in the matrix.
   *
   * The chain is walked proximal to distal and each joint's world matrix is
   * rebuilt as it is reached, so the head aims from where the chest has just
   * put it rather than from where it was at the start of the frame. That is
   * two world-matrix rebuilds, which is why this runs only while a look is
   * actually in progress.
   *
   * The `.05` floor under the forward component keeps the `atan2` sane for a
   * target that has come round beside or behind the character: without it the
   * angle flips sign as the target crosses the shoulder line and the head
   * snaps through the full arc. Clamped, the body simply looks as far round as
   * it can and stops, which is what a person does.
   */
  private applyLookAt(delta: number) {
    this.lookWeight = THREE.MathUtils.damp(this.lookWeight, this.lookWanted, 3.6, delta)
    const target = this.lookTarget
    if (!target || this.lookWeight <= .002) return
    for (const [bone, share, yawLimit, pitchLimit] of LOOK_CHAIN) {
      const joint = this.skeleton.bones[bone]
      joint.updateWorldMatrix(true, false)
      lookLocal.copy(target).applyMatrix4(lookMatrix.copy(joint.matrixWorld).invert())
      const forward = Math.max(.05, lookLocal.z)
      const yaw = THREE.MathUtils.clamp(Math.atan2(lookLocal.x, forward), -yawLimit, yawLimit)
      const pitch = THREE.MathUtils.clamp(
        -Math.atan2(lookLocal.y, Math.max(.05, Math.hypot(lookLocal.x, lookLocal.z))),
        -pitchLimit,
        pitchLimit,
      )
      const amount = this.lookWeight * share
      lookEuler.set(pitch * amount, yaw * amount, 0, 'YXZ')
      joint.quaternion.multiply(lookQuaternion.setFromEuler(lookEuler))
    }
  }

  /**
   * Everything the mixer cannot express: per-character rest posture, root
   * motion retargeting, foot planting and joint limits.
   */
  private applyPostPass(delta: number, forceIk: boolean) {
    // 0. Undo the previous frame's work on any joint the mixer declined to
    //    rewrite this frame. See `reclaimMixerPose`.
    this.reclaimMixerPose()

    // 1. Restore each character's authored resting posture on top of the
    //    shared clip, so a shared clip library does not flatten the small
    //    per-character differences the art defines.
    //
    // Weighted per limb group, because the offset is a *standing* stance and
    // not every pose is standing. See `RestOffsetGroup`: a body at a keyboard
    // wants its own head tilt and none of its own idle arm carriage, and the
    // weights ease rather than switch so changing task does not snap the arms.
    // Every state that does not name a weight keeps 1 across the board, which
    // is what this pass has always done.
    const restWeights = this.restWeights
    for (const { bone, offset, group } of this.skeleton.restOffsets) {
      const weight = restWeights[group]
      if (weight >= .999) bone.quaternion.premultiply(offset)
      else if (weight > .002) {
        bone.quaternion.premultiply(scaledRest.identity().slerp(offset, weight))
      }
    }

    // 1b. Scale the performance to the lens, and 1c. let the distal joints be
    //     dragged rather than driven.
    //
    // Both run here, before anything else, and in this order. Amplification
    // first because the follow-through should belong to the motion actually on
    // screen - a beat scaled up for a close-up has proportionally more
    // momentum in it and should overshoot proportionally further - and both
    // before the clamp, so a joint that the two passes together push past its
    // anatomical limit is caught by the same guard that catches a retargeting
    // error. Nothing here touches the pelvis, the legs or the feet, so the
    // grounding pass below sees exactly what it saw before.
    this.applyExpression()
    this.advanceSecondary(delta)

    // 2. Persistent left/right asymmetry.
    if (this.asymmetry !== 0) {
      this.skeleton.bones.leftShoulder.rotation.z += this.asymmetry
      this.skeleton.bones.rightShoulder.rotation.z += this.asymmetry * .7
      this.skeleton.bones.leftHip.rotation.z += this.asymmetry * .4
    }

    // 2b. Look-at, if anything has asked for one.
    //
    // Placed here on purpose: after the clip, the rest posture and the
    // secondary motion, so it turns the head the performance actually
    // produced rather than fighting it, and before the anatomical clamp
    // below, so its own limits have a backstop behind them.
    if (this.lookWeight > .002 || this.lookWanted > 0) this.applyLookAt(delta)

    // 3. Retarget normalized root motion onto this character's real
    //    proportions. The clip says "drop 0.45 hip-heights to sit"; how far
    //    that is in world units depends on the character.
    const hipHeight = this.skeleton.proportions.hipHeight
    const motion = this.rootMotionNode.position
    const hips = this.skeleton.bones.hips
    hips.position.set(
      this.baseHipPosition.x + motion.x * hipHeight,
      this.baseHipPosition.y + motion.y * hipHeight,
      this.baseHipPosition.z + motion.z * hipHeight,
    )

    // 4. Anatomical limits, as a retargeting safety net.
    //
    // Clamping runs a level lower than foot IK does, and the split is
    // deliberate. IK is the expensive half - two world-matrix rebuilds and two
    // solves - and a character small enough on screen not to warrant it also
    // has feet nobody is looking at. A joint through the wrong side of a
    // jacket is visible at any size, though, and clamping is sixteen euler
    // conversions, so the cheap guard stays on where the expensive one comes
    // off. This is what lets the portrait run at `medium`: its feet are
    // usually out of frame but its elbows never are.
    const clamped = forceIk || this.lodLevel === 'full' || this.lodLevel === 'medium'
    if (clamped) {
      for (const bone of CLAMPED_BONES) {
        clampJoint(bone, this.skeleton.bones[bone].quaternion)
      }
    }

    // 4a. The hair, which trails whatever the head finally did.
    //
    // Here rather than beside the other followers in `advanceSecondary`, and
    // that ordering is the whole reason it works: the head's own lag, its
    // look-at and its anatomical clamp have all landed by this point, so the
    // hair is dragged by the orientation that will actually be drawn. Run from
    // `advanceSecondary`'s position it would trail a head pose that three later
    // passes were still going to change, and the hair would lead its own head
    // on any frame the look-at moved.
    this.advanceHair(delta, motion.y * hipHeight)

    // 4b. Folded leg placement, for any pose whose pelvis is below standing
    //     height.
    //
    // The shared seated clip is authored as a plausible average, but once each
    // character's rest offsets and the euler joint clamp land on top of it the
    // fold turns asymmetric - one knee jams against its flexion limit while the
    // other leg half-extends - and the feet finish well off the floor, or
    // through it, because the clip has no idea how tall the seat is. For a
    // lowered pelvis we throw that away and solve both legs directly onto the
    // floor from the rig's own measured limb lengths, so both feet rest level
    // and forward of the hips and the shins hang toward vertical whatever the
    // seat height happens to be.
    //
    // The trigger is the pelvis height rather than the state name, because the
    // state name is wrong for exactly the frames that matter most. `standUp`
    // and `sitDown` are override gestures that carry the pelvis between seat
    // and standing height while the *base* state has already flipped to
    // `idle`, so a name-based test hands those frames to the standing solver:
    // it extends the legs to their full length from a pelvis still at seat
    // height and drives both feet a third of a metre through the floorboards.
    // Measuring the pelvis instead makes the transition continuous - the legs
    // unfold exactly as fast as the body rises - and the blend weight falls to
    // zero on its own as standing height is reached, so no frame is owned by
    // two solvers. It runs at `medium` too: the foreground client is the whole
    // reason this exists.
    const crouch = this.plantSeatedLegs()
    if (crouch > .02) {
      // The legs are already pinned to the floor by the fold solve. Releasing
      // the walking anchors as well matters because they would otherwise still
      // be holding the world position the feet had when the body last bore
      // weight on them - which, on the way out of a chair, is a point under the
      // floor.
      this.releaseAnchors()
      this.groundSoles()
      return
    }

    const detailed = forceIk || this.lodLevel === 'full'
    if (!detailed) {
      // The floor is not a detail. A distant character still reads as standing
      // in a hole if its shoes are half-buried, and this costs two quaternions
      // and a handful of vector adds, so it runs wherever the legs were posed
      // at all.
      if (clamped) this.groundSoles()
      this.settleSoles()
      return
    }

    // 5. Foot planting. This is the single biggest contributor to motion
    //    reading as human, and it is a world-space problem: the body has
    //    already moved this frame, and a foot that is supposed to be bearing
    //    weight must stay exactly where it was put down rather than being
    //    carried along with the hips.
    //
    //    `updateWorldMatrix(true, ...)` rather than `updateMatrixWorld()` is
    //    load-bearing. The latter composes against whatever the parent's world
    //    matrix happened to be last time anything updated it, so if the
    //    consumer moved this character's parent group this frame - which is
    //    exactly what walking a character across a room means - every world
    //    position read here would be one frame stale. Anchoring a foot in a
    //    coordinate frame that is itself a frame behind reproduces the sliding
    //    this whole pass exists to remove.
    this.root.updateWorldMatrix(true, true)
    this.root.getWorldQuaternion(this.rootQuaternion)
    this.refreshWorldScale()

    // Sample both feet before solving either. Solving the left leg invalidates
    // the world matrices, so reading the right foot afterwards would read a
    // position that no longer corresponds to anything.
    this.planted.left.sampled.setFromMatrixPosition(this.skeleton.bones.leftFoot.matrixWorld)
    this.planted.right.sampled.setFromMatrixPosition(this.skeleton.bones.rightFoot.matrixWorld)

    // Contact weight and groundedness both come straight from the clips, so
    // they are already blended across any crossfade in progress. The IK needs
    // no ramp of its own on top: the authored curves are the ramp.
    const grounded = THREE.MathUtils.clamp(this.animMetaNode.position.z, 0, 1)
    const leftContact = THREE.MathUtils.clamp(this.animMetaNode.position.x, 0, 1) * grounded
    const rightContact = THREE.MathUtils.clamp(this.animMetaNode.position.y, 0, 1) * grounded
    this.updateAnchor('left', leftContact, delta)
    this.updateAnchor('right', rightContact, delta)

    // Drop the pelvis far enough that both planted feet can reach the floor,
    // before asking the legs to reach for it.
    //
    // A clip is authored as joint angles and knows nothing about a floor, so
    // at heel strike the reaching leg leaves its foot a good twenty
    // centimetres in the air. Left to the leg solver alone that gets absorbed
    // by snapping the knee bolt straight in a single frame - the largest
    // single artefact this system had. Lowering the hips instead is both
    // cheaper and what a body actually does: the pelvis dips onto the leading
    // leg, and the dip is the weight absorption rather than something bolted
    // on afterwards.
    // Capped, because the dip is a weight absorption and not a licence to
    // squat. A real one is a few per cent of leg length; a large one is always
    // a stale anchor - a foot pinned to somewhere the body has since walked
    // away from - and chasing it drags the *other* foot, which has nothing to
    // do with the anchor in question, straight down through the floor. Ten per
    // cent is roughly twice the deepest genuine dip in the gait clips, so the
    // cap only ever binds on the pathological case it is here for.
    const dropLimit = this.skeleton.proportions.hipHeight * this.worldScale * .1
    const drop = Math.min(dropLimit, Math.max(this.reachDeficit('left'), this.reachDeficit('right')))
    if (drop > 1e-4) {
      this.skeleton.bones.hips.position.y -= drop / this.worldScale
      this.root.updateWorldMatrix(true, true)
    }

    this.solveFoot('left')
    this.solveFoot('right')
    this.groundSoles()
    // Last word on where the floor is.
    //
    // Everything above moves the pelvis for a local reason - the weight dip
    // reaches for a planted foot, the sole clamp pushes a buried shoe back
    // out - and each of them is right about its own foot and blind to the
    // result. They are also relative, applied on top of whatever pelvis
    // height they are handed, so on a pose the mixer does not rewrite every
    // frame their corrections compound: a body climbed nearly thirty
    // centimetres over a few frames this way and then walked around up there,
    // which is not something any one of those passes looks wrong doing.
    // Settling on the lower sole afterwards is absolute rather than relative,
    // so it cannot accumulate, and it makes the invariant the rest of the
    // system only approximates - the foot carrying the weight is on the floor
    // - true by construction on every frame.
    this.settleSoles()

    // Remember what this pass left behind, so the next one can tell its own
    // output apart from the mixer's. See `reclaimMixerPose`.
    for (let index = 0; index < HUMANOID_BONES.length; index += 1) {
      this.appliedPose[index].copy(this.skeleton.bones[HUMANOID_BONES[index]].quaternion)
    }
    this.posed = true
  }

  /**
   * Takes each joint back to the mixer's own output before re-posing it.
   *
   * Everything in `applyPostPass` is written as if the mixer had just
   * overwritten every joint from the clips, because for almost every frame it
   * has. Several of the passes are relative to whatever they find - the rest
   * offset premultiplies, the follow-through premultiplies, the asymmetry adds
   * to an euler angle - so running one of them twice over the same joint
   * applies it twice.
   *
   * The mixer does not, in fact, always write. `PropertyMixer.apply` compares
   * the value it just accumulated against the one it applied last time and
   * skips the write when they are bit-identical, which is a real saving on a
   * skeleton where most joints are still most of the time. The frames where
   * that fires are exactly the ones where an action is holding a fixed pose: a
   * `LoopOnce` gesture clamped at its end, a paused action, a state whose
   * curves are flat through a stretch. On those frames the joint still holds
   * *last* frame's finished pose, offsets and all, and the pass compounds its
   * own output.
   *
   * Measured on the celebration, which clamps on a big pose and therefore hits
   * this on the very frame it finishes: 1.6 radians summed across sixteen
   * joints, out on one frame and back on the next, the largest single
   * discontinuity in the system and sitting on the last frame of the most
   * emphatic beat in the library. It is not specific to that clip - every
   * clamped one-shot ends on it, and the size just scales with how far the end
   * pose is from rest.
   *
   * So: keep the mixer's output for each joint, and keep what we left the
   * joint at. If a joint arrives still holding exactly what we left it - which
   * is the signature of a skipped write, to the bit - put the mixer's value
   * back before re-posing it. Sixteen four-float comparisons and, on the rare
   * frame it fires, sixteen copies.
   */
  private reclaimMixerPose() {
    for (let index = 0; index < HUMANOID_BONES.length; index += 1) {
      const node = this.skeleton.bones[HUMANOID_BONES[index]]
      const raw = this.mixerPose[index]
      if (this.posed) {
        const applied = this.appliedPose[index]
        const untouched = node.quaternion.x === applied.x
          && node.quaternion.y === applied.y
          && node.quaternion.z === applied.z
          && node.quaternion.w === applied.w
        if (untouched) node.quaternion.copy(raw)
      }
      raw.copy(node.quaternion)
    }
  }

  /**
   * Scales each upper-body joint's rotation away from its authored rest.
   *
   * Cheap by construction: at gain one it is a single comparison, and
   * otherwise it is one quaternion multiply and one trig pair per joint over
   * at most seven joints, none of which are the ones the floor constraint
   * cares about.
   */
  private applyExpression() {
    if (this.expressionGain === 1) return
    for (const bone of HUMANOID_BONES) {
      const share = EXPRESSION_SHARE[bone]
      if (!share) continue
      const node = this.skeleton.bones[bone]
      const bind = this.bindPose.get(node)
      if (!bind) continue
      // delta = bind^-1 * current, which is the rotation the clips asked for
      // measured from this character's own resting posture. Scaling it and
      // putting it back leaves the rest pose untouched at any gain.
      gainDelta.copy(bind).invert().multiply(node.quaternion)
      scaleRotation(gainDelta, 1 + (this.expressionGain - 1) * share)
      node.quaternion.copy(bind).multiply(gainDelta)
    }
  }

  /**
   * Advances the damped followers and applies each joint's lag.
   *
   * The integration is deliberately sub-stepped at a fixed rate rather than
   * taking the frame's delta whole. An explicit spring is only stable while
   * the step is small against its own period, and this class is called with
   * whatever the display gave the consumer - a browser that has just come back
   * from a background tab, or a `low` LOD actor accumulating an eighteenth of
   * a second, can both hand it a step several times longer than a stable one.
   * The failure mode there is not a slightly wrong answer, it is a spring that
   * gains energy every frame, which would arrive as exactly the jitter this
   * layer exists to avoid. Fixing the sub-step makes the result independent of
   * frame rate as well, so an actor rendered at 30Hz and one at 120Hz settle
   * identically.
   */
  private advanceSecondary(delta: number) {
    if (this.secondaryGain <= 0 || this.lodLevel === 'low') {
      // Dropping the pass leaves every follower holding a stale orientation,
      // and handing that back to a spring when the actor is promoted again is
      // a step input - the one thing this integrator cannot answer smoothly.
      // Invalidating them makes a level change cost one frame of no lag
      // instead.
      for (const lag of this.lagBones) lag.seeded = false
      return
    }
    const closeOnly = this.lodLevel !== 'full'

    // Cumulative orientations, as products of local quaternions down each
    // chain. A node's world rotation is the product of its ancestors' local
    // rotations, so this is exact and needs no world-matrix rebuild - which
    // matters, because this runs before the one the foot solver does and must
    // not add a second.
    const bones = this.skeleton.bones
    lagDrivers[0].copy(bones.hips.quaternion)
      .multiply(bones.spine.quaternion)
      .multiply(bones.chest.quaternion)
    lagDrivers[1].copy(lagDrivers[0]).multiply(bones.leftShoulder.quaternion)
    lagDrivers[2].copy(lagDrivers[0]).multiply(bones.rightShoulder.quaternion)
    lagDrivers[3].copy(lagDrivers[1]).multiply(bones.leftElbow.quaternion)
    lagDrivers[4].copy(lagDrivers[2]).multiply(bones.rightElbow.quaternion)

    // A zero or absurd step means there is no meaningful "since last frame" to
    // integrate over: the reduced-motion path poses at delta zero, and a tab
    // returning from the background can produce a step longer than the whole
    // settle. Re-seeding in both cases lands the followers exactly on the pose
    // with no lag, which is correct for a held frame and invisible for a
    // resumed one.
    const reseed = delta <= 0 || delta > .25

    const steps = reseed ? 0 : Math.min(12, Math.max(1, Math.ceil(delta * 120)))
    const step = steps > 0 ? delta / steps : 0

    for (const lag of this.lagBones) {
      if (closeOnly && !lag.close) {
        lag.seeded = false
        continue
      }
      const driver = lagDrivers[lag.driver]
      if (reseed || !lag.seeded) {
        lag.filter.copy(driver)
        lag.velocity.set(0, 0, 0)
        lag.seeded = true
        continue
      }

      const stiffness = lag.omega * lag.omega
      const decay = Math.exp(-2 * lag.zeta * lag.omega * step)
      for (let index = 0; index < steps; index += 1) {
        // The rotation from the follower to the driver, expressed in the
        // follower's own frame - which is also the frame the lagging joint's
        // local quaternion lives in, so the result can be applied directly.
        lagError.copy(lag.filter).invert().multiply(driver)
        // Both signs are the same rotation; the positive-w one is the short
        // way round, and taking the long way round here would spin a joint
        // most of a turn to express a two-degree lag.
        if (lagError.w < 0) lagError.set(-lagError.x, -lagError.y, -lagError.z, -lagError.w)
        // Twice the vector part is the axis-angle vector to first order, which
        // is exact enough for errors this small and avoids a trig pair per
        // sub-step per joint.
        lagAxis.set(lagError.x, lagError.y, lagError.z).multiplyScalar(2)
        lag.velocity.addScaledVector(lagAxis, stiffness * step)
        // Damping applied as a decay rather than as another explicit term.
        // The spring half is stable at this sub-step; the damping half is the
        // stiff one, and integrating it exactly means the ratio can be tuned
        // by ear without the integrator ever being the thing that limits it.
        lag.velocity.multiplyScalar(decay)
        const speed = lag.velocity.length()
        if (speed > 1e-6) {
          lagStep.setFromAxisAngle(lagAxis.copy(lag.velocity).divideScalar(speed), speed * step)
          lag.filter.multiply(lagStep).normalize()
        }
      }

      // What is left between the follower and the driver is the lag, and the
      // joint expresses its share of it as a counter-rotation: the parent has
      // gone on ahead, and this joint has not caught up yet.
      lagError.copy(lag.filter).invert().multiply(driver)
      if (lagError.w < 0) lagError.set(-lagError.x, -lagError.y, -lagError.z, -lagError.w)
      const sin = Math.hypot(lagError.x, lagError.y, lagError.z)
      if (sin < 1e-7) continue
      // Saturated smoothly rather than clipped. A hard `min` against the limit
      // is continuous in position but not in velocity, so a joint whose lag
      // rides up against the ceiling during a fast beat stops dead and starts
      // again at the exact frame it crosses - which is a velocity step, and a
      // velocity step is the definition of the snap this layer is here to
      // remove. `tanh` is indistinguishable from the identity while the lag is
      // small, which is almost always, and bends over into the same ceiling
      // with every derivative intact.
      const raw = 2 * Math.atan2(sin, lagError.w) * lag.gain * this.secondaryGain
      const angle = lag.limit * Math.tanh(raw / lag.limit)
      if (angle < 1e-6) continue
      lagApply.setFromAxisAngle(lagAxis.set(lagError.x, lagError.y, lagError.z).divideScalar(sin), -angle)
      lag.node.quaternion.premultiply(lagApply)
    }
  }

  /**
   * Hair that lags the head and settles.
   *
   * The complaint this answers is that the hair is rigid geometry parented to
   * the head, so it turns exactly when the head turns and does nothing else —
   * which is what makes a long cut read as a moulded shell rather than as hair,
   * however good its silhouette and palette are.
   *
   * ## Why a follower and not a simulation
   *
   * The scene budget is the constraint, and it is hard-won: the cast is batched
   * down to 6.8 draws a body and the Practice floor from 1,798 draws to 974. A
   * strand solver is out of the question, and so is anything that gives hair its
   * own material or its own geometry per character, because the crowd batches on
   * exactly those two things — `map-crowd-rig` groups by geometry and finish, so
   * a per-character hair anything shatters one batch into as many batches as
   * there are people.
   *
   * What is free is a *transform*. `addHair` puts the whole cut on one node
   * under the head, the crowd resolves world matrices for the entire skeleton
   * every frame anyway to fill its instance buffers, and this class is already
   * running a bank of damped followers for the head, the arms and the hands. So
   * hair costs one more follower: a quaternion, a vector, and per frame one
   * inverse, a handful of multiplies and a `tanh`. No new mesh, no new material,
   * no change to any batch key, and nothing added to `HUMANOID_BONES`.
   *
   * ## The two inputs
   *
   * A head turn is rotation, and the spring answers that directly: the follower
   * chases the head's cumulative orientation, arrives late, overshoots because
   * `zeta` is well below critical, and rings down. That is the head turn
   * carrying through and settling.
   *
   * A walk cycle is mostly *translation* — the pelvis rises and falls twice a
   * stride — and a rotational follower is blind to it, which would leave a
   * walking character's hair dead still. The lift is fed in as an angular
   * impulse instead: when the head rises, the hair is still where it was, so
   * relative to the head it hangs lower. Taken from the root-motion node's own y
   * rather than from a world position, so it costs a subtraction and adds no
   * matrix work to a pass that deliberately avoids it.
   */
  private advanceHair(delta: number, lift: number) {
    const hair = this.skeleton.hair
    if (!hair) return
    // Nothing to swing (the male crop scores zero), no secondary motion asked
    // for, or a body far enough away that a two-centimetre movement of a
    // hairline is well under a pixel.
    if (hair.swing <= .02 || this.secondaryGain <= 0 || this.lodLevel === 'low') {
      if (this.hairSeeded) {
        hair.node.quaternion.identity()
        this.hairSeeded = false
      }
      return
    }

    const bones = this.skeleton.bones
    hairDriver.copy(bones.hips.quaternion)
      .multiply(bones.spine.quaternion)
      .multiply(bones.chest.quaternion)
      .multiply(bones.head.quaternion)

    // Same guard as the joint followers: a zero step is a held pose and a huge
    // one is a tab coming back from the background, and a spring handed either
    // as a step input is the one thing this integrator cannot answer smoothly.
    const reseed = delta <= 0 || delta > .25 || !this.hairSeeded
    if (reseed) {
      this.hairFilter.copy(hairDriver)
      this.hairVelocity.set(0, 0, 0)
      this.hairSeeded = true
      this.hairLastLift = lift
      this.hairLastRise = 0
      hair.node.quaternion.identity()
      return
    }

    // Smoothed, because a `low`-LOD actor accumulates an eighteenth of a second
    // before it steps and the raw difference over one such step is a spike.
    const rise = THREE.MathUtils.damp(this.hairLastRise, (lift - this.hairLastLift) / delta, 9, delta)
    this.hairLastLift = lift
    this.hairLastRise = rise

    const steps = Math.min(12, Math.max(1, Math.ceil(delta * 120)))
    const step = delta / steps
    const stiffness = HAIR_OMEGA * HAIR_OMEGA
    const decay = Math.exp(-2 * HAIR_ZETA * HAIR_OMEGA * step)
    // The head rising leaves the hair behind and below it, which about this
    // pivot is a negative rotation on x. Clamped before it is scaled so that a
    // clip with an implausible vertical spike cannot inject a large impulse.
    const bob = -THREE.MathUtils.clamp(rise, -3, 3) * HAIR_BOB * hair.swing
    for (let index = 0; index < steps; index += 1) {
      lagError.copy(this.hairFilter).invert().multiply(hairDriver)
      if (lagError.w < 0) lagError.set(-lagError.x, -lagError.y, -lagError.z, -lagError.w)
      lagAxis.set(lagError.x, lagError.y, lagError.z).multiplyScalar(2)
      this.hairVelocity.addScaledVector(lagAxis, stiffness * step)
      this.hairVelocity.x += bob * step * HAIR_OMEGA
      this.hairVelocity.multiplyScalar(decay)
      const speed = this.hairVelocity.length()
      if (speed > 1e-6) {
        lagStep.setFromAxisAngle(lagAxis.copy(this.hairVelocity).divideScalar(speed), speed * step)
        this.hairFilter.multiply(lagStep).normalize()
      }
    }

    lagError.copy(this.hairFilter).invert().multiply(hairDriver)
    if (lagError.w < 0) lagError.set(-lagError.x, -lagError.y, -lagError.z, -lagError.w)
    const sin = Math.hypot(lagError.x, lagError.y, lagError.z)
    if (sin < 1e-7) {
      hair.node.quaternion.identity()
      return
    }
    const raw = 2 * Math.atan2(sin, lagError.w) * hair.swing * this.secondaryGain
    const angle = HAIR_LIMIT * Math.tanh(raw / HAIR_LIMIT)
    // Set rather than premultiplied. Every other follower in this file writes a
    // joint the mixer has already posed this frame; nothing else in the app
    // touches this node, so its local rotation *is* the lag, and accumulating
    // onto it would wind the hair round the head.
    hair.node.quaternion.setFromAxisAngle(
      lagAxis.set(lagError.x, lagError.y, lagError.z).divideScalar(sin),
      -angle,
    )
  }

  /**
   * Stops either shoe from cutting through the floor.
   *
   * Everything upstream of this treats a foot as the single point directly
   * below the ankle: the anchor is a floor point, `ankleHeight` is the lever
   * to it, and the leg solver puts the joint at that height and stops. All of
   * that is exactly right while the sole is level and quietly wrong the moment
   * it is not, because the lowest part of a pitched foot is a corner of the
   * shoe some way in front of or behind the joint. A rig whose bind pose
   * carries a few degrees of ankle pitch - which this one does, differently
   * per seed - therefore stands with its toe caps a couple of centimetres into
   * the boards, and pitches them deeper still through a walk cycle's push-off.
   *
   * The fix is the constraint itself rather than a fudge factor: find the
   * lowest corner of the actual measured sole, and if it is under the floor,
   * dorsiflex the ankle just far enough to lift it out. Rolling the foot
   * toward flat is what a real ankle does here, it is the smallest correction
   * that satisfies the constraint, and because it only engages on penetration
   * the authored heel strike and toe-off survive untouched above the floor.
   */
  private groundSoles() {
    this.root.updateWorldMatrix(true, true)
    this.root.getWorldQuaternion(this.rootQuaternion)
    this.refreshWorldScale()
    const floor = this.groundWorldY()
    const residual = Math.max(this.groundSole('left', floor), this.groundSole('right', floor))
    if (residual <= 1e-4) return

    // The ankle has rolled as far as it can and a sole is still under the
    // floor, which means the joint above it is too low - the pelvis dipped
    // further onto a trailing planted foot than the swing foot had clearance
    // for. Lift the pelvis by exactly the overshoot.
    //
    // This is a trade, and it is worth being explicit about which way it goes.
    // Raising the pelvis moves the planted foot too, by the same amount, so it
    // buys a floor the feet stay out of at the cost of up to a few centimetres
    // of drift on a foot that was supposed to be pinned. The asymmetry is in
    // how the two failures read: a shoe sunk into the boards is unmistakable
    // and is exactly what this pass exists to remove, while a pelvis a
    // centimetre or two high for a few frames is not visible at all. The cap
    // keeps a pathological pose - a clip that tries to put a foot through the
    // floor outright - from launching the body instead.
    const lift = Math.min(residual, this.skeleton.proportions.hipHeight * this.worldScale * .08)
    this.skeleton.bones.hips.position.y += lift / this.worldScale
    this.root.updateWorldMatrix(true, true)
  }

  /**
   * Put the body's weight back on the floor, for poses nothing else grounds.
   *
   * The pelvis is placed so that a *straight* leg reaches the floor, and no
   * standing clip holds a leg straight - there is always some knee in it. Full
   * detail hides that, because the planting solver pins each foot to a world
   * position and bends the leg to suit, so the pelvis height stops mattering.
   * Take the solver away, as the cheap level-of-detail path does, and the
   * bend goes straight into ground clearance instead: the character hangs in
   * the air by however much its knees are flexed, which measured up to 28cm
   * on a relaxed stance. It is entirely a distance effect, so it looks like a
   * character that walks normally near the camera and takes off across the
   * room, and no amount of staring at the clips explains it.
   *
   * Correcting it is one measurement and one offset - drop the hips until the
   * lower sole touches - and it is the lower of the two feet deliberately, so
   * a mid-stride pose settles on the foot bearing the weight and leaves the
   * swing foot in the air where it belongs. The cap is a backstop against a
   * pose with no plausible support at all; ordinary corrections are a few
   * centimetres.
   */
  private settleSoles() {
    this.root.updateWorldMatrix(true, true)
    this.refreshWorldScale()
    const floor = this.groundWorldY()
    const gap = Math.min(this.soleHeight('left'), this.soleHeight('right')) - floor
    if (Math.abs(gap) < 1e-4) return
    const limit = this.skeleton.proportions.hipHeight * this.worldScale * .5
    this.skeleton.bones.hips.position.y -= Math.max(-limit, Math.min(limit, gap)) / this.worldScale
    this.root.updateWorldMatrix(true, true)
  }

  /** World height of the lowest corner of one sole in its current pose. */
  private soleHeight(side: 'left' | 'right') {
    const foot = side === 'left' ? this.skeleton.bones.leftFoot : this.skeleton.bones.rightFoot
    const sole = this.skeleton.proportions.sole
    const scale = this.worldScale
    soleAnkle.setFromMatrixPosition(foot.matrixWorld)
    foot.getWorldQuaternion(soleCurrent)
    let lowest = Infinity
    for (const [lateral, longitudinal] of SOLE_CORNERS) {
      soleCorner
        .set(lateral * sole.halfWidth * scale, -sole.depth * scale, (longitudinal > 0 ? sole.toe : -sole.heel) * scale)
        .applyQuaternion(soleCurrent)
      const y = soleAnkle.y + soleCorner.y
      if (y < lowest) lowest = y
    }
    return lowest
  }

  /** @returns how far the lowest corner of this sole is still below the floor
   *  once the ankle has rolled as flat as it can. */
  private groundSole(side: 'left' | 'right', floor: number) {
    const foot = side === 'left' ? this.skeleton.bones.leftFoot : this.skeleton.bones.rightFoot
    const sole = this.skeleton.proportions.sole
    const scale = this.worldScale
    const halfWidth = sole.halfWidth * scale
    const depth = sole.depth * scale
    const toe = sole.toe * scale
    const heel = sole.heel * scale
    soleAnkle.setFromMatrixPosition(foot.matrixWorld)
    foot.getWorldQuaternion(soleCurrent)

    const buried = (candidate: THREE.Quaternion) => {
      let lowest = Infinity
      for (const [lateral, longitudinal] of SOLE_CORNERS) {
        soleCorner
          .set(lateral * halfWidth, -depth, longitudinal > 0 ? toe : -heel)
          .applyQuaternion(candidate)
        const y = soleAnkle.y + soleCorner.y
        if (y < lowest) lowest = y
      }
      return floor - lowest
    }

    if (buried(soleCurrent) <= 1e-4) return 0

    // The orientation this foot would have with the same heading and a level
    // sole. Derived from the foot's own facing rather than the root's so a
    // stance with the toes turned out keeps them turned out.
    soleHeading.set(0, 0, 1).applyQuaternion(soleCurrent)
    soleHeading.y = 0
    if (soleHeading.lengthSq() < 1e-8) {
      soleHeading.set(0, 0, 1).applyQuaternion(this.rootQuaternion)
      soleHeading.y = 0
      if (soleHeading.lengthSq() < 1e-8) soleHeading.set(0, 0, 1)
    }
    soleHeading.normalize()
    soleBasis.lookAt(soleHeading, soleOrigin.set(0, 0, 0), soleUp)
    soleFlat.setFromRotationMatrix(soleBasis)

    // How much of the way to level is needed. A flat sole is the best this can
    // do - if even that is buried the ankle itself is too low, which is the
    // leg solver's problem, not the ankle's - so bisect between the authored
    // orientation and flat for the smallest correction that clears the floor.
    let weight = 1
    if (buried(soleCandidate.copy(soleCurrent).slerp(soleFlat, 1)) <= 1e-4) {
      let low = 0
      let high = 1
      for (let pass = 0; pass < 6; pass += 1) {
        const mid = (low + high) * .5
        if (buried(soleCandidate.copy(soleCurrent).slerp(soleFlat, mid)) > 1e-4) low = mid
        else high = mid
      }
      weight = high
    }
    soleCandidate.copy(soleCurrent).slerp(soleFlat, weight)
    const residual = Math.max(0, buried(soleCandidate))
    applyWorldQuaternion(foot, soleCandidate)
    // Renormalised, because the round trip through world space does not
    // preserve unit length.
    //
    // `applyWorldQuaternion` reads the parent's orientation out of its world
    // matrix, and this rig's limb nodes carry non-uniform scale - that is how
    // the stylized proportions are built - so the decomposition comes back a
    // few parts in ten thousand off the unit sphere and the multiply carries
    // the error into the bone. A quaternion of length 0.99992 is not a
    // rotation: three.js composes it straight into the bone matrix, so the
    // shoe is silently scaled by its square, and anything downstream that
    // measures with `angleTo` sees a phantom 0.7 degrees between the foot and
    // itself. Both are small. Neither is nothing, and the correction is one
    // square root on two bones on the frames the sole is actually corrected.
    foot.quaternion.normalize()
    return residual
  }

  private refreshWorldScale() {
    this.root.updateWorldMatrix(true, false)
    const basis = this.root.matrixWorld.elements
    this.worldScale = Math.hypot(basis[0], basis[1], basis[2]) || 1
  }

  /** World height of the floor this character stands on. The constructor
   *  lowers the pelvis so the soles rest at y = 0 in root space, so the root's
   *  world Y is it. */
  private groundWorldY() {
    return this.root.matrixWorld.elements[13]
  }

  /**
   * Establishes or releases this foot's purchase on the floor.
   *
   * The anchor is a point on the floor rather than the ankle joint, because
   * which part of the foot bears on it changes over the stance. Which floor
   * point matters just as much: contact ramps in over several frames as the
   * foot descends, and committing to an anchor on the first frame of that ramp
   * pins the foot somewhere it has not reached yet, then drags it there. So
   * while contact is still rising the anchor follows the foot down, and only
   * once the foot is genuinely bearing weight does it freeze. On the way back
   * out it stays frozen, so the release does not reintroduce sliding.
   */
  private updateAnchor(side: 'left' | 'right', contact: number, delta: number) {
    const state = this.planted[side]
    const rising = contact > state.weight
    state.weight = contact

    if (contact <= .001) {
      state.active = false
      return
    }

    const ground = this.groundWorldY()
    if (!state.active) {
      // Engage the anchor under the foot at the height the foot is actually
      // at, not at floor level.
      //
      // Anchoring straight onto the floor is right whenever contact begins
      // because the foot has arrived there, which is every case the walk cycle
      // produces. It is badly wrong when contact begins for the other reason:
      // a crossfade into a two-footed pose hands a swing foot a contact weight
      // of one while it is still mid-air, and a floor anchor then yanks it
      // down the whole way in a single frame. Starting level with the foot
      // makes the first solved frame agree exactly with the clip, so there is
      // nothing to correct at the moment IK takes hold, and the settle below
      // takes it to the floor over the following tenth of a second.
      state.anchor.set(
        state.sampled.x,
        Math.max(ground, state.sampled.y - this.skeleton.proportions.ankleHeight * this.worldScale),
        state.sampled.z,
      )
    } else if (rising && contact < .5) {
      // Converge on the landing spot instead of snapping to it. Early in the
      // ramp the anchor follows the descending foot almost exactly; by the
      // time the foot is bearing half its weight the anchor has stopped
      // moving. Freezing it in one step instead would arrest a foot that is
      // still travelling, which is the slam this is here to avoid.
      tmpTarget.set(state.sampled.x, state.anchor.y, state.sampled.z)
      state.anchor.lerp(tmpTarget, THREE.MathUtils.clamp(1 - contact / .5, 0, 1))
    }
    // For a foot that landed normally this is already a no-op; it only has
    // work to do for a foot that took hold in the air.
    state.anchor.y = THREE.MathUtils.damp(state.anchor.y, ground, ANCHOR_SETTLE_RATE, delta)
    state.active = true
  }

  /** How far short of its planted foot this leg falls at the current pelvis
   *  height, and therefore how far the pelvis has to come down. */
  private reachDeficit(side: 'left' | 'right') {
    const state = this.planted[side]
    if (!state.active || state.weight < .001) return 0
    const hip = side === 'left' ? this.skeleton.bones.leftHip : this.skeleton.bones.rightHip
    this.footTarget(side, tmpTarget)
    tmpFootWorld.setFromMatrixPosition(hip.matrixWorld)
    const required = tmpFootWorld.distanceTo(tmpTarget)
    // Stop just short of a locked-out leg, but only just: this rig stands with
    // its legs all but straight, so a generous margin here would permanently
    // sink every character a few centimetres into a crouch they were never
    // authored in.
    const reach = (this.skeleton.proportions.thighLength + this.skeleton.proportions.shinLength)
      * this.worldScale * .995
    // Weighted by contact so the correction fades in and out with the foot.
    return required > reach ? (required - reach) * state.weight : 0
  }

  /** Where the ankle has to be for this foot to stay on its spot on the
   *  floor, given how far the foot has rolled onto its toe. */
  private footTarget(side: 'left' | 'right', out: THREE.Vector3) {
    const state = this.planted[side]
    const foot = side === 'left' ? this.skeleton.bones.leftFoot : this.skeleton.bones.rightFoot
    // Pinning the ankle outright is the obvious approach and it is wrong for
    // the second half of stance: from heel-off onwards a real foot is pivoting
    // on the ball, the ankle swinging up and back over a stationary toe. Held
    // rigidly at ankle height instead, the leg cannot shorten, so the solver
    // fights the clip's push-off knee flexion and drives the toe through the
    // floor. Rolling the contact point forward as the ankle plantarflexes -
    // and placing the ankle by rotating it about that point - makes the solver
    // want almost exactly the pose the clip already asked for, so there is
    // barely anything left to blend when the foot finally leaves the ground.
    const ankleHeight = this.skeleton.proportions.ankleHeight * this.worldScale
    const toeLength = this.skeleton.proportions.toeLength * this.worldScale
    const plantar = Math.max(0, foot.rotation.x)
    const roll = THREE.MathUtils.clamp(plantar / .25, 0, 1)
    const pivot = toeLength * roll
    out.set(
      0,
      ankleHeight * Math.cos(plantar) + pivot * Math.sin(plantar),
      pivot + ankleHeight * Math.sin(plantar) - pivot * Math.cos(plantar),
    )
    out.applyQuaternion(this.rootQuaternion).add(state.anchor)
  }

  private solveFoot(side: 'left' | 'right') {
    const state = this.planted[side]
    if (!state.active || state.weight < .001) return
    const foot = side === 'left' ? this.skeleton.bones.leftFoot : this.skeleton.bones.rightFoot
    const hip = side === 'left' ? this.skeleton.bones.leftHip : this.skeleton.bones.rightHip
    const knee = side === 'left' ? this.skeleton.bones.leftKnee : this.skeleton.bones.rightKnee

    this.footTarget(side, tmpTarget)
    fkHip.copy(hip.quaternion)
    fkKnee.copy(knee.quaternion)
    solveLegIK(
      hip,
      knee,
      foot,
      // Local lengths, deliberately: the solver converts the target into the
      // hip's parent space and works there, so these have to be in the same
      // space. Only calculations that stay in world space - the reach test
      // above, and the foot target itself - take the scaled versions.
      this.skeleton.proportions.thighLength,
      this.skeleton.proportions.shinLength,
      tmpTarget,
      bendAxis,
    )
    // Blend the solver's answer over the clip's rather than replacing it. At
    // full weight the foot is pinned exactly; on the way in and out the leg
    // hands over to and from the clip continuously.
    ikHip.copy(hip.quaternion)
    ikKnee.copy(knee.quaternion)
    hip.quaternion.slerpQuaternions(fkHip, ikHip, state.weight)
    knee.quaternion.slerpQuaternions(fkKnee, ikKnee, state.weight)
  }

  /** Drops both feet out of the walking foot-plant's memory. */
  private releaseAnchors() {
    this.planted.left.active = false
    this.planted.left.weight = 0
    this.planted.right.active = false
    this.planted.right.weight = 0
  }

  /**
   * Folds both legs onto the floor under a lowered pelvis.
   *
   * Unlike the walking foot-plant this is not anchored to a remembered contact
   * point - a seated figure is not bearing weight through its feet - it simply
   * derives, from the rig's world position and its measured limb lengths, where
   * each foot has to be to look planted: level with the floor, a little forward
   * of the hip, and directly under it laterally so the knees do not splay or
   * cross. The solver then finds the hip and knee angles to reach there, which
   * gives thighs sloping gently down onto the seat and shins hanging toward
   * vertical regardless of how tall the chair is.
   *
   * How far forward the feet go, and how much of the answer is used at all,
   * both scale with how far the pelvis has actually dropped. That is what makes
   * this usable through a sit or a stand rather than only at the two ends: at
   * full standing height it contributes nothing and hands the legs back to the
   * clip untouched, and every height in between gets a fold proportional to the
   * height lost, which is what unfolding out of a chair looks like. It also
   * keeps the target inside the leg's reach at every one of those heights, so
   * the solver is never asked for a pose it can only answer by snapping the
   * knee straight.
   *
   * @returns how folded the legs are, 0 (standing) to 1 (fully seated).
   */
  private plantSeatedLegs() {
    // Swimming is the one lowered pelvis that is not a crouch: the clip drops
    // the hips most of a hip-height to put the waterline mid-torso, and the
    // body is prone with no floor under it at all.
    if (this.current === 'swim' || this.gesture === 'swimEnter' || this.gesture === 'swimExit') return 0

    // The trigger is read in local units, before any world work, because this
    // runs for every actor on every frame and the answer is "not crouched" on
    // almost all of them. `hips.position.y` at this point in the update is the
    // rest height plus the clip's own root motion, which is exactly the
    // quantity of interest, so the whole test is one subtraction.
    const proportions = this.skeleton.proportions
    // A walk carries its own pelvis dip - it is how the clip absorbs weight -
    // and that dip is the leg cycle's business, not this solver's. The dead
    // zone is set above the deepest dip any gait clip authors and well below a
    // seat, so a walk is never touched and a walk that somehow begins from a
    // seated pose still is.
    //
    // Every other standing state needs the same protection, and did not have
    // it. A resting body shifts its weight and breathes, and both move the
    // pelvis: measured over the clips, `idle` dips 0.9% of hip height, an
    // ambient minute with beats in it reaches 2.8%. With no dead zone the
    // trigger below fires at 0.6%, so the seated fold was engaging on 47% of
    // ordinary standing `idle` frames and 91% of `idleWeightShift` ones - a
    // chair solver quietly posing the legs of a character standing in open
    // floor. Worse than the pose it produced was the way it arrived: the gate
    // opens at 17% authority rather than at zero, so each crossing stepped the
    // knees about ten degrees in a single frame. That was the largest
    // discontinuity in a live ambient capture, six times in 45 seconds, and
    // the reason it had never been caught is that it is invisible to a check
    // that drives states directly and never lets an idle simply run.
    //
    // Six per cent clears the deepest measured standing dip twice over and
    // sits an eighth of the way to a seat, so a real descent still crosses it
    // almost immediately.
    const seated = this.current === 'seatedIdle' || this.current === 'seatedType'
    const deadZone = seated ? 0 : proportions.hipHeight * (this.current === 'walk' ? .14 : .06)
    const drop = this.baseHipPosition.y - this.skeleton.bones.hips.position.y - deadZone
    // A third of hip height is roughly halfway to a seat, so the solve is at
    // full authority well before the body is actually sitting, and the last
    // stretch of the descent is the cushion taking the weight rather than the
    // legs changing shape.
    const crouch = THREE.MathUtils.clamp(drop / (proportions.hipHeight * .3), 0, 1)
    if (crouch <= 0) return 0

    this.root.updateWorldMatrix(true, true)
    this.root.getWorldQuaternion(this.rootQuaternion)
    this.refreshWorldScale()

    const scale = this.worldScale
    const floorY = this.groundWorldY()
    const ankleHeight = proportions.ankleHeight * scale
    // Feet planted forward of the hips by most of a thigh length, so the thighs
    // rest along the cushion rather than pointing straight down.
    const reach = this.skeleton.proportions.thighLength * scale * .8 * crouch
    seatedForward.set(0, 0, 1).applyQuaternion(this.rootQuaternion).multiplyScalar(reach)

    // Authority is not the same curve as shape. How far forward the feet go
    // scales with the whole descent, but how much of the solve is used has to
    // reach one almost immediately, because a pelvis even a few centimetres
    // below standing height cannot keep a foot on the floor with a straight
    // leg - it is geometrically obliged to fold, and blending only a fraction
    // of that in leaves the rest of the leg length to go through the boards.
    // The short ramp is only there so the first frame of a descent agrees with
    // the clip it is taking over from.
    const weight = Math.min(1, crouch / .12)
    this.plantSeatedLeg('left', floorY + ankleHeight, weight)
    this.plantSeatedLeg('right', floorY + ankleHeight, weight)
    return crouch
  }

  private plantSeatedLeg(side: 'left' | 'right', footY: number, weight: number) {
    const hip = side === 'left' ? this.skeleton.bones.leftHip : this.skeleton.bones.rightHip
    const knee = side === 'left' ? this.skeleton.bones.leftKnee : this.skeleton.bones.rightKnee
    const foot = side === 'left' ? this.skeleton.bones.leftFoot : this.skeleton.bones.rightFoot
    fkHip.copy(hip.quaternion)
    fkKnee.copy(knee.quaternion)
    tmpHipWorld.setFromMatrixPosition(hip.matrixWorld)
    tmpTarget.copy(tmpHipWorld).add(seatedForward)
    tmpTarget.y = footY
    solveLegIK(
      hip,
      knee,
      foot,
      this.skeleton.proportions.thighLength,
      this.skeleton.proportions.shinLength,
      tmpTarget,
      bendAxis,
    )
    if (weight >= 1) return
    ikHip.copy(hip.quaternion)
    ikKnee.copy(knee.quaternion)
    hip.quaternion.slerpQuaternions(fkHip, ikHip, weight)
    knee.quaternion.slerpQuaternions(fkKnee, ikKnee, weight)
  }

  dispose() {
    this.mixer.removeEventListener('finished', this.onGestureFinished)
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
    this.rootMotionNode.removeFromParent()
    this.animMetaNode.removeFromParent()
  }
}

/**
 * Grades a set of actors by importance and hands out level-of-detail budgets.
 *
 * The hard cap is the point of this: no matter how many characters a scene
 * contains, only a bounded number ever pay for foot IK and joint clamping in
 * a frame. Everything past the cap still animates - it still plays real clips
 * and still crossfades - it just skips the expensive world-space post-pass and
 * updates less often, which is invisible at the distances those actors are
 * seen from.
 */
export function assignHumanoidLod(
  actors: readonly HumanoidActor[],
  camera: THREE.Camera,
  options: { fullBudget?: number; mediumBudget?: number; farDistance?: number } = {},
) {
  const fullBudget = options.fullBudget ?? 4
  const mediumBudget = options.mediumBudget ?? 10
  const farDistance = options.farDistance ?? 34

  const scored = actors.map((actor) => {
    actor.root.getWorldPosition(tmpFootWorld)
    return { actor, distance: tmpFootWorld.distanceTo(camera.position) }
  })
  scored.sort((a, b) => a.distance - b.distance)

  scored.forEach(({ actor, distance }, index) => {
    if (distance > farDistance) actor.setLod('low')
    else if (index < fullBudget) actor.setLod('full')
    else if (index < fullBudget + mediumBudget) actor.setLod('medium')
    else actor.setLod('low')
  })
}
