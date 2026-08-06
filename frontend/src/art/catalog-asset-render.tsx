import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

import type { GameAsset } from '../types'
import { IllustratedRenderPass } from './render-style'

type RenderAsset = Pick<GameAsset, 'art' | 'key' | 'name' | 'tier' | 'type'>

const WIDTH = 640
const HEIGHT = 384
const renderCache = new Map<string, string>()
const pendingRenders = new Map<string, Promise<string>>()
let renderQueue: Promise<unknown> = Promise.resolve()
let sharedRenderer: THREE.WebGLRenderer | null = null
let sharedStylePass: IllustratedRenderPass | null = null

const palettes = [
  { wall: 0x231a18, floor: 0x2c201b, wood: 0x6f4933, brass: 0xc29a52, steel: 0x27333c, glow: 0x73c6bb },
  { wall: 0x1b2530, floor: 0x24211f, wood: 0x654331, brass: 0xd0aa61, steel: 0x263945, glow: 0x74cbbb },
  { wall: 0x182b32, floor: 0x23272a, wood: 0x584239, brass: 0xd2b56e, steel: 0x243b47, glow: 0x65c8c0 },
  { wall: 0x151e2a, floor: 0x20242a, wood: 0x4d3a34, brass: 0xd7bd7a, steel: 0x203746, glow: 0x73d6cf },
]

function renderer() {
  if (sharedRenderer) return sharedRenderer
  const canvas = document.createElement('canvas')
  const next = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true })
  next.setSize(WIDTH, HEIGHT, false)
  // These thumbnails are captured once and cached as data URLs, then displayed
  // in cards roughly as wide as WIDTH itself. Capturing at 1x meant every card
  // was an upscale on a retina display.
  next.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  next.outputColorSpace = THREE.SRGBColorSpace
  next.toneMapping = THREE.ACESFilmicToneMapping
  next.toneMappingExposure = 1.16
  next.shadowMap.enabled = true
  next.shadowMap.type = THREE.PCFShadowMap
  sharedRenderer = next
  return next
}

/**
 * The thumbnails have to carry the same contours as the rooms they depict,
 * because they sit in the catalog directly beside the office they are previews
 * of. One pass is enough: the renderer is shared and fixed at WIDTH x HEIGHT,
 * so the target never resizes.
 */
function stylePass() {
  if (sharedStylePass) return sharedStylePass
  sharedStylePass = new IllustratedRenderPass(renderer(), {
    exposure: 1.16,
    inkStrength: .72,
    normalEdge: .9,
    bands: 10,
    flatten: .34,
    saturation: 1.18,
  })
  return sharedStylePass
}

function material(color: number, roughness = .5, metalness = .08, emissive = 0, emissiveIntensity = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity })
}

