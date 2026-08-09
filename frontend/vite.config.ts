import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 5000 is reserved by macOS Control Center on many developer machines, so
// the local API lives on 5001 by default and the proxy is predictable. Set
// LSAT_API_PORT when a second stack has to run beside the first, which is the
// only reason to move it.
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const apiTarget = `http://127.0.0.1:${nodeEnv?.LSAT_API_PORT || '5001'}`

/**
 * Which async chunks each scene route enters through. Everything those chunks
 * import (three.js above all) is discovered from the bundle graph rather than
 * listed here, so the hint set cannot drift away from the real build.
 *
 * The route's own module is now first in each list. Every route is a real
 * dynamic import since `pages.tsx` was split, so the browser would otherwise
 * have to run the entry chunk before it could even ask for the screen — the
 * same round trip the scene hints exist to remove.
 *
 * `/login` and `/onboarding` were tried here too, since both show an office
 * scene. Both were removed again: measured, hinting `/login` pushed the
 * already-signed-in bounce off that route from 0.6 s to 6.2 s, because ~717 kB
 * of three.js was competing with the page's own chunk and the `me` request
 * that decides where to send the visitor. The scene is an inset on those two
 * screens, not the subject, which is exactly the case the rule below excludes.
 */
const SCENE_ENTRY_CHUNKS: Record<string, string[]> = {
  map: ['map-page', 'map-three-scene', 'stylized-character'],
  office: ['office-page', 'office-three', 'stylized-character'],
}

/**
 * Nothing on a first paint tells the browser that a 3D scene is coming.
 *
 * Vite emits one `<script type="module">` for the entry chunk and no hints at
 * all for the async scene chunks, because they are only reachable through a
 * dynamic `import()`. The browser therefore cannot learn that ~740 kB of
 * three.js is needed until the entry chunk has been downloaded, parsed and
 * executed, React has mounted, and a lazy component has finally asked for it.
 * Measured cold at 4x CPU throttle, the request for three.js did not leave the
 * browser until ~200 ms in, and its parse then sat on the critical path in
 * front of the scene build.
 *
 * A `modulepreload` hint in the head moves that fetch to the very first moment
 * of the navigation, in parallel with the entry chunk, and lets V8 stream and
 * compile it off the main thread.
 *
 * Only the two routes whose whole point is a full-bleed scene get hints. A hint
 * is not free — the bytes are compiled before the entry bundle has finished with
 * the main thread — and on the screens where 3D is a portrait in the corner
 * rather than the subject, measurement showed that cost landing on the visible
 * canvas without a matching gain. The rule is: hint where the scene *is* the
 * page, nowhere else.
 */
