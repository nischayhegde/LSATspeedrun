/**
 * The dev server against the production build, on one machine, interleaved.
 *
 * Every perf number in this repository so far compares two production builds
 * with each other. The user is not looking at a production build: they are
 * looking at a Vite dev server on 5273, on a machine that has been running
 * seven of them plus two preview servers plus a headless browser or two, at
 * load averages between 8 and 79. Before anything is cut from the bundle it is
 * worth knowing how much of what they see survives `vite build`, because a dev
 * server serves every source module as its own request, unminified, with
 * sourcemaps and a 875 kB pre-bundled `lucide-react`, and none of that is
 * bloat anyone can remove — it is what a dev server is.
 *
 * Shape is taken from `fcp-ab.mjs` and the reasons there apply here: fresh
 * context per load, alternating sides inside each pair, sessions kept separate
 * so disagreement between them is visible rather than pooled away, and the
 * production side served through `prod-serve.mjs` so its bytes are compressed
 * the way CloudFront compresses them.
 *
 * Two things this adds, both because the machine is the confound:
 *
 *  - The 1-minute load average is read either side of every load and carried
 *    with it. A run taken while a neighbouring worker starts a build is not a
 *    measurement of anything, and `--max-load` discards it rather than letting
 *    it into a median.
 *  - Requests and wire bytes are counted per load. The interesting part of a
 *    dev-vs-prod gap is usually not the milliseconds, it is that one side asked
 *    for 40 files and the other asked for 400.
 *
 * Three metrics, and the third is the one that matters here. First contentful
 * paint is the opening plate in `index.html` on *both* sides — same markup,
 * same inline rules, no dependency on either server — so it cannot tell these
 * two apart and is only kept as a check that neither side regressed it. What a
 * reader calls "the page loaded" is the plate leaving, which the document's own
 * script does when React has mounted and the stylesheet is in; `app` is the
 * time of that removal, and it is directly comparable across dev and prod
 * because the same script decides it on both.
 *
 * Bytes come from CDP's `Network.loadingFinished.encodedDataLength` rather than
 * from `content-length`: `prod-serve.mjs` ends responses with a buffer and no
 * explicit length, so Node sends them chunked, the header is absent, and
 * counting it reported 34 kB for a page that had downloaded 482 kB.
 *
 * `/v1/*` is answered 401 in the browser on both sides, so neither depends on a
 * backend and both take the same branch through the app.
 *
 * The default is unthrottled, which is the opposite of `fcp-ab.mjs` and is on
 * purpose: the question here is not what a phone on a 1.6 Mbps link sees, it is
 * what the user sees on this machine over localhost, where the cost is CPU and
 * dev-server transforms rather than bandwidth. `--throttle` asks the other
 * question.
 *
 *   node tools/css-split/dev-vs-prod.mjs http://127.0.0.1:5281 frontend/dist
 *   ... --route /progress --sessions 3 --pairs 5
 *   ... --max-load 40        discard any load taken above this 1-min average
 *   ... --throttle           a 4x-throttled phone on 1.6 Mbps instead
 */
import { homedir, loadavg } from 'node:os'
import { resolve } from 'node:path'
import { compressionFromOpts, describeCompression, serveLikeProd } from './prod-serve.mjs'

const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
const CHROME = process.env.LSAT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const argv = process.argv.slice(2)
const takes = new Set(['--sessions', '--pairs', '--route', '--max-load'])
const opts = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const sessions = Number(opts['--sessions'] || 3)
const pairs = Number(opts['--pairs'] || 5)
const route = opts['--route'] || '/'
const maxLoad = opts['--max-load'] ? Number(opts['--max-load']) : Infinity
const throttle = Boolean(opts['--throttle'])
const compress = compressionFromOpts(opts)
const [devUrl, distDir] = positional
const prod = await serveLikeProd(resolve(distDir), { compress })
const browser = await chromium.launch({ executablePath: CHROME })

/**
 * One cold load. Returns paints, request count, wire bytes, and the load
 * average either side of it so a contended run can be thrown out afterwards.
 */
const run = async (origin) => {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const before = loadavg()[0]
  try {
    // The same 401 on both sides, so neither needs a backend and both take the
    // same branch out of `/`.
    await p.route('**/v1/**', (r) => r.fulfill({
      status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'unauthorized', code: 'unauthorized' }),
    }))
    let requests = 0
    let bytes = 0
    const client = await p.context().newCDPSession(p)
    await client.send('Network.enable')
    client.on('Network.loadingFinished', (e) => { requests += 1; bytes += e.encodedDataLength })
    if (throttle) {
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await client.send('Network.emulateNetworkConditions', {
        offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
      })
    }
    await p.addInitScript(() => {
      window.__paints = { fcp: null, lcp: null, app: null }
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === 'first-contentful-paint' && window.__paints.fcp == null) window.__paints.fcp = e.startTime
      }).observe({ type: 'paint', buffered: true })
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__paints.lcp = e.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      // The plate leaving is the app arriving; `index.html` removes `#boot`
      // once React has mounted and the entry sheet is in. Watching for the
      // removal rather than for any app markup keeps this identical on a dev
      // server, which has no separate entry stylesheet to wait for.
      const seen = () => {
        if (window.__paints.app != null) return true
        const root = document.getElementById('root')
        if (!document.getElementById('boot') && root && root.firstChild) {
          window.__paints.app = performance.now()
          return true
        }
        return false
      }
      // An init script runs before the parser has produced `<html>`, so
      // observing `document.documentElement` here throws and takes the rest of
      // this script with it — which is how `app` came back null on both sides
      // while `fcp` and `lcp`, registered above, kept working. The observer is
      // therefore attached as soon as there is something to attach it to, and a
      // slow poll backs it up so a missed mutation costs precision, not the
      // measurement.
      const watch = () => {
        new MutationObserver(seen).observe(document.documentElement, { childList: true, subtree: true })
        const poll = setInterval(() => { if (seen()) clearInterval(poll) }, 25)
        seen()
      }
      if (document.documentElement) watch()
      else {
        const wait = setInterval(() => { if (document.documentElement) { clearInterval(wait); watch() } }, 2)
      }
    })
    await p.goto(`${origin}${route}`, { waitUntil: 'commit' })
    await p.waitForFunction(() => window.__paints && window.__paints.app != null, null, { timeout: 40000 }).catch(() => {})
    await p.waitForTimeout(throttle ? 8000 : 4000)
    // `return await`, not `return` — see the note in `fcp-ab.mjs`; the finally
    // closes the page while a bare return's promise is still in flight.
    const paints = await p.evaluate(() => window.__paints)
    return { ...paints, requests, bytes, load: Math.max(before, loadavg()[0]) }
  } finally {
    await p.close()
  }
}

