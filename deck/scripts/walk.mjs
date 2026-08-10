/**
 * RUNTIME ROBUSTNESS WALK
 *
 * The screenshot harness proves each slide renders on its own, from a cold
 * load. This proves the deck survives being *driven* — which is a different
 * claim, and the one that matters on stage.
 *
 * Four things are checked, in one browser session so that state accumulates
 * exactly as it would during a talk:
 *
 *  1. A full forward pass and a full backward pass, asserting after every
 *     keystroke that the slide the DOM shows is the slide the URL names.
 *  2. Arrow-key mashing with no settle time at all, which is the case
 *     `transitions.ts` `finish()` exists for. A desync here means the layer
 *     pool lost track of which layer is live.
 *  3. `G`, `P` and `#/<id>` deep links.
 *  4. `renderer.info.memory` sampled across the whole pass. There is one
 *     shared `WebGLRenderer` by design, so geometries and textures are
 *     expected to rise while scenes are built and cached and then plateau.
 *     Monotonic growth to the last slide would mean the stage is leaking.
 *
 * Usage: node scripts/walk.mjs [--base=url] [--mash=n]
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'

const PLAYWRIGHT = process.env.DECK_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const { chromium } = await import(PLAYWRIGHT)

/** Named outright rather than resolved by channel, for the reason `shoot.mjs` gives. */
function findChrome() {
  if (process.env.DECK_CHROME) return process.env.DECK_CHROME
  const cache = `${homedir()}/Library/Caches/ms-playwright`
  let builds = []
  try {
    builds = readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  } catch { /* fall through to the pinned path */ }
  for (const build of builds) {
    const path = `${cache}/${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    if (existsSync(path)) return path
  }
  return `${cache}/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
}

const flags = new Map(
  process.argv.slice(2).map((raw) => {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(raw)
    return match ? [match[1], match[2] ?? 'true'] : ['', '']
  }),
)
const BASE = flags.get('base') || 'http://127.0.0.1:5181'
const MASH = Number(flags.get('mash') || 40)
/** Where to write one screenshot per slide during the forward pass. */
const SHOTS = flags.get('shots') || ''
/**
 * `?hud` is what makes `renderer.info.memory` readable, and it is also the
 * thing that must not be on screen when presenting — so a run that is
 * capturing frames for review deliberately does without it and reports the
 * memory check as unverified rather than photographing chrome the audience
 * will never see.
 */
const WANT_HUD = !SHOTS

const problems = []
const note = (line) => console.log(line)
const fail = (line) => { problems.push(line); console.log(`  FAIL  ${line}`) }

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error.message ?? error)))
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(`console: ${message.text().slice(0, 200)}`)
})

// `?hud` puts the stage's own telemetry in the DOM. That is deliberately the
// only channel this script uses to read `renderer.info.memory`: the
// alternative is a `window` handle on the stage, and a test hook that only
// exists for a test is a hook that stops matching what is presented.
// `?start=0` skips the start card. This script drives the deck with the
// keyboard from its bare URL, which is the one address that would otherwise open
// on the card — and the card deliberately swallows every key while it is up. The
// card has its own harness in `shoot-start.mjs`.
await page.goto(`${BASE}?start=0${WANT_HUD ? '&hud' : ''}`, { waitUntil: 'load' })
await page.waitForSelector('.deck-layer.is-live', { timeout: 30000 })
await page.waitForTimeout(1500)
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

/**
 * The ids, in order. Read off the grid overview, which prints `#/<id>` on
 * every tile — a production bundle has no module graph to import from, and
 * the grid is the one surface that names every slide at once.
 */
