import { type KeyboardEvent, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Coins,
  Eye,
  FileSearch,
  Flame,
  Gauge,
  Gavel,
  Handshake,
  HeartHandshake,
  Lamp,
  Lock,
  Pause,
  Play,
  Scale,
  ScrollText,
  ShieldAlert,
  Shirt,
  Sparkles,
  Star,
  Target,
  TimerReset,
  TrendingUp,
  Trophy,
  UserRound,
  UsersRound,
  Wrench,
} from 'lucide-react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api } from './api'
import { Brand, ErrorNotice, formatMoney, LoadingScreen, OfficeEventPopup, PauseButton, QuestionFlow, useRestoredChrome } from './components'
import { ClientPortrait, EmpireWorldMap, ExplorableOffice, MiniAvatar, OfficeScene, PixelAssetArtwork, StaffRoster } from './game-art'
import { PixelStudyScenery } from './art/pixel-scenery'
import { openEpilogue, openPendingChapter } from './narrative'
import { RivalWarRoom } from './rival-war-room'
import { SoundControls, useAmbientMusic, useSound } from './sound'
import { readStrategyLabSections, StrategySectionReadings } from './strategy-sections'
import { TrialCalendar } from './trial-calendar'
import { WardrobePanel } from './wardrobe'
import { MOTION_TIMING, useRollupInt } from './motion'
import type { CharacterGender, GameAsset, GameClient, GameResponse, GameState, StoryQuest, StudySession } from './types'
import './performance.css'


function useGame() {
  return useQuery({ queryKey: ['game'], queryFn: api.game })
}

// The dashboard's two heaviest additions — an SVG projection chart with its
// confidence band, and the full answer wall with its drill-down — are split
// out of the main chunk. Both live below the fold on a page that is not the
// app's landing route, so paying for them on first load would be paying for
// them on every load. See the standing load-performance priority.
const ScoreProjectionPanel = lazy(() =>
  import('./progress-projection').then((module) => ({ default: module.ScoreProjectionPanel })),
)
const AnswerLogPanel = lazy(() =>
  import('./progress-history').then((module) => ({ default: module.AnswerLogPanel })),
)
// Same reasoning for the Practice tab's mega-litigation home: it carries a
// paginated history feed and a full results view, both below the fold.
const MegaLitigationPanel = lazy(() =>
  import('./mega-litigation').then((module) => ({ default: module.MegaLitigationPanel })),
)
// Same chunk, so the post-form results page explains a withheld tier with the
// same component the Practice tab uses, without pulling the chunk into main.
const WithheldPromotionNotice = lazy(() =>
  import('./mega-litigation').then((module) => ({ default: module.WithheldPromotionNotice })),
)

function PanelFallback({ label }: { label: string }) {
  return <div className="progress-panel-fallback" role="status">{label}</div>
}


/**
 * One tab strip, shared by the Dashboard and the Practice tab.
 *
 * Both pages had grown into a single column that had to be scrolled end to
 * end to find anything, so both now sort their readings behind the same
 * control. It is the same construction the Firm page already uses: a real
 * tablist with roving tabindex, arrow/Home/End navigation, and focus that
 * follows the selection, so the keyboard reaches every panel the pointer can.
 */
function TabStrip<Key extends string>({
  id,
  className,
  label,
  tabs,
  active,
  onSelect,
}: {
  id: string
  className: string
  label: string
  tabs: ReadonlyArray<{ key: Key; label: string }>
  active: Key
  onSelect: (key: Key) => void
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, current: Key) => {
    const index = tabs.findIndex((tab) => tab.key === current)
    let target: number | null = null
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') target = 0
    if (event.key === 'End') target = tabs.length - 1
    if (target === null) return
    event.preventDefault()
    const key = tabs[target].key
    onSelect(key)
    window.requestAnimationFrame(() => document.getElementById(`${id}-tab-${key}`)?.focus())
  }
  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          id={`${id}-tab-${tab.key}`}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          aria-controls={`${id}-panel-${tab.key}`}
          tabIndex={active === tab.key ? 0 : -1}
          className={active === tab.key ? 'active' : ''}
          onKeyDown={(event) => move(event, tab.key)}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}


/**
 * Only the open tab's contents are mounted — that is what keeps each panel's
 * chunk off the first load — so every other tab's `aria-controls` would point
 * at nothing. These empty hidden panels are what it points at instead.
 */
function InertTabPanels<Key extends string>({
  id,
  tabs,
  active,
}: {
  id: string
  tabs: ReadonlyArray<{ key: Key; label: string }>
  active: Key
}) {
  return (
    <>
      {tabs.filter((tab) => tab.key !== active).map((tab) => (
        <div key={tab.key} id={`${id}-panel-${tab.key}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab.key}`} hidden />
      ))}
    </>
  )
}


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

/* Two ways of practising, so two tabs. The mega-litigation used to be a slab
   appended below the case controls, which read as an unrelated advertisement
   rather than as the other thing you can sit down and do here. */
type PracticeTab = 'cases' | 'mega'

const PRACTICE_TABS: ReadonlyArray<{ key: PracticeTab; label: string }> = [
  { key: 'cases', label: 'Cases' },
  { key: 'mega', label: 'Mega-litigation' },
]


