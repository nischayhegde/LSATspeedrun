#!/usr/bin/env node
/**
 * Proves the deck needs nothing of the presenter but three steps.
 *
 *     cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py
 *     cd frontend && npm run dev
 *     cd deck && npm run dev        # then open http://localhost:5180
 *     cd deck && node scripts/verify-cold-start.mjs
 *
 * ## Why this exists
 *
 * The demos used to work only because the browser profile in use had been signed
 * in by hand at some earlier point, and the runbook asked the presenter to do it
 * — open the app's login page, click a button, then paste a localStorage key into
 * devtools to stop the guided tour. That is invisible per-profile state. It meant
 * the deck worked on the machine it was built on and would have shown a **login
 * screen to an audience** on a fresh profile, in another browser, in a guest
 * window, after a cookie clear, or on a borrowed laptop.
 *
 * Every check here therefore runs in a browser context created seconds earlier
 * with an empty cookie jar and empty local storage, and **nothing signs it in**.
 * That is the whole point: testing this from a profile that is already signed in
 * passes for the wrong reason, which is precisely how the original problem stayed
 * hidden. If this script ever starts signing itself in, it has stopped testing
 * anything.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flags = new Map(process.argv.slice(2).map((raw) => {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`verify-cold-start: unrecognised argument "${raw}"`); process.exit(2) }
  return [match[1], match[2] ?? '']
}))

const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots/cold-start')
mkdirSync(OUT, { recursive: true })

const problems = []
const notes = []
const fail = (text) => { problems.push(text); console.error(`  \u2717 ${text}`) }
const ok = (text) => { notes.push(text); console.log(`  \u2713 ${text}`) }

const browser = await launchChromium()

/** A profile that has never seen this app. No cookies, no local storage. */
async function coldContext() {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  const cookies = await context.cookies()
  if (cookies.length) fail(`the context was not cold: ${cookies.length} cookie(s) already present`)
  return context
}

const readEmbed = async (page) => {
  const frame = page.frames().find((entry) => entry.url().startsWith(APP) && !entry.url().includes('deck-warm'))
  if (!frame) return null
  return frame.evaluate(() => ({
    path: window.location.pathname,
    signIn: /Enter your firm|Continue with Google|Enter local development firm/i.test(document.body.innerText || ''),
    tour: Boolean(document.querySelector('.tour-card, [class*="guided-tour"], .tour-confidence')),
  })).catch(() => null)
}

// --- 1. the presenter's own path: open the deck, press start ----------------
//
// Deliberately the full path rather than a deep link, because this is the one a
// human takes and the start card is where the session is established.
console.log('\n\u2022 A cold browser opens the deck and starts the show')
{
  const context = await coldContext()
  const page = await context.newPage()
  let unauthorized = 0
  const warmed = new Set()
  page.on('response', (response) => { if (response.status() === 401) unauthorized += 1 })
  page.on('request', (request) => {
    const match = /\/(office|map)\?deck-warm=1/.exec(request.url())
    if (match) warmed.add(match[1])
  })

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.pf-strip', { timeout: 20000 }).catch(() => {
    fail('the start card never rendered its preflight strip')
  })

  // The strip is the presenter's only setup surface, so its verdict is the thing
  // that has to be right on a cold profile.
  await page.waitForFunction(
    () => !document.querySelector('.pf-dot.is-checking'),
    { timeout: 40000 },
  ).catch(() => notes.push('note: the preflight was still checking after 40s'))

  const strip = await page.evaluate(() => ({
    text: document.querySelector('.pf-strip')?.textContent?.trim() ?? '',
    bad: document.querySelectorAll('.pf-dot.is-bad').length,
    warn: document.querySelectorAll('.pf-dot.is-warn').length,
    trouble: document.querySelector('.pf-panel')?.textContent?.trim() ?? null,
  }))
  if (strip.bad) fail(`preflight reports ${strip.bad} bad check(s) on a cold profile: ${strip.trouble ?? strip.text}`)
  else ok(`preflight is clean on a cold profile — "${strip.text}"`)

  const cookies = await context.cookies()
  const named = cookies.map((cookie) => cookie.name)
  if (!named.includes('lsat_session')) {
    fail('no lsat_session cookie after the preflight ran. The deck did not sign itself in, '
      + 'so the presenter would have to — which is the thing this must never require.')
  } else {
    ok(`the deck signed itself in: ${named.join(', ')}`)
  }

  await page.screenshot({ path: resolve(OUT, '1-start-card.png') })

  // The deleted runbook step also warmed these two routes by hand. If the
  // replacement stops firing, the office slide opens with a nine-second stall and
  // nothing else would say so.
  await page.waitForFunction(
    () => document.querySelectorAll('iframe[src*="deck-warm"]').length > 0,
    { timeout: 25000 },
  ).catch(() => undefined)
  // A quiet window before judging, because this check was measuring itself.
  //
  // `startWarmUp` pumps its queue through `requestIdleCallback`, and everything
  // above — the preflight poll, three `evaluate`s, a full-page screenshot —
  // keeps the main thread busy enough that idle callbacks stop being handed
  // out. So this reported "warmed 1/2" consistently while a passive observer
  // that only watched requests saw office at 1.6s and map at 3.7s on the same
  // machine. A presenter reading the start card is the passive case; this
  // harness was the only thing creating the starvation it then reported.
  if (warmed.size < 2) await page.waitForTimeout(6000)
  if (warmed.size < 2) {
    notes.push(`note: only warmed [${[...warmed].join(', ') || 'nothing'}] before Start was pressed`)
    console.log(`  \u00b7 warmed ${warmed.size}/2 scene routes before Start (office is the one that matters)`)
  } else {
    ok('both scene routes warmed behind the title card, so no nine-second office stall')
  }

  // Start the show the way a presenter does, then walk to the first demo.
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  await page.goto(`${BASE}/#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.demo-stage-frame', { timeout: 20000 }).catch(() => {
    fail('no demo embed mounted on the case slide')
  })
  await page.waitForTimeout(6000)

  const embed = await readEmbed(page)
  if (!embed) fail('the app never loaded inside the embed')
  else if (embed.signIn || embed.path === '/login') {
    fail(`the case slide is showing the app's SIGN-IN PAGE on a cold profile (${embed.path}). `
      + 'This is what an audience would see.')
  } else {
    ok(`the case slide embeds the running app (${embed.path}) with no human having signed in`)
  }
  if (embed?.tour) {
    fail('the guided tour opened inside the embed. It covers the demo. '
      + 'Run `npm run stage-demo` — it marks the demo account as already oriented.')
  } else if (embed) {
    ok('no guided tour inside the embed')
  }
  if (unauthorized) notes.push(`note: ${unauthorized} 401(s) seen before the sign-in landed, which is expected on a cold profile`)
  await page.screenshot({ path: resolve(OUT, '2-case-slide.png') })
  await context.close()
}

