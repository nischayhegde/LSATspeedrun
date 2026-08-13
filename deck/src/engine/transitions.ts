import type { TransitionKind } from '../slides/types'
import { BURNOUT_REVEAL_FROM, BURNOUT_REVEAL_MID, BURNOUT_REVEAL_MS, BURNOUT_REVEAL_TO } from '../scenes/burnout-reveal'
import { COUNSEL_PULL_FROM, COUNSEL_PULL_MID, COUNSEL_PULL_MS, COUNSEL_PULL_PARK, COUNSEL_PULL_TO, snapCounselSlide } from '../scenes/counsel-pull'

/**
 * The transition system.
 *
 * ## The contract, and why it is shaped like this
 *
 * A transition is handed the outgoing and incoming slide layers — both are in the
 * document at once, stacked — plus an overlay host it may draw cinematic
 * furniture into, and it returns two things: a promise that resolves when it is
 * over, and a `finish()` that ends it *now*.
 *
 * `finish()` is the whole answer to the requirement that rapid arrow-key mashing
 * must not desync or leak. The runtime never runs two transitions at once: when a
 * navigation arrives mid-transition it calls `finish()` on the one in flight,
 * which jumps every animation to its end state synchronously, commits that slide,
 * and only then starts the next. So the deck can be driven arbitrarily fast and
 * the invariant "the DOM shows the slide the URL says" always holds after each
 * keystroke. Nothing accumulates, because the overlay furniture is created by the
 * transition and removed in its own `finally`.
 *
 * Everything here animates through the Web Animations API rather than CSS classes
 * plus `transitionend`, for exactly that reason: a WAAPI `Animation` can be
 * finished, cancelled and inspected, and a CSS class transition cannot.
 *
 * ## What is animated
 *
 * Only `transform`, `opacity`, `filter`, `clip-path` and `font-variation-settings`.
 * The first two stay on the compositor. `filter` and `clip-path` do not, and are
 * used sparingly and never on a full-screen element for long. Nothing animates
 * layout, and nothing uses `mix-blend-mode` — the app measured a fixed
 * full-viewport blended layer at double the frame time and took it out, and a
 * deck has the same geometry.
 */

export type TransitionContext = {
  /** The slide leaving. Null on the first slide. */
  from: HTMLElement | null
  /** The slide arriving. Always present. */
  to: HTMLElement
  /** 1 when moving forward through the deck, -1 backward. */
  direction: 1 | -1
  /** Host for letterbox bars, foil plates and washes. Emptied by each transition. */
  overlay: HTMLElement
  reduced: boolean
  /**
   * Called at the point the incoming slide is the one on screen — i.e. halfway
   * through a letterbox, at the start of a dissolve. The runtime uses it to
   * release the outgoing app-scene mount, so a heavy WebGL scene is torn down at
   * the moment it stops being visible rather than before or long after.
   */
  onMidpoint?: () => void
}

export type RunningTransition = {
  done: Promise<void>
  /** End immediately, leaving every element in its final state. */
  finish: () => void
}

/** How long each kind takes, in milliseconds. Read by the presenter HUD. */
export const TRANSITION_MS: Record<TransitionKind, number> = {
  cut: 460,
  'ink-bleed': 900,
  letterbox: 1240,
  camera: 1100,
  'foil-seal': 1180,
}

/**
 * Collects every animation a transition starts, so the set can be finished as a
 * unit.
 *
 * `fill: 'both'` on everything is deliberate and load-bearing: a finished
 * animation without a fill snaps back to the element's own style, which for an
 * incoming slide means invisible. With the fill, `finish()` genuinely leaves the
 * end state on screen.
 */
/**
 * WHY ALMOST NOTHING IN THIS FILE PASSES `easing` IN THE OPTIONS.
 *
 * A timing function in `KeyframeAnimationOptions` is not "the easing between
 * the keyframes". It is applied to the iteration progress *before* the
 * keyframes are consulted, so it moves every offset in the list. Under
 * `cubic-bezier(.22,1,.36,1)` — the deck's house ease-out, and the one that was
 * on four of these kernels — the timeline is already 72% spent a fifth of the
 * way through, which means a keyframe written at `offset: .33` actually
 * happens at 0.1 and a hold written as "stay invisible for the first third"
 * lasts a fourteenth.
 *
 * That is not a rounding error, and it had eaten the two transitions whose
 * whole job is to hide a swap:
 *
 *   - `letterbox` says in its own comment that "the incoming slide is hidden
 *     until the shutter is shut, so nothing of the swap is ever visible". The
 *     bars close on `steps()`, which is honest linear time, while the incoming
 *     slide came up on the remapped clock — so it was fully opaque a fifth of
 *     the way in, with the bars only three fifths closed and the outgoing slide
 *     still at full opacity underneath it. Which of the two you saw depended on
 *     which of the deck's two layer elements happened to be holding it, because
 *     they alternate and their DOM order does not.
 *   - `foil-seal` is the same shape: the plate that the swap is supposed to
 *     happen behind reaches full at 44% of the move, and the incoming slide was
 *     arriving at 10%. It is the transition into `close-one-stop-shop`, held
 *     for the whole of the Q&A.
 *
 * So the rule here is: the effect-level easing stays `linear` — `play` already
 * defaults it — and a curve goes on the keyframe that *starts* the interval it
 * is meant to shape. Two-keyframe animations are unaffected either way and are
 * left alone, since for those the two spellings mean the same thing.
 */
class Batch {
  private readonly animations: Animation[] = []
  private readonly cleanups: Array<() => void> = []
  /** Pending `after` callbacks, so `finish()` can flush them. See `after`. */
  private readonly deferrals: Array<() => void> = []

