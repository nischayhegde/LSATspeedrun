/**
 * Solves for the alpha composite that replaces a backdrop blur.
 *
 * Removing a blur and raising the alpha is not a like-for-like swap. A blurred
 * panel is `a*C + (1-a)*B̄`, where B̄ is the average of the backdrop it samples;
 * raising the alpha to a' without touching C gives `a'*C + (1-a')*B̄`, which is
 * further from B̄ than the original was. Over the map that means darker, because
 * the backdrop is a lit 3D scene and the panels are near-black. Measured that
 * way the panels came out 7.6 to 16.1 levels off the blurred original.
 *
 * Matching the mean instead:
 *
 *   a*C + (1-a)*B̄  =  a'*C' + (1-a')*B̄
 *   C'             =  (a*C + (a'-a)*B̄) / a'
 *
 * So the base colour moves toward the backdrop by exactly as much as the extra
 * opacity holds back. B̄ is measured, not assumed: the HUD is hidden and the
 * scene photographed underneath each panel.
 *
 *   node tools/ui-qa/blur-alpha.mjs
 */
import { chromium } from 'playwright'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'

const MOBILE = process.argv.includes('--mobile')

/** The stylesheet as it was: selector, the stops, and the target alpha. */
const RULES = MOBILE ? [
  { sel: '.uw-mobile-scene-summary', stops: [[10, 22, 27, .76]], target: [.92] },
  { sel: '.uw-mobile-scene-menu-toggle', stops: [[9, 21, 27, .9]], target: [.97] },
  { sel: '.uw-mobile-scene-menu', stops: [[9, 21, 28, .98], [21, 38, 40, .97]], target: [1, .99] },
] : [
  { sel: '.uw-scene-title', stops: [[15, 29, 33, .91], [26, 42, 42, .82]], target: [.97, .93] },
  { sel: '.uw-scene-view-tabs', stops: [[11, 24, 28, .88]], target: [.96] },
  { sel: '.uw-map-toolbar button', stops: [[13, 26, 30, .86]], target: [.95] },
  { sel: '.uw-map-instructions', stops: [[11, 24, 28, .82]], target: [.94] },
  { sel: '.uw-district-guide', stops: [[11, 24, 28, .88]], target: [.96] },
  { sel: '.uw-level-navigator', stops: [[11, 24, 28, .96], [24, 39, 39, .92]], target: [.99, .97] },
  { sel: '.uw-location-card', stops: [[11, 24, 28, .96], [28, 41, 41, .94]], target: [.99, .98] },
  { sel: '.uw-retainer-board', stops: [[11, 24, 28, .88]], target: [.96] },
]

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({
  viewport: MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  hasTouch: MOBILE,
  isMobile: MOBILE,
})
await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
const page = await context.newPage()
await page.goto(`${APP}/map`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas', { timeout: 40000 })
await page.waitForTimeout(11000)

const open = async (selector) => {
  const el = page.locator(selector).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(500) }
}
if (MOBILE) await open('.uw-mobile-scene-menu-toggle')
else {
  await open('.uw-district-guide-toggle')
  await open('.uw-retainer-toggle')
}

await page.evaluate(() => { window.requestAnimationFrame = () => 0 })
await page.waitForTimeout(1000)

// Where each panel is, then the HUD out of the way so the scene beneath it can
// be photographed.
const boxes = {}
for (const { sel } of RULES) {
  const el = page.locator(sel).first()
  if (!(await el.count())) continue
  const box = await el.boundingBox()
  if (box && box.width > 3 && box.height > 3) boxes[sel] = box
}
await page.addStyleTag({ content: `${RULES.map((r) => r.sel).join(',')}, .uw-map-rail, .uw-map-toolbar { visibility: hidden !important; }` })
await page.waitForTimeout(400)

const differ = await context.newPage()
await differ.setContent('<body style="margin:0">')
const meanOf = async (b64) => differ.evaluate(async (src) => {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/png;base64,${src}` })
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  const sum = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2] }
  const n = c.width * c.height
  return sum.map((v) => v / n)
}, b64)

console.log('backdrop under each panel, and the base colour that matches the blurred mean\n')
for (const rule of RULES) {
  const box = boxes[rule.sel]
  if (!box) { console.log(`${rule.sel.padEnd(24)} not on screen, skipped`); continue }
  const shot = (await page.screenshot({ clip: box })).toString('base64')
  const bg = await meanOf(shot)
  const out = rule.stops.map((stop, i) => {
    const a = stop[3]
    const a2 = rule.target[i]
    const c2 = stop.slice(0, 3).map((c, ch) => Math.round((a * c + (a2 - a) * bg[ch]) / a2))
    return `rgba(${c2.join(', ')}, ${String(a2).replace(/^0/, '')})`
  })
  console.log(`${rule.sel.padEnd(24)} backdrop rgb(${bg.map((v) => Math.round(v)).join(', ')})`)
  for (let i = 0; i < out.length; i += 1) {
    const s = rule.stops[i]
    console.log(`    was rgba(${s.slice(0, 3).join(', ')}, ${String(s[3]).replace(/^0/, '')}) + blur   ->   ${out[i]}`)
  }
}
await browser.close()
