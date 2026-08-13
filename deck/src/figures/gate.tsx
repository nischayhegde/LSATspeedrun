import type { GateFigure } from './types'
import { usePhase, type FigureBody } from './kit'
import { publicUrl } from '../public-url'

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

/** The office arrives first, then the map, then the access rule. */
const MARKS = [40, 420, 980] as const

export function Gate({ spec, active, reduced }: FigureBody<GateFigure>) {
  const phase = usePhase(active, reduced, MARKS)

  return (
    <div className="fig-gt-gallery">
      <div className="fig-gt-office" style={{ opacity: phase >= 1 ? 1 : 0 }}>
        <img src={publicUrl('stills/demo-office-tier14.webp')} alt="The fully built Lawyer Tycoon office" />
        <span>Cases build the firm</span>
      </div>
      <div className="fig-gt-map" style={{ opacity: phase >= 2 ? 1 : 0 }}>
        <img src={publicUrl('stills/demo-map.webp')} alt="The Lawyer Tycoon career map" />
        <span>Cases expand the world</span>
      </div>
      <div className="fig-gt-access" style={{ opacity: phase >= 3 ? 1 : 0 }}>
        <small>ALWAYS OPEN</small>
        <b>{spec.open.name}</b>
        <span>{spec.open.requires}</span>
      </div>
    </div>
  )
}
