/**
 * The screens and states the route sweep cannot reach by url alone: the case
 * session itself, the answered/explanation state below it, the route error
 * plate, the loading plate, and the firm tabs that only render a locked or
 * empty variant.
 *
 * Conditional states are where theme drift collects, because nobody looks at
 * them, so they are shot deliberately rather than hoped for.
 *
 *   node tools/theme-audit/states.mjs --tag=before
 */
import { writeFileSync } from 'node:fs'
import { WIDTHS, launch, open, shotDir, signIn, visit } from './harness.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']),
)
const TAG = args.tag || 'before'
const OUT = shotDir(new URL(`../../.theme-audit/${TAG}`, import.meta.url).pathname)

/** Faces in use on whatever is currently on screen, plus prose in the label face. */
const FONTS = () => {
  const families = new Map()
  const odd = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    const text = (el.textContent || '').trim()
    if (!text || el.children.length > 0) continue
    const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim()
    families.set(fam, (families.get(fam) ?? 0) + 1)
    if ((fam === 'Archivo' || fam === 'Georgia') && text.length > 40 && s.textTransform !== 'uppercase') {
      odd.push({ fam, cls: String(el.className).slice(0, 44), size: s.fontSize, text: text.replace(/\s+/g, ' ').slice(0, 60) })
    }
  }
  return { families: Object.fromEntries([...families].sort((a, b) => b[1] - a[1])), odd: odd.slice(0, 12) }
}

const browser = await launch()
const state = await signIn(browser)
const report = {}

async function shoot(page, name, w) {
  await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: false })
  if (w === 'desktop') report[name] = await page.evaluate(FONTS)
  console.log(`  ${name} ${w}`)
}

for (const [w, viewport] of Object.entries(WIDTHS)) {
  // ---- the case session, reached by resuming a queued run
  {
    const { context, page } = await open(browser, state, viewport)
    try {
      await visit(page, '/cases')
      const resume = page.getByRole('button', { name: /^(Resume|Continue)/ }).first()
      await resume.click({ timeout: 15000 })
      await page.waitForTimeout(2800)
      await shoot(page, 'case-session', w)

      // Answer whichever choice is first, to reach the explanation state.
      const choice = page.locator('.choice-card, .answer-choice, [class*="choice"] button').first()
      await choice.click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(900)
      const submit = page.getByRole('button', { name: /submit|confirm|lock/i }).first()
      await submit.click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2600)
      await shoot(page, 'case-answered', w)
    } catch (e) { console.log(`  case-session ${w} FAILED ${e.message}`) }
    await context.close()
  }

  // ---- the route error plate
  {
    const { context, page } = await open(browser, state, viewport)
    try {
      await visit(page, '/cases/does-not-exist', { settle: 3000 })
      await shoot(page, 'route-error', w)
    } catch (e) { console.log(`  route-error ${w} FAILED ${e.message}`) }
    await context.close()
  }

  // ---- signed out: the login screen's own error/empty framing
  {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
    const page = await context.newPage()
    try {
      await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2200)
      await shoot(page, 'login-fresh', w)
    } catch (e) { console.log(`  login-fresh ${w} FAILED ${e.message}`) }
    await context.close()
  }

  // ---- firm tabs that carry locked / empty variants
  for (const [name, url] of [['firm-clients', '/firm?tab=clients'], ['firm-rivals', '/firm?tab=rivals'], ['firm-achievements', '/firm?tab=achievements'], ['firm-connections', '/firm?tab=connections']]) {
    const { context, page } = await open(browser, state, viewport)
    try {
      await visit(page, url)
      await shoot(page, name, w)
    } catch (e) { console.log(`  ${name} ${w} FAILED ${e.message}`) }
    await context.close()
  }
}

writeFileSync(`${OUT}/states-fonts.json`, JSON.stringify(report, null, 2))
console.log(`\nwrote ${OUT}`)
process.exit(0)
