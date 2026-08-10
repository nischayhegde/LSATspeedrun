import type { NumeralFigure } from './types'
import { ExtrudedNumeral } from './extruded-numeral'
import { usePhase, type FigureBody } from './kit'

/**
 * THE HERO NUMERAL — slide 4, the turn.
 *
 * There is almost nothing here, and that is the point: the object itself lives
 * in `extruded-numeral.tsx` because slide 2 mounts the same one beside its stub
 * bar. What this file owns is the *beat* — the narrative asks for no motion at
 * all for the first 700ms and a silent hold, so the entrance is late and short
 * and then the object is simply there.
 *
 * The dolly it arrives on is CSS (`.fig-num .num3d`), and the rotation edge-on
 * that carries it into slide 5's timer track is `numeral-morph` in
 * `transitions.ts`. Both drive properties this component only has to declare.
 */
export function Numeral({ spec, active, reduced }: FigureBody<NumeralFigure>) {
  // One mark, late: the slide holds silent and still before the object lands.
  const phase = usePhase(active, reduced, [700])

  return (
    <div className="fig-num" data-in={phase >= 1 ? 'true' : 'false'}>
      <ExtrudedNumeral value={spec.value} spin={spec.spin ?? 8} morph="numeral" />
    </div>
  )
}
