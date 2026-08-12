import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

/**
 * FIGURE KIT — the four things every figure in this folder needs.
 *
 * The figures are choreographed rather than merely animated: `NARRATIVE.md`
 * specifies an *order* for almost every one of them ("draw the good trace first
 * and hold for a beat, then the second"), and an order is a state machine, not a
 * transition. So the whole set is driven by one hook that turns a list of
 * millisecond marks into a monotonically increasing phase number, and every
 * figure renders itself as a pure function of that number. Two consequences,
 * both of which matter more than the brevity:
 *
 *   1. The reduced-motion state is the last phase, reached with no scheduling at
 *      all, so `reduced` is not a second rendering path that can rot. What a
 *      screenshot of a reduced-motion figure shows is exactly what the animated
 *      one ends on.
 *   2. Nothing runs on a frame callback. A figure sits on top of a live
 *      `WebGLRenderer` or beside a live app iframe, and the deck's whole reason
 *      for drawing these in SVG is that they must not compete for frame time.
 *      Phase changes are a handful of `setTimeout`s and one style recalculation
 *      each; the interpolation is the compositor's problem.
 */

/**
 * Where a figure is in its entrance, as an index into `marks` + 1.
 *
 * `marks` are cumulative milliseconds from the moment the slide went live, so a
 * figure's timeline reads top-to-bottom as the narrative describes it. Phase 0 is
 * the pre-entrance state and is rendered for exactly one paint, which is what
 * makes the first transition actually run — a style applied in the same commit as
 * the element's insertion is the element's initial style and animates from
 * nothing.
 *
 * The first mark is therefore floored at 16ms rather than 0.
 */
export function usePhase(active: boolean, reduced: boolean, marks: readonly number[]): number {
  const total = marks.length
  // Seeded rather than assigned in the effect: a reduced-motion figure that
  // mounted already live must never paint its phase-0 state, because with
  // animations off there is nothing to carry it out of that state gracefully.
  const [phase, setPhase] = useState(() => (active && reduced ? total : 0))
  // `marks` is a fresh array literal on most renders, so the identity is useless
  // as a dependency and the values are what the effect actually reads.
  const schedule = marks.join(',')

  useEffect(() => {
    if (!active) {
      setPhase(0)
      return
    }
    if (reduced) {
      setPhase(total)
      return
    }
    setPhase(0)
    const timers = schedule
      .split(',')
      .map(Number)
      .map((ms, index) => window.setTimeout(() => setPhase(index + 1), Math.max(ms, 16)))
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [active, reduced, total, schedule])

  return phase
}

/**
 * Real elapsed milliseconds since the slide went live.
 *
 * The one clock in the set, for the speedrun HUD on slide 5, which the narrative
 * asks to count real time. Polled on a 40ms interval instead of a frame callback:
 * a centisecond readout only needs to look alive, and 25 React commits a second
 * is a twentieth of the work of driving it from `requestAnimationFrame` on a
 * 240Hz panel.
 *
 * Under reduced motion it returns `frozenAt`, so the HUD still reads as a
 * stopwatch in a screenshot rather than as a row of zeroes.
 */
export function useStopwatch(active: boolean, reduced: boolean, frozenAt: number): number {
  const [elapsed, setElapsed] = useState(() => (reduced ? frozenAt : 0))

  useEffect(() => {
    if (!active || reduced) {
      setElapsed(reduced ? frozenAt : 0)
      return
    }
    const started = performance.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(performance.now() - started), 40)
    return () => window.clearInterval(timer)
  }, [active, reduced, frozenAt])

  return elapsed
}

/**
 * An element's own pixel size, kept current.
 *
 * The one thing in this kit that costs a live observer, and it is deliberately
 * the only one. Almost every figure here is drawn in a unit-square viewBox and
 * therefore never needs to know how big it is; the exception is a shape that
 * must stay *undistorted* while filling a box whose aspect ratio is set by the
 * projector — slide 11's full-form ring runs around a 1674×430 band and its
 * corners have to be round on every stage, which a stretched viewBox cannot do
 * and a square one cannot fill.
 *
 * A `ResizeObserver` rather than a window listener, because the figure row's
 * height is a grid track that changes when the headline wraps to a second line,
 * which is not a resize of anything the window would report. Disconnected on
 * cleanup: this is exactly the class of subscription that outlives its slide if
 * it is set up carelessly, and the deck has been bitten by that before.
 */
export function useBoxSize<T extends Element>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const read = () => {
      const rect = node.getBoundingClientRect()
      // Rounded, because a fractional layout size churns state every frame the
      // stage tweens through and each churn is a React commit on a live slide.
      const next = { w: Math.round(rect.width), h: Math.round(rect.height) }
      setBox((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, box]
}

/** `M:SS.cc`, the speedrun convention, zero-padded so the readout never reflows. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms))
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const centis = Math.floor((total % 1000) / 10)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

/**
 * Custom properties in an inline style object.
 *
 * `CSSProperties` has no index signature, and the figures pass per-element delays
 * and offsets down to CSS constantly, so the cast lives here once with a name on
 * it rather than fourteen times as `as any`.
 */
export function vars(entries: Record<string, string | number>): CSSProperties {
  return entries as CSSProperties
}

/** A percentage string, rounded to a hundredth so the DOM does not carry noise. */
export function pct(value: number): string {
  return `${Math.round(value * 10000) / 100}%`
}

/**
 * A point on an ellipse, in the 0..100 square the aspect-free figures use.
 *
 * The radial figures draw into a `viewBox="0 0 100 100"` with
 * `preserveAspectRatio="none"`, which turns every circle into an ellipse that
 * fills the frame. That is deliberate: a true circle on a 21:9 slide wastes both
 * sides, and the twelve labels of slide 15 need every millimetre. Strokes are
 * kept honest with `vector-effect="non-scaling-stroke"`, and anything that must
 * stay round — a node dot — is a DOM element positioned in percentages rather
 * than an SVG shape.
 *
 * Angles are degrees clockwise from twelve o'clock, because that is how both a
 * clock ring and a radar chart are described out loud.
 */
export function ringPoint(degrees: number, radiusX: number, radiusY: number): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180
  return {
    x: 50 + Math.cos(radians) * radiusX,
    y: 50 + Math.sin(radians) * radiusY,
  }
}