function MegaLitigationGate({
  questions,
  minutes,
  pending,
  onConfirm,
  onCancel,
}: {
  questions: number
  minutes: number
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  // Escape backs out. The scrim itself is inert: a click-to-dismiss div is not
  // reachable by keyboard, and this gate is the one screen that must be read.
  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [onCancel])

  return (
    <div className="mega-gate-scrim" role="dialog" aria-modal="true" aria-labelledby="mega-gate-title">
      <section className="mega-gate">
        <span>MEGA-LITIGATION</span>
        <h2 id="mega-gate-title">This is basically a full practice LSAT.</h2>
        <p>
          {questions} questions across three blocks, sat the way the real test is sat. Start it only when you have the
          whole {minutes} minutes free.
        </p>
        <ul>
          <li>
            <Clock3 size={17} />
            <div><strong>One clock for the whole form — about {minutes} minutes.</strong><span>Spend it however you like across the {questions} questions. It does not stop between them.</span></div>
          </li>
          <li>
            <ShieldAlert size={17} />
            <div><strong>One sitting. There is no pause and no save.</strong><span>The clock keeps running if you close the tab, and whatever is unanswered when it hits zero is submitted blank.</span></div>
          </li>
          <li>
            <Trophy size={17} />
            <div><strong>Above 70% and your firm moves up a tier.</strong><span>Every prerequisite upgrade for that tier is unlocked with it, at no cost.</span></div>
          </li>
          <li>
            <Target size={17} />
            <div><strong>Nothing here pays, prompts, or coaches you.</strong><span>That is what makes it the honest read — and what it finds is what your case runs practice next.</span></div>
          </li>
        </ul>
        <div className="mega-gate-actions">
          <button type="button" className="mega-gate-cancel" onClick={onCancel}>Not right now</button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={pending}>
            {pending ? 'Filing…' : "I have the time — start"} <ArrowRight />
          </button>
        </div>
      </section>
    </div>
  )
}


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
  // Which metric card (if any) has its breakdown open, and which skill row
  // (if any) is selected for a focus sprint. Click-driven rather than
  // hover-driven so the same affordance works with a mouse or a thumb.
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  // Which question type the answer log is scoped to. Lifted here so the skill
  // matrix can drill from an aggregate row straight into the answers behind it.
  const [answerLogType, setAnswerLogType] = useState('')
  const [tab, setTab] = useState<DashTab>('skills')
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
    mutationFn: () => api.startPractice({ size: 10 }),
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
  if (performanceQuery.isLoading || diagnosticQuery.isLoading || current.isLoading) return <LoadingScreen label="Measuring your training line…" />
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
  const chartPoints = trend.length > 1
    ? trend.map((entry, index) => `${20 + index * (560 / Math.max(1, trend.length - 1))},${160 - entry.accuracy * 1.25}`).join(' ')
    : ''
  const diagnosticSession = diagnostic.session
  const diagnosticSize = diagnosticSession?.total_items || performance.diagnostic?.raw_total || performance.diagnostic?.summary.questions_completed || 75
  const diagnosticMinutes = diagnosticSession?.target_minutes || 105
  const activePractice = current.data?.session
  const evidenceCopy = {
    baseline: 'Fewer than 10 questions. Treat every signal as provisional.',
    emerging: 'Enough work to identify early patterns, but not stable mastery.',
    directional: 'The trend is useful for training decisions.',
    stable: 'Your sample is large enough for a stable performance signal.',
  }[metrics.evidence]
  const openPrimaryTraining = () => {
    if (activePractice) navigate(`/cases/${activePractice.id}`)
    else startCases.mutate()
  }
  const openDiagnostic = () => {
    if (diagnosticSession) navigate(`/cases/${diagnosticSession.id}`)
    else setGateOpen(true)
  }
  const focus = performance.focus ?? { types: [], session_id: null, completed_at: null, baseline_accuracy: null, explanation: '' }
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
        <small>{activePractice.status === 'in_progress' ? 'Running now' : 'Paused'} · click continue to jump back in</small>
      </span>
      {activePractice.status === 'in_progress' && !activePractice.pending_result && (
        <button type="button" className="active-run-pause" disabled={pauseActive.isPending} onClick={pauseActiveRun}>
          <Pause size={13} /> {pauseActive.isPending ? 'Pausing…' : 'Pause'}
        </button>
      )}
    </div>
  )
  const toggleMetric = (key: string) => setExpandedMetric((prev) => (prev === key ? null : key))
  const toggleSkill = (name: string) => setSelectedSkill((prev) => (prev === name ? null : name))
  const sortedSkillsByVolume = [...performance.skills].sort((a, b) => b.attempts - a.attempts)
  const selectedSkillDetail = selectedSkill ? performance.skills.find((skill) => skill.name === selectedSkill) ?? null : null
  // Every card explains a different number, so its "what does this mean"
  // reveal draws from a different slice of the same snapshot rather than
  // repeating the headline figure back at the student.
  const metricDetail: Record<string, React.ReactNode> = {
    test: sortedSkillsByVolume.length ? (
      <>
        <p>Accuracy by question type, across every graded rep so far.</p>
        <div className="metric-breakdown">
          {sortedSkillsByVolume.slice(0, 5).map((skill) => (
            <button
              type="button"
              key={skill.name}
              className={`metric-breakdown-row${selectedSkill === skill.name ? ' is-highlighted' : ''}`}
              onClick={() => toggleSkill(skill.name)}
            >
              <span>{skill.name}</span>
              <i style={{ width: `${skill.accuracy}%` }} />
              <b>{skill.accuracy}%</b>
            </button>
          ))}
        </div>
        <small>Click a row to pull it up in the skill matrix below.</small>
      </>
    ) : <p>Answer a few cases to break accuracy out by question type.</p>,
    pace: testMetrics.attempts ? (
      <>
        <p>{testMetrics.pace_adherence}% of mega-litigation questions landed inside an even split of the clock.</p>
        {metrics.average_seconds_delta !== null ? (
          <p className={metrics.average_seconds_delta > 0 ? 'metric-trend-up' : metrics.average_seconds_delta < 0 ? 'metric-trend-down' : ''}>
            {metrics.average_seconds_delta === 0
              ? 'Same pace as your previous 20 questions.'
              : `${Math.abs(metrics.average_seconds_delta)}s ${metrics.average_seconds_delta > 0 ? 'faster' : 'slower'} per question than your previous 20.`}
          </p>
        ) : <small>Answer 20 more questions to reveal a pace trend.</small>}
      </>
    ) : <p>Sit a mega-litigation to establish an average split.</p>,
    coached: performance.coached_practice.attempts ? (
      <>
        <p>{performance.coached_practice.reasoning === null ? 'No explanations graded yet.' : `${performance.coached_practice.reasoning}% mean explanation grade across ${performance.coached_practice.attempts} coached case${performance.coached_practice.attempts === 1 ? '' : 's'}.`}</p>
        {metrics.reasoning_delta !== null ? (
          <p className={metrics.reasoning_delta > 0 ? 'metric-trend-up' : metrics.reasoning_delta < 0 ? 'metric-trend-down' : ''}>
            {metrics.reasoning_delta === 0 ? 'Explanation grades are holding steady.' : `Explanation grades are ${metrics.reasoning_delta > 0 ? 'up' : 'down'} ${Math.abs(metrics.reasoning_delta)} pts over your last 20 graded answers.`}
          </p>
        ) : <small>Grade 20 more explanations to reveal a trend.</small>}
      </>
    ) : <p>Coached cases are graded on every written explanation — run a set to seed this.</p>,
    review: (
      <>
        <div className="metric-breakdown metric-breakdown-review">
          <div><span>Slipping</span><i style={{ width: `${Math.min(100, reviewMetrics.due * 10)}%` }} /><b>{reviewMetrics.due}</b></div>
          <div><span>Holding</span><i style={{ width: `${Math.min(100, reviewMetrics.scheduled * 5)}%` }} /><b>{reviewMetrics.scheduled}</b></div>
          <div><span>Mastered</span><i style={{ width: `${Math.min(100, reviewMetrics.mastered * 3)}%` }} /><b>{reviewMetrics.mastered}</b></div>
        </div>
        {/* "Slipping" rather than "due": nothing here is gated on a date. The
            scheduler ranks by how likely you still are to recall each question
            and hands back the weakest whenever you sit down. */}
        <p>
          {reviewMetrics.desired_retention
            ? `A question counts as slipping once your chance of getting it right again drops below ${Math.round(reviewMetrics.desired_retention * 100)}%. No calendar gate — start a run whenever you like and the weakest material comes first.`
            : 'Repairs are mixed through your runs rather than stacked at the front.'}
        </p>
        {reviewMetrics.due > 0 ? (
          <button type="button" className="metric-detail-action" onClick={openPrimaryTraining} disabled={startCases.isPending}>
            Start a run — repairs folded in <ArrowRight size={14} />
          </button>
        ) : <p>Nothing is slipping right now. Keep working unseen questions.</p>}
      </>
    ),
    confidence: confidenceMetrics.sample ? (
      <>
        <p>Average self-rated confidence: {confidenceMetrics.average ?? '—'} / 5 across {confidenceMetrics.sample} rated answer{confidenceMetrics.sample === 1 ? '' : 's'}.</p>
        <p>A high-confidence miss is a wrong answer you rated 4 or 5 on — the errors most worth reviewing, since the mistake wasn't a guess.</p>
      </>
    ) : <p>Rate your confidence on graded answers to unlock this signal.</p>,
  }
  // One metric card, used at every width. The page used to carry a second,
  // phone-only copy of the same five measures; the tab strip below removed the
  // reason for it, so there is one control surface per measure again.
  const renderMetricCard = (key: string, icon: React.ReactNode, label: string, value: React.ReactNode, isEmpty: boolean, caption: React.ReactNode) => (
    <article className={`metric-card${expandedMetric === key ? ' is-expanded' : ''}`} key={key}>
      <button type="button" className="metric-card-trigger" aria-expanded={expandedMetric === key} onClick={() => toggleMetric(key)}>
        <div>{icon}<span>{label}</span><ChevronDown className="metric-card-chevron" size={13} /></div>
        <strong className={isEmpty ? 'stat-empty' : ''}>{value}</strong>
        <small>{caption}</small>
      </button>
      {expandedMetric === key && <div className="metric-detail">{metricDetail[key]}</div>}
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
              : 'Sit a mega-litigation — a full practice LSAT — to establish your line.'}</p>
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
              : 'A mega-litigation will identify the first weakness. No weakness is inferred without evidence.'}</small>
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
        {activeRunChip}
        <div className="dash-actions">
          <button className="primary-button" onClick={openPrimaryTraining} disabled={startCases.isPending}><TimerReset /> {activePractice ? 'Resume current run' : 'Start 10 cases'} <ArrowRight /></button>
          <button className="secondary-button" onClick={openDiagnostic} disabled={startDiagnostic.isPending}><Target /> {diagnosticSession ? 'Resume mega-litigation' : performance.diagnostic ? 'Sit a new mega-litigation' : 'Sit a mega-litigation'}</button>
        </div>
      </section>

      <TabStrip id="dash" className="dash-tabs" label="Training analysis" tabs={DASH_TABS} active={tab} onSelect={selectTab} />
      <InertTabPanels id="dash" tabs={DASH_TABS} active={tab} />
      {/* Keyed on the tab so switching replaces the panel rather than
          re-rendering it in place: it is what replays the arrival, and what
          keeps one tab's internal state from leaking into the next. */}
      <div key={tab} className="dash-panel" id={`dash-panel-${tab}`} role="tabpanel" aria-labelledby={`dash-tab-${tab}`} tabIndex={0}>

        {tab === 'skills' && (
          <>
            <section className="skill-table-panel">
              <div className="panel-heading"><div><span>SKILL MATRIX</span><h2>Where the points are actually moving</h2></div><Brain /></div>
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
                      </button>
                    ))}
                  </div>
                  <p className="skill-table-hint">Select a row to pull it up here and run a focused sprint on it.</p>
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
              ) : <div className="empty-skills"><Brain /><p>No skill claims yet. A mega-litigation creates the first evidence-backed matrix.</p></div>}
            </section>

            <section className="focus-panel" aria-label="What practice is weighted toward">
              <div className="panel-heading"><div><span>PRACTICE FOCUS</span><h2>{focus.types.length ? focus.types.join(' · ') : 'Weighted evenly across the test'}</h2></div><Target /></div>
              <p>{focus.explanation}</p>
              {focus.baseline_accuracy !== null && <small>Measured against your own {focus.baseline_accuracy}% on that form, not a fixed bar.</small>}
            </section>
          </>
        )}

        {tab === 'methods' && (
          <section className="strategy-lab-panel" aria-labelledby="strategy-lab-title">
            <div className="panel-heading strategy-lab-heading">
              <div><span>WHAT&apos;S WORKING FOR YOU</span><h2 id="strategy-lab-title">The approaches that actually help you.</h2></div>
              <Brain />
            </div>
            <p className="strategy-lab-intro">{strategyLab.intro}</p>

            {strategySectionsMeasured ? (
              <StrategySectionReadings sections={strategySections} note={strategySectionsNote} />
            ) : (
              <div className="strategy-empty-state"><Activity /><div><strong>{strategyLab.empty_state.title}</strong><p>{strategyLab.empty_state.body}</p></div></div>
            )}

            {strategyLab.results.length > 0 && (
              <details className="strategy-results-detail">
                <summary>Every approach you&apos;ve tried <span>{strategyLab.strategies_tested} tried · {strategyLab.trials_completed} questions measured</span></summary>
                <div className="strategy-results-table">
                  <div className="header"><span>Approach</span><span>With it / without it</span><span>Difference</span><span>Where it stands</span></div>
                  {strategyLab.results.map((strategy) => (
                    <div key={strategy.key}>
                      <strong>{strategy.plain_title}<small>{strategy.section === 'Logical Reasoning' ? 'LR' : 'RC'}</small></strong>
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
          <section className="diagnostic-lab">
            <div className="diagnostic-copy">
              <span className="eyebrow">MEGA-LITIGATION</span>
              <h2>{performance.diagnostic ? 'Your performance anchor is set.' : 'Basically a full practice LSAT.'}</h2>
              <p>{diagnosticSize} LR and RC questions in three blocks under a single {diagnosticMinutes}-minute clock, with results held to the end. It takes one sitting and there is no pause. Take one whenever you like — nothing in the firm waits on it.</p>
              <ul><li>Above 70% promotes your firm a tier</li><li>Prerequisite upgrades unlocked free</li><li>Sets what your case runs practice</li><li>Pays nothing, prompts nothing, coaches nothing</li></ul>
              <button className="primary-button" onClick={openDiagnostic} disabled={startDiagnostic.isPending}>{diagnosticSession ? 'Return to the mega-litigation' : performance.diagnostic ? 'Sit a new mega-litigation' : 'Sit a mega-litigation'} <ArrowRight /></button>
              <p className="diagnostic-crosslink">Every sitting you have already taken, question by question, lives on the Practice tab under Mega-litigation.</p>
            </div>
            <div className={`diagnostic-score${performance.diagnostic ? '' : ' diagnostic-score-empty'}`}>
              {performance.diagnostic ? <><small>LAST FORM SCORE</small><strong>{performance.diagnostic.raw_correct ?? performance.diagnostic.summary.correct}/{performance.diagnostic.form_total ?? performance.diagnostic.raw_total}</strong><span>{performance.diagnostic.form_accuracy ?? performance.diagnostic.summary.accuracy}% of the whole form · {performance.diagnostic.budget_used_percent}% of the clock spent</span><p>{performance.diagnostic.promotion ? `Cleared: your firm was promoted to ${performance.diagnostic.promotion.name}.` : performance.diagnostic.projection_note}</p></> : <><small>{diagnosticSession ? 'FORM IN PROGRESS' : 'NO FORM SAT YET'}</small><Gauge className="diagnostic-score-glyph" /><span>{diagnosticSize} questions · about {diagnosticMinutes} min</span><p>Scaled-score projections remain withheld until a form has a validated conversion.</p></>}
            </div>
          </section>
        )}

        {tab === 'evidence' && (
          <>
            <section className="performance-metrics" aria-label="Core LSAT performance measures">
              {renderMetricCard('test', <Target />, 'MEGA-LITIGATION PERFORMANCE', testMetrics.attempts ? `${testMetrics.accuracy}%` : '—', !testMetrics.attempts, `${testMetrics.attempts} measured attempts · ${testMetrics.pace_adherence}% inside an even split of the clock`)}
              {renderMetricCard('pace', <TimerReset />, 'AVERAGE SPLIT', testMetrics.attempts ? `${Math.floor(testMetrics.average_seconds / 60)}:${String(testMetrics.average_seconds % 60).padStart(2, '0')}` : '—', !testMetrics.attempts, 'Mega-litigation work only')}
              {renderMetricCard('coached', <Brain />, 'COACHED PRACTICE', performance.coached_practice.attempts ? `${performance.coached_practice.accuracy}%` : '—', !performance.coached_practice.attempts, <>{performance.coached_practice.attempts} case{performance.coached_practice.attempts === 1 ? '' : 's'} · {performance.coached_practice.reasoning === null ? 'no grades yet' : `${performance.coached_practice.reasoning}% mean explanation`}</>)}
              {renderMetricCard('review', <Brain />, 'REVIEW RECOVERY', reviewMetrics.recovery_rate === null ? '—' : `${reviewMetrics.recovery_rate}%`, reviewMetrics.recovery_rate === null, `${reviewMetrics.due} slipping · ${reviewMetrics.scheduled} holding · ${reviewMetrics.mastered} mastered`)}
              {renderMetricCard('confidence', <Gauge />, 'CONFIDENCE ERRORS', confidenceMetrics.high_confidence_error_rate === null ? '—' : `${confidenceMetrics.high_confidence_error_rate}%`, confidenceMetrics.high_confidence_error_rate === null, `High-confidence misses across ${confidenceMetrics.sample} rated answers`)}
            </section>

            <section className="trend-panel">
              <div className="panel-heading"><div><span>PERFORMANCE LINE</span><h2>Accuracy by completed run</h2></div><BarChart3 /></div>
              {trend.length > 1 ? (
                <svg viewBox="0 0 600 180" role="img" aria-label="Accuracy trend across recent sessions">
                  {[35,70,105,140].map((y) => <line key={y} x1="20" x2="580" y1={y} y2={y} />)}
                  <polyline points={chartPoints} />
                  {trend.map((entry, index) => <circle key={entry.id} cx={20 + index * (560 / Math.max(1, trend.length - 1))} cy={160 - entry.accuracy * 1.25} r="5"><title>{entry.accuracy}% · {entry.kind}</title></circle>)}
                </svg>
              ) : <div className="empty-trend"><Activity /><strong>Complete two runs to reveal a trend.</strong><p>One result is a baseline, not improvement.</p></div>}
            </section>

            <section className="evidence-class-panel" aria-label="Evidence coverage">
              <div className="panel-heading"><div><span>COMPARISON READINESS</span><h2>{readiness.status === 'ready' ? 'Enough independent evidence to compare periods' : 'Still building a defensible sample'}</h2></div><ShieldAlert /></div>
              <div className="readiness-grid">
                <div><strong>{readiness.lr_samples}</strong><span>Timed LR</span><small>40 recommended</small></div>
                <div><strong>{readiness.rc_samples}</strong><span>Timed RC</span><small>20 recommended</small></div>
                <div><strong>{readiness.completed_diagnostics}</strong><span>Mega-litigations</span><small>1 recommended</small></div>
              </div>
              <details><summary>How evidence is separated</summary><p>A mega-litigation is a full practice LSAT, and the only thing that estimates test performance: it pays nothing, prompts nothing, and coaches nothing. Everything else is coached practice, reported separately. Repeated questions never inflate the headline.</p></details>
            </section>
          </>
        )}

        {tab === 'projection' && (
          <Suspense fallback={<PanelFallback label="Working out your projected score…" />}>
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


function storeGame(queryClient: ReturnType<typeof useQueryClient>, game: GameState) {
  queryClient.setQueryData<GameResponse>(['game'], (current) => ({ game, pending_reviews: current?.pending_reviews ?? [] }))
}


function storeAuthenticatedUser(queryClient: ReturnType<typeof useQueryClient>, data: Awaited<ReturnType<typeof api.me>>) {
  queryClient.clear()
  queryClient.setQueryData(['me'], data)
}


function effectiveClient(game: GameState): GameClient {
  return game.catalog.clients.find((client) => client.key === game.active_client.effective_key) ?? game.active_client
}


export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [authError, setAuthError] = useState<unknown>(null)
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig })
  const existing = useQuery({ queryKey: ['me'], queryFn: api.me })

  useEffect(() => {
    if (existing.data?.user) navigate(existing.data.user.next_route, { replace: true })
  }, [existing.data, navigate])

  useEffect(() => {
    if (!config.data?.google_client_id) return
    const finishLogin = async (credential: string) => {
      try {
        const data = await api.googleLogin(credential)
        storeAuthenticatedUser(queryClient, data)
        void play('navigate', { seed: 'google-login', intensity: .5 })
        navigate(data.user.next_route)
      } catch (error) {
        setAuthError(error)
      }
    }
    const render = () => {
      if (!window.google || !buttonRef.current) return
      window.google.accounts.id.initialize({
        client_id: config.data!.google_client_id!,
        callback: ({ credential }) => void finishLogin(credential),
      })
      buttonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline', size: 'large', shape: 'pill', width: 320, text: 'continue_with',
      })
    }
    if (window.google) render()
    else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = render
      document.head.appendChild(script)
      return () => script.remove()
    }
  }, [config.data?.google_client_id, navigate, play, queryClient])

  const devLogin = useMutation({
    mutationFn: api.devLogin,
    onSuccess: (data) => {
      storeAuthenticatedUser(queryClient, data)
      void play('navigate', { seed: 'dev-login', intensity: .5 })
      navigate(data.user.next_route)
    },
  })

  return (
    <div className="login-page">
      <header className="login-nav"><Brand light /><span>Serious LSAT practice. Speed you can prove.</span><SoundControls className="login-sound-controls" compact /></header>
      <section className="login-hero">
        <div className="login-copy">
          <div className="eyebrow gold">DIAGNOSE · SPEEDRUN · REVIEW · IMPROVE</div>
          <h1>Beat your baseline.<br /><em>Keep the reasoning.</em></h1>
          <p>Every LSAT question is measured for accuracy, explanation quality, and clean pace. The firm is the wrapper; improvement is the game.</p>
          <div className="feature-list">
            <span><Scale /> Verified answers, never AI guesses</span>
            <span><BrainIcon /> Reasoning feedback after every case</span>
            <span><TrendingUp /> Evidence-backed progress, not vanity streaks</span>
            <span><Building2 /> A living office that grows with you</span>
          </div>
        </div>
        <OfficeScene previewTier={3} gender="female" className="login-scene" />
      </section>
      <aside className="login-panel-wrap">
        <div className="login-panel">
          <div className="crest"><Scale /></div>
          <span className="eyebrow">THE BAR IS OPEN</span>
          <h2>Enter your firm</h2>
          <p>Your cases, cash, reputation, character, office, and every acquisition stay with your account.</p>
          <div ref={buttonRef} className="google-button-slot" />
          {!config.isLoading && !config.data?.google_client_id && (
            <div className="config-note">Google sign-in needs <code>GOOGLE_CLIENT_ID</code>.</div>
          )}
          {config.data?.dev_auth_enabled && (
            <button className="secondary-button full" onClick={() => devLogin.mutate()} disabled={devLogin.isPending}>
              <Play size={17} /> {devLogin.isPending ? 'Opening the office…' : 'Enter local development firm'}
            </button>
          )}
          {(authError || devLogin.error) && <ErrorNotice error={authError || devLogin.error} />}
          <small>No energy. No loot boxes. No paid answer power.</small>
        </div>
      </aside>
    </div>
  )
}


function BrainIcon() {
  return <Sparkles />
}


export function OnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const gameQuery = useGame()
  const [step, setStep] = useState<'intent' | 'identity'>('intent')
  const [targetScore, setTargetScore] = useState('')
  const [targetTestDate, setTargetTestDate] = useState('')
  const [gender, setGender] = useState<CharacterGender>('female')
  const [lawyerName, setLawyerName] = useState('')
  const [firmName, setFirmName] = useState('')

  useEffect(() => {
    if (!lawyerName && me.data?.user.display_name) setLawyerName(me.data.user.display_name)
  }, [lawyerName, me.data?.user.display_name])

  const saveIntent = useMutation({
    mutationFn: (body: { target_score: number | null; target_test_date: string | null }) => api.updateMe(body),
    onSuccess: (data) => {
      queryClient.setQueryData<{ user: typeof data.user }>(['me'], data)
      setStep('identity')
    },
  })

  const create = useMutation({
    mutationFn: () => api.createGame({ lawyer_name: lawyerName, firm_name: firmName, character_gender: gender }),
    onSuccess: (data) => {
      queryClient.setQueryData<GameResponse>(['game'], data)
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      void play('event', { id: `firm-opened:${data.game?.id ?? firmName}`, seed: firmName, intensity: .85 })
      navigate('/progress', { replace: true })
    },
  })

  if (me.isLoading || gameQuery.isLoading) return <LoadingScreen />
  if (gameQuery.data?.game) return <Navigate to="/progress" replace />

  if (step === 'intent') {
    const parsedScore = targetScore.trim() ? Number(targetScore) : null
    const scoreInvalid = parsedScore !== null && (Number.isNaN(parsedScore) || parsedScore < 120 || parsedScore > 180)
    return (
      <div className="onboarding-page">
        <section className="onboarding-scene-wrap">
          <OfficeScene gender={gender} previewTier={0} />
          {/* The caption sets the scene and the panel beside it does the asking
              — the same division as step 02. It used to ask a competing
              question of its own, so the student met two headlines at once. */}
          <div className="opening-caption">
            <span>BEFORE WE BEGIN</span>
            <h2>An empty desk.<br />A blank set of files.</h2>
            <p>How much firm you see around them is up to you.</p>
          </div>
        </section>
        <section className="onboarding-panel">
          <span className="step-indicator">YOUR GOAL · 01</span>
          <h1>Tell us your target,<br />or skip straight in.</h1>
          <p>Students aiming for a high score close to test day often want a leaner view—fewer distractions, just the questions. Everyone else gets the full firm-building experience by default. Either way, you can flip this later from the menu.</p>
          <div className="name-fields">
            <label>
              Target score (120–180)
              <input
                type="number"
                inputMode="numeric"
                min={120}
                max={180}
                value={targetScore}
                onChange={(event) => setTargetScore(event.target.value)}
                placeholder="e.g. 170"
              />
            </label>
            <label>
              Test date (optional)
              <input
                type="date"
                value={targetTestDate}
                onChange={(event) => setTargetTestDate(event.target.value)}
              />
            </label>
          </div>
          {scoreInvalid && <p className="field-error">Enter a target score between 120 and 180, or leave it blank.</p>}
          {saveIntent.error && <ErrorNotice error={saveIntent.error} />}
          <button
            className="primary-button onboarding-cta"
            disabled={scoreInvalid || saveIntent.isPending}
            onClick={() =>
              saveIntent.mutate({
                target_score: parsedScore,
                target_test_date: targetTestDate.trim() || null,
              })
            }
          >
            {saveIntent.isPending ? 'Saving…' : <>Continue <ArrowRight /></>}
          </button>
          <small>
            <button type="button" className="link-button" onClick={() => setStep('identity')}>
              Skip — I'll decide later
            </button>
          </small>
        </section>
      </div>
    )
  }

  return (
    <div className="onboarding-page">
      <section className="onboarding-scene-wrap">
        <OfficeScene gender={gender} previewTier={0} />
        <div className="opening-caption">
          <span>DAY ONE</span>
          <h2>One flickering lamp.<br />One client at the door.</h2>
          <p>The rest is yours to build.</p>
        </div>
      </section>
      <section className="onboarding-panel">
        <span className="step-indicator">YOUR ORIGIN · 02</span>
        <h1>Name the lawyer<br />who changes this room.</h1>
        <p>Choose your character presentation. Both have identical progression, outfits, and abilities—and you can change it later.</p>
        <div className="character-choice" role="radiogroup" aria-label="Character presentation">
          {(['female', 'male'] as CharacterGender[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={gender === value}
              className={gender === value ? 'selected' : ''}
              onClick={() => {
                if (gender !== value) void play('select', { seed: value, intensity: .35 })
                setGender(value)
              }}
            >
              <MiniAvatar gender={value} />
              <span>{value === 'female' ? 'Female character' : 'Male character'}</span>
              {gender === value && <Check size={18} />}
            </button>
          ))}
        </div>
        <div className="name-fields">
          <label>Lawyer name<input value={lawyerName} onChange={(event) => setLawyerName(event.target.value)} maxLength={50} placeholder="Alex Morgan" /></label>
          <label>Firm name<input value={firmName} onChange={(event) => setFirmName(event.target.value)} maxLength={80} placeholder="Morgan Legal" /></label>
        </div>
        {create.error && <ErrorNotice error={create.error} />}
        <button className="primary-button onboarding-cta" disabled={lawyerName.trim().length < 2 || firmName.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Hanging the sign…' : <>Open the doors <ArrowRight /></>}
        </button>
        <small>You begin with a $250 client retainer and Reputation 50.</small>
      </section>
    </div>
  )
}


export function OfficePage() {
  const navigate = useNavigate()
  const { play } = useSound()
  useAmbientMusic('office')
  const [mobileBriefOpen, setMobileBriefOpen] = useState(false)
  const [wardrobeOpen, setWardrobeOpen] = useState(false)
  const gameQuery = useGame()
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const start = useMutation({
    mutationFn: () => api.startPractice({ size: 3 }),
    onSuccess: ({ session }) => {
      void play('file-open', { id: `office-case-open:${session.id}`, seed: session.id, intensity: .58 })
      navigate(`/cases/${session.id}`)
    },
  })
  if (gameQuery.isLoading || current.isLoading) return <LoadingScreen />
  if (gameQuery.error) return <div className="contained"><ErrorNotice error={gameQuery.error} /></div>
  const game = gameQuery.data!.game!
  const workingClient = effectiveClient(game)
  const active = current.data?.session
  const activeItem = active?.pending_item ?? active?.current_item
  const activeCase = active ? {
    sessionId: active.id,
    clientKey: activeItem?.case_terms?.client_key ?? game.active_client.effective_key,
    clientName: activeItem?.case_terms?.client_name ?? workingClient.name,
    baseFee: activeItem?.case_terms?.base_fee ?? workingClient.base_fee,
  } : null
  const milestone = game.next_milestone
  const milestoneProgress = milestone ? Math.min(100, Math.round(game.cash / Math.max(1, milestone.cost) * 100)) : 100

  const openCase = () => active ? navigate(`/cases/${active.id}`) : start.mutate()

  return (
    <div className="office-page office-game-page">
      {current.error && (
        <div className="partial-load-notice">
          <ErrorNotice error={current.error} retrying={current.isFetching} onRetry={() => void current.refetch()} />
          <p>Your active case could not be checked, so the office may not show work already in progress.</p>
        </div>
      )}
      <div className="office-mobile-scene-status" aria-hidden="true">
        <small>HQ {game.office_tier + 1} · {game.reputation_band.name.toUpperCase()}</small>
        <strong>{game.office.name}</strong>
      </div>
      <button
        type="button"
        className="office-mobile-brief-toggle"
        aria-expanded={mobileBriefOpen}
        aria-controls="office-mobile-brief-sheet"
        onClick={() => {
          void play(mobileBriefOpen ? 'paper' : 'ledger', { seed: 'office-mobile-brief', intensity: .24 })
          setMobileBriefOpen((open) => !open)
        }}
      >
        <BriefcaseBusiness size={16} />
        <span>Today</span>
      </button>
      {mobileBriefOpen && (
        <aside className="office-mobile-brief-sheet" id="office-mobile-brief-sheet" role="dialog" aria-modal="true" aria-labelledby="office-mobile-brief-title">
          <header>
            <div><small>OFFICE BRIEF</small><h2 id="office-mobile-brief-title">Today at the firm</h2></div>
            <button type="button" aria-label="Close office brief" onClick={() => setMobileBriefOpen(false)}>×</button>
          </header>
          <button type="button" className="office-mobile-current-case" onClick={() => { setMobileBriefOpen(false); openCase() }}>
            <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
            <span><small>{active ? 'CASE IN PROGRESS' : 'ACTIVE CLIENT'}</small><strong>{workingClient.name}</strong><em>{game.active_client.cases_remaining} files · {formatMoney(workingClient.base_fee)} base</em></span>
            <b>{active ? 'Resume' : 'Start'} <ArrowRight size={15} /></b>
          </button>
          <div className="office-mobile-brief-metrics">
            <span><small>TRAINING</small><strong>{game.daily.cases_completed}/10</strong><em>questions today</em></span>
            <span><small>ACCURACY</small><strong>{game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0}%</strong><em>{game.total_cases} measured</em></span>
            <span><small>LEASE</small><strong>{game.upkeep.completed ? 'Closed' : formatMoney(game.upkeep.daily_rent, true)}</strong><em>{game.upkeep.completed ? 'charter complete' : 'per day'}</em></span>
          </div>
          <div className="office-mobile-next-office">
            <span><small>NEXT OFFICE</small><strong>{milestone?.name ?? 'Empire complete'}</strong></span>
            {milestone && <div><i style={{ width: `${milestoneProgress}%` }} /><small>{formatMoney(Math.max(0, milestone.cost - game.cash), true)} to go</small></div>}
          </div>
          <nav aria-label="Office actions">
            <button type="button" onClick={() => { setMobileBriefOpen(false); navigate('/progress') }}><BarChart3 size={17} />Progress</button>
            <button type="button" onClick={() => { setMobileBriefOpen(false); navigate('/firm') }}><Wrench size={17} />Build</button>
            <button type="button" onClick={() => { setMobileBriefOpen(false); navigate('/story') }}><ScrollText size={17} />Caseboard</button>
            {/* A phone hides the office portrait, and with it the plaque the
                wardrobe normally hangs under, so the brief carries the way in. */}
            <button type="button" className="wardrobe-brief-action" onClick={() => { setMobileBriefOpen(false); setWardrobeOpen(true) }}><Shirt size={17} />Wardrobe</button>
          </nav>
        </aside>
      )}
      {wardrobeOpen && <WardrobePanel game={game} onClose={() => setWardrobeOpen(false)} />}
      <section className="office-command-bar">
        <div>
          <span className="pixel-kicker">{game.reputation_band.name.toUpperCase()} COUNSEL · HQ LEVEL {game.office_tier}</span>
          <h1>{new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}, {game.lawyer_name.split(' ')[0]}. <em>The office is alive.</em></h1>
        </div>
        <div className="command-stats">
          <span><small>FIRM VALUE</small><strong>{formatMoney(game.firm_valuation, true)}</strong><TrendingUp /></span>
          <span><small>ACTIVE CLIENT</small><strong>{workingClient.name}</strong><BriefcaseBusiness /></span>
          <span className={game.upkeep.rent_arrears ? 'has-arrears' : ''}><small>{game.upkeep.completed ? 'LEASE RETIRED' : 'DAILY LEASE'}</small><strong>{game.upkeep.completed ? 'Charter complete' : `${formatMoney(game.upkeep.daily_rent, true)} / day`}</strong><CircleDollarSign /></span>
        </div>
      </section>

      <section className="office-world-shell">
        <ExplorableOffice
          game={game}
          activeCase={activeCase}
          onCase={openCase}
          onFirm={() => navigate('/firm')}
          onEmpire={() => navigate('/map')}
          onStory={() => navigate('/story')}
        />

        <aside className={`office-upkeep-strip ${game.upkeep.completed ? 'is-complete' : ''} ${game.upkeep.rent_arrears ? 'has-arrears' : ''}`}>
          <div className="office-upkeep-heading">
            <CircleDollarSign />
            <span><small>OFFICE LEASE</small><strong>{game.upkeep.completed ? 'Obligation retired' : 'Operating account'}</strong></span>
          </div>
          {game.upkeep.completed ? (
            <>
              <p>The final charter is closed. Rent and inactivity loss no longer accrue.</p>
              {game.story.epilogue && (
                <button type="button" className="office-epilogue-button" onClick={openEpilogue}>
                  <Trophy size={15} /> Read the final record
                </button>
              )}
            </>
          ) : (
            <div className="office-upkeep-terms">
              <span><small>ACTIVE RATE</small><strong>{formatMoney(game.upkeep.daily_rent)} / day</strong></span>
              <span><small>AWAY AFTER 24H</small><strong>{formatMoney(game.upkeep.offline_daily_rent)} / day</strong></span>
              <span><small>AFTER 48H AWAY</small><strong>−{game.upkeep.reputation_decay_daily} Rep / day</strong></span>
              <span className={game.upkeep.rent_arrears ? 'is-due' : ''}><small>OUTSTANDING</small><strong>{game.upkeep.rent_arrears ? formatMoney(game.upkeep.rent_arrears) : 'Current'}</strong></span>
            </div>
          )}
          <small className="office-upkeep-note">{game.upkeep.completed ? game.upkeep.completion_requirement.label : `Settles on activity · unpaid balance capped at ${formatMoney(game.upkeep.arrears_cap)}`}</small>
        </aside>

        <aside className="office-milestone-strip">
          <div className="office-milestone-copy">
            <span>NEXT OFFICE</span>
            <h2>{milestone?.name ?? 'Empire complete'}</h2>
          </div>
          {milestone ? (
            <>
              <div className="office-milestone-progress">
                <div className="pixel-meter"><i style={{ width: `${milestoneProgress}%` }} /></div>
                <p><b>{formatMoney(game.cash, true)}</b> / {formatMoney(milestone.cost, true)}</p>
                <small>{milestone.reputation > game.reputation ? `LOCKED · NEED ${milestone.reputation} REP` : `${formatMoney(Math.max(0, milestone.cost - game.cash), true)} TO GO`}</small>
              </div>
            </>
          ) : <p>Every skyline starts here.</p>}
          <button onClick={() => { void play('ledger', { seed: 'milestone', intensity: .45 }); navigate('/firm') }}>OPEN BUILD MENU <ArrowRight /></button>
        </aside>
      </section>

      <OfficeEventPopup game={game} />

      <section className="office-gamebar">
        <article className="client-quest-card">
          <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
          <div><span>ACTIVE CONTRACT</span><h3>{workingClient.name}</h3><p>{game.active_client.on_hold ? 'Original contract on hold' : `${game.active_client.cases_remaining} files remaining`} · {formatMoney(workingClient.base_fee)} base</p></div>
          <button onClick={() => {
            if (active) void play('resume', { seed: active.id, intensity: .55 })
            openCase()
          }}>{active ? 'RESUME' : 'TAKE CASE'} <ArrowRight /></button>
        </article>

        <article className="training-focus-card">
          <div><span>TODAY’S TRAINING BLOCK</span><h3>{game.daily.cases_completed} / 10 QUESTIONS</h3><p>Volume builds recognition. Reviewed reasoning makes the volume count.</p></div>
          <button onClick={openCase}>{active ? 'RESUME' : 'START'} <ArrowRight /></button>
        </article>

        <article className="training-evidence-card">
          <div><span>LEARNING EVIDENCE</span><strong>{game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0}%</strong><small>{game.total_correct} correct across {game.total_cases} questions</small></div>
          <button onClick={() => navigate('/progress')}>VIEW PROGRESS</button>
        </article>
      </section>
      {start.error && <ErrorNotice error={start.error} />}
    </div>
  )
}


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


function formatReviewTime(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}


function CompletedSessionReview({ sessionId }: { sessionId: string }) {
  useRestoredChrome()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selectedPosition, setSelectedPosition] = useState(0)
  const [priorityOnly, setPriorityOnly] = useState(true)
  const reviewQuery = useQuery({ queryKey: ['session-review', sessionId], queryFn: () => api.sessionReview(sessionId) })
  const queueQuery = useQuery({ queryKey: ['review-queue'], queryFn: api.reviewQueue })
  const review = reviewQuery.data?.review
  const priorityRank = { high_confidence_miss: 0, miss: 1, low_confidence_correct: 2, slow_correct: 3 } as const
  const priorityItems = (review?.items ?? [])
    .filter((item) => item.priority_reason)
    .sort((a, b) => priorityRank[a.priority_reason!] - priorityRank[b.priority_reason!])
  const visibleItems = priorityOnly && priorityItems.length ? priorityItems : review?.items ?? []
  const selected = visibleItems.find((item) => item.position === selectedPosition) ?? visibleItems[0]
  const coaching = useQuery({
    queryKey: ['coaching', selected?.attempt_id],
    queryFn: () => api.coaching(selected!.attempt_id),
    enabled: Boolean(selected?.attempt_id),
    retry: false,
  })
  const dueReviews = queueQuery.data?.review_queue.due ?? 0
  const startRepair = useMutation({
    // Due repairs are folded into an ordinary run now; there is no repair mode.
    mutationFn: () => api.startPractice({ size: Math.min(5, Math.max(1, dueReviews)) }),
    onSuccess: ({ session }) => {
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      navigate(`/cases/${session.id}`)
    },
  })
  const finishBrief = useMutation({
    mutationFn: () => api.acknowledgeSessionReview(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-docket'] })
      navigate('/cases')
    },
  })

  useEffect(() => {
    if (!review?.items.length) return
    const priority = [...review.items]
      .filter((item) => item.priority_reason)
      .sort((a, b) => priorityRank[a.priority_reason!] - priorityRank[b.priority_reason!])[0]
    setSelectedPosition(priority?.position ?? review.items[0].position)
  }, [review?.session.id])

  if (reviewQuery.isLoading) return <LoadingScreen label="Preparing your answer audit…" />
  if (reviewQuery.error || !review) return <div className="contained"><ErrorNotice error={reviewQuery.error || new Error('This completed run could not be reviewed.')} /></div>

  const summary = review.summary
  const isDiagnostic = review.session.mode === 'diagnostic'
  const highConfidenceErrors = review.items.filter((item) => !item.is_correct && (item.confidence ?? 0) >= 4).length
  // Every completed practice run gets a brief. Gating this on a style that no
  // longer exists would leave the brief permanently unacknowledgeable, which
  // would strand the daily docket at "brief ready" forever.
  const isBrief = !isDiagnostic
  const correctChoice = selected?.question.choices.find((choice) => choice.label === selected.correct_label)
  const selectedChoice = selected?.question.choices.find((choice) => choice.label === selected.selected_label)
  const rationale = coaching.data?.coaching

  return (
    <div className="session-review-page page-wrap">
      <section className="review-summary-hero">
        <div>
          <span className="eyebrow">{isDiagnostic ? 'MEGA-LITIGATION COMPLETE' : 'DEEP BRIEF'}</span>
          <h1>{priorityItems.length ? 'Brief the decisions that can change your next run.' : 'Clean run. Confirm what held.'}</h1>
          <p>{isDiagnostic ? 'A full practice LSAT pays no fees and moves no streak — only the tier promotion above 70%. Open any question for a concise rationale; only mistakes and uncertainty enter repair.' : 'Results are separated from firm currency and rank. Open any question for a concise rationale; only mistakes and uncertainty enter repair.'}</p>
        </div>
        <div className="review-score"><strong>{isDiagnostic && summary.form_accuracy !== undefined ? summary.form_accuracy : summary.accuracy}%</strong><span>{summary.correct} of {summary.questions_completed} correct</span><small>{summary.elapsed_minutes} minutes</small></div>
      </section>

      {summary.promotion && (
        <section className="promotion-banner" aria-label="Firm promotion">
          <div><span>THE FIRM MOVED UP</span><strong>{summary.promotion.name}</strong><p>Clearing 70% of the form promoted you to tier {summary.promotion.tier}. Reputation was raised to {summary.promotion.reputation_after}.</p></div>
          {summary.promotion.granted_assets.length > 0 && <ul>{summary.promotion.granted_assets.map((asset) => <li key={asset.key}>{asset.name}</li>)}</ul>}
          <small>{summary.promotion.granted_assets.length ? `${summary.promotion.granted_assets.length} prerequisite ${summary.promotion.granted_assets.length === 1 ? 'upgrade was' : 'upgrades were'} unlocked free — ${formatMoney(summary.promotion.waived_cost)} waived.` : 'You already owned every prerequisite for this tier.'}</small>
        </section>
      )}

      {/* The mirror image of the banner above: cleared the bar, no tier. The
          server only sends `promotion_status` on that branch, and the results
          page is the first place the student looks for it. */}
      {summary.promotion_status && !summary.promotion_status.available && (
        <Suspense fallback={null}>
          <WithheldPromotionNotice status={summary.promotion_status} />
        </Suspense>
      )}

      <section className="review-signal-row" aria-label="Run signals">
        <article><Target /><span>Accuracy</span><strong>{summary.accuracy}%</strong></article>
        <article><Clock3 /><span>Elapsed</span><strong>{summary.elapsed_minutes}m</strong></article>
        <article><ShieldAlert /><span>Confident misses</span><strong>{highConfidenceErrors}</strong></article>
        <article><Brain /><span>Priority repairs</span><strong>{priorityItems.length}</strong></article>
      </section>

      <section className="answer-audit-shell">
        <aside className="answer-audit-index" aria-label="Questions in this run">
          <div><span>{isBrief ? 'DEEP BRIEF' : 'ANSWER AUDIT'}</span><small>{priorityOnly && priorityItems.length ? `${priorityItems.length} priority decisions` : `All ${review.items.length} questions`}</small></div>
          {priorityItems.length > 0 && <div className="brief-filter" role="group" aria-label="Brief scope"><button className={priorityOnly ? 'active' : ''} onClick={() => setPriorityOnly(true)}>Priority</button><button className={!priorityOnly ? 'active' : ''} onClick={() => setPriorityOnly(false)}>All {review.items.length}</button></div>}
          <div className="answer-audit-list">
            {visibleItems.map((item) => (
              <button key={item.attempt_id} className={`${item.position === selected?.position ? 'active' : ''} ${item.is_correct ? 'correct' : 'repair'}`} onClick={() => setSelectedPosition(item.position)}>
                <span>{item.is_correct ? <Check size={15} /> : <ShieldAlert size={15} />} Q{item.position + 1}</span>
                <small>{item.question.section === 'Logical Reasoning' ? 'LR' : 'RC'} · {formatReviewTime(item.elapsed_ms)}</small>
                <b>{item.priority_reason === 'high_confidence_miss' ? 'CONFIDENT MISS' : item.priority_reason === 'low_confidence_correct' ? 'UNCERTAIN' : item.priority_reason === 'slow_correct' ? 'SLOW' : item.priority_reason === 'miss' ? 'MISS' : item.confidence ? `C${item.confidence}` : '—'}</b>
              </button>
            ))}
          </div>
        </aside>

        {selected && <article className="answer-audit-detail">
          <div className="audit-detail-heading"><div><span>{selected.question.section} · {selected.question.question_type}</span><h2>Question {selected.position + 1}</h2></div><strong className={selected.is_correct ? 'correct' : 'repair'}>{selected.is_correct ? 'CORRECT' : 'REPAIR'}</strong></div>
          {selected.question.passage && <details className="audit-source"><summary>Read passage</summary><p>{selected.question.passage.text}</p></details>}
          {selected.question.stimulus && <p className="audit-stimulus">{selected.question.stimulus}</p>}
          <h3>{selected.question.stem}</h3>
          <div className="audit-choices">
            {selected.question.choices.map((choice) => <div key={choice.label} className={`${choice.label === selected.correct_label ? 'correct' : ''} ${choice.label === selected.selected_label && !selected.is_correct ? 'selected-wrong' : ''}`}><b>{choice.label}</b><span>{choice.text}</span>{choice.label === selected.correct_label && <small>credited</small>}{choice.label === selected.selected_label && <small>your answer</small>}</div>)}
          </div>
          <section className="concise-rationale" aria-live="polite">
            <div><Brain size={18} /><span>CONCISE REASONING</span></div>
            {coaching.isLoading ? <p>Preparing the shortest useful explanation…</p> : rationale ? <>
              <h4>Why {selected.correct_label} wins</h4><p>{rationale.answer_analysis.correct_answer_explanation}</p>
              {!selected.is_correct && <><h4>Why {selected.selected_label} falls short</h4><p>{rationale.answer_analysis.selected_answer_explanation}</p></>}
              <blockquote>{rationale.next_step_hint}</blockquote>
            </> : <>
              <h4>Verified outcome</h4><p>{selected.feedback?.diagnosis || `The verified answer is ${selected.correct_label}.`} {correctChoice ? `${selected.correct_label}: ${correctChoice.text}` : ''}</p>
              {!selected.is_correct && selectedChoice && <p>Your answer was {selected.selected_label}: {selectedChoice.text}</p>}
              <small>{coaching.error ? 'Detailed coaching is unavailable right now; the verified key remains authoritative.' : 'Opening a question prepares its concise rationale.'}</small>
            </>}
          </section>
        </article>}
      </section>

      <section className="review-next-actions">
        <div><span className="eyebrow">NEXT BEST ACTION</span><h2>{dueReviews ? `Repair ${Math.min(5, dueReviews)} due item${dueReviews === 1 ? '' : 's'}` : 'Return to unseen questions'}</h2><p>{dueReviews ? 'Write reasoning only where the evidence says it is needed.' : 'Your repair queue is clear; another run of cases provides fresh evidence.'}</p></div>
        <div>
          {isBrief && <button className="primary-button" onClick={() => finishBrief.mutate()} disabled={finishBrief.isPending}>{finishBrief.isPending ? 'Closing brief…' : 'Finish Deep Brief'} <CheckCircle2 /></button>}
          {dueReviews > 0 && <button className="primary-button" onClick={() => startRepair.mutate()} disabled={startRepair.isPending}>{startRepair.isPending ? 'Building review…' : 'Start priority review'} <ArrowRight /></button>}
          <button className="secondary-button" onClick={() => navigate('/cases')}>Practice modes</button>
          <button className="secondary-button" onClick={() => navigate('/progress')}>View progress</button>
        </div>
        {(startRepair.error || finishBrief.error) && <ErrorNotice error={startRepair.error || finishBrief.error} />}
      </section>
    </div>
  )
}


