#!/usr/bin/env node
/**
 * Proves `demo-office-transformation` can actually perform its own script.
 *
 *     cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py
 *     cd frontend && npm run dev                          # 5173
 *     cd deck && npm run dev                              # 5180
 *     cd deck && node scripts/verify-office-toggle.mjs
 *
 * The slide is written as a toggle — a rundown tier-0 office becoming a fully
 * built tier-14 one while the presenter says nothing for five seconds — and for
 * several revisions it had no mechanism to do that. A `DemoSpec` carried one
 * `route` and one `still`, the route was pinned at `/office?officeTier=0`, and
 * `L` reloaded it. The before/after could not happen at all, which is a slide the
 * cut list marks *never cut* being unable to make its point.
 *
 * `demo.toggle` on that slide is the mechanism. This is its regression test, and
 * it exists for the same reason `verify-still-only.mjs` does: the flag needs more
 * than one thing to be true, and only one of them is obvious.
 *
 * ## The two halves, and why the second is the one that rots
 *
 * 1. **Live.** `T` has to move the *existing* iframe between the app's two real
 *    tier overrides. Not a remount — a remount is a cold boot of the app in front
 *    of the room, and on the heaviest scene in the deck.
 * 2. **On stills.** The same key has to swap the two captured PNGs, with no app
 *    running at all. This is the half that would be quietly dropped by anyone
 *    implementing the live path first, and it is the half that matters most: the
 *    whole before/after is the slide, so it has to survive the stack dying. Before
 *    the toggle existed, `?stills=1` on this slide could only ever show tier 0 —
 *    the "after" was unreachable and `demo-office-tier14.png` sat in the
 *    repository referenced by nothing.
 *
 * ## What it cannot check, and why the screenshots are the point
 *
 * The tier override is read by `office-three.tsx` off `window.location.search`
 * and only ever reaches the WebGL scene. The office page's DOM is driven by the
 * *server's* game state, so it is byte-identical at tier 0 and tier 14 — there is
 * no element to assert on and no text that changes. So this script proves the
 * mechanism (the URL the frame is on, the element surviving, the load count, the
 * still that gets painted, the caption above it) and writes four frames for a
 * person to look at. Judging whether the room actually rebuilt is an eyeball
 * step, deliberately: this project has already shipped a slide showing an
 * entirely wrong screen that looked perfectly fine, and a check that reads a URL
 * would have passed on it.
 *
 * Signing in is done through the API rather than the login screen, and the deck
 * is opened as `localhost` — never `127.0.0.1`, whose cookies are withheld from
 * the framed app. See `DEMO-NOTES.md` §8.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flags = new Map(process.argv.slice(2).map((raw) => {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`verify-office-toggle: unrecognised argument "${raw}"`); process.exit(2) }
  return [match[1], match[2] ?? '']
}))

const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const EMAIL = flags.get('email') || 'student@localhost.test'
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots/office-toggle')
/**
 * How long to let the tier-14 scene build before the shutter. Generous on
 * purpose: this is the heaviest scene in the deck and a frame shot mid-build is
 * a frame that gets misread as a broken toggle.
 */
const SETTLE = Number(flags.get('settle') || 6000)
/**
 * The slide's five scripted seconds of silence, which is the budget the toggle
 * has to land inside. Reported rather than enforced — on a machine also driving
 * a projector this will vary, and the number is worth knowing either way.
 */
const SILENT_BUDGET_S = Number(flags.get('budget') || 5)

mkdirSync(OUT, { recursive: true })

/**
 * How hard this machine is working, per core. Same reasoning as in
 * `verify-demo-continuity.mjs`, and here for one measured reason: on a box at
 * load 31 with 8 cores this script reported *two* loads for one toggle and took
 * 126 seconds; the same code on the same machine minutes later counted one load
 * and finished in 42. The double navigation is real when it happens — the scene
 * would build twice where the room can see it — but a saturated dev server
 * causes it, so failing on it there is failing on the wrong thing.
 */
