import * as THREE from 'three'

import { coverIsUp } from './cover-stage'
import {
  CameraRig,
  PALETTE,
  disposeTree,
  easeOutCubic,
  labelPlane,
  seededRandom,
  smoothstep,
} from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * The opening scene: the scales of justice assembling themselves out of a dark
 * room, over a receding skyline, in royal blue and gold.
 *
 * ## What this is a picture of
 *
 * The product's mark is a scales-of-justice glyph in navy, gold and cream — it is
 * the favicon, and the same four strokes appear on the boot spinner and on every
 * seal in the game. So the first thing the audience sees is that mark, built at
 * three dimensions and put together in front of them: nine parts fly in from
 * scattered positions and settle into a single object. That is the deck's whole
 * argument in one gesture, and it takes four seconds.
 *
 * Behind it, sixty extruded blocks in three receding ranks read as a city under
 * fog — the skyline the firm ends up owning. In front of it, three light shafts
 * and a few hundred gold motes.
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

type Part = {
  mesh: THREE.Object3D
  /** Where the part starts, before assembly. */
  from: THREE.Vector3
  to: THREE.Vector3
  fromQuaternion: THREE.Quaternion
  toQuaternion: THREE.Quaternion
  /** 0..1 along the assembly, so parts land in a deliberate order. */
  delay: number
}

const ASSEMBLE_SECONDS = 4.2

