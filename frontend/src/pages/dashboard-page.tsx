import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  BarChart3,
  Brain,
  BriefcaseBusiness,
  ChevronDown,
  Gauge,
  Pause,
  ShieldAlert,
  Target,
  TimerReset,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, LoadingScreen } from '../components'
import { PixelStudyScenery } from '../art/pixel-scenery'
import { useSound } from '../sound'
import { measuredStrategyRows, readStrategyLabSections, StrategySectionReadings } from '../strategy-sections'
import { TrialCalendar } from '../trial-calendar'
import { useRollupInt } from '../motion'
import { InertTabPanels, MegaLitigationGate, PanelFallback, TabStrip } from './shared'
import '../performance.css'
import '../mobile/dashboard-page.css'

// The dashboard's two heaviest additions — an SVG projection chart with its
// confidence band, and the full answer wall with its drill-down — are split
// out of this route's chunk. Both live below the fold behind a tab, so paying
// for them on arrival would be paying for them on every arrival.
const ScoreProjectionPanel = lazy(() =>
  import('../progress-projection').then((module) => ({ default: module.ScoreProjectionPanel })),
)
const AnswerLogPanel = lazy(() =>
  import('../progress-history').then((module) => ({ default: module.AnswerLogPanel })),
)
// The section read-out only renders for an account that has sat a sectioned
// form, so it is split out on the same grounds as the two above.
const ExamSectionReportPanel = lazy(() =>
  import('../exam-report').then((module) => ({ default: module.ExamSectionReportPanel })),
)

/* The four deployed tabs, in their deployed order and under their deployed
   names, then the two panels built since — the projected-score band and the
   answer wall — appended rather than folded into a tab that already answers a
   different question. */
type DashTab = 'skills' | 'methods' | 'mega' | 'evidence' | 'projection' | 'answers'

const DASH_TABS: ReadonlyArray<{ key: DashTab; label: string }> = [
  { key: 'skills', label: 'Skills' },
  { key: 'methods', label: 'Methods' },
  { key: 'mega', label: 'Mega-litigation' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'projection', label: 'Projection' },
  { key: 'answers', label: 'Answers' },
]

/** A `?tab=` value, if it names a real panel. Anything else is ignored. */
const namedTab = (value: string | null): DashTab | null =>
  (DASH_TABS.find((item) => item.key === value)?.key ?? null)