const loadPerCore = () => loadavg()[0] / Math.max(1, cpus().length)
const SATURATED = 1.5

const problems = []
const notes = []
const fail = (text) => { problems.push(text); console.error(`  \u2717 ${text}`) }
const ok = (text) => { notes.push(text); console.log(`  \u2713 ${text}`) }

/**
 * The toggle key, read out of the slide registry rather than written here.
 *
 * Same reasoning as `expectedAnswer` in `verify-demo-continuity.mjs`: the key is
 * declared on the spec, the presenter reads it out of the click path, and a
 * script holding a second copy is a script that passes while the presenter
 * presses the wrong thing. Regexed rather than parsed — the registry is a
 * TypeScript module and this is a plain `.mjs` — and a miss is fatal rather than
 * skipped, because there is nothing left to test without it.
 */
const REGISTRY = resolve(DECK_DIR, 'src/slides/index.ts')
const TOGGLE_KEY = (() => {
  try {
    const source = readFileSync(REGISTRY, 'utf8')
    // The one `toggle:` block in the registry, and the `key:` inside it.
    const block = /toggle:\s*\{[\s\S]*?\}/.exec(source)?.[0] ?? ''
    return /key:\s*'([^']+)'/.exec(block)?.[1] ?? null
  } catch {
    return null
  }
})()
if (!TOGGLE_KEY) {
  console.error('verify-office-toggle: could not read demo.toggle.key out of src/slides/index.ts. '
    + 'Either the slide has no toggle — in which case the slide cannot perform its own script — or the '
    + 'registry\u2019s shape changed and this regex needs updating.')
  process.exit(2)
}
/** The key as the presenter reads it in the click path, for this script's own messages. */
const KEY = TOGGLE_KEY.toUpperCase()
ok(`the toggle key is declared on the slide as "${KEY}"`)

/**
 * Keys the rest of the deck already binds, and the reason this check exists.
 *
 * `T` was the first key tried for the toggle and it is bound by
 * `start/use-start-gate.ts` to bring the start card back — in the *capture*
 * phase, with a `stopPropagation()`, so it wins before any other listener and
 * the toggle never fired. Nothing about that was visible: the slide simply did
 * not change, which is indistinguishable from the mechanism not existing. On
 * stage it would have dropped the title card over the money shot.
 *
 * This list is knowledge copied out of `engine/use-deck.ts`, `start/`, and
 * `demo/demo-stage.tsx`, so it can go stale — but a stale list here fails loudly
 * on a key that is actually free, which is the safe direction to be wrong in.
 */
const RESERVED = {
  a: 'reveals the next demo callout (engine/use-deck.ts)',
  f: 'fullscreen (engine/use-deck.ts)',
  g: 'grid overview (engine/use-deck.ts)',
  l: "reloads the current slide's route (demo/demo-stage.tsx)",
  p: 'presenter notes (engine/use-deck.ts)',
  q: 'Q&A panel (engine/use-deck.ts)',
  r: 'resets the presenter clock (engine/use-deck.ts)',
  s: 'forces stills (engine/use-deck.ts)',
  t: 'brings the start card back, in the capture phase with stopPropagation (start/use-start-gate.ts)',
}
{
  const clash = RESERVED[TOGGLE_KEY.toLowerCase()]
  if (clash) {
    fail(`the toggle key "${TOGGLE_KEY.toUpperCase()}" is already bound: it ${clash}. `
      + 'Pick a free key in `demo.toggle.key` on demo-office-transformation.')
  } else {
    ok(`"${TOGGLE_KEY.toUpperCase()}" does not collide with a key the deck already binds`)
  }
}

/** Both stills are committed files, and the slide is unpresentable without either. */
for (const file of ['demo-office-tier0.png', 'demo-office-tier14.png']) {
  const path = resolve(DECK_DIR, 'public/stills', file)
  if (!existsSync(path)) {
    fail(`public/stills/${file} is missing, so one half of the slide has no fallback at all`)
  } else {
    ok(`public/stills/${file} is present (${Math.round(statSync(path).size / 1024)} KB)`)
  }
}

