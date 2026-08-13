/**
 * Read back what the Firm tab actually rendered, as text. Screenshots cannot
 * show the inside of a native <select>, and a paragraph rendered at 11px in an
 * element shot is not something a reviewer can honestly claim to have read.
 *
 *   node .qa-run/probe.mjs <tab> <selector> [selector...]
 */
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'

const { chromium } = playwright
const APP = 'http://127.0.0.1:4372'
const API = 'http://127.0.0.1:5372'
const [tab = 'connections', ...selectors] = process.argv.slice(2)

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const errors = []
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  const res = await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
  if (!res.ok()) throw new Error(`dev login failed: ${res.status()}`)

  await page.goto(`${APP}/firm?tab=${tab}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.firm-tabs', { timeout: 30000 })
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!(await page.getByRole('button', { name: /decide later/i }).count())) break
    await page.getByRole('button', { name: /decide later/i }).first().click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(800)

  for (const selector of selectors) {
    const nodes = page.locator(selector)
    const count = await nodes.count()
    console.log(`\n### ${selector}  (${count})`)
    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const text = (await nodes.nth(index).innerText().catch(() => '')).replace(/\n+/g, ' \u00b7 ').trim()
      console.log(`  [${index}] ${text}`)
    }
  }

  const select = page.locator('.catalog-toolbar select')
  if (await select.count()) {
    const shape = await select.first().evaluate((node) => Array.from(node.children).map((child) => (
      child.tagName === 'OPTGROUP'
        ? `${child.label}: ${Array.from(child.children).map((o) => o.textContent).join(', ')}`
        : `(ungrouped) ${child.textContent}`
    )))
    console.log('\n### catalog filter')
    shape.forEach((line) => console.log(`  ${line}`))
  }
  console.log(`\nerrors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`)
  await context.close()
} finally {
  await browser.close()
}
