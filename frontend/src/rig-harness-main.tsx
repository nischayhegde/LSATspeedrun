import * as THREE from 'three'

import { buildStylizedCounsel, type StylizedCounselRig } from './art/stylized-counsel'
import {
  HumanoidActor,
  HumanoidBehaviorDirector,
  assignHumanoidLod,
  type BehaviorRole,
  type HumanoidGesture,
  type HumanoidState,
} from './art/rig'

/**
 * Isolated proving ground for the humanoid skeletal animation system.
 *
 * Two things need to be demonstrable here before any of this touches a real
 * scene. First, that the motion is genuinely fluid - which is why the floor is
 * a hard-edged checkerboard, since foot sliding is invisible over a blank
 * plane and unmissable over a grid. Second, that it is affordable - hence the
 * live frame-time and draw-call readout and the ability to scale the crowd up
 * on demand.
 *
 * The legacy driver is reproduced alongside it, deliberately: it is the same
 * approach the app uses today (a sine-driven stride running at a fixed
 * frequency with no relationship to how fast the body is actually travelling),
 * so switching between the two over the same floor makes the difference
 * self-evident rather than a matter of opinion.
 */

type Driver = 'skeletal' | 'legacy'

type HarnessActor = {
  rig: StylizedCounselRig
  actor: HumanoidActor
  group: THREE.Group
  role: BehaviorRole
  seed: number
  /** Legacy-driver phase offset, mirroring how the old code staggered rigs. */
  phase: number
}

const STATES: HumanoidState[] = [
  'idle', 'idleWeightShift', 'idleRelaxed', 'walk', 'swim', 'confer',
  'reviewDocument', 'presentBoard', 'seatedIdle', 'seatedType',
]
const GESTURES: HumanoidGesture[] = [
  'celebrate', 'nod', 'glance', 'glanceMirrored', 'breathDeep', 'weightSettle',
  'cuffAdjust', 'postureReset', 'considerTilt', 'handFlex', 'acknowledge',
  'courtBow', 'sitDown', 'standUp', 'swimEnter', 'swimExit',
]
const ROLES: BehaviorRole[] = ['reception', 'diplomatic', 'investigation', 'deskWork', 'client']

const root = document.getElementById('root')!
root.innerHTML = `
  <div class="harness">
    <div class="harness-stage">
      <canvas id="stage"></canvas>
      <div class="harness-hud" id="hud"></div>
    </div>
    <div class="harness-panel">
      <h1>Humanoid rig harness</h1>
      <p class="harness-note">Same stylized art as the app. Only the motion source changes.</p>
      <h2>Driver</h2>
      <div class="harness-grid" id="drivers"></div>
      <h2>Looping state</h2>
      <div class="harness-grid" id="states"></div>
      <h2>One-shot gesture</h2>
      <div class="harness-grid" id="gestures"></div>
      <h2>Crowd</h2>
      <div class="harness-grid" id="counts"></div>
      <h2>Options</h2>
      <div class="harness-grid" id="options"></div>
    </div>
  </div>
`

const canvas = document.getElementById('stage') as HTMLCanvasElement
const hud = document.getElementById('hud')!

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x10151c)
scene.fog = new THREE.Fog(0x10151c, 34, 78)

const camera = new THREE.PerspectiveCamera(38, 1, .1, 200)
camera.position.set(0, 4.4, 15.5)
camera.lookAt(0, 2.7, 0)

scene.add(new THREE.HemisphereLight(0xf5ecdf, 0x1b2631, 1.3))
const key = new THREE.DirectionalLight(0xffe5ca, 2.1)
key.position.set(-6, 12, 9)
scene.add(key)
const fill = new THREE.DirectionalLight(0xa9d3df, .7)
fill.position.set(7, 6, 8)
scene.add(fill)

/**
 * A hard checkerboard rather than a soft plane. Foot sliding of even a few
 * centimetres is obvious against a fixed grid and effectively invisible
 * without one, so the floor is part of the test apparatus.
 */
