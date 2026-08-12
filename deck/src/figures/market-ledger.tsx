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
 * The first column arrives row by row, top to bottom, at reading speed — the
 * room is being walked down a list, and the list is boring on purpose. Then the
 * second column lands all five at once, in one beat, because the whole point of
 * it is that there is nothing to read: it is one phrase, five times, and
 * staggering it would invite the eye to read each cell instead of seeing the
 * shape. Then the rule, then our row, which is the only line on the slide whose
 * second cell is a different sentence.
 *
 * Down, then across, then one line. Anything else and the reader finds the
 * punchline before the setup.
 */

/** Cumulative milliseconds: heads, the field, the repeat, the rule, us. */
const MARKS = [40, 300, 1180, 1460, 1720] as const

/** Between the competitor rows. Reading speed, not animation speed. */
const ROW_STAGGER_MS = 130

export function MarketLedger({ spec, active, reduced }: FigureBody<MarketLedgerFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const { rows, ours } = spec

  return (
    <div className="fig-mk">
      <p className="fig-mk-head" data-col="claim" style={{ opacity: phase >= 1 ? 1 : 0 }}>{spec.claimHead}</p>
      <p className="fig-mk-head" data-col="grades" style={{ opacity: phase >= 1 ? 1 : 0 }}>{spec.gradesHead}</p>

      {rows.map((row, index) => (
        <div
          className="fig-mk-row"
          key={row.name}
          style={vars({ opacity: phase >= 2 ? 1 : 0, '--fig-delay': `${index * ROW_STAGGER_MS}ms` })}
        >
          <p className="fig-mk-name">{row.name}</p>
          <p className="fig-mk-claim">{row.claim}</p>
          {/* Not staggered with its row. The second column is one fact repeated
              and it has to land as a block, or the eye reads five cells instead
              of seeing that they are the same cell. */}
          <p className="fig-mk-grades" style={{ opacity: phase >= 3 ? 1 : 0 }}>{row.grades}</p>
        </div>
      ))}

      {/* The rule is the slide's only horizontal, and it draws left to right
          rather than fading, so the row under it reads as arriving after the
          field rather than as having been there all along. */}
      <span className="fig-mk-rule" style={{ transform: `scaleX(${phase >= 4 ? 1 : 0})` }} />

      <div className="fig-mk-row" data-ours="true" style={{ opacity: phase >= 5 ? 1 : 0 }}>
        <p className="fig-mk-name">{ours.name}</p>
        <p className="fig-mk-claim">{ours.claim}</p>
        <p className="fig-mk-grades">{ours.grades}</p>
      </div>
    </div>
  )
}