// The office is a Three.js scene; with no GL backend it renders empty and every
// frame below would be a blank rectangle that looks fine in a file list.
// `launchChromium` passes the SwiftShader flags by default.
const browser = await launchChromium()
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

/**
 * Stamp the hoisted embed and count its loads, so a remount is detectable.
 *
 * The stamp is the invariant that carries this: the element surviving is what
 * keeps the app's session cookie and its warm connection, which is the
 * difference between a tier swap and a cold boot of the app on stage.
 */
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

/** Everything the slide claims to be showing, from the deck's own side. */
const readSlide = () => page.evaluate(() => {
  const frame = document.querySelector('.demo-stage-frame')
  const still = document.querySelector('.deck-layer.is-live .demo-still')
    ?? document.querySelector('.demo-still')
  return {
    hash: window.location.hash.replace(/^#\/?/, ''),
    present: Boolean(frame),
    stamp: frame?.dataset.stamp ?? null,
    loads: frame ? Number(frame.dataset.loads ?? -1) : null,
    // The frame's own title bar. It is a caption directly above the picture, so
    // it is the one place a toggle could contradict itself in two adjacent
    // elements — which is exactly how `demo-focus-mode` went wrong once.
    caption: document.querySelector('.deck-layer.is-live .demo-bar code')?.textContent
      ?? document.querySelector('.demo-bar code')?.textContent ?? null,
    still: still ? new URL(still.getAttribute('src'), window.location.href).pathname : null,
  }
})

/** The app's own document inside the embed, ignoring the start card's warm-up frames. */
const embedUrl = () => page.frames()
  .find((frame) => frame.url().startsWith(APP) && !frame.url().includes('deck-warm'))?.url() ?? ''

/**
 * Press a key the way a presenter does.
 *
 * The pointer move is not padding: while focus is inside the cross-origin embed
 * the deck's `window` keydown listener never sees a key, and moving the pointer
 * off the embed is the signal the stage uses to take the keyboard back. On this
 * slide the presenter is not clicking inside the app, so focus should not be in
 * there — but pressing the key the same way the stage expects is the point.
 */
const press = async (key) => {
  await page.mouse.move(12, 540)
  await page.waitForTimeout(140)
  await page.keyboard.press(key)
}

/** Wait for the embed to arrive on a route, and say how long it took. */
const waitForRoute = async (pattern, timeoutMs = 20000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (pattern.test(embedUrl().replace(APP, ''))) return (Date.now() - startedAt) / 1000
    await page.waitForTimeout(100)
  }
  return null
}

