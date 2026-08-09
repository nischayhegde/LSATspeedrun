import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  Clock3,
  Coins,
  Pause,
  Scale,
  ShieldAlert,
  Sparkles,
  Star,
  Target,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { api } from './api'
import { ErrorNotice, formatMoney } from './components'
import { ClientPortrait, CounselPortrait3D, JudgePortrait } from './game-art'
import { counselFor, keyHash } from './art/assets'
import { useSound } from './sound'
import { MarkupLayer, MarkupToolbar, useCaseMarkup } from './markup'
import { MOTION_TIMING } from './motion'
import { LockedChoicesNotice, useStrategyGate } from './strategy-enforcement'
import type { AttemptReward, CoachingFeedback, GameResponse, StudySession } from './types'

/* The case run itself, split out of `components.tsx` so the app shell no
   longer drags the 3D portraits, the strategy gate and the whole verdict
   surface into the entry bundle. Only the case route imports this. */

// The in-run progress rail reads one page of attempt history and is pure
// supporting detail, so it is split out of this chunk too. Its styling ships
// with the case view itself (see `case-instrument.css`) so nothing reflows
// when the chunk lands.
const CaseRunRail = lazy(() => import('./case-instrument').then((module) => ({ default: module.CaseRunRail })))


function useCountUp(target: number, duration = MOTION_TIMING.countUpMs) {
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


function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}


function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}


