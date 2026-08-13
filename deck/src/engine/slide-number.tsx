import type { SlideSpec } from '../slides/types'
import './slide-number.css'

/**
 * The folio: which slide this is, in the corner, on every slide of the talk.
 *
 * The founders asked for it in five words — "slide numbers should appear at the
 * corners of slides" — and the whole design question is in the word *corners*.
 * A number on a projected slide is not information the audience is reading; it is
 * information they need exactly twice, both times in the ten seconds after
 * someone says "go back to the one with the two bars" or "can you send me slide
 * nine". So it has to be findable without being lookable-at, which means small,
 * consistent, in the same place every time, and never in the composition.
 *
 * ## Where, and why not any of the other corners
 *
 * Bottom right, on `--gutter` — the deck's own margin, the same one every slide's
 * copy sits on — and directly above the right-hand end of the progress hairline,
 * which is already at the bottom of every slide. That is the point: the deck
 * already has a piece of permanent bottom chrome, so the folio joins it instead of
 * opening a second front. The top corners are where headlines and eyebrows begin,
 * and the bottom left is where this deck seats its caption plates and its demo
 * copy.
 *
 * ## What it says on the first slide, the start card and the close
 *
 * - **Slide 1, the title:** nothing. A folio on the cover is a page number on a
 *   dust jacket, and the cover is the one slide in the deck whose composition is
 *   a single centred object. The count starts being useful once there is
 *   something to count back to.
 * - **The start card:** nothing, and nothing had to be done for it. The card is
 *   opaque at z-index 2000 and this is at 890, so it is simply behind it — and
 *   the card carries the deck's length in its own kicker, where it belongs.
 * - **The last slide:** shown, and it is the one place the total earns its
 *   keep. The deck sits on `close-one-stop-shop` for the whole of Q&A, and
 *   "23/23" is what tells a room that the argument is finished rather than
 *   paused.
 *
 * ## Legibility, which is the only hard part
 *
 * Four backdrops, three treatments. The `data-field` attribute carries the
 * slide's own field, so a beige slide gets ink and a royal-blue one gets cream
 * rather than both getting a compromise that is grey on each. A slide with no
 * field at all — the 3D scenes and the full-bleed demo frames, where what is
 * behind the folio is a render or a live app and cannot be known — gets the cream
 * plus a tight shadow, which is what keeps it off whatever it lands on without
 * putting a plate in the corner of the frame. See `slide-number.css`.
 */

type Props = {
  /** Zero-based, as the deck holds it. Rendered one-based. */
  index: number
  slides: readonly SlideSpec[]
}

export function SlideNumber({ index, slides }: Props) {
  const slide = slides[index]
  if (!slide || index === 0) return null

  return (
    <div
      className="deck-folio"
      // Chrome, not content: a screen reader reading the deck should hear the
      // slide, and the presenter's own overlay already announces the position.
      aria-hidden="true"
      data-field={slide.field ?? 'scene'}
      // Keyed on the index, so React replaces the element rather than patching
      // the text inside it and the fade in the stylesheet replays on every
      // navigation. Without it the number hard-cuts to its successor on the
      // keystroke while the slide it belongs to is still arriving, which reads as
      // a glitch in the chrome rather than as the deck turning a page.
      key={index}
    >
      <b>{String(index + 1).padStart(2, '0')}</b>
      <i />
      <span>{String(slides.length).padStart(2, '0')}</span>
    </div>
  )
}