// ---------------------------------------------------------------------------
// live: T moves the surviving element between the two tier overrides
// ---------------------------------------------------------------------------
console.log('\n\u2022 live \u2014 the before')
await page.goto(`${BASE}/#/demo-office-transformation`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('.demo-stage-frame', { timeout: 25000 }).catch(() => {
  fail('no hoisted demo frame appeared on demo-office-transformation')
})
await waitForRoute(/^\/office/, 25000)
await page.waitForTimeout(SETTLE)

const before = await instrument()
if (!before) fail('could not instrument the embed')
const beforeRoute = embedUrl().replace(APP, '')
if (/\/login/.test(beforeRoute)) {
  fail(`the embed bounced to the login screen (${beforeRoute}). The deck must be opened as ${BASE}, `
    + 'never as a 127.0.0.1 spelling — the app\u2019s cookies are SameSite=Lax.')
} else if (!/officeTier=0\b/.test(beforeRoute)) {
  fail(`the slide did not open on the tier-0 office (${beforeRoute}). That is the "before", and the slide's `
    + 'first spoken line is "you start here".')
} else {
  ok(`opens on the tier-0 office (${beforeRoute})`)
}
await page.screenshot({ path: resolve(OUT, '1-live-tier0.png') })

console.log(`\n\u2022 live \u2014 ${KEY} toggles to the built firm`)
/** Sampled across the toggle, so it describes the navigation being counted. */
let loadDuringToggle = loadPerCore()
await press(TOGGLE_KEY)
const took = await waitForRoute(/officeTier=14\b/, 25000)
loadDuringToggle = Math.max(loadDuringToggle, loadPerCore())
if (took == null) {
  fail(`${KEY} did not move the embed to the tier-14 office. The slide cannot perform its own script, which is `
    + 'the defect `demo.toggle` exists to fix. Check that no other listener is swallowing the key — `T` was bound '
    + 'in the capture phase by start/use-start-gate.ts and won silently — and that the handler in demo-stage.tsx '
    + 'is bound.')
} else {
  ok(`${KEY} moved the embed to the tier-14 office in ${took.toFixed(1)}s`)
  const route = embedUrl().replace(APP, '')
  if (!/officeAll=1\b/.test(route)) {
    fail(`the toggled route is ${route}, with no officeAll=1. Without it the scene renders the tier's shell but `
      + 'not the staff and furniture, and the line being spoken is about the objects in the room.')
  } else {
    ok(`the toggled route carries officeAll=1 (${route})`)
  }
  if (took > SILENT_BUDGET_S) {
    notes.push(`note: the swap took ${took.toFixed(1)}s against the ${SILENT_BUDGET_S} scripted silent seconds. `
      + 'The tier-14 scene is the heaviest in the deck; suspect a cold Vite transform or machine load, and re-run '
      + 'once the office route has been visited before judging it.')
  }
}

// Read the element AFTER letting the scene settle, not the moment the URL
// changes. `src` is assigned before the navigation completes, so `waitForRoute`
// returns while `load` is still pending — sampling here reported "no load event
// was counted", which reads as a defect and is only the script looking too
// early. The same mistake, in the same shape, as the predecessor check in
// `verify-demo-continuity.mjs` that passed because of when it sampled.
await page.waitForTimeout(SETTLE)
const after = await instrument()
if (before && after) {
  if (after.stamp !== before.stamp) {
    fail(`${KEY} remounted the embed (stamp ${before.stamp} \u2192 ${after.stamp}) instead of navigating it. A remount is `
      + 'a cold boot of the app in front of the room, on the heaviest scene in the deck.')
  } else {
    ok(`the same iframe element survived the toggle (stamp ${after.stamp})`)
  }
  const loads = after.loads - before.loads
  if (loads > 1 && loadDuringToggle > SATURATED) {
    notes.push(`note: the embed loaded ${loads} times for one toggle, which should be exactly one navigation — but `
      + `the machine was at ${loadDuringToggle.toFixed(1)} per core, and a saturated dev server has produced this `
      + 'exact count before on a build that then counted one. Re-run on a quiet machine before believing it.')
  } else if (loads > 1) {
    fail(`the embed loaded ${loads} times for one toggle; a tier swap is exactly one navigation`)
  } else if (loads === 1) {
    ok('one navigation of the surviving element, as the tier override requires')
  } else {
    notes.push('note: no load event was counted for the toggle, which is odd enough to look at by eye')
  }
}

const toggled = await readSlide()
if (toggled.caption && !/officeTier=14/.test(toggled.caption)) {
  fail(`the frame's title bar still reads "${toggled.caption}" while the embed is on the tier-14 office. `
    + 'That caption sits directly above the picture, so it would be the deck contradicting itself.')
} else if (toggled.caption) {
  ok(`the title-bar caption followed the toggle ("${toggled.caption}")`)
}
await page.screenshot({ path: resolve(OUT, '2-live-tier14.png') })

console.log(`\n\u2022 live \u2014 ${KEY} again goes back, so a mis-press is recoverable`)
await press(TOGGLE_KEY)
const back = await waitForRoute(/officeTier=0\b/, 25000)
if (back == null) {
  fail(`${KEY} did not toggle back to the tier-0 office. On a slide with five seconds of scripted silence the `
    + 'recovery matters more than the flourish: a mis-press must be one more press, not a stranded slide.')
} else {
  ok(`${KEY} toggled back to tier 0 in ${back.toFixed(1)}s`)
}

// ---------------------------------------------------------------------------
// leaving the slide resets it, so a second run-through is not played backwards
// ---------------------------------------------------------------------------
console.log('\n\u2022 leaving and returning resets to the before')
await press(TOGGLE_KEY)
if (await waitForRoute(/officeTier=14\b/, 25000) == null) {
  notes.push('note: could not re-toggle to tier 14, so the reset-on-leave check below did not run meaningfully')
}
await press('ArrowRight')
await page.waitForTimeout(2600)
await press('ArrowLeft')
await page.waitForTimeout(2600)
const returned = await readSlide()
const returnedRoute = embedUrl().replace(APP, '')
if (returned.hash !== 'demo-office-transformation') {
  notes.push(`note: expected to be back on demo-office-transformation but the deck is on "${returned.hash}", `
    + 'so the reset check did not run')
} else if (!/officeTier=0\b/.test(returnedRoute)) {
  fail(`returning to the slide left it on ${returnedRoute} rather than the tier-0 office. The toggle would then `
    + 'play the money shot backwards — built firm to shack — on a second run-through, with nothing on screen '
    + 'admitting it. The direction of travel is the argument.')
} else {
  ok('returning to the slide puts it back on the tier-0 office')
}

// ---------------------------------------------------------------------------
// stills: the same key, with no app at all
// ---------------------------------------------------------------------------
console.log(`\n\u2022 stills \u2014 the same ${KEY} toggle with no live app`)
await page.goto(`${BASE}/?stills=1&hud#/demo-office-transformation`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('.demo-still', { timeout: 25000 }).catch(() => {
  fail('no still appeared on demo-office-transformation under ?stills=1')
})
await page.waitForTimeout(1200)
const stillBefore = await readSlide()
if (stillBefore.present) {
  fail('?stills=1 left a live embed mounted as well as the still on demo-office-transformation')
}
if (stillBefore.still !== '/stills/demo-office-tier0.png') {
  fail(`?stills=1 painted ${stillBefore.still} rather than /stills/demo-office-tier0.png`)
} else {
  ok('?stills=1 opens on demo-office-tier0.png')
}
await page.screenshot({ path: resolve(OUT, '3-stills-tier0.png') })

await press(TOGGLE_KEY)
await page.waitForTimeout(1200)
const stillAfter = await readSlide()
if (stillAfter.still !== '/stills/demo-office-tier14.png') {
  fail(`${KEY} did not swap the still: still showing ${stillAfter.still} rather than /stills/demo-office-tier14.png. `
    + 'This is the half that matters most — the before/after is the whole slide, so it has to survive the stack '
    + 'being dead, and `demo-office-tier14.png` is otherwise referenced by nothing.')
} else {
  ok(`${KEY} swaps the still to demo-office-tier14.png with no app running`)
}
if (stillAfter.present) fail('the toggle mounted a live embed on the stills path')
if (stillAfter.caption && !/officeTier=14/.test(stillAfter.caption)) {
  fail(`on stills the caption reads "${stillAfter.caption}" over the tier-14 picture`)
} else if (stillAfter.caption) {
  ok(`the caption follows the still ("${stillAfter.caption}")`)
}
await page.screenshot({ path: resolve(OUT, '4-stills-tier14.png') })

await press(TOGGLE_KEY)
await page.waitForTimeout(900)
const stillBack = await readSlide()
if (stillBack.still !== '/stills/demo-office-tier0.png') {
  fail(`${KEY} did not swap the still back (showing ${stillBack.still})`)
} else {
  ok(`${KEY} swaps the still back, so the stills path is reversible too`)
}

await browser.close()

console.log('')
for (const note of notes.filter((text) => text.startsWith('note:'))) console.log(`  ${note}`)
console.log(`\n${problems.length ? `${problems.length} problem(s)` : 'all checks passed'} \u2014 ${OUT}`)
console.log('Now LOOK at the four frames in that directory. The tier override only reaches the WebGL scene, so no '
  + 'assertion above can tell a rebuilt room from an unchanged one.')
process.exit(problems.length ? 1 : 0)
