import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'

import { api } from './api'
import type { StudySession } from './types'

/**
 * "How is this run going?" — the dashboard's answer wall, at run scale.
 *
 * The Progress tab already answers this for a student's whole history with a
 * grid of right/wrong tiles and a small cluster of measures beside it. This is
 * the same object scoped to the run currently open, so the case view teaches
 * nothing new: one cell per question, and three numbers behind a disclosure.
 *
 * Two rules shape what it may say:
 *
 * * **A mega-litigation is never scored mid-form.** Results are withheld to
 *   the end by design, so a diagnostic run never fetches its attempts at all —
 *   not merely "does not display them", since the payload carries correctness
 *   and a network panel is not a secret. Everything shown for a diagnostic is
 *   derived from the session the page already holds.
 * * **Nothing here may cost a request per question.** The strip reads one
 *   compact history page for the run and refetches only when the answered
 *   count changes.
 */

type Cell = { key: string; className: string; label: string }

function formatClock(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const RAIL_STORAGE_KEY = 'lsat-tycoon:case-rail-open'

function useRailOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(RAIL_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () => setOpen((previous) => {
    const next = !previous
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* private browsing; the rail just forgets between runs */
    }
    return next
  })
  return [open, toggle] as const
}


export function CaseRunRail({ session }: { session: StudySession }) {
  const isDiagnostic = session.mode === 'diagnostic'
  const answered = Math.min(session.current_index, session.total_items)
  const [open, toggleOpen] = useRailOpen()
  const history = useQuery({
    queryKey: ['run-attempts', session.id, answered],
    queryFn: () => api.attemptHistory({ session_id: session.id, limit: 200 }),
    enabled: !isDiagnostic && answered > 0,
    staleTime: 30_000,
  })
  const attempts = useMemo(
    () => [...(history.data?.attempts ?? [])].sort((a, b) => a.position - b.position),
    [history.data],
  )

  const correct = attempts.filter((attempt) => attempt.is_correct).length
  const repeats = attempts.filter((attempt) => attempt.from_review_queue).length
  const totalElapsed = attempts.reduce((sum, attempt) => sum + attempt.elapsed_ms, 0)
  const totalTarget = attempts.reduce((sum, attempt) => sum + attempt.target_time_seconds * 1000, 0)
  const overTarget = attempts.filter((attempt) => attempt.over_target).length

  // `section_plan` positions are the block boundaries of a mega-litigation.
  const block = session.section_plan?.find((section) => answered >= section.start && answered <= section.end)
  const blockIndex = block ? session.section_plan.indexOf(block) + 1 : 0
  const unanswered = session.total_items - answered
  const budgetPerQuestion = session.remaining_ms != null && unanswered > 0
    ? session.remaining_ms / unanswered
    : null

  const cells: Cell[] = Array.from({ length: session.total_items }, (_, index) => {
    const attempt = attempts.find((entry) => entry.position === index)
    const isCurrent = index === answered
    if (attempt && !isDiagnostic) {
      return {
        key: `q${index}`,
        className: [
          'case-run-cell',
          attempt.is_correct ? 'is-correct' : 'is-wrong',
          attempt.from_review_queue ? 'is-repeat' : '',
        ].filter(Boolean).join(' '),
        label: `Question ${index + 1}: ${attempt.is_correct ? 'correct' : 'missed'}`,
      }
    }
    if (index < answered) {
      return { key: `q${index}`, className: 'case-run-cell is-answered', label: `Question ${index + 1}: answered` }
    }
    return {
      key: `q${index}`,
      className: `case-run-cell${isCurrent ? ' is-current' : ''}`,
      label: `Question ${index + 1}: ${isCurrent ? 'open now' : 'not reached'}`,
    }
  })

  const headline = isDiagnostic
    ? `${answered} of ${session.total_items} answered${blockIndex ? ` · ${block!.label}` : ''}`
    : answered === 0
      ? `First case of ${session.total_items}`
      : `${correct} of ${answered} right so far`

  return (
    <section className="case-run-rail" aria-label="Progress through this run">
      <div className="case-run-rail-head">
        <div>
          <span>{isDiagnostic ? 'THIS SITTING' : 'THIS RUN'}</span>
          <strong>{headline}</strong>
        </div>
        <button
          type="button"
          className="case-run-rail-toggle"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          {open ? 'Hide detail' : 'Detail'} <ChevronDown size={13} />
        </button>
      </div>

      <ol className="case-run-strip" aria-label={`${session.total_items} questions in this run`}>
        {cells.map((cell) => <li key={cell.key} className={cell.className} title={cell.label} aria-label={cell.label} />)}
      </ol>

      {open && (isDiagnostic ? (
        <>
          <div className="case-run-stats">
            <div>
              <span>ANSWERED</span>
              <strong>{answered}<small> / {session.total_items}</small></strong>
              <small>{session.total_items - answered} left on the form</small>
            </div>
            <div>
              <span>BLOCK</span>
              <strong>{blockIndex || 1}<small> of {session.section_plan?.length || 3}</small></strong>
              <small>{block ? `${block.label} · questions ${block.start + 1}–${block.end + 1}` : 'One clock across every block'}</small>
            </div>
            {/* The countdown itself is already in the topbar. What is not
                anywhere is what that clock buys per remaining question, which
                is the number a form sitting is actually paced against. */}
            <div>
              <span>BUDGET LEFT</span>
              <strong className={budgetPerQuestion != null && budgetPerQuestion < 45_000 ? 'is-amber' : ''}>
                {budgetPerQuestion == null ? '—' : formatClock(budgetPerQuestion)}
              </strong>
              <small>{budgetPerQuestion == null ? 'clock not started' : 'a question, for what is left'}</small>
            </div>
          </div>
          <p className="case-run-rail-note">
            Nothing is scored until the form closes, so no accuracy is shown here — that is what makes a
            mega-litigation the honest read.
          </p>
        </>
      ) : (
        <div className="case-run-stats">
          <div>
            <span>RUN ACCURACY</span>
            <strong className={answered === 0 ? '' : correct / Math.max(1, answered) >= .7 ? 'is-teal' : 'is-amber'}>
              {answered === 0 ? '—' : `${Math.round((correct / answered) * 100)}%`}
            </strong>
            <small>{answered} of {session.total_items} answered</small>
          </div>
          <div>
            <span>AVERAGE SPLIT</span>
            <strong>{attempts.length ? formatClock(totalElapsed / attempts.length) : '—'}</strong>
            <small>
              {attempts.length
                ? `target ${formatClock(totalTarget / attempts.length)} · ${overTarget} over`
                : 'no timed answers yet'}
            </small>
          </div>
          <div>
            <span>REPAIRS FOLDED IN</span>
            <strong>{repeats}</strong>
            <small>{repeats ? 'questions the scheduler served back' : 'every question so far is unseen'}</small>
          </div>
        </div>
      ))}
    </section>
  )
}

export default CaseRunRail
