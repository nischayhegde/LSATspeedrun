#!/usr/bin/env node
/**
 * Where the deck's text is being cut off, and by how much.
 *
 * The founders' complaint that keeps coming back is a credit line clipped
 * mid-glyph, and it keeps coming back because every previous fix nudged one
 * measure on one slide by eye. This measures instead: for every text-bearing
 * element on every slide, at whatever viewport it is pointed at, it walks up to
 * the nearest ancestor that clips (`overflow` other than `visible`) and reports
 * how far the element's ink box escapes it.
 *
 * Ink box, not layout box. A line box is taller than the glyphs it holds, so an
 * element whose border box pokes two pixels below a clip is usually fine and one
 * whose descenders do is not. `Range.getClientRects()` over the text node gives
 * the box the browser will actually paint into, and the last descender sits at
 * roughly the bottom of it — near enough that a threshold of a few pixels
 * separates "clipped" from "close".
 *
 *     node scripts/measure-clipping.mjs --width=1920 --height=1080
 *     node scripts/measure-clipping.mjs --width=1366 --height=768
 *
 * Exits non-zero when anything is actually clipped, so it can gate a change.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flags = new Map()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (match) flags.set(match[1], match[2] ?? '')
}

const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
const WIDTH = Number(flags.get('width') || 1920)
const HEIGHT = Number(flags.get('height') || 1080)
/* Long enough for the slowest figure in the deck. `cohort-split` reaches its
   last phase at 2260ms and then runs a 1250ms width transition on top of it,
   so anything under about four seconds measures a figure mid-animation and
   reports rows that are not on screen yet as if they fit. */
const SETTLE = Number(flags.get('settle') || 5000)
const OUT = flags.get('out') || null
/** Past this much escape from a clipping box, a string is being cut. */
const CLIPPED_PX = 1.5
/**
 * "Near" is a vertical measure only, and that is not a shortcut.
 *
 * Almost every figure is written to fill its stage edge to edge, so the left
 * and right of a full-width row sit at exactly 0.0 from the clip by design —
 * reporting those buried the real findings under about sixty lines of noise per
 * sweep. Vertical flushness is the opposite: it is where the descender bug
 * lives, and a line box with under 4px under it is one font substitution away
 * from the founder's screenshot. Horizontal escape is still reported, but only
 * once it is actually escaping.
 */
const NEAR_PX = 4
/** An escape smaller than this is a rounding artefact, not a finding. */
const ESCAPE_EPSILON = 0.25

const SLIDES = flags.get('slides')

const probeSlides = async (page) => {
  const list = await page.evaluate(async () => {
    const module = await import('/src/slides/index.ts')
    return module.SLIDES.map((slide) => slide.id)
  })
  return list
}

/**
 * Runs inside the page. Returns one record per text run that escapes a clipping
 * ancestor, or comes within `near` of doing so.
 */
const MEASURE = ({ clipped, near, epsilon }) => {
  const results = []
  const clips = (style, axis) => {
    const value = axis === 'y' ? style.overflowY : style.overflowX
    return value !== 'visible'
  }

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.nodeValue || !child.nodeValue.trim()) continue
        const parent = child.parentElement
        if (!parent) continue
        const parentStyle = getComputedStyle(parent)
        if (parentStyle.visibility === 'hidden' || parentStyle.display === 'none') continue
        // Screen-reader-only text is deliberately clipped to a 1px box, and the
        // deck sets that on the list rather than on the item — `.fragments`
        // under the one-slide-one-reading rule in `deck.css`. So the whole
        // ancestor chain has to be asked, not just the text's own parent.
        let hiddenForReaders = false
        for (let el = parent; el && el !== document.documentElement; el = el.parentElement) {
          if (getComputedStyle(el).clipPath !== 'none') { hiddenForReaders = true; break }
        }
        if (hiddenForReaders) continue

        const range = document.createRange()
        range.selectNodeContents(child)
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
        range.detach?.()
        if (!rects.length) continue

        // The nearest clipping ancestors, and the tightest box they impose.
        let box = null
        let clipper = null
        for (let el = parent; el && el !== document.documentElement; el = el.parentElement) {
          const style = getComputedStyle(el)
          const hidesY = clips(style, 'y')
          const hidesX = clips(style, 'x')
          if (!hidesY && !hidesX) continue
          const rect = el.getBoundingClientRect()
          const limit = {
            top: hidesY ? rect.top : -Infinity,
            bottom: hidesY ? rect.bottom : Infinity,
            left: hidesX ? rect.left : -Infinity,
            right: hidesX ? rect.right : Infinity,
          }
          if (!box) { box = limit; clipper = el }
          else {
            box = {
              top: Math.max(box.top, limit.top),
              bottom: Math.min(box.bottom, limit.bottom),
              left: Math.max(box.left, limit.left),
              right: Math.min(box.right, limit.right),
            }
          }
        }
        // The viewport clips too, and a string off the bottom of the stage is
        // as invisible as one under an `overflow: hidden`.
        const viewport = { top: 0, bottom: innerHeight, left: 0, right: innerWidth }
        if (!box) { box = viewport; clipper = document.body }
        else {
          box = {
            top: Math.max(box.top, viewport.top),
            bottom: Math.min(box.bottom, viewport.bottom),
            left: Math.max(box.left, viewport.left),
            right: Math.min(box.right, viewport.right),
          }
        }

        for (const rect of rects) {
          const over = {
            top: box.top - rect.top,
            bottom: rect.bottom - box.bottom,
            left: box.left - rect.left,
            right: rect.right - box.right,
          }
          const worst = Math.max(over.top, over.bottom, over.left, over.right)
          // Escaping on any axis, or running out of room above or below.
          const escaping = worst > epsilon
          // Flush at top *and* bottom is a box sized to its own line — a demo
          // title bar, a chip, a plate. It is not tight, it is exact, and the
          // ink of the glyphs sits inside the line box it is measured against.
          const exact = Math.abs(over.top) <= epsilon && Math.abs(over.bottom) <= epsilon
          const tight = !exact && Math.max(over.top, over.bottom) > -near
          if (!escaping && !tight) continue
          results.push({
            text: child.nodeValue.trim().slice(0, 90),
            selector: `${parent.tagName.toLowerCase()}.${(parent.className || '').toString().split(' ').filter(Boolean).join('.')}`,
            clipper: `${clipper.tagName.toLowerCase()}.${(clipper.className || '').toString().split(' ').filter(Boolean).join('.')}`,
            over: {
              top: Math.round(over.top * 10) / 10,
              bottom: Math.round(over.bottom * 10) / 10,
              left: Math.round(over.left * 10) / 10,
              right: Math.round(over.right * 10) / 10,
            },
            worst: Math.round(worst * 10) / 10,
            state: worst >= clipped ? 'clipped' : 'near',
          })
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const style = getComputedStyle(child)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (Number(style.opacity) === 0) continue
        walk(child)
      }
    }
  }

  const live = document.querySelector('.deck-layer.is-live')
  if (live) walk(live)
  return results
}

