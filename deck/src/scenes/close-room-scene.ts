import * as THREE from 'three'

import { HumanoidActor, assignHumanoidLod, type HumanoidGesture, type HumanoidState } from '../app-art/rig'
import { buildStylizedCounsel, type StylizedCounselRig } from '../app-art/stylized-counsel'
import { registerProbe } from './probe'
import { CameraRig, disposeTree, seededRandom } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * SLIDE 24 — the close. One figure, one room, held for the whole Q&A.
 *
 * The founders rejected what was here before — first the app's own office
 * interior, then a beige room with two doorways cut into it — for the same
 * reason both times: *"too busy, too generic"*, and an open-topped room that
 * "contradicts the idea that the lawyer stands in a rich firm". What they asked
 * for instead, verbatim:
 *
 * > *"a much cleaner ending, where we just have the 3D rigged character to the
 * > right, shaded right and the camera positioned very slightly above such that
 * > you can see the shadows coming off the character, and then the character
 * > doing the crossing hands, fluid animation, in a blue 'room' that fits the
 * > theme of the slideshow, and then the text that you mentioned here to the
 * > left."*
 *
 * So there are four things in this scene and nothing else: a closed royal-blue
 * box, a gold hairline where its floor meets its back wall, one counsel, and
 * one light hard enough to throw her shadow across the floor. Everything the
 * previous version had — two doorways, two jamb sets, two practicals, a
 * question card with five rules on it, four ranks of suggested office and a
 * lit desk — is gone, and the frame is better for it. It also costs about a
 * fifth of what the office did to draw.
 *
 * ## Why the room is closed
 *
 * The ceiling is the note. An open-topped set is the cheapest way to light an
 * interior and it is what both previous versions did, but a room with no lid
 * is a stage flat, and the argument this slide is making is that the student
 * ends up standing inside a firm. A ceiling costs two triangles and is the
 * difference between a backdrop and a room, so the whole thing is one inverted
 * box: six faces, six materials, twelve triangles, one draw call each.
 *
 * ## Why the shadow is a real one
 *
 * Every other scene in this deck fakes ground contact with `contactShadow` — a
 * single unlit gradient quad — and the app's office goes further and sets
 * `keyLight.castShadow = false` outright, because a room with thirty people in
 * it cannot afford a shadow pass. Here the shadow is not contact, it is the
 * subject: the founders asked for the camera to sit above eye line
 * specifically so the shadow reads on the floor. A blurred ellipse under the
 * feet cannot do that. So this is the one scene in the deck that turns the
 * renderer's shadow map on, and it can be, because there is exactly one caster
 * and one light — see `SHADOW` below for what that costs.
 */

/**
 * The deck's own display palette, from `styles/theme.css`, as hex numbers.
 *
 * Not `scene-kit`'s `PALETTE`, which is the *app*'s token block — the navy
 * there is `#102735`, a near-black teal that is right for the game's chrome
 * and is not the royal blue this deck runs on. The brief says "a blue room
 * that fits the theme of the slideshow", and the theme's blue is `--blue`.
 */
const ROOM_PALETTE = {
  /** `--blue`. The walls. */
  blue: 0x1b2f6b,
  /** `--blue-lit`. Where the key washes the wall behind her. */
  blueLit: 0x2a4bb8,
  /** `--blue-deep`. The ceiling and the far corners, so the box has a top. */
  blueDeep: 0x0d1734,
  /** `--gold`. Spent once, on one hairline. */
  gold: 0xc89b4b,
  /** `--beige`, for the key's own colour rather than a neutral white. */
  beige: 0xefe6d6,
} as const

/**
 * The box, in world units. A counsel at `renderScale` 1 stands a little over
 * five units tall, so every number here is a multiple of a body.
 *
 * The depth runs well past the camera because the box is drawn `BackSide`: the
 * face behind the lens is culled and costs nothing, and having it there means
 * the fill light bounces off a surface rather than off nothing.
 */