  /**
   * Take an element over, discarding whatever an earlier transition left on it.
   *
   * THE BUG THIS EXISTS TO KILL, and it is the one the founder photographed.
   *
   * `fill: 'both'` is required for `finish()` to leave an end state on screen,
   * and its cost is that a finished animation keeps writing its last keyframe
   * *for ever*, from the animation origin, which outranks the stylesheet. The
   * runtime pools two slide layer elements and alternates them, and it only
   * unmounts the outgoing one when a transition is allowed to run to
   * completion. Interrupt one — which is what fast navigation does, and
   * `finish()` is the deck's whole answer to it — and the element survives
   * carrying every animation every previous transition ever started on it.
   *
   * Per property, the animation started last wins. So a kernel that does not
   * mention a property inherits it from a transition two slides ago, and
   * `price-curtain` did not mention `opacity` on either side. Walk the deck at
   * speed and `turn-nothing-to-teach` arrives holding `opacity: 0` from the
   * `camera` move that took slide 3 *off* the screen — no longer animating,
   * nothing left to finish, permanently invisible, with the bare WebGL stage
   * showing through it. Measured: three arrow presses 120ms apart from the
   * title, and the slide settles at `opacity: 0` with `field="beige"`.
   *
   * It cannot be fixed only by making every kernel declare every property,
   * because that is a rule nobody can enforce and the next kernel breaks it
   * again. So each transition claims the two layers it is about to move and
   * starts from the stylesheet: a live layer is `opacity: 1`, an outgoing one
   * is `opacity: 0`, and anything else on the element was somebody else's.
   *
   * Called synchronously in the same task as the kernel's own `play` calls, so
   * no frame is ever composited in the interval — the outgoing layer does not
   * flash away between losing its old animation and being given its new one.
   *
   * CSS animations and transitions are left alone. They belong to the slide's
   * own entrance, they are declared in a stylesheet this file does not own, and
   * cancelling one would be reaching across that boundary.
   */
  claim(element: Element | null) {
    if (!element) return
    for (const animation of element.getAnimations()) {
      const kind = animation.constructor?.name
      if (kind === 'CSSAnimation' || kind === 'CSSTransition') continue
      animation.cancel()
    }
  }

  play(
    element: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    const animation = element.animate(keyframes, { fill: 'both', easing: 'linear', ...options })
    this.animations.push(animation)
    return animation
  }

  /**
   * As `play`, but the animation is torn off the element once the batch settles.
   *
   * `fill: 'both'` is right for a slide layer, which the runtime unmounts, and
   * wrong for anything that outlives the transition — because a filled animation
   * keeps writing its last keyframe from the animation origin, which outranks
   * inline style and cannot be overridden by the component that owns the
   * element.
   *
   * That cost a measured 40ms a frame. The `camera` kernel leaves the outgoing
   * app scene at `scale(1.34)`; the scene layer then reuses that same element as
   * a parked warm slot and sets `transform: translateY(-200vh)` on it inline to
   * take it out of the viewport, which is what makes the office's own
   * `IntersectionObserver` stop its render loop. The filled `scale` won, the
   * element never left the viewport, and the office next door went on drawing
   * 363 calls and 272,000 triangles a frame — 21fps on the slide after the
   * office, in both directions of travel, for a room nobody could see.
   */
  playTransient(
    element: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    const animation = this.play(element, keyframes, options)
    this.onCleanup(() => animation.cancel())
    return animation
  }

  onCleanup(fn: () => void) {
    this.cleanups.push(fn)
  }

  /**
   * Run `fn` once, `ms` from now — or immediately, if the transition is
   * finished early.
   *
   * THE BUG THIS EXISTS TO KILL. Five kernels — `letterbox`, `camera`,
   * `foil-seal`, `exposure-blowout` and `price-curtain` — cannot call
   * `onMidpoint` synchronously, because their midpoint is a real moment part
   * way through: the instant the shutter is shut, or the foil plate is opaque,
   * and the outgoing scene can be released behind it. All five reached for a
   * bare `window.setTimeout`, which is the one thing in this file that
   * `finish()` could not reach.
   *
   * `finish()` is the deck's whole answer to fast navigation: it jumps every
   * animation to its end and commits, synchronously, so the next move can
   * start. A bare timer survives that. It then fires somewhere inside the
   * *next* transition, and what it runs is `setAppScenes(computeAppScenes(
   * index, null))` against an `index` captured when it was scheduled — so a
   * superseded navigation reaches forward and rewrites the app-scene set of a
   * slide that is already on screen. Either the scene the current slide needs
   * is torn down, or one it does not need is left mounted with its own
   * `WebGLRenderer` running.
   *
   * `camera` defers by 880ms, which is longer than four of the six kernels
   * take end to end, and `camera` is the transition between the demo slides.
   * A presenter walking out of the demos at any speed above deliberate is
   * therefore *routinely* landing stale timers on the slides after them — and
   * the last of those is `close-one-stop-shop`, which is entered on `foil-seal`
   * and then held for the entire Q&A. That is the "incredibly glitchy" closing
   * slide, and it is why holding it still measured clean: nothing is wrong
   * inside `close-room-scene.ts`, the damage is done to it on arrival by a timer
   * belonging to a slide the room has already left.
   *
   * Finishing early runs the callback rather than dropping it, which is the
   * only correct reading of `finish()`: it means "we are at the end state
   * now", and the midpoint is behind the end. Dropping it would leak the
   * outgoing scene instead, which is the same failure with a longer fuse.
   */
  after(ms: number, fn: () => void) {
    let ran = false
    const run = () => {
      if (ran) return
      ran = true
      fn()
    }
    const timer = window.setTimeout(run, ms)
    this.deferrals.push(run)
    this.onCleanup(() => {
      window.clearTimeout(timer)
      run()
    })
  }

  /**
   * Resolves when every animation has finished or been cancelled.
   *
   * A cancelled animation rejects, which is normal rather than exceptional here,
   * so the rejections are swallowed. What must not happen is one animation's
   * cancellation leaving the whole transition's promise pending for ever.
   */
  async settle() {
    try {
      await Promise.all(this.animations.map((animation) => animation.finished.catch(() => undefined)))
    } finally {
      for (const cleanup of this.cleanups) cleanup()
    }
  }

