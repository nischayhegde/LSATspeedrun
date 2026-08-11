/**
 * Checks the cascade a browser actually builds, rather than the one the source
 * was reasoned about.
 *
 * `route-split2.mjs` decides what may move by reading the source sheets and
 * assuming `lsat-route-stylesheets` will put the result where it was told to.
 * Everything between those two — `manualChunks` keeping the sheet in an asset
 * of its own, Vite folding a pure-CSS chunk into its importer, the inline
 * script placing the link on the right side of the entry, and a client-side
 * navigation arriving by a different path entirely — is unchecked by it. This
 * checks that half, from the built directories, in a browser.
 *
 * Both builds are served, the head of each route is read out of the live
 * document, and the sheets are flattened into one list of rules in the order
 * the browser holds them. Then the two lists are compared as *orders*:
 *
 *   - Every sheet other than the route's `mobile-` sheets must appear in the
 *     same relative order it had, and so must the rules inside the `mobile-`
 *     sheets. Both are subsequence tests, and a subsequence test needs to know
 *     nothing about selectors.
 *   - What is left is the intended change: each rule in a `mobile-` sheet now
 *     comes after rules that used to come after it. Those crossings are
 *     enumerated exactly — not inferred — and each is put through the same
 *     question `route-split2.mjs` asks, of whether the two rules could ever
 *     have decided the same property on the same element.
 *
 * So the order claim is proved and the conflict claim is tested on the real
 * pairs. `css-prove.mjs` is the third leg: it reads computed styles out of the
 * browser and does not take either claim's word for it.
 *
 * The app's module script is withheld on the cold read, so what is measured is
 * the render-blocking set at first paint. `--nav` keeps the app and re-reads
 * the same order after a client-side navigation, which is the other way a
 * route's sheets arrive and the one that gets there through Vite's own
 * injection rather than through the inline script.
 *
 *   node tools/css-split/cascade-order.mjs .verify/dist-base .verify/dist-head
 *   node tools/css-split/cascade-order.mjs .verify/dist-base .verify/dist-head --nav
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import postcss from '../../frontend/node_modules/postcss/lib/postcss.mjs'

import { launchChromium } from '../playwright-env.mjs'

const args = process.argv.slice(2)
const nav = args.includes('--nav')
const [baseDist, headDist] = args.filter((a) => !a.startsWith('--')).map((p) => resolve(p))
const ROUTES = ['/', '/login', '/onboarding', '/office', '/map', '/progress', '/cases', '/cases/7', '/firm', '/story']
const isMobileSheet = (href) => /(^|\/)mobile-[^/]*\.css$/.test(href)

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary' }
function serve(root, withApp) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    let file = join(root, url)
    if (!existsSync(file) || !extname(file)) file = join(root, 'index.html')
    try {
      let body = await readFile(file)
      if (!withApp && file.endsWith('index.html')) {
        body = Buffer.from(body.toString('utf8').replace(/<script type="module"[^>]*><\/script>/g, ''))
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch { res.writeHead(404); res.end('no') }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })))
}

// ------------------------------------------------------- reading the sheets

const chainOf = (node) => {
  const stack = []
  for (let p = node.parent; p && p.type === 'atrule'; p = p.parent) stack.unshift(`@${p.name} ${p.params}`)
  return stack.join('||')
}
const rulesOf = (css) => {
  const out = []
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return
    const props = new Map()
    rule.walkDecls((d) => props.set(d.prop, d.important))
    const decls = []
    rule.walkDecls((d) => decls.push(`${d.prop}:${d.value.replace(/\s+/g, ' ').trim()}${d.important ? '!' : ''}`))
    const media = chainOf(rule)
    const selectors = rule.selectors.map((s) => s.replace(/\s+/g, ' ').trim())
    out.push({ id: `${media} {{ ${[...selectors].sort().join(',')} }} ${decls.join(';')}`, media, selectors, props })
  })
  return out
}

// --------------------------------------------- could these two ever collide

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
function flatten(rule, at) {
  const o = []
  if (!rule.props.size) return o
  for (const selector of rule.selectors) {
    const k = matchKey(selector)
    if (k) o.push({ selector, at, props: rule.props, key: k.key, classes: k.classes })
  }
  return o
}
/** The mover is `a`; it used to lose to `b` and now beats it. */
function collides(a, b) {
  if (a.key !== b.key) return null
  if (!nested(a.classes, b.classes)) return null
  const shared = [...a.props.keys()].filter((p) => b.props.has(p))
  if (!shared.length) return null
  const sa = specificity(a.selector) + (a.props.get(shared[0]) ? 1e6 : 0)
  const sb = specificity(b.selector) + (b.props.get(shared[0]) ? 1e6 : 0)
  return sa === sb ? shared : null
}

