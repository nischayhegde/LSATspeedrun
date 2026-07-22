import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Brain, Check, Clock3, LogOut, Pause, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from './api'
import type { CoachingFeedback, StudySession, User } from './types'


export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-screen" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  )
}


export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  return <div className="error-notice" role="alert">{message}</div>
}


export function Brand() {
  return (
    <Link className="brand" to="/practice" aria-label="LSAT Speedrun home">
      <span className="brand-mark">LS</span>
      <span>LSAT Speedrun</span>
    </Link>
  )
}


export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })
  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <div className="account-menu">
          {user.avatar_url
            ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
            : <span className="avatar-fallback">{user.display_name.slice(0, 1).toUpperCase()}</span>}
          <span className="account-name">{user.display_name}</span>
          <button className="icon-button" onClick={() => logout.mutate()} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}


function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}


function CoachingPanel({ coaching }: { coaching: CoachingFeedback }) {
  return (
    <section className="coaching-panel">
      <div className="coaching-heading">
        <div>
          <span className="eyebrow">AI REVIEW</span>
          <h3>Answer explanations</h3>
        </div>
        {coaching.explanation_grade != null && (
          <div className="grade-badge">
            <strong>{coaching.explanation_grade}</strong>
            <span>reasoning</span>
          </div>
        )}
      </div>

      {coaching.explanation_grade != null && (
        <div className="reasoning-review">
          <strong>{coaching.reasoning_verdict.replace('_', ' ')}</strong>
          <p>{coaching.reasoning_summary}</p>
          {coaching.first_error && (
            <p><b>First issue:</b> {coaching.first_error.description} {coaching.first_error.repair}</p>
          )}
        </div>
      )}

      <div className="correct-explanation">
        <Check size={18} />
        <p>{coaching.answer_analysis.correct_answer_explanation}</p>
      </div>
      <div className="choice-explanations">
        {coaching.answer_analysis.choice_explanations.map((choice) => (
          <div className={choice.is_correct ? 'choice-explanation correct' : 'choice-explanation'} key={choice.label}>
            <span>{choice.label}</span>
            <p>{choice.explanation}</p>
          </div>
        ))}
      </div>
      <div className="next-step"><Brain size={18} /><span>{coaching.next_step_hint}</span></div>
    </section>
  )
}


