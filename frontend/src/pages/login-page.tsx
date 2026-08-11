import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Play, Scale, Sparkles, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { ScalesMark } from '../art-2d/marks'
import { Brand, ErrorNotice } from '../components'
import { SoundControls, useSound } from '../sound'
import { storeAuthenticatedUser } from './shared'
// The rules in `styles.css` that only this screen can render.
import '../login-page.css'
import '../mobile/login-page.css'

/**
 * The office behind the sign-in panel is decoration, but importing it directly
 * put ~717 kB of three.js in front of this module's own body — including the
 * `me` request that decides whether the visitor should be here at all. A
 * signed-in visitor who lands on /login took 5.4 s to be bounced instead of
 * 0.5 s, because the redirect could not be decided until the scene's whole
 * module graph had downloaded and run. Loading it separately lets the panel
 * paint, and the redirect fire, on the first chunk.
 */
const OfficeScene = lazy(() => import('../game-art').then((m) => ({ default: m.OfficeScene })))

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
        <Suspense fallback={<div className="login-scene" aria-hidden="true" />}>
          <OfficeScene previewTier={3} gender="female" className="login-scene" />
        </Suspense>
      </section>
      <aside className="login-panel-wrap">
        <div className="login-panel">
          {/* The firm's own crest, the same drawn mark the header carries. It
              was a `lucide` scale, which put a 2px line icon where every other
              plaque in the app has a filled one. */}
          <div className="crest"><ScalesMark /></div>
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