export function createHeroScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.stage)
  // Dense enough that the third rank of the skyline is barely a value change,
  // which is what makes the city read as distance rather than as small boxes.
  scene.fog = new THREE.FogExp2(0x070b14, .0165)

  // Whether this scene is being built behind the start card, which decides
  // whether the mark is already assembling on its first frame. Read once, here:
  // the card raises the flag during its own first render, which is before
  // `deck.tsx`'s effect builds this scene, so it is reliably up by now.
  const startsCovered = coverIsUp()

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
  const goldBounce = new THREE.PointLight(PALETTE.pixelGold, 26, 16, 2)
  goldBounce.position.set(0, 3.1, 1.4)
  scene.add(goldBounce)

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
  const parts: Part[] = []

  const registerPart = (mesh: THREE.Object3D, to: THREE.Vector3, delay: number, tumble = 1) => {
    mark.add(mesh)
    const toQuaternion = mesh.quaternion.clone()
    // Parts arrive from a shell around the object rather than from off-screen:
    // an object that assembles from beyond the frame reads as things flying in,
    // and an object that assembles from just outside itself reads as an object
    // pulling itself together.
    const azimuth = random() * Math.PI * 2
    const radius = 11 + random() * 9
    const from = new THREE.Vector3(
      to.x + Math.cos(azimuth) * radius,
      to.y + (random() - .25) * 12,
      to.z + Math.sin(azimuth) * radius * .55,
    )
    const fromQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (random() - .5) * 3.1 * tumble,
      (random() - .5) * 3.1 * tumble,
      (random() - .5) * 3.1 * tumble,
    )).multiply(toQuaternion)
    parts.push({ mesh, from, to: to.clone(), fromQuaternion, toQuaternion, delay })
  }

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.2, 1.5, 8), navy)
  registerPart(plinth, new THREE.Vector3(0, .75, 0), 0, .35)

  const plinthCap = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.15, .22, 8), gold)
  registerPart(plinthCap, new THREE.Vector3(0, 1.6, 0), .05, .35)

  const column = new THREE.Mesh(new THREE.CylinderGeometry(.42, .56, 9.4, 12), navy)
  registerPart(column, new THREE.Vector3(0, 6.4, 0), .16)

  const collar = new THREE.Mesh(new THREE.TorusGeometry(.62, .13, 8, 20), goldBright)
  collar.rotation.x = Math.PI / 2
  registerPart(collar, new THREE.Vector3(0, 9.6, 0), .3)

  const beam = new THREE.Mesh(new THREE.BoxGeometry(12.6, .42, .52), gold)
  registerPart(beam, new THREE.Vector3(0, 10.5, 0), .42)

  const finial = new THREE.Mesh(new THREE.OctahedronGeometry(.72, 0), goldBright)
  registerPart(finial, new THREE.Vector3(0, 11.5, 0), .56)

  /** A pan: an open inverted cone on three chains, as the glyph draws it. */
  const buildPan = (side: 1 | -1) => {
    const group = new THREE.Group()
    const dish = new THREE.Mesh(new THREE.ConeGeometry(1.85, 1.35, 3, 1, true), cream)
    dish.rotation.x = Math.PI
    group.add(dish)
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.85, .055, 5, 3), gold)
    lip.rotation.x = Math.PI / 2
    lip.position.y = .675
    group.add(lip)
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + Math.PI / 6
      const anchor = new THREE.Vector3(Math.cos(angle) * 1.7, .675, Math.sin(angle) * 1.7)
      const top = new THREE.Vector3(0, 2.55, 0)
      const span = top.clone().sub(anchor)
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, span.length(), 4), gold)
      chain.position.copy(anchor).add(span.clone().multiplyScalar(.5))
      chain.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize())
      group.add(chain)
    }
    // The hanger, from the beam end down to where the chains meet.
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 1.5, 4), gold)
    hanger.position.y = 3.3
    group.add(hanger)
    group.userData.side = side
    return group
  }

  const leftPan = buildPan(-1)
  registerPart(leftPan, new THREE.Vector3(-5.5, 6.4, 0), .68, .6)
  const rightPan = buildPan(1)
  registerPart(rightPan, new THREE.Vector3(5.5, 6.4, 0), .82, .6)

  // The wordmark, laid into the floor in front of the plinth, struck rather
  // than printed: the shadow pass sits under the face in the app's own foil
  // relief colour. Set in the deck's display face, which is now Archivo — a
  // wordmark in the 3D that did not match the wordmark in the DOM would be the
  // most visible possible version of an inconsistent type system.
  const wordShadow = labelPlane('LAWYER TYCOON', 1.06, {
    pixels: 96, weight: 800, font: 'Archivo, Inter, sans-serif', letterSpacing: 9, color: 'rgba(104,68,16,.55)', align: 'center',
  })
  const word = labelPlane('LAWYER TYCOON', 1.06, {
    pixels: 96, weight: 800, font: 'Archivo, Inter, sans-serif', letterSpacing: 9, color: '#f2c75b', align: 'center',
  })
  for (const [mesh, lift] of [[wordShadow, .014], [word, .02]] as const) {
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(0, lift, 7.1)
    scene.add(mesh)
  }
  word.position.z -= .05
  const wordMaterials = [wordShadow.material as THREE.Material, word.material as THREE.Material]

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

  // --- state ---------------------------------------------------------------
  /**
   * The assembly is held while the cover is up.
   *
   * Without this the deck's opening gesture is wasted: the scene is built the
   * instant the page loads, `ASSEMBLE_SECONDS` is 4.2, and the presenter spends
   * a good deal longer than that on the title card before pressing Enter — so
   * the shutter has always opened on a mark that finished assembling behind it,
   * unseen. Holding it means the nine parts fly together *as the presentation
   * begins*, which is when it was written to happen.
   */
  let assembly = context.reduced ? 1 : 0
  let covered = startsCovered

  const applyAssembly = () => {
    for (const part of parts) {
      // Each part gets the same shaped curve over a different window, so the
      // object lands in an order — plinth, column, beam, then the pans, which is
      // the order you would actually build it in.
      const window = .55
      const local = (assembly - part.delay * (1 - window)) / window
      const t = easeOutCubic(Math.min(1, Math.max(0, local)))
      part.mesh.position.lerpVectors(part.from, part.to, t)
      part.mesh.quaternion.slerpQuaternions(part.fromQuaternion, part.toQuaternion, t)
      const material = (part.mesh as THREE.Mesh).material as THREE.Material | undefined
      if (material && 'opacity' in material) {
        material.transparent = t < 1
        ;(material as THREE.MeshStandardMaterial).opacity = t
      }
    }
  }
  applyAssembly()

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      if (covered && !coverIsUp()) covered = false

      if (!context.reduced && !covered) {
        assembly = Math.min(1, assembly + delta / ASSEMBLE_SECONDS)
        applyAssembly()

        // The beam settles the way the boot spinner's does: the app animates its
        // glyph with `boot-settle`, a ±5° rotation on a 2.1s period, and the
        // same motion here ties the deck's first frame to the product's.
        const settled = smoothstep((assembly - .75) / .25)
        const swing = Math.sin(elapsed * (Math.PI * 2 / 2.1)) * .052
        // Amplitude decays as the object completes, so it arrives at rest.
        mark.rotation.z = swing * (1 - settled * .72)
        mark.rotation.y = Math.sin(elapsed * .19) * .07 + (1 - settled) * .3
        leftPan.position.y = 6.4 + Math.sin(elapsed * .74) * .1
        rightPan.position.y = 6.4 - Math.sin(elapsed * .74) * .1

        sealRings.rotation.y = elapsed * .028

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
      }

      // The wordmark fades up only once the object it names is standing.
      const nameIn = smoothstep((assembly - .82) / .18)
      for (const material of wordMaterials) {
        ;(material as THREE.MeshBasicMaterial).opacity = nameIn
      }

      rig.update(delta, context.pointer)
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      // A long move: this scene's framings are far apart and the object in the
      // middle is the thing being looked at, so the dolly is allowed to take its
      // time. Anything under about a second here reads as a jump cut.
      rig.go(name, immediate, 2.1)
    },

    dispose() {
      disposeTree(scene)
      for (const material of [...materials, ...shaftMaterials, hazeMaterial, moteMaterial, ...wordMaterials]) {
        material.dispose()
      }
      moteGeometry.dispose()
    },
  }
}
