import type { ClockRingsFigure } from './types'
import { ringPoint, useBoxSize, usePhase, type FigureBody } from './kit'

/**
 * SLIDE 11 — `clock-rings`. The per-question ring that completes and the
 * full-form ring that does not.
 *
 * The two rings are the tension, so they are deliberately built out of different
 * material. The inner one is a true circle around a card outline — a
 * per-question clock is a small, closed, familiar object you can take in at a
 * glance. The outer one is not a circle at all. It runs around the *edge of the
 * frame*, the long way, and stops at `outer` without ever closing.
 *
 * ## Why the outer ring is a rectangle
 *
 * `NARRATIVE.md` asks for "a much larger, slower ring drawn around the whole
 * frame and deliberately left unfinished", and that has been attempted twice as
 * a circle. Both attempts failed for the same underlying reason, which is that
 * the figure row is 1674 by 430 and a circle is not.
 *
 * The first drew a circle at 118% of the stage and let it clip, which gave the
 * room a lopsided arc entering and leaving the bottom corners — not a clock too
 * big to take in, just a broken curve. The second pulled the circle inside the
 * frame, which fixed the clipping and cost the slide its picture: a 396px ring
 * concentric with a 310px ring, both centred in a band four times as wide as it
 * is tall, with roughly six hundred pixels of empty beige on either side. That
 * is the version the founders saw, and "tiny figure marooned in a dead band" is
 * a fair reading of it.
 *
 * A rounded rectangle around the frame's own edge is the shape the direction was
 * actually describing. It encloses everything the audience is looking at, which
 * is the point — the full form is the thing that surrounds a question rather
 * than a bigger version of one — it uses the whole stage, and it can be left
 * open at a specific place instead of merely being incomplete somewhere.
 *
 * It is drawn in a viewBox that matches the element's pixel box one to one (see
 * `useBoxSize`), so the corners are round on every projector and the stroke has
 * a uniform weight without `non-scaling-stroke` — which matters, because the
 * dash arithmetic that stops the ring part-way is only meaningful when the dash
 * is measured in the same units as the path. That is the constraint that made
 * `preserveAspectRatio="none"` unusable here: under a non-uniform stretch the
 * same dash length covers a different fraction of the path on the sides than on
 * the top, so there is no number that means "38% of the ring".
 *
 * The 700ms of stillness between the two rings is a scheduled beat, not a gap in
 * the animation. Alan talks into it.
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

/**
 * The full-form ring: how far inside the figure row it sits, its corner radius,
 * and its weight. All in pixels, because its viewBox is in pixels.
 *
 * The inset is half the stroke plus a hair, so the ring's outer edge lands on
 * the frame rather than half outside it. The corner radius is generous — a
 * rounded rectangle with tight corners reads as a border, and this has to read
 * as a ring that happens to be the shape of the room.
 */
/* The inset is not decoration. The open end's caption is knocked out *on* the
   stroke, so half a line of it hangs outside the ring, and `.figure-stage`
   clips — at an inset of 5 the label lost its second line ("never required",
   which is half the claim). 26 is a line and a half of the caption face. */
const FRAME_RING = { inset: 26, radius: 78, weight: 6 } as const

/**
 * Where a fraction along the frame ring lands, walking clockwise from the top
 * centre — the same twelve-o'clock start as the dial inside it, so the two
 * rings are unmistakably the same kind of measurement.
 *
 * Returned with the edge it landed on, because the open end is where the label
 * goes and a label hung off the bottom edge and one hung off the right edge
 * want opposite offsets.
 */
type RingStop = { x: number; y: number; edge: 'top' | 'right' | 'bottom' | 'left' }

function frameRingStop(w: number, h: number, fraction: number): RingStop {
  const i = FRAME_RING.inset
  const r = Math.min(FRAME_RING.radius, (w - i * 2) / 2, (h - i * 2) / 2)
  const x0 = i
  const y0 = i
  const x1 = w - i
  const y1 = h - i
  const cx = (x0 + x1) / 2
  const quarter = (Math.PI * r) / 2
  const straightX = x1 - r - (x0 + r)
  const straightY = y1 - r - (y0 + r)
  const firstTop = x1 - r - cx

  // Clockwise from top centre. Corners are folded into the straight run that
  // follows them: the label never needs to sit on a corner, and pretending it
  // cannot lands it a few pixels off rather than in the wrong place.
  const legs: Array<{ len: number; edge: RingStop['edge'] }> = [
    { len: firstTop, edge: 'top' },
    { len: quarter, edge: 'right' },
    { len: straightY, edge: 'right' },
    { len: quarter, edge: 'bottom' },
    { len: straightX, edge: 'bottom' },
    { len: quarter, edge: 'left' },
    { len: straightY, edge: 'left' },
    { len: quarter, edge: 'top' },
    { len: cx - (x0 + r), edge: 'top' },
  ]

  const total = legs.reduce((sum, leg) => sum + leg.len, 0)
  let walked = Math.min(Math.max(fraction, 0), 1) * total

  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index]
    if (walked > leg.len && index < legs.length - 1) {
      walked -= leg.len
      continue
    }
    const t = leg.len === 0 ? 0 : Math.min(walked / leg.len, 1)
    switch (index) {
      case 0: return { x: cx + t * firstTop, y: y0, edge: 'top' }
      case 1: return { ...arcPoint(x1 - r, y0 + r, r, -90, 0, t), edge: 'right' }
      case 2: return { x: x1, y: y0 + r + t * straightY, edge: 'right' }
      case 3: return { ...arcPoint(x1 - r, y1 - r, r, 0, 90, t), edge: 'bottom' }
      case 4: return { x: x1 - r - t * straightX, y: y1, edge: 'bottom' }
      case 5: return { ...arcPoint(x0 + r, y1 - r, r, 90, 180, t), edge: 'left' }
      case 6: return { x: x0, y: y1 - r - t * straightY, edge: 'left' }
      case 7: return { ...arcPoint(x0 + r, y0 + r, r, 180, 270, t), edge: 'top' }
      default: return { x: x0 + r + t * (cx - (x0 + r)), y: y0, edge: 'top' }
    }
  }
  return { x: cx, y: y0, edge: 'top' }
}

