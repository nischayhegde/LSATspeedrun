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
}

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
 * Quantised, so the office's three slightly different body scales (.42, .44,
 * .46) share one set of geometry rather than cutting three near-identical
 * copies of every sphere in the cast.
 */
function setRenderScale(scale: number) {
  renderScale = Math.min(1, Math.max(.25, Math.round(scale * 4) / 4))
  detailTag = `d${renderScale}`
}

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
      bevelSegments: 2,
      bevelSize: Math.min(r * .32, .055),
      bevelThickness: Math.min(depth * .14, .05),
      curveSegments: 6,
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
      bevelSegments: 2,
      bevelSize: bevel,
      bevelThickness: bevel,
      curveSegments: 5,
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

function referenceHairGeometry(gender: CharacterGender) {
  // The displacement below pulls this shell down onto the skull, so its unit
  // radius says nothing about how big it ends up. It is a haircut: size it as
  // the head it sits on.
  const [radial, height] = sphereSegments(.95 * renderScale)
  return sharedGeometry(`reference-hair:${gender}:${radial}:${height}`, () => {
    // The male cut is a genuine open cap: no lower front surface can drift over
    // the face and read as a second, detached fringe. The female shell extends
    // around the back while lower front vertices tuck behind the cheeks.
    const geometry = new THREE.SphereGeometry(1, Math.min(28, radial), Math.min(18, height), 0, Math.PI * 2, 0, gender === 'male' ? 1.68 : 2.50)
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index)
      const y = positions.getY(index)
      const z = positions.getZ(index)
      const side = Math.abs(x)
      const left = Math.max(0, -x)
      const upper = Math.max(0, y)
      const lower = Math.max(0, -y)
      const front = Math.max(0, z)
      const back = Math.max(0, -z)
      if (gender === 'male') {
        // A restrained side part: a broad, low lift over the left temple and a
        // round crown. The former narrow/high crest produced the hard wedge
        // visible in the full-height lawyer panel.
        const part = Math.exp(-Math.pow((x + .18) / .58, 2))
        const crown = Math.pow(upper, .68)
        const curl = Math.exp(-Math.pow((x + .63) / .21, 2) - Math.pow((y - .48) / .36, 2))
        const templeLift = left * (.024 + upper * .018)
        const hairlineCurve = front * Math.max(0, 1 - side * 1.75) * .025
        positions.setXYZ(
          index,
          x * (.485 + upper * .02) - .01 - crown * part * .01 - curl * .055,
          y * .465 + .19 + templeLift + crown * (.042 + part * .052) + curl * .085 - side * .012 - back * .02 + hairlineCurve,
          z * (.41 + upper * .022 + back * .03) - .05 + front * crown * (.024 + part * .014) + curl * .028,
        )
      } else {
        const centerFront = Math.max(0, 1 - side * 1.8)
        positions.setXYZ(
          index,
          x * (.49 + lower * .15) - .012,
          y * .52 + .13 + left * .035 - side * lower * .018,
          z * (.39 + upper * .025) - .06 - front * lower * .42 * centerFront - back * lower * .02,
        )
      }
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

/** Three distinct silhouettes reusing the same reference geometry and
 *  primitives everywhere else in this file — no new heavy geometry, just
 *  different scale/placement of what already exists. */
function addHair(head: THREE.Group, gender: CharacterGender, hair: THREE.Material, variant: number) {
  if (variant === 1) {
    // Cropped: a tighter, shorter cut with the front sweep scaled down to match.
    addMesh(head, referenceHairGeometry(gender), hair, [0, 0, 0], [0, 0, 0], gender === 'male' ? [1.02, .70, .86] : [.95, .78, .90])
    if (gender === 'male') {
      addMesh(
        head,
        capsuleGeometry(.13, .43, 8, 20),
        hair,
        [-.075, .40, .30],
        [0, 0, -2.25],
        [.82, .78, .58],
      )
    }
    return
  }
  if (variant === 2) {
    // Voluminous: fuller coverage, plus a swept-back volume/bun for a
    // silhouette that reads distinctly from the default at a glance.
    addMesh(head, referenceHairGeometry(gender), hair, [0, 0, 0], [0, 0, 0], gender === 'male' ? [1.06, 1.08, 1.05] : [1.02, 1.10, 1.0])
    if (gender === 'male') {
      addMesh(
        head,
        capsuleGeometry(.13, .43, 8, 20),
        hair,
        [-.075, .455, .345],
        [0, 0, -2.25],
        [1.14, 1.05, .78],
      )
    } else {
      ellipsoid(head, hair, [0, .10, -.40], [.155, .175, .15], 18)
    }
    return
  }
  // Variant 0: the original reference cut, unchanged.
  addMesh(head, referenceHairGeometry(gender), hair)
  if (gender === 'male') {
    addMesh(
      head,
      capsuleGeometry(.13, .43, 8, 20),
      hair,
      [-.075, .455, .345],
      [0, 0, -2.25],
      [1.06, 1, .72],
    )
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
  setRenderScale(options.renderScale ?? 1)
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
  const hairColors = [0x1b1613, 0x2c2523, 0x3a2925, 0x5b3a2a, 0x7a4a30, 0x9c7645, 0xab8f5c, 0x8b8b8d]
  const skinIndex = subHash(paletteSeed, SALT_SKIN) % skinColors.length
  const hairIndex = subHash(paletteSeed, SALT_HAIR_COLOR) % hairColors.length
  const hairstyle = cosmetics?.hair ? HAIRSTYLES[cosmetics.hair] : undefined
  const skin = physical(skinColors[skinIndex], .58, .05)
  const skinShade = physical(new THREE.Color(skinColors[skinIndex]).offsetHSL(0, .01, -.08).getHex(), .64, .025)
  const hair = physical(hairstyle?.color ?? hairColors[hairIndex], .52, .12)
  // A restrained version of the reference's blue jacket: saturated enough to
  // read as a designed character, dark enough to sit inside the app's navy UI.
  const suitPalette = [0x315b84, 0x294f77, 0x24486d, 0x1f4163, 0x1b3857, 0x142f4b]
  const stage = tier >= 11 ? 5 : tier >= 8 ? 4 : tier >= 5 ? 3 : tier >= 3 ? 2 : tier >= 1 ? 1 : 0
  const visitorPalette = [0x31524f, 0x3f465c, 0x59434a, 0x315064, 0x4a3f5c, 0x5c4a35, 0x3a5c4a, 0x5c3f42]
  const seedColor = role === 'judge' ? 0x20242d : role === 'visitor' ? visitorPalette[subHash(paletteSeed, SALT_CLOTH) % visitorPalette.length] : suitPalette[stage]
  const chosenSuit = cosmetics?.suit ? SUIT_COLORWAYS[cosmetics.suit] : undefined
  const roleColor = chosenSuit ?? seedColor
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
  const hairVariant = hairstyle?.variant ?? subHash(paletteSeed, SALT_HAIRSTYLE) % 3
  const accessoryRoll = subHash(paletteSeed, SALT_ACCESSORY) % 5
  // "As issued" resolves back to whatever the seed rolled, which is how a
  // player who only changes their suit keeps the glasses they started with.
  const eyewearKey = cosmetics?.eyewear && cosmetics.eyewear !== 'eyewear_as_issued'
    ? cosmetics.eyewear
    : accessoryRoll === 0 ? 'eyewear_seed' : 'eyewear_none'
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
    const crease = capsule(hip, .014, .68, suitLight, [side * -.08, -.57, .245], [.7, 1, .55])
    crease.castShadow = false
    const knee = new THREE.Group()
    knee.position.set(0, -1.09, 0)
    hip.add(knee)
    capsule(knee, .245, .74, trouser, [0, -.54, 0], [1, 1, .91])
    const foot = new THREE.Group()
    foot.position.set(0, -1.12, .04)
    knee.add(foot)
    addMesh(foot, softBoxGeometry(.48, .24, .66, .12), shoe, [0, -.03, .17])
    addMesh(foot, softBoxGeometry(.50, .05, .68, .025), sole, [0, -.165, .17])
    addMesh(foot, softBoxGeometry(.39, .035, .27, .018), suitLight, [0, .012, .39])
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
  for (const y of [.42, .82]) ellipsoid(chest, brass, [.08, y, .39], [.045, .045, .025], 18)
  addMesh(chest, softBoxGeometry(.24, .035, .04, .014), shirt, [.31, .62, .39])

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
  for (const side of [-1, 1]) {
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
    ellipsoid(eye, basic(0xffffff), [-.012, .018, .042], [.009, .011, .005], 14)
    eyes.push(eye)
    pupils.push(pupil)
    addLine(head, [
      new THREE.Vector3(side * .22, .205, .382),
      new THREE.Vector3(side * .145, .228, .40),
      new THREE.Vector3(side * .075, .210, .393),
    ], gender === 'female' ? .015 : .018, hair)
  }
  ellipsoid(head, skinShade, [0, -.05, .392], [.032, .058, .036], 22)
  addLine(head, [
    new THREE.Vector3(-.105, -.235, .376),
    new THREE.Vector3(-.045, -.266, .397),
    new THREE.Vector3(0, -.271, .402),
    new THREE.Vector3(.045, -.266, .397),
    new THREE.Vector3(.105, -.235, .376),
  ], .012, lip)

  // Deterministic seed variation, or the player's own choice where they have
  // made one. Either way these reuse the primitives the rest of the rig is
  // built from, so no configuration costs a new texture or a heavy mesh.
  if (role !== 'judge') {
    addEyewear(head, eyewearKey, { ink, brass })
    addChestAccessory(chest, accessoryKey, { brass, suitLight })
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
