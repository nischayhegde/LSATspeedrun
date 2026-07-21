import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  BarChart3,
  BookOpenCheck,
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  Flame,
  Lock,
  LogOut,
  Menu,
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
        <NavLink to="/" className="brand-link"><Brand compact /></NavLink>
        {user.diagnostic_complete && (
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation"><Menu /></button>
        )}
        {user.diagnostic_complete ? (
          <nav className={menuOpen ? 'nav-open' : ''} aria-label="Main navigation">
            <NavLink to="/study" onClick={() => setMenuOpen(false)}><BookOpenCheck size={17} /> Cases</NavLink>
            <NavLink to="/archive" onClick={() => setMenuOpen(false)}><Archive size={17} /> Archive</NavLink>
            <NavLink to="/progress" onClick={() => setMenuOpen(false)}><BarChart3 size={17} /> Progress</NavLink>
          </nav>
        ) : (
          <nav className="nav-locked" aria-label="Main navigation">
            <span className="nav-lock-note"><Lock size={15} /> Complete the diagnostic to unlock</span>
          </nav>
        )}
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

export function CaseBoardGraphic({
  variant,
  count = 0,
  progress = 0,
  unlocked = false,
}: {
  variant: 'archive' | 'boss'
  count?: number
  progress?: number
  unlocked?: boolean
}) {
  return (
    <div className={`case-board-graphic ${variant} ${unlocked ? 'is-unlocked' : ''}`} aria-hidden="true">
      <div className="board-depth">
        <div className="board-surface">
          <span className="board-pin pin-one" />
          <span className="board-pin pin-two" />
          <span className="board-thread thread-one" />
          <span className="board-thread thread-two" />
          {variant === 'archive' ? (
            <>
              <div className="board-folder"><span>COLD CASES</span></div>
              <div className="board-paper paper-one"><i>A</i><b>?</b></div>
              <div className="board-paper paper-two"><i>B</i><b>✓</b></div>
              <div className="board-stamp">{count}<small>DUE</small></div>
            </>
          ) : (
            <>
              <div className="quill-profile"><span>Q</span></div>
              <div className="quill-seal">{unlocked ? 'OPEN' : 'SEALED'}</div>
              <div className="boss-progress-ring" style={{ '--boss-progress': `${Math.max(0, Math.min(100, progress)) * 3.6}deg` } as React.CSSProperties}>
                <span>{Math.round(progress)}%</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function EvidenceFileGraphic({
  selected,
  correct,
  solved,
}: {
  selected: string
  correct: string
  solved: boolean
}) {
  return (
    <div className={`evidence-file-graphic ${solved ? 'solved' : 'missed'}`} aria-hidden="true">
      <div className="evidence-folder-tab">FILED EVIDENCE</div>
      <div className="evidence-sheet sheet-back" />
      <div className="evidence-sheet sheet-front">
        <span className="evidence-hole hole-one" />
        <span className="evidence-hole hole-two" />
        <div className="evidence-rule" />
        <div className="evidence-rule short" />
        <div className="evidence-answer-pair">
          <span><small>YOUR PICK</small>{selected}</span>
          <i>→</i>
          <span className="key"><small>VERIFIED</small>{correct}</span>
        </div>
        <div className="evidence-verdict-mark">{solved ? 'CLOSED' : 'REOPENED'}</div>
      </div>
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
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!result) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [result])

  useEffect(() => {
    setSelected('')
    setReasoning('')
    setResult(null)
    setHints(item?.hints || [])
    setCoaching(null)
    setCoachingStarted(false)
    setRequestId(crypto.randomUUID())
  }, [item?.id])

  const elapsed = useMemo(() => item ? Math.max(0, now - new Date(item.served_at).getTime()) : 0, [item, now])
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

  useEffect(() => {
    if (result && !result.feedback.coaching && !coachingStarted) {
      setCoachingStarted(true)
      coachingMutation.mutate(result.attempt_id)
    }
  }, [result, coachingStarted])

  if (!item) return <LoadingScreen label="Finding the next evidence file…" />

  const continueCase = async () => {
    if (result?.session_complete) {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate(session.mode === 'diagnostic' ? '/diagnostic/results' : `/session/${session.id}/summary`)
      return
    }
    if (session.mode === 'diagnostic') await queryClient.invalidateQueries({ queryKey: ['diagnostic'] })
    else await queryClient.invalidateQueries({ queryKey: ['session', session.id] })
  }

  return (
    <div className="case-page">
      <section className="case-story-panel">
        <div className="case-scene-wrap"><NoirScene compact chapter={Math.floor(item.position / 8) + 1} /></div>
        <div className="case-story-copy">
          <div className="eyebrow">{item.story.eyebrow}</div>
          <h1>{item.story.title}</h1>
          <p className="story-brief">{item.story.brief}</p>
          <div className="dialogue">
            <span className={`character-seal ${session.mode === 'boss' ? 'quill' : ''}`}>{session.mode === 'boss' ? 'Q' : 'RV'}</span>
            <div><strong>{item.story.presenting_character}</strong><p>“{item.story.dialogue}”</p></div>
          </div>
        </div>
      </section>

      <section className="evidence-panel">
        <div className="question-toolbar">
          <div><span>{item.question.section}</span><strong>{item.question.question_type}</strong></div>
          {session.mode !== 'daily' && <span className={`session-mode-pill mode-${session.mode}`}>{session.mode === 'review' ? 'Cold case' : session.mode === 'boss' ? 'Quill encounter' : 'Diagnostic'}</span>}
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
          {item.question.choices.map((choice) => {
            const isKey = Boolean(result) && choice.label === result!.feedback.correct_label
            const isWrongPick = Boolean(result) && !result!.is_correct && choice.label === result!.feedback.selected_label
            const revealClass = isKey ? 'choice-correct' : isWrongPick ? 'choice-incorrect' : ''
            return (
              <label key={choice.label} className={`choice ${!result && selected === choice.label ? 'selected' : ''} ${revealClass}`}>
                <input type="radio" name="answer" value={choice.label} checked={selected === choice.label} onChange={() => setSelected(choice.label)} />
                <span className="choice-label">{choice.label}</span>
                <span>{choice.text}</span>
                {isKey && <Check className="choice-mark" size={18} aria-label="Correct answer" />}
                {isWrongPick && <X className="choice-mark" size={18} aria-label="Your answer" />}
              </label>
            )
          })}
        </fieldset>

        {item.requires_reasoning && !result && (
          <label className="reasoning-box">
            <span><Sparkles size={16} /> Detective's reasoning <em>Required for this file</em></span>
            <textarea value={reasoning} onChange={(event) => setReasoning(event.target.value)} maxLength={4000} placeholder="What is the conclusion, and why does your choice do the required logical work?" />
            <small className={reasoning.trim().length < 20 ? 'reasoning-min-warn' : ''}>
              {reasoning.trim().length < 20
                ? `Write at least 20 characters to file (${reasoning.trim().length}/20)`
                : `${reasoning.length}/4000 · Your text is stored as evidence, never as an instruction to the coaching system.`}
            </small>
          </label>
        )}

        {mutation.error && <ErrorNotice error={mutation.error} />}
        {!result && (
          <button className="primary-button submit-answer" disabled={!selected || mutation.isPending || (item.requires_reasoning && reasoning.trim().length < 20)} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Filing answer…' : <>File answer <ChevronRight size={18} /></>}
          </button>
        )}
        {!result && !mutation.isPending && (!selected || (item.requires_reasoning && reasoning.trim().length < 20)) && (
          <small className="file-hint">
            {!selected
              ? 'Select an answer choice to file.'
              : 'Add at least 20 characters of reasoning to file.'}
          </small>
        )}

        {result && (
          <div className="debrief-overlay" role="dialog" aria-modal="true" aria-label="Answer review">
          <div className={`debrief-modal ${result.is_correct ? 'correct' : 'incorrect'}`}>
            <header className="debrief-modal-head">
              <div className="result-icon">{result.is_correct ? <Check /> : <X />}</div>
              <div className="debrief-head-copy">
                <div className="eyebrow">DETERMINISTIC ANSWER CHECK</div>
                <h2>{result.feedback.headline}</h2>
                <p className="verified-line">
                  Verified answer <strong>{result.feedback.correct_label}</strong>
                  {!result.is_correct && <span className="your-pick"> · You chose {result.feedback.selected_label}</span>}
                </p>
              </div>
              <div className="result-meta-inline"><span>+{result.xp_earned} XP</span><span>{formatTime(result.elapsed_ms)}</span></div>
            </header>
            <div className="debrief-modal-body">
              <p className="debrief-diagnosis">{result.feedback.diagnosis}</p>
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
            </div>
            <footer className="debrief-modal-foot">
              <button className="primary-button" onClick={continueCase}>
                {result.session_complete ? 'Open session debrief' : 'Open next case'} <ChevronRight size={18} />
              </button>
            </footer>
          </div>
          </div>
        )}
      </section>
    </div>
  )
}
