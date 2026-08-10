import type { ClockRingsFigure } from './types'
import { pct, ringPoint, usePhase, type FigureBody } from './kit'

/**
 * SLIDE 11 — `clock-rings`. The per-question ring that completes and the
 * full-form ring that does not.
 *
 * The two rings are the tension, so they are deliberately built out of different
 * material. The inner one is a true circle in a `meet` viewBox around a card
 * outline — a per-question clock is a small, closed, familiar object. The outer
 * one is stretched to the frame with `preserveAspectRatio="none"`, so on a wide
 * projector it is not a ring you can take in at a glance; it goes off past the
 * edge of your attention, which is what sitting a full form on a Tuesday feels
 * like. It stops at `outer` and is left open. Nothing closes it later.
 *
 * The 700ms of stillness between the two is a scheduled beat, not a gap in the
 * animation. Alan talks into it.
 */

/** Cumulative milliseconds: frame, depletion, the still beat, the outer ring, its label. */
const MARKS = [40, 400, 2300, 3000, 5100] as const

/** Inner geometry in the square viewBox: the used arc, the ghost pace ring, and the tick that marks target. */
const INNER = { used: 38, ghost: 45, tick: [42, 48] } as const

/** The outer ring's radius in a viewBox that gets stretched to the frame. */
const OUTER_RADIUS = 46

export function ClockRings({ spec, active, reduced }: FigureBody<ClockRingsFigure>) {
  const phase = usePhase(active, reduced, MARKS)

  // Every ring here is drawn in a `meet` viewBox with a plain stroke, so a dash
  // array written in viewBox units means what it says and a fraction of the
  // circumference is exactly that fraction of the ring.
  //
  // The outer ring used to be stretched to the frame with
  // `preserveAspectRatio="none"` and a non-scaling stroke. That cannot be made
  // to stop part-way: a non-scaling stroke moves the dash pattern out of user
  // space, and under a non-uniform stretch the same dash length covers a
  // different fraction of the path at the sides than at the top — so there is no
  // number that means "38% of the ring". It rendered as a dashed arc.
  //
  // It is a true circle now, oversized past the edges of the frame by CSS. The
  // narrative's requirement was that it "goes off past the edge of your
  // attention", which overflow delivers and stretching only approximated.
  const usedCircumference = 2 * Math.PI * INNER.used
  const ghostCircumference = 2 * Math.PI * INNER.ghost
  const outerCircumference = 2 * Math.PI * OUTER_RADIUS

  const clamp = (value: number) => Math.min(Math.max(value, 0), 1)
  const used = clamp(spec.used)
  const target = clamp(spec.target)
  const outer = clamp(spec.outer)

  const tickAngle = target * 360
  const tickInner = ringPoint(tickAngle, INNER.tick[0], INNER.tick[0])
  const tickOuter = ringPoint(tickAngle, INNER.tick[1], INNER.tick[1])
  // The outer ring's open end, which is where its label belongs: the label has to
  // sit at the gap, or the audience reads an unfinished ring as a full one.
  const stop = ringPoint(outer * 360, OUTER_RADIUS - 6, OUTER_RADIUS - 5)

  return (
    <div className="fig-cr">
      {/* Square, centred and larger than the stage. The label is inside it so
          that its percentages resolve in the same box the ring is drawn in. */}
      <div className="fig-cr-outer-frame">
        <svg className="fig-cr-outer" viewBox="0 0 100 100" aria-hidden="true">
          <path
            className="fig-cr-outer-arc"
            d={fullRing(OUTER_RADIUS)}
            strokeDasharray={outerCircumference}
            style={{ strokeDashoffset: outerCircumference * (1 - (phase >= 4 ? outer : 0)) }}
          />
        </svg>

        <span
          className="fig-cr-outer-label"
          data-side={stop.x > 50 ? 'right' : 'left'}
          style={{ left: pct(stop.x / 100), top: pct(stop.y / 100), opacity: phase >= 5 ? 1 : 0 }}
        >
          {spec.outerLabel}
        </span>
      </div>

      <div className="fig-cr-core">
        <svg className="fig-cr-inner" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="fig-cr-track" cx={50} cy={50} r={INNER.used} />
          <circle
            className="fig-cr-ghost"
            cx={50}
            cy={50}
            r={INNER.ghost}
            transform="rotate(-90 50 50)"
            strokeDasharray={ghostCircumference}
            style={{ strokeDashoffset: ghostCircumference * (1 - (phase >= 1 ? target : 0)) }}
          />
          <line
            className="fig-cr-tick"
            x1={tickInner.x}
            y1={tickInner.y}
            x2={tickOuter.x}
            y2={tickOuter.y}
            style={{ opacity: phase >= 1 ? 1 : 0 }}
          />
          <circle
            className="fig-cr-used"
            cx={50}
            cy={50}
            r={INNER.used}
            transform="rotate(-90 50 50)"
            strokeDasharray={usedCircumference}
            style={{ strokeDashoffset: usedCircumference * (1 - (phase >= 2 ? used : 0)) }}
          />
        </svg>

        <div className="fig-cr-card" data-settled={phase >= 3 ? 'true' : 'false'} style={{ opacity: phase >= 1 ? 1 : 0 }}>
          <span className="fig-cr-card-rule" />
          <span className="fig-cr-card-rule" />
          <p className="fig-cr-inner-label">{spec.innerLabel}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * A full ring as four quarter arcs, clockwise from twelve o'clock.
 *
 * Written as a `<path>` rather than a `<circle>` so that `pathLength` is
 * available: it is universally implemented on paths and patchily implemented on
 * the basic shapes, and the reveal depends on it.
 */
function fullRing(radius: number): string {
  const arc = `A ${radius} ${radius} 0 0 1`
  return [
    `M 50 ${50 - radius}`,
    `${arc} ${50 + radius} 50`,
    `${arc} 50 ${50 + radius}`,
    `${arc} ${50 - radius} 50`,
    `${arc} 50 ${50 - radius}`,
  ].join(' ')
}
