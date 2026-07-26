import { useEffect, useRef, type CSSProperties } from 'react'
import * as THREE from 'three'

import type { CharacterGender, FirmTier, GameAsset } from '../types'
import { buildStylizedCounsel, type StylizedCounselRig } from './stylized-counsel'

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

type CameraCommand = { id: number; action: 'in' | 'out' | 'home' | 'focus' }
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
    route: [[-14, 1.2], [-11, .55], [-8, .9], [-5, .25], [-2, -.2], [2, .28], [5, -.2], [8, .4], [11, -.3], [14, .1]],
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
    route: [[-15, 2], [-10, 1.6], [-5, -1.2], [0, .4], [5, 1.1], [10, -1.4], [15, -.3]],
    rail: [[-16, 7.7], [-9, 6.7], [-2, 7.4], [5, 6.6], [16, 7.4]],
    fov: 31, exposure: 1.31, fogDensity: .0068,
    camera: [24, 30, 38], target: [0, .55, 0],
    sun: { color: 0xffe7bd, intensity: 4.35, position: [-20, 36, 22] },
    ambient: { sky: 0xa9c4c5, ground: 0x2b382d, intensity: .51 },
    fill: { color: 0x90b2bd, intensity: .48, position: [22, 12, -16] },
    rim: { color: 0xe8c98c, intensity: .54, position: [5, 14, -24] },
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
    skyTop: 0x4f6e8a, skyBottom: 0xc19588, fog: 0x858e8d, ground: 0x56645b,
    stone: 0x7d776d, accent: 0x805a43, road: 0x252d30,
    route: [[-15, 2.1], [-11, .5], [-7, -1.4], [-2, -.2], [3, 1], [8, -.8], [14, .2]],
    rail: [[-16, 7.7], [-9, 7], [-1, 7.7], [7, 6.8], [16, 7.3]],
    fov: 31, exposure: 1.27, fogDensity: .0064,
    camera: [24, 29, 39], target: [0, .75, -.3],
    sun: { color: 0xffa878, intensity: 4.72, position: [-24, 30, 15] },
    ambient: { sky: 0x6f91a6, ground: 0x18282a, intensity: .38 },
    fill: { color: 0x62c6c2, intensity: .96, position: [22, 12, -18] },
    rim: { color: 0xffc38a, intensity: .84, position: [5, 15, -27] },
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

function material(color: number, roughness = .78, metalness = .02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
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

function careerPromenade(curve: THREE.Curve<THREE.Vector3>, definition: ArcDefinition) {
  const group = new THREE.Group()
  const foundation = mesh(ribbonGeometry(curve, 1.58), material(0x77766c, .98))
  foundation.position.y = .018
  const walk = mesh(ribbonGeometry(curve, 1.18), material(definition.road, .86, .03))
  walk.position.y = .062
  const inlay = mesh(ribbonGeometry(curve, .16), new THREE.MeshStandardMaterial({ color: definition.accent, emissive: definition.accent, emissiveIntensity: .18, roughness: .52, metalness: .18 }))
  inlay.position.y = .105
  group.add(foundation, walk, inlay)
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

/**
 * Each arc carries progression through infrastructure that belongs to that place:
 * a civic walk, an appellate road, shipping beacons, a formal boulevard, or an
 * orbital transfer corridor. The route is therefore part of the environment,
 * rather than a generic game ribbon laid over it.
 */
function createNativeCareerRoute(region: MapRegionKey, curve: THREE.Curve<THREE.Vector3>, definition: ArcDefinition) {
  const group = new THREE.Group()
  group.userData.careerInfrastructure = true
  if (region === 'city') {
    const bed = mesh(ribbonGeometry(curve, 1.72, 180), material(0x777267, .98))
    const paving = mesh(ribbonGeometry(curve, 1.34, 180), material(0xaaa18e, .96))
    const brass = mesh(ribbonGeometry(curve, .075, 180), material(0xb79652, .42, .34))
    bed.position.y = .018; paving.position.y = .07; brass.position.y = .105
    group.add(bed, paving, brass)
    addCurveDashes(group, curve, 0x726b5e, 34, 1.28, .035, .115)
  } else if (region === 'nation') {
    const verge = mesh(ribbonGeometry(curve, 1.92, 180), material(0x6d6b5e, .98))
    const road = mesh(ribbonGeometry(curve, 1.48, 180), material(0x3b403e, .92))
    const center = mesh(ribbonGeometry(curve, .065, 180), material(0xd3bd78, .48, .2))
    verge.position.y = .018; road.position.y = .065; center.position.y = .105
    group.add(verge, road, center)
    addCurveDashes(group, curve, 0xe0cf98, 18, .055, .52, .118)
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

function levelMedallion(point: MapSceneTier) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const color = point.state === 'current' ? '#f1ce77' : point.state === 'complete' ? '#76b7a5' : point.state === 'next' ? '#d6ba76' : '#6f7774'
  context.clearRect(0, 0, 256, 256)
  context.beginPath(); context.arc(128, 128, 111, 0, Math.PI * 2)
  context.fillStyle = 'rgba(12,25,29,.96)'; context.fill()
  context.lineWidth = 13; context.strokeStyle = color; context.stroke()
  context.beginPath(); context.arc(128, 128, 88, 0, Math.PI * 2)
  context.lineWidth = 3; context.strokeStyle = 'rgba(244,235,208,.42)'; context.stroke()
  context.fillStyle = color
  context.font = '700 42px Georgia, serif'
  context.textAlign = 'center'
  context.fillText('LEVEL', 128, 104)
  context.fillStyle = '#f4eedf'
  context.font = '700 92px Georgia, serif'
  context.fillText(String(point.data.tier + 1), 128, 185)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const medallion = mesh(
    new THREE.CircleGeometry(.53, 48),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  )
  medallion.rotation.x = -Math.PI / 2
  medallion.renderOrder = 18
  medallion.userData.disposableTexture = texture
  setSelectable(medallion, { key: point.key, kind: 'tier', locked: point.state === 'locked' })
  return medallion
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
  return sprite
}

function setSelectable(root: THREE.Object3D, data: { key: string; kind: MapSceneKind; locked: boolean }) {
  root.userData.mapSelection = data
  root.traverse((child) => { child.userData.mapSelectionRoot = root })
}

function windowBand(width: number, count: number, y: number, depth: number, lit: boolean) {
  const group = new THREE.Group()
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: lit ? 0xb8c7bd : 0x314349,
    emissive: lit ? 0x554c32 : 0x10181b,
    emissiveIntensity: lit ? .32 : .12,
    roughness: .32,
    metalness: .24,
  })
  const span = width / count
  for (let i = 0; i < count; i += 1) {
    group.add(box([span * .48, .34, .04], windowMaterial, [-width / 2 + span * (i + .5), y, depth]))
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

function createRivalBuilding(point: MapSceneRival, index: number, definition: ArcDefinition) {
  const group = new THREE.Group()
  const width = 2.25 + (index % 2) * .45
  const height = 2.5 + (index % 3) * .65
  const facade = material(point.data.owned ? 0x547a6d : 0x6d5d56, .72)
  const trim = material(definition.stone, .85)
  group.add(box([width + .5, .18, 2.15], material(0x625f55, .95), [0, .1, 0]))
  group.add(box([width, height, 1.6], facade, [0, .24 + height / 2, 0]))
  for (let floor = 0; floor < Math.floor(height / .65); floor += 1) group.add(windowBand(width - .3, 3, .65 + floor * .62, .82, point.data.owned))
  group.add(box([width + .12, .12, 1.78], trim, [0, height + .29, 0]))
  group.add(box([.54, .84, .08], material(0x242b2c, .7), [0, .72, .82]))
  const ownershipPlaque = box([.82, .26, .06], material(point.data.owned ? 0x6cae98 : 0x9a6659, .42, .2), [0, 1.36, .86])
  group.add(ownershipPlaque)
  const rivalLabel = labelSprite([point.data.owned ? 'YOUR NETWORK' : 'RIVAL DOSSIER', point.data.name.replace('Acquire ', ''), point.data.owned ? 'ACQUIRED OFFICE' : 'SELECT FOR INTELLIGENCE'], 4.2, point.data.owned ? '#82c3ad' : '#c6907f')
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

function createTree(scale = 1, color = 0x526b50) {
  const group = new THREE.Group()
  group.userData.footprintRadius = .46 * scale
  const trunk = material(0x554737, .98)
  group.add(cylinder(.095 * scale, 1.3 * scale, trunk, [0, .65 * scale, 0], 12))
  const baseColor = new THREE.Color(color)
  const crownGeometry = new THREE.SphereGeometry(1, 14, 10)
  const clusters: Array<[number, number, number, number]> = [[0, 1.52, 0, .56], [-.36, 1.42, .02, .42], [.34, 1.44, -.04, .44], [-.12, 1.78, -.08, .43], [.17, 1.7, .2, .4]]
  clusters.forEach(([x, y, z, radius], index) => {
    const tone = baseColor.clone().offsetHSL(0, index % 2 ? -.02 : .015, (index - 2) * .018)
    const crown = mesh(crownGeometry, material(tone.getHex(), .97), [x * scale, y * scale, z * scale])
    crown.scale.set(radius * scale, radius * scale * (.82 + index * .025), radius * scale * .78)
    group.add(crown)
  })
  group.userData.tree = true
  group.userData.phase = hashUnit(scale * 991 + color * .0001) * Math.PI * 2
  return group
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

function createBlockBuilding(width: number, height: number, depth: number, color: number, modern = false) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = Math.max(width, depth) * .54
  group.userData.performanceCullRadius = Math.hypot(width, height, depth) * .62
  const facade = material(color, modern ? .46 : .88, modern ? .16 : .02)
  const trim = material(modern ? 0x9fa7a3 : 0xa99c82, .84)
  group.add(box([width, height, depth], facade, [0, height / 2, 0]))
  const columns = Math.max(2, Math.floor(width / .65))
  const floors = Math.max(2, Math.floor(height / .68))
  for (let floor = 0; floor < floors; floor += 1) {
    const band = windowBand(width - .28, columns, .48 + floor * (height / floors), depth / 2 + .015, (floor + columns) % 3 === 0)
    group.add(band)
  }
  group.add(box([width + .12, .12, depth + .12], trim, [0, height + .06, 0]))
  const doorway = box([Math.min(.52, width * .28), Math.min(.82, height * .38), .055], material(0x263235, .58, modern ? .24 : .08), [0, Math.min(.42, height * .19), depth / 2 + .04])
  group.add(doorway)
  if (modern) {
    const roofPlant = box([Math.min(1.05, width * .42), .34, Math.min(.8, depth * .4)], material(0x485355, .42, .34), [width * .16, height + .29, 0])
    group.add(roofPlant)
    const canopy = box([Math.min(1.3, width * .62), .08, .48], material(0x778284, .38, .38), [0, .72, depth / 2 + .24])
    group.add(canopy)
  } else {
    const cornice = box([width + .24, .16, depth + .2], trim, [0, height + .15, 0])
    group.add(cornice)
    if (width > 1.55) {
      const chimney = box([.24, .62, .28], material(0x554a40, .94), [-width * .28, height + .46, -depth * .17])
      group.add(chimney)
    }
    const awning = box([Math.min(1.05, width * .54), .08, .42], material(new THREE.Color(color).offsetHSL(0, -.05, -.12).getHex(), .8), [0, .82, depth / 2 + .2])
    awning.rotation.x = -.12
    group.add(awning)
  }
  return group
}

/**
 * The rear Old Quarter is deliberately instanced. A detailed building made by
 * createBlockBuilding can contain dozens of individual meshes; repeating that
 * on the horizon used to add hundreds of draw calls before the playable block
 * was even considered. This skyline keeps the same masonry rhythm, roofline,
 * and lit windows in three draw calls, while the near buildings retain detail.
 */
function createOldQuarterRearSkyline() {
  const group = new THREE.Group()
  const records: Array<{ x: number; z: number; width: number; height: number; depth: number; color: number; lit: boolean }> = []
  const palette = [0x514a44, 0x5d5349, 0x4c5554, 0x675749, 0x56524d]
  const rows = [-13.4, -17.8, -22.2, -26.6]
  rows.forEach((z, row) => {
    for (let column = 0; column < 23; column += 1) {
      const seed = 1100 + row * 101 + column * 17
      const width = 2.38 + hashUnit(seed) * .52
      const depth = 2.05 + hashUnit(seed + 9) * .58
      const height = 2.8 + hashUnit(seed + 19) * 3.35 + row * .18
      records.push({
        x: -35.2 + column * 3.2 + (hashUnit(seed + 27) - .5) * .34,
        z: z + (hashUnit(seed + 31) - .5) * .28,
        width,
        height,
        depth,
        color: palette[(row * 3 + column) % palette.length],
        lit: (row + column) % 4 === 0,
      })
    }
  })

  const dummy = new THREE.Object3D()
  const facadeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .92, metalness: .015, vertexColors: true })
  const facades = new THREE.InstancedMesh(sharedGeometry.box, facadeMaterial, records.length)
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x887c69, roughness: .9, metalness: .02, vertexColors: true })
  const roofs = new THREE.InstancedMesh(sharedGeometry.box, roofMaterial, records.length)
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x53482f,
    emissiveIntensity: .32,
    roughness: .42,
    metalness: .12,
    vertexColors: true,
  })
  const windowsPerBuilding = 6
  const windows = new THREE.InstancedMesh(sharedGeometry.box, windowMaterial, records.length * windowsPerBuilding)
  const windowColor = new THREE.Color()
  let windowIndex = 0

  records.forEach((record, index) => {
    dummy.position.set(record.x, record.height / 2 - .08, record.z)
    dummy.scale.set(record.width, record.height, record.depth)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    facades.setMatrixAt(index, dummy.matrix)
    facades.setColorAt(index, new THREE.Color(record.color))

    dummy.position.set(record.x, record.height - .025, record.z)
    dummy.scale.set(record.width + .16, .13, record.depth + .14)
    dummy.updateMatrix()
    roofs.setMatrixAt(index, dummy.matrix)
    roofs.setColorAt(index, new THREE.Color(record.color).offsetHSL(0, -.04, .09))

    for (let floor = 0; floor < 2; floor += 1) for (let column = 0; column < 3; column += 1) {
      dummy.position.set(
        record.x + (column - 1) * record.width * .245,
        record.height * (.38 + floor * .29),
        record.z + record.depth / 2 + .02,
      )
      dummy.scale.set(record.width * .135, .2, .035)
      dummy.updateMatrix()
      windows.setMatrixAt(windowIndex, dummy.matrix)
      windowColor.setHex(record.lit && (floor + column) % 2 === 0 ? 0xc8b981 : 0x304143)
      windows.setColorAt(windowIndex, windowColor)
      windowIndex += 1
    }
  })

  for (const item of [facades, roofs, windows]) {
    item.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    item.castShadow = false
    item.receiveShadow = true
    item.frustumCulled = true
    item.computeBoundingSphere()
  }
  if (facades.instanceColor) facades.instanceColor.needsUpdate = true
  if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true
  if (windows.instanceColor) windows.instanceColor.needsUpdate = true
  group.add(facades, roofs, windows)
  group.userData.performanceCullRadius = 53
  return group
}

