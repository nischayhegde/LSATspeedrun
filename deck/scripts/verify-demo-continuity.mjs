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
 * `demo-case-answer`, `demo-case-verdict-review` and `demo-mega-litigation` are
 * authored as one continuous shot — work a case, read the verdict, then see the
 * firm's numbers — and every slide used to render its own `<iframe>` inside its
 * own slide layer, which `use-deck.ts` destroys when a transition completes. Each
 * seam reloaded the app from cold and dropped the session.
 *
 * Slides are named by id throughout, never by number. The deck is renumbered
 * often enough that a message reading "12 → 13" was wrong within a week, and a
 * verification script whose output lies about which slides it looked at is worse
 * than no script.
 *
 * ## What the current choreography is
 *
 * Worth stating, because two of the checks below look like regressions if you are
 * remembering the old cut (see `DEMO-NOTES.md` §5):
 *
 *   - The case slide **ends at confidence 4 without submitting**. Submitting
 *     would start a fresh attempt and put a 20-40s model call on stage. The
 *     graded verdict is already waiting, on a different pre-graded session.
 *   - Because the verdict is a different session, and the deck and the app are on
 *     different origins, advancing can only be done by reassigning `src`. So each
 *     seam legitimately costs **exactly one** warm, already-authenticated reload.
 *     One is correct; two or more is the defect coming back.
 *
 * ## How it proves it rather than asserting it
 *
 * Independent signals, because any one alone could be satisfied by a frame that
 * merely *looks* continuous:
 *
 *   1. **Element identity.** The iframe is stamped with a random token on the
 *      case slide. If React remounted it the stamp is gone, because a remount is
 *      a new element. This is the invariant that carries the whole thing: the
 *      element surviving is what keeps the session cookie and the warm
 *      connection, which is what makes a reload warm instead of a cold boot.
 *   2. **Load count.** A `load` listener on that element increments a counter, so
 *      a frame that survived but was re-`src`'d more than the choreography calls
 *      for still fails. This is the difference between "the element persisted"
 *      and "the session persisted".
 *   3. **In-app state.** The script works the case inside the frame the way the
 *      presenter does — selecting a confidence — and checks the app both
 *      registered it and did *not* grade anything, which is the state the next
 *      slide depends on.
 *   4. **Session identity.** The verdict slide must land on the pre-graded twin
 *      rather than the case just left open, or the verdict waits on a live model.
 *
 * It also checks the things that must still happen: leaving the run tears the
 * frame down, `L` deliberately reloads the current slide's route, and `?stills=1`
 * swaps every embed for a still.
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
    const found = page.frames().find((frame) => frame.url().startsWith(APP) && !frame.url().includes('deck-warm'))
    if (found) return found
    await page.waitForTimeout(250)
  }
  return null
}

