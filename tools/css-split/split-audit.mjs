/**
 * Finds a selector in a route sheet that other routes can still match.
 *
 * `route-split.mjs` decides per rule, and it ignored classes it read as
 * modifiers — `is-active`, `has-error`, and anything with no hyphen in it, on
 * the grounds that those are written next to a component's own class rather
 * than alone. That is right for `.active` and wrong for `.eyebrow`, which is a
 * standalone class with no hyphen. A rule written `.story-lede, .eyebrow { … }`
 * therefore qualifies on the strength of `.story-lede` and takes `.eyebrow`
 * off the global sheet with it.
 *
 * The tie check catches that only when some rule left behind sets the same
 * property. If nothing does, the styling simply disappears from every other
 * screen and nothing reports it. So this asks the stricter question of every
 * selector in a route sheet: does it name at least one class that only the
 * owning files write? A selector that does not is one this route does not own.
 *
 *   node tools/css-split/split-audit.mjs case-session-styles.css pages/case-session-page.tsx,case-flow.tsx
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import postcss from '../../frontend/node_modules/postcss/lib/postcss.mjs'

const SRC = 'frontend/src'
const sheet = process.argv[2]
const owners = (process.argv[3] || '').split(',').filter(Boolean)

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx|ts)$/.test(name)) files.push([p.replace(`${SRC}/`, ''), readFileSync(p, 'utf8')])
  }
}
walk(SRC)

const cache = new Map()
const usersOf = (cls) => {
  if (!cache.has(cls)) {
    const re = new RegExp(`[\`'"\\s.]${cls}[\`'"\\s.\\]$]`)
    cache.set(cls, files.filter(([, text]) => re.test(text)).map(([path]) => path))
  }
  return cache.get(cls)
}
/** Written by an owner and by nobody else, so only this route can produce it. */
const exclusive = (cls) => {
  const u = usersOf(cls)
  return u.length > 0 && u.every((f) => owners.includes(f))
}

const root = postcss.parse(readFileSync(join(SRC, sheet), 'utf8'))
const loose = []
root.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return
  for (const selector of rule.selectors) {
    const classes = [...new Set([...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))]
    if (classes.some((c) => exclusive(c))) continue
    const props = []
    rule.walkDecls((d) => props.push(d.prop))
    loose.push(`${selector.replace(/\s+/g, ' ')}   sets: ${[...new Set(props)].join(', ')}`)
  }
})

console.log(`${sheet}: ${loose.length} selectors with no owner-exclusive class`)
for (const l of loose) console.log(`    ${l}`)
process.exit(loose.length ? 1 : 0)
