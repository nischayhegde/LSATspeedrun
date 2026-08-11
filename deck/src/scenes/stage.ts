import * as THREE from 'three'

import { IllustratedRenderPass } from '../app-art/render-style'
import { InkDissolve } from './ink-dissolve'
import { isStageOccluded } from './occlusion'
import { registerProbe } from './probe'
import type { DeckScene, SceneContext, SceneFactory } from './types'

/**
 * The deck's single WebGL context, and the only thing in the deck allowed to
 * own one.
 *
 * ## The failure mode this is designed against
 *
 * A slide deck that builds a renderer per scene will, over a twenty-two slide
 * presentation walked back and forth a few times, exhaust the browser's WebGL
 * context limit and lose the lot — and it loses them all at once, on stage, with
 * no way to recover but a reload. So there is one renderer, one canvas, and one
 * `IllustratedRenderPass`, all built once at boot and never replaced. Scenes are
 * swapped inside them.
 *
 * The two ported app scenes (`OfficeThreeScene`, `MapThreeScene`) are the
 * documented exception: they each construct their own renderer, exactly as they
 * do inside the app, and the deck mounts at most one of them at a time on a
 * layer above this canvas. Bringing them under this stage would mean forking
 * four thousand lines of the app's art, which is the one thing the port is not
 * allowed to do.
 *
 * ## Caching, and why memory is bounded rather than zero
 *
 * A scene is built on first show and kept. Rebuilding the hero scene every time
 * the presenter walks backwards over it would put a construction stall on a
 * keystroke, and a stall on a keystroke is what makes a deck feel broken. The
 * cache is an LRU capped at `CACHE_LIMIT`, so `renderer.info.memory` climbs as
 * the deck is first walked and is then flat across every subsequent pass — and
 * the eviction path, which is the one that calls `dispose`, is genuinely
 * exercised rather than dead code.
 */

/** Enough to hold every scene a single act can reach, and no more. */
const CACHE_LIMIT = 5

/** Seconds an ink dissolve between two scenes takes. */
const DISSOLVE_SECONDS = .85

type Active = { id: string; scene: DeckScene }

export class DeckStage {
  readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly pass: IllustratedRenderPass
  private readonly dissolve: InkDissolve
  /** Held final frame of the outgoing scene. See `ink-dissolve.ts`. */
  private readonly captureFrom: THREE.WebGLRenderTarget
  /** This frame of the incoming scene, so the composite can read it back. */
  private readonly captureTo: THREE.WebGLRenderTarget

  private readonly factories = new Map<string, SceneFactory>()
  private readonly cache = new Map<string, DeckScene>()
  /** Most-recently-used last. */
  private readonly recent: string[] = []

  private active: Active | null = null
  /** Bumped on every `show`, so a slow build that lost the race is discarded. */
  private token = 0
  private blend: { elapsed: number; duration: number } | null = null

  private readonly context: SceneContext
  private readonly pointerTarget = { x: 0, y: 0 }
  private width = 1
  private height = 1
  private running = false
  private frame = 0
  private previousTime = 0
  private sceneElapsed = 0
  /** Smoothed frame time, for the presenter HUD. */
  frameMs = 0
  private frameAccumulator = 0
  private frameSamples = 0

  constructor(options: { reduced: boolean }) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'deck-stage-canvas'

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    // A pixel ratio of 3 on a modern laptop panel is nine times the fragment
    // work of 1 for a difference nobody in the third row can see, and the deck's
    // budget is a steady 60fps rather than a still frame. 2 is the cap the app
    // uses in its own harness for the same reason.
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    // Asking for a shader info log blocks the main thread until the driver has
    // finished compiling, which the app measured at ~97ms on the office — the
    // largest single item between a canvas appearing and its first frame. The
    // deck warms scenes ahead of the slide that needs them, so a stall here
    // lands on a keystroke rather than on a load.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV
    this.renderer.info.autoReset = false
    // Shadow mapping, on for the whole stage because exactly one scene needs
    // it and toggling it per scene does not work: `shadowMap.enabled` is part
    // of every material's program key, so flipping it recompiles every shader
    // in the incoming scene, on the keystroke that shows it. Left on, it costs
    // nothing at all in the scenes that do not use it — the shadow pass only
    // runs for lights with `castShadow`, and `close-room-scene.ts` has the
    // only one in the deck.
    this.renderer.shadowMap.enabled = true
    // PCF rather than `PCFSoftShadowMap`, which this version of three has
    // deprecated: setting it logs a warning and then silently uses this
    // anyway. The softness the close wants comes from the shadow camera being
    // cut to the body rather than from the filter.
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    const size = this.measure()
    this.renderer.setSize(size.width, size.height, false)
    this.width = size.width
    this.height = size.height

