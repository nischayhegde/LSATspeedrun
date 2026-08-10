import * as THREE from 'three'

import type { CharacterGender } from '../types'

export type StylizedCounselRole = 'counsel' | 'guide' | 'judge' | 'visitor'

export type StylizedCounselRig = {
  root: THREE.Group
  hips: THREE.Group
  spine: THREE.Group
  chest: THREE.Group
  head: THREE.Group
  leftShoulder: THREE.Group
  rightShoulder: THREE.Group
  leftElbow: THREE.Group
  rightElbow: THREE.Group
  leftHip: THREE.Group
  rightHip: THREE.Group
  leftKnee: THREE.Group
  rightKnee: THREE.Group
  leftFoot: THREE.Group
  rightFoot: THREE.Group
  leftHand: THREE.Group
  rightHand: THREE.Group
  leftThumb: THREE.Object3D
  rightThumb: THREE.Object3D
  satchel: THREE.Group
  eyes: THREE.Group[]
  pupils: THREE.Object3D[]
  base: {
    hipsY: number
    leftShoulderZ: number
    rightShoulderZ: number
    leftElbowZ: number
    rightElbowZ: number
  }
}

/**
 * A deliberate wardrobe choice, overriding what the palette seed would pick.
 *
 * Every field is optional and every unknown or absent value falls back to the
 * seed-derived trait, so a partial selection dresses only what it names. The
 * `*_house_*`/`*_as_issued` keys are the catalog's defaults and deliberately
 * map to no override at all: that is what lets the panel show a selected
 * option in every category while a player who has changed nothing keeps the
 * exact figure they had before this system existed.
 */
export type CounselCosmetics = {
  suit?: string
  tie?: string
  hair?: string
  eyewear?: string
  accessory?: string
}

/**
 * How much of the figure to actually cut.
 *
 * `full` is every feature this file authors. `reduced` keeps the silhouette,
 * the palette and every joint — so the same clips drive it and it is the same
 * character — and drops the features that are smaller than the pixels they
 * would be drawn into. It exists because the office now seats up to thirty
 * people at once and the ones at the window wall are a third of the height of
 * the ones in the foreground.
 */
export type CounselDetail = 'full' | 'reduced'

type BuildOptions = {
  role?: StylizedCounselRole
  paletteSeed?: number
  /**
   * The uniform scale the caller will apply to `root`, so curved primitives can
   * be cut for the size they will actually be drawn at. Defaults to 1, which is
   * what the portrait surfaces render at; the office draws its cast at ~0.46.
   */
  renderScale?: number
  /** `undefined` defers to the player registry below; `null` forces the
   *  seed-derived look, which is what every NPC in the cast wants. */
  cosmetics?: CounselCosmetics | null
  detail?: CounselDetail
  /**
   * The jacket, chosen by the art rather than by the seed. The office's staff
   * are designed per role, and a role's colour is the cue that reads first;
   * see `OFFICE_STAFF_LOOKS`.
   */
  suitColor?: number
  /** Overrides the seed's hair colour, for characters whose age or seniority
   *  is part of the design. */
  hairColor?: number
  /** Which of the three authored haircuts, overriding the seed's roll. */
  hairVariant?: 0 | 1 | 2
  /** Spectacles, chosen rather than rolled. */
  eyewear?: 'none' | 'round' | 'rectangular' | 'tortoiseshell'
  /** A worn mark of the job, over and above the suit. */
  insignia?: CounselInsignia
}

export type CounselInsignia = 'none' | 'headset' | 'lanyard' | 'stole' | 'coat'

/**
 * The signed-in player's wardrobe.
 *
 * Held in a module variable rather than threaded through every call site
 * because the player's figure is built from three places, one of which (the
 * world map) constructs the rig deep inside a scene graph with no React props
 * within reach. The registry is only consulted for a rig that is unmistakably
 * the player's own — the default `counsel` role with no palette seed, which is
 * the exact signature those three call sites use and no NPC does — so staff,
 * clients, rivals and guides are untouched by it.
 */
let playerCosmetics: CounselCosmetics | null = null

export function setPlayerCosmetics(next: CounselCosmetics | null) {
  playerCosmetics = next && Object.keys(next).length ? { ...next } : null
}

export function getPlayerCosmetics(): CounselCosmetics | null {
  return playerCosmetics
}

type V3 = [number, number, number]

const geometryCache = new Map<string, THREE.BufferGeometry>()
const materialCache = new Map<string, THREE.Material>()

/**
 * The uniform scale the caller is about to apply to this rig's root.
 *
 * Curved primitives were tessellated against numbers chosen at authoring time,
 * which describe how *important* a feature is rather than how large it is
 * drawn. Measured in the office, that spent 364 triangles on a nine-millimetre
 * catchlight in the eye - 360 triangles per centimetre, for something under two
 * pixels across - and 616 on a five-centimetre nose, while the whole head made
 * do with 1008. Knowing the render scale turns "how smooth should this look"
 * into "how big is this going to be", which is the question tessellation is
 * actually answering.
 *
 * Held in a module variable because the primitive helpers are module-level and
 * the build is synchronous from `buildStylizedCounsel` down, so there is exactly
 * one rig in flight at any moment.
 */
let renderScale = 1
let detailTag = 'd1'
/**
 * Whether this build is dropping sub-pixel features. See `CounselDetail`; the
 * office sets it for everyone outside its front rank.
 */
let reducedDetail = false

/**
 * Quantised, so the office's three slightly different body scales (.42, .44,
 * .46) share one set of geometry rather than cutting three near-identical
 * copies of every sphere in the cast.
 *
 * The detail level is part of the cache tag for the same reason the scale is:
 * a reduced build asks for genuinely different geometry, and a key that did
 * not say so would hand a background body's coarse shoe to the foreground, or
 * the reverse, depending only on which was built first.
 */
function setRenderScale(scale: number, detail: CounselDetail) {
  renderScale = Math.min(1, Math.max(.25, Math.round(scale * 4) / 4))
  reducedDetail = detail === 'reduced'
  detailTag = `d${renderScale}${reducedDetail ? 'r' : ''}`
  // A reduced body takes the same sampling the map's crowd takes, which is the
  // rung this file already tunes for a body a few dozen pixels tall.
  silhouetteOnly = renderScale <= .25 || reducedDetail
}

/**
 * Below a certain size a feature stops being coarse and starts being noise.
 *
 * The ladders above answer "how smooth should this be", and they answer it well
 * down to about the office's scale. They cannot answer the next question, which
 * is whether a feature should be drawn at all: a nine-millimetre catchlight cut
 * to its coarsest six segments is still a hexagon submitted for something under
 * a pixel across, and the posterising render pass will happily give it a hard
 * edge.
 *
 * The world map is where that question bites, because it draws a whole crowd.
 * The rung is `.25`, which nothing else asks for — the office quantises to `.5`
 * and the portrait to `1` — so what follows changes no existing surface.
 *
 * **What decides membership is measured, not assumed.** The first cut of this
 * tier was made against a guess that a map pedestrian is about forty pixels
 * tall, and on that basis it dropped the entire face. The guess was wrong:
 * `map-three-scene`'s counsel camera sits 13.1 units back and clamps to 0.48
 * zoom, so the closest a body is ever drawn is 6.3 units, where it is **269
 * pixels tall with a 54-pixel head** (`.maps/pixelsize.mjs`). An eye is 6.9
 * pixels there and a mouth is 10.8. Faces read, and dropping them was a visible
 * regression at close zoom rather than a saving.
 *
 * So the rule is a two-pixel floor at the *tightest* zoom the camera allows,
 * which is the case a drop has to justify itself against. That admits exactly
 * five things — the eye catchlight (0.9 px), the trouser crease (1.4), a
 * spectacle rim's tube section (1.4), the breast-pocket welt (1.8) and the shoe
 * toe cap (1.8) — and keeps every feature a player could actually see. The
 * larger saving comes from sampling rather than from deletion: see the extruded
 * rounded boxes below, whose corners are cut to a deviation of a fifth of a
 * pixel.
 */
let silhouetteOnly = false

/**
 * Keys are scoped by render scale. Two rigs built at different scales want
 * genuinely different geometry for the same feature, and a key that did not say
 * so would hand the office's coarse eye to the portrait, or the reverse,
 * depending only on which surface mounted first.
 */
