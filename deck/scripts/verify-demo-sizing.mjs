#!/usr/bin/env node
/**
 * Measures whether the app actually fits the frame each demo slide gives it.
 *
 *     cd deck && node scripts/verify-demo-sizing.mjs
 *
 * "Properly sized" is four separate claims and a screenshot only tests the first
 * one badly, so each is measured from inside:
 *
 *   1. **Registered.** The hoisted embed's rect matches the slot it fills, to the
 *      pixel. If it does not, a sliver of the plate underneath shows along an
 *      edge and the whole hoisting trick becomes visible.
 *   2. **Not clipped.** The app's own `scrollWidth` fits its viewport. This is the
 *      one that was silently wrong: the app is a desktop layout with a minimum
 *      comfortable width, and a slide asking for heavy magnification hands it a
 *      logical viewport narrower than that, so the right-hand column of the
 *      dashboard was being cut off the edge of the frame. A screenshot of it looks
 *      like a design decision.
 *   3. **Not scrolling horizontally.** Vertical scroll is normal for a long page
 *      and is reported rather than failed; a horizontal scrollbar in a demo is an
 *      admission that the audience is not seeing all of it.
 *   4. **Legible.** The app's own body text as a fraction of the projected image
 *      height. Resolution-independent by construction, because the slot is sized
 *      in the deck's stage unit — so one number covers every projector in every
 *      room and there is nothing to re-measure per venue.
 *
 * With `--required` it also reports the app's *required* width per route — the
 * narrowest viewport at which that route stops overflowing — which is where the
 * clamp in `demo/demo-stage.tsx` comes from. It is off by default because it
 * costs ten page loads per route.
 *
 * ## Why nothing here is pinned to a pixel of the app
 *
 * The founders are developing the app while the deck is being built, and the game
 * screens — office, map, firm — change the most. So every assertion is a property
 * that has to hold whatever the app renders, never a position or a reference
 * image:
 *
 *   - overflow is `scrollWidth` against `clientWidth`, so it is true of any layout
 *   - legibility is the app's own computed body font size times the composed
 *     scale, so it follows the app's type scale rather than restating it
 *   - registration compares the embed to *the deck's own slot*, both of which the
 *     deck owns; it says nothing about the app
 *   - the route check is "did it load and is it not the login screen"
 *
 * There is deliberately no screenshot comparison. The captures are written for a
 * human to look at and are never diffed, because a diff against a moving app is a
 * test that fails for the wrong reason and then gets ignored.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flags = new Map(process.argv.slice(2).map((raw) => {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`verify-demo-sizing: unrecognised argument "${raw}"`); process.exit(2) }
  return [match[1], match[2] ?? '']
}))
const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const EMAIL = flags.get('email') || 'student@localhost.test'
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots/sizing')
mkdirSync(OUT, { recursive: true })

/** Every demo slide, in deck order. Discovered rather than hardcoded. */
const SLIDE_IDS = (flags.get('slides') || '').split(',').filter(Boolean)

const problems = []
const rows = []
const fail = (text) => { problems.push(text); console.error(`    \u2717 ${text}`) }
const ok = (text) => console.log(`    \u2713 ${text}`)

