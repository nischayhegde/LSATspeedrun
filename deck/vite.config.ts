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
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true, host: '127.0.0.1' },
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
