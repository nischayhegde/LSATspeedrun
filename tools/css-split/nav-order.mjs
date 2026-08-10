/**
 * Checks that a screen walked to looks like the same screen loaded cold.
 *
 * On a cold load the inline script in `<head>` writes the route's sheets itself
 * and knows which side of the entry link each belongs on. On a client-side
 * navigation nothing of the sort happens: the route's chunk is fetched, Vite's
 * preload helper appends a `<link>` for each stylesheet it owns to the end of
 * `<head>`, and they all land behind the entry sheet in whatever order the
 * helper reached them. For the sheets cut out of `mobile.css` that is already
 * the right place. For the six cut out of `styles.css` it is not, and the
 * `MutationObserver` exists to pull those back in front — walking from /office
 * to /firm would otherwise give `rival-war-room.css` a precedence a cold /firm
 * never gives it.
 *
 * That observer now has to sort arrivals into two piles instead of one, so this
 * asks the question directly and for both piles at once. Load some other route,
 * append this route's sheets by hand in the worst order there is — exactly what
 * the helper does, `document.head.appendChild`, and deliberately backwards —
 * and read the order that comes out. It has to be the order a cold load of that
 * route produces. The app is not involved and does not need to boot; the code
 * on trial is the observer.
 *
 *   node tools/css-split/nav-order.mjs frontend/dist
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)

const dist = resolve(process.argv[2])
const html = readFileSync(join(dist, 'index.html'), 'utf8')
// `,K=` is the shape from before sheets could go behind the entry link, where
// every route sheet went in front of it. Reading it too is what lets the same
// question be put to a build from before the change.
const declared = html.match(/var R=(\[[\s\S]*?\]\]),[BK]=/)
if (!declared) throw new Error('no route stylesheet map in the document')
const byRoute = JSON.parse(declared[1]).map((row) => (row.length === 3 ? row : [row[0], row[1], []]))
/** A path each pattern accepts, so a real navigation can be aimed at it. */
const SAMPLE = { '^\\/office$': '/office', '^\\/map$': '/map', '^\\/progress$': '/progress', '^\\/(cases|practice)$': '/cases', '^\\/(cases|practice)\\/.+': '/cases/7', '^\\/firm$': '/firm', '^\\/story$': '/story', '^\\/onboarding$': '/onboarding', '^\\/login$': '/login' }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary' }
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  let file = join(dist, url)
  if (!existsSync(file) || !extname(file)) file = join(dist, 'index.html')
  try {
    let body = await readFile(file)
    if (file.endsWith('index.html')) {
      body = Buffer.from(body.toString('utf8').replace(/<script type="module"[^>]*><\/script>/g, ''))
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch { res.writeHead(404); res.end('no') }
})
const port = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)))

const ORDER = () => [...document.querySelectorAll('link[rel="stylesheet"]')]
  .map((l) => l.getAttribute('href')).filter((h) => h.startsWith('/assets/'))
const APPEND = (hrefs) => {
  for (const href of hrefs) {
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = href
    document.head.appendChild(l)
  }
}

const browser = await chromium.launch()
let bad = 0
try {
  for (const [pattern, before, after] of byRoute) {
    const route = SAMPLE[pattern]
    const own = [...before, ...after]

    // The entry sheet stays in the compared sequence; which side of it each
    // route sheet sits on is the whole question.
    const mine = (h) => own.includes(h) || /index-[^/]*\.css$/.test(h)

    const cold = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await cold.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'load' })
    const coldOrder = (await cold.evaluate(ORDER)).filter(mine)
    await cold.close()

    // `/` matches no pattern, so it starts with the entry sheet and nothing
    // else, which is what a visitor who lands anywhere else and walks here has.
    const walked = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await walked.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
    await walked.evaluate(APPEND, [...own].reverse())
    await walked.waitForTimeout(120)
    const walkedOrder = (await walked.evaluate(ORDER)).filter(mine)
    await walked.close()

    const same = JSON.stringify(coldOrder) === JSON.stringify(walkedOrder)
    if (!same) bad += 1
    const entryPlace = coldOrder.findIndex((h) => /index-[^/]*\.css$/.test(h))
    console.log(
      `  ${route.padEnd(12)} ${before.length} before the entry, ${after.length} behind it, entry at ${entryPlace}` +
        `   ${same ? 'walked order matches a cold load' : 'DIFFERS'}`,
    )
    if (!same) {
      console.log(`      cold   ${coldOrder.join(' ')}`)
      console.log(`      walked ${walkedOrder.join(' ')}`)
    }
  }
  console.log(`\n${bad} of ${byRoute.length} routes disagree with themselves\n`)
} finally {
  await browser.close()
  server.close()
}
process.exit(bad ? 1 : 0)