/**
 * A complete Old Quarter block rather than a single decorative building.
 * Parcels share a stone apron, close-set masonry frontage, a service court,
 * and rooftop infrastructure so the city continues naturally at every zoom.
 */
function createOldQuarterParcel(seed: number, scale = 1, foreground = false) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = 2.25 * scale
  const facades = [0x62584f, 0x716052, 0x59615e, 0x786958, 0x5d5751]
  const apron = box([4.15 * scale, .075, 3.15 * scale], material(seed % 2 ? 0x858073 : 0x7b786f, .98), [0, .025, 0])
  group.add(apron)

  const buildingCount = seed % 3 === 0 ? 3 : 2
  for (let index = 0; index < buildingCount; index += 1) {
    const width = (buildingCount === 3 ? 1.08 : 1.55) * scale
    const depth = (1.75 + hashUnit(seed * 29 + index * 7) * .42) * scale
    const baseHeight = foreground ? 1.18 : 1.72
    const height = (baseHeight + hashUnit(seed * 41 + index * 17) * (foreground ? 1.22 : 2.05)) * scale
    const spacing = buildingCount === 3 ? 1.28 : 1.82
    const frontage = createBlockBuilding(width, height, depth, facades[(seed + index) % facades.length], seed % 7 === 0 && index === buildingCount - 1)
    frontage.position.set((index - (buildingCount - 1) / 2) * spacing * scale, .055, -.34 * scale)
    frontage.rotation.y = (hashUnit(seed * 13 + index) - .5) * .018
    group.add(frontage)
  }

  const yard = box([3.35 * scale, .035, .62 * scale], material(0x4b504b, .98), [0, .068, 1.05 * scale])
  group.add(yard)
  for (const side of [-1, 1]) {
    const tree = createTree((.34 + hashUnit(seed * 11 + side * 3) * .11) * scale, side < 0 ? 0x4e6250 : 0x59684f)
    tree.position.set(side * 1.55 * scale, .07, 1.02 * scale)
    group.add(tree)
  }
  if (seed % 2 === 0) {
    const shed = createServiceShed(.34 * scale, seed % 4 ? 0x62574d : 0x58615e)
    shed.position.set(.58 * scale, .07, 1.03 * scale)
    shed.rotation.y = Math.PI
    group.add(shed)
  } else {
    const bench = createBench(.38 * scale)
    bench.position.set(.45 * scale, .07, 1.12 * scale)
    bench.rotation.y = Math.PI
    group.add(bench)
  }
  return group
}

function createCourthouse(scale = 1, color = 0x938771) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = 2.7 * scale
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

function createFortress(scale = 1) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = 3.25 * scale
  const stone = material(0x746c60, .94)
  const roof = material(0x4f4037, .9)
  group.add(box([5.8 * scale, .72 * scale, 4.4 * scale], stone, [0, .36 * scale, 0]))
  group.add(box([4.65 * scale, 2.25 * scale, 3.25 * scale], stone, [0, 1.75 * scale, 0]))
  for (const x of [-2.45, 2.45]) for (const z of [-1.72, 1.72]) {
    group.add(cylinder(.58 * scale, 3.2 * scale, stone, [x * scale, 1.6 * scale, z * scale], 16))
    const cap = mesh(new THREE.ConeGeometry(.78 * scale, 1.1 * scale, 16), roof, [x * scale, 3.7 * scale, z * scale])
    group.add(cap)
  }
  const keep = box([1.55 * scale, 3.7 * scale, 1.5 * scale], stone, [0, 2.45 * scale, 0])
  group.add(keep)
  group.add(box([.62 * scale, 1.05 * scale, .08], material(0x282a29, .7), [0, .72 * scale, 2.25 * scale]))
  return group
}

