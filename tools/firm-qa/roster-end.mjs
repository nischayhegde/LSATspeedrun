/** The right-hand end of the firm floor, where the candidates stand. */
import { mkdirSync } from 'node:fs'
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
const { chromium } = playwright

const APP = 'http://127.0.0.1:4372'
const API = 'http://127.0.0.1:5372'
const width = Number(process.argv[2] ?? 1440)
const out = '/private/tmp/lsat-firm/.qa-run/shots/roster'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: 1 })
  await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
  const page = await context.newPage()
  await page.goto(`${APP}/firm?tab=staff`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.firm-staff-roster', { timeout: 30000 })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const choices = page.locator('.cutscene-choices button')
    if (await choices.count()) { await choices.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(900); continue }
    const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
    if (await dismiss.count()) { await dismiss.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); continue }
    break
  }
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const stage = document.querySelector('.firm-staff-roster-stage')
    if (stage) stage.scrollLeft = stage.scrollWidth
  })
  await page.waitForTimeout(900)
  const roster = page.locator('.firm-staff-roster').first()
  await roster.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(400)
  await roster.screenshot({ path: `${out}/${width}-candidates.png`, animations: 'disabled', timeout: 30000 })
  console.log(await roster.innerText())
} finally {
  await browser.close()
}
