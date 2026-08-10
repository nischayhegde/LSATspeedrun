/**
 * Checks that a split moved rules and changed nothing else.
 *
 * Every declaration block in the sheet as it was at HEAD has to appear exactly
 * once across the two sheets that replaced it, under the same selector and the
 * same `@media` chain. That catches a rule dropped by the walk, a rule cloned
 * into both halves, and an `@media` chain rebuilt with the wrong params — the
 * three ways this kind of edit goes wrong quietly.
 *
 *   node tools/css-split/split-verify.mjs styles.css case-session-styles.css
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from '../../frontend/node_modules/postcss/lib/postcss.mjs'

const SRC = 'frontend/src'
const original = process.argv[2]
const parts = process.argv.slice(2)

const chainOf = (rule) => {
  const stack = []
  for (let p = rule.parent; p && p.type === 'atrule'; p = p.parent) stack.unshift(`@${p.name} ${p.params}`)
  return stack.join('||')
}

/** Rule identity: where it applies, what it sets. Whitespace is not identity. */
const fingerprint = (root) => {
  const out = []
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return
    const decls = []
    rule.walkDecls((d) => decls.push(`${d.prop}:${d.value.replace(/\s+/g, ' ').trim()}${d.important ? '!' : ''}`))
    out.push(`${chainOf(rule)} {{ ${rule.selectors.map((s) => s.replace(/\s+/g, ' ').trim()).sort().join(',')} }} ${decls.join(';')}`)
  })
  return out
}

const before = fingerprint(postcss.parse(execFileSync('git', ['show', `HEAD:${SRC}/${original}`], { encoding: 'utf8' })))
const after = parts.flatMap((f) => fingerprint(postcss.parse(readFileSync(join(SRC, f), 'utf8'))))

const tally = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())
const b = tally(before)
const a = tally(after)

const missing = []
const extra = []
for (const [k, n] of b) if ((a.get(k) || 0) !== n) missing.push(`${n} -> ${a.get(k) || 0}  ${k.slice(0, 150)}`)
for (const [k, n] of a) if (!b.has(k)) extra.push(`0 -> ${n}  ${k.slice(0, 150)}`)

console.log(`HEAD:${original}  ${before.length} rules`)
console.log(`${parts.join(' + ')}  ${after.length} rules`)
console.log(`\n  rules whose count changed: ${missing.length}`)
for (const m of missing.slice(0, 20)) console.log(`    ${m}`)
console.log(`  rules that did not exist before: ${extra.length}`)
for (const e of extra.slice(0, 20)) console.log(`    ${e}`)
if (!missing.length && !extra.length) console.log('\n  identical: every rule moved or stayed, none lost, none invented')
process.exit(missing.length || extra.length ? 1 : 0)
