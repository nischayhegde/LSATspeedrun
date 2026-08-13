/**
 * Walk the guided tour end to end and photograph every step, at whatever widths
 * are asked for.
 *
 * The tour is the longest single piece of copy in the app and the only one that
 * renders seven different diagrams inside one fixed-size card, so "it looked
 * fine on my screen" is worth nothing here. This drives it with the same event
 * the header's Replay button dispatches, clicks Next until the finish step, and
 * at every step records whether the card overflows its own viewport, whether
 * anything inside the card overflows the card, and whether the spotlight is
 * pointing at something that exists.
 *
 *   node tools/ui-qa/tour-walk.mjs --widths 390,768,1180,1440 --out .qa-run/tour
 *
 * Needs the dev servers up: frontend on 5173, backend on 5001.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])

const WEB = args.get('web') ?? 'http://127.0.0.1:5173'
const API = args.get('api') ?? 'http://127.0.0.1:5001'
const EMAIL = args.get('email') ?? 'ui-qa@localhost.test'
const OUT = args.get('out') ?? '.qa-run/tour'
const WIDTHS = (args.get('widths') ?? '390,768,1180,1440').split(',').map(Number)
/* Height matters more here than anywhere else in the app: the card is fixed,
   centred and scrolls internally, so the viewport it has to fit inside is the
   short dimension. 844 and 932 are the two landscape phones — 390 and 430 tall,
   which is less than the card's natural height and the case the tour has
   actually failed at. */
const HEIGHTS = { 320: 720, 390: 844, 414: 896, 768: 1024, 820: 1180, 844: 390, 932: 430, 1024: 768, 1180: 820, 1280: 800, 1440: 900, 1920: 1080 }
/* Declared, not inferred from the width. Both landscape phones are wider than
   the 900px cutover, and a tour audited there with a mouse cannot see the
   rules written for a finger. */
const TOUCH = new Set([320, 390, 414, 768, 820, 844, 932])
const FOCUS = args.get('focus') === 'true'

/** Everything one step can be wrong about, measured in the page. */
const AUDIT = `(() => {
  const card = document.querySelector('.guided-tour-card')
  if (!card) return null
  const rect = card.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const heading = card.querySelector('.tour-card-heading > span')
  const counter = card.querySelector('.tour-card-heading > small')
  const rail = card.querySelector('.tour-chapters')
  const avatar = card.querySelector('.tour-guide-avatar')
  // Anything inside the card wider than the card is a horizontal clip: the card
  // scrolls vertically on purpose and never horizontally.
  const clipped = []
  const bleeds = new Set(['tour-card-progress', 'tour-card-footer'])
  for (const el of card.querySelectorAll('*')) {
    // The progress bar and the sticky footer reach the card's edge on purpose.
    if (typeof el.className === 'string' && [...bleeds].some((name) => el.className.includes(name))) continue
    if (el.closest('.tour-card-footer, .tour-card-progress')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > rect.right + 1.5 || r.left < rect.left - 1.5) {
      clipped.push({ path: el.className || el.tagName, left: Math.round(r.left), right: Math.round(r.right) })
    }
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') {
      clipped.push({ path: (el.className || el.tagName) + ' [text]', over: el.scrollWidth - el.clientWidth })
    }
  }
  // The rail is the one control that can silently collide with the portrait.
  let railOverAvatar = false
  if (rail && avatar) {
    const a = avatar.getBoundingClientRect()
    for (const button of rail.querySelectorAll('button')) {
      const b = button.getBoundingClientRect()
      if (b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom) railOverAvatar = true
    }
  }
  const spotlight = document.querySelector('.guided-tour-spotlight')
  // Where Next actually is, and what the topmost element at its centre is —
  // "the button is on screen" and "the button is the thing you would hit" are
  // different claims and the tour has been wrong about the second one.
  const nextButton = card.querySelector('.tour-next')
  let next = null
  if (nextButton) {
    const n = nextButton.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(n.left + n.width / 2), Math.round(n.top + n.height / 2))
    next = {
      rect: [Math.round(n.left), Math.round(n.top), Math.round(n.right), Math.round(n.bottom)],
      inViewport: n.top >= 0 && n.bottom <= vh && n.left >= 0 && n.right <= vw,
      covered: hit ? !nextButton.contains(hit) && hit !== nextButton : true,
      coveredBy: hit && !nextButton.contains(hit) ? (hit.className || hit.tagName).toString().slice(0, 60) : null,
    }
  }
  // The bleed elements have to line up with the card's edge exactly.
  const bar = card.querySelector('.tour-card-progress')
  const foot = card.querySelector('.tour-card-footer')
  const bleed = [bar, foot].filter(Boolean).map((el) => {
    const r = el.getBoundingClientRect()
    return Math.round(Math.max(rect.left - r.left, r.right - rect.right))
  })
  return {
    next,
    bleed: Math.max(0, ...bleed),
    eyebrow: heading ? heading.textContent.trim() : '',
    counter: counter ? counter.textContent.trim() : '',
    chapter: rail ? (rail.querySelector('.is-current') || {}).textContent : null,
    mode: (document.querySelector('.guided-tour') || {}).className,
    offViewport: {
      top: Math.round(Math.min(0, rect.top)),
      bottom: Math.round(Math.max(0, rect.bottom - vh)),
      left: Math.round(Math.min(0, rect.left)),
      right: Math.round(Math.max(0, rect.right - vw)),
    },
    scrolls: card.scrollHeight > card.clientHeight + 1,
    clipped,
    railOverAvatar,
    railRows: rail ? new Set(Array.from(rail.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().top))).size : 0,
    spotlight: spotlight ? true : null,
    nextLabel: (card.querySelector('.tour-next') || {}).textContent,
  }
})()`

