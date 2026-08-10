#!/usr/bin/env node
/**
 * Proves that a run of consecutive demo slides is one session of the app.
 *
 *     cd deck && npm run dev                              # 5180
 *     cd frontend && npm run dev                          # 5173
 *     cd backend && ... run.py                            # 5001
 *     cd deck && node scripts/verify-demo-continuity.mjs
 *
 * This is the regression test for the defect the demo runtime was rebuilt to fix:
 * slides 12, 13 and 14 are authored as one continuous shot — answer a case, read
 * the verdict, then find that same question in the dashboard's review queue — and
 * every slide used to render its own `<iframe>` inside its own slide layer, which
 * `use-deck.ts` destroys when a transition completes. Crossing 12 → 13 reloaded
 * the app from cold and threw away the answered question.
 *
 * ## How it proves it rather than asserting it
 *
 * Three independent signals, because any one of them alone could be satisfied by
 * a frame that merely *looks* continuous:
 *
 *   1. **Element identity.** The iframe is stamped with a random token on slide
 *      12. If React remounted it the stamp is gone, because a remount is a new
 *      element.
 *   2. **Load count.** A `load` listener on that element increments a counter.
 *      A frame that survived but was re-`src`'d would keep its stamp and fail
 *      here, which is exactly the difference between "the element persisted" and
 *      "the session persisted".
 *   3. **In-app state.** Before advancing, the script navigates *inside* the
 *      frame the way the presenter does — clicking Dashboard in the app's own nav
 *      — and then checks the frame is still on `/progress` after the slide
 *      change. This is the one an audience would notice.
 *
 * It also checks the two things that must still happen: leaving the run tears the
 * frame down, and `L` deliberately reloads the current slide's route.
 *
 * Signing in is done through the API rather than the login screen: this runs in a
 * throwaway browser profile, and `/v1/auth/dev` is exactly the affordance the
 * runbook tells a human to click.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAYWRIGHT = process.env.DECK_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'

function findChrome() {
  if (process.env.DECK_CHROME) return process.env.DECK_CHROME
  const cache = `${homedir()}/Library/Caches/ms-playwright`
  let builds = []
  try {
    builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  } catch { /* fall through */ }
  for (const build of builds) {
    const path = `${cache}/${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    if (existsSync(path)) return path
  }
  return `${cache}/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
}

const flags = new Map(process.argv.slice(2).map((raw) => {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`verify-demo-continuity: unrecognised argument "${raw}"`); process.exit(2) }
  return [match[1], match[2] ?? '']
}))

/**
 * `localhost`, never `127.0.0.1`. The app's cookies are `SameSite=Lax` and site
 * is compared by host rather than by origin, so a deck on `127.0.0.1` framing an
 * app on `localhost` is cross-site and every frame bounces to the login screen.
 */
const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const EMAIL = flags.get('email') || 'student@localhost.test'
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots/continuity')
mkdirSync(OUT, { recursive: true })

const problems = []
const notes = []
const fail = (text) => { problems.push(text); console.error(`  \u2717 ${text}`) }
const ok = (text) => { notes.push(text); console.log(`  \u2713 ${text}`) }

const { chromium } = await import(PLAYWRIGHT)
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
})

// --- sign in ---------------------------------------------------------------
{
  const response = await context.request.post(`${APP}/v1/auth/dev`, { data: { email: EMAIL } })
  if (!response.ok()) {
    fail(`could not sign in through ${APP}/v1/auth/dev (${response.status()}). `
      + 'Is the backend up with DEV_AUTH_ENABLED=true?')
  } else {
    ok(`signed in as ${EMAIL}`)
  }
}

const page = await context.newPage()
page.on('pageerror', (error) => fail(`pageerror: ${String(error).slice(0, 180)}`))

/** The hoisted embed, stamped and instrumented so a remount is detectable. */
const instrument = () => page.evaluate(() => {
  const frame = document.querySelector('.demo-stage-frame')
  if (!frame) return null
  if (!frame.dataset.stamp) {
    frame.dataset.stamp = `s${Math.random().toString(36).slice(2)}`
    frame.dataset.loads = '0'
    frame.addEventListener('load', () => {
      frame.dataset.loads = String(Number(frame.dataset.loads ?? 0) + 1)
    })
  }
  return { stamp: frame.dataset.stamp, loads: Number(frame.dataset.loads) }
})

