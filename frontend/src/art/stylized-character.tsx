import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import type { CharacterGender } from '../types'
import { buildStylizedCounsel, type StylizedCounselRig, type StylizedCounselRole } from './stylized-counsel'

export type StylizedCharacterMode = 'hero' | 'full' | 'portrait' | 'icon' | 'scene'
export type StylizedCharacterMood = 'neutral' | 'happy' | 'unhappy' | 'thinking'
export type StylizedCharacterActivity = 'idle' | 'briefing' | 'working' | 'celebrating' | 'heel-click' | 'thumbs-up' | 'courtroom-bow' | 'professional-wave'

export type StylizedCharacterProps = {
  gender?: CharacterGender
  tier?: number
  role?: StylizedCounselRole
  mode?: StylizedCharacterMode
  mood?: StylizedCharacterMood
  activity?: StylizedCharacterActivity
  walking?: boolean
  direction?: 'left' | 'right' | 'front'
  paletteSeed?: number
  className?: string
  label?: string
  onReady?: () => void
}

type CharacterEntry = {
  host: HTMLSpanElement
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D | null
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  rig: StylizedCounselRig
  shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null
  mode: StylizedCharacterMode
  mood: StylizedCharacterMood
  activity: StylizedCharacterActivity
  role: StylizedCounselRole
  walking: boolean
  baseTurn: number
  pointer: THREE.Vector2
  pointerTarget: THREE.Vector2
  pointerActive: boolean
  elapsed: number
  gestureElapsed: number
  lastAnimated: number
  hostWidth: number
  hostHeight: number
  ready: boolean
  onFirstPaint: () => void
  outputWidth: number
  outputHeight: number
  visible: boolean
  reduced: boolean
  dirty: boolean
  quality: 'preview' | 'sharp'
  lastPainted: number
  disposed: boolean
}

/** Framing presets. `viewHeight` is the world height the camera covers, so a
 *  larger value leaves the figure smaller inside the same panel. */
const framings: Record<StylizedCharacterMode, { viewHeight: number; centerY: number }> = {
  // The counsel rig stands roughly 5.45 world units tall, so 7.4 leaves the
  // Office hero at ~74% of its window with headroom above the hair and a
  // floor gap below the shoes instead of touching every panel edge.
  hero: { viewHeight: 7.4, centerY: 3.18 },
  full: { viewHeight: 5.92, centerY: 2.8 },
  scene: { viewHeight: 5.82, centerY: 2.8 },
  portrait: { viewHeight: 1.78, centerY: 5.07 },
  icon: { viewHeight: 1.56, centerY: 5.07 },
}

/** Ambient idle amplitudes are authored for the full-body framings. The tight
 *  head crops magnify a world unit ~3x, so they take a proportionate share. */
const ambientMotion: Record<StylizedCharacterMode, number> = {
  hero: 1.18,
  full: 1,
  scene: 1,
  portrait: .3,
  icon: .26,
}

function isFullBody(mode: StylizedCharacterMode) {
  return mode === 'hero' || mode === 'full' || mode === 'scene'
}

const entries = new Set<CharacterEntry>()
let sharedRenderer: THREE.WebGLRenderer | null = null
let renderSurface: HTMLCanvasElement | null = null
let animationFrame = 0
let renderCursor = 0

function rendererForCharacters() {
  if (sharedRenderer && renderSurface) return sharedRenderer
  renderSurface = document.createElement('canvas')
  sharedRenderer = new THREE.WebGLRenderer({
    canvas: renderSurface,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })
  sharedRenderer.setPixelRatio(1)
  sharedRenderer.setClearColor(0x000000, 0)
  sharedRenderer.outputColorSpace = THREE.SRGBColorSpace
  sharedRenderer.toneMapping = THREE.ACESFilmicToneMapping
  sharedRenderer.toneMappingExposure = 1.22
  sharedRenderer.shadowMap.enabled = false
  sharedRenderer.autoClear = false
  return sharedRenderer
}

function configureCharacterRenderer(renderer: THREE.WebGLRenderer) {
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.22
  renderer.shadowMap.enabled = false
  // paintCharacter clears explicitly, so the automatic clear is redundant work.
  renderer.autoClear = false
}

