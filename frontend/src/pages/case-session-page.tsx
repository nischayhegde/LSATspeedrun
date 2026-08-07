import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Brain,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Clock3,
  Play,
  ShieldAlert,
  Target,
} from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, formatMoney, LoadingScreen, useRestoredChrome } from '../components'
import { PauseButton, QuestionFlow } from '../case-flow'
import { useSound } from '../sound'

// Shares the Practice tab's mega-litigation chunk, so the post-form results
// page explains a withheld tier with the same component that tab uses without
// pulling either into this route.
const WithheldPromotionNotice = lazy(() =>
  import('../mega-litigation').then((module) => ({ default: module.WithheldPromotionNotice })),
)


function formatReviewTime(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}


function CompletedSessionReview({ sessionId }: { sessionId: string }) {
  useRestoredChrome()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selectedPosition, setSelectedPosition] = useState(0)
  const [priorityOnly, setPriorityOnly] = useState(true)
  const reviewQuery = useQuery({ queryKey: ['session-review', sessionId], queryFn: () => api.sessionReview(sessionId) })
  const queueQuery = useQuery({ queryKey: ['review-queue'], queryFn: api.reviewQueue })
  const review = reviewQuery.data?.review
  const priorityRank = { high_confidence_miss: 0, miss: 1, low_confidence_correct: 2, slow_correct: 3 } as const
  const priorityItems = (review?.items ?? [])
    .filter((item) => item.priority_reason)
    .sort((a, b) => priorityRank[a.priority_reason!] - priorityRank[b.priority_reason!])
  const visibleItems = priorityOnly && priorityItems.length ? priorityItems : review?.items ?? []
  const selected = visibleItems.find((item) => item.position === selectedPosition) ?? visibleItems[0]
  const coaching = useQuery({
    queryKey: ['coaching', selected?.attempt_id],
    queryFn: () => api.coaching(selected!.attempt_id),
    enabled: Boolean(selected?.attempt_id),
    retry: false,
  })
  const dueReviews = queueQuery.data?.review_queue.due ?? 0
  const startRepair = useMutation({
    // Due repairs are folded into an ordinary run now; there is no repair mode.
    mutationFn: () => api.startPractice({ size: Math.min(5, Math.max(1, dueReviews)) }),
    onSuccess: ({ session }) => {
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      navigate(`/cases/${session.id}`)
    },
  })
  const finishBrief = useMutation({
    mutationFn: () => api.acknowledgeSessionReview(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-docket'] })
      navigate('/cases')
    },
  })

  useEffect(() => {
    if (!review?.items.length) return
    const priority = [...review.items]
      .filter((item) => item.priority_reason)
      .sort((a, b) => priorityRank[a.priority_reason!] - priorityRank[b.priority_reason!])[0]
    setSelectedPosition(priority?.position ?? review.items[0].position)
  }, [review?.session.id])

  if (reviewQuery.isLoading) return <LoadingScreen label="Preparing your answer audit…" />
  if (reviewQuery.error || !review) return <div className="contained"><ErrorNotice error={reviewQuery.error || new Error('This completed run could not be reviewed.')} /></div>

  const summary = review.summary
  const isDiagnostic = review.session.mode === 'diagnostic'
  const highConfidenceErrors = review.items.filter((item) => !item.is_correct && (item.confidence ?? 0) >= 4).length
  // Every completed practice run gets a brief. Gating this on a style that no
  // longer exists would leave the brief permanently unacknowledgeable, which
  // would strand the daily docket at "brief ready" forever.
  const isBrief = !isDiagnostic
  const correctChoice = selected?.question.choices.find((choice) => choice.label === selected.correct_label)
  const selectedChoice = selected?.question.choices.find((choice) => choice.label === selected.selected_label)
  const rationale = coaching.data?.coaching

  return (
    <div className="session-review-page page-wrap">
      <section className="review-summary-hero">
        <div>
          <span className="eyebrow">{isDiagnostic ? 'MEGA-LITIGATION COMPLETE' : 'DEEP BRIEF'}</span>
          <h1>{priorityItems.length ? 'Brief the decisions that can change your next run.' : 'Clean run. Confirm what held.'}</h1>
          <p>{isDiagnostic ? 'A full practice LSAT pays no fees and moves no streak — only the tier promotion above 70%. Open any question for a concise rationale; only mistakes and uncertainty enter repair.' : 'Results are separated from firm currency and rank. Open any question for a concise rationale; only mistakes and uncertainty enter repair.'}</p>
        </div>
        <div className="review-score"><strong>{isDiagnostic && summary.form_accuracy !== undefined ? summary.form_accuracy : summary.accuracy}%</strong><span>{summary.correct} of {summary.questions_completed} correct</span><small>{summary.elapsed_minutes} minutes</small></div>
      </section>

      {summary.promotion && (
        <section className="promotion-banner" aria-label="Firm promotion">
          <div><span>THE FIRM MOVED UP</span><strong>{summary.promotion.name}</strong><p>Clearing 70% of the form promoted you to tier {summary.promotion.tier}. Reputation was raised to {summary.promotion.reputation_after}.</p></div>
          {summary.promotion.granted_assets.length > 0 && <ul>{summary.promotion.granted_assets.map((asset) => <li key={asset.key}>{asset.name}</li>)}</ul>}
          <small>{summary.promotion.granted_assets.length ? `${summary.promotion.granted_assets.length} prerequisite ${summary.promotion.granted_assets.length === 1 ? 'upgrade was' : 'upgrades were'} unlocked free — ${formatMoney(summary.promotion.waived_cost)} waived.` : 'You already owned every prerequisite for this tier.'}</small>
        </section>
      )}

      {/* The mirror image of the banner above: cleared the bar, no tier. The
          server only sends `promotion_status` on that branch, and the results
          page is the first place the student looks for it. */}
      {summary.promotion_status && !summary.promotion_status.available && (
        <Suspense fallback={null}>
          <WithheldPromotionNotice status={summary.promotion_status} />
        </Suspense>
      )}

      <section className="review-signal-row" aria-label="Run signals">
        <article><Target /><span>Accuracy</span><strong>{summary.accuracy}%</strong></article>
        <article><Clock3 /><span>Elapsed</span><strong>{summary.elapsed_minutes}m</strong></article>
        <article><ShieldAlert /><span>Confident misses</span><strong>{highConfidenceErrors}</strong></article>
        <article><Brain /><span>Priority repairs</span><strong>{priorityItems.length}</strong></article>
      </section>

      <section className="answer-audit-shell">
        <aside className="answer-audit-index" aria-label="Questions in this run">
          <div><span>{isBrief ? 'DEEP BRIEF' : 'ANSWER AUDIT'}</span><small>{priorityOnly && priorityItems.length ? `${priorityItems.length} priority decisions` : `All ${review.items.length} questions`}</small></div>
          {priorityItems.length > 0 && <div className="brief-filter" role="group" aria-label="Brief scope"><button className={priorityOnly ? 'active' : ''} onClick={() => setPriorityOnly(true)}>Priority</button><button className={!priorityOnly ? 'active' : ''} onClick={() => setPriorityOnly(false)}>All {review.items.length}</button></div>}
          <div className="answer-audit-list">
            {visibleItems.map((item) => (
              <button key={item.attempt_id} className={`${item.position === selected?.position ? 'active' : ''} ${item.is_correct ? 'correct' : 'repair'}`} onClick={() => setSelectedPosition(item.position)}>
                <span>{item.is_correct ? <Check size={15} /> : <ShieldAlert size={15} />} Q{item.position + 1}</span>
                <small>{item.question.section === 'Logical Reasoning' ? 'LR' : 'RC'} · {formatReviewTime(item.elapsed_ms)}</small>
                <b>{item.priority_reason === 'high_confidence_miss' ? 'CONFIDENT MISS' : item.priority_reason === 'low_confidence_correct' ? 'UNCERTAIN' : item.priority_reason === 'slow_correct' ? 'SLOW' : item.priority_reason === 'miss' ? 'MISS' : item.confidence ? `C${item.confidence}` : '—'}</b>
              </button>
            ))}
          </div>
        </aside>

        {selected && <article className="answer-audit-detail">
          <div className="audit-detail-heading"><div><span>{selected.question.section} · {selected.question.question_type}</span><h2>Question {selected.position + 1}</h2></div><strong className={selected.is_correct ? 'correct' : 'repair'}>{selected.is_correct ? 'CORRECT' : 'REPAIR'}</strong></div>
          {selected.question.passage && <details className="audit-source"><summary>Read passage</summary><p>{selected.question.passage.text}</p></details>}
          {selected.question.stimulus && <p className="audit-stimulus">{selected.question.stimulus}</p>}
          <h3>{selected.question.stem}</h3>
          <div className="audit-choices">
            {selected.question.choices.map((choice) => <div key={choice.label} className={`${choice.label === selected.correct_label ? 'correct' : ''} ${choice.label === selected.selected_label && !selected.is_correct ? 'selected-wrong' : ''}`}><b>{choice.label}</b><span>{choice.text}</span>{choice.label === selected.correct_label && <small>credited</small>}{choice.label === selected.selected_label && <small>your answer</small>}</div>)}
          </div>
          <section className="concise-rationale" aria-live="polite">
            <div><Brain size={18} /><span>CONCISE REASONING</span></div>
            {coaching.isLoading ? <p>Preparing the shortest useful explanation…</p> : rationale ? <>
              <h4>Why {selected.correct_label} wins</h4><p>{rationale.answer_analysis.correct_answer_explanation}</p>
              {!selected.is_correct && <><h4>Why {selected.selected_label} falls short</h4><p>{rationale.answer_analysis.selected_answer_explanation}</p></>}
              <blockquote>{rationale.next_step_hint}</blockquote>
            </> : <>
              <h4>Verified outcome</h4><p>{selected.feedback?.diagnosis || `The verified answer is ${selected.correct_label}.`} {correctChoice ? `${selected.correct_label}: ${correctChoice.text}` : ''}</p>
              {!selected.is_correct && selectedChoice && <p>Your answer was {selected.selected_label}: {selectedChoice.text}</p>}
              <small>{coaching.error ? 'Detailed coaching is unavailable right now; the verified key remains authoritative.' : 'Opening a question prepares its concise rationale.'}</small>
            </>}
          </section>
        </article>}
      </section>

      <section className="review-next-actions">
        <div><span className="eyebrow">NEXT BEST ACTION</span><h2>{dueReviews ? `Repair ${Math.min(5, dueReviews)} due item${dueReviews === 1 ? '' : 's'}` : 'Return to unseen questions'}</h2><p>{dueReviews ? 'Write reasoning only where the evidence says it is needed.' : 'Your repair queue is clear; another run of cases provides fresh evidence.'}</p></div>
        <div>
          {isBrief && <button className="primary-button" onClick={() => finishBrief.mutate()} disabled={finishBrief.isPending}>{finishBrief.isPending ? 'Closing brief…' : 'Finish Deep Brief'} <CheckCircle2 /></button>}
          {dueReviews > 0 && <button className="primary-button" onClick={() => startRepair.mutate()} disabled={startRepair.isPending}>{startRepair.isPending ? 'Building review…' : 'Start priority review'} <ArrowRight /></button>}
          <button className="secondary-button" onClick={() => navigate('/cases')}>Practice modes</button>
          <button className="secondary-button" onClick={() => navigate('/progress')}>View progress</button>
        </div>
        {(startRepair.error || finishBrief.error) && <ErrorNotice error={startRepair.error || finishBrief.error} />}
      </section>
    </div>
  )
}


