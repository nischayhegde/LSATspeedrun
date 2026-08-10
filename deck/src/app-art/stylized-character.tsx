import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { CharacterGender } from './types'
import {
  HumanoidActor,
  HumanoidBehaviorDirector,
  warmHumanoidClips,
  type HumanoidGesture,
  type HumanoidState,
} from './rig'
import { IllustratedRenderPass } from './render-style'
import {
  buildStylizedCounsel,
  type CounselCosmetics,
  type StylizedCounselRig,
  type StylizedCounselRole,
} from './stylized-counsel'

export type StylizedCharacterMode = 'hero' | 'full' | 'portrait' | 'icon' | 'scene'
export type StylizedCharacterMood = 'neutral' | 'happy' | 'unhappy' | 'thinking'
/**
 * What the character is doing.
 *
 * `professional-wave` used to be in this list and is deliberately gone. It was
 * the app's most-seen animation - one of two beats the Office hero panel
 * opened with - and a wave is the one gesture that cannot be made to look like
 * a person rather than a mascot, because the motion itself is a hand held up
 * and oscillated. `greeting` replaces it with a courteous acknowledgment, and
 * the two beats it used to sit alongside (`heel-click`, `thumbs-up`) went with
 * it: nothing in the app ever set them, and both were built out of the same
 * isolated-limb easing this file no longer has.
 */
export type StylizedCharacterActivity =
  | 'idle'
  | 'briefing'
  | 'working'
  | 'celebrating'
  | 'greeting'
  | 'courtroom-bow'

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
  /** The player's wardrobe. Omitted for every other character in the cast, who
   *  keep the appearance their palette seed derives. */
  cosmetics?: CounselCosmetics | null
  className?: string
  label?: string
  onReady?: () => void
}

type CharacterEntry = {
  host: HTMLSpanElement
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D | null
  renderer: THREE.WebGLRenderer | null
  /**
   * Only the hero/full portraits get the illustrated composite. They own a
   * dedicated renderer whose target is one-to-one with its canvas, so a render
   * target can be sized once and kept. The smaller busts share one pooled
   * renderer that is resized to each entry in turn, and giving that a persistent
   * target would mean reallocating it several times per frame.
   */
  stylePass: IllustratedRenderPass | null
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  rig: StylizedCounselRig
  actor: HumanoidActor
  shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null
  mode: StylizedCharacterMode
  mood: StylizedCharacterMood
  activity: StylizedCharacterActivity
  role: StylizedCounselRole
  walking: boolean
  baseTurn: number
  seed: number
  pointer: THREE.Vector2
  pointerTarget: THREE.Vector2
  pointerActive: boolean
  elapsed: number
  /**
   * The eye's own clock, which is not the body's.
   *
   * Blinks and saccades used to be read straight off periodic functions of
   * elapsed time, which is cheap and wrong in a specific way: both are
   * ballistic events with a hold between them, not oscillations. A person
   * blinks, then does not blink for somewhere between two and eight seconds,
   * then blinks twice in quick succession, then not for six. Sampling a sine
   * cannot produce that distribution at any frequency, and at portrait framing
   * - a face at 3x magnification with nothing else on screen - the regularity
   * is one of the last mechanical tells left after the body is fixed.
   *
   * So the schedule is kept, not computed: each event picks when the next one
   * happens. Four numbers per character and one comparison per frame.
   */
  blinkStart: number
  blinkNext: number
  blinkBurst: number
  blinkCount: number
  /**
   * Where the eyes are pointed, in the same normalised units as `pointer`.
   *
   * Gaze moves by saccade - a 30 to 80 millisecond flick to a new fixation,
   * then a hold of a few hundred milliseconds to a couple of seconds. `from`
   * and `to` bracket the flick in progress and `saccadeStart` times it.
   */
  saccadeFrom: THREE.Vector2
  saccadeTo: THREE.Vector2
  saccadeStart: number
  saccadeNext: number
  saccadeCount: number
  /**
   * The head's share of the current fixation, lagged behind the eyes.
   *
   * On a real gaze shift the eyes arrive first and the head rotates after
   * them, over a few hundred milliseconds, and then the eyes counter-roll back
   * toward centre as the head catches up. Reproducing the lag is what makes a
   * look read as a look rather than as a head turn with painted-on pupils.
   */
  gazeHead: THREE.Vector2
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
  // Head crops, re-centred after the rig started standing on the floor.
  //
  // `soleOffset` dropped every character about 0.19 units relative to its root
  // so the shoes rest at y=0 instead of hovering above it, which moved the
  // head down by the same amount inside a crop that had been framed around
  // where it used to be. Measured on the running app, the portrait canvas was
  // 40% empty above the hair with the figure running off the bottom edge - a
  // head sitting low in its circle, which reads as a slouch that the pose is
  // not actually doing. These bring it back to roughly a fifth of the panel in
  // headroom, which centres the skull in the circular mask the card applies.
  portrait: { viewHeight: 1.78, centerY: 4.72 },
  icon: { viewHeight: 1.56, centerY: 4.76 },
}

