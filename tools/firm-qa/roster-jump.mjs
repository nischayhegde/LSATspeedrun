/**
 * Does a face on the firm floor take you to the card that hires them?
 *
 *   node .qa-run/roster-jump.mjs [width]
 *
 * Clicks the first candidate in the roster (falling back to a hired colleague
 * if everyone available is on staff) and reports where the page ended up: the
 * card's id, whether it is marked, and whether it is actually in the viewport.
 */
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
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.text().startsWith('[called]')) console.log(m.text()) })
  await page.goto(`${APP}/firm?tab=staff`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.firm-staff-roster', { timeout: 30000 })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const choices = page.locator('.cutscene-choices button')
    if (await choices.count()) { await choices.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(900); continue }
    const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
    if (await dismiss.count()) { await dismiss.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); continue }
    break
  }
  await page.waitForTimeout(1200)

  const pick = page.locator('.firm-staff-roster-stage article.is-available .firm-staff-pick').first()
  const fallback = page.locator('.firm-staff-pick').first()
  const button = (await pick.count()) ? pick : fallback
  const label = await button.getAttribute('aria-label')
  await button.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  await button.click()
  // Long enough for the smooth scroll to finish, which is the moment the mark
  // has to still be up: it is there to answer "which of these is it".
  await page.waitForTimeout(1400)

  const landed = await page.evaluate((scrolledFrom) => {
    const card = document.querySelector('.management-card.asset-card[data-called]')
    if (!card) return { marked: false, anyMarked: document.querySelectorAll('[data-called]').length }
    const box = card.getBoundingClientRect()
    return {
      marked: true,
      id: card.id,
      name: card.querySelector('h3')?.textContent ?? null,
      button: card.querySelector('.purchase-row button')?.textContent ?? null,
      focused: document.activeElement === card,
      inView: box.top < window.innerHeight && box.bottom > 0,
      scrolledFrom,
      scrolledTo: Math.round(window.scrollY),
    }
  }, before)
  console.log(`[${width}] clicked: ${label}`)
  console.log(JSON.stringify(landed, null, 2))
  await page.screenshot({ path: `${out}/${width}-jump.png`, timeout: 60000 }).catch(() => {})
  console.log('errors:', errors.length ? errors.slice(0, 4).join(' | ') : 'none')
} finally {
  await browser.close()
}