function add(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function box(parent: THREE.Object3D, size: [number, number, number], mat: THREE.Material, position: [number, number, number], rotation?: [number, number, number], radius = .06) {
  return add(parent, new RoundedBoxGeometry(...size, 4, Math.min(radius, ...size) * .45), mat, position, rotation)
}

function addRoom(scene: THREE.Scene, asset: RenderAsset, p: typeof palettes[number]) {
  const room = new THREE.Group()
  scene.add(room)
  const wall = material(p.wall, .82)
  const darkWood = material(p.wood, .66)
  const trim = material(p.brass, .28, .76)
  add(room, new THREE.PlaneGeometry(14, 8), wall, [0, 3.25, -3.15])
  add(room, new THREE.PlaneGeometry(14, 8), material(p.floor, .72), [0, 0, .15], [-Math.PI / 2, 0, 0])
  box(room, [14, .15, .18], darkWood, [0, 1.08, -3.02])
  box(room, [14, .16, .2], trim, [0, 5.85, -3.01])
  for (const x of [-5.8, -2.9, 0, 2.9, 5.8]) box(room, [.1, 4.55, .12], asset.tier >= 8 ? trim : darkWood, [x, 3.4, -2.98])
  for (let i = 0; i < 4; i += 1) {
    const step = add(room, new THREE.PlaneGeometry(3.4 + i * .72, 1.4 + i * .28), material(i % 2 ? p.wall : p.steel, .9), [0, 1.28 + i * .4, -3.08 + i * .006])
    step.castShadow = false
  }
  const floorGlow = add(room, new THREE.CircleGeometry(3.2, 56), material(p.glow, .7, .1, p.glow, .12), [0, .012, .15], [-Math.PI / 2, 0, 0])
  floorGlow.scale.y = .42
  return room
}

function addDesk(group: THREE.Object3D, p: typeof palettes[number], executive = false) {
  const wood = material(p.wood, .38, .05)
  const brass = material(p.brass, .24, .8)
  const leather = material(executive ? 0x263f48 : 0x3c3430, .62)
  box(group, [4.5, .26, 1.65], wood, [0, 1.35, .25], undefined, .12)
  box(group, [4.15, 1.16, 1.35], material(0x251d1b, .58), [0, .68, .25], undefined, .08)
  box(group, [1.18, .65, .05], leather, [0, .72, 1.0], undefined, .03)
  for (const x of [-1.76, 1.76]) box(group, [.12, .82, 1.2], brass, [x, .7, .25], undefined, .025)
  if (executive) {
    box(group, [1.18, .28, 1.02], leather, [0, .62, 2.05], undefined, .15)
    box(group, [1.2, 1.35, .28], leather, [0, 1.28, 2.38], [-.08, 0, 0], .14)
  }
}

function addLamp(group: THREE.Object3D, p: typeof palettes[number]) {
  const brass = material(p.brass, .2, .82)
  add(group, new THREE.CylinderGeometry(.28, .35, .12, 28), brass, [.7, 1.55, .12])
  add(group, new THREE.CylinderGeometry(.035, .045, 1.25, 16), brass, [.7, 2.12, .12], [0, 0, -.18])
  add(group, new THREE.ConeGeometry(.45, .5, 30, 1, true), material(0x1d2a33, .3, .52), [.58, 2.73, .12], [0, 0, Math.PI])
  const light = new THREE.PointLight(0xffc878, 3.4, 5.5, 1.5)
  light.position.set(.58, 2.42, .42)
  group.add(light)
}

function addScreen(group: THREE.Object3D, p: typeof palettes[number], count = 1) {
  const frame = material(0x14212a, .25, .58)
  const display = material(0x183c45, .22, .22, p.glow, .72)
  for (let i = 0; i < count; i += 1) {
    const x = (i - (count - 1) / 2) * 1.42
    box(group, [1.28, .82, .1], frame, [x, 2.05 + Math.abs(x) * .04, .2], [0, x * -.05, 0], .05)
    box(group, [1.12, .66, .02], display, [x, 2.05 + Math.abs(x) * .04, .258], [0, x * -.05, 0], .02)
    for (let bar = 0; bar < 4; bar += 1) box(group, [.18 + ((bar + i) % 3) * .13, .028, .012], material(bar % 2 ? p.brass : p.glow, .2, .25, bar % 2 ? 0 : p.glow, .3), [x - .36 + bar * .22, 1.83 + bar * .12, .28], undefined, .008)
  }
}

function addLibrary(group: THREE.Object3D, p: typeof palettes[number], vault = false) {
  const wood = material(vault ? 0x222a31 : p.wood, vault ? .34 : .58, vault ? .62 : .06)
  const paper = [0x7f4e3d, 0x31505a, 0x9a7540, 0x455946, 0x5f4052]
  for (const x of [-1.85, 0, 1.85]) {
    box(group, [1.62, 3.65, .5], material(0x17191c, .75), [x, 2.08, -.58], undefined, .04)
    for (let row = 0; row < 4; row += 1) {
      box(group, [1.66, .1, .68], wood, [x, .55 + row * .92, -.37], undefined, .02)
      for (let col = 0; col < 7; col += 1) {
        const h = .44 + ((col + row * 3) % 4) * .07
        box(group, [.13, h, .32], material(paper[(col + row) % paper.length], .76), [x - .57 + col * .19, .84 + row * .92, -.28], [0, 0, ((col + row) % 3 - 1) * .025], .015)
      }
    }
  }
  if (vault) add(group, new THREE.TorusGeometry(.72, .11, 20, 64), material(p.brass, .18, .9), [0, 2.08, -.04])
}

function addConference(group: THREE.Object3D, p: typeof palettes[number], holographic = false) {
  const table = material(p.wood, .34, .08)
  add(group, new THREE.CylinderGeometry(2.45, 2.25, .22, 56), table, [0, 1.05, .35])
  add(group, new THREE.CylinderGeometry(.52, .72, 1.0, 32), material(0x20262b, .4, .45), [0, .5, .35])
  for (let i = 0; i < 7; i += 1) {
    const a = i / 7 * Math.PI * 2
    const x = Math.cos(a) * 3.0
    const z = .35 + Math.sin(a) * 1.75
    box(group, [.72, .23, .66], material(0x263b43, .55), [x, .62, z], [0, -a + Math.PI / 2, 0], .12)
    box(group, [.7, .88, .18], material(0x263b43, .55), [x * 1.03, 1.05, z + Math.sin(a) * .13], [0, -a + Math.PI / 2, 0], .1)
  }
  if (holographic) addGlobe(group, p, 1.35, [0, 2.05, .35])
  else {
    box(group, [1.85, .05, 1.05], material(0xd7cab0, .9), [0, 1.2, .35], [0, .16, 0], .02)
    box(group, [.94, .035, .62], material(0xaebcad, .9), [.18, 1.24, .4], [0, -.2, 0], .015)
  }
}

function addGlobe(group: THREE.Object3D, p: typeof palettes[number], radius = 1.18, position: [number, number, number] = [0, 1.75, .2]) {
  const globe = new THREE.Group()
  globe.position.set(...position)
  group.add(globe)
  add(globe, new THREE.SphereGeometry(radius, 48, 32), material(0x245966, .28, .25, p.glow, .25), [0, 0, 0])
  for (let ring = 0; ring < 3; ring += 1) add(globe, new THREE.TorusGeometry(radius * (1.08 + ring * .08), .018, 12, 72), material(ring === 1 ? p.brass : p.glow, .18, .75, ring === 1 ? 0 : p.glow, .5), [0, 0, 0], [Math.PI / 2 + ring * .42, ring * .58, 0])
  for (let i = 0; i < 9; i += 1) {
    const a = i / 9 * Math.PI * 2
    add(globe, new THREE.SphereGeometry(.055, 14, 10), material(p.brass, .2, .65, p.brass, .3), [Math.cos(a) * radius * .8, Math.sin(a * 2) * radius * .44, Math.sin(a) * radius * .8])
  }
}

function addScales(group: THREE.Object3D, p: typeof palettes[number]) {
  const brass = material(p.brass, .18, .9)
  add(group, new THREE.CylinderGeometry(.62, .78, .18, 40), brass, [0, .12, .2])
  add(group, new THREE.CylinderGeometry(.09, .15, 3.3, 24), brass, [0, 1.82, .2])
  box(group, [3.8, .12, .12], brass, [0, 3.05, .2], undefined, .04)
  for (const x of [-1.62, 1.62]) {
    for (const dx of [-.42, .42]) add(group, new THREE.CylinderGeometry(.012, .012, 1.18, 8), brass, [x + dx * .5, 2.46, .2], [0, 0, dx > 0 ? -.34 : .34])
    add(group, new THREE.SphereGeometry(.53, 32, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), brass, [x, 1.88, .2], [Math.PI, 0, 0])
  }
}

function addOperations(group: THREE.Object3D, p: typeof palettes[number], future = false) {
  const frame = material(future ? 0x263943 : 0x18242d, .27, .65)
  for (let panel = 0; panel < 4; panel += 1) {
    const x = -2.35 + panel * 1.56
    box(group, [1.4, 1.28, .12], frame, [x, 2.65, -.48], [0, (x / 2.35) * -.04, 0], .05)
    box(group, [1.2, 1.08, .025], material(0x163640, .2, .28, p.glow, .65), [x, 2.65, -.41], [0, (x / 2.35) * -.04, 0], .02)
    for (let row = 0; row < 5; row += 1) box(group, [.32 + ((row + panel) % 3) * .18, .025, .012], material(row % 2 ? p.brass : p.glow, .22, .42, row % 2 ? 0 : p.glow, .35), [x - .38 + (row % 2) * .22, 2.3 + row * .17, -.385], undefined, .006)
  }
  add(group, new THREE.CylinderGeometry(2.25, 1.9, .32, 8), frame, [0, .95, .4])
  add(group, new THREE.CylinderGeometry(1.72, 1.72, .035, 48), material(p.glow, .2, .38, p.glow, .8), [0, 1.14, .4])
  if (future) addGlobe(group, p, .72, [0, 1.86, .4])
}

function addMedia(group: THREE.Object3D, p: typeof palettes[number]) {
  for (const x of [-1.4, 1.4]) {
    add(group, new THREE.CylinderGeometry(.055, .075, 2.4, 14), material(0x222a2e, .35, .68), [x, 1.2, .35])
    box(group, [.85, .58, .72], material(0x202a31, .28, .62), [x, 2.4, .35], [0, x * -.08, 0], .09)
    add(group, new THREE.CylinderGeometry(.25, .32, .42, 28), material(0x11181d, .2, .78), [x, 2.4, .78], [Math.PI / 2, 0, 0])
    add(group, new THREE.CircleGeometry(.21, 28), material(p.glow, .2, .42, p.glow, .65), [x, 2.4, 1.0])
  }
  addConference(group, p, false)
}

function addVehicle(group: THREE.Object3D, p: typeof palettes[number], orbital = false) {
  const hull = material(orbital ? 0xd1d7d5 : 0x344b56, .24, .72)
  const body = add(group, new THREE.CapsuleGeometry(.58, 3.2, 12, 28), hull, [0, 1.65, .1], [0, 0, Math.PI / 2])
  body.scale.z = .62
  for (const x of [-.55, .15, .85]) box(group, [.28, .25, .04], material(p.glow, .16, .34, p.glow, .8), [x, 1.82, .68], [0, 0, .05], .05)
  add(group, new THREE.ConeGeometry(.78, 1.15, 24), hull, [2.05, 1.65, .1], [0, 0, -Math.PI / 2])
  for (const z of [-.65, .65]) box(group, [1.65, .07, .85], material(p.brass, .26, .76), [-.35, 1.5, z], [0, orbital ? .14 : -.1, 0], .025)
  if (orbital) for (let ring = 0; ring < 2; ring += 1) add(group, new THREE.TorusGeometry(2.45 + ring * .38, .035, 12, 80), material(ring ? p.brass : p.glow, .18, .78, ring ? 0 : p.glow, .5), [0, 1.65, .1], [Math.PI / 2 + ring * .34, 0, 0])
}

function addCampus(group: THREE.Object3D, p: typeof palettes[number], ocean = false) {
  const stone = material(0x3b4d53, .46, .28)
  if (ocean) add(group, new THREE.CylinderGeometry(3.4, 3.75, .32, 64), material(0x284e59, .28, .48), [0, .18, .15])
  for (let i = 0; i < 7; i += 1) {
    const a = i / 7 * Math.PI * 2
    const h = 1.2 + (i % 3) * .52
    box(group, [.82, h, .82], stone, [Math.cos(a) * 2.05, .35 + h / 2, .15 + Math.sin(a) * 1.35], [0, -a, 0], .08)
    for (let row = 0; row < Math.floor(h / .38); row += 1) box(group, [.58, .08, .025], material(p.glow, .2, .35, p.glow, .55), [Math.cos(a) * 2.05, .65 + row * .38, .58 + Math.sin(a) * 1.35], [0, -a, 0], .01)
  }
  addGlobe(group, p, .62, [0, 2.0, .15])
}

/* ------------------------------------------------ rival headquarters */

/* Rivals were the last catalog type still served by the old flat raster set in
   /public/art/site, which is why they read as a different game beside every
   other card. They are exteriors rather than interiors, so they cannot reuse
   `addRoom` — but everything that actually carries the house style is the
   renderer itself: the same palettes, the same key/rim/warm lighting rig, the
   same ACES exposure and the same camera. `addStreet` is the exterior
   counterpart to `addRoom`, and each architecture family below is a real
   massing rather than a tinted box, so a gothic chamber and an orbital ring
   are told apart by their silhouette instead of by a CSS class. */

function addStreet(scene: THREE.Scene, p: typeof palettes[number], water = false) {
  const street = new THREE.Group()
  scene.add(street)
  const ground = add(street, new THREE.PlaneGeometry(46, 34), material(water ? 0x16323d : p.floor, water ? .22 : .88, water ? .32 : .04), [0, 0, 2], [-Math.PI / 2, 0, 0])
  ground.castShadow = false
  if (!water) {
    const apron = add(street, new THREE.PlaneGeometry(15, 4.4), material(0x2a3037, .8), [0, .012, 4.4], [-Math.PI / 2, 0, 0])
    apron.castShadow = false
    for (let slab = 0; slab < 7; slab += 1) box(street, [1.9, .07, 4.2], material(slab % 2 ? 0x333a41 : 0x2d343a, .84), [-5.7 + slab * 1.9, .03, 4.4], undefined, .01)
  }
  // A silhouetted party wall on either flank stops the subject reading as a
  // model on a turntable and gives the massing something to be scaled against.
  for (const side of [-1, 1]) {
    for (let neighbour = 0; neighbour < 3; neighbour += 1) {
      const height = 2.6 + ((neighbour * 5 + (side > 0 ? 2 : 0)) % 4) * 1.15
      box(street, [2.5, height, 3.2], material(0x1a2027, .92), [side * (6.4 + neighbour * 2.55), height / 2, -2.2 - neighbour * .5], [0, side * .04 * neighbour, 0], .04)
    }
  }
  return street
}

function litBand(group: THREE.Object3D, p: typeof palettes[number], width: number, y: number, z: number, count: number, intensity = .7) {
  const glass = material(0x14313a, .2, .3, p.glow, intensity)
  for (let bay = 0; bay < count; bay += 1) {
    const x = (bay - (count - 1) / 2) * (width / Math.max(1, count))
    const pane = box(group, [width / count * .58, .34, .05], glass, [x, y, z], undefined, .015)
    pane.castShadow = false
  }
}

function addSignage(group: THREE.Object3D, p: typeof palettes[number], y: number, z: number, neon = false) {
  const plate = material(neon ? 0x4a1c46 : 0x1a2128, .3, .6, neon ? 0xc85cb5 : p.brass, neon ? 1.1 : .22)
  box(group, [3.1, .62, .16], plate, [0, y, z], undefined, .05)
  for (let glyph = 0; glyph < 5; glyph += 1) {
    const bar = box(group, [.26, .3, .05], material(neon ? 0x69e1d4 : p.brass, .22, .74, neon ? 0x69e1d4 : p.brass, neon ? 1.4 : .4), [-1.02 + glyph * .51, y, z + .1], undefined, .01)
    bar.castShadow = false
  }
}

function addRivalHeadquarters(group: THREE.Object3D, architecture: string, tier: number, p: typeof palettes[number]) {
  const stone = material(0x6d6a60, .78, .04)
  const paleStone = material(0x9d9789, .7, .03)
  const brick = material(0x6d3f34, .88, .02)
  const slate = material(0x2c3238, .74, .12)
  const steel = material(p.steel, .34, .72)
  const brass = material(p.brass, .26, .82)
  const glass = material(0x2a5f6e, .16, .42, p.glow, .34)

  if (architecture === 'brick-house') {
    box(group, [6.2, 3.5, 4.2], brick, [0, 1.75, 0], undefined, .06)
    add(group, new THREE.ConeGeometry(4.6, 2.1, 4), slate, [0, 4.6, 0], [0, Math.PI / 4, 0])
    box(group, [.8, 1.5, .8], brick, [1.9, 4.6, -.7], undefined, .04)
    box(group, [1.4, 2.1, .22], material(0x3a2b22, .7), [0, 1.05, 2.2], undefined, .04)
    add(group, new THREE.SphereGeometry(.09, 12, 8), brass, [.45, 1.05, 2.36])
    litBand(group, p, 4.6, 2.5, 2.16, 3, .55)
    litBand(group, p, 4.6, 1.3, 2.16, 2, .35)
    for (const side of [-1, 1]) add(group, new THREE.SphereGeometry(.5, 18, 12), material(0x35543f, .92), [side * 2.5, .5, 2.7]).scale.set(1, .8, 1)
    return
  }

  if (architecture === 'art-deco') {
    for (let setback = 0; setback < 4; setback += 1) {
      const width = 6.4 - setback * 1.25
      const height = 2.5 - setback * .28
      box(group, [width, height, width * .62], paleStone, [0, 1.25 + setback * 2.3, 0], undefined, .05)
      for (let pier = 0; pier < 5; pier += 1) box(group, [.2, height * .92, .16], brass, [(pier - 2) * (width / 5.4), 1.25 + setback * 2.3, width * .32], undefined, .02)
      litBand(group, p, width * .78, 1.25 + setback * 2.3, width * .315, 4 - setback, .62)
    }
    add(group, new THREE.ConeGeometry(.62, 2.4, 12), brass, [0, 10.6, 0])
    addSignage(group, p, .9, 2.1)
    return
  }

  if (architecture === 'northstar') {
    box(group, [5.6, 7.4, 4.0], paleStone, [0, 3.7, 0], undefined, .06)
    box(group, [6.6, .3, 1.8], brass, [0, 2.5, 2.4], undefined, .05)
    for (const x of [-2.6, 2.6]) add(group, new THREE.CylinderGeometry(.09, .09, 2.4, 12), brass, [x, 1.2, 2.4])
    for (let floor = 0; floor < 5; floor += 1) litBand(group, p, 4.8, 1.9 + floor * 1.28, 2.02, 4, .68)
    const star = add(group, new THREE.OctahedronGeometry(.7), material(p.brass, .2, .88, p.brass, .8), [0, 8.4, 0])
    star.scale.set(1, 1.5, 1)
    return
  }

  if (architecture === 'mega-tower') {
    box(group, [4.4, 13.5, 3.6], material(0x1e3038, .18, .5), [0, 6.75, 0], undefined, .08)
    for (let floor = 0; floor < 11; floor += 1) litBand(group, p, 4.0, 1.3 + floor * 1.18, 1.84, 5, floor % 3 ? .8 : .35)
    for (const x of [-2.24, 2.24]) box(group, [.16, 13.5, 3.7], steel, [x, 6.75, 0], undefined, .02)
    box(group, [5.4, .5, 4.6], steel, [0, 13.7, 0], undefined, .06)
    add(group, new THREE.CylinderGeometry(.05, .12, 3.2, 10), steel, [0, 15.5, 0])
    const beacon = add(group, new THREE.SphereGeometry(.18, 14, 10), material(0xd35347, .3, .2, 0xd35347, 2.2), [0, 17.1, 0])
    beacon.castShadow = false
    box(group, [7.2, 1.0, 1.2], material(0x16222a, .3, .55), [0, .5, 2.6], undefined, .1)
    return
  }

  if (architecture === 'gothic') {
    const darkStone = material(0x4b4452, .82, .03)
    box(group, [6.0, 5.6, 4.2], darkStone, [0, 2.8, 0], undefined, .04)
    for (const x of [-3.1, 3.1]) {
      box(group, [.9, 7.2, .9], darkStone, [x, 3.6, 1.4], undefined, .03)
      add(group, new THREE.ConeGeometry(.78, 2.6, 8), material(0x3a3243, .7), [x, 8.5, 1.4])
      // Flying buttresses are what make a chamber read as gothic rather than
      // as a dark tower, so they get real angled members instead of a stripe.
      box(group, [.28, 3.4, .3], darkStone, [x * .84, 3.2, -1.5], [0, 0, x > 0 ? -.42 : .42], .03)
    }
    add(group, new THREE.ConeGeometry(3.9, 3.4, 3), material(0x35303f, .72), [0, 7.3, 0], [0, Math.PI / 6, 0])
    for (let lancet = 0; lancet < 4; lancet += 1) {
      const x = -2.0 + lancet * 1.33
      const pane = box(group, [.62, 2.3, .06], material(0x53306a, .28, .2, 0xa068c8, .85), [x, 3.1, 2.14], undefined, .3)
      pane.castShadow = false
      add(group, new THREE.ConeGeometry(.34, .8, 3), darkStone, [x, 4.5, 2.12])
    }
    const rose = add(group, new THREE.CircleGeometry(.95, 24), material(0x6b3a58, .3, .18, 0xc06898, .9), [0, 5.4, 2.16])
    rose.castShadow = false
    add(group, new THREE.TorusGeometry(.97, .11, 10, 26), darkStone, [0, 5.4, 2.16])
    return
  }

  if (architecture === 'neon') {
    box(group, [6.4, 6.2, 4.0], material(0x3d2447, .58, .18), [0, 3.1, 0], undefined, .07)
    for (let strip = 0; strip < 4; strip += 1) {
      const band = box(group, [6.5, .16, 4.1], material(0xc85cb5, .2, .4, 0xc85cb5, 1.6), [0, 1.5 + strip * 1.45, 0], undefined, .02)
      band.castShadow = false
    }
    for (let floor = 0; floor < 4; floor += 1) litBand(group, p, 5.4, 2.15 + floor * 1.45, 2.04, 5, 1.1)
    for (const x of [-3.5, 3.5]) {
      add(group, new THREE.CylinderGeometry(.11, .11, 8.2, 10), material(0x69e1d4, .2, .5, 0x69e1d4, 1.5), [x, 4.1, 1.6])
    }
    addSignage(group, p, 7.1, 1.9, true)
    const spill = new THREE.PointLight(0xc85cb5, 12, 14, 1.8)
    spill.position.set(0, 4.4, 4.2)
    group.add(spill)
    return
  }

  if (architecture === 'glass-arc') {
    const arc = add(group, new THREE.TorusGeometry(4.6, 1.05, 18, 44, Math.PI), material(0x2f6f80, .14, .46, p.glow, .38), [0, .2, 0], [0, 0, 0])
    arc.scale.set(1, 1.15, .62)
    for (let mullion = 0; mullion < 11; mullion += 1) {
      const a = mullion / 10 * Math.PI
      add(group, new THREE.CylinderGeometry(.075, .075, 2.6, 8), steel, [Math.cos(a) * 4.6, .2 + Math.sin(a) * 5.3, 0], [Math.PI / 2, 0, 0])
    }
    add(group, new THREE.TorusGeometry(4.6, .12, 10, 48, Math.PI), steel, [0, .2, .68])
    add(group, new THREE.TorusGeometry(4.6, .12, 10, 48, Math.PI), steel, [0, .2, -.68])
    box(group, [8.4, 1.6, 3.2], paleStone, [0, .8, 0], undefined, .08)
    litBand(group, p, 7.0, 1.0, 1.66, 7, .7)
    return
  }

  if (architecture === 'command') {
    box(group, [8.6, 2.6, 5.4], material(0x3d2f31, .74, .18), [0, 1.3, 0], undefined, .1)
    box(group, [6.2, 2.0, 4.2], material(0x4c3a3a, .68, .22), [0, 3.6, 0], undefined, .12)
    box(group, [3.4, 1.4, 3.0], steel, [0, 5.3, 0], undefined, .14)
    litBand(group, p, 5.4, 3.6, 2.14, 5, 1.0)
    for (const side of [-1, 1]) {
      const dish = add(group, new THREE.SphereGeometry(1.05, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), material(0xb9bcb4, .42, .38), [side * 2.9, 4.9, -.6], [side * .5, 0, side * -.6])
      dish.scale.y = .5
      add(group, new THREE.CylinderGeometry(.07, .07, 1.3, 8), steel, [side * 2.9, 4.4, -.6])
    }
    add(group, new THREE.CylinderGeometry(.06, .1, 4.2, 8), steel, [0, 8.1, 0])
    for (let ring = 0; ring < 3; ring += 1) add(group, new THREE.TorusGeometry(.3 + ring * .16, .035, 8, 20), material(0xd35347, .3, .4, 0xd35347, 1.4), [0, 7.2 + ring * .7, 0], [Math.PI / 2, 0, 0])
    return
  }

  if (architecture === 'citadel') {
    box(group, [8.0, 4.6, 5.2], stone, [0, 2.3, 0], undefined, .05)
    for (const x of [-4.2, 4.2]) {
      add(group, new THREE.CylinderGeometry(1.15, 1.35, 7.2, 12), stone, [x, 3.6, 0])
      add(group, new THREE.ConeGeometry(1.4, 1.6, 12), material(0x7d6338, .6, .3), [x, 8.0, 0])
      for (let merlon = 0; merlon < 8; merlon += 1) {
        const a = merlon / 8 * Math.PI * 2
        box(group, [.3, .5, .3], stone, [x + Math.cos(a) * 1.1, 7.4, Math.sin(a) * 1.1], [0, -a, 0], .02)
      }
    }
    for (let merlon = 0; merlon < 9; merlon += 1) box(group, [.5, .6, 5.3], stone, [-3.2 + merlon * .8, 4.9, 0], undefined, .03)
    box(group, [2.0, 3.0, .3], material(0x2f2820, .72), [0, 1.5, 2.62], undefined, .5)
    add(group, new THREE.CylinderGeometry(.05, .05, 3.0, 8), brass, [0, 6.3, 1.4])
    const flag = box(group, [1.5, .9, .04], material(p.brass, .5, .3, p.brass, .3), [.78, 7.3, 1.4], undefined, .01)
    flag.castShadow = false
    return
  }

  if (architecture === 'campus') {
    add(group, new THREE.CylinderGeometry(7.2, 7.4, .3, 40), material(0x2f3a34, .84), [0, .15, 0])
    for (let pavilion = 0; pavilion < 6; pavilion += 1) {
      const a = pavilion / 6 * Math.PI * 2 + .35
      const height = 2.2 + (pavilion % 3) * .95
      // Each pavilion is its own group so its glazing turns with it, rather
      // than being written straight into world space and facing the wrong way.
      const wing = new THREE.Group()
      wing.position.set(Math.cos(a) * 4.5, 0, Math.sin(a) * 3.1)
      wing.rotation.y = -a
      group.add(wing)
      box(wing, [2.3, height, 2.0], pavilion % 2 ? paleStone : material(0x466b5b, .66, .1), [0, .3 + height / 2, 0], undefined, .08)
      litBand(wing, p, 1.8, .3 + height * .55, 1.04, 3, .62)
    }
    add(group, new THREE.CylinderGeometry(2.0, 2.2, .5, 32), paleStone, [0, .5, 0])
    addGlobe(group, p, 1.35, [0, 2.5, 0])
    for (let tree = 0; tree < 5; tree += 1) {
      const a = tree / 5 * Math.PI * 2 + 1.1
      add(group, new THREE.CylinderGeometry(.12, .16, 1.1, 8), material(0x53402f, .9), [Math.cos(a) * 6.1, .85, Math.sin(a) * 4.1])
      add(group, new THREE.SphereGeometry(.95, 16, 12), material(0x35633f, .92), [Math.cos(a) * 6.1, 2.0, Math.sin(a) * 4.1]).scale.set(1, .82, 1)
    }
    return
  }

  if (architecture === 'ocean') {
    for (const x of [-3.4, 0, 3.4]) for (const z of [-1.8, 1.8]) add(group, new THREE.CylinderGeometry(.55, .55, 2.2, 14), material(0x2a3c42, .6, .3), [x, .4, z])
    box(group, [9.4, .55, 5.6], material(0x37474d, .7, .16), [0, 1.75, 0], undefined, .06)
    box(group, [5.2, 3.4, 4.0], material(0x2e6b7c, .38, .3), [-1.0, 3.7, 0], undefined, .1)
    box(group, [3.0, 1.8, 3.0], material(0x35798a, .3, .35), [-1.0, 6.3, 0], undefined, .12)
    litBand(group, p, 4.4, 3.5, 2.04, 4, .85)
    litBand(group, p, 2.4, 6.2, 1.54, 3, .95)
    add(group, new THREE.CylinderGeometry(.16, .2, 6.4, 10), material(0xb4703a, .62, .28), [3.4, 5.2, -.6])
    box(group, [4.6, .26, .3], material(0xb4703a, .62, .28), [4.9, 8.2, -.6], [0, 0, -.16], .04)
    add(group, new THREE.CylinderGeometry(.03, .03, 2.4, 6), steel, [6.6, 6.9, -.6])
    box(group, [1.0, .7, .8], material(0x2b3a40, .6, .2), [6.6, 5.5, -.6], undefined, .06)
    for (let buoy = 0; buoy < 3; buoy += 1) {
      const b = add(group, new THREE.SphereGeometry(.28, 14, 10), material(0xc4562f, .5, .12, 0xc4562f, .5), [-6.5 + buoy * 1.6, .1, 3.9 + buoy * .5])
      b.castShadow = false
    }
    return
  }

  if (architecture === 'orbital') {
    const ring = add(group, new THREE.TorusGeometry(4.2, .78, 20, 60), material(0x8d949c, .32, .68), [0, 4.6, 0], [Math.PI / 2.35, 0, 0])
    ring.scale.z = 1
    for (let spoke = 0; spoke < 6; spoke += 1) {
      const a = spoke / 6 * Math.PI * 2
      add(group, new THREE.CylinderGeometry(.14, .14, 4.2, 8), steel, [Math.cos(a) * 2.1, 4.6 - Math.sin(a) * 1.6, Math.sin(a) * 2.1], [Math.PI / 2, 0, -a + Math.PI / 2])
    }
    add(group, new THREE.CylinderGeometry(1.15, 1.15, 2.6, 20), material(0xa8aeb4, .3, .62), [0, 4.6, 0])
    for (let port = 0; port < 14; port += 1) {
      const a = port / 14 * Math.PI * 2
      const light = add(group, new THREE.SphereGeometry(.16, 10, 8), material(p.glow, .2, .3, p.glow, 1.4), [Math.cos(a) * 4.2, 4.6 - Math.sin(a) * 3.05, Math.sin(a) * 2.9])
      light.castShadow = false
    }
    for (const side of [-1, 1]) {
      const panel = box(group, [4.4, .1, 2.4], material(0x1d3c66, .26, .5, 0x2f5f9e, .5), [side * 6.6, 4.6, 0], [0, 0, side * .12], .03)
      panel.castShadow = false
      add(group, new THREE.CylinderGeometry(.09, .09, 2.4, 8), steel, [side * 4.6, 4.6, 0], [0, 0, Math.PI / 2])
    }
    add(group, new THREE.CylinderGeometry(.9, 1.4, 3.4, 16), material(0x4d545c, .5, .5), [0, 1.7, 0])
    return
  }

  if (architecture === 'lunar') {
    const regolith = add(group, new THREE.CylinderGeometry(8.5, 8.8, .5, 44), material(0x6f6a63, .95), [0, .25, 0])
    regolith.castShadow = false
    for (let crater = 0; crater < 5; crater += 1) {
      const a = crater / 5 * Math.PI * 2 + .8
      const dent = add(group, new THREE.CircleGeometry(.7 + (crater % 3) * .3, 20), material(0x5c584f, .96), [Math.cos(a) * 6.2, .51, Math.sin(a) * 4.3], [-Math.PI / 2, 0, 0])
      dent.castShadow = false
    }
    for (const [x, z, r] of [[-2.6, .4, 2.1], [1.9, -.9, 1.5], [3.4, 1.9, 1.1]] as const) {
      const dome = add(group, new THREE.SphereGeometry(r, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2), material(0xcfd4d2, .28, .24, p.glow, .16), [x, .5, z])
      dome.scale.y = .82
      add(group, new THREE.TorusGeometry(r, .1, 10, 34), steel, [x, .55, z], [Math.PI / 2, 0, 0])
      for (let port = 0; port < 6; port += 1) {
        const a = port / 6 * Math.PI * 2
        const light = add(group, new THREE.CircleGeometry(r * .17, 14), material(p.glow, .2, .3, p.glow, 1.1), [x + Math.cos(a) * r * .99, .5 + r * .42, z + Math.sin(a) * r * .99], [0, a, 0])
        light.castShadow = false
      }
    }
    add(group, new THREE.CylinderGeometry(.3, .3, 2.4, 12), steel, [-.4, 1.7, .4], [0, 0, Math.PI / 2])
    add(group, new THREE.CylinderGeometry(.04, .04, 3.6, 6), steel, [-5.4, 2.3, 2.4])
    const flag = box(group, [1.4, .85, .04], material(p.brass, .48, .3, p.brass, .35), [-4.68, 3.7, 2.4], undefined, .01)
    flag.castShadow = false
    return
  }

  // nexus, and any future rival that is a network rather than a building
  add(group, new THREE.CylinderGeometry(6.6, 6.9, .4, 46), material(0x1d2140, .6, .3), [0, .2, 0])
  const core = add(group, new THREE.IcosahedronGeometry(1.9, 1), material(0x353661, .3, .5, p.glow, .5), [0, 4.2, 0])
  core.castShadow = false
  add(group, new THREE.CylinderGeometry(.7, 1.5, 3.8, 18), material(0x2b2d55, .44, .44), [0, 2.0, 0])
  for (let node = 0; node < 7; node += 1) {
    const a = node / 7 * Math.PI * 2 + .3
    const x = Math.cos(a) * 4.6
    const z = Math.sin(a) * 3.2
    const height = 1.6 + (node % 3) * .8
    box(group, [1.0, height, 1.0], material(0x2f3160, .4, .44), [x, .4 + height / 2, z], [0, -a, 0], .1)
    const cap = add(group, new THREE.OctahedronGeometry(.42), material(p.glow, .2, .4, p.glow, 1.2), [x, .4 + height + .5, z])
    cap.castShadow = false
    // The beams are what say "network": each outpost is tied to the core, so
    // the silhouette is a constellation rather than a ring of sheds.
    const span = Math.hypot(x, z, 4.2 - (.4 + height + .5))
    const beam = add(group, new THREE.CylinderGeometry(.045, .045, span, 6), material(p.glow, .2, .3, p.glow, .8), [x / 2, (.4 + height + .5 + 4.2) / 2, z / 2])
    beam.castShadow = false
    beam.lookAt(0, 4.2, 0)
    beam.rotateX(Math.PI / 2)
  }
  for (let ring = 0; ring < 2; ring += 1) {
    const halo = add(group, new THREE.TorusGeometry(2.5 + ring * .55, .05, 10, 60), material(ring ? p.brass : p.glow, .2, .7, ring ? p.brass : p.glow, .7), [0, 4.2, 0], [Math.PI / 2 + ring * .5, ring * .7, 0])
    halo.castShadow = false
  }
  if (tier >= 14) addGlobe(group, p, .9, [0, 7.4, 0])
}

/**
 * Cosmetics are single objects rather than rooms full of systems, so each card
 * frames one prop on a plinth in the same lit interior every other card uses.
 */
function addPlinth(group: THREE.Object3D, p: typeof palettes[number], height = 1.15) {
  box(group, [2.4, height, 1.9], material(0x1d2429, .58), [0, height / 2, .2], undefined, .06)
  box(group, [2.62, .12, 2.1], material(p.brass, .28, .78), [0, height + .05, .2], undefined, .03)
  return height + .11
}

function addCosmetic(group: THREE.Object3D, asset: RenderAsset, p: typeof palettes[number]) {
  const key = asset.key
  const brass = material(p.brass, .24, .8)
  const walnut = material(p.wood, .52, .05)
  const leaf = material(0x2f5a46, .9)
  const leafLight = material(0x437a5c, .88)
  const stone = material(0xe3ded1, .36, .04)
  const glass = material(0xa5cbd6, .18, .1, p.glow, .18)

  if (key === 'bar_certificate' || key === 'skyline_painting') {
    const skyline = key === 'skyline_painting'
    box(group, [3.4, 2.55, .18], skyline ? brass : walnut, [0, 2.55, -.35], undefined, .08)
    box(group, [2.75, 1.95, .06], material(skyline ? 0xc9a877 : 0xe3d6b2, .88), [0, 2.55, -.22], undefined, .03)
    if (skyline) {
      for (let building = 0; building < 9; building += 1) {
        const height = .35 + ((building * 5) % 7) * .16
        box(group, [.24, height, .04], material(building % 3 ? 0x1d2a33 : 0x2b3a44, .8), [-1.1 + building * .28, 1.78 + height / 2, -.18], undefined, .01)
        if (building % 3 === 0) box(group, [.08, .07, .02], material(p.glow, .2, .3, p.glow, .8), [-1.1 + building * .28, 2.1 + height * .5, -.16], undefined, .005)
      }
    } else {
      for (let line = 0; line < 5; line += 1) box(group, [1.5 - line * .18, .07, .03], material(line ? 0x3a3129 : p.brass, .6, line ? .05 : .7), [0, 3.15 - line * .32, -.18], undefined, .01)
      add(group, new THREE.CylinderGeometry(.22, .22, .05, 24), brass, [-.85, 1.72, -.16], [Math.PI / 2, 0, 0])
    }
    return
  }

  if (key === 'stained_glass') {
    // The same leaded transom the office scene sets into the window head: a
    // grid of small quarries in the room's amber and teal rather than a wheel
    // of primaries.
    const tints = [0x27506a, 0x9c7a3c, 0x2a5747, 0x9c7a3c, 0x6f3630]
    const lead = material(0x14181b, .6)
    box(group, [4.3, 1.9, .16], brass, [0, 2.6, -.34], undefined, .05)
    for (let light = 0; light < 5; light += 1) {
      const x = -1.66 + light * .83
      for (let course = 0; course < 3; course += 1) {
        const y = 2.05 + course * .55
        const tint = tints[(light + course * 2) % tints.length]
        const pane = box(group, [.74, .46, .05], material(tint, .38, .1, tint, .22), [x, y, -.22], undefined, .01)
        pane.castShadow = false
        const quarry = add(group, new THREE.CircleGeometry(.13, 4), material(course % 2 ? 0x9c7a3c : 0x2a5747, .34, .1, course % 2 ? 0x9c7a3c : 0x2a5747, .3), [x, y, -.185])
        quarry.castShadow = false
      }
      box(group, [.06, 1.72, .06], lead, [x - .415, 2.6, -.19], undefined, .01)
    }
    box(group, [.06, 1.72, .06], lead, [1.66 + .415, 2.6, -.19], undefined, .01)
    for (const y of [2.32, 2.88]) box(group, [3.36, .06, .06], lead, [0, y, -.19], undefined, .01)
    const roundel = add(group, new THREE.CircleGeometry(.36, 22), material(0x9c7a3c, .34, .1, 0x9c7a3c, .34), [0, 2.6, -.17])
    roundel.castShadow = false
    add(group, new THREE.TorusGeometry(.36, .04, 10, 28), lead, [0, 2.6, -.16])
    box(group, [.46, .05, .04], lead, [0, 2.7, -.14], undefined, .01)
    box(group, [.05, .28, .04], lead, [0, 2.56, -.14], undefined, .01)
    for (const side of [-1, 1]) add(group, new THREE.CylinderGeometry(.1, .035, .07, 12), lead, [side * .22, 2.64, -.14])
    return
  }

  const top = addPlinth(group, p, key === 'persian_rug' ? .55 : 1.1)

  if (key === 'persian_rug') {
    box(group, [2.5, .07, 1.95], material(0x1f3d52, .96), [0, top, .2], undefined, .02)
    const field = add(group, new THREE.PlaneGeometry(2.2, 1.65), material(0x7d3128, .96), [0, top + .05, .2], [-Math.PI / 2, 0, 0])
    field.castShadow = false
    const medallion = add(group, new THREE.CircleGeometry(.5, 32), material(0x1f3d52, .96), [0, top + .06, .2], [-Math.PI / 2, 0, 0])
    medallion.scale.y = .6
    medallion.castShadow = false
    for (let motif = 0; motif < 6; motif += 1) {
      const dot = add(group, new THREE.CircleGeometry(.13, 16), material(0xc9af83, .95), [-.9 + motif * .36, top + .06, motif % 2 ? -.42 : .82], [-Math.PI / 2, 0, 0])
      dot.scale.y = .6
      dot.castShadow = false
    }
    return
  }

  if (key === 'banker_lamp') {
    add(group, new THREE.CylinderGeometry(.42, .5, .11, 24), brass, [0, top + .06, .2])
    add(group, new THREE.CylinderGeometry(.07, .085, .72, 16), brass, [0, top + .45, .2])
    box(group, [1.28, .3, .52], material(0x2f6b52, .3, .12, 0x1c4433, .5), [0, top + .92, .2], undefined, .14)
    box(group, [1.1, .04, .4], brass, [0, top + .77, .2], undefined, .01)
    const bulb = add(group, new THREE.SphereGeometry(.12, 18, 12), material(0xffe0a8, .3, .05, 0xffbe6a, 1.4), [0, top + .72, .2])
    bulb.castShadow = false
    const light = new THREE.PointLight(0xffc878, 2.6, 4.5, 1.6)
    light.position.set(0, top + .68, .55)
    group.add(light)
    return
  }

  if (key === 'fig_tree') {
    add(group, new THREE.CylinderGeometry(.58, .44, .95, 24), material(0x9a5a3f, .9), [0, top + .48, .2])
    add(group, new THREE.CylinderGeometry(.5, .5, .08, 20), material(0x2b201a, .95), [0, top + .95, .2])
    add(group, new THREE.CylinderGeometry(.09, .13, 1.5, 12), walnut, [.05, top + 1.7, .2], [0, 0, -.05])
    for (let clump = 0; clump < 9; clump += 1) {
      const angle = clump / 9 * Math.PI * 2 + .6
      const blade = add(group, new THREE.SphereGeometry(.42 + (clump % 3) * .08, 18, 12), clump % 2 ? leaf : leafLight, [Math.cos(angle) * (.3 + (clump % 3) * .2), top + 2.35 + (clump % 4) * .3, .2 + Math.sin(angle) * .28])
      blade.scale.set(1.1, .6, .9)
      blade.rotation.z = Math.cos(angle) * .35
    }
    return
  }

  if (key === 'chesterfield') {
    const oxblood = material(0x5f2b26, .5)
    box(group, [3.0, .55, 1.35], oxblood, [0, top + .38, .3], undefined, .24)
    box(group, [3.0, 1.1, .4], oxblood, [0, top + 1.05, -.28], [-.09, 0, 0], .2)
    add(group, new THREE.CylinderGeometry(.2, .2, 3.0, 16), oxblood, [0, top + 1.58, -.36], [0, 0, Math.PI / 2])
    for (const x of [-1.36, 1.36]) {
      box(group, [.32, .8, 1.4], oxblood, [x, top + .6, .3], undefined, .14)
      add(group, new THREE.CylinderGeometry(.18, .18, 1.4, 16), oxblood, [x, top + 1.02, .3], [Math.PI / 2, 0, 0])
      for (const z of [-.2, .8]) add(group, new THREE.CylinderGeometry(.07, .09, .3, 10), brass, [x * .9, top + .1, z])
    }
    for (let column = 0; column < 5; column += 1) for (let row = 0; row < 2; row += 1) {
      add(group, new THREE.SphereGeometry(.055, 12, 8), material(0x351713, .6), [-.9 + column * .45, top + .85 + row * .4, -.1])
    }
    return
  }

  if (key === 'reporter_wall') {
    const spines = [0x6d3a2c, 0x2f4a3c, 0x8a6a34, 0x40323f]
    box(group, [3.1, 2.7, .62], walnut, [0, top + 1.35, -.15], undefined, .06)
    box(group, [3.3, .16, .72], brass, [0, top + 2.76, -.15], undefined, .04)
    for (let row = 0; row < 4; row += 1) {
      const shelfY = top + .2 + row * .66
      box(group, [2.9, .09, .6], material(0x241c19, .7), [0, shelfY, -.1], undefined, .02)
      for (let volume = 0; volume < 9; volume += 1) {
        const height = .42 + ((volume + row * 3) % 4) * .06
        box(group, [.26, height, .42], material(spines[(volume + row) % spines.length], .74), [-1.15 + volume * .29, shelfY + .06 + height / 2, .02], [0, 0, ((volume + row) % 3 - 1) * .02], .015)
        box(group, [.17, .04, .03], brass, [-1.15 + volume * .29, shelfY + .06 + height * .76, .24], undefined, .008)
      }
    }
    return
  }

  if (key === 'grandfather_clock') {
    // A longcase clock is tall enough that the card's fixed frame cropped the
    // hood off entirely, leaving a bare post. The case is drawn shorter here so
    // the dial, pendulum and cornice all sit inside the shot.
    const base = top - .55
    box(group, [1.05, .2, .68], walnut, [0, base + .1, .1], undefined, .03)
    box(group, [.88, 2.15, .55], walnut, [0, base + 1.24, .1], undefined, .04)
    box(group, [1.05, .78, .64], walnut, [0, base + 2.7, .1], undefined, .05)
    box(group, [1.15, .15, .72], brass, [0, base + 3.15, .1], undefined, .04)
    add(group, new THREE.SphereGeometry(.1, 16, 12), brass, [0, base + 3.3, .1])
    add(group, new THREE.CylinderGeometry(.29, .29, .06, 30), material(0xe8dcbc, .85), [0, base + 2.7, .44], [Math.PI / 2, 0, 0])
    add(group, new THREE.TorusGeometry(.31, .035, 12, 32), brass, [0, base + 2.7, .46])
    for (let mark = 0; mark < 12; mark += 1) {
      const angle = mark / 12 * Math.PI * 2
      box(group, [.03, .06, .02], material(0x241c19, .6), [Math.cos(angle) * .22, base + 2.7 + Math.sin(angle) * .22, .49], undefined, .005)
    }
    box(group, [.03, .2, .02], material(0x241c19, .6), [0, base + 2.79, .5], undefined, .005)
    box(group, [.14, .03, .02], material(0x241c19, .6), [.06, base + 2.7, .5], undefined, .005)
    const pane = box(group, [.5, 1.35, .03], glass, [0, base + 1.4, .39], undefined, .01)
    pane.castShadow = false
    add(group, new THREE.CylinderGeometry(.02, .02, 1.05, 10), brass, [0, base + 1.55, .3])
    add(group, new THREE.CylinderGeometry(.16, .16, .04, 24), brass, [0, base + .95, .3], [Math.PI / 2, 0, 0])
    return
  }

  if (key === 'trophy_shelf') {
    box(group, [3.0, 2.5, .12], walnut, [0, top + 1.3, -.5], undefined, .04)
    for (let shelf = 0; shelf < 2; shelf += 1) {
      const shelfY = top + .5 + shelf * 1.15
      box(group, [2.8, .12, .62], walnut, [0, shelfY, -.15], undefined, .02)
      const strip = box(group, [2.5, .05, .05], material(p.glow, .2, .3, p.glow, .9), [0, shelfY + .95, .1], undefined, .01)
      strip.castShadow = false
      add(group, new THREE.CylinderGeometry(.22, .14, .42, 20), brass, [-.85, shelfY + .3, -.12])
      add(group, new THREE.CylinderGeometry(.07, .14, .22, 14), brass, [-.85, shelfY + .13, -.12])
      for (const side of [-1, 1]) add(group, new THREE.TorusGeometry(.12, .03, 8, 18, Math.PI), brass, [-.85 + side * .24, shelfY + .32, -.12], [0, 0, side * Math.PI / 2])
      box(group, [.62, .72, .08], material(0x241c19, .7), [.15, shelfY + .45, -.2], undefined, .02)
      box(group, [.46, .54, .04], brass, [.15, shelfY + .45, -.14], undefined, .015)
      add(group, new THREE.ConeGeometry(.16, .78, 4), stone, [1.02, shelfY + .5, -.15])
    }
    return
  }

  if (key === 'justice_bust') {
    // Carved, not stacked: a squared socle, a faceted tapering torso and a
    // shoulder line, with the blindfold as a narrow band over the eyes.
    const lead = material(0x1b2126, .55)
    box(group, [1.24, .3, 1.02], stone, [0, top + .15, .2], undefined, .04)
    add(group, new THREE.CylinderGeometry(.68, .92, 1.2, 8), stone, [0, top + .9, .2])
    box(group, [1.9, .46, .92], stone, [0, top + 1.38, .22], undefined, .05)
    add(group, new THREE.CylinderGeometry(.2, .26, .4, 14), stone, [0, top + 1.78, .22])
    const head = add(group, new THREE.SphereGeometry(.47, 26, 18), stone, [0, top + 2.24, .22])
    head.scale.set(.86, 1.1, .9)
    add(group, new THREE.ConeGeometry(.09, .24, 6), stone, [0, top + 2.16, .64], [Math.PI / 2, 0, 0])
    box(group, [.34, .18, .18], stone, [0, top + 1.96, .58], undefined, .03)
    box(group, [.72, .17, .32], lead, [0, top + 2.3, .5], undefined, .02)
    for (const side of [-1, 1]) box(group, [.19, .15, .32], lead, [side * .38, top + 2.3, .22], undefined, .02)
    const crown = add(group, new THREE.SphereGeometry(.48, 24, 16), stone, [0, top + 2.52, .2])
    crown.scale.set(.92, .6, .94)
    const bun = add(group, new THREE.SphereGeometry(.25, 18, 12), stone, [0, top + 2.4, -.24])
    bun.scale.set(1, .9, .85)
    add(group, new THREE.TorusGeometry(.24, .035, 10, 26), brass, [0, top - .5, 1.0])
    return
  }

  if (key === 'globe_bar') {
    for (let leg = 0; leg < 3; leg += 1) {
      const angle = leg / 3 * Math.PI * 2
      add(group, new THREE.CylinderGeometry(.07, .07, 1.15, 10), walnut, [Math.cos(angle) * .3, top + .55, .2 + Math.sin(angle) * .3], [Math.sin(angle) * .22, 0, -Math.cos(angle) * .22])
    }
    add(group, new THREE.CylinderGeometry(.16, .2, .2, 16), brass, [0, top + 1.2, .2])
    add(group, new THREE.SphereGeometry(.82, 34, 24), material(0x30608a, .35, .18), [0, top + 2.1, .2])
    for (let land = 0; land < 7; land += 1) {
      const angle = land / 7 * Math.PI * 2 + .4
      const patch = add(group, new THREE.SphereGeometry(.32 + (land % 3) * .09, 16, 12), land % 2 ? leafLight : material(0xc9a877, .85), [Math.cos(angle) * .66, top + 2.1 + Math.sin(angle * 1.7) * .42, .2 + Math.sin(angle) * .66])
      patch.scale.set(.9, .6, .9)
    }
    add(group, new THREE.TorusGeometry(.86, .045, 12, 42), brass, [0, top + 2.1, .2], [Math.PI / 2, 0, 0])
    add(group, new THREE.TorusGeometry(.93, .05, 12, 44), brass, [0, top + 2.1, .2], [0, .4, 0])
    return
  }

  if (key === 'charter_vitrine') {
    box(group, [1.9, 1.4, 1.2], material(0x1b2228, .55), [0, top + .7, .2], undefined, .04)
    box(group, [2.05, .1, 1.35], brass, [0, top + 1.45, .2], undefined, .03)
    for (const x of [-.82, .82]) for (const z of [-.28, .68]) add(group, new THREE.CylinderGeometry(.045, .045, 1.5, 8), brass, [x, top + 2.25, z])
    box(group, [1.75, .1, 1.15], brass, [0, top + 3.02, .2], undefined, .03)
    const cover = box(group, [1.7, 1.45, 1.1], glass, [0, top + 2.25, .2], undefined, .02)
    cover.castShadow = false
    const charter = box(group, [1.05, 1.2, .05], material(0xe6d9b6, .88), [0, top + 2.2, .28], [-.13, 0, 0], .02)
    charter.castShadow = false
    for (let line = 0; line < 6; line += 1) box(group, [.62 - (line % 3) * .12, .04, .03], material(0x3a3129, .7), [-.04, top + 2.6 - line * .16, .36], undefined, .008)
    add(group, new THREE.CylinderGeometry(.1, .1, .03, 16), material(0x9d3630, .5), [.28, top + 1.72, .4], [Math.PI / 2, 0, 0])
    const lamp = box(group, [1.2, .06, .4], material(p.glow, .2, .3, p.glow, .95), [0, top + 2.92, .2], undefined, .01)
    lamp.castShadow = false
    return
  }

  // orchid_wall and any future planted decor
  box(group, [3.4, 2.6, .35], walnut, [0, top + 1.35, -.4], undefined, .06)
  box(group, [3.1, 2.3, .16], leaf, [0, top + 1.35, -.2], undefined, .03)
  for (let clump = 0; clump < 40; clump += 1) {
    const column = clump % 10
    const row = Math.floor(clump / 10)
    const blade = add(group, new THREE.SphereGeometry(.24 + ((clump * 7) % 5) * .05, 12, 8), clump % 3 ? leaf : leafLight, [-1.35 + column * .3, top + .45 + row * .6 + (((clump * 11) % 5) - 2) * .05, -.05])
    blade.scale.set(1.15, .68, .5)
    blade.rotation.z = (((clump * 13) % 7) - 3) * .16
    blade.castShadow = false
  }
  for (let flower = 0; flower < 9; flower += 1) {
    const x = -1.2 + flower * .3
    const y = top + .8 + (flower % 3) * .62
    add(group, new THREE.SphereGeometry(.12, 14, 10), material(0xe6cbd4, .76), [x, y, .1]).castShadow = false
    add(group, new THREE.SphereGeometry(.045, 10, 8), material(0xd79a3d, .5, .1, 0xd79a3d, .6), [x, y, .19]).castShadow = false
  }
  const rail = box(group, [3.1, .06, .06], material(p.glow, .2, .3, p.glow, .9), [0, top + 2.5, -.02], undefined, .01)
  rail.castShadow = false
}

function buildSubject(asset: RenderAsset, p: typeof palettes[number]) {
  const subject = new THREE.Group()
  subject.rotation.y = -.04
  const key = asset.key
  const art = asset.art ?? ''

  if (asset.type === 'rival') {
    // `art` carries the architecture family for rivals ('gothic', 'neon', …),
    // which is the only thing that decides the massing.
    addRivalHeadquarters(subject, art || 'mega-tower', asset.tier, p)
    return subject
  }

  if (asset.type === 'cosmetic') {
    addCosmetic(subject, asset, p)
    return subject
  }

  if (asset.type === 'connection') {
    if (key === 'local_bar') addScales(subject, p)
    else if (key.includes('oceanic')) addCampus(subject, p, true)
    else if (key.includes('orbital') || key.includes('interworld')) { addGlobe(subject, p); addVehicle(subject, p, true) }
    else if (key.includes('entertainment')) addMedia(subject, p)
    else if (key.includes('innovation')) addOperations(subject, p, true)
    else if (key.includes('international') || key.includes('global') || key.includes('diplomatic') || key.includes('sovereign')) addConference(subject, p, true)
    else addConference(subject, p, false)
    return subject
  }

  if (key.includes('desk')) addDesk(subject, p, false)
  else if (key.includes('lighting')) { addDesk(subject, p, false); addLamp(subject, p) }
  else if (key.includes('library') || key.includes('archive') || key.includes('vault')) addLibrary(subject, p, key.includes('vault'))
  else if (key.includes('conference') || key.includes('court') || key.includes('deposition') || key.includes('jury') || key.includes('treaty')) addConference(subject, p, key.includes('digital') || key.includes('treaty') || key.includes('jury'))
  else if (key.includes('airship') || key.includes('courier') || key.includes('shuttle')) addVehicle(subject, p, false)
  else if (key.includes('orbital') || key.includes('satellite') || key.includes('lunar') || key.includes('constellation')) { addGlobe(subject, p); addVehicle(subject, p, true) }
  else if (key.includes('campus') || key.includes('oceanic') || key.includes('embassy')) addCampus(subject, p, key.includes('oceanic'))
  else if (art === 'media') addMedia(subject, p)
  else if (art === 'command' || art === 'future' || key.includes('grid') || key.includes('foundry') || key.includes('supercomputer')) addOperations(subject, p, art === 'future' || key.includes('supercomputer'))
  else if (art === 'executive') { addDesk(subject, p, true); addLamp(subject, p) }
  else if (art === 'hologram' || art === 'network' || art === 'analytics') { addOperations(subject, p, true); addGlobe(subject, p, .65, [0, 2.12, .42]) }
  else { addDesk(subject, p, true); addScreen(subject, p, key.includes('management') || key.includes('portal') ? 2 : 1) }
  return subject
}

const FRAME_BOX = new THREE.Box3()
const FRAME_SIZE = new THREE.Vector3()
const FRAME_CENTRE = new THREE.Vector3()

/**
 * Rival headquarters range from a two-storey brick terrace to a thirteen-tier
 * orbital ring, so the fixed interior camera that frames every other card would
 * crop most of them. Fitting the camera to the subject's own bounds keeps the
 * whole massing in shot at a consistent three-quarter angle.
 */
function frameSubject(camera: THREE.PerspectiveCamera, subject: THREE.Object3D) {
  FRAME_BOX.setFromObject(subject)
  if (FRAME_BOX.isEmpty()) return
  FRAME_BOX.getSize(FRAME_SIZE)
  FRAME_BOX.getCenter(FRAME_CENTRE)
  const radius = Math.max(FRAME_SIZE.x, FRAME_SIZE.y * 1.12, FRAME_SIZE.z) * .5
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const distance = (radius / Math.min(vertical, vertical * camera.aspect)) * 1.5 + radius
  camera.position.set(
    FRAME_CENTRE.x + distance * .62,
    FRAME_CENTRE.y + Math.max(1.6, FRAME_SIZE.y * .34) + distance * .22,
    FRAME_CENTRE.z + distance * .78,
  )
  camera.lookAt(FRAME_CENTRE.x, FRAME_CENTRE.y + FRAME_SIZE.y * .04, FRAME_CENTRE.z)
  camera.far = distance * 4 + 40
  camera.updateProjectionMatrix()
}

function renderThumbnail(asset: RenderAsset) {
  const p = palettes[Math.min(palettes.length - 1, Math.floor(Math.max(0, asset.tier) / 4))]
  const rival = asset.type === 'rival'
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(rival ? 0x0d151d : asset.type === 'connection' ? 0x101c25 : 0x111821)
  scene.fog = new THREE.FogExp2(scene.background, rival ? .011 : .026)
  if (rival) addStreet(scene, p, asset.art === 'ocean')
  else addRoom(scene, asset, p)
  const subject = buildSubject(asset, p)
  scene.add(subject)

  scene.add(new THREE.HemisphereLight(0xabc7cf, 0x1a100d, 1.5))
  const key = new THREE.DirectionalLight(0xffd9a0, 3.35)
  key.position.set(-4.5, 7.5, 7.5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 6; key.shadow.camera.bottom = -2
  scene.add(key)
  const rim = new THREE.SpotLight(p.glow, 4.2, 16, .72, .55, 1.25)
  rim.position.set(4.8, 5.4, 2.4)
  rim.target.position.set(0, 1.25, 0)
  scene.add(rim, rim.target)
  const warm = new THREE.PointLight(p.brass, 2.1, 7, 1.6)
  warm.position.set(-3.8, 2.8, 2.6)
  scene.add(warm)

  const camera = new THREE.PerspectiveCamera(34, WIDTH / HEIGHT, .1, 70)
  camera.position.set(6.6, 4.55, 8.2)
  camera.lookAt(0, 1.55, .05)
  if (rival) {
    frameSubject(camera, subject)
    // A big exterior needs the key light and its shadow frustum to grow with
    // it, or a tower is lit as if it were a desk lamp and casts no shadow.
    FRAME_BOX.getSize(FRAME_SIZE)
    const reach = Math.max(9, FRAME_SIZE.length() * .8)
    key.position.set(-reach * .5, reach * .95, reach * .8)
    key.shadow.camera.left = -reach; key.shadow.camera.right = reach
    key.shadow.camera.top = reach; key.shadow.camera.bottom = -reach * .3
    key.shadow.camera.far = reach * 4
    key.shadow.camera.updateProjectionMatrix()
    rim.distance = reach * 3
    rim.intensity = 4.2 * Math.max(1, reach / 8)
    rim.position.set(reach * .7, reach * .7, reach * .35)
    rim.target.position.copy(FRAME_CENTRE)
    warm.distance = reach * 1.4
    warm.intensity = 2.1 * Math.max(1, reach / 9)
    warm.position.set(-reach * .45, FRAME_CENTRE.y, reach * .4)
  }
  const webgl = renderer()
  stylePass().render(scene, camera)
  const dataUrl = webgl.domElement.toDataURL('image/webp', .9)

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    const mats = Array.isArray(object.material) ? object.material : [object.material]
    mats.forEach((mat) => mat.dispose())
  })
  return dataUrl
}

