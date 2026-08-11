import * as THREE from 'three'

import { HumanoidActor } from '../app-art/rig'
import { buildStylizedCounsel, type StylizedCounselRig } from '../app-art/stylized-counsel'

/**
 * ORPHANED. KEPT FOR THE FOLD.
 *
 * The closing slide is no longer the built office. The founders replaced the
 * whole ending with a bare blue room, one character stage right, lit from the
 * right with real floor shadows, copy stage left and "Questions?" on it — which
 * moots this file's placement, its camera argument and the ceiling band that
 * used to hang off it. The seam this plugged into (`OfficeThreeProps.foreground`
 * in `app-art/office-three`, plus the wiring in `office-scene`,
 * `app-scene-layer` and `engine/use-deck`) has been reverted, so nothing
 * imports any of this and it is untracked.
 *
 * It is left on disk for one reason: `FOLD_POSE` and `applyFold` below are a
 * *verified* arms-cross on this rig, and the arms-cross is the one part of the
 * new brief that carries real risk. Everything from `FOLD_POSE` to the bottom
 * of `step` transfers to any scene that has a `StylizedCounselRig` and a
 * `HumanoidActor` driving it; nothing above it does. Frames of the pose from
 * three bearings are in `.deck-shots/hero/p05`.
 *
 * What follows is the original header, kept because the reasoning about why the
 * fold is a pose layer rather than a clip is what makes it portable.
 *
 * ---
 *
 * THE HERO COUNSEL IN THE FOREGROUND OF THE BUILT OFFICE — slide 23, the close.
 *
 * The closing frame is the app's tier-14 floor: the firm the student has been
 * earning for the whole talk, in the product's own art, held on screen for the
 * entire question period. As built it had sixteen people in it and no subject.
 * Sixteen people at work is a *place*; a place is not a thing an audience looks
 * at for twenty minutes, and the founders' word for it was "generic".
 *
 * The fix is not a second camera. It was tested: `cameraOrbit` in
 * `office-three.tsx` is distance *back* from the pivot, so closing it walks the
 * lens into the room, and the columns, partitions and wall panels are dressed
 * and lit for exactly one viewpoint — they are unlit from behind because
 * nothing was ever meant to see them. Four authored angles were shot and all
 * four were worse than the default; the closest was almost entirely the inside
 * of a column. The home camera stays.
 *
 * What the frame is missing is a *subject*, so this puts one in the foreground
 * of the camera that already exists: one counsel, standing near the lens, on
 * clear rug rather than among the columns, addressed to the room with the
 * practice working behind her. She also settles two older debts. The deck's
 * counsel had a verified arrival gesture on the doorways close that the office
 * swap orphans, and the founders' original brief asked for "the real lawyer
 * character human being (in portrait) uniquely integrated into one of the
 * slides", which has never been delivered anywhere in the deck. This is it.
 *
 * ## Not new machinery
 *
 * `buildStylizedCounsel` is the same function that dresses all sixteen people
 * already in this room and every pedestrian on the map, and `HumanoidActor` is
 * the same animation system that drives them. She is built at the cast's own
 * render scale, which means she shares their geometry cache, which in turn
 * means she can be folded into the room's `OfficeCastBatch` and costs the
 * frame almost nothing — see `bodies` below.
 *
 * ## Why there is no `HumanoidBehaviorDirector`
 *
 * Every other counsel in the deck has one, and the reason this one must not is
 * the arms. Her settled pose is a *held* `foldArms`, and the director's job is
 * to fire ambient beats — `glance`, `handToChin`, `stretch` — each of which
 * calls `playGesture` and so fades the fold out from under her. A director and
 * a held pose are the same slot.
 *
 * What the director actually buys is the appearance of life over a long hold,
 * and that is bought here instead, from three sources that do not touch the
 * gesture slot: the base looping clip keeps running underneath the additive
 * fold (breath, weight shift, and the rig's own playback-rate wander, which is
 * what stops a looping idle from repeating exactly), the look target drifts
 * between three places a person answering questions would look, and the blink
 * is driven outside the rig entirely, as it is for every body in this room.
 *
 * The four ordering rules of `rig/ADOPTION.md` are obeyed and annotated below.
 */

