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
 * Start the scene routes' own modules before React exists.
 *
 * Splitting `pages.tsx` made every route a dynamic import, which is what took
 * ~490 kB off the entry bundle — but it also put a hop in front of the two
 * screens that are nothing but a 3D scene. Their code cannot begin to run until
 * the entry chunk has executed, React has mounted and a lazy element has asked
 * for it, and measured cold at 4x throttle that hop cost ~200 ms of first frame
 * on /office in an interleaved A/B (treatment lost 8 of 11 pairs).
 *
 * `vite.config.ts` already emits `modulepreload` hints for these routes, so the
 * bytes are usually in the cache by now; what was missing was permission to
 * start executing them. Kicking the import off here overlaps that work with
 * React's own startup instead of queueing it behind it. The `lazy()` call in
 * App.tsx then resolves against this same in-flight module registry entry
 * rather than starting a second fetch.
 */
{
  const path = location.pathname.replace(/\/$/, '') || '/'
  if (path === '/office') void import('./pages/office-page')
  else if (path === '/map') void import('./pages/map-page')
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
