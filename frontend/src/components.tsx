import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
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
  HelpCircle,
  LayoutGrid,
  LogOut,
  Map,
  Pause,
  Scale,
  Sparkles,
  Star,
  Target,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { api } from './api'
import { ClientPortrait, JudgePortrait } from './game-art'
import { Bust } from './art/people'
import { counselArt, counselFor, eventArt, keyHash } from './art/assets'
import { SoundControls, useSound, useSoundProfile } from './sound'
import { GuidedTour, replayGuidedTour } from './guided-tour'
import type { AttemptReward, CoachingFeedback, GameResponse, GameState, StoryQuest, StudySession, User } from './types'


function useCountUp(target: number, duration = 950) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}


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
      <span className="brand-word"><strong>LAWYER</strong><small>{caseFile ? 'CASE FILE' : 'SPEEDRUN'}</small></span>
    </>
  )
  if (caseFile) return <div className="brand case-brand" aria-label="Lawyer Tycoon active case">{contents}</div>
  return <Link className={`brand ${light ? 'light' : ''}`} to="/progress" aria-label="LSAT Speedrun training lab" data-sound="navigate" data-sound-seed="progress">{contents}</Link>
}


const navItems = [
  { to: '/progress', label: 'Training', icon: Brain },
  { to: '/cases', label: 'Practice', icon: BriefcaseBusiness },
  { to: '/office', label: 'Office', icon: Building2 },
  { to: '/firm', label: 'Firm', icon: LayoutGrid },
  { to: '/map', label: 'World', icon: Map },
]


export function AppShell({ user, game, children }: { user: User; game?: GameState | null; children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { play } = useSound()
  useSoundProfile({
    seed: `${user.id}:${game?.id ?? 'profile'}`,
    officeTier: game?.office_tier ?? 0,
    alignment: game?.story.alignment ?? 'Pragmatic',
  })
  const isActiveCase = /^\/cases\/[^/]+/.test(location.pathname)
  const playDataSound = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return
    const target = event.target.closest<HTMLElement>('[data-sound="navigate"]')
    if (!target || !event.currentTarget.contains(target)) return
    void play('navigate', {
      seed: target.dataset.soundSeed || target.getAttribute('href') || location.pathname,
      intensity: .42,
    })
  }
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })
  return (
    <div className={`app-shell ${isActiveCase ? 'active-case' : ''}`} onClick={playDataSound}>
      <header className="app-header">
        <Brand caseFile={isActiveCase} />
        {game && !isActiveCase && (
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''} data-sound="navigate" data-sound-seed={to} data-tour={`nav-${to.slice(1)}`}>
                <Icon size={17} /><span>{label}</span>
              </NavLink>
            ))}
          </nav>
        )}
        <div className="header-right">
          <div data-tour="sound"><SoundControls className="header-sound-controls" compact /></div>
          {game && (
            <div className="header-economy training-standing" aria-label="Training standing" data-tour="standing">
              <span><Check size={16} />{game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0}%</span>
              <span><Brain size={16} />{game.total_cases} Q</span>
            </div>
          )}
          {game && !isActiveCase && (
            <button className="icon-button tour-replay-button" type="button" onClick={replayGuidedTour} aria-label="Replay guided tour" title="Replay guided tour">
              <HelpCircle size={18} />
            </button>
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
            <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''} data-sound="navigate" data-sound-seed={to} data-tour={`nav-${to.slice(1)}`}>
              <Icon size={20} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
      {game && !isActiveCase && <GuidedTour />}
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
  const shownPayout = useCountUp(reward.payout)
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
        <div className="reward-packet fee-packet">
          <Coins /><span>Fee received</span><strong>+{formatMoney(shownPayout)}</strong>
          {reward.payout > 0 && (
            <span className="coin-burst" aria-hidden="true">
              {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
            </span>
          )}
        </div>
        <div className={`reward-packet rep-packet ${repPositive ? 'positive' : 'negative'}`}>
          <Star /><span>Reputation</span><strong>{repPositive ? '+' : ''}{reward.reputation_change.toFixed(1)}</strong>
        </div>
      </div>
    </section>
  )
}