  finish() {
    // Midpoints first, and before the animations are jumped: a midpoint
    // releases the outgoing scene, and it has to have happened by the time the
    // caller's next line sets up the move that follows. `run` is idempotent,
    // so the timer firing later is a no-op.
    for (const deferral of this.deferrals) deferral()
    for (const animation of this.animations) {
      // `finish()` throws on an animation with an infinite duration; none here
      // has one, but a transition that throws on stage is worse than one that
      // ends abruptly.
      try { animation.finish() } catch { animation.cancel() }
    }
  }
}

type Kernel = (context: TransitionContext, batch: Batch) => void | Promise<void>

/** Wraps a kernel into the runtime's contract. */
function build(context: TransitionContext, kernel: Kernel): RunningTransition {
  const batch = new Batch()
  // The two pooled layer elements, before anything is asked of them. See
  // `Batch.claim` — this is what stops one transition's filled end state from
  // deciding what a later slide looks like.
  batch.claim(context.from)
  batch.claim(context.to)
  const started = Promise.resolve(kernel(context, batch)).then(() => batch.settle())
  return {
    done: started,
    finish: () => batch.finish(),
  }
}

/** A bare div in the overlay host, removed when the transition ends. */
function overlayLayer(batch: Batch, overlay: HTMLElement, className: string) {
  const element = document.createElement('div')
  element.className = className
  overlay.append(element)
  batch.onCleanup(() => element.remove())
  return element
}

// ---------------------------------------------------------------------------
// 1 — CUT. The floor: a short push-dissolve for beats that should not announce
// themselves. Every other transition here is a decision; this one is the absence
// of one, and a deck where every slide arrives with a flourish has no flourishes.
//
// ## Why the outgoing slide is held opaque instead of cross-fading
//
// Two slides at opacity .5 do not add up to one opaque slide: they add up to
// .75 of one, and the missing quarter is the WebGL stage, which on the copy
// slides is a near-black room. Measured across the deck's eight cuts, the
// midpoint of every one of them let 4-6% of the stage through — a short dark
// dip in the middle of a beige-to-beige beat, on the transition that is
// specifically supposed to be the one nobody notices.
//
// So the outgoing field stays at full opacity until the incoming one has
// finished arriving over the top of it, and only then goes. Optically this is
// the same dissolve — the eye is watching the incoming slide resolve — and the
// sum of the two coverages never drops below one. It costs nothing: the frames
// where both are opaque are frames where the lower one cannot be seen.
// ---------------------------------------------------------------------------
const cut: Kernel = ({ from, to, direction, onMidpoint }, batch) => {
  const shift = 16 * direction
  if (from) {
    batch.play(from, [
      { opacity: 1, transform: 'translate3d(0,0,0)' },
      { opacity: 0, transform: `translate3d(${-shift}px,0,0)` },
    ], { duration: TRANSITION_MS.cut, easing: 'cubic-bezier(.22,1,.36,1)' })
  }
  batch.play(to, [
    { opacity: 0, transform: `translate3d(${shift}px,0,0)` },
    { opacity: 1, transform: 'translate3d(0,0,0)' },
  ], { duration: TRANSITION_MS.cut, easing: 'cubic-bezier(.22,1,.36,1)' })
  onMidpoint?.()
}

// ---------------------------------------------------------------------------
// 2 — INK BLEED. The GL half of this runs on the stage (`ink-dissolve.ts`), which
// dissolves the outgoing 3D frame into the incoming one through a paper-grain
// noise field. This is the DOM half: the copy layers cross-dissolve with a short
// defocus, and a wash of ink sweeps across the whole screen in front of them so
// the two halves read as one event.
// ---------------------------------------------------------------------------
const inkBleed: Kernel = ({ from, to, direction, overlay, onMidpoint }, batch) => {
  const duration = TRANSITION_MS['ink-bleed']

  const wash = overlayLayer(batch, overlay, 'tx-wash')
  // A wide skewed gradient travelling across the screen. Transform-only, so the
  // one full-screen element in this transition stays on the compositor.
  batch.play(wash, [
    { transform: `translate3d(${direction > 0 ? -140 : 140}%,0,0) skewX(-9deg)`, opacity: 0 },
    { transform: 'translate3d(0,0,0) skewX(-9deg)', opacity: 1, offset: .45 },
    { transform: `translate3d(${direction > 0 ? 140 : -140}%,0,0) skewX(-9deg)`, opacity: 0 },
  ], { duration, easing: 'cubic-bezier(.45,.05,.55,.95)' })

  // Held opaque under the arrival for the same reason as in `cut`: two
  // half-transparent fields are not one field. The defocus still runs, so the
  // outgoing copy still softens as it goes — what changed is that it does not
  // take the field with it before the incoming one has laid a new one down.
  if (from) {
    batch.play(from, [
      { opacity: 1, filter: 'blur(0px) saturate(1)' },
      { opacity: 1, filter: 'blur(7px) saturate(.4)', offset: .62, easing: 'cubic-bezier(.55,0,1,.45)' },
      { opacity: 0, filter: 'blur(9px) saturate(.35)', offset: .76 },
      { opacity: 0, filter: 'blur(9px) saturate(.35)' },
    ], { duration })
  }
  batch.play(to, [
    { opacity: 0, filter: 'blur(9px) saturate(.5)', transform: 'scale(1.014)' },
    { opacity: 0, filter: 'blur(9px) saturate(.5)', transform: 'scale(1.014)', offset: .22, easing: 'cubic-bezier(.22,1,.36,1)' },
    { opacity: 1, filter: 'blur(0px) saturate(1)', transform: 'scale(1.002)', offset: .6, easing: 'cubic-bezier(.22,1,.36,1)' },
    { opacity: 1, filter: 'blur(0px) saturate(1)', transform: 'scale(1)' },
  ], { duration })

  onMidpoint?.()
}