/** One untimed, unthrottled load per side. Warms brotli on one and, on the
 * other, whatever the dev server still has to transform and pre-bundle. */
const warm = async (origin) => {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    await p.route('**/v1/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
    await p.goto(`${origin}${route}`, { waitUntil: 'load' }).catch(() => {})
    await p.waitForTimeout(2500)
  } finally {
    await p.close()
  }
}

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((x, y) => x - y)
  if (!v.length) return null
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
}
const r = (x) => (x == null ? '—' : String(Math.round(x)))
const kb = (x) => (x == null ? '—' : `${(x / 1024).toFixed(0)} kB`)

try {
  console.log(`\n  dev   ${devUrl}`)
  console.log(`  prod  ${resolve(distDir)} (${describeCompression(compress)})`)
  console.log(`  ${route} at 390px, ${throttle ? '4x CPU, 1.6 Mbps / 150 ms rtt' : 'no throttle'}`)
  console.log(`  ${sessions} sessions of ${pairs} interleaved pairs, discarding loads above load ${maxLoad}\n`)

  await warm(devUrl)
  await warm(`http://127.0.0.1:${prod.port}`)

  const all = { dev: [], prod: [] }
  const perSession = []
  let dropped = 0
  for (let s = 0; s < sessions; s += 1) {
    const sess = { dev: [], prod: [] }
    for (let i = 0; i < pairs; i += 1) {
      const devFirst = (i + s) % 2 === 0
      const d = devFirst ? await run(devUrl) : null
      const q = await run(`http://127.0.0.1:${prod.port}`)
      const d2 = devFirst ? null : await run(devUrl)
      const dev = d || d2
      const load = Math.max(dev.load, q.load)
      const keep = load <= maxLoad
      if (keep) { sess.dev.push(dev); sess.prod.push(q) } else dropped += 1
      process.stdout.write(
        `    s${s + 1} pair ${String(i + 1).padStart(2)}  load ${load.toFixed(1).padStart(5)}`
        + `   dev app ${r(dev.app).padStart(6)} lcp ${r(dev.lcp).padStart(5)} ${String(dev.requests).padStart(3)} reqs ${kb(dev.bytes).padStart(9)}`
        + `   prod app ${r(q.app).padStart(5)} lcp ${r(q.lcp).padStart(5)} ${String(q.requests).padStart(3)} reqs ${kb(q.bytes).padStart(8)}`
        + `${keep ? '' : '   DISCARDED'}\n`,
      )
    }
    for (const side of ['dev', 'prod']) all[side].push(...sess[side])
    perSession.push(sess)
    const m = (side, k) => median(sess[side].map((x) => x[k]))
    console.log(
      `    session ${s + 1} median   app dev ${r(m('dev', 'app'))} prod ${r(m('prod', 'app'))}`
      + `   lcp dev ${r(m('dev', 'lcp'))} prod ${r(m('prod', 'lcp'))}\n`,
    )
  }

  const med = (side, k) => median(all[side].map((x) => x[k]))
  const sessMed = (side, k) => perSession.map((p) => median(p[side].map((x) => x[k])))
  const spread = (xs) => `${r(Math.min(...xs))}–${r(Math.max(...xs))}`
  console.log(`  pooled over ${all.dev.length} kept pairs${dropped ? `, ${dropped} discarded for load` : ''}`)
  for (const k of ['app', 'lcp', 'fcp']) {
    const effect = med('dev', k) - med('prod', k)
    const drift = Math.max(...sessMed('prod', k)) - Math.min(...sessMed('prod', k))
    console.log(`\n    ${k}  dev ${r(med('dev', k))} ms   prod ${r(med('prod', k))} ms   prod is ${r(effect)} ms faster (${(med('dev', k) / med('prod', k)).toFixed(1)}x)`)
    console.log(`         per-session medians  dev ${sessMed('dev', k).map(r).join(', ')} (spread ${spread(sessMed('dev', k))})`)
    console.log(`                              prod ${sessMed('prod', k).map(r).join(', ')} (spread ${spread(sessMed('prod', k))})`)
    console.log(`         the gap is ${r(effect)} ms; prod moved ${r(drift)} ms between sessions on its own`)
  }
  console.log(`\n    requests  dev ${r(med('dev', 'requests'))}   prod ${r(med('prod', 'requests'))}`)
  console.log(`    wire      dev ${kb(med('dev', 'bytes'))}   prod ${kb(med('prod', 'bytes'))}`)
  const loads = all.dev.concat(all.prod).map((x) => x.load)
  console.log(`    load average over the run  ${Math.min(...loads).toFixed(1)}–${Math.max(...loads).toFixed(1)}\n`)
} finally {
  await browser.close()
  prod.server.close()
}