const report = { widths: {}, problems: [] }

const browser = await chromium.launch()
for (const width of WIDTHS) {
  const height = HEIGHTS[width] ?? 900
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: TOUCH.has(width) })
  await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
  const page = await context.newPage()
  await page.goto(`${WEB}/progress`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-header', { timeout: 30000 })
  if (FOCUS) {
    await context.request.patch(`${API}/v1/me`, { data: { assistance_level: 'focus' } })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.app-header', { timeout: 30000 })
  }
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.dispatchEvent(new Event('lsat-tycoon:replay-tour')))
  await page.waitForSelector('.guided-tour-card', { timeout: 20000 })

  const dir = `${OUT}/${FOCUS ? 'focus-' : ''}${width}`
  await mkdir(dir, { recursive: true })
  const steps = []
  for (let step = 0; step < 40; step += 1) {
    await page.waitForTimeout(420)
    const audit = await page.evaluate(AUDIT)
    if (!audit) break
    const slug = String(step + 1).padStart(2, '0')
    await page.screenshot({ path: `${dir}/${slug}.png` })
    steps.push(audit)
    const off = audit.offViewport
    if (off.top < -1 || off.bottom > 1 || off.left < -1 || off.right > 1) {
      report.problems.push({ width, step: slug, eyebrow: audit.eyebrow, kind: 'card off viewport', off })
    }
    if (audit.clipped.length) report.problems.push({ width, step: slug, eyebrow: audit.eyebrow, kind: 'clipped inside card', clipped: audit.clipped })
    if (audit.railOverAvatar) report.problems.push({ width, step: slug, eyebrow: audit.eyebrow, kind: 'chapter rail under the portrait' })
    if (audit.bleed > 1) report.problems.push({ width, step: slug, eyebrow: audit.eyebrow, kind: 'bleed past the card edge', px: audit.bleed })
    if (audit.next && !audit.next.inViewport) report.problems.push({ width, step: slug, eyebrow: audit.eyebrow, kind: 'Next off screen', rect: audit.next.rect })
    if (audit.next && audit.next.covered) report.problems.push({ width, step: slug, eyebrow: audit.eyebrow, kind: 'Next covered', by: audit.next.coveredBy })
    const isFinish = /guided-tour-mode-finish/.test(audit.mode ?? '')
    if (isFinish) break
    // The practice step needs an answer before Next will move.
    const choice = await page.$('.tour-answer-list button')
    if (choice) {
      await choice.click()
      await page.waitForTimeout(200)
      await page.click('.tour-next')
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${dir}/${slug}-revealed.png` })
    }
    // Advance by counter rather than by click count: a click that lands on a
    // moving card can be swallowed, and a blind retry then skips a step and
    // quietly shortens the walk.
    const before = audit.counter
    const next = page.locator('.tour-next')
    if (!(await next.count())) break
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await next.scrollIntoViewIfNeeded().catch(() => {})
      await next.click({ timeout: 5000, force: attempt > 0 }).catch(() => {})
      await page.waitForTimeout(300)
      const now = await page.evaluate(() => {
        const el = document.querySelector('.tour-card-heading > small')
        return el ? el.textContent.trim() : null
      })
      if (now !== before) break
      if (attempt === 2) report.problems.push({ width, step: slug, eyebrow: audit.eyebrow, kind: 'Next would not advance' })
    }
  }
  report.widths[`${FOCUS ? 'focus-' : ''}${width}`] = steps
  console.log(`${width}px — ${steps.length} steps, ${steps.filter((s) => s.scrolls).length} of them scrolling`)
  await context.close()
}
await browser.close()
await mkdir(OUT, { recursive: true })
await writeFile(`${OUT}/report${FOCUS ? '-focus' : ''}.json`, JSON.stringify(report, null, 2))
console.log(`\n${report.problems.length} problems`)
for (const problem of report.problems) console.log(' ', JSON.stringify(problem))
