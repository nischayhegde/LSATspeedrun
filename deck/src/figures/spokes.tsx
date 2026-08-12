import type { SpokesFigure } from './types'
import { pct, ringPoint, usePhase, vars, type FigureBody } from './kit'

/**
 * `spokes` — points correlated with all four dimensions of engagement; badges
 * correlated with one.
 *
 * NO SLIDE CURRENTLY MOUNTS THIS. It was built for the virtual-currency POV and
 * lost that slide to `currency-lift`, which draws the same argument from the
 * study's own numbers instead of from its correlation table. It is kept because
 * the radial is the only shape-comparison primitive in the folder and the
 * argument it draws may come back; if it has not by the next pass, delete it
 * rather than carrying an unmounted figure through another revision.
 *
 * One radial with both series on the same axes rather than two radials side by
 * side. Two diagrams would ask the room to compare two shapes across a gap and
 * would need the four dimension labels twice; overlaid, the comparison is a single
 * silhouette — a square against a spike — and it lands in about half a second,
 * which is all the time this slide has before the coin takes over.
 *
 * The plot is the one figure in the set that keeps a true square viewBox, because
 * a radar chart stretched to 21:9 stops being comparable between its horizontal
 * and vertical axes, and the whole claim is that the four axes are equivalent.
 */

/** Where a lit spoke ends and where an unlit one stops, in viewBox units. */
const LIT_RADIUS = 38
const DARK_RADIUS = 9

/** How far out the dimension labels sit. */
const LABEL_RADIUS = 45

/** Per-vertex delay inside a series, so a series reads as lighting up rather than as appearing. */
const VERTEX_STAGGER_MS = 80

export function Spokes({ spec, active, reduced }: FigureBody<SpokesFigure>) {
  // One mark for the axes, then one per series, built from the data so that a
  // third series would be choreographed rather than dropped onto the second.
  const marks = [40, ...spec.series.map((_series, index) => 320 + index * 460)]
  const phase = usePhase(active, reduced, marks)

  const count = Math.max(spec.spokes.length, 3)
  const angleOf = (index: number) => (index * 360) / count
  const vertices = spec.spokes.map((_spoke, index) => ringPoint(angleOf(index), LIT_RADIUS, LIT_RADIUS))
  const hubs = spec.spokes.map((_spoke, index) => ringPoint(angleOf(index), DARK_RADIUS, DARK_RADIUS))

  return (
    <div className="fig-sp">
      {/* The stage is slack around the plot: the dimension labels sit outside the
          square, and they need somewhere to go that is not the legend. */}
      <div className="fig-sp-stage">
        <div className="fig-sp-plot">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            {vertices.map((vertex, index) => (
              <line
                className="fig-sp-axis"
                key={spec.spokes[index]}
                x1={50}
                y1={50}
                x2={vertex.x}
                y2={vertex.y}
                vectorEffect="non-scaling-stroke"
                style={vars({ opacity: phase >= 1 ? 1 : 0, '--fig-delay': `${index * 60}ms` })}
              />
            ))}

            {spec.series.map((series, seriesIndex) => {
              const shown = phase >= 2 + seriesIndex
              const shape = spec.spokes
                .map((_spoke, index) => (series.lit[index] ? vertices[index] : hubs[index]))
                .map((point) => `${(point?.x ?? 50).toFixed(2)},${(point?.y ?? 50).toFixed(2)}`)
                .join(' ')
              return (
                // Grown out of the hub with a transform rather than by interpolating
                // `points`, which is an attribute and does not transition.
                <polygon
                  className="fig-sp-shape"
                  key={series.label}
                  data-emphasis={series.emphasis ? 'true' : 'false'}
                  points={shape}
                  vectorEffect="non-scaling-stroke"
                  style={{ opacity: shown ? 1 : 0, transform: shown ? 'scale(1)' : 'scale(.04)' }}
                />
              )
            })}

            {spec.series.map((series, seriesIndex) =>
              spec.spokes.map((spoke, index) =>
                series.lit[index] ? (
                  <circle
                    className="fig-sp-lit"
                    key={`${series.label}-${spoke}`}
                    data-emphasis={series.emphasis ? 'true' : 'false'}
                    cx={vertices[index]?.x ?? 50}
                    cy={vertices[index]?.y ?? 50}
                    r={2.2}
                    style={vars({
                      opacity: phase >= 2 + seriesIndex ? 1 : 0,
                      '--fig-delay': `${index * VERTEX_STAGGER_MS}ms`,
                    })}
                  />
                ) : null,
              ),
            )}
          </svg>

          {spec.spokes.map((spoke, index) => {
            const at = ringPoint(angleOf(index), LABEL_RADIUS, LABEL_RADIUS)
            const radians = ((angleOf(index) - 90) * Math.PI) / 180
            const ux = Math.cos(radians)
            return (
              <span
                className="fig-sp-label"
                key={spoke}
                data-anchor={Math.abs(ux) > 0.42 ? (ux > 0 ? 'right' : 'left') : 'centre'}
                style={vars({
                  left: pct(at.x / 100),
                  top: pct(at.y / 100),
                  opacity: phase >= 1 ? 1 : 0,
                  '--fig-delay': `${index * 60}ms`,
                })}
              >
                {spoke}
              </span>
            )
          })}
        </div>
      </div>

      <ul className="fig-sp-key">
        {spec.series.map((series, seriesIndex) => (
          <li
            key={series.label}
            data-emphasis={series.emphasis ? 'true' : 'false'}
            style={{ opacity: phase >= 2 + seriesIndex ? 1 : 0 }}
          >
            <span className="fig-sp-swatch" />
            <span className="fig-sp-key-name">{series.label}</span>
            <b>
              {series.lit.filter(Boolean).length}/{spec.spokes.length}
            </b>
          </li>
        ))}
      </ul>
    </div>
  )
}
