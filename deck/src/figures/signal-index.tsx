import type { SignalIndexFigure } from './types'
import { DRAW_PX, pct, usePhase, vars, type FigureBody } from './kit'

/**
 * SLIDE 15 — eleven signals, and the one number they are read into.
 *
 * ## Why this is not the radial it used to be
 *
 * It was a two-ring radar: a hub with `61` in it and eleven labels radiating
 * outward. The arrangement cannot be made to work, and the reason is arithmetic
 * rather than tuning. Five nodes on the inner ring at a 45° offset land on
 * 45/117/189/261/333; six on the outer at no offset land on 0/60/120/180/240/300.
 * On the right flank that is 45 against 60 and 117 against 120 — three degrees
 * apart — and each of those labels is two lines of type. The pairs overprinted
 * each other on every frame the deck was ever shot at. Widening the rings does
 * not help, because the labels then leave the plot; re-offsetting one ring only
 * moves the collision to the other flank, since eleven nodes on two rings have
 * no offset that separates every neighbouring pair on both sides at once.
 *
 * There is also a prior question. Eleven multi-word labels arranged around a
 * circle have no reading order: the eye has to hunt, and a slide the room hunts
 * through is a slide the room stops listening during. The claim here is
 * "everything it watches, read into one number", and a radar draws the *watching*
 * without ever drawing the *reading into*.
 *
 * ## What it is instead
 *
 * The signals in one column, in weight order, each with the hairline that says
 * how much it feeds the index; those hairlines converge to the right into the
 * index itself. Scanning top-to-bottom is the reading order a list has and a
 * ring does not, the convergence is the argument the ring was gesturing at, and
 * because every row is on a grid there is no aspect ratio at which two labels
 * can touch.
 *
 * ## The choreography
 *
 * Rows in, then the wires draw rightward into the number, then the number, then
 * the two `evidence forming` tags. The order is the sentence: here is what it
 * watches, here is them feeding one figure, here is the figure, and here is the
 * part we are not claiming yet.
 */

/** Cumulative milliseconds: rows, wires, the index, the honesty tags. */
const MARKS = [40, 620, 1500, 2100] as const

/** About 55ms a row, so eleven land inside the wires' own reveal. */
const ROW_STAGGER_MS = 55

/**
 * Where the wires live, in percent of the figure box.
 *
 * `WIRE_FROM` is the right edge of the label column and `HUB` is the left edge
 * of the index. Everything between them is the convergence, and it is a third
 * of the frame because eleven lines fanning into one point need enough run for
 * the fan to read as a fan rather than as a bracket.
 */
const WIRE_FROM = 46
const HUB = { x: 68, y: 50 } as const

export function SignalIndex({ spec, active, reduced }: FigureBody<SignalIndexFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const forming = phase >= 4

  // Heaviest first. The registry lists them in the order the product's own
  // dashboard does, which is not an order the room can see; sorted by weight,
  // the column's own shape says which signals carry the index.
  const rows = [...spec.nodes].sort((a, b) => b.weight - a.weight)
  const maxWeight = Math.max(...rows.map((node) => Math.abs(node.weight)), Number.EPSILON)

  /** The vertical centre of row `index`, in percent of the box. */
  const rowY = (index: number) => ((index + 0.5) / rows.length) * 100

  return (
    <div className="fig-si" data-forming={forming ? 'true' : 'false'}>
      <ol className="fig-si-rows">
        {rows.map((node, index) => (
          <li
            className="fig-si-row"
            key={node.label}
            data-highlight={node.highlight && phase >= 3 ? 'true' : 'false'}
            data-forming={node.forming ? 'true' : 'false'}
            style={vars({
              opacity: phase >= 1 ? 1 : 0,
              transform: phase >= 1 ? 'none' : 'translateX(-.6em)',
              '--fig-delay': `${index * ROW_STAGGER_MS}ms`,
            })}
          >
            {/* The tag leads the label rather than trailing it, so that every
                label still ends on the same vertical — which is where its wire
                starts. A trailing tag would push two of the eleven rows out of
                the column and break the one alignment the figure has. */}
            {node.forming ? (
              <em className="fig-si-tag" style={{ opacity: forming ? 1 : 0 }}>
                evidence forming
              </em>
            ) : null}
            <span className="fig-si-label">{node.label}</span>
          </li>
        ))}
      </ol>

      {/* The convergence. `preserveAspectRatio="none"` because the endpoints are
          fractions of the box on both axes and must stay on the rows they came
          from; the strokes are kept honest with `non-scaling-stroke`, so the
          stretch is paid on the geometry and not on the line weights. */}
      <svg
        className="fig-si-wires"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {rows.map((node, index) => (
          <path
            className="fig-si-wire"
            key={node.label}
            data-highlight={node.highlight ? 'true' : 'false'}
            data-forming={node.forming ? 'true' : 'false'}
            // A cubic with both handles horizontal, so every wire leaves its row
            // level and arrives at the hub level. A straight line would arrive
            // at eleven different angles and read as a starburst.
            d={`M ${WIRE_FROM} ${rowY(index).toFixed(2)}`
              + ` C ${WIRE_FROM + 14} ${rowY(index).toFixed(2)},`
              + ` ${HUB.x - 14} ${HUB.y},`
              + ` ${HUB.x} ${HUB.y}`}
            vectorEffect="non-scaling-stroke"
            strokeWidth={0.7 + (Math.abs(node.weight) / maxWeight) * 2.4}
            style={vars({
              strokeDashoffset: phase >= 2 ? 0 : DRAW_PX,
              '--fig-delay': `${index * ROW_STAGGER_MS}ms`,
            })}
          />
        ))}
      </svg>

      <div
        className="fig-si-index"
        style={vars({ left: pct(HUB.x / 100), opacity: phase >= 3 ? 1 : 0 })}
      >
        <b>{spec.centre.value}</b>
        <span>{spec.centre.label}</span>
      </div>
    </div>
  )
}