function animateRig(entry: CharacterEntry, now: number) {
  const { rig, mood, role, walking, activity } = entry
  const delta = entry.lastAnimated ? Math.min(.05, Math.max(0, (now - entry.lastAnimated) / 1000)) : 1 / 60
  entry.lastAnimated = now
  if (!entry.reduced) {
    entry.elapsed += delta
    entry.gestureElapsed += delta
  }
  const time = entry.reduced ? 0 : entry.elapsed
  // Scripted gestures run on their own clock. They used to share the idle clock
  // and reset it, which snapped every ambient sine back to phase zero and made
  // the figure visibly jump the moment an activity changed.
  const entranceTime = entry.reduced ? 0 : entry.gestureElapsed
  entry.pointer.lerp(entry.pointerTarget, entry.reduced ? 1 : 1 - Math.exp(-5 * delta))
  const ambient = ambientMotion[entry.mode]
  // Skewing the breath sine by a fraction of itself gives a quicker inhale and
  // a longer settle while staying continuously differentiable, so the chest
  // never ticks between two poses.
  const breathPhase = time * 1.18
  const breath = Math.sin(breathPhase + Math.sin(breathPhase) * .26) * ambient
  const sway = Math.sin(time * .55 + .7) * ambient
  const stride = walking ? Math.sin(time * 7.0) : 0
  const step = walking ? Math.abs(Math.sin(time * 7.0)) : 0
  const happy = mood === 'happy' ? 1 : 0
  const unhappy = mood === 'unhappy' ? 1 : 0
  const thinking = mood === 'thinking' ? 1 : 0
  const weightShift = Math.sin(time * .31 + .8) * ambient
  // Torso, head and arms trail the pelvis by a beat. That overlap is what makes
  // an idle read as a breathing person rather than a single rigid hinge.
  const swayFollow = Math.sin(time * .55 + .44) * ambient
  const weightFollow = Math.sin(time * .31 + .52) * ambient
  // Two incommensurate periods keep the gaze from sweeping on an obvious loop.
  // Both start at zero so the character appears looking straight ahead.
  const gazeDrift = entry.pointerActive
    ? 0
    : (Math.sin(time * .23) * .62 + Math.sin(time * .097) * .38) * ambient
  const gesturePhase = (time + 3) % 10.5
  const cuffAdjust = !walking && activity === 'idle' && gesturePhase < 1.7
    ? Math.pow(Math.sin(gesturePhase / 1.7 * Math.PI), 2)
    : 0
  const workingGesture = !walking && activity === 'working' ? .52 + Math.sin(time * .72) * .18 : 0
  const briefingGesture = !walking && activity === 'briefing' ? .32 + Math.pow(Math.max(0, Math.sin(time * .64)), 5) * .58 : 0
  const celebration = !walking && activity === 'celebrating' ? .72 + Math.sin(time * 2.2) * .18 : 0
  const roleGesture = !walking && (role === 'guide' || role === 'visitor')
    ? Math.pow(Math.max(0, Math.sin(time * .72 - .55)), 6)
    : 0
  const welcome = role === 'guide' ? roleGesture : roleGesture * .42
  const ease = (value: number) => {
    const clamped = THREE.MathUtils.clamp(value, 0, 1)
    return clamped * clamped * (3 - 2 * clamped)
  }
  const heldGesture = (intro: number, outro: number, end: number) => ease(entranceTime / intro) * (1 - ease((entranceTime - outro) / Math.max(.01, end - outro)))
  // Professional entrance gestures remain grounded and compact. Motion comes
  // from weight transfer and connected joints rather than large isolated limb
  // rotations, so the counsel reads as a person instead of a marionette.
  const heelPose = activity === 'heel-click' ? heldGesture(.18, .66, 1.02) : 0
  const heelPhase = THREE.MathUtils.clamp((entranceTime - .12) / .72, 0, 1)
  const heelClick = activity === 'heel-click' && entranceTime < .92 ? Math.pow(Math.sin(heelPhase * Math.PI), 2) : 0
  const thumbPose = activity === 'thumbs-up' ? heldGesture(.22, .72, 1.04) : 0
  const bowBody = activity === 'courtroom-bow' ? heldGesture(.24, .60, 1.08) : 0
  // The head follows the torso by a few frames and settles first. That overlap
  // is small, but it avoids the single-hinge motion that made the old bow read
  // like a rigid toy tipping forward.
  const bowHead = activity === 'courtroom-bow'
    ? heldGesture(.18, .54, .92) * ease((entranceTime - .045) / .14)
    : 0
  const wavePose = activity === 'professional-wave' ? heldGesture(.24, .84, 1.24) : 0
  const waveFollowThrough = activity === 'professional-wave'
    ? heldGesture(.34, .78, 1.12) * ease((entranceTime - .12) / .18)
    : 0
  const waveOscillation = waveFollowThrough * Math.sin(Math.max(0, entranceTime - .30) * Math.PI * 4.1)

  // Lateral idle motion is carried by the spine and chest rather than the
  // pelvis, so the shoes stay planted while the torso genuinely shifts weight.
  rig.hips.position.y = rig.base.hipsY + step * .035 + breath * .026 - Math.abs(weightShift) * .006 + heelPose * .018 - bowBody * .012
  rig.hips.position.x = sway * .014 + weightShift * .020 * (1 - Math.min(1, Math.abs(stride))) - heelPose * .035 - wavePose * .012
  rig.hips.position.z = -bowBody * .018
  rig.hips.rotation.y = weightShift * .034
  rig.hips.rotation.z = stride * .012 + sway * .008 + weightShift * .012 - heelPose * .018
  rig.spine.rotation.x = bowBody * .145 - breath * .012
  rig.spine.rotation.y = -weightFollow * .040 + briefingGesture * .022 - wavePose * .018
  rig.spine.rotation.z = -stride * .018 + sway * .016 + weightFollow * .030 - workingGesture * .012 - wavePose * .012
  rig.chest.rotation.z = -swayFollow * .010 - weightFollow * .013
  rig.chest.scale.set(1 + breath * .016, 1 + breath * .010, 1 + breath * .018)
  rig.head.rotation.y = entry.pointer.x * .24 + gazeDrift * .34 - weightFollow * .022 - stride * .018 + thinking * .08 + wavePose * .035
  rig.head.rotation.x = entry.pointer.y * -.075 + breath * .010 + unhappy * .03 + workingGesture * .035 + bowHead * .085
  rig.head.rotation.z = sway * .020 - weightFollow * .014 - happy * .015 + unhappy * .018 + briefingGesture * .012 - thumbPose * .012 + wavePose * .016
  rig.leftShoulder.rotation.x = -stride * .30 - weightFollow * .026 + workingGesture * .16 - celebration * .10 - bowBody * .012
  rig.rightShoulder.rotation.x = stride * .30 + weightFollow * .026 - workingGesture * .20 + cuffAdjust * .26 - celebration * .10 - thumbPose * .14 - bowBody * .012 - wavePose * .10
  rig.leftShoulder.rotation.z = rig.base.leftShoulderZ - breath * .016 - happy * .045 - celebration * .34 + workingGesture * .08 + bowBody * .012
  rig.rightShoulder.rotation.z = rig.base.rightShoulderZ + breath * .016 + happy * .075 + welcome * .52 - thinking * .42 + briefingGesture * .34 + celebration * .34 + cuffAdjust * .16 + thumbPose * .16 - bowBody * .012 + wavePose * .36
  rig.leftElbow.rotation.x = swayFollow * .016 + workingGesture * .52 + celebration * .16
  rig.rightElbow.rotation.x = -swayFollow * .016 + workingGesture * .44 + briefingGesture * .16 + cuffAdjust * .62 + celebration * .16 + thumbPose * .06 + wavePose * .05
  rig.leftElbow.rotation.z = rig.base.leftElbowZ + Math.max(0, stride) * .08 - happy * .04 - workingGesture * .18 - celebration * .22
  // The wave bends toward the character's outside shoulder. The previous
  // negative rotation folded the forearm through the jacket and made the hand
  // appear inside the torso.
  rig.rightElbow.rotation.z = rig.base.rightElbowZ - Math.max(0, -stride) * .08 - welcome * .20 - thinking * .28 - briefingGesture * .18 - cuffAdjust * .46 + celebration * .22 - thumbPose * .92 + wavePose * 2.46
  rig.rightHand.rotation.x = thumbPose * -.14 - wavePose * .04
  rig.rightHand.rotation.z = -swayFollow * .045 + Math.sin(time * 4.2) * welcome * .20 + briefingGesture * Math.sin(time * 2.1) * .10 - cuffAdjust * .18 + thumbPose * .28 + wavePose * .08 + waveOscillation * .22
  rig.leftHand.rotation.z = swayFollow * .045 + workingGesture * .10 + celebration * .08 - heelPose * .08
  rig.rightThumb.rotation.z = -.75 + thumbPose * 1.35
  rig.rightThumb.position.set(.115, -.035, .012)
  rig.rightThumb.scale.set(.9, 1, .75)
  rig.leftHip.position.x = -.275
  rig.rightHip.position.x = .275
  rig.leftHip.rotation.x = stride * .46 + Math.max(0, weightShift) * .020
  rig.rightHip.rotation.x = -stride * .46 + Math.max(0, -weightShift) * .020 + heelClick * .08
  rig.leftHip.rotation.z = -.025
  rig.rightHip.rotation.z = .025 - heelPose * .035
  rig.leftKnee.rotation.x = Math.max(0, -stride) * .52 + Math.max(0, weightShift) * .024
  rig.rightKnee.rotation.x = Math.max(0, stride) * .52 + Math.max(0, -weightShift) * .024 + heelClick * .20
  rig.leftFoot.rotation.x = Math.max(0, stride) * .16
  rig.rightFoot.rotation.x = Math.max(0, -stride) * .16
  rig.leftFoot.position.x = 0
  rig.rightFoot.position.x = -heelClick * .035
  rig.leftFoot.rotation.y = 0
  rig.rightFoot.rotation.y = heelClick * .16
  rig.leftFoot.rotation.z = 0
  rig.rightFoot.rotation.z = heelClick * .055
  rig.root.rotation.y = entry.baseTurn + entry.pointer.x * .025 + sway * .014

  // A real blink shuts faster than it opens. Both halves are eased so the lids
  // accelerate out of and settle into the open pose.
  const blinkPhase = (time + 3.1) % 5.6
  const blink = blinkPhase < .085
    ? ease(blinkPhase / .085)
    : blinkPhase < .265
      ? 1 - ease((blinkPhase - .085) / .18)
      : 0
  rig.eyes.forEach((eye) => { eye.scale.y = Math.max(.08, 1 - blink * .92) })
  // Slow paired drifts keep the gaze alive without a mechanical single-sine
  // sweep, and hold the pupils inside the eye whites.
  const pupilX = entry.pointer.x * .012 + (Math.sin(time * .77) * .6 + Math.sin(time * .29) * .4) * ambient * .006
  const pupilY = entry.pointer.y * -.008 + Math.sin(time * .51) * ambient * .003
  rig.pupils.forEach((pupil) => pupil.position.set(pupilX, pupilY, Number(pupil.userData.baseZ ?? .027)))

  if (entry.shadow) {
    // The contact shadow tracks the weight shift and tightens on the inhale,
    // which sells the ground contact the static ellipse used to break.
    entry.shadow.position.x = rig.hips.position.x * .55 + weightShift * .012
    entry.shadow.scale.set(1 - breath * .012, .36 * (1 - breath * .016), 1)
    entry.shadow.material.opacity = .28 - breath * .012
  }
}

