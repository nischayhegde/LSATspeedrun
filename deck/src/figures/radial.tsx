import type { RadialFigure } from './types'
import { DRAW_PX, pct, ringPoint, usePhase, vars, type FigureBody } from './kit'

/**
 * SLIDE 15 — `radial`. Twelve measures, the Speedrun Index at the centre, and how
 * much each one feeds it.
 *
 * The hardest layout in the set, and all of the difficulty is typographic: eleven
 * labels plus a centre have to be readable from the back of a room without a
 * single collision, on frames from 4:3 to 21:9. Three decisions carry it.
 *
 *   1. The rings are ellipses in percentages of the frame, not circles. A circle
 *      on a 21:9 slide leaves two enormous empty side margins and crushes the
 *      labels at top and bottom into each other; an ellipse spends the width it
 *      is given, which is exactly where label text wants to go.
 *   2. Labels are placed by the *direction* of their node, not by a fixed offset:
 *      a node on the right anchors its text to the left and runs outward, one at
 *      the top centres its text above itself. That is what stops a long label
 *      from reaching back across the diagram.
 *   3. The two rings are pushed far apart and angularly offset from each other, so
 *      an inner label runs into open space rather than into an outer node.
 *
 * The nodes are DOM elements rather than SVG circles, because a circle in a
 * stretched viewBox is an egg. Only the hairlines are SVG, and they carry
 * `vector-effect="non-scaling-stroke"` so `weight` reads as a true thickness
 * instead of an artefact of the frame's aspect.
 */

/** Cumulative milliseconds: centre, assembly, weakest link, evidence tags. */
const MARKS = [40, 560, 1800, 2400] as const

/** The narrative's rhythm for the assembly: about 80ms a node, so eleven land in roughly a second. */
const NODE_STAGGER_MS = 80

/** Ring radii in percent of the frame. The outer ring gets the room; the gap between them is label space. */
const RINGS = {
  1: { radiusX: 15, radiusY: 17, offsetDeg: 45 },
  2: { radiusX: 36, radiusY: 36, offsetDeg: 0 },
} as const

export function Radial({ spec, active, reduced }: FigureBody<RadialFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const forming = phase >= 4

  // Angles are assigned per ring so that adding a node to one ring never
  // re-choreographs the other, and the assembly order is inner ring first.
  const perRing = { 1: 0, 2: 0 }
  const counts = { 1: 0, 2: 0 }
  for (const node of spec.nodes) counts[node.ring] += 1

  const placed = spec.nodes
    .map((node) => {
      const ring = RINGS[node.ring]
      const total = Math.max(counts[node.ring], 1)
      const index = perRing[node.ring]++
      const angle = ring.offsetDeg + (index * 360) / total
      const at = ringPoint(angle, ring.radiusX, ring.radiusY)
      const radians = ((angle - 90) * Math.PI) / 180
      return { node, angle, at, ux: Math.cos(radians), uy: Math.sin(radians) }
    })
    .sort((a, b) => (a.node.ring - b.node.ring) || (a.angle - b.angle))

  const maxWeight = Math.max(...spec.nodes.map((node) => Math.abs(node.weight)), Number.EPSILON)

  return (
    <div className="fig-rd" data-forming={forming ? 'true' : 'false'}>
      <svg className="fig-rd-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {([1, 2] as const).map((ring) => (
          <ellipse
            className="fig-rd-guide"
            key={ring}
            data-ring={ring}
            cx={50}
            cy={50}
            rx={RINGS[ring].radiusX}
            ry={RINGS[ring].radiusY}
            vectorEffect="non-scaling-stroke"
            style={{ opacity: phase >= 1 ? 1 : 0 }}
          />
        ))}
        {/* Paths rather than lines, and `pathLength` rather than a measured length.
            `non-scaling-stroke` makes the dash pattern screen-space, so a dash
            array written in viewBox units would draw a dashed hairline instead of
            revealing a solid one; normalising the path to a length of 1 makes the
            reveal exact at any frame size. */}
        {placed.map((entry, order) => (
          <path
            className="fig-rd-wire"
            key={entry.node.label}
            data-ring={entry.node.ring}
            data-highlight={entry.node.highlight ? 'true' : 'false'}
            d={`M 50 50 L ${entry.at.x.toFixed(2)} ${entry.at.y.toFixed(2)}`}
            // Screen pixels, because the stroke is non-scaling. The previous
            // values were user units carried over from before the vector effect
            // went on, which made every wire a third of a pixel wide — the
            // thickness encodes how much a signal feeds the centre, and none of
            // it was visible.
            strokeWidth={0.7 + (Math.abs(entry.node.weight) / maxWeight) * 2.6}
            style={vars({
              strokeDashoffset: phase >= 2 ? 0 : DRAW_PX,
              '--fig-delay': `${order * NODE_STAGGER_MS}ms`,
            })}
          />
        ))}
      </svg>

      {placed.map((entry, order) => {
        const anchor = anchorFor(entry.ux, entry.uy)
        // The outer ring steps back when the evidence tags arrive, but the tagged
        // nodes themselves do not: they are what the presenter is pointing at, and
        // a dimmed `evidence forming` tag is a tag nobody reads.
        const recessed = forming && entry.node.ring === 2 && !entry.node.forming
        return (
          <div
            className="fig-rd-node"
            key={entry.node.label}
            data-ring={entry.node.ring}
            data-anchor={anchor}
            data-highlight={entry.node.highlight && phase >= 3 ? 'true' : 'false'}
            data-forming={entry.node.forming ? 'true' : 'false'}
            style={vars({
              left: pct(entry.at.x / 100),
              top: pct(entry.at.y / 100),
              opacity: phase >= 2 ? (recessed ? 0.62 : 1) : 0,
              '--fig-delay': `${order * NODE_STAGGER_MS}ms`,
            })}
          >
            <span className="fig-rd-dot" />
            <span className="fig-rd-label">
              {entry.node.label}
              {entry.node.forming ? (
                <span className="fig-rd-tag" style={{ opacity: forming ? 1 : 0 }}>
                  evidence forming
                </span>
              ) : null}
            </span>
          </div>
        )
      })}

      <div className="fig-rd-centre" style={{ opacity: phase >= 1 ? 1 : 0 }}>
        <b>{spec.centre.value}</b>
        <span>{spec.centre.label}</span>
      </div>
    </div>
  )
}

/**
 * Which way a label leaves its node.
 *
 * The 0.42 threshold rather than 0.5: it biases nodes near the diagonals toward
 * side-anchoring, which is the safer failure, because a side-anchored label that
 * is slightly too high still reads, while a centred label that is slightly too
 * wide overprints its neighbour.
 */
function anchorFor(ux: number, uy: number): 'left' | 'right' | 'above' | 'below' {
  if (Math.abs(ux) > 0.42) return ux > 0 ? 'right' : 'left'
  return uy > 0 ? 'below' : 'above'
}
