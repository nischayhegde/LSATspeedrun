import type { CohortSplitFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'
import './cohort-split.css'

/**
 * SLIDE 8 — `cohort-split`. The method is not in dispute. Finishing it is.
 *
 * This is the slide that makes the game load-bearing instead of decorative, and
 * the figure has to carry an argument in a specific order or the game reads as a
 * nice extra when it arrives twenty seconds later:
 *
 *   1. A cohort exists and it is large. The bar fills the whole track.
 *   2. Half of it never started. The bar retreats and leaves its own footprint
 *      behind, hatched, at exactly the width it used to occupy.
 *   3. For the half that did, one input moved the score and the other did not.
 *
 * The retreat is the whole design. A 51/49 split drawn as two adjacent blocks is
 * a pie chart in a costume — it states a proportion and states nothing about
 * loss. Drawing the full bar first and then pulling it back to 49% makes the
 * missing half a thing the room *watched leave*, and the hatched footprint is
 * what stops it reading as a rendering glitch. `hours-bar` makes the same move
 * with LSAC's blank tick, and for the same reason: an absence has to be drawn or
 * it is not read as a refusal.
 *
 * The input ledger below the rule is the competitive claim, and it is a claim
 * only because one of the two rows has nothing in it. Video minutes get a bare
 * origin tick — not a short bar, not a bar with a small number on it — because
 * LSAC's finding is not that video is weak. It is that video was not correlated
 * with the score at all, which is a different shape.
 *
 * The practice row is not a bar either, and that is a correction rather than a
 * flourish. It ran from an origin to 0.6 with the annotation `26 min → 47 h`,
 * and both of those depict one student moving up a dose curve — the arrow
 * explicitly so. LSAC disclaims that reading in the same paragraph that carries
 * the 4.3: the figures are "not gains... but rather increments for independent
 * groups of students". So the row now draws the two groups as two marks with an
 * unarrowed span between them, which is how a difference between group means is
 * normally drawn and cannot be read as a journey.
 */

/** Cumulative marks: track, fill, retreat, then one input row each. */
const MARKS = [40, 520, 1180, 1780, 2260] as const

export function CohortSplit({ spec, active, reduced }: FigureBody<CohortSplitFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const retreated = phase >= 3

  return (
    <div className="fig-cs">
      {/* The caption belongs to the bar, not to the figure, so it is inside the
          group. The two of them then travel together when the flex column
          distributes its slack, which is what keeps the caption tight under the
          slide's standfirst instead of stranded halfway down the stage. */}
      <div className="fig-cs-cohort">
        <p className="fig-cs-lede" style={{ opacity: phase >= 1 ? 1 : 0 }}>
          {spec.cohortLabel}
        </p>

        {/* The footprint. Present from the first beat at full width, so the fill
            retreating inside it reads as the cohort shrinking rather than as the
            figure resizing. */}
        <div className="fig-cs-track" style={{ opacity: phase >= 1 ? 1 : 0 }}>
          <i className="fig-cs-hatch" style={{ opacity: retreated ? 1 : 0 }} />
          <i
            className="fig-cs-fill"
            style={{ width: retreated ? pct(spec.keptShare) : phase >= 2 ? '100%' : '0%' }}
          />
        </div>

        <div className="fig-cs-legend" style={{ opacity: retreated ? 1 : 0 }}>
          <span className="fig-cs-kept" style={{ width: pct(spec.keptShare) }}>
            {spec.keptLabel}
          </span>
          <span className="fig-cs-lost">{spec.lostLabel}</span>
        </div>
      </div>

      {/* What the same study measured against a real LSAT score. Two rows, and
          the argument is that they are not the same length. */}
      <ol className="fig-cs-inputs">
        {spec.inputs.map((input, index) => {
          const shown = phase >= 4 + index
          return (
            <li
              className="fig-cs-input"
              key={input.label}
              data-emphasis={input.emphasis ? 'true' : 'false'}
              style={{ opacity: shown ? 1 : 0 }}
            >
              <b className="fig-cs-input-name">{input.label}</b>

              <div className="fig-cs-run" data-shape={input.shape}>
                {input.shape === 'null' ? (
                  <i className="fig-cs-origin" />
                ) : (
                  <>
                    {/* Drawn from the low group outward, so the span is seen to
                        open up between two marks that were both already there,
                        rather than to travel from one to the other. */}
                    <i
                      className="fig-cs-span"
                      style={vars({
                        left: pct(input.low.at),
                        width: shown ? pct(input.high.at - input.low.at) : '0%',
                        '--fig-delay': `${index * 60}ms`,
                      })}
                    />
                    {[input.low, input.high].map((group) => (
                      <span
                        className="fig-cs-group"
                        key={group.label}
                        style={{ left: pct(group.at) }}
                      >
                        <i className="fig-cs-node" />
                        <b className="fig-cs-dose">{group.label}</b>
                      </span>
                    ))}
                  </>
                )}
              </div>

              <div className="fig-cs-verdict">
                <b>{input.verdict}</b>
                {input.note ? <span>{input.note}</span> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
