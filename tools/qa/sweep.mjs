/**
 * A signed-in walk of every screen, recording what the browser complains about.
 *
 *   node tools/qa/sweep.mjs frontend/dist
 *   ... --api http://127.0.0.1:5001 --email perf@localhost.test
 *   ... --shots /tmp/qa-shots       write a screenshot per route
 *   ... --width 1280 --height 900   desktop; 390x844 for the phone pass
 *
 * Three things per route, and all three are things a human sweep misses:
 *
 * 1. **Console errors and warnings.** React's own warnings — a key collision, a
 *    controlled/uncontrolled flip, an invalid DOM nesting — are real defects
 *    that never surface as a visible fault until they do.
 * 2. **Failed requests.** A 404 on an asset or a 500 on an endpoint that the
 *    screen swallows into an empty state looks fine and is not.
 * 3. **axe-core**, at the WCAG 2 A/AA rules. Colour contrast is excluded: this
 *    app is a deliberately dark pixel-art interface and contrast findings here
 *    are a design conversation, not a defect list.
 *
 * The same signed-in rig as `tools/perf`: a real backend behind the proxy, a
 * dev-auth cookie, and a route marker that has to appear before the page is
 * judged. A screen that bounced to `/login` is reported as void rather than
 * scored, because otherwise this tool grades the login page nine times.
 */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { compressionFromOpts } from '../css-split/prod-serve.mjs'
import { devAuthCookies, launch, loadLine, markerFor, serveApp } from '../perf/lib.mjs'

// Beside playwright rather than in this repository's tree, for the same reason
// `lib.mjs` names its own: the browser tooling lives in a scratch install and
// adding it to `frontend/package.json` would put a test-only dependency in the
// bundle's dependency graph. `LSAT_AXE` overrides.
const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const AXE_PATH = process.env.LSAT_AXE || resolve(dirname(PW), '../axe-core/axe.min.js')
const AXE = await readFile(AXE_PATH, 'utf8')

const argv = process.argv.slice(2)
const takes = new Set(['--api', '--email', '--shots', '--width', '--height', '--route'])
const opts = {}
const only = []
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--route') { only.push(argv[i + 1]); i += 1 }
  else if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const dist = resolve(positional[0] || 'frontend/dist')
const apiOrigin = opts['--api'] || 'http://127.0.0.1:5001'
const email = opts['--email'] || 'perf@localhost.test'
const viewport = { width: Number(opts['--width'] || 1280), height: Number(opts['--height'] || 900) }
const shots = opts['--shots'] ? resolve(opts['--shots']) : null
if (shots) mkdirSync(shots, { recursive: true })

const ROUTES = only.length ? only : ['/office', '/cases', '/firm', '/progress', '/story', '/map']

/**
 * A route's default tab is a fraction of its screen. These are opened after the
 * route settles and checked in the same pass, because the panels behind a tab
 * are exactly where a defect survives: nobody looks at them on every change.
 */
const PANELS = {
  '/firm': [
    '#firm-tab-upgrades',
    '#firm-tab-decor',
    '#firm-tab-staff',
    '#firm-tab-clients',
    '#firm-tab-connections',
    '#firm-tab-rivals',
  ],
}

/**
 * Noise that is not this app's to fix, kept in one place so the report can say
 * what it ignored. Anything not matched here is reported verbatim.
 */
const IGNORE = [
  /Download the React DevTools/i,
  /WebGL.*context lost/i,
  /THREE\.WebGLRenderer: Context Lost/i,
]

const cookies = await devAuthCookies(apiOrigin, email)
const app = await serveApp(dist, apiOrigin, compressionFromOpts(opts))
const origin = `http://127.0.0.1:${app.port}`
const browser = await launch()

console.log(`\n${dist}   ${viewport.width}x${viewport.height}   signed in as ${email}   ${loadLine()}`)

