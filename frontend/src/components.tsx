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
import { ClientPortrait, JudgePortrait } from './game-art'
import { CasePageTurn } from './pixel-webgl'
import { caseJourneyStages, type CaseJourneyStageId } from './scene-workflow'
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
  const mainRef = useRef<HTMLElement>(null)
  const isActiveCase = /^\/cases\/[^/]+/.test(location.pathname)
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })
  useEffect(() => {
    const section = location.pathname.startsWith('/office') ? 'Office' : location.pathname.startsWith('/cases') ? 'Cases' : location.pathname.startsWith('/firm') ? 'Firm' : location.pathname.startsWith('/map') || location.pathname.startsWith('/world') ? 'Empire' : 'Lawyer Tycoon'
    document.title = `${section} · Lawyer Tycoon`
    window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }))
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])
  return (
    <div className={`app-shell ${isActiveCase ? 'active-case' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
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
              <span><Coins size={16} /><span className="sr-only">Cash: </span>{formatMoney(game.cash, true)}</span>
              <span><Star size={16} /><span className="sr-only">Reputation: </span>{game.reputation.toFixed(1)}</span>
              {game.current_streak > 0 && <span className="streak"><Flame size={16} /><span className="sr-only">Validated streak: </span>{game.current_streak}</span>}
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
      <main id="main-content" ref={mainRef} tabIndex={-1}>{children}</main>
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


function ClientSettlement({
  reward,
  clientName,
  clientKind,
  satisfied,
}: {
  reward: AttemptReward
  clientName: string
  clientKind?: string
  satisfied: boolean
}) {
  const repPositive = reward.reputation_change >= 0
  return (
    <section className={`client-settlement ${satisfied ? 'happy' : 'unhappy'}`} role="status" aria-live="polite">
      <div className="settlement-client">
        <ClientPortrait kind={clientKind} name={clientName} mood={satisfied ? 'happy' : 'unhappy'} />
        <div className="client-speech">
          <span>{satisfied ? 'CLIENT IMPRESSED' : 'CLIENT UNCONVINCED'}</span>
          <strong>{satisfied ? '“That’s the argument I hired you for!”' : '“We need a tighter argument next time.”'}</strong>
          <small>{clientName} closes the file and settles this matter.</small>
        </div>
      </div>
      <div className="reward-transfer" aria-label={`${formatMoney(reward.payout)} fee and ${reward.reputation_change.toFixed(1)} reputation`}>
        <div className="flying-coin coin-one">$</div>
        <div className="flying-coin coin-two">★</div>
        <div className="reward-packet fee-packet"><Coins /><span>Fee received</span><strong>+{formatMoney(reward.payout)}</strong></div>
        <div className={`reward-packet rep-packet ${repPositive ? 'positive' : 'negative'}`}>
          <Star /><span>Reputation</span><strong>{repPositive ? '+' : ''}{reward.reputation_change.toFixed(1)}</strong>
        </div>
      </div>
    </section>
  )
}


function CaseScore({ reward }: { reward: AttemptReward }) {
  const repPositive = reward.reputation_change >= 0
  return (
    <section className="case-score-card" aria-label="Case score and payout details">
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


function JudgeReview({
  isCorrect,
  diagnosis,
  coaching,
  reward,
  loading,
}: {
  isCorrect: boolean
  diagnosis: string
  coaching?: CoachingFeedback
  reward?: AttemptReward | null
  loading: boolean
}) {
  const strongReasoning = reward?.explanation_grade === 'Good' || reward?.explanation_grade === 'Excellent'
  const title = coaching
    ? strongReasoning ? 'The logic holds up under questioning.' : 'Here is where the argument turns.'
    : isCorrect ? 'The verified answer is sustained.' : 'The verified answer overrules your choice.'
  const message = coaching?.reasoning_summary || diagnosis
  return (
    <section className="judge-review" role="status" aria-live="polite">
      <div className="judge-bench">
        <div className="bench-nameplate"><span>AI</span> THE HON. LOGICA</div>
        <JudgePortrait thinking={loading} pleased={Boolean(coaching && isCorrect && strongReasoning)} />
      </div>
      <div className="judge-speech">
        <div className="judge-status-row">
          <span className={isCorrect ? 'verified-correct' : 'verified-incorrect'}>{isCorrect ? <Check /> : <X />} VERIFIED ANSWER</span>
          {reward && <span className={`grade-pill grade-${reward.explanation_grade.toLowerCase()}`}>{reward.explanation_grade} REASONING</span>}
        </div>
        <h2>{title}</h2>
        <p>{message}</p>
        {loading && <div className="judge-thinking"><i /><i /><i /> Reviewing your case theory…</div>}
        <small>The answer key decides correctness. The judge coaches your explanation.</small>
      </div>
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
          <span className="eyebrow">THE JUDGE’S BENCH NOTES</span>
          <h2>Three things to carry into the next case</h2>
        </div>
        {reward && <span className={`grade-pill grade-${reward.explanation_grade.toLowerCase()}`}>{reward.explanation_grade}</span>}
      </div>

      <div className="debrief-roadmap">
        <article className="debrief-step strength">
          <b>1</b>
          <div><span><Check size={15} /> KEEP THIS</span>
          <p>{coaching.understood_correctly || coaching.reasoning_summary}</p>
          </div>
        </article>
        <article className="debrief-step repair">
          <b>2</b>
          <div><span><Brain size={15} /> FIX THIS FIRST</span>
          <p>{coaching.first_error ? `${coaching.first_error.description} ${coaching.first_error.repair}` : coaching.next_step_hint}</p>
          </div>
        </article>
        <article className="debrief-step method">
          <b>3</b>
          <div><span><Scale size={15} /> CLEAN APPROACH</span>
          <p>{coaching.solution_method || coaching.debrief}</p>
          </div>
        </article>
      </div>

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
      <div className="choice-audit-heading"><span>FULL ANSWER AUDIT</span><small>Open any choice to see the judge’s reasoning.</small></div>
      <div className="choice-explanations">
        {coaching.answer_analysis.choice_explanations.map((choice) => (
          <details className={choice.is_correct ? 'choice-explanation correct' : 'choice-explanation'} key={choice.label} open={choice.is_correct}>
            <summary><span>{choice.label}</span><strong>{choice.is_correct ? 'Credited answer' : 'Why it falls short'}</strong></summary>
            <p>{choice.explanation}</p>
          </details>
        ))}
      </div>
      <div className="next-step"><Brain size={18} /><span><b>Your one-line rule for the next case:</b> {coaching.next_step_hint}</span></div>
    </section>
  )
}


export function CaseJourneyRail({ current }: { current: CaseJourneyStageId }) {
  const currentIndex = caseJourneyStages.findIndex((stage) => stage.id === current)
  return (
    <nav className="case-journey-rail" aria-label="Case journey through game rooms">
      <div><span>REPEATABLE CASE LOOP</span><strong>Every case moves through the firm.</strong></div>
      <ol>
        {caseJourneyStages.map((stage, index) => (
          <li className={index === currentIndex ? 'active' : index < currentIndex ? 'complete' : ''} key={stage.id}>
            <Link to={`/world/${stage.slug}`} title={stage.detail} aria-current={index === currentIndex ? 'step' : undefined}>
              <b>{String(index + 1).padStart(2, '0')}</b><span><small>{stage.label}</small><strong>{stage.room}</strong></span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}


export function QuestionFlow({ session }: { session: StudySession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const gameQuery = useQuery({ queryKey: ['game'], queryFn: api.game })
  const item = session.pending_item || session.current_item
  const result = session.pending_result
  const [selected, setSelected] = useState(item?.draft.selected_label || '')
  const [reasoning, setReasoning] = useState(item?.draft.reasoning || '')
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [clock, setClock] = useState(Date.now())
  const [openedAt, setOpenedAt] = useState(Date.now())
  const [casePage, setCasePage] = useState<'evidence' | 'argument' | 'verdict'>(result ? 'verdict' : 'evidence')
  const [pageTurn, setPageTurn] = useState<{ key: number; direction: 1 | -1 } | null>(null)
  const pageTurnTimers = useRef<number[]>([])
  const verdictRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelected(item?.draft.selected_label || '')
    setReasoning(item?.draft.reasoning || '')
    setDraftState(item?.draft.updated_at ? 'saved' : 'idle')
    setOpenedAt(Date.now())
    setCasePage(result ? 'verdict' : 'evidence')
    setPageTurn(null)
  }, [item?.id])

  useEffect(() => {
    if (!item?.timer_active || result) return
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [item?.timer_active, result])

  useEffect(() => {
    if (result && casePage === 'verdict') verdictRef.current?.focus()
  }, [casePage, result?.attempt_id])

  useEffect(() => () => pageTurnTimers.current.forEach((timer) => window.clearTimeout(timer)), [])

  const turnToPage = (next: 'evidence' | 'argument' | 'verdict') => {
    if (next === casePage || (next === 'verdict' && !result)) return
    pageTurnTimers.current.forEach((timer) => window.clearTimeout(timer))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCasePage(next)
      setPageTurn(null)
      return
    }
    const order = ['evidence', 'argument', 'verdict']
    const direction = order.indexOf(next) > order.indexOf(casePage) ? 1 : -1
    setPageTurn({ key: Date.now(), direction })
    pageTurnTimers.current = [
      window.setTimeout(() => setCasePage(next), 305),
      window.setTimeout(() => setPageTurn(null), 660),
    ]
  }

  useEffect(() => {
    if (result && casePage !== 'verdict') turnToPage('verdict')
    // The attempt id is the authoritative transition into the verdict page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.attempt_id])

  useEffect(() => {
    if (!item || result) return
    let cancelled = false
    setDraftState('saving')
    const timeout = window.setTimeout(async () => {
      try {
        await api.saveDraft(session.id, item.id, { selected_label: selected || undefined, reasoning })
        if (!cancelled) setDraftState('saved')
      } catch {
        if (!cancelled) setDraftState('error')
      }
    }, 700)
    return () => { cancelled = true; window.clearTimeout(timeout) }
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
  useEffect(() => {
    if (result || !item) return
    const chooseWithKeyboard = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      const choice = item.question.choices.find((candidate) => candidate.label === event.key.toUpperCase())
      if (!choice) return
      event.preventDefault()
      setSelected(choice.label)
    }
    window.addEventListener('keydown', chooseWithKeyboard)
    return () => window.removeEventListener('keydown', chooseWithKeyboard)
  }, [item, result])
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
  const caseClient = gameQuery.data?.game?.catalog.clients.find((client) => client.key === item.case_terms?.client_key)
  const clientName = item.case_terms?.client_name || caseClient?.name || 'Walk-in Client'
  const clientKind = caseClient?.icon
  const clientSatisfied = Boolean(result?.is_correct && reward && ['Good', 'Excellent'].includes(reward.explanation_grade))
  const addReasoningPrompt = (prompt: string) => {
    if (reasoning.includes(prompt)) return
    setReasoning((current) => `${current.trim()}${current.trim() ? '\n' : ''}${prompt} `)
  }

  return (
    <div className="question-layout">
      <section className="active-matter-banner" aria-label={`Current case for ${clientName}`}>
        <ClientPortrait kind={clientKind} name={clientName} />
        <div className="active-matter-copy">
          <span>YOU ARE REPRESENTING</span>
          <strong>{clientName}</strong>
          <small>This client is locked to this open case, even if you change contracts later.</small>
        </div>
        <div className="active-matter-fee"><span>POTENTIAL BASE FEE</span><strong>{formatMoney(item.case_terms?.base_fee || 0)}</strong><small>Answer + reasoning + speed set the final fee</small></div>
      </section>
      <CaseJourneyRail current={result ? 'counsel' : 'workspace'} />
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

      <section className="case-file-stage" aria-label="Interactive case file">
        {pageTurn && <CasePageTurn turnKey={pageTurn.key} direction={pageTurn.direction} />}
        <nav className="case-page-tabs" aria-label="Case file pages">
          <button type="button" className={casePage === 'evidence' ? 'active' : ''} aria-pressed={casePage === 'evidence'} onClick={() => turnToPage('evidence')}><b>01</b><span>Evidence<small>Read the record</small></span></button>
          <button type="button" className={casePage === 'argument' ? 'active' : ''} aria-pressed={casePage === 'argument'} onClick={() => turnToPage('argument')}><b>02</b><span>Argument<small>Choose and explain</small></span></button>
          <button type="button" disabled={!result} className={casePage === 'verdict' ? 'active' : ''} aria-pressed={casePage === 'verdict'} onClick={() => turnToPage('verdict')}><b>03</b><span>Verdict<small>{result ? 'Review and repair' : 'Filed after submission'}</small></span></button>
        </nav>

        {casePage === 'evidence' && (
          <div className={`case-page-sheet question-content ${question.passage ? 'with-passage' : ''}`}>
            {question.passage && (
              <article className="passage-card">
                <div className="document-heading"><BookOpen size={16} /><span>EXHIBIT A · READING PASSAGE</span></div>
                <div className="passage-text">{question.passage.text}</div>
              </article>
            )}
            <section className="answer-card evidence-page">
              <div className="paperclip" aria-hidden="true" />
              {question.stimulus && <><div className="document-heading"><BookOpen size={16} /><span>EXHIBIT A · RECORD</span></div><div className="stimulus">{question.stimulus}</div></>}
              <span className="question-label">QUESTION PRESENTED</span>
              <h1>{question.stem}</h1>
              <div className="evidence-checklist"><span><Check size={15} />Identify the exact task</span><span><Check size={15} />Locate decisive evidence</span><span><Check size={15} />Predict before comparing</span></div>
              <button type="button" className="primary-button case-page-next" onClick={() => turnToPage(result ? 'verdict' : 'argument')}>{result ? 'Return to verdict' : 'Build your argument'} <ArrowRight size={18} /></button>
            </section>
          </div>
        )}

        {casePage === 'argument' && (
          <div className="case-page-sheet argument-sheet">
            <section className="answer-card argument-page">
              <div className="argument-reference"><span>QUESTION PRESENTED</span><strong>{question.stem}</strong><button type="button" onClick={() => turnToPage('evidence')}><BookOpen size={15} />REOPEN EVIDENCE</button></div>
              <div className="choices" role="radiogroup" aria-label="Answer choices">
                {question.choices.map((choice) => {
                  const chosen = (result?.feedback.selected_label || selected) === choice.label
                  const correct = result?.feedback.correct_label === choice.label
                  const wrongSelected = Boolean(result && chosen && !correct)
                  return (
                    <button type="button" role="radio" aria-checked={chosen} disabled={Boolean(result)} className={`choice ${chosen ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrongSelected ? 'incorrect' : ''}`} key={choice.label} onClick={() => setSelected(choice.label)}>
                      <span className="choice-label">{choice.label}</span><span>{choice.text}</span>
                      {correct && <Check className="choice-status" size={18} />}{wrongSelected && <X className="choice-status" size={18} />}
                    </button>
                  )
                })}
              </div>

              {!result && (
                <div className="reasoning-box">
                  <div className="reasoning-heading"><label htmlFor="reasoning">Your case theory <b>Required</b></label><span className={`draft-status ${draftState}`} role="status">{draftState === 'saving' ? 'Saving…' : draftState === 'saved' ? 'Draft saved' : draftState === 'error' ? 'Save failed' : `${reasoning.trim().length} characters`}</span></div>
                  <div className="reasoning-prompts" aria-label="Reasoning scaffold">
                    {['Task / conclusion:', 'Decisive evidence:', 'Why the closest rival fails:', 'Therefore:'].map((prompt, index) => <button type="button" onClick={() => addReasoningPrompt(prompt)} key={prompt}><b>{index + 1}</b>{prompt}</button>)}
                  </div>
                  <textarea id="reasoning" value={reasoning} onChange={(event) => setReasoning(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && selected && reasoning.trim() && !submit.isPending) { event.preventDefault(); submit.mutate() } }} placeholder="Use the scaffold above to identify the task, decisive evidence, and why the closest alternative fails…" rows={7} maxLength={4000} />
                  <p>Substance beats length. Generic or repeated explanations receive no meaningful payout.</p>
                </div>
              )}
              {!result && <div className="answer-actions">{submit.error && <ErrorNotice error={submit.error} />}<button className="primary-button verdict-button" disabled={!selected || !reasoning.trim() || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? 'Filing your answer…' : <>File for verdict <Scale size={18} /></>}</button><small className="keyboard-hint">A–E selects · ⌘/Ctrl + Enter files</small></div>}
              {result && <button type="button" className="primary-button case-page-next" onClick={() => turnToPage('verdict')}>Open filed verdict <ArrowRight size={18} /></button>}
            </section>
          </div>
        )}

        {casePage === 'verdict' && result && (
          <div className="case-page-sheet verdict-sheet">
            <section className="answer-card verdict-page">
              <div ref={verdictRef} tabIndex={-1} className="judge-review-focus"><JudgeReview isCorrect={result.is_correct} diagnosis={result.feedback.diagnosis} coaching={coachingFeedback} reward={reward} loading={coaching.isLoading} /></div>
              {coaching.error && (!coachingFeedback || !reward) && <div className="coaching-error"><ErrorNotice error={coaching.error} /><button className="secondary-button" onClick={() => coaching.refetch()}>Retry case review</button></div>}
              {coachingFeedback && <CoachingPanel coaching={coachingFeedback} reward={reward} selectedLabel={result.feedback.selected_label} />}
              {reward && <><ClientSettlement reward={reward} clientName={clientName} clientKind={clientKind} satisfied={clientSatisfied} /><CaseScore reward={reward} /></>}
              <div className="continue-row">{continueCases.error && <ErrorNotice error={continueCases.error} />}<button className="primary-button next-case-button" disabled={!reward || continueCases.isPending || coaching.isLoading} onClick={() => continueCases.mutate()}>{!reward ? 'Settling fee…' : continueCases.isPending ? 'Closing file…' : session.status === 'completed' ? <>Review docket results <ArrowRight size={18} /></> : <>Turn to next case <ArrowRight size={18} /></>}</button></div>
            </section>
          </div>
        )}
      </section>
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