/** Reads the host box. Only ever called from the ResizeObserver and on mount:
 *  doing it inside the frame loop forced a synchronous layout every frame,
 *  which is what made the figure hitch while the office scene mutated the DOM. */
function measureHost(entry: CharacterEntry) {
  entry.hostWidth = Math.max(1, Math.round(entry.host.clientWidth))
  entry.hostHeight = Math.max(1, Math.round(entry.host.clientHeight))
}

function paintCharacter(entry: CharacterEntry, now: number) {
  const renderer = entry.renderer ?? rendererForCharacters()
  const surface = entry.renderer ? entry.canvas : renderSurface!
  const width = entry.hostWidth
  const height = entry.hostHeight
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
  const outputWidth = Math.max(1, Math.round(width * pixelRatio))
  const outputHeight = Math.max(1, Math.round(height * pixelRatio))
  if (!entry.renderer && (entry.canvas.width !== outputWidth || entry.canvas.height !== outputHeight)) {
    entry.canvas.width = outputWidth
    entry.canvas.height = outputHeight
    entry.dirty = true
  }

  const aspect = width / height
  const framing = framings[entry.mode]
  if (entry.camera.top !== framing.viewHeight / 2 || entry.camera.right !== framing.viewHeight * aspect / 2) {
    entry.camera.top = framing.viewHeight / 2
    entry.camera.bottom = -framing.viewHeight / 2
    entry.camera.left = -framing.viewHeight * aspect / 2
    entry.camera.right = framing.viewHeight * aspect / 2
    entry.camera.updateProjectionMatrix()
  }

  // Render into a target with the same aspect ratio as the visible panel.
  // The previous square 320px target gave tall characters only a ~100px-wide
  // source strip, which was then enlarged and visibly softened. A quick first
  // pass makes the character appear promptly; the next pass resolves it at the
  // panel's actual density without allocating another WebGL context.
  const sharpHeight = entry.mode === 'hero' || entry.mode === 'full'
    ? Math.min(1200, Math.max(760, outputHeight))
    : entry.mode === 'scene'
      ? Math.min(960, Math.max(640, outputHeight))
      : entry.mode === 'portrait'
        ? Math.min(480, Math.max(320, outputHeight))
        : Math.min(360, Math.max(240, outputHeight))
  const previewHeight = isFullBody(entry.mode) ? 420 : entry.mode === 'portrait' ? 220 : 180
  let renderHeight = entry.renderer ? height : entry.quality === 'preview' ? Math.min(previewHeight, sharpHeight) : sharpHeight
  let renderWidth = entry.renderer ? width : Math.max(1, Math.round(renderHeight * aspect))
  const maxWidth = isFullBody(entry.mode) ? 880 : 520
  if (renderWidth > maxWidth) {
    renderHeight = Math.max(1, Math.round(renderHeight * maxWidth / renderWidth))
    renderWidth = maxWidth
  }
  // Reassigning canvas.width reallocates the drawing buffer, so both branches
  // resize only when the target has actually changed shape.
  if (entry.renderer) {
    if (entry.outputWidth !== outputWidth || entry.outputHeight !== outputHeight) {
      entry.outputWidth = outputWidth
      entry.outputHeight = outputHeight
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      renderer.setViewport(0, 0, width, height)
    }
  } else {
    if (surface.width !== renderWidth || surface.height !== renderHeight) renderer.setSize(renderWidth, renderHeight, false)
    renderer.setViewport(0, 0, renderWidth, renderHeight)
    renderer.setScissorTest(false)
  }
  renderer.clear(true, true, true)
  animateRig(entry, now)
  renderer.render(entry.scene, entry.camera)

  if (entry.context) {
    entry.context.clearRect(0, 0, outputWidth, outputHeight)
    entry.context.imageSmoothingEnabled = true
    entry.context.imageSmoothingQuality = 'high'
    entry.context.globalCompositeOperation = 'copy'
    entry.context.drawImage(surface, 0, 0, renderWidth, renderHeight, 0, 0, outputWidth, outputHeight)
    entry.context.globalCompositeOperation = 'source-over'
  }
  if (!entry.ready) {
    entry.ready = true
    entry.onFirstPaint()
  }
  entry.lastPainted = now
  if (entry.quality === 'preview' && !entry.reduced) {
    entry.quality = 'sharp'
    entry.dirty = true
  } else {
    entry.quality = 'sharp'
    entry.dirty = false
  }
}