function PausedCasePage({ sessionId }: { sessionId: string }) {
  useRestoredChrome()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const resume = useMutation({
    mutationFn: () => api.resumeSession(sessionId),
    onSuccess: () => {
      void play('resume', { seed: sessionId, intensity: .5 })
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    },
  })
  return (
    <div className="paused-case page-wrap">
      <div className="paused-folder"><BriefcaseBusiness /></div>
      <span className="eyebrow">CASE FILE SAVED</span>
      <h1>Your argument is waiting.</h1>
      <p>Your answer choice and written reasoning are safe. Paused questions do not receive time-bonus points.</p>
      <button className="primary-button" onClick={() => resume.mutate()} disabled={resume.isPending}>
        <Play size={18} /> {resume.isPending ? 'Returning…' : 'Return to the case'}
      </button>
      {resume.error && <ErrorNotice error={resume.error} />}
    </div>
  )
}


/* A case route hides the header and the bottom nav. Without the chrome back
   there is no way off this screen, so a session that cannot be loaded has to
   restore it and offer the way out itself. */
function CaseSessionError({ error }: { error: unknown }) {
  useRestoredChrome()
  return (
    <div className="paused-case page-wrap">
      <div className="paused-folder"><BriefcaseBusiness /></div>
      <span className="eyebrow">CASE FILE UNAVAILABLE</span>
      <h1>That file is not on the desk.</h1>
      <ErrorNotice error={error} />
      <Link className="primary-button" to="/cases"><Play size={18} /> Back to the docket</Link>
    </div>
  )
}

