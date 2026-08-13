import type { RetentionLoopFigure } from './types'
import { usePhase, vars, type FigureBody } from './kit'
import './retention-loop.css'

/**
 * `game-by-design` — one practice loop, with the unassisted
 * failure path left visible.
 *
 * Five equal stations in one row. Connectors live in the column-gap, drawn
 * from each station's right edge, so a stroke cannot enter a label. 01–02
 * stay in the field ink; a gold band then takes 03–05 as a designed chapter,
 * not a leftover palette swap. Burnout hangs under 02 after that pair has
 * landed. 05 and the return path close the loop together, in a lane of their
 * own.
 *
 * The route draws once and holds. Nothing loops under the speaker.
 */
const MARKS = [40, 280, 720, 1100, 1480, 1860] as const

export function RetentionLoop({ spec, active, reduced }: FigureBody<RetentionLoopFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const steps = spec.steps.slice(0, 5)

  return (
    <div className="fig-rl">
      <div className="fig-rl-stations">
        <div className="fig-rl-gameband" data-shown={phase >= 4 ? 'true' : 'false'} aria-hidden="true" />
        {steps.map((step, index) => {
          const shown = phase >= stationPhase(index)
          const next = steps[index + 1]
          const nextShown = next ? phase >= stationPhase(index + 1) : false
          return (
            <div className="fig-rl-cell" key={step.kicker} style={{ gridColumn: index + 1, gridRow: 1 }}>
              <section
                className="fig-rl-step"
                data-role={step.role}
                data-shown={shown ? 'true' : 'false'}
                style={vars({ '--fig-delay': `${index * 40}ms` })}
              >
                <small>{step.kicker}</small>
                <b>{step.label}</b>
              </section>
              {next ? (
                <i
                  className="fig-rl-arrow"
                  data-shown={nextShown ? 'true' : 'false'}
                  data-tone={next.role === 'game' || step.role === 'game' ? 'gold' : 'ink'}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          )
        })}
        <aside className="fig-rl-risk" data-shown={phase >= 3 ? 'true' : 'false'} style={{ gridColumn: 2, gridRow: 2 }}>
          <i aria-hidden="true" />
          <b>{spec.risk.label}</b>
          <span>{spec.risk.note}</span>
        </aside>
      </div>

      <div className="fig-rl-bottom">
        <svg className="fig-rl-return" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="fig-rl-head" viewBox="0 0 8 8" refX="4" refY="1.2" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 8 L4 0 L8 8 Z" fill="context-stroke" />
            </marker>
          </defs>
          <path
            className="fig-rl-return-path"
            data-drawn={phase >= 6 ? 'true' : 'false'}
            markerEnd={phase >= 6 ? 'url(#fig-rl-head)' : undefined}
            d="M900 2 V28 H100 V2"
          />
        </svg>
        <p className="fig-rl-return-label" data-shown={phase >= 6 ? 'true' : 'false'}>
          {spec.returnLabel}
        </p>
      </div>
    </div>
  )
}

/** 01 and 02 land first; phase 3 is the burnout beat; 03–04 follow; 05 closes. */
function stationPhase(index: number): number {
  return index <= 1 ? index + 1 : index + 2
}
