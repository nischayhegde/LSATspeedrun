/**
 * Two builds, alternating loads, and an honest account of the spread.
 *
 * `css-prove.mjs --fcp-only` does the same job with seven pairs in one run.
 * Seven turned out not to be enough: two sessions of seven disagreed by more
 * than the effect one of them was measuring, so the shape here is sessions of
 * pairs, with each session's own median printed rather than pooled away. If the
 * sessions disagree, that is the result and it is visible.
 *
 * Each load is a fresh context — `browser.newPage()` gives one — so nothing is
 * served from a previous run's cache, and base and head alternate inside every
 * pair rather than being run in two blocks, because the machine has three other
 * workstreams and a headless browser or two on it and drifts over minutes.
 *
 * Two numbers are taken, not one. First contentful paint is what the
 * predecessors moved; largest contentful paint is the check that first paint
 * was not bought by painting something sooner and the actual screen no later.
 *
 * The bytes go over the wire compressed, because production's CloudFront
 * compresses them — see `prod-serve.mjs`. That was an opt-in flag here and the
 * default everywhere was raw, which meant the sizes deciding what sat on the
 * critical path were inflated about 4.6x for CSS and JS while the fonts, being
 * deflate inside already, measured true. Numbers taken before that changed are
 * raw-wire numbers and are not comparable with numbers taken since.
 *
 *   node tools/css-split/fcp-ab.mjs /tmp/base /tmp/head
 *   ... --sessions 3 --pairs 7    the default shape, 21 pairs
 *   ... --route /office           somewhere other than /
 *   ... --gzip                    gzip everywhere, as prod would for a viewer with no brotli
 *   ... --no-compress             the raw bytes every number before this was taken on
 *   ... --offline-fonts           refuse the third-party font origins
 */
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { compressionFromOpts, describeCompression, serveLikeProd } from './prod-serve.mjs'
const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
const CHROME = process.env.LSAT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const argv = process.argv.slice(2)
const takes = new Set(['--sessions', '--pairs', '--route'])
const opts = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const sessions = Number(opts['--sessions'] || 3)
const pairs = Number(opts['--pairs'] || 7)
const route = opts['--route'] || '/'
const useGzip = Boolean(opts['--gzip'])
const offlineFonts = Boolean(opts['--offline-fonts'])
const [baseDist, headDist] = positional.map((p) => resolve(p))

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.webp': 'image/webp',
}
// What CloudFront will and will not compress. woff2 is already deflate inside,
// and compressing it again is what a real CDN declines to do.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json'])

function serve(root) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (url.startsWith('/v1/')) {
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ detail: 'unauthorized', code: 'unauthorized' }))
      return
    }
    let file = join(root, url)
    if (!existsSync(file) || !extname(file)) file = join(root, 'index.html')
    try {
      let body = await readFile(file)
      const head = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }
      if (useGzip && COMPRESSIBLE.has(extname(file)) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        body = gzipSync(body, { level: 6 })
        head['content-encoding'] = 'gzip'
      }
      res.writeHead(200, head)
      res.end(body)
    } catch { res.writeHead(404); res.end('no') }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })))
}

const a = await serve(baseDist)
const b = await serve(headDist)
const browser = await chromium.launch({ executablePath: CHROME })

/** One cold load. Returns first and largest contentful paint in ms. */
const run = async (port) => {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    if (offlineFonts) {
      await p.route('**://fonts.googleapis.com/**', (r) => r.abort())
      await p.route('**://fonts.gstatic.com/**', (r) => r.abort())
    }
    const client = await p.context().newCDPSession(p)
    await client.send('Network.enable')
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
    })
    await p.addInitScript(() => {
      window.__paints = { fcp: null, lcp: null }
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === 'first-contentful-paint' && window.__paints.fcp == null) window.__paints.fcp = e.startTime
      }).observe({ type: 'paint', buffered: true })
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__paints.lcp = e.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    })
    await p.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'commit' })
    await p.waitForFunction(() => window.__paints && window.__paints.fcp != null, null, { timeout: 30000 }).catch(() => {})
    // Largest contentful paint is only final once nothing bigger can arrive.
    // The scene chunks on this app are still landing at 6 s throttled.
    await p.waitForTimeout(8000)
    return p.evaluate(() => window.__paints)
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