// ---------------------------------------------------------------------------
// 3 — LETTERBOX. The act break, and a direct reuse of the app's own cinematic
// idiom: `.cutscene-overlay` is a fixed full-screen grid with 42px bars top and
// bottom over `#05080d`, animated in with `cinema-in .45s steps(6)`. The deck
// takes the same bars and the same `steps()` easing and closes them all the way,
// which turns a slide change into a scene change.
//
// `steps(6)` matters more than it looks. A smoothly interpolated black bar is a
// UI animation; a bar that arrives in six discrete jumps is a shutter, and it is
// the single cheapest thing in the deck that makes a transition feel authored
// rather than generated.
// ---------------------------------------------------------------------------
const letterbox: Kernel = async ({ from, to, overlay, onMidpoint }, batch) => {
  const total = TRANSITION_MS.letterbox
  const close = total * .34
  const hold = total * .16
  const open = total - close - hold

  const shutter = overlayLayer(batch, overlay, 'tx-letterbox')
  const top = document.createElement('i')
  const bottom = document.createElement('i')
  const slug = document.createElement('b')
  slug.textContent = to.dataset.actLabel ?? ''
  shutter.append(top, bottom, slug)

  const bars = [top, bottom]
  for (const bar of bars) {
    batch.play(bar, [{ height: '0vh' }, { height: '50.2vh' }], {
      duration: close,
      // The app's own easing for this exact furniture.
      easing: 'steps(6, end)',
    })
    batch.play(bar, [{ height: '50.2vh' }, { height: '0vh' }], {
      duration: open,
      delay: close + hold,
      easing: 'steps(7, end)',
    })
  }
  // The act slug lives in the black, which is the only moment in the deck where
  // there is room for a line of type at the size an act title wants.
  batch.play(slug, [
    { opacity: 0, letterSpacing: '.5em', easing: 'ease-out' },
    { opacity: 1, letterSpacing: '.28em', offset: .5, easing: 'ease-out' },
    { opacity: 1, letterSpacing: '.26em', offset: .78, easing: 'ease-out' },
    { opacity: 0, letterSpacing: '.2em' },
  ], { duration: close + hold + open * .6, delay: close * .55 })

  if (from) {
    batch.play(from, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.03)', offset: .34 },
      { opacity: 0, transform: 'scale(1.03)', offset: .35 },
      { opacity: 0, transform: 'scale(1.03)' },
    ], { duration: total, easing: 'linear' })
  }
  // The incoming slide is hidden until the shutter is shut, then pushed in behind
  // it, so nothing of the swap is ever visible. `.33` is just past `close`, which
  // is `.34` of the total — see the note on `Batch` for why the offsets in this
  // list only started being true when the effect-level easing came off.
  batch.play(to, [
    { opacity: 0, transform: 'scale(1.04)' },
    { opacity: 0, transform: 'scale(1.04)', offset: .33, easing: 'cubic-bezier(.22,1,.36,1)' },
    { opacity: 1, transform: 'scale(1.02)', offset: .52, easing: 'cubic-bezier(.22,1,.36,1)' },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: total })

  // The outgoing scene is released inside the black.
  batch.after(close, () => onMidpoint?.())
}

// ---------------------------------------------------------------------------
// 4 — CAMERA. Two consecutive slides sharing one 3D scene, with the camera flying
// between framings. The stage does the real work — see `CameraRig` in
// `scene-kit.ts` — and this DOM half exists only to get the copy out of the way
// of the move and to hand the move a matched push.
//
// The office → map beat is the one case where the two scenes are the ported app
// components, which own a `WebGLRenderer` each and cannot share a camera. There,
// both canvases are mounted for the duration of this transition and given a
// matched dolly: the outgoing office pushes forward and past the frame while the
// incoming map settles back from slightly over-scale, which is optically the same
// move a single camera flying out through a window would make. It costs a second
// WebGL context for roughly a second. That trade, and why it is not one camera in
// one scene, is written up in `README.md`.
// ---------------------------------------------------------------------------
const camera: Kernel = ({ from, to, direction, onMidpoint }, batch) => {
  const total = TRANSITION_MS.camera
  // A short rise, not a 3D dolly. Perspective + translateZ on the slide, and
  // scale on the ported WebGL canvases, read as an accidental cutaway of the
  // office or map rather than as a slide change.
  if (from) {
    batch.play(from, [
      { opacity: 1, transform: 'translate3d(0,0,0)' },
      { opacity: 0, transform: `translate3d(0,${10 * direction}px,0)` },
    ], { duration: total * .62, easing: 'ease-in' })
  }
  batch.play(to, [
    { opacity: 0, transform: `translate3d(0,${-12 * direction}px,0)` },
    { opacity: 1, transform: 'translate3d(0,0,0)' },
  ], { duration: total * .78, delay: total * .12, easing: 'ease-out' })

  const outgoing = document.querySelector<HTMLElement>('.deck-appscene[data-role="outgoing"]')
  const incoming = document.querySelector<HTMLElement>('.deck-appscene[data-role="current"]')
  if (outgoing) {
    batch.playTransient(outgoing, [
      { opacity: 1 },
      { opacity: 0 },
    ], { duration: total * .62, easing: 'ease-in' })
  }
  if (incoming) {
    batch.playTransient(incoming, [
      { opacity: outgoing ? 0 : 1 },
      { opacity: 1 },
    ], { duration: total * .78, delay: total * .12, easing: 'ease-out' })
  }

  batch.after(total * .55, () => onMidpoint?.())
}

// ---------------------------------------------------------------------------
// FOIL SEAL. The scales-of-justice mark as an animated gold-foil mask.
//
// The mark grows from the centre of the screen as an actual scaled SVG of the
// product's favicon path — so what the audience sees expanding is the logo, in
// foil, not an abstract shape. A glyph made of 4px strokes can never cover a
// screen however large it gets, so a solid foil plate fades in underneath it once
// the mark is big enough for the two to be indistinguishable, the swap happens
// behind the plate, and the plate then lifts away.
// ---------------------------------------------------------------------------
const SEAL_PATH = 'M32 14v34M20 22h24M17 22 10 36h14L17 22Zm30 0-7 14h14l-7-14ZM23 49h18'

