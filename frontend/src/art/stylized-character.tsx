import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import type { CharacterGender } from '../types'
import { buildStylizedCounsel, type StylizedCounselRig, type StylizedCounselRole } from './stylized-counsel'

export type StylizedCharacterMode = 'full' | 'portrait' | 'icon' | 'scene'
export type StylizedCharacterMood = 'neutral' | 'happy' | 'unhappy' | 'thinking'
export type StylizedCharacterActivity = 'idle' | 'briefing' | 'working' | 'celebrating' | 'heel-click' | 'thumbs-up' | 'courtroom-bow'

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
}

type CharacterEntry = {
  host: HTMLSpanElement
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  rig: StylizedCounselRig
  mode: StylizedCharacterMode
  mood: StylizedCharacterMood
  activity: StylizedCharacterActivity
  role: StylizedCounselRole
  walking: boolean
  baseTurn: number
  pointer: THREE.Vector2
  pointerTarget: THREE.Vector2
  pointerActive: boolean
  started: number
  visible: boolean
  reduced: boolean
  dirty: boolean
  quality: 'preview' | 'sharp'
  lastPainted: number
  disposed: boolean
}

const entries = new Set<CharacterEntry>()
let sharedRenderer: THREE.WebGLRenderer | null = null
let renderSurface: HTMLCanvasElement | null = null
let animationFrame = 0
let lastFrame = 0
let renderCursor = 0

