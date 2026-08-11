/**
 * Two builds, interleaved, on real signed-in screens.
 *
 * Interleaved because a difference under about 150 ms cannot survive being
 * measured as "all of A, then all of B": the machine drifts, the page cache
 * warms, and whichever arm ran second wins. A pair is one load of each, back to
 * back, in the same browser lifetime, and the result is reported as how many
 * pairs the treatment won as well as by how much the medians moved. A change
 * that is real wins nearly every pair; a change inside the noise wins about
 * half, and that is a documented negative result rather than a failure.
 *
 *   node tools/perf/ab.mjs /tmp/dist-base frontend/dist --route /firm --pairs 9
 *   ... --route /firm --route /progress    several routes, still interleaved
 *   ... --api http://127.0.0.1:5001 --email perf@localhost.test
 *
 * Read `FINDINGS.md` beside this file first.
 */
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { compressionFromOpts } from '../css-split/prod-serve.mjs'
import {
  LINKS, describeCompression, devAuthCookies, launch, loadLine, measureRoute, median, serveApp,
} from './lib.mjs'

const argv = process.argv.slice(2)
const takes = new Set(['--pairs', '--api', '--email', '--link'])
const opts = {}
const routes = []
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--route') { routes.push(argv[i + 1]); i += 1 }
  else if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const [baseDist, headDist] = positional.map((p) => resolve(p))
const pairs = Number(opts['--pairs'] || 9)
const apiOrigin = opts['--api'] || 'http://127.0.0.1:5001'
const email = opts['--email'] || 'perf@localhost.test'
const compress = compressionFromOpts(opts)
const link = opts['--link'] || 'slow-4g'
if (!routes.length) routes.push('/firm')
if (!headDist) throw new Error('usage: ab.mjs <base dist> <head dist> [--route /firm]')

const CHUNK_NAMES = [
  [/^\/office$/, 'office-page'], [/^\/map$/, 'map-page'], [/^\/progress$/, 'dashboard-page'],
  [/^\/(cases|practice)$/, 'cases-page'], [/^\/(cases|practice)\/.+/, 'case-session-page'],
  [/^\/firm$/, 'firm-page'], [/^\/story$/, 'story-page'],
  [/^\/onboarding$/, 'onboarding-page'], [/^\/login$/, 'login-page'],
]
const chunkFor = (dist, route) => {
  const path = route.split('?')[0].replace(/\/$/, '') || '/'
  const hit = CHUNK_NAMES.find(([re]) => re.test(path))
  if (!hit) return null
  return readdirSync(resolve(dist, 'assets')).find((f) => f.startsWith(`${hit[1]}-`) && f.endsWith('.js')) || null
}

const cookies = await devAuthCookies(apiOrigin, email)
const a = await serveApp(baseDist, apiOrigin, compress)
const b = await serveApp(headDist, apiOrigin, compress)
const browser = await launch()

console.log(`\n  base ${baseDist}\n  head ${headDist}`)
console.log(`  ${pairs} interleaved pairs, 390px / 4x CPU / ${LINKS[link].label} (${link}), ${describeCompression(compress)}`)
console.log(`  signed in as ${email}; ${loadLine()} at the start`)

const METRICS = [['chunkAt', 'route chunk requested'], ['fcp', 'first paint'], ['contentAt', 'route on the glass'], ['lcp', 'largest paint']]
let bad = false
try {
  for (const route of routes) {
    const before = []
    const after = []
    for (let i = 0; i < pairs; i += 1) {
      before.push(await measureRoute(browser, { origin: `http://127.0.0.1:${a.port}`, route, cookies, routeChunk: chunkFor(baseDist, route), link }))
      after.push(await measureRoute(browser, { origin: `http://127.0.0.1:${b.port}`, route, cookies, routeChunk: chunkFor(headDist, route), link }))
    }
    const voidBefore = before.filter((r) => !r.valid).length
    const voidAfter = after.filter((r) => !r.valid).length
    console.log(`\n  ${route}   ${pairs} pairs, ${voidBefore} void base / ${voidAfter} void head`)
    if (voidBefore || voidAfter) {
      bad = true
      console.log('    a void load is a load that did not reach the route; this comparison is not sound')
    }
    for (const [key, label] of METRICS) {
      const x = before.map((r) => r[key])
      const y = after.map((r) => r[key])
      const mx = median(x)
      const my = median(y)
      const won = x.filter((v, i) => v != null && y[i] != null && y[i] < v).length
      const counted = x.filter((v, i) => v != null && y[i] != null).length
      const delta = mx != null && my != null ? my - mx : null
      console.log(
        `    ${label.padEnd(22)} ${String(mx ?? '—').padStart(6)} → ${String(my ?? '—').padStart(6)} ms`
        + `  ${delta == null ? '' : `${delta > 0 ? '+' : ''}${delta}`.padStart(7)}`
        + `   head won ${won}/${counted} pairs`,
      )
    }
  }
  /**
   * The control is taken once per run rather than once per pair: it is a
   * statement about the harness, not about either build, and a bounce takes as
   * long as a load.
   */
  const control = await measureRoute(browser, { origin: `http://127.0.0.1:${b.port}`, route: routes[0], cookies: null, link })
  const ok = !control.valid && control.landedOn === '/login'
  console.log(`\n  signed out control on ${routes[0]}: ${ok ? 'bounced to /login as it must' : `UNEXPECTED valid=${control.valid} landed ${control.landedOn}`}`)
  if (!ok) bad = true
} finally {
  await browser.close()
  a.server.close()
  b.server.close()
}
console.log(`  ${loadLine()} at the end\n`)
process.exitCode = bad ? 1 : 0