const foilSeal: Kernel = ({ from, to, overlay, onMidpoint }, batch) => {
  const total = TRANSITION_MS['foil-seal']
  const cover = total * .44

  const host = overlayLayer(batch, overlay, 'tx-seal')
  host.innerHTML = `
    <div class="tx-seal-plate"></div>
    <svg class="tx-seal-mark" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="none" stroke="#c89b4b" stroke-width="2.2"/>
      <path d="${SEAL_PATH}" fill="none" stroke="#f5e8c8" stroke-width="4"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `
  const plate = host.querySelector<HTMLElement>('.tx-seal-plate')!
  const mark = host.querySelector<SVGElement>('.tx-seal-mark')!

  // A quarter turn as it grows, so the mark is clearly being struck rather than
  // simply zoomed.
  batch.play(mark, [
    { transform: 'translate(-50%,-50%) scale(.02) rotate(-24deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(.5) rotate(-6deg)', opacity: 1, offset: .3 },
    { transform: 'translate(-50%,-50%) scale(6) rotate(2deg)', opacity: 1, offset: .62 },
    { transform: 'translate(-50%,-50%) scale(22) rotate(4deg)', opacity: 0 },
  ], { duration: total, easing: 'cubic-bezier(.5,0,.4,1)' })

  batch.play(plate, [
    { opacity: 0, transform: 'scale(1.06)' },
    { opacity: 0, transform: 'scale(1.04)', offset: .24 },
    { opacity: 1, transform: 'scale(1)', offset: .44 },
    { opacity: 1, transform: 'scale(1)', offset: .58 },
    { opacity: 0, transform: 'scale(1.08)' },
  ], { duration: total, easing: 'cubic-bezier(.4,0,.5,1)' })

  if (from) {
    batch.play(from, [
      { opacity: 1 },
      { opacity: 1, offset: .42 },
      { opacity: 0, offset: .46 },
      { opacity: 0 },
    ], { duration: total, easing: 'linear' })
  }
  // `.44` is `cover`, the point the plate is opaque. The swap has to be behind
  // it; see the note on `Batch` for why it was in front of it until now.
  batch.play(to, [
    { opacity: 0, transform: 'scale(1.03)' },
    { opacity: 0, transform: 'scale(1.03)', offset: .44, easing: 'cubic-bezier(.22,1,.36,1)' },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: total })

  batch.after(cover, () => onMidpoint?.())
}

// ===========================================================================
// OBJECT MORPHS
//
// Everything above this line is an *idiom*: a way for one slide to become
// another that knows nothing about what is on either. `NARRATIVE.md` does not
// specify idioms. It specifies moves, and each one is a claim about a
// particular object surviving a slide change:
//
//   "The tall real-LSAT bar rotates flat and becomes the horizontal hours bar
//    that slide 3 fills in."
//   "The extruded `0.22` rotates edge-on until it is a single vertical line,
//    and that line becomes the progress track of the speedrun timer."
//   "The unfinished outer ring snaps closed and becomes the border of the
//    live app iframe."
//
// A dissolve between two slides that each contain a bar is not that. The
// audience has to watch one object *go somewhere*, which means the transition
// has to know where it started and where it is going. So this layer sits over
// the six kernels: before the kernel runs, the deck looks for a pair of
// endpoints — one in the outgoing slide, one in the incoming one — and if it
// finds them, flies a stand-in between their two boxes while the kernel
// carries everything else.
//
// ## Why endpoints are found by selector rather than by slide
//
// The obvious design is a table from slide id to move. This layer is keyed on
// the *objects* instead, and that is deliberate on two counts. The transition
// system is not given slide ids and the element that carries them is owned by
// another part of the app, so a table would need a new contract to exist at
// all. More importantly, a move like "the tall bar becomes the hours bar" is
// true of those two figures wherever they are put: reorder the deck and the
// morph follows the figures, because what it is attached to is the pair of
// things, not the pair of positions. A morph whose endpoints are not both on
// screen simply does not run, and the kernel underneath is already a complete
// transition on its own.
//
// ## Why a stand-in and not the element
//
// The real element cannot fly: it is inside a slide layer that the kernel is
// concurrently fading, scaling and, for the letterbox, hiding behind black.
// Reparenting it would take it out of the layout its own slide is still using.
// So the morph builds a plain box in the overlay, gives it the source's
// colour and radius, and animates that between the two measured rects, hiding
// the source immediately and revealing the target as the box lands. For every
// move the narrative asks for, the object in flight *is* a rectangle — a bar,
// a track, a ring's bounding box, a card outline — so a stand-in is not an
// approximation of the object. It is the object with its contents left behind,
// which is exactly what the audience is being asked to follow.
// ===========================================================================

type MorphSpec = {
  /** For the record, and for the debug attribute on the flying box. */
  id: string
  /** The object as it exists on the outgoing slide. */
  from: string
  /** Where it lands on the incoming slide. */
  to: string
  /**
   * Where to *measure* the landing, when the target cannot be measured yet.
   *
   * A figure on the incoming slide is at phase zero for the length of the
   * transition — that is the whole point of the phase system, and it is why the
   * bar on slide 3 draws itself after the audience has arrived rather than
   * before. But a bar at phase zero is `width: 0`, and a flight to a zero-width
   * rectangle reads as the object being deleted, so `runMorph` refuses it. The
   * morph that was supposed to carry slide 2's bar into slide 3's simply never
   * ran, silently, for exactly this reason.
   *
   * The fix is to separate the two questions the target was answering. What
   * gets revealed at the end is still `to`; where the box flies to is this —
   * the track the fill will grow along, which is laid out at full size from the
   * first frame because nothing about it is animated.
   */
  land?: string
  /**
   * Extra rotation, in degrees, at the midpoint of the flight.
   *
   * `x` tips the object forward like a plank being laid down; `y` turns it
   * edge-on. Both return to zero at the destination, so the object arrives
   * square whatever it did on the way.
   */
  turn?: { x?: number; y?: number }
  /** Fraction of the transition the flight occupies. */
  span?: number
  /** Painted as a hollow outline rather than a solid. */
  outline?: boolean
}