try {
  console.log(`\n  base ${baseDist}\n  head ${headDist}`)
  console.log(`  ${route} at 390px, 4x CPU, 1.6 Mbps / 150 ms rtt${useGzip ? ', gzipped like prod' : ', uncompressed'}${offlineFonts ? ', font origins refused' : ''}`)
  console.log(`  ${sessions} sessions of ${pairs} interleaved pairs\n`)

  const all = { base: { fcp: [], lcp: [] }, head: { fcp: [], lcp: [] } }
  const perSession = []
  for (let s = 0; s < sessions; s += 1) {
    const sess = { base: { fcp: [], lcp: [] }, head: { fcp: [], lcp: [] } }
    let headWins = 0
    for (let i = 0; i < pairs; i += 1) {
      // Alternate which side goes first, so a systematic cost of being the
      // first load in a pair cannot land on the same build every time.
      const baseFirst = (i + s) % 2 === 0
      const x = baseFirst ? await run(a.port) : null
      const y = await run(b.port)
      const z = baseFirst ? null : await run(a.port)
      const bs = x || z
      for (const k of ['fcp', 'lcp']) { sess.base[k].push(bs[k]); sess.head[k].push(y[k]) }
      if (bs.fcp != null && y.fcp != null && y.fcp < bs.fcp) headWins += 1
      process.stdout.write(`    s${s + 1} pair ${String(i + 1).padStart(2)}   base fcp ${r(bs.fcp).padStart(5)} lcp ${r(bs.lcp).padStart(5)}   head fcp ${r(y.fcp).padStart(5)} lcp ${r(y.lcp).padStart(5)}   ${y.fcp < bs.fcp ? 'head' : 'base'}\n`)
    }
    for (const side of ['base', 'head']) for (const k of ['fcp', 'lcp']) all[side][k].push(...sess[side][k])
    perSession.push({ sess, headWins })
    console.log(
      `    session ${s + 1} median   fcp base ${r(median(sess.base.fcp))} head ${r(median(sess.head.fcp))}`
      + `  (${r(median(sess.base.fcp) - median(sess.head.fcp))} ms)`
      + `   lcp base ${r(median(sess.base.lcp))} head ${r(median(sess.head.lcp))}`
      + `   head won ${headWins}/${pairs}\n`,
    )
  }

  const spread = (xs) => `${r(Math.min(...xs))}–${r(Math.max(...xs))}`
  const sessFcp = (side) => perSession.map((p) => median(p.sess[side].fcp))
  const totalWins = perSession.reduce((n, p) => n + p.headWins, 0)
  const n = sessions * pairs
  console.log(`  pooled over ${n} pairs`)
  console.log(`    fcp  base ${r(median(all.base.fcp))} ms   head ${r(median(all.head.fcp))} ms   ${r(median(all.base.fcp) - median(all.head.fcp))} ms faster`)
    console.log(`    lcp  base ${r(median(all.base.lcp))} ms   head ${r(median(all.head.lcp))} ms   ${r(median(all.base.lcp) - median(all.head.lcp))} ms faster`)
  console.log(`    head won ${totalWins} of ${n} pairs on fcp`)
  console.log(`    per-session fcp medians  base ${sessFcp('base').map(r).join(', ')} (spread ${spread(sessFcp('base'))})`)
  console.log(`                             head ${sessFcp('head').map(r).join(', ')} (spread ${spread(sessFcp('head'))})`)
  const betweenSession = Math.max(...sessFcp('base')) - Math.min(...sessFcp('base'))
  const effect = median(all.base.fcp) - median(all.head.fcp)
  console.log(`\n    the effect is ${r(effect)} ms; the baseline moved ${r(betweenSession)} ms between sessions on its own`)
  console.log(`    ${Math.abs(effect) > betweenSession ? 'the effect is larger than the drift' : 'THE EFFECT IS INSIDE THE NOISE — do not claim it'}\n`)
} finally {
  await browser.close()
  a.server.close()
  b.server.close()
}
