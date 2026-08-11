/**
 * What a catalog thumbnail costs, phase by phase.
 *
 * Handed over by the interface pass: a card costs 170-300 ms and the Firm
 * catalog builds fourteen of them, which is two and a half to four seconds of
 * work to fill one screen. They had already fixed the freeze — the renders were
 * chained through already-resolved promises, which drains as microtasks inside
 * one task, so the browser built eleven scenes and encoded eleven images without
 * yielding — and deliberately left the underlying cost to the art owner.
 *
 * Reducing it means knowing which of the three phases it is in, and from outside
 * the module all three are one synchronous call. So `catalog-asset-render.tsx`
 * publishes `window.__catalogThumbs` under `import.meta.env.DEV`, one row per
 * card, and this reads it after scrolling the whole catalog past the observer.
 *
 *   node tools/light-qa/catalog-thumbs.mjs <tag> [--throttle 4] [--width 640]
 *   node tools/light-qa/catalog-thumbs.mjs first --persist /tmp/thumb-profile
 *   node tools/light-qa/catalog-thumbs.mjs again --persist /tmp/thumb-profile
 *     LIGHT_BASE=http://127.0.0.1:5174
 *     LIGHT_EMAIL=late-firm@localhost.test   # a firm that can see the whole catalog
 *
 * `--throttle` applies CPU throttling through CDP, because a desktop VM is not
 * the machine the complaint came from. It is still not a phone: the real
 * phone cost of this scroll is unknown and this cannot find it out.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHROME, GL_ARGS, chromiumModule, launch } from './browser.mjs'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5174'
const EMAIL = process.env.LIGHT_EMAIL || 'late-firm@localhost.test'
const ROOT = process.env.LIGHT_OUT || fileURLToPath(new URL('../../.light', import.meta.url))
const argv = process.argv.slice(2)
const tag = argv[0] ?? 'thumbs'
const throttle = argv.includes('--throttle') ? Number(argv[argv.indexOf('--throttle') + 1] || 4) : 1
/**
 * Which way out of the canvas this arm takes, in one server lifetime:
 *   dataurl  the original, `toDataURL('image/webp')` on the WebGL canvas
 *   blob     the same encoder reached asynchronously
 *   via2d    copied into a 2D canvas first, then encoded from that
 *   jpeg     via2d, encoded as JPEG rather than WebP
 */
const path = ['dataurl', 'blob', 'via2d', 'jpeg'].find((name) => argv.includes(`--${name}`))
const SHOTS = `${ROOT}/.light-shots/thumbs-${tag}`
const REPORTS = `${ROOT}/.light-run`
mkdirSync(SHOTS, { recursive: true })
mkdirSync(REPORTS, { recursive: true })

const report = { tag, base: BASE, email: EMAIL, throttle, encoder: path ?? 'shipped', at: new Date().toISOString(), errors: [] }
/*
 * A profile directory on disk, when a run wants to ask whether the persistent
 * store works. Every other arm uses a throwaway context, which is right: a
 * measurement of what a catalog costs to build should not quietly become a
 * measurement of what it costs to read back. `--persist <dir>` opts in, and a
 * second run against the same directory is the second session.
 */
const profile = argv.includes('--persist') ? argv[argv.indexOf('--persist') + 1] : null
const viewport = { width: 1440, height: 900 }
const chromium = profile ? await chromiumModule() : null
const context = profile
  ? await chromium.launchPersistentContext(profile, { executablePath: CHROME, args: GL_ARGS, viewport })
  : await launch()
report.profile = profile
const page = profile ? await context.newPage() : await context.newPage({ viewport })
page.on('pageerror', (error) => report.errors.push(String(error.message).slice(0, 300)))
page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text().slice(0, 300)) })

