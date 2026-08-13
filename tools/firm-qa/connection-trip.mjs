/**
 * The round trip a player makes when they buy a network: the card on the Firm
 * tab, then "Show on the map", then what the board says when they land.
 */
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
import { mkdirSync } from 'node:fs'

const { chromium } = playwright
const APP = 'http://127.0.0.1:4372'
const API = 'http://127.0.0.1:5372'
const out = '/private/tmp/lsat-firm/.qa-run/shots/trip'
mkdirSync(out, { recursive: true })

/** The catalog draws each card's thumbnail once through a shared three.js
 *  renderer, queued and cached. Until that queue drains the compositor is busy
 *  enough that a screenshot can time out, so wait for it rather than racing it. */
async function settle(page, budgetMs = 45000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const pending = await page.locator('.av-card-render.is-rendering').count().catch(() => 0)
    if (!pending) return true
    await page.waitForTimeout(500)
  }
  return false
}

async function clearStory(page) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const choices = page.locator('.cutscene-choices button')
    if (await choices.count()) { await choices.first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(900); continue }
    const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
    if (await dismiss.count()) { await dismiss.first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(600); continue }
    break
  }
}

const browser = await chromium.launch()
try {
  for (const size of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height } })
    const errors = []
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
    const login = await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
    if (!login.ok()) throw new Error(`login ${login.status()}`)

    await page.goto(`${APP}/firm?tab=connections`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.firm-tabs', { timeout: 30000 })
    await clearStory(page)
    await page.waitForTimeout(800)

    console.log(`\n[${size.name}] connection cards: ${await page.locator('.asset-card-connection').count()}`)
    const cardText = (await page.locator('.asset-card-connection').first().innerText()).replace(/\n+/g, ' \u00b7 ')
    console.log(`  first card: ${cardText}`)
    await page.locator('.asset-card-connection').first().evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(400)
    console.log(`  thumbnails settled: ${await settle(page)}`)
    await page.screenshot({ path: `${out}/${size.name}-card.png`, timeout: 60000 })

    // The hand-off, taken the way a player takes it.
    await page.locator('.asset-card-connection .asset-locate').first().click({ timeout: 20000 })
    await page.waitForURL(/\/map\?connection=/, { timeout: 15000 })
    console.log(`  landed on ${new URL(page.url()).search}`)
    await page.waitForTimeout(size.name === '390' ? 7000 : 6000)
    if (size.name === '390') {
      const explore = page.getByRole('button', { name: /^explore$/i })
      if (await explore.count()) { await explore.first().click().catch(() => {}); await page.waitForTimeout(1500) }
    }
    const opened = page.locator('.uw-retainer-opened')
    console.log(`  opened-line: ${await opened.count() ? (await opened.first().innerText()).replace(/\n+/g, ' ') : 'MISSING'}`)
    // Read in one evaluation: the scene rebuilds the region behind this and a
    // locator loop goes stale between the count and the read.
    const names = await page.$$eval('.uw-retainer-row.is-asked-for', (rows) => rows.map((row) => row.querySelector('strong')?.textContent ?? '?'))
    console.log(`  marked rows: ${names.length ? names.join(', ') : 'NONE'}`)
    const board = page.locator('.uw-retainer-board').first()
    if (await board.count()) {
      await board.evaluate((element) => element.scrollIntoView({ block: 'center' })).catch(() => {})
      await page.waitForTimeout(400)
      await board.screenshot({ path: `${out}/${size.name}-board.png`, animations: 'disabled', timeout: 8000 }).catch((e) => console.log('  board shot skipped:', e.message.split('\n')[0]))
    }
    await page.screenshot({ path: `${out}/${size.name}-map.png` })
    console.log(`  errors: ${errors.length ? errors.slice(0, 4).join(' | ') : 'none'}`)
    await context.close()
  }
} finally {
  await browser.close()
}
