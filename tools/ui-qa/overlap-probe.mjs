/**
 * Name the overlaps the sweep counts.
 *
 * `viewport-sweep.mjs` reports a pair as `p x span`, which is enough to know
 * something is wrong and not enough to find it. This walks one route at one
 * width, prints a full DOM path, the computed position and the text for every
 * overlapping pair, and writes a screenshot with each pair outlined so the
 * numbers can be checked against the picture.
 *
 *   node tools/ui-qa/overlap-probe.mjs /firm?tab=connections 430
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'
const OUT = process.env.UI_QA_OUT ?? '/workspace/.qa-run/sweep'

const path = process.argv[2] ?? '/firm?tab=connections'
const width = Number(process.argv[3] ?? 430)
const height = Number(process.argv[4] ?? 900)
const label = process.argv[5] ?? 'probe'

const PROBE = `(() => {
  const pathOf = (el) => {
    const parts = []
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cls = typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
      parts.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + cls)
    }
    return parts.slice(-5).join(' > ')
  }
  const visible = []
  for (const el of document.body.querySelectorAll('*')) {
    // checkVisibility is what catches a closed details element: Chromium keeps
    // the last layout of its children, so a rect alone says they are on screen
    // and every trophy card in the collapsed panel reads as lying across the
    // page below it.
    if (!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    visible.push({ el, rect, style })
  }
  const leaves = visible.filter(({ el }) => {
    if (!el.childElementCount) return el.textContent && el.textContent.trim().length > 1
    return Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
  }).filter(({ style }) => style.position !== 'absolute' && style.position !== 'fixed')
  const out = []
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i], b = leaves[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const ox = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left)
      const oy = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)
      if (ox > 4 && oy > 6) {
        a.el.style.outline = '2px solid #ff2d55'
        b.el.style.outline = '2px solid #00d1ff'
        out.push({
          a: pathOf(a.el), aPos: a.style.position, aText: (a.el.textContent || '').trim().slice(0, 48),
          b: pathOf(b.el), bPos: b.style.position, bText: (b.el.textContent || '').trim().slice(0, 48),
          ox: Math.round(ox), oy: Math.round(oy),
          aRect: [Math.round(a.rect.left), Math.round(a.rect.top), Math.round(a.rect.width), Math.round(a.rect.height)],
          bRect: [Math.round(b.rect.left), Math.round(b.rect.top), Math.round(b.rect.width), Math.round(b.rect.height)],
        })
      }
    }
    if (out.length > 60) break
  }
  return out
})()`

mkdirSync(`${OUT}/probe`, { recursive: true })
const browser = await chromium.launch()
try {
  // Touch below the cutover, so `(pointer: coarse)` rules are live. See shot.mjs.
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width <= 900,
  })
  await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
  const page = await context.newPage()
  await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const rows = await page.evaluate(PROBE)
  for (const row of rows) {
    console.log(`\n${row.ox}x${row.oy}`)
    console.log(`  A [${row.aPos}] ${row.a}  @${row.aRect.join(',')}  "${row.aText}"`)
    console.log(`  B [${row.bPos}] ${row.b}  @${row.bRect.join(',')}  "${row.bText}"`)
  }
  await page.screenshot({ path: `${OUT}/probe/${label}-${width}.png`, fullPage: true })
  console.log(`\n${rows.length} pairs. Shot: ${OUT}/probe/${label}-${width}.png`)
} finally {
  await browser.close()
}