function scenePreloadHints(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'lsat-scene-preload-hints',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html

        const chunksByName = new Map<string, string>()
        for (const [fileName, output] of Object.entries(bundle)) {
          if (output.type === 'chunk') chunksByName.set(output.name, fileName)
        }
        const base = config.base === './' ? '/' : config.base

        /**
         * Every chunk reachable from `name` through static imports, plus the
         * stylesheets those chunks own.
         *
         * The CSS matters as much as the JS here. Vite does not put a `<link>`
         * in the document for a stylesheet belonging to an async chunk; it
         * injects one at runtime, at the moment the chunk is first imported.
         * That request is therefore only discovered at the very end of the
         * chain — entry, route, scene module — and lands right in front of the
         * frame it is needed for. Since the split moved ~40 kB of painted-art
         * CSS out of `index.css` and into the game-art chunk, that late
         * discovery was showing up directly in the first-frame measurement.
         *
         * These go out as `preload as=style` rather than as real stylesheets:
         * the bytes are wanted early, but making them render-blocking would
         * hand back the first-paint win that moving them out of the entry
         * bought. The runtime `<link>` Vite injects then resolves from cache.
         */
        const closure = (names: string[]) => {
          const seen = new Set<string>()
          const css = new Set<string>()
          const queue = names.map((n) => chunksByName.get(n)).filter((f): f is string => Boolean(f))
          while (queue.length) {
            const file = queue.shift()!
            if (seen.has(file)) continue
            seen.add(file)
            const output = bundle[file]
            if (output && output.type === 'chunk') {
              queue.push(...output.imports)
              // The entry's own stylesheet is already a real <link> in the
              // document; hinting it again just duplicates a request.
              if (!output.isEntry) {
                const meta = (output as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata
                for (const sheet of meta?.importedCss ?? []) css.add(sheet)
              }
            }
          }
          // The entry chunk is already in the document as a real script tag;
          // hinting it again only adds a duplicate line to the head.
          const js = [...seen]
            .filter((f) => { const o = bundle[f]; return o && o.type === 'chunk' && !o.isEntry })
            .map((f) => base + f)
          return { js, css: [...css].map((f) => base + f) }
        }

        const hints: Record<string, { js: string[]; css: string[] }> = {}
        for (const [route, names] of Object.entries(SCENE_ENTRY_CHUNKS)) hints[route] = closure(names)
        if (!Object.values(hints).some((h) => h.js.length || h.css.length)) return html

        const script = `(function(){try{
var H=${JSON.stringify(hints)},p=location.pathname.replace(/\\/$/,'')||'/';
var k=p==='/map'?'map':p==='/office'?'office':'';
var h=H[k];if(!h)return;
for(var i=0;i<h.js.length;i++){var e=document.createElement('link');
e.rel='modulepreload';e.href=h.js[i];e.crossOrigin='anonymous';document.head.appendChild(e);}
for(var j=0;j<h.css.length;j++){var c=document.createElement('link');
c.rel='preload';c.as='style';c.href=h.css[j];document.head.appendChild(c);}
}catch(e){}})();`
        return {
          html,
          tags: [{ tag: 'script', children: script, injectTo: 'head' as const }],
        }
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), scenePreloadHints()],
  build: {
    target: ['es2020', 'safari15'],
    cssTarget: 'safari15',
    rollupOptions: {
      output: {
        /**
         * Three ships as two files — `three.core.js` (math, geometry) and
         * `three.module.js` (the WebGL renderer and the whole ShaderLib) — and
         * Rollup named the second after whichever app module happened to share
         * its chunk. That was `art/render-style.ts`, a 400-line post-processing
         * pass, so the bundle reported a "362 kB render-style chunk" and three
         * separate investigations have now gone looking for a duplicate copy of
         * three.js inside it. There is none: the two chunks are disjoint, and
         * ~740 kB is simply what this build of three.js weighs.
         *
         * Naming the chunk for what is actually in it costs nothing and is the
         * only thing that stops the next reader repeating the search.
         */
        manualChunks(id) {
          if (id.includes('/node_modules/three/build/')) return 'three'
          /**
           * React, the router and the query client, held apart from the app.
           *
           * This buys nothing on a first visit and is not pretending to: the
           * entry was 331.74 kB (105.47 kB gzip) in one file and is now 60.48 kB
           * (19.98 kB) plus a 272.12 kB (85.87 kB) framework chunk, which is
           * 0.67 kB of gzip *worse* in total. Both are needed before React can
           * mount, so nothing has been deferred.
           *
           * What it buys is the second visit. Every one of these bytes is pinned
           * to a version in `package.json` and changes when a dependency is
           * upgraded; the app's own code changes several times a day. Bundled
           * together, one edit to `App.tsx` invalidated the whole 105 kB gzip and
           * every returning reader downloaded React again. Now that edit
           * invalidates 19.98 kB and the other 85.87 kB is served from cache.
           *
           * The extra request costs no round trip on the critical path: Rollup
           * makes this a static import of the entry, so Vite emits a
           * `modulepreload` for it in the document head and the browser starts
           * both files in the same breath as the navigation. Verified in the
           * built `index.html` rather than assumed — an async chunk here would
           * have been a serial hop and not worth it.
           */
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@tanstack)\//.test(id)) {
            return 'framework'
          }
        },
      },
    },
  },
  server: {
    // Expo Go on a physical phone must be able to reach the exact same Vite
    // application over the local network. The API remains private behind the
    // Vite proxy, while the web UI is reachable from the development LAN.
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/v1': { target: apiTarget, changeOrigin: true },
    },
  },
  // `vite preview` serves the real production bundle. It needs the same API
  // proxy as the dev server, otherwise a built app cannot be exercised locally.
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/v1': { target: apiTarget, changeOrigin: true },
    },
  },
})