export function QuestionFlow({ session }: { session: StudySession }) {
  const queryClient = useQueryClient()
  const item = session.pending_item || session.current_item
  const result = session.pending_result
  const [selected, setSelected] = useState(item?.draft.selected_label || '')
  const [reasoning, setReasoning] = useState(item?.draft.reasoning || '')
  const [clock, setClock] = useState(Date.now())
  const [openedAt, setOpenedAt] = useState(Date.now())

  useEffect(() => {
    setSelected(item?.draft.selected_label || '')
    setReasoning(item?.draft.reasoning || '')
    setOpenedAt(Date.now())
  }, [item?.id])

  useEffect(() => {
    if (!item?.timer_active || result) return
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [item?.timer_active, result])

  useEffect(() => {
    if (!item || result) return
    const timeout = window.setTimeout(() => {
      void api.saveDraft(session.id, item.id, { selected_label: selected || undefined, reasoning }).catch(() => undefined)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [item?.id, reasoning, result, selected, session.id])

  const submit = useMutation({
    mutationFn: () => api.submitAttempt(
      session.id,
      { item_id: item!.id, selected_label: selected, reasoning: reasoning || undefined },
      crypto.randomUUID(),
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', session.id] }),
  })
  const continuePractice = useMutation({
    mutationFn: () => api.acknowledgeReview(session.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', session.id] }),
  })
  const savedCoaching = result?.feedback.coaching
  const coaching = useQuery({
    queryKey: ['coaching', result?.attempt_id],
    queryFn: () => api.coaching(result!.attempt_id),
    enabled: Boolean(result && !savedCoaching),
  })
  const coachingFeedback = savedCoaching || coaching.data?.coaching

  const elapsed = useMemo(() => {
    if (!item) return 0
    return item.elapsed_ms + (item.timer_active && !result ? Math.max(0, clock - openedAt) : 0)
  }, [clock, item, openedAt, result])

  if (!item) return <ErrorNotice error={new Error('This practice question could not be loaded.')} />
  const question = item.question

  return (
    <div className="question-layout">
      <div className="question-topbar">
        <div>
          <span>{question.section === 'Logical Reasoning' ? 'LR' : 'RC'}</span>
          <strong>{question.question_type}</strong>
        </div>
        <div className="question-progress">
          Question {Math.min(item.position + 1, session.total_items)} of {session.total_items}
        </div>
        <div className="timer"><Clock3 size={17} /> {formatTime(elapsed)}</div>
      </div>
      <div className="progress-track"><span style={{ width: `${session.progress_percent}%` }} /></div>

      <div className={question.passage ? 'question-content with-passage' : 'question-content'}>
        {question.passage && (
          <article className="passage-card">
            <div className="eyebrow"><BookOpen size={15} /> READING PASSAGE</div>
            <div className="passage-text">{question.passage.text}</div>
          </article>
        )}

        <section className="answer-card">
          {question.stimulus && <div className="stimulus">{question.stimulus}</div>}
          <h1>{question.stem}</h1>
          <div className="choices" role="radiogroup" aria-label="Answer choices">
            {question.choices.map((choice) => {
              const chosen = (result?.feedback.selected_label || selected) === choice.label
              const correct = result?.feedback.correct_label === choice.label
              const wrongSelected = Boolean(result && chosen && !correct)
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={Boolean(result)}
                  className={`choice ${chosen ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrongSelected ? 'incorrect' : ''}`}
                  key={choice.label}
                  onClick={() => setSelected(choice.label)}
                >
                  <span className="choice-label">{choice.label}</span>
                  <span>{choice.text}</span>
                  {correct && <Check className="choice-status" size={18} />}
                  {wrongSelected && <X className="choice-status" size={18} />}
                </button>
              )
            })}
          </div>

          {!result && (
            <div className="reasoning-box">
              <label htmlFor="reasoning">Explain your reasoning <span>optional — graded by AI</span></label>
              <textarea
                id="reasoning"
                value={reasoning}
                onChange={(event) => setReasoning(event.target.value)}
                placeholder="Why does your choice follow, and what makes the closest alternative wrong?"
                rows={4}
              />
            </div>
          )}

          {!result && (
            <div className="answer-actions">
              <button className="primary-button" disabled={!selected || submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? 'Checking answer…' : <>Check answer <ArrowRight size={18} /></>}
              </button>
              {submit.error && <ErrorNotice error={submit.error} />}
            </div>
          )}

          {result && (
            <div className={result.is_correct ? 'result-banner correct' : 'result-banner incorrect'}>
              <div>{result.is_correct ? <Check /> : <X />}</div>
              <div><strong>{result.feedback.headline}</strong><span>{result.feedback.diagnosis}</span></div>
            </div>
          )}

          {result && coaching.isLoading && (
            <div className="coaching-loading"><span className="spinner" /> Grading your reasoning and explaining every choice…</div>
          )}
          {result && coaching.error && !coachingFeedback && (
            <div className="coaching-error">
              <ErrorNotice error={coaching.error} />
              <button className="secondary-button" onClick={() => coaching.refetch()}>Retry AI review</button>
            </div>
          )}
          {coachingFeedback && <CoachingPanel coaching={coachingFeedback} />}

          {result && (
            <div className="continue-row">
              <button className="primary-button" disabled={continuePractice.isPending || coaching.isLoading} onClick={() => continuePractice.mutate()}>
                {continuePractice.isPending
                  ? 'Loading…'
                  : result.session_complete
                    ? <>View summary <ArrowRight size={18} /></>
                    : <>Next random question <ArrowRight size={18} /></>}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}


export function PauseButton({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate()
  const pause = useMutation({
    mutationFn: () => api.pauseSession(sessionId),
    onSuccess: () => navigate('/practice'),
  })
  return (
    <button className="secondary-button compact" onClick={() => pause.mutate()} disabled={pause.isPending}>
      <Pause size={16} /> Save & exit
    </button>
  )
}
