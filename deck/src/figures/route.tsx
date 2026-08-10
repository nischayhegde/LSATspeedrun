import type { RouteFigure } from './types'
import { DRAW, DRAW_PX, clockText, pct, usePhase, useStopwatch, vars, type FigureBody } from './kit'

/**
 * SLIDE 5 — `route`. The speedrun route: three nodes skipped, one taken.
 *
 * Played straight as a speedrun graphic, because the metaphor is doing real work
 * here and a tasteful version of it would be a worse argument. A route in a
 * speedrun is a *committed* line: it does not visit and dismiss the intro course,
 * it never goes there, and the diagonal is hard-cornered for exactly that reason.
 * Curving it would read as a detour rather than a refusal.
 *
 * Under two seconds end to end, and it never repeats. The one thing that keeps
 * moving is the HUD clock, which is the one thing a speedrun HUD is for.
 */

/** Cumulative milliseconds. Skipped nodes stagger inside their own beat, so the count of nodes does not change the runtime. */
const MARKS = [40, 420, 1000, 1500] as const

/** How far apart the skip ticks land. Three nodes at 150ms is a rhythm; five is still under the budget. */
const SKIP_STAGGER_MS = 150

/** The lane the curriculum sits on, and the lane the route ends on, in percent of the frame. */
const SKIP_LANE = 34
const TAKEN_LANE = 70

/** Where the readout is held when motion is off: a plausible mid-run split rather than a row of zeroes. */
const FROZEN_MS = 52_400

export function Route({ spec, active, reduced }: FigureBody<RouteFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const elapsed = useStopwatch(active, reduced, FROZEN_MS)

  const nodes = spec.nodes
  const count = Math.max(nodes.length, 2)
  const left = 15
  const right = 85
  const step = (right - left) / (count - 1)
  const xOf = (index: number) => left + index * step

  // The route's destination is the first node it does not skip. Falling back to
  // the last node keeps the figure drawable if a registry ever marks them all.
  const takenIndex = nodes.findIndex((node) => !node.skipped)
  const destination = takenIndex >= 0 ? takenIndex : nodes.length - 1

  const lead = `M 3 ${SKIP_LANE} L ${xOf(0) - 5} ${SKIP_LANE}`
  const cut = `M ${xOf(0) - 5} ${SKIP_LANE} L ${xOf(destination) - 5} ${TAKEN_LANE} L 97 ${TAKEN_LANE}`

  let skipOrder = 0

  return (
    <div className="fig-rt">
      {/* The track is the first child, on the HUD's leading edge, because the
          transition in from slide 4 lands the collapsed numeral on it and a
          target that moved with the label's width would be a target that
          moved between projectors. */}
      <div className="fig-rt-hud" style={{ opacity: phase >= 1 ? 1 : 0 }}>
        <span
          className="fig-rt-hud-track"
          data-morph="timer-track"
          style={vars({ '--rt-progress': pct(phase >= 3 ? 1 : phase >= 1 ? .18 : 0) })}
        />
        <span className="fig-rt-hud-label">{spec.timerLabel}</span>
        <span className="fig-rt-hud-clock">{clockText(elapsed)}</span>
      </div>

      <svg className="fig-rt-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {/* Non-scaling strokes with a screen-space dash — see `DRAW_PX`. The
            viewBox has to stretch, because the route's node positions are
            percentages of the frame and must stay under their labels at any
            aspect; the stroke must not, because a route drawn three times
            thicker on its diagonal than on its horizontals is a wedge. */}
        <path
          className="fig-rt-lead"
          d={lead}
          vectorEffect="non-scaling-stroke"
          style={{ strokeDashoffset: phase >= 1 ? 0 : DRAW_PX }}
        />
        <path
          className="fig-rt-cut"
          d={cut}
          vectorEffect="non-scaling-stroke"
          style={{ strokeDashoffset: phase >= 3 ? 0 : DRAW_PX }}
        />
      </svg>

      {nodes.map((node, index) => {
        const skipped = index !== destination && node.skipped
        const struck = skipped && phase >= 2
        const delay = skipped ? `${(skipOrder++) * SKIP_STAGGER_MS}ms` : '0ms'
        const arrived = index === destination && phase >= 3
        return (
          <div
            className="fig-rt-node"
            key={`${node.label}-${index}`}
            data-skipped={skipped ? 'true' : 'false'}
            data-struck={struck ? 'true' : 'false'}
            data-taken={index === destination ? 'true' : 'false'}
            data-arrived={arrived ? 'true' : 'false'}
            style={vars({
              left: pct(xOf(index) / 100),
              top: pct((index === destination ? TAKEN_LANE : SKIP_LANE) / 100),
              // A struck node greys out rather than disappearing: the audience has
              // to see that the intro course still exists and is simply not on the
              // route.
              opacity: phase < 1 ? 0 : struck ? 0.42 : 1,
              '--fig-delay': delay,
            })}
          >
            <span className="fig-rt-dot">
              <span className="fig-rt-ring" style={{ opacity: phase >= 4 && index === destination ? 1 : 0 }} />
            </span>
            <span className="fig-rt-node-label">{node.label}</span>
            {skipped ? (
              <svg className="fig-rt-tick" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M 2 7.6 L 5.4 11 L 12 3"
                        style={{ strokeDashoffset: struck ? 0 : DRAW }}
                />
              </svg>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
