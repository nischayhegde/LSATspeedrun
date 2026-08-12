import * as THREE from 'three'

import { CameraRig, PALETTE, disposeTree, seededRandom } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * The scene a slide with no scene gets: the practice's own reading room, held as
 * a wide shot, with the copy of eighteen slides laid over it.
 *
 * ## Not an empty canvas and not a hidden one
 *
 * Two reasons, both unchanged. First, the deck's transition system composites
 * the outgoing and incoming *frames*, so every slide needs a frame — making the
 * canvas absent for some slides would mean two separate transition paths and one
 * of them would be the one that breaks on stage. Second, a slide of pure copy
 * over a flat field looks like a slide, and the brief was that it should not.
 *
 * ## Why it was rebuilt
 *
 * What was here was three draw calls of almost nothing: a floor, a wall 46 units
 * back, and 260 motes, lit to a mean luminance of about 2/255. The reasoning was
 * that it sits behind an opaque field on most of the slides that name it, so
 * nobody would ever look at it. That turned out to be false in three separate
 * ways, and the founder's walkthrough found all three at once:
 *
 *   - The seven demo slides paint no field at all, so this is what surrounds the
 *     app embed on every one of them — about 3% of the frame, permanently.
 *   - The `ink-bleed` transitions dissolve this scene in GL, in front of copy
 *     layers that are mid-crossfade.
 *   - Anything that goes wrong with a slide layer's opacity puts this on the
 *     projector on its own, full frame, and the room is then looking at a near
 *     black rectangle with a few specks in it. That is the frame that came back
 *     with "I'm so confused, what is even happening on this slide?" — see
 *     `Batch.claim` in `engine/transitions.ts` for the defect that produced it.
 *     That defect is fixed, and a default scene that is legible when it is seen
 *     is the second half of the same answer.
 *
 * So it is now a room: two ranks of archive bays receding into fog, brass
 * practicals on top of them, a window at the far end with the city behind it, and
 * the corner of a desk in the near foreground. Everything in it is drawn from the
 * app's own office — the shelving, the reading lamps, the skyline through the
 * glass — because a slide that argues about the product should not be sitting in
 * a void when the product has a world of its own. Fifteen draw calls, instanced
 * where it counts, and no shadow-casting light: this still costs less than any
 * other scene in the deck.
 *
 * ## The three framings
 *
 * Still the same shot from three places, so consecutive copy slides share the
 * scene and get an almost imperceptible camera move rather than a scene change.
 * What changed is that all three now point at the room. `low` used to be a
 * camera at eye height 1.3 aimed *upward* at a point behind and above the far
 * wall, so it framed the one part of the set with nothing in it: fog, and the
 * motes. Every framing here has the colonnade running through it and the window
 * somewhere in frame.
 */

/** Where the far wall is. Everything else is placed relative to it. */
const BACK = -40

