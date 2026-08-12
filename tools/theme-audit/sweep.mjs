/**
 * Walks every route at both widths, screenshots it, and reports the computed
 * font stack actually in force on the elements whose rules name a font token.
 *
 * The computed read is the point. A `font-family: var(--font-ui)` where
 * `--font-ui` is never declared does not fail loudly — the declaration is
 * dropped and the element quietly inherits whatever its parent had. Only the
 * computed value says which face a reader is really looking at.
 *
 *   node tools/theme-audit/sweep.mjs [--tag=before] [--routes=office,firm]
 */
import { writeFileSync } from 'node:fs'
import { BASE, WIDTHS, launch, open, shotDir, signIn, visit } from './harness.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']),
)
const TAG = args.tag || 'shot'
const OUT = shotDir(new URL(`../../.theme-audit/${TAG}`, import.meta.url).pathname)

const ROUTES = [
  ['login', '/login'],
  ['onboarding', '/onboarding'],
  ['office', '/office'],
  ['progress', '/progress'],
  ['cases', '/cases'],
  ['firm', '/firm'],
  ['firm-catalog', '/firm?tab=catalog'],
  ['firm-ledger', '/firm?tab=ledger'],
  ['firm-staff', '/firm?tab=staff'],
  ['story', '/story'],
  ['map', '/map'],
]
const wanted = args.routes ? new Set(args.routes.split(',')) : null

/**
 * Every element whose used font differs from the one its own rules asked for,
 * plus a census of the faces on screen. Run in the page.
 */
const FONTS = () => {
  const families = new Map()
  const suspicious = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    const text = (el.textContent || '').trim()
    if (!text || el.children.length > 0) continue
    const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim()
    families.set(fam, (families.get(fam) ?? 0) + 1)
    // Archivo is the label face. Prose longer than a label sitting in it is
    // the signature of a dropped `var(--font-body)`.
    if (fam === 'Archivo' && text.length > 34 && s.textTransform !== 'uppercase') {
      suspicious.push({
        cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
        tag: el.tagName.toLowerCase(),
        size: s.fontSize,
        text: text.replace(/\s+/g, ' ').slice(0, 70),
      })
    }
  }
  return { families: Object.fromEntries([...families].sort((a, b) => b[1] - a[1])), suspicious }
}

const browser = await launch()
const state = await signIn(browser)
const report = {}

for (const [name, route] of ROUTES) {
  if (wanted && !wanted.has(name)) continue
  for (const [w, viewport] of Object.entries(WIDTHS)) {
    const { context, page } = await open(browser, state, viewport)
    try {
      await visit(page, route, { settle: name === 'map' || name === 'office' ? 4200 : 2000 })
      await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: false })
      if (w === 'desktop') report[name] = await page.evaluate(FONTS)
      console.log(`  ${name} ${w}`)
    } catch (e) {
      console.log(`  ${name} ${w} FAILED ${e.message}`)
    }
    await context.close()
  }
}

writeFileSync(`${OUT}/fonts.json`, JSON.stringify(report, null, 2))
await browser.close()
console.log(`\nwrote ${OUT}`)
console.log(`base ${BASE}`)
// `browser.close()` does not always settle here — a run that has driven the
// office or map scene can leave a handle open and the process then sits with a
// live Chromium behind it until something kills it. The work is finished and
// written by this point, so exit rather than wait.
process.exit(0)