function sharedGeometry(key: string, create: () => THREE.BufferGeometry) {
  const scoped = `${detailTag}|${key}`
  const existing = geometryCache.get(scoped)
  if (existing) return existing
  const geometry = create()
  geometry.userData.characterShared = true
  geometryCache.set(scoped, geometry)
  return geometry
}

/**
 * Segments for a sphere of a given rendered diameter, in world units.
 *
 * The rungs are set by silhouette error: at the office's ~190 px/m and the
 * portrait's ~270 px/unit, every one of these keeps the deviation between the
 * polygon and the true circle under about two pixels, which is below what the
 * contour pass draws over anyway.
 */
function sphereSegments(diameter: number): [number, number] {
  if (diameter >= .60) return [28, 19]
  if (diameter >= .35) return [24, 16]
  if (diameter >= .20) return [18, 12]
  if (diameter >= .12) return [14, 10]
  if (diameter >= .07) return [12, 8]
  if (diameter >= .035) return [10, 7]
  if (diameter >= .015) return [8, 6]
  return [6, 4]
}

/** The same ladder for a capsule, whose cost is set by its radius. */
function capsuleSegments(radius: number): [number, number] {
  if (radius >= .18) return [6, 14]
  if (radius >= .10) return [5, 12]
  if (radius >= .05) return [4, 10]
  if (radius >= .02) return [3, 8]
  return [2, 6]
}

/**
 * Segments across the tube and around the ring of a torus, from both radii.
 * Authored values remain the ceiling, as everywhere else here.
 */
function torusSegments(tube: number, ring: number, authoredTube: number, authoredRing: number): [number, number] {
  const [, around] = sphereSegments(ring * 2 * renderScale)
  const [, across] = capsuleSegments(tube * renderScale)
  return [
    Math.min(authoredTube, Math.max(4, across)),
    Math.min(authoredRing, Math.max(6, around)),
  ]
}

function physical(color: number, roughness = .68, finish = .08) {
  const key = `standard:${color.toString(16)}:${roughness}:${finish}`
  const existing = materialCache.get(key)
  if (existing) return existing
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: Math.min(.06, finish * .12),
  })
  material.userData.characterShared = true
  materialCache.set(key, material)
  return material
}

function basic(color: number) {
  const key = `basic:${color.toString(16)}`
  const existing = materialCache.get(key)
  if (existing) return existing
  const material = new THREE.MeshBasicMaterial({ color, toneMapped: false })
  material.userData.characterShared = true
  materialCache.set(key, material)
  return material
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: V3 = [0, 0, 0],
  rotation: V3 = [0, 0, 0],
  scale: V3 = [1, 1, 1],
) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.scale.set(...scale)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

/**
 * The authored `segments` stays an upper bound - it records which shapes the
 * art wants smooth - and the size-derived count is the requirement. Taking the
 * lower of the two can only ever remove triangles that were never resolvable,
 * so no feature comes back coarser than it was authored to be.
 */
function ellipsoid(parent: THREE.Object3D, material: THREE.Material, position: V3, scale: V3, segments = 32) {
  const authoredRadial = Math.min(28, segments)
  const [sizedRadial, sizedHeight] = sphereSegments(Math.max(scale[0], scale[1], scale[2]) * 2 * renderScale)
  const radial = Math.min(authoredRadial, sizedRadial)
  const height = Math.min(Math.max(14, Math.round(authoredRadial * .68)), sizedHeight)
  return addMesh(parent, sphereGeometry(radial, height), material, position, [0, 0, 0], scale)
}

function sphereGeometry(radial: number, height: number) {
  return sharedGeometry(`sphere:${radial}:${height}`, () => new THREE.SphereGeometry(1, radial, height))
}

/** Shared cutter for every capsule in the cast, sized the same way. */
function capsuleGeometry(radius: number, length: number, authoredCap = 6, authoredRadial = 14, worldRadius = radius * renderScale) {
  const [sizedCap, sizedRadial] = capsuleSegments(worldRadius)
  const cap = Math.min(authoredCap, sizedCap)
  const radial = Math.min(authoredRadial, sizedRadial)
  return sharedGeometry(
    `capsule:${radius}:${length}:${cap}:${radial}`,
    () => new THREE.CapsuleGeometry(radius, length, cap, radial),
  )
}

function capsule(parent: THREE.Object3D, radius: number, length: number, material: THREE.Material, position: V3, scale: V3 = [1, 1, 1]) {
  const widest = radius * Math.max(scale[0], scale[2]) * renderScale
  return addMesh(parent, capsuleGeometry(radius, length, 6, 14, widest), material, position, [0, 0, 0], scale)
}

function softBoxGeometry(width: number, height: number, depth: number, radius: number) {
  return sharedGeometry(`soft-box:${width}:${height}:${depth}:${radius}`, () => {
    const shape = new THREE.Shape()
    const x = -width / 2
    const y = -height / 2
    // Held strictly under half the smaller side. At exactly half, the straight
    // runs between the corner arcs become zero-length, the bevel folds back
    // through itself, and the coincident faces z-fight into stripes. Callers
    // reasonably ask for a fully rounded end by passing radius = width / 2, so
    // the clamp belongs here rather than at each call site.
    const r = Math.min(radius, width * .49, height * .49)
    shape.moveTo(x + r, y)
    shape.lineTo(x + width - r, y)
    shape.quadraticCurveTo(x + width, y, x + width, y + r)
    shape.lineTo(x + width, y + height - r)
    shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
    shape.lineTo(x + r, y + height)
    shape.quadraticCurveTo(x, y + height, x, y + height - r)
    shape.lineTo(x, y + r)
    shape.quadraticCurveTo(x, y, x + r, y)
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      // An extruded rounded box pays for its corners twice: once around the
      // profile and once again for every bevel ring. That is why the shoe and
      // the hand's finger mass are the two most expensive pieces left on a map
      // body, at 332 triangles each for shapes a couple of pixels across. One
      // bevel ring and half the corner sampling keeps the rounded read and
      // halves the cost; above this rung both stay as authored.
      bevelSegments: silhouetteOnly ? 1 : 2,
      bevelSize: Math.min(r * .32, .055),
      bevelThickness: Math.min(depth * .14, .05),
      curveSegments: silhouetteOnly ? 3 : 6,
    })
    geometry.translate(0, 0, -depth / 2)
    return geometry
  })
}

function garmentGeometry(points: Array<[number, number]>, depth = .065, bevel = .022) {
  const key = `garment:${points.flat().join(',')}:${depth}:${bevel}`
  return sharedGeometry(key, () => {
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y))
    shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: silhouetteOnly ? 1 : 2,
      bevelSize: bevel,
      bevelThickness: bevel,
      // A garment panel is a straight-sided polygon, so this only samples its
      // bevel; the lapels keep their shape either way.
      curveSegments: silhouetteOnly ? 3 : 5,
    })
    geometry.translate(0, 0, -depth / 2)
    return geometry
  })
}

function roundedRectPath(width: number, height: number, radius: number) {
  const path = new THREE.Shape()
  const x = -width / 2
  const y = -height / 2
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  path.moveTo(x + r, y)
  path.lineTo(x + width - r, y)
  path.quadraticCurveTo(x + width, y, x + width, y + r)
  path.lineTo(x + width, y + height - r)
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  path.lineTo(x + r, y + height)
  path.quadraticCurveTo(x, y + height, x, y + height - r)
  path.lineTo(x, y + r)
  path.quadraticCurveTo(x, y, x + r, y)
  return path
}

/** A rounded rectangular ring — one extruded shape with a hole rather than the
 *  four bars a spectacle frame would otherwise cost. */
function frameGeometry(width: number, height: number, thickness: number, depth: number) {
  return sharedGeometry(`frame:${width}:${height}:${thickness}:${depth}`, () => {
    const outer = roundedRectPath(width, height, Math.min(width, height) * .34)
    const innerWidth = Math.max(.01, width - thickness * 2)
    const innerHeight = Math.max(.01, height - thickness * 2)
    outer.holes.push(roundedRectPath(innerWidth, innerHeight, Math.min(innerWidth, innerHeight) * .3))
    const geometry = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 5 })
    geometry.translate(0, 0, -depth / 2)
    return geometry
  })
}