await page.keyboard.press('g')
await page.waitForSelector('.grid-tile-hash', { timeout: 10000 })
const ids = (await page.locator('.grid-tile-hash').allTextContents())
  .map((text) => text.replace(/^#\//, '').trim())
await page.keyboard.press('g')
await page.waitForTimeout(500)
note(`walk: ${BASE} — ${ids.length} slides`)

/** What the DOM currently believes, independent of what we asked for. */
const readState = () => page.evaluate(() => {
  const live = document.querySelector('.deck-layer.is-live')
  const hud = document.querySelector('.deck-hud')?.textContent ?? ''
  const geo = /geo (\d+)/.exec(hud)
  const tex = /tex (\d+)/.exec(hud)
  return {
    hash: window.location.hash.replace(/^#\/?/, ''),
    liveLayers: document.querySelectorAll('.deck-layer.is-live').length,
    totalLayers: document.querySelectorAll('.deck-layer').length,
    kind: live?.dataset.kind ?? null,
    headline: live?.querySelector('h1')?.getAttribute('aria-label') ?? null,
    iframes: document.querySelectorAll('.demo-iframe').length,
    canvases: document.querySelectorAll('canvas').length,
    memory: geo && tex ? { geometries: Number(geo[1]), textures: Number(tex[1]) } : null,
  }
})

// --- 1. forward pass -------------------------------------------------------
note('\n1. forward pass')
const samples = []

const capture = async (index) => {
  if (!SHOTS) return
  const name = `${String(index).padStart(2, '0')}-${ids[index]}.png`
  await page.screenshot({ path: `${SHOTS}/${name}` })
}

// The HUD must be absent unless it was asked for. This is the assertion, not
// the eyeball: it is the one piece of chrome that would end up on a projector.
const hudPresent = await page.locator('.deck-hud').count()
if (!WANT_HUD && hudPresent) fail('the debug HUD is on screen without `?hud` — it would be visible when presenting')
else if (!WANT_HUD) note('   HUD absent without `?hud` — correct for presenting')

await capture(0)
for (let index = 1; index < ids.length; index += 1) {
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(1400)
  await capture(index)
  const state = await readState()
  if (state.memory) samples.push({ at: index, ...state.memory })
  if (state.liveLayers !== 1) fail(`slide ${index}: ${state.liveLayers} live layers, expected exactly 1`)
  if (state.totalLayers > 2) fail(`slide ${index}: ${state.totalLayers} layers in the pool, expected at most 2`)
  // The outgoing layer is emptied when the transition's promise resolves, and
  // the longest transition is 1240ms — so a slide sampled at 1400ms can still
  // legitimately be holding both. Only a frame still there well after the
  // longest transition is a leak.
  if (state.iframes > 1) {
    await page.waitForTimeout(1200)
    const settled = await readState()
    if (settled.iframes > 1) {
      fail(`slide ${index} (${ids[index]}): ${settled.iframes} demo iframes still alive 2.6s after arriving`)
    }
  }
  if (state.hash !== ids[index]) fail(`slide ${index}: url says "${state.hash}", expected "${ids[index]}"`)
}
note(`   reached "${(await readState()).hash}" — ${ids.length - 1} presses, ${problems.length} problems so far`)

// --- 2. backward pass ------------------------------------------------------
// Sampled as well as the forward pass, because the honest test of the shared
// renderer is not "did the first pass allocate" — of course it did, it built
// every scene — but "does the second visit to the same scenes allocate again".
const back = []
note('\n2. backward pass')
for (let index = ids.length - 2; index >= 0; index -= 1) {
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(1200)
  const state = await readState()
  if (state.memory) back.push({ at: index, ...state.memory })
  if (state.liveLayers !== 1) fail(`back to ${index}: ${state.liveLayers} live layers`)
  if (state.hash !== ids[index]) fail(`back to ${index}: url says "${state.hash}", expected "${ids[index]}"`)
}
note(`   returned to "${(await readState()).hash}"`)

// --- 3. mashing ------------------------------------------------------------
// No settle at all. This is the case `finish()` exists for.
note(`\n3. mashing ${MASH} presses with no settle`)
for (let press = 0; press < MASH; press += 1) await page.keyboard.press('ArrowRight')
await page.waitForTimeout(2500)
let state = await readState()
const expected = ids[Math.min(ids.length - 1, MASH)]
if (state.liveLayers !== 1) fail(`after mashing: ${state.liveLayers} live layers`)
if (state.totalLayers > 2) fail(`after mashing: ${state.totalLayers} layers left in the pool`)
if (state.hash !== expected) fail(`after mashing: url says "${state.hash}", expected "${expected}"`)
note(`   settled on "${state.hash}" with ${state.liveLayers} live layer, ${state.totalLayers} in pool`)

// Mash both directions at once — the nastier case, because it reverses
// direction mid-transition rather than only re-entering the same one.
for (let press = 0; press < MASH; press += 1) {
  await page.keyboard.press(press % 3 === 0 ? 'ArrowLeft' : 'ArrowRight')
}
await page.waitForTimeout(2500)
state = await readState()
if (state.liveLayers !== 1) fail(`after two-way mashing: ${state.liveLayers} live layers`)
if (!state.headline) fail('after two-way mashing: the live slide has no headline in the DOM')
note(`   two-way settled on "${state.hash}" — "${String(state.headline).slice(0, 46)}…"`)

// --- 4. overlays and deep links -------------------------------------------
note('\n4. overlays and deep links')
await page.keyboard.press('g')
await page.waitForTimeout(600)
if (!(await page.locator('.grid-overview').count())) fail('G did not open the grid overview')
else {
  const tiles = await page.locator('.grid-tile').count()
  if (tiles !== ids.length) fail(`grid shows ${tiles} tiles, expected ${ids.length}`)
  else note(`   G — grid open, ${tiles} tiles`)
}
await page.keyboard.press('g')
await page.waitForTimeout(400)
if (await page.locator('.grid-overview').count()) fail('G did not close the grid overview')

await page.keyboard.press('p')
await page.waitForTimeout(600)
if (!(await page.locator('.presenter').count())) fail('P did not open the presenter overlay')
else {
  const clock = await page.locator('.presenter-clock b').textContent()
  const notesShown = await page.locator('.presenter-notes p').textContent()
  note(`   P — presenter open, clock ${clock}, notes "${String(notesShown).slice(0, 40)}…"`)
}
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
if (await page.locator('.presenter').count()) fail('Escape did not close the presenter overlay')

// A deep link has to work on a cold load, not only as an in-page jump.
const target = ids[Math.floor(ids.length / 2)]
await page.goto(`${BASE}?hud#/${target}`, { waitUntil: 'load' })
await page.waitForSelector('.deck-layer.is-live', { timeout: 20000 })
await page.waitForTimeout(1800)
state = await readState()
if (state.hash !== target) fail(`deep link #/${target} landed on "${state.hash}"`)
else note(`   #/${target} — cold deep link lands correctly`)

// --- 5. memory -------------------------------------------------------------
note('\n5. shared renderer memory')
if (!samples.length || !back.length) {
  note('   HUD telemetry unavailable; memory unverified')
} else {
  const geo = samples.map((s) => s.geometries)
  const tex = samples.map((s) => s.textures)
  const backGeo = back.map((s) => s.geometries)
  note(`   pass 1 (cold, every scene built)  geometries ${geo[0]} → ${geo.at(-1)}, textures ${tex[0]} → ${tex.at(-1)}`)
  note(`   pass 2 (same scenes, reversed)    geometries ${backGeo[0]} → ${backGeo.at(-1)}, peak ${Math.max(...backGeo)}`)

  // The stage caches scenes deliberately, so a cold pass is expected to
  // allocate. A leak is the second pass over the *same* scenes allocating
  // again — that is growth that would not stop however long the talk ran.
  const growth = Math.max(...backGeo) - geo.at(-1)
  const budget = Math.max(24, Math.round(geo.at(-1) * 0.15))
  if (growth > budget) {
    fail(`second pass added ${growth} geometries over the first pass's ${geo.at(-1)} (budget ${budget}) — the stage is not reusing cached scenes`)
  } else {
    note(`   second pass added ${growth} geometries (budget ${budget}) — cached, not leaking`)
  }
}

// The app iframe is a whole other application signing itself in against an
// origin it was not registered for. Its console is not the deck's.
const finalErrors = pageErrors.filter((line) => (
  !/401|Failed to load resource|ERR_ABORTED|net::|GSI_LOGGER|accounts\.google/i.test(line)
))
if (finalErrors.length) {
  for (const line of finalErrors.slice(0, 8)) fail(`page error: ${line}`)
}

note(`\n${'-'.repeat(58)}`)
note(problems.length ? `${problems.length} problem(s)` : 'no problems')
await browser.close()
process.exit(problems.length ? 1 : 0)
