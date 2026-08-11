/**
 * Walk every route at a ladder of widths and report, per width, the things a
 * reviewer would have had to notice by eye.
 *
 * The brief's failure pattern is a fix that works at 390 and 1440 and breaks at
 * 1180, so the ladder is deliberately dense through the middle and includes two
 * landscape phones. Screenshots alone cannot carry that many widths honestly —
 * eight routes times twenty widths is a hundred and sixty images nobody reads —
 * so the sweep measures four things in the page and only photographs what it
 * flags, plus a fixed matrix for the record.
 *
 *   1. Document overflow: `scrollWidth > clientWidth` on the scroller.
 *   2. Elements pushed past the right edge or off the left one. Position-fixed
 *      overlays that are deliberately parked offscreen are excluded by their
 *      computed transform, not by name.
 *   3. Text that overlaps other text: two leaf elements with visible text whose
 *      rects intersect by more than a few pixels, neither containing the other.
 *   4. Interactive targets under 40px in either dimension.
 *
 *   node tools/ui-qa/viewport-sweep.mjs [--routes=a,b] [--widths=...] [--shots]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'
const OUT = process.env.UI_QA_OUT ?? '/workspace/.qa-run/sweep'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const ALL_ROUTES = [
  ['dashboard', '/progress'],
  ['cases', '/cases'],
  ['office', '/office'],
  ['firm-districts', '/firm?tab=connections'],
  ['firm-upgrades', '/firm?tab=upgrades'],
  ['firm-staff', '/firm?tab=staff'],
  ['firm-clients', '/firm?tab=clients'],
  ['map', '/map'],
  ['story', '/story'],
]

/** Dense through the middle, because that is where this app has broken. */
const ALL_WIDTHS = [
  { name: '320', width: 320, height: 720 },
  { name: '360', width: 360, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '480', width: 480, height: 900 },
  { name: '540', width: 540, height: 900 },
  { name: '600', width: 600, height: 900 },
  { name: '640', width: 640, height: 900 },
  { name: '700', width: 700, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '820', width: 820, height: 1180 },
  { name: '900', width: 900, height: 1000 },
  { name: '960', width: 960, height: 1000 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1100', width: 1100, height: 900 },
  { name: '1120', width: 1120, height: 900 },
  { name: '1180', width: 1180, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1366', width: 1366, height: 768 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1600', width: 1600, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
  { name: '2560', width: 2560, height: 1440 },
  { name: 'land-844', width: 844, height: 390 },
  { name: 'land-932', width: 932, height: 430 },
]

const routes = args.routes
  ? ALL_ROUTES.filter(([name]) => String(args.routes).split(',').includes(name))
  : ALL_ROUTES
const widths = args.widths
  ? ALL_WIDTHS.filter((w) => String(args.widths).split(',').includes(w.name))
  : ALL_WIDTHS

const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth
  const findings = { overflow: null, offRight: [], offLeft: [], overlaps: [], hudOverlaps: [], smallTargets: [] }

  const hasFixedAncestor = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (getComputedStyle(node).position === 'fixed') return true
    }
    return false
  }

  // An element only reaches past the viewport if nothing between it and the
  // document clips or scrolls it. Without this the report is mostly carousels:
  // the twenty-ninth card of a horizontal rail is 11,282px from the left edge
  // and that is the rail working.
  const isContained = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return true
    }
    return false
  }

  const scroller = document.scrollingElement || document.documentElement
  if (scroller.scrollWidth > scroller.clientWidth + 1) {
    findings.overflow = { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth }
  }

  const describe = (el) => {
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
      : ''
    return el.tagName.toLowerCase() + id + cls
  }

  const all = Array.from(document.body.querySelectorAll('*'))
  const visible = []
  for (const el of all) {
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

  for (const { el, rect, style } of visible) {
    // A pane parked outside the viewport by its own transform is a closed
    // drawer, not an overflow. Everything else that reaches past the right
    // edge is reported with the widest ancestor that also does, so one broken
    // container is one finding rather than forty.
    if (style.transform && style.transform !== 'none' && /matrix/.test(style.transform)) {
      const tx = Number(style.transform.split('(')[1]?.split(',')[4] ?? 0)
      if (Math.abs(tx) > vw / 2) continue
    }
    if (isContained(el)) continue
    if (rect.right > vw + 1) {
      const parent = el.parentElement
      const parentOver = parent && parent.getBoundingClientRect().right > vw + 1
      if (!parentOver) findings.offRight.push({ sel: describe(el), right: Math.round(rect.right), width: Math.round(rect.width) })
    }
    if (rect.left < -1 && rect.right > 0) {
      const parent = el.parentElement
      const parentOver = parent && parent.getBoundingClientRect().left < -1
      if (!parentOver) findings.offLeft.push({ sel: describe(el), left: Math.round(rect.left) })
    }
  }

  // Text overlap. Only leaves with their own text, only pairs that are not
  // nested, and only intersections big enough to actually read as broken.
  const leaves = visible.filter(({ el }) => {
    if (!el.childElementCount) return el.textContent && el.textContent.trim().length > 1
    return Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
  }).filter(({ style }) => style.position !== 'absolute')
  for (const leaf of leaves) leaf.fixed = hasFixedAncestor(leaf.el)
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i], b = leaves[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      // Two readings inside the same fixed HUD are its own layout, not a
      // collision with the page.
      if (a.fixed && b.fixed) continue
      // Two inline runs in one paragraph. An inline box that wraps reports the
      // union of its line boxes, so a <b> spanning two lines "contains" every
      // emphasis on the second line and the report reads as a collision on
      // every width. It is how inline layout is measured, not a defect: the
      // Districts intro produced one of these at all 23 widths.
      if (a.el.parentElement === b.el.parentElement
        && a.style.display.startsWith('inline') && b.style.display.startsWith('inline')) continue
      const ox = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left)
      const oy = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)
      if (ox > 4 && oy > 6) {
        const hudOf = (leaf) => {
          if (!leaf.fixed) return null
          for (let node = leaf.el; node && node !== document.body; node = node.parentElement) {
            if (getComputedStyle(node).position === 'fixed') return describe(node)
          }
          return null
        }
        const row = { a: describe(a.el), b: describe(b.el), ox: Math.round(ox), oy: Math.round(oy), hud: hudOf(a) || hudOf(b) }
        // A fixed overlay lying on the page is a different defect from two
        // parts of the page lying on each other: it is always going to sit over
        // *something*, so it is only worth reporting when it sits over words.
        if (a.fixed || b.fixed) findings.hudOverlaps.push(row)
        else findings.overlaps.push(row)
      }
    }
    if (findings.overlaps.length > 40) break
  }

  // Under 44px is only a defect where a finger is the pointer. On a desktop
  // header a 28px mute button is a mute button.
  const coarse = vw <= 900
  const floor = coarse ? 40 : 24
  for (const { el, rect } of visible) {
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role')
    const clickable = tag === 'button' || tag === 'a' || tag === 'select'
      || role === 'button' || role === 'menuitem' || role === 'tab'
    if (!clickable) continue
    if (el.hasAttribute('disabled')) continue
    if (rect.width < floor || rect.height < floor) {
      findings.smallTargets.push({ sel: describe(el), w: Math.round(rect.width), h: Math.round(rect.height) })
    }
  }
  return findings
})()`

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const report = []
try {
  for (const size of widths) {
    /* Touch below 900px, because that is the assumption the tap-target floor
       further up already makes — and without it the floor was being applied to
       a rendering that never saw the CSS meant to satisfy it. `mobile.css`
       raises a dozen controls to 44px inside `@media (pointer: coarse)`, which
       does not match in a plain desktop context, so the sweep reported the
       caseboard and district-guide buttons as 32 and 34px on every tablet
       width while a real tablet was getting 44. */
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      hasTouch: size.width <= 900,
    })
    const login = await context.request.post(`${API}/v1/auth/dev`, {
      data: { email: EMAIL, display_name: 'UI QA' },
    })
    if (!login.ok()) throw new Error(`dev login failed: ${login.status()}`)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    for (const [name, path] of routes) {
      try {
        await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await page.waitForTimeout(name === 'office' || name === 'map' ? 4500 : 1800)
        // Story cutscenes are blocking and would be photographed instead of the
        // page underneath them.
        for (let i = 0; i < 6; i += 1) {
          const choices = page.locator('.cutscene-choices button')
          if (await choices.count()) { await choices.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(700); continue }
          const dismiss = page.locator('.cutscene-defer, .story-quest-decline')
          if (await dismiss.count()) { await dismiss.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500); continue }
          break
        }
        const findings = await page.evaluate(AUDIT)
        const flagged = findings.overflow || findings.offRight.length || findings.offLeft.length
          || findings.overlaps.length || findings.hudOverlaps.length || findings.smallTargets.length
        report.push({ route: name, width: size.name, ...findings, errors: errors.splice(0) })
        if (args.shots || flagged) {
          mkdirSync(`${OUT}/${name}`, { recursive: true })
          await page.screenshot({ path: `${OUT}/${name}/${size.name}.png`, timeout: 30000 }).catch(() => {})
        }
      } catch (error) {
        report.push({ route: name, width: size.name, failed: String(error).slice(0, 200) })
      }
    }
    await context.close()
    process.stdout.write(`${size.name} `)
  }
} finally {
  await browser.close()
}
process.stdout.write('\n')

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
let flags = 0
for (const row of report) {
  const bits = []
  if (row.failed) bits.push(`FAILED ${row.failed}`)
  if (row.overflow) bits.push(`overflow ${row.overflow.scrollWidth}>${row.overflow.clientWidth}`)
  for (const o of row.offRight ?? []) bits.push(`offRight ${o.sel} right=${o.right}`)
  for (const o of row.offLeft ?? []) bits.push(`offLeft ${o.sel} left=${o.left}`)
  for (const o of (row.overlaps ?? []).slice(0, 6)) bits.push(`overlap ${o.a} x ${o.b} (${o.ox}x${o.oy})`)
  for (const o of (row.hudOverlaps ?? []).slice(0, 4)) bits.push(`hud-over-page [${o.hud}] ${o.a} x ${o.b} (${o.ox}x${o.oy})`)
  for (const o of (row.smallTargets ?? []).slice(0, 6)) bits.push(`small ${o.sel} ${o.w}x${o.h}`)
  for (const e of row.errors ?? []) bits.push(`pageerror ${e.slice(0, 120)}`)
  if (!bits.length) continue
  flags += 1
  console.log(`\n${row.route} @ ${row.width}`)
  for (const bit of bits) console.log(`  ${bit}`)
}
console.log(`\n${flags} of ${report.length} route/width pairs flagged. Report: ${OUT}/report.json`)
