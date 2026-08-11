import { rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Keep `public/art/` out of a release, if a working tree still has one.
 *
 * Those 218 `.webp` were copied in alongside `src/app-art/` on the assumption
 * that the ported art modules would read them. Nothing does. `assets.ts` is the
 * only module that builds an `/art/…` URL and the only module that calls it,
 * `structures.tsx`, is imported by nothing — so every one of those path
 * templates is shaken out of the bundle, and a full 24-slide walk with both
 * ported scene chunks executing requests none of the files. It was 18 MB of a
 * 37 MB payload, or very nearly half, for a directory the deck cannot ask for.
 *
 * Deleted from the repository rather than merely stopped here, so this exists
 * only for the stale copies the old `cp -R` recipe left behind. It logs when it
 * fires, because a build that silently drops 18 MB is its own kind of surprise.
 *
 * Both orphaned modules stay exactly where they are: `src/app-art/` is a
 * verbatim port of `frontend/src/art/` and `PORT.md` says not to edit it so that
 * `diff -r` stays silent. That argument covers the code. It does not extend to
 * data the code never reads.
 */
function dropUnreachableArt(): Plugin {
  let outDir = 'dist'
  return {
    name: 'deck-drop-unreachable-art',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const stale = resolve(outDir, 'art')
      try {
        if (!statSync(stale).isDirectory()) return
      } catch {
        return
      }
      rmSync(stale, { recursive: true, force: true })
      this.warn('dropped public/art/ from the build: no reachable module requests it (see the note in vite.config.ts)')
    },
  }
}

/**
 * The deck is a standalone client-only site. It shares nothing with
 * `frontend/` except a copy of the art modules under `src/app-art/`, so it
 * has no proxy and no API of its own.
 *
 * 5180 is chosen to sit clear of the app's dev server (5173) and its preview
 * server (4173), because on presentation day all three are running at once:
 * the deck frames the app in an iframe. It must be a `localhost` origin and
 * not `file://` — the app's session cookies are `SameSite=Lax`, so a framed
 * `localhost:5173` only stays signed in when the framing document is also on
 * localhost.
 */
/**
 * A same-origin window onto the product's API, for the deck's own preflight.
 *
 * The deck needs to answer three questions before the founders are on stage:
 * is the backend up, is this browser signed in, and is the case session the
 * slides point at actually the one that is open. All three are `/v1` calls, and
 * the deck cannot make them directly: `backend/app/__init__.py` configures CORS
 * with `origins=[FRONTEND_ORIGIN]`, which is `http://localhost:5173` and nothing
 * else, so a credentialed fetch from `localhost:5180` is refused by the browser
 * before it is ever sent. (Vite's own CORS middleware on 5173 does reflect the
 * origin, which makes this look like it should work; it does not, because
 * `Access-Control-Allow-Credentials` is absent and the calls need the session
 * cookie.)
 *
 * Proxying instead means the request leaves the browser as same-origin, so there
 * is no preflight and no CORS at all. The session cookie rides along because
 * cookies are scoped by host and ignore the port: `lsat_session` is set for
 * `localhost`, so it is sent to `localhost:5180` exactly as it is to 5173.
 *
 * This is a dev-server facility and therefore only exists under `npm run dev`,
 * which is how the deck is presented — the same constraint the office tier
 * override query parameters already have. A production build falls back to the
 * pinned session id in `demo.config.ts` and says so in the preflight.
 */
const API_PROXY_PREFIX = '/demo-api'

export default defineConfig({
  plugins: [react(), dropUnreachableArt()],
  server: {
    port: 5180,
    strictPort: true,
    // `localhost`, matching the only URL the deck may be opened from. It used to
    // bind `127.0.0.1`, which mostly worked — `localhost` usually resolves there —
    // but it advertised the one spelling that breaks every demo: the app's cookies
    // are `SameSite=Lax` and host-scoped, so a deck on `127.0.0.1` framing an app
    // on `localhost` is cross-site and every embed shows a login screen. Binding
    // the name means the documented URL is the one that is guaranteed to answer,
    // whichever address `localhost` resolves to on the presenting machine.
    host: 'localhost',
    proxy: {
      [API_PROXY_PREFIX]: {
        target: 'http://127.0.0.1:5001',
        changeOrigin: false,
        rewrite: (path) => path.replace(new RegExp(`^${API_PROXY_PREFIX}`), ''),
      },
    },
  },
  preview: { port: 5181, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three'
          // The two ported app scenes are the heaviest modules in the deck by
          // an order of magnitude and are only reached from four slides, so
          // they stay out of the entry chunk and are fetched when the scene
          // ahead of them is warmed.
          if (id.includes('/src/app-art/map-')) return 'app-map'
          if (id.includes('/src/app-art/office-')) return 'app-office'
        },
      },
    },
  },
})
