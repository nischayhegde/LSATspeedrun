/**
 * Asks the browser whether the split changed how anything looks, and what it
 * bought.
 *
 * The static scans say no rule changed which one wins. This checks that where it
 * actually resolves. Both builds are served side by side; on every route, a bare
 * element is created for each class that route can put on the page, and its
 * computed style is read out of the real cascade — the entry sheet, the route
 * sheets the inline script writes into `<head>`, `art.css` and `mobile.css`, in
 * the order the browser applied them. The app does not need to boot: the
 * stylesheets are in the document either way, and it is the stylesheets that are
 * on trial.
 *
 * "That route can put on the page" is the whole question, so it is worth being
 * exact about it. A first attempt compared every class the old `styles.css`
 * named on every route and reported 2824 differences, all of them the intended
 * change: `.answer-card` is a case-screen class, it no longer resolves on
 * /story, and that is the point. What a regression would look like is a class a
 * route *can* render resolving differently, so the set probed on each route is
 * the classes written by the files that route reaches, plus the app shell.
 *
 *   node tools/css-split/css-prove.mjs /tmp/css-base/frontend/dist frontend/dist
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)

const [baseDist, headDist] = process.argv.slice(2).map((p) => resolve(p))
const SRC = resolve('frontend/src')
const ROUTES = {
  '/login': 'pages/login-page.tsx',
  '/onboarding': 'pages/onboarding-page.tsx',
  '/office': 'pages/office-page.tsx',
  '/map': 'pages/map-page.tsx',
  '/progress': 'pages/dashboard-page.tsx',
  '/cases': 'pages/cases-page.tsx',
  '/cases/7': 'pages/case-session-page.tsx',
  '/firm': 'pages/firm-page.tsx',
  '/story': 'pages/story-page.tsx',
}

// ------------------------------------------- what each route can put on screen

const files = new Map()
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx|ts)$/.test(name)) files.set(p, readFileSync(p, 'utf8'))
  }
}
walk(SRC)
const ROUTER = resolve(SRC, 'routes.tsx')
const PAGES = new Set(Object.values(ROUTES).map((p) => resolve(SRC, p)))
const resolveImport = (from, spec) => {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  for (const c of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}
const reachable = (entry) => {
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f) || !files.has(f)) continue
    seen.add(f)
    for (const m of files.get(f).matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const next = resolveImport(f, m[1])
      if (!next) continue
      if (f === ROUTER && PAGES.has(next) && next !== entry) continue
      queue.push(next)
    }
  }
  return seen
}
const shell = reachable(join(SRC, 'App.tsx'))

const oldStyles = execFileSync('git', ['show', 'f0484f3:frontend/src/styles.css'], { encoding: 'utf8', maxBuffer: 1 << 28 })
const ALL = [...new Set([...oldStyles.matchAll(/\.(-?[_a-zA-Z][\w-]{2,})/g)].map((m) => m[1]))].sort()

const classesFor = (page) => {
  const text = [...new Set([...reachable(join(SRC, page)), ...shell])].map((f) => files.get(f)).join('\n')
  return ALL.filter((c) => new RegExp(`[\`'"\\s.]${c}[\`'"\\s.\\]$]`).test(text))
}

// ------------------------------------------------------------------ serving

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary' }
function serve(root) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    let file = join(root, url)
    if (!existsSync(file) || !extname(file)) file = join(root, 'index.html')
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch { res.writeHead(404); res.end('no') }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })))
}

const PROPS = [
  'display', 'position', 'color', 'background-color', 'background-image', 'font-size', 'font-family', 'font-weight',
  'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'padding', 'margin', 'border',
  'border-radius', 'box-shadow', 'width', 'height', 'min-width', 'min-height', 'max-width', 'flex-direction',
  'justify-content', 'align-items', 'gap', 'grid-template-columns', 'opacity', 'overflow', 'transform', 'z-index',
]
const READ = ([classes, props]) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const out = {}
  for (const cls of classes) {
    const el = document.createElement('div')
    el.className = cls
    host.appendChild(el)
    const cs = getComputedStyle(el)
    const rec = []
    for (const p of props) rec.push(cs.getPropertyValue(p))
    out[cls] = rec.join('|')
    host.removeChild(el)
  }
  host.remove()
  return out
}

const a = await serve(baseDist)
const b = await serve(headDist)
const browser = await chromium.launch()
let differing = 0
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [route, pageFile] of Object.entries(ROUTES)) {
      const classes = classesFor(pageFile)
      const at = async (port) => {
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'load' })
        await page.waitForTimeout(150)
        return page.evaluate(READ, [classes, PROPS])
      }
      const before = await at(a.port)
      const after = await at(b.port)
      const diffs = classes.filter((c) => before[c] !== after[c])
      differing += diffs.length
      console.log(`  ${String(width).padEnd(5)} ${route.padEnd(12)} ${String(classes.length).padStart(4)} classes it can render, ${diffs.length} differ`)
      for (const d of diffs.slice(0, 6)) {
        console.log(`        .${d}\n          was ${before[d]}\n          now ${after[d]}`)
      }
    }
  }
  console.log(`\n${differing} computed-style differences across ${Object.keys(ROUTES).length} routes at two widths\n`)

  // ------------------------------------------------------------ first paint
  const fcp = async (port) => {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const client = await p.context().newCDPSession(p)
    await client.send('Network.enable')
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
    })
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' })
    const v = await p.evaluate(() => new Promise((ok) => {
      const seen = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')
      if (seen) return ok(seen.startTime)
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') { obs.disconnect(); ok(e.startTime) }
      })
      obs.observe({ type: 'paint', buffered: true })
      setTimeout(() => ok(null), 25000)
    }))
    await p.close()
    return v
  }
  const base = []
  const head = []
  for (let i = 0; i < 7; i += 1) {
    base.push(await fcp(a.port))
    head.push(await fcp(b.port))
  }
  const median = (xs) => {
    const v = xs.filter((x) => x != null).sort((x, y) => x - y)
    return v.length ? v[Math.floor(v.length / 2)] : null
  }
  const show = (xs) => xs.map((x) => (x == null ? 'none' : Math.round(x))).join(', ')
  console.log('  FCP at / on a 390px phone, 4x CPU, 1.6 Mbps down / 150 ms rtt')
  console.log(`    baseline ${show(base)}   median ${Math.round(median(base))} ms`)
  console.log(`    now      ${show(head)}   median ${Math.round(median(head))} ms`)
  console.log(`    ${Math.round(median(base) - median(head))} ms faster`)
} finally {
  await browser.close()
  a.server.close()
  b.server.close()
}
