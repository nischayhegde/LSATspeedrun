import * as THREE from 'three'

import { CameraRig, PALETTE, disposeTree, seededRandom } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * The scene a slide with no scene of its own gets: the practice's library at
 * night, held as a wide shot, with the copy of eighteen slides laid over it.
 *
 * ## Not an empty canvas and not a hidden one
 *
 * First, the deck's transition system composites the outgoing and incoming
 * *frames*, so every slide needs a frame — making the canvas absent for some
 * slides would mean two transition paths and one of them would be the one that
 * breaks on stage. Second, a slide of pure copy over a flat field looks like a
 * slide, and the brief was that it should not.
 *
 * ## Why it was rebuilt
 *
 * What was here was three draw calls of almost nothing: a floor, a wall 46 units
 * back, and 260 motes, lit to a mean luminance of about 2/255. The reasoning was
 * that `occlusion.ts` stops the stage drawing at all behind an opaque field, so
 * on the eighteen slides that name this scene nobody would ever see it. That is
 * true of the *steady state* and false of everything either side of it, and the
 * founder's walkthrough found all three exceptions at once:
 *
 *   - Occlusion is released for the duration of every transition, by design, so
 *     this scene is genuinely on screen under every cross-dissolve into and out
 *     of those eighteen slides.
 *   - The seven demo slides paint no field, so this is what surrounds the app
 *     embed on all of them.
 *   - And when a slide layer is transparent that should not be — the defect in
 *     `engine/transitions.ts`, see `Batch.claim` — the stage is *still* marked
 *     occluded, because occlusion is computed from the registry's `field` and not
 *     from what is on the glass. So the last frame drawn before the cover went up
 *     stays frozen on the projector with no copy over it. That frame is the one
 *     that came back with "I'm so confused, what is even happening on this
 *     slide?", and it was this scene: a starfield of dust motes, the floor-to-
 *     wall seam reading as a horizon, and one warm smudge off to the right.
 *
 * Both halves of that needed fixing. The transition defect is fixed; a default
 * scene that is legible on the one occasion it is seen alone is the other half.
 *
 * So it is now a room, drawn from the app's own office — the shelving, the brass
 * reading lamps, the skyline through the glass — because a slide arguing about
 * the product should not be sitting in a void when the product has a world. The
 * window is the point of it: a warm opening at the end of a dark colonnade is
 * legible at any exposure a projector can inflict, which a starfield is not.
 *
 * Restraint is deliberate and was arrived at the hard way. The first attempt gave
 * the shelves a spine per colour of the rainbow and it read as a toyshop against
 * a deck that is royal blue, parchment and gold; the palette below is four
 * tokens, and every one of them is in `PALETTE`.
 *
 * ## Cost
 *
 * Thirteen draw calls, instanced wherever there is more than one of something,
 * and no shadow-casting light. It is still the cheapest scene in the deck, and
 * the whole point of `occlusion.ts` is that on most of these slides it is not
 * drawn at all.
 *
 * ## The three framings
 *
 * The same room from three places, so that consecutive copy slides share one
 * scene and get an almost imperceptible camera move rather than a scene change.
 * All three point at the window. `low` used to be a camera at eye height 1.3
 * aimed *upward* at a point behind and above the far wall, framing the one part
 * of the set with nothing in it: fog, and the motes.
 */

/** Where the far wall is. Everything else is placed relative to it. */
const BACK = -40

/** The opening in that wall, which is what the eye is meant to find. */
const WINDOW = { halfWidth: 5, sill: 2.2, head: 14.2 }

/** The wall's own extent, which the four pieces around the opening add up to. */
const WALL = { halfWidth: 40, foot: -2, top: 28 }

