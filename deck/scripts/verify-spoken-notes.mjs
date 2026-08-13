import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const sourcePath = path.resolve('src/slides/index.ts')
const sourceText = fs.readFileSync(sourcePath, 'utf8')

const slidePattern =
  /^[ \t]{4}id:\s*(['"])(?<id>.*?)\1[\s\S]*?^[ \t]{4}notes:\s*(?<notes>[\s\S]*?),\s*^[ \t]{4}speaker:\s*(['"])(?<speaker>.*?)\4,[\s\S]*?^[ \t]{4}budgetSeconds:\s*(?<budget>\d+)/gmu

const rows = [...sourceText.matchAll(slidePattern)].map((match) => {
  const id = match.groups.id
  const speaker = match.groups.speaker
  const budgetSeconds = Number(match.groups.budget)
  const notes = Function(`"use strict"; return (${match.groups.notes})`)()
  const spoken = notes.split(/\s+⟢/u, 1)[0].trim()
  const words = spoken.match(/\b[\p{L}\p{N}][\p{L}\p{N}’'.,-]*\b/gu)?.length ?? 0
  const capacity = budgetSeconds * (150 / 60)
  const references = spoken.match(/\b(?:LSAC|Dunlosky|VanLehn|Metcalfe|Bastani|Dicheva|Clark)\b/gu) ?? []
  return { id, speaker, budgetSeconds, spoken, words, capacity, references }
})

if (!rows.length) throw new Error('Could not extract any slides')

const issues = []
for (const row of rows) {
  if (!/[.!?]["']?$/u.test(row.spoken)) issues.push(`${row.id}: spoken notes do not end as a sentence`)
}

const totalWords = rows.reduce((sum, row) => sum + row.words, 0)
const totalBudget = rows.reduce((sum, row) => sum + row.budgetSeconds, 0)
const estimatedSeconds = Math.round(totalWords / (150 / 60))
const formatClock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// Revision 11: full script, no runtime cap. Capacity and 5–7 minute gates
// come back on the trim pass.

for (const row of rows) {
  const refs = row.references.length ? ` refs=${[...new Set(row.references)].join(',')}` : ''
  console.log(`${row.id.padEnd(32)} ${String(row.words).padStart(2)}/${String(Math.floor(row.capacity)).padEnd(2)} words  ${row.budgetSeconds}s${refs}`)
}

console.log(`\nSlides: ${rows.length}`)
console.log(`Spoken words: ${totalWords}`)
console.log(`Estimated spoken duration at 150 wpm: ${formatClock(estimatedSeconds)}`)
console.log(`Budgeted presentation duration: ${formatClock(totalBudget)}`)
console.log(`Named research references in spoken copy: ${rows.reduce((sum, row) => sum + row.references.length, 0)}`)

if (issues.length) {
  console.error(`\nIssues:\n- ${issues.join('\n- ')}`)
  process.exitCode = 1
}
