#!/usr/bin/env node
/**
 * Navigate the deck the way a presenter under adrenaline does, and report what
 * breaks.
 *
 *     cd deck && npm run dev                 # 5180, in another terminal
 *     cd deck && node scripts/stress.mjs
 *
 * ## Why this exists next to `shoot.mjs`
 *
 * `shoot.mjs` loads every slide on its own page and photographs it. That is the
 * right harness for "does this slide look right", and it is structurally unable
 * to find the class of bug this deck has been bitten by twice: a timer, a frame
 * loop, a listener or an async continuation belonging to slide N that is still
 * running when slide N+3 is on screen. One slide per page means nothing ever
 * outlives anything.
 *
 * Those bugs only appear under *navigation*, and specifically under navigation
 * faster than the transitions. So this walks one page for the whole run and
 * abuses it:
 *
 *   1. a clean pass forward through every slide, at a human pace
 *   2. arrow mashing, forward and backward, far faster than a transition
 *   3. random jumps by deep link, which change several slides at once
 *   4. resizes landing in the middle of a transition
 *   5. a long idle, which is where an uncancelled interval shows up
 *
 * ## What counts as a failure
 *
 * Anything on the console that is an error, any uncaught exception, and — the
 * reason for the `--strict-react` default — React's own warnings. A hooks-order
 * violation is reported by React as a *warning* on the console before it throws,
 * and a run that only watched for exceptions would miss the warning and then
 * attribute the throw to whatever rendered next.
 *
 * The deck's own demo embeds are excluded from the verdict: without the product
 * running locally they fail to connect, and that is expected here.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAYWRIGHT = process.env.DECK_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const GL_ARGS = ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

const HELP = `
stress — navigate the deck erratically and report what breaks.

  node scripts/stress.mjs [options]

  --base=<url>    Deck dev server. Default http://localhost:5180
  --out=<dir>     Where to write stress-report.json. Default .deck-shots
  --rounds=<n>    How many mash/jump rounds. Default 3
  --idle=<ms>     How long to sit on one slide at the end. Default 20000
  --shots         Also photograph the frame after each phase.
  --help          This text.
`.trim()

const argv = process.argv.slice(2)
const flags = new Map()
for (const raw of argv) {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`stress: unrecognised argument "${raw}"\n\n${HELP}`); process.exit(2) }
  flags.set(match[1], match[2] ?? '')
}
if (flags.has('help')) { console.log(HELP); process.exit(0) }

const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots')
const ROUNDS = Number(flags.get('rounds') || 3)
const IDLE = Number(flags.get('idle') || 20000)
const SHOTS = flags.has('shots')

function findChrome() {
  if (process.env.DECK_CHROME) return process.env.DECK_CHROME
  return `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
}

/**
 * The noise floor.
 *
 * Everything here is a consequence of the product not running beside the deck,
 * which is the normal state of this harness's environment. A demo slide's embed
 * cannot reach `localhost:5173`, and the deck's preflight cannot reach the
 * backend. Neither is a defect in the deck, and a report that calls them one is
 * a report nobody reads to the end.
 */
const EXPECTED = [
  /ERR_CONNECTION_REFUSED/,
  /Failed to load resource/,
  /502 \(Bad Gateway\)/,
  /demo-api/,
  /localhost:5173/,
  /\[vite\] connect/,
]
const isExpected = (text) => EXPECTED.some((pattern) => pattern.test(text))

/**
 * React's own complaints, which are warnings rather than errors and are the
 * whole reason this harness listens to `console.warn` at all.
 *
 * The first two are the hooks-order violation in both directions. The third is
 * a `setState` on a component that has gone, which is the DOM-side symptom of
 * exactly the timer-lifetime bug this file is looking for.
 */
const REACT_FAULTS = [
  /Rendered (more|fewer) hooks than during the previous render/,
  /change in the order of Hooks/i,
  /React has detected a change in the order of Hooks/,
  /Cannot update a component .* while rendering a different component/,
  /Can't perform a React state update on an unmounted component/,
  /Maximum update depth exceeded/,
  /Warning: /,
]
const isReactFault = (text) => REACT_FAULTS.some((pattern) => pattern.test(text))

let chromium
try {
  ;({ chromium } = await import(PLAYWRIGHT))
} catch (error) {
  console.error(`stress: no Playwright at ${PLAYWRIGHT}\n${error}`)
  process.exit(2)
}

const reachable = await fetch(`${BASE}/`, { method: 'GET', signal: AbortSignal.timeout(4000) })
  .then((response) => response.ok)
  .catch(() => false)
if (!reachable) {
  console.error(`stress: nothing answering at ${BASE}. Start it with \`cd deck && npm run dev\`.`)
  process.exit(2)
}

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: findChrome(), args: GL_ARGS })
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
})
const page = await context.newPage()

/** Every complaint, with the phase it arrived in, so a failure has an address. */
const faults = []
let phase = 'boot'
const note = (kind, text) => {
  const trimmed = String(text).slice(0, 400)
  if (isExpected(trimmed)) return
  faults.push({ phase, kind, text: trimmed })
}

page.on('pageerror', (error) => note('exception', error?.message ?? error))
page.on('console', (message) => {
  const type = message.type()
  const text = message.text()
  if (type === 'error') { note('console.error', text); return }
  if ((type === 'warning' || type === 'warn') && isReactFault(text)) note('react', text)
})

