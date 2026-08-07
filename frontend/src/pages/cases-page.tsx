import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Coins,
  Flame,
  Lock,
  Pause,
  Scale,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, formatMoney, LoadingScreen } from '../components'
import { ClientPortrait } from '../game-art'
import { PixelStudyScenery } from '../art/pixel-scenery'
import { useSound } from '../sound'
import { TrialCalendar } from '../trial-calendar'
import type { StudySession } from '../types'
import { effectiveClient, InertTabPanels, MegaLitigationGate, PanelFallback, TabStrip, useGame } from './shared'

// The Practice tab's mega-litigation home carries a paginated history feed and
// a full results view, both below the fold behind a tab, so it stays out of
// this route's own chunk.
const MegaLitigationPanel = lazy(() =>
  import('../mega-litigation').then((module) => ({ default: module.MegaLitigationPanel })),
)

/* Two ways of practising, so two tabs. The mega-litigation used to be a slab
   appended below the case controls, which read as an unrelated advertisement
   rather than as the other thing you can sit down and do here. */
type PracticeTab = 'cases' | 'mega'

const PRACTICE_TABS: ReadonlyArray<{ key: PracticeTab; label: string }> = [
  { key: 'cases', label: 'Cases' },
  { key: 'mega', label: 'Mega-litigation' },
]