export function PerformancePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const performanceQuery = useQuery({ queryKey: ['performance'], queryFn: api.performance })
  const diagnosticQuery = useQuery({ queryKey: ['diagnostic'], queryFn: api.currentDiagnostic })
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  // The clock starts the moment the form is created, so creation sits behind
  // the gate rather than in front of it.
  const [gateOpen, setGateOpen] = useState(false)
  // Which metric is pinned in the shared reading under the row, and which
  // skill row (if any) is selected for a focus sprint. Cards stay one height;
  // hover previews a reading, a tap pins it so a phone thumb has the same
  // surface a pointer does.
  const [pinnedMetric, setPinnedMetric] = useState<string | null>(null)
  const [hoveredMetric, setHoveredMetric] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  // Which question type the answer log is scoped to. Lifted here so the skill
  // matrix can drill from an aggregate row straight into the answers behind it.
  const [answerLogType, setAnswerLogType] = useState('')
  // `?tab=` opens the dashboard on a named panel, the same way `/firm?tab=` and
  // `/office?officeTier=` already do. Added because the answer wall is behind a
  // tab rather than below the fold, so a plain `/progress` link cannot reach it:
  // anything deep-linking to a student's answers — the deck's review slide, a
  // "see these answers" link in an email — would otherwise land two clicks away
  // on the skills matrix. Unknown values fall back rather than blanking the page.
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<DashTab>(namedTab(searchParams.get('tab')) ?? 'skills')
  useEffect(() => {
    const requested = namedTab(searchParams.get('tab'))
    if (!requested) return
    setTab(requested)
    // And bring it into view. The tab strip sits under the whole summary
    // header — the accuracy ring, the projection rail, the next-up card — so a
    // deep link that only selects the tab leaves the reader at the top of the
    // page looking at something they did not ask for, with the thing they did
    // ask for a screen and a half below. Deferred by a frame because the
    // heavier panels are lazy chunks that have no height yet.
    //
    // Kept up for a beat rather than done once, because one scroll does not
    // hold: on arrival the summary header above the strip has not finished
    // laying out — the projection rail and the trial calendar both grow — and
    // a single `scrollIntoView` measured against the short version leaves the
    // strip drifting back off the top as the page fills in. Measured: one call
    // on the next frame moved the page not at all. So it re-aims each frame
    // until the target stops moving, then stops.
    //
    // Only ever runs for a URL that carries `?tab=`; choosing a tab by hand
    // does not move the page, which would be obnoxious.
    let raf = 0
    let stop = false
    // Any real input ends it immediately. A page that keeps pulling itself back
    // while someone is trying to scroll is worse than one that never moved.
    const yield_ = () => { stop = true }
    // `Date.now`, not `performance.now`: `performance` is the dashboard's own
    // query data in this scope and shadows the global.
    const until = Date.now() + 2000
    // Two ways to finish, and the first one matters more than the deadline: as
    // soon as the strip has held still for a few frames, the page has finished
    // growing and there is nothing left to correct. Holding the scroll for a
    // fixed two seconds regardless meant this quietly outranked anything else
    // that wanted to scroll in that window — opening an answer tile scrolls the
    // drawer into view, and on `?tab=answers` that scroll was being undone
    // frame by frame until the deadline passed.
    let steady = 0
    let last = null as number | null
    const aim = () => {
      if (stop) return
      const strip = document.querySelector('.dash-tabs')
      const top = strip ? Math.round(strip.getBoundingClientRect().top + window.scrollY) : null
      if (top !== null && Math.abs(window.scrollY - top) > 2) window.scrollTo({ top, behavior: 'auto' })
      steady = top !== null && top === last ? steady + 1 : 0
      last = top
      // ~20 frames of a stationary target, a third of a second, which is longer
      // than the gap between the lazy panel mounting and its data landing.
      if (steady < 20 && Date.now() < until) raf = requestAnimationFrame(aim)
    }
    raf = requestAnimationFrame(aim)
    for (const event of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.addEventListener(event, yield_, { passive: true, once: true })
    return () => {
      cancelAnimationFrame(raf)
      for (const event of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.removeEventListener(event, yield_)
    }
  }, [searchParams])
  const selectTab = (next: DashTab) => {
    if (next === tab) return
    void play('tab', { seed: `dash:${next}`, intensity: .24 })
    setTab(next)
  }
  const startDiagnostic = useMutation({
    mutationFn: () => api.startDiagnostic(1),
    onSuccess: ({ session }) => {
      setGateOpen(false)
      void play('file-open', { seed: `diagnostic:${session.id}`, intensity: .64 })
      navigate(`/cases/${session.id}`)
    },
  })
  const startCases = useMutation({
    // No size: the server owns how long a run is. This asked for ten, the run
    // length from before it became six, so the button's own label read
    // "Start 6 cases" and then started a ten-question run.
    mutationFn: () => api.startPractice(),
    onSuccess: ({ session }) => navigate(`/cases/${session.id}`),
  })
  const startFocus = useMutation({
    mutationFn: (questionType: string) => api.startPractice({ size: 3, question_type: questionType }),
    onSuccess: ({ session }) => navigate(`/cases/${session.id}`),
  })
  // Lets the dashboard's own "current run" chip pause the run in place —
  // the same call the run queue on the Cases tab already uses.
  const pauseActive = useMutation({
    mutationFn: (id: string) => api.pauseSession(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['current-session'] }),
  })
  // Read before the early returns below, because it drives a hook. The figure
  // is rendered plainly on first load and only rolls when a refetch actually
  // moves it, which is the only time the movement carries information.
  const measured = performanceQuery.data?.performance
  const rolledAccuracy = useRollupInt((measured?.test_performance ?? measured?.overall)?.accuracy)
  if (performanceQuery.isLoading || diagnosticQuery.isLoading || current.isLoading) return <LoadingScreen label="Loading…" />
  if (performanceQuery.error || diagnosticQuery.error) {
    return (
      <div className="contained page-error">
        <ErrorNotice
          error={performanceQuery.error || diagnosticQuery.error}
          retrying={performanceQuery.isFetching || diagnosticQuery.isFetching}
          onRetry={() => {
            if (performanceQuery.error) void performanceQuery.refetch()
            if (diagnosticQuery.error) void diagnosticQuery.refetch()
          }}
        />
      </div>
    )
  }
  const performance = performanceQuery.data!.performance
  const diagnostic = diagnosticQuery.data!
  const metrics = performance.overall
  const testMetrics = performance.test_performance ?? metrics
  const reviewMetrics = performance.review ?? { due: 0, scheduled: 0, mastered: 0, items: [], recovery_rate: null }
  const confidenceMetrics = performance.confidence ?? { average: null, high_confidence_error_rate: null, sample: 0 }
  const readiness = performance.readiness ?? { status: 'forming' as const, lr_samples: 0, rc_samples: 0, completed_diagnostics: 0 }
  const trend = performance.trend
  const strategyLab = performance.strategy_lab ?? {
    catalog: [],
    results: [],
    leader: null,
    trials_completed: 0,
    strategies_tested: 0,
    intro: 'Some questions come with a suggested approach, then we compare how you did against similar questions without one.',
    empty_state: { title: 'Nothing to compare yet.', body: 'Answer a few cases. Every question arrives with a suggested approach.' },
    catalog_note: 'Official LSAC guidance comes first; the rest are approaches this app tests against your own results.',
    evidence_note: 'This measures your own practice, not your score.',
  }
  // Two readings — best Logical Reasoning approach, best Reading Comprehension
  // approach — in place of the single account-wide leader that used to head
  // this panel. An approach is only ever offered inside its own section, so
  // that one figure was really a Logical Reasoning figure with twice the
  // trials behind it.
  const { sections: strategySections, note: strategySectionsNote } = readStrategyLabSections(performance.strategy_lab)
  const strategySectionsMeasured = strategySections.some((section) => section.trials > 0)
  // The roll-up below the readings, built from the readings rather than from the
  // account-wide totals beside them, so one approach cannot carry two records on
  // one screen.
  const strategyRows = measuredStrategyRows(strategySections)
  const chartPoints = trend.length > 1
    ? trend.map((entry, index) => `${20 + index * (560 / Math.max(1, trend.length - 1))},${160 - entry.accuracy * 1.25}`).join(' ')
    : ''
  const diagnosticSession = diagnostic.session
  // The active-diagnostic slot can hold a blind review, whose size is the
  // number of misses. Only a real form describes the form.
  const diagnosticForm = diagnosticSession?.mode === 'diagnostic' ? diagnosticSession : undefined
  const diagnosticSize = diagnosticForm?.total_items || performance.diagnostic?.form_total || performance.diagnostic?.raw_total || performance.diagnostic?.summary.questions_completed || 75
  const diagnosticMinutes = diagnosticForm?.target_minutes || performance.diagnostic?.time_limit_minutes || 105
  const blindReviewPending = diagnosticSession?.mode === 'blind_review'
    || (diagnosticSession?.mode === 'diagnostic' && diagnosticSession.status === 'completed')
  const megaLitigationLabel = diagnosticSession
    ? diagnosticSession.mode === 'blind_review' ? 'Resume blind review' : diagnosticSession.status === 'completed' ? 'Start blind review' : 'Resume mega-litigation'
    : performance.diagnostic ? 'Sit a new mega-litigation' : 'Sit a mega-litigation'
  const activePractice = current.data?.session
  const sessionSize = current.data?.session_size ?? 6
  const evidenceCopy = {
    baseline: 'Fewer than 10 questions. Provisional.',
    emerging: 'Early patterns only.',
    directional: 'Trend is usable.',
    stable: 'Sample is large enough to be stable.',
  }[metrics.evidence]
  const openPrimaryTraining = () => {
    if (activePractice) navigate(`/cases/${activePractice.id}`)
    else startCases.mutate()
  }
  const openDiagnostic = () => {
    if (diagnosticSession) navigate(`/cases/${diagnosticSession.id}`)
    else setGateOpen(true)
  }
  const focus = performance.focus ?? {
    types: [],
    weak: [],
    section_baselines: {},
    first_encounters: 0,
    half_life_days: 30,
    sitting: { types: [], session_id: null, completed_at: null, baseline_accuracy: null },
    explanation: '',
  }
  const pauseActiveRun = () => {
    if (!activePractice) return
    void play('pause', { id: `dashboard-pause:${activePractice.id}`, seed: activePractice.id, intensity: .45 })
    pauseActive.mutate(activePractice.id)
  }
  const activeRunChip = activePractice && (
    <div className="active-run-chip">
      <BriefcaseBusiness size={16} />
      <span>
        <strong>{activePractice.current_index} of {activePractice.total_items} answered</strong>
        <small>{activePractice.status === 'in_progress' ? 'Running now' : 'Paused'}</small>
      </span>
      {activePractice.status === 'in_progress' && !activePractice.pending_result && (
        <button type="button" className="active-run-pause" disabled={pauseActive.isPending} onClick={pauseActiveRun}>
          <Pause size={13} /> {pauseActive.isPending ? 'Pausing…' : 'Pause'}
        </button>
      )}
    </div>
  )
  const toggleMetric = (key: string) => setPinnedMetric((prev) => (prev === key ? null : key))
  const toggleSkill = (name: string) => setSelectedSkill((prev) => (prev === name ? null : name))
  const activeMetric = hoveredMetric ?? pinnedMetric
  const paceDelta = metrics.average_seconds_delta
  const paceSignal = paceDelta === null ? null : (
    <em className={paceDelta > 0 ? 'metric-trend-up' : paceDelta < 0 ? 'metric-trend-down' : ''}>
      {paceDelta === 0
        ? 'Same pace as previous 20'
        : `${Math.abs(paceDelta)}s ${paceDelta > 0 ? 'faster' : 'slower'} than previous 20`}
    </em>
  )
  const reasoningDelta = metrics.reasoning_delta
  const coachedSignal = reasoningDelta === null ? null : (
    <em className={reasoningDelta > 0 ? 'metric-trend-up' : reasoningDelta < 0 ? 'metric-trend-down' : ''}>
      {reasoningDelta === 0
        ? 'Grades holding steady'
        : `Grades ${reasoningDelta > 0 ? 'up' : 'down'} ${Math.abs(reasoningDelta)} pts`}
    </em>
  )
  const sortedSkillsByVolume = [...performance.skills].sort((a, b) => b.attempts - a.attempts)
  const selectedSkillDetail = selectedSkill ? performance.skills.find((skill) => skill.name === selectedSkill) ?? null : null
  // One line under the row, never inside a card — so a reading cannot shove
  // Performance Line down. The skill matrix and the review CTA live on their
  // own tabs; what belongs here is the sentence that qualifies the number.
  const metricDetail: Record<string, React.ReactNode> = {
    test: sortedSkillsByVolume.length ? (
      <p>
        By type: {sortedSkillsByVolume.slice(0, 5).map((skill) => `${skill.name} ${skill.accuracy}%`).join(' · ')}.
        Full matrix is on Skills.
      </p>
    ) : <p>Answer a few cases to break accuracy out by question type.</p>,
    pace: testMetrics.attempts ? (
      <p>
        {testMetrics.pace_adherence}% of mega-litigation questions landed inside an even split of the clock.
        {paceDelta === null ? (
          ' Answer 20 more to reveal a pace trend.'
        ) : (
          <>
            {' '}
            <em className={paceDelta > 0 ? 'metric-trend-up' : paceDelta < 0 ? 'metric-trend-down' : ''}>
              {paceDelta === 0
                ? 'Same pace as your previous 20 questions.'
                : `${Math.abs(paceDelta)}s ${paceDelta > 0 ? 'faster' : 'slower'} per question than your previous 20.`}
            </em>
          </>
        )}
      </p>
    ) : <p>Sit a mega-litigation to establish an average split.</p>,
    coached: performance.coached_practice.attempts ? (
      <p>
        {performance.coached_practice.reasoning === null
          ? 'No explanations graded yet.'
          : `${performance.coached_practice.reasoning}% mean explanation grade across ${performance.coached_practice.attempts} coached case${performance.coached_practice.attempts === 1 ? '' : 's'}.`}
        {reasoningDelta === null ? ' Grade 20 more to reveal a trend.' : null}
      </p>
    ) : <p>Run a set of cases to see explanation grades.</p>,
    review: (
      <p>
        {reviewMetrics.desired_retention
          ? `Slipping means the chance of getting it right again is below ${Math.round(reviewMetrics.desired_retention * 100)}%. Weakest first — no calendar gate.`
          : 'Repairs are mixed through your runs, not stacked at the front.'}
      </p>
    ),
    confidence: confidenceMetrics.sample ? (
      <p>
        Average self-rated confidence: {confidenceMetrics.average ?? '—'} / 5.
        A high-confidence miss is a wrong answer you rated 4 or 5.
      </p>
    ) : <p>Rate confidence on graded answers to see this.</p>,
  }
  const idleMetricDetail = testMetrics.attempts ? metricDetail.pace : (
    <p className="performance-metrics-idle">Hover or tap a measure for the reading behind it.</p>
  )
  // One metric card, used at every width. The page used to carry a second,
  // phone-only copy of the same five measures; the tab strip below removed the
  // reason for it, so there is one control surface per measure again.
  const renderMetricCard = (key: string, icon: React.ReactNode, label: string, value: React.ReactNode, isEmpty: boolean, caption: React.ReactNode, signal?: React.ReactNode) => (
    <article
      className={`metric-card${pinnedMetric === key || hoveredMetric === key ? ' is-selected' : ''}`}
      key={key}
      onMouseEnter={() => setHoveredMetric(key)}
    >
      <button
        type="button"
        className="metric-card-trigger"
        aria-pressed={pinnedMetric === key}
        aria-controls="performance-metrics-detail"
        onClick={() => toggleMetric(key)}
        onFocus={() => setHoveredMetric(key)}
      >
        <div>{icon}<span>{label}</span></div>
        <strong className={isEmpty ? 'stat-empty' : ''}>{value}</strong>
        <small>
          <span>{caption}</span>
          {signal}
        </small>
      </button>
    </article>
  )
  // The band, restated as one line for the summary. The full panel — with the
  // ruler, the trend and what widens the band — is the Projection tab.
  const projectedBand = performance.projection?.available
    ? `${performance.projection.lower_bound}–${performance.projection.upper_bound}`
    : '—'

  return (
    <div className="performance-page page-wrap">
      {/* Above the tab strip is everything a student needs without choosing
          anything: where they stand, what to do next, and the two buttons that
          do it. Every other reading is one tab away rather than one more
          screen of scrolling. */}
      <section className="dash-summary" aria-label="Training summary">
        <PixelStudyScenery variant="training" className="dash-summary-scenery" />
        <h1 className="dash-title">Dashboard</h1>
        <div className="dash-signal">
          <div
            className={`index-ring${testMetrics.attempts ? '' : ' index-ring-empty'}`}
            style={{ '--index': `${testMetrics.accuracy * 3.6}deg` } as React.CSSProperties}
            aria-label={`${testMetrics.accuracy} percent mega-litigation accuracy`}
          >
            <span>{testMetrics.attempts ? <strong>{rolledAccuracy}</strong> : <Gauge className="index-ring-glyph" />}<small>{testMetrics.attempts ? '%' : 'NO DATA'}</small></span>
          </div>
          <div className="dash-signal-copy">
            <small>Mega-litigation accuracy</small>
            <p>{testMetrics.attempts
              ? `${testMetrics.attempts} measured question${testMetrics.attempts === 1 ? '' : 's'} · ${readiness.status === 'ready' ? 'comparison ready' : 'evidence forming'}`
              : 'Sit a mega-litigation — a full practice LSAT — to set your baseline.'}</p>
            {/* What used to be a separate evidence strip across the page. It
                qualifies the figure beside it, so it belongs on the same line
                as the figure rather than in a band of its own. */}
            <em>
              <span className="dash-evidence-band"><Activity size={12} /> {metrics.evidence}</span>
              {metrics.attempts} question{metrics.attempts === 1 ? '' : 's'} observed — {evidenceCopy}
            </em>
          </div>
          {/* Four readings stated plainly. Each one opens up somewhere behind
              the tabs; none of them is a control here. */}
          <div className="dash-tiles">
            <div><span>Projected score</span><strong className={projectedBand === '—' ? 'stat-empty' : ''}>{projectedBand}</strong></div>
            <div><span>Average split</span><strong className={testMetrics.attempts ? '' : 'stat-empty'}>{testMetrics.attempts ? `${Math.floor(testMetrics.average_seconds / 60)}:${String(testMetrics.average_seconds % 60).padStart(2, '0')}` : '—'}</strong></div>
            <div><span>Review recovery</span><strong className={reviewMetrics.recovery_rate === null ? 'stat-empty' : ''}>{reviewMetrics.recovery_rate === null ? '—' : `${reviewMetrics.recovery_rate}%`}</strong></div>
            <div><span>Slipping</span><strong>{reviewMetrics.due}</strong></div>
          </div>
        </div>
        {/* The deadline the learner already told onboarding about, worked back
            into a weekly caseload. It sits between the readings and the
            actions because that is what it is: the reason the actions matter
            today rather than eventually. One line unless opened. */}
        {performance.trial && <TrialCalendar plan={performance.trial} />}
        {/* The weakest-link signal used to be a panel of its own further down
            the page. It is the one reading that names an action, so it sits
            with the actions instead. */}
        <div className="dash-next">
          <Target size={17} />
          <div>
            <span>NEXT UP</span>
            <strong>{performance.recommendation?.skill ?? 'Establish your baseline'}</strong>
            <small>{performance.recommendation
              ? `${performance.recommendation.accuracy}% accuracy · recommended because it currently has the ${performance.recommendation.reason}.`
              : 'Sit a mega-litigation to find the first weakness.'}</small>
          </div>
          {performance.recommendation && (
            <button
              className="focus-sprint-button"
              disabled={startFocus.isPending || Boolean(activePractice)}
              onClick={() => startFocus.mutate(performance.recommendation!.skill)}
            >
              {activePractice ? 'Finish current run first' : startFocus.isPending ? 'Building focus sprint…' : 'Run 3 focused questions'} <ArrowRight size={14} />
            </button>
          )}
        </div>
        {/* What practice is currently weighted toward, and the reason it would
            change. It used to be a card of its own below the skill matrix,
            which meant scrolling past the whole table to find out. It is one
            line of status, so it reads as one line under the recommendation
            it qualifies. */}
        <p className="dash-focus-note">
          {focus.explanation ? focus.explanation : ''}
          {/* The baseline each weak type was measured against, rather than the
              old "your own N% on that form" — the comparison is no longer
              against one sitting. It is the rest of the section rather than
              the whole of it, so the sentence is a comparison the student
              could make by hand. */}
          {focus.weak.length
            ? ` ${focus.weak[0].type} is running ${focus.weak[0].gap} points under your ${focus.weak[0].section_baseline}% on the rest of ${focus.weak[0].section}.`
            : ''}
        </p>
        {activeRunChip}
        <div className="dash-actions">
          <button className="primary-button" onClick={openPrimaryTraining} disabled={startCases.isPending}><TimerReset /> {activePractice ? 'Resume current run' : `Start ${sessionSize} cases`} <ArrowRight /></button>
          <button className="secondary-button" onClick={openDiagnostic} disabled={startDiagnostic.isPending}><Target /> {megaLitigationLabel}</button>
        </div>
      </section>

      <TabStrip id="dash" className="dash-tabs" label="Training analysis" tabs={DASH_TABS} active={tab} onSelect={selectTab} />
      <InertTabPanels id="dash" tabs={DASH_TABS} active={tab} />
      {/* Keyed on the tab so switching replaces the panel rather than
          re-rendering it in place: it is what replays the arrival, and what
          keeps one tab's internal state from leaking into the next. */}
      <div key={tab} className="dash-panel" id={`dash-panel-${tab}`} role="tabpanel" aria-labelledby={`dash-tab-${tab}`} tabIndex={0}>

        {tab === 'skills' && (
          <section className="skill-table-panel">
              <div className="panel-heading"><div><span>SKILL MATRIX</span><h2>Accuracy by question type</h2></div><Brain /></div>
              {performance.skills.length ? (
                <>
                  <div className="skill-table">
                    <div className="skill-row header"><span>Question type</span><span>Sample</span><span>Accuracy</span><span>Pace</span><span>Reasoning</span></div>
                    {performance.skills.map((skill) => (
                      <button
                        type="button"
                        className={`skill-row skill-row-clickable${selectedSkill === skill.name ? ' is-selected' : ''}`}
                        key={skill.name}
                        aria-pressed={selectedSkill === skill.name}
                        onClick={() => toggleSkill(skill.name)}
                      >
                        <strong>{skill.name}</strong><span>{skill.attempts}</span><span><i style={{ width: `${skill.accuracy}%` }} />{skill.accuracy}%</span><span>{skill.pace_adherence}%</span><span>{skill.reasoning === null ? '—' : `${skill.reasoning}%`}</span>
                        <ChevronDown className="skill-row-chevron" size={13} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                  {selectedSkillDetail && (
                    <div className="skill-detail">
                      <div>
                        <strong>{selectedSkillDetail.name}</strong>
                        <p>{selectedSkillDetail.attempts} attempt{selectedSkillDetail.attempts === 1 ? '' : 's'} · {selectedSkillDetail.pace_adherence}% inside target time · {selectedSkillDetail.reasoning === null ? 'no graded explanations yet' : `${selectedSkillDetail.reasoning}% mean explanation grade`}</p>
                      </div>
                      <div className="skill-detail-actions">
                        <button
                          type="button"
                          className="focus-sprint-button"
                          disabled={startFocus.isPending || Boolean(activePractice)}
                          onClick={() => startFocus.mutate(selectedSkillDetail.name)}
                        >
                          {activePractice ? 'Finish current run first' : startFocus.isPending ? 'Building focus sprint…' : `Run 3 focused ${selectedSkillDetail.name} questions`} <ArrowRight size={15} />
                        </button>
                        {/* The other half of the drill-down: from the aggregate
                            row to the individual answers that produced it. The
                            answers are a tab of their own now, so this opens
                            that tab already scoped rather than scrolling. */}
                        <button
                          type="button"
                          className="skill-detail-log-button"
                          onClick={() => {
                            setAnswerLogType(selectedSkillDetail.name)
                            selectTab('answers')
                          }}
                        >
                          See these {selectedSkillDetail.attempts} answer{selectedSkillDetail.attempts === 1 ? '' : 's'} <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : <div className="empty-skills"><Brain /><p>No data yet. Sit a mega-litigation to build the matrix.</p></div>}
          </section>
        )}

        {tab === 'methods' && (
          <section className="strategy-lab-panel" aria-labelledby="strategy-lab-title">
            <div className="panel-heading strategy-lab-heading">
              <div><span>APPROACHES</span><h2 id="strategy-lab-title">What works for you</h2></div>
              <Brain />
            </div>
            <p className="strategy-lab-intro">{strategyLab.intro}</p>

            {strategySectionsMeasured ? (
              <StrategySectionReadings sections={strategySections} note={strategySectionsNote} />
            ) : (
              <div className="strategy-empty-state"><Activity /><div><strong>{strategyLab.empty_state.title}</strong><p>{strategyLab.empty_state.body}</p></div></div>
            )}

            {strategyRows.length > 0 && (
              <details className="strategy-results-detail">
                <summary>Every approach you&apos;ve tried <span>{strategyLab.strategies_tested} tried · {strategyLab.trials_completed} questions measured</span></summary>
                <div className="strategy-results-table">
                  <div className="header"><span>Approach</span><span>With it / without it</span><span>Difference</span><span>Where it stands</span></div>
                  {strategyRows.map((strategy) => (
                    <div key={`${strategy.measured_in}:${strategy.key}`}>
                      <strong>{strategy.plain_title}<small>{strategy.short_label}</small></strong>
                      <span>{strategy.with_headline} / {strategy.without_headline}<small>{strategy.sample} with · {strategy.control_sample} without</small></span>
                      <span>{strategy.difference_headline}</span>
                      <span className={`strategy-evidence-badge ${strategy.verdict}`}>{strategy.verdict_label}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <details className="strategy-catalog-detail">
              <summary>All 14 approaches and where they come from</summary>
              <p>{strategyLab.catalog_note}</p>
              <div className="strategy-catalog-grid">
                {strategyLab.catalog.map((strategy) => <article key={strategy.key}><span>{strategy.section === 'Logical Reasoning' ? 'LR' : 'RC'}</span><h3>{strategy.plain_title}</h3><em>{strategy.title}</em><p>{strategy.plain_line}</p><ol>{strategy.steps.map((step) => <li key={step}>{step}</li>)}</ol><small>Best for: {strategy.best_for}</small><div>{strategy.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}</a>)}</div></article>)}
              </div>
            </details>
            <p className="strategy-lab-caveat"><ShieldAlert /> {strategyLab.evidence_note}</p>
          </section>
        )}

        {tab === 'mega' && (
          <>
          {/* The student's score is the subject of this panel, so it is the
              first thing in it — but only once there is one. Before the first
              sitting there is no result to lead with and the invitation is the
              subject instead, which is the composition this panel was
              originally drawn for and then kept after a score existed. */}
          <section className={`diagnostic-lab${performance.diagnostic ? ' has-result' : ''}`}>
            <div className="panel-heading">
              <div><span>MEGA-LITIGATION</span><h2>{performance.diagnostic ? 'Your baseline is set.' : 'A full practice LSAT.'}</h2></div>
              <Target />
            </div>
            <div className="diagnostic-lab-body">
              {performance.diagnostic && (
                <div className="diagnostic-score">
                  <small>LAST FORM SCORE</small>
                  <strong>{performance.diagnostic.raw_correct ?? performance.diagnostic.summary.correct}/{performance.diagnostic.form_total ?? performance.diagnostic.raw_total}</strong>
                  <span>{performance.diagnostic.form_accuracy ?? performance.diagnostic.summary.accuracy}% of the whole form · {performance.diagnostic.budget_used_percent}% of the clock spent</span>
                  <p>{performance.diagnostic.promotion ? `Cleared: your firm was promoted to ${performance.diagnostic.promotion.name}.` : performance.diagnostic.projection_note}</p>
                </div>
              )}
              <div className="diagnostic-copy">
                <p>{diagnosticSize} LR and RC questions administered as three separately timed 35-minute sections with a 10-minute intermission, results held to the end.</p>
                {/* The four terms describe what sitting one does, so they are
                    the action's terms and are read with it rather than as a
                    strip floating between two paragraphs. */}
                <div className="diagnostic-next">
                  <span>WHAT A SITTING DOES</span>
                  <ul><li>Above 70% promotes your firm a tier</li><li>Prerequisite upgrades unlocked free</li><li>Sets what your case runs practice</li><li>Pays nothing, prompts nothing, coaches nothing</li></ul>
                  {blindReviewPending && <p className="diagnostic-review-cue">A sat form is waiting on its blind review: every question you missed reopens, untimed and with the answers still hidden.</p>}
                  <button className="primary-button" onClick={openDiagnostic} disabled={startDiagnostic.isPending}>{diagnosticSession ? diagnosticSession.mode === 'blind_review' ? 'Return to the blind review' : diagnosticSession.status === 'completed' ? 'Start blind review' : 'Return to the mega-litigation' : performance.diagnostic ? 'Sit a new mega-litigation' : 'Sit a mega-litigation'} <ArrowRight /></button>
                </div>
                <p className="diagnostic-crosslink">Past sittings are on the Practice tab, under Mega-litigation.</p>
              </div>
              {!performance.diagnostic && (
                <div className="diagnostic-score diagnostic-score-empty">
                  <small>{blindReviewPending ? 'ANSWERS SEALED' : diagnosticSession ? 'FORM IN PROGRESS' : 'NO FORM SAT YET'}</small>
                  <Gauge className="diagnostic-score-glyph" />
                  <span>{diagnosticSize} questions · about {diagnosticMinutes} min</span>
                  <p>No scaled score until a form has a validated conversion.</p>
                </div>
              )}
            </div>
          </section>
          {/* Only for a form actually administered in sections. A sitting from
              before them had no bell and no halves, so there is nothing here to
              back-fill and a blank panel would imply there was. */}
          {performance.diagnostic?.exam && (
            <Suspense fallback={<PanelFallback label="Loading the section read-out…" />}>
              <ExamSectionReportPanel report={performance.diagnostic.exam} />
            </Suspense>
          )}
          </>
        )}

        {tab === 'evidence' && (
          <>
            <section
              className="performance-metrics"
              aria-label="Core LSAT performance measures"
              onMouseLeave={() => setHoveredMetric(null)}
            >
              {renderMetricCard('test', <Target />, 'MEGA-LITIGATION PERFORMANCE', testMetrics.attempts ? `${testMetrics.accuracy}%` : '—', !testMetrics.attempts, `${testMetrics.attempts} measured attempts · ${testMetrics.pace_adherence}% inside an even split of the clock`)}
              {renderMetricCard('pace', <TimerReset />, 'AVERAGE SPLIT', testMetrics.attempts ? `${Math.floor(testMetrics.average_seconds / 60)}:${String(testMetrics.average_seconds % 60).padStart(2, '0')}` : '—', !testMetrics.attempts, 'Mega-litigation work only', paceSignal)}
              {renderMetricCard('coached', <Brain />, 'COACHED PRACTICE', performance.coached_practice.attempts ? `${performance.coached_practice.accuracy}%` : '—', !performance.coached_practice.attempts, <>{performance.coached_practice.attempts} case{performance.coached_practice.attempts === 1 ? '' : 's'} · {performance.coached_practice.reasoning === null ? 'no grades yet' : `${performance.coached_practice.reasoning}% mean explanation`}</>, coachedSignal)}
              {renderMetricCard('review', <Brain />, 'REVIEW RECOVERY', reviewMetrics.recovery_rate === null ? '—' : `${reviewMetrics.recovery_rate}%`, reviewMetrics.recovery_rate === null, `${reviewMetrics.due} slipping · ${reviewMetrics.scheduled} holding · ${reviewMetrics.mastered} mastered`)}
              {renderMetricCard('confidence', <Gauge />, 'CONFIDENCE ERRORS', confidenceMetrics.high_confidence_error_rate === null ? '—' : `${confidenceMetrics.high_confidence_error_rate}%`, confidenceMetrics.high_confidence_error_rate === null, `High-confidence misses across ${confidenceMetrics.sample} rated answers`)}
              <div className="performance-metrics-detail" id="performance-metrics-detail" aria-live="polite">
                {activeMetric ? metricDetail[activeMetric] : idleMetricDetail}
              </div>
            </section>

            <section className="trend-panel">
              <div className="panel-heading"><div><span>PERFORMANCE LINE</span><h2>Accuracy by completed run</h2></div><BarChart3 /></div>
              {trend.length > 1 ? (
                <svg viewBox="0 0 600 180" role="img" aria-label="Accuracy trend across recent sessions">
                  {[35,70,105,140].map((y) => <line key={y} x1="20" x2="580" y1={y} y2={y} />)}
                  <polyline points={chartPoints} />
                  {trend.map((entry, index) => <circle key={entry.id} cx={20 + index * (560 / Math.max(1, trend.length - 1))} cy={160 - entry.accuracy * 1.25} r="5"><title>{entry.accuracy}% · {entry.kind}</title></circle>)}
                </svg>
              ) : <div className="empty-trend"><Activity /><strong>Complete two runs to see a trend.</strong></div>}
            </section>

            <section className="evidence-class-panel" aria-label="Evidence coverage">
              <div className="panel-heading"><div><span>COMPARISON READINESS</span><h2>{readiness.status === 'ready' ? 'Enough evidence to compare periods' : 'Still building a sample'}</h2></div><ShieldAlert /></div>
              <div className="readiness-grid">
                <div><strong>{readiness.lr_samples}</strong><span>Timed LR</span><small>40 recommended</small></div>
                <div><strong>{readiness.rc_samples}</strong><span>Timed RC</span><small>20 recommended</small></div>
                <div><strong>{readiness.completed_diagnostics}</strong><span>Mega-litigations</span><small>1 recommended</small></div>
              </div>
              <details><summary>How evidence is separated</summary><p>The mega-litigation is the headline estimate of test performance. Coached practice is reported separately and still counts in the projected score, at just over half the weight of a mega-litigation answer. Repeated questions do not count toward the headline.</p></details>
            </section>
          </>
        )}

        {tab === 'projection' && (
          <Suspense fallback={<PanelFallback label="Loading…" />}>
            <ScoreProjectionPanel projection={performance.projection} />
          </Suspense>
        )}

        {tab === 'answers' && (
          <Suspense fallback={<PanelFallback label="Loading your answer history…" />}>
            <AnswerLogPanel questionType={answerLogType} onQuestionTypeChange={setAnswerLogType} />
          </Suspense>
        )}
      </div>

      {gateOpen && <MegaLitigationGate questions={diagnosticSize} minutes={diagnosticMinutes} pending={startDiagnostic.isPending} onConfirm={() => startDiagnostic.mutate()} onCancel={() => setGateOpen(false)} />}

      {(startDiagnostic.error || startCases.error || startFocus.error) && <ErrorNotice error={startDiagnostic.error || startCases.error || startFocus.error} />}
    </div>
  )
}
