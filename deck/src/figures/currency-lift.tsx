import type { CurrencyLiftFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'
import './currency-lift.css'

/**
 * SLIDE 16 — `currency-lift`. What a virtual currency actually moves, and what
 * it does not.
 *
 * The slide it replaced argued points against badges, which is a comparison
 * between two game elements rather than a mechanism. This figure states the
 * mechanism instead: three courses at three universities, currency isolated
 * from every other game element, and the only thing that moved was how much
 * practice got done. So the argument is one shared control line with three bars
 * running past it.
 *
 * The two nulls — intrinsic motivation, final course grades — used to be drawn
 * here too, under a rule, as a pair of flat stubs labelled "DID NOT MOVE". They
 * are now only on the fragment line. That is not a demotion: they are the whole
 * reason a room that distrusts gamification believes the rest of the slide, and
 * on the fragment line they are set in the body face at a size the back row can
 * read, where in the figure they were a hairline stub, a pixel-face label at
 * .76rem, and two strings that said what the fragment line said. Twice, once
 * illegibly, is not emphasis.
 *
 * The overshoot idiom is deliberately the one the room already learned on slide
 * 2, where a stub bar and a long bar carried 0.22 against 2.77. Reusing it here
 * is what lets the game act's opening claim read as the same kind of evidence as
 * the indictment's, rather than as a marketing chart that arrived late.
 *
 * One control line rather than three: the three courses have wildly different
 * absolute volumes (985 challenges against 198), so plotting their raw counts
 * would compare the courses to each other, which is not the claim. Every row is
 * normalised to its own comparison group, and the gate is where all three
 * comparison groups sit.
 */

/** How much of the track the longest run may take, so the multiple has somewhere to sit. */
const LONGEST_RUN = 0.88

/** Per-row delay, so three bars read as three findings rather than one animation. */
const ROW_STAGGER_MS = 340

export function CurrencyLift({ spec, active, reduced }: FigureBody<CurrencyLiftFigure>) {
  const rowMarks = spec.rows.map((_row, index) => 420 + index * ROW_STAGGER_MS)
  const last = rowMarks[rowMarks.length - 1] ?? 420
  const phase = usePhase(active, reduced, [40, ...rowMarks, last + 640])

  // The unit is derived from the longest run rather than fixed, so correcting a
  // number in the registry re-scales the plot instead of overflowing it.
  const longest = Math.max(...spec.rows.map((row) => row.multiple), 1)
  const unit = LONGEST_RUN / longest

  return (
    <div className="fig-cl">
      <p className="fig-cl-lede" style={{ opacity: phase >= 1 ? 1 : 0 }}>
        {spec.measureLabel}
      </p>

      <ol className="fig-cl-rows">
        {spec.rows.map((row, index) => {
          const shown = phase >= 2 + index
          return (
            <li className="fig-cl-row" key={row.course}>
              <div
                className="fig-cl-where"
                style={vars({ opacity: phase >= 1 ? 1 : 0, '--fig-delay': `${index * 70}ms` })}
              >
                <b>{row.course}</b>
                <span>{row.venue}</span>
              </div>

              <div className="fig-cl-track">
                {/* Parked at the control length rather than at zero, so the bar is
                    seen *passing* the gate. Growing from nothing would read as the
                    bar being drawn, and the overshoot is the whole finding. */}
                <i
                  className="fig-cl-run"
                  style={{ width: shown ? pct(unit * row.multiple) : pct(unit) }}
                />
                <i className="fig-cl-gate" style={{ left: pct(unit) }}>
                  {index === 0 ? <span>{spec.controlLabel}</span> : null}
                </i>
              </div>

              <b className="fig-cl-mult" style={{ opacity: shown ? 1 : 0 }}>
                {row.multiple.toFixed(1)}×
              </b>
            </li>
          )
        })}
      </ol>

    </div>
  )
}
