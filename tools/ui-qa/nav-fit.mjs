/**
 * Where the header stops fitting.
 *
 * The viewport sweep cannot see this one: the nav does not overflow the
 * viewport at 1024, it *ellipsizes*, so "Firm" becomes "Fi…" and "World"
 * becomes "Wo…" while every bounding box stays inside the page. This walks the
 * width range between the phone cutover and a comfortable desktop and reports,
 * per width, which labels are being clipped and by how much.
 *
 *   node tools/ui-qa/nav-fit.mjs [from] [to] [step]
 */
import { chromium } from 'playwright'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'

const from = Number(process.argv[2] ?? 901)
const to = Number(process.argv[3] ?? 1300)
const step = Number(process.argv[4] ?? 20)

const MEASURE = `(() => {
  const clipped = []
  for (const span of document.querySelectorAll('.desktop-nav a > span, .header-focus-label, .account-name')) {
    // The Focus label is deliberately clipped to nothing while the row is
    // full — the plate is icon-only until 1400px — so its clip-path is the
    // signal that this is the intended state rather than a squeeze.
    if (getComputedStyle(span).clipPath === 'inset(50%)') continue
    const over = span.scrollWidth - span.clientWidth
    if (over > 0) clipped.push({ text: span.textContent.trim().slice(0, 18), over })
  }
  const header = document.querySelector('.app-header')
  const nav = document.querySelector('.desktop-nav')
  const right = document.querySelector('.header-right')
  return {
    clipped,
    headerOverflow: header ? header.scrollWidth - header.clientWidth : null,
    navWidth: nav ? Math.round(nav.getBoundingClientRect().width) : null,
    rightWidth: right ? Math.round(right.getBoundingClientRect().width) : null,
    navVisible: nav ? getComputedStyle(nav).display !== 'none' : false,
    hamburger: (() => {
      const trigger = document.querySelector('.mobile-overflow-trigger, .header-menu-trigger')
      return trigger ? getComputedStyle(trigger).display !== 'none' : false
    })(),
  }
})()`

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: to, height: 900 } })
  await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
  const page = await context.newPage()
  await page.goto(`${APP}/progress`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-header', { timeout: 30000 })
  await page.waitForTimeout(1500)
  for (let width = from; width <= to; width += step) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(140)
    const row = await page.evaluate(MEASURE)
    const clipped = row.clipped.map((c) => `${c.text}(-${c.over})`).join(' ')
    console.log(
      `${String(width).padStart(4)}  nav=${row.navVisible ? String(row.navWidth).padStart(4) : ' off'}`
      + `  right=${String(row.rightWidth).padStart(4)}`
      + `  burger=${row.hamburger ? 'yes' : 'no '}`
      + `  ${clipped || 'labels fit'}`,
    )
  }
} finally {
  await browser.close()
}
