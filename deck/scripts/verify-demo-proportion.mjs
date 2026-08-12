#!/usr/bin/env node
/**
 * How big the embed is, and whether it is where it claims to be — at more than
 * one screen size.
 *
 *     cd deck && node scripts/verify-demo-proportion.mjs
 *     cd deck && node scripts/verify-demo-proportion.mjs --sizes=1366x768
 *
 * This exists because of what one screen size hides.
 *
 * `verify-demo-sizing.mjs` measures the embed thoroughly and passes everything,
 * and `measure-embed.mjs` reports its share of the screen — both at 1920x1080,
 * hardcoded, and only there. Underneath that, until the commit this script
 * arrived with, the embed was not centred on its slot at all. It is laid out at
 * a *logical* width (1250px on the case slide, 1321 elsewhere) and then scaled
 * to fit, so whenever the slot is narrower than that number the element is
 * wider than the box it is absolutely positioned in — and `inset: 0; margin:
 * auto` does not centre an over-constrained absolutely positioned box. CSS 2.1
 * 10.3.7 zeroes the left margin and lets it hang off the right instead.
 *
 * Measured on `demo-mega-litigation` before the fix: 134px right of its slot at
 * 1366x768, 28px at 1600x900, and — this is the part that matters — 0px at
 * 1920x1080, where the logical 1250 finally fits inside the 1482px slot and
 * `margin: auto` works properly. So a defect that put a band of the app's cream
 * background down one edge of the screen and clipped the dashboard's right-hand
 * column off the other was invisible at exactly the one resolution anybody
 * measured, and 1366x768 and 1600x900 are what conference projectors and laptop
 * lids actually are.
 *
 * Hence: every demo slide, at four sizes, asserting two things a single-size
 * check cannot see.
 *
 *   - **Centred.** The painted frame's centre against its slot's centre, within
 *     1px. This is the regression test for the above.
 *   - **Uncut.** The painted frame inside its slot's bounds. The slot clips with
 *     `overflow: hidden`, so anything outside it is not letterboxed, it is gone.
 *
 * And it reports rather than asserts three numbers: the frame's share of the
 * viewport by area, and — the two the founders actually asked about — its width
 * and height each as a percentage of the viewport's. Reported and not failed
 * because it is a judgement about a slide's layout, and this script is not the
 * place to legislate it. A number per size, in a table, is the useful form.
 *
 * The two axes are separate columns because they fail separately, and the
 * founders' complaint was axial: *"no vertical bars — have it take full viewport
 * height."* An area share cannot tell letterboxing from a narrow slot. 100% of
 * the height with 78% of the width is a slide with bars down the sides; the
 * reverse is the one that was on screen.
 *
 * ## Running it with no app stack
 *
 * `--stills` appends `?stills=1` and skips the sign-in, so the whole sweep runs
 * against the deck alone. Every demo slide then paints its captured frame, and
 * the still is painted into the same slot the live embed is positioned over — so
 * the *geometry* being measured is the same geometry, which is what makes this
 * usable on a machine that cannot run the product.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flags = new Map(process.argv.slice(2).map((raw) => {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`verify-demo-proportion: unrecognised argument "${raw}"`); process.exit(2) }
  return [match[1], match[2] ?? '']
}))
const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const EMAIL = flags.get('email') || 'student@localhost.test'
const STILLS = flags.has('stills')
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots/proportion')
mkdirSync(OUT, { recursive: true })

/**
 * The four sizes, and why these four.
 *
 * 1920x1080 is the reference and the one everything else was checked at.
 * 1600x900 and 1366x768 are the two most common projector and laptop-lid modes,
 * and are where the centring defect actually showed. 2560x1440 is the other
 * direction — a large external display, where the slot grows past the logical
 * width and the scale clamps, which is the case that can letterbox instead.
 */
const SIZES = (flags.get('sizes') || '1920x1080,1600x900,1366x768,2560x1440')
  .split(',').filter(Boolean)
  .map((raw) => {
    const [w, h] = raw.split('x').map(Number)
    if (!w || !h) { console.error(`verify-demo-proportion: bad size "${raw}"`); process.exit(2) }
    return { w, h }
  })

const problems = []
const rows = []
const fail = (text) => { problems.push(text); console.error(`      \u2717 ${text}`) }

