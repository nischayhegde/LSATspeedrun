import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Crosshair,
  FileCheck2,
  Gauge,
  LockKeyhole,
  Medal,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  TimerReset,
  Trophy,
  Zap,
} from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { api, ApiError } from './api'
import { Brand, ErrorNotice, LoadingScreen, NoirScene, QuestionFlow } from './components'
import type { DiagnosticResults, DailySummary } from './types'

export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [authError, setAuthError] = useState<unknown>(null)
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig })
  const existing = useQuery({ queryKey: ['me'], queryFn: api.me })
  const finishLogin = async (credential: string) => {
    try {
      const data = await api.googleLogin(credential)
      queryClient.setQueryData(['me'], data)
      navigate(data.user.next_route)
    } catch (error) {
      setAuthError(error)
    }
  }
  const devLogin = useMutation({
    mutationFn: api.devLogin,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      navigate(data.user.next_route)
    },
  })

  useEffect(() => {
    if (existing.data?.user) navigate(existing.data.user.next_route, { replace: true })
  }, [existing.data, navigate])

  useEffect(() => {
    if (!config.data?.google_client_id) return
    const render = () => {
      if (!window.google || !buttonRef.current) return
      window.google.accounts.id.initialize({ client_id: config.data!.google_client_id!, callback: ({ credential }) => void finishLogin(credential) })
      buttonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', shape: 'pill', width: 320, text: 'continue_with' })
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
  }, [config.data?.google_client_id])

  return (
    <div className="login-page">
      <div className="login-brand"><Brand /></div>
      <section className="login-story">
        <div className="login-overlay-copy">
          <div className="eyebrow">THE LANTERN BUREAU IS RECRUITING</div>
          <h1>Every argument<br />leaves a trace.</h1>
          <p>Train your reasoning. Build real speed. Close cases designed around the logic the LSAT actually tests.</p>
          <div className="proof-row">
            <span><ShieldCheck /> Verified scoring</span>
            <span><TimerReset /> Pace without guessing</span>
            <span><BrainCircuit /> Adaptive cases</span>
          </div>
        </div>
        <NoirScene chapter={1} />
      </section>
      <section className="login-card-wrap">
        <div className="login-card">
          <div className="file-stamp">CONFIDENTIAL</div>
          <div className="eyebrow">DETECTIVE ACCESS</div>
          <h2>Enter the Bureau</h2>
          <p>Your diagnostic, weak areas, pace, and story progress follow you from the first case.</p>
          <div ref={buttonRef} className="google-button-slot" />
          {!config.isLoading && !config.data?.google_client_id && (
            <div className="config-note"><LockKeyhole size={16} /> Add <code>GOOGLE_CLIENT_ID</code> to enable Google sign-in.</div>
          )}
          {config.data?.dev_auth_enabled && (
            <button className="dev-login-button" onClick={() => devLogin.mutate()} disabled={devLogin.isPending}>
              <Play size={16} /> {devLogin.isPending ? 'Opening local file…' : 'Continue in local demo'}
            </button>
          )}
          {(authError || devLogin.error) && <ErrorNotice error={authError || devLogin.error} />}
          <small className="privacy-note">By continuing, you agree to save your learning progress to your private account.</small>
        </div>
      </section>
    </div>
  )
}

