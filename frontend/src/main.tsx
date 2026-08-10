import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { BlockingOverlayProvider } from './overlays'
import { routeForPath } from './routes'
import { SoundProvider } from './sound'
/**
 * The sheets every screen needs, in the order the cascade depends on.
 *
 * Six page sheets used to be listed here too — `narrative`, `trial-calendar`,
 * `wardrobe`, `rival-war-room`, `strategy-enforcement` and
 * `art/unified-empire-map`. They were pinned to the entry only to fix their
 * position: each is imported by its own component and would otherwise arrive in
 * that component's async chunk, and arriving late is what breaks them. Page
 * sheets and `styles.css` restate each other's rules at equal specificity, so
 * moving one after it silently flipped those ties — measured, that widened the
 * rival operations panel on /story by 37px. `mobile.css` is the same problem
 * from the other side: it is a global override sheet that wins purely by being
 * last, so a page sheet that lands after it takes the phone layout back.
 *
 * They are no longer here because position is now held by the document instead
 * of by the entry bundle: `lsat-route-stylesheets` in `vite.config.ts` writes a
 * real `<link>` for each of them, ahead of the entry sheet, for the route being
 * loaded — and moves any that arrive later back in front of it. That gives them
 * the same place in the cascade they have always had while taking 27 kB
 * gzipped out of the stylesheet every screen blocks on. The clash scan behind
 * that change is `.shots/css-clash.mjs`.
 *
 * `markup.css` and `practice-lab.css` left the same way and for the same
 * reason: the first styles ink that exists only over a case file, the second is
 * the practice lobby, and nothing outside /cases and /cases/:id writes any of
 * their classes.
 *
 * `case-instrument.css` is the one that could not follow them, and it is worth
 * saying why. It is scoped — every rule in it is written `.case-instrument …` —
 * and it is reachable from one route, so it looks like the same move. But it
 * sat *after* `styles.css` here and a route sheet is emitted *before* the entry
 * sheet, which flips every tie between the two. Those ties are not rare and not
 * findable by scanning for a shared class: `.case-instrument .case-timer small`
 * against `.case-timer small` is one, and moving the sheet changed the colour of
 * the timer, of two labels and of the selected confidence button on the case
 * screen. It stays on the entry, and it is the reason `.shots/v-case-diff.mjs`
 * exists.
 *
 * `performance.css` was the seventh, and it could not simply follow the
 * dashboard chunk: it reads like a dashboard sheet, but it also styles the
 * whole session review on /cases/:id, the docket on /cases and two cards on
 * /office. So it was cut along that line instead. What other screens use is
 * `review-panels.css`, which takes the slot below and keeps its old place in
 * the cascade; the 41 kB that only the dashboard can reach stayed in
 * `performance.css` and now travels with the dashboard.
 *
 * `styles.css` and `mobile.css` looked like the floor, and `.shots/css-owners.mjs`
 * was the scan that said so: 80% of `styles.css` came back as needed by every
 * route. That was an artefact of its own walk. It follows `import()` as well as
 * `import`, every page imports `components.tsx`, `components.tsx` imports
 * `routes.tsx`, and `routes.tsx` `import()`s all nine pages, so the graph closed
 * on itself and every route reached the same 67 of 73 files. Cutting that one
 * edge — the router's handles on the pages are the split points, not edges —
 * shows a third of the sheet belongs to one screen each. What that found for the
 * case route is `case-session-styles.css`, and `.shots/route-split.mjs` is the
 * scan, which refuses to cut where the move would change who wins.
 */
import './review-panels.css'
import './styles.css'
import './art/art.css'
import './case-instrument.css'
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
