import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Building2,
  Check,
  Clock3,
  Coins,
  Flame,
  LayoutGrid,
  LogOut,
  Map,
  Pause,
  Scale,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { api } from './api'
import type { AttemptReward, CoachingFeedback, GameResponse, GameState, StudySession, User } from './types'


export function formatMoney(value: number, compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
  }).format(value)
}


export function LoadingScreen({ label = 'Opening the firm…' }: { label?: string }) {
  return (
    <div className="loading-screen" role="status">
      <span className="legal-spinner"><Scale size={24} /></span>
      <span>{label}</span>
    </div>
  )
}


export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  return <div className="error-notice" role="alert">{message}</div>
}


export function Brand({ light = false, caseFile = false }: { light?: boolean; caseFile?: boolean }) {
  const contents = (
    <>
      <span className="brand-mark"><Scale size={19} /></span>
      <span className="brand-word"><strong>LAWYER</strong><small>{caseFile ? 'CASE FILE' : 'TYCOON'}</small></span>
    </>
  )
  if (caseFile) return <div className="brand case-brand" aria-label="Lawyer Tycoon active case">{contents}</div>
  return <Link className={`brand ${light ? 'light' : ''}`} to="/office" aria-label="Lawyer Tycoon office">{contents}</Link>
}


const navItems = [
  { to: '/office', label: 'Office', icon: Building2 },
  { to: '/cases', label: 'Do Cases', icon: BriefcaseBusiness },
  { to: '/firm', label: 'Firm', icon: LayoutGrid },
  { to: '/map', label: 'Empire', icon: Map },
]


export function AppShell({ user, game, children }: { user: User; game?: GameState | null; children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const isActiveCase = /^\/cases\/[^/]+/.test(location.pathname)
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })
  return (
    <div className={`app-shell ${isActiveCase ? 'active-case' : ''}`}>
      <header className="app-header">
        <Brand caseFile={isActiveCase} />
        {game && !isActiveCase && (
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>
                <Icon size={17} /><span>{label}</span>
              </NavLink>
            ))}
          </nav>
        )}
        <div className="header-right">
          {game && (
            <div className="header-economy" aria-label="Firm standing">
              <span><Coins size={16} />{formatMoney(game.cash, true)}</span>
              <span><Star size={16} />{game.reputation.toFixed(1)}</span>
              {game.current_streak > 0 && <span className="streak"><Flame size={16} />{game.current_streak}</span>}
            </div>
          )}
          <div className="account-menu">
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
              : <span className="avatar-fallback">{user.display_name.slice(0, 1).toUpperCase()}</span>}
            <span className="account-name">{game?.lawyer_name || user.display_name}</span>
            <button className="icon-button" onClick={() => logout.mutate()} aria-label="Sign out" title="Sign out">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>
      <main>{children}</main>
      {game && !isActiveCase && (
        <nav className="mobile-nav" aria-label="Primary navigation">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon size={20} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}


function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}


function CaseScore({ reward }: { reward: AttemptReward }) {
  const repPositive = reward.reputation_change >= 0
  return (
    <section className="case-score-card" role="status" aria-live="polite" aria-label="Case score and payout">
      <div className="score-seal">
        <span>CASE SCORE</span>
        <strong>{reward.score}</strong>
        <small>/ 20</small>
      </div>
      <div className="score-breakdown">
        <div><span>Verified answer</span><strong>+{reward.breakdown.answer}</strong></div>
        <div><span>{reward.explanation_grade} reasoning</span><strong>+{reward.breakdown.explanation}</strong></div>
        <div><span>Time · {Math.round(reward.timing.elapsed_seconds)}s / {reward.timing.target_seconds}s</span><strong>+{reward.breakdown.time}</strong></div>
      </div>
      <div className="settlement-total">
        <div><Coins /><span>Fee earned</span><strong>+{formatMoney(reward.payout)}</strong></div>
        <div className={repPositive ? 'positive' : 'negative'}>
          <Star /><span>Reputation</span><strong>{repPositive ? '+' : ''}{reward.reputation_change.toFixed(1)}</strong>
        </div>
      </div>
      {(reward.streak_bonus > 0 || reward.staff_bonus > 0 || reward.contract_bonus > 0) && (
        <div className="bonus-ribbon">
          <Sparkles size={16} />
          {[
            reward.streak_bonus > 0 && `Streak +${formatMoney(reward.streak_bonus)}`,
            reward.staff_bonus > 0 && `Staff +${formatMoney(reward.staff_bonus)}`,
            reward.contract_bonus > 0 && `Contract +${formatMoney(reward.contract_bonus)}`,
          ].filter(Boolean).join(' · ')}
        </div>
      )}
    </section>
  )
}


