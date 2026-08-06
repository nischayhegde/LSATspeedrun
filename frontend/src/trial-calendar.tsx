import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ChevronDown, Gavel } from 'lucide-react'

import { api } from './api'
import type { TrialPlan } from './types'
import './trial-calendar.css'

/* The learner's real LSAT sitting, kept as the firm's trial date.
 *
 * Deliberately one line until asked. A countdown that shouts is a countdown a
 * learner turns off, and the app is already asking them to sit down and answer
 * hard questions; the calendar's job is to make the deadline *legible*, not to
 * apply pressure. The number of days and the phase are always visible, the
 * weekly caseload is a chip beside them, and every explanation of how that
 * number was derived is behind the disclosure. */

const PACE_LABEL: Record<NonNullable<TrialPlan['pace']>['state'], string> = {
  ahead: 'Ahead of the docket',
  on_track: 'On the docket',
  behind: 'Behind the docket',
  idle: 'Docket idle',
}

function daysLabel(plan: TrialPlan) {
  if (plan.days_remaining === null) return '—'
  if (plan.days_remaining < 0) return 'Passed'
  return String(plan.days_remaining)
}

function formatTestDate(iso: string | null) {
  if (!iso) return null
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Inline rescheduling, so a missing or stale date is fixable where it is
 *  noticed rather than by hunting through settings. */
function TrialDateField({ plan, onDone }: { plan: TrialPlan; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(plan.test_date ?? '')
  const save = useMutation({
    mutationFn: (date: string | null) => api.updateMe({ target_test_date: date }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance'] })
      void queryClient.invalidateQueries({ queryKey: ['daily-docket'] })
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      onDone()
    },
  })
  return (
    <form
      className="trial-date-field"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(value || null)
      }}
    >
      <label>
        <span>Trial date</span>
        <input type="date" value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="submit" disabled={save.isPending}>{save.isPending ? 'Filing…' : 'File it'}</button>
      {save.error && <em className="trial-date-error">That date could not be filed. Try again.</em>}
    </form>
  )
}

export function TrialCalendar({ plan, compact = false }: { plan: TrialPlan; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const scheduled = plan.days_remaining !== null && plan.days_remaining >= 0
  const pace = plan.pace
  const state = !scheduled ? 'unset' : pace?.state ?? 'on_track'

  return (
    <section className={`trial-calendar is-${state}${compact ? ' is-compact' : ''}${open ? ' is-open' : ''}`} aria-label="Trial calendar">
      <button
        type="button"
        className="trial-calendar-strip"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="trial-count">
          <CalendarClock size={14} aria-hidden="true" />
          <strong>{daysLabel(plan)}</strong>
          <small>{scheduled ? (plan.days_remaining === 1 ? 'day' : 'days') : 'no date'}</small>
        </span>
        <span className="trial-phase">
          <b>{plan.phase ?? 'Trial calendar'}</b>
          <em>{plan.headline}</em>
        </span>
        {pace && (
          <span className="trial-pace">
            <b>{pace.weekly_target}</b>
            <em>cases / week</em>
          </span>
        )}
        <ChevronDown className="trial-chevron" size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className="trial-calendar-detail">
          <p>{plan.detail}</p>
          {plan.phase_note && <p className="trial-phase-note">{plan.phase_note}</p>}
          {pace && (
            <div className="trial-figures">
              <div>
                <span>{PACE_LABEL[pace.state]}</span>
                <strong>{pace.recent_week} / {pace.weekly_target}</strong>
                <small>{pace.note}</small>
              </div>
              <div>
                <span>Target</span>
                <strong>{plan.target_score ?? '—'}</strong>
                <small>{plan.projected_score ? `projection now ${plan.projected_score}` : 'no projection yet'}</small>
              </div>
              <div>
                <span>Sitting</span>
                <strong>{formatTestDate(plan.test_date) ?? '—'}</strong>
                <small>{plan.weeks_remaining ? `${plan.weeks_remaining} weeks out` : 'unscheduled'}</small>
              </div>
            </div>
          )}
          {/* Where the weekly number comes from, for anyone who wants to check
              it. The two figures are the two things standing between the
              learner and the target: evidence and accuracy. */}
          {pace && (
            <p className="trial-method">
              Worked back from your projection: {pace.evidence_cases} case{pace.evidence_cases === 1 ? '' : 's'} to
              make the estimate stand up
              {pace.gap_cases !== null ? `, ${pace.gap_cases} to close the score gap` : ' — the score gap needs a better answer rate, not more volume'}.
              Cases lose weight as they age, which is priced in.
            </p>
          )}
          {editing
            ? <TrialDateField plan={plan} onDone={() => setEditing(false)} />
            : (
              <button type="button" className="trial-reschedule" onClick={() => setEditing(true)}>
                <Gavel size={13} aria-hidden="true" /> {plan.test_date ? 'Move the trial date' : 'Set a trial date'}
              </button>
            )}
        </div>
      )}
    </section>
  )
}