const browser = await launchChromium()
const context = await browser.newContext({
  viewport: { width: SIZES[0].w, height: SIZES[0].h },
  deviceScaleFactor: 1,
})
// Nothing to sign in to in a stills pass: no iframe is mounted, so no cookie has
// to cross an origin. Same reasoning `shoot.mjs` gives for skipping it.
if (!STILLS) {
  const response = await context.request.post(`${APP}/v1/auth/dev`, { data: { email: EMAIL } })
  if (!response.ok()) {
    console.error(`verify-demo-proportion: could not sign in (${response.status()}). Backend up with DEV_AUTH_ENABLED=true?`
      + '\nPass --stills to measure the geometry against the captured frames instead.')
    await browser.close()
    process.exit(2)
  }
}

// The demo slides, discovered from the deck's own grid overview rather than
// listed here, so a slide added or renamed in `slides/index.ts` is covered
// without this file being touched. `measure-embed.mjs` hardcodes five and has
// been missing `demo-clients-walk-in` since it was added.
const QUERY = STILLS ? '?stills=1' : ''

const probe = await context.newPage()
await probe.goto(`${BASE}/?start=0`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await probe.waitForSelector('.deck-layer.is-live', { timeout: 20000 })
await probe.keyboard.press('g')
await probe.waitForSelector('.grid-overview', { timeout: 8000 }).catch(() => undefined)
const ids = (await probe.evaluate(() => Array.from(document.querySelectorAll('.grid-tile'))
  .map((tile) => tile.textContent?.match(/#\/([a-z0-9-]+)/)?.[1] ?? null)
  .filter(Boolean))).filter((id) => /^demo-/.test(id))
await probe.close()

for (const size of SIZES) {
  console.log(`\n${size.w}x${size.h}`)
  const page = await context.newPage()
  await page.setViewportSize({ width: size.w, height: size.h })

  for (const id of ids) {
    await page.goto(`${BASE}/${QUERY}#/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const live = await page.waitForSelector('.demo-stage-frame', { timeout: STILLS ? 1200 : 15000 })
      .then(() => true).catch(() => false)
    // Long enough for the app inside to paint and for the stage's own
    // ResizeObserver to settle on the new viewport; the scale is computed from
    // a measured rect, so reading it too early reads the previous size.
    await page.waitForTimeout(live ? 2600 : 1400)

    const seen = await page.evaluate(() => {
      const centre = (r) => (r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null)
      const round = (r) => (r ? {
        x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
      } : null)
      const frame = document.querySelector('.demo-stage-frame')
      // The still stands in for the frame on a stills-only slide; the same two
      // questions apply to it, and it is painted into the same slot.
      const still = document.querySelector('.demo-still')
      const painted = frame || still
      const slot = document.querySelector('.deck-layer.is-live .demo-screen')
      /**
       * What the audience sees, which for a still is not the element's box.
       *
       * `.demo-still` is `inset: 0` with `object-fit: contain`, so its border box
       * is the slot's box whatever the picture's shape — and every still in
       * `public/stills/` is a 16:9 capture. Measuring the box therefore reported
       * a still as filling a slot it was letterboxed inside, which is exactly the
       * band the founders are pointing at. The content rect is derived from the
       * intrinsic size the same way `contain` derives it.
       */
      const contentRect = (element, rect) => {
        if (!rect || !(element instanceof HTMLImageElement)) return rect
        const nw = element.naturalWidth
        const nh = element.naturalHeight
        if (!nw || !nh) return rect
        const fit = Math.min(rect.width / nw, rect.height / nh)
        const w = nw * fit
        const h = nh * fit
        return new DOMRect(rect.left + (rect.width - w) / 2, rect.top + (rect.height - h) / 2, w, h)
      }
      const slotRect = slot?.getBoundingClientRect()
      const paintedRect = contentRect(painted, painted?.getBoundingClientRect())
      const pc = centre(paintedRect)
      const sc = centre(slotRect)
      return {
        kind: frame ? 'iframe' : still ? 'still' : 'none',
        painted: round(paintedRect),
        slot: round(slotRect),
        offset: pc && sc ? { x: Math.round(pc.x - sc.x), y: Math.round(pc.y - sc.y) } : null,
        // Positive on any edge means that much of the app is outside the slot,
        // and the slot clips, so that much is simply not on the screen.
        cut: paintedRect && slotRect ? {
          left: Math.round(slotRect.left - paintedRect.left),
          right: Math.round(paintedRect.right - slotRect.right),
          top: Math.round(slotRect.top - paintedRect.top),
          bottom: Math.round(paintedRect.bottom - slotRect.bottom),
        } : null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
      }
    })

    if (seen.kind === 'none') { fail(`${id}: nothing painted in the slot`); continue }
    const share = seen.painted
      ? (seen.painted.w * seen.painted.h) / (seen.viewport.w * seen.viewport.h)
      : 0
    const pct = (share * 100).toFixed(1)
    // The two axes, which is what "full viewport height" is a claim about.
    const wide = ((seen.painted.w / seen.viewport.w) * 100).toFixed(1)
    const tall = ((seen.painted.h / seen.viewport.h) * 100).toFixed(1)
    rows.push({
      size: `${size.w}x${size.h}`,
      id,
      ...seen,
      share: Number(pct),
      widthPct: Number(wide),
      heightPct: Number(tall),
    })

    console.log(`  ${id.padEnd(28)} ${String(seen.painted.w).padStart(4)}x${String(seen.painted.h).padStart(4)}`
      + `  w ${String(wide).padStart(5)}%  h ${String(tall).padStart(5)}%  area ${String(pct).padStart(5)}%`
      + `  offset ${seen.offset.x >= 0 ? '+' : ''}${seen.offset.x},`
      + `${seen.offset.y >= 0 ? '+' : ''}${seen.offset.y}  (${seen.kind})`)

    // 1px, because the two centres are computed from fractional rects and
    // rounded independently; anything a viewer could see is far larger. The
    // defect this catches was 134px.
    if (Math.abs(seen.offset.x) > 1 || Math.abs(seen.offset.y) > 1) {
      fail(`${id} at ${size.w}x${size.h}: painted ${seen.offset.x}px,${seen.offset.y}px off the centre `
        + 'of its slot, so one edge shows the plate underneath and the opposite edge is clipped')
    }
    const worstCut = seen.cut ? Math.max(seen.cut.left, seen.cut.right, seen.cut.top, seen.cut.bottom) : 0
    if (worstCut > 1) {
      fail(`${id} at ${size.w}x${size.h}: ${worstCut}px of the app falls outside the slot `
        + `${JSON.stringify(seen.cut)} — the slot clips, so that much is not on the screen`)
    }

    await page.screenshot({ path: resolve(OUT, `${size.w}x${size.h}-${id}.png`) })
  }
  await page.close()
}

// The share table, which is the number the founders asked about. Reported per
// slide per size rather than averaged, because "half the viewport" is a claim
// about the worst one.
const table = (label, read) => {
  console.log(`\n${label}, by slide and size`)
  console.log(`  ${['slide'.padEnd(28), ...SIZES.map((s) => `${s.w}x${s.h}`.padStart(12))].join('')}`)
  for (const id of ids) {
    const cells = SIZES.map((s) => {
      const row = rows.find((r) => r.id === id && r.size === `${s.w}x${s.h}`)
      return `${row ? `${read(row)}%` : '-'}`.padStart(12)
    })
    console.log(`  ${id.padEnd(28)}${cells.join('')}`)
  }
}
table('HEIGHT as % of viewport height', (row) => row.heightPct)
table('WIDTH as % of viewport width', (row) => row.widthPct)
table('area share of viewport', (row) => row.share)
const shares = rows.map((r) => r.share)
if (shares.length) {
  const worst = Math.min(...shares)
  console.log(`\n  smallest ${worst}% \u00b7 largest ${Math.max(...shares)}%`
    + `  (the founders asked for "half, if not more")`)
  if (worst < 50) {
    console.log(`  \u00b7 ${rows.filter((r) => r.share < 50).map((r) => `${r.id}@${r.size}`).join(', ')} `
      + 'fall under half. That is a slide-layout question — the slot\'s size — not an '
      + 'embed-fitting one, and it is reported rather than failed here.')
  }
}

await browser.close()
writeFileSync(resolve(OUT, 'report.json'),
  `${JSON.stringify({ base: BASE, when: new Date().toISOString(), sizes: SIZES, problems, rows }, null, 2)}\n`)
console.log(`\n${problems.length ? `${problems.length} problem(s)` : 'every demo embed is centred on its slot and uncut, at every size'} \u2014 ${OUT}`)
process.exit(problems.length ? 1 : 0)
