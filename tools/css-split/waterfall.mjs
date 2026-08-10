/**
 * The request waterfall for one cold throttled load, and what the screen holds
 * when the first paint lands.
 *
 * `css-prove.mjs --fcp-only` says how long the first paint took; it does not say
 * what the browser spent that time on, and a number that is not attached to a
 * cause can only be improved by guessing. This serves a built `dist` the same
 * way and under the same emulation — 390px, 4x CPU, 1.6 Mbps down, 150 ms rtt —
 * and writes down every request: when it was discovered, who discovered it, how
 * long it waited, how long it took and how much came back. A request whose
 * initiator is another request is a serialised hop, and those are the only
 * things on the critical path worth removing.
 *
 * The screencast is here because first paint is a metric about pixels and it is
 * possible to move it without a reader seeing anything sooner. Frames are
 * recorded from the moment of navigation and the one covering the paint is
 * saved, so the claim "this got faster" can be checked against what was
 * actually on the glass.
 *
 *   node tools/css-split/waterfall.mjs /tmp/lsat-dist-a
 *   ... --route /office     a route other than /
 *   ... --shot out.jpg      also write the frame that covers the first paint
 *   ... --api               answer /v1/* as the real server would, rather than
 *                           letting index.html fall through to every unknown path
 */
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
/**
 * This copy of Playwright resolves the host as `mac-x64` and looks for a binary
 * that was never downloaded, so the browser is named rather than discovered.
 * The rest of the repo's capture scripts already do this.
 */
const CHROME = process.env.LSAT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const argv = process.argv.slice(2)
const takes = new Set(['--route', '--shot'])
const opts = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const route = opts['--route'] || '/'
const shot = typeof opts['--shot'] === 'string' ? opts['--shot'] : null
const fakeApi = Boolean(opts['--api'])
const dist = resolve(positional[0])

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.webp': 'image/webp',
}

/**
 * An unauthenticated answer for the two calls `index.html` starts by hand.
 *
 * Without this the static server hands `index.html` back for `/v1/me`, which is
 * a 200 with an HTML body — the app reads that as a signed-in reader whose game
 * state is an empty object, and renders a different screen than a real visitor
 * ever sees. A 401 is what an actual cold visitor to `/` receives.
 */
function serve(root) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (fakeApi && url.startsWith('/v1/')) {
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ detail: 'unauthorized', code: 'unauthorized' }))
      return
    }
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

const short = (url) => {
  try {
    const u = new URL(url)
    const name = u.pathname.split('/').pop() || '/'
    return u.hostname === '127.0.0.1' ? name || '/' : `${u.hostname}${u.pathname.length > 28 ? `${u.pathname.slice(0, 28)}…` : u.pathname}`
  } catch { return url.slice(0, 40) }
}

