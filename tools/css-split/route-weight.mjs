/**
 * What a cold load of each route actually downloads, in brotli bytes.
 *
 * Three of the nine routes have never been measured, and the reason is that
 * every browser harness in here can only reach the two screens a signed-out
 * visitor can reach: `/v1/me` answers 401 and the app sends you to `/login`.
 * Standing up a signed-in session to time `/office` would mean fixtures for
 * `me` and `game` that are guesses about the backend's shape, and a guess in
 * the fixture becomes a guess in the number.
 *
 * The bundle graph does not need a session. Rollup already knows exactly which
 * chunks a route's entry point pulls in through static imports, Vite writes
 * that down in `manifest.json`, and the answer is deterministic — the same
 * every run, unaffected by the load average that has been corrupting the timed
 * measurements all day. It cannot tell you how long a route takes, and it is
 * not trying to; it tells you what the route weighs and which dependency is
 * responsible, which is the part a chunking decision turns on.
 *
 * What is counted, per route, is what a browser must have before that screen
 * can draw: the entry chunk and everything it statically imports, the entry
 * stylesheet, then the route's own chunk and its static closure with its
 * sheets. Dynamic imports below the route are excluded — they are the thing
 * code-splitting bought and they land after first render.
 *
 * Sizes are brotli, at the quality `prod-serve.mjs` uses, because that is what
 * CloudFront puts on the wire; raw bytes overstate JS and CSS by about 4.6x and
 * that ratio is not uniform across file types, so ranking on them ranks wrong.
 *
 * The manifest is not emitted by the shipping build, because nothing in
 * production reads it. Ask for one into a directory of its own, so that a build
 * taken for analysis cannot overwrite the `dist` an A/B run is measuring:
 *
 *   cd frontend && npx vite build --manifest --outDir dist-manifest --emptyOutDir
 *   cd .. && node tools/css-split/route-weight.mjs frontend/dist-manifest
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'

const dist = resolve(process.argv[2] || 'frontend/dist-manifest')
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'))

/** Mirrors `ROUTE_ENTRY_CHUNKS` in `vite.config.ts`. */
const ROUTES = [
  ['/office', 'office-page'],
  ['/map', 'map-page'],
  ['/progress', 'dashboard-page'],
  ['/cases', 'cases-page'],
  ['/cases/:id', 'case-session-page'],
  ['/firm', 'firm-page'],
  ['/story', 'story-page'],
  ['/onboarding', 'onboarding-page'],
  ['/login', 'login-page'],
]

/** The scene chunks `scenePreloadHints` puts in the document for these two. */
const SCENE_HINTED = new Set(['/office', '/map'])

const byName = new Map()
const byFile = new Map()
for (const [src, entry] of Object.entries(manifest)) {
  byFile.set(entry.file, entry)
  const name = entry.name || src.replace(/.*\//, '').replace(/\.\w+$/, '')
  if (!byName.has(name)) byName.set(name, entry)
  entry.__src = src
}

const sizeCache = new Map()
const brotli = (file) => {
  if (sizeCache.has(file)) return sizeCache.get(file)
  const p = join(dist, file)
  const n = existsSync(p)
    ? brotliCompressSync(readFileSync(p), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length
    : 0
  sizeCache.set(file, n)
  return n
}

/** Every chunk reachable from `entry` through static imports, plus its CSS. */
const closure = (entry) => {
  const js = new Set()
  const css = new Set()
  const queue = [entry]
  const seen = new Set()
  while (queue.length) {
    const e = queue.shift()
    if (!e || seen.has(e.file)) continue
    seen.add(e.file)
    js.add(e.file)
    for (const c of e.css || []) css.add(c)
    for (const imp of e.imports || []) {
      const next = manifest[imp]
      if (next) queue.push(next)
    }
  }
  return { js: [...js], css: [...css] }
}

const entryChunk = Object.values(manifest).find((e) => e.isEntry)
const shell = closure(entryChunk)
const shellJs = shell.js.reduce((t, f) => t + brotli(f), 0)
const shellCss = shell.css.reduce((t, f) => t + brotli(f), 0)

const kb = (n) => `${(n / 1024).toFixed(1)}`
console.log(`\n  ${dist}, brotli q5 (what CloudFront puts on the wire)\n`)
console.log('  the shell every route pays for')
for (const f of [...shell.js, ...shell.css].sort((a, b) => brotli(b) - brotli(a))) {
  console.log(`    ${kb(brotli(f)).padStart(7)} kB  ${f}`)
}
console.log(`    ${kb(shellJs + shellCss).padStart(7)} kB  TOTAL SHELL (${kb(shellJs)} js + ${kb(shellCss)} css)\n`)

const rows = []
for (const [route, name] of ROUTES) {
  const entry = byName.get(name)
  if (!entry) { console.log(`    ${route}: no chunk named ${name}`); continue }
  const own = closure(entry)
  // Anything already in the shell is not paid for twice.
  const js = own.js.filter((f) => !shell.js.includes(f))
  const css = own.css.filter((f) => !shell.css.includes(f))
  const jsBytes = js.reduce((t, f) => t + brotli(f), 0)
  const cssBytes = css.reduce((t, f) => t + brotli(f), 0)
  const heaviest = [...js, ...css].sort((a, b) => brotli(b) - brotli(a)).slice(0, 3)
  rows.push({ route, name, js, css, jsBytes, cssBytes, total: shellJs + shellCss + jsBytes + cssBytes, heaviest })
}
rows.sort((a, b) => b.total - a.total)

console.log('  cold load per route: shell + the route\'s own static closure')
console.log(`    ${'route'.padEnd(14)} ${'total'.padStart(9)} ${'route js'.padStart(9)} ${'route css'.padStart(10)}   heaviest in the route`)
for (const r of rows) {
  console.log(
    `    ${r.route.padEnd(14)} ${(`${kb(r.total)} kB`).padStart(9)} ${(`${kb(r.jsBytes)} kB`).padStart(9)} ${(`${kb(r.cssBytes)} kB`).padStart(10)}`
    + `   ${r.heaviest.map((f) => `${f.replace('assets/', '')} ${kb(brotli(f))}k`).join(', ')}`,
  )
}

console.log('\n  the same routes with the scene chunks the document hints for them')
for (const r of rows) {
  if (!SCENE_HINTED.has(r.route)) continue
  console.log(`    ${r.route}: hinted, so three.js and the scene are on the critical path too`)
}
const three = [...byFile.keys()].find((f) => /\/three-|^assets\/three-/.test(f))
if (three) console.log(`    three.js alone is ${kb(brotli(three))} kB brotli\n`)
