#!/usr/bin/env node
/**
 * How steadily the slide 10 → 11 move travels, frame by frame.
 *
 *     cd deck && node scripts/measure-counsel-jitter.mjs
 *
 * Separate from `verify-counsel-pull` because it asks a different question and
 * has to sample differently to answer it. That harness checks where things
 * *ended up*, sampling ten times across the move; this one is about whether the
 * picture shudders on the way, which is only visible between adjacent frames.
 *
 * So it installs a `requestAnimationFrame` loop in the page and reads the
 * sheet's edge position out of it every single frame, and separately reads the
 * scene's own per-frame accounting. Two independent witnesses: the page's view
 * of where the DOM layer actually is, and the scene's view of where it put it.
 *
 * The number that matters is the second difference — the change in step size
 * from one frame to the next. A smooth ease has a step that varies by a
 * hundredth of a pixel per frame; a body positioned from a clock that is not
 * the frame clock has one that varies by whole pixels, sign alternating, which
 * is what the eye reads as jitter.
 */
import { launchChromium } from './playwright-env.mjs'

const BASE = process.env.DECK_URL ?? 'http://localhost:5180'
const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.slice(7) ?? 3)

const browser = await launchChromium()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

await page.goto(`${BASE}/#/concept-lawyer-tycoon`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('.deck-layer.is-live', { timeout: 20000 })
await page.waitForFunction(() => typeof window.__deckCounselStage === 'function', null, { timeout: 20000 })

const rows = []
for (let run = 0; run < RUNS; run += 1) {
  await page.waitForTimeout(1500)

  // Sample the real DOM transform every frame for the length of the move.
  await page.evaluate(() => {
    window.__jit = { x: [], t: [] }
    const tick = (now) => {
      if (!window.__jit.on) return
      requestAnimationFrame(tick)
      // Re-queried every frame: slide 11's layer does not exist until the
      // transition builds it, so a reference taken up front is null for the
      // whole run and every statistic comes back NaN.
      const layer = document.querySelector('.deck-layer[data-slide="pov-graded-question"]')
      if (!layer) return
      // The matrix, not the style string: this is what the compositor got,
      // after the percentage was resolved against the layer's own width.
      const m = new DOMMatrixReadOnly(getComputedStyle(layer).transform)
      window.__jit.x.push(m.m41)
      window.__jit.t.push(now)
    }
    window.__jit.on = true
    requestAnimationFrame(tick)
  })

  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(6000)

  const sample = await page.evaluate(() => {
    window.__jit.on = false
    return { x: window.__jit.x, t: window.__jit.t, probe: window.__deckCounselStage?.() ?? null }
  })

  // Only the stretch where it is actually travelling. A long tail of identical
  // values at either end would flatter every statistic here.
  const moving = []
  for (let i = 1; i < sample.x.length; i += 1) {
    if (Math.abs(sample.x[i] - sample.x[i - 1]) > 1e-6) moving.push(i)
  }
  const lo = moving[0] ?? 1
  const hi = moving.at(-1) ?? 1
  const steps = []
  const frameMs = []
  for (let i = lo; i <= hi; i += 1) {
    steps.push(sample.x[i] - sample.x[i - 1])
    frameMs.push(sample.t[i] - sample.t[i - 1])
  }
  const jerk = steps.slice(1).map((s, i) => Math.abs(s - steps[i]))
  const mean = (a) => a.reduce((t, v) => t + v, 0) / Math.max(1, a.length)
  // Sign flips in the step's own change: smooth acceleration keeps its sign for
  // long stretches, shudder alternates almost every frame. This is the one
  // statistic a merely *fast* move cannot fake.
  const diffs = steps.slice(1).map((s, i) => s - steps[i])
  let flips = 0
  for (let i = 1; i < diffs.length; i += 1) {
    if (diffs[i] !== 0 && diffs[i - 1] !== 0 && Math.sign(diffs[i]) !== Math.sign(diffs[i - 1])) flips += 1
  }

  rows.push({
    frames: steps.length,
    stepMean: mean(steps.map(Math.abs)),
    jerkMean: mean(jerk),
    jerkPeak: Math.max(...jerk),
    flipRate: flips / Math.max(1, diffs.length - 1),
    frameMsMean: mean(frameMs),
    frameMsMax: Math.max(...frameMs),
    dropped: frameMs.filter((m) => m > 40).length,
    scene: sample.probe?.stability ?? null,
    gripMissPeak: sample.probe?.gripMissPeak ?? null,
  })

  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(1200)
}

console.log('\nDOM layer, measured every frame (1600x900):')
console.log('run | frames | step px | jerk mean | jerk peak | sign flips | frame ms | dropped')
for (const [i, r] of rows.entries()) {
  console.log([
    String(i + 1).padStart(3),
    String(r.frames).padStart(6),
    r.stepMean.toFixed(2).padStart(7),
    r.jerkMean.toFixed(3).padStart(9),
    r.jerkPeak.toFixed(2).padStart(9),
    (r.flipRate * 100).toFixed(0).padStart(9) + '%',
    (r.frameMsMean.toFixed(1) + '/' + r.frameMsMax.toFixed(0)).padStart(8),
    String(r.dropped).padStart(7),
  ].join(' | '))
}

console.log('\nScene accounting (its own view of the same frames):')
for (const [i, r] of rows.entries()) {
  if (!r.scene) continue
  const s = r.scene
  console.log(`run ${i + 1}: edgeJerk peak=${s.edgeJerkPeak} mean=${s.edgeJerkMean} px/s per frame `
    + `| camJerk peak=${s.camJerkPeak} mean=${s.camJerkMean} `
    + `| frames=${s.frames} dropped=${s.dropped} deltaMax=${s.deltaMax}s `
    + `| gripMissPeak=${r.gripMissPeak}`)
}
if (errors.length) console.log('\npage errors:', errors.join(' | '))

await browser.close()
