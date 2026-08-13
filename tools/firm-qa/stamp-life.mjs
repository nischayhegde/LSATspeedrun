/**
 * How long does a card's own confirmation stamp actually stay up?
 *
 * `justBought` is held in React for ACQUIRED_HOLD_MS (2200ms) and is the same
 * shape as the roster's "this one" mark, so if the purchase stamp also
 * disappears in a few hundred milliseconds then something on this page is
 * resetting Firm-tab state and it is not the new code.
 */
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
const { chromium } = playwright

const APP = 'http://127.0.0.1:4372'
const API = 'http://127.0.0.1:5372'

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror', String(e)))
  await page.goto(`${APP}/firm?tab=decor`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.firm-tabs', { timeout: 30000 })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const choices = page.locator('.cutscene-choices button')
    if (await choices.count()) { await choices.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(900); continue }
    const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
    if (await dismiss.count()) { await dismiss.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); continue }
    break
  }
  await page.waitForTimeout(1200)

  const buy = page.locator('.asset-card:not(.owned) .purchase-row button', { hasText: /^Purchase$/ }).first()
  if (!(await buy.count())) { console.log('nothing affordable to buy'); process.exit(0) }
  const name = await buy.evaluate((node) => node.closest('.asset-card')?.querySelector('h3')?.textContent ?? '?')
  await buy.scrollIntoViewIfNeeded()
  await buy.click()
  const trace = await page.evaluate(async () => {
    const samples = []
    for (let step = 0; step < 30; step += 1) {
      samples.push(document.querySelector('.asset-card.just-bought') ? '#' : '.')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return samples.join('')
  })
  console.log(`bought ${name}`)
  console.log('just-bought over 3s (100ms per char):', trace)
} finally {
  await browser.close()
}
