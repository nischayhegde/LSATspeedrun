import type { ReactElement, ReactNode } from 'react'

import type { FigureProps, FigureSpec } from './types'
import { BarPair } from './bar-pair'
import { ClockRings } from './clock-rings'
import { ConfidenceTiles } from './confidence-tiles'
import { Gate } from './gate'
import { HoursBar } from './hours-bar'
import { MethodFan } from './method-fan'
import { Numeral } from './numeral'
import { PairedBars } from './paired-bars'
import { Radial } from './radial'
import { ReasoningCard } from './reasoning-card'
import { Route } from './route'
import { Spokes } from './spokes'
import { Traces } from './traces'
import '../styles/figures.css'

export type { FigureSpec } from './types'

/**
 * FIGURES — one entry point, twelve bespoke slide graphics.
 *
 * The whole set is inline SVG and CSS. Not for purity: eight of these sit over a
 * live `WebGLRenderer` and three of them sit beside a live app iframe, and
 * `NARRATIVE.md` names the constraint out loud on slide 15 — "no WebGL, which
 * protects the frame rate right after a live demo". A figure that cost a
 * millisecond a frame would be paid for by the thing it is annotating.
 *
 * Every figure is written against `--on-field` and `--on-field-dim` and never
 * against a specific colour, because the deck inverts between acts: slide 2 is
 * beige on royal blue and slide 6 is royal blue on beige, and the same `bar-pair`
 * code has to be correct on both. The field itself is never painted here — the
 * slide has already painted it, and a figure that filled its own background
 * would tile a second, slightly wrong rectangle over the first.
 *
 * Verdict red is spent exactly twice in twenty-three slides, so `--stamp` appears
 * in exactly two of these files: the underlined clause in `reasoning-card`, and
 * the warning outline on the flagged tile in `confidence-tiles`.
 */
export function Figure({ spec, active, reduced }: FigureProps): ReactElement | null {
  return (
    <div
      className={`fig fig-${spec.kind}`}
      data-in={active ? 'true' : 'false'}
      data-reduced={reduced ? 'true' : 'false'}
    >
      {body(spec, active, reduced)}
    </div>
  )
}

/**
 * The switch is exhaustive over `FigureSpec['kind']` and returns `null` for
 * anything else, which is only reachable if a registry is edited past the type
 * checker. A missing figure leaves the slide's copy intact rather than throwing
 * during a pitch.
 */
function body(spec: FigureSpec, active: boolean, reduced: boolean): ReactNode {
  switch (spec.kind) {
    case 'numeral':
      return <Numeral spec={spec} active={active} reduced={reduced} />
    case 'bar-pair':
      return <BarPair spec={spec} active={active} reduced={reduced} />
    case 'hours-bar':
      return <HoursBar spec={spec} active={active} reduced={reduced} />
    case 'route':
      return <Route spec={spec} active={active} reduced={reduced} />
    case 'reasoning-card':
      return <ReasoningCard spec={spec} active={active} reduced={reduced} />
    case 'confidence-tiles':
      return <ConfidenceTiles spec={spec} active={active} reduced={reduced} />
    case 'traces':
      return <Traces spec={spec} active={active} reduced={reduced} />
    case 'method-fan':
      return <MethodFan spec={spec} active={active} reduced={reduced} />
    case 'clock-rings':
      return <ClockRings spec={spec} active={active} reduced={reduced} />
    case 'radial':
      return <Radial spec={spec} active={active} reduced={reduced} />
    case 'spokes':
      return <Spokes spec={spec} active={active} reduced={reduced} />
    case 'paired-bars':
      return <PairedBars spec={spec} active={active} reduced={reduced} />
    case 'gate':
      return <Gate spec={spec} active={active} reduced={reduced} />
    default:
      return null
  }
}
