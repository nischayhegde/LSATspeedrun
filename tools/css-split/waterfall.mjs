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
 * The bytes go over the wire compressed, because the CloudFront in front of
 * production compresses them and a waterfall taken without it ranks the
 * critical path by the wrong sizes — see `prod-serve.mjs`. Every number in this
 * file's output before that changed was a raw-bytes number and is not
 * comparable with one taken since.
 *
 *   node tools/css-split/waterfall.mjs /tmp/lsat-dist-a
 *   ... --route /office     a route other than /
 *   ... --shot out.jpg      also write the frame that covers the first paint
 *   ... --api               answer /v1/* as the real server would, rather than
 *                           letting index.html fall through to every unknown path
 *   ... --auth              proxy /v1/* to the harness backend and load the route
 *                           with a real session, so a protected route is the route
 *                           and not the sign-in screen it redirects to
 *   ... --gzip              gzip everywhere, as prod would for a viewer with no brotli
 *   ... --no-compress       the raw bytes the numbers before this change were taken on
 *
 * Without `--auth`, every protected route in this app measures `/login`. The
 * tool will not stop you, but `tools/perf/` exists so that it does not have to
 * be that way — and with `--auth` the run refuses to print a waterfall it
 * cannot prove was the route asked for.
 */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { compressionFromOpts, describeCompression, serveLikeProd } from './prod-serve.mjs'
import { API, authedContext, describeProof, load, proveSignedIn, resolveRoutes, signIn } from '../perf/authed.mjs'
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
const shot = typeof opts['--shot'] === 'string' ? opts['--shot'] : null
const fakeApi = Boolean(opts['--api'])
const authed = Boolean(opts['--auth'])
const compress = compressionFromOpts(opts)
const dist = resolve(positional[0])

const session = authed ? await signIn() : null
// `/cases/:id` is a literal the tools accept; only the harness account knows
// which practice run it stands for.
const [route] = authed ? await resolveRoutes([opts['--route'] || '/'], session) : [opts['--route'] || '/']

const short = (url) => {
  try {
    const u = new URL(url)
    const name = u.pathname.split('/').pop() || '/'
    return u.hostname === '127.0.0.1' ? name || '/' : `${u.hostname}${u.pathname.length > 28 ? `${u.pathname.slice(0, 28)}…` : u.pathname}`
  } catch { return url.slice(0, 40) }
}

const a = await serveLikeProd(dist, { compress, api: authed ? API : fakeApi })
const browser = await chromium.launch({ executablePath: CHROME })
try {
  const context = authed
    ? await authedContext(browser, { port: a.port, session })
    : await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
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
    if (r) {
      r.status = e.response.status
      r.timing = e.response.timing
      r.mime = e.response.mimeType
      const headers = e.response.headers || {}
      r.encoding = headers['content-encoding'] || headers['Content-Encoding'] || ''
    }
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

  /**
   * Every largest-contentful-paint candidate, not just the last one.
   *
   * The metric is a single number about a single element, and knowing which
   * element is the difference between a fix and a guess: a candidate that is
   * superseded 600 ms later by the same text re-measured says the webfont
   * swapped, and one superseded by a canvas says a scene arrived and took the
   * title. `element` is read at entry time because the node can be gone by the
   * time this is read back.
   */
  await page.addInitScript(() => {
    window.__lcp = []
    const name = (el) => {
      if (!el) return '(detached)'
      const id = el.id ? `#${el.id}` : ''
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
      return `${el.tagName.toLowerCase()}${id}${cls}`
    }
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__lcp.push({
          at: e.startTime,
          size: e.size,
          el: name(e.element),
          text: (e.element?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 46),
          url: e.url || '',
        })
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  })

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
  // not just what precedes it. Six seconds rather than four because the last
  // largest-contentful-paint candidate on this app arrives past four, and a
  // window that closes before the final candidate reports the wrong element.
  await page.waitForTimeout(6000)
  const lcp = await page.evaluate(() => window.__lcp || [])
  if (shot) { try { await client.send('Page.stopScreencast') } catch { /* already gone */ } }
  // Before anything is printed. A waterfall for the wrong screen is worse than
  // no waterfall, because it looks like data.
  const proof = authed ? await proveSignedIn(page, route, session) : null

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
  console.log(`\n${dist}  ${route}   390px, 4x CPU, 1.6 Mbps / 150 ms rtt, ${describeCompression(compress)}`)
  if (proof) console.log(`${describeProof(proof)}; load ${load()}`)
  console.log(`first contentful paint ${paint.fcp == null ? 'never' : `${Math.round(paint.fcp)} ms`}\n`)
  console.log(`  ${'start'.padStart(6)} ${'end'.padStart(6)} ${'kB'.padStart(7)}  ${'enc'.padEnd(4)} ${'pri'.padEnd(6)} ${'asset'.padEnd(30)} discovered by`)
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
      `  ${String(s).padStart(6)} ${String(e ?? '').padStart(6)} ${String(kB).padStart(7)}  ${String(r.encoding || '—').padEnd(4)} ${String(r.priority || '').padEnd(6)} ${short(r.url).padEnd(30)} ${cause(r)}`,
    )
    console.log(`         |${bar}|`)
  }

  const total = rows.reduce((n, r) => n + (r.bytes || 0), 0)
  const beforePaint = rows.filter((r) => paint.fcp != null && ms(r.start) <= paint.fcp)
  console.log(`\n  ${rows.length} requests, ${(total / 1000).toFixed(1)} kB on the wire; ${beforePaint.length} started before the paint`)

  if (lcp.length) {
    console.log('\n  largest contentful paint candidates, in the order they took the title')
    for (const c of lcp) {
      console.log(`    ${String(Math.round(c.at)).padStart(6)} ms  ${String(c.size).padStart(7)} px²  ${c.el.padEnd(24)} ${c.url ? short(c.url) : `"${c.text}"`}`)
    }
    console.log(`    the metric is the last of these: ${Math.round(lcp[lcp.length - 1].at)} ms`)
  } else {
    console.log('\n  no largest-contentful-paint candidate was reported')
  }

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
  await context.close()
} finally {
  await browser.close()
  a.server.close()
}
