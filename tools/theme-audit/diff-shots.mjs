/**
 * Which of the before/after pairs actually moved, and by how much.
 *
 * A theme sweep touching shared sheets can change screens nobody meant to
 * touch, so every pair is compared rather than only the ones expected to
 * differ. Pixels are compared with a small per-channel tolerance because
 * text antialiasing differs run to run.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const DIR = new URL('../../.theme-audit', import.meta.url).pathname
const before = new Set(readdirSync(`${DIR}/before`).filter((f) => f.endsWith('.png')))
const after = new Set(readdirSync(`${DIR}/after`).filter((f) => f.endsWith('.png')))

const rows = []
for (const name of [...before].sort()) {
  if (!after.has(name)) { rows.push([name, 'missing-after', 0]); continue }
  const a = PNG.sync.read(readFileSync(`${DIR}/before/${name}`))
  const b = PNG.sync.read(readFileSync(`${DIR}/after/${name}`))
  if (a.width !== b.width || a.height !== b.height) { rows.push([name, 'size-changed', 0]); continue }
  let changed = 0
  let minY = Infinity
  let maxY = -1
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
    if (d <= 12) continue
    changed++
    const y = Math.floor(i / 4 / a.width)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const pct = (changed / (a.width * a.height)) * 100
  rows.push([name, pct < 0.01 ? 'same' : `${pct.toFixed(2)}%`, changed, changed ? `y ${minY}-${maxY}` : ''])
}

rows.sort((x, y) => (y[2] || 0) - (x[2] || 0))
for (const [name, verdict, , span] of rows) {
  console.log(`${name.padEnd(30)} ${String(verdict).padEnd(14)} ${span || ''}`)
}
writeFileSync(`${DIR}/diff.json`, JSON.stringify(rows, null, 2))
