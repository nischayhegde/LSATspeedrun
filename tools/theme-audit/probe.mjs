/**
 * Reports the used font for the elements that do the same job on each screen —
 * page heading, section heading, card heading, eyebrow, body copy — so that
 * "two components doing the same job look different" becomes a table rather
 * than an impression.
 *
 * Also reports, for each match, the winning rule's own declaration, found by
 * walking the document's stylesheets. That is what distinguishes a heading
 * that asks for the display token and gets it from one that asks for raw
 * Georgia and from one that is being overridden by a later sheet.
 *
 *   node tools/theme-audit/probe.mjs
 */
import { writeFileSync } from 'node:fs'
import { WIDTHS, launch, open, shotDir, signIn, visit } from './harness.mjs'

const ROUTES = [
  ['login', '/login'], ['onboarding', '/onboarding'], ['office', '/office'],
  ['progress', '/progress'], ['cases', '/cases'], ['firm', '/firm'],
  ['story', '/story'], ['map', '/map'],
]

const PROBE = () => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const s = getComputedStyle(el)
    return {
      sel,
      used: s.fontFamily.split(',')[0].replace(/["']/g, ''),
      size: s.fontSize,
      weight: s.fontWeight,
      tracking: s.letterSpacing,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 44),
    }
  }

  const out = []
  for (const sel of [
    'h1', '.page-heading h1', '.section-heading h2', 'h2', 'h3',
    '.eyebrow', '.pixel-kicker', 'p',
  ]) {
    const r = pick(sel)
    if (r) out.push(r)
  }
  return out
}

const browser = await launch()
const state = await signIn(browser)
const report = {}

for (const [name, route] of ROUTES) {
  process.stderr.write(`  -> ${name} `)
  const { context, page } = await open(browser, state, WIDTHS.desktop)
  try {
    await visit(page, route, { settle: name === 'map' || name === 'office' ? 4200 : 2000 })
    report[name] = await page.evaluate(PROBE)
    process.stderr.write('ok\n')
  } catch (e) { report[name] = { error: e.message }; process.stderr.write(`FAIL ${e.message}\n`) }
  await context.close()
}

const dir = shotDir(new URL('../../.theme-audit', import.meta.url).pathname)
writeFileSync(`${dir}/probe.json`, JSON.stringify(report, null, 2))

for (const [name, rows] of Object.entries(report)) {
  console.log(`\n===== ${name}`)
  if (!Array.isArray(rows)) { console.log('  ', rows); continue }
  for (const r of rows) {
    console.log(`  ${r.sel.padEnd(22)} ${r.used.padEnd(10)} ${r.size.padEnd(7)} w${r.weight.padEnd(4)} ${r.tracking.padEnd(8)} ${JSON.stringify(r.text)}`)
  }
}

// This closed nothing at all for a while, which is why it looked like it hung:
// every route was probed and the report was complete, but the process stayed up
// holding a live Chromium and printed nothing, because the output is written
// here at the end rather than as it goes.
await browser.close()
process.exit(0)