function addLine(parent: THREE.Object3D, points: THREE.Vector3[], radius: number, material: THREE.Material) {
  const key = `line:${points.map((point) => `${point.x},${point.y},${point.z}`).join(';')}:${radius}`
  const geometry = sharedGeometry(key, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 14, radius, 6, false))
  return addMesh(parent, geometry, material)
}

/* ------------------------------------------------------------------ hair
 *
 * Why the old shell read as a swim cap, since the shape below is a direct
 * answer to it.
 *
 * It was a hemisphere scaled to .485 x .465 x .41 and parked on a skull of
 * .46 x .53 x .405. That is five millimetres of clearance at the front of the
 * head and twenty-five at the widest point — a skin of paint, not a mass of
 * hair — so the silhouette it produced was the skull's own silhouette. Worse,
 * its theta sweep ended at a constant polar angle, which puts the cut edge at
 * one fixed height all the way around the head: a horizontal band just above
 * the eyes, running through the temples and across the back at the same
 * altitude. A horizontal band around the skull at eye level is the definition
 * of a bathing cap. The `hairlineCurve` term that was meant to break it moved
 * the edge by two and a half millimetres.
 *
 * So the shell is now described by the two things that actually make hair read
 * as hair at this size: how far it stands off the skull, which is uneven, and
 * where it stops, which is a curve rather than a height. Everything is written
 * against the skull's own semi-axes, so the clearance is legible as "this much
 * hair" rather than as a magic number.
 */

const HEAD_X = .46
const HEAD_Y = .53
const HEAD_Z = .405

type HairProfile = {
  /** Standoff from the skull, as a fraction of the skull's radius: over the
   *  crown, at the temples and ears, and around the back. Uneven on purpose —
   *  a constant offset is exactly what makes a shell look moulded. */
  crown: number
  sides: number
  nape: number
  /** Where the hair ends, in the head's own units. `rimFront` is the hairline
   *  across the forehead (the brow sits at ~.21, the crown at .53), `rimSide`
   *  is where it finishes past the ear, `rimBack` is the nape. */
  rimFront: number
  rimSide: number
  rimBack: number
  /** How hard the mass sweeps to one side, and how much height the parting
   *  lifts off the crown. Zero on both is a centre-weighted round cut. */
  sweep: number
  lift: number
}

/**
 * Distinct silhouettes, not one silhouette at three sizes.
 *
 * The old variants were scale multipliers on a single shell, so all three read
 * as the same object and the difference was legible only as "bigger". These
 * differ in the two terms the eye actually reads at a distance: where the hair
 * stops, and where its bulk sits.
 */
const HAIR_PROFILES: Record<string, HairProfile> = {
  // Signature: a side parting with the mass carried over one temple, sides
  // finishing halfway down the ear, back running to the nape.
  'male:0': { crown: .17, sides: .085, nape: .15, rimFront: .275, rimSide: -.045, rimBack: -.15, sweep: .55, lift: .055 },
  // Cropped: a genuine taper. Almost nothing at the sides — the silhouette
  // there is the skull's — with the hair finishing above the ear and the
  // remaining volume kept on top, which is what a short back and sides is.
  'male:1': { crown: .12, sides: .05, nape: .075, rimFront: .30, rimSide: .085, rimBack: .01, sweep: .28, lift: .03 },
  // Full: standing volume everywhere, over the ears and down past the nape.
  'male:2': { crown: .30, sides: .175, nape: .265, rimFront: .245, rimSide: -.115, rimBack: -.26, sweep: .35, lift: .10 },
  // The female cuts are longer at the sides and back so the mass frames the
  // face, and hold the same forehead hairline so the face stays clear.
  'female:0': { crown: .175, sides: .165, nape: .215, rimFront: .265, rimSide: -.20, rimBack: -.34, sweep: .32, lift: .05 },
  // A jaw-length bob: blunt, level, and noticeably shorter than the other two.
  'female:1': { crown: .145, sides: .175, nape: .175, rimFront: .285, rimSide: -.145, rimBack: -.20, sweep: .18, lift: .035 },
  // Long and full, well past the jaw.
  'female:2': { crown: .275, sides: .225, nape: .315, rimFront: .245, rimSide: -.30, rimBack: -.50, sweep: .30, lift: .095 },
}

function hairProfile(gender: CharacterGender, variant: number) {
  return HAIR_PROFILES[`${gender}:${variant}`] ?? HAIR_PROFILES[`${gender}:0`]
}

function referenceHairGeometry(gender: CharacterGender, variant: number) {
  // The displacement below pulls this shell down onto the skull, so its unit
  // radius says nothing about how big it ends up. It is a haircut: size it as
  // the head it sits on.
  const [radial, height] = sphereSegments(.95 * renderScale)
  return sharedGeometry(`reference-hair:${gender}:${variant}:${radial}:${height}`, () => {
    const profile = hairProfile(gender, variant)
    // One generous sweep for every cut. The rim below decides where the hair
    // actually ends; anything past it is tucked inside the skull and never
    // seen, so the sweep only has to be long enough for the longest profile
    // rather than tuned per cut.
    const geometry = new THREE.SphereGeometry(1, Math.min(28, radial), Math.min(18, height), 0, Math.PI * 2, 0, Math.PI * .86)
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const nx = positions.getX(index)
      const ny = positions.getY(index)
      const nz = positions.getZ(index)
      const upper = Math.max(0, ny)
      const left = Math.max(0, -nx)
      // The compass direction this vertex faces, taken in the horizontal plane
      // so that a point near the crown still has a well-defined "front" — the
      // raw z of a near-polar vertex is almost zero and cannot be used for it.
      const horizontal = Math.max(1e-4, Math.hypot(nx, nz))
      const facing = nz / horizontal
      const frontward = Math.pow(Math.max(0, facing), 1.5)
      const backward = Math.pow(Math.max(0, -facing), 1.5)
      const sideward = Math.max(0, 1 - frontward - backward)

      // Thickness, blended between the three authored standoffs and swelling
      // over the crown, so the mass sits where hair has mass.
      const standoff = profile.sides * sideward + profile.crown * frontward * .55 + profile.nape * backward
        + profile.crown * Math.pow(upper, 1.4)
      // The parting: a broad rise over one temple rather than a narrow crest,
      // which is what the previous crest term got wrong and why it wedged.
      const parting = Math.exp(-Math.pow((nx + .22) / .62, 2)) * Math.pow(upper, .8)
      // Floored, because the skull this sits on is not always the size this
      // shell was written against: `faceWidthVariance` scales the head by up to
      // four percent per character, and a tapered cut thinner than that would
      // let the temples push through the hair on the widest faces.
      const thickness = Math.max(.075, standoff * (1 + profile.sweep * parting * .5))

      let px = nx * HEAD_X * (1 + thickness)
      let py = ny * HEAD_Y * (1 + thickness)
      let pz = nz * HEAD_Z * (1 + thickness)

      // Where this cut ends, as a curve around the head rather than a height.
      // The forehead hairline sits well above the brow, the sides run past the
      // ear, the back drops to the nape, and the whole line is a little higher
      // on one side so the parting has somewhere to come from.
      const rim = profile.rimSide * sideward + profile.rimFront * frontward + profile.rimBack * backward
        + frontward * nx * .045
      const below = rim - py
      if (below > 0) {
        // Tucked inside the skull rather than deleted, which is what gives a
        // clean silhouette edge without needing a second piece of geometry or
        // a hole in this one. At full fade the radial factor lands at .86 of
        // the skull whatever the local thickness was, so the tuck is always
        // decisively inside and never grazes the face.
        const fade = Math.min(1, below / .17)
        const factor = ((1 + thickness) - fade * (thickness + .14)) / (1 + thickness)
        px *= factor
        py *= factor
        pz *= factor
      }

      // The crown lifts, the mass settles back off the forehead, and the whole
      // cut leans very slightly to one side. Small numbers, but they are what
      // stop the top being a hemisphere of revolution.
      py += profile.lift * Math.pow(upper, 1.6) + parting * profile.lift * .55
      pz -= backward * profile.nape * .08
      px -= left * profile.sweep * .012
      positions.setXYZ(index, px, py, pz)
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()
    return geometry
  })
}

