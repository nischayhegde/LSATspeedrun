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

/**
 * Which chunk each path enters through, mirroring `routeForPath` in
 * `src/routes.tsx`. Anything not listed here — `/`, `/dashboard`, a typo —
 * cannot know its screen until `me` answers, so it gets no route sheets and
 * loads them the ordinary way once the redirect lands.
 */
const ROUTE_ENTRY_CHUNKS: [RegExp, string][] = [
  [/^\/office$/, 'office-page'],
  [/^\/map$/, 'map-page'],
  [/^\/progress$/, 'dashboard-page'],
  [/^\/(cases|practice)$/, 'cases-page'],
  [/^\/(cases|practice)\/.+/, 'case-session-page'],
  [/^\/firm$/, 'firm-page'],
  [/^\/story$/, 'story-page'],
  [/^\/onboarding$/, 'onboarding-page'],
  [/^\/login$/, 'login-page'],
]

/**
 * The order the page sheets held when they were pinned to the entry file.
 *
 * Their relative order is the cascade, and a screen that loads two of them has
 * to see them in this sequence. Sorting by this rather than by chunk name keeps
 * the emitted document honest even after Rollup regroups the chunks.
 */
const SHEET_ORDER = [
  'src/performance.css',
  'src/narrative.css',
  'src/trial-calendar.css',
  'src/wardrobe.css',
  'src/rival-war-room.css',
  'src/strategy-enforcement.css',
  'src/art/unified-empire-map.css',
  'src/markup.css',
  'src/practice-lab.css',
  // Cut out of `styles.css`, which came after every sheet above it, so this
  // ranks last of the route sheets for the same reason.
  'src/case-session-styles.css',
  'src/firm-page.css',
  'src/office-page.css',
  'src/login-page.css',
  'src/onboarding-page.css',
  'src/story-page.css',
  'src/cases-page.css',
]

/**
 * A route sheet cut out of `mobile.css` has to land *behind* the entry link,
 * not in front of it, and this is how one is recognised.
 *
 * `mobile.css` is last on the entry and its whole method is to come last: it
 * restates the same properties the sheets above it set, at the same
 * specificity, and wins on document order alone. A rule taken out of it and
 * put in front of the entry link therefore stops winning, which is why the
 * first six splits could only take rules from `styles.css`.
 *
 * So these sheets are given the other side of the link. Everything each one
 * used to beat is still above it and everything that used to beat it — nothing,
 * it was last — still does. `manualChunks` gives each its own emitted asset so
 * that a route's `styles.css` rules and its `mobile.css` rules, which need
 * opposite sides, are not merged into one file, and the `mobile-` prefix on the
 * asset name is what carries that decision through to the document.
 */
const isMobileSheet = (href: string) => /(^|\/)mobile-[^/]*\.css$/.test(href)

/**
 * Puts each route's own stylesheets in the document, on the side of the entry
 * sheet they were cut from.
 *
 * Six sheets belong to one screen each but were imported by `main.tsx`, which
 * merged them into `index.css` and made every visitor block on 27 kB gzipped of
 * rules for screens they had not asked for. They were pinned there for one
 * reason: a stylesheet's place in the cascade is its place in the document, and
 * a sheet that arrives with a lazy chunk lands *after* `index.css` — behind
 * `styles.css` and `mobile.css`, which are written on the assumption that they
 * come last.
 *
 * So position is taken over here instead. A script at the top of `<head>`, ahead
 * of the entry `<link>` the parser has not reached yet, appends a real
 * stylesheet link for each sheet the current route needs. That is earlier than
 * Vite could ever discover them — it injects them at runtime, three modules
 * deep — and it puts them exactly where they used to sit, so nothing in the
 * cascade moves. Vite's own preload helper checks for an existing link with the
 * same href before it injects one, so the route's chunk finds these and does
 * not add a duplicate.
 *
 * The `mobile-` sheets go on the far side of the same link. The script cannot
 * simply append them, because the parser has not reached the entry link yet and
 * anything appended now lands in front of it; and it cannot run *after* the
 * link either, because a script that follows a pending stylesheet waits for it,
 * which would put these two sheets in series instead of side by side. So each
 * is started immediately as `preload as=style`, which fetches at exactly the
 * moment an appended stylesheet would have and takes no position in the
 * cascade, and the real `<link>` is put in behind the entry sheet as soon as
 * the parser produces it. Nothing can paint before that: the entry sheet is
 * render-blocking and still in flight, and inserting the real link is the next
 * microtask, not the next frame.
 *
 * The same script then watches `<head>`: a sheet that arrives with a chunk
 * loaded by a *client-side* navigation is moved to the place a cold load would
 * have given it. Without that, walking from /office to /firm would give
 * `rival-war-room.css` a precedence a cold load of /firm never gives it, and
 * the two would disagree about the same screen.
 *
 * That means a place and not just a side. Vite appends one link per stylesheet
 * the arriving chunk owns, in whatever order its dependency list happens to
 * hold them, and putting each one immediately in front of the entry link — the
 * first thing this did — preserves that order rather than the cascade's. Walked
 * to rather than loaded, /story then had `narrative.css` behind `story-page.css`
 * instead of in front of it, and seven of the nine routes disagreed with their
 * own cold load. So an arrival is slotted against `B`, which is every sheet in
 * one sequence, rather than against the entry link alone.
 *
 * The sheets are found from the bundle rather than listed, so the set cannot
 * drift from the build; `SHEET_ORDER` is the one thing stated by hand, because
 * only the source knows what the order used to be.
 */