function createLighthouse(scale = 1) {
  const group = new THREE.Group()
  group.userData.playerOccluder = true
  group.userData.footprintRadius = .68 * scale
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

function addCityEnvironment(root: THREE.Group, definition: ArcDefinition) {
  const blockMaterial = [0x72685c, 0x7d7162, 0x666b67, 0x806f5d]
  const coordinates: XZ[] = []
  for (const z of [-8.2, -5.7, 5.4]) for (const x of [-13, -9, -5, -.5, 4, 8.5, 13]) coordinates.push([x, z])
  coordinates.forEach(([x, z], index) => {
    if ((index === 9) || (index === 12) || (z > 5 && x < -3.5) || (z > 5 && Math.abs(x) < 3)) return
    const modern = x > 2.5 && z < 0
    const foreground = z > 4
    const building = createBlockBuilding(2.4 + (index % 3) * .35, foreground ? 1.35 + (index % 3) * .26 : modern ? 3.1 + (index % 4) * .72 : 2.1 + (index % 3) * .42, 2.1, modern ? [0x606d70, 0x667477, 0x6f716d][index % 3] : blockMaterial[index % blockMaterial.length], modern)
    building.position.set(x, .02, z)
    building.rotation.y = index % 2 ? .03 : -.025
    root.add(building)
  })
  const court = createCourthouse(.86, definition.stone)
  court.position.set(2.2, .02, -7.1)
  root.add(court)
  // A retained municipal canal follows the western edge of the quarter. The
  // previous river cut diagonally through parcels and read as an unrelated
  // blue strip; stone quays and aligned bridges now make it civic fabric.
  const canalCurve = curveFrom([[-17.1, -16], [-16.75, -8], [-16.4, 0], [-15.9, 8], [-15.5, 16]], .055)
  root.add(waterRibbon(canalCurve, 1.18, 0x416f73))
  root.userData.waterTransportCurve = canalCurve
  const westQuay = curveFrom([[-18.55, -16], [-18.2, -8], [-17.85, 0], [-17.35, 8], [-16.95, 16]], .075)
  const eastQuay = curveFrom([[-15.65, -16], [-15.3, -8], [-14.95, 0], [-14.45, 8], [-14.05, 16]], .075)
  const quayMaterial = material(0x817c70, .98)
  const westBank = mesh(ribbonGeometry(westQuay, .38, 90), quayMaterial); westBank.position.y = .055
  const eastBank = mesh(ribbonGeometry(eastQuay, .46, 90), quayMaterial); eastBank.position.y = .055
  root.add(westBank, eastBank)
  for (const [x, z] of [[-16.55, -4.1], [-16.15, 3.4], [-15.8, 9.1]] as XZ[]) {
    const bridge = box([4.15, .24, 1.22], material(0x77736a, .95), [x, .22, z])
    bridge.rotation.y = -.045
    root.add(bridge)
    for (const side of [-1, 1]) {
      const lamp = createLamp(); lamp.position.set(x + side * 1.55, .18, z + side * .42); root.add(lamp)
    }
  }
  for (const x of [-14.5, -12.8, -6.2, 6.5, 11.5, 14.5]) {
    const tree = createTree(.72, 0x52654d)
    tree.position.set(x, 0, 4.15 + (x % 2) * .2)
    root.add(tree)
  }
  const marketPlaza = box([7.2, .08, 3.7], material(0x888274, .98), [-9.35, .035, 6.25])
  root.add(marketPlaza)
  for (let index = 0; index < 8; index += 1) {
    const stall = createMarketStall(index)
    const column = index % 4
    const row = Math.floor(index / 4)
    stall.position.set(-11.7 + column * 1.58, .09, 5.55 + row * 1.45)
    stall.rotation.y = row ? Math.PI : 0
    root.add(stall)
  }
  for (const x of [-12.4, -10.55, -8.7, -6.85]) {
    const lamp = createLamp(); lamp.position.set(x, .08, 4.45); root.add(lamp)
  }
  const fountain = createFountain()
  fountain.position.set(3.8, .03, 4.9)
  root.add(fountain)

  /* A legible street grid ties the career road to actual blocks rather than floating landmarks. */
  for (const x of [-12, -6.2, 5.8, 11.8]) {
    const street = new THREE.LineCurve3(new THREE.Vector3(x, .045, -12), new THREE.Vector3(x, .045, 11.5))
    root.add(roadMesh(street, .72, 0x343b3c))
  }
  const eastbound = curveFrom([[-18, -3.55], [-12, -3.5], [-6, -3.62], [0, -3.48], [6, -3.6], [12, -3.5], [18, -3.55]], .075)
  const westbound = curveFrom([[18, -4.22], [12, -4.17], [6, -4.28], [0, -4.14], [-6, -4.3], [-12, -4.18], [-18, -4.22]], .075)
  const trafficBed = curveFrom([[-18, -3.88], [-12, -3.84], [-6, -3.96], [0, -3.8], [6, -3.95], [12, -3.84], [18, -3.88]], .075)
  root.add(roadMesh(trafficBed, 1.18, 0x343b3c))
  addCurveDashes(root, trafficBed, 0xc5b77f, 28, .045, .32, .12)
  ;(root.userData.trafficCurves ??= []).push(eastbound, westbound)
  const frontage = [-14.4, -11.2, -8, -4.8, -1.6, 1.6, 4.8, 8, 11.2, 14.4]
  frontage.forEach((x, index) => {
    const rowhouse = createBlockBuilding(2.45, 2.15 + (index % 4) * .36, 2.1, [0x655a50, 0x766454, 0x5c6260, 0x735e50][index % 4], false)
    rowhouse.position.set(x, -.02, 10.25)
    rowhouse.rotation.y = Math.PI
    root.add(rowhouse)
    if (index % 2 === 0) {
      const lamp = createLamp(); lamp.position.set(x + 1.15, 0, 8.75); root.add(lamp)
    }
  })
  for (const [x, z, rotation] of [[-10.7, 3.9, .05], [-4.2, 4.1, -.08], [6.4, 4.2, Math.PI], [10.8, 3.8, Math.PI]] as Array<[number, number, number]>) {
    const bench = createBench(.82); bench.position.set(x, .02, z); bench.rotation.y = rotation; root.add(bench)
  }

  // Complete the starting ward on both banks of the municipal canal. The
  // waterfront uses a continuous warehouse frontage while the playable east
  // bank gets smaller mixed-use parcels framing (rather than covering) the
  // market and first career destinations.
  ;[-10.8, -7.2, -3.6, 0, 3.6, 7.2, 10.8].forEach((z, index) => {
    const warehouse = createBlockBuilding(2.3, 1.5 + (index % 3) * .34, 2.05, [0x5b554e, 0x66615a, 0x545d5b][index % 3], false)
    warehouse.position.set(-19.15, -.04, z)
    warehouse.rotation.y = Math.PI / 2
    root.add(warehouse)
    if (index % 2 === 0) {
      const quayLamp = createLamp(); quayLamp.position.set(-17.75, .02, z + .7); quayLamp.scale.setScalar(.78); root.add(quayLamp)
    }
  })
  ;[[-13.2, 4.25], [-6.55, 4.45], [-3.2, 4.35]].forEach(([x, z], index) => {
    const parcel = createOldQuarterParcel(540 + index * 17, .64, true)
    parcel.position.set(x, -.02, z)
    parcel.rotation.y = Math.PI
    root.add(parcel)
  })
  for (const x of [-14.2, -12.6, -8.2, -6.8, -4.2, -2.8]) {
    const tree = createTree(.43 + hashUnit(x * 17) * .07, 0x50634e)
    tree.position.set(x, 0, 2.95 + (Math.abs(Math.round(x * 10)) % 2) * .22)
    root.add(tree)
  }
}

function addNationEnvironment(root: THREE.Group, definition: ArcDefinition) {
  const fieldColors = [0x7b8061, 0x858267, 0x68765d, 0x8b8060]
  let index = 0
  for (const z of [-8.2, -5.4, 4.5]) {
    for (const x of [-13, -8.6, -4.2, .2, 4.6, 9, 13.4]) {
      const field = box([3.8, .06, 2.15], material(fieldColors[index % fieldColors.length], 1), [x, .02, z])
      field.rotation.y = ((index % 3) - 1) * .025
      root.add(field)
      const hedgeColor = index % 2 ? 0x495a43 : 0x536047
      root.add(box([3.9, .12, .085], material(hedgeColor, 1), [x, .08, z - 1.08]))
      root.add(box([3.9, .12, .085], material(hedgeColor, 1), [x, .08, z + 1.08]))
      root.add(box([.085, .12, 2.15], material(hedgeColor, 1), [x - 1.92, .08, z]))
      root.add(box([.085, .12, 2.15], material(hedgeColor, 1), [x + 1.92, .08, z]))
      if (index % 2 === 0) {
        for (let row = -1; row <= 1; row += 1) {
          const furrow = box([3.25, .025, .025], material(0xaaa17c, 1), [x, .065, z + row * .5])
          furrow.rotation.y = field.rotation.y
          root.add(furrow)
        }
      }
      index += 1
    }
  }
  for (const x of [-10, 0, 10]) {
    const court = createCourthouse(.66, definition.stone)
    court.position.set(x, .03, -6.2)
    root.add(court)
  }
  const river = curveFrom([[-16, -9], [-10, -4.5], [-5, -6.8], [0, -2.8], [6, -5], [11, -1.8], [16, -4]], .05)
  root.add(waterRibbon(river, .72, 0x4a7e82))
  for (const [x, z, scale] of [[-15, -10, 1.6], [-11, -11, 1.3], [-6, -10.6, 1.45], [7, -10.5, 1.4], [12, -11, 1.65], [16, -9.5, 1.35]] as Array<[number, number, number]>) {
    const mountain = createMountain(scale, 0x6e6758, scale > 1.45)
    mountain.position.set(x, 0, z)
    root.add(mountain)
  }
  for (let x = -15; x <= 15; x += 2.2) {
    const tree = createTree(.65 + ((x + 15) % 3) * .06, 0x58694d)
    tree.position.set(x, 0, 3.9)
    root.add(tree)
  }
  const capital = createFortress(.78)
  capital.position.set(0, .05, -7.9)
  root.add(capital)
  const circuitTraffic = (root.userData.trafficCurves ??= []) as Array<THREE.Curve<THREE.Vector3>>
  ;[[0, -6.5, -12.5, 2.7], [0, -6.2, 12.8, -4.8], [0, -6.4, -11.8, -4.5]].forEach(([x1, z1, x2, z2]) => {
    const branch = new THREE.LineCurve3(new THREE.Vector3(x1, .07, z1), new THREE.Vector3(x2, .07, z2))
    root.add(roadMesh(branch, .48, 0x3d403d))
    circuitTraffic.push(branch)
  })

  /* Three regional court towns form dense, readable destinations around the circuit. */
  for (const [townX, seed] of [[-10, 2], [0, 7], [10, 13]] as Array<[number, number]>) {
    for (let index = 0; index < 9; index += 1) {
      const column = index % 3
      const row = Math.floor(index / 3)
      const building = createBlockBuilding(1.35 + hashUnit(seed + index) * .35, 1.2 + hashUnit(seed * 9 + index) * 1.15, 1.2, [0x69645a, 0x746b5d, 0x5d6661][(seed + index) % 3])
      building.position.set(townX + (column - 1) * 1.75, -.02, -9.1 + row * 1.45)
      root.add(building)
    }
  }
  const station = createRailPlatform(.72)
  station.position.set(0, .02, 6.95)
  root.add(station)
  for (const [x, z, width, height] of [[-8.2, 8.9, 1.8, 1.45], [-5.8, 9.1, 1.55, 1.8], [-3.4, 9, 1.8, 1.3], [3.4, 9, 1.7, 1.55], [5.8, 9.1, 1.5, 1.9], [8.2, 8.9, 1.85, 1.4], [-10.8, 7.7, 1.6, 1.25], [10.8, 7.7, 1.6, 1.25]] as Array<[number, number, number, number]>) {
    const building = createBlockBuilding(width, height, 1.45, x < 0 ? 0x6c665a : 0x5e6862)
    building.position.set(x, .02, z)
    building.rotation.y = x < 0 ? .03 : -.03
    root.add(building)
  }
  const stationRoad = curveFrom([[-15, 10.3], [-8, 10], [0, 10.2], [8, 10], [15, 10.25]], .06)
  root.add(roadMesh(stationRoad, .72, 0x3e4442))
  circuitTraffic.push(stationRoad)
  for (const centerX of [-10.4, 10.4]) for (const [row, z] of [[0, -3.8], [1, 5.9]] as Array<[number, number]>) {
    for (let column = -2; column <= 2; column += 1) {
      const width = 1.35 + hashUnit(centerX * 7 + row * 31 + column * 13) * .42
      const height = 1.15 + hashUnit(centerX * 11 + row * 43 + column * 19) * 1.2
      const office = createBlockBuilding(width, height, 1.25, [0x625f56, 0x6f685a, 0x58645f, 0x756858][Math.abs(column + row) % 4])
      office.position.set(centerX + column * 1.75, .015, z)
      office.rotation.y = row ? Math.PI : 0
      root.add(office)
    }
  }
  for (const z of [-2.4, 4.6]) {
    const townRoad = curveFrom([[-17, z], [-9, z + .1], [0, z], [9, z - .1], [17, z]], .06)
    root.add(roadMesh(townRoad, .62, 0x414542))
    circuitTraffic.push(townRoad)
  }
  for (const z of [-1.8, 1.2, 7.2, 9.6]) for (let column = 0; column < 7; column += 1) {
    const x = -17.2 + column * 1.65 + (Math.round(z) % 2) * .42
    if (z === 1.2 && column > 1 && column < 6) continue
    const tree = createTree(.58 + (column % 3) * .07, column % 2 ? 0x465942 : 0x526346)
    tree.position.set(x, -.02, z)
    root.add(tree)
  }
  for (const [x, z] of [[-16.1, -4.5], [-13.5, -4.4], [-15.2, 5.8], [-12.8, 6.1]] as XZ[]) {
    const farm = createBlockBuilding(1.55, 1.18, 1.35, 0x6a594a)
    farm.position.set(x, .015, z)
    farm.rotation.y = x % 2 ? .04 : -.04
    root.add(farm)
  }
  for (const side of [-1, 1]) for (let index = 0; index < 13; index += 1) {
    const tree = createTree(.68 + (index % 3) * .07, index % 2 ? 0x465b43 : 0x536447)
    tree.position.set(side * (13.8 + (index % 3) * 1.05), -.04, -8.5 + index * 1.35)
    root.add(tree)
  }
  for (const [x, z] of [[-12.5, 7], [-6.5, 6.3], [6.7, 6.5], [12.7, 7.2]] as XZ[]) {
    const farm = createBlockBuilding(1.7, 1.15, 1.45, 0x6b5b4b)
    farm.position.set(x, 0, z)
    root.add(farm)
  }
}

function createCrane() {
  const group = new THREE.Group()
  const steel = material(0x6f6a59, .52, .32)
  group.add(box([.16, 3.8, .16], steel, [0, 1.9, 0]))
  group.add(box([3.2, .16, .16], steel, [1.35, 3.7, 0]))
  group.add(box([.055, 2.4, .055], steel, [2.55, 2.55, 0]))
  group.add(box([.6, .35, .6], material(0x4c5757, .68), [-.35, 3.42, 0]))
  group.userData.crane = true
  return group
}

function addOceanEnvironment(root: THREE.Group, definition: ArcDefinition) {
  const shore = material(0x637864, .98)
  for (const x of [-12, -6, 0, 6, 12]) {
    const z = x % 12 === 0 ? -6.2 : 5.7
    const portIsland = createIslandLandform(2.65 + (Math.abs(x) % 3) * .2, x + 41, 0x637864)
    portIsland.position.set(x, -.22, z)
    root.add(portIsland)
    const warehouse = createBlockBuilding(2.15, 1.25 + ((x + 12) % 3) * .22, 1.55, x % 12 === 0 ? 0x686f6c : 0x756d61)
    warehouse.position.set(x, .12, z)
    root.add(warehouse)
    const pier = createPier(3.3, .78)
    pier.position.set(x, .02, z + (z < 0 ? 2.2 : -2.2))
    root.add(pier)
    if (x === -12 || x === 6) {
      const cargo = createCargoStack(Math.abs(x) + 3, .46)
      cargo.position.set(x + 1.25, .24, z - .65)
      root.add(cargo)
    }
  }
  for (const x of [-13, -3.5, 7, 13]) {
    const crane = createCrane()
    crane.position.set(x, .1, -8.2)
    root.add(crane)
  }
  const embassy = createCourthouse(.72, definition.stone)
  embassy.position.set(1.5, .18, -5.7)
  root.add(embassy)
  for (const [x, z, radius] of [[-14, -2.8, 2.1], [-8, 2.3, 1.8], [0, -3, 2.2], [7.5, 2.5, 1.9], [14, -2.4, 2.2]] as Array<[number, number, number]>) {
    const island = createIslandLandform(radius, Math.round(x * 17 + z * 23 + 90), 0x6f7964)
    island.position.set(x, -.22, z)
    root.add(island)
    const tree = createTree(.58, 0x526754)
    tree.position.set(x + .35, .17, z - .15)
    root.add(tree)
  }
  for (const [x, z, scale] of [[-14, -2.7, .68], [7.8, 2.4, .55], [14, -2.2, .72]] as Array<[number, number, number]>) {
    const lighthouse = createLighthouse(scale)
    lighthouse.position.set(x - .5, .15, z + .25)
    root.add(lighthouse)
  }
  const shipping = curveFrom(definition.route, -.08)
  for (let index = 0; index < 10; index += 1) {
    const t = .04 + index / 9 * .92
    const point = shipping.getPointAt(t)
    const tangent = shipping.getTangentAt(t).normalize()
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x)
    const buoy = createBuoy(index % 2 ? 0xa64f3f : 0x3f7465, .8)
    buoy.position.copy(point).add(side.multiplyScalar(index % 2 ? 1.05 : -1.05))
    buoy.position.y = -.02
    root.add(buoy)
  }
  const outerIslands: Array<[number, number, number]> = [[-21, -9, 3.4], [-18, 8, 2.7], [-11, -12, 2.5], [-3, 11, 3.1], [8, -11.5, 2.9], [17, 9.5, 3.6], [22, -5, 3.2]]
  outerIslands.forEach(([x, z, radius], index) => {
    const island = createIslandLandform(radius, 110 + index * 13, index % 2 ? 0x596e5b : 0x627761)
    island.position.set(x, -.24, z)
    root.add(island)
    const villageCount = 2 + (index % 3)
    for (let village = 0; village < villageCount; village += 1) {
      const house = createBlockBuilding(.82, .72 + village * .13, .75, index % 2 ? 0x767066 : 0x686f6d)
      house.position.set(x + (village - 1) * .82, .12, z + (village % 2) * .62)
      root.add(house)
    }
  })
}