/** The props every figure body takes: its own slice of the spec, plus the two flags. */
/**
 * Dash length for drawing a stroke on, in user units.
 *
 * `pathLength="1"` with `stroke-dasharray: 1` is the usual way to draw a path on
 * without knowing its length. It is unusable on a path that also sets
 * `vector-effect: non-scaling-stroke`, which every stretched figure here reached
 * for because it draws into a `preserveAspectRatio="none"` viewBox. Two things go
 * wrong at once: Chromium ignores `pathLength` on such an element, and the dash
 * array stops being measured in user units at all — it is applied in screen
 * pixels, so the pattern no longer has any fixed relationship to the path. The
 * failure was not subtle. The route, the three AI traces and both arrows on the
 * gate all rendered as rows of disconnected ticks; raising the dash to 400 just
 * made them 400-pixel ticks with 400-pixel gaps.
 *
 * So a revealed path does not use the non-scaling stroke. Its dash is one length
 * in user units, longer than the longest path a 100×100 viewBox can hold (the
 * diagonal is about 141), which covers it exactly once — and animating the offset
 * to zero draws it. The cost is that the stroke inherits the viewBox's non-uniform
 * scale; these paths are near-horizontal, so it is paid on their thickness and
 * not on their shape.
 *
 * Paths that are *not* revealed keep the non-scaling stroke, and it is still
 * right for them.
 *
 * This handles a full reveal only. A stroke that stops part-way — the rings on
 * slide 11 — needs its true length, and computes it from its own radius in a
 * square viewBox where that number means something.
 */
export const DRAW = 400

/**
 * The same idea, for a revealed path that *keeps* `non-scaling-stroke`.
 *
 * Giving up the non-scaling stroke to get the reveal, which is what `DRAW`
 * above buys, costs more than it looked like it would. Under
 * `preserveAspectRatio="none"` the horizontal and vertical scales differ by a
 * factor of three on a 16:9 stage — 1674 wide against 537 tall for the figure
 * row — and a stroke width in user units is multiplied by *both*, unevenly.
 * The visible consequences were not subtle: slide 5's route drew as a tapering
 * wedge (thin where it ran horizontally, three times thicker down the
 * diagonal), slide 9's guardrailed trace drew as a 25-pixel lozenge with round
 * caps the size of the plot, and slide 22's forward arrow as a 54-pixel bar.
 * Each had been re-tuned by eye after the non-scaling stroke came off, which
 * fixes one aspect ratio and no other.
 *
 * So the stroke stays honest and the *dash* absorbs the problem instead. With
 * `non-scaling-stroke` the dash pattern is measured in screen pixels, so the
 * only requirement is a dash longer than the path can ever be on screen. Four
 * thousand pixels is wider than any projector the deck will meet, which makes
 * one dash cover any path in the deck exactly once at every frame size — and
 * a stroke width in user units now means the pixels it says.
 *
 * The earlier attempt at this used 400 and produced 400-pixel ticks with
 * 400-pixel gaps, which is where the note above comes from; the number was the
 * bug, not the technique.
 */
export const DRAW_PX = 4000

export type FigureBody<Spec> = {
  spec: Spec
  active: boolean
  reduced: boolean
}

/**
 * A hot update to this file reloads the page instead of patching the figures.
 *
 * This module exports hooks and helpers and no component, so it is not a Fast
 * Refresh boundary. Vite therefore propagates a change here up to the sixteen
 * figure modules that import it, each of which *is* a boundary, and React
 * Refresh re-renders those figures in place.
 *
 * In place is the problem. React Refresh decides whether to remount by
 * comparing a signature it records at each component's own definition site, and
 * that signature names `usePhase` and `useStopwatch` without describing them. So
 * if the hook order *inside* one of them changes, every figure's signature is
 * still byte-identical, nothing is remounted, and the next render walks a hook
 * queue built by the previous version of the hook. React reports it as
 * "a change in the order of Hooks called by Route" followed by "Should have a
 * queue", and the figure keeps whatever animation phase the old queue held.
 *
 * That is not a hypothetical: it is the reproduction for the violation that two
 * full-deck screenshot sweeps recorded on 10 August, and it is invisible in a
 * report because the component name arrives in a console format argument that
 * nothing was reading. Editing a figure file directly is safe — the signature is
 * recomputed there — and only this shared module can desynchronise.
 *
 * A reload costs a second and the deck is hash-routed, so it comes back on the
 * same slide. Stale hook state costs a wrong figure on a slide nobody re-checked.
 *
 * `import.meta.hot` is undefined in a production build and this is dropped.
 */
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload())
}
