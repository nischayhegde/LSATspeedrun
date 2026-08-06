import { ChevronDown } from 'lucide-react'

/**
 * The per-section readings inside the Methods tab: the strongest approach for
 * Logical Reasoning and for Reading Comprehension, each with the strength of
 * the evidence behind it.
 *
 * Every figure is computed in `backend/app/strategies.py` — including all of
 * the prose. Nothing here decides what counts as enough evidence, and nothing
 * here formats a number the backend withheld, so the panel cannot drift out of
 * step with the statistics it is describing.
 */

export type StrategySectionResult = {
  key: string
  plain_title: string
  /** The catalogue's own label for the approach, which is not what grouped it. */
  section: string
  sample: number
  control_sample: number
  lift: number | null
  /** The difference after shrinking both arms toward "this made no difference". */
  adjusted_lift: number | null
  /** Effective per-arm size of the difference, dominated by the thinner arm. */
  contrast_sample: number
  contrast_evidence: string
  eligible: boolean
  with_headline: string
  with_note: string
  without_headline: string
  without_note: string
  detail: string
}

export type StrategySectionReading = {
  section: string
  short_label: string
  /**
   * `leader` names an approach. `level` means the comparison is strong enough
   * to read and nothing is ahead. `insufficient` and `none` are the two ways of
   * not having an answer, and both say which.
   */
  status: 'leader' | 'level' | 'insufficient' | 'none'
  headline: string
  summary: string
  next_step: string
  evidence_label: string | null
  evidence_note: string | null
  lift_headline: string
  trials: number
  prompt_trials: number
  control_trials: number
  strategies_tested: number
  leader: StrategySectionResult | null
  /** Whichever approach the reading is about, named or not. */
  focus: StrategySectionResult | null
  results: StrategySectionResult[]
  itt: { note: string }
}

type StrategyLabSections = { sections: StrategySectionReading[]; note: string }

export function readStrategyLabSections(lab: unknown): StrategyLabSections {
  const payload = lab as { sections?: unknown; sections_note?: unknown } | null | undefined
  return {
    sections: Array.isArray(payload?.sections) ? (payload.sections as StrategySectionReading[]) : [],
    note: typeof payload?.sections_note === 'string' ? payload.sections_note : '',
  }
}

const CAPTIONS: Record<StrategySectionReading['status'], (reading: StrategySectionReading) => string> = {
  leader: (reading) => `Strongest ${reading.short_label} approach so far`,
  level: (reading) => `${reading.trials} ${reading.short_label} questions compared`,
  insufficient: (reading) => `${reading.trials} ${reading.short_label} questions compared`,
  none: (reading) => `Nothing measured in ${reading.short_label} yet`,
}

function SectionRow({ reading }: { reading: StrategySectionReading }) {
  const focus = reading.focus
  return (
    <details className={`strategy-section-row is-${reading.status}`}>
      <summary>
        <span className="strategy-section-tag">{reading.short_label}</span>
        <span className="strategy-section-headline">
          <strong>{reading.headline}</strong>
          <small>{CAPTIONS[reading.status](reading)}</small>
        </span>
        <span className={`strategy-section-lift${(focus?.adjusted_lift ?? 0) < 0 ? ' is-behind' : ''}`}>
          {reading.lift_headline}
        </span>
        {reading.evidence_label && (
          <span className={`strategy-evidence-badge ${reading.evidence_label}`}>{reading.evidence_label}</span>
        )}
        <ChevronDown className="strategy-section-chevron" size={14} />
      </summary>
      <div className="strategy-section-detail">
        <p>{reading.summary}</p>
        {focus && (
          <div className="strategy-comparison" aria-label={`${focus.plain_title} in ${reading.section}`}>
            <div><span>WITH IT</span><strong>{focus.with_headline}</strong><small>{focus.with_note}</small></div>
            <div><span>WITHOUT IT</span><strong>{focus.without_headline}</strong><small>{focus.without_note}</small></div>
            <div className={(focus.adjusted_lift ?? 0) > 0 ? 'positive' : 'behind'}>
              <span>ADJUSTED</span>
              <strong>{reading.lift_headline}</strong>
              <small>
                {focus.adjusted_lift === null
                  ? 'needs questions on both sides before a difference exists'
                  : 'pulled toward no difference by how thin the split is'}
              </small>
            </div>
          </div>
        )}
        {reading.evidence_note && <small>{reading.evidence_note}</small>}
        <small>{reading.next_step}</small>
        {focus && <small>{focus.detail} {reading.itt.note}</small>}
      </div>
    </details>
  )
}

export function StrategySectionReadings({ sections, note }: StrategyLabSections) {
  if (!sections.length) return null
  return (
    <div className="strategy-sections">
      {sections.map((reading) => <SectionRow key={reading.section} reading={reading} />)}
      {note && <p className="strategy-sections-note">{note}</p>}
    </div>
  )
}
