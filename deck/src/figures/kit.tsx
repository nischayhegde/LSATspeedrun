import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 * projector — `pov-real-clock`'s full-form ring runs around a 1674×430 band and its
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

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const read = () => {
      // Layout size, not the visual box. `getBoundingClientRect` includes the
      // slide layer's entrance scale and any parent `scale()` from the fit
      // guard, which rewrote the clock ring's viewBox a few percent large and
      // then snapped it back when the layer settled.
      const next = {
        w: Math.round(node instanceof HTMLElement ? node.offsetWidth : node.clientWidth),
        h: Math.round(node instanceof HTMLElement ? node.offsetHeight : node.clientHeight),
      }
      setBox((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, box]
}

/**
 * The guarantee that a figure never loses its last line to the stage's clip.
 *
 * ## The defect this exists to remove
 *
 * `.figure-stage` is the middle track of a three-row grid — `auto minmax(0,1fr)
 * auto` — and it sets `overflow: hidden`, deliberately, so that a figure sized
 * to its frame cannot paint over the credit and the progress rail beneath it.
 * Every figure is then written to a height that is a hand-summed stack of
 * measures: a bar height, four gaps, two line-heights, a padding. Nothing
 * connects that sum to the track it has to fit inside, so the two agree only
 * because somebody measured them agreeing once.
 *
 * They stop agreeing for reasons that have nothing to do with the figure. The
 * track is whatever is left after the headline and the standfirst have wrapped,
 * so one extra word in a standfirst, one more line in a credit, or a projector
 * whose aspect ratio wraps a headline differently takes forty pixels out of the
 * stage — and the figure does not find out. It draws at its full height and the
 * clip removes the bottom of it, which on `cohort-split` was the string
 * `LSAC's words, not ours`: cut through the descenders, and the one annotation
 * on that slide whose whole job is to be readable when the claim is challenged.
 * That is the founder's screenshot, and it had been "fixed" three times by
 * taking a few pixels off a gap. `cohort-split.css` still carries the log of it.
 *
 * ## What this does instead
 *
 * It measures. The figure's real content bounds are compared with the stage's
 * box, and if the content is taller or wider the whole figure is scaled down by
 * the ratio, once, about its own centre. Type, rules and gaps all lose the same
 * few percent, the hierarchy is untouched, and *nothing leaves the frame*. A
 * figure that fits is not touched at all, so the deck at 16:9 is pixel-identical
 * to what it was.
 *
 * Shrinking is the right failure mode here and reflowing is not: these are
 * compositions, not documents. A figure that re-wrapped into the space it was
 * given would be a different drawing on every projector.
 *
 * ## How the measurement stays honest
 *
 * - An element that clips its own overflow bounds its subtree, so the walk
 *   takes that element's box and stops. Otherwise `method-lab`'s filter sweep —
 *   deliberately wider than the pane that clips it — would shrink the figure to
 *   accommodate something no one can see.
 * - `clip-path` marks the deck's screen-reader-only text, which is meant to be
 *   invisible and is skipped whole.
 * - Bounds are *layout* boxes (`offsetWidth` / the offset chain), not
 *   `getBoundingClientRect`. Entrance translates, the slide layer's arrival
 *   scale, and this guard's own `scale()` all inflate the visual rect and then
 *   vanish — writing a fit from that rect, then again when it settled, is the
 *   figure jump the room sees. Layout size does not move with a transform, so
 *   the measurement is of the composition at rest even while pieces are still
 *   arriving. The fit transform is not in the layout, so there is no feedback
 *   loop to undo.
 * - `INK` is the allowance for the difference between a text node's border box
 *   and the ink inside it: a descender sits a pixel or two below the line box,
 *   and this measurement is of boxes.
 */
const INK = 8

/** Never shrink past this: below it, fix the slide rather than the scale. */
const FLOOR = 0.62

/** Ignore stage-size noise below a layout pixel. */
const STAGE_DEAD = 1

export function useFitScale<T extends HTMLElement>(active: boolean, reduced: boolean): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [scale, setScale] = useState(1)
  const stageSize = useRef({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const node = ref.current
    const stage = node?.parentElement
    if (!node || !stage) return
    // The outgoing layer keeps whatever scale it was measured at, so a figure
    // does not pop to 1 while it is still on screen behind the arrival.
    if (!active) return

    let debounce = 0
    let cancelled = false

    const measure = () => {
      if (cancelled) return
      const limitW = stage.clientWidth
      const limitH = stage.clientHeight
      if (limitW < 1 || limitH < 1) return
      const bounds = contentBounds(node)
      if (!bounds || bounds.w < 1 || bounds.h < 1) return
      // Most of the set is written to fill its stage exactly, so `bounds` and
      // the stage agree to the pixel and there is nothing to correct. The guard
      // only engages on a figure that genuinely wants more room than it has;
      // `INK` is then spent buying the descenders clearance, which is the
      // difference between the box this measures and the glyphs it paints.
      const overflow = Math.max(bounds.h - limitH, bounds.w - limitW)
      const next = overflow <= 0.5
        ? 1
        : Math.min(
          1,
          (limitH - INK * 2) / bounds.h,
          (limitW - INK * 2) / bounds.w,
        )
      const rounded = Math.max(FLOOR, Math.floor(next * 500) / 500)
      stageSize.current = { w: limitW, h: limitH }
      // A dead band, so a fractional layout change cannot put this into a
      // commit loop on a live slide.
      setScale((prev) => (Math.abs(prev - rounded) < 0.006 ? prev : rounded))
    }

    measure()

    const schedule = () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(measure, reduced ? 16 : 80)
    }

    const observer = new ResizeObserver(() => {
      const w = stage.clientWidth
      const h = stage.clientHeight
      if (
        Math.abs(w - stageSize.current.w) < STAGE_DEAD
        && Math.abs(h - stageSize.current.h) < STAGE_DEAD
      ) return
      schedule()
    })
    observer.observe(stage)

    // One more read after the faces have arrived, in case a deep-link opened
    // the deck before `warm-up` finished. Already-ready fonts resolve in a
    // microtask and the dead band keeps that from being a write.
    void document.fonts?.ready.then(() => {
      if (!cancelled) schedule()
    }).catch(() => undefined)

    return () => {
      cancelled = true
      observer.disconnect()
      window.clearTimeout(debounce)
    }
  }, [active, reduced])

  return [ref, scale]
}

