import * as THREE from 'three'

import { OFFICE_ENVIRONMENTS } from '../app-art/office-manifest'
import { CameraRig, PALETTE, disposeTree, labelPlane, seededRandom, smoothstep } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * The fifteen firm tiers as one ascending object: a Wooden Shack on the ground
 * and a Planetary Justice Nexus above the atmosphere, with the thirteen offices
 * between them climbing a helix.
 *
 * The names, identities and finishes are read out of the product's own
 * `OFFICE_ENVIRONMENTS`, so the ladder cannot drift from the game's. What this
 * scene adds is the one thing the game never shows: all fifteen at once, in
 * order, to scale.
 *
 * This is also the deck's demonstration of a continuous camera move. Three
 * consecutive slides name this scene with the framings `shack`, `climb` and
 * `nexus`; because the scene is identical across all three, the stage does not
 * blend or rebuild anything and the camera simply flies up the helix. The
 * transition *is* the camera.
 */

/** How the six finishes in the manifest are built. */
const FINISH_LOOK: Record<string, { body: number; trim: number; glass: number; storeys: number; slender: number }> = {
  rustic: { body: 0x6b4f34, trim: 0x8a6a44, glass: 0x2a2318, storeys: 1, slender: .78 },
  heritage: { body: 0x7d6248, trim: PALETTE.goldDark, glass: 0x39424a, storeys: 2, slender: .82 },
  professional: { body: 0x4a5a68, trim: PALETTE.gold, glass: 0x5c8ea6, storeys: 4, slender: .86 },
  executive: { body: PALETTE.navy2, trim: PALETTE.gold, glass: 0x7fbcd4, storeys: 7, slender: .9 },
  international: { body: PALETTE.navy, trim: PALETTE.pixelGold, glass: 0x9ad6e4, storeys: 10, slender: .94 },
  frontier: { body: 0x2b3b52, trim: PALETTE.pixelGold, glass: 0xb6ecf2, storeys: 13, slender: 1 },
}