const timeOptions = [
  { minutes: 20, label: 'Quick casework', detail: '4–8 focused files', icon: Zap },
  { minutes: 30, label: 'Daily standard', detail: 'A balanced shift', icon: Clock3 },
  { minutes: 45, label: 'Deep investigation', detail: 'Broader skill mix', icon: Crosshair },
  { minutes: 60, label: 'Full bureau shift', detail: 'Maximum practice', icon: Medal },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const [selected, setSelected] = useState(me.data?.user.target_minutes || 20)
  const mutation = useMutation({
    mutationFn: () => api.savePreferences(selected),
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      navigate('/diagnostic')
    },
  })

  return (
    <div className="contained onboarding-page">
      <div className="onboarding-copy">
        <div className="step-pill">SETUP · 1 OF 1</div>
        <div className="eyebrow">YOUR DAILY BRIEF</div>
        <h1>How long is your shift?</h1>
        <p>Sherlock will build each case session around the time you actually have. You can change this later.</p>
      </div>
      <div className="time-grid">
        {timeOptions.map(({ minutes, label, detail, icon: Icon }) => (
          <button key={minutes} className={`time-option ${selected === minutes ? 'selected' : ''}`} onClick={() => setSelected(minutes)}>
            <span className="time-icon"><Icon /></span>
            <strong>{minutes}<small>MIN</small></strong>
            <span>{label}</span>
            <em>{detail}</em>
            {selected === minutes && <CheckCircle2 className="time-check" />}
          </button>
        ))}
      </div>
      {mutation.error && <ErrorNotice error={mutation.error} />}
      <button className="primary-button large-button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving brief…' : <>Continue to diagnostic <ArrowRight /></>}
      </button>
    </div>
  )
}

export function DiagnosticPage() {
  const navigate = useNavigate()
  const diagnostic = useQuery({ queryKey: ['diagnostic'], queryFn: api.currentDiagnostic })
  const start = useMutation({
    mutationFn: api.startDiagnostic,
    onSuccess: () => diagnostic.refetch(),
  })

  useEffect(() => {
    if (diagnostic.data?.status === 'completed') navigate('/diagnostic/results', { replace: true })
  }, [diagnostic.data?.status, navigate])
  if (diagnostic.isLoading) return <LoadingScreen />
  if (diagnostic.error) return <ErrorNotice error={diagnostic.error} />
  if (diagnostic.data?.status === 'in_progress' && diagnostic.data.session) return <QuestionFlow session={diagnostic.data.session} />

  return (
    <div className="diagnostic-intro page-hero">
      <div className="intro-scene"><NoirScene chapter={1} compact /></div>
      <div className="intro-copy">
        <div className="eyebrow">ORIENTATION FILE 001</div>
        <h1>Establish your<br />reasoning profile.</h1>
        <p>Thirty-five timed questions will give the Bureau a baseline for your score, pace, and weak areas. Some files ask you to show your reasoning.</p>
        <div className="intro-facts">
          <div><Clock3 /><span><strong>About 70 min</strong>Take breaks if needed</span></div>
          <div><BookOpen /><span><strong>35 questions</strong>LR + Reading Comp</span></div>
          <div><Target /><span><strong>Unofficial estimate</strong>Score + confidence range</span></div>
        </div>
        {start.error && <ErrorNotice error={start.error} />}
        <button className="primary-button large-button" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? 'Assembling files…' : <>Begin diagnostic <ChevronRight /></>}
        </button>
        <small>Every answer is saved the moment you file it. You can safely return later.</small>
      </div>
    </div>
  )
}

function ScoreGauge({ results }: { results: DiagnosticResults }) {
  const percent = ((results.estimated_score - 120) / 60) * 100
  return (
    <div className="score-gauge" style={{ '--score': `${percent * 1.8}deg` } as React.CSSProperties}>
      <div><small>ESTIMATED</small><strong>{results.estimated_score}</strong><span>LSAT</span></div>
    </div>
  )
}