function requestThumbnail(asset: RenderAsset) {
  const cacheKey = `catalog-3d-v3:${asset.type}:${asset.key}:${asset.tier}`
  const cached = renderCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)
  const pending = pendingRenders.get(cacheKey)
  if (pending) return pending
  const task = renderQueue
    .catch(() => undefined)
    .then(() => renderThumbnail(asset))
    .then((dataUrl) => {
      renderCache.set(cacheKey, dataUrl)
      pendingRenders.delete(cacheKey)
      return dataUrl
    }, (error) => {
      pendingRenders.delete(cacheKey)
      throw error
    })
  pendingRenders.set(cacheKey, task)
  renderQueue = task
  return task
}

export function CatalogAssetRender({ asset, fallbackSrc }: { asset: RenderAsset; fallbackSrc: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [src, setSrc] = useState(() => renderCache.get(`catalog-3d-v3:${asset.type}:${asset.key}:${asset.tier}`) ?? '')

  useEffect(() => {
    const root = rootRef.current
    if (!root || src) return
    let cancelled = false
    let started = false
    const start = () => {
      if (started) return
      started = true
      void requestThumbnail(asset).then((url) => {
        if (!cancelled) setSrc(url)
      }).catch(() => {
        if (!cancelled) setSrc(fallbackSrc)
      })
    }
    if (!('IntersectionObserver' in window)) start()
    let observer: IntersectionObserver | null = null
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            start()
            observer?.disconnect()
          }
        }, { rootMargin: '320px 0px' })
    }
    observer?.observe(root)
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [asset, fallbackSrc, src])

  return (
    <div className={`av-card-render ${src ? 'is-ready' : 'is-rendering'}`} data-render-key={asset.key} ref={rootRef}>
      {src && <img className="av-card-img" src={src} alt="" draggable={false} />}
      {!src && <div className="av-card-render-placeholder" aria-hidden="true"><i /><i /><i /></div>}
    </div>
  )
}

export default CatalogAssetRender