/** What `office-three.tsx` hands a foreground actor when it builds the room. */
export type OfficeForegroundContext = {
  /**
   * The room group. Its world Y is the floor — the room sits at -0.08 — and
   * `HumanoidActor` treats the holder's world Y as the ground plane, so a body
   * parented here and left at local y 0 stands on the floor rather than in it.
   */
  room: THREE.Object3D
  camera: THREE.PerspectiveCamera
  reduced: boolean
  /** The headquarters tier actually built, 0..14. */
  level: number
  /** Wall to wall, in room units. Grows with the tier. */
  roomWidth: number
  /**
   * The room's own palette, so anything added here is made of what the room is
   * made of rather than of a second set of materials that nearly match. It also
   * keeps the draw call count flat: the room batcher merges by material, and a
   * new material is a new batch.
   */
  materials: {
    darkWood: THREE.Material
    brass: THREE.Material
    charcoal: THREE.Material
    glow: THREE.Material
  }
  /**
   * The room's geometry intern. Same key, same buffer — which is the difference
   * between a rank of repeated beams costing one geometry and costing eleven.
   */
  geometry: <T extends THREE.BufferGeometry>(key: string, build: () => T) => T
}

export type OfficeForegroundActor = {
  /**
   * Rig roots for the room's cast batch to draw.
   *
   * Returned rather than drawn independently. A counsel is about 58 meshes; at
   * the cast's own render scale every one of those is a geometry the sixteen
   * staff have already cut, so folding her into the existing batches costs
   * one instance per part and, measured, no new draw call at all. Left out of
   * the batch she would be 58 extra submissions on the heaviest slide in the
   * deck.
   */
  bodies: THREE.Object3D[]
  update(delta: number, elapsed: number): void
  dispose(): void
}

export type OfficeForegroundFactory = (context: OfficeForegroundContext) => OfficeForegroundActor | null

/**
 * Where she stands, and why there.
 *
 * Authored in room coordinates rather than derived from the camera, because
 * the camera's home is itself derived from headcount and a placement computed
 * from it would move every time somebody was hired. These numbers were set
 * against captured frames.
 *
 * `x` is positive — she is right of centre — for a reason that is not
 * composition: the closing copy sits on a dark plate at the *lower left* of
 * this slide (see `styles/deck.css`), so the one part of the frame she must
 * not be in is the one she would naturally fall into. Right of centre also
 * puts her on the near-right corner of the rug, which is the largest piece of
 * clear, evenly lit floor in the room, and leaves the depth of the firm
 * running away behind her left shoulder.
 *
 * `z` was swept. Nearer than about 1.4 and the shot loses her feet over the
 * bottom edge, because a camera pitched down into a room puts a near figure
 * low in the frame; further back than about 0.5 and she is the same apparent
 * size as the staff and stops being the subject. At 1.0 she stands about a
 * third of the frame tall against staff heads a twentieth of it, feet just
 * inside the bottom edge.
 */
const HERO = {
  x: 2.05,
  z: 1,
  /**
   * Body scale, and it is the cast's scale rather than a heroic one.
   *
   * She is a person in a room of people, so making her physically larger would
   * make her a giant, not a subject. What makes her the subject is that she is
   * two and a half metres from the lens and they are six or more, which is
   * perspective doing the work. 0.5 is also the rung `stylized-counsel`
   * quantises the office's 0.46 to, so she shares the cast's geometry cache
   * exactly — see `bodies`.
   */
  scale: .5,
  /**
   * Body yaw. She stands three-quarters to the lens rather than square to it.
   *
   * The rig faces +Z, and the camera sits forward and left of her, so square
   * to the lens is about -0.77. This is a third of a radian off that, which
   * keeps one shoulder open to the room behind her — the practice has to be
   * visible past her, not blocked by her — and leaves the head-and-chest turn
   * below something to do.
   */
  yaw: -.46,
} as const

/**
 * Where she is looking, in world space, and why not at the camera.
 *
 * "Facing forward" is the ask, but a person addressing a room is not a
 * mannequin aimed at a lens. `setLookTarget` turns the chest with the head —
 * the rig's own rule, and the reason a head-only turn reads as a puppet — so
 * pointing it at a place in front of her is what makes her *addressed to*
 * somebody rather than *pointed at* something.
 *
 * All three are at roughly her own eye height and beyond the camera, not at
 * it. The camera is two and a half metres above the floor of a room whose
 * people are half that; aiming her gaze at the lens tips her chin up thirty-odd
 * degrees, which reads as appeal rather than address. Level, out into the
 * room she is speaking to, is what a person taking a question does.
 *
 * Three of them, drifted between slowly, because this frame is up for the
 * whole question period and a gaze that never moves is the same failure as a
 * pose that never moves.
 */