/**
 * How much of the gaze model's head travel each framing takes.
 *
 * This scales where the character *looks*, which is an angle and therefore
 * does not shrink because the lens is closer - so the tight crops were being
 * held to under a third of it for the wrong reason. What they are actually
 * guarding against is a head leaving the frame, and at these amplitudes it
 * cannot: the full share is about seven degrees of yaw, against the fourteen
 * the cursor already turns the head by on the same surface. Giving the crops
 * most of it back is the difference between eyes that flick to something and
 * eyes that flick to something while the head stays bolted forward.
 */
const ambientMotion: Record<StylizedCharacterMode, number> = {
  hero: 1.25,
  full: 1.1,
  scene: 1,
  portrait: .78,
  icon: .62,
}

/**
 * How far each framing scales the authored upper-body performance.
 *
 * See `EXPRESSION_SHARE` in the actor for the mechanism. The numbers here are
 * set by how many pixels a degree buys on each surface. The hero panel renders
 * the figure about three hundred pixels tall, so a degree at the shoulder
 * moves a hand by roughly one and a half pixels and the idle's four degrees of
 * sway is a six-pixel drift over five seconds - true to life, and under the
 * threshold at which anyone reads it as breathing rather than as a still
 * image. A quarter more travel puts it over that line without touching the
 * timing, the posture or the shape of any curve.
 *
 * The head crops get more because they show less: at eighty pixels of head
 * there is nothing on screen but the part of the body the clips move least.
 * `scene` stays at one, because the roster and world-map figures are seen at
 * the size the library was authored for and several at a time.
 */
const expressionGain: Record<StylizedCharacterMode, number> = {
  hero: 1.26,
  full: 1.2,
  scene: 1,
  portrait: 1.45,
  icon: 1.45,
}

function isFullBody(mode: StylizedCharacterMode) {
  return mode === 'hero' || mode === 'full' || mode === 'scene'
}

const entries = new Set<CharacterEntry>()
let sharedRenderer: THREE.WebGLRenderer | null = null
let renderSurface: HTMLCanvasElement | null = null
let animationFrame = 0
let renderCursor = 0
let lastFrameTime = 0

/**
 * One director for every character on the page.
 *
 * Sharing it is not only cheaper, it is the thing that keeps a grid of
 * portraits from moving in unison: the director advances one deterministic
 * random stream per actor, seeded from that character's own identity, so two
 * cards showing different people schedule their beats independently while two
 * showing the same person stay reproducible across reloads.
 */
const characterDirector = new HumanoidBehaviorDirector()

