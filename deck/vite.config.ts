import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    host: '127.0.0.1',
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
