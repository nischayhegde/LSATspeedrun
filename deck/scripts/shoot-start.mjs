#!/usr/bin/env node
/**
 * Captures and exercises the start card.
 *
 *     cd deck && npm run dev                     # 5180, in another terminal
 *     cd deck && node scripts/shoot-start.mjs
 *
 * `shoot.mjs` cannot do this: it addresses every capture as `#/<slide-id>`, and
 * the card is by definition what you get when there is *no* fragment. So this is
 * a separate, much smaller harness with the same browser setup — the same named
 * arm64 Chromium, the same ANGLE flags — and a different job.
 *
 * What it checks, in order, because the interesting failures are behavioural
 * rather than visual:
 *
 *   1. A bare URL raises the card, at three aspect ratios including one that is
 *      not 16:9, since the room's projector may not be either.
 *   2. Pressing Enter closes the deck's letterbox shutter over it and opens onto
 *      slide 1 — and the deck was *already mounted* the whole time, which is
 *      asserted rather than assumed by checking that a live slide layer exists
 *      while the card is still up.
 *   3. The card swallows navigation keys while it is up: the deck underneath must
 *      not have paged forward.
 *   4. `T` brings the card back over whatever slide is showing, and dismissing it
 *      returns to that same slide rather than to slide 1.
 *   5. A `#/<slide>` deep link never shows the card.
 *   6. `prefers-reduced-motion` gets the card with no sweep at all.
 *
 * Writes PNGs and report.json into `.deck-shots/start/`. Exits non-zero on any
 * failed check or page error.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flags = new Map(
  process.argv.slice(2).map((raw) => {
    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
    if (!match) {
      console.error(`shoot-start: unrecognised argument "${raw}"`)
      process.exit(2)
    }
    return [match[1], match[2] ?? '']
  }),
)
const BASE = (flags.get('base') || 'http://127.0.0.1:5180').replace(/\/$/, '')
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots/start')
const SCALE = Number(flags.get('scale') || 2)

/** The card is measured in the deck's 16:9 unit, so the off-ratio case matters. */
const VIEWPORTS = [
  { name: 'projector-1080', width: 1920, height: 1080 },
  { name: 'laptop-1280x800', width: 1280, height: 800 },
  { name: 'off-ratio-4x3', width: 1400, height: 1050 },
]

mkdirSync(OUT, { recursive: true })

const browser = await launchChromium()

const problems = []
const notes = []
const fail = (text) => { problems.push(text); console.error(`  \u2717 ${text}`) }
const ok = (text) => { notes.push(text); console.log(`  \u2713 ${text}`) }

/**
 * A page that reports its own console and page errors into `sink`.
 *
 * Errors raised *inside a demo slide's iframe* are excluded, and that is not
 * laziness: a demo slide frames the app origin, and in a throwaway Playwright
 * profile that app is not signed in, so it correctly logs a run of 401s and a
 * Google Identity origin complaint. Those are the app's, on the app's origin, and
 * collecting them here would mean this harness could never pass. Anything without
 * a location is kept, because an unattributed error is more likely to be the
 * deck's than not.
 */
