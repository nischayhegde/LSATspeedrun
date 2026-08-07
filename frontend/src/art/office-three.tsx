import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

import type { ActiveOfficeCase, CharacterGender, GameAsset } from '../types'
import { clientCastSeed } from './assets'
import { OFFICE_ASSET_MANIFEST, officeEnvironmentFor, officeLayoutFor, officeStaffStationFor, officeVisualFor, type OfficeStaffStation, type OfficeVisualZone } from './office-manifest'
import { IllustratedRenderPass } from './render-style'
import { buildStylizedCounsel, type StylizedCounselRig } from './stylized-counsel'
import {
  HumanoidActor,
  HumanoidBehaviorDirector,
  assignHumanoidLod,
  warmHumanoidClips,
  type BehaviorRole,
  type HumanoidState,
} from './rig'

type OfficeThreeProps = { tier: number; ownedAssets: GameAsset[]; layoutKey?: string; activeCase?: ActiveOfficeCase | null }

// The office is built from a few hundred primitives, and most of them are cut
// to sizes fixed at authoring time: every key on a keyboard, every baluster on
// a stair rail, every book spine on a shelf. Tessellating those repeatedly is
// pure waste, and it is waste we pay twice over, because the scene is rebuilt
// whenever the player levels up or buys furniture.
//
// So constant-shaped primitives are cut once and shared. The cache is module
// level deliberately: surviving the teardown is the point, since a rebuild
// after a purchase is the common case, not the rare one.
//
// Only call this with arguments fixed at authoring time. Anything derived from
// tier, a seed or a loop index must keep constructing its own geometry, and
// anything the caller intends to mutate (`geometry.translate`, attribute
// rewrites) must stay unshared or the mutation leaks into every other user.
const sharedGeometryCache = new Map<string, THREE.BufferGeometry>()
function constantGeometry<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
  const cached = sharedGeometryCache.get(key)
  if (cached) return cached as T
  const geometry = build()
  // Reuses the flag the character rigs already set, which the teardown pass
  // reads to decide what it is allowed to dispose.
  geometry.userData.characterShared = true
  sharedGeometryCache.set(key, geometry)
  return geometry
}

/**
 * A rounded box, cut at a corner resolution the corner can actually show.
 *
 * `segments` subdivides the fillet, and a rounded box costs `12 * (2s + 1)^2`
 * triangles, so the difference between 2 and 3 is not a detail - it is half the
 * geometry. Authored values sat at 3 or 4 almost everywhere regardless of what
 * was being cut, which meant a keyboard key with an eight-millimetre fillet
 * carried 300 triangles for a corner that renders about one pixel across, and
 * twenty-seven of them sat on one desk.
 *
 * Profiling the office build put `RoundedBoxGeometry` at roughly a hundred and
 * ten milliseconds of the seven hundred it took to reach a first frame, most of
 * it inside `getUv`, which runs `Vector3.angleTo` - an acos and a cross product
 * - once per vertex. Vertices go as `(2s + 1)^2`, so this is the same saving
 * twice: fewer triangles to draw and far less trigonometry to build them.
 *
 * The fillet radius, not the box, sets the rung: a two-metre panel with a
 * two-centimetre edge break has exactly as little corner to resolve as a small
 * one does.
 */
function roundedBox(width: number, height: number, depth: number, segments: number, radius: number) {
  const sized = radius < .015 ? 1 : radius < .04 ? 2 : radius < .09 ? 3 : 4
  const effective = Math.max(1, Math.min(segments, sized))
  return constantGeometry(
    `rb:${width}:${height}:${depth}:${effective}:${radius}`,
    () => new RoundedBoxGeometry(width, height, depth, effective, radius),
  )
}

// Character beats below are authored as discrete phases (a glance, a toe
// tap, a seated cheer). Rather than assigning each joint's rotation outright
// every frame, every beat writes a *target* value and this eases the actual
// joint toward it, so switching beats reads as one continuous performance
// instead of a jump-cut. `snap` short-circuits to the target for the single
// static frame rendered under prefers-reduced-motion.
const easeTo = (current: number, target: number, rate: number, dt: number, snap: boolean) =>
  snap ? target : THREE.MathUtils.damp(current, target, rate, dt)

/**
 * A member of staff at their desk.
 *
 * Staff do not walk. The office is composed as a set of seated tableaux, and
 * this type is deliberately small as a result: a body, the clip driving it,
 * where it sits, and which of the four desk tasks it is doing. The errand
 * state machine, the steering agent, the route, the anchor reservation, the
 * yielding and stall-recovery counters and the gait-rate measurement that used
 * to live here all went with the walking.
 *
 * Nothing here is a position that changes. A staff actor is placed once at
 * build time and never moves again, which is why there is no velocity, no
 * heading and no goal on it.
 */
type OfficeStaffActor = {
  rig: StylizedCounselRig
  actor: THREE.Group
  /** Skeletal driver for this character. The geometry in `rig` is exactly what
   *  it has always been; only what moves its joints has changed. */
  humanoid: HumanoidActor
  phase: number
  station: OfficeStaffStation
  /** Which of the four desk tasks this character is doing, fixed at build. */
  task: HumanoidState
  home: THREE.Vector3
  homeRotation: number
  /** Which repertoire the ambient director is running for this body. */
  behaviorRole: BehaviorRole
  /** Deterministic per-actor RNG state, so a reload replays identically. */
  randomState: number
}

/** Which ambient repertoire each workstation draws on. */
const STATION_BEHAVIOR: Record<OfficeStaffStation, BehaviorRole> = {
  casework: 'deskWork',
  technology: 'deskWork',
  reception: 'reception',
  investigation: 'investigation',
  diplomatic: 'diplomatic',
  leadership: 'diplomatic',
}


/**
 * What each station's occupant is doing at their desk.
 *
 * Four tasks exist and no others - writing, typing, reading, sorting - and
 * every seated body in the room is doing exactly one of them. Each station
 * lists the ones that make sense for the work it does, in preference order,
 * and a character picks from its own list by hash.
 *
 * Listing several per station rather than one is the content half of keeping a
 * room from pulsing. Phase and rate decorrelation stop two people doing the
 * same thing in step; giving neighbouring desks different things to do stops
 * them doing the same thing at all. A wing of three all typing is a chorus
 * line however carefully its phases are offset.
 */
const STATION_TASKS: Record<OfficeStaffStation, readonly HumanoidState[]> = {
  casework: ['deskWrite', 'deskRead', 'deskType'],
  technology: ['deskType', 'deskRead'],
  reception: ['deskSort', 'deskType', 'deskWrite'],
  investigation: ['deskRead', 'deskSort', 'deskWrite'],
  diplomatic: ['deskRead', 'deskWrite'],
  leadership: ['deskWrite', 'deskRead', 'deskSort'],
}

const deskTaskFor = (station: OfficeStaffStation, hash: number): HumanoidState => {
  const tasks = STATION_TASKS[station]
  return tasks[hash % tasks.length]
}

type OfficeClientActor = {
  rig: StylizedCounselRig
  humanoid: HumanoidActor
  phase: number
  folder: THREE.Group
  mug: THREE.Group
}

type OfficeCatActor = {
  root: THREE.Group
  body: THREE.Mesh
  head: THREE.Group
  eyes: Array<{ white: THREE.Mesh; pupil: THREE.Mesh }>
  legs: THREE.Group[]
  tail: THREE.Group
  /** The authored patrol circuit, now used only for its first point: where the
   *  cat settles. Kept as a list because the art picks that spot per layout. */
  waypoints: THREE.Vector3[]
  waypointIndex: number
  previousWaypointIndex: number
  pauseRemaining: number
  randomState: number
  lastElapsed: number
  // Eases 0-1 toward "currently walking", which is now always zero. Kept
  // rather than removed because every pose term below is written as a blend
  // between a resting formula and a moving one, and collapsing that by hand
  // would rewrite the cat's whole performance to save one multiply.
  walkBlend: number
}

type OfficeLook = {
  wall: number
  floor: number
  wood: number
  darkWood: number
  accent: number
  upholstery: number
  sky: number
  exterior: 'forest' | 'street' | 'city' | 'harbor' | 'world' | 'ocean' | 'orbit' | 'lunar' | 'nexus'
}

// Every headquarters level has its own material and exterior language. The
// geometry grows progressively; these palettes keep adjacent upgrades legible.
const OFFICE_LOOKS: OfficeLook[] = [
  { wall: 0x493226, floor: 0x38251d, wood: 0x65432f, darkWood: 0x2b1d17, accent: 0x3a3935, upholstery: 0x4d4035, sky: 0x101c24, exterior: 'forest' },
  { wall: 0x82705b, floor: 0x4c3427, wood: 0x76513a, darkWood: 0x34241d, accent: 0x796343, upholstery: 0x43535a, sky: 0x172936, exterior: 'street' },
  { wall: 0x69786f, floor: 0x493226, wood: 0x744a32, darkWood: 0x30211b, accent: 0x8c7446, upholstery: 0x31534f, sky: 0x18303a, exterior: 'street' },
  { wall: 0x273846, floor: 0x3e2b22, wood: 0x70452f, darkWood: 0x271b18, accent: 0x96713d, upholstery: 0x253e4a, sky: 0x102638, exterior: 'city' },
  { wall: 0x3b3338, floor: 0x35241f, wood: 0x6d4431, darkWood: 0x251a18, accent: 0xa47a3e, upholstery: 0x49333b, sky: 0x132a3e, exterior: 'city' },
  { wall: 0x2b4147, floor: 0x382a25, wood: 0x674634, darkWood: 0x211c1a, accent: 0x9d8552, upholstery: 0x294d52, sky: 0x12384a, exterior: 'harbor' },
  { wall: 0x222f3a, floor: 0x302722, wood: 0x5a4032, darkWood: 0x1a1818, accent: 0xb08a43, upholstery: 0x243b4a, sky: 0x112b41, exterior: 'world' },
  { wall: 0x1d3440, floor: 0x292421, wood: 0x513c31, darkWood: 0x17181a, accent: 0xb49b5d, upholstery: 0x1f4b50, sky: 0x102e44, exterior: 'world' },
  { wall: 0x203544, floor: 0x27231f, wood: 0x4b382f, darkWood: 0x15181b, accent: 0xc09648, upholstery: 0x274650, sky: 0x0c2942, exterior: 'world' },
  { wall: 0x233832, floor: 0x2c2721, wood: 0x503a2e, darkWood: 0x161a18, accent: 0xc4a45c, upholstery: 0x2c4940, sky: 0x102b3d, exterior: 'city' },
  { wall: 0x202d36, floor: 0x252525, wood: 0x483a32, darkWood: 0x14191d, accent: 0x66a8a5, upholstery: 0x263e49, sky: 0x0d3040, exterior: 'city' },
  { wall: 0x173443, floor: 0x222a2e, wood: 0x453b34, darkWood: 0x101a20, accent: 0x65b8b1, upholstery: 0x1e4957, sky: 0x08374a, exterior: 'ocean' },
  { wall: 0x20283b, floor: 0x262b36, wood: 0x493d35, darkWood: 0x121722, accent: 0x8faeb5, upholstery: 0x2b3d55, sky: 0x080f25, exterior: 'orbit' },
  { wall: 0x2a3038, floor: 0x303238, wood: 0x55483d, darkWood: 0x171a20, accent: 0xb8c6c9, upholstery: 0x3a4652, sky: 0x090e1c, exterior: 'lunar' },
  { wall: 0x151d2a, floor: 0x24242b, wood: 0x493a31, darkWood: 0x0d1118, accent: 0xd0aa55, upholstery: 0x203c46, sky: 0x070b18, exterior: 'nexus' },
]

function seeded(index: number) {
  return Math.abs(Math.sin(index * 91.731 + 17.17) * 43758.5453) % 1
}

function castHash(value: string) {
  let hash = 2166136261
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return hash >>> 0
}

function interpolateAngle(from: number, to: number, amount: number) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount
}

const knownStaffGenders: Record<string, CharacterGender> = {
  paralegal: 'female', junior_associate: 'male', office_manager: 'female', senior_associate: 'female',
  partner: 'male', rainmaker: 'female', intake_specialist: 'female', private_investigator: 'male',
  litigation_technologist: 'female', legal_nurse: 'female', trial_consultant: 'male',
  communications_director: 'female', appellate_counsel: 'male', chief_operating_officer: 'female',
  cybersecurity_counsel: 'male', branch_director: 'female', economist: 'male',
  international_arbitrator: 'female', diplomatic_liaison: 'male', crisis_commander: 'female',
  data_scientist: 'male', sovereign_envoy: 'female', treaty_architect: 'male', automation_director: 'female',
  quantum_analyst: 'male', oceanic_counsel: 'female', systems_advocate: 'male', orbital_counsel: 'female',
  lunar_envoy: 'male', chief_justice_strategist: 'female',
}

function woodTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 768
  const context = canvas.getContext('2d')!
  context.fillStyle = '#4b2f24'
  context.fillRect(0, 0, 768, 768)
  for (let plank = 0; plank < 12; plank += 1) {
    const y = plank * 64
    context.fillStyle = plank % 2 ? '#56372a' : '#452a22'
    context.fillRect(0, y, 768, 62)
    context.strokeStyle = 'rgba(14,8,7,.75)'
    context.lineWidth = 3
    context.strokeRect(0, y, 768, 64)
    for (let line = 0; line < 11; line += 1) {
      const offset = seeded(plank * 23 + line) * 18
      context.beginPath()
      context.moveTo(0, y + 9 + line * 4.4 + offset * .18)
      context.bezierCurveTo(190, y + offset, 470, y + 42 - offset, 768, y + 18 + offset)
      context.strokeStyle = `rgba(214,151,91,${.028 + seeded(line) * .045})`
      context.lineWidth = 1.2
      context.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3.2, 4.6)
  texture.anisotropy = 4
  return texture
}

function shackWoodTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const context = canvas.getContext('2d')!
  context.fillStyle = '#39271d'
  context.fillRect(0, 0, 1024, 1024)
  for (let plank = 0; plank < 11; plank += 1) {
    const y = plank * 94
    const tone = 42 + Math.round(seeded(plank + 90) * 22)
    context.fillStyle = `rgb(${tone + 22},${tone + 3},${Math.max(22, tone - 10)})`
    context.fillRect(0, y + 3, 1024, 87)
    context.fillStyle = 'rgba(15,9,6,.76)'
    context.fillRect(0, y, 1024, 5)
    for (let grain = 0; grain < 18; grain += 1) {
      const gy = y + 10 + grain * 4.1 + seeded(plank * 31 + grain) * 8
      context.beginPath()
      context.moveTo(0, gy)
      context.bezierCurveTo(230, gy - 12, 580, gy + 16, 1024, gy - 3)
      context.strokeStyle = `rgba(${grain % 3 ? '218,169,112' : '28,15,10'},${.035 + seeded(grain + plank) * .075})`
      context.lineWidth = grain % 4 === 0 ? 2 : 1
      context.stroke()
    }
    for (const x of [18, 1002]) {
      context.beginPath()
      context.arc(x, y + 46, 3.2, 0, Math.PI * 2)
      context.fillStyle = 'rgba(14,13,12,.88)'
      context.fill()
      context.beginPath()
      context.arc(x - 1, y + 45, 1, 0, Math.PI * 2)
      context.fillStyle = 'rgba(205,172,118,.42)'
      context.fill()
    }
    if (plank % 3 === 1) {
      const knotX = 170 + seeded(plank * 17) * 650
      context.beginPath()
      context.ellipse(knotX, y + 46, 23, 10, -.08, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(22,12,8,.55)'
      context.lineWidth = 4
      context.stroke()
      context.beginPath()
      context.ellipse(knotX, y + 46, 9, 4, -.08, 0, Math.PI * 2)
      context.fillStyle = 'rgba(18,10,7,.48)'
      context.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1.3, 1.05)
  texture.anisotropy = 4
  return texture
}

function screenTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 320
  const context = canvas.getContext('2d')!
  context.fillStyle = '#06141a'
  context.fillRect(0, 0, 512, 320)
  context.fillStyle = '#5ed0c6'
  context.font = '700 28px system-ui'
  context.fillText('ACTIVE MATTER', 36, 54)
  context.fillStyle = '#d9c487'
  context.fillRect(36, 82, 305, 8)
  context.fillStyle = '#658e91'
  ;[126, 166, 206, 246].forEach((y, index) => context.fillRect(36, y, 365 - index * 42, 7))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function addCapsuleBetween(
  parent: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) {
  const direction = end.clone().sub(start)
  const length = direction.length()
  const mesh = addMesh(
    parent,
    new THREE.CapsuleGeometry(radius, Math.max(.01, length - radius * 2), 5, 12),
    material,
    [
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      (start.z + end.z) / 2,
    ],
  )
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  return mesh
}

export function OfficeThreeScene({ tier, ownedAssets, layoutKey, activeCase }: OfficeThreeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const assetSignature = ownedAssets.map((asset) => `${asset.key}:${asset.type}`).join('|')
  const activeCaseSignature = activeCase
    ? `${activeCase.sessionId}:${activeCase.clientKey}:${activeCase.clientName}:${activeCase.baseFee}`
    : ''
  const environmentName = officeEnvironmentFor(tier).name

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // DEV-only inspection overrides. Physical-plausibility problems are
    // station-specific, and the stations a save happens to have hired are an
    // accident of play, so a harness needs to be able to ask for a tier and a
    // full shift directly. Compiled out of production builds.
    const devQuery = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null
    const tierOverride = devQuery?.get('officeTier')
    const level = Math.max(0, Math.min(14, Math.round(tierOverride ? Number(tierOverride) : tier)))
    const environment = officeEnvironmentFor(level)
    const layoutFamily = officeLayoutFor(level)
    // The purchase set is the other half of what decides a layout, and like the
    // shift it is an accident of play. `officeAssets` names an explicit list and
    // `officeAll` owns the entire catalogue, so the maximum-furnishing case can
    // be rendered and looked at rather than argued about.
    const ownedKeys = (() => {
      if (devQuery?.get('officeAll') === '1') return Object.keys(OFFICE_ASSET_MANIFEST)
      const explicit = devQuery?.get('officeAssets')?.split(',').filter(Boolean)
      return explicit?.length ? explicit : null
    })()
    const devAsset = (key: string, index: number, type: string) => (
      { key, type, level: 1, name: key, quantity: 1, id: -1000 - index, owned: true } as unknown as GameAsset
    )
    const staffOverride = devQuery?.get('officeStaff')?.split(',').filter(Boolean)
      ?? ownedKeys?.filter((key) => officeVisualFor(key)?.zone === 'staff-floor')
    const staffAssets = staffOverride?.length
      ? staffOverride.map((key, index) => devAsset(key, index, 'staff'))
      : ownedAssets.filter((asset) => asset.type === 'staff')
    const visualAssets = ownedKeys
      ? ownedKeys.filter((key) => officeVisualFor(key)).map((key, index) => devAsset(key, index, 'upgrade'))
      : ownedAssets.filter((asset) => officeVisualFor(asset.key))
    const assetsByZone = new Map<OfficeVisualZone, GameAsset[]>()
    visualAssets.forEach((asset) => {
      const visual = officeVisualFor(asset.key)
      const group = assetsByZone.get(visual.zone) ?? []
      group.push(asset)
      group.sort((left, right) => officeVisualFor(left.key).stage - officeVisualFor(right.key).stage)
      assetsByZone.set(visual.zone, group)
    })
    const rustic = level === 0
    const heritage = level <= 1
    const executive = level >= 5
    const international = level >= 8
    const frontier = level >= 12
    const look = OFFICE_LOOKS[level]
    const roomWidth = 15 + Math.min(5, level * 1.45)
    const roomHalf = roomWidth / 2
    const detailLevel = Math.min(9, 1 + Math.floor(level / 2) + Math.floor(visualAssets.length / 7))
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    // Shader-error checking is a synchronisation point, not a diagnostic that
    // costs nothing. `getProgramInfoLog` and `getShaderInfoLog` cannot answer
    // until the driver has finished compiling and linking, so asking blocks the
    // main thread for the whole compile instead of letting it proceed in
    // parallel. Profiled on the office at 4x CPU throttle, that check was ~97 ms
    // - the largest single item left between the canvas appearing and its first
    // frame. Nothing here compiles a shader that a developer has not already
    // seen compile, so the check earns its cost in development and not after.
    renderer.debug.checkShaderErrors = import.meta.env.DEV

    // Build-phase stopwatch. Attributing a half-second scene build needs to be
    // a measurement rather than a guess, and a CPU profile cannot tell the
    // shell apart from the furniture because both are anonymous closures in the
    // same function. Compiled out of production.
    const phases: Array<[string, number]> = []
    let phaseMark = performance.now()
    const phase = import.meta.env.DEV
      ? (name: string) => {
        const now = performance.now()
        phases.push([name, Number((now - phaseMark).toFixed(1))])
        phaseMark = now
      }
      : () => {}
    const constrainedDevice = (navigator.hardwareConcurrency || 8) <= 4
    // Phones report a device pixel ratio of 3. Rendering at 1.4 and letting the
    // compositor upscale was the reason the scene looked soft. 2x is the point
    // where further density stops being visible on these stylized shapes, so it
    // is the cap rather than the raw device ratio.
    const targetPixelRatio = Math.min(
      constrainedDevice ? 1.5 : 2,
      window.devicePixelRatio || 1,
    )
    // Keep one resolution for the lifetime of the scene. Resizing the WebGL
    // drawing buffer after the office appears creates a visible hitch.
    renderer.setPixelRatio(targetPixelRatio)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    const officeExposure = rustic ? 1.06 : 1.18 + Math.min(.12, level * .008)
    renderer.toneMappingExposure = officeExposure

    // Interiors carry the contours better than the map does. Every desk edge,
    // shelf and door frame is a crease rather than a silhouette, and those are
    // exactly the lines that make a drawn room read as a room, so the crease
    // detector runs at full strength here where the map has to hold it back.
    const stylePass = new IllustratedRenderPass(renderer, {
      exposure: officeExposure,
      inkStrength: .7,
      normalEdge: .86,
      bands: 10,
      flatten: .34,
      saturation: 1.18,
    })

    phase('renderer')
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(rustic ? 0x211812 : 0x111b23)
    scene.fog = new THREE.FogExp2(rustic ? 0x2a2019 : 0x15232b, rustic ? .024 : .014)

    // The camera now lives inside a complete four-wall set. Its small orbital
    // offset moves away from the wall being viewed, preserving comfortable
    // sightlines through a full 360-degree turn.
    const baseCameraFov = rustic ? 58 : 59
    const camera = new THREE.PerspectiveCamera(baseCameraFov, 1, .1, 80)
    // Open on a composed three-quarter view instead of looking over the back
    // of the partner chair. The higher sightline reveals the working floor,
    // keeps the single primary workstation legible, and still leaves the user
    // free to orbit from the centre of the office.
    const homeYaw = rustic ? -.22 : -.28
    const homePitch = rustic ? -.22 : -.25
    const cameraPivot = new THREE.Vector3(0, rustic ? 3.34 : 3.56, rustic ? 1.08 : 1.12)
    const cameraLookDirection = new THREE.Vector3()
    const cameraLookTarget = new THREE.Vector3()
    let cameraYaw = homeYaw
    let cameraYawTarget = homeYaw
    let cameraPitch = homePitch
    let cameraPitchTarget = homePitch
    const minimumCameraPitch = -.68
    const maximumCameraPitch = .42
    let lastLookAt = -Infinity
    let officeAmbient = 0
    let ambientYawOffset = 0
    let ambientPitchOffset = 0
    const noteLook = () => { lastLookAt = performance.now() }
    // Adjusted once the shift is known; see the framing block after the bays
    // are placed, which is the first point at which how many people are in
    // this room is a fact rather than a guess.
    let cameraOrbitHome = rustic ? 2.08 : 2.30
    const cameraPivotHome = cameraPivot.clone()
    let cameraOrbit = cameraOrbitHome

    const positionCamera = () => {
      // The ambient sway is kept out of `cameraYaw` itself and added here. Held
      // in the state variable it would be eased back toward the look target
      // every frame, so the drift would be fighting the follow and arrive at
      // some fraction of the amplitude it was written to have.
      const yaw = cameraYaw + ambientYawOffset
      const pitch = cameraPitch + ambientPitchOffset
      cameraLookDirection.set(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      ).normalize()
      camera.position.copy(cameraPivot).addScaledVector(cameraLookDirection, -cameraOrbit)
      cameraLookTarget.copy(camera.position).addScaledVector(cameraLookDirection, 8)
      camera.lookAt(cameraLookTarget)
    }
    positionCamera()

    const root = new THREE.Group()
    root.position.y = -.08
    scene.add(root)
    const focusTargets = new Map<string, { object: THREE.Object3D; halo: THREE.Object3D }>()
    const focusHalos: THREE.Object3D[] = []
    const staffRigs: OfficeStaffActor[] = []
    const staffDirector = new HumanoidBehaviorDirector()
    // Read before the characters are built, because an actor created for a
    // reduced-motion viewer settles straight into a held pose rather than
    // starting a mixer it will never advance.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let activeClientActor: OfficeClientActor | null = null
    /** Focus register key for the consulting client, set when one is built. */
    let clientFocusKey = ''
    /** Scratch for the client's look-at, rewritten each frame it is selected. */
    const clientLookTarget = new THREE.Vector3()
    let focusedTarget: { object: THREE.Object3D; halo: THREE.Object3D } | null = null
    let focusedUntil = 0

    const floorMap = rustic ? shackWoodTexture() : woodTexture()
    const wallMap = rustic ? shackWoodTexture() : null
    const screenMap = screenTexture()
    const wall = new THREE.MeshStandardMaterial({ color: look.wall, map: wallMap, bumpMap: wallMap, bumpScale: rustic ? .055 : 0, roughness: rustic ? 1 : .9, metalness: 0 })
    const wood = new THREE.MeshStandardMaterial({ color: look.wood, map: floorMap, bumpMap: floorMap, bumpScale: rustic ? .04 : .014, roughness: rustic ? .92 : .52, metalness: .01 })
    const darkWood = new THREE.MeshStandardMaterial({ color: look.darkWood, roughness: rustic ? .96 : .62 })
    const brass = new THREE.MeshStandardMaterial({ color: look.accent, roughness: rustic ? .68 : .34, metalness: rustic ? .52 : .72 })
    const charcoal = new THREE.MeshStandardMaterial({ color: 0x202a32, roughness: .58, metalness: .18 })
    const leather = new THREE.MeshStandardMaterial({ color: look.upholstery, roughness: rustic ? .88 : .46 })
    const paper = new THREE.MeshStandardMaterial({ color: rustic ? 0xb8a47c : 0xded1ad, roughness: .94 })
    const teal = new THREE.MeshStandardMaterial({ color: 0x214e52, roughness: .48, metalness: .18 })
    const screen = new THREE.MeshStandardMaterial({ color: 0x10292e, map: screenMap, emissiveMap: screenMap, emissive: 0x216e6e, emissiveIntensity: .58, roughness: .24 })
    const glow = new THREE.MeshStandardMaterial({ color: 0x7bc8bd, emissive: 0x3aa89e, emissiveIntensity: .72, roughness: .28, metalness: .22 })
    const focusMaterial = new THREE.MeshStandardMaterial({ color: 0xffdf8c, emissive: 0xe3a33c, emissiveIntensity: 1.55, roughness: .24, metalness: .28 })
    const focusLight = new THREE.PointLight(0xf3c66a, 0, 4.2, 1.65)
    scene.add(focusLight)

    // The office authors most of its props inline, so identical definitions —
    // the five book cloths on every shelf, one colour per star in the skylight —
    // used to produce one material instance per mesh, and each instance is its
    // own GPU state change. Identical definitions are therefore interned.
    // Materials the draw loop writes to are built directly instead, so that
    // pulsing one screen cannot pulse every screen in the room.
    const materialCache = new Map<string, THREE.Material>()
    const shared = <T extends THREE.Material>(key: string, create: () => T) => {
      const cached = materialCache.get(key)
      if (cached) return cached as T
      const material = create()
      materialCache.set(key, material)
      return material
    }
    const sharedStandard = (parameters: THREE.MeshStandardMaterialParameters) =>
      shared(`s|${JSON.stringify(parameters)}`, () => new THREE.MeshStandardMaterial(parameters))
    const sharedBasic = (parameters: THREE.MeshBasicMaterialParameters) =>
      shared(`b|${JSON.stringify(parameters)}`, () => new THREE.MeshBasicMaterial(parameters))

    const attachFocus = (
      keys: string[],
      object: THREE.Object3D,
      radius = .72,
      y = .12,
      rotation: [number, number, number] = [Math.PI / 2, 0, 0],
    ) => {
      const halo = addMesh(object, new THREE.TorusGeometry(radius, .036, 8, 40), focusMaterial, [0, y, 0], rotation)
      halo.visible = false
      halo.userData.navIgnore = true
      halo.castShadow = false
      halo.receiveShadow = false
      focusHalos.push(halo)
      keys.forEach((key) => focusTargets.set(key, { object, halo }))
      return halo
    }

    const zoneAssets = (zone: OfficeVisualZone) => assetsByZone.get(zone) ?? []

    phase('materials+textures')
    // Architectural shell: tier zero is a genuinely built timber shack. Each
    // later level keeps the volume but upgrades its finish, structure and trim.
    const sideWallColor = new THREE.Color(look.wall).lerp(new THREE.Color(look.darkWood), rustic ? .54 : .28).getHex()
    const sideWall = new THREE.MeshStandardMaterial({ color: sideWallColor, roughness: rustic ? .98 : .86 })
    addMesh(root, new THREE.PlaneGeometry(roomWidth, 11), new THREE.MeshStandardMaterial({ map: floorMap, bumpMap: floorMap, bumpScale: rustic ? .045 : .016, color: look.floor, roughness: rustic ? .95 : .62 }), [0, 0, .5], [-Math.PI / 2, 0, 0])
    addMesh(root, new THREE.PlaneGeometry(roomWidth, 6.8), wall, [0, 3.35, -4.1])
    addMesh(root, constantGeometry('PlaneGeometry:10,6.8', () => new THREE.PlaneGeometry(10, 6.8)), sideWall, [-roomHalf + .05, 3.35, .35], [0, Math.PI / 2, 0])
    addMesh(root, constantGeometry('PlaneGeometry:10,6.8', () => new THREE.PlaneGeometry(10, 6.8)), sideWall, [roomHalf - .05, 3.35, .35], [0, -Math.PI / 2, 0])
    const rearWallZ = 5.38
    const rearWallMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.wall).lerp(new THREE.Color(look.darkWood), rustic ? .5 : .22), map: rustic ? wallMap : null, bumpMap: rustic ? wallMap : null, bumpScale: rustic ? .05 : 0, roughness: rustic ? .98 : .82 })
    addMesh(root, new THREE.PlaneGeometry(roomWidth, 6.8), rearWallMaterial, [0, 3.35, rearWallZ], [0, Math.PI, 0])

    // The former camera opening is now a finished reception wall. A central
    // door, storage runs, sconces, and wall panels make the reverse view a
    // designed part of every office rather than the exposed back of a set.
    const rearDoor = new THREE.Group()
    rearDoor.position.set(0, 0, rearWallZ - .08)
    rearDoor.rotation.y = Math.PI
    root.add(rearDoor)
    addMesh(rearDoor, roundedBox(rustic ? 1.72 : 2.05, 4.72, .16, 4, .045), rustic ? wood : charcoal, [0, 2.35, 0])
    addMesh(rearDoor, roundedBox(rustic ? 1.4 : 1.68, 4.35, .065, 4, .025), rustic ? darkWood : wood, [0, 2.35, .1])
    addMesh(rearDoor, roundedBox(rustic ? .92 : 1.14, 1.42, .035, 4, .02), new THREE.MeshStandardMaterial({ color: rustic ? 0x4d625e : 0x31515d, emissive: rustic ? 0x101714 : 0x102b32, emissiveIntensity: .18, roughness: .28, metalness: .12 }), [0, 3.2, .145])
    addMesh(rearDoor, constantGeometry('CylinderGeometry:.07,.07,.05,18', () => new THREE.CylinderGeometry(.07, .07, .05, 18)), brass, [-.58, 2.15, .17], [Math.PI / 2, 0, 0])
    addMesh(rearDoor, roundedBox(1.12, .27, .035, 3, .015), brass, [0, 4.28, .15])

    const catEyes: Array<{ white: THREE.Mesh; pupil: THREE.Mesh }> = []
    for (const side of [-1, 1]) {
      const cabinetX = side * Math.min(roomHalf - 2.05, 4.9)
      const rearCabinet = new THREE.Group()
      rearCabinet.position.set(cabinetX, 0, rearWallZ - .42)
      rearCabinet.rotation.y = Math.PI
      root.add(rearCabinet)
      addMesh(rearCabinet, roundedBox(2.65, 1.02, .58, 4, .045), rustic ? darkWood : charcoal, [0, .52, 0])
      for (let drawer = 0; drawer < 3; drawer += 1) {
        addMesh(rearCabinet, roundedBox(.72, .34, .035, 3, .018), rustic ? wood : darkWood, [-.82 + drawer * .82, .57, .31])
        addMesh(rearCabinet, constantGeometry('BoxGeometry:.2,.025,.02', () => new THREE.BoxGeometry(.2, .025, .02)), brass, [-.82 + drawer * .82, .57, .34])
      }
      const sconce = new THREE.PointLight(rustic ? 0xffbd73 : 0xffdaa0, rustic ? .42 : .62, 4.1, 1.75)
      sconce.position.set(cabinetX, 3.8, rearWallZ - .65)
      root.add(sconce)
      addMesh(root, constantGeometry('CylinderGeometry:.18,.22,.07,18', () => new THREE.CylinderGeometry(.18, .22, .07, 18)), brass, [cabinetX, 3.78, rearWallZ - .22], [Math.PI / 2, 0, 0])
      addMesh(root, constantGeometry('SphereGeometry:.16,18,12', () => new THREE.SphereGeometry(.16, 18, 12)), glow, [cabinetX, 3.78, rearWallZ - .35])

      const rearFrame = new THREE.Group()
      rearFrame.position.set(side * 2.75, 3.28, rearWallZ - .1)
      rearFrame.rotation.y = Math.PI
      root.add(rearFrame)
      addMesh(rearFrame, roundedBox(1.62, 1.48, .075, 3, .03), darkWood, [0, 0, 0])
      addMesh(rearFrame, roundedBox(1.36, 1.22, .03, 3, .018), side < 0 ? paper : teal, [0, 0, .055])
      if (side < 0) {
        for (let line = 0; line < 4; line += 1) addMesh(rearFrame, new THREE.BoxGeometry(.88 - line * .08, .025, .018), line === 0 ? brass : charcoal, [0, .34 - line * .2, .08])
      } else {
        addMesh(rearFrame, constantGeometry('TorusGeometry:.34,.025,10,36', () => new THREE.TorusGeometry(.34, .025, 10, 36)), brass, [0, 0, .08])
        addMesh(rearFrame, constantGeometry('CylinderGeometry:.11,.11,.025,24', () => new THREE.CylinderGeometry(.11, .11, .025, 24)), paper, [0, 0, .09], [Math.PI / 2, 0, 0])
      }
    }

    // Side-wall panel rhythm provides orientation while rotating and gives
    // later installations intentional surfaces to occupy.
    for (const side of [-1, 1]) {
      for (let panel = 0; panel < 3; panel += 1) {
        const z = -2.45 + panel * 2.65
        addMesh(root, roundedBox(1.62, 2.05, .055, 3, .025), darkWood, [side * (roomHalf - .12), 3.05, z], [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0])
        addMesh(root, roundedBox(1.28, 1.7, .025, 3, .018), sharedStandard({ color: (panel % 2 ? new THREE.Color(look.upholstery).offsetHSL(0, -.08, .08) : new THREE.Color(look.wall).offsetHSL(0, -.04, .06)).getHex(), roughness: .9 }), [side * (roomHalf - .08), 3.05, z], [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0])
        addMesh(root, roundedBox(.82, .055, .018, 2, .01), brass, [side * (roomHalf - .055), 3.42, z], [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0])
        // One lit indicator per bay reads as a panel light; the two dark discs
        // beside it were noise at every distance the camera actually sits.
        addMesh(root, constantGeometry('CylinderGeometry:.045,.045,.018,12', () => new THREE.CylinderGeometry(.045, .045, .018, 12)), glow, [side * (roomHalf - .045), 3.05, z], [0, 0, Math.PI / 2])
      }
    }
    let hearthEmber: THREE.Mesh | null = null
    let hearthLight: THREE.PointLight | null = null
    if (rustic) {
      // Uneven boards, exposed posts, sill and diagonal wind braces create the
      // room silhouette before any furniture is added.
      for (let row = 0; row < 10; row += 1) {
        const y = .32 + row * .67
        addMesh(root, new THREE.BoxGeometry(roomWidth + .05, .61, .18 + seeded(row + 40) * .05), wall, [(seeded(row + 9) - .5) * .09, y, -3.98], [0, 0, (seeded(row + 70) - .5) * .008])
      }
      const postCount = Math.max(6, Math.round(roomWidth / 2.5))
      for (let post = 0; post < postCount; post += 1) {
        const x = -roomHalf + .72 + post * ((roomWidth - 1.44) / Math.max(1, postCount - 1))
        addMesh(root, constantGeometry('BoxGeometry:.22,6.75,.34', () => new THREE.BoxGeometry(.22, 6.75, .34)), darkWood, [x, 3.36, -3.72])
      }
      addMesh(root, new THREE.BoxGeometry(roomWidth, .32, .44), darkWood, [0, .19, -3.65])
      addMesh(root, constantGeometry('BoxGeometry:.25,5.4,.34', () => new THREE.BoxGeometry(.25, 5.4, .34)), darkWood, [4.65, 3.15, -3.62], [0, 0, -.62])
      addMesh(root, constantGeometry('BoxGeometry:.25,5.0,.34', () => new THREE.BoxGeometry(.25, 5.0, .34)), darkWood, [-5.75, 3.25, -3.62], [0, 0, .54])
      // A low plank ceiling and exposed joists complete the timber envelope.
      // This keeps the shack from reading as furniture floating in a box.
      addMesh(root, new THREE.PlaneGeometry(roomWidth, 10.6), new THREE.MeshStandardMaterial({ color: 0x241711, map: wallMap, bumpMap: wallMap, bumpScale: .05, roughness: 1, side: THREE.DoubleSide }), [0, 6.62, .4], [Math.PI / 2, 0, 0])
      const joistCount = Math.max(7, Math.round(roomWidth / 2.15))
      for (let index = 0; index < joistCount; index += 1) addMesh(root, constantGeometry('BoxGeometry:.3,.34,10.7', () => new THREE.BoxGeometry(.3, .34, 10.7)), darkWood, [-roomHalf + .6 + index * ((roomWidth - 1.2) / Math.max(1, joistCount - 1)), 6.43, .2], [0, 0, index % 2 ? .035 : -.035])
      for (const z of [-3.55, 1.45, 5.15]) addMesh(root, new THREE.BoxGeometry(roomWidth - .45, .24, .32), darkWood, [0, 6.31, z], [0, 0, z > 0 ? .012 : -.01])
    } else {
      addMesh(root, new THREE.BoxGeometry(roomWidth, .18, .22), darkWood, [0, 1.15, -3.91])
      const trimCount = Math.min(12, 5 + Math.floor(roomWidth / 3))
      for (let index = 0; index < trimCount; index += 1) addMesh(root, constantGeometry('BoxGeometry:.16,.18,10', () => new THREE.BoxGeometry(.16, .18, 10)), level >= 10 ? brass : darkWood, [-roomHalf + .8 + index * ((roomWidth - 1.6) / Math.max(1, trimCount - 1)), 6.55, .45], [0, 0, index % 2 ? .018 : -.018])

      // The headquarters is rebuilt in coherent architectural stages. Early
      // tiers retain timber wainscot; city tiers gain panel bays and crown
      // moulding; international/frontier tiers introduce stone and metal.
      const lowerWallMaterial = !executive ? wood : !international ? darkWood : charcoal
      addMesh(root, new THREE.BoxGeometry(roomWidth - .2, 1.42 + Math.min(.45, level * .04), .18), lowerWallMaterial, [0, .76 + Math.min(.2, level * .02), -3.82])
      addMesh(root, new THREE.BoxGeometry(roomWidth - .08, .12, .28), level >= 8 ? brass : darkWood, [0, 1.52 + Math.min(.38, level * .04), -3.72])
      const panelCount = Math.min(international ? 10 : 8, 3 + Math.floor(roomWidth / 3))
      for (let panel = 0; panel < panelCount; panel += 1) {
        const x = -roomHalf + .9 + panel * ((roomWidth - 1.8) / Math.max(1, panelCount - 1))
        addMesh(root, new THREE.BoxGeometry(level >= 10 ? .09 : .13, 1.18, .08), level >= 8 ? brass : darkWood, [x, .79, -3.65])
      }
      addMesh(root, new THREE.BoxGeometry(roomWidth, .22, .31), level >= 10 ? brass : darkWood, [0, 6.35, -3.64])
      if (level >= 3) {
        const cofferCount = Math.min(9, 3 + Math.floor(roomWidth / 3.2))
        for (let beam = 0; beam < cofferCount; beam += 1) {
          const x = -roomHalf + 1 + beam * ((roomWidth - 2) / Math.max(1, cofferCount - 1))
          addMesh(root, new THREE.BoxGeometry(level >= 10 ? .1 : .18, .16, 10.35), level >= 10 ? brass : darkWood, [x, 6.46, .42])
        }
      }
    }

    phase('shell')
    // Window: the first office looks over scrub and crooked roofs; each later
    // headquarters gets an exterior appropriate to its named region.
    const windowWidth = rustic ? 2.85 : 3.5 + Math.min(.65, level * .045)
    const windowHeight = rustic ? 2.55 : 3.45 + Math.min(.35, level * .025)
    const windowX = rustic ? -3.62 : -3.2
    const windowGroup = new THREE.Group()
    windowGroup.position.set(windowX, rustic ? 3.22 : 3.25, -3.94)
    root.add(windowGroup)
    const windowAnchor = new THREE.Object3D()
    windowAnchor.position.set(0, 0, .28)
    windowGroup.add(windowAnchor)
    const empireAnchor = new THREE.Object3D()
    empireAnchor.position.set(windowWidth * .32, .12, .3)
    windowGroup.add(empireAnchor)
    addMesh(windowGroup, new THREE.PlaneGeometry(windowWidth, windowHeight), new THREE.MeshBasicMaterial({ color: look.sky }), [0, 0, .015])
    const exterior = new THREE.Group()
    const exteriorMovers: THREE.Object3D[] = []
    windowGroup.add(exterior)
    // Exterior movers keep their own material: the draw loop writes a per-object
    // phase into it, so interning them would lock the whole skyline into one
    // pulse.
    if (look.exterior === 'forest') {
      addMesh(exterior, constantGeometry('CircleGeometry:.23,20', () => new THREE.CircleGeometry(.23, 20)), sharedBasic({ color: 0xb3a47a }), [.72, .72, .06])
      for (let index = 0; index < 12; index += 1) {
        const height = .5 + seeded(index + 9) * .92
        const tree = addMesh(exterior, new THREE.ConeGeometry(.14 + height * .12, height, 7), new THREE.MeshStandardMaterial({ color: index % 2 ? 0x13251f : 0x1a2f27, roughness: 1 }), [-1.34 + index * .24, -1.25 + height / 2, .08])
        tree.castShadow = false
        tree.userData.restRotation = tree.rotation.z
        exteriorMovers.push(tree)
      }
      addMesh(exterior, constantGeometry('BoxGeometry:1.2,.48,.05', () => new THREE.BoxGeometry(1.2, .48, .05)), sharedStandard({ color: 0x271b18, roughness: 1 }), [-.58, -1.03, .1])
      addMesh(exterior, constantGeometry('ConeGeometry:.88,.45,4', () => new THREE.ConeGeometry(.88, .45, 4)), sharedStandard({ color: 0x38251e, roughness: 1 }), [-.58, -.69, .1], [0, 0, Math.PI / 4])
    } else if (look.exterior === 'ocean') {
      for (let band = 0; band < 5; band += 1) addMesh(exterior, new THREE.PlaneGeometry(windowWidth, .12), sharedBasic({ color: band % 2 ? 0x245b68 : 0x337786, transparent: true, opacity: .6 }), [0, -1.15 + band * .15, .07])
    } else if (look.exterior === 'orbit' || look.exterior === 'lunar' || look.exterior === 'nexus') {
      const planetColor = look.exterior === 'lunar' ? 0xbec1ba : look.exterior === 'nexus' ? 0x427d91 : 0x315f78
      addMesh(exterior, new THREE.CircleGeometry(look.exterior === 'nexus' ? .62 : .88, 32), sharedStandard({ color: planetColor, emissive: planetColor, emissiveIntensity: .12, roughness: .84 }), [.56, -.08, .07])
      for (let index = 0; index < 28; index += 1) addMesh(exterior, new THREE.CircleGeometry(.008 + seeded(index) * .013, 6), sharedBasic({ color: index % 4 ? 0xb7cad1 : 0xd6b76a }), [-windowWidth / 2 + seeded(index * 2) * windowWidth, -windowHeight / 2 + seeded(index * 2 + 1) * windowHeight, .09])
    } else {
      const count = 12 + Math.min(12, level)
      for (let index = 0; index < count; index += 1) {
        const width = .14 + seeded(index + 2) * .25
        const height = .35 + seeded(index + 9) * (look.exterior === 'street' ? .8 : 1.48)
        const moving = index % 4 === 0
        const material = moving
          ? new THREE.MeshStandardMaterial({ color: index % 3 ? 0x0c1826 : 0x14283b, emissive: 0x6e5730, emissiveIntensity: .18 + level * .01 })
          : sharedStandard({ color: index % 3 ? 0x0c1826 : 0x14283b, emissive: 0x07101a, emissiveIntensity: .18 + level * .01 })
        const building = addMesh(exterior, new THREE.BoxGeometry(width, height, .06), material, [-windowWidth / 2 + .18 + index * ((windowWidth - .36) / Math.max(1, count - 1)), -windowHeight / 2 + height / 2, .08])
        building.castShadow = false
        if (moving) {
          exteriorMovers.push(building)
        }
      }
      if (look.exterior === 'harbor') addMesh(exterior, new THREE.PlaneGeometry(windowWidth, .42), sharedBasic({ color: 0x174759, transparent: true, opacity: .72 }), [0, -windowHeight / 2 + .2, .1])
    }
    const glass = addMesh(windowGroup, new THREE.PlaneGeometry(windowWidth, windowHeight), new THREE.MeshStandardMaterial({ color: rustic ? 0x465f62 : 0x5d899f, transparent: true, opacity: rustic ? .34 : .22, roughness: rustic ? .34 : .2, metalness: .05 }), [0, 0, .14])
    glass.castShadow = false
    const frameMaterial = rustic ? darkWood : brass
    addMesh(windowGroup, new THREE.BoxGeometry(windowWidth + .3, rustic ? .19 : .12, .18), frameMaterial, [0, windowHeight / 2 + .11, .19])
    addMesh(windowGroup, new THREE.BoxGeometry(windowWidth + .3, rustic ? .22 : .12, .18), frameMaterial, [0, -windowHeight / 2 - .11, .19])
    addMesh(windowGroup, new THREE.BoxGeometry(rustic ? .2 : .12, windowHeight + .28, .18), frameMaterial, [-windowWidth / 2 - .1, 0, .19])
    addMesh(windowGroup, new THREE.BoxGeometry(rustic ? .2 : .12, windowHeight + .28, .18), frameMaterial, [windowWidth / 2 + .1, 0, .19])
    addMesh(windowGroup, new THREE.BoxGeometry(rustic ? .13 : .08, windowHeight, .14), frameMaterial, [0, 0, .2])
    addMesh(windowGroup, new THREE.BoxGeometry(windowWidth, rustic ? .13 : .08, .14), frameMaterial, [0, rustic ? .08 : 0, .2], [0, 0, rustic ? -.018 : 0])

    const rainCount = 90
    const rainPositions = new Float32Array(rainCount * 6)
    for (let index = 0; index < rainCount; index += 1) {
      const x = -windowWidth / 2 + .08 + seeded(index * 2) * (windowWidth - .16)
      const y = -windowHeight / 2 + .08 + seeded(index * 2 + 1) * (windowHeight - .16)
      rainPositions[index * 6] = x; rainPositions[index * 6 + 1] = y; rainPositions[index * 6 + 2] = .24
      rainPositions[index * 6 + 3] = x - .055; rainPositions[index * 6 + 4] = y - (rustic ? .15 : .2); rainPositions[index * 6 + 5] = .24
    }
    const rainGeometry = new THREE.BufferGeometry()
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3))
    const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xa5d1dc, transparent: true, opacity: .42 }))
    windowGroup.add(rain)

    // Storage grows from a hand-built shelf into a full legal library.
    const books: THREE.Mesh[] = []
    const addShelf = (x: number) => {
      const shelf = new THREE.Group()
      shelf.position.set(x, rustic ? 2.35 : 2.65, -3.55)
      root.add(shelf)
      if (rustic) {
        addMesh(shelf, constantGeometry('BoxGeometry:.18,4.5,.56', () => new THREE.BoxGeometry(.18, 4.5, .56)), darkWood, [-.77, 0, 0])
        addMesh(shelf, constantGeometry('BoxGeometry:.18,4.5,.56', () => new THREE.BoxGeometry(.18, 4.5, .56)), darkWood, [.77, 0, 0])
        for (let row = 0; row < 4; row += 1) addMesh(shelf, constantGeometry('BoxGeometry:1.78,.16,.7', () => new THREE.BoxGeometry(1.78, .16, .7)), wood, [0, -2.02 + row * 1.35, .05], [0, 0, (row % 2 ? 1 : -1) * .012])
        for (let row = 0; row < 3; row += 1) {
          for (let column = 0; column < 4 + row; column += 1) {
            const height = .46 + seeded(row * 17 + column) * .27
            const palette = [0x574237, 0x3b4b49, 0x77593b, 0x4f3e35]
            const book = addMesh(shelf, new THREE.BoxGeometry(.14 + seeded(column) * .045, height, .35), sharedStandard({ color: palette[(row + column) % palette.length], roughness: .94 }), [-.58 + column * .23, -1.94 + row * 1.35 + height / 2, .24], [0, 0, (seeded(column + row * 6) - .5) * .06])
            books.push(book)
          }
        }
        addMesh(shelf, constantGeometry('BoxGeometry:1.28,.56,.58', () => new THREE.BoxGeometry(1.28, .56, .58)), wood, [0, 1.68, .13])
        addMesh(shelf, constantGeometry('BoxGeometry:1.05,.035,.6', () => new THREE.BoxGeometry(1.05, .035, .6)), darkWood, [0, 1.69, .44])
      } else {
        addMesh(shelf, roundedBox(1.8, 5.15, .48, 3, .05), darkWood, [0, 0, 0])
        addMesh(shelf, roundedBox(1.55, 4.75, .54, 3, .04), sharedStandard({ color: level >= 10 ? 0x121c27 : 0x101923, roughness: .85 }), [0, 0, .05])
        const rowCount = Math.min(5, 3 + Math.floor(level / 4))
        for (let row = 0; row < rowCount; row += 1) {
          const rowY = -1.85 + row * (4.55 / Math.max(1, rowCount - 1))
          addMesh(shelf, constantGeometry('BoxGeometry:1.68,.11,.65', () => new THREE.BoxGeometry(1.68, .11, .65)), wood, [0, rowY, .18])
          const columnCount = Math.min(9, 6 + Math.floor(level / 3))
          for (let column = 0; column < columnCount; column += 1) {
            const height = .48 + seeded(row * 17 + column) * .31
            const palette = [0x75503f, 0x415c66, 0x9b713c, 0x4e6050, 0x5d455c]
            const book = addMesh(shelf, roundedBox(.11 + seeded(column) * .04, height, .38, 2, .018), sharedStandard({ color: palette[(row * 3 + column) % palette.length], roughness: .72 }), [-.64 + column * (1.3 / Math.max(1, columnCount - 1)), rowY + .055 + height / 2, .27], [0, 0, (seeded(column + row * 6) - .5) * .045])
            books.push(book)
          }
        }
      }
    }
    if (!rustic && level >= 2) addShelf(-6.15)
    addShelf(rustic ? 6.05 : 6.15)
    if (rustic) {
      // A joined file chest and working cast-iron stove make the room a
      // believable cold-weather practice rather than a collection of props.
      addMesh(root, constantGeometry('BoxGeometry:1.35,.72,.92', () => new THREE.BoxGeometry(1.35, .72, .92)), wood, [-5.55, .38, 1.35])
      addMesh(root, constantGeometry('BoxGeometry:1.42,.09,.99', () => new THREE.BoxGeometry(1.42, .09, .99)), darkWood, [-5.55, .79, 1.35], [0, 0, -.035])
      for (const x of [-6.12, -4.98]) addMesh(root, constantGeometry('BoxGeometry:.08,.78,.98', () => new THREE.BoxGeometry(.08, .78, .98)), brass, [x, .4, 1.35])
      for (let index = 0; index < 4; index += 1) addMesh(root, constantGeometry('CylinderGeometry:.055,.055,1.0,10', () => new THREE.CylinderGeometry(.055, .055, 1.0, 10)), paper, [-5.9 + index * .18, 1.06, .86], [0, 0, -.18 + index * .07])

      const hearth = new THREE.Group()
      hearth.position.set(-5.82, 0, -2.6)
      root.add(hearth)
      const fieldStone = new THREE.MeshStandardMaterial({ color: 0x4b453e, roughness: 1, metalness: 0 })
      for (let stone = 0; stone < 13; stone += 1) {
        const row = Math.floor(stone / 5)
        const column = stone % 5
        const stoneMesh = addMesh(hearth, roundedBox(.42 + seeded(stone) * .16, .24 + seeded(stone + 3) * .13, .52, 2, .045), fieldStone, [-1.03 + column * .49 + (row % 2) * .09, .15 + row * .27, .1], [0, (seeded(stone + 8) - .5) * .13, (seeded(stone + 14) - .5) * .08])
        stoneMesh.castShadow = true
      }
      addMesh(hearth, roundedBox(1.2, .82, .72, 4, .09), charcoal, [0, .92, .02])
      addMesh(hearth, roundedBox(.78, .46, .04, 3, .04), new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: .74, metalness: .66 }), [0, .93, .4])
      const emberMaterial = new THREE.MeshStandardMaterial({ color: 0x8b2f18, emissive: 0xd54b20, emissiveIntensity: .65, roughness: .88 })
      hearthEmber = addMesh(hearth, constantGeometry('PlaneGeometry:.54,.23', () => new THREE.PlaneGeometry(.54, .23)), emberMaterial, [0, .9, .43])
      hearthEmber.castShadow = false
      hearthLight = new THREE.PointLight(0xff7d31, .52, 3.6, 1.8)
      hearthLight.position.set(0, .92, .72)
      hearth.add(hearthLight)
      addMesh(hearth, constantGeometry('CylinderGeometry:.18,.2,4.25,18', () => new THREE.CylinderGeometry(.18, .2, 4.25, 18)), charcoal, [.22, 3.25, -.05])
      addMesh(hearth, constantGeometry('BoxGeometry:1.42,.12,.9', () => new THREE.BoxGeometry(1.42, .12, .9)), darkWood, [0, 1.39, -.02])
      for (const x of [-.46, .46]) addMesh(hearth, constantGeometry('CylinderGeometry:.055,.07,.36,10', () => new THREE.CylinderGeometry(.055, .07, .36, 10)), charcoal, [x, .38, 0])

      // One continuous peg rail ties the working wall together.
      addMesh(root, constantGeometry('BoxGeometry:2.05,.16,.18', () => new THREE.BoxGeometry(2.05, .16, .18)), wood, [4.95, 2.18, -3.62], [0, 0, -.012])
      for (let peg = 0; peg < 5; peg += 1) addMesh(root, constantGeometry('CylinderGeometry:.035,.045,.27,10', () => new THREE.CylinderGeometry(.035, .045, .27, 10)), brass, [4.18 + peg * .38, 2.06, -3.38], [Math.PI / 2, 0, 0])
    } else if (heritage) {
      // Tier one is a repaired neighborhood office: it keeps the original
      // timber history, but adds fitted filing drawers and proper task light.
      for (let drawer = 0; drawer < 3; drawer += 1) {
        addMesh(root, roundedBox(1.28, .43, .62, 3, .04), darkWood, [-5.62, .28 + drawer * .46, -.65])
        addMesh(root, constantGeometry('BoxGeometry:.32,.035,.035', () => new THREE.BoxGeometry(.32, .035, .035)), brass, [-5.62, .28 + drawer * .46, -.31])
      }
    }

    // The work surface is a scarred trestle table in the shack and becomes a
    // progressively engineered partner desk as the firm rises.
    const desk = new THREE.Group()
    desk.position.set(rustic ? .92 : 1.08, 0, rustic ? -.98 : -1.34)
    desk.scale.setScalar(rustic ? .86 : .76)
    root.add(desk)
    if (rustic) {
      for (let plank = 0; plank < 5; plank += 1) addMesh(desk, new THREE.BoxGeometry(5.45, .16 + seeded(plank + 120) * .04, .35), wood, [(seeded(plank + 80) - .5) * .06, 1.25 + (plank % 2) * .018, -.7 + plank * .35], [0, (seeded(plank + 30) - .5) * .025, (seeded(plank + 15) - .5) * .012])
      for (const x of [-2.18, 2.18]) {
        addMesh(desk, constantGeometry('BoxGeometry:.24,1.22,1.25', () => new THREE.BoxGeometry(.24, 1.22, 1.25)), darkWood, [x, .62, 0], [0, 0, x < 0 ? -.08 : .08])
        addMesh(desk, constantGeometry('BoxGeometry:.2,1.65,.2', () => new THREE.BoxGeometry(.2, 1.65, .2)), darkWood, [x * .92, .55, .49], [0, 0, x < 0 ? -.18 : .18])
        addMesh(desk, constantGeometry('BoxGeometry:.2,1.65,.2', () => new THREE.BoxGeometry(.2, 1.65, .2)), darkWood, [x * .92, .55, -.49], [0, 0, x < 0 ? -.18 : .18])
      }
      addMesh(desk, constantGeometry('BoxGeometry:4.3,.14,.18', () => new THREE.BoxGeometry(4.3, .14, .18)), darkWood, [0, .56, .02])
    } else {
      addMesh(desk, roundedBox(5.35, .25, 1.78, 5, .08), wood, [0, 1.28, 0])
      addMesh(desk, roundedBox(5.05, 1.18, 1.42, 4, .04), darkWood, [0, .63, .03])
      addMesh(desk, roundedBox(1.42, .75, .055, 3, .03), leather, [0, .68, .76])
      addMesh(desk, constantGeometry('BoxGeometry:.18,.72,1.18', () => new THREE.BoxGeometry(.18, .72, 1.18)), brass, [-2.18, .66, .03])
      addMesh(desk, constantGeometry('BoxGeometry:.18,.72,1.18', () => new THREE.BoxGeometry(.18, .72, 1.18)), brass, [2.18, .66, .03])
    }

    // Tier zero uses a repaired manual typewriter; screens and extra displays
    // arrive only as the firm's actual case-management capacity grows.
    if (rustic) {
      addMesh(desk, constantGeometry('BoxGeometry:1.48,.24,.82', () => new THREE.BoxGeometry(1.48, .24, .82)), charcoal, [-.82, 1.48, -.08], [-.04, .08, 0])
      addMesh(desk, constantGeometry('BoxGeometry:1.12,.38,.22', () => new THREE.BoxGeometry(1.12, .38, .22)), charcoal, [-.82, 1.71, -.34], [-.08, .08, 0])
      for (let row = 0; row < 3; row += 1) for (let key = 0; key < 8; key += 1) addMesh(desk, constantGeometry('CylinderGeometry:.035,.035,.022,8', () => new THREE.CylinderGeometry(.035, .035, .022, 8)), paper, [-1.27 + key * .13, 1.62 - row * .06, .02 + row * .12], [Math.PI / 2, 0, 0])
      addMesh(desk, constantGeometry('PlaneGeometry:.82,.76', () => new THREE.PlaneGeometry(.82, .76)), paper, [-.82, 2.0, -.37], [-.13, .08, 0])
      addMesh(desk, constantGeometry('CylinderGeometry:.035,.035,1.32,12', () => new THREE.CylinderGeometry(.035, .035, 1.32, 12)), brass, [-.82, 1.84, -.31], [0, 0, Math.PI / 2])
    } else {
      // One composed workstation anchors the desk. Secondary displays arrive
      // as small, angled wings at senior tiers instead of reading as two
      // unrelated screens floating in the camera foreground.
      addMesh(desk, roundedBox(1.42, .82, .075, 4, .035), charcoal, [-.7, 1.91, -.31], [-.075, .04, 0])
      const display = addMesh(desk, constantGeometry('PlaneGeometry:1.27,.67', () => new THREE.PlaneGeometry(1.27, .67)), screen, [-.7, 1.91, -.26], [-.075, .04, 0])
      display.castShadow = false
      addMesh(desk, constantGeometry('CylinderGeometry:.075,.1,.54,18', () => new THREE.CylinderGeometry(.075, .1, .54, 18)), charcoal, [-.7, 1.55, -.3])
      addMesh(desk, roundedBox(.62, .045, .34, 3, .022), charcoal, [-.7, 1.32, -.18])
      const keyboard = new THREE.Group(); keyboard.position.set(-.42, 1.39, .31); keyboard.rotation.x = -.035; desk.add(keyboard)
      addMesh(keyboard, roundedBox(1.22, .06, .42, 3, .022), charcoal, [0, 0, 0])
      for (let row = 0; row < 3; row += 1) for (let key = 0; key < 9; key += 1) {
        addMesh(keyboard, roundedBox(.085, .018, .07, 2, .008), key % 4 ? paper : brass, [-.44 + key * .11, .045, -.1 + row * .11])
      }
      const extraDisplays = level >= 4 ? 1 + Math.floor((level - 4) / 5) : 0
      for (let monitor = 0; monitor < extraDisplays; monitor += 1) {
        const x = -1.66 - monitor * .64
        addMesh(desk, roundedBox(.54, .36, .05, 3, .022), charcoal, [x, 1.72, -.2], [-.055, .2 + monitor * .06, 0])
        addMesh(desk, constantGeometry('PlaneGeometry:.46,.29', () => new THREE.PlaneGeometry(.46, .29)), screen, [x, 1.72, -.168], [-.055, .2 + monitor * .06, 0]).castShadow = false
      }
    }
    for (let index = 0; index < (rustic ? 7 : 4); index += 1) addMesh(desk, roundedBox(1.05 - Math.min(index, 3) * .05, .025, .72, 2, .008), index % 2 ? paper : new THREE.MeshStandardMaterial({ color: rustic ? 0x81785e : 0xb6c8b9, roughness: .9 }), [.35 + index * .018, 1.39 + index * .027, .16], [0, -.16 + index * .025, (seeded(index) - .5) * .02])
    const caseAnchor = new THREE.Object3D()
    caseAnchor.position.set(.38, 1.47, .2)
    if (!activeCase) desk.add(caseAnchor)
    const lampGroup = new THREE.Group()
    lampGroup.position.set(1.42, 1.42, -.18)
    desk.add(lampGroup)
    const lampAnchor = new THREE.Object3D()
    lampAnchor.position.set(0, rustic ? .52 : 1.05, .08)
    lampGroup.add(lampAnchor)
    let lanternFlame: THREE.Mesh | null = null
    if (rustic) {
      addMesh(lampGroup, constantGeometry('CylinderGeometry:.29,.36,.12,18', () => new THREE.CylinderGeometry(.29, .36, .12, 18)), charcoal, [0, 0, 0])
      addMesh(lampGroup, new THREE.CylinderGeometry(.25, .22, .66, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xd3a75c, transparent: true, opacity: .27, roughness: .25, side: THREE.DoubleSide }), [0, .38, 0])
      addMesh(lampGroup, constantGeometry('CylinderGeometry:.22,.28,.1,18', () => new THREE.CylinderGeometry(.22, .28, .1, 18)), charcoal, [0, .74, 0])
      addMesh(lampGroup, new THREE.TorusGeometry(.32, .025, 10, 30, Math.PI), charcoal, [0, .7, 0], [0, 0, 0])
      lanternFlame = addMesh(lampGroup, constantGeometry('ConeGeometry:.07,.28,12', () => new THREE.ConeGeometry(.07, .28, 12)), new THREE.MeshStandardMaterial({ color: 0xffc363, emissive: 0xff7a20, emissiveIntensity: 2.1, roughness: .4 }), [0, .3, 0])
    } else {
      addMesh(lampGroup, constantGeometry('CylinderGeometry:.35,.42,.08,28', () => new THREE.CylinderGeometry(.35, .42, .08, 28)), brass, [0, 0, 0])
      addMesh(lampGroup, constantGeometry('CylinderGeometry:.04,.04,1.2,18', () => new THREE.CylinderGeometry(.04, .04, 1.2, 18)), brass, [0, .58, 0], [0, 0, -.16])
      addMesh(lampGroup, new THREE.ConeGeometry(.48, .52, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x18252f, roughness: .35, metalness: .62, side: THREE.DoubleSide }), [-.1, 1.23, 0], [0, 0, Math.PI])
    }
    const deskLight = new THREE.PointLight(rustic ? 0xffad55 : 0xffc871, rustic ? 2.05 : 2.5, rustic ? 4.6 : 5.8, 1.45)
    deskLight.position.set(rustic ? 0 : -.1, rustic ? .42 : 1.02, .08)
    deskLight.castShadow = false
    lampGroup.add(deskLight)

    // Coffee mug and GPU-animated steam points.
    addMesh(desk, constantGeometry('CylinderGeometry:.17,.14,.38,24', () => new THREE.CylinderGeometry(.17, .14, .38, 24)), new THREE.MeshStandardMaterial({ color: rustic ? 0x425157 : 0xd8c9a4, roughness: rustic ? .72 : .42 }), [1.98, 1.52, .28])
    addMesh(desk, new THREE.TorusGeometry(.16, .035, 12, 24, Math.PI * 1.65), rustic ? charcoal : paper, [2.13, 1.53, .28], [Math.PI / 2, 0, Math.PI / 2])
    const coffeeAnchor = new THREE.Object3D()
    coffeeAnchor.position.set(1.98, 1.72, .28)
    desk.add(coffeeAnchor)
    const steamGeometry = new THREE.BufferGeometry()
    const steamPositions = new Float32Array(24 * 3)
    for (let index = 0; index < 24; index += 1) { steamPositions[index * 3] = 1.98 + (seeded(index) - .5) * .18; steamPositions[index * 3 + 1] = 1.82 + seeded(index + 7) * .65; steamPositions[index * 3 + 2] = .28 + (seeded(index + 13) - .5) * .16 }
    steamGeometry.setAttribute('position', new THREE.BufferAttribute(steamPositions, 3))
    const steam = new THREE.Points(steamGeometry, new THREE.PointsMaterial({ color: 0xe8e1d1, size: .045, transparent: true, opacity: .3, depthWrite: false }))
    desk.add(steam)

    // Seating follows the office: a repaired slat chair first, tailored leather
    // only after the practice reaches a real suite.
    const chair = new THREE.Group()
    // Keep the player's chair on the desk centreline. The previous generic
    // origin made the chair look unrelated to the monitor and keyboard when
    // the office was viewed from an angle.
    const chairHome = new THREE.Vector3(rustic ? .92 : 1.08, 0, rustic ? .62 : .42)
    const chairHomeRotation = rustic ? .18 : -.05
    const chairStorageKey = `lsat-tycoon:office-layout:${layoutKey ?? 'preview'}:${level}:chair-360-v2`
    chair.position.copy(chairHome)
    chair.rotation.y = chairHomeRotation
    chair.scale.setScalar(rustic ? .82 : .72)
    chair.userData.officeDraggable = 'chair'
    try {
      const saved = window.localStorage.getItem(chairStorageKey)
      if (saved) {
        const layout = JSON.parse(saved) as { x?: number; z?: number; rotation?: number }
        chair.position.x = THREE.MathUtils.clamp(Number(layout.x ?? chairHome.x), -3.25, 3.1)
        chair.position.z = THREE.MathUtils.clamp(Number(layout.z ?? chairHome.z), -.05, 1.15)
        chair.rotation.y = Number.isFinite(layout.rotation) ? Number(layout.rotation) : chairHomeRotation
      }
    } catch {
      // A corrupt local layout should never prevent the office from opening.
    }
    root.add(chair)
    if (rustic) {
      addMesh(chair, constantGeometry('BoxGeometry:1.15,.18,1.0', () => new THREE.BoxGeometry(1.15, .18, 1.0)), wood, [0, 1.02, 0], [-.025, 0, 0])
      for (const x of [-.47, .47]) for (const z of [-.38, .38]) addMesh(chair, constantGeometry('BoxGeometry:.13,1.1,.13', () => new THREE.BoxGeometry(.13, 1.1, .13)), darkWood, [x, .51, z], [z > 0 ? -.07 : .04, 0, x < 0 ? -.025 : .025])
      addMesh(chair, constantGeometry('BoxGeometry:.14,1.75,.16', () => new THREE.BoxGeometry(.14, 1.75, .16)), darkWood, [-.47, 1.72, -.4], [-.08, 0, 0])
      addMesh(chair, constantGeometry('BoxGeometry:.14,1.75,.16', () => new THREE.BoxGeometry(.14, 1.75, .16)), darkWood, [.47, 1.72, -.4], [-.08, 0, 0])
      for (let slat = 0; slat < 3; slat += 1) addMesh(chair, constantGeometry('BoxGeometry:.75,.16,.1', () => new THREE.BoxGeometry(.75, .16, .1)), wood, [0, 1.43 + slat * .38, -.41], [-.08, 0, slat === 1 ? .018 : -.012])
    } else {
      addMesh(chair, roundedBox(1.42, .34, 1.18, 5, .14), leather, [0, 1.1, 0])
      addMesh(chair, roundedBox(1.48, 1.75, .3, 6, .18), leather, [0, 2.05, -.48], [-.08, 0, 0])
      addMesh(chair, constantGeometry('CylinderGeometry:.07,.08,.9,16', () => new THREE.CylinderGeometry(.07, .08, .9, 16)), charcoal, [0, .62, 0])
      for (let index = 0; index < 5; index += 1) {
        const angle = index / 5 * Math.PI * 2
        addMesh(chair, constantGeometry('CylinderGeometry:.035,.035,.72,10', () => new THREE.CylinderGeometry(.035, .035, .72, 10)), charcoal, [Math.cos(angle) * .31, .19, Math.sin(angle) * .31], [Math.sin(angle) * Math.PI / 2, 0, -Math.cos(angle) * Math.PI / 2])
      }
    }
    const chairAnchor = new THREE.Object3D()
    chairAnchor.position.set(0, 1.25, .15)
    chair.add(chairAnchor)

    // A consultation only exists when the player has a matter open, which
    // makes the one character with click-to-look behaviour the hardest one in
    // the scene to get in front of a harness. Same reasoning as the tier and
    // staff overrides above, and compiled out of production the same way.
    const devCase = devQuery?.get('officeClient') === '1'
      ? { sessionId: 'dev', clientKey: 'dev-client', clientName: 'Dev Client', baseFee: 1000 } as unknown as ActiveOfficeCase
      : null
    const consultation = activeCase ?? devCase
    if (consultation) {
      const activeCase = consultation
      // An active matter becomes a physical consultation in the office. The
      // station remains beside the partner desk at every tier, rather than
      // borrowing a staff workstation or leaving the client in an aisle.
      // Seeded from the client's name and nothing else, because the contract
      // card's portrait seeds from exactly that too — this figure and that
      // portrait are the same client and have to be the same person. Session
      // and client key were unique per *matter*, which is how the two ended up
      // as two different faces. See `clientCastSeed`.
      const seed = clientCastSeed(activeCase.clientName)
      const clientStation = new THREE.Group()
      clientStation.position.set(rustic ? -2.32 : -2.62, 0, rustic ? .12 : .08)
      clientStation.rotation.y = rustic ? .18 : .12
      root.add(clientStation)

      const clientLeather = new THREE.MeshStandardMaterial({
        color: new THREE.Color(look.upholstery).offsetHSL((seed % 7 - 3) * .004, -.03, (seed % 5 - 2) * .012),
        roughness: rustic ? .91 : .54,
        metalness: rustic ? 0 : .05,
      })
      if (rustic) {
        addMesh(clientStation, roundedBox(.86, .14, .78, 3, .045), wood, [0, .48, 0])
        addMesh(clientStation, roundedBox(.84, .68, .12, 3, .035), wood, [0, .78, -.34], [-.08, 0, 0])
        for (const x of [-.34, .34]) for (const z of [-.27, .27]) addMesh(clientStation, constantGeometry('BoxGeometry:.09,.48,.09', () => new THREE.BoxGeometry(.09, .48, .09)), darkWood, [x, .24, z])
      } else {
        addMesh(clientStation, roundedBox(.94, .18, .82, 4, .075), clientLeather, [0, .48, 0])
        addMesh(clientStation, roundedBox(.92, .76, .16, 4, .07), clientLeather, [0, .83, -.35], [-.09, 0, 0])
        for (const x of [-.34, .34]) addMesh(clientStation, constantGeometry('CylinderGeometry:.035,.045,.47,12', () => new THREE.CylinderGeometry(.035, .045, .47, 12)), charcoal, [x, .23, 0])
      }

      // A small consultation table makes the seated placement intentional and
      // gives the client's file and coffee somewhere believable to live.
      addMesh(clientStation, constantGeometry('CylinderGeometry:.44,.4,.08,28', () => new THREE.CylinderGeometry(.44, .4, .08, 28)), rustic ? wood : darkWood, [.9, .72, -.12])
      addMesh(clientStation, constantGeometry('CylinderGeometry:.07,.11,.68,14', () => new THREE.CylinderGeometry(.07, .11, .68, 14)), rustic ? darkWood : brass, [.9, .36, -.12])

      const gender: CharacterGender = seed % 2 ? 'female' : 'male'
      const clientScale = (rustic ? .42 : .44) + (seed % 4) * .006
      const rig = buildStylizedCounsel(gender, level, { role: 'visitor', paletteSeed: seed, renderScale: clientScale })
      rig.root.scale.setScalar(clientScale)
      // Tiny deterministic proportion changes make repeat clients recognizable
      // without introducing a procedural-character system.
      const faceWidth = .97 + ((seed >>> 3) % 7) * .01
      const faceHeight = .98 + ((seed >>> 6) % 5) * .009
      rig.head.scale.set(faceWidth, faceHeight, 1)
      rig.satchel.visible = seed % 4 === 0

      // The standing character rig's long arm chain looks detached when bent
      // tightly into a chair. Replace only those limbs with a purpose-built
      // seated silhouette whose wrists terminate directly on the portfolio.
      const materialFrom = (object: THREE.Object3D, fallback: THREE.Material) => {
        let found: THREE.Material | null = null
        object.traverse((child) => {
          if (found || !(child instanceof THREE.Mesh)) return
          found = Array.isArray(child.material) ? child.material[0] : child.material
        })
        return found ?? fallback
      }
      const clientSuit = materialFrom(rig.leftShoulder, leather)
      const clientSkin = materialFrom(rig.leftHand, paper)
      rig.leftShoulder.visible = false
      rig.rightShoulder.visible = false
      // Glasses/lapel-pin variation now lives inside `buildStylizedCounsel`
      // itself (seeded off the same `paletteSeed`), so every portrait/scene
      // usage gets it, not just this seated visitor.

      const client = new THREE.Group()
      client.position.set(0, 0, 0)
      client.add(rig.root)
      clientStation.add(client)

      const folder = new THREE.Group()
      folder.position.set(0, .87, .29)
      folder.rotation.x = -.14
      clientStation.add(folder)
      addMesh(folder, roundedBox(.72, .045, .46, 3, .018), seed % 2 ? leather : teal, [0, 0, 0])
      addMesh(folder, roundedBox(.32, .014, .17, 2, .008), paper, [0, .034, -.015])
      addMesh(folder, roundedBox(.13, .016, .04, 2, .006), brass, [0, .043, -.19])

      const seatedArm = (side: -1 | 1) => {
        const shoulder = new THREE.Vector3(side * .29, 1.27, .015)
        const elbow = new THREE.Vector3(side * .34, 1.065, .13)
        const wrist = new THREE.Vector3(side * .205, .95, .315)
        addCapsuleBetween(clientStation, shoulder, elbow, .085, clientSuit)
        addCapsuleBetween(clientStation, elbow, wrist, .073, clientSuit)
        const cuffStart = wrist.clone().lerp(elbow, .18)
        addCapsuleBetween(clientStation, cuffStart, wrist, .077, paper)
        const hand = addMesh(clientStation, constantGeometry('SphereGeometry:.105,20,14', () => new THREE.SphereGeometry(.105, 20, 14)), clientSkin, [side * .17, .925, .325])
        hand.scale.set(1.05, .48, .82)
      }
      seatedArm(-1)
      seatedArm(1)

      const mug = new THREE.Group()
      mug.position.set(.9, .82, -.12)
      clientStation.add(mug)
      addMesh(mug, constantGeometry('CylinderGeometry:.09,.075,.2,18', () => new THREE.CylinderGeometry(.09, .075, .2, 18)), seed % 2 ? paper : teal, [0, 0, 0])
      addMesh(mug, new THREE.TorusGeometry(.075, .018, 8, 18, Math.PI * 1.6), seed % 2 ? paper : teal, [.09, 0, 0], [Math.PI / 2, 0, Math.PI / 2])

      caseAnchor.position.set(0, .24, .16)
      rig.head.add(caseAnchor)

      // The consulting client is the last character in the office still driven
      // by hand, and it converts with one constraint the others do not have:
      // its arms are not its own. The standing rig's long arm chain looked
      // detached folded into a chair, so both shoulders are hidden above and a
      // purpose-built seated silhouette is parented to the station instead -
      // which means those arms do not move when the body does, and any beat
      // that swung the shoulders would tear the visible arms off the torso.
      //
      // Hence the `seatedGuest` role: `seatedIdle` only, and a filler
      // repertoire of head and torso beats with nothing in it that moves an
      // arm. That is also why `seatedType`, which is otherwise the obvious
      // second state for someone at a desk, is deliberately not in its
      // repertoire.
      //
      // The clip's own numbers line up with the pose this was hand-authored
      // at - a 0.45 hip-height drop onto the seat is the -1.18 units this used
      // to subtract, and its hip, knee and ankle angles are the ones written
      // here - so the silhouette is unchanged and only the motion is new.
      client.updateWorldMatrix(true, true)
      const clientHumanoid = new HumanoidActor(rig, { seed, state: 'seatedIdle', reduced })
      // Seated clips carry `grounded: 0`, so foot planting is off regardless;
      // `medium` also spares the two world-matrix rebuilds it would do first.
      clientHumanoid.setLod('medium')
      staffDirector.add(clientHumanoid, 'seatedGuest', seed)
      // The client is the one character in the room worth selecting, so it
      // joins the same focus register everything else clickable uses rather
      // than getting a selection mechanism of its own. Being in there is what
      // makes it a valid `office-focus-asset` target and what gives it a halo;
      // the look-at in the frame loop then keys off the same focus state, so
      // "selected" means exactly one thing in this scene.
      const clientHalo = attachFocus([], clientStation, .74, .02)
      clientFocusKey = activeCase.clientKey
      focusTargets.set(clientFocusKey, { object: rig.root, halo: clientHalo })
      activeClientActor = { rig, humanoid: clientHumanoid, phase: (seed % 97) / 9, folder, mug }
    }

    // Corkboard, architectural clock, and a restrained sleeping cat.
    const board = new THREE.Group(); board.position.set(rustic ? 2.35 : 2.15, rustic ? 3.72 : 3.48, -3.86); root.add(board)
    addMesh(board, rustic ? constantGeometry('BoxGeometry:2.12,1.34,.16', () => new THREE.BoxGeometry(2.12, 1.34, .16)) : roundedBox(2.05, 1.28, .14, 3, .04), darkWood, [0, 0, 0], [0, 0, rustic ? -.025 : 0])
    addMesh(board, rustic ? constantGeometry('BoxGeometry:1.84,1.08,.08', () => new THREE.BoxGeometry(1.84, 1.08, .08)) : roundedBox(1.82, 1.06, .08, 3, .025), new THREE.MeshStandardMaterial({ color: rustic ? 0x65462e : 0x7b5d3d, roughness: .97 }), [0, 0, .11])
    addMesh(board, constantGeometry('PlaneGeometry:.62,.46', () => new THREE.PlaneGeometry(.62, .46)), paper, [-.43, .18, .17], [0, 0, rustic ? -.13 : -.07])
    addMesh(board, constantGeometry('PlaneGeometry:.7,.56', () => new THREE.PlaneGeometry(.7, .56)), paper, [.43, -.12, .17], [0, 0, rustic ? .09 : .05])
    const storyAnchor = new THREE.Object3D()
    storyAnchor.position.set(0, 0, .22)
    board.add(storyAnchor)
    const firmAnchor = new THREE.Object3D()
    firmAnchor.position.set(rustic ? 5.95 : -6.05, rustic ? 2.4 : 2.65, -3.22)
    root.add(firmAnchor)
    const clock = new THREE.Group(); clock.position.set(rustic ? -.15 : -.2, rustic ? 4.42 : 4.15, -3.84); root.add(clock)
    addMesh(clock, new THREE.CylinderGeometry(rustic ? .36 : .42, rustic ? .36 : .42, .12, rustic ? 18 : 36), rustic ? darkWood : brass, [0, 0, 0], [Math.PI / 2, 0, 0])
    addMesh(clock, new THREE.CircleGeometry(rustic ? .28 : .34, rustic ? 18 : 36), paper, [0, 0, .075])
    const minuteHand = addMesh(clock, new THREE.BoxGeometry(.025, .25, .025), charcoal, [0, .11, .095])
    minuteHand.geometry.translate(0, -.11, 0)
    // A fully articulated office cat replaces the old featureless oval. Its
    // face points toward the opening camera while resting, and its patrol stays
    // in authored perimeter lanes so it never walks through desks or clients.
    const cat = new THREE.Group()
    cat.scale.setScalar(rustic ? .69 : .64)
    cat.userData.navIgnore = true
    root.add(cat)
    const catFur = new THREE.MeshStandardMaterial({ color: 0x8b5c3f, roughness: .88 })
    const catFurLight = new THREE.MeshStandardMaterial({ color: 0xc49a72, roughness: .92 })
    const catFurDark = new THREE.MeshStandardMaterial({ color: 0x573a30, roughness: .9 })
    const catBody = addMesh(cat, constantGeometry('SphereGeometry:.42,20,14', () => new THREE.SphereGeometry(.42, 20, 14)), catFur, [0, .5, 0])
    catBody.scale.set(.92, .72, 1.34)
    const catChest = addMesh(cat, constantGeometry('SphereGeometry:.34,18,12', () => new THREE.SphereGeometry(.34, 18, 12)), catFurLight, [0, .58, .33])
    catChest.scale.set(.78, .94, .72)

    const catHead = new THREE.Group()
    catHead.position.set(0, .83, .49)
    cat.add(catHead)
    const catSkull = addMesh(catHead, constantGeometry('SphereGeometry:.31,20,14', () => new THREE.SphereGeometry(.31, 20, 14)), catFur, [0, 0, 0])
    catSkull.scale.set(.92, .9, .86)
    for (const side of [-1, 1]) {
      const ear = addMesh(catHead, constantGeometry('ConeGeometry:.13,.31,5', () => new THREE.ConeGeometry(.13, .31, 5)), catFur, [side * .18, .3, -.01], [0, 0, side * -.14])
      ear.scale.z = .62
      const innerEar = addMesh(catHead, constantGeometry('ConeGeometry:.075,.2,5', () => new THREE.ConeGeometry(.075, .2, 5)), catFurLight, [side * .18, .3, .055], [0, 0, side * -.14])
      innerEar.scale.z = .36
      const eyeWhite = addMesh(catHead, constantGeometry('SphereGeometry:.06,18,12', () => new THREE.SphereGeometry(.06, 18, 12)), paper, [side * .105, .055, .275])
      eyeWhite.scale.set(.82, 1.05, .42)
      const pupil = addMesh(catHead, constantGeometry('SphereGeometry:.029,14,10', () => new THREE.SphereGeometry(.029, 14, 10)), charcoal, [side * .105, .055, .312])
      pupil.scale.set(.58, 1.12, .45)
      catEyes.push({ white: eyeWhite, pupil })
      const muzzle = addMesh(catHead, constantGeometry('SphereGeometry:.105,18,12', () => new THREE.SphereGeometry(.105, 18, 12)), catFurLight, [side * .07, -.105, .265])
      muzzle.scale.set(.88, .6, .58)
      for (let whisker = 0; whisker < 3; whisker += 1) {
        const whiskerY = -.08 + whisker * .045
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * .105, whiskerY, .295),
          new THREE.Vector3(side * .24, whiskerY + (whisker - 1) * .018, .32),
          new THREE.Vector3(side * .39, whiskerY + (whisker - 1) * .035, .285),
        ])
        const whiskerMesh = addMesh(catHead, new THREE.TubeGeometry(curve, 10, .006, 5, false), paper, [0, 0, 0])
        whiskerMesh.castShadow = false
      }
    }
    addMesh(catHead, constantGeometry('SphereGeometry:.045,16,10', () => new THREE.SphereGeometry(.045, 16, 10)), catFurDark, [0, -.08, .34]).scale.set(1, .7, .65)
    addMesh(catHead, constantGeometry('CapsuleGeometry:.012,.08,4,8', () => new THREE.CapsuleGeometry(.012, .08, 4, 8)), catFurDark, [0, -.17, .315], [0, 0, Math.PI / 2])

    const catLegs: THREE.Group[] = []
    for (const z of [-.27, .29]) for (const x of [-.22, .22]) {
      const leg = new THREE.Group()
      leg.position.set(x, .36, z)
      cat.add(leg)
      addMesh(leg, constantGeometry('CapsuleGeometry:.075,.2,5,10', () => new THREE.CapsuleGeometry(.075, .2, 5, 10)), catFur, [0, -.16, 0])
      const paw = addMesh(leg, constantGeometry('SphereGeometry:.1,18,12', () => new THREE.SphereGeometry(.1, 18, 12)), z > 0 ? catFurLight : catFur, [0, -.34, .045])
      paw.scale.set(.82, .42, 1.18)
      catLegs.push(leg)
    }

    const catTail = new THREE.Group()
    catTail.position.set(0, .58, -.38)
    cat.add(catTail)
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(.08, .12, -.28),
      new THREE.Vector3(.2, .4, -.48),
      new THREE.Vector3(.08, .66, -.4),
    ])
    addMesh(catTail, new THREE.TubeGeometry(tailCurve, 24, .055, 9, false), catFur, [0, 0, 0])

    // Use the continuous perimeter aisle rather than cutting across either
    // workstation. The cat begins in the visible left-hand floor pocket, then
    // can circle the desk, reception wall and lounge without intersecting the
    // client chair. The same authored circulation works at every office tier.
    const catLaneX = Math.min(5.25, roomHalf - 2.1)
    const catBackLaneZ = rustic ? -2.62 : -2.72
    const catReceptionZ = rustic ? 3.78 : 4.02
    const catWaypoints = [
      new THREE.Vector3(-catLaneX + .3, 0, -.72),
      new THREE.Vector3(-catLaneX, 0, -1.74),
      new THREE.Vector3(-2.38, 0, catBackLaneZ),
      new THREE.Vector3(2.82, 0, catBackLaneZ),
      new THREE.Vector3(catLaneX, 0, -1.56),
      new THREE.Vector3(catLaneX, 0, .72),
      new THREE.Vector3(catLaneX - .2, 0, 3.12),
      new THREE.Vector3(1.62, 0, catReceptionZ),
      new THREE.Vector3(-1.62, 0, catReceptionZ),
      new THREE.Vector3(-catLaneX + .2, 0, 3.08),
    ]
    // The cat's paws were authored by eye and finished three centimetres below
    // the boards. Measure the assembled body once and lift it by however much
    // it is buried, rather than hand-tuning a constant that would go stale the
    // next time a paw moves. The patrol waypoints carry the same height so the
    // steering, which drives straight at the next waypoint in three
    // dimensions, does not pull the cat back down into the floor.
    cat.position.set(0, 0, 0)
    cat.updateWorldMatrix(true, true)
    const catGroundY = -new THREE.Box3().setFromObject(cat).min.y + root.position.y
    catWaypoints.forEach((waypoint) => { waypoint.y = catGroundY })
    cat.position.copy(catWaypoints[0])
    cat.rotation.y = 0
    const catActor: OfficeCatActor = {
      root: cat,
      body: catBody,
      head: catHead,
      eyes: catEyes,
      legs: catLegs,
      tail: catTail,
      waypoints: catWaypoints,
      waypointIndex: 0,
      previousWaypointIndex: catWaypoints.length - 1,
      pauseRemaining: 1.8 + seeded(castHash(layoutKey ?? 'office-cat')) * 2.2,
      randomState: castHash(`${layoutKey ?? 'office'}:cat-route`),
      lastElapsed: 0,
      walkBlend: 0,
    }

    // Each headquarters level is a complete environment, not a recolored room.
    // Furnishing density grows deliberately while keeping circulation around
    // the partner desk and the four primary interaction targets clear.
    const furnishingDensity = environment.furnishingDensity
    const loungeCount = Math.min(2, Math.max(rustic ? 0 : 1, Math.floor(furnishingDensity / 7)))
    for (let index = 0; index < loungeCount; index += 1) {
      const side = index % 2 ? 1 : -1
      const lounge = new THREE.Group()
      // The lounge sits at the mouth of the side aisle, so where it lands
      // decides whether a wing has an exit. Its coffee table used to reach
      // back to z=2.83 while the desk run ended at 2.25, narrowing the only
      // gap between them to 0.58 - under a shoulder width. Both pieces move
      // north far enough to leave the mouth open.
      lounge.position.set(side * (roomHalf - 2.2), 0, 4.15)
      lounge.rotation.y = side * -.3
      root.add(lounge)
      addMesh(lounge, roundedBox(1.05, .22, .78, 4, .1), leather, [0, .62, 0])
      addMesh(lounge, roundedBox(1.05, .92, .2, 4, .09), leather, [0, 1.05, -.32], [-.12, 0, 0])
      for (const x of [-.41, .41]) addMesh(lounge, constantGeometry('CylinderGeometry:.035,.045,.58,12', () => new THREE.CylinderGeometry(.035, .045, .58, 12)), executive ? brass : charcoal, [x, .3, 0])
      addMesh(root, constantGeometry('CylinderGeometry:.46,.52,.08,28', () => new THREE.CylinderGeometry(.46, .52, .08, 28)), executive ? brass : wood, [side * (roomHalf - 3.35), .55, 3.95])
      addMesh(root, constantGeometry('CylinderGeometry:.07,.09,.52,14', () => new THREE.CylinderGeometry(.07, .09, .52, 14)), charcoal, [side * (roomHalf - 3.35), .27, 3.95])
    }
    const planterCount = level >= 12 ? 0 : Math.min(4, Math.floor((furnishingDensity + 1) / 5))
    for (let index = 0; index < planterCount; index += 1) {
      const side = index % 2 ? 1 : -1
      // Against the wall is not far enough when the wall is one side of a
      // service aisle: a 0.64-wide pot halfway down it is a door that is
      // permanently shut, and z=-.95 put one directly behind a chair. The
      // corners past either end of the desk run are the only floor by the
      // wall that nobody has to walk over, so the greenery lives there.
      const depth = index < 2 ? -3.5 : rearWallZ - .68
      const plant = new THREE.Group(); plant.position.set(side * (roomHalf - .55), 0, depth); root.add(plant)
      addMesh(plant, constantGeometry('CylinderGeometry:.32,.25,.62,22', () => new THREE.CylinderGeometry(.32, .25, .62, 22)), level >= 8 ? brass : darkWood, [0, .31, 0])
      for (let leaf = 0; leaf < 6; leaf += 1) {
        const angle = leaf / 6 * Math.PI * 2
        const blade = addMesh(plant, constantGeometry('SphereGeometry:.24,12,8', () => new THREE.SphereGeometry(.24, 12, 8)), sharedStandard({ color: leaf % 2 ? 0x2f5948 : 0x3c6953, roughness: .9 }), [Math.cos(angle) * .2, .8 + (leaf % 3) * .2, Math.sin(angle) * .18])
        blade.scale.set(.58, 1.55, .42)
        blade.rotation.z = Math.cos(angle) * .42
        // Foliage is not furniture. The pot is what a body has to walk round;
        // the fronds hanging over the aisle are brushed past, and counting
        // them as solid was what made this planter a wall.
        blade.userData.navIgnore = true
      }
    }
    const artCount = Math.min(5, Math.max(1, Math.floor(furnishingDensity / 4)))
    for (let index = 0; index < artCount; index += 1) {
      const x = -1.6 + index * (3.2 / Math.max(1, artCount - 1))
      addMesh(root, roundedBox(.42, .56, .055, 3, .025), level >= 8 ? brass : darkWood, [x, 5.42, -3.72], [0, 0, (index % 2 ? 1 : -1) * .012])
      addMesh(root, constantGeometry('PlaneGeometry:.31,.44', () => new THREE.PlaneGeometry(.31, .44)), sharedStandard({ color: index % 2 ? look.upholstery : look.accent, roughness: .8 }), [x, 5.42, -3.684])
    }

    const addDataPanel = (parent: THREE.Object3D, width: number, height: number, lines: number) => {
      addMesh(parent, roundedBox(width, height, .09, 4, .035), charcoal, [0, 0, 0])
      addMesh(parent, new THREE.PlaneGeometry(width - .16, height - .16), sharedStandard({ color: 0x12313a, emissive: 0x1f7772, emissiveIntensity: .55, roughness: .3 }), [0, 0, .058])
      for (let line = 0; line < lines; line += 1) {
        const lineWidth = .24 + seeded(line + width * 10) * Math.max(.2, width - .58)
        addMesh(parent, new THREE.BoxGeometry(lineWidth, .025, .015), line % 3 ? glow : brass, [-width * .32 + lineWidth / 2, -height * .3 + line * (height * .6 / Math.max(1, lines - 1)), .072])
      }
    }

    // The headquarters tier itself always changes the room. Optional catalog
    // purchases deepen these systems below, but the defining environment
    // feature is present immediately when a new office is reached.
    const environmentFeature = new THREE.Group()
    environmentFeature.position.set(0, 5.48, -3.56)
    environmentFeature.userData.officeEnvironment = environment.name
    environmentFeature.userData.officeCenterpiece = environment.centerpiece
    root.add(environmentFeature)
    addMesh(environmentFeature, roundedBox(1.54, .78, .09, 4, .035), level >= 8 ? charcoal : darkWood, [0, 0, 0])
    addMesh(environmentFeature, roundedBox(1.40, .64, .035, 3, .025), level >= 5 ? teal : leather, [0, 0, .065])
    const featureDepth = .098
    if (level === 0) {
      addMesh(environmentFeature, constantGeometry('BoxGeometry:.035,.42,.025', () => new THREE.BoxGeometry(.035, .42, .025)), brass, [0, -.02, featureDepth])
      addMesh(environmentFeature, constantGeometry('BoxGeometry:.62,.035,.025', () => new THREE.BoxGeometry(.62, .035, .025)), brass, [0, .12, featureDepth])
      for (const x of [-.28, .28]) {
        addMesh(environmentFeature, constantGeometry('BoxGeometry:.018,.23,.018', () => new THREE.BoxGeometry(.018, .23, .018)), brass, [x, -.01, featureDepth])
        addMesh(environmentFeature, constantGeometry('CylinderGeometry:.13,.13,.018,24', () => new THREE.CylinderGeometry(.13, .13, .018, 24)), paper, [x, -.14, featureDepth], [Math.PI / 2, 0, 0])
      }
    } else if (level === 1) {
      for (const x of [-.38, .38]) addMesh(environmentFeature, roundedBox(.48, .32, .025, 3, .025), x < 0 ? paper : brass, [x, 0, featureDepth])
      addMesh(environmentFeature, constantGeometry('BoxGeometry:.12,.48,.026', () => new THREE.BoxGeometry(.12, .48, .026)), charcoal, [0, 0, featureDepth + .006])
    } else if (level === 2) {
      for (let book = 0; book < 7; book += 1) addMesh(environmentFeature, roundedBox(.12, .28 + (book % 3) * .07, .025, 2, .012), book % 2 ? brass : paper, [-.47 + book * .16, -.08 + (book % 3) * .035, featureDepth])
      addMesh(environmentFeature, constantGeometry('BoxGeometry:1.12,.035,.025', () => new THREE.BoxGeometry(1.12, .035, .025)), darkWood, [0, -.28, featureDepth])
    } else if (level === 3) {
      const nodes: THREE.Vector3[] = []
      for (let node = 0; node < 6; node += 1) {
        const point = new THREE.Vector3(-.52 + node * .21, Math.sin(node * 1.7) * .19, featureDepth)
        nodes.push(point)
        addMesh(environmentFeature, constantGeometry('SphereGeometry:.045,14,10', () => new THREE.SphereGeometry(.045, 14, 10)), node % 2 ? glow : brass, [point.x, point.y, point.z])
      }
      addMesh(environmentFeature, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(nodes), 24, .012, 6, false), glow, [0, 0, 0])
    } else if (level === 4) {
      for (let seat = 0; seat < 7; seat += 1) {
        const angle = Math.PI * (.12 + seat * .125)
        addMesh(environmentFeature, roundedBox(.11, .16, .025, 2, .015), seat % 2 ? brass : paper, [Math.cos(angle) * .5, Math.sin(angle) * .3 - .15, featureDepth], [0, 0, angle - Math.PI / 2])
      }
      addMesh(environmentFeature, constantGeometry('BoxGeometry:.7,.05,.025', () => new THREE.BoxGeometry(.7, .05, .025)), charcoal, [0, .22, featureDepth])
    } else if (level === 5) {
      addMesh(environmentFeature, constantGeometry('CylinderGeometry:.25,.25,.026,32', () => new THREE.CylinderGeometry(.25, .25, .026, 32)), glow, [0, 0, featureDepth], [Math.PI / 2, 0, 0])
      for (let spoke = 0; spoke < 8; spoke += 1) addMesh(environmentFeature, constantGeometry('BoxGeometry:.018,.5,.018', () => new THREE.BoxGeometry(.018, .5, .018)), spoke % 2 ? brass : paper, [0, 0, featureDepth + .018], [0, 0, spoke * Math.PI / 4])
    } else if (level <= 8) {
      addMesh(environmentFeature, new THREE.SphereGeometry(.23 + (level - 6) * .035, 24, 18), glow, [0, 0, featureDepth])
      for (let ring = 0; ring < level - 4; ring += 1) addMesh(environmentFeature, new THREE.TorusGeometry(.34 + ring * .075, .012, 6, 28), ring % 2 ? brass : paper, [0, 0, featureDepth + .025], [ring * .38, ring * .26, 0])
    } else if (level === 9) {
      addMesh(environmentFeature, constantGeometry('SphereGeometry:.28,20,14', () => new THREE.SphereGeometry(.28, 20, 14)), paper, [0, 0, featureDepth])
      for (let ring = 0; ring < 3; ring += 1) addMesh(environmentFeature, new THREE.TorusGeometry(.38 + ring * .08, .014, 6, 28), ring === 1 ? glow : brass, [0, 0, featureDepth + .025], [Math.PI / 2 + ring * .31, ring * .4, 0])
    } else if (level === 10) {
      for (let building = 0; building < 7; building += 1) {
        const height = .22 + (building % 3) * .12
        addMesh(environmentFeature, roundedBox(.12, height, .04, 2, .012), building % 2 ? brass : paper, [-.48 + building * .16, -.24 + height / 2, featureDepth])
      }
      addMesh(environmentFeature, constantGeometry('BoxGeometry:1.12,.03,.028', () => new THREE.BoxGeometry(1.12, .03, .028)), glow, [0, -.24, featureDepth])
    } else if (level === 11) {
      for (let wave = 0; wave < 4; wave += 1) {
        const points = Array.from({ length: 8 }, (_, index) => new THREE.Vector3(-.58 + index * .165, -.22 + wave * .14 + Math.sin(index * 1.55 + wave) * .035, featureDepth))
        addMesh(environmentFeature, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 28, .012, 6, false), wave % 2 ? glow : paper, [0, 0, 0])
      }
    } else if (level === 12) {
      addMesh(environmentFeature, constantGeometry('SphereGeometry:.23,18,12', () => new THREE.SphereGeometry(.23, 18, 12)), paper, [0, 0, featureDepth])
      for (let ring = 0; ring < 4; ring += 1) addMesh(environmentFeature, new THREE.TorusGeometry(.34 + ring * .075, .014, 6, 28), ring % 2 ? glow : brass, [0, 0, featureDepth + .02], [ring * .52, ring * .34, 0])
    } else if (level === 13) {
      addMesh(environmentFeature, constantGeometry('CylinderGeometry:.32,.32,.035,24', () => new THREE.CylinderGeometry(.32, .32, .035, 24)), charcoal, [0, 0, featureDepth], [Math.PI / 2, 0, 0])
      for (let ring = 0; ring < 4; ring += 1) addMesh(environmentFeature, new THREE.TorusGeometry(.09 + ring * .07, .018, 6, 24), ring % 2 ? brass : paper, [0, 0, featureDepth + .025])
      for (let spoke = 0; spoke < 6; spoke += 1) addMesh(environmentFeature, constantGeometry('BoxGeometry:.018,.5,.018', () => new THREE.BoxGeometry(.018, .5, .018)), brass, [0, 0, featureDepth + .03], [0, 0, spoke * Math.PI / 3])
    } else {
      for (let star = 0; star < 14; star += 1) {
        const angle = star / 14 * Math.PI * 2
        addMesh(environmentFeature, new THREE.SphereGeometry(.025 + (star % 4) * .009, 10, 8), star % 3 ? glow : brass, [Math.cos(angle) * (.28 + (star % 3) * .11), Math.sin(angle * 2) * .23, featureDepth])
      }
      addMesh(environmentFeature, constantGeometry('TorusGeometry:.51,.014,6,32', () => new THREE.TorusGeometry(.51, .014, 6, 32)), brass, [0, 0, featureDepth], [Math.PI / 2, .24, 0])
    }

    const makeInstallation = (zone: OfficeVisualZone, position: [number, number, number], radius = .72) => {
      const assets = zoneAssets(zone)
      if (!assets.length) return null
      const installation = new THREE.Group()
      installation.position.set(...position)
      installation.userData.officeZone = zone
      root.add(installation)
      const wallMounted = ['evidence', 'simulation', 'mobility', 'network', 'archive', 'prestige'].includes(zone)
      attachFocus(assets.map((asset) => asset.key), installation, radius, wallMounted ? 0 : .12, wallMounted ? [0, 0, 0] : [Math.PI / 2, 0, 0])
      return { installation, assets, stage: Math.max(...assets.map((asset) => officeVisualFor(asset.key).stage)) }
    }

    const deskInstallation = makeInstallation('desk', [1.35, 1.25, -1.05], 1.15)
    if (deskInstallation) {
      const { installation, stage } = deskInstallation
      addMesh(installation, roundedBox(2.2 + stage * .28, .035, .72, 3, .015), stage > 1 ? leather : wood, [0, .02, 0])
      for (const x of [-.82, .82]) addMesh(installation, constantGeometry('BoxGeometry:.3,.025,.04', () => new THREE.BoxGeometry(.3, .025, .04)), brass, [x, .06, .36])
      if (stage > 1) addMesh(installation, constantGeometry('CylinderGeometry:.08,.08,.72,18', () => new THREE.CylinderGeometry(.08, .08, .72, 18)), brass, [.7, .17, .08], [0, 0, Math.PI / 2])
    }

    const lightInstallation = makeInstallation('lighting', [0, 6.05, .45], 1.0)
    if (lightInstallation) {
      const { installation, stage } = lightInstallation
      const fixtureCount = Math.min(5, 2 + stage)
      for (let index = 0; index < fixtureCount; index += 1) {
        const x = -2.6 + index * (5.2 / Math.max(1, fixtureCount - 1))
        addMesh(installation, constantGeometry('CylinderGeometry:.04,.04,.42,8', () => new THREE.CylinderGeometry(.04, .04, .42, 8)), brass, [x, -.2, 0])
        addMesh(installation, constantGeometry('CylinderGeometry:.23,.34,.14,16', () => new THREE.CylinderGeometry(.23, .34, .14, 16)), brass, [x, -.46, 0])
        const bulb = addMesh(installation, constantGeometry('SphereGeometry:.12,14,10', () => new THREE.SphereGeometry(.12, 14, 10)), sharedStandard({ color: 0xf0ddb0, emissive: 0xd59d4e, emissiveIntensity: 1.1, roughness: .45 }), [x, -.54, 0])
        bulb.castShadow = false
      }
    }

    phase('room+desk+client')
    const workstationAssets = zoneAssets('workstation')
    if (workstationAssets.length) {
      // Workstation purchases upgrade the partner desk that already exists.
      // They must not spawn a second bank of free-floating monitors between
      // the camera and the room. Early stages add secure hardware and status
      // controls; only advanced stages earn one restrained side terminal.
      const installation = new THREE.Group()
      installation.position.set(.54, 1.43, -.18)
      installation.userData.officeZone = 'workstation'
      desk.add(installation)
      const stage = Math.max(...workstationAssets.map((asset) => officeVisualFor(asset.key).stage))
      attachFocus(workstationAssets.map((asset) => asset.key), installation, .88, .04)
      addMesh(installation, roundedBox(.58 + stage * .08, .14, .4, 3, .028), charcoal, [0, .06, 0])
      addMesh(installation, roundedBox(.44 + stage * .06, .025, .06, 2, .01), stage >= 2 ? glow : brass, [0, .15, .12])
      for (let status = 0; status < Math.min(4, 1 + stage); status += 1) {
        addMesh(installation, constantGeometry('SphereGeometry:.022,10,8', () => new THREE.SphereGeometry(.022, 10, 8)), status === 0 ? brass : glow, [-.18 + status * .12, .17, .14])
      }
      if (stage >= 3) {
        addMesh(installation, roundedBox(.48, .31, .045, 3, .02), charcoal, [-.78, .36, -.08], [-.05, .22, 0])
        addMesh(installation, constantGeometry('PlaneGeometry:.4,.24', () => new THREE.PlaneGeometry(.4, .24)), screen, [-.78, .36, -.05], [-.05, .22, 0]).castShadow = false
      }
      if (stage >= 4) for (let rack = 0; rack < stage - 2; rack += 1) addMesh(installation, roundedBox(.18, .42, .3, 3, .025), charcoal, [.58 + rack * .22, .17, -.04])
    }

    // Lowered so the rails meet the floor, and tilted about X (into the room's
    // depth) rather than about Z: the old sideways lean left the base hanging
    // ~0.68 above the boards and raked the ladder across the wainscoting. Now it
    // leans back toward the rear wall and rests on the floor. Each rung's Z is
    // offset by its height up the rail so the rungs track the tilted rail
    // instead of detaching from it.
    const libraryInstallation = makeInstallation('library', [-5.15, 2.17, -3.18], 1.1)
    if (libraryInstallation) {
      const { installation, stage } = libraryInstallation
      const ladderLean = -.2
      const ladderTan = Math.tan(ladderLean)
      addMesh(installation, constantGeometry('CylinderGeometry:.035,.045,3.4,12', () => new THREE.CylinderGeometry(.035, .045, 3.4, 12)), brass, [.92, -.45, .42], [ladderLean, 0, 0])
      for (let rung = 0; rung < 7; rung += 1) {
        const rungY = -1.78 + rung * .46
        addMesh(installation, constantGeometry('BoxGeometry:.78,.045,.05', () => new THREE.BoxGeometry(.78, .045, .05)), brass, [.92, rungY, .42 + (rungY + .45) * ladderTan], [ladderLean, 0, 0])
      }
      for (let cart = 0; cart < Math.min(3, stage); cart += 1) {
        addMesh(installation, roundedBox(.72, .12, .46, 3, .025), wood, [-.65 + cart * .72, -2.02, 1.28])
        for (let book = 0; book < 4 + stage; book += 1) addMesh(installation, new THREE.BoxGeometry(.07, .32 + (book % 2) * .08, .2), book % 3 ? leather : paper, [-.92 + cart * .72 + book * .1, -1.82, 1.28])
      }
    }

    const conferenceInstallation = makeInstallation('conference', [-3.75, .02, .3], 1.35)
    if (conferenceInstallation) {
      const { installation, stage } = conferenceInstallation
      addMesh(installation, new THREE.CylinderGeometry(1.32 + stage * .12, 1.18, .16, 28), wood, [0, .8, 0])
      addMesh(installation, constantGeometry('CylinderGeometry:.24,.38,.76,16', () => new THREE.CylinderGeometry(.24, .38, .76, 16)), charcoal, [0, .38, 0])
      for (let seat = 0; seat < Math.min(6, 2 + stage); seat += 1) {
        const angle = seat / Math.min(6, 2 + stage) * Math.PI * 2
        const chair = new THREE.Group(); chair.position.set(Math.cos(angle) * 1.78, 0, Math.sin(angle) * 1.15); chair.rotation.y = -angle + Math.PI / 2; installation.add(chair)
        addMesh(chair, roundedBox(.48, .16, .45, 3, .07), leather, [0, .5, 0])
        addMesh(chair, roundedBox(.48, .62, .14, 3, .06), leather, [0, .82, -.18])
      }
      if (stage === 1) addMesh(installation, constantGeometry('BoxGeometry:.75,.48,.58', () => new THREE.BoxGeometry(.75, .48, .58)), charcoal, [0, 1.18, -.15])
    }

    const evidenceInstallation = makeInstallation('evidence', [3.85, 4.62, -3.68], 1.15)
    if (evidenceInstallation) addDataPanel(evidenceInstallation.installation, 3.0, 1.15 + evidenceInstallation.stage * .12, 3 + evidenceInstallation.stage * 2)

    const simulationInstallation = makeInstallation('simulation', [-2.1, 3.95, -3.68], 1.1)
    if (simulationInstallation) {
      const { installation, stage } = simulationInstallation
      addDataPanel(installation, 2.15, 1.15, 3 + stage)
      for (let seat = 0; seat < 2 + stage; seat += 1) addMesh(installation, roundedBox(.32, .22, .22, 3, .06), leather, [-.78 + seat * (1.56 / Math.max(1, 1 + stage)), -1.05, .75])
      if (stage >= 2) addMesh(installation, constantGeometry('BoxGeometry:1.85,.025,.04', () => new THREE.BoxGeometry(1.85, .025, .04)), glow, [0, -.75, .14])
    }

    const mediaInstallation = makeInstallation('media', [-5.75, .02, -.5], .75)
    if (mediaInstallation) {
      const { installation, stage } = mediaInstallation
      for (let cameraIndex = 0; cameraIndex < Math.min(3, 1 + stage); cameraIndex += 1) {
        const x = cameraIndex * .54
        addMesh(installation, constantGeometry('CylinderGeometry:.035,.045,1.4,12', () => new THREE.CylinderGeometry(.035, .045, 1.4, 12)), charcoal, [x, .7, 0])
        addMesh(installation, roundedBox(.48, .32, .42, 3, .06), charcoal, [x, 1.45, 0])
        addMesh(installation, constantGeometry('CylinderGeometry:.12,.16,.25,20', () => new THREE.CylinderGeometry(.12, .16, .25, 20)), brass, [x, 1.45, .3], [Math.PI / 2, 0, 0])
      }
    }

    const operationsInstallation = makeInstallation('operations', [4.3, .02, -.45], 1.15)
    if (operationsInstallation) {
      const { installation, stage } = operationsInstallation
      addMesh(installation, new THREE.CylinderGeometry(1.15 + stage * .12, .94, .28, 8), charcoal, [0, .72, 0])
      addMesh(installation, new THREE.CylinderGeometry(.82 + stage * .08, .82, .035, 28), glow, [0, .89, 0])
      for (let panel = 0; panel < stage; panel += 1) {
        const angle = panel / stage * Math.PI * 2
        addMesh(installation, roundedBox(.52, .3, .035, 3, .015), charcoal, [Math.cos(angle) * .75, 1.25 + (panel % 2) * .12, Math.sin(angle) * .58], [0, -angle, 0])
      }
    }

    const mobilityInstallation = makeInstallation('mobility', [4.85, 5.18, -3.15], .9)
    if (mobilityInstallation) {
      const { installation, stage } = mobilityInstallation
      const hull = addMesh(installation, new THREE.CapsuleGeometry(.18 + stage * .04, .86 + stage * .22, 7, 16), level >= 12 ? paper : charcoal, [0, 0, 0], [0, 0, Math.PI / 2])
      hull.scale.z = .58
      addMesh(installation, new THREE.BoxGeometry(1.15 + stage * .22, .035, .55), brass, [-.12, -.05, 0])
      for (let window = 0; window < 2 + stage; window += 1) addMesh(installation, constantGeometry('BoxGeometry:.1,.08,.025', () => new THREE.BoxGeometry(.1, .08, .025)), glow, [-.38 + window * .24, .08, .2])
    }

    const networkInstallation = makeInstallation('network', [-.2, 4.72, -3.58], .85)
    if (networkInstallation) {
      const { installation, stage } = networkInstallation
      addMesh(installation, new THREE.SphereGeometry(.42 + stage * .08, 20, 14), sharedStandard({ color: 0x2d6570, emissive: 0x174f59, emissiveIntensity: .55, roughness: .45 }), [0, 0, 0])
      for (let ring = 0; ring < stage; ring += 1) addMesh(installation, new THREE.TorusGeometry(.58 + ring * .14, .016, 6, 28), ring % 2 ? brass : glow, [0, 0, 0], [Math.PI / 2 + ring * .38, ring * .46, 0])
    }

    const archiveInstallation = makeInstallation('archive', [-5.72, 3.05, -3.52], 1.0)
    if (archiveInstallation) {
      const { installation, stage } = archiveInstallation
      addMesh(installation, constantGeometry('CylinderGeometry:1.02,1.02,.18,28', () => new THREE.CylinderGeometry(1.02, 1.02, .18, 28)), charcoal, [0, 0, 0], [Math.PI / 2, 0, 0])
      for (let ring = 0; ring < 3 + stage; ring += 1) addMesh(installation, new THREE.TorusGeometry(.25 + ring * .13, .025, 6, 28), ring % 2 ? brass : darkWood, [0, 0, .11])
      for (let spoke = 0; spoke < 6; spoke += 1) addMesh(installation, constantGeometry('BoxGeometry:.04,.8,.04', () => new THREE.BoxGeometry(.04, .8, .04)), brass, [0, 0, .14], [0, 0, spoke / 6 * Math.PI * 2])
    }

    const jurisdictionInstallation = makeInstallation('jurisdiction', [4.4, 1.78, -.7], .9)
    if (jurisdictionInstallation) {
      const { installation, stage } = jurisdictionInstallation
      addMesh(installation, constantGeometry('CylinderGeometry:.48,.62,.16,20', () => new THREE.CylinderGeometry(.48, .62, .16, 20)), brass, [0, -.75, 0])
      addMesh(installation, new THREE.SphereGeometry(.36 + stage * .09, 22, 16), sharedStandard({ color: stage >= 3 ? 0x9a9e9b : 0x326b77, emissive: stage >= 2 ? 0x174b55 : 0x000000, emissiveIntensity: .45, roughness: .55 }), [0, 0, 0])
      for (let ring = 0; ring < stage; ring += 1) addMesh(installation, new THREE.TorusGeometry(.55 + ring * .13, .018, 6, 28), ring % 2 ? brass : glow, [0, 0, 0], [Math.PI / 2 + ring * .36, ring * .28, 0])
    }

    const campusInstallation = makeInstallation('campus', [-4.25, .12, -.65], 1.1)
    if (campusInstallation) {
      const { installation, stage } = campusInstallation
      addMesh(installation, constantGeometry('CylinderGeometry:1.45,1.62,.14,28', () => new THREE.CylinderGeometry(1.45, 1.62, .14, 28)), stage >= 2 ? teal : charcoal, [0, .15, 0])
      for (let building = 0; building < 4 + stage; building += 1) {
        const angle = building / (4 + stage) * Math.PI * 2
        const height = .36 + (building % 3) * .18
        addMesh(installation, roundedBox(.34, height, .34, 3, .04), building % 2 ? brass : charcoal, [Math.cos(angle) * .8, .4 + height / 2, Math.sin(angle) * .62])
      }
    }

    const prestigeInstallation = makeInstallation('prestige', [0, 5.36, -2.95], 1.1)
    if (prestigeInstallation) {
      const { installation } = prestigeInstallation
      for (let star = 0; star < 12; star += 1) {
        const angle = star / 12 * Math.PI * 2
        addMesh(installation, new THREE.SphereGeometry(.035 + (star % 3) * .012, 12, 8), star % 3 ? glow : brass, [Math.cos(angle) * (1.0 + (star % 2) * .35), Math.sin(angle * 2) * .44, Math.sin(angle) * .24])
      }
      addMesh(installation, constantGeometry('TorusGeometry:1.18,.018,6,40', () => new THREE.TorusGeometry(1.18, .018, 6, 40)), brass, [0, 0, 0], [Math.PI / 2, .3, 0])
    }

    // Connections and acquisitions receive individual plaques so every item
    // can be found and focused without turning the office floor into clutter.
    const relationshipAssets = zoneAssets('relationship-wall')
    if (relationshipAssets.length) {
      const relationshipWall = new THREE.Group(); relationshipWall.position.set(-roomHalf + .18, 4.15, .8); relationshipWall.rotation.y = Math.PI / 2; root.add(relationshipWall)
      relationshipAssets.forEach((asset, index) => {
        const seal = new THREE.Group(); seal.position.set((index % 7) * .28, -Math.floor(index / 7) * .34, 0); relationshipWall.add(seal)
        addMesh(seal, constantGeometry('CylinderGeometry:.105,.105,.028,24', () => new THREE.CylinderGeometry(.105, .105, .028, 24)), index % 2 ? brass : teal, [0, 0, 0], [Math.PI / 2, 0, 0])
        addMesh(seal, constantGeometry('TorusGeometry:.07,.008,6,24', () => new THREE.TorusGeometry(.07, .008, 6, 24)), paper, [0, 0, .02])
        attachFocus([asset.key], seal, .16, 0, [0, 0, 0])
      })
    }
    const acquisitionAssets = zoneAssets('acquisition-gallery')
    if (acquisitionAssets.length) {
      const gallery = new THREE.Group(); gallery.position.set(2.05, 4.65, rearWallZ - .16); gallery.rotation.y = Math.PI; root.add(gallery)
      acquisitionAssets.forEach((asset, index) => {
        const plaque = new THREE.Group(); plaque.position.set((index % 7) * .45, -Math.floor(index / 7) * .42, 0); gallery.add(plaque)
        addMesh(plaque, roundedBox(.34, .24, .035, 3, .02), darkWood, [0, 0, 0])
        addMesh(plaque, roundedBox(.28, .18, .02, 3, .015), index % 2 ? brass : teal, [0, 0, .026])
        attachFocus([asset.key], plaque, .22, 0, [0, 0, 0])
      })
    }

    // Cosmetics buy nothing but the view, so each one is an individual authored
    // prop in a reserved spot rather than another stage of a shared
    // installation. Every prop draws from this one decor palette: a material
    // per item would add a GPU state change for each otherwise-static object,
    // and these materials are mount-local exactly like the room palette above,
    // so the scene's dispose pass still frees them.
    const decorAssets = zoneAssets('decor')
    if (decorAssets.length) {
      const terracotta = new THREE.MeshStandardMaterial({ color: 0x9a5a3f, roughness: .92 })
      const foliage = new THREE.MeshStandardMaterial({ color: 0x2c5342, roughness: .93 })
      const foliageLight = new THREE.MeshStandardMaterial({ color: 0x40745a, roughness: .9 })
      const bloom = new THREE.MeshStandardMaterial({ color: 0xe6cbd4, roughness: .76 })
      const oxblood = new THREE.MeshStandardMaterial({ color: 0x5f2b26, roughness: rustic ? .8 : .5 })
      const rugField = new THREE.MeshStandardMaterial({ color: 0x6f342c, roughness: .98 })
      const rugPattern = new THREE.MeshStandardMaterial({ color: 0x22384c, roughness: .98 })
      const rugTrim = new THREE.MeshStandardMaterial({ color: 0xbfa079, roughness: .96 })
      const marble = new THREE.MeshStandardMaterial({ color: 0xe3ded1, roughness: .36, metalness: .04 })
      const spine = new THREE.MeshStandardMaterial({ color: 0x6d3a2c, roughness: .74 })
      const decorGlass = new THREE.MeshStandardMaterial({ color: 0x9fc7d2, transparent: true, opacity: .2, roughness: .16, metalness: .06 })
      // Coloured glass belongs to the same muted palette as the room. Saturated
      // primaries at full emissive strength read as a pinwheel toy rather than
      // leaded glass, so every tint is dulled and lit only faintly.
      const stainAmber = new THREE.MeshStandardMaterial({ color: 0x9c7a3c, emissive: 0x543110, emissiveIntensity: .18, roughness: .38 })
      const stainRuby = new THREE.MeshStandardMaterial({ color: 0x6f3630, emissive: 0x36100e, emissiveIntensity: .18, roughness: .38 })
      const stainCobalt = new THREE.MeshStandardMaterial({ color: 0x27506a, emissive: 0x0d1f2e, emissiveIntensity: .18, roughness: .38 })
      const stainEmerald = new THREE.MeshStandardMaterial({ color: 0x2a5747, emissive: 0x0d251b, emissiveIntensity: .18, roughness: .38 })
      // Amber and teal carry the panel; ruby appears once so the glass stays in
      // the room's palette rather than turning into a primary-colour wheel.
      const stains = [stainCobalt, stainAmber, stainEmerald, stainAmber, stainRuby]
      const canvasSky = new THREE.MeshStandardMaterial({ color: 0xcaa877, roughness: .9 })
      // Wall decor hangs on the same plane the corkboard and clock already use,
      // which is flush with the timber boards of the shack and reads as hung
      // rather than floating in every later finish.
      const decorWallZ = -3.86
      const deskTopY = rustic ? 1.36 : 1.41
      // The reception wall is already divided by the door, its framed art and
      // the storage runs. The clear span above each cabinet is the one place a
      // large panel can hang there, and it matches where the sconces already
      // throw light.
      const cabinetX = Math.min(roomHalf - 2.05, 4.9)

      const decorProp = (
        asset: GameAsset,
        parent: THREE.Object3D,
        position: [number, number, number],
        rotationY: number,
        radius: number,
        wall: boolean,
      ) => {
        const prop = new THREE.Group()
        prop.position.set(...position)
        prop.rotation.y = rotationY
        prop.userData.officeCosmetic = asset.key
        parent.add(prop)
        attachFocus([asset.key], prop, radius, wall ? 0 : .1, wall ? [0, 0, 0] : [Math.PI / 2, 0, 0])
        return prop
      }

      const decorBuilders: Record<string, (asset: GameAsset) => void> = {
        bar_certificate: (asset) => {
          const prop = decorProp(asset, root, [.75, 2.62, decorWallZ], 0, .46, true)
          addMesh(prop, roundedBox(.58, .72, .06, 3, .025), darkWood, [0, 0, 0])
          addMesh(prop, roundedBox(.46, .58, .02, 3, .014), paper, [0, 0, .04])
          for (let line = 0; line < 4; line += 1) {
            addMesh(prop, new THREE.BoxGeometry(.28 - line * .04, .017, .012), line ? charcoal : brass, [0, .18 - line * .08, .056])
          }
          addMesh(prop, constantGeometry('CylinderGeometry:.045,.045,.012,16', () => new THREE.CylinderGeometry(.045, .045, .012, 16)), brass, [-.11, -.16, .056], [Math.PI / 2, 0, 0])
          addMesh(prop, constantGeometry('BoxGeometry:.14,.016,.012', () => new THREE.BoxGeometry(.14, .016, .012)), charcoal, [.06, -.16, .056])
        },
        banker_lamp: (asset) => {
          const prop = decorProp(asset, desk, [-1.8, deskTopY, .45], 0, .34, false)
          addMesh(prop, constantGeometry('CylinderGeometry:.17,.21,.05,20', () => new THREE.CylinderGeometry(.17, .21, .05, 20)), brass, [0, .025, 0])
          addMesh(prop, constantGeometry('CylinderGeometry:.028,.034,.3,12', () => new THREE.CylinderGeometry(.028, .034, .3, 12)), brass, [0, .19, 0])
          addMesh(prop, roundedBox(.52, .12, .21, 3, .055), stainEmerald, [0, .39, 0])
          addMesh(prop, constantGeometry('BoxGeometry:.44,.012,.16', () => new THREE.BoxGeometry(.44, .012, .16)), brass, [0, .33, 0])
          const filament = addMesh(prop, constantGeometry('SphereGeometry:.045,12,8', () => new THREE.SphereGeometry(.045, 12, 8)), glow, [0, .31, 0])
          filament.castShadow = false
          const lampLight = new THREE.PointLight(0xffc878, .55, 2.1, 1.9)
          lampLight.position.set(0, .26, .06)
          lampLight.castShadow = false
          prop.add(lampLight)
        },
        persian_rug: (asset) => {
          // The entry strip in front of the door, kept clear of the room's own
          // rug so the two never meet in a seam.
          const prop = decorProp(asset, root, [0, 0, 3.98], 0, 1.5, false)
          addMesh(prop, constantGeometry('BoxGeometry:4.4,.02,1.5', () => new THREE.BoxGeometry(4.4, .02, 1.5)), rugPattern, [0, .014, 0])
          // Every painted motif is a decal on the same horizontal surface, so
          // each one is raised onto its own plane in draw order. Sharing a
          // single y made the stacked medallions z-fight, which reads as jagged
          // triangles flickering inside the lozenges as the camera moves. The
          // whole stack is under 1.5cm tall, so the rug still lies flat.
          const decalStep = .0018
          const flat = (layer: number, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, z: number) => {
            const piece = addMesh(prop, geometry, material, [x, .03 + layer * decalStep, z], [-Math.PI / 2, 0, 0])
            piece.castShadow = false
            return piece
          }
          const field = flat(0, constantGeometry('PlaneGeometry:3.92,1.06', () => new THREE.PlaneGeometry(3.92, 1.06)), rugField, 0, 0)
          field.receiveShadow = false
          // A knotted rug is a border, a guard stripe, a centre medallion and
          // corner spandrels. Laying the motifs out that way rather than
          // scattering dots is what makes the small shape read as a carpet.
          for (const z of [-.44, .44]) flat(1, constantGeometry('PlaneGeometry:3.84,.05', () => new THREE.PlaneGeometry(3.84, .05)), rugTrim, 0, z)
          for (const x of [-1.9, 1.9]) flat(2, constantGeometry('PlaneGeometry:.05,.93', () => new THREE.PlaneGeometry(.05, .93)), rugTrim, x, 0)
          // A four-segment circle already sits point-up, so it draws the lozenge
          // a knotted medallion needs without any extra spin.
          flat(3, constantGeometry('CircleGeometry:.62,4', () => new THREE.CircleGeometry(.62, 4)), rugTrim, 0, 0).scale.set(1, .66, 1)
          flat(4, constantGeometry('CircleGeometry:.48,4', () => new THREE.CircleGeometry(.48, 4)), rugPattern, 0, 0).scale.set(1, .66, 1)
          flat(5, constantGeometry('CircleGeometry:.24,4', () => new THREE.CircleGeometry(.24, 4)), rugTrim, 0, 0).scale.set(1, .66, 1)
          for (const x of [-1.3, 1.3]) {
            flat(3, constantGeometry('CircleGeometry:.38,4', () => new THREE.CircleGeometry(.38, 4)), rugTrim, x, 0).scale.set(1, .66, 1)
            flat(4, constantGeometry('CircleGeometry:.24,4', () => new THREE.CircleGeometry(.24, 4)), rugPattern, x, 0).scale.set(1, .66, 1)
          }
          for (const x of [-.66, .66]) {
            for (const z of [-.3, .3]) flat(6, constantGeometry('CircleGeometry:.14,4', () => new THREE.CircleGeometry(.14, 4)), rugPattern, x, z).scale.set(1, .66, 1)
          }
          // One fringe band per end rather than eleven separate knots: at the
          // size this rug ever occupies on screen the individual tassels were
          // sub-pixel detail that only cost draw calls.
          for (const side of [-1, 1]) addMesh(prop, constantGeometry('BoxGeometry:.045,.014,1.32', () => new THREE.BoxGeometry(.045, .014, 1.32)), rugTrim, [side * 2.25, .018, 0])
        },
        fig_tree: (asset) => {
          // The corner where the window jamb meets the wall, so the tree stands
          // in the daylight without covering the view.
          const prop = decorProp(asset, root, [-1.35, 0, -3.18], 0, .62, false)
          addMesh(prop, constantGeometry('CylinderGeometry:.3,.23,.5,20', () => new THREE.CylinderGeometry(.3, .23, .5, 20)), terracotta, [0, .25, 0])
          addMesh(prop, constantGeometry('TorusGeometry:.3,.028,8,22', () => new THREE.TorusGeometry(.3, .028, 8, 22)), terracotta, [0, .48, 0], [Math.PI / 2, 0, 0])
          addMesh(prop, constantGeometry('CylinderGeometry:.27,.27,.04,18', () => new THREE.CylinderGeometry(.27, .27, .04, 18)), darkWood, [0, .48, 0])
          addCapsuleBetween(prop, new THREE.Vector3(0, .48, 0), new THREE.Vector3(.07, 1.38, -.03), .052, darkWood)
          for (let branch = 0; branch < 3; branch += 1) {
            const angle = branch / 3 * Math.PI * 2 + .4
            addCapsuleBetween(
              prop,
              new THREE.Vector3(.05, 1.2 + branch * .12, -.02),
              new THREE.Vector3(Math.cos(angle) * .34, 1.62 + branch * .18, Math.sin(angle) * .26),
              .03,
              darkWood,
            )
          }
          for (let leaf = 0; leaf < 9; leaf += 1) {
            const angle = leaf / 9 * Math.PI * 2 + .7
            const height = 1.5 + (leaf % 4) * .22
            const clump = addMesh(prop, new THREE.SphereGeometry(.25 + (leaf % 3) * .05, 16, 12), leaf % 2 ? foliage : foliageLight, [Math.cos(angle) * (.16 + (leaf % 3) * .12), height, Math.sin(angle) * (.12 + (leaf % 3) * .08)])
            clump.scale.set(1.05, .62, .9)
            clump.rotation.z = Math.cos(angle) * .3
          }
        },
        chesterfield: (asset) => {
          const prop = decorProp(asset, root, [-3.9, 0, -3.26], .26, 1.1, false)
          addMesh(prop, roundedBox(1.78, .32, .78, 4, .12), oxblood, [0, .5, .02])
          addMesh(prop, roundedBox(1.78, .66, .22, 4, .095), oxblood, [0, .9, -.29], [-.1, 0, 0])
          addMesh(prop, constantGeometry('CylinderGeometry:.11,.11,1.78,14', () => new THREE.CylinderGeometry(.11, .11, 1.78, 14)), oxblood, [0, 1.21, -.34], [0, 0, Math.PI / 2])
          for (const x of [-.81, .81]) {
            addMesh(prop, roundedBox(.17, .46, .8, 4, .07), oxblood, [x, .74, .02])
            addMesh(prop, constantGeometry('CylinderGeometry:.095,.095,.8,14', () => new THREE.CylinderGeometry(.095, .095, .8, 14)), oxblood, [x, .98, .02], [Math.PI / 2, 0, 0])
            for (const z of [-.27, .29]) addMesh(prop, constantGeometry('CylinderGeometry:.035,.045,.34,10', () => new THREE.CylinderGeometry(.035, .045, .34, 10)), brass, [x * .88, .17, z])
          }
          for (let column = 0; column < 5; column += 1) {
            for (let row = 0; row < 2; row += 1) {
              addMesh(prop, constantGeometry('SphereGeometry:.026,10,8', () => new THREE.SphereGeometry(.026, 10, 8)), darkWood, [-.56 + column * .28, .77 + row * .24, -.18 + row * .012])
            }
          }
          addMesh(prop, constantGeometry('BoxGeometry:1.7,.012,.028', () => new THREE.BoxGeometry(1.7, .012, .028)), darkWood, [0, .662, .02])
        },
        reporter_wall: (asset) => {
          // Left of the library bookcase, which the room installs at x 6.15.
          const prop = decorProp(asset, root, [3.95, 0, -3.4], 0, 1.18, false)
          // An open carcass: back panel, two stiles, plinth and cornice. A solid
          // block would bury the spines inside the case.
          addMesh(prop, constantGeometry('BoxGeometry:2.1,1.78,.06', () => new THREE.BoxGeometry(2.1, 1.78, .06)), darkWood, [0, .92, -.15])
          for (const x of [-1.0, 1.0]) addMesh(prop, roundedBox(.1, 1.84, .34, 3, .03), darkWood, [x, .92, 0])
          addMesh(prop, constantGeometry('BoxGeometry:2.2,.1,.42', () => new THREE.BoxGeometry(2.2, .1, .42)), brass, [0, 1.89, 0])
          addMesh(prop, constantGeometry('BoxGeometry:2.16,.12,.4', () => new THREE.BoxGeometry(2.16, .12, .4)), darkWood, [0, .06, 0])
          for (let row = 0; row < 4; row += 1) {
            const shelfY = .17 + row * .41
            addMesh(prop, constantGeometry('BoxGeometry:1.9,.05,.32', () => new THREE.BoxGeometry(1.9, .05, .32)), wood, [0, shelfY, .0])
            for (let book = 0; book < 9; book += 1) {
              const height = .28 + seeded(row * 13 + book) * .06
              // Vellum volumes among the leather ones: an all-dark run of spines
              // reads as one black mass against walnut at the later finishes.
              const cloth = book % 4 === 0 ? paper : book % 4 === 1 ? teal : book % 4 === 2 ? spine : leather
              const volume = addMesh(prop, roundedBox(.16, height, .26, 2, .012), cloth, [-.86 + book * .215, shelfY + .025 + height / 2, .03], [0, 0, (seeded(book + row * 5) - .5) * .05])
              addMesh(prop, constantGeometry('BoxGeometry:.11,.022,.015', () => new THREE.BoxGeometry(.11, .022, .015)), brass, [volume.position.x, shelfY + .025 + height * .72, .17])
            }
          }
          // Gilt spines against dark walnut disappear on an unlit wall, so the
          // case carries its own reading light the way the room's sconces do.
          addMesh(prop, roundedBox(1.1, .1, .22, 3, .04), brass, [0, 2.06, .12])
          for (const x of [-.34, .34]) addMesh(prop, constantGeometry('CylinderGeometry:.02,.02,.18,10', () => new THREE.CylinderGeometry(.02, .02, .18, 10)), brass, [x, 1.97, .1])
          const shelfGlow = addMesh(prop, constantGeometry('BoxGeometry:.94,.03,.06', () => new THREE.BoxGeometry(.94, .03, .06)), glow, [0, 2.0, .17])
          shelfGlow.castShadow = false
          const shelfLight = new THREE.PointLight(0xffd39a, .7, 2.8, 1.9)
          shelfLight.position.set(0, 1.86, .42)
          shelfLight.castShadow = false
          prop.add(shelfLight)
        },
        grandfather_clock: (asset) => {
          const prop = decorProp(asset, root, [-.22, 0, -3.34], 0, .55, false)
          addMesh(prop, constantGeometry('BoxGeometry:.66,.12,.4', () => new THREE.BoxGeometry(.66, .12, .4)), darkWood, [0, .06, 0])
          addMesh(prop, roundedBox(.54, 1.86, .32, 4, .035), darkWood, [0, .98, 0])
          addMesh(prop, roundedBox(.64, .5, .38, 4, .045), darkWood, [0, 2.16, 0])
          addMesh(prop, constantGeometry('BoxGeometry:.7,.09,.42', () => new THREE.BoxGeometry(.7, .09, .42)), brass, [0, 2.44, 0])
          addMesh(prop, constantGeometry('SphereGeometry:.055,14,10', () => new THREE.SphereGeometry(.055, 14, 10)), brass, [0, 2.53, 0])
          addMesh(prop, constantGeometry('CylinderGeometry:.19,.19,.035,26', () => new THREE.CylinderGeometry(.19, .19, .035, 26)), paper, [0, 2.16, .2], [Math.PI / 2, 0, 0])
          addMesh(prop, constantGeometry('TorusGeometry:.2,.02,8,26', () => new THREE.TorusGeometry(.2, .02, 8, 26)), brass, [0, 2.16, .215])
          for (let mark = 0; mark < 12; mark += 1) {
            const angle = mark / 12 * Math.PI * 2
            addMesh(prop, constantGeometry('BoxGeometry:.016,.03,.01', () => new THREE.BoxGeometry(.016, .03, .01)), charcoal, [Math.cos(angle) * .145, 2.16 + Math.sin(angle) * .145, .222])
          }
          addMesh(prop, constantGeometry('BoxGeometry:.018,.13,.012', () => new THREE.BoxGeometry(.018, .13, .012)), charcoal, [0, 2.22, .228])
          addMesh(prop, constantGeometry('BoxGeometry:.09,.016,.012', () => new THREE.BoxGeometry(.09, .016, .012)), charcoal, [.04, 2.16, .228], [0, 0, .3])
          const pane = addMesh(prop, constantGeometry('BoxGeometry:.3,.92,.015', () => new THREE.BoxGeometry(.3, .92, .015)), decorGlass, [0, 1.16, .165])
          pane.castShadow = false
          addMesh(prop, constantGeometry('CylinderGeometry:.012,.012,.74,8', () => new THREE.CylinderGeometry(.012, .012, .74, 8)), brass, [0, 1.24, .13])
          addMesh(prop, constantGeometry('CylinderGeometry:.085,.085,.02,20', () => new THREE.CylinderGeometry(.085, .085, .02, 20)), brass, [0, .84, .13], [Math.PI / 2, 0, 0])
          for (const x of [-.11, .11]) addMesh(prop, constantGeometry('CylinderGeometry:.035,.035,.26,12', () => new THREE.CylinderGeometry(.035, .035, .26, 12)), brass, [x, 1.72, .1])
        },
        skyline_painting: (asset) => {
          const prop = decorProp(asset, root, [cabinetX, 2.5, rearWallZ - .12], Math.PI, .95, true)
          addMesh(prop, roundedBox(1.72, 1.32, .08, 3, .03), brass, [0, 0, 0])
          addMesh(prop, roundedBox(1.5, 1.1, .03, 3, .014), canvasSky, [0, 0, .05])
          for (let building = 0; building < 12; building += 1) {
            const height = .2 + seeded(building + 61) * .52
            addMesh(prop, new THREE.BoxGeometry(.13, height, .014), building % 3 ? charcoal : darkWood, [-.62 + building * .115, -.5 + height / 2, .064])
            if (building % 3 === 0) addMesh(prop, constantGeometry('BoxGeometry:.05,.03,.016', () => new THREE.BoxGeometry(.05, .03, .016)), stainAmber, [-.62 + building * .115, -.42 + height * .6, .07])
          }
          const dome = addMesh(prop, new THREE.SphereGeometry(.16, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), brass, [.42, -.15, .064])
          dome.scale.set(1, .82, .3)
          addMesh(prop, constantGeometry('BoxGeometry:.14,.2,.014', () => new THREE.BoxGeometry(.14, .2, .014)), darkWood, [.42, -.4, .062])
          addMesh(prop, constantGeometry('BoxGeometry:1.5,.03,.016', () => new THREE.BoxGeometry(1.5, .03, .016)), darkWood, [0, -.52, .066])
          addMesh(prop, roundedBox(.42, .06, .06, 2, .022), brass, [0, .74, .05])
        },
        trophy_shelf: (asset) => {
          // Hung on the working wall behind the desk rather than a side wall the
          // camera only ever sees from across the room.
          const prop = decorProp(asset, root, [3.95, 2.74, decorWallZ], 0, .7, true)
          addMesh(prop, roundedBox(1.0, .92, .035, 3, .02), darkWood, [0, .16, .01])
          for (let shelf = 0; shelf < 2; shelf += 1) {
            const shelfY = -.12 + shelf * .48
            addMesh(prop, roundedBox(.94, .06, .28, 3, .02), darkWood, [0, shelfY, .15])
            for (const x of [-.36, .36]) addMesh(prop, constantGeometry('BoxGeometry:.05,.1,.22', () => new THREE.BoxGeometry(.05, .1, .22)), brass, [x, shelfY - .07, .12])
            const strip = addMesh(prop, constantGeometry('BoxGeometry:.86,.022,.022', () => new THREE.BoxGeometry(.86, .022, .022)), glow, [0, shelfY + .38, .24])
            strip.castShadow = false
            if (shelf === 0) {
              addMesh(prop, constantGeometry('CylinderGeometry:.075,.05,.16,18', () => new THREE.CylinderGeometry(.075, .05, .16, 18)), brass, [-.28, shelfY + .12, .16])
              addMesh(prop, constantGeometry('CylinderGeometry:.028,.05,.1,14', () => new THREE.CylinderGeometry(.028, .05, .1, 14)), brass, [-.28, shelfY + .09, .16])
              for (const side of [-1, 1]) addMesh(prop, new THREE.TorusGeometry(.045, .012, 6, 16, Math.PI), brass, [-.28 + side * .09, shelfY + .13, .16], [0, 0, side * Math.PI / 2])
              addMesh(prop, roundedBox(.22, .26, .03, 3, .014), darkWood, [.04, shelfY + .16, .14])
              addMesh(prop, roundedBox(.16, .19, .016, 2, .008), brass, [.04, shelfY + .16, .158])
              addMesh(prop, constantGeometry('ConeGeometry:.055,.3,4', () => new THREE.ConeGeometry(.055, .3, 4)), marble, [.34, shelfY + .18, .15])
            } else {
              addMesh(prop, constantGeometry('CylinderGeometry:.06,.085,.06,18', () => new THREE.CylinderGeometry(.06, .085, .06, 18)), darkWood, [-.3, shelfY + .06, .16])
              addMesh(prop, constantGeometry('SphereGeometry:.07,16,12', () => new THREE.SphereGeometry(.07, 16, 12)), brass, [-.3, shelfY + .15, .16])
              addMesh(prop, roundedBox(.3, .22, .028, 3, .014), darkWood, [.1, shelfY + .15, .14])
              addMesh(prop, constantGeometry('CylinderGeometry:.06,.06,.014,20', () => new THREE.CylinderGeometry(.06, .06, .014, 20)), brass, [.1, shelfY + .15, .16], [Math.PI / 2, 0, 0])
              addMesh(prop, constantGeometry('BoxGeometry:.1,.016,.012', () => new THREE.BoxGeometry(.1, .016, .012)), paper, [.1, shelfY + .04, .156])
            }
          }
        },
        justice_bust: (asset) => {
          const prop = decorProp(asset, root, [1.78, 0, 4.78], Math.PI - .16, .54, false)
          addMesh(prop, roundedBox(.5, 1.14, .5, 4, .03), charcoal, [0, .57, 0])
          addMesh(prop, constantGeometry('BoxGeometry:.58,.07,.58', () => new THREE.BoxGeometry(.58, .07, .58)), brass, [0, 1.17, 0])
          addMesh(prop, constantGeometry('BoxGeometry:.56,.06,.56', () => new THREE.BoxGeometry(.56, .06, .56)), charcoal, [0, .04, 0])
          addMesh(prop, constantGeometry('TorusGeometry:.09,.012,6,22', () => new THREE.TorusGeometry(.09, .012, 6, 22)), brass, [0, .74, .26])
          addMesh(prop, constantGeometry('BoxGeometry:.24,.014,.012', () => new THREE.BoxGeometry(.24, .014, .012)), brass, [0, .8, .26])
          for (const x of [-.1, .1]) addMesh(prop, constantGeometry('CylinderGeometry:.045,.045,.01,16', () => new THREE.CylinderGeometry(.045, .045, .01, 16)), brass, [x, .73, .265], [Math.PI / 2, 0, 0])
          // A carved bust is cut square at the chest and sits on a plinth block.
          // Stacked balls read as a snowman and stacked slabs as a cake, so the
          // mass is a faceted tapering torso with a carved shoulder line, sized
          // life-size to stay legible from across the room.
          addMesh(prop, constantGeometry('BoxGeometry:.46,.11,.38', () => new THREE.BoxGeometry(.46, .11, .38)), marble, [0, 1.27, 0])
          addMesh(prop, constantGeometry('CylinderGeometry:.26,.35,.44,8', () => new THREE.CylinderGeometry(.26, .35, .44, 8)), marble, [0, 1.55, 0])
          addMesh(prop, constantGeometry('BoxGeometry:.72,.17,.34', () => new THREE.BoxGeometry(.72, .17, .34)), marble, [0, 1.72, .01])
          addMesh(prop, constantGeometry('CylinderGeometry:.075,.095,.15,12', () => new THREE.CylinderGeometry(.075, .095, .15, 12)), marble, [0, 1.87, .01])
          const head = addMesh(prop, constantGeometry('SphereGeometry:.18,18,12', () => new THREE.SphereGeometry(.18, 18, 12)), marble, [0, 2.04, .01])
          head.scale.set(.86, 1.1, .9)
          addMesh(prop, constantGeometry('ConeGeometry:.035,.09,6', () => new THREE.ConeGeometry(.035, .09, 6)), marble, [0, 2.0, .16], [Math.PI / 2, 0, 0])
          addMesh(prop, constantGeometry('BoxGeometry:.13,.07,.07', () => new THREE.BoxGeometry(.13, .07, .07)), marble, [0, 1.91, .12])
          // The blindfold is a narrow band tied across the eyes. Carried over the
          // whole crown it reads as a hat, so it stops at the temples and the
          // carved hair sits above it.
          addMesh(prop, constantGeometry('BoxGeometry:.27,.062,.12', () => new THREE.BoxGeometry(.27, .062, .12)), charcoal, [0, 2.07, .11])
          for (const side of [-1, 1]) addMesh(prop, constantGeometry('BoxGeometry:.07,.058,.12', () => new THREE.BoxGeometry(.07, .058, .12)), charcoal, [side * .145, 2.07, .01])
          const crown = addMesh(prop, constantGeometry('SphereGeometry:.185,20,14', () => new THREE.SphereGeometry(.185, 20, 14)), marble, [0, 2.15, -.01])
          crown.scale.set(.92, .6, .94)
          const bun = addMesh(prop, constantGeometry('SphereGeometry:.095,16,12', () => new THREE.SphereGeometry(.095, 16, 12)), marble, [0, 2.09, -.18])
          bun.scale.set(1, .9, .85)
        },
        globe_bar: (asset) => {
          const prop = decorProp(asset, root, [Math.min(roomHalf - 3.9, 6.1), 0, 4.05], -.42, .6, false)
          for (let leg = 0; leg < 3; leg += 1) {
            const angle = leg / 3 * Math.PI * 2
            addCapsuleBetween(prop, new THREE.Vector3(Math.cos(angle) * .3, .02, Math.sin(angle) * .3), new THREE.Vector3(0, .5, 0), .028, darkWood)
          }
          addMesh(prop, constantGeometry('CylinderGeometry:.34,.34,.022,26', () => new THREE.CylinderGeometry(.34, .34, .022, 26)), darkWood, [0, .04, 0])
          addMesh(prop, constantGeometry('CylinderGeometry:.05,.07,.1,14', () => new THREE.CylinderGeometry(.05, .07, .1, 14)), brass, [0, .53, 0])
          addMesh(prop, constantGeometry('SphereGeometry:.3,20,14', () => new THREE.SphereGeometry(.3, 20, 14)), stainCobalt, [0, .84, 0])
          for (let land = 0; land < 6; land += 1) {
            const angle = land / 6 * Math.PI * 2 + .5
            const patch = addMesh(prop, new THREE.SphereGeometry(.12 + (land % 3) * .035, 14, 10), land % 2 ? foliageLight : canvasSky, [Math.cos(angle) * .24, .84 + Math.sin(angle * 1.7) * .16, Math.sin(angle) * .24])
            patch.scale.set(.9, .62, .9)
          }
          addMesh(prop, constantGeometry('TorusGeometry:.315,.016,8,34', () => new THREE.TorusGeometry(.315, .016, 8, 34)), brass, [0, .84, 0], [Math.PI / 2, 0, 0])
          addMesh(prop, constantGeometry('TorusGeometry:.34,.018,8,36', () => new THREE.TorusGeometry(.34, .018, 8, 36)), brass, [0, .84, 0], [0, .38, 0])
          const tray = addMesh(prop, constantGeometry('CylinderGeometry:.17,.17,.018,20', () => new THREE.CylinderGeometry(.17, .17, .018, 20)), brass, [.42, .56, .18])
          tray.castShadow = false
          const decanter = addMesh(prop, constantGeometry('CylinderGeometry:.055,.075,.17,14', () => new THREE.CylinderGeometry(.055, .075, .17, 14)), decorGlass, [.42, .655, .18])
          decanter.castShadow = false
          addMesh(prop, constantGeometry('SphereGeometry:.03,12,8', () => new THREE.SphereGeometry(.03, 12, 8)), brass, [.42, .76, .18])
          for (const offset of [-.09, .09]) {
            const tumbler = addMesh(prop, constantGeometry('CylinderGeometry:.032,.028,.07,12', () => new THREE.CylinderGeometry(.032, .028, .07, 12)), decorGlass, [.42 + offset, .6, .18 + offset * .6])
            tumbler.castShadow = false
          }
        },
        stained_glass: (asset) => {
          // A leaded transom across the head of the existing window. A disc in
          // the middle of the glass would both block the view the office is
          // built around and read as a pinwheel rather than architecture.
          const panelHeight = Math.min(.96, windowHeight * .26)
          const panelWidth = windowWidth - .12
          const prop = decorProp(asset, windowGroup, [0, windowHeight / 2 - panelHeight / 2 - .06, .155], 0, panelWidth * .5, true)
          const lights = 5
          const courses = 3
          const lightWidth = (panelWidth - .1) / lights
          const courseHeight = (panelHeight - .18) / courses
          // Leaded glass is a grid of small quarries in one narrow palette. Large
          // single-colour lights with pointed caps read as bunting instead.
          for (let light = 0; light < lights; light += 1) {
            const x = -panelWidth / 2 + .05 + lightWidth * (light + .5)
            for (let course = 0; course < courses; course += 1) {
              const y = -panelHeight / 2 + .09 + courseHeight * (course + .5)
              const pane = addMesh(prop, new THREE.BoxGeometry(lightWidth - .05, courseHeight - .05, .02), stains[(light + course * 2) % stains.length], [x, y, 0])
              pane.castShadow = false
              const quarry = addMesh(prop, new THREE.CircleGeometry(Math.min(lightWidth, courseHeight) * .26, 4), course % 2 ? stainAmber : stainEmerald, [x, y, .014])
              quarry.castShadow = false
            }
            addMesh(prop, new THREE.BoxGeometry(.022, panelHeight - .16, .026), charcoal, [x - lightWidth / 2, 0, .016])
          }
          addMesh(prop, new THREE.BoxGeometry(.022, panelHeight - .16, .026), charcoal, [panelWidth / 2 - .05, 0, .016])
          for (let course = 1; course < courses; course += 1) {
            addMesh(prop, new THREE.BoxGeometry(panelWidth - .1, .022, .026), charcoal, [0, -panelHeight / 2 + .09 + courseHeight * course, .016])
          }
          const roundel = addMesh(prop, new THREE.CircleGeometry(panelHeight * .21, 20), stainAmber, [0, -.02, .022])
          roundel.castShadow = false
          addMesh(prop, new THREE.TorusGeometry(panelHeight * .21, .018, 8, 26), charcoal, [0, -.02, .024])
          // Scales in lead: a beam, a pivot and two pans.
          addMesh(prop, new THREE.BoxGeometry(panelHeight * .26, .022, .014), charcoal, [0, .04, .03])
          addMesh(prop, new THREE.BoxGeometry(.02, panelHeight * .16, .014), charcoal, [0, -.04, .03])
          for (const side of [-1, 1]) addMesh(prop, constantGeometry('CylinderGeometry:.035,.012,.03,10', () => new THREE.CylinderGeometry(.035, .012, .03, 10)), charcoal, [side * panelHeight * .13, -.01, .03])
          for (const y of [panelHeight / 2 - .05, -panelHeight / 2 + .05]) {
            addMesh(prop, new THREE.BoxGeometry(panelWidth + .1, .08, .1), brass, [0, y, .012])
          }
        },
        charter_vitrine: (asset) => {
          const prop = decorProp(asset, root, [2.7, 0, 4.66], Math.PI, .62, false)
          addMesh(prop, roundedBox(.8, .7, .5, 4, .03), charcoal, [0, .35, 0])
          addMesh(prop, constantGeometry('BoxGeometry:.86,.05,.56', () => new THREE.BoxGeometry(.86, .05, .56)), brass, [0, .72, 0])
          for (const x of [-.34, .34]) for (const z of [-.21, .21]) addMesh(prop, constantGeometry('BoxGeometry:.03,.62,.03', () => new THREE.BoxGeometry(.03, .62, .03)), brass, [x, 1.06, z])
          addMesh(prop, constantGeometry('BoxGeometry:.74,.04,.48', () => new THREE.BoxGeometry(.74, .04, .48)), brass, [0, 1.39, 0])
          const cover = addMesh(prop, roundedBox(.7, .6, .44, 3, .012), decorGlass, [0, 1.06, 0])
          cover.castShadow = false
          const charter = addMesh(prop, roundedBox(.44, .5, .018, 2, .008), paper, [0, 1.04, .02], [-.14, 0, 0])
          charter.castShadow = false
          for (let line = 0; line < 6; line += 1) {
            addMesh(prop, new THREE.BoxGeometry(.26 - (line % 3) * .05, .014, .01), charcoal, [-.02, 1.19 - line * .06, .04])
          }
          addMesh(prop, constantGeometry('CylinderGeometry:.04,.04,.01,14', () => new THREE.CylinderGeometry(.04, .04, .01, 14)), stainRuby, [.11, .86, .05], [Math.PI / 2, 0, 0])
          const lamp = addMesh(prop, constantGeometry('BoxGeometry:.5,.02,.18', () => new THREE.BoxGeometry(.5, .02, .18)), glow, [0, 1.35, 0])
          lamp.castShadow = false
          addMesh(prop, roundedBox(.3, .045, .06, 2, .018), brass, [0, .755, .19])
        },
        orchid_wall: (asset) => {
          const prop = decorProp(asset, root, [-cabinetX, 2.32, rearWallZ - .12], Math.PI, 1.4, true)
          addMesh(prop, roundedBox(2.42, 2.06, .16, 4, .045), darkWood, [0, 0, 0])
          addMesh(prop, constantGeometry('BoxGeometry:2.2,1.82,.06', () => new THREE.BoxGeometry(2.2, 1.82, .06)), foliage, [0, .02, .09])
          // A denser planting was indistinguishable from this one: the leaves
          // already overlap into a continuous mass at the size the panel is
          // ever seen, so the extra clumps were pure cost.
          for (let clump = 0; clump < 36; clump += 1) {
            const column = clump % 6
            const row = Math.floor(clump / 6)
            const leaf = addMesh(prop, new THREE.SphereGeometry(.15 + seeded(clump + 5) * .07, 10, 6), clump % 3 ? foliage : foliageLight, [-.9 + column * .36, -.76 + row * .3 + (seeded(clump) - .5) * .12, .13 + seeded(clump + 40) * .05])
            leaf.scale.set(1.15, .74, .52)
            leaf.rotation.z = (seeded(clump + 20) - .5) * .9
            leaf.castShadow = false
          }
          // Orchids are staked stems, so each one arcs out of the planting and
          // carries its blooms clear of the leaf mass.
          for (let stem = 0; stem < 7; stem += 1) {
            const x = -1.0 + stem * .34
            const base = -.62 + (stem % 3) * .34
            addCapsuleBetween(prop, new THREE.Vector3(x, base, .17), new THREE.Vector3(x + .1, base + .46, .24), .014, foliageLight)
            for (let flower = 0; flower < 2; flower += 1) {
              const y = base + .24 + flower * .14
              addMesh(prop, new THREE.SphereGeometry(.058 - flower * .008, 10, 6), bloom, [x + .05 + flower * .02, y, .23]).castShadow = false
              addMesh(prop, constantGeometry('SphereGeometry:.017,6,4', () => new THREE.SphereGeometry(.017, 6, 4)), stainAmber, [x + .05 + flower * .02, y, .27]).castShadow = false
            }
          }
          addMesh(prop, roundedBox(2.3, .16, .34, 3, .04), brass, [0, -1.06, .1])
          for (const y of [.98, -.9]) {
            const rail = addMesh(prop, constantGeometry('BoxGeometry:2.12,.03,.03', () => new THREE.BoxGeometry(2.12, .03, .03)), glow, [0, y, .2])
            rail.castShadow = false
          }
          const growLight = new THREE.PointLight(0xbfe3c4, .3, 2.6, 2)
          growLight.position.set(0, .4, .5)
          growLight.castShadow = false
          prop.add(growLight)
        },
      }
      decorAssets.forEach((asset) => decorBuilders[asset.key]?.(asset))
    }

    // The active shift remains intentionally small, while this department
    // board represents every hired person. Selecting an off-shift employee in
    // the complete roster focuses this board instead of failing silently.
    if (staffAssets.length) {
      const staffFloor = new THREE.Group()
      staffFloor.position.set(roomHalf - .16, 4.3, 1.05)
      staffFloor.rotation.y = -Math.PI / 2
      root.add(staffFloor)
      addMesh(staffFloor, roundedBox(2.25, 1.15, .09, 4, .035), charcoal, [0, 0, 0])
      const staffFloorHalo = attachFocus([], staffFloor, .72, 0, [0, 0, 0])
      const staffColumns = 10
      staffAssets.forEach((asset, index) => {
        const column = index % staffColumns
        const row = Math.floor(index / staffColumns)
        addMesh(staffFloor, constantGeometry('CylinderGeometry:.045,.045,.025,14', () => new THREE.CylinderGeometry(.045, .045, .025, 14)), index % 3 ? glow : brass, [-.91 + column * .2, .34 - row * .29, .07], [Math.PI / 2, 0, 0])
        focusTargets.set(asset.key, { object: staffFloor, halo: staffFloorHalo })
      })
    }

    // A rotating active shift keeps the room legible. Staff occupy reserved
    // departmental bays and receive furniture that reflects their work rather
    // than standing wherever the room happened to have an empty coordinate.
    const shiftSize = Math.min(environment.staffOnShift, staffAssets.length)
    const activeStaff: GameAsset[] = []
    const representedDepartments = new Set<OfficeStaffStation>()
    // Build a plausible shift: expose as many departments as the room allows,
    // then fill remaining seats with the most recently hired specialists.
    ;[...staffAssets].reverse().forEach((asset) => {
      const station = officeStaffStationFor(asset.key)
      if (activeStaff.length >= shiftSize || representedDepartments.has(station)) return
      representedDepartments.add(station)
      activeStaff.push(asset)
    })
    ;[...staffAssets].reverse().forEach((asset) => {
      if (activeStaff.length < shiftSize && !activeStaff.includes(asset)) activeStaff.push(asset)
    })
    // Where the wings sit is now a question about the camera, not the walls.
    //
    // This used to be measured inward from the side wall, which sounds right
    // and is the wrong way round. The room widens with tier - fifteen units at
    // tier zero, twenty at tier four and above - while the camera's orbit
    // radius does not, so bays pinned to the wall walked steadily out of frame
    // as the firm grew. At the top tier the outermost desks sat seven to eight
    // units off centre and were simply not on screen: the reward for hiring
    // was staff you could not see.
    //
    // So the run is placed at a distance chosen for the view and then pulled
    // *in* as the tier rises, which is the opposite of what it did before and
    // the reason a full house now reads as a full house. Two adjustments on
    // top of that:
    //
    // The tier term closes the wings by up to 0.7 units as the roster grows,
    // so five people at tier twelve are framed as tightly as two at tier one.
    //
    // The crowd term handles the other end. One person on an otherwise empty
    // floor, parked against the far wing, reads as somebody sent to sit in the
    // corner - which is exactly how tier zero looked. With fewer than three on
    // shift the room closes up around whoever is actually in it.
    //
    // Both are bounded, and both leave far more room behind the desks than the
    // old placement did: the service strip behind a wing is now around three
    // units rather than the metre that used to be there.
    // A lone hire gets a much larger pull than the linear term would give it.
    // Tier zero seats exactly one person, and at the authored wing distance
    // they sat outside the opening frame entirely, in the unlit corner of a
    // room whose whole lighting budget is a hearth and a lantern - which is
    // the "dark and off to the side" that a single hire has always looked
    // like. There is no competition for floor when there is one person on it,
    // so they may as well sit where the camera already is.
    const crowdPull = activeStaff.length <= 1 ? 1.5 : Math.max(0, 3 - activeStaff.length) * .34
    const stationWingX = 4.55 - Math.min(.7, level * .06) - crowdPull
    const stationSlots = {
      // Workstations live along the side wings and face into the office. The
      // family cant is a subtle authored offset from that inward orientation,
      // not the complete rotation; treating it as the latter made monitors
      // face the entry camera and visually block the partner desk.
      left: layoutFamily.stationRows.map((z, index) => ({ x: -stationWingX, z, rotation: Math.PI / 2 - layoutFamily.stationCant[index] })),
      right: layoutFamily.stationRows.map((z, index) => ({ x: stationWingX, z, rotation: -Math.PI / 2 + layoutFamily.stationCant[index] })),
    }
    const usedStationSlots = new Set<string>()
    const sideCount = { left: 0, right: 0 }
    const preferredSide = (station: OfficeStaffStation) => ['technology', 'leadership', 'diplomatic'].includes(station) ? 'right' as const : 'left' as const
    const reserveStationSlot = (station: OfficeStaffStation) => {
      const preferred = preferredSide(station)
      const other = preferred === 'left' ? 'right' as const : 'left' as const
      // Balance the two wings instead of exhausting the preferred side first.
      // Most stations preferred 'left', so the old fill-one-side-then-spill
      // order packed every hire into the left third of the room and left the
      // right half as dead floor. Seat each new hire on whichever wing has
      // fewer people so far, with the station's natural side breaking ties.
      const sides = sideCount[preferred] <= sideCount[other] ? [preferred, other] : [other, preferred]
      for (const side of sides) {
        for (let index = 0; index < stationSlots[side].length; index += 1) {
          const key = `${side}:${index}`
          if (usedStationSlots.has(key)) continue
          usedStationSlots.add(key)
          sideCount[side] += 1
          return stationSlots[side][index]
        }
      }
      return stationSlots[preferred][0]
    }

    const occupiedWings: { x: number, z: number }[] = []
    const addStaffStation = (station: OfficeStaffStation, asset: GameAsset, index: number) => {
      const slot = reserveStationSlot(station)
      const bay = new THREE.Group()
      bay.position.set(slot.x, 0, slot.z)
      bay.rotation.y = slot.rotation
      bay.userData.staffStation = station
      bay.userData.staffKey = asset.key
      root.add(bay)

      // Every light is evaluated for every lit fragment in the room, so a light
      // per bay made the office progressively slower with each hire. The wings
      // are lit once each instead, below.
      occupiedWings.push(slot)

      const stationWood = level >= 8 ? charcoal : wood
      const stationMetal = level >= 9 ? brass : charcoal
      const stationScreen = sharedStandard({ color: 0x10272d, emissive: 0x174a4c, emissiveIntensity: .24, roughness: .38, metalness: .14 })
      const matColor = station === 'leadership' ? look.accent : station === 'diplomatic' ? 0x32595b : look.upholstery
      // Bays sit closer together than their mats are long, so neighbouring mats
      // overlap. Each shift member's mat therefore gets its own plane instead of
      // sharing y with the next one, which otherwise z-fights along the seam.
      addMesh(bay, constantGeometry('PlaneGeometry:2.15,1.72', () => new THREE.PlaneGeometry(2.15, 1.72)), sharedStandard({ color: matColor, roughness: .96 }), [0, .012 + index * .0015, .12], [-Math.PI / 2, 0, 0])

      if (station === 'diplomatic') {
        // Client-facing counsel share a briefing salon. The lawyer occupies
        // the head of the table while the two forward seats remain visibly
        // available for clients, interpreters, or opposing counsel.
        addMesh(bay, constantGeometry('CylinderGeometry:.78,.72,.12,32', () => new THREE.CylinderGeometry(.78, .72, .12, 32)), stationWood, [0, .78, .22])
        addMesh(bay, constantGeometry('CylinderGeometry:.14,.22,.72,18', () => new THREE.CylinderGeometry(.14, .22, .72, 18)), stationMetal, [0, .38, .22])
        for (const x of [-.55, .55]) {
          addMesh(bay, roundedBox(.38, .13, .38, 3, .055), leather, [x, .42, .82])
          addMesh(bay, roundedBox(.38, .48, .12, 3, .05), leather, [x, .67, .98], [-.08, 0, 0])
        }
        addMesh(bay, constantGeometry('CylinderGeometry:.19,.19,.025,28', () => new THREE.CylinderGeometry(.19, .19, .025, 28)), glow, [0, .86, .22])
      } else {
        const leadership = station === 'leadership'
        const deskWidth = leadership ? 2.02 : 1.72
        addMesh(bay, roundedBox(deskWidth, .14, .72, 4, .045), leadership ? wood : stationWood, [0, .82, .23])
        for (const x of [-deskWidth * .39, deskWidth * .39]) addMesh(bay, constantGeometry('BoxGeometry:.1,.76,.55', () => new THREE.BoxGeometry(.1, .76, .55)), leadership ? darkWood : stationMetal, [x, .4, .23])
      }

      if (station === 'reception') {
        // Intake is an open L-shaped counter, not an enclosed workstation.
        addMesh(bay, roundedBox(1.82, .62, .13, 4, .04), wood, [0, .46, .58])
        addMesh(bay, roundedBox(1.12, .52, .075, 4, .03), wood, [-.53, 1.17, -.7])
        addMesh(bay, constantGeometry('CylinderGeometry:.1,.13,.08,18', () => new THREE.CylinderGeometry(.1, .13, .08, 18)), charcoal, [-.54, .94, .21])
        addMesh(bay, new THREE.TorusGeometry(.13, .022, 8, 24, Math.PI * 1.6), charcoal, [-.47, 1.0, .21], [Math.PI / 2, 0, .2])
        for (let tray = 0; tray < 3; tray += 1) addMesh(bay, roundedBox(.45, .025, .31, 2, .008), tray % 2 ? paper : leather, [.48, .91 + tray * .035, .2])
      } else if (station === 'casework') {
        // Associates receive a quiet drafting desk with reachable authorities
        // and files; the low shelf preserves sightlines across the firm floor.
        addMesh(bay, roundedBox(.54, .34, .05, 3, .022), charcoal, [0, 1.22, .02], [-.08, 0, 0])
        addMesh(bay, constantGeometry('PlaneGeometry:.46,.27', () => new THREE.PlaneGeometry(.46, .27)), stationScreen, [0, 1.22, .052], [-.08, 0, 0])
        addMesh(bay, roundedBox(.68, .04, .28, 3, .016), charcoal, [0, .91, .34], [-.04, 0, 0])
        for (let key = 0; key < 8; key += 1) addMesh(bay, roundedBox(.052, .014, .055, 2, .006), key % 3 ? paper : brass, [-.25 + key * .072, .946, .34])
        for (let file = 0; file < 4; file += 1) addMesh(bay, new THREE.BoxGeometry(.12, .42 - file * .035, .24), file % 2 ? paper : leather, [-.65 + file * .15, 1.08, .18], [0, 0, (file - 1.5) * .025])
        // Half-width and pushed to one end. Run across the full bay, as this
        // did, and it becomes a wall behind the chair: the occupant is sealed
        // between their own desk and their own bookshelf with no way out to
        // the aisle, which is why this station never went anywhere.
        addMesh(bay, roundedBox(1.02, .58, .12, 3, .035), darkWood, [-.58, .32, -.72])
        for (let book = 0; book < 5; book += 1) addMesh(bay, new THREE.BoxGeometry(.16, .34 + (book % 3) * .035, .17), book % 3 === 0 ? leather : paper, [-.94 + book * .18, .67, -.7], [0, 0, (book % 2 ? 1 : -1) * .025])
      } else if (station === 'investigation') {
        // Investigators work from a pinboard and wide evidence surface rather
        // than an office partition or computer cubicle.
        addMesh(bay, roundedBox(1.42, .72, .055, 3, .025), sharedStandard({ color: 0x6b4a34, roughness: .94 }), [0, 1.42, -.64])
        for (let note = 0; note < 4; note += 1) addMesh(bay, new THREE.PlaneGeometry(.27 + (note % 2) * .08, .2), paper, [-.5 + note * .32, 1.33 + (note % 2) * .24, -.605], [0, 0, (note - 1.5) * .08])
        addMesh(bay, constantGeometry('TorusGeometry:.18,.025,10,28', () => new THREE.TorusGeometry(.18, .025, 10, 28)), brass, [.54, 1.04, .18], [Math.PI / 2, 0, 0])
        addMesh(bay, constantGeometry('CylinderGeometry:.018,.018,.42,10', () => new THREE.CylinderGeometry(.018, .018, .42, 10)), brass, [.68, .89, .18], [0, 0, -.64])
      } else if (station === 'technology') {
        // A shared systems bench carries two angled displays, local hardware,
        // status lights, and a restrained cable rail behind the operator.
        for (const monitor of [-1, 1]) {
          addMesh(bay, roundedBox(.52, .34, .05, 3, .022), charcoal, [monitor * .29, 1.24, .02], [-.07, monitor * -.16, 0])
          addMesh(bay, constantGeometry('PlaneGeometry:.44,.27', () => new THREE.PlaneGeometry(.44, .27)), stationScreen, [monitor * .29, 1.24, .052], [-.07, monitor * -.16, 0])
        }
        addMesh(bay, roundedBox(.82, .04, .3, 3, .016), charcoal, [0, .91, .35], [-.04, 0, 0])
        for (let key = 0; key < 10; key += 1) addMesh(bay, roundedBox(.05, .014, .055, 2, .006), key % 4 ? paper : glow, [-.31 + key * .069, .946, .35])
        addMesh(bay, roundedBox(.28, .62, .46, 3, .035), charcoal, [.68, .39, -.02])
        for (let light = 0; light < 3; light += 1) addMesh(bay, constantGeometry('SphereGeometry:.025,10,8', () => new THREE.SphereGeometry(.025, 10, 8)), light === 0 ? brass : glow, [.68, .53 - light * .1, .23])
        addMesh(bay, roundedBox(1.06, .18, .1, 3, .03), charcoal, [-.56, .43, -.72])
        for (let port = 0; port < 4; port += 1) addMesh(bay, constantGeometry('BoxGeometry:.09,.035,.025', () => new THREE.BoxGeometry(.09, .035, .025)), port % 2 ? glow : brass, [-.92 + port * .23, .43, -.655])
      } else if (station === 'leadership') {
        // Partners and directors use a private executive desk with writing
        // pad and task lamp, kept open to the room rather than boxed in.
        addMesh(bay, roundedBox(.92, .035, .55, 3, .012), leather, [0, .91, .18])
        addMesh(bay, constantGeometry('CylinderGeometry:.2,.24,.07,22', () => new THREE.CylinderGeometry(.2, .24, .07, 22)), brass, [.64, .94, .12])
        addMesh(bay, constantGeometry('CylinderGeometry:.025,.025,.54,12', () => new THREE.CylinderGeometry(.025, .025, .54, 12)), brass, [.64, 1.2, .12], [0, 0, -.18])
        addMesh(bay, new THREE.ConeGeometry(.22, .26, 22, 1, true), charcoal, [.59, 1.5, .12], [0, 0, Math.PI])
      }

      addMesh(bay, roundedBox(.7, .12, .32, 3, .04), leather, [0, .45, -.34])
      addMesh(bay, roundedBox(.7, .62, .12, 3, .04), leather, [0, .75, -.49], [-.08, 0, 0])
      const plaqueMaterial = station === 'diplomatic' || station === 'leadership' ? brass : teal
      addMesh(bay, roundedBox(.62, .12, .035, 2, .015), plaqueMaterial, [0, .73, .605])

      const hash = castHash(asset.key)
      const staffScale = rustic ? .42 : .46
      const rig = buildStylizedCounsel(knownStaffGenders[asset.key] ?? (hash % 2 ? 'female' : 'male'), level, { role: 'visitor', paletteSeed: hash, renderScale: staffScale })
      rig.root.scale.setScalar(staffScale)
      const actor = new THREE.Group()
      const localHome = new THREE.Vector3(0, 0, -.48).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.rotation)
      const home = new THREE.Vector3(slot.x, 0, slot.z).add(localHome)
      actor.position.copy(home)
      actor.rotation.y = slot.rotation
      // A character is not furniture. Excluding the actor subtree from the
      // obstacle scan below keeps a body from paving over the floor it is
      // standing on; bodies avoid each other through agent separation instead.
      actor.userData.navIgnore = true
      actor.add(rig.root)
      root.add(actor)
      const halo = attachFocus([asset.key], bay, 1.02, .03)
      focusTargets.set(asset.key, { object: rig.root, halo })
      // Bind after the character is in the scene graph: the skeleton measures
      // its own limb lengths from the bind pose in world space, and this rig is
      // scaled down by its parent.
      actor.updateWorldMatrix(true, true)
      const task = deskTaskFor(station, hash)
      const humanoid = new HumanoidActor(rig, {
        seed: hash,
        state: task,
        reduced,
      })
      // Start each character at a different point in its own loop. Without
      // this, five people who all happen to draw `deskType` begin on the same
      // frame and strike the same key together for as long as anyone watches.
      // Rate jitter would eventually pull them apart, but "eventually" is not
      // good enough for the first thing a player sees when the scene opens.
      humanoid.advance(((hash % 97) / 97) * 9 + index * 1.7)
      staffDirector.add(humanoid, STATION_BEHAVIOR[station], hash)
      staffRigs.push({
        rig,
        actor,
        humanoid,
        phase: index * 1.37 + (hash % 17) * .11,
        station,
        task,
        home,
        homeRotation: slot.rotation,
        behaviorRole: STATION_BEHAVIOR[station],
        randomState: hash || 1,
      })
    }

    phase('assets')
    activeStaff.forEach((asset, index) => {
      addStaffStation(officeStaffStationFor(asset.key), asset, index)
    })

    // One overhead pool per staffed wing, centred on the bays it serves, so the
    // cost is fixed at two lights however many people are on shift.
    ;[-1, 1].forEach((side) => {
      const wing = occupiedWings.filter((slot) => Math.sign(slot.x) === side)
      if (!wing.length) return
      // Tier zero is a timber shack lit by a hearth and a lantern, and it was
      // dark enough that its single hire was not merely unflattered but
      // genuinely not visible in the opening frame. Raised to the point where
      // a body at a desk reads, and no further: the gloom is the tier's whole
      // character and the reward for climbing out of it.
      const light = new THREE.PointLight(0xffdaa0, rustic ? .52 : .48, 7.4, 1.5)
      light.position.set(wing[0].x, 2.85, wing.reduce((sum, slot) => sum + slot.z, 0) / wing.length)
      light.castShadow = false
      root.add(light)
    })

    // Open on the room the player actually has.
    //
    // The home framing was authored around the principal desk and then never
    // moved, so as the firm filled up the opening view stayed a close-up of
    // one workstation with the entire staff floor outside the frame. Backing
    // the camera off with headcount is the other half of pulling the bays in:
    // the bays close the gap from their end, this closes it from the camera's,
    // and between them a full shift is in shot at every tier.
    //
    // The pivot drops and moves back as the camera retreats, so the extra
    // distance is spent on floor and desks rather than on ceiling. An office
    // with nobody in it is left exactly as it was.
    // The step per head is small on purpose. The orbit pivot sits inside the
    // room, so radius buys view only up to the point where the camera reaches
    // the front wall and starts rendering the inside of it - measured, a 0.46
    // step put a black slab across the left half of the frame at a full shift.
    // 0.16 stays inside the shell at every tier and headcount.
    const shiftFraming = Math.min(activeStaff.length, 5)
    cameraOrbitHome += shiftFraming * .16
    cameraPivotHome.y -= shiftFraming * .05
    cameraPivotHome.z += shiftFraming * .05
    cameraOrbit = cameraOrbitHome
    cameraPivot.copy(cameraPivotHome)

    // Renovations read as architectural improvements, not loose reward props.
    if (!rustic) {
      const rug = addMesh(root, new THREE.PlaneGeometry(5.2 + Math.min(1.4, level * .1), 3.15), new THREE.MeshStandardMaterial({ color: look.upholstery, roughness: .98, metalness: 0 }), [.15, .018, 1.35], [-Math.PI / 2, 0, 0])
      rug.receiveShadow = true
      addMesh(root, new THREE.BoxGeometry(5.45 + Math.min(1.4, level * .1), .025, 3.36), new THREE.MeshStandardMaterial({ color: look.accent, roughness: .75, metalness: .25 }), [.15, .008, 1.35])
      // The rug surface sits just above its border to avoid z-fighting.
      rug.position.y = .026
    }
    const practicalCount = rustic ? 0 : Math.min(4, Math.max(1, detailLevel - 1))
    for (let index = 0; index < practicalCount; index += 1) {
      const x = -4.5 + index * (9 / Math.max(1, practicalCount - 1))
      addMesh(root, constantGeometry('CylinderGeometry:.25,.29,.08,16', () => new THREE.CylinderGeometry(.25, .29, .08, 16)), charcoal, [x, 6.25, .4])
      addMesh(root, constantGeometry('CircleGeometry:.2,16', () => new THREE.CircleGeometry(.2, 16)), sharedStandard({ color: 0xf0ddb0, emissive: 0xc89b54, emissiveIntensity: .72, roughness: .5 }), [x, 6.20, .4], [Math.PI / 2, 0, 0])
    }
    if (level >= 6) {
      // An integrated evidence wall becomes denser with national/global scale.
      const evidencePanel = new THREE.Group(); evidencePanel.position.set(3.25, 4.55, -3.82); root.add(evidencePanel)
      addMesh(evidencePanel, roundedBox(3.1, 1.1, .09, 4, .035), new THREE.MeshStandardMaterial({ color: 0x101a22, roughness: .38, metalness: .36 }), [0, 0, 0])
      const traceCount = Math.min(9, 3 + Math.floor(level / 2))
      for (let trace = 0; trace < traceCount; trace += 1) addMesh(evidencePanel, new THREE.BoxGeometry(.18 + seeded(trace) * .55, .018, .012), sharedBasic({ color: trace % 3 ? 0x5da39e : look.accent }), [-1.2 + (trace % 4) * .72, -.35 + Math.floor(trace / 4) * .3, .06], [0, 0, (seeded(trace + 4) - .5) * .4])
    }
    if (frontier) {
      // Orbital/lunar tiers gain one coherent, restrained jurisdiction model.
      const jurisdiction = new THREE.Group(); jurisdiction.position.set(4.3, 1.85, -.7); root.add(jurisdiction)
      addMesh(jurisdiction, constantGeometry('SphereGeometry:.32,20,14', () => new THREE.SphereGeometry(.32, 20, 14)), sharedStandard({ color: level === 13 ? 0xaab2b1 : 0x376f7f, roughness: .54, metalness: .18, emissive: level === 14 ? 0x173d48 : 0x000000, emissiveIntensity: .35 }), [0, 0, 0])
      for (let ring = 0; ring < Math.min(3, level - 11); ring += 1) addMesh(jurisdiction, new THREE.TorusGeometry(.48 + ring * .12, .018, 6, 28), brass, [0, 0, 0], [Math.PI / 2 + ring * .38, ring * .31, 0])
    }
    // Broad architectural sources replace the previous high-contrast key.
    // They keep faces and furniture readable from every camera heading while
    // leaving the desk, hearth, and sconces to provide localized warmth.
    phase('staff')
    scene.add(new THREE.HemisphereLight(rustic ? 0x9fb6b5 : 0xc2d6d7, rustic ? 0x2c1d14 : 0x32271e, rustic ? 1.05 : 1.58))
    scene.add(new THREE.AmbientLight(rustic ? 0x8d765e : 0x8ca3aa, rustic ? .34 : .42))
    const keyLight = new THREE.DirectionalLight(rustic ? 0xe7bd89 : 0xffe1b2, rustic ? .46 : .72)
    keyLight.position.set(-3.5, 7.2, 6.5)
    keyLight.castShadow = false
    scene.add(keyLight)
    const ceilingFill = new THREE.RectAreaLight(rustic ? 0xffd29b : 0xffdfb5, rustic ? 2.4 : 3.6, roomWidth * .52, 4.4)
    ceilingFill.position.set(0, 6.1, .35)
    ceilingFill.rotation.x = -Math.PI / 2
    scene.add(ceilingFill)
    const rearFill = new THREE.RectAreaLight(rustic ? 0xc99768 : 0x8fb9c0, rustic ? 1.2 : 2.1, roomWidth * .42, 2.8)
    rearFill.position.set(0, 3.35, rearWallZ - .35)
    rearFill.lookAt(0, 2.25, .3)
    scene.add(rearFill)
    for (const side of [-1, 1]) {
      const sideFill = new THREE.RectAreaLight(side < 0 ? 0xb7d2d0 : 0xffd5a0, rustic ? 1.35 : 2.45, 5.6, 3.1)
      sideFill.position.set(side * (roomHalf - .45), 3.45, .55)
      sideFill.lookAt(0, 2.15, .55)
      scene.add(sideFill)
    }
    const windowLight = new THREE.SpotLight(rustic ? 0x668892 : 0x8fc5d1, rustic ? .82 : 1.42, 14, .82, .82, 1.3)
    windowLight.position.set(windowX, 3.7, -2.8)
    windowLight.target.position.set(-1.2, 0, 2.8)
    scene.add(windowLight, windowLight.target)

    const dustCount = 105
    const dustPositions = new Float32Array(dustCount * 3)
    for (let index = 0; index < dustCount; index += 1) { dustPositions[index * 3] = -roomHalf + .8 + seeded(index) * (roomWidth - 1.6); dustPositions[index * 3 + 1] = .25 + seeded(index + 31) * 5.8; dustPositions[index * 3 + 2] = -3.4 + seeded(index + 61) * 7.5 }
    const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xe8d4a5, size: .025, transparent: true, opacity: .22, depthWrite: false }))
    root.add(dust)

    // Static scenery is deliberately NOT merged into batched meshes here, unlike
    // the world map. Merging was implemented and measured on this room: it cut
    // draw calls from 953 to 581 at the top tier, and moved the frame time by
    // 0.2ms, because the office is bound by per-fragment light evaluation rather
    // than by draw submission — throttling the CPU 4x does not change its frame
    // time at all. It did cost 123ms of time to first frame to do the merging,
    // so it was a straight loss. Cutting a light is worth ~1.5ms/frame here;
    // cutting a draw call is worth nothing measurable.
    const surface = canvas.closest<HTMLElement>('.av-office')
    const dragPointer = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), .08)
    const floorHit = new THREE.Vector3()
    const dragOffset = new THREE.Vector3()
    let draggingChair = false
    let dragPointerId: number | null = null
    let lookingAround = false
    let lookPointerId: number | null = null
    let lookStartX = 0
    let lookStartY = 0
    let lookStartYaw = 0
    let lookStartPitch = 0
    let lastChairHoverRaycast = -Infinity
    canvas.tabIndex = 0

    const nearestYaw = (target: number, current: number) => current + Math.atan2(Math.sin(target - current), Math.cos(target - current))

    const updateDragRay = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      dragPointer.set(
        ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
        -((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1,
      )
      raycaster.setFromCamera(dragPointer, camera)
    }
    const chairUnderPointer = (event: PointerEvent) => {
      updateDragRay(event)
      return raycaster.intersectObject(chair, true).length > 0
    }
    const onFurniturePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !chairUnderPointer(event) || !raycaster.ray.intersectPlane(floorPlane, floorHit)) return
      noteLook()
      draggingChair = true
      dragPointerId = event.pointerId
      dragOffset.set(chair.position.x - floorHit.x, 0, chair.position.z - floorHit.z)
      chair.scale.setScalar((rustic ? .82 : .72) * 1.025)
      canvas.classList.add('is-dragging-furniture')
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    }
    const onFurniturePointerMove = (event: PointerEvent) => {
      if (!draggingChair) {
        if (lookingAround || event.timeStamp - lastChairHoverRaycast < 40) return
        lastChairHoverRaycast = event.timeStamp
        canvas.style.cursor = chairUnderPointer(event) ? 'grab' : 'default'
        return
      }
      updateDragRay(event)
      if (!raycaster.ray.intersectPlane(floorPlane, floorHit)) return
      const nextX = THREE.MathUtils.clamp(floorHit.x + dragOffset.x, -3.25, 3.1)
      const nextZ = THREE.MathUtils.clamp(floorHit.z + dragOffset.z, -.05, 1.15)
      const lateral = nextX - chair.position.x
      chair.position.x = nextX
      chair.position.z = nextZ
      chair.rotation.y = THREE.MathUtils.lerp(chair.rotation.y, chairHomeRotation - lateral * .75, .18)
      canvas.style.cursor = 'grabbing'
      event.preventDefault()
      event.stopPropagation()
    }
    const finishFurnitureDrag = (event: PointerEvent) => {
      if (!draggingChair || (dragPointerId !== null && event.pointerId !== dragPointerId)) return
      draggingChair = false
      dragPointerId = null
      chair.scale.setScalar(rustic ? .82 : .72)
      canvas.classList.remove('is-dragging-furniture')
      canvas.style.cursor = 'grab'
      try {
        window.localStorage.setItem(chairStorageKey, JSON.stringify({ x: chair.position.x, z: chair.position.z, rotation: chair.rotation.y }))
      } catch {
        // The interaction still works when browser storage is unavailable.
      }
      canvas.dispatchEvent(new CustomEvent('office-furniture-moved', { bubbles: true, detail: { item: 'chair', reset: false } }))
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    }
    const resetFurniture = (event: MouseEvent) => {
      const pointerEvent = event as PointerEvent
      if (!chairUnderPointer(pointerEvent)) return
      chair.position.copy(chairHome)
      chair.rotation.y = chairHomeRotation
      try { window.localStorage.removeItem(chairStorageKey) } catch { /* no-op */ }
      canvas.dispatchEvent(new CustomEvent('office-furniture-moved', { bubbles: true, detail: { item: 'chair', reset: true } }))
      event.preventDefault()
      event.stopPropagation()
    }
    const onLookPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || draggingChair || chairUnderPointer(event)) return
      noteLook()
      lookingAround = true
      lookPointerId = event.pointerId
      lookStartX = event.clientX
      lookStartY = event.clientY
      lookStartYaw = cameraYawTarget
      lookStartPitch = cameraPitchTarget
      canvas.classList.add('is-looking-around')
      canvas.setPointerCapture(event.pointerId)
      canvas.focus({ preventScroll: true })
      event.preventDefault()
    }
    const onLookPointerMove = (event: PointerEvent) => {
      if (!lookingAround || event.pointerId !== lookPointerId) return
      const bounds = canvas.getBoundingClientRect()
      // Conventional orbit-camera interaction: dragging the scene right turns
      // the view left, while dragging it down raises the camera's look angle.
      // Hovering never reaches this branch; movement requires pointer capture.
      cameraYawTarget = lookStartYaw - (event.clientX - lookStartX) / Math.max(320, bounds.width) * Math.PI * 1.55
      cameraPitchTarget = THREE.MathUtils.clamp(
        lookStartPitch + (event.clientY - lookStartY) / Math.max(240, bounds.height) * 1.3,
        minimumCameraPitch,
        maximumCameraPitch,
      )
      event.preventDefault()
    }
    const finishLook = (event: PointerEvent) => {
      if (!lookingAround || event.pointerId !== lookPointerId) return
      lookingAround = false
      lookPointerId = null
      canvas.classList.remove('is-looking-around')
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

      // A press that never became a drag is a click, and a click picks out
      // whoever is under it.
      //
      // This rides on the orbit handler rather than adding a third pointer
      // listener, because up until the pointer moves the two gestures are
      // indistinguishable. Deciding between them on release, by how far the
      // pointer actually travelled, is what stops the small wobble in a tap
      // from being read as an attempt to turn the camera - and what stops a
      // deliberate orbit that happens to end over the client from selecting
      // them.
      //
      // The result goes out as the same `office-focus-asset` event the rest of
      // the UI already uses, so there is exactly one notion of what is
      // selected in this scene and the halo, the camera framing and the look
      // below all read it from the same place.
      const travelled = Math.hypot(event.clientX - lookStartX, event.clientY - lookStartY)
      if (travelled > 6 || draggingChair || !activeClientActor) return
      const bounds = canvas.getBoundingClientRect()
      dragPointer.set(
        (event.clientX - bounds.left) / bounds.width * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      )
      raycaster.setFromCamera(dragPointer, camera)
      const hitClient = raycaster.intersectObject(activeClientActor.rig.root, true).length > 0
      surface?.dispatchEvent(new CustomEvent('office-focus-asset', {
        // A key nothing is registered under is how this scene already says
        // "nothing is selected": the lookup misses and the focus clears.
        detail: { key: hitClient ? clientFocusKey : 'office-none' },
      }))
    }
    const onLookKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') cameraYawTarget -= Math.PI / 4
      else if (event.key === 'ArrowRight') cameraYawTarget += Math.PI / 4
      else if (event.key === 'ArrowUp') cameraPitchTarget = THREE.MathUtils.clamp(cameraPitchTarget + .1, minimumCameraPitch, maximumCameraPitch)
      else if (event.key === 'ArrowDown') cameraPitchTarget = THREE.MathUtils.clamp(cameraPitchTarget - .1, minimumCameraPitch, maximumCameraPitch)
      else if (event.key === 'Home' || event.key === '0') { cameraYawTarget = homeYaw; cameraPitchTarget = homePitch }
      else return
      noteLook()
      event.preventDefault()
    }
    const onFocusAsset = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key
      if (!key) return
      const target = focusTargets.get(key)
      focusHalos.forEach((halo) => { halo.visible = false })
      if (!target) {
        focusedTarget = null
        focusedUntil = 0
        focusLight.intensity = 0
        return
      }
      focusedTarget = target
      // Selecting a person is not the same act as pinging a piece of
      // furniture. A prop's halo is a "here it is" that has done its job in a
      // few seconds; the client turns to face you and should still be doing so
      // long enough for that to read as attention rather than a twitch.
      focusedUntil = performance.now() + (key === clientFocusKey ? 20_000 : 4_800)
      target.halo.visible = true
      scene.updateMatrixWorld(true)
      target.object.getWorldPosition(focusedWorldPosition)
      const dx = focusedWorldPosition.x - cameraPivot.x
      const dy = focusedWorldPosition.y - cameraPivot.y
      const dz = focusedWorldPosition.z - cameraPivot.z
      cameraYawTarget = nearestYaw(Math.atan2(dx, -dz), cameraYawTarget)
      cameraPitchTarget = THREE.MathUtils.clamp(Math.atan2(dy, Math.max(.01, Math.hypot(dx, dz))), minimumCameraPitch + .08, maximumCameraPitch - .08)
    }
    const onCameraRotate = (event: Event) => {
      const detail = (event as CustomEvent<{ delta?: number; reset?: boolean }>).detail
      if (detail?.reset) {
        cameraYawTarget = homeYaw
        cameraPitchTarget = homePitch
      } else cameraYawTarget += detail?.delta ?? 0
    }
    surface?.addEventListener('office-focus-asset', onFocusAsset)
    surface?.addEventListener('office-camera-rotate', onCameraRotate)
    canvas.addEventListener('pointerdown', onFurniturePointerDown)
    canvas.addEventListener('pointerdown', onLookPointerDown)
    canvas.addEventListener('pointermove', onFurniturePointerMove)
    canvas.addEventListener('pointermove', onLookPointerMove)
    canvas.addEventListener('pointerup', finishFurnitureDrag)
    canvas.addEventListener('pointerup', finishLook)
    canvas.addEventListener('pointercancel', finishFurnitureDrag)
    canvas.addEventListener('pointercancel', finishLook)
    canvas.addEventListener('keydown', onLookKeyDown)
    canvas.addEventListener('dblclick', resetFurniture)
    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.round(bounds.width))
      const height = Math.max(1, Math.round(bounds.height))
      renderer.setSize(width, height, false)
      stylePass.setSize(width, height)
      camera.aspect = width / height
      // Preserve a useful amount of the room on portrait phones. A fixed
      // desktop FOV turns a tall canvas into an extreme crop even though the
      // WebGL surface itself fills the screen.
      camera.fov = Math.min(82, baseCameraFov + Math.max(0, .9 - camera.aspect) * 52)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    // The navigable floor is gone, and so is everything that used it.
    //
    // This scene used to derive a walkable surface from its own geometry every
    // time it was built: a bounding-box scan of every mesh in the shin-to-chest
    // slab, a clearance grid over the result, a connectivity probe to find a
    // radius at which the room was actually traversable, a set of errand
    // anchors snapped onto reachable floor with a reservation table over them,
    // and a per-body steering agent on top. It was careful work and it is all
    // deleted, because the office is now composed as a set of seated tableaux
    // and there is nobody left to walk on it.
    //
    // Worth being plain about what this did and did not buy. It is not a
    // performance win: measured before the change, path planning and steering
    // together came to about 0.04 ms of a 14 ms CPU frame, which is 0.3% and
    // below the run-to-run noise on this machine. The reasons are the ones the
    // change was asked for - a room of people who stay at their desks composes
    // deliberately, where a room of people wandering through it composed
    // itself differently every second and never quite well - plus the several
    // hundred lines of state machine, stall recovery and anchor arbitration
    // that no longer have to be correct.
    root.updateWorldMatrix(true, true)
    phase('lights')
    cat.position.copy(catActor.waypoints[0])

    // Stable list for the LOD pass, so the render loop does not allocate one
    // per frame just to rank the same actors.
    const staffHumanoids = staffRigs.map((entry) => entry.humanoid)

    // DEV-only measurement probe. Reports live world-space joint positions and
    // local joint quaternions for the client and each staff actor, plus the
    // measured chair-seat height, so seating and motion claims can be checked
    // against numbers rather than eyeballed. Compiled out of production.
    if (import.meta.env.DEV) {
      const wp = (bone: THREE.Object3D) => {
        const v = new THREE.Vector3()
        bone.getWorldPosition(v)
        return [Number(v.x.toFixed(4)), Number(v.y.toFixed(4)), Number(v.z.toFixed(4))]
      }
      const q = (bone: THREE.Object3D) => [
        Number(bone.quaternion.x.toFixed(4)), Number(bone.quaternion.y.toFixed(4)),
        Number(bone.quaternion.z.toFixed(4)), Number(bone.quaternion.w.toFixed(4)),
      ]
      const readActor = (humanoid: HumanoidActor) => {
        const b = humanoid.skeleton.bones
        return {
          state: humanoid.state,
          hips: wp(b.hips), head: wp(b.head),
          lFoot: wp(b.leftFoot), rFoot: wp(b.rightFoot),
          lKnee: wp(b.leftKnee), rKnee: wp(b.rightKnee),
          q: { head: q(b.head), chest: q(b.chest), spine: q(b.spine), lSh: q(b.leftShoulder), rSh: q(b.rightShoulder), hips: q(b.hips) },
          legq: { lHip: q(b.leftHip), rHip: q(b.rightHip), lKnee: q(b.leftKnee), rKnee: q(b.rightKnee), lFoot: q(b.leftFoot), rFoot: q(b.rightFoot) },
          lod: humanoid.lod,
        }
      }
      ;(window as unknown as { __officePose?: () => unknown }).__officePose = () => ({
        tier: level,
        rustic,
        rootY: root.position.y,
        seatTopY: Number((root.position.y + (rustic ? .55 : .57)).toFixed(4)),
        client: activeClientActor ? readActor(activeClientActor.humanoid) : null,
        staff: staffRigs.map((entry, index) => ({
          key: activeStaff[index]?.key ?? '?',
          station: entry.station,
          x: Number(entry.actor.position.x.toFixed(3)),
          z: Number(entry.actor.position.z.toFixed(3)),
          ...readActor(entry.humanoid),
        })),
      })
      // Physical-plausibility probe. Exposes the scene handles a headless
      // harness needs to render plan views and to test bodies against the same
      // obstacle field the navigator uses, so "walks through furniture" is a
      // measurement rather than an impression.
      ;(window as unknown as { __officeDebug?: unknown }).__officeDebug = {
        THREE,
        scene,
        camera,
        renderer,
        root,
        roomHalf,
        // Lowest point of each character's actual geometry against the floor
        // plane. A planted foot should read ~0; anything else is a body
        // hovering above the boards or sunk into them.
        groundGap: () => {
          const box = new THREE.Box3()
          const measure = (object: THREE.Object3D) => {
            box.makeEmpty()
            object.updateWorldMatrix(true, true)
            object.traverse((node) => {
              if (node instanceof THREE.Mesh && node.userData.navIgnore !== true && node.visible) {
                box.expandByObject(node)
              }
            })
            return Number((box.min.y - root.position.y).toFixed(4))
          }
          return {
            floorY: root.position.y,
            staff: staffRigs.map((entry, index) => ({
              key: activeStaff[index]?.key ?? '?',
              station: entry.station,
              state: entry.humanoid.state,
              lod: entry.humanoid.lod,
              soleGap: measure(entry.rig.root),
              lFootGap: measure(entry.rig.leftFoot),
              rFootGap: measure(entry.rig.rightFoot),
              props: entry.humanoid.skeleton.proportions,
              scale: entry.rig.root.getWorldScale(new THREE.Vector3()).x,
              hipsY: entry.rig.hips.position.y,
            })),
            client: activeClientActor ? measure(activeClientActor.rig.root) : null,
            cat: measure(cat),
          }
        },
        // Live scene-graph handles, so a harness can isolate one character and
        // render it from an arbitrary angle. Diagnosing a posture from the
        // in-game camera alone is guesswork: the room is deliberately dim and
        // half the cast is behind furniture.
        staffDirector,
        catDebug: () => ({
          waypoints: catActor.waypoints.map((point) => ({ x: Number(point.x.toFixed(2)), z: Number(point.z.toFixed(2)) })),
          index: catActor.waypointIndex,
          previous: catActor.previousWaypointIndex,
          pause: Number(catActor.pauseRemaining.toFixed(2)),
          resting: true,
        }),
        objects: () => ({
          staff: staffRigs.map((entry, index) => ({
            key: activeStaff[index]?.key ?? '?',
            station: entry.station,
            group: entry.actor,
            rig: entry.rig,
            humanoid: entry.humanoid,
          })),
          client: activeClientActor ?? null,
          cat,
        }),
        /** The focus key a harness must send to select the client, or '' if
         *  there is no consultation in progress. */
        clientKey: () => clientFocusKey,
        // Where every body in the room is. This used to carry the crowd
        // state as well - pass radius, errand phase, measured speed, anchor
        // held, seconds stalled - all of which described a simulation that no
        // longer runs. What a harness can still usefully ask is where things
        // are and what they are doing, so that is what is left.
        bodies: () => [
          ...staffRigs.map((entry, index) => ({
            kind: 'staff' as const,
            key: activeStaff[index]?.key ?? '?',
            station: entry.station,
            x: entry.actor.position.x,
            z: entry.actor.position.z,
            task: entry.task,
            state: entry.humanoid.state,
          })),
          { kind: 'cat' as const, key: 'cat', station: 'cat', x: cat.position.x, z: cat.position.z, task: 'rest', state: 'rest' },
        ],
      }
    }

    // DEV-only camera control.
    //
    // Posture has been reported three times and fixed from one camera angle
    // each time. Judging a body from the in-game view alone is guesswork: the
    // room is dim, the cast is half behind furniture, and a splayed arm reads
    // as fine from directly in front. This lets a harness put the camera
    // exactly where it needs it - side-on, from above, close on one chair -
    // and hold it there, with the ambient drift suppressed so two renders of
    // the same pose are actually the same render. Compiled out of production.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __officeCamera?: unknown }).__officeCamera = {
        set: (options: { yaw?: number; pitch?: number; pivot?: [number, number, number]; radius?: number }) => {
          if (options.yaw !== undefined) { cameraYaw = options.yaw; cameraYawTarget = options.yaw }
          if (options.pitch !== undefined) { cameraPitch = options.pitch; cameraPitchTarget = options.pitch }
          if (options.pivot) cameraPivot.set(...options.pivot)
          if (options.radius !== undefined) cameraOrbit = options.radius
          // Park the drift: it eases in after three idle seconds and would
          // otherwise move the shot between the call and the screenshot.
          officeAmbient = 0
          lastLookAt = performance.now()
          positionCamera()
        },
        // Frame one body from a given compass bearing, which is what checking
        // a posture from several angles actually needs.
        frameBody: (x: number, y: number, z: number, bearing: number, distance = 2.2, pitch = -.12) => {
          cameraPivot.set(x, y, z)
          cameraOrbit = distance
          cameraYaw = bearing
          cameraYawTarget = bearing
          cameraPitch = pitch
          cameraPitchTarget = pitch
          officeAmbient = 0
          lastLookAt = performance.now()
          positionCamera()
        },
        home: () => {
          cameraPivot.copy(cameraPivotHome)
          cameraOrbit = cameraOrbitHome
          cameraYaw = homeYaw; cameraYawTarget = homeYaw
          cameraPitch = homePitch; cameraPitchTarget = homePitch
          positionCamera()
        },
      }
    }

    // DEV-only frame profiler.
    //
    // The navigation buckets that used to be here did their job: they are the
    // reason it is known, rather than assumed, that path planning and steering
    // together cost about 0.04 ms of a 14 ms frame, and therefore that retiring
    // the walking was never going to be a speed-up. With that machinery gone
    // there is nothing left for them to time, so what remains separates the
    // skeletal animation from the draw itself.
    //
    // `performance.now()` is clamped to 100 microseconds in a page that is not
    // cross-origin isolated, which is coarse against a sub-millisecond section,
    // so the harness accumulates over several hundred frames and reads the
    // mean, where the quantisation averages out. Compiled out of production.
    type FrameBucket = 'humanoid' | 'render'
    const frameProfile = { humanoid: 0, render: 0, total: 0, frames: 0 }
    let profiling = false
    const timed = import.meta.env.DEV
      ? <T,>(bucket: FrameBucket, run: () => T): T => {
        if (!profiling) return run()
        const started = performance.now()
        const value = run()
        frameProfile[bucket] += performance.now() - started
        return value
      }
      : <T,>(_bucket: FrameBucket, run: () => T): T => run()
    if (import.meta.env.DEV) {
      ;(window as unknown as { __officeFrameProfile?: unknown }).__officeFrameProfile = {
        start: () => {
          profiling = true
          frameProfile.humanoid = 0; frameProfile.render = 0
          frameProfile.total = 0; frameProfile.frames = 0
        },
        stop: () => { profiling = false; return { ...frameProfile } },
      }
    }

    const startedAt = performance.now()
    let frame = 0
    let disposed = false
    let surfaceVisible = true
    let previousFrame = startedAt
    let elapsed = 0
    let lastAnchorDispatch = -Infinity

    const anchorWorld = new THREE.Vector3()
    const anchorView = new THREE.Vector3()
    const anchorProjected = new THREE.Vector3()
    const anchorPosition = (object: THREE.Object3D, minimum = 5, maximum = 95) => {
      object.getWorldPosition(anchorWorld)
      anchorView.copy(anchorWorld).applyMatrix4(camera.matrixWorldInverse)
      const projected = anchorProjected.copy(anchorWorld).project(camera)
      const visible = anchorView.z < -.2 && Math.abs(projected.x) < 1.06 && Math.abs(projected.y) < 1.08
      return {
        x: THREE.MathUtils.clamp((projected.x * .5 + .5) * 100, minimum, maximum),
        y: THREE.MathUtils.clamp((-projected.y * .5 + .5) * 100, minimum, maximum),
        visible,
      }
    }

    const focusedWorldPosition = new THREE.Vector3()
    const catCameraDirection = new THREE.Vector3()
    const catMoveDirection = new THREE.Vector3()

    const draw = (now = performance.now()) => {
      frame = 0
      if (disposed || !surfaceVisible || document.hidden) return
      const delta = Math.min(.05, Math.max(0, (now - previousFrame) / 1000))
      previousFrame = now
      elapsed += delta
      if (focusedTarget && now >= focusedUntil) {
        focusedTarget.halo.visible = false
        focusedTarget = null
        focusLight.intensity = 0
      }
      if (focusedTarget) {
        focusedTarget.object.getWorldPosition(focusedWorldPosition)
        focusedTarget.halo.visible = true
        focusedTarget.halo.scale.setScalar(1 + Math.sin(elapsed * 4.2) * .075)
        focusedTarget.halo.rotation.z += delta * .21
        focusLight.position.copy(focusedWorldPosition)
        focusLight.position.y += .55
        focusLight.intensity = 1.15 + Math.sin(elapsed * 4.2) * .18
      }
      const yawDelta = Math.atan2(Math.sin(cameraYawTarget - cameraYaw), Math.cos(cameraYawTarget - cameraYaw))
      const cameraFollow = reduced ? 1 : 1 - Math.exp(-8.35 * delta)
      cameraYaw += yawDelta * cameraFollow
      cameraPitch += (cameraPitchTarget - cameraPitch) * cameraFollow

      // The same never-still drift the map got, and for the same reason: a
      // fixed camera on a lit room reads as a photograph of an office rather
      // than a place someone is standing in. Much smaller here than outdoors,
      // because the walls are close and the parallax against them is strong -
      // a sway that is barely perceptible on a district would swing the whole
      // room. Suppressed entirely under reduced-motion.
      const officeIdle = (performance.now() - lastLookAt) / 1000
      officeAmbient = THREE.MathUtils.clamp(
        officeAmbient + delta * (!reduced && officeIdle > 3 ? .45 : -2.2),
        0,
        1,
      )
      ambientYawOffset = Math.sin(elapsed * .074) * .034 * officeAmbient
      ambientPitchOffset = Math.sin(elapsed * .053 + .8) * .014 * officeAmbient
      positionCamera()

      if (activeClientActor) {
        const { rig, humanoid, phase, folder, mug } = activeClientActor
        // Selected clients look at you; everyone else gets on with their day.
        //
        // The target is the camera itself rather than a fixed point in the
        // room, so the client keeps facing the player as the view is orbited
        // instead of staring at wherever the camera happened to be at the
        // moment of the click. `setLookTarget(null)` releases rather than
        // cancels: the layer eases out over about a third of a second and the
        // seated idle underneath was never interrupted, so what a viewer sees
        // is somebody's attention wandering back to their own business.
        humanoid.setLookTarget(
          focusedTarget?.object === rig.root ? camera.getWorldPosition(clientLookTarget) : null,
        )
        humanoid.update(delta)

        // The props keep their own clock.
        //
        // The actor has no idea these exist - a clip animates joints, and a
        // folder resting on a lap is neither a joint nor parented to one - so
        // rather than trying to synchronise the two, the portfolio just drifts
        // on a slow period of its own that shares no factor with any clip's.
        // Nothing about it needs to line up with a specific beat, and the two
        // rhythms reading as independent is closer to true than a folder that
        // twitches every time its owner breathes.
        folder.position.set(0, .87, .29)
        folder.rotation.x = -.14
        folder.rotation.y = 0
        folder.rotation.z = easeTo(folder.rotation.z, reduced ? 0 : Math.sin((elapsed + phase) * .37) * .008, 9, delta, reduced)
        mug.position.set(.9, .82, -.12)
        mug.rotation.set(0, 0, 0)

        const blink = reduced || Math.sin(elapsed * .61 + phase * 1.9) <= .996 ? 1 : .14
        rig.eyes.forEach((eye) => { eye.scale.y = blink })
      }

      const cameraMoving = Math.abs(yawDelta) > .0005 || Math.abs(cameraPitchTarget - cameraPitch) > .0005
      const detailsVisible = surface?.classList.contains('show-office-details') ?? false
      if ((lastAnchorDispatch === -Infinity || cameraMoving || detailsVisible) && now - lastAnchorDispatch > 80) {
        lastAnchorDispatch = now
        canvas.dispatchEvent(new CustomEvent('office-anchor-update', {
          bubbles: true,
          detail: {
            lamp: anchorPosition(lampAnchor, 6, 94),
            window: anchorPosition(windowAnchor, 6, 94),
            coffee: anchorPosition(coffeeAnchor, 12, 88),
            cat: anchorPosition(cat, 12, 88),
            chair: anchorPosition(chairAnchor, 10, 90),
            case: anchorPosition(caseAnchor, 8, 92),
            firm: anchorPosition(firmAnchor, 8, 92),
            empire: anchorPosition(empireAnchor, 8, 92),
            story: anchorPosition(storyAnchor, 8, 92),
          },
        }))
      }

      const office = surface
      const storm = office?.classList.contains('room-storm') ?? false
      const focus = office?.classList.contains('room-focus') ?? false
      const cozy = office?.classList.contains('is-cozy') ?? false
      const awake = office?.classList.contains('cat-awake') ?? false
      deskLight.intensity = THREE.MathUtils.damp(deskLight.intensity, focus ? (rustic ? 3.15 : 3.7) : (rustic ? 1.72 : 2.05), 5, delta)
      windowLight.intensity = THREE.MathUtils.damp(windowLight.intensity, storm ? (rustic ? 1.8 : 2.7) : (rustic ? .82 : 1.42), 3.7, delta)
      ;(screen as THREE.MeshStandardMaterial).emissiveIntensity = .52 + Math.sin(elapsed * 1.1) * .07
      if (lanternFlame) {
        lanternFlame.scale.y = .84 + Math.sin(elapsed * 8.2) * .11 + Math.sin(elapsed * 13.7) * .05
        lanternFlame.rotation.z = Math.sin(elapsed * 6.4) * .045
      }
      if (hearthEmber && hearthLight) {
        const emberPulse = .88 + Math.sin(elapsed * 3.7) * .08 + Math.sin(elapsed * 8.9) * .035
        ;(hearthEmber.material as THREE.MeshStandardMaterial).emissiveIntensity = .58 * emberPulse
        hearthLight.intensity = .48 * emberPulse
      }
      minuteHand.rotation.z = -elapsed * .11
      // The cat has stopped patrolling along with everyone else.
      //
      // Once the staff sat down it was the last consumer of the navigation
      // field, and keeping an obstacle scan, a clearance grid and a path
      // planner alive in this scene for one animal is exactly the machinery
      // left to rot that retiring the walking was meant to avoid. It now
      // sleeps at the first waypoint of what used to be its circuit - an
      // authored spot, picked by the same art that picked the route - and
      // keeps every part of its performance that was never about going
      // anywhere: the breathing, the tail, the blink, and the glance toward
      // whoever happens to be looking at it.
      const catDelta = delta
      catActor.lastElapsed = elapsed
      const catWalking = false
      // `catWalking` flips the instant the cat reaches or leaves a waypoint.
      // Gating every leg/body pose directly on that boolean (as this used to)
      // meant the whole gait popped into its idle formula on that single
      // frame. `walkBlend` eases toward the boolean instead, so the gait's
      // amplitude fades in/out over a few frames - the same fix already
      // applied to the human rigs' walk/idle/work blends above.
      const catBlendFactor = reduced ? 1 : 1 - Math.exp(-8 * catDelta)
      catActor.walkBlend += ((catWalking ? 1 : 0) - catActor.walkBlend) * catBlendFactor
      const catGait = catActor.walkBlend
      const catCycle = elapsed * (awake ? 9.4 : 7.6)
      const catStride = Math.sin(catCycle)
      const gaitPhases = [0, Math.PI, Math.PI * 1.5, Math.PI * .5]
      catActor.legs.forEach((leg, index) => {
        const footCycle = Math.sin(catCycle + gaitPhases[index]) * catGait
        const lift = Math.max(0, Math.sin(catCycle + gaitPhases[index] + Math.PI * .5)) * catGait
        leg.rotation.x = footCycle * .31
        leg.rotation.z = Math.sin(catCycle * .5 + index) * .012 * catGait
        leg.position.y = .36 + lift * .038
      })
      catActor.body.position.y = .5 + THREE.MathUtils.lerp(Math.sin(elapsed * .9) * .006, Math.abs(catStride) * .018, catGait)
      catActor.body.rotation.x = Math.sin(catCycle * .5) * .012 * catGait
      catActor.body.rotation.z = -catStride * .014 * catGait
      catActor.head.position.y = .83 + THREE.MathUtils.lerp(Math.sin(elapsed * .9) * .004, Math.abs(catStride) * .014, catGait)
      catCameraDirection.copy(camera.position).sub(catActor.root.position)
      const cameraYawFromCat = Math.atan2(catCameraDirection.x, catCameraDirection.z)
      const localCameraYaw = Math.atan2(
        Math.sin(cameraYawFromCat - catActor.root.rotation.y),
        Math.cos(cameraYawFromCat - catActor.root.rotation.y),
      )
      // During pauses the cat notices the room—and occasionally the viewer.
      // The clamp keeps the glance anatomical rather than spinning its head.
      const idleLookYaw = THREE.MathUtils.clamp(localCameraYaw, -.58, .58)
      const targetHeadYaw = catWalking
        ? -catStride * .025
        : idleLookYaw * .72 + Math.sin(elapsed * (awake ? 1.7 : .42)) * (awake ? .13 : .065)
      catActor.head.rotation.y = THREE.MathUtils.damp(catActor.head.rotation.y, targetHeadYaw, catWalking ? 8 : 3.8, Math.max(catDelta, 1 / 120))
      catActor.head.rotation.x = THREE.MathUtils.lerp(Math.sin(elapsed * .37) * .018, -.025, catGait)
      const blinkCycle = (elapsed + (catActor.randomState % 29) * .13) % 6.4
      const catBlink = blinkCycle < .17 ? Math.max(.12, Math.abs(Math.cos(blinkCycle / .17 * Math.PI))) : 1
      catActor.eyes.forEach(({ white, pupil }) => {
        white.scale.y = 1.05 * catBlink
        pupil.scale.y = 1.12 * catBlink
      })
      catActor.tail.rotation.y = Math.sin(elapsed * (awake ? 4.4 : 1.25)) * (awake ? .34 : .16)
      catActor.tail.rotation.z = .08 + Math.sin(elapsed * .72) * .055
      books.forEach((book, index) => { if (index % 11 === 0) book.rotation.z = Math.sin(elapsed * .16 + index) * .012 })
      exteriorMovers.forEach((object, index) => {
        if (look.exterior === 'forest') object.rotation.z = (object.userData.restRotation ?? 0) + Math.sin(elapsed * .42 + index * .71) * .015
        else if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) object.material.emissiveIntensity = .13 + Math.sin(elapsed * .55 + index) * .045 + level * .008
      })
      if (!reduced) {
        timed('humanoid', () => staffDirector.update(delta))
        // Cap the number of characters paying full price per frame. Actors
        // beyond the budget, and anything far from the camera, drop to a
        // reduced update rate and skip the foot solver.
        timed('humanoid', () => assignHumanoidLod(staffHumanoids, camera, { fullBudget: 4, mediumBudget: 8 }))
      }
      staffRigs.forEach((entry) => {
        const { rig, humanoid, phase } = entry
        // A seated actor is placed once, at build time, and never moves again.
        // Its position and facing are properties of its bay, not of this
        // frame, so all that happens here is the clip and the blink.
        //
        // What used to be here: an errand state machine with six phases, a
        // path query and a steering pass per body, reciprocal separation,
        // yielding, stall detection and re-planning, an anchor reservation
        // table, and the measured-speed, heading-delta, lean and banking terms
        // that only meant anything to a body in motion. All of it went with
        // the walking, and none of it is switched off - it is gone.
        timed('humanoid', () => humanoid.update(delta))
        // Blinking stays here: it is not a joint, so the skeleton has no
        // opinion about it.
        const blink = reduced || Math.sin(elapsed * .58 + phase * 2.1) <= .996 ? 1 : .14
        rig.eyes.forEach((eye) => { eye.scale.y = blink })
      })
      dust.rotation.y = elapsed * .009

      const rainAttribute = rainGeometry.getAttribute('position') as THREE.BufferAttribute
      const rainArray = rainAttribute.array as Float32Array
      const rainSpeed = storm ? .038 : .018
      for (let index = 0; index < rainCount; index += 1) {
        const base = index * 6
        rainArray[base + 1] -= rainSpeed * delta * 60
        rainArray[base + 4] -= rainSpeed * delta * 60
        if (rainArray[base + 4] < -windowHeight / 2 - .1) {
          rainArray[base + 1] = windowHeight / 2 + .08
          rainArray[base + 4] = windowHeight / 2 - (rustic ? .07 : .12)
        }
      }
      rainAttribute.needsUpdate = true

      const steamAttribute = steamGeometry.getAttribute('position') as THREE.BufferAttribute
      const steamArray = steamAttribute.array as Float32Array
      for (let index = 0; index < 24; index += 1) {
        steamArray[index * 3 + 1] += (cozy ? .006 : .002) * delta * 60
        steamArray[index * 3] += Math.sin(elapsed + index) * .00035 * delta * 60
        if (steamArray[index * 3 + 1] > 2.52) steamArray[index * 3 + 1] = 1.82
      }
      steamAttribute.needsUpdate = true
      ;(steam.material as THREE.PointsMaterial).opacity = cozy ? .52 : .22

      timed('render', () => stylePass.render(scene, camera))
      if (profiling) {
        frameProfile.total += performance.now() - now
        frameProfile.frames += 1
      }
      if (!canvas.classList.contains('is-ready')) {
        phase('first-render')
        if (import.meta.env.DEV) {
          ;(window as unknown as { __officeBuildPhases?: unknown }).__officeBuildPhases = phases
        }
        canvas.classList.add('is-ready')
        // The room is on screen; the rest of the animation library can be baked
        // now, in idle slices, instead of in front of this frame.
        warmHumanoidClips()
      }
      if (!reduced && !disposed && surfaceVisible && !document.hidden) frame = window.requestAnimationFrame(draw)
    }
    draw()
    const surfaceObserver = new IntersectionObserver(([entry]) => {
      surfaceVisible = Boolean(entry?.isIntersecting)
      if (!surfaceVisible && frame) {
        window.cancelAnimationFrame(frame)
        frame = 0
      } else if (surfaceVisible && !document.hidden && !reduced && !frame) {
        previousFrame = performance.now()
        frame = window.requestAnimationFrame(draw)
      }
    }, { rootMargin: '80px' })
    surfaceObserver.observe(canvas)
    const onVisibilityChange = () => {
      if (document.hidden && frame) {
        window.cancelAnimationFrame(frame)
        frame = 0
      } else if (!document.hidden && surfaceVisible && !reduced && !frame) {
        previousFrame = performance.now()
        frame = window.requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      disposed = true
      // Mixers hold a cache keyed on the root object, so an actor that is not
      // uncached keeps its clips and bindings alive after the scene is gone.
      staffHumanoids.forEach((humanoid) => humanoid.dispose())
      activeClientActor?.humanoid.dispose()
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      surfaceObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      surface?.removeEventListener('office-focus-asset', onFocusAsset)
      surface?.removeEventListener('office-camera-rotate', onCameraRotate)
      canvas.removeEventListener('pointerdown', onFurniturePointerDown)
      canvas.removeEventListener('pointerdown', onLookPointerDown)
      canvas.removeEventListener('pointermove', onFurniturePointerMove)
      canvas.removeEventListener('pointermove', onLookPointerMove)
      canvas.removeEventListener('pointerup', finishFurnitureDrag)
      canvas.removeEventListener('pointerup', finishLook)
      canvas.removeEventListener('pointercancel', finishFurnitureDrag)
      canvas.removeEventListener('pointercancel', finishLook)
      canvas.removeEventListener('keydown', onLookKeyDown)
      canvas.removeEventListener('dblclick', resetFurniture)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
          if (!object.geometry.userData.characterShared) object.geometry.dispose()
          const material = object.material
          if (Array.isArray(material)) material.forEach((item) => { if (!item.userData.characterShared) item.dispose() })
          else if (!material.userData.characterShared) material.dispose()
        }
      })
      floorMap.dispose(); wallMap?.dispose(); screenMap.dispose(); stylePass.dispose(); renderer.dispose()
    }
  // assetSignature intentionally captures the visual inputs. Depending on the
  // array identity caused the scene to be recreated whenever React produced an
  // equivalent assets array (especially in previews).
  }, [activeCaseSignature, assetSignature, layoutKey, tier])

  return <canvas className="office-three-canvas" ref={canvasRef} aria-label={`Interactive three-dimensional ${environmentName} law office${activeCase ? ` with ${activeCase.clientName} waiting` : ''}`} role="img" />
}
