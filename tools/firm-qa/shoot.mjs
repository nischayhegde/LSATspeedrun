/**
 * Look at the Firm tab. One browser, closed in a `finally`, both widths.
 *
 *   node .qa-run/shoot.mjs <label> [tab,tab,...] [selector,selector,...]
 *
 * Writes .qa-run/shots/<label>/<width>-<tab>.png for the viewport and
 * <width>-<tab>--<n>.png for each selector that is present, and prints any
 * page error. Element shots rather than full-page ones: this tab runs to
 * several thousand pixels on a phone and a full-page capture of it is
 * unreadable at any size a reviewer will actually look at.
 */
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'

const { chromium } = playwright
const APP = process.env.APP_URL ?? 'http://127.0.0.1:4372'
const API = 'http://127.0.0.1:5372'
const label = process.argv[2] || 'run'
const tabs = (process.argv[3] || 'connections,clients').split(',')
const selectors = (process.argv[4] || '').split(',').filter(Boolean)
const out = `/private/tmp/lsat-firm/.qa-run/shots/${label}`
mkdirSync(out, { recursive: true })

/** The catalog draws each card's thumbnail once through a shared three.js
 *  renderer, queued and cached. Until that queue drains the compositor is busy
 *  enough that a screenshot can time out, so wait for it rather than racing it. */
async function settle(page, budgetMs = 90000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const pending = await page.locator('.av-card-render.is-rendering').count().catch(() => 0)
    if (!pending) return true
    await page.waitForTimeout(500)
  }
  return false
}

const sizes = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]

const browser = await chromium.launch()
try {
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 })
    const errors = []
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

    // Dev sign-in before the app boots. `/v1/auth/dev` rather than `/api/...`:
    // only the `/v1` path is exempt from the CSRF pair, and the pair is not
    // issued until a session exists.
    const res = await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test', display_name: 'Firm QA' } })
    if (!res.ok()) throw new Error(`dev login failed: ${res.status()} ${await res.text()}`)

    for (const tab of tabs) {
      await page.goto(`${APP}/firm?tab=${tab}`, { waitUntil: 'networkidle' })
      // The profile opens on a story cutscene, which is full-screen and
      // blocking. "Decide later" only defers it, so it comes back on the next
      // navigation; answering the chapter is what actually clears it, and it is
      // the same click a player makes.
      await page.waitForSelector('.firm-tabs', { timeout: 30000 })
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const choices = page.locator('.cutscene-choices button')
        if (await choices.count()) {
          await choices.first().click({ timeout: 3000 }).catch(() => {})
          await page.waitForTimeout(900)
          continue
        }
        const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
        if (await dismiss.count()) {
          await dismiss.first().click({ timeout: 3000 }).catch(() => {})
          await page.waitForTimeout(600)
          continue
        }
        break
      }
      // Closed disclosures photograph as a one-line summary, which is the truth
      // about the default state and useless for reviewing what is inside them.
      if (process.env.SHOOT_OPEN_DETAILS) {
        await page.evaluate(() => { document.querySelectorAll('details').forEach((node) => { node.open = true }) })
        await page.waitForTimeout(400)
      }
      await page.waitForTimeout(1000)
      await settle(page)
      await page.screenshot({ path: `${out}/${size.name}-${tab}.png`, timeout: 60000 })
      for (const [index, selector] of selectors.entries()) {
        const node = page.locator(selector).first()
        if (!(await node.count())) continue
        await node.evaluate((element) => element.scrollIntoView({ block: 'center' })).catch(() => {})
        await page.waitForTimeout(300)
        await settle(page)
        await node.screenshot({ path: `${out}/${size.name}-${tab}--${index}.png`, animations: 'disabled', timeout: 20000 }).catch(() => {})
        // Also the viewport around it, because an element shot hides whatever
        // fixed chrome is sitting on top of the element in real use -- which on
        // a phone is a tab bar and a stats strip.
        await page.screenshot({ path: `${out}/${size.name}-${tab}--${index}-view.png`, timeout: 60000 })
      }
    }
    console.log(`${size.name}: ${errors.length ? errors.slice(0, 6).join(' | ') : 'no page errors'}`)
    await context.close()
  }
} finally {
  await browser.close()
}
