import type { CSSProperties, ReactElement } from 'react'

import { vars } from './kit'

/**
 * THE EXTRUDED NUMERAL — one object, used at two scales, ninety seconds apart.
 *
 * ## Why this is its own file
 *
 * `NARRATIVE.md` asks for the hero of slide 4 to be "recognizably *the same
 * object* the room saw on slide 2 — same material, same rotation rig, same
 * shadow behavior, as though it had been dollied in from ninety seconds
 * earlier". That is a claim about identity, and identity across two slides
 * cannot be got by building the thing twice and matching it by eye: the deck
 * *inverts* between those two slides, so the two renderings do not even share a
 * colour, and any hand-matched pair would drift the first time either was
 * touched.
 *
 * So there is one component and one block of CSS, and both slides mount it. The
 * `+0.22` set beside the stub bar on slide 2 and the hero `0.22` on slide 4 are
 * the same fourteen faces at the same angles with the same per-face shading
 * ramp, differing only in `font-size` — which is what "dollied in" means
 * optically. Everything that could drift is a shared custom property.
 *
 * ## Why it is not WebGL
 *
 * Two reasons, and the second is the one that settles it.
 *
 * Legibility first. This numeral is the payload of the slide the narrative
 * marks do-not-cut, and a projector at 1280×800 renders extruded *type* far
 * better than a rasterised mesh of the same glyphs, because the type stays
 * vector to the last step of the pipeline and picks up the browser's hinting.
 *
 * Then the field inversion. The stage renders *under* the slide layer, so a
 * mesh would sit behind the beige field slide 4 paints; putting it in front
 * would mean a second canvas over the copy. A DOM object in the slide layer
 * inverts with the slide for free — which is the whole reason the same
 * component can be correct on royal blue and on beige.
 *
 * So the extrusion is real 3D — `preserve-3d`, a stack of faces at increasing
 * `translateZ`, one rotation on the parent — but the faces are glyphs.
 *
 * ## The rig
 *
 * One rotation about eight degrees off-axis, exactly as specified, held on
 * `--num-spin` as a custom property rather than baked into the transform. That
 * is load-bearing: the transition out of slide 4 rotates the object edge-on
 * until it is a single vertical line, which becomes the timer track on slide 5,
 * and `numeral-morph` in `transitions.ts` drives this one property to do it.
 */

/** Faces in the extrusion. Enough to read as solid, few enough to stay cheap. */
export const NUMERAL_DEPTH = 14

type Props = {
  /** The glyphs. `0.22` as built; nothing here assumes a number. */
  value: string
  /** Degrees off-axis. The narrative asks for "maybe eight". */
  spin?: number
  /**
   * Depth of one face step, in `em` of the numeral's own size, so the extrusion
   * is proportional at both scales. Small on purpose: at hero size anything
   * much larger stops being an extruded numeral and becomes a tube with a hole
   * in it.
   */
  step?: number
  className?: string
  style?: CSSProperties
  /**
   * Marks the element as a morph endpoint for `transitions.ts`. Two slides
   * carry the same numeral, so the transition finds its source and target by
   * this rather than by slide identity.
   */
  morph?: string
}

export function ExtrudedNumeral({
  value,
  spin = 8,
  step = 0.008,
  className,
  style,
  morph,
}: Props): ReactElement {
  const faces = Array.from({ length: NUMERAL_DEPTH }, (_, index) => index)
  return (
    <span
      className={className ? `num3d ${className}` : 'num3d'}
      data-morph={morph}
      style={vars({
        '--num-spin': `${spin}deg`,
        '--num-depth': NUMERAL_DEPTH,
        '--num-step': `${step}em`,
        ...(style as Record<string, string | number> | undefined),
      })}
    >
      <span className="num3d-rig" aria-hidden="true">
        {/* Back to front, so the lit face is painted last and the sides read as
            one solid rather than as a stack of outlines. */}
        {faces.map((index) => (
          <span
            key={index}
            className="num3d-face"
            data-face={index === NUMERAL_DEPTH - 1 ? 'lit' : 'side'}
            style={vars({ '--face': index })}
          >
            {value}
          </span>
        ))}
      </span>
      {/* The glyphs above are decorative geometry repeated fourteen times; the
          accessible name is stated once. */}
      <span className="num3d-name">{value}</span>
    </span>
  )
}
