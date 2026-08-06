import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 5000 is reserved by macOS Control Center on many developer machines, so
// the local API lives on 5001 by default and the proxy is predictable. Set
// LSAT_API_PORT when a second stack has to run beside the first, which is the
// only reason to move it.
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const apiTarget = `http://127.0.0.1:${nodeEnv?.LSAT_API_PORT || '5001'}`

/**
 * Which async chunk each route's 3D scene enters through. Everything those
 * chunks import (three.js above all) is discovered from the bundle graph rather
 * than listed here, so the hint set cannot drift away from the real build.
 */
const SCENE_ENTRY_CHUNKS: Record<string, string[]> = {
  map: ['map-three-scene', 'stylized-character'],
  office: ['office-three', 'stylized-character'],
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

        /** Every chunk reachable from `name` through static imports. */
        const closure = (names: string[]) => {
          const seen = new Set<string>()
          const queue = names.map((n) => chunksByName.get(n)).filter((f): f is string => Boolean(f))
          while (queue.length) {
            const file = queue.shift()!
            if (seen.has(file)) continue
            seen.add(file)
            const output = bundle[file]
            if (output && output.type === 'chunk') queue.push(...output.imports)
          }
          // The entry chunk is already in the document as a real script tag;
          // hinting it again only adds a duplicate line to the head.
          return [...seen]
            .filter((f) => { const o = bundle[f]; return o && o.type === 'chunk' && !o.isEntry })
            .map((f) => base + f)
        }

        const hints: Record<string, string[]> = {}
        for (const [route, names] of Object.entries(SCENE_ENTRY_CHUNKS)) hints[route] = closure(names)
        if (!Object.values(hints).some((list) => list.length)) return html

        const script = `(function(){try{
var H=${JSON.stringify(hints)},p=location.pathname.replace(/\\/$/,'')||'/';
var k=p==='/map'?'map':(p==='/office'||p==='/login'||p==='/onboarding')?'office':'';
var l=H[k]||[];for(var i=0;i<l.length;i++){var e=document.createElement('link');
e.rel='modulepreload';e.href=l[i];e.crossOrigin='anonymous';document.head.appendChild(e);}
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