const AUDIENCE: readonly THREE.Vector3[] = [
  new THREE.Vector3(.15, 2.32, 8.4),
  new THREE.Vector3(-2.4, 2.18, 7.2),
  new THREE.Vector3(1.9, 2.42, 8.8),
]

/**
 * THE FOLD.
 *
 * Six absolute joint rotations, in degrees, in each joint's own local frame,
 * XYZ order — the character's arms crossed. Applied over whatever the rig is
 * doing, at a weight this file ramps; see `foldCurve` and `applyFold`.
 *
 * ## Why this is a pose and not a clip
 *
 * The rig ships a `foldArms` beat and the first attempt at this used it. It
 * does not fold the arms. Shot from three bearings at two metres it puts both
 * fists up under the chin with the forearms vertical — a boxer's guard — and
 * the reason is that it flexes the elbows on the axis that swings a forearm
 * *forward*, with nothing rotating the humerus, so neither forearm can reach
 * the midline however far it bends.
 *
 * Re-authoring it as a clip was tried next and abandoned after three rounds of
 * measurement. A clip's channels are not what reaches the bone: the value is
 * blended additively onto the running idle, scaled by `EXPRESSION_SHARE` and
 * the actor's expression gain, composed with the character's own authored arm
 * rest (which on this rig rolls the shoulders in), then run through a
 * second-order lag and an anatomical clamp. Every one of those is right for an
 * ambient beat and all of them together mean the pose that arrives is not the
 * pose that was written. Measured in body space, the forearms authored to
 * cross the chest arrived *behind the back*: hands at z −0.28 on a torso whose
 * front face is at +0.3.
 *
 * A pose written straight into the bones is exactly the pose that arrives, and
 * it can be verified by reading the joints back — which is where these numbers
 * came from, by a solve against target hand and elbow positions rather than by
 * eye. It also leaves `app-art/rig/` completely untouched, which is worth more
 * than the convenience: that directory is a port of the product's character
 * system, and a deck agent editing a clip the app fires from two signature
 * repertoires is how a port stops being one.
 *
 * ## What is given up, and what replaces it
 *
 * A clip would keep breathing in the arms, because an additive delta rides on
 * a base state that goes on running. An absolute pose does not. Two things put
 * that back: the fold settles at `FOLD_SETTLE` rather than at 1, so a little
 * of the idle's own arm motion keeps coming through, and `FOLD_BREATH` moves
 * the shoulders a degree and a half on a slow period. Everything from the
 * chest down is untouched, so her weight shift, her stance and her look are
 * the rig's as before.
 */
const FOLD_POSE: ReadonlyArray<readonly [keyof StylizedCounselRig, number, number, number]> = [
  // Upper arms: down, forward off the ribs, and rotated about their own length.
  // That third number is the one that matters and the one `foldArms` has no
  // channel for — with the arm hanging, twisting the humerus is what turns the
  // elbow's hinge from swinging the forearm forward to swinging it across the
  // body.
  ['leftShoulder', -41.5, 80, 8.5],
  ['rightShoulder', -33, -100, -12],
  // Forearms, on the hinge. Both inside the rig's own anatomical limits for
  // these joints, with the largest, the left elbow's 90 degrees of flexion,
  // against a table that allows 146.
  ['leftElbow', -90, 6, 0],
  ['rightElbow', -92, 12, 18],
  // Hands turned in to follow the forearms round, so a palm lands against the
  // far upper arm instead of a fist hanging off the end of it.
  ['leftHand', -8, 0, 14],
  ['rightHand', -6, 0, -11],
]

/** Seconds the fold takes from her arms at her sides to settled. */
const FOLD_SECONDS = .62

/**
 * Where the blend settles.
 *
 * Short of 1 on purpose: the remaining eight per cent is the running idle's own
 * arm motion, which is what keeps a held pose from being a frozen one over the
 * length of a question period.
 */
const FOLD_SETTLE = .92

