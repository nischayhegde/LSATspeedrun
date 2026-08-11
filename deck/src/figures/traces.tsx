import type { TracesFigure } from './types'
import { DRAW_PX, pct, usePhase, vars, type FigureBody } from './kit'

/**
 * SLIDE 9 — `traces`. Bastani's practice gains, the exam that followed, and the
 * guardrailed tutor that lands level with the control.
 *
 * The only slide in the deck permitted misdirection, and the misdirection is
 * carried by timing rather than by drawing: the first trace draws alone and holds
 * long enough for the room to read it as good news, and only then does the second
 * one arrive. So the first trace is not styled as a warning, is not dimmed on
 * arrival, and gets its label immediately — it is allowed to be convincing. It
 * recedes at the moment the second trace lands, which is the visual equivalent of
 * "then they took it away for the real exam".
 *
 * No gridlines. The only reference is the dashed baseline, because the entire
 * quantitative claim is "above it or below it", and a grid invites the audience to
 * read values off an axis that the study does not support.
 */

/** Cumulative milliseconds. The 1.7s gap after the first mark is the misdirection: draw, then hold. */
const MARKS = [40, 1740, 3040] as const

/**
 * Plot box in viewBox units, with a strip reserved down each side: the left one
 * carries the control's name, the right one the three trace labels.
 *
 * The left strip is the fix for the one collision this figure could not avoid.
 * All three traces leave from the same point on the baseline, so a label for
 * that point has nowhere to go *near* it — set above the origin it sits inside
 * the fan the moment the first trace draws, and set below it the descending
 * trace runs through it. Pulling the plot in and ranging the label right
 * against the origin turns it into what it actually is: the axis's own label,
 * naming the point every trace departs from.
 */
const PLOT = { left: 27, right: 68, top: 10, bottom: 88 } as const

/** Minimum vertical separation between two right-hand labels, in viewBox units. */
const LABEL_CLEARANCE = 6.4

export function Traces({ spec, active, reduced }: FigureBody<TracesFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const baselineY = yOf(spec.baseline)

  const traces = spec.traces.map((trace, index) => {
    const points = trace.points.length > 1 ? trace.points : [trace.points[0] ?? 0, trace.points[0] ?? 0]
    const path = points
      .map((value, position) => {
        const x = PLOT.left + (position / (points.length - 1)) * (PLOT.right - PLOT.left)
        return `${position === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${yOf(value).toFixed(2)}`
      })
      .join(' ')
    return {
      ...trace,
      path,
      endY: yOf(points[points.length - 1] ?? 0),
      // Each trace owns a phase: first, then the reveal, then the resolution.
      revealAt: index + 1,
    }
  })

  const labelYs = spreadLabels(traces.map((trace) => trace.endY))

  return (
    <div className="fig-tr">
      <svg className="fig-tr-plot" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {/* Faded in rather than drawn: the dash pattern is the baseline's identity,
            and a draw-on would have to spend the same `stroke-dasharray` the traces
            use to reveal themselves. */}
        <path
          className="fig-tr-baseline"
          d={`M ${PLOT.left} ${baselineY} L ${PLOT.right + 2} ${baselineY}`}
          vectorEffect="non-scaling-stroke"
          style={{ opacity: phase >= 1 ? 1 : 0 }}
        />
        {traces.map((trace) => (
          <path
            className="fig-tr-trace"
            key={trace.label}
            data-style={trace.style}
            data-receded={trace.style === 'good' && phase >= 2 ? 'true' : 'false'}
            d={trace.path}
            vectorEffect="non-scaling-stroke"
            style={{ strokeDashoffset: phase >= trace.revealAt ? 0 : DRAW_PX }}
          />
        ))}
      </svg>

      <span
        className="fig-tr-baseline-label"
        style={{
          width: pct((PLOT.left - 3) / 100),
          top: pct(baselineY / 100),
          opacity: phase >= 1 ? 1 : 0,
        }}
      >
        {spec.baselineLabel}
      </span>

      {traces.map((trace, index) => {
        const receded = trace.style === 'good' && phase >= 2
        const opacity = phase >= trace.revealAt ? (receded ? 0.55 : 1) : 0
        return (
          <div className="fig-tr-mark" key={trace.label} data-style={trace.style}>
            {/* The dot sits on the trace's true end; the tag may have been nudged
                clear of a neighbour, so the two are separate elements. */}
            <span
              className="fig-tr-end"
              style={{ left: pct(PLOT.right / 100), top: pct(trace.endY / 100), opacity }}
            />
            <span
              className="fig-tr-tag"
              style={vars({
                left: pct((PLOT.right + 2.4) / 100),
                top: pct((labelYs[index] ?? trace.endY) / 100),
                opacity,
              })}
            >
              {trace.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** 0..1 up the plot, in viewBox units, y down. */
function yOf(value: number): number {
  const clamped = Math.min(Math.max(value, 0), 1)
  return PLOT.bottom - clamped * (PLOT.bottom - PLOT.top)
}

/**
 * Right-hand labels, pushed apart just enough to stop them overprinting.
 *
 * The guarded trace lands exactly on the baseline by design, so two labels sharing
 * a y is the expected case rather than an edge case. Ends are nudged in input
 * order and each label keeps a dot at its trace's true end, so a nudged label
 * still points at the right line.
 */
function spreadLabels(ends: number[]): number[] {
  const sorted = ends.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y)
  let previous = -Infinity
  const resolved = new Array<number>(ends.length)
  for (const entry of sorted) {
    const y = Math.max(entry.y, previous + LABEL_CLEARANCE)
    resolved[entry.index] = y
    previous = y
  }
  return resolved
}
