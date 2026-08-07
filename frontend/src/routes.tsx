import { lazy, useState, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * Every screen is its own chunk, and a screen whose chunk has already arrived
 * renders on the first commit instead of suspending.
 *
 * `lazy()` alone cannot do the second part, and the reason is easy to miss.
 * Splitting `pages.tsx` gave each route a real dynamic import, and `main.tsx`
 * starts the current route's import before React exists, so by the time React
 * first renders the route the bytes are long since here. React suspended
 * anyway. `lazy()` has to chain a `.then()` onto the import to pick the named
 * export out of the module, and a `.then()` is pending for at least a
 * microtask no matter how warm the module registry is — so React always found
 * a pending thenable on that first render, always committed the Suspense
 * fallback, and then held the real screen behind the fallback throttle, which
 * exists to stop a fallback flashing past a reader.
 *
 * That throttle was the single largest cost of the split, and the main thread
 * was measurably idle across the gap it created: no long task, no request in
 * flight, just a timer.
 *
 * Importing every screen statically would buy it back and hand the entry
 * bundle the ~490 kB the split just removed. So the module is still fetched
 * dynamically and still lands in its own chunk; what changes is that the
 * resolved component is kept, and a route whose component is already in hand
 * renders it directly. No thenable, no fallback, no throttle. A route whose
 * chunk has genuinely not arrived yet — a cold cache on a slow link — still
 * suspends exactly as before, which is the correct behaviour for that case and
 * is why the lazy form is kept rather than replaced.
 *
 * Measured cold on the built bundle at 4x CPU throttle, seven interleaved
 * pairs per route: time-to-content fell on ten of the twelve paths, by 138 to
 * 817 ms, each winning all seven of its pairs, with byte counts and request
 * counts unchanged and no cost to first paint. The entry grew 0.14 kB gzipped.
 *
 * The two that did not move are gated on something else, not on this. `/login`
 * cannot show its form until the `auth-config` query answers, and `/` cannot
 * even know which screen it wants until `me` reports `next_route` — so `/` is
 * the one route that still legitimately suspends.
 */
type PageComponent = ComponentType<object>

export type RouteComponent = ComponentType<object> & { preload: () => Promise<unknown> }

export function defineRoute(load: () => Promise<PageComponent>): RouteComponent {
  let resident: PageComponent | null = null
  let started: Promise<unknown> | null = null

  /** Starts the fetch once and keeps the component the moment it lands. */
  const preload = () => (started ??= load().then((component) => { resident = component; return component }))

  const Pending: LazyExoticComponent<PageComponent> = lazy(() => load().then((component) => ({ default: component })))

  function RouteEntry() {
    /**
     * Pinned at mount. If the module landed a moment after this route first
     * rendered, letting the choice change would swap the element type on a
     * later render, and React unmounts the old tree when the type changes —
     * the screen would be rebuilt from scratch and lose whatever state the
     * reader had put into it.
     */
    const [Chosen] = useState<PageComponent | LazyExoticComponent<PageComponent>>(() => resident ?? Pending)
    return <Chosen />
  }
  RouteEntry.preload = preload
  return RouteEntry
}


export const routes = {
  login: defineRoute(() => import('./pages/login-page').then((m) => m.LoginPage)),
  onboarding: defineRoute(() => import('./pages/onboarding-page').then((m) => m.OnboardingPage)),
  office: defineRoute(() => import('./pages/office-page').then((m) => m.OfficePage)),
  progress: defineRoute(() => import('./pages/dashboard-page').then((m) => m.PerformancePage)),
  cases: defineRoute(() => import('./pages/cases-page').then((m) => m.CasesLobbyPage)),
  caseSession: defineRoute(() => import('./pages/case-session-page').then((m) => m.CaseSessionPage)),
  firm: defineRoute(() => import('./pages/firm-page').then((m) => m.FirmPage)),
  story: defineRoute(() => import('./pages/story-page').then((m) => m.StoryPage)),
  map: defineRoute(() => import('./pages/map-page').then((m) => m.ProgressionMapPage)),
}


/**
 * Which screen a path will render, for anything that wants to start that
 * screen's module before the router gets there: the entry file for the route
 * being loaded now, and the nav for the one a pointer is heading towards.
 *
 * The legacy `/practice` paths resolve to the screen they redirect to, because
 * that redirect is a fixed rule in the route table rather than a decision, so
 * the destination is known before the router runs.
 *
 * `/` is deliberately absent. It redirects to whatever `next_route` the server
 * reports, which is not known until `me` comes back, so there is nothing to
 * preload yet and guessing would fetch the wrong screen.
 */
export function routeForPath(pathname: string): RouteComponent | null {
  const path = pathname.replace(/\/$/, '') || '/'
  if (path === '/office') return routes.office
  if (path === '/map') return routes.map
  if (path === '/progress') return routes.progress
  if (path === '/cases' || path === '/practice') return routes.cases
  if (/^\/(cases|practice)\/.+/.test(path)) return routes.caseSession
  if (path === '/firm') return routes.firm
  if (path === '/story') return routes.story
  if (path === '/onboarding') return routes.onboarding
  if (path === '/login') return routes.login
  return null
}