/** Degrees of shoulder movement, and its period in seconds, once folded. */
const FOLD_BREATH = { degrees: 1.5, period: 4.4 } as const

/**
 * The shape of the fold in time.
 *
 * A short load, because arms do not leave a body's sides at full speed, then a
 * fast travel that overshoots four per cent and settles back into it. The
 * overshoot is most of what separates "quick and fluid" from "snapped to a new
 * pose", and it is small enough not to read as a bounce.
 */
const FOLD_LOAD = .2
const FOLD_BACK = .62

function foldCurve(u: number) {
  if (u <= 0) return 0
  if (u >= 1) return 1
  const loaded = u < FOLD_LOAD ? (u / FOLD_LOAD) ** 2 * FOLD_LOAD : u
  const t = loaded - 1
  return 1 + (FOLD_BACK + 1) * t ** 3 + FOLD_BACK * t ** 2
}

/**
 * Seconds from the slide arriving.
 *
 * The fold begins *behind the foil plate*. `foil-seal` runs 1.18s and its plate
 * is fully opaque from 0.52 to 0.68, so the beat starts hidden and is already
 * a fifth of the way through when the plate lifts: the audience does not watch
 * her decide to move, they find her mid-gesture. That is the difference between
 * a slide that animates on arrival and one that was already alive when you got
 * to it, and it is the same 0.55 the doorways close used for its glance.
 *
 * It is also what makes re-entry clean. Her settled pose *is* the fold, so on
 * a second visit she is already folded when the slide arrives, and restarting
 * the clip has to snap her arms open for one frame before they close again.
 * At 0.52 that frame is behind an opaque plate.
 */
const FOLD_AT = .52

/** How long she holds one look before drifting to the next. */
const LOOK_HOLD = { min: 13, max: 27 } as const

/** And how long she holds one resting stance. */
const STANCE_HOLD = { min: 34, max: 58 } as const

/**
 * The hero, and the two signals the deck drives her with.
 *
 * `factory` is handed to `OfficeThreeScene`, which calls it once while the room
 * is being built. `arrive` and `finish` are called by the mount wrapper when
 * the slide carrying that room becomes, and stops being, the one on screen.
 * They are separate from the factory because a room is built well before it is
 * shown — the deck warms the next slide's scene a slide ahead — so timing the
 * arrival beat from the build would play it, in full, off-screen.
 */
export type OfficeHeroControl = {
  factory: OfficeForegroundFactory
  /** The slide is now on screen. Re-arms the arrival beat, every visit. */
  arrive: () => void
  /**
   * Put her in the settled pose, now.
   *
   * The counterpart of the transition layer's own `finish()`, and the same
   * argument: a presenter mashing the arrow keys must never be able to leave
   * something halfway. The fold is a one-shot, unlike the doorways glance it
   * replaces, so it genuinely can strand — and a figure with her arms halfway
   * through her chest on the last slide of the talk is the worst single frame
   * this deck could produce. Because her *resting* pose is the folded one,
   * jumping to it is always a correct answer, which makes every interrupted
   * frame either mid-fold or folded.
   */
  finish: () => void
}

type ArmTarget = { node: THREE.Object3D; quaternion: THREE.Quaternion }

const RAD = Math.PI / 180

