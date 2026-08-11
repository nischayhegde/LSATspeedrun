/**
 * One route, a list of widths, into one folder. For before-and-after pairs.
 *
 *   node tools/ui-qa/shot.mjs <label> <path> <width,width,...> [fullPage]
 *
 * Writes .qa-run/evidence/<label>/<width>.png.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'
const OUT = process.env.UI_QA_OUT ?? '/workspace/.qa-run/evidence'

const label = process.argv[2] ?? 'shot'
const path = process.argv[3] ?? '/progress'
const widths = (process.argv[4] ?? '390,1024,1440').split(',').map((pair) => {
  const [width, height] = pair.split('x')
  return { width: Number(width), height: Number(height ?? 900) }
})
const fullPage = process.argv[5] === 'full'

mkdirSync(`${OUT}/${label}`, { recursive: true })
const browser = await chromium.launch()
try {
  for (const size of widths) {
    /* Touch below the cutover, the same rule the sweep uses.
       Without it a 390px screenshot is desktop CSS rendered in a narrow
       window: every `(pointer: coarse)` rule is inactive, so the 44px tap
       floors are missing, the toolbar keeps the blur that is dropped on touch,
       and the dock rules never apply. Evidence taken that way shows a page
       that no phone renders. */
    const context = await browser.newContext({
      viewport: size, deviceScaleFactor: 1, hasTouch: size.width <= 900, isMobile: size.width <= 900,
    })
    await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
    const page = await context.newPage()
    await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(/\/(office|map)/.test(path) ? 5000 : 2200)
    for (let i = 0; i < 6; i += 1) {
      const choices = page.locator('.cutscene-choices button')
      if (await choices.count()) { await choices.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(700); continue }
      const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
      if (await dismiss.count()) { await dismiss.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500); continue }
      break
    }
    await page.screenshot({ path: `${OUT}/${label}/${size.width}x${size.height}.png`, fullPage, timeout: 40000 })
    await context.close()
    console.log(`${label} ${size.width}x${size.height}`)
  }
} finally {
  await browser.close()
}
