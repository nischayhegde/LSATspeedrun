import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
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
  Lock,
  Play,
  Scale,
  ScrollText,
  ShieldAlert,
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
import { ClientPortrait, CutsceneArtwork, EmpireWorldMap, ExplorableOffice, MiniAvatar, OfficeScene, PixelAssetArtwork, StaffRoster } from './game-art'
import { PixelStudyScenery } from './art/pixel-scenery'
import { SoundControls, useAmbientMusic, useSound } from './sound'
import { MOTION_TIMING } from './motion'
import type { CharacterGender, GameAsset, GameClient, GameResponse, GameState, StoryChapter, StoryQuest } from './types'
import './performance.css'


function useGame() {
  return useQuery({ queryKey: ['game'], queryFn: api.game })
}


export function PerformancePage() {
  const navigate = useNavigate()
  const { play } = useSound()
  const performanceQuery = useQuery({ queryKey: ['performance'], queryFn: api.performance })
  const diagnosticQuery = useQuery({ queryKey: ['diagnostic'], queryFn: api.currentDiagnostic })
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const startDiagnostic = useMutation({
    mutationFn: () => api.startDiagnostic(1),
    onSuccess: ({ session }) => {
      void play('file-open', { seed: `diagnostic:${session.id}`, intensity: .64 })
      navigate(`/cases/${session.id}`)
    },
  })
  const startSpeedrun = useMutation({
    mutationFn: () => api.startPractice({ size: 10, practice_style: 'speedrun', feedback_policy: 'delayed' }),
    onSuccess: ({ session }) => navigate(`/cases/${session.id}`),
  })
  const startFocus = useMutation({
    mutationFn: (questionType: string) => api.startPractice({ size: 3, question_type: questionType, practice_style: 'speedrun', feedback_policy: 'delayed' }),
    onSuccess: ({ session }) => navigate(`/cases/${session.id}`),
  })
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
    trials_completed: 0,
    strategies_tested: 0,
    strongest: null,
    evidence_note: 'Method evidence begins after eligible Deep Practice or Infinite questions.',
  }
  const leadingStrategy = strategyLab.strongest
    ?? strategyLab.results.find((strategy) => strategy.status === 'directional')
    ?? strategyLab.results.find((strategy) => strategy.sample > 0)
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
    else startSpeedrun.mutate()
  }
  const openDiagnostic = () => {
    if (diagnosticSession) navigate(`/cases/${diagnosticSession.id}`)
    else startDiagnostic.mutate()
  }

  return (
    <div className="performance-page page-wrap">
      <section className="mobile-training-home" aria-label="Training overview">
        <header className="mobile-learning-header">
          <div><span>TRAINING</span><h1>Your next best rep.</h1></div>
          <a href="#mobile-training-analysis">Analysis <ArrowRight size={15} /></a>
        </header>
        <div className="mobile-training-signal">
          <div className="mobile-training-score" aria-label={`${testMetrics.accuracy} percent timed unseen accuracy`}>
            <strong>{testMetrics.attempts ? testMetrics.accuracy : '—'}</strong><span>{testMetrics.attempts ? '%' : 'NEW'}</span>
          </div>
          <div><small>TIMED UNSEEN ACCURACY</small><p>{testMetrics.attempts ? `${testMetrics.attempts} verified attempts · ${readiness.status === 'ready' ? 'comparison ready' : 'evidence forming'}` : 'Run a baseline sprint to establish your line.'}</p></div>
        </div>
        <div className="mobile-training-metrics" aria-label="Training evidence">
          <div><span>Average split</span><strong>{testMetrics.attempts ? `${Math.floor(testMetrics.average_seconds / 60)}:${String(testMetrics.average_seconds % 60).padStart(2, '0')}` : '—'}</strong></div>
          <div><span>Review recovery</span><strong>{reviewMetrics.recovery_rate === null ? '—' : `${reviewMetrics.recovery_rate}%`}</strong></div>
          <div><span>Due now</span><strong>{reviewMetrics.due}</strong></div>
        </div>
        <div className="mobile-training-priority">
          <Target size={19} />
          <div><span>TRAINING PRIORITY</span><strong>{performance.recommendation?.skill ?? 'Establish your baseline'}</strong><small>{performance.recommendation ? `${performance.recommendation.accuracy}% current accuracy · ${performance.recommendation.reason}` : 'A diagnostic or sprint will identify the first weakness.'}</small></div>
        </div>
        <div className="mobile-training-actions">
          <button className="primary-button" onClick={openPrimaryTraining} disabled={startSpeedrun.isPending}><TimerReset /> {activePractice ? 'Continue current run' : 'Start 10-question sprint'} <ArrowRight /></button>
          <button className="mobile-training-secondary" onClick={openDiagnostic} disabled={startDiagnostic.isPending}><Target /> {diagnosticSession ? 'Resume diagnostic' : performance.diagnostic ? 'Run a new diagnostic' : 'Take baseline diagnostic'}</button>
        </div>
      </section>

      <section className="performance-hero">
        <div>
          <span className="eyebrow">EXPERIMENTAL · LSAT SPEEDRUN LAB</span>
          <h1>Build speed that survives a new question.</h1>
          <p>Timed unseen accuracy is the headline. Review recovery, confidence, and pacing explain what to train next.</p>
          <div className="performance-actions">
            <button className="primary-button" onClick={openPrimaryTraining} disabled={startSpeedrun.isPending}><TimerReset /> {activePractice ? 'Resume current run' : 'Start 10-question Sprint'} <ArrowRight /></button>
            <button className="secondary-button" onClick={openDiagnostic} disabled={startDiagnostic.isPending}><Target /> {diagnosticSession ? 'Resume diagnostic' : performance.diagnostic ? 'Retake diagnostic' : 'Take baseline diagnostic'}</button>
          </div>
        </div>
        <div className="speedrun-index" aria-label={`${testMetrics.accuracy} percent timed unseen accuracy`}>
          <div className="index-ring" style={{ '--index': `${testMetrics.accuracy * 3.6}deg` } as React.CSSProperties}><span><strong>{testMetrics.attempts ? testMetrics.accuracy : '—'}</strong><small>{testMetrics.attempts ? '%' : 'NO DATA'}</small></span></div>
          <small>TIMED UNSEEN ACCURACY</small>
          <p>{testMetrics.attempts} independent question{testMetrics.attempts === 1 ? '' : 's'} · {readiness.status === 'ready' ? 'comparison ready' : 'evidence forming'}</p>
        </div>
        <PixelStudyScenery variant="training" className="performance-hero-scenery" />
      </section>

      <section className="evidence-strip">
        <span><Activity /> EVIDENCE: {metrics.evidence.toUpperCase()}</span><p>{evidenceCopy}</p><strong>{metrics.attempts} questions observed</strong>
      </section>

      <section className="performance-metrics" aria-label="Core LSAT performance measures">
        <article><div><Target /><span>TEST PERFORMANCE</span></div><strong>{testMetrics.attempts ? `${testMetrics.accuracy}%` : '—'}</strong><small>{testMetrics.attempts} timed unseen attempts · {testMetrics.pace_adherence}% inside target</small></article>
        <article><div><TimerReset /><span>AVERAGE SPLIT</span></div><strong>{testMetrics.attempts ? `${Math.floor(testMetrics.average_seconds / 60)}:${String(testMetrics.average_seconds % 60).padStart(2, '0')}` : '—'}</strong><small>Comparable Sprint and Diagnostic work only</small></article>
        <article><div><Brain /><span>REVIEW RECOVERY</span></div><strong>{reviewMetrics.recovery_rate === null ? '—' : `${reviewMetrics.recovery_rate}%`}</strong><small>{reviewMetrics.due} due · {reviewMetrics.scheduled} scheduled · {reviewMetrics.mastered} mastered</small></article>
        <article><div><Gauge /><span>CONFIDENCE ERRORS</span></div><strong>{confidenceMetrics.high_confidence_error_rate === null ? '—' : `${confidenceMetrics.high_confidence_error_rate}%`}</strong><small>High-confidence misses across {confidenceMetrics.sample} rated answers</small></article>
      </section>

      <div className="mobile-performance-deck" id="mobile-training-analysis">
        <header className="mobile-performance-deck-heading" aria-hidden="true"><span>YOUR TRAINING FILE</span><strong>Swipe between method, baseline, evidence, trends, and skills.</strong></header>
        <div className="mobile-performance-deck-track" aria-label="Training analysis panels">
      <section className="strategy-lab-panel" aria-labelledby="strategy-lab-title">
        <div className="panel-heading strategy-lab-heading">
          <div><span>PERSONAL METHOD LAB</span><h2 id="strategy-lab-title">Find the process that actually helps you.</h2></div>
          <Brain />
        </div>
        <p className="strategy-lab-intro">Every fourth eligible Deep Practice or Infinite question may carry one short method brief. A hidden control group compares similar unprompted questions; Diagnostics, Sprints, and Review stay clean.</p>

        {leadingStrategy ? (
          <div className="strategy-leader-grid">
            <div className="strategy-leader-copy">
              <span className={`strategy-evidence-badge ${leadingStrategy.status}`}>{leadingStrategy.status} signal</span>
              <h3>{leadingStrategy.title}</h3>
              <p>{leadingStrategy.best_for}</p>
              <small>{leadingStrategy.status === 'supported' ? 'This is your strongest currently supported method.' : 'Promising, but more prompted and control observations are required before calling it supported.'}</small>
            </div>
            <div className="strategy-comparison" aria-label={`${leadingStrategy.title} trial comparison`}>
              <div><span>WITH METHOD</span><strong>{leadingStrategy.accuracy}%</strong><small>{leadingStrategy.sample} questions</small></div>
              <div><span>MATCHED CONTROL</span><strong>{leadingStrategy.control_sample ? `${leadingStrategy.control_accuracy}%` : '—'}</strong><small>{leadingStrategy.control_sample} questions</small></div>
              <div className={leadingStrategy.lift !== null && leadingStrategy.lift > 0 ? 'positive' : ''}><span>ACCURACY LIFT</span><strong>{leadingStrategy.lift === null ? '—' : `${leadingStrategy.lift > 0 ? '+' : ''}${leadingStrategy.lift} pts`}</strong><small>{leadingStrategy.average_seconds}s adjusted split</small></div>
            </div>
          </div>
        ) : (
          <div className="strategy-empty-state"><Activity /><div><strong>No method winner yet.</strong><p>Complete Deep Practice or Infinite questions. The first brief is eligible on question 3, then no more than once every four questions.</p></div></div>
        )}

        <div className="strategy-evidence-key" aria-label="Strategy evidence thresholds">
          <div className="active"><b>1</b><span>FORMING<small>under 4 method or 2 control samples</small></span></div>
          <div><b>2</b><span>DIRECTIONAL<small>at least 4 method and 2 control samples</small></span></div>
          <div><b>3</b><span>SUPPORTED<small>at least 8 method and 4 control samples</small></span></div>
        </div>

        {strategyLab.results.length > 0 && (
          <details className="strategy-results-detail">
            <summary>Compare all tested methods <span>{strategyLab.strategies_tested} tested · {strategyLab.trials_completed} measured observations</span></summary>
            <div className="strategy-results-table">
              <div className="header"><span>Method</span><span>Evidence</span><span>Method / control</span><span>Lift</span><span>Adjusted pace</span></div>
              {strategyLab.results.map((strategy) => (
                <div key={strategy.key}>
                  <strong>{strategy.title}<small>{strategy.section === 'Logical Reasoning' ? 'LR' : 'RC'}</small></strong>
                  <span className={`strategy-evidence-badge ${strategy.status}`}>{strategy.status}</span>
                  <span>{strategy.sample ? `${strategy.accuracy}%` : '—'} / {strategy.control_sample ? `${strategy.control_accuracy}%` : '—'}<small>n={strategy.sample} / {strategy.control_sample}</small></span>
                  <span>{strategy.lift === null ? '—' : `${strategy.lift > 0 ? '+' : ''}${strategy.lift} pts`}</span>
                  <span>{strategy.sample ? `${strategy.average_seconds}s` : '—'}<small>{strategy.pace_adherence === null ? 'pace forming' : `${strategy.pace_adherence}% in target`}</small></span>
                </div>
              ))}
            </div>
          </details>
        )}

        <details className="strategy-catalog-detail">
          <summary>See the complete 14-method playbook and sources</summary>
          <p>No source guarantees a 170+. Official LSAC guidance is the primary authority; prep-provider methods are hypotheses the app tests against your own performance.</p>
          <div className="strategy-catalog-grid">
            {strategyLab.catalog.map((strategy) => <article key={strategy.key}><span>{strategy.section === 'Logical Reasoning' ? 'LR' : 'RC'}</span><h3>{strategy.title}</h3><p>{strategy.prompt}</p><ol>{strategy.steps.map((step) => <li key={step}>{step}</li>)}</ol><small>Best for: {strategy.best_for}</small><div>{strategy.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}</a>)}</div></article>)}
          </div>
        </details>
        <p className="strategy-lab-caveat"><ShieldAlert /> {strategyLab.evidence_note} This is an individualized training signal, not a guaranteed score outcome.</p>
      </section>

      <section className="diagnostic-lab">
        <div className="diagnostic-copy">
          <span className="eyebrow">BASELINE DIAGNOSTIC</span>
          <h2>{performance.diagnostic ? 'Your first performance anchor is set.' : 'Measure before you optimize.'}</h2>
          <p>A sectioned {diagnosticSize}-question LR/RC baseline with delayed results. It changes no currency, reputation, streak, or firm progress.</p>
          <ul><li>Raw verified accuracy</li><li>Section pacing</li><li>Omissions</li><li>Confidence calibration</li></ul>
          <button className="primary-button" onClick={() => diagnosticSession ? navigate(`/cases/${diagnosticSession.id}`) : startDiagnostic.mutate()} disabled={startDiagnostic.isPending}>{diagnosticSession ? 'Continue baseline' : performance.diagnostic ? 'Run a new baseline' : 'Start diagnostic'} <ArrowRight /></button>
        </div>
        <div className="diagnostic-score">
          {performance.diagnostic ? <><small>RAW DIAGNOSTIC RESULT</small><strong>{performance.diagnostic.raw_correct ?? performance.diagnostic.summary.correct}/{performance.diagnostic.raw_total ?? performance.diagnostic.summary.questions_completed}</strong><span>{performance.diagnostic.summary.accuracy}% verified accuracy</span><p>{performance.diagnostic.projection_note ?? 'A scaled score is withheld until the form has a validated conversion.'}</p></> : <><small>{diagnosticSession ? 'BASELINE IN PROGRESS' : 'NO BASELINE YET'}</small><strong>—</strong><span>{diagnosticSize} questions · about {diagnosticMinutes} min</span><p>Scaled-score projections remain withheld until a form has a validated conversion.</p></>}
        </div>
      </section>

      <section className="evidence-class-panel" aria-label="Evidence coverage">
        <div className="panel-heading"><div><span>COMPARISON READINESS</span><h2>{readiness.status === 'ready' ? 'Enough independent evidence to compare periods' : 'Still building a defensible sample'}</h2></div><ShieldAlert /></div>
        <div className="readiness-grid">
          <div><strong>{readiness.lr_samples}</strong><span>Timed LR</span><small>40 recommended</small></div>
          <div><strong>{readiness.rc_samples}</strong><span>Timed RC</span><small>20 recommended</small></div>
          <div><strong>{readiness.completed_diagnostics}</strong><span>Diagnostics</span><small>1 required</small></div>
        </div>
        <details><summary>How evidence is separated</summary><p>Sprint and Diagnostic estimate test performance. Deep Practice measures coached learning. Infinite measures fluency. Review measures recovery. Repeated questions never inflate the timed-unseen headline.</p></details>
      </section>

      <section className="performance-grid">
        <article className="trend-panel">
          <div className="panel-heading"><div><span>PERFORMANCE LINE</span><h2>Accuracy by completed run</h2></div><BarChart3 /></div>
          {trend.length > 1 ? (
            <svg viewBox="0 0 600 180" role="img" aria-label="Accuracy trend across recent sessions">
              {[35,70,105,140].map((y) => <line key={y} x1="20" x2="580" y1={y} y2={y} />)}
              <polyline points={chartPoints} />
              {trend.map((entry, index) => <circle key={entry.id} cx={20 + index * (560 / Math.max(1, trend.length - 1))} cy={160 - entry.accuracy * 1.25} r="5"><title>{entry.accuracy}% · {entry.kind}</title></circle>)}
            </svg>
          ) : <div className="empty-trend"><Activity /><strong>Complete two runs to reveal a trend.</strong><p>One result is a baseline, not improvement.</p></div>}
        </article>

        <article className="priority-panel">
          <div className="panel-heading"><div><span>WEAKEST-LINK SIGNAL</span><h2>{performance.recommendation?.skill ?? 'Still collecting evidence'}</h2></div><Target /></div>
          {performance.recommendation ? <><strong>{performance.recommendation.accuracy}% accuracy</strong><p>Recommended because it currently has the {performance.recommendation.reason}.</p><button className="focus-sprint-button" disabled={startFocus.isPending || Boolean(activePractice)} onClick={() => startFocus.mutate(performance.recommendation!.skill)}>{activePractice ? 'Finish current run first' : startFocus.isPending ? 'Building focus sprint…' : 'Run 3 focused questions'} <ArrowRight size={15} /></button><small>Experimental: this signal updates after every reviewed answer.</small></> : <><p>Complete the diagnostic or a speedrun to identify the first training priority.</p><small>No weakness is inferred without evidence.</small></>}
        </article>
      </section>

      <section className="skill-table-panel">
        <div className="panel-heading"><div><span>SKILL MATRIX</span><h2>Where the points are actually moving</h2></div><Brain /></div>
        {performance.skills.length ? <div className="skill-table"><div className="skill-row header"><span>Question type</span><span>Sample</span><span>Accuracy</span><span>Pace</span><span>Reasoning</span></div>{performance.skills.map((skill) => <div className="skill-row" key={skill.name}><strong>{skill.name}</strong><span>{skill.attempts}</span><span><i style={{ width: `${skill.accuracy}%` }} />{skill.accuracy}%</span><span>{skill.pace_adherence}%</span><span>{skill.reasoning === null ? '—' : `${skill.reasoning}%`}</span></div>)}</div> : <div className="empty-skills"><p>No skill claims yet. The diagnostic creates the first evidence-backed matrix.</p></div>}
      </section>
        </div>
      </div>

      {(startDiagnostic.error || startSpeedrun.error || startFocus.error) && <ErrorNotice error={startDiagnostic.error || startSpeedrun.error || startFocus.error} />}
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