function checkerTexture() {
  const size = 512
  const cells = 16
  const surface = document.createElement('canvas')
  surface.width = size
  surface.height = size
  const context = surface.getContext('2d')!
  const step = size / cells
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      context.fillStyle = (x + y) % 2 ? '#243040' : '#1a2330'
      context.fillRect(x * step, y * step, step, step)
    }
  }
  context.strokeStyle = '#31425a'
  context.lineWidth = 2
  for (let index = 0; index <= cells; index += 1) {
    context.beginPath()
    context.moveTo(index * step, 0)
    context.lineTo(index * step, size)
    context.stroke()
    context.beginPath()
    context.moveTo(0, index * step)
    context.lineTo(size, index * step)
    context.stroke()
  }
  const texture = new THREE.CanvasTexture(surface)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(6, 6)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return texture
}

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: .95 }),
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const director = new HumanoidBehaviorDirector()
const actors: HarnessActor[] = []
let driver: Driver = 'skeletal'
let forcedState: HumanoidState | null = 'idle'
let ambient = false
let reduced = false
let walkTravel = true

function spawn(count: number) {
  while (actors.length > count) {
    const entry = actors.pop()!
    director.remove(entry.actor)
    entry.actor.dispose()
    entry.group.removeFromParent()
  }
  while (actors.length < count) {
    const index = actors.length
    const seed = 1000 + index * 37
    const rig = buildStylizedCounsel(index % 2 ? 'female' : 'male', index % 12, {
      role: 'visitor',
      paletteSeed: seed,
    })
    const group = new THREE.Group()
    group.add(rig.root)
    // A loose grid so a crowd stays legible instead of overlapping.
    const column = index % 5
    const row = Math.floor(index / 5)
    group.position.set((column - 2) * 3.4, 0, -row * 4.2)
    scene.add(group)
    const actor = new HumanoidActor(rig, { seed, state: forcedState ?? 'idle', reduced })
    actors.push({ rig, actor, group, role: ROLES[index % ROLES.length], seed, phase: index * 1.7 })
    director.add(actor, ROLES[index % ROLES.length], seed)
    director.suspend(actor, !ambient)
  }
  applyState()
}

function applyState() {
  if (ambient || !forcedState) return
  for (const entry of actors) entry.actor.setState(forcedState)
}

/**
 * The approach the app uses today, reproduced for comparison.
 *
 * The tell is the relationship - or rather the absence of one - between
 * `stride` and how fast the body is actually moving: the legs swing at a fixed
 * 6.5 rad/s regardless, so the feet cannot help but skate. The perfectly
 * mirrored left/right terms and the single sine per joint are the other two
 * giveaways.
 */
function legacyPose(entry: HarnessActor, elapsed: number, locomotion: number) {
  const { rig, phase } = entry
  const stride = Math.sin(elapsed * 6.5 + phase) * locomotion
  const step = Math.abs(Math.sin(elapsed * 6.5 + phase)) * locomotion
  const breath = Math.sin(elapsed * .82 + phase)
  rig.hips.position.y = rig.base.hipsY + breath * .012 + step * .045
  rig.leftHip.rotation.x = stride * .34
  rig.rightHip.rotation.x = -stride * .34
  rig.leftKnee.rotation.x = Math.max(0, -stride) * .44
  rig.rightKnee.rotation.x = Math.max(0, stride) * .44
  rig.leftFoot.rotation.x = -Math.max(0, -stride) * .16
  rig.rightFoot.rotation.x = -Math.max(0, stride) * .16
  rig.leftShoulder.rotation.x = -stride * .24
  rig.rightShoulder.rotation.x = stride * .24
  rig.leftElbow.rotation.x = Math.max(0, stride) * .1
  rig.rightElbow.rotation.x = Math.max(0, -stride) * .1
  rig.spine.rotation.z = -stride * .018
  rig.spine.rotation.x = locomotion * .045
}