export function createBackdropScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  const night = new THREE.Color(0x080f20)
  scene.background = night
  // Thin enough that the window 55 units away is still 60% of itself, which is
  // the whole point of putting it there.
  scene.fog = new THREE.FogExp2(night.getHex(), .013)

  const rig = new CameraRig(
    {
      // Centred down the colonnade with the window at the end of it.
      still: { position: [0, 4.4, 15], target: [0, 5.2, -30], fov: 42, parallax: 1 },
      // Off the axis, so the two ranks of bays are no longer symmetrical and the
      // perspective lines run diagonally. This is the parallax between two
      // consecutive copy slides, and it is the only thing that has to differ.
      drift: { position: [-4.8, 3.7, 13], target: [1.4, 5, -28], fov: 46, parallax: 1 },
      // Low and beside the desk, looking up the room. Aimed at the window rather
      // than over the top of the wall.
      low: { position: [3.4, 1.6, 10.5], target: [-1.6, 5.6, -30], fov: 48, parallax: 1 },
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
  const geometry = <T extends THREE.BufferGeometry>(made: T) => {
    geometries.push(made)
    return made
  }

  // --- light ----------------------------------------------------------------
  // A cool wash from above, one warm key raking down the left rank, and the
  // practicals below. The old rig had a key at 1.35 with no bounce and nothing
  // for it to land on; this is the tier scene's magnitudes, which are the ones
  // that photograph.
  scene.add(new THREE.HemisphereLight(0x4a6a9c, 0x0a1120, 1.5))
  const key = new THREE.DirectionalLight(0xffe6bd, 2.4)
  key.position.set(-11, 14, 9)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x8fb4e8, .8)
  fill.position.set(9, 6, 12)
  scene.add(fill)

  // --- floor ----------------------------------------------------------------
  const floor = new THREE.Mesh(
    geometry(new THREE.PlaneGeometry(120, 120)),
    material({ color: 0x101a2c, roughness: .9, metalness: .05 }),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  // Ribs across the boards, receding. The only thing that makes a camera move
  // over a flat plane read as a camera move at all — a featureless floor is a
  // floor that appears not to pass.
  const ribGeometry = geometry(new THREE.BoxGeometry(30, .05, .13))
  const ribs = new THREE.InstancedMesh(
    ribGeometry,
    material({ color: PALETTE.navy2, roughness: .72, metalness: .12 }),
    26,
  )
  const placement = new THREE.Matrix4()
  for (let index = 0; index < 26; index += 1) {
    placement.makeTranslation(0, .026, 8 - index * 2.05)
    ribs.setMatrixAt(index, placement)
  }
  ribs.instanceMatrix.needsUpdate = true
  scene.add(ribs)

  // --- the far wall, and the window in it -----------------------------------
  const wallMaterial = material({ color: 0x122036, roughness: .95, metalness: 0 })
  const wall = new THREE.Mesh(geometry(new THREE.PlaneGeometry(80, 30)), wallMaterial)
  wall.position.set(0, 12, BACK)
  scene.add(wall)

  // The window is a hole in the wall rather than a pane on it: the wall above and
  // below and the two piers beside it, so the night behind is actually behind.
  const WINDOW = { width: 9.6, height: 11, sill: 2.4, centre: 0 }
  const lintel = new THREE.Mesh(
    geometry(new THREE.PlaneGeometry(WINDOW.width + 3.2, 1.1)),
    material({ color: PALETTE.goldDark, roughness: .42, metalness: .55 }),
  )
  lintel.position.set(WINDOW.centre, WINDOW.sill + WINDOW.height + .3, BACK + .12)
  scene.add(lintel)
  const mullionGeometry = geometry(new THREE.BoxGeometry(.16, WINDOW.height, .16))
  const mullions = new THREE.InstancedMesh(
    mullionGeometry,
    material({ color: PALETTE.goldDark, roughness: .4, metalness: .6 }),
    3,
  )
  for (let index = 0; index < 3; index += 1) {
    placement.makeTranslation(
      WINDOW.centre + (index - 1) * (WINDOW.width / 2),
      WINDOW.sill + WINDOW.height / 2,
      BACK + .16,
    )
    mullions.setMatrixAt(index, placement)
  }
  mullions.instanceMatrix.needsUpdate = true
  scene.add(mullions)

  // The city, behind the glass and below the horizon of the window: the same read
  // as the office's own window view, at a tenth of the cost. Unlit and untone-
  // mapped, so a projector cannot lose it — this is the brightest thing in the
  // shot and the thing the eye is meant to find.
  const random = seededRandom(7716)
  const towerGeometry = geometry(new THREE.BoxGeometry(1, 1, 1))
  const TOWERS = 26
  const towers = new THREE.InstancedMesh(
    towerGeometry,
    material({ color: 0x1d3350, roughness: .8, metalness: .1, emissive: new THREE.Color(0x0d2036) }),
    TOWERS,
  )
  const scaling = new THREE.Matrix4()
  for (let index = 0; index < TOWERS; index += 1) {
    const width = 1.1 + random() * 1.9
    const height = 3 + random() * 12
    const x = (index / (TOWERS - 1) - .5) * 30 + (random() - .5) * .8
    scaling.makeScale(width, height, 1.4 + random() * 3)
    placement.makeTranslation(x, height / 2 - 1.6, BACK - 8 - random() * 16)
    towers.setMatrixAt(index, placement.multiply(scaling))
  }
  towers.instanceMatrix.needsUpdate = true
  scene.add(towers)

  // Lit windows on those towers, as one additive point cloud. Cheaper than
  // emissive quads and it is what tells the room the city is awake.
  const litCount = 260
  const litPositions = new Float32Array(litCount * 3)
  for (let index = 0; index < litCount; index += 1) {
    litPositions[index * 3] = (random() - .5) * 28
    litPositions[index * 3 + 1] = -1 + random() * 11
    litPositions[index * 3 + 2] = BACK - 8 - random() * 15
  }
  const litGeometry = geometry(new THREE.BufferGeometry())
  litGeometry.setAttribute('position', new THREE.BufferAttribute(litPositions, 3))
  const litMaterial = new THREE.PointsMaterial({
    color: 0xffd79a, size: .42, sizeAttenuation: true, transparent: true, opacity: .75,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })
  materials.push(litMaterial)
  scene.add(new THREE.Points(litGeometry, litMaterial))

  // A cold sky wash inside the window opening, so the glass reads as glass and
  // the skyline has something to be a silhouette against.
  const sky = new THREE.Mesh(
    geometry(new THREE.PlaneGeometry(WINDOW.width, WINDOW.height)),
    new THREE.MeshBasicMaterial({ color: 0x1c3358, transparent: true, opacity: .9, toneMapped: false }),
  )
  materials.push(sky.material as THREE.Material)
  sky.position.set(WINDOW.centre, WINDOW.sill + WINDOW.height / 2, BACK - 1.2)
  scene.add(sky)

  // --- the two ranks of archive bays ----------------------------------------
  //
  // Six bays a side, receding. These are the shot: they put a converging line
  // down each edge of the frame, they give the fog something to eat, and they
  // leave the middle third — where every slide's copy sits — quiet.
  const BAYS = 6
  const BAY_X = 8.6
  const BAY_Z = (index: number) => 2.5 - index * 6.6
  const caseGeometry = geometry(new THREE.BoxGeometry(1.7, 6.2, 4.4))
  const cases = new THREE.InstancedMesh(
    caseGeometry,
    material({ color: 0x14263c, roughness: .84, metalness: .08 }),
    BAYS * 2,
  )
  for (let index = 0; index < BAYS; index += 1) {
    for (const side of [-1, 1]) {
      placement.makeTranslation(side * BAY_X, 3.1, BAY_Z(index))
      cases.setMatrixAt(index * 2 + (side > 0 ? 1 : 0), placement)
    }
  }
  cases.instanceMatrix.needsUpdate = true
  scene.add(cases)

  // The books. One instanced mesh for the lot, coloured per instance out of the
  // deck's palette, because a shelf of one colour is a wall and the whole reason
  // to draw shelving is that it is not one.
  const SPINES_PER_SHELF = 9
  const SHELVES = 4
  const spineCount = BAYS * 2 * SHELVES * SPINES_PER_SHELF
  const spineGeometry = geometry(new THREE.BoxGeometry(.62, 1.02, .26))
  const spines = new THREE.InstancedMesh(
    spineGeometry,
    material({ color: 0xffffff, roughness: .78, metalness: .02 }),
    spineCount,
  )
  const SPINE_COLOURS = [0x8d4a3c, 0x2f5d52, 0x2a3f6d, PALETTE.goldDark, 0x6b5340, 0x7a3f52]
  const tint = new THREE.Color()
  let spine = 0
  for (let bay = 0; bay < BAYS; bay += 1) {
    for (const side of [-1, 1]) {
      for (let shelf = 0; shelf < SHELVES; shelf += 1) {
        for (let slot = 0; slot < SPINES_PER_SHELF; slot += 1) {
          // A little jitter in height and depth, or twelve identical bays read
          // as a texture rather than as objects.
          const lean = random() * .16
          scaling.makeScale(1, .82 + random() * .3, 1)
          placement.makeTranslation(
            // Books face inward: the near face of the case is the one the room
            // can see, so they sit on the inboard side of it.
            side * (BAY_X - .82),
            1.1 + shelf * 1.42 + lean,
            BAY_Z(bay) - 1.9 + slot * .44,
          )
          spines.setMatrixAt(spine, placement.multiply(scaling))
          tint.setHex(SPINE_COLOURS[(bay * 7 + shelf * 3 + slot) % SPINE_COLOURS.length])
          // Darkened with depth by hand. The fog does this for the geometry and
          // cannot do it for a per-instance colour, and a far bay whose books are
          // as saturated as a near one flattens the whole recession.
          const depth = 1 - Math.min(.72, bay * .13)
          spines.setColorAt(spine, tint.multiplyScalar(depth))
          spine += 1
        }
      }
    }
  }
  spines.instanceMatrix.needsUpdate = true
  if (spines.instanceColor) spines.instanceColor.needsUpdate = true
  scene.add(spines)

  // --- the practicals ------------------------------------------------------
  // Four brass shades on top of the near bays, and a point light under each. The
  // pools they throw down the cases are what makes the room look lit rather than
  // ambient, and they are the warm accent the palette asks for.
  const shadeGeometry = geometry(new THREE.ConeGeometry(.62, .5, 10, 1, true))
  const shades = new THREE.InstancedMesh(
    shadeGeometry,
    material({
      color: PALETTE.gold, roughness: .34, metalness: .68,
      emissive: new THREE.Color(0x3a2708), side: THREE.DoubleSide,
    }),
    4,
  )
  const lamps: THREE.PointLight[] = []
  let shade = 0
  for (const bay of [0, 2]) {
    for (const side of [-1, 1]) {
      const x = side * BAY_X
      const z = BAY_Z(bay)
      placement.makeTranslation(x, 6.5, z)
      shades.setMatrixAt(shade, placement)
      shade += 1
      const lamp = new THREE.PointLight(0xffce87, bay === 0 ? 46 : 30, 26, 2)
      lamp.position.set(x - side * .5, 6.1, z)
      scene.add(lamp)
      lamps.push(lamp)
    }
  }
  shades.instanceMatrix.needsUpdate = true
  scene.add(shades)

  // --- the desk -------------------------------------------------------------
  // Only its corner, in the near right, and only so the room has a foreground.
  // Off-centre on purpose: the middle of this frame belongs to the slide.
  const deskMaterial = material({ color: 0x2a1d14, roughness: .62, metalness: .16 })
  const desk = new THREE.Group()
  desk.position.set(5.4, 0, 6.4)
  desk.rotation.y = -.42
  const top = new THREE.Mesh(geometry(new THREE.BoxGeometry(4.6, .16, 2.3)), deskMaterial)
  top.position.y = 1.42
  desk.add(top)
  const pedestal = new THREE.Mesh(geometry(new THREE.BoxGeometry(4.1, 1.34, 1.9)), deskMaterial)
  pedestal.position.y = .67
  desk.add(pedestal)
  // A green shade on it, and the light it throws. The one thing in the shot at
  // reading distance, which is what gives the room a scale.
  const readerShade = new THREE.Mesh(
    geometry(new THREE.CylinderGeometry(.42, .5, .3, 12, 1, true)),
    material({ color: 0x1f4a3c, roughness: .4, metalness: .3, emissive: new THREE.Color(0x0a2a20), side: THREE.DoubleSide }),
  )
  readerShade.position.set(-1.3, 1.86, .1)
  desk.add(readerShade)
  const reader = new THREE.PointLight(0xffd9a0, 22, 12, 2)
  reader.position.set(-1.3, 1.62, .1)
  desk.add(reader)
  scene.add(desk)

  // --- dust ----------------------------------------------------------------
  const moteCount = 220
  const motePositions = new Float32Array(moteCount * 3)
  const speeds = new Float32Array(moteCount)
  for (let index = 0; index < moteCount; index += 1) {
    motePositions[index * 3] = (random() - .5) * 26
    motePositions[index * 3 + 1] = random() * 12
    motePositions[index * 3 + 2] = 6 - random() * 34
    speeds[index] = .05 + random() * .16
  }
  const moteGeometry = geometry(new THREE.BufferGeometry())
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3))
  const moteMaterial = new THREE.PointsMaterial({
    color: 0xffe2b4, size: .07, sizeAttenuation: true, transparent: true, opacity: .5,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
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
          attribute.setY(index, y > 13 ? -.4 : y)
        }
        attribute.needsUpdate = true
        // The practicals breathe, slightly and out of phase, so a slide held for
        // two minutes is not a still photograph.
        for (let index = 0; index < lamps.length; index += 1) {
          const base = index < 2 ? 46 : 30
          lamps[index].intensity = base + Math.sin(elapsed * .5 + index * 1.7) * base * .1
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