function routeStylesheets(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'lsat-route-stylesheets',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        const base = config.base === './' ? '/' : config.base

        const chunksByName = new Map<string, string>()
        let entryCss = ''
        for (const [fileName, output] of Object.entries(bundle)) {
          if (output.type !== 'chunk') continue
          chunksByName.set(output.name, fileName)
          if (output.isEntry) {
            const meta = (output as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata
            for (const sheet of meta?.importedCss ?? []) entryCss = base + sheet
          }
        }
        if (!entryCss) return html

        /**
         * Where a stylesheet asset sits in the old cascade: the earliest of the
         * source sheets that ended up inside it. A chunk can own more than one,
         * and `game-art` owns two of the six.
         */
        const rankOf = (fileName: string) => {
          const chunk = bundle[fileName]
          if (!chunk || chunk.type !== 'chunk') return SHEET_ORDER.length
          let best = SHEET_ORDER.length
          for (const id of chunk.moduleIds) {
            const i = SHEET_ORDER.findIndex((s) => id.endsWith(s))
            if (i >= 0 && i < best) best = i
          }
          return best
        }

        /**
         * Every stylesheet reachable from `name` through static imports, split
         * by the side of the entry link it belongs on.
         *
         * The `mobile-` sheets are their own chunks and Vite deletes a chunk
         * that holds nothing but CSS, folding its stylesheet into the importer's
         * `importedCss`, so they turn up here on the route chunk itself. Their
         * order among themselves is not stated: two of them can only ever be in
         * the document together after a client-side navigation, and every
         * selector in one names a class only its own route's files write, so
         * there is nothing for them to disagree about.
         */
        const rank = new Map<string, number>()
        const closure = (name: string) => {
          const start = chunksByName.get(name)
          if (!start) return { before: [] as string[], after: [] as string[] }
          const seen = new Set<string>()
          const css = new Map<string, number>()
          const queue = [start]
          while (queue.length) {
            const file = queue.shift()!
            if (seen.has(file)) continue
            seen.add(file)
            const output = bundle[file]
            if (!output || output.type !== 'chunk' || output.isEntry) continue
            queue.push(...output.imports)
            const meta = (output as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata
            for (const sheet of meta?.importedCss ?? []) css.set(base + sheet, rankOf(file))
          }
          for (const [href, at] of css) rank.set(href, Math.min(rank.get(href) ?? at, at))
          const ordered = [...css].sort((a, b) => a[1] - b[1]).map(([href]) => href)
          return {
            before: ordered.filter((href) => !isMobileSheet(href)),
            after: ordered.filter(isMobileSheet).sort(),
          }
        }

        const byRoute: [string, string[], string[]][] = []
        for (const [pattern, name] of ROUTE_ENTRY_CHUNKS) {
          const { before, after } = closure(name)
          if (before.length || after.length) byRoute.push([pattern.source, before, after])
        }
        if (!byRoute.length) return html

        /**
         * One order for all of them, not one per route.
         *
         * The script has to be able to place a sheet that arrives on its own,
         * after a client-side navigation, and for that it needs to know where
         * that sheet goes relative to whatever is already in the document —
         * which may have come from a different route. `rankOf` is a property of
         * the sheet rather than of the route asking for it, so sorting the whole
         * set by it gives a single sequence that every route's own list is a
         * subsequence of. The `mobile-` sheets are sorted by name instead: they
         * share a rank with their route's other sheet, and every selector in one
         * names a class only its own route's files write, so there is nothing
         * for two of them to disagree about and any fixed order will do.
         */
        const all = [...rank.keys()]
        const before = all.filter((href) => !isMobileSheet(href)).sort((x, y) => rank.get(x)! - rank.get(y)!)
        const after = all.filter(isMobileSheet).sort()
        const script = `(function(){try{
var R=${JSON.stringify(byRoute)},B=${JSON.stringify(before)},A=${JSON.stringify(after)},E=${JSON.stringify(entryCss)};
var p=location.pathname.replace(/\\/$/,'')||'/',own=[[],[]];
for(var i=0;i<R.length;i++){if(new RegExp(R[i][0]).test(p)){own=[R[i][1],R[i][2]];break;}}
for(var j=0;j<own[0].length;j++){var l=document.createElement('link');
l.rel='stylesheet';l.href=own[0][j];document.head.appendChild(l);}
var waiting=[];
for(var k=0;k<own[1].length;k++){var w=document.createElement('link');
w.rel='preload';w.as='style';w.href=own[1][k];document.head.appendChild(w);
var s=document.createElement('link');s.rel='stylesheet';s.href=own[1][k];waiting.push(s);}
function entry(){return document.querySelector('link[rel="stylesheet"][href="'+E+'"]');}
function place(e){if(!waiting.length)return;var host=e?e.parentNode:document.head,
next=e?e.nextSibling:null;
for(var m=0;m<waiting.length;m++)host.insertBefore(waiting[m],next);waiting=[];}
document.addEventListener('DOMContentLoaded',function(){place(entry());});
function behind(x,e){return !!x&&!!(x.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_PRECEDING);}
function slot(h,L,e){var r=L.indexOf(h),ref=null,found=false,
links=document.head.querySelectorAll('link[rel="stylesheet"]');
for(var i=0;i<links.length;i++){var g=links[i].getAttribute('href'),k=L.indexOf(g);
if(k<0||g===h)continue;
found=true;
if(k>r){ref=links[i];break;}
ref=links[i].nextSibling;}
if(!found)return L===B?e:e.nextSibling;
if(L===B)return(ref&&!behind(ref,e))?ref:e;
return(ref===e||(ref&&!behind(ref,e)))?e.nextSibling:ref;}
new MutationObserver(function(recs){
var e=entry();if(!e)return;
place(e);
for(var a=0;a<recs.length;a++){var added=recs[a].addedNodes;
for(var b=0;b<added.length;b++){var n=added[b];
if(n.tagName!=='LINK'||n.rel!=='stylesheet')continue;
var h=n.getAttribute('href'),L=B.indexOf(h)>=0?B:A.indexOf(h)>=0?A:null;
if(!L)continue;
var ref=slot(h,L,L===B?e:e.nextSibling);
if(ref!==n&&n.nextSibling!==ref)e.parentNode.insertBefore(n,ref);}}
}).observe(document.head,{childList:true});
var e0=entry();if(e0)place(e0);
}catch(e){}})();`
        const link = html.match(new RegExp(`<link[^>]*href="${entryCss.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`))
        if (!link) return html
        return html.replace(link[0], `<script>${script}</script>\n    ${link[0]}`)
      },
    },
  }
}

