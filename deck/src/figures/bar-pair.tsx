import type { BarPairFigure } from './types'
import { ExtrudedNumeral } from './extruded-numeral'
import { pct, usePhase, type FigureBody } from './kit'

/**
 * SLIDE 2 — `bar-pair`. Coaching's 0.22 against real LSATs' 2.77.
 *
 * The ratio is the argument, so the ratio is the drawing: the bars are scaled
 * against the larger value with no compression, no broken axis and no minimum
 * length on the stub. At 0.22 against 2.77 the short bar is 7.9% of the long one,
 * which looks like a mistake — and looking like a mistake is the point, because
 * it is the number the industry sells.
 *
 * Two things the layout has to protect. First, the numerals sit *past* the end of
 * their bars, which means the plotting width is the frame minus a gutter wide
 * enough for `+2.77`; if the long bar ran to the frame edge its numeral would
 * have to sit inside it and the two bars would be labelled differently. Second,
 * the empty span between the two bar ends is a mark in its own right — it gets a
 * dimension line and `gapNote` — so nothing decorative may fill it.
 *
 * The share tags carry the inversion (nearly half bought the course; barely a
 * third had finished a real test), which is why the percentages are set at
 * display scale rather than as captions: a room reads two big numbers crossing
 * over, and does not read two footnotes.
 */

/**
 * The entrance, in cumulative milliseconds. The stub is fast and the tall bar is
 * slow, which is a CSS duration rather than a mark — what these control is the
 * order the *type* lands in, so the audience reads the bar, then its number, then
 * the behaviour that contradicts it.
 */
const MARKS = [40, 620, 1900, 2320, 2900] as const

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
    // Each bar's numeral waits for its own bar rather than for a shared beat: the
    // stub's number is on screen and unimpressive while the tall bar is still
    // growing, which is the rhetorical shape of the slide.
    const numeralPhase = bar.stub ? 2 : 3
    return (
      <div className="fig-bp-row" key={bar.label} data-stub={bar.stub ? 'true' : 'false'}>
        <p className="fig-bp-name">{bar.label}</p>
        <div className="fig-bp-track">
          <div className="fig-bp-run" style={{ width: phase >= 1 ? pct(end) : '0%' }} />
          <div
            className="fig-bp-value"
            style={{
              left: pct(end),
              opacity: phase >= numeralPhase ? 1 : 0,
              transform: phase >= numeralPhase ? 'translate(0, -50%)' : 'translate(-.4em, -50%)',
            }}
          >
            {formatEffect(bar.value)}
          </div>
          {/* The share tag sits under the *start* of its bar rather than at its
              end. Chased to the end, the tall bar's tag would run off the frame
              into the numeral gutter, and left-aligning both of them stacks
              45.5% directly above 34.9%, which is the crossover the slide is
              about. */}
          <div
            className="fig-bp-share"
            style={{
              opacity: phase >= 4 ? 1 : 0,
              transform: phase >= 4 ? 'translateY(0)' : 'translateY(-.5em)',
            }}
          >
            <b>{bar.share}</b>
            <span>{bar.shareLabel}</span>
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
