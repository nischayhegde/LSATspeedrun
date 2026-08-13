import type { BarPairFigure } from './types'
import { pct, usePhase, type FigureBody } from './kit'

/**
 * `problem-coaching-tax` — Coaching's 0.22 against real LSATs' 2.77.
 *
 * The ratio is the argument, so the ratio is the drawing: the bars are scaled
 * against the larger value with no compression, no broken axis and no minimum
 * length on the stub. At 0.22 against 2.77 the short bar is 7.9% of the long one,
 * which looks like a mistake — and looking like a mistake is the point, because
 * it is the number the industry sells.
 *
 * Two things the layout has to protect. First, the numerals sit *past* the end of
 * their bars, so the plotting width reserves a value gutter wide enough for
 * `+2.77`. Second, the empty span between the two bar ends is a mark in its own
 * right — it gets a dimension line and `gapNote` — so nothing decorative may
 * fill it.
 *
 * The share tags carry the inversion (nearly half bought the course; barely a
 * third had finished a real test), but they stay attached to their true rows.
 * The earlier vertical swap made the percentages temporarily belong to the
 * wrong labels and sent them through the stage clip. A restrained reveal makes
 * the same argument without asking the audience to decode choreography.
 */

/**
 * The entrance, in cumulative milliseconds. Labels establish the two rows,
 * both bars reveal from a fixed mask, values settle beside their endpoints,
 * percentages appear, then the comparison rule resolves the thought. The
 * whole sequence is brief enough to finish while the presenter delivers the
 * setup, with no spring easing or moving targets.
 */
const MARKS = [80, 260, 780, 1040, 1320] as const

export function BarPair({ spec, active, reduced }: FigureBody<BarPairFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const bars = spec.bars
  const peak = Math.max(...bars.map((bar) => Math.abs(bar.value)), Number.EPSILON)

  // Where the two bars end, as fractions of the plotting width. The gap note is
  // drawn between the two extremes rather than between "bar 0" and "bar 1", so a
  // registry that lists the tall bar first still annotates the right span.
  const ends = bars.map((bar) => Math.abs(bar.value) / peak)
  const gapFrom = Math.min(...ends)
  const gapTo = Math.max(...ends)

  const rows = bars.map((bar, index) => {
    const end = ends[index] ?? 0
    return (
      <div
        className="fig-bp-row"
        key={bar.label}
        data-visible={phase >= 1 ? 'true' : 'false'}
        data-stub={bar.stub ? 'true' : 'false'}
      >
        <p className="fig-bp-name">{bar.label}</p>
        <div className="fig-bp-track">
          <div
            className="fig-bp-run"
            style={{
              width: pct(end),
              transform: phase >= 2 ? 'scaleX(1)' : 'scaleX(0)',
            }}
          />
          <div
            className="fig-bp-value"
            style={{
              left: pct(end),
              opacity: phase >= 3 ? 1 : 0,
              transform: phase >= 3
                ? 'translate(.72em, -50%)'
                : 'translate(.72em, calc(-50% + .16em))',
            }}
          >
            {formatEffect(bar.value)}
          </div>
          <div
            className="fig-bp-share"
            aria-label={`${bar.share} ${bar.shareLabel}`}
            style={{
              opacity: phase >= 4 ? 1 : 0,
              transform: phase >= 4 ? 'translateY(0)' : 'translateY(.16em)',
            }}
          >
            <b>{bar.share}</b>
          </div>
        </div>
      </div>
    )
  })

  // The dimension line lives *between* the two rows, so it is spliced into the
  // row list rather than appended after it.
  const gapStrip = spec.gapNote ? (
    <div className="fig-bp-gapstrip" key="gap">
      <div
        className="fig-bp-gap"
        style={{ left: pct(gapFrom), width: pct(gapTo - gapFrom), opacity: phase >= 5 ? 1 : 0 }}
      >
        <span className="fig-bp-gap-rule" />
        <span className="fig-bp-gap-note">{spec.gapNote}</span>
        <span className="fig-bp-gap-rule" />
      </div>
    </div>
  ) : null

  return (
    <div className="fig-bp-scale">
      {rows[0]}
      {gapStrip}
      {rows.slice(1)}
    </div>
  )
}

/**
 * Effect sizes are signed quantities, and the deck's own copy sets them as `+0.22`
 * and `+2.77`, so the sign is part of the number rather than punctuation.
 */
function formatEffect(value: number): string {
  const text = Math.abs(value) < 10 ? value.toFixed(2) : value.toFixed(1)
  return value > 0 ? `+${text}` : text
}
