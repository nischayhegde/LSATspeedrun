import type { TransitionKind } from '../slides/types'

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
  type: 900,
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
class Batch {
  private readonly animations: Animation[] = []
  private readonly cleanups: Array<() => void> = []

  play(
    element: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    const animation = element.animate(keyframes, { fill: 'both', easing: 'linear', ...options })
    this.animations.push(animation)
    return animation
  }

  onCleanup(fn: () => void) {
    this.cleanups.push(fn)
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
// ---------------------------------------------------------------------------
const cut: Kernel = ({ from, to, direction, onMidpoint }, batch) => {
  const shift = 34 * direction
  if (from) {
    batch.play(from, [
      { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' },
      { opacity: 0, transform: `translate3d(${-shift * .5}px,0,0) scale(.985)` },
    ], { duration: TRANSITION_MS.cut * .7, easing: 'cubic-bezier(.4,0,1,1)' })
  }
  batch.play(to, [
    { opacity: 0, transform: `translate3d(${shift}px,0,0) scale(1.012)` },
    { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' },
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

  if (from) {
    batch.play(from, [
      { opacity: 1, filter: 'blur(0px) saturate(1)' },
      { opacity: 0, filter: 'blur(7px) saturate(.4)' },
    ], { duration: duration * .55, easing: 'cubic-bezier(.55,0,1,.45)' })
  }
  batch.play(to, [
    { opacity: 0, filter: 'blur(9px) saturate(.5)', transform: 'scale(1.014)' },
    { opacity: 0, offset: .3 },
    { opacity: 1, filter: 'blur(0px) saturate(1)', transform: 'scale(1)' },
  ], { duration, easing: 'cubic-bezier(.22,1,.36,1)' })

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
    { opacity: 0, letterSpacing: '.5em' },
    { opacity: 1, letterSpacing: '.28em', offset: .5 },
    { opacity: 1, letterSpacing: '.26em', offset: .78 },
    { opacity: 0, letterSpacing: '.2em' },
  ], { duration: close + hold + open * .6, delay: close * .55, easing: 'ease-out' })

  if (from) {
    batch.play(from, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.03)', offset: .34 },
      { opacity: 0, transform: 'scale(1.03)', offset: .35 },
      { opacity: 0, transform: 'scale(1.03)' },
    ], { duration: total, easing: 'linear' })
  }
  // The incoming slide is hidden until the shutter is shut, then pushed in behind
  // it, so nothing of the swap is ever visible.
  batch.play(to, [
    { opacity: 0, transform: 'scale(1.04)' },
    { opacity: 0, transform: 'scale(1.04)', offset: .33 },
    { opacity: 1, transform: 'scale(1.02)', offset: .52 },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: total, easing: 'cubic-bezier(.22,1,.36,1)' })

  // The outgoing scene is released inside the black.
  window.setTimeout(() => onMidpoint?.(), close)
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
  if (from) {
    batch.play(from, [
      { opacity: 1, transform: 'perspective(1400px) translate3d(0,0,0)' },
      { opacity: 0, transform: `perspective(1400px) translate3d(0,0,${170 * direction}px)` },
    ], { duration: total * .62, easing: 'cubic-bezier(.5,0,.9,.4)' })
  }
  batch.play(to, [
    { opacity: 0, transform: `perspective(1400px) translate3d(0,0,${-120 * direction}px)` },
    { opacity: 1, transform: 'perspective(1400px) translate3d(0,0,0)' },
  ], { duration: total, delay: total * .16, easing: 'cubic-bezier(.16,1,.3,1)' })

  // The app-scene canvases, when there are two of them, get the same dolly. They
  // live outside the slide layers, so they are addressed by role.
  const outgoing = document.querySelector<HTMLElement>('.deck-appscene[data-role="outgoing"]')
  const incoming = document.querySelector<HTMLElement>('.deck-appscene[data-role="current"]')
  if (outgoing) {
    batch.play(outgoing, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.34)' },
    ], { duration: total * .78, easing: 'cubic-bezier(.4,0,.9,.5)' })
  }
  if (incoming) {
    batch.play(incoming, [
      { opacity: outgoing ? 0 : 1, transform: 'scale(1.07)' },
      { opacity: 1, transform: 'scale(1.03)', offset: .5 },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: total, easing: 'cubic-bezier(.16,1,.3,1)' })
  }

