/**
 * Tokens declared in more than one place with more than one value.
 *
 * This is the shape of the `--font-pixel` bug: `styles.css` said Courier New,
 * `art/art.css` said Archivo, both on `:root`, and which one a reader got came
 * down to which sheet the bundler happened to put last. A responsive
 * redeclaration inside a media query is the legitimate case and is reported
 * separately, because that is what tokens are for.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../../frontend/src', import.meta.url).pathname

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

const decls = new Map() // token -> [{file, value, inMedia}]

for (const f of walk(ROOT)) {
  const rel = relative(ROOT, f)
  const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // Track media nesting crudely by counting `@media` openings before an offset.
  const mediaRanges = []
  for (const m of src.matchAll(/@media[^{]*\{/g)) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    mediaRanges.push([m.index, i])
  }
  for (const m of src.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;}]+)/g)) {
    const at = m.index
    const inMedia = mediaRanges.some(([a, b]) => at > a && at < b)
    if (!decls.has(m[1])) decls.set(m[1], [])
    decls.get(m[1]).push({ file: rel, value: m[2].trim().replace(/\s+/g, ' '), inMedia })
  }
}

const hard = []
const responsive = []
for (const [token, rows] of decls) {
  const values = new Set(rows.map((r) => r.value))
  if (values.size < 2) continue
  const files = new Set(rows.map((r) => r.file))
  const anyBase = rows.filter((r) => !r.inMedia)
  // A clash worth reporting: two *base* declarations, in different files,
  // disagreeing. Anything else is a breakpoint or a component-scoped default.
  if (anyBase.length > 1 && new Set(anyBase.map((r) => r.file)).size > 1) hard.push([token, rows])
  else if (files.size > 1) responsive.push([token, rows])
}

console.log('===== same token, two base declarations, different sheets =====')
if (!hard.length) console.log('(none)')
for (const [token, rows] of hard) {
  console.log(`\n${token}`)
  for (const r of rows) console.log(`   ${r.inMedia ? '@' : ' '} ${r.file.padEnd(30)} ${r.value.slice(0, 70)}`)
}

console.log(`\n\n===== redeclared across sheets (breakpoints / scoped defaults): ${responsive.length} =====`)
for (const [token, rows] of responsive) {
  console.log(`${token.padEnd(28)} ${[...new Set(rows.map((r) => r.file))].join(', ')}`)
}
