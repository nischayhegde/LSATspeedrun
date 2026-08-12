/**
 * What a signed-in reader actually waits for on a given screen, with a
 * signed-out control that proves the number is about that screen.
 *
 *   node tools/perf/route.mjs frontend/dist --route /firm --runs 5
 *   ... --route /firm --route /progress    several routes in one lifetime
 *   ... --api http://127.0.0.1:5001        where the real backend is
 *   ... --email perf@localhost.test        which account to sign in as
 *   ... --no-control                       skip the signed-out arm (don't)
 *   ... --gzip / --no-compress             as `tools/css-split/prod-serve.mjs`
 *
 * Read `FINDINGS.md` beside this file first. Two traps are recorded there that
 * have each cost a session: serving assets uncompressed, and measuring on a
 * loaded machine.
 */
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { compressionFromOpts } from '../css-split/prod-serve.mjs'
import {
  LINKS, describeCompression, devAuthCookies, launch, loadLine, measureRoute, median, serveApp,
  short as shortUrl,
} from './lib.mjs'

const argv = process.argv.slice(2)
const takes = new Set(['--route', '--runs', '--api', '--email', '--link'])
const opts = {}
const routes = []
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--route') { routes.push(argv[i + 1]); i += 1 }
  else if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const dist = resolve(positional[0] || 'frontend/dist')
const runs = Number(opts['--runs'] || 5)
const apiOrigin = opts['--api'] || 'http://127.0.0.1:5001'
const email = opts['--email'] || 'perf@localhost.test'
const compress = compressionFromOpts(opts)
const link = opts['--link'] || 'slow-4g'
if (!routes.length) routes.push('/firm')

/**
 * Which emitted file is a route's own chunk.
 *
 * Taken from the built directory rather than from a table, because the names
 * carry content hashes and a table would go stale on the next build. The
 * mapping from path to chunk name mirrors `ROUTE_ENTRY_CHUNKS` in
 * `frontend/vite.config.ts`; when a route is added there it belongs here too.
 */
const CHUNK_NAMES = [
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
const assets = readdirSync(resolve(dist, 'assets'))
const chunkFor = (route) => {
  const path = route.split('?')[0].replace(/\/$/, '') || '/'
  const hit = CHUNK_NAMES.find(([re]) => re.test(path))
  if (!hit) return null
  return assets.find((f) => f.startsWith(`${hit[1]}-`) && f.endsWith('.js')) || null
}

const cookies = await devAuthCookies(apiOrigin, email)
const app = await serveApp(dist, apiOrigin, compress)
const origin = `http://127.0.0.1:${app.port}`
const browser = await launch()

console.log(`\n${dist}   ${describeCompression(compress)}`)
console.log(`390px, 4x CPU, ${LINKS[link].label} (${link}); signed in as ${email}; ${loadLine()}`)

let anyVoid = false
try {
  for (const route of routes) {
    const routeChunk = chunkFor(route)
    const rows = []
    for (let i = 0; i < runs; i += 1) {
      rows.push(await measureRoute(browser, { origin, route, cookies, routeChunk, link }))
    }
    const good = rows.filter((r) => r.valid)
    const control = opts['--no-control']
      ? null
      : await measureRoute(browser, { origin, route, cookies: null, routeChunk, link })

    console.log(`\n  ${route}   chunk ${routeChunk || '(none)'}`)
    if (!good.length) {
      anyVoid = true
      console.log(`    VOID: ${rows.length} runs, none landed on ${route}. Last stop: ${rows[rows.length - 1]?.landedOn}`)
    } else {
      const col = (k) => good.map((r) => r[k])
      const show = (k) => `${String(median(col(k)) ?? '—').padStart(6)}  [${col(k).map((v) => (v == null ? '—' : v)).join(', ')}]`
      console.log(`    signed in, ${good.length}/${rows.length} valid`)
      console.log(`      route chunk requested  ${show('chunkAt')}`)
      console.log(`      first paint            ${show('fcp')}`)
      console.log(`      route on the glass     ${show('contentAt')}`)
      console.log(`      largest paint          ${show('lcp')}`)
    }
    if (opts['--trace'] && good.length) {
      const pick = good[good.length - 1]
      console.log(`\n    waterfall of the last valid run  (content at ${pick.contentAt} ms)`)
      console.log(`      ${'start'.padStart(6)} ${'end'.padStart(6)} ${'kB'.padStart(7)}  ${'pri'.padEnd(8)} ${'asset'.padEnd(32)} discovered by`)
      for (const r of pick.trace) {
        console.log(
          `      ${String(r.start).padStart(6)} ${String(r.end ?? '').padStart(6)} ${(r.bytes == null ? '—' : (r.bytes / 1000).toFixed(1)).padStart(7)}`
          + `  ${String(r.priority).padEnd(8)} ${shortUrl(r.url).padEnd(32)} ${r.cause}`,
        )
      }
    }
    if (control) {
      /**
       * The control has to fail. It is the only thing standing between a real
       * measurement of `/firm` and a fast, green, meaningless measurement of
       * the login screen — which is what every run of this app's perf tools
       * did before this harness existed.
       */
      const ok = !control.valid && control.landedOn === '/login'
      console.log(`    signed out control     ${ok ? 'bounced to /login as it must' : `UNEXPECTED: valid=${control.valid} landed on ${control.landedOn}`}`)
      if (!ok) { anyVoid = true }
    }
  }
} finally {
  await browser.close()
  app.server.close()
}
console.log(`\n${loadLine()} at the end of the run\n`)
process.exitCode = anyVoid ? 1 : 0