/** A whole-form clock runs past an hour, where bare minutes stop reading as a time. */
function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  if (!hours) return formatTime(milliseconds)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}:${minutes.toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`
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


function CasePageTurn({ active, spread }: { active: boolean; spread: boolean }) {
  return (
    <div className={`case-page-turn ${active ? 'is-turning' : ''} ${spread ? 'is-spread' : 'is-single'}`} aria-hidden="true">
      <div className="case-page-turn-underlay"><i /><i /><i /></div>
      <div className="case-page-turn-shadow" />
      <div className="case-page-turn-sheet">
        <div className="case-page-turn-front"><span>CASE ANALYSIS</span><b>COUNSEL WORK PRODUCT</b><i /><i /><i /><i /><em /></div>
        <div className="case-page-turn-back"><span>CONTINUED</span><b>CONFIDENTIAL</b><i /><i /><i /><em /></div>
        <div className="case-page-turn-curl" />
        <div className="case-page-turn-edge" />
      </div>
    </div>
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
  const isBlindReview = session.mode === 'blind_review'
  const isAssessment = isDiagnostic || isBlindReview
  const requiresReasoning = Boolean(item?.requires_reasoning)
  // Every practice run is a paid, fully coached case now, so the only banner
  // and panel split left is diagnostic versus everything else.
  const learningOnly = isAssessment
  const [selected, setSelected] = useState(item?.draft.selected_label || '')
  const [reasoning, setReasoning] = useState(item?.draft.reasoning || '')
  const minChars = item?.reasoning_min_chars ?? 0
  const reasoningLength = reasoning.trim().length
  const reasoningComplete = !requiresReasoning || reasoningLength >= minChars
  const [confidence, setConfidence] = useState(3)
  const [answerChanged, setAnswerChanged] = useState(false)
  const [strategyApplied, setStrategyApplied] = useState<boolean | null>(null)
  const [strategyPromptMs, setStrategyPromptMs] = useState(0)
  const [pageTurning, setPageTurning] = useState(false)
  // Picking "Use it" arms the gate. Everything the gate withholds is withheld
  // from here down, so the wrong order is unreachable rather than discouraged.
  const strategyGate = useStrategyGate(item, {
    armed: strategyApplied === true,
    selectedLabel: selected,
    locked: Boolean(result),
  })
  const [mobileCasePane, setMobileCasePane] = useState<'passage' | 'question'>(() => item?.question.passage ? 'passage' : 'question')
  // Scratch ink over the case file. It belongs to the question on screen and
  // resets itself when the item changes, so nothing follows a student to the
  // next page and nothing is sent to the server.
  const markup = useCaseMarkup(item?.id)
  const [clock, setClock] = useState(Date.now())
  const [openedAt, setOpenedAt] = useState(Date.now())
  const [formClock, setFormClock] = useState(Date.now())
  const verdictRef = useRef<HTMLDivElement>(null)
  const pageTurnRunRef = useRef(0)
  const formExpiredRef = useRef(false)

  useEffect(() => {
    setSelected(item?.draft.selected_label || '')
    setReasoning(item?.draft.reasoning || '')
    setConfidence(3)
    setAnswerChanged(false)
    setStrategyApplied(null)
    setStrategyPromptMs(0)
    setMobileCasePane(item?.question.passage ? 'passage' : 'question')
    setOpenedAt(Date.now())
  }, [item?.id])

  useEffect(() => () => {
    pageTurnRunRef.current += 1
  }, [])

  useEffect(() => {
    if (!item?.timer_active || result) return
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [item?.timer_active, result])

  // The whole-form clock. The server sends the milliseconds left and rejects
  // anything that arrives after zero; this only counts down between polls, and
  // re-anchors every time the session is refetched.
  const formDeadline = useMemo(
    () => (session.remaining_ms == null ? null : Date.now() + session.remaining_ms),
    [session.id, session.remaining_ms],
  )
  const formRemaining = formDeadline == null ? null : Math.max(0, formDeadline - formClock)

  useEffect(() => {
    if (formDeadline == null) return
    formExpiredRef.current = false
    const interval = window.setInterval(() => setFormClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [formDeadline])

  useEffect(() => {
    if (formRemaining !== 0 || formExpiredRef.current) return
    // Time is up. The server has already decided; ask it what the form became.
    formExpiredRef.current = true
    void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    void queryClient.invalidateQueries({ queryKey: ['diagnostic'] })
    void queryClient.invalidateQueries({ queryKey: ['performance'] })
    void queryClient.invalidateQueries({ queryKey: ['game'] })
  }, [formRemaining, queryClient, session.id])

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

  const beginPageTurn = async (afterCurl: () => unknown | Promise<unknown>) => {
    if (pageTurning) return
    const run = ++pageTurnRunRef.current
    const startedAt = Date.now()
    setPageTurning(true)
    void play('paper', { seed: `page-turn:${session.id}:${item?.position ?? 0}`, intensity: .54 })
    await new Promise((resolve) => window.setTimeout(resolve, MOTION_TIMING.pageTurnCurlMs))
    if (pageTurnRunRef.current !== run) return
    try {
      await afterCurl()
    } catch {
      if (pageTurnRunRef.current === run) setPageTurning(false)
      return
    }
    const remaining = Math.max(0, MOTION_TIMING.pageTurnTotalMs - (Date.now() - startedAt))
    if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining))
    if (pageTurnRunRef.current === run) setPageTurning(false)
  }

  const submit = useMutation({
    mutationFn: () => api.submitAttempt(
      session.id,
      {
        item_id: item!.id,
        selected_label: selected,
        reasoning,
        confidence,
        answer_changed: answerChanged,
        ...(item?.strategy_trial ? { strategy_applied: strategyApplied ?? undefined, strategy_prompt_ms: strategyPromptMs } : {}),
        ...strategyGate.payload,
      },
      createRequestId(),
    ),
    onSuccess: ({ result: submittedResult }) => {
      if (!submittedResult.feedback_released && !submittedResult.session_complete) {
        void beginPageTurn(() => queryClient.invalidateQueries({ queryKey: ['session', session.id] }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    },
    onError: (error) => {
      setPageTurning(false)
      // A rejected gate comes back as a 409 with field-level messages on it.
      strategyGate.applyServerErrors((error as unknown as { fields?: Array<{ field: string | null; message: string }> }).fields)
    },
  })
  const continueCases = useMutation({
    mutationFn: () => api.acknowledgeReview(session.id),
    onSuccess: ({ session: nextSession, settlement_pending: settlementPending }) => {
      if (settlementPending) {
        // The player moved on before grading finished. The settlement lands on
        // the worker's own schedule, so re-read the firm shortly to pick up the
        // fee rather than leaving stale cash on screen.
        window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ['game'] })
        }, 6_000)
      }
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
        void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
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
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      if (nextSession.id !== session.id) navigate(`/cases/${nextSession.id}`, { replace: true })
      else void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    },
    onError: () => setPageTurning(false),
  })
  const savedCoaching = result?.feedback?.coaching
  const savedReward = result?.game_reward
  const coaching = useQuery({
    queryKey: ['coaching', result?.attempt_id],
    queryFn: () => api.coaching(result!.attempt_id),
    enabled: Boolean(result?.feedback_released && (!savedCoaching || (!isDiagnostic && !savedReward))),
    retry: false,
    // Grading runs on a background worker, so a look that comes back "pending"
    // is polled rather than awaited. Nothing on screen waits for it.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1_500 : false),
  })
  const coachingFeedback = savedCoaching || coaching.data?.coaching
  const reward = savedReward || coaching.data?.reward
  const coachingReady = Boolean(coachingFeedback)
  const gradingUnavailable = coaching.data?.status === 'unavailable'
  const gradingPending = !coachingReady && !gradingUnavailable && !coaching.error && Boolean(result?.feedback_released)

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
    const ledgerDelay = reasoningValidated ? 220 : 140

    if (reasoningValidated) {
      timers.push(window.setTimeout(() => {
        void play('reasoning-validated', {
          id: `reasoning:${reward.id}`,
          seed: reward.id,
          intensity: .68,
        })
      }, 105))
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
        }, ledgerDelay + 70))
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
  const strategyTrial = item.strategy_trial
  // The control arm's card. It asks for nothing, so it is deliberately absent
  // from `strategyDecisionRequired` below: there is no technique to apply or
  // decline, and demanding an acknowledgement would make the arm cost more
  // than the thing it is the baseline for.
  const strategyNeutral = item.strategy_neutral
  const strategyDecisionRequired = Boolean(strategyTrial && strategyApplied === null && !result)
  const timerRatio = elapsed / Math.max(1, item.target_time_seconds * 1000)
  const caseClient = gameQuery.data?.game?.catalog.clients.find((client) => client.key === item.case_terms?.client_key)
  const clientName = item.case_terms?.client_name || caseClient?.name || 'Walk-in Client'
  const clientKind = caseClient?.icon
  const clientSatisfied = Boolean(result?.is_correct && reward && ['Good', 'Excellent'].includes(reward.explanation_grade))
  const mobileSessionLabel = isBlindReview ? 'Blind review' : isDiagnostic ? 'Mega-litigation' : 'Cases'

  const counsel = counselFor(session.id)
  const counselRattled = Boolean(result?.is_correct)
  const counselLine = result
    ? (result.is_correct ? COUNSEL_WIN_LINES : COUNSEL_LOSS_LINES)[keyHash(result.attempt_id) % COUNSEL_WIN_LINES.length]
    : null

  return (
    <div className="question-layout case-instrument">
      <CasePageTurn active={pageTurning} spread={Boolean(question.passage)} />
      {isAssessment ? (
        <section
          className="learning-mode-banner diagnostic-session-banner"
          aria-label={isBlindReview ? 'Blind review in progress' : 'Mega-litigation in progress'}
        >
          <div><Target size={20} /><span>{isBlindReview ? 'BLIND REVIEW' : 'MEGA-LITIGATION'}</span></div>
          <strong>{isBlindReview ? 'Retrying missed questions · answers still hidden · no time limit' : 'A full practice LSAT · one sitting, one clock · no fees, reputation, or streak until the verdict'}</strong>
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
            <CounselPortrait3D seed={counsel.key} rattled={counselRattled} label={`Opposing counsel ${counsel.name}`} />
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
          <strong>{isAssessment ? 'Question' : 'Case'} {Math.min(item.position + 1, session.total_items)} / {session.total_items}</strong>
          {item.case_terms && <span>{item.case_terms.client_name} · {formatMoney(item.case_terms.base_fee)} base fee</span>}
        </div>
        {isBlindReview ? (
          <div className="case-timer untimed" aria-label="No time limit">
            <Clock3 size={17} />
            <span>Untimed</span>
            <small>take the time you need</small>
          </div>
        ) : formRemaining == null ? (
          <div className={`case-timer ${timerRatio > 1 ? 'over' : ''}`}>
            <Clock3 size={17} />
            <span>{formatTime(elapsed)}</span>
            <small>target {formatTime(item.target_time_seconds * 1000)}</small>
          </div>
        ) : (
          // One clock for the sitting. Spending it unevenly is the student's
          // call, so the per-question target is a reference, not the headline.
          <div className={`case-timer ${formRemaining <= 5 * 60_000 ? 'over' : ''}`} aria-label="Time left in this sitting">
            <Clock3 size={17} />
            <span>{formatCountdown(formRemaining)}</span>
            <small>left · {formatTime(item.target_time_seconds * 1000)} a question keeps you on pace</small>
          </div>
        )}
      </div>
      <div className="progress-track"><span style={{ width: `${session.progress_percent}%` }} /></div>

      <Suspense fallback={null}>
        <CaseRunRail session={session} />
      </Suspense>

      <div className={`mobile-case-reader-header ${formRemaining == null ? '' : 'is-form-sitting'}`} aria-label="Case reader controls">
        <div className="mobile-case-reader-meta">
          <span>{question.section === 'Logical Reasoning' ? 'LR' : 'RC'}</span>
          <div><small>{mobileSessionLabel}</small><strong>{item.position + 1} of {session.total_items}</strong></div>
        </div>
        {question.passage && (
          <div className="mobile-case-pane-tabs" role="tablist" aria-label="Reading view">
            <button type="button" role="tab" aria-selected={mobileCasePane === 'passage'} className={mobileCasePane === 'passage' ? 'active' : ''} onClick={() => { setMobileCasePane('passage'); void play('paper', { seed: `${item.id}:passage`, intensity: .2 }) }}><BookOpen size={15} /> Passage</button>
            <button type="button" role="tab" aria-selected={mobileCasePane === 'question'} className={mobileCasePane === 'question' ? 'active' : ''} onClick={() => { setMobileCasePane('question'); void play('tab', { seed: `${item.id}:question`, intensity: .22 }) }}>Question</button>
          </div>
        )}
        {/* A mega-litigation has one clock for the whole sitting and no pause, so
            the countdown has to stay on screen here — the desktop topbar that
            normally carries it is hidden at phone widths. */}
        {formRemaining == null ? (
          <div className={`mobile-case-reader-time ${!isBlindReview && timerRatio > 1 ? 'over' : ''}`}><Clock3 size={14} /><span>{isBlindReview ? 'Untimed' : formatTime(elapsed)}</span></div>
        ) : (
          <div className={`mobile-case-reader-time is-form-clock ${formRemaining <= 5 * 60_000 ? 'over' : ''}`} aria-label="Time left in this sitting">
            <Clock3 size={14} /><span>{formatCountdown(formRemaining)}</span><small>left</small>
          </div>
        )}
      </div>

      {strategyTrial && (
        <section className={`strategy-tip ${strategyApplied === true ? 'is-applied' : strategyApplied === false ? 'is-skipped' : ''}`} aria-label={`Suggested approach: ${strategyTrial.plain_title}`}>
          <div className="strategy-tip-head">
            <span><Brain size={15} /> PARTNER TIP</span>
            {!result && <small>Pick one before you answer</small>}
          </div>
          <h2>{strategyTrial.plain_title}</h2>
          <p>{strategyTrial.plain_line}</p>
          <ol>{strategyTrial.steps.map((step, index) => <li key={step}><b>{index + 1}</b>{step}</li>)}</ol>
          <div className="strategy-tip-actions">
            {!result ? <>
              <button type="button" className={`strategy-tip-use ${strategyApplied === true ? 'active' : ''}`} aria-pressed={strategyApplied === true} onClick={() => {
                if (strategyApplied === null) setStrategyPromptMs(Math.min(60_000, Date.now() - openedAt))
                setStrategyApplied(true)
                void play('select', { seed: `${item.id}:strategy-use`, intensity: .36 })
              }}><Check size={15} /> Use it</button>
              <button type="button" className={`strategy-tip-skip ${strategyApplied === false ? 'active' : ''}`} aria-pressed={strategyApplied === false} onClick={() => {
                if (strategyApplied === null) setStrategyPromptMs(Math.min(60_000, Date.now() - openedAt))
                setStrategyApplied(false)
                void play('paper', { seed: `${item.id}:strategy-skip`, intensity: .25 })
              }}>Skip this one</button>
            </> : <div className="strategy-tip-recorded"><Check size={17} /><span>{strategyApplied ? 'Used this approach' : 'Answered without it'}</span></div>}
          </div>
        </section>
      )}

      {strategyNeutral && (
        <section className="strategy-tip is-neutral" aria-label={strategyNeutral.plain_title}>
          <div className="strategy-tip-head">
            <span><Brain size={15} /> PARTNER TIP</span>
          </div>
          <h2>{strategyNeutral.plain_title}</h2>
          <p>{strategyNeutral.plain_line}</p>
          <p className="strategy-tip-neutral-note">{strategyNeutral.note}</p>
        </section>
      )}

      {strategyGate.panel}

      <MarkupToolbar markup={markup} seed={item.id} />

      <div className={`${question.passage ? `question-content with-passage mobile-pane-${mobileCasePane}` : 'question-content'} ${strategyDecisionRequired ? 'strategy-decision-pending' : ''}`}>
        {question.passage && (
          <article className="passage-card">
            <div className="document-heading"><BookOpen size={16} /><span>EXHIBIT A · READING PASSAGE</span></div>
            <div className="passage-text">{question.passage.text}</div>
            <button type="button" className="mobile-open-question" onClick={() => setMobileCasePane('question')}>Go to the question <ArrowRight size={17} /></button>
            {/* Last, so the sentinel inside measures the passage above it. */}
            <MarkupLayer markup={markup} surface="passage" />
          </article>
        )}

        <section className={`answer-card ${result ? (result.is_correct ? 'case-won' : 'case-lost') : ''}`}>
          <div className="paperclip" aria-hidden="true" />
          {question.stimulus && <div className="stimulus">{question.stimulus}</div>}
          <span className="question-label">QUESTION PRESENTED</span>
          <h1>{question.stem}</h1>
          {strategyGate.choicesHidden && strategyGate.gate ? <LockedChoicesNotice gate={strategyGate.gate} /> : (
          <div className="choices" role="radiogroup" aria-label="Answer choices">
            {question.choices.map((choice) => {
              const chosen = (result?.feedback?.selected_label || selected) === choice.label
              const correct = result?.feedback?.correct_label === choice.label
              const wrongSelected = Boolean(result && chosen && !correct)
              const stricken = strategyGate.strickenLabels.includes(choice.label)
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={Boolean(result) || strategyDecisionRequired || (stricken && !result)}
                  className={`choice ${chosen ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrongSelected ? 'incorrect' : ''} ${stricken && !result ? 'gate-struck' : ''}`}
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
          )}

          {!result && requiresReasoning && (
            <div className="reasoning-box">
              <div className="reasoning-heading">
                <label htmlFor="reasoning">Your case theory <b>Required</b></label>
                <span>{reasoningLength} / {minChars} characters</span>
              </div>
              <textarea
                id="reasoning"
                value={reasoning}
                disabled={strategyDecisionRequired}
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
              <div>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} disabled={strategyDecisionRequired} className={confidence === value ? 'active' : ''} onClick={() => setConfidence(value)} aria-pressed={confidence === value}>{value}</button>)}</div>
              <small>{confidence <= 2 ? 'Unsure' : confidence >= 4 ? 'Confident' : 'Moderate'}</small>
            </div>
          )}

          {!result && (
            <div className="answer-actions">
              {submit.error && <ErrorNotice error={submit.error} />}
              <button className="primary-button verdict-button" disabled={!selected || !reasoningComplete || strategyDecisionRequired || !strategyGate.satisfied || submit.isPending || pageTurning} onClick={() => {
                void play('submit', { seed: item.id, intensity: .68 })
                submit.mutate()
              }}>
                {strategyDecisionRequired ? 'Pick Use it or Skip first' : submit.isPending || pageTurning ? 'Recording answer…' : !strategyGate.satisfied ? strategyGate.blockedReason : !selected ? 'Select an answer' : !reasoningComplete ? `${minChars - reasoningLength} more characters` : <>{requiresReasoning ? 'Submit reasoning' : session.feedback_policy === 'delayed' ? 'Lock answer' : 'Check answer'} <Scale size={18} /></>}
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
                loading={gradingPending}
              />
            </div>
          )}
          {result && gradingPending && (
            <div className="grading-pending" role="status">
              <Brain size={17} />
              <div>
                <strong>The coach is still reading your reasoning.</strong>
                <small>
                  Your answer is already recorded and the fee is being settled. Move to the next case
                  whenever you like — the written feedback and the payout land in your ledger on their own.
                </small>
              </div>
            </div>
          )}
          {result && gradingUnavailable && (
            <div className="grading-pending is-unavailable" role="status">
              <ShieldAlert size={17} />
              <div>
                <strong>Written feedback is unavailable for this case.</strong>
                <small>{coaching.data?.notice}</small>
              </div>
            </div>
          )}
          {result && coaching.error && (!coachingFeedback || !reward) && (
            <div className="coaching-error">
              <ErrorNotice error={coaching.error} />
              <button className="secondary-button" onClick={() => coaching.refetch()}>Retry case review</button>
            </div>
          )}
          {coachingFeedback && (isAssessment
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
              {/* Never gated on grading. Waiting 20-30 seconds per case for a
                  frontier-model call is hours of dead time across a course, and
                  the settlement does not need the player present to land. */}
              <button
                className="primary-button next-case-button"
                disabled={continueCases.isPending || pageTurning}
                onClick={() => void beginPageTurn(() => continueCases.mutateAsync())}
              >
                {continueCases.isPending || pageTurning ? 'Turning the page…' : <>Next case <ArrowRight size={18} /></>}
              </button>
            </div>
          )}
          {/* Last, so the sentinel inside measures the whole card — including
              the verdict and coaching panels that mount after a submission. */}
          <MarkupLayer markup={markup} surface="answer" />
        </section>
      </div>
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
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      navigate(returnTo)
    },
  })
  return (
    <button className="secondary-button compact" onClick={() => pause.mutate()} disabled={pause.isPending}>
      <Pause size={15} /> Save & return
    </button>
  )
}
