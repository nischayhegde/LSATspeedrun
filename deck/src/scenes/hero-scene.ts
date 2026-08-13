import * as THREE from 'three'

import {
  CameraRig,
  PALETTE,
  disposeTree,
  seededRandom,
} from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * The title slide's background: the scales of justice at rest, over a receding
 * skyline, in royal blue and gold.
 *
 * This used to assemble itself out of nine flying parts as the presentation
 * opened. That gesture ate the title. The mark now stands composed from the
 * first frame, with only motes, a slow pan sway, and the seal rings moving —
 * a still picture that is slightly alive, not a cutaway the copy has to wait
 * out.
 *
 * Behind it, sixty extruded blocks in three receding ranks read as a city under
 * fog. In front of it, three light shafts and a few hundred gold motes. The
 * readable title is the DOM overlay, not this scene.
 *
 * ## Depth of field, honestly
 *
 * There is no bokeh pass. `IllustratedRenderPass` finds its contours by reading
 * the depth buffer and reconstructing normals from it, so anything that blurs
 * depth before the contour pass runs would dissolve exactly the ink lines the
 * look is made of, and anything that blurs *after* it would smear those lines
 * into grey. Depth is cued the way an illustrator cues it instead: exponential
 * fog, three explicit tonal ranks in the skyline, and an additive haze plane
 * behind the mark. The result is a deep image with sharp drawing in it, which is
 * the correct answer for this render style rather than a compromise.
 */