function addContinentEnvironment(root: THREE.Group, definition: ArcDefinition) {
  for (const x of [-9, 0, 9]) {
    const campus = createBlockBuilding(3.8, 2.1 + (x === 0 ? .9 : 0), 2.7, x === 0 ? 0x58696c : 0x666c68, true)
    campus.position.set(x, .02, -6.1)
    root.add(campus)
  }
  addElevatedRoad(root, [[-17, -9], [-10, -4], [-4, -7], [3, -3.8], [9, -7.2], [17, -3.7]], 1.25, 0x475153)
  addElevatedRoad(root, [[-17, 8], [-10, 5.1], [-3, 7], [5, 4.8], [12, 7.2], [17, 5.4]], .86, 0x475153)
  for (const z of [4.4, 6.2]) for (let x = -14; x <= 14; x += 2.2) {
    const tree = createTree(.65, z > 5 ? 0x626e50 : 0x59694e)
    tree.position.set(x, 0, z)
    root.add(tree)
  }
  const plaza = cylinder(3.85, .07, material(0x777a72, .96), [0, .035, -.1], 64)
  plaza.scale.z = .78
  root.add(plaza)
  const garden = cylinder(2.62, .08, material(0x56684e, 1), [0, .09, -.1], 64)
  garden.scale.z = .72
  root.add(garden)
  for (const [x, z] of [[-2.05, -.9], [2.05, -.9], [-1.9, .8], [1.9, .8]] as XZ[]) {
    const tree = createTree(.56, 0x3f5948); tree.position.set(x, .1, z); root.add(tree)
  }
  const fountain = createFountain(); fountain.scale.setScalar(.62); fountain.position.set(0, .12, -.1); root.add(fountain)
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
    [0, 14, -25],
  )
  aurora.userData.auroraUniforms = (aurora.material as THREE.ShaderMaterial).uniforms
  root.add(aurora)

  /* A continuous metropolitan horizon and four research campuses remove the empty diorama read. */
  let towerIndex = 0
  for (const z of [-10.5, -14.2]) for (let x = -20; x <= 20; x += 2.7) {
    const height = 2.3 + hashUnit(190 + towerIndex * 7) * 4.8
    const tower = createBlockBuilding(1.7 + hashUnit(towerIndex + 4) * .65, height, 1.8, [0x46575c, 0x526166, 0x3d5158, 0x5b6261][towerIndex % 4], true)
    tower.position.set(x, -.08, z)
    root.add(tower)
    towerIndex += 1
  }
  for (const [x, z, rotation] of [[-12, 5.4, .08], [-6.5, 5.2, -.06], [6.8, 5.3, .05], [12.4, 5.1, -.08]] as Array<[number, number, number]>) {
    const campus = createBlockBuilding(3.4, 1.65, 2.2, 0x5d6b69, true)
    campus.position.set(x, .02, z)
    campus.rotation.y = rotation
    root.add(campus)
    const plaza = box([4.1, .05, 2.8], material(0x797b72, .96), [x, .015, z])
    plaza.rotation.y = rotation
    root.add(plaza)
  }
  const civicRows = [2.9, 9.2]
  civicRows.forEach((z, row) => {
    for (let column = 0; column < 8; column += 1) {
      const x = -17.5 + column * 5
      if (row === 0 && Math.abs(x) < 5) continue
      const height = 1.55 + hashUnit(row * 61 + column * 17) * 2.35
      const civic = createBlockBuilding(2.55 + (column % 2) * .35, height, 2.05, [0x4f6062, 0x5b6765, 0x60635e, 0x45585e][(row + column) % 4], true)
      civic.position.set(x, .015, z)
      civic.rotation.y = (column % 2 ? 1 : -1) * .025
      root.add(civic)
    }
  })
  for (const z of [-1.9, 7.5]) {
    const boulevard = curveFrom([[-20, z], [-10, z + .15], [0, z], [10, z - .15], [20, z]], .065)
    root.add(roadMesh(boulevard, .92, 0x384447))
    ;((root.userData.trafficCurves ??= []) as Array<THREE.Curve<THREE.Vector3>>).push(boulevard)
  }
  for (const [row, z] of [[0, -4.25], [1, 10.45]] as Array<[number, number]>) for (let column = 0; column < 9; column += 1) {
    const x = -18 + column * 4.5
    const height = 1.8 + hashUnit(420 + row * 79 + column * 23) * 2.9
    const building = createBlockBuilding(2.55 + (column % 3) * .24, height, 2.15, [0x43555a, 0x526164, 0x5b6260, 0x485b60][(row + column) % 4], true)
    building.position.set(x, .02, z)
    building.rotation.y = row ? Math.PI : 0
    root.add(building)
  }
  const transit = createRailPlatform(.78)
  transit.position.set(0, .02, 7.15)
  root.add(transit)
  for (const [x, z] of [[-15, 8.5], [-10, 9], [-5, 8.6], [5, 8.7], [10, 9.1], [15, 8.5]] as XZ[]) {
    const bench = createBench(.68); bench.position.set(x, .02, z); bench.rotation.y = Math.PI; root.add(bench)
  }
}

