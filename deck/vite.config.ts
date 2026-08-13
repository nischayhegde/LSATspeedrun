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
/**
 * Prefetch the chunks the presentation will need but first paint does not.
 *
 * Splitting the scenes out of the entry graph is only half an improvement. The
 * other half is that a scene must already be in the cache when its slide
 * arrives: `engine/use-deck.ts` warms the next slide's scene one slide ahead, so
 * a chunk that has to be fetched then is racing the presenter's next keystroke,
 * and a scene that pops in mid-talk is worse than one that was paid for at boot.
 *
 * The links are created by a script after `DOMContentLoaded` rather than written
 * into the head, and that detail is the whole plugin. Writing 14
 * `<link rel="prefetch">` into the head was tried and measured on a 400 kbit/s
 * 300 ms-RTT profile: it moved first paint from 1.9s to 10.2s and the start card
 * from 4.8s to 35.2s. "Lowest priority" is a priority, not a queue position, and
 * over HTTP/1.1 — `vite preview`, or any of the simple static servers this is
 * likely to be shown from — six connections is the whole budget. The scene
 * chunks were taking them and `three` finished dead last, at 34.5s.
 *
 * `DOMContentLoaded` is the honest signal for "the critical path is done": module
 * scripts block it, so by then the entry, react and three have been fetched and
 * evaluated. The idle callback after it yields to the first frame, and the 3s
 * timeout is there because building the stage does not leave much idle time.
 *
 * `modulepreload` for the scripts rather than `prefetch`, since post-load there
 * is no priority left to protect and its reuse is defined by the module map
 * instead of resting on the host sending sensible cache headers. It fetches and
 * compiles without evaluating, so the compile is paid behind the card too.
 *
 * That leaves the whole time the start card is up — as long as the founders take
 * to press Start, and never less than the seconds it takes to build the WebGL
 * stage — for 489 kB at the back of the queue.
 *
 * Generated rather than written by hand because the filenames are
 * content-hashed and only exist at build time. Vite emits `modulepreload` for
 * the entry's *static* imports and nothing for the dynamic ones, so whatever the
 * document already references is skipped here and the rest is listed.
 */
function prefetchLazyChunks(): Plugin {
  let base = '/'
  return {
    name: 'deck-prefetch-lazy-chunks',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return
      const referenced = new Set(
        [...html.matchAll(/(?:href|src)="[^"]*\/([^/"]+\.(?:js|css))"/g)].map((m) => m[1]),
      )
      const lazy = Object.values(ctx.bundle)
        .map((output) => output.fileName)
        .filter((fileName) => /\.(js|css)$/.test(fileName))
        .filter((fileName) => !referenced.has(fileName.split('/').pop() ?? ''))
        .sort()
      if (!lazy.length) return
      const script = [
        '(function () {',
        `  var lazy = ${JSON.stringify(lazy.map((fileName) => `${base}${fileName}`))}`,
        '  function warm() {',
        '    for (var i = 0; i < lazy.length; i++) {',
        '      var href = lazy[i]',
        '      var script = href.slice(-3) === ".js"',
        '      var link = document.createElement("link")',
        '      link.rel = script ? "modulepreload" : "prefetch"',
        '      if (script) link.crossOrigin = "anonymous"',
        '      else link.as = "style"',
        '      link.href = href',
        '      document.head.appendChild(link)',
        '    }',
        '  }',
        '  function schedule() {',
        '    if (window.requestIdleCallback) window.requestIdleCallback(warm, { timeout: 3000 })',
        '    else window.setTimeout(warm, 1000)',
        '  }',
        '  if (document.readyState === "loading") {',
        '    document.addEventListener("DOMContentLoaded", schedule, { once: true })',
        '  } else schedule()',
        '})()',
      ].join('\n')
      return {
        html,
        tags: [{ tag: 'script', children: script, injectTo: 'body' as const }],
      }
    },
  }
}

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

function presenterSync(): Plugin {
  let state = { index: 0, id: 'title', updatedAt: 0 }
  return {
    name: 'deck-presenter-sync',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/presenter-sync', (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        if (request.method === 'GET') {
          response.end(JSON.stringify(state))
          return
        }
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        let body = ''
        request.on('data', (chunk) => { body += String(chunk) })
        request.on('end', () => {
          try {
            const next = JSON.parse(body) as { index?: unknown; id?: unknown }
            if (!Number.isInteger(next.index) || typeof next.id !== 'string') throw new Error('invalid state')
            state = { index: next.index as number, id: next.id, updatedAt: Date.now() }
            response.end(JSON.stringify(state))
          } catch {
            response.statusCode = 400
            response.end(JSON.stringify({ error: 'invalid presenter state' }))
          }
        })
      })
    },
  }
}