export function createTiersScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x060a12)
  scene.fog = new THREE.FogExp2(0x060a12, .0092)

  const rig = new CameraRig(
    {
      // Eye level with the shack, so tier 0 is the whole frame and the ladder
      // above it is only implied.
      shack: { position: [7.2, 3.1, 13.4], target: [0, 2.4, 0], fov: 36, parallax: .9 },
      // Halfway up, angled so both ends of the ladder are in shot.
      climb: { position: [17.5, 26, 26], target: [0, 24, 0], fov: 44, parallax: .7 },
      // Above the top, looking back down the whole helix.
      nexus: { position: [11, 62, 21], target: [0, 54, 0], fov: 40, parallax: .5 },
      // The full object, small, from a distance. The act's closing frame.
      whole: { position: [34, 34, 62], target: [0, 30, 0], fov: 46, parallax: .35 },
    },
    'shack',
    context.width / Math.max(1, context.height),
  )

  scene.add(new THREE.HemisphereLight(0x3c5f7c, 0x090d14, 1.1))
  const key = new THREE.DirectionalLight(0xffeccd, 2.2)
  key.position.set(-14, 40, 18)
  scene.add(key)
  const under = new THREE.PointLight(PALETTE.pixelGold, 40, 40, 2)
  under.position.set(0, 4, 4)
  scene.add(under)

  const random = seededRandom(1451)
  const materials: THREE.Material[] = []
  const material = (color: number, roughness: number, metalness = 0, emissive = 0) => {
    const made = new THREE.MeshStandardMaterial({
      color, roughness, metalness, emissive: new THREE.Color(emissive),
    })
    materials.push(made)
    return made
  }

  const spineMaterial = material(0x16202e, .9)
  const stepMaterial = material(PALETTE.navy2, .74, .1)
  const trimMaterials = new Map<number, THREE.MeshStandardMaterial>()
  const bodyMaterials = new Map<number, THREE.MeshStandardMaterial>()
  const glassMaterials = new Map<number, THREE.MeshStandardMaterial>()

  // The helix. 15 stations, 3.85 units of rise each, a third of a turn apart, on
  // a radius that widens as the firm does — so the ladder opens outward as it
  // climbs rather than boring straight up.
  const RISE = 3.85
  const platforms: THREE.Group[] = []
  const labelMaterials: THREE.Material[] = []

  for (const environment of OFFICE_ENVIRONMENTS) {
    const tier = environment.tier
    const look = FINISH_LOOK[environment.finish] ?? FINISH_LOOK.professional
    const angle = tier * (Math.PI * 2 / 5.5)
    const radius = 4.2 + tier * .72
    const height = 1.4 + tier * RISE

    const station = new THREE.Group()
    station.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
    station.rotation.y = -angle + Math.PI / 2
    scene.add(station)
    platforms.push(station)

    // The platform the office stands on.
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.2, .34, 8), stepMaterial)
    station.add(deck)

    if (!bodyMaterials.has(look.body)) bodyMaterials.set(look.body, material(look.body, .72, .06))
    if (!trimMaterials.has(look.trim)) trimMaterials.set(look.trim, material(look.trim, .3, .8))
    if (!glassMaterials.has(look.glass)) glassMaterials.set(look.glass, material(look.glass, .18, .3, 0x0a1418))
    const body = bodyMaterials.get(look.body)!
    const trim = trimMaterials.get(look.trim)!
    const glass = glassMaterials.get(look.glass)!

    // The building. One rule applied fifteen times: storeys and slenderness come
    // from the finish, so the silhouette changes character across the ladder
    // (squat timber, then masonry, then glass, then a ring) without fifteen
    // hand-authored models.
    const storeyHeight = .5
    const footprint = 2.5 - look.slender * .95
    const tower = new THREE.Group()
    tower.position.y = .17
    station.add(tower)
    for (let storey = 0; storey < look.storeys; storey += 1) {
      const taper = 1 - (storey / Math.max(1, look.storeys)) * (look.slender * .38)
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(footprint * taper, storeyHeight, footprint * taper * .82),
        storey % 3 === 1 ? glass : body,
      )
      slab.position.y = storey * storeyHeight + storeyHeight / 2
      tower.add(slab)
    }
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(footprint * .5, .16, footprint * .44),
      trim,
    )
    crown.position.y = look.storeys * storeyHeight + .08
    tower.add(crown)

    if (tier === 0) {
      // The shack gets a pitched roof and a chimney, because a flat-topped
      // one-storey box is an outbuilding and the identity line says "a weathered
      // one-room practice with a working hearth".
      const roof = new THREE.Mesh(new THREE.ConeGeometry(footprint * .95, .62, 4), trim)
      roof.rotation.y = Math.PI / 4
      roof.position.y = storeyHeight + .31
      tower.add(roof)
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(.2, .6, .2), body)
      chimney.position.set(footprint * .3, storeyHeight + .5, 0)
      tower.add(chimney)
    }

    if (environment.finish === 'frontier') {
      // The last three are not buildings. An orbital ring, a lunar embassy and a
      // planetary nexus all read as a ring around a core, so they get one.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.85, .085, 6, 48), trim)
      ring.rotation.x = Math.PI / 2 + .28
      ring.position.y = look.storeys * storeyHeight * .62
      station.add(ring)
    }

    if (tier === 14) {
      // The Planetary Justice Nexus: a second ring on a crossed axis and a lit
      // core, so the top of the ladder is unmistakably the top.
      const halo = new THREE.Mesh(new THREE.TorusGeometry(2.5, .05, 6, 64), trim)
      halo.rotation.z = Math.PI / 2
      halo.position.y = 3.5
      station.add(halo)
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(.62, 1), material(PALETTE.pixelGold, .2, .6, 0x4a3208))
      core.position.y = 3.5
      station.add(core)
    }

    // The tier's name, set in the display face and floated beside its platform.
    const name = labelPlane(environment.name, .58, {
      pixels: 72,
      weight: 700,
      font: 'Fraunces, Georgia, serif',
      color: tier === 14 ? '#f2c75b' : '#e4dbc4',
    })
    name.position.set(3.1, .9, 0)
    name.userData.billboard = true
    station.add(name)
    labelMaterials.push(name.material as THREE.Material)

    const ordinal = labelPlane(`TIER ${String(tier).padStart(2, '0')}`, .26, {
      pixels: 44, weight: 700, font: '"Courier New", monospace', letterSpacing: 3, color: 'rgba(101,201,194,.85)',
    })
    ordinal.position.set(3.1, .42, 0)
    ordinal.userData.billboard = true
    station.add(ordinal)
    labelMaterials.push(ordinal.material as THREE.Material)
  }

  // The spine: a column through the middle of the helix, so the ladder is one
  // object rather than fifteen floating platforms.
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(.5, 1.1, 14 * RISE + 8, 12), spineMaterial)
  spine.position.y = (14 * RISE + 8) / 2 - 1
  scene.add(spine)

  // Tether each platform back to the spine. The whole reason the ladder reads as
  // a climb rather than as a stack.
  for (let tier = 0; tier < OFFICE_ENVIRONMENTS.length; tier += 1) {
    const angle = tier * (Math.PI * 2 / 5.5)
    const radius = 4.2 + tier * .72
    const height = 1.4 + tier * RISE
    const outer = new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
    const inner = new THREE.Vector3(0, height - .3, 0)
    const span = outer.clone().sub(inner)
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, span.length(), 5), stepMaterial)
    strut.position.copy(inner).add(span.clone().multiplyScalar(.5))
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize())
    scene.add(strut)
  }

  // Ground, and a starfield above it. The ladder leaves the atmosphere at tier
  // twelve, so the field only begins there — below it, fog.
  const groundMaterial = material(0x101a1a, .95)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -1
  scene.add(ground)

  const starCount = 700
  const starPositions = new Float32Array(starCount * 3)
  for (let index = 0; index < starCount; index += 1) {
    const radius = 60 + random() * 90
    const theta = random() * Math.PI * 2
    starPositions[index * 3] = Math.cos(theta) * radius
    starPositions[index * 3 + 1] = 40 + random() * 110
    starPositions[index * 3 + 2] = Math.sin(theta) * radius
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMaterial = new THREE.PointsMaterial({
    color: 0xdfe9ff, size: .5, sizeAttenuation: true, transparent: true, opacity: .7,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })
  const stars = new THREE.Points(starGeometry, starMaterial)
  scene.add(stars)

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      rig.update(delta, context.pointer)
      // Labels face the camera. Only the labels: billboarding the buildings would
      // destroy the ladder's geometry, and billboarding nothing would leave the
      // names edge-on for two of the four framings.
      for (const station of platforms) {
        for (const child of station.children) {
          if (child.userData.billboard) child.lookAt(rig.camera.position)
        }
      }
      if (context.reduced) return
      stars.rotation.y = elapsed * .006
      // The top of the ladder breathes: the nexus core and both its rings turn,
      // slowly, so the frame the deck holds longest is not a still.
      const top = platforms[platforms.length - 1]
      for (const child of top.children) {
        if (child instanceof THREE.Mesh && !child.userData.billboard) {
          child.rotation.y += delta * .12 * (1 + smoothstep(Math.sin(elapsed * .2)))
        }
      }
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      // Deliberately long. This is the deck's showcase camera move, and the
      // distance between `shack` and `nexus` is sixty units of climb — anything
      // brisk here loses the sense of scale that is the entire point of the shot.
      rig.go(name, immediate, 3.2)
    },

    dispose() {
      disposeTree(scene)
      for (const entry of [...materials, ...labelMaterials, starMaterial]) entry.dispose()
      starGeometry.dispose()
    },
  }
}
