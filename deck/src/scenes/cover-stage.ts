/**
 * A one-bit channel telling the opening scene that nobody can see it yet.
 *
 * ## The defect this exists to fix
 *
 * The hero scene's mark assembles out of nine parts over 4.2 seconds, and that
 * assembly is the deck's opening gesture — the product's own glyph building
 * itself in front of the room. It had never been seen. The scene is constructed
 * the moment the page loads, the assembly clock starts there, and the start card
 * sits over the top of it for as long as the presenter takes to plug in the
 * projector. By the time anyone pressed Enter the mark had been standing
 * finished, behind an opaque cover, for a minute or more.
 *
 * So the scene asks whether it is covered, and holds frame zero until it is not.
 *
 * ## Why a flag and not a method call
 *
 * The obvious alternative is for the card to call `stage.show(...)`. The
 * `DeckStage` instance lives in `deck.tsx` state and is not reachable from the
 * start card, and reaching for it would put the card and the deck both driving
 * the same async method on the deck's very first transition — precisely the
 * class of race the founders described as glitchy. Inverting the direction
 * leaves one writer, one reader, no promises and no ordering to get wrong.
 *
 * ## The default matters
 *
 * `false` — not covered. The deck is opened directly at `#/<slide>` by every
 * screenshot harness and by the presenter's own deep links, and with `?start=0`
 * by the capture script. The card never mounts in any of those, so a flag that
 * defaulted to "covered" would leave the title slide's mark scattered in pieces
 * forever, waiting for a release that never comes.
 */

let covered = false

/** True while the start card is over the deck on its first appearance. */
export function coverIsUp(): boolean {
  return covered
}

/**
 * Raised by the start card during its first render, lowered as the sweep
 * that dismisses it begins.
 *
 * A card brought *back* over a running deck with `T` deliberately does not
 * raise it: the assembly is long over by then, and the stage is quite likely
 * showing the office or the map rather than the hero at all.
 */
export function setCoverUp(value: boolean) {
  covered = value
}
