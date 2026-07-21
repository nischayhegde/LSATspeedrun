import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  BookOpenCheck,
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  Flame,
  LogOut,
  Menu,
  PauseCircle,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'

import { api, ApiError } from './api'
import type { AttemptResult, CoachingFeedback, CoachingHint, StudySession, User } from './types'

export function LoadingScreen({ label = 'Opening the case file…' }: { label?: string }) {
  return (
    <div className="loading-screen">
      <div className="loader-seal"><FileSearch size={24} /></div>
      <p>{label}</p>
    </div>
  )
}

export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return <div className="error-notice" role="alert">{message}</div>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <span className="brand-mark"><FileSearch size={20} /></span>
      <span><strong>LSAT</strong> SHERLOCK</span>
    </div>
  )
}

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      navigate('/login')
    },
  })
  const levelProgress = Math.min(100, (user.story.xp % 500) / 5)

  return (
    <div className="app-frame">
      <header className="topbar">
        <NavLink to="/study" className="brand-link"><Brand compact /></NavLink>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation"><Menu /></button>
        <nav className={menuOpen ? 'nav-open' : ''} aria-label="Main navigation">
          <NavLink to="/study" onClick={() => setMenuOpen(false)}><BookOpenCheck size={17} /> Cases</NavLink>
          <NavLink to="/progress" onClick={() => setMenuOpen(false)}><BarChart3 size={17} /> Progress</NavLink>
        </nav>
        <div className="profile-cluster">
          <div className="xp-chip"><Flame size={15} /><strong>{user.story.xp}</strong> XP</div>
          <div className="avatar" title={user.display_name}>
            {user.avatar_url ? <img src={user.avatar_url} alt="" /> : user.display_name.slice(0, 1).toUpperCase()}
          </div>
          <button className="icon-button" onClick={() => logout.mutate()} aria-label="Sign out"><LogOut size={17} /></button>
        </div>
      </header>
      <div className="rank-line" aria-hidden="true"><span style={{ width: `${levelProgress}%` }} /></div>
      <main>{children}</main>
    </div>
  )
}