function PausedCasePage({ sessionId }: { sessionId: string }) {
  useRestoredChrome()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const resume = useMutation({
    mutationFn: () => api.resumeSession(sessionId),
    onSuccess: () => {
      void play('resume', { seed: sessionId, intensity: .5 })
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    },
  })
  return (
    <div className="paused-case page-wrap">
      <div className="paused-folder"><BriefcaseBusiness /></div>
      <span className="eyebrow">CASE FILE SAVED</span>
      <h1>Your argument is waiting.</h1>
      <p>Your answer choice and written reasoning are safe. Paused questions do not receive time-bonus points.</p>
      <button className="primary-button" onClick={() => resume.mutate()} disabled={resume.isPending}>
        <Play size={18} /> {resume.isPending ? 'Returning…' : 'Return to the case'}
      </button>
      {resume.error && <ErrorNotice error={resume.error} />}
    </div>
  )
}


/* A case route hides the header and the bottom nav. Without the chrome back
   there is no way off this screen, so a session that cannot be loaded has to
   restore it and offer the way out itself. */
function CaseSessionError({ error }: { error: unknown }) {
  useRestoredChrome()
  return (
    <div className="paused-case page-wrap">
      <div className="paused-folder"><BriefcaseBusiness /></div>
      <span className="eyebrow">CASE FILE UNAVAILABLE</span>
      <h1>That file is not on the desk.</h1>
      <ErrorNotice error={error} />
      <Link className="primary-button" to="/cases"><Play size={18} /> Back to the docket</Link>
    </div>
  )
}

export function CaseSessionPage() {
  const { sessionId } = useParams()
  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.session(sessionId!),
    enabled: Boolean(sessionId),
  })
  if (!sessionId) return <Navigate to="/cases" replace />
  if (sessionQuery.isLoading) return <LoadingScreen label="Pulling the case file…" />
  if (sessionQuery.error) return <CaseSessionError error={sessionQuery.error} />
  const session = sessionQuery.data!.session
  if (session.status === 'paused') return <PausedCasePage sessionId={session.id} />
  if (session.status === 'completed' && !session.pending_result) return <CompletedSessionReview sessionId={session.id} />
  return (
    <div className="session-page">
      {/* A mega-litigation runs in one sitting, so there is no pause to offer — the server refuses one. */}
      {!session.pending_result && (session.mode === 'diagnostic'
        ? <div className="session-controls"><span className="one-sitting-note"><span className="one-sitting-note-long">One sitting · the clock does not stop</span><span className="one-sitting-note-short">No pause</span></span></div>
        : <div className="session-controls"><PauseButton sessionId={session.id} returnTo="/office" /></div>)}
      <QuestionFlow session={session} />
    </div>
  )
}