function CoachingPanel({ coaching, reward, selectedLabel }: { coaching: CoachingFeedback; reward?: AttemptReward | null; selectedLabel?: string }) {
  const correctLabel = coaching.answer_analysis.choice_explanations.find((choice) => choice.is_correct)?.label
  const selectedIsWrong = Boolean(selectedLabel && correctLabel && selectedLabel !== correctLabel)
  return (
    <section className="coaching-panel">
      <div className="coaching-heading">
        <div>
          <span className="eyebrow">CASE DEBRIEF</span>
          <h2>Your reasoning, reviewed</h2>
        </div>
        {reward && <span className={`grade-pill grade-${reward.explanation_grade.toLowerCase()}`}>{reward.explanation_grade}</span>}
      </div>

      <div className="debrief-grid">
        <article className="debrief-note strength">
          <span><Check size={15} /> What you understood</span>
          <p>{coaching.understood_correctly || coaching.reasoning_summary}</p>
        </article>
        <article className="debrief-note repair">
          <span><Brain size={15} /> Decisive improvement</span>
          <p>{coaching.first_error ? `${coaching.first_error.description} ${coaching.first_error.repair}` : coaching.next_step_hint}</p>
        </article>
      </div>

      <article className="solution-method">
        <span className="eyebrow">THE CLEAN APPROACH</span>
        <p>{coaching.solution_method || coaching.debrief}</p>
      </article>

      <div className="correct-explanation">
        <div><Check size={18} /></div>
        <div><strong>Why the credited answer wins</strong><p>{coaching.answer_analysis.correct_answer_explanation}</p></div>
      </div>
      {selectedIsWrong && (
        <div className="selected-explanation">
          <div><X size={18} /></div>
          <div><strong>Why your choice {selectedLabel} falls short</strong><p>{coaching.answer_analysis.selected_answer_explanation}</p></div>
        </div>
      )}
      <div className="choice-explanations">
        {coaching.answer_analysis.choice_explanations.map((choice) => (
          <details className={choice.is_correct ? 'choice-explanation correct' : 'choice-explanation'} key={choice.label} open={choice.is_correct}>
            <summary><span>{choice.label}</span><strong>{choice.is_correct ? 'Credited answer' : 'Why it falls short'}</strong></summary>
            <p>{choice.explanation}</p>
          </details>
        ))}
      </div>
      <div className="next-step"><Brain size={18} /><span><b>Next-case cue:</b> {coaching.next_step_hint}</span></div>
    </section>
  )
}