export function CaseSessionPage() {
  const { sessionId } = useParams()
  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.session(sessionId!),
    enabled: Boolean(sessionId),
  })
  if (!sessionId) return <Navigate to="/cases" replace />
  if (sessionQuery.isLoading) return <LoadingScreen label="Pulling the case file…" />
  if (sessionQuery.error) return <CaseSessionError error={sessionQuery.error} />
  const session = sessionQuery.data!.session
  if (session.status === 'paused') return <PausedCasePage sessionId={session.id} />
  if (session.status === 'completed' && !session.pending_result) return <CompletedSessionReview sessionId={session.id} />
  return (
    <div className="session-page">
      {/* A mega-litigation runs in one sitting, so there is no pause to offer — the server refuses one. */}
      {!session.pending_result && (session.mode === 'diagnostic'
        ? <div className="session-controls"><span className="one-sitting-note"><span className="one-sitting-note-long">One sitting · the clock does not stop</span><span className="one-sitting-note-short">No pause</span></span></div>
        : <div className="session-controls"><PauseButton sessionId={session.id} returnTo="/office" /></div>)}
      <QuestionFlow session={session} />
    </div>
  )
}


type FirmTab = 'upgrades' | 'decor' | 'staff' | 'clients' | 'connections' | 'rivals' | 'achievements'