function arcPoint(cx: number, cy: number, r: number, from: number, to: number, t: number) {
  const angle = ((from + (to - from) * t) * Math.PI) / 180
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }
}

/** The frame ring as a path, clockwise from the top centre. */
function frameRingPath(w: number, h: number): string {
  const i = FRAME_RING.inset
  const r = Math.min(FRAME_RING.radius, (w - i * 2) / 2, (h - i * 2) / 2)
  const x0 = i
  const y0 = i
  const x1 = w - i
  const y1 = h - i
  const cx = (x0 + x1) / 2
  const arc = `A ${r} ${r} 0 0 1`
  return [
    `M ${cx} ${y0}`,
    `L ${x1 - r} ${y0}`,
    `${arc} ${x1} ${y0 + r}`,
    `L ${x1} ${y1 - r}`,
    `${arc} ${x1 - r} ${y1}`,
    `L ${x0 + r} ${y1}`,
    `${arc} ${x0} ${y1 - r}`,
    `L ${x0} ${y0 + r}`,
    `${arc} ${x0 + r} ${y0}`,
    `L ${cx} ${y0}`,
  ].join(' ')
}

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
  // The frame ring is stopped by the same arithmetic, which is the reason it is
  // drawn into a pixel-matched viewBox rather than a stretched one. See the
  // header.
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1)
  const used = clamp(spec.used)
  const target = clamp(spec.target)
  const outer = clamp(spec.outer)

  const tickAngle = target * 360
  const tickInner = ringPoint(tickAngle, INNER.tick[0], INNER.tick[0])
  const tickOuter = ringPoint(tickAngle, INNER.tick[1], INNER.tick[1])

  const [frameRef, frame] = useBoxSize<HTMLDivElement>()
  const drawable = frame.w > 40 && frame.h > 40
  // The open end, which is where the label belongs: a caption on the gap is
  // what stops the room reading an unfinished ring as a finished one.
  const stop = drawable ? frameRingStop(frame.w, frame.h, outer) : null

  return (
    <div className="fig-cr" ref={frameRef}>
      {/* The full form, around everything. Its viewBox is the element's own
          pixel box, so the corners are round and the dash arithmetic that stops
          it at `outer` is measured in the units the path is drawn in. */}
      {drawable ? (
        <svg
          className="fig-cr-frame-ring"
          viewBox={`0 0 ${frame.w} ${frame.h}`}
          width={frame.w}
          height={frame.h}
          aria-hidden="true"
        >
          <path
            className="fig-cr-frame-track"
            d={frameRingPath(frame.w, frame.h)}
            strokeWidth={FRAME_RING.weight}
          />
          <path
            className="fig-cr-frame-arc"
            d={frameRingPath(frame.w, frame.h)}
            strokeWidth={FRAME_RING.weight}
            pathLength={1}
            strokeDasharray="1 1"
            style={{ strokeDashoffset: 1 - (phase >= 4 ? outer : 0) }}
          />
        </svg>
      ) : null}

      {stop === null ? null : (
        <span
          className="fig-cr-outer-label"
          // Which way the label hangs off the stop is decided by where in the
          // frame the stop landed, not by which edge it is on. Centred on a
          // bottom-edge stop three quarters of the way across, the caption ran
          // off the right of the stage and lost "never required" — which is
          // half of what the slide is claiming.
          data-anchor={stop.x > frame.w * 0.62 ? 'end' : stop.x < frame.w * 0.38 ? 'start' : 'middle'}
          style={{ left: stop.x, top: stop.y, opacity: phase >= 5 ? 1 : 0 }}
        >
          {spec.outerLabel}
        </span>
      )}

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
          <p className="fig-cr-inner-label">{spec.innerLabel}</p>
        </div>
      </div>
    </div>
  )
}
