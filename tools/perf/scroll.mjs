/**
 * How smoothly a panel scrolls, measured rather than felt.
 *
 *   node tools/perf/scroll.mjs frontend/dist --panel firm-staff
 *   ... --panel firm-upgrades --panel firm-staff    several in one lifetime
 *   ... --frames 240 --api http://127.0.0.1:5001 --email perf@localhost.test
 *
 * The claim this exists to test is "the Firm tab's Staff panel scrolls at
 * ~33 ms against 16.7 ms on Districts". That is a comparison, so this tool
 * always takes one: every panel is measured against a *reference* panel on the
 * same screen, in the same browser lifetime, with the same scroll. A frame time
 * on its own says more about the machine than about the app.
 *
 * What is measured is the interval between animation frames while the page is
 * being scrolled a fixed distance per frame. That is the number a reader
 * experiences. Long tasks are collected alongside it, because a median frame of
 * 33 ms with no long tasks is a throttled render loop doing its job, and the
 * same median with 200 ms tasks in it is jank; the two want opposite fixes.
 *
 * CPU throttling is on (`EMULATION.cpuThrottle`) for the same reason the load
 * harness uses it: an unthrottled desktop renders fourteen WebGL figures
 * comfortably and reports every version of this code as perfect.
 */
import { resolve } from 'node:path'
import { compressionFromOpts } from '../css-split/prod-serve.mjs'
import { EMULATION, describeCompression, devAuthCookies, launch, loadLine, median, serveApp } from './lib.mjs'

const argv = process.argv.slice(2)
const takes = new Set(['--panel', '--frames', '--api', '--email', '--runs'])
const opts = {}
const panels = []
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--panel') { panels.push(argv[i + 1]); i += 1 }
  else if (takes.has(argv[i])) { opts[argv[i]] = argv[i + 1]; i += 1 }
  else if (argv[i].startsWith('--')) opts[argv[i]] = true
  else positional.push(argv[i])
}
const dist = resolve(positional[0] || 'frontend/dist')
const apiOrigin = opts['--api'] || 'http://127.0.0.1:5001'
const email = opts['--email'] || 'perf@localhost.test'
const frames = Number(opts['--frames'] || 180)
const runs = Number(opts['--runs'] || 3)
const compress = compressionFromOpts(opts)
if (!panels.length) panels.push('firm-staff')

/**
 * A panel is a route, the control that opens it, and the element that proves it
 * opened. `reference` names the panel to compare against — the same screen with
 * the suspect content swapped out, so the difference between them is the
 * content and not the screen.
 */
const PANELS = {
  'firm-staff': {
    route: '/firm',
    open: '#firm-tab-staff',
    settled: '.firm-panel-staff .firm-staff-roster-stage',
    reference: 'firm-districts',
    note: 'the roster stage, one three.js figure per member of staff',
  },
  'firm-upgrades': {
    route: '/firm',
    open: '#firm-tab-upgrades',
    settled: '.firm-panel-upgrades .catalog-toolbar',
    note: 'the same screen with 2D catalog cards instead',
  },
  'firm-districts': {
    route: '/firm',
    open: '#firm-tab-connections',
    settled: '.firm-panel-connections .retainer-ledger',
    note: 'the counsel ledger, the panel the original report clocked at 16.7 ms',
  },
}

/**
 * Scroll the window a fixed step per animation frame and record the intervals.
 *
 * Deliberately not `mouse.wheel` in a loop: that measures the input pipeline as
 * much as the render, and it varies between runs. A fixed `scrollBy` per frame
 * makes every run scroll exactly the same distance through exactly the same
 * content, so two panels differ only in what they have to draw.
 */
const scrollProbe = async (page, count) => page.evaluate(async (n) => {
  const longTasks = []
  let observer = null
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration))
    })
    observer.observe({ type: 'longtask', buffered: false })
  } catch { /* longtask is not everywhere; the frame intervals still stand */ }

  const gaps = []
  const height = document.documentElement.scrollHeight - window.innerHeight
  const step = Math.max(2, Math.round((height * 2) / n))
  let last = performance.now()
  let down = true
  await new Promise((done) => {
    let seen = 0
    const tick = (now) => {
      gaps.push(now - last)
      last = now
      const y = window.scrollY
      if (down && y + step >= height) down = false
      else if (!down && y - step <= 0) down = true
      window.scrollBy(0, down ? step : -step)
      seen += 1
      if (seen >= n) return done()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  observer?.disconnect()
  // The first interval spans whatever the page was doing before the probe
  // started, so it belongs to the setup and not to the scroll.
  return { gaps: gaps.slice(1), longTasks, scrollable: height }
}, count)

const percentile = (values, p) => {
  const v = [...values].sort((a, b) => a - b)
  if (!v.length) return null
  return v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))]
}

