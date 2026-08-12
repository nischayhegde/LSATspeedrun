import type { CSSProperties } from 'react'

import type { GateFigure } from './types'
import { usePhase, vars, type FigureBody } from './kit'

/**
 * `game-never-gates` — the app's own unlock list, and the one row with no lock.
 *
 * ## The complaint this answers
 *
 * *"Two words, two arrows, an X."* It was a true diagram of a true claim and
 * it showed the room nothing: `Practice → Firm`, the reverse struck out, three
 * couplings underneath. Nobody has ever been persuaded that a product does not
 * gate something by looking at a crossed-out arrow, because an arrow can be
 * drawn in either direction for free.
 *
 * ## What it draws now
 *
 * The screen the claim is actually true on. `wardrobe.tsx` renders every piece
 * the player has not earned as a padlock followed by its requirement, and
 * `_wardrobe_requirement` in `backend/app/game.py` composes those requirements
 * out of three verbs — *Settle*, *Hold*, *Reach*. So the figure is that list:
 * four locked rows, quoted, and then the row the app would print for the
 * practice, which is the same row it prints for anything available on day one.
 *
 * The asymmetry is no longer asserted. It is read straight down the right-hand
 * column: three prices denominated in reps, then a price that is not a price.
 * And the last row is the only one on the slide with an empty lock well, which
 * is the whole argument at a glance from the back of a room.
 *
 * ## The sentence under it
 *
 * *"Everything here is won by practising, never bought."* That is not deck
 * copy. It is line 113 of `frontend/src/wardrobe.tsx`, printed under the
 * wardrobe's own heading, and it says the forward coupling better than the
 * arrow did. Quoting the product against a claim about the product is the
 * cheapest credibility on offer here, so it is set as a quotation and credited
 * to the screen it comes from.
 *
 * ## The choreography
 *
 * The list builds the way a shop list is read: names down the left at reading
 * speed, each one's lock closing behind it a beat later, so the room watches
 * the column fill with padlocks rather than being handed four of them. Then
 * the rule. Then the open row, which arrives without the beat the others had
 * — nothing to wait for is the point — and last the quotation.
 */

/** Cumulative milliseconds: head, the locked names, their locks, the rule, the open row, the quote. */
const MARKS = [40, 300, 620, 1320, 1560, 2000] as const

/** Between the locked rows. Slow enough to be read as a list, not a reveal. */
const ROW_STAGGER_MS = 150

export function Gate({ spec, active, reduced }: FigureBody<GateFigure>) {
  const phase = usePhase(active, reduced, MARKS)

  return (
    <div className="fig-gt">
      <p className="fig-gt-head" style={{ opacity: phase >= 1 ? 1 : 0 }}>{spec.head}</p>

      <ul className="fig-gt-list">
        {spec.locked.map((item, index) => (
          <li
            className="fig-gt-row"
            key={item.name}
            style={vars({ opacity: phase >= 2 ? 1 : 0, '--fig-delay': `${index * ROW_STAGGER_MS}ms` })}
          >
            {/* The well is drawn on every row, including the open one, so the
                last row's emptiness is a gap in a column rather than a shorter
                line of text. A missing padlock is only legible where a padlock
                was expected. */}
            <span className="fig-gt-well">
              <Padlock
                shut={phase >= 3}
                style={vars({ '--fig-delay': `${index * ROW_STAGGER_MS + 120}ms` })}
              />
            </span>
            <span className="fig-gt-name">{item.name}</span>
            <span
              className="fig-gt-requires"
              style={vars({ opacity: phase >= 3 ? 1 : 0, '--fig-delay': `${index * ROW_STAGGER_MS + 120}ms` })}
            >
              {item.requires}
            </span>
          </li>
        ))}
      </ul>

      {/* Draws rather than fades, so the row beneath reads as arriving after
          the list and not as part of it. */}
      <span className="fig-gt-rule" style={{ transform: `scaleX(${phase >= 4 ? 1 : 0})` }} />

      <div className="fig-gt-row" data-open="true" style={{ opacity: phase >= 5 ? 1 : 0 }}>
        <span className="fig-gt-well" />
        <span className="fig-gt-name">{spec.open.name}</span>
        <span className="fig-gt-requires">{spec.open.requires}</span>
      </div>

      <p className="fig-gt-quote" style={{ opacity: phase >= 6 ? 1 : 0 }}>
        <q>{spec.quote}</q>
        <small>{spec.quoteCredit}</small>
      </p>
    </div>
  )
}

/**
 * The app's lock chip is a 12px Lucide `Lock`, which is a rounded shackle over
 * a rounded body. Redrawn here rather than imported because the deck does not
 * take the icon dependency, and because this one has to *shut*: the shackle
 * drops into the body on its row's beat, which is the only motion on the
 * figure and the reason the empty well at the bottom is noticed at all.
 */
function Padlock({ shut, style }: { shut: boolean; style?: CSSProperties }) {
  return (
    <svg className="fig-gt-lock" data-shut={shut ? 'true' : 'false'} viewBox="0 0 24 24" style={style} aria-hidden="true">
      <path className="fig-gt-shackle" d="M 8 11 V 7.5 a 4 4 0 0 1 8 0 V 11" />
      <rect className="fig-gt-body" x="4.5" y="10.5" width="15" height="10" rx="2" />
    </svg>
  )
}
