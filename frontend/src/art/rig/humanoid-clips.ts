import * as THREE from 'three'

import { HUMANOID_NODE_NAMES, canonicalRestQuaternion, type HumanoidBone } from './humanoid-rig'

/**
 * The shared humanoid clip library.
 *
 * ## Provenance
 *
 * Every clip here is authored in this file from scratch. No third-party mesh,
 * rig, motion-capture take or animation asset is downloaded, vendored or
 * derived from. Nothing is retargeted off a Mixamo, Sketchfab, Quaternius or
 * Kenney asset, so the project takes on no licence obligation at all - not
 * even a CC0 attribution courtesy, and certainly not the CC-BY terms attached
 * to the Sketchfab reference the user pointed at.
 *
 * The joint-angle curves below are shaped from the published, widely
 * replicated description of the human gait cycle found in any clinical gait
 * analysis text: hip flexion peaking near heel strike and extending through
 * stance, the characteristic double-bump knee flexion curve, the ankle's
 * controlled plantarflexion after heel strike followed by push-off, pelvic
 * transverse rotation and obliquity, and thorax counter-rotation. Those are
 * measurements of how human bodies move - facts, not an authored work - and
 * the specific keyframes here are our own interpretation of them, tuned by eye
 * for this stylized cast.
 *
 * ## Why authored curves rather than a licensed clip
 *
 * Beyond the licensing, this costs almost nothing: a clip is a few hundred
 * numbers of source, roughly 8 KB gzipped for the entire library, versus
 * several hundred KB for a compressed skinned glTF plus the loader and Draco
 * decoder needed to read it. Given that load time is this app's standing top
 * priority, the authored path wins on both axes at once.
 */

/** Degrees. Authoring in degrees keeps the biomechanical numbers legible. */
type Curve = number[]

/** Sparse per-bone rotation channels. Only channels that move are listed. */
type BoneChannels = Partial<Record<'x' | 'y' | 'z', Curve>>
type PoseChannels = Partial<Record<HumanoidBone, BoneChannels>>

/**
 * Normalized root channels, expressed in hip-heights rather than world units.
 *
 * This is the core of the retargeting story. The stylized cast has exaggerated
 * proportions - bigger heads, shorter legs - so any distance baked into a clip
 * in absolute units would be wrong for them. Storing translation as a fraction
 * of the character's own hip height means one clip drives a tall associate and
 * a short client correctly, and the actor multiplies back into world units
 * using the proportions measured off that specific rig at bind time.
 */
type RootChannels = {
  /** Lateral weight shift over the stance foot. */
  x?: Curve
  /** Hip rise and fall about the rest height, where 0 is the bind pose. */
  y?: Curve
  /** Fore/aft shift. */
  z?: Curve
}

type ClipSpec = {
  name: string
  duration: number
  loop: boolean
  channels: PoseChannels
  root?: RootChannels
  /**
   * Per-foot ground contact over the clip, as a 0-to-1 weight curve.
   *
   * A weight rather than an on/off flag, and that distinction matters more
   * than it looks. Contact was originally a boolean window, which meant the
   * solver went from full authority to none between two frames: at toe-off the
   * IK was holding the knee nearly straight to keep the ankle down while the
   * clip already wanted it forty degrees into swing flexion, and handing over
   * abruptly threw the knee thirteen degrees in a single frame. As a curve the
   * release can be authored where it physically belongs - weight rolls off the
   * foot through pre-swing as the heel lifts - so the leg is already following
   * the clip by the time it leaves the ground.
   *
   * Omitting it means both feet are planted throughout, which is what every
   * standing clip wants.
   */
  contact?: { left?: Curve; right?: Curve }
  /** 0 when the character is off its feet (seated), 1 when standing. */
  grounded?: number | Curve
  /**
   * Phase to hold under `prefers-reduced-motion`.
   *
   * Deliberately never 0. Freezing at the first frame is a mistake this
   * codebase has already made once: gesture curves start at zero amplitude, so
   * frame zero showed reduced-motion users nothing at all. Each clip names the
   * phase that best represents it - the apex of a celebration, a settled
   * mid-stance for a walk - so reduced motion lands on a correct, legible held
   * pose.
   */
  restPhase: number
  /**
   * How this clip combines with whatever is already playing.
   *
   * `override` clips are complete poses and replace what came before through a
   * crossfade; a walk and a stand cannot both be true at once, so those are
   * override. `additive` clips are *deltas* from whatever the body is already
   * doing, and the mixer post-multiplies them onto the base pose rather than
   * blending away from it.
   *
   * That distinction is the whole reason the idle stopped reading as a loop.
   * Playing a gesture as an override means fading the idle out for its
   * duration: the breathing stops, the weight-shift stops, the body holds
   * still and performs, and then the idle starts again - which is exactly the
   * "animation plays, animation ends" rhythm that gives a character away as a
   * puppet. Played additively the breath, sway and weight shift underneath
   * never pause; the gesture rides on top of a body that is still living, and
   * because the base clip keeps advancing at its own incommensurate period the
   * same gesture lands on a different underlying pose every time it fires.
   */
  blend?: 'override' | 'additive'
  /**
   * Which joint initiates this beat, and therefore which way the overlap runs.
   *
   * See `CHAIN_LAG`. `'torso'` is the default and the usual case - the body
   * drives and the head and hands trail it. `'head'` is for beats a person
   * starts with their eyes: a glance, a nod, a double take. There the head
   * moves first and the shoulders come round after it, and getting the order
   * backwards is immediately legible as a puppet whose head is bolted to a
   * turning box. `'none'` disables the pass for clips whose phase
   * relationships are authored deliberately and measured elsewhere.
   */
  chain?: ChainProfile
}

const DEG = Math.PI / 180

// ---------------------------------------------------------------------------
// Overlapping action, as a build-time pass.
//
// Nothing in a body arrives at once. A torso rotation reaches the chest a
// moment after the hips, the head a moment after that, and the hand at the end
// of a slack arm later still - each segment is dragged by the one above it
// through a joint that is not rigid, so the distal end always lags and always
// overshoots on arrival. Animators call the two halves of this overlapping
// action and follow-through, and their absence is the single loudest tell that
// a figure is being posed rather than moving: every joint starting and
// stopping on the same frame reads as one solid object no matter how smooth
// the easing on it is.
//
// Authoring the lag by hand means writing every curve in a clip several times
// at several offsets, which is both a lot of source and a standing invitation
// for the copies to drift apart. Doing it as a phase offset at bake time makes
// it exact, uniform and free at runtime: each bone samples its own channels a
// few percent of the clip behind the bone above it, and the baked keyframes
// carry the result. Legs and hips are deliberately absent - they are the root
// of the chain, and on the locomotion clips their timing against the contact
// curve is what keeps a planted foot planted.
// ---------------------------------------------------------------------------

type ChainProfile = 'torso' | 'head' | 'none'

const CHAIN_LAG: Record<Exclude<ChainProfile, 'none'>, Partial<Record<HumanoidBone, number>>> = {
  // Driven from the pelvis: spine, chest, head, then out along each arm.
  torso: {
    spine: .012,
    chest: .026,
    head: .044,
    leftShoulder: .030, rightShoulder: .030,
    leftElbow: .055, rightElbow: .055,
    leftHand: .078, rightHand: .078,
  },
  // Led by the eyes. The head is the reference and everything below it trails,
  // which inverts only the head/torso pair; the arms still hang off the end of
  // the same chain and still arrive last.
  head: {
    head: 0,
    chest: .020,
    spine: .032,
    leftShoulder: .028, rightShoulder: .028,
    leftElbow: .050, rightElbow: .050,
    leftHand: .074, rightHand: .074,
  },
}

/**
 * Delays a phase by `lag` without moving either end of the clip.
 *
 * A looping clip can simply be read at an earlier phase, because there is no
 * end to preserve - the sampler wraps. A one-shot cannot: a flat offset would
 * leave the hand somewhere other than its authored final pose when the clip
 * finished, which for an additive beat means a residual delta at the exact
 * moment the mixer fades it out. Warping the phase by a half-sine instead is
 * zero at both ends and maximal in the middle, so the beat still starts and
 * finishes exactly where it was authored to and only its interior slides
 * later - which is what a trailing joint actually does. It stays monotonic
 * (and so cannot run time backwards) for any lag below 1/pi.
 */
function laggedPhase(phase: number, lag: number, loop: boolean) {
  if (lag === 0) return phase
  return loop ? phase - lag : phase - lag * Math.sin(Math.PI * phase)
}

function chainLagFor(spec: ClipSpec, bone: HumanoidBone) {
  const profile = spec.chain ?? 'torso'
  if (profile === 'none') return 0
  return CHAIN_LAG[profile][bone] ?? 0
}

/**
 * One timing shape, applied to many joints.
 *
 * A pose change is a single event, and the thing that makes it read as one is
 * that every joint involved shares its accent: they anticipate together,
 * accelerate together, overshoot together and settle together, differing only
 * in how far each travels and - through `CHAIN_LAG` - in when it starts.
 * Writing that shape once and scaling it per joint is both far less source
 * than twenty hand-typed arrays and structurally incapable of the failure
 * where one channel's overshoot has quietly been tuned out of step with the
 * rest.
 *
 * `shape` runs 0 at rest to 1 at the held pose, and is free to leave that
 * range: below zero is the anticipation, above one the overshoot.
 */
function shaped(shape: Curve, rest: number, target: number): Curve {
  return shape.map((value) => rest + (target - rest) * value)
}

/**
 * Widens a curve's excursion without moving the pose it sits at.
 *
 * The resting stances were authored to life, and to life they are correct: a
 * person standing quietly swings a shoulder through about four degrees and a
 * forearm through eight, and those are the numbers here. The trouble is that
 * being correct is not the same as being legible. The hero panel renders the
 * figure roughly three hundred pixels tall, which puts a degree at the
 * shoulder at about one and a half pixels, so four degrees of authored sway
 * moves a hand six pixels over five and a half seconds - slower than the eye's
 * threshold for motion at that size, and therefore a still image with a
 * character in it.
 *
 * Scaling about the mean rather than about zero is the whole point of doing it
 * this way. The mean of each curve is where that limb *rests* in that stance -
 * the arm carried a little forward in `idleRelaxed`, a little back in
 * `idleAlert` - and those differences are what make the four stances read as
 * four postures rather than one posture at four speeds. Multiplying the raw
 * numbers would scale the posture along with the sway and collapse them
 * together; multiplying the deviation leaves every stance standing exactly
 * where it was authored to and only changes how much it breathes there.
 */
function swing(curve: Curve, gain: number): Curve {
  const mean = curve.reduce((sum, value) => sum + value, 0) / curve.length
  return curve.map((value) => mean + (value - mean) * gain)
}

/**
 * How far each part of a resting stance is widened.
 *
 * Set by how many pixels the joint's motion buys rather than by taste. The
 * arms carry the most because they are the longest lever in the body and the
 * largest part of the silhouette: a hanging hand is a metre from the shoulder
 * it swings from, so the same angular change there moves several times as many
 * pixels as it does anywhere else, and arms that do not move are what make a
 * standing figure read as a mannequin no matter what its head is doing. The
 * torso carries least because it is the shortest lever and because it is what
 * everything above it stands on - widening the spine moves the head, the arms
 * and the silhouette all at once, so a little goes a long way and too much
 * turns quiet standing into swaying.
 */
const IDLE_ARM_SWING = 2.2
const IDLE_HEAD_SWING = 1.75
const IDLE_TORSO_SWING = 1.35

/**
 * Resting elbow flex added to every standing idle, in degrees.
 *
 * The idles were authored around nine degrees of bend, which is very nearly a
 * straight arm, and a straight arm is the single thing that most makes a
 * standing figure read as a shop mannequin: it gives the silhouette two hard
 * vertical edges, it presses the hands flat against the thighs so they stop
 * being separate shapes, and it leaves the elbow with nothing to overlap
 * through, so the whole limb turns about the shoulder as one rigid rod. A
 * relaxed person carries fifteen to twenty-five degrees; stylised characters
 * are usually pushed past that so the gap between hand and hip survives being
 * seen small. This is a mean offset applied after `swing`, so it changes where
 * the arm rests without touching how much it moves there.
 */
const IDLE_ELBOW_BEND = -13

/** Shifts a whole curve by a constant, leaving its shape untouched. */
function bias(curve: Curve, amount: number): Curve {
  return curve.map((value) => value + amount)
}

/**
 * C2-continuous interpolating cubic spline through a control-point sequence.
 *
 * Sparse control points are what make these curves readable and the bundle
 * small, but the interpolation between them decides whether the result reads
 * as motion or as a mechanism. Straight lines give a constant angular velocity
 * between each pair and a hard velocity change at every point, which is the
 * ticking quality the old system was criticised for. Catmull-Rom fixes the
 * velocity but not the acceleration: it is only C1, so acceleration steps at
 * every control point, and at four frames apart that is a measurable buzz on
 * top of the motion.
 *
 * A natural cubic spline is C2 - position, velocity and acceleration all carry
 * through every control point - so the only frequency content in the result is
 * what was authored. It costs a small linear solve, done once when the clip
 * library is built and never again at runtime.
 */
const momentCache = new Map<Curve, number[]>()

function splineMoments(points: Curve, loop: boolean) {
  const cached = momentCache.get(points)
  if (cached) return cached
  const count = points.length
  const moments = new Array<number>(count).fill(0)
  if (count >= 3) {
    const at = (index: number) => loop
      ? points[((index % count) + count) % count]
      : points[THREE.MathUtils.clamp(index, 0, count - 1)]
    const rhs = new Array<number>(count)
    for (let index = 0; index < count; index += 1) {
      rhs[index] = 6 * (at(index - 1) - 2 * at(index) + at(index + 1))
    }
    // m[i-1] + 4 m[i] + m[i+1] = rhs[i]. Strictly diagonally dominant, so
    // Gauss-Seidel converges to machine precision in a few dozen sweeps and
    // avoids a special-cased cyclic tridiagonal solver.
    for (let sweep = 0; sweep < 200; sweep += 1) {
      for (let index = 0; index < count; index += 1) {
        if (!loop && (index === 0 || index === count - 1)) continue
        const previous = loop ? moments[((index - 1 + count) % count)] : moments[index - 1]
        const next = loop ? moments[(index + 1) % count] : moments[index + 1]
        moments[index] = (rhs[index] - previous - next) / 4
      }
    }
  }
  momentCache.set(points, moments)
  return moments
}

function cubicSpline(points: Curve, t: number, loop: boolean) {
  const count = points.length
  if (count === 0) return 0
  if (count === 1) return points[0]
  const moments = splineMoments(points, loop)
  const scaled = t * (loop ? count : count - 1)
  const index = Math.floor(scaled)
  const frac = scaled - index
  const at = (i: number) => loop
    ? points[((i % count) + count) % count]
    : points[THREE.MathUtils.clamp(i, 0, count - 1)]
  const momentAt = (i: number) => loop
    ? moments[((i % count) + count) % count]
    : moments[THREE.MathUtils.clamp(i, 0, count - 1)]
  const a = 1 - frac
  const b = frac
  return a * at(index) + b * at(index + 1)
    + ((a * a * a - a) * momentAt(index) + (b * b * b - b) * momentAt(index + 1)) / 6
}

/**
 * Bounds on how densely a clip is baked, in samples per second.
 *
 * The mixer slerps linearly between baked samples, so the played-back curve is
 * a polyline through the spline rather than the spline itself. That makes
 * angular velocity piecewise-constant, stepping once per sample interval, and
 * those steps are the only high-frequency content in the motion - the buzz
 * this system exists to remove. Density is the one knob that controls it, and
 * `bakeRateFor` sets each clip's own within these bounds.
 */
const MIN_SAMPLE_RATE = 18
const MAX_SAMPLE_RATE = 72

// ---------------------------------------------------------------------------
// Sign conventions in this rig, verified against the existing pose code.
//   hip.x      negative = flexion (leg swings forward)
//   knee.x     positive = flexion (heel toward the seat); never negative
//   foot.x     positive = plantarflexion (toes down)
//   shoulder.x negative = arm forward
//   elbow.x    negative = flexion (forearm folds forward)
//   spine.x    positive = forward bend
//   head.x     positive = chin down
//   hips.y     positive = pelvis rotates the left hip forward
// ---------------------------------------------------------------------------

/**
 * The walk cycle, phase 0 at left heel strike.
 *
 * The right leg reuses these same curves shifted half a cycle, which is what a
 * symmetric gait is; the small left/right differences a real person has are
 * added per-actor at runtime instead of baked in here, so one shared clip can
 * still drive a whole office of visibly individual people.
 */
// The leg curves run at sixteen control points rather than eight. Terminal
// swing is the reason: the knee has to extend hard and then *decelerate* into
// heel strike, and at eight points there is nowhere to put that deceleration,
// so the shin arrives at the floor still travelling and the footfall reads as
// a slam.
const WALK_HIP: Curve = [-25, -22, -17, -12, -7, -2, 3, 7, 10, 10, 6, -3, -14, -22, -26, -27]
/** The double bump: a small loading-response flexion right after heel strike
 *  that absorbs the impact, then near-extension at midstance, then the large
 *  swing flexion. Without the first bump a walk reads as stilted stilts. */
const WALK_KNEE: Curve = [5, 14, 18, 16, 12, 7, 5, 7, 12, 26, 45, 57, 62, 54, 34, 12]
const WALK_ANKLE: Curve = [0, 6, 8, 5, 2, -2, -6, -8, -10, 2, 16, 12, 2, -1, -4, -3]
const WALK_SHOULDER: Curve = [12, 8, 2, -8, -18, -20, -10, 3]
const WALK_ELBOW: Curve = [-14, -12, -12, -16, -24, -28, -22, -16]
/** Ground-contact weight for the left foot, at twice the resolution of the
 *  joint curves so heel strike can be sharp while toe-off stays gradual. */
