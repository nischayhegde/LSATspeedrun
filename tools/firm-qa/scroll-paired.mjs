/**
 * Base and branch scrolled side by side, in one browser, alternating.
 *
 * The single-page runs kept disagreeing with themselves: this machine is
 * running a demo stack, two other worktrees and a deck build, and a 17-second
 * frame is that, not the page. Alternating short bursts inside one browser
 * process puts both builds under the same load in the same minute, so the
 * comparison survives a noisy host even when the absolute numbers do not.
 *
 *   node .qa-run/scroll-paired.mjs <tab> [width] [reps]
 */
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
const { chromium } = playwright

const tab = process.argv[2] ?? 'connections'
const width = Number(process.argv[3] ?? 1440)
const reps = Number(process.argv[4] ?? 5)
const API = 'http://127.0.0.1:5372'
const builds = [
  { name: 'base  ', url: 'http://127.0.0.1:4473' },
  { name: 'branch', url: 'http://127.0.0.1:4472' },
]

const browser = await chromium.launch()
const pages = []
try {
  for (const build of builds) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: 1 })
    await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
    const page = await context.newPage()
    await page.goto(`${build.url}/firm?tab=${tab}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.firm-tabs', { timeout: 30000 })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const choices = page.locator('.cutscene-choices button')
      if (await choices.count()) { await choices.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(900); continue }
      const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
      if (await dismiss.count()) { await dismiss.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); continue }
      break
    }
    for (let wait = 0; wait < 120; wait += 1) {
      if (!(await page.locator('.av-card-render.is-rendering').count())) break
      await page.waitForTimeout(500)
    }
    pages.push({ ...build, page, medians: [], p95s: [] })
  }
  await pages[0].page.waitForTimeout(2000)

  for (let rep = 0; rep < reps; rep += 1) {
    for (const entry of pages) {
      const { page } = entry
      await page.bringToFront()
      await page.evaluate(() => {
        window.scrollTo(0, 0)
        window.__frames = []
        let last = performance.now()
        const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
      })
      await page.waitForTimeout(400)
      await page.mouse.move(width / 2, 400)
      for (let step = 0; step < 25; step += 1) {
        await page.mouse.wheel(0, 300)
        await page.waitForTimeout(32)
      }
      const stats = await page.evaluate(() => {
        const frames = window.__frames.slice(4).sort((left, right) => left - right)
        const at = (share) => frames[Math.min(frames.length - 1, Math.floor(frames.length * share))]
        return { median: at(.5), p95: at(.95) }
      })
      entry.medians.push(stats.median)
      entry.p95s.push(stats.p95)
    }
  }
  const mid = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]
  for (const entry of pages) {
    console.log(
      `${entry.name} ${tab} ${width}px · median of medians ${mid(entry.medians).toFixed(1)}ms`,
      `· median p95 ${mid(entry.p95s).toFixed(1)}ms`,
      `· runs ${entry.medians.map((value) => value.toFixed(1)).join('/')}`,
    )
  }
} finally {
  await browser.close()
}
