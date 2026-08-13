#!/usr/bin/env node

import { launchChromium } from './playwright-env.mjs'

const BASE = (process.env.DECK_BASE || 'http://localhost:5180').replace(/\/$/, '')
const EXPECTED_SLIDES = 12

const browser = await launchChromium()
const page = await browser.newPage()

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const registry = await page.evaluate(async () => {
    const module = await import('/src/slides/index.ts')
    return {
      count: module.SLIDES.length,
      seconds: module.TOTAL_BUDGET_SECONDS,
      ids: module.SLIDES.map((slide) => slide.id),
    }
  })

  const duplicateIds = registry.ids.filter((id, index) => registry.ids.indexOf(id) !== index)
  const problems = [
    registry.count === EXPECTED_SLIDES
      ? null
      : `expected ${EXPECTED_SLIDES} slides, found ${registry.count}`,
    duplicateIds.length === 0
      ? null
      : `duplicate slide ids: ${[...new Set(duplicateIds)].join(', ')}`,
  ].filter(Boolean)

  if (problems.length) {
    for (const problem of problems) console.error(`registry: ${problem}`)
    process.exitCode = 1
  } else {
    console.log(`registry: ${registry.count} unique slides, ${registry.seconds}s`)
  }
} finally {
  await browser.close()
}
