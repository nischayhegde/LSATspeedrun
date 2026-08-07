import { ChevronDown } from 'lucide-react'

import type { PerformanceSnapshot, StrategySectionReading } from './types'

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

type StrategyLabSections = { sections: StrategySectionReading[]; note: string }

/**
 * `strategy_lab` is absent until the student has run a trial, so the sections
 * still need a defensive read even though their shape is now known.
 */
export function readStrategyLabSections(lab: PerformanceSnapshot['strategy_lab']): StrategyLabSections {
  return {
    sections: lab?.sections ?? [],
    note: lab?.sections_note ?? '',
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