const browser = await launchChromium()
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
{
  const response = await context.request.post(`${APP}/v1/auth/dev`, { data: { email: EMAIL } })
  if (!response.ok()) {
    console.error(`verify-demo-sizing: could not sign in (${response.status()}). Is the backend up with DEV_AUTH_ENABLED=true?`)
    await browser.close()
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------
// What the app itself needs, per route, independent of the deck
// ---------------------------------------------------------------------------
/**
 * The narrowest viewport at which a route stops overflowing horizontally.
 *
 * Measured by walking the viewport width down until `scrollWidth` exceeds
 * `clientWidth`, in the app on its own with no deck around it. This is a property
 * of the app, not of the deck, and it is the number the deck has to respect.
 */
async function requiredWidth(route) {
  const page = await context.newPage()
  const widths = [1600, 1500, 1440, 1400, 1360, 1320, 1280, 1200, 1120, 1024]
  let narrowest = null
  for (const width of widths) {
    await page.setViewportSize({ width, height: Math.round(width / 1.6) })
    await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1200)
    const fits = await page.evaluate(() => {
      const root = document.documentElement
      return root.scrollWidth <= root.clientWidth + 1
    })
    if (fits) narrowest = width
    else break
  }
  await page.close()
  return narrowest
}

// ---------------------------------------------------------------------------
// discover the demo slides
// ---------------------------------------------------------------------------
const probe = await context.newPage()
await probe.goto(`${BASE}/?start=0`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await probe.waitForSelector('.deck-layer.is-live', { timeout: 20000 })
await probe.keyboard.press('g')
await probe.waitForSelector('.grid-overview', { timeout: 8000 }).catch(() => undefined)
const all = await probe.evaluate(() => Array.from(document.querySelectorAll('.grid-tile'))
  .map((tile) => tile.textContent?.match(/#\/([a-z0-9-]+)/)?.[1] ?? null)
  .filter(Boolean))
await probe.close()
const ids = (SLIDE_IDS.length ? SLIDE_IDS : all).filter((id) => /^demo-/.test(id))
console.log(`verify-demo-sizing: ${ids.length} demo slides\n`)

// ---------------------------------------------------------------------------
// measure each
// ---------------------------------------------------------------------------
for (const id of ids) {
  console.log(`  ${id}`)
  const page = await context.newPage()
  await page.goto(`${BASE}/#/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const mounted = await page.waitForSelector('.demo-stage-frame', { timeout: 20000 }).then(() => true).catch(() => false)
  if (!mounted) {
    // Not necessarily a failure any more. A `stillOnly` slide deliberately has no
    // live embed — `demo-focus-mode` was cut to a still so it costs no load and
    // cannot fail — so the absence of a frame has to be told apart from the app
    // being down. The lamp is exactly that distinction, already computed by
    // `describeSurface`: "stills" is a choice, "app not running" is a fault. It is
    // presenter-only chrome, so ask for it with `?hud`.
    await page.goto(`${BASE}/?hud#/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)
    const fallback = await page.evaluate(() => {
      const image = document.querySelector('.demo-still')
      const slot = document.querySelector('.deck-layer.is-live .demo-screen')?.getBoundingClientRect()
      const box = image?.getBoundingClientRect()
      return {
        lamp: document.querySelector('.demo-lamp')?.textContent ?? null,
        src: image?.getAttribute('src') ?? null,
        loaded: image ? image.naturalWidth > 0 : false,
        pictureAspect: image && image.naturalWidth ? image.naturalWidth / image.naturalHeight : null,
        boxAspect: box && box.height ? box.width / box.height : null,
        fit: image ? getComputedStyle(image).objectFit : null,
        box: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
        coversSlot: box && slot
          ? Math.abs(box.width - slot.width) <= 2 && Math.abs(box.height - slot.height) <= 2
          : false,
      }
    })

    if (fallback.lamp !== 'stills') {
      fail(`${id}: no live embed mounted and the lamp reads "${fallback.lamp}", `
        + 'so this is the app being unreachable rather than a slide that wanted a still')
    } else if (!fallback.src) {
      fail(`${id}: a stills-only slide with no still painted`)
    } else if (!fallback.loaded) {
      fail(`${id}: the still ${fallback.src} did not load — is the file in deck/public/stills?`)
    } else {
      ok(`${id}: stills-only by design, showing ${fallback.src}`)
      if (!fallback.coversSlot) fail(`${id}: the still does not fill its slot`)
      else ok(`${id}: the still fills its slot`)

      // `object-fit: contain` is what makes this safe: the picture keeps its own
      // shape and the slot letterboxes around it, so the still can never appear
      // stretched. Assert the contract rather than comparing the picture's aspect
      // to the box's, which differ by design and say nothing about distortion.
      if (fallback.fit !== 'contain') {
        fail(`${id}: the still is painted with object-fit: ${fallback.fit}, so a picture `
          + 'whose shape differs from the slot will be stretched rather than letterboxed')
      } else {
        ok(`${id}: painted with object-fit: contain, so it cannot be distorted`)
      }

      // Stills are captured 16:9 on purpose — `recapture-stills.mjs` lays the app
      // out at 1152x648 and scales to projector-native 1920x1080. The slot is a
      // little taller than that, so a few pixels of letterbox are expected. A
      // picture far off 16:9 is a file that did not come from that pipeline.
      const aspect = fallback.pictureAspect ?? 0
      const bars = fallback.box && aspect ? Math.round(fallback.box.h - fallback.box.w / aspect) : 0
      if (Math.abs(aspect - 16 / 9) > 0.05) {
        fail(`${id}: the still is ${aspect.toFixed(3)}:1, not the 16:9 the capture pipeline `
          + 'produces. Re-run `node scripts/recapture-stills.mjs` rather than hand-cropping.')
      } else {
        console.log(`    \u00b7 ${id}: 16:9 picture in a ${fallback.boxAspect?.toFixed(3)}:1 slot — `
          + `${bars}px of letterbox, as the capture size implies`)
      }
    }
    rows.push({ id, stillOnly: true, ...fallback })
    await page.screenshot({ path: resolve(OUT, `${id.replace(/^demo-/, '')}.png`) })
    await page.close()
    continue
  }
  await page.waitForTimeout(2600)

  const outer = await page.evaluate(() => {
    const frame = document.querySelector('.demo-stage-frame')
    const host = document.querySelector('.demo-stage')?.getBoundingClientRect()
    const slot = document.querySelector('.deck-layer.is-live .demo-screen')?.getBoundingClientRect()
    const visual = frame?.getBoundingClientRect()
    const style = frame ? getComputedStyle(frame) : null
    return {
      route: frame?.getAttribute('src') ?? null,
      logical: frame ? { w: frame.offsetWidth, h: frame.offsetHeight } : null,
      visual: visual ? { w: Math.round(visual.width), h: Math.round(visual.height) } : null,
      transform: style?.transform ?? null,
      register: host && slot ? {
        dx: Math.round(host.left - slot.left), dy: Math.round(host.top - slot.top),
        dw: Math.round(host.width - slot.width), dh: Math.round(host.height - slot.height),
      } : null,
      // Slack is what is left over on the axis that does not bind — the
      // letterboxing inside the frame's own hole.
      slack: host && visual ? {
        x: Math.round(host.width - visual.width), y: Math.round(host.height - visual.height),
      } : null,
    }
  })

  const embedded = page.frames().find((frame) => frame.url().startsWith(APP) && !frame.url().includes('deck-warm'))
  const inner = embedded ? await embedded.evaluate(() => {
    const root = document.documentElement
    const body = getComputedStyle(document.body)
    return {
      url: window.location.pathname + window.location.search,
      viewport: { w: root.clientWidth, h: root.clientHeight },
      content: { w: root.scrollWidth, h: root.scrollHeight },
      bodyFontPx: Number.parseFloat(body.fontSize),
    }
  }).catch(() => null) : null

  const scale = outer.logical && outer.visual ? outer.visual.w / outer.logical.w : 0
  const row = { id, ...outer, inner, scale: Number(scale.toFixed(4)) }
  rows.push(row)

  if (!inner) {
    fail(`${id}: could not read inside the embed`)
  } else {
    if (/\/login/.test(inner.url)) fail(`${id}: the embed is on the login screen`)

    const overflowX = inner.content.w - inner.viewport.w
    const overflowY = inner.content.h - inner.viewport.h
    if (overflowX > 2) {
      fail(`${id}: the app overflows its frame by ${overflowX}px horizontally `
        + `(needs ${inner.content.w}px, has ${inner.viewport.w}px) — the right of the page is cut off`)
    } else {
      ok(`fits horizontally (${inner.content.w} \u2264 ${inner.viewport.w})`)
    }
    if (overflowY > 2) {
      // Vertical overflow is normal and correct for a long page — the presenter
      // scrolls it. It is only reported.
      console.log(`    \u00b7 ${overflowY}px of page below the fold (scrollable, expected)`)
    }
    // Legibility, as a fraction of the projected image height rather than in
    // pixels. That is the only form of the measurement that means anything: the
    // slot is sized in the deck's stage unit, so this number is identical at
    // 720p, 1080p and 4K, and a threshold in pixels would silently be a
    // threshold about the test's viewport instead of about the deck. Derived
    // from the app's own computed body size so it follows the app's type scale
    // instead of restating it.
    //
    // The floor is 1.3%. The deck's own body copy is 2.67% of image height; app
    // UI text is denser and is being *shown* rather than read, so it does not
    // need to match, but under about 1.3% it stops being readable from the back
    // of a room. The target this deck is tuned to is 1.49% — see DEFAULT_WIDTH
    // in `demo/demo-stage.tsx`. The gap between 1.3 and 1.49 is deliberate
    // margin, so that the app changing its own type scale a little does not turn
    // this red.
    const fraction = (inner.bodyFontPx * scale) / (await page.evaluate(() => window.innerHeight))
    if (fraction < 0.013) {
      fail(`${id}: the app's body text is ${(fraction * 100).toFixed(2)}% of the projected image `
        + `height (floor 1.30%, target 1.49%) — too small to read from the back of a room. `
        + 'Lower DEFAULT_WIDTH in demo/demo-stage.tsx.')
    } else {
      ok(`app body text is ${(fraction * 100).toFixed(2)}% of image height, `
        + `magnified ${scale.toFixed(2)}x from ${inner.viewport.w} logical px`)
    }
    row.textFractionOfImageHeight = Number((fraction * 100).toFixed(3))
  }

  if (outer.register) {
    const worst = Math.max(...Object.values(outer.register).map(Math.abs))
    if (worst > 2) fail(`${id}: embed is ${worst}px out of register with its slot ${JSON.stringify(outer.register)}`)
    else ok(`registered on its slot to within ${worst}px`)
  }
  if (outer.slack && (outer.slack.x > 6 || outer.slack.y > 6)) {
    // Letterboxing inside the frame. Not a failure — the slot's proportions come
    // from the slide layout — but worth a number, because a large slack on both
    // axes means the logical size and the slot disagree about shape.
    console.log(`    \u00b7 letterboxed by ${outer.slack.x}px x ${outer.slack.y}px inside the slot`)
  }

  await page.screenshot({ path: resolve(OUT, `${id}.png`) })
  await page.close()
}

// ---------------------------------------------------------------------------
// what the app needs, for the routes that failed to fit
// ---------------------------------------------------------------------------
const routes = flags.has('required')
  ? [...new Set(rows
    .filter((row) => row.inner && row.inner.content.w - row.inner.viewport.w > 2)
    .map((row) => row.inner.url))]
  : []
if (routes.length) {
  console.log('\n  the app\'s own minimum widths, measured without the deck:')
  for (const route of routes) {
    const width = await requiredWidth(route)
    console.log(`    ${route} needs at least ${width ?? '>1600'}px`)
    rows.push({ id: `__required:${route}`, requiredWidth: width })
  }
}

await browser.close()
writeFileSync(resolve(OUT, 'report.json'), `${JSON.stringify({ base: BASE, app: APP, when: new Date().toISOString(), problems, rows }, null, 2)}\n`)
console.log(`\n${problems.length ? `${problems.length} problem(s)` : 'all demo embeds are correctly sized'} \u2014 ${OUT}`)
process.exit(problems.length ? 1 : 0)