/**
 * The cause behind most of what `MEASURE` finds: a figure taller than the
 * stage it is drawn into. `.figure-stage` is a `1fr` grid row with
 * `overflow: hidden`, so a figure that wants more height does not push the
 * credit down — it loses its own last line silently.
 */
const MEASURE_FIT = () => {
  const live = document.querySelector('.deck-layer.is-live')
  if (!live) return []
  const out = []
  for (const stage of live.querySelectorAll('.figure-stage')) {
    const child = stage.querySelector(':scope > .fig')
    if (!child) continue
    const stageBox = stage.getBoundingClientRect()
    // The union of what the figure paints, which is the number the fit guard
    // in `figures/kit.tsx` acts on. An element that clips bounds its own
    // subtree, exactly as the guard treats it.
    let top = Infinity
    let bottom = -Infinity
    const visit = (element) => {
      for (const kid of element.children) {
        const style = getComputedStyle(kid)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (style.clipPath !== 'none') continue
        const rect = kid.getBoundingClientRect()
        if (rect.height > 0) {
          if (rect.top < top) top = rect.top
          if (rect.bottom > bottom) bottom = rect.bottom
        }
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') continue
        visit(kid)
      }
    }
    visit(child)
    const fit = Number(child.dataset.fit || 1)
    const contentHeight = Number.isFinite(top) ? (bottom - top) / fit : 0
    out.push({
      figure: [...child.classList].find((name) => name.startsWith('fig-') && name !== 'fig') ?? 'fig',
      stageHeight: Math.round(stageBox.height),
      contentHeight: Math.round(contentHeight),
      /** Negative is headroom. Positive means the guard is carrying the slide. */
      over: Math.round(contentHeight - stageBox.height),
      fit,
    })
  }
  return out
}

const browser = await launchChromium()
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, reducedMotion: 'no-preference' })

const probe = await context.newPage()
await probe.goto(`${BASE}/?start=0`, { waitUntil: 'domcontentloaded' })
await probe.waitForSelector('.deck-layer.is-live', { timeout: 15000 }).catch(() => {})
const all = await probeSlides(probe)
await probe.close()

const wanted = SLIDES && SLIDES !== 'all' ? SLIDES.split(',').map((s) => s.trim()) : all

const report = []
for (const id of wanted) {
  const page = await context.newPage()
  await page.goto(`${BASE}/?stills=1#/${id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.deck-layer.is-live', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(SETTLE)
  const rows = await page.evaluate(MEASURE, { clipped: CLIPPED_PX, near: NEAR_PX, epsilon: ESCAPE_EPSILON }).catch((error) => [{ text: String(error), state: 'error', worst: 0 }])
  const fit = await page.evaluate(MEASURE_FIT).catch(() => [])
  await page.close()
  const bad = rows.filter((row) => row.state === 'clipped')
  const close = rows.filter((row) => row.state === 'near')
  const overflowing = fit.filter((entry) => entry.over > 0 || entry.fit < 1)
  report.push({ id, clipped: bad, near: close, fit })
  const mark = bad.length ? 'CLIP' : close.length ? 'near' : 'ok  '
  console.log(`  ${mark}  ${id}${bad.length ? `  ${bad.length} clipped` : ''}${close.length ? `  ${close.length} near` : ''}`
    + (overflowing.length ? `  [${overflowing.map((entry) => `${entry.figure} wants ${entry.contentHeight}px of ${entry.stageHeight}px${entry.fit < 1 ? `, scaled to ${entry.fit}` : ''}`).join('; ')}]` : ''))
  for (const row of [...bad, ...close]) {
    console.log(`         ${row.state === 'clipped' ? '✂' : '·'} ${row.worst}px  ${row.selector}  "${row.text}"`)
    console.log(`             inside ${row.clipper}  over: ${JSON.stringify(row.over)}`)
  }
}

await browser.close()

if (OUT) {
  mkdirSync(resolve(DECK_DIR, dirname(OUT)), { recursive: true })
  writeFileSync(resolve(DECK_DIR, OUT), `${JSON.stringify({ viewport: { width: WIDTH, height: HEIGHT }, report }, null, 2)}\n`)
}

const clippedSlides = report.filter((slide) => slide.clipped.length)
console.log(`\n${WIDTH}x${HEIGHT}: ${clippedSlides.length} slide(s) with clipped text, ${report.filter((s) => s.near.length).length} with text within ${NEAR_PX}px of a clip.`)
if (clippedSlides.length) process.exit(1)
