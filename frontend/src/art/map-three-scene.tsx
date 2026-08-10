import { useEffect, useRef, type CSSProperties } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { CharacterGender, FirmTier, GameAsset } from '../types'
import { buildStylizedCounsel, type StylizedCounselRig } from './stylized-counsel'
import {
  blockCourtyard,
  blocksFromGrid,
  buildCorridor,
  clearReserved,
  corridorCrossStreets,
  corridorFrontage,
  developBlock,
  ellipseFrontage,
  fabricNoise,
  isReserved,
  radialFrontage,
  ringFrontage,
  streetHalfPaved,
  streetWidth,
  streetsFromGrid,
  subdivideFrontage,
  voidCovers,
  zoningProfile,
  type BlockRect,
  type BlockSpec,
  type Corridor,
  type CorridorVoid,
  type CrossStreet,
  type PlannedBuilding,
  type PlannedStreet,
  type ReservedSite,
  type RoofForm,
  type StreetClass,
} from './map-urban-plan'
import { buildFacadeGroup, facadeTint, familyForRegion, type FacadeRecord } from './map-facades'
import {
  Crowd,
  TrafficSim,
  buildRoadGraph,
  corridorFootprints,
  cutFootwaysAroundSolids,
  markDocks,
  planFootways,
  type CarriagewaySpec,
  type FootwaySpec,
  type RoadGraph,
  type RoadGraphSpec,
} from './map-agents'
import { CROWD_RENDER_SCALE, CrowdRenderer, buildCrowdWalker, type CrowdWalker } from './map-crowd-rig'
import { createRiverBed, createRiverSurface, createSeaSurface, setSeaWake, type RiverOptions } from './map-water'
import { clearObjects, clearanceIntrusion, escapeCorridors, keepRecordsClear, prepareClearance, type ClearanceCorridor, type ClearanceField } from './map-clearance'
import { IllustratedRenderPass } from './render-style'
import { HumanoidActor } from './rig'

export type MapRegionKey = 'city' | 'nation' | 'ocean' | 'continent' | 'orbit'
export type MapSceneKind = 'tier' | 'rival' | 'event'
export type MapViewMode = 'career' | 'rivals' | 'dockets'

export type MapSceneTier = {
  key: string
  kind: 'tier'
  data: FirmTier
  state: 'complete' | 'current' | 'next' | 'locked'
}

export type MapSceneRival = {
  key: string
  kind: 'rival'
  data: GameAsset
  locked: boolean
}

export type MapSceneEvent = {
  key: string
  kind: 'event'
  data: { key: string; name: string; detail: string; minTier: number }
  locked: boolean
}

export type MapScenePoint = MapSceneTier | MapSceneRival | MapSceneEvent

export type MapCameraAction = 'in' | 'out' | 'home' | 'focus' | 'landmark'
export type CameraCommand = { id: number; action: MapCameraAction; landmark?: string }
type XZ = [number, number]

type ArcDefinition = {
  title: string
  subtitle: string
  skyTop: number
  skyBottom: number
  fog: number
  ground: number
  stone: number
  accent: number
  road: number
  route: XZ[]
  rail: XZ[]
  fov: number
  exposure: number
  fogDensity: number
  camera: [number, number, number]
  target: [number, number, number]
  sun: { color: number; intensity: number; position: [number, number, number] }
  ambient: { sky: number; ground: number; intensity: number }
  fill: { color: number; intensity: number; position: [number, number, number] }
  rim: { color: number; intensity: number; position: [number, number, number] }
}

const ARC: Record<MapRegionKey, ArcDefinition> = {
  city: {
    title: 'Old Quarter', subtitle: 'Municipal practice · courthouse district',
    skyTop: 0x6e91a0, skyBottom: 0xddc59d, fog: 0xa3aca2, ground: 0x667661,
    stone: 0x968c7b, accent: 0xa66d45, road: 0x30383a,
    // Chancery Row runs dead straight down the middle of the corridor band, on
    // the same east–west line as the two arterials that bracket it. Five
    // previous passes kept this as a shallow sine wave, and that single choice
    // is what made the high street read as foreign: the ward grid either side
    // is exactly axis-aligned, so a route that wanders ±1.2 units puts every
    // shopfront derived from it at up to twelve degrees off square against a
    // perfectly rectilinear background. A real high street is a street *of* the
    // grid — same alignment, same junction geometry, wider section — and the
    // only way to get that is for the centreline itself to be straight.
    route: [[-14, 0], [-7, 0], [0, 0], [7, 0], [14, 0]],
    rail: [[-16, 8], [-8, 7.1], [0, 8.2], [8, 7.2], [16, 8]],
    fov: 32, exposure: 1.34, fogDensity: .0062,
    camera: [23, 28, 36], target: [0, .7, 0],
    sun: { color: 0xffd19a, intensity: 4.65, position: [-25, 34, 17] },
    ambient: { sky: 0x9ebcc2, ground: 0x263631, intensity: .48 },
    fill: { color: 0x8bb6c1, intensity: .54, position: [20, 13, -18] },
    rim: { color: 0xffd69a, intensity: .76, position: [7, 15, -25] },
  },
  nation: {
    title: 'The Circuit', subtitle: 'Appellate route · regional courts',
    skyTop: 0x7495a1, skyBottom: 0xd9cba9, fog: 0xa7afa4, ground: 0x657663,
    stone: 0x7d7467, accent: 0x527568, road: 0x2b3334,
    // A turnpike, not a lane. Turnpikes were surveyed in long tangents and
    // changed direction at a parish boundary, not every eighty metres — the old
    // waypoints zig-zagged ±1.5 units six times across twenty-eight, which is
    // why the road read as a snake dropped onto the fields. Two long straights
    // joined by one gentle easement keeps the alignment legible while still
    // giving the eye a reason to follow it, and every field, verge and frontage
    // in the corridor pass is measured from the centreline so they all reflow.
    route: [[-15, .85], [-9, .85], [-3, .5], [3, -.35], [9, -.35], [15, -.35]],
    rail: [[-16, 7.7], [-9, 6.7], [-2, 7.4], [5, 6.6], [16, 7.4]],
    fov: 31, exposure: 1.31, fogDensity: .0068,
    camera: [24, 30, 38], target: [0, .55, 0],
    // The Circuit had the weakest sun and the highest ambient floor of the
    // three land regions, which is the Sovereign Arc's old failure in milder
    // form: a lot of skylight and not much key leaves the shaded elevations
    // almost as bright as the lit ones, and open country has no street walls
    // to bounce a shadow off. The key comes up and the fill goes down so the
    // range the facade palette carries actually reaches the screen, and the
    // warm rim keeps the hedgerows and roof ridges legible against the fields.
    sun: { color: 0xffe7bd, intensity: 4.95, position: [-20, 36, 22] },
    ambient: { sky: 0xa9c4c5, ground: 0x2b382d, intensity: .4 },
    fill: { color: 0x90b2bd, intensity: .36, position: [22, 12, -16] },
    rim: { color: 0xe8c98c, intensity: .7, position: [5, 14, -24] },
  },
  ocean: {
    title: 'Treaty Sea', subtitle: 'Maritime counsel · diplomatic harbor',
    skyTop: 0x56869a, skyBottom: 0xd2cdb6, fog: 0x8faaaa, ground: 0x47736d,
    stone: 0x77746d, accent: 0x326d76, road: 0x293337,
    route: [[-15, 1], [-11, .7], [-7, -1.2], [-2, .8], [3, .2], [8, -1.5], [14, .4]],
    rail: [[-15, 7], [-7, 6.4], [0, 7.2], [7, 6.3], [15, 7]],
    fov: 33, exposure: 1.28, fogDensity: .0054,
    camera: [24, 27, 38], target: [0, .35, 0],
    sun: { color: 0xffe4b8, intensity: 4.85, position: [-27, 37, 10] },
    ambient: { sky: 0xaed2d3, ground: 0x193338, intensity: .62 },
    fill: { color: 0x69a9bb, intensity: .72, position: [23, 10, -19] },
    rim: { color: 0xffd18a, intensity: .88, position: [8, 13, -27] },
  },
  continent: {
    title: 'Sovereign Arc', subtitle: 'Continental chamber · civic axis',
    // This region has now been over-corrected in both directions. It was first
    // too dark, and the fix — a high ambient floor, a 2.2-intensity fill on the
    // camera's own side and 1.62 exposure — bleached it to a flat cream with no
    // shadow left anywhere. Legibility is a *contrast* problem, not a
    // brightness one: the palette in `map-facades` now carries real range, so
    // the lighting's job here is to let that range show. Ambient comes down to
    // a plausible skylight, the camera-side fill drops to a fill rather than a
    // second key, and exposure returns to roughly where the other land regions
    // sit. The sun stays strong and warm so the shadow side has somewhere cool
    // to fall away to.
    skyTop: 0x5b7d97, skyBottom: 0xc79c8a, fog: 0x8b928f, ground: 0x64705c,
    stone: 0x7d776d, accent: 0x805a43, road: 0x252d30,
    // The ceremonial axis of a Beaux-Arts plan is a straight line by definition
    // — it is the instrument the whole composition is set out from. The old
    // waypoints wandered ±2 units through a rond-point, six radial avenues and
    // three concentric block rings that are all struck from the origin, so the
    // one element the plan exists to frame was the one element out of true.
    // z = -.1 is the composition's own centre (every disc, ring and parterre
    // below is offset by it), which makes this route the missing 0°/180° pair
    // of radials rather than a path laid across them.
    route: [[-15, -.1], [-5, -.1], [5, -.1], [15, -.1]],
    rail: [[-16, 7.7], [-9, 7], [-1, 7.7], [7, 6.8], [16, 7.3]],
    fov: 31, exposure: 1.3, fogDensity: .0062,
    camera: [24, 29, 39], target: [0, .75, -.3],
    sun: { color: 0xffc79c, intensity: 4.7, position: [-24, 30, 15] },
    // Cool skylight against the warm sun: the chromatic split between lit and
    // shaded stone is most of what makes masonry read as masonry.
    ambient: { sky: 0x93b3c4, ground: 0x33443f, intensity: .46 },
    fill: { color: 0xe8d3b4, intensity: .82, position: [16, 11, 20] },
    rim: { color: 0xffc38a, intensity: .92, position: [5, 15, -27] },
  },
  orbit: {
    title: 'Global Compact', subtitle: 'International assembly · final jurisdiction',
    skyTop: 0x030714, skyBottom: 0x161a36, fog: 0x090e1b, ground: 0x17232b,
    stone: 0x78817e, accent: 0x4b686e, road: 0x222b30,
    route: [[-15, 1.8], [-11, .3], [-7, -1.3], [-2, .6], [3, 1.2], [8, -1.1], [14, .1]],
    rail: [[-16, 7.6], [-8, 6.8], [0, 7.6], [8, 6.7], [16, 7.5]],
    fov: 36, exposure: 1.15, fogDensity: .0018,
    camera: [27, 25, 43], target: [0, .9, 0],
    sun: { color: 0xeef7ff, intensity: 5.8, position: [-26, 31, 18] },
    ambient: { sky: 0x18233d, ground: 0x060a12, intensity: .18 },
    fill: { color: 0x5ea6bd, intensity: .66, position: [24, 8, -19] },
    rim: { color: 0x79dbe3, intensity: 1.05, position: [4, 12, -28] },
  },
}

const sharedGeometry = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 20),
  sphere: new THREE.SphereGeometry(1, 18, 12),
  cone: new THREE.ConeGeometry(1, 1, 4),
}
Object.values(sharedGeometry).forEach((geometry) => { geometry.userData.mapShared = true })
const sharedCylinderGeometry = new Map<number, THREE.CylinderGeometry>([[20, sharedGeometry.cylinder]])

function cylinderGeometry(sides: number) {
  const cached = sharedCylinderGeometry.get(sides)
  if (cached) return cached
  const geometry = new THREE.CylinderGeometry(1, 1, 1, sides)
  geometry.userData.mapShared = true
  sharedCylinderGeometry.set(sides, geometry)
  return geometry
}

function hashUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123
  return value - Math.floor(value)
}

/**
 * The district asked for a material per call, which left ~2,900 instances
 * describing only ~130 distinct looks. Sharing them cuts GPU state changes and
 * is what lets `batchStaticScenery` collapse meshes into large batches.
 *
 * Shared instances outlive any single mount, so they are flagged the same way
 * shared geometry already is and skipped by `disposeScene`. Nothing may mutate
 * a material returned from here; see `setOccluderFade`, which swaps in a
 * variant rather than editing one in place.
 */
const sharedMaterials = new Map<string, THREE.MeshStandardMaterial>()

function material(color: number, roughness = .78, metalness = .02) {
  const key = `${color}:${roughness}:${metalness}`
  const cached = sharedMaterials.get(key)
  if (cached) return cached
  const created = new THREE.MeshStandardMaterial({ color, roughness, metalness })
  created.userData.mapShared = true
  sharedMaterials.set(key, created)
  return created
}

function groundMaterial(color: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const base = new THREE.Color(color)
  context.fillStyle = `#${base.getHexString()}`
  context.fillRect(0, 0, 256, 256)
  let seed = color >>> 0
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let index = 0; index < 900; index += 1) {
    const value = 95 + Math.round(random() * 80)
    context.fillStyle = `rgba(${value},${value + 5},${value},${.018 + random() * .045})`
    const size = 1 + random() * 3
    context.fillRect(random() * 256, random() * 256, size, size)
  }
  context.strokeStyle = 'rgba(225,218,194,.035)'
  context.lineWidth = 1
  for (let value = 0; value <= 256; value += 32) {
    context.beginPath(); context.moveTo(value, 0); context.lineTo(value, 256); context.stroke()
    context.beginPath(); context.moveTo(0, value); context.lineTo(256, value); context.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(28, 22)
  texture.anisotropy = 4
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture, roughness: .98, metalness: 0 })
}

function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, position?: [number, number, number]) {
  const item = new THREE.Mesh(geometry, mat)
  if (position) item.position.set(...position)
  item.castShadow = true
  item.receiveShadow = true
  return item
}

function box(size: [number, number, number], mat: THREE.Material, position?: [number, number, number]) {
  const item = mesh(sharedGeometry.box, mat, position)
  item.scale.set(...size)
  return item
}

function cylinder(radius: number, height: number, mat: THREE.Material, position?: [number, number, number], sides = 20) {
  const item = mesh(cylinderGeometry(sides), mat, position)
  item.scale.set(radius, height, radius)
  return item
}

function curveFrom(points: XZ[], y = .04) {
  return new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z)), false, 'catmullrom', .26)
}

/**
 * A curve running alongside another one, offset by a constant lateral
 * distance at every point along its length. Used to lay a sidewalk (or any
 * other parallel ribbon) that actually follows the career route's own wobble
 * instead of assuming it is straight, which is what let earlier passes drift
 * out of true parallel with the road they were meant to run beside.
 */
function offsetCurve(base: THREE.Curve<THREE.Vector3>, distance: number, y: number, samples = 48) {
  const points: THREE.Vector3[] = []
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples
    const point = base.getPointAt(t)
    const tangent = base.getTangentAt(t).normalize()
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    points.push(point.clone().addScaledVector(normal, distance).setY(y))
  }
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', .26)
}

/**
 * A closed traffic circuit.
 *
 * Vehicles are advanced by wrapping a parametric offset, so an *open* curve
 * necessarily teleports every vehicle from its far end back to its start on
 * each lap — which is exactly what made traffic appear and disappear. Routing
 * looping traffic around a closed ring instead means the wrap happens at a
 * point that is continuous in world space, so there is nothing to see.
 */
function closedCircuit(points: XZ[], y = .1) {
  return new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z)), true, 'catmullrom', .2)
}

function ribbonGeometry(curve: THREE.Curve<THREE.Vector3>, width: number, segments = 120) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(Math.min(.999, t)).normalize()
    const side = new THREE.Vector3().crossVectors(up, tangent).normalize().multiplyScalar(width / 2)
    positions.push(point.x + side.x, point.y + side.y, point.z + side.z)
    positions.push(point.x - side.x, point.y - side.y, point.z - side.z)
    uvs.push(0, t * 10, 1, t * 10)
    if (i < segments) {
      const a = i * 2
      indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A flat quad cut in corridor space: the primitive every field, verge, yard,
 * green and orchard in The Circuit is made from.
 *
 * A field authored as a rotated box only agrees with the road on the stretches
 * where the road happens to run straight; everywhere it bends, the box either
 * leaves a wedge of bare grass along the verge or pushes its hedge out onto the
 * carriageway. Cutting the parcel between two corridor offsets instead means
 * its road-side boundary *is* the road's own curve, which is the whole
 * difference between a road laid through worked land and a road laid over a
 * tiling of rectangles.
 *
 * The vertex order and index pattern deliberately match `ribbonGeometry` — the
 * near offset first — so these sit in the scene the same way every road surface
 * does. Normals are written straight up rather than derived: the winding
 * `ribbonGeometry` uses makes `computeVertexNormals` produce a downward normal,
 * which is invisible on a carriageway that is meant to look dark anyway but
 * turned every field in this region into a sheet of shadowed grass, since a
 * surface facing away from the sun receives nothing but the ambient term.
 * Indexed, because `mergeGeometries` refuses to mix indexed and non-indexed
 * inputs and the static batcher would otherwise have to split these out.
 */
function corridorPatchGeometry(corridor: Corridor, from: number, to: number, dNear: number, dFar: number, steps = 6) {
  const near = Math.min(dNear, dFar)
  const far = Math.max(dNear, dFar)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let step = 0; step <= steps; step += 1) {
    const s = from + (to - from) * (step / steps)
    const [nearX, nearZ] = corridor.at(s, near)
    const [farX, farZ] = corridor.at(s, far)
    positions.push(nearX, 0, nearZ, farX, 0, farZ)
    normals.push(0, 1, 0, 0, 1, 0)
    uvs.push(0, s * .3, 1, s * .3)
    if (step < steps) {
      const base = step * 2
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/**
 * A field boundary — hedge, bank, or post-and-rail — following the corridor at
 * a constant offset. Short straight segments rotated onto the local tangent,
 * which is how a real hedge is planted along a lane: not one curved wall, but a
 * run of lengths that each take the line of the field in front of them.
 */
function corridorBoundary(
  root: THREE.Group,
  corridor: Corridor,
  from: number,
  to: number,
  d: number,
  options: { material: THREE.Material; height: number; thickness: number; step?: number; y?: number },
) {
  const step = options.step ?? 1.05
  const count = Math.max(1, Math.round((to - from) / step))
  const span = (to - from) / count
  for (let index = 0; index < count; index += 1) {
    const centre = from + span * (index + .5)
    const [x, z] = corridor.at(centre, d)
    const [tx, tz] = corridor.tangent(centre)
    // Overlapped by a hair so the joints between segments do not show as gaps
    // on the outside of a bend.
    const segment = box([span * 1.08, options.height, options.thickness], options.material, [x, (options.y ?? 0) + options.height / 2, z])
    segment.rotation.y = Math.atan2(tx, tz) + Math.PI / 2
    segment.castShadow = false
    root.add(segment)
  }
}

/** A boundary running out from the road across the corridor, at constant `s`. */
function crossBoundary(
  root: THREE.Group,
  corridor: Corridor,
  s: number,
  dFrom: number,
  dTo: number,
  options: { material: THREE.Material; height: number; thickness: number; y?: number },
) {
  const [ax, az] = corridor.at(s, dFrom)
  const [bx, bz] = corridor.at(s, dTo)
  const length = Math.hypot(bx - ax, bz - az)
  if (length < .2) return
  const segment = box([length, options.height, options.thickness], options.material, [(ax + bx) / 2, (options.y ?? 0) + options.height / 2, (az + bz) / 2])
  segment.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI / 2
  segment.castShadow = false
  root.add(segment)
}

function roadMesh(curve: THREE.Curve<THREE.Vector3>, width: number, color: number) {
  const group = new THREE.Group()
  const verge = mesh(ribbonGeometry(curve, width + .85), material(0x77786d, .98))
  verge.position.y = .015
  const road = mesh(ribbonGeometry(curve, width), material(color, .9))
  road.position.y = .055
  const center = mesh(ribbonGeometry(curve, .055), new THREE.MeshBasicMaterial({ color: 0xc9b980 }))
  center.position.y = .09
  group.add(verge, road, center)
  return group
}

function addCurveDashes(group: THREE.Group, curve: THREE.Curve<THREE.Vector3>, color: number, count: number, width: number, length: number, y: number) {
  const dashMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .14, roughness: .5, metalness: .18 })
  for (let index = 0; index < count; index += 1) {
    const t = (index + .5) / count
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t).normalize()
    const dash = box([width, .025, length], dashMaterial, [point.x, y, point.z])
    dash.rotation.y = Math.atan2(tangent.x, tangent.z)
    dash.castShadow = false
    group.add(dash)
  }
}

export type MapLandmarkKind = 'civic' | 'transit' | 'market' | 'green' | 'water' | 'industry' | 'housing' | 'monument'

export type MapLandmark = {
  key: string
  name: string
  kind: MapLandmarkKind
  detail: string
  position: XZ
  /** Pick radius on the ground plane, in world units. */
  radius: number
}

/**
 * Landmarks are registered on the world group during construction and read
 * back once the scene is built. Static scenery is merged into shared batches,
 * so a landmark cannot be a scene object that survives to be raycast; picking
 * instead projects the pointer onto the ground plane and looks the position up
 * in this list, which costs nothing per frame and keeps batching intact.
 */
function registerLandmark(root: THREE.Group, landmark: MapLandmark) {
  ;((root.userData.landmarks ??= []) as MapLandmark[]).push(landmark)
  return landmark
}

const STREET_SURFACE: Record<StreetClass, { markings: boolean; kerb: boolean }> = {
  arterial: { markings: true, kerb: true },
  collector: { markings: false, kerb: true },
  local: { markings: false, kerb: true },
  alley: { markings: false, kerb: false },
}

/** Free-flow speed by street class, in world units per second. */
const STREET_SPEED: Record<StreetClass, number> = {
  arterial: 2.1,
  collector: 1.6,
  local: 1.15,
  alley: .8,
}

type RoadWay = RoadGraphSpec['ways'][number]
type FootWay = FootwaySpec

/**
 * Distance from a kerb face to the centreline of the pavement running beside
 * it, and — the same number, deliberately — how far back from a kerb a pavement
 * that runs into one stops. Sharing it is what makes the four pavement ends at
 * a crossroads land on the four corners of the junction rather than near them,
 * which in turn is what lets the crowd pair them into square crossings.
 */
const KERB_TO_PAVEMENT = .28
/**
 * Half the paved width a walker may drift over on a planned street.
 *
 * `addPlannedStreets` draws its apron .37 wider than the carriageway on each
 * side, so a pavement centred .28 out from the kerb has .09 of paving to give
 * either way. That is narrow, and it is the honest figure: the crowd's default
 * half-width of .65 was letting the outer half of every walker's wander take
 * them into the traffic lane, on streets whose whole pavement is a third of a
 * metre wide.
 */
const STREET_PAVEMENT_HALF = .09
/**
 * Fallback half-width for a pavement whose builder did not state one, shared by
 * the crowd and by the pass that cuts pavements around solid footprints.
 *
 * One constant rather than two literals because the cut's whole correctness
 * argument is that it removes exactly the spans where the crowd's own steering
 * would have run out of room: give the two passes different ideas of how wide
 * an unstated pavement is and the cut is either timid or destructive by exactly
 * that difference.
 */
const CROWD_FOOTWAY_HALF = .65
/**
 * Whether pavements are taken out from under solid footprints before the crowd
 * is built. See `cutFootwaysAroundSolids`.
 *
 * Per region rather than globally, on the precedent of The Circuit's `verge:
 * false`: the pass is a clear win in two districts and a clear cost in the
 * third, and the third's cost is not a tuning problem. Walkers-in-any-solid over
 * 600 deterministic frames, on the .12 test radius the series has always used,
 * with the railway subtraction below present in every column:
 *
 * | region                     | no cut | cut   | shipped |
 * | -------------------------- | ------ | ----- | ------- |
 * | Old Quarter (`city`)       | .1299  | .0184 | cut     |
 * | The Circuit (`nation`)     | .2928  | .3295 | cut     |
 * | Sovereign Arc (`continent`)| .0535  | .2384 | no cut  |
 *
 * Vehicle-in-building is zero in all three regions in every column, wrong-side
 * frames are zero, and `moverHitsPerFrame` is unchanged.
 *
 * Why the Arc is excluded, since "the narrowest pavements in the game" was the
 * previous guess and is not the reason. The Arc's share is not a diffuse
 * property of the district, it is one or two people standing in one thing: over
 * ten seconds of simulated time with fourteen walkers, a single walker parked in
 * a wall *is* nine per cent of the region. The site list is different in every
 * arm ever measured, and the sites this cut moves people onto are geometry the
 * routing pass cannot see at all — instanced tree and hedge rows carry no
 * per-instance footprint — reached along pavement whose centreline is inside a
 * carriageway to begin with. So the cut does not make the Arc worse by cutting
 * too much. It makes it worse by moving people onto faults that were already
 * there, and the fix is those faults rather than this switch;
 * `.maps/keep/takeover5/NOTES.md` names them and their sites.
 *
 * The Circuit is kept on a narrower margin than it used to have — .2659 before
 * the railway subtraction, .3295 after, against .2928 with no cut at all — and
 * it stays because a walker inside a *building* is the defect that was reported:
 * its facade share goes .226 to 0, and its pedestrian contacts are zero either
 * way. Nine walkers and two rail cuts moved that share, which is the same
 * sensitivity the Arc has.
 */
const FOOTWAY_SOLID_CUT: Record<MapRegionKey, boolean> = {
  city: true,
  nation: true,
  continent: true,
  ocean: true,
  orbit: true,
}
/**
 * How much of the district's foot traffic each class of street carries.
 *
 * Local streets get pavements now — a quarter where only the six biggest
 * streets have anywhere to walk is most of why so little of the road network
 * had a pedestrian anywhere near it — but they should not get the same share of
 * the crowd as the high street. Weighting by class as well as by length is what
 * makes the difference between a district and a uniform scatter of people.
 */
const STREET_PAVEMENT_WEIGHT: Record<StreetClass, number> = { arterial: 1, collector: .6, local: .22, alley: 0 }

function roadWays(root: THREE.Group) {
  return (root.userData.roadWays ??= []) as RoadWay[]
}

/**
 * Strips of ground that must stay clear of buildings and props, over and above
 * the carriageways the road record already describes: a railway's right-of-way,
 * a river's channel. See `map-clearance`.
 */
function clearanceCorridors(root: THREE.Group) {
  return (root.userData.clearanceCorridors ??= []) as ClearanceCorridor[]
}

/**
 * Plant a tree field, having first taken out the trees that are in the water.
 *
 * An instanced field cannot be edited once built, so anything standing in a
 * corridor has to be dropped from the records before the instances are written.
 * The corridors used are whatever the region has recorded *so far*, which is
 * exactly right for a district that lays its roads and watercourses before it
 * plants: the trees along the Arc's south radial ran out to z=17.7, straight
 * through a river that had not existed until now.
 */
function addTreeField(root: THREE.Group, records: TreeRecord[]) {
  const corridors = clearanceCorridors(root).slice()
  for (const way of roadWays(root)) {
    if (way.kind === 'water') corridors.push({ points: way.points, closed: way.closed, halfWidth: (way.width ?? 2.8) / 2, label: 'water' })
  }
  if (!corridors.length) {
    root.add(buildInstancedTreeField(records))
    return
  }
  const field = prepareClearance(corridors)
  // A tree's own footprint is its trunk, not its crown: a bough over a channel
  // is a bough over a channel, and only the trunk has to be on the bank.
  const kept = records.filter((record) => !clearanceIntrusion(field, record.x, record.z, .16 * (record.scale ?? 1)))
  root.userData.treesCleared = records.length - kept.length
  root.add(buildInstancedTreeField(kept))
}

function footWays(root: THREE.Group) {
  return (root.userData.footWays ??= []) as FootWay[]
}

/**
 * A fresh id for one carriageway's pair of pavements. See `FootwaySpec.street`:
 * it is what lets the crowd tell "the far kerb of this street" from "the near
 * kerb of the next street over, with a terrace in between".
 */
function nextStreetId(root: THREE.Group) {
  const next = ((root.userData.streetIdCursor as number | undefined) ?? 0) + 1
  root.userData.streetIdCursor = next
  return next
}

/**
 * Places a district's stations, halts and berths on the record.
 *
 * A shuttle used to be eased with a single smoothstep across the whole line,
 * so it accelerated for half the district and decelerated for the other half
 * and never called anywhere: the platform it passed was scenery. Recording the
 * stops here lets the transport loop build a real stopping pattern out of
 * them — line speed between calls, a braking curve into each one, a dwell, and
 * a pull-away — which is the difference between a train and a bead on a wire.
 */
function transitStops(root: THREE.Group) {
  return (root.userData.transitStops ??= []) as XZ[]
}

/**
 * Contributes a drawn curve to the driveable network.
 *
 * Sampling rather than reusing the authored control points matters: a ring
 * road is drawn as a Catmull-Rom curve through a dozen corners, and a graph
 * built from those corners alone is a polygon whose straight sides cut across
 * the carriageway the player can see. Sixty samples put the graph back on the
 * tarmac.
 */
function recordCurveWay(
  root: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  options: { closed?: boolean; speed?: number; kind?: RoadWay['kind']; samples?: number; portal?: boolean; width?: number },
) {
  const samples = options.samples ?? 60
  const points: XZ[] = []
  // A closed curve's last sample is its first, so it is dropped; the graph
  // wraps it itself and a duplicated point would weld into a zero-length edge.
  const count = options.closed ? samples : samples + 1
  for (let index = 0; index < count; index += 1) {
    const point = curve.getPointAt(index / samples)
    points.push([point.x, point.z])
  }
  roadWays(root).push({ points, closed: options.closed, kind: options.kind ?? 'road', speed: options.speed, portal: options.portal, width: options.width })
  return points
}

/**
 * A pavement running alongside a drawn curve, on both sides.
 *
 * `halfWidth` has to be the paving the curve's own drawing pass laid down. A
 * verge-side walk beside a country lane and the pavement of a high street are
 * both one call to this, and giving them the same lateral spread walks one of
 * them into the ditch.
 */
function recordCurveFootways(
  root: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  offset: number,
  closed = false,
  samples = 48,
  options: { halfWidth?: number; weight?: number } = {},
) {
  const street = nextStreetId(root)
  for (const side of [-1, 1]) {
    const points: XZ[] = []
    const count = closed ? samples : samples + 1
    for (let index = 0; index < count; index += 1) {
      const t = index / samples
      const point = curve.getPointAt(Math.min(.9999, t))
      const tangent = curve.getTangentAt(Math.min(.9999, t)).normalize()
      points.push([point.x - tangent.z * offset * side, point.z + tangent.x * offset * side])
    }
    footWays(root).push({ points, closed, halfWidth: options.halfWidth, weight: options.weight, street })
  }
}

/**
 * Turns a drawn street grid into a network agents can drive.
 *
 * A street is authored as one span from one edge of the grid to the other,
 * which is right for drawing it and useless for driving it: two spans that
 * cross have no vertex in common, so no amount of welding discovers the
 * crossing and every vehicle stays on the line it started on. Splitting each
 * span at the streets that cross it is the whole difference between a grid and
 * a set of parallel rails, because a node shared by four spans is exactly what
 * gives a car arriving at it somewhere else to go.
 *
 * The pavements come from the same pass, offset to sit inside the apron the
 * street already draws, so pedestrians walk on paving rather than beside it.
 * They are laid here as one run per street and cut apart at their junctions
 * later, by `planFootways`, once the whole network is known — a street does not
 * know which of the other streets in the district will end up crossing it.
 */
function recordStreetNetwork(root: THREE.Group, streets: PlannedStreet[]) {
  const ways = roadWays(root)
  const walks = footWays(root)
  streets.forEach((street) => {
    const crossings = streets
      .filter((other) => other.axis !== street.axis && other.position > street.from + .05 && other.position < street.to - .05)
      .map((other) => other.position)
      .sort((a, b) => a - b)
    const along = [street.from, ...crossings, street.to]
    const horizontal = street.axis === 'ew'
    const at = (value: number, offset = 0): XZ => horizontal ? [value, street.position + offset] : [street.position + offset, value]
    const width = streetWidth(street.streetClass)
    ways.push({
      points: along.map((value) => at(value)),
      kind: 'road',
      speed: STREET_SPEED[street.streetClass],
      width,
      // The ends of a grid street are where it leaves the district, which is
      // exactly where traffic should be allowed to appear and disappear.
      portal: true,
    })
    // Alleys have no kerb, so they have no pavement to walk on.
    const weight = STREET_PAVEMENT_WEIGHT[street.streetClass]
    if (!weight) return
    const offset = width / 2 + KERB_TO_PAVEMENT
    const id = nextStreetId(root)
    for (const side of [-1, 1]) {
      walks.push({
        points: [at(street.from, side * offset), at(street.to, side * offset)],
        halfWidth: STREET_PAVEMENT_HALF,
        weight,
        street: id,
      })
    }
  })
}

/**
 * Draws a street network so the hierarchy is actually visible from above:
 * every street gets a paved apron (the footway) with a darker carriageway
 * inside it, and only arterials are marked. The apron is what makes a grid
 * read as streets-between-blocks rather than as dark stripes on grass.
 */
function addPlannedStreets(root: THREE.Group, streets: PlannedStreet[], palette: { asphalt: number; pavement: number }) {
  recordStreetNetwork(root, streets)
  const pavementMaterial = material(palette.pavement, .98)
  const asphaltMaterial = material(palette.asphalt, .93)
  const markingMaterial = material(0xc7b982, .7, .05)
  streets.forEach((street) => {
    const width = streetWidth(street.streetClass)
    const surface = STREET_SURFACE[street.streetClass]
    const length = street.to - street.from
    if (length <= 0) return
    const along = (street.from + street.to) / 2
    const horizontal = street.axis === 'ew'
    const at = (y: number): [number, number, number] => horizontal ? [along, y, street.position] : [street.position, y, along]
    const size = (across: number): [number, number, number] => horizontal ? [length, .05, across] : [across, .05, length]
    if (surface.kerb) {
      // The same figure `blocksFromGrid` insets its plots by, so the paving and
      // the building line meet exactly instead of overlapping.
      const apron = box(size(streetHalfPaved(street.streetClass) * 2), pavementMaterial, at(.048))
      apron.castShadow = false
      root.add(apron)
    }
    const carriageway = box(size(width), asphaltMaterial, at(.07))
    carriageway.castShadow = false
    root.add(carriageway)
    if (surface.markings) {
      const line = box(size(.055), markingMaterial, at(.088))
      line.castShadow = false
      root.add(line)
    }
  })
}

/**
 * Each arc carries progression through infrastructure that belongs to that place:
 * a civic walk, an appellate road, shipping beacons, a formal boulevard, or an
 * orbital transfer corridor. The route is therefore part of the environment,
 * rather than a generic game ribbon laid over it.
 */
function createNativeCareerRoute(region: MapRegionKey, curve: THREE.Curve<THREE.Vector3>) {
  const group = new THREE.Group()
  group.userData.careerInfrastructure = true
  if (region === 'city') {
    // Chancery Row is built exactly like every other street in the quarter —
    // the same pavement colour, the same asphalt, the same marking stock as
    // `addPlannedStreets` uses — and differs only in being wider and marked
    // with a broken centre line, which is what a high street actually is. It
    // used to be a stone-paved civic walk with a brass inlay and thirty-four
    // cross-bands over it, and no amount of layout work could stop something
    // built out of different materials from the streets it meets reading as a
    // ribbon laid over the map rather than a road in it.
    const apron = mesh(ribbonGeometry(curve, 2.46, 180), material(0x8d8678, .98))
    const carriageway = mesh(ribbonGeometry(curve, 1.72, 180), material(0x343b3c, .93))
    apron.position.y = .046; carriageway.position.y = .07
    apron.castShadow = false; carriageway.castShadow = false
    group.add(apron, carriageway)
    // Broken centre line, running with the street rather than across it.
    addCurveDashes(group, curve, 0xc7b982, 26, .07, .52, .092)
  } else if (region === 'nation') {
    const verge = mesh(ribbonGeometry(curve, 1.92, 180), material(0x6d6b5e, .98))
    const road = mesh(ribbonGeometry(curve, 1.48, 180), material(0x3b403e, .92))
    verge.position.y = .018; road.position.y = .065
    group.add(verge, road)
    addCurveDashes(group, curve, 0xe0cf98, 22, .055, .52, .098)
  } else if (region === 'continent') {
    const foundation = mesh(ribbonGeometry(curve, 2.18, 180), material(0x626965, .94))
    const boulevard = mesh(ribbonGeometry(curve, 1.72, 180), material(0x303b3e, .76, .12))
    const transit = mesh(ribbonGeometry(curve, .22, 180), new THREE.MeshStandardMaterial({ color: 0x8ab8ad, emissive: 0x28665f, emissiveIntensity: .46, roughness: .4, metalness: .2 }))
    foundation.position.y = .018; boulevard.position.y = .072; transit.position.y = .112
    group.add(foundation, boulevard, transit)
    addCurveDashes(group, curve, 0xd7c17f, 24, .05, .38, .125)
  } else if (region === 'ocean') {
    const lane = mesh(ribbonGeometry(curve, .82, 180), new THREE.MeshBasicMaterial({ color: 0x80c0c2, transparent: true, opacity: .16, depthWrite: false }))
    lane.position.y = .105; lane.castShadow = false
    group.add(lane)
    const pilotLine = mesh(ribbonGeometry(curve, .075, 180), new THREE.MeshBasicMaterial({ color: 0xe2ca84, transparent: true, opacity: .58, depthWrite: false }))
    pilotLine.position.y = .12; pilotLine.castShadow = false
    group.add(pilotLine)
  } else {
    const transfer = mesh(new THREE.TubeGeometry(curve, 180, .055, 10, false), new THREE.MeshStandardMaterial({ color: 0x76d5de, emissive: 0x2d919b, emissiveIntensity: .92, roughness: .22, metalness: .48 }))
    const halo = mesh(new THREE.TubeGeometry(curve, 180, .16, 10, false), new THREE.MeshBasicMaterial({ color: 0x5eb5c1, transparent: true, opacity: .14, depthWrite: false }))
    transfer.castShadow = false; halo.castShadow = false
    group.add(halo, transfer)
  }
  return group
}

function makeTextTexture(lines: string[], options?: { accent?: string; width?: number; height?: number }) {
  const canvas = document.createElement('canvas')
  canvas.width = options?.width ?? 768
  canvas.height = options?.height ?? 220
  const context = canvas.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  gradient.addColorStop(0, 'rgba(13,25,29,.96)')
  gradient.addColorStop(1, 'rgba(28,38,39,.93)')
  context.fillStyle = gradient
  context.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 24)
  context.fill()
  context.strokeStyle = options?.accent ?? '#d9bd77'
  context.lineWidth = 7
  context.stroke()
  context.fillStyle = options?.accent ?? '#d9bd77'
  context.font = '700 30px Georgia, serif'
  context.fillText(lines[0].toUpperCase(), 42, 64)
  context.fillStyle = '#f5f0e2'
  context.font = '700 48px Georgia, serif'
  context.fillText(lines[1], 42, 126)
  if (lines[2]) {
    context.fillStyle = '#a9bbb6'
    context.font = '600 24px Arial, sans-serif'
    context.fillText(lines[2], 42, 173)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  return texture
}

function labelSprite(lines: string[], width = 5.6, accent = '#d9bd77') {
  const texture = makeTextTexture(lines, { accent })
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(width, width * .286, 1)
  sprite.userData.disposableTexture = texture
  // Ground indicator rings (beacon, selectionRing, landmarkRing) disable both
  // depthTest and depthWrite so they read cleanly against terrain, which also
  // means whichever object is issued last wins the pixel. Those rings carry
  // renderOrder 40-44; text cards must always win that draw-order race, or a
  // nearby ring visibly slices through the card instead of sitting beneath it.
  sprite.renderOrder = 70
  return sprite
}

function setSelectable(root: THREE.Object3D, data: { key: string; kind: MapSceneKind; locked: boolean }) {
  root.userData.mapSelection = data
  root.traverse((child) => { child.userData.mapSelectionRoot = root })
}

// Windows are the bulk of every building: one band per floor, each previously
// allocating its own material for one of only two possible looks.
const windowMaterials = new Map<'lit' | 'dim', THREE.MeshStandardMaterial>()

function windowMaterial(lit: boolean) {
  const key = lit ? 'lit' : 'dim'
  const cached = windowMaterials.get(key)
  if (cached) return cached
  const created = new THREE.MeshStandardMaterial({
    color: lit ? 0xb8c7bd : 0x314349,
    emissive: lit ? 0x554c32 : 0x10181b,
    emissiveIntensity: lit ? .32 : .12,
    roughness: .32,
    metalness: .24,
  })
  created.userData.mapShared = true
  windowMaterials.set(key, created)
  return created
}

function windowBand(width: number, count: number, y: number, depth: number, lit: boolean) {
  const group = new THREE.Group()
  const bandMaterial = windowMaterial(lit)
  const span = width / count
  for (let i = 0; i < count; i += 1) {
    group.add(box([span * .48, .34, .04], bandMaterial, [-width / 2 + span * (i + .5), y, depth]))
  }
  return group
}

function createLevelBuilding(point: MapSceneTier, definition: ArcDefinition) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  const tier = point.data.tier
  const isOldQuarter = tier < 5
  const width = 2.25 + Math.min(1.7, tier * .105)
  const floors = 2 + Math.min(6, Math.floor(tier / 2))
  const floorHeight = .72
  const height = floors * floorHeight
  const completed = point.state === 'complete'
  const current = point.state === 'current'
  const next = point.state === 'next'
  const labelFor = (heightValue: number) => {
    const label = labelSprite([
      `LEVEL ${tier + 1} · ${point.state.toUpperCase()}`,
      point.data.name,
      current ? 'YOUR HEADQUARTERS' : next ? 'NEXT OFFICE' : completed ? 'ESTABLISHED' : 'FUTURE PRACTICE',
    ], current ? 2.72 : 2.55, current ? '#f0cc72' : completed ? '#7fc1ae' : '#c1b38f')
    label.position.set(0, heightValue + 1.72, 0)
    label.userData.mapLabelKind = 'career'
    label.userData.mapLabelKey = point.key
    label.userData.mapLabelAlways = current
    return label
  }
  if (definition.title === 'Treaty Sea') {
    const pale = material(point.state === 'locked' ? 0x84847c : current ? 0x9b8264 : 0xa9a18f, .84)
    const roof = material(0x61483c, .78)
    group.add(box([2.5, 1.55, 1.7], pale, [0, .8, 0]))
    group.add(box([1.18, 2.35, 1.25], pale, [-.62, 1.18, -.15]))
    group.add(mesh(new THREE.ConeGeometry(.82, .72, 16), roof, [-.62, 2.72, -.15]))
    group.add(box([2.85, .13, .48], material(0x6c6960, .92), [0, .12, 1.08]))
    group.add(box([.48, .86, .08], material(0x26383a, .54, .18), [.42, .52, .88]))
    for (const x of [-.86, 0, .86]) group.add(box([.34, .38, .04], new THREE.MeshStandardMaterial({ color: 0x79a0a1, emissive: current ? 0x3a4d40 : 0x18272a, emissiveIntensity: current ? .65 : .18, roughness: .32 }), [x, 1.08, .87]))
    group.add(labelFor(2.95))
    setSelectable(group, { key: point.key, kind: 'tier', locked: point.state === 'locked' })
    return { group, height: 2.95 }
  }
  if (definition.title === 'Global Compact') {
    const station = createOrbitalStation(.76 + (tier - 12) * .07, current ? 0xe2bd69 : 0x6ba8b0)
    group.add(station)
    group.add(labelFor(2.4))
    setSelectable(group, { key: point.key, kind: 'tier', locked: point.state === 'locked' })
    return { group, height: 2.4 }
  }
  const facadeColor = point.state === 'locked'
    ? 0x74756e
    : current ? definition.accent
      : completed ? 0x627e73
        : next ? definition.stone : 0x74756e
  const facade = material(facadeColor, isOldQuarter ? .92 : .56, isOldQuarter ? .02 : .12)
  const trim = material(isOldQuarter ? 0xc1ad89 : 0xb5b2a4, .82)
  const dark = material(0x293234, .8)
  const stone = material(0x6d6b60, .95)

  group.add(box([width + .65, .2, 2.55], stone, [0, .1, 0]))
  group.add(box([width + .35, .18, 2.3], trim, [0, .28, 0]))
  group.add(box([width, height, 1.75], facade, [0, .38 + height / 2, 0]))
  group.add(box([width + .16, .15, 1.94], trim, [0, .42 + height, 0]))
  // The plan, declared, because the office the player is walking to was the
  // largest thing on the map that routing could not see.
  //
  // These carry `playerOccluder` and a selection collider and nothing else, so
  // `crowdObstacles` — which only looks at an object that has a
  // `footprintRadius` — skipped every one of them, and `planFootways` therefore
  // ran pavement straight through the headquarters. Measured on the shipped
  // tree: 17.5 units of Sovereign Arc footway inside the tier-two office at
  // `11.4,2.95`, its single worst pedestrian site in every arm ever taken, and
  // 27.4 units through four of the five Old Quarter offices.
  //
  // The plinth, on `createCourthouse`'s precedent: it is the widest course and
  // it is the one at ankle height, so it is what a walker on the pavement
  // actually meets.
  markSolidBox(group, (width + .65) / 2, 1.275)
  group.userData.footprintRadius = (width + .65) / 2

  const columns = Math.max(3, Math.min(6, floors))
  for (let floor = 0; floor < floors; floor += 1) {
    const band = windowBand(width - .38, columns, .72 + floor * floorHeight, .89, current || ((floor + tier) % 3 === 0))
    group.add(band)
    if (floor > 0 && isOldQuarter) group.add(box([width + .03, .055, 1.82], trim, [0, .48 + floor * floorHeight, 0]))
  }

  const entrance = box([.58, .95, .09], dark, [0, .84, .91])
  group.add(entrance)
  if (tier >= 5) {
    for (const x of [-width * .34, width * .34]) group.add(cylinder(.1, 1.25, trim, [x, 1.02, 1.02], 12))
    group.add(box([width * .88, .16, .48], trim, [0, 1.64, .98]))
  }
  if (isOldQuarter) {
    const roof = mesh(sharedGeometry.cone, material(0x4a4037, .95), [0, height + .8, 0])
    roof.scale.set(width * .82, .65, 1.35)
    roof.rotation.y = Math.PI / 4
    group.add(roof)
  } else {
    group.add(box([width * .58, .42, 1.15], dark, [0, height + .72, 0]))
    if (tier >= 11) group.add(cylinder(.04, 1.8, trim, [0, height + 1.55, 0], 8))
  }

  group.add(labelFor(height))

  if (point.state === 'locked') {
    const scaffold = material(0x6d6658, .9)
    for (const x of [-width / 2 - .25, width / 2 + .25]) {
      group.add(box([.07, height + .8, .07], scaffold, [x, (height + .8) / 2, 1.08]))
    }
    for (let y = .8; y < height + .6; y += .8) group.add(box([width + .65, .055, .055], scaffold, [0, y, 1.08]))
  }
  setSelectable(group, { key: point.key, kind: 'tier', locked: point.state === 'locked' })
  return { group, height }
}

/**
 * Territory on this map is a rival firm's headquarters, and it reads in three
 * states so the world itself answers "where am I winning?" without opening a
 * panel: held offices fly the firm's own colours, contested ones carry a
 * pressure gauge showing how far their valuation has already been driven down,
 * and untouched ones sit in cold rival grey. The gauge is the important one —
 * it is the only place the campaign's slow work against a firm is visible as a
 * physical fact rather than a percentage in a list.
 */
function createRivalBuilding(point: MapSceneRival, index: number, definition: ArcDefinition) {
  const group = new THREE.Group()
  const width = 2.25 + (index % 2) * .45
  const height = 2.5 + (index % 3) * .65
  const held = point.data.owned
  const pressure = Math.min(1, (point.data.discount_bps ?? 0) / 4_500)
  const contested = !held && pressure > 0
  const facade = material(held ? 0x547a6d : contested ? 0x76574d : 0x6d5d56, .72)
  const trim = material(definition.stone, .85)
  group.add(box([width + .5, .18, 2.15], material(0x625f55, .95), [0, .1, 0]))
  group.add(box([width, height, 1.6], facade, [0, .24 + height / 2, 0]))
  // Declared for the same reason a tier office is, and it is the same fault: a
  // rival compound is a two-and-a-half-storey building with a click target on
  // it, and the pedestrian router could not see it either. 8.5 units of
  // Sovereign Arc pavement ran through the compound at `13,-7`.
  markSolidBox(group, (width + .5) / 2, 1.075)
  group.userData.footprintRadius = (width + .5) / 2
  // A firm under pressure keeps fewer lights on, floor by floor, as its people
  // are raided away and its filings stall.
  const floors = Math.floor(height / .65)
  const dark = contested ? Math.round(pressure * (floors - 1)) : 0
  for (let floor = 0; floor < floors; floor += 1) group.add(windowBand(width - .3, 3, .65 + floor * .62, .82, held || floor >= dark))
  group.add(box([width + .12, .12, 1.78], trim, [0, height + .29, 0]))
  group.add(box([.54, .84, .08], material(0x242b2c, .7), [0, .72, .82]))
  const ownershipPlaque = box([.82, .26, .06], material(held ? 0x6cae98 : contested ? 0xd0a957 : 0x9a6659, .42, .2), [0, 1.36, .86])
  group.add(ownershipPlaque)
  if (contested) {
    group.add(box([1.5, .1, .05], material(0x2b2320, .8), [0, 1.72, .86]))
    const gauge = box([1.42 * pressure, .06, .04], material(0xe0a24f, .3, .3), [-.71 + .71 * pressure, 1.72, .89])
    group.add(gauge)
  }
  if (held) {
    group.add(cylinder(.035, 1.5, material(0x3d4547, .5), [width / 2 - .16, height + 1.0, 0], 8))
    group.add(box([.72, .42, .03], material(0x6cae98, .5, .18), [width / 2 + .2, height + 1.55, 0]))
  }
  const status = held
    ? 'HELD BY YOUR FIRM'
    : contested
      ? `CONTESTED · ${Math.round(pressure * 45)}% OFF LIST`
      : 'STANDING · FULL PRICE'
  const rivalLabel = labelSprite(
    [held ? 'YOUR NETWORK' : 'RIVAL FIRM', point.data.name.replace('Acquire ', ''), status],
    4.2,
    held ? '#82c3ad' : contested ? '#e0bd69' : '#c6907f',
  )
  rivalLabel.position.set(0, height + 1.62, 0)
  rivalLabel.userData.mapLabelKind = 'rivals'
  rivalLabel.userData.mapLabelKey = point.key
  group.add(rivalLabel)
  setSelectable(group, { key: point.key, kind: 'rival', locked: point.locked })
  return group
}

function createEventSite(point: MapSceneEvent, definition: ArcDefinition) {
  const group = new THREE.Group()
  const metal = material(0x39484b, .45, .28)
  const brass = material(point.locked ? 0x77746c : 0xb89b5b, .36, .46)
  group.add(cylinder(1.05, .14, material(0x64665e, .96), [0, .08, 0]))
  group.add(cylinder(.09, 2.15, metal, [0, 1.15, 0], 12))
  group.add(box([1.48, .95, .18], brass, [0, 1.75, 0]))
  group.add(box([1.18, .64, .04], material(0x1d2b2e, .5), [0, 1.75, .12]))
  const label = labelSprite([point.locked ? 'LOCKED' : 'LIVE DOCKET', point.data.name, ''], 2.45, point.locked ? '#9a978d' : '#e0bd69')
  label.position.set(0, 2.95, 0)
  label.userData.mapLabelKind = 'dockets'
  label.userData.mapLabelKey = point.key
  group.add(label)
  group.userData.signal = true
  group.userData.signalBaseY = group.position.y
  group.userData.signalAccent = definition.accent
  setSelectable(group, { key: point.key, kind: 'event', locked: point.locked })
  return group
}

/**
 * The canopy blob, at its own resolution rather than the scene's general
 * sphere.
 *
 * Trees are by a wide margin the heaviest thing in these districts: two
 * overlapping crowns each, several hundred trees per region, and the shared
 * sphere is an 18x12 ball at 396 triangles apiece, which is more geometry per
 * canopy than most of the buildings behind them have in total. A crown is a
 * soft irregular blob about half a metre across on screen, so the facets of a
 * 10x7 ball are not readable, and it costs a third as much.
 *
 * `createTree` (the handful of hero trees flanking an island or a headquarters
 * frontage) used to declare its own 14x10 sphere inline — a *higher*
 * resolution than this shared one, and a fresh, unshared geometry allocated
 * and uploaded again on every call. There is nothing about a hero tree that
 * needs more facets than a field tree at the same on-screen size, so it now
 * shares this geometry too.
 */
const treeCrownGeometry = new THREE.SphereGeometry(1, 10, 7)
treeCrownGeometry.userData.mapShared = true

function createTree(scale = 1, color = 0x526b50) {
  const group = new THREE.Group()
  group.userData.footprintRadius = .46 * scale
  const trunk = material(0x554737, .98)
  group.add(cylinder(.095 * scale, 1.3 * scale, trunk, [0, .65 * scale, 0], 12))
  const baseColor = new THREE.Color(color)
  const clusters: Array<[number, number, number, number]> = [[0, 1.52, 0, .56], [-.36, 1.42, .02, .42], [.34, 1.44, -.04, .44], [-.12, 1.78, -.08, .43], [.17, 1.7, .2, .4]]
  clusters.forEach(([x, y, z, radius], index) => {
    const tone = baseColor.clone().offsetHSL(0, index % 2 ? -.02 : .015, (index - 2) * .018)
    const crown = mesh(treeCrownGeometry, material(tone.getHex(), .97), [x * scale, y * scale, z * scale])
    crown.scale.set(radius * scale, radius * scale * (.82 + index * .025), radius * scale * .78)
    group.add(crown)
  })
  group.userData.tree = true
  group.userData.phase = hashUnit(scale * 991 + color * .0001) * Math.PI * 2
  return group
}

type TreeRecord = { x: number; z: number; scale: number; color: number; y?: number }

/**
 * Planted areas — boulevards, park interiors, hedgerows, orchard rows — are
 * the largest single source of objects in a district, and none of them need
 * to be individually animated. Three instanced draws replace what used to be
 * six meshes per tree plus a per-frame sway update per tree.
 */

function buildInstancedTreeField(records: TreeRecord[]) {
  const group = new THREE.Group()
  if (!records.length) return group
  const dummy = new THREE.Object3D()
  const colour = new THREE.Color()
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x554737, roughness: .98, metalness: 0 })
  const trunks = new THREE.InstancedMesh(cylinderGeometry(6), trunkMaterial, records.length)
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .97, metalness: 0, vertexColors: true, emissive: 0x24301f, emissiveIntensity: .34 })
  const crowns = new THREE.InstancedMesh(treeCrownGeometry, crownMaterial, records.length * 2)
  records.forEach((record, index) => {
    const base = record.y ?? 0
    dummy.rotation.set(0, hashUnit(index * 31) * Math.PI, 0)
    dummy.position.set(record.x, base + .62 * record.scale, record.z)
    dummy.scale.set(.085 * record.scale, 1.24 * record.scale, .085 * record.scale)
    dummy.updateMatrix()
    trunks.setMatrixAt(index, dummy.matrix)
    for (let layer = 0; layer < 2; layer += 1) {
      const radius = (layer ? .42 : .56) * record.scale * (.86 + hashUnit(index * 17 + layer) * .3)
      dummy.position.set(
        record.x + (hashUnit(index * 7 + layer * 3) - .5) * .3 * record.scale,
        base + (layer ? 1.78 : 1.46) * record.scale,
        record.z + (hashUnit(index * 11 + layer * 5) - .5) * .3 * record.scale,
      )
      dummy.scale.set(radius, radius * .88, radius * .82)
      dummy.updateMatrix()
      crowns.setMatrixAt(index * 2 + layer, dummy.matrix)
      crowns.setColorAt(index * 2 + layer, colour.setHex(record.color).offsetHSL(0, (hashUnit(index * 13 + layer) - .5) * .05, (hashUnit(index * 19 + layer) - .5) * .07))
    }
  })
  for (const item of [trunks, crowns]) {
    item.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    item.castShadow = false
    item.receiveShadow = true
    item.computeBoundingSphere()
    if (item.instanceColor) item.instanceColor.needsUpdate = true
  }
  group.add(trunks, crowns)
  return group
}

/**
 * The open ground a block leaves behind. Naming it explicitly matters: a
 * courtyard, a garden, a yard and a car court all read differently from
 * above, and a district whose interiors are all the same tone reads as one
 * extruded mass rather than as blocks.
 */
function addBlockInterior(
  root: THREE.Group,
  interior: { x: number; z: number; width: number; depth: number; rotation: number },
  color: number,
  y = .052,
) {
  const surface = box([interior.width, .04, interior.depth], material(color, .99), [interior.x, y, interior.z])
  surface.rotation.y = interior.rotation
  surface.castShadow = false
  root.add(surface)
  return surface
}

function createLamp() {
  const group = new THREE.Group()
  group.add(cylinder(.045, 1.4, material(0x2d393b, .48, .3), [0, .7, 0], 8))
  const bulbMaterial = new THREE.MeshStandardMaterial({ color: 0xf2d893, emissive: 0x8c6428, emissiveIntensity: .85 })
  const bulb = mesh(sharedGeometry.sphere, bulbMaterial, [0, 1.45, 0])
  bulb.scale.set(.12, .12, .12)
  group.add(bulb)
  return group
}

function createPromenadeBollard(accent: number) {
  const group = new THREE.Group()
  const metal = material(0x263336, .42, .36)
  group.add(cylinder(.035, .34, metal, [0, .17, 0], 10))
  const lens = mesh(new THREE.SphereGeometry(.065, 12, 8), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .92 }), [0, .37, 0])
  lens.castShadow = false
  group.add(lens)
  return group
}

function createMarketStall(index: number) {
  const group = new THREE.Group()
  const timber = material(0x493629, .9)
  const canvas = material([0x7e4b3c, 0x5d6d64, 0x8a7246, 0x485f68][index % 4], .86)
  group.add(box([1.15, .08, .74], timber, [0, .55, 0]))
  for (const x of [-.48, .48]) for (const z of [-.28, .28]) group.add(cylinder(.025, .95, timber, [x, .48, z], 8))
  const canopy = box([1.35, .08, .94], canvas, [0, 1.04, 0])
  canopy.rotation.z = index % 2 ? .035 : -.035
  group.add(canopy)
  for (let item = 0; item < 5; item += 1) group.add(box([.11, .06, .11], material(0xa48251 + item * 0x020100, .95), [-.38 + item * .19, .63, .06]))
  return group
}

function createFountain() {
  const group = new THREE.Group()
  const stone = material(0x88837a, .82)
  const water = new THREE.MeshStandardMaterial({ color: 0x5f9da1, emissive: 0x153d43, emissiveIntensity: .18, roughness: .24, transparent: true, opacity: .86 })
  group.add(cylinder(.92, .18, stone, [0, .09, 0], 36))
  group.add(cylinder(.7, .08, water, [0, .2, 0], 36))
  group.add(cylinder(.11, 1.2, stone, [0, .72, 0], 16))
  const crown = mesh(new THREE.SphereGeometry(.19, 20, 12), stone, [0, 1.33, 0])
  group.add(crown)
  const sprayMaterial = new THREE.MeshBasicMaterial({ color: 0xb7d9d7, transparent: true, opacity: .46, depthWrite: false })
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 1.24, 0), new THREE.Vector3(Math.cos(angle) * .45, 1.75, Math.sin(angle) * .45), new THREE.Vector3(Math.cos(angle) * .67, .3, Math.sin(angle) * .67))
    const spray = mesh(new THREE.TubeGeometry(curve, 18, .012, 6, false), sprayMaterial)
    spray.castShadow = false
    spray.userData.fountainSpray = true
    spray.userData.phase = index * .63
    group.add(spray)
  }
  return group
}

function createBench(scale = 1) {
  const group = new THREE.Group()
  const timber = material(0x584638, .9)
  const iron = material(0x293335, .52, .32)
  for (const z of [-.18, .18]) group.add(box([1.05 * scale, .08 * scale, .12 * scale], timber, [0, .43 * scale, z * scale]))
  const back = box([1.05 * scale, .42 * scale, .07 * scale], timber, [0, .72 * scale, -.22 * scale])
  back.rotation.x = -.08
  group.add(back)
  for (const x of [-.43, .43]) {
    group.add(cylinder(.035 * scale, .46 * scale, iron, [x * scale, .23 * scale, -.12 * scale], 8))
    group.add(cylinder(.035 * scale, .46 * scale, iron, [x * scale, .23 * scale, .13 * scale], 8))
  }
  return group
}

function createRailPlatform(scale = 1) {
  const group = new THREE.Group()
  const stone = material(0x77766e, .94)
  const steel = material(0x344044, .46, .32)
  const glass = new THREE.MeshStandardMaterial({ color: 0x708e90, emissive: 0x1e3436, emissiveIntensity: .22, roughness: .28, transparent: true, opacity: .82 })
  group.add(box([5.6 * scale, .16 * scale, 1.05 * scale], stone, [0, .08 * scale, 0]))
  for (const x of [-2.2, 0, 2.2]) group.add(cylinder(.045 * scale, 1.6 * scale, steel, [x * scale, .85 * scale, 0], 8))
  group.add(box([5.35 * scale, .08 * scale, 1.55 * scale], steel, [0, 1.66 * scale, 0]))
  group.add(box([3.3 * scale, .72 * scale, .05 * scale], glass, [0, 1.14 * scale, -.3 * scale]))
  return group
}

function createCargoStack(seed: number, scale = 1) {
  const group = new THREE.Group()
  const colors = [0x5f6b69, 0x785a47, 0x4d6570, 0x6e684e, 0x594d49]
  for (let index = 0; index < 7; index += 1) {
    const row = index % 3
    const layer = Math.floor(index / 3)
    const cargo = box([1.25 * scale, .43 * scale, .52 * scale], material(colors[(seed + index) % colors.length], .72, .08), [(row - 1) * 1.31 * scale, (.25 + layer * .48) * scale, (index % 2) * .58 * scale])
    group.add(cargo)
    for (const x of [-.49, .49]) cargo.add(box([.025, .39, .54], material(0x30393a, .52, .28), [x, 0, 0]))
  }
  return group
}

function createPier(length = 4.5, width = 1.05) {
  const group = new THREE.Group()
  const timber = material(0x594a3a, .92)
  const edge = material(0x302e2a, .72, .08)
  group.add(box([width, .14, length], timber, [0, .15, 0]))
  for (let z = -length / 2 + .35; z <= length / 2; z += .85) {
    group.add(box([width + .12, .035, .06], edge, [0, .235, z]))
    for (const x of [-width * .42, width * .42]) group.add(cylinder(.045, .72, edge, [x, -.1, z], 8))
  }
  for (const x of [-width * .55, width * .55]) for (const z of [-length * .42, length * .42]) group.add(cylinder(.055, .62, edge, [x, .38, z], 8))
  return group
}

function createBuoy(color = 0xb47b45, scale = 1) {
  const group = new THREE.Group()
  const painted = material(color, .48, .22)
  group.add(cylinder(.24 * scale, .24 * scale, painted, [0, .12 * scale, 0], 18))
  const float = mesh(new THREE.SphereGeometry(.24 * scale, 18, 10), painted, [0, .26 * scale, 0])
  float.scale.y = .7
  group.add(float)
  group.add(cylinder(.045 * scale, .38 * scale, material(0x303b3c, .42, .36), [0, .51 * scale, 0], 8))
  group.add(mesh(new THREE.TorusGeometry(.13 * scale, .025 * scale, 8, 20), material(0x303b3c, .42, .36), [0, .68 * scale, 0]))
  const lens = mesh(sharedGeometry.sphere, new THREE.MeshStandardMaterial({ color: 0xe6c879, emissive: 0xa36b21, emissiveIntensity: .72, roughness: .35 }), [0, .74 * scale, 0])
  lens.scale.setScalar(.055 * scale)
  group.add(lens)
  group.userData.buoy = true
  group.userData.phase = hashUnit(color * .001 + scale * 71) * Math.PI * 2
  return group
}

function createIslandLandform(radius: number, seed: number, color = 0x66745f) {
  const shape = new THREE.Shape()
  const segments = 28
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * Math.PI * 2
    const coast = radius * (.82 + hashUnit(seed * 31 + index * 19) * .24)
    const x = Math.cos(angle) * coast
    const y = Math.sin(angle) * coast * (.58 + hashUnit(seed * 13) * .15)
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .34, bevelEnabled: true, bevelSegments: 2, bevelSize: .09, bevelThickness: .07, curveSegments: 4 })
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, .34, 0)
  geometry.computeVertexNormals()
  return mesh(geometry, material(color, .96))
}

function createSolarArray(scale = 1) {
  const group = new THREE.Group()
  const frame = material(0x697579, .35, .72)
  const panel = new THREE.MeshStandardMaterial({ color: 0x183d55, emissive: 0x0b1e2d, emissiveIntensity: .48, roughness: .25, metalness: .68 })
  group.add(cylinder(.055 * scale, 1.05 * scale, frame, [0, .52 * scale, 0], 10))
  for (const side of [-1, 1]) {
    const wing = box([2.25 * scale, .06 * scale, 1.05 * scale], panel, [side * 1.34 * scale, 1.03 * scale, 0])
    wing.rotation.z = side * -.055
    group.add(wing)
    for (const x of [-.72, 0, .72]) wing.add(box([.018, .07, 1.08 * scale], frame, [x * scale, 0, 0]))
  }
  return group
}

/**
 * How far an articulated building's mouldings may stand outside the rectangle
 * it was planned on.
 *
 * Small on purpose, and the same figure for every projection, so that "how much
 * bigger is the drawn building than the planned one" has one answer that both
 * the clearance pass and the crowd can be told. It used to be .12 for the trim,
 * .1 to .12 for the cornice, .41 for the awning and .48 for a modern canopy,
 * none of them written down anywhere, and the largest of them is four times the
 * .09 pavement it was overhanging.
 */
const ARTICULATION = .12

function createBlockBuilding(width: number, height: number, depth: number, color: number, modern = false, emissiveBoost = 0) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = Math.max(width, depth) * .54
  group.userData.performanceCullRadius = Math.hypot(width, height, depth) * .62
  // The drawn thing, reconciled with the planned rectangle rather than left to
  // exceed it. `renderPlannedBuildings` articulates the few blocks nearest the
  // camera and instances the rest, and both are laid out — and cleared of the
  // pavements — on `width` by `depth`. This one is then drawn with a cornice, a
  // canopy and an awning hanging off it, so the near buildings and only the
  // near buildings stood over paving the planner had already cleared for them:
  // the block passes the clearance check in plan while its awning is over the
  // kerb. Both the projections below are therefore held to `ARTICULATION`, and
  // that figure is declared to routing here so what a walker is steered around
  // is what a walker can see.
  group.userData.footprintBox = { hx: width / 2 + ARTICULATION, hz: depth / 2 + ARTICULATION }
  group.userData.footprintSolid = true
  // emissiveBoost bypasses the shared material cache (a self-lit facade is a
  // narrow, region-specific need, not something every other caller of this
  // very widely shared function should suddenly start rendering).
  const facade = emissiveBoost > 0
    ? new THREE.MeshStandardMaterial({ color, roughness: modern ? .46 : .88, metalness: modern ? .16 : .02, emissive: color, emissiveIntensity: emissiveBoost })
    : material(color, modern ? .46 : .88, modern ? .16 : .02)
  const trim = material(modern ? 0x9fa7a3 : 0xa99c82, .84)
  group.add(box([width, height, depth], facade, [0, height / 2, 0]))
  const columns = Math.max(2, Math.floor(width / .65))
  const floors = Math.max(2, Math.floor(height / .68))
  for (let floor = 0; floor < floors; floor += 1) {
    const band = windowBand(width - .28, columns, .48 + floor * (height / floors), depth / 2 + .015, (floor + columns) % 3 === 0)
    group.add(band)
  }
  group.add(box([width + ARTICULATION * 2, .12, depth + ARTICULATION * 2], trim, [0, height + .06, 0]))
  const doorway = box([Math.min(.52, width * .28), Math.min(.82, height * .38), .055], material(0x263235, .58, modern ? .24 : .08), [0, Math.min(.42, height * .19), depth / 2 + .04])
  group.add(doorway)
  if (modern) {
    const roofPlant = box([Math.min(1.05, width * .42), .34, Math.min(.8, depth * .4)], material(0x485355, .42, .34), [width * .16, height + .29, 0])
    group.add(roofPlant)
    const canopyDepth = .48
    const canopy = box([Math.min(1.3, width * .62), .08, canopyDepth], material(0x778284, .38, .38), [0, .72, depth / 2 + ARTICULATION - canopyDepth / 2])
    group.add(canopy)
  } else {
    const cornice = box([width + ARTICULATION * 2, .16, depth + ARTICULATION * 2], trim, [0, height + .15, 0])
    group.add(cornice)
    if (width > 1.55) {
      const chimney = box([.24, .62, .28], material(0x554a40, .94), [-width * .28, height + .46, -depth * .17])
      group.add(chimney)
    }
    const awningDepth = .42
    const awning = box([Math.min(1.05, width * .54), .08, awningDepth], material(new THREE.Color(color).offsetHSL(0, -.05, -.12).getHex(), .8), [0, .82, depth / 2 + ARTICULATION - Math.cos(.12) * awningDepth / 2])
    awning.rotation.x = -.12
    group.add(awning)
  }
  return group
}

type InstancedBlockRecord = FacadeRecord

/**
 * Assigns a material family and a weathered tint to a batch of buildings.
 *
 * The planner hands back a colour drawn from a small per-district palette,
 * which is why neighbouring buildings used to differ by almost nothing: four
 * colours across two hundred buildings is four colours. Re-deriving both the
 * family and the tint from a stable per-building seed is what turns that into
 * a street where the brick house next to the stuccoed one next to the stone
 * one are all visibly separate buildings, and it costs one hash per record at
 * build time and nothing at all per frame.
 *
 * Reserved sites keep their authored colour: a landmark that has been given a
 * specific stone is a decision, not an accident of the palette.
 */
function tintForRegion(region: MapRegionKey, record: InstancedBlockRecord, index: number) {
  const seed = record.seed ?? hashUnit(record.x * 3.11 + record.z * 7.73 + record.width * 1.9 + index) * 1000
  const family = record.family ?? familyForRegion(region, seed, { height: record.height })
  record.seed = seed
  record.family = family
  record.color = facadeTint(region, family, seed)
  return record
}

/**
 * Turns a planned district into geometry. The bulk goes through the facade
 * atlas; only the handful of buildings closest to the camera's resting frame
 * are built as articulated meshes (which the static batcher then merges),
 * because that is the only place the extra cornices and awnings are legible.
 */
/**
 * Half the beam of a walker, at the .278 the crowd is scaled to.
 *
 * Buildings are set back from a pavement by this much more than the paving is
 * wide, because what has to be clear is the person and not the kerb line.
 */
const WALKER_HALF_BEAM = .16

/**
 * The village footway beside a country lane: the two edges of the paving, and
 * the line the crowd walks down the middle of it, as offsets from the lane.
 *
 * Named because the paving and the pedestrian route were two unrelated literals
 * standing four hundred lines apart, and the route was a tenth of a unit off
 * the middle of its own paving.
 */
const VILLAGE_FOOTWAY_IN = 1.05
const VILLAGE_FOOTWAY_OUT = 1.66
const VILLAGE_FOOTWAY_MID = (VILLAGE_FOOTWAY_IN + VILLAGE_FOOTWAY_OUT) / 2

/**
 * Whether planned buildings are reconciled against the corridors before they
 * are instanced.
 *
 * This was off for two passes on the strength of "two 600-frame runs, one with
 * the pass and one without, agree on every figure to the last digit". That
 * measurement was invalid. The harness it was taken with skipped
 * `isInstancedMesh` when building its collision grid, and every planned building
 * in the district is an `InstancedMesh` — so the only thing this pass moves was
 * the one thing the metric could not see. The arms agreed because both were
 * measuring the same blind spot, not because the pass does nothing.
 *
 * Measured with the corrected harness over 600 deterministic frames, on the
 * Sovereign Arc: a train stood inside a building in 527 of 600 frames at
 * `-11.4,7.4` and in 463 at `-12.6,6.0`, to a depth of 1.196. With this on, both
 * sites disappear outright and the region's vehicle-in-building share falls from
 * every frame to three quarters of them. That is the whole of the "trains phase
 * through buildings" complaint, and it was a switch rather than a spline.
 */
const BUILDING_CLEARANCE_ENABLED = true

/**
 * Take a set of planned buildings out of the streets and pavements.
 *
 * The pavements matter more than the carriageways here. A walker is bound to a
 * footway polyline and may only shift within that footway's half-width, so it
 * physically cannot route around anything: a building standing over a pavement
 * puts people inside a wall for as long as that pavement is walked, and no
 * amount of steering can help. The carriageways are included for the same
 * reason at lower stakes, a car being at least able to brake.
 */
/** Every strip a building has to stay off, as recorded by the district so far. */
function buildingCorridors(root: THREE.Group): ClearanceCorridor[] {
  const corridors: ClearanceCorridor[] = clearanceCorridors(root).slice()
  for (const way of roadWays(root)) {
    const kind = way.kind ?? 'road'
    const width = way.width ?? (kind === 'water' ? 2.8 : 1.5)
    // The carriageway itself and a hand's breadth. Not the vehicle margin the
    // prop pass uses: a building is *supposed* to front onto the street, and
    // pushing every frontage back by half a car would unpick the street wall.
    corridors.push({ points: way.points, closed: way.closed, halfWidth: width / 2 + .06, label: kind })
  }
  for (const way of footWays(root)) {
    corridors.push({
      points: way.points,
      closed: way.closed,
      halfWidth: (way.halfWidth ?? .65) + WALKER_HALF_BEAM,
      label: 'footway',
    })
  }
  return corridors
}

function keepBuildingsClear(root: THREE.Group, buildings: PlannedBuilding[]) {
  const corridors = buildingCorridors(root)
  if (!corridors.length) return buildings
  const { kept, report } = keepRecordsClear(buildings, prepareClearance(corridors), { limit: 1.1, label: 'building' })
  // Accumulated across the several calls a district makes, so the harness can
  // read one figure per region rather than whichever batch happened to be last.
  const running = (root.userData.buildingClearance ??= { considered: 0, moved: 0, dropped: 0, worstBefore: 0 }) as {
    considered: number; moved: number; dropped: number; worstBefore: number
  }
  running.considered += report.considered
  running.moved += report.moved
  running.dropped += report.dropped
  running.worstBefore = Math.max(running.worstBefore, report.worstBefore)
  return kept
}

function renderPlannedBuildings(
  root: THREE.Group,
  region: MapRegionKey,
  buildings: PlannedBuilding[],
  options?: { articulateWithin?: number; articulateAround?: XZ; cullRadius?: number; modern?: boolean },
) {
  const records: InstancedBlockRecord[] = []
  const centre = options?.articulateAround ?? [0, 0]
  const articulateWithin = options?.articulateWithin ?? 0
  // Take the buildings out of the streets before any of them is built.
  //
  // `map-clearance` was written for exactly this and was wired to the props and
  // the tree fields but never to the buildings, so the largest static objects on
  // the map were the only ones checked against nothing. It matters most for
  // people rather than for cars: a pedestrian here cannot free-roam — the crowd
  // binds each walker to a footway polyline and only lets it shift within that
  // footway's half-width — so a walker seen inside a wall is not a steering
  // failure that better steering would fix, it is a pavement with a building
  // standing on it. Reconciling the two is the only thing that can help.
  //
  // Filtered as records rather than nudged as objects because these become
  // instances in a batched mesh, and an instance cannot be moved once written.
  // The corridors are whatever the district has recorded so far, which is the
  // same rule `addTreeField` follows and is right for every builder here: all
  // of them lay their streets before they place anything on them.
  if (BUILDING_CLEARANCE_ENABLED) buildings = keepBuildingsClear(root, buildings)
  // The footprints that were actually built, in plan.
  //
  // A harness can otherwise only see a building as a batch of wall instances,
  // and reconstructing a rotated footprint from those is guesswork that has
  // already hidden one fault for a whole pass. This is the same list the
  // clearance pass worked from, so a collision site can be attributed to the
  // record that caused it.
  const audit = (root.userData.buildingAudit ??= []) as Array<
    { x: number; z: number; width: number; depth: number; rotationY: number; region: MapRegionKey }
  >
  for (const building of buildings) {
    audit.push({ x: building.x, z: building.z, width: building.width, depth: building.depth, rotationY: building.rotationY, region })
  }
  buildings.forEach((building) => {
    const near = articulateWithin > 0 && Math.hypot(building.x - centre[0], building.z - centre[1]) < articulateWithin
    if (near) {
      const detailed = createBlockBuilding(building.width, building.height, building.depth, building.color, options?.modern ?? false)
      detailed.position.set(building.x, .02, building.z)
      detailed.rotation.y = building.rotationY
      root.add(detailed)
      return
    }
    records.push(tintForRegion(region, {
      x: building.x,
      z: building.z,
      width: building.width,
      depth: building.depth,
      height: building.height,
      color: building.color,
      lit: building.lit,
      rotationY: building.rotationY,
      roof: building.roof,
    }, records.length))
  })
  if (!records.length) return null
  const group = buildFacadeGroup(records, { region })
  if (options?.cullRadius) group.userData.performanceCullRadius = options.cullRadius
  root.add(group)
  return group
}

function createCourthouse(scale = 1, color = 0x938771) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = 2.7 * scale
  // The plinth, which is the widest thing here and the thing at ankle height.
  group.userData.footprintBox = { hx: 2.6 * scale, hz: 1.75 * scale }
  group.userData.footprintSolid = true
  const stone = material(color, .9)
  const trim = material(0xb6ab92, .84)
  group.add(box([5.2 * scale, .35 * scale, 3.5 * scale], stone, [0, .18 * scale, 0]))
  group.add(box([4.6 * scale, 2.4 * scale, 2.8 * scale], stone, [0, 1.5 * scale, 0]))
  for (const x of [-1.55, -.52, .52, 1.55]) group.add(cylinder(.13 * scale, 1.8 * scale, trim, [x * scale, 1.35 * scale, 1.55 * scale], 12))
  group.add(box([4.4 * scale, .24 * scale, .8 * scale], trim, [0, 2.38 * scale, 1.48 * scale]))
  const roof = mesh(sharedGeometry.cone, stone, [0, 3.15 * scale, .05 * scale])
  roof.scale.set(3.25 * scale, 1.2 * scale, 2.25 * scale)
  roof.rotation.y = Math.PI / 4
  group.add(roof)
  return group
}

function createLighthouse(scale = 1) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = .68 * scale
  group.userData.footprintSolid = true
  const stone = material(0xd0c7b4, .84)
  const roof = material(0x69433a, .72)
  group.add(cylinder(.52 * scale, 2.9 * scale, stone, [0, 1.45 * scale, 0], 20))
  group.add(cylinder(.66 * scale, .18 * scale, material(0x4a5556, .46, .3), [0, 2.95 * scale, 0], 20))
  group.add(cylinder(.42 * scale, .42 * scale, new THREE.MeshStandardMaterial({ color: 0xc8d6d2, emissive: 0xb97928, emissiveIntensity: .75, transparent: true, opacity: .8 }), [0, 3.22 * scale, 0], 20))
  group.add(mesh(new THREE.ConeGeometry(.65 * scale, .7 * scale, 20), roof, [0, 3.78 * scale, 0]))
  const beam = mesh(new THREE.ConeGeometry(.82 * scale, 8 * scale, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xf3d98e, transparent: true, opacity: .075, depthWrite: false, side: THREE.DoubleSide }), [0, 3.22 * scale, 4 * scale])
  beam.rotation.x = Math.PI / 2
  beam.userData.lighthouseBeam = true
  group.add(beam)
  group.userData.lighthouse = true
  return group
}

function createOrbitalStation(scale = 1, accent = 0xc5a65f) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = 2 * scale
  group.userData.footprintSolid = true
  const hull = material(0x6a7376, .38, .46)
  const dark = material(0x26343d, .42, .32)
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .68, roughness: .28, metalness: .42 })
  group.add(cylinder(1.4 * scale, .42 * scale, hull, [0, .18 * scale, 0], 36))
  group.add(cylinder(.92 * scale, 1.55 * scale, dark, [0, 1.12 * scale, 0], 30))
  const dome = mesh(new THREE.SphereGeometry(.87 * scale, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), hull, [0, 1.9 * scale, 0])
  dome.scale.y = .72
  group.add(dome)
  const ring = mesh(new THREE.TorusGeometry(1.78 * scale, .09 * scale, 12, 64), glow, [0, 1.12 * scale, 0])
  ring.rotation.x = Math.PI / 2
  ring.userData.orbitalRing = true
  group.add(ring)
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 2
    const arm = box([1.18 * scale, .16 * scale, .28 * scale], hull, [Math.cos(angle) * 1.45 * scale, .85 * scale, Math.sin(angle) * 1.45 * scale])
    arm.rotation.y = -angle
    group.add(arm)
  }
  return group
}

type AxisLine = { position: number; streetClass: StreetClass }

/**
 * Places the streets inside a bay by subdividing it hierarchically.
 *
 * A real street network is not a constant module: a few arterials sit far
 * apart, collectors halve the wide bays between them, and local streets halve
 * those again — and every subdivision is jittered, so block sizes span a real
 * range instead of tiling into graph paper. `arterials` are the fixed control
 * lines; between each consecutive pair this emits collectors, then locals
 * within each collector sub-bay, the count of each scaled to the bay's width.
 */
function planAxisInterior(min: number, max: number, arterials: number[], seed: number, targetLocal: number): AxisLine[] {
  const out: AxisLine[] = []
  // A small deterministic LCG, seeded per axis, so the jitter is stable across
  // reloads (the road graph and reserved sites must land in the same places).
  let state = Math.floor(Math.abs(seed)) % 2147483647
  if (state <= 0) state = 1
  const rnd = () => { state = (state * 16807) % 2147483647; return state / 2147483647 }
  const controls = [min, ...arterials, max].sort((a, b) => a - b)
  for (let index = 0; index < controls.length - 1; index += 1) {
    const a = controls[index]
    const b = controls[index + 1]
    const width = b - a
    const collectorCount = Math.max(1, Math.round(width / (targetLocal * 2.6) + (rnd() - .5) * .7))
    const bayEdges = [a]
    for (let k = 1; k < collectorCount; k += 1) {
      const position = a + width * (k / collectorCount + (rnd() - .5) * .16)
      bayEdges.push(position)
      out.push({ position, streetClass: 'collector' })
    }
    bayEdges.push(b)
    for (let j = 0; j < bayEdges.length - 1; j += 1) {
      const c = bayEdges[j]
      const d = bayEdges[j + 1]
      const localCount = Math.max(1, Math.round((d - c) / targetLocal + (rnd() - .5) * .85))
      for (let k = 1; k < localCount; k += 1) out.push({ position: c + (d - c) * (k / localCount + (rnd() - .5) * .26), streetClass: 'local' })
    }
  }
  return out
}

const AXIS_RANK: Record<StreetClass, number> = { arterial: 3, collector: 2, local: 1, alley: 0 }

/** Merges fixed control lines with generated interior lines, dropping any pair
 * closer than `minGap` in favour of the higher-ranked class. */
function assembleAxis(fixed: AxisLine[], interior: AxisLine[], minGap: number): AxisLine[] {
  const all = [...fixed, ...interior].sort((a, b) => a.position - b.position)
  const kept: AxisLine[] = []
  for (const line of all) {
    const prev = kept[kept.length - 1]
    if (prev && line.position - prev.position < minGap) {
      if (AXIS_RANK[line.streetClass] > AXIS_RANK[prev.streetClass]) kept[kept.length - 1] = line
      continue
    }
    kept.push(line)
  }
  return kept
}

/**
 * The Old Quarter street network.
 *
 * Three N–S arterials sit far apart and bracket the quarter; between them
 * collectors and locals subdivide with jitter so block widths genuinely vary.
 * Two quay collectors flank the canal channel. The two E–W arterials at
 * z = ±5.8 bracket the civic corridor the career route runs along, and every
 * avenue crosses that corridor, so a side street off the high street continues
 * straight into the ward behind rather than stopping at its edge — the weld
 * that stops the route reading as a strip laid over an unrelated grid. The
 * corridor band itself (|z| < 5.8) and the canal channel are developed by
 * their own passes, so the block loop skips them.
 */
const CANAL_X = -15.9
const OLD_QUARTER_AVENUES: AxisLine[] = assembleAxis(
  [
    { position: -27.6, streetClass: 'local' },
    { position: 28.2, streetClass: 'local' },
    { position: -18.6, streetClass: 'arterial' },
    { position: 1, streetClass: 'arterial' },
    { position: 18.8, streetClass: 'arterial' },
    { position: -17.3, streetClass: 'collector' },
    { position: -14.5, streetClass: 'collector' },
  ],
  planAxisInterior(-27.6, 28.2, [-18.6, 1, 18.8], 7001, 3.4).filter((line) => line.position < -17.6 || line.position > -14.2),
  1.7,
)

const OLD_QUARTER_STREETS: AxisLine[] = assembleAxis(
  [
    { position: -27.4, streetClass: 'local' },
    { position: 27.8, streetClass: 'local' },
    { position: -5.8, streetClass: 'arterial' },
    { position: 5.8, streetClass: 'arterial' },
    { position: -17.9, streetClass: 'collector' },
    { position: 9.4, streetClass: 'collector' },
    { position: 19.6, streetClass: 'collector' },
  ],
  [
    ...planAxisInterior(-27.4, -5.8, [-17.9], 8101, 3.5),
    ...planAxisInterior(9.4, 27.8, [19.6], 8123, 3.7),
  ],
  1.7,
)

/** The civic corridor band the career route runs along; blocks whose centre
 * falls inside it are developed by `addCityCorridor` instead. */
const CORRIDOR_HALF = 5.8
/** The railway right-of-way, between the south arterial and Station Road. */
const RAIL_BAND: [number, number] = [5.8, 9.4]
/** The canal channel between the two quay collectors. */
const CANAL_BAND: [number, number] = [-17.3, -14.5]

function addCityEnvironment(root: THREE.Group, definition: ArcDefinition) {
  const avenues = OLD_QUARTER_AVENUES
  const streets = OLD_QUARTER_STREETS
  addPlannedStreets(root, streetsFromGrid(avenues, streets), { asphalt: 0x343b3c, pavement: 0x8d8678 })

  const blocks = blocksFromGrid(avenues, streets, { seed: 4100 })
  // The historic core predates the grid laid over it, so its central blocks
  // sit a degree or two off square; the outer wards are exact. This is applied
  // by world position (blocksFromGrid only knows lattice indices), and kept
  // tiny — a couple of degrees, decaying to zero away from the centre — so it
  // reads as an old core rather than as buildings at random rotations.
  for (const block of blocks) {
    const core = THREE.MathUtils.clamp(1 - Math.hypot(block.x, block.z) / 15, 0, 1)
    block.rotation = core > .15 ? (hashUnit(block.seed * .77 + 3) - .5) * .05 * core : 0
  }

  // Rival compounds sit on whole ward blocks (the shared loop drops its
  // buildings here later); those blocks must not be subdivided into lots.
  const reserved: ReservedSite[] = [[-14, -7], [-7, -7.6], [7, -7.6], [14, -7]].map(([x, z]) => ({ x, z, radius: 2.2 }))

  const brick = [0x7c6d5c, 0x866f5b, 0x6e6a60, 0x8a7862, 0x736354, 0x806a56]
  const suburb = [0x7d6d5b, 0x8b7d6c, 0x726e64, 0x8f8069, 0x6f6457]
  const works = [0x605c54, 0x6b645b, 0x575f5d, 0x665d51]

  const buildings: PlannedBuilding[] = []
  const trees: TreeRecord[] = []

  // Only the wards are developed here. The civic corridor band (|z| < 5.8) is
  // the career route's high street and is built by addCityCorridor; the canal
  // channel is water; the railway right-of-way is track. Skipping them by
  // geometry rather than by lattice index is what lets the street network vary
  // block sizes freely without a hardcoded row/column bookkeeping.
  const inCorridor = (z: number) => Math.abs(z) < CORRIDOR_HALF - .1
  const inRail = (z: number) => z > RAIL_BAND[0] - .1 && z < RAIL_BAND[1] + .1
  const inCanal = (x: number) => x > CANAL_BAND[0] - .05 && x < CANAL_BAND[1] + .05
  const canalBank = (block: BlockRect) => Math.abs(block.x - CANAL_BAND[1]) < block.width / 2 + .6 || Math.abs(block.x - CANAL_BAND[0]) < block.width / 2 + .6

  const wardBlocks = blocks.filter((block) => block.width > 1.5 && block.depth > 1.5 && !inCorridor(block.z) && !inRail(block.z) && !inCanal(block.x))

  // Deliberate voids and civic set-pieces, claimed by proximity to a target
  // rather than by lattice key, so relaying the streets never orphans a
  // landmark. Each site takes the nearest unclaimed ward block.
  const claimed = new Set<BlockRect>()
  /**
   * Takes the nearest unclaimed ward block, optionally one big enough for what
   * is about to be built on it.
   *
   * `need` matters for the civic set-pieces, because those are modelled at a
   * fixed size rather than cut to their plot. Every other claimant here derives
   * its content from the block's own width and depth and is safe on any of
   * them. Where nothing fits, the largest block is returned rather than
   * nothing: a named landmark missing from the district is worse than a tight
   * one, and the caller scales to what it is given anyway.
   */
  const claim = (x: number, z: number, need?: { width: number; depth: number }) => {
    let best: BlockRect | null = null
    let bestDistance = Infinity
    let largest: BlockRect | null = null
    let largestArea = 0
    for (const block of wardBlocks) {
      if (claimed.has(block)) continue
      const area = block.width * block.depth
      if (area > largestArea) { largestArea = area; largest = block }
      if (need && (block.width < need.width || block.depth < need.depth)) continue
      const distance = Math.hypot(block.x - x, block.z - z)
      if (distance < bestDistance) { bestDistance = distance; best = block }
    }
    const chosen = best ?? largest
    if (chosen) claimed.add(chosen)
    return chosen
  }

  const court = claim(-1.5, -10.5, { width: 4.6, depth: 3.4 })
  if (court) {
    addBlockInterior(root, { x: court.x, z: court.z + .3, width: court.width, depth: court.depth - .6, rotation: court.rotation }, 0x8e8878)
    // Cut to the block instead of dropped on it. `createCourthouse` is 5.2 by
    // 3.5 at scale 1, so at the authored .84 it needs a plot 4.4 by 2.9 — and
    // when a change to the block lattice happened to hand it a narrower one,
    // its wings stood in the pavements either side and walkers were inside its
    // walls for 505 of 600 frames. Deriving the scale and the forecourt depth
    // from the plot means that cannot recur whatever the lattice does next.
    // The .15 a side this used to leave is the gap between the plinth and the
    // *plot line*, and a ward block's plot line is exactly where the pavement's
    // walkable half-width ends — so a walker at the outer edge of the paving
    // still had its body over the steps. Leaving the beam as well is what makes
    // the margin a margin for a person rather than for a line on a plan.
    const courtMargin = .3 + WALKER_HALF_BEAM * 2
    const courtScale = Math.min(.84, (court.width - courtMargin) / 5.2, (court.depth - courtMargin) / 3.5)
    const courtShift = Math.max(0, Math.min(.55, court.depth / 2 - 3.5 * courtScale / 2 - .15))
    const building = createCourthouse(courtScale, definition.stone)
    building.position.set(court.x, .04, court.z - courtShift)
    root.add(building)
    // The two lamps flanking the steps, kept on the forecourt rather than at a
    // fixed offset that a smaller plot would put out in the road.
    const lampOut = Math.min(1.5, court.width / 2 - .3)
    const lampBack = Math.min(1.15, court.depth / 2 - .3)
    for (const side of [-lampOut, lampOut]) { const lamp = createLamp(); lamp.position.set(court.x + side, .05, court.z + lampBack); root.add(lamp) }
    registerLandmark(root, { key: 'city-court', name: 'Quarter Courthouse', kind: 'civic', detail: 'The municipal bench. Every matter in the Old Quarter is filed here first.', position: [court.x, court.z], radius: 2.6 })
  }

  const market = claim(-9, 12.5)
  if (market) {
    addBlockInterior(root, market, 0x8b8577)
    for (let index = 0; index < 10; index += 1) {
      const stall = createMarketStall(index)
      const column = index % 5
      const row = Math.floor(index / 5)
      stall.position.set(market.x - Math.min(2.6, market.width / 2 - .5) + column * Math.min(1.32, (market.width - 1) / 4), .09, market.z - .85 + row * 1.6)
      stall.rotation.y = row ? Math.PI : 0
      root.add(stall)
    }
    registerLandmark(root, { key: 'city-wool-hall', name: 'Wool Hall Yard', kind: 'market', detail: 'The older of the quarter\u2019s two markets, on the wool-hall block behind the north arterial.', position: [market.x, market.z], radius: 2.5 })
  }

  const greens = [claim(8.5, 15.5), claim(-11.5, -18)]
  greens.forEach((green, index) => {
    if (!green) return
    addBlockInterior(root, green, 0x5c6b4d)
    const path = box([green.width, .04, .5], material(0x8d8677, .98), [green.x, .062, green.z])
    path.castShadow = false
    root.add(path)
    for (let tree = 0; tree < 9; tree += 1) trees.push({
      x: green.x + (hashUnit(green.seed + tree * 7) - .5) * (green.width - .7),
      z: green.z + (hashUnit(green.seed + tree * 13) - .5) * (green.depth - .8),
      scale: .58 + hashUnit(green.seed + tree * 19) * .3,
      color: tree % 2 ? 0x4d6147 : 0x57694b,
    })
    for (const side of [-1, 1]) { const bench = createBench(.7); bench.position.set(green.x + side * 1.2, .06, green.z + .55); bench.rotation.y = Math.PI; root.add(bench) }
    if (index === 0) registerLandmark(root, { key: 'city-ward-green', name: 'Ward Gardens', kind: 'green', detail: 'The outer ward\u2019s own green, laid out when the quarter was extended past the arterial.', position: [green.x, green.z], radius: 2.4 })
  })

  const school = claim(7.5, -11.5)
  if (school) {
    addBlockInterior(root, school, 0x6f6c5f)
    buildings.push({ x: school.x, z: school.z - school.depth / 2 + .95, width: school.width - .8, depth: 1.35, height: 2.35, rotationY: school.rotation, color: 0x8a8272, lit: true, roof: 'parapet', corner: false })
    for (let index = 0; index < 4; index += 1) trees.push({ x: school.x - 1.5 + index, z: school.z + school.depth / 2 - .6, scale: .5, color: 0x51634a })
    registerLandmark(root, { key: 'city-school', name: 'Guild Schoolhouse', kind: 'civic', detail: 'Articled clerks are still trained on this block. Its yard is the largest void north of the route.', position: [school.x, school.z], radius: 2.3 })
  }

  // The rest of the wards. Interior treatment varies per block so the quarter
  // does not read as one lawn under every roofline: dense core blocks are
  // built out with back extensions and keep only a paved service court, mid
  // blocks keep a garden, and a few are left as small parks — deliberate voids
  // rather than the same green everywhere.
  wardBlocks.forEach((block) => {
    if (claimed.has(block)) return
    const centrality = THREE.MathUtils.clamp(1 - Math.hypot(block.x * .82, (Math.abs(block.z) - 4) * .9) / 18, 0, 1)
    const bank = canalBank(block)
    const roll = hashUnit(block.seed * 1.31 + 9)

    if (!bank && roll < .07 && centrality < .62) {
      // A small ward park: a planned void, not a failure to build.
      addBlockInterior(root, block, 0x596a49)
      for (let tree = 0; tree < 6; tree += 1) trees.push({
        x: block.x + (hashUnit(block.seed + tree * 7) - .5) * (block.width - .8),
        z: block.z + (hashUnit(block.seed + tree * 11) - .5) * (block.depth - .8),
        scale: .5 + hashUnit(block.seed + tree * 5) * .3, color: tree % 2 ? 0x4d6147 : 0x55684a,
      })
      return
    }

    const zoning = zoningProfile(centrality, {
      coreStoreys: [3.2, 5.4], fringeStoreys: [1.4, 2.3],
      coreLot: [1, 1.85], fringeLot: [1.5, 2.9],
      coreGap: .04, fringeGap: .42,
    })
    const industrial = bank || (block.z > RAIL_BAND[1] && block.z < RAIL_BAND[1] + 6 && Math.abs(block.x) > 6)
    const spec: BlockSpec = {
      seed: block.seed,
      lotMin: zoning.lotMin,
      lotMax: zoning.lotMax,
      setback: .16 + (1 - centrality) * .38,
      buildingDepth: .95 + centrality * .6,
      gap: zoning.gap,
      storeyHeight: .74,
      storeysMin: industrial ? 1.8 : zoning.storeysMin,
      storeysMax: industrial ? 3.2 : zoning.storeysMax,
      palette: industrial ? works : centrality > .48 ? brick : suburb,
      roof: industrial ? 'flat' : centrality > .62 ? 'parapet' : centrality > .34 ? 'flat' : 'pitched',
      litChance: .12 + centrality * .3,
      cornerBonus: centrality > .5 ? 1 : .35,
      vacancy: .06 + (1 - centrality) * .3,
    }
    buildings.push(...developBlock(block, spec))

    const courtyard = blockCourtyard(block, spec)
    const dense = centrality > .55 && roll > .5
    if (courtyard) {
      if (dense && courtyard.width > 1.6 && courtyard.depth > 1.3) {
        // Back extensions and outbuildings fill a dense block's interior, so it
        // reads as built solid rather than as a wall around a lawn.
        addBlockInterior(root, courtyard, 0x66635a)
        const wings = subdivideFrontage(courtyard.width, 1, 1.9, block.seed + 41)
        let cursor = -courtyard.width / 2
        wings.forEach((wing, wingIndex) => {
          const centre = cursor + wing / 2
          cursor += wing
          if (hashUnit(block.seed + wingIndex * 13) < .45) return
          const local = block.rotation
          buildings.push({
            x: courtyard.x + Math.cos(local) * centre,
            z: courtyard.z + Math.sin(local) * centre,
            width: Math.max(.6, wing - .25), depth: Math.min(1.1, courtyard.depth * .5),
            height: (1.4 + hashUnit(block.seed + wingIndex * 7) * 1.2) * .74,
            rotationY: local, color: brick[(block.seed + wingIndex) % brick.length], lit: false,
            roof: 'flat', corner: false,
          })
        })
      } else {
        const garden = centrality < .45
        addBlockInterior(root, courtyard, garden ? 0x5f6d4f : 0x6a675d)
        if (garden && courtyard.width > 1.4 && courtyard.depth > 1.2) trees.push({ x: courtyard.x, z: courtyard.z, scale: .42 + hashUnit(block.seed) * .22, color: 0x4f6349 })
      }
    }

    if (bank && hashUnit(block.seed * 2.1 + 4) < .4) {
      // Wharf frontage turns to face the water: an occasional cargo stack on
      // the canal side, which is how a waterfront actually shapes a plan.
      const side = block.x > CANAL_X ? -1 : 1
      const cargo = createCargoStack(block.seed % 5 + 1, .32)
      cargo.position.set(block.x + side * (block.width / 2 - .7), .05, block.z)
      root.add(cargo)
    }
  })

  const cityBuildings = clearReserved(buildings, reserved)
  // Split by distance so frustum culling still has something to work with; a
  // single instanced batch spanning the whole quarter can never be culled.
  const near = cityBuildings.filter((building) => Math.abs(building.x) < 16 && Math.abs(building.z) < 16)
  const west = cityBuildings.filter((building) => building.x <= -16 || (building.x < 0 && Math.abs(building.z) >= 16))
  const east = cityBuildings.filter((building) => !near.includes(building) && !west.includes(building))
  renderPlannedBuildings(root, 'city', near, { cullRadius: 26 })
  renderPlannedBuildings(root, 'city', west, { cullRadius: 30 })
  renderPlannedBuildings(root, 'city', east, { cullRadius: 30 })

  // Wharf landmark on the east bank of the canal.
  const wharf = claim(CANAL_BAND[1] + 1.4, -9)
  if (wharf) registerLandmark(root, { key: 'city-wharf', name: 'Millrace Wharf', kind: 'industry', detail: 'Bonded warehousing on the canal. Shipping disputes in this quarter are argued over these sheds.', position: [wharf.x, wharf.z], radius: 2.5 })

  // The canal. A waterway is a land-use boundary, not decoration: the quays
  // are streets in the grid, and every east–west street crosses it on its own
  // bridge, which is what ties the two banks into one quarter.
  const canalCurve = curveFrom([[-16.2, -30], [-16.05, -14], [CANAL_X, 0], [-15.75, 14], [-15.6, 30]], .055)
  // A cut canal, so no taper: it is a built section of constant width between
  // masonry quays, and a meander here would be a mistake rather than a river.
  // The flow is slow — a millrace on the level, moving because it is worked.
  //
  // The surface sits below the quarter's pavement rather than on it. That is
  // what a cut is, and it is also what buys the bridges their headroom: the
  // twelve decks span y=.03 to .23, and water at the old .045 with a .04 ripple
  // reached .085 — up inside every one of them. At this level the crest is
  // about zero and the soffit clears it, so the water passes under its bridges
  // instead of through them.
  const CANAL_WATER_Y = -.02
  const CANAL_HALF = 1.3
  addWatercourse(root, canalCurve, {
    width: CANAL_HALF * 2,
    color: 0x416f73,
    taper: 0,
    flow: .38,
    amplitude: .02,
    bedColor: 0x565243,
    segments: 150,
    y: CANAL_WATER_Y,
  })
  root.add(canalQuays(canalCurve, { innerHalf: CANAL_HALF, walk: .72, topY: .16, footY: -.09 }))
  streets.forEach((street, index) => {
    const bridge = box([5.9, .2, streetWidth(street.streetClass) + .55], material(0x7b7770, .95), [CANAL_X, .13, street.position])
    root.add(bridge)
    if (index % 2 === 0) for (const side of [-1, 1]) {
      const lamp = createLamp()
      lamp.position.set(CANAL_X + side * 2.3, .2, street.position + .55)
      lamp.scale.setScalar(.8)
      root.add(lamp)
    }
  })
  registerLandmark(root, { key: 'city-canal', name: 'Millrace Canal', kind: 'water', detail: 'The working canal that set the quarter’s western edge. Twelve bridges, one per cross street.', position: [CANAL_X, 2], radius: 2.4 })

  // Railway land between the south arterial and Station Road.
  const platform = createRailPlatform(.86)
  platform.position.set(0, .04, 8.3)
  root.add(platform)
  transitStops(root).push([0, 8.3])
  registerLandmark(root, { key: 'city-station', name: 'Old Quarter Halt', kind: 'transit', detail: 'A single-platform halt on the municipal line. The shuttle reverses here rather than running through.', position: [0, 7.9], radius: 2.6 })
  for (const x of [-9.5, 9.5]) {
    const shed = createServiceShed(1.1, 0x5c574e)
    shed.position.set(x, .04, 8.4)
    root.add(shed)
  }
  registerLandmark(root, { key: 'city-goods', name: 'Coal Yard', kind: 'industry', detail: 'The goods yard that pays for the halt. Freight claims from here fill the municipal docket.', position: [12.5, 7.6], radius: 2.4 })
  for (let index = 0; index < 4; index += 1) {
    const cargo = createCargoStack(index + 11, .38)
    cargo.position.set(11.2 + (index % 2) * 2.4, .04, 6.8 + Math.floor(index / 2) * 1.5)
    root.add(cargo)
  }

  // Street trees: an avenue of planting on the two arterials, which is what
  // separates a "main street" from an equally wide back street.
  for (const z of [-5.8, 5.8]) for (let x = -27; x <= 27; x += 3.1) {
    if (Math.abs(x) < 3 || Math.abs(x - CANAL_X) < 2.6) continue
    trees.push({ x, z: z + Math.sign(z) * 1.6, scale: .52 + hashUnit(x * 17 + z) * .12, color: z < 0 ? 0x506348 : 0x56684b })
  }

  // Planting through the wards as well.
  //
  // With the corridor and the wards now built the same way, the thing still
  // giving the strip away was detail: the high street carries a hundred props
  // and the blocks either side of it carried almost none, so in plan the band
  // read as a different texture running across an otherwise blank grid, which
  // is precisely the "the path sticks out from the rest of the map" complaint.
  // Bringing the wards up rather than the corridor down is the cheaper of the
  // two fixes here, because street trees ride the region's existing instanced
  // canopy field and so cost no extra draw call at all — where thinning the
  // corridor would have meant deleting authored props the high street needs.
  //
  // Planted the way a residential street actually is: down both kerbs, at a
  // regular spacing with gaps where the crossings and the yards are, and
  // omitted altogether on the industrial frontages by the railway.
  const kerbLine = [...avenues].sort((a, b) => a.position - b.position)
  for (const street of streets) {
    const z = street.position
    if (inCorridor(z) || inRail(z) || Math.abs(z) > 20) continue
    const kerb = streetWidth(street.streetClass) * .38
    // Planted block by block rather than at a fixed pitch, so no tree ever
    // lands in a junction and every frontage gets at least one.
    for (let gap = 0; gap < kerbLine.length - 1; gap += 1) {
      const from = kerbLine[gap].position + streetWidth(kerbLine[gap].streetClass) / 2 + .22
      const to = kerbLine[gap + 1].position - streetWidth(kerbLine[gap + 1].streetClass) / 2 - .22
      if (to - from < .7 || Math.abs((from + to) / 2) > 26) continue
      if ((from + to) / 2 > CANAL_BAND[0] - 1.4 && (from + to) / 2 < CANAL_BAND[1] + 1.4) continue
      const count = Math.max(1, Math.round((to - from) / 2.6))
      for (let index = 0; index < count; index += 1) {
        const x = from + (to - from) * ((index + .5) / count)
        const seed = x * 31 + z * 17 + index * 11
        // Gaps for the crossings, the vehicle accesses and the trees that died.
        if (hashUnit(seed) < .34) continue
        const side = hashUnit(seed + 13) < .5 ? -1 : 1
        trees.push({
          x: x + (hashUnit(seed + 3) - .5) * .5,
          z: z + side * kerb,
          scale: .44 + hashUnit(seed + 5) * .18,
          color: hashUnit(seed + 9) > .5 ? 0x4c6046 : 0x53664b,
        })
      }
    }
  }

  // The edge of town frays into worked country rather than ending at a hard
  // rectangle. Field strips to the north and south, and a broad wooded belt
  // wrapping the quarter, replace the ring of house-confetti that used to sit
  // on open grass with no streets — the loudest "randomly placed" cue of all.
  addCityOutskirts(root, trees)

  addTreeField(root, trees)

  // Traffic used to run on three closed rings laid over the quarter, which
  // existed only because a vehicle advancing along an open curve teleports
  // back to its start at the end of every lap. The grid itself is now the road
  // network — `recordStreetNetwork` splits every avenue and street at the
  // crossings, so a car has a genuine choice at each junction, gives way, and
  // leaves through the edge of the district rather than looping forever. The
  // rings would now be a second carriageway laid a few centimetres beside the
  // real one, so they are gone.
}

/**
 * The country the Old Quarter fades into.
 *
 * The quarter used to end at a hard rectangle and then, past a bare margin,
 * resume as a ring of free-standing houses on open grass with no streets to
 * reach them — the single loudest "randomly placed" cue in the scene. A small
 * town does not do that: its edge frays into worked land. So the annulus around
 * the grid is now enclosure fields to the north and south and a wooded common
 * wrapping the whole quarter, with the odd fenced paddock. Nothing out here is
 * a building without frontage, because out here there are no buildings at all.
 */
function addCityOutskirts(root: THREE.Group, trees: TreeRecord[]) {
  addFieldSystem(root, trees, {
    bands: [
      { z: -30.4, depth: 4.4, from: -33, to: 33 },
      { z: 30.2, depth: 4.4, from: -33, to: 33 },
    ],
    exclude: [{ x: CANAL_X, z: -30, radius: 3 }, { x: CANAL_X, z: 30, radius: 3 }],
    seed: 5200,
    palette: [0xbba85f, 0x8c9a5e, 0x6c5741, 0x74884f],
    hedge: 0x47583c,
  })

  // A wooded common in the elliptical belt just outside the built edge, placed
  // in loose clumps with real gaps so it reads as woodland and rough grazing
  // rather than as a planted screen. The grid edge is irregular, so trees are
  // allowed to encroach a little onto the outermost lots.
  for (let index = 0; index < 260; index += 1) {
    const angle = hashUnit(index * 12.9 + 1) * Math.PI * 2
    const radial = hashUnit(index * 7.3 + 5)
    const radiusX = 27 + radial * 18 + Math.sin(angle * 3) * 2.4
    const radiusZ = 25 + radial * 15 + Math.cos(angle * 2) * 2.2
    const x = Math.cos(angle) * radiusX
    const z = Math.sin(angle) * radiusZ
    // Leave the field bands north and south clear so worked land reads as
    // worked, and keep off the canal mouth.
    if (Math.abs(z) > 28 && Math.abs(z) < 38 && Math.abs(x) < 34) continue
    if (Math.abs(x - CANAL_X) < 2 && Math.abs(z) > 27) continue
    // Clumping: a hash gate thins the belt into copses instead of a hedge.
    if (hashUnit(index * 3.7 + 2) > .5 + radial * .35) continue
    trees.push({ x, z, scale: .5 + hashUnit(index * 5.1) * .5, color: [0x45583c, 0x506046, 0x3f5238, 0x59684a][index % 4] })
  }

  // A couple of fenced paddocks on the approach, where a farmstead would sit —
  // yards, not houses, so nothing gains a wall without a plot.
  for (const [x, z, gap] of [[-24, -20, 1], [23, 19, -1], [-22, 22, 1]] as Array<[number, number, 1 | -1]>) {
    const pen = createFieldPen(2.6, 2, gap, 0xb2a488)
    pen.position.set(x, .04, z)
    pen.rotation.y = hashUnit(x * 7 + z) * .4 - .2
    root.add(pen)
  }
}

/**
 * The Old Quarter's high street, built outwards from the route itself.
 *
 * The three previous attempts at this map all generated the quarter first and
 * then found somewhere in it for the career route to go, which is why the
 * route has kept reading as a strip dropped through unrelated ground: the grid
 * did not know it existed, so the best it could do was leave a gap, and the
 * gap had bare margins on both sides.
 *
 * This inverts the order. The route is the spine, and everything here is
 * placed in its curvilinear frame (distance along, offset across) by
 * `map-urban-plan`'s corridor model, so:
 *
 *  - the building line follows the street's bends at a constant setback,
 *    rather than being a straight wall the curved street wanders towards;
 *  - side streets *meet* it at square junctions and run out to the two
 *    arterials that bracket the corridor, which is what ties the high street
 *    into the grid instead of leaving it stranded between two of its rows;
 *  - each corridor block is built on both faces with a service alley up the
 *    middle, so the four bare metres between the old frontage and the
 *    arterial are now the inside of a block, as they would be in a real town;
 *  - the use mix — shops on the street, a market square, a green, workshops
 *    on the alley, houses behind — falls off from the spine the way land
 *    value does.
 */
function addCityCorridor(root: THREE.Group, route: THREE.Curve<THREE.Vector3>, definition: ArcDefinition) {
  const samples: XZ[] = []
  for (let index = 0; index <= 96; index += 1) {
    const point = route.getPointAt(index / 96)
    samples.push([point.x, point.z])
  }
  const corridor = buildCorridor(samples, .22)
  const trees: TreeRecord[] = []

  // The five headquarters parcels, re-derived from the same formula the
  // shared tier loop places them with; an instanced row cannot be cleared
  // after the fact, so the frontage has to know to leave these alone.
  const authoredSides = [-1, -1, 1, 1, 1]
  const reserved: ReservedSite[] = authoredSides.map((sideSign, index) => {
    const t = .12 + index / (authoredSides.length - 1) * .76
    const point = route.getPointAt(t)
    const tangent = route.getTangentAt(t).normalize()
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(sideSign)
    const site = point.clone().add(side.multiplyScalar(2.8))
    return { x: site.x, z: site.z, radius: 3.4 }
  })

  /* --- The corridor section ----------------------------------------------
   * Everything the high street is made of, as one set of offsets from the
   * centreline. This is the change that matters most on this map.
   *
   * A parade of shops reads as a parade because every unit in it shares two
   * lines: a building line at a fixed setback from the kerb, and a rear line at
   * a fixed depth behind that. Previous passes drew the setback from a constant
   * but the depth from a per-lot hash, so the fronts lined up and the backs did
   * not, and the block had no inside — the rear "backland" row was computed
   * from a reach that put it straight through the back of the frontage it was
   * supposed to stand behind. Fixing both lines is what turns eighteen separate
   * buildings into one retail terrace with a service yard behind it.
   *
   * The whole section has to fit in the 5.8 units the two bracketing arterials
   * allow, which is why these are constants that visibly add up rather than
   * numbers tuned by eye:
   *
   *   0.00 – 0.86  carriageway         (the route ribbon's own bed)
   *   0.86 – 0.97  kerb
   *   0.97 – 1.95  footway             (under a continuous canopy)
   *   1.95         BUILDING LINE
   *   1.95 – 3.40  retail units        (uniform depth, party walls)
   *   3.40 – 3.72  loading yard
   *   3.72 – 4.34  service alley
   *   4.46 – 5.80  arterial apron
   */
  const KERB_OFFSET = .9
  const SETBACK = 1.95
  const UNIT_DEPTH = 1.45
  const REAR_LINE = SETBACK + UNIT_DEPTH
  const ALLEY_OFFSET = 4.03
  /**
   * The alley carriageway, drawn and routed from one number.
   *
   * The ribbon was drawn at .62 while the road graph was handed
   * `streetWidth('alley')` = .52, so the lane the traffic was solved against was
   * a tenth narrower than the tarmac under it. Same shape of fault as the
   * carriageway-versus-paved-width mix-up in `blocksFromGrid`: one dimension
   * with two sources of truth.
   */
  const ALLEY_CARRIAGEWAY = .62
  const ARTERIAL_Z = 5.8

  /* --- Planned voids ---------------------------------------------------- */
  // A high street with an unbroken wall of shops down its whole length is as
  // artificial as a field of scattered boxes. These are the deliberate gaps —
  // and one of them is a parking apron, because a strip mall without one is
  // just a terrace: the apron is what puts cars, bay markings and a pylon sign
  // into the frontage instead of leaving them somewhere off the plan.
  const voids: CorridorVoid[] = [
    { s: corridor.length * .3, side: 1, length: 5.6, depth: 4.3, use: 'plaza' },
    { s: corridor.length * .68, side: -1, length: 4, depth: 2.9, use: 'green' },
    { s: corridor.length * .845, side: 1, length: 6.4, depth: 3.9, use: 'forecourt' },
  ]
  const inVoid = (s: number, side: 1 | -1, pad = 0) => voidCovers(voids, s, side, pad)
  const onReserved = (s: number, side: 1 | -1) => {
    const [x, z] = corridor.at(s, 2.6 * side)
    return isReserved(x, z, reserved, .5)
  }

  /* --- Side streets ----------------------------------------------------- */
  // Each one runs from the high street out to the arterial that brackets the
  // corridor, so it is a real connection rather than a stub. Side +1 is the
  // left of travel, which on this route is +z.
  // Right up to the arterial's centreline, not to its kerb. A side street that
  // stops a metre short welds into the road graph as a dead-end stub, which
  // makes both its ends spawn portals and puts cars appearing and vanishing in
  // the middle of a block — the "vehicles just appear" complaint, caused by the
  // network rather than by the simulation.
  // The side streets off the high street ARE the ward avenues. Every avenue
  // that falls within the route's span crosses the corridor here and continues
  // straight into the ward beyond the arterial — one N–S street from one edge
  // of the district to the other, with the high street crossing it at a proper
  // junction. `addCityEnvironment` already draws and records each avenue full
  // height (so traffic welds across the crossing and the carriageway is not
  // drawn twice); the corridor only needs to know where the junctions land so
  // its frontage leaves a gap at each and its backland is cut between them.
  // This weld — rather than a separate set of curved cross-streets on their own
  // module — is what stops the high street reading as a band pasted between two
  // rows of an unrelated grid.
  const projectAvenue = (x: number) => {
    let bestS = 0
    let best = Infinity
    for (const sample of corridor.samples) {
      const distance = Math.abs(sample.x - x)
      if (distance < best) { best = distance; bestS = sample.s }
    }
    return bestS
  }
  const crossStreets: CrossStreet[] = []
  for (const avenue of OLD_QUARTER_AVENUES) {
    if (avenue.position < -13.4 || avenue.position > 13.4) continue
    if (avenue.position > CANAL_BAND[0] - .4 && avenue.position < CANAL_BAND[1] + .4) continue
    const s = projectAvenue(avenue.position)
    for (const side of [-1, 1] as const) {
      if (inVoid(s, side, 1.4) || onReserved(s, side)) continue
      const routeZ = corridor.at(s, 0)[1]
      const targetZ = side > 0 ? ARTERIAL_Z : -ARTERIAL_Z
      const reach = Math.abs(targetZ - routeZ) - .05
      if (reach < 1.2) continue
      // A straight run at the avenue's own x, so it coincides exactly with the
      // ward avenue the environment pass draws through the band.
      const points: XZ[] = []
      for (let step = 0; step <= 5; step += 1) points.push([avenue.position, routeZ + (targetZ - routeZ) * (step / 5)])
      crossStreets.push({ s, side, streetClass: avenue.streetClass === 'arterial' ? 'collector' : avenue.streetClass, reach, points })
    }
  }

  crossStreets.forEach((street, index) => {
    // Street trees on the side streets, thinning away from the high street.
    for (let step = 1; step <= 2; step += 1) {
      const along = 1.7 + step * 1.45
      if (along > street.reach - .5) break
      const [, tz] = corridor.at(street.s, along * street.side)
      trees.push({ x: street.points[0][0] + (street.side > 0 ? .82 : -.82), z: tz, scale: .44 + hashUnit(index * 13 + step) * .12, color: 0x4e6247 })
    }
  })

  /* --- The street wall --------------------------------------------------- */
  // Lots are cut narrow and to a wide range, because varied frontage on a
  // shared building line is the single strongest cue that a street was
  // subdivided rather than stamped; but the setback and the depth are the same
  // for every one of them, so the parade has a front line and a back line and
  // each unit genuinely fills its lot.
  const frontage = corridorFrontage(corridor, crossStreets, {
    seed: 6113,
    // Narrow lots, cut to a wide range. A shop unit is a narrow thing — the
    // previous minimum of 1.05 with a 1.4-deep plan gave almost square units
    // that read as detached cottages selling something, and there were too few
    // of them along the run for the frontage to have any rhythm.
    lotMin: .78,
    lotMax: 1.95,
    setback: () => SETBACK,
    depth: () => UNIT_DEPTH,
    storeyHeight: .74,
    storeys: (s, _side, use) => {
      // Land value peaks at the middle of the high street and falls to the
      // ends, which is the bid-rent curve that makes a centre read as one.
      const centrality = 1 - Math.abs(s / corridor.length - .5) * 2
      if (use === 'civic') return [3.2, 4.2]
      if (use === 'workshop') return [1.5, 1.9]
      // A retail parade is low and near-level: two storeys, occasionally
      // three towards the middle. A row whose parapets are all at slightly
      // different heights reads as subsidence rather than as variety.
      if (use === 'shopfront') return [1.75, 2.05 + centrality * .55]
      return [1.9 + centrality * .5, 2.5 + centrality * .9]
    },
    use: (s, side, seed, corner) => {
      const centrality = 1 - Math.abs(s / corridor.length - .5) * 2
      const roll = hashUnit(seed * 1.7 + 2.3)
      // Corner sites on a high street are the shops; that is what corners are
      // worth. Everything commercial concentrates towards the middle.
      if (corner && roll < .82) return 'shopfront'
      if (roll < .34 + centrality * .46) return 'shopfront'
      if (roll < .42 + centrality * .48) return 'civic'
      if (roll > .95) return 'workshop'
      return 'housing'
    },
    palette: () => 0x7c6d5c,
    // A retail parade is parapets and flat roofs, not a row of little hipped
    // cottages. Pitched roofs are kept for the housing at the ends of the
    // street, where the frontage really is domestic.
    roof: (use, storeys) => (use === 'shopfront' || use === 'workshop' ? 'flat' : storeys > 3 ? 'parapet' : 'pitched'),
    litChance: (use) => (use === 'shopfront' ? .62 : use === 'civic' ? .4 : .2),
    margin: 1.2,
    // Zero: these are party walls. The units meet, and it is the lot widths
    // that vary along the run rather than the gaps between them.
    partyGap: 0,
    allow: (s, side) => !inVoid(s, side, .5) && !onReserved(s, side),
    // A hole in a shopping parade is a gap site, not the norm. Vacancy stays
    // near zero through the commercial middle and only opens up at the ends
    // where the street is turning into housing.
    vacancy: (s) => Math.max(0, Math.abs(s / corridor.length - .5) - .28) * .5,
  })

  renderPlannedBuildings(root, 'city', frontage.map((lot) => ({
    x: lot.x, z: lot.z, width: lot.width, depth: lot.depth, height: lot.height,
    rotationY: lot.rotationY, color: lot.color, lit: lot.lit, roof: lot.roof, corner: lot.corner,
  })), { cullRadius: 22 })

  /* --- The shared canopy over the footway --------------------------------- */
  // The continuous awning that runs the length of a retail parade, broken only
  // at the junctions. One canopy over eight units, rather than eight separate
  // awnings, is the difference between a parade and a row of houses that
  // happen to sell things — and it is what shelters the footway the crowd
  // actually walks on, so it reads from the oblique camera as well as in plan.
  const canopyMaterial = material(0x6f5f4c, .84)
  const canopyPost = material(0x585349, .8, .1)
  for (const side of [-1, 1] as const) {
    const runs = frontage
      .filter((lot) => lot.side === side)
      .sort((a, b) => a.s - b.s)
      .reduce<Array<[number, number]>>((groups, lot) => {
        const last = groups[groups.length - 1]
        const from = lot.s - lot.width / 2
        const to = lot.s + lot.width / 2
        // A gap wider than a doorway ends the run: the canopy stops at the
        // junction and at the squares, exactly as the frontage does.
        if (last && from - last[1] < .34) last[1] = to
        else groups.push([from, to])
        return groups
      }, [])
    for (const [from, to] of runs) {
      if (to - from < 1.6) continue
      const points: XZ[] = []
      for (let step = 0; step <= 4; step += 1) points.push(corridor.at(from + (to - from) * (step / 4), (SETBACK - .5) * side))
      const canopy = mesh(ribbonGeometry(curveFrom(points, .96), 1.02, 8), canopyMaterial)
      canopy.castShadow = true
      canopy.receiveShadow = false
      root.add(canopy)
      // Posts at the outer edge, spaced by the same module the lots are cut on
      // so a post never lands in the middle of a shop window.
      for (let s = from + .6; s < to - .3; s += 1.55) {
        const [px, pz] = corridor.at(s, (SETBACK - .95) * side)
        const post = box([.07, .94, .07], canopyPost, [px, .47, pz])
        post.castShadow = false
        root.add(post)
      }
    }
  }

  /* --- The back of the block: loading, not more frontage ------------------ */
  // A strip-mall block is serviced from behind. The rear line of the parade is
  // at a fixed depth, so a fixed-offset alley genuinely runs behind it — the
  // previous pass derived a second building row from a reach that placed it
  // *through* the backs of the units it was meant to stand behind, which is a
  // large part of why the corridor read as a pile rather than a block.
  const dockYard = material(0x6a655b, .98)
  for (const side of [-1, 1] as const) {
    const junctions = crossStreets.filter((street) => street.side === side).map((street) => street.s).sort((a, b) => a - b)
    for (let index = 0; index < junctions.length - 1; index += 1) {
      const from = junctions[index] + .45
      const to = junctions[index + 1] - .45
      if (to - from < 1.6) continue

      // The yard the units back onto, and the alley carriageway in it.
      const yardPoints: XZ[] = []
      for (let step = 0; step <= 4; step += 1) yardPoints.push(corridor.at(from + (to - from) * (step / 4), (REAR_LINE + .34) * side))
      const yard = mesh(ribbonGeometry(curveFrom(yardPoints, .046), .92, 8), dockYard)
      yard.castShadow = false
      root.add(yard)

      const alleyPoints: XZ[] = []
      for (let step = 0; step <= 4; step += 1) alleyPoints.push(corridor.at(from + (to - from) * (step / 4), ALLEY_OFFSET * side))
      const alley = mesh(ribbonGeometry(curveFrom(alleyPoints, .058), ALLEY_CARRIAGEWAY, 8), material(0x4a4f4c, .95))
      alley.castShadow = false
      root.add(alley)
      // The alley is a real lane in the road graph, so delivery traffic has
      // somewhere to be that is not the high street.
      //
      // One-way, and the width the ribbon above was actually drawn to. Both
      // matter: the graph used to be told `streetWidth('alley')`, a tenth
      // narrower than the paving beside it, and two-way. A .62 lane cannot hold
      // two bodies abreast — they are .44 and .46 wide — so the sim was obliged
      // to keep the flows far enough apart to miss each other, which put both of
      // them outside the alley and through the vans standing at the docks. A
      // service lane behind a parade is one-way in any case.
      //
      // Reversed on the +1 side so that travel runs the same way round the
      // block on both: lanes sit to the right of travel, corridor lateral is
      // positive to the *left* of travel, so a consistent direction is what puts
      // the lane against the outer kerb — away from the docks — on each side.
      roadWays(root).push({
        points: side > 0 ? alleyPoints.slice().reverse() : alleyPoints,
        kind: 'road',
        speed: STREET_SPEED.alley,
        width: ALLEY_CARRIAGEWAY,
        oneWay: true,
      })

      // Loading docks against the rear wall, one per two units or so.
      let dockIndex = 0
      for (let s = from + .8; s < to - .6; s += 1.9) {
        const seed = 8821 + index * 91 + dockIndex * 23 + (side > 0 ? 2311 : 0)
        dockIndex += 1
        const [dx, dz] = corridor.at(s, (REAR_LINE + .3) * side)
        if (isReserved(dx, dz, reserved, .4)) continue
        const dock = createLoadingDock(seed, .78)
        dock.position.set(dx, .04, dz)
        // Facing the alley, so the shutter is on the wall behind it.
        dock.rotation.y = corridor.facing(s, side) + Math.PI
        markSolidProp(dock, .5)
        root.add(dock)
        if (hashUnit(seed * 7.3 + 5) < .34) {
          // Backed onto the rear wall rather than sat in the middle of the
          // yard. The van is .46 across and the yard between the rear building
          // line and the alley kerb is .32, so it cannot stand entirely off the
          // carriageway — but at the wall its flank clears the lane the sim now
          // solves for this alley, which the old fixed .34 offset did not.
          const [vx, vz] = corridor.at(s + .55, (REAR_LINE + .24) * side)
          const van = createDeliveryVan([0x8d8578, 0x6f7a72, 0x83705a][dockIndex % 3])
          van.position.set(vx, .03, vz)
          van.rotation.y = corridor.tangent(s)[0] > 0 ? 0 : Math.PI
          markSolidProp(van, .45)
          root.add(van)
        }
      }
    }
  }

  /* --- Squares and greens ------------------------------------------------ */
  voids.forEach((hole, index) => {
    const [cx, cz] = corridor.at(hole.s, (SETBACK + hole.depth / 2) * hole.side)
    const [tx, tz] = corridor.tangent(hole.s)
    const rotation = -Math.atan2(tz, tx)
    if (hole.use === 'forecourt') {
      /* --- The parking apron -------------------------------------------- */
      // The piece of strip-mall vocabulary the map was missing. The building
      // line steps back here to make room for an apron of marked bays, with a
      // set-back unit terrace closing the far side of it and a pylon sign at
      // the entrance. Everything is cut in corridor space like the rest of the
      // street, so it squares up with the frontage either side of it rather
      // than sitting on the world axes at a slight angle to its own street.
      addBlockInterior(root, { x: cx, z: cz, width: hole.length, depth: hole.depth, rotation }, 0x5f6058)
      const bayPaint = material(0xbdb392, .82)
      const bayRows: Array<[number, number]> = [[1.05, 1], [2.62, -1]]
      for (const [across, facing] of bayRows) {
        for (let bay = 0; bay <= 7; bay += 1) {
          const along = hole.s - hole.length / 2 + .5 + bay * (hole.length - 1) / 7
          const [mx, mz] = corridor.at(along, (SETBACK + across) * hole.side)
          const stripe = box([.045, .012, 1.05], bayPaint, [mx, .066, mz])
          stripe.castShadow = false
          stripe.rotation.y = rotation
          root.add(stripe)
        }
        // A handful of cars actually in the bays, angled into them. Parked
        // vehicles are what stop an apron reading as an empty grey rectangle.
        for (let bay = 0; bay < 7; bay += 1) {
          const seed = 4400 + bay * 37 + (facing > 0 ? 191 : 0)
          if (hashUnit(seed) > .58) continue
          const along = hole.s - hole.length / 2 + .82 + bay * (hole.length - 1) / 7
          const [px, pz] = corridor.at(along, (SETBACK + across) * hole.side)
          const parked = createVehicle([0x6d4d48, 0x52626a, 0x71664f, 0x455e59, 0x7a6a52, 0x8a7a63][bay % 6])
          parked.position.set(px, .03, pz)
          parked.rotation.y = corridor.facing(along, hole.side) + (facing > 0 ? Math.PI / 2 : -Math.PI / 2)
          markSolidProp(parked, .42)
          root.add(parked)
        }
      }
      // The terrace that closes the back of the apron, on the same lot logic
      // as the rest of the street so it is the same kind of thing.
      const apronUnits: PlannedBuilding[] = []
      const apronLots = subdivideFrontage(hole.length - .5, 1.05, 2.1, 7731)
      let apronCursor = hole.s - hole.length / 2 + .25
      apronLots.forEach((lot, lotIndex) => {
        const centre = apronCursor + lot / 2
        apronCursor += lot
        const [ux, uz] = corridor.at(centre, (SETBACK + hole.depth + .72) * hole.side)
        apronUnits.push({
          x: ux, z: uz, width: Math.max(.6, lot - .05), depth: 1.35,
          height: (1.7 + hashUnit(7731 + lotIndex * 19) * .5) * .74,
          rotationY: corridor.facing(centre, hole.side),
          color: 0x7c6d5c, lit: hashUnit(7731 + lotIndex * 31) < .5, roof: 'flat', corner: false,
        })
      })
      renderPlannedBuildings(root, 'city', apronUnits, { cullRadius: 20 })
      // One canopy across the whole terrace: a single development, read as one.
      const apronCanopyPoints: XZ[] = []
      for (let step = 0; step <= 3; step += 1) {
        apronCanopyPoints.push(corridor.at(hole.s - hole.length / 2 + .25 + (hole.length - .5) * (step / 3), (SETBACK + hole.depth + .05) * hole.side))
      }
      const apronCanopy = mesh(ribbonGeometry(curveFrom(apronCanopyPoints, .98), .74, 6), canopyMaterial)
      root.add(apronCanopy)
      const [sx, sz] = corridor.at(hole.s - hole.length / 2 + .35, (SETBACK - .55) * hole.side)
      const pylon = createPylonSign(definition.accent, .92)
      pylon.position.set(sx, .04, sz)
      pylon.rotation.y = corridor.facing(hole.s, hole.side)
      markAuthoredProp(pylon, .3)
      root.add(pylon)
      registerLandmark(root, { key: 'city-parade', name: 'Chancery Parade', kind: 'market', detail: 'The quarter\u2019s retail parade: eight units under one canopy, with the apron in front and the loading yard behind.', position: [cx, cz], radius: 3 })
    } else if (hole.use === 'plaza') {
      addBlockInterior(root, { x: cx, z: cz, width: hole.length, depth: hole.depth, rotation }, 0x8b8577)
      // A market square is stalls in rows facing an aisle, not scattered. The
      // spacing here is set by the stall's own footprint rather than by eye —
      // at four to a row they interpenetrated, which the placement audit
      // caught and no screenshot ever would have.
      for (let row = 0; row < 2; row += 1) for (let column = 0; column < 3; column += 1) {
        const along = hole.s - hole.length / 2 + .95 + column * (hole.length - 1.9) / 2
        const across = (SETBACK + .9 + row * 1.5) * hole.side
        const [sx, sz] = corridor.at(along, across)
        const stall = createMarketStall(index * 8 + row * 4 + column)
        stall.position.set(sx, .09, sz)
        // Both rows face the aisle between them.
        stall.rotation.y = corridor.facing(along, hole.side) + (row === 0 ? Math.PI : 0)
        markSolidProp(stall, .5)
        stall.userData.propAudit = { name: `city-stall-${row}-${column}`, region: 'city', groundY: .09 }
        root.add(stall)
      }
      // The market fountain, at the back of the square where it does not stand
      // in the aisle between the stall rows.
      const [fx, fz] = corridor.at(hole.s, (SETBACK + hole.depth - .35) * hole.side)
      const fountain = createFountain()
      fountain.scale.setScalar(.7)
      fountain.position.set(fx, .03, fz)
      markSolidProp(fountain, .62)
      fountain.userData.propAudit = { name: 'city-market-fountain', region: 'city', groundY: .03 }
      root.add(fountain)
      registerLandmark(root, { key: 'city-market', name: "Cooper's Market", kind: 'market', detail: 'A weekday produce market opening straight onto the high street. Where most client referrals start.', position: [cx, cz], radius: 2.6 })
    } else {
      addBlockInterior(root, { x: cx, z: cz, width: hole.length, depth: hole.depth, rotation }, 0x5c6b4d)
      // A path across the green, entered from the street.
      const pathPoints: XZ[] = []
      for (let step = 0; step <= 4; step += 1) {
        pathPoints.push(corridor.at(hole.s - hole.length / 2 + hole.length * (step / 4), (SETBACK + .6 + Math.sin(step / 4 * Math.PI) * 1.1) * hole.side))
      }
      const walk = mesh(ribbonGeometry(curveFrom(pathPoints, .062), .44, 14), material(0x8d8677, .98))
      walk.castShadow = false
      root.add(walk)
      footWays(root).push({ points: pathPoints })
      for (let tree = 0; tree < 7; tree += 1) {
        const along = hole.s - hole.length / 2 + .5 + hashUnit(tree * 19 + 3) * (hole.length - 1)
        const across = (SETBACK + .7 + hashUnit(tree * 31 + 5) * (hole.depth - 1)) * hole.side
        const [gx, gz] = corridor.at(along, across)
        trees.push({ x: gx, z: gz, scale: .5 + hashUnit(tree * 7) * .28, color: tree % 2 ? 0x4d6147 : 0x57694b })
      }
      // Benches on the path, facing it.
      for (const step of [.3, .7]) {
        const along = hole.s - hole.length / 2 + hole.length * step
        const [bx, bz] = corridor.at(along, (SETBACK + 1.15) * hole.side)
        const bench = createBench(.74)
        bench.position.set(bx, .06, bz)
        bench.rotation.y = corridor.facing(along, hole.side) + Math.PI
        markAuthoredProp(bench, .42)
        bench.userData.propAudit = { name: `city-green-bench-${step}`, region: 'city', groundY: .06 }
        root.add(bench)
      }
      registerLandmark(root, { key: 'city-green', name: 'Quarter Green', kind: 'green', detail: 'A public green kept out of development by covenant since the quarter was chartered.', position: [cx, cz], radius: 2.5 })
    }
  })

  /* --- The street section: kerbs, footways, furniture -------------------- */
  // The footway now runs from the kerb face right up to the building line, so
  // there is no strip of undeveloped ground between the paving and the shops —
  // which is what used to leave the frontage looking like it had been parked
  // near the street rather than built onto it.
  const footwayCentre = (KERB_OFFSET + SETBACK) / 2
  const footwayWidth = SETBACK - KERB_OFFSET + .12
  for (const side of [-1, 1] as const) {
    const paving = mesh(ribbonGeometry(offsetCurve(route, side * footwayCentre, .045), footwayWidth, 170), material(0x9c9484, .97))
    paving.receiveShadow = true
    paving.castShadow = false
    root.add(paving)
    const kerb = mesh(ribbonGeometry(offsetCurve(route, side * KERB_OFFSET, .076), .12, 170), material(0x726b5c, .9))
    kerb.castShadow = false
    root.add(kerb)
  }
  // The high street's own pavement is a real one — a metre of paving between
  // the kerb and the shopfronts — so it gets the lateral room to match, and the
  // largest share of the district's foot traffic.
  recordCurveFootways(root, route, footwayCentre, false, 60, { halfWidth: (SETBACK - KERB_OFFSET) / 2 - .06, weight: 1.8 })

  // Kerbside parking: marked bays with cars actually standing in them, in the
  // runs between junctions. A shopping street with no parked cars on it reads
  // as a model of a street; this is also the cheapest way to put vehicles in
  // frame that unambiguously belong where they are.
  const nearJunction = (s: number, side: 1 | -1, pad: number) =>
    crossStreets.some((street) => street.side === side && Math.abs(street.s - s) < streetWidth(street.streetClass) / 2 + pad)
  const bayPaint = material(0xb6ac8c, .8)
  for (const side of [-1, 1] as const) {
    let bayIndex = 0
    for (let s = 2.2; s < corridor.length - 2; s += .92) {
      bayIndex += 1
      if (nearJunction(s, side, .9)) continue
      if (inVoid(s, side, .3) || onReserved(s, side)) continue
      const [mx, mz] = corridor.at(s, (KERB_OFFSET - .34) * side)
      const stripe = box([.04, .012, .5], bayPaint, [mx, .086, mz])
      stripe.rotation.y = corridor.facing(s, side)
      stripe.castShadow = false
      root.add(stripe)
      if (hashUnit(bayIndex * 17.3 + (side > 0 ? 71 : 5)) > .34) continue
      const [px, pz] = corridor.at(s + .46, (KERB_OFFSET - .34) * side)
      const parked = createVehicle([0x6d4d48, 0x52626a, 0x71664f, 0x455e59, 0x7a6a52, 0x8a7a63, 0x5d5750][bayIndex % 7])
      parked.position.set(px, .03, pz)
      // Nose in the direction of travel on this side of the road.
      parked.rotation.y = side > 0 ? Math.PI : 0
      markSolidProp(parked, .4)
      root.add(parked)
    }
  }

  // Street furniture, spaced along the street in corridor space so it lines up
  // with the kerb however the street bends. Everything here has a reason to be
  // where it is: lamps at a regular interval, trees between them, café tables
  // outside the lots that are actually shops, and nothing inside a junction.
  let lampIndex = 0
  for (let s = 1.8; s < corridor.length - 1.4; s += 3.15) {
    const side: 1 | -1 = lampIndex % 2 === 0 ? -1 : 1
    lampIndex += 1
    if (nearJunction(s, side, .5)) continue
    const [lx, lz] = corridor.at(s, .82 * side)
    const lamp = createLamp()
    lamp.position.set(lx, .05, lz)
    markAuthoredProp(lamp, .18)
    lamp.userData.propAudit = { name: `city-lamp-${lampIndex}`, region: 'city', groundY: .05 }
    root.add(lamp)
    // A tree opposite each lamp, in the verge on the other side.
    const other: 1 | -1 = side === 1 ? -1 : 1
    if (!nearJunction(s, other, .8) && !inVoid(s, other, .4)) {
      const [tx, tz] = corridor.at(s + 1.1, 1.02 * other)
      trees.push({ x: tx, z: tz, scale: .46 + hashUnit(s * 3.3) * .14, color: 0x506348 })
    }
  }

  // Café terraces and awnings, only outside lots that are shops.
  frontage.filter((lot) => lot.use === 'shopfront').forEach((lot, index) => {
    if (hashUnit(index * 23.7 + 4) > .42) return
    if (nearJunction(lot.s, lot.side, .3)) return
    const [cx, cz] = corridor.at(lot.s, 1.42 * lot.side)
    const cafe = createCafeSet(.62)
    cafe.position.set(cx, .05, cz)
    cafe.rotation.y = corridor.facing(lot.s, lot.side)
    markAuthoredProp(cafe, .42)
    cafe.userData.propAudit = { name: `city-cafe-${index}`, region: 'city', groundY: .05 }
    root.add(cafe)
  })

  // A bike rack and a kiosk, sited where a real one would be: against the
  // building line, clear of the doorways and away from the junctions.
  for (const [s, side, kind] of [[corridor.length * .42, -1, 'bike'], [corridor.length * .56, 1, 'kiosk']] as Array<[number, 1 | -1, string]>) {
    if (nearJunction(s, side, .7)) continue
    const [px, pz] = corridor.at(s, 1.66 * side)
    const prop = kind === 'bike' ? createBikeRack(.72) : createCivicKiosk(.72)
    prop.position.set(px, .05, pz)
    prop.rotation.y = corridor.facing(s, side)
    markAuthoredProp(prop, .4)
    prop.userData.propAudit = { name: `city-${kind}`, region: 'city', groundY: .05 }
    root.add(prop)
  }

  addTreeField(root, trees)
  registerLandmark(root, { key: 'city-highstreet', name: 'Chancery Row', kind: 'civic', detail: 'The quarter\u2019s high street. Every side street in the ward meets it, and every practice worth the name fronts onto it.', position: [corridor.at(corridor.length * .5)[0], corridor.at(corridor.length * .5)[1]], radius: 3 })
  void definition
}

/**
 * An enclosure-era field system: long strips of varying width inside a
 * furlong band, each bounded by hedgerows. Real farmland is neither a tiled
 * checkerboard nor random blobs — it is irregular subdivision within regular
 * bands, which is what makes open country read as worked land.
 */
function addFieldSystem(
  root: THREE.Group,
  trees: TreeRecord[],
  options: {
    bands: Array<{ z: number; depth: number; from: number; to: number }>
    exclude: Array<{ x: number; z: number; radius: number }>
    seed: number
    palette: number[]
    hedge: number
  },
) {
  const hedgeMaterial = material(options.hedge, 1)
  options.bands.forEach((band, bandIndex) => {
    const strips = subdivideFrontage(band.to - band.from, 2.4, 6.2, options.seed + bandIndex * 197)
    let cursor = band.from
    strips.forEach((strip, index) => {
      const centre = cursor + strip / 2
      cursor += strip
      const seed = options.seed + bandIndex * 61 + index * 23
      if (options.exclude.some((zone) => Math.hypot(zone.x - centre, zone.z - band.z) < zone.radius + strip * .3)) return
      const depth = band.depth * (.76 + hashUnit(seed) * .24)
      const field = box([strip - .22, .05, depth], material(options.palette[Math.floor(hashUnit(seed + 3) * options.palette.length) % options.palette.length], 1), [centre, .025, band.z + (hashUnit(seed + 7) - .5) * band.depth * .12])
      field.rotation.y = (hashUnit(seed + 11) - .5) * .05
      field.castShadow = false
      root.add(field)
      // Hedgerows on the strip boundaries, with the occasional standard tree
      // left in the hedge line the way a real enclosure hedge carries them.
      for (const side of [-1, 1]) {
        const hedge = box([.1, .16, depth], hedgeMaterial, [centre + side * (strip - .22) / 2, .09, field.position.z])
        hedge.rotation.y = field.rotation.y
        hedge.castShadow = false
        root.add(hedge)
      }
      const hedgeCross = box([strip - .22, .14, .1], hedgeMaterial, [centre, .08, field.position.z + depth / 2])
      hedgeCross.rotation.y = field.rotation.y
      hedgeCross.castShadow = false
      root.add(hedgeCross)
      // Standards left in the hedge line, and the odd shelter belt in the
      // corner of a field. Enclosure hedges carry a lot of timber, and a parish
      // with a tree every third boundary looks like a golf course.
      const standards = hashUnit(seed + 29) > .3 ? 2 : 1
      for (let index2 = 0; index2 < standards; index2 += 1) {
        trees.push({
          x: centre + (hashUnit(seed + 31 + index2 * 9) - .5) * strip * .8,
          z: field.position.z + depth / 2 * (index2 ? -1 : 1),
          scale: .5 + hashUnit(seed + 37 + index2 * 5) * .25,
          color: hashUnit(seed + 41 + index2) > .5 ? 0x4a5c40 : 0x556446,
        })
      }
    })
  })
}

type TownPlan = {
  key: string; name: string; detail: string; x: number; z: number; size: number; seed: number; seat: boolean
  /** How far the town's southern lane runs before it meets the turnpike. */
  southReach: number
  /** How far its northern lane runs before it leaves the map towards the fells. */
  northReach: number
}

/**
 * The three places on The Circuit, and the one list of them.
 *
 * Both the settlement pass and the corridor pass need to agree on where these
 * are — the corridor has to know where to tighten its frontage and where to
 * leave a crossroads, and the towns have to know how far their own lanes must
 * run to reach the road — so the geometry lives here rather than being written
 * out twice and drifting.
 */
const CIRCUIT_TOWNS: Array<Omit<TownPlan, 'southReach' | 'northReach'>> = [
  { key: 'nation-marlow', name: 'Marlow Crossing', detail: 'A market town on the old ford. Two lanes, one square, and the circuit bench sits here twice a year.', x: -10, z: -7.9, size: .88, seed: 2100, seat: false },
  { key: 'nation-seat', name: 'Fenwick, county seat', detail: 'The largest place on the circuit: six radial lanes, the county courthouse, and the only through station.', x: 0, z: -8.4, size: 1.24, seed: 3300, seat: true },
  { key: 'nation-ashgate', name: 'Ashgate', detail: 'A village that never outgrew its green. Most of its filings travel to Fenwick.', x: 10, z: -7.7, size: .68, seed: 4400, seat: false },
]

/**
 * The back lane that rings the whole corridor. Traffic that is not stopping in
 * any of the three towns uses it, and — more importantly for the layout — it is
 * the thing every side lane out of the corridor runs *to*, which is what makes
 * those lanes junctions rather than stubs.
 */
const CIRCUIT_BACK_LANE: XZ[] = [
  [-19.5, -4.6], [-10, -4.9], [0, -4.6], [10, -4.9], [19.5, -4.6],
  [21.4, 0], [19.5, 10.3], [10, 10.6], [0, 10.3], [-10, 10.6], [-19.5, 10.3], [-21.4, 0],
]

/** The railway, as a table so field bands can stop short of the right-of-way. */
const CIRCUIT_RAIL: XZ[] = [[-16, 7.7], [-9, 6.7], [-2, 7.4], [5, 6.6], [16, 7.4]]

/** Linear read-off of a polyline given as z-over-x. Within a weld radius of the drawn curve. */
function zAlong(points: XZ[], x: number) {
  if (x <= points[0][0]) return points[0][1]
  for (let index = 1; index < points.length; index += 1) {
    if (x > points[index][0]) continue
    const [ax, az] = points[index - 1]
    const [bx, bz] = points[index]
    return az + (bz - az) * ((x - ax) / Math.max(1e-6, bx - ax))
  }
  return points[points.length - 1][1]
}

/** The near (northern) leg of the back lane, as z over x. */
const backLaneNorthZ = (x: number) => zAlong(CIRCUIT_BACK_LANE.slice(0, 5), x)
/** The far (southern) leg, whose control points run east to west. */
const backLaneSouthZ = (x: number) => zAlong(CIRCUIT_BACK_LANE.slice(6, 11).slice().reverse(), x)
const circuitRailZ = (x: number) => zAlong(CIRCUIT_RAIL, x)

/**
 * One market town, planned as a town rather than as a diagram of one.
 *
 * The previous version was a circular market place with a continuous ring of
 * buildings round it and four to six lanes radiating outward, each with its
 * own frontage. In plan that is a sunburst, and a sunburst is the single most
 * artificial figure you can put in open country: nothing outside a baroque
 * capital is organised radially, and the wedge-shaped scraps of grass between
 * the spokes read as scatter no matter how carefully each spoke is built.
 *
 * A market town is instead a small orthogonal grid squared to the road it
 * grew off, with a rectangular market place at the crossing of its high street
 * and its cross street, blocks that shrink and thin outward, and an edge that
 * frays into paddocks rather than stopping on a circle. That is what this
 * builds. Sizes still differ deliberately — a county seat, a market town and a
 * village — so the corridor keeps its settlement hierarchy.
 */
function addCircuitTown(root: THREE.Group, trees: TreeRecord[], town: TownPlan, definition: ArcDefinition, reserved: ReservedSite[]) {
  const buildings: PlannedBuilding[] = []
  const palette = [0x7e6f5c, 0x8a7862, 0x6f6b61, 0x8f7f66, 0x746657]
  // Sized so the three places stay three places: at these extents the county
  // seat's edge lane is still a clear field away from Marlow's and Ashgate's,
  // which is what stops the corridor reading as one continuous ribbon town.
  const halfX = 2.4 + town.size * 1.95
  const halfZ = 2.0 + town.size * 1.6

  // The high street runs north–south through the market place, because that is
  // the line that continues south to the turnpike and north to the back lane;
  // the cross street is the other arm of the same crossroads. Everything else
  // is local, jittered, and bounded by the town's own edge lanes.
  const avenues = assembleAxis(
    [
      // The outermost lanes are unkerbed back lanes, so the town does not end
      // on a paved rectangle.
      { position: town.x - halfX, streetClass: 'alley' },
      { position: town.x, streetClass: 'collector' },
      { position: town.x + halfX, streetClass: 'alley' },
    ],
    planAxisInterior(town.x - halfX, town.x + halfX, [town.x], town.seed + 11, 3.3),
    2.85,
  )
  const streets = assembleAxis(
    [
      { position: town.z - halfZ, streetClass: 'alley' },
      { position: town.z, streetClass: 'collector' },
      { position: town.z + halfZ, streetClass: 'alley' },
    ],
    planAxisInterior(town.z - halfZ, town.z + halfZ, [town.z], town.seed + 29, 3.1),
    2.7,
  )
  const wayCount = roadWays(root).length
  addPlannedStreets(root, streetsFromGrid(avenues, streets), { asphalt: 0x3f4441, pavement: 0x8b8577 })
  // A grid street that ends in a hay field is not a way out of the district,
  // so none of these may be a spawn portal — otherwise cars materialise on the
  // edge of a village, which is exactly the popping the player complains of.
  // The only approaches to this town are the two lanes below, which go
  // somewhere: south to the turnpike and north to the back lane.
  for (const way of roadWays(root).slice(wayCount)) way.portal = false

  // See `blocksFromGrid`: the village keeps the old plot line until its
  // authored props are re-sited, because correcting it here measured worse.
  const blocks = blocksFromGrid(avenues, streets, { seed: town.seed, verge: false })
  // The market place is the block at the crossroads, left unbuilt and paved.
  let market: BlockRect | null = null
  let closest = Number.POSITIVE_INFINITY
  for (const block of blocks) {
    const distance = Math.hypot(block.x - town.x, block.z - town.z)
    if (distance < closest) { closest = distance; market = block }
  }

  blocks.forEach((block) => {
    if (block === market) return
    // Normalised distance from the crossroads: 0 at the market place, 1 at the
    // town's edge lanes. This is the density gradient, and it drives storeys,
    // vacancy, roof form and whether a block is built at all.
    const spread = Math.max(Math.abs(block.x - town.x) / halfX, Math.abs(block.z - town.z) / halfZ)
    const density = THREE.MathUtils.clamp(1 - spread * .95, 0, 1)
    // A frayed edge: outer blocks are dropped at random and left as paddock,
    // so the town stops at an irregular line instead of on a rectangle.
    if (hashUnit(block.seed * 1.7 + 5) < Math.max(0, spread - .66) * 1.9) {
      trees.push({ x: block.x + (hashUnit(block.seed) - .5) * block.width * .5, z: block.z, scale: .5, color: 0x4b5d42 })
      return
    }
    // Out at the edge a block is built only on the sides that face the town,
    // which is how a settlement actually thins: the far frontage is the one
    // that never got built.
    const inward: Array<'n' | 's' | 'e' | 'w'> = []
    inward.push(block.z > town.z ? 'n' : 's')
    inward.push(block.x > town.x ? 'w' : 'e')
    buildings.push(...developBlock(block, {
      seed: block.seed,
      lotMin: .92,
      lotMax: 1.85 + density * .5,
      setback: .24,
      buildingDepth: 1.02,
      // Party walls at the centre, gardens between the houses at the edge.
      gap: .06 + (1 - density) * .24,
      storeyHeight: .74,
      storeysMin: 1.55 + density * (town.seat ? 1.05 : .6),
      storeysMax: 2.15 + density * (town.seat ? 1.9 : 1),
      palette,
      // Only the county seat gets a parapeted street wall, and only around its
      // market place; everything else in this county is a pitched roof.
      roof: town.seat && density > .62 ? 'parapet' : 'pitched',
      litChance: .08 + density * .38,
      vacancy: .02 + (1 - density) * .16,
      cornerBonus: .35,
      edges: spread > .58 ? inward : ['n', 's', 'e', 'w'],
    }))
  })

  if (market) {
    const paving = box([market.width, .06, market.depth], material(0x8b8577, .98), [market.x, .05, market.z])
    paving.castShadow = false
    root.add(paving)
    const civic = createCourthouse(town.seat ? .74 : .44, definition.stone)
    civic.position.set(market.x, .06, market.z - market.depth * .26)
    root.add(civic)
    const cross = createMarketStall(town.seed)
    cross.position.set(market.x + market.width * .22, .07, market.z + market.depth * .24)
    markSolidProp(cross, .5)
    root.add(cross)
    for (const side of [-1, 1]) {
      const lamp = createLamp()
      lamp.position.set(market.x + side * market.width * .38, .07, market.z + market.depth * .3)
      root.add(lamp)
    }
    const marketWalk = market.z + market.depth * .34
    footWays(root).push({
      points: [[market.x - market.width * .4, marketWalk], [market.x + market.width * .4, marketWalk]],
    })
  }

  renderPlannedBuildings(root, 'nation', clearReserved(buildings, reserved), { cullRadius: 12 + town.size * 6 })

  // The two approach lanes. These are the town's only connections to the rest
  // of the network, and both of them end somewhere real, so neither is a stub.
  const squareRadius = 1.75 * town.size
  const approaches: Array<[number, number]> = [
    [town.z + halfZ, town.z + squareRadius + town.southReach],
    [town.z - halfZ, town.z - squareRadius - town.northReach],
  ]
  approaches.forEach(([from, to], index) => {
    if (Math.abs(to - from) < .8) return
    const lane = new THREE.LineCurve3(new THREE.Vector3(town.x, .07, from), new THREE.Vector3(town.x, .07, to))
    root.add(roadMesh(lane, .58, 0x3f4441))
    // Recorded from the crossroads rather than from the town edge, so the lane
    // welds to the high street instead of leaving a free end one block short
    // of it — a free end inside a village is a spawn portal in a village.
    const way = new THREE.LineCurve3(new THREE.Vector3(town.x, .07, town.z), new THREE.Vector3(town.x, .07, to))
    recordCurveWay(root, way, { speed: 1.15, samples: Math.max(7, Math.round(Math.abs(to - town.z))), width: .58 })
    for (let step = 1; step <= 3; step += 1) {
      const at = from + (to - from) * step / 3.6
      trees.push({
        x: town.x + (index ? -1 : 1) * 1.15,
        z: at,
        scale: .46 + hashUnit(town.seed + index * 7 + step) * .18,
        color: step % 2 ? 0x4b5d42 : 0x546348,
      })
    }
  })

  registerLandmark(root, { key: town.key, name: town.name, kind: town.seat ? 'civic' : 'market', detail: town.detail, position: [town.x, town.z], radius: Math.max(halfX, halfZ) * .8 })
}

/**
 * A low post-and-rail yard around a farmstead prop. Real farmyards are
 * fenced, not props dropped loose in open grass; leaving one side open (the
 * side the access track approaches from) reads as a gate rather than a gap.
 */
function createFieldPen(width: number, depth: number, gapSign: 1 | -1, color = 0xb7aa8c) {
  const group = new THREE.Group()
  const pale = material(color, .92)
  const railY = .3
  const halfW = width / 2
  const halfD = depth / 2
  const addRail = (size: [number, number, number], position: [number, number, number]) => {
    const rail = box(size, pale, position)
    rail.castShadow = false
    group.add(rail)
  }
  addRail([width, .06, .05], [0, railY, halfD])
  addRail([width, .06, .05], [0, railY, -halfD])
  if (gapSign !== 1) addRail([.05, .06, depth], [halfW, railY, 0])
  if (gapSign !== -1) addRail([.05, .06, depth], [-halfW, railY, 0])
  const corners: XZ[] = [[halfW, halfD], [-halfW, halfD], [halfW, -halfD], [-halfW, -halfD]]
  for (const [x, z] of corners) {
    if ((x > 0 ? 1 : -1) === gapSign) continue
    const post = box([.06, .38, .06], pale, [x, .19, z])
    post.castShadow = false
    group.add(post)
  }
  return group
}

/** Nearest z on the drawn route at a given world x. */
function routeZAtX(route: THREE.Curve<THREE.Vector3>, x: number) {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index <= 160; index += 1) {
    const point = route.getPointAt(index / 160)
    const distance = Math.abs(point.x - x)
    if (distance < bestDistance) { bestDistance = distance; best = point.z }
  }
  return best
}

/**
 * The parcels the shared tier loop and the rival loop will claim later.
 *
 * Both passes over this region have to leave the same ground alone, and an
 * instanced row of cottages cannot be cleared after the fact the way a loose
 * prop can, so the sites are derived once from the same formula that places
 * them rather than written down twice.
 */
function circuitReservedSites(route: THREE.Curve<THREE.Vector3>): ReservedSite[] {
  const reserved: ReservedSite[] = [.12, .88].map((t, index) => {
    const point = route.getPointAt(t)
    const tangent = route.getTangentAt(t).normalize()
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(index === 0 ? -1 : 1)
    const site = point.clone().add(side.multiplyScalar(3.05))
    return { x: site.x, z: site.z, radius: 3.8 }
  })
  reserved.push({ x: -11.5, z: -8, radius: 2.6 }, { x: 11.5, z: -8, radius: 2.6 })
  return reserved
}

/** What a parcel of worked land in The Circuit is currently under. */
type CircuitFieldUse = 'wheat' | 'stubble' | 'plough' | 'pasture' | 'meadow' | 'roots' | 'orchard' | 'wood' | 'allotment'

/**
 * What each crop looks like from the air.
 *
 * Deliberately spread across both hue and lightness. The first pass at this
 * kept every parcel within a few percent of the grass it sat on, which meant
 * the land read as one green sheet with hedges drawn on it — the same failure
 * the Sovereign Arc's facades had, in ground cover rather than in walls. Worked
 * land is not subtle: cut wheat is nearly straw-coloured, a ploughed field is
 * brown earth, and roots and rough grazing are much darker than a mown verge.
 */
const CIRCUIT_CROP: Record<CircuitFieldUse, number> = {
  wheat: 0xbba85f,
  stubble: 0xc6b98a,
  plough: 0x6c5741,
  pasture: 0x74884f,
  meadow: 0x8c9a5e,
  roots: 0x4c6440,
  orchard: 0x637a45,
  wood: 0x4e5c39,
  allotment: 0x7a6f4c,
}

/** Grass a beast is kept on is fenced, not hedged, and that difference reads. */
const CIRCUIT_GRAZED: CircuitFieldUse[] = ['pasture', 'meadow', 'allotment']

type CircuitField = {
  side: 1 | -1
  from: number
  to: number
  near: number
  far: number
  use: CircuitFieldUse
  seed: number
  row: number
}

/**
 * The Circuit, built outwards from the turnpike.
 *
 * Every previous pass over this region generated the countryside first — field
 * bands on the world axes, three towns on a line of constant z, props scattered
 * at fixed offsets — and then let the career route wander through whatever that
 * produced. That is why the road has read as a strip laid on top of unrelated
 * ground: nothing around it knew it was there, so nothing addressed it.
 *
 * This inverts the order, the same way the Old Quarter's high street now does,
 * but a country road organises land differently from a high street and the
 * differences are the point:
 *
 *  - Setback is not constant. It runs from a metre in the middle of a village
 *    to four in open country, so the settlement *tightens* onto the carriageway
 *    as you approach the centre and lets go again on the way out. That gradient,
 *    not the buildings, is what makes somewhere read as a village.
 *  - The frontage is mostly absent. A rural corridor is a high vacancy rate with
 *    three dense places in it; the gaps are the subject, not a failure to fill.
 *  - The land between the road and the back lane is subdivided into fields whose
 *    road-side boundary *is* the road's curve, and whose depth is whatever is
 *    actually left between the two, so the parcels vary the way real ones do
 *    instead of tiling.
 *  - The edge is mediated rather than abrupt: mown verge, ditch, hedge or
 *    post-and-rail depending on what is behind it, gates where a track comes
 *    out, kerb and footway through the villages.
 */
function addNationCorridor(root: THREE.Group, route: THREE.Curve<THREE.Vector3>, definition: ArcDefinition) {
  const samples: XZ[] = []
  for (let index = 0; index <= 110; index += 1) {
    const point = route.getPointAt(index / 110)
    samples.push([point.x, point.z])
  }
  const corridor = buildCorridor(samples, .2)
  const trees: TreeRecord[] = []
  const reserved = circuitReservedSites(route)

  /* --- The turnpike, registered before anything is built beside it --------- */
  // The road has to come from somewhere and go somewhere, both because it is
  // the only honest way to end a corridor and because traffic needs a node off
  // the edge of the world to arrive from. Without one the whole network is a
  // set of closed rings and every car has to be conjured into the middle of it.
  //
  // This is recorded here rather than where the approaches are drawn, several
  // hundred lines down, because the clearance pass can only reconcile a
  // building against the streets that have been recorded by the time that
  // building is instanced. The turnpike used to be registered last, so every
  // village frontage on it — the whole point of the corridor — was checked
  // against a network that did not yet contain the road they front onto. That
  // is the tractor at 29.4,-1.4, driving through a farm building the pass had
  // no way to know was in its way.
  const approachPoints = (fromEnd: boolean) => {
    const s = fromEnd ? corridor.length : 0
    const [ax, az] = corridor.at(s, 0)
    const [tx, tz] = corridor.tangent(s)
    const direction = fromEnd ? 1 : -1
    const out: XZ[] = []
    for (let step = 1; step <= 7; step += 1) {
      const distance = step * 2.2
      // A gentle drift, so the continuation reads as more road rather than as
      // a tangent line ruled off the end of one.
      const drift = Math.sin(step / 7 * 1.1) * 1.5 * (fromEnd ? -1 : 1)
      out.push([ax + tx * distance * direction - tz * drift, az + tz * distance * direction + tx * drift])
    }
    return out
  }
  const westApproach = approachPoints(false).reverse()
  const eastApproach = approachPoints(true)
  const wayPoints: XZ[] = [...westApproach]
  for (let index = 0; index <= 64; index += 1) wayPoints.push(corridor.at(corridor.length * (index / 64), 0))
  wayPoints.push(...eastApproach)
  // One way, both ends off the map: the turnpike is the spine of the network as
  // well as of the layout, and its portals are the only place a car on The
  // Circuit is allowed to appear.
  roadWays(root).push({ points: wayPoints, kind: 'road', speed: 1.75, portal: true, width: 1.48 })

  const tagProp = <T extends THREE.Object3D>(object: T, name: string, footprint: number) => {
    markAuthoredProp(object, footprint)
    object.userData.propAudit = { name: `nation-${name}`, region: 'nation' }
    return object
  }

  /**
   * Ground already spoken for.
   *
   * Everything in here is placed by an independent rule — a gate goes where a
   * track meets a boundary, a trough goes in the corner of a pasture, a
   * milestone goes where a village begins — and those rules do not know about
   * each other. Rather than tuning offsets until they happen not to collide,
   * which is what produced the fourteen overlapping props the audit found on
   * the first build of this pass, each placement claims the ground it stands
   * on and later ones give way. First claim wins, so the fixed things (the
   * church, the green, the farmyards) are claimed before the incidental ones.
   */
  const claims: Array<{ x: number; z: number; radius: number }> = []
  const claim = (x: number, z: number, radius: number) => {
    for (const held of claims) {
      if (Math.hypot(held.x - x, held.z - z) < held.radius + radius) return false
    }
    claims.push({ x, z, radius })
    return true
  }
  const claimAt = (s: number, d: number, radius: number) => {
    const [x, z] = corridor.at(s, d)
    return claim(x, z, radius)
  }

  const sAtX = (x: number) => {
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (const sample of corridor.samples) {
      const distance = Math.abs(sample.x - x)
      if (distance < bestDistance) { bestDistance = distance; best = sample.s }
    }
    return best
  }

  /* --- The settlement gradient ------------------------------------------- */
  const townS = CIRCUIT_TOWNS.map((town) => sAtX(town.x))
  const townSpread = [3, 3.9, 2.7]
  /** 1 at a village crossroads, 0 in open country. Drives everything below. */
  const village = (s: number) => townS.reduce(
    (peak, centre, index) => Math.max(peak, Math.exp(-(((s - centre) / townSpread[index]) ** 2))),
    0,
  )
  const sFord = townS[0] - 3.6

  /* --- Deliberate open ground -------------------------------------------- */
  const voids: CorridorVoid[] = [
    { s: sFord + .8, side: 1, length: 4.4, depth: 2.7, use: 'green' },
    // Shallower than it looks like it should be: the railway platform and its
    // canopy stand immediately behind, and a deeper green pushed the two into
    // each other.
    { s: townS[1] - 3.5, side: 1, length: 5.4, depth: 2.5, use: 'green' },
    { s: townS[2] + 2.9, side: 1, length: 4.6, depth: 3.1, use: 'plaza' },
  ]
  const inVoid = (s: number, side: 1 | -1, pad = 0) => voidCovers(voids, s, side, pad)
  const onReserved = (s: number, side: 1 | -1, lateral = 2.6) => {
    const [x, z] = corridor.at(s, lateral * side)
    return isReserved(x, z, reserved, .4)
  }
  const onFord = (s: number, pad = 0) => Math.abs(s - sFord) < 1.9 + pad

  /* --- How far there is to go on each side ------------------------------- */
  /** Distance from the centreline out to the back lane on this side. */
  const backLaneReach = (s: number, side: 1 | -1) => {
    const [x, z] = corridor.at(s, 0)
    return Math.abs((side < 0 ? backLaneNorthZ(x) : backLaneSouthZ(x)) - z) - .05
  }
  /** Distance out to the railway, which the southern fields stop short of. */
  const railReach = (s: number) => {
    const [x, z] = corridor.at(s, 0)
    return circuitRailZ(x) - z
  }
  /**
   * How far out from `from` the land stays open before it runs into a town.
   *
   * The band between the back lane and the villages is worked too, but how much
   * of it there is depends entirely on how close the nearest town has come to
   * the road at that point — which is a question about the settlement pattern,
   * not a number that can be written down once.
   */
  const townClearance = (s: number, side: 1 | -1, from: number, limit: number) => {
    for (let d = from; d <= limit; d += .3) {
      const [x, z] = corridor.at(s, d * side)
      for (const town of CIRCUIT_TOWNS) {
        if (Math.hypot(town.x - x, town.z - z) < 1.75 * town.size + 3.9) return d - from
      }
    }
    return limit - from
  }

  /* --- The fixed things, sited and claimed first -------------------------- */
  // Farmsteads are chosen here rather than where they are built, because the
  // field system and the gate pass both have to know the yards are coming.
  const farmSites = ([
    { s: townS[0] - 6.6, side: -1, seed: 61 },
    { s: townS[0] + 4.6, side: 1, seed: 137 },
    { s: townS[1] + 5.8, side: -1, seed: 211 },
    { s: townS[2] - 4.4, side: 1, seed: 307 },
  ] as Array<{ s: number; side: 1 | -1; seed: number }>)
    .map((site) => {
      const room = Math.min(
        backLaneReach(site.s, site.side) - 1.5,
        site.side > 0 ? railReach(site.s) - 1.5 : Number.POSITIVE_INFINITY,
      )
      const yardD = Math.min(room, site.side < 0 ? 3.2 : 4.4)
      const [x, z] = corridor.at(site.s, yardD * site.side)
      return { ...site, yardD, x, z }
    })
    .filter((site) => (
      site.s > 1.6 && site.s < corridor.length - 1.6
      && site.yardD > 2.5
      && !inVoid(site.s, site.side, 1.8)
      && !isReserved(site.x, site.z, reserved, 1.4)
      && claim(site.x, site.z, 2.5)
    ))

  // The greens themselves are kept clear by `inVoid`, which the field system,
  // the frontage and the side turnings all consult, so they are not claimed
  // here — a claim over the whole green would also have excluded the green's
  // own benches and cross, which are the point of it.
  const setbackAt = (s: number) => 1.05 + (1 - village(s)) * 3.15
  // St Ailred's stands beside the green rather than beyond it. The land behind
  // the green is the railway's, and a church set at the far end of a plot that
  // deep would have been standing on the line; a churchyard is also a good
  // five metres square, so it takes the whole west end of the village and the
  // green begins where its wall stops.
  const churchS = voids[1].s - voids[1].length / 2 - 3.4
  const churchD = (setbackAt(voids[1].s) + 1.7) * voids[1].side
  const [churchX, churchZ] = corridor.at(churchS, churchD)
  claim(churchX, churchZ, 3)

  /* --- Junctions ---------------------------------------------------------- */
  // The three town approaches. They are drawn by `addCircuitTown` (which owns
  // the lane and its frontage) but the corridor has to know they are there, so
  // that its own street wall leaves a corner at each crossroads instead of
  // running straight past a road.
  const approaches: CrossStreet[] = townS.map((s) => ({
    s, side: -1 as const, streetClass: 'collector' as const, reach: 4, points: [],
  }))
  const nearApproach = (s: number, pad = 0) => townS.some((centre) => Math.abs(s - centre) < 1.5 + pad)

  // Which of the northern side turnings are lanes that reach the back lane and
  // which are field tracks that stop at a gate. Recorded as it is decided,
  // because `corridorCrossStreets` asks for a reach and never asks again.
  const throughLane = new Map<number, boolean>()
  const key = (s: number) => Math.round(s * 100)
  const generated = corridorCrossStreets(corridor, {
    module: 5.4,
    jitter: .34,
    seed: 4411,
    margin: 2.7,
    streetClass: () => 'local',
    reach: (s, side) => {
      const available = backLaneReach(s, side)
      if (side > 0) {
        // Nothing on the southern side reaches the back lane: the railway is in
        // the way, and the one crossing on this corridor is the station road.
        return Math.min(2.4 + hashUnit(s * 5.7 + 1.3) * 2.1, Math.max(1.4, railReach(s) - 1.3))
      }
      const through = hashUnit(Math.round(s * 11) * 1.7 + .4) < .6 && available > 3.2
      throughLane.set(key(s), through)
      return through ? available : Math.min(2.2 + hashUnit(s * 3.3) * 1.3, available - .9)
    },
    allow: (s, side) => !nearApproach(s, 1.4) && !inVoid(s, side, 1.5) && !onReserved(s, side, 3) && !onFord(s, .6),
  })
  const crossStreets = [...approaches, ...generated]

  const trackMaterial = material(0x5f5748, .99)
  const laneMaterial = material(0x3f4441, .93)
  const vergeMaterial = material(0x6f7a5e, .99)
  const hedgeMaterial = material(0x475a3f, .98)
  const railMaterial = material(0xb7aa8c, .92)
  const ditchMaterial = material(0x565b45, 1)
  const stoneMaterial = material(0x847c6e, .95)

  generated.forEach((street, index) => {
    const curve = curveFrom(street.points, .058)
    const through = street.side < 0 && throughLane.get(key(street.s)) === true
    if (through) {
      const apron = mesh(ribbonGeometry(curve, .96, 20), vergeMaterial)
      apron.position.y = -.012
      apron.castShadow = false
      root.add(apron)
      const carriageway = mesh(ribbonGeometry(curve, .56, 20), laneMaterial)
      carriageway.castShadow = false
      root.add(carriageway)
      // Recorded from the turnpike's *centreline*, not from where the drawn
      // lane starts. `corridorCrossStreets` begins its geometry at the kerb,
      // a metre out, which is further than the graph's weld radius: the first
      // node then lands beside the turnpike instead of on it, the lane becomes
      // a dead end, and a dead end is a spawn portal in the middle of the map.
      // This is the same defect the Old Quarter's side streets had at their
      // far ends, seen from the other end of the street.
      const joined = curveFrom([corridor.at(street.s, 0), ...street.points], .058)
      recordCurveWay(root, joined, { speed: 1.05, samples: 11, width: streetWidth(street.streetClass) })
    } else {
      const track = mesh(ribbonGeometry(curve, .34, 14), trackMaterial)
      track.castShadow = false
      root.add(track)
      // A gate where the track leaves the road, set in the field boundary.
      if (claimAt(street.s, 1.72 * street.side, 1.05)) {
        const [gx, gz] = corridor.at(street.s, 1.72 * street.side)
        const [tx, tz] = corridor.tangent(street.s)
        const gate = tagProp(createFieldGate(.4), `track-gate-${index}`, .9)
        gate.position.set(gx, .03, gz)
        gate.rotation.y = Math.atan2(tx, tz) + Math.PI / 2
        root.add(gate)
      }
    }
    if (hashUnit(index * 17.3) < .55) {
      const along = 1.4 + hashUnit(index * 7.1) * Math.max(.4, street.reach - 2)
      const [ox, oz] = corridor.at(street.s + (hashUnit(index * 3.7) - .5) * .5, along * street.side)
      trees.push({ x: ox + .7, z: oz, scale: .5 + hashUnit(index * 13) * .2, color: index % 2 ? 0x475a3d : 0x506147 })
    }
  })

  /* --- The street wall ---------------------------------------------------- */
  const frontage = corridorFrontage(corridor, crossStreets, {
    seed: 5507,
    lotMin: 1.15,
    lotMax: 2.5,
    // The gradient that makes a village a village: a metre off the kerb in the
    // middle of one, a front garden's depth more by the time the last cottage
    // gives way to the first field. The range used to be three times this,
    // which — combined with the near-total vacancy out in the country — meant
    // the handful of buildings that did survive stood at four unrelated
    // distances from a road that was itself wandering. Two variables both
    // wandering is what "erratic" looks like; the road is straight now and the
    // building line only breathes.
    setback: (s) => 1.15 + (1 - village(s)) * 1.4,
    // Constant depth, so a village street has a back line as well as a front
    // one and the plots behind it are plots rather than leftovers.
    depth: () => 1.28,
    storeyHeight: .72,
    storeys: (s, _side, use) => {
      const centrality = village(s)
      if (use === 'civic') return [2.2, 2.9]
      if (use === 'workshop') return [1, 1.5]
      return [1.25 + centrality * .7, 1.75 + centrality * 1.05]
    },
    use: (s, _side, seed, corner) => {
      const centrality = village(s)
      const roll = hashUnit(seed * 1.9 + 3.1)
      // The pub, the shop and the smithy are on the corners of the crossroads,
      // because that is the only frontage in a village anybody passes twice.
      if (centrality > .62 && corner && roll < .72) return 'shopfront'
      if (roll < centrality * .34) return 'shopfront'
      if (centrality > .55 && roll > .93) return 'civic'
      if (centrality < .3) return 'workshop'
      return 'housing'
    },
    palette: () => 0x7e6f5c,
    // Everything out here is pitched. The flat-roofed option this originally
    // carried over from the city put black slabs in the middle of a village.
    roof: () => 'pitched',
    litChance: (use) => (use === 'shopfront' ? .46 : use === 'civic' ? .34 : use === 'housing' ? .18 : .05),
    margin: 1.4,
    // Cottages belong to villages. Open country gets its buildings from the
    // farmsteads further down this function, which are composed — a yard, a
    // range of barns, a track out to the road — rather than from single lots
    // dropped on the verge every eighty metres, which is what the vacancy roll
    // used to leave behind and what read as scatter no matter how the road ran.
    allow: (s, side) => village(s) > .2 && !inVoid(s, side, .4) && !onReserved(s, side) && !onFord(s),
    // Within a village the street is nearly continuous and only frays at the
    // edges, where the last few plots really are gappy.
    vacancy: (s) => Math.min(.75, (1 - village(s)) * .95),
    // Village cottages share walls in the core and stand in their own plots
    // at the edges; a small constant gap reads as both without needing two
    // different rules.
    partyGap: .12,
  })
  renderPlannedBuildings(root, 'nation', frontage.map((lot) => ({
    x: lot.x, z: lot.z, width: lot.width, depth: lot.depth, height: lot.height,
    rotationY: lot.rotationY, color: lot.color, lit: lot.lit, roof: lot.roof, corner: lot.corner,
  })), { cullRadius: 24 })

  /* --- Worked land -------------------------------------------------------- */
  const fields: CircuitField[] = []
  // Three bands of worked land, each defined by what bounds it rather than by
  // a chosen depth: road to back lane on the village side, road to railway on
  // the other, and the strip the railway cuts off behind itself. Land is
  // divided by the things that already run through it.
  const bands: Array<{ side: 1 | -1; near: (s: number) => number; far: (s: number) => number; seed: number }> = [
    { side: -1, near: () => 2.05, far: (s) => backLaneReach(s, -1) - .75, seed: 9100 },
    { side: 1, near: () => 2.05, far: (s) => railReach(s) - 1.05, seed: 9500 },
    { side: 1, near: (s) => railReach(s) + .85, far: (s) => backLaneReach(s, 1) - .7, seed: 9900 },
    {
      side: -1,
      near: (s) => backLaneReach(s, -1) + .8,
      far: (s) => backLaneReach(s, -1) + .8 + townClearance(s, -1, backLaneReach(s, -1) + .8, 26),
      seed: 9700,
    },
  ]
  bands.forEach((band, bandIndex) => {
    const widths = subdivideFrontage(corridor.length - 1.4, 2.7, 6.2, band.seed)
    let cursor = .7
    widths.forEach((width, index) => {
      const from = cursor
      const to = cursor + width
      cursor = to
      const mid = (from + to) / 2
      const seed = band.seed + index * 53
      let near = band.near(mid)
      const far = Math.min(band.far(mid), band.far(from), band.far(to))
      // A green is a hole in the worked land, not a hole in the parish: the
      // field behind one starts where the green stops rather than not existing,
      // which is what left the whole east end of the corridor as bare grass.
      const hole = voids.find((candidate) => candidate.side === band.side && Math.abs(candidate.s - mid) < candidate.length / 2 + width / 2)
      if (hole) near = Math.max(near, setbackAt(hole.s) + hole.depth + .45)
      if (far - near < .6) return
      // A deep parcel is two fields with a boundary between them, not one very
      // long one: depth is what decides how land was divided, not the author.
      const rows = far - near > 4.2 ? 2 : 1
      for (let row = 0; row < rows; row += 1) {
        const rowNear = near + (far - near) * (row / rows)
        const rowFar = near + (far - near) * ((row + 1) / rows) - (row + 1 < rows ? .22 : 0)
        const roll = hashUnit(seed * 1.7 + row * 4.3)
        // A rotation with a jittered start, not a draw from a distribution:
        // real farms crop in a rotation, and six independent random draws will
        // happily give a parish four ploughed fields in a row and no wheat.
        const cycle: CircuitFieldUse[] = ['wheat', 'pasture', 'plough', 'stubble', 'meadow', 'roots']
        let use = cycle[(index * 2 + row + bandIndex * 3 + Math.floor(roll * 2)) % cycle.length]
        if (bandIndex === 0 && mid > townS[2] + 2.6) use = 'orchard'
        else if (bandIndex === 1 && mid > townS[1] + 3.4 && mid < townS[2] - 2.2 && row === rows - 1) use = 'wood'
        else if (bandIndex === 1 && Math.abs(mid - (townS[1] + 3)) < 1.8 && row === 0) use = 'allotment'
        else if (bandIndex === 3 && roll > .74) use = 'wood'
        fields.push({ side: band.side, from: from + .12, to: to - .12, near: rowNear, far: rowFar, use, seed: seed + row * 17, row: bandIndex < 2 ? row : row + 2 })
      }
    })
  })

  fields.forEach((field, index) => {
    const { side } = field
    const near = field.near * side
    const far = field.far * side
    const surface = mesh(corridorPatchGeometry(corridor, field.from, field.to, near, far, 5), material(CIRCUIT_CROP[field.use], 1))
    surface.position.y = .028 + (field.row * .004)
    surface.castShadow = false
    root.add(surface)

    const grazed = CIRCUIT_GRAZED.includes(field.use)
    const boundary = grazed
      ? { material: railMaterial, height: .3, thickness: .06 }
      : { material: hedgeMaterial, height: .36, thickness: .17 }
    if (boundary) {
      corridorBoundary(root, corridor, field.from, field.to, far, { ...boundary, y: .03, step: 1.15 })
      for (const edge of [field.from, field.to]) {
        crossBoundary(root, corridor, edge, near, far, { ...boundary, y: .03 })
      }
      // The standard trees a hedge carries; a fence line carries none.
      if (!grazed && hashUnit(field.seed + 29) > .45) {
        const [tx, tz] = corridor.at(field.from + (field.to - field.from) * (.2 + hashUnit(field.seed) * .6), far)
        trees.push({ x: tx, z: tz, scale: .52 + hashUnit(field.seed + 37) * .26, color: hashUnit(field.seed + 41) > .5 ? 0x475a3d : 0x51624a })
      }
    }

    const middle = (field.from + field.to) / 2
    const midD = (field.near + field.far) / 2 * side
    if (field.use === 'orchard') {
      const rowsAcross = Math.max(2, Math.floor((field.far - field.near) / 1.15))
      const rowsAlong = Math.max(3, Math.floor((field.to - field.from) / 1.35))
      for (let across = 0; across < rowsAcross; across += 1) {
        for (let along = 0; along < rowsAlong; along += 1) {
          const s = field.from + .7 + (field.to - field.from - 1.4) * (rowsAlong > 1 ? along / (rowsAlong - 1) : .5)
          const d = (field.near + .6 + (field.far - field.near - 1.2) * (rowsAcross > 1 ? across / (rowsAcross - 1) : .5)) * side
          const [ox, oz] = corridor.at(s, d)
          trees.push({ x: ox, z: oz, scale: .34, color: (across + along) % 2 ? 0x5a6f47 : 0x63764c })
        }
      }
    } else if (field.use === 'wood') {
      // Enough canopy to close over: a copse with a dozen trees scattered on a
      // dark patch of ground reads as a dark patch of ground.
      const canopy = Math.round(Math.min(30, (field.to - field.from) * (field.far - field.near) * .9))
      for (let tree = 0; tree < canopy; tree += 1) {
        const s = field.from + .5 + hashUnit(field.seed + tree * 19) * Math.max(.2, field.to - field.from - 1)
        const d = (field.near + .5 + hashUnit(field.seed + tree * 31) * Math.max(.2, field.far - field.near - 1)) * side
        const [wx, wz] = corridor.at(s, d)
        trees.push({ x: wx, z: wz, scale: .62 + hashUnit(field.seed + tree * 7) * .34, color: tree % 3 ? 0x3f5236 : 0x475b3c })
      }
    } else if (field.use === 'allotment') {
      // Rented strips: narrow, individually worked, and each with its shed.
      const strips = 7
      for (let strip = 0; strip < strips; strip += 1) {
        const from = field.from + (field.to - field.from) * (strip / strips) + .06
        const to = field.from + (field.to - field.from) * ((strip + 1) / strips) - .06
        const plot = mesh(
          corridorPatchGeometry(corridor, from, to, (field.near + .25) * side, (field.far - .25) * side, 2),
          material(strip % 3 === 0 ? 0x6b6247 : strip % 3 === 1 ? 0x5d6a45 : 0x77704f, 1),
        )
        plot.position.y = .04
        plot.castShadow = false
        root.add(plot)
      }
      const [sx, sz] = corridor.at(field.from + .8, (field.far - .5) * side)
      const shed = tagProp(createServiceShed(.4, 0x6b5a45), `allotment-shed-${index}`, .5)
      shed.position.set(sx, .03, sz)
      shed.rotation.y = corridor.facing(field.from + .8, side)
      root.add(shed)
    } else if (field.use === 'stubble' && field.to - field.from > 3.2) {
      // Bales stand in the field that has been cut, never in a standing crop,
      // and they are dropped where the cart can reach them: by the gate end.
      const baleS = field.from + 1.1
      const baleD = (field.near + Math.min(1.1, (field.far - field.near) / 2)) * side
      if (claimAt(baleS, baleD, .8)) {
        const [hx, hz] = corridor.at(baleS, baleD)
        const bales = tagProp(createHayBales(.52), `bales-${index}`, .58)
        bales.position.set(hx, .03, hz)
        bales.rotation.y = corridor.facing(baleS, side) + .3
        root.add(bales)
      }
    } else if (grazed && field.far - field.near > 1.5) {
      const troughS = field.from + .95
      const troughD = (field.near + Math.min(.9, (field.far - field.near) / 2)) * side
      if (claimAt(troughS, troughD, .75)) {
        const [trX, trZ] = corridor.at(troughS, troughD)
        const trough = tagProp(createWaterTrough(.9), `trough-${index}`, .58)
        trough.position.set(trX, .03, trZ)
        trough.rotation.y = corridor.facing(troughS, side)
        root.add(trough)
      }
      if (field.to - field.from > 3.6 && claimAt(middle + .6, midD, 1.3)) {
        const [fx, fz] = corridor.at(middle + .6, midD)
        const flock = tagProp(createGrazingFlock(field.seed, 5, .78), `flock-${index}`, 1.1)
        flock.position.set(fx, .03, fz)
        root.add(flock)
      }
    }

    // A gate onto the road in the roadside boundary of every field that has
    // one, because a field a farmer cannot get into is not a field.
    if (field.row === 0 && !inVoid(middle, side, .4) && !onFord(middle) && field.use !== 'wood') {
      const gateS = field.from + (field.to - field.from) * (.24 + hashUnit(field.seed + 11) * .3)
      const clear = !crossStreets.some((street) => street.side === side && Math.abs(street.s - gateS) < 1.5)
      if (clear && claimAt(gateS, 1.74 * side, 1.05)) {
        const [gx, gz] = corridor.at(gateS, 1.74 * side)
        const [tx, tz] = corridor.tangent(gateS)
        const gate = tagProp(createFieldGate(.4), `field-gate-${index}`, .9)
        gate.position.set(gx, .03, gz)
        gate.rotation.y = Math.atan2(tx, tz) + Math.PI / 2
        root.add(gate)
      }
    }
  })

  /* --- The road's own edge ------------------------------------------------ */
  // Mown verge the whole length of both sides, then ditch and hedge where the
  // road runs through fields and kerb and footway where it runs through a
  // village. The transition between the two is what a settlement edge is.
  for (const side of [-1, 1] as const) {
    const verge = mesh(corridorPatchGeometry(corridor, 0, corridor.length, .96 * side, 1.62 * side, 60), vergeMaterial)
    verge.position.y = .026
    verge.castShadow = false
    verge.receiveShadow = true
    root.add(verge)
  }

  const edgeBlocked = (s: number, side: 1 | -1) => (
    crossStreets.some((street) => street.side === side && Math.abs(street.s - s) < .95)
    || inVoid(s, side, .3)
    || onFord(s, .2)
    || onReserved(s, side, 1.8)
  )
  for (const side of [-1, 1] as const) {
    let runFrom: number | null = null
    const step = .35
    for (let s = 0; s <= corridor.length + step; s += step) {
      const open = s <= corridor.length && !edgeBlocked(s, side)
      if (open && runFrom === null) runFrom = s
      if (!open && runFrom !== null) {
        const from = runFrom
        const to = s - step
        runFrom = null
        if (to - from < .8) continue
        const built = village((from + to) / 2) > .55
        if (built) {
          const footway = mesh(corridorPatchGeometry(corridor, from, to, VILLAGE_FOOTWAY_IN * side, VILLAGE_FOOTWAY_OUT * side, Math.max(2, Math.round((to - from) / .8))), material(0x8d8778, .97))
          footway.position.y = .062
          footway.castShadow = false
          root.add(footway)
          corridorBoundary(root, corridor, from, to, 1.02 * side, { material: material(0x726b5c, .9), height: .07, thickness: .1, step: 1.4, y: .04 })
        } else {
          const ditch = mesh(corridorPatchGeometry(corridor, from, to, 1.2 * side, 1.44 * side, Math.max(2, Math.round((to - from) / .9))), ditchMaterial)
          ditch.position.y = .012
          ditch.castShadow = false
          root.add(ditch)
          corridorBoundary(root, corridor, from, to, 1.74 * side, { material: hedgeMaterial, height: .38, thickness: .19, step: 1.1, y: .03 })
          for (let s2 = from + 1.2; s2 < to - .6; s2 += 1.9 + hashUnit(s2 * 3.1) * 2.1) {
            const [tx, tz] = corridor.at(s2, 1.86 * side)
            trees.push({ x: tx, z: tz, scale: .5 + hashUnit(s2 * 7.7 + (side > 0 ? 3 : 0)) * .26, color: hashUnit(s2 * 5.1) > .5 ? 0x45583c : 0x4f6146 })
          }
        }
      }
    }
    // Pavement in the villages is where the few people out here actually walk.
    //
    // Deliberately still handed over with no `halfWidth`, so it inherits
    // `CROWD_FOOTWAY_HALF`, even though the paving laid above is only .61
    // across and .65 either side of this line is nearly twice that. Declaring
    // the paved figure here is the obvious repair and it measured worse:
    // .5203 -> .5287 walkers-in-any-solid over 900 frames, because the cut
    // reads `halfWidth` too, a narrower way puts both its kerbs inside the
    // frontage that lines it, and the village lanes were then cut back until
    // the crowd redistributed onto the planned-street pavements that run past
    // the farmsteads. The width these people actually get is decided by
    // `cutFootwaysAroundSolids`, against what is standing there.
    townS.forEach((centre) => {
      const from = Math.max(.6, centre - 3.2)
      const to = Math.min(corridor.length - .6, centre + 3.2)
      const points: XZ[] = []
      for (let step2 = 0; step2 <= 8; step2 += 1) {
        points.push(corridor.at(from + (to - from) * (step2 / 8), VILLAGE_FOOTWAY_MID * side))
      }
      footWays(root).push({ points })
    })
  }

  /* --- The brook, the ford and the bridge --------------------------------- */
  const [fordX, fordZ] = corridor.at(sFord, 0)
  const [fordTx, fordTz] = corridor.tangent(sFord)
  const brook = curveFrom([
    [fordX - 2.1, -13.4], [fordX - 1.4, -8.6], [fordX - .7, -3.4],
    [fordX, fordZ], [fordX + .5, fordZ + 2.6], [fordX + 1.1, fordZ + 6.4], [fordX + 1.8, 14],
  ], .05)
  // A brook off the fell: narrow, quick, and visibly running the way the river
  // it feeds does. Its own bed comes from `addWatercourse`, so the hand-laid
  // bank ribbon this used to carry is gone with it.
  addWatercourse(root, brook, {
    width: .58,
    color: 0x4c7f83,
    taper: .26,
    flow: 1.05,
    amplitude: .014,
    bedColor: 0x6b6a50,
    segments: 90,
  })

  const bridgeRotation = Math.atan2(fordTx, fordTz) + Math.PI / 2
  // The soffit has to clear the crest. Water at .045 with this ripple tops out
  // near .06, so a deck spanning .07 to .27 passes over it; at the authored .12
  // the underside was at .02 and the brook ran through the middle of the stone.
  const deck = box([2.5, .2, 2.35], stoneMaterial, [fordX, .17, fordZ])
  deck.rotation.y = bridgeRotation
  root.add(deck)
  for (const side of [-1, 1] as const) {
    const [px, pz] = corridor.at(sFord, 1.12 * side)
    const parapet = box([2.55, .38, .2], material(0x8f8779, .96), [px, .38, pz])
    parapet.rotation.y = bridgeRotation
    root.add(parapet)
  }
  if (claimAt(sFord - 2.3, 1.5, .55)) {
    const milestone = tagProp(createMilestone(1), 'ford-milestone', .24)
    const [msX, msZ] = corridor.at(sFord - 2.3, 1.5)
    milestone.position.set(msX, .03, msZ)
    milestone.rotation.y = corridor.facing(sFord - 2.3, 1)
    root.add(milestone)
  }
  registerLandmark(root, {
    key: 'nation-ford', name: 'Marlow Ford', kind: 'water',
    detail: 'The crossing the town is named for. The county replaced the ford with two arches of stone and has argued about the upkeep ever since.',
    position: [fordX, fordZ], radius: 2.2,
  })

  /* --- Greens, ponds and the fair ----------------------------------------- */
  voids.forEach((hole, index) => {
    const setback = setbackAt(hole.s)
    const [cx, cz] = corridor.at(hole.s, (setback + hole.depth / 2) * hole.side)
    const [tx, tz] = corridor.tangent(hole.s)
    const rotation = -Math.atan2(tz, tx)
    if (index === 0) {
      // The mill pond the brook widens into below the ford, with reeds on the
      // bank the road does not run along.
      const pond = mesh(new THREE.CircleGeometry(1.55, 22), material(0x476f74, .32, .06), [cx + .3, .05, cz])
      pond.rotation.x = -Math.PI / 2
      pond.scale.set(1, .74, 1)
      pond.castShadow = false
      root.add(pond)
      for (let reed = 0; reed < 3; reed += 1) {
        const angle = 2.1 + reed * 1.05
        const marsh = tagProp(createMarshPatch(310 + reed, .46), `pond-reeds-${reed}`, .44)
        marsh.position.set(cx + .3 + Math.cos(angle) * 1.75, .03, cz + Math.sin(angle) * 1.35)
        root.add(marsh)
      }
      trees.push(
        { x: cx - 1.9, z: cz + .7, scale: .74, color: 0x445938 },
        { x: cx + 2.2, z: cz - .5, scale: .66, color: 0x4d6042 },
      )
      registerLandmark(root, {
        key: 'nation-pond', name: 'Marlow Mill Pond', kind: 'water',
        detail: 'Fed by the brook above the ford. The mill leat and the fishing rights on it are the oldest live dispute on the circuit.',
        position: [cx, cz], radius: 2,
      })
      return
    }
    if (index === 1) {
      // Fenwick's green: the church at its head, benches facing in, and the
      // market cross the whole village is measured from.
      addBlockInterior(root, { x: cx, z: cz, width: hole.length, depth: hole.depth, rotation }, 0x5d6f49, .046)
      const crossS = hole.s + 1.5
      const [mx, mz] = corridor.at(crossS, (setback + hole.depth - .35) * hole.side)
      const cross = tagProp(createMarketCross(.82, definition.stone), 'market-cross', .8)
      cross.position.set(mx, .05, mz)
      root.add(cross)
      claims.push({ x: mx, z: mz, radius: 1 })
      ;[1.05, 2.75].forEach((offset, benchIndex) => {
        const benchS = hole.s + offset
        if (!claimAt(benchS, (setback + .45) * hole.side, .55)) return
        const [bx, bz] = corridor.at(benchS, (setback + .45) * hole.side)
        const bench = tagProp(createBench(.72), `green-bench-${benchIndex}`, .48)
        bench.position.set(bx, .05, bz)
        // Facing the green, which means facing away from the carriageway.
        bench.rotation.y = corridor.facing(benchS, hole.side) + Math.PI
        root.add(bench)
      })
      const church = createVillageChurch(.92, definition.stone)
      church.position.set(churchX, .04, churchZ)
      // The tower end on the road and the chancel running back off it, so the
      // church takes a narrow frontage on a wide plot the way a village church
      // on a green actually does.
      church.rotation.y = corridor.facing(churchS, hole.side) + Math.PI / 2
      root.add(church)
      // The churchyard wall encloses the church, so the two are one thing as
      // far as the overlap audit is concerned rather than two props fighting
      // over the same ground.
      church.add(createChurchyard(770, .66))
      tagProp(church, 'church', 2)
      for (const offset of [-1.6, 1.5]) {
        const [yx, yz] = corridor.at(churchS + offset, churchD + 1.9 * hole.side)
        trees.push({ x: yx, z: yz, scale: .74, color: offset < 0 ? 0x3f5335 : 0x475a3d })
      }
      registerLandmark(root, {
        key: 'nation-green', name: 'Fenwick Green', kind: 'green',
        detail: 'The green, the cross and St Ailred\u2019s. The village is measured from the cross and every notice on the circuit is still posted on it.',
        position: [cx, cz], radius: 2.8,
      })
      return
    }
    // Ashgate's fair green: three stalls in a row facing the road, and the
    // hard standing they are pitched on.
    addBlockInterior(root, { x: cx, z: cz, width: hole.length, depth: hole.depth, rotation }, 0x7d7a5f, .046)
    for (let stall = 0; stall < 3; stall += 1) {
      const stallS = hole.s - 1.7 + stall * 1.7
      const [sx, sz] = corridor.at(stallS, (setback + 1.2) * hole.side)
      const market = tagProp(createMarketStall(stall + 2), `fair-stall-${stall}`, .68)
      market.position.set(sx, .06, sz)
      market.rotation.y = corridor.facing(stallS, hole.side) + Math.PI
      root.add(market)
      claims.push({ x: sx, z: sz, radius: .85 })
    }
    const wagonS = hole.s + 1.9
    const wagonD = (setback + hole.depth - .4) * hole.side
    if (claimAt(wagonS, wagonD, .95)) {
      const [wx, wz] = corridor.at(wagonS, wagonD)
      const wagon = tagProp(createFarmImplement(511, .95), 'fair-implement', .8)
      wagon.position.set(wx, .04, wz)
      wagon.rotation.y = corridor.facing(wagonS, hole.side) + .5
      root.add(wagon)
    }
    registerLandmark(root, {
      key: 'nation-fair', name: 'Ashgate Fair Green', kind: 'market',
      detail: 'Chartered in the reign before last and still held twice a year. Half the village\u2019s contracts are struck standing on it.',
      position: [cx, cz], radius: 2.4,
    })
  })

  /* --- Farmsteads, on their own tracks off the road ----------------------- */
  farmSites.forEach((site, index) => {
    const { yardD } = site
    // The track first: a farmstead is a thing at the end of a track off the
    // road, and without the track it is a barn standing in a field.
    const trackPoints: XZ[] = []
    for (let step = 0; step <= 4; step += 1) {
      const along = 1.5 + (yardD - 1.5) * (step / 4)
      trackPoints.push(corridor.at(site.s + (step / 4) * .9, along * site.side))
    }
    const track = mesh(ribbonGeometry(curveFrom(trackPoints, .055), .32, 12), trackMaterial)
    track.castShadow = false
    root.add(track)
    const yard = mesh(corridorPatchGeometry(corridor, site.s - .9, site.s + 1.7, (yardD - 1.15) * site.side, (yardD + 1.15) * site.side, 3), material(0x8c8570, 1))
    yard.position.y = .034
    yard.castShadow = false
    root.add(yard)
    const facing = corridor.facing(site.s + .4, site.side)
    // Barn, yard rail and implement are one group, so the audit treats the
    // farmstead as the single working unit it is rather than as three props
    // that keep being reported for standing next to each other.
    const farmstead = createFarmstead(.66)
    farmstead.position.set(site.x, .04, site.z)
    farmstead.rotation.y = facing + Math.PI / 2
    /*
     * The rails go round the yard the barn stands in, which is the ground the
     * patch above just paved: `yardD ± 1.15`, and the pen is 2.3 deep. So the
     * pen belongs at the group's origin.
     *
     * It used to be offset `1.55 * site.side`, and that `site.side` was the
     * fault. `facing` already turns with the side, so the group's local +x is
     * the corridor's outward normal on whichever side the farm is — multiplying
     * by the side again cancels that, and the yard is thrown a yard and a half
     * to the same absolute side of the barn either way. On the north side that
     * is towards the road: farmstead-0's south rail stood .63 inside the
     * turnpike's near lane, and it is a rail at .84, so a walker on the
     * pavement was inside it rather than beside it. That is the 66-frame
     * `nation-farmstead-0` site, and the walker was dead centre of it because
     * the pavement runs the length of the fence. On the south side it went the
     * other way and put farmstead-1's rails across the back lane.
     */
    const pen = createFieldPen(3.1, 2.3, site.side)
    pen.position.set(0, -.01, -.4 * site.side)
    pen.rotation.y = -Math.PI / 2
    farmstead.add(pen)
    const implement = createFarmImplement(site.seed, .82)
    // In the yard, in the corner away from the road, for the same reason.
    implement.position.set(.6, -.01, .95)
    implement.rotation.y = .8
    farmstead.add(implement)
    tagProp(farmstead, `farmstead-${index}`, 1.5)
    root.add(farmstead)
    if (claimAt(site.s, 1.72 * site.side, 1.05)) {
      const [gx, gz] = corridor.at(site.s, 1.72 * site.side)
      const [tx, tz] = corridor.tangent(site.s)
      const gate = tagProp(createFieldGate(.4), `farm-gate-${index}`, .9)
      gate.position.set(gx, .03, gz)
      gate.rotation.y = Math.atan2(tx, tz) + Math.PI / 2
      root.add(gate)
    }
    if (index === 0) {
      registerLandmark(root, {
        key: 'nation-farm', name: 'Ellery Farms', kind: 'green',
        detail: 'Enclosure-era strip fields still worked under the original hedgerows, and the track that serves them. Boundary disputes are a circuit staple.',
        position: [site.x, site.z], radius: 2.6,
      })
    }
  })

  /* --- Where each village begins ------------------------------------------ */
  townS.forEach((centre, index) => {
    for (const direction of [-1, 1]) {
      const s = centre + direction * 3.6
      if (s < 1 || s > corridor.length - 1) continue
      const side: 1 | -1 = direction > 0 ? 1 : -1
      if (onReserved(s, side, 1.6) || onFord(s)) continue
      if (!claimAt(s, 1.5 * side, .6)) continue
      const [mx, mz] = corridor.at(s, 1.5 * side)
      const stone = tagProp(createMilestone(.95), `milestone-${index}-${direction > 0 ? 'e' : 'w'}`, .24)
      stone.position.set(mx, .03, mz)
      stone.rotation.y = corridor.facing(s, side)
      root.add(stone)
    }
  })

  /* --- The turnpike beyond the district ----------------------------------- */
  for (const [tail, joinAtStart] of [[westApproach, false], [eastApproach, true]] as Array<[XZ[], boolean]>) {
    const anchor = corridor.at(joinAtStart ? corridor.length : 0, 0)
    const curve = curveFrom(joinAtStart ? [anchor, ...tail] : [...tail, anchor], .09)
    const verge = mesh(ribbonGeometry(curve, 1.92, 40), material(0x6d6b5e, .98))
    verge.position.y = .018
    verge.castShadow = false
    root.add(verge)
    const road = mesh(ribbonGeometry(curve, 1.48, 40), material(0x3b403e, .92))
    road.position.y = .065
    road.castShadow = false
    root.add(road)
    const centreLine = mesh(ribbonGeometry(curve, .065, 40), material(0xd3bd78, .48, .2))
    centreLine.position.y = .105
    centreLine.castShadow = false
    root.add(centreLine)
  }

  addTreeField(root, trees)
  registerLandmark(root, {
    key: 'nation-turnpike', name: 'The Fenwick Turnpike', kind: 'transit',
    detail: 'One road, three benches, and every filing in the county travelling along it. The circuit takes its name from the road, not the other way round.',
    position: [corridor.at(corridor.length * .5)[0], corridor.at(corridor.length * .5)[1]], radius: 2.6,
  })
}

function addNationEnvironment(root: THREE.Group, definition: ArcDefinition, route: THREE.Curve<THREE.Vector3>) {
  const trees: TreeRecord[] = []
  const reserved = circuitReservedSites(route)

  // A settlement hierarchy, not three interchangeable clusters: one county
  // seat with the circuit bench, one market town, one village. Density,
  // number of radial lanes and square size all scale with rank. Each town's
  // southern lane is given exactly the length that lands it on the turnpike's
  // centreline, so the two roads meet at a junction instead of the lane
  // stopping in a field a metre short of the traffic it is meant to join.
  const towns: TownPlan[] = CIRCUIT_TOWNS.map((town) => ({
    ...town,
    southReach: routeZAtX(route, town.x) - town.z - 1.75 * town.size,
    northReach: Math.abs(-17.6 - town.z) - 1.75 * town.size,
  }))
  towns.forEach((town) => addCircuitTown(root, trees, town, definition, reserved))

  // The road behind the towns, linking the three northern lanes to each other.
  // Without it each lane ends in a row of three identical stubs on the same
  // line of z, which is both an implausible parish and — because a degree-one
  // node is a spawn portal — three places in clear view where a car can fade
  // out. Joined up, the only way on or off The Circuit is the turnpike, thirty
  // metres out on either side and well behind the fog.
  const backRoad = curveFrom([[-10, -17.6], [-5.2, -18], [0, -17.6], [5.4, -17.2], [10, -17.6]], .06)
  const backRoadVerge = mesh(ribbonGeometry(backRoad, .82, 30), material(0x6f7a5e, .99))
  backRoadVerge.position.y = -.01
  backRoadVerge.castShadow = false
  root.add(backRoadVerge)
  const backRoadSurface = mesh(ribbonGeometry(backRoad, .5, 30), material(0x3f4441, .93))
  backRoadSurface.castShadow = false
  root.add(backRoadSurface)
  recordCurveWay(root, backRoad, { speed: 1.1, samples: 22, width: .5 })

  // The river runs behind the settled band, as rivers usually decide where a
  // road corridor can go rather than crossing it repeatedly. The brook that
  // feeds it does cross the road, at Marlow's ford; see `addNationCorridor`.
  const river = curveFrom([[-20, -14.2], [-12, -12.4], [-4, -14.4], [4, -12.2], [12, -14], [20, -12.3]], .05)
  // A lowland river: it meanders in section as well as in plan, so the channel
  // narrows and widens along its length rather than running as a constant-width
  // strip. The old ribbon's silhouette against the grass sawtoothed, because the
  // vertical displacement ran right out to the water's edge; it is now damped to
  // nothing at the bank, so the outline is the channel's and holds still.
  addWatercourse(root, river, {
    width: 1.35,
    color: 0x4a7e82,
    taper: .3,
    flow: .78,
    amplitude: .026,
    bedColor: 0x6b6a50,
    segments: 140,
  })
  for (const town of towns) {
    // Deck raised for the same reason as Marlow's: the crest reaches .071 and
    // the underside of a deck centred at .14 was at .04, so each town's bridge
    // had the river passing through it rather than under it.
    const bridge = box([1.6, .2, 2.6], material(0x7a766d, .95), [town.x, .19, -13.3])
    root.add(bridge)
  }

  // Worked land beyond the corridor's own field system: the water meadows past
  // the river and the big arable beyond the railway, both far enough out that
  // they read as the next parish rather than as this one's back gardens.
  const exclusions = towns.map((town) => ({ x: town.x, z: town.z, radius: 5.4 + town.size * 3.2 }))
  addFieldSystem(root, trees, {
    bands: [
      // Pushed back off the road behind the towns rather than centred on where
      // it runs: a field band and a carriageway sharing a line of z is the
      // "landscape generated first, road laid over it" mistake in miniature.
      // The strip left between the back road and the river is the floodplain,
      // which is grazed rather than ploughed and so is left as grass.
      { z: -20.1, depth: 2.9, from: -30, to: 30 },
      { z: -11.2, depth: 3.4, from: -30, to: 30 },
      // The parish does not stop at the back lane. These four fill the ground
      // outside each end of the ring, where the corridor's own field system has
      // run out of road to be measured from.
      { z: -2.2, depth: 4.6, from: -31, to: -16.6 },
      { z: -2.2, depth: 4.6, from: 16.6, to: 31 },
      { z: 4.6, depth: 5.2, from: -31, to: -16.6 },
      { z: 4.6, depth: 5.2, from: 16.6, to: 31 },
      { z: 13.8, depth: 4, from: -32, to: 32 },
      { z: 19.2, depth: 5, from: -32, to: 32 },
      { z: 25, depth: 5, from: -32, to: 32 },
    ],
    exclude: [...exclusions, { x: 0, z: 11.6, radius: 7 }],
    seed: 7700,
    // The same crops the corridor's own fields are under, so the parish reads
    // as one worked landscape rather than as a planned bit and a backdrop.
    palette: [CIRCUIT_CROP.wheat, CIRCUIT_CROP.stubble, CIRCUIT_CROP.pasture, CIRCUIT_CROP.plough, CIRCUIT_CROP.meadow, CIRCUIT_CROP.roots],
    hedge: 0x4b5b43,
  })

  // Station village: a rail halt generates its own small settlement, sited on
  // the line rather than on the town square.
  const station = createRailPlatform(.78)
  station.position.set(0, .02, 6.95)
  root.add(station)
  transitStops(root).push([0, 6.95])
  const stationRow: BlockRect = { x: 0, z: 11.6, width: 15, depth: 2.6, rotation: 0, frontage: 'collector', row: 0, column: 0, seed: 5150 }
  renderPlannedBuildings(root, 'nation', developBlock(stationRow, {
    seed: 5150, lotMin: 1.3, lotMax: 2.6, setback: .3, buildingDepth: 1.15, gap: .28,
    storeyHeight: .72, storeysMin: 1.6, storeysMax: 2.8, palette: [0x6f6a5d, 0x7c7263, 0x625f57, 0x847461], roof: 'pitched',
    litChance: .24, edges: ['n'], vacancy: .12,
  }), { cullRadius: 12 })
  registerLandmark(root, { key: 'nation-halt', name: 'Fenwick Halt', kind: 'transit', detail: 'The circuit line. The appellate shuttle reverses here, so the whole corridor is a day trip.', position: [0, 8.2], radius: 2.8 })

  // The station road: the one lane on the southern side that crosses the
  // railway, so the halt is reachable from the turnpike and the back lane
  // beyond it has something joining it other than its own two ends.
  const stationLane = curveFrom([[0, routeZAtX(route, 0)], [0, 3.4], [.35, 6.1], [.35, 8.6], [0, backLaneSouthZ(0)]], .07)
  root.add(mesh(ribbonGeometry(stationLane, .92, 26), material(0x6f7a5e, .99)))
  const stationCarriageway = mesh(ribbonGeometry(stationLane, .54, 26), material(0x3f4441, .93))
  stationCarriageway.position.y = .012
  stationCarriageway.castShadow = false
  root.add(stationCarriageway)
  recordCurveWay(root, stationLane, { speed: 1, samples: 14, width: .54 })
  recordCurveFootways(root, stationLane, .58, false, 12, { halfWidth: .15, weight: .5 })
  // The level crossing where it meets the line.
  for (const side of [-1, 1]) {
    const gate = box([.09, .5, 1.05], material(0xb7aa8c, .92), [side * .62, .27, circuitRailZ(0)])
    gate.castShadow = false
    root.add(gate)
  }

  for (const [x, z, scale] of [[-19, -21, 2.1], [-12, -22.5, 1.75], [-4, -21.5, 1.95], [5, -22.4, 1.85], [13, -21.2, 2.2], [20, -22, 1.8]] as Array<[number, number, number]>) {
    const mountain = createMountain(scale, 0x6e6758, scale > 1.9)
    mountain.position.set(x, 0, z)
    root.add(mountain)
  }

  // The back lane: one closed ring around the whole corridor. It is what every
  // side lane out of the corridor runs to, which is the difference between
  // those lanes being junctions and being dead-end stubs, and through traffic
  // circulates on it continuously instead of being teleported back to a start.
  const backLane = closedCircuit(CIRCUIT_BACK_LANE, .08)
  root.add(mesh(ribbonGeometry(backLane, .84, 190), material(0x3e4442, .93)))
  // Sampled densely because it is the one curve in the region long enough for
  // a straight-line graph to visibly leave the tarmac. Slower than the city's
  // arterials: this is a two-lane country road, not a boulevard.
  recordCurveWay(root, backLane, { closed: true, speed: 1.95, samples: 84, width: .84 })

  addTreeField(root, trees)
}

/**
 * How close a train has to be to a level crossing for the road to be held.
 *
 * Half a train length plus a street width plus the distance a car covers while
 * it stops. Erring long costs a few seconds of a car waiting at a clear
 * crossing, which is what happens at a real one; erring short costs a collision.
 */
const LEVEL_CROSSING_GATE = 3.4
/**
 * The Treaty Sea: open water, one vessel, and the three islands the career
 * itself stands on.
 *
 * This region used to be a harbour — five quay islands with warehouses, cranes,
 * cargo and bollards, five more carrying lighthouses and planting, seven outer
 * islands with villages and jetties, an embassy, thirty-two channel buoys and a
 * fleet of nine boats. None of it was doing the work a district's furniture is
 * supposed to do, because there is no ground out here to stand on and nothing
 * for a quay to serve: what the player actually sees from a sea district is
 * water, weather, and whatever is moving on it. Everything else was scenery
 * competing with the one thing worth looking at.
 *
 * So the sea is a sea. The swell and the vessel's Kelvin wake are in
 * `map-water`, and the only thing built here is the route the vessel runs.
 *
 * A standing circuit rather than a channel with portals at either end. The
 * channel version was the honest model of a working harbour — come in from
 * somewhere, tie up, leave again — but with one boat and no harbour left for it
 * to call at, all it produced was a vessel that crossed the bay and then was
 * not there for a while, which is precisely the appearing and vanishing this
 * region was asked to stop doing. A closed lane has no ends to leave by, so the
 * boat is simply always out there. It is set wide of the career route and of
 * all three island parcels, so the swimmer's line and the vessel's never meet.
 */
function addOceanEnvironment(root: THREE.Group) {
  // Sampled rather than listed so the turns are genuinely circular: a boat
  // rounding a hand-placed corner cuts a visible angle in its own wake.
  // Sized to clear everything the region keeps. The furthest of those is the
  // rival compound at z=8.6 and the career route's own ends at x=±15, so the
  // lane stands about three units off the first and seven off the second.
  const CIRCUIT_X = 22.5
  const CIRCUIT_Z = 13.5
  const passage: XZ[] = []
  for (let step = 0; step < 40; step += 1) {
    const angle = step / 40 * Math.PI * 2
    passage.push([Math.cos(angle) * CIRCUIT_X, Math.sin(angle) * CIRCUIT_Z])
  }
  // Slow. A launch at road speed reads as a jet ski, and the wake shader's
  // strength saturates at .97 units per second anyway.
  roadWays(root).push({ points: passage, closed: true, kind: 'water', speed: 1.05 })
}

/**
 * The Sovereign Arc is planned as a Beaux-Arts capital, because that is the
 * vocabulary a monumental civic district actually uses:
 *
 *  - a ceremonial axis (the career route) terminated at both ends and kept
 *    free of building, with formal parterres flanking it;
 *  - a rond-point at the crossing, from which radial avenues leave at fixed
 *    angles, mirrored exactly about both axes;
 *  - perimeter blocks in the sectors between radials, all held to a single
 *    cornice height — the uniform skyline of a Haussmann-planned core is the
 *    whole point, and is what distinguishes a capital from a downtown;
 *  - a ring boulevard enclosing the core, on the line of the former walls;
 *  - and a commercial tower cluster pushed *outside* the ring, so height is
 *    zoned away from the monuments rather than sprinkled among them.
 */
function addContinentEnvironment(root: THREE.Group, route: THREE.Curve<THREE.Vector3>) {
  // The two headquarters sites are placed by the shared tier loop using these
  // exact constants (t=.12/.88, side -1/+1, setback 3.05). Instanced rows
  // cannot be cleared after the fact, so their positions are re-derived here.
  const reserved: ReservedSite[] = [.12, .88].map((t, index) => {
    const roadPoint = route.getPointAt(t)
    const tangent = route.getTangentAt(t).normalize()
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(index === 0 ? -1 : 1)
    const site = roadPoint.clone().add(side.multiplyScalar(3.05))
    return { x: site.x, z: site.z, radius: 4 }
  })
  reserved.push({ x: -13, z: -7, radius: 3 }, { x: 13, z: -7, radius: 3 }, { x: 0, z: 5.35, radius: 2.2 })
  // The formal parterres and the two axis monuments are open ground; nothing
  // from the block lattice may be built over them.
  for (const [x, z] of [[-6.6, -3.5], [6.6, -3.5], [-6.6, 3.3], [6.6, 3.3]] as XZ[]) reserved.push({ x, z, radius: 2.5 })
  reserved.push({ x: 0, z: -9.4, radius: 3.2 }, { x: 0, z: 7.15, radius: 2.4 })
  // The parterre circles above only cover their own centres; a sector block
  // whose ring happens to land between the rond-point and a parterre could
  // still land right on the ceremonial axis itself. A short run of extra
  // circles closes that gap on both sides of both parterres, so the axis the
  // career route actually walks stays open ground for its whole width.
  for (const sign of [-1, 1]) for (const step of [4.7, 5.6]) {
    reserved.push({ x: sign * step, z: 0, radius: 1.6 })
  }

  const stone = [0x9a9082, 0x8f8672, 0xa1978a, 0x877e6d, 0x968b78]
  const buildings: PlannedBuilding[] = []
  const trees: TreeRecord[] = []

  // The rond-point at the crossing of the two axes.
  const plaza = cylinder(4.15, .07, material(0x7d8078, .96), [0, .035, -.1], 72)
  plaza.scale.z = .78
  root.add(plaza)
  const garden = cylinder(2.62, .08, material(0x56684e, 1), [0, .09, -.1], 64)
  garden.scale.z = .72
  root.add(garden)
  for (const [x, z] of [[-2.05, -1.15], [2.05, -1.15], [-2.05, .95], [2.05, .95]] as XZ[]) trees.push({ x, z, scale: .5, color: 0x3f5948, y: .1 })
  // Two fountains flanking the ceremonial axis on the cross axis, rather than
  // one basin sitting in the middle of it. With the route now running dead
  // straight through the crossing — as a ceremonial axis must — a centred
  // monument is something the road goes through, and a monument nudged just
  // far enough off centre to avoid that is neither centred nor deliberate. A
  // symmetrical pair is the composition that actually wants a straight axis
  // between it, and it leaves the crossing itself as open paving to walk.
  for (const z of [-2.85, 2.65]) {
    const fountain = createFountain()
    fountain.scale.setScalar(.54)
    fountain.position.set(0, .1, z)
    markSolidProp(fountain, .55)
    root.add(fountain)
  }
  registerLandmark(root, { key: 'continent-rondpoint', name: 'Concord Rond-Point', kind: 'monument', detail: 'The crossing of the ceremonial axis and the cross axis. Six avenues leave from this circle.', position: [0, -.1], radius: 4 })

  // Radial avenues, mirrored about both axes. 0 and 180 degrees are omitted:
  // that is the ceremonial axis itself, which stays a pedestrian route.
  const radials = [45, 90, 135, 225, 270, 315].map((degrees) => degrees * Math.PI / 180)
  radials.forEach((angle) => {
    const avenue = new THREE.LineCurve3(
      new THREE.Vector3(Math.cos(angle) * 4.1, .07, Math.sin(angle) * 4.1 - .1),
      new THREE.Vector3(Math.cos(angle) * 19, .07, Math.sin(angle) * 19 - .1),
    )
    root.add(roadMesh(avenue, .92, 0x384447))
    // The radials are what make the Arc a network rather than two unconnected
    // rings: each one crosses both, so a car can leave the boulevard, cross the
    // core and go out the other side. Their outer ends sit beyond the ring
    // road, which makes them the region's spawn and despawn portals.
    recordCurveWay(root, avenue, { speed: 1.9, samples: 26, portal: true, width: .92 })
    recordCurveFootways(root, avenue, .74, false, 20, { halfWidth: .17, weight: .8 })
    for (let step = 1; step <= 6; step += 1) {
      const distance = 4.6 + step * 2.2
      for (const side of [-1, 1]) {
        trees.push({
          x: Math.cos(angle) * distance - Math.sin(angle) * side * .95,
          z: Math.sin(angle) * distance + Math.cos(angle) * side * .95 - .1,
          scale: .52,
          color: side < 0 ? 0x40594d : 0x476050,
        })
      }
    }
  })

  // The street walls of the monumental core.
  //
  // These used to be twenty-four free-standing rectangular blocks, one per
  // sector per ring, each rotated to its own angle — which in plan is twenty-
  // four separate clusters with grass between them, on the one map where the
  // buildings are supposed to be a single continuous cornice. They are now
  // continuous crescents cut by arc length along four ring streets, with a
  // window left wherever a radial avenue crosses, so each ring reads as one
  // facade with avenues punched through it. Every band has a street on its
  // inner face and a street on its outer face, and is built on both.
  //
  // A radial leaves at a true polar angle, but a point on a .78 ellipse is
  // parameterised by a different angle, so the junction windows have to be
  // converted or every avenue would arrive at a building instead of a gap.
  const toParameter = (polar: number) => {
    const t = Math.atan2(Math.sin(polar) / .78, Math.cos(polar))
    return (t + Math.PI * 2) % (Math.PI * 2)
  }
  const coreWindows: Array<[number, number]> = []
  // Every radial, plus the ceremonial axis at 0 and 180, which nothing crosses.
  for (const polar of [...radials, 0, Math.PI]) {
    const centre = toParameter(polar)
    const half = .17
    if (centre - half < 0) {
      coreWindows.push([0, centre + half], [Math.PI * 2 + centre - half, Math.PI * 2])
    } else if (centre + half > Math.PI * 2) {
      coreWindows.push([centre - half, Math.PI * 2], [0, centre + half - Math.PI * 2])
    } else {
      coreWindows.push([centre - half, centre + half])
    }
  }
  coreWindows.sort((a, b) => a[0] - b[0])
  // A crescent that ran unbroken between its avenues would still be a ring,
  // and a ring is what makes a radial plan look stamped rather than built. On
  // top of the avenue windows each face gets its own interruptions — a square
  // let into the frontage, a church forecourt, a market — at angles that
  // differ between rings and between the two faces of the same ring, so no
  // gap in one arc has a counterpart opposite it.
  const faceWindows = (ring: number, side: 1 | -1) => {
    const out = coreWindows.slice()
    const count = 1 + Math.floor(hashUnit(ring * 53 + (side > 0 ? 11 : 29)) * 2)
    for (let index = 0; index < count; index += 1) {
      const seed = ring * 197 + index * 61 + (side > 0 ? 5 : 83)
      const at = hashUnit(seed) * Math.PI * 2
      const width = .07 + hashUnit(seed * 1.7) * .09
      if (at - width < 0 || at + width > Math.PI * 2) continue
      out.push([at - width, at + width])
    }
    return out.sort((a, b) => a[0] - b[0])
  }
  const crescent = (radius: number, side: 1 | -1, ring: number) => ellipseFrontage({
    centre: [0, -.1],
    radius,
    squash: .78,
    side,
    // Even inside one arc the building line steps: a terrace built in three
    // campaigns does not share one setback along its whole length.
    setback: .2 + hashUnit(ring * 31 + (side > 0 ? 3 : 17)) * .16,
    depth: 1.16 + hashUnit(ring * 43 + (side > 0 ? 7 : 23)) * .34,
    lotMin: 1.05 + hashUnit(ring * 13 + (side > 0 ? 2 : 9)) * .35,
    lotMax: 2.05 + hashUnit(ring * 19 + (side > 0 ? 4 : 15)) * .8,
    gap: .04,
    seed: 8200 + ring * 311 + (side > 0 ? 61 : 7),
    storeyHeight: .82,
    // The core holds a cornice line — that is the point of a monumental plan —
    // but not a *single* height: the spread is wide enough that the roofline
    // steps from bay to bay, and corner sites stand a full storey clear.
    storeysMin: 3.9 - ring * .34,
    storeysMax: 5.2 - ring * .38,
    cornerBonus: .95,
    palette: stone,
    roof: 'parapet',
    litChance: .55,
    vacancy: .04,
    arcGaps: faceWindows(ring, side),
  })
  // The three bands sit between the four circulation rings that already exist
  // — the rond-point kerb at 4.1, the two ellipse rings at 8.9 and 13.3, and
  // the wall boulevard at 16.4 — offset by half a carriageway so the frontage
  // lands on the pavement rather than in the road.
  ;([[4.72, 8.28], [9.52, 12.68]] as Array<[number, number]>).forEach(([inner, outer], ring) => {
    buildings.push(...crescent(inner, 1, ring))
    buildings.push(...crescent(outer, -1, ring))
    // The court between the two street walls, which is where a perimeter
    // block puts its garden.
    for (let step = 0; step < 18; step += 1) {
      const angle = (step + .5) / 18 * Math.PI * 2
      if (coreWindows.some(([from, to]) => angle >= from && angle <= to)) continue
      const mid = (inner + outer) / 2
      trees.push({
        x: Math.cos(angle) * mid,
        z: Math.sin(angle) * mid * .78 - .1,
        scale: .4 + hashUnit(ring * 71 + step * 13) * .16,
        color: step % 2 ? 0x415a4a : 0x486152,
      })
    }
  })
  // The outermost band is too shallow between its two streets to take a
  // frontage on both faces, so it is built on the inner ring only and the
  // strip behind it is planted — which is how the last band before a
  // boulevard usually resolves anyway.
  buildings.push(...crescent(13.72, 1, 2))
  for (let step = 0; step < 26; step += 1) {
    const angle = (step + .5) / 26 * Math.PI * 2
    if (coreWindows.some(([from, to]) => angle >= from && angle <= to)) continue
    trees.push({
      x: Math.cos(angle) * 15.7,
      z: Math.sin(angle) * 15.7 * .78 - .1,
      scale: .44 + hashUnit(step * 29 + 5) * .18,
      color: step % 3 ? 0x40594d : 0x496353,
    })
  }

  // Formal parterres flanking the ceremonial axis.
  ;([[-6.6, -3.5], [6.6, -3.5], [-6.6, 3.3], [6.6, 3.3]] as XZ[]).forEach(([x, z], index) => {
    const bed = box([4.1, .06, 2], material(0x53664c, 1), [x, .04, z])
    bed.castShadow = false
    root.add(bed)
    const kerb = box([4.4, .05, 2.3], material(0x8b8878, .97), [x, .028, z])
    kerb.castShadow = false
    root.add(kerb)
    for (let step = 0; step < 4; step += 1) {
      trees.push({ x: x - 1.5 + step, z, scale: .34, color: index % 2 ? 0x3d5645 : 0x44604c, y: .06 })
    }
  })

  // Both ends of the cross axis are terminated by a monument, which is what
  // stops a formal avenue from simply running out of city.
  const assembly = createCourthouse(1.15, 0xa1978a)
  assembly.position.set(0, .04, -9.4)
  root.add(assembly)
  registerLandmark(root, { key: 'continent-assembly', name: 'Sovereign Assembly', kind: 'civic', detail: 'The terminating monument of the north axis. Continental matters are heard behind that colonnade.', position: [0, -9.4], radius: 3.4 })
  const transit = createRailPlatform(.86)
  transit.position.set(0, .02, 7.15)
  root.add(transit)
  transitStops(root).push([0, 7.15])
  registerLandmark(root, { key: 'continent-transit', name: 'Union Terminus', kind: 'transit', detail: 'The south terminus of the cross axis. The continental shuttle turns back here.', position: [0, 7.4], radius: 2.8 })

  // The ring boulevard, on the line of the former walls: one closed circuit,
  // so its traffic never has to jump back to a start point.
  const ringPoints: XZ[] = Array.from({ length: 18 }, (_, index) => {
    const angle = index / 18 * Math.PI * 2
    return [Math.cos(angle) * 16.4, Math.sin(angle) * 12.6 - .1] as XZ
  })
  const ringRoad = closedCircuit(ringPoints, .07)
  root.add(mesh(ribbonGeometry(ringRoad, 1.15, 200), material(0x384447, .93)))
  root.add(mesh(ribbonGeometry(ringRoad, .06, 200), material(0xc7b982, .7, .05)))
  recordCurveWay(root, ringRoad, { closed: true, speed: 2.3, samples: 110, width: 1.15 })
  recordCurveFootways(root, ringRoad, .86, true, 56, { halfWidth: .18, weight: 1 })
  // Two more circulation rings, one either side of the middle block band, so
  // every band of building has a street on both of its faces. All three rings
  // and all three bands are struck on the same .78 ellipse as the plan itself.
  ;([[8.9, .82, 1.35], [13.3, .82, 1.6]] as Array<[number, number, number]>).forEach(([radius, width, speed], index) => {
    const ring = closedCircuit(Array.from({ length: 14 + index * 4 }, (_, step) => {
      const angle = step / (14 + index * 4) * Math.PI * 2
      return [Math.cos(angle) * radius, Math.sin(angle) * radius * .78 - .1] as XZ
    }), .07)
    root.add(mesh(ribbonGeometry(ring, width, 160), material(0x3b474a, .93)))
    recordCurveWay(root, ring, { closed: true, speed, samples: 72 + index * 16, width })
    recordCurveFootways(root, ring, width / 2 + .25, true, 44, { halfWidth: .16, weight: .7 })
  })
  registerLandmark(root, { key: 'continent-ring', name: 'Wall Ring Boulevard', kind: 'transit', detail: 'Laid on the line of the demolished walls. Everything monumental is inside it; everything commercial is not.', position: [0, -12.7], radius: 3 })

  // The river.
  //
  // The Sovereign Arc had no water at all — measured, zero water meshes — which
  // is the reason its river "looked bad": there was nothing there to look at, and
  // the region read as a plan drawn on a table rather than a city on a site.
  //
  // A Beaux-Arts composition of this kind is almost always laid out *from* a
  // river, so this one runs beyond the ring on the south side, clear of the wall
  // line by three units, and the composition now has a reason to face the way it
  // does. It crosses in front of the terminus, where the south radial avenue
  // already runs out to its portal, so the avenue gets the bridge.
  const arcRiver = curveFrom([[-34, 19.6], [-18, 17.4], [-6, 16.4], [6, 16.1], [18, 15.2], [34, 12.9]], .05)
  addWatercourse(root, arcRiver, {
    width: 2.35,
    color: 0x477c85,
    taper: .34,
    flow: .72,
    amplitude: .03,
    bedColor: 0x6a6754,
    segments: 170,
  })
  // The embankments. A capital's river is walled, and the wall is what tells the
  // eye the water is below the level of the city rather than lying on top of it.
  for (const side of [-1, 1]) {
    const wall: XZ[] = []
    for (let index = 0; index <= 34; index += 1) {
      const t = index / 34
      const point = arcRiver.getPointAt(t)
      const tangent = arcRiver.getTangentAt(t).normalize()
      wall.push([point.x - tangent.z * side * 1.32, point.z + tangent.x * side * 1.32])
    }
    const quay = mesh(ribbonGeometry(curveFrom(wall, .04), .46, 90), material(0x8e8676, .96))
    quay.position.y = .1
    root.add(quay)
  }
  // The bridge on the south radial, and the only crossing: a single monumental
  // span is the composition, and it is also the only place a carriageway meets
  // the channel, so it is the only place that needs one.
  const span = box([1.5, .22, 3.4], material(0x968d7c, .95), [0, .21, 16.2])
  root.add(span)
  for (const offset of [-.62, .62]) {
    root.add(box([.16, .3, 3.4], material(0x847c6c, .92), [offset, .35, 16.2]))
  }
  registerLandmark(root, { key: 'continent-river', name: 'The Concord Water', kind: 'water', detail: 'The river the Arc was laid out from. One monumental span carries the south avenue across it; everything else stops at the embankment.', position: [0, 16.2], radius: 3 })

  // The commercial cluster, deliberately outside the ring, where a capital
  // sends its height so the core can keep its cornice line.
  // It is a *quarter*, so it has streets. The previous version was a lattice
  // of free-standing slabs on a fixed column pitch with rotationY: 0 and a
  // random z-jitter — the definition of buildings that front nothing, and the
  // single largest patch of confetti on this map in plan view. It is now a
  // real street grid: three east–west streets and seven north–south ones with
  // jittered spacing, cut into blocks, each block developed as a perimeter
  // block whose towers face the street they stand on.
  const towerPalette = [0x46575c, 0x526166, 0x3d5158, 0x5b6261, 0x4b5a60]
  const quarterAvenues: AxisLine[] = assembleAxis(
    [
      { position: -13.4, streetClass: 'collector' },
      { position: 0, streetClass: 'arterial' },
      { position: 13.4, streetClass: 'collector' },
    ],
    planAxisInterior(-13.4, 13.4, [0], 9401, 3.6),
    1.9,
  )
  const quarterStreets: AxisLine[] = assembleAxis(
    [
      { position: -16.6, streetClass: 'arterial' },
      { position: -27.4, streetClass: 'collector' },
    ],
    planAxisInterior(-27.4, -16.6, [-22.1], 9451, 3.4),
    1.9,
  )
  addPlannedStreets(root, streetsFromGrid(quarterAvenues, quarterStreets), { asphalt: 0x333d40, pavement: 0x84806f })
  const quarterBuildings: PlannedBuilding[] = []
  blocksFromGrid(quarterAvenues, quarterStreets, { seed: 9500 }).forEach((block) => {
    // Height falls away from the ring road, the way a commercial cluster
    // actually thins as it gets further from the thing it is clustered on.
    const proximity = THREE.MathUtils.clamp(1 - (Math.abs(block.z) - 16.6) / 11, 0, 1)
    quarterBuildings.push(...developBlock(block, {
      seed: block.seed,
      lotMin: 1.35, lotMax: 2.4, setback: .22, buildingDepth: 1.35, gap: .1,
      storeyHeight: .84,
      storeysMin: 3.4 + proximity * 2.6,
      storeysMax: 5.2 + proximity * 4.4,
      palette: towerPalette, roof: 'stepped', litChance: .72, cornerBonus: 1.1, vacancy: .08,
    }))
  })
  renderPlannedBuildings(root, 'continent', quarterBuildings, { cullRadius: 46 })
  registerLandmark(root, { key: 'continent-quarter', name: 'North Quarter', kind: 'industry', detail: 'The height-zoned commercial quarter beyond the ring. Every continental firm that is not a monument is here.', position: [0, -19.5], radius: 4 })

  renderPlannedBuildings(root, 'continent', clearReserved(buildings, reserved), { cullRadius: 24 })

  for (const [x, z] of [[-15, -12.5], [-12.6, -13.4], [12.6, -13.2], [15, -12.3]] as XZ[]) {
    const turbine = createWindTurbine(.72)
    turbine.position.set(x, 0, z)
    root.add(turbine)
  }
  const aurora = mesh(
    new THREE.PlaneGeometry(52, 12, 48, 8),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'uniform float uTime; varying vec2 vUv; void main(){vUv=uv;vec3 p=position;p.y+=sin(p.x*.32+uTime*.18)*.7+sin(p.x*.11-uTime*.12)*.45;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
      fragmentShader: 'uniform float uTime; varying vec2 vUv; void main(){float curtain=pow(sin(vUv.x*18.0+uTime*.11)*.5+.5,3.0);float fade=sin(vUv.y*3.14159)*(.18+.22*curtain);vec3 c=mix(vec3(.14,.58,.53),vec3(.35,.47,.78),vUv.x);gl_FragColor=vec4(c,fade);}',
    }),
    [0, 16, -34],
  )
  aurora.userData.auroraUniforms = (aurora.material as THREE.ShaderMaterial).uniforms
  root.add(aurora)

  for (const [x, z] of [[-15, 8.5], [-10, 9], [-5, 8.6], [5, 8.7], [10, 9.1], [15, 8.5]] as XZ[]) {
    const bench = createBench(.68); bench.position.set(x, .02, z); bench.rotation.y = Math.PI; root.add(bench)
  }
  for (let x = -20; x <= 20; x += 2.4) {
    trees.push({ x, z: 9.6 + (hashUnit(x * 13) - .5) * .4, scale: .58, color: 0x4a5f4c })
    trees.push({ x: x + 1.2, z: -13.6 + (hashUnit(x * 7) - .5) * .5, scale: .54, color: 0x415747 })
  }
  addTreeField(root, trees)
}

function addGlobalEnvironment(root: THREE.Group) {
  const platformMaterial = material(0x1f3038, .48, .4)
  const platform = cylinder(34, .42, platformMaterial, [0, -.36, 0], 96)
  platform.scale.z = .72
  root.add(platform)
  for (const [x, z, scale] of [[-12, -7, .78], [11.5, -7.5, .86]] as Array<[number, number, number]>) {
    const station = createOrbitalStation(scale, x === 0 ? 0xe2bd69 : 0x67aeb8)
    station.position.set(x, .08, z)
    station.rotation.y = x * .03
    root.add(station)
  }
  const planet = mesh(new THREE.SphereGeometry(18, 64, 36), new THREE.MeshStandardMaterial({ color: 0x274f68, emissive: 0x102331, emissiveIntensity: .46, roughness: .94 }), [18, -16, -22])
  planet.userData.planet = true
  planet.castShadow = false
  root.add(planet)
  const planetGlow = mesh(new THREE.TorusGeometry(18.3, .22, 16, 96), new THREE.MeshBasicMaterial({ color: 0x76b6c3, transparent: true, opacity: .24, depthWrite: false }), [18, -16, -22])
  planetGlow.rotation.x = Math.PI / 2.8
  root.add(planetGlow)
  const relaySites: Array<[number, number, number]> = [[-18, -3.5, .68], [-9, 8.5, .58], [0, -9.5, .72], [9, 8.2, .62], [18, -3.8, .7]]
  relaySites.forEach(([x, z, scale], index) => {
    const relay = createOrbitalStation(scale, index % 2 ? 0x65aab3 : 0xc7a75f)
    relay.position.set(x, .02, z)
    relay.rotation.y = index * .38
    root.add(relay)
    const solar = createSolarArray(.56 + index * .025)
    solar.position.set(x + (index % 2 ? -3 : 3), .12, z + (index % 2 ? .9 : -.9))
    solar.rotation.y = index * .51
    root.add(solar)
  })
  for (const radius of [8.5, 13.5, 20]) {
    const orbit = mesh(new THREE.TorusGeometry(radius, .025, 6, 160), new THREE.MeshBasicMaterial({ color: radius === 13.5 ? 0x78c5cd : 0x8b9ca0, transparent: true, opacity: radius === 13.5 ? .36 : .18, depthWrite: false }), [0, .34, 0])
    orbit.rotation.x = Math.PI / 2
    orbit.rotation.y = (radius - 8) * .035
    root.add(orbit)
  }
}

/**
 * Everything past the last block.
 *
 * Without this the districts sit on an empty plane, and any camera move that
 * looks past the built area shows nothing at all. Three concentric instanced
 * layers — a far ridge line, a middle landform band, and a region-specific
 * distant settlement — wrap the whole 360 degrees the camera can now reach,
 * for a handful of draw calls, and are tinted towards the region's fog colour
 * so they resolve into the sky rather than ending at a hard edge.
 */
function createHorizonRing(region: MapRegionKey, definition: ArcDefinition, clearance?: ClearanceField) {
  const group = new THREE.Group()
  const fog = new THREE.Color(definition.fog)
  const ground = new THREE.Color(definition.ground)
  const dummy = new THREE.Object3D()
  const colour = new THREE.Color()

  // The Treaty Sea has no ridge line: a ring of cone-shaped hills around
  // open water reads as mountains encircling a bay, not as a coastline. Its
  // horizon is the sea meeting the fog, which is what a horizon is at sea.
  if (region !== 'ocean') {
    // Aerial perspective: each band further out is blended harder towards the
    // fog colour and lit flatter, so the ring reads as distance rather than as
    // a dark wall standing around the district.
    const ridgeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, emissive: 0x6b7570, emissiveIntensity: .42 })
    const bands: Array<{ radius: number; count: number; height: [number, number]; spread: number; haze: number }> = [
      { radius: 92, count: 78, height: [9, 22], spread: 20, haze: .82 },
      { radius: 74, count: 68, height: [5, 13], spread: 15, haze: .68 },
      // Kept loose enough that individual hills read as hills. Packed shoulder
      // to shoulder they merged into one scalloped collar, and the district
      // looked like a plate sitting inside a bowl.
      { radius: 58, count: 46, height: [2.2, 6], spread: 11, haze: .54 },
    ]
    const total = bands.reduce((sum, band) => sum + band.count, 0)
    const ridges = new THREE.InstancedMesh(sharedGeometry.cone, ridgeMaterial, total)
    let index = 0
    bands.forEach((band, bandIndex) => {
      for (let step = 0; step < band.count; step += 1) {
        const angle = step / band.count * Math.PI * 2 + bandIndex * .4
        const seed = bandIndex * 613 + step * 31
        const radius = band.radius + (hashUnit(seed) - .5) * band.radius * .12
        const height = band.height[0] + hashUnit(seed + 7) * (band.height[1] - band.height[0])
        dummy.position.set(Math.cos(angle) * radius, height / 2 - 1.6, Math.sin(angle) * radius * .84)
        dummy.rotation.set(0, hashUnit(seed + 11) * Math.PI, 0)
        dummy.scale.set(band.spread * (.7 + hashUnit(seed + 13) * .6), height, band.spread * (.6 + hashUnit(seed + 17) * .5))
        dummy.updateMatrix()
        ridges.setMatrixAt(index, dummy.matrix)
        ridges.setColorAt(index, colour.copy(ground).lerp(fog, band.haze).offsetHSL(0, -.02, (hashUnit(seed + 19) - .5) * .045))
        index += 1
      }
    })
    ridges.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    ridges.castShadow = false
    ridges.receiveShadow = false
    if (ridges.instanceColor) ridges.instanceColor.needsUpdate = true
    ridges.computeBoundingSphere()
    group.add(ridges)
  }

  // The region's own distant settlement, so the middle distance is not just
  // scenery: the Old Quarter continues into a further city, the Circuit into
  // outlying villages, and the Arc into more of its capital.
  const outerRecords: InstancedBlockRecord[] = []
  if (region === 'city') {
    // Distant skyline. A continuous, densely-packed built-up band in the
    // elliptical annulus beyond the quarter's own wooded outskirts (see
    // addCityOutskirts) — buildings placed at random radius across the whole
    // band rather than on discrete rings, so from above it reads as a receding
    // urban mass on the horizon, not as concentric rings and not as the loose
    // scatter of stranded houses on near grass it used to be. In game the fog
    // takes it; in the fog-off plan view it is a dense textured band.
    const skylineCount = 760
    for (let index = 0; index < skylineCount; index += 1) {
      const seed = 500 + index * 23
      const angle = hashUnit(seed + 1) * Math.PI * 2
      const radial = hashUnit(seed + 2)
      const radiusX = 47 + radial * 27
      const radiusZ = 40 + radial * 23
      const height = Math.max(1.3, 3.6 + hashUnit(seed) * 4.2 - radial * 3.2)
      outerRecords.push({
        x: Math.cos(angle) * radiusX,
        z: Math.sin(angle) * radiusZ,
        width: 2.2 + hashUnit(seed + 7) * 1.5,
        depth: 1.9 + hashUnit(seed + 9) * 1.2,
        height,
        color: colour.copy(new THREE.Color([0x585049, 0x615850, 0x4f5857][index % 3])).lerp(fog, .32 + radial * .4).getHex(),
        lit: index % 6 === 0,
        roof: radial < .3 ? 'parapet' : radial > .7 ? 'pitched' : 'flat',
      })
    }
  } else if (region === 'continent') {
    // Outer arrondissements — the capital continuing outward from the wall
    // ring.
    //
    // Two failed versions preceded this one, and the second failed worse than
    // the first. Version one was seven hundred buildings dropped at a random
    // angle and radius with rotation zero, starting one building's depth
    // outside the boulevard: a field of debris across the whole middle
    // distance. Version two replaced it with eight concentric ellipse streets
    // built on both faces — which fixed the scatter and produced a dartboard,
    // eight near-identical rings of near-identical terraces stamped around a
    // radial core. Random noise at least looks organic; a perfect ring lattice
    // looks machine-made, and on this map it was the more artificial of the
    // two.
    //
    // The mistake was reading a radial city as radial fabric. Paris, Karlsruhe
    // and Amsterdam are radial in their *street armature* only: the avenues
    // fan out from the centre, but the quarters between them are built as
    // ordinary locally-orthogonal grids, each squared to its own avenue rather
    // than to the city's centre. That is why no two adjacent quarters line up
    // and why nothing reads as a ring even though the plan is circular.
    //
    // So the faubourg is now eight quarters, one per wedge between two
    // avenues. Each has its own grid, its own start radius, its own reach, its
    // own band depths and its own block sizes, so a band boundary in one
    // quarter has no counterpart in the next and the concentricity has nowhere
    // to come from. The armature above them is graded rather than uniform: two
    // grand avenues run right out into the country, two are major, and four
    // are minor streets that stop well short.
    const faubourgPalette = [0x4b5a60, 0x556267, 0x42565d, 0x5d6560, 0x596b64, 0x6a6a63]
    // The armature. `reach` is how far each arm actually runs, which is what
    // stops the outer edge from being a circle: a quarter can only build as
    // far as the streets that serve it.
    const arms: Array<{ polar: number; width: number; reach: number }> = [
      { polar: 0, width: 1.35, reach: 62 },
      { polar: 45, width: .62, reach: 44 },
      { polar: 90, width: .95, reach: 53 },
      { polar: 135, width: .62, reach: 39 },
      { polar: 180, width: 1.35, reach: 59 },
      { polar: 225, width: .62, reach: 43 },
      { polar: 270, width: .95, reach: 50 },
      { polar: 315, width: .62, reach: 37 },
    ].map((arm) => ({ ...arm, polar: arm.polar * Math.PI / 180 }))

    const faubourgBuildings: PlannedBuilding[] = []
    const faubourgTrees: TreeRecord[] = []
    const pavingParts: THREE.BufferGeometry[] = []
    const flat = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
    /** A carriageway as a flat rectangle, laid at an arbitrary bearing. */
    const paveStrip = (cx: number, cz: number, length: number, width: number, bearing: number) => {
      if (length < .4 || width < .1) return
      const strip = new THREE.PlaneGeometry(length, width)
      strip.applyMatrix4(flat)
      strip.applyMatrix4(new THREE.Matrix4().makeRotationY(-bearing))
      strip.translate(cx, 0, cz)
      pavingParts.push(strip)
    }

    for (const arm of arms) {
      paveStrip(
        Math.cos(arm.polar) * (17 + arm.reach) / 2,
        Math.sin(arm.polar) * (17 + arm.reach) / 2,
        arm.reach - 17,
        arm.width,
        arm.polar,
      )
    }

    for (let wedge = 0; wedge < arms.length; wedge += 1) {
      const from = arms[wedge]
      const to = arms[(wedge + 1) % arms.length]
      const span = wedge === arms.length - 1 ? Math.PI * 2 - from.polar + to.polar : to.polar - from.polar
      const bearing = from.polar + span / 2
      const half = span / 2
      const seed = 4200 + wedge * 733
      // The quarter's own grid frame: depth runs out along the bisector, width
      // runs across it, and every block in the quarter shares this rotation.
      const rotation = bearing - Math.PI / 2
      const forward: XZ = [Math.cos(bearing), Math.sin(bearing)]
      const sideways: XZ = [-Math.sin(bearing), Math.cos(bearing)]
      // Where this quarter begins and how far it gets. Squashing the reach
      // towards the north and south is what gives the whole faubourg an
      // elliptical footprint without any of its blocks being bent.
      const squash = 1 - .26 * Math.abs(Math.sin(bearing))
      // A quarter is served by both of the avenues that bound it, so it builds
      // out to roughly where they stop between them — not to the shorter one,
      // which used to kill four of the eight quarters outright.
      const limit = (from.reach + to.reach) / 2 * squash * (.86 + hashUnit(seed * 1.7) * .26)
      const start = 17.9 + hashUnit(seed) * 3.1
      const at = (along: number, across: number): XZ => [
        forward[0] * along + sideways[0] * across,
        forward[1] * along + sideways[1] * across,
      ]

      // The quarter's cross streets: one set of tangential offsets shared by
      // every band, so the streets run continuously out through the whole
      // quarter instead of each band being chopped up on its own. This is what
      // turns a stack of parallel bands into a grid — without it the fabric
      // reads as corduroy, which is the same failure as the ring lattice with
      // the stripes turned ninety degrees.
      //
      // The offsets are absolute, and the wedge gets wider the further out you
      // go, so the grid is clipped by the two avenues that bound it. The
      // half-blocks and triangular scraps that leaves along the avenues are
      // exactly what a diagonal cut through an orthogonal quarter produces in
      // any real radial city, and they do more for the plan than any amount of
      // jitter would.
      const lane = .78
      const crossOffsets: number[] = []
      {
        const reach = limit * Math.sin(half)
        let cursor = -reach
        while (cursor < reach) {
          crossOffsets.push(cursor)
          cursor += 3.6 + hashUnit(seed + crossOffsets.length * 29) * 3.4
        }
        crossOffsets.push(reach)
      }
      // Street *hierarchy* across the quarter, not just a comb of equals.
      //
      // The previous fabric thinned outward but stayed exactly as finely
      // divided, which is what made the outer bands read as the core
      // translated: the block module never changed, so a lot at the edge of
      // the map was the same size as a lot behind the boulevard and only had
      // fewer neighbours. A real fringe coarsens. Two streets in five carry on
      // to the edge of development, some stop part way, and the rest serve the
      // inner bands only — so a block out there spans what were three blocks
      // further in, and the lots cut from its frontage are correspondingly
      // wider.
      //
      // The two ends are always through routes: they run alongside the
      // bounding avenues, which is the one place a street definitely exists.
      const crossRank = crossOffsets.map((_, index) => {
        if (index === 0 || index === crossOffsets.length - 1) return 2
        const roll = hashUnit(seed + index * 613)
        return roll < .36 ? 2 : roll < .7 ? 1 : 0
      })

      // The band boundaries: irregular depths, so no two quarters share a
      // spacing and nothing lines up across an avenue. Depth and the gap to
      // the next band both grow outward, because a fringe plot is deeper than
      // a terrace plot and the land between the last few streets was never
      // fully taken up.
      const bands: Array<{ inner: number; depth: number }> = []
      const reachSpan = Math.max(8, limit - start)
      {
        let radius = start
        let band = 0
        while (radius < limit - 2.5 && band < 12) {
          const outward = THREE.MathUtils.clamp((radius - start) / reachSpan, 0, 1)
          const depth = Math.min(2.3 + hashUnit((seed + band * 311) * 1.3) * (2.2 + outward * 2.4), limit - radius - .6)
          if (depth < 2) break
          bands.push({ inner: radius, depth })
          radius += depth + .62 + hashUnit((seed + band * 311) * 2.1) * (.42 + outward * 1.3)
          band += 1
        }
      }

      /**
       * How far into the fringe a point is, 0 at the wall ring and 1 at the
       * edge of development. Everything about the fabric — height, coverage,
       * lot size, vacancy — is a function of this one figure.
       *
       * Three terms, and the second two are the whole reason this does not
       * read as a dartboard:
       *
       *  - distance out along the quarter's own bisector, normalised to *this*
       *     quarter's reach and raised to a power, so the inner half hardly
       *     thins at all and then the falloff arrives quickly. A linear ramp
       *     spreads the change so evenly that no part of it is legible.
       *  - a noise field with no centre in it, which moves the effective edge
       *     in and out by a couple of blocks. This is what stops any contour
       *     of the falloff from being a curve concentric with the plan.
       *  - ribbon development: the land either side of a radial avenue is
       *     built further out than the land between two of them, because the
       *     avenue is what got there first. It makes the built-up area a
       *     ragged star rather than a disc, and it is the reason the gaps
       *     appear mid-quarter instead of forming a ring.
       */
      const fringeAt = (px: number, pz: number, centre: number, across: number, halfChord: number) => {
        const edgeward = THREE.MathUtils.clamp((centre - start) / reachSpan, 0, 1)
        const ribbon = halfChord > .5
          ? THREE.MathUtils.clamp((Math.abs(across) - halfChord * .52) / (halfChord * .48), 0, 1)
          : 0
        return THREE.MathUtils.clamp(
          Math.pow(edgeward, 1.65)
          + (fabricNoise(px, pz, seed * .37) - .5) * .38
          - ribbon * edgeward * .5,
          0,
          1,
        )
      }

      // How far each cross street is actually made up. Recorded per street as
      // the bands are developed, and paved afterwards: running every street to
      // the quarter's nominal limit left a surveyed grid standing on empty
      // ground beyond the edge of the fabric, which reads as an abandoned
      // development rather than as a town petering out. Because the outer
      // blocks are thinned unevenly, each street now stops at a different
      // radius, which is most of what makes the edge fray.
      const paved = new Float32Array(crossOffsets.length).fill(start)

      bands.forEach(({ inner, depth }, band) => {
        const bandSeed = seed + band * 311
        const centre = inner + depth / 2
        const halfChord = Math.max(0, centre * Math.sin(half) - (from.width + to.width) / 2 - .7)
        const [mx, mz] = at(centre, 0)
        // The band's own position in the falloff, read on the bisector. Block
        // by block this is modulated by the noise and the ribbon term; here it
        // is only needed to decide which streets exist this far out.
        const bandFringe = fringeAt(mx, mz, centre, 0, halfChord)
        // Which cross streets are made up in this band. Beyond about two
        // thirds of the way out only the through routes survive, which is what
        // turns three narrow blocks into one wide one.
        const minRank = bandFringe > .58 ? 2 : bandFringe > .3 ? 1 : 0

        // Programme, not just more housing. Roughly one band in six is a
        // green or a single institutional block, which is what actually
        // interrupts a quarter in a real city.
        const programme = hashUnit(bandSeed * 3.7)
        if (programme < .09 && band > 0 && halfChord > 3) {
          for (let step = 0; step < 5; step += 1) {
            const [tx, tz] = at(centre + (hashUnit(bandSeed + step) - .5) * depth * .6, (step / 4 - .5) * halfChord * 1.7)
            faubourgTrees.push({ x: tx, z: tz, scale: .5 + hashUnit(bandSeed + step * 3) * .22, color: step % 2 ? 0x3f5749 : 0x47604f })
          }
          return
        }
        if (programme < .16 && band > 0 && halfChord > 3.5 && bandFringe < .55) {
          const [bx, bz] = at(centre, (hashUnit(bandSeed * 6.1) - .5) * halfChord)
          faubourgBuildings.push({
            x: bx,
            z: bz,
            width: Math.min(halfChord * 1.2, 8.5),
            depth: depth * .78,
            height: 3.2 + hashUnit(bandSeed * 5.1) * 1.9,
            rotationY: rotation,
            color: faubourgPalette[(band + wedge) % faubourgPalette.length],
            lit: false,
            roof: 'parapet',
            corner: false,
          })
          return
        }

        // How far across the band anything was actually built. The band's own
        // street is paved to this extent rather than to the nominal chord: a
        // carriageway running on past the last house is a surveyed grid on
        // empty ground, which reads as a failed development rather than as a
        // town petering out.
        let builtLow = Number.POSITIVE_INFINITY
        let builtHigh = Number.NEGATIVE_INFINITY

        for (let index = 0; index < crossOffsets.length - 1; index += 1) {
          if (crossRank[index] < minRank) continue
          // The block runs to the next street that exists this far out, so a
          // coarsened grid gives genuinely wider blocks rather than the same
          // blocks with gaps between them.
          let next = index + 1
          while (next < crossOffsets.length - 1 && crossRank[next] < minRank) next += 1
          const low = Math.max(crossOffsets[index], -halfChord)
          const high = Math.min(crossOffsets[next] - lane, halfChord)
          const width = high - low
          if (width < 1.7) continue
          const across = (low + high) / 2
          const [px, pz] = at(centre, across)
          const blockSeed = bandSeed + index * 97
          const fringe = fringeAt(px, pz, centre, across, halfChord)
          // Undeveloped parcels, drawn from a *second* noise field rather than
          // from a per-block die roll. The difference is legible: an
          // independent roll per block gives an even dusting of single holes,
          // which reads as damage, where a smooth field leaves two or three
          // neighbouring parcels empty together the way land actually comes
          // onto the market.
          if (fringe > .34 && fabricNoise(px * 1.35, pz * 1.35, seed * .91 + 311) < (fringe - .34) * .52) continue
          // How much of the block's perimeter gets built on, which is the
          // structural half of thinning and the half that a vacancy rate
          // cannot express. A core block is a closed perimeter with a
          // courtyard inside it; a fringe block is a row of houses along the
          // lane and nothing at all on its ends; the last blocks of all are
          // built up one side only. Losing coverage this way keeps every
          // remaining building on a street frontage at a shared building line,
          // where thinning by raising the per-lot vacancy alone eventually
          // leaves detached objects standing in the middle of a block — the
          // "plopped in" read this whole quarter was rebuilt to escape.
          const edges: Array<'n' | 's' | 'e' | 'w'> = fringe > .72
            ? [hashUnit(blockSeed * 8.7) < .5 ? 'n' : 's']
            : fringe > .44
              ? ['n', 's']
              : ['n', 's', 'e', 'w']
          const lotMin = 1.32 + fringe * .82 + hashUnit(blockSeed * 1.9) * (.35 + fringe * .45)
          const built = developBlock({
            x: px,
            z: pz,
            width,
            depth,
            rotation,
            frontage: 'collector',
            row: band,
            column: index,
            seed: blockSeed,
          }, {
            seed: blockSeed,
            edges,
            // Lot frontage grows and — the part that actually reads — grows
            // *less predictably*: the spread between the minimum and maximum
            // widens with it, so an outer street has plots of markedly
            // different sizes next to each other where an inner one has a
            // regular terrace rhythm.
            lotMin,
            lotMax: 2.25 + fringe * 1.7 + hashUnit(blockSeed * 2.7) * (.85 + fringe * 1.5),
            setback: .2 + fringe * .4,
            buildingDepth: (1.1 + hashUnit(blockSeed * 3.3) * .4) * (1 - fringe * .3),
            // Party wall in the inner faubourg, side yards outside it. Taken
            // as a share of the block's own smallest lot rather than as a
            // world constant, because the building is what is left of the lot
            // after the gap: a fixed gap on a growing lot produces
            // implausibly wide houses, and a large fixed gap on a small lot
            // deletes the building.
            gap: .06 + lotMin * fringe * .36,
            storeyHeight: .95,
            storeysMin: 1.5 + (1 - fringe) * 1.2,
            storeysMax: 2.4 + (1 - fringe) * 2.6 + hashUnit(blockSeed * 5.9) * (1.2 - fringe * .75),
            cornerBonus: .8 * (1 - fringe),
            palette: faubourgPalette,
            roof: fringe < .3 ? 'parapet' : fringe < .62 ? 'flat' : 'pitched',
            litChance: (1 - fringe) * .34,
            vacancy: .03 + Math.pow(fringe, 1.35) * .3,
          })
          if (!built.length) continue
          faubourgBuildings.push(...built)
          builtLow = Math.min(builtLow, low)
          builtHigh = Math.max(builtHigh, high)
          paved[index] = Math.max(paved[index], centre + depth / 2 + .9)
          paved[next] = Math.max(paved[next], centre + depth / 2 + .9)
        }

        if (builtHigh - builtLow < 1.4) return
        // The street on this band's outer face, and the trees down it. A
        // carriageway with nothing along it still reads as a gap between two
        // rows rather than as a street.
        const run = builtHigh - builtLow + 1.4
        const [sx, sz] = at(inner + depth + .3, (builtLow + builtHigh) / 2)
        paveStrip(sx, sz, run, .62, bearing + Math.PI / 2)
        // Sparse on purpose. A tree canopy is a 396-triangle sphere in this
        // scene, so a full avenue planting out here costs more than all the
        // buildings it stands in front of, for something the fog eats. Planting
        // thins with the fabric, because a fringe lane is not a boulevard.
        const treeCount = Math.max(1, Math.round(run / 3.4))
        const plantChance = .45 - bandFringe * .3
        for (let step = 0; step <= treeCount; step += 1) {
          if (hashUnit(bandSeed + step * 41) > plantChance) continue
          const [tx, tz] = at(inner + depth + .82, builtLow + (step / treeCount) * run)
          faubourgTrees.push({ x: tx, z: tz, scale: .4 + hashUnit(bandSeed + step * 7) * .2, color: step % 2 ? 0x415a4a : 0x4a6151 })
        }
      })

      for (let index = 0; index < crossOffsets.length; index += 1) {
        const offset = crossOffsets[index]
        const entry = Math.max(start, Math.abs(offset) / Math.max(1e-3, Math.sin(half)))
        const end = paved[index]
        if (end - entry < 1.5) continue
        const [cx, cz] = at((entry + end) / 2, offset - lane / 2)
        paveStrip(cx, cz, end - entry, lane * .74, bearing)
      }
    }

    // Ribbon development along the radial avenues.
    //
    // The quarters above stop where their streets stop, which is correct and
    // is most of what makes the edge ragged, but on its own it leaves a grand
    // avenue running twenty units of open country with nothing on it — the one
    // thing a main road out of a capital never does. Frontage strung directly
    // along the avenue, thinning as it goes, is what a suburb looked like
    // before anybody laid a street behind it: a line of houses and yards on
    // the road itself. It also does most of the work of keeping the built-up
    // area a star rather than a disc, since only the arms carry it.
    for (const arm of arms) {
      // Grand and major avenues only. A minor street that gives up at 37 units
      // has nothing to string a ribbon along.
      if (arm.width < .9) continue
      const armSeed = 7700 + Math.round(arm.polar * 180 / Math.PI)
      const from = 27 + hashUnit(armSeed) * 5
      const to = arm.reach - 2.5
      if (to - from < 6) continue
      faubourgBuildings.push(...radialFrontage([0, 0], arm.polar, from, to, {
        seed: armSeed,
        lotMin: 2.7,
        lotMax: 5.6,
        setback: .5,
        buildingDepth: 1.15,
        // A ribbon is detached by definition; the gap is most of the lot.
        gap: 1.55,
        storeyHeight: .9,
        storeysMin: 1.3,
        storeysMax: 2.35,
        palette: faubourgPalette,
        roof: 'pitched',
        litChance: .06,
      }, { falloff: .78 }))
    }

    const paving = mergeGeometries(pavingParts, false)
    if (paving) {
      const road = mesh(paving, material(new THREE.Color(0x3b474a).lerp(fog, .34).getHex(), 1), [0, .012, 0])
      road.castShadow = false
      road.receiveShadow = false
      group.add(road)
    }
    pavingParts.forEach((part) => part.dispose())
    if (faubourgTrees.length) group.add(buildInstancedTreeField(faubourgTrees))

    // The plan, kept for inspection. "The edge thins" is otherwise a claim
    // about a screenshot; with the plan on the group a harness can measure
    // count, height and frontage against distance and say by how much.
    group.userData.faubourgPlan = faubourgBuildings.map((building) => ({
      x: building.x, z: building.z, width: building.width, depth: building.depth, height: building.height,
    }))

    for (const building of faubourgBuildings) {
      const away = THREE.MathUtils.clamp((Math.hypot(building.x, building.z) - 18) / 28, 0, 1)
      outerRecords.push({
        x: building.x,
        z: building.z,
        width: building.width,
        depth: building.depth,
        height: building.height,
        rotationY: building.rotationY,
        color: colour.copy(new THREE.Color(building.color)).lerp(fog, .18 + away * .5).getHex(),
        lit: building.lit,
        roof: building.roof,
      })
    }
  } else if (region === 'nation') {
    // The open country between the three towns.
    //
    // This was sixteen loose clusters of boxes jittered inside a rectangle,
    // then sixteen clusters aligned to a lane — but the lane was never drawn,
    // so from above they were still just buildings standing in a field at an
    // angle nobody could account for. A pitched roof read from directly
    // overhead is a diamond whichever way it is turned, so orientation alone
    // was never going to be legible; the thing that makes a rural building
    // read as sited is the track it stands on and the yard it encloses.
    //
    // Each hamlet is now a drawn lane with two to four *farmsteads* on it, and
    // a farmstead is a group: the house with its gable to the lane, a barn set
    // back at right angles to it, a shed closing the third side of the yard,
    // and a windbreak of trees on the weather side. That is what a farm is in
    // plan and it is what stops one from reading as debris.
    const laneParts: THREE.BufferGeometry[] = []
    const hamletTrees: TreeRecord[] = []
    const flatLane = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
    const farmPalette = [0x6f6759, 0x7a7062, 0x635f57, 0x7d7160]
    for (let cluster = 0; cluster < 16; cluster += 1) {
      const angle = cluster / 16 * Math.PI * 2 + hashUnit(cluster * 53) * .2
      const radius = 29 + hashUnit(cluster * 17) * 13
      const cx = Math.cos(angle) * radius
      const cz = Math.sin(angle) * radius * .84
      // The lane's bearing, which every building in the hamlet is square to.
      const bearing = hashUnit(cluster * 91 + 3) * Math.PI
      const along: XZ = [Math.cos(bearing), Math.sin(bearing)]
      const across: XZ = [-Math.sin(bearing), Math.cos(bearing)]
      const steadings = 2 + Math.floor(hashUnit(cluster * 29) * 3)
      const laneLength = 4.5 + steadings * 3.4
      const at = (step: number, lateral: number): XZ => [
        cx + along[0] * step + across[0] * lateral,
        cz + along[1] * step + across[1] * lateral,
      ]

      const lane = new THREE.PlaneGeometry(laneLength, .34)
      lane.applyMatrix4(flatLane)
      lane.applyMatrix4(new THREE.Matrix4().makeRotationY(-bearing))
      lane.translate(cx, 0, cz)
      laneParts.push(lane)

      for (let index = 0; index < steadings; index += 1) {
        const seed = 1200 + cluster * 61 + index * 137
        const step = -laneLength / 2 + 2.6 + index * 3.4 + hashUnit(seed) * .7
        // Which side of the lane this farm sits on, and therefore which way
        // its yard opens.
        const side = hashUnit(seed * 1.7) < .5 ? -1 : 1
        const facing = -bearing + (side > 0 ? Math.PI : 0)
        // The yard track in off the lane.
        const spur = new THREE.PlaneGeometry(1.5, .24)
        spur.applyMatrix4(flatLane)
        spur.applyMatrix4(new THREE.Matrix4().makeRotationY(-(bearing + Math.PI / 2)))
        const [spx, spz] = at(step, side * .95)
        spur.translate(spx, 0, spz)
        laneParts.push(spur)

        // House: gable end to the lane, closest to it.
        const [hx, hz] = at(step, side * 1.6)
        outerRecords.push({
          x: hx, z: hz,
          width: 1.5 + hashUnit(seed + 5) * .5,
          depth: 1.15,
          height: 1.25 + hashUnit(seed + 7) * .7,
          rotationY: facing,
          color: colour.copy(new THREE.Color(farmPalette[index % farmPalette.length])).lerp(fog, .2).getHex(),
          lit: false,
          roof: 'pitched',
        })
        // Barn: set back and turned across the house, which is what encloses
        // the yard between them.
        const [bx, bz] = at(step + 1.35, side * 2.65)
        outerRecords.push({
          x: bx, z: bz,
          width: 2.1 + hashUnit(seed + 11) * .8,
          depth: 1.25,
          height: 1.35 + hashUnit(seed + 13) * .5,
          rotationY: facing + Math.PI / 2,
          color: colour.copy(new THREE.Color(0x6a6055)).lerp(fog, .24).getHex(),
          lit: false,
          roof: 'pitched',
        })
        // A cart shed on the third side, on the larger holdings only.
        if (hashUnit(seed + 17) > .38) {
          const [sx, sz] = at(step - 1.2, side * 2.55)
          outerRecords.push({
            x: sx, z: sz,
            width: 1.15,
            depth: .95,
            height: .82,
            rotationY: facing + Math.PI / 2,
            color: colour.copy(new THREE.Color(0x746a5c)).lerp(fog, .26).getHex(),
            lit: false,
            roof: 'flat',
          })
        }
        // The windbreak, behind the steading rather than around it.
        for (let tree = 0; tree < 3; tree += 1) {
          const [tx, tz] = at(step - 1.5 + tree * 1.4, side * 3.75)
          hamletTrees.push({ x: tx, z: tz, scale: .5 + hashUnit(seed + tree * 3) * .22, color: tree % 2 ? 0x3f5236 : 0x475b3c })
        }
      }
    }
    const lanes = mergeGeometries(laneParts, false)
    if (lanes) {
      const track = mesh(lanes, material(new THREE.Color(0x8c8570).lerp(fog, .3).getHex(), 1), [0, .022, 0])
      track.castShadow = false
      track.receiveShadow = false
      group.add(track)
    }
    laneParts.forEach((part) => part.dispose())
    if (hamletTrees.length) group.add(buildInstancedTreeField(hamletTrees))
  }

  // The outer country is authored from the horizon inwards and never knew about
  // the district's streets, so its hamlets were the one set of buildings no
  // clearance pass had ever looked at. That is The Circuit's tractor at
  // 29.4,-1.4: the turnpike runs out past the district to its portal and a
  // farmstead was standing on it, which is why enabling the building pass did
  // nothing for that site — the farm is not a planned building.
  if (outerRecords.length) {
    const cleared = clearance
      ? keepRecordsClear(outerRecords, clearance, { limit: 1.2, label: 'steading' }).kept
      : outerRecords
    if (cleared.length) group.add(buildFacadeGroup(cleared.map((record, index) => tintForRegion(region, record, index)), { region }))
  }
  return group
}

function addPerimeterEnvironment(root: THREE.Group, region: MapRegionKey, definition: ArcDefinition) {
  if (region === 'orbit') return
  const corridors = buildingCorridors(root)
  root.add(createHorizonRing(region, definition, corridors.length ? prepareClearance(corridors) : undefined))
  // The Treaty Sea's horizon is the sea. Sixteen islands with towers on a third
  // of them, set on an ellipse at twenty-four to thirty units, is a ring of land
  // around a pond rather than open water, and it stood where the region's one
  // vessel now runs its circuit.
}

function curveDistanceXZ(curve: THREE.Curve<THREE.Vector3>, position: THREE.Vector3) {
  let closest = Number.POSITIVE_INFINITY
  for (let index = 0; index <= 120; index += 1) {
    const sample = curve.getPointAt(index / 120)
    closest = Math.min(closest, Math.hypot(position.x - sample.x, position.z - sample.z))
  }
  return closest
}

/** Removes only scenery that violates the authored career right-of-way. */
function enforceCareerSetback(root: THREE.Group, route: THREE.Curve<THREE.Vector3>, region: MapRegionKey) {
  const clearance = region === 'continent' ? 2.45 : region === 'nation' ? 2.2 : region === 'city' ? 2.05 : 1.65
  ;[...root.children].forEach((child) => {
    if (!child.userData.playerOccluder || child.userData.mapSelection) return
    if (curveDistanceXZ(route, child.position) < clearance) root.remove(child)
  })
}

function clearAuthoredParcel(root: THREE.Group, center: THREE.Vector3, radius: number) {
  ;[...root.children].forEach((child) => {
    if (child.userData.mapSelection || child.userData.careerInfrastructure) return
    if (!child.userData.playerOccluder && !child.userData.tree && !child.userData.authoredProp) return
    if (Math.hypot(child.position.x - center.x, child.position.z - center.z) < radius) root.remove(child)
  })
}

/**
 * Every placed prop with a footprint, in world space, as a set of discs for the
 * crowd to steer around, each carrying whether it is solid.
 */
function crowdObstacles(root: THREE.Object3D) {
  const out: Array<{ x: number; z: number; radius: number; solid: boolean; hx?: number; hz?: number; rotationY?: number }> = []
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const euler = new THREE.Euler()
  root.updateWorldMatrix(true, true)
  root.traverse((child) => {
    const radius = child.userData?.footprintRadius as number | undefined
    if (typeof radius !== 'number' || radius <= 0) return
    child.getWorldPosition(position)
    // Steering keeps the disc either way — a shoulder brushing past a bench
    // wants a round thing to brush past, and inventing corners for it would
    // make walkers flinch at nothing. The rectangle is for the routing pass,
    // which is deciding whether a pavement exists at all.
    const box = child.userData?.footprintBox as { hx: number; hz: number } | undefined
    if (!box) {
      out.push({ x: position.x, z: position.z, radius, solid: child.userData?.footprintSolid === true })
      return
    }
    child.getWorldQuaternion(quaternion)
    euler.setFromQuaternion(quaternion, 'YXZ')
    out.push({
      x: position.x,
      z: position.z,
      radius,
      solid: child.userData?.footprintSolid === true,
      hx: box.hx,
      hz: box.hz,
      rotationY: euler.y,
    })
  })
  return out
}

/**
 * A solid whose real plan is a rectangle, tagged with that rectangle.
 *
 * The `footprintRadius` stays as the disc the steering uses, and the box is
 * read only by the routing pass. Callers give the *drawn* extent, not the
 * planned one: a near building's canopy and cornice stand a third of a metre
 * outside the block it was laid out on, and it is the drawn thing a walker
 * collides with.
 */
function markSolidBox<T extends THREE.Object3D>(object: T, halfX: number, halfZ: number) {
  object.userData.footprintBox = { hx: halfX, hz: halfZ }
  return markSolidFootprint(object)
}

function markAuthoredProp<T extends THREE.Object3D>(object: T, footprintRadius: number) {
  object.userData.authoredProp = true
  object.userData.footprintRadius = footprintRadius
  return object
}

/**
 * A prop a person has to walk *round*, not past. See `SolidFootprint`.
 *
 * The class distinction is the one the earlier prop work did not make, and it
 * is the reason that work had to be reverted: a pass that treats a bench and a
 * farmstead as the same kind of thing is either too timid to remove the
 * farmstead from the pavement or aggressive enough to start re-siting the
 * benches, and the second of those measured *worse* for pedestrians than doing
 * nothing. A bench, a lamp standard, a bollard, a planter, a bike rack, a
 * milestone and a signal are pavement furniture: they belong where they are and
 * a walker brushes past them, which the crowd's per-frame steering already
 * models. Everything tagged here is an enclosed mass at body height — a
 * building, a cafe terrace, a farmstead, a market stall, a parked van, a walled
 * churchyard — and the honest thing to do with the pavement under it is to take
 * it away.
 *
 * Tagged on the factory rather than at each placement, because several callers
 * override the radius afterwards and would silently drop a flag set beside it.
 */
function markSolidFootprint<T extends THREE.Object3D>(object: T) {
  object.userData.footprintSolid = true
  return object
}

function markSolidProp<T extends THREE.Object3D>(object: T, footprintRadius: number) {
  return markSolidFootprint(markAuthoredProp(object, footprintRadius))
}

/**
 * Every vehicle body carries its own hull half-extents, measured on the local
 * +x forward axis all of them are modelled along.
 *
 * A parked car is static scenery, so `batchStaticScenery` merges it out of
 * existence and nothing downstream can read its box back. That is precisely why
 * five cars standing in each other went unmeasured through three passes: the
 * only collision harness in the project tests *movers*, and by the time it
 * looks at the graph the parked population is anonymous triangles inside a
 * merged batch. Tagging the hull at construction and harvesting the tags into a
 * plain data registry before the batcher runs makes the parked fleet
 * measurable without keeping a single extra draw call alive.
 */
function markVehicleHull<T extends THREE.Object3D>(
  object: T, halfLength: number, halfWidth: number, kind: string, height: number, offsetX = 0,
) {
  object.userData.vehicleHull = { halfLength, halfWidth, kind, height, offsetX }
  return object
}

export type VehicleHullRecord = {
  x: number
  z: number
  rotationY: number
  halfLength: number
  halfWidth: number
  low: number
  high: number
  kind: string
}

/**
 * World-space hull records for every tagged vehicle currently in the graph.
 *
 * Read as an oriented box rather than an AABB: a car parked at an angle to the
 * world axes has an axis-aligned box half again its own width, and inflating
 * every hull like that would invent overlaps between neighbours that are
 * actually clear.
 */
function collectVehicleHulls(root: THREE.Object3D, live: Set<THREE.Object3D>) {
  const out: VehicleHullRecord[] = []
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const forward = new THREE.Vector3()
  // A pooled body sits inactive at the origin until its simulation spawns it,
  // so harvesting one here would record a dozen vehicles stacked on the same
  // spot and invent exactly the fault this registry exists to measure. The
  // movers are readable from their simulation at any time; this is the parked
  // fleet only.
  const isLive = (object: THREE.Object3D) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (live.has(node)) return true
    return false
  }
  root.updateWorldMatrix(true, true)
  root.traverse((child) => {
    const hull = child.userData?.vehicleHull as
      { halfLength: number; halfWidth: number; kind: string; height: number; offsetX?: number } | undefined
    if (!hull) return
    if (isLive(child)) return
    child.matrixWorld.decompose(position, quaternion, scale)
    // Heading straight off the world matrix, so a body nested inside a rotated
    // parent group is recorded at the bearing it actually stands at.
    forward.set(1, 0, 0).applyQuaternion(quaternion)
    const spread = (Math.abs(scale.x) + Math.abs(scale.z)) / 2
    // A train's three cars trail behind the origin the spline drives, so the
    // hull centre is not the object position.
    const shift = (hull.offsetX ?? 0) * Math.abs(scale.x || spread)
    out.push({
      x: position.x + forward.x * shift,
      z: position.z + forward.z * shift,
      rotationY: Math.atan2(forward.z, forward.x),
      halfLength: hull.halfLength * Math.abs(scale.x || spread),
      halfWidth: hull.halfWidth * Math.abs(scale.z || spread),
      low: position.y,
      high: position.y + hull.height * Math.abs(scale.y || spread),
      kind: hull.kind,
    })
  })
  return out
}

/**
 * Ground-conformance and overlap audit for placed props.
 *
 * Placement bugs in this scene have always been of two kinds — a prop hovering
 * over the surface it is meant to be standing on, and two props occupying the
 * same ground — and both are invisible from the camera angle the map opens at,
 * which is why they survived three rounds of "it looks fine". They are trivial
 * to catch numerically, so they are caught numerically.
 *
 * Ground height comes from an actual downward raycast rather than from the
 * constant the placing code believed the surface was at. That distinction is
 * the whole value of the check: the quay bollards in the harbour were placed at
 * the island's nominal top and were in fact sitting a fifth of a unit under the
 * quay deck laid on top of it, which no hand-maintained table of surface
 * heights would ever have caught.
 *
 * This has to run before `batchStaticScenery`, which merges most of these
 * groups away, and it only runs in development.
 */
function conformAndAuditProps(world: THREE.Group, region: MapRegionKey, audit: boolean) {
  const tagged: Array<{ object: THREE.Object3D; name: string }> = []
  world.traverse((object) => {
    const tag = object.userData.propAudit as { name?: string } | undefined
    if (tag) tagged.push({ object, name: tag.name ?? object.name ?? 'prop' })
  })
  if (!tagged.length) return

  world.updateWorldMatrix(true, true)
  const box = new THREE.Box3()
  const isUnder = (candidate: THREE.Object3D | null, ancestor: THREE.Object3D) => {
    for (let node = candidate; node; node = node.parent) if (node === ancestor) return true
    return false
  }

  // Surfaces, as world-space boxes, gathered in one pass. Testing a prop
  // against these is a handful of comparisons each; a downward raycast into the
  // whole district is a few million triangle tests per prop and takes long
  // enough to time the scene build out.
  const surfaces: Array<{ object: THREE.Object3D; box: THREE.Box3 }> = []
  world.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.userData.propAudit) return
    const bounds = new THREE.Box3().setFromObject(object, true)
    if (!Number.isFinite(bounds.min.y)) return
    surfaces.push({ object, box: bounds })
  })

  /**
   * The highest surface whose footprint covers this point and whose top is not
   * above the prop standing on it — the quay deck rather than the island
   * beneath it, and never the prop's own geometry.
   */
  const groundUnder = (object: THREE.Object3D, centreX: number, centreZ: number, propMinY: number) => {
    let ground = 0
    let found = false
    for (const surface of surfaces) {
      if (isUnder(surface.object, object)) continue
      if (centreX < surface.box.min.x || centreX > surface.box.max.x) continue
      if (centreZ < surface.box.min.z || centreZ > surface.box.max.z) continue
      const top = surface.box.max.y
      if (top > propMinY + .25) continue
      if (!found || top > ground) { ground = top; found = true }
    }
    return ground
  }

  // Conform first, then measure. Snapping each prop onto the surface actually
  // under it is the fix for a whole class of bug that hand-maintained height
  // constants keep reintroducing: the placing code has to know not just which
  // island a crate is on but whether a quay deck was laid over that part of it,
  // and it demonstrably does not.
  // Twice, because lowering a prop onto the surface under it can bring a
  // taller neighbouring surface — a plinth, a quay deck, a terrace — inside the
  // "not above the prop" filter that excluded it on the first look. The second
  // pass settles on that one; a third has never changed anything.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const { object } of tagged) {
      box.setFromObject(object, true)
      if (!Number.isFinite(box.min.y)) continue
      const centreX = (box.min.x + box.max.x) / 2
      const centreZ = (box.min.z + box.max.z) / 2
      const ground = groundUnder(object, centreX, centreZ, box.min.y)
      const drop = box.min.y - ground
      if (Math.abs(drop) < .004) continue
      object.position.y -= drop
      object.updateWorldMatrix(false, true)
    }
  }

  if (!audit) return
  const entries = tagged.map(({ object, name }) => {
    box.setFromObject(object, true)
    const centreX = (box.min.x + box.max.x) / 2
    const centreZ = (box.min.z + box.max.z) / 2
    const ground = groundUnder(object, centreX, centreZ, box.min.y)
    return {
      name,
      minY: +box.min.y.toFixed(4),
      ground: +ground.toFixed(4),
      clearance: +(box.min.y - ground).toFixed(4),
      minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
    }
  })

  const floating = entries.filter((entry) => entry.clearance > .06).map(({ name, clearance }) => ({ name, clearance }))
  const sunken = entries.filter((entry) => entry.clearance < -.22).map(({ name, clearance }) => ({ name, clearance }))
  const overlaps: Array<{ a: string; b: string; x: number; z: number }> = []
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a]
      const two = entries[b]
      const overlapX = Math.min(one.maxX, two.maxX) - Math.max(one.minX, two.minX)
      const overlapZ = Math.min(one.maxZ, two.maxZ) - Math.max(one.minZ, two.minZ)
      if (overlapX > .06 && overlapZ > .06) overlaps.push({ a: one.name, b: two.name, x: +overlapX.toFixed(3), z: +overlapZ.toFixed(3) })
    }
  }
  // Placements go out with the audit because the scene the harness can inspect
  // is the batched one, where most of these groups have been merged away and a
  // prop's world box can no longer be read back. Debugging a placement fault
  // from outside needs the geometry as it was when it was judged.
  const placements = entries.map((entry) => ({
    name: entry.name,
    x: +((entry.minX + entry.maxX) / 2).toFixed(2),
    z: +((entry.minZ + entry.maxZ) / 2).toFixed(2),
    width: +(entry.maxX - entry.minX).toFixed(2),
    depth: +(entry.maxZ - entry.minZ).toFixed(2),
  }))
  world.userData.propAudit = { region, total: entries.length, floating, sunken, overlaps: overlaps.slice(0, 40), overlapCount: overlaps.length, placements }
}

/**
 * A slender monumental marker used in mirrored pairs to flank a formal
 * civic approach. Four small meshes shared by only a handful of instances
 * (one pair per headquarters site), so it stays cheap regardless of how
 * legible it needs to be up close.
 */
function createCivicPylon(scale = 1, stone = 0x9c9284, accent = 0x805a43) {
  const group = new THREE.Group()
  const stoneMaterial = material(stone, .68, .06)
  group.add(cylinder(.16 * scale, .24 * scale, stoneMaterial, [0, .12 * scale, 0], 8))
  group.add(cylinder(.085 * scale, 1.85 * scale, stoneMaterial, [0, 1.02 * scale, 0], 8))
  const bandMaterial = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .34, roughness: .48 })
  group.add(cylinder(.098 * scale, .14 * scale, bandMaterial, [0, 1.36 * scale, 0], 8))
  group.add(mesh(new THREE.ConeGeometry(.16 * scale, .32 * scale, 8), stoneMaterial, [0, 2.1 * scale, 0]))
  return markAuthoredProp(group, .3 * scale)
}

function createPlanter(scale = 1) {
  const group = new THREE.Group()
  group.add(box([.72 * scale, .34 * scale, .42 * scale], material(0x726b5d, .94), [0, .17 * scale, 0]))
  for (const x of [-.2, 0, .2]) {
    const shrub = mesh(new THREE.SphereGeometry(.17 * scale, 12, 8), material(x === 0 ? 0x425c46 : 0x536b50, .98), [x * scale, .48 * scale, 0])
    shrub.scale.y = 1.35
    group.add(shrub)
  }
  return markAuthoredProp(group, .48 * scale)
}

function createWayfindingTotem(accent: number) {
  const group = new THREE.Group()
  const steel = material(0x303b3c, .45, .34)
  group.add(cylinder(.045, 1.45, steel, [0, .72, 0], 10))
  group.add(box([.72, .38, .08], material(accent, .4, .26), [.3, 1.32, 0]))
  group.add(box([.55, .08, .1], material(0xd1c39c, .7), [.23, 1.32, .05]))
  return markAuthoredProp(group, .48)
}

function createDistrictFlag(color: number, scale = 1) {
  const group = new THREE.Group()
  const pole = material(0x3b4647, .36, .5)
  group.add(cylinder(.025 * scale, 1.7 * scale, pole, [0, .85 * scale, 0], 10))
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } }
  const fabric = mesh(
    new THREE.PlaneGeometry(.72 * scale, .42 * scale, 14, 3),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      vertexShader: 'uniform float uTime; varying vec2 vUv; void main(){vUv=uv;vec3 p=position;float freeEdge=smoothstep(0.,1.,uv.x);p.z+=sin(uv.x*8.0-uTime*2.1)*.045*freeEdge+sin(uv.x*15.0-uTime*1.35)*.018*freeEdge;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
      fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main(){float fold=.78+.22*sin(vUv.x*12.0+vUv.y*2.0);float border=smoothstep(.0,.08,vUv.y)*(1.-smoothstep(.92,1.,vUv.y));gl_FragColor=vec4(uColor*fold*mix(.86,1.,border),1.);}',
    }),
    [.36 * scale, 1.47 * scale, 0],
  )
  fabric.castShadow = true
  fabric.userData.flagUniforms = uniforms
  group.add(fabric)
  return group
}

function createCafeSet(scale = 1) {
  const group = new THREE.Group()
  const timber = material(0x5c4738, .86)
  group.add(cylinder(.34 * scale, .06 * scale, timber, [0, .62 * scale, 0], 24))
  group.add(cylinder(.035 * scale, .6 * scale, material(0x2d3434, .5, .28), [0, .3 * scale, 0], 8))
  for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const chair = createBench(.27 * scale)
    chair.position.set(Math.cos(angle) * .68 * scale, 0, Math.sin(angle) * .68 * scale)
    chair.rotation.y = -angle + Math.PI / 2
    group.add(chair)
  }
  return markSolidProp(group, .88 * scale)
}

function createServiceShed(scale = 1, color = 0x665f55) {
  const group = new THREE.Group()
  group.add(box([1.25 * scale, .95 * scale, .95 * scale], material(color, .9), [0, .48 * scale, 0]))
  const roof = box([1.48 * scale, .12 * scale, 1.18 * scale], material(0x45433d, .78, .12), [0, 1.04 * scale, 0])
  roof.rotation.z = .08
  group.add(roof)
  group.add(box([.42 * scale, .7 * scale, .05], material(0x2c3333, .72), [0, .38 * scale, .49 * scale]))
  return markSolidProp(group, .82 * scale)
}

function createRadarArray(scale = 1) {
  const group = new THREE.Group()
  const steel = material(0x7a8587, .34, .62)
  group.add(cylinder(.075 * scale, 1.3 * scale, steel, [0, .65 * scale, 0], 12))
  const dish = mesh(new THREE.SphereGeometry(.7 * scale, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), material(0x899799, .32, .58), [0, 1.52 * scale, 0])
  dish.scale.y = .28
  dish.rotation.x = -.52
  dish.userData.radarDish = true
  group.add(dish)
  return markAuthoredProp(group, .72 * scale)
}

function createTransitShelter(scale = 1, accent = 0x7eaa9e) {
  const group = new THREE.Group()
  const stone = material(0x716f67, .92)
  const steel = material(0x303a3c, .4, .38)
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x78989b, roughness: .18, metalness: .08, transparent: true, opacity: .48, transmission: .18, depthWrite: false })
  group.add(box([2.3 * scale, .1 * scale, .86 * scale], stone, [0, .05 * scale, 0]))
  for (const x of [-1, 1]) group.add(cylinder(.04 * scale, 1.55 * scale, steel, [x * scale, .82 * scale, -.32 * scale], 10))
  group.add(box([2.22 * scale, .08 * scale, 1.08 * scale], steel, [0, 1.6 * scale, 0]))
  group.add(box([1.88 * scale, 1.05 * scale, .035 * scale], glass, [0, .9 * scale, -.37 * scale]))
  group.add(box([.72 * scale, .06 * scale, .3 * scale], material(0x59483b, .86), [0, .45 * scale, -.1 * scale]))
  group.add(box([.18 * scale, .95 * scale, .08 * scale], material(accent, .4, .3), [1.15 * scale, 1.05 * scale, -.33 * scale]))
  return markSolidProp(group, 1.28 * scale)
}

function createBikeRack(scale = 1) {
  const group = new THREE.Group()
  const steel = material(0x3a4546, .34, .5)
  group.add(box([1.72 * scale, .06 * scale, .32 * scale], material(0x77756d, .95), [0, .03 * scale, 0]))
  for (let index = 0; index < 5; index += 1) {
    const hoop = mesh(new THREE.TorusGeometry(.22 * scale, .025 * scale, 8, 20, Math.PI), steel, [(-.68 + index * .34) * scale, .24 * scale, 0])
    group.add(hoop)
  }
  return markAuthoredProp(group, .92 * scale)
}

function createCivicKiosk(scale = 1) {
  const group = new THREE.Group()
  const frame = material(0x344043, .42, .34)
  const paper = material(0xc2b894, .88)
  group.add(box([1.05 * scale, 1.15 * scale, .72 * scale], material(0x5c635f, .72), [0, .58 * scale, 0]))
  group.add(box([1.18 * scale, .12 * scale, .9 * scale], frame, [0, 1.2 * scale, 0]))
  group.add(box([.76 * scale, .48 * scale, .035], paper, [0, .72 * scale, .38 * scale]))
  for (let row = 0; row < 3; row += 1) group.add(box([.56 * scale, .025 * scale, .04], frame, [0, (.59 + row * .12) * scale, .405 * scale]))
  return markSolidProp(group, .72 * scale)
}

function createFarmstead(scale = 1) {
  const group = new THREE.Group()
  const barn = material(0x705447, .9)
  const roof = material(0x403d38, .76, .12)
  const pale = material(0xb7aa8c, .92)
  group.add(box([1.9 * scale, 1.25 * scale, 1.45 * scale], barn, [-.35 * scale, .63 * scale, 0]))
  const barnRoof = mesh(new THREE.ConeGeometry(1.38 * scale, .72 * scale, 4), roof, [-.35 * scale, 1.62 * scale, 0])
  barnRoof.rotation.y = Math.PI / 4
  barnRoof.scale.z = .7
  group.add(barnRoof)
  group.add(cylinder(.48 * scale, 1.65 * scale, pale, [1.1 * scale, .83 * scale, .05 * scale], 18))
  group.add(mesh(new THREE.ConeGeometry(.55 * scale, .5 * scale, 18), roof, [1.1 * scale, 1.9 * scale, .05 * scale]))
  group.add(box([.66 * scale, .92 * scale, .05], material(0x2f3434, .72), [-.35 * scale, .48 * scale, .74 * scale]))
  for (const z of [-1.08, 1.08]) group.add(box([3.1 * scale, .08 * scale, .06 * scale], pale, [.15 * scale, .38 * scale, z * scale]))
  return markSolidProp(group, 1.85 * scale)
}

function createHayBales(scale = 1) {
  const group = new THREE.Group()
  const hay = material(0xad9253, .98)
  for (const [x, z, rotation] of [[-.52, -.3, .05], [.46, -.26, -.08], [-.1, .42, .03]] as Array<[number, number, number]>) {
    const bale = cylinder(.34 * scale, .58 * scale, hay, [x * scale, .34 * scale, z * scale], 18)
    bale.rotation.z = Math.PI / 2
    bale.rotation.y = rotation
    group.add(bale)
  }
  return markSolidProp(group, .92 * scale)
}

/**
 * The parish church: the one building in a village that is taller than the
 * roofline and older than the street it stands on, which is exactly why it is
 * what a village centre reads *from*. Everything else on The Circuit's high
 * street is two storeys of render and thatch.
 */
function createVillageChurch(scale = 1, stone = 0x8b8377) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = 1.9 * scale
  group.userData.footprintSolid = true
  const masonry = material(stone, .94)
  const slate = material(0x4a4f57, .82)
  const lead = material(0x6a7076, .6, .18)
  // Nave, with the chancel a step lower and narrower at the east end.
  group.add(box([2.5 * scale, 1.22 * scale, 1.32 * scale], masonry, [.2 * scale, .61 * scale, 0]))
  const naveRoof = mesh(sharedGeometry.cone, slate, [.2 * scale, 1.58 * scale, 0])
  naveRoof.scale.set(1.9 * scale, .72 * scale, .95 * scale)
  naveRoof.rotation.y = Math.PI / 4
  group.add(naveRoof)
  group.add(box([1.1 * scale, .95 * scale, 1.02 * scale], masonry, [1.95 * scale, .48 * scale, 0]))
  const chancelRoof = mesh(sharedGeometry.cone, slate, [1.95 * scale, 1.24 * scale, 0])
  chancelRoof.scale.set(.86 * scale, .5 * scale, .74 * scale)
  chancelRoof.rotation.y = Math.PI / 4
  group.add(chancelRoof)
  // West tower with a broach spire and a clock face towards the street.
  group.add(box([.92 * scale, 2.35 * scale, .92 * scale], masonry, [-1.32 * scale, 1.18 * scale, 0]))
  for (const [x, z] of [[-1.32, .48], [-1.32, -.48]] as XZ[]) {
    group.add(box([.42 * scale, .5 * scale, .045], material(0x2c3130, .7), [x * scale, 1.72 * scale, z * scale]))
  }
  group.add(mesh(new THREE.ConeGeometry(.66 * scale, 1.25 * scale, 8), lead, [-1.32 * scale, 2.98 * scale, 0]))
  group.add(cylinder(.03 * scale, .3 * scale, lead, [-1.32 * scale, 3.75 * scale, 0], 6))
  return group
}

/** A churchyard wall with a lychgate, and the headstones inside it. */
function createChurchyard(seed: number, scale = 1) {
  const group = new THREE.Group()
  const wall = material(0x817a6c, .98)
  const stone = material(0x9a9487, .96)
  const halfWidth = 2.9 * scale
  const halfDepth = 1.7 * scale
  for (const z of [-halfDepth, halfDepth]) {
    for (const side of [-1, 1]) {
      const run = box([halfWidth - .35 * scale, .3 * scale, .11 * scale], wall, [side * (halfWidth / 2 + .18 * scale), .15 * scale, z])
      run.castShadow = false
      group.add(run)
    }
  }
  for (const x of [-halfWidth, halfWidth]) {
    const run = box([.11 * scale, .3 * scale, halfDepth * 2], wall, [x, .15 * scale, 0])
    run.castShadow = false
    group.add(run)
  }
  // The lychgate: two posts and a little pitched roof over the south gap.
  for (const side of [-1, 1]) group.add(box([.09 * scale, .62 * scale, .09 * scale], material(0x5d4a38, .95), [side * .34 * scale, .31 * scale, halfDepth]))
  const lych = mesh(sharedGeometry.cone, material(0x6f5a3f, .9), [0, .78 * scale, halfDepth])
  lych.scale.set(.62 * scale, .26 * scale, .42 * scale)
  lych.rotation.y = Math.PI / 4
  group.add(lych)
  for (let index = 0; index < 11; index += 1) {
    const x = (hashUnit(seed + index * 13) - .5) * (halfWidth * 1.7)
    const z = (hashUnit(seed + index * 29) - .5) * (halfDepth * 1.3)
    const headstone = box([.16 * scale, (.2 + hashUnit(seed + index * 7) * .16) * scale, .05 * scale], stone, [x, .12 * scale, z])
    headstone.rotation.y = (hashUnit(seed + index * 17) - .5) * .3
    headstone.rotation.z = (hashUnit(seed + index * 23) - .5) * .1
    headstone.castShadow = false
    group.add(headstone)
  }
  return markSolidProp(group, 2.9 * scale)
}

/** A stone water trough. The reason a field of grass reads as pasture. */
function createWaterTrough(scale = 1) {
  const group = new THREE.Group()
  const stone = material(0x8a857a, .96)
  group.add(box([.92 * scale, .26 * scale, .38 * scale], stone, [0, .13 * scale, 0]))
  const water = box([.76 * scale, .05 * scale, .26 * scale], material(0x51767a, .32, .1), [0, .25 * scale, 0])
  water.castShadow = false
  group.add(water)
  return markSolidProp(group, .6 * scale)
}

/**
 * A few sheep, standing about the way sheep do — clustered, mostly facing the
 * same way, none of them on the fence line. Bodies only; at map scale a leg is
 * two pixels and four of them per animal is a hundred triangles for nothing.
 */
function createGrazingFlock(seed: number, count = 5, scale = 1) {
  const group = new THREE.Group()
  const fleece = material(0xbdb6a4, .99)
  const face = material(0x4c463f, .95)
  const heading = hashUnit(seed) * Math.PI * 2
  for (let index = 0; index < count; index += 1) {
    const angle = hashUnit(seed * 3.1 + index * 11) * Math.PI * 2
    const radius = hashUnit(seed * 7.3 + index * 5) * 1.15 * scale
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius * .7
    const facing = heading + (hashUnit(seed + index * 19) - .5) * 1.1
    const body = mesh(sharedGeometry.sphere, fleece, [x, .17 * scale, z])
    body.scale.set(.2 * scale, .15 * scale, .13 * scale)
    body.rotation.y = facing
    group.add(body)
    const head = mesh(sharedGeometry.sphere, face, [x + Math.cos(facing) * .2 * scale, .17 * scale, z - Math.sin(facing) * .2 * scale])
    head.scale.setScalar(.07 * scale)
    group.add(head)
  }
  return markAuthoredProp(group, 1.35 * scale)
}

/** A milestone. Where a village boundary is, and how far the assize town is. */
function createMilestone(scale = 1) {
  const group = new THREE.Group()
  const stone = material(0x9b9486, .96)
  const post = box([.2 * scale, .46 * scale, .12 * scale], stone, [0, .23 * scale, 0])
  group.add(post)
  const cap = mesh(new THREE.CylinderGeometry(.1 * scale, .1 * scale, .12 * scale, 10, 1, false, 0, Math.PI), stone, [0, .48 * scale, 0])
  cap.rotation.x = -Math.PI / 2
  cap.rotation.z = Math.PI / 2
  group.add(cap)
  return markAuthoredProp(group, .22 * scale)
}

/** A harrow left in the corner of a yard, which is where implements live. */
function createFarmImplement(seed: number, scale = 1) {
  const group = new THREE.Group()
  const iron = material(0x6b5c4a, .84, .12)
  const frame = box([1.05 * scale, .09 * scale, .62 * scale], iron, [0, .32 * scale, 0])
  group.add(frame)
  for (const side of [-1, 1]) {
    const wheel = cylinder(.19 * scale, .06 * scale, material(0x4a423a, .9), [side * .42 * scale, .19 * scale, .3 * scale], 10)
    wheel.rotation.x = Math.PI / 2
    group.add(wheel)
  }
  for (let index = 0; index < 5; index += 1) {
    const tine = box([.045 * scale, .26 * scale, .045 * scale], iron, [(-.42 + index * .21) * scale, .17 * scale, (hashUnit(seed + index) - .5) * .3 * scale])
    tine.castShadow = false
    group.add(tine)
  }
  group.add(cylinder(.035 * scale, .78 * scale, iron, [-.62 * scale, .38 * scale, 0], 6))
  return markAuthoredProp(group, .78 * scale)
}

/** The market cross a village green is measured from. */
function createMarketCross(scale = 1, stone = 0x9a9284) {
  const group = new THREE.Group()
  const masonry = material(stone, .9)
  for (let step = 0; step < 3; step += 1) {
    const tread = cylinder((.78 - step * .17) * scale, .11 * scale, masonry, [0, (.055 + step * .11) * scale, 0], 12)
    tread.castShadow = false
    group.add(tread)
  }
  group.add(cylinder(.11 * scale, 1.35 * scale, masonry, [0, 1.02 * scale, 0], 8))
  group.add(box([.46 * scale, .09 * scale, .12 * scale], masonry, [0, 1.6 * scale, 0]))
  group.add(box([.12 * scale, .34 * scale, .12 * scale], masonry, [0, 1.72 * scale, 0]))
  return markSolidProp(group, .82 * scale)
}

/**
 * A tractor, so the traffic on a country road is not four saloons and nothing
 * else. Modelled facing local +X like every other pooled vehicle, and slower
 * than the cars purely by being handed the same free-flow speed on a lane it is
 * bad at holding — the sim's per-agent `personal` multiplier does the rest.
 */
function createFarmTractor(color = 0x6f5a3a) {
  const group = new THREE.Group()
  group.add(box([.44, .2, .3], material(color, .5, .18), [.02, .3, 0]))
  group.add(box([.24, .24, .27], material(0x3c4a48, .34, .22), [-.09, .5, 0]))
  group.add(cylinder(.03, .3, material(0x2b2f2c, .6, .3), [.2, .48, 0], 6))
  const tire = material(0x1a1d1c, .92)
  for (const z of [-.2, .2]) {
    const rear = cylinder(.17, .075, tire, [-.13, .17, z], 12)
    rear.rotation.x = Math.PI / 2
    group.add(rear)
    const front = cylinder(.095, .06, tire, [.24, .095, z * .84], 10)
    front.rotation.x = Math.PI / 2
    group.add(front)
  }
  // Short but wide across the rear tyres, which is what it has to be judged on.
  return markVehicleHull(group, .32, .24, 'tractor', .62)
}

function createRailSignal(scale = 1) {
  const group = new THREE.Group()
  const steel = material(0x2d383a, .36, .46)
  group.add(cylinder(.035 * scale, 1.75 * scale, steel, [0, .88 * scale, 0], 8))
  group.add(box([.35 * scale, .74 * scale, .18 * scale], steel, [0, 1.48 * scale, 0]))
  for (const [y, color] of [[1.7, 0xb45346], [1.45, 0xd1a54d], [1.2, 0x5fa378]] as Array<[number, number]>) {
    const lens = mesh(new THREE.CircleGeometry(.065 * scale, 14), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .68, side: THREE.DoubleSide }), [0, y * scale, .095 * scale])
    group.add(lens)
  }
  return markAuthoredProp(group, .28 * scale)
}

function createHarborWorkboat(scale = 1, color = 0x5a6968) {
  const group = new THREE.Group()
  const hull = mesh(new THREE.CylinderGeometry(.52 * scale, .72 * scale, 2.25 * scale, 7), material(color, .52, .18), [0, .2 * scale, 0])
  hull.rotation.z = Math.PI / 2
  hull.rotation.y = Math.PI / 2
  group.add(hull)
  group.add(box([.82 * scale, .58 * scale, .74 * scale], material(0xc6c0ad, .78), [.2 * scale, .62 * scale, 0]))
  group.add(box([.72 * scale, .22 * scale, .76 * scale], material(0x3d5d64, .3, .2), [.2 * scale, .83 * scale, 0]))
  group.add(cylinder(.028 * scale, 1.18 * scale, material(0x354143, .4, .35), [-.22 * scale, 1.12 * scale, 0], 8))
  // These are berthed, so what trails off the stern is a mooring ripple, not
  // the wake of a boat under way. It used to be drawn at full strength and the
  // full length of a wake at speed, which put the loudest speed cue in the
  // harbour on the only vessels in it that were not moving.
  const wakeMaterial = new THREE.MeshBasicMaterial({ color: 0xc1dbd5, transparent: true, opacity: .1, depthWrite: false })
  for (const side of [-1, 1]) {
    const wake = mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.75 * scale, .02, 0), new THREE.Vector3(-1.25 * scale, .015, side * .16 * scale), new THREE.Vector3(-1.7 * scale, .01, side * .34 * scale)), 12, .022 * scale, 5, false), wakeMaterial)
    wake.castShadow = false
    group.add(wake)
  }
  return markSolidProp(group, 1.35 * scale)
}

function createHarborFuelDepot(scale = 1) {
  const group = new THREE.Group()
  const tank = material(0x8b8e86, .38, .44)
  const pipe = material(0x3d494a, .4, .42)
  group.add(box([2.4 * scale, .08 * scale, 1.15 * scale], material(0x6b6a62, .94), [0, .04 * scale, 0]))
  for (const x of [-.72, 0, .72]) {
    group.add(cylinder(.34 * scale, .82 * scale, tank, [x * scale, .45 * scale, 0], 20))
    group.add(mesh(new THREE.SphereGeometry(.34 * scale, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), tank, [x * scale, .86 * scale, 0]))
  }
  group.add(box([2.05 * scale, .055 * scale, .055 * scale], pipe, [0, .52 * scale, .42 * scale]))
  return markSolidProp(group, 1.35 * scale)
}

function createChargingBay(scale = 1) {
  const group = new THREE.Group()
  group.add(box([2.4 * scale, .06 * scale, 1.38 * scale], material(0x343e40, .94), [0, .03 * scale, 0]))
  const vehicle = createVehicle(0x516a6b)
  vehicle.scale.setScalar(.82 * scale)
  vehicle.position.set(-.25 * scale, .04, 0)
  group.add(vehicle)
  const charger = box([.22 * scale, .82 * scale, .22 * scale], material(0x788784, .38, .38), [.88 * scale, .42 * scale, .38 * scale])
  group.add(charger)
  group.add(box([.12 * scale, .18 * scale, .02], new THREE.MeshStandardMaterial({ color: 0x6bd1b5, emissive: 0x2d8a75, emissiveIntensity: .8 }), [.88 * scale, .57 * scale, .495 * scale]))
  return markSolidProp(group, 1.35 * scale)
}

function createOrbitalDock(scale = 1, accent = 0x72ced7) {
  const group = new THREE.Group()
  const hull = material(0x667174, .3, .55)
  const dark = material(0x26343c, .4, .42)
  group.add(box([2.8 * scale, .22 * scale, .5 * scale], hull, [0, .5 * scale, 0]))
  group.add(cylinder(.5 * scale, .68 * scale, dark, [1.36 * scale, .5 * scale, 0], 20))
  group.children[group.children.length - 1].rotation.z = Math.PI / 2
  group.add(mesh(new THREE.TorusGeometry(.48 * scale, .055 * scale, 10, 32), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .76, roughness: .25, metalness: .45 }), [1.72 * scale, .5 * scale, 0]))
  for (const x of [-.9, -.3, .3, .9]) group.add(box([.08 * scale, .035 * scale, .56 * scale], dark, [x * scale, .62 * scale, 0]))
  return markSolidProp(group, 1.65 * scale)
}

function createOrbitalTankFarm(scale = 1) {
  const group = new THREE.Group()
  const tank = material(0x889294, .32, .58)
  const frame = material(0x3b484d, .38, .48)
  for (const [x, z] of [[-.65, -.45], [.65, -.45], [-.65, .45], [.65, .45]] as XZ[]) {
    group.add(mesh(new THREE.SphereGeometry(.38 * scale, 18, 12), tank, [x * scale, .48 * scale, z * scale]))
    group.add(cylinder(.035 * scale, .82 * scale, frame, [x * scale, .4 * scale, z * scale], 8))
  }
  group.add(box([1.85 * scale, .08 * scale, 1.45 * scale], frame, [0, .04 * scale, 0]))
  return markSolidProp(group, 1.25 * scale)
}

function createOrbitalServiceBay(index: number, scale = 1) {
  const group = new THREE.Group()
  const deck = material(index % 2 ? 0x46565a : 0x3b4d53, .42, .48)
  const hull = material(0x7d898b, .34, .56)
  const dark = material(0x26363d, .38, .5)
  const signalColor = index % 2 ? 0x72ced7 : 0xd1b464
  const signal = new THREE.MeshStandardMaterial({ color: signalColor, emissive: signalColor, emissiveIntensity: .82, roughness: .28, metalness: .42 })
  group.add(box([2.7 * scale, .14 * scale, 1.65 * scale], deck, [0, .07 * scale, 0]))
  group.add(box([2.48 * scale, .035 * scale, .05 * scale], signal, [0, .16 * scale, -.67 * scale]))
  group.add(box([1.08 * scale, .66 * scale, .78 * scale], hull, [-.42 * scale, .48 * scale, 0]))
  group.add(box([.76 * scale, .32 * scale, .81 * scale], dark, [-.42 * scale, .51 * scale, .02 * scale]))
  for (const z of [-.43, .43]) {
    group.add(cylinder(.18 * scale, .72 * scale, hull, [.78 * scale, .42 * scale, z * scale], 18))
    group.add(mesh(new THREE.TorusGeometry(.19 * scale, .025 * scale, 8, 22), signal, [.78 * scale, .79 * scale, z * scale]))
  }
  for (const x of [-1.08, 1.08]) {
    group.add(cylinder(.025 * scale, .72 * scale, dark, [x * scale, .48 * scale, -.68 * scale], 8))
    group.add(box([.48 * scale, .035 * scale, .035 * scale], dark, [x * scale, .8 * scale, -.68 * scale]))
  }
  return markSolidProp(group, 1.58 * scale)
}

function createCurbCluster(seed: number, scale = 1) {
  const group = new THREE.Group()
  const bench = createBench(.62 * scale)
  bench.position.set(-.48 * scale, 0, 0)
  group.add(bench)
  const planter = createPlanter(.68 * scale)
  planter.position.set(.65 * scale, 0, .02 * scale)
  group.add(planter)
  if (seed % 2 === 0) {
    const post = material(0x303b3c, .45, .34)
    group.add(cylinder(.035 * scale, .92 * scale, post, [1.13 * scale, .46 * scale, 0], 8))
    group.add(box([.3 * scale, .4 * scale, .22 * scale], material(seed % 4 ? 0x536760 : 0x775c45, .7, .08), [1.13 * scale, .84 * scale, 0]))
  }
  return markAuthoredProp(group, 1.35 * scale)
}

function createParkedDeliveryBay(seed: number, scale = 1) {
  const group = new THREE.Group()
  const vehicle = createVehicle([0x5b6867, 0x6f594d, 0x4f626a][seed % 3])
  vehicle.scale.setScalar(.88 * scale)
  vehicle.position.set(-.35 * scale, .04, 0)
  group.add(vehicle)
  const crateMaterial = material(0x66513c, .94)
  for (let index = 0; index < 3; index += 1) group.add(box([.28 * scale, .24 * scale, .28 * scale], crateMaterial, [( .48 + (index % 2) * .31) * scale, (.14 + Math.floor(index / 2) * .24) * scale, ((index % 2) * .34 - .17) * scale]))
  group.add(box([2.05 * scale, .035 * scale, .95 * scale], material(0x3a4242, .96), [0, .01, 0]))
  return markSolidProp(group, 1.18 * scale)
}

function createFieldGate(scale = 1) {
  const group = new THREE.Group()
  const timber = material(0x675743, .98)
  for (const x of [-1.05, 1.05]) group.add(cylinder(.07 * scale, 1.1 * scale, timber, [x * scale, .55 * scale, 0], 10))
  for (const y of [.28, .58, .88]) group.add(box([1.95 * scale, .07 * scale, .08 * scale], timber, [0, y * scale, 0]))
  const diagonal = box([2.05 * scale, .06 * scale, .07 * scale], timber, [0, .58 * scale, .01 * scale])
  diagonal.rotation.z = -.34
  group.add(diagonal)
  for (const side of [-1, 1]) for (let index = 1; index <= 3; index += 1) {
    const post = cylinder(.035 * scale, .72 * scale, timber, [(side * (1.05 + index * .48)) * scale, .36 * scale, 0], 8)
    group.add(post)
  }
  return markSolidProp(group, 2.65 * scale)
}

function createMarshPatch(seed: number, scale = 1) {
  const group = new THREE.Group()
  const mud = material(seed % 2 ? 0x6d6b50 : 0x62674e, 1)
  const base = mesh(new THREE.CircleGeometry(.86 * scale, 24), mud, [0, .02, 0])
  base.rotation.x = -Math.PI / 2
  group.add(base)
  const reed = material(seed % 3 ? 0x697b57 : 0x7d8052, .98)
  for (let index = 0; index < 18; index += 1) {
    const angle = hashUnit(seed * 17 + index * 23) * Math.PI * 2
    const radius = .12 + hashUnit(seed * 31 + index) * .66
    const height = (.35 + hashUnit(seed * 47 + index * 7) * .52) * scale
    const blade = cylinder(.012 * scale, height, reed, [Math.cos(angle) * radius * scale, height / 2, Math.sin(angle) * radius * scale], 5)
    blade.rotation.z = (hashUnit(seed + index * 11) - .5) * .16
    blade.userData.marshBlade = true
    blade.userData.phase = hashUnit(seed * 7 + index) * Math.PI * 2
    group.add(blade)
  }
  return markAuthoredProp(group, .92 * scale)
}

function createRainGarden(seed: number, scale = 1) {
  const group = new THREE.Group()
  const soil = material(0x4e5043, 1)
  const basin = mesh(new THREE.CylinderGeometry(1.05 * scale, 1.18 * scale, .08 * scale, 28), soil, [0, .035 * scale, 0])
  basin.scale.z = .56
  group.add(basin)
  const stone = material(0x8b8a7d, .98)
  for (let index = 0; index < 9; index += 1) {
    const angle = index / 9 * Math.PI * 2
    const rock = mesh(new THREE.DodecahedronGeometry((.08 + hashUnit(seed + index) * .055) * scale, 0), stone, [Math.cos(angle) * .92 * scale, .09 * scale, Math.sin(angle) * .5 * scale])
    group.add(rock)
  }
  for (let index = 0; index < 12; index += 1) {
    const angle = hashUnit(seed * 13 + index * 7) * Math.PI * 2
    const radius = .18 + hashUnit(seed * 29 + index) * .62
    const plant = mesh(new THREE.ConeGeometry(.09 * scale, (.36 + hashUnit(seed + index * 19) * .3) * scale, 6), material(index % 3 ? 0x526b52 : 0x73805d, .96), [Math.cos(angle) * radius * scale, .24 * scale, Math.sin(angle) * radius * .54 * scale])
    group.add(plant)
  }
  return markAuthoredProp(group, 1.2 * scale)
}

function createAmbientActors(region: MapRegionKey) {
  const group = new THREE.Group()
  const isOrbit = region === 'orbit'
  const count = isOrbit ? 7 : region === 'ocean' ? 16 : region === 'nation' ? 14 : region === 'city' ? 18 : 12
  for (let index = 0; index < count; index += 1) {
    const actor = new THREE.Group()
    const groundBird = region === 'city' && index < 6
    const x = groundBird ? -12 + hashUnit(index * 37 + 8) * 24 : -17 + hashUnit(index * 37 + region.length * 11) * 34
    const y = groundBird ? .18 : (isOrbit ? 3.2 : 4.2) + hashUnit(index * 53 + 4) * (isOrbit ? 4.2 : 5.6)
    const z = groundBird ? 1.6 + hashUnit(index * 71 + 9) * 3.6 : -11 + hashUnit(index * 71 + 9) * 22
    actor.position.set(x, y, z)
    actor.userData.ambientActor = isOrbit ? 'drone' : groundBird ? 'groundBird' : 'bird'
    actor.userData.ambientOrigin = new THREE.Vector3(x, y, z)
    actor.userData.phase = hashUnit(index * 89 + region.length) * Math.PI * 2
    actor.userData.speed = .22 + hashUnit(index * 41 + 3) * .24
    if (isOrbit) {
      const hull = material(index % 2 ? 0x7d898c : 0x58696e, .32, .62)
      actor.add(mesh(new THREE.SphereGeometry(.11, 12, 8), hull))
      for (const axis of [-1, 1]) actor.add(box([.32, .025, .035], hull, [axis * .13, 0, 0]))
      const lens = mesh(new THREE.SphereGeometry(.028, 8, 6), new THREE.MeshBasicMaterial({ color: index % 2 ? 0x75d9df : 0xe1bd68 }), [0, 0, .1])
      actor.add(lens)
    } else {
      const color = region === 'ocean' ? 0xd5d6ce : region === 'city' ? 0x343a39 : 0x4a4c43
      const wingMaterial = new THREE.MeshStandardMaterial({ color, roughness: .92, side: THREE.DoubleSide })
      for (const side of [-1, 1]) {
        const wing = mesh(new THREE.PlaneGeometry(.22, .065), wingMaterial, [side * .1, 0, 0])
        wing.rotation.x = -Math.PI / 2
        wing.rotation.z = side * .2
        wing.userData.ambientWing = side
        actor.add(wing)
      }
      actor.scale.setScalar(groundBird ? .68 : region === 'ocean' ? 1.3 : .82 + hashUnit(index + 11) * .35)
    }
    group.add(actor)
  }
  return group
}

function decorateLevelParcel(
  root: THREE.Group,
  region: MapRegionKey,
  point: MapSceneTier,
  index: number,
  site: THREE.Vector3,
  roadPoint: THREE.Vector3,
  tangent: THREE.Vector3,
  definition: ArcDefinition,
) {
  const towardRoad = roadPoint.clone().sub(site).setY(0).normalize()
  const facing = Math.atan2(roadPoint.x - site.x, roadPoint.z - site.z)
  const addAt = (object: THREE.Object3D, lateral: number, depth: number, rotation = facing) => {
    object.position.copy(site).add(tangent.clone().multiplyScalar(lateral)).add(towardRoad.clone().multiplyScalar(depth))
    object.position.y = .04
    object.rotation.y = rotation
    root.add(object)
  }
  if (region === 'city') {
    // Headquarters occupy complete street frontages: modest neighboring
    // chambers, curb activity, trees and deliveries make each level a block.
    for (const direction of [-1, 1]) {
      const annex = createBlockBuilding(1.32 + (index % 2) * .14, 1.25 + ((point.data.tier + (direction > 0 ? 1 : 0)) % 3) * .36, 1.38, [0x665b50, 0x746354, 0x59615e][(index + (direction > 0 ? 1 : 0)) % 3], false)
      addAt(annex, direction * 2.18, -.42)
    }
    addAt(createParkedDeliveryBay(point.data.tier, .68), 1.66, 1.74, -Math.atan2(tangent.z, tangent.x))
    const parkedCar = createVehicle(point.data.tier % 2 ? 0x53646a : 0x6f5a4e)
    parkedCar.scale.setScalar(.74)
    addAt(parkedCar, -.45, 1.82, -Math.atan2(tangent.z, tangent.x))
    addAt(createCurbCluster(point.data.tier, .62), -1.7, 1.64, facing + Math.PI / 2)
    const tree = createTree(.55 + (index % 2) * .08, 0x4d624c)
    addAt(tree, -2.7, 1.28)
  } else if (region === 'nation') {
    // A regional court out here stands in its own grounds off the turnpike, so
    // what belongs beside it is the boundary of those grounds — a gate in the
    // fence, the trees that screen it, a bench by the door — rather than the
    // farmyard clutter that used to be dropped here.
    const gate = createFieldGate(.6)
    gate.userData.propAudit = { name: `nation-court-gate-${index}`, region: 'nation' }
    addAt(gate, -2.35, 1.15, facing + Math.PI / 2)
    for (const direction of [-1, 1]) {
      const tree = createTree(.62 + (index + direction + 1) * .035, 0x536449)
      addAt(tree, direction * 2.55, -.55)
    }
    const bench = createBench(.66)
    markAuthoredProp(bench, .44)
    bench.userData.propAudit = { name: `nation-court-bench-${index}`, region: 'nation' }
    addAt(bench, 2.4, 1.5, facing + Math.PI)
  } else if (region === 'ocean') {
    // A headquarters out here stands on its own island, so what belongs beside
    // it is the shore it stands on — the marsh in the lee — and not a moored
    // workboat and a stack of containers floating on open water beside it.
    const marsh = createMarshPatch(220 + point.data.tier, .58)
    addAt(marsh, index % 2 ? -1.15 : 1.15, -.35)
  } else if (region === 'continent') {
    // A true mirrored pair (same seed, same height, opposite side) reads as
    // a formal flanking wing; the previous per-direction height and dark,
    // modern palette made these the dominant, unreadably dark shapes right
    // at the counsel's own doorstep instead of a legible civic composition.
    const wingHeight = 1.32 + hashUnit(point.data.tier * 17 + index * 5) * .58
    const wingColor = index % 2 === 0 ? 0x9c9284 : 0x8f8672
    for (const direction of [-1, 1]) {
      const annex = createBlockBuilding(1.5, wingHeight, 1.5, wingColor, false, .18)
      addAt(annex, direction * 2.6, -.5)
    }
    addAt(createRainGarden(330 + point.data.tier, .62), -1.7, 1.62, facing)
    addAt(createTransitShelter(.48, definition.accent), 1.72, 1.7, facing + Math.PI / 2)
  } else {
    addAt(createOrbitalServiceBay(400 + point.data.tier, .48), -2.05, -.2, facing)
    addAt(createOrbitalDock(.42, index % 2 ? 0xc5a65f : 0x72ced7), 2.05, -.18, facing)
    addAt(createSolarArray(.3), index % 2 ? -2.6 : 2.6, 1.15, facing + .25)
  }
}

function addProceduralNearDistance(root: THREE.Group, region: MapRegionKey, route: THREE.Curve<THREE.Vector3>, definition: ArcDefinition) {
  // The Old Quarter's near-route texture now comes entirely from its block
  // grid, wards, and authored detail pass; scattering loose extra props the
  // length of the route here only fought that composed streetwall. Skipping
  // it also removes a couple dozen draw-call-bearing objects for free.
  //
  // The Circuit is out for the same reason and one more. Its texture is now
  // planned in corridor space — fields with boundaries, gates where a track
  // comes out, bales in the fields that have been cut — and a farmstead
  // dropped at a fixed offset from the route by this pass had no relationship
  // to any of it. Every floating hay bale in the audit came from here.
  //
  // The Treaty Sea is out because it has no near distance to texture: this pass
  // used to line the shipping lane with fourteen islets and a marsh apiece, and
  // a chain of identical islets either side of the route is the most obviously
  // procedural thing that was left on that map.
  if (region === 'city' || region === 'nation' || region === 'ocean') return
  const canPlace = (object: THREE.Object3D, position: THREE.Vector3) => {
    const footprint = Number(object.userData.footprintRadius ?? .7)
    return !root.children.some((child) => {
      if (child.userData.careerInfrastructure || child.userData.mapSelection) return false
      const other = Number(child.userData.footprintRadius ?? 0)
      if (!other) return false
      return Math.hypot(child.position.x - position.x, child.position.z - position.z) < (footprint + other) * .9
    })
  }
  const sampleCount = region === 'continent' ? 12 : 22
  const samples = Array.from({ length: sampleCount }, (_, index) => (index + .45) / sampleCount)
  samples.forEach((t, index) => {
    const point = route.getPointAt(t)
    const tangent = route.getTangentAt(t).normalize()
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    const side = index % 2 ? 1 : -1
    const distance = (region === 'orbit' ? 4.3 : 4.15) + hashUnit(index * 37 + region.length) * 2.8
    const position = point.clone().add(normal.multiplyScalar(distance * side)).setY(.02)

    const pickProp = () => {
      if (region === 'continent') {
        // No block buildings here: the civic axis gets its massing from the
        // instanced skyline and the mirrored campus pairs, so this pass stays
        // to small streetscape texture that will not read as extra scatter.
        if (index % 4 === 0) return createRainGarden(100 + index, .72)
        if (index % 4 === 1) return createTransitShelter(.55, definition.accent)
        if (index % 4 === 2) return createTree(.62 + hashUnit(index * 17) * .17, 0x40594d)
        return createChargingBay(.48)
      }
      if (index % 4 === 0) return createOrbitalServiceBay(index, .58)
      if (index % 4 === 1) return createOrbitalDock(.5, index % 2 ? 0x72ced7 : 0xc5a65f)
      if (index % 4 === 2) return createOrbitalTankFarm(.52)
      return createSolarArray(.37)
    }

    const object = pickProp()
    if (!canPlace(object, position)) return
    object.position.copy(position)
    object.rotation.y = -Math.atan2(tangent.z, tangent.x)
    root.add(object)

    // The civic axis mirrors its near-route texture across the route itself,
    // reinforcing the formal, symmetric read the campuses establish.
    if (region === 'continent') {
      const mirroredPosition = point.clone().add(normal.clone().multiplyScalar(-distance * side)).setY(.02)
      const twin = pickProp()
      if (canPlace(twin, mirroredPosition)) {
        twin.position.copy(mirroredPosition)
        twin.rotation.y = -Math.atan2(tangent.z, tangent.x)
        root.add(twin)
      }
    }
  })
}

function addAuthoredDetailPass(root: THREE.Group, region: MapRegionKey, route: THREE.Curve<THREE.Vector3>, definition: ArcDefinition) {
  const place = (object: THREE.Object3D, x: number, z: number, rotation = 0, minRouteDistance = 2.2) => {
    const position = new THREE.Vector3(x, 0, z)
    if (curveDistanceXZ(route, position) < minRouteDistance) return
    const footprint = Number(object.userData.footprintRadius ?? .45)
    const collision = root.children.some((child) => {
      if (child === object || child.userData.careerInfrastructure || child.userData.mapSelection) return false
      const childFootprint = Number(child.userData.footprintRadius ?? 0)
      if (!childFootprint) return false
      return Math.hypot(child.position.x - x, child.position.z - z) < (footprint + childFootprint) * .82
    })
    if (collision) return
    object.position.set(x, .02, z)
    object.rotation.y = rotation
    root.add(object)
  }
  const placeWater = (object: THREE.Object3D, x: number, z: number, rotation = 0) => {
    object.position.set(x, .02, z)
    object.rotation.y = rotation
    root.add(object)
  }
  if (region === 'city') {
    ;[[-13.5, 3.8], [-11.8, 3.9], [-5.2, 4.2], [7.6, 4.1], [12.5, 4], [16, 3.7]]
      .forEach(([x, z], index) => place(index % 2 ? createCafeSet(.72) : createPlanter(.9), x, z, index % 2 ? .35 : 0))
    ;[[-13.6, -2.7], [-10.9, -2.8], [-7, -2.7], [7.5, -2.8], [12.4, -2.7], [17, -2.8]]
      .forEach(([x, z]) => place(createWayfindingTotem(definition.accent), x, z, 0, 2.55))
    ;[[-13.25, -2.55, 0], [-8.8, -2.6, 0], [8.8, -2.6, Math.PI], [15.5, -2.55, Math.PI]]
      .forEach(([x, z, rotation]) => place(createTransitShelter(.72, definition.accent), x, z, rotation, 2.4))
    ;[[-12.6, 3.35], [-5.8, 3.55], [6.5, 3.5], [13.1, 3.3]]
      .forEach(([x, z]) => place(createBikeRack(.72), x, z, 0, 2.5))
    ;[[-13.4, 7.1], [-4.6, 6.9], [10.5, 7.1], [16.2, 6.8]]
      .forEach(([x, z], index) => place(createCivicKiosk(.72), x, z, index % 2 ? Math.PI : 0, 2.7))
  } else if (region === 'nation') {
    // Everything The Circuit has beside its road is now planned from the road
    // (see `addNationCorridor`). What is left for this pass is the furniture
    // that belongs to a different piece of infrastructure entirely — the
    // railway — sited on the line rather than sprinkled along the corridor.
    ;[[-15.2, 6.4, 0], [-10.4, 6.2, 0], [4.6, 6.05, Math.PI], [13.6, 6.35, Math.PI]]
      .forEach(([x, z, rotation], index) => {
        const signal = createRailSignal(.82)
        signal.userData.propAudit = { name: `nation-rail-signal-${index}`, region: 'nation' }
        place(signal, x, z, rotation, 2.7)
      })
    const shelter = createTransitShelter(.82, 0x6f8d78)
    shelter.userData.propAudit = { name: 'nation-halt-shelter', region: 'nation' }
    place(shelter, 1.4, 8.35, Math.PI, 3)
    ;[[-16.5, 12.4, .08], [16.5, 12.4, -.08]].forEach(([x, z, rotation], index) => {
      const outlier = createFarmstead(.68)
      outlier.userData.propAudit = { name: `nation-outfarm-${index}`, region: 'nation' }
      place(outlier, x, z, rotation, 3.2)
    })
  } else if (region === 'ocean') {
    // Nothing. Everything this pass put on the Treaty Sea — cargo stacks, fuel
    // depots, moored workboats, radar arrays, service sheds — was standing on
    // open water at y=.02 with no hull, no pontoon and no ground under it, which
    // is why the harbour read as a scatter of objects on a blue plane. The
    // region's furniture now lives on the islands and quays that can actually
    // carry it, and the water carries one vessel.
  } else if (region === 'continent') {
    ;[[-18, 1.6], [-13, 1.7], [-8, 1.6], [8, 1.6], [13, 1.7], [18, 1.6]]
      .forEach(([x, z], index) => place(index % 2 ? createPlanter(.9) : createWayfindingTotem(0x72b8ae), x, z, index % 2 ? 0 : Math.PI / 2, 2.8))
    ;[[-17, 11.6], [-11.5, 11.8], [-6, 11.7], [6, 11.7], [11.5, 11.8], [17, 11.6]]
      .forEach(([x, z], index) => place(index % 2 ? createSolarArray(.34) : createServiceShed(.62, 0x4e6163), x, z, 0, 2.5))
    ;[[-15.8, 6.55, 0], [-8.2, 6.45, 0], [8.2, 6.45, Math.PI], [15.8, 6.55, Math.PI]]
      .forEach(([x, z, rotation]) => place(createTransitShelter(.72, 0x72b8ae), x, z, rotation, 2.8))
    ;[[-16.2, -3], [-10.5, -3.15], [10.5, -3.15], [16.2, -3]]
      .forEach(([x, z], index) => place(createChargingBay(.7), x, z, index > 1 ? Math.PI : 0, 2.7))
    ;[[-13.5, 3.65], [-7, 3.6], [7, 3.6], [13.5, 3.65]]
      .forEach(([x, z]) => place(createCivicKiosk(.68), x, z, 0, 2.8))
    ;[[-19, 9.8], [-14.2, 10.1], [14.2, 10.1], [19, 9.8]]
      .forEach(([x, z], index) => place(createRadarArray(.42), x, z, index > 1 ? .4 : -.4, 2.8))
  } else {
    ;[[-20.5, -7.5], [-12.2, 10.5], [-4.5, -12], [4.5, -12], [12.2, 10.5], [20.5, -7.5]]
      .forEach(([x, z], index) => place(index % 2 ? createSolarArray(.44) : createRadarArray(.62), x, z, index * .38, 1.2))
    ;[[-15.8, -3.5, 0], [-7.1, 8.5, Math.PI], [2.1, -9.5, 0], [11.1, 8.2, Math.PI], [15.8, -3.8, Math.PI]]
      .forEach(([x, z, rotation], index) => place(createOrbitalDock(.62, index % 2 ? 0xc5a65f : 0x72ced7), x, z, rotation, .9))
    ;[[-18, -6.4], [-9, 11.2], [0, -12.6], [9, 11], [18, -6.4]]
      .forEach(([x, z]) => place(createOrbitalTankFarm(.62), x, z, 0, .9))
    ;[[-22, 2], [-13, -11], [13, -11], [22, 2]]
      .forEach(([x, z], index) => place(createSolarArray(.42), x, z, index % 2 ? -.32 : .32, .8))
  }

  // Populate the career corridor itself as a believable right-of-way. These
  // positions are sampled from the authored route (never scattered), rotated
  // to its tangent, and offset into functional curb, quay, or service zones.
  // Level parcels added later clear only the few props beside their entrances.
  const alongRoute = (
    samples: number[],
    distance: number,
    make: (index: number, side: number) => THREE.Object3D,
    clearance: number,
  ) => {
    samples.forEach((t, index) => {
      const point = route.getPointAt(t)
      const tangent = route.getTangentAt(t).normalize()
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      for (const side of [-1, 1]) {
        const position = point.clone().add(normal.clone().multiplyScalar(distance * side))
        place(make(index, side), position.x, position.z, Math.atan2(tangent.x, tangent.z) + (side < 0 ? Math.PI : 0), clearance)
      }
    })
  }

  if (region === 'city') {
    alongRoute([.055, .15, .25, .36, .48, .61, .73, .84, .94], 2.48, (index, side) => {
      if (index % 4 === 0) return createTransitShelter(.52, definition.accent)
      if (index % 4 === 1) return createCafeSet(.52)
      if (index % 4 === 2) return createBikeRack(.62)
      return side < 0 ? createPlanter(.74) : createCivicKiosk(.52)
    }, 1.82)
  } else if (region === 'nation') {
    // Roadside furniture clusters tightly around each town's route vertex
    // (t=1/6, 1/2, 5/6 correspond to x=-10, 0, 10) and stops entirely in
    // between, leaving the rural stretches between towns genuinely bare.
    alongRoute([.14, .19, .47, .53, .81, .86], 2.5, (index, side) => {
      return index % 2 ? createWayfindingTotem(0x6f8d78) : (side < 0 ? createBench(.58) : createServiceShed(.48, 0x655744))
    }, 2.1)
  } else if (region === 'ocean') {
    // The route through the harbour is a shipping channel, and a shipping
    // channel's own furniture is what this pass used to line it with: buoys at
    // 1.25 either side and a moored workboat at 3.15. Both were in the fairway
    // the simulation drives boats down. See `addOceanEnvironment`.
  } else if (region === 'continent') {
    alongRoute([.05, .14, .23, .33, .44, .56, .67, .77, .86, .95], 2.82, (index, side) => {
      if (index % 5 === 0) return createTransitShelter(.55, 0x72b8ae)
      if (index % 5 === 1) return createChargingBay(.46)
      if (index % 5 === 2) return createPlanter(.76)
      if (index % 5 === 3) return createBikeRack(.6)
      return side < 0 ? createCivicKiosk(.54) : createCafeSet(.5)
    }, 2.18)
  } else {
    alongRoute([.035, .11, .19, .28, .37, .47, .57, .67, .76, .85, .93, .985], 2.72, (index, side) => {
      if (index % 5 === 0) return createOrbitalServiceBay(index + (side < 0 ? 1 : 0), .58)
      if (index % 5 === 1) return createOrbitalDock(.48, side < 0 ? 0x72ced7 : 0xc5a65f)
      if (index % 5 === 2) return createOrbitalTankFarm(.5)
      if (index % 5 === 3) return createSolarArray(.36)
      return createRadarArray(.44)
    }, .72)
  }
}

/**
 * A pylon sign: the tall, road-facing board that announces a parade of shops
 * from further down the street than any shopfront can be read.
 *
 * It is the one piece of strip-mall vocabulary that is purely about the street
 * rather than the building, which is why it does more than its polygon count
 * suggests — it tells you the row behind it is one commercial development
 * rather than eight unrelated buildings that happen to be adjacent.
 */
function createPylonSign(accent = 0xa66d45, scale = 1) {
  const group = new THREE.Group()
  const post = material(0x585349, .78, .12)
  group.add(box([.09 * scale, 1.62 * scale, .09 * scale], post, [0, .81 * scale, 0]))
  const board = box([.86 * scale, .74 * scale, .07 * scale], material(accent, .66), [0, 1.42 * scale, 0])
  group.add(board)
  for (let row = 0; row < 3; row += 1) {
    group.add(box([.66 * scale, .13 * scale, .02 * scale], material(0xd8cba6, .5, .08), [0, (1.66 - row * .22) * scale, .05 * scale]))
  }
  group.add(box([.44 * scale, .06 * scale, .3 * scale], post, [0, .03 * scale, 0]))
  return group
}

/**
 * The back of a retail unit: a raised dock, a roller shutter and a pallet or
 * two. Strip-mall blocks are serviced from behind, and the rear elevation
 * looking nothing like the front is most of what makes the front read as a
 * front.
 */
function createLoadingDock(seed: number, scale = 1) {
  const group = new THREE.Group()
  const concrete = material(0x6c675d, .96)
  group.add(box([1.18 * scale, .17 * scale, .5 * scale], concrete, [0, .085 * scale, 0]))
  const shutter = box([.7 * scale, .52 * scale, .05 * scale], material(0x8a8578, .72, .1), [0, .43 * scale, -.24 * scale])
  group.add(shutter)
  const crates = Math.floor(hashUnit(seed * 3.7 + 1) * 3)
  for (let index = 0; index < crates; index += 1) {
    const crate = box([.2 * scale, .17 * scale, .19 * scale], material(index % 2 ? 0x7a6a4e : 0x6a6355, .9), [(-.36 + index * .33) * scale, .26 * scale, .1 * scale])
    group.add(crate)
  }
  if (hashUnit(seed * 5.1 + 9) < .45) {
    const bin = cylinder(.13 * scale, .3 * scale, material(0x4d5a52, .84), [.46 * scale, .15 * scale, .12 * scale], 8)
    group.add(bin)
  }
  return group
}

/** A parcel van: the vehicle that is always at the back of a retail parade. */
function createDeliveryVan(color = 0x8d8578) {
  const group = new THREE.Group()
  group.add(box([.78, .38, .36], material(color, .6, .08), [.02, .32, 0]))
  group.add(box([.26, .24, .33], material(0x3d4a4d, .34, .2), [-.4, .25, 0]))
  const tire = material(0x161a1a, .9)
  for (const x of [-.3, .26]) for (const z of [-.2, .2]) {
    const wheel = cylinder(.09, .06, tire, [x, .11, z], 10)
    wheel.rotation.x = Math.PI / 2
    group.add(wheel)
  }
  // The cab overhangs the body at the back, so the hull is .94 nose to tail.
  return markVehicleHull(group, .47, .23, 'van', .51, -.06)
}

function createVehicle(color = 0x7a4e45) {
  const group = new THREE.Group()
  group.add(box([.7, .23, .34], material(color, .42, .2), [0, .22, 0]))
  group.add(box([.36, .19, .31], material(0x344449, .28, .22), [-.04, .42, 0]))
  const tire = material(0x161a1a, .9)
  for (const x of [-.23, .24]) for (const z of [-.19, .19]) {
    const wheel = cylinder(.085, .06, tire, [x, .12, z], 12)
    wheel.rotation.x = Math.PI / 2
    group.add(wheel)
  }
  // .7 of body over .44 across the wheel faces.
  return markVehicleHull(group, .35, .22, 'car', .52)
}

function createTrain() {
  const group = new THREE.Group()
  const steel = material(0x615e57, .48, .24)
  const glass = new THREE.MeshStandardMaterial({ color: 0x5c7f83, emissive: 0x24383b, emissiveIntensity: .35, roughness: .3 })
  for (let i = 0; i < 3; i += 1) {
    const car = new THREE.Group()
    car.add(box([1.55, .62, .68], steel, [-i * 1.75, .45, 0]))
    for (const x of [-.52, 0, .52]) car.add(box([.3, .25, .04], glass, [x - i * 1.75, .52, .36]))
    group.add(car)
  }
  // Three 1.55 cars on a 1.75 pitch: 5.05 end to end, centred 1.75 behind the
  // leading car's origin, which is the point the spline actually drives.
  return markVehicleHull(group, 2.53, .34, 'train', 1.07, -1.75)
}

/**
 * A bow wave and quarter wake behind a hull, driven every frame from the
 * vessel's own measured speed.
 *
 * The vessels on this map had no wake at all, so a ferry crossing the Treaty
 * Sea slid over a surface it never disturbed, and the only wakes in the scene
 * belonged to *moored* workboats and were painted on at a constant opacity —
 * exactly backwards. The arms are drawn once and then scaled and faded, which
 * costs a scale write per frame rather than any geometry work, and they hide
 * completely below steerage way so a berthed vessel shows nothing.
 */
function attachWake(group: THREE.Group, scale = 1) {
  const wakeMaterial = new THREE.MeshBasicMaterial({ color: 0xc7ded8, transparent: true, opacity: 0, depthWrite: false })
  const arms: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const arm = mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-.9 * scale, .02, 0),
      new THREE.Vector3(-2.1 * scale, .015, side * .4 * scale),
      new THREE.Vector3(-3.5 * scale, .01, side * 1.02 * scale),
    ), 16, .034 * scale, 5, false), wakeMaterial)
    arm.castShadow = false
    arm.receiveShadow = false
    arm.visible = false
    group.add(arm)
    arms.push(arm)
  }
  group.userData.wake = { material: wakeMaterial, arms }
  return group
}

function createFerry() {
  const group = new THREE.Group()
  const hull = mesh(new THREE.CylinderGeometry(.62, .85, 2.5, 5), material(0x4d5959, .55, .18), [0, .18, 0])
  hull.rotation.z = Math.PI / 2
  hull.rotation.y = Math.PI / 2
  group.add(hull)
  group.add(box([1.1, .52, .8], material(0xe0d8c2, .75), [0, .65, 0]))
  group.add(box([.78, .22, .7], material(0x49696f, .34, .18), [0, .94, 0]))
  markVehicleHull(group, 1.25, .85, 'ferry', 1.05)
  return attachWake(group, 1.15)
}

function createOrbitalCraft() {
  const group = new THREE.Group()
  const hull = material(0xb3bbb9, .3, .58)
  const dark = material(0x263744, .38, .34)
  const body = mesh(new THREE.CapsuleGeometry(.24, 1.05, 8, 20), hull, [0, .3, 0])
  body.rotation.z = Math.PI / 2
  group.add(body)
  group.add(box([.42, .07, 1.1], dark, [-.05, .28, 0]))
  const engine = new THREE.PointLight(0x6ee2ef, 2.8, 5, 2)
  engine.position.set(-.72, .3, 0)
  group.add(engine)
  return group
}

function createLawyer(gender: CharacterGender, tier: number, playerName: string) {
  const root = new THREE.Group()
  const rig = buildStylizedCounsel(gender, tier)
  // Architectural scale: counsel should read as a person in the district,
  // not as a figure nearly as tall as a multi-storey headquarters.
  rig.root.scale.setScalar(.278)
  rig.root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  root.add(rig.root)
  const presenceLight = new THREE.PointLight(0xffd189, 2.05, 6.5, 2)
  presenceLight.position.set(0, 1.55, .86)
  root.add(presenceLight)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(.45, 40),
    new THREE.MeshBasicMaterial({ color: 0x071015, transparent: true, opacity: .32, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.scale.z = .34
  shadow.position.y = .028
  root.add(shadow)
  const beacon = new THREE.Mesh(
    new THREE.RingGeometry(.48, .55, 56),
    new THREE.MeshBasicMaterial({ color: 0xe1bd67, transparent: true, opacity: .72, side: THREE.DoubleSide, depthWrite: false }),
  )
  beacon.rotation.x = -Math.PI / 2
  beacon.position.y = .055
  ;(beacon.material as THREE.MeshBasicMaterial).depthTest = false
  beacon.renderOrder = 40
  beacon.userData.lawyerBeacon = true
  root.add(beacon)
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xf3d082, transparent: true, opacity: .96, depthTest: false, depthWrite: false })
  const marker = mesh(new THREE.OctahedronGeometry(.11, 0), markerMaterial, [0, 1.82, 0])
  marker.renderOrder = 52
  marker.userData.playerMarker = true
  marker.userData.playerMarkerBaseY = 1.82
  root.add(marker)
  const playerLabel = labelSprite(['YOU', playerName], 1.28, '#f0cf7c')
  playerLabel.position.set(0, 2.12, 0)
  playerLabel.userData.mapLabelAlways = true
  root.add(playerLabel)
  root.userData.lawyer = true
  root.userData.playerName = playerName
  return { root, rig, beacon, marker }
}

/**
 * Counsel's blink, which the rig deliberately does not own.
 *
 * Eyes are meshes rather than joints, so this is not motion the actor would
 * ever drive — the same division the portrait already makes, where gaze and
 * blink layer on top of the clip. It is also the last surviving line of the
 * hand-written animation this file used to do, and the only one whose absence
 * would be noticed: a figure that never blinks reads as a waxwork however good
 * its walk is.
 */
function blinkCounsel(rig: StylizedCounselRig, elapsed: number) {
  const blinkPhase = elapsed % 6.4
  const blink = blinkPhase > 3.05 && blinkPhase < 3.28 ? Math.sin((blinkPhase - 3.05) / .23 * Math.PI) : 0
  rig.eyes.forEach((eye) => { eye.scale.y = Math.max(.09, 1 - blink * .92) })
}


/**
 * Height of a ground wash.
 *
 * Above every paved surface the districts draw — the apron at .048, the
 * carriageway at .07 and its markings at .088 — and below the .02 base of any
 * building, so a wash covers the ground and the street and is occluded by
 * whatever is standing on them.
 */
const WASH_Y = .095

const washGeometry = new THREE.CircleGeometry(1, 64)
washGeometry.userData.mapShared = true

/**
 * A soft transparent wash over a district's own ground area.
 *
 * The map already had two indicators for a place — `landmarkRing` on hover and
 * `selectionRing` on selection — and both are thin outlines at a point. An
 * outline says "here"; a district is an *area*, and a retainer is held over
 * that area rather than at its centre pin, so the area is what has to read.
 *
 * Deliberately depth-tested, which is the opposite of what the rings beside it
 * do. Those disable `depthTest` and climb to `renderOrder` 40-44 so they show
 * through terrain, and the cost of that trick is that they paint over anything
 * drawn earlier — it is exactly why map labels had to be pushed to
 * `renderOrder` 70 to stay legible. A wash covering a whole district would be a
 * far worse offender, and it does not want the trick anyway: an area highlight
 * that is hidden where buildings stand on it is describing the ground
 * correctly. Depth-tested and left at the default render order, it cannot
 * reach a label.
 */
function createRegionWash(color: number, opacity: number) {
  const wash = new THREE.Mesh(
    washGeometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      // The paving is a few millimetres below this and co-planar over large
      // areas; without the bias the two flicker against each other at distance.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  )
  wash.rotation.x = -Math.PI / 2
  wash.position.y = WASH_Y
  wash.castShadow = false
  wash.receiveShadow = false
  wash.userData.regionWash = true
  return wash
}

/**
 * A landmark held under a standing retainer flies the same colour a rival
 * compound does once *its* retainer is signed (see `createRivalBuilding`'s
 * `held` branch) — a mast and flag in the same cached teal, rather than a
 * second "this is yours now" vocabulary invented just for landmarks. Sized
 * off the landmark's own pick radius so a plaza's marker and a courthouse's
 * are proportionate to the places they mark, not identical props dropped on
 * both.
 *
 * The mast alone was too small to answer "where are my retainers?" from the
 * overview the region opens at: a .035-radius pole is under a pixel wide at
 * that distance, and the ring around it is a hairline. The wash is what makes
 * a held district legible as territory rather than as a pin, and it is the
 * same teal, so it reads as the flag's own ground rather than as a new symbol.
 */
function createHeldLandmarkAccent(radius: number) {
  const group = new THREE.Group()
  const mastHeight = 1.55 + radius * .22
  group.add(cylinder(.035, mastHeight, material(0x3d4547, .5), [0, mastHeight / 2, 0], 8))
  group.add(box([.72, .42, .03], material(0x6cae98, .5, .18), [.4, mastHeight - .26, 0]))
  const held = createRegionWash(0x6cae98, .17)
  held.scale.setScalar(radius)
  group.add(held)
  const ring = mesh(
    new THREE.RingGeometry(radius * .78, radius * .78 + .1, 48),
    new THREE.MeshBasicMaterial({ color: 0x6cae98, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = .05
  ring.castShadow = false
  ring.receiveShadow = false
  group.add(ring)
  group.userData.heldLandmarkAccent = true
  return group
}

function emphasisRing(kind: MapViewMode, key: string, color: number, radius = 1.35) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + .14, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .76, side: THREE.DoubleSide, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = .17
  ring.visible = false
  ring.userData.mapEmphasisKind = kind
  ring.userData.mapLabelKey = key
  return ring
}

function createDestinationMarker(point: MapSceneTier) {
  const group = new THREE.Group()
  const available = point.state !== 'locked'
  const color = point.state === 'current' ? 0xf0cb70 : point.state === 'complete' ? 0x72b7a4 : point.state === 'next' ? 0xd7ba73 : 0x777a75
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(.34, .43, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: available ? .82 : .24, side: THREE.DoubleSide, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = .04
  ring.renderOrder = 20
  group.add(ring)
  const stem = cylinder(.018, .54, material(color, .38, .48), [0, .34, 0], 8)
  stem.visible = available
  group.add(stem)
  const diamond = mesh(new THREE.OctahedronGeometry(.095, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: available ? .68 : .08, roughness: .3, metalness: .48 }), [0, .68, 0])
  diamond.visible = available
  group.add(diamond)
  group.userData.destinationMarker = true
  group.userData.destinationAvailable = available
  group.userData.destinationBaseY = group.position.y
  group.userData.destinationPhase = point.data.tier * .67
  return group
}

/**
 * A watercourse: its bed and the water in it, from one curve.
 *
 * Both come from `map-water`, which is now the only water implementation in the
 * scene — the Treaty Sea's open water is the same noise, the same normal
 * reconstruction and the same shading, differing where a river genuinely differs
 * (see that module's header). The bed is added first and slightly wider, so the
 * water is seen to be *in* a channel; a river laid straight on the ground was
 * most of why The Circuit's read as a ribbon dropped on a lawn.
 *
 * `banks` is a river's own clearance corridor. Recording it here means a single
 * call gives a district a watercourse and keeps the buildings, props and traffic
 * out of it, rather than each caller remembering to do both.
 */
function addWatercourse(
  root: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  options: RiverOptions & { bedColor?: number; samples?: number },
) {
  const surfaceY = options.y ?? .045
  root.add(createRiverBed(curve, { ...options, y: surfaceY }, options.bedColor ?? 0x6b6752))
  const water = createRiverSurface(curve, { ...options, y: surfaceY })
  root.add(water)
  const points: XZ[] = []
  const samples = options.samples ?? 40
  for (let index = 0; index <= samples; index += 1) {
    const point = curve.getPointAt(index / samples)
    points.push([point.x, point.z])
  }
  clearanceCorridors(root).push({ points, halfWidth: options.width / 2 + .3, label: 'river' })
  return water
}

/**
 * The masonry sides of a cut channel: a vertical face at the water's edge and
 * the coping walk on top of it, both following the water's own curve.
 *
 * This is what was missing from the Millrace, and the reason the canal read as
 * a painted strip. Its quays were two straight boxes at a constant x while the
 * channel meanders through .6 of a unit, so at the south end the water crossed
 * .21 into the west quay and at the north end .21 into the east one — the water
 * was literally inside the masonry — while in the middle a strip of open ground
 * showed between the two. Deriving both from the curve the water is built from
 * means the three cannot disagree at any point along the length.
 *
 * The vertical face is the part that does the work. A surface with nothing at
 * its edge is a surface lying *on* the ground however good its shader is; a
 * surface with a wall standing out of it is water in a channel, and the wall is
 * also what stops the eye reaching the bed skirt and the carriageways that run
 * underneath the crossing points.
 *
 * One buffer per side carrying both faces, because this is a static ribbon that
 * never moves and two draw calls for a canal would be two too many.
 */
function canalQuays(
  curve: THREE.Curve<THREE.Vector3>,
  {
    innerHalf,
    walk = .72,
    topY = .16,
    footY = -.07,
    samples = 64,
    color = 0x827d71,
  }: { innerHalf: number; walk?: number; topY?: number; footY?: number; samples?: number; color?: number },
) {
  const positions: number[] = []
  const indices: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3()
  for (let step = 0; step <= samples; step += 1) {
    const t = step / samples
    const point = curve.getPointAt(t)
    side.crossVectors(up, curve.getTangentAt(Math.min(.9995, t)).normalize()).normalize()
    for (const hand of [-1, 1]) {
      const innerX = point.x + side.x * innerHalf * hand
      const innerZ = point.z + side.z * innerHalf * hand
      const outerX = point.x + side.x * (innerHalf + walk) * hand
      const outerZ = point.z + side.z * (innerHalf + walk) * hand
      // Foot of the wall, top of the wall, then the back of the coping walk.
      positions.push(innerX, footY, innerZ, innerX, topY, innerZ, outerX, topY, outerZ)
    }
    if (step < samples) {
      const base = step * 6
      for (const hand of [0, 1]) {
        const a = base + hand * 3
        const b = a + 6
        // Wound so both sides face outward from the channel; the water is
        // opaque and the walk is walked on, so neither needs a back face.
        const flip = hand === 0
        for (const [p, q] of [[0, 1], [1, 2]]) {
          indices.push(
            ...(flip
              ? [a + p, b + p, a + q, a + q, b + p, b + q]
              : [a + p, a + q, b + p, a + q, b + q, b + p]),
          )
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const quay = new THREE.Mesh(geometry, material(color, .98))
  quay.castShadow = false
  quay.receiveShadow = true
  return quay
}

function createMountain(scale = 1, color = 0x706b5c, snow = false) {
  const group = new THREE.Group()
  const geometry = new THREE.PlaneGeometry(5.8 * scale, 4.5 * scale, 18, 14)
  const positions = geometry.attributes.position as THREE.BufferAttribute
  const colors: number[] = []
  const base = new THREE.Color(color)
  const snowColor = new THREE.Color(0xd7d4c6)
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index) / scale
    const y = positions.getY(index) / scale
    const radial = Math.sqrt((x / 2.9) ** 2 + (y / 2.25) ** 2)
    const ridge = Math.max(0, 1 - radial)
    const shoulder = Math.max(0, 1 - Math.sqrt(((x + 1.25) / 1.7) ** 2 + ((y - .35) / 1.45) ** 2))
    const texture = (hashUnit(index * 29 + scale * 113) - .5) * .2
    const height = (Math.pow(ridge, 1.45) * 3.5 + Math.pow(shoulder, 1.7) * 1.1 + texture * ridge) * scale
    positions.setZ(index, height)
    const snowMix = snow ? THREE.MathUtils.smoothstep(height / scale, 2.6, 3.55) : 0
    const tone = base.clone().offsetHSL(0, -.015, texture * .1).lerp(snowColor, snowMix)
    colors.push(tone.r, tone.g, tone.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  geometry.rotateX(-Math.PI / 2)
  const mountain = mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }))
  group.add(mountain)
  return group
}

function createWindTurbine(scale = 1) {
  const group = new THREE.Group()
  const pale = material(0xc5cbc4, .42, .18)
  group.add(cylinder(.06 * scale, 2.8 * scale, pale, [0, 1.4 * scale, 0], 12))
  const rotor = new THREE.Group()
  rotor.position.set(0, 2.75 * scale, .04)
  for (let index = 0; index < 3; index += 1) {
    const blade = box([.09 * scale, 1.25 * scale, .045 * scale], pale, [0, .58 * scale, 0])
    blade.position.y = .55 * scale
    blade.rotation.z = index * Math.PI * 2 / 3
    rotor.add(blade)
  }
  rotor.userData.turbine = true
  rotor.userData.speed = .28 + scale * .05
  group.add(rotor)
  return group
}

function createSky(definition: ArcDefinition) {
  const uniforms = {
    uTop: { value: new THREE.Color(definition.skyTop) },
    uBottom: { value: new THREE.Color(definition.skyBottom) },
    uTime: { value: 0 },
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(170, 56, 28),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vWorld; void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 uTop; uniform vec3 uBottom; uniform float uTime; varying vec3 vWorld; void main(){float h=clamp(normalize(vWorld).y*.72+.38,0.,1.);float glow=.035*sin(uTime*.08+normalize(vWorld).x*4.);gl_FragColor=vec4(mix(uBottom,uTop,h)+glow,1.);}',
    }),
  )
  sky.userData.skyUniforms = uniforms
  return sky
}

function createCloud(index: number, region: MapRegionKey) {
  const group = new THREE.Group()
  const opacity = (region === 'city' ? .19 + hashUnit(index * 31 + 4) * .12 : .17 + hashUnit(index * 31 + 4) * .1)
  const cloudMaterial = new THREE.MeshStandardMaterial({ color: index % 3 === 0 ? 0xf0eee4 : 0xe3e5df, transparent: true, opacity, roughness: 1, depthWrite: false })
  const parts = 5 + index % 3
  for (let i = 0; i < parts; i += 1) {
    const center = (parts - 1) / 2
    const distance = Math.abs(i - center)
    const part = mesh(sharedGeometry.sphere, cloudMaterial, [(i - center) * .78, distance * -.07, (i % 2) * .28])
    part.scale.set(1.18 - distance * .09, .34 + (i % 3) * .08, .64 + hashUnit(index * 17 + i) * .12)
    part.castShadow = false
    group.add(part)
  }
  // Clouds belong in the sky. Kept low and small they read as fog banks
  // parked in the street, so they sit above the tallest tower and are scaled
  // up to match the distance they are now seen from.
  const cloudScale = 2.2 + hashUnit(index * 23 + 9) * 2
  group.scale.setScalar(cloudScale)
  const x = -62 + hashUnit(index * 43 + 3) * 124
  const y = 22 + hashUnit(index * 59 + 7) * 13
  // Weighted behind the district rather than over it: a cloud crossing the
  // camera's own foreground reads as a smear on the lens, not as weather.
  const z = -78 + hashUnit(index * 71 + 13) * 62
  group.position.set(x, y, z)
  group.userData.cloud = true
  group.userData.speed = .32 + hashUnit(index * 37 + 5) * .4
  group.userData.cloudBaseY = y
  group.userData.cloudBaseZ = z
  group.userData.cloudPhase = hashUnit(index * 83 + 11) * Math.PI * 2
  group.userData.cloudWrapMin = -78
  group.userData.cloudWrapMax = 78
  // The drift wraps in x, which used to make a cloud vanish from one edge and
  // reappear at the other. Fading it out over the last stretch of the run
  // hides the seam entirely.
  group.userData.cloudMaterial = cloudMaterial
  group.userData.cloudOpacity = opacity
  return group
}

function createAtmosphericPoints(region: MapRegionKey) {
  const count = region === 'orbit' ? 520 : region === 'ocean' ? 110 : 150
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (hashUnit(i * 17 + region.length * 31) - .5) * (region === 'orbit' ? 110 : 48)
    positions[i * 3 + 1] = region === 'orbit' ? -7 + hashUnit(i * 29 + 11) * 52 : .8 + hashUnit(i * 13 + 37) * 9
    positions[i * 3 + 2] = (hashUnit(i * 43 + region.charCodeAt(0)) - .5) * (region === 'orbit' ? 90 : 32)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: region === 'ocean' ? 0xd5e7e2 : region === 'orbit' ? 0xdde8ff : 0xe1d4ad, size: region === 'orbit' ? .105 : .035, transparent: true, opacity: region === 'orbit' ? .72 : .28, depthWrite: false }))
  points.userData.atmosphere = true
  return points
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.Points) {
      if (!object.geometry?.userData.characterShared && !object.geometry?.userData.mapShared) object.geometry?.dispose?.()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((entry) => {
        // Shared materials are reused by the next mount, exactly like shared
        // geometry. Disposing them here would leave a remounted map drawing
        // against released GPU resources.
        if (entry.userData.characterShared || entry.userData.mapShared) return
        const spriteMap = (entry as THREE.SpriteMaterial).map
        spriteMap?.dispose()
        entry.dispose()
      })
    }
  })
}

/**
 * Colour is the only thing most of these materials disagree on: the palette
 * changes per building while roughness, metalness, and emissive rarely do.
 * Grouping on everything *except* colour, then moving colour into a vertex
 * attribute, turns ~170 material variants into ~50 batches.
 */
function batchFamilyKey(source: THREE.Material) {
  const standard = source as THREE.MeshStandardMaterial
  return [
    source.type, standard.roughness, standard.metalness, source.side, source.opacity,
    standard.emissive?.getHexString() ?? '', standard.emissiveIntensity ?? '',
    standard.map?.uuid ?? '', standard.flatShading ? 1 : 0,
  ].join('|')
}

/**
 * Unlike the shared materials these are cloned from, batch materials live and
 * die with one mount: a family key can name a per-mount texture, so caching
 * them for the process would grow a little on every region change. The clone
 * therefore drops the shared flag it inherited and lets `disposeScene` collect
 * it alongside the merged geometry it was built for.
 */
type BatchMaterialCache = Map<string, THREE.Material>

function batchMaterialFor(source: THREE.Material, family: string, cache: BatchMaterialCache) {
  const cached = cache.get(family)
  if (cached) return cached
  const batched = source.clone()
  const standard = batched as THREE.MeshStandardMaterial
  // White base so the baked vertex colour comes through unmodulated.
  standard.color?.setRGB(1, 1, 1)
  batched.vertexColors = true
  batched.userData = {}
  cache.set(family, batched)
  return batched
}

function isBatchable(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || (object as THREE.InstancedMesh).isInstancedMesh) return false
  // A mesh with children would take them along when it is removed.
  if (object.children.length > 0) return false
  if (Array.isArray(object.material)) return false
  const source = object.material as THREE.MeshStandardMaterial
  // Transparent surfaces are depth-sorted against each other per object, so
  // merging them would freeze their draw order.
  if (source.transparent || source.depthWrite === false || !source.color) return false
  const { attributes } = object.geometry
  return Boolean(attributes.position && attributes.normal && attributes.uv)
}

/**
 * Bakes `meshes` into one mesh per material family, parented to `container` and
 * positioned relative to it, then removes the originals.
 */
function bakeBatches(container: THREE.Object3D, meshes: THREE.Mesh[], cache: BatchMaterialCache) {
  if (meshes.length < 2) return
  const families = new Map<string, THREE.Mesh[]>()
  meshes.forEach((item) => {
    const family = batchFamilyKey(item.material as THREE.Material)
    // Shadow flags are per mesh, so they have to agree within a batch.
    const key = `${family}|${item.castShadow ? 1 : 0}|${item.receiveShadow ? 1 : 0}`
    const existing = families.get(key)
    if (existing) existing.push(item)
    else families.set(key, [item])
  })

  const toContainer = new THREE.Matrix4().copy(container.matrixWorld).invert()
  const local = new THREE.Matrix4()
  families.forEach((group) => {
    if (group.length < 2) return
    // `mergeGeometries` needs every input to agree on being indexed, and indices
    // are worth keeping: dropping them tripled the vertex data to upload, which
    // cost more at load than the draw calls it saved.
    const indexed = group.filter((item) => item.geometry.index)
    const unindexed = group.filter((item) => !item.geometry.index)
    if (indexed.length && unindexed.length) {
      bakeBatches(container, indexed, cache)
      bakeBatches(container, unindexed, cache)
      return
    }
    const geometries = group.map((item) => {
      const geometry = item.geometry.clone()
      // Some scenery already ships its own vertex colours — the shaded landforms,
      // for instance. The shader multiplies those by the material colour, so the
      // two are combined here; overwriting them flattens the mesh to a single
      // tone.
      const authored = geometry.getAttribute('color')
      Object.keys(geometry.attributes).forEach((name) => {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name)
      })
      geometry.applyMatrix4(local.multiplyMatrices(toContainer, item.matrixWorld))
      const { color } = item.material as THREE.MeshStandardMaterial
      const count = geometry.attributes.position.count
      const colors = new Float32Array(count * 3)
      // `color` is already in the renderer's working space, so it is copied raw.
      for (let index = 0; index < count; index += 1) {
        colors[index * 3] = color.r * (authored ? authored.getX(index) : 1)
        colors[index * 3 + 1] = color.g * (authored ? authored.getY(index) : 1)
        colors[index * 3 + 2] = color.b * (authored ? authored.getZ(index) : 1)
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      return geometry
    })
    const merged = mergeGeometries(geometries, false)
    geometries.forEach((geometry) => geometry.dispose())
    if (!merged) return

    const source = group[0].material as THREE.Material
    const batch = new THREE.Mesh(merged, batchMaterialFor(source, batchFamilyKey(source), cache))
    batch.castShadow = group[0].castShadow
    batch.receiveShadow = group[0].receiveShadow
    batch.userData.staticBatch = true
    group.forEach((item) => item.removeFromParent())
    container.add(batch)
  })
}

/**
 * Collects the batchable meshes under `node`. Anything in `live` is not
 * returned: it becomes its own batching boundary so that it keeps moving,
 * hiding, or hit-testing independently, and its interior is baked into it
 * rather than lifted out of it.
 */
function collectBatchable(node: THREE.Object3D, live: Set<THREE.Object3D>, out: THREE.Mesh[], boundaries: THREE.Object3D[]) {
  node.children.forEach((child) => {
    if (live.has(child)) {
      boundaries.push(child)
      return
    }
    if (isBatchable(child)) out.push(child)
    collectBatchable(child, live, out, boundaries)
  })
}

function bakeBoundary(boundary: THREE.Object3D, live: Set<THREE.Object3D>, cache: BatchMaterialCache) {
  const meshes: THREE.Mesh[] = []
  const nested: THREE.Object3D[] = []
  collectBatchable(boundary, live, meshes, nested)
  bakeBatches(boundary, meshes, cache)
  nested.forEach((child) => bakeBoundary(child, live, cache))
}

/**
 * Static scenery is authored as thousands of small meshes — a building is a
 * facade plus one mesh per window, cornice, and awning — which reads well but
 * costs a draw call each. This bakes them down once the world is built, so the
 * authoring code above stays untouched.
 *
 * Cells that fade or are hit-tested as a unit (the player-occluding buildings)
 * keep their own batches. Everything else pools with its neighbours into a
 * spatial grid, which is what makes the batches large: the district is authored
 * as ~355 small cells, so batching within each one would barely help.
 *
 * `live` must list every object that moves, hides, or is hit-tested on its own.
 * Pooling reparents meshes, so anything omitted from it gets frozen in place —
 * the callers build it from the same set the animation loop drives.
 */
function batchStaticScenery(world: THREE.Group, live: Set<THREE.Object3D>, gridSize = 30) {
  world.updateMatrixWorld(true)
  const cache: BatchMaterialCache = new Map()
  const pooled = new Map<string, THREE.Mesh[]>()
  const position = new THREE.Vector3()

  world.children.slice().forEach((cell) => {
    if (live.has(cell)) {
      bakeBoundary(cell, live, cache)
      return
    }
    const meshes: THREE.Mesh[] = []
    const boundaries: THREE.Object3D[] = []
    collectBatchable(cell, live, meshes, boundaries)
    boundaries.forEach((child) => bakeBoundary(child, live, cache))

    if (cell.userData.playerOccluder) {
      bakeBatches(cell, meshes, cache)
      return
    }
    meshes.forEach((item) => {
      item.getWorldPosition(position)
      const key = `${Math.floor(position.x / gridSize)}:${Math.floor(position.z / gridSize)}`
      const bucket = pooled.get(key)
      if (bucket) bucket.push(item)
      else pooled.set(key, [item])
    })
  })

  pooled.forEach((meshes, key) => {
    const bucket = new THREE.Group()
    bucket.name = `static-batch-${key}`
    // Deliberately not registered with the frustum pass below. That pass works by
    // toggling `visible`, and the shadow map is baked exactly once, so anything
    // hidden at bake time loses its shadow for good. Three's own per-object
    // frustum test already skips these in the camera pass without that side
    // effect, and there are few enough buckets that the saving is marginal.
    world.add(bucket)
    bucket.updateMatrixWorld(true)
    bakeBatches(bucket, meshes, cache)
  })
}

export function MapThreeScene({
  region,
  points,
  selectedKey,
  onSelect,
  activity,
  cameraCommand,
  viewMode,
  playerGender,
  playerTier,
  playerName,
  onLandmarks,
  onLandmarkHover,
  onLandmarkSelect,
  ownedLandmarks,
}: {
  region: MapRegionKey
  points: MapScenePoint[]
  selectedKey: string
  onSelect: (key: string) => void
  activity: number
  cameraCommand: CameraCommand
  viewMode: MapViewMode
  playerGender: CharacterGender
  playerTier: number
  playerName: string
  /** Emitted once the district is built, for the district directory UI. */
  onLandmarks?: (landmarks: MapLandmark[]) => void
  /** Hover feedback for the on-canvas tooltip; client coordinates, or null. */
  onLandmarkHover?: (landmark: MapLandmark | null, client: { x: number; y: number } | null) => void
  onLandmarkSelect?: (landmark: MapLandmark) => void
  /**
   * `MapLandmark.key`s the firm currently holds a standing retainer over (see
   * `TerritoryDistrict.landmark_key` in `types.ts`). Purely additive: a
   * landmark whose key is not here renders exactly as it always has.
   */
  ownedLandmarks?: string[]
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const commandRef = useRef(cameraCommand)
  const selectedRef = useRef(selectedKey)
  const selectRef = useRef(onSelect)
  const modeRef = useRef(viewMode)
  const landmarksRef = useRef(onLandmarks)
  const landmarkHoverRef = useRef(onLandmarkHover)
  const landmarkSelectRef = useRef(onLandmarkSelect)
  commandRef.current = cameraCommand
  selectedRef.current = selectedKey
  selectRef.current = onSelect
  modeRef.current = viewMode
  landmarksRef.current = onLandmarks
  landmarkHoverRef.current = onLandmarkHover
  landmarkSelectRef.current = onLandmarkSelect

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const definition = ARC[region]
    const buildStartedAt = performance.now()
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    const constrainedDevice = (navigator.hardwareConcurrency || 8) <= 4
    // Matches the office scene: render at up to 2x instead of upscaling a
    // ~1.35x buffer onto a 3x display, which read as blurry.
    const renderPixelRatio = Math.min(
      window.devicePixelRatio || 1,
      constrainedDevice ? 1.5 : 2,
    )
    renderer.setPixelRatio(renderPixelRatio)
    renderer.setSize(host.clientWidth, host.clientHeight, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = definition.exposure
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // The environment is static. Rebuilding a 1024px shadow map for every
    // cloud, label, and camera frame was the largest avoidable GPU cost.
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    renderer.domElement.className = 'uw-three-canvas'
    renderer.domElement.setAttribute('aria-label', `${definition.title} interactive three-dimensional career map`)
    host.replaceChildren(renderer.domElement)

    // The illustrated composite. The map is read at a distance and its whole
    // job is legibility of layout, so the contours matter more here than
    // anywhere else: they separate a roof from the road behind it at a zoom
    // where shading alone cannot.
    const stylePass = new IllustratedRenderPass(renderer, {
      exposure: definition.exposure,
      // Slightly restrained outdoors. Every roof ridge and kerb is an edge, and
      // at full strength a dense district turns into a mesh of black lines.
      inkStrength: .66,
      normalEdge: .7,
      bands: 8,
      flatten: .52,
      saturation: 1.3,
    })

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(definition.fog, definition.fogDensity)
    const sky = createSky(definition)
    scene.add(sky)

    const aspect = Math.max(1, host.clientWidth / Math.max(1, host.clientHeight))
    const camera = new THREE.PerspectiveCamera(definition.fov, aspect, .1, 320)
    const homePosition = new THREE.Vector3(...definition.camera)
    const cameraTarget = new THREE.Vector3(...definition.target)
    camera.position.copy(homePosition)
    camera.lookAt(cameraTarget)

    scene.add(new THREE.HemisphereLight(definition.ambient.sky, definition.ambient.ground, definition.ambient.intensity))
    const sun = new THREE.DirectionalLight(definition.sun.color, definition.sun.intensity)
    sun.position.set(...definition.sun.position)
    sun.castShadow = true
    // The shadow frustum has to cover everything the camera can now see, or
    // the ground outside it samples the clamped edge of the depth map and the
    // whole far field reads as one hard-edged darker slab. Texel density is
    // held roughly constant by growing the map with the frustum, and the
    // shadow map is rendered once (see renderer.shadowMap.autoUpdate), so the
    // larger map costs memory rather than frame time.
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -52; sun.shadow.camera.right = 52; sun.shadow.camera.top = 44; sun.shadow.camera.bottom = -44
    sun.shadow.camera.far = 260
    sun.shadow.bias = -.0006
    scene.add(sun)
    const fill = new THREE.DirectionalLight(definition.fill.color, definition.fill.intensity)
    fill.position.set(...definition.fill.position)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(definition.rim.color, definition.rim.intensity)
    rim.position.set(...definition.rim.position)
    scene.add(rim)
    const civicGlow = new THREE.PointLight(0xffcc83, region === 'orbit' ? 7.5 : 5.2, 25, 1.8)
    civicGlow.position.set(1.5, 5.8, -5.5)
    scene.add(civicGlow)

    const world = new THREE.Group()
    scene.add(world)

    const ground = region === 'ocean'
      ? createSeaSurface(0x1f6173)
      : region === 'orbit'
        ? new THREE.Group()
        : box([220, .28, 180], groundMaterial(definition.ground), [0, -.18, 0])
    world.add(ground)
    const sea = region === 'ocean' ? (ground as THREE.Mesh) : null
    // Last frame's hull position, for measuring how fast the harbour's vessel is
    // actually going. See the wake update in the animation loop.
    let wakeLastX = 0
    let wakeLastZ = 0

    const routeCurve = curveFrom(definition.route, region === 'orbit' ? .5 : .09)
    world.add(createNativeCareerRoute(region, routeCurve))
    const railCurve = curveFrom(definition.rail, region === 'ocean' ? -.08 : .1)
    // The railway's right-of-way. A train is a transport on a fixed curve: it
    // cannot see, cannot steer and cannot stop for anything, so its line is the
    // one corridor on the map that absolutely has to be empty. Nothing was
    // keeping it so — measured, the shuttle was inside solid geometry for 261 of
    // 600 frames on the Old Quarter and was driving through The Circuit's parish
    // church for 211. Two units of half-width is a train's beam and a little
    // lineside clearance either side.
    const railPoints: XZ[] = []
    if (region !== 'ocean') {
      for (let index = 0; index <= 60; index += 1) {
        const point = railCurve.getPointAt(index / 60)
        railPoints.push([point.x, point.z])
      }
      clearanceCorridors(world).push({ points: railPoints, halfWidth: 1.05, label: 'rail' })
    }
    if (region !== 'ocean' && region !== 'orbit') {
      const railBed = mesh(ribbonGeometry(railCurve, .76), material(0x56584f, .98))
      railBed.position.y = .02
      const railA = mesh(ribbonGeometry(railCurve, .055), material(0x4a4f4f, .32, .48)); railA.position.y = .1
      const railB = railA.clone(); railA.position.z += .22; railB.position.z -= .22
      world.add(railBed, railA, railB)
    }

    if (region === 'city') { addCityEnvironment(world, definition); addCityCorridor(world, routeCurve, definition) }
    else if (region === 'nation') { addNationEnvironment(world, definition, routeCurve); addNationCorridor(world, routeCurve, definition) }
    else if (region === 'ocean') addOceanEnvironment(world)
    else if (region === 'continent') addContinentEnvironment(world, routeCurve)
    else addGlobalEnvironment(world)
    addPerimeterEnvironment(world, region, definition)
    enforceCareerSetback(world, routeCurve, region)
    addAuthoredDetailPass(world, region, routeCurve, definition)
    addProceduralNearDistance(world, region, routeCurve, definition)
    world.add(createAmbientActors(region))

    if (region === 'city' || region === 'continent') for (let index = 1; index < 11; index += 1) {
      const t = index / 11
      const point = routeCurve.getPointAt(t)
      const tangent = routeCurve.getTangentAt(t).normalize()
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      for (const direction of [-1, 1]) {
        const bollard = createPromenadeBollard(index % 3 === 0 ? 0xd9ba6d : 0x7eb3a8)
        bollard.position.copy(point).add(side.clone().multiplyScalar(direction * .76))
        bollard.position.y = .08
        world.add(bollard)
      }
    }

    const anchors = new Map<string, THREE.Vector3>()
    const travelAnchors = new Map<string, THREE.Vector3>()
    const tiers = points.filter((point): point is MapSceneTier => point.kind === 'tier')
    const rivals = points.filter((point): point is MapSceneRival => point.kind === 'rival')
    const events = points.filter((point): point is MapSceneEvent => point.kind === 'event')
    tiers.forEach((point, index) => {
      const t = tiers.length <= 1 ? .5 : .12 + index / (tiers.length - 1) * .76
      const roadPoint = routeCurve.getPointAt(t)
      const tangent = routeCurve.getTangentAt(t).normalize()
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const authoredSides: Record<MapRegionKey, number[]> = {
        city: [-1, -1, 1, 1, 1],
        nation: [-1, 1],
        ocean: [1, -1, 1],
        continent: [-1, 1],
        orbit: [-1, 1, 1],
      }
      side.multiplyScalar(authoredSides[region][index] ?? 1)
      const setback: Record<MapRegionKey, number> = { city: 2.8, nation: 3.05, ocean: 3.25, continent: 3.05, orbit: 3.65 }
      const site = roadPoint.clone().add(side.clone().multiplyScalar(setback[region]))
      clearAuthoredParcel(world, site, region === 'orbit' ? 2.5 : region === 'ocean' ? 2.2 : 2.05)
      if (region === 'ocean') {
        const island = createIslandLandform(2.1, 410 + point.data.tier * 23, index % 2 ? 0x66725e : 0x707666)
        island.position.set(site.x, -.22, site.z)
        world.add(island)
        const pier = createPier(2.75, .56)
        pier.position.copy(site).lerp(roadPoint, .52)
        pier.position.y = -.01
        pier.rotation.y = Math.atan2(roadPoint.x - site.x, roadPoint.z - site.z)
        world.add(pier)
      } else if (region === 'orbit') {
        const stationParcel = cylinder(1.92, .24, material(0x34454c, .48, .38), [site.x, -.02, site.z], 32)
        stationParcel.scale.z = .78
        world.add(stationParcel)
      }
      const connectorCurve = new THREE.LineCurve3(new THREE.Vector3(roadPoint.x, .1, roadPoint.z), new THREE.Vector3(site.x, .1, site.z))
      if (region === 'ocean' || region === 'orbit') {
        const connector = mesh(ribbonGeometry(connectorCurve, region === 'orbit' ? .11 : .075, 20), new THREE.MeshBasicMaterial({ color: region === 'orbit' ? 0x72d7e1 : 0xe1bd67, transparent: true, opacity: .72, depthWrite: false, depthTest: false }))
        connector.position.y = .12
        connector.castShadow = false
        connector.renderOrder = 8
        world.add(connector)
      } else if (region === 'city') {
        const connector = mesh(ribbonGeometry(connectorCurve, 1.05, 28), material(0xaaa18e, .96))
        connector.position.y = .075
        world.add(connector)
      } else if (region === 'nation') world.add(roadMesh(connectorCurve, .86, 0x3b403e))
      else {
        const connector = mesh(ribbonGeometry(connectorCurve, 1.08, 28), material(0x3b4749, .72, .14))
        connector.position.y = .075
        world.add(connector)
      }
      if (region !== 'ocean' && region !== 'orbit') {
        const plazaColor = point.state === 'complete' ? 0x688779 : point.state === 'current' ? definition.accent : point.state === 'next' ? 0x9c8f70 : 0x73746e
        const plazaSize: [number, number, number] = region === 'continent' ? [4.25, .14, 2.7] : region === 'nation' ? [3.8, .14, 2.5] : [3.45, .14, 2.4]
        const plaza = box(plazaSize, material(plazaColor, .9), [site.x, .06, site.z])
        plaza.rotation.y = Math.atan2(roadPoint.x - site.x, roadPoint.z - site.z)
        world.add(plaza)
        const threshold = box([1.22, .035, .25], material(point.state === 'current' ? 0xe2c270 : 0xb3a57e, .55, .22), [site.x, .148, site.z])
        threshold.rotation.y = plaza.rotation.y
        threshold.translateZ(plazaSize[2] * .43)
        threshold.castShadow = false
        world.add(threshold)
        // A mirrored pair of markers on the approach axis is what actually
        // reads as "formal" at the counsel's own eye level, independent of
        // whatever the background skyline is doing.
        const facing = plaza.rotation.y
        const lateral = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing))
        if (region === 'continent') {
          for (const flankSide of [-1, 1]) {
            const pylon = createCivicPylon(.92, definition.stone, definition.accent)
            pylon.position.copy(site).add(lateral.clone().multiplyScalar(flankSide * (plazaSize[0] * .5 + .55)))
            pylon.position.y = .02
            pylon.rotation.y = facing
            world.add(pylon)
          }
        } else if (region === 'city') {
          for (const flankSide of [-1, 1]) {
            const lamp = createLamp()
            lamp.position.copy(site).add(lateral.clone().multiplyScalar(flankSide * (plazaSize[0] * .5 + .4)))
            lamp.position.y = .02
            world.add(lamp)
          }
        }
      }
      const { group } = createLevelBuilding(point, definition)
      const destinationMarker = createDestinationMarker(point)
      destinationMarker.position.set(0, .02, 1.46)
      destinationMarker.userData.destinationBaseY = .02
      group.add(destinationMarker)
      group.position.copy(site)
      group.rotation.y = Math.atan2(roadPoint.x - site.x, roadPoint.z - site.z)
      world.add(group)
      decorateLevelParcel(world, region, point, index, site, roadPoint, tangent, definition)
      anchors.set(point.key, new THREE.Vector3(site.x, .12, site.z))
      const travelAnchor = roadPoint.clone().add(side.clone().multiplyScalar(region === 'ocean' || region === 'orbit' ? .5 : .32)).setY(.12)
      travelAnchors.set(point.key, travelAnchor)
      if (region !== 'orbit') {
        const flag = createDistrictFlag(point.state === 'current' ? 0xd5ad55 : point.state === 'complete' ? 0x5f9484 : 0x697471, region === 'ocean' ? .72 : .82)
        const towardRoad = roadPoint.clone().sub(site).setY(0).normalize()
        flag.position.copy(site).add(towardRoad.multiplyScalar(region === 'ocean' ? 1.35 : 1.18)).add(tangent.clone().multiplyScalar(1.08))
        flag.position.y = region === 'ocean' ? .16 : .12
        flag.rotation.y = Math.atan2(roadPoint.x - site.x, roadPoint.z - site.z)
        world.add(flag)
      }
      if (region !== 'ocean' && region !== 'orbit') for (const offset of [-1.7, 1.7]) {
          const lamp = createLamp()
          const towardRoad = roadPoint.clone().sub(site).setY(0).normalize()
          lamp.position.copy(site).add(towardRoad.multiplyScalar(1.4)).add(tangent.clone().multiplyScalar(offset * .72))
          lamp.position.y = .02
          lamp.scale.setScalar(.88)
          world.add(lamp)
        }
    })

    /*
     * Get everything static out of the lanes.
     *
     * The district's passes are finished: every street, lane, channel, railway
     * and river has been drawn and recorded, and every building and prop has
     * been placed. This is the first and only moment at which one piece of code
     * knows about both, and it is the moment to reconcile them — before
     * `batchStaticScenery` merges the props into batches that can no longer be
     * moved, and before the simulations start driving down lanes that, measured
     * on the shipped scenes, had a car inside solid geometry on every single
     * frame of the Old Quarter.
     *
     * Each corridor is the carriageway plus the half-beam of the widest body
     * that uses it, because what has to be clear is the vehicle's path and not
     * the kerb line. Water lanes get a wider margin still: a boat that clips a
     * pier is a much more visible failure than a car that clips a bollard, and
     * there is nothing out there to crowd.
     */
    const corridors: ClearanceCorridor[] = clearanceCorridors(world).slice()
    for (const way of roadWays(world)) {
      const kind = way.kind ?? 'road'
      const width = way.width ?? (kind === 'water' ? 2.8 : 1.5)
      corridors.push({
        points: way.points,
        closed: way.closed,
        halfWidth: width / 2 + (kind === 'water' ? .75 : .45),
        label: kind,
      })
    }
    const clearanceField = prepareClearance(corridors)

    const rivalSitesByRegion: Record<MapRegionKey, XZ[]> = {
      city: [[-14, -7], [-7, -7.6], [7, -7.6], [14, -7]],
      nation: [[-11.5, -8], [11.5, -8]],
      ocean: [[-12, -6.6], [0, 8.6], [12, -6.6]],
      continent: [[-13, -7], [13, -7]],
      orbit: [[-12, -6], [0, 8.7], [12, -6]],
    }
    const rivalSites = rivalSitesByRegion[region]
    /**
     * Ground under a marker on the Treaty Sea.
     *
     * A rival compound and a docket beacon are click targets rather than
     * scenery, so they stay when the region's furniture goes — but two of the
     * three rivals and both dockets were standing on quay islands that went
     * with it, and a building on open water reads as a bug rather than as a
     * choice. Each keeps a landform of its own, sized to what stands on it.
     */
    const groundMarker = (x: number, z: number, radius: number, seed: number) => {
      if (region !== 'ocean') return
      const island = createIslandLandform(radius, seed, 0x66725e)
      island.position.set(x, -.22, z)
      world.add(island)
    }
    // A standing rival reads as a building with a name on it; putting one
    // figure at its door is what makes it read as a firm with people in it —
    // someone the player is actually up against, not a placeholder. Once the
    // firm is held, its old staff have no reason to still be posted outside,
    // so this only ever covers the rivals still standing or contested.
    // Reusing the crowd's own rig means the guard costs the same 17
    // instances as any pedestrian, in a second, independent `CrowdRenderer`
    // that this world disposes exactly like every other renderer here —
    // through the generic `disposeScene` sweep, since nothing about it is
    // marked shared. It is deliberately not handed to `Crowd`: a receptionist
    // holding the door is staying put, not pathfinding the block.
    const rivalGuardEntries: Array<{ walker: CrowdWalker; baseHipsY: number; phase: number }> = []
    rivals.forEach((point, index) => {
      const [authoredX, authoredZ] = rivalSites[index % rivalSites.length]
      // A rival compound is a click target, so it cannot simply be dropped if it
      // is in a lane — but it can be moved, and it has to be. Measured, the Old
      // Quarter's four compounds each overlapped the north arterial's near half by
      // about a metre, which put a car inside a rival's ground floor for 203 of
      // 900 frames at the worst of them and accounted for most of that district's
      // remaining contact. Correcting the site here rather than nudging the
      // finished building keeps the compound, its emphasis ring, its travel anchor
      // and its selection collider all at the same place.
      const site = escapeCorridors(clearanceField, authoredX, authoredZ, 1.55, 2.2)
      const x = site.x
      const z = site.z
      clearAuthoredParcel(world, new THREE.Vector3(x, 0, z), 1.85)
      groundMarker(x, z, 1.95, 620 + index * 29)
      const building = createRivalBuilding(point, index, definition)
      building.position.set(x, .04, z)
      building.rotation.y = z < 0 ? 0 : Math.PI
      world.add(building)
      const ring = emphasisRing('rivals', point.key, point.data.owned ? 0x6fb29c : (point.data.discount_bps ?? 0) > 0 ? 0xd8a94f : 0xb36f60, 1.45)
      ring.position.x = x; ring.position.z = z
      world.add(ring)
      anchors.set(point.key, new THREE.Vector3(x, .12, z))
      travelAnchors.set(point.key, new THREE.Vector3(x, .12, z + (z < 0 ? 1.45 : -1.45)))

      if (!point.data.owned) {
        // A different seed namespace from the pedestrian crowd's
        // `index * 7.31 + 3.7` so a guard never happens to roll the exact
        // same build, colouring and satchel as a passer-by.
        const guard = buildCrowdWalker(index * 13.7 + 101.3)
        guard.root.scale.setScalar(CROWD_RENDER_SCALE)
        const faceSign = z < 0 ? 1 : -1
        // A step further out than the travel anchor (1.45), and shifted to
        // one side, so the figure stands beside the door the player travels
        // to rather than on top of it.
        guard.root.position.set(x + (index % 2 === 0 ? -.6 : .6), .04, z + faceSign * 1.95)
        guard.root.rotation.y = building.rotation.y
        // Left off the scene graph on purpose — like every other crowd
        // walker, its root is only ever read by `CrowdRenderer.sync()`,
        // which is what actually puts it on screen.
        rivalGuardEntries.push({ walker: guard, baseHipsY: guard.rig.hips.position.y, phase: index * 1.9 + 2.1 })
      }
    })
    const rivalGuardRenderer = rivalGuardEntries.length ? new CrowdRenderer(rivalGuardEntries.map((entry) => entry.walker)) : null
    if (rivalGuardRenderer) world.add(rivalGuardRenderer.group)

    const eventSitesByRegion: Record<MapRegionKey, XZ[]> = {
      city: [[-10.4, 4.15], [10.4, 4.05]],
      // Fenwick Green, west of the market cross the village posts its notices
      // on. The Circuit's docket board used to be at `0,5.2`, which is the
      // station lane: a board is 1.48 across on a lane 0.54 wide with pavements
      // .15 either side of `±.58`, so it stood in the carriageway *and* over
      // both footways, and it is a sign with no footprint declared — invisible
      // to the pavement cut and to the crowd's obstacle set alike, so a walker
      // simply passes through it.
      //
      // Moving it took walkers-in-a-solid from .0389/.0418/.0629/.0718 over
      // four runs to .0321 on all four, and that second number is the point:
      // the district used to settle into three different states and now settles
      // into one. The board was standing where the counsel's own travel anchor
      // is, so it was perturbing the pavement plan at the busiest junction on
      // the map, and the sites it took with it — the green benches at `-1,3`
      // and `-1,4`, 107 frames between them — were never really about benches.
      nation: [[-3.5, 5]],
      ocean: [[-6, 7.2], [6, 7.2]],
      continent: [[0, 5.35]],
      orbit: [[-7, 7.8], [7, 7.8]],
    }
    const eventSites = eventSitesByRegion[region]
    events.forEach((point, index) => {
      const [x, z] = eventSites[index % eventSites.length]
      clearAuthoredParcel(world, new THREE.Vector3(x, 0, z), 1.3)
      groundMarker(x, z, 1.4, 730 + index * 37)
      const signal = createEventSite(point, definition)
      signal.position.set(x, .04, z)
      world.add(signal)
      const ring = emphasisRing('dockets', point.key, point.locked ? 0x77766f : 0xd0a957, 1.18)
      ring.position.x = x; ring.position.z = z
      world.add(ring)
      anchors.set(point.key, new THREE.Vector3(x, .12, z))
      travelAnchors.set(point.key, new THREE.Vector3(x, .12, z + 1.25))
    })

    /**
     * Motion along a path.
     *
     * `loop` requires a *closed* curve. Advancing a vehicle by wrapping a
     * parametric offset on an open curve is what used to make traffic pop:
     * wrapping t from 1 back to 0 teleports the vehicle the whole length of
     * the road (an arterial spanning x=-18..18 threw every car 36 units
     * backwards, once per lap, in full view). Every looping road in the three
     * inhabited regions is now a genuine circuit, so the wrap point is
     * continuous in world space and there is nothing to see.
     *
     * `shuttle` is for the lines that genuinely cannot loop — a branch railway
     * or a canal. Instead of wrapping, the vehicle eases to a stand at the
     * terminus, dwells there, and runs back the other way. Trains and boats
     * keep their heading through the reversal, which is what a real push-pull
     * shuttle does; nothing ever teleports and nothing ever spins on the spot.
     *
     * A shuttle also *calls* somewhere. It used to be eased with one smoothstep
     * across the entire line, which meant it accelerated for half the district,
     * decelerated for the other half, and ran straight past its own platform at
     * whatever speed it happened to be doing — the platform was scenery and the
     * train was a bead sliding on a wire. The run is now cut into legs at the
     * stops the district recorded (`transitStops`), and each leg has its own
     * braking curve and its own dwell, so the train leaves the terminus, works
     * up to line speed, brakes into the halt, stands there with its doors open,
     * and pulls away again. The same machinery gives a boat its berths.
     */
    type TransportLeg = {
      from: number
      to: number
      /** Seconds spent running this leg. */
      travel: number
      /** Seconds standing at `to` once the leg is complete. */
      dwell: number
      forward: boolean
    }
    type TransportPath = {
      /** Last frame's position, for measuring how fast it is actually going. */
      lastX: number
      lastZ: number
      object: THREE.Object3D
      curve: THREE.Curve<THREE.Vector3>
      /** Phase within the vehicle's own cycle, 0..1. */
      offset: number
      /** Laps per second for a loop, traverses per second for a shuttle. */
      speed: number
      mode: 'loop' | 'shuttle'
      lift: number
      /** True when the vehicle reverses rather than turning around. */
      reverses: boolean
      /** Stop-to-stop schedule for a shuttle; empty for a loop. */
      legs: TransportLeg[]
      /** Total cycle length in seconds: out, calling everywhere, and back. */
      cycle: number
    }
    // Where this district's trains and boats call, as positions on the curve.
    // Projected once, here, because the platforms were placed in world space by
    // whichever pass built them and none of those passes has the curve.
    const recordedStops = (world.userData.transitStops ?? []) as XZ[]
    const stopsAlong = (curve: THREE.Curve<THREE.Vector3>) => {
      const found: number[] = []
      for (const [x, z] of recordedStops) {
        let bestT = -1
        let bestDistance = Number.POSITIVE_INFINITY
        for (let step = 0; step <= 200; step += 1) {
          const t = step / 200
          const point = curve.getPointAt(t)
          const distance = Math.hypot(point.x - x, point.z - z)
          if (distance < bestDistance) { bestDistance = distance; bestT = t }
        }
        // A platform four units off the line is not on this line: the canal
        // launch must not try to call at the railway station.
        if (bestT >= 0 && bestDistance < 4) found.push(bestT)
      }
      // Both ends of a branch line are termini whether or not anything was
      // built there, and two calls less than a train-length apart are one call.
      const all = [0, ...found, 1].sort((a, b) => a - b)
      const kept: number[] = []
      for (const t of all) {
        if (kept.length && t - kept[kept.length - 1] < .1) continue
        kept.push(t)
      }
      if (kept[kept.length - 1] < .999) kept.push(1)
      return kept
    }
    const transports: TransportPath[] = []
    const addTransport = (
      object: THREE.Object3D,
      curve: THREE.Curve<THREE.Vector3>,
      options: { offset: number; speed: number; mode?: TransportPath['mode']; dwell?: number; lift?: number; reverses?: boolean },
    ) => {
      world.add(object)
      const mode = options.mode ?? 'loop'
      const dwell = options.dwell ?? 3.6
      const legs: TransportLeg[] = []
      let cycle = 0
      if (mode === 'shuttle') {
        const stops = stopsAlong(curve)
        // `speed` is traverses per second, so the whole line takes 1/speed to
        // run; each leg gets its share of that, plus a fixed allowance for the
        // braking and pull-away it now has to do at either end of it.
        const traverse = 1 / options.speed
        const outbound: TransportLeg[] = []
        for (let index = 0; index < stops.length - 1; index += 1) {
          const from = stops[index]
          const to = stops[index + 1]
          outbound.push({ from, to, travel: traverse * (to - from) + .9, dwell, forward: true })
        }
        const inbound = outbound
          .slice()
          .reverse()
          .map((leg) => ({ from: leg.to, to: leg.from, travel: leg.travel, dwell: leg.dwell, forward: false }))
        legs.push(...outbound, ...inbound)
        for (const leg of legs) cycle += leg.travel + leg.dwell
      }
      transports.push({
        object,
        curve,
        offset: options.offset,
        speed: options.speed,
        mode,
        lift: options.lift ?? .12,
        reverses: options.reverses ?? false,
        legs,
        cycle: Math.max(1e-3, cycle),
        lastX: Number.NaN,
        lastZ: Number.NaN,
      })
    }

    /**
     * Road and harbour traffic.
     *
     * Every region contributed its streets, ring roads, avenues and shipping
     * lanes to one spec while it was being built, so this is the only place
     * that has to know a network exists. Welding turns those separate ways
     * into a graph with shared junctions, which is what gives an agent a
     * choice of continuation, somewhere to give way, and — through the portal
     * nodes at the edges of the district — somewhere to arrive from and leave
     * to that the camera cannot see.
     */
    const graphSpec: RoadGraphSpec = { ways: (world.userData.roadWays ?? []) as RoadGraphSpec['ways'], weldRadius: .9 }
    const roadGraph: RoadGraph | null = graphSpec.ways.length ? buildRoadGraph(graphSpec) : null

    /*
     * The prop pass is off, on the evidence.
     *
     * Pushing street furniture out of the carriageways is a large win for
     * vehicles and a loss for people, and the loss lands on the complaint that
     * asked for the work. Measured over 600 deterministic frames, turning it on
     * took vehicles intersecting solid geometry from 2.795 to 1.300 per frame on
     * the Old Quarter — and took walkers intersecting solid geometry from 8.74%
     * of samples to 9.47% there, and from 20.6% to 29.2% on The Circuit.
     *
     * The mechanism is visible in the worst-site list: a prop shoved off a lane
     * has nowhere to go but the pavement beside it, and a walker is bound to its
     * footway polyline and can only shift within that footway's half-width, so
     * it cannot get round what has just been put in front of it. The pass needs
     * to know about pavements before it is allowed to move anything — and a
     * bench belongs *on* a pavement, so "keep props off footways" is not the
     * rule either. That is a design question, not a parameter, and it is not one
     * to answer unmeasured at the end of a session.
     */
    void clearObjects
    void clearanceField

    /*
     * Level crossings.
     *
     * A railway crosses streets, and something has to give way. The train cannot:
     * it is a transport on a fixed curve with no perception and no brakes. So the
     * road gives way, which is what a level crossing *is* — and the mechanism for
     * holding a lane already exists, because it is the same problem as a
     * pedestrian on a crossing. `markPedestrian` puts an obstruction at a distance
     * along an edge and every vehicle behind it stops; the crowd uses it for
     * walkers, and an approaching train is a much better reason to stop than a
     * walker is.
     *
     * The crossings themselves are found once here, by intersecting each road
     * edge with the railway's own polyline, and then it is one distance test per
     * crossing per train per frame.
     */
    const levelCrossings: Array<{ edge: number; distance: number; x: number; z: number }> = []
    if (roadGraph && railPoints.length > 1) {
      for (const edgeIndex of roadGraph.edgesByKind.road) {
        const edge = roadGraph.edges[edgeIndex]
        const from = roadGraph.nodes[edge.from]
        const to = roadGraph.nodes[edge.to]
        for (let index = 0; index < railPoints.length - 1; index += 1) {
          const [ax, az] = railPoints[index]
          const [bx, bz] = railPoints[index + 1]
          const roadX = to.x - from.x
          const roadZ = to.z - from.z
          const railX = bx - ax
          const railZ = bz - az
          const denominator = roadX * railZ - roadZ * railX
          if (Math.abs(denominator) < 1e-6) continue
          const along = ((ax - from.x) * railZ - (az - from.z) * railX) / denominator
          const across = ((ax - from.x) * roadZ - (az - from.z) * roadX) / denominator
          if (along < 0 || along > 1 || across < 0 || across > 1) continue
          // Only where the two genuinely cross.
          //
          // A road that runs *along* a railway intersects it repeatedly at a
          // glancing angle, and gating those is actively harmful: measured, doing
          // so on the Sovereign Arc — where the line is laid in the cross axis for
          // its whole length — trebled train-versus-car contact, because instead
          // of cars driving over the rails they stopped and waited on them. A
          // shared alignment is a planning fault to be fixed in the plan; a gate
          // cannot help, and pretending otherwise makes it worse.
          const crossing = Math.abs(roadX * railZ - roadZ * railX)
            / (Math.hypot(roadX, roadZ) * Math.hypot(railX, railZ) || 1)
          if (crossing < .5) continue
          levelCrossings.push({
            edge: edgeIndex,
            distance: along * edge.length,
            x: from.x + roadX * along,
            z: from.z + roadZ * along,
          })
          break
        }
      }
    }
    world.userData.levelCrossings = levelCrossings.length
    const dockPoints = (world.userData.dockPoints ?? []) as XZ[]
    if (roadGraph && dockPoints.length) markDocks(roadGraph, dockPoints, 1.4)
    const trafficSims: TrafficSim[] = []
    const pooledVehicles: THREE.Object3D[] = []
    /** The Treaty Sea's hulls, so the water can be told what they are doing. */
    const harbourVessels: THREE.Object3D[] = []
    if (roadGraph) {
      // Pool sizes are per region rather than per lane, because occupancy is
      // now a property of the district: the Old Quarter is busy, the Circuit
      // is a country road with a bypass on it, and the harbour runs a handful
      // of working boats.
      const roadPool = region === 'city' ? 16 : region === 'continent' ? 15 : region === 'nation' ? 11 : 0
      if (roadPool && roadGraph.edgesByKind.road.length) {
        for (let index = 0; index < roadPool; index += 1) {
          // Every third vehicle on The Circuit is a tractor. A country road is
          // not a slower version of a high street: what is on it is different,
          // and one farm vehicle holding up the run between two villages does
          // more for the character of the place than any amount of scenery.
          const vehicle = region === 'nation' && index % 3 === 2
            ? createFarmTractor(index)
            : createVehicle([0x6d4d48, 0x52626a, 0x71664f, 0x455e59, 0x7a6a52][index % 5])
          vehicle.visible = false
          world.add(vehicle)
          pooledVehicles.push(vehicle)
        }
        trafficSims.push(new TrafficSim({
          graph: roadGraph,
          vehicles: pooledVehicles.slice(),
          kind: 'road',
          laneOffset: .32,
          lift: .11,
          // Country traffic runs further apart than town traffic, and the gap
          // is what actually reads as sparseness once the pool is small.
          gap: region === 'nation' ? 2.3 : 1.05,
          // Deliberately below one: the parked slice of the pool is what makes
          // arrivals and departures read as churn rather than as a fixed
          // convoy that happens to fade at the edges.
          occupancy: region === 'nation' ? .62 : .78,
          seed: 19.7,
        }))
      }
      if (roadGraph.edgesByKind.water.length) {
        // One vessel on the water at a time.
        //
        // The harbour used to carry a fleet — seven on the graph, two more on the
        // railway curve, and twenty-three moored hulls dropped on open water —
        // which is a lot of things to keep from hitting each other and each other's
        // moorings, and it was not managing it. A single working boat on the
        // channel is both the intent for this region and far easier to hold to a
        // standard: it has a lane, it calls at the berths beside the piers, and it
        // enters and leaves through the portals at either end of the channel
        // thirty units off the edge of the visible map.
        //
        // The pool is two bodies at half occupancy rather than one at full. The
        // difference is what happens at a portal: with one body, the harbour is
        // empty for the whole of the departing vessel's fade-out before the same
        // object can fade back in somewhere else. With a spare hull, the arrival
        // is a different object and can begin as soon as the departure has left,
        // so there is still only ever one boat in view and it is never the same
        // boat vanishing and reappearing.
        const boats: THREE.Object3D[] = []
        for (let index = 0; index < 2; index += 1) {
          const boat = createFerry()
          boat.scale.multiplyScalar(.62)
          boat.visible = false
          world.add(boat)
          boats.push(boat)
        }
        trafficSims.push(new TrafficSim({
          graph: roadGraph,
          vehicles: boats,
          kind: 'water',
          laneOffset: .42,
          lift: -.02,
          gap: 2.2,
          fade: 2.4,
          occupancy: .5,
          seed: 41.3,
        }))
        pooledVehicles.push(...boats)
        harbourVessels.push(...boats)
      }
    }

    /**
     * Pedestrians.
     *
     * Real `buildStylizedCounsel` bodies, cut at the map detail rung and drawn
     * through instanced batches keyed by geometry and material finish — see
     * `map-crowd-rig` — so the whole population costs a fixed ~48 draw calls
     * and the pool can be sized for how the street should look rather than for
     * what the draw-call budget will bear.
     */
    /**
     * Cut the pavements apart wherever they run into a carriageway.
     *
     * Everything up to here contributed pavements the way it drew them: one
     * polyline down the side of a street, offset to the kerb and running the
     * whole length of the district. Correct beside its own street and wrong
     * everywhere it met another, because it simply carried on across. Measured
     * on the Old Quarter before this pass, 39% of all pavement length was inside
     * a carriageway, and the only place two pavements ended near enough to be
     * paired into a crossing was the outer edge of the map, so 56 of the 80
     * "crossings" the crowd found ran end to end *down* the perimeter road
     * instead of over anything.
     *
     * Splitting here rather than in each builder is the point: the grid, the
     * high street, the ring roads and the village lanes are drawn by unrelated
     * code and all had it, and the record is the only place that knows about
     * every street at once.
     */
    const pedestrianPlan = planFootways(
      (world.userData.footWays ?? []) as FootwaySpec[],
      (world.userData.roadWays ?? []) as CarriagewaySpec[],
      { setback: KERB_TO_PAVEMENT },
    )
    /**
     * Then take the pavement out from under anything solid standing on it.
     *
     * The remaining pedestrian defect after the pavements were cut at their
     * junctions, and the one the last three passes each identified and none
     * finished. A walker is bound to its footway and may only shift within that
     * footway's half-width — .09 on a planned street — so a cafe terrace, a
     * market stall or a farmstead standing across the paving leaves no lateral
     * offset that clears it, and the walker goes through. Steering has nothing
     * to choose between; the route itself has to give way.
     *
     * Only the solid class. Benches, lamps, bollards, planters and bike racks
     * stay exactly as they were, in `obstacles`, steered around a shoulder at a
     * time — the reverted prop-clearance pass is the standing evidence for what
     * happens when the two classes are treated alike.
     */
    const crowdProps = crowdObstacles(world)
    // The disc in `radius` is the steering's, and stays the steering's: it is
    // what a shoulder brushes past, it is tuned, and inflating it to a
    // rectangle's diagonal on the way through measured immediately and badly —
    // the Old Quarter went .0060 to .0787 on the .12 ruler in the one run where
    // this line handed the enlarged figure to `obstacles` as well. Routing gets
    // the circumscribing radius, because for routing the radius is only a
    // bounding test around the rectangle underneath it.
    const propSolids = crowdProps
      .filter((prop) => prop.solid)
      .map(({ x, z, radius, hx, hz, rotationY }) => ({
        x,
        z,
        radius: hx !== undefined && hz !== undefined ? Math.hypot(hx, hz) : radius,
        hx,
        hz,
        rotationY,
      }))
    /**
     * And the buildings, which are the reason this pass exists and were the one
     * class of solid it never contained.
     *
     * `crowdObstacles` can only see an object that carries a `footprintRadius`,
     * and `renderPlannedBuildings` articulates the few blocks nearest the camera
     * — those go through `createBlockBuilding`, which declares one — and
     * *instances* all the rest. An `InstancedMesh` has no per-instance userData,
     * so the overwhelming majority of the solid volume in every district was
     * absent from the list the cut and the link guard work from. It is the same
     * blindness the harness itself had two passes ago, when the instanced
     * facades were invisible to the collision grid and a building-clearance arm
     * therefore "agreed to the last digit" with its control.
     *
     * Measured on the shipped tree, footway centreline standing in solid
     * geometry at body height with nothing declared there: 22.5 units on the
     * Sovereign Arc and 7.4 on The Circuit are inside a planned building.
     *
     * `buildingAudit` is the list `keepBuildingsClear` produced and
     * `renderPlannedBuildings` actually built, so this is exactly what was drawn
     * rather than a reconstruction from instance matrices, and `ARTICULATION` is
     * the same margin `createBlockBuilding` declares for the cornice and awning
     * that hang off the planned rectangle. Articulated blocks appear in both
     * lists; overlapping cut spans merge, so that costs nothing.
     */
    const plannedSolids = ((world.userData.buildingAudit ?? []) as Array<
      { x: number; z: number; width: number; depth: number; rotationY: number }
    >).map((record) => {
      const hx = record.width / 2 + ARTICULATION
      const hz = record.depth / 2 + ARTICULATION
      return { x: record.x, z: record.z, radius: Math.hypot(hx, hz), hx, hz, rotationY: record.rotationY }
    })
    const solidFootprints = [...propSolids, ...plannedSolids]
    /**
     * And take the pavement off the railway, which nothing was doing.
     *
     * `planFootways` cuts pavements at every carriageway and deliberately
     * ignores the rail line, on the grounds that a railway is not a kerb. It
     * is not — it is worse. A road can be crossed: the crowd waits at the kerb,
     * judges a gap against the traffic's own time-to-arrival and steps out. A
     * train is a `TransportPath` on a fixed curve with no perception and no
     * brakes, there is no gap logic that can be asked about it, and the walker
     * has nothing to yield to. So the right-of-way the region already declares
     * for the buildings is subtracted from the pedestrian network too.
     *
     * This is where the Sovereign Arc's walker-to-vehicle contacts were coming
     * from, and they were not vehicles. Measured over 600 frames, all 401 of
     * them were the shuttle and none of them were cars, 345 on the single
     * ring-boulevard pavement that runs over the line at `11,7`, and for 119 of
     * those frames the body was inside the train's own box rather than merely
     * inside the generous disc the harness grows around a five-unit object.
     *
     * Unconditional, and separate from the switch below: a level crossing with
     * a crowd standing on it is a defect either way, and the experiment that
     * switch carries is about buildings.
     */
    const railBlocks = ((world.userData.clearanceCorridors ?? []) as ClearanceCorridor[])
      .filter((corridor) => corridor.label === 'rail')
      .flatMap((corridor) => corridorFootprints(corridor.points, corridor.halfWidth, corridor.closed ?? false))
    /**
     * The tarmac, as ground the crowd's usable width may not be moved onto.
     *
     * Not a solid and never a reason to remove a pavement — a carriageway
     * beside a footway is where the footway is supposed to be. It is here
     * because taking a band out from under a building moves it the other way,
     * and on a village lane the other way is the road: the arm of the width
     * pass that could move a band and knew only about buildings took The
     * Circuit's walker-in-a-building share from .5203 to .4031 and its
     * bodies-inside-a-vehicle from 0 to 56 in the same run. See `keepOut`.
     */
    const carriageways = ((world.userData.roadWays ?? []) as CarriagewaySpec[])
      .filter((road) => (road.kind ?? 'road') === 'road')
      // The same default `planFootways` laid the pavements against, so the two
      // passes cannot disagree about where the kerb is.
      .flatMap((road) => corridorFootprints(road.points, (road.width ?? 1.5) / 2, road.closed ?? false))
    // No width work in this pass, only the cut.
    //
    // Its job is to take the pavement off the tracks. The width work is about
    // buildings, and doing a first, partial round of it here against the one
    // solid the region declares separately is how the Sovereign Arc — where the
    // buildings are not declared at all, so this is the *only* pass — ended up
    // with bands moved for a level crossing and never checked against anything
    // else. Measured over 900 frames, that is the whole of the Arc's regression
    // in bodies inside a vehicle: 91 with the width work here, 21 without,
    // against 17 before any of it existed.
    const railPlan = cutFootwaysAroundSolids(pedestrianPlan.ways, railBlocks, {
      defaultHalfWidth: CROWD_FOOTWAY_HALF,
      narrow: false,
    })
    const solidPlan = FOOTWAY_SOLID_CUT[region]
      ? cutFootwaysAroundSolids(railPlan.ways, solidFootprints, {
        defaultHalfWidth: CROWD_FOOTWAY_HALF,
        keepOut: carriageways,
        avoidWhenInside: true,
      })
      : railPlan
    const crowdWays = solidPlan.ways
    world.userData.pedestrianPlan = {
      ways: crowdWays.length,
      cuts: pedestrianPlan.cuts,
      unsliced: pedestrianPlan.unsliced,
      solids: solidFootprints.length,
      propSolids: propSolids.length,
      plannedSolids: plannedSolids.length,
      solidCuts: solidPlan.cut,
      solidUnwalkable: solidPlan.unwalkable,
      solidBlockedLength: solidPlan.blocked,
      // Pieces whose usable width was reduced because a solid stands over one
      // side of them, and the total width given up. See the second half of
      // `cutFootwaysAroundSolids`: this is the figure that moved the reported
      // defect, and a run where it is zero has not done anything.
      solidNarrowed: solidPlan.narrowed,
      solidNarrowedBy: solidPlan.narrowedFrom,
      // Pieces the cut found to be standing inside a solid for most of their
      // length. These keep their links and lose their people. See
      // `FootwaySpec.obstructed`.
      solidObstructed: solidPlan.obstructed,
      railCuts: railPlan.cut,
      railUnwalkable: railPlan.unwalkable,
      railBlockedLength: railPlan.blocked,
      railNarrowed: railPlan.narrowed,
    }
    // No pedestrians on the Treaty Sea.
    //
    // The only pavements out there are the short quay walks on the HQ islands,
    // so the population had eight people shuttling back and forth along a few
    // metres of jetty in the middle of an ocean, which reads as a bug rather
    // than as a harbour. The region is one working vessel on open water.
    //
    // Checked before removing, since a mechanic that counted them would break:
    // nothing outside `map-three-scene` reads the crowd. Districts, retainers
    // and standing are keyed on landmarks, and no landmark is a walker.
    const walkerCount = crowdWays.length && region !== 'ocean'
      ? (region === 'city' ? 18 : region === 'continent' ? 14 : 9)
      : 0
    const crowdWalkers: CrowdWalker[] = []
    for (let index = 0; index < walkerCount; index += 1) {
      const walker = buildCrowdWalker(index * 7.31 + 3.7)
      // The same architectural scale the player's own counsel is built at, so
      // a pedestrian and the lawyer read as the same species. It has to be
      // applied before the crowd is constructed, because the crowd reads it as
      // the scale its fade ramps towards.
      walker.root.scale.setScalar(CROWD_RENDER_SCALE)
      crowdWalkers.push(walker)
    }
    const crowdRenderer = crowdWalkers.length ? new CrowdRenderer(crowdWalkers) : null
    if (crowdRenderer) world.add(crowdRenderer.group)
    const crowd = crowdWalkers.length
      ? new Crowd({
        ways: crowdWays,
        rigs: crowdWalkers,
        width: CROWD_FOOTWAY_HALF * 2,
        lift: .1,
        animateWithin: 30,
        cullRadius: 90,
        occupancy: .82,
        // Everything already carrying a footprint for the placement audit is
        // also something a person has to walk round. Collecting them here
        // rather than maintaining a second list means the pavement furniture
        // and the obstacle set cannot drift apart.
        obstacles: crowdProps,
        // The same discs again, as routing blockages rather than as things to
        // sidestep. Needed here even though the pavement under them is already
        // gone: cutting leaves two ends facing each other a metre apart with no
        // carriageway between them, which is exactly what the crossing pass
        // calls a kerbside corner, and relinking one puts the walker back
        // through the building the cut just took them out of.
        //
        // The right-of-way rides in the same list, and has to: cutting the
        // pavement at the tracks leaves two ends facing each other across them
        // with no carriageway between, which is the textbook kerbside corner and
        // would be relinked straight back over the line.
        solids: [...solidFootprints, ...railBlocks],
        // Wide enough for the two kerbs of the widest street in any region
        // (the high street, at 2.85 between its pavements) with a little to
        // spare. It used to be 4.6, which mattered less when pavements only
        // ended at the edge of the district; now that they end at every
        // junction, a generous radius is a licence to pair corners that have a
        // whole block between them.
        crossingRange: 3.2,
        // The traffic the crossings have to give way to. Both simulations run
        // on the one welded graph, so the crowd can resolve each kerb-to-kerb
        // link against the carriageways it actually cuts and then ask the
        // traffic for a time-to-arrival at those exact points. The order here
        // matters: the sims must exist before the crowd is constructed, since
        // the conflict resolution happens once, in the constructor.
        roadGraph: roadGraph ?? undefined,
        traffic: trafficSims,
      })
      : null

    // Warm both simulations forward before the first frame. Without this the
    // district opens deserted and then fills from the edges inwards over about
    // half a minute, because off-screen spawning refuses every position the
    // opening camera can see.
    for (let index = 0; index < trafficSims.length; index += 1) trafficSims[index].prime(26, camera)
    if (crowd) crowd.prime(20, camera)
    if (crowdRenderer) crowdRenderer.sync()
    if (rivalGuardRenderer) rivalGuardRenderer.sync()

    // Treaty Sea has no line for a regional service to run on.
    //
    // `railCurve` is the district's railway, and on the ocean it was being used
    // as a route for two ferries — a straight run across the top of the map at
    // z≈7, unrelated to the channel, the quays or the berths, calling nowhere,
    // and passing straight through the piers and jetties on the way (measured at
    // depths up to .82). A transport on a fixed curve cannot see anything,
    // which is fine for a train in its own right-of-way and wrong for a boat.
    // The harbour's vessel is on the water graph instead, where it has lanes,
    // berths and portals like every other mover in the game.
    if (region !== 'ocean') {
      const regionalTransport = region === 'orbit' ? createOrbitalCraft() : createTrain()
      addTransport(regionalTransport, railCurve, {
        offset: .05,
        speed: .017,
        mode: 'shuttle',
        dwell: region === 'orbit' ? 5 : 4.2,
        lift: .12,
        reverses: true,
      })
    }
    if (region === 'orbit') {
      const secondRegional = createOrbitalCraft()
      secondRegional.scale.setScalar(.72)
      addTransport(secondRegional, railCurve, { offset: .54, speed: .015, mode: 'shuttle', dwell: 4.6, lift: .12, reverses: true })
    } else if (region === 'nation' || region === 'continent') {
      const secondTrain = createTrain()
      secondTrain.scale.setScalar(.82)
      addTransport(secondTrain, railCurve, { offset: .52, speed: .015, mode: 'shuttle', dwell: 5.2, reverses: true })
    }
    // The Millrace Canal carries no launch, because the Millrace Canal cannot.
    //
    // Its defining feature is twelve bridges, one per cross street, and their
    // decks sit between y=.03 and y=.23 over water at y=.045. A launch of any
    // size has to pass through every one of them: measured, the one that used to
    // run here was inside a bridge deck for 217 of 600 frames, in plain view, at
    // depths up to .37. There is no vessel profile that fits under a .03 soffit,
    // and raising the decks enough to clear one would leave every street that
    // crosses the canal climbing .3 onto a bridge with no ramp to do it on. The
    // canal is now moving water rather than a boat teleporting through masonry.
    transports.forEach(({ object }) => object.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = false
    }))

    const lawyerModel = createLawyer(playerGender, playerTier, playerName)
    const lawyer = lawyerModel.root
    const discoveredTierIndex = tiers.findIndex((point) => point.state === 'current' || point.state === 'next')
    const hasActiveTier = discoveredTierIndex >= 0
    const activeTierIndex = Math.max(0, discoveredTierIndex)
    const activeTier = tiers[activeTierIndex] ?? tiers[0]
    if (activeTier) setSelectable(lawyer, { key: activeTier.key, kind: 'tier', locked: activeTier.state === 'locked' })
    const destination = activeTier ? travelAnchors.get(activeTier.key) ?? routeCurve.getPointAt(.11) : routeCurve.getPointAt(.11)
    const departure = region === 'city' && hasActiveTier
      ? routeCurve.getPointAt(.018)
      : hasActiveTier && activeTierIndex > 0
        ? (travelAnchors.get(tiers[activeTierIndex - 1].key) ?? routeCurve.getPointAt(.08))
        : hasActiveTier ? routeCurve.getPointAt(.035) : destination
    lawyer.position.copy(departure).setY(.12)
    lawyer.visible = true
    // The rig includes its own contact shadow, so a second dynamic sun shadow
    // only duplicates work and leaves stale silhouettes in a cached map.
    lawyer.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = false })
    world.add(lawyer)
    // The Treaty Sea used to move counsel between islands by parking them on a
    // ferry and freezing the rig, which is why the crossing read as a glide.
    // They swim it now; only the orbital transfer still needs a carrier.
    const transitCarrier = region === 'orbit' ? createOrbitalCraft() : null
    if (transitCarrier) {
      transitCarrier.scale.setScalar(1.18)
      transitCarrier.visible = false
      world.add(transitCarrier)
    }

    /**
     * Counsel's motion, on the shared skeletal rig.
     *
     * Every region now, not just the Treaty Sea. Counsel used to be posed by
     * `animateLawyerRig`, a page of per-joint trigonometry driven by an
     * accumulated gait phase, and the swim was the one traversal that reached
     * for the rig because a stroke is not expressible that way. The trouble
     * with the trigonometric version was never the poses, it was that the gait
     * phase advanced with distance covered at a fixed ratio: a stride was
     * whatever `travelDelta * 5.4` said it was, so the feet swung at a rate
     * that only matched the ground by coincidence. The rig time-scales the walk
     * from the speed the body reports, which is the same relationship stated
     * the right way round.
     *
     * Ordering, per `rig/ADOPTION.md`: bind with a fresh world matrix, move the
     * body before `update`, and feed `setGroundSpeed` the distance genuinely
     * covered — measured below from the holder's own world position between
     * frames, never from the journey's intended pace. The two differ here by
     * construction: the walk eases through a trapezoidal speed profile and the
     * heading is damped, so intended and achieved speed disagree on every ramp
     * and every corner.
     */
    // The skeleton measures its own limb lengths from the bind pose, so the rig
    // has to be in the graph with a current world matrix before it is bound.
    lawyer.updateWorldMatrix(true, true)
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const counsel = new HumanoidActor(lawyerModel.rig, { seed: 12.7, state: 'idle', reduced: reducedMotion })
    const counselWorld = new THREE.Vector3()
    const counselPrevious = new THREE.Vector3()
    let counselPlaced = false
    let counselWalking = false
    /** Countdown to the next standing beat, so a waiting figure is not a statue. */
    let counselIdleBeat = 1.8
    let swimPhase: 'dry' | 'entering' | 'swimming' | 'leaving' = 'dry'
    // A wake, so the swimmer displaces water rather than sliding across it.
    // Rings are shed at the body and then left where they were shed: one ring
    // pinned to the swimmer travels with them, which is the towed look the
    // whole swim phase exists to avoid. Water that stays put behind a body is
    // what makes it read as having pushed through something.
    const SWIM_RIPPLE_COUNT = 7
    /** Seconds a shed ring takes to spread out and fade. */
    const SWIM_RIPPLE_LIFE = 1.7
    /** Seconds between rings, roughly one per stroke at cruising pace. */
    const SWIM_RIPPLE_INTERVAL = .32
    const swimRippleGeometry = region === 'ocean' ? new THREE.RingGeometry(.3, .58, 28) : null
    const swimRipples = swimRippleGeometry
      ? Array.from({ length: SWIM_RIPPLE_COUNT }, () => {
        const ring = mesh(
          swimRippleGeometry,
          new THREE.MeshBasicMaterial({ color: 0xcfe6e4, transparent: true, opacity: 0, depthWrite: false }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.renderOrder = 12
        ring.visible = false
        world.add(ring)
        return ring
      })
      : []
    /** Age of each ring in seconds; past its life it is spent and reusable. */
    const swimRippleAge = new Float32Array(SWIM_RIPPLE_COUNT).fill(SWIM_RIPPLE_LIFE)
    let swimRippleNext = 0
    let swimRippleTimer = 0
    /** Waterline the body rides at while swimming: shoulders clear, hips under. */
    const SWIM_WATERLINE = -.02
    let swimSubmersion = 0
    const closestRoutePoint = (position: THREE.Vector3) => {
      let bestT = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let index = 0; index <= 100; index += 1) {
        const t = index / 100
        const candidate = routeCurve.getPointAt(t)
        const distance = candidate.distanceToSquared(position)
        if (distance < bestDistance) { bestDistance = distance; bestT = t }
      }
      return bestT
    }
    const walkingCurve = (from: THREE.Vector3, to: THREE.Vector3) => {
      const fromT = closestRoutePoint(from)
      const toT = closestRoutePoint(to)
      const points = [from.clone()]
      const samples = Math.max(2, Math.ceil(Math.abs(toT - fromT) * 12))
      for (let index = 0; index <= samples; index += 1) points.push(routeCurve.getPointAt(THREE.MathUtils.lerp(fromT, toT, index / samples)))
      points.push(to.clone())
      points.forEach((point) => { point.y = .12 })
      return new THREE.CatmullRomCurve3(points, false, 'centripetal', .42)
    }
    type WalkState = { curve: THREE.CatmullRomCurve3; delayMs: number; duration: number; elapsedMs: number; lastProgress: number }
    /**
     * How long counsel takes to walk a route.
     *
     * Derived from the rig's own natural walking speed — the speed at which the
     * walk clip plays at its authored rate — rather than from a constant
     * milliseconds-per-unit, because the two turned out to disagree by a factor
     * of four. At 260ms per unit counsel crossed the quarter at about 3.4 units
     * a second against a natural 0.78, so the clip's time scale saturated at the
     * 2.2x ceiling the rig imposes and the remainder of the travel came out as
     * the feet sliding: measured at a skate ratio of 0.40, meaning two fifths of
     * every stride was the planted foot dragging along the pavement. It was also
     * three to four times the pace of the crowd walking the same pavements,
     * which is its own tell.
     *
     * The trapezoidal profile below peaks about a third above its average, so
     * the average is set far enough under the ceiling that the cruise stays
     * inside it. Long routes still hit the cap and give up a little of that,
     * which is the deliberate trade: a genuinely long walk across a district
     * should not become a minute of watching someone stroll.
     */
    /**
     * ...and on the Treaty Sea the clip that plays is the swim, not the walk.
     *
     * Pacing every region against `naturalWalkSpeed` reintroduced exactly the
     * defect above, one traversal along. Counsel does not walk the sea; the
     * swim clip carries 2.15 hip-heights per stroke where the walk carries a
     * stride, so its natural speed is 0.611 against the walk's 0.78, and asking
     * it for walk-paced ground put the demanded rate at **4.34x** against the
     * rig's 3.6 ceiling. Measured over a full crossing (`.maps/swim.mjs`), the
     * stroke accounted for only **75-80%** of the distance covered and the rest
     * was the body being slid — the towed swimmer the ceiling was raised to
     * prevent, arrived at from the other side.
     *
     * The upper clamp has to move with it. A 25-unit crossing at swim pace
     * wants 25s, and the 9.5s cap is what forced the speed in the first place;
     * capped at 15.5s the trapezoid's peak lands at about 3.5x, just inside the
     * ceiling, so the stroke covers the whole crossing. A sea crossing is now
     * meaningfully slower than a walk of the same length, which is correct:
     * swimming is slower than walking.
     */
    const walkDuration = (length: number) => {
      const clip = region === 'ocean' ? counsel.naturalSwimSpeed : counsel.naturalWalkSpeed
      const pace = Math.max(.2, clip * 1.62)
      return THREE.MathUtils.clamp((length / pace) * 1000, 1400, region === 'ocean' ? 15500 : 9500)
    }
    const initialDestination = destination.clone().setY(.12)
    const overviewTarget = new THREE.Vector3(...definition.target)
    cameraTarget.copy(overviewTarget)
    const cameraOffset = new THREE.Vector3(...definition.camera).sub(overviewTarget)
    // Counsel view is a real shoulder-height tracking camera. It intentionally
    // does not inherit the distant atlas camera: the lawyer and the immediate
    // office block remain readable while the persistent route navigator keeps
    // every headquarters directly accessible.
    const counselOffset = region === 'orbit'
      ? new THREE.Vector3(6.8, 6.4, 9.2)
      : region === 'ocean'
        ? new THREE.Vector3(6.4, 6.9, 9.6)
        : new THREE.Vector3(6.1, 7.2, 9.1)
    let frameScale = aspect < 1.35 ? 1.35 / Math.max(.62, aspect) : 1
    homePosition.copy(overviewTarget).add(cameraOffset.clone().multiplyScalar(frameScale))
    camera.position.copy(homePosition)
    camera.lookAt(cameraTarget)
    const initialWalkCurve = hasActiveTier ? walkingCurve(lawyer.position.clone(), initialDestination) : null
    let walking: WalkState | null = initialWalkCurve ? {
        curve: initialWalkCurve,
        delayMs: 420,
        duration: walkDuration(initialWalkCurve.getLength()),
        elapsedMs: 0,
        lastProgress: 0,
      } : null

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(1.28, 1.42, 64),
      new THREE.MeshBasicMaterial({ color: 0xe4c36e, transparent: true, opacity: .82, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
    )
    selectionRing.renderOrder = 44
    selectionRing.rotation.x = -Math.PI / 2
    selectionRing.position.y = .18
    selectionRing.visible = false
    world.add(selectionRing)

    // District landmarks: named places the player can inspect and travel to.
    const landmarks = ((world.userData.landmarks ?? []) as MapLandmark[]).slice().sort((a, b) => a.position[0] - b.position[0])
    const landmarkRing = new THREE.Mesh(
      new THREE.RingGeometry(.82, .94, 52),
      new THREE.MeshBasicMaterial({ color: 0x8fd3c4, transparent: true, opacity: .7, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
    )
    landmarkRing.rotation.x = -Math.PI / 2
    landmarkRing.position.y = .2
    landmarkRing.renderOrder = 42
    landmarkRing.visible = false
    world.add(landmarkRing)
    // The area behind that ring. Shown for whichever district the pointer is
    // over, and left on the last one the district directory travelled to, so
    // choosing a district from the list highlights the ground it covers instead
    // of only moving the camera towards it.
    const landmarkWash = createRegionWash(0x8fd3c4, .14)
    landmarkWash.visible = false
    world.add(landmarkWash)
    let focusedLandmark: MapLandmark | null = null
    landmarksRef.current?.(landmarks)

    // Held landmarks: purely additive, and cheap. `ownedLandmarks` is
    // typically empty or a handful of keys, so this is a handful of extra
    // meshes built from geometry/materials already shared elsewhere in the
    // file, added before `batchStaticScenery` runs so they fold into the same
    // static batches as everything else.
    if (ownedLandmarks?.length) {
      const heldKeys = new Set(ownedLandmarks)
      for (const landmark of landmarks) {
        if (!heldKeys.has(landmark.key)) continue
        const accent = createHeldLandmarkAccent(landmark.radius)
        accent.position.set(landmark.position[0], 0, landmark.position[1])
        world.add(accent)
      }
    }

    const cloudCount = region === 'city' ? 14 : region === 'ocean' ? 10 : region === 'orbit' ? 0 : 8
    for (let i = 0; i < cloudCount; i += 1) {
      const cloud = createCloud(i, region)
      cloud.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = false })
      world.add(cloud)
    }
    world.add(createAtmosphericPoints(region))

    // Index only the objects that actually animate. The former per-frame
    // world.traverse visited every window, cornice, tree cluster, and prop—
    // thousands of objects—to update a comparatively small moving set.
    const animatedObjects: THREE.Object3D[] = []
    scene.traverse((object) => {
      const data = object.userData
      if (
        data.cloud || data.tree || data.fountainSpray || data.crane || data.lighthouse || data.lighthouseBeam
        || data.turbine || data.orbitalRing || data.radarDish || data.planet || data.signal || data.atmosphere
        || data.waterUniforms || data.skyUniforms || data.auroraUniforms || data.flagUniforms || data.mapLabelKind
        || data.mapObjectKind || data.mapEmphasisKind || data.lawyerBeacon || data.playerMarker || data.destinationMarker
        || data.buoy || data.marshBlade || data.ambientActor || data.ambientWing
      ) animatedObjects.push(object)
    })

    const selectableRoots: THREE.Object3D[] = []
    world.traverse((object) => { if (object.userData.mapSelection) selectableRoots.push(object) })

    // The one list of things that move under their own steam. Batching treats
    // each as a boundary and the matrix freeze further down exempts the same
    // set, so the two cannot drift apart.
    const liveObjects = new Set<THREE.Object3D>()
    animatedObjects.forEach((object) => liveObjects.add(object))
    selectableRoots.forEach((object) => liveObjects.add(object))
    transports.forEach(({ object }) => liveObjects.add(object))
    // Pooled agents are driven by the simulations, and the crowd's two batches
    // have their instance matrices rewritten every frame, so neither may be
    // folded into a static batch or have its own matrix frozen.
    pooledVehicles.forEach((object) => liveObjects.add(object))
    if (crowdRenderer) crowdRenderer.group.traverse((object) => liveObjects.add(object))
    if (rivalGuardRenderer) rivalGuardRenderer.group.traverse((object) => liveObjects.add(object))
    // The rig animates limb by limb, so no part of it may be baked.
    lawyer.traverse((object) => liveObjects.add(object))
    if (transitCarrier) liveObjects.add(transitCarrier)
    liveObjects.add(selectionRing)
    liveObjects.add(landmarkRing)
    // Moved and rescaled onto whichever district is under the pointer, so its
    // matrix cannot be frozen into a batch either.
    liveObjects.add(landmarkWash)

    // The world is complete here; nothing below adds static scenery, so this is
    // the point at which it can be safely baked into batches.
    // Before the batcher merges most of these groups out of existence. The
    // conform half runs always — it is a placement fix, not instrumentation;
    // only the O(n²) overlap report is gated to development.
    conformAndAuditProps(world, region, import.meta.env.DEV)
    // Harvested here for the same reason the audit above runs here: one line
    // further down the parked fleet is anonymous triangles inside a merged
    // batch. The moving pool stays addressable through its simulation, so this
    // registry is only ever asked about bodies that stand still.
    const vehicleHulls = collectVehicleHulls(world, liveObjects)
    batchStaticScenery(world, liveObjects)

    const playerOccluders = world.children.filter((object) => object.userData.playerOccluder)

    // Top-level scenery cells are removed from both rendering and traversal
    // when their complete bounds leave the camera frustum. Bounds are padded
    // to avoid visible popping during small camera rotations.
    world.updateMatrixWorld(true)
    const performanceCullables = world.children.flatMap((object) => {
      if (
        object.userData.mapSelection || object.userData.careerInfrastructure || object.userData.cloud
        || object.userData.ambientActor || (!object.userData.performanceCullRadius && !object.userData.playerOccluder
          && !object.userData.tree && !object.userData.authoredProp)
      ) return []
      const bounds = new THREE.Box3().setFromObject(object)
      if (bounds.isEmpty()) return []
      const sphere = bounds.getBoundingSphere(new THREE.Sphere())
      sphere.radius *= 1.28
      return [{ object, sphere }]
    })
    const viewProjection = new THREE.Matrix4()
    const cameraFrustum = new THREE.Frustum()
    const updatePerformanceCulling = () => {
      camera.updateMatrixWorld()
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      cameraFrustum.setFromProjectionMatrix(viewProjection)
      performanceCullables.forEach(({ object, sphere }) => {
        const visible = cameraFrustum.intersectsSphere(sphere)
        if (object.visible !== visible) object.visible = visible
      })
    }

    // Most of the district never moves. Freezing its local matrices avoids
    // recomposing thousands of windows, walls, roofs, and props every frame.
    // Animated roots remain live; their descendants still inherit the moving
    // parent matrix, so this does not alter any visible motion.
    scene.updateMatrixWorld(true)
    scene.traverse((object) => { object.matrixAutoUpdate = false })
    liveObjects.forEach((object) => { object.matrixAutoUpdate = true })

    // The first render is deferred until every shader program has been
    // compiled in parallel; see the `compileAsync` call that starts the loop.
    // It still has to run before any camera-dependent culling so the one-off
    // static shadow map sees every caster, including off-screen ones.

    let targetYaw = 0
    let targetPitch = 0
    let zoom = 1
    let cameraMode: 'counsel' | 'overview' = 'counsel'

    // Ambient drift, so the world is never a still photograph.
    //
    // The reference diorama this style is drawn from is never once stationary:
    // it turns continuously, at roughly a dozen degrees a second, while the
    // interface stays pinned in screen space. That perpetual motion is most of
    // why it reads as a place rather than a picture, and it is the single
    // biggest difference in feel from a map that sits perfectly still until it
    // is dragged.
    //
    // Copied as a slow sway rather than as a full rotation, for two reasons.
    // The yaw here is clamped to a little over half a radian to protect the
    // authored framing, so a continuous spin would simply pin itself against
    // that stop; and this is a map a student reads, not a title screen, so
    // motion fast enough to notice while aiming at a building would be hostile.
    // A long sinusoid keeps the parallax alive without ever pulling focus.
    let lastInteractionAt = -Infinity
    let ambientWeight = 0
    const noteInteraction = () => { lastInteractionAt = performance.now() }
    let dragging = false
    let panning = false
    const pointerStart = new THREE.Vector2()
    let moved = false
    const touchPointers = new Map<number, THREE.Vector2>()
    let pinchDistance = 0
    const pinchCentre = new THREE.Vector2()
    let hoveredRoot: THREE.Object3D | null = null
    let hoveredLandmark: MapLandmark | null = null

    // Free-look: an offset applied to whatever the camera is following, so
    // the player can survey a district without losing the counsel or the
    // authored framing. Bounded so the world can never be left behind.
    const panOffset = new THREE.Vector3()
    const panLimit = region === 'city' ? 26 : region === 'orbit' ? 20 : 23
    const ZOOM_MIN = .48
    // Far enough out to actually survey a district. At the old 2.05 ceiling the
    // camera topped out around sixteen units up, which is barely above the
    // rooftops - close enough that the map only ever showed three or four
    // buildings at once, so the street plan underneath it could never be read
    // and every region looked like an arbitrary pile of houses.
    const ZOOM_MAX = 3.9
    const panForward = new THREE.Vector3()
    const panRight = new THREE.Vector3()
    const clampPan = () => {
      const distance = Math.hypot(panOffset.x, panOffset.z)
      if (distance > panLimit) panOffset.multiplyScalar(panLimit / distance)
      panOffset.y = 0
    }
    /** Moves the survey offset by a screen-space drag, in device pixels. */
    const panByPixels = (dx: number, dy: number) => {
      const distance = Math.max(1, camera.position.distanceTo(cameraTarget))
      const perPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, renderer.domElement.clientHeight)
      camera.getWorldDirection(panForward)
      // Vertical drags cover more ground than horizontal ones on a tilted
      // camera, because the screen axis is foreshortened against the ground.
      const tilt = Math.max(.35, Math.abs(panForward.y))
      panForward.y = 0
      panForward.normalize()
      panRight.crossVectors(panForward, frameAxisY).normalize()
      panOffset.addScaledVector(panRight, -dx * perPixel)
      panOffset.addScaledVector(panForward, dy * perPixel / tilt)
      clampPan()
      // Surveying detaches from the counsel; otherwise the follow camera
      // would immediately drag the view back.
      if (cameraMode === 'counsel') cameraMode = 'overview'
    }
    const panByWorld = (right: number, forward: number) => {
      camera.getWorldDirection(panForward)
      panForward.y = 0
      panForward.normalize()
      panRight.crossVectors(panForward, frameAxisY).normalize()
      panOffset.addScaledVector(panRight, right)
      panOffset.addScaledVector(panForward, forward)
      clampPan()
      if (cameraMode === 'counsel') cameraMode = 'overview'
    }

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const groundHit = new THREE.Vector3()
    /**
     * Landmarks are picked against the ground plane rather than against scene
     * objects: their geometry has been merged into shared static batches by
     * this point, so there is no per-landmark object left to raycast, and a
     * plane intersection plus a short distance test is far cheaper anyway.
     */
    const landmarkAt = (event: PointerEvent) => {
      if (!landmarks.length) return null
      pointerNdc(event)
      raycaster.setFromCamera(pointer, camera)
      if (!raycaster.ray.intersectPlane(groundPlane, groundHit)) return null
      let best: MapLandmark | null = null
      let bestDistance = Number.POSITIVE_INFINITY
      for (const landmark of landmarks) {
        const distance = Math.hypot(landmark.position[0] - groundHit.x, landmark.position[1] - groundHit.z)
        if (distance < landmark.radius && distance < bestDistance) {
          best = landmark
          bestDistance = distance
        }
      }
      return best
    }
    /** Puts the wash over one district, or takes it off the map. */
    const showLandmarkArea = (landmark: MapLandmark | null) => {
      landmarkWash.visible = Boolean(landmark)
      if (!landmark) return
      landmarkWash.position.set(landmark.position[0], WASH_Y, landmark.position[1])
      landmarkWash.scale.setScalar(landmark.radius)
    }
    const setHoveredLandmark = (landmark: MapLandmark | null, event: PointerEvent | null) => {
      if (landmark === hoveredLandmark) return
      hoveredLandmark = landmark
      landmarkRing.visible = Boolean(landmark)
      if (landmark) {
        landmarkRing.position.set(landmark.position[0], .2, landmark.position[1])
        landmarkRing.scale.setScalar(landmark.radius)
      }
      showLandmarkArea(landmark ?? focusedLandmark)
      landmarkHoverRef.current?.(landmark, landmark && event ? { x: event.clientX, y: event.clientY } : null)
    }
    /** Frames a named landmark; used by the district directory. */
    const travelToLandmark = (key: string) => {
      const landmark = landmarks.find((candidate) => candidate.key === key)
      if (!landmark) return
      focusedLandmark = landmark
      showLandmarkArea(landmark)
      cameraMode = 'overview'
      panOffset.set(landmark.position[0] - overviewTarget.x, 0, landmark.position[1] - overviewTarget.z)
      clampPan()
      zoom = Math.max(ZOOM_MIN, .72)
      targetYaw = 0
    }
    let lastCommandId = cameraCommand.id
    let lastViewMode = viewMode
    let lastSelectedKey = selectedKey
    const raycaster = new THREE.Raycaster()
    const occlusionRaycaster = new THREE.Raycaster()
    // Occlusion checks traverse the whole world, including billboard labels.
    // Sprites require the active camera even when the ray was set manually.
    occlusionRaycaster.camera = camera
    const fadedOccluders = new Set<THREE.Object3D>()
    const pointer = new THREE.Vector2()
    let elapsed = 0
    let occlusionTimer = 0
    let cullingTimer = 0
    let previousFrame = performance.now()
    let animationFrame = 0
    let disposed = false
    // Nothing may render until shader compilation finishes, otherwise the
    // driver links the programs one at a time inside a frame and stalls.
    let ready = false
    let surfaceVisible = true
    let lastHoverRaycast = 0
    const lastOcclusionCamera = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0)
    const lastOcclusionPlayer = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0)
    const lastCullingCamera = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0)
    const frameTarget = new THREE.Vector3()
    const frameCamera = new THREE.Vector3()
    const frameAxisY = new THREE.Vector3(0, 1, 0)
    const transportPosition = new THREE.Vector3()
    const transportTangent = new THREE.Vector3()
    const walkPosition = new THREE.Vector3()
    const walkTangent = new THREE.Vector3()
    const occlusionFocus = new THREE.Vector3()
    const occlusionDirection = new THREE.Vector3()

    // Materials are shared across the whole district now, so fading one building
    // by editing its material in place would fade every building that happens to
    // share the look. Each material instead gets one lazily-built faded twin, and
    // fading swaps the reference. That also avoids the shader recompile that
    // toggling `transparent` on a live material triggers.
    const fadedTwins = new Map<THREE.Material, THREE.Material>()
    const fadedTwinOf = (source: THREE.Material) => {
      const cached = fadedTwins.get(source)
      if (cached) return cached
      const twin = source.clone()
      twin.transparent = true
      twin.opacity = Math.min(source.opacity, .24)
      twin.depthWrite = false
      // `clone` carries userData across, but a twin belongs to this mount alone
      // and is disposed with it, so it must not claim the shared exemption.
      twin.userData = {}
      fadedTwins.set(source, twin)
      return twin
    }
    const setOccluderFade = (root: THREE.Object3D, faded: boolean) => {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        const original = object.userData.playerOcclusionMaterial as THREE.Material | THREE.Material[] | undefined
        if (faded) {
          if (original) return
          object.userData.playerOcclusionMaterial = object.material
          object.material = Array.isArray(object.material)
            ? object.material.map(fadedTwinOf)
            : fadedTwinOf(object.material)
        } else if (original) {
          object.material = original
          delete object.userData.playerOcclusionMaterial
        }
      })
    }

    const updatePlayerOcclusion = () => {
      occlusionFocus.copy(lawyer.position).y += 1.05
      occlusionDirection.copy(occlusionFocus).sub(camera.position)
      const distance = occlusionDirection.length()
      occlusionRaycaster.set(camera.position, occlusionDirection.normalize())
      occlusionRaycaster.far = Math.max(.1, distance - .32)
      const next = new Set<THREE.Object3D>()
      const hits = occlusionRaycaster.intersectObjects(playerOccluders.filter((root) => root.visible), true)
      for (const hit of hits) {
        let root: THREE.Object3D | null = hit.object
        while (root && root.parent !== world) root = root.parent
        if (root?.userData.playerOccluder) next.add(root)
        if (next.size >= 2) break
      }
      fadedOccluders.forEach((root) => { if (!next.has(root)) setOccluderFade(root, false) })
      next.forEach((root) => { if (!fadedOccluders.has(root)) setOccluderFade(root, true) })
      fadedOccluders.clear()
      next.forEach((root) => fadedOccluders.add(root))
    }

    const pointerNdc = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }
    const hitSelection = (event: PointerEvent) => {
      pointerNdc(event)
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(selectableRoots.filter((root) => root.visible), true)
      for (const hit of hits) {
        let current: THREE.Object3D | null = hit.object
        while (current) {
          const selection = current.userData.mapSelection as { kind?: MapSceneKind } | undefined
          const expectedKind: MapSceneKind = modeRef.current === 'career' ? 'tier' : modeRef.current === 'rivals' ? 'rival' : 'event'
          if (selection?.kind === expectedKind) return current
          current = current.parent
        }
      }
      return null
    }
    const onPointerDown = (event: PointerEvent) => {
      noteInteraction()
      renderer.domElement.focus({ preventScroll: true })
      if (event.pointerType === 'touch') {
        touchPointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY))
        renderer.domElement.setPointerCapture(event.pointerId)
        if (touchPointers.size >= 2) {
          const [first, second] = Array.from(touchPointers.values())
          pinchDistance = first.distanceTo(second)
          pinchCentre.copy(first).add(second).multiplyScalar(.5)
          dragging = false
          moved = true
          renderer.domElement.classList.remove('is-grabbing')
          event.preventDefault()
          return
        }
      }
      // Secondary button, middle button or a held modifier surveys the
      // district; the plain drag keeps orbiting, so nothing existing changes.
      panning = event.button === 1 || event.button === 2 || event.shiftKey || event.metaKey
      dragging = true; moved = false; pointerStart.set(event.clientX, event.clientY)
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.classList.add('is-grabbing')
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
        touchPointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY))
        if (touchPointers.size >= 2) {
          const [first, second] = Array.from(touchPointers.values())
          const nextDistance = first.distanceTo(second)
          if (pinchDistance > 0 && nextDistance > 0) zoom = THREE.MathUtils.clamp(zoom * pinchDistance / nextDistance, ZOOM_MIN, ZOOM_MAX)
          // Two fingers also pan, so a phone gets the same survey freedom a
          // pointer does rather than only being able to zoom.
          const nextCentre = first.clone().add(second).multiplyScalar(.5)
          if (pinchCentre.lengthSq() > 0) panByPixels(nextCentre.x - pinchCentre.x, nextCentre.y - pinchCentre.y)
          pinchCentre.copy(nextCentre)
          pinchDistance = nextDistance
          moved = true
          dragging = false
          event.preventDefault()
          return
        }
      }
      if (dragging) {
        // Never raycast while surveying the map. Pointermove may fire faster
        // than the display refresh rate, and selection cannot occur mid-drag.
        renderer.domElement.style.cursor = panning ? 'move' : 'grabbing'
        const dx = event.clientX - pointerStart.x
        const dy = event.clientY - pointerStart.y
        if (Math.hypot(dx, dy) > 4) moved = true
        if (panning) panByPixels(dx, dy)
        else {
          targetYaw = THREE.MathUtils.clamp(targetYaw + dx * .0022, -.95, .95)
          targetPitch = THREE.MathUtils.clamp(targetPitch + dy * .0013, -.14, .3)
        }
        pointerStart.set(event.clientX, event.clientY)
        return
      }
      // Hover feedback does not need a 120 Hz raycast. A 30 Hz sample is
      // visually immediate and leaves the main thread available for WebGL.
      if (event.timeStamp - lastHoverRaycast < 32) return
      lastHoverRaycast = event.timeStamp
      const root = hitSelection(event)
      if (root !== hoveredRoot) {
        if (hoveredRoot) {
          hoveredRoot.scale.multiplyScalar(1 / 1.025)
          hoveredRoot.traverse((object) => { if (object.userData.destinationMarker) object.userData.destinationHover = false })
        }
        hoveredRoot = root
        if (hoveredRoot) {
          hoveredRoot.scale.multiplyScalar(1.025)
          hoveredRoot.traverse((object) => { if (object.userData.destinationMarker) object.userData.destinationHover = true })
        }
      }
      // Career markers win over landmarks: a headquarters and a square can
      // overlap, and the progression target must stay the easier of the two.
      const landmark = root ? null : landmarkAt(event)
      setHoveredLandmark(landmark, event)
      renderer.domElement.style.cursor = root || landmark ? 'pointer' : 'grab'
    }
    const onPointerUp = (event: PointerEvent) => {
      const wasPinching = event.pointerType === 'touch' && touchPointers.size >= 2
      if (event.pointerType === 'touch') {
        touchPointers.delete(event.pointerId)
        if (touchPointers.size < 2) { pinchDistance = 0; pinchCentre.set(0, 0) }
      }
      dragging = false
      panning = false
      renderer.domElement.classList.remove('is-grabbing')
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
      if (wasPinching || moved) return
      const root = hitSelection(event)
      const selection = root?.userData.mapSelection as { key: string; locked: boolean } | undefined
      if (!selection) {
        const landmark = landmarkAt(event)
        if (landmark) {
          setHoveredLandmark(landmark, event)
          landmarkSelectRef.current?.(landmark)
          travelToLandmark(landmark.key)
        }
        return
      }
      selectRef.current(selection.key)
      lastSelectedKey = selection.key
      const anchor = travelAnchors.get(selection.key) ?? anchors.get(selection.key)
      if (anchor && !selection.locked) {
        const target = anchor.clone().setY(.12)
        const curve = walkingCurve(lawyer.position.clone(), target)
        walking = {
          curve,
          delayMs: 0,
          duration: walkDuration(curve.getLength()),
          elapsedMs: 0,
          lastProgress: 0,
        }
        cameraMode = 'counsel'
        zoom = 1
        panOffset.set(0, 0, 0)
      }
    }
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        touchPointers.delete(event.pointerId)
        if (touchPointers.size < 2) pinchDistance = 0
      }
      dragging = false
      panning = false
      renderer.domElement.classList.remove('is-grabbing')
      if (hoveredRoot) hoveredRoot.scale.multiplyScalar(1 / 1.025)
      if (hoveredRoot) hoveredRoot.traverse((object) => { if (object.userData.destinationMarker) object.userData.destinationHover = false })
      hoveredRoot = null
      setHoveredLandmark(null, null)
    }
    const onPointerCancel = (event: PointerEvent) => {
      touchPointers.delete(event.pointerId)
      if (touchPointers.size < 2) pinchDistance = 0
      dragging = false
      panning = false
      moved = true
      renderer.domElement.classList.remove('is-grabbing')
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
    }
    const onWheel = (event: WheelEvent) => {
      noteInteraction()
      event.preventDefault()
      zoom = THREE.MathUtils.clamp(zoom * (event.deltaY > 0 ? 1.08 : .92), ZOOM_MIN, ZOOM_MAX)
    }
    const onContextMenu = (event: MouseEvent) => { event.preventDefault() }
    // Keyboard survey. The canvas is focusable, so the map is navigable
    // without a pointer at all.
    const onKeyDown = (event: KeyboardEvent) => {
      noteInteraction()
      const step = event.shiftKey ? 4.2 : 1.9
      switch (event.key) {
        case 'ArrowLeft': case 'a': case 'A': panByWorld(-step, 0); break
        case 'ArrowRight': case 'd': case 'D': panByWorld(step, 0); break
        case 'ArrowUp': case 'w': case 'W': panByWorld(0, step); break
        case 'ArrowDown': case 's': case 'S': panByWorld(0, -step); break
        case 'q': case 'Q': targetYaw = THREE.MathUtils.clamp(targetYaw - .16, -.95, .95); break
        case 'e': case 'E': targetYaw = THREE.MathUtils.clamp(targetYaw + .16, -.95, .95); break
        case '+': case '=': zoom = THREE.MathUtils.clamp(zoom * .88, ZOOM_MIN, ZOOM_MAX); break
        case '-': case '_': zoom = THREE.MathUtils.clamp(zoom * 1.14, ZOOM_MIN, ZOOM_MAX); break
        case '0': case 'Home': panOffset.set(0, 0, 0); zoom = 1; targetYaw = 0; targetPitch = 0; cameraMode = 'overview'; break
        case 'f': case 'F': panOffset.set(0, 0, 0); zoom = 1; targetYaw = 0; targetPitch = 0; cameraMode = 'counsel'; break
        default: return
      }
      event.preventDefault()
    }
    renderer.domElement.tabIndex = 0
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)
    renderer.domElement.addEventListener('pointercancel', onPointerCancel)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
    renderer.domElement.addEventListener('contextmenu', onContextMenu)
    renderer.domElement.addEventListener('keydown', onKeyDown)

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      stylePass.setSize(width, height)
      camera.aspect = width / height
      frameScale = camera.aspect < 1.35 ? 1.35 / Math.max(.62, camera.aspect) : 1
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)

    const animate = (frameNow = performance.now()) => {
      animationFrame = 0
      if (disposed || !surfaceVisible || document.hidden) return
      const delta = Math.min(.035, Math.max(0, (frameNow - previousFrame) / 1000))
      previousFrame = frameNow
      elapsed += delta
      if (modeRef.current !== lastViewMode) {
        lastViewMode = modeRef.current
        if (lastViewMode === 'career') { zoom = cameraMode === 'counsel' ? 1 : .92; targetYaw = 0 }
        else if (lastViewMode === 'rivals') { cameraMode = 'overview'; zoom = .89; targetYaw = .09 }
        else { cameraMode = 'overview'; zoom = .9; targetYaw = -.08 }
      }
      const command = commandRef.current
      if (command.id !== lastCommandId) {
        lastCommandId = command.id
        if (command.action === 'in') zoom = Math.max(ZOOM_MIN, zoom * .84)
        else if (command.action === 'out') zoom = Math.min(ZOOM_MAX, zoom * 1.14)
        else if (command.action === 'landmark') travelToLandmark(command.landmark ?? '')
        else if (command.action === 'focus') { cameraMode = 'counsel'; zoom = 1; targetYaw = 0; targetPitch = 0; panOffset.set(0, 0, 0) }
        else { cameraMode = 'overview'; zoom = 1; targetYaw = 0; targetPitch = 0; panOffset.set(0, 0, 0) }
      }
      if (selectedRef.current !== lastSelectedKey) {
        lastSelectedKey = selectedRef.current
        const selectedPoint = points.find((point) => point.key === lastSelectedKey)
        const locked = selectedPoint?.kind === 'tier' ? selectedPoint.state === 'locked' : selectedPoint?.locked
        const selectedAnchor = travelAnchors.get(lastSelectedKey) ?? anchors.get(lastSelectedKey)
        if (selectedAnchor && !locked) {
          const target = selectedAnchor.clone().setY(.12)
          const curve = walkingCurve(lawyer.position.clone(), target)
          walking = { curve, delayMs: 0, duration: walkDuration(curve.getLength()), elapsedMs: 0, lastProgress: 0 }
          cameraMode = 'counsel'
          zoom = 1
          panOffset.set(0, 0, 0)
        }
      }
      const desiredTarget = cameraMode === 'counsel'
        ? frameTarget.set(lawyer.position.x + panOffset.x, region === 'orbit' ? 1.35 : 1.15, lawyer.position.z + panOffset.z)
        : frameTarget.set(overviewTarget.x + panOffset.x, overviewTarget.y, overviewTarget.z + panOffset.z)
      const targetFollow = 1 - Math.exp(-(cameraMode === 'counsel' ? (walking ? 3.4 : 2.15) : 5) * delta)
      cameraTarget.lerp(desiredTarget, targetFollow)
      const desiredCamera = frameCamera.copy(cameraMode === 'counsel' ? counselOffset : cameraOffset).multiplyScalar(zoom * frameScale)
      // Fade the drift in only once the player has been still for a moment, and
      // drop it the instant they touch anything. Drifting under someone's hand
      // while they are trying to aim at a building would feel like the map
      // fighting them, so the ramp is deliberately asymmetric: about two
      // seconds to arrive, four times quicker to leave.
      const idleSeconds = (performance.now() - lastInteractionAt) / 1000
      const wantsAmbient = idleSeconds > 3.5 && !dragging && !panning
      ambientWeight = THREE.MathUtils.clamp(
        ambientWeight + delta * (wantsAmbient ? .5 : -2),
        0,
        1,
      )
      // Two incommensurate periods, so the sway never settles into a loop the
      // eye can predict, and a much smaller rise and fall so the horizon
      // breathes rather than pumps.
      const ambientYaw = (Math.sin(elapsed * .085) * .16 + Math.sin(elapsed * .031) * .06) * ambientWeight
      const ambientLift = Math.sin(elapsed * .057 + 1.2) * .55 * ambientWeight
      desiredCamera.applyAxisAngle(frameAxisY, targetYaw + ambientYaw)
      // Surveying is not simply standing further back. As the view pulls out
      // the camera also climbs toward a planning angle, because a district's
      // layout - the grid, the squares, the way the route threads between them
      // - only reads from above. Held at the walking camera's low oblique, a
      // zoomed-out map just shows more rooftops from the same useless height.
      const surveyLift = Math.max(0, zoom - 1) * (region === 'orbit' ? 6.5 : 12)
      desiredCamera.y += targetPitch * 18 + surveyLift + ambientLift
      desiredCamera.add(cameraTarget)
      camera.position.lerp(desiredCamera, 1 - Math.exp(-3.4 * delta))
      camera.lookAt(cameraTarget)
      occlusionTimer += delta
      const occlusionMoved = camera.position.distanceToSquared(lastOcclusionCamera) > .0025 || lawyer.position.distanceToSquared(lastOcclusionPlayer) > .0016
      if (occlusionTimer >= .12 && occlusionMoved) {
        occlusionTimer = 0
        updatePlayerOcclusion()
        lastOcclusionCamera.copy(camera.position)
        lastOcclusionPlayer.copy(lawyer.position)
      }
      cullingTimer += delta
      if (cullingTimer >= .16 && camera.position.distanceToSquared(lastCullingCamera) > .0064) {
        cullingTimer = 0
        updatePerformanceCulling()
        lastCullingCamera.copy(camera.position)
      }
      civicGlow.intensity = (region === 'orbit' ? 7.5 : 5.2) + Math.sin(elapsed * .65) * .22

      transports.forEach((transport) => {
        let t: number
        let forward = true
        if (transport.mode === 'shuttle') {
          // Walk the stopping pattern. Within a leg the position is eased, so
          // the vehicle pulls away from one call and brakes into the next;
          // between legs it stands still for the dwell. Both are derived from
          // `elapsed` rather than integrated, so a dropped frame cannot leave a
          // train permanently out of step with its own timetable.
          let time = (elapsed + transport.offset * transport.cycle) % transport.cycle
          let position = transport.legs.length ? transport.legs[0].from : 0
          for (const leg of transport.legs) {
            if (time < leg.travel) {
              position = leg.from + (leg.to - leg.from) * THREE.MathUtils.smoothstep(time / leg.travel, 0, 1)
              forward = leg.forward
              break
            }
            time -= leg.travel
            if (time < leg.dwell) { position = leg.to; forward = leg.forward; break }
            time -= leg.dwell
          }
          t = position
        } else {
          t = (elapsed * transport.speed + transport.offset) % 1
        }
        const sample = THREE.MathUtils.clamp(t, .0005, .9995)
        transport.curve.getPointAt(sample, transportPosition)
        transport.curve.getTangentAt(sample, transportTangent)
        transport.object.position.copy(transportPosition)
        transport.object.position.y += transport.lift
        // Vehicles, trains, ferries, and craft are modeled on local +X.
        // Aligning them as if they faced +Z made traffic slide sideways.
        // A reversing shuttle keeps its heading through the return leg.
        const heading = forward || transport.reverses ? 1 : -1
        transport.object.rotation.y = -Math.atan2(transportTangent.z * heading, transportTangent.x * heading)
        // Wake strength from the distance actually covered this frame, which is
        // the only measure that stays honest through the shuttle's braking and
        // dwell: a ferry standing at a quay now shows nothing, and one pulling
        // away builds its wake as it gathers way.
        const wake = transport.object.userData.wake as { material: THREE.Material & { opacity: number }; arms: THREE.Mesh[] } | undefined
        if (wake) {
          const moved = Number.isNaN(transport.lastX)
            ? 0
            : Math.hypot(transport.object.position.x - transport.lastX, transport.object.position.z - transport.lastZ)
          transport.lastX = transport.object.position.x
          transport.lastZ = transport.object.position.z
          const speed = delta > 1e-4 ? moved / delta : 0
          const strength = THREE.MathUtils.clamp(speed / 1.6, 0, 1)
          wake.material.opacity = .32 * strength
          const showing = strength > .05
          for (const arm of wake.arms) {
            arm.visible = showing
            // Longer and wider the faster it goes, which is the cue that reads
            // at this camera distance far more than the opacity does.
            arm.scale.set(.5 + strength * .8, 1, .45 + strength * .8)
          }
        }
      })
      if (walking) {
        walking.elapsedMs += delta * 1000
        const progress = THREE.MathUtils.clamp((walking.elapsedMs - walking.delayMs) / walking.duration, 0, 1)
        // How counsel gets up to speed and back down again.
        //
        // This used to be one cubic ease stretched across the whole journey,
        // which meant the walk had no cruise in it at all: on a long route
        // counsel crept away from the kerb, sprinted through the middle and
        // crept into the destination, because the acceleration phase scaled
        // with the length of the trip. A person accelerates to a walking pace
        // in well under a second and then holds it however far they are going.
        //
        // So the profile is a trapezoid in *time*: fixed ramps at each end, a
        // constant cruise between them, and the peak speed solved so the area
        // under it is still exactly one journey — the arrival still lands on
        // `duration` to the millisecond, which the career sequencing depends
        // on.
        const rampUp = Math.min(.22, 620 / Math.max(1, walking.duration))
        const rampDown = Math.min(.28, 780 / Math.max(1, walking.duration))
        const cruise = 1 / Math.max(.2, 1 - rampUp / 2 - rampDown / 2)
        let eased: number
        let pace: number
        if (progress < rampUp) {
          eased = cruise * progress * progress / (2 * rampUp)
          pace = cruise * progress / rampUp
        } else if (progress < 1 - rampDown) {
          eased = cruise * (rampUp / 2 + (progress - rampUp))
          pace = cruise
        } else {
          const left = 1 - progress
          eased = 1 - cruise * left * left / (2 * rampDown)
          pace = cruise * left / rampDown
        }
        eased = THREE.MathUtils.clamp(eased, 0, 1)
        walking.curve.getPointAt(eased, walkPosition)
        walking.curve.getTangentAt(Math.min(.999, Math.max(.001, eased)), walkTangent).normalize()
        lawyer.position.copy(walkPosition)
        const desiredHeading = Math.atan2(walkTangent.x, walkTangent.z)
        // Shortest arc. Damping the raw angle meant that any turn which
        // happened to cross the +/-pi seam sent counsel spinning the whole way
        // round the other way — the single most visible thing wrong with this
        // walk, and it fired on the same corners every run because the route
        // is fixed.
        const turn = ((desiredHeading - lawyer.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        const agility = progress < .08 ? 5.2 : 10.5
        const applied = turn * (1 - Math.exp(-agility * delta))
        lawyer.rotation.y += applied
        walking.lastProgress = progress
        if (progress >= 1) walking = null
      }
      if (transitCarrier) {
        if (walking) {
          transitCarrier.visible = true
          transitCarrier.position.set(lawyer.position.x, lawyer.position.y - .03, lawyer.position.z)
          transitCarrier.rotation.y = lawyer.rotation.y - Math.PI / 2
          lawyer.position.y += .72
        } else {
          transitCarrier.visible = false
          lawyer.position.y = .12
        }
      }
      // --- counsel's gait ---------------------------------------------------
      // The body has already been placed for this frame, so its displacement
      // since the last one is the only honest measure of how fast it is
      // travelling — and the one thing the rig asks for. Taken in world space
      // from the holder, in the plane only: the swim's submersion and the
      // orbital carrier's lift both move the body vertically without it
      // covering any ground, and counting that as travel would drive the stride.
      lawyer.updateWorldMatrix(true, false)
      lawyer.getWorldPosition(counselWorld)
      const travelled = counselPlaced
        ? Math.hypot(counselWorld.x - counselPrevious.x, counselWorld.z - counselPrevious.z)
        : 0
      counselPrevious.copy(counselWorld)
      counselPlaced = true
      // Riding the orbital craft is not walking, however fast the craft moves.
      const carried = transitCarrier !== null && walking !== null
      const groundSpeed = carried || delta <= 1e-4 ? 0 : travelled / delta
      if (region === 'ocean') {
        if (walking && swimPhase === 'dry') {
          swimPhase = 'entering'
          counsel.setState('swim')
          counsel.playGesture('swimEnter')
        } else if (!walking && (swimPhase === 'swimming' || swimPhase === 'entering')) {
          swimPhase = 'leaving'
          counsel.playGesture('swimExit')
          counsel.setState('idle')
        } else if (walking && swimPhase === 'entering' && !counsel.isTransitioning) {
          swimPhase = 'swimming'
        } else if (!walking && swimPhase === 'leaving' && !counsel.isTransitioning) {
          swimPhase = 'dry'
        }
        // Submersion is tracked on its own rather than by damping
        // `position.y`, because the traversal curve rewrites that every frame:
        // damping the position directly only ever moved the body one frame's
        // worth off the curve, so counsel skimmed the surface instead of
        // settling into it.
        swimSubmersion = THREE.MathUtils.damp(swimSubmersion, walking ? 1 : 0, 5.2, delta)
        // Absolute, not accumulated: while crossing, the traversal curve has
        // just written this frame's height and the offset applies to it; once
        // ashore there is nothing writing it, and a running `+=` walked
        // counsel steadily down to the sea floor.
        const standingY = walking ? lawyer.position.y : .12
        // A swell under the body, so it is carried rather than dragged.
        const swell = Math.sin(elapsed * 1.7) * .022 * swimSubmersion
        lawyer.position.y = standingY + (SWIM_WATERLINE - .12) * swimSubmersion + swell
        // A slow roll and a swell, so the body is carried by the water.
        lawyer.rotation.z = Math.sin(elapsed * 2.1) * .09 * swimSubmersion
        if (swimRipples.length > 0) {
          // Shed a ring at the hips, a little astern, while there is a body in
          // the water to shed it.
          swimRippleTimer -= delta
          if (swimRippleTimer <= 0 && swimSubmersion > .2) {
            swimRippleTimer = SWIM_RIPPLE_INTERVAL
            const ring = swimRipples[swimRippleNext]
            ring.position.set(
              lawyer.position.x - Math.sin(lawyer.rotation.y) * .3,
              .035,
              lawyer.position.z - Math.cos(lawyer.rotation.y) * .3,
            )
            swimRippleAge[swimRippleNext] = 0
            swimRippleNext = (swimRippleNext + 1) % SWIM_RIPPLE_COUNT
          }
          for (let index = 0; index < swimRipples.length; index += 1) {
            const age = swimRippleAge[index]
            if (age >= SWIM_RIPPLE_LIFE) {
              swimRipples[index].visible = false
              continue
            }
            const next = age + delta
            swimRippleAge[index] = next
            const life = Math.min(1, next / SWIM_RIPPLE_LIFE)
            const ring = swimRipples[index]
            ring.visible = true
            ring.scale.setScalar(.34 + life * 1.55)
            const material = ring.material as THREE.MeshBasicMaterial
            // Squared falloff: a ripple thins out fastest as it spreads.
            material.opacity = .3 * (1 - life) * (1 - life) * Math.max(swimSubmersion, .35)
          }
        }
      } else {
        // Hysteresis against the rig's own natural walking speed rather than a
        // world constant, so the thresholds hold at any character scale: the
        // figure is 0.278 here and 0.46 in the office.
        const natural = Math.max(.15, counsel.naturalWalkSpeed)
        const moving = counselWalking ? groundSpeed > natural * .16 : groundSpeed > natural * .34
        if (moving !== counselWalking) {
          counselWalking = moving
          counsel.setState(moving ? 'walk' : 'idle')
        }
        if (!moving) {
          // Standing beats, so counsel waiting outside a headquarters reads as a
          // person rather than a marker. Additive ones only — an override beat
          // would fade the idle out from under the body — and drawn with a fresh
          // amplitude and rate each time, because a repertoire fired in random
          // order still reads as a loop if every performance is identical.
          counselIdleBeat -= delta
          if (counselIdleBeat <= 0 && !counsel.isPlayingGesture && !counsel.isTransitioning) {
            const roll = hashUnit(elapsed * 1.37 + 4.1)
            counselIdleBeat = 3.4 + hashUnit(elapsed * 2.11) * 5.6
            counsel.playGesture(
              roll < .24 ? 'weightSettle'
                : roll < .44 ? 'breathDeep'
                  : roll < .62 ? 'cuffAdjust'
                    : roll < .78 ? 'glance'
                      : roll < .9 ? 'glanceMirrored' : 'postureReset',
              { amplitude: .72 + hashUnit(elapsed * 3.7) * .5, timeScale: .88 + hashUnit(elapsed * 5.3) * .3 },
            )
          }
        }
      }
      counsel.setGroundSpeed(groundSpeed)
      // Foot planting is the expensive half of the rig and counsel is the one
      // body on the map the player is ever close to, so it keeps `full` in the
      // tracking camera and drops to `medium` — clamped joints, no IK — once the
      // figure is small enough in frame that planted feet are not readable.
      counsel.setLod(camera.position.distanceToSquared(lawyer.position) < 900 ? 'full' : 'medium')
      counsel.update(delta)
      blinkCounsel(lawyerModel.rig, elapsed)

      // Close the crossings for an approaching train.
      //
      // Before the simulations run, so a car reads the barrier on the same frame
      // it is set: claims last exactly one frame by design, and setting them
      // afterwards would have every vehicle acting on where the train was last
      // time. The gate distance is generous — a shuttle at .017 of the curve per
      // second covers ground quickly, and a crossing that closes late is a
      // crossing that does not work.
      if (levelCrossings.length) {
        for (let index = 0; index < transports.length; index += 1) {
          const transport = transports[index]
          if (transport.curve !== railCurve) continue
          const trainX = transport.object.position.x
          const trainZ = transport.object.position.z
          for (let site = 0; site < levelCrossings.length; site += 1) {
            const crossing = levelCrossings[site]
            if (Math.abs(trainX - crossing.x) > LEVEL_CROSSING_GATE) continue
            if (Math.abs(trainZ - crossing.z) > LEVEL_CROSSING_GATE) continue
            if (Math.hypot(trainX - crossing.x, trainZ - crossing.z) > LEVEL_CROSSING_GATE) continue
            for (let sim = 0; sim < trafficSims.length; sim += 1) {
              trafficSims[sim].markPedestrian(crossing.edge, crossing.distance)
            }
          }
        }
      }
      for (let index = 0; index < trafficSims.length; index += 1) trafficSims[index].update(delta, camera)

      // Tell the sea what its one vessel is doing.
      //
      // Read off the hull's own frame-to-frame travel rather than asked of the
      // simulation, for the same reason `attachWake` measures its own speed: the
      // rendered position is eased through junctions, so the boat's *apparent*
      // motion and its simulated distance-along-edge are not the same thing, and
      // it is the apparent motion the water has to agree with.
      if (sea && harbourVessels.length) {
        let vessel: THREE.Object3D | null = null
        for (const boat of harbourVessels) {
          if (boat.visible) { vessel = boat; break }
        }
        if (vessel && delta > 0) {
          const travelX = vessel.position.x - wakeLastX
          const travelZ = vessel.position.z - wakeLastZ
          const travelled = Math.hypot(travelX, travelZ)
          // A fade-in that begins at the previous vessel's last position reads as
          // one enormous jump; anything past a plausible top speed is that, not a
          // boat, so the wake sits it out for a frame.
          const speed = travelled > 3 * delta ? 0 : travelled / delta
          if (travelled > 1e-4) setSeaWake(sea, vessel.position.x, vessel.position.z, travelX, travelZ, speed)
          else setSeaWake(sea, vessel.position.x, vessel.position.z, 1, 0, 0)
          wakeLastX = vessel.position.x
          wakeLastZ = vessel.position.z
        } else if (!vessel) {
          setSeaWake(sea, 0, 0, 1, 0, 0)
        }
      }
      if (crowd) crowd.update(delta, camera)
      // One matrix upload for the whole population, after every walker for
      // this frame has been posed.
      if (crowdRenderer) crowdRenderer.sync()
      // Rival guards never move — no `Crowd`, no pathfinding — but a figure
      // that never so much as breathes reads as a prop rather than a person.
      // A slow head turn and a slower chest sway is the entire animation
      // budget: two rotations per guard, reusing the phase offset chosen when
      // it was built so four guards never drift into lockstep.
      if (rivalGuardRenderer) {
        for (const entry of rivalGuardEntries) {
          const t = elapsed * .5 + entry.phase
          entry.walker.rig.chest.rotation.y = Math.sin(t * .6) * .05
          entry.walker.rig.head.rotation.y = Math.sin(t * .35) * .22
          entry.walker.rig.hips.position.y = entry.baseHipsY + Math.sin(t * 1.7) * .012
        }
        rivalGuardRenderer.sync()
      }
      animatedObjects.forEach((object) => {
        if (object.userData.cloud) {
          object.position.x += object.userData.speed * delta
          if (object.position.x > object.userData.cloudWrapMax) object.position.x = object.userData.cloudWrapMin
          object.position.y = object.userData.cloudBaseY + Math.sin(elapsed * .09 + object.userData.cloudPhase) * .18
          object.position.z = object.userData.cloudBaseZ + Math.sin(elapsed * .055 + object.userData.cloudPhase) * .55
          // Dissolve over the last few units of the run so the wrap is a fade
          // rather than a teleport.
          const material = object.userData.cloudMaterial as THREE.MeshStandardMaterial
          const edge = Math.min(object.position.x - object.userData.cloudWrapMin, object.userData.cloudWrapMax - object.position.x)
          material.opacity = object.userData.cloudOpacity * THREE.MathUtils.smoothstep(edge, 0, 14)
        }
        if (object.userData.tree) object.rotation.z = Math.sin(elapsed * .7 + object.userData.phase) * .012
        if (object.userData.fountainSpray && object instanceof THREE.Mesh) (object.material as THREE.MeshBasicMaterial).opacity = .35 + Math.sin(elapsed * 2.2 + object.userData.phase) * .11
        if (object.userData.crane) object.rotation.y = Math.sin(elapsed * .08 + object.position.x) * .06
        if (object.userData.lighthouse) object.rotation.y += delta * .22
        if (object.userData.lighthouseBeam && object instanceof THREE.Mesh) (object.material as THREE.MeshBasicMaterial).opacity = .055 + Math.sin(elapsed * .8) * .018
        if (object.userData.turbine) object.rotation.z += delta * object.userData.speed
        if (object.userData.orbitalRing) object.rotation.z += delta * .08
        if (object.userData.radarDish) {
          object.rotation.y += delta * .16
          object.rotation.z = Math.sin(elapsed * .19 + object.position.x) * .08
        }
        if (object.userData.planet) object.rotation.y += delta * .006
        if (object.userData.signal) object.rotation.y += delta * .08
        if (object.userData.atmosphere) {
          object.rotation.y += delta * .008
          object.position.x = Math.sin(elapsed * .035) * .4
        }
        if (object.userData.waterUniforms) object.userData.waterUniforms.uTime.value = elapsed
        if (object.userData.skyUniforms) object.userData.skyUniforms.uTime.value = elapsed
        if (object.userData.auroraUniforms) object.userData.auroraUniforms.uTime.value = elapsed
        if (object.userData.flagUniforms) object.userData.flagUniforms.uTime.value = elapsed
        if (object.userData.mapLabelKind) object.visible = Boolean(object.userData.mapLabelAlways) || object.userData.mapLabelKey === selectedRef.current || (object.userData.mapLabelKind === 'career' && object.userData.mapLabelKey === activeTier?.key) || (object.userData.mapLabelKind !== 'career' && object.userData.mapLabelKind === modeRef.current)
        if (object.userData.mapObjectKind) object.visible = object.userData.mapObjectKind === modeRef.current
        if (object.userData.mapEmphasisKind) {
          object.visible = object.userData.mapEmphasisKind === modeRef.current || object.userData.mapLabelKey === selectedRef.current
          const pulse = 1 + Math.sin(elapsed * 2.1 + object.position.x) * .08
          object.scale.setScalar(pulse)
          if (object instanceof THREE.Mesh) (object.material as THREE.MeshBasicMaterial).opacity = .55 + Math.sin(elapsed * 2.1 + object.position.z) * .2
        }
        if (object.userData.lawyerBeacon && object instanceof THREE.Mesh) {
          object.rotation.z += delta * .45
          ;(object.material as THREE.MeshBasicMaterial).opacity = .62 + Math.sin(elapsed * 2) * .2
        }
        if (object.userData.playerMarker) {
          object.position.y = Number(object.userData.playerMarkerBaseY ?? 2.02) + Math.sin(elapsed * 2.3) * .06
          object.rotation.y += delta * 1.2
        }
        if (object.userData.destinationMarker) {
          const hover = object.userData.destinationHover ? 1 : 0
          const available = object.userData.destinationAvailable ? 1 : 0
          const pulse = Math.sin(elapsed * 2.35 + object.userData.destinationPhase) * .035
          object.position.y = object.userData.destinationBaseY + (available ? pulse : 0)
          object.scale.setScalar(1 + pulse * .32 + hover * .14)
          object.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) child.material.opacity = available ? .72 + hover * .24 + pulse * 1.3 : .22
          })
        }
        if (object.userData.buoy) {
          object.position.y = -.02 + Math.sin(elapsed * 1.35 + object.userData.phase) * .055
          object.rotation.z = Math.sin(elapsed * .72 + object.userData.phase) * .035
        }
        if (object.userData.marshBlade) object.rotation.z = Math.sin(elapsed * .72 + object.userData.phase) * .07
        if (object.userData.ambientActor) {
          const origin = object.userData.ambientOrigin as THREE.Vector3
          const phase = Number(object.userData.phase)
          const speed = Number(object.userData.speed)
          const grounded = object.userData.ambientActor === 'groundBird'
          object.position.x = origin.x + Math.sin(elapsed * speed + phase) * (grounded ? .34 : object.userData.ambientActor === 'drone' ? 1.1 : 2.4)
          object.position.z = origin.z + Math.cos(elapsed * speed * .78 + phase) * (grounded ? .26 : object.userData.ambientActor === 'drone' ? .8 : 1.65)
          object.position.y = origin.y + (grounded ? Math.abs(Math.sin(elapsed * speed * 3.6 + phase)) * .035 : Math.sin(elapsed * speed * 2.1 + phase) * (object.userData.ambientActor === 'drone' ? .22 : .46))
          object.rotation.y = Math.atan2(Math.cos(elapsed * speed + phase), Math.sin(elapsed * speed * .78 + phase))
          object.children.forEach((child) => {
            if (child.userData.ambientWing) child.rotation.z = Number(child.userData.ambientWing) * (.18 + Math.sin(elapsed * 7.2 + phase) * .48)
          })
          if (object.userData.ambientActor === 'drone') object.rotation.z = Math.sin(elapsed * 1.2 + phase) * .06
        }
      })
      if (landmarkRing.visible) {
        landmarkRing.scale.setScalar((hoveredLandmark?.radius ?? 1) * (1 + Math.sin(elapsed * 3.1) * .035))
        ;(landmarkRing.material as THREE.MeshBasicMaterial).opacity = .5 + Math.sin(elapsed * 3.1) * .18
      }
      if (landmarkWash.visible) {
        // The same cadence as the ring it sits under, at a fraction of the
        // swing: a whole district's worth of area breathing as hard as a
        // hairline outline would be a strobe rather than a highlight.
        ;(landmarkWash.material as THREE.MeshBasicMaterial).opacity = (hoveredLandmark ? .15 : .09) + Math.sin(elapsed * 3.1) * .03
      }
      const selectedAnchor = anchors.get(selectedRef.current)
      selectionRing.visible = Boolean(selectedAnchor)
      if (selectedAnchor) {
        selectionRing.position.x = selectedAnchor.x
        selectionRing.position.z = selectedAnchor.z
        selectionRing.scale.setScalar(1 + Math.sin(elapsed * 2.2) * .07)
        ;(selectionRing.material as THREE.MeshBasicMaterial).opacity = .58 + Math.sin(elapsed * 2.2) * .18
      }
      stylePass.render(scene, camera)
      if (!disposed && surfaceVisible && !document.hidden) animationFrame = requestAnimationFrame(animate)
    }
    const surfaceObserver = new IntersectionObserver(([entry]) => {
      surfaceVisible = Boolean(entry?.isIntersecting)
      if (!surfaceVisible && animationFrame) {
        cancelAnimationFrame(animationFrame)
        animationFrame = 0
      } else if (ready && surfaceVisible && !document.hidden && !animationFrame) {
        previousFrame = performance.now()
        animationFrame = requestAnimationFrame(animate)
      }
    }, { rootMargin: '80px' })
    surfaceObserver.observe(host)
    const onVisibilityChange = () => {
      if (document.hidden && animationFrame) {
        cancelAnimationFrame(animationFrame)
        animationFrame = 0
      } else if (ready && !document.hidden && surfaceVisible && !animationFrame) {
        previousFrame = performance.now()
        animationFrame = requestAnimationFrame(animate)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Compiling this many distinct materials inside the first `render()` makes
    // the driver link each program in turn while the main thread waits, which
    // is the bulk of the delay before the district appears. `compileAsync`
    // links them in parallel instead, so the first frame only has to draw.
    void renderer.compileAsync(scene, camera).then(() => {
      if (disposed) return
      // Full-scene pass first: it captures the static world shadow map while
      // every caster is still visible. Culling may only run afterwards.
      stylePass.render(scene, camera)
      renderer.shadowMap.needsUpdate = false
      updatePerformanceCulling()
      ready = true
      // Introspection only: lets performance/QA tooling read the live scene
      // graph and renderer stats from outside without affecting rendering.
      const firstRenderAt = performance.now()
      ;(window as unknown as { __mapScene?: unknown; __mapThree?: unknown }).__mapThree = THREE
      ;(window as unknown as { __mapScene?: unknown }).__mapScene = {
        region, scene, world, camera, renderer, lawyer, transports, landmarks, buildStartedAt, firstRenderAt,
        firstFrameMs: firstRenderAt - buildStartedAt,
        roadGraph, trafficSims, crowd, crowdRenderer, rivalGuardRenderer, vehicleHulls,
        // The counsel's rig and its own feet, so "does the walk skate" can be
        // measured — foot travel against body travel — instead of judged from a
        // screenshot. `walkTo` drives a journey on demand, because the walk is
        // otherwise only triggered by a player selecting a headquarters.
        counsel, counselRig: lawyerModel.rig,
        walkTo: (x: number, z: number, milliseconds?: number) => {
          const target = new THREE.Vector3(x, .12, z)
          const curve = walkingCurve(lawyer.position.clone(), target)
          walking = {
            curve,
            delayMs: 0,
            duration: milliseconds ?? walkDuration(curve.getLength()),
            elapsedMs: 0,
            lastProgress: 0,
          }
          return { length: curve.getLength(), duration: walking.duration }
        },
      }
      if (!surfaceVisible || document.hidden) return
      previousFrame = performance.now()
      animationFrame = requestAnimationFrame(animate)
    })

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      // The mixer caches its bindings against the rig root, so the actor has
      // to be released explicitly or a remounted map rebinds onto stale ones.
      counsel.dispose()
      const globalScope = window as unknown as { __mapScene?: { scene: THREE.Scene } }
      if (globalScope.__mapScene?.scene === scene) globalScope.__mapScene = undefined
      fadedOccluders.forEach((root) => setOccluderFade(root, false))
      // Restored above, so no mesh still references a twin by this point.
      fadedTwins.forEach((twin) => twin.dispose())
      fadedTwins.clear()
      resizeObserver.disconnect()
      surfaceObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      renderer.domElement.removeEventListener('keydown', onKeyDown)
      landmarkHoverRef.current?.(null, null)
      disposeScene(scene)
      stylePass.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement)
    }
  }, [activity, ownedLandmarks, playerGender, playerName, playerTier, points, region])

  const style = { '--arc-accent': `#${ARC[region].accent.toString(16).padStart(6, '0')}` } as CSSProperties
  return (
    <div className={`uw-three-scene uw-three-scene-${region}`} ref={hostRef} style={style}>
      <div className="uw-three-loading" aria-hidden="true"><i /><span>Building {ARC[region].title}</span></div>
    </div>
  )
}