function addHand(parent: THREE.Group, side: -1 | 1, skin: THREE.Material) {
  const hand = new THREE.Group()
  // The wrist used to sit .18 forward of the forearm axis, which is more than a
  // full forearm radius. That threw the pale hand clear of the dark sleeve and
  // is why it read as a detached mitten floating in front of the cuff. A wrist
  // breaks forward by a fraction of its own width, not by its whole width.
  hand.position.set(side * .012, -1.00, .052)
  parent.add(hand)
  ellipsoid(hand, skin, [0, -.01, 0], [.135, .175, .095], 24)
  // One finger mass, not four separate digits.
  //
  // Individually modelled fingers are the right call on a hand that fills the
  // frame and wrong on one that is a few dozen pixels tall. Four pale rods with
  // daylight between them do not resolve into a hand at this size; they resolve
  // into a brush, and the posterising render pass hardens each rod's edge and
  // makes it worse. A relaxed hand is a closed silhouette anyway, since the
  // fingers rest against one another.
  //
  // No incised seam between the digits. A rounded slab thin enough to read as a
  // groove has a corner radius equal to half its own width, which collapses its
  // top and bottom edges to zero-length segments; the bevel then folds back
  // through itself and the resulting coincident faces z-fight into a band of
  // stripes. That artifact is far louder than the detail it was buying, and the
  // silhouette alone already reads as a hand at this size.
  const fingers = addMesh(hand, softBoxGeometry(.232, .20, .112, .052), skin, [0, -.20, .012])
  fingers.rotation.x = -.30
  const thumb = capsule(hand, .030, .105, skin, [side * .118, -.035, .020], [.9, 1, .75])
  thumb.rotation.z = side * -.75
  thumb.rotation.x = -.16
  return { hand, thumb }
}

/** Independent seed → integer hash. Salting the same `paletteSeed` with a
 *  different constant per trait keeps trait choices decorrelated: without
 *  this, every `paletteSeed % N` lookup landed on the same bucket index,
 *  so skin/hair/clothing always changed in lockstep and the cast only had
 *  as much variety as its smallest palette. */
function subHash(seed: number, salt: number) {
  return Math.imul(seed ^ salt, 2654435761) >>> 0
}

/* ------------------------------------------------------------ hair colour
 *
 * A ramp sampled evenly is not a population.
 *
 * The palette was eight shades from near-black to silver, drawn with a flat
 * `% length`. Three of those eight — dark blond, blond, silver — are lighter
 * than a mid brown, so **every crowd this file dresses was 37.5% fair or grey
 * by construction**, and it was 12.5% silver whatever the age of the person.
 * That is not a rare accident of one cast's seeds; it is what a uniform draw
 * over an evenly spaced ramp has to produce, and it showed up as a thirty-
 * person firm reading as blondes and retirees (17 of 30 at dark blond or
 * lighter, measured).
 *
 * The ramp itself was fine. What was missing is that the shades are not
 * equally likely: dark hair is most of any adult population, fair hair is a
 * minority of it, and grey is a function of age rather than of the same coin
 * toss. So the shades carry weights and the draw honours them. Nothing is
 * removed, so no character loses a look that was available to them; what
 * changes is how often the light end comes up.
 *
 * The weights are set per *visual* bucket rather than per entry, because two
 * adjacent shades on this ramp are one colour at the size these bodies are
 * drawn: near-black and dark brown are both "dark" across a room, and weighting
 * them separately is how a palette swings from a firm of blondes to a firm of
 * black-haired people instead of landing on a firm. So the ramp reads 30% very
 * dark, 36% brown, 13% chestnut, 12% fair and 9% silver, and the entries inside
 * a bucket split its share.
 *
 * This is an intent about a population and not a fit to any one cast. What the
 * office's designed thirty are actually dealt is then checked, rather than the
 * weights being nudged until that particular firm looks right.
 *
 * The same draw dresses the map's pedestrians and every client portrait, which
 * is the point: a pavement that was 37.5% fair had the same bug and nobody had
 * named it there.
 */
const HAIR_SHADES: ReadonlyArray<readonly [color: number, weight: number]> = [
  [0x1b1613, 15], // near-black
  [0x2c2523, 15], // dark brown
  [0x3a2925, 18], // dark chestnut
  [0x5b3a2a, 18], // mid brown
  [0x7a4a30, 13], // light chestnut
  [0x9c7645, 7], //  dark blond
  [0xab8f5c, 5], //  blond
  [0x8b8b8d, 9], //  silver
]

const HAIR_WEIGHT_TOTAL = HAIR_SHADES.reduce((sum, [, weight]) => sum + weight, 0)

function seededHairColor(paletteSeed: number) {
  let roll = subHash(paletteSeed, SALT_HAIR_COLOR) % HAIR_WEIGHT_TOTAL
  for (const [color, weight] of HAIR_SHADES) {
    if (roll < weight) return color
    roll -= weight
  }
  return HAIR_SHADES[0][0]
}

const SALT_SKIN = 0x9e3779b1
const SALT_HAIR_COLOR = 0x85ebca6b
const SALT_CLOTH = 0xc2b2ae35
const SALT_HAIRSTYLE = 0x27d4eb2f
const SALT_HEIGHT = 0x165667b1
const SALT_BUILD = 0x1156bec7
const SALT_FACE_W = 0xd3a2646c
const SALT_FACE_H = 0x9e6b7f1b
const SALT_ACCESSORY = 0x2545f491
const SALT_STANCE = 0x7feb352d

/**
 * Three cuts per character, each a shape of its own.
 *
 * The shell above already differs per variant, so nothing here scales one mesh
 * into three. What is left is the accent that finishes each silhouette: the
 * swept fringe that a parting throws across the forehead, and the gathered
 * mass at the back of the fuller cuts. Both reuse primitives this file already
 * cuts, so no variant costs new heavy geometry.
 */
function addHair(head: THREE.Group, gender: CharacterGender, hair: THREE.Material, variant: number) {
  addMesh(head, referenceHairGeometry(gender, variant), hair)
  if (variant === 1) {
    // Cropped. A short front only, sitting close: the whole point of this cut
    // is that there is nothing to sweep.
    if (gender === 'male') {
      addMesh(head, capsuleGeometry(.115, .30, 8, 20), hair, [-.05, .375, .295], [0, 0, -2.32], [.74, .70, .52])
    }
    return
  }
  if (variant === 2) {
    // Full. A heavier fringe across the brow and a gathered mass at the back,
    // which is the silhouette break that reads first at office distance.
    if (gender === 'male') {
      addMesh(head, capsuleGeometry(.13, .43, 8, 20), hair, [-.085, .44, .315], [0, 0, -2.22], [1.16, 1.02, .80])
      ellipsoid(head, hair, [0, .045, -.44], [.22, .215, .13], 18)
    } else {
      ellipsoid(head, hair, [0, .085, -.47], [.185, .215, .155], 18)
    }
    return
  }
  // Signature: the side parting's own fringe, laid across the forehead on the
  // same side the shell's mass is carried.
  if (gender === 'male') {
    addMesh(head, capsuleGeometry(.13, .43, 8, 20), hair, [-.075, .425, .315], [0, 0, -2.25], [1.02, .94, .70])
  } else {
    addMesh(head, capsuleGeometry(.11, .34, 8, 20), hair, [-.10, .405, .30], [0, 0, -2.38], [.92, .82, .62])
  }
}

/* ------------------------------------------------------------- wardrobe
 *
 * The render side of the backend's wardrobe catalog. Keys are matched by
 * lookup rather than by branching, so an item the client has never heard of
 * (an older build talking to a newer server) simply falls through to the
 * default instead of throwing away the whole figure.
 */

/** `null` means "leave the tier-driven house navy alone". */
const SUIT_COLORWAYS: Record<string, number | null> = {
  suit_house_navy: null,
  suit_charcoal: 0x3c414a,
  suit_slate: 0x5d6874,
  suit_forest: 0x2b4a39,
  suit_oxblood: 0x5d2c31,
  suit_cream_linen: 0xc9b591,
  suit_pinstripe: 0x232f47,
}

const NECKWEAR_COLORS: Record<string, number> = {
  tie_house_burgundy: 0x743f45,
  tie_regimental: 0x21365b,
  tie_gold_foulard: 0xc39a45,
  tie_bow: 0x1b1d25,
  tie_cravat: 0xe6d9bd,
}