export function createOfficeHeroControl(): OfficeHeroControl {
  let live: {
    actor: HumanoidActor
    rig: StylizedCounselRig
    holder: THREE.Group
    arms: ArmTarget[]
    dispose: () => void
  } | null = null

  /** Seconds since the slide arrived, or -1 while it is not on screen. */
  let clock = -1
  /**
   * Whether the slide is on screen, kept separately from the clock because the
   * two signals can arrive in either order. React runs a child's effects before
   * its parent's, and the room is built inside a lazily-imported child, so on a
   * cold arrival `arrive()` lands *before* the body exists — and on a warm one
   * the body exists long before `arrive()`. The factory reads this rather than
   * assuming it is the first of the pair.
   */
  let onScreen = false
  /** Seconds into the fold, or -1 before it has been asked for. */
  let foldAge = -1
  /** How much of `FOLD_POSE` is currently on the arms, 0 to `FOLD_SETTLE`. */
  let foldWeight = 0
  let lookIndex = 0
  let lookAt = 0
  let stanceAt = 0
  let stance: 'idle' | 'idleWeightShift' = 'idleWeightShift'
  /** Deterministic, so two runs of the deck are two identical runs. */
  let random = 0x2f6a1d

  const roll = () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    return random / 0x100000000
  }
  const between = (range: { min: number; max: number }) => range.min + roll() * (range.max - range.min)

  /**
   * Writes the fold onto the arms, after the actor has had its say.
   *
   * `slerp` rather than assignment, so the ramp is a real interpolation of
   * rotations and each joint travels along an arc rather than through one. The
   * source is whatever the rig has just posed, which means an interrupted fold
   * resumes from where the body actually is rather than snapping back to the
   * start of the move — and that the eight per cent this never takes is live
   * idle motion rather than a fixed offset.
   */
  const applyFold = (arms: ArmTarget[], weight: number, elapsed: number) => {
    if (weight <= 0) return
    for (const arm of arms) arm.node.quaternion.slerp(arm.quaternion, weight)
    if (weight < FOLD_SETTLE * .5) return
    // A breath, once there is a fold to breathe in. Both shoulders on the same
    // phase, because a breath lifts both, and the crossed arms are locked to
    // each other — this moves the whole block rather than working one side
    // against the other.
    const breath = Math.sin(elapsed * (Math.PI * 2 / FOLD_BREATH.period)) * FOLD_BREATH.degrees * RAD * weight
    arms[0].node.rotation.x += breath
    arms[1].node.rotation.x += breath * .88
  }

  /** Starts the fold. Idempotent — one already running is left alone. */
  const fold = () => {
    if (foldAge < 0) foldAge = 0
  }

  /** Ends it, this instant, in its settled pose. */
  const settle = () => {
    foldAge = FOLD_SECONDS
    foldWeight = FOLD_SETTLE
    if (live) applyFold(live.arms, foldWeight, 0)
  }

  const factory: OfficeForegroundFactory = (context) => {
    const { room, camera, reduced, level } = context

    // The same character the deck has used since slide 1 — same gender, same
    // tier, same palette seed as the counsel on the doorways close — so the
    // person the audience has been watching all talk is the person standing in
    // the firm at the end of it.
    const seed = 90231
    const rig = buildStylizedCounsel('female', Math.max(10, Math.min(14, level)), {
      role: 'counsel',
      paletteSeed: seed,
      // ADOPTION trap one: the scale the caller is about to apply, declared up
      // front so curved primitives are cut for the size they are drawn at.
      renderScale: HERO.scale,
      // Full detail, as the room's front rank gets. She is the nearest body to
      // the lens by a factor of two and the only one whose face is legible.
      detail: 'full',
    })
    rig.root.scale.setScalar(HERO.scale)
    rig.root.userData.detail = 'full'

    const holder = new THREE.Group()
    // ADOPTION trap two: the holder's world Y *is* the floor. The room group
    // already carries the floor's own offset, so local zero is the right place.
    holder.position.set(HERO.x, 0, HERO.z)
    holder.rotation.y = HERO.yaw
    // A character is not furniture and is not still: both flags are what keep
    // the room's obstacle scan and its static batcher off her.
    holder.userData.navIgnore = true
    holder.userData.batchSkip = true
    holder.add(rig.root)
    room.add(holder)
    // ADOPTION rule 1: bind after the rig is in the graph with a fresh matrix —
    // the skeleton measures its limb lengths from the bind pose, in world space,
    // and this rig is scaled by its parent.
    holder.updateWorldMatrix(true, true)

    // ADOPTION trap three: `reduced` is passed at construction. An actor built
    // without it and simply not updated is left in the bind pose, which is a
    // T-pose-ish rest that no state ever displays.
    const actor = new HumanoidActor(rig, { seed, state: stance, reduced })
    // Slightly larger than the authored performance. She is a foreground body
    // in a wide interior lens: the same curves and the same timing, travelling
    // a little further, because everything else in the frame is half her size.
    actor.setExpressionGain(1.15)
    actor.setLookTarget(AUDIENCE[0])

    const arms: ArmTarget[] = FOLD_POSE.map(([bone, x, y, z]) => ({
      node: rig[bone] as THREE.Object3D,
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(x * RAD, y * RAD, z * RAD)),
    }))

    live = {
      actor,
      rig,
      holder,
      arms,
      dispose: () => {
        // ADOPTION rule 4: the mixer caches its bindings against the root
        // object, so an actor collected without this keeps the whole rig alive.
        actor.dispose()
        holder.removeFromParent()
        // The meshes and materials themselves are the character cache's and
        // outlive every room; the office's own teardown already skips anything
        // tagged `characterShared`, which is all of them.
      },
    }
    clock = onScreen ? 0 : -1
    foldAge = -1
    foldWeight = 0

    // DEV-only placement hook, in the same idiom as `__officeCamera` in
    // `office-three.tsx` and for the same reason: where a foreground body wants
    // to stand is not a thing that can be reasoned out, because the office's
    // home framing is itself derived from headcount. This lets a harness move
    // her, read back where she landed in the frame, and shoot — several
    // placements per page load instead of one per rebuild. Compiled out of
    // production.
    if (import.meta.env.DEV) {
      const ndc = new THREE.Vector3()
      ;(window as unknown as { __deckHero?: unknown }).__deckHero = {
        place: (x: number, z: number, yaw?: number, scale?: number) => {
          holder.position.set(x, 0, z)
          if (yaw !== undefined) holder.rotation.y = yaw
          if (scale !== undefined) rig.root.scale.setScalar(scale)
        },
        /** Head and sole in normalised device coordinates, for framing. */
        frame: () => {
          holder.updateWorldMatrix(true, true)
          const head = ndc.setFromMatrixPosition(rig.head.matrixWorld).project(camera).clone()
          const foot = ndc.setFromMatrixPosition(rig.leftFoot.matrixWorld).project(camera).clone()
          return {
            head: [Number(head.x.toFixed(3)), Number(head.y.toFixed(3))],
            foot: [Number(foot.x.toFixed(3)), Number(foot.y.toFixed(3))],
            at: [holder.position.x, holder.position.z],
          }
        },
        fold: () => fold(),
        settle: () => settle(),
        /**
         * The home camera, read rather than assumed.
         *
         * Everything the ceiling band is dimensioned from is a consequence of
         * three numbers — where the lens is, how far it is pitched down, and
         * how wide it is — and none of the three is authored: the office
         * derives all of them from headcount. `horizonY` is the one that
         * decides the band, and it is the punchline: it is how much of the
         * frame lies above the lens, and therefore the entire budget any
         * ceiling has to work in.
         */
        cam: () => {
          const forward = camera.getWorldDirection(new THREE.Vector3())
          const half = Math.tan(camera.fov * .5 * RAD)
          // Where a point at infinite distance and lens height lands, 0 at the
          // bottom of the frame and 1 at the top.
          const pitch = Math.asin(-forward.y)
          return {
            at: camera.position.toArray().map((n) => Number(n.toFixed(3))),
            pitchDeg: Number((pitch / RAD).toFixed(2)),
            fov: camera.fov,
            horizonY: Number((.5 + .5 * Math.tan(pitch) / half).toFixed(3)),
            /** Screen y, 0 bottom to 1 top, of a point in *room* coordinates. */
            projectY: (x: number, y: number, z: number) => Number(
              (.5 + .5 * room.localToWorld(new THREE.Vector3(x, y, z)).project(camera).y).toFixed(3),
            ),
          }
        },
        /**
         * Pose the arms from explicit degrees and read the result back, in one
         * synchronous call before the next frame overwrites it.
         *
         * This is the tool the numbers in `FOLD_POSE` came out of: a solver in
         * the harness walks the twelve shoulder and elbow angles against target
         * hand and elbow positions and reads the error here. Authoring an arm
         * pose by looking at renders does not work — a forearm in front of the
         * chest and a forearm behind it are the same silhouette from the front,
         * and two rounds were lost to exactly that.
         */
        probePose: (values: number[]) => {
          FOLD_POSE.forEach(([bone], index) => {
            const node = rig[bone] as THREE.Object3D
            node.rotation.set(values[index * 3] * RAD, values[index * 3 + 1] * RAD, values[index * 3 + 2] * RAD)
          })
          holder.updateWorldMatrix(true, true)
          const inverse = new THREE.Matrix4().copy(holder.matrixWorld).invert()
          const local = (node: THREE.Object3D) => {
            const v = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(inverse)
            return [v.x / HERO.scale, v.y / HERO.scale, v.z / HERO.scale]
          }
          return {
            lElbow: local(rig.leftElbow), lHand: local(rig.leftHand),
            rElbow: local(rig.rightElbow), rHand: local(rig.rightHand),
            lShoulder: local(rig.leftShoulder), rShoulder: local(rig.rightShoulder),
          }
        },
        /**
         * Arm joints in the body's own frame, in body units.
         *
         * +X is the character's left-to-right, +Y up, +Z the way she faces.
         * Authoring a fold by eye off renders is how the first three attempts
         * put the forearms inside the ribcage: from the front a forearm behind
         * the chest and a forearm in front of it are the same silhouette. This
         * says which.
         */
        joints: () => {
          holder.updateWorldMatrix(true, true)
          const inverse = new THREE.Matrix4().copy(holder.matrixWorld).invert()
          const local = (node: THREE.Object3D) => {
            const v = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(inverse)
            // Back out the render scale so the numbers are the rig's own.
            return [v.x, v.y, v.z].map((n) => Number((n / HERO.scale).toFixed(3)))
          }
          return {
            chest: local(rig.chest),
            head: local(rig.head),
            lShoulder: local(rig.leftShoulder),
            lElbow: local(rig.leftElbow),
            lHand: local(rig.leftHand),
            rShoulder: local(rig.rightShoulder),
            rElbow: local(rig.rightElbow),
            rHand: local(rig.rightHand),
          }
        },
      }
    }

    return {
      bodies: [rig.root],
      update: (delta, elapsed) => step(delta, elapsed),
      dispose: () => {
        live?.dispose()
        live = null
      },
    }
  }

  const step = (delta: number, elapsed: number) => {
    if (!live) return
    const { actor, rig } = live

    if (clock >= 0) {
      clock += delta
      if (clock >= FOLD_AT) fold()
    }

    // The long hold. Neither of these touches the arms, so the fold survives
    // both.
    if (!actor.isReduced && elapsed > lookAt) {
      lookAt = elapsed + between(LOOK_HOLD)
      lookIndex = (lookIndex + 1 + Math.floor(roll() * (AUDIENCE.length - 1))) % AUDIENCE.length
      actor.setLookTarget(AUDIENCE[lookIndex])
    }
    if (!actor.isReduced && elapsed > stanceAt) {
      stanceAt = elapsed + between(STANCE_HOLD)
      stance = stance === 'idle' ? 'idleWeightShift' : 'idle'
      // The rig gives this pair a 1.1s crossfade, which is the whole of the
      // weight transfer; nothing about it is visible as an event.
      actor.setState(stance)
    }

    // ADOPTION rule 3: the honest ground speed. Nobody is travelling, so it is
    // zero — a nominal constant here is the entire cause of foot skating.
    actor.setGroundSpeed(0)
    // ADOPTION rule 2: update after the body has been placed for this frame,
    // because foot planting works in world space. She never moves, so this is
    // trivially satisfied, but the ordering is the contract.
    actor.update(delta)

    // The fold goes on last, over the pose the actor has just written. Reduced
    // motion gets it whole and immediately: the preference asks for movement
    // not to happen, not for the subject of the closing frame to stand with her
    // arms at her sides for the entire question period.
    if (foldAge >= 0) {
      foldAge = actor.isReduced ? FOLD_SECONDS : foldAge + delta
      foldWeight = foldCurve(foldAge / FOLD_SECONDS) * FOLD_SETTLE
      applyFold(live.arms, foldWeight, actor.isReduced ? 0 : elapsed)
    }

    // Blinking is not a joint, so the skeleton has no opinion about it. This is
    // the office's own idiom, on a period of her own.
    const blink = actor.isReduced || Math.sin(elapsed * .61 + 1.7) <= .9955 ? 1 : .14
    rig.eyes.forEach((eye) => { eye.scale.y = blink })
  }

  return {
    factory,
    arrive: () => {
      onScreen = true
      clock = 0
      // The fold is *not* rewound. On a return visit she is already folded,
      // because that is where `finish` left her, and unfolding her so she can
      // fold again would be a snap to arms-at-sides on a slide the audience is
      // already looking at. `fold()` is idempotent, so the timer below simply
      // finds the pose already held. The beat is authored for the first arrival
      // and is honest on every one after it: she is a person who has been
      // standing there with her arms crossed.
    },
    finish: () => {
      onScreen = false
      clock = -1
      settle()
    },
  }
}
