import type { MethodLabFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'

/**
 * `pov-strategy-inside-the-question` — The card the app hands you inside a question, and
 * the record that decides whether it stays.
 *
 * ## The complaint this answers
 *
 * *"Way too much text on this slide and clutter, and not aesthetic or using
 * dynamic animations at all."* The count was the substance of it. The previous
 * arrangement put nine things on one slide for one idea: a two-line headline, a
 * two-line deck sentence, fourteen catalogue names in two columns, a five-item
 * trigger list, a method name, three numbered steps, two percentages with bars,
 * a small-print qualifier, and two footer claims. Every one of them was
 * defensible on its own and together they were a page rather than a slide.
 *
 * ## What it draws now
 *
 * The idea — *a method is handed to you at the moment you need it, and your own
 * record decides whether it stays* — is a mechanism with two ends, so the
 * figure is two objects and nothing else. Both are the product's, drawn as the
 * product draws them, which is the other half of the founder's note: he asked
 * for the app's visual language in place of diagrams.
 *
 *   - **Left, the tip card.** `frontend/src/case-flow.tsx` renders a
 *     `.strategy-tip` section mid-question: a `PARTNER TIP` rule, the method's
 *     name, its three steps numbered by a counter, and two buttons — *Use it*
 *     and *Skip this one*. That is what a student sees at the moment of need,
 *     and it is what is on the screen in the live demo four slides later, so
 *     the room recognises it when it gets there.
 *   - **Right, the record.** `frontend/src/strategy-sections.tsx` renders the
 *     dashboard's comparison as `WITH IT` and `WITHOUT IT` tiles under an
 *     `APPROACHES` heading. Same two tiles here, same order, same names.
 *
 * The catalogue is a chip reading `1 of 14 approaches` instead of fourteen
 * names. It was the largest block on the slide and it was the least argument:
 * nobody reads a list of method names off a projector, and the only fact in it
 * — how many there are — survives at a tenth of the size.
 *
 * ## Why the record is drawn in counts
 *
 * The two numbers this slide used to print were `71%` and `58%`. They are not
 * measurements of anything. They are the worked example in an internal design
 * document — `docs/superpowers/specs/2026-07-27-strategy-flow-simplification-design.md`
 * illustrates the copy format with *"You get 71% right with it and 58% right
 * without it"* — and somewhere between that spec and this deck they were read
 * as data.
 *
 * What the demo account actually holds for `prephrase` is in
 * `backend/scripts/seed_demo.py`: sixteen prompted attempts with thirteen
 * correct, seven control attempts with four. And the shipped product would not
 * print those as percentages even though it could: `strategies.py` sets
 * `PERCENTAGE_DISPLAY_MIN_SAMPLE = 30` and falls back to `13/16`, because "a
 * control sample of 4 can only ever read 0/25/50/75/100%, so any whole-point
 * percentage at this scale is fiction."
 *
 * So the figure prints the counts and sizes the bars from the ratio. The
 * comparison is still read in one glance — that is the bar's job — and the
 * number under it is one the room can check against the app. A pitch slide
 * quoting a statistic the product itself refuses to display is the single
 * cheapest way to lose a technical audience.
 *
 * ## The choreography
 *
 * Left to right, in the order the mechanism runs, and each beat is one object:
 * the question is under way → the card arrives → its steps land → the student
 * takes it → the take travels the rule into the record → the arm it landed in
 * fills → the control fills against it. Seven beats inside 1.9s. The eye is
 * never asked to choose where to look, which is what "leads the eye through the
 * argument" means and what a figure that fades in all at once cannot do.
 */

/**
 * Cumulative milliseconds. Steps and bars stagger inside their own beats.
 *
 * Longer than the 620ms the three-column version ran to, and deliberately: that
 * one had nothing to sequence, because three panes appearing in turn is three
 * things appearing, not an argument unfolding. This is under two seconds
 * against an eleven-second budget and the last beat is the one the speaker
 * lands on.
 */
const MARKS = [40, 260, 520, 900, 1180, 1420, 1660] as const

/** Between the three steps. Fast: they are one object arriving, not a list. */
const STEP_STAGGER_MS = 90

export function MethodLab({ spec, active, reduced }: FigureBody<MethodLabFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const { handed, trial } = spec

  const taken = phase >= 4
  const rate = (arm: { hit: number; of: number }) => (arm.of > 0 ? arm.hit / arm.of : 0)

  return (
    <div className="fig-ml">
      {/* ── the card, as the app hands it ────────────────────────────── */}
      <div className="fig-ml-tip" data-taken={taken ? 'true' : 'false'} style={{ opacity: phase >= 2 ? 1 : 0 }}>
        <p className="fig-ml-tip-head">Partner tip</p>
        <h4 className="fig-ml-tip-name">{handed.name}</h4>
        <ol className="fig-ml-tip-steps">
          {handed.steps.map((step, index) => (
            <li key={step} style={vars({ opacity: phase >= 3 ? 1 : 0, '--fig-delay': `${index * STEP_STAGGER_MS}ms` })}>
              {step}
            </li>
          ))}
        </ol>
        {/* Both buttons, and only one of them is pressed. Drawing the refusal
            is not decoration: the control arm on the right is made of the
            questions where a student pressed the other one, and a card with a
            single button would leave the room wondering where "without it"
            comes from. */}
        <div className="fig-ml-tip-actions" style={{ opacity: phase >= 3 ? 1 : 0 }}>
          <span className="fig-ml-tip-btn" data-pressed={taken ? 'true' : 'false'}>{handed.take}</span>
          <span className="fig-ml-tip-btn" data-role="refuse">{handed.refuse}</span>
        </div>
      </div>

      {/* ── the press travels into the record ───────────────────────────
          One rule, drawn left to right from the pressed button to the tile
          it lands in. It is the only thing on the slide that moves between
          the two objects, and it is what makes them one mechanism rather
          than a before and an after set side by side. */}
      <span className="fig-ml-wire" style={{ transform: `scaleX(${phase >= 5 ? 1 : 0})` }} />

      {/* ── the record ─────────────────────────────────────────────────── */}
      <div className="fig-ml-record" style={{ opacity: phase >= 5 ? 1 : 0 }}>
        <p className="fig-ml-record-head">Approaches · what works for you</p>
        {[
          { key: 'with', arm: trial.with, at: 6 },
          { key: 'without', arm: trial.without, at: 7 },
        ].map(({ key, arm, at }) => (
          <div className="fig-ml-arm" key={key} data-role={key}>
            <p className="fig-ml-arm-name">{arm.label}</p>
            <p className="fig-ml-arm-read">
              {/* "13 of 16", not "13/16" and not "81%". The solidus is the
                  app's, and it is right in a dashboard table and wrong at
                  display size, where it reads as a date. */}
              <b className="fig-ml-arm-count">{arm.hit} <i>of</i> {arm.of}</b>
              <span className="fig-ml-arm-track">
                <span className="fig-ml-arm-run" style={{ width: phase >= at ? pct(rate(arm)) : '0%' }} />
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