function rendererForCharacters() {
  if (sharedRenderer && renderSurface) return sharedRenderer
  renderSurface = document.createElement('canvas')
  sharedRenderer = new THREE.WebGLRenderer({
    canvas: renderSurface,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })
  sharedRenderer.debug.checkShaderErrors = import.meta.env.DEV
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
  // See the note in the office scene: the shader-error check blocks the main
  // thread on shader compilation, which is the one thing on this path that the
  // driver would otherwise do in parallel.
  renderer.debug.checkShaderErrors = import.meta.env.DEV
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.22
  renderer.shadowMap.enabled = false
  // paintCharacter clears explicitly, so the automatic clear is redundant work.
  renderer.autoClear = false
}

/** Standard smoothstep, still used for the blink. */
function ease(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

/**
 * The looping state each activity settles into, and the beat it opens with.
 *
 * `null` hands the character to the behaviour director, which drifts it around
 * the three resting stances and layers the idle repertoire over the top. The
 * other activities are directed: the caller has said what this character is
 * doing, so the director is suspended and the state held.
 */
const ACTIVITY_STATE: Record<StylizedCharacterActivity, HumanoidState | null> = {
  idle: null,
  briefing: 'confer',
  working: 'reviewDocument',
  celebrating: 'idle',
  greeting: null,
  'courtroom-bow': null,
}

const ACTIVITY_GESTURE: Partial<Record<StylizedCharacterActivity, HumanoidGesture>> = {
  celebrating: 'celebrate',
  greeting: 'acknowledge',
  'courtroom-bow': 'courtBow',
}

/**
 * Which resting repertoire a mood reaches for.
 *
 * Mood used to be a set of constant offsets added to a few joints - a fixed
 * head tilt for "thinking", a shoulder lift for "happy" - which is a pose,
 * not a mood, and a pose held forever is exactly the mannequin quality this
 * work is trying to remove. Expressing it as a bias over which beats fire
 * means a thinking character is one that keeps tilting its head to weigh
 * something up, and a happy one keeps nodding, which is what those moods
 * actually look like on a person.
 */
const MOOD_BEATS: Record<StylizedCharacterMood, HumanoidGesture[]> = {
  neutral: [],
  happy: ['nod', 'postureReset', 'breathDeep', 'resolve'],
  unhappy: ['weightSettle', 'weightSettleMirrored', 'breathDeep', 'breathSigh'],
  thinking: ['considerTilt', 'considerTiltMirrored', 'glance', 'doubleTake'],
}

/** Deterministic per-entry variation, so two cards showing the same character
 *  agree and two showing different ones do not. */
function seededRandom(seed: number, salt: number) {
  return ((Math.imul(seed ^ salt, 2654435761) >>> 0) % 4096) / 4096
}

function entryRandom(entry: CharacterEntry, salt: number) {
  return seededRandom(entry.seed, salt)
}

/**
 * Everything the skeletal actor does not own.
 *
 * The actor drives all sixteen humanoid joints from authored clips. What is
 * left here is the part of this surface that is not a humanoid pose at all:
 * where the character is looking, its eyelids and pupils, and the contact
 * shadow. Gaze in particular has to stay outside the clip system because it
 * follows the visitor's cursor, which no clip can know about.
 */
function animateRig(entry: CharacterEntry, delta: number) {
  const { rig } = entry
  if (!entry.reduced) entry.elapsed += delta
  const time = entry.reduced ? 2.4 : entry.elapsed
  const lerpFactor = entry.reduced ? 1 : 1 - Math.exp(-5 * delta)
  entry.pointer.lerp(entry.pointerTarget, lerpFactor)
  const ambient = ambientMotion[entry.mode]

  // The skeleton, from the clips.
  entry.actor.update(delta)

  // Gaze, layered onto whatever the clips just produced.
  //
  // Composed rather than assigned. The old driver wrote absolute rotations to
  // every joint, so gaze and pose were the same expression and neither could
  // exist without the other; here the actor has already written a complete
  // head rotation and this turns the head a little further from wherever that
  // left it. Which is also the physically right answer - a person looking at
  // something turns their head relative to their current posture, not to a
  // fixed forward.
  //
  // The untended drift that used to live here - two incommensurate sines - has
  // been replaced by the gaze model below, which turns the head as a
  // consequence of the eyes having gone somewhere rather than as a motion in
  // its own right.
  rig.head.rotation.y += entry.pointer.x * .24
  rig.head.rotation.x += entry.pointer.y * -.075
  // A degree or two of persistent asymmetry, seeded per character. Real necks
  // are not square to the shoulders, and an exactly level head is one of the
  // strongest mannequin cues at portrait framing.
  rig.head.rotation.z += (entryRandom(entry, 0x51ed270b) - .5) * .05
  // The body turns slightly to follow the cursor, an order of magnitude less
  // than the head does.
  rig.root.rotation.y = entry.baseTurn + entry.pointer.x * .025

  // Blinks, on a kept schedule rather than a periodic function.
  //
  // Each blink decides when the next one happens, which is the only way to get
  // the actual distribution: mostly gaps of two to eight seconds, and about
  // one time in six a second blink 150 milliseconds behind the first. A sine
  // can be made irregular but it cannot be made bursty, and the burst is the
  // part that reads as alive.
  if (!entry.reduced && time >= entry.blinkNext) {
    entry.blinkStart = time
    entry.blinkCount += 1
    const roll = entryRandom(entry, 0x2f1b3d05 ^ Math.imul(entry.blinkCount, 0x9e3779b1))
    if (entry.blinkBurst > 0) {
      entry.blinkBurst -= 1
      entry.blinkNext = time + .19 + roll * .07
    } else {
      const pair = entryRandom(entry, 0x6b5fd19d ^ Math.imul(entry.blinkCount, 0x85ebca6b))
      entry.blinkBurst = pair < .17 ? 1 : 0
      // Skewed toward the short end: the mean human inter-blink interval sits
      // near four seconds with a long tail, so cubing a uniform roll and
      // stretching it fits far better than a flat range would.
      entry.blinkNext = time + 2.1 + roll * roll * roll * 9.5
    }
  }
  // A real lid shuts in about 80ms and opens in twice that, and both halves
  // are eased so it accelerates out of and settles into the open pose.
  const sinceBlink = time - entry.blinkStart
  const blink = sinceBlink < 0 || sinceBlink > .265
    ? 0
    : sinceBlink < .085
      ? ease(sinceBlink / .085)
      : 1 - ease((sinceBlink - .085) / .18)
  rig.eyes.forEach((eye) => { eye.scale.y = Math.max(.08, 1 - blink * .92) })

  // Gaze, by saccade and fixation.
  //
  // The eye does not drift; it flicks and holds. Most of these are micro -
  // a fraction of the eye's width, the constant small repositioning that goes
  // on inside a single fixation - and roughly one in five is a real shift to
  // somewhere else in the room, which is also the only kind the head follows.
  if (!entry.reduced && time >= entry.saccadeNext) {
    entry.saccadeFrom.copy(entry.saccadeTo)
    entry.saccadeStart = time
    entry.saccadeCount += 1
    const rx = entryRandom(entry, 0x1d872b41 ^ Math.imul(entry.saccadeCount, 0xc2b2ae35))
    const ry = entryRandom(entry, 0x7f4a7c15 ^ Math.imul(entry.saccadeCount, 0x27d4eb2f))
    const kind = entryRandom(entry, 0x3c79ac49 ^ Math.imul(entry.saccadeCount, 0x165667b1))
    const large = kind < .22
    const reach = large ? 1 : .28
    entry.saccadeTo.set((rx - .5) * 2 * reach, (ry - .5) * 2 * reach * .6)
    // A large shift is worth looking at for longer than a micro-correction,
    // and the hold after either is drawn from a skewed range for the same
    // reason the blink interval is.
    entry.saccadeNext = time + (large ? .9 : .28) + ry * ry * (large ? 2.6 : 1.5)
  }
  // 55ms of flick, eased at both ends. Fast enough to be a saccade, slow
  // enough that a 60Hz frame lands inside it and it never reads as a jump.
  const saccade = ease(THREE.MathUtils.clamp((time - entry.saccadeStart) / .055, 0, 1))
  const gazeX = entry.saccadeFrom.x + (entry.saccadeTo.x - entry.saccadeFrom.x) * saccade
  const gazeY = entry.saccadeFrom.y + (entry.saccadeTo.y - entry.saccadeFrom.y) * saccade
  // The head follows, slowly, and only takes a fraction of the angle. The
  // exponential is a ~0.4s time constant, so a large shift has the eyes there
  // in one frame and the head still arriving a third of a second later.
  const headFollow = entry.reduced ? 1 : 1 - Math.exp(-2.6 * delta)
  entry.gazeHead.x += (gazeX - entry.gazeHead.x) * headFollow
  entry.gazeHead.y += (gazeY - entry.gazeHead.y) * headFollow
  // A character being pointed at is looking at the cursor, so its own wander
  // is scaled back rather than switched off - the small corrections continue,
  // because eyes fixating on something still make them.
  const wander = (entry.pointerActive ? .25 : 1) * ambient
  rig.head.rotation.y += entry.gazeHead.x * .13 * wander
  rig.head.rotation.x += entry.gazeHead.y * -.055 * wander
  // What the eyes contribute is the part the head has not taken yet, which is
  // the counter-roll: right after a shift the pupils are hard over, and they
  // ease back toward centre as the neck catches up.
  const pupilX = entry.pointer.x * .012 + (gazeX - entry.gazeHead.x * .62) * wander * .0135
  const pupilY = entry.pointer.y * -.008 + (gazeY - entry.gazeHead.y * .62) * wander * .007
  rig.pupils.forEach((pupil) => pupil.position.set(pupilX, pupilY, Number(pupil.userData.baseZ ?? .027)))

  if (entry.shadow) {
    // Driven off where the pelvis actually ended up rather than off a copy of
    // the sine that used to move it. Reading the result means the shadow stays
    // correct through every clip and every gesture without knowing about any
    // of them - including the ones that did not exist when it was written.
    const lift = (rig.hips.position.y - rig.base.hipsY) / Math.max(.01, rig.base.hipsY)
    entry.shadow.position.x = rig.hips.position.x * .55
    entry.shadow.scale.set(1 - lift * 1.6, .36 * (1 - lift * 2.1), 1)
    entry.shadow.material.opacity = .28 - lift * 1.4
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
      entry.stylePass?.setSize(width, height)
    }
  } else {
    if (surface.width !== renderWidth || surface.height !== renderHeight) renderer.setSize(renderWidth, renderHeight, false)
    renderer.setViewport(0, 0, renderWidth, renderHeight)
    renderer.setScissorTest(false)
  }
  renderer.clear(true, true, true)
  if (entry.stylePass) entry.stylePass.render(entry.scene, entry.camera)
  else renderer.render(entry.scene, entry.camera)

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
    // Something is on screen, so the unbaked half of the clip library can be
    // filled in during idle time rather than ahead of this paint.
    warmHumanoidClips()
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
  const delta = lastFrameTime ? Math.min(.05, Math.max(0, (now - lastFrameTime) / 1000)) : 1 / 60
  lastFrameTime = now

  // Advancing and painting are now two separate schedules, and separating them
  // is what let this surface adopt the rig at all.
  //
  // It used to step its animation inside `paintCharacter`, so a mode throttled
  // to 20 or 31 fps also had its animation clock ticked at 20 or 31 Hz. That
  // is fine for a sine evaluated at an absolute time, which is what used to be
  // here, and not fine for the actor: crossfade weights and the foot anchor
  // both integrate per-frame, so a 0.3 second transition would get seven
  // samples instead of twenty and arrive visibly stepped - which is precisely
  // the snapping this whole exercise is meant to remove.
  //
  // Simulation is therefore unconditional and at display rate, and only the
  // render and the canvas copy - which are the expensive parts, and the only
  // parts the throttle was ever for - stay on a budget. Stepping an actor with
  // no draw costs a mixer update and sixteen quaternion writes.
  characterDirector.update(delta)
  for (const entry of entries) {
    if (!entry.visible || entry.disposed) continue
    if (entry.reduced && entry.ready && !entry.dirty) continue
    animateRig(entry, delta)
  }
  runCharacterProbe(now)

  const visible = Array.from(entries).filter((entry) => {
    if (!entry.visible || entry.disposed || (entry.reduced && !entry.dirty)) return false
    if (entry.dirty) return true
    // The single hero/full character (and anyone actually walking) follows the
    // display refresh rate. Standing "scene" rigs share their pace with
    // portraits instead: several can be on screen at once (staff roster, world
    // map), and their ambient breath reads much the same a little under refresh
    // rate, so there is no reason to pay for a full-rate render+copy on every
    // one of them every frame.
    //
    // The exception is while something is actually happening. A crossfade or a
    // layered beat is where a frame rate becomes visible - a body moving at a
    // few degrees a frame shows every dropped one - so an actor mid-transition
    // is promoted to the display rate until it settles, and drops back to the
    // cheap schedule once it is only breathing again.
    const busy = entry.actor.isTransitioning || entry.actor.isPlayingGesture
    const interval = entry.walking || busy || entry.mode === 'hero' || entry.mode === 'full'
      ? 0
      : entry.mode === 'scene' || entry.mode === 'portrait'
        ? 22
        : 44
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

/**
 * A development-only window onto the live characters.
 *
 * Animation quality is the one thing in this file that cannot be judged from
 * a screenshot or asserted in a unit test: the questions that matter are
 * whether a joint's angle is continuous frame to frame, whether a transition
 * eases rather than steps, and whether the blink intervals actually form a
 * distribution rather than a period. All of those are answered by sampling
 * every frame for several seconds, which needs a hook inside the frame loop
 * rather than a poll from outside it.
 *
 * `import.meta.env.DEV` is substituted at build time, so the production bundle
 * contains neither the registry nor the call site.
 */
type CharacterProbe = (now: number, live: ReadonlySet<CharacterEntry>) => void

function publishCharacterDebug() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  const target = window as unknown as { __lsatCharacters?: ReadonlySet<CharacterEntry> }
  target.__lsatCharacters = entries
}

function runCharacterProbe(now: number) {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  const target = window as unknown as { __lsatCharacterProbe?: CharacterProbe }
  target.__lsatCharacterProbe?.(now, entries)
}

function createEntry(
  host: HTMLSpanElement,
  canvas: HTMLCanvasElement,
  props: Required<Pick<StylizedCharacterProps, 'gender' | 'tier' | 'role' | 'mode' | 'mood' | 'activity' | 'walking' | 'direction'>> & Pick<StylizedCharacterProps, 'paletteSeed' | 'cosmetics'>,
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

  const rig = buildStylizedCounsel(props.gender, props.tier, {
    role: props.role,
    paletteSeed: props.paletteSeed,
    cosmetics: props.cosmetics,
  })
  const baseTurn = props.direction === 'left' ? -.24 : props.direction === 'right' ? .24 : -.075
  rig.root.rotation.y = baseTurn
  scene.add(rig.root)
  // Bind only once the rig is in the scene graph and its world matrix is
  // current: the skeleton measures its own limb lengths off the bind pose in
  // world space. This surface renders at scale 1, unlike the office's 0.46,
  // which is exactly the sort of difference the measurement exists to absorb.
  rig.root.updateWorldMatrix(true, true)

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

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const seed = (Math.imul((props.paletteSeed ?? 0) + props.tier * 31 + (props.gender === 'female' ? 7 : 3), 2654435761) >>> 0) % 100000
  const actor = new HumanoidActor(rig, {
    seed,
    state: props.walking ? 'walk' : ACTIVITY_STATE[props.activity] ?? 'idle',
    reduced,
    expression: expressionGain[props.mode],
    // The hero panel is the one surface where the whole chain is on screen at
    // once - the hand at the end of a swinging arm as well as the head on the
    // end of the neck - so it is the one that most repays the drag layer, and
    // the only one that runs it on the arms at all. See `LAG_PLAN`.
    secondary: isFullBody(props.mode) ? 1.15 : .9,
  })
  // Foot planting is a world-space solve with two extra matrix rebuilds, and
  // it earns that only where the feet are both visible and bearing weight on a
  // floor the viewer can see. That is the two full-body framings; the portrait
  // and icon crops start at the collarbone, and `scene` can have a dozen
  // instances on a roster screen. Everything else runs at `medium`, which
  // still plays the same clips through the same crossfades and still clamps
  // every joint - it only skips the part nobody can see.
  actor.setLod(props.mode === 'hero' || props.mode === 'full' ? 'full' : 'medium')
  if (props.walking) actor.setGroundSpeed(actor.naturalWalkSpeed)

  // Started somewhere into the ambient cycle rather than at zero, so a roster
  // grid is not one animation played eight times side by side. Everything on
  // the eye clock is scheduled relative to this, not to the page load.
  const startTime = seededRandom(seed, 0x4f6cdd1d) * 11

  const entry = {
    host,
    canvas,
    context,
    renderer,
    // Portraits are lit rather than shaded flat, and against the parchment card
    // a soft-edged figure floats. The contour is what seats it on the page.
    stylePass: renderer
      ? new IllustratedRenderPass(renderer, {
        exposure: 1.22,
        inkStrength: .62,
        // Held far lower than the rooms. A face is almost all gentle curvature
        // with small features sitting just proud of the skull, so architecture
        // thresholds ring every eye and lip and the portrait comes back looking
        // smudged. Here the contour is wanted on the silhouette and hardly
        // anywhere else.
        normalEdge: .16,
        depthEdge: .92,
        // A portrait fills its card, so a band or a grain speck covers many more
        // screen pixels here than the same setting does on a distant rooftop.
        // Both are pulled back accordingly, or the suit reads as sandpaper.
        bands: 12,
        flatten: .2,
        saturation: 1.12,
        grain: .012,
      })
      : null,
    scene,
    camera,
    rig,
    actor,
    shadow,
    mode: props.mode,
    mood: props.mood,
    activity: props.activity,
    role: props.role,
    walking: props.walking,
    baseTurn,
    seed,
    pointer: new THREE.Vector2(),
    pointerTarget: new THREE.Vector2(),
    pointerActive: false,
    elapsed: startTime,
    blinkStart: startTime - 10,
    blinkNext: startTime + .6 + seededRandom(seed, 0x2f1b3d05) * 4.4,
    blinkBurst: 0,
    blinkCount: 0,
    saccadeFrom: new THREE.Vector2(),
    saccadeTo: new THREE.Vector2(),
    saccadeStart: startTime,
    saccadeNext: startTime + .4 + seededRandom(seed, 0x1d872b41) * 1.8,
    saccadeCount: 0,
    gazeHead: new THREE.Vector2(),
    hostWidth: 1,
    hostHeight: 1,
    ready: false,
    onFirstPaint,
    outputWidth: 0,
    outputHeight: 0,
    visible: true,
    reduced,
    dirty: true,
    // A stable render size avoids the visible preview-to-sharp resolution
    // swap that previously occurred just after the character appeared.
    quality: 'sharp',
    lastPainted: 0,
    disposed: false,
  } satisfies CharacterEntry
  // The hero panel gets its own repertoire. It is the only character in the
  // app a player watches for minutes with nothing beside it, and the beats
  // that suit a background bust are almost all too small to see on it.
  characterDirector.add(actor, isFullBody(props.mode) ? 'portraitHero' : 'portrait', seed)
  applyActivity(entry, props.activity, true)
  measureHost(entry)
  publishCharacterDebug()
  return entry
}

/**
 * Points the actor at whatever the caller has asked for.
 *
 * `initial` distinguishes mounting from a later prop change. On mount the
 * character should already be doing the thing - opening the Office and finding
 * your counsel mid-greeting is right - so the entrance beat fires immediately.
 * On a change it is a transition, and the crossfade handles it.
 */
function applyActivity(entry: CharacterEntry, activity: StylizedCharacterActivity, initial = false) {
  const state = entry.walking ? 'walk' : ACTIVITY_STATE[activity]
  // A directed activity holds one state; `idle` hands back to the ambient
  // scheduler, which drifts between the three resting stances on its own.
  characterDirector.suspend(entry.actor, state !== null)
  if (state) {
    entry.actor.setState(state, initial ? .01 : undefined)
    if (state === 'walk') entry.actor.setGroundSpeed(entry.actor.naturalWalkSpeed)
  }
  const gesture = ACTIVITY_GESTURE[activity]
  if (!gesture) return
  // Mirror the asymmetric entrance beats per character, so two people greeting
  // you on two different screens do not do it identically.
  const mirrored = gesture === 'acknowledge' && entryRandom(entry, 0x7f4a7c15) > .5
  entry.actor.playGesture(mirrored ? 'acknowledgeMirrored' : gesture, {
    amplitude: .8 + entryRandom(entry, 0x9e3779b1) * .2,
    timeScale: .88 + entryRandom(entry, 0x165667b1) * .28,
  })
}

function disposeEntry(entry: CharacterEntry) {
  entry.disposed = true
  entries.delete(entry)
  characterDirector.remove(entry.actor)
  entry.actor.dispose()
  entry.stylePass?.dispose()
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
  cosmetics,
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
  // The wardrobe arrives as a fresh object on every render of the panel above,
  // and rebuilding the rig is the one thing in here that is genuinely
  // expensive. Keying on the content rather than the reference means a re-render
  // that changes nothing about the look does not throw the figure away.
  const cosmeticsKey = cosmetics ? JSON.stringify(cosmetics) : ''
  const wardrobe = useMemo<CounselCosmetics | null>(
    () => (cosmeticsKey ? JSON.parse(cosmeticsKey) as CounselCosmetics : null),
    [cosmeticsKey],
  )

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    setReady(false)
    const entry = createEntry(host, canvas, { gender, tier, role, mode, mood, activity, walking, direction, paletteSeed, cosmetics: wardrobe }, () => setReady(true))
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
  }, [gender, mode, onReady, paletteSeed, role, tier, wardrobe])

  useEffect(() => {
    const entry = entryRef.current
    if (!entry) return
    const changed = entry.activity !== activity || entry.walking !== walking
    const moodChanged = entry.mood !== mood
    entry.activity = activity
    entry.mood = mood
    entry.walking = walking
    entry.baseTurn = direction === 'left' ? -.24 : direction === 'right' ? .24 : -.075
    // No clock rewinds any more. The actor crossfades from whatever pose it is
    // currently in, so a prop change picks the motion up where the body
    // actually is rather than restarting anything from a phase zero that the
    // body is not in.
    if (changed) applyActivity(entry, activity)
    // A mood change is worth acknowledging with a beat from that mood's own
    // repertoire - it reads as the character reacting to the news rather than
    // silently adopting a new resting face.
    if (moodChanged && !changed) {
      const beats = MOOD_BEATS[mood]
      if (beats.length && !entry.actor.isPlayingGesture) {
        entry.actor.playGesture(beats[Math.floor(entryRandom(entry, 0x27d4eb2f) * beats.length) % beats.length], {
          amplitude: .6 + entryRandom(entry, 0x1156bec7) * .35,
          timeScale: .9 + entryRandom(entry, 0xd3a2646c) * .25,
        })
      }
    }
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