async function measurePanel(browser, cookies, origin, name) {
  const panel = PANELS[name]
  if (!panel) throw new Error(`unknown panel "${name}"; try ${Object.keys(PANELS).join(', ')}`)
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } })
  await context.addCookies(cookies.map((c) => ({ ...c })))
  const page = await context.newPage()
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: EMULATION.cpuThrottle })

  await page.goto(`${origin}${panel.route}`, { waitUntil: 'load' })
  const landed = new URL(page.url()).pathname
  if (landed !== panel.route) {
    await context.close()
    return { name, void: `bounced to ${landed}` }
  }
  if (panel.open) await page.click(panel.open, { timeout: 15000 })
  await page.waitForSelector(panel.settled, { timeout: 20000 })
  // Let the WebGL figures reach their steady state. A panel measured while its
  // canvases are still being created reports the build cost, not the scroll.
  await page.waitForTimeout(3500)

  const result = await scrollProbe(page, frames)
  await context.close()
  if (result.scrollable < 200) return { name, void: `nothing to scroll (${result.scrollable}px)` }
  return {
    name,
    note: panel.note,
    median: Math.round(median(result.gaps)),
    p95: Math.round(percentile(result.gaps, .95)),
    worst: Math.round(Math.max(...result.gaps)),
    over32: result.gaps.filter((g) => g > 32).length,
    frames: result.gaps.length,
    longTasks: result.longTasks.length,
    longest: result.longTasks.length ? Math.max(...result.longTasks) : 0,
  }
}

const wanted = new Set()
for (const name of panels) {
  wanted.add(name)
  if (PANELS[name]?.reference) wanted.add(PANELS[name].reference)
}

const cookies = await devAuthCookies(apiOrigin, email)
const app = await serveApp(dist, apiOrigin, compress)
const origin = `http://127.0.0.1:${app.port}`
const browser = await launch()

console.log(`\n${dist}   ${describeCompression(compress)}`)
console.log(`900x900, ${EMULATION.cpuThrottle}x CPU, ${frames} scrolled frames x ${runs} runs; signed in as ${email}; ${loadLine()}`)

const collected = new Map()
try {
  // Interleaved, so drift on the machine lands on every panel rather than on
  // whichever one happened to be measured last.
  for (let run = 0; run < runs; run += 1) {
    for (const name of wanted) {
      const row = await measurePanel(browser, cookies, origin, name)
      if (!collected.has(name)) collected.set(name, [])
      collected.get(name).push(row)
    }
  }
} finally {
  await browser.close()
  app.server.close()
}

console.log(`\n  ${'panel'.padEnd(16)} ${'median'.padStart(7)} ${'p95'.padStart(6)} ${'worst'.padStart(6)} ${'>32ms'.padStart(7)} ${'tasks'.padStart(6)} ${'longest'.padStart(8)}`)
for (const [name, rows] of collected) {
  const good = rows.filter((r) => !r.void)
  if (!good.length) {
    console.log(`  ${name.padEnd(16)} VOID: ${rows[0].void}`)
    continue
  }
  const col = (k) => good.map((r) => r[k])
  console.log(
    `  ${name.padEnd(16)} ${String(median(col('median'))).padStart(7)} ${String(median(col('p95'))).padStart(6)}`
    + ` ${String(Math.max(...col('worst'))).padStart(6)} ${String(median(col('over32'))).padStart(7)}`
    + ` ${String(median(col('longTasks'))).padStart(6)} ${String(Math.max(...col('longest'))).padStart(8)}`,
  )
  if (good[0].note) console.log(`  ${''.padEnd(16)} ${good[0].note}`)
}
console.log(`\n${loadLine()} at the end of the run\n`)