/** Which of `addHair`'s three silhouettes an item asks for, and whether it
 *  recolors. `hair_signature` is absent on purpose: it keeps the seed's own. */
const HAIRSTYLES: Record<string, { variant: number; color?: number }> = {
  hair_cropped: { variant: 1 },
  hair_full: { variant: 2 },
  hair_distinguished: { variant: 0, color: 0xb4aea6 },
}

const TIE_SHAPE: Array<[number, number]> = [[-.07, 1.54], [.07, 1.54], [.095, .72], [0, .57], [-.095, .72]]
const OPEN_COLLAR_SHAPE: Array<[number, number]> = [[-.21, 1.64], [0, 1.38], [.21, 1.64]]

/**
 * Neckwear.
 *
 * Every piece is worn exactly as chosen, including the house four-in-hand. The
 * female cut's collar-and-no-tie look is not a special case here: it is the
 * `tie_open_collar` piece, which the backend issues as her default, so the
 * figure is unchanged from before the wardrobe existed either way.
 */
function addNeckwear(
  chest: THREE.Group,
  key: string,
  materials: { shirt: THREE.Material; accent: THREE.Material; stripe: THREE.Material },
) {
  if (key === 'tie_open_collar') {
    addMesh(chest, garmentGeometry(OPEN_COLLAR_SHAPE, .06), materials.shirt, [0, 0, .40])
    return
  }
  const cloth = physical(NECKWEAR_COLORS[key] ?? NECKWEAR_COLORS.tie_house_burgundy, .66, .07)
  if (key === 'tie_bow') {
    for (const side of [-1, 1]) {
      const wing = addMesh(chest, softBoxGeometry(.19, .12, .06, .045), cloth, [side * .12, 1.50, .40])
      wing.rotation.z = side * .26
    }
    ellipsoid(chest, cloth, [0, 1.50, .425], [.042, .055, .032], 16)
    return
  }
  if (key === 'tie_cravat') {
    addMesh(chest, garmentGeometry([[-.15, 1.56], [.15, 1.56], [.20, 1.20], [0, 1.02], [-.20, 1.20]], .085), cloth, [0, 0, .39])
    ellipsoid(chest, materials.accent, [0, 1.22, .472], [.032, .032, .022], 16)
    return
  }
  addMesh(chest, garmentGeometry(TIE_SHAPE, .06), cloth, [0, 0, .395])
  if (key !== 'tie_regimental') return
  // Four bars laid across the blade at a diagonal is the whole trick; the tie
  // itself is the same extruded shape every other neckwear uses. They sit at
  // .462 rather than flush with the blade because `garmentGeometry`'s bevel
  // carries its front face out to .447, and anything nearer disappears into it.
  for (const y of [1.34, 1.14, .94, .76]) {
    const stripe = addMesh(chest, softBoxGeometry(.21, .038, .022, .012), materials.stripe, [0, y, .462])
    stripe.rotation.z = .58
  }
}

function addEyewear(head: THREE.Group, key: string, materials: { ink: THREE.Material; brass: THREE.Material }) {
  if (key === 'eyewear_none') return
  const glasses = new THREE.Group()
  glasses.position.set(0, .055, .414)
  head.add(glasses)
  if (key === 'eyewear_rectangular') {
    for (const side of [-1, 1]) addMesh(glasses, frameGeometry(.205, .125, .019, .022), materials.ink, [side * .145, 0, 0])
    addMesh(glasses, sharedGeometry('eyewear-bridge:flat', () => new THREE.BoxGeometry(.09, .016, .014)), materials.ink)
    for (const side of [-1, 1]) {
      const arm = addMesh(glasses, sharedGeometry('eyewear-temple', () => new THREE.BoxGeometry(.13, .014, .014)), materials.ink, [side * .30, .012, -.075])
      arm.rotation.y = side * .82
    }
    return
  }
  if (key === 'eyewear_tortoiseshell') {
    const shell = physical(0x7c4a22, .44, .16)
    const fleck = physical(0xc08c46, .48, .12)
    for (const side of [-1, 1]) {
      addMesh(glasses, frameGeometry(.215, .148, .028, .026), shell, [side * .148, -.004, 0])
      addMesh(glasses, softBoxGeometry(.09, .022, .012, .008), fleck, [side * .148, .062, .012])
    }
    addMesh(glasses, sharedGeometry('eyewear-bridge:heavy', () => new THREE.BoxGeometry(.086, .026, .018)), shell, [0, .012, 0])
    return
  }
  // Round frames. `eyewear_seed` is the pair the palette seed has always
  // rolled and keeps its original dimensions and dark rim to the tenth of a
  // millimetre, because every unstyled character in the cast still wears it.
  const seeded = key !== 'eyewear_round'
  const wire = seeded ? materials.ink : materials.brass
  // A spectacle rim is a thin ring: its cost is set by how many segments run
  // around the tube, and the tube is a millimetre or two of world.
  const [rimTube, rimAround] = seeded ? torusSegments(.014, .095, 8, 24) : torusSegments(.0105, .098, 8, 24)
  const rim = seeded
    ? sharedGeometry(`eyewear-rim:seed:${rimTube}:${rimAround}`, () => new THREE.TorusGeometry(.095, .014, rimTube, rimAround))
    : sharedGeometry(`eyewear-rim:wire:${rimTube}:${rimAround}`, () => new THREE.TorusGeometry(.098, .0105, rimTube, rimAround))
  const bridge = seeded
    ? sharedGeometry('eyewear-bridge:seed', () => new THREE.BoxGeometry(.09, .018, .014))
    : sharedGeometry('eyewear-bridge:wire', () => new THREE.BoxGeometry(.088, .013, .011))
  for (const side of [-1, 1]) addMesh(glasses, rim, wire, [side * .14, 0, 0])
  addMesh(glasses, bridge, wire, [0, 0, 0])
}

function addChestAccessory(chest: THREE.Group, key: string, materials: { brass: THREE.Material; suitLight: THREE.Material }) {
  if (key === 'accessory_lapel_pin') {
    ellipsoid(chest, materials.brass, [.35, 1.15, .39], [.045, .045, .025], 18)
    return
  }
  // The pocket square rides on the lapel, whose bevelled front face reaches
  // .4095, so it sits past that rather than flush with the plate behind it.
  if (key !== 'accessory_pocket_square') return
  const silk = physical(0xd9c07a, .74, .05)
  addMesh(chest, softBoxGeometry(.17, .022, .03, .009), materials.suitLight, [.335, 1.005, .405])
  for (const offset of [-.042, 0, .042]) {
    const peak = addMesh(chest, softBoxGeometry(.055, .062, .022, .014), silk, [.335 + offset, 1.042 + Math.abs(offset) * -.22, .415])
    peak.rotation.z = offset * 5.2
  }
}

/** A briefcase, hung from the closed right hand so it swings with the arm the
 *  clips already animate rather than needing a rule of its own. */
function addBriefcase(hand: THREE.Group) {
  const hide = physical(0x5a3a26, .58, .1)
  const trim = physical(0x3b2517, .52, .14)
  const clasp = physical(0xc29a57, .38, .4)
  addMesh(hand, softBoxGeometry(.52, .42, .17, .05), hide, [.02, -.56, .01])
  addMesh(hand, softBoxGeometry(.545, .055, .19, .022), trim, [.02, -.335, .01])
  addMesh(hand, softBoxGeometry(.09, .034, .04, .012), clasp, [.02, -.318, .10])
  addLine(hand, [
    new THREE.Vector3(-.07, -.30, .01),
    new THREE.Vector3(.02, -.155, .01),
    new THREE.Vector3(.11, -.30, .01),
  ], .018, trim)
}

/**
 * A worn mark of the job.
 *
 * The seed can vary a jacket's colour and a haircut's shape, and past that it
 * has nothing to say about what someone does for a living. These do: a headset
 * is front-of-house, a badge on a lanyard is the systems bench, a sash is the
 * treaty wing, a pale coat is the clinician. Each is two or three small
 * primitives hung off a joint the rig already animates, cut from the same
 * shared cutters as the rest of the figure, so a department's worth of them
 * costs no new geometry beyond the first.
 */
