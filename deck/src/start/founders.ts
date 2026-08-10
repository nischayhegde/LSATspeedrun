/**
 * Who is in which photograph, in one place.
 *
 * Confirmed by the founders on 2026-08-10: `brand/alan.jpg` is the small
 * low-resolution frame in the black UT polo, `brand/nischay.jpg` is the 512px
 * studio frame on grey. The source files are named after the person rather than
 * numbered so the association cannot be flipped by someone reading the code, and
 * this array is the only place the order on screen is decided — the original PDF
 * title slide lists Alan first, so this does too.
 *
 * The `plate` files are the engraved derivatives built by
 * `deck/scripts/brand-assets.py`. Both are 512x512 and both get the identical
 * treatment, which is what lets a ~96px source sit next to a 512px one at the
 * same display size without the difference being the thing you notice. Replacing
 * either photograph is a matter of overwriting the `.jpg`, re-running that
 * script, and changing nothing here.
 */
export type Founder = {
  name: string
  /** The engraved plate, 512x512 PNG with a circular alpha. */
  plate: string
  /** Alt text. A portrait's alt is the person, not the treatment. */
  role: string
}

export const FOUNDERS: readonly Founder[] = [
  { name: 'Alan Abraham', plate: '/brand/founder-alan.png', role: 'Co-founder' },
  { name: 'Nischay Hegde', plate: '/brand/founder-nischay.png', role: 'Co-founder' },
]

/** The recoloured University of Texas at Austin seal: gold foil, transparent ground. */
export const UT_SEAL = '/brand/ut-seal.png'
