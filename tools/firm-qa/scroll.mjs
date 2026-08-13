/**
 * Scroll cost on the Firm tab, measured the way this project has measured it
 * before: drive real wheel events down the page and time the frames.
 *
 *   node .qa-run/scroll.mjs <port> <tab> [width]
 *
 * Reports the median and p95 gap between animation frames while scrolling.
 * Production builds only -- a dev build's numbers say more about Vite than
 * about the page. Both builds are served against the same API and the same
 * database, so the two runs differ only in the code under test.
 */
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
const { chromium } = playwright

const port = process.argv[2] ?? '4472'
const tab = process.argv[3] ?? 'connections'
const width = Number(process.argv[4] ?? 1440)
const APP = `http://127.0.0.1:${port}`
const API = 'http://127.0.0.1:5372'

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: 1 })
  await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
  const page = await context.newPage()
  await page.goto(`${APP}/firm?tab=${tab}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.firm-tabs', { timeout: 30000 })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const choices = page.locator('.cutscene-choices button')
    if (await choices.count()) { await choices.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(900); continue }
    const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
    if (await dismiss.count()) { await dismiss.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); continue }
    break
  }
  // Let the card thumbnails finish rendering: their queue is a one-off cost at
  // load, not something a scroll pays, and leaving it running would measure it.
  for (let wait = 0; wait < 120; wait += 1) {
    if (!(await page.locator('.av-card-render.is-rendering').count())) break
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(1500)

  await page.evaluate(() => {
    window.__frames = []
    let last = performance.now()
    const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  await page.mouse.move(width / 2, 400)
  for (let step = 0; step < 60; step += 1) {
    await page.mouse.wheel(0, 240)
    await page.waitForTimeout(32)
  }
  const stats = await page.evaluate(() => {
    const frames = window.__frames.slice(4).sort((left, right) => left - right)
    const at = (share) => frames[Math.min(frames.length - 1, Math.floor(frames.length * share))]
    return {
      frames: frames.length,
      median: Number(at(.5).toFixed(1)),
      p95: Number(at(.95).toFixed(1)),
      worst: Number(frames[frames.length - 1].toFixed(1)),
      scrollY: Math.round(window.scrollY),
    }
  })
  console.log(`port ${port} · ${tab} · ${width}px`, JSON.stringify(stats))
} finally {
  await browser.close()
}