/**
 * The moves, in deck order. Each one is the sentence from `NARRATIVE.md` that
 * asked for it.
 */
const MORPHS: readonly MorphSpec[] = [
  {
    // 2 → 3. The tall real-LSAT bar becomes the horizontal hours bar.
    // A 2D box map, not a plank rotating in X — the 3D tip read as a
    // flourish rather than as one measurement changing frame.
    id: 'bar-lays-flat',
    from: '.fig-bp-row[data-stub="false"] .fig-bp-run',
    to: '.fig-hb-fill',
    land: '.fig-hb-bar',
    span: .82,
  },
  {
    // 4 → 5. The hero numeral becomes the timer track. Scale and position
    // only — rotating the extrusion edge-on was the 3D-numeral move that
    // read as a cutaway rather than as a slide change.
    id: 'numeral-goes-edge-on',
    from: '.fig-num [data-morph="numeral"]',
    to: '[data-morph="timer-track"]',
    span: .9,
  },
  {
    // 5 → 6. "The route line's endpoint expands into the outline of a question
    // card, which is the frame slide 6 fills in." An outline, because what
    // survives is the border and not the fill.
    id: 'endpoint-becomes-card',
    from: '.fig-rt-node[data-taken="true"] .fig-rt-ring',
    to: '.fig-rc-card',
    outline: true,
    span: .86,
  },
  {
    // 11 → 12. "The unfinished outer ring snaps closed and becomes the border
    // of the live app iframe." Snaps, so it takes less of the transition than
    // the others and lands before the shutter opens.
    id: 'ring-becomes-frame',
    from: '.fig-cr-outer-frame',
    to: '.demo-chrome',
    outline: true,
    span: .62,
  },
]

/**
 * Runs whichever morph both slides can support, if any.
 *
 * Returns nothing and throws nothing when no pair matches, which is the common
 * case: most transitions in the deck are a kernel and no more.
 */