const firmTabs: Array<{ key: FirmTab; label: string; icon: typeof Wrench }> = [
  { key: 'upgrades', label: 'Upgrades', icon: Wrench },
  { key: 'decor', label: 'Decor', icon: Lamp },
  { key: 'staff', label: 'Staff', icon: UsersRound },
  { key: 'clients', label: 'Clients', icon: BriefcaseBusiness },
  { key: 'connections', label: 'Connections', icon: Handshake },
  { key: 'rivals', label: 'Rivals', icon: Trophy },
  { key: 'achievements', label: 'Achievements', icon: Award },
]


function RequirementLine({ asset, game }: { asset: GameAsset; game: GameState }) {
  const missing = [
    asset.requirements.reputation > game.reputation && `${asset.requirements.reputation} Reputation`,
    asset.requirements.tier > game.office_tier && `Firm tier ${asset.requirements.tier}`,
    ...asset.requirements.assets.filter((key) => !game.owned_assets.includes(key)).map((key) => key.replaceAll('_', ' ')),
  ].filter(Boolean)
  return <small className={missing.length ? 'requirements missing' : 'requirements met'}>{missing.length ? `Needs ${missing.join(' · ')}` : 'Requirements met'}</small>
}


function ClientRequirementLine({ client, game }: { client: GameClient; game: GameState }) {
  if (client.unlocked) return <small className="requirements met">{client.length}-case contract</small>
  const assetNames = client.requirements.assets.map((key) => game.catalog.assets.find((asset) => asset.key === key)?.name ?? key.replaceAll('_', ' '))
  const requirements = [
    client.requirements.reputation > 0 && `${client.requirements.reputation} Reputation`,
    client.requirements.tier > 0 && `Firm tier ${client.requirements.tier}`,
    ...assetNames,
  ].filter(Boolean)
  return <small className="requirements missing">Requires {requirements.join(' · ')}</small>
}