export function QuestionFlow({ session }: { session: StudySession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const item = session.pending_item || session.current_item
  const result = session.pending_result
  const [selected, setSelected] = useState(item?.draft.selected_label || '')
  const [reasoning, setReasoning] = useState(item?.draft.reasoning || '')
  const [clock, setClock] = useState(Date.now())
  const [openedAt, setOpenedAt] = useState(Date.now())
  const verdictRef = useRef<HTMLDivElement>(null)

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
    if (result) verdictRef.current?.focus()
  }, [result?.attempt_id])

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
      { item_id: item!.id, selected_label: selected, reasoning },
      crypto.randomUUID(),
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', session.id] }),
  })
  const continueCases = useMutation({
    mutationFn: () => api.acknowledgeReview(session.id),
    onSuccess: ({ session: nextSession }) => {
      void queryClient.invalidateQueries({ queryKey: ['game'] })
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      if (nextSession.id !== session.id) navigate(`/cases/${nextSession.id}`, { replace: true })
      else void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    },
  })
  const savedCoaching = result?.feedback.coaching
  const savedReward = result?.game_reward
  const coaching = useQuery({
    queryKey: ['coaching', result?.attempt_id],
    queryFn: () => api.coaching(result!.attempt_id),
    enabled: Boolean(result && (!savedCoaching || !savedReward)),
    retry: false,
  })
  const coachingFeedback = savedCoaching || coaching.data?.coaching
  const reward = savedReward || coaching.data?.reward

  useEffect(() => {
    if (!coaching.data?.game) return
    queryClient.setQueryData<GameResponse>(['game'], { game: coaching.data.game, pending_reviews: [] })
  }, [coaching.data?.game, queryClient])

  const elapsed = useMemo(() => {
    if (!item) return 0
    return item.elapsed_ms + (item.timer_active && !result ? Math.max(0, clock - openedAt) : 0)
  }, [clock, item, openedAt, result])

  if (!item) return <ErrorNotice error={new Error('This case file could not be loaded.')} />
  const question = item.question
  const timerRatio = elapsed / Math.max(1, item.target_time_seconds * 1000)

  return (
    <div className="question-layout">
      <div className="case-file-topbar">
        <div className="matter-tag">
          <span>{question.section === 'Logical Reasoning' ? 'LR' : 'RC'}</span>
          <div><small>ACTIVE MATTER</small><strong>{question.question_type}</strong></div>
        </div>
        <div className="question-progress">
          <strong>Docket {Math.min(item.position + 1, session.total_items)} / {session.total_items}</strong>
          {item.case_terms && <span>{item.case_terms.client_name} · {formatMoney(item.case_terms.base_fee)} base fee</span>}
        </div>
        <div className={`case-timer ${timerRatio > 1 ? 'over' : ''}`}>
          <Clock3 size={17} />
          <span>{formatTime(elapsed)}</span>
          <small>target {formatTime(item.target_time_seconds * 1000)}</small>
        </div>
      </div>
      <div className="progress-track"><span style={{ width: `${session.progress_percent}%` }} /></div>

      <div className={question.passage ? 'question-content with-passage' : 'question-content'}>
        {question.passage && (
          <article className="passage-card">
            <div className="document-heading"><BookOpen size={16} /><span>EXHIBIT A · READING PASSAGE</span></div>
            <div className="passage-text">{question.passage.text}</div>
          </article>
        )}

        <section className="answer-card">
          <div className="paperclip" aria-hidden="true" />
          {question.stimulus && <div className="stimulus">{question.stimulus}</div>}
          <span className="question-label">QUESTION PRESENTED</span>
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
              <div className="reasoning-heading">
                <label htmlFor="reasoning">Your case theory <b>Required</b></label>
                <span>{reasoning.trim().length} characters</span>
              </div>
              <textarea
                id="reasoning"
                value={reasoning}
                onChange={(event) => setReasoning(event.target.value)}
                placeholder="Identify the conclusion, decisive evidence or logical relationship, and why your choice answers the exact question…"
                rows={5}
                maxLength={4000}
              />
              <p>Substance beats length. Generic or repeated explanations receive no meaningful payout.</p>
            </div>
          )}

          {!result && (
            <div className="answer-actions">
              {submit.error && <ErrorNotice error={submit.error} />}
              <button className="primary-button verdict-button" disabled={!selected || !reasoning.trim() || submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? 'Filing your answer…' : <>Submit case <Scale size={18} /></>}
              </button>
            </div>
          )}

          {result && (
            <div ref={verdictRef} tabIndex={-1} role="status" aria-live="polite" className={result.is_correct ? 'result-banner correct' : 'result-banner incorrect'}>
              <div>{result.is_correct ? <Check /> : <X />}</div>
              <div>
                <span className="eyebrow">VERIFIED VERDICT</span>
                <strong>{result.is_correct ? 'Argument sustained' : 'Argument needs repair'}</strong>
                <p>{result.feedback.diagnosis}</p>
              </div>
            </div>
          )}

          {result && coaching.isLoading && (
            <div className="coaching-loading"><span className="spinner" /> Counsel is reviewing your reasoning and calculating the fee…</div>
          )}
          {result && coaching.error && (!coachingFeedback || !reward) && (
            <div className="coaching-error">
              <ErrorNotice error={coaching.error} />
              <button className="secondary-button" onClick={() => coaching.refetch()}>Retry case review</button>
            </div>
          )}
          {reward && <CaseScore reward={reward} />}
          {coachingFeedback && <CoachingPanel coaching={coachingFeedback} reward={reward} selectedLabel={result?.feedback.selected_label} />}

          {result && (
            <div className="continue-row">
              {continueCases.error && <ErrorNotice error={continueCases.error} />}
              <button
                className="primary-button next-case-button"
                disabled={!reward || continueCases.isPending || coaching.isLoading}
                onClick={() => continueCases.mutate()}
              >
                {!reward ? 'Settling fee…' : continueCases.isPending ? 'Opening file…' : <>Next case <ArrowRight size={18} /></>}
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
  const queryClient = useQueryClient()
  const pause = useMutation({
    mutationFn: () => api.pauseSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      navigate('/office')
    },
  })
  return (
    <button className="secondary-button compact" onClick={() => pause.mutate()} disabled={pause.isPending}>
      <Pause size={15} /> Save & return to office
    </button>
  )
}