function resize() {
  const width = canvas.clientWidth || window.innerWidth - 280
  const height = canvas.clientHeight || window.innerHeight
  renderer.setSize(width, height, false)
  camera.aspect = width / Math.max(1, height)
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(canvas)
resize()

let elapsed = 0
let previous = performance.now()
let frameAccumulator = 0
let frameSamples = 0
let smoothedFrameMs = 0
let firstFrameAt = 0
const startedAt = performance.now()
/** Exposed for the Playwright capture, which steps time deterministically. */
let frameIndex = 0

function step(now: number) {
  const delta = Math.min(.05, Math.max(0, (now - previous) / 1000))
  previous = now
  if (!reduced) elapsed += delta

  const walking = !ambient && forcedState === 'walk'
  // Swimming travels for the same reason walking does: a stroke rate is only
  // judgeable against the ground it is covering.
  const swimming = !ambient && forcedState === 'swim'

  assignHumanoidLod(actors.map((entry) => entry.actor), camera, { fullBudget: 4, mediumBudget: 10 })
  if (ambient) director.update(delta)

  for (const entry of actors) {
    if ((walking || swimming) && walkTravel) {
      const speed = swimming ? entry.actor.naturalSwimSpeed : entry.actor.naturalWalkSpeed
      // Pace back and forth across the checkerboard so the feet have a fixed
      // reference to slide against.
      const span = 7
      const period = (span * 4) / Math.max(.01, speed)
      const cycle = ((elapsed + entry.phase) % period) / period
      const forward = cycle < .5
      const local = forward ? cycle * 2 : (cycle - .5) * 2
      entry.group.position.x = forward ? -span + local * span * 2 : span - local * span * 2
      entry.group.rotation.y = forward ? Math.PI / 2 : -Math.PI / 2
      if (driver === 'skeletal') entry.actor.setGroundSpeed(speed)
    } else {
      entry.group.rotation.y = 0
    }

    if (driver === 'skeletal') {
      entry.actor.update(delta)
    } else {
      legacyPose(entry, reduced ? 0 : elapsed, walking ? 1 : 0)
    }
  }

  renderer.render(scene, camera)
  if (!firstFrameAt) firstFrameAt = performance.now() - startedAt

  frameAccumulator += delta * 1000
  frameSamples += 1
  if (frameSamples >= 30) {
    smoothedFrameMs = frameAccumulator / frameSamples
    frameAccumulator = 0
    frameSamples = 0
  }
  frameIndex += 1

  const info = renderer.info.render
  hud.innerHTML = `
    <div><b>driver</b> ${driver}</div>
    <div><b>actors</b> ${actors.length}</div>
    <div><b>frame</b> ${smoothedFrameMs.toFixed(2)} ms (${smoothedFrameMs ? (1000 / smoothedFrameMs).toFixed(0) : '-'} fps)</div>
    <div><b>draw calls</b> ${info.calls}</div>
    <div><b>triangles</b> ${info.triangles.toLocaleString()}</div>
    <div><b>first frame</b> ${firstFrameAt.toFixed(0)} ms</div>
    <div><b>reduced</b> ${reduced ? 'on' : 'off'}</div>
  `
  window.requestAnimationFrame(step)
}

function button(label: string, onClick: () => void, pressed = false) {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = label
  element.dataset.action = label
  element.setAttribute('aria-pressed', String(pressed))
  element.addEventListener('click', onClick)
  return element
}

function refreshPressed() {
  document.querySelectorAll<HTMLButtonElement>('#drivers button').forEach((element) => {
    element.setAttribute('aria-pressed', String(element.textContent === driver))
  })
  document.querySelectorAll<HTMLButtonElement>('#states button').forEach((element) => {
    element.setAttribute('aria-pressed', String(!ambient && element.textContent === forcedState))
  })
  document.querySelectorAll<HTMLButtonElement>('#options button').forEach((element) => {
    if (element.textContent === 'reduced motion') element.setAttribute('aria-pressed', String(reduced))
    if (element.textContent === 'ambient behavior') element.setAttribute('aria-pressed', String(ambient))
    if (element.textContent === 'walk travels') element.setAttribute('aria-pressed', String(walkTravel))
  })
}

const driversPanel = document.getElementById('drivers')!
;(['skeletal', 'legacy'] as Driver[]).forEach((name) => {
  driversPanel.append(button(name, () => {
    driver = name
    refreshPressed()
  }, name === driver))
})

const statesPanel = document.getElementById('states')!
STATES.forEach((name) => {
  statesPanel.append(button(name, () => {
    ambient = false
    forcedState = name
    actors.forEach((entry) => director.suspend(entry.actor, true))
    applyState()
    refreshPressed()
  }, name === forcedState))
})

const gesturesPanel = document.getElementById('gestures')!
GESTURES.forEach((name) => {
  gesturesPanel.append(button(name, () => {
    actors.forEach((entry) => entry.actor.playGesture(name))
  }))
})

const countsPanel = document.getElementById('counts')!
;[1, 4, 12, 24].forEach((count) => {
  countsPanel.append(button(String(count), () => spawn(count)))
})

const optionsPanel = document.getElementById('options')!
optionsPanel.append(button('reduced motion', () => {
  reduced = !reduced
  actors.forEach((entry) => entry.actor.setReduced(reduced))
  refreshPressed()
}))
optionsPanel.append(button('ambient behavior', () => {
  ambient = !ambient
  actors.forEach((entry) => director.suspend(entry.actor, !ambient))
  refreshPressed()
}))
optionsPanel.append(button('walk travels', () => {
  walkTravel = !walkTravel
  refreshPressed()
}))

spawn(1)
refreshPressed()
window.requestAnimationFrame(step)

/**
 * Deterministic control surface for the Playwright captures. Frame sequences
 * are only meaningful if the run is reproducible, so the harness exposes the
 * same switches the panel does.
 */
declare global {
  interface Window {
    __rigHarness?: {
      setDriver: (value: Driver) => void
      setState: (value: HumanoidState) => void
      gesture: (value: HumanoidGesture) => void
      setReduced: (value: boolean) => void
      setAmbient: (value: boolean) => void
      setCount: (value: number) => void
      setWalkTravel: (value: boolean) => void
      metrics: () => { frameMs: number; calls: number; triangles: number; firstFrameMs: number; actors: number; frames: number }
      /** Records the first actor's pose every rendered frame for `ms`, so a
       *  capture can prove continuity from the live WebGL loop rather than
       *  from a headless re-simulation of it. */
      recordPose: (ms: number) => Promise<Array<{ t: number; q: number[] }>>
    }
  }
}

window.__rigHarness = {
  setDriver: (value) => { driver = value; refreshPressed() },
  setState: (value) => {
    ambient = false
    forcedState = value
    actors.forEach((entry) => director.suspend(entry.actor, true))
    applyState()
    refreshPressed()
  },
  gesture: (value) => actors.forEach((entry) => entry.actor.playGesture(value)),
  setReduced: (value) => {
    reduced = value
    actors.forEach((entry) => entry.actor.setReduced(value))
    refreshPressed()
  },
  setAmbient: (value) => {
    ambient = value
    actors.forEach((entry) => director.suspend(entry.actor, !value))
    refreshPressed()
  },
  setCount: (value) => spawn(value),
  setWalkTravel: (value) => { walkTravel = value; refreshPressed() },
  recordPose: (ms) => new Promise((resolve) => {
    const entry = actors[0]
    if (!entry) { resolve([]); return }
    const bones = [
      entry.rig.hips, entry.rig.spine, entry.rig.chest, entry.rig.head,
      entry.rig.leftShoulder, entry.rig.leftElbow, entry.rig.rightShoulder, entry.rig.rightElbow,
      entry.rig.leftHip, entry.rig.leftKnee, entry.rig.rightHip, entry.rig.rightKnee,
    ]
    const samples: Array<{ t: number; q: number[] }> = []
    const startedAtMs = performance.now()
    const tick = () => {
      const now = performance.now()
      const q: number[] = []
      for (const bone of bones) q.push(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w)
      samples.push({ t: now - startedAtMs, q })
      if (now - startedAtMs < ms) window.requestAnimationFrame(tick)
      else resolve(samples)
    }
    window.requestAnimationFrame(tick)
  }),
  metrics: () => ({
    frameMs: smoothedFrameMs,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    firstFrameMs: firstFrameAt,
    actors: actors.length,
    frames: frameIndex,
  }),
}
