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
import { Bust } from './art/people'
import { counselArt, counselFor, eventArt, keyHash } from './art/assets'
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
      <span className="brand-word"><strong>LAWYER</strong><small>{caseFile ? 'CASE FILE' : 'TYCOON'}</small></span>
    </>
  )
  if (caseFile) return <div className="brand case-brand" aria-label="Lawyer Tycoon active case">{contents}</div>
  return <Link className={`brand ${light ? 'light' : ''}`} to="/office" aria-label="Lawyer Tycoon office">{contents}</Link>
}


const navItems = [
  { to: '/office', label: 'Office', icon: Building2 },
  { to: '/cases', label: 'Do Cases', icon: BriefcaseBusiness },
  { to: '/story', label: 'Story', icon: BookOpen },
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


export function QuestionFlow({ session }: { session: StudySession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const gameQuery = useQuery({ queryKey: ['game'], queryFn: api.game })
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
      <section className="active-matter-banner" aria-label={`Current case for ${clientName}`}>
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
      </section>
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

        <section className={`answer-card ${result ? (result.is_correct ? 'case-won' : 'case-lost') : ''}`}>
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
            <div ref={verdictRef} tabIndex={-1} className="judge-review-focus">
              <div className={`verdict-stamp ${result.is_correct ? 'stamp-won' : 'stamp-lost'}`} key={result.attempt_id} aria-hidden="true">
                <span>{result.is_correct ? 'SUSTAINED' : 'OVERRULED'}</span>
              </div>
              <JudgeReview
                isCorrect={result.is_correct}
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
          {coachingFeedback && <CoachingPanel coaching={coachingFeedback} reward={reward} selectedLabel={result?.feedback.selected_label} />}
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
      localStorage.setItem('lt-event-last', String(Date.now()))
      queryClient.setQueryData<GameResponse>(['game'], { game: nextGame, pending_reviews: [] })
      setDismissed(true)
    },
  })

  if (!quest || dismissed || !visible) return null

  const decline = () => {
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
