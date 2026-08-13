/**
 * Which rules in mobile.css lose to a route sheet?
 *
 * mobile.css is the entry stylesheet. Every route sheet and every component
 * sheet is injected after it, deliberately — the split was a measured win and
 * is not to be undone. The cost of that order is invisible and has now bitten
 * three times: a rule in mobile.css written at the same specificity as one in a
 * route sheet never applies, and nothing about either rule says so. The war
 * room's 44px finger floor, the caseboard's, and the dashboard tab rail's were
 * all written, all correct, and all dead.
 *
 * This walks the live cascade instead of the source. For every declaration
 * mobile.css makes inside a matching media query, it asks the browser which
 * rule actually won for a matching element, and reports the ones where the
 * answer is not mobile.css.
 *
 *   node tools/ui-qa/cascade-audit.mjs [--routes=a,b] [--width=390]
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'
const OUT = process.env.UI_QA_OUT ?? '/workspace/.qa-run/cascade'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const WIDTH = Number(args.width ?? 390)
const ROUTES = (args.routes ? String(args.routes) : '/progress,/cases,/firm?tab=connections,/firm?tab=staff,/office,/story').split(',')

/* Only the properties where losing is a defect a person feels, rather than a
   presentation choice a later sheet is entitled to make. A size floor that
   does not apply is a control too small to hit; a colour that does not apply
   is usually the route sheet's opinion and correct. */
const WATCHED = ['min-height', 'min-width', 'touch-action', 'overflow-x', 'overscroll-behavior-y']

const PROBE = `(() => {
  const watched = ${JSON.stringify(WATCHED)}
  const findings = []
  const isMobileSheet = (sheet) => (sheet?.href ?? '').includes('mobile.css') || (sheet?.ownerNode?.getAttribute?.('data-vite-dev-id') ?? '').includes('mobile.css')

  /* In dev, Vite serves each stylesheet as its own <style> with the source path
     on the node; in a build they are files. Both are covered above. */
  const rulesOf = (sheet) => {
    try { return Array.from(sheet.cssRules) } catch { return [] }
  }

  const collect = (rules, sheet, out, media) => {
    for (const rule of rules) {
      if (rule.media) {
        if (!window.matchMedia(rule.conditionText ?? rule.media.mediaText).matches) continue
        collect(Array.from(rule.cssRules), sheet, out, rule.conditionText ?? rule.media.mediaText)
        continue
      }
      if (rule.type !== CSSRule.STYLE_RULE) continue
      out.push({ rule, sheet, media })
    }
  }

  const sheetName = (sheet) => {
    const id = sheet?.ownerNode?.getAttribute?.('data-vite-dev-id') ?? sheet?.href ?? '(inline)'
    return id.split('/').pop().split('?')[0]
  }

  const mobileRules = []
  const everyRule = []
  for (const sheet of document.styleSheets) {
    collect(rulesOf(sheet), sheet, everyRule, null)
    if (!isMobileSheet(sheet)) continue
    collect(rulesOf(sheet), sheet, mobileRules, null)
  }
  if (!mobileRules.length) return { error: 'mobile.css not found among ' + document.styleSheets.length + ' sheets' }

  /* Which sheet actually set the value the element ended up with. Last match in
     document order, which is the right answer whenever the competing rules are
     the same specificity — and that is the whole shape of this bug. Reported so
     that mobile.css losing to a later block of mobile.css at another breakpoint,
     which is just the cascade being used on purpose, can be told apart from
     mobile.css losing to a route sheet, which is a rule that never applies. */
  const winnerOf = (el, prop) => {
    let winner = null
    for (const entry of everyRule) {
      if (!entry.rule.style.getPropertyValue(prop)) continue
      try { if (!el.matches(entry.rule.selectorText)) continue } catch { continue }
      winner = entry
    }
    return winner ? { sheet: sheetName(winner.sheet), selector: winner.rule.selectorText.slice(0, 70) } : null
  }

  for (const { rule, media } of mobileRules) {
    const declared = watched.filter((p) => rule.style.getPropertyValue(p))
    if (!declared.length) continue
    let matches = []
    try { matches = Array.from(document.querySelectorAll(rule.selectorText)) } catch { continue }
    // Only elements that are actually on the page. A rule losing on a node
    // with no box is a rule about nothing.
    const el = matches.find((n) => n.getBoundingClientRect().height > 0)
    if (!el) continue
    for (const prop of declared) {
      const want = rule.style.getPropertyValue(prop).trim()
      const got = getComputedStyle(el).getPropertyValue(prop).trim()
      let lost
      if (/^min-/.test(prop)) {
        // Only absolute lengths can be compared against a computed pixel
        // value without lying: "min-height: 100%" resolving to 390px is the
        // rule working, not the rule losing.
        if (!/^[\\d.]+px$/.test(want)) continue
        lost = parseFloat(got) + .5 < parseFloat(want)
      } else {
        lost = want !== got
      }
      if (!lost) continue
      const winner = winnerOf(el, prop)
      if (!winner || winner.sheet.includes('mobile.css')) continue
      findings.push({
        selector: rule.selectorText.slice(0, 90), media, prop, want, got, winner,
        sample: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),
        box: Math.round(el.getBoundingClientRect().height) + 'x' + Math.round(el.getBoundingClientRect().width),
      })
    }
  }
  return { findings }
})()`

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: WIDTH, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1,
})
await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
const page = await context.newPage()

const all = []
for (const route of ROUTES) {
  await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(route.includes('office') ? 4200 : 2200)
  const result = await page.evaluate(PROBE)
  if (result.error) { console.log(`${route}: ${result.error}`); continue }
  const seen = new Set()
  const rows = result.findings.filter((f) => {
    const key = `${f.selector}|${f.prop}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (rows.length) {
    console.log(`\n${route}`)
    for (const f of rows) console.log(`  ${f.prop}: mobile.css wants ${f.want}, ${f.winner.sheet} gives ${f.got}  —  "${f.selector}" beaten by "${f.winner.selector}"  (${f.sample})`)
  }
  all.push({ route, findings: rows })
}
await browser.close()
writeFileSync(`${OUT}/cascade-${WIDTH}.json`, JSON.stringify(all, null, 2))
const total = all.reduce((n, r) => n + r.findings.length, 0)
console.log(`\n${total} declaration${total === 1 ? '' : 's'} in mobile.css lost the cascade at ${WIDTH}px. Report: ${OUT}/cascade-${WIDTH}.json`)
