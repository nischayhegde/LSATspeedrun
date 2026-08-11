#!/usr/bin/env node
/**
 * How much of the projected screen does the demo actually occupy?
 *
 *     cd deck && node scripts/measure-embed.mjs
 *
 * The founders' complaint was "iframes should take up half, if not more of the
 * viewport, and right now they are not being loaded in correctly (there's a lot of
 * white space)". White space has three possible sources and they need different
 * fixes, so this measures all three separately rather than eyeballing a screenshot:
 *
 * 1. **The slot** — how much of the viewport the slide's layout gives the demo.
 * 2. **The frame inside the slot** — letterboxing, when the 16:9 iframe cannot fill
 *    a slot of a different shape.
 * 3. **The app inside the frame** — the app's own margins and max-widths, which no
 *    amount of deck layout can fix.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = 'http://localhost:5173'
const BASE = 'http://localhost:5180'
const OUT = resolve(DECK_DIR, '.deck-shots/measure')
mkdirSync(OUT, { recursive: true })

const SLIDES = ['demo-case-answer', 'demo-case-verdict-review', 'demo-mega-litigation', 'demo-office-transformation', 'demo-map-and-firm']

const browser = await launchChromium()
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await context.newPage()

const rows = []
for (const id of SLIDES) {
  await page.goto(`${BASE}/#/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.demo-stage-frame', { timeout: 20000 }).catch(() => undefined)
  await page.waitForTimeout(6000)

  const outer = await page.evaluate(() => {
    const frame = document.querySelector('.demo-stage-frame')
    const slot = document.querySelector('.demo-slot, .demo-frame, [data-demo-slot]')
    const vw = window.innerWidth
    const vh = window.innerHeight
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }
    }
    return {
      viewport: { w: vw, h: vh },
      frame: box(frame),
      slot: box(slot),
      // What the frame is actually scaled to, which is what the audience reads.
      transform: frame ? window.getComputedStyle(frame).transform : null,
      logical: frame ? { w: parseFloat(frame.style.width), h: parseFloat(frame.style.height) } : null,
    }
  })

  const embedFrame = page.frames().find((f) => f.url().startsWith(APP) && !f.url().includes('deck-warm'))
  const inner = embedFrame
    ? await embedFrame.evaluate(() => {
      const vw = window.innerWidth
      // The widest block the app paints its content into, and the gap either side.
      const main = document.querySelector('main, .app-main, .page, #root > div')
      const r = main?.getBoundingClientRect()
      const body = document.body.getBoundingClientRect()
      return {
        appViewport: { w: vw, h: window.innerHeight },
        content: r ? { w: Math.round(r.width), x: Math.round(r.x) } : null,
        bodyHeight: Math.round(body.height),
        scrollHeight: document.documentElement.scrollHeight,
        // Anything painted at the very top-left corner? A white page has nothing.
        bg: window.getComputedStyle(document.body).backgroundColor,
      }
    }).catch(() => null)
    : null

  const painted = outer.frame ? (outer.frame.w * outer.frame.h) / (outer.viewport.w * outer.viewport.h) : 0
  rows.push({ id, ...outer, inner, share: Math.round(painted * 1000) / 10 })

  console.log(`\n${id}`)
  console.log(`  viewport      ${outer.viewport.w}x${outer.viewport.h}`)
  console.log(`  painted frame ${outer.frame ? `${outer.frame.w}x${outer.frame.h} at (${outer.frame.x},${outer.frame.y})` : 'none'}`)
  console.log(`  logical size  ${outer.logical ? `${outer.logical.w}x${outer.logical.h}` : 'n/a'}  ${outer.transform}`)
  console.log(`  share of screen  ${rows.at(-1).share}%`)
  if (inner) {
    const margin = inner.content ? inner.appViewport.w - inner.content.w : null
    console.log(`  app viewport  ${inner.appViewport.w}x${inner.appViewport.h}, content ${inner.content ? `${inner.content.w}px wide, ${margin}px of its own margin` : 'unknown'}`)
    console.log(`  app scroll    ${inner.scrollHeight}px in a ${inner.appViewport.h}px frame`)
  }
  await page.screenshot({ path: resolve(OUT, `${id}.png`) })
}

await browser.close()
writeFileSync(resolve(OUT, 'report.json'), `${JSON.stringify(rows, null, 2)}\n`)
console.log(`\nwrote ${OUT}`)
