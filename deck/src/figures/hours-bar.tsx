import type { HoursBarFigure } from './types'
import { usePhase, type FigureBody } from './kit'

/**
 * `problem-hours-and-price` — The 150–300 hours, who says so, and what they cost.
 *
 * One bar, monochrome, because the slide's whole rhetorical trick is that a
 * single quantity is being read four different ways: as a duration, as an
 * attribution, as a video curriculum, and as a monthly bill. Four charts would
 * hand the audience four things to compare. One bar with four passes over it
 * hands them one thing that keeps turning out to be worse.
 *
 * The blank tick is the most important mark on the slide. Three prep companies
 * publish a range and the organisation that writes the exam does not, so LSAC's
 * tick gets a dashed empty bracket where a number would be, and its rule is drawn
 * at full strength while the others are dim. An absence has to be *drawn* to be
 * read as a refusal rather than as a rendering bug.
 *
 * The outcome sliver is at true proportion and is therefore nearly invisible,
 * which is why it is labelled with a leader line above the bar rather than beside
 * itself.
 */

/**
 * How much of the bar the outcome is worth.
 *
 * `HoursBarFigure` gives the outcome as a string ("a few points") with no
 * magnitude, and the narrative asks for "true relative proportion". A few scale
 * points against 250 hours of study is on the order of one percent of the bar,
 * which is the figure used here. If the contract ever grows an `outcomeFraction`,
 * this constant is what it replaces.
 */
const MARKS = [40, 760] as const

export function HoursBar({ spec, active, reduced }: FigureBody<HoursBarFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const hours = spec.barLabel.match(/\d+–\d+/)?.[0] ?? spec.barLabel
  const price = spec.price.match(/\$\d+–\$?\d+/)?.[0] ?? spec.price
  const sources = spec.ticks.filter((tick) => tick.range).map((tick) => tick.source).join(' · ')

  return (
    <div className="fig-hb fig-hb-comparison">
      <section className="fig-hb-metric" style={{ opacity: phase >= 1 ? 1 : 0 }}>
        <b>{hours}</b>
        <span>recommended hours</span>
        <small>{sources}</small>
      </section>
      <i className="fig-hb-versus" style={{ opacity: phase >= 2 ? 1 : 0 }}>and then</i>
      <section className="fig-hb-metric is-cost" style={{ opacity: phase >= 2 ? 1 : 0 }}>
        <b>{price}</b>
        <span>every month</span>
        <small>for as long as you study</small>
      </section>
    </div>
  )
}