export function createBackdropScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  const night = new THREE.Color(0x0a1424)
  scene.background = night
  // Thin. The window is 55 units from the camera and fog is the only thing that
  // could take it away, which would remove the reason the room is lit this way.
  scene.fog = new THREE.FogExp2(night.getHex(), .0115)

  const rig = new CameraRig(
    {
      // Down the middle of the colonnade with the window at the end of it.
      still: { position: [0, 4.2, 16], target: [0, 6.4, BACK], fov: 42, parallax: 1 },
      // Off the axis, so the two ranks stop being symmetrical and the
      // perspective lines run diagonally. This is the parallax between two
      // consecutive copy slides and it is the only thing that has to differ.
      drift: { position: [-5.4, 3.6, 13.5], target: [1.6, 6, BACK + 3], fov: 46, parallax: 1 },
      // Low, past the corner of the desk, looking up the room — aimed at the
      // window rather than over the top of the wall.
      low: { position: [3.6, 1.7, 11], target: [-1.4, 7.2, BACK + 2], fov: 47, parallax: 1 },
    },
    'still',
    context.width / Math.max(1, context.height),
  )

  const materials: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []
  const material = (options: THREE.MeshStandardMaterialParameters) => {
    const made = new THREE.MeshStandardMaterial(options)
    materials.push(made)
    return made
  }
  const basic = (options: THREE.MeshBasicMaterialParameters) => {
    const made = new THREE.MeshBasicMaterial(options)
    materials.push(made)
    return made
  }
  const geometry = <T extends THREE.BufferGeometry>(made: T) => {
    geometries.push(made)
    return made
  }
  const placement = new THREE.Matrix4()
  const scaling = new THREE.Matrix4()
  const random = seededRandom(7716)

  // --- light ----------------------------------------------------------------
  // A cool wash from above, one warm key raking down the left rank, a cold fill
  // from the window side, and the practicals below. The old rig had a key at 1.35
  // with no bounce and nothing for it to land on; these are the tier scene's
  // magnitudes, which are the ones that photograph.
  scene.add(new THREE.HemisphereLight(0x44639a, 0x0b1526, 1.6))
  const key = new THREE.DirectionalLight(0xffe6bd, 2.1)
  key.position.set(-12, 15, 10)
  scene.add(key)
  // Aimed the other way and cold, so the faces looking up the room toward the
  // glass are the ones catching it. Without this the far bays go to silhouette
  // and the recession stops reading.
  const moon = new THREE.DirectionalLight(0x9dc0f0, 1.1)
  moon.position.set(2, 9, BACK - 6)
  scene.add(moon)

  // --- floor ----------------------------------------------------------------
  const floor = new THREE.Mesh(
    geometry(new THREE.PlaneGeometry(140, 140)),
    material({ color: 0x0e1a2b, roughness: .88, metalness: .06 }),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  // A brass inlay down the centre of the boards, running at the window. It is
  // the cheapest possible leading line and it is the one thing that makes a
  // slow camera move over a dark floor read as a camera move at all.
  // Matt rather than polished: at .72 metalness the horizontal plane threw the
  // cold directional straight back down the lens and the line photographed as a
  // white road marking in the centred framing.
  const inlay = new THREE.Mesh(
    geometry(new THREE.PlaneGeometry(.3, 62)),
    material({ color: PALETTE.goldDark, roughness: .78, metalness: .14 }),
  )
  inlay.rotation.x = -Math.PI / 2
  inlay.position.set(0, .02, BACK / 2 + 12)
  scene.add(inlay)

  // --- the far wall, with a hole in it --------------------------------------
  //
  // Four pieces around the opening rather than one plane with fittings in front
  // of it. The first attempt was the latter, and a solid wall occludes
  // everything put behind it: the sky and the whole skyline were being drawn and
  // then hidden, and the window read as three gold posts floating in the dark.
  const wallMaterial = material({ color: 0x1b2e4b, roughness: .93, metalness: .04 })
  const wallPiece = (width: number, height: number, x: number, y: number) => {
    const piece = new THREE.Mesh(geometry(new THREE.PlaneGeometry(width, height)), wallMaterial)
    piece.position.set(x, y, BACK)
    scene.add(piece)
  }
  const flankWidth = WALL.halfWidth - WINDOW.halfWidth
  const wallHeight = WALL.top - WALL.foot
  const wallMiddle = (WALL.top + WALL.foot) / 2
  for (const side of [-1, 1]) {
    wallPiece(flankWidth, wallHeight, side * (WINDOW.halfWidth + flankWidth / 2), wallMiddle)
  }
  wallPiece(WINDOW.halfWidth * 2, WINDOW.sill - WALL.foot, 0, (WINDOW.sill + WALL.foot) / 2)
  wallPiece(WINDOW.halfWidth * 2, WALL.top - WINDOW.head, 0, (WALL.top + WINDOW.head) / 2)

  // --- what is outside it ---------------------------------------------------
  //
  // Unlit and untone-mapped, all of it. This is the brightest thing in the shot
  // by a wide margin and the thing the eye is meant to land on, so it is not
  // allowed to depend on a light, on the tone mapper, or on a projector's idea
  // of gamma. If everything else in the room fails, the room still reads as a
  // dark interior with a lit window at the end of it.
  const SKY_STOPS: Array<[number, number]> = [
    [0, 0x2b4a7d], [.42, 0x1f3a63], [.72, 0x3c4a6b], [.88, 0x8a6b48], [1, 0xc79357],
  ]
  const skyGeometry = geometry(new THREE.PlaneGeometry(30, 26, 1, 10))
  const skyPosition = skyGeometry.attributes.position as THREE.BufferAttribute
  const skyColours = new Float32Array(skyPosition.count * 3)
  const stop = new THREE.Color()
  const next = new THREE.Color()
  for (let index = 0; index < skyPosition.count; index += 1) {
    // 0 at the top of the plane, 1 at the bottom, so the warm band sits on the
    // horizon where a city puts its light pollution.
    const t = .5 - skyPosition.getY(index) / 26
    let lower = SKY_STOPS[0]
    let upper = SKY_STOPS[SKY_STOPS.length - 1]
    for (let s = 0; s < SKY_STOPS.length - 1; s += 1) {
      if (t >= SKY_STOPS[s][0] && t <= SKY_STOPS[s + 1][0]) {
        lower = SKY_STOPS[s]
        upper = SKY_STOPS[s + 1]
        break
      }
    }
    const span = Math.max(.0001, upper[0] - lower[0])
    stop.setHex(lower[1]).lerp(next.setHex(upper[1]), (t - lower[0]) / span)
    skyColours[index * 3] = stop.r
    skyColours[index * 3 + 1] = stop.g
    skyColours[index * 3 + 2] = stop.b
  }
  skyGeometry.setAttribute('color', new THREE.BufferAttribute(skyColours, 3))
  const sky = new THREE.Mesh(skyGeometry, basic({ vertexColors: true, toneMapped: false, fog: false }))
  // Behind the skyline, not in front of it. At `BACK - 3` this plane was nearer
  // the camera than every tower and depth-tested them all away, so the view was a
  // clean gradient and the city was being built for nobody.
  sky.position.set(0, WINDOW.sill + 7, BACK - 26)
  scene.add(sky)

  // The skyline, as a silhouette against that. The same read as the office's own
  // window view at a fraction of the cost, and deliberately flat: it is 45 units
  // from the camera through a 10-unit opening, so it is four hundred pixels of
  // the frame and modelling it would be modelling for nobody.
  const TOWERS = 22
  const towers = new THREE.InstancedMesh(
    geometry(new THREE.BoxGeometry(1, 1, 1)),
    basic({ color: 0x14243c, toneMapped: false, fog: false }),
    TOWERS,
  )
  const litPositions: number[] = []
  for (let index = 0; index < TOWERS; index += 1) {
    const width = .9 + random() * 2.2
    const height = 4 + random() * 11
    const x = (index / (TOWERS - 1) - .5) * 26 + (random() - .5) * .9
    const base = WINDOW.sill - 1.4
    scaling.makeScale(width, height, .6)
    placement.makeTranslation(x, base + height / 2, BACK - 5 - random() * 12)
    towers.setMatrixAt(index, placement.multiply(scaling))
    // Lit windows, placed on the towers rather than scattered, which is the
    // difference between a city that is awake and a second starfield.
    const rows = Math.max(2, Math.floor(height / 1.5))
    for (let row = 0; row < rows; row += 1) {
      if (random() > .55) continue
      litPositions.push(
        x + (random() - .5) * width * .74,
        base + .8 + (row / rows) * (height - 1.2),
        BACK - 4.6 - random() * 11.6,
      )
    }
  }
  towers.instanceMatrix.needsUpdate = true
  scene.add(towers)

  const litGeometry = geometry(new THREE.BufferGeometry())
  litGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(litPositions), 3))
  const litMaterial = new THREE.PointsMaterial({
    color: 0xffd79a, size: .3, sizeAttenuation: true, transparent: true, opacity: .85,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
  })
  materials.push(litMaterial)
  scene.add(new THREE.Points(litGeometry, litMaterial))

  // --- the window's own joinery --------------------------------------------
  // Brass, in the plane of the opening: a transom across it and two mullions
  // down it. Georgian proportions, because the alternative is a hole.
  const barMaterial = material({
    color: PALETTE.gold, roughness: .36, metalness: .68,
    emissive: new THREE.Color(0x2a1c06),
  })
  const glazing = new THREE.Group()
  glazing.position.z = BACK + .1
  const transom = new THREE.Mesh(
    geometry(new THREE.BoxGeometry(WINDOW.halfWidth * 2, .2, .18)), barMaterial,
  )
  transom.position.y = WINDOW.sill + (WINDOW.head - WINDOW.sill) * .62
  glazing.add(transom)
  const mullionGeometry = geometry(new THREE.BoxGeometry(.17, WINDOW.head - WINDOW.sill, .18))
  for (const offset of [-WINDOW.halfWidth / 3, WINDOW.halfWidth / 3]) {
    const mullion = new THREE.Mesh(mullionGeometry, barMaterial)
    mullion.position.set(offset, (WINDOW.sill + WINDOW.head) / 2, 0)
    glazing.add(mullion)
  }
  // The architrave: a moulding round the opening, so the wall has a thickness and
  // the window is set into it rather than printed on it. Four pieces, for the
  // same reason the wall is four pieces — the first attempt was one box spanning
  // the opening, which is a shutter, and it hid the entire view.
  const architraveMaterial = material({ color: 0x2a3e58, roughness: .76, metalness: .14 })
  const openingHeight = WINDOW.head - WINDOW.sill
  const jambGeometry = geometry(new THREE.BoxGeometry(.75, openingHeight + 1.5, .4))
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(jambGeometry, architraveMaterial)
    jamb.position.set(side * (WINDOW.halfWidth + .37), (WINDOW.sill + WINDOW.head) / 2, BACK + .3)
    scene.add(jamb)
  }
  const head = new THREE.Mesh(
    geometry(new THREE.BoxGeometry(WINDOW.halfWidth * 2 + 1.5, .75, .4)), architraveMaterial,
  )
  head.position.set(0, WINDOW.head + .37, BACK + .3)
  scene.add(head)
  scene.add(glazing)
  const sill = new THREE.Mesh(
    geometry(new THREE.BoxGeometry(WINDOW.halfWidth * 2 + 2.2, .34, 1)),
    material({ color: 0x2b3f58, roughness: .7, metalness: .14 }),
  )
  sill.position.set(0, WINDOW.sill - .1, BACK + .5)
  scene.add(sill)

  // --- the two ranks of shelving -------------------------------------------
  //
  // Six bays a side, receding. These are the shot: a converging line down each
  // edge of the frame, something for the fog to eat, and the middle third —
  // where every slide's copy sits — left quiet.
  const BAYS = 6
  const BAY_X = 8.4
  const BAY_Z = (index: number) => 3 - index * 6.8
  const CARCASS_HEIGHT = 6.4
  const CARCASS_DEPTH = 4.6
  const joinery = material({ color: 0x1c3050, roughness: .84, metalness: .07 })

  // An *open* carcass: a back panel outboard of the books and a pair of end
  // panels, rather than the solid box this was. A solid box is a bookcase seen
  // from behind — the spines were inside it, so twelve bays of colour were being
  // built, instanced, coloured by depth, and drawn inside an opaque slab. The
  // frame that came out of it was a corridor of blank monoliths.
  const backs = new THREE.InstancedMesh(
    geometry(new THREE.BoxGeometry(.3, CARCASS_HEIGHT, CARCASS_DEPTH)), joinery, BAYS * 2,
  )
  const ends = new THREE.InstancedMesh(
    geometry(new THREE.BoxGeometry(1.5, CARCASS_HEIGHT, .24)), joinery, BAYS * 4,
  )
  let end = 0
  for (let index = 0; index < BAYS; index += 1) {
    for (const side of [-1, 1]) {
      placement.makeTranslation(side * (BAY_X + .75), CARCASS_HEIGHT / 2, BAY_Z(index))
      backs.setMatrixAt(index * 2 + (side > 0 ? 1 : 0), placement)
      for (const face of [-1, 1]) {
        placement.makeTranslation(side * BAY_X, CARCASS_HEIGHT / 2, BAY_Z(index) + face * (CARCASS_DEPTH / 2 - .12))
        ends.setMatrixAt(end, placement)
        end += 1
      }
    }
  }
  backs.instanceMatrix.needsUpdate = true
  ends.instanceMatrix.needsUpdate = true
  scene.add(backs)
  scene.add(ends)

  // Shelf boards. The first attempt had none and the books floated, which is the
  // sort of thing nobody can name and everybody sees.
  const SHELVES = 4
  const SHELF_PITCH = 1.38
  const SHELF_BASE = .9
  const boards = new THREE.InstancedMesh(
    geometry(new THREE.BoxGeometry(1.5, .09, CARCASS_DEPTH - .3)),
    material({ color: 0x2f4462, roughness: .72, metalness: .1 }),
    BAYS * 2 * SHELVES,
  )
  let board = 0
  for (let bay = 0; bay < BAYS; bay += 1) {
    for (const side of [-1, 1]) {
      for (let shelf = 0; shelf < SHELVES; shelf += 1) {
        placement.makeTranslation(side * BAY_X, SHELF_BASE + shelf * SHELF_PITCH, BAY_Z(bay))
        boards.setMatrixAt(board, placement)
        board += 1
      }
    }
  }
  boards.instanceMatrix.needsUpdate = true
  scene.add(boards)

  // The books, one instanced mesh for the lot. Four colours, all of them deck
  // tokens: parchment, oxblood, the room's own navy, and brass. A rainbow here
  // reads as a toyshop, and one colour reads as a wall — which is the only
  // reason to draw shelving rather than paint it.
  const SPINES_PER_SHELF = 10
  const spineCount = BAYS * 2 * SHELVES * SPINES_PER_SHELF
  const spines = new THREE.InstancedMesh(
    geometry(new THREE.BoxGeometry(.7, 1.06, .3)),
    material({ color: 0xffffff, roughness: .82, metalness: .02 }),
    spineCount,
  )
  const SPINE_COLOURS = [0xd8c9a8, 0x7a3b34, 0x24405e, PALETTE.goldDark, 0xb9a684, 0x5c2f2c]
  const tint = new THREE.Color()
  let spine = 0
  for (let bay = 0; bay < BAYS; bay += 1) {
    for (const side of [-1, 1]) {
      for (let shelf = 0; shelf < SHELVES; shelf += 1) {
        for (let slot = 0; slot < SPINES_PER_SHELF; slot += 1) {
          // A little jitter in height, or twelve identical bays read as a
          // texture rather than as objects.
          const height = .78 + random() * .26
          scaling.makeScale(1, height, 1)
          placement.makeTranslation(
            // Standing on the board, between the end panels, spines out toward
            // the aisle — which is the only face of the bay the room can see.
            side * BAY_X,
            SHELF_BASE + .045 + shelf * SHELF_PITCH + height * 1.06 / 2,
            BAY_Z(bay) - 1.85 + slot * .41,
          )
          spines.setMatrixAt(spine, placement.multiply(scaling))
          tint.setHex(SPINE_COLOURS[(bay * 5 + shelf * 3 + slot * 7) % SPINE_COLOURS.length])
          // Darkened with depth by hand. Fog does this for geometry and cannot
          // do it for a per-instance colour, and a far bay whose books are as
          // saturated as a near one flattens the whole recession.
          spines.setColorAt(spine, tint.multiplyScalar(1 - Math.min(.66, bay * .13)))
          spine += 1
        }
      }
    }
  }
  spines.instanceMatrix.needsUpdate = true
  if (spines.instanceColor) spines.instanceColor.needsUpdate = true
  scene.add(spines)

  // --- the practicals -------------------------------------------------------
  // Brass shades on top of the two nearest bays a side, and a point light under
  // each. The pools they throw down the shelving are what makes the room look
  // lit rather than ambient, and they are the warm accent the palette asks for.
  const shades = new THREE.InstancedMesh(
    geometry(new THREE.ConeGeometry(.66, .46, 12, 1, true)),
    material({
      color: PALETTE.gold, roughness: .32, metalness: .7,
      emissive: new THREE.Color(0x40290a), side: THREE.DoubleSide,
    }),
    4,
  )
  const lamps: THREE.PointLight[] = []
  const LAMP_BASE = [40, 40, 26, 26]
  let shade = 0
  for (const bay of [0, 2]) {
    for (const side of [-1, 1]) {
      const x = side * BAY_X
      const z = BAY_Z(bay)
      placement.makeTranslation(x, CARCASS_HEIGHT + .22, z)
      shades.setMatrixAt(shade, placement)
      const lamp = new THREE.PointLight(0xffce87, LAMP_BASE[shade], 24, 2)
      lamp.position.set(x - side * .55, CARCASS_HEIGHT - .3, z)
      scene.add(lamp)
      lamps.push(lamp)
      shade += 1
    }
  }
  shades.instanceMatrix.needsUpdate = true
  scene.add(shades)

  // --- the desk -------------------------------------------------------------
  // Its corner only, in the near right, and only so the room has a foreground
  // and therefore a scale. Off-centre and clipped on purpose: the middle of this
  // frame belongs to the slide.
  const timber = material({ color: 0x2b1e15, roughness: .6, metalness: .16 })
  const desk = new THREE.Group()
  desk.position.set(6.3, 0, 8.6)
  desk.rotation.y = -.4
  const top = new THREE.Mesh(geometry(new THREE.BoxGeometry(4.4, .17, 2.4)), timber)
  top.position.y = 1.44
  desk.add(top)
  const pedestal = new THREE.Mesh(geometry(new THREE.BoxGeometry(3.9, 1.35, 2)), timber)
  pedestal.position.y = .68
  desk.add(pedestal)
  // A green banker's shade on it, and the light it throws: the one thing in the
  // shot at reading distance.
  const readerShade = new THREE.Mesh(
    geometry(new THREE.CylinderGeometry(.4, .5, .3, 14, 1, true)),
    material({
      color: 0x1d4a3b, roughness: .38, metalness: .28,
      emissive: new THREE.Color(0x0c2c21), side: THREE.DoubleSide,
    }),
  )
  readerShade.position.set(-1.2, 1.87, .1)
  desk.add(readerShade)
  const reader = new THREE.PointLight(0xffd9a0, 16, 11, 2)
  reader.position.set(-1.2, 1.6, .1)
  desk.add(reader)
  scene.add(desk)

  // --- dust ----------------------------------------------------------------
  // Confined to the lamp pools down the two edges, small, and dim. Scattered
  // across the whole volume at additive full strength — which is what was here —
  // they read as stars, and a starfield in a library is the single most
  // confusing thing this scene could contain. See the header.
  const moteCount = 130
  const motePositions = new Float32Array(moteCount * 3)
  const speeds = new Float32Array(moteCount)
  for (let index = 0; index < moteCount; index += 1) {
    const side = index % 2 === 0 ? -1 : 1
    motePositions[index * 3] = side * (BAY_X - 1.6) + (random() - .5) * 2.6
    motePositions[index * 3 + 1] = 1 + random() * 6.5
    motePositions[index * 3 + 2] = 4 - random() * 22
    speeds[index] = .04 + random() * .12
  }
  const moteGeometry = geometry(new THREE.BufferGeometry())
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3))
  const moteMaterial = new THREE.PointsMaterial({
    color: 0xffe2b4, size: .055, sizeAttenuation: true, transparent: true, opacity: .3,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  materials.push(moteMaterial)
  scene.add(new THREE.Points(moteGeometry, moteMaterial))

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      if (!context.reduced) {
        const attribute = moteGeometry.attributes.position as THREE.BufferAttribute
        for (let index = 0; index < moteCount; index += 1) {
          const y = attribute.getY(index) + speeds[index] * delta
          attribute.setY(index, y > 7.6 ? .6 : y)
        }
        attribute.needsUpdate = true
        // The practicals breathe, slightly and out of phase, so a slide held for
        // two minutes is not a still photograph.
        for (let index = 0; index < lamps.length; index += 1) {
          const base = LAMP_BASE[index]
          lamps[index].intensity = base + Math.sin(elapsed * .5 + index * 1.7) * base * .09
        }
      }
      rig.update(delta, context.pointer)
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      // Slow, because the audience is reading during this move and a camera that
      // arrives is a camera that interrupts.
      rig.go(name, immediate, 4.5)
    },

    dispose() {
      disposeTree(scene)
      for (const entry of materials) entry.dispose()
      for (const entry of geometries) entry.dispose()
    },
  }
}