export function CasesLobbyPage() {
  const navigate = useNavigate()
  const { play } = useSound()
  const queryClient = useQueryClient()
  const gameQuery = useGame()
  const activeSessions = useQuery({ queryKey: ['active-sessions'], queryFn: api.activeSessions })
  const reviews = useQuery({ queryKey: ['review-queue'], queryFn: api.reviewQueue })
  const docketQuery = useQuery({ queryKey: ['daily-docket'], queryFn: api.dailyDocket })
  const start = useMutation({
    mutationFn: (plan?: { size?: number }) => api.startPractice({ size: plan?.size ?? 10 }),
    onSuccess: ({ session }) => {
      void play('file-open', { id: `case-open:${session.id}`, seed: session.id, intensity: .62 })
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['daily-docket'] })
      navigate(`/cases/${session.id}`)
    },
  })
  // A student can queue up to `queueCap` unfinished runs at once. Discarding
  // surfaces an explicit way out of a stale run instead of forcing it to be
  // finished or silently left to rot in the queue.
  const discardRun = useMutation({
    mutationFn: (id: string) => api.abandonSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['daily-docket'] })
    },
  })
  // Only one queued run may ever be `in_progress` — its item timer is the
  // only one actually ticking. The backend enforces this by auto-pausing
  // whatever else was in_progress whenever a run is created or resumed, but a
  // student can still explicitly pause the one live run from the queue list.
  const pauseRun = useMutation({
    mutationFn: (id: string) => api.pauseSession(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['active-sessions'] }),
  })
  const resumeRun = useMutation({
    mutationFn: (id: string) => api.resumeSession(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      navigate(`/cases/${id}`)
    },
  })
  // A mega-litigation starts its clock the moment the form is created, so the
  // creation call sits behind the same gate the dashboard puts it behind.
  const [megaGateOpen, setMegaGateOpen] = useState(false)
  const [tab, setTab] = useState<PracticeTab>('cases')
  const selectTab = (next: PracticeTab) => {
    if (next === tab) return
    void play('tab', { seed: `practice:${next}`, intensity: .24 })
    setTab(next)
  }
  const startDiagnostic = useMutation({
    mutationFn: () => api.startDiagnostic(1),
    onSuccess: ({ session }) => {
      setMegaGateOpen(false)
      void play('file-open', { seed: `diagnostic:${session.id}`, intensity: .64 })
      navigate(`/cases/${session.id}`)
    },
  })
  const megaQuery = useQuery({ queryKey: ['diagnostic'], queryFn: api.currentDiagnostic })
  if (gameQuery.isLoading || activeSessions.isLoading || reviews.isLoading || docketQuery.isLoading) return <LoadingScreen label="Checking the docket…" />
  const game = gameQuery.data!.game!
  const workingClient = effectiveClient(game)
  const runs = activeSessions.data?.sessions ?? []
  const queueCap = activeSessions.data?.queue_cap ?? 8
  const queueFull = runs.length >= queueCap
  const dueReviews = reviews.data?.review_queue.due ?? 0
  const daily = docketQuery.data?.daily_docket
  // These three reads are all optional on the page, so a failure used to leave
  // sections quietly missing with no way to recover short of a reload.
  const partialError = docketQuery.error || activeSessions.error || reviews.error
  const partialRetrying = docketQuery.isFetching || activeSessions.isFetching || reviews.isFetching
  const retryPartial = () => {
    if (docketQuery.error) void docketQuery.refetch()
    if (activeSessions.error) void activeSessions.refetch()
    if (reviews.error) void reviews.refetch()
  }
  const runNextDocketStep = () => {
    if (!daily) return
    if (daily.next_action.kind === 'resume' || daily.next_action.kind === 'open_brief') {
      if (daily.next_action.session_id) navigate(`/cases/${daily.next_action.session_id}`)
      return
    }
    if (queueFull) return
    if (daily.next_action.kind === 'start_cases') start.mutate({ size: 10 })
  }
  const describeStarted = (startedAt: string) => {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000))
    if (minutes < 1) return 'started just now'
    if (minutes < 60) return `started ${minutes} min ago`
    const hours = Math.round(minutes / 60)
    return `started ${hours} hr${hours === 1 ? '' : 's'} ago`
  }
  const runStatus = (run: StudySession) => {
    if (run.pending_result) return { label: 'Needs review', cls: 'is-debrief' }
    if (run.status === 'in_progress') return { label: 'Running', cls: 'is-running' }
    return { label: 'Paused', cls: 'is-paused' }
  }
  const startNewRun = (plan?: { size?: number }) => {
    if (queueFull) return
    start.mutate(plan)
  }
  // A queued run's timer only ticks while its case view is open, so resuming
  // one that is already `in_progress` (or mid-debrief) is just a navigation —
  // only a `paused` run needs the resume call before it is safe to open.
  const openRun = (run: StudySession) => {
    void play('resume', { seed: run.id, intensity: .5 })
    if (run.pending_result || run.status === 'in_progress') {
      navigate(`/cases/${run.id}`)
      return
    }
    resumeRun.mutate(run.id)
  }
  const pauseRunClick = (run: StudySession) => {
    void play('pause', { id: `pause:${run.id}`, seed: run.id, intensity: .45 })
    pauseRun.mutate(run.id)
  }
  const discardRunClick = (run: StudySession) => {
    if (run.pending_result) return
    void play('paper', { seed: `discard:${run.id}`, intensity: .4 })
    discardRun.mutate(run.id)
  }
  const queueError = discardRun.error || pauseRun.error || resumeRun.error
  const liveMega = megaQuery.data?.session ?? null
  const megaSize = liveMega?.total_items || megaQuery.data?.latest?.session.total_items || 75
  const megaMinutes = liveMega?.target_minutes || megaQuery.data?.latest?.session.target_minutes || 105
  const openMega = () => {
    if (liveMega) navigate(`/cases/${liveMega.id}`)
    else setMegaGateOpen(true)
  }
  // A one-line read of the queue, so the header answers "what is in here"
  // before the list has to be scrolled.
  const runningCount = runs.filter((run) => run.status === 'in_progress' && !run.pending_result).length
  const reviewCount = runs.filter((run) => run.pending_result).length
  const queueSummary = [
    runningCount ? `${runningCount} running` : null,
    reviewCount ? `${reviewCount} needs review` : null,
    `${Math.max(0, queueCap - runs.length)} slot${queueCap - runs.length === 1 ? '' : 's'} left`,
  ].filter(Boolean).join(' · ')
  return (
    <div className="case-lobby practice-lab page-wrap">
      {partialError && (
        <div className="partial-load-notice">
          <ErrorNotice error={partialError} retrying={partialRetrying} onRetry={retryPartial} />
          <p>Some of this page could not be loaded, so a few sections may be missing or out of date.</p>
        </div>
      )}

      {/* Who you are working for is true in either mode, so it stays above the
          tabs. Everything that differs between the two modes is inside them. */}
      <section className="practice-action" aria-label="Practice">
        <PixelStudyScenery variant="docket" className="practice-action-scenery" />
        <h1>Practice</h1>
        <div className="practice-action-client">
          <ClientPortrait kind={workingClient.icon} name={workingClient.name} className="lobby-client-portrait" />
          <div>
            <small>{game.active_client.on_hold ? 'EFFECTIVE CLIENT' : 'ACTIVE CLIENT'}</small>
            <strong>{workingClient.name}</strong>
            <span className="practice-action-terms">
              <b><Coins size={13} /> {formatMoney(workingClient.base_fee)} base fee</b>
              <b><BriefcaseBusiness size={13} /> {game.active_client.on_hold ? `${game.active_client.name} paused` : `${game.active_client.cases_remaining} cases left`}</b>
              <b><Flame size={13} /> {game.current_streak} validated streak</b>
            </span>
          </div>
        </div>
        {daily?.trial && <TrialCalendar plan={daily.trial} compact />}
      </section>

      {/* A mega-litigation is a way of practising, not a slab bolted to the
          bottom of the page it was advertised on. It is the second mode here,
          and it owns its own panel — including every sitting already taken. */}
      <TabStrip id="practice" className="practice-tabs" label="Practice modes" tabs={PRACTICE_TABS} active={tab} onSelect={selectTab} />
      <InertTabPanels id="practice" tabs={PRACTICE_TABS} active={tab} />
      <div key={tab} className="practice-panel" id={`practice-panel-${tab}`} role="tabpanel" aria-labelledby={`practice-tab-${tab}`} tabIndex={0}>

        {tab === 'cases' && (
          <>
            <section className="practice-run" aria-label="Start a run of cases">
              <p className="practice-action-shape">{queueFull
                ? `Queue full (${runs.length}/${queueCap}) — discard a run below to start another.`
                : dueReviews
                  ? `10 questions with ${Math.min(5, dueReviews)} due repair${Math.min(5, dueReviews) === 1 ? '' : 's'} folded in. A written explanation on each one, then coaching after every answer.`
                  : '10 unseen questions. A written explanation on each one, then coaching after every answer.'}</p>
              <button
                className="primary-button jumbo"
                onClick={() => startNewRun()}
                disabled={start.isPending || queueFull}
              >
                <BriefcaseBusiness /> {start.isPending ? 'Building your run…' : queueFull ? `Queue full (${runs.length}/${queueCap})` : 'Start 10 cases'} <ArrowRight />
              </button>
              {daily && daily.next_action.kind !== 'start_cases' && (
                <button
                  type="button"
                  className="practice-action-secondary"
                  onClick={runNextDocketStep}
                  disabled={start.isPending || daily.next_action.kind === 'done'}
                >
                  {daily.next_action.kind === 'done' ? <CheckCircle2 size={15} /> : <ArrowRight size={15} />}
                  <span>{daily.next_action.kind === 'done' ? 'Today’s loop is complete' : daily.next_action.label}</span>
                  {daily.deep_brief.priority_count > 0 && <em>{daily.deep_brief.priority_count} to brief</em>}
                </button>
              )}
              {start.error && <ErrorNotice error={start.error} />}
            </section>

            {runs.length > 0 && (
              <section className="run-queue-panel" aria-label="Your practice run queue">
                <header className="run-queue-header">
                  <div>
                    <span className="eyebrow">YOUR RUNS</span>
                    <h2>{runs.length} of {queueCap} queued</h2>
                    <small>{queueSummary}</small>
                  </div>
                  {queueFull && <span className="run-queue-full-flag"><ShieldAlert size={14} /> Queue full — discard a run to start another</span>}
                </header>
                {/* Capped and scrolled rather than unbounded: eight queued runs
                    used to push everything under them off the fold. Every row
                    holds focusable controls, so tabbing scrolls the list into
                    view without the container having to take focus itself. */}
                <div className="run-queue-list">
                  {runs.map((run) => {
                    const RunIcon = BriefcaseBusiness
                    const status = runStatus(run)
                    const pendingReview = Boolean(run.pending_result)
                    return (
                      <article key={run.id} className={`run-queue-item ${status.cls}`}>
                        <RunIcon size={19} />
                        <div className="run-queue-item-copy">
                          <strong>Cases</strong>
                          <span>{run.current_index} of {run.total_items} answered · {describeStarted(run.started_at)}</span>
                        </div>
                        <span className={`run-queue-status-pill ${status.cls}`}>{status.label}</span>
                        <div className="run-queue-item-actions">
                          {run.status === 'in_progress' && !pendingReview && (
                            <button type="button" className="run-queue-pause" disabled={pauseRun.isPending} onClick={() => pauseRunClick(run)}>
                              <Pause size={13} /> Pause
                            </button>
                          )}
                          <button
                            type="button"
                            className="run-queue-discard"
                            disabled={pendingReview || discardRun.isPending}
                            onClick={() => discardRunClick(run)}
                            title={pendingReview ? 'Finish reviewing the current answer first' : 'Discard this run'}
                          >
                            Discard
                          </button>
                          <button type="button" className="run-queue-resume" disabled={resumeRun.isPending} onClick={() => openRun(run)}>
                            {run.status === 'in_progress' ? 'Continue' : 'Resume'} <ArrowRight size={14} />
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
                {queueError && <ErrorNotice error={queueError} />}
              </section>
            )}

            {daily && (
              <section className="daily-docket" aria-labelledby="daily-docket-title">
                <header>
                  <div><span className="eyebrow">TODAY&apos;S DOCKET · {daily.date}</span><h2 id="daily-docket-title">One measured loop. No busywork.</h2></div>
                  <button
                    className="daily-docket-action"
                    onClick={runNextDocketStep}
                    disabled={start.isPending || daily.next_action.kind === 'done' || (queueFull && daily.next_action.kind === 'start_cases')}
                  >
                    {daily.next_action.kind === 'done' ? <CheckCircle2 /> : <ArrowRight />}<span><small>NEXT ACTION</small><strong>{start.isPending ? 'Preparing docket…' : daily.next_action.label}</strong></span>
                  </button>
                </header>
                <div className="daily-docket-track">
                  <article className={`state-${daily.cases.state}`}><b>01</b><div><span><BriefcaseBusiness /> CASES</span><strong>10 questions{daily.cases.repairs_due ? `, ${Math.min(5, daily.cases.repairs_due)} repairs folded in` : ''}</strong><small>Written explanation · graded · coaching after every answer</small></div><i>{daily.cases.state === 'complete' ? <Check /> : daily.cases.state === 'active' ? 'LIVE' : 'NOW'}</i></article>
                  <article className={`state-${daily.deep_brief.state}`}><b>02</b><div><span><Brain /> DEEP BRIEF</span><strong>{daily.deep_brief.priority_count ? `${daily.deep_brief.priority_count} decision${daily.deep_brief.priority_count === 1 ? '' : 's'} to audit` : 'Confirm what held'}</strong><small>Correct rule · selected trap · transfer cue</small></div><i>{daily.deep_brief.state === 'complete' ? <Check /> : daily.deep_brief.state === 'locked' ? <Lock /> : 'OPEN'}</i></article>
                </div>
              </section>
            )}
          </>
        )}

        {tab === 'mega' && (
          <Suspense fallback={<PanelFallback label="Loading mega-litigation…" />}>
            <MegaLitigationPanel
              pending={startDiagnostic.isPending}
              error={startDiagnostic.error}
              onStart={openMega}
              onResume={(id) => navigate(`/cases/${id}`)}
            />
          </Suspense>
        )}
      </div>

      {/* Everything explanatory on this page lives in here. A student who
          knows the loop sees controls; a student who does not is one click
          from the whole of it, and the click is on the page they are already
          looking at rather than on a help screen somewhere else. */}
      <details className="practice-guide">
        <summary><BookOpen size={15} /> How practice works</summary>
        <div className="practice-guide-body">
          <section>
            <h2>Every run is the same shape</h2>
            <p>Unseen questions with any due repairs folded in, a written explanation on each one, and coaching after every answer.</p>
            <ol className="practice-loop">
              <li><b>01</b><Scale /><div><h3>Answer</h3><p>The verified key—not AI—determines correctness.</p></div></li>
              <li><b>02</b><BookOpen /><div><h3>Understand</h3><p>Every checked answer receives concise reasoning.</p></div></li>
              <li><b>03</b><Brain /><div><h3>Repair</h3><p>Only uncertain, slow, or missed work enters review.</p></div></li>
              <li><b>04</b><TrendingUp /><div><h3>Transfer</h3><p>Unseen questions prove that the method held.</p></div></li>
            </ol>
          </section>
          <section>
            <h2>The mega-litigation</h2>
            <p>{megaSize} LR and RC questions in three blocks under a single {megaMinutes}-minute clock, in one sitting with no pause. It is the only measurement here that pays nothing, prompts nothing and coaches nothing, which is why your projected score is anchored on it. Above 70% promotes your firm a tier.</p>
          </section>
          <section>
            <h2>Your client</h2>
            <p>{game.active_client.on_hold
              ? `${game.active_client.name} is on hold until your Reputation recovers. Walk-in matters remain available at the fee above.`
              : workingClient.description}</p>
          </section>
        </div>
      </details>

      {megaGateOpen && (
        <MegaLitigationGate
          questions={megaSize}
          minutes={megaMinutes}
          pending={startDiagnostic.isPending}
          onCancel={() => setMegaGateOpen(false)}
          onConfirm={() => startDiagnostic.mutate()}
        />
      )}
    </div>
  )
}