export function createHeroScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.stage)
  // Dense enough that the third rank of the skyline is barely a value change,
  // which is what makes the city read as distance rather than as small boxes.
  scene.fog = new THREE.FogExp2(0x070b14, .0165)

  const rig = new CameraRig(
    {
      assemble: { position: [0, 7.4, 22], target: [0, 6.6, 0], fov: 34, parallax: 1 },
      wide: { position: [-9.5, 12.5, 34], target: [1, 5.4, -6], fov: 40, parallax: .75 },
      beam: { position: [2.6, 2.1, 12.6], target: [0, 8.4, -1], fov: 46, parallax: .5 },
    },
    'assemble',
    context.width / Math.max(1, context.height),
  )

  const random = seededRandom(20260810)

  // --- lighting ------------------------------------------------------------
  // Not the standard harness rig: this scene is a single lit object in a black
  // room, so the key is a hard spot from above and the ambient exists only to
  // stop the unlit sides going to pure black, which the banding in the
  // illustrated pass would turn into a flat hole.
  scene.add(new THREE.HemisphereLight(0x2c4d68, 0x05070c, .85))
  const key = new THREE.SpotLight(0xfff0cf, 260, 46, .62, .5, 1.9)
  key.position.set(-4.6, 21, 9)
  scene.add(key)
  scene.add(key.target)
  key.target.position.set(0, 6.2, 0)
  const rim = new THREE.DirectionalLight(0x7fc6d8, .9)
  rim.position.set(9, 5, -7)
  scene.add(rim)
  // From the camera's side, and the mark is unreadable without it.
  //
  // The rig above is a hard spot from above at (-4.6, 21, 9) and a rim from
  // behind at (9, 5, -7). Neither of them is in front of the object. The spot's
  // cone lands on the top faces of the beam and the pans and on the floor; the
  // rim draws an edge on the far side. What the camera is looking at — the
  // front of a 9.4-unit navy column, the front edge of the beam across it and
  // the near face of both pans — is lit by nothing but a .85 hemisphere, and
  // navy at roughness .62 under a .85 hemisphere is black.
  //
  // Photographed, the whole glyph came out as one featureless dark obelisk: the
  // scales-of-justice mark that the header of this file calls "the first thing
  // the audience sees" was, on a projector, a slab. It is the deck's opening
  // frame and it was the least finished thing in it.
  //
  // Weak, cool and well off-axis on purpose. This is a night exterior and the
  // spot is still the key — a fill that competes flattens the object into the
  // haze plane behind it, which is the failure the fog and that plane exist to
  // prevent. All this has to do is put the navy a few values above black so the
  // contour pass has an edge to find.
  const fill = new THREE.DirectionalLight(0xa8c4e8, .85)
  fill.position.set(-7, 9, 17)
  scene.add(fill)
  // Dimmer than it was: at 26 this warm bounce over navy at the column's foot
  // mixed to a distinctly green post, which is not a colour in the deck.
  const goldBounce = new THREE.PointLight(PALETTE.pixelGold, 15, 16, 2)
  goldBounce.position.set(0, 3.1, 1.4)
  scene.add(goldBounce)

  // --- the environment the metal is reflecting -----------------------------
  /**
   * Why the gold was not gold.
   *
   * `gold` is `metalness: .82`, and a metal in a physically based renderer is
   * almost entirely *reflection* — its diffuse term goes to nothing as metalness
   * approaches 1, so what it shows is its surroundings. This scene had no
   * environment, so every metal in it was reflecting a void and resolving to
   * near-black, lit only by whatever specular highlight a direct light happened
   * to throw. Photographed, the beam, the pan rims, the collar and the seal
   * rings all came out the same dull olive as the navy around them, which is
   * most of why the mark read as one mass: the two materials that were supposed
   * to separate it into gold furniture and a navy body were rendering as the
   * same value.
   *
   * This is not a lighting bug and no amount of adding lights fixes it. What it
   * needs is something to reflect.
   *
   * Built rather than loaded: a 64×32 equirectangular gradient is far too small
   * to be seen as an image in a reflection but is entirely enough to give a
   * metal a horizon, which is all a metal needs to read as metal. Three bands,
   * matching the picture the scene actually paints — cold night sky above, the
   * warm haze of the lit city at the horizon, and the gold bounce off the floor
   * below. It costs one 2 KB canvas at build time and nothing per frame.
   */
  const environmentTexture = (() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 32
    const context2d = canvas.getContext('2d')
    if (!context2d) return null
    const gradient = context2d.createLinearGradient(0, 0, 0, 32)
    gradient.addColorStop(0, '#0a1526')
    gradient.addColorStop(.46, '#20304a')
    gradient.addColorStop(.54, '#6b5a3a')
    gradient.addColorStop(1, '#2a1d0b')
    context2d.fillStyle = gradient
    context2d.fillRect(0, 0, 64, 32)
    const texture = new THREE.CanvasTexture(canvas)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  })()

  const pmrem = new THREE.PMREMGenerator(context.renderer)
  // The whole render target is kept, not just its texture. `fromEquirectangular`
  // returns a `WebGLRenderTarget`, and disposing the texture off it leaves the
  // target itself allocated — which would leak one per build, and the deck
  // rebuilds a scene whenever the LRU has evicted it and the presenter comes
  // back. `WebGLRenderTarget.dispose()` releases the texture with it.
  const environmentTarget = environmentTexture ? pmrem.fromEquirectangular(environmentTexture) : null
  environmentTexture?.dispose()
  pmrem.dispose()
  if (environmentTarget) {
    scene.environment = environmentTarget.texture
    // Held well below 1: this is a night exterior and the environment is here to
    // give the metal a horizon, not to relight the scene. The hard spot is still
    // the key.
    scene.environmentIntensity = .55
  }

  // --- materials -----------------------------------------------------------
  const navy = new THREE.MeshStandardMaterial({ color: PALETTE.navy, roughness: .62, metalness: .12 })
  const navyDeep = new THREE.MeshStandardMaterial({ color: 0x0b1a26, roughness: .78, metalness: .05 })
  const gold = new THREE.MeshStandardMaterial({ color: PALETTE.gold, roughness: .3, metalness: .82 })
  const goldBright = new THREE.MeshStandardMaterial({ color: PALETTE.pixelGold, roughness: .22, metalness: .7, emissive: new THREE.Color(0x2a1c05) })
  const cream = new THREE.MeshStandardMaterial({ color: PALETTE.goldSoft, roughness: .52, metalness: .1 })
  const stone = new THREE.MeshStandardMaterial({ color: 0x141d28, roughness: .92, metalness: 0 })
  const materials = [navy, navyDeep, gold, goldBright, cream, stone]

  // --- the floor and its inlaid seal ---------------------------------------
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 72), stone)
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  // Three concentric gold rings, the way a seal is struck into a floor. Thin
  // torus rings rather than a texture, so the contour pass finds a real edge on
  // them and draws them as inlay rather than as paint.
  const sealRings = new THREE.Group()
  for (const [radius, thickness, material] of [[6.4, .05, gold], [7.1, .022, goldBright], [10.4, .03, gold]] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 6, 96), material)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = .012
    sealRings.add(ring)
  }
  scene.add(sealRings)

  // --- the skyline ---------------------------------------------------------
  // Three ranks, each further back, darker and taller than the last. The firm's
  // own ladder runs from a one-room shack to a planetary command chamber, so the
  // silhouette gets taller as it recedes rather than shorter: the city is
  // something to climb into.
  const skyline = new THREE.Group()
  const rankSpec = [
    { depth: -26, count: 22, spread: 62, minHeight: 3.4, maxHeight: 11, material: navy },
    { depth: -40, count: 20, spread: 84, minHeight: 8, maxHeight: 21, material: navyDeep },
    { depth: -56, count: 18, spread: 108, minHeight: 14, maxHeight: 33, material: navyDeep },
  ]
  for (const rank of rankSpec) {
    for (let index = 0; index < rank.count; index += 1) {
      const height = rank.minHeight + random() * (rank.maxHeight - rank.minHeight)
      const width = 2.1 + random() * 3.4
      const block = new THREE.Mesh(new THREE.BoxGeometry(width, height, 2.6 + random() * 3), rank.material)
      block.position.set(
        (index / (rank.count - 1) - .5) * rank.spread + (random() - .5) * 3,
        height / 2,
        rank.depth + (random() - .5) * 5,
      )
      skyline.add(block)
      // A lit crown on roughly a third of them. One emissive cream slab is
      // enough to say "occupied" at this distance and costs a draw call.
      if (random() > .66) {
        const crown = new THREE.Mesh(new THREE.BoxGeometry(width * .5, .34, .4), cream)
        crown.position.set(block.position.x, height + .18, block.position.z + 1.4)
        skyline.add(crown)
      }
    }
  }
  scene.add(skyline)

  // --- the mark, in nine parts ---------------------------------------------
  // Proportions traced from the favicon's own path data (`frontend/index.html`),
  // scaled up: a 34-unit column, a 24-unit beam across it at two thirds height,
  // two pans hanging from the beam ends, a plinth under it.
  const mark = new THREE.Group()
  scene.add(mark)

  const registerPart = (mesh: THREE.Object3D, to: THREE.Vector3) => {
    mark.add(mesh)
    mesh.position.copy(to)
  }

  /**
   * The mark, measured off the favicon instead of approximated.
   *
   * The previous build was written as "traced from the favicon's own path data,
   * scaled up" and was not: it had a 12.6-wide beam .42 thick over a column .98
   * across, and pans built as `ConeGeometry(1.85, 1.35, 3)` with a
   * `TorusGeometry(1.85, .055, 5, 3)` lip. Three radial segments is a triangular
   * pyramid and three tubular segments is a triangular ring, so what hung off
   * the beam were two angular **diamonds** — and photographed at a third scale,
   * which is roughly the projected size from the back of a room, they read as
   * pendants rather than as the pans of a balance. The mark the deck is named
   * around did not read as scales.
   *
   * So the geometry is now derived from the glyph rather than eyeballed against
   * it. These are the real paths out of `frontend/index.html`, in its own 24×24
   * viewBox:
   *
   *   body   M7 20h10v2H7z  M10 18h4v2h-4z  M11 7h2v11h-2z  M10 3h4v3h-4z
   *   beam   M3 6h18v2H3z  M4 8h1v3H4z  M19 8h1v3h-1z
   *          M1 11h7l-1.75 3.25h-3.5z   M16 11h7l-1.75 3.25h-3.5z
   *
   * Two things fall out of reading them properly. The beam is 2 units thick
   * against a column 2 units wide — the same weight, where the old build made
   * the beam less than half the column. And a pan is `h7` across the top
   * narrowing to `h3.5` at the bottom over `3.25` of drop: a **trapezoid**, which
   * is a truncated cone in elevation, not a cone and certainly not a triangle.
   *
   * Everything below is expressed in glyph coordinates through `gx`/`gy`/`gs` so
   * the proportions cannot drift again. If the favicon changes, change `S` and
   * these numbers, and the model follows.
   */
  /**
   * World units per glyph unit, and the number that decides the composition.
   *
   * The glyph puts its beam and pans across the middle of its own height — the
   * pans hang from y 11 to 14.25 of a mark that runs 3 to 22 — so a mark that
   * stands on the floor and fills the frame *always* lands its scales in the
   * vertical centre of the picture. That is where a centred DOM headline is,
   * and no value of this constant changes it: shrink the mark and the pans fall
   * towards the floor, grow it and they climb past the top of the frame. It is
   * a property of the glyph, not of the framing.
   *
   * So the type moved instead — `.body-title` in `deck.css` now sets its block
   * at the top rather than centring it — and this is sized to put the whole
   * head of the scales in the band below it: finial around 37% of frame height,
   * pans between 63% and 74%, base on the floor at the bottom edge.
   */
  const S = .47
  /** Glyph x (0..24, centre 12) to world x. */
  const gx = (value: number) => (value - 12) * S
  /** Glyph y (0..24, downward, 22 is the ground line) to world y, upward. */
  const gy = (value: number) => (22 - value) * S
  /** A glyph length to a world length. */
  const gs = (value: number) => value * S

  // `M7 20h10v2H7z` — the base plate. Octagonal rather than square: the glyph is
  // a flat mark and this is a monument, and eight sides catch the key light on
  // two faces at once where four catch it on one.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(gs(5), gs(5.4), gs(2), 8), navy)
  registerPart(base, new THREE.Vector3(0, gy(21), 0))

  // `M10 18h4v2h-4z` — the plinth the column stands on.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(gs(2), gs(2.2), gs(2), 8), navy)
  registerPart(plinth, new THREE.Vector3(0, gy(19), 0))

  // `M11 7h2v11h-2z` — the column. Two glyph units across, so radius 1.
  const column = new THREE.Mesh(new THREE.CylinderGeometry(gs(.92), gs(1.08), gs(11), 16), navy)
  registerPart(column, new THREE.Vector3(0, gy(12.5), 0))

  // Not in the glyph. A gold collar where the beam crosses the column, because
  // in three dimensions a bar passing through a post needs a joint or it reads
  // as two objects that happen to overlap.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(gs(1.32), gs(.3), 10, 24), goldBright)
  collar.rotation.x = Math.PI / 2
  registerPart(collar, new THREE.Vector3(0, gy(8.6), 0))

  // `M3 6h18v2H3z` — the beam. Eighteen across and two thick, which is the
  // single biggest change to how the mark reads at distance: this is now a
  // heavy gold bar rather than a wire.
  const beam = new THREE.Mesh(new THREE.BoxGeometry(gs(18), gs(2), gs(1.3)), gold)
  registerPart(beam, new THREE.Vector3(0, gy(7), 0))

  // `M10 3h4v3h-4z` — a block standing on the beam, which is what the glyph
  // draws and what the octahedron this used to be was not. Kept a plain box on
  // purpose: the first attempt tapered it, and a four-sided taper with its top
  // face lit reads as a gold cup sitting on the beam, which is both wrong and
  // the third trapezoid in a picture that only wants two.
  // `goldBright` rather than `gold`, and that is not interchangeable here. `gold`
  // is metalness .82, so at this size and angle it shows almost nothing but the
  // dark half of the environment and the cap came out a grey nub. This one
  // carries an emissive term, which is what a small bright accent at the top of
  // a dark object needs in order to stay the top of the object.
  const finial = new THREE.Mesh(new THREE.BoxGeometry(gs(2.7), gs(3), gs(1.1)), goldBright)
  registerPart(finial, new THREE.Vector3(0, gy(4.5), 0))

  /**
   * A pan, with the group's origin at the point it hangs from — the underside of
   * the beam — so its `to` is simply the beam end and the bob in `update` moves
   * the whole assembly the way a real one would swing.
   *
   * `M4 8h1v3H4z` is the hanger, three units of drop. `M1 11h7l-1.75 3.25h-3.5z`
   * is the dish: 7 across at the rim, 3.5 across at the foot, 3.25 deep. Solid
   * rather than an open bowl, which is both what the glyph draws and what
   * survives being small — an open dish shows its own interior and at a third
   * scale that inner ellipse muddles the silhouette instead of describing it.
   */
  const buildPan = (side: 1 | -1) => {
    const group = new THREE.Group()

    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(gs(.5), gs(.5), gs(3), 8), gold)
    hanger.position.y = -gs(1.5)
    group.add(hanger)

    const dish = new THREE.Mesh(new THREE.CylinderGeometry(gs(3.5), gs(1.75), gs(3.25), 28), cream)
    dish.position.y = -gs(3 + 3.25 / 2)
    group.add(dish)

    // The rim, in bright gold along the dish's widest edge. This is the line
    // that separates a pan from the wall of fog behind it: cream against navy
    // is a value step the contour pass can find, and a lit gold edge on top of
    // it is one the eye finds without looking.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(gs(3.5), gs(.16), 8, 40), goldBright)
    rim.rotation.x = Math.PI / 2
    rim.position.y = -gs(3)
    group.add(rim)

    group.userData.side = side
    return group
  }

  /** Where a pan hangs from: the beam's underside, at the hanger's own x. */
  const PAN_HANG_Y = gy(8)
  const leftPan = buildPan(-1)
  registerPart(leftPan, new THREE.Vector3(gx(4.5), PAN_HANG_Y, 0))
  const rightPan = buildPan(1)
  registerPart(rightPan, new THREE.Vector3(gx(19.5), PAN_HANG_Y, 0))

  // --- volumetric shafts ---------------------------------------------------
  // Additive open cones with `depthWrite` off, so they contribute light without
  // contributing depth — which matters, because the contour pass would
  // otherwise trace an ink outline around each shaft and turn a beam of light
  // into a drawn triangle.
  const shafts = new THREE.Group()
  const shaftMaterials: THREE.Material[] = []
  for (const [x, z, radius, opacity] of [[-4.6, 6.5, 4.4, .07], [3.4, -2.2, 6.2, .045], [-1.2, -8, 8.4, .03]] as const) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe9b8,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    shaftMaterials.push(material)
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, 30, 24, 1, true), material)
    cone.position.set(x, 15, z)
    shafts.add(cone)
  }
  scene.add(shafts)

  // A haze plane behind the mark. This is the only depth cue in the scene that
  // is not fog, and it exists because fog alone cannot separate the mark from a
  // skyline of the same hue: the plane lifts everything behind it by a constant
  // amount, so the mark reads against a wash rather than against buildings.
  const hazeMaterial = new THREE.MeshBasicMaterial({
    color: 0x1c3348, transparent: true, opacity: .38, depthWrite: false, toneMapped: false,
  })
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(150, 60), hazeMaterial)
  haze.position.set(0, 22, -20)
  scene.add(haze)

  // --- motes ---------------------------------------------------------------
  // Six hundred points drifting up through the shafts. One draw call, and the
  // single cheapest thing in the deck that makes a still frame feel alive.
  const moteCount = 600
  const motePositions = new Float32Array(moteCount * 3)
  const moteSpeeds = new Float32Array(moteCount)
  const motePhases = new Float32Array(moteCount)
  for (let index = 0; index < moteCount; index += 1) {
    motePositions[index * 3] = (random() - .5) * 44
    motePositions[index * 3 + 1] = random() * 26
    motePositions[index * 3 + 2] = (random() - .5) * 30 - 2
    moteSpeeds[index] = .16 + random() * .5
    motePhases[index] = random() * Math.PI * 2
  }
  const moteGeometry = new THREE.BufferGeometry()
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3))
  const moteMaterial = new THREE.PointsMaterial({
    color: 0xffe1a4,
    size: .085,
    sizeAttenuation: true,
    transparent: true,
    opacity: .62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  const motes = new THREE.Points(moteGeometry, moteMaterial)
  scene.add(motes)

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      if (context.reduced) {
        rig.update(delta, context.pointer)
        return
      }

      const swing = Math.sin(elapsed * (Math.PI * 2 / 2.1)) * .014
      mark.rotation.z = swing
      leftPan.position.y = PAN_HANG_Y + Math.sin(elapsed * .74) * .06
      rightPan.position.y = PAN_HANG_Y - Math.sin(elapsed * .74) * .06
      sealRings.rotation.y = elapsed * .018

      const positions = moteGeometry.attributes.position as THREE.BufferAttribute
      for (let index = 0; index < moteCount; index += 1) {
        const y = positions.getY(index) + moteSpeeds[index] * delta
        positions.setY(index, y > 27 ? -1 : y)
        positions.setX(index, positions.getX(index) + Math.sin(elapsed * .5 + motePhases[index]) * delta * .12)
      }
      positions.needsUpdate = true

      for (let index = 0; index < shaftMaterials.length; index += 1) {
        const material = shaftMaterials[index] as THREE.MeshBasicMaterial
        material.opacity = (.07 - index * .02) * (.78 + Math.sin(elapsed * (.4 + index * .17)) * .22)
      }

      rig.update(delta, context.pointer)
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      rig.go(name, immediate ?? true, 0)
    },

    dispose() {
      environmentTarget?.dispose()
      disposeTree(scene)
      for (const material of [...materials, ...shaftMaterials, hazeMaterial, moteMaterial]) {
        material.dispose()
      }
      moteGeometry.dispose()
    },
  }
}