function rendererForCharacters() {
  if (sharedRenderer && renderSurface) return sharedRenderer
  renderSurface = document.createElement('canvas')
  sharedRenderer = new THREE.WebGLRenderer({
    canvas: renderSurface,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
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

function animateRig(entry: CharacterEntry, now: number) {
  const { rig, mood, role, walking, activity } = entry
  const time = entry.reduced ? 0 : (now - entry.started) / 1000
  entry.pointer.lerp(entry.pointerTarget, entry.reduced ? 1 : .08)
  const breath = Math.sin(time * 1.18)
  const sway = Math.sin(time * .55 + .7)
  const stride = walking ? Math.sin(time * 7.0) : 0
  const step = walking ? Math.abs(Math.sin(time * 7.0)) : 0
  const happy = mood === 'happy' ? 1 : 0
  const unhappy = mood === 'unhappy' ? 1 : 0
  const thinking = mood === 'thinking' ? 1 : 0
  const weightShift = Math.sin(time * .31 + .8)
  const gazeDrift = entry.pointerActive ? 0 : Math.sin(time * .23 + .4) * .34
  const gesturePhase = (time + 1.2) % 10.5
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
  const heldGesture = (intro: number, outro: number, end: number) => ease(time / intro) * (1 - ease((time - outro) / Math.max(.01, end - outro)))
  const heelPose = activity === 'heel-click' ? heldGesture(.28, 1.55, 2.15) : 0
  const heelJumpProgress = THREE.MathUtils.clamp((time - .24) / 1.28, 0, 1)
  const heelJump = activity === 'heel-click' && time < 1.52 ? Math.pow(Math.sin(heelJumpProgress * Math.PI), .82) : 0
  const thumbPose = activity === 'thumbs-up' ? heldGesture(.42, 1.8, 2.45) : 0
  const bowProgress = THREE.MathUtils.clamp((time - .12) / 1.9, 0, 1)
  const bowPose = activity === 'courtroom-bow' && time < 2.25 ? Math.pow(Math.sin(bowProgress * Math.PI), 1.35) : 0

  rig.hips.position.y = rig.base.hipsY + step * .035 + breath * .008 + heelJump * .27 - bowPose * .055
  rig.hips.position.x = sway * .012 + weightShift * .022 * (1 - Math.min(1, Math.abs(stride)))
  rig.hips.rotation.y = weightShift * .012
  rig.hips.rotation.z = stride * .012 + sway * .004 + weightShift * .004
  rig.spine.rotation.x = bowPose * .24 - heelJump * .035
  rig.spine.rotation.y = -weightShift * .018 + briefingGesture * .022
  rig.spine.rotation.z = -stride * .018 + sway * .008 - workingGesture * .012
  rig.chest.scale.set(1 + breath * .006, 1 + breath * .004, 1 + breath * .007)
  rig.head.rotation.y = entry.pointer.x * .24 + gazeDrift * .16 - stride * .018 + thinking * .08
  rig.head.rotation.x = entry.pointer.y * -.075 + breath * .004 + unhappy * .03 + workingGesture * .035 - bowPose * .08
  rig.head.rotation.z = sway * .010 - happy * .015 + unhappy * .018 + briefingGesture * .012 + thumbPose * .025
  rig.leftShoulder.rotation.x = -stride * .30 + workingGesture * .16 - celebration * .10 - heelPose * .12 - bowPose * .03
  rig.rightShoulder.rotation.x = stride * .30 - workingGesture * .20 + cuffAdjust * .26 - celebration * .10 - heelPose * .12 - thumbPose * .34 - bowPose * .03
  rig.leftShoulder.rotation.z = rig.base.leftShoulderZ - breath * .006 - happy * .045 - celebration * .34 + workingGesture * .08 - heelPose * .32 + bowPose * .08
  rig.rightShoulder.rotation.z = rig.base.rightShoulderZ + breath * .006 + happy * .075 + welcome * .52 - thinking * .42 + briefingGesture * .34 + celebration * .34 + cuffAdjust * .16 + heelPose * .32 + thumbPose * 1.05 - bowPose * .08
  rig.leftElbow.rotation.x = workingGesture * .52 + celebration * .16 + heelPose * .12
  rig.rightElbow.rotation.x = workingGesture * .44 + briefingGesture * .16 + cuffAdjust * .62 + celebration * .16 + heelPose * .12 + thumbPose * .34
  rig.leftElbow.rotation.z = rig.base.leftElbowZ + Math.max(0, stride) * .08 - happy * .04 - workingGesture * .18 - celebration * .22 - heelPose * .12
  rig.rightElbow.rotation.z = rig.base.rightElbowZ - Math.max(0, -stride) * .08 - welcome * .20 - thinking * .28 - briefingGesture * .18 - cuffAdjust * .46 + celebration * .22 - heelPose * .12 - thumbPose * 1.02
  rig.rightHand.rotation.x = thumbPose * -.34
  rig.rightHand.rotation.z = Math.sin(time * 4.2) * welcome * .20 + briefingGesture * Math.sin(time * 2.1) * .10 - cuffAdjust * .18 + thumbPose * .42
  rig.leftHand.rotation.z = workingGesture * .10 + celebration * .08 - heelPose * .08
  rig.rightThumb.rotation.z = -.75 + thumbPose * 1.25
  rig.leftHip.rotation.x = stride * .46 + Math.max(0, weightShift) * .012 - heelJump * .12
  rig.rightHip.rotation.x = -stride * .46 + Math.max(0, -weightShift) * .012 - heelJump * .12
  rig.leftHip.rotation.z = -.025 + heelPose * .19
  rig.rightHip.rotation.z = .025 - heelPose * .19
  rig.leftKnee.rotation.x = Math.max(0, -stride) * .52 + Math.max(0, weightShift) * .012 + heelJump * .7
  rig.rightKnee.rotation.x = Math.max(0, stride) * .52 + Math.max(0, -weightShift) * .012 + heelJump * .7
  rig.leftFoot.rotation.x = Math.max(0, stride) * .16
  rig.rightFoot.rotation.x = Math.max(0, -stride) * .16
  rig.leftFoot.rotation.z = heelPose * -.24
  rig.rightFoot.rotation.z = heelPose * .24
  rig.root.rotation.y = entry.baseTurn + entry.pointer.x * .025

  const blinkPhase = time % 6.2
  const blink = blinkPhase > 3.0 && blinkPhase < 3.23 ? Math.sin((blinkPhase - 3.0) / .23 * Math.PI) : 0
  rig.eyes.forEach((eye) => { eye.scale.y = Math.max(.08, 1 - blink * .92) })
  rig.pupils.forEach((pupil) => pupil.position.set(entry.pointer.x * .012, entry.pointer.y * -.008, Number(pupil.userData.baseZ ?? .027)))
}

function paintCharacter(entry: CharacterEntry, now: number) {
  const renderer = rendererForCharacters()
  const surface = renderSurface!
  const width = Math.max(1, Math.round(entry.host.clientWidth))
  const height = Math.max(1, Math.round(entry.host.clientHeight))
  const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1)
  const outputWidth = Math.max(1, Math.round(width * pixelRatio))
  const outputHeight = Math.max(1, Math.round(height * pixelRatio))
  if (entry.canvas.width !== outputWidth || entry.canvas.height !== outputHeight) {
    entry.canvas.width = outputWidth
    entry.canvas.height = outputHeight
    entry.dirty = true
  }

  const aspect = width / height
  const viewHeight = entry.mode === 'portrait' ? 1.78 : entry.mode === 'icon' ? 1.56 : entry.mode === 'scene' ? 5.82 : 5.92
  entry.camera.top = viewHeight / 2
  entry.camera.bottom = -viewHeight / 2
  entry.camera.left = -viewHeight * aspect / 2
  entry.camera.right = viewHeight * aspect / 2
  entry.camera.updateProjectionMatrix()

  // Render into a target with the same aspect ratio as the visible panel.
  // The previous square 320px target gave tall characters only a ~100px-wide
  // source strip, which was then enlarged and visibly softened. A quick first
  // pass makes the character appear promptly; the next pass resolves it at the
  // panel's actual density without allocating another WebGL context.
  const sharpHeight = entry.mode === 'full'
    ? Math.min(1200, Math.max(760, outputHeight))
    : entry.mode === 'scene'
      ? Math.min(960, Math.max(640, outputHeight))
      : entry.mode === 'portrait'
        ? Math.min(480, Math.max(320, outputHeight))
        : Math.min(360, Math.max(240, outputHeight))
  const previewHeight = entry.mode === 'full' || entry.mode === 'scene' ? 420 : entry.mode === 'portrait' ? 220 : 180
  let renderHeight = entry.quality === 'preview' ? Math.min(previewHeight, sharpHeight) : sharpHeight
  let renderWidth = Math.max(1, Math.round(renderHeight * aspect))
  const maxWidth = entry.mode === 'full' || entry.mode === 'scene' ? 880 : 520
  if (renderWidth > maxWidth) {
    renderHeight = Math.max(1, Math.round(renderHeight * maxWidth / renderWidth))
    renderWidth = maxWidth
  }
  if (surface.width !== renderWidth || surface.height !== renderHeight) renderer.setSize(renderWidth, renderHeight, false)
  renderer.setViewport(0, 0, renderWidth, renderHeight)
  renderer.setScissorTest(false)
  renderer.clear(true, true, true)
  animateRig(entry, now)
  renderer.render(entry.scene, entry.camera)

  entry.context.clearRect(0, 0, outputWidth, outputHeight)
  entry.context.imageSmoothingEnabled = true
  entry.context.imageSmoothingQuality = 'high'
  entry.context.drawImage(surface, 0, 0, renderWidth, renderHeight, 0, 0, outputWidth, outputHeight)
  entry.host.classList.add('is-ready')
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
  if (now - lastFrame < 32) {
    animationFrame = window.requestAnimationFrame(runCharacterFrame)
    return
  }
  lastFrame = now
  const visible = Array.from(entries).filter((entry) => {
    if (!entry.visible || entry.disposed || (entry.reduced && !entry.dirty)) return false
    if (entry.dirty) return true
    const interval = entry.walking ? 48 : entry.mode === 'full' || entry.mode === 'scene' ? 66 : entry.mode === 'portrait' ? 96 : 120
    return now - entry.lastPainted >= interval
  })
  const budget = Math.min(8, visible.length)
  for (let offset = 0; offset < budget; offset += 1) {
    const entry = visible[(renderCursor + offset) % visible.length]
    paintCharacter(entry, now)
  }
  if (visible.length > budget) renderCursor = (renderCursor + budget) % visible.length
  animationFrame = window.requestAnimationFrame(runCharacterFrame)
}

function requestCharacterFrame() {
  if (!animationFrame) animationFrame = window.requestAnimationFrame(runCharacterFrame)
}

function createEntry(
  host: HTMLSpanElement,
  canvas: HTMLCanvasElement,
  props: Required<Pick<StylizedCharacterProps, 'gender' | 'tier' | 'role' | 'mode' | 'mood' | 'activity' | 'walking' | 'direction'>> & Pick<StylizedCharacterProps, 'paletteSeed'>,
): CharacterEntry | null {
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return null
  const scene = new THREE.Scene()
  const targetY = props.mode === 'portrait' || props.mode === 'icon' ? 5.03 : 2.76
  const camera = new THREE.OrthographicCamera(-2, 2, 3.2, -3.2, .1, 40)
  camera.position.set(0, targetY + .04, 10.5)
  camera.lookAt(0, targetY, .12)

  const rig = buildStylizedCounsel(props.gender, props.tier, { role: props.role, paletteSeed: props.paletteSeed })
  const baseTurn = props.direction === 'left' ? -.24 : props.direction === 'right' ? .24 : -.075
  rig.root.rotation.y = baseTurn
  scene.add(rig.root)

  if (props.mode === 'full' || props.mode === 'scene') {
    const shadow = new THREE.Mesh(
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

  return {
    host,
    canvas,
    context,
    scene,
    camera,
    rig,
    mode: props.mode,
    mood: props.mood,
    activity: props.activity,
    role: props.role,
    walking: props.walking,
    baseTurn,
    pointer: new THREE.Vector2(),
    pointerTarget: new THREE.Vector2(),
    pointerActive: false,
    started: performance.now(),
    visible: true,
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    dirty: true,
    quality: 'preview',
    lastPainted: 0,
    disposed: false,
  } satisfies CharacterEntry
}

function disposeEntry(entry: CharacterEntry) {
  entry.disposed = true
  entries.delete(entry)
  entry.host.classList.remove('is-ready')
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
}: StylizedCharacterProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    host.classList.remove('is-ready')
    const entry = createEntry(host, canvas, { gender, tier, role, mode, mood, activity, walking, direction, paletteSeed })
    if (!entry) return
    entries.add(entry)

    const onPointerMove = (event: PointerEvent) => {
      entry.pointerActive = true
      const bounds = host.getBoundingClientRect()
      entry.pointerTarget.set(
        THREE.MathUtils.clamp(((event.clientX - bounds.left) / Math.max(1, bounds.width) - .5) * 2, -1, 1),
        THREE.MathUtils.clamp(((event.clientY - bounds.top) / Math.max(1, bounds.height) - .5) * 2, -1, 1),
      )
    }
    const onPointerLeave = () => {
      entry.pointerActive = false
      entry.pointerTarget.set(0, 0)
    }
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerleave', onPointerLeave)

    const resizeObserver = new ResizeObserver(() => {
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

    return () => {
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
      disposeEntry(entry)
    }
  }, [activity, direction, gender, mode, mood, paletteSeed, role, tier, walking])

  return (
    <span
      className={`stylized-character stylized-character-${mode} role-${role} mood-${mood} activity-${activity} ${className}`}
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
