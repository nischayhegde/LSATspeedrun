/**
 * Does the replacement look like the thing it replaced?
 *
 * The earlier blur removals in this project did not delete the effect, they
 * swapped it for an alpha composite that reads the same, and proved it with a
 * pixel diff. This does the same for the map HUD.
 *
 * The hard part is that the backdrop is a WebGL scene with crowd and agent rigs
 * animating continuously, so two screenshots taken a second apart differ
 * everywhere regardless of the CSS. The scene is therefore frozen first, by
 * replacing `requestAnimationFrame` with a no-op once it has settled: three.js
 * drives its loop through rAF, so the canvas holds its last frame and both
 * captures share an identical backdrop. A self-check captures the same region
 * twice with nothing changed and requires a zero diff before any comparison is
 * believed.
 *
 * Diffing is done in a blank page with canvas `ImageData` rather than an image
 * library, so this adds no dependency to the repository.
 *
 *   node tools/ui-qa/blur-parity.mjs [--candidate=path.css]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'
const OUT = process.env.UI_QA_OUT ?? '/workspace/.qa-run/blur'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))

const PANELS = [
  '.uw-scene-title', '.uw-scene-view-tabs', '.uw-map-toolbar', '.uw-map-instructions',
  '.uw-district-guide', '.uw-level-navigator', '.uw-location-card', '.uw-retainer-board',
]

/** Restores the blur exactly as the stylesheet had it, so "before" can be
 *  reproduced after the source file has already been changed. */
const RESTORE = `
.uw-scene-title { background: linear-gradient(110deg, rgba(15,29,33,.91), rgba(26,42,42,.82)) !important; -webkit-backdrop-filter: blur(10px) !important; backdrop-filter: blur(10px) !important; }
.uw-scene-view-tabs { background: rgba(11,24,28,.88) !important; -webkit-backdrop-filter: blur(10px) !important; backdrop-filter: blur(10px) !important; }
.uw-map-toolbar button { background: rgba(13,26,30,.86) !important; -webkit-backdrop-filter: blur(8px) !important; backdrop-filter: blur(8px) !important; }
.uw-map-instructions { background: rgba(11,24,28,.82) !important; -webkit-backdrop-filter: blur(9px) !important; backdrop-filter: blur(9px) !important; }
.uw-district-guide { background: rgba(11,24,28,.88) !important; -webkit-backdrop-filter: blur(10px) !important; backdrop-filter: blur(10px) !important; }
.uw-level-navigator { background: linear-gradient(110deg, rgba(11,24,28,.96), rgba(24,39,39,.92)) !important; -webkit-backdrop-filter: blur(12px) !important; backdrop-filter: blur(12px) !important; }
.uw-location-card { background: linear-gradient(145deg, rgba(11,24,28,.96), rgba(28,41,41,.94)) !important; -webkit-backdrop-filter: blur(12px) !important; backdrop-filter: blur(12px) !important; }
.uw-retainer-board { background: rgba(11,24,28,.88) !important; -webkit-backdrop-filter: blur(10px) !important; backdrop-filter: blur(10px) !important; }
`

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
mkdirSync(OUT, { recursive: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
const page = await context.newPage()
await page.goto(`${APP}/map`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas', { timeout: 40000 })
await page.waitForTimeout(11000)

/* Open the HUD before freezing it. The district guide and the counsel board
   sit collapsed at 36px until asked for, and the location card does not exist
   until an office is selected -- diffing them shut would be diffing six chips
   and calling it the HUD. */
const open = async (selector) => {
  const el = page.locator(selector).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(500) }
}
await open('.uw-district-guide-toggle')
await open('.uw-retainer-toggle')
const site = page.locator('.empire-node, .uw-site, [class*="av-site"]').first()
if (await site.count()) { await site.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(900) }

// Freeze. three.js drives its loop through rAF, so a no-op holds the last
// frame on the canvas and gives both captures the same backdrop.
await page.evaluate(() => {
  window.__rafOriginal = window.requestAnimationFrame
  window.requestAnimationFrame = () => 0
})
await page.waitForTimeout(1200)

const shots = async () => {
  const out = {}
  // The whole viewport too: the panels are the point, but a change that leaks
  // outside one of them would not show up in a clip of it.
  out['(whole viewport)'] = (await page.screenshot()).toString('base64')
  for (const sel of PANELS) {
    const el = page.locator(sel).first()
    if (!(await el.count())) continue
    const box = await el.boundingBox()
    if (!box || box.width < 4 || box.height < 4) continue
    out[sel] = (await page.screenshot({ clip: box })).toString('base64')
  }
  return out
}

/** Compare two base64 PNGs in a blank page, via canvas pixels. */
const differ = await context.newPage()
await differ.setContent('<body style="margin:0">')
async function diff(a, b) {
  return differ.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = rej
      img.src = `data:image/png;base64,${src}`
    })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true }
    const c = document.createElement('canvas')
    c.width = ia.width; c.height = ia.height
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(ia, 0, 0)
    const da = ctx.getImageData(0, 0, c.width, c.height).data
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(ib, 0, 0)
    const db = ctx.getImageData(0, 0, c.width, c.height).data
    let sum = 0
    let worst = 0
    let over8 = 0
    const n = c.width * c.height
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
      sum += d
      if (d > worst) worst = d
      if (d > 8) over8 += 1
    }
    return { w: c.width, h: c.height, mean: +(sum / n).toFixed(2), worst, over8: +(over8 / n * 100).toFixed(2) }
  }, [a, b])
}

// Self-check: same CSS, two captures. Anything but zero means the scene is
// still moving and every number below would be noise.
await page.addStyleTag({ content: RESTORE })
await page.waitForTimeout(500)
const before = await shots()
const beforeAgain = await shots()
let frozen = true
for (const sel of Object.keys(before)) {
  const d = await diff(before[sel], beforeAgain[sel])
  if (d.sizeMismatch || d.mean > 0) { frozen = false; console.log(`  NOT FROZEN ${sel}: mean ${d.mean}`) }
}
console.log(`scene frozen for capture: ${frozen ? 'yes, two identical captures' : 'NO -- results below are noise'}\n`)

// The candidate: whatever the stylesheet now says, with the restore removed.
await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('backdrop-filter: blur(10px) !important')) s.remove() })
if (args.candidate) await page.addStyleTag({ content: readFileSync(args.candidate, 'utf8') })
await page.waitForTimeout(600)
const after = await shots()

const rows = []
for (const sel of Object.keys(before)) {
  if (!after[sel]) continue
  const d = await diff(before[sel], after[sel])
  rows.push({ sel, ...d })
  console.log(`${sel.padEnd(24)} ${String(d.w).padStart(4)}x${String(d.h).padStart(3)}  mean ${String(d.mean).padStart(6)}/255  worst ${String(d.worst).padStart(3)}  pixels over 8: ${d.over8}%`)
}
const meanAll = +(rows.reduce((a, r) => a + r.mean, 0) / rows.length).toFixed(2)
console.log(`\nmean difference across ${rows.length} panels: ${meanAll}/255`)

writeFileSync(`${OUT}/parity.json`, JSON.stringify({ frozen, rows, meanAll }, null, 2))
for (const sel of Object.keys(before)) {
  const name = sel.replace(/[^a-z]/gi, '') || 'panel'
  writeFileSync(`${OUT}/${name}-blur.png`, Buffer.from(before[sel], 'base64'))
  if (after[sel]) writeFileSync(`${OUT}/${name}-alpha.png`, Buffer.from(after[sel], 'base64'))
}
console.log(`Report: ${OUT}/parity.json`)
await browser.close()
