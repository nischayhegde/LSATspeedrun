import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { api, ApiError } from './api'
import { AppShell, ErrorNotice, LoadingScreen } from './components'
import { WorldScenePage } from './scene-world'
import {
  CasesLobbyPage,
  CaseSessionPage,
  FirmPage,
  LoginPage,
  OfficePage,
  OnboardingPage,
  ProgressionMapPage,
} from './pages'


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
  return <AppShell user={me.data!.user} game={game.data?.game}>{children}</AppShell>
}


function HomeRedirect() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  if (me.isLoading) return <LoadingScreen />
  if (isAuthenticationError(me.error)) return <Navigate to="/login" replace />
  if (me.error) return <RouteLoadError error={me.error} retrying={me.isFetching} onRetry={() => void me.refetch()} />
  return <Navigate to={me.data!.user.next_route} replace />
}


export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/onboarding" element={<Protected gameRequired={false}><OnboardingPage /></Protected>} />
      <Route path="/office" element={<Protected><OfficePage /></Protected>} />
      <Route path="/cases" element={<Protected><CasesLobbyPage /></Protected>} />
      <Route path="/cases/:sessionId" element={<Protected><CaseSessionPage /></Protected>} />
      <Route path="/firm" element={<Protected><FirmPage /></Protected>} />
      <Route path="/map" element={<Protected><ProgressionMapPage /></Protected>} />
      <Route path="/world/:sceneSlug" element={<Protected><WorldScenePage /></Protected>} />
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