export function DiagnosticResultsPage() {
  const navigate = useNavigate()
  const diagnostic = useQuery({ queryKey: ['diagnostic'], queryFn: api.currentDiagnostic })
  if (diagnostic.isLoading) return <LoadingScreen label="Developing your diagnostic…" />
  if (diagnostic.error) return <ErrorNotice error={diagnostic.error} />
  if (diagnostic.data?.status !== 'completed' || !diagnostic.data.results) return <Navigate to="/diagnostic" replace />
  const results = diagnostic.data.results
  return (
    <div className="results-page contained wide">
      <section className="results-header">
        <div>
          <div className="eyebrow">DIAGNOSTIC COMPLETE · PROFILE V1</div>
          <h1>The evidence is in.</h1>
          <p>{results.message}</p>
          <div className="confidence-badge"><ShieldCheck /> {results.confidence} confidence · {results.confidence_low}–{results.confidence_high}</div>
        </div>
        <ScoreGauge results={results} />
      </section>
      <section className="results-grid">
        <div className="report-card">
          <div className="card-heading"><Crosshair /><div><small>PRIMARY LEADS</small><h2>Focus areas</h2></div></div>
          <div className="weak-list">
            {results.weak_areas.map((skill, index) => (
              <div key={skill.name}>
                <span className="rank-number">0{index + 1}</span>
                <div><strong>{skill.name}</strong><small>{skill.average_time_seconds}s average · {skill.attempts} observed</small></div>
                <div className="accuracy-ring">{skill.accuracy}%</div>
              </div>
            ))}
          </div>
        </div>
        <div className="report-card">
          <div className="card-heading"><BarChart3 /><div><small>SECTION READOUT</small><h2>Accuracy profile</h2></div></div>
          {Object.entries(results.section_accuracy).map(([section, value]) => (
            <div className="metric-bar" key={section}>
              <div><span>{section}</span><strong>{value}%</strong></div>
              <div><span style={{ width: `${value}%` }} /></div>
            </div>
          ))}
          <div className="case-note"><BrainCircuit /><p>Your first daily shift will prioritize weak types while interleaving stronger ones to keep the reasoning flexible.</p></div>
        </div>
      </section>
      <button className="primary-button large-button center-button" onClick={() => navigate('/study')}>Enter story mode <ArrowRight /></button>
    </div>
  )
}