const WALK_CONTACT: Curve = [1, 1, 1, 1, 1, 1, 1, 1, 1, .85, .4, .08, 0, 0, .1, .45]

/** Rotates a control-point sequence by half a cycle. */
function halfPhase(curve: Curve): Curve {
  const shift = curve.length / 2
  return curve.map((_, index) => curve[(index + shift) % curve.length])
}

/**
 * The flutter kick, at three beats per leg per stroke cycle.
 *
 * Twelve control points over three periods, so `halfPhase` puts the other leg
 * exactly in antiphase. Choosing an odd number of kick beats per stroke is
 * deliberate: at an even count every kick would land on the same phase of the
 * arm cycle and the two rhythms would visibly lock together.
 */
const SWIM_KICK_HIP: Curve = [-13, 0, 13, 0, -13, 0, 13, 0, -13, 0, 13, 0]
/** The knee whips a quarter-beat behind the hip, which is what makes a kick
 *  look like it is driving water rather than a straight leg waving. */
const SWIM_KICK_KNEE: Curve = [20, 33, 17, 5, 20, 33, 17, 5, 20, 33, 17, 5]

/**
 * The timing of the victory beat, from rest (0) to the held pose (1).
 *
 * Every principle this clip is built on is visible as a number here, which is
 * the point of authoring it as one shape rather than as twenty independent
 * curves:
 *
 * - **Anticipation** (indices 1-4). The body goes the wrong way first, to
 *   -0.14. Nothing in the pose is happening yet; the character is loading.
 * - **The launch** (5-8). Four intervals, roughly half a second, from -0.12 to
 *   1.18. This is the fast half and it gets the fewest control points, which
 *   is how an asymmetric ease is spelled when the spline runs through evenly
 *   spaced points: fewer points over a span means more angle per interval
 *   means faster.
 * - **Overshoot** (9). 1.24 - the arms and torso pass the pose they are
 *   heading for by a quarter of the distance they travelled to reach it. A
 *   motion that eases monotonically into its target has no weight, because
 *   nothing with mass stops exactly where it was aimed.
 * - **The landing** (10-12). Back down through 0.94 to 0.86 as the feet take
 *   the body's weight again. This is a second, smaller anticipation, and it is
 *   what stops the settle reading as the animation simply running out.
 * - **The settle** (13-21). Nine points - more than the whole first half of
 *   the clip - for a decaying ring through 1.06, 0.98, 1.01, 1.00. Slow, and
 *   getting slower, which is the shape of a body's residual motion dying out.
 */
const CELEBRATE_POSE: Curve = [
  0, -.04, -.10, -.14, -.12,
  .10, .55, .95, 1.18,
  1.24, 1.12, .94, .86,
  .95, 1.06, 1.03, .98, 1.01, 1.00, .995, 1.00, 1.00,
]

// ---------------------------------------------------------------------------
// Three reusable timings for the additive repertoire.
//
// `CELEBRATE_POSE` above proved the approach and these generalise it: rather
// than hand-typing anticipation and overshoot into every channel of every
// beat - where they inevitably end up subtly out of step with each other, and
// where a later tuning pass quietly flattens some of them - a beat names one
// of these shapes and scales it per joint. The principles then hold by
// construction, and the difference between two beats is what moves and how
// far, which is what it should be.
//
// All three start and end at exactly zero, because these drive additive clips:
// a residual delta at the last frame is a step in the pose at the moment the
// mixer releases the layer.
// ---------------------------------------------------------------------------

/**
 * Load, strike, overshoot, ring down, release. The default accent.
 *
 * Twenty-one points, allocated by speed rather than evenly, which is the only
 * way to write an asymmetric ease through uniformly spaced control points.
 * Three cover the anticipation, three the strike, and the strike therefore
 * moves 1.33 of the beat's travel in a seventh of its duration. Seven cover
 * the release, which is consequently about five times slower than the strike -
 * the ratio that separates a body letting go of a pose from a body being
 * dragged back out of it.
 */
const BEAT_STRIKE: Curve = [
  0, -.08, -.15, -.11,
  .42, .92, 1.18,
  1.24, 1.05, .95,
  1.03, 1.00, .99, 1.00,
  .96, .84, .62, .36, .15, .04, 0,
]

/**
 * The same accent, then a pose genuinely held, then a slow release.
 *
 * The plateau is the reason this exists as a separate shape. A beat that
 * arrives at a pose and immediately leaves it reads as a twitch however well
 * the ends are eased; a beat that arrives, stays for the better part of a
 * second while the base clip keeps breathing underneath it, and only then
 * unwinds reads as a decision. The plateau is not flat either - it drifts
 * either side of one by half a percent - because a real body holding a pose
 * is still making corrections.
 *
 * The release undershoots to -0.02 before returning, which is the small
 * counter-motion of a limb coming back past where it started and settling.
 */
const BEAT_HOLD: Curve = [
  0, -.07, -.13, -.09,
  .40, .90, 1.15,
  1.21, 1.04, .97,
  1.01, .995, 1.005, .99, 1.00, .985, .995,
  .93, .74, .48, .24, .07, -.02, 0,
]

/**
 * No strike at all: a slow gathering to a rounded peak and a slower fall.
 *
 * For the beats that are driven by breath rather than by intent. There is
 * still an anticipation - one point at -0.05, the small settle before a lift -
 * and still an overshoot, but it is at the *bottom*: the fall carries past
 * rest to -0.04 and comes back, which is what a body that has just let go of
 * something does.
 */
const BEAT_SWELL: Curve = [
  0, -.05, .12, .38, .68, .92, 1.06, 1.10, 1.06, .98,
  .88, .76, .62, .48, .34, .21, .10, .02, -.04, -.03, 0,
]

/**
 * Two accents, the second smaller, later and not quite in the same place.
 *
 * Gesturing while making a point is not one motion, it is a rhythm, and the
 * thing that makes it read as speech rather than as a wave is that the second
 * beat neither returns to rest before it starts nor reaches as far as the
 * first. The trough between them sits at 0.34, so the hand is still up when it
 * goes again.
 */
const BEAT_DOUBLE: Curve = [
  0, -.09, -.14,
  .48, 1.02, 1.20, 1.02,
  .58, .34,
  .72, .95, .88,
  .62, .40, .22, .09, .02, 0,
]

