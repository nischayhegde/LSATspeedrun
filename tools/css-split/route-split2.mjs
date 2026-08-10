/**
 * Moves one route's rules out of the entry sheet, from any of the sheets in it.
 *
 * An earlier `route-split.mjs` handled `styles.css` alone, and could reason
 * about the cascade with two small checks because a rule leaving `styles.css`
 * only ever moved ahead of `review-panels.css`. It is gone; this supersedes it
 * and gives the same answer on the same inputs. `mobile.css` is the case that
 * needed the general statement rather than the two checks: it is
 * the last sheet on the entry and it wins by being last, so a rule leaving it
 * jumps ahead of all four sheets it was written to beat.
 *
 * So the check is stated once, globally, instead of case by case. Number every
 * rule in the entry sheet in the order the browser applies it — `review-panels`,
 * `styles`, `art/art`, `case-instrument`, `mobile` — and note that after the
 * move *every* extracted rule precedes *every* rule that stays. A rule therefore
 * changes who it loses to exactly when it ties with a rule that stays and used
 * to come after it. That one condition covers all five sheets, both directions,
 * and the extracted rules keep their order among themselves because they are
 * emitted by that same global index.
 *
 * `--at after` is the mirror of it. A route sheet does not have to go in front
 * of the entry link; `lsat-route-stylesheets` can put one behind it instead,
 * which is the only way to cut `mobile.css`, whose whole method is to come last.
 * Then every extracted rule *follows* every rule that stays, and a rule changes
 * who it loses to exactly when it ties with a rule that stays and used to come
 * before it. Same statement, same coverage, one comparison reversed.
 *
 *   node tools/css-split/route-split2.mjs --owners pages/login-page.tsx --from styles.css --out login-page.css
 *   node tools/css-split/route-split2.mjs --owners pages/office-page.tsx --from mobile.css --at after --out mobile/office.css
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import postcss from '../../frontend/node_modules/postcss/lib/postcss.mjs'

const SRC = 'frontend/src'
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > 0 ? process.argv[i + 1] : null
}
/** The entry sheet, in the order `main.tsx` imports it. */
const ENTRY = (arg('entry') || 'review-panels.css,styles.css,art/art.css,case-instrument.css,mobile.css').split(',')
const owners = (arg('owners') || '').split(',').filter(Boolean)
const from = (arg('from') || 'styles.css').split(',')
const out = arg('out')
/** Which side of the entry link the extracted sheet is written on. */
const at = arg('at') || 'before'
if (at !== 'before' && at !== 'after') throw new Error('--at takes before or after')
const write = process.argv.includes('--write')

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx|ts)$/.test(name)) files.push([p.replace(`${SRC}/`, ''), readFileSync(p, 'utf8')])
  }
}
walk(SRC)

const isModifier = (cls) => /^(is|has)-/.test(cls) || !cls.includes('-')
const cache = new Map()
const usersOf = (cls) => {
  if (!cache.has(cls)) {
    const re = new RegExp(`[\`'"\\s.]${cls}[\`'"\\s.\\]$]`)
    cache.set(cls, files.filter(([, text]) => re.test(text)).map(([path]) => path))
  }
  return cache.get(cls)
}
const classesOf = (sel) =>
  [...new Set([...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))]
const chainOf = (rule) => {
  const stack = []
  for (let p = rule.parent; p && p.type === 'atrule'; p = p.parent) stack.unshift(`@${p.name} ${p.params}`)
  return stack.join('||')
}

// ------------------------------------------- number the whole entry sheet

const roots = new Map()
const all = []
for (const file of ENTRY) {
  const root = postcss.parse(readFileSync(join(SRC, file), 'utf8'))
  roots.set(file, root)
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return
    all.push({ file, rule, at: all.length, media: chainOf(rule) })
  })
}

/**
 * A rule belongs to the route when every class it names is written by an owner
 * and by nobody else. Modifiers are not evidence of ownership, but a selector
 * that has nothing *but* modifiers is not owned either — `.eyebrow` has no
 * hyphen and is a real standalone class, and letting it ride along on a rule
 * that qualified through its sibling selector would take it off every other
 * screen. So each selector of the rule has to carry an owner-exclusive class of
 * its own.
 */
const exclusive = (cls) => {
  const u = usersOf(cls)
  return u.length > 0 && u.every((f) => owners.includes(f))
}
const ownedRule = (rule) => {
  for (const selector of rule.selectors) {
    const cs = classesOf(selector)
    if (!cs.length) return false
    if (!cs.some((c) => exclusive(c))) return false
    if (cs.some((c) => !isModifier(c) && !exclusive(c))) return false
  }
  return true
}

const candidates = new Set()
for (const e of all) if (from.includes(e.file) && ownedRule(e.rule)) candidates.add(e.at)

// ------------------------------------------------------------- the check

