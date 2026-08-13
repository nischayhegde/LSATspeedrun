/**
 * Who is in which photograph, and how large either may honestly be drawn.
 *
 * Confirmed by the founders on 2026-08-10: `brand/alan.jpg` is the small frame
 * in the black UT polo, `brand/nischay.jpg` is the studio frame on grey. The
 * source files are named after the person rather than numbered so the
 * association cannot be flipped by someone reading the code, and this array is
 * the only place the order on screen is decided — the original PDF title slide
 * lists Alan first, so this does too.
 *
 * ## The originals, unmodified
 *
 * These used to point at `founder-*.png`, engraved duotone derivatives built by
 * a script, and the reason was to hide that one photograph is much smaller than
 * the other. The founders' verdict on that was "don't put a filter on our
 * images; that's just weird", and they are right: a treatment applied to make a
 * technical problem invisible is a treatment the audience still sees. The
 * derivatives are no longer referenced by anything.
 *
 * ## The size, which is arithmetic rather than taste
 *
 * `alan.jpg` is nominally 192x192 but only 4.7 kB, and it measures as soft:
 * shrinking it to 96px and enlarging it back costs 2.1/255 of mean channel
 * error, and all the way down to 48px costs 3.7. A photograph that genuinely
 * held 192px of detail would lose far more than that. Its *effective*
 * resolution is about 96px, and 96 is therefore the budget.
 *
 * A display size has to fit inside that budget at the device pixel ratio the
 * room actually has:
 *
 *     96 native ÷ 2× (a laptop panel)   = 48 CSS px
 *     96 native ÷ 3× (a dense panel)    = 32 CSS px
 *
 * so the cap is 44 — inside the 2× ceiling with a little margin, and small
 * enough at 3× that the shortfall is under a hair's width on glass. Nischay's
 * photograph is drawn at exactly the same size despite having four times the
 * pixels, because two portraits at two sizes are two objects and the point of
 * them is that they are a pair.
 *
 * Small is the design, not a concession. At 44px these are bylines, and the
 * type and the seal carry the weight of the composition.
 */
import { publicUrl } from '../public-url'

export type Founder = {
  name: string
  /** The original photograph, unmodified. */
  photo: string
  role: string
}

/**
 * The displayed width and height of a founder portrait, in CSS pixels.
 *
 * Deliberately a constant rather than a viewport-scaled length. Everything else
 * on this card is measured in `--u` so the whole composition grows with the
 * projector, but a photograph's ceiling is set by the pixels inside the file,
 * and those do not grow with anything.
 */
export const PORTRAIT_PX = 44

export const FOUNDERS: readonly Founder[] = [
  { name: 'Alan Abraham', photo: publicUrl('brand/alan.jpg'), role: 'Co-founder' },
  { name: 'Nischay Hegde', photo: publicUrl('brand/nischay.jpg'), role: 'Co-founder' },
]

/**
 * The University of Texas at Austin seal, as issued.
 *
 * The recoloured `ut-seal.png` is retired along with the founder plates. This
 * is a JPEG whose corners are black, so it is only ever drawn inside a circular
 * clip — a crop, which is not a treatment: every pixel that survives it is the
 * pixel the university published.
 */
export const UT_SEAL = publicUrl('brand/ut-seal-source.jpg')