function runCharacterFrame(now: number) {
  animationFrame = 0
  if (!entries.size) return
  const visible = Array.from(entries).filter((entry) => {
    if (!entry.visible || entry.disposed || (entry.reduced && !entry.dirty)) return false
    if (entry.dirty) return true
    // Large hero characters follow the display refresh rate. Portraits and
    // icons remain deliberately cheaper because several may share one page.
    const interval = entry.walking || isFullBody(entry.mode) ? 0 : entry.mode === 'portrait' ? 32 : 50
    return now - entry.lastPainted >= interval
  })
  const budget = Math.min(8, visible.length)
  for (let offset = 0; offset < budget; offset += 1) {
    const entry = visible[(renderCursor + offset) % visible.length]
    paintCharacter(entry, now)
  }
  if (visible.length > budget) renderCursor = (renderCursor + budget) % visible.length
  // Nothing on screen wants a frame. Visibility, resize and prop changes all
  // re-request one, so idling here costs the page nothing.
  const live = Array.from(entries).some((entry) => entry.visible && !entry.disposed && (!entry.reduced || entry.dirty))
  if (live) animationFrame = window.requestAnimationFrame(runCharacterFrame)
}

function requestCharacterFrame() {
  if (!animationFrame) animationFrame = window.requestAnimationFrame(runCharacterFrame)
}

