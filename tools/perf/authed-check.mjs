/**
 * Loads every route with a session and says, per route, whether it was really
 * that route.
 *
 * This is the thing that was missing. A previous QA sweep produced a clean
 * table in which every row had silently fallen back to `/login`, and nothing in
 * the run said so — the harness assumed sign-in had worked because the sign-in
 * response looked fine. Run this before trusting any authenticated measurement,
 * and after changing anything about the serving rig.
 *
 *   node tools/perf/authed-check.mjs frontend/dist
 *   ... --routes /firm,/cases/:id      a subset
 *   ... --signed-out                   the control: every protected route must
 *                                      bounce to /login, which is how you know
 *                                      the signed-in run proved something
 */
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { serveLikeProd } from '../css-split/prod-serve.mjs'
import { API, ROUTES, authedContext, describeProof, load, proveSignedIn, resolveRoutes, signIn } from './authed.mjs'

const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
const CHROME = process.env.LSAT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const argv = process.argv.slice(2)
const takes = new Set(['--routes'])
const opts = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const dist = resolve(positional[0] || 'frontend/dist')
const signedOut = Boolean(opts['--signed-out'])
const wanted = (opts['--routes'] ? String(opts['--routes']).split(',') : ROUTES).map((r) => r.trim())

const session = await signIn()
const routes = await resolveRoutes(wanted, session)
const rig = await serveLikeProd(dist, { compress: 'auto', api: signedOut, apiOrigin: signedOut ? null : API })
const browser = await chromium.launch({ executablePath: CHROME })

const rows = []
try {
  console.log(`\n  ${dist}`)
  console.log(`  ${signedOut ? 'signed out (control run, /v1 answers 401)' : `signed in as ${session.email} via ${API}`}`)
  console.log(`  load ${load()}\n`)
  for (const route of routes) {
    const context = signedOut
      ? await browser.newContext({ viewport: { width: 390, height: 844 } })
      : await authedContext(browser, { port: rig.port, session })
    const page = await context.newPage()
    try {
      await page.goto(`http://127.0.0.1:${rig.port}${route}`, { waitUntil: 'load' })
      // The redirect a signed-out visitor gets is a client-side one that only
      // commits once `me` has answered and React has rendered, so sampling the
      // url at `load` would see the route it was asked for and call it a pass.
      await page.waitForTimeout(3000)
      const proof = await proveSignedIn(page, route, session, { strict: false })
      rows.push(proof)
      console.log(`  ${route.padEnd(46)} ${describeProof(proof)}`)
    } finally {
      await page.close()
      await context.close()
    }
  }
} finally {
  await browser.close()
  rig.server.close()
}

const good = rows.filter((r) => r.ok)
console.log(`\n  ${good.length}/${rows.length} routes proved signed in; load ${load()}`)
if (signedOut) {
  const bounced = rows.filter((r) => r.landed === '/login' || r.isLoginScreen)
  console.log(`  control: ${bounced.length}/${rows.length} landed on the sign-in screen with no session`)
  console.log(`  ${bounced.length >= rows.length - 1 ? 'the rig really does require a session, so the signed-in run means something' : 'SOMETHING IS SERVING THESE ROUTES WITHOUT A SESSION — the signed-in run proves nothing'}`)
} else if (good.length !== rows.length) {
  console.log('  FAILED — do not record measurements from this rig until every route proves out.')
  process.exitCode = 1
}
console.log('')