    // Deliberately softer than the app's defaults. The app is read at arm's
    // length on a bright page; the deck is projected in a dark room, where the
    // app's contour strength turns every silhouette into a hard black line and
    // its banding shows as terraces on a 3-metre panel.
    this.pass = new IllustratedRenderPass(this.renderer, {
      inkStrength: .62,
      bands: 11,
      flatten: .3,
      grain: .035,
      saturation: 1.14,
    })
    this.dissolve = new InkDissolve()

    const ratio = this.renderer.getPixelRatio()
    const targetOptions = {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    } as const
    // Plain 8-bit, no colour space. Both targets hold the *output* of the
    // illustrated pass, which has already tone-mapped and sRGB-encoded the
    // frame in its own shader. Declaring these sRGB would have the GPU decode
    // on read and re-encode on write, double-converting a frame that is already
    // display-ready.
    this.captureFrom = new THREE.WebGLRenderTarget(
      Math.floor(this.width * ratio), Math.floor(this.height * ratio), targetOptions,
    )
    this.captureTo = new THREE.WebGLRenderTarget(
      Math.floor(this.width * ratio), Math.floor(this.height * ratio), targetOptions,
    )

    this.context = {
      renderer: this.renderer,
      width: this.width,
      height: this.height,
      reduced: options.reduced,
      pointer: { x: 0, y: 0 },
    }