export function FirmPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { play } = useSound()
  const initial = (searchParams.get('tab') as FirmTab) || 'upgrades'
  const [tab, setTab] = useState<FirmTab>(firmTabs.some((item) => item.key === initial) ? initial : 'upgrades')

  useEffect(() => {
    const requested = searchParams.get('tab') as FirmTab | null
    if (requested && firmTabs.some((item) => item.key === requested)) setTab(requested)
  }, [searchParams])
  const [catalogView, setCatalogView] = useState<'all' | 'ready' | 'owned'>('all')
  const [catalogRegion, setCatalogRegion] = useState('all')
  const queryClient = useQueryClient()
  const gameQuery = useGame()
  const currentCaseQuery = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession, enabled: tab === 'clients' })
  const [justBought, setJustBought] = useState<string | null>(null)
  const [justActivated, setJustActivated] = useState<string | null>(null)
  const purchase = useMutation({
    mutationFn: api.purchase,
    onSuccess: ({ game }, key) => {
      storeGame(queryClient, game)
      void play('purchase', { id: `purchase:${game.id}:${key}`, seed: key, intensity: .75 })
      setJustBought(key)
      window.setTimeout(() => setJustBought(null), MOTION_TIMING.toastMs)
    },
  })
  const advance = useMutation({
    mutationFn: api.advanceFirm,
    onSuccess: ({ game }, tier) => {
      storeGame(queryClient, game)
      void play('promotion', {
        id: `promotion:${game.id}:${tier}`,
        seed: String(tier),
        intensity: .95,
        profile: { officeTier: game.office_tier, alignment: game.story.alignment },
      })
    },
  })
  const client = useMutation({
    mutationFn: api.selectClient,
    onSuccess: ({ game }, key) => {
      storeGame(queryClient, game)
      void play('client', { seed: key, intensity: .72 })
      setJustActivated(key)
      window.setTimeout(() => setJustActivated(null), MOTION_TIMING.toastMs)
    },
  })
  const appearance = useMutation({
    mutationFn: (characterGender: CharacterGender) => api.updateGame({ character_gender: characterGender }),
    onSuccess: ({ game }) => {
      storeGame(queryClient, game)
      void play('paper', { seed: game.character_gender, intensity: .32 })
    },
  })

  if (gameQuery.isLoading) return <LoadingScreen />
  const game = gameQuery.data!.game!
  const typeMap: Record<FirmTab, GameAsset['type'] | null> = { upgrades: 'upgrade', decor: 'cosmetic', staff: 'staff', clients: null, connections: 'connection', rivals: 'rival', achievements: null }
  const assets = game.catalog.assets.filter((item) => item.type === typeMap[tab])
  const regions = Array.from(new Set([
    ...game.catalog.tiers.map((tier) => tier.region),
    ...game.catalog.assets.map((asset) => asset.region).filter((region): region is string => Boolean(region)),
  ]))
  const visibleAssets = assets.filter((item) =>
    (catalogRegion === 'all' || item.region === catalogRegion)
    && (catalogView === 'all' || (catalogView === 'ready' ? item.available : item.owned)),
  )
  const unlockedStaff = game.catalog.assets.filter((item) => item.type === 'staff' && (item.owned || item.available))
  const visibleClients = game.catalog.clients.filter((item) =>
    (catalogRegion === 'all' || item.region === catalogRegion)
    && (catalogView === 'all' || (catalogView === 'ready' ? item.unlocked : item.selected)),
  )
  const nextTier = game.catalog.tiers.find((tier) => tier.next)
  const missingTierAssets = (nextTier?.missing_assets ?? []).map((key) =>
    game.catalog.assets.find((asset) => asset.key === key)?.name ?? key.replaceAll('_', ' '),
  )
  const workingClient = effectiveClient(game)
  const openSession = currentCaseQuery.data?.session
  const openCaseItem = openSession?.pending_item || openSession?.current_item
  const openCaseTerms = openCaseItem?.case_terms
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: FirmTab) => {
    const currentIndex = firmTabs.findIndex((item) => item.key === current)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % firmTabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + firmTabs.length) % firmTabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = firmTabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = firmTabs[nextIndex].key
    void play('tab', { seed: next, intensity: .32 })
    setTab(next)
    window.requestAnimationFrame(() => document.getElementById(`firm-tab-${next}`)?.focus())
  }
  const selectTab = (next: FirmTab) => {
    if (next === tab) return
    void play('tab', { seed: next, intensity: .32 })
    setTab(next)
  }
  const selectCatalogView = (next: 'all' | 'ready' | 'owned') => {
    if (next === catalogView) return
    void play('select', { seed: next, intensity: .25 })
    setCatalogView(next)
  }

  return (
    <div className="firm-page page-wrap">
      <section className="page-heading firm-ledger-heading">
        <PixelStudyScenery variant="ledger" className="firm-ledger-scenery" />
        <div className="firm-heading-copy"><span className="eyebrow">THE PARTNERS' LEDGER · MANAGE THE FIRM</span><h1>Build a legendary practice.</h1><p>Spend case fees on a living, growing office. Every improvement appears in your firm and makes the next case worth more.</p><div className="ledger-rule"><i /><span>§</span><i /></div></div>
        <div className="firm-wallet">
          <div className="wallet-clasp"><i /><i /></div><small>FIRM TREASURY</small><strong>{formatMoney(game.cash)}</strong><span><Star size={15} /> {game.reputation.toFixed(1)} Reputation</span>
          <span className={`wallet-lease ${game.upkeep.rent_arrears ? 'has-arrears' : ''}`}><CircleDollarSign size={15} /> {game.upkeep.completed ? 'Lease retired' : `${formatMoney(game.upkeep.daily_rent)} daily rent${game.upkeep.rent_arrears ? ` · ${formatMoney(game.upkeep.rent_arrears)} due` : ''}`}</span>
          <button
            className="appearance-button"
            disabled={appearance.isPending}
            aria-label={`Switch to the ${game.character_gender === 'female' ? 'male' : 'female'} character`}
            onClick={() => appearance.mutate(game.character_gender === 'female' ? 'male' : 'female')}
          >
            <UserRound size={14} />
            {appearance.isPending ? 'Updating character…' : <>Character: {game.character_gender === 'female' ? 'Female' : 'Male'}<span>Switch</span></>}
          </button>
        </div>
      </section>
      <div className="firm-tabs" role="tablist" aria-label="Firm management sections">
        {firmTabs.map(({ key, label, icon: Icon }, index) => <button key={key} id={`firm-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`firm-panel-${key}`} tabIndex={tab === key ? 0 : -1} className={tab === key ? 'active' : ''} onKeyDown={(event) => moveTab(event, key)} onClick={() => selectTab(key)}><span className="firm-tab-icon"><Icon size={17} /></span><span>{label}</span><small>{String(index + 1).padStart(2, '0')}</small></button>)}
      </div>

      {firmTabs.filter(({ key }) => key !== tab).map(({ key }) => <div key={key} id={`firm-panel-${key}`} role="tabpanel" aria-labelledby={`firm-tab-${key}`} hidden />)}
      <div id={`firm-panel-${tab}`} className={`firm-panel firm-panel-${tab}`} role="tabpanel" aria-labelledby={`firm-tab-${tab}`} tabIndex={0}>
        {tab === 'staff' && <StaffRoster staff={unlockedStaff} />}
        {/* The rivals tab leads with the war room rather than the catalog grid,
            because weakening a firm and then buying it is one move: the grid
            below is only ever the raw price list. */}
        {tab === 'rivals' && <RivalWarRoom game={game} onShowOnMap={(asset) => navigate(`/map?rival=${asset.key}`)} />}
        {tab !== 'achievements' && (
          <div className="catalog-toolbar">
            <div><span>CATALOG VIEW</span><strong>{tab === 'clients' ? visibleClients.length : visibleAssets.length} RESULTS</strong></div>
            <div className="catalog-view-buttons" role="group" aria-label="Filter catalog status">
              {(['all', 'ready', 'owned'] as const).map((view) => <button key={view} className={catalogView === view ? 'active' : ''} onClick={() => selectCatalogView(view)}>{view === 'owned' && tab === 'clients' ? 'Active' : view}</button>)}
            </div>
            <label><span>CITY REGION</span><select value={catalogRegion} onChange={(event) => {
              const nextRegion = event.target.value
              if (nextRegion !== catalogRegion) void play('select', { seed: nextRegion, intensity: .25 })
              setCatalogRegion(nextRegion)
            }}><option value="all">All districts</option>{regions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
          </div>
        )}
        {tab === 'upgrades' && nextTier && (
          <section className="tier-upgrade-banner">
          <div className="tier-preview"><Building2 /><span>TIER {nextTier.tier}</span></div>
          <div>
            <span className="eyebrow">{nextTier.region} · OFFICE TRANSFORMATION</span>
            <h2>{nextTier.name}</h2><p>{nextTier.short}</p>
            <small>{nextTier.feature} · Requires {nextTier.reputation} Reputation and every prior upgrade, staff hire, and acquisition</small>
            <span className="next-tier-rent"><CircleDollarSign size={14} /> New lease: {formatMoney(nextTier.rent_daily)} per day</span>
            {missingTierAssets.length > 0 && <><br /><small className="requirements missing">Still needed: {missingTierAssets.slice(0, 3).join(' · ')}{missingTierAssets.length > 3 ? ` · +${missingTierAssets.length - 3} more` : ''}</small></>}
          </div>
          <div className="tier-buy"><strong>{formatMoney(nextTier.cost)}</strong><button className="primary-button" disabled={!nextTier.available || game.cash < nextTier.cost || advance.isPending} onClick={() => advance.mutate(nextTier.tier)}>{advance.isPending ? 'Renovating…' : !nextTier.available ? 'Locked' : game.cash < nextTier.cost ? 'Keep earning' : 'Advance firm'}</button></div>
          </section>
        )}

        {tab === 'clients' ? (
          <>
            <section className="client-roster-status">
              <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
              <div><span className="eyebrow">CURRENT WORKING CLIENT</span><h2>{workingClient.name}</h2><p>{game.active_client.on_hold ? `${game.active_client.name} is on hold; new matters use this client instead.` : `${game.active_client.cases_remaining} cases remain in this contract.`}</p></div>
              <aside className={openCaseTerms ? 'has-open-file' : ''}>
                <span>{openCaseTerms ? 'OPEN CASE FILE' : 'NEXT CASE FILE'}</span>
                <strong>{openCaseTerms?.client_name || workingClient.name}</strong>
                <small>{openCaseTerms
                  ? openCaseTerms.client_key === workingClient.key ? 'This case matches your current contract.' : `This file stays with ${openCaseTerms.client_name}; the new client starts after it closes.`
                  : `Your next case will be for ${workingClient.name}.`}</small>
              </aside>
            </section>
            <div className="management-grid client-grid">
            {visibleClients.map((item) => (
              <article key={item.key} className={`management-card client-card ${item.matter_type === 'pro_bono' ? 'pro-bono-client' : ''} ${item.selected ? 'selected' : ''} ${!item.unlocked ? 'locked' : ''} ${justActivated === item.key ? 'just-activated' : ''}`}>
                <ClientPortrait kind={item.icon} name={item.name} mood={item.selected ? 'happy' : 'neutral'} className="client-card-portrait" />
                {item.matter_type === 'pro_bono' && <div className="pro-bono-seal"><HeartHandshake /> PRO BONO</div>}
                <div className="card-status">{item.on_hold ? <><Lock size={12} /> ON HOLD</> : item.selected ? 'WORKING NOW' : item.unlocked ? 'AVAILABLE' : <><Lock size={12} /> LOCKED</>}</div>
                <div className="content-location-tag">{item.region || `TIER ${item.tier}`}{item.archetype && <b>{item.archetype}</b>}</div>
                <h3>{item.name}</h3><p>{item.description}</p>
                <div className="client-fee"><span>Base fee per case</span><strong>{formatMoney(item.base_fee)}</strong></div>
                {item.special && <div className="client-special"><Sparkles size={13} /><span><small>CASE TWIST</small>{item.special}</span></div>}
                {item.on_hold && <div className="effective-client-note"><BriefcaseBusiness size={13} />Cases use {workingClient.name} · {formatMoney(workingClient.base_fee)} base fee</div>}
                {item.contract && <div className="contract-mini"><span>{item.contract.cases_remaining} left</span><span>{item.contract.loyalty} loyalty</span></div>}
                <ClientRequirementLine client={item} game={game} />
                <button className={item.selected ? 'secondary-button full' : 'primary-button full'} disabled={!item.unlocked || item.selected || client.isPending} onClick={() => client.mutate(item.key)}>{client.isPending && client.variables === item.key ? 'Switching files…' : item.on_hold ? 'Current client · On hold' : item.selected ? 'Working these cases' : !item.unlocked ? 'Locked' : `Work for ${item.name}`}</button>
                {justActivated === item.key && <div className="client-activated-flash"><Check /> NEW CLIENT ACTIVE</div>}
              </article>
            ))}
            </div>
          </>
      ) : tab === 'achievements' ? (
        <div className="achievement-grid">
          {game.achievements.map((item, index) => (
            <article key={item.key} className={item.unlocked ? 'unlocked' : ''}>
              <div>{item.unlocked ? <Trophy /> : <Lock />}</div><span>{String(index + 1).padStart(2, '0')}</span><h3>{item.name}</h3><p>{item.description}</p>{item.unlocked && <small><Check /> ACHIEVED</small>}
            </article>
          ))}
        </div>
      ) : (
        <div className="management-grid asset-management-grid">
          {visibleAssets.map((item) => (
            <article key={item.key} className={`management-card asset-card asset-card-${item.type} ${item.owned ? 'owned' : ''} ${!item.available && !item.owned ? 'locked' : ''} ${justBought === item.key ? 'just-bought' : ''}`}>
              <PixelAssetArtwork asset={item} />
              <div className="card-status">{item.owned ? <><Check size={13} /> OWNED</> : item.available ? 'AVAILABLE' : <><Lock size={12} /> LOCKED</>}</div>
              <div className="asset-card-copy"><span className="asset-card-number">ASSET {String(assets.indexOf(item) + 1).padStart(2, '0')} · {item.region?.toUpperCase()}</span><h3>{item.name}</h3><p>{item.description}</p></div><div className="benefit-pill"><Sparkles size={14} /><span><small>GAME EFFECT</small>{item.benefit}</span></div>
              <RequirementLine asset={item} game={game} />
              {/* Locked is named before cost, because an unmet requirement is the
                  blocker that earning more cannot clear. Leaving it out labelled a
                  disabled button 'Purchase', which reads as an unresponsive click. */}
              <div className="purchase-row"><strong>{item.list_cost && item.list_cost > item.cost ? <><del>{formatMoney(item.list_cost)}</del>{formatMoney(item.cost)} <small>−{(item.discount_bps! / 100).toFixed(0)}%</small></> : formatMoney(item.cost)}</strong><button className="primary-button" disabled={item.owned || !item.available || game.cash < item.cost || purchase.isPending} onClick={() => purchase.mutate(item.key)}>{item.owned ? 'Installed' : !item.available ? 'Locked' : game.cash < item.cost ? 'Keep earning' : 'Purchase'}</button></div>
            </article>
          ))}
        </div>
        )}
      </div>
      {(purchase.error || advance.error || client.error || appearance.error) && <ErrorNotice error={purchase.error || advance.error || client.error || appearance.error} />}
    </div>
  )
}


export function ProgressionMapPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const gameQuery = useGame()
  if (gameQuery.isLoading) return <LoadingScreen />
  const game = gameQuery.data!.game!
  const heldRivals = game.catalog.assets.filter((asset) => asset.type === 'rival' && asset.owned).length
  const totalRivals = game.catalog.assets.filter((asset) => asset.type === 'rival').length
  return (
    <div className="map-page empire-game-page">
      <section className="empire-command-bar">
        <span className="pixel-kicker">CONTESTED TERRITORY · {heldRivals} OF {totalRivals} RIVAL FIRMS HELD</span>
        <h1>Your legal empire</h1>
        <p>Every rival practice sits at a real address. Move against one from the world itself, then absorb it when its price has fallen far enough.</p>
      </section>
      {/* `?rival=` lets the firm tab's "Show on the map" hand a specific target
          across, so the two surfaces stay one conversation. Empire value travels
          down as a prop rather than being shown in a second box up here, since
          the map's own headquarters panel is where the rest of the firm's vitals
          already live. */}
      <EmpireWorldMap
        game={game}
        focusRival={searchParams.get('rival')}
        onManage={(tab) => navigate(`/firm?tab=${tab}`)}
        empireValueLabel={formatMoney(game.firm_valuation, true)}
      />
    </div>
  )
}


const questPresentation: Record<StoryQuest['category'], { label: string; icon: typeof FileSearch; copy: string }> = {
  pro_bono: { label: 'Public Interest', icon: HeartHandshake, copy: 'Lower fees. Greater standing. A promise kept.' },
  investigation: { label: 'Investigations', icon: FileSearch, copy: 'Build Intel and uncover Sterling’s hidden network.' },
  shadow: { label: 'Shadow Files', icon: Eye, copy: 'Lucrative, secret, and dangerous to the firm’s name.' },
  legacy: { label: 'Legacy Matter', icon: ScrollText, copy: 'Write the rule that survives the empire.' },
}


export function StoryPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { play } = useSound()
  const gameQuery = useGame()
  const [selectedRival, setSelectedRival] = useState<string | null>(null)
  const startQuestMutation = useMutation({
    mutationFn: api.startQuest,
    onSuccess: ({ game }, questKey) => {
      storeGame(queryClient, game)
      void play('file-open', { id: `quest:${game.id}:${questKey}`, seed: questKey, intensity: .68 })
    },
  })
  const operation = useMutation({
    mutationFn: ({ rivalKey, operationKey }: { rivalKey: string; operationKey: string }) => api.rivalOperation(rivalKey, operationKey),
    onSuccess: ({ game }, { rivalKey, operationKey }) => {
      storeGame(queryClient, game)
      void play('story', {
        id: `operation:${game.id}:${rivalKey}:${operationKey}`,
        seed: `${rivalKey}:${operationKey}`,
        intensity: .76,
        profile: { officeTier: game.office_tier, alignment: game.story.alignment },
      })
    },
  })
  if (gameQuery.isLoading) return <LoadingScreen label="Developing the caseboard…" />
  if (gameQuery.error) return <div className="contained"><ErrorNotice error={gameQuery.error} /></div>
  const game = gameQuery.data!.game!
  const story = game.story
  const rival = story.rival_targets.find((item) => item.key === selectedRival) ?? story.rival_targets[0]
  const grouped = (['pro_bono', 'investigation', 'shadow', 'legacy'] as const)
    .map((category) => ({ category, quests: story.quests.filter((quest) => quest.category === category) }))
    .filter((group) => group.quests.length)

  return (
    <div className={`story-page story-alignment-${story.alignment.toLowerCase()} page-wrap`}>
      <section className="story-hero">
        <div className="story-hero-copy">
          <span className="pixel-kicker">THE MERCER FILES · CAMPAIGN CASEBOARD</span>
          <h1>What will the name<br />on the door <em>mean?</em></h1>
          <p>Ada’s key, Harrow’s evidence, Moth’s secrets, and Sterling’s empire are one case. Every choice changes the resources—and the ending—you can reach.</p>
          <div className="story-alignment-stamp"><Scale /><span>CURRENT PATH</span><strong>{story.alignment}</strong></div>
          {story.epilogue && (
            <button type="button" className="story-epilogue-link" onClick={openEpilogue}>
              <Trophy size={16} /> Read the final record
            </button>
          )}
        </div>
        <div className="story-board-art" aria-hidden="true">
          <div className="board-photo photo-ada">ADA</div><div className="board-photo photo-sterling">STERLING</div><div className="board-photo photo-moth">MOTH?</div>
          <i className="thread t1" /><i className="thread t2" /><i className="thread t3" />
          <div className="board-note">FORGED DEED<br />→ CITY HALL<br />→ ACQUISITIONS</div>
          <span className="board-key">⚿</span>
        </div>
      </section>

      <section className="story-resources" aria-label="Campaign resources">
        <article className="ethics"><Scale /><span>ETHICS<small>Which doors remain open</small></span><strong>{story.ethics.toFixed(1)}</strong><div><i style={{ width: `${story.ethics}%` }} /></div></article>
        <article className="heat"><ShieldAlert /><span>HEAT<small>Scrutiny and scandal risk</small></span><strong>{story.heat.toFixed(1)}</strong><div><i style={{ width: `${story.heat}%` }} /></div></article>
        <article><FileSearch /><span>INTEL<small>Evidence for investigations</small></span><strong>{story.intel}</strong></article>
        <article><Gavel /><span>INFLUENCE<small>Clean competitive leverage</small></span><strong>{story.influence}</strong></article>
      </section>

      <section className="campaign-timeline">
        <div className="story-section-heading"><span>01 · THE CAMPAIGN</span><h2>From one light to a constellation</h2><p>Chapters unlock with headquarters tiers, and each one opens the caseboard files that follow it. Story decisions are permanent.</p></div>
        <div className="chapter-track">
          {story.chapters.map((chapter, index) => (
            <article key={chapter.key} className={`${chapter.seen ? 'seen' : ''} ${story.pending_chapter?.key === chapter.key ? 'pending' : ''}`}>
              <i>{chapter.seen ? <Check /> : story.pending_chapter?.key === chapter.key ? '!' : <Lock />}</i>
              <span>{chapter.act} · HQ {chapter.tier}</span><h3>{chapter.title}</h3>
              <small>{chapter.choice ? `Decision: ${chapter.choice.replaceAll('_', ' ')}` : chapter.tier <= game.office_tier ? 'Decision waiting' : `Unlocks at headquarters tier ${chapter.tier}`}</small>
              {story.pending_chapter?.key === chapter.key && (
                <button type="button" className="chapter-play-button" onClick={openPendingChapter}>Play this chapter</button>
              )}
              {index < story.chapters.length - 1 && <b />}
            </article>
          ))}
        </div>
      </section>

      {story.active_quest && (
        <section className={`active-caseboard active-${story.active_quest.category}`}>
          <div className="dossier-tab">ACTIVE FILE</div>
          <span>{story.active_quest.patron}</span><h2>{story.active_quest.title}</h2><p>{story.active_quest.description}</p>
          <div className="quest-progress"><div><i style={{ width: `${story.active_quest.progress / story.active_quest.target * 100}%` }} /></div><strong>{story.active_quest.progress} / {story.active_quest.target}</strong></div>
          <small>{story.active_quest.objective} · Reward: {story.active_quest.reward_label}</small>
        </section>
      )}

      <section className="quest-caseboard">
        <div className="story-section-heading"><span>02 · THE CASEBOARD</span><h2>Choose the work behind the work</h2><p>Files open in order along their own track, so closing one is what puts the next on the board. Only one can occupy the caseboard at a time, and hidden files surface when your Ethics and Intel make the right people trust you or target you.</p></div>
        {grouped.map(({ category, quests }) => {
          const presentation = questPresentation[category]
          const Icon = presentation.icon
          return <div className={`quest-shelf quest-shelf-${category}`} key={category}>
            <header><Icon /><div><span>{presentation.label}</span><small>{presentation.copy}</small></div></header>
            <div className="quest-grid">{quests.map((quest) => (
              <article key={quest.key} className={`${quest.active ? 'active' : ''} ${quest.completed ? 'completed' : ''} ${quest.locked_by.length ? 'sequence-locked' : ''}`}>
                <div className="dossier-top"><span>HQ {quest.tier} · {quest.patron}</span><i>{quest.completed ? 'CLOSED' : quest.active ? 'ACTIVE' : quest.locked_by.length ? 'SEALED' : 'OPEN'}</i></div>
                <h3>{quest.title}</h3><p>{quest.description}</p><strong>{quest.objective}</strong>
                {quest.start_label && <small className="quest-cost">Opening cost: {quest.start_label}</small>}
                <small className="quest-reward">Reward: {quest.reward_label}</small>
                {quest.locked_by.length > 0 && <small className="quest-sequence"><Lock size={12} /> Opens after {quest.locked_by.join(' · ')}</small>}
                <button disabled={!quest.available || startQuestMutation.isPending} onClick={() => startQuestMutation.mutate(quest.key)}>{quest.completed ? 'File closed' : quest.active ? `${quest.progress} / ${quest.target}` : quest.locked_by.length ? 'Sealed until earlier work closes' : story.active_quest ? 'Caseboard occupied' : !quest.available ? 'Locked' : 'Open this file'}</button>
              </article>
            ))}</div>
          </div>
        })}
      </section>

      {/* Section number only — RivalWarRoom carries its own kicker, title and copy. */}
      <div className="story-section-heading light"><span>03 · RIVAL OPERATIONS</span></div>
      <RivalWarRoom game={game} selectedKey={selectedRival} onSelect={setSelectedRival} onShowOnMap={(asset) => navigate(`/map?rival=${asset.key}`)} />
      {startQuestMutation.error && <ErrorNotice error={startQuestMutation.error} />}
    </div>
  )
}
