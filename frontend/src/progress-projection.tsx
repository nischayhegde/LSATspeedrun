import { useMemo, useState } from 'react'
import { ChevronDown, Info, Target, TrendingUp } from 'lucide-react'

import { useRollupInt } from './motion'
import type { ProjectionPoint, ScoreProjection } from './types'
import './progress-projection.css'

const SCALE_MIN = 120
const SCALE_MAX = 180

const EVIDENCE_COPY: Record<string, string> = {
  baseline: 'Fewer than ~10 questions of usable evidence. Treat this as a placeholder, not a prediction.',
  emerging: 'Enough work to place you roughly. The band is still wide because the sample is still small.',
  directional: 'A useful read for training decisions. Not a substitute for sitting a full form.',
  stable: 'A stable sample. This is about as tight as a practice-based estimate gets.',
}

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** 1st, 2nd, 3rd, 4th — and 11th/12th/13th, which do not follow the last digit. */
function ordinal(value: number): string {
  const teens = value % 100
  if (teens >= 11 && teens <= 13) return `${value}th`
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`
}

/**
 * The band drawn against the whole 120-180 scale.
 *
 * A number like "162 ± 4" is easy to read as precision. Seeing the band as a
 * width on the real scale is the point: it shows how much of the scale the
 * estimate actually covers, and how much of it the student has yet to reach.
 */
function BandRuler({ projection }: { projection: Extract<ScoreProjection, { available: true }> }) {
  const position = (score: number) => ((score - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100
  const left = position(projection.lower_bound)
  const width = Math.max(1.5, position(projection.upper_bound) - left)
  const target = projection.target_score

  return (
    <div className="projection-ruler" aria-hidden="true">
      <div className="projection-ruler-track">
        <div className="projection-ruler-band" style={{ left: `${left}%`, width: `${width}%` }} />
        <div className="projection-ruler-point" style={{ left: `${position(projection.scaled_score)}%` }} />
        {target !== null && target >= SCALE_MIN && target <= SCALE_MAX && (
          <div className="projection-ruler-target" style={{ left: `${position(target)}%` }}>
            <Target size={11} />
          </div>
        )}
      </div>
      <div className="projection-ruler-scale">
        <span>120</span>
        <span>150</span>
        <span>180</span>
      </div>
    </div>
  )
}

/**
 * The trend, drawn as a band rather than a line.
 *
 * Plotting only the midpoints would imply the estimate was ever a single
 * number. The shaded polygon is the confidence interval at each snapshot, so
 * the visible story is "the band is narrowing", which is the honest one.
 */
function TrendChart({ projection }: { projection: Extract<ScoreProjection, { available: true }> }) {
  const [active, setActive] = useState<number | null>(null)
  const history: ProjectionPoint[] = projection.history

  const geometry = useMemo(() => {
    if (history.length < 2) return null
    const width = 600
    const height = 200
    const padding = { top: 16, right: 16, bottom: 26, left: 34 }
    const lowest = Math.min(...history.map((point) => point.lower_bound))
    const highest = Math.max(...history.map((point) => point.upper_bound))
    const domainMin = Math.max(SCALE_MIN, Math.floor(lowest - 2))
    const domainMax = Math.min(SCALE_MAX, Math.ceil(highest + 2))
    const span = Math.max(1, domainMax - domainMin)
    const x = (index: number) => padding.left + (index * (width - padding.left - padding.right)) / Math.max(1, history.length - 1)
    const y = (score: number) => padding.top + ((domainMax - score) / span) * (height - padding.top - padding.bottom)
    const upper = history.map((point, index) => `${x(index)},${y(point.upper_bound)}`)
    const lower = history.map((point, index) => `${x(index)},${y(point.lower_bound)}`).reverse()
    return {
      width,
      height,
      padding,
      x,
      y,
      domainMin,
      domainMax,
      bandPath: `${upper.join(' ')} ${lower.join(' ')}`,
      linePath: history.map((point, index) => `${x(index)},${y(point.scaled_score)}`).join(' '),
      ticks: [domainMax, Math.round((domainMax + domainMin) / 2), domainMin],
    }
  }, [history])

  if (!geometry) {
    return (
      <div className="projection-trend-empty">
        <TrendingUp size={19} />
        <div>
          <strong>The trend line starts on your second reading.</strong>
          <p>A snapshot is stored as you practise. Come back after another session and this becomes a chart.</p>
        </div>
      </div>
    )
  }

  const hovered = active === null ? null : history[active]

  return (
    <figure className="projection-trend">
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={`Projected score trend across ${history.length} snapshots, from ${history[0].scaled_score} to ${history[history.length - 1].scaled_score}`}
        onMouseLeave={() => setActive(null)}
      >
        {geometry.ticks.map((tick) => (
          <g key={tick} className="projection-trend-grid">
            <line x1={geometry.padding.left} x2={geometry.width - geometry.padding.right} y1={geometry.y(tick)} y2={geometry.y(tick)} />
            <text x={geometry.padding.left - 7} y={geometry.y(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        <polygon className="projection-trend-band" points={geometry.bandPath} />
        <polyline className="projection-trend-line" points={geometry.linePath} />
        {history.map((point, index) => (
          <g key={point.id}>
            <circle
              className={`projection-trend-dot${active === index ? ' is-active' : ''}`}
              cx={geometry.x(index)}
              cy={geometry.y(point.scaled_score)}
              r={active === index ? 6 : 4}
            />
            {/* A wide invisible column per point: a 4px dot is not a tap target,
                and touch has no hover to fall back on. */}
            <rect
              className="projection-trend-hit"
              x={geometry.x(index) - 14}
              y={geometry.padding.top}
              width={28}
              height={geometry.height - geometry.padding.top - geometry.padding.bottom}
              onMouseEnter={() => setActive(index)}
              onClick={() => setActive((prev) => (prev === index ? null : index))}
            >
              <title>{`${formatDay(point.date)}: ${point.scaled_score} (${point.lower_bound}-${point.upper_bound})`}</title>
            </rect>
          </g>
        ))}
        <text className="projection-trend-axis" x={geometry.padding.left} y={geometry.height - 6}>{formatDay(history[0].date)}</text>
        <text className="projection-trend-axis" x={geometry.width - geometry.padding.right} y={geometry.height - 6} textAnchor="end">
          {formatDay(history[history.length - 1].date)}
        </text>
      </svg>
      <figcaption>
        {hovered ? (
          <>
            <strong>{hovered.scaled_score}</strong>
            <span>
              {hovered.lower_bound}–{hovered.upper_bound} band · {formatDay(hovered.date)} · {hovered.observed_attempts} questions behind it
            </span>
          </>
        ) : (
          <span>The shaded area is the confidence band. It narrows as you answer more questions — hover or tap any point.</span>
        )}
      </figcaption>
    </figure>
  )
}

export function ScoreProjectionPanel({ projection }: { projection: ScoreProjection | undefined }) {
  const [showMethod, setShowMethod] = useState(false)
  // Above the early returns, because it drives a hook. The midpoint is the one
  // figure on this panel a student watches across sessions, so it is the one
  // worth showing in motion when it actually moves.
  const rolledMidpoint = useRollupInt(projection?.available ? projection.scaled_score : undefined)

  if (!projection) return null

  if (!projection.available) {
    return (
      <section className="projection-panel is-empty" aria-labelledby="projection-title">
        <div className="panel-heading">
          <div><span>PROJECTED SCORE</span><h2 id="projection-title">No estimate yet — and that is the honest answer.</h2></div>
          <TrendingUp />
        </div>
        <p className="projection-note">{projection.note}</p>
      </section>
    )
  }

  const terms = projection.uncertainty
  const bandWidth = projection.upper_bound - projection.lower_bound
  const contributions = [
    { key: 'sampling', label: 'How much you have answered', value: terms.sampling },
    { key: 'lsat_sem', label: "The LSAT's own measurement error", value: terms.lsat_sem },
    { key: 'bank_calibration', label: 'This bank is not an equated form', value: terms.bank_calibration },
    { key: 'equating', label: 'Forms convert differently', value: terms.equating },
    { key: 'missing_section', label: 'A section you have not practised', value: terms.missing_section },
  ].filter((row) => row.value > 0)
  const largest = Math.max(...contributions.map((row) => row.value))

  return (
    <section className="projection-panel" aria-labelledby="projection-title">
      <div className="panel-heading">
        <div>
          <span>PROJECTED SCORE</span>
          <h2 id="projection-title">Somewhere between {projection.lower_bound} and {projection.upper_bound}.</h2>
        </div>
        <TrendingUp />
      </div>

      <div className="projection-headline">
        <div className="projection-band-figure" aria-label={`Projected score band, ${projection.lower_bound} to ${projection.upper_bound}`}>
          <span className="projection-bound">{projection.lower_bound}</span>
          <div className="projection-midpoint">
            <strong>{rolledMidpoint ?? projection.scaled_score}</strong>
            <small>MIDPOINT</small>
          </div>
          <span className="projection-bound">{projection.upper_bound}</span>
        </div>
        <div className="projection-headline-copy">
          {/* "Different questions", not "answered questions": the model counts
              each item once, so re-answering something out of the repair queue
              does not add a second piece of evidence. The answer log below
              counts every answer, so this number is legitimately the smaller of
              the two and has to say why on its face. */}
          <p>
            A {bandWidth}-point band at about {Math.round(projection.band_confidence * 100)}% confidence, built from{' '}
            {projection.observed_attempts} different question{projection.observed_attempts === 1 ? '' : 's'}
            {projection.percentile !== null && <> · roughly the {ordinal(Math.round(projection.percentile))} percentile at the midpoint</>}.
          </p>
          <span className={`projection-evidence-badge is-${projection.evidence_grade}`}>{projection.evidence_grade.toUpperCase()}</span>
          <small>{EVIDENCE_COPY[projection.evidence_grade]}</small>
        </div>
      </div>

      <BandRuler projection={projection} />

      {projection.target_score !== null && (
        <p className={`projection-target${projection.target_within_band ? ' is-within' : ''}`}>
          <Target size={14} />
          {projection.target_within_band
            ? `Your ${projection.target_score} target sits inside the band — on this evidence it is live, not locked in.`
            : projection.target_gap && projection.target_gap > 0
              ? `Your ${projection.target_score} target is ${projection.target_gap} points above the midpoint of this band.`
              : `You are projecting above your ${projection.target_score} target. Consider raising it.`}
        </p>
      )}

      <TrendChart projection={projection} />

      <div className="projection-split" aria-label="Projection inputs">
        <div>
          <span>LOGICAL REASONING</span>
          <strong>{Math.round(projection.lr_accuracy * 100)}%</strong>
          <small>{projection.lr_attempts} questions · counts as {projection.form_lr_items} of {projection.form_items} items</small>
        </div>
        <div>
          <span>READING COMPREHENSION</span>
          <strong>{Math.round(projection.rc_accuracy * 100)}%</strong>
          <small>{projection.rc_attempts} questions · counts as {projection.form_rc_items} of {projection.form_items} items</small>
        </div>
        <div>
          <span>PROJECTED RAW</span>
          <strong>{projection.projected_raw}</strong>
          <small>out of {projection.form_items} scored items</small>
        </div>
      </div>

      <button
        type="button"
        className="projection-method-toggle"
        aria-expanded={showMethod}
        onClick={() => setShowMethod((prev) => !prev)}
      >
        <Info size={14} /> What this estimate is actually based on
        <ChevronDown size={14} className={showMethod ? 'is-open' : ''} />
      </button>

      {showMethod && (
        <div className="projection-method">
          <p>
            Your answers are weighted by how recent they are and by how test-like the conditions were, then LR and RC are
            reweighted to a real form&apos;s mix ({projection.form_lr_items} LR, {projection.form_rc_items} RC) before being
            converted to the 120-180 scale. This is a practice sample, not a proctored administration, and the band says so.
          </p>
          <p>
            Each question counts once, however many times you have answered it: a repair repeat is evidence that you have
            learned the item, not a second independent reading of your level. So the {projection.observed_attempts}{' '}
            questions here are usually fewer than the two other tallies on this screen — the answer log counts every answer
            you have submitted, repeats included, and the case count at the top counts every case your firm has billed.
          </p>
          <div className="projection-uncertainty" aria-label="What widens the band">
            {contributions.map((row) => (
              <div key={row.key}>
                <span>{row.label}</span>
                <i style={{ width: `${(row.value / largest) * 100}%` }} />
                <b>±{row.value}</b>
              </div>
            ))}
          </div>
          <small className="projection-quadrature">
            Combined in quadrature to ±{terms.total} scaled points. Only the first bar shrinks as you practise; the rest are
            properties of the test and of this question bank.
          </small>
          <ul className="projection-sources">
            <li><strong>Conversion</strong> {projection.method.conversion_table}</li>
            <li><strong>Percentiles</strong> {projection.method.percentile_table}</li>
            <li><strong>Band width</strong> {projection.method.sem_source}</li>
            <li>
              <strong>Weighting</strong> {projection.method.recency_half_life_days}-day recency half-life; a mega-litigation
              answer counts {Math.round((projection.method.evidence_weights.diagnostic / projection.method.evidence_weights.coached_practice) * 10) / 10}× a coached one
            </li>
          </ul>
          {projection.missing_sections.length > 0 && (
            <p className="projection-warning">
              You have not answered any {projection.missing_sections.join(' or ')} questions. That section&apos;s rate is borrowed
              from the one you have practised, and the band is widened to say so — practise it and this estimate gets
              materially sharper.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