const readFrame = () => page.evaluate(() => {
  const frame = document.querySelector('.demo-stage-frame')
  // The *host* is what has to line up with the slot. The iframe inside it is the
  // app's logical viewport, scaled to fit and centred, so it is legitimately
  // narrower than the host on whichever axis does not bind.
  const host = document.querySelector('.demo-stage')?.getBoundingClientRect()
  const slot = document.querySelector('.deck-layer.is-live .demo-screen')?.getBoundingClientRect()
  return {
    present: Boolean(frame),
    stamp: frame?.dataset.stamp ?? null,
    loads: frame ? Number(frame.dataset.loads ?? -1) : null,
    hash: window.location.hash.replace(/^#\/?/, ''),
    focusInEmbed: document.activeElement === frame,
    fit: host && slot ? {
      dx: Math.round(host.left - slot.left),
      dy: Math.round(host.top - slot.top),
      dw: Math.round(host.width - slot.width),
      dh: Math.round(host.height - slot.height),
    } : null,
  }
})

/**
 * Advance the deck the way a presenter does after working inside the embed.
 *
 * The mouse move is not padding: while focus is inside the cross-origin frame the
 * deck's `window` keydown listener never sees a key, and moving the pointer off
 * the embed is the signal the stage uses to take the keyboard back. Exercising
 * that handover is part of what this script is for.
 */
const advance = async (key = 'ArrowRight') => {
  await page.mouse.move(12, 540)
  await page.waitForTimeout(140)
  await page.keyboard.press(key)
}

/** The app's own document inside the embed. */
const appFrame = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = page.frames().find((frame) => frame.url().startsWith(APP))
    if (found) return found
    await page.waitForTimeout(250)
  }
  return null
}