    window.addEventListener('resize', this.handleResize)
    window.addEventListener('pointermove', this.handlePointer, { passive: true })
    // A lost context is unrecoverable mid-talk, so it is at least reported
    // loudly rather than showing a frozen frame nobody can explain.
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      console.error('deck: WebGL context lost — reload the deck')
    })

    // A function rather than an object, so a caller gets this frame's values
    // instead of a snapshot taken when the deck booted. Read-only by
    // construction — every field is copied out — so nothing on the far side of
    // it can reach into the renderer. See `probe.ts`.
    registerProbe('__deckStage', () => this.stats)
  }

  register(id: string, factory: SceneFactory) {
    this.factories.set(id, factory)
  }

  /**
   * Build a scene now and keep it, without showing it.
   *
   * Called for the slide either side of the current one. This is the whole
   * answer to construction stalls: by the time an arrow key asks for a scene it
   * has already been built, so the keystroke costs a camera tween.
   */
  async warm(id: string) {
    if (!id || id === 'none' || this.cache.has(id)) return
    const factory = this.factories.get(id)
    if (!factory) return
    try {
      const scene = await factory(this.context)
      // The show that raced ahead of this warm may already have built and
      // cached the same scene; keep the one that is in use.
      if (this.cache.has(id)) { scene.dispose(); return }
      scene.resize(this.width, this.height)
      this.remember(id, scene)
    } catch (error) {
      console.error(`deck: scene "${id}" failed to build`, error)
    }
  }

  /**
   * Put a scene on screen.
   *
   * Returns once the incoming scene is active, which is *before* any dissolve has
   * finished — the caller's DOM transition runs alongside the blend rather than
   * after it.
   */
  async show(
    id: string,
    framing: string | undefined,
    params: Record<string, string | number | boolean> | undefined,
    blend: 'ink' | 'none',
  ) {
    const mine = ++this.token

    // Same scene, different framing: this is the continuous camera move, and it
    // must not blend, capture or rebuild anything.
    if (this.active && this.active.id === id) {
      if (params) this.active.scene.setParams?.(params)
      this.active.scene.setFraming(framing, false)
      return
    }

    const factory = this.factories.get(id)
    if (!factory) {
      console.error(`deck: no scene registered as "${id}"`)
      return
    }

    let next = this.cache.get(id)
    if (!next) {
      // While the build runs the old scene keeps rendering, so a heavy scene
      // costs a beat of held frame rather than a black flash.
      try {
        next = await factory(this.context)
      } catch (error) {
        console.error(`deck: scene "${id}" failed to build`, error)
        return
      }
      if (mine !== this.token) {
        // Superseded. Keep it — it is built and correct, and the presenter is
        // very likely coming back to it — but do not activate it.
        if (this.cache.has(id)) next.dispose()
        else this.remember(id, next)
        return
      }
      this.remember(id, next)
    }
    if (mine !== this.token) return

    // Freeze the outgoing frame at the moment of the swap, not at the moment
    // `show` was called: between the two, a slow build may have been running and
    // the old scene has moved on.
    const wants = blend === 'ink' && this.active !== null
    if (wants) this.capture(this.captureFrom)

    next.resize(this.width, this.height)
    next.setParams?.(params ?? {})
    next.setFraming(framing, true)
    this.active = { id, scene: next }
    this.sceneElapsed = 0
    this.touch(id)
    this.blend = wants ? { elapsed: 0, duration: DISSOLVE_SECONDS } : null
  }

  /** Aim the ink wash. Set per slide-pair so consecutive washes differ. */
  setDissolveDirection(x: number, y: number) {
    this.dissolve.setDirection(x, y)
  }

  /** True while a GL dissolve is mid-flight. The presenter HUD reads it. */
  get isBlending() {
    return this.blend !== null
  }

  get memory() {
    return { ...this.renderer.info.memory, cached: this.cache.size }
  }

  /**
   * Everything the render budget is judged on, in one object.
   *
   * `info.reset()` runs at the top of each tick and the counters are filled by
   * that tick's draws, so reading between frames reports the frame just
   * finished rather than a partial one.
   */
  get stats() {
    return {
      scene: this.active?.id ?? null,
      frameMs: Number(this.frameMs.toFixed(2)),
      fps: this.frameMs > 0 ? Number((1000 / this.frameMs).toFixed(1)) : 0,
      blending: this.blend !== null,
      cached: this.cache.size,
      memory: { ...this.renderer.info.memory },
      render: { ...this.renderer.info.render },
      programs: this.renderer.info.programs?.length ?? 0,
    }
  }

  start() {
    if (this.running) return
    this.running = true
    this.previousTime = performance.now()
    this.frame = requestAnimationFrame(this.tick)
  }

  stop() {
    this.running = false
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  dispose() {
    this.stop()
    registerProbe('__deckStage', undefined)
    window.removeEventListener('resize', this.handleResize)
    window.removeEventListener('pointermove', this.handlePointer)
    for (const scene of this.cache.values()) scene.dispose()
    this.cache.clear()
    this.recent.length = 0
    this.active = null
    this.captureFrom.dispose()
    this.captureTo.dispose()
    this.dissolve.dispose()
    this.pass.dispose()
    this.renderer.dispose()
  }

  // ---------------------------------------------------------------- internals

  private measure() {
    return { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) }
  }

  private handleResize = () => {
    const { width, height } = this.measure()
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.context.width = width
    this.context.height = height
    this.renderer.setSize(width, height, false)
    this.pass.setSize(width, height)
    const ratio = this.renderer.getPixelRatio()
    this.captureFrom.setSize(Math.floor(width * ratio), Math.floor(height * ratio))
    this.captureTo.setSize(Math.floor(width * ratio), Math.floor(height * ratio))
    // Every cached scene, not only the visible one: an off-screen scene with a
    // stale aspect is a wrong first frame the moment it is shown.
    for (const scene of this.cache.values()) scene.resize(width, height)
  }

  private handlePointer = (event: PointerEvent) => {
    this.pointerTarget.x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1
    this.pointerTarget.y = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1
  }

  /** Render the active scene into a target rather than to the canvas. */
  private capture(target: THREE.WebGLRenderTarget) {
    if (!this.active) return
    this.renderer.setRenderTarget(target)
    this.pass.render(this.active.scene.scene, this.active.scene.camera)
    this.renderer.setRenderTarget(null)
  }

  private remember(id: string, scene: DeckScene) {
    this.cache.set(id, scene)
    this.touch(id)
    // Evict least-recently-used until the *cache* is inside its limit.
    //
    // This used to loop on `recent.length` and to `continue` past the scene on
    // screen — which had already been shifted off the front by then. So the
    // active scene was silently dropped out of the recency list while staying
    // in the cache: `recent` shrank, the loop exited, and from that moment the
    // two structures disagreed about what was cached. The scene on screen was
    // no longer tracked, so it could never be evicted afterwards, and every
    // subsequent walk of the deck left the cache one entry larger than the
    // limit it is supposed to enforce. The size that is actually being bounded
    // is the cache's, so that is what the condition now reads, and a scene that
    // cannot be evicted goes back on the end of the list instead of vanishing
    // from it. The guard bounds the pass at one lap, so an un-evictable entry
    // cannot spin.
    let guard = this.recent.length
    while (this.cache.size > CACHE_LIMIT && guard > 0) {
      guard -= 1
      const oldest = this.recent.shift()
      if (!oldest) break
      if (oldest === this.active?.id) {
        this.recent.push(oldest)
        continue
      }
      const evicted = this.cache.get(oldest)
      if (!evicted) continue
      this.cache.delete(oldest)
      evicted.dispose()
    }
  }

  private touch(id: string) {
    const at = this.recent.indexOf(id)
    if (at >= 0) this.recent.splice(at, 1)
    this.recent.push(id)
  }

  private tick = (now: number) => {
    if (!this.running) return
    this.frame = requestAnimationFrame(this.tick)

    // Clamped, because a tab that was backgrounded hands back a delta of
    // several seconds and every scene's motion would jump.
    const delta = Math.min(.05, Math.max(0, (now - this.previousTime) / 1000))
    this.previousTime = now
    this.sceneElapsed += delta

    // Accounted before anything can return early, so the telemetry hatch still
    // reports honest frame pacing on a slide where this renderer is idle
    // because an app scene is covering it.
    this.frameAccumulator += delta * 1000
    this.frameSamples += 1
    if (this.frameSamples >= 30) {
      this.frameMs = this.frameAccumulator / this.frameSamples
      this.frameAccumulator = 0
      this.frameSamples = 0
    }

    // Parallax is smoothed rather than followed: a camera pinned to the pointer
    // is nauseating on a large panel, and the presenter's mouse is not part of
    // the composition.
    const ease = 1 - Math.pow(.0015, delta)
    this.context.pointer.x += (this.pointerTarget.x - this.context.pointer.x) * ease
    this.context.pointer.y += (this.pointerTarget.y - this.context.pointer.y) * ease

    const active = this.active
    if (!active) return

    this.renderer.info.reset()
    // `update` runs whether or not the frame is drawn: it is CPU-side camera
    // tweening and behaviour, it costs almost nothing, and a scene that had
    // been paused would jump when it was uncovered.
    active.scene.update(delta, this.sceneElapsed)

    // Covered by an app scene. Nothing this renderer produces can be seen, and
    // producing it costs the frame the visible renderer needed. See
    // `occlusion.ts`.
    if (isStageOccluded() && !this.blend) return

    if (this.blend) {
      this.blend.elapsed += delta
      const progress = Math.min(1, this.blend.elapsed / this.blend.duration)
      this.capture(this.captureTo)
      this.dissolve.render(
        this.renderer,
        this.captureFrom.texture,
        this.captureTo.texture,
        // Eased rather than linear: a wash that starts and stops at a constant
        // rate reads as a wipe, and the point of the ink field is that the front
        // decelerates as it runs out of paper.
        progress * progress * (3 - 2 * progress),
        this.width / Math.max(1, this.height),
      )
      if (progress >= 1) this.blend = null
    } else {
      this.pass.render(active.scene.scene, active.scene.camera)
    }
  }
}