function addInsignia(
  insignia: CounselInsignia,
  parts: { chest: THREE.Group; head: THREE.Group },
  materials: { ink: THREE.Material; brass: THREE.Material; shirt: THREE.Material; accent: THREE.Material },
) {
  if (insignia === 'headset') {
    // An over-the-crown band and one earpiece. The band is a half torus rather
    // than a bent bar because a bar reads as a hairslide from the front.
    const band = addMesh(
      parts.head,
      sharedGeometry('insignia-headset-band', () => new THREE.TorusGeometry(.5, .026, 5, 18, Math.PI)),
      materials.ink,
      [0, -.02, -.03],
      [0, 0, 0],
      [1, 1.05, 1],
    )
    band.castShadow = false
    ellipsoid(parts.head, materials.ink, [.485, -.03, -.03], [.055, .085, .072], 16)
    // The boom is what makes it a headset rather than headphones, so it stays
    // even on a reduced body; it is one capsule.
    const boom = addMesh(parts.head, capsuleGeometry(.014, .30, 3, 8), materials.ink, [.36, -.145, .17])
    boom.rotation.set(-.30, 0, .95)
    boom.castShadow = false
    return
  }
  if (insignia === 'lanyard') {
    if (!silhouetteOnly) {
      for (const side of [-1, 1] as const) {
        const strap = addMesh(parts.chest, capsuleGeometry(.014, .58, 3, 8), materials.ink, [side * .20, 1.16, .35])
        strap.rotation.z = side * .30
        strap.castShadow = false
      }
    }
    addMesh(parts.chest, softBoxGeometry(.17, .23, .024, .022), materials.shirt, [0, .74, .415])
    addMesh(parts.chest, softBoxGeometry(.13, .05, .014, .012), materials.accent, [0, .81, .43])
    return
  }
  if (insignia === 'stole') {
    // A sash from one shoulder to the opposite hip, and the clasp that holds
    // it. Extruded flat like the lapels, so it sits in the same material
    // language as the rest of the tailoring.
    addMesh(
      parts.chest,
      garmentGeometry([[-.52, 1.46], [-.28, 1.58], [.36, .28], [.13, .18]], .05, .018),
      materials.accent,
      [0, 0, .372],
    )
    ellipsoid(parts.chest, materials.brass, [-.38, 1.46, .40], [.055, .055, .03], 16)
    return
  }
  if (insignia === 'coat') {
    // A pale clinical coat worn over the suit: two fronts a little wider and
    // longer than the jacket's own, and a stand collar.
    const cloth = physical(0xe8ece9, .88, .02)
    addMesh(parts.chest, garmentGeometry([[-.56, .78], [-.07, .66], [-.06, -.34], [-.58, -.24]], .06), cloth, [0, 0, .33])
    addMesh(parts.chest, garmentGeometry([[.56, .78], [.07, .66], [.06, -.34], [.58, -.24]], .06), cloth, [0, 0, .33])
    addMesh(parts.chest, garmentGeometry([[-.30, 1.66], [.30, 1.66], [.22, 1.40], [-.22, 1.40]], .07), cloth, [0, 0, .33])
  }
}

function addWristwatch(elbow: THREE.Group, side: -1 | 1, brass: THREE.Material) {
  const strap = physical(0x2c2320, .62, .06)
  addMesh(
    elbow,
    sharedGeometry('watch-strap', () => new THREE.CylinderGeometry(.176, .176, .06, 16)),
    strap,
    [0, -.835, 0],
  )
  const face = ellipsoid(elbow, brass, [side * .155, -.835, .048], [.052, .058, .026], 16)
  face.rotation.z = side * -.28
}

