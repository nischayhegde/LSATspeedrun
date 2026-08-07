import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { BlockingOverlayProvider } from './overlays'
import { SoundProvider } from './sound'
/**
 * These seven are each imported by a component as well, and would otherwise
 * ride along in that component's async chunk now that the routes are split.
 * They are listed here because the entry file is the only place the emitted
 * order is guaranteed, and for this set the order is load-bearing in both
 * directions.
 *
 * They sit *above* `styles.css` because that is where they landed before the
 * split: `App` is imported on line 5, so everything its module graph pulled in
 * was emitted before the stylesheets listed below it. Page sheets and
 * `styles.css` restate each other's rules at equal specificity, so moving them
 * after it silently flipped those ties — measured, it widened the rival
 * operations panel on /story by 37px.
 *
 * `mobile.css` stays last for the same reason, from the other side: it is a
 * global override sheet that wins purely by being last, so a page sheet that
 * arrives late in a lazy chunk takes the phone layout back. That is not
 * hypothetical either — with `performance.css` in the dashboard chunk its
 * `grid-template-columns: repeat(3,1fr)` beat the `flex-wrap: nowrap` that
 * keeps the dashboard tabs on one scrolling row, and they wrapped onto two.
 *
 * Keeping the seven eager costs ~101 kB in `index.css`. Splitting them safely
 * needs `@layer`, so precedence comes from layer order rather than arrival
 * order; that is a larger change and is not attempted here.
 */
import './performance.css'
import './narrative.css'
import './trial-calendar.css'
import './wardrobe.css'
import './rival-war-room.css'
import './strategy-enforcement.css'
import './art/unified-empire-map.css'
import './styles.css'
import './art/art.css'
import './case-instrument.css'
import './practice-lab.css'
import './mobile.css'

/**
 * Start the current route's own module before React exists.
 *
 * Splitting `pages.tsx` made every route a dynamic import, which is what took
 * ~490 kB off the entry bundle — but it also put a hop in front of every
 * screen. A route's code cannot begin to run until the entry chunk has
 * executed, React has mounted and a lazy element has asked for it, and measured
 * cold at 4x throttle that hop cost ~200 ms of first frame on /office in an
 * interleaved A/B (treatment lost 8 of 11 pairs).
 *
 * Measured on the built bundle, this moves a route's first chunk request from
 * ~217 ms to ~100 ms: it now goes out beside the entry rather than after the
 * entry has downloaded, parsed and run. That is the whole of what it buys, and
 * it is worth most on a real connection, where the round trip it removes is not
 * the ~4 ms it costs against a preview server on loopback.
 *
 * It does *not* stop the route suspending, and measurement says so plainly:
 * content on /progress did not move. `lazy()` chains a `.then()` onto the
 * import to unwrap the named export, and a `.then()` is pending for at least a
 * microtask however warm the module registry is — so React still finds a
 * pending thenable on its first render, still commits the Suspense fallback,
 * and still holds the real content back behind the fallback throttle. On
 * /progress that throttle is worth ~370 ms of time-to-content (751 ms lazy vs
 * 384 ms with the same page imported statically, everything else equal), with
 * the main thread measurably idle across the gap: no long task, no request in
 * flight. Removing it needs the route to render without ever suspending, which
 * is a change to how routes are declared rather than a preload.
 *
 * `vite.config.ts` also emits `modulepreload` hints for the two scene routes,
 * so their bytes are usually in the cache by now; what was missing was
 * permission to start executing them. The `lazy()` call in App.tsx resolves
 * against this same in-flight module registry entry rather than starting a
 * second fetch.
 */
{
  const path = location.pathname.replace(/\/$/, '') || '/'
  if (path === '/office') void import('./pages/office-page')
  else if (path === '/map') void import('./pages/map-page')
  else if (path === '/progress') void import('./pages/dashboard-page')
  else if (path === '/cases') void import('./pages/cases-page')
  else if (/^\/(cases|practice)\/.+/.test(path)) void import('./pages/case-session-page')
  else if (path === '/firm') void import('./pages/firm-page')
  else if (path === '/story') void import('./pages/story-page')
  else if (path === '/onboarding') void import('./pages/onboarding-page')
  else if (path === '/login') void import('./pages/login-page')
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: false, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <SoundProvider>
        <BlockingOverlayProvider>
          <App />
        </BlockingOverlayProvider>
      </SoundProvider>
    </BrowserRouter>
  </QueryClientProvider>,
)