/**
 * The deck is a standalone client-only site. It shares nothing with
 * `frontend/` except a copy of the art modules under `src/app-art/`, so it
 * has no proxy and no API of its own.
 *
 * 5180 is chosen to sit clear of the app's dev server (5174) and its preview
 * server (4173), because on presentation day all three are running at once:
 * the deck frames the app in an iframe. It must be a `localhost` origin and
 * not `file://` — the app's session cookies are `SameSite=Lax`, so a framed
 * `localhost:5174` only stays signed in when the framing document is also on
 * localhost.
 */
/**
 * A same-origin window onto the product's API, for the deck's own preflight.
 *
 * The deck needs to answer three questions before the founders are on stage:
 * is the backend up, is this browser signed in, and is the case session the
 * slides point at actually the one that is open. All three are `/v1` calls, and
 * the deck cannot make them directly: `backend/app/__init__.py` configures CORS
 * with `origins=[FRONTEND_ORIGIN]`, which is `http://localhost:5174` and nothing
 * else, so a credentialed fetch from `localhost:5180` is refused by the browser
 * before it is ever sent. (Vite's own CORS middleware on 5174 does reflect the
 * origin, which makes this look like it should work; it does not, because
 * `Access-Control-Allow-Credentials` is absent and the calls need the session
 * cookie.)
 *
 * Proxying instead means the request leaves the browser as same-origin, so there
 * is no preflight and no CORS at all. The session cookie rides along because
 * cookies are scoped by host and ignore the port: `lsat_session` is set for
 * `localhost`, so it is sent to `localhost:5180` exactly as it is to 5174.
 *
 * This is a dev-server facility and therefore only exists under `npm run dev`,
 * which is how the deck is presented — the same constraint the office tier
 * override query parameters already have. A production build falls back to the
 * pinned session id in `demo.config.ts` and says so in the preflight.
 */
const API_PROXY_PREFIX = '/demo-api'

export default defineConfig({
  // Production nginx serves the deck at `/pitch/`. Local `npm run dev` stays
  // at `/` so rehearsal URLs do not change. The EC2 bootstrap and the
  // sandbox deploy script set `DECK_BASE=/pitch/` for the release build.
  base: process.env.DECK_BASE || '/',
  plugins: [react(), prefetchLazyChunks(), dropUnreachableArt(), presenterSync()],
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
    // The audience deck still opens on localhost so its embedded app keeps the
    // localhost session cookie. Binding the LAN as well exposes only the
    // lightweight `?speaker=1` notes view to a partner's second computer.
    host: true,
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
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        /**
         * Two groups, both of them packages that are genuinely on the critical
         * path, and nothing else. The scene modules are deliberately absent.
         *
         * This replaces a `manualChunks` function that named `three`, `app-map`
         * and `app-office`. It did nothing at all: building with no `output`
         * config produced byte-identical chunks, hashes included, because
         * rolldown does not honour `manualChunks`. What it looked like it was
         * doing was the opposite of what was happening. `three` never became a
         * chunk; instead react, three, `app-art/render-style.ts` and the whole
         * `app-art/rig/**` humanoid rig were merged into one 1.08 MB chunk that
         * kept the `app-map` name — and because `scenes/stage.ts` statically
         * imports `render-style.ts`, the entry statically depended on all of it.
         * The ported map scene was `modulepreload`ed from `index.html` at boot,
         * which is precisely what the old comment claimed could not happen.
         *
         * Naming only the two vendors gets both of them out of the way and lets
         * the dynamic-import boundaries that already exist do the splitting —
         * `scenes/registry.ts` and `scenes/app-scene-layer.tsx` load every scene
         * with `import()`, so the map scene becomes a 236 kB dynamic chunk and
         * the office scene a 105 kB one instead of riding in at boot. Measured
         * first paint: 1,518,594 bytes down to 1,188,955.
         *
         * Do not add groups for the scenes. Naming `app-rig`, `app-map` and
         * `app-office` here was tried and measured: it puts them back into
         * statically-imported chunks and first paint returns to 1,519,768 bytes.
         *
         * `three` stays on the critical path and that is correct rather than
         * unfortunate: `scenes/stage.ts` mounts the WebGL stage from the first
         * frame and the title slide is itself a scene, so deferring it would
         * only move the same bytes to a moment where they are visible.
         */
        advancedChunks: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
