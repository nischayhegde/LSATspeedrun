import * as THREE from 'three'

import { OFFICE_ENVIRONMENTS } from '../app-art/office-manifest'
import { CameraRig, PALETTE, disposeTree, labelPlane, seededRandom, smoothstep } from './scene-kit'
import type { Framing } from './scene-kit'
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

/**
 * How the six finishes in the manifest are built.
 *
 * `glow` is what the windows are lit with, and it runs warm to cold up the
 * ladder on purpose: a hearth and an oil lamp in the timber practice, fluorescent
 * white through the professional middle, and the cold blue of a sealed building
 * at the top. Every one of the six was the same cyan before, which made the
 * ladder a single material at fifteen heights — the one reading the shot could
 * not afford, because height is the only other thing distinguishing the tiers.
 */
const FINISH_LOOK: Record<string, {
  body: number; trim: number; glass: number; glow: number; storeys: number; slender: number
}> = {
  rustic: { body: 0x6b4f34, trim: 0x8a6a44, glass: 0x8a5a24, glow: 0x5a3208, storeys: 1, slender: .78 },
  heritage: { body: 0x7d6248, trim: PALETTE.goldDark, glass: 0x9a7a44, glow: 0x4a2c0a, storeys: 2, slender: .82 },
  professional: { body: 0x4a5a68, trim: PALETTE.gold, glass: 0x9aa8a4, glow: 0x3c3a30, storeys: 4, slender: .86 },
  executive: { body: PALETTE.navy2, trim: PALETTE.gold, glass: 0x7fbcd4, glow: 0x1b4056, storeys: 7, slender: .9 },
  international: { body: PALETTE.navy, trim: PALETTE.pixelGold, glass: 0x9ad6e4, glow: 0x1b5468, storeys: 10, slender: .94 },
  frontier: { body: 0x2b3b52, trim: PALETTE.pixelGold, glass: 0xb6ecf2, glow: 0x24647a, storeys: 13, slender: 1 },
}

/**
 * THE HELIX, AS ARITHMETIC.
 *
 * Fifteen stations, `RISE` of climb each, a third of a turn apart, on a radius
 * that widens as the firm does — so the ladder opens outward as it climbs rather
 * than boring straight up.
 *
 * These four functions exist so that the camera framings and the geometry are
 * derived from the same numbers, which they were not. The framings were authored
 * as literals and every one of them targeted `[0, y, 0]`: the helix *axis*. That
 * is the one point in the scene guaranteed to have the spine in front of it and
 * nothing else, so every framing put a dark column down the middle of the frame
 * and the station being framed off at the edge, cropped. It is precisely the
 * "camera pointed at the middle of a model" the walkthrough named, and it is not
 * a taste disagreement — no literal target can track an object whose position is
 * computed somewhere else in the file.
 */
const RISE = 3.85
const TURN = Math.PI * 2 / 5.5
const stationAngle = (tier: number) => tier * TURN
const stationRadius = (tier: number) => 4.2 + tier * .72
const stationHeight = (tier: number) => 1.4 + tier * RISE
const stationPosition = (tier: number) => new THREE.Vector3(
  Math.cos(stationAngle(tier)) * stationRadius(tier),
  stationHeight(tier),
  Math.sin(stationAngle(tier)) * stationRadius(tier),
)

/**
 * A framing that frames one station.
 *
 * `swing` is the angle about the helix axis between the station and the camera,
 * and it is the whole fix. Seen from a camera a quarter turn round the axis, the
 * spine is `asin(radius / distance)` off the subject's bearing — about 19° at the
 * shack and 21° at tier seven — which puts it two thirds of the way to the frame
 * edge as a vertical the composition can use, with the subject in the middle of
 * the frame where the audience is already looking.
 *
 * `swing` is negative for the stations low on the ladder because the helix turns
 * one way: at +90° the *next* station up is nearer the camera than the one being
 * framed, so it enters the top of the frame larger than its own subject, which is
 * the black shape that was cropping the top edge of the shack shot.
 */