function StoryCutscene({ game, chapter }: { game: GameState; chapter: StoryChapter }) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const [resolution, setResolution] = useState<Awaited<ReturnType<typeof api.chooseStory>> | null>(null)
  useEffect(() => setResolution(null), [chapter.key])
  const choose = useMutation({
    mutationFn: (choiceKey: string) => api.chooseStory(chapter.key, choiceKey),
    onSuccess: (nextResolution, choiceKey) => {
      void play('story', {
        id: `story-choice:${chapter.key}:${choiceKey}`,
        seed: choiceKey,
        intensity: .8,
        profile: {
          officeTier: nextResolution.game.office_tier,
          alignment: nextResolution.game.story.alignment,
        },
      })
      setResolution(nextResolution)
    },
  })
  const continueStory = () => {
    if (!resolution) return
    const nextGame = resolution.game
    void play('paper', { seed: chapter.key, intensity: .45 })
    setResolution(null)
    storeGame(queryClient, nextGame)
  }
  return (
    <div className="cutscene-overlay" role="dialog" aria-modal="true" aria-labelledby="cutscene-title">
      <div className="cutscene-letterbox top" />
      <div className="cutscene-frame">
        <CutsceneArtwork scene={chapter.scene} game={game} />
        <div className="cutscene-act"><span>{chapter.act}</span><small>{chapter.location}</small></div>
        <section className="cutscene-dialogue">
          <span>{chapter.speaker}</span>
          <h2 id="cutscene-title">{chapter.title}</h2>
          {resolution ? (
            <div className="cutscene-resolution">
              <p>{resolution.result.result}</p>
              <button className="cutscene-continue" onClick={continueStory}>Continue <ArrowRight /></button>
            </div>
          ) : (
            <>
              <div className="dialogue-beats">{chapter.dialogue.map((line) => <p key={line}>{line}</p>)}</div>
              <div className="cutscene-choices">
                {chapter.choices.map((choice) => (
                  <button key={choice.key} disabled={choose.isPending} onClick={() => choose.mutate(choice.key)}>
                    <strong>{choice.label}</strong><span>{choice.stakes}</span>
                  </button>
                ))}
              </div>
              {choose.error && <ErrorNotice error={choose.error} />}
            </>
          )}
        </section>
      </div>
      <div className="cutscene-letterbox bottom"><span>YOUR DECISION BECOMES PART OF THE FIRM</span></div>
    </div>
  )
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
  const [gender, setGender] = useState<CharacterGender>('female')
  const [lawyerName, setLawyerName] = useState('')
  const [firmName, setFirmName] = useState('')

  useEffect(() => {
    if (!lawyerName && me.data?.user.display_name) setLawyerName(me.data.user.display_name)
  }, [lawyerName, me.data?.user.display_name])

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
        <span className="step-indicator">YOUR ORIGIN · 01</span>
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
          </nav>
        </aside>
      )}
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
            <p>The final charter is closed. Rent and inactivity loss no longer accrue.</p>
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
      {game.story.pending_chapter && <StoryCutscene game={game} chapter={game.story.pending_chapter} />}
    </div>
  )
}