function addGlobalEnvironment(root: THREE.Group, definition: ArcDefinition) {
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

function addPerimeterEnvironment(root: THREE.Group, region: MapRegionKey, definition: ArcDefinition) {
  if (region === 'orbit') return
  const urban = region === 'city'
  if (urban) {
    // One instanced rear district replaces four rows of fully articulated
    // buildings. It fills the horizon behind the courts without taxing the
    // foreground scene or becoming interactive clutter.
    root.add(createOldQuarterRearSkyline())
    const facadeColors = [0x554f49, 0x5c5650, 0x4e5757]
    let index = 0
    for (const x of [-22, 22]) {
      for (let z = -10; z <= 10; z += 3.5) {
        const building = createBlockBuilding(2.1, 2.7 + ((Math.abs(Math.round(z)) + index) % 5) * .45, 2, facadeColors[index % facadeColors.length], true)
        building.position.set(x, -.08, z)
        root.add(building)
        index += 1
      }
    }

    // The earlier composition stopped at the playable route, leaving the
    // camera-facing half of the map as exposed ground. This foreground ward
    // completes the same street grid with whole parcels between real roads.
    const foregroundStreetZ = [11.9, 16.3, 20.7, 25.1, 29.5]
    foregroundStreetZ.forEach((z) => {
      const street = new THREE.LineCurve3(new THREE.Vector3(-36, .055, z), new THREE.Vector3(36, .055, z))
      root.add(roadMesh(street, .72, 0x343b3c))
    })
    for (const x of [-28, -21, -14, -7, 0, 7, 14, 21, 28]) {
      const street = new THREE.LineCurve3(new THREE.Vector3(x, .057, 10.8), new THREE.Vector3(x, .057, 31))
      root.add(roadMesh(street, .64, 0x343b3c))
    }
    const parcelX = [-31.5, -24.5, -17.5, -10.5, -3.5, 3.5, 10.5, 17.5, 24.5, 31.5]
    const parcelZ = [14.1, 18.5, 22.9, 27.3]
    parcelZ.forEach((z, row) => parcelX.forEach((x, column) => {
      const parcel = createOldQuarterParcel(700 + row * 31 + column, row < 2 ? .91 : .84, row >= 2)
      parcel.position.set(x, -.02, z)
      parcel.rotation.y = row % 2 ? Math.PI : 0
      root.add(parcel)
    }))

    // A planted civic boulevard preserves a deliberate sightline into the
    // career district while ensuring the central foreground is not blank.
    for (let z = 13.3; z <= 28.3; z += 2.15) for (const side of [-1, 1]) {
      const tree = createTree(.52 + hashUnit(z * 19 + side) * .08, side < 0 ? 0x50634f : 0x596950)
      tree.position.set(side * 1.18, 0, z)
      root.add(tree)
      if (Math.round(z * 10) % 4 === 1) {
        const lamp = createLamp()
        lamp.position.set(side * 1.72, .02, z + .62)
        lamp.scale.setScalar(.82)
        root.add(lamp)
      }
    }

    // Continue the quarter laterally so camera rotation never reveals an
    // isolated strip of buildings floating on an empty ground plane.
    for (const side of [-1, 1]) for (let z = -10.4; z <= 9.8; z += 3.45) {
      const parcel = createOldQuarterParcel(980 + Math.round(z * 13) + (side > 0 ? 80 : 0), .72, false)
      parcel.position.set(side * 27.2, -.06, z)
      parcel.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2
      root.add(parcel)
    }
    return
  }
  if (region === 'ocean') {
    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2
      const radiusX = 24 + (index % 3) * 3
      const radiusZ = 15 + (index % 4) * 2
      const x = Math.cos(angle) * radiusX
      const z = Math.sin(angle) * radiusZ - 3
      const island = createIslandLandform(1.7 + (index % 3) * .55, 220 + index * 17, index % 2 ? 0x4f6255 : 0x586b59)
      island.position.set(x, -.24, z)
      root.add(island)
      if (index % 3 === 0) {
        const tower = createBlockBuilding(1.2, 2.2 + (index % 2), 1.2, 0x68665f)
        tower.position.set(x, .08, z)
        root.add(tower)
      }
    }
    return
  }
  for (let index = 0; index < 19; index += 1) {
    const x = -28 + index * 3.15
    const z = -15 - (index % 3) * 3.3
    const mountain = createMountain(1.4 + (index % 5) * .22, region === 'continent' ? 0x4d514d : 0x55564a, index % 5 === 0)
    mountain.position.set(x, -.25, z)
    root.add(mountain)
  }
  for (const side of [-1, 1]) for (let index = 0; index < 18; index += 1) {
    const tree = createTree(.62 + (index % 4) * .06, region === 'continent' ? 0x384b43 : 0x425442)
    tree.position.set(side * (18 + (index % 4) * 2.1), -.1, -10 + index * 1.25)
    root.add(tree)
  }
  const horizonCourt = createCourthouse(.62, definition.stone)
  horizonCourt.position.set(0, -.08, -14.5)
  root.add(horizonCourt)
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

function markAuthoredProp<T extends THREE.Object3D>(object: T, footprintRadius: number) {
  object.userData.authoredProp = true
  object.userData.footprintRadius = footprintRadius
  return object
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
  return markAuthoredProp(group, .88 * scale)
}

function createServiceShed(scale = 1, color = 0x665f55) {
  const group = new THREE.Group()
  group.add(box([1.25 * scale, .95 * scale, .95 * scale], material(color, .9), [0, .48 * scale, 0]))
  const roof = box([1.48 * scale, .12 * scale, 1.18 * scale], material(0x45433d, .78, .12), [0, 1.04 * scale, 0])
  roof.rotation.z = .08
  group.add(roof)
  group.add(box([.42 * scale, .7 * scale, .05], material(0x2c3333, .72), [0, .38 * scale, .49 * scale]))
  return markAuthoredProp(group, .82 * scale)
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
  return markAuthoredProp(group, 1.28 * scale)
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
  return markAuthoredProp(group, .72 * scale)
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
  return markAuthoredProp(group, 1.85 * scale)
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
  return markAuthoredProp(group, .92 * scale)
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
  const wakeMaterial = new THREE.MeshBasicMaterial({ color: 0xc1dbd5, transparent: true, opacity: .24, depthWrite: false })
  for (const side of [-1, 1]) {
    const wake = mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.75 * scale, .02, 0), new THREE.Vector3(-1.6 * scale, .015, side * .24 * scale), new THREE.Vector3(-2.45 * scale, .01, side * .58 * scale)), 18, .025 * scale, 5, false), wakeMaterial)
    wake.castShadow = false
    group.add(wake)
  }
  return markAuthoredProp(group, 1.35 * scale)
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
  return markAuthoredProp(group, 1.35 * scale)
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
  return markAuthoredProp(group, 1.35 * scale)
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
  return markAuthoredProp(group, 1.65 * scale)
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
  return markAuthoredProp(group, 1.25 * scale)
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
  return markAuthoredProp(group, 1.58 * scale)
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
  return markAuthoredProp(group, 1.18 * scale)
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
  return markAuthoredProp(group, 2.65 * scale)
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
    addAt(createFieldGate(.62), -2.25, .45, facing + Math.PI / 2)
    for (const direction of [-1, 1]) {
      const tree = createTree(.62 + (index + direction + 1) * .035, 0x536449)
      addAt(tree, direction * 2.55, -.55)
    }
    addAt(createHayBales(.48), 2.1, 1.0, facing + .1)
  } else if (region === 'ocean') {
    const marsh = createMarshPatch(220 + point.data.tier, .58)
    addAt(marsh, index % 2 ? -1.15 : 1.15, -.35)
    const boat = createHarborWorkboat(.46, index % 2 ? 0x536b70 : 0x68594e)
    addAt(boat, index % 2 ? 1.95 : -1.95, 1.75, -Math.atan2(tangent.z, tangent.x))
    addAt(createCargoStack(180 + point.data.tier, .18), index % 2 ? -1.65 : 1.65, .35, facing + Math.PI / 2)
  } else if (region === 'continent') {
    for (const direction of [-1, 1]) {
      const annex = createBlockBuilding(1.55, 1.5 + (index + (direction > 0 ? 1 : 0)) * .46, 1.5, direction > 0 ? 0x526366 : 0x465b60, true)
      addAt(annex, direction * 2.3, -.48)
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
  const canPlace = (object: THREE.Object3D, position: THREE.Vector3) => {
    const footprint = Number(object.userData.footprintRadius ?? .7)
    return !root.children.some((child) => {
      if (child.userData.careerInfrastructure || child.userData.mapSelection) return false
      const other = Number(child.userData.footprintRadius ?? 0)
      if (!other) return false
      return Math.hypot(child.position.x - position.x, child.position.z - position.z) < (footprint + other) * .9
    })
  }
  const samples = Array.from({ length: region === 'ocean' ? 14 : 22 }, (_, index) => (index + .45) / (region === 'ocean' ? 14 : 22))
  samples.forEach((t, index) => {
    const point = route.getPointAt(t)
    const tangent = route.getTangentAt(t).normalize()
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    const side = index % 2 ? 1 : -1
    const distance = (region === 'orbit' ? 4.3 : region === 'ocean' ? 5.6 : 4.15) + hashUnit(index * 37 + region.length) * (region === 'ocean' ? 4.2 : 2.8)
    const position = point.clone().add(normal.multiplyScalar(distance * side)).setY(.02)
    if (region === 'city' && position.x < -13.6) return

    if (region === 'ocean') {
      const island = createIslandLandform(.72 + hashUnit(index * 19) * .55, 900 + index * 31, index % 2 ? 0x5d6e59 : 0x68745e)
      island.position.set(position.x, -.24, position.z)
      root.add(island)
      const marsh = createMarshPatch(70 + index, .58 + hashUnit(index * 7) * .24)
      marsh.position.set(position.x, .08, position.z)
      root.add(marsh)
      if (index % 3 === 0) {
        const boat = createHarborWorkboat(.4 + hashUnit(index * 11) * .12, index % 2 ? 0x52686b : 0x67584d)
        boat.position.set(position.x + tangent.x * 1.35, -.04, position.z + tangent.z * 1.35)
        boat.rotation.y = -Math.atan2(tangent.z, tangent.x)
        root.add(boat)
      }
      return
    }

    let object: THREE.Object3D
    if (region === 'city') {
      if (index % 5 === 0) object = createBlockBuilding(1.55 + hashUnit(index) * .45, 1.55 + hashUnit(index * 13) * 1.5, 1.55, [0x66594d, 0x6c6256, 0x59615e][index % 3], false)
      else if (index % 5 === 1) object = createParkedDeliveryBay(index, .78)
      else if (index % 5 === 2) object = createCurbCluster(index, .82)
      else if (index % 5 === 3) object = createTree(.62 + hashUnit(index * 17) * .18, 0x50634d)
      else object = createServiceShed(.62, 0x62594d)
    } else if (region === 'nation') {
      if (index % 5 === 0) object = createFarmstead(.58 + hashUnit(index) * .14)
      else if (index % 5 === 1) object = createFieldGate(.72)
      else if (index % 5 === 2) object = createHayBales(.55)
      else if (index % 5 === 3) object = createTree(.72 + hashUnit(index * 19) * .2, 0x536349)
      else object = createServiceShed(.56, 0x685743)
    } else if (region === 'continent') {
      if (index % 5 === 0) object = createBlockBuilding(1.7 + hashUnit(index) * .55, 2.1 + hashUnit(index * 13) * 2.2, 1.7, [0x485b60, 0x566466, 0x43575c][index % 3], true)
      else if (index % 5 === 1) object = createRainGarden(100 + index, .72)
      else if (index % 5 === 2) object = createTransitShelter(.55, definition.accent)
      else if (index % 5 === 3) object = createTree(.62 + hashUnit(index * 17) * .17, 0x40594d)
      else object = createChargingBay(.48)
    } else {
      if (index % 4 === 0) object = createOrbitalServiceBay(index, .58)
      else if (index % 4 === 1) object = createOrbitalDock(.5, index % 2 ? 0x72ced7 : 0xc5a65f)
      else if (index % 4 === 2) object = createOrbitalTankFarm(.52)
      else object = createSolarArray(.37)
    }
    if (!canPlace(object, position)) return
    object.position.copy(position)
    object.rotation.y = -Math.atan2(tangent.z, tangent.x)
    root.add(object)
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
    ;[[-16, 7.6], [-12.8, 7.8], [-7.3, 8], [7.2, 8], [12.8, 7.8], [16, 7.6]]
      .forEach(([x, z], index) => place(index % 2 ? createServiceShed(.72, 0x6d5a49) : createPlanter(.78), x, z, index % 2 ? .08 : 0))
    ;[[-15, -7.5], [-11.8, -8.2], [11.8, -8.2], [15, -7.5]]
      .forEach(([x, z]) => place(createWayfindingTotem(0x6f8d78), x, z, Math.PI / 2))
    ;[[-17.5, 12.5, .08], [-11.5, 12.9, -.05], [11.5, 12.9, .05], [17.5, 12.5, -.08]]
      .forEach(([x, z, rotation]) => place(createFarmstead(.68), x, z, rotation, 3.2))
    ;[[-14.5, 5.5], [-9, 5.7], [-3.7, 5.45], [3.8, 5.45], [9.2, 5.7], [14.5, 5.5]]
      .forEach(([x, z], index) => place(createHayBales(.58 + (index % 2) * .05), x, z, index % 2 ? .12 : -.08, 2.85))
    ;[[-14, 6.65], [-7.2, 6.75], [7.2, 6.75], [14, 6.65]]
      .forEach(([x, z], index) => place(createRailSignal(.82), x, z, index > 1 ? Math.PI : 0, 2.7))
    place(createTransitShelter(.82, 0x6f8d78), 0, 8.35, Math.PI, 3)
  } else if (region === 'ocean') {
    ;[[-13.25, -6.75], [-7.25, 5.1], [1.25, -6.75], [7.25, 5.1], [13.25, -6.75]]
      .forEach(([x, z], index) => placeWater(createCargoStack(40 + index, .28), x, z, index % 2 ? Math.PI / 2 : 0))
    ;[[-10.65, -6.75], [-4.65, 5.05], [1.45, -5.6], [7.45, 6.35], [10.65, -5.65]]
      .forEach(([x, z]) => placeWater(createHarborFuelDepot(.45), x, z))
    ;[[-13, -3.85, .08], [-7, 3.45, Math.PI], [1, -3.85, .06], [7, 3.45, Math.PI], [13, -3.85, -.04]]
      .forEach(([x, z, rotation], index) => placeWater(createHarborWorkboat(.58 + (index % 2) * .05, index % 2 ? 0x556e73 : 0x6c5d52), x, z, rotation))
    ;[[-18.1, 8.15], [-3.1, 11.1], [17.1, 9.55]]
      .forEach(([x, z], index) => placeWater(createRadarArray(.48 + index * .035), x, z, -.35))
    ;[[-20.2, -9.2], [8.1, -11.65], [21.2, -5.1]]
      .forEach(([x, z], index) => placeWater(createServiceShed(.48, index % 2 ? 0x54645e : 0x655c52), x, z, index % 2 ? Math.PI : 0))
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
    alongRoute([.07, .18, .3, .43, .57, .7, .82, .93], 2.65, (index, side) => {
      if (index < 2 || index > 5) return side < 0 ? createHayBales(.48) : createServiceShed(.48, 0x655744)
      return index % 2 ? createWayfindingTotem(0x6f8d78) : createBench(.58)
    }, 2.02)
  } else if (region === 'ocean') {
    ;[.045, .12, .2, .29, .39, .5, .61, .72, .82, .91, .97].forEach((t, index) => {
      const point = route.getPointAt(t)
      const tangent = route.getTangentAt(t).normalize()
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      for (const side of [-1, 1]) {
        const buoyPosition = point.clone().add(normal.clone().multiplyScalar((1.25 + (index % 3) * .16) * side))
        const buoy = createBuoy(index % 3 === 0 ? 0xc6a34f : side < 0 ? 0xa95242 : 0x54796f, .62)
        placeWater(buoy, buoyPosition.x, buoyPosition.z)
        if (index % 3 === 1) {
          const boatPosition = point.clone().add(normal.clone().multiplyScalar(3.15 * side))
          placeWater(createHarborWorkboat(.46, side < 0 ? 0x586b70 : 0x67594d), boatPosition.x, boatPosition.z, Math.atan2(tangent.x, tangent.z))
        }
      }
    })
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
  return group
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
  return group
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

function animateLawyerRig(rig: StylizedCounselRig, elapsed: number, locomotion: number, arrival: number, gaitPhase: number) {
  const stridePhase = gaitPhase
  const stride = Math.sin(stridePhase) * locomotion
  const doubleStep = Math.abs(Math.sin(stridePhase * 2)) * locomotion
  const leftLift = Math.max(0, Math.sin(stridePhase)) * locomotion
  const rightLift = Math.max(0, -Math.sin(stridePhase)) * locomotion
  const breath = Math.sin(elapsed * 1.15)
  const settle = Math.sin(elapsed * 2.1) * arrival

  rig.hips.position.y = rig.base.hipsY + doubleStep * .026 + breath * .008 * (1 - locomotion)
  rig.hips.rotation.z = stride * .018
  rig.hips.rotation.y = -stride * .016
  rig.spine.rotation.z = -stride * .022 + settle * .007
  rig.spine.rotation.y = stride * .032
  rig.chest.scale.set(1 + breath * .006, 1 + breath * .005, 1)
  rig.head.rotation.y = -stride * .022
  rig.head.rotation.x = -.018 + doubleStep * .009
  rig.head.rotation.z = stride * .009
  rig.leftHip.rotation.x = stride * .44
  rig.rightHip.rotation.x = -stride * .44
  rig.leftHip.rotation.z = -.025 - stride * .012
  rig.rightHip.rotation.z = .035 - stride * .012
  rig.leftKnee.rotation.x = leftLift * .52 + Math.max(0, -stride) * .08
  rig.rightKnee.rotation.x = rightLift * .52 + Math.max(0, stride) * .08
  rig.leftKnee.rotation.z = .015
  rig.rightKnee.rotation.z = -.015
  rig.leftFoot.rotation.x = -leftLift * .28 + Math.max(0, -stride) * .11
  rig.rightFoot.rotation.x = -rightLift * .28 + Math.max(0, stride) * .11
  rig.leftShoulder.rotation.x = -stride * .24
  rig.rightShoulder.rotation.x = stride * .24
  rig.leftShoulder.rotation.z = rig.base.leftShoulderZ + stride * .01
  rig.rightShoulder.rotation.z = rig.base.rightShoulderZ + stride * .01
  rig.leftElbow.rotation.x = Math.max(0, stride) * .08
  rig.rightElbow.rotation.x = Math.max(0, -stride) * .08
  rig.leftElbow.rotation.z = rig.base.leftElbowZ
  rig.rightElbow.rotation.z = rig.base.rightElbowZ
  rig.satchel.rotation.z = -stride * .035
  rig.satchel.rotation.x = doubleStep * .018
  rig.satchel.position.y = .28 + doubleStep * .012

  const blinkPhase = elapsed % 6.4
  const blink = blinkPhase > 3.05 && blinkPhase < 3.28 ? Math.sin((blinkPhase - 3.05) / .23 * Math.PI) : 0
  rig.eyes.forEach((eye) => { eye.scale.y = Math.max(.09, 1 - blink * .92) })
}

function waterSurface(color: number) {
  const geometry = new THREE.PlaneGeometry(220, 180, 180, 140)
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(color).multiplyScalar(.62) },
    uShallow: { value: new THREE.Color(color).lerp(new THREE.Color(0x4f9698), .5) },
    uSky: { value: new THREE.Color(0xb9d3cf) },
    uSun: { value: new THREE.Color(0xf1d49a) },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    vertexShader: `
      uniform float uTime;
      varying float vHeight;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vUv;
      float hash21(vec2 p){
        p=fract(p*vec2(123.34,456.21));
        p+=dot(p,p+45.32);
        return fract(p.x*p.y);
      }
      float noise2(vec2 p){
        vec2 i=floor(p),f=fract(p);
        f=f*f*(3.0-2.0*f);
        return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.)),f.x),f.y);
      }
      float fbm(vec2 p){
        float value=0.;
        float amplitude=.5;
        mat2 turn=mat2(.80,-.60,.60,.80);
        for(int octave=0;octave<6;octave++){
          value+=amplitude*(noise2(p)-.5);
          p=turn*p*2.03+vec2(11.7,7.9);
          amplitude*=.52;
        }
        return value;
      }
      float waterHeight(vec2 p){
        float slow=fbm(p*.115+vec2(uTime*.075,-uTime*.038));
        float crossing=fbm((p*vec2(.19,.14))+vec2(-uTime*.052,uTime*.066));
        float swell=sin(p.x*.12+p.y*.07+uTime*.52)*.12+sin(p.x*-.055+p.y*.15-uTime*.38)*.075;
        return slow*.34+crossing*.18+swell;
      }
      void main(){
        vUv=uv;
        vec3 p=position;
        float e=.09;
        float h=waterHeight(p.xy);
        float hx=waterHeight(p.xy+vec2(e,0.));
        float hy=waterHeight(p.xy+vec2(0.,e));
        p.z=h;
        vHeight=h;
        vNormalW=normalize(normalMatrix*vec3(h-hx,h-hy,e));
        vWorld=(modelMatrix*vec4(p,1.)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSun; uniform float uTime;
      varying float vHeight; varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vUv;
      float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      void main(){
        vec3 normal=normalize(vNormalW);
        vec3 viewDirection=normalize(cameraPosition-vWorld);
        vec3 lightDirection=normalize(vec3(-.42,.82,.36));
        float fresnel=pow(1.-max(dot(normal,viewDirection),0.),3.2);
        float specular=pow(max(dot(reflect(-lightDirection,normal),viewDirection),0.),78.);
        float broad=pow(max(dot(reflect(-lightDirection,normal),viewDirection),0.),11.);
        float micro=hash21(floor(vWorld.xz*2.1)+floor(uTime*2.));
        float foam=smoothstep(.23,.38,vHeight+micro*.045);
        vec3 water=mix(uDeep,uShallow,clamp(vHeight*1.45+.42,0.,1.));
        water=mix(water,uSky,.18+fresnel*.6);
        water+=uSun*(specular*.92+broad*.13);
        water=mix(water,vec3(.76,.84,.80),foam*.22);
        float distanceHaze=smoothstep(35.,100.,distance(cameraPosition,vWorld));
        water=mix(water,uSky,distanceHaze*.24);
        gl_FragColor=vec4(water,1.);
      }`,
    side: THREE.DoubleSide,
  })
  const water = new THREE.Mesh(geometry, mat)
  water.rotation.x = -Math.PI / 2
  water.position.y = -.22
  water.receiveShadow = true
  water.userData.waterUniforms = uniforms
  return water
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

function waterRibbon(curve: THREE.Curve<THREE.Vector3>, width: number, color = 0x3f7f86) {
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } }
  const water = new THREE.Mesh(
    ribbonGeometry(curve, width, 140),
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime; varying vec2 vUv; varying float vRipple;
        void main(){vUv=uv;vec3 p=position;float r=sin(uv.y*34.0-uTime*1.4)*.028+cos(uv.x*18.0+uTime)*.018;p.y+=r;vRipple=r;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying float vRipple;
        void main(){float glint=smoothstep(.72,.98,sin(vUv.y*70.0-uTime*1.7)*.5+.5);vec3 c=mix(uColor,vec3(.68,.82,.79),.2+vRipple*2.4+glint*.08);gl_FragColor=vec4(c,.94);}`,
    }),
  )
  water.position.y = .045
  water.receiveShadow = true
  water.userData.waterUniforms = uniforms
  return water
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

function addElevatedRoad(root: THREE.Group, points: XZ[], height: number, color: number) {
  const curve = curveFrom(points, height)
  const auxiliary = (root.userData.auxTransportCurves ??= []) as Array<THREE.Curve<THREE.Vector3>>
  auxiliary.push(curve)
  root.add(roadMesh(curve, .78, color))
  const concrete = material(0x777a74, .9)
  for (let index = 0; index <= 12; index += 1) {
    const point = curve.getPointAt(index / 12)
    root.add(cylinder(.075, height, concrete, [point.x, height / 2, point.z], 12))
  }
  return curve
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
  const opacity = region === 'city' ? .3 + hashUnit(index * 31 + 4) * .2 : .28 + hashUnit(index * 31 + 4) * .15
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
  const cloudScale = .72 + hashUnit(index * 23 + 9) * .68
  group.scale.setScalar(cloudScale)
  const x = -31 + hashUnit(index * 43 + 3) * 62
  const y = 8.2 + hashUnit(index * 59 + 7) * 6.2
  const z = -25 + hashUnit(index * 71 + 13) * 48
  group.position.set(x, y, z)
  group.userData.cloud = true
  group.userData.speed = .12 + hashUnit(index * 37 + 5) * .19
  group.userData.cloudBaseY = y
  group.userData.cloudBaseZ = z
  group.userData.cloudPhase = hashUnit(index * 83 + 11) * Math.PI * 2
  group.userData.cloudWrapMin = -34
  group.userData.cloudWrapMax = 34
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
        if (entry.userData.characterShared) return
        const spriteMap = (entry as THREE.SpriteMaterial).map
        spriteMap?.dispose()
        entry.dispose()
      })
    }
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
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const commandRef = useRef(cameraCommand)
  const selectedRef = useRef(selectedKey)
  const selectRef = useRef(onSelect)
  const modeRef = useRef(viewMode)
  commandRef.current = cameraCommand
  selectedRef.current = selectedKey
  selectRef.current = onSelect
  modeRef.current = viewMode

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const definition = ARC[region]
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    const constrainedDevice = (navigator.hardwareConcurrency || 8) <= 4
    const renderPixelRatio = Math.min(window.devicePixelRatio || 1, constrainedDevice ? 1 : 1.15)
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
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -25; sun.shadow.camera.right = 25; sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20
    sun.shadow.bias = -.00035
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
      ? waterSurface(0x1f6173)
      : region === 'orbit'
        ? new THREE.Group()
        : box([220, .28, 180], groundMaterial(definition.ground), [0, -.18, 0])
    world.add(ground)

    const routeCurve = curveFrom(definition.route, region === 'orbit' ? .5 : .09)
    world.add(createNativeCareerRoute(region, routeCurve, definition))
    const railCurve = curveFrom(definition.rail, region === 'ocean' ? -.08 : .1)
    if (region !== 'ocean' && region !== 'orbit') {
      const railBed = mesh(ribbonGeometry(railCurve, .76), material(0x56584f, .98))
      railBed.position.y = .02
      const railA = mesh(ribbonGeometry(railCurve, .055), material(0x4a4f4f, .32, .48)); railA.position.y = .1
      const railB = railA.clone(); railA.position.z += .22; railB.position.z -= .22
      world.add(railBed, railA, railB)
    }

    if (region === 'city') addCityEnvironment(world, definition)
    else if (region === 'nation') addNationEnvironment(world, definition)
    else if (region === 'ocean') addOceanEnvironment(world, definition)
    else if (region === 'continent') addContinentEnvironment(world, definition)
    else addGlobalEnvironment(world, definition)
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

    const rivalSitesByRegion: Record<MapRegionKey, XZ[]> = {
      city: [[-14, -7], [-7, -7.6], [7, -7.6], [14, -7]],
      nation: [[-11.5, -8], [11.5, -8]],
      ocean: [[-12, -6.6], [0, 8.6], [12, -6.6]],
      continent: [[-13, -7], [13, -7]],
      orbit: [[-12, -6], [0, 8.7], [12, -6]],
    }
    const rivalSites = rivalSitesByRegion[region]
    rivals.forEach((point, index) => {
      const [x, z] = rivalSites[index % rivalSites.length]
      clearAuthoredParcel(world, new THREE.Vector3(x, 0, z), 1.85)
      const building = createRivalBuilding(point, index, definition)
      building.position.set(x, .04, z)
      building.rotation.y = z < 0 ? 0 : Math.PI
      world.add(building)
      const ring = emphasisRing('rivals', point.key, point.data.owned ? 0x6fb29c : 0xb36f60, 1.45)
      ring.position.x = x; ring.position.z = z
      world.add(ring)
      anchors.set(point.key, new THREE.Vector3(x, .12, z))
      travelAnchors.set(point.key, new THREE.Vector3(x, .12, z + (z < 0 ? 1.45 : -1.45)))
    })

    const eventSitesByRegion: Record<MapRegionKey, XZ[]> = {
      city: [[-10.4, 4.15], [10.4, 4.05]],
      nation: [[0, 5.2]],
      ocean: [[-6, 7.2], [6, 7.2]],
      continent: [[0, 5.35]],
      orbit: [[-7, 7.8], [7, 7.8]],
    }
    const eventSites = eventSitesByRegion[region]
    events.forEach((point, index) => {
      const [x, z] = eventSites[index % eventSites.length]
      clearAuthoredParcel(world, new THREE.Vector3(x, 0, z), 1.3)
      const signal = createEventSite(point, definition)
      signal.position.set(x, .04, z)
      world.add(signal)
      const ring = emphasisRing('dockets', point.key, point.locked ? 0x77766f : 0xd0a957, 1.18)
      ring.position.x = x; ring.position.z = z
      world.add(ring)
      anchors.set(point.key, new THREE.Vector3(x, .12, z))
      travelAnchors.set(point.key, new THREE.Vector3(x, .12, z + 1.25))
    })

    const transports: Array<{ object: THREE.Object3D; curve: THREE.Curve<THREE.Vector3>; offset: number; speed: number }> = []
    const trafficCurves = (world.userData.trafficCurves ?? []) as Array<THREE.Curve<THREE.Vector3>>
    const targetTraffic = region === 'continent' ? 8 : region === 'city' ? 7 : region === 'nation' ? 6 : 0
    const vehicleCount = trafficCurves.length ? Math.min(targetTraffic, Math.max(4, Math.round(activity * .8))) : 0
    for (let i = 0; i < vehicleCount; i += 1) {
      const vehicle = createVehicle([0x6d4d48, 0x52626a, 0x71664f, 0x455e59][i % 4])
      world.add(vehicle)
      const lane = i % trafficCurves.length
      transports.push({ object: vehicle, curve: trafficCurves[lane], offset: i / Math.max(1, vehicleCount), speed: .0076 + lane * .00025 })
    }
    const regionalTransport = region === 'ocean' ? createFerry() : region === 'orbit' ? createOrbitalCraft() : createTrain()
    world.add(regionalTransport)
    transports.push({ object: regionalTransport, curve: railCurve, offset: .17, speed: region === 'ocean' ? .009 : .0065 })
    if (region === 'ocean' || region === 'orbit') {
      const secondRegional = region === 'ocean' ? createFerry() : createOrbitalCraft()
      secondRegional.scale.setScalar(region === 'ocean' ? .78 : .72)
      world.add(secondRegional)
      transports.push({ object: secondRegional, curve: railCurve, offset: .64, speed: region === 'ocean' ? .0075 : .0058 })
    } else if (region === 'nation' || region === 'continent') {
      const secondTrain = createTrain()
      secondTrain.scale.setScalar(.82)
      world.add(secondTrain)
      transports.push({ object: secondTrain, curve: railCurve, offset: .61, speed: .0057 })
    }
    const auxiliaryCurves = (world.userData.auxTransportCurves ?? []) as Array<THREE.Curve<THREE.Vector3>>
    auxiliaryCurves.forEach((curve, index) => {
      const vehicle = createVehicle(index % 2 ? 0x526b70 : 0x6f6655)
      world.add(vehicle)
      transports.push({ object: vehicle, curve, offset: index * .43, speed: .009 + index * .001 })
    })
    const waterTransportCurve = world.userData.waterTransportCurve as THREE.Curve<THREE.Vector3> | undefined
    if (waterTransportCurve) {
      const riverLaunch = createFerry()
      riverLaunch.scale.setScalar(.42)
      world.add(riverLaunch)
      transports.push({ object: riverLaunch, curve: waterTransportCurve, offset: .42, speed: .0055 })
    }
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
    const transitCarrier = region === 'ocean' ? createFerry() : region === 'orbit' ? createOrbitalCraft() : null
    if (transitCarrier) {
      transitCarrier.scale.setScalar(region === 'ocean' ? .72 : 1.18)
      transitCarrier.visible = false
      world.add(transitCarrier)
    }
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
    type WalkState = { curve: THREE.CatmullRomCurve3; started: number; duration: number; lastProgress: number }
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
        started: performance.now() + 420,
        duration: THREE.MathUtils.clamp(initialWalkCurve.getLength() * 285, 2400, region === 'city' ? 7800 : 6200),
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
    const enableLiveTransform = (object: THREE.Object3D) => { object.matrixAutoUpdate = true }
    animatedObjects.forEach(enableLiveTransform)
    selectableRoots.forEach(enableLiveTransform)
    transports.forEach(({ object }) => enableLiveTransform(object))
    lawyer.traverse(enableLiveTransform)
    if (transitCarrier) enableLiveTransform(transitCarrier)
    enableLiveTransform(selectionRing)

    // Capture one complete, static world shadow map before camera-dependent
    // render culling begins. Camera rotation should never regenerate it.
    renderer.render(scene, camera)
    renderer.shadowMap.needsUpdate = false

    let targetYaw = 0
    let targetPitch = 0
    let zoom = 1
    let cameraMode: 'counsel' | 'overview' = 'counsel'
    let dragging = false
    let pointerStart = new THREE.Vector2()
    let moved = false
    let hoveredRoot: THREE.Object3D | null = null
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
    let gaitPhase = 0
    let occlusionTimer = 0
    let cullingTimer = 0
    let previousFrame = performance.now()
    let animationFrame = 0
    let disposed = false
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

    const setOccluderFade = (root: THREE.Object3D, faded: boolean) => {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((entry) => {
          const saved = entry.userData.playerOcclusionOriginal as { transparent: boolean; opacity: number; depthWrite: boolean } | undefined
          if (faded) {
            if (!saved) entry.userData.playerOcclusionOriginal = { transparent: entry.transparent, opacity: entry.opacity, depthWrite: entry.depthWrite }
            entry.transparent = true
            entry.opacity = Math.min(saved?.opacity ?? entry.opacity, .24)
            entry.depthWrite = false
          } else if (saved) {
            entry.transparent = saved.transparent
            entry.opacity = saved.opacity
            entry.depthWrite = saved.depthWrite
            delete entry.userData.playerOcclusionOriginal
          }
          entry.needsUpdate = true
        })
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
      dragging = true; moved = false; pointerStart.set(event.clientX, event.clientY)
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.classList.add('is-grabbing')
    }
    const onPointerMove = (event: PointerEvent) => {
      if (dragging) {
        // Never raycast while surveying the map. Pointermove may fire faster
        // than the display refresh rate, and selection cannot occur mid-drag.
        renderer.domElement.style.cursor = 'grabbing'
        const dx = event.clientX - pointerStart.x
        const dy = event.clientY - pointerStart.y
        if (Math.hypot(dx, dy) > 4) moved = true
        targetYaw = THREE.MathUtils.clamp(targetYaw + dx * .0015, -.34, .34)
        targetPitch = THREE.MathUtils.clamp(targetPitch + dy * .0009, -.08, .11)
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
      renderer.domElement.style.cursor = root ? 'pointer' : 'grab'
    }
    const onPointerUp = (event: PointerEvent) => {
      dragging = false
      renderer.domElement.classList.remove('is-grabbing')
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
      if (moved) return
      const root = hitSelection(event)
      const selection = root?.userData.mapSelection as { key: string; locked: boolean } | undefined
      if (!selection) return
      selectRef.current(selection.key)
      lastSelectedKey = selection.key
      const anchor = travelAnchors.get(selection.key) ?? anchors.get(selection.key)
      if (anchor && !selection.locked) {
        const target = anchor.clone().setY(.12)
        const curve = walkingCurve(lawyer.position.clone(), target)
        walking = {
          curve,
          started: performance.now(),
          duration: THREE.MathUtils.clamp(curve.getLength() * 260, 1200, 6200),
          lastProgress: 0,
        }
        cameraMode = 'counsel'
        zoom = 1
      }
    }
    const onPointerLeave = () => {
      dragging = false
      renderer.domElement.classList.remove('is-grabbing')
      if (hoveredRoot) hoveredRoot.scale.multiplyScalar(1 / 1.025)
      if (hoveredRoot) hoveredRoot.traverse((object) => { if (object.userData.destinationMarker) object.userData.destinationHover = false })
      hoveredRoot = null
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoom = THREE.MathUtils.clamp(zoom * (event.deltaY > 0 ? 1.08 : .92), .64, 1.32)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
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
        if (command.action === 'in') zoom = Math.max(.64, zoom * .84)
        else if (command.action === 'out') zoom = Math.min(1.26, zoom * 1.14)
        else if (command.action === 'focus') { cameraMode = 'counsel'; zoom = 1; targetYaw = 0; targetPitch = 0 }
        else { cameraMode = 'overview'; zoom = 1; targetYaw = 0; targetPitch = 0 }
      }
      if (selectedRef.current !== lastSelectedKey) {
        lastSelectedKey = selectedRef.current
        const selectedPoint = points.find((point) => point.key === lastSelectedKey)
        const locked = selectedPoint?.kind === 'tier' ? selectedPoint.state === 'locked' : selectedPoint?.locked
        const selectedAnchor = travelAnchors.get(lastSelectedKey) ?? anchors.get(lastSelectedKey)
        if (selectedAnchor && !locked) {
          const target = selectedAnchor.clone().setY(.12)
          const curve = walkingCurve(lawyer.position.clone(), target)
          walking = { curve, started: performance.now(), duration: THREE.MathUtils.clamp(curve.getLength() * 260, 1200, 6200), lastProgress: 0 }
          cameraMode = 'counsel'
          zoom = 1
        }
      }
      const desiredTarget = cameraMode === 'counsel'
        ? frameTarget.set(lawyer.position.x, region === 'orbit' ? 1.35 : 1.15, lawyer.position.z)
        : overviewTarget
      cameraTarget.lerp(desiredTarget, cameraMode === 'counsel' ? (walking ? .055 : .035) : .08)
      const desiredCamera = frameCamera.copy(cameraMode === 'counsel' ? counselOffset : cameraOffset).multiplyScalar(zoom * frameScale)
      desiredCamera.applyAxisAngle(frameAxisY, targetYaw)
      desiredCamera.y += targetPitch * 18
      desiredCamera.add(cameraTarget)
      camera.position.lerp(desiredCamera, .055)
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
        const t = (elapsed * transport.speed + transport.offset) % 1
        transport.curve.getPointAt(t, transportPosition)
        transport.curve.getTangentAt(t, transportTangent)
        transport.object.position.copy(transportPosition)
        transport.object.position.y += region === 'ocean' && transport.object === regionalTransport ? .25 : .12
        // Vehicles, trains, ferries, and craft are modeled on local +X.
        // Aligning them as if they faced +Z made traffic slide sideways.
        transport.object.rotation.y = -Math.atan2(transportTangent.z, transportTangent.x)
      })
      let locomotion = 0
      let arrival = 1
      if (walking) {
        const progress = THREE.MathUtils.clamp((performance.now() - walking.started) / walking.duration, 0, 1)
        const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
        walking.curve.getPointAt(eased, walkPosition)
        walking.curve.getTangentAt(Math.min(.999, Math.max(.001, eased)), walkTangent).normalize()
        const travelDelta = Math.hypot(walkPosition.x - lawyer.position.x, walkPosition.z - lawyer.position.z)
        gaitPhase += travelDelta * 5.4
        lawyer.position.copy(walkPosition)
        const desiredHeading = Math.atan2(walkTangent.x, walkTangent.z)
        lawyer.rotation.y = THREE.MathUtils.damp(lawyer.rotation.y, desiredHeading, progress < .08 ? 5.2 : 10.5, delta)
        const rampIn = THREE.MathUtils.smoothstep(progress, 0, .1)
        const rampOut = 1 - THREE.MathUtils.smoothstep(progress, .82, 1)
        locomotion = rampIn * rampOut
        arrival = 1 - locomotion
        walking.lastProgress = progress
        if (progress >= 1) walking = null
      }
      if (transitCarrier) {
        if (walking) {
          transitCarrier.visible = true
          transitCarrier.position.set(lawyer.position.x, lawyer.position.y - .03, lawyer.position.z)
          transitCarrier.rotation.y = lawyer.rotation.y - Math.PI / 2
          lawyer.position.y += region === 'ocean' ? .92 : .72
        } else {
          transitCarrier.visible = false
          lawyer.position.y = .12
        }
      }
      const articulatedLocomotion = transitCarrier ? 0 : locomotion
      animateLawyerRig(lawyerModel.rig, elapsed, articulatedLocomotion, transitCarrier ? 1 : arrival, gaitPhase)
      animatedObjects.forEach((object) => {
        if (object.userData.cloud) {
          object.position.x += object.userData.speed * delta
          if (object.position.x > object.userData.cloudWrapMax) object.position.x = object.userData.cloudWrapMin
          object.position.y = object.userData.cloudBaseY + Math.sin(elapsed * .09 + object.userData.cloudPhase) * .18
          object.position.z = object.userData.cloudBaseZ + Math.sin(elapsed * .055 + object.userData.cloudPhase) * .55
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
      const selectedAnchor = anchors.get(selectedRef.current)
      selectionRing.visible = Boolean(selectedAnchor)
      if (selectedAnchor) {
        selectionRing.position.x = selectedAnchor.x
        selectionRing.position.z = selectedAnchor.z
        selectionRing.scale.setScalar(1 + Math.sin(elapsed * 2.2) * .07)
        ;(selectionRing.material as THREE.MeshBasicMaterial).opacity = .58 + Math.sin(elapsed * 2.2) * .18
      }
      renderer.render(scene, camera)
      if (!disposed && surfaceVisible && !document.hidden) animationFrame = requestAnimationFrame(animate)
    }
    updatePerformanceCulling()
    const surfaceObserver = new IntersectionObserver(([entry]) => {
      surfaceVisible = Boolean(entry?.isIntersecting)
      if (!surfaceVisible && animationFrame) {
        cancelAnimationFrame(animationFrame)
        animationFrame = 0
      } else if (surfaceVisible && !document.hidden && !animationFrame) {
        previousFrame = performance.now()
        animationFrame = requestAnimationFrame(animate)
      }
    }, { rootMargin: '80px' })
    surfaceObserver.observe(host)
    const onVisibilityChange = () => {
      if (document.hidden && animationFrame) {
        cancelAnimationFrame(animationFrame)
        animationFrame = 0
      } else if (!document.hidden && surfaceVisible && !animationFrame) {
        previousFrame = performance.now()
        animationFrame = requestAnimationFrame(animate)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    animationFrame = requestAnimationFrame(animate)

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      fadedOccluders.forEach((root) => setOccluderFade(root, false))
      resizeObserver.disconnect()
      surfaceObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('wheel', onWheel)
      disposeScene(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement)
    }
  }, [activity, playerGender, playerName, playerTier, points, region])

  const style = { '--arc-accent': `#${ARC[region].accent.toString(16).padStart(6, '0')}` } as CSSProperties
  return (
    <div className={`uw-three-scene uw-three-scene-${region}`} ref={hostRef} style={style}>
      <div className="uw-three-loading" aria-hidden="true"><i /><span>Building {ARC[region].title}</span></div>
    </div>
  )
}
