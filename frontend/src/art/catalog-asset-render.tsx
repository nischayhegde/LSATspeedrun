import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

import type { GameAsset } from '../types'

type RenderAsset = Pick<GameAsset, 'art' | 'key' | 'name' | 'tier' | 'type'>

const WIDTH = 640
const HEIGHT = 384
const renderCache = new Map<string, string>()
const pendingRenders = new Map<string, Promise<string>>()
let renderQueue: Promise<unknown> = Promise.resolve()
let sharedRenderer: THREE.WebGLRenderer | null = null

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

function buildSubject(asset: RenderAsset, p: typeof palettes[number]) {
  const subject = new THREE.Group()
  subject.rotation.y = -.04
  const key = asset.key
  const art = asset.art ?? ''

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

function renderThumbnail(asset: RenderAsset) {
  const p = palettes[Math.min(palettes.length - 1, Math.floor(Math.max(0, asset.tier) / 4))]
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(asset.type === 'connection' ? 0x101c25 : 0x111821)
  scene.fog = new THREE.FogExp2(scene.background, .026)
  addRoom(scene, asset, p)
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
  const webgl = renderer()
  webgl.render(scene, camera)
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
  const cacheKey = `catalog-3d-v2:${asset.type}:${asset.key}:${asset.tier}`
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
  const [src, setSrc] = useState(() => renderCache.get(`catalog-3d-v2:${asset.type}:${asset.key}:${asset.tier}`) ?? '')

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
