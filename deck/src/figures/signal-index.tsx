import type { SignalIndexFigure } from './types'
import { usePhase, vars, type FigureBody } from './kit'

/**
 * `dashboard-everything` — eleven signals, and the one number they are read into.
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
const MARKS = [40, 420, 800, 1180, 1580] as const

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
export function SignalIndex({ spec, active, reduced }: FigureBody<SignalIndexFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const byLabel = new Map(spec.nodes.map((node) => [node.label, node]))
  const groups = [
    {
      label: 'Performance',
      nodes: ['Accuracy by question type', 'Pace against target time', 'Reasoning quality grade'],
    },
    {
      label: 'Diagnosis',
      nodes: ['Confidence calibration', 'Weak-type next focus', 'Review retrievability and recovery'],
    },
    {
      label: 'Coverage',
      nodes: ['Full-test section breakdown', 'Trend vs. your previous window', 'Evidence confidence'],
    },
    {
      label: 'Experiments',
      nodes: ['Per-method lift', 'Comparison readiness'],
    },
  ].map((group) => ({ ...group, nodes: group.nodes.map((label) => byLabel.get(label)).filter(Boolean) }))

  return (
    <div className="fig-si fig-si-pillars">
      <div className="fig-si-groups">
        {groups.map((group, groupIndex) => (
          <section className="fig-si-pillar" key={group.label} style={{ opacity: phase >= groupIndex + 1 ? 1 : 0 }}>
            <h4>{group.label}</h4>
            <ul>
              {group.nodes.map((node, nodeIndex) => node ? (
                <li
                  key={node.label}
                  data-highlight={node.highlight ? 'true' : 'false'}
                  style={vars({ '--fig-delay': `${nodeIndex * ROW_STAGGER_MS}ms` })}
                >
                  <span>{node.label}</span>
                  {node.forming ? <em>evidence forming</em> : null}
                </li>
              ) : null)}
            </ul>
          </section>
        ))}
      </div>
      <i className="fig-si-feed" style={{ transform: `scaleX(${phase >= 4 ? 1 : 0})` }} />
      <div className="fig-si-index" style={{ opacity: phase >= 5 ? 1 : 0 }}>
        <b>{spec.centre.value}</b>
        <span>{spec.centre.label}</span>
        <small>accuracy · pace · reasoning</small>
      </div>
    </div>
  )
}
