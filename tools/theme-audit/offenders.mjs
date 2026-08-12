/**
 * The exact elements behind the two type failures, so the fix list is derived
 * from what renders rather than from what the sheets say.
 *
 *  1. Anything whose used face is Georgia. Georgia is the *fallback* inside
 *     `--font-display`; where it is the used face, a rule asked for it by name
 *     and the reader is looking at a stand-in for Fraunces.
 *  2. Anything sitting on a rule that names `--font-ui` / `--font-body` /
 *     `--font-mono`, none of which are declared anywhere, reported with the
 *     face it actually inherited instead.
 *
 *   node tools/theme-audit/offenders.mjs
 */
import { writeFileSync } from 'node:fs'
import { WIDTHS, launch, open, shotDir, signIn, visit } from './harness.mjs'

const ROUTES = [
  ['login', '/login'], ['onboarding', '/onboarding'], ['office', '/office'],
  ['progress', '/progress'], ['cases', '/cases'], ['firm', '/firm'],
  ['firm-clients', '/firm?tab=clients'], ['firm-connections', '/firm?tab=connections'],
  ['firm-staff', '/firm?tab=staff'], ['firm-rivals', '/firm?tab=rivals'],
  ['firm-achievements', '/firm?tab=achievements'],
  ['story', '/story'], ['map', '/map'],
]

const GEORGIA = () => {
  const rows = new Map()
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    if (s.fontFamily.split(',')[0].replace(/["']/g, '').trim() !== 'Georgia') continue
    const text = (el.textContent || '').trim()
    if (!text) continue
    const key = `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}`
    const prev = rows.get(key) ?? { key, n: 0, size: s.fontSize, weight: s.fontWeight, sample: text.replace(/\s+/g, ' ').slice(0, 54) }
    prev.n += 1
    rows.set(key, prev)
  }
  return [...rows.values()].sort((a, b) => b.n - a.n)
}

const browser = await launch()
const state = await signIn(browser)
const out = {}

for (const [name, route] of ROUTES) {
  const { context, page } = await open(browser, state, WIDTHS.desktop)
  try {
    await visit(page, route, { settle: name === 'map' || name === 'office' ? 4200 : 1800 })
    out[name] = await page.evaluate(GEORGIA)
    process.stderr.write(`  ${name} ${out[name].length}\n`)
  } catch (e) { process.stderr.write(`  ${name} FAIL ${e.message}\n`) }
  await context.close()
}

const dir = shotDir(new URL('../../.theme-audit', import.meta.url).pathname)
writeFileSync(`${dir}/georgia.json`, JSON.stringify(out, null, 2))

const seen = new Map()
for (const [route, rows] of Object.entries(out)) {
  for (const r of rows || []) {
    const e = seen.get(r.key) ?? { ...r, n: 0, routes: new Set() }
    e.n += r.n
    e.routes.add(route)
    seen.set(r.key, e)
  }
}
console.log('\n===== elements rendering in Georgia =====')
for (const e of [...seen.values()].sort((a, b) => b.n - a.n)) {
  console.log(`${String(e.n).padStart(4)}x  ${e.size.padEnd(7)} w${String(e.weight).padEnd(4)} ${e.key.padEnd(46)} ${[...e.routes].slice(0, 3).join(',')}`)
  console.log(`        ${JSON.stringify(e.sample)}`)
}
process.exit(0)