export function StudyHomePage() {
  const navigate = useNavigate()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const progress = useQuery({ queryKey: ['progress'], queryFn: api.progress })
  const start = useMutation({
    mutationFn: api.startDaily,
    onSuccess: ({ session }) => navigate(`/study/${session.id}`),
  })
  if (me.isLoading || progress.isLoading) return <LoadingScreen />
  if (me.error || progress.error) return <ErrorNotice error={me.error || progress.error} />
  const user = me.data!.user
  const weak = progress.data!.skills.slice(0, 3)
  return (
    <div className="study-home">
      <section className="study-hero">
        <div className="study-hero-copy contained wide">
          <div className="eyebrow">THE LANTERN BUREAU · CHAPTER {user.story.chapter}</div>
          <h1>Good evening,<br />Detective {user.display_name.split(' ')[0]}.</h1>
          <p>A fresh set of arguments crossed Chief Voss's desk. Today's files have been selected from your timing, recent misses, and diagnostic profile.</p>
          <button className="primary-button large-button" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? 'Unsealing case files…' : <><Play fill="currentColor" /> Start {user.target_minutes}-minute shift</>}
          </button>
          {start.error && <ErrorNotice error={start.error} />}
        </div>
        <div className="study-scene"><NoirScene chapter={user.story.chapter} /></div>
      </section>
      <section className="dashboard-strip contained wide">
        <div className="dashboard-stat"><span><Gauge /></span><div><small>READINESS</small><strong>{progress.data!.readiness?.estimated_score || '—'}</strong><em>estimated LSAT</em></div></div>
        <div className="dashboard-stat"><span><Target /></span><div><small>ACCURACY</small><strong>{progress.data!.totals.accuracy}%</strong><em>{progress.data!.totals.attempts} files reviewed</em></div></div>
        <div className="dashboard-stat"><span><FileCheck2 /></span><div><small>CASES CLOSED</small><strong>{user.story.cases_solved}</strong><em>Chapter {user.story.chapter}</em></div></div>
        <div className="dashboard-stat"><span><Sparkles /></span><div><small>BUREAU XP</small><strong>{user.story.xp}</strong><em>Progress preserved</em></div></div>
      </section>
      <section className="today-plan contained wide">
        <div className="section-title"><div><div className="eyebrow">ADAPTIVE BRIEF</div><h2>Today's investigative leads</h2></div><button className="text-button" onClick={() => navigate('/progress')}>Full progress <ArrowRight /></button></div>
        <div className="lead-grid">
          {(weak.length ? weak : [
            { name: 'Your diagnostic will set the first lead', accuracy: 0, attempts: 0, average_time_seconds: 0, pace_unlocked: false },
          ]).map((skill, index) => (
            <article className="lead-card" key={skill.name}>
              <span className="lead-index">LEAD 0{index + 1}</span>
              <h3>{skill.name}</h3>
              <p>{skill.attempts ? `${skill.accuracy}% accuracy across ${skill.attempts} observed files.` : 'The scheduler is collecting enough evidence to rank this skill.'}</p>
              <div className="lead-footer"><span>{skill.pace_unlocked ? <><Zap /> Pace active</> : <><ShieldCheck /> Accuracy first</>}</span><ChevronRight /></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export function SessionPage() {
  const { sessionId } = useParams()
  const query = useQuery({ queryKey: ['session', sessionId], queryFn: () => api.session(sessionId!), enabled: Boolean(sessionId) })
  if (query.isLoading) return <LoadingScreen label="Restoring your active case…" />
  if (query.error) return <ErrorNotice error={query.error} />
  if (query.data!.session.status === 'completed') return <Navigate to={`/session/${sessionId}/summary`} replace />
  return <QuestionFlow session={query.data!.session} />
}

export function SessionSummaryPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['summary', sessionId], queryFn: () => api.sessionSummary(sessionId!), enabled: Boolean(sessionId) })
  useEffect(() => {
    if (query.data) {
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      void queryClient.invalidateQueries({ queryKey: ['progress'] })
    }
  }, [query.data, queryClient])
  if (query.isLoading) return <LoadingScreen label="Writing the case debrief…" />
  if (query.error) return <ErrorNotice error={query.error} />
  const summary = query.data!.summary
  return (
    <div className="summary-page contained wide">
      <section className="summary-title">
        <div className="completion-seal"><CheckCircle2 /></div>
        <div className="eyebrow">SHIFT COMPLETE</div>
        <h1>Case files secured.</h1>
        <p>Progress, timing, and skill evidence have been saved to your Bureau record.</p>
      </section>
      <section className="summary-metrics">
        <div><Target /><small>ACCURACY</small><strong>{summary.accuracy}%</strong><span>{summary.correct}/{summary.questions_completed} correct</span></div>
        <div><Clock3 /><small>ACTIVE TIME</small><strong>{summary.elapsed_minutes}</strong><span>minutes recorded</span></div>
        <div><Zap /><small>CAPM</small><strong>{summary.capm ?? '—'}</strong><span>{summary.pace_unlocked ? 'pace score live' : 'accuracy-first mode'}</span></div>
        <div><Sparkles /><small>XP EARNED</small><strong>+{summary.xp_earned}</strong><span>added to your record</span></div>
      </section>
      <section className="summary-details">
        <div className="report-card">
          <div className="card-heading"><Gauge /><div><small>SPEED LAYER</small><h2>Your pace status</h2></div></div>
          <p>{summary.pace_message}</p>
          {summary.ghost ? <div className="ghost-callout"><Trophy /><div><strong>{summary.ghost.baseline}</strong><p>{summary.ghost.message}</p></div></div> : <div className="ghost-callout muted"><LockKeyhole /><div><strong>Your ghost is taking shape</strong><p>Complete another comparable shift to race your past performance.</p></div></div>}
        </div>
        <div className="report-card">
          <div className="card-heading"><BrainCircuit /><div><small>SKILL EVIDENCE</small><h2>This shift</h2></div></div>
          <div className="compact-skill-list">
            {summary.skills.slice(0, 5).map((skill) => <div key={skill.name}><span>{skill.name}</span><strong>{skill.accuracy}%</strong></div>)}
          </div>
        </div>
      </section>
      <div className="summary-actions">
        <button className="secondary-button" onClick={() => navigate('/progress')}><BarChart3 /> View progress</button>
        <button className="primary-button" onClick={() => navigate('/study')}>Return to Bureau <ArrowRight /></button>
      </div>
    </div>
  )
}

export function ProgressPage() {
  const progress = useQuery({ queryKey: ['progress'], queryFn: api.progress })
  if (progress.isLoading) return <LoadingScreen label="Retrieving your Bureau record…" />
  if (progress.error) return <ErrorNotice error={progress.error} />
  const data = progress.data!
  const maxCapm = Math.max(1, ...data.pace_history.map((point) => point.capm || 0))
  return (
    <div className="progress-page contained wide">
      <section className="progress-title">
        <div><div className="eyebrow">PRIVATE BUREAU RECORD</div><h1>Your evidence of progress.</h1><p>Accuracy stays visible. Speed appears only where your reasoning is already reliable.</p></div>
        <div className="chapter-badge"><span>CHAPTER</span><strong>{data.story.chapter}</strong><em>{data.story.cases_solved} cases solved</em></div>
      </section>
      <section className="summary-metrics progress-metrics">
        <div><Gauge /><small>READINESS</small><strong>{data.readiness?.estimated_score ?? '—'}</strong><span>{data.readiness ? `${data.readiness.confidence_low}–${data.readiness.confidence_high} range` : 'diagnostic pending'}</span></div>
        <div><Target /><small>ALL-TIME ACCURACY</small><strong>{data.totals.accuracy}%</strong><span>{data.totals.attempts} attempts</span></div>
        <div><FileCheck2 /><small>DAILY SHIFTS</small><strong>{data.totals.sessions}</strong><span>completed</span></div>
        <div><Sparkles /><small>TOTAL XP</small><strong>{data.story.xp}</strong><span>saved to account</span></div>
      </section>
      <section className="progress-grid">
        <div className="report-card skill-record">
          <div className="card-heading"><BrainCircuit /><div><small>SKILL RECORD</small><h2>Accuracy and timing</h2></div></div>
          {data.skills.length ? data.skills.slice(0, 10).map((skill) => (
            <div className="skill-row" key={skill.name}>
              <div><strong>{skill.name}</strong><small>{skill.attempts} attempts · {skill.average_time_seconds}s average</small></div>
              <div className="mini-bar"><span style={{ width: `${skill.accuracy}%` }} /></div>
              <strong>{skill.accuracy}%</strong>
              <span className={`pace-lock ${skill.pace_unlocked ? 'unlocked' : ''}`} title={skill.pace_unlocked ? 'CAPM active' : 'Accuracy-first'}>{skill.pace_unlocked ? <Zap /> : <LockKeyhole />}</span>
            </div>
          )) : <p className="empty-state">Complete the diagnostic to begin your skill record.</p>}
        </div>
        <div className="report-card pace-card">
          <div className="card-heading"><BarChart3 /><div><small>PACE HISTORY</small><h2>Race your past self</h2></div></div>
          {data.pace_history.length ? (
            <div className="pace-chart">
              {data.pace_history.map((point) => <div key={point.date} className="chart-column"><div className="chart-value">{point.capm ?? '—'}</div><span style={{ height: `${point.capm ? Math.max(12, point.capm / maxCapm * 100) : 8}%` }} /><small>{new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>)}
            </div>
          ) : <div className="empty-chart"><RotateCcw /><strong>Your first ghost appears after two scored shifts.</strong><p>New skills stay in accuracy-first mode until the pace gate opens.</p></div>}
        </div>
      </section>
    </div>
  )
}

