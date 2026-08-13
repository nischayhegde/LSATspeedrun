import type * as THREE from 'three'

/**
 * What the stage hands a scene when it is built.
 *
 * A scene never owns a renderer. There is exactly one `WebGLRenderer` and one
 * canvas for the whole deck (`stage.ts`), because losing the WebGL context
 * mid-presentation is the failure mode this deck is designed against and every
 * additional context is another chance to hit the browser's limit. A scene owns
 * its `THREE.Scene`, its camera, and everything it puts in them — and nothing
 * else.
 */
export type SceneContext = {
  renderer: THREE.WebGLRenderer
  width: number
  height: number
  /** `prefers-reduced-motion`. Pass it to `HumanoidActor`, never gate `update`. */
  reduced: boolean
  /**
   * Smoothed pointer position in -1..1, mutated in place by the stage.
   *
   * Handed over as a live reference rather than a value so a scene can hold it
   * and read it per frame. This is the deck's parallax input: every scene
   * offsets its camera by a few hundredths of it, which is enough to make a
   * static slide feel like a held shot rather than a photograph.
   */
  pointer: { x: number; y: number }
  /**
   * This frame's `requestAnimationFrame` timestamp, in milliseconds, mutated in
   * place by the stage each tick.
   *
   * For anything whose position a viewer can see travelling, prefer this over
   * calling `performance.now()` inside `update`. They share an origin, so both
   * stay in step with the WAAPI and `setTimeout` clocks the DOM half of a
   * transition runs on — but this one is sampled once, at the frame boundary,
   * and is therefore evenly spaced. `performance.now()` read mid-update returns
   * the moment the call happened, which floats by however long the rest of the
   * frame took: a millisecond of that on a body crossing the screen in two
   * seconds is a pixel of shudder, every frame, in whichever direction the
   * scheduler happened to be late.
   */
  frameTime: number
}

export type DeckScene = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  /**
   * Advance by `delta` seconds. `elapsed` is seconds since this scene was
   * built, not since the deck started, so a scene's own motion is reproducible.
   */
  update(delta: number, elapsed: number): void
  resize(width: number, height: number): void
  /**
   * Aim the camera at a named framing.
   *
   * `immediate` is the difference between a cut and a move: when two
   * consecutive slides name the same scene, the deck calls this with
   * `immediate: false` and the scene tweens, which is the continuous camera
   * move that carries the office → map sequence. When a scene is first shown it
   * is called with `immediate: true` so the first frame is already composed.
   *
   * An unrecognised framing must be ignored rather than throw: the registry and
   * the scene are edited by different hands.
   */
  setFraming(name: string | undefined, immediate: boolean): void
  /** Free parameters from the slide registry, re-applied on every show. */
  setParams?(params: Record<string, string | number | boolean>): void
  /**
   * Overrides for the shared illustrated pass while this scene is on screen.
   * Counsel-stage sets flatten/grain to 0 so the Luxo key actually models
   * the figure instead of being quantized into paint bands.
   */
  grade?: {
    inkStrength?: number
    bands?: number
    flatten?: number
    grain?: number
    saturation?: number
  }
  /**
   * Release every geometry, material and texture the scene created.
   *
   * Called on eviction from the stage's cache. Anything flagged
   * `userData.characterShared` belongs to the app art's module-level caches and
   * must be left alone — see `office-three.tsx`'s `constantGeometry`.
   */
  dispose(): void
}

export type SceneFactory = (context: SceneContext) => DeckScene | Promise<DeckScene>
