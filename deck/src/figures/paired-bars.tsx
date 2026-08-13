import type { PairedBarsFigure } from './types'
import { usePhase, vars, type FigureBody } from './kit'

/**
 * `game-by-design` — Clark's four splits, ours against the alternative.
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
const PAIR_STAGGER_MS = 300

/** When the first pair starts, and how long after the last one the four ours-bars pulse. */
const FIRST_PAIR_MS = 180
const PULSE_GAP_MS = 320

export function PairedBars({ spec, active, reduced }: FigureBody<PairedBarsFigure>) {
  const pairs = spec.pairs
  const marks = [
    40,
    ...pairs.map((_pair, index) => FIRST_PAIR_MS + index * PAIR_STAGGER_MS),
    FIRST_PAIR_MS + pairs.length * PAIR_STAGGER_MS + PULSE_GAP_MS,
  ]
  const phase = usePhase(active, reduced, marks)

  return (
    <div className="fig-pb fig-pb-tiles">
      {pairs.map((pair, index) => (
        <section
          className="fig-pb-tile"
          key={pair.label}
          style={vars({ opacity: phase >= index + 2 ? 1 : 0, '--fig-delay': `${index * 80}ms` })}
        >
          <p>{pair.label}</p>
          <div className="fig-pb-result is-ours">
            <b>{formatSplit(pair.ours.value)}</b>
            <span>{pair.ours.label}</span>
          </div>
          <div className="fig-pb-result is-alt">
            <b>{formatSplit(pair.theirs.value)}</b>
            <span>{pair.theirs.label}</span>
          </div>
        </section>
      ))}
    </div>
  )
}

/** Signed to two places, with a true minus sign rather than a hyphen. */
function formatSplit(value: number): string {
  const text = value.toFixed(2)
  return value > 0 ? `+${text}` : text.replace('-', '\u2212')
}
