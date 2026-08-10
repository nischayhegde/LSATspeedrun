import type { PairedBarsFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'

/**
 * SLIDE 17 — `paired-bars`. Clark's four splits, ours against the alternative.
 *
 * The alternatives are negative, and that is the entire visual argument, so the
 * zero line is drawn and the axis extends below it. What the axis does *not* do is
 * amplify: −0.06 is plotted at an eighth the length of 0.48 because that is what it
 * is. The extra room under zero is headroom for the numeral, not a second scale —
 * a chart that made the negative bars look comparable in magnitude would be making
 * a stronger claim than the meta-analysis does, on a slide whose footnote already
 * admits the sample was thirteen-year-olds.
 *
 * All four pairs share one plot so they share one zero line. The per-pair rows
 * under the plot are fixed-height for the same reason: a label wrapping to two
 * lines in one pair must not shorten that pair's plot and tilt the zero line.
 */

/**
 * Delay between pairs. The narrative wants roughly one every three seconds as the
 * presenter names them; 600ms is the screenshot-and-rehearsal setting, because a
 * figure that takes twelve seconds to finish cannot be captured or reviewed. Raise
 * it to 3000 to run it live at speaking pace.
 */
const PAIR_STAGGER_MS = 600

/** When the first pair starts, and how long after the last one the four ours-bars pulse. */
const FIRST_PAIR_MS = 300
const PULSE_GAP_MS = 500

/**
 * Headroom above the tallest bar and below the deepest, as multiples of those
 * values.
 *
 * The headroom is not whitespace, it is the numerals' row. Each bar's value is
 * set above its own top at display scale, so the space left over above the
 * tallest bar has to be at least one line of that face — at 1.12 it was about
 * half a line and `+0.48`, the tallest, had its numeral cut off along the top
 * of the plot.
 */
const HEADROOM = 1.34
const UNDERROOM = 2.6

export function PairedBars({ spec, active, reduced }: FigureBody<PairedBarsFigure>) {
  const pairs = spec.pairs
  const marks = [
    40,
    ...pairs.map((_pair, index) => FIRST_PAIR_MS + index * PAIR_STAGGER_MS),
    FIRST_PAIR_MS + pairs.length * PAIR_STAGGER_MS + PULSE_GAP_MS,
  ]
  const phase = usePhase(active, reduced, marks)
  const pulsing = phase >= pairs.length + 2

  const values = pairs.flatMap((pair) => [pair.ours.value, pair.theirs.value])
  const highest = Math.max(0, ...values)
  const lowest = Math.min(0, ...values)
  const top = highest * HEADROOM || 1
  const bottom = lowest !== 0 ? lowest * UNDERROOM : -top * 0.16
  const range = top - bottom
  // Where zero sits, measured down from the top of the plot.
  const zero = top / range

  return (
    <div className="fig-pb">
      {/* The plot holds nothing but bars, so the zero line's `top` is a percentage
          of the same box the bars are measured in. The labels are a second row with
          the same gaps and the same flexing, which keeps them aligned under their
          pair without letting a two-line label shorten one pair's plot and tilt the
          zero line. */}
      <div className="fig-pb-plot">
        <span className="fig-pb-zero" style={{ top: pct(zero), opacity: phase >= 1 ? 1 : 0 }} />

        {pairs.map((pair, index) => {
          const shown = phase >= index + 2
          return (
            <div className="fig-pb-pair" key={pair.label}>
              {[pair.ours, pair.theirs].map((series, side) => {
                const negative = series.value < 0
                const length = shown ? Math.abs(series.value) / range : 0
                return (
                  <div className="fig-pb-col" key={series.label}>
                    <div
                      className="fig-pb-bar"
                      data-side={side === 0 ? 'ours' : 'theirs'}
                      data-negative={negative ? 'true' : 'false'}
                      data-pulse={side === 0 && pulsing ? 'true' : 'false'}
                      style={vars({
                        height: pct(length),
                        top: negative ? pct(zero) : 'auto',
                        bottom: negative ? 'auto' : pct(1 - zero),
                        '--fig-delay': `${side * 120}ms`,
                      })}
                    >
                      <span className="fig-pb-value" style={{ opacity: shown ? 1 : 0 }}>
                        {formatSplit(series.value)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="fig-pb-axis">
        {pairs.map((pair, index) => (
          <div className="fig-pb-pair-name" key={pair.label} style={{ opacity: phase >= index + 2 ? 1 : 0 }}>
            <div className="fig-pb-legs">
              <span data-side="ours">{pair.ours.label}</span>
              <span data-side="theirs">{pair.theirs.label}</span>
            </div>
            <p className="fig-pb-name">{pair.label}</p>
          </div>
        ))}
      </div>

      <p className="fig-pb-foot" style={{ opacity: phase >= 1 ? 1 : 0 }}>
        {spec.footnote}
      </p>
    </div>
  )
}

/** Signed to two places, with a true minus sign rather than a hyphen. */
function formatSplit(value: number): string {
  const text = value.toFixed(2)
  return value > 0 ? `+${text}` : text.replace('-', '\u2212')
}