const ROOM = {
  /**
   * Wide enough that neither side wall enters the frame.
   *
   * At the framing below the horizontal half-angle is about 28°, and the back
   * wall is 34 units from the lens, so the frustum is roughly 37 units across
   * where it lands — a narrower box puts a vertical corner in the top right,
   * and a corner seen almost edge-on is a black wedge that reads as a hole in
   * the set rather than as a room. This is a floor, a back wall and a lid, and
   * the two walls that would only ever be seen wrong are pushed outside.
   */
  width: 64,
  /** Two bodies. High enough to be a firm's room, low enough that the wall
   *  meets the ceiling inside the top of the frame rather than above it. */
  height: 10.4,
  depth: 40,
  /** Pushed back so the camera stands inside the box with air behind it. */
  centreZ: -5.5,
} as const

/** Where she stands. Stage right, and far enough downstage to be lit. */
const COUNSEL = { x: 4.35, z: -1.1 } as const

/**
 * The shadow map, sized deliberately rather than left at the default.
 *
 * `extent` is the half-width of the light's orthographic frustum, and it is
 * the number that had to be measured rather than guessed. The light is low, so
 * the cast is long: her shadow runs about eighteen units from her soles to its
 * head, most of it across the open floor under the copy. At 13 the far end of
 * it was clipped by the frustum wall and terminated in a straight diagonal
 * edge in the bottom left of the frame, which reads as a second, wrong shadow.
 * 20 contains the whole cast with a margin for the ambient sway.
 *
 * 2048² over a 40-unit frustum is 51 texels per world unit. At this framing
 * that is a little over one shadow texel per screen pixel along the near part
 * of the edge, which is the point where more map buys aliasing rather than
 * detail. The frustum is still cut to the body and its cast rather than to the
 * room — the box is 64 units across, and a shadow camera sized to it would
 * spend nine tenths of the map on floor that has nothing on it and the edge
 * would crawl as she breathes.
 */
const SHADOW = { size: 2048, extent: 20, near: 2, far: 34, bias: -.0012 } as const

/**
 * When the fold starts, how long it takes, and how much of that is
 * anticipation.
 *
 * The slide is entered on `foil-seal`, which runs 1.18s and whose plate is
 * fully opaque from .52 to .68. `DeckStage.show` zeroes the scene clock in the
 * same turn the transition starts, so these seconds and the transition's are
 * the same seconds.
 *
 * `begin` is .55, which is the number the previous version of this slide used
 * for its first beat and for the reason its comment gives: the character "is
 * not seen deciding to move; she is discovered mid-gesture".
 *
 * The plate's own numbers say it should be too late. It is opaque from .52 to
 * .68, so a gesture starting at .55 has only 130ms of cover, and 130ms of a
 * 1.25s fold is the anticipation and nothing else — which would mean the plate
 * lifts on a body that has barely begun, the delayed reaction the note is
 * trying to avoid. Timing it backwards from .68 instead puts `begin` around
 * .36.
 *
 * That is wrong, and recording the entry frame by frame is what says so.
 * `foilSeal` holds the plate opaque to .58 of its 1.18s and then fades it out
 * across the whole remaining .42 — it is not a shutter that lifts, it is a
 * dissolve that starts at .68 and is not finished until 1.18 — and the copy
 * layer under it fades in over the same span. So the scene is not *seen* at
 * .68. It becomes legible somewhere around 1.0.
 *
 * Against the moment she is actually visible rather than the moment the plate
 * technically starts moving, .55 is right and .36 is far too early. The
 * anticipation runs .55 to .75, entirely under the opaque plate. The strike is
 * about half done at 1.0 as the plate clears, which is what "discovered
 * mid-gesture" means. And she settles at 1.80s, six tenths after the plate has
 * gone, so the audience gets the end of the motion and the arrival at the pose
 * in clean air rather than through a veil.
 *
 * `seconds` is the whole gesture. About a second and a quarter is "quick,
 * fluid" as asked; much faster and the overshoot stops resolving into a settle
 * and starts reading as a snap.
 */
const FOLD = { begin: .55, seconds: 1.25, anticipation: .16 } as const

/**
 * The arm chain, which the fold takes over and does not give back.
 *
 * The shoulders are children of the chest, so writing their *local* rotations
 * pins the fold to the torso without pinning the torso: she keeps breathing,
 * shifting her weight and turning her head, and the folded arms ride all of it
 * exactly as a real pair of folded arms does.
 */
const FOLD_JOINTS = [
  'leftShoulder', 'leftElbow', 'leftHand',
  'rightShoulder', 'rightElbow', 'rightHand',
] as const

