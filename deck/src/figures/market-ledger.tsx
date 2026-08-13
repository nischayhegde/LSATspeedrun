import type { MarketLedgerFigure } from './types'
import { usePhase, vars, type FigureBody } from './kit'

/**
 * `market-in-their-own-words` — the field in its own words, and the column that
 * says the same thing five times.
 *
 * ## Why this exists over a written objection
 *
 * `NARRATIVE.md` §D argued against a comparison slide and gave four reasons.
 * The founder has asked for the slide anyway, and he is right, but the four
 * reasons were not wrong — so the figure is built to answer them rather than to
 * ignore them.
 *
 *   1. *"Visually dull in a deck that has spent nine slides earning the
 *      opposite."* Answered by not building a matrix. No ticks, no crosses, no
 *      grid of cells with a winner down one side. Two columns of sentences on a
 *      ledger, set in the deck's own editorial rhythm, and the drama is the
 *      second column repeating rather than a row of green marks.
 *   2. *"It invites a judge to argue one row at a time on a clock that does not
 *      allow it."* Answered by putting nothing arguable in a row. Every cell in
 *      the first column is the company's own marketing copy, quoted and dated;
 *      every cell in the second is what the product scores. There is no
 *      judgement of a competitor anywhere on the slide, so there is nothing to
 *      dispute — the only inference is the audience's own, and they make it
 *      about four seconds in.
 *   3. *"It puts four competitors' names in front of a room that currently
 *      knows only ours."* This had already lapsed. The slide immediately before
 *      names 7Sage, LSAT Lab, Kaplan, Blueprint, Princeton Review and LSAC.
 *   4. *"It would be the slide most likely to be wrong by the morning of the
 *      pitch, because every figure in it moves."* Answered by carrying no
 *      per-vendor prices. That is the only class of fact in this market that
 *      moves weekly, and it moves so hard that three of Blueprint's own pages
 *      currently quote three different numbers for one course. What a company
 *      says its product *is* does not move like that. The price argument is on
 *      the slide before, as a range, where it belongs.
 *
 * ## The choreography, which is the argument
 *
 * One sequence, three beats. The competitor chips stagger in at reading
 * speed — five names, one field. Then a stem draws down from that row into
 * the letter they all grade, so the chips own the phrase rather than sitting
 * above it. Then our lockup arrives as a single unit: the product name, a
 * gold rule that draws into the claim, and "your reasoning". Name and claim
 * are one idea, not two leftover labels.
 *
 * Field, then letter, then us. Anything else and the reader finds the
 * punchline before the setup.
 */

/** Cumulative milliseconds: the field, the letter they grade, our lockup. */
const MARKS = [40, 860, 1380] as const

/** Between the competitor chips. Reading speed, not animation speed. */
const ROW_STAGGER_MS = 90

export function MarketLedger({ spec, active, reduced }: FigureBody<MarketLedgerFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const { rows, ours } = spec
  const fieldIn = phase >= 1
  const letterIn = phase >= 2
  const oursIn = phase >= 3

  return (
    <div className="fig-mk">
      <section className="fig-mk-choice">
        <div className="fig-mk-field">
          <div className="fig-mk-vendors">
            {rows.map((row, index) => (
              <span
                key={row.name}
                style={vars({
                  opacity: fieldIn ? 1 : 0,
                  transform: fieldIn ? 'translateY(0)' : 'translateY(.4em)',
                  '--fig-delay': `${index * ROW_STAGGER_MS}ms`,
                })}
              >
                {row.name}
              </span>
            ))}
          </div>
          <span
            className="fig-mk-funnel"
            style={{ transform: `scaleY(${letterIn ? 1 : 0})` }}
            aria-hidden="true"
          />
        </div>
        <strong
          className="fig-mk-result"
          style={{
            opacity: letterIn ? 1 : 0,
            transform: letterIn ? 'translateY(0)' : 'translateY(.45em)',
          }}
        >
          the letter you picked
        </strong>
      </section>

      <div
        className="fig-mk-ours"
        style={{
          opacity: oursIn ? 1 : 0,
          transform: oursIn ? 'translateY(0)' : 'translateY(.45em)',
        }}
      >
        <p className="fig-mk-name">{ours.name}</p>
        <span
          className="fig-mk-bind"
          style={vars({
            transform: oursIn ? 'scaleX(1)' : 'scaleX(0)',
            '--fig-delay': '140ms',
          })}
          aria-hidden="true"
        />
        <p className="fig-mk-grades">{ours.grades}</p>
      </div>
    </div>
  )
}
