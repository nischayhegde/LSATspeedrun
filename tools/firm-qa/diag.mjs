import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
const { chromium } = playwright
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await context.request.post('http://127.0.0.1:5372/v1/auth/dev', { data: { email: 'firm-qa@localhost.test' } })
await page.goto('http://127.0.0.1:4372/firm?tab=connections', { waitUntil: 'networkidle' })
await page.waitForSelector('.firm-tabs', { timeout: 30000 })
for (let i = 0; i < 10; i++) {
  const c = page.locator('.cutscene-choices button')
  if (await c.count()) { await c.first().click().catch(() => {}); await page.waitForTimeout(900); continue }
  const d = page.locator('.cutscene-defer')
  if (await d.count()) { await d.first().click().catch(() => {}); await page.waitForTimeout(600); continue }
  break
}
await page.waitForTimeout(1000)
console.log('locate buttons:', await page.locator('.asset-locate').count())
console.log('first card box:', await page.locator('.asset-card-connection').first().boundingBox())
const b1 = await page.locator('.asset-card-connection').first().boundingBox()
await page.waitForTimeout(700)
const b2 = await page.locator('.asset-card-connection').first().boundingBox()
console.log('box stable:', JSON.stringify(b1) === JSON.stringify(b2), JSON.stringify(b2))
const btn = page.locator('.asset-card-connection').first().locator('.asset-locate')
console.log('btn count:', await btn.count(), 'visible:', await btn.first().isVisible().catch((e) => e.message))
const bb1 = await btn.first().boundingBox(); await page.waitForTimeout(700); const bb2 = await btn.first().boundingBox()
console.log('btn box stable:', JSON.stringify(bb1) === JSON.stringify(bb2), JSON.stringify(bb2))
await browser.close()
