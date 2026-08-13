import type { TracesFigure } from './types'
import { usePhase, type FigureBody } from './kit'

/**
 * `pov-ai-never-answers` — Bastani's practice gains, the exam that followed, and the
 * guardrailed tutor that lands level with the control.
 *
 * The only slide in the deck permitted misdirection, and the misdirection is
 * carried by timing rather than by drawing: the first trace draws alone and holds
 * long enough for the room to read it as good news, and only then does the second
 * one arrive. So the first trace is not styled as a warning, is not dimmed on
 * arrival, and gets its label immediately — it is allowed to be convincing. It
 * recedes at the moment the second trace lands, which is the visual equivalent of
 * "then they took it away for the real exam".
 *
 * No gridlines. The only reference is the dashed baseline, because the entire
 * quantitative claim is "above it or below it", and a grid invites the audience to
 * read values off an axis that the study does not support.
 */

/** Draw the practice gain first, then reveal the exam result and guarded arm. */
const MARKS = [40, 700, 1350] as const

/**
 * Plot box in viewBox units, with a strip reserved down each side: the left one
 * carries the control's name, the right one the three trace labels.
 *
 * The left strip is the fix for the one collision this figure could not avoid.
 * All three traces leave from the same point on the baseline, so a label for
 * that point has nowhere to go *near* it — set above the origin it sits inside
 * the fan the moment the first trace draws, and set below it the descending
 * trace runs through it. Pulling the plot in and ranging the label right
 * against the origin turns it into what it actually is: the axis's own label,
 * naming the point every trace departs from.
 *
 * The left strip used to be 27 units wide and the plot 41, which is a chart
 * given a minority of its own slide. It was that wide because the control's
 * name was set at the 20px legibility floor and still needed the room; setting
 * it a step up and letting it take three lines instead of two costs eight units
 * of strip and buys them back for the fan.
 */
export function Traces({ spec, active, reduced }: FigureBody<TracesFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const outcome = spec.traces.filter((trace) => trace.style !== 'guarded')
  const guardrail = spec.traces.find((trace) => trace.style === 'guarded')

  return (
    <div className="fig-tr">
      <span className="fig-tr-baseline-label" data-in={phase >= 1 ? 'true' : 'false'}>
        {spec.baselineLabel}
      </span>
      <div className="fig-tr-outcomes">
        {outcome.map((trace, index) => {
          const [value, label] = trace.label.split(' · ')
          return (
            <article
              className="fig-tr-outcome"
              data-style={trace.style}
              data-in={phase >= index + 1 ? 'true' : 'false'}
              key={trace.label}
            >
              <strong>{value}</strong>
              <span>{label}</span>
            </article>
          )
        })}
      </div>
      {guardrail ? (
        <div className="fig-tr-guardrail" data-in={phase >= 3 ? 'true' : 'false'}>
          <i aria-hidden="true" />
          <span>{guardrail.label}</span>
        </div>
      ) : null}
    </div>
  )
}
