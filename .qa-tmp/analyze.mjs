/**
 * Reads one `route-parity.mjs` report and says whether that route's cold load
 * and its client-side navigation agree.
 *
 * The harness's own `linkOrder` flag compares the two href lists for equality,
 * which always differs: the walk carries whatever sheets the route it started
 * from had loaded. Only a reordering of the sheets *present in both* can move
 * the cascade, so that is what is reported here.
 *
 *   node .qa-tmp/analyze.mjs .qa-tmp/parity/office.json
 */
import fs from 'node:fs'

const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const rows = []

for (const [slot, v] of Object.entries(report.routes || {})) {
  const cold = v.coldLinks || []
  const warm = v.warmLinks || []
  const shared = cold.filter((x) => warm.includes(x))
  const flipped = []
  for (let i = 0; i < shared.length; i += 1) {
    for (let j = i + 1; j < shared.length; j += 1) {
      if (warm.indexOf(shared[i]) > warm.indexOf(shared[j])) {
        flipped.push(`${shared[i].split('/').pop()} before ${shared[j].split('/').pop()}`)
      }
    }
  }
  const d = v.diff
  const missing = cold.filter((x) => !warm.includes(x))
  rows.push({ slot, v, cold, warm, shared, flipped, missing, d })

  console.log(`\n=== ${slot}`)
  console.log(`  landed cold=${v.coldPath}  walk=${v.warmPath}   ${v.note}`)
  console.log(`  sheets: ${cold.length} cold, ${warm.length} walk, ${shared.length} shared, ${missing.length} missing on the walk`)
  if (missing.length) console.log(`    MISSING ON WALK: ${missing.join(', ')}`)
  console.log(`  shared-sheet order: ${flipped.length ? `FLIPPED -> ${flipped.join('; ')}` : 'consistent'}`)
  if (!d) { console.log('  no diff captured (route errored)'); continue }
  console.log(`  structure: ${d.structure ? JSON.stringify(d.structure) : 'same'}  nodes=${v.nodes}`)
  console.log(`  computed-style diffs: ${d.styleDiffs.length}   rect diffs: ${d.rectDiffs.length}`)

  // Which properties differ, and on how many elements, so noise from live data
  // is distinguishable from a cascade change.
  const byProp = new Map()
  for (const s of d.styleDiffs) byProp.set(s.prop, (byProp.get(s.prop) || 0) + 1)
  for (const [p, n] of [...byProp].sort((x, y) => y[1] - x[1]).slice(0, 12)) {
    const ex = d.styleDiffs.find((s) => s.prop === p)
    console.log(`      ${p} x${n}   e.g. .${(ex.cls || '(none)').slice(0, 50)}  cold=${String(ex.cold).slice(0, 40)}  walk=${String(ex.warm).slice(0, 40)}`)
  }
  for (const r of d.rectDiffs.slice(0, 6)) {
    console.log(`      rect .${(r.cls || '(none)').slice(0, 50)}  cold=[${r.cold}]  walk=[${r.warm}]`)
  }
  if (v.console?.length) {
    console.log(`  console (${v.console.length}):`)
    for (const c of v.console.slice(0, 6)) console.log(`      ${c.slice(0, 180)}`)
  }
}

const bad = rows.filter((r) => r.flipped.length || r.missing.length || r.d?.structure || r.d?.styleDiffs.length)
console.log(`\n${bad.length ? `${bad.length} slot(s) need a look` : 'all slots agree'}\n`)