export function buildStylizedCounsel(gender: CharacterGender, tier: number, options: BuildOptions = {}): StylizedCounselRig {
  setRenderScale(options.renderScale ?? 1, options.detail ?? 'full')
  const role = options.role ?? 'counsel'
  const paletteSeed = Math.abs(options.paletteSeed ?? (gender === 'female' ? 1 : 0))
  // See `setPlayerCosmetics`: an unseeded counsel is the player, and only the
  // player. Anyone else — every visitor, judge, guide, and seeded cast member —
  // resolves to `null` here and takes the identical path they always have.
  const cosmetics = options.cosmetics !== undefined
    ? options.cosmetics
    : role === 'counsel' && options.paletteSeed === undefined ? playerCosmetics : null
  // Broad, tasteful ranges (light to deep skin, black through blonde/silver
  // hair) rather than the previous 4-entry palettes, which put half the cast
  // on nearly-identical dark-brown hair.
  const skinColors = [0xf6d2b8, 0xf2bda2, 0xe0a883, 0xd89473, 0xc48660, 0xb87556, 0x9c6248, 0x6f4632]
  const skinIndex = subHash(paletteSeed, SALT_SKIN) % skinColors.length
  const hairstyle = cosmetics?.hair ? HAIRSTYLES[cosmetics.hair] : undefined
  const skin = physical(skinColors[skinIndex], .58, .05)
  const skinShade = physical(new THREE.Color(skinColors[skinIndex]).offsetHSL(0, .01, -.08).getHex(), .64, .025)
  const hair = physical(options.hairColor ?? hairstyle?.color ?? seededHairColor(paletteSeed), .52, .12)
  // A restrained version of the reference's blue jacket: saturated enough to
  // read as a designed character, dark enough to sit inside the app's navy UI.
  const suitPalette = [0x315b84, 0x294f77, 0x24486d, 0x1f4163, 0x1b3857, 0x142f4b]
  const stage = tier >= 11 ? 5 : tier >= 8 ? 4 : tier >= 5 ? 3 : tier >= 3 ? 2 : tier >= 1 ? 1 : 0
  const visitorPalette = [0x31524f, 0x3f465c, 0x59434a, 0x315064, 0x4a3f5c, 0x5c4a35, 0x3a5c4a, 0x5c3f42]
  const seedColor = role === 'judge' ? 0x20242d : role === 'visitor' ? visitorPalette[subHash(paletteSeed, SALT_CLOTH) % visitorPalette.length] : suitPalette[stage]
  const chosenSuit = cosmetics?.suit ? SUIT_COLORWAYS[cosmetics.suit] : undefined
  // An authored jacket outranks both, because it is the one cue a designed
  // cast cannot leave to a hash. Everything else about the figure — skin,
  // hair colour, height, build, face, stance — stays seeded.
  const roleColor = options.suitColor ?? chosenSuit ?? seedColor
  const suit = physical(roleColor, .72, .10)
  const suitLight = physical(new THREE.Color(roleColor).offsetHSL(.005, -.035, .045).getHex(), .70, .10)
  const trouser = physical(new THREE.Color(roleColor).lerp(new THREE.Color(0x45484f), .70).getHex(), .78, .04)
  const shirt = physical(0xf0e7d4, .84, .025)
  const tie = physical(role === 'judge' ? 0x8f6b3f : 0x743f45, .66, .07)
  // Chalk, for the pinstripe and for the regimental tie's bars — both want the
  // same "same cloth, three shades brighter" read.
  const chalk = physical(new THREE.Color(roleColor).offsetHSL(0, -.22, .34).getHex(), .74, .04)
  // The regimental tie's bars are the one piece that has to read against its
  // own cloth rather than against the suit, so they are gold, not chalk.
  const gold = physical(0xd9b45f, .48, .26)
  const shoe = physical(0x25201f, .46, .22)
  const sole = physical(0x141414, .86, .02)
  const brassKey = 'standard:brass'
  let brass = materialCache.get(brassKey)
  if (!brass) {
    brass = new THREE.MeshStandardMaterial({ color: 0xc29a57, roughness: .35, metalness: .48 })
    brass.userData.characterShared = true
    materialCache.set(brassKey, brass)
  }
  const ink = physical(0x2b2524, .42, .18)
  const eyeWhite = physical(0xf8f1e5, .52, .06)
  const lip = physical(gender === 'female' ? 0xb96765 : 0xa75f59, .58, .08)

  // Subtle, independent build/height/face variation so same-role characters
  // (e.g. every client, every associate) aren't visually identical clones
  // beyond just color. Kept small enough to preserve the tuned proportions
  // and the animation rig's assumptions.
  const heightVariance = ((subHash(paletteSeed, SALT_HEIGHT) % 9) - 4) * .014
  const buildVariance = 1 + ((subHash(paletteSeed, SALT_BUILD) % 7) - 3) * .018
  const faceWidthVariance = .96 + (subHash(paletteSeed, SALT_FACE_W) % 9) * .01
  const faceHeightVariance = .97 + (subHash(paletteSeed, SALT_FACE_H) % 7) * .009
  const hairVariant = options.hairVariant ?? hairstyle?.variant ?? subHash(paletteSeed, SALT_HAIRSTYLE) % 3
  const accessoryRoll = subHash(paletteSeed, SALT_ACCESSORY) % 5
  const authoredEyewear = options.eyewear && options.eyewear !== 'none'
    ? `eyewear_${options.eyewear}`
    : options.eyewear === 'none' ? 'eyewear_none' : undefined
  // "As issued" resolves back to whatever the seed rolled, which is how a
  // player who only changes their suit keeps the glasses they started with.
  const eyewearKey = authoredEyewear ?? (cosmetics?.eyewear && cosmetics.eyewear !== 'eyewear_as_issued'
    ? cosmetics.eyewear
    : accessoryRoll === 0 ? 'eyewear_seed' : 'eyewear_none')
  const accessoryKey = cosmetics?.accessory && cosmetics.accessory !== 'accessory_as_issued'
    ? cosmetics.accessory
    : accessoryRoll === 1 ? 'accessory_lapel_pin' : 'accessory_none'

  const root = new THREE.Group()
  root.name = `${gender}-${role}-stylized-counsel`
  const hips = new THREE.Group()
  const hipsY = 2.62 + heightVariance
  hips.position.y = hipsY
  hips.userData.baseY = hipsY
  root.add(hips)
  addMesh(hips, softBoxGeometry(gender === 'female' ? .86 : .94, .18, .43, .09), trouser, [0, -.03, 0])

  const makeLeg = (side: -1 | 1) => {
    const hip = new THREE.Group()
    hip.position.set(side * .275, -.08, 0)
    hips.add(hip)
    // Overlapping capsules remove the toy-block knee seam while retaining a
    // true knee joint for the map walk cycle.
    capsule(hip, .255, .78, trouser, [0, -.57, 0], [1, 1, .91])
    // A .014 tube of slightly lighter cloth: a shading cue, not a shape.
    if (!silhouetteOnly) {
      const crease = capsule(hip, .014, .68, suitLight, [side * -.08, -.57, .245], [.7, 1, .55])
      crease.castShadow = false
    }
    const knee = new THREE.Group()
    knee.position.set(0, -1.09, 0)
    hip.add(knee)
    capsule(knee, .245, .74, trouser, [0, -.54, 0], [1, 1, .91])
    const foot = new THREE.Group()
    foot.position.set(0, -1.12, .04)
    knee.add(foot)
    addMesh(foot, softBoxGeometry(.48, .24, .66, .12), shoe, [0, -.03, .17])
    // The sole survives at 2.6 px — it is the dark line that separates a shoe
    // from the pavement — and the toe cap does not, at 1.8.
    addMesh(foot, softBoxGeometry(.50, .05, .68, .025), sole, [0, -.165, .17])
    if (!silhouetteOnly) addMesh(foot, softBoxGeometry(.39, .035, .27, .018), suitLight, [0, .012, .39])
    return { hip, knee, foot }
  }
  const leftLeg = makeLeg(-1)
  const rightLeg = makeLeg(1)
  leftLeg.hip.scale.y = .97
  rightLeg.hip.scale.y = .97

  const spine = new THREE.Group()
  hips.add(spine)
  const chest = new THREE.Group()
  spine.add(chest)
  // A gently tapered capsule gives the jacket the reference model's friendly
  // rounded silhouette. The lapels and panels below keep it unmistakably a
  // tailored suit rather than a generic pill-shaped torso.
  capsule(chest, .60, .60, suit, [0, .87, 0], [(gender === 'female' ? 1.04 : 1.12) * buildVariance, 1, (gender === 'female' ? .40 : .42) * buildVariance])
  addMesh(chest, garmentGeometry([[-.22, 1.67], [.22, 1.67], [.12, .82], [0, .68], [-.12, .82]], .07), shirt, [0, 0, .31])
  addMesh(chest, garmentGeometry([[0, 1.63], [-.35, 1.30], [-.23, .86], [-.02, 1.10]], .075), suitLight, [-.012, 0, .35])
  addMesh(chest, garmentGeometry([[0, 1.63], [.35, 1.30], [.23, .86], [.02, 1.10]], .075), suitLight, [.012, 0, .35])
  addMesh(chest, garmentGeometry([[-.50, .73], [-.05, .62], [-.04, -.02], [-.51, .05]], .065), suit, [0, 0, .325])
  addMesh(chest, garmentGeometry([[.50, .73], [.05, .62], [.04, -.02], [.51, .05]], .065), suitLight, [0, 0, .325])
  if (cosmetics) {
    addNeckwear(chest, cosmetics.tie ?? (gender === 'male' ? 'tie_house_burgundy' : 'tie_open_collar'), { shirt, accent: chalk, stripe: gold })
  } else if (gender === 'male') {
    addMesh(chest, garmentGeometry(TIE_SHAPE, .06), tie, [0, 0, .395])
  } else {
    addMesh(chest, garmentGeometry(OPEN_COLLAR_SHAPE, .06), shirt, [0, 0, .40])
  }
  if (cosmetics?.suit === 'suit_pinstripe') {
    // Six bars down the jacket fronts. A texture would be the obvious way to do
    // this and is exactly what the rest of this file does without, so the
    // stripe count is set by what reads at office-scene distance rather than
    // by what a real chalk stripe would have. `.402` clears the front panels,
    // whose bevel carries them out to .3795.
    for (const x of [-.40, -.27, -.14, .14, .27, .40]) {
      addMesh(chest, softBoxGeometry(.026, .62, .02, .006), chalk, [x, .35, .402])
    }
  }
  // Jacket buttons, at four and a half millimetres of world. They survive on a
  // foreground body and are noise on a background one.
  if (!reducedDetail) for (const y of [.42, .82]) ellipsoid(chest, brass, [.08, y, .39], [.045, .045, .025], 18)
  // The breast-pocket welt, at 1.8 px.
  if (!silhouetteOnly) addMesh(chest, softBoxGeometry(.24, .035, .04, .014), shirt, [.31, .62, .39])

  // Arms hang inboard far enough to bury their top end inside the ribcage. At
  // the previous .68 the upper arm was merely tangent to a torso .606 wide at
  // shoulder height, so the eight degrees of abduction in the rest pose below
  // opened daylight at the armpit and the whole arm read as a separate object
  // hung beside the body rather than growing out of it.
  const armX = gender === 'female' ? .56 : .60
  const upperArmR = gender === 'female' ? .18 : .195
  // Pulled up toward the upper arm's radius. A limb that steps from .195 to
  // .165 across a joint shows a visible notch there even when it is straight.
  const foreArmR = gender === 'female' ? .167 : .178
  const makeArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * armX, 1.43, 0)
    chest.add(shoulder)
    // The legs already solved this: their capsules run well past the knee, and
    // the comment there notes it removes the toy-block seam. The arms never got
    // the same treatment, so every rotation split them at the joint. Each
    // segment now overruns its pivot and a ball sits at the pivot itself, which
    // is what keeps a limb of rigid parts continuous through a bend without
    // needing a skinned mesh.
    ellipsoid(shoulder, suit, [0, 0, 0], [upperArmR * 1.06, upperArmR * 1.03, upperArmR * .96], 20)
    addMesh(
      shoulder,
      capsuleGeometry(upperArmR, .62, 6, 14),
      suit,
      [0, -.47, 0],
      [0, 0, 0],
      [1, 1, .90],
    )
    const elbow = new THREE.Group()
    elbow.position.set(0, -.94, 0)
    shoulder.add(elbow)
    ellipsoid(elbow, suit, [0, 0, 0], [foreArmR * 1.09, foreArmR * 1.05, foreArmR * .98], 20)
    capsule(elbow, foreArmR, .68, suit, [0, -.42, 0], [1, 1, .92])
    addMesh(elbow, sharedGeometry(`shirt-cuff:${gender}`, () => new THREE.CylinderGeometry(gender === 'female' ? .172 : .182, gender === 'female' ? .172 : .182, .075, 18)), shirt, [0, -.90, 0])
    if (accessoryKey === 'accessory_wristwatch' && side === -1) addWristwatch(elbow, side, brass)
    const { hand, thumb } = addHand(elbow, side, skin)
    if (accessoryKey === 'accessory_briefcase' && side === 1) addBriefcase(hand)
    return { shoulder, elbow, hand, thumb }
  }
  const leftArm = makeArm(-1)
  const rightArm = makeArm(1)
  // The resting arm pose, which every clip is an offset from - so getting it
  // wrong makes the whole animation library ride on top of a mannequin.
  //
  // The previous values did the opposite of what they claimed. The left arm
  // sits at -X, and rotating its downward vector by a positive Z moves it
  // toward +X, which is *into* the ribcage; both arms were therefore adducted
  // two degrees and welded to the jacket with no daylight at the armpit.
  //
  // A hanging arm instead abducts roughly eight degrees, keeps a standing bend
  // at the elbow because a straight arm is a held pose rather than a relaxed
  // one, and carries thirty-odd degrees of internal rotation at the shoulder,
  // which is the reason a relaxed palm faces the thigh instead of the camera.
  const stanceJitter = ((subHash(paletteSeed, SALT_STANCE) % 5) - 2) * .011
  const abduction = .152 + stanceJitter
  // Deliberately not mirrored. Bilateral symmetry is the single loudest
  // mannequin cue, and the cheapest place to break it is the pair of arms.
  const leftShoulderZ = -abduction
  const rightShoulderZ = abduction + .024
  const leftElbowZ = -.04
  const rightElbowZ = .04
  leftArm.shoulder.rotation.set(-.10, .33, leftShoulderZ)
  rightArm.shoulder.rotation.set(-.055, -.33, rightShoulderZ)
  leftArm.elbow.rotation.set(-.25, .12, leftElbowZ)
  rightArm.elbow.rotation.set(-.19, -.12, rightElbowZ)

  const neck = new THREE.Group()
  neck.position.set(0, 1.68, 0)
  chest.add(neck)
  capsule(neck, .14, .20, skinShade, [0, .12, 0], [1, 1, .84])
  const head = new THREE.Group()
  head.position.set(0, .58, .015)
  neck.add(head)
  ellipsoid(head, skin, [0, 0, 0], [(gender === 'female' ? .455 : .46) * faceWidthVariance, .53 * faceHeightVariance, .405 * faceWidthVariance], 36)
  // Ears ride proud of the skull rather than flush with it. The head's x
  // semi-axis is .46, so an ear centred at .42 with a .06 semi-axis broke the
  // surface by only .02 and its shell ran very nearly parallel to the skull for
  // the rest of its span. Two near-coincident surfaces is the textbook recipe
  // for z-fighting, and it showed up as a band of flickering horizontal stripes
  // beside the head that looked like a torn second face.
  // Ears. Four meshes for a feature the hair covers on two of the three cuts,
  // and the widest of them is six centimetres, so a background body does
  // without and loses nothing the eye can find.
  if (!reducedDetail) for (const side of [-1, 1]) {
    ellipsoid(head, skin, [side * .452 * faceWidthVariance, -.015, -.015], [.062, .105, .068], 24)
    ellipsoid(head, skinShade, [side * .474 * faceWidthVariance, -.018, .01], [.016, .05, .022], 18)
  }
  addHair(head, gender, hair, hairVariant)

  const eyes: THREE.Group[] = []
  const pupils: THREE.Object3D[] = []
  for (const side of [-1, 1]) {
    const eye = new THREE.Group()
    eye.position.set(side * .14, .055, .365)
    head.add(eye)
    ellipsoid(eye, eyeWhite, [0, 0, 0], [.067, .080, .028], 24)
    const pupil = ellipsoid(eye, ink, [0, -.004, .027], [.032, .041, .016], 20)
    pupil.userData.baseZ = .027
    // The specular dot in the eye. Nine millimetres, and under a pixel at any
    // zoom the map allows.
    if (!silhouetteOnly) ellipsoid(eye, basic(0xffffff), [-.012, .018, .042], [.009, .011, .005], 14)
    eyes.push(eye)
    pupils.push(pupil)
    // A brow is a swept tube of fourteen segments for something under two
    // millimetres thick. It is a strong cue on a face that fills the frame and
    // an unresolvable smudge on one across the room.
    if (!reducedDetail) {
      addLine(head, [
        new THREE.Vector3(side * .22, .205, .382),
        new THREE.Vector3(side * .145, .228, .40),
        new THREE.Vector3(side * .075, .210, .393),
      ], gender === 'female' ? .015 : .018, hair)
    }
  }
  // The nose stays at every level: it is the one feature that keeps a head
  // reading as a face rather than an egg once the brows and mouth are gone.
  ellipsoid(head, skinShade, [0, -.05, .392], [.032, .058, .036], 22)
  if (!reducedDetail) {
    addLine(head, [
      new THREE.Vector3(-.105, -.235, .376),
      new THREE.Vector3(-.045, -.266, .397),
      new THREE.Vector3(0, -.271, .402),
      new THREE.Vector3(.045, -.266, .397),
      new THREE.Vector3(.105, -.235, .376),
    ], .012, lip)
  }

  // Deterministic seed variation, or the player's own choice where they have
  // made one. Either way these reuse the primitives the rest of the rig is
  // built from, so no configuration costs a new texture or a heavy mesh.
  if (role !== 'judge') {
    addEyewear(head, eyewearKey, { ink, brass })
    addChestAccessory(chest, accessoryKey, { brass, suitLight })
  }
  if (options.insignia && options.insignia !== 'none') {
    addInsignia(options.insignia, { chest, head }, { ink, brass, shirt, accent: chalk })
  }

  const satchel = new THREE.Group()
  satchel.position.set(.68, .30, .25)
  chest.add(satchel)

  // Contrapposto. Weight rests on one leg, the pelvis drops on the unloaded
  // side, and the unloaded knee stays soft; square hips over two straight
  // parallel legs is a pose people only hold to attention.
  //
  // Kept shallow on purpose. This offset is re-applied on top of every clip,
  // the walk included, so a deep baked bend would follow the character around
  // as a limp rather than reading as a rest.
  const loadedLeg = subHash(paletteSeed, SALT_STANCE) % 2 === 0 ? 1 : -1
  // The supporting leg tracks in under the body's centre of mass while the
  // free leg stays out where it fell, which is what opens the stance.
  leftLeg.hip.rotation.z = -.055 + (loadedLeg === -1 ? .042 : -.020)
  rightLeg.hip.rotation.z = .055 + (loadedLeg === 1 ? -.042 : .020)
  // Feet turn out, and never by the same amount on both sides.
  leftLeg.hip.rotation.y = -.055
  rightLeg.hip.rotation.y = .092
  // The free leg carries no load, so its knee hangs soft and its hip drifts
  // very slightly forward of the supporting one.
  if (loadedLeg === 1) {
    leftLeg.knee.rotation.x = .135
    leftLeg.hip.rotation.x = -.055
  } else {
    rightLeg.knee.rotation.x = .135
    rightLeg.hip.rotation.x = -.055
  }
  rightLeg.knee.rotation.z = -.012
  // The ribcage counter-tilts against the pelvis, which is what keeps the head
  // over the supporting foot instead of leaning the whole body off balance.
  chest.rotation.z = loadedLeg * -.020
  head.rotation.z = (gender === 'female' ? -.012 : .008) + loadedLeg * .014

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.frustumCulled = false
  })

  return {
    root,
    hips,
    spine,
    chest,
    head,
    leftShoulder: leftArm.shoulder,
    rightShoulder: rightArm.shoulder,
    leftElbow: leftArm.elbow,
    rightElbow: rightArm.elbow,
    leftHip: leftLeg.hip,
    rightHip: rightLeg.hip,
    leftKnee: leftLeg.knee,
    rightKnee: rightLeg.knee,
    leftFoot: leftLeg.foot,
    rightFoot: rightLeg.foot,
    leftHand: leftArm.hand,
    rightHand: rightArm.hand,
    leftThumb: leftArm.thumb,
    rightThumb: rightArm.thumb,
    satchel,
    eyes,
    pupils,
    base: { hipsY, leftShoulderZ, rightShoulderZ, leftElbowZ, rightElbowZ },
  }
}
