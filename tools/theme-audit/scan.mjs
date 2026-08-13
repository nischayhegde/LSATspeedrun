/**
 * Theme conformance scan.
 *
 * Reads every stylesheet the app ships and reports the raw values used for the
 * properties the visual system has tokens for. Anything that appears once or
 * twice is a candidate for drift; anything that appears everywhere is the de
 * facto standard whether or not a token names it.
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

const files = walk(ROOT).sort()

// Strip comments so commentary about a colour is not counted as a use of it.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const buckets = {
  radius: /border-radius:\s*([^;}]+)/g,
  font: /font-family:\s*([^;}]+)/g,
  fontShorthand: /(?:^|[;{])\s*font:\s*([^;}]+)/g,
  tracking: /letter-spacing:\s*([^;}]+)/g,
  shadow: /box-shadow:\s*([^;}]+)/g,
  blur: /backdrop-filter:\s*([^;}]+)/g,
}

const tally = {}
for (const key of Object.keys(buckets)) tally[key] = new Map()

const hexes = new Map()

for (const f of files) {
  const rel = relative(ROOT, f)
  const src = strip(readFileSync(f, 'utf8'))
  for (const [key, re] of Object.entries(buckets)) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src))) {
      const v = m[1].trim().replace(/\s+/g, ' ')
      if (!tally[key].has(v)) tally[key].set(v, new Set())
      tally[key].get(v).add(rel)
    }
  }
  for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const v = m[0].toLowerCase()
    if (!hexes.has(v)) hexes.set(v, new Map())
    const per = hexes.get(v)
    per.set(rel, (per.get(rel) ?? 0) + 1)
  }
}

const report = (title, map, limit = 400) => {
  console.log(`\n===== ${title} (${map.size} distinct) =====`)
  const rows = [...map.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
  for (const [v, fs] of rows.slice(0, limit)) {
    console.log(`${String(fs.size).padStart(3)}f  ${v}${fs.size <= 2 ? `   << ${[...fs].join(', ')}` : ''}`)
  }
}

for (const key of Object.keys(buckets)) report(key, tally[key])

console.log(`\n===== hex literals (${hexes.size} distinct) =====`)
const hexRows = [...hexes.entries()]
  .map(([v, per]) => [v, [...per.values()].reduce((a, b) => a + b, 0), per])
  .sort((a, b) => b[1] - a[1])
for (const [v, total, per] of hexRows) {
  console.log(`${String(total).padStart(4)}x  ${v}  ${total <= 3 ? [...per.keys()].join(', ') : `(${per.size} files)`}`)
}