const a = await serve(dist)
const browser = await chromium.launch({ executablePath: CHROME })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const client = await page.context().newCDPSession(page)
  const reqs = new Map()
  const frames = []
  client.on('Network.requestWillBeSent', (e) => {
    reqs.set(e.requestId, {
      url: e.request.url,
      type: e.type,
      start: e.timestamp,
      initiator: e.initiator,
      priority: e.request.initialPriority,
    })
  })
  client.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId)
    if (r) { r.status = e.response.status; r.timing = e.response.timing; r.mime = e.response.mimeType }
  })
  client.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId)
    if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength }
  })
  client.on('Network.loadingFailed', (e) => {
    const r = reqs.get(e.requestId)
    if (r) { r.end = e.timestamp; r.failed = e.errorText }
  })
  client.on('Page.screencastFrame', async (e) => {
    frames.push({ at: e.metadata.timestamp, data: e.data })
    try { await client.send('Page.screencastFrameAck', { sessionId: e.sessionId }) } catch { /* torn down */ }
  })

  await client.send('Network.enable')
  await client.send('Page.enable')
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await client.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  })
  if (shot) await client.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 })

  await page.goto(`http://127.0.0.1:${a.port}${route}`, { waitUntil: 'commit' })
  const paint = await page.evaluate(() => new Promise((ok) => {
    const done = (v) => ok({ fcp: v, origin: performance.timeOrigin })
    const seen = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')
    if (seen) return done(seen.startTime)
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') { obs.disconnect(); done(e.startTime) }
    })
    obs.observe({ type: 'paint', buffered: true })
    setTimeout(() => done(null), 25000)
  }))
  // Let the tail of the load land so the waterfall shows what follows the paint,
  // not just what precedes it.
  await page.waitForTimeout(4000)
  if (shot) { try { await client.send('Page.stopScreencast') } catch { /* already gone */ } }

  const nav = [...reqs.values()].find((r) => r.type === 'Document')
  const t0 = nav ? nav.start : Math.min(...[...reqs.values()].map((r) => r.start))
  const ms = (t) => Math.round((t - t0) * 1000)

  const byId = new Map([...reqs].map(([id, r]) => [r.url, id]))
  /**
   * What discovered this request. `parser` with a url is the HTML parser
   * reaching a tag; `script` is a stack, and the top frame's file is the thing
   * that had to arrive and run first — that is the serialised hop.
   */
  const cause = (r) => {
    const i = r.initiator || {}
    if (i.type === 'parser') return `parser ${short(i.url || '')}`
    if (i.type === 'preload') return 'preload scanner'
    if (i.type === 'script') {
      const top = (i.stack?.callFrames || [])[0]
      return top ? `script ${short(top.url)}${top.functionName ? ` (${top.functionName})` : ''}` : 'script'
    }
    return i.type || '?'
  }

  const rows = [...reqs.values()].sort((x, y) => x.start - y.start)
  const width = 64
  const span = Math.max(...rows.map((r) => (r.end || r.start))) - t0
  console.log(`\n${dist}  ${route}   390px, 4x CPU, 1.6 Mbps / 150 ms rtt`)
  console.log(`first contentful paint ${paint.fcp == null ? 'never' : `${Math.round(paint.fcp)} ms`}\n`)
  console.log(`  ${'start'.padStart(6)} ${'end'.padStart(6)} ${'kB'.padStart(7)}  ${'pri'.padEnd(6)} ${'asset'.padEnd(30)} discovered by`)
  for (const r of rows) {
    const s = ms(r.start)
    const e = r.end ? ms(r.end) : null
    const bar = Array.from({ length: width }, (_, i) => {
      const at = (i / width) * span * 1000
      if (e != null && at >= s && at <= e) return '='
      return ' '
    }).join('')
    const kB = r.bytes != null ? (r.bytes / 1000).toFixed(1) : (r.failed ? 'fail' : '—')
    console.log(
      `  ${String(s).padStart(6)} ${String(e ?? '').padStart(6)} ${String(kB).padStart(7)}  ${String(r.priority || '').padEnd(6)} ${short(r.url).padEnd(30)} ${cause(r)}`,
    )
    console.log(`         |${bar}|`)
  }

  const total = rows.reduce((n, r) => n + (r.bytes || 0), 0)
  const beforePaint = rows.filter((r) => paint.fcp != null && ms(r.start) <= paint.fcp)
  console.log(`\n  ${rows.length} requests, ${(total / 1000).toFixed(1)} kB on the wire; ${beforePaint.length} started before the paint`)

  /**
   * A strip either side of the paint, because one frame cannot distinguish
   * "the metric fired on real content" from "the metric fired on a background
   * and the content came later".
   */
  if (shot && frames.length) {
    const origin = paint.origin / 1000
    const at = (f) => Math.round((f.at - origin) * 1000)
    const want = paint.fcp == null ? [1000, 2000, 3000, 4000, 6000] : [-400, 0, 200, 500, 1000, 2000, 4000].map((d) => paint.fcp + d)
    const base = shot.replace(/\.jpg$/, '')
    const written = []
    for (const t of want) {
      const pick = frames.find((f) => at(f) >= t) || frames[frames.length - 1]
      const name = `${base}-${String(at(pick)).padStart(5, '0')}ms.jpg`
      if (written.includes(name)) continue
      written.push(name)
      await writeFile(name, Buffer.from(pick.data, 'base64'))
    }
    console.log(`  ${frames.length} frames from ${at(frames[0])} to ${at(frames[frames.length - 1])} ms; wrote ${written.length} either side of the paint as ${base}-<ms>.jpg`)
  }
  await page.close()
} finally {
  await browser.close()
  a.server.close()
}