async function newPage(context, sink) {
  const page = await context.newPage()
  const mine = (url) => !url || url.startsWith(BASE)
  page.on('pageerror', (error) => sink.push(`pageerror: ${String(error).slice(0, 200)}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (!mine(message.location()?.url ?? '')) return
    sink.push(`console: ${message.text().slice(0, 200)}`)
  })
  return page
}

const state = (page) => page.evaluate(() => ({
  card: Boolean(document.querySelector('.start-plate')),
  gate: Boolean(document.querySelector('.start')),
  liveLayer: document.querySelector('.deck-layer.is-live')?.dataset.kind ?? null,
  hash: window.location.hash.replace(/^#\/?/, ''),
  canvases: document.querySelectorAll('canvas').length,
}))

// ---------------------------------------------------------------------------
// 1 — the card, at three shapes
// ---------------------------------------------------------------------------

console.log('\n\u2022 The card')
const errors = []
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: SCALE,
    reducedMotion: 'no-preference',
  })
  const page = await newPage(context, errors)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const shown = await page.waitForSelector('.start-plate', { timeout: 15000 }).then(() => true).catch(() => false)
  if (!shown) fail(`${viewport.name}: a bare URL did not raise the card`)
  // Let the deck build underneath and the fonts and the three brand images land.
  await page.waitForTimeout(2600)
  const file = `card-${viewport.name}.png`
  await page.screenshot({ path: resolve(OUT, file) })
  const seen = await state(page)
  if (viewport.name === 'projector-1080') {
    // The load-bearing claim: the deck is already running behind the card.
    if (!seen.liveLayer) fail('the deck was not mounted behind the card')
    else ok(`the deck is mounted behind the card (live layer: ${seen.liveLayer}, ${seen.canvases} canvas)`)
  }
  // Nothing may overflow: the card is sized in the deck's 16:9 unit precisely so
  // an off-ratio projector shrinks it rather than clipping it.
  const overflow = await page.evaluate(() => {
    const plate = document.querySelector('.start-plate')
    if (!plate) return null
    return { scrollW: plate.scrollWidth, clientW: plate.clientWidth, scrollH: plate.scrollHeight, clientH: plate.clientHeight }
  })
  // A pixel or two either way is subpixel rounding on a fractional `--u`; the
  // failure worth catching is a headline or a plate genuinely running off the
  // edge, which shows up as tens of pixels.
  if (overflow && (overflow.scrollW > overflow.clientW + 4 || overflow.scrollH > overflow.clientH + 4)) {
    fail(`${viewport.name}: the card overflows its frame (${overflow.scrollW}x${overflow.scrollH} in ${overflow.clientW}x${overflow.clientH})`)
  } else if (overflow) {
    ok(`${viewport.name}: fits in ${overflow.clientW}x${overflow.clientH} \u2014 ${file}`)
  }
  await context.close()
}

// ---------------------------------------------------------------------------
// 2 — the handoff, and what the card swallows
// ---------------------------------------------------------------------------

console.log('\n\u2022 The handoff')
{
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: SCALE,
    reducedMotion: 'no-preference',
  })
  const page = await newPage(context, errors)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.start-plate', { timeout: 15000 })
  await page.waitForTimeout(2200)

  // Navigation keys must not reach the deck while the card is up. Compared
  // against the hash *before* the keys rather than against empty: the deck
  // mounts underneath and writes the first slide's id into the fragment on its
  // own, so "no hash" is not the resting state.
  const parked = await state(page)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(600)
  const held = await state(page)
  if (held.hash !== parked.hash) fail(`arrow keys leaked to the deck behind the card ("${parked.hash}" \u2192 "${held.hash}")`)
  else ok(`arrow keys are swallowed while the card is up (deck held at "${held.hash}")`)
  if (!held.card) fail('the card disappeared on an arrow key')

  // The shutter, caught mid-close.
  await page.keyboard.press('Enter')
  await page.waitForTimeout(330)
  await page.screenshot({ path: resolve(OUT, 'handoff-shutter-closing.png') })
  ok('handoff-shutter-closing.png')
  // Inside the held black, with the card already dropped.
  await page.waitForTimeout(200)
  const black = await state(page)
  if (black.card) notes.push('note: the card was still in the DOM at +530ms; timing, not a defect')
  await page.screenshot({ path: resolve(OUT, 'handoff-black.png') })

  await page.waitForTimeout(1400)
  const after = await state(page)
  if (after.gate) fail('the start gate was still mounted after the shutter opened')
  else ok('the gate unmounts once the shutter has opened')
  if (!after.liveLayer) fail('no live slide layer after the handoff')
  await page.screenshot({ path: resolve(OUT, 'handoff-slide-1.png') })
  ok(`handoff landed on a live "${after.liveLayer}" slide \u2014 handoff-slide-1.png`)

  // 3 — T brings it back over whatever slide is showing, non-destructively.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(1600)
  const before = await state(page)
  await page.keyboard.press('t')
  await page.waitForTimeout(1500)
  const returned = await state(page)
  if (!returned.card) fail('T did not bring the card back')
  else ok(`T re-raises the card over slide "${before.hash}"`)
  await page.screenshot({ path: resolve(OUT, 'card-reopened.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1600)
  const dismissed = await state(page)
  if (dismissed.gate) fail('Escape did not dismiss the re-raised card')
  else if (dismissed.hash !== before.hash) fail(`dismissing the card moved the deck: "${before.hash}" \u2192 "${dismissed.hash}"`)
  else ok(`dismissing returns to the same slide ("${dismissed.hash}"), not to slide 1`)

  await context.close()
}

// ---------------------------------------------------------------------------
// 4 — deep links skip it; 5 — reduced motion
// ---------------------------------------------------------------------------

console.log('\n\u2022 Deep link and reduced motion')
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 })
  const page = await newPage(context, errors)
  await page.goto(`${BASE}/#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)
  const deep = await state(page)
  if (deep.gate) fail('a #/ deep link raised the start card')
  else ok(`#/demo-case-answer skips the card (landed on "${deep.hash}")`)
  await context.close()
}
{
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  const page = await newPage(context, errors)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const shown = await page.waitForSelector('.start-plate', { timeout: 15000 }).then(() => true).catch(() => false)
  if (!shown) fail('reduced motion: no card')
  await page.waitForTimeout(1800)
  await page.screenshot({ path: resolve(OUT, 'card-reduced-motion.png') })
  await page.keyboard.press('Enter')
  // Reduced motion collapses the sweep to a swap, so this is generous by 10x
  // and still expects to be past it.
  await page.waitForTimeout(400)
  const after = await state(page)
  if (after.gate) fail('reduced motion: the card did not leave within 400ms')
  else ok('reduced motion: the card swaps out with no sweep')
  await context.close()
}

await browser.close()

if (errors.length) for (const error of errors) fail(error)

writeFileSync(
  resolve(OUT, 'report.json'),
  `${JSON.stringify({ base: BASE, when: new Date().toISOString(), problems, notes }, null, 2)}\n`,
)

console.log(`\n${problems.length ? `${problems.length} problem(s)` : 'all checks passed'} \u2014 ${OUT}`)
process.exit(problems.length ? 1 : 0)
