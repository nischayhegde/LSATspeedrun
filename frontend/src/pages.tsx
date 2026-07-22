import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Brain, CheckCircle2, Play, Shuffle } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { api } from './api'
import { Brand, ErrorNotice, LoadingScreen, PauseButton, QuestionFlow } from './components'


export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
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
        queryClient.setQueryData(['me'], data)
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
  }, [config.data?.google_client_id, navigate, queryClient])

  const devLogin = useMutation({
    mutationFn: api.devLogin,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      navigate(data.user.next_route)
    },
  })

  return (
    <div className="login-page">
      <div className="login-nav"><Brand /></div>
      <section className="login-copy">
        <div className="eyebrow">FOCUSED LSAT PRACTICE</div>
        <h1>Answer a question.<br />Understand every choice.<br />Keep moving.</h1>
        <p>Random Logical Reasoning and Reading Comprehension questions, followed by detailed AI feedback on your answer and reasoning.</p>
        <div className="feature-list">
          <span><Shuffle /> 6,886 questions from public Hugging Face datasets</span>
          <span><Brain /> Optional written-reasoning grade</span>
          <span><CheckCircle2 /> Explanation for every answer choice</span>
        </div>
      </section>
      <section className="login-panel-wrap">
        <div className="login-panel">
          <div className="eyebrow">YOUR ACCOUNT</div>
          <h2>Sign in to practice</h2>
          <p>Your sessions and answer reviews are saved to your account.</p>
          <div ref={buttonRef} className="google-button-slot" />
          {!config.isLoading && !config.data?.google_client_id && (
            <div className="config-note">Set <code>GOOGLE_CLIENT_ID</code> to enable Google sign-in.</div>
          )}
          {config.data?.dev_auth_enabled && (
            <button className="secondary-button full" onClick={() => devLogin.mutate()} disabled={devLogin.isPending}>
              <Play size={17} /> {devLogin.isPending ? 'Signing in…' : 'Continue in local development'}
            </button>
          )}
          {(authError || devLogin.error) && <ErrorNotice error={authError || devLogin.error} />}
        </div>
      </section>
    </div>
  )
}


export function PracticeHomePage() {
  const navigate = useNavigate()
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const start = useMutation({
    mutationFn: api.startPractice,
    onSuccess: ({ session }) => navigate(`/practice/${session.id}`),
  })

  if (current.isLoading) return <LoadingScreen />
  if (current.error) return <div className="contained"><ErrorNotice error={current.error} /></div>
  const active = current.data?.session

  return (
    <div className="practice-home contained">
      <section className="practice-hero">
        <div>
          <span className="eyebrow">RANDOM PRACTICE</span>
          <h1>Ready for the next question?</h1>
          <p>Each session draws a fresh random mix from the LSAT LR and RC datasets. There is no diagnostic and no adaptive sequence.</p>
        </div>
        <div className="dataset-count"><strong>6,886</strong><span>available questions</span></div>
      </section>

      <section className="start-card">
        <div className="start-icon"><Shuffle /></div>
        <div>
          <h2>{active ? 'Continue your practice session' : 'Start a practice session'}</h2>
          <p>{active ? `${active.current_index} of ${active.total_items} questions completed.` : 'Ten questions, selected randomly from Logical Reasoning and Reading Comprehension.'}</p>
        </div>
        {active ? (
          <button className="primary-button" onClick={() => navigate(`/practice/${active.id}`)}>
            Resume <ArrowRight size={18} />
          </button>
        ) : (
          <button className="primary-button" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? 'Selecting questions…' : <>Start practice <ArrowRight size={18} /></>}
          </button>
        )}
      </section>
      {start.error && <ErrorNotice error={start.error} />}

      <section className="source-grid">
        <div><BookOpen /><strong>Logical Reasoning</strong><span>4,520 questions</span></div>
        <div><BookOpen /><strong>Reading Comprehension</strong><span>2,366 questions</span></div>
        <div><Brain /><strong>Feedback stays on</strong><span>Reasoning grades and choice-by-choice explanations</span></div>
      </section>
    </div>
  )
}


export function PracticeSessionPage() {
  const { sessionId } = useParams()
  const queryClient = useQueryClient()
  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.session(sessionId!),
    enabled: Boolean(sessionId),
  })
  const resume = useMutation({
    mutationFn: () => api.resumeSession(sessionId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', sessionId] }),
  })

  if (!sessionId) return <Navigate to="/practice" replace />
  if (sessionQuery.isLoading) return <LoadingScreen label="Loading your practice session…" />
  if (sessionQuery.error) return <div className="contained"><ErrorNotice error={sessionQuery.error} /></div>
  const session = sessionQuery.data!.session

  if (session.status === 'paused') {
    return (
      <div className="centered-card contained">
        <span className="eyebrow">SESSION PAUSED</span>
        <h1>Pick up where you left off.</h1>
        <p>Your current question and written reasoning are saved.</p>
        <button className="primary-button" onClick={() => resume.mutate()} disabled={resume.isPending}>
          <Play size={18} /> {resume.isPending ? 'Resuming…' : 'Resume practice'}
        </button>
        {resume.error && <ErrorNotice error={resume.error} />}
      </div>
    )
  }

  if (session.status === 'completed' && !session.pending_result) {
    const summary = sessionQuery.data!.summary
    return (
      <div className="summary-page contained">
        <span className="eyebrow">SESSION COMPLETE</span>
        <h1>Practice summary</h1>
        <div className="summary-stats">
          <div><strong>{summary?.accuracy ?? 0}%</strong><span>accuracy</span></div>
          <div><strong>{summary?.correct ?? 0}/{summary?.questions_completed ?? 0}</strong><span>correct</span></div>
          <div><strong>{summary?.elapsed_minutes ?? 0}</strong><span>minutes</span></div>
          <div><strong>{summary?.explanation_accuracy != null ? `${summary.explanation_accuracy}%` : '—'}</strong><span>reasoning grade</span></div>
        </div>
        <button className="primary-button" onClick={() => window.location.assign('/practice')}>
          Practice again <ArrowRight size={18} />
        </button>
      </div>
    )
  }

  return (
    <div className="session-page">
      {!session.pending_result && <div className="session-controls"><PauseButton sessionId={session.id} /></div>}
      <QuestionFlow session={session} />
    </div>
  )
}