export function NoirScene({ chapter = 1, compact = false }: { chapter?: number; compact?: boolean }) {
  return (
    <div className={`noir-scene ${compact ? 'scene-compact' : ''}`} aria-hidden="true">
      <div className="moon" />
      <div className="city city-back" />
      <div className="city city-front" />
      <div className="rain" />
      <div className="lamp"><span /></div>
      <div className="detective-silhouette"><span className="hat" /><span className="coat" /></div>
      <div className="scene-caption">CHAPTER {chapter} · THE LANTERN BUREAU</div>
    </div>
  )
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function QuestionFlow({ session }: { session: StudySession }) {
  const item = session.current_item
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [hints, setHints] = useState<CoachingHint[]>(item?.hints || [])
  const [coaching, setCoaching] = useState<CoachingFeedback | null>(null)
  const [coachingStarted, setCoachingStarted] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [clockStartedAt, setClockStartedAt] = useState(Date.now())
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setSelected('')
    setReasoning('')
    setResult(null)
    setHints(item?.hints || [])
    setCoaching(null)
    setCoachingStarted(false)
    setNow(Date.now())
    setClockStartedAt(Date.now())
    setRequestId(crypto.randomUUID())
  }, [item?.id])

  const elapsed = useMemo(() => item ? Math.max(0, item.elapsed_ms + now - clockStartedAt) : 0, [item, now, clockStartedAt])
  const mutation = useMutation({
    mutationFn: () => api.submitAttempt(session.id, {
      item_id: item!.id,
      selected_label: selected,
      reasoning,
      elapsed_ms: elapsed,
    }, requestId),
    onSuccess: ({ result: attempt }) => {
      setResult(attempt)
      setCoaching(attempt.feedback.coaching || null)
    },
  })
  const hintMutation = useMutation({
    mutationFn: () => api.requestHint(session.id, item!.id),
    onSuccess: ({ hint }) => setHints((current) => [...current.filter((value) => value.level !== hint.level), hint].sort((a, b) => a.level - b.level)),
  })
  const coachingMutation = useMutation({
    mutationFn: (attemptId: string) => api.coaching(attemptId),
    onSuccess: ({ coaching: feedback }) => setCoaching(feedback),
  })
  const pauseMutation = useMutation({
    mutationFn: () => api.pauseSession(session.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: session.mode === 'diagnostic' ? ['diagnostic'] : ['current-session', 'daily'] })
      navigate(session.mode === 'diagnostic' ? '/diagnostic?paused=1' : '/study')
    },
  })

  useEffect(() => {
    if (result && !result.feedback.coaching && !coachingStarted) {
      setCoachingStarted(true)
      coachingMutation.mutate(result.attempt_id)
    }
  }, [result, coachingStarted])

  useEffect(() => {
    const pauseOnExit = () => { void api.pauseSession(session.id, true).catch(() => undefined) }
    window.addEventListener('pagehide', pauseOnExit)
    return () => window.removeEventListener('pagehide', pauseOnExit)
  }, [session.id])

  if (!item) return <LoadingScreen label="Finding the next evidence file…" />

  const continueCase = async () => {
    if (result?.session_complete) {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      await queryClient.invalidateQueries({ queryKey: session.mode === 'diagnostic' ? ['diagnostic'] : ['current-session', 'daily'] })
      await queryClient.invalidateQueries({ queryKey: ['progress'] })
      navigate(session.mode === 'diagnostic' ? '/diagnostic/results' : `/session/${session.id}/summary`)
      return
    }
    if (session.mode === 'diagnostic') await queryClient.invalidateQueries({ queryKey: ['diagnostic'] })
    else await queryClient.invalidateQueries({ queryKey: ['session', session.id] })
  }

  return (
    <div className="case-page">
      <section className="case-story-panel">
        <div className="case-exit-bar">
          <button onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
            <Save size={15} /> {pauseMutation.isPending ? 'Saving…' : 'Save & exit'}
          </button>
          <span>Progress saved after every answer</span>
        </div>
        <div className="case-scene-wrap"><NoirScene compact chapter={Math.floor(item.position / 8) + 1} /></div>
        <div className="case-story-copy">
          <div className="eyebrow">{item.story.eyebrow}</div>
          <h1>{item.story.title}</h1>
          <p className="story-brief">{item.story.brief}</p>
          <div className="dialogue">
            <span className="character-seal">RV</span>
            <div><strong>{item.story.presenting_character}</strong><p>“{item.story.dialogue}”</p></div>
          </div>
        </div>
      </section>

      <section className="evidence-panel">
        <div className="question-toolbar">
          <div><span>{item.question.section}</span><strong>{item.question.question_type}</strong></div>
          <div className="timer" aria-label={`Elapsed time ${formatTime(elapsed)}`}><Clock3 size={16} /> {formatTime(elapsed)}</div>
        </div>
        <div className="session-progress" aria-label={`Question ${session.current_index + 1} of ${session.total_items}`}>
          <span style={{ width: `${((session.current_index + 1) / session.total_items) * 100}%` }} />
        </div>
        <div className="evidence-heading">
          <div className="paperclip" />
          <div><small>EVIDENCE FILE {String(session.current_index + 1).padStart(2, '0')}</small><h2>Review the record</h2></div>
          <div className="difficulty">{'◆'.repeat(item.question.difficulty)}<span>{'◇'.repeat(5 - item.question.difficulty)}</span></div>
        </div>

        {item.question.passage && (
          <details className="passage" open>
            <summary>Reading passage</summary>
            {item.question.passage.text.split(/(?=Passage [AB] )/).map((part, index) => <p key={index}>{part}</p>)}
          </details>
        )}
        {item.question.stimulus && <p className="stimulus">{item.question.stimulus}</p>}
        <h3 className="stem">{item.question.stem}</h3>

        {!result && (
          <div className="hint-section">
            <div className="hint-actions">
              <button className="hint-button" onClick={() => hintMutation.mutate()} disabled={hintMutation.isPending || hints.length >= 3}>
                <Sparkles size={16} />
                {hintMutation.isPending ? 'Rowan is reviewing the file…' : hints.length ? `Request clue ${hints.length + 1} of 3` : 'Ask Rowan for a controlled hint'}
              </button>
              <small>Hints guide the method without revealing the keyed answer.</small>
            </div>
            {hintMutation.error && <ErrorNotice error={hintMutation.error} />}
            {hints.map((hint) => (
              <div className="hint-card" key={hint.level}>
                <span>CLUE {hint.level}</span>
                <div><strong>{hint.focus}</strong><p>{hint.hint}</p><small>Try this: {hint.strategy}</small></div>
              </div>
            ))}
          </div>
        )}

        <fieldset className="choices" disabled={Boolean(result) || mutation.isPending}>
          <legend className="sr-only">Answer choices</legend>
          {item.question.choices.map((choice) => (
            <label key={choice.label} className={`choice ${selected === choice.label ? 'selected' : ''}`}>
              <input type="radio" name="answer" value={choice.label} checked={selected === choice.label} onChange={() => setSelected(choice.label)} />
              <span className="choice-label">{choice.label}</span>
              <span>{choice.text}</span>
            </label>
          ))}
        </fieldset>

        {!result && (
          <label className="reasoning-box">
            <span><Sparkles size={16} /> Explain your answer <em>{item.requires_reasoning ? 'Required for this file' : 'Optional · graded if provided'}</em></span>
            <textarea value={reasoning} onChange={(event) => setReasoning(event.target.value)} maxLength={4000} placeholder="What is the conclusion, what logical work must the answer do, and why does your choice do it?" />
            <small>{reasoning.length}/4000 · TrueFoundry grades reasoning separately from whether the selected answer is correct.</small>
          </label>
        )}

        {mutation.error && <ErrorNotice error={mutation.error} />}
        {!result && (
          <button className="primary-button submit-answer" disabled={!selected || mutation.isPending || (item.requires_reasoning && reasoning.trim().length < 20)} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Filing answer…' : <>File answer <ChevronRight size={18} /></>}
          </button>
        )}

        {result && (
          <div className={`debrief ${result.is_correct ? 'correct' : 'incorrect'}`}>
            <div className="result-icon">{result.is_correct ? <Check /> : <X />}</div>
            <div className="debrief-copy">
              <div className="eyebrow">DETERMINISTIC ANSWER CHECK</div>
              <h2>{result.feedback.headline}</h2>
              <p>{result.feedback.diagnosis}</p>
              <div className="coaching-note"><ShieldCheck size={18} /><span>{result.feedback.coaching_notice}</span></div>
              <div className="ai-coaching-panel">
                <div className="ai-coaching-header">
                  <div><Sparkles size={18} /><span><strong>TrueFoundry reasoning review</strong><small>gpt-5.6-luna · xhigh</small></span></div>
                  <span className="verified-pill"><ShieldCheck size={13} /> Key verified</span>
                </div>
                {!coaching && coachingMutation.isPending && (
                  <div className="coaching-loading"><span className="coaching-spinner" /><div><strong>Tracing your reasoning…</strong><small>Grading the explanation and analyzing each answer choice.</small></div></div>
                )}
                {!coaching && coachingMutation.error && (
                  <div className="coaching-retry">
                    <ErrorNotice error={coachingMutation.error} />
                    <button className="secondary-button" onClick={() => coachingMutation.mutate(result.attempt_id)}>Retry AI review</button>
                  </div>
                )}
                {coaching && (
                  <div className="coaching-results">
                    <div className="grade-row">
                      <div className="explanation-grade">
                        {coaching.explanation_grade == null ? <strong>—</strong> : <strong>{coaching.explanation_grade}</strong>}
                        <span>{coaching.explanation_grade == null ? 'QUICK FILE' : 'REASONING / 100'}</span>
                      </div>
                      <div><span className={`verdict verdict-${coaching.reasoning_verdict}`}>{coaching.reasoning_verdict.replace('_', ' ')}</span><p>{coaching.reasoning_summary}</p></div>
                    </div>
                    {coaching.first_error && (
                      <div className="first-error-card">
                        <span>FIRST REASONING BREAK · {coaching.first_error.code.replaceAll('_', ' ')}</span>
                        <strong>{coaching.first_error.description}</strong>
                        <p><b>Repair:</b> {coaching.first_error.repair}</p>
                      </div>
                    )}
                    <div className="answer-analysis-card correct-analysis">
                      <span>WHY {result.feedback.correct_label} WORKS</span>
                      <p>{coaching.answer_analysis.correct_answer_explanation}</p>
                    </div>
                    {!result.is_correct && (
                      <div className="answer-analysis-card wrong-analysis">
                        <span>WHY {result.feedback.selected_label} FAILS</span>
                        <p>{coaching.answer_analysis.selected_answer_explanation}</p>
                      </div>
                    )}
                    <details className="choice-analysis-list">
                      <summary>Review every answer choice</summary>
                      {coaching.answer_analysis.choice_explanations.map((choice) => (
                        <div key={choice.label}><span className={choice.is_correct ? 'correct-choice-mark' : ''}>{choice.label}</span><p>{choice.explanation}</p></div>
                      ))}
                    </details>
                    <div className="next-step"><strong>Next-step clue</strong><p>{coaching.next_step_hint}</p></div>
                    <p className="ai-debrief">{coaching.debrief}</p>
                  </div>
                )}
              </div>
              <blockquote>{result.feedback.narrative_outcome}</blockquote>
              <div className="result-meta"><span>+{result.xp_earned} XP</span><span>{formatTime(result.elapsed_ms)}</span></div>
              <button className="primary-button" onClick={continueCase} disabled={coachingMutation.isPending}>
                {coachingMutation.isPending ? 'Waiting for reasoning review…' : result.session_complete ? 'Open session debrief' : 'Open next case'} {!coachingMutation.isPending && <ChevronRight size={18} />}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
