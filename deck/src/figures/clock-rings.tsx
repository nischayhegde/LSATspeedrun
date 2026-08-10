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

/**
 * Inner geometry in the square viewBox: the used arc, the ghost pace ring, and
 * the tick that marks target.
 *
 * The tick sits *across the used arc*, which is a correction rather than a
 * placement. It used to straddle the ghost ring at 42–48, and the ghost ring
 * ends at `target` — the same datum the tick marks — so the two were always
 * drawn at the identical angle and the tick read as an arrowhead welded to the
 * end of the arc. It looked like a bug in the arc rather than a mark on the
 * dial, and it was the single thing making this clock look wrong.
 *
 * Moved inward it earns its place: the used arc runs past `target` to `used`,
 * so a notch at 35–41.5 crosses the blue and shows the overrun. That is the
 * slide's whole argument — the question took longer than it was given — stated
 * as geometry instead of as a second copy of a number already on screen.
 */
const INNER = { used: 38, ghost: 45, tick: [35, 41.5] } as const

/**
 * Twelve marks around the dial, four of them long.
 *
 * The rings alone were a progress donut. A donut and a clock are drawn almost
 * identically and are read completely differently, and this slide's whole
 * headline is *timed* — so the dial gets the one piece of furniture that
 * settles it. Twelve, at the hours, quarters long, is the shortest description
 * of a clock face there is; anything more elaborate starts competing with the
 * two arcs that carry the actual argument.
 */
const FACE = { count: 12, radius: 34, minor: 2.2, major: 3.6 } as const

/** The outer ring's radius in a viewBox that gets stretched to the frame. */
const OUTER_RADIUS = 46

export function ClockRings({ spec, active, reduced }: FigureBody<ClockRingsFigure>) {
  const phase = usePhase(active, reduced, MARKS)

  // Every ring here is drawn in a `meet` viewBox with a plain stroke, and every
  // one of them is revealed with `pathLength="1"` and a two-value dash pattern.
  //
  // The two-value pattern is the part that matters. A single-value dash array is
  // repeated to make it even, so `dasharray: C` becomes a dash of C and a gap of
  // C — and the pattern is periodic, which means the dash *before* the one being
  // shown can reach back onto the end of the path. That is what put a stray grey
  // arc across the lower left of this dial, outside the used ring and belonging
  // to nothing: it was the tail of the pace ring's previous period. With
  // `pathLength="1"` and `1 1`, the offset is a fraction and the arithmetic
  // stops depending on the circumference at all.
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
            pathLength={1}
            strokeDasharray="1 1"
            style={{ strokeDashoffset: 1 - (phase >= 4 ? outer : 0) }}
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
          {Array.from({ length: FACE.count }, (_, hour) => {
            const angle = (hour / FACE.count) * 360
            const long = hour % 3 === 0
            const outerEnd = ringPoint(angle, FACE.radius, FACE.radius)
            const innerEnd = ringPoint(
              angle,
              FACE.radius - (long ? FACE.major : FACE.minor),
              FACE.radius - (long ? FACE.major : FACE.minor),
            )
            return (
              <line
                className="fig-cr-hour"
                key={hour}
                data-long={long ? 'true' : 'false'}
                x1={innerEnd.x}
                y1={innerEnd.y}
                x2={outerEnd.x}
                y2={outerEnd.y}
                style={{ opacity: phase >= 1 ? 1 : 0 }}
              />
            )
          })}
          <circle
            className="fig-cr-ghost"
            cx={50}
            cy={50}
            r={INNER.ghost}
            transform="rotate(-90 50 50)"
            pathLength={1}
            strokeDasharray="1 1"
            style={{ strokeDashoffset: 1 - (phase >= 1 ? target : 0) }}
          />
          <circle
            className="fig-cr-used"
            cx={50}
            cy={50}
            r={INNER.used}
            transform="rotate(-90 50 50)"
            pathLength={1}
            strokeDasharray="1 1"
            style={{ strokeDashoffset: 1 - (phase >= 2 ? used : 0) }}
          />
          {/* Last, so it is on top of the used arc rather than under it.
              Painted before it, the notch was hidden by the very thing it is
              meant to cut across, and all that showed was a gold fleck at the
              ring's outer edge. */}
          <line
            className="fig-cr-tick"
            x1={tickInner.x}
            y1={tickInner.y}
            x2={tickOuter.x}
            y2={tickOuter.y}
            style={{ opacity: phase >= 1 ? 1 : 0 }}
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
