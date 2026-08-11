import * as THREE from 'three'

import { HumanoidActor, HumanoidBehaviorDirector, assignHumanoidLod } from '../app-art/rig'
import { buildStylizedCounsel, type StylizedCounselRig } from '../app-art/stylized-counsel'
import { CameraRig, PALETTE, contactShadow, disposeTree, labelPlane, seededRandom } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * SLIDE 23 — the close. "One place. Two doors."
 *
 * `NARRATIVE.md`: *"Two doorways in real Three.js geometry, side by side, both
 * royal blue, both open, warm light through each. Through the left doorway a
 * question card, alone, lit plainly. Through the right, the tier-14 office,
 * deep and glowing. The character from slide 1 stands centered between them in
 * full framing, facing the audience rather than either door… Symmetry is the
 * argument: neither door is bigger, neither is brighter. Hold this frame for
 * the entire Q&A."*
 *
 * ## Why the character is here and not somewhere else
 *
 * This is the slide where a human face earns its place rather than decorating.
 * Three things make it the right one, and no other slide has all three.
 *
 * The argument needs a person. "One place, two doors" is a claim about a
 * *choice*, and a choice needs somebody standing at it. Put the character on
 * the concept slide and they are an illustration of a product; put them here
 * and they are the student the whole deck has been talking about, facing the
 * room, with both options open behind them. Symmetry does the arguing and the
 * body at the centre is what makes the symmetry mean anything.
 *
 * It is held longer than any other frame in the deck. The narrative asks for
 * this composition to stay up for the entire Q&A — ten, twenty minutes. A
 * static image dies in the first thirty seconds of that; a body that breathes,
 * blinks, shifts its weight and occasionally looks somewhere does not. Every
 * other candidate slide is on screen for under half a minute, which is
 * precisely the range in which a still image is fine and a living one is
 * decoration.
 *
 * And it is the one place the deck can afford it. This scene is the last thing
 * built and nothing follows it, so a full-rate humanoid at portrait scale is
 * the only character in the frame with no office cast, no map crowd and no live
 * iframe to share the budget with.
 *
 * ## What is actually on screen
 *
 * The app's own rig, not a deck-original: `buildStylizedCounsel` is the exact
 * function that dresses every person in the office and on the map, and
 * `HumanoidActor` + `HumanoidBehaviorDirector` are the exact animation system
 * that drives them, on the `portraitHero` role at `renderScale` 1.0 — the
 * portrait scale `rig/ADOPTION.md` specifies and the scale its foot-planting
 * suite is verified at. `IllustratedRenderPass` is on it, because it is on
 * everything the stage draws, so the body is inked and banded exactly as it is
 * in the product.
 *
 * The four ordering rules from `ADOPTION.md` are obeyed and annotated below.
 */

/**
 * Doorway geometry, in world units. Both, identically — the symmetry is the
 * argument, so there is one set of numbers and a sign.
 *
 * Sized against the body rather than against the frame. A counsel built at
 * `renderScale` 1 stands a little over five units tall, so an opening has to
 * clear six and a half or the architecture reads as a doll's house with a
 * person wedged into it — which is exactly what a door built to a guessed 4.5
 * looked like.
 */
const DOOR = {
  /** Distance from centre to each doorway's centre line. */
  offset: 4.7,
  width: 3.1,
  /* Tall enough to clear a five-unit body with room over its head, and no
     taller. The headline and its sub-line occupy the top quarter of the frame
     and have to sit against plain wall — a door head any higher pushed into
     that band and the sub-line ran across a dark opening, where navy type on a
     royal blue room is simply not there. */
  height: 5.6,
  /** The wall the openings are cut into. */
  wallZ: -4.2,
  jamb: .28,
} as const

/**
 * The warm light through each opening. One constant, used twice and breathed
 * around once, because "neither door is brighter" is a requirement rather than
 * a preference and two numbers would eventually drift apart.
 *
 * It was two numbers, briefly, and they had drifted: the lights were built at
 * 26 and the breath in `update` re-set them to 14 on the first frame, so the
 * rooms visibly dimmed a frame after the slide arrived.
 */
const DOORLIGHT = 34

