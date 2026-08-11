/**
 * What the retainer board says when a connection card sends you to the map.
 *
 * Everything is read in a single `$$eval` per poll: the three.js scene rebuilds
 * the region behind this panel, and a locator loop reliably goes stale between
 * counting the rows and reading them.
 *
 *   node .qa-run/map-landing.mjs <connectionKey> [width]
 */
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
import { mkdirSync, writeFileSync } from 'node:fs'

const { chromium } = playwright
const APP = 'http://127.0.0.1:4372'
const API = 'http://127.0.0.1:5372'
const key = process.argv[2] || 'local_bar'
const width = Number(process.argv[3] || 1440)
const out = '/private/tmp/lsat-firm/.qa-run/shots/landing'
mkdirSync(out, { recursive: true })

const read = () => {
  const board = document.querySelector('.uw-retainer-board')
  if (!board) return { board: false }
  return {
    board: true,
    open: board.classList.contains('is-open'),
    toggle: board.querySelector('.uw-retainer-toggle')?.innerText?.replace(/\n+/g, ' ') ?? '',
    opened: document.querySelector('.uw-retainer-opened')?.innerText?.replace(/\n+/g, ' ') ?? null,
    intro: document.querySelector('.uw-retainer-intro')?.innerText?.replace(/\n+/g, ' ') ?? null,
    marked: Array.from(document.querySelectorAll('.uw-retainer-row.is-asked-for')).map((row) => row.querySelector('strong')?.textContent ?? '?'),
    rows: document.querySelectorAll('.uw-retainer-row').length,
  }
}

// Headed system Chrome with a real GPU. Headless chromium falls back to the
// software rasteriser, and the region scene saturates it badly enough that
// neither page.screenshot() nor CDP Page.captureScreenshot can get a frame out.
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false })
try {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } })
  const errors = []
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
  await page.goto(`${APP}/map?connection=${key}`, { waitUntil: 'domcontentloaded' })

  let state = { board: false }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(1500)
    if (width < 500) {
      const explore = page.locator('.uw-mobile-scene-menu-toggle')
      if (await explore.count() && !(await page.locator('.uw-mobile-scene-menu').count())) {
        await explore.first().click({ timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(1200)
      }
    }
    state = await page.evaluate(read).catch(() => ({ board: false }))
    if (state.board && state.opened) break
  }
  console.log(`\n[${width}] ${key}`)
  console.log(JSON.stringify(state, null, 2))
  // page.screenshot() waits on a compositor commit, and the three.js region
  // scene keeps the software rasteriser saturated in headless, so it never
  // arrives. CDP with fromSurface:false reads the renderer's own view instead.
  const cdp = await context.newCDPSession(page)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch((e) => { console.log('shot skipped', e.message.split('\n')[0]); return null })
  if (shot) writeFileSync(`${out}/${width}-${key}.png`, Buffer.from(shot.data, 'base64'))
  const board = page.locator('.uw-retainer-board').first()
  if (await board.count()) {
    await board.screenshot({ path: `${out}/${width}-${key}-board.png`, animations: 'disabled', timeout: 20000 })
      .catch((e) => console.log('board shot skipped', e.message.split('\n')[0]))
  }
  console.log(`errors: ${errors.length ? errors.slice(0, 4).join(' | ') : 'none'}`)
  await context.close()
} finally {
  await browser.close()
}
