import type { GateFigure } from './types'
import { DRAW_PX, usePhase, vars, type FigureBody } from './kit'

/**
 * SLIDE 22 — `gate`. Practice gates the game; the game never gates the practice.
 *
 * A one-way diagram, and the asymmetry has to be in the *drawing* rather than in a
 * caption, so the two arrows are built out of different amounts of confidence: the
 * forward arrow is thick, drawn quickly, and pulses; the reverse one is thin, drawn
 * slowly as if it were being attempted, and is then struck once. The strike is a
 * single fast stroke — 140ms, no easing to speak of — because a strike-through
 * that eases in looks like a design flourish and this one is a refusal.
 *
 * The strike is drawn in `--on-field`, not in verdict red. The narrative spends
 * that colour exactly twice, on slide 6's underlined clause and slide 7's warning
 * outline, and this slide is not one of them.
 */

/** Cumulative milliseconds: headings, the forward arrow, its pulse, the attempt, the strike, the couplings. */
const MARKS = [40, 500, 1300, 2200, 2800, 3300] as const

/** The arrows' lane in the viewBox: they run between the two columns, never under them. */
const RUN = { from: 27, to: 73, forwardY: 33, reverseY: 63 } as const

export function Gate({ spec, active, reduced }: FigureBody<GateFigure>) {
  const phase = usePhase(active, reduced, MARKS)

  return (
    <div className="fig-gt">
      <div className="fig-gt-frame">
        <h3 className="fig-gt-col" data-side="left" style={{ opacity: phase >= 1 ? 1 : 0 }}>
          {spec.left}
        </h3>
        <h3 className="fig-gt-col" data-side="right" style={{ opacity: phase >= 1 ? 1 : 0 }}>
          {spec.right}
        </h3>

        {/* Shafts in SVG, heads in the DOM. The viewBox is stretched to the frame
            so that the arrows always reach both columns, and a stretched viewBox
            turns an arrowhead into a shallow chevron that gets shallower the wider
            the projector is. A chevron built from two borders is square at every
            aspect. */}
        <svg className="fig-gt-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path
            className="fig-gt-shaft"
            data-dir="forward"
            data-pulse={phase >= 3 ? 'true' : 'false'}
            d={`M ${RUN.from} ${RUN.forwardY} L ${RUN.to - 1} ${RUN.forwardY}`}
            vectorEffect="non-scaling-stroke"
            style={{ strokeDashoffset: phase >= 2 ? 0 : DRAW_PX }}
          />
          <path
            className="fig-gt-shaft"
            data-dir="reverse"
            data-denied={phase >= 5 ? 'true' : 'false'}
            d={`M ${RUN.to} ${RUN.reverseY} L ${RUN.from + 1} ${RUN.reverseY}`}
            vectorEffect="non-scaling-stroke"
            style={{ strokeDashoffset: phase >= 4 ? 0 : DRAW_PX }}
          />
        </svg>

        {/* The strike is DOM for the same reason the arrowheads are. Drawn in
            the stretched viewBox it ran the full width of the lane at a few
            degrees off horizontal — a third line parallel to the two arrows
            rather than a mark across one of them. A slash is a shape, and a
            shape has to be square at every aspect. */}
        <span
          className="fig-gt-strike"
          data-struck={phase >= 5 ? 'true' : 'false'}
          style={{ left: '50%', top: `${RUN.reverseY}%` }}
        />

        <span
          className="fig-gt-chevron"
          data-dir="forward"
          data-pulse={phase >= 3 ? 'true' : 'false'}
          style={{ left: `${RUN.to}%`, top: `${RUN.forwardY}%`, opacity: phase >= 2 ? 1 : 0 }}
        />
        <span
          className="fig-gt-chevron"
          data-dir="reverse"
          data-denied={phase >= 5 ? 'true' : 'false'}
          style={{ left: `${RUN.from}%`, top: `${RUN.reverseY}%`, opacity: phase >= 4 ? (phase >= 5 ? 0.38 : 1) : 0 }}
        />

        <p className="fig-gt-denied" style={{ opacity: phase >= 5 ? 1 : 0 }}>
          {spec.denied}
        </p>
      </div>

      <ul className="fig-gt-couplings">
        {spec.couplings.map((coupling, index) => {
          const [cause, effect] = splitCoupling(coupling)
          return (
            <li
              key={coupling}
              style={vars({
                opacity: phase >= 6 ? 1 : 0,
                transform: phase >= 6 ? 'translateX(0)' : 'translateX(-.6em)',
                '--fig-delay': `${index * 140}ms`,
              })}
            >
              <span className="fig-gt-cause">{cause}</span>
              {effect === undefined ? null : (
                <>
                  <svg className="fig-gt-thin" viewBox="0 0 40 12" aria-hidden="true">
                    <path d="M 0 6 L 34 6 M 28 1.6 L 34 6 L 28 10.4" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <span className="fig-gt-effect">{effect}</span>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The couplings are authored as `Cases → cash and story`, so the arrow already in
 * the string becomes the drawn thin arrow rather than being set as a glyph beside
 * one. A coupling written without an arrow renders as a single label, which is the
 * right fallback: it is a caption, not a diagram with a missing half.
 */
function splitCoupling(coupling: string): [string, string | undefined] {
  const at = coupling.search(/→|->/)
  if (at < 0) return [coupling, undefined]
  const separator = coupling.slice(at).startsWith('→') ? 1 : 2
  return [coupling.slice(0, at).trim(), coupling.slice(at + separator).trim()]
}
