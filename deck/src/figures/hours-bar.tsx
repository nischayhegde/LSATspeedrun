import type { HoursBarFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'

/**
 * SLIDE 3 — `hours-bar`. The 150–300 hours, who says so, and what they cost.
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
const OUTCOME_FRACTION = 0.01

/**
 * Cumulative milliseconds: bar, attributions, the two curriculum quotes, the
 * price, the line item nobody mentions — and last of all the outcome.
 *
 * The order is the argument and `NARRATIVE.md` is specific about the end of it:
 * the sliver draws *last, and slowly*. Drawn third, as it was, the room saw
 * what the hours buy before it had finished being told what the hours cost, and
 * the sliver was just a small mark early in a sequence. Drawn after the bill,
 * against a bar the room has by then watched acquire four separate meanings, a
 * one-percent smudge at the far right is the punchline. Slowly, because the eye
 * has to be given time to follow the leader line out to it and find almost
 * nothing there.
 */
const MARKS = [40, 900, 2500, 3100, 3700, 4900, 6100] as const

export function HoursBar({ spec, active, reduced }: FigureBody<HoursBarFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const grained = phase >= 3

  return (
    <div className="fig-hb">
      <p className="fig-hb-label">{spec.barLabel}</p>

      <div className="fig-hb-plot">
        <div className="fig-hb-outcome" style={{ opacity: phase >= 7 ? 1 : 0 }}>
          <span className="fig-hb-outcome-name">{spec.outcome}</span>
          <span className="fig-hb-outcome-lead" />
        </div>

        <div className="fig-hb-bar">
          <div className="fig-hb-fill" style={{ width: phase >= 1 ? '100%' : '0%' }}>
            <span className="fig-hb-wash" />
            {/* The hours becoming lecture: scanlines arrive with the curriculum
                quotes, and they live inside the clipped fill so an un-drawn bar
                is never textured. */}
            <span className="fig-hb-grain" style={{ opacity: grained ? 0.34 : 0 }} />
          </div>
          <div
            className="fig-hb-sliver"
            style={{ width: phase >= 7 ? pct(OUTCOME_FRACTION) : '0%' }}
          />
        </div>

        {spec.ticks.map((tick, index) => (
          <div
            className="fig-hb-tick"
            key={`${tick.source}-${tick.at}`}
            data-blank={tick.range === undefined ? 'true' : 'false'}
            data-anchor={anchorFor(tick.at)}
            style={vars({
              left: pct(tick.at),
              opacity: phase >= 2 ? 1 : 0,
              '--fig-delay': `${index * 90}ms`,
            })}
          >
            <span className="fig-hb-tick-rule" />
            <span className="fig-hb-tick-body">
              <span className="fig-hb-source">{tick.source}</span>
              {tick.range === undefined ? (
                // No copy stands in for the missing range: a dashed bracket with a
                // hairline where the digits would be says "declined to answer"
                // without putting words in LSAC's mouth.
                <span className="fig-hb-blank">
                  <span className="fig-hb-blank-dash" />
                </span>
              ) : (
                <span className="fig-hb-range">{tick.range}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="fig-hb-curriculum">
        {spec.curriculum.map((fragment, index) => (
          <p
            className="fig-hb-quote"
            key={fragment}
            style={{
              opacity: phase >= 3 + index ? 1 : 0,
              transform: phase >= 3 + index ? 'translateY(0)' : 'translateY(.4em)',
            }}
          >
            {fragment}
          </p>
        ))}
      </div>

      <div className="fig-hb-bill">
        <div
          className="fig-hb-ribbon"
          style={{ transform: phase >= 5 ? 'translateX(0)' : 'translateX(-102%)' }}
        >
          <span>{spec.price}</span>
        </div>
        <p
          className="fig-hb-late"
          style={{
            opacity: phase >= 6 ? 1 : 0,
            transform: phase >= 6 ? 'translateY(0)' : 'translateY(-.4em)',
          }}
        >
          {spec.lateLineItem}
        </p>
      </div>
    </div>
  )
}

/** Ticks near either end anchor their type inward so nothing hangs off the frame. */
function anchorFor(at: number): 'start' | 'middle' | 'end' {
  if (at <= 0.08) return 'start'
  if (at >= 0.92) return 'end'
  return 'middle'
}