function orbit(options: {
  tier: number
  /** Degrees about the axis between subject and camera. */
  swing: number
  /** Axis radius the camera stands at. */
  radius: number
  /** Camera height above the station it frames. */
  lift: number
  /** How far above the station's own deck to aim. */
  aim: number
  fov: number
  parallax?: number
}): Framing {
  const bearing = stationAngle(options.tier) + (options.swing * Math.PI) / 180
  const subject = stationPosition(options.tier)
  return {
    position: [
      Math.cos(bearing) * options.radius,
      stationHeight(options.tier) + options.lift,
      Math.sin(bearing) * options.radius,
    ],
    target: [subject.x, subject.y + options.aim, subject.z],
    fov: options.fov,
    parallax: options.parallax ?? .7,
  }
}

export function createTiersScene(context: SceneContext): DeckScene {
  // A royal blue night rather than a black one.
  //
  // This scene was authored against `0x060a12`, which is very nearly black, and
  // with a key light that a projector cannot find: photographed at 1440×810 the
  // whole ladder came out as dark grey silhouettes on dark grey, with only the
  // glass bands and the billboard labels above the noise floor. That is fine on
  // a laptop panel in a dark room and it is nothing at all on a projector in a
  // lit one — which is the only place this deck is ever shown.
  //
  // The colour is not arbitrary either: the ladder is only ever seen between
  // two slides of the deck's own royal blue, so a blue night makes the reveal
  // read as the field opening onto something rather than as the frame going out.
  const NIGHT = 0x0c1734
  const scene = new THREE.Scene()
  // Dense enough to take the ground's rim with it. At .0062 the 120-unit disc
  // below the ladder still arrived at 57% of its own value, so the horizon was a
  // hard bright edge across the lower third of the climb framing with nothing
  // above or below it — most of the empty frame the walkthrough complained about
  // was that.
  scene.fog = new THREE.FogExp2(NIGHT, .0086)

  const rig = new CameraRig(
    {
      // The shack, framed: it and its platform in the middle of the frame, the
      // spine a vertical off to one side, one station of ladder above it to say
      // this is the bottom of something, and the ground under it to say where
      // the bottom is.
      // Low, so the shack is against sky rather than against the empty disc of
      // ground it stands over — at eye height above the platform the ground took
      // two thirds of the frame and had nothing on it.
      shack: { ...orbit({ tier: 0, swing: -90, radius: 12.4, lift: .2, aim: 1.5, fov: 33, parallax: .9 }) },
      // The middle of the ladder as a group of five, tier seven centred. Wide
      // enough that tiers five to nine are all in frame and the climb is a
      // pattern rather than a sample.
      // Swung the other way from `shack`, so the helix unwinds *away* from the
      // camera through the shot rather than toward it: the stations above tier
      // seven fall behind it and get smaller, which reads as a climb continuing,
      // where the near side put them in front of it and larger.
      climb: { ...orbit({ tier: 7, swing: -90, radius: 27, lift: -3, aim: 3.5, fov: 44, parallax: .7 }) },
      // The top, from above it, looking back down what has been climbed.
      nexus: { ...orbit({ tier: 14, swing: 90, radius: 26, lift: 7.5, aim: 1, fov: 40, parallax: .5 }) },
      // The full object, small, from a distance. This one targets the axis on
      // purpose, and it is the only framing that may: the subject *is* the whole
      // helix, so the spine is the subject's own centre line rather than
      // something standing in front of it.
      whole: { position: [36, 32, 60], target: [0, 29, 0], fov: 44, parallax: .35 },
    },
    'shack',
    context.width / Math.max(1, context.height),
  )

  scene.add(new THREE.HemisphereLight(0x6d8fc0, 0x101a30, 2.3))
  const key = new THREE.DirectionalLight(0xffeccd, 3.6)
  key.position.set(-14, 40, 18)
  scene.add(key)
  // From the camera's side of the ladder. Without it every framing is looking
  // at the shadowed face of fifteen buildings, because the key is behind them.
  const fill = new THREE.DirectionalLight(0x9dc0f2, 1.35)
  fill.position.set(26, 14, 30)
  scene.add(fill)
  const under = new THREE.PointLight(PALETTE.pixelGold, 90, 70, 2)
  under.position.set(0, 6, 5)
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

  const spineMaterial = material(0x28405c, .62, .28)
  const stepMaterial = material(PALETTE.navy2, .74, .1)
  const trimMaterials = new Map<number, THREE.MeshStandardMaterial>()
  const bodyMaterials = new Map<number, THREE.MeshStandardMaterial>()
  const glassMaterials = new Map<number, THREE.MeshStandardMaterial>()

  const platforms: THREE.Group[] = []
  const billboards: THREE.Object3D[] = []
  const labelMaterials: THREE.Material[] = []

  for (const environment of OFFICE_ENVIRONMENTS) {
    const tier = environment.tier
    const look = FINISH_LOOK[environment.finish] ?? FINISH_LOOK.professional
    const angle = stationAngle(tier)

    const station = new THREE.Group()
    station.position.copy(stationPosition(tier))
    station.rotation.y = -angle + Math.PI / 2
    scene.add(station)
    platforms.push(station)

    // The platform the office stands on.
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.2, .34, 8), stepMaterial)
    station.add(deck)

    if (!bodyMaterials.has(look.body)) bodyMaterials.set(look.body, material(look.body, .72, .06))
    if (!trimMaterials.has(look.trim)) trimMaterials.set(look.trim, material(look.trim, .3, .8))
    // Emissive, and much more than it was: at night the thing that tells you a
    // tower is a place of work is that its windows are on. It is also the only
    // cue that separates tier 4 from tier 9 at a glance, since both are the
    // same silhouette at different heights.
    if (!glassMaterials.has(look.glass)) glassMaterials.set(look.glass, material(look.glass, .18, .3, look.glow))
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

    // The highest thing this station has, in station-local units. Only the three
    // captioned tiers use it, and they use it so a caption clears the thing it is
    // naming — which for tier 0 is a pitched roof above the crown and for tier 14
    // is a halo two and a half units wide.
    let towerTop = tower.position.y + look.storeys * storeyHeight + .16
    if (tier === 0) towerTop = Math.max(towerTop, tower.position.y + storeyHeight + .62)
    if (tier === 14) towerTop = Math.max(towerTop, 3.5 + 2.5)

    // Three named rungs, not fifteen.
    //
    // Every station used to carry its name and its ordinal, and a helix means
    // the stations behind the spine project onto the same part of the screen as
    // the ones in front of it: photographed, the ladder read as eight pieces of
    // white type overlapping each other and clipping off both edges. It is the
    // same defect the founders named on the slides — text that has to be parsed
    // twice — and a label nobody can read is worse than no label, because the
    // eye stops to try.
    //
    // The bottom, the middle and the top are the whole claim ("a weathered
    // one-room practice, and above the atmosphere a planetary nexus"); the
    // twelve between them are shape, and the shape is legible without captions.
    if (tier === 0 || tier === 7 || tier === 14) {
      // Outboard of the station, in world space, with a leader back to the deck
      // it names.
      //
      // These were children of the station at a fixed local offset of
      // `(3.4, 1, 0)`, and a station is rotated by its own angle on the helix, so
      // the offset swung round the tower as the tier changed: at tier seven it
      // landed on the far side and behind, which is the "label floating over a
      // tower" in the walkthrough — it was over the *neighbouring* tower, and
      // its own was somewhere else in the frame.
      //
      // Radially outward is the one direction that is away from the spine, away
      // from the axis every camera is swung around, and unoccupied at every tier.
      // The leader is what makes it a caption rather than a caption-shaped object
      // in the sky.
      // Above the crown, on a short vertical leader down to it.
      //
      // Beside the tower does not work and was tried twice. A billboard is
      // centred on its own anchor and turns to face the camera, so half of its
      // width is always on the inboard side of wherever the anchor is put: at the
      // shack the caption lay across the roof it was naming. Above the crown, the
      // only thing the caption can overlap is sky, which is the one thing every
      // framing here has a surplus of.
      const scale = 1 + tier * .12
      const ORDINAL_HEIGHT = .34 * scale
      const NAME_HEIGHT = .74 * scale
      const LEADER = .8 * scale
      const crownY = station.position.y + towerTop
      const at = (y: number) => new THREE.Vector3(station.position.x, y, station.position.z)

      // Drawn over the scene rather than in it.
      //
      // A caption on a station of a helix is occluded by the neighbouring
      // stations from most bearings, and "most bearings" includes every frame of
      // a camera move: tier seven's name was behind tier eight's platform at the
      // climb framing, and putting it anywhere else on tier seven only chooses
      // which neighbour hides it. There is no placement that survives, because
      // the geometry genuinely is in the way.
      //
      // So the three captions and their leaders are a callout layer with the
      // depth test off, which is what a caption is: an annotation of the shot, not
      // an object in it. The leader keeps them attached to what they name, and
      // with three captions seven tiers apart there is never a second one nearby
      // for this to read ambiguously against.
      const callout = (mesh: THREE.Mesh) => {
        const own = mesh.material as THREE.Material
        own.depthTest = false
        own.depthWrite = false
        mesh.renderOrder = 20
        return mesh
      }

      const leaderMaterial = new THREE.MeshBasicMaterial({ color: look.trim, toneMapped: false, fog: false })
      materials.push(leaderMaterial)
      const leader = callout(new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, LEADER, 4), leaderMaterial))
      leader.position.copy(at(crownY + LEADER / 2))
      scene.add(leader)

      const ordinal = callout(labelPlane(`TIER ${String(tier).padStart(2, '0')}`, ORDINAL_HEIGHT, {
        pixels: 56, weight: 700, font: '"Courier New", monospace', letterSpacing: 3, color: 'rgba(101,201,194,.9)',
      }))
      ordinal.position.copy(at(crownY + LEADER + ORDINAL_HEIGHT / 2))
      scene.add(ordinal)
      billboards.push(ordinal)
      labelMaterials.push(ordinal.material as THREE.Material)

      const name = callout(labelPlane(environment.name, NAME_HEIGHT, {
        pixels: 96,
        weight: 700,
        font: 'Archivo, Inter, sans-serif',
        color: tier === 14 ? '#f2c75b' : '#ede4cd',
      }))
      name.position.copy(at(crownY + LEADER + ORDINAL_HEIGHT + NAME_HEIGHT / 2 + .06))
      scene.add(name)
      billboards.push(name)
      labelMaterials.push(name.material as THREE.Material)
    }
  }

  // The spine: a mast through the middle of the helix, so the ladder is one
  // object rather than fifteen floating platforms.
  //
  // Slimmer than it was, lighter than it was, and collared at every station.
  // A helix's stations average out to its axis, so any framing that shows a group
  // of them has the axis near the middle of the frame — there is no camera angle
  // that fixes this, it is what a helix is. At radius .5→1.1 in a material three
  // shades off black, that meant a dark bar down the centre of the frame with the
  // subject behind it, which is most of what the walkthrough was looking at. Half
  // the width, lit enough to catch the key, and belted where the struts land, it
  // reads as the thing the ladder is bolted to.
  const SPINE_LENGTH = 14 * RISE + 8
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(.26, .58, SPINE_LENGTH, 10), spineMaterial)
  spine.position.y = SPINE_LENGTH / 2 - 1
  scene.add(spine)

  const collars = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(.44, .5, .3, 10),
    stepMaterial,
    OFFICE_ENVIRONMENTS.length,
  )
  const collarPlacement = new THREE.Matrix4()
  for (let tier = 0; tier < OFFICE_ENVIRONMENTS.length; tier += 1) {
    collarPlacement.makeTranslation(0, stationHeight(tier) - .3, 0)
    collars.setMatrixAt(tier, collarPlacement)
  }
  collars.instanceMatrix.needsUpdate = true
  scene.add(collars)

  // Tether each platform back to the spine. The whole reason the ladder reads as
  // a climb rather than as a stack.
  for (let tier = 0; tier < OFFICE_ENVIRONMENTS.length; tier += 1) {
    const outer = stationPosition(tier)
    const inner = new THREE.Vector3(0, outer.y - .3, 0)
    const span = outer.clone().sub(inner)
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, span.length(), 5), stepMaterial)
    strut.position.copy(inner).add(span.clone().multiplyScalar(.5))
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize())
    scene.add(strut)
  }

  // Ground, and a starfield above it. The ladder leaves the atmosphere at tier
  // twelve, so the field only begins there — below it, fog.
  // Blue-grey earth, not the green-grey it was. Under the warmer key the old
  // colour photographed as olive, which is the one hue the deck's palette does
  // not contain, and it sat across the bottom third of every revealed frame.
  // Dark, because it is the single largest area in the low framings and it has
  // nothing on it. The hemisphere light is aimed down from a 0x6d8fc0 sky at 2.3,
  // which is a lot of light for a horizontal plane to return.
  const groundMaterial = material(0x0a1020, .97)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 64), groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -1
  scene.add(ground)

  // The sky, as a graded dome rather than one flat colour.
  //
  // "Most of the frame empty" was the note, and on a 16:9 frame it is half true
  // by construction: the subject is sixty units tall and fourteen wide, so a
  // framing that fits its height leaves the sides to the background whatever the
  // camera does. The answer is not to crop into the ladder — that is the *other*
  // complaint, content running off the edges — it is for the background to carry
  // information. A ladder whose whole claim is that it leaves the atmosphere
  // should be seen against a sky that is thicker at the bottom than the top, and
  // then the empty part of the frame is reading altitude instead of nothing.
  // A lift at the horizon and nothing more. The first pass put 0x24365c at the
  // bottom, and because a ground-level framing sees almost nothing but the bottom
  // of a dome, the shack ended up against a bright blue afternoon.
  const SKY_STOPS: Array<[number, number]> = [
    [0, 0x152647], [.05, 0x111d38], [.28, 0x0d1730], [.6, 0x0a1228], [1, 0x04081a],
  ]
  const domeGeometry = new THREE.SphereGeometry(300, 24, 20)
  const domePosition = domeGeometry.attributes.position as THREE.BufferAttribute
  const domeColours = new Float32Array(domePosition.count * 3)
  const stop = new THREE.Color()
  const nextStop = new THREE.Color()
  for (let index = 0; index < domePosition.count; index += 1) {
    const t = Math.min(1, Math.max(0, domePosition.getY(index) / 300))
    let lower = SKY_STOPS[0]
    let upper = SKY_STOPS[SKY_STOPS.length - 1]
    for (let s = 0; s < SKY_STOPS.length - 1; s += 1) {
      if (t >= SKY_STOPS[s][0] && t <= SKY_STOPS[s + 1][0]) {
        lower = SKY_STOPS[s]
        upper = SKY_STOPS[s + 1]
        break
      }
    }
    stop.setHex(lower[1]).lerp(nextStop.setHex(upper[1]), (t - lower[0]) / Math.max(.0001, upper[0] - lower[0]))
    domeColours[index * 3] = stop.r
    domeColours[index * 3 + 1] = stop.g
    domeColours[index * 3 + 2] = stop.b
  }
  domeGeometry.setAttribute('color', new THREE.BufferAttribute(domeColours, 3))
  const domeMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, toneMapped: false, fog: false, depthWrite: false,
  })
  materials.push(domeMaterial)
  const dome = new THREE.Mesh(domeGeometry, domeMaterial)
  scene.add(dome)

  // A cloud deck at altitude.
  //
  // Two jobs, and the second is the one that earns it. It gives the wide framings
  // something in the half of the frame the ladder cannot fill — the note was
  // "most of the frame empty", and a tall thin subject in a 16:9 frame leaves the
  // sides to the background whatever the camera does, so the background has to be
  // worth looking at. And it gives the `tier-fly` camera move something to pass:
  // a rise of twenty-four units against a starfield at radius 150 has no parallax
  // and reads as a zoom, and the same rise through a cloud layer reads as a climb.
  //
  // It also happens to be what the object claims. The identity line for tier
  // twelve is that the practice leaves the atmosphere; the atmosphere should
  // therefore be somewhere, and it should be below tier twelve.
  const cloudCanvas = document.createElement('canvas')
  cloudCanvas.width = 128
  cloudCanvas.height = 128
  const cloudCtx = cloudCanvas.getContext('2d')
  if (cloudCtx) {
    const gradient = cloudCtx.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(196,214,244,.85)')
    gradient.addColorStop(.5, 'rgba(150,176,216,.32)')
    gradient.addColorStop(1, 'rgba(120,148,192,0)')
    cloudCtx.fillStyle = gradient
    cloudCtx.fillRect(0, 0, 128, 128)
  }
  const cloudTexture = new THREE.CanvasTexture(cloudCanvas)
  cloudTexture.colorSpace = THREE.SRGBColorSpace
  const cloudMaterial = new THREE.MeshBasicMaterial({
    map: cloudTexture, transparent: true, opacity: .34, depthWrite: false, toneMapped: false,
  })
  materials.push(cloudMaterial)
  const cloudGeometry = new THREE.PlaneGeometry(1, 1)
  const clouds: THREE.Mesh[] = []
  for (let index = 0; index < 9; index += 1) {
    const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial)
    const spread = 16 + random() * 26
    const theta = random() * Math.PI * 2
    cloud.scale.setScalar(26 + random() * 30)
    cloud.position.set(Math.cos(theta) * spread, 17.5 + random() * 7, Math.sin(theta) * spread)
    cloud.rotation.x = -Math.PI / 2
    cloud.renderOrder = 4
    clouds.push(cloud)
    scene.add(cloud)
  }

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
      for (const label of billboards) label.lookAt(rig.camera.position)
      if (context.reduced) return
      stars.rotation.y = elapsed * .006
      // Barely. Enough that a held frame is not a photograph, slow enough that it
      // is never the thing being looked at.
      for (let index = 0; index < clouds.length; index += 1) {
        clouds[index].rotation.z = elapsed * .008 * (index % 2 === 0 ? 1 : -1)
      }
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
      // Timed against the window it is seen through, which is the only honest
      // way to time it.
      //
      // This was 3.2 seconds — "deliberately long… anything brisk here loses
      // the sense of scale that is the entire point of the shot" — and that was
      // written when the move played behind two opaque slide fields and could
      // not be seen at all, so the number was answering to nothing. The
      // `tier-fly` transition in `engine/transitions.ts` now takes the field off
      // for a little under a second in the middle of the move; a 3.2s tween put
      // eight per cent of the climb inside that window and the audience saw a
      // near-static frame of the spine. At 1.25 the camera is arriving at its
      // framing as the incoming slide closes over it, which is the sense of
      // scale actually being paid for.
      rig.go(name, immediate, 1.25)
    },

    dispose() {
      disposeTree(scene)
      for (const entry of [...materials, ...labelMaterials, starMaterial]) entry.dispose()
      starGeometry.dispose()
      domeGeometry.dispose()
      cloudGeometry.dispose()
      cloudTexture.dispose()
    },
  }
}