const CLIP_SPECS: ClipSpec[] = [
  {
    name: 'idle',
    duration: 5.6,
    loop: true,
    restPhase: .3,
    // Quiet standing is not stillness. A person at rest sways continuously as
    // they rebalance, breathes on a slower rhythm than they sway, and shifts
    // weight between feet on a slower one still. Three incommensurate periods
    // read as one relaxed body; a single period reads as a metronome.
    channels: {
      hips: { y: swing([0, 1.1, .4, -.8, -1.2, -.3, .7, .9], IDLE_TORSO_SWING), z: swing([.5, .9, .4, -.5, -.9, -.6, 0, .4], IDLE_TORSO_SWING) },
      spine: { x: swing([1.2, .6, 1.4, 2.0, 1.5, .8, 1.3, 1.7], IDLE_TORSO_SWING), y: swing([-.6, -1.0, -.4, .5, 1.0, .6, 0, -.4], IDLE_TORSO_SWING), z: swing([.4, .8, .3, -.4, -.8, -.5, .1, .5], IDLE_TORSO_SWING) },
      chest: { x: swing([-.8, -1.6, -.9, -.2, -1.0, -1.7, -1.0, -.3], IDLE_TORSO_SWING), z: swing([-.3, -.6, -.2, .3, .6, .4, 0, -.3], IDLE_TORSO_SWING) },
      head: { x: swing([.4, -.2, .5, 1.0, .3, -.3, .6, .8], IDLE_HEAD_SWING), y: swing([1.4, .6, -.8, -1.6, -.7, .9, 1.7, 1.8], IDLE_HEAD_SWING), z: swing([-.4, -.7, -.2, .4, .7, .5, 0, -.3], IDLE_HEAD_SWING) },
      // Arms as secondary motion, which is the whole difference between a
      // person standing and a coat on a stand.
      //
      // A hanging arm is not driven; it is carried. The torso sways, and the
      // arm follows a beat later because it has mass, with the forearm later
      // still - so these curves are the spine's own sway shifted a quarter and
      // then a half cycle down the chain rather than new shapes. Getting that
      // lag wrong is worse than having no sway at all: an arm that swings in
      // phase with the chest reads as one rigid piece, which is exactly the
      // mannequin the sway is meant to fix.
      //
      // The amplitudes are set by what survives the trip to the screen. The
      // portrait shows about four hip-heights in five hundred pixels, so the
      // 1.3 degrees of shoulder travel this clip used to carry moved a hand by
      // three pixels over a five-second cycle - true to life, and invisible,
      // which makes it the wrong call. Four to five degrees puts the hands
      // through roughly a tenth of a hip-height, still quiet enough to read as
      // rest rather than fidgeting.
      leftShoulder: { x: swing([1.8, 2.9, 2.6, 3.7, 2.3, .4, -.7, .1], IDLE_ARM_SWING), z: swing([1.2, 1.7, 1.6, 2.1, 1.5, .6, .1, .5], IDLE_ARM_SWING) },
      rightShoulder: { x: swing([.4, 1.7, 2.6, 2.4, 3.3, 2.2, .6, -.3], IDLE_ARM_SWING), z: swing([-.6, -1.3, -1.8, -1.7, -2.1, -1.5, -.8, -.3], IDLE_ARM_SWING) },
      leftElbow: { x: bias(swing([-13, -11.5, -8.5, -6.5, -7, -5, -7.5, -11], IDLE_ARM_SWING), IDLE_ELBOW_BEND) },
      rightElbow: { x: bias(swing([-8.8, -11.6, -13.2, -12, -9.6, -8, -8.4, -6.8], IDLE_ARM_SWING), IDLE_ELBOW_BEND) },
      leftHip: { x: [-.6, -1.0, -.5, .3, .8, .5, 0, -.4] },
      rightHip: { x: [.5, .9, .4, -.3, -.7, -.5, 0, .4] },
      leftKnee: { x: [3.5, 4.2, 3.6, 2.8, 3.2, 4.0, 3.7, 3.0] },
      rightKnee: { x: [3.2, 3.8, 3.4, 2.6, 3.4, 4.1, 3.5, 2.8] },
    },
    root: {
      // The pelvis wanders. Quiet standing is a slow, continuous rebalancing
      // act, and the part of it that carries is not the joint angles - those
      // only lean the stack of segments - but the centre of mass drifting from
      // one foot toward the other and back. Three hundredths of a hip height
      // is about eight centimetres of travel on this cast over five and a half
      // seconds, slow enough to read as balance rather than as swaying.
      x: [0, .008, .015, .012, .002, -.010, -.016, -.009],
      y: [0, -.002, -.001, .002, .003, .001, -.001, -.002],
    },
    grounded: 1,
  },
  {
    name: 'idleWeightShift',
    duration: 6.4,
    loop: true,
    restPhase: .35,
    // The same relaxed stand with the weight carried on the other leg. Having
    // two genuinely different resting stances, and drifting between them, is
    // most of what stops a room of standing characters reading as mannequins.
    channels: {
      hips: { y: swing([-.8, -1.2, -.6, .3, .8, .4, -.3, -.7], IDLE_TORSO_SWING), z: swing([-2.6, -3.0, -2.7, -2.2, -2.5, -2.9, -2.6, -2.3], IDLE_TORSO_SWING) },
      spine: { x: swing([1.6, 1.0, 1.8, 2.3, 1.7, 1.1, 1.5, 2.0], IDLE_TORSO_SWING), z: swing([2.0, 2.4, 2.1, 1.6, 1.9, 2.3, 2.0, 1.7], IDLE_TORSO_SWING) },
      chest: { x: swing([-.6, -1.4, -.7, 0, -.8, -1.5, -.8, -.1], IDLE_TORSO_SWING), z: swing([1.1, 1.4, 1.2, .8, 1.0, 1.3, 1.1, .9], IDLE_TORSO_SWING) },
      head: { x: swing([.6, 0, .7, 1.1, .4, -.1, .8, 1.0], IDLE_HEAD_SWING), y: swing([-1.6, -.7, .6, 1.5, .8, -.6, -1.5, -1.8], IDLE_HEAD_SWING), z: swing([1.3, 1.6, 1.2, .9, 1.2, 1.5, 1.3, 1.0], IDLE_HEAD_SWING) },
      // Same lag treatment as `idle`, but the weighted side hangs heavier: the
      // arm over the loaded leg sways less and holds closer to the body, which
      // is what carrying your weight on one hip actually does to it.
      leftShoulder: { x: swing([1.4, 2.2, 2.0, 2.8, 1.8, .5, -.2, .5], IDLE_ARM_SWING), z: swing([2.4, 2.9, 2.8, 3.3, 2.7, 1.8, 1.3, 1.7], IDLE_ARM_SWING) },
      rightShoulder: { x: swing([.8, 1.9, 2.6, 2.4, 3.1, 2.2, .9, .2], IDLE_ARM_SWING), z: swing([-.2, -.8, -1.2, -1.1, -1.4, -1.0, -.4, 0], IDLE_ARM_SWING) },
      leftElbow: { x: bias(swing([-14, -12.5, -9.5, -7.5, -8, -6, -8.5, -12], IDLE_ARM_SWING), IDLE_ELBOW_BEND) },
      rightElbow: { x: bias(swing([-5.2, -7.4, -8.6, -7.8, -6.2, -5, -5.4, -4.2], IDLE_ARM_SWING), IDLE_ELBOW_BEND) },
      leftHip: { x: [1.2, .8, 1.4, 1.9, 1.5, 1.0, 1.3, 1.7], z: [-3.4, -3.4, -3.4, -3.4, -3.4, -3.4, -3.4, -3.4] },
      rightHip: { x: [-2.0, -2.4, -1.9, -1.4, -1.8, -2.3, -2.0, -1.6], z: [1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2] },
      leftKnee: { x: [2.2, 2.8, 2.4, 1.8, 2.1, 2.7, 2.3, 1.9] },
      rightKnee: { x: [8.5, 9.2, 8.7, 8.0, 8.4, 9.1, 8.6, 8.1] },
    },
    root: {
      // The weight transfer itself lives in the crossfade, not in this loop.
      //
      // Within one cycle of this clip the character is already standing on one
      // leg, so there is nothing to shift; what makes the shift visible is
      // drifting between this stance and the other two, each of which carries
      // the pelvis at a different place. That is why this is a large offset
      // with a small wobble rather than a travelling curve - the 1.1s
      // idle↔idleWeightShift fade is the weight moving across.
      x: [.068, .074, .078, .075, .068, .062, .060, .063],
      y: [-.004, -.006, -.005, -.003, -.004, -.006, -.005, -.003],
    },
    grounded: 1,
  },
  {
    name: 'idleRelaxed',
    duration: 7.3,
    loop: true,
    restPhase: .32,
    // A third resting stance, and the reason for it is arithmetic rather than
    // artistic. With two idles the ambient drift can only ever go A to B and
    // back, and a two-state alternation is a pattern an audience picks up
    // inside a minute however long the crossfades are. A third breaks it: the
    // sequence stops being predictable, and because the three have different
    // periods - 5.6s, 6.4s and 7.3s, deliberately sharing no common factor -
    // the pose the body is in when a drift begins is different every time.
    //
    // Posturally this is the "settled" one: weight even, hands hanging a
    // little further forward, the slowest breath of the three.
    channels: {
      hips: { y: swing([0, .9, 1.4, .8, -.5, -1.2, -.9, -.3], IDLE_TORSO_SWING), z: swing([-.8, -1.1, -.9, -.5, -.7, -1.0, -.9, -.6], IDLE_TORSO_SWING) },
      spine: { x: swing([2.2, 2.6, 2.1, 1.6, 2.0, 2.5, 2.2, 1.8], IDLE_TORSO_SWING), y: swing([.7, 1.3, .5, -.7, -1.3, -.8, .2, .5], IDLE_TORSO_SWING), z: swing([.6, .9, .7, .3, .5, .8, .7, .4], IDLE_TORSO_SWING) },
      chest: { x: swing([-1.0, -1.8, -1.1, -.4, -1.2, -1.9, -1.2, -.5], IDLE_TORSO_SWING), z: swing([.3, .5, .3, 0, .2, .4, .3, .1], IDLE_TORSO_SWING) },
      // Settled does not mean asleep. This stance moves the least of the three
      // by design, so its head carries proportionally more of what movement
      // there is - otherwise the one the eye lands on during a long pause is
      // the one that looks switched off.
      head: { x: swing([1.0, .2, 1.2, 1.9, .8, 0, 1.3, 1.6], IDLE_HEAD_SWING), y: swing([-1.4, .6, 2.4, 1.6, -.9, -2.6, -2.1, -.5], IDLE_HEAD_SWING), z: swing([.5, .8, .5, .1, .4, .7, .6, .3], IDLE_HEAD_SWING) },
      // Both arms carried slightly forward of the seam of the trousers, which
      // is where hands actually hang, and asymmetrically: the shared clip is
      // the same for everyone, so the difference has to be authored in.
      leftShoulder: { x: swing([-3.9, -2.7, -3.0, -1.9, -3.1, -5.0, -6.1, -5.3], IDLE_ARM_SWING), z: swing([.4, 1.0, .9, 1.5, .8, -.1, -.6, -.2], IDLE_ARM_SWING) },
      rightShoulder: { x: swing([-4.6, -2.7, -1.4, -1.8, -.5, -1.8, -3.7, -5.1], IDLE_ARM_SWING), z: swing([-.4, -1.2, -1.8, -1.6, -2.2, -1.5, -.6, 0], IDLE_ARM_SWING) },
      leftElbow: { x: bias(swing([-16, -14.5, -11.5, -9.5, -10, -8, -10.5, -14], IDLE_ARM_SWING), IDLE_ELBOW_BEND) },
      rightElbow: { x: bias(swing([-9.5, -13.6, -15.9, -14.2, -10.7, -8.4, -9, -6.7], IDLE_ARM_SWING), IDLE_ELBOW_BEND) },
      leftHip: { x: [-.4, -.8, -.3, .4, .7, .4, 0, -.3] },
      rightHip: { x: [.4, .7, .3, -.3, -.6, -.3, 0, .3] },
      leftKnee: { x: [4.0, 4.6, 4.1, 3.4, 3.8, 4.5, 4.2, 3.6] },
      rightKnee: { x: [3.8, 4.4, 4.0, 3.2, 4.0, 4.6, 4.1, 3.4] },
    },
    root: {
      // Offset to the other side from `idleWeightShift`, so the three resting
      // stances sit at three different places rather than two.
      x: [-.030, -.024, -.019, -.022, -.031, -.038, -.040, -.036],
      y: [0, -.001, -.001, .001, .002, .001, 0, -.001],
    },
    grounded: 1,
  },
  {
    name: 'idleAlert',
    duration: 8.1,
    loop: true,
    restPhase: .28,
    // A fourth resting stance, and the arithmetic that argued for a third
    // argues harder for this one.
    //
    // Three stances the director drifts between produce six ordered pairs, and
    // over a long sitting the eye starts to recognise the transitions
    // themselves rather than the poses. Four produce twelve. More usefully,
    // this one is postually the odd one out: the other three are variations on
    // standing at ease, and this is standing *attentively* - weight a little
    // forward, chest open, chin fractionally up, hands carried behind the
    // trouser seam rather than in front of it. Drifting into it looks like the
    // character's attention changing, which is the thing an ambient idle is
    // actually for.
    //
    // 8.1 seconds, sharing no common factor with 5.6, 6.4 or 7.3.
    channels: {
      hips: { y: swing([.3, 1.2, .6, -.6, -1.1, -.4, .6, 1], IDLE_TORSO_SWING), z: swing([1.4, 1.1, 1.5, 1.9, 1.6, 1.2, 1.4, 1.7], IDLE_TORSO_SWING) },
      spine: { x: swing([.4, -.1, .5, 1, .6, 0, .5, .8], IDLE_TORSO_SWING), y: swing([.8, .2, -.7, -1.2, -.5, .6, 1.2, 1.2], IDLE_TORSO_SWING), z: swing([-1.1, -1.4, -1, -.7, -1, -1.3, -1.1, -.8], IDLE_TORSO_SWING) },
      chest: { x: swing([-1.8, -2.5, -1.9, -1.2, -2, -2.6, -1.9, -1.3], IDLE_TORSO_SWING), z: swing([-.5, -.7, -.4, -.1, -.4, -.6, -.5, -.2], IDLE_TORSO_SWING) },
      head: { x: swing([-1.2, -1.9, -1.1, -.5, -1.3, -2, -1.2, -.6], IDLE_HEAD_SWING), y: swing([-.9, .4, 1.8, 1.2, -.6, -1.9, -1.5, -.4], IDLE_HEAD_SWING), z: swing([.4, .7, .4, 0, .3, .6, .5, .2], IDLE_HEAD_SWING) },
      leftShoulder: { x: swing([3.4, 4.6, 4.2, 5.2, 3.8, 1.9, .8, 1.6], IDLE_ARM_SWING), z: swing([-.8, -.3, -.4, .1, -.5, -1.4, -1.9, -1.5], IDLE_ARM_SWING) },
      rightShoulder: { x: swing([2, 3.2, 4.1, 3.9, 4.8, 3.7, 2.1, 1.2], IDLE_ARM_SWING), z: swing([.6, 1.1, 1.6, 1.5, 1.9, 1.3, .7, .2], IDLE_ARM_SWING) },
      leftElbow: { x: bias(swing([-10, -8.5, -5.5, -3.5, -4, -2, -4.5, -8], IDLE_ARM_SWING), IDLE_ELBOW_BEND) },
      rightElbow: { x: bias(swing([-6.2, -9, -10.6, -9.4, -7, -5.4, -5.8, -4.2], IDLE_ARM_SWING), IDLE_ELBOW_BEND) },
      leftHip: { x: [-.4, -.8, -.3, .4, .8, .5, .1, -.2] },
      rightHip: { x: [.4, .8, .3, -.3, -.7, -.4, 0, .3] },
      leftKnee: { x: [2.8, 3.5, 2.9, 2.2, 2.6, 3.3, 3, 2.4] },
      rightKnee: { x: [2.6, 3.2, 2.8, 2, 2.8, 3.4, 2.9, 2.2] },
    },
    root: {
      // Weight forward and slightly to the right of the other three stances,
      // so all four sit the pelvis somewhere different.
      x: [.014, .017, .019, .016, .011, .008, .009, .012],
      y: [.001, -.001, 0, .002, .003, .002, 0, -.001],
      z: [.006, .008, .007, .004, .003, .004, .005, .006],
    },
    grounded: 1,
  },
  {
    name: 'walk',
    duration: 1.06,
    loop: true,
    restPhase: .22,
    // The gait's phase relationships are the clip - pelvic rotation against
    // thorax counter-rotation, head yaw cancelling both, arm swing against the
    // opposite leg - and every one of them is already an authored lag measured
    // off the clinical description. Layering the generic chain offset on top
    // would shift them by a few percent for no gain and put the leg curves out
    // of step with the contact track, which is what keeps a planted foot
    // planted.
    chain: 'none',
    channels: {
      leftHip: { x: WALK_HIP },
      rightHip: { x: halfPhase(WALK_HIP) },
      leftKnee: { x: WALK_KNEE },
      rightKnee: { x: halfPhase(WALK_KNEE) },
      leftFoot: { x: WALK_ANKLE },
      rightFoot: { x: halfPhase(WALK_ANKLE) },
      leftShoulder: { x: WALK_SHOULDER },
      rightShoulder: { x: halfPhase(WALK_SHOULDER) },
      leftElbow: { x: WALK_ELBOW },
      rightElbow: { x: halfPhase(WALK_ELBOW) },
      // Pelvic transverse rotation and obliquity. The pelvis rotates the
      // swinging leg's side forward and drops on the unsupported side.
      hips: { y: [4, 2.5, 0, -2.5, -4, -2.5, 0, 2.5], z: [0, -4, -5, -3, 0, 4, 5, 3] },
      // Thorax counter-rotation against the pelvis. Arm swing without this
      // reads as a puppet whose arms are bolted to a rigid box: in a real walk
      // the shoulder girdle actively twists opposite the hips.
      spine: { x: [3, 3.4, 3, 2.6, 3, 3.4, 3, 2.6], y: [-7, -4.5, 0, 4.5, 7, 4.5, 0, -4.5], z: [0, 1.8, 2.2, 1.3, 0, -1.8, -2.2, -1.3] },
      chest: { y: [-2.4, -1.5, 0, 1.5, 2.4, 1.5, 0, -1.5] },
      // Gaze stabilization. People fixate their head while the body moves
      // underneath it, so the head cancels most of the accumulated torso yaw
      // rather than riding along with it.
      head: { x: [.8, .4, .9, 1.2, .8, .4, .9, 1.2], y: [2.6, 1.7, 0, -1.7, -2.6, -1.7, 0, 1.7], z: [0, -1.2, -1.5, -.9, 0, 1.2, 1.5, .9] },
    },
    root: {
      // Two rise-and-fall cycles per gait cycle, with the trough just after
      // each heel strike: that dip is the body absorbing the landing, and its
      // absence is why the old walk floated.
      y: [-.014, -.024, -.014, .008, .022, .018, .006, -.010, -.014, -.024, -.014, .008, .022, .018, .006, -.010],
      x: [0, -.021, -.030, -.021, 0, .021, .030, .021],
    },
    // Stance runs from heel strike to toe off, a little over 60% of the cycle
    // per foot, which is what gives a walk its two double-support windows. The
    // roll-off through pre-swing is where the heel lifts and the foot pivots
    // onto the toe, so the ankle stops being the thing pinned to the floor.
    contact: { left: WALK_CONTACT, right: halfPhase(WALK_CONTACT) },
    grounded: 1,
  },
  {
    name: 'seatedIdle',
    duration: 6.8,
    loop: true,
    restPhase: .3,
    channels: {
      hips: { y: [0, .5, .2, -.4, -.6, -.2, .3, .4] },
      spine: { x: [-1.4, -1.9, -1.3, -.8, -1.2, -1.8, -1.4, -.9], y: [-.8, -1.2, -.5, .6, 1.1, .7, 0, -.5] },
      chest: { x: [-.6, -1.3, -.7, -.1, -.8, -1.4, -.8, -.2] },
      head: { x: [.5, -.1, .6, 1.2, .5, -.2, .7, .9], y: [2.0, .9, -1.1, -2.2, -1.0, 1.2, 2.3, 2.4] },
      leftShoulder: { x: [-24, -25, -24, -23, -24, -25, -24, -23] },
      rightShoulder: { x: [-24, -25, -24, -23, -24, -25, -24, -23] },
      leftElbow: { x: [-49, -50, -49, -48, -49, -50, -49, -48] },
      rightElbow: { x: [-49, -50, -49, -48, -49, -50, -49, -48] },
      leftHip: { x: [-59, -59, -59, -59, -59, -59, -59, -59] },
      rightHip: { x: [-59, -59, -59, -59, -59, -59, -59, -59] },
      leftKnee: { x: [68, 68, 68, 68, 68, 68, 68, 68] },
      rightKnee: { x: [68, 68, 68, 68, 68, 68, 68, 68] },
      leftFoot: { x: [-7, -7, -7, -7, -7, -7, -7, -7] },
      rightFoot: { x: [-7, -7, -7, -7, -7, -7, -7, -7] },
    },
    // Seated, the hips drop to chair height. Expressed in hip-heights so a
    // taller character sits proportionally lower rather than sinking through
    // the seat or hovering above it.
    root: { y: [-.450, -.449, -.450, -.451, -.450, -.449, -.450, -.451] },
    grounded: 0,
  },
  {
    name: 'seatedType',
    duration: 2.4,
    loop: true,
    restPhase: .25,
    channels: {
      spine: { x: [-2.2, -2.6, -2.2, -1.9, -2.2, -2.6, -2.2, -1.9] },
      chest: { x: [-1.0, -1.3, -1.0, -.8, -1.0, -1.3, -1.0, -.8] },
      head: { x: [3.2, 3.6, 3.2, 2.9, 3.2, 3.6, 3.2, 2.9], y: [1.2, .4, -.9, -1.3, -.5, .7, 1.3, 1.4] },
      // Hands alternate rather than pistoning in unison. Perfectly symmetric
      // limb motion is one of the tells that reads as mechanical, and typing
      // is where it is most obvious.
      leftShoulder: { x: [-38, -40, -37, -39, -38, -40, -37, -39] },
      rightShoulder: { x: [-39, -37, -40, -38, -39, -37, -40, -38] },
      leftElbow: { x: [-66, -69, -64, -68, -66, -69, -64, -68] },
      rightElbow: { x: [-67, -64, -69, -65, -67, -64, -69, -65] },
      leftHand: { x: [4, 8, 2, 7, 4, 8, 2, 7] },
      rightHand: { x: [5, 2, 8, 3, 5, 2, 8, 3] },
      leftHip: { x: [-59, -59, -59, -59, -59, -59, -59, -59] },
      rightHip: { x: [-59, -59, -59, -59, -59, -59, -59, -59] },
      leftKnee: { x: [68, 68, 68, 68, 68, 68, 68, 68] },
      rightKnee: { x: [68, 68, 68, 68, 68, 68, 68, 68] },
      leftFoot: { x: [-7, -7, -7, -7, -7, -7, -7, -7] },
      rightFoot: { x: [-7, -7, -7, -7, -7, -7, -7, -7] },
    },
    root: { y: [-.450, -.450, -.450, -.450, -.450, -.450, -.450, -.450] },
    grounded: 0,
  },
  {
    name: 'sitDown',
    duration: 1.15,
    loop: false,
    restPhase: .85,
    // A real sit is a controlled fall: reach back with the hips, fold at the
    // knees and hips together, let the torso pitch forward to keep the centre
    // of mass over the feet, then settle upright once the seat takes the
    // weight. The old crossfade between a standing and a seated pose skipped
    // all of that and read as a body being teleported into a chair.
    channels: {
      spine: { x: [1.4, 6, 13, 16, 12, 5, -1.4], z: [0, 0, 0, 0, 0, 0, 0] },
      chest: { x: [-.8, 1, 3, 4, 2, -.2, -.6] },
      head: { x: [.5, 2, 4, 4, 2, .4, .5] },
      leftHip: { x: [-.6, -12, -34, -52, -58, -59, -59] },
      rightHip: { x: [.5, -12, -34, -52, -58, -59, -59] },
      leftKnee: { x: [3.5, 20, 46, 64, 69, 68, 68] },
      rightKnee: { x: [3.2, 20, 46, 64, 69, 68, 68] },
      leftFoot: { x: [0, -4, -9, -10, -8, -7, -7] },
      rightFoot: { x: [0, -4, -9, -10, -8, -7, -7] },
      leftShoulder: { x: [1.5, -4, -12, -19, -23, -24, -24] },
      rightShoulder: { x: [1.4, -4, -12, -19, -23, -24, -24] },
      leftElbow: { x: [-7, -16, -32, -44, -49, -49, -49] },
      rightElbow: { x: [-8, -16, -32, -44, -49, -49, -49] },
    },
    root: {
      y: [0, -.06, -.20, -.36, -.44, -.452, -.450],
      z: [0, -.02, -.05, -.07, -.06, -.04, -.03],
    },
    grounded: [1, 1, .9, .5, .1, 0, 0],
  },
  {
    name: 'standUp',
    duration: 1.2,
    loop: false,
    restPhase: .8,
    // Standing up is not sitting down played backwards: the torso pitches
    // forward first to bring the centre of mass over the feet, and only then
    // do the legs extend. Authoring it as its own clip is what keeps the
    // weight transfer believable in both directions.
    channels: {
      spine: { x: [-1.4, 6, 15, 17, 10, 3, 1.4] },
      chest: { x: [-.6, 1, 4, 4, 1.5, -.4, -.8] },
      head: { x: [.5, 3, 5, 3, 1, .4, .5] },
      leftHip: { x: [-59, -58, -50, -30, -12, -3, -.6] },
      rightHip: { x: [-59, -58, -50, -30, -12, -3, .5] },
      leftKnee: { x: [68, 69, 62, 40, 17, 6, 3.5] },
      rightKnee: { x: [68, 69, 62, 40, 17, 6, 3.2] },
      leftFoot: { x: [-7, -9, -11, -7, -2, 0, 0] },
      rightFoot: { x: [-7, -9, -11, -7, -2, 0, 0] },
      leftShoulder: { x: [-24, -22, -16, -8, -1, 1, 1.5] },
      rightShoulder: { x: [-24, -22, -16, -8, -1, 1, 1.4] },
      leftElbow: { x: [-49, -46, -36, -21, -10, -7, -7] },
      rightElbow: { x: [-49, -46, -36, -21, -10, -7, -8] },
    },
    root: {
      y: [-.450, -.448, -.40, -.24, -.08, -.01, 0],
      z: [-.03, -.05, -.07, -.05, -.02, 0, 0],
    },
    grounded: [0, 0, .2, .7, 1, 1, 1],
  },
  {
    name: 'confer',
    duration: 4.2,
    loop: true,
    restPhase: .3,
    // Talking with the hands. Gesture beats land on irregular intervals - a
    // person emphasising a point does not do it on a metronome - so the
    // control points here are deliberately unevenly shaped.
    channels: {
      hips: { y: [1.5, .6, -.8, -1.4, -.4, .9, 1.6, 1.2] },
      spine: { x: [1.0, 1.6, 1.2, .6, 1.4, 1.8, 1.1, .7], y: [-2.4, -1.0, 1.6, 3.0, 1.4, -1.2, -2.8, -2.0] },
      chest: { y: [-1.6, -.6, 1.0, 2.0, .9, -.8, -1.9, -1.3] },
      head: { x: [-.5, .8, 1.6, .4, -.8, .5, 1.4, .2], y: [-3.2, -1.4, 2.0, 4.0, 1.8, -1.6, -3.6, -2.6], z: [.8, -.4, -1.2, .3, 1.0, -.2, -1.0, .4] },
      leftShoulder: { x: [-6, -14, -22, -12, -5, -16, -26, -10], z: [3, 7, 12, 6, 2, 8, 14, 5] },
      rightShoulder: { x: [-8, -20, -12, -6, -18, -26, -14, -7], z: [-4, -10, -6, -2, -9, -15, -7, -3] },
      leftElbow: { x: [-28, -44, -58, -40, -25, -48, -64, -34] },
      rightElbow: { x: [-32, -56, -38, -26, -50, -66, -40, -28] },
      leftHand: { z: [4, 10, 16, 8, 3, 12, 18, 6] },
      rightHand: { z: [-5, -12, -7, -3, -11, -18, -8, -4] },
      leftHip: { x: [-.6, -1.2, -.4, .5, 1.0, .4, -.3, -.8] },
      rightHip: { x: [.5, 1.0, .3, -.4, -.9, -.4, .2, .7] },
      leftKnee: { x: [3.5, 4.4, 3.6, 2.8, 3.3, 4.2, 3.7, 3.0] },
      rightKnee: { x: [3.2, 4.0, 3.4, 2.6, 3.5, 4.3, 3.5, 2.8] },
    },
    root: { x: [.002, .006, .009, .004, -.003, -.007, -.010, -.005] },
    grounded: 1,
  },
  {
    name: 'reviewDocument',
    duration: 5.2,
    loop: true,
    restPhase: .3,
    // Reading something held at chest height: the eyes track down the page in
    // small steps, the head follows loosely, and the document drifts.
    channels: {
      hips: { y: [.4, .8, .3, -.4, -.7, -.3, .3, .6] },
      spine: { x: [3.0, 3.6, 3.1, 2.6, 3.2, 3.7, 3.0, 2.7] },
      chest: { x: [1.2, 1.7, 1.3, .8, 1.4, 1.8, 1.2, .9] },
      head: { x: [7.5, 9.0, 10.5, 8.0, 7.2, 9.4, 10.8, 8.4], y: [-1.6, -.4, 1.0, 1.6, .6, -.8, -1.8, -1.2] },
      leftShoulder: { x: [-34, -35, -34, -33, -34, -35, -34, -33], z: [6, 7, 6, 5, 6, 7, 6, 5] },
      rightShoulder: { x: [-34, -35, -34, -33, -34, -35, -34, -33], z: [-6, -7, -6, -5, -6, -7, -6, -5] },
      leftElbow: { x: [-62, -64, -62, -60, -62, -64, -62, -60] },
      rightElbow: { x: [-62, -64, -62, -60, -62, -64, -62, -60] },
      leftHip: { x: [-.6, -1.0, -.5, .3, .8, .4, 0, -.4] },
      rightHip: { x: [.5, .9, .4, -.3, -.7, -.4, 0, .4] },
      leftKnee: { x: [3.5, 4.2, 3.6, 2.8, 3.2, 4.0, 3.7, 3.0] },
      rightKnee: { x: [3.2, 3.8, 3.4, 2.6, 3.4, 4.1, 3.5, 2.8] },
    },
    root: { x: [.001, .004, .006, .003, -.002, -.005, -.006, -.003] },
    grounded: 1,
  },
  {
    name: 'presentBoard',
    duration: 4.8,
    loop: true,
    restPhase: .35,
    // Working at an evidence board: reach up, indicate, step back to consider.
    channels: {
      hips: { y: [3.0, 1.4, -1.0, -2.6, -1.2, 1.0, 2.8, 3.2] },
      spine: { x: [.6, 1.4, 2.0, 1.0, .4, 1.6, 2.2, 1.2], y: [-3.0, -1.4, 1.8, 3.4, 1.6, -1.4, -3.2, -2.4] },
      chest: { y: [-2.0, -1.0, 1.2, 2.2, 1.0, -1.0, -2.2, -1.6] },
      head: { x: [-4.0, -5.5, -3.0, -1.0, -4.5, -6.0, -3.5, -1.5], y: [-3.6, -1.6, 2.2, 4.4, 2.0, -1.8, -4.0, -2.8] },
      leftShoulder: { x: [-40, -62, -78, -58, -36, -66, -82, -50], z: [10, 18, 26, 16, 8, 20, 28, 14] },
      rightShoulder: { x: [-6, -12, -8, -4, -10, -16, -9, -5], z: [-3, -7, -4, -2, -6, -10, -5, -3] },
      leftElbow: { x: [-30, -22, -14, -26, -34, -20, -12, -28] },
      rightElbow: { x: [-22, -34, -26, -18, -30, -40, -28, -20] },
      leftHand: { z: [6, 12, 18, 10, 5, 14, 20, 8] },
      leftHip: { x: [-1.0, -1.8, -.6, .6, 1.4, .6, -.4, -1.2] },
      rightHip: { x: [.8, 1.5, .5, -.5, -1.2, -.5, .3, 1.0] },
      leftKnee: { x: [3.8, 5.0, 3.9, 2.9, 3.5, 4.6, 4.0, 3.1] },
      rightKnee: { x: [3.4, 4.4, 3.6, 2.7, 3.8, 4.8, 3.7, 2.9] },
    },
    root: { x: [.004, .010, .015, .008, -.004, -.011, -.016, -.008] },
    grounded: 1,
  },
  {
    name: 'celebrate',
    duration: 2.6,
    loop: false,
    // The apex, where the arms are at full extension and the body is off the
    // floor. Reduced motion holds this rather than the settled pose, because
    // a still frame of a victory has to read as a victory.
    restPhase: .44,
    // The victory beat, authored the way a fighting game's win screen is.
    //
    // Twenty-two control points over 2.6 seconds, allocated by how fast each
    // part of the performance goes rather than evenly - which is the only way
    // to shape an asymmetric ease out of a spline through uniformly spaced
    // points. Six of them cover the first second, because the load and the
    // launch are the fast part and want few, widely-spaced points; the
    // remaining sixteen cover the second and a half after it, because that is
    // where the body is settling and a settle is slow. Distributing them
    // evenly would give a symmetric ease in and out, which is the timing of a
    // machine.
    //
    // Read `CELEBRATE_POSE` as the beat itself: dip below zero (anticipation),
    // blow past one (overshoot), come back under it (the landing compression),
    // and ring down to one in a decaying bounce. Every joint in the upper body
    // shares that shape, so they accent together; `CHAIN_LAG` then staggers
    // their arrival so they do not *land* together.
    channels: {
      hips: {
        y: shaped(CELEBRATE_POSE, 0, -4),
        z: shaped(CELEBRATE_POSE, 0, 1.4),
      },
      spine: { x: shaped(CELEBRATE_POSE, 1.4, -9.5), y: shaped(CELEBRATE_POSE, 0, -2.5) },
      chest: { x: shaped(CELEBRATE_POSE, -.8, -7), y: shaped(CELEBRATE_POSE, 0, -1.6) },
      head: { x: shaped(CELEBRATE_POSE, .5, -15), y: shaped(CELEBRATE_POSE, 0, 3.5) },
      // Shoulders drive the height; the arms go out and up rather than
      // straight forward so the fists read to camera.
      //
      // The sign here is load-bearing and was wrong until it was measured: on
      // this rig the left arm hangs at negative X, so a *negative* shoulder Z
      // swings it outboard and up, and a positive one drags it inward across
      // the chest. Authored positive, the victory pose folded both arms over
      // the sternum instead of throwing them up - the fists ended up 0.4 units
      // on the wrong side of the body's centreline, at chest height.
      //
      // The two arms do not finish at the same angle. An exactly mirrored
      // victory pose is the one thing that still reads as a mannequin at the
      // moment the character is meant to be most alive, so the left goes a few
      // degrees higher and wider than the right.
      leftShoulder: { x: shaped(CELEBRATE_POSE, 1.5, -42), z: shaped(CELEBRATE_POSE, -2, -84) },
      rightShoulder: { x: shaped(CELEBRATE_POSE, 1.4, -36), z: shaped(CELEBRATE_POSE, 2, 74) },
      leftElbow: { x: shaped(CELEBRATE_POSE, -7, -24), z: shaped(CELEBRATE_POSE, 1, -60) },
      rightElbow: { x: shaped(CELEBRATE_POSE, -8, -20), z: shaped(CELEBRATE_POSE, -1, 52) },
      leftHand: { z: shaped(CELEBRATE_POSE, 0, -19) },
      rightHand: { z: shaped(CELEBRATE_POSE, 0, 16) },
      // The legs run their own shape, because they are not doing the same
      // thing as the arms: they load, extend through the launch past their
      // resting angle, hang under the body in the air, then absorb the landing
      // and settle. `CELEBRATE_LOAD` is that, and it is deliberately out of
      // step with the arms - the crouch is deepest while the arms have barely
      // begun, which is what makes the launch look driven by the legs.
      leftHip: { x: [-.6, -1.2, 6, 12, 14, 10, 2, -6.5, -9, -8.4, -6.6, -1.5, .8, -2.2, -4.6, -5.4, -4.9, -4.8, -5, -5, -5, -5] },
      rightHip: { x: [.5, -.2, 6.6, 12.6, 14.4, 10.4, 2.2, -6.2, -8.6, -8, -6.3, -1.2, 1, -2, -4.4, -5.1, -4.7, -4.6, -4.8, -4.8, -4.8, -4.8] },
      leftKnee: { x: [3.5, 5, 20, 32, 34.5, 26, 9, 1.6, .6, .9, 2.2, 9, 13, 9.5, 6.2, 5.2, 6.1, 6.3, 6, 6.05, 6, 6] },
      rightKnee: { x: [3.2, 4.7, 19.4, 31.2, 33.6, 25.3, 8.7, 1.5, .6, .9, 2.1, 8.6, 12.5, 9.2, 6, 5, 5.9, 6.1, 5.8, 5.85, 5.8, 5.8] },
      leftFoot: { x: [0, -.5, -5, -9, -10.5, -7, 0, 8, 12, 13, 11, 5, -2, 1.5, 2.6, 2, 2.2, 2.1, 2, 2, 2, 2] },
      rightFoot: { x: [0, -.4, -4.8, -8.7, -10.2, -6.8, 0, 7.8, 11.7, 12.7, 10.7, 4.8, -1.9, 1.5, 2.5, 1.9, 2.1, 2, 1.9, 1.9, 1.9, 1.9] },
    },
    root: {
      // The body genuinely leaves the floor. A victory that keeps both soles
      // planted is a shrug with the arms up; the hop is most of why this reads
      // as a whole body being thrown rather than a torso being posed.
      y: [0, -.004, -.030, -.052, -.058, -.040, .010, .056, .080, .086, .070, .040, .028, .046, .058, .052, .048, .051, .050, .0495, .050, .050],
      z: [0, -.002, -.010, -.018, -.020, -.014, .002, .010, .014, .015, .012, .006, .003, .006, .008, .007, .0065, .007, .007, .007, .007, .007],
    },
    // Foot planting has to let go for the airborne frames, or the solver spends
    // them dragging the pelvis back down to keep two pinned feet on the floor -
    // which cancels the hop exactly and leaves a body that crouches, strains
    // and never rises. This is the same mechanism the swim clips use, and the
    // ramp back in over the two points before touchdown is what stops the
    // landing arriving as a step change in who owns the legs.
    grounded: [1, 1, 1, 1, 1, 1, .85, .35, 0, 0, 0, .15, .55, .9, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  {
    name: 'nod',
    duration: .92,
    loop: false,
    restPhase: .33,
    blend: 'additive',
    chain: 'head',
    // The smallest beat with the full shape in it, and a useful thing to read
    // first because everything larger below is built the same way.
    //
    // Fourteen points over 0.92s, so each is 66ms - about four display frames,
    // which is the resolution a beat this quick needs. The chin lifts two
    // points before it drops (anticipation), the drop takes three and
    // overshoots to 14.4 degrees, the head comes back up to 10.6 and bobs once
    // more to 11.8, and the last six points - nearly half the clip - are the
    // settle. Out fast, back slow.
    channels: {
      head: { x: [0, -1.6, -3.2, 6, 13.6, 14.4, 10.6, 11.8, 8.6, 5.6, 3.2, 1.6, .7, 0] },
      chest: { x: [0, -.3, -.6, 1.1, 2.4, 2.6, 1.9, 2.1, 1.5, 1, .6, .3, .12, 0] },
      spine: { x: [0, -.2, -.35, .6, 1.4, 1.5, 1.1, 1.2, .9, .6, .35, .18, .06, 0] },
    },
  },
  {
    name: 'glance',
    duration: 1.6,
    loop: false,
    restPhase: .33,
    blend: 'additive',
    chain: 'head',
    // A look-over-there beat: the eyes lead, the head follows, the shoulders
    // come around last and only partway, then everything returns. The head
    // starts by turning very slightly the wrong way, which is what the neck
    // does to unload before it turns, and arrives 4 degrees past where it
    // settles.
    channels: {
      head: {
        y: [0, -2.5, 10, 22, 28.5, 26, 24.5, 25, 22, 16, 10, 5.5, 2, 0],
        x: [0, .4, -.8, -2, -2.8, -2.4, -2.2, -2.3, -2, -1.5, -1, -.5, -.2, 0],
        // A head that turns without tilting is a turret. The tilt into the
        // look is small and it is most of what makes the beat read as a person.
        z: [0, -.3, .8, 2, 2.8, 2.4, 2.2, 2.3, 2, 1.4, .9, .5, .2, 0],
      },
      chest: { y: [0, -.8, 1.2, 3.6, 6.2, 7.4, 7.8, 7.6, 6.6, 4.8, 3, 1.6, .6, 0] },
      spine: { y: [0, -.5, .5, 1.8, 3.4, 4.4, 4.8, 4.7, 4.1, 3, 1.9, 1, .4, 0] },
      leftShoulder: { x: [0, .4, -.5, -1.6, -2.8, -3.6, -4, -3.9, -3.4, -2.5, -1.6, -.8, -.3, 0] },
      rightShoulder: { x: [0, -.3, .4, 1.2, 2.1, 2.8, 3.1, 3, 2.6, 1.9, 1.2, .6, .2, 0] },
    },
  },

  // -------------------------------------------------------------------------
  // The layered idle repertoire.
  //
  // These are the beats that replaced the single repeated wave. Every one is
  // additive, so it plays *over* whatever the body is already doing rather
  // than interrupting it, and every one is small: none of them is a
  // performance, they are the things a person does while standing still and
  // not thinking about it. The director fires them on irregular intervals at
  // randomised amplitude and playback rate, and mirrors the asymmetric ones,
  // so the same beat never lands twice the same way.
  // -------------------------------------------------------------------------
  {
    name: 'breathDeep',
    duration: 2.6,
    loop: false,
    restPhase: .38,
    blend: 'additive',
    // One deeper breath than the idle's own rhythm. The ribcage leads, the
    // shoulders follow it up and settle after it, and the chin lifts a couple
    // of degrees on the inhale.
    //
    // A breath is the clearest case in the library for an asymmetric ease, and
    // it is asymmetric the way lungs are: the inhale takes four of the
    // thirteen intervals and the exhale takes nine, because you draw breath
    // with a muscle and let it out by relaxing one. The single point of
    // positive value at the start is the small exhale that precedes a deep
    // breath - anticipation, and the reason the inhale reads as intentional.
    channels: {
      chest: { x: [0, .35, -.6, -2.2, -3.5, -3.9, -3.5, -3, -2.4, -1.8, -1.2, -.7, -.3, 0] },
      spine: { x: [0, .16, -.28, -1, -1.6, -1.8, -1.6, -1.4, -1.1, -.8, -.55, -.32, -.14, 0] },
      head: { x: [0, .1, -.25, -.9, -1.5, -1.7, -1.5, -1.3, -1, -.75, -.5, -.3, -.12, 0] },
      leftShoulder: {
        z: [0, .3, -.6, -1.9, -2.9, -3.3, -3, -2.6, -2.1, -1.5, -1, -.6, -.25, 0],
        x: [0, -.2, .4, 1.2, 1.8, 2, 1.8, 1.5, 1.2, .9, .6, .35, .15, 0],
      },
      rightShoulder: {
        z: [0, -.3, .6, 1.9, 2.9, 3.3, 3, 2.6, 2.1, 1.5, 1, .6, .25, 0],
        x: [0, -.2, .4, 1.2, 1.8, 2, 1.8, 1.5, 1.2, .9, .6, .35, .15, 0],
      },
    },
    root: { y: [0, -.001, .002, .006, .01, .011, .01, .008, .006, .004, .003, .0015, .0006, 0] },
  },
  {
    name: 'weightSettle',
    duration: 3.1,
    loop: false,
    restPhase: .42,
    blend: 'additive',
    // A weight transfer onto the right leg and back. The pelvis drops on the
    // unsupported side, the lumbar spine bends the other way to keep the head
    // over the feet, and the loaded knee straightens while the free one
    // softens. Standing still and *staying* still are different things, and
    // this is most of the difference.
    //
    // The first interval goes the other way. To take weight off a foot you
    // first have to push down through it, so the pelvis swings a fraction
    // toward the leg it is about to leave - the anticipation is not a stylistic
    // flourish here, it is the mechanics of the move.
    channels: {
      hips: {
        z: [0, .5, -1.2, -2.8, -3.5, -3.3, -3.4, -3.2, -2.9, -2.3, -1.6, -1, -.45, 0],
        y: [0, -.2, .5, 1.1, 1.35, 1.3, 1.32, 1.25, 1.1, .9, .65, .4, .18, 0],
      },
      spine: {
        z: [0, -.4, 1, 2.3, 2.9, 2.8, 2.85, 2.7, 2.4, 1.9, 1.35, .85, .38, 0],
        x: [0, -.1, .25, .58, .74, .71, .72, .68, .6, .48, .34, .21, .1, 0],
      },
      chest: { z: [0, -.22, .55, 1.25, 1.6, 1.55, 1.57, 1.5, 1.32, 1.05, .74, .46, .2, 0] },
      // The head counter-tilts and stays over the feet: a body shifting its
      // weight keeps its eyes level, and a head that rides the lean instead is
      // the difference between a person and a leaning post.
      head: {
        z: [0, .22, -.55, -1.25, -1.6, -1.55, -1.57, -1.5, -1.32, -1.05, -.74, -.46, -.2, 0],
        y: [0, -.3, .7, 1.6, 2.1, 2, 2.05, 1.95, 1.7, 1.35, .95, .6, .26, 0],
      },
      leftHip: { x: [0, -.2, .5, 1.15, 1.45, 1.4, 1.42, 1.35, 1.2, .95, .67, .42, .18, 0] },
      rightHip: { x: [0, .3, -.7, -1.6, -2.05, -1.98, -2, -1.9, -1.68, -1.33, -.94, -.58, -.26, 0] },
      leftKnee: { x: [0, .2, -.5, -1.15, -1.45, -1.4, -1.42, -1.35, -1.2, -.95, -.67, -.42, -.18, 0] },
      rightKnee: { x: [0, -.6, 1.5, 3.4, 4.3, 4.15, 4.2, 4, 3.5, 2.8, 1.97, 1.23, .54, 0] },
      leftShoulder: { z: [0, -.25, .6, 1.35, 1.7, 1.65, 1.67, 1.6, 1.4, 1.12, .79, .49, .21, 0] },
      rightShoulder: { z: [0, -.2, .5, 1.15, 1.45, 1.4, 1.42, 1.35, 1.2, .95, .67, .42, .18, 0] },
    },
    // The centre of mass, moving. Joint angles alone cannot express a weight
    // shift - they can only lean the stack of segments - so the pelvis itself
    // travels laterally over the foot taking the load.
    root: { x: [0, -.002, .005, .012, .0155, .015, .0152, .0145, .0128, .0102, .0072, .0045, .002, 0] },
  },
  {
    name: 'cuffAdjust',
    duration: 2.4,
    loop: false,
    restPhase: .4,
    blend: 'additive',
    // The right hand crosses to square the left sleeve, and the head drops to
    // watch it. Ported from a beat the old procedural driver already had, so
    // the character's vocabulary is the one the art was designed around.
    //
    // The arm swings back a little before it crosses - you cannot reach for
    // something without first unweighting the limb - overshoots the cuff, and
    // then works at it: the small reversal at index 7 is the second tug, which
    // is what turns a reach into an adjustment.
    channels: {
      rightShoulder: {
        x: [0, 2.2, -6, -17, -25, -26.5, -23, -24.5, -21, -15, -9.5, -5, -1.8, 0],
        z: [0, 1.2, -3, -9, -13, -13.8, -12, -12.8, -11, -8, -5, -2.6, -.9, 0],
      },
      rightElbow: { x: [0, 6, -16, -44, -62, -65, -56, -60, -51, -37, -23, -12, -4.2, 0] },
      rightHand: { z: [0, .8, -2, -6, -9.5, -10.5, -9, -9.8, -8.4, -6, -3.8, -2, -.7, 0] },
      leftShoulder: { x: [0, .5, -1.4, -3.8, -5.6, -6, -5.2, -5.6, -4.8, -3.4, -2.1, -1.1, -.4, 0] },
      leftElbow: { x: [0, 1.4, -3.8, -10.5, -15.5, -16.8, -14.5, -15.6, -13.3, -9.5, -5.9, -3.1, -1.1, 0] },
      head: {
        x: [0, -.6, 1.2, 2.9, 4.1, 4.4, 3.9, 4.2, 3.6, 2.6, 1.6, .85, .3, 0],
        y: [0, .9, -1.7, -4.1, -5.7, -6.1, -5.4, -5.8, -5, -3.6, -2.2, -1.15, -.4, 0],
      },
      spine: {
        x: [0, -.2, .45, 1.1, 1.55, 1.65, 1.45, 1.55, 1.34, .96, .6, .3, .1, 0],
        y: [0, .3, -.6, -1.5, -2.1, -2.25, -1.98, -2.12, -1.82, -1.3, -.8, -.42, -.15, 0],
      },
      chest: { y: [0, .22, -.45, -1.1, -1.55, -1.65, -1.45, -1.56, -1.34, -.96, -.6, -.31, -.11, 0] },
    },
  },
  {
    name: 'postureReset',
    duration: 2.9,
    loop: false,
    restPhase: .32,
    blend: 'additive',
    // Shoulders roll back, the sternum lifts, the chin tucks: the small
    // correction a person makes after noticing they have been slouching. The
    // slouch deepens for one point first, which is the noticing.
    channels: {
      leftShoulder: {
        x: [0, -1.6, 2.4, 5.8, 7.4, 6.8, 5.6, 4.6, 3.6, 2.7, 1.9, 1.2, .5, 0],
        z: [0, .6, -1, -2.4, -3, -2.7, -2.2, -1.8, -1.4, -1, -.7, -.42, -.18, 0],
      },
      rightShoulder: {
        x: [0, -1.6, 2.4, 5.8, 7.4, 6.8, 5.6, 4.6, 3.6, 2.7, 1.9, 1.2, .5, 0],
        z: [0, -.6, 1, 2.4, 3, 2.7, 2.2, 1.8, 1.4, 1, .7, .42, .18, 0],
      },
      chest: { x: [0, .8, -1.2, -2.8, -3.6, -3.3, -2.7, -2.2, -1.7, -1.3, -.9, -.55, -.24, 0] },
      spine: { x: [0, .5, -.75, -1.75, -2.25, -2.05, -1.7, -1.4, -1.1, -.8, -.56, -.34, -.15, 0] },
      head: { x: [0, -.6, .9, 2.1, 2.7, 2.45, 2, 1.65, 1.3, .95, .66, .4, .17, 0] },
      leftElbow: { x: [0, -1, 1.6, 3.8, 4.9, 4.5, 3.7, 3, 2.35, 1.75, 1.2, .74, .32, 0] },
      rightElbow: { x: [0, -1, 1.6, 3.8, 4.9, 4.5, 3.7, 3, 2.35, 1.75, 1.2, .74, .32, 0] },
    },
    root: { y: [0, -.001, .002, .006, .0085, .0078, .0064, .0052, .004, .003, .002, .0012, .0005, 0] },
  },
  {
    name: 'considerTilt',
    duration: 3.2,
    loop: false,
    restPhase: .38,
    blend: 'additive',
    chain: 'head',
    // Weighing something up: the head tilts and turns away from whatever it
    // was looking at, one shoulder lifts a little, the near forearm comes up.
    // The hold in the middle - indices 5 through 8, nearly a second at the
    // same angle with only a breath of drift on it - is the thinking. A beat
    // that turns straight around and comes back has not considered anything.
    channels: {
      head: {
        z: [0, -.8, 2.2, 5.4, 7.4, 7.8, 7.2, 7.4, 6.8, 5.4, 3.8, 2.3, 1, 0],
        y: [0, .9, -2.4, -5.8, -7.6, -8, -7.4, -7.6, -7, -5.6, -3.9, -2.4, -1, 0],
        x: [0, .3, -.9, -2.1, -2.9, -3.05, -2.8, -2.9, -2.65, -2.1, -1.5, -.9, -.4, 0],
      },
      chest: { z: [0, -.25, .7, 1.6, 2.2, 2.3, 2.1, 2.2, 2, 1.6, 1.1, .68, .3, 0] },
      spine: { y: [0, .28, -.75, -1.75, -2.4, -2.5, -2.3, -2.4, -2.2, -1.75, -1.22, -.75, -.33, 0] },
      leftShoulder: { z: [0, .3, -.9, -2.1, -2.9, -3.05, -2.8, -2.9, -2.65, -2.1, -1.5, -.9, -.4, 0] },
      rightElbow: { x: [0, 1.8, -4.8, -12, -16.6, -17.4, -16, -16.6, -15.2, -12, -8.4, -5.2, -2.2, 0] },
      rightShoulder: { x: [0, .7, -1.9, -4.6, -6.4, -6.7, -6.2, -6.4, -5.85, -4.6, -3.2, -2, -.85, 0] },
    },
  },
  {
    name: 'handFlex',
    duration: 1.7,
    loop: false,
    restPhase: .34,
    blend: 'additive',
    // The smallest beat in the set: a wrist flex and a half-shrug. It exists
    // because the director needs something cheap to fire often - a repertoire
    // whose every entry is noticeable is its own kind of loop.
    channels: {
      leftHand: { z: [0, -1.2, 5.5, 9.8, 7.6, 8.4, 5.4, 2.8, 1, 0] },
      rightHand: { z: [0, .9, -4.2, -7.5, -5.8, -6.4, -4.1, -2.1, -.75, 0] },
      leftElbow: { x: [0, 1.2, -4.8, -9.6, -7.4, -8.2, -5.3, -2.7, -1, 0] },
      rightElbow: { x: [0, .9, -3.6, -7.4, -5.7, -6.3, -4.1, -2.1, -.75, 0] },
      leftShoulder: { z: [0, .3, -1.1, -2.3, -1.8, -2, -1.3, -.65, -.24, 0] },
      rightShoulder: { z: [0, -.3, 1.1, 2.3, 1.8, 2, 1.3, .65, .24, 0] },
    },
  },
  {
    name: 'acknowledge',
    duration: 1.8,
    loop: false,
    restPhase: .35,
    blend: 'additive',
    chain: 'head',
    // The greeting that replaced the wave.
    //
    // A wave is a hand held up and oscillated, and there is no version of it
    // that does not read as a cartoon character being cheerful at you. What a
    // person actually does on being noticed across a room is much smaller: a
    // dip of the head that the torso follows, the near hand turning slightly
    // open and outward, and everything unwinding within a second and a half.
    // The head leads down and comes back up before the torso does, which is
    // the overlap that stops it reading as one rigid hinge - `chain: 'head'`
    // is what enforces that ordering now, rather than three curves hand-fitted
    // to approximate it.
    //
    // The chin lifts for one interval before it drops, the dip passes its
    // resting depth and comes back, and the last third is a slow unwind.
    channels: {
      head: { x: [0, -2.4, 5, 10.6, 11.8, 9, 10, 7.4, 5, 3.2, 1.9, 1, .4, 0] },
      chest: { x: [0, -.5, 1, 2.6, 3.4, 3, 3.2, 2.6, 1.9, 1.3, .8, .45, .18, 0] },
      spine: { x: [0, -1, 2, 5.2, 7, 6.4, 6.7, 5.5, 4, 2.7, 1.7, .95, .4, 0] },
      rightShoulder: {
        x: [0, 1.8, -3.6, -9.6, -13.4, -12.4, -13, -10.8, -7.8, -5.2, -3.2, -1.8, -.75, 0],
        z: [0, -.9, 1.8, 4.6, 6.4, 5.9, 6.2, 5.1, 3.7, 2.5, 1.55, .85, .35, 0],
      },
      rightElbow: { x: [0, 4, -8, -21, -29, -27, -28, -23, -16.5, -11, -6.8, -3.8, -1.6, 0] },
      rightHand: { z: [0, -1.3, 2.6, 6.6, 9.2, 8.5, 8.9, 7.4, 5.3, 3.6, 2.2, 1.2, .5, 0] },
      leftShoulder: { x: [0, .6, -1.2, -3.2, -4.4, -4.1, -4.3, -3.5, -2.6, -1.7, -1.05, -.6, -.25, 0] },
      leftElbow: { x: [0, 1.3, -2.6, -6.8, -9.4, -8.7, -9.1, -7.6, -5.4, -3.6, -2.25, -1.25, -.5, 0] },
    },
    root: { z: [0, .002, -.003, -.008, -.011, -.010, -.0105, -.0088, -.0063, -.0042, -.0026, -.0014, -.0006, 0] },
  },

  {
    name: 'checkWatch',
    duration: 2.9,
    loop: false,
    restPhase: .38,
    blend: 'additive',
    // The left forearm rolls up across the body and the head drops to read a
    // wristwatch, then everything unwinds. Asymmetric, so it is mirrored below
    // to a right-handed version and reads differently each time it fires. The
    // small reversal at index 7 is the second look, after the first one failed
    // to register.
    channels: {
      leftShoulder: {
        x: [0, 2.2, -6.5, -18, -25.6, -27, -24, -25.5, -22, -15.5, -9.6, -5, -1.8, 0],
        z: [0, -.8, 2.2, 6.2, 8.8, 9.3, 8.2, 8.8, 7.6, 5.4, 3.3, 1.7, .6, 0],
      },
      leftElbow: { x: [0, 6, -18, -50, -70, -74, -66, -70, -60, -42, -26, -13.5, -4.8, 0] },
      leftHand: { z: [0, .5, -1.5, -4.2, -5.9, -6.2, -5.5, -5.9, -5.1, -3.6, -2.2, -1.15, -.4, 0] },
      head: {
        x: [0, -.8, 1.6, 4, 5.5, 5.8, 5.2, 5.5, 4.7, 3.3, 2.05, 1.07, .38, 0],
        y: [0, .55, -1.1, -2.7, -3.7, -3.9, -3.5, -3.7, -3.2, -2.25, -1.4, -.72, -.26, 0],
      },
      chest: {
        x: [0, -.25, .5, 1.15, 1.6, 1.68, 1.5, 1.6, 1.37, .97, .6, .31, .11, 0],
        y: [0, .28, -.55, -1.3, -1.8, -1.9, -1.7, -1.8, -1.55, -1.1, -.68, -.35, -.13, 0],
      },
      spine: { y: [0, .2, -.4, -1, -1.38, -1.45, -1.3, -1.38, -1.19, -.84, -.52, -.27, -.1, 0] },
    },
  },
  {
    name: 'stretch',
    duration: 3.6,
    loop: false,
    restPhase: .32,
    blend: 'additive',
    // A brief settling stretch: the shoulders draw back and up, the sternum
    // lifts and the chin rises, then it all eases down. Larger and slower than
    // `postureReset`, and the one beat that visibly resets a body that has been
    // still for a while. Four intervals up and nine down, because a stretch is
    // taken deliberately and released by letting go of it.
    channels: {
      leftShoulder: {
        x: [0, -2, 4.5, 10.5, 13.8, 14.2, 12.6, 10.4, 8.2, 6.2, 4.4, 2.8, 1.2, 0],
        z: [0, 1, -2.3, -5.3, -7, -7.2, -6.4, -5.3, -4.2, -3.1, -2.2, -1.4, -.6, 0],
      },
      rightShoulder: {
        x: [0, -2, 4.5, 10.5, 13.8, 14.2, 12.6, 10.4, 8.2, 6.2, 4.4, 2.8, 1.2, 0],
        z: [0, -1, 2.3, 5.3, 7, 7.2, 6.4, 5.3, 4.2, 3.1, 2.2, 1.4, .6, 0],
      },
      leftElbow: { x: [0, -1.4, 3.1, 7.3, 9.6, 9.9, 8.8, 7.2, 5.7, 4.3, 3.05, 1.95, .84, 0] },
      rightElbow: { x: [0, -1.4, 3.1, 7.3, 9.6, 9.9, 8.8, 7.2, 5.7, 4.3, 3.05, 1.95, .84, 0] },
      chest: { x: [0, .9, -2, -4.7, -6.2, -6.4, -5.7, -4.7, -3.7, -2.8, -1.97, -1.26, -.54, 0] },
      spine: { x: [0, .5, -1.1, -2.6, -3.4, -3.5, -3.1, -2.6, -2.05, -1.53, -1.08, -.69, -.3, 0] },
      head: { x: [0, .7, -1.6, -3.7, -4.9, -5.05, -4.5, -3.7, -2.9, -2.2, -1.55, -1, -.43, 0] },
    },
    root: { y: [0, -.0012, .0028, .0065, .0086, .0089, .0079, .0065, .0051, .0038, .0027, .0017, .0007, 0] },
  },
  {
    name: 'rollShoulders',
    duration: 2.7,
    loop: false,
    restPhase: .3,
    blend: 'additive',
    // A shoulder roll: the shoulders lift and draw back, then settle. Cheap and
    // small, so the director can fire it often without it reading as a set
    // piece. Two rolls rather than one, the second smaller than the first,
    // because that is what a shoulder roll is - and the two are not the same
    // size, which is what stops it reading as an oscillator.
    channels: {
      leftShoulder: {
        z: [0, .5, -1.2, -2.6, -3.2, -2, -2.6, -3.4, -2.8, -1.9, -1.2, -.7, -.3, 0],
        x: [0, -1, 2.2, 4.6, 5.4, 3, 1, -1.4, -2.2, -1.7, -1.1, -.6, -.25, 0],
      },
      rightShoulder: {
        z: [0, -.5, 1.2, 2.6, 3.2, 2, 2.6, 3.4, 2.8, 1.9, 1.2, .7, .3, 0],
        x: [0, -1, 2.2, 4.6, 5.4, 3, 1, -1.4, -2.2, -1.7, -1.1, -.6, -.25, 0],
      },
      chest: { x: [0, .4, -.9, -1.9, -2.2, -1.1, -1.6, -2.1, -1.7, -1.15, -.72, -.42, -.18, 0] },
      head: { x: [0, .25, -.55, -1.15, -1.35, -.7, -1, -1.3, -1.05, -.7, -.44, -.26, -.11, 0] },
    },
  },
  {
    name: 'scanRoom',
    duration: 3.7,
    loop: false,
    restPhase: .3,
    blend: 'additive',
    chain: 'head',
    // A longer look around than `glance`: the gaze sweeps to one side, pauses,
    // then comes back through centre and part-way the other way before
    // returning. Head, chest and spine only, with nothing that moves an arm,
    // so it is safe for a seated character whose hands are occupied on a
    // keyboard or a folder.
    //
    // The two ends of the sweep are deliberately different sizes and are held
    // for different lengths. A symmetric sweep is a scan on rails; a real one
    // looks harder in one direction than the other.
    channels: {
      head: {
        y: [0, -3, 8, 18, 23.5, 22, 20, 12, 0, -9, -14, -12.5, -8, -4, -1.4, 0],
        x: [0, .4, -.8, -1.9, -2.6, -2.4, -2.2, -1.6, -1, -1.3, -1.6, -1.4, -.9, -.45, -.15, 0],
        z: [0, -.3, .8, 1.8, 2.4, 2.2, 2, 1.1, 0, -1, -1.7, -1.5, -.95, -.48, -.16, 0],
      },
      chest: { y: [0, -.9, 2.2, 4.8, 6.3, 5.9, 5.4, 3.2, 0, -2.5, -3.9, -3.5, -2.2, -1.1, -.38, 0] },
      spine: { y: [0, -.5, 1.2, 2.6, 3.5, 3.3, 3, 1.8, 0, -1.35, -2.1, -1.9, -1.2, -.6, -.2, 0] },
    },
  },
  {
    name: 'courtBow',
    duration: 2.3,
    loop: false,
    restPhase: .4,
    blend: 'additive',
    // The formal version of `acknowledge`: deeper, slower, and held for a beat
    // at the bottom. The hands stay at the sides, which is what makes it read
    // as courtroom courtesy rather than a stage bow. The rise overshoots
    // upright by a degree before settling, which is the body's momentum
    // arriving after the intent has stopped.
    channels: {
      spine: { x: [0, -2.2, 5, 13, 19, 21, 20.5, 18, 13, 8, 4, 1.2, -.6, 0] },
      chest: { x: [0, -1.2, 2.6, 6.8, 10, 11.2, 10.9, 9.6, 6.9, 4.2, 2.1, .6, -.3, 0] },
      head: { x: [0, -2.6, 3.4, 8.4, 12, 13.4, 13, 11.4, 8.2, 5, 2.5, .7, -.35, 0] },
      leftShoulder: {
        x: [0, 1.2, -2.8, -7, -10, -11.2, -10.9, -9.6, -6.9, -4.2, -2.1, -.6, .3, 0],
        z: [0, -.3, .7, 1.7, 2.4, 2.7, 2.6, 2.3, 1.65, 1, .5, .15, -.07, 0],
      },
      rightShoulder: {
        x: [0, 1.2, -2.8, -7, -10, -11.2, -10.9, -9.6, -6.9, -4.2, -2.1, -.6, .3, 0],
        z: [0, .3, -.7, -1.7, -2.4, -2.7, -2.6, -2.3, -1.65, -1, -.5, -.15, .07, 0],
      },
      leftElbow: { x: [0, .8, -1.8, -4.5, -6.4, -7.2, -7, -6.1, -4.4, -2.7, -1.35, -.4, .2, 0] },
      rightElbow: { x: [0, .8, -1.8, -4.5, -6.4, -7.2, -7, -6.1, -4.4, -2.7, -1.35, -.4, .2, 0] },
      leftHip: { x: [0, -.6, 1.4, 3.5, 5, 5.6, 5.45, 4.8, 3.45, 2.1, 1.05, .3, -.15, 0] },
      rightHip: { x: [0, -.6, 1.4, 3.5, 5, 5.6, 5.45, 4.8, 3.45, 2.1, 1.05, .3, -.15, 0] },
      leftKnee: { x: [0, -.3, .7, 1.75, 2.5, 2.8, 2.72, 2.4, 1.72, 1.05, .52, .15, -.07, 0] },
      rightKnee: { x: [0, -.3, .7, 1.75, 2.5, 2.8, 2.72, 2.4, 1.72, 1.05, .52, .15, -.07, 0] },
    },
    root: { z: [0, .002, -.004, -.010, -.0145, -.016, -.0156, -.0137, -.0099, -.006, -.003, -.0009, .0004, 0] },
  },

  // -------------------------------------------------------------------------
  // Four beats added for the close-up surfaces.
  //
  // The portrait crop starts at the collarbone, which means half the existing
  // repertoire - anything whose payload is in a forearm - contributes nothing
  // there at all. These four put their motion where that camera can see it,
  // and each is built around a different one of the principles so the set does
  // not converge on a single rhythm.
  // -------------------------------------------------------------------------
  {
    name: 'resolve',
    duration: 2.2,
    loop: false,
    restPhase: .31,
    blend: 'additive',
    // Gathering yourself: the chin drops for a moment, then the sternum lifts,
    // the shoulders set back and the head comes up past level before settling.
    // Torso-led, so the chest starts it and the head arrives after - the
    // opposite ordering to `nod`, and the difference between deciding
    // something and agreeing with someone.
    channels: {
      chest: { x: [0, 1, -1.6, -3.6, -4.6, -4.2, -3.6, -3, -2.4, -1.8, -1.25, -.75, -.32, 0] },
      spine: { x: [0, .6, -1, -2.2, -2.8, -2.55, -2.2, -1.83, -1.46, -1.1, -.76, -.46, -.2, 0] },
      head: {
        x: [0, 1.4, -1.8, -4.4, -5.6, -5.1, -4.4, -3.65, -2.9, -2.2, -1.5, -.9, -.4, 0],
        y: [0, .3, -.6, -1.4, -1.8, -1.6, -1.4, -1.15, -.9, -.7, -.48, -.29, -.12, 0],
      },
      leftShoulder: {
        x: [0, -1.4, 2.2, 5.2, 6.6, 6, 5.2, 4.3, 3.4, 2.6, 1.8, 1.1, .47, 0],
        z: [0, .7, -1.1, -2.6, -3.3, -3, -2.6, -2.15, -1.7, -1.3, -.9, -.54, -.23, 0],
      },
      rightShoulder: {
        x: [0, -1.4, 2.2, 5.2, 6.6, 6, 5.2, 4.3, 3.4, 2.6, 1.8, 1.1, .47, 0],
        z: [0, -.7, 1.1, 2.6, 3.3, 3, 2.6, 2.15, 1.7, 1.3, .9, .54, .23, 0],
      },
      leftElbow: { x: [0, -.9, 1.5, 3.4, 4.4, 4, 3.4, 2.85, 2.26, 1.7, 1.2, .72, .31, 0] },
      rightElbow: { x: [0, -.9, 1.5, 3.4, 4.4, 4, 3.4, 2.85, 2.26, 1.7, 1.2, .72, .31, 0] },
    },
    root: { y: [0, -.0012, .0019, .0045, .0057, .0052, .0045, .0037, .003, .0022, .0015, .0009, .0004, 0] },
  },
  {
    name: 'doubleTake',
    duration: 1.45,
    loop: false,
    restPhase: .47,
    blend: 'additive',
    chain: 'head',
    // The fastest beat in the library, and the one that most needs its
    // anticipation: the head draws back and away over five intervals, then
    // comes round the other way in three. That ratio is the whole read. The
    // recoil is slower than the snap, so the snap has somewhere to come from.
    //
    // Sixteen points over 1.45s is 97ms each, and the fastest interval moves
    // 6 degrees, so peak head speed is about 60 degrees a second - fast enough
    // to register as a reaction and slow enough that the bake rate has no
    // trouble resolving it.
    channels: {
      head: {
        x: [0, -1.2, -3.4, -4, -2.6, .8, 3.4, 4.6, 3.8, 4.2, 3.2, 2.2, 1.4, .8, .3, 0],
        y: [0, 2.2, 5.6, 6.4, 4.2, -1.6, -7.6, -10.4, -9, -9.8, -7.6, -5.2, -3.3, -1.9, -.8, 0],
        z: [0, -.6, -1.6, -1.9, -1.2, .5, 2.2, 3, 2.6, 2.8, 2.2, 1.5, .95, .55, .22, 0],
      },
      chest: { y: [0, .7, 1.8, 2.1, 1.35, -.5, -2.4, -3.3, -2.85, -3.1, -2.4, -1.65, -1.05, -.6, -.25, 0] },
      spine: { y: [0, .4, 1, 1.15, .75, -.28, -1.35, -1.85, -1.6, -1.75, -1.35, -.93, -.59, -.34, -.14, 0] },
      leftShoulder: { x: [0, .3, .8, .9, .6, -.25, -1.2, -1.7, -1.45, -1.6, -1.25, -.85, -.54, -.31, -.13, 0] },
      rightShoulder: { x: [0, -.25, -.65, -.75, -.5, .2, .95, 1.3, 1.12, 1.22, .95, .65, .41, .24, .1, 0] },
    },
  },
  {
    name: 'breathSigh',
    duration: 4.4,
    loop: false,
    restPhase: .28,
    blend: 'additive',
    // A long breath out. Deliberately the slowest beat in the set and on a
    // period that shares no factor with any looping state (4.4s against 5.6,
    // 6.4, 7.3 and 8.1), so however it lands on the idle underneath it, it
    // lands somewhere new.
    //
    // Unlike `breathDeep` this one does not return through zero: the exhale
    // carries the chest past its resting angle into a slump, holds there, and
    // only then recovers. Overshoot on a breath is not a flourish - it is why
    // a sigh reads as a sigh and not as an inhale played backwards.
    channels: {
      chest: { x: [0, -1.1, -2.9, -4.3, -4.8, -4.4, -3.4, -2.2, -1, .3, 1, 1.1, .8, .5, .2, 0] },
      spine: { x: [0, -.55, -1.45, -2.15, -2.4, -2.2, -1.7, -1.1, -.5, .15, .5, .55, .4, .25, .1, 0] },
      head: { x: [0, -.6, -1.5, -2.2, -2.5, -2.3, -1.75, -1.1, -.4, .4, .9, 1, .75, .45, .18, 0] },
      leftShoulder: {
        z: [0, -.9, -2.3, -3.4, -3.8, -3.5, -2.7, -1.7, -.7, .3, .9, 1, .72, .44, .18, 0],
        x: [0, .6, 1.6, 2.4, 2.7, 2.5, 1.9, 1.2, .5, -.25, -.7, -.78, -.56, -.34, -.14, 0],
      },
      rightShoulder: {
        z: [0, .9, 2.3, 3.4, 3.8, 3.5, 2.7, 1.7, .7, -.3, -.9, -1, -.72, -.44, -.18, 0],
        x: [0, .6, 1.6, 2.4, 2.7, 2.5, 1.9, 1.2, .5, -.25, -.7, -.78, -.56, -.34, -.14, 0],
      },
    },
    root: { y: [0, .0022, .0058, .0086, .0096, .0088, .0068, .0044, .002, -.0008, -.0022, -.0025, -.0018, -.0011, -.0004, 0] },
  },
  {
    name: 'weightTransfer',
    duration: 4.6,
    loop: false,
    restPhase: .42,
    blend: 'additive',
    // The centre of mass actually moving, which is the one thing joint angles
    // cannot say on their own.
    //
    // `weightSettle` leans; this one steps the pelvis 4% of a hip height
    // sideways onto the supporting foot and keeps it there for a second and a
    // half before coming back. Everything above it is bookkeeping to stay
    // balanced over the new base: the pelvis drops on the unloaded side, the
    // lumbar spine bends the other way, the free knee softens while the loaded
    // one straightens, and the head counter-tilts so the eyes stay level. Take
    // any one of those away and the shift reads as the character sliding
    // rather than as the character deciding to stand differently.
    channels: {
      hips: {
        z: [0, .7, -1.2, -2.8, -3.9, -4.3, -4.4, -4.3, -4.1, -3.65, -3, -2.25, -1.5, -.85, -.32, 0],
        y: [0, -.25, .45, 1, 1.4, 1.55, 1.58, 1.55, 1.47, 1.31, 1.08, .81, .54, .31, .12, 0],
      },
      spine: {
        z: [0, -.55, .95, 2.2, 3.05, 3.35, 3.4, 3.35, 3.2, 2.85, 2.35, 1.75, 1.17, .67, .25, 0],
        x: [0, -.15, .25, .55, .75, .82, .84, .82, .78, .7, .58, .43, .29, .16, .06, 0],
      },
      chest: { z: [0, -.3, .5, 1.2, 1.65, 1.82, 1.85, 1.82, 1.73, 1.54, 1.27, .95, .63, .36, .14, 0] },
      head: {
        z: [0, .35, -.6, -1.35, -1.88, -2.05, -2.1, -2.05, -1.95, -1.74, -1.43, -1.07, -.71, -.41, -.15, 0],
        y: [0, -.4, .7, 1.6, 2.2, 2.4, 2.45, 2.4, 2.28, 2.03, 1.67, 1.25, .83, .48, .18, 0],
      },
      leftHip: {
        x: [0, -.2, .35, .8, 1.1, 1.2, 1.22, 1.2, 1.14, 1.02, .84, .63, .42, .24, .09, 0],
        z: [0, .3, -.5, -1.2, -1.65, -1.8, -1.85, -1.8, -1.72, -1.53, -1.26, -.94, -.63, -.36, -.14, 0],
      },
      rightHip: {
        x: [0, .3, -.5, -1.15, -1.6, -1.75, -1.8, -1.75, -1.66, -1.48, -1.22, -.91, -.61, -.35, -.13, 0],
        z: [0, -.25, .42, .97, 1.34, 1.47, 1.5, 1.47, 1.4, 1.24, 1.02, .77, .51, .29, .11, 0],
      },
      leftKnee: { x: [0, .2, -.35, -.8, -1.1, -1.2, -1.23, -1.2, -1.14, -1.02, -.84, -.63, -.42, -.24, -.09, 0] },
      rightKnee: { x: [0, -.6, 1.05, 2.4, 3.35, 3.68, 3.75, 3.68, 3.5, 3.12, 2.57, 1.92, 1.28, .74, .28, 0] },
      leftShoulder: { z: [0, -.35, .6, 1.35, 1.87, 2.05, 2.1, 2.05, 1.95, 1.74, 1.43, 1.07, .71, .41, .15, 0] },
      rightShoulder: { z: [0, -.28, .48, 1.1, 1.52, 1.67, 1.7, 1.67, 1.59, 1.41, 1.16, .87, .58, .33, .13, 0] },
    },
    root: { x: [0, -.006, .01, .026, .036, .04, .041, .04, .038, .034, .028, .021, .014, .008, .003, 0] },
  },

  // -------------------------------------------------------------------------
  // Six beats with a silhouette.
  //
  // Everything above this point is either a whole-body event or a small
  // ambient fidget, and the gap between those two is where the hero panel's
  // performance was thin. A player looking at a figure filling four hundred
  // pixels for minutes at a time gets a victory once in a session and, in
  // between, motion that moves a hand by five pixels. What was missing is the
  // middle: beats large enough to change the outline of the body, small enough
  // to fire every half minute without becoming an event.
  //
  // Each is built on one of the shared timings above rather than on hand-typed
  // curves, so the load, the overshoot and the asymmetric release are the same
  // shape in every channel of every beat and cannot drift apart. What differs
  // between them is which joints move, how far, and which shape they borrow.
  // -------------------------------------------------------------------------
  {
    name: 'handToChin',
    duration: 4.2,
    loop: false,
    // The plateau, where the hand is at the face. Reduced motion holds a pose
    // that says "thinking" rather than a hand halfway up.
    restPhase: .55,
    blend: 'additive',
    // The classic thinking pose: the right hand comes up to the chin, the head
    // drops a little and turns toward it, and the weight settles onto one hip
    // for the duration. The left arm crosses under to support the right
    // elbow - which is the detail that makes it read as a pose a person holds
    // rather than a hand that happens to be near a face.
    channels: {
      rightShoulder: { x: shaped(BEAT_HOLD, 0, -52), z: shaped(BEAT_HOLD, 0, 14) },
      rightElbow: { x: shaped(BEAT_HOLD, 0, -105) },
      rightHand: { x: shaped(BEAT_HOLD, 0, 12), z: shaped(BEAT_HOLD, 0, -8) },
      leftShoulder: { x: shaped(BEAT_HOLD, 0, -7), z: shaped(BEAT_HOLD, 0, 5) },
      leftElbow: { x: shaped(BEAT_HOLD, 0, -34) },
      head: { x: shaped(BEAT_HOLD, 0, 4.5), y: shaped(BEAT_HOLD, 0, -6.5), z: shaped(BEAT_HOLD, 0, 2.5) },
      chest: { x: shaped(BEAT_HOLD, 0, -2.2), y: shaped(BEAT_HOLD, 0, -3.4) },
      spine: { x: shaped(BEAT_HOLD, 0, 1.6), y: shaped(BEAT_HOLD, 0, -2.2) },
      hips: { z: shaped(BEAT_HOLD, 0, -2.4), y: shaped(BEAT_HOLD, 0, 1.2) },
      rightHip: { x: shaped(BEAT_HOLD, 0, -1.4) },
      rightKnee: { x: shaped(BEAT_HOLD, 0, 2.8) },
      leftKnee: { x: shaped(BEAT_HOLD, 0, -1.1) },
    },
    root: { x: shaped(BEAT_HOLD, 0, .014) },
  },
  {
    name: 'foldArms',
    duration: 4.6,
    loop: false,
    restPhase: .55,
    blend: 'additive',
    // Arms folded, which is the largest change to the silhouette anything in
    // this library makes without leaving the ground. Both forearms come across
    // and the chest opens behind them; the weight goes back onto both heels a
    // fraction, which is why the pelvis travels backwards rather than sideways
    // here.
    //
    // Symmetric, and deliberately not perfectly so: the left forearm crosses
    // outside the right, so it travels further and sits higher, exactly as one
    // arm always does.
    channels: {
      leftShoulder: { x: shaped(BEAT_HOLD, 0, -30), z: shaped(BEAT_HOLD, 0, 23) },
      rightShoulder: { x: shaped(BEAT_HOLD, 0, -27), z: shaped(BEAT_HOLD, 0, -19) },
      leftElbow: { x: shaped(BEAT_HOLD, 0, -99), z: shaped(BEAT_HOLD, 0, -17) },
      rightElbow: { x: shaped(BEAT_HOLD, 0, -94), z: shaped(BEAT_HOLD, 0, 15) },
      leftHand: { z: shaped(BEAT_HOLD, 0, 11) },
      rightHand: { z: shaped(BEAT_HOLD, 0, -9) },
      chest: { x: shaped(BEAT_HOLD, 0, -3.2), y: shaped(BEAT_HOLD, 0, 1.4) },
      spine: { x: shaped(BEAT_HOLD, 0, 2.1) },
      head: { x: shaped(BEAT_HOLD, 0, -1.6), y: shaped(BEAT_HOLD, 0, 1.8) },
      hips: { z: shaped(BEAT_HOLD, 0, 1.6) },
      leftKnee: { x: shaped(BEAT_HOLD, 0, 1.4) },
      rightKnee: { x: shaped(BEAT_HOLD, 0, 1.2) },
    },
    root: { z: shaped(BEAT_HOLD, 0, -.012), x: shaped(BEAT_HOLD, 0, -.008) },
  },
  {
    name: 'emphasise',
    duration: 2.1,
    loop: false,
    restPhase: .32,
    blend: 'additive',
    // Making a point with the hand: two accents on `BEAT_DOUBLE`, the second
    // smaller and offset, with the torso rotating into the first and the head
    // arriving after it. The fastest of the six and the one the director can
    // afford to fire most often.
    channels: {
      rightShoulder: { x: shaped(BEAT_DOUBLE, 0, -36), z: shaped(BEAT_DOUBLE, 0, -11) },
      rightElbow: { x: shaped(BEAT_DOUBLE, 0, -64) },
      rightHand: { x: shaped(BEAT_DOUBLE, 0, 9), z: shaped(BEAT_DOUBLE, 0, -15) },
      leftShoulder: { x: shaped(BEAT_DOUBLE, 0, -13), z: shaped(BEAT_DOUBLE, 0, 6) },
      leftElbow: { x: shaped(BEAT_DOUBLE, 0, -27) },
      chest: { x: shaped(BEAT_DOUBLE, 0, -1.8), y: shaped(BEAT_DOUBLE, 0, -4.2) },
      spine: { y: shaped(BEAT_DOUBLE, 0, -2.6), x: shaped(BEAT_DOUBLE, 0, 1.1) },
      head: { x: shaped(BEAT_DOUBLE, 0, 1.8), y: shaped(BEAT_DOUBLE, 0, -3.4), z: shaped(BEAT_DOUBLE, 0, -1.6) },
      hips: { y: shaped(BEAT_DOUBLE, 0, 2.2) },
    },
    root: { x: shaped(BEAT_DOUBLE, 0, .006) },
  },
  {
    name: 'braceUp',
    duration: 2.8,
    loop: false,
    restPhase: .5,
    blend: 'additive',
    // Gathering yourself and standing to it: the sternum lifts, the shoulders
    // set back and down, the elbows soften as the hands close, and the chin
    // comes up past level before settling. A victory beat's read at a tenth of
    // its size, which is what makes it usable as ambient motion rather than as
    // an event.
    //
    // The pelvis rise is held to six thousandths of a hip height on purpose.
    // An additive clip contributes nothing to the contact track, so both feet
    // stay planted through it and any real lift is simply taken back out by
    // the leg solver a frame later; the lift has to live in the spine, and
    // does.
    channels: {
      chest: { x: shaped(BEAT_STRIKE, 0, -8.5) },
      spine: { x: shaped(BEAT_STRIKE, 0, -5.2) },
      head: { x: shaped(BEAT_STRIKE, 0, -7), y: shaped(BEAT_STRIKE, 0, 2.2) },
      leftShoulder: { x: shaped(BEAT_STRIKE, 0, 9.5), z: shaped(BEAT_STRIKE, 0, -6.5) },
      rightShoulder: { x: shaped(BEAT_STRIKE, 0, 8.8), z: shaped(BEAT_STRIKE, 0, 6) },
      leftElbow: { x: shaped(BEAT_STRIKE, 0, -23) },
      rightElbow: { x: shaped(BEAT_STRIKE, 0, -21) },
      leftHand: { z: shaped(BEAT_STRIKE, 0, -7) },
      rightHand: { z: shaped(BEAT_STRIKE, 0, 6) },
      hips: { y: shaped(BEAT_STRIKE, 0, 1.6) },
      leftKnee: { x: shaped(BEAT_STRIKE, 0, -1.5) },
      rightKnee: { x: shaped(BEAT_STRIKE, 0, -1.3) },
    },
    root: { y: shaped(BEAT_STRIKE, 0, .006) },
  },
  {
    name: 'turnAway',
    duration: 3.8,
    loop: false,
    restPhase: .52,
    blend: 'additive',
    chain: 'head',
    // Something across the room. Much larger than `glance` and much slower:
    // the eyes go first, the head follows to forty degrees, and the chest and
    // pelvis come round after it because at that angle the neck has run out.
    // Then it holds - a look that turns straight back has not looked at
    // anything - and unwinds.
    //
    // `chain: 'head'` inverts the usual ordering so the head leads and the
    // shoulders trail, and the secondary-motion layer in the actor adds the
    // rest: the head arrives past where it settles and rings back, because
    // that is what a nine-pound weight on a flexible neck does.
    channels: {
      head: {
        y: shaped(BEAT_HOLD, 0, 40),
        x: shaped(BEAT_HOLD, 0, -3.2),
        z: shaped(BEAT_HOLD, 0, 4.4),
      },
      chest: { y: shaped(BEAT_HOLD, 0, 13), z: shaped(BEAT_HOLD, 0, -1.8) },
      spine: { y: shaped(BEAT_HOLD, 0, 10), x: shaped(BEAT_HOLD, 0, .8) },
      hips: { y: shaped(BEAT_HOLD, 0, 5.5) },
      leftShoulder: { x: shaped(BEAT_HOLD, 0, -9), z: shaped(BEAT_HOLD, 0, 3) },
      rightShoulder: { x: shaped(BEAT_HOLD, 0, 6.5), z: shaped(BEAT_HOLD, 0, -2) },
      leftElbow: { x: shaped(BEAT_HOLD, 0, -9) },
      rightElbow: { x: shaped(BEAT_HOLD, 0, 5) },
      leftHip: { x: shaped(BEAT_HOLD, 0, -1.2) },
      rightHip: { x: shaped(BEAT_HOLD, 0, 1.1) },
    },
    root: { x: shaped(BEAT_HOLD, 0, .009) },
  },
  {
    name: 'neckRelease',
    duration: 3.9,
    loop: false,
    restPhase: .34,
    blend: 'additive',
    chain: 'head',
    // Easing a stiff neck: the head rolls to one side, comes back through
    // centre, goes a shorter way the other, and settles. Authored explicitly
    // rather than from a shared shape, because the thing that makes it read is
    // that the two halves are different sizes and different lengths - a
    // symmetric roll is a metronome, and this is the one beat in the set whose
    // whole content is the asymmetry.
    //
    // Six intervals out, three back through centre, four to the smaller second
    // side, three home. The shoulder on the loaded side lifts a little as the
    // head goes over it, which is what stops the head reading as unscrewed
    // from the body.
    channels: {
      head: {
        z: [0, -1.4, 3.6, 8.4, 12.2, 13.4, 12.6, 9.2, 4.4, -.6, -4.8, -7.2, -7.6, -6.1, -3.8, -1.7, -.5, 0],
        y: [0, 1.1, -2.4, -5.4, -7.6, -8.2, -7.7, -5.6, -2.6, .5, 3, 4.5, 4.7, 3.8, 2.4, 1.1, .3, 0],
        x: [0, -.5, 1.2, 2.8, 4, 4.4, 4.1, 3, 1.6, .5, -.3, -.9, -1, -.8, -.5, -.2, -.05, 0],
      },
      chest: { z: [0, -.4, 1, 2.3, 3.3, 3.6, 3.4, 2.5, 1.2, -.2, -1.3, -2, -2.1, -1.7, -1, -.45, -.12, 0] },
      spine: { z: [0, -.25, .6, 1.4, 2, 2.2, 2.1, 1.5, .7, -.1, -.8, -1.2, -1.3, -1, -.62, -.28, -.07, 0] },
      leftShoulder: { z: [0, .5, -1.2, -2.8, -4, -4.4, -4.1, -3, -1.4, .2, 1.6, 2.4, 2.5, 2, 1.25, .55, .15, 0] },
      rightShoulder: { z: [0, -.3, .8, 1.8, 2.6, 2.85, 2.7, 1.95, .9, -.15, -1, -1.55, -1.6, -1.3, -.8, -.36, -.1, 0] },
    },
  },
  {
    name: 'shoulderDrop',
    duration: 3.4,
    loop: false,
    restPhase: .36,
    blend: 'additive',
    // The whole body letting go of held tension: the shoulders drop and come
    // forward, the sternum sinks, the head follows it down, and then
    // everything comes back up past level before settling. Built on
    // `BEAT_SWELL`, so there is no strike anywhere in it - the beat has to
    // read as a body relaxing, and a relaxation with an accent in it reads as
    // a flinch.
    channels: {
      leftShoulder: { z: shaped(BEAT_SWELL, 0, 5.2), x: shaped(BEAT_SWELL, 0, -4.4) },
      rightShoulder: { z: shaped(BEAT_SWELL, 0, -5.2), x: shaped(BEAT_SWELL, 0, -4.4) },
      leftElbow: { x: shaped(BEAT_SWELL, 0, -6.5) },
      rightElbow: { x: shaped(BEAT_SWELL, 0, -6) },
      chest: { x: shaped(BEAT_SWELL, 0, 4.6) },
      spine: { x: shaped(BEAT_SWELL, 0, 3.1) },
      head: { x: shaped(BEAT_SWELL, 0, 3.8), y: shaped(BEAT_SWELL, 0, -1.4) },
      hips: { y: shaped(BEAT_SWELL, 0, -1.2) },
    },
    root: { y: shaped(BEAT_SWELL, 0, -.005) },
  },

  // -------------------------------------------------------------------------
  // Swimming.
  // -------------------------------------------------------------------------
  {
    name: 'swim',
    duration: 2.55,
    loop: true,
    restPhase: .22,
    // Same reasoning as the walk: the roll, the counter-rotation and the
    // breathing beat are authored phase offsets that `rig-verify.ts` measures
    // by correlation, so they are not for a generic pass to nudge.
    chain: 'none',
    // A front-crawl stroke cycle, phase 0 at left-hand entry.
    //
    // The body pitches onto its front through the hips rather than the root,
    // which is what lets a clip authored in joint angles put a standing rig
    // into a prone one at all: `hips.x` positive tips the whole hierarchy
    // face-down, so the character's own +Z forward stays the direction of
    // travel and a consumer can keep steering it exactly as it steers a
    // walker. `grounded: 0` switches foot planting off for the same reason it
    // is off when seated - there is no floor under this.
    //
    // The four things that make a stroke read as swimming rather than as arms
    // going round: the torso rolls toward whichever arm is pulling (`hips.y`),
    // the pull and the recovery are different shapes rather than one sweep
    // played forwards and backwards, the legs run their own faster flutter
    // that is not a whole-number multiple of the stroke, and the head turns
    // out of the water once per cycle to breathe.
    channels: {
      hips: {
        x: [82, 83.5, 84, 82.5, 80.5, 79.5, 80, 81.5, 83, 83.5, 82, 80.5],
        // Body roll about its own long axis, one full cycle per stroke,
        // rolling down onto the side of the arm that is pulling.
        y: [13, 6, -2, -9, -13.5, -12, -6, 2, 9, 13.5, 14, 14],
        z: [0, 1.4, 2.2, 1.6, 0, -1.4, -2.2, -1.6, 0, 1.0, 1.6, .8],
      },
      spine: {
        x: [2.5, 3.4, 3.0, 1.8, 1.2, 1.6, 2.6, 3.4, 3.0, 2.0, 1.4, 1.8],
        y: [-4.5, -2.2, .8, 3.4, 4.6, 4.0, 2.0, -.8, -3.4, -4.6, -5.0, -5.0],
      },
      chest: {
        y: [-3.4, -1.6, .6, 2.6, 3.5, 3.0, 1.5, -.6, -2.6, -3.5, -3.8, -3.8],
        z: [1.6, .8, -.4, -1.4, -1.8, -1.6, -.8, .4, 1.4, 1.8, 1.9, 1.9],
      },
      // The breathing beat. The head stays looking down the line of travel for
      // most of the cycle and turns out to the side once, timed to the roll
      // that is already happening rather than fighting it.
      head: {
        x: [-14, -16, -18, -17, -14, -12, -13, -15, -17, -16, -14, -13],
        y: [10, 2, -6, -14, -20, -16, -6, 4, 14, 22, 26, 20],
        z: [-2, -1, 0, 1, 2, 1.5, .5, -.5, -1.5, -2.5, -3, -2.5],
      },
      // Left arm. Entry at full reach, catch, pull through to the hip by the
      // half cycle, then a high recovery swung wide of the body.
      leftShoulder: {
        x: [-165, -150, -122, -88, -52, -20, -2, -12, -46, -95, -140, -162],
        z: [-8, -10, -12, -14, -14, -12, -18, -30, -38, -34, -20, -10],
      },
      leftElbow: { x: [-8, -26, -52, -72, -62, -34, -18, -55, -95, -100, -70, -22] },
      leftHand: { z: [2, 6, 10, 8, 4, 0, -4, -6, -2, 4, 6, 4] },
      rightShoulder: {
        x: halfPhase([-165, -150, -122, -88, -52, -20, -2, -12, -46, -95, -140, -162]),
        z: halfPhase([8, 10, 12, 14, 14, 12, 18, 30, 38, 34, 20, 10]),
      },
      rightElbow: { x: halfPhase([-8, -26, -52, -72, -62, -34, -18, -55, -95, -100, -70, -22]) },
      rightHand: { z: halfPhase([-2, -6, -10, -8, -4, 0, 4, 6, 2, -4, -6, -4]) },
      // Flutter kick: three beats per leg per stroke cycle, so it does not
      // land on the same phase of the arm cycle twice running.
      leftHip: { x: SWIM_KICK_HIP },
      rightHip: { x: halfPhase(SWIM_KICK_HIP) },
      leftKnee: { x: SWIM_KICK_KNEE },
      rightKnee: { x: halfPhase(SWIM_KICK_KNEE) },
      leftFoot: { x: [24, 27, 24, 21, 24, 27, 24, 21, 24, 27, 24, 21] },
      rightFoot: { x: [24, 21, 24, 27, 24, 21, 24, 27, 24, 21, 24, 27] },
    },
    root: {
      // The body sits at the waterline rather than on a floor: consumers place
      // the root at the surface and this drops the hips into it. Expressed in
      // hip-heights like every other root channel, so it retargets.
      y: [-.78, -.775, -.772, -.776, -.782, -.786, -.784, -.779, -.774, -.772, -.776, -.781],
      // Surge. A swimmer is not moving at a constant speed - each pull
      // accelerates the body and it decelerates through the recovery - and two
      // surges per stroke is what two arms produce.
      z: [.012, .004, -.006, -.012, -.006, .004, .012, .004, -.006, -.012, -.006, .004],
      x: [.006, .003, -.002, -.006, -.008, -.005, 0, .004, .007, .008, .008, .007],
    },
    grounded: 0,
  },
  {
    name: 'swimEnter',
    duration: 1.15,
    loop: false,
    restPhase: .8,
    // No overlap pass. A transition clip is not a free-standing performance -
    // its whole job is to arrive in another clip's pose with another clip's
    // velocity, and the swim it hands to is itself unlagged so its stroke stays
    // locked to the contact curve. Warping the interior of this one against a
    // partner that is not warped leaves the two disagreeing about where the
    // arms are at the handover, which is a pop at the exact frame the audience
    // is watching the character commit to the water.
    chain: 'none',
    // Standing to prone. The body pitches forward from the hips while the
    // arms come up and over into the reach and the legs extend back, and
    // `grounded` releases part-way so foot planting lets go before the feet
    // are anywhere the floor could be.
    channels: {
      hips: { x: [0, 14, 40, 66, 80, 83, 82], y: [0, 1, 3, 6, 9, 12, 13] },
      spine: { x: [1.2, 4, 6, 5.5, 4, 3, 2.5], y: [0, -.5, -1.5, -2.6, -3.6, -4.2, -4.5] },
      chest: { x: [-.8, 1, 2, 1.6, .8, 0, -.4], y: [0, -.4, -1.2, -2, -2.8, -3.2, -3.4] },
      head: { x: [.5, -2, -8, -14, -16, -15, -14], y: [0, 1, 3, 6, 8, 9.5, 10] },
      leftShoulder: { x: [1.5, -22, -70, -120, -150, -162, -165], z: [1, -2, -6, -9, -9, -8, -8] },
      rightShoulder: { x: [1.4, -14, -44, -70, -50, -20, -2], z: [-1, 3, 9, 16, 18, 18, 18] },
      leftElbow: { x: [-7, -14, -22, -20, -14, -10, -8] },
      rightElbow: { x: [-8, -20, -44, -60, -44, -26, -18] },
      leftHip: { x: [-.6, 2, 8, 12, 10, 4, -2], z: [-1.4, -1.4, -1.4, -1.4, -1.4, -1.4, -1.4] },
      rightHip: { x: [.5, 3, 9, 13, 9, 2, -4], z: [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4] },
      leftKnee: { x: [3.5, 10, 20, 24, 18, 12, 8] },
      rightKnee: { x: [3.2, 12, 24, 28, 20, 14, 10] },
      leftFoot: { x: [0, 5, 13, 20, 24, 25, 24] },
      rightFoot: { x: [0, 5, 13, 20, 24, 25, 24] },
    },
    root: { y: [0, -.10, -.32, -.56, -.71, -.77, -.78], z: [0, .01, .03, .04, .03, .01, 0] },
    grounded: [1, .8, .4, .1, 0, 0, 0],
  },
  {
    name: 'swimExit',
    duration: 1.3,
    loop: false,
    restPhase: .78,
    // Unlagged for the same reason as `swimEnter`: it has to leave the stroke
    // in the pose the stroke is actually in.
    chain: 'none',
    // Prone to standing, authored forwards rather than as the entry reversed:
    // getting out of the water is a pull of the knees under the body and then
    // a push up, which is not what the entry looks like played backwards.
    channels: {
      hips: { x: [82, 78, 62, 38, 16, 4, 0], y: [13, 10, 6, 3, 1, 0, 0] },
      spine: { x: [2.5, 5, 9, 10, 6, 2.5, 1.2], y: [-4.5, -3.6, -2.4, -1.2, -.4, 0, 0] },
      chest: { x: [-.4, 1.4, 3.4, 3.6, 1.8, 0, -.8], y: [-3.4, -2.6, -1.6, -.8, -.2, 0, 0] },
      head: { x: [-14, -10, -2, 4, 3, 1, .5], y: [10, 7, 4, 2, .5, 0, 0] },
      leftShoulder: { x: [-165, -140, -92, -46, -14, 0, 1.5], z: [-8, -8, -7, -5, -2, 0, 1] },
      rightShoulder: { x: [-2, -18, -46, -40, -16, -2, 1.4], z: [18, 16, 11, 6, 2, 0, -1] },
      leftElbow: { x: [-8, -14, -26, -30, -18, -9, -7] },
      rightElbow: { x: [-18, -34, -56, -48, -24, -11, -8] },
      leftHip: { x: [-2, -14, -38, -34, -14, -3, -.6], z: [-1.4, -1.4, -1.4, -1.4, -1.4, -1.4, -1.4] },
      rightHip: { x: [-4, -16, -40, -36, -15, -3, .5], z: [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4] },
      leftKnee: { x: [8, 26, 54, 46, 20, 7, 3.5] },
      rightKnee: { x: [10, 28, 56, 48, 21, 7, 3.2] },
      leftFoot: { x: [24, 18, 6, -6, -4, -1, 0] },
      rightFoot: { x: [24, 18, 6, -6, -4, -1, 0] },
    },
    root: { y: [-.78, -.74, -.56, -.30, -.10, -.02, 0], z: [0, -.01, -.03, -.04, -.02, 0, 0] },
    grounded: [0, 0, .15, .55, .9, 1, 1],
  },
]

/**
 * Left/right mirror of a clip, generated at build time.
 *
 * This is how "which limb leads" becomes a variable rather than a decision
 * baked into the clip. An asymmetric beat - reaching across to square a cuff,
 * tilting the head to consider something - is a tell the moment it always
 * happens on the same side, and authoring each one twice by hand is both more
 * source and an invitation for the two copies to drift apart. Mirroring is
 * exact instead: reflecting a pose through the sagittal plane swaps the paired
 * joints and negates every rotation that is not about the fore-aft axis.
 */
const MIRRORED_BONE: Partial<Record<HumanoidBone, HumanoidBone>> = {
  leftShoulder: 'rightShoulder', rightShoulder: 'leftShoulder',
  leftElbow: 'rightElbow', rightElbow: 'leftElbow',
  leftHand: 'rightHand', rightHand: 'leftHand',
  leftHip: 'rightHip', rightHip: 'leftHip',
  leftKnee: 'rightKnee', rightKnee: 'leftKnee',
  leftFoot: 'rightFoot', rightFoot: 'leftFoot',
}

const negated = (curve: Curve | undefined) => curve?.map((value) => -value)

function mirrorSpec(spec: ClipSpec, name: string): ClipSpec {
  const channels: PoseChannels = {}
  for (const [key, source] of Object.entries(spec.channels)) {
    if (!source) continue
    const bone = key as HumanoidBone
    channels[MIRRORED_BONE[bone] ?? bone] = {
      x: source.x ? [...source.x] : undefined,
      y: negated(source.y),
      z: negated(source.z),
    }
  }
  return {
    ...spec,
    name,
    channels,
    root: spec.root ? { ...spec.root, x: negated(spec.root.x) } : undefined,
    contact: spec.contact ? { left: spec.contact.right, right: spec.contact.left } : undefined,
  }
}

/** The beats whose mirror image is a genuinely different-looking performance.
 *  Symmetric ones (a breath, a nod) are left alone; mirroring those would only
 *  cost memory for two identical clips. */
const MIRRORED_CLIPS = [
  'glance', 'cuffAdjust', 'weightSettle', 'considerTilt', 'acknowledge',
  'checkWatch', 'scanRoom', 'doubleTake', 'weightTransfer',
  'handToChin', 'emphasise', 'turnAway', 'neckRelease',
] as const

const ALL_SPECS: ClipSpec[] = [
  ...CLIP_SPECS,
  ...MIRRORED_CLIPS.map((name) => {
    const spec = CLIP_SPECS.find((candidate) => candidate.name === name)
    if (!spec) throw new Error(`mirrored clip "${name}" has no source spec`)
    return mirrorSpec(spec, `${name}Mirrored`)
  }),
]

export type ClipName = typeof CLIP_SPECS[number]['name']

/**
 * Runtime metadata the mixer cannot express, kept alongside each clip.
 * The actor reads this to drive root motion, foot planting and the
 * reduced-motion held pose.
 */
export type ClipMeta = {
  name: string
  duration: number
  loop: boolean
  restPhase: number
  contact: { left: [number, number] | null; right: [number, number] | null }
  /** True when this clip is a delta layered over the base pose rather than a
   *  pose in its own right. The actor needs it to decide whether playing this
   *  clip should fade the base state out or leave it running underneath. */
  additive: boolean
}

export type ClipLibrary = {
  /** Bakes the named clip on first request, then serves it from the cache. */
  clip: (name: string) => THREE.AnimationClip | undefined
  meta: Map<string, ClipMeta>
  names: readonly string[]
  /** Bakes whatever has not been asked for yet, within a millisecond budget.
   *  Returns true when the library is complete. */
  warm: (budgetMs?: number) => boolean
}

/**
 * The proxy node that carries non-rotational animation state.
 *
 * Foot contact and "am I on my feet" have to blend through crossfades exactly
 * as the joint rotations do - if they did not, a foot would unplant abruptly
 * mid-transition and produce precisely the pop this system exists to remove.
 * Animating them as a track on a hidden, empty node lets the mixer do that
 * blending with the same weights it uses for everything else, at no render
 * cost.
 */
export const ANIM_META_NODE = 'AnimMeta'
/** Carries the normalized hip translation so it blends through crossfades. */
export const ROOT_MOTION_NODE = 'RootMotion'

function sampleCurve(curve: Curve, phase: number, loop: boolean, scale: number) {
  return cubicSpline(curve, phase, loop) * scale
}

/**
 * Picks a bake rate for one clip from how fast it actually moves.
 *
 * A flat rate across the library is wasteful in both directions. The ripple a
 * given rate leaves behind is roughly the per-sample velocity step over the
 * peak velocity, or `accel / (rate * velocity)`, so the rate a clip needs to
 * hit a fixed ripple is proportional to `accel / velocity` - the clip's own
 * characteristic frequency, in units of 1/s. A six-second seated fidget and a
 * one-second walk cycle differ by several times on that measure, and baking
 * both at the walk's rate spends most of the library's memory on the clips
 * that least need it.
 */
function bakeRateFor(spec: ClipSpec) {
  const probe = 480
  let peakVelocity = 0
  let peakAccel = 0
  // Measured through the same phase warp the bake uses. A trailing joint's
  // curve is compressed in time at the ends of a one-shot, so it moves faster
  // there than the raw control points suggest; reading the rate off the
  // unwarped curve would under-sample exactly the beats that overlap most.
  for (const [boneKey, channels] of Object.entries(spec.channels)) {
    if (!channels) continue
    const lag = chainLagFor(spec, boneKey as HumanoidBone)
    for (const curve of [channels.x, channels.y, channels.z]) {
      if (!curve) continue
      const at = (index: number) =>
        sampleCurve(curve, laggedPhase(index / probe, lag, spec.loop), spec.loop, DEG)
      let previous = at(0)
      let current = at(1)
      for (let index = 2; index <= probe; index += 1) {
        const next = at(index)
        const dt = spec.duration / probe
        peakVelocity = Math.max(peakVelocity, Math.abs(current - previous) / dt)
        peakAccel = Math.max(peakAccel, Math.abs(next - 2 * current + previous) / (dt * dt))
        previous = current
        current = next
      }
    }
  }
  if (peakVelocity < 1e-6) return MIN_SAMPLE_RATE
  // Calibrated against the walk cycle, which is the fastest sustained clip
  // here and measured 1.3% ripple when baked at 60. Its characteristic
  // frequency is 16.4/s, so 3.7 samples per unit of it reproduces that
  // density, and every other clip gets the rate its own motion earns: the
  // six-second seated fidget moves an order of magnitude more slowly and
  // lands on the floor, which is where most of the saving comes from.
  return THREE.MathUtils.clamp(
    Math.round(3.7 * peakAccel / peakVelocity),
    MIN_SAMPLE_RATE,
    MAX_SAMPLE_RATE,
  )
}

function buildClip(spec: ClipSpec): THREE.AnimationClip {
  const frames = Math.max(8, Math.round(spec.duration * bakeRateFor(spec)))
  // Every clip gets a sample at exactly t = duration, looping ones included.
  //
  // Leaving it off looks right - the last distinct pose is at
  // (frames-1)/frames and repeating frame zero at the end seems redundant -
  // but a keyframe track holds its final value for any time past its last key,
  // so the pose would freeze for the last sample interval of every cycle and
  // then jump. That is a stutter once per loop, which is precisely the kind of
  // regular tick that reads as mechanical. For a looping clip the wrapped
  // sampler returns the phase-0 value at phase 1, so the seam closes exactly.
  const sampleCount = frames + 1
  const times = new Float32Array(sampleCount)
  for (let index = 0; index < sampleCount; index += 1) {
    times[index] = (index / frames) * spec.duration
  }

  const tracks: THREE.KeyframeTrack[] = []
  const euler = new THREE.Euler()
  const quaternion = new THREE.Quaternion()

  const additive = spec.blend === 'additive'

  for (const [boneKey, channels] of Object.entries(spec.channels)) {
    const bone = boneKey as HumanoidBone
    if (!channels) continue
    const values = new Float32Array(sampleCount * 4)
    const rest = canonicalRestQuaternion(bone)
    const lag = chainLagFor(spec, bone)
    for (let index = 0; index < sampleCount; index += 1) {
      const phase = laggedPhase(index / frames, lag, spec.loop)
      euler.set(
        channels.x ? sampleCurve(channels.x, phase, spec.loop, DEG) : 0,
        channels.y ? sampleCurve(channels.y, phase, spec.loop, DEG) : 0,
        channels.z ? sampleCurve(channels.z, phase, spec.loop, DEG) : 0,
        'XYZ',
      )
      // An override clip bakes the canonical rest pose in, so it describes a
      // complete absolute pose and blending between two of them is well
      // defined. An additive clip must not: the mixer post-multiplies its
      // value onto whatever the base clips produced, so its value has to be
      // the bare delta. Baking rest into an additive clip would apply the
      // resting posture a second time on every frame the gesture is up.
      quaternion.setFromEuler(euler)
      if (!additive) quaternion.premultiply(rest)
      values[index * 4] = quaternion.x
      values[index * 4 + 1] = quaternion.y
      values[index * 4 + 2] = quaternion.z
      values[index * 4 + 3] = quaternion.w
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${HUMANOID_NODE_NAMES[bone]}.quaternion`, times as unknown as number[], values as unknown as number[]))
  }

  // Normalized root translation, in hip-heights.
  const rootValues = new Float32Array(sampleCount * 3)
  for (let index = 0; index < sampleCount; index += 1) {
    const phase = index / frames
    rootValues[index * 3] = spec.root?.x ? sampleCurve(spec.root.x, phase, spec.loop, 1) : 0
    rootValues[index * 3 + 1] = spec.root?.y ? sampleCurve(spec.root.y, phase, spec.loop, 1) : 0
    rootValues[index * 3 + 2] = spec.root?.z ? sampleCurve(spec.root.z, phase, spec.loop, 1) : 0
  }
  // Additive vector tracks are summed, and zero is their identity, so an
  // additive clip's root and meta channels are already deltas by construction.
  tracks.push(new THREE.VectorKeyframeTrack(`${ROOT_MOTION_NODE}.position`, times as unknown as number[], rootValues as unknown as number[]))

  // Foot contact and groundedness, blended by the mixer along with everything
  // else.
  const metaValues = new Float32Array(sampleCount * 3)
  const contactAt = (curve: Curve | undefined, phase: number) => {
    if (!curve) return 1
    // An interpolating spline overshoots either side of a sharp step such as
    // heel strike, and a contact weight above one or below zero is meaningless.
    return THREE.MathUtils.clamp(sampleCurve(curve, phase, spec.loop, 1), 0, 1)
  }
  // An additive clip leaves contact and groundedness alone. Zero is the
  // identity for an additive vector track, and an additive gesture has no
  // opinion about whether the feet are on the floor - a nod does not unplant
  // anybody - so it contributes nothing and the base clip's contact survives.
  if (!additive) {
    for (let index = 0; index < sampleCount; index += 1) {
      const phase = index / frames
      metaValues[index * 3] = contactAt(spec.contact?.left, phase)
      metaValues[index * 3 + 1] = contactAt(spec.contact?.right, phase)
      metaValues[index * 3 + 2] = typeof spec.grounded === 'number'
        ? spec.grounded
        : spec.grounded
          ? THREE.MathUtils.clamp(sampleCurve(spec.grounded, phase, spec.loop, 1), 0, 1)
          : 1
    }
  }
  tracks.push(new THREE.VectorKeyframeTrack(`${ANIM_META_NODE}.position`, times as unknown as number[], metaValues as unknown as number[]))

  const clip = new THREE.AnimationClip(spec.name, spec.duration, tracks)
  clip.blendMode = additive ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode
  return clip
}

/** The span of phase over which a foot carries most of the body's weight,
 *  derived from its contact curve so the two can never disagree. */
function stanceWindow(curve: Curve | undefined): [number, number] | null {
  if (!curve) return [0, 1]
  let first = -1
  let last = -1
  for (let index = 0; index < curve.length; index += 1) {
    if (curve[index] <= .5) continue
    if (first < 0) first = index
    last = index
  }
  if (first < 0) return null
  return [first / curve.length, (last + 1) / curve.length]
}

let library: ClipLibrary | null = null

/**
 * Builds the clip library once and shares it across every actor in the app.
 *
 * `AnimationClip` instances are immutable as far as the mixer is concerned, so
 * one library serves any number of actors - each gets its own `AnimationMixer`
 * and its own playback state, but the keyframe data itself is allocated a
 * single time. That is what keeps the memory cost of a crowd flat.
 *
 * ## Why the clips are baked on demand
 *
 * Baking all forty-five was measured at roughly two hundred milliseconds on the
 * office's critical path at 4x CPU throttle - the largest single block of
 * application code between the canvas appearing and its first frame. Most of
 * that is not the bake at all but `bakeRateFor`, which probes every channel of
 * every clip at 480 samples to choose a sample rate; the bake itself then takes
 * a few dozen.
 *
 * None of it is needed to show a room. An office opens with five or six
 * distinct states on screen and reaches for the rest of the library over the
 * following minutes, so the cost is paid for clips nobody has asked for yet, in
 * front of the frame everybody is waiting for. Deferring costs nothing in
 * fidelity - the clip data is identical whenever it is built - and `warm()`
 * below takes the remainder back off the critical path without leaving a hitch
 * on the first gesture.
 */
export function humanoidClipLibrary(): ClipLibrary {
  if (library) return library
  const specs = new Map<string, ClipSpec>()
  const clips = new Map<string, THREE.AnimationClip>()
  const meta = new Map<string, ClipMeta>()
  // Metadata is read for clips that are not playing - the contact windows drive
  // stride measurement, `additive` decides how a gesture composes - and it is
  // cheap: a scan of an existing array rather than a bake. So it stays eager.
  for (const spec of ALL_SPECS) {
    specs.set(spec.name, spec)
    meta.set(spec.name, {
      name: spec.name,
      duration: spec.duration,
      loop: spec.loop,
      restPhase: spec.restPhase,
      contact: {
        left: stanceWindow(spec.contact?.left),
        right: stanceWindow(spec.contact?.right),
      },
      additive: spec.blend === 'additive',
    })
  }

  const clip = (name: string) => {
    const built = clips.get(name)
    if (built) return built
    const spec = specs.get(name)
    if (!spec) return undefined
    const fresh = buildClip(spec)
    clips.set(name, fresh)
    return fresh
  }

  /**
   * Bakes whatever is left, a slice at a time.
   *
   * Returns true once nothing remains, so an idle callback can stop asking. The
   * budget keeps each slice inside the frame it runs in: one clip is a couple
   * of milliseconds, and stopping between them is always safe because a clip is
   * either fully in the map or not in it at all.
   */
  const warm = (budgetMs = 4) => {
    const until = performance.now() + budgetMs
    for (const name of specs.keys()) {
      if (clips.has(name)) continue
      clip(name)
      if (performance.now() >= until) return clips.size === specs.size
    }
    return true
  }

  library = { clip, meta, names: [...specs.keys()], warm }
  return library
}

let warming = false

/**
 * Bakes the rest of the library while the main thread has nothing better to do.
 *
 * Called once a scene has its first frame up. Idempotent, and safe to call from
 * several surfaces at once - the office and a portrait grid both want the same
 * library and neither should wait for it.
 */
export function warmHumanoidClips() {
  if (warming || typeof window === 'undefined') return
  warming = true
  const library = humanoidClipLibrary()
  const idle = (window as Window & typeof globalThis).requestIdleCallback
  const step = () => {
    if (library.warm()) return
    if (typeof idle === 'function') idle(() => step(), { timeout: 900 })
    else setTimeout(step, 24)
  }
  if (typeof idle === 'function') idle(() => step(), { timeout: 1500 })
  else setTimeout(step, 120)
}
