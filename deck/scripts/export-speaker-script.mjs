#!/usr/bin/env node
/**
 * Export the investor-deck spoken script to PPTX + DOCX.
 *
 * Source of truth: `notes` on each slide in `src/slides/index.ts`, processed
 * the same way as `spokenNotes()` (everything after `⟢` is stripped).
 * Slides whose spoken remainder is empty are omitted; remaining slides are
 * numbered 1…N in registry order.
 *
 *   node scripts/export-speaker-script.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const deckRoot = path.resolve(here, '..')
const repoRoot = path.resolve(deckRoot, '..')
const sourcePath = path.join(deckRoot, 'src/slides/index.ts')
const pyScript = path.join(here, 'export-speaker-script.py')
const outDir = path.join(deckRoot, 'export')

const sourceText = fs.readFileSync(sourcePath, 'utf8')

const slidePattern =
  /^[ \t]{4}id:\s*(['"])(?<id>.*?)\1[\s\S]*?^[ \t]{4}notes:\s*(?<notes>[\s\S]*?),\s*^[ \t]{4}speaker:\s*(['"])(?<speaker>.*?)\4,[\s\S]*?^[ \t]{4}budgetSeconds:\s*(?<budget>\d+)/gmu

const FALLBACK = 'No spoken script for this slide.'

function spokenNotes(notes) {
  if (!notes) return ''
  return notes.split(/\s+⟢/u, 1)[0].trim()
}

const registry = [...sourceText.matchAll(slidePattern)].map((match, index) => {
  const id = match.groups.id
  const notes = Function(`"use strict"; return (${match.groups.notes})`)()
  const headlineRaw = match[0].match(/^[ \t]{4}headline:\s*([\s\S]*?),$/m)?.[1]
  if (!headlineRaw) throw new Error(`Could not read headline for ${id}`)
  const headline = Function(`"use strict"; return (${headlineRaw})`)()
  return {
    originalIndex: index + 1,
    id,
    headline,
    speaker: match.groups.speaker,
    spoken: spokenNotes(notes),
  }
})

if (registry.length !== 23) {
  throw new Error(`Expected 23 deck slides, found ${registry.length}`)
}

const spokenSlides = registry
  .filter((slide) => slide.spoken && slide.spoken !== FALLBACK)
  .map((slide, index) => ({
    pptxIndex: index + 1,
    originalIndex: slide.originalIndex,
    id: slide.id,
    headline: slide.headline,
    speaker: slide.speaker,
    spoken: slide.spoken,
  }))

if (!spokenSlides.length) throw new Error('No spoken slides after stripping caveats')

const payload = {
  title: 'Lawyer Tycoon — spoken script',
  deckSlides: registry.length,
  spokenCount: spokenSlides.length,
  slides: spokenSlides,
}

fs.mkdirSync(outDir, { recursive: true })
const jsonPath = path.join(outDir, 'speaker-script.json')
fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`)

const pythonCandidates = [
  path.join(repoRoot, '.venv/bin/python'),
  'python3',
]
const python = pythonCandidates.find((candidate) => {
  if (candidate === 'python3') return true
  return fs.existsSync(candidate)
})

const result = spawnSync(python, [pyScript, jsonPath, outDir], {
  cwd: deckRoot,
  stdio: 'inherit',
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
fs.unlinkSync(jsonPath)

const pptxPath = path.join(outDir, 'speaker-script.pptx')
const downloadsPptx = path.join(os.homedir(), 'Downloads', 'speaker-script.pptx')
fs.copyFileSync(pptxPath, downloadsPptx)

console.log(`\nSpoken slides: ${spokenSlides.length} of ${registry.length} deck slides`)
console.log(`Copied to ${downloadsPptx}`)
for (const slide of spokenSlides) {
  console.log(
    `PPTX ${slide.pptxIndex} = deck id ${slide.id} (original index ${slide.originalIndex}) — ${slide.headline}`,
  )
}
