/**
 * Selectors declared more than once, at base (no media query), in more than
 * one sheet, setting the same property to different values.
 *
 * This is the `.eyebrow` bug generalised: three base rules for one class
 * across two sheets, each naming a different size and tracking, all at equal
 * specificity — so what rendered was whichever sheet the bundler put last
 * rather than anything anyone chose. Restricted to the properties the visual
 * system has a position on, because a duplicated `margin` is a layout question
 * and not this sweep's business.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../../frontend/src', import.meta.url).pathname
const THEME_PROPS = new Set([
  'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-transform',
  'border-radius', 'box-shadow', 'color', 'background', 'background-color', 'border',
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

/** selector -> property -> [{file, value}] */
const table = new Map()

for (const f of walk(ROOT)) {
  const rel = relative(ROOT, f)
  let src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // Drop everything inside a media/supports block: a breakpoint restating a
  // property is the intended use, not a clash.
  for (const m of [...src.matchAll(/@(media|supports|keyframes)[^{]*\{/g)].reverse()) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    src = src.slice(0, m.index) + src.slice(i)
  }
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    // Only single-class or single-element selectors: those are the ones where
    // specificity cannot be the tie-breaker.
    for (const sel of selectors) {
      if (!/^\.?[a-zA-Z][\w-]*$/.test(sel)) continue
      for (const d of m[2].split(';')) {
        const idx = d.indexOf(':')
        if (idx < 0) continue
        const prop = d.slice(0, idx).trim()
        if (!THEME_PROPS.has(prop)) continue
        const value = d.slice(idx + 1).trim().replace(/\s+/g, ' ')
        if (!table.has(sel)) table.set(sel, new Map())
        const props = table.get(sel)
        if (!props.has(prop)) props.set(prop, [])
        props.get(prop).push({ file: rel, value })
      }
    }
  }
}

let found = 0
for (const [sel, props] of [...table].sort()) {
  const clashes = []
  for (const [prop, rows] of props) {
    if (new Set(rows.map((r) => r.value)).size < 2) continue
    if (new Set(rows.map((r) => r.file)).size < 2) continue
    clashes.push([prop, rows])
  }
  if (!clashes.length) continue
  found++
  console.log(`\n${sel}`)
  for (const [prop, rows] of clashes) {
    console.log(`  ${prop}`)
    for (const r of rows) console.log(`      ${r.file.padEnd(28)} ${r.value.slice(0, 64)}`)
  }
}
if (!found) console.log('(none)')
