import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Coins,
  Flame,
  Pause,
  ShieldAlert,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, formatMoney, LoadingScreen } from '../components'
import { createDemoCursor, demoSleep, waitForPainted } from '../demo/demo-cursor'
import { ClientPortrait } from '../game-art'
import { PixelStudyScenery } from '../art/pixel-scenery'
import { useSound } from '../sound'
import { TrialCalendar } from '../trial-calendar'
import type { StudySession } from '../types'
import { effectiveClient, InertTabPanels, MegaLitigationGate, PanelFallback, TabStrip, useGame } from './shared'
/**
 * The lab's own sheet, which this file is the only writer of. It was on the
 * entry, so every screen downloaded the practice lobby's styling; now it comes
 * with this route, positioned by `lsat-route-stylesheets` in `vite.config.ts`
 * exactly where it sat before.
 */
import '../practice-lab.css'
// The rules in `styles.css` that only this screen can render. Below the lab
// sheet because that is the order the two had on the entry.
import '../cases-page.css'
import '../mobile/cases-page.css'

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

const namedPracticeTab = (value: string | null): PracticeTab | null =>
  (PRACTICE_TABS.find((item) => item.key === value)?.key ?? null)


export function CasesLobbyPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { play } = useSound()
  const queryClient = useQueryClient()
  const gameQuery = useGame()
  const activeSessions = useQuery({ queryKey: ['active-sessions'], queryFn: api.activeSessions })
  const reviews = useQuery({ queryKey: ['review-queue'], queryFn: api.reviewQueue })
  const docketQuery = useQuery({ queryKey: ['daily-docket'], queryFn: api.dailyDocket })
  const start = useMutation({
    // No size: the server owns how long a run is. This asked for ten, which was
    // the run length before it became six, so the page's own copy said "about 6
    // questions" and then started a ten-question run.
    mutationFn: () => api.startPractice(),
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
  const deckMegaDemo = searchParams.get('deckDemo') === 'mega'
  const [tab, setTab] = useState<PracticeTab>(namedPracticeTab(searchParams.get('tab')) ?? (deckMegaDemo ? 'mega' : 'cases'))
  const [demoBeat, setDemoBeat] = useState(0)
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
  useEffect(() => {
    const requested = namedPracticeTab(searchParams.get('tab'))
    if (requested) setTab(requested)
    else if (deckMegaDemo) setTab('mega')
  }, [searchParams, deckMegaDemo])
  useEffect(() => {
    if (!deckMegaDemo || gameQuery.isLoading || megaQuery.isLoading) return
    let cancelled = false
    const cursor = createDemoCursor()
    const abort = new AbortController()
    setTab('mega')
    setDemoBeat(0)
    void (async () => {
      await demoSleep(1_600, abort.signal)
      if (cancelled) return
      const panel = await waitForPainted('.mega-panel', 8_000, abort.signal)
      if (cancelled || !panel) return
      const clockTerm = panel.querySelector<HTMLElement>('.mega-terms li')
      if (clockTerm) {
        cursor.showAt(window.innerWidth * 0.32, window.innerHeight * 0.38)
        await cursor.hoverClick(clockTerm, { hoverMs: 1_100, moveMs: 620, peek: true, signal: abort.signal })
      }
      if (cancelled) return
      const sit = panel.querySelector<HTMLElement>('.mega-start-button, .mega-resume-button, .mega-panel-actions button')
      const wouldStartForm = Boolean(sit?.classList.contains('mega-resume-button'))
      if (sit) {
        await cursor.hoverClick(sit, {
          hoverMs: 1_050,
          moveMs: 480,
          peek: wouldStartForm,
          signal: abort.signal,
        })
      }
      if (cancelled) return
      setDemoBeat(1)
      const gate = wouldStartForm ? null : await waitForPainted('.mega-gate', 4_000, abort.signal)
      if (gate) {
        await demoSleep(2_600, abort.signal)
        if (cancelled) return
        const dismiss = document.querySelector<HTMLElement>('.mega-gate-cancel')
        if (dismiss) await cursor.hoverClick(dismiss, { hoverMs: 700, moveMs: 420, signal: abort.signal })
        await demoSleep(600, abort.signal)
      } else {
        await demoSleep(1_400, abort.signal)
      }
      if (cancelled) return
      setDemoBeat(2)
      let row = await waitForPainted('.mega-history-row', 5_000, abort.signal)
      if (!row) {
        const more = document.querySelector<HTMLElement>('.mega-history-more')
        if (more) {
          await cursor.hoverClick(more, { hoverMs: 520, moveMs: 380, signal: abort.signal })
          row = await waitForPainted('.mega-history-row', 6_000, abort.signal)
        }
      }
      if (cancelled || !row) {
        cursor.hide()
        return
      }
      row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      await demoSleep(700, abort.signal)
      if (cancelled) return
      await cursor.hoverClick(row, { hoverMs: 860, moveMs: 560, signal: abort.signal })
      await waitForPainted('.mega-result', 6_000, abort.signal)
      await demoSleep(2_800, abort.signal)
      cursor.hide()
    })()
    return () => {
      cancelled = true
      abort.abort()
      cursor.destroy()
    }
  }, [deckMegaDemo, gameQuery.isLoading, megaQuery.isLoading])
  if (gameQuery.isLoading || activeSessions.isLoading || reviews.isLoading || docketQuery.isLoading) return <LoadingScreen label="Loading…" />
  const game = gameQuery.data!.game!
  const workingClient = effectiveClient(game)
  const runs = activeSessions.data?.sessions ?? []
  const queueCap = activeSessions.data?.queue_cap ?? 13
  // A run may finish a question or two over this to serve a Reading
  // Comprehension passage whole, so the copy says "questions" rather than
  // promising an exact count of them.
  const sessionSize = activeSessions.data?.session_size ?? 6
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
    if (daily.next_action.kind === 'start_cases') start.mutate()
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
  const startNewRun = () => {
    if (queueFull) return
    start.mutate()
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
  // A blind review holds this slot too, and its size is the number of misses
  // rather than the paper's, so the form's shape is only read off a form.
  const openMegaForm = liveMega?.mode === 'diagnostic' ? liveMega : null
  const megaSize = openMegaForm?.total_items || megaQuery.data?.latest?.session.total_items || 75
  const megaMinutes = openMegaForm?.target_minutes || megaQuery.data?.latest?.session.target_minutes || 105
  const openMega = () => {
    if (liveMega) navigate(`/cases/${liveMega.id}`)
    else setMegaGateOpen(true)
  }
  // A one-line read of the queue, so the header answers "what is in here"
  // before the list has to be scrolled.
  // Whether the next run will carry repairs, not how many. The count used to be
  // `Math.min(5, dueReviews)` — the old ten-question run's fixed half, written
  // down a second time on the client, and already wrong by two once a run became
  // six questions. It is now not derivable here at all: how much of a run is
  // review is read off the student's own queue, and a reading case carries
  // whichever of its passage's questions happened to be due. The honest promise
  // is the one the server can always keep.
  const hasRepairs = dueReviews > 0
  const runningCount = runs.filter((run) => run.status === 'in_progress' && !run.pending_result).length
  const reviewCount = runs.filter((run) => run.pending_result).length
  const queueSummary = [
    runningCount ? `${runningCount} running` : null,
    reviewCount ? `${reviewCount} needs review` : null,
    `${Math.max(0, queueCap - runs.length)} slot${queueCap - runs.length === 1 ? '' : 's'} left`,
  ].filter(Boolean).join(' · ')
  const megaDemoCopy = [
    ['Clock, section, one sitting', 'A full practice LSAT: one clock across every block, results held to the end.'],
    ['Real test conditions', 'One sitting, no pause. The gate is the product — not a film of it.'],
    ['Time pressure vs reasoning', 'Questions past their split are time. Weak types are reasoning, and they come back.'],
  ] as const

  return (
    <div className="case-lobby practice-lab page-wrap" data-deck-demo={deckMegaDemo ? 'mega' : undefined}>
      {deckMegaDemo && (
        <>
          <div className="deck-demo-sequence" data-live="true" aria-hidden="true">
            <span data-state={demoBeat === 0 ? 'active' : 'complete'}>01 · Full test</span>
            <i />
            <span data-state={demoBeat === 1 ? 'active' : demoBeat > 1 ? 'complete' : 'next'}>02 · Test conditions</span>
            <i />
            <span data-state={demoBeat === 2 ? 'active' : 'next'}>03 · Diagnosis</span>
          </div>
          <div className="deck-demo-caption" key={demoBeat} aria-live="polite">
            <small>MEGA · {String(demoBeat + 1).padStart(2, '0')}</small>
            <strong>{megaDemoCopy[demoBeat][0]}</strong>
            <span>{megaDemoCopy[demoBeat][1]}</span>
          </div>
        </>
      )}
      {partialError && (
        <div className="partial-load-notice">
          <ErrorNotice error={partialError} retrying={partialRetrying} onRetry={retryPartial} />
          <p>Some sections failed to load and may be missing or out of date.</p>
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
            <small>{game.active_client.on_hold ? 'BILLING INSTEAD' : 'ON RETAINER'}</small>
            <strong>{workingClient.name}</strong>
            <span className="practice-action-terms">
              <b><Coins size={13} /> {formatMoney(workingClient.base_fee)} base fee</b>
              <b><BriefcaseBusiness size={13} /> {game.active_client.on_hold ? `${game.active_client.name} paused` : `${game.active_client.cases_remaining} to bonus`}</b>
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
            {/* Two buttons with nothing between them read as an arbitrary pair.
                The new run is the primary act and owns the run shape as its
                caption; anything already on the docket is the alternative to
                it, so it sits behind an "or" rather than beside it. */}
            <section className="practice-run" aria-label="Start a run of cases">
              <div className="practice-run-start">
                <button
                  className="primary-button jumbo"
                  onClick={() => startNewRun()}
                  disabled={start.isPending || queueFull}
                >
                  <BriefcaseBusiness /> {start.isPending ? 'Building your run…' : queueFull ? `Queue full (${runs.length}/${queueCap})` : `Start ${sessionSize} cases`} <ArrowRight />
                </button>
                {/* "About", because a reading case is one whole passage and is
                    therefore as long as its passage — five to eight questions
                    where an argument case is six. The shape is drawn when the
                    run is built, so this can only describe the range. */}
                <p className="practice-action-shape">{queueFull
                  ? `Queue full (${runs.length}/${queueCap}). Discard a run below to start another.`
                  : hasRepairs
                    ? `About ${sessionSize} questions, or one whole passage. Some will be repairs from your queue.`
                    : `About ${sessionSize} unseen questions, or one whole passage.`}</p>
              </div>
              {daily && daily.next_action.kind !== 'start_cases' && (
                <div className="practice-run-alt">
                  <span className="practice-run-or">or</span>
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
                </div>
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

      {/* The only explanatory surface on this page, and deliberately the
          sparsest one in the app: the facts needed to act, stated once. The
          daily docket used to sit open in the flow above restating the same
          two counts in a decorated track; it is these four lines. */}
      <details className="practice-guide">
        <summary>Help</summary>
        <div className="practice-guide-body">
          <section>
            <h2>Cases</h2>
            <p>About {sessionSize} questions{hasRepairs ? ', some of them repeats from your review queue' : ''}. The further behind that queue gets, the more of a run it takes back. A reading case is one whole passage, so it runs to whatever length its passage is. Written explanation on each, then coaching.</p>
          </section>
          {daily && daily.deep_brief.priority_count > 0 && (
            <section>
              <h2>Deep brief</h2>
              <p>{daily.deep_brief.priority_count} decision{daily.deep_brief.priority_count === 1 ? '' : 's'} to audit. Correct rule, selected trap, transfer cue.</p>
            </section>
          )}
          <section>
            <h2>Mega-litigation</h2>
            <p>{megaSize} questions, {megaMinutes} minutes, one sitting, no pause. Sets your projected score. Above 70% promotes your firm a tier.</p>
          </section>
          <section>
            <h2>Client</h2>
            <p>{game.active_client.on_hold
              ? `${game.active_client.name} on hold until Reputation recovers. Walk-in fee ${formatMoney(workingClient.base_fee)}.`
              : `${workingClient.name}. ${formatMoney(workingClient.base_fee)} base fee. Retain a better-paying client in the Firm tab.`}</p>
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