/**
 * THE FOLDED POSE, and why it is authored here rather than played.
 *
 * `humanoid-clips.ts` has a `foldArms` clip and it is in `portraitHero`'s
 * signature set, so the obvious implementation is `playGesture('foldArms')`
 * and nothing else. That was tried first and rendered before anything was
 * built on top of it, which is the only reason this comment exists rather than
 * a broken slide.
 *
 * **It does not cross the arms on this rig.** The clip's arm channels are
 * `{Shoulder x -30/-27, z +23/-19}` and `{Elbow x -99/-94, z -17/+15}`, and
 * with `THREE.Euler`'s XYZ order the elbow's Z is applied to the forearm
 * vector *before* its X, so on the left arm — which `buildStylizedCounsel`
 * hangs at −X — the −17° swings the forearm to −X, away from the midline,
 * and the −99° then lifts it forward. Both forearms come up vertically,
 * parallel, hands at chest height. It reads as a boxer's guard. The rendered
 * frame is in the pull request. Crossing needs shoulder *internal rotation*,
 * which the clip has no channel for at all, so no amount of amplitude gets
 * there; and the fix belongs upstream in `frontend/src/art`, not in this port
 * (`app-art/PORT.md`).
 *
 * So the pose below is authored, in absolute local rotations, and the clip is
 * still played for everything that is not an arm — see `startFold`.
 *
 * ## How it is built, joint by joint
 *
 * All three angles are read in the parent's frame, and the arm hangs down the
 * parent's −Y. The character faces +Z, her left arm hangs at −X.
 *
 *  - **Shoulder Z** adducts: positive brings the left upper arm in toward the
 *    ribs. The build hangs each arm eight degrees *abducted* (`abduction` in
 *    `stylized-counsel.ts`), so these values are near zero rather than
 *    positive — the upper arms come to vertical and stop. Past vertical the
 *    deltoid drives into the ribcage and the jacket self-intersects, which is
 *    the interpenetration this pose has to avoid and the reason it is not
 *    tucked tighter.
 *  - **Shoulder Y** is the internal rotation, and is the whole trick. It spins
 *    the flexed forearm about the upper arm's own axis, so 65° of it takes a
 *    forearm pointing forward and lays it across the chest. Anatomical
 *    internal rotation at the shoulder runs to about 90°; this is inside that.
 *  - **Shoulder X** sets the elbows a few degrees behind the plane of the
 *    body, which is what keeps the forearms against the chest instead of
 *    hovering in front of it.
 *  - **Elbow X** is the flex. Straight is 0 and the hinge closes negative; at
 *    −107° the forearm is a little above horizontal, which is where a folded
 *    forearm sits. Inside the rig's own `[-2.55, .10]` limit.
 *
 * The two arms are deliberately not mirrored. The left forearm crosses
 * *outside* the right, so it is rotated further, sits a little higher and a
 * little further forward; the right tucks underneath, closer to the body. That
 * asymmetry is what the authored clip's own comment asks for — "exactly as one
 * arm always does" — and it is also what keeps the two forearms out of each
 * other rather than coplanar and z-fighting.
 */
const FOLDED_POSE: Record<(typeof FOLD_JOINTS)[number], readonly [number, number, number]> = {
  // Outside, in front, and higher.
  leftShoulder: [-.678, 1.31, .135],
  leftElbow: [-1.637, 0, .05],
  // The wrist lays the hand along the far upper arm rather than letting it
  // point off into the air at the end of the forearm.
  leftHand: [-.20, .16, .18],
  // Underneath, tucked closer to the ribs.
  rightShoulder: [.024, -1.491, .428],
  rightElbow: [-1.737, 0, -.05],
  rightHand: [-.18, -.14, -.16],
}

