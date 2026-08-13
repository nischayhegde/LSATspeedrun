/**
 * Verifies the sweep's fixes against a production build rather than the dev
 * server.
 *
 * This is not belt-and-braces. `lsat-route-stylesheets` in `vite.config.ts` is
 * `apply: 'build'`, so it only runs for a real build: in production every route
 * sheet is a `<link>` emitted *ahead* of the entry sheet, and in dev those same
 * sheets are injected by the module graph as their chunk executes, which for a
 * lazily-imported route sheet is *after* it. Any rule where a route sheet and
 * the entry sheet tie on specificity therefore resolves the other way round
 * between the two, and a dev screenshot cannot speak for production.
 *
 * Serves `dist` and proxies `/v1` to the local API so the session is real.
 *
 *   node tools/theme-audit/prod-check.mjs
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { WIDTHS, launch, open, shotDir } from './harness.mjs'

const DIST = new URL('../../frontend/dist', import.meta.url).pathname
const API = 'http://127.0.0.1:5001'
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg',
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0]
  if (url.startsWith('/v1/')) {
    const body = []
    for await (const c of req) body.push(c)
    const upstream = await fetch(API + req.url, {
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:5001' },
      body: body.length ? Buffer.concat(body) : undefined,
      redirect: 'manual',
    })
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      ...(upstream.headers.getSetCookie?.().length ? { 'set-cookie': upstream.headers.getSetCookie() } : {}),
    })
    res.end(Buffer.from(await upstream.arrayBuffer()))
    return
  }
  const file = join(DIST, url === '/' ? 'index.html' : url)
  const target = existsSync(file) && extname(file) ? file : join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'text/plain' })
  res.end(await readFile(target))
})

const port = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)))
const BASE = `http://127.0.0.1:${port}`
console.log(`serving ${DIST} on ${BASE}`)

/** The census the dev sweep used, so the two are directly comparable. */
const FONTS = () => {
  const families = new Map()
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    if (!(el.textContent || '').trim() || el.children.length > 0) continue
    const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim()
    families.set(fam, (families.get(fam) ?? 0) + 1)
  }
  return Object.fromEntries([...families].sort((a, b) => b[1] - a[1]))
}

const browser = await launch()
const OUT = shotDir(new URL('../../.theme-audit/prod', import.meta.url).pathname)

// Sign in against the built app.
const boot = await browser.newContext({ viewport: WIDTHS.desktop })
const bootPage = await boot.newPage()
await bootPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await bootPage.getByText('Enter local development firm').click({ noWaitAfter: true, timeout: 30000 })
await bootPage.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
await bootPage.waitForTimeout(1500)
await bootPage.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done'))
const state = await boot.storageState()
await boot.close()

const report = {}
for (const [name, route] of [['firm', '/firm'], ['story', '/story'], ['cases', '/cases'], ['firm-rivals', '/firm?tab=rivals']]) {
  for (const [w, viewport] of Object.entries(WIDTHS)) {
    const { context, page } = await open(browser, state, viewport)
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})
    await page.waitForTimeout(2600)
    await page.screenshot({ path: `${OUT}/${name}-${w}.png` })
    if (w === 'desktop') report[name] = await page.evaluate(FONTS)
    console.log(`  ${name} ${w}`)
    await context.close()
  }
}

writeFileSync(`${OUT}/fonts.json`, JSON.stringify(report, null, 2))
for (const [k, v] of Object.entries(report)) console.log(`${k.padEnd(14)} ${JSON.stringify(v)}`)
process.exit(0)
