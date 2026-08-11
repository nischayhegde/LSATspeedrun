/**
 * What a backdrop blur costs when it sits over a canvas that redraws.
 *
 * This project's most expensive class of defect, twice over: a full-viewport
 * `mix-blend-mode: multiply` took scroll p95 from 33ms to 17ms when removed and
 * dropped frames from 47% to under 1%, and a `backdrop-filter` on the Firm page
 * took scroll median from 27ms to 16.7ms and p95 from 57.8ms to 18.3ms. Both
 * were over scrolling content. The map HUD is the same effect over a live
 * WebGL scene, which is worse: a blur has to re-sample whatever is behind it
 * every time that changes, and behind these panels is a canvas drawing a new
 * frame continuously.
 *
 * Measured by toggling the property at runtime in one page load, so the two
 * samples share a scene, a camera and a machine. The scene is driven for the
 * length of each sample -- a still map with an idle camera is not the case
 * anyone cares about.
 *
 *   node tools/ui-qa/blur-cost.mjs [--throttle=4] [--ms=4000]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'
const OUT = process.env.UI_QA_OUT ?? '/workspace/.qa-run/blur'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const THROTTLE = Number(args.throttle ?? 4)
const SAMPLE_MS = Number(args.ms ?? 4000)

/** Every HUD surface that composites against a scene canvas, by route. */
const SCENES = {
  '/map': [
    '.uw-scene-title', '.uw-scene-view-tabs', '.uw-map-toolbar button', '.uw-map-instructions',
    '.uw-district-guide', '.uw-level-navigator', '.uw-location-card', '.uw-retainer-board',
    '.uw-mobile-scene-summary', '.uw-mobile-scene-menu-toggle', '.uw-mobile-scene-menu',
  ],
  '/office': [
    '.office-view-rail', '.office-inventory-panel', '.office-mobile-brief',
    '.office-inventory-toggle', '.office-brief-card',
  ],
}
const ROUTE = args.route ?? '/map'
const HUD = SCENES[ROUTE] ?? SCENES['/map']

const SAMPLE = (ms) => `new Promise((resolve) => {
  const frames = []
  const long = []
  let observer = null
  try {
    observer = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)) })
    observer.observe({ entryTypes: ['longtask'] })
  } catch (e) {}
  let last = performance.now()
  const start = last
  const tick = (now) => {
    frames.push(now - last)
    last = now
    if (now - start < ${ms}) requestAnimationFrame(tick)
    else { if (observer) observer.disconnect(); resolve({ frames: frames.slice(1), long }) }
  }
  requestAnimationFrame(tick)
})`

function stats(frames) {
  if (!frames.length) return null
  const sorted = [...frames].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  return {
    frames: frames.length,
    fps: Math.round(frames.length / (frames.reduce((a, b) => a + b, 0) / 1000)),
    median: +at(.5).toFixed(1),
    p95: +at(.95).toFixed(1),
    worst: +sorted[sorted.length - 1].toFixed(1),
    dropped: +(frames.filter((f) => f > 20).length / frames.length * 100).toFixed(1),
  }
}

/** The median of a set of samples, which is what gets compared.
 *
 *  Alternating and repeating rather than measuring once each way. There is no
 *  GPU here — headless Chromium falls back to SwiftShader, so the canvas is
 *  rasterised on the CPU and is itself the slowest thing on the page. A single
 *  pair of samples cannot see past that: measured once each way under a 4x
 *  throttle, "blur off" came out slower than the second "blur on", which is
 *  drift, not a result. Six samples in ABABAB order and a median per arm is
 *  what makes the difference legible.
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return +sorted[Math.floor(sorted.length / 2)].toFixed(1)
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })

await page.goto(`${APP}${ROUTE}`, { waitUntil: "domcontentloaded" })
await page.waitForSelector('canvas', { timeout: 40000 })
await page.waitForTimeout(9000)

/* The office keeps its heaviest panel behind a toggle, and a blur that is not
   on screen composites nothing. Open it, or the measurement is of the office
   without the thing being measured. */
if (ROUTE === '/office') {
  const toggle = page.locator('.office-inventory-toggle').first()
  if (await toggle.count()) { await toggle.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1200) }
}

const present = await page.evaluate((sel) => sel.filter((s) => {
  const el = document.querySelector(s)
  if (!el) return false
  const f = getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter
  return f && f !== 'none'
}), HUD)
console.log(`HUD surfaces compositing a blur over the canvas: ${present.length ? present.join(', ') : 'none'}\n`)

const OFF_CSS = `${HUD.join(',')} { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }`
const setBlur = async (on) => {
  if (on) {
    await page.evaluate(() => {
      for (const s of document.querySelectorAll('style[data-blur-off]')) s.remove()
    })
  } else {
    await page.evaluate((css) => {
      const style = document.createElement('style')
      style.setAttribute('data-blur-off', '')
      style.textContent = css
      document.head.append(style)
    }, OFF_CSS)
  }
  // One frame for the compositor to settle into the new layer arrangement.
  await page.waitForTimeout(600)
}

/* The scene animates on its own -- there are crowd and agent rigs driving it --
   so the canvas is producing new frames without being touched, which is the
   condition that makes a backdrop blur re-sample. Nothing is dragged: driving
   the camera over CDP costs more main thread than the effect under test. */
async function run(on) {
  await setBlur(on)
  const sample = await page.evaluate(SAMPLE(SAMPLE_MS))
  return stats(sample.frames)
}

const arms = { on: [], off: [] }
const order = []
for (let round = 0; round < 3; round += 1) {
  for (const on of [true, false]) {
    const s = await run(on)
    arms[on ? 'on' : 'off'].push(s)
    order.push({ on, ...s })
    console.log(`round ${round + 1}  blur ${on ? 'on ' : 'off'}   ${String(s.fps).padStart(3)}fps  median ${String(s.median).padStart(6)}ms  p95 ${String(s.p95).padStart(6)}ms  worst ${String(s.worst).padStart(6)}ms`)
  }
}

const summary = {}
for (const key of ['on', 'off']) {
  summary[key] = {
    median: median(arms[key].map((s) => s.median)),
    p95: median(arms[key].map((s) => s.p95)),
    fps: median(arms[key].map((s) => s.fps)),
  }
}
console.log(`\nmedian of three samples per arm, ${SAMPLE_MS}ms each, throttle ${THROTTLE}x`)
console.log(`  blur on    ${summary.on.fps}fps  median ${summary.on.median}ms  p95 ${summary.on.p95}ms`)
console.log(`  blur off   ${summary.off.fps}fps  median ${summary.off.median}ms  p95 ${summary.off.p95}ms`)
const gain = +(summary.on.median - summary.off.median).toFixed(1)
console.log(`  removing it: ${gain > 0 ? `${gain}ms off the median frame` : `no gain (${gain}ms)`}`)

writeFileSync(`${OUT}/report.json`, JSON.stringify({ throttle: THROTTLE, sampleMs: SAMPLE_MS, present, order, summary }, null, 2))
console.log(`\nReport: ${OUT}/report.json`)
await browser.close()