try {
  const session = await page.context().newCDPSession(page)
  if (throttle > 1) await session.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  if (path) await page.addInitScript((name) => { window.__thumbEncode = name }, path)
  if (argv.includes('--shadow')) {
    const value = Number(argv[argv.indexOf('--shadow') + 1])
    report.shadow = value
    await page.addInitScript((entry) => { window.__thumbShadow = entry }, value)
  }
  if (argv.includes('--quality')) {
    const value = Number(argv[argv.indexOf('--quality') + 1])
    report.quality = value
    await page.addInitScript((entry) => { window.__thumbQuality = entry }, value)
  }
  if (argv.includes('--finish')) await page.addInitScript(() => { window.__thumbFinish = true })
  // `--width 640` pins the capture rung, so the resolution arms are comparable
  // on a machine whose own device pixel ratio would otherwise choose one.
  if (argv.includes('--width')) {
    const width = Number(argv[argv.indexOf('--width') + 1])
    report.width = width
    await page.addInitScript((value) => { window.__thumbWidth = value }, width)
  }

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const signedIn = await page.evaluate(async (email) => {
    const response = await fetch('/v1/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, display_name: 'Late Firm' }),
    })
    return response.status
  }, EMAIL)
  if (signedIn !== 200) throw new Error(`dev sign-in for ${EMAIL} returned ${signedIn}`)

  await page.goto(`${BASE}/firm`, { waitUntil: 'domcontentloaded' })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const layer = page.locator('.cutscene-defer, .chapter-prompt-later, .tour-offer-decline')
    if (await layer.count() === 0) break
    await layer.first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(300)
  }
  await page.waitForSelector('.av-card-render', { timeout: 60000 })

  /*
   * The whole catalog, not the first screen. Cards render on an intersection
   * observer with a 320px margin, so the cost of the catalog is only visible to
   * a harness that scrolls it the way a player does. Long tasks are collected
   * for the same reason the interface pass was looking at them: the total cost
   * matters less than whether it lands in one block or in many.
   */
  await page.evaluate(() => {
    window.__longTasks = []
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(Number(entry.duration.toFixed(1)))
      }).observe({ entryTypes: ['longtask'] })
    } catch { /* not every build reports long tasks */ }
  })
  const started = Date.now()
  let settled = 0
  for (let pass = 0; pass < 60; pass += 1) {
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(400)
    const state = await page.evaluate(() => ({
      cards: document.querySelectorAll('.av-card-render').length,
      ready: document.querySelectorAll('.av-card-render.is-ready').length,
      rendered: (window.__catalogThumbs ?? []).length,
      bottom: window.scrollY + window.innerHeight >= document.body.scrollHeight - 4,
    }))
    if (state.bottom && state.ready === state.cards) {
      settled += 1
      if (settled >= 3) break
    } else settled = 0
  }
  const elapsed = Date.now() - started

  const measured = await page.evaluate(() => ({
    timings: window.__catalogThumbs ?? [],
    longTasks: (window.__longTasks ?? []).sort((a, b) => b - a),
    cards: document.querySelectorAll('.av-card-render').length,
    ready: document.querySelectorAll('.av-card-render.is-ready').length,
  }))
  report.cards = measured.cards
  report.ready = measured.ready
  report.scrollMs = elapsed
  report.timings = measured.timings
  report.longTasks = measured.longTasks.slice(0, 12)

  const sum = (list) => list.reduce((total, value) => total + value, 0)
  const totals = {
    build: sum(measured.timings.map((row) => row.build)),
    draw: sum(measured.timings.map((row) => row.draw)),
    encode: sum(measured.timings.map((row) => row.encode)),
    // What the encode costs the main thread, as against how long it takes: the
    // whole point of `toBlob` is that those two stopped being the same number.
    blocked: sum(measured.timings.map((row) => row.blocked ?? row.encode)),
    bytes: sum(measured.timings.map((row) => row.bytes)),
  }
  const count = measured.timings.length || 1
  const per = (value) => (value / count).toFixed(1)
  report.totals = totals
  report.perCard = {
    total: Number(per(totals.build + totals.draw + totals.encode)),
    build: Number(per(totals.build)),
    draw: Number(per(totals.draw)),
    encode: Number(per(totals.encode)),
    blocking: Number(per(totals.build + totals.draw + totals.blocked)),
    kb: Number((totals.bytes / count / 1024).toFixed(1)),
  }

  console.log(`\n${measured.timings.length} thumbnails, ${measured.ready}/${measured.cards} cards ready, ${(elapsed / 1000).toFixed(1)}s of scrolling at ${throttle}x throttle`)
  console.log(`per card: ${report.perCard.total}ms = build ${report.perCard.build} + draw ${report.perCard.draw} + encode ${report.perCard.encode}`
    + `, of which ${report.perCard.blocking}ms on the main thread, ${report.perCard.kb} kB`)
  const slowest = [...measured.timings].sort((a, b) => (b.build + b.draw + b.encode) - (a.build + a.draw + a.encode)).slice(0, 8)
  for (const row of slowest) {
    console.log(`  ${row.key.padEnd(24)} ${String((row.build + row.draw + row.encode).toFixed(0)).padStart(4)}ms  build ${String(row.build).padStart(6)}  draw ${String(row.draw).padStart(6)}  encode ${String(row.encode).padStart(5)}  ${(row.bytes / 1024).toFixed(0)}kB`)
  }
  console.log(`long tasks over 50ms: ${measured.longTasks.length}, worst ${measured.longTasks[0] ?? 0}ms`)

  /*
   * Stills of the cards as the player sees them — at the size the grid gives
   * them, not at the size they were captured — because the question a resolution
   * arm has to answer is whether the card looks right in the catalog, and an
   * image inspected at its own pixel size cannot answer it.
   */
  const keys = await page.evaluate(() => [...document.querySelectorAll('.av-card-render[data-render-key]')]
    .map((node) => node.getAttribute('data-render-key')))
  report.natural = await page.evaluate(() => {
    const img = document.querySelector('.av-card-render img')
    return img ? { natural: [img.naturalWidth, img.naturalHeight], shown: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)] } : null
  })
  for (const key of keys.slice(0, 8)) {
    const card = page.locator(`.av-card-render[data-render-key="${key}"]`).first()
    if (await card.count()) {
      await card.scrollIntoViewIfNeeded().catch(() => {})
      await card.screenshot({ path: `${SHOTS}/${key}.png` }).catch(() => {})
    }
  }
  if (report.natural) console.log(`card image ${report.natural.natural.join('x')} shown at ${report.natural.shown.join('x')}`)
} finally {
  writeFileSync(`${REPORTS}/catalog-thumbs-${tag}.json`, JSON.stringify(report, null, 2))
  await context.close().catch(() => {})
}
console.log(`\nwrote ${REPORTS}/catalog-thumbs-${tag}.json and cards in ${SHOTS}`)
