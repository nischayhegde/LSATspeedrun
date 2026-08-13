/**
 * Which assets a route fetches more than once, and why that is not obvious.
 *
 *   node tools/qa/asset-dupes.mjs frontend/dist --route /office
 *
 * A preload hint only counts if the later real request matches it on URL, `as`
 * and **credentials mode**. Miss the last one and the browser quietly discards
 * the preload and fetches the file again — so a hint added to make a route
 * faster costs it a whole extra download instead, and the only sign is a
 * console warning nobody reads. This counts the requests, which is the part
 * that is not arguable.
 */
import { resolve } from 'node:path'
import { compressionFromOpts } from '../css-split/prod-serve.mjs'
import { devAuthCookies, launch, loadLine, markerFor, serveApp } from '../perf/lib.mjs'

const argv = process.argv.slice(2)
const takes = new Set(['--api', '--email', '--route'])
const opts = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const dist = resolve(positional[0] || 'frontend/dist')
const route = opts['--route'] || '/office'
const apiOrigin = opts['--api'] || 'http://127.0.0.1:5001'

const cookies = await devAuthCookies(apiOrigin, opts['--email'] || 'perf@localhost.test')
const app = await serveApp(dist, apiOrigin, compressionFromOpts(opts))
const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await context.addCookies(cookies.map((c) => ({ ...c })))
const page = await context.newPage()

const asked = new Map()
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.host !== `127.0.0.1:${app.port}`) return
  const key = url.pathname
  const row = asked.get(key) || { n: 0, bytes: 0, modes: new Set() }
  row.n += 1
  row.modes.add(`${request.resourceType()}/${request.headers()['sec-fetch-mode'] || '-'}`)
  asked.set(key, row)
})
page.on('response', async (response) => {
  const url = new URL(response.url())
  if (url.host !== `127.0.0.1:${app.port}`) return
  const row = asked.get(url.pathname)
  if (row) row.bytes = Number(response.headers()['content-length'] || row.bytes)
})

await page.goto(`http://127.0.0.1:${app.port}${route}`, { waitUntil: 'load' })
const marker = markerFor(route)
if (marker) await page.waitForSelector(marker, { timeout: 20000, state: 'attached' })
await page.waitForTimeout(4000)

const dupes = [...asked].filter(([, row]) => row.n > 1).sort((a, b) => b[1].bytes - a[1].bytes)
console.log(`\n${route}   ${asked.size} distinct assets   ${loadLine()}`)
if (!dupes.length) console.log('  no asset fetched twice')
for (const [path, row] of dupes) {
  console.log(`  x${row.n}  ${String(row.bytes).padStart(7)} B  ${path}`)
  console.log(`        modes: ${[...row.modes].join(', ')}`)
}
const wasted = dupes.reduce((sum, [, row]) => sum + row.bytes * (row.n - 1), 0)
console.log(`\n  wasted: ${wasted} B over ${dupes.length} assets\n`)

await browser.close()
app.server.close()