const slides = await page.goto(`${BASE}/?start=0`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  .then(() => page.waitForSelector('.deck-layer.is-live', { timeout: 20000 }))
  .then(() => page.evaluate(async () => {
    const module = await import('/src/slides/index.ts')
    return module.SLIDES.map((slide) => slide.id)
  }))
  .catch((error) => { console.error(`stress: could not boot the deck — ${error}`); return null })

if (!slides) { await browser.close(); process.exit(2) }

console.log(`stress: ${BASE} — ${slides.length} slides, ${ROUNDS} rounds, ${IDLE}ms idle`)

/** Dismiss the start card so the deck is driveable. */
await page.keyboard.press('Enter')
await page.waitForTimeout(1600)

const shot = async (name) => {
  if (!SHOTS) return
  await page.screenshot({ path: `${OUT}/stress-${name}.png` }).catch(() => {})
}

const press = async (key, times, gap) => {
  for (let n = 0; n < times; n += 1) {
    await page.keyboard.press(key)
    if (gap) await page.waitForTimeout(gap)
  }
}

// 1. A clean pass, at a pace that lets every transition finish. Anything that
//    breaks here breaks in front of the room on the first run-through.
phase = 'walk-forward'
console.log('  walk forward, 1600ms a slide')
await press('ArrowRight', slides.length - 1, 1600)
await shot('walk-forward')

phase = 'walk-back'
console.log('  walk back')
await press('ArrowLeft', slides.length - 1, 1600)
await shot('walk-back')

for (let round = 1; round <= ROUNDS; round += 1) {
  // 2. Faster than the transitions, which is what strands a deferred callback.
  //    50ms against a `letterbox` that runs for 1240.
  phase = `mash-${round}`
  console.log(`  round ${round}: mash forward at 50ms`)
  await press('ArrowRight', slides.length + 6, 50)
  await page.waitForTimeout(300)
  console.log(`  round ${round}: mash backward at 40ms`)
  await press('ArrowLeft', slides.length + 6, 40)
  await page.waitForTimeout(300)

  // Alternating, which is the case that reuses the same two layers hardest:
  // every navigation cancels a transition going the other way.
  console.log(`  round ${round}: alternate at 30ms`)
  for (let n = 0; n < 40; n += 1) {
    await page.keyboard.press(n % 2 ? 'ArrowLeft' : 'ArrowRight')
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(500)

  // 3. Deep-link jumps. `goto` by several slides at once is the path that
  //    changes the mounted app scenes wholesale rather than by one.
  phase = `jump-${round}`
  console.log(`  round ${round}: random jumps`)
  for (let n = 0; n < 12; n += 1) {
    const target = slides[Math.floor(Math.random() * slides.length)]
    await page.evaluate((id) => {
      window.history.pushState({}, '', `#/${id}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, target)
    await page.waitForTimeout(120 + Math.floor(Math.random() * 260))
  }
  await page.waitForTimeout(600)

  // 4. A resize landing mid-transition. Every figure that measures itself has
  //    a `ResizeObserver`, and the stage rebuilds its render target.
  phase = `resize-${round}`
  console.log(`  round ${round}: resize mid-transition`)
  for (const size of [{ width: 1280, height: 800 }, { width: 2560, height: 1080 }, { width: 1024, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(120)
    await page.setViewportSize(size)
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(500)
}
await shot('after-rounds')

// 5. Sit still. An interval nobody cancelled, a frame loop on an invisible
//    scene, and a scene swap deferred past its transition all show up here and
//    nowhere else.
phase = 'idle'
console.log(`  idle for ${IDLE}ms on one slide`)
const before = await page.evaluate(() => performance.now())
await page.waitForTimeout(IDLE)

// What the deck thinks is on screen after all of that, against what the URL
// says. A mismatch is the deck having lost track of itself, which is the
// user-visible form of the stranded-timer bug.
phase = 'verify'
const settled = await page.evaluate(() => ({
  hash: window.location.hash,
  live: document.querySelector('.deck-layer.is-live')?.getAttribute('data-slide') ?? null,
  liveCount: document.querySelectorAll('.deck-layer.is-live').length,
  layers: document.querySelectorAll('.deck-layer').length,
  canvases: document.querySelectorAll('canvas').length,
  appScenes: document.querySelectorAll('.deck-appscene').length,
  frames: document.querySelectorAll('iframe').length,
}))

// A crude frame-rate probe over one second, after everything has settled. Not a
// benchmark — a check that nothing is still spinning.
const fps = await page.evaluate(() => new Promise((done) => {
  let frames = 0
  const started = performance.now()
  const tick = () => {
    frames += 1
    if (performance.now() - started >= 1000) { done(frames); return }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}))

const memory = await page.evaluate(() => {
  const heap = performance.memory
  return heap ? { usedMB: Math.round(heap.usedJSHeapSize / 1048576) } : null
})

await shot('settled')
await browser.close()

const report = { base: BASE, ranAt: new Date().toISOString(), rounds: ROUNDS, idleMs: IDLE, settled, fps, memory, idleSpanMs: IDLE, startedAt: before, faults }
writeFileSync(`${OUT}/stress-report.json`, `${JSON.stringify(report, null, 2)}\n`)

console.log(`\n${'-'.repeat(64)}`)
console.log(`settled on   ${settled.hash}  (live layers ${settled.liveCount}, canvases ${settled.canvases}, app scenes ${settled.appScenes}, iframes ${settled.frames})`)
console.log(`fps at rest  ${fps}`)
if (memory) console.log(`heap         ${memory.usedMB}MB`)
console.log(`faults       ${faults.length}`)
for (const fault of faults.slice(0, 40)) console.log(`  [${fault.phase}] ${fault.kind}: ${fault.text}`)
if (faults.length > 40) console.log(`  ... and ${faults.length - 40} more`)
console.log(`report       ${OUT}/stress-report.json`)

if (faults.length || settled.liveCount !== 1) {
  console.log('\nFAILED — the deck complained, or did not settle on exactly one live layer.')
  process.exit(1)
}
console.log('\nOK')
