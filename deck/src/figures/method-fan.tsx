import type { MethodFanFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'

/**
 * SLIDE 10 — `method-fan`. Fourteen methods in the catalogue, one handed over at
 * the moment it is needed, kept only if the student's own data says so.
 *
 * The fan is laid out on an ellipse in percentages of the frame rather than with a
 * rotate-about-a-pivot transform, which is the usual way to draw a card fan and
 * the wrong way here: a pivot needs a radius in absolute length units, and the
 * same radius that fans fourteen cards nicely at 16:9 pushes half of them off a
 * 21:9 frame. An elliptical arc in percentages simply gets wider.
 *
 * Thirteen cards leaving is choreographed as a sweep followed by a fall, in that
 * order, because a filter that removes things before it has visibly passed over
 * them reads as a deletion rather than as a test.
 */

/**
 * Cumulative milliseconds: fan, sweep, fall, dock, lift.
 *
 * The whole sequence is over inside 600ms, and the CSS durations that carry it
 * are set to match. It used to run for 2.9s plus a 900ms tail, which is fine
 * when the slide is spoken to and wrong when it is arrowed past — a presenter
 * moving at speed caught the fan mid-scatter every time, and a scatter that is
 * on its way somewhere looks identical to a scatter that is broken. A figure
 * the room may only see for a second has to be *settled* within that second.
 */
const MARKS = [20, 170, 300, 430, 560] as const

/** Total angular spread of the fan, and how much of it each card's own rotation takes. */
const FAN_SPREAD_DEG = 96
const CARD_TILT = 0.55

/** The arc, in percent of the frame: half-width, dip at the ends, and the apex. */
const ARC = { radiusX: 41, radiusY: 15, apexY: 21 } as const

/**
 * Fourteen named methods cannot be laid along one arc without overlapping —
 * "Necessary-Assumption Negation" is nine ems wide and the arc gives each card
 * about four percent of the frame. So the fan is three tiers deep, stepped by
 * index, which triples each card's horizontal room and reads as a fanned hand
 * rather than as a queue.
 */
const TIERS = 3
const TIER_STEP = 9

/**
 * Where the survivor ends up: a tab against the left edge of the question card.
 *
 * It used to straddle the edge, half in and half out, which is what the word
 * "docks" suggested and not what it looked like — a card lying across a border
 * reads as a card that missed. Outside the edge, clear of it by a hair, it
 * reads as attached.
 */
const DOCK = { x: 8.5, y: 30 } as const

/**
 * The card's suggested contents: a stem, a gap, and a list of choices.
 *
 * This box is on screen for twenty of the slide's twenty-two seconds and it is
 * the thing the docked method is docked *to*, so it has to read as a question.
 * Three evenly spaced rules in a tall frame read as a placeholder.
 *
 * One rule takes the marker. The narrative asks for a live highlight drag on
 * the stimulus "as if the presenter did it", which is the beat that turns the
 * card from a diagram of a question into a question somebody is working on —
 * and it is the only place on the slide where the method being handed over is
 * shown actually being *used*.
 */
const CARD_RULES: ReadonlyArray<{ width: number; mark?: number }> = [
  { width: 92 },
  { width: 84, mark: 58 },
  { width: 56 },
  { width: 0 },
  { width: 62 },
  { width: 48 },
  { width: 68 },
]

export function MethodFan({ spec, active, reduced }: FigureBody<MethodFanFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const methods = spec.methods
  const count = Math.max(methods.length, 2)
  const keep = Math.min(Math.max(spec.keep, 0), methods.length - 1)

  const liftScale = Math.max(spec.lift.prompted, spec.lift.baseline) <= 1
    ? 1
    : Math.max(spec.lift.prompted, spec.lift.baseline)

  return (
    <div className="fig-mf">
      {/* The question card the survivor docks against. Outline only — the card
          itself is slide 6's job, and this slide is about what arrives beside it. */}
      <div className="fig-mf-question" style={{ opacity: phase >= 4 ? 1 : 0 }}>
        {CARD_RULES.map((rule, index) => (
          rule.width === 0
            ? <span className="fig-mf-question-gap" key={index} />
            : (
              <span className="fig-mf-question-rule" key={index} style={{ width: `${rule.width}%` }}>
                {rule.mark === undefined ? null : (
                  // The drag itself. It runs left to right over the stem after
                  // the method has docked, at a hand's speed rather than an
                  // interface's, because the point is that a person did it.
                  <span
                    className="fig-mf-mark"
                    style={{ width: phase >= 5 ? `${rule.mark}%` : '0%' }}
                  />
                )}
              </span>
            )
        ))}
      </div>

      {methods.map((method, index) => {
        const angle = ((index / (count - 1)) - 0.5) * FAN_SPREAD_DEG
        const radians = (angle * Math.PI) / 180
        const fanX = 50 + Math.sin(radians) * ARC.radiusX
        const fanY = ARC.apexY + (1 - Math.cos(radians)) * ARC.radiusY + (index % TIERS) * TIER_STEP
        const survivor = index === keep
        const docked = survivor && phase >= 4
        const fallen = !survivor && phase >= 3
        return (
          <div
            className="fig-mf-card"
            key={method}
            data-survivor={survivor ? 'true' : 'false'}
            data-docked={docked ? 'true' : 'false'}
            style={vars({
              left: pct((docked ? DOCK.x : fanX) / 100),
              top: pct((docked ? DOCK.y : fanY) / 100),
              opacity: phase < 1 ? 0 : fallen ? 0 : 1,
              transform: `translate(-50%, -50%) rotate(${(docked ? 0 : angle * CARD_TILT).toFixed(2)}deg) translateY(${fallen ? '2.6em' : '0em'}) scale(${docked ? 1.24 : 1})`,
              zIndex: survivor ? 3 : 2,
              // The dock is the one move that must not wait its turn in the
              // stagger; everything else falls in the order the sweep passed it.
              // 14ms a card, so the fourteenth is still inside the 600ms budget.
              '--fig-delay': docked ? '0ms' : `${index * 14}ms`,
            })}
          >
            {method}
          </div>
        )
      })}

      {/* The filter itself: one pass, left to right, then gone. */}
      <span
        className="fig-mf-sweep"
        style={{ left: phase >= 2 ? '108%' : '-8%', opacity: phase >= 2 && phase < 3 ? 0.38 : 0 }}
      />

      {/* The measurement, beside the question rather than under it. This is the
          half of the slide the fourth fragment claims nobody else does, and
          under the card it was a pair of hairlines in the gutter. The two rows
          are named, because "71% against 58%" is only an argument once the
          room knows which one had the method. */}
      <div className="fig-mf-lift" style={{ opacity: phase >= 5 ? 1 : 0 }}>
        {[
          { key: 'prompted', name: 'with the method', value: spec.lift.prompted },
          { key: 'baseline', name: 'their own attempts without it', value: spec.lift.baseline },
        ].map((row, index) => (
          <div className="fig-mf-lift-row" key={row.key} data-role={row.key} style={vars({ '--fig-delay': `${index * 180}ms` })}>
            <p className="fig-mf-lift-head">
              <b className="fig-mf-lift-value">{formatLift(row.value)}</b>
              <span className="fig-mf-lift-name">{row.name}</span>
            </p>
            <span className="fig-mf-lift-track">
              <span
                className="fig-mf-lift-run"
                style={{ width: phase >= 5 ? pct(Math.max(row.value, 0) / liftScale) : '0%' }}
              />
            </span>
          </div>
        ))}
        <p className="fig-mf-lift-note">{spec.lift.note}</p>
      </div>
    </div>
  )
}

/**
 * Accuracies arrive as fractions and are read out as percentages, which is how the
 * app's own Method Lab reports them. A value above 1 is taken as already scaled.
 */
function formatLift(value: number): string {
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(0)
}
