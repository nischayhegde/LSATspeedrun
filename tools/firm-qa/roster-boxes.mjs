/** Where the client panel's pieces actually sit at phone width. */
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
const { chromium } = playwright

const APP = process.env.APP_URL ?? 'http://127.0.0.1:4472'
const API = 'http://127.0.0.1:5372'
const width = Number(process.argv[2] ?? 390)

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 })
  await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
  const page = await context.newPage()
  await page.goto(`${APP}/firm?tab=clients`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.client-roster-status', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const boxes = await page.evaluate(() => {
    const panel = document.querySelector('.client-roster-status')
    const pick = (selector) => {
      const node = panel?.querySelector(selector)
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) }
    }
    return {
      panel: pick(':scope'),
      portrait: pick('.client-portrait'),
      bust: pick('.client-portrait > *'),
      heading: pick('h2'),
      line: pick('p'),
      eyebrow: pick('span'),
    }
  })
  console.log(JSON.stringify(boxes, null, 2))
} finally {
  await browser.close()
}
