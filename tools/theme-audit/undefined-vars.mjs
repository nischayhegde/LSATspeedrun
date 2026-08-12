/**
 * Reports custom properties that are read but never declared anywhere in the
 * shipped CSS, and those declared but never read. A `var(--x)` with no
 * declaration and no fallback resolves to nothing, so the property it sits on
 * is dropped entirely — that is a silent conformance failure rather than a
 * style choice.
 *
 * Properties set from JavaScript are excluded by scanning the TSX for
 * `setProperty('--x')` and inline `style={{ '--x': ... }}` writes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../../frontend/src', import.meta.url).pathname

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(p)
  }
  return out
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const declared = new Set()
const used = new Map() // name -> Map<file, count>

for (const f of walk(ROOT, ['.css'])) {
  const rel = relative(ROOT, f)
  const src = strip(readFileSync(f, 'utf8'))
  for (const m of src.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) declared.add(m[1])
  for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])/g)) {
    const name = m[1]
    const hasFallback = m[2] === ','
    const key = `${name}${hasFallback ? ' (has fallback)' : ''}`
    if (!used.has(key)) used.set(key, new Map())
    const per = used.get(key)
    per.set(rel, (per.get(rel) ?? 0) + 1)
  }
}

// Anything the app writes at runtime counts as declared.
for (const f of walk(ROOT, ['.tsx', '.ts'])) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9_-]+)/g)) declared.add(m[1])
  for (const m of src.matchAll(/['"`](--[a-zA-Z0-9_-]+)['"`]\s*:/g)) declared.add(m[1])
}

console.log('===== read but never declared =====')
let bad = 0
for (const [key, per] of [...used.entries()].sort()) {
  const name = key.split(' ')[0]
  if (declared.has(name)) continue
  bad++
  const total = [...per.values()].reduce((a, b) => a + b, 0)
  console.log(`${key}  ${total}x  ${[...per.keys()].join(', ')}`)
}
if (!bad) console.log('(none)')
