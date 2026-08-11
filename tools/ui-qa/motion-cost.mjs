/**
 * What the added motion costs, per frame, on a slow machine.
 *
 * The brief authorises more visual work and then constrains it: this app
 * already carries heavy 3D and a history of scroll regressions, and "anything
 * added must be measured". The visual work on this branch is deliberately not
 * a canvas — it is the guided tour's diagrams and its opening cinematic, all
 * CSS transform and opacity — so the question worth answering is whether that
 * still holds up when the CPU is not a datacentre's.
 *
 * Method, and why it is shaped this way:
 *
 *   - Frame intervals are sampled with requestAnimationFrame rather than read
 *     from a profiler, because the number that matters is the one the compositor
 *     actually delivered.
 *   - Every scene is measured against a baseline captured on the *same route in
 *     the same page*, seconds apart, so the difference is the motion and not the
 *     route, the bundle, or the machine's mood at the time.
 *   - The CPU is throttled 6x through CDP. Unthrottled, headless Chromium on
 *     this host renders every one of these at a flat 16.7ms and the measurement
 *     says nothing at all; the throttle is what makes a regression visible.
 *   - Long tasks are counted separately. A run can hold 60fps on average and
 *     still drop a 200ms block on the way in, which is what a reader notices.
 *
 *   node tools/ui-qa/motion-cost.mjs [--throttle=6] [--ms=3500]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'
const OUT = process.env.UI_QA_OUT ?? '/workspace/.qa-run/motion'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const THROTTLE = Number(args.throttle ?? 6)
const SAMPLE_MS = Number(args.ms ?? 3500)

/** Sample every frame the page delivers for `ms`, plus any long task in the
 *  same window. Returns intervals in milliseconds. */
const SAMPLE = (ms) => `new Promise((resolve) => {
  const frames = []
  const long = []
  let observer = null
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) long.push(Math.round(entry.duration))
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch (e) { /* not every build exposes longtask */ }
  let last = performance.now()
  const start = last
  const tick = (now) => {
    frames.push(now - last)
    last = now
    if (now - start < ${ms}) requestAnimationFrame(tick)
    else {
      if (observer) observer.disconnect()
      // The first interval is the gap since whatever ran before the sample
      // started, not a frame this scene produced.
      resolve({ frames: frames.slice(1), long })
    }
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
    /* Anything past 50ms is three dropped frames in a row, which is the point a
       reader stops reading it as animation and starts reading it as a stutter. */
    janky: frames.filter((f) => f > 50).length,
  }
}

async function openTour(page) {
  await page.evaluate(() => {
    window.localStorage.removeItem('lsat-tycoon-tour-v7')
    window.dispatchEvent(new Event('lsat-tycoon:replay-tour'))
  })
  await page.waitForSelector('.guided-tour-card', { timeout: 15000 })
}

/** Walk Next until the card shows `marker`, so a scene is named by what is on
 *  screen rather than by a step index that shifts when a step is written. */
async function advanceTo(page, marker, limit = 40) {
  for (let i = 0; i < limit; i += 1) {
    if (await page.locator(marker).count()) return true
    const next = page.locator('.tour-next')
    if (!(await next.count())) return false
    // The practice step holds Next until the reader answers, which is the
    // point of it. Answer, and carry on.
    if (await next.isDisabled()) {
      const choice = page.locator('.tour-answer-list button').first()
      if (!(await choice.count())) return false
      await choice.click()
      await page.waitForTimeout(300)
      if (await next.isDisabled()) return false
    }
    await next.click()
    await page.waitForTimeout(220)
  }
  return false
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
const login = await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
if (!login.ok()) throw new Error(`dev login failed: ${login.status()}`)
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })

const results = []
async function measure(label, route, arrange) {
  await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const before = stats((await page.evaluate(SAMPLE(SAMPLE_MS))).frames)
  const detail = arrange ? await arrange(page) : null
  if (detail === false) {
    results.push({ label, route, skipped: 'scene not reached' })
    return
  }
  await page.waitForTimeout(400)
  const sample = await page.evaluate(SAMPLE(SAMPLE_MS))
  const after = stats(sample.frames)
  results.push({ label, route, baseline: before, motion: after, longTasks: sample.long, detail })
}

try {
  await measure('tour: opening cinematic', '/progress', async (p) => {
    await openTour(p)
    return { animated: await p.locator('.tour-cinematic i, .tour-cinematic span, .tour-cinematic b, .tour-cinematic em').count() }
  })
  await measure('tour: districts board diagram', '/progress', async (p) => {
    await openTour(p)
    return (await advanceTo(p, '.tour-board')) && { board: true }
  })
  await measure('tour: question demo', '/progress', async (p) => {
    await openTour(p)
    return (await advanceTo(p, '.tour-question-demo')) && { demo: true }
  })
  /* Not motion I added — the surface the motion is layered over, and the one
     that turned out to have the real problem. Scrolling this catalog brings
     three.js card thumbnails into view, and they used to render as one
     unbroken block; see `nextFrameGap` in catalog-asset-render.tsx. Kept in
     the harness because it is the regression most likely to come back. */
  await measure('firm: connections catalog, scrolled', '/firm?tab=connections', async (p) => {
    await p.waitForSelector('.retainer-plots', { timeout: 15000 })
    await p.evaluate(() => new Promise((resolve) => {
      let y = 0
      const step = () => {
        y += 26
        window.scrollTo(0, y)
        if (y < 2600) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    }))
    return { scrolled: true }
  })

  const out = { throttle: `${THROTTLE}x`, sampleMs: SAMPLE_MS, results }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(out, null, 2))
  console.log(`CPU throttled ${THROTTLE}x · ${SAMPLE_MS}ms per sample · 1280x860\n`)
  for (const row of results) {
    if (row.skipped) { console.log(`${row.label}\n  skipped: ${row.skipped}\n`); continue }
    const f = (s) => (s ? `${s.fps}fps median ${s.median}ms p95 ${s.p95}ms worst ${s.worst}ms janky ${s.janky}` : 'no frames')
    console.log(row.label)
    console.log(`  before  ${f(row.baseline)}`)
    console.log(`  after   ${f(row.motion)}`)
    if (row.longTasks.length) console.log(`  long tasks: ${row.longTasks.join(', ')}ms`)
    console.log('')
  }
  console.log(`Report: ${OUT}/report.json`)
} finally {
  await browser.close()
}