function createEntry(
  host: HTMLSpanElement,
  canvas: HTMLCanvasElement,
  props: Required<Pick<StylizedCharacterProps, 'gender' | 'tier' | 'role' | 'mode' | 'mood' | 'activity' | 'walking' | 'direction'>> & Pick<StylizedCharacterProps, 'paletteSeed'>,
  onFirstPaint: () => void,
): CharacterEntry | null {
  // The full Office hero owns one transparent WebGL canvas. Rendering it
  // directly removes the intermediate WebGL-to-2D copy whose backing rectangle
  // remained faintly visible against the portrait card and clipped overscan.
  // Smaller portraits/icons keep sharing a renderer to avoid proliferating
  // contexts across staff-heavy screens.
  const renderer = props.mode === 'hero' || props.mode === 'full'
    ? new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    : null
  const context = renderer ? null : canvas.getContext('2d', { alpha: true })
  if (!renderer && !context) return null
  if (renderer) configureCharacterRenderer(renderer)
  const scene = new THREE.Scene()
  const framing = framings[props.mode]
  const camera = new THREE.OrthographicCamera(-2, 2, 3.2, -3.2, .1, 40)
  camera.position.set(0, framing.centerY, 10.5)
  camera.lookAt(0, framing.centerY - .04, .12)

  const rig = buildStylizedCounsel(props.gender, props.tier, { role: props.role, paletteSeed: props.paletteSeed })
  const baseTurn = props.direction === 'left' ? -.24 : props.direction === 'right' ? .24 : -.075
  rig.root.rotation.y = baseTurn
  scene.add(rig.root)

  let shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null
  if (isFullBody(props.mode)) {
    shadow = new THREE.Mesh(
      new THREE.CircleGeometry(.68, 28),
      new THREE.MeshBasicMaterial({ color: 0x101820, transparent: true, opacity: .28, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.scale.y = .36
    shadow.position.set(0, .03, .08)
    scene.add(shadow)
  }

  scene.add(new THREE.HemisphereLight(0xf5ecdf, 0x1b2631, 1.42))
  const key = new THREE.DirectionalLight(0xffe5ca, 2.15)
  key.position.set(-3.8, 7.8, 8.5)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xa9d3df, .74)
  fill.position.set(4.8, 4.3, 6.5)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xe1b56b, .72)
  rim.position.set(3.5, 6.2, -4.5)
  scene.add(rim)

  const entry = {
    host,
    canvas,
    context,
    renderer,
    scene,
    camera,
    rig,
    shadow,
    mode: props.mode,
    mood: props.mood,
    activity: props.activity,
    role: props.role,
    walking: props.walking,
    baseTurn,
    pointer: new THREE.Vector2(),
    pointerTarget: new THREE.Vector2(),
    pointerActive: false,
    elapsed: 0,
    gestureElapsed: 0,
    lastAnimated: 0,
    hostWidth: 1,
    hostHeight: 1,
    ready: false,
    onFirstPaint,
    outputWidth: 0,
    outputHeight: 0,
    visible: true,
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    dirty: true,
    // A stable render size avoids the visible preview-to-sharp resolution
    // swap that previously occurred just after the character appeared.
    quality: 'sharp',
    lastPainted: 0,
    disposed: false,
  } satisfies CharacterEntry
  measureHost(entry)
  return entry
}

function disposeEntry(entry: CharacterEntry) {
  entry.disposed = true
  entries.delete(entry)
  entry.renderer?.dispose()
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  entry.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (!object.geometry.userData.characterShared) geometries.add(object.geometry)
    const values = Array.isArray(object.material) ? object.material : [object.material]
    values.forEach((value) => {
      if (!value.userData.characterShared) materials.add(value)
    })
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

export function StylizedCharacter({
  gender = 'female',
  tier = 0,
  role = 'counsel',
  mode = 'full',
  mood = 'neutral',
  activity = 'idle',
  walking = false,
  direction = 'front',
  paletteSeed,
  className = '',
  label,
  onReady,
}: StylizedCharacterProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const entryRef = useRef<CharacterEntry | null>(null)
  // Readiness is React state rather than an imperative class. Toggling the class
  // from the frame loop fought every re-render of the host: React rewrote
  // className, dropping `is-ready`, and the figure flickered through its opacity
  // transition until the next painted frame restored it.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    setReady(false)
    const entry = createEntry(host, canvas, { gender, tier, role, mode, mood, activity, walking, direction, paletteSeed }, () => setReady(true))
    if (!entry) return
    entryRef.current = entry
    entries.add(entry)

    const onPointerMove = (event: PointerEvent) => {
      entry.pointerActive = true
      const bounds = host.getBoundingClientRect()
      entry.pointerTarget.set(
        THREE.MathUtils.clamp(((event.clientX - bounds.left) / Math.max(1, bounds.width) - .5) * 2, -1, 1),
        THREE.MathUtils.clamp(((event.clientY - bounds.top) / Math.max(1, bounds.height) - .5) * 2, -1, 1),
      )
      // Reduced-motion entries do not keep a frame loop alive, so gaze tracking
      // has to ask for the frame it needs.
      entry.dirty = true
      requestCharacterFrame()
    }
    const onPointerLeave = () => {
      entry.pointerActive = false
      entry.pointerTarget.set(0, 0)
      entry.dirty = true
      requestCharacterFrame()
    }
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerleave', onPointerLeave)

    const resizeObserver = new ResizeObserver(() => {
      measureHost(entry)
      entry.dirty = true
      requestCharacterFrame()
    })
    resizeObserver.observe(host)
    const intersectionObserver = new IntersectionObserver((observed) => {
      entry.visible = observed[0]?.isIntersecting ?? true
      if (entry.visible) {
        entry.dirty = true
        requestCharacterFrame()
      }
    }, { rootMargin: '120px' })
    intersectionObserver.observe(host)
    requestCharacterFrame()
    onReady?.()

    return () => {
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
      disposeEntry(entry)
      if (entryRef.current === entry) entryRef.current = null
    }
  }, [gender, mode, onReady, paletteSeed, role, tier])

  useEffect(() => {
    const entry = entryRef.current
    if (!entry) return
    const activityChanged = entry.activity !== activity
    entry.activity = activity
    entry.mood = mood
    entry.walking = walking
    entry.baseTurn = direction === 'left' ? -.24 : direction === 'right' ? .24 : -.075
    // Only the gesture clock rewinds. The idle clock keeps running so breath and
    // weight-shift phase carry through the transition without a snap.
    if (activityChanged && activity !== 'idle') entry.gestureElapsed = 0
    entry.dirty = true
    requestCharacterFrame()
  }, [activity, direction, mood, walking])

  return (
    <span
      className={`stylized-character stylized-character-${mode} role-${role} mood-${mood} activity-${activity} ${ready ? 'is-ready' : ''} ${className}`}
      ref={hostRef}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-character-system="reference-stylized-3d"
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <i className="stylized-character-rim" aria-hidden="true" />
    </span>
  )
}