/**
 * The ambient beats this scene is allowed to fire, and the stances it drifts
 * between.
 *
 * ## Why this is not `HumanoidBehaviorDirector`
 *
 * The director is the right tool everywhere else in the deck and it is the
 * wrong one here, for a reason its own source spells out: a repertoire "is
 * per-role because the constraint that matters is what the character's hands
 * are doing". None of its eight roles is *standing with the arms folded*. The
 * closest by hands is `client` — "seated and holding something, so the arms
 * are not free to move", whose beats are exactly the head-and-torso set wanted
 * here — but its *stances* are `seatedIdle` and `seatedType`, and handing a
 * seated role to someone standing in open floor is the documented failure in
 * `setRole`'s comment. The closest by stance is `portraitHero`, whose four
 * standing idles are exactly right and whose fillers are led by the arms:
 * `emphasise` is its heaviest-weighted beat and throws a whole arm, and
 * `stretch` and `handToChin` are in its signature set. Fired against a held
 * fold those do not break — the hold simply wins — but they turn into beats
 * where the torso moves and the arms conspicuously do not, and about half the
 * repertoire would land that way for the length of a Q&A.
 *
 * So the two halves are taken from the two roles that each get one half right.
 * Stances are `portraitHero`'s; beats are the head, neck, torso and pelvis
 * ones, which are the beats that still read on a body whose arms are committed.
 */
const STANCES: readonly HumanoidState[] = ['idle', 'idleWeightShift', 'idleRelaxed', 'idleAlert']

const BEATS: readonly HumanoidGesture[] = [
  'nod', 'glance', 'glanceMirrored',
  'scanRoom', 'scanRoomMirrored',
  'considerTilt', 'considerTiltMirrored',
  'neckRelease', 'neckReleaseMirrored',
  'breathDeep', 'breathSigh',
  'weightTransfer', 'weightTransferMirrored',
  'doubleTake', 'postureReset',
]

