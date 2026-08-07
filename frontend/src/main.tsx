import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { BlockingOverlayProvider } from './overlays'
import { routeForPath } from './routes'
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
import './markup.css'
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
 * entry has downloaded, parsed and run. That is worth most on a real
 * connection, where the round trip it removes is not the ~4 ms it costs
 * against a preview server on loopback.
 *
 * Starting the fetch early is also what lets the route render without
 * suspending at all: `preload` keeps the resolved component, and a route that
 * already has its component in hand renders it on the first commit rather than
 * committing a Suspense fallback and waiting out the fallback throttle. That
 * is worth 333 ms of time-to-content on /progress, and 138–817 ms across the
 * ten routes it reaches. `routes.tsx` carries the full account of why `lazy()`
 * cannot manage this by itself, and which two routes it cannot help.
 *
 * `vite.config.ts` also emits `modulepreload` hints for the two scene routes,
 * so their bytes are usually in the cache by now; what was missing was
 * permission to start executing them. The route resolves against this same
 * in-flight module registry entry rather than starting a second fetch.
 */
void routeForPath(location.pathname)?.preload()

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
