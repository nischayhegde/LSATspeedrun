import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Target } from 'lucide-react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { api, ApiError } from './api'
import { AppShell, ErrorNotice, LoadingScreen } from './components'
import { StoryOverlays } from './narrative'
import { preloadArtForRoute, preloadDockArt } from './art/scene-loaders'
import {
  CasesLobbyPage,
  CaseSessionPage,
  FirmPage,
  LoginPage,
  OfficePage,
  OnboardingPage,
  PerformancePage,
  ProgressionMapPage,
  StoryPage,
} from './pages'
import './focus-mode-gate.css'


function isAuthenticationError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.code === 'unauthorized')
}


function RouteLoadError({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="route-error" role="alert">
      <div>
        <span className="eyebrow">CONNECTION INTERRUPTED</span>
        <h1>The firm could not be opened.</h1>
        <ErrorNotice error={error} />
        <button className="primary-button" disabled={retrying} onClick={onRetry}>
          {retrying ? 'Trying again…' : 'Retry'}
        </button>
      </div>
    </div>
  )
}


function Protected({ children, gameRequired = true }: { children: React.ReactNode; gameRequired?: boolean }) {
  const location = useLocation()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const game = useQuery({ queryKey: ['game'], queryFn: api.game, enabled: Boolean(me.data?.user) })
  if (me.isLoading || (me.data && game.isLoading)) return <LoadingScreen />
  const loadError = me.error || game.error
  if (isAuthenticationError(loadError)) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (loadError) {
    return (
      <RouteLoadError
        error={loadError}
        retrying={me.isFetching || game.isFetching}
        onRetry={() => {
          if (me.error) void me.refetch()
          else void game.refetch()
        }}
      />
    )
  }
  if (gameRequired && !game.data?.game) return <Navigate to="/onboarding" replace />
  return (
    <>
      <AppShell user={me.data!.user} game={game.data?.game}>{children}</AppShell>
      {/* Rendered outside the shell so the narrative layer keeps one stacking
          order of its own instead of competing inside the page it interrupts. */}
      {game.data?.game && <StoryOverlays game={game.data.game} />}
    </>
  )
}


/** What each Focus Mode route is, in the words the nav used for it. */
const FOCUS_MODE_HIDDEN_ROUTES: Record<string, { name: string; blurb: string }> = {
  '/office': {
    name: 'the Office',
    blurb: 'the firm floor, the daily goals and the passive-income safe',
  },
  '/firm': {
    name: 'the Firm screen',
    blurb: 'upgrades, staff, clients and firm assets',
  },
  '/map': {
    name: 'the Career World',
    blurb: 'districts, rivals and the campaign map',
  },
}

/**
 * Focus Mode drops the office, firm and world screens from every nav surface.
 * Hiding the links was never a guard: all three still rendered in full by
 * direct URL — a bookmark, a browser back button, or a link from an older
 * screen — and with no nav entry left there was then no way back out of them.
 *
 * A silent redirect would read as a broken link, so the route says what it is
 * and offers the only two things a student could want here: the screen, or the
 * dashboard.
 */
function FocusModeGate({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const turnOff = useMutation({
    mutationFn: () => api.updateMe({ assistance_level: 'full' }),
    onSuccess: (data) => queryClient.setQueryData(['me'], data),
  })
  const route = FOCUS_MODE_HIDDEN_ROUTES[location.pathname.replace(/\/$/, '')]
  if (!route || me.data?.user.assistance_level !== 'focus') return <>{children}</>
  return (
    <div className="focus-gate" role="status">
      <div>
        <div className="focus-gate-mark" aria-hidden="true"><Target /></div>
        <span className="eyebrow">FOCUS MODE IS ON</span>
        <h1>{route.name} is put away.</h1>
        <p>
          Focus Mode keeps the app to the Dashboard and Practice — the two screens that raise a score — and
          hides {route.blurb}. That is why {route.name} has no nav entry right now.
        </p>
        <div className="focus-gate-actions">
          <button
            type="button"
            className="primary-button"
            disabled={turnOff.isPending}
            onClick={() => turnOff.mutate()}
          >
            {turnOff.isPending ? 'Turning it off…' : 'Turn Focus Mode off and open it'} <ArrowRight size={16} />
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('/progress')}>
            Back to the dashboard
          </button>
        </div>
        {turnOff.error ? <ErrorNotice error={turnOff.error} /> : (
          <small>
            Focus Mode is a preference, never a lock. It also lives in the account menu at the top right, and in
            the firm menu on a phone.
          </small>
        )}
      </div>
    </div>
  )
}


function HomeRedirect() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  if (me.isLoading) return <LoadingScreen />
  if (isAuthenticationError(me.error)) return <Navigate to="/login" replace />
  if (me.error) return <RouteLoadError error={me.error} retrying={me.isFetching} onRetry={() => void me.refetch()} />
  return <Navigate to={me.data!.user.next_route} replace />
}


export default function App() {
  const location = useLocation()
  useEffect(() => {
    preloadArtForRoute(location.pathname)
    const idle = window.requestIdleCallback?.(() => { preloadDockArt(location.pathname) }, { timeout: 1800 })
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
    }
  }, [location.pathname])
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/onboarding" element={<Protected gameRequired={false}><OnboardingPage /></Protected>} />
      <Route path="/office" element={<Protected><FocusModeGate><OfficePage /></FocusModeGate></Protected>} />
      <Route path="/progress" element={<Protected><PerformancePage /></Protected>} />
      <Route path="/cases" element={<Protected><CasesLobbyPage /></Protected>} />
      <Route path="/cases/:sessionId" element={<Protected><CaseSessionPage /></Protected>} />
      <Route path="/firm" element={<Protected><FocusModeGate><FirmPage /></FocusModeGate></Protected>} />
      <Route path="/story" element={<Protected><StoryPage /></Protected>} />
      <Route path="/map" element={<Protected><FocusModeGate><ProgressionMapPage /></FocusModeGate></Protected>} />
      <Route path="/practice" element={<Navigate to="/cases" replace />} />
      <Route path="/practice/:sessionId" element={<LegacyCaseRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}


function LegacyCaseRedirect() {
  const sessionId = window.location.pathname.split('/').pop()
  return <Navigate to={`/cases/${sessionId}`} replace />
}