const COUNSEL_LOSS_LINES = [
  '“Objection sustained.”',
  '“The record speaks for itself.”',
  '“Motion to strike that theory — granted.”',
  '“Is that the whole argument?”',
]
const COUNSEL_WIN_LINES = [
  '“…no further questions.”',
  '“Objection withdrawn.”',
  '“We will… review our position.”',
  '“Noted. Regrettably.”',
]


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
      {(reward.streak_bonus > 0 || reward.staff_bonus > 0 || reward.contract_bonus > 0 || reward.quest_bonus > 0) && (
        <div className="bonus-ribbon">
          <Sparkles size={16} />
          {[
            reward.streak_bonus > 0 && `Streak +${formatMoney(reward.streak_bonus)}`,
            reward.staff_bonus > 0 && `Staff +${formatMoney(reward.staff_bonus)}`,
            reward.contract_bonus > 0 && `Contract +${formatMoney(reward.contract_bonus)}`,
            reward.quest_bonus > 0 && `Caseboard +${formatMoney(reward.quest_bonus)}`,
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

function CompactReasoningPanel({ coaching, selectedLabel }: { coaching: CoachingFeedback; selectedLabel?: string }) {
  const selectedIsWrong = coaching.answer_analysis.choice_explanations.some(
    (choice) => choice.label === selectedLabel && !choice.is_correct,
  )
  return (
    <section className="compact-reasoning" aria-label="Concise answer reasoning">
      <div className="compact-reasoning-head"><Brain size={17} /><div><span>WHY THE CREDITED ANSWER WINS</span><strong>{coaching.answer_analysis.correct_answer_explanation}</strong></div></div>
      {selectedIsWrong && <p><b>Why your choice falls short:</b> {coaching.answer_analysis.selected_answer_explanation}</p>}
      <div className="compact-reasoning-rule"><Scale size={15} /><span>{coaching.next_step_hint}</span></div>
      <details><summary>Audit all five choices</summary><div>{coaching.answer_analysis.choice_explanations.map((choice) => <p key={choice.label}><b>{choice.label}</b> {choice.explanation}</p>)}</div></details>
    </section>
  )
}


export function QuestionFlow({ session }: { session: StudySession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { play } = useSound()
  const gameQuery = useQuery({ queryKey: ['game'], queryFn: api.game })
  const item = session.pending_item || session.current_item
  const result = session.pending_result
  const isDiagnostic = session.mode === 'diagnostic'
  const requiresReasoning = Boolean(item?.requires_reasoning)
  const isInfinite = session.practice_style === 'infinite'
  const compactReview = session.practice_style !== 'deep'
  const learningOnly = session.practice_style !== 'deep'
  const [selected, setSelected] = useState(item?.draft.selected_label || '')
  const [reasoning, setReasoning] = useState(item?.draft.reasoning || '')
  const [confidence, setConfidence] = useState(3)
  const [answerChanged, setAnswerChanged] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const [openedAt, setOpenedAt] = useState(Date.now())
  const verdictRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelected(item?.draft.selected_label || '')
    setReasoning(item?.draft.reasoning || '')
    setConfidence(3)
    setAnswerChanged(false)
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
      { item_id: item!.id, selected_label: selected, reasoning, confidence, answer_changed: answerChanged },
      crypto.randomUUID(),
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', session.id] }),
  })
  const finishInfinite = useMutation({
    mutationFn: () => api.finishSession(session.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['performance'] })
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
      navigate(`/cases/${session.id}`, { replace: true })
    },
  })
  const continueCases = useMutation({
    mutationFn: () => api.acknowledgeReview(session.id),
    onSuccess: ({ session: nextSession }) => {
      if (isDiagnostic && nextSession.status === 'completed') {
        void queryClient.invalidateQueries({ queryKey: ['performance'] })
        void queryClient.invalidateQueries({ queryKey: ['diagnostic'] })
        void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
        navigate(`/cases/${session.id}`, { replace: true })
        return
      }
      if (nextSession.status === 'completed') {
        void queryClient.invalidateQueries({ queryKey: ['performance'] })
        void queryClient.invalidateQueries({ queryKey: ['current-session'] })
        void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
        navigate(`/cases/${session.id}`, { replace: true })
        return
      }
      void play('file-open', {
        id: `next-file:${nextSession.id}:${nextSession.current_index}`,
        seed: `${nextSession.id}:${nextSession.current_index}`,
        intensity: .58,
      })
      void queryClient.invalidateQueries({ queryKey: ['game'] })
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      if (nextSession.id !== session.id) navigate(`/cases/${nextSession.id}`, { replace: true })
      else void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    },
  })
  const savedCoaching = result?.feedback?.coaching
  const savedReward = result?.game_reward
  const coaching = useQuery({
    queryKey: ['coaching', result?.attempt_id],
    queryFn: () => api.coaching(result!.attempt_id),
    enabled: Boolean(result?.feedback_released && (!savedCoaching || (session.practice_style === 'deep' && !savedReward))),
    retry: false,
  })
  const coachingFeedback = savedCoaching || coaching.data?.coaching
  const reward = savedReward || coaching.data?.reward
  const coachingReady = Boolean(coachingFeedback)

  useEffect(() => {
    if (!result) return
    void play(result.is_correct ? 'verdict-correct' : 'verdict-repair', {
      id: `verdict:${result.attempt_id}`,
      seed: result.attempt_id,
      intensity: .9,
    })
  }, [play, result?.attempt_id, result?.is_correct])

  useEffect(() => {
    if (!result || !reward || !coachingReady) return
    const timers: number[] = []
    const reasoningValidated = result.is_correct && (reward.explanation_grade === 'Good' || reward.explanation_grade === 'Excellent')
    const hasBonus = reward.streak_bonus > 0 || reward.staff_bonus > 0 || reward.contract_bonus > 0 || reward.quest_bonus > 0
    const hasPayout = reward.payout > 0
    const ledgerDelay = reasoningValidated ? 1100 : 620

    if (reasoningValidated) {
      timers.push(window.setTimeout(() => {
        void play('reasoning-validated', {
          id: `reasoning:${reward.id}`,
          seed: reward.id,
          intensity: .68,
        })
      }, 420))
    }
    if (hasPayout) {
      timers.push(window.setTimeout(() => {
        void play('ledger', {
          id: `ledger:${reward.id}`,
          seed: reward.id,
          intensity: .48,
        })
      }, ledgerDelay))
      if (hasBonus) {
        timers.push(window.setTimeout(() => {
          void play('bonus', {
            id: `bonus:${reward.id}`,
            seed: reward.id,
            intensity: .58,
          })
        }, ledgerDelay + 320))
      }
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [
    play,
    coachingReady,
    result?.attempt_id,
    result?.is_correct,
    reward?.contract_bonus,
    reward?.explanation_grade,
    reward?.id,
    reward?.payout,
    reward?.quest_bonus,
    reward?.staff_bonus,
    reward?.streak_bonus,
  ])

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

  const counsel = counselFor(session.id)
  const counselRattled = Boolean(result?.is_correct)
  const counselLine = result
    ? (result.is_correct ? COUNSEL_WIN_LINES : COUNSEL_LOSS_LINES)[keyHash(result.attempt_id) % COUNSEL_WIN_LINES.length]
    : null

  return (
    <div className="question-layout">
      {isDiagnostic ? (
        <section className="diagnostic-session-banner" aria-label="Baseline diagnostic in progress">
          <div><Target size={22} /><span>BASELINE DIAGNOSTIC</span></div>
          <strong>Neutral measurement mode</strong>
          <p>No currency, reputation, streak, or firm progress changes during this run.</p>
          <small>{session.total_items} balanced LR/RC questions</small>
        </section>
      ) : learningOnly ? (
        <section className="learning-mode-banner" aria-label={`${session.practice_style} learning mode`}>
          <div><Brain size={20} /><span>{isInfinite ? 'INFINITE PRACTICE' : session.practice_style === 'review' ? 'REPAIR REVIEW' : 'TIMED SPRINT'}</span></div>
          <strong>{isInfinite ? 'Answer → concise reasoning → continue' : session.practice_style === 'review' ? 'Explain only the questions that need repair' : 'Answer-only · explanations unlock when the run ends'}</strong>
          {isInfinite && <button type="button" onClick={() => finishInfinite.mutate()} disabled={finishInfinite.isPending || Boolean(result)}>{finishInfinite.isPending ? 'Ending…' : 'End run'}</button>}
        </section>
      ) : <section className="active-matter-banner" aria-label={`Current case for ${clientName}`}>
        <ClientPortrait kind={clientKind} name={clientName} />
        <div className="active-matter-copy">
          <span>YOU ARE REPRESENTING</span>
          <strong>{clientName}</strong>
          <small>This client is locked to this open case, even if you change contracts later.</small>
        </div>
        <div className="active-matter-fee"><span>POTENTIAL BASE FEE</span><strong>{formatMoney(item.case_terms?.base_fee || 0)}</strong><small>Answer + reasoning + speed set the final fee</small></div>
        <div className={`opposing-counsel ${result ? (counselRattled ? 'is-rattled' : 'is-smug') : ''}`}>
          <div className="counsel-portrait">
            <Bust src={counselArt(counsel.key, counselRattled)} backdrop="#33202b" label={`Opposing counsel ${counsel.name}`} />
          </div>
          <div className="counsel-copy">
            <span>OPPOSING COUNSEL</span>
            <strong>{counsel.name}</strong>
            <small>{counsel.firm}</small>
          </div>
          {counselLine && <div className="counsel-bubble" key={result?.attempt_id}>{counselLine}</div>}
        </div>
      </section>}
      <div className="case-file-topbar">
        <div className="matter-tag">
          <span>{question.section === 'Logical Reasoning' ? 'LR' : 'RC'}</span>
          <div><small>{learningOnly ? 'QUESTION TYPE' : 'ACTIVE MATTER'}</small><strong>{question.question_type}</strong></div>
        </div>
        <div className="question-progress">
          <strong>{isDiagnostic ? 'Diagnostic' : isInfinite ? 'Infinite' : session.practice_style === 'review' ? 'Review' : 'Sprint'} {Math.min(item.position + 1, session.total_items)}{isInfinite ? '' : ` / ${session.total_items}`}</strong>
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

        <section className={`answer-card ${result ? (result.is_correct ? 'case-won' : 'case-lost') : ''}`}>
          <div className="paperclip" aria-hidden="true" />
          {question.stimulus && <div className="stimulus">{question.stimulus}</div>}
          <span className="question-label">QUESTION PRESENTED</span>
          <h1>{question.stem}</h1>
          <div className="choices" role="radiogroup" aria-label="Answer choices">
            {question.choices.map((choice) => {
              const chosen = (result?.feedback?.selected_label || selected) === choice.label
              const correct = result?.feedback?.correct_label === choice.label
              const wrongSelected = Boolean(result && chosen && !correct)
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={Boolean(result)}
                  className={`choice ${chosen ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrongSelected ? 'incorrect' : ''}`}
                  key={choice.label}
                  onClick={() => {
                    if (selected !== choice.label) void play('select', { seed: `${item.id}:${choice.label}`, intensity: .36 })
                    if (selected && selected !== choice.label) setAnswerChanged(true)
                    setSelected(choice.label)
                  }}
                >
                  <span className="choice-label">{choice.label}</span>
                  <span>{choice.text}</span>
                  {correct && <Check className="choice-status" size={18} />}
                  {wrongSelected && <X className="choice-status" size={18} />}
                </button>
              )
            })}
          </div>

          {!result && requiresReasoning && (
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
            <div className="confidence-check" aria-label="Answer confidence">
              <span>Confidence</span>
              <div>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={confidence === value ? 'active' : ''} onClick={() => setConfidence(value)} aria-pressed={confidence === value}>{value}</button>)}</div>
              <small>{confidence <= 2 ? 'Unsure' : confidence >= 4 ? 'Confident' : 'Moderate'}</small>
            </div>
          )}

          {!result && (
            <div className="answer-actions">
              {submit.error && <ErrorNotice error={submit.error} />}
              <button className="primary-button verdict-button" disabled={!selected || (requiresReasoning && !reasoning.trim()) || submit.isPending} onClick={() => {
                void play('submit', { seed: item.id, intensity: .68 })
                submit.mutate()
              }}>
                {submit.isPending ? 'Recording answer…' : <>{requiresReasoning ? 'Submit reasoning' : session.feedback_policy === 'delayed' ? 'Lock answer' : 'Check answer'} <Scale size={18} /></>}
              </button>
            </div>
          )}

          {result?.feedback && (
            <div ref={verdictRef} tabIndex={-1} className="judge-review-focus">
              <div className={`verdict-stamp ${result.is_correct ? 'stamp-won' : 'stamp-lost'}`} key={result.attempt_id} aria-hidden="true">
                <span>{result.is_correct ? 'SUSTAINED' : 'OVERRULED'}</span>
              </div>
              <JudgeReview
                isCorrect={Boolean(result.is_correct)}
                diagnosis={result.feedback.diagnosis}
                coaching={coachingFeedback}
                reward={reward}
                loading={coaching.isLoading}
              />
            </div>
          )}
          {result && coaching.error && (!coachingFeedback || !reward) && (
            <div className="coaching-error">
              <ErrorNotice error={coaching.error} />
              <button className="secondary-button" onClick={() => coaching.refetch()}>Retry case review</button>
            </div>
          )}
          {coachingFeedback && (compactReview
            ? <CompactReasoningPanel coaching={coachingFeedback} selectedLabel={result?.feedback?.selected_label} />
            : <CoachingPanel coaching={coachingFeedback} reward={reward} selectedLabel={result?.feedback?.selected_label} />)}
          {reward && (
            <>
              <ClientSettlement reward={reward} clientName={clientName} clientKind={clientKind} satisfied={clientSatisfied} />
              <CaseScore reward={reward} />
            </>
          )}

          {result && (
            <div className="continue-row">
              {continueCases.error && <ErrorNotice error={continueCases.error} />}
              <button
                className="primary-button next-case-button"
                disabled={!coachingReady || (session.practice_style === 'deep' && !reward) || continueCases.isPending || coaching.isLoading}
                onClick={() => continueCases.mutate()}
              >
                {!coachingReady ? 'Preparing concise reasoning…' : continueCases.isPending ? 'Opening next item…' : isInfinite ? <>Next question <ArrowRight size={18} /></> : session.practice_style === 'review' ? <>Continue review <ArrowRight size={18} /></> : <>Next case <ArrowRight size={18} /></>}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}


/* ------------------------------------------------------ office events */

const EVENT_GLOBAL_COOLDOWN_MS = 5 * 60_000
const EVENT_DECLINE_COOLDOWN_MS = 30 * 60_000

const EVENT_CATEGORY_LABEL: Record<StoryQuest['category'], string> = {
  pro_bono: 'A CAUSE WORTH TAKING',
  investigation: 'AN INVESTIGATION OPENS',
  shadow: 'A SHADOW OFFER',
  legacy: 'A LEGACY MATTER',
}

export function OfficeEventPopup({ game }: { game: GameState }) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const [dismissed, setDismissed] = useState(false)
  const [visible, setVisible] = useState(false)

  const quest = useMemo(() => {
    if (game.story.active_quest || game.story.pending_chapter) return null
    const now = Date.now()
    if (now - Number(localStorage.getItem('lt-event-last') || 0) < EVENT_GLOBAL_COOLDOWN_MS) return null
    const options = game.story.quests.filter((entry) =>
      entry.available && !entry.active && !entry.completed
      && now - Number(localStorage.getItem(`lt-event-declined-${entry.key}`) || 0) > EVENT_DECLINE_COOLDOWN_MS)
    if (!options.length) return null
    return options[keyHash(game.id) % options.length]
  }, [game])

  useEffect(() => {
    if (!quest) return
    const timeout = window.setTimeout(() => setVisible(true), 1400)
    return () => window.clearTimeout(timeout)
  }, [quest])

  const accept = useMutation({
    mutationFn: () => api.startQuest(quest!.key),
    onSuccess: ({ game: nextGame }) => {
      void play('event', {
        id: `office-event-accepted:${nextGame.id}:${quest!.key}`,
        seed: quest!.key,
        intensity: .6,
      })
      localStorage.setItem('lt-event-last', String(Date.now()))
      queryClient.setQueryData<GameResponse>(['game'], { game: nextGame, pending_reviews: [] })
      setDismissed(true)
    },
  })

  if (!quest || dismissed || !visible) return null

  const decline = () => {
    void play('paper', { seed: `decline:${quest.key}`, intensity: .35 })
    localStorage.setItem(`lt-event-declined-${quest.key}`, String(Date.now()))
    localStorage.setItem('lt-event-last', String(Date.now()))
    setDismissed(true)
  }

  return (
    <div className="office-event-overlay" role="dialog" aria-modal="true" aria-labelledby="office-event-title">
      <article className={`office-event event-${quest.category}`}>
        <div className="event-art">
          <img src={eventArt(quest.scene)} alt="" draggable={false} />
          <span className="event-category">{EVENT_CATEGORY_LABEL[quest.category]}</span>
        </div>
        <div className="event-body">
          <span className="event-eyebrow">A VISITOR AT THE OFFICE</span>
          <h2 id="office-event-title">{quest.title}</h2>
          <small className="event-patron">{quest.patron} · {quest.objective}</small>
          <p>{quest.description}</p>
          <div className="event-stakes">
            {quest.start_label && <span className="stake-cost">{quest.start_label}</span>}
            <span className="stake-reward">{quest.reward_label}</span>
          </div>
          {accept.error && <ErrorNotice error={accept.error} />}
          <div className="event-actions">
            <button className="primary-button" onClick={() => accept.mutate()} disabled={accept.isPending}>
              {accept.isPending ? 'Opening the file…' : <>Take the matter <ArrowRight size={17} /></>}
            </button>
            <button className="secondary-button" onClick={decline}>Turn them away</button>
          </div>
        </div>
      </article>
    </div>
  )
}


export function PauseButton({ sessionId, returnTo = '/office' }: { sessionId: string; returnTo?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const pause = useMutation({
    mutationFn: () => api.pauseSession(sessionId),
    onSuccess: () => {
      void play('pause', { id: `pause:${sessionId}`, seed: sessionId, intensity: .52 })
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      navigate(returnTo)
    },
  })
  return (
    <button className="secondary-button compact" onClick={() => pause.mutate()} disabled={pause.isPending}>
      <Pause size={15} /> Save & return
    </button>
  )
}