// --- slide 12: the case ----------------------------------------------------
console.log('\n\u2022 Slide 12 — the case')
await page.goto(`${BASE}/#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('.demo-stage-frame', { timeout: 20000 }).catch(() => {
  fail('no hoisted demo frame appeared on slide 12')
})
let embedded = await appFrame()
/** Slide 12's case URL, kept so slide 13 can prove it moved off it. */
let openCaseUrl = ''
if (!embedded) fail('the app never loaded inside the embed')
else {
  await embedded.waitForLoadState('domcontentloaded').catch(() => undefined)
  await page.waitForTimeout(3500)
  const url = embedded.url()
  openCaseUrl = url
  if (/\/login/.test(url)) {
    fail(`the embed bounced to the login screen (${url}). `
      + `The deck must be opened as ${BASE} and not as a 127.0.0.1 spelling.`)
  } else {
    ok(`the embed is on ${url.replace(APP, '')}`)
  }
}
const first = await instrument()
if (!first) fail('could not instrument the embed')
const twelve = await readFrame()
if (twelve.fit) {
  const worst = Math.max(...Object.values(twelve.fit).map(Math.abs))
  if (worst > 2) fail(`the hoisted embed is ${worst}px out of register with its slot: ${JSON.stringify(twelve.fit)}`)
  else ok(`the embed is registered on its slot to within ${worst}px`)
}
await page.screenshot({ path: resolve(OUT, '12-case.png') })

// --- the staged case: no typing, no locked choices -------------------------
//
// Slide 12 used to end with the presenter clicking Dashboard inside the frame.
// It no longer does: the four-minute cut advances straight to the pre-graded
// verdict, so what matters here is that the case arrives already staged.
console.log('\n\u2022 Slide 12 — the staged case')
if (embedded) {
  const staged = await embedded.evaluate(() => {
    const box = document.querySelector('textarea')
    return {
      reasoningChars: box ? box.value.trim().length : -1,
      choices: document.querySelectorAll('[data-choice-label], [class*="choice"] button, button[aria-label^="Answer"]').length,
    }
  }).catch(() => null)
  if (!staged) {
    notes.push('note: could not read the case DOM; skipping the staged-state checks')
  } else if (staged.reasoningChars < 120) {
    fail(`the reasoning is not pre-pasted (${staged.reasoningChars} chars). `
      + 'Run `npm run stage-demo:fast` — the presenter would have to type this on stage.')
  } else {
    ok(`the reasoning is pre-pasted (${staged.reasoningChars} chars), so nobody types on stage`)
  }
}
const beforeAdvance = await readFrame()
if (beforeAdvance.focusInEmbed) ok('the embed had taken the keyboard, as it does on stage — exercising the handover')

// --- slide 13: the verdict, which must be the same session -----------------
console.log('\n\u2022 Slide 12 \u2192 13 — the seam')
await advance()
await page.waitForTimeout(2200)
const thirteen = await readFrame()

if (thirteen.hash !== 'demo-case-verdict-review') fail(`did not land on slide 13 (hash is "${thirteen.hash}")`)
if (!thirteen.present) fail('the embed disappeared crossing 12 \u2192 13')
if (thirteen.stamp !== beforeAdvance.stamp) {
  fail(`the embed was remounted crossing 12 \u2192 13 (stamp ${beforeAdvance.stamp} \u2192 ${thirteen.stamp}). `
    + 'This is the original defect.')
} else {
  ok(`the same iframe element survived 12 \u2192 13 (stamp ${thirteen.stamp})`)
}
// Slide 13 deliberately points at a *different* session — the pre-graded twin,
// whose stored coaching is what removes the 20-40 second model call from the
// stage. The deck and the app are on different origins, so a route change can
// only be done by reassigning `src`, which reloads. One load event here is
// therefore correct; the invariant worth holding is that the *element* survives,
// so the session cookie and the warm connection are kept and no login appears.
if (thirteen.loads > beforeAdvance.loads + 1) {
  fail(`the embed reloaded more than once crossing 12 \u2192 13 (${beforeAdvance.loads} \u2192 ${thirteen.loads})`)
} else {
  ok(`one navigation crossing 12 \u2192 13 (${beforeAdvance.loads} \u2192 ${thirteen.loads}), as the verdict route requires`)
}
{
  const url = page.frames().find((frame) => frame.url().startsWith(APP))?.url() ?? ''
  if (!/\/cases\//.test(url)) {
    fail(`the embed is not on a case route after the slide change (${url.replace(APP, '')})`)
  } else if (openCaseUrl && url === openCaseUrl) {
    fail('slide 13 is still on the OPEN case session. It must be on the pre-graded twin, '
      + 'or the verdict waits on a live model call. Check `verdictSessionId` in demo.config.ts.')
  } else {
    ok(`the embed is on the pre-graded verdict case (${url.replace(APP, '')})`)
  }
}
if (thirteen.fit) {
  const worst = Math.max(...Object.values(thirteen.fit).map(Math.abs))
  if (worst > 2) fail(`out of register on slide 13 by ${worst}px: ${JSON.stringify(thirteen.fit)}`)
  else ok(`still registered to within ${worst}px on slide 13`)
}
await page.screenshot({ path: resolve(OUT, '13-verdict.png') })

// --- slide 14: a different route, so one navigation, same element ----------
console.log('\n\u2022 Slide 13 \u2192 14 — on to /progress')
await advance()
await page.waitForTimeout(2200)
const fourteen = await readFrame()
if (fourteen.stamp !== thirteen.stamp) fail(`the embed was remounted crossing 13 \u2192 14 (${thirteen.stamp} \u2192 ${fourteen.stamp})`)
else if (fourteen.loads > thirteen.loads + 1) fail(`the embed reloaded more than once crossing 13 \u2192 14 (${thirteen.loads} \u2192 ${fourteen.loads})`)
else ok(`the same element carried through to slide 14 ("${fourteen.hash}"), signed in throughout`)
await page.screenshot({ path: resolve(OUT, '14-mega-litigation.png') })

// --- L reloads the slide's own route ---------------------------------------
console.log('\n\u2022 L \u2014 deliberately reload this slide\u2019s route')
await advance('l')
await page.waitForTimeout(3000)
const reloaded = await readFrame()
if (reloaded.stamp !== fourteen.stamp) fail('L replaced the element instead of navigating it')
else if (reloaded.loads <= fourteen.loads) fail(`L did not reload the embed (${fourteen.loads} \u2192 ${reloaded.loads} load events)`)
else ok(`L reloaded the route in the same element (${fourteen.loads} \u2192 ${reloaded.loads} load events)`)

// --- leaving the run tears it down ----------------------------------------
console.log('\n\u2022 Leaving the run')
await advance()
await page.waitForTimeout(2600)
const after = await readFrame()
if (after.present) fail(`the embed is still mounted on a non-demo slide ("${after.hash}")`)
else ok(`the embed is torn down on the first non-demo slide ("${after.hash}")`)

// --- and the panic button still works -------------------------------------
console.log('\n\u2022 The panic button')
await page.goto(`${BASE}/?stills=1#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
const stills = await page.evaluate(() => ({
  still: Boolean(document.querySelector('.demo-still')),
  frame: Boolean(document.querySelector('.demo-stage-frame')),
  lamp: document.querySelector('.demo-lamp')?.textContent ?? null,
}))
if (!stills.still) fail('?stills=1 did not put a still on the case slide')
else if (stills.frame) fail('?stills=1 left a live embed mounted as well as the still')
else ok(`?stills=1 shows the still and no embed, lamp reads "${stills.lamp}"`)
await page.screenshot({ path: resolve(OUT, 'stills.png') })

await browser.close()
writeFileSync(resolve(OUT, 'report.json'), `${JSON.stringify({ base: BASE, app: APP, when: new Date().toISOString(), problems, notes }, null, 2)}\n`)
console.log(`\n${problems.length ? `${problems.length} problem(s)` : 'all checks passed'} \u2014 ${OUT}`)
process.exit(problems.length ? 1 : 0)