/** Union of everything a figure actually lays out, in the figure's own pixels. */
function contentBounds(root: HTMLElement): { w: number; h: number } | null {
  let top = Infinity
  let left = Infinity
  let right = -Infinity
  let bottom = -Infinity

  const visit = (element: Element) => {
    for (const child of element.children) {
      const style = getComputedStyle(child)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      // The deck's idiom for copy that is spoken but not shown.
      if (style.clipPath !== 'none') continue

      const box = layoutBox(child, root)
      if (box && box.w > 0 && box.h > 0) {
        if (box.top < top) top = box.top
        if (box.left < left) left = box.left
        if (box.top + box.h > bottom) bottom = box.top + box.h
        if (box.left + box.w > right) right = box.left + box.w
      }

      // A clipper is the boundary of its own subtree: what is inside it is
      // already bounded, and what escapes it is already invisible.
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') continue
      visit(child)
    }
  }
  visit(root)

  if (!Number.isFinite(top) || !Number.isFinite(left)) return null
  return { w: right - left, h: bottom - top }
}

/**
 * An element's layout box relative to `root`, ignoring CSS transforms.
 *
 * `offsetLeft` / `offsetWidth` are the pre-transform border box. Walking the
 * offsetParent chain puts that box in the figure's coordinates even when an
 * ancestor (or the element itself) is mid-translate on the way in.
 */
function layoutBox(element: Element, root: HTMLElement): { left: number; top: number; w: number; h: number } | null {
  if (element instanceof HTMLElement) {
    const w = element.offsetWidth
    const h = element.offsetHeight
    if (w <= 0 && h <= 0) return null
    const origin = offsetFrom(element, root)
    if (!origin) return visualFallback(element, root)
    return { left: origin.x, top: origin.y, w, h }
  }
  return visualFallback(element, root)
}

function offsetFrom(element: HTMLElement, root: HTMLElement): { x: number; y: number } | null {
  let x = 0
  let y = 0
  let node: HTMLElement | null = element
  while (node && node !== root) {
    x += node.offsetLeft
    y += node.offsetTop
    const parent: Element | null = node.offsetParent
    if (!(parent instanceof HTMLElement)) return null
    if (parent !== root && !root.contains(parent)) return null
    x += parent.clientLeft
    y += parent.clientTop
    node = parent === root ? null : parent
  }
  return { x, y }
}

/**
 * SVG nodes have no offset chain. Map their visual rect into the root's layout
 * space by undoing the root's own visual scale (the fit guard, a layer
 * arrival), so a parent translate on an HTML wrapper is the only remaining
 * error — and those wrappers are measured by `offsetFrom` instead.
 */
function visualFallback(element: Element, root: HTMLElement): { left: number; top: number; w: number; h: number } | null {
  const rootRect = root.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  if (rootRect.width < 1 || rootRect.height < 1 || rect.width <= 0 || rect.height <= 0) return null
  const sx = root.offsetWidth / rootRect.width
  const sy = root.offsetHeight / rootRect.height
  return {
    left: (rect.left - rootRect.left) * sx,
    top: (rect.top - rootRect.top) * sy,
    w: rect.width * sx,
    h: rect.height * sy,
  }
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
 * sides, and the twelve labels of `dashboard-everything` need every millimetre. Strokes are
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
 * `pov-real-clock` — needs its true length, and computes it from its own radius in a
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
 * diagonal), `pov-ai-never-answers`'s guardrailed trace drew as a 25-pixel lozenge with round
 * caps the size of the plot, and `game-never-gates`'s forward arrow as a 54-pixel bar.
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
