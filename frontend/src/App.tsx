import { lazy, Suspense, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { api, ApiError } from './api'
import { AppShell, ErrorNotice, LoadingScreen } from './components'
import { FocusMark } from './art-2d/marks'
import { preloadArtForRoute, preloadDockArt } from './art/scene-loaders'
import './focus-mode-gate.css'

/**
 * One module per route, so a route only ever downloads its own screen.
 *
 * These were nine named imports out of a single 2,174-line `pages.tsx`, which
 * is the same thing as no code splitting at all: a named import pulls in the
 * whole module, so every route paid for all nine. Wrapping *those* imports in
 * `lazy()` changes nothing — the module is still one unit. Splitting the file
 * is what makes the dynamic import real.
 */
const PerformancePage = lazy(() => import('./pages/dashboard-page').then((m) => ({ default: m.PerformancePage })))
const LoginPage = lazy(() => import('./pages/login-page').then((m) => ({ default: m.LoginPage })))
const OnboardingPage = lazy(() => import('./pages/onboarding-page').then((m) => ({ default: m.OnboardingPage })))
const OfficePage = lazy(() => import('./pages/office-page').then((m) => ({ default: m.OfficePage })))
const CasesLobbyPage = lazy(() => import('./pages/cases-page').then((m) => ({ default: m.CasesLobbyPage })))
const CaseSessionPage = lazy(() => import('./pages/case-session-page').then((m) => ({ default: m.CaseSessionPage })))
const FirmPage = lazy(() => import('./pages/firm-page').then((m) => ({ default: m.FirmPage })))
const ProgressionMapPage = lazy(() => import('./pages/map-page').then((m) => ({ default: m.ProgressionMapPage })))
const StoryPage = lazy(() => import('./pages/story-page').then((m) => ({ default: m.StoryPage })))

/**
 * The narrative layer interrupts a screen; it never opens one. Loading it
 * beside the route rather than in front of it keeps `game-art` — and the 3D
 * cutscene artwork behind it — off the first paint of every route, including
 * the six that have no cutscene at all.
 */
const StoryOverlays = lazy(() => import('./narrative').then((m) => ({ default: m.StoryOverlays })))


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


/**
 * Warms the Office and World scenes for a tap on the dock that may never come.
 *
 * This is speculative work, so it has to lose every race against the screen the
 * reader actually asked for. Scheduling it from `App` stopped achieving that
 * once the routes became real dynamic imports: `requestIdleCallback` fires
 * happily during the gap while a route's own chunk is still in flight, and the
 * main thread is genuinely idle then — it is waiting on the network, not
 * finished. `whenMainThreadIsQuiet` in `scene-loaders` reads that gap as calm
 * for the same reason.
 *
 * Measured cold on /progress at 4x throttle, that gap was enough for ~300 kB of
 * three.js, the map scene and the office scene to be fetched and parsed in
 * front of the dashboard's own first data request, which went from 230 ms to
 * 609 ms and took content on screen from 338 ms to 714 ms.
 *
 * Rendering this inside the route's Suspense boundary ties the warm-up to the
 * commit of the screen itself, which is the condition that was always meant.
 * It lives with the dock for the same reason: the dock only exists inside
 * `AppShell`, so no route outside this boundary has one to warm.
 */
function DockWarmer() {
  const { pathname } = useLocation()
  useEffect(() => {
    const warm = () => preloadDockArt(pathname)
    const idle = window.requestIdleCallback?.(warm, { timeout: 1800 })
    const timer = idle === undefined ? setTimeout(warm, 300) : undefined
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [pathname])
  return null
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
      <AppShell user={me.data!.user} game={game.data?.game}>
        {/* Inside the shell, so a route's own chunk lands under a header and
            nav that are already on screen rather than behind a full-page wait. */}
        <Suspense fallback={<LoadingScreen />}>
          {children}
          <DockWarmer />
        </Suspense>
      </AppShell>
      {/* Rendered outside the shell so the narrative layer keeps one stacking
          order of its own instead of competing inside the page it interrupts. */}
      {game.data?.game && (
        <Suspense fallback={null}>
          <StoryOverlays game={game.data.game} />
        </Suspense>
      )}
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
        <div className="focus-gate-mark" aria-hidden="true"><FocusMark on /></div>
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
    /**
     * The scene the current route renders itself. The dock's speculative
     * warm-up used to ride along here too; it now waits for the route to
     * commit, in `DockWarmer`.
     *
     * Running this inline was free while every screen lived in the entry chunk:
     * the route was already parsed by the time this effect ran, so there was
     * nothing left for the preload to race. Now that the routes are real dynamic
     * imports it competes with them, and on the screens where the 3D is
     * decoration it wins a race it should lose — on `/login` it pulled ~717 kB
     * of three.js in ahead of the 4 kB route chunk, which pushed the `me`
     * request that decides where to send the visitor from 54 ms out to 729 ms.
     *
     * So it is now split by what the scene is worth on each screen. Where the
     * scene *is* the page, the head start is the point and measurably costs the
     * first frame if it is given up. Everywhere else the scene is an inset and
     * yields to the screen the reader actually asked for.
     */
    const sceneIsThePage = location.pathname === '/office' || location.pathname === '/map'
    const preload = () => { preloadArtForRoute(location.pathname) }
    if (sceneIsThePage) {
      preloadArtForRoute(location.pathname)
      return
    }
    const idle = window.requestIdleCallback?.(preload, { timeout: 1800 })
    // Safari has no requestIdleCallback; a short timer is enough to let the
    // route's own chunk get in first, which is the whole point.
    const timer = idle === undefined ? setTimeout(preload, 300) : undefined
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [location.pathname])
  return (
    /* `Protected` carries its own boundary so a protected route keeps the shell
       while its chunk lands. This one is the net for the routes outside it. */
    <Suspense fallback={<LoadingScreen />}>
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
    </Suspense>
  )
}


function LegacyCaseRedirect() {
  const sessionId = window.location.pathname.split('/').pop()
  return <Navigate to={`/cases/${sessionId}`} replace />
}
