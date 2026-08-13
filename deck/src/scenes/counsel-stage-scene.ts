import * as THREE from 'three'

import { TwoBoneIk } from './arm-ik'
import { loadCounselModel, type CounselModel } from './counsel-model'
import { COUNSEL_PULL_MS, COUNSEL_PULL_PARK, COUNSEL_PULL_TO } from './counsel-pull'
import { registerProbe, withdrawProbe } from './probe'
import { addNavyCyc, NAVY_STAGE } from './navy-stage'
import { CameraRig, contactShadow, disposeTree, smoothstep } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * SLIDE 10 → 11. A navy cyclorama, one counsel, and the next slide brought on
 * by hand.
 *
 * The move, in one take: he idles facing the room; on the click he turns
 * downstage-right and *walks* — a real walk cycle, so the feet plant and the
 * arms swing; he arrives at the right edge of frame, reaches out and closes his
 * hand on the left edge of slide 11; then he backs across the whole stage
 * hauling it with him, and is carried out of frame by it as it lands.
 *
 * He is the deck's own stylized counsel — the same man as the close slide — and
 * the clips he moves on are an animator's, sampled onto this skeleton at load.
 * See `counsel-model` for why it is that way round rather than either of the
 * two obvious alternatives.
 *
 * ## The three things that make it read
 *
 * **The feet do not slide.** Locomotion is driven by the *phase* of the clip,
 * and the ground position is read off `stride.at(phase)` — a table of how far
 * the clip's own planted foot dragged through the body. So the body covers
 * exactly the distance the legs say it covered, at every instant, including
 * through the ease-in and the ease-out. Nothing anywhere picks a speed.
 *
 * **He travels along his own facing.** Both legs of the move are straight lines
 * and the yaw is a constant on each, set from the line's own direction, so the
 * sideways component of the travel is zero rather than small. He only turns
 * while standing still. Getting this wrong is the classic version of foot
 * slide, and it is invisible in code review: a figure walking 12° off his
 * facing skates a fifth of his stride sideways every step.
 *
 * **The slide is not eased on.** The pulled POV is the real DOM layer,
 * full-screen and unwarped, and its `translateX` is written from the projected
 * position of the grip point on his hand. That point is rigid to his body from
 * the moment his fingers close, so the paper moves because he does, from first
 * contact all the way to identity. `probe().handDriven` reports the fraction of
 * the journey his hand carried.
 *
 * ## Why he is never behind the paper
 *
 * He takes the sheet by its *left* edge, so he is always to the left of it and
 * the DOM layer above this canvas never covers him. The previous version cut a
 * hole in the incoming slide with a radial mask so a hand could show through,
 * which is the thing that read as a sticker. There is no mask here. The fingers
 * do pass a few pixels behind the edge, on purpose: that is what taking hold of
 * the edge of a sheet looks like.
 */


/**
 * The lens. Framed so the figure stands about two thirds of the frame tall
 * with his feet well clear of the deck chrome, which sits in the bottom 8%.
 */
const LENS = { position: [0, 4.3, 15.2] as [number, number, number], target: [0, 2.9, 0] as [number, number, number], fov: 35 }

/** World height of the standing figure. About 65% of frame height at 16:9. */
const FIGURE_HEIGHT = 6.2

/** Yaw while walking out. Fixed, because the path is derived from it. */
const WALK_YAW = 1.2

/** Yaw at rest, facing the room. */
const REST_YAW = -.14

/**
 * Where the two legs sit in depth. Shallow: every unit downstage is 7% more
 * figure, and he has to clear the chrome at the near end of the move as well
 * as read as a person at the far end.
 */
const PATH_Z = { contact: .9, release: -.7 } as const

/**
 * How much closer to the lens the walk brings him. Sets its length.
 *
 * A step and a bit rather than two and a bit, cut on review for being longer
 * than it was worth: the walk-in exists to establish that he crosses the room
 * to the sheet, and one clear stride does that as well as three. What it costs
 * is that he idles further right, since where he starts is `B` minus the walk
 * and `B` is fixed by where his hand has to be — but slide 10 carries its text
 * on the left, so right of centre is where the composition wanted him anyway.
 */
const WALK_DEPTH = 1.35

/**
 * Seconds per walk cycle on the ground: about 114 steps a minute, which is an
 * ordinary purposeful walking pace.
 *
 * A cadence rather than a playback rate, because a playback rate inherits
 * whatever the animator happened to key and this clip is keyed at 1.33s — a
 * slow amble, and slow enough that it read as floating rather than walking
 * however the rest of the beat was arranged. Speeding it up cannot desync
 * anything: ground travel is a function of clip phase, so the legs and the
 * body change rate together and a planted foot stays planted.
 */
const WALK_CADENCE = 1.05

/** Grip height below the shoulder, and how far downstage of it, world units. */
const GRIP_DROP = .5
const GRIP_FRONT = .35

/**
 * How much of the arm's length the reach spends. Above about 0.9 the elbow
 * locks, and a straight arm reads as a mannequin rather than as a man taking
 * hold of something.
 *
 * It also decides where he stands, since he stands an arm's length from the
 * sheet: this rig's arm is shorter relative to its height than the last one's,
 * so at the old 0.8 he had to walk far enough right that his upstage shoulder
 * left the frame.
 */
const REACH_USE = .86

/**
 * Fingers past the edge, in CSS pixels. The DOM layer sits above this canvas,
 * so the overlap is hidden behind the sheet — which is the read wanted: the
 * fingers are around the far side of the edge, not laid on the front of it.
 */
const GRIP_BITE_PX = 16

/**
 * Seconds. Everything but the two walks, which get whatever is left.
 *
 * The whole beat was tightened after review: shorter still-frames at both ends
 * and a shorter cross-fade, which buys the walks a larger share of a shorter
 * clock. What is deliberately *not* shorter is the relationship between the
 * clips and the ground — the legs still cover exactly the distance the body
 * covers, so tightening the beat speeds his cadence rather than desyncing it.
 */