// --- 2. a deep link, which skips the start card -----------------------------
//
// A presenter who reloads mid-talk lands here, and it must not depend on the card
// having been seen: `StartGate` runs the preflight on mount either way.
console.log('\n\u2022 A cold browser deep-links straight to a demo slide')
{
  const context = await coldContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/#/demo-mega-litigation`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.demo-stage-frame', { timeout: 20000 }).catch(() => {
    fail('no demo embed mounted on the deep-linked slide')
  })
  await page.waitForTimeout(8000)
  const embed = await readEmbed(page)
  if (!embed) fail('the app never loaded inside the deep-linked embed')
  else if (embed.signIn || embed.path === '/login') {
    fail(`a deep-linked demo slide shows the sign-in page on a cold profile (${embed.path}). `
      + 'The preflight must sign in on mount, not only from the start card.')
  } else {
    ok(`the deep-linked slide embeds the running app (${embed.path})`)
  }
  await page.screenshot({ path: resolve(OUT, '3-deep-link.png') })
  await context.close()
}

// --- 3. idempotence ---------------------------------------------------------
//
// Re-running against a profile that is already signed in must be a no-op rather
// than a second login, or every reload would mint an AuthSession row.
console.log('\n\u2022 A warm profile is not signed in again')
{
  const context = await coldContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.pf-dot.is-checking'), { timeout: 40000 }).catch(() => undefined)
  const first = (await context.cookies()).find((cookie) => cookie.name === 'lsat_session')?.value ?? ''

  let logins = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/auth\/dev$/.test(request.url())) logins += 1
  })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.pf-dot.is-checking'), { timeout: 40000 }).catch(() => undefined)
  const second = (await context.cookies()).find((cookie) => cookie.name === 'lsat_session')?.value ?? ''

  if (logins) fail(`the deck signed in again on reload (${logins} POST to /auth/dev) — it should be a no-op`)
  else ok('no second sign-in on reload')
  if (first && second && first !== second) fail('the session cookie was replaced on reload')
  else if (first) ok('the same session cookie survived the reload')
  await context.close()
}

// --- 4. and when it cannot sign in, it says so at the start card ------------
//
// The failure this replaces was silent and plausible: a login screen on slide 12,
// mid-sentence. So the interesting case is not that the sign-in works, it is that
// its absence is legible during setup. The dev-login call is failed here on
// purpose — the same shape as a backend started without DEV_AUTH_ENABLED.
console.log('\n\u2022 When automatic sign-in cannot work, the start card says so')
{
  const context = await coldContext()
  await context.route('**/demo-api/v1/auth/dev', (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'not_found', message: 'Development sign-in is disabled.' }),
  }))
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.pf-dot.is-checking'), { timeout: 40000 }).catch(() => undefined)

  const state = await page.evaluate(() => ({
    bad: document.querySelectorAll('.pf-dot.is-bad').length,
    head: document.querySelector('.pf-panel-head')?.textContent?.trim() ?? null,
    body: document.querySelector('.pf-panel')?.textContent ?? '',
  }))
  if (!state.bad) {
    fail('automatic sign-in was refused and the preflight still reported everything fine. '
      + 'This is the silent-plausible-wrongness failure, in the one place that exists to catch it.')
  } else if (!/DEV_AUTH_ENABLED/.test(state.body)) {
    fail(`the preflight flagged a problem but did not name the fix: "${state.head}"`)
  } else {
    ok(`the start card refuses to look fine: "${state.head}", and names DEV_AUTH_ENABLED`)
  }
  await page.screenshot({ path: resolve(OUT, '4-auth-refused.png') })
  await context.close()
}

await browser.close()
writeFileSync(resolve(OUT, 'report.json'), `${JSON.stringify({ base: BASE, app: APP, when: new Date().toISOString(), problems, notes }, null, 2)}\n`)
console.log(`\n${problems.length ? `${problems.length} problem(s)` : 'a cold browser needs nothing from the presenter'} \u2014 ${OUT}`)
process.exit(problems.length ? 1 : 0)
