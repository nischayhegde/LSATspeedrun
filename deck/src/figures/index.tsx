import type { ReactElement, ReactNode } from 'react'

import type { FigureProps, FigureSpec } from './types'
import { useFitScale } from './kit'
import { BarPair } from './bar-pair'
import { ClockRings } from './clock-rings'
import { CohortSplit } from './cohort-split'
import { ConfidenceTiles } from './confidence-tiles'
import { CurrencyLift } from './currency-lift'
import { Gate } from './gate'
import { HoursBar } from './hours-bar'
import { MarketLedger } from './market-ledger'
import { MethodLab } from './method-lab'
import { Numeral } from './numeral'
import { PairedBars } from './paired-bars'
import { ReasoningCard } from './reasoning-card'
import { Route } from './route'
import { SignalIndex } from './signal-index'
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
  // The fit guard. `.figure-stage` clips, every figure's height is a sum of
  // hand-set measures, and nothing else in the deck connects the two — see
  // `useFitScale` for the failure that produced this and why the answer is a
  // scale rather than a reflow. A figure that fits is untouched; `data-fit` is
  // on the element so `scripts/measure-clipping.mjs` can report which figures
  // are riding the guard rather than sitting inside their stage honestly.
  const [ref, fit] = useFitScale<HTMLDivElement>(active, reduced)
  return (
    <div
      ref={ref}
      className={`fig fig-${spec.kind}`}
      data-in={active ? 'true' : 'false'}
      data-reduced={reduced ? 'true' : 'false'}
      data-fit={fit < 1 ? fit.toFixed(3) : undefined}
      style={fit < 1 ? { transform: `scale(${fit})` } : undefined}
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
    case 'market-ledger':
      return <MarketLedger spec={spec} active={active} reduced={reduced} />
    case 'route':
      return <Route spec={spec} active={active} reduced={reduced} />
    case 'reasoning-card':
      return <ReasoningCard spec={spec} active={active} reduced={reduced} />
    case 'confidence-tiles':
      return <ConfidenceTiles spec={spec} active={active} reduced={reduced} />
    case 'cohort-split':
      return <CohortSplit spec={spec} active={active} reduced={reduced} />
    case 'traces':
      return <Traces spec={spec} active={active} reduced={reduced} />
    case 'method-lab':
      return <MethodLab spec={spec} active={active} reduced={reduced} />
    case 'clock-rings':
      return <ClockRings spec={spec} active={active} reduced={reduced} />
    case 'signal-index':
      return <SignalIndex spec={spec} active={active} reduced={reduced} />
    case 'spokes':
      return <Spokes spec={spec} active={active} reduced={reduced} />
    case 'currency-lift':
      return <CurrencyLift spec={spec} active={active} reduced={reduced} />
    case 'paired-bars':
      return <PairedBars spec={spec} active={active} reduced={reduced} />
    case 'gate':
      return <Gate spec={spec} active={active} reduced={reduced} />
    default:
      return null
  }
}