  window.setTimeout(() => onMidpoint?.(), total * .8)
}

// ---------------------------------------------------------------------------
// 5 — TYPE. The headline's glyphs are transformed individually.
//
// `layouts.tsx` renders every headline as one `<span>` per glyph carrying its own
// index, which is what makes this possible without a text-measuring pass. Each
// glyph gets the same keyframes on a staggered delay, plus an interpolation along
// Fraunces' `wght` axis — the display face is variable from 500 to 900, so a
// headline can genuinely thicken as it lands rather than fading in at a fixed
// weight. That axis move is the part that reads as typography rather than as
// animation.
// ---------------------------------------------------------------------------
const type: Kernel = ({ from, to, direction, onMidpoint }, batch) => {
  const total = TRANSITION_MS.type
  const glyphs = Array.from(to.querySelectorAll<HTMLElement>('[data-glyph]'))
  const outgoingGlyphs = from ? Array.from(from.querySelectorAll<HTMLElement>('[data-glyph]')) : []

  if (from) {
    batch.play(from, [{ opacity: 1 }, { opacity: 0 }], {
      duration: total * .5, delay: total * .2, easing: 'ease-in',
    })
    // Outgoing glyphs leave upward behind their own mask, in reverse order, so
    // the two headlines never appear to swap places.
    outgoingGlyphs.forEach((glyph, index) => {
      batch.play(glyph, [
        { transform: 'translate3d(0,0,0)', opacity: 1 },
        { transform: `translate3d(0,${-.55 * direction}em,0)`, opacity: 0 },
      ], {
        duration: total * .42,
        delay: (outgoingGlyphs.length - index) * 7,
        easing: 'cubic-bezier(.5,0,.75,0)',
      })
    })
  }

  // The body of the incoming slide is a plain fade; only the headline is
  // choreographed. A slide where every element is individually staggered is
  // noise, and the headline is the only thing the audience is reading yet.
  batch.play(to, [{ opacity: 0 }, { opacity: 1 }], {
    duration: total * .34, delay: total * .18, easing: 'ease-out',
  })

  glyphs.forEach((glyph, index) => {
    batch.play(glyph, [
      {
        transform: `translate3d(0,${.85 * direction}em,0) rotateX(${-42 * direction}deg)`,
        opacity: 0,
        fontVariationSettings: '"wght" 500, "opsz" 24',
      },
      {
        transform: 'translate3d(0,0,0) rotateX(0deg)',
        opacity: 1,
        fontVariationSettings: '"wght" 900, "opsz" 144',
      },
    ], {
      duration: total * .72,
      // 16ms per glyph: fast enough that a nine-word headline finishes inside the
      // transition, slow enough that the stagger is legible as a sweep.
      delay: total * .16 + index * 16,
      easing: 'cubic-bezier(.16,1,.3,1)',
    })
  })

  onMidpoint?.()
}

// ---------------------------------------------------------------------------
// 6 — FOIL SEAL. The scales-of-justice mark as an animated gold-foil mask.
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
  batch.play(to, [
    { opacity: 0, transform: 'scale(1.03)' },
    { opacity: 0, transform: 'scale(1.03)', offset: .44 },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: total, easing: 'cubic-bezier(.22,1,.36,1)' })

  window.setTimeout(() => onMidpoint?.(), cover)
}

const KERNELS: Record<TransitionKind, Kernel> = {
  cut,
  'ink-bleed': inkBleed,
  letterbox,
  camera,
  type,
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
  const kernel = context.reduced ? swap : (KERNELS[kind] ?? cut)
  return build(context, kernel)
}

/** Whether the stage should run its GL dissolve for this transition kind. */
export function transitionBlendsScene(kind: TransitionKind): 'ink' | 'none' {
  // `camera` must not blend: the whole point is one continuous camera, and a
  // dissolve laid over it would hide the move it exists to show. `letterbox`
  // must not either — the swap happens inside full black, so a dissolve would be
  // work nobody can see. Everything else gets the ink field.
  return kind === 'camera' || kind === 'letterbox' ? 'none' : 'ink'
}