export function CasesLobbyPage() {
  const navigate = useNavigate()
  const { play } = useSound()
  const queryClient = useQueryClient()
  const [practiceStyle, setPracticeStyle] = useState<'speedrun' | 'deep' | 'infinite' | 'review'>('speedrun')
  const gameQuery = useGame()
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const reviews = useQuery({ queryKey: ['review-queue'], queryFn: api.reviewQueue })
  const docketQuery = useQuery({ queryKey: ['daily-docket'], queryFn: api.dailyDocket })
  const start = useMutation({
    mutationFn: (plan?: { style?: 'speedrun' | 'deep' | 'infinite' | 'review'; size?: number }) => api.startPractice({
      size: plan?.size ?? (plan?.style === 'speedrun' || (!plan?.style && practiceStyle === 'speedrun') ? 10 : 5),
      practice_style: plan?.style ?? practiceStyle,
      feedback_policy: (plan?.style ?? practiceStyle) === 'speedrun' ? 'delayed' : 'immediate',
    }),
    onSuccess: ({ session }) => {
      void play('file-open', { id: `case-open:${session.id}`, seed: session.id, intensity: .62 })
      void queryClient.invalidateQueries({ queryKey: ['daily-docket'] })
      navigate(`/cases/${session.id}`)
    },
  })
  if (gameQuery.isLoading || current.isLoading || reviews.isLoading || docketQuery.isLoading) return <LoadingScreen label="Checking the docket…" />
  const game = gameQuery.data!.game!
  const workingClient = effectiveClient(game)
  const active = current.data?.session
  const dueReviews = reviews.data?.review_queue.due ?? 0
  const daily = docketQuery.data?.daily_docket
  // These three reads are all optional on the page, so a failure used to leave
  // sections quietly missing with no way to recover short of a reload.
  const partialError = docketQuery.error || current.error || reviews.error
  const partialRetrying = docketQuery.isFetching || current.isFetching || reviews.isFetching
  const retryPartial = () => {
    if (docketQuery.error) void docketQuery.refetch()
    if (current.error) void current.refetch()
    if (reviews.error) void reviews.refetch()
  }
  const runNextDocketStep = () => {
    if (!daily) return
    if (daily.next_action.kind === 'resume' || daily.next_action.kind === 'open_brief') {
      if (daily.next_action.session_id) navigate(`/cases/${daily.next_action.session_id}`)
      return
    }
    if (daily.next_action.kind === 'start_review') start.mutate({ style: 'review', size: Math.max(1, daily.review.target) })
    else if (daily.next_action.kind === 'start_speedrun') start.mutate({ style: 'speedrun', size: 10 })
  }
  const practiceModeCopy = {
    speedrun: { title: 'Sprint', detail: '10 timed, unseen questions with results held until the end.', icon: TimerReset },
    infinite: { title: 'Infinite', detail: 'Keep answering with concise reasoning until you choose to stop.', icon: Activity },
    deep: { title: 'Method Lab', detail: 'Explain each rule and receive coaching after every answer.', icon: Brain },
    review: { title: 'Review', detail: dueReviews ? `${dueReviews} spaced-retrieval repair item${dueReviews === 1 ? '' : 's'} ready.` : 'Your repair queue is clear.', icon: BookOpen },
  } as const
  const selectedMode = practiceModeCopy[practiceStyle]
  const SelectedModeIcon = selectedMode.icon
  const openSelectedPractice = () => {
    if (active) {
      void play('resume', { seed: active.id, intensity: .5 })
      navigate(`/cases/${active.id}`)
      return
    }
    start.mutate(undefined)
  }
  return (
    <div className="case-lobby page-wrap">
      {partialError && (
        <div className="partial-load-notice">
          <ErrorNotice error={partialError} retrying={partialRetrying} onRetry={retryPartial} />
          <p>Some of this page could not be loaded, so a few sections may be missing or out of date.</p>
        </div>
      )}
      <section className="mobile-practice-home" aria-label="Practice modes">
        <header className="mobile-learning-header">
          <div><span>PRACTICE</span><h1>Choose the work.</h1></div>
        </header>

        <div className="mobile-practice-client">
          <ClientPortrait kind={workingClient.icon} name={workingClient.name} />
          <span><small>CURRENT CLIENT</small><strong>{workingClient.name}</strong><em>{game.active_client.on_hold ? 'Walk-in matters available' : `${game.active_client.cases_remaining} files remaining`}</em></span>
          <b><Coins size={14} />{formatMoney(workingClient.base_fee, true)} base</b>
        </div>

        {daily && (
          <button className="mobile-docket-next" onClick={runNextDocketStep} disabled={start.isPending || daily.next_action.kind === 'done'}>
            <span><small>TODAY’S DOCKET</small><strong>{daily.next_action.kind === 'done' ? 'Training loop complete' : daily.next_action.label}</strong><em>{daily.review.due} due · {daily.speedrun.state === 'complete' ? 'sprint complete' : 'sprint waiting'} · {daily.deep_brief.priority_count} to brief</em></span>
            {daily.next_action.kind === 'done' ? <CheckCircle2 /> : <ArrowRight />}
          </button>
        )}

        <div className="mobile-practice-mode-label"><span>SELECT A MODE</span><small>One tap changes the purpose of the run.</small></div>
        <div className="mobile-practice-modes" role="tablist" aria-label="Choose a practice mode">
          {(['speedrun', 'infinite', 'deep'] as const).map((mode) => {
            const ModeIcon = practiceModeCopy[mode].icon
            return <button type="button" role="tab" aria-selected={practiceStyle === mode} className={practiceStyle === mode ? 'active' : ''} onClick={() => { setPracticeStyle(mode); void play('tab', { seed: `mobile-practice:${mode}`, intensity: .26 }) }} key={mode}><ModeIcon size={18} /><span>{practiceModeCopy[mode].title}</span></button>
          })}
        </div>
        <button type="button" className={`mobile-practice-review ${practiceStyle === 'review' ? 'active' : ''}`} aria-pressed={practiceStyle === 'review'} disabled={!dueReviews} onClick={() => { setPracticeStyle('review'); void play('paper', { seed: 'mobile-practice:review', intensity: .35 }) }}>
          <BookOpen size={19} />
          <span><strong>Spaced review</strong><small>{dueReviews ? 'Repair the questions that are ready today.' : 'Nothing is due right now.'}</small></span>
          <b>{dueReviews || <Check size={14} />}</b>
          <ArrowRight size={17} />
        </button>

        <div className="mobile-practice-selection">
          <SelectedModeIcon size={23} />
          <div><strong>{active ? 'Active run in progress' : selectedMode.title}</strong><p>{active ? 'Continue where you left off before opening another file.' : selectedMode.detail}</p></div>
        </div>
        <button className="mobile-practice-start" onClick={openSelectedPractice} disabled={start.isPending || (!active && practiceStyle === 'review' && !dueReviews)}>
          {start.isPending ? 'Preparing run…' : active ? 'Continue active run' : `Start ${selectedMode.title}`} <ArrowRight />
        </button>
        {start.error && <ErrorNotice error={start.error} />}
      </section>

      <section className="docket-hero">
        <PixelStudyScenery variant="docket" className="docket-scenery" />
        <div className="docket-copy">
          <span className="eyebrow gold">LSAT SPEEDRUN</span>
          <h1>More questions.<br />Cleaner review.<br /><em>Measured improvement.</em></h1>
          <p>Choose the amount of friction you need. Answer-only modes build volume; Method Lab is there when the reasoning itself needs work.</p>
          <button className="primary-button jumbo" onClick={() => {
            if (active) {
              void play('resume', { seed: active.id, intensity: .5 })
              navigate(`/cases/${active.id}`)
            } else start.mutate(undefined)
          }} disabled={start.isPending || (!active && practiceStyle === 'review' && !dueReviews)}>
            <BriefcaseBusiness /> {active ? 'Resume active run' : start.isPending ? 'Building your run…' : practiceStyle === 'speedrun' ? 'Start 10-question Sprint' : practiceStyle === 'infinite' ? 'Start Infinite mode' : practiceStyle === 'review' ? `Review ${dueReviews} due` : 'Start Deep Practice'} <ArrowRight />
          </button>
          {start.error && <ErrorNotice error={start.error} />}
        </div>
        <div className="case-brief-card">
          <div className="brief-stamp">{game.active_client.on_hold ? 'EFFECTIVE CLIENT' : 'ACTIVE CLIENT'}</div>
          <ClientPortrait kind={workingClient.icon} name={workingClient.name} className="lobby-client-portrait" />
          <h2>{workingClient.name}</h2>
          <p>{game.active_client.on_hold
            ? `${game.active_client.name} is on hold until your Reputation recovers. Walk-in matters remain available at the fee below.`
            : workingClient.description}</p>
          <div className="brief-terms"><span><Coins /> Effective base fee<strong>{formatMoney(workingClient.base_fee)}</strong></span><span><BriefcaseBusiness /> Contract<strong>{game.active_client.on_hold ? `${game.active_client.name} paused` : `${game.active_client.cases_remaining} cases`}</strong></span><span><Flame /> Validated streak<strong>{game.current_streak}</strong></span></div>
        </div>
      </section>
      {daily && <section className="daily-docket" aria-labelledby="daily-docket-title">
        <header>
          <div><span className="eyebrow">TODAY'S DOCKET · {daily.date}</span><h2 id="daily-docket-title">One measured loop. No busywork.</h2><p>Repair what is due, produce fresh timed evidence, then brief only the decisions worth revisiting.</p></div>
          <button className="daily-docket-action" onClick={runNextDocketStep} disabled={start.isPending || daily.next_action.kind === 'done'}>{daily.next_action.kind === 'done' ? <CheckCircle2 /> : <ArrowRight />}<span><small>NEXT ACTION</small><strong>{start.isPending ? 'Preparing docket…' : daily.next_action.label}</strong></span></button>
        </header>
        <div className="daily-docket-track">
          <article className={`state-${daily.review.state}`}><b>01</b><div><span><TimerReset /> DUE REVIEW</span><strong>{daily.review.state === 'clear' ? 'Queue clear' : `${daily.review.target || daily.review.due} priority repair${(daily.review.target || daily.review.due) === 1 ? '' : 's'}`}</strong><small>Spaced retrieval · reasoning only where needed</small></div><i>{daily.review.state === 'complete' || daily.review.state === 'clear' ? <Check /> : daily.review.state === 'locked' ? <Lock /> : 'NOW'}</i></article>
          <article className={`state-${daily.speedrun.state}`}><b>02</b><div><span><TimerReset /> SPEEDRUN</span><strong>10 timed unseen questions</strong><small>Answer only · confidence captured · results held to the end</small></div><i>{daily.speedrun.state === 'complete' ? <Check /> : daily.speedrun.state === 'locked' ? <Lock /> : daily.speedrun.state === 'active' ? 'LIVE' : 'NEXT'}</i></article>
          <article className={`state-${daily.deep_brief.state}`}><b>03</b><div><span><Brain /> DEEP BRIEF</span><strong>{daily.deep_brief.priority_count ? `${daily.deep_brief.priority_count} decision${daily.deep_brief.priority_count === 1 ? '' : 's'} to audit` : 'Confirm what held'}</strong><small>Correct rule · selected trap · transfer cue</small></div><i>{daily.deep_brief.state === 'complete' ? <Check /> : daily.deep_brief.state === 'locked' ? <Lock /> : 'OPEN'}</i></article>
        </div>
      </section>}
      <div className="practice-mode-heading"><span className="eyebrow">CHOOSE ANOTHER MODE</span><p>The Daily Docket is the default. Use these when you need a specific kind of practice.</p></div>
      <section className="practice-mode-picker" aria-label="Choose a study mode">
        <button className={practiceStyle === 'speedrun' ? 'active' : ''} onClick={() => setPracticeStyle('speedrun')}><TimerReset /><span><strong>Sprint</strong><small>10 timed answers · review at end</small></span></button>
        <button className={practiceStyle === 'infinite' ? 'active' : ''} onClick={() => setPracticeStyle('infinite')}><Activity /><span><strong>Infinite</strong><small>Answer · concise reasoning · repeat</small></span></button>
        <button className={practiceStyle === 'deep' ? 'active' : ''} onClick={() => setPracticeStyle('deep')}><Brain /><span><strong>Method Lab</strong><small>Write every rule · immediate coaching</small></span></button>
        <button className={practiceStyle === 'review' ? 'active' : ''} onClick={() => setPracticeStyle('review')} disabled={!dueReviews}><TimerReset /><span><strong>Review</strong><small>{dueReviews ? `${dueReviews} repair item${dueReviews === 1 ? '' : 's'} due` : 'Queue clear'}</small></span></button>
      </section>
      <section className="how-scoring-works">
        <span className="eyebrow">THE LEARNING LOOP</span>
        <div>
          <article><span>01</span><Scale /><h3>Answer</h3><p>The verified key—not AI—determines correctness.</p></article>
          <article><span>02</span><BookOpen /><h3>Understand</h3><p>Every checked answer receives concise reasoning.</p></article>
          <article><span>03</span><Brain /><h3>Repair</h3><p>Only uncertain, slow, or missed work enters review.</p></article>
          <article><span>04</span><TrendingUp /><h3>Transfer</h3><p>Unseen questions prove that the method held.</p></article>
        </div>
      </section>
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
    mutationFn: () => api.startPractice({ size: Math.min(5, Math.max(1, dueReviews)), practice_style: 'review', feedback_policy: 'immediate' }),
    onSuccess: ({ session }) => {
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
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
  const isSpeedrun = review.session.practice_style === 'speedrun'
  const correctChoice = selected?.question.choices.find((choice) => choice.label === selected.correct_label)
  const selectedChoice = selected?.question.choices.find((choice) => choice.label === selected.selected_label)
  const rationale = coaching.data?.coaching

  return (
    <div className="session-review-page page-wrap">
      <section className="review-summary-hero">
        <div>
          <span className="eyebrow">{isDiagnostic ? 'DIAGNOSTIC COMPLETE' : isSpeedrun ? 'DEEP BRIEF' : `${review.session.practice_style.toUpperCase()} COMPLETE`}</span>
          <h1>{priorityItems.length ? 'Brief the decisions that can change your next run.' : 'Clean run. Confirm what held.'}</h1>
          <p>Results are separated from firm currency and rank. Open any question for a concise rationale; only mistakes and uncertainty enter repair.</p>
        </div>
        <div className="review-score"><strong>{summary.accuracy}%</strong><span>{summary.correct} of {summary.questions_completed} correct</span><small>{summary.elapsed_minutes} minutes</small></div>
      </section>

      <section className="review-signal-row" aria-label="Run signals">
        <article><Target /><span>Accuracy</span><strong>{summary.accuracy}%</strong></article>
        <article><Clock3 /><span>Elapsed</span><strong>{summary.elapsed_minutes}m</strong></article>
        <article><ShieldAlert /><span>Confident misses</span><strong>{highConfidenceErrors}</strong></article>
        <article><Brain /><span>Priority repairs</span><strong>{priorityItems.length}</strong></article>
      </section>

      <section className="answer-audit-shell">
        <aside className="answer-audit-index" aria-label="Questions in this run">
          <div><span>{isSpeedrun ? 'DEEP BRIEF' : 'ANSWER AUDIT'}</span><small>{priorityOnly && priorityItems.length ? `${priorityItems.length} priority decisions` : `All ${review.items.length} questions`}</small></div>
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
        <div><span className="eyebrow">NEXT BEST ACTION</span><h2>{dueReviews ? `Repair ${Math.min(5, dueReviews)} due item${dueReviews === 1 ? '' : 's'}` : 'Return to unseen questions'}</h2><p>{dueReviews ? 'Write reasoning only where the evidence says it is needed.' : 'Your repair queue is clear; another Sprint provides fresh transfer evidence.'}</p></div>
        <div>
          {isSpeedrun && <button className="primary-button" onClick={() => finishBrief.mutate()} disabled={finishBrief.isPending}>{finishBrief.isPending ? 'Closing brief…' : 'Finish Deep Brief'} <CheckCircle2 /></button>}
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
      {!session.pending_result && <div className="session-controls"><PauseButton sessionId={session.id} returnTo={session.mode === 'diagnostic' ? '/progress' : '/office'} /></div>}
      <QuestionFlow session={session} />
    </div>
  )
}


type FirmTab = 'upgrades' | 'staff' | 'clients' | 'connections' | 'rivals' | 'achievements'

const firmTabs: Array<{ key: FirmTab; label: string; icon: typeof Wrench }> = [
  { key: 'upgrades', label: 'Upgrades', icon: Wrench },
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
  const typeMap: Record<FirmTab, GameAsset['type'] | null> = { upgrades: 'upgrade', staff: 'staff', clients: null, connections: 'connection', rivals: 'rival', achievements: null }
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
          <div className="tier-buy"><strong>{formatMoney(nextTier.cost)}</strong><button className="primary-button" disabled={!nextTier.available || game.cash < nextTier.cost || advance.isPending} onClick={() => advance.mutate(nextTier.tier)}>{advance.isPending ? 'Renovating…' : 'Advance firm'}</button></div>
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
                <button className={item.selected ? 'secondary-button full' : 'primary-button full'} disabled={!item.unlocked || item.selected || client.isPending} onClick={() => client.mutate(item.key)}>{client.isPending && client.variables === item.key ? 'Switching files…' : item.on_hold ? 'Current client · On hold' : item.selected ? 'Working these cases' : `Work for ${item.name}`}</button>
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
               <div className="purchase-row"><strong>{item.list_cost && item.list_cost > item.cost ? <><del>{formatMoney(item.list_cost)}</del>{formatMoney(item.cost)} <small>−{(item.discount_bps! / 100).toFixed(0)}%</small></> : formatMoney(item.cost)}</strong><button className="primary-button" disabled={item.owned || !item.available || game.cash < item.cost || purchase.isPending} onClick={() => purchase.mutate(item.key)}>{item.owned ? 'Installed' : game.cash < item.cost ? 'Keep earning' : 'Purchase'}</button></div>
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
  const gameQuery = useGame()
  if (gameQuery.isLoading) return <LoadingScreen />
  const game = gameQuery.data!.game!
  return (
    <div className="map-page empire-game-page">
      <section className="empire-command-bar">
        <div><span className="pixel-kicker">FIVE LIVING ENVIRONMENTS · {game.catalog.tiers.length} HEADQUARTERS LEVELS</span><h1>Your legal empire</h1><p>Enter each career arc as a complete district, with every headquarters built directly into its streets.</p></div>
        <div><small>EMPIRE VALUE</small><strong>{formatMoney(game.firm_valuation, true)}</strong><span>HQ · {game.office.name}</span></div>
      </section>
      <EmpireWorldMap game={game} onManage={(tab) => navigate(`/firm?tab=${tab}`)} />
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
        <div className="story-section-heading"><span>01 · THE CAMPAIGN</span><h2>From one light to a constellation</h2><p>Chapters unlock with headquarters tiers. Story decisions are permanent.</p></div>
        <div className="chapter-track">
          {story.chapters.map((chapter, index) => (
            <article key={chapter.key} className={`${chapter.seen ? 'seen' : ''} ${story.pending_chapter?.key === chapter.key ? 'pending' : ''}`}>
              <i>{chapter.seen ? <Check /> : story.pending_chapter?.key === chapter.key ? '!' : <Lock />}</i>
              <span>{chapter.act} · HQ {chapter.tier}</span><h3>{chapter.title}</h3>
              <small>{chapter.choice ? `Decision: ${chapter.choice.replaceAll('_', ' ')}` : chapter.tier <= game.office_tier ? 'Decision waiting' : `Unlocks at headquarters tier ${chapter.tier}`}</small>
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
        <div className="story-section-heading"><span>02 · OPTIONAL FILES</span><h2>Choose the work behind the work</h2><p>Only one operation can occupy the caseboard. Hidden files surface when your Ethics and Intel make the right people trust—or target—you.</p></div>
        {grouped.map(({ category, quests }) => {
          const presentation = questPresentation[category]
          const Icon = presentation.icon
          return <div className={`quest-shelf quest-shelf-${category}`} key={category}>
            <header><Icon /><div><span>{presentation.label}</span><small>{presentation.copy}</small></div></header>
            <div className="quest-grid">{quests.map((quest) => (
              <article key={quest.key} className={`${quest.active ? 'active' : ''} ${quest.completed ? 'completed' : ''}`}>
                <div className="dossier-top"><span>HQ {quest.tier} · {quest.patron}</span><i>{quest.completed ? 'CLOSED' : quest.active ? 'ACTIVE' : 'OPEN'}</i></div>
                <h3>{quest.title}</h3><p>{quest.description}</p><strong>{quest.objective}</strong>
                {quest.start_label && <small className="quest-cost">Opening cost: {quest.start_label}</small>}
                <small className="quest-reward">Reward: {quest.reward_label}</small>
                <button disabled={!quest.available || startQuestMutation.isPending} onClick={() => startQuestMutation.mutate(quest.key)}>{quest.completed ? 'File closed' : quest.active ? `${quest.progress} / ${quest.target}` : story.active_quest ? 'Caseboard occupied' : 'Open this file'}</button>
              </article>
            ))}</div>
          </div>
        })}
      </section>

      <section className="rival-war-room">
        <div className="story-section-heading light"><span>03 · RIVAL OPERATIONS</span><h2>Win clean—or make them cheaper.</h2><p>Each operation can be used once per rival. Discounts stack to 45%; sabotage trades the firm’s name for a lower acquisition price.</p></div>
        {rival ? <>
          <div className="rival-target-strip">
            {story.rival_targets.map((target) => <button key={target.key} className={target.key === rival.key ? 'active' : ''} onClick={() => {
              if (target.key !== rival.key) void play('select', { seed: target.key, intensity: .3 })
              setSelectedRival(target.key)
            }}><PixelAssetArtwork asset={target} /><span>{target.name.replace('Acquire ', '')}</span><small>HQ {target.tier}</small></button>)}
          </div>
          <div className="rival-valuation-card">
            <div><span>ACQUISITION TARGET</span><h3>{rival.name}</h3><p>{rival.description}</p></div>
            <div><small>LIST VALUE</small><del>{formatMoney(rival.list_cost ?? rival.cost)}</del><small>NEGOTIATED VALUE</small><strong>{formatMoney(rival.cost)}</strong><b>{(rival.discount_bps ?? 0) / 100}% DISCOUNT</b></div>
          </div>
          <div className="operation-grid">{rival.operations.map((item) => (
            <article key={item.key} className={`operation-${item.category} ${item.completed ? 'completed' : ''}`}>
              <div><span>{item.category}</span><strong>−{item.discount_bps / 100}%</strong></div><h3>{item.name}</h3><p>{item.description}</p>
              <small>{formatMoney(item.cost)}{item.intel ? ` · ${item.intel} Intel` : ''}{item.influence ? ` · ${item.influence} Influence` : ''}{item.heat_surcharge_bps ? ` · +${item.heat_surcharge_bps / 100}% Heat surcharge` : ''}</small>
              {item.missing.length > 0 && <em>Needs {item.missing.join(' · ')}</em>}
              <button disabled={!item.available || operation.isPending} onClick={() => operation.mutate({ rivalKey: rival.key, operationKey: item.key })}>{item.completed ? 'Operation complete' : item.category === 'sabotage' ? 'Authorize sabotage' : 'Launch operation'}</button>
            </article>
          ))}</div>
        </> : <div className="all-rivals-acquired"><Trophy /><h3>Every rival has joined the network.</h3><p>The war room is quiet. The legacy question remains.</p></div>}
      </section>
      {(startQuestMutation.error || operation.error) && <ErrorNotice error={startQuestMutation.error || operation.error} />}
      {story.pending_chapter && <StoryCutscene game={game} chapter={story.pending_chapter} />}
    </div>
  )
}