/**
 * Lets the opening plate in `index.html` paint without waiting for the entry
 * stylesheet.
 *
 * The plate carries its own rules inline, so the only thing standing between
 * the document arriving and something being on screen is that Vite's entry
 * `<link rel="stylesheet">` is render-blocking — and it is the biggest asset on
 * the critical path. Measured cold at 390px, 4x CPU and 1.6 Mbps it finished at
 * 2816 ms, and the browser drew nothing at all until it had.
 *
 * So the link is given `media="print"`, which the browser fetches without
 * blocking anything, and it is switched back to `all` when it lands. Three
 * details make that safe rather than clever:
 *
 *  - A `preload as=style` goes in front of it. A print stylesheet is fetched at
 *    the lowest priority there is, which would have moved the entry sheet
 *    behind every chunk on the page and delayed the real screen to buy an
 *    earlier plate. The preload asks for the same bytes at the priority a
 *    render-blocking sheet would have had, and the link resolves out of it.
 *  - `rel` stays `stylesheet` and the element stays where it was, so the sheet
 *    keeps its place in the cascade and `lsat-route-stylesheets`, which finds
 *    it with `link[rel="stylesheet"][href=...]` and slots route sheets either
 *    side of it, still finds exactly the element it expects.
 *  - `id="app-css"` is what the document's own script waits on before it takes
 *    the plate down, so nothing is ever shown with the stylesheet missing.
 *
 * This runs after `routeStylesheets` so that plugin sees the single link Vite
 * emitted rather than the pair this leaves behind.
 */
function openWithAPlate(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'lsat-open-with-a-plate',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        const base = config.base === './' ? '/' : config.base
        let entryCss = ''
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk' || !output.isEntry) continue
          const meta = (output as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata
          for (const sheet of meta?.importedCss ?? []) entryCss = base + sheet
        }
        if (!entryCss) return html
        const tag = html.match(new RegExp(`<link[^>]*href="${entryCss.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`))
        if (!tag) return html
        return html.replace(
          tag[0],
          `<link rel="preload" as="style" href="${entryCss}">\n    `
            + `<link rel="stylesheet" id="app-css" href="${entryCss}" media="print" onload="this.media='all'">`,
        )
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), scenePreloadHints(), routeStylesheets(), openWithAPlate()],
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
          /**
           * One emitted asset per sheet cut out of `mobile.css`.
           *
           * Vite gives a chunk one stylesheet, so `src/office-page.css` and
           * `src/mobile/office-page.css` would be concatenated into a single
           * `office-page-<hash>.css` — and they cannot share a file, because
           * one has to go in front of the entry link and the other behind it.
           * Putting the mobile sheet in a chunk of its own is what keeps them
           * apart. The chunk holds nothing but CSS, so Rollup's JavaScript for
           * it is empty and Vite drops that file and hands the stylesheet up to
           * whichever route chunk imported it; the asset keeps this name, and
           * the `mobile-` prefix is how `lsat-route-stylesheets` recognises it.
           */
          const mobile = id.match(/\/src\/mobile\/([\w-]+)\.css(?:\?|$)/)
          if (mobile) return `mobile-${mobile[1]}`
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
