import type { MethodLabFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'

/**
 * SLIDE 10 — `method-lab`. The catalogue, the one method handed over, and the
 * measurement that decides whether it stays.
 *
 * ## What this replaced, and why
 *
 * This slide used to be a fan of fourteen cards that swept, fell away, and left
 * one card docked against a *greeked question* — a bordered box of grey rules
 * with A–E down the side. Two things were wrong with it, and both are on the
 * founders' list.
 *
 * The first is that a column of grey bars is the universal drawing of a loading
 * skeleton, and structure does not rescue it. The previous pass added the
 * letters on the reasoning that "a column of bars is a component that has not
 * loaded, and the same column with A–E down its left edge is a multiple-choice
 * question". On a projector it is not. It is a component that has not loaded,
 * with letters. The only reliable way to stop a box reading as a placeholder is
 * to put real words in it.
 *
 * The second is that the fan's *resting* state was almost empty. Thirteen cards
 * fall away 430ms in, so for the remaining twenty seconds of an eleven-second
 * slide — and in every screenshot, and for anyone who looked up late — the
 * frame held one small tab reading "Prephrase", a skeleton, and two bars. The
 * slide's own fragment claimed fourteen methods; the slide showed one. A figure
 * has to be judged at rest, because at rest is where the room reads it.
 *
 * ## What it draws now
 *
 * The catalogue, legibly, all fourteen of it — so "fourteen in the catalog" is
 * a thing the audience can see rather than a thing they are told. Then the one
 * that was handed over on this question, opened out beside it as the card the
 * student actually gets: the trigger that fired it and the three steps it asks
 * for, in the app's own words. Then, under a rule, the two accuracies that
 * decide whether it survives.
 *
 * Left to right that is catalogue, method, verdict, which is the sentence the
 * slide is making. Nothing on it is greeked and nothing is a placeholder: every
 * string comes from the registry, and the registry took them from
 * `backend/app/strategies.py`.
 *
 * ## The choreography
 *
 * The filter sweep survives, because the argument is that methods are *tested*
 * and a filter passing over the catalogue says so in one gesture. What changed
 * is where it ends: the thirteen dim rather than leave. A catalogue that empties
 * itself is a catalogue the audience can no longer count, and the honest claim
 * is that thirteen are still in rotation — they lost this question, not their
 * place in the app.
 */

/**
 * Cumulative milliseconds: catalogue in, sweep across, verdict, card, bars.
 *
 * Settled inside 700ms. The old fan ran 2.9s plus a 900ms tail, which is fine
 * when a slide is spoken to and wrong when it is arrowed past — a presenter at
 * speed caught it mid-scatter every time, and a scatter on its way somewhere
 * looks exactly like a scatter that is broken.
 */
const MARKS = [40, 200, 340, 470, 620] as const

/** Down the columns rather than across the rows. */
const COLUMNS = 2

export function MethodLab({ spec, active, reduced }: FigureBody<MethodLabFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const methods = spec.methods
  const keep = Math.min(Math.max(spec.keep, 0), methods.length - 1)

  // Percentages, so the bars stay comparable to each other rather than each
  // filling its own track. A value over 1 is taken as already scaled.
  const scale = Math.max(spec.lift.prompted, spec.lift.baseline) <= 1
    ? 1
    : Math.max(spec.lift.prompted, spec.lift.baseline)

  const rows = Math.ceil(methods.length / COLUMNS)

  return (
    <div className="fig-ml" data-swept={phase >= 3 ? 'true' : 'false'}>
      {/* ── the catalogue ──────────────────────────────────────────────── */}
      <div className="fig-ml-catalog">
        <p className="fig-ml-pane-head">
          {/* Counted from the array rather than written down, because a
              hand-written count beside a list is a caption that goes stale the
              first time somebody adds a method. */}
          <span>The catalog</span>
          <b>{methods.length}</b>
        </p>

        <ol className="fig-ml-catalog-list" style={vars({ '--fig-rows': String(rows) })}>
          {methods.map((method, index) => (
            <li
              key={method}
              className="fig-ml-method"
              data-kept={index === keep ? 'true' : 'false'}
              style={vars({
                opacity: phase >= 1 ? 1 : 0,
                // Down the column the eye is already travelling, 16ms a step,
                // so the fourteenth is in place well before the sweep starts.
                '--fig-delay': `${(index % rows) * 16 + Math.floor(index / rows) * 40}ms`,
              })}
            >
              {method}
            </li>
          ))}
        </ol>

        {/* The filter: one pass, left to right, then gone — and gone from the
            document, not merely transparent.
            
            A parked sweep is not free. This element is wider than its pane and
            lives outside it at both ends of its travel, so as a permanent child
            it added its own off-frame width to the scroll box for the whole
            slide: 137px on the catalogue, and 250px on the figure back when it
            was a child of the figure. Nothing shows it — the pane clips — but a
            layout audit that asks "does anything here overflow its frame" can
            no longer tell this apart from a real fault, and the next person to
            run one wastes their afternoon the way this one did.
            
            Mounting it for the one phase it is visible means its travel has to
            be a keyframe rather than a transition, since there is no previous
            style to transition from on the frame it appears. */}
        {phase === 2 ? <span className="fig-ml-sweep" /> : null}
      </div>

      {/* ── the one that was handed over ───────────────────────────────── */}
      <div className="fig-ml-handed" style={{ opacity: phase >= 4 ? 1 : 0 }}>
        <p className="fig-ml-pane-head">
          <span>Handed over on</span>
        </p>
        <p className="fig-ml-trigger">{spec.handed.trigger}</p>
        <h4 className="fig-ml-name">{spec.handed.name}</h4>
        <ol className="fig-ml-steps">
          {spec.handed.steps.map((step, index) => (
            <li key={step} style={vars({ '--fig-delay': `${index * 70}ms`, opacity: phase >= 4 ? 1 : 0 })}>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* ── and whether it worked ──────────────────────────────────────── */}
      <div className="fig-ml-lift" style={{ opacity: phase >= 5 ? 1 : 0 }}>
        <p className="fig-ml-pane-head">
          <span>Did it work</span>
        </p>
        {[
          { key: 'prompted', name: 'with the method', value: spec.lift.prompted },
          { key: 'baseline', name: 'their own attempts without it', value: spec.lift.baseline },
        ].map((row, index) => (
          <div
            className="fig-ml-lift-row"
            key={row.key}
            data-role={row.key}
            style={vars({ '--fig-delay': `${index * 140}ms` })}
          >
            {/* The name leads, above the number, rather than sitting beside
                it. Beside it, "their own attempts without it" had to share a
                line with a 60px numeral inside a 410px column, so it wrapped
                into the numeral's second line and the two collided. */}
            <p className="fig-ml-lift-name">{row.name}</p>
            <p className="fig-ml-lift-head">
              <b className="fig-ml-lift-value">{formatLift(row.value)}</b>
              <span className="fig-ml-lift-track">
                <span
                  className="fig-ml-lift-run"
                  style={{ width: phase >= 5 ? pct(Math.max(row.value, 0) / scale) : '0%' }}
                />
              </span>
            </p>
          </div>
        ))}
        <p className="fig-ml-lift-note">{spec.lift.note}</p>
      </div>
    </div>
  )
}

/**
 * Accuracies arrive as fractions and are read out as percentages, which is how
 * the app's own Method Lab reports them. A value above 1 is already scaled.
 */
function formatLift(value: number): string {
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(0)
}
