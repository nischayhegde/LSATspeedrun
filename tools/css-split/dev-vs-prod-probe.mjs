/**
 * One load of each side, described in full: what was requested, what it
 * weighed on the wire, what the console said, and what ended up on screen.
 *
 * `dev-vs-prod.mjs` reports medians, and a median cannot tell you that one of
 * the two sides never rendered. This is the check that both sides are actually
 * showing the app before any timing taken from them is believed, and it is
 * also where the request and byte counts come from, because those do not need
 * repeating and are the part of a dev-vs-prod gap that is not noise.
 *
 * Bytes are read from CDP's `Network.loadingFinished.encodedDataLength`, which
 * is what came off the socket including headers and after content-encoding.
 * The obvious `content-length` header does not work here: `prod-serve.mjs`
 * ends a response with a buffer and no explicit length, so Node sends it
 * chunked and the header is simply absent — counting it reported 34 kB for a
 * page that had just downloaded 489 kB.
 */
import { homedir, loadavg } from 'node:os'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { compressionFromOpts, serveLikeProd } from './prod-serve.mjs'

const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
const CHROME = process.env.LSAT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const argv = process.argv.slice(2)
const takes = new Set(['--route', '--out'])
const opts = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const route = opts['--route'] || '/'
const out = opts['--out'] || '/private/tmp/lsat-perf/.probe'
// `--no-warm` describes the *first* load a server ever answers. On the prod
// side that is a brotli cache miss and uninteresting; on a dev server it is
// the dependency optimizer discovering, pre-bundling and then forcing a full
// page reload, which is what a shared `cacheDir` makes recur.
const warmFirst = !opts['--no-warm']
const [devUrl, distDir] = positional
const prod = await serveLikeProd(resolve(distDir), { compress: compressionFromOpts(opts) })
const browser = await chromium.launch({ executablePath: CHROME })

const look = async (label, origin) => {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  const reqs = []
  try {
    await p.route('**/v1/**', (r) => r.fulfill({
      status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'unauthorized', code: 'unauthorized' }),
    }))
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
    p.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))

    const client = await p.context().newCDPSession(p)
    await client.send('Network.enable')
    const urlById = new Map()
    client.on('Network.requestWillBeSent', (e) => urlById.set(e.requestId, e.request.url))
    client.on('Network.loadingFinished', (e) => {
      reqs.push({ url: urlById.get(e.requestId) || '?', bytes: e.encodedDataLength })
    })

    const t0 = Date.now()
    await p.goto(`${origin}${route}`, { waitUntil: 'load' }).catch((e) => errors.push(`goto: ${String(e).slice(0, 120)}`))
    // Let the app settle: routes are dynamic imports and the redirect out of
    // `/` needs the 401 to come back before the real screen exists.
    await p.waitForTimeout(6000)
    const wall = Date.now() - t0

    const seen = await p.evaluate(() => ({
      path: location.pathname,
      title: document.title,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      nodes: document.querySelectorAll('*').length,
      plate: Boolean(document.querySelector('#opening-plate, .opening-plate')),
    }))
    await p.screenshot({ path: `${out}-${label}.png` }).catch(() => {})

    const total = reqs.reduce((t, x) => t + x.bytes, 0)
    const top = [...reqs].sort((a, b) => b.bytes - a.bytes).slice(0, 12)
    return { label, origin, wall, reqs: reqs.length, total, top, errors, seen }
  } finally {
    await p.close()
  }
}

const kb = (x) => `${(x / 1024).toFixed(1)} kB`
try {
  const results = []
  for (const [label, origin] of [['dev', devUrl], ['prod', `http://127.0.0.1:${prod.port}`]]) {
    // A warm pass first, then the one that is described. The dev server
    // transforms a module the first time it is asked for and the prod server
    // brotlis a file the first time; neither is what a returning visitor pays.
    if (warmFirst) await look(`${label}-warm`, origin)
    results.push(await look(label, origin))
  }
  for (const r of results) {
    console.log(`\n=== ${r.label}  ${r.origin}${route}  (load ${loadavg()[0].toFixed(1)})`)
    console.log(`    wall to load+6s   ${r.wall} ms`)
    console.log(`    requests          ${r.reqs}`)
    console.log(`    wire total        ${kb(r.total)}`)
    console.log(`    ended on          ${r.seen.path}   ${r.seen.nodes} dom nodes`)
    console.log(`    text              ${JSON.stringify(r.seen.text.slice(0, 140))}`)
    if (r.errors.length) console.log(`    console errors    ${r.errors.length}\n      ${r.errors.slice(0, 6).join('\n      ')}`)
    else console.log('    console errors    none')
    console.log('    heaviest:')
    for (const t of r.top) console.log(`      ${kb(t.bytes).padStart(10)}  ${t.url.replace(r.origin, '').slice(0, 96)}`)
  }
  writeFileSync(`${out}.json`, JSON.stringify(results, null, 2))
  console.log(`\n  screenshots ${out}-dev.png / ${out}-prod.png\n`)
} finally {
  await browser.close()
  prod.server.close()
}
