#!/usr/bin/env node
/**
 * The folio, on one backdrop of each kind, cropped to the corner it lives in.
 *
 *     cd deck && node scripts/shoot-folio.mjs
 *
 * A whole-slide capture is the wrong instrument for this: the folio is 150x47 of
 * a 1920x1080 frame, so in anything a human or a review tool actually looks at it
 * is a smudge, and "is it legible" is precisely the question that cannot be
 * answered from a smudge. This crops the bottom-right 520x220 at 2x instead, one
 * file per slide, and writes a strip of the four backdrops the founders asked
 * about: beige field, royal-blue field, 3D scene, full-bleed demo.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(DECK_DIR, process.argv[3] || '.deck-shots/folio-corners')
mkdirSync(OUT, { recursive: true })

const BASE = process.argv[2] || 'http://localhost:5180'
const SLIDES = [
  ['beige-field', 'turn-nothing-to-teach'],
  ['blue-field', 'problem-coaching-tax'],
  ['scene-3d', 'concept-lawyer-tycoon'],
  ['demo-dark', 'demo-case-answer'],
  ['demo-light', 'demo-focus-mode'],
  ['close', 'close-one-stop-shop'],
  ['title', 'title-lawyer-tycoon'],
]

const browser = await launchChromium()
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })

for (const [label, id] of SLIDES) {
  const page = await context.newPage()
  await page.goto(`${BASE}/?stills=1#/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.deck-layer.is-live', { timeout: 20000 })
  await page.waitForTimeout(2400)
  const present = await page.evaluate(() => Boolean(document.querySelector('.deck-folio')))
  await page.screenshot({
    path: resolve(OUT, `${label}-${id}.png`),
    clip: { x: 1400, y: 880, width: 520, height: 200 },
  })
  console.log(`  ${label.padEnd(12)} ${id.padEnd(28)} folio ${present ? 'present' : 'ABSENT'}`)
  await page.close()
}

await browser.close()
console.log(`\n${OUT}`)