/** Leftmost matching decides subsequence membership, so greedy is exact. */
const positions = (older, newer) => {
  const at = []
  let i = 0
  for (const id of newer) {
    while (i < older.length && older[i] !== id) i += 1
    if (i === older.length) return { broken: id, at }
    at.push(i)
    i += 1
  }
  return { broken: null, at }
}

const a = await serve(baseDist, nav)
const b = await serve(headDist, nav)
const browser = await launchChromium({ args: [] })
let bad = 0
try {
  const headOf = async (port, route) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    if (nav) {
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
      await page.evaluate((r) => window.history.pushState({}, '', r), route)
      await page.waitForTimeout(1500)
    } else {
      await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'load' })
      await page.waitForTimeout(150)
    }
    // Google's font sheet is a static link in `index.html`, identical in both
    // builds and never moved, so leaving it out changes no comparison.
    const hrefs = (await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href'))))
      .filter((href) => href.startsWith('/assets/'))
    await page.close()
    const dist = port === a.port ? baseDist : headDist
    const rules = []
    for (const href of hrefs) {
      const moved = isMobileSheet(href)
      for (const rule of rulesOf(await readFile(join(dist, href), 'utf8'))) rules.push({ ...rule, moved })
    }
    return { hrefs, rules }
  }

  for (const route of ROUTES) {
    const before = await headOf(a.port, route)
    const after = await headOf(b.port, route)
    const old = before.rules.map((r) => r.id)
    const wasMoved = after.rules.map((r) => r.moved)

    const stayed = positions(old, after.rules.filter((r) => !r.moved).map((r) => r.id))
    const moved = positions(old, after.rules.filter((r) => r.moved).map((r) => r.id))
    const problems = []
    if (stayed.broken) problems.push(`a sheet that did not move is out of order at ${stayed.broken.slice(0, 120)}`)
    if (moved.broken) problems.push(`the moved sheet's own rules are out of order at ${moved.broken.slice(0, 120)}`)

    /**
     * Every crossing the move creates, read off both orders rather than
     * assumed. A pair is crossed when the document puts them one way round and
     * the baseline put them the other, whichever side of the entry link the
     * sheet actually ended up on — which is the thing being checked, so it is
     * not something to take on trust.
     */
    let crossings = 0
    let passed = 0
    if (!stayed.broken && !moved.broken) {
      const stayedAt = []
      const movedAt = []
      for (const [i, isMoved] of wasMoved.entries()) {
        const was = isMoved ? moved.at[movedAt.length] : stayed.at[stayedAt.length]
        ;(isMoved ? movedAt : stayedAt).push({ now: i, was, rule: after.rules[i] })
      }
      const byKey = new Map()
      for (const s of stayedAt) {
        for (const f of flatten(s.rule, s.was)) {
          f.now = s.now
          if (!byKey.has(f.key)) byKey.set(f.key, [])
          byKey.get(f.key).push(f)
        }
      }
      const crossed = (m, s) => (m.now < s.now) !== (m.was < s.was)
      for (const entry of movedAt) {
        // How much of the sheet this rule jumped over, so that the number the
        // conflict test then dismisses is printed next to it.
        passed += stayedAt.filter((s) => crossed(entry, s)).length
        for (const m of flatten(entry.rule, entry.was)) {
          m.now = entry.now
          for (const s of byKey.get(m.key) || []) {
            if (!crossed(m, s)) continue
            crossings += 1
            const shared = collides(m, s)
            if (shared) {
              const [won, lost] = m.now > s.now ? [m, s] : [s, m]
              problems.push(`${won.selector}  now beats  ${lost.selector}  on ${shared.join(', ')}`)
            }
          }
        }
      }
    }

    if (problems.length) bad += 1
    console.log(
      `  ${route.padEnd(12)} ${String(old.length).padStart(5)} rules -> ${String(after.rules.length).padStart(5)}` +
        `  ${String(moved.at.length).padStart(3)} moved over ${String(passed).padStart(6)} rules, ${String(crossings).padStart(4)} naming the same element` +
        `   ${problems.length ? `${problems.length} PROBLEMS` : 'no winner changes'}`,
    )
    for (const p of [...new Set(problems)].slice(0, 8)) console.log(`      ${p}`)
  }
  console.log(`\n${bad} of ${ROUTES.length} routes changed a cascade decision${nav ? ', after a client-side navigation' : ''}\n`)
} finally {
  await browser.close()
  a.server.close()
  b.server.close()
}
process.exit(bad ? 1 : 0)