function runMorph(context: TransitionContext, batch: Batch, duration: number) {
  const { from, to, overlay, reduced } = context
  if (!from || reduced) return

  const found = MORPHS
    .map((spec) => ({
      spec,
      source: from.querySelector<HTMLElement>(spec.from),
      target: to.querySelector<HTMLElement>(spec.to),
      landing: spec.land ? to.querySelector<HTMLElement>(spec.land) : null,
    }))
    .find((match) => match.source && match.target && (!match.spec.land || match.landing))
  if (!found?.source || !found?.target) return

  const { spec, source, target, landing } = found
  const host = overlay.getBoundingClientRect()
  const start = source.getBoundingClientRect()
  const end = (landing ?? target).getBoundingClientRect()
  // A zero-area endpoint means the figure has not laid out yet — the incoming
  // slide is in the document but its figure may still be at phase 0. Flying to
  // a point would read as the object being deleted, which is worse than not
  // flying at all.
  if (start.width < 1 || start.height < 1 || end.width < 1 || end.height < 1) return

  const style = getComputedStyle(source)
  const box = document.createElement('div')
  box.className = 'tx-morph'
  box.dataset.morph = spec.id
  const inner = document.createElement('i')
  box.append(inner)
  overlay.append(box)
  batch.onCleanup(() => box.remove())

  box.style.left = `${start.left - host.left}px`
  box.style.top = `${start.top - host.top}px`
  box.style.width = `${start.width}px`
  box.style.height = `${start.height}px`
  box.style.borderRadius = style.borderRadius
  if (spec.outline) {
    inner.style.border = `2px solid ${style.borderTopColor === 'rgba(0, 0, 0, 0)' ? style.color : style.borderTopColor}`
  } else {
    // `backgroundColor` is `transparent` on every bar in the deck, which paints
    // itself with `background: currentColor`; the colour is the honest read.
    const painted = style.backgroundColor
    inner.style.background = painted === 'rgba(0, 0, 0, 0)' ? style.color : painted
  }

  const span = duration * (spec.span ?? .85)
  const scaleX = end.width / start.width
  const scaleY = end.height / start.height
  const shiftX = end.left - start.left
  const shiftY = end.top - start.top

  // The box mapping and the rotation are on two nested elements because they
  // need different origins: rect-to-rect is exact only from the top left, and
  // a turn is only ever right about the centre.
  batch.play(box, [
    { transform: 'translate(0px, 0px) scale(1, 1)' },
    {
      transform: `translate(${shiftX * .48}px, ${shiftY * .48}px) scale(${lerp(1, scaleX, .42)}, ${lerp(1, scaleY, .42)})`,
      offset: .5,
    },
    { transform: `translate(${shiftX}px, ${shiftY}px) scale(${scaleX}, ${scaleY})` },
  ], { duration: span, easing: 'cubic-bezier(.62,0,.2,1)' })

  const turnX = spec.turn?.x ?? 0
  const turnY = spec.turn?.y ?? 0
  if (turnX || turnY) {
    batch.play(inner, [
      { transform: 'rotateX(0deg) rotateY(0deg)' },
      { transform: `rotateX(${turnX}deg) rotateY(${turnY}deg)`, offset: .52 },
      { transform: 'rotateX(0deg) rotateY(0deg)' },
    ], { duration: span, easing: 'cubic-bezier(.4,0,.4,1)' })
  }

  // The flying box has to be the only copy of the object on screen. The source
  // goes at once; the target is held back until the box is nearly home, so the
  // two never overlap and the landing is a substitution rather than a fade.
  //
  // Transient, both of them. These two are figure elements inside the slide
  // layers, and the layers are pooled: a filled `opacity: 0` left on the source
  // outlives the transition, and if the runtime re-hosts that slide in the same
  // element — which it does whenever a transition was interrupted rather than
  // completed — React reuses the figure's nodes and the bar the morph flew
  // *from* is still invisible. `Batch.claim` cannot reach these, because it
  // only claims the two layers and not their subtrees. By the time these are
  // cancelled the source's layer is at opacity 0 and the target is at its own
  // resting state, so cancelling changes nothing anyone can see.
  batch.playTransient(source, [{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'linear' })
  batch.playTransient(target, [
    { opacity: 0 },
    { opacity: 0, offset: .9 },
    { opacity: 1 },
  ], { duration: span, easing: 'linear' })
  batch.play(box, [
    { opacity: 1 },
    { opacity: 1, offset: .88 },
    { opacity: 0 },
  ], { duration: span, easing: 'linear' })
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// ===========================================================================
// BESPOKE MOVES
//
// Two of the narrative's transitions are not one object travelling between
// two slides but the whole frame doing something, so they replace their
// kernel rather than running over it. Both are recognised the same way a
// morph is — by what is on the two slides — and both fall back to the generic
// kernel when the signature does not match.
// ===========================================================================

type Override = {
  id: string
  matches: (context: TransitionContext) => boolean
  kernel: Kernel
}

/**
 * 1 → 2. "The desk lamp brightens to a wash and blows the frame out to beige
 * for a quarter second."
 *
 * An exposure, not a dissolve, and the difference is entirely in the shape of
 * the curve: light of this kind arrives faster than it leaves and spends real
 * time at the top. So the flare takes a third of the transition to reach full,
 * holds there long enough for the room to lose the image completely, and
 * recovers slowly. The slide changes inside the hold.
 *
 * The wash is centred where slide 1's key light is — up and to the left of the
 * mark, which is where the scene puts the practical it reads as. A flare
 * centred on the frame would be a flash; one centred on the lamp is the lamp.
 */
const exposureBlowout: Kernel = ({ from, to, overlay, onMidpoint }, batch) => {
  const total = TRANSITION_MS['ink-bleed']
  const flare = overlayLayer(batch, overlay, 'tx-flare')

  batch.play(flare, [
    { opacity: 0, transform: 'scale(.55)' },
    { opacity: 1, transform: 'scale(1.04)', offset: .34 },
    { opacity: 1, transform: 'scale(1.1)', offset: .56 },
    { opacity: 0, transform: 'scale(1.3)' },
  ], { duration: total, easing: 'cubic-bezier(.3,.05,.5,1)' })

  if (from) {
    batch.play(from, [
      { opacity: 1, filter: 'brightness(1)' },
      { opacity: 1, filter: 'brightness(2.6)', offset: .3 },
      { opacity: 0, filter: 'brightness(3)', offset: .38 },
      { opacity: 0 },
    ], { duration: total, easing: 'linear' })
  }
  batch.play(to, [
    { opacity: 0 },
    { opacity: 0, offset: .42 },
    { opacity: 1, offset: .72 },
    { opacity: 1 },
  ], { duration: total, easing: 'linear' })

  batch.after(total * .4, () => onMidpoint?.())
}

/**
 * 3 → 4. "The price ribbon whips left off-frame and drags the entire royal
 * blue background with it like a curtain, revealing beige underneath. Hard
 * inversion, and the only one in the first half of the deck."
 *
 * The whole outgoing slide is the curtain: it leaves as one sheet, and slide 4
 * is simply already behind it. The ribbon leads by about a fifth of a second
 * and moves faster than the sheet, so it reads as the thing doing the dragging
 * rather than as a detail travelling with it — which is the entire difference
 * between this and a push.
 *
 * There is no plate and no wash. An inversion this hard does not need help;
 * what it needs is for nothing to be laid over the beige as it is uncovered.
 *
 * ## Every keyframe list here now says `opacity`, and that is the fix for the
 * ## frame the founder could not read
 *
 * This kernel moved both slides and mentioned opacity on neither, on the
 * reasoning that a curtain does not fade — which is true of the motion and
 * false of the DOM. A slide layer's opacity comes from the stylesheet only when
 * no animation is writing it, and the runtime pools and reuses the layer
 * elements, so under any navigation quick enough to interrupt a transition both
 * of these slides inherited an opacity from whichever transition last used
 * their element. The incoming one inherited `0` and stayed there: slide 4 held
 * for as long as the presenter left it, showing the bare stage. `Batch.claim`
 * now clears those leftovers, which turns the same defect into the honest
 * version of itself — with nothing writing opacity, the outgoing layer would
 * take the stylesheet's value for a layer that is no longer live, which is 0,
 * and the curtain would never be drawn at all. So both sides declare it.
 *
 * The sheet's hold is written on its own keyframe rather than as an effect-level
 * curve, per the note on `Batch`: at `offset: .16` under the old effect easing
 * the hold really lasted about three tenths of the move, and three tenths is
 * the number that was tuned by eye against the ribbon's lead. It is now spelled
 * the way it behaves.
 */
const priceCurtain: Kernel = ({ from, to, onMidpoint }, batch) => {
  const total = TRANSITION_MS.letterbox * .72
  const ribbon = from?.querySelector<HTMLElement>('.fig-hb-ribbon')

  if (ribbon) {
    batch.play(ribbon, [
      { transform: 'translate3d(0,0,0)', easing: 'cubic-bezier(.5,0,.35,1)' },
      { transform: 'translate3d(-38vw,0,0)', offset: .3, easing: 'cubic-bezier(.5,0,.35,1)' },
      { transform: 'translate3d(-150vw,0,0)' },
    ], { duration: total * .78 })
  }

  if (from) {
    batch.play(from, [
      { opacity: 1, transform: 'translate3d(0,0,0)' },
      { opacity: 1, transform: 'translate3d(0,0,0)', offset: .3, easing: 'cubic-bezier(.45,0,.28,1)' },
      { opacity: 1, transform: 'translate3d(-104vw,0,0)' },
    ], { duration: total })
  }
  // A shallow counter-move, so the beige is not simply sitting there waiting.
  // Anything larger and the two layers read as two slides sliding, which is
  // the idiom this exists to avoid.
  batch.play(to, [
    { opacity: 1, transform: 'translate3d(5vw,0,0)' },
    { opacity: 1, transform: 'translate3d(0,0,0)' },
  ], { duration: total, easing: 'cubic-bezier(.3,0,.2,1)' })

  batch.after(total * .4, () => onMidpoint?.())
}

/**
 * 10 → 11. The counsel reaches and hauls the *real* next slide (the DOM
 * layer of `COUNSEL_PULL_TO`). The scene writes translateX each frame
 * so the left edge stays on his hand. This kernel must not animate
 * `transform` on `to` — a WAAPI fill would win over those writes.
 */
const counselWalkPull: Kernel = ({ from, to, onMidpoint }, batch) => {
  const total = COUNSEL_PULL_MS

  // Slide 10's copy holds until he has hold of the sheet. It used to clear at
  // 38%, which left two and a half seconds of empty navy with a man walking
  // across it and nothing to read — the walk is long because it is a walk, and
  // the words are what the audience does during it.
  if (from) {
    batch.play(from, [
      { opacity: 1, transform: 'translate3d(0,0,0)' },
      { opacity: 1, transform: 'translate3d(0,0,0)', offset: .46 },
      { opacity: 0, transform: 'translate3d(0,0,0)', offset: .6 },
      { opacity: 0, transform: 'translate3d(0,0,0)' },
    ], { duration: total })
  }

  to.style.transform = `translate3d(${COUNSEL_PULL_PARK}%,0,0)`
  to.style.opacity = '1'
  batch.play(to, [{ opacity: 1 }, { opacity: 1 }], { duration: total })

  const settle = () => snapCounselSlide(to)
  batch.after(total * COUNSEL_PULL_MID, () => {
    settle()
    onMidpoint?.()
  })
  batch.onCleanup(settle)
}

/**
 * 10 → 11. Opacity only, ease-out. Papers, fire and type leave; the navy
 * room holds; counsel-stage items ease in. Same cyclorama.
 */
const burnoutReveal: Kernel = ({ from, to, onMidpoint }, batch) => {
  const total = BURNOUT_REVEAL_MS
  const ease = 'cubic-bezier(.22, 1, .36, 1)'
  if (from) {
    batch.play(from, [
      { opacity: 1 },
      { opacity: 0 },
    ], { duration: total * BURNOUT_REVEAL_MID, easing: ease })
  }
  batch.play(to, [
    { opacity: 0 },
    { opacity: 0, offset: BURNOUT_REVEAL_MID },
    { opacity: 1 },
  ], { duration: total, easing: ease })
  batch.after(total * BURNOUT_REVEAL_MID, () => onMidpoint?.())
}

const OVERRIDES: readonly Override[] = [
  {
    id: 'exposure-blowout',
    matches: ({ from, to }) => from?.dataset.kind === 'title' && Boolean(to.querySelector('.fig-bar-pair')),
    kernel: exposureBlowout,
  },
  {
    id: 'price-curtain',
    matches: ({ from, to }) => Boolean(from?.querySelector('.fig-hb-ribbon')) && to.dataset.field === 'beige',
    kernel: priceCurtain,
  },
  {
    id: 'counsel-walk-pull',
    matches: ({ from, to, direction }) => (
      direction > 0
      && from?.dataset.slide === COUNSEL_PULL_FROM
      && to.dataset.slide === COUNSEL_PULL_TO
    ),
    kernel: counselWalkPull,
  },
  {
    id: 'burnout-reveal',
    matches: ({ from, to, direction }) => (
      direction > 0
      && from?.dataset.slide === BURNOUT_REVEAL_FROM
      && to.dataset.slide === BURNOUT_REVEAL_TO
    ),
    kernel: burnoutReveal,
  },
]

const KERNELS: Record<TransitionKind, Kernel> = {
  cut,
  'ink-bleed': inkBleed,
  letterbox,
  camera,
  'foil-seal': foilSeal,
}

/**
 * Reduced motion collapses every transition to a one-frame swap.
 *
 * Not "a shorter transition" — a swap. The preference asks for motion not to
 * happen, and a 100ms version of a letterbox is still a shutter closing. The
 * slide still changes, because a deck whose navigation was removed would be
 * unusable, and that is the distinction the preference actually draws.
 */
const swap: Kernel = ({ from, to, onMidpoint }, batch) => {
  if (from) batch.play(from, [{ opacity: 1 }, { opacity: 0 }], { duration: 1 })
  batch.play(to, [{ opacity: 0 }, { opacity: 1 }], { duration: 1 })
  onMidpoint?.()
}

export function runTransition(kind: TransitionKind, context: TransitionContext): RunningTransition {
  context.overlay.replaceChildren()
  const override = context.reduced ? undefined : OVERRIDES.find((entry) => entry.matches(context))
  const kernel = context.reduced ? swap : (override?.kernel ?? KERNELS[kind] ?? cut)
  return build(context, (ctx, batch) => {
    // The morph goes first so its stand-in is measured against the layout the
    // kernel is about to start moving, and so the source is hidden before the
    // kernel's first frame rather than a frame into it.
    // 10 → 11 is the real DOM slide translating to identity — a morph stand-in
    // would be a second, warped object on top of that.
    if (override?.id !== 'counsel-walk-pull' && override?.id !== 'burnout-reveal') {
      runMorph(ctx, batch, TRANSITION_MS[kind] ?? TRANSITION_MS.cut)
    }
    return kernel(ctx, batch)
  })
}

/** Whether the stage should run its GL dissolve for this transition kind. */
export function transitionBlendsScene(kind: TransitionKind): 'ink' | 'none' {
  // `camera` must not blend: the whole point is one continuous camera, and a
  // dissolve laid over it would hide the move it exists to show. `letterbox`
  // must not either — the swap happens inside full black, so a dissolve would be
  // work nobody can see. Everything else gets the ink field.
  return kind === 'camera' || kind === 'letterbox' ? 'none' : 'ink'
}