const findings = []
try {
  for (const route of ROUTES) {
    const context = await browser.newContext({ viewport })
    await context.addCookies(cookies.map((c) => ({ ...c })))
    const page = await context.newPage()

    const console_ = []
    const failed = []
    page.on('console', (message) => {
      const type = message.type()
      if (type !== 'error' && type !== 'warning') return
      const text = message.text()
      if (IGNORE.some((pattern) => pattern.test(text))) return
      console_.push(`${type}: ${text}`)
    })
    page.on('pageerror', (error) => console_.push(`pageerror: ${error.message}`))
    page.on('response', (response) => {
      if (response.status() < 400) return
      // The host matters: a 404 on this app's own origin is a defect, and a
      // 404 on a font CDN is this sandbox's egress policy.
      const url = new URL(response.url())
      failed.push(`${response.status()} ${url.host === `127.0.0.1:${app.port}` ? '' : url.host}${url.pathname}`)
    })

    await page.goto(`${origin}${route}`, { waitUntil: 'load' })
    const marker = markerFor(route)
    let landed = true
    if (marker) {
      try { await page.waitForSelector(marker, { timeout: 20000, state: 'attached' }) } catch { landed = false }
    }
    // Scenes and lazy panels settle after the route's own marker appears.
    await page.waitForTimeout(3500)

    const at = new URL(page.url()).pathname
    if (!landed || at !== route) {
      console.log(`\n  ${route}   VOID — ended on ${at}`)
      findings.push({ route, void: at })
      await context.close()
      continue
    }

    await page.addScriptTag({ content: AXE })
    const runAxe = (where) => page.evaluate(async (label) => {
      const run = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        rules: { 'color-contrast': { enabled: false } },
      })
      return run.violations.map((violation) => ({
        where: label,
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        first: violation.nodes[0]?.target?.join(' ') ?? '',
      }))
    }, where)

    const axe = await runAxe('')
    // A route's default tab is a fraction of its screen, and the panels behind
    // a tab are where a defect survives longest: nobody opens them on every
    // change. Each is checked in this same pass.
    for (const selector of PANELS[route] ?? []) {
      const tab = page.locator(selector).first()
      if (!(await tab.count())) continue
      await tab.click()
      await page.waitForTimeout(1500)
      for (const violation of await runAxe(selector)) {
        if (!axe.some((seen) => seen.id === violation.id && seen.first === violation.first)) axe.push(violation)
      }
    }

    if (shots) await page.screenshot({ path: `${shots}/${route.replace(/\//g, '_') || 'root'}.png`, fullPage: false })

    console.log(`\n  ${route}`)
    console.log(`    console   ${console_.length ? '' : 'clean'}`)
    for (const line of [...new Set(console_)]) console.log(`      ${line.slice(0, 180)}`)
    console.log(`    requests  ${failed.length ? '' : 'clean'}`)
    for (const line of [...new Set(failed)]) console.log(`      ${line}`)
    console.log(`    axe       ${axe.length ? `${axe.length} violation kinds` : 'clean (wcag2a/aa, contrast excluded)'}`)
    for (const violation of axe) {
      console.log(`      [${violation.impact}] ${violation.id} x${violation.nodes} ${violation.where} — ${violation.help}`)
      console.log(`         first: ${violation.first.slice(0, 120)}`)
    }
    findings.push({ route, console: [...new Set(console_)], failed: [...new Set(failed)], axe })
    await context.close()
  }
} finally {
  await browser.close()
  app.server.close()
}

const totals = findings.reduce(
  (sum, row) => ({
    void: sum.void + (row.void ? 1 : 0),
    console: sum.console + (row.console?.length ?? 0),
    failed: sum.failed + (row.failed?.length ?? 0),
    axe: sum.axe + (row.axe?.reduce((n, v) => n + v.nodes, 0) ?? 0),
  }),
  { void: 0, console: 0, failed: 0, axe: 0 },
)
console.log(
  `\n${ROUTES.length} routes: ${totals.void} void, ${totals.console} console lines,`
  + ` ${totals.failed} failed requests, ${totals.axe} axe nodes\n`,
)