export function createDoorwaysScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  // A beige field, in the deck's own paper. This is the only scene in the deck
  // that is lit *light*, which is the point: the close is the second full
  // inversion and the last thing the room looks at.
  scene.background = new THREE.Color(PALETTE.paper)
  /* Far enough back that it only ever touches the floor running away behind
     the camera's shoulder.
  
     At 16/46 it was the single reason both doorways read as grey stairwells.
     The rooms behind the openings sit about twenty-four units from the lens,
     which was a quarter of the way into a fog whose colour is the beige field —
     so a near-black interior came back mixed a quarter of the way to cream,
     and every attempt to fix it by darkening the albedo did nothing, because
     the grey was being added after the shading rather than surviving it. */
  scene.fog = new THREE.Fog(PALETTE.paper, 34, 88)

  const rig = new CameraRig(
    {
      // The composed close, and the distance is set by the type rather than by
      // the room: the headline sits across the top of the frame and the three
      // closing words along the bottom, so the body has to land inside a band
      // running from about a quarter down to just above the lower edge. That
      // puts the camera at a little under nine units, which is also the
      // distance at which both openings clear the frame edges with air around
      // them. Close enough to be a portrait, far enough to be a composition.
      wide: { position: [0, 3.74, 15.4], target: [0, 3.5, -1], fov: 34, parallax: .3 },
      // Held in reserve for a presenter who wants the whole room in Q&A.
      room: { position: [0, 3.9, 18.5], target: [0, 3.2, -2], fov: 38, parallax: .5 },
    },
    'wide',
    context.width / Math.max(1, context.height),
  )

  const random = seededRandom(230823)

  // --- materials -----------------------------------------------------------
  const paper = new THREE.MeshStandardMaterial({ color: PALETTE.paper, roughness: .96, metalness: 0 })
  const paperFloor = new THREE.MeshStandardMaterial({ color: 0xece3d2, roughness: .94, metalness: 0 })
  const royal = new THREE.MeshStandardMaterial({ color: PALETTE.navy, roughness: .58, metalness: .1 })
  const royalDeep = new THREE.MeshStandardMaterial({ color: 0x0b1a26, roughness: .82, metalness: .04 })
  /* The two rooms are lit by their own practicals and by nothing else, and the
     albedos have to be cut for that.
  
     The scene's ambient is several times a normal one — it has to be, because
     the wall *is* the beige field rather than a backdrop behind it — and an
     ambient that strong reaches into the openings too, where it is exactly
     wrong. A navy block under it resolves to about the same value as a grey
     one, and both doorways came back reading as filing cabinets in a stairwell
     rather than as the deep, glowing rooms the narrative asks for. Cutting the
     interior albedos to near-black leaves the ambient with almost nothing to
     lift, so what the audience sees through each opening is the warm practical
     falling off into the dark — which is what "deep" looks like. */
  const interiorShell = new THREE.MeshStandardMaterial({ color: 0x05090e, roughness: .92, metalness: 0 })
  const interiorMass = new THREE.MeshStandardMaterial({ color: 0x0e1f2e, roughness: .74, metalness: .06 })
  const interiorMassAlt = new THREE.MeshStandardMaterial({ color: 0x060d15, roughness: .86, metalness: .03 })
  const gold = new THREE.MeshStandardMaterial({ color: PALETTE.gold, roughness: .32, metalness: .8 })
  const cream = new THREE.MeshStandardMaterial({ color: PALETTE.goldSoft, roughness: .6, metalness: .04 })
  const materials = [
    paper, paperFloor, royal, royalDeep, gold, cream,
    interiorShell, interiorMass, interiorMassAlt,
  ]

  // --- floor and wall ------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 44), paperFloor)
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  // The wall is built as slabs around the two openings rather than cut out of
  // one plane. A CSG subtraction here would produce an n-gon the contour pass
  // has to find edges in, and the illustrated look draws a much cleaner jamb
  // off a box's own corner.
  const wall = new THREE.Group()
  const wallHeight = 12
  const halfDoor = DOOR.width / 2
  const spans: Array<[number, number]> = [
    [-22, -DOOR.offset - halfDoor],
    [-DOOR.offset + halfDoor, DOOR.offset - halfDoor],
    [DOOR.offset + halfDoor, 22],
  ]
  for (const [left, right] of spans) {
    const width = right - left
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, .6), paper)
    slab.position.set(left + width / 2, wallHeight / 2, DOOR.wallZ)
    wall.add(slab)
  }
  // The lintels, one per opening, identical.
  for (const side of [-1, 1] as const) {
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR.width, wallHeight - DOOR.height, .6),
      paper,
    )
    lintel.position.set(
      side * DOOR.offset,
      DOOR.height + (wallHeight - DOOR.height) / 2,
      DOOR.wallZ,
    )
    wall.add(lintel)
  }
  scene.add(wall)

  // --- the two doorways ----------------------------------------------------
  // Built by one function called twice with a mirrored sign and no other
  // difference, so the symmetry the narrative calls the argument is structural
  // rather than something to be kept true by hand. Only the contents of the two
  // rooms differ, and each is added afterwards.
  const buildDoorway = (side: -1 | 1) => {
    const group = new THREE.Group()
    group.position.set(side * DOOR.offset, 0, DOOR.wallZ)

    for (const jambSide of [-1, 1] as const) {
      const jamb = new THREE.Mesh(
        new THREE.BoxGeometry(DOOR.jamb, DOOR.height + DOOR.jamb, .78),
        royal,
      )
      jamb.position.set(jambSide * (halfDoor + DOOR.jamb / 2), (DOOR.height + DOOR.jamb) / 2, .04)
      group.add(jamb)
    }
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR.width + DOOR.jamb * 2, DOOR.jamb, .78),
      royal,
    )
    head.position.set(0, DOOR.height + DOOR.jamb / 2, .04)
    group.add(head)

    // A gold threshold line at the foot of each. The product strikes a seal
    // into every floor it owns; this is the same detail at door width.
    const sill = new THREE.Mesh(new THREE.BoxGeometry(DOOR.width + DOOR.jamb * 2, .035, .5), gold)
    sill.position.set(0, .018, .1)
    group.add(sill)

    // The room behind: a shallow box the opening looks into, so the doorway has
    // depth rather than being a hole onto the background.
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR.width + .6, DOOR.height + .5, 9),
      interiorShell,
    )
    room.material.side = THREE.BackSide
    room.position.set(0, (DOOR.height + .5) / 2, -4.6)
    group.add(room)

    // Warm light through the opening. Identical intensity, identical colour,
    // identical distance on both sides — "neither door is brighter" is a
    // requirement, so it is one constant used twice.
    const practical = new THREE.PointLight(0xffe0a8, DOORLIGHT, 15, 2.1)
    practical.position.set(0, DOOR.height * .62, -1.9)
    group.add(practical)

    scene.add(group)
    return group
  }

  const leftDoor = buildDoorway(-1)
  const rightDoor = buildDoorway(1)

  // Through the LEFT doorway: a question card, alone, lit plainly.
  // Plainly is the specification and it is doing work — the left door is the
  // whole product for a student who never opens the game, and it has to look
  // sufficient rather than sparse.
  const cardFace = labelPlane('Q', 1.5, {
    pixels: 128, weight: 700, font: 'Archivo, Inter, sans-serif', color: '#1d3a52', align: 'center',
  })
  const card = new THREE.Group()
  const cardPlate = new THREE.Mesh(new THREE.BoxGeometry(1.95, 2.55, .08), cream)
  card.add(cardPlate)
  cardFace.position.set(0, .22, .05)
  cardFace.scale.setScalar(.9)
  card.add(cardFace)
  // Five answer rules under the stem, so it reads as an LSAT question and not
  // as a blank card.
  for (let index = 0; index < 5; index += 1) {
    const rule = new THREE.Mesh(new THREE.BoxGeometry(1.26, .062, .01), royal)
    rule.position.set(-.06, -.42 - index * .25, .046)
    card.add(rule)
  }
  card.position.set(-DOOR.offset, 3.1, DOOR.wallZ - 2.9)
  card.rotation.y = .1
  scene.add(card)
  // The card gets its own practical, matched to the desk lamp in the office
  // opposite. "Lit plainly" is not the same as lit less: the left door is the
  // whole product for a student who never opens the game, and a dim question
  // card beside a glowing office would argue the opposite of the slide.
  const cardLight = new THREE.PointLight(0xfff0cf, 22, 9, 2)
  cardLight.position.set(-DOOR.offset, 3.6, DOOR.wallZ - 1.6)
  scene.add(cardLight)

  // Through the RIGHT doorway: the tier-14 office, deep and glowing.
  // Suggested rather than instanced — the real office is a mounted React scene
  // with its own renderer and cannot be put inside this one. What the audience
  // needs to read through a 2.4-unit opening is depth, warm light and the
  // silhouette of a room that goes back a long way, which is four receding
  // ranks and a lit desk.
  const office = new THREE.Group()
  for (let rank = 0; rank < 4; rank += 1) {
    const depth = -2.1 - rank * 1.9
    const height = 1.5 + rank * .7
    for (const side of [-1, 1] as const) {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(.55 + random() * .4, height, .62),
        rank % 2 === 0 ? interiorMass : interiorMassAlt,
      )
      block.position.set(side * (.95 + rank * .16), height / 2, depth)
      office.add(block)
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(3, .07, .07), gold)
    band.position.set(0, 3.5 + rank * .3, depth)
    office.add(band)
  }
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2, .14, 1.05), gold)
  desk.position.set(0, 1.24, -3)
  office.add(desk)
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(.95, .6, .06), cream)
  monitor.position.set(0, 1.68, -3.25)
  office.add(monitor)
  const glow = new THREE.PointLight(0xffcf7a, 30, 11, 2)
  glow.position.set(0, 2, -3.1)
  office.add(glow)
  office.position.set(DOOR.offset, 0, DOOR.wallZ)
  scene.add(office)

  // --- lighting ------------------------------------------------------------
  // Royal blue and gold, as asked. The key is warm and frontal so the face is
  // legible from the back of a room; the fill is the deck's blue and comes from
  // low, which is what stops a beige field from flattening a beige-lit body
  // into the wall behind it.
  // Every other scene in the deck is a lit object in a dark room and its
  // lighting is built for that. This one is the inverse — a bright interior —
  // and it needs several times the ambient the others do, because the wall and
  // the floor *are* the beige field rather than a backdrop behind it. Underlit,
  // the illustrated pass bands a paper-coloured wall down to grey and the
  // "beige field" the narrative asks for reads as a dim room.
  // The numbers are larger than they look like they should be, and the reason
  // is worth writing down: under the renderer's physical lighting model a
  // diffuse surface reflects `albedo × irradiance / π`, so an ambient of 1 on
  // paper-coloured stock resolves to about 0.3 — a mid grey. Everything else in
  // the deck is a lit object against black, where that is exactly right and
  // nobody notices; a room whose walls *are* the beige field needs roughly π
  // times the irradiance to actually be beige. At 1.9 this wall rendered the
  // same grey as an unlit one, which is what the vignette was blamed for first.
  scene.add(new THREE.AmbientLight(0xfff6e6, 3.1))
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xe4dbc8, 2.4))
  // Aimed at the head rather than at the body's middle. This is a portrait
  // before it is a room, and the one thing the audience looks at for the
  // length of a Q&A is the face.
  const key = new THREE.SpotLight(0xfff1d2, 120, 26, .72, .6, 1.4)
  key.position.set(-2.2, 6.8, 7.4)
  key.target.position.set(0, 4.1, .35)
  scene.add(key)
  scene.add(key.target)
  const blueFill = new THREE.DirectionalLight(0x9cc0dd, .9)
  blueFill.position.set(4.4, 1.6, 5)
  scene.add(blueFill)
  // A broad warm wash straight down the wall, so the paper is an even field
  // rather than a lit patch with two dark ends. The spot shapes the body; this
  // is the only light in the scene doing nothing but keeping the beige beige.
  const wallWash = new THREE.DirectionalLight(0xfff4e2, 1.35)
  wallWash.position.set(-2.6, 3, 9)
  scene.add(wallWash)
  const goldRim = new THREE.DirectionalLight(PALETTE.pixelGold, 1.15)
  goldRim.position.set(.4, 4.2, -6)
  scene.add(goldRim)

  // --- the character -------------------------------------------------------
  const seed = 90231
  const counsel: StylizedCounselRig = buildStylizedCounsel('female', 13, {
    role: 'counsel',
    paletteSeed: seed,
    // ADOPTION trap one: the scale the caller will apply, declared up front so
    // curved primitives are cut for the size they are actually drawn at. 1.0 is
    // the portrait scale, and the one the foot-planting suite is verified at.
    renderScale: 1,
  })

  const holder = new THREE.Group()
  holder.add(counsel.root)
  // ADOPTION trap two: the holder's world Y *is* the floor. The actor lowers
  // the pelvis by the rig's measured sole offset so the soles rest here.
  holder.position.set(0, 0, .35)
  scene.add(holder)

  // Tight and dark rather than wide and soft: the camera is close to floor
  // level, so a generous pool compresses to a few pixels of nothing. What has
  // to read is the contact itself.
  const shade = contactShadow(.82, .5)
  shade.position.set(holder.position.x, .012, holder.position.z)
  shade.scale.set(1, .5, 1)
  scene.add(shade)
  // ADOPTION rule 1: bind after the rig is in the graph and its matrix is
  // fresh — the skeleton measures its limb lengths from the bind pose.
  holder.updateWorldMatrix(true, true)

  // ADOPTION trap three: `reduced` is passed at construction. An actor built
  // without it and then simply not updated is left in a bind pose, which is a
  // T-pose-ish rest no state ever displays.
  const actor = new HumanoidActor(counsel, { seed, state: 'idle', reduced: context.reduced })
  const director = new HumanoidBehaviorDirector()
  // `portraitHero` is the standing repertoire built for exactly this: a body
  // held in frame, facing out, for a long time. It schedules the breath, the
  // blink, the weight settle and the considered tilt, and spreads each draw
  // away from recent performances of the same beat — which is why a body held
  // for a twenty-minute Q&A does not resolve into a loop.
  director.add(actor, 'portraitHero', seed)
  const actors = [actor]

  // --- THE ARRIVAL BEAT: the character performs the slide's own argument -----
  //
  // The headline is "One place. Two doors." The counsel is standing between
  // those two doors. So as the deck arrives on this slide she looks to one, then
  // to the other, then back to the room — and the last thing the audience is
  // told is said twice, once in type and once by the person standing at the
  // choice. Then she holds, and the frame is still for the rest of the Q&A.
  //
  // ## Why this is a look and not a haul
  //
  // The ask was for a character to "pull in" the next slide. `HumanoidGesture`
  // has no grab, carry or drag in it, so a haul means authoring clips into the
  // character system the *app* shares — and a counsel who reaches out of the
  // game world to move the deck's furniture stops being a person in a firm and
  // becomes a stagehand. `setLookTarget` turns head and chest together, layered
  // over whatever clip is running, so she keeps breathing while she holds the
  // look. The character causes the beat without touching anything.
  //
  // ## Why it is safe to be interrupted
  //
  // A look is a weight, not a one-shot clip: it eases in over about a third of
  // a second, eases back out when released, and releasing interrupts nothing.
  // There is no frame of it that is a broken pose. A presenter mashing the arrow
  // key through the close can leave this half-applied and the worst thing on
  // screen is somebody half looking at a door, which is a thing people do. That
  // is why the beat is a gaze rather than `turnAway`, which is a real one-shot
  // clip and could strand mid-turn.
  //
  // ## Why the targets are in front of her
  //
  // The doorways are cut into the wall *behind* the body, at `DOOR.wallZ`.
  // Aiming the gaze at them literally is a hundred-and-six-degree turn away
  // from the audience, which the joint clamps would either refuse or make look
  // broken. These two points are out to the sides and slightly downstage — a
  // fifty-degree glance, which reads unmistakably as "that one, and that one"
  // while leaving her addressed to the room throughout.
  const GLANCE = {
    left: new THREE.Vector3(-4.2, 3.3, 3.5),
    right: new THREE.Vector3(4.2, 3.3, 3.5),
  } as const

  /**
   * Seconds from the scene appearing. The first glance starts at .55 on
   * purpose: `foil-seal` runs for 1.18s and its plate is opaque from .52 to
   * .68, so the turn *begins behind the foil* and is already in motion when the
   * plate lifts. The character is not seen deciding to move; she is discovered
   * mid-gesture, which is the difference between a slide that animates on
   * arrival and one that was already alive when you got there.
   */
  const BEATS = { left: .55, right: 1.75, room: 2.95 } as const

  /**
   * Which beat has been played, and THE BUG THIS REPLACES.
   *
   * This used to be a `greeted` boolean that latched true on the first play and
   * was never reset — but scenes are *cached* by the stage, so the closure
   * outlives the visit. The acknowledgement therefore fired exactly once per
   * page load: step back off the close and return, which is what happens in
   * every rehearsal and most Q&As, and the character never greeted again. The
   * slide quietly lost its only authored beat and nothing reported it, because
   * a body that breathes and blinks looks fine right up until you notice it
   * never did the thing.
   *
   * Re-armed in `setFraming`, which the stage calls with `immediate: true` on
   * every `show` — including a show served from cache. That is already the
   * deck's "this scene has just been put on screen" signal, which is why this
   * needs no new plumbing in the transition layer and no change to any slide.
   */
  let beat = 0

  // --- state ---------------------------------------------------------------
  const home = holder.position.clone()

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      // Reduced motion gets the acknowledgement and none of the gaze: the
      // preference asks for motion not to happen, and a head turn is motion.
      // The beat still *happens*, so the slide is not silently different.
      if (context.reduced) {
        if (beat === 0 && elapsed > BEATS.room) {
          beat = 3
          actor.playGesture('acknowledge', { amplitude: .85 })
        }
      } else if (beat === 0 && elapsed > BEATS.left) {
        beat = 1
        actor.setLookTarget(GLANCE.left)
      } else if (beat === 1 && elapsed > BEATS.right) {
        beat = 2
        actor.setLookTarget(GLANCE.right)
      } else if (beat === 2 && elapsed > BEATS.room) {
        beat = 3
        // Released rather than aimed back at the lens. Letting the weight fall
        // to zero returns her to whatever the director has her doing, which is
        // the composed front-facing idle the slide was specified as — aiming a
        // look at the camera instead would hold her staring down the room for
        // twenty minutes.
        actor.setLookTarget(null)
        actor.playGesture('acknowledge', { amplitude: .85 })
      }

      director.update(delta)
      // One body, so it always gets the full grade: foot IK and joint clamping
      // both on. This is the only scene in the deck where that is affordable
      // and the only one where the feet are in frame.
      assignHumanoidLod(actors, rig.camera, { fullBudget: 1, mediumBudget: 1 })

      if (!context.reduced) {
        // Gaze that tracks slightly. The head joint belongs to the actor and
        // writing to it here would be overwritten on the next `update`, so the
        // tracking is a yaw on the holder — two degrees at the extremes, which
        // is enough for the body to feel addressed to the room without ever
        // reading as a character following the mouse.
        holder.rotation.y = context.pointer.x * -.035
        // A breath-scale sway, on a period that shares no factor with any clip
        // in the library, so the two rhythms never phase-lock into one motion.
        holder.position.x = home.x + Math.sin(elapsed * .23) * .012
      }

      // ADOPTION rule 3: the honest ground speed. Nobody is travelling, so it
      // is zero — a nominal constant here is the entire cause of foot skating.
      actor.setGroundSpeed(0)
      // ADOPTION rule 2: update *after* the body has been placed for this
      // frame, because foot planting works in world space.
      actor.update(delta)

      if (!context.reduced) {
        // The rooms breathe, very slightly and out of phase with each other, so
        // a frame held for the length of a Q&A is never quite still. Kept under
        // a tenth of a stop: the symmetry is the argument and a flicker that
        // favoured one door would undo it.
        const left = leftDoor.children.find((child) => child instanceof THREE.PointLight)
        const right = rightDoor.children.find((child) => child instanceof THREE.PointLight)
        if (left) (left as THREE.PointLight).intensity = DOORLIGHT + Math.sin(elapsed * .41) * 1.1
        if (right) (right as THREE.PointLight).intensity = DOORLIGHT + Math.sin(elapsed * .41 + 2.1) * 1.1
      }

      rig.update(delta, context.pointer)
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      rig.go(name, immediate, 1.8)
      // Re-arm the arrival beat. The stage passes `immediate: true` exactly
      // when a scene has been put on screen — a first build or a cache hit —
      // and `false` for the same-scene camera tween, which must not restart
      // anything. See the note on `beat`.
      if (immediate) {
        beat = 0
        actor.setLookTarget(null)
      }
    },

    dispose() {
      // ADOPTION rule 4: call `dispose` — the mixer caches bindings against the
      // root object and an actor collected without it keeps the whole rig alive.
      director.remove(actor)
      actor.dispose()
      holder.removeFromParent()
      disposeTree(scene)
      for (const material of materials) material.dispose()
      ;(cardFace.material as THREE.Material).dispose()
    },
  }
}