export function createCloseRoomScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(ROOM_PALETTE.blueDeep)

  const rig = new CameraRig(
    {
      /*
        Above eye line, which is a specification rather than a taste: the
        founders asked for the camera "positioned very slightly above such
        that you can see the shadows coming off the character". A counsel at
        this scale carries her eyes at about 4.8, and this sits at 6.2 and
        looks down nineteen degrees, which opens about two thirds of the frame
        into open floor for the shadow to lie across.

        It is *dollied* right rather than panned right, and the two are not
        interchangeable. Panning — camera at x 1.6, target at x 3 — frames
        identically and tilts the horizon two degrees, because a camera that is
        both pitched and yawed sends the vanishing point of the room's
        left-right axis off the image's own horizon, and the one long straight
        line in this frame runs right through the headline. Correct
        perspective, but with no other cue in a bare room it reads as a
        crooked slide. With the target directly ahead of the lens the pitch is
        the only rotation and the floor line is level to the pixel.

        The parallax is the smallest in the deck: this frame is held for the
        whole Q&A, and a camera that swims with the presenter's mouse for that
        long is a distraction, but a completely locked one reads as a
        photograph rather than a room.
      */
      wide: { position: [3, 6.2, 8.6], target: [3, 2.9, -1.1], fov: 33, parallax: .22 },
    },
    'wide',
    context.width / Math.max(1, context.height),
  )

  // --- the room ------------------------------------------------------------
  // One inverted box. A `BoxGeometry` carries six material groups, so the
  // floor, the ceiling and the walls can each be their own value at the cost
  // of six draw calls and twelve triangles for the entire set.
  const wall = new THREE.MeshStandardMaterial({ color: ROOM_PALETTE.blue, roughness: .92, metalness: 0 })
  // The back wall is a shade lighter than the sides, so the key reads as a
  // wash falling across it rather than as an even fill, and so her silhouette
  // has something to be a silhouette against.
  const wallBack = new THREE.MeshStandardMaterial({ color: ROOM_PALETTE.blueLit, roughness: .94, metalness: 0 })
  // Deeper than the walls and slightly bluer. A floor at the wall's own value
  // gives the shadow nothing to be darker than; this is about a stop down,
  // which is where a cast shadow reads as a shadow rather than as a stain.
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x142455, roughness: .78, metalness: .04 })
  const ceiling = new THREE.MeshStandardMaterial({ color: ROOM_PALETTE.blueDeep, roughness: .96, metalness: 0 })
  // Groups are ordered +x, -x, +y, -y, +z, -z. The +z face is behind the lens.
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM.width, ROOM.height, ROOM.depth),
    [wall, wall, ceiling, floorMaterial, wall, wallBack],
  )
  for (const material of [wall, wallBack, floorMaterial, ceiling]) material.side = THREE.BackSide
  shell.position.set(0, ROOM.height / 2, ROOM.centreZ)
  shell.receiveShadow = true
  scene.add(shell)

  // The gold hairline. One, along the foot of the back wall — the deck spends
  // gold on a rule and nowhere else, and a room with a skirting is a room
  // somebody paid for. It does not cast: it is a line, and a line's shadow is
  // noise.
  //
  // Emissive rather than metallic, which is the one thing about it that is not
  // obvious. Gold wants `metalness` near 1, but a metal reflects its
  // surroundings and there is no environment map in this deck, so a metallic
  // skirting resolves to black and the hairline disappears. It is also two
  // pixels tall at this distance, which is too few to carry a specular. So it
  // is a dielectric that emits: the emission is what makes it read as gold at
  // two pixels, and being emissive it holds its value whatever the key does.
  const goldMaterial = new THREE.MeshStandardMaterial({
    color: ROOM_PALETTE.gold,
    roughness: .45,
    metalness: 0,
    emissive: ROOM_PALETTE.gold,
    emissiveIntensity: .55,
  })
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(ROOM.width, .09, .08), goldMaterial)
  skirting.position.set(0, .21, ROOM.centreZ - ROOM.depth / 2 + .06)
  scene.add(skirting)

  // --- light ---------------------------------------------------------------
  //
  // Four lights, one of which casts. Every other scene in the deck lights an
  // object in a dark room; this one lights a room, so the ambient terms are
  // large for the reason the doorways scene wrote down — a diffuse surface
  // returns `albedo × irradiance / π`, so a wall that *is* the field needs
  // roughly π times the irradiance to actually be its own colour.
  scene.add(new THREE.HemisphereLight(0x8fa8d8, 0x0b1330, .42))
  scene.add(new THREE.AmbientLight(0x5f79c4, .20))

  /*
    The key, and the only caster.

    From her right and a little downstage of her, at about 25° above the floor.

    Two things were tried before this and both failed for the same reason. A
    light square to her right throws the shadow straight away from the lens,
    where a camera nineteen degrees above eye line sees almost none of it. A
    light set *behind* her right shoulder throws the shadow forward and to the
    left, which is the long diagonal this frame wants — but it also rims her
    and leaves the front of the body, which is the whole subject, unlit; at the
    ambient levels this room runs at she came out a silhouette.

    Downstage-right does both jobs at once. It is still a right-hand key, so
    the modelling on her face and the folded forearms reads as coming from the
    right exactly as asked, and it throws the shadow across the open floor to
    screen left, straight through the part of the frame the copy sits over.

    Its elevation is 33°, which is the one number here that was measured rather
    than chosen. A shadow's length is the caster's height over the tangent of
    that angle, so 24° — where this started — gave a cast twelve units long
    whose head fell outside the frame, and what was left on screen was a dark
    wash with no silhouette in it. At 33° the cast is about seven units and
    lands entirely inside the frame, so what the audience sees is a shadow with
    a head, shoulders and folded arms in it rather than a stain on the floor.
  */
  const key = new THREE.DirectionalLight(0xfff2dc, 5)
  key.position.set(COUNSEL.x + 9.15, 9.5, COUNSEL.z + 4.3)
  key.target.position.set(COUNSEL.x - .6, 1.8, COUNSEL.z)
  key.castShadow = true
  key.shadow.mapSize.set(SHADOW.size, SHADOW.size)
  key.shadow.camera.near = SHADOW.near
  key.shadow.camera.far = SHADOW.far
  key.shadow.camera.left = -SHADOW.extent
  key.shadow.camera.right = SHADOW.extent
  key.shadow.camera.top = SHADOW.extent
  key.shadow.camera.bottom = -SHADOW.extent
  // Slope-scaled as well as constant, because the floor is a single quad seen
  // at a grazing angle and a constant bias alone either detaches the shadow
  // from her soles or stripes the boards with acne, depending on which end of
  // the floor you look at.
  key.shadow.bias = SHADOW.bias
  key.shadow.normalBias = .03
  scene.add(key)
  scene.add(key.target)

  // The modelling light: warm, frontal, off her right, no shadow. This is what
  // puts light on the face the room spends twenty minutes looking at, and it
  // is deliberately weaker than the key so the shading still reads as coming
  // from the right.
  const bounce = new THREE.DirectionalLight(ROOM_PALETTE.beige, .78)
  bounce.position.set(COUNSEL.x + 4.2, 5.0, COUNSEL.z + 8.5)
  scene.add(bounce)

  // Cool fill from the empty half of the room, so the shadow side of her is
  // blue rather than black and the left of the frame is not a hole.
  const fill = new THREE.DirectionalLight(0x9fbcf0, .34)
  fill.position.set(-8.5, 4.2, 6)
  scene.add(fill)

  // --- the counsel ---------------------------------------------------------
  const seed = 90231
  const counsel: StylizedCounselRig = buildStylizedCounsel('female', 13, {
    role: 'counsel',
    paletteSeed: seed,
    // ADOPTION trap one: the scale the caller will apply, declared up front so
    // curved primitives are cut for the size they are actually drawn at. 1.0
    // is the portrait scale and the one the foot-planting suite is verified at.
    renderScale: 1,
  })

  const holder = new THREE.Group()
  holder.add(counsel.root)
  // ADOPTION trap two: the holder's world Y *is* the floor. The actor lowers
  // the pelvis by the rig's measured sole offset so the soles rest here.
  holder.position.set(COUNSEL.x, 0, COUNSEL.z)
  // Turned a little back into the room. Square to the lens is a passport
  // photograph; fourteen degrees gives the shoulders some depth and puts her
  // upstage shoulder into the key, which is where the rim wants it.
  holder.rotation.y = .30
  scene.add(holder)

  // The only meshes in the scene that cast. The room does not: a box lit from
  // inside has nothing to cast onto that is not already in shadow, and adding
  // it would double the shadow pass for no picture.
  counsel.root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) node.castShadow = true
  })

  // ADOPTION rule 1: bind after the rig is in the graph and its matrix is
  // fresh — the skeleton measures its limb lengths from the bind pose.
  holder.updateWorldMatrix(true, true)

  // ADOPTION trap three: `reduced` is passed at construction. An actor built
  // without it and then simply not updated is left in a bind pose, which is a
  // T-pose-ish rest no state ever displays.
  const actor = new HumanoidActor(counsel, { seed, state: 'idle', reduced: context.reduced })
  const actors = [actor]

  // ======================= THE FOLD, AND HOW IT IS HELD ======================
  //
  // The arms are driven to `FOLDED_POSE` and left there. The rest of the body
  // is the library's own `foldArms` beat, whose non-arm channels are the chest
  // opening, the pelvis going back onto both heels, the head settling and a
  // few degrees at each knee — the whole-body weight of the gesture, authored,
  // on the library's `BEAT_HOLD` timing. So what is scene-original here is one
  // pose and one curve, and the performance around it is the app's.
  //
  // Playing the beat does a second job: it makes `actor.isPlayingGesture` true
  // for its duration, which is what keeps `ambient` below from firing a beat
  // into the middle of the fold.
  //
  // ## Why the arms are blended toward the pose rather than snapped into it
  //
  // `weight` runs a curve, and every frame the six joints are slerped from
  // whatever the actor just produced *toward* the pose by that weight. At
  // weight 0 the actor's own arms are untouched, so there is no first frame
  // where anything jumps; at weight 1 the pose is absolute. Blending from the
  // live pose rather than from a snapshot taken at the start is what makes the
  // start continuous in velocity as well as in position — the arms are already
  // drifting on the idle when the fold takes them, and they carry that drift
  // into the strike instead of stopping dead for a frame first.
  //
  // ## Why this is safe under a presenter mashing the arrow keys
  //
  // Three properties, and together they mean no frame of this is a broken
  // pose:
  //
  //  - **The settled fold is her resting pose.** Nothing ever takes the arms
  //    out of it. `weight` is monotonic and never returns to zero, and the
  //    ambient beats below are chosen to leave the arms alone, so once folded
  //    she is folded until the scene is disposed. A figure with her arms
  //    halfway through her chest cannot be left on screen, because nothing is
  //    ever travelling *away* from the fold.
  //  - **The fold clock is not the scene clock.** `elapsed` restarts on every
  //    `show`, including one served from the stage's cache, but `foldClock`
  //    only ever moves forward. Leaving the slide mid-fold and coming straight
  //    back does not restart the gesture and does not rewind the arms; they
  //    carry on from exactly where they were.
  //  - **`finish()` jumps to the end state.** The deck's signal for "this
  //    scene is on screen now" is `setFraming(_, true)`, which is what a
  //    finished transition ends up calling. Caught there mid-fold, the clock
  //    is run out to the end inside that call, before this visit's first frame
  //    is drawn. The pose is a constant, so the jump is exact and costs
  //    nothing — there is no clip to fast-forward. A presenter who mashes past
  //    the close and comes back finds her already folded rather than catching
  //    the middle of a gesture whose beginning they never saw.
  let folding = false
  /** Seconds since the fold began. Deliberately not the scene clock. */
  let foldClock = 0
  /**
   * How many times the stage has put this scene on screen.
   *
   * `DeckStage.show` calls `setFraming(_, true)` on every activation, the first
   * one included, so `immediate` on its own cannot mean "you were skipped past".
   * The first visit is the one that gets the performance; every later one is a
   * presenter coming back, and gets the settled pose with no gesture at all.
   */
  let visits = 0
  /** The last `elapsed` seen, for the probe below. */
  let sceneClock = 0
  const foldTarget = FOLD_JOINTS.map((joint) => (
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...FOLDED_POSE[joint]))
  ))

  /**
   * The fold's timing, as one curve from 0 to 1.
   *
   * The same five-part shape everything in the clip library uses — load,
   * strike, overshoot, ring down, settle — written analytically because it has
   * to be sampled at whatever `delta` the frame arrives with rather than at
   * the library's baked rate.
   *
   * The anticipation is a *negative* weight, which extrapolates the slerp a
   * few percent the other side of the arms' resting pose: they swing very
   * slightly out and straighten before they come across, which is what a
   * person's arms actually do and what stops the strike reading as a cut. The
   * excursion is small enough that the elbow cannot reach hyperextension.
   */
  const foldWeight = (seconds: number) => {
    const t = seconds / FOLD.seconds
    if (t <= 0) return 0
    if (t >= 1) return 1
    if (t < FOLD.anticipation) return -.085 * Math.sin(Math.PI * (t / FOLD.anticipation))
    const u = (t - FOLD.anticipation) / (1 - FOLD.anticipation)
    // Zero at u=0 and one at u=1 by construction, with a ten percent overshoot
    // half way and a ring-down that is over well before the end — so the last
    // third of the gesture is the settle rather than the arrival.
    return 1 - Math.pow(1 - u, 3) * Math.cos(u * Math.PI * 1.6)
  }

  /**
   * The fold, published through the deck's telemetry hatch.
   *
   * Both correctness requirements on this slide are claims about *when* the
   * arms are where, and neither can be checked from a screenshot: "the gesture
   * begins behind the plate" and "an interrupted visit lands on the settled
   * pose, never half way through" are statements about a number that a still
   * frame does not contain. Read against the plate's own computed opacity this
   * turns both into a measurement — which is exactly what `probe.ts` exists
   * for, and the same reason the stage publishes its draw calls rather than
   * drawing them on the slide.
   *
   *     __deckClose()   // { elapsed, weight, visits, folding }
   */
  registerProbe('__deckClose', () => ({
    elapsed: Number(sceneClock.toFixed(3)),
    weight: Number(foldWeight(foldClock).toFixed(4)),
    visits,
    folding,
  }))

  const startFold = () => {
    folding = true
    foldClock = 0
    // Slightly quicker than authored, so the torso's own accent lands with the
    // arms rather than a third of a second behind them.
    actor.playGesture('foldArms', { amplitude: 1, timeScale: 1.6, fade: .24 })
  }

  /** Pull the arm chain toward the pose by `weight`, over whatever the actor
   *  just produced. Called after `actor.update`, so it is the last word. */
  const applyFold = (weight: number) => {
    if (weight === 0) return
    for (let index = 0; index < FOLD_JOINTS.length; index += 1) {
      counsel[FOLD_JOINTS[index]].quaternion.slerp(foldTarget[index], weight)
    }
  }

  // --- ambient life --------------------------------------------------------
  const random = seededRandom(seed)
  let stanceRemaining = 4 + random() * 6
  let beatRemaining = 5 + random() * 5
  /** The last two of each, refused on the next draw. Banning only the
   *  immediate predecessor still produces A-B-A often enough to notice. */
  const recentStances: HumanoidState[] = []
  const recentBeats: HumanoidGesture[] = []

  const pick = <T,>(from: readonly T[], recent: T[]) => {
    const fresh = from.filter((entry) => !recent.includes(entry))
    const options = fresh.length ? fresh : from
    const choice = options[Math.min(options.length - 1, Math.floor(random() * options.length))]
    recent.push(choice)
    if (recent.length > 2) recent.shift()
    return choice
  }

  const ambient = (delta: number) => {
    stanceRemaining -= delta
    if (stanceRemaining <= 0) {
      // Spans that share no common factor, so the sequence of postures a
      // viewer sees over a couple of minutes never lines up with itself.
      stanceRemaining = 6.5 + random() * 8.5
      actor.setState(pick(STANCES, recentStances))
    }
    beatRemaining -= delta
    if (beatRemaining <= 0 && !actor.isPlayingGesture) {
      beatRemaining = 4.5 + random() * 7
      // Size and speed drawn per occurrence, for the reason `playGesture`'s
      // own comment gives: what an audience recognises is the shape of a
      // motion, and a dozen beats fired at a fixed size is still a loop.
      actor.playGesture(pick(BEATS, recentBeats), {
        amplitude: .55 + random() * .45,
        timeScale: .84 + random() * .38,
      })
    }
  }

  const home = holder.position.clone()

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      sceneClock = elapsed
      // Reduced motion gets the fold and none of the rest. `HumanoidActor`
      // built with `reduced` holds one posed frame, and the frame it holds is
      // whichever gesture was last asked for sampled at its own rest phase —
      // which for `foldArms` is the settled fold. So the preference lands the
      // correct still image rather than a bind pose, and lands it without this
      // scene animating anything.
      if (context.reduced) {
        if (!folding) {
          folding = true
          actor.playGesture('foldArms')
        }
        actor.update(delta)
        applyFold(1)
        rig.update(delta, context.pointer)
        return
      }

      if (!folding && elapsed >= FOLD.begin) startFold()
      if (folding && foldClock < FOLD.seconds) foldClock = Math.min(FOLD.seconds, foldClock + delta)

      ambient(delta)
      // One body, so it always gets the full grade: foot IK and joint clamping
      // both on. This is the only scene in the deck where that is affordable
      // and one of two where the feet are in frame.
      assignHumanoidLod(actors, rig.camera, { fullBudget: 1, mediumBudget: 1 })

      // A breath-scale sway on the holder, on a period that shares no factor
      // with any clip in the library, so the two rhythms never phase-lock.
      // Two hundredths of a unit — this is the difference between a held frame
      // and a still, and anything larger reads as the floor moving.
      holder.position.x = home.x + Math.sin(elapsed * .23) * .014

      // ADOPTION rule 3: the honest ground speed. Nobody is travelling, so it
      // is zero — a nominal constant here is the entire cause of foot skating.
      actor.setGroundSpeed(0)
      // ADOPTION rule 2: update *after* the body has been placed for this
      // frame, because foot planting works in world space.
      actor.update(delta)

      applyFold(foldWeight(foldClock))

      rig.update(delta, context.pointer)
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      rig.go(name, immediate, 1.8)
      if (!immediate || context.reduced) return
      // The stage passes `immediate: true` exactly when a scene has been put
      // on screen — a first build or a cache hit — and `false` for the
      // same-scene camera tween, which must not disturb anything.
      //
      visits += 1
      if (visits <= 1) return
      // Second visit onwards: run the clock out. The pose is a constant and
      // the curve reaching it is closed-form, so the jump is exact and costs
      // nothing — there is no clip to fast-forward and no mixer to step. It
      // happens inside `DeckStage.show`, before this visit's first frame is
      // drawn, so a presenter who mashes past the close and comes back finds
      // her already folded rather than catching the middle of a gesture whose
      // beginning they never saw.
      folding = true
      foldClock = FOLD.seconds
      applyFold(1)
    },

    dispose() {
      registerProbe('__deckClose', undefined)
      // ADOPTION rule 4: call `dispose` — the mixer caches bindings against
      // the root object and an actor collected without it keeps the rig alive.
      actor.dispose()
      holder.removeFromParent()
      disposeTree(scene)
      for (const material of [wall, wallBack, floorMaterial, ceiling, goldMaterial]) material.dispose()
    },
  }
}