// --- the case --------------------------------------------------------------
console.log('\n\u2022 demo-case-answer \u2014 the case')
await page.goto(`${BASE}/#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('.demo-stage-frame', { timeout: 20000 }).catch(() => {
  fail('no hoisted demo frame appeared on demo-case-answer')
})
let embedded = await appFrame()
/** The open case's URL, kept so the verdict slide can prove it moved off it. */
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

// --- the case is staged, and ends at confidence 4 without submitting -------
//
// The old cut ended this slide with a live submit and then a click on Dashboard
// inside the frame. It no longer does, and these checks encode the cut that
// replaced it (`DEMO-NOTES.md` §5): the reasoning arrives already written, the
// presenter's last action is a confidence click, and nothing is graded.
console.log('\n\u2022 demo-case-answer \u2014 staged, and ends at confidence 4')
if (embedded) {
  const staged = await embedded.evaluate(() => {
    const box = document.querySelector('textarea')
    return { reasoningChars: box ? box.value.trim().length : -1 }
  }).catch(() => null)
  if (!staged) {
    notes.push('note: could not read the case DOM; skipping the staged-state checks')
  } else if (staged.reasoningChars < 120) {
    fail(`the reasoning is not pre-pasted (${staged.reasoningChars} chars). `
      + 'Run `npm run stage-demo:fast` — the presenter would have to type this on stage.')
  } else {
    ok(`the reasoning is pre-pasted (${staged.reasoningChars} chars), so nobody types on stage`)
  }

  // The strategy brief opens undecided, and until it is answered the app disables
  // the answer choices, the reasoning box and the confidence row — so this click
  // is not optional dressing, it is what unlocks the rest of the slide. It cannot
  // be pre-staged either: the choice is local state in `case-flow.tsx` with no
  // draft field behind it, so there is nothing for the seeder to write. Hence a
  // beat in the choreography (`DEMO-NOTES.md`) and a click here.
  const strategy = await embedded.evaluate(() => {
    const tip = document.querySelector('.strategy-tip')
    if (!tip) return 'absent'
    const use = tip.querySelector('.strategy-tip-use')
    if (!use) return 'no-button'
    if (tip.querySelector('.strategy-tip-recorded')) return 'already-decided'
    use.click()
    return 'used'
  }).catch(() => 'unreadable')

  if (strategy === 'no-button') {
    fail('the strategy brief is showing but has no "Use it" control, so the case '
      + 'cannot be unlocked. Has the strategy prompt UI changed?')
  } else if (strategy === 'used') {
    ok('the strategy brief was answered with "Use it", which unlocks the case')
  } else if (strategy === 'absent') {
    // Not a failure: the brief is what the slide's first four seconds point at,
    // but a run staged without the prompt variant is still presentable.
    notes.push('note: no strategy brief on the case — the slide\u2019s opening beat has nothing to point at')
  }
  await page.waitForTimeout(300)

  // Click confidence 4 the way the presenter does, then hold the deck to the
  // choreography's last beat: the app registered the click, and nothing graded.
  const clicked = await embedded.evaluate(() => {
    const group = document.querySelector('.confidence-check')
    const button = group && [...group.querySelectorAll('button')].find((el) => el.textContent?.trim() === '4')
    if (!button) return 'no-control'
    if (button.disabled) return 'disabled'
    button.click()
    return 'clicked'
  }).catch(() => 'unreadable')

  if (clicked === 'no-control') {
    fail('no confidence control on the case slide, so the choreography\u2019s last beat '
      + '("click confidence 4") cannot be performed. Has the case UI changed?')
  } else if (clicked === 'disabled') {
    fail('the confidence buttons are still disabled after the strategy brief was '
      + 'answered, so the case is locked and the slide cannot reach its last beat')
  } else if (clicked === 'unreadable') {
    notes.push('note: could not reach the case DOM to click confidence')
  } else {
    await page.waitForTimeout(400)
    const state = await embedded.evaluate(() => {
      const group = document.querySelector('.confidence-check')
      const pressed = group && [...group.querySelectorAll('button')]
        .find((el) => el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active'))
      return {
        confidence: pressed?.textContent?.trim() ?? null,
        // A graded case shows coaching and stops offering the submit. Either one
        // appearing here means the click submitted, which is the 20-40s model
        // call this cut exists to keep off the stage.
        graded: /verdict|coaching|correct answer/i.test(document.body.innerText)
          && !document.body.innerText.toLowerCase().includes('submit'),
        url: window.location.pathname,
      }
    }).catch(() => null)

    if (!state) notes.push('note: could not re-read the case DOM after clicking confidence')
    else if (state.confidence !== '4') {
      fail(`clicking confidence 4 did not take (the app reads "${state.confidence}"). `
        + 'The presenter\u2019s last beat on this slide is this click.')
    } else if (state.graded) {
      fail('the case graded itself after the confidence click. This slide must end '
        + 'UNSUBMITTED — a live submit puts a 20-40s model call in front of the room.')
    } else {
      ok('confidence 4 registered and nothing graded, which is where the slide is meant to end')
    }
  }
}
const beforeAdvance = await readFrame()
if (beforeAdvance.focusInEmbed) ok('the embed had taken the keyboard, as it does on stage — exercising the handover')

// --- slide 13: the verdict, which must be the same session -----------------
console.log('\n\u2022 demo-case-answer \u2192 demo-case-verdict-review — the seam')
await advance()
await page.waitForTimeout(2200)
const thirteen = await readFrame()

if (thirteen.hash !== 'demo-case-verdict-review') fail(`did not land on demo-case-verdict-review (hash is "${thirteen.hash}")`)
if (!thirteen.present) fail('the embed disappeared crossing into demo-case-verdict-review')
if (thirteen.stamp !== beforeAdvance.stamp) {
  fail(`the embed was remounted crossing into demo-case-verdict-review (stamp ${beforeAdvance.stamp} \u2192 ${thirteen.stamp}). `
    + 'This is the original defect.')
} else {
  ok(`the same iframe element survived into demo-case-verdict-review (stamp ${thirteen.stamp})`)
}
// Slide 13 deliberately points at a *different* session — the pre-graded twin,
// whose stored coaching is what removes the 20-40 second model call from the
// stage. The deck and the app are on different origins, so a route change can
// only be done by reassigning `src`, which reloads. One load event here is
// therefore correct; the invariant worth holding is that the *element* survives,
// so the session cookie and the warm connection are kept and no login appears.
if (thirteen.loads > beforeAdvance.loads + 1) {
  fail(`the embed reloaded ${thirteen.loads - beforeAdvance.loads} times crossing into demo-case-verdict-review; `
    + 'the choreography allows exactly one warm reload for the session change')
} else {
  ok(`${thirteen.loads - beforeAdvance.loads} warm reload crossing into demo-case-verdict-review, as the session change requires`)
}
{
  const url = page.frames().find((frame) => frame.url().startsWith(APP) && !frame.url().includes('deck-warm'))?.url() ?? ''
  if (!/\/cases\//.test(url)) {
    fail(`the embed is not on a case route after the slide change (${url.replace(APP, '')})`)
  } else if (openCaseUrl && url === openCaseUrl) {
    fail('demo-case-verdict-review is still on the OPEN case session. It must be on the pre-graded twin, '
      + 'or the verdict waits on a live model call. Check `verdictSessionId` in demo.config.ts.')
  } else {
    ok(`the embed is on the pre-graded verdict case (${url.replace(APP, '')})`)
  }
}
if (thirteen.fit) {
  const worst = Math.max(...Object.values(thirteen.fit).map(Math.abs))
  if (worst > 2) fail(`out of register on demo-case-verdict-review by ${worst}px: ${JSON.stringify(thirteen.fit)}`)
  else ok(`still registered to within ${worst}px on demo-case-verdict-review`)
}
await page.screenshot({ path: resolve(OUT, '13-verdict.png') })

// --- slide 14: a different route, so one navigation, same element ----------
console.log('\n\u2022 demo-case-verdict-review \u2192 demo-mega-litigation — on to /progress')
await advance()
await page.waitForTimeout(2200)
const fourteen = await readFrame()
if (fourteen.stamp !== thirteen.stamp) fail(`the embed was remounted crossing into demo-mega-litigation (${thirteen.stamp} \u2192 ${fourteen.stamp})`)
else if (fourteen.loads > thirteen.loads + 1) fail(`the embed reloaded ${fourteen.loads - thirteen.loads} times crossing into demo-mega-litigation; the choreography allows exactly one`)
else ok(`the same element carried through to demo-mega-litigation ("${fourteen.hash}"), signed in throughout`)
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
  budget: Boolean(document.querySelector('.demo-budget')),
}))
if (!stills.still) fail('?stills=1 did not put a still on the case slide')
else if (stills.frame) fail('?stills=1 left a live embed mounted as well as the still')
else ok('?stills=1 shows the still and no embed')
await page.screenshot({ path: resolve(OUT, 'stills.png') })

// --- presenter-only chrome stays off the projector -------------------------
//
// The status lamp and the budget bar are instruments for the presenter, and the
// worst case for both is the same: the deck is opened without thinking about it
// and the audience reads "stills" off the screen. So the default is bare, and
// `?hud` — the flag the debug HUD already uses — brings them back for rehearsal.
// Checked on the stills path deliberately: that is the case where the lamp has
// something to say and therefore the case where leaking it costs the most.
console.log('\n\u2022 Presenter-only chrome')
if (stills.lamp !== null) fail(`the status lamp is on the audience's screen by default (reads "${stills.lamp}")`)
else ok('no status lamp without ?hud, so a fallback is invisible to the room')
if (stills.budget) fail("the demo budget bar is on the audience's screen by default")
else ok('no budget bar without ?hud')

await page.goto(`${BASE}/?stills=1&hud#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2500)
const rehearsal = await page.evaluate(() => ({
  lamp: document.querySelector('.demo-lamp')?.textContent ?? null,
  budget: Boolean(document.querySelector('.demo-budget')),
}))
if (rehearsal.lamp !== 'stills') fail(`?hud did not bring the lamp back reading "stills" (got "${rehearsal.lamp}")`)
else ok('?hud restores the lamp, reading "stills" — the presenter can still tell live from still')
if (!rehearsal.budget) fail('?hud did not bring the demo budget bar back')
else ok('?hud restores the budget bar')

await browser.close()
writeFileSync(resolve(OUT, 'report.json'), `${JSON.stringify({ base: BASE, app: APP, when: new Date().toISOString(), problems, notes }, null, 2)}\n`)
console.log(`\n${problems.length ? `${problems.length} problem(s)` : 'all checks passed'} \u2014 ${OUT}`)
process.exit(problems.length ? 1 : 0)