const BEAT = {
  /**
   * Pivot from facing the room to facing the way he is going. In place.
   *
   * This is the whole of the click-to-motion latency, so it is as short as a
   * body can turn twenty degrees and no shorter. Half a second of pivot before
   * anything translated was the thing that made the old version feel like it
   * was thinking about it.
   */
  turn: .2,
  /**
   * How long before he arrives the arm starts going out. People reach while
   * they are still walking; holding the reach until the feet stop leaves him
   * standing at the edge of frame with his arm out and nothing yet to hold,
   * which is the half second that made the old version read as a pose.
   */
  reachLead: .62,
  /** And how long he is still after arriving, before the fingers close. */
  reach: .18,
  grip: .1,
  /**
   * Slack at the end. The sheet is home before this starts; it exists so the
   * stage can be torn down at `COUNSEL_PULL_MID` with the hand already off the
   * clock rather than a frame or two short of it.
   */
  settle: .34,
  /** Locomotion eases in and out over this, inside its own leg. */
  ramp: .26,
  /**
   * Cross-fades.
   *
   * Short, because a cross-fade is the one place in this scene where the feet
   * are not under anyone's control: for its duration the legs are an average
   * of two clips and the planted sole drifts. Halving it halved the drift.
   */
  blend: .16,
} as const

const TOTAL = COUNSEL_PULL_MS / 1000

function slideLayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.deck-layer[data-slide="${COUNSEL_PULL_TO}"]`)
}

/**
 * Distance covered inside one leg, eased at both ends.
 *
 * A body does not reach cruising speed in a frame and does not stop dead, and
 * this ramp is what separates "a walk cycle playing while a transform changes"
 * from a person setting off and arriving. It is spent in units of clip *phase*,
 * so the legs slow down with the body rather than against it: everything
 * downstream reads the ground position off the phase.
 */
function eased(elapsed: number, span: number, total: number) {
  const ramp = Math.min(BEAT.ramp, span * .4)
  const t = THREE.MathUtils.clamp(elapsed, 0, span)
  // Trapezoidal rate. Its plateau is higher than the mean by exactly the area
  // the two triangles give up.
  const cruise = total / Math.max(1e-6, span - ramp)
  if (t <= ramp) return cruise * t * t / (2 * ramp)
  if (t >= span - ramp) {
    const left = span - t
    return total - cruise * left * left / (2 * ramp)
  }
  return cruise * (t - ramp / 2)
}

export async function createCounselStageScene(context: SceneContext): Promise<DeckScene> {
  const scene = new THREE.Scene()
  const { key, bounce, fill, rim } = addNavyCyc(scene)

  // Parallax is off for the whole beat. Slide 10's lockup is DOM over this
  // canvas; even a 4% sway rebuilds the camera matrix every frame and the
  // type jitters with it. The pull writes the next slide from a projected
  // hand, so a moving lens would shake that sheet too. Frozen until dispose.
  const rig = new CameraRig(
    { spot: { ...LENS, parallax: 0 } },
    'spot',
    context.width / Math.max(1, context.height),
  )
  const camera = rig.camera

  const model: CounselModel = await loadCounselModel(FIGURE_HEIGHT)

  const { holder, joints, mixer, actions, stride } = model
  scene.add(holder)
  holder.add(contactShadow(FIGURE_HEIGHT * .2, .28))

  // A navy card in front of him, same colour as the cyc. `fadeIn` from the
  // burnout slide eases it off so he appears on the room rather than popping.
  // Grab-pull never sets it; opacity stays 0.
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 18),
    new THREE.MeshBasicMaterial({
      color: NAVY_STAGE.field,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  veil.position.set(0, 3.1, 6.4)
  veil.renderOrder = 8
  scene.add(veil)
  let veilFade = 1

  for (const action of Object.values(actions)) {
    // Clip time is written by hand every frame; the mixer only blends. The
    // ground position is read off the phase, so letting the mixer advance its
    // own clock would put the two out of step the moment a walk eases in or
    // out — which is the foot slide this scene exists to kill.
    action.timeScale = 0
    action.weight = 0
    action.play()
  }

  /**
   * How high an ankle sits when he is standing on it, measured off the idle
   * itself rather than assumed.
   *
   * This is the reference for "is that foot actually on the floor", which every
   * foot measurement in this scene needs and none of them used to have. The
   * ankle is not the sole — there is a shoe below it — so the number is neither
   * zero nor derivable from `soleRest` without knowing the shoe.
   */
  const standAnkle = (() => {
    actions.Idle_Neutral.weight = 1
    actions.Idle_Neutral.time = 0
    mixer.update(0)
    holder.updateWorldMatrix(true, true)
    const y = Math.min(
      joints.footL.getWorldPosition(new THREE.Vector3()).y,
      joints.footR.getWorldPosition(new THREE.Vector3()).y,
    )
    actions.Idle_Neutral.weight = 0
    return y
  })()

  /**
   * How far above that still counts as contact.
   *
   * Wide enough to keep the foot through heel-off, when the ankle lifts while
   * the toe is still down and the ankle's small forward roll is the foot doing
   * its job rather than sliding; narrow enough to drop it the moment it is
   * genuinely swinging. About four centimetres at this figure's scale.
   */
  const CONTACT_BAND = FIGURE_HEIGHT * .0065

  // --- the gripping hand -----------------------------------------------------
  //
  // The effector is a point in the fingers rather than the wrist pivot, so
  // closing the hand does not move the contact.
  holder.updateWorldMatrix(true, true)
  const arm = new TwoBoneIk(joints.shoulderR, joints.elbowR, joints.handR, model.gripLocal)
  const armSpan = (arm.upperLength + arm.lowerLength) * REACH_USE

  // --- projection ------------------------------------------------------------
  const tmpProject = new THREE.Vector3()
  const projectPoint = (world: THREE.Vector3) => {
    tmpProject.copy(world).project(camera)
    return {
      x: (tmpProject.x * .5 + .5) * Math.max(1, context.width),
      y: (-tmpProject.y * .5 + .5) * Math.max(1, context.height),
    }
  }

  /**
   * The world X on the line `(y, z)` that lands at `fx` across the frame.
   *
   * Bisected rather than unprojected. A line of constant Y and Z is not the
   * camera's near plane, the camera looks down nine degrees, and the frustum's
   * horizontal extent at a given height is a function of that height — so the
   * closed form is a page of algebra that has to be right about the tilt.
   * Projection is monotonic in X, so forty halvings of a 180-unit bracket lands
   * far inside a thousandth of a unit, and this runs six times per resize.
   */
  const solve = new THREE.Vector3()
  const worldXAtFrame = (fx: number, y: number, z: number) => {
    let low = -90
    let high = 90
    for (let step = 0; step < 40; step += 1) {
      const mid = (low + high) / 2
      solve.set(mid, y, z).project(camera)
      if (solve.x * .5 + .5 < fx) low = mid
      else high = mid
    }
    return (low + high) / 2
  }

  // --- choreography ----------------------------------------------------------
  const gripTarget = new THREE.Vector3()
  const pole = new THREE.Vector3()
  const shoulder = new THREE.Vector3()
  const tmpGrip = new THREE.Vector3()
  const body = new THREE.Vector3()

  /**
   * Two straight lines and the moment between them.
   *
   * `A → B` is walked forwards at `WALK_YAW`; he stands at `B` to take hold;
   * `B → C` is backed along at `haulYaw`, facing the way he came. Each leg's
   * yaw is the leg's own direction, which is what makes the travel parallel to
   * the facing and the foot-lock exact.
   */
  const plan = {
    a: new THREE.Vector2(),
    b: new THREE.Vector2(),
    c: new THREE.Vector2(),
    walkDir: new THREE.Vector2(),
    haulFace: new THREE.Vector2(),
    haulYaw: 0,
    /** Grip point relative to the body's ground position, world axes. */
    grip: new THREE.Vector3(),
    walkPhase: 0,
    haulPhase: 0,
    /** Playback rate the two locomotion clips share, as a multiple of authored. */
    share: 1,
    /** What the choreography takes at the authored rate, seconds of clip. */
    natural: 0,
    walkStart: BEAT.turn,
    walkEnd: 0,
    reachStart: 0,
    contactAt: 0,
    haulStart: 0,
    haulEnd: 0,
  }

  /**
   * Lay the move out for the current viewport.
   *
   * Two fixed points, and the rest follows: the grip is at the right edge of
   * the frame when he takes hold — so the sheet is entirely off stage and
   * nothing has been slid on for him — and at the left edge when it is home.
   * His standing position is *derived* from where his hand has to be, not
   * chosen, and so is the length of the walk that gets him there.
   *
   * The reach is solved rather than picked: the arm has a length, the shoulder
   * is where the shoulder is, and `REACH_USE` says how much of that length a
   * comfortable reach spends. Any other standing position either leaves a gap
   * at the edge or locks the elbow.
   *
   * Iterated three times because the grip offset depends on the haul yaw, the
   * haul yaw depends on where `C` is, and `C` depends on the grip offset. It
   * converges in two.
   */
  const layOut = () => {
    plan.haulYaw = 1.45
    for (let pass = 0; pass < 3; pass += 1) {
      holder.position.set(0, 0, 0)
      holder.rotation.set(0, plan.haulYaw, 0)
      holder.updateWorldMatrix(true, true)
      joints.shoulderR.getWorldPosition(shoulder)

      const dy = -GRIP_DROP
      const dz = GRIP_FRONT
      const dx = Math.sqrt(Math.max(.04, armSpan * armSpan - dy * dy - dz * dz))
      plan.grip.set(shoulder.x + dx, shoulder.y + dy, shoulder.z + dz)

      const frameSpan = worldXAtFrame(1, plan.grip.y, 0) - worldXAtFrame(0, plan.grip.y, 0)
      const bite = frameSpan * (GRIP_BITE_PX / Math.max(1, context.width))

      plan.b.set(
        worldXAtFrame(COUNSEL_PULL_PARK / 100, plan.grip.y, PATH_Z.contact + plan.grip.z) + bite - plan.grip.x,
        PATH_Z.contact,
      )
      plan.c.set(
        worldXAtFrame(0, plan.grip.y, PATH_Z.release + plan.grip.z) + bite - plan.grip.x,
        PATH_Z.release,
      )
      plan.haulFace.set(plan.b.x - plan.c.x, plan.b.y - plan.c.y).normalize()
      plan.haulYaw = Math.atan2(plan.haulFace.x, plan.haulFace.y)
    }

    // He walks in at a fixed angle, so where he starts is wherever the walk
    // that gets him to `B` began — a consequence rather than a number someone
    // chose. It lands near centre frame, which is where slide 10 wants him.
    plan.walkDir.set(Math.sin(WALK_YAW), Math.cos(WALK_YAW))
    const walkSpan = WALK_DEPTH / plan.walkDir.y
    plan.a.set(plan.b.x - plan.walkDir.x * walkSpan, plan.b.y - plan.walkDir.y * walkSpan)
    plan.walkPhase = stride.Walk.phaseFor(walkSpan)

    const haulSpan = plan.b.distanceTo(plan.c)
    plan.haulPhase = stride.Run_Back.phaseFor(-haulSpan)

    // Split the clock between the two walks in proportion to how long each
    // would take at the rate its animator authored, so both come out at the
    // same multiple of their natural speed and neither reads as sped up while
    // the other drags.
    //
    // The rate itself comes from `WALK_CADENCE` rather than from the clock, and
    // that is the difference between this reading as walking and not. The
    // distances are set by geometry — how far he stands from the sheet, how far
    // the sheet travels — so they take a fixed number of strides, and dividing
    // the leftover clock by those strides is how the walk ended up at 1.25s a
    // cycle. A gait in gentle slow motion does not read as a person walking, it
    // reads as floating. Time left over after walking at a walking pace goes
    // where leftover time belongs: into standing still at the end.
    //
    // Faster than asked is allowed, and only if the clock demands it, so that
    // shortening `COUNSEL_PULL_MS` can never leave him mid-haul when the stage
    // is torn down. Slower than asked is not allowed at all.
    const still = BEAT.turn + BEAT.reach + BEAT.grip + BEAT.settle
    const natural = plan.walkPhase * stride.Walk.duration
      + plan.haulPhase * stride.Run_Back.duration
    const moving = Math.max(.4, TOTAL - still)
    const share = Math.min(
      WALK_CADENCE / Math.max(1e-6, stride.Walk.duration),
      moving / Math.max(1e-6, natural),
    )
    plan.share = share
    plan.natural = natural
    plan.walkEnd = plan.walkStart + plan.walkPhase * stride.Walk.duration * share
    plan.reachStart = plan.walkEnd - BEAT.reachLead
    plan.contactAt = plan.walkEnd + BEAT.reach
    plan.haulStart = plan.contactAt + BEAT.grip
    plan.haulEnd = plan.haulStart + plan.haulPhase * stride.Run_Back.duration * share
  }

  // --- state -----------------------------------------------------------------
  let clock = 0
  let startedAt = 0
  let sceneClock = 0
  let running = false
  let gripWeight = 0
  let curlWeight = 0
  let slideTx = COUNSEL_PULL_PARK
  let contactTx = COUNSEL_PULL_PARK
  let phaseName = 'idle'
  let handScreen = { x: 0, y: 0 }
  let edgeX = 0
  let footSlide = 0
  let footSlidePeak = 0
  let footSlideBlend = 0
  let torsoOverHips = 0
  let torsoPeak = 0
  let torsoLean = 0
  let leanPeak = 0
  let chestPitch = 0
  let headPitch = 0
  let footY = 0
  let hitches = 0
  let measured = 0
  let gripMiss = 0
  let gripMissPeak = 0
  let reachPeak = 0

  /**
   * Is the picture moving smoothly, in numbers.
   *
   * Not "how fast is it going" but "how evenly": for each of the two things
   * the eye can see travelling — the sheet's edge across the screen, and the
   * camera through the world — this keeps the change in *speed* from one frame
   * to the next. Something under a smooth ease changes speed by a few pixels
   * per second per frame; something positioned from a noisy signal changes it
   * by hundreds, sign alternating, and that is exactly what shudder is.
   *
   * Speed rather than step, because a frame that took twice as long covers
   * twice the ground legitimately, and a step-based figure counts that as a
   * lurch. It made the number report the machine's load as much as the motion:
   * two vsyncs in one frame is common, harmless, and was dominating the peak.
   *
   * Peak and mean are both kept because they answer different questions. One
   * bad frame at the click is a peak; a picture that never settles is a mean.
   */
  const stability = {
    edgePrev: 0,
    edgeSpeed: 0,
    edgeJerkPeak: 0,
    edgeJerkSum: 0,
    camPrev: new THREE.Vector3(),
    camSpeed: 0,
    camJerkPeak: 0,
    camJerkSum: 0,
    frames: 0,
    /** Frames whose delta was more than two and a half at 60Hz. */
    dropped: 0,
    deltaMax: 0,
    started: false,
  }

  const resetStability = () => {
    stability.edgeJerkPeak = 0
    stability.edgeJerkSum = 0
    stability.camJerkPeak = 0
    stability.camJerkSum = 0
    stability.frames = 0
    stability.dropped = 0
    stability.deltaMax = 0
    stability.started = false
  }

  const tmpCam = new THREE.Vector3()
  const trackStability = (delta: number) => {
    camera.getWorldPosition(tmpCam)
    if (!stability.started || delta <= 0) {
      stability.started = true
      stability.edgePrev = edgeX
      stability.edgeSpeed = 0
      stability.camPrev.copy(tmpCam)
      stability.camSpeed = 0
      return
    }
    const edgeSpeed = (edgeX - stability.edgePrev) / delta
    const camSpeed = tmpCam.distanceTo(stability.camPrev) / delta
    const edgeJerk = Math.abs(edgeSpeed - stability.edgeSpeed)
    const camJerk = Math.abs(camSpeed - stability.camSpeed)
    stability.edgePrev = edgeX
    stability.edgeSpeed = edgeSpeed
    stability.camPrev.copy(tmpCam)
    stability.camSpeed = camSpeed
    stability.deltaMax = Math.max(stability.deltaMax, delta)
    // A frame that took three times as long covers three times the ground, and
    // its step is three times the last one's through no fault of the motion.
    // Counting that as shudder would mean this number mostly reported how busy
    // the machine was — and under the screenshot harness, which stalls the page
    // by design, it read 25 against a true 0.5. Stalls are counted instead, so
    // a run too broken up to judge says so rather than failing for it.
    if (delta > HITCH) {
      stability.dropped += 1
      return
    }
    stability.frames += 1
    stability.edgeJerkPeak = Math.max(stability.edgeJerkPeak, edgeJerk)
    stability.edgeJerkSum += edgeJerk
    stability.camJerkPeak = Math.max(stability.camJerkPeak, camJerk)
    stability.camJerkSum += camJerk
  }
  const tmpAxis = new THREE.Vector3()
  const tmpSpin = new THREE.Quaternion()
  const tmpFacing = new THREE.Quaternion()

  /** Forward pitch of a joint's own long axis, in degrees, in the body frame. */
  const pitchOf = (node: THREE.Object3D) => {
    node.getWorldQuaternion(tmpSpin)
    holder.getWorldQuaternion(tmpFacing).invert()
    tmpAxis.set(0, 1, 0).applyQuaternion(tmpSpin).applyQuaternion(tmpFacing)
    return THREE.MathUtils.radToDeg(Math.atan2(tmpAxis.z, tmpAxis.y))
  }
  let plantedFoot: 'L' | 'R' | null = null
  const plantAnchor = new THREE.Vector3()
  const tmpLeft = new THREE.Vector3()
  const tmpRight = new THREE.Vector3()
  const tmpHips = new THREE.Vector3()
  const tmpChest = new THREE.Vector3()
  const tmpPair = new THREE.Vector3()

  const setWeights = (idle: number, walk: number, back: number) => {
    actions.Idle_Neutral.weight = THREE.MathUtils.clamp(idle, 0, 1)
    actions.Walk.weight = THREE.MathUtils.clamp(walk, 0, 1)
    actions.Run_Back.weight = THREE.MathUtils.clamp(back, 0, 1)
  }

  const writeSlide = (tx: number) => {
    slideTx = THREE.MathUtils.clamp(tx, 0, 100)
    const layer = slideLayer()
    if (layer) layer.style.transform = `translate3d(${slideTx}%,0,0)`
    edgeX = (slideTx / 100) * Math.max(1, context.width)
  }

  const place = (x: number, z: number, yaw: number) => {
    body.set(x, 0, z)
    holder.position.copy(body)
    holder.rotation.set(0, yaw, 0)
    key.position.set(x - 7.2, 11.5, z + 7.4)
    key.target.position.set(x + 1.2, 1.8, z)
    bounce.target.position.set(x, 1.8, z)
    key.updateMatrixWorld(true)
    key.target.updateMatrixWorld(true)
    holder.updateWorldMatrix(true, true)
  }

  /** Bend the arm so the hand lands on the sheet's edge. */
  const holdGrip = (weight: number) => {
    if (weight <= 0) return
    joints.shoulderR.getWorldPosition(shoulder)
    // Elbow low, a little upstage and inboard: a man taking hold of something
    // at chest height in front of him does not put his elbow out sideways.
    pole.set(shoulder.x - .7, shoulder.y - 2.4, shoulder.z - 1.5)
    arm.solve(gripTarget, pole, weight)
  }

  const restPose = () => {
    setWeights(1, 0, 0)
    actions.Idle_Neutral.time = sceneClock % actions.Idle_Neutral.getClip().duration
    place(plan.a.x, plan.a.y, REST_YAW)
    mixer.update(0)
    model.setGrip(0)
  }

  const perform = (t: number) => {
    let x = plan.a.x
    let z = plan.a.y
    let yaw = WALK_YAW

    if (t < plan.walkStart) {
      phaseName = 'turn'
      // Pivoting in place. Nothing translates, so nothing can slide except the
      // feet shuffling round, which is what turning on the spot is.
      yaw = THREE.MathUtils.lerp(REST_YAW, WALK_YAW, smoothstep(t / plan.walkStart))
      // The idle→walk cross-fade is spent *here*, inside the pivot, rather
      // than over the first strides. For the length of a fade the legs are an
      // average of two clips and the planted sole goes wherever the
      // interpolation puts it; doing that while the body is covering ground
      // was the whole of this scene's measured blend scuff. Doing it while he
      // turns on the spot costs nothing, because a foot that moves during a
      // pivot is a foot pivoting.
      //
      // The walk is held at the start of its cycle throughout, so this is a
      // blend between two *still* poses rather than into a moving one, and the
      // legs only begin cycling at `walkStart` — by which point the clip
      // already owns them outright and the first stride is the clip's own.
      actions.Walk.time = 0
      setWeights(1 - smoothstep(t / plan.walkStart), smoothstep(t / plan.walkStart), 0)
    } else if (t < plan.walkEnd) {
      phaseName = 'walk'
      const span = plan.walkEnd - plan.walkStart
      const phase = eased(t - plan.walkStart, span, plan.walkPhase)
      const travelled = stride.Walk.at(phase)
      x = plan.a.x + plan.walkDir.x * travelled
      z = plan.a.y + plan.walkDir.y * travelled
      actions.Walk.time = (phase % 1) * actions.Walk.getClip().duration
      setWeights(0, 1, 0)
    } else if (t < plan.contactAt) {
      phaseName = 'reach'
      const u = (t - plan.walkEnd) / BEAT.reach
      x = plan.b.x
      z = plan.b.y
      yaw = THREE.MathUtils.lerp(WALK_YAW, plan.haulYaw, smoothstep(u))
      setWeights(1, Math.max(0, 1 - u * 2.6), 0)
    } else if (t < plan.haulStart) {
      phaseName = 'grip'
      x = plan.b.x
      z = plan.b.y
      yaw = plan.haulYaw
      setWeights(1, 0, 0)
      gripWeight = 1
      curlWeight = .5 + smoothstep((t - plan.contactAt) / BEAT.grip) * .5
    } else if (t < plan.haulEnd) {
      phaseName = 'haul'
      yaw = plan.haulYaw
      const span = plan.haulEnd - plan.haulStart
      const phase = eased(t - plan.haulStart, span, plan.haulPhase)
      // `Run_Back` is authored as a backpedal — the feet go forwards and the
      // body goes the other way — so its stride is negative and this walks him
      // back down his own facing without the clip being run in reverse.
      const travelled = stride.Run_Back.at(phase)
      x = plan.b.x + plan.haulFace.x * travelled
      z = plan.b.y + plan.haulFace.y * travelled
      actions.Run_Back.time = (phase % 1) * actions.Run_Back.getClip().duration
      const on = smoothstep((t - plan.haulStart) / BEAT.blend)
      setWeights(1 - on, 0, on)
      gripWeight = 1
      curlWeight = 1
    } else {
      phaseName = 'settle'
      x = plan.c.x
      z = plan.c.y
      yaw = plan.haulYaw
      const off = smoothstep((t - plan.haulEnd) / BEAT.blend)
      setWeights(off, 0, 1 - off)
      gripWeight = 1
      curlWeight = 1
    }

    // The reach is a ramp over the clock, not a phase of its own: it starts
    // `reachLead` before his feet stop and runs through the last strides of the
    // walk, because that is when a person reaches for a thing they are walking
    // up to. The fingers only start closing once the hand is nearly there.
    if (t >= plan.contactAt) {
      gripWeight = 1
    } else if (t >= plan.reachStart) {
      gripWeight = smoothstep((t - plan.reachStart) / (plan.contactAt - plan.reachStart))
      curlWeight = smoothstep((gripWeight - .55) / .45) * .5
    } else {
      gripWeight = 0
      curlWeight = 0
    }

    actions.Idle_Neutral.time = sceneClock % actions.Idle_Neutral.getClip().duration
    place(x, z, yaw)
    mixer.update(0)

    // Bracing against the load. Small, and only while there is one — it eases
    // out again across the settle, because the sheet is home by then and a man
    // still leaning away from a weight he is no longer carrying is a man
    // frozen mid-effort.
    //
    // Backwards, not sideways. The load is in front of him and he is walking
    // away from it, so what a body does is settle its weight back against the
    // line of the pull — which is the sagittal plane. This used to be a Z
    // rotation, leaning him *across* himself: about six centimetres of
    // shoulder sitting outboard of the hip, for the whole haul, which is the
    // shear this rig has failed review for before and which no amount of
    // pulling actually produces. Same size, same ramp, correct axis.
    if (t >= plan.haulStart) {
      const load = smoothstep((t - plan.haulStart) / .4)
        * (1 - smoothstep((t - plan.haulEnd) / BEAT.blend))
      joints.torso.rotateX(-.06 * load)
      joints.chest.rotateX(-.04 * load)
      joints.torso.updateWorldMatrix(false, true)
    }

    // Where he is standing when the fingers close decides where the sheet's
    // edge is from then on, and nothing else touches it: the grip point is
    // rigid to his body through the whole haul, so the paper travels because he
    // does. There is no second curve for it. Before he arrives the target is
    // the arrival point rather than a body-relative offset, so the hand
    // converges on a fixed spot while he walks up to it instead of carrying a
    // moving one along with him.
    if (t < plan.contactAt) gripTarget.set(plan.b.x + plan.grip.x, plan.grip.y, plan.b.y + plan.grip.z)
    else gripTarget.set(x + plan.grip.x, plan.grip.y, z + plan.grip.z)

    holdGrip(gripWeight)
    model.setGrip(curlWeight)

    arm.effector(tmpGrip)
    // How far the solved hand ended up from where it was asked to be. Should
    // be zero: the whole sheet is positioned from this point.
    if (gripWeight > .99) {
      gripMiss = tmpGrip.distanceTo(gripTarget)
      gripMissPeak = Math.max(gripMissPeak, gripMiss)
      reachPeak = Math.max(reachPeak, arm.reachRatio)
    }
    handScreen = projectPoint(tmpGrip)
    if (t >= plan.contactAt) {
      // The edge sits `GRIP_BITE_PX` to the *left* of the fingers, which is
      // what puts the fingers behind the sheet rather than on its face. It also
      // has to be here rather than only in the layout, or the sheet comes to
      // rest with its edge under his hand instead of at the frame edge.
      const edge = handScreen.x - GRIP_BITE_PX
      writeSlide((edge / Math.max(1, context.width)) * 100)
      if (phaseName === 'grip') contactTx = slideTx
    } else {
      writeSlide(COUNSEL_PULL_PARK)
      contactTx = COUNSEL_PULL_PARK
    }

    const near = THREE.MathUtils.clamp(1 - slideTx / 100, 0, 1)
    fill.intensity = .42 + near * .26
    rim.intensity = .38 + near * .12
  }

  /**
   * A frame this long did not run on time.
   *
   * Two and a half frames at 60Hz. The first frame after the click is the one
   * that does it: the transition is being set up, slide 11's layer is being
   * built and animated, and the scene's own clock is the wall clock — so the
   * body legitimately arrives a fifth of a metre further on than the frame
   * before. The planted sole moves with it, and a drift measurement that
   * counted that would be reporting the browser's stall as the walk's skate,
   * at seven times the real figure.
   *
   * Stalls are counted rather than ignored, so a run that dropped so many
   * frames that the measurement stopped meaning anything says so.
   */
  const HITCH = .04

  const trackPlant = (delta: number) => {
    joints.footL.getWorldPosition(tmpLeft)
    joints.footR.getWorldPosition(tmpRight)
    // The lower ankle's height above the deck. `bodyY` says where the holder
    // was put and `soleRest` says where the shoe bottom sits when he stands;
    // this is the one that moves, so it is the one that would show a step up
    // or a hover if a clip, a bake or a reload ever disagreed about the floor.
    footY = Math.min(tmpLeft.y, tmpRight.y)
    const onLeft = tmpLeft.y < tmpRight.y
    const next: 'L' | 'R' = onLeft ? 'L' : 'R'
    const foot = onLeft ? tmpLeft : tmpRight
    // The lower foot is not the same thing as a foot on the floor, and the
    // difference is the whole of what this used to report. `Run_Back` is a run:
    // it has a flight phase where neither foot is down and the lower one is
    // merely the less airborne, travelling at swing speed. Measuring that as
    // drift said the sole skated a third of a metre, which is the swing of a
    // leg, faithfully measured, and nothing whatever to do with foot-lock.
    if (footY > standAnkle + CONTACT_BAND) {
      plantedFoot = null
      footSlide = 0
      return
    }
    if (next !== plantedFoot) {
      plantedFoot = next
      plantAnchor.copy(foot)
      footSlide = 0
      return
    }
    footSlide = Math.hypot(foot.x - plantAnchor.x, foot.z - plantAnchor.z)
    // Only while a locomotion clip is carrying the legs outright. Inside a
    // cross-fade the pose is a blend of two clips and the feet are wherever the
    // interpolation puts them, which is a real thing that happens on screen but
    // is not the number this is asking about: whether the walk itself skates.
    // The blend is reported on its own as `footSlideBlend`.
    const solo = actions.Walk.weight > .95 || actions.Run_Back.weight > .95
    // Outside locomotion, keep the anchor under the foot. He pivots seventy
    // degrees on the spot before he sets off and stands still twice more after
    // that, and all three move the soles by design. Leaving the anchor where
    // it was would hand the walk's first measured frame the whole of the
    // pivot's displacement and report it as scuff the walk did not cause —
    // which is exactly what it did, at three times the real figure, until the
    // cross-fade moved into the turn and stopped masking it.
    if (phaseName !== 'walk' && phaseName !== 'haul') {
      plantAnchor.copy(foot)
      footSlide = 0
      return
    }
    if (delta > HITCH) {
      hitches += 1
      plantAnchor.copy(foot)
      footSlide = 0
      return
    }
    measured += 1
    if (!solo) {
      footSlideBlend = Math.max(footSlideBlend, footSlide)
      // Re-anchor on the way out of the fade, so the drift the blend caused is
      // not still being carried once one clip owns the legs again.
      plantAnchor.copy(foot)
      return
    }
    footSlidePeak = Math.max(footSlidePeak, footSlide)
  }

  /**
   * How far the shoulders sit off the hips, in the body's own axes.
   *
   * Between the two *pairs* of joints rather than between the chest and the
   * pelvis, because on this rig those two are the same point: the spine and
   * chest groups hang off the hips at zero offset and only carry rotation, so
   * a chest-versus-hips reading is the constant zero and would pass this test
   * no matter what the body did. The shoulder line against the hip line is the
   * thing the eye is actually judging, and it exists on any rig.
   *
   * Split into the two components rather than reported as a distance, because
   * they are not the same news. Fore-and-aft is *lean*: a walking body carries
   * its shoulders ahead of its hips and one hauling a load leans away from it,
   * and a number that forbade that would be asking for a mannequin. Sideways
   * is the shear this scene keeps failing on — a pelvis yawing out from under
   * a chest that is still facing the lens — and that one is not allowed.
   */
  const measureStack = () => {
    joints.shoulderL.getWorldPosition(tmpChest)
    joints.shoulderR.getWorldPosition(tmpPair)
    tmpChest.add(tmpPair).multiplyScalar(.5)
    joints.hipL.getWorldPosition(tmpHips)
    joints.hipR.getWorldPosition(tmpPair)
    tmpHips.add(tmpPair).multiplyScalar(.5)
    holder.worldToLocal(tmpChest)
    holder.worldToLocal(tmpHips)
    torsoOverHips = Math.abs(tmpChest.x - tmpHips.x)
    torsoLean = tmpChest.z - tmpHips.z
    if (running && torsoOverHips > torsoPeak) torsoPeak = torsoOverHips
    if (running && Math.abs(torsoLean) > Math.abs(leanPeak)) leanPeak = torsoLean

    // Degrees the chest and the head are pitched out of upright, in the body's
    // own sagittal plane. Positive is forward. A walk carries a few of these
    // and a haul a few more; twenty of them is a stoop, which is the note this
    // scene came back with the last time nobody was counting.
    chestPitch = pitchOf(joints.chest)
    headPitch = pitchOf(joints.head)
  }

  const reset = () => {
    running = false
    clock = 0
    gripWeight = 0
    curlWeight = 0
    contactTx = COUNSEL_PULL_PARK
    slideTx = COUNSEL_PULL_PARK
    phaseName = 'idle'
    plantedFoot = null
    footSlide = 0
    footSlidePeak = 0
    footSlideBlend = 0
    torsoPeak = 0
    leanPeak = 0
    hitches = 0
    measured = 0
    fill.intensity = .42
    rim.intensity = .38
    restPose()
    const layer = slideLayer()
    if (layer && !layer.classList.contains('is-live')) layer.style.transform = ''
  }

  const start = () => {
    if (running) return
    running = true
    startedAt = context.frameTime
    clock = 0
    contactTx = COUNSEL_PULL_PARK
    plantedFoot = null
    footSlidePeak = 0
    footSlideBlend = 0
    torsoPeak = 0
    leanPeak = 0
    hitches = 0
    measured = 0
    gripMissPeak = 0
    reachPeak = 0
    resetStability()
  }

  const snapToEnd = () => {
    running = true
    startedAt = context.frameTime - TOTAL * 1000
    clock = TOTAL
    const layer = slideLayer()
    if (layer) layer.style.transform = 'translate3d(0,0,0)'
  }

  const probe = () => ({
    elapsed: Number(sceneClock.toFixed(3)),
    t: Number(clock.toFixed(3)),
    phase: phaseName,
    running,
    /** The planted sole's drift in world units since it went down. */
    footSlide: Number(footSlide.toFixed(4)),
    footSlidePeak: Number(footSlidePeak.toFixed(4)),
    /** Locomotion frames that ran on time, and those that did not. */
    measured,
    hitches,
    /** Frame-to-frame smoothness of the two things that visibly travel. */
    stability: {
      frames: stability.frames,
      dropped: stability.dropped,
      deltaMax: Number(stability.deltaMax.toFixed(4)),
      /** Change in the sheet edge's speed, CSS px/s, frame over frame. */
      edgeJerkPeak: Number(stability.edgeJerkPeak.toFixed(2)),
      edgeJerkMean: Number((stability.edgeJerkSum / Math.max(1, stability.frames)).toFixed(2)),
      /** Change in the camera's speed, world units/s, frame over frame. */
      camJerkPeak: Number(stability.camJerkPeak.toFixed(4)),
      camJerkMean: Number((stability.camJerkSum / Math.max(1, stability.frames)).toFixed(5)),
    },
    /** Peak drift while a cross-fade owns the legs rather than one clip. */
    footSlideBlend: Number(footSlideBlend.toFixed(4)),
    /** Sideways offset of the shoulder line from the hip line. Shear. */
    torsoOverHips: Number(torsoOverHips.toFixed(4)),
    torsoPeak: Number(torsoPeak.toFixed(4)),
    /** Fore-and-aft offset of the same two lines. Lean, and allowed. */
    torsoLean: Number(torsoLean.toFixed(4)),
    leanPeak: Number(leanPeak.toFixed(4)),
    /** Degrees the chest and head are pitched forward out of upright. */
    chestPitch: Number(chestPitch.toFixed(1)),
    headPitch: Number(headPitch.toFixed(1)),
    bodyX: Number(body.x.toFixed(3)),
    bodyY: Number(holder.position.y.toFixed(4)),
    bodyZ: Number(body.z.toFixed(3)),
    /** World height of the lower ankle. Moves; should not drift between runs. */
    footY: Number(footY.toFixed(4)),
    /** World height of the shoe bottom at rest. The ground plane, as stood on. */
    soleRest: Number(model.soleRest.toFixed(4)),
    handX: Number(handScreen.x.toFixed(1)),
    handY: Number(handScreen.y.toFixed(1)),
    edgeX: Number(edgeX.toFixed(1)),
    /** Positive means the fingers are past the edge, behind the sheet. */
    bite: Number((handScreen.x - edgeX).toFixed(1)),
    slideTx: Number(slideTx.toFixed(2)),
    contactTx: Number(contactTx.toFixed(2)),
    /** Share of the sheet's journey his hand carried. */
    handDriven: Number((contactTx > 0 ? (contactTx - slideTx) / contactTx : 1).toFixed(4)),
    gripWeight: Number(gripWeight.toFixed(3)),
    /** World units the solved hand missed its target by, while gripping. */
    gripMiss: Number(gripMiss.toFixed(4)),
    gripMissPeak: Number(gripMissPeak.toFixed(4)),
    reachPeak: Number(reachPeak.toFixed(4)),
    figureHeight: Number(model.height.toFixed(3)),
    plan: {
      a: [Number(plan.a.x.toFixed(2)), Number(plan.a.y.toFixed(2))],
      b: [Number(plan.b.x.toFixed(2)), Number(plan.b.y.toFixed(2))],
      c: [Number(plan.c.x.toFixed(2)), Number(plan.c.y.toFixed(2))],
      walkYaw: Number(WALK_YAW.toFixed(3)),
      haulYaw: Number(plan.haulYaw.toFixed(3)),
      grip: plan.grip.toArray().map((v) => Number(v.toFixed(2))),
      walkPhase: Number(plan.walkPhase.toFixed(3)),
      haulPhase: Number(plan.haulPhase.toFixed(3)),
      walkStart: Number(plan.walkStart.toFixed(2)),
      walkEnd: Number(plan.walkEnd.toFixed(2)),
      contactAt: Number(plan.contactAt.toFixed(2)),
      haulStart: Number(plan.haulStart.toFixed(2)),
      haulEnd: Number(plan.haulEnd.toFixed(2)),
      strideWalk: Number(stride.Walk.cycle.toFixed(3)),
      strideBack: Number(stride.Run_Back.cycle.toFixed(3)),
      walkCycleSec: Number(stride.Walk.duration.toFixed(3)),
      backCycleSec: Number(stride.Run_Back.duration.toFixed(3)),
      share: Number(plan.share.toFixed(3)),
      natural: Number(plan.natural.toFixed(3)),
      /** Steps, counting two to a cycle. */
      steps: Number(((plan.walkPhase + plan.haulPhase) * 2).toFixed(2)),
      total: TOTAL,
    },
  })
  registerProbe('__deckCounselStage', probe)

  camera.updateMatrixWorld(true)
  layOut()
  restPose()

  return {
    scene,
    camera,
    grade: {
      flatten: 0,
      grain: .014,
      inkStrength: .2,
      // High enough that a navy that changes by a tenth over the width of the
      // frame does not contour, and grain rather than nothing so what steps are
      // left are dithered. At 24 with no grain the cyc wash showed a hard
      // horizontal line across the empty half of the stage.
      bands: 56,
      saturation: 1.04,
    },

    update(delta, elapsed) {
      sceneClock = elapsed
      // Before anything is projected, not after: `Vector3.project` reads
      // `camera.matrixWorldInverse`, which the renderer only refreshes inside
      // `render()` — so without this the sheet's edge would be written from
      // last frame's camera.
      // Pointer is ignored: this framing's parallax is 0. Passing the live
      // pointer would still be a no-op, but a zero keeps the contract obvious.
      rig.update(delta, { x: 0, y: 0 })
      camera.updateMatrixWorld(true)
      if (running) {
        // Wall time, not accumulated frame deltas. The DOM half of this
        // transition — the fade on slide 10, the teardown at
        // `COUNSEL_PULL_MID` — is driven by WAAPI and by `setTimeout`, both of
        // which run on the wall clock. Summing deltas drifts behind it under
        // any frame drop, and the drift is not cosmetic: it ends with the
        // stage being torn down while the hand is still mid-haul, and the last
        // tenth of the sheet's travel arriving as a snap.
        //
        // The frame's own timestamp rather than `performance.now()`, though.
        // Both are the same clock, so neither drifts against WAAPI; but this
        // one is read once at the frame boundary and is evenly spaced, where
        // the other returns whenever this line happened to run and carries the
        // scheduler's noise into the body's position — and from there into the
        // sheet's transform, since the sheet is written from his hand.
        clock = Math.min(TOTAL, (context.frameTime - startedAt) / 1000)
        perform(clock)
      } else {
        restPose()
      }
      if (veilFade < 1) {
        veilFade = Math.min(1, veilFade + delta / .34)
        const rest = 1 - veilFade
        ;(veil.material as THREE.MeshBasicMaterial).opacity = rest * rest
      }
      trackPlant(delta)
      measureStack()
      trackStability(delta)
    },

    resize(width, height) {
      rig.resize(width, height)
      rig.update(0, { x: 0, y: 0 })
      camera.updateMatrixWorld(true)
      layOut()
    },

    setParams(params) {
      if (params.fadeIn) {
        veilFade = 0
        ;(veil.material as THREE.MeshBasicMaterial).opacity = 1
      }
    },

    setFraming(name, immediate) {
      if (name === 'grab-pull' || name === 'walk-off') {
        veilFade = 1
        ;(veil.material as THREE.MeshBasicMaterial).opacity = 0
        if (context.reduced) snapToEnd()
        else start()
        return
      }
      rig.go(name, immediate, 1.2)
      if (immediate) {
        registerProbe('__deckCounselStage', probe)
        rig.update(0, { x: 0, y: 0 })
        camera.updateMatrixWorld(true)
        layOut()
        reset()
      }
    },

    dispose() {
      withdrawProbe('__deckCounselStage', probe)
      model.dispose()
      disposeTree(scene)
    },
  }
}