function matchKey(selector) {
  const compounds = selector.split(/\s*[>~+]\s*|\s+/).filter(Boolean)
  const cs = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])
  if (!cs.length) return null
  const last = compounds[compounds.length - 1]
  const tag = /^[a-zA-Z]/.test(last) ? last.replace(/[:.[].*$/, '') : ''
  return { key: `${cs[cs.length - 1]}|${tag}`, classes: new Set(cs) }
}
function nested(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const c of small) if (!large.has(c)) return false
  return true
}
function specificity(selector) {
  const s = selector.replace(/::?[-\w]+(\([^)]*\))?/g, (m) => (/^::/.test(m) ? '\u0001' : m))
  const ids = (s.match(/#[-\w]+/g) || []).length
  const cs = (s.match(/\.[-\w]+|\[[^\]]+\]|:(?!:)[-\w]+/g) || []).length
  const types = (s.match(/(^|[\s>~+(])[a-zA-Z][-\w]*/g) || []).length + (s.match(/\u0001/g) || []).length
  return ids * 10000 + cs * 100 + types
}
function flatten(entries) {
  const o = []
  for (const e of entries) {
    const props = new Map()
    e.rule.walkDecls((d) => props.set(d.prop, d.important))
    if (!props.size) continue
    for (const selector of e.rule.selectors) {
      const k = matchKey(selector)
      if (!k) continue
      o.push({ file: e.file, selector, props, at: e.at, media: e.media, key: k.key, classes: k.classes })
    }
  }
  return o
}

const tiesFor = (taking) => {
  const E = flatten(all.filter((e) => taking.has(e.at)))
  const byKey = new Map()
  for (const s of flatten(all.filter((e) => !taking.has(e.at)))) {
    if (!byKey.has(s.key)) byKey.set(s.key, [])
    byKey.get(s.key).push(s)
  }
  const found = []
  for (const a of E) {
    for (const b of byKey.get(a.key) || []) {
      // Moving in front of the entry, a rule that already came later still wins
      // and nothing has changed; moving behind it, a rule that already came
      // earlier still loses. Either way only the other half can flip.
      if (at === 'before' ? b.at > a.at : b.at < a.at) continue
      if (!nested(a.classes, b.classes)) continue
      const shared = [...a.props.keys()].filter((p) => b.props.has(p))
      if (!shared.length) continue
      const sa = specificity(a.selector) + (a.props.get(shared[0]) ? 1e6 : 0)
      const sb = specificity(b.selector) + (b.props.get(shared[0]) ? 1e6 : 0)
      if (sa !== sb) continue
      found.push({ a, b, shared })
    }
  }
  return found
}

/**
 * Every tie is between one rule that would move and one that would not, so the
 * only lever is to leave the mover behind. Doing that turns it into a rule that
 * stays, which can put it on the other side of a tie with something still being
 * taken, so this runs to a fixed point rather than once. Shrinking the set is
 * the only direction it goes, so it terminates.
 */
const taking = new Set(candidates)
const settle = process.argv.includes('--settle')
let flips = tiesFor(taking)
const held = []
if (settle) {
  while (flips.length) {
    const drop = new Set(flips.map((f) => f.a.at))
    for (const d of drop) { taking.delete(d); held.push(d) }
    flips = tiesFor(taking)
  }
}

const extracted = all.filter((e) => taking.has(e.at))
const bytes = (es) => es.reduce((n, e) => n + e.rule.toString().length, 0)
const perSheet = new Map()
for (const e of extracted) perSheet.set(e.file, (perSheet.get(e.file) || 0) + e.rule.toString().length)
console.log(`owners: ${owners.join(', ')}`)
console.log(`extractable: ${extracted.length} rules, ${bytes(extracted)} bytes`)
for (const [f, n] of perSheet) console.log(`    ${String(n).padStart(6)}  from ${f}`)
if (held.length) {
  const kept = all.filter((e) => held.includes(e.at))
  console.log(`held back to keep a tie's winner: ${held.length} rules, ${bytes(kept)} bytes`)
  for (const e of kept) console.log(`    #${e.at} ${e.media} ${e.rule.selector.replace(/\s+/g, ' ')}`)
}
console.log(`\nties whose winner the move would change: ${flips.length}   (sheet lands ${at} the entry link)`)
for (const f of flips.slice(0, 30)) {
  console.log(`    ${f.a.file} #${f.a.at} ${f.a.media} ${f.a.selector}`)
  console.log(`    would ${at === 'before' ? 'now lose to' : 'now beat'} ${f.b.file} #${f.b.at} ${f.b.media} ${f.b.selector}`)
  console.log(`    both set: ${f.shared.join(', ')}`)
}

if (!write) { console.log('\n(dry run — pass --write to perform it)'); process.exit(flips.length ? 1 : 0) }
if (flips.length) { console.log('\nrefusing to write: the cut would change who wins'); process.exit(1) }

// -------------------------------------------------------------- the write

const dest = postcss.parse('')
let runKey = null
let run = null
for (const e of extracted) {
  if (e.media !== runKey) {
    runKey = e.media
    if (!e.media) run = dest
    else {
      let node = dest
      for (const part of e.media.split('||')) {
        const m = part.match(/^@(\S+)\s*([\s\S]*)$/)
        const clone = postcss.atRule({ name: m[1], params: m[2] })
        node.append(clone)
        node = clone
      }
      run = node
    }
  }
  run.append(e.rule.clone())
}
for (const e of extracted) e.rule.remove()

for (const file of from) {
  const root = roots.get(file)
  let swept = true
  while (swept) {
    swept = false
    root.walkAtRules((block) => {
      if (block.nodes && block.nodes.length === 0 && !/keyframes/.test(block.name)) { block.remove(); swept = true }
    })
  }
  writeFileSync(join(SRC, file), root.toString())
}
mkdirSync(dirname(join(SRC, out)), { recursive: true })
writeFileSync(join(SRC, out), dest.toString())
const gz = (s) => gzipSync(s, { level: 9 }).length
for (const file of from) console.log(`  ${file} keeps ${roots.get(file).toString().length} bytes`)
console.log(`  ${out} takes ${dest.toString().length} bytes (gz ${gz(dest.toString())})`)
