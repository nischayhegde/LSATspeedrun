import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Clock3, RotateCcw, X } from 'lucide-react'

import { api } from './api'
import type { HistoryAttempt, HistoryAttemptDetail } from './types'
import './progress-history.css'

/**
 * "Which questions did I get right and wrong?" — as one scannable wall.
 *
 * Deliberately not another analytics table. Every question the student has
 * ever answered is one tile, coloured by outcome and ordered newest first, so
 * the shape of a good week or a bad question type is legible before a single
 * word is read. Everything else here (filters, the detail drawer) is a way of
 * narrowing or opening that wall, never a replacement for it.
 */

const PAGE_SIZE = 120

type Outcome = 'all' | 'correct' | 'incorrect'

function formatSeconds(milliseconds: number) {
  const total = Math.round(milliseconds / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function formatDate(value: string | null) {
  if (!value) return 'Unknown date'
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}


/**
 * Exported so the mega-litigation results view can drill into a question with
 * the identical reader rather than growing a second one that slowly drifts.
 */
export function AttemptDetail({ attemptId, onClose }: { attemptId: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['history-attempt', attemptId],
    queryFn: () => api.attemptDetail(attemptId),
  })
  const attempt: HistoryAttemptDetail | undefined = detail.data?.attempt
  const coaching = attempt?.feedback?.coaching
  return (
    <div className="answer-log-detail" role="region" aria-label="Answer detail">
      <div className="answer-log-detail-head">
        <div>
          {/* RC items carry the section as their type; printing it twice reads
              like a bug rather than like a label. */}
          <span>{attempt ? [attempt.question_type, attempt.section].filter((part, index, all) => all.indexOf(part) === index).join(' · ') : 'Loading…'}</span>
          <strong>{attempt ? formatDate(attempt.created_at) : ''}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close answer detail"><X size={16} /></button>
      </div>
      {detail.isLoading && <p className="answer-log-detail-empty">Pulling the full answer…</p>}
      {detail.error && <p className="answer-log-detail-empty">That answer could not be loaded.</p>}
      {attempt && (
        <>
          <div className="answer-log-detail-facts">
            <div><span>RESULT</span><strong className={attempt.is_correct ? 'is-correct' : 'is-wrong'}>{attempt.is_correct ? 'Correct' : 'Missed'}</strong></div>
            <div><span>YOUR PICK</span><strong>{attempt.selected_label}</strong></div>
            <div><span>CREDITED</span><strong>{attempt.correct_label}</strong></div>
            <div><span>TIME</span><strong className={attempt.over_target ? 'is-wrong' : ''}>{formatSeconds(attempt.elapsed_ms)}</strong><small>target {formatSeconds(attempt.target_time_seconds * 1000)}</small></div>
          </div>
          {attempt.from_review_queue && <p className="answer-log-detail-flag"><RotateCcw size={13} /> This was a repeat, served back to you by the review scheduler.</p>}
          {attempt.question.passage && (
            <details className="answer-log-passage">
              <summary>Passage</summary>
              <p>{attempt.question.passage.text}</p>
            </details>
          )}
          {attempt.question.stimulus && <blockquote className="answer-log-stimulus">{attempt.question.stimulus}</blockquote>}
          <h4>{attempt.question.stem}</h4>
          <ul className="answer-log-choices">
            {attempt.question.choices.map((choice) => {
              const picked = choice.label === attempt.selected_label
              const credited = choice.label === attempt.correct_label
              return (
                <li key={choice.label} className={credited ? 'credited' : picked ? 'picked-wrong' : ''}>
                  <b>{choice.label}</b>
                  <span>{choice.text}</span>
                  {credited && <small>Credited</small>}
                  {picked && !credited && <small>You picked this</small>}
                </li>
              )
            })}
          </ul>
          {attempt.reasoning_text && (
            <div className="answer-log-reasoning">
              <span>WHAT YOU WROTE</span>
              <p>{attempt.reasoning_text}</p>
            </div>
          )}
          {coaching ? (
            <div className="answer-log-coaching">
              <span>COACH</span>
              <p>{coaching.reasoning_summary}</p>
              {coaching.answer_analysis?.correct_answer_explanation && (
                <>
                  <h5>Why {attempt.correct_label} is credited</h5>
                  <p>{coaching.answer_analysis.correct_answer_explanation}</p>
                </>
              )}
              {!attempt.is_correct && coaching.answer_analysis?.selected_answer_explanation && (
                <>
                  <h5>Why {attempt.selected_label} fails</h5>
                  <p>{coaching.answer_analysis.selected_answer_explanation}</p>
                </>
              )}
              {coaching.next_step_hint && <p className="answer-log-next-step">{coaching.next_step_hint}</p>}
            </div>
          ) : (
            <p className="answer-log-detail-empty">
              {attempt.coaching_status === 'pending' ? 'This answer has not been graded yet.' : 'No coaching was stored for this answer.'}
            </p>
          )}
        </>
      )}
    </div>
  )
}


/**
 * `questionType` is optionally controlled so the skill matrix above can drill
 * straight down into "show me those answers" rather than making the student
 * re-find the same filter by hand.
 */
export function AnswerLogPanel({
  questionType: controlledType,
  onQuestionTypeChange,
}: {
  questionType?: string
  onQuestionTypeChange?: (value: string) => void
} = {}) {
  const [outcome, setOutcome] = useState<Outcome>('all')
  const [ownType, setOwnType] = useState<string>('')
  const questionType = controlledType ?? ownType
  const setQuestionType = onQuestionTypeChange ?? setOwnType
  const [selected, setSelected] = useState<string | null>(null)
  const facets = useQuery({ queryKey: ['history-facets'], queryFn: api.historyFacets })
  const filters = useMemo(
    () => ({
      correct: outcome === 'all' ? undefined : outcome === 'correct',
      question_type: questionType || undefined,
    }),
    [outcome, questionType],
  )
  const history = useInfiniteQuery({
    queryKey: ['history-attempts', filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.attemptHistory({ ...filters, limit: PAGE_SIZE, offset: pageParam as number }),
    getNextPageParam: (last) => (last.has_more ? last.offset + last.limit : undefined),
  })
  const attempts: HistoryAttempt[] = history.data?.pages.flatMap((page) => page.attempts) ?? []
  const total = history.data?.pages[0]?.total ?? 0
  const counts = facets.data
  // Facets arrive split by section, but the filter below sends `question_type`
  // alone — and a few types ("Inference") exist in both sections. Listed raw
  // that is the same option twice, each showing half its own count.
  const typeOptions = useMemo(() => {
    const totals = new Map<string, number>()
    for (const entry of counts?.question_types ?? []) {
      totals.set(entry.question_type, (totals.get(entry.question_type) ?? 0) + entry.attempts)
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  }, [counts])
  // An open drawer whose tile just left the grid is orphaned detail, so a
  // filter change closes it rather than leaving it stranded under the wall.
  const openAttempt = attempts.some((attempt) => attempt.attempt_id === selected) ? selected : null
  // Closing it is not enough: the selection has to be dropped as well, or
  // clearing the filter that hid the tile brings the drawer back on its own
  // as if the student had asked for it again.
  useEffect(() => {
    if (selected && openAttempt === null && !history.isLoading) setSelected(null)
  }, [selected, openAttempt, history.isLoading])

  return (
    <section className="answer-log-panel" aria-labelledby="answer-log-title">
      <div className="panel-heading">
        <div>
          <span>ANSWER LOG</span>
          <h2 id="answer-log-title">Every question you have answered</h2>
        </div>
        <Check />
      </div>
      <p className="answer-log-intro">
        One tile per answer, newest first. Green is right, amber is missed. Tap any tile to re-read the
        question, your reasoning, and the coaching.
      </p>

      {questionType && (
        <div className="answer-log-scope" role="status">
          <span>Showing {questionType} only</span>
          <button type="button" onClick={() => setQuestionType('')}>Clear <X size={12} /></button>
        </div>
      )}

      {counts && counts.attempts > 0 && (
        <div className="answer-log-tally" aria-label="Lifetime answer tally">
          <div><strong>{counts.attempts}</strong><span>answered</span></div>
          <div className="is-correct"><strong>{counts.correct}</strong><span>right</span></div>
          <div className="is-wrong"><strong>{counts.incorrect}</strong><span>wrong</span></div>
          <div><strong>{counts.attempts ? Math.round((counts.correct / counts.attempts) * 100) : 0}%</strong><span>accuracy</span></div>
        </div>
      )}
      {/* The tally above is always lifetime; the grid below is whatever the
          filters currently allow. Saying so beats two numbers that disagree. */}
      {counts && counts.attempts > 0 && (outcome !== 'all' || questionType) && (
        <p className="answer-log-tally-note">Totals above are lifetime. The grid below is filtered.</p>
      )}

      <div className="answer-log-filters">
        <div className="answer-log-outcome" role="group" aria-label="Filter by result">
          {(['all', 'correct', 'incorrect'] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={outcome === value ? 'is-active' : ''}
              aria-pressed={outcome === value}
              onClick={() => setOutcome(value)}
            >
              {value === 'all' ? 'All' : value === 'correct' ? 'Right' : 'Wrong'}
            </button>
          ))}
        </div>
        <label className="answer-log-type">
          <span className="sr-only">Filter by question type</span>
          <select value={questionType} onChange={(event) => setQuestionType(event.target.value)}>
            <option value="">Every question type</option>
            {typeOptions.map(([type, attempts]) => (
              <option key={type} value={type}>
                {type} ({attempts})
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
      </div>

      {history.isLoading ? (
        <p className="answer-log-empty">Loading your answers…</p>
      ) : attempts.length === 0 ? (
        <p className="answer-log-empty">
          {total === 0 && outcome === 'all' && !questionType
            ? 'No answers recorded yet. Run a set of cases and every question will appear here.'
            : 'Nothing matches that filter yet.'}
        </p>
      ) : (
        <>
          {/* A plain grid of buttons rather than a list: each tile is the
              control that opens its own answer, and list semantics on top of
              that only gives a screen reader two things to announce. */}
          <div className="answer-log-grid" aria-label="Your answers, newest first">
            {attempts.map((attempt) => {
              const label = `${attempt.question_type} · ${attempt.is_correct ? 'correct' : 'missed'} · ${formatSeconds(attempt.elapsed_ms)} · ${formatDate(attempt.created_at)}`
              return (
                <button
                  type="button"
                  key={attempt.attempt_id}
                  className={[
                    'answer-tile',
                    attempt.is_correct ? 'is-correct' : 'is-wrong',
                    attempt.from_review_queue ? 'is-repeat' : '',
                    selected === attempt.attempt_id ? 'is-open' : '',
                  ].filter(Boolean).join(' ')}
                  aria-pressed={selected === attempt.attempt_id}
                  aria-label={label}
                  title={label}
                  onClick={() => setSelected((prev) => (prev === attempt.attempt_id ? null : attempt.attempt_id))}
                >
                  {attempt.is_correct ? <Check size={13} /> : <X size={13} />}
                  {attempt.over_target && <Clock3 className="answer-tile-slow" size={9} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
          <div className="answer-log-foot">
            <small>Showing {attempts.length} of {total}</small>
            {history.hasNextPage && (
              <button type="button" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>
                {history.isFetchingNextPage ? 'Loading…' : 'Load older answers'}
              </button>
            )}
          </div>
        </>
      )}

      {openAttempt && <AttemptDetail attemptId={openAttempt} onClose={() => setSelected(null)} />}
    </section>
  )
}
