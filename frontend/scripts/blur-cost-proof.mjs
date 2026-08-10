// Whether taking a blur out changed the picture, and what it bought back.
//
// This project has removed blur and `mix-blend-mode` from surfaces over a live
// canvas before, and each time the claim was settled with a pixel diff rather
// than an assertion. This does the same for the two that were left: the lock
// scrim that every locked card on the Firm screen wears, and the holdings
// readout that floats over the map.
//
// The A/B is done inside one page load rather than across two builds. The
// stylesheet in the tree is the new one; the old declarations are pushed back
// in as a style tag, photographed, and pulled out again. Same session, same
// scroll offset, same fonts, same everything that is not the rule on trial, so
// a difference in the diff is the rule and nothing else.
//
// Frame cost is measured the same paired way, by scrolling the surface and
// reading the page's own animation-frame deltas with the blur restored and
// with it gone. The raster here is SwiftShader on a contended machine, so the
// absolute milliseconds are not a device's milliseconds; the pair is taken
// back to back and it is the ratio that is being reported.
//
// Usage: node scripts/blur-cost-proof.mjs <outDir> <target>[,<target>...]
//   target = firm | map
// Example: node scripts/blur-cost-proof.mjs /tmp/blur firm,map

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.OFFICE_BASE_URL ?? 'http://localhost:5173'
const outDir = process.argv[2] ?? '.blur-proof'
const wanted = (process.argv[3] ?? 'firm').split(',').filter(Boolean)

/**
 * The surfaces on trial.
 *
 * `restore` is the declaration block exactly as it stood before the change, so
 * the "before" frame is the shipped one rather than a reconstruction of it.
 */
const TARGETS = {
  firm: {
    route: '/firm',
    settle: '.firm-tabs',
    selector: '.av-vignette-lock',
    scroll: 'window',
    restore: `
      .av-vignette-lock { background: rgba(9, 14, 21, 0.55); backdrop-filter: blur(2.5px) saturate(0.6); }
      .av-vignette-locked-person { filter: blur(.35px); }
    `,
  },
  map: {
    route: '/map',
    settle: '.uw-holdings',
    selector: '.uw-holdings',
    scroll: 'none',
    // The map's camera drifts on its own, so two shots a second apart differ
    // wherever the map is — including through a translucent plate, which is
    // the one place the diff is supposed to be reading the rule. Asking for
    // reduced motion stops the drift and makes the region attributable.
    still: true,
    restore: `
      .uw-holdings { background: linear-gradient(180deg, rgba(9, 21, 25, .58), rgba(9, 21, 25, .34)); backdrop-filter: blur(7px); }
    `,
  },
  office: {
    route: '/office?officeTier=14&officeAll=1',
    settle: '.office-three-canvas.is-ready',
    selector: '.office-floors',
    scroll: 'none',
    restore: `
      .office-floors { background: rgba(8,17,27,.92); backdrop-filter: blur(14px); }
    `,
  },
}

const executablePath = process.env.OFFICE_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const CDP_PORT = Number(process.env.OFFICE_CDP_PORT ?? 9372)
const profileDir = join(tmpdir(), `blur-proof-${process.pid}`)

const chromeProcess = spawn(executablePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-sandbox',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--force-color-profile=srgb',
  'about:blank',
], { stdio: 'ignore' })

async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) return
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`headless shell did not expose CDP on port ${CDP_PORT}`)
}

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
const report = []

try {
  await mkdir(outDir, { recursive: true })
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 1400, height: 940 })
  await page.addInitScript(() => {
    const RealWebSocket = window.WebSocket
    window.WebSocket = function (url, protocols) {
      const requested = Array.isArray(protocols) ? protocols : protocols ? [protocols] : []
      if (!requested.includes('vite-hmr')) return new RealWebSocket(url, protocols)
      return {
        readyState: 0, url: String(url), protocol: '', bufferedAmount: 0, extensions: '',
        binaryType: 'blob', onopen: null, onclose: null, onerror: null, onmessage: null,
        send() {}, close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false },
      }
    }
    window.WebSocket.prototype = RealWebSocket.prototype
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    document.addEventListener('DOMContentLoaded', () => {
      const sheet = document.createElement('style')
      sheet.textContent = '.chapter-prompt, .story-cutscene, .cutscene, .av-cutscene { display: none !important; }'
      document.head.append(sheet)
    })
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  const signIn = page.locator('button', { hasText: 'Enter local development firm' })
  await Promise.race([
    signIn.first().waitFor({ state: 'visible', timeout: 45000 }),
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45000 }),
  ])
  if (await signIn.count() > 0) {
    await signIn.first().click({ timeout: 45000 })
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45000 })
  }

  // Unthrottled, both conditions sit exactly on the 60Hz cap and the pair
  // reports 16.7ms twice, which says only that this page has headroom on this
  // machine — not what the rule costs. Slowing the CPU pushes the frame off the
  // cap so the difference between the two has somewhere to show up. Six is the
  // usual mid-range-phone stand-in and is what the office profiling on this
  // project has used before.
  const cdp = await context.newCDPSession(page)
  const throttle = (rate) => cdp.send('Emulation.setCPUThrottlingRate', { rate })

  /** Mean and p95 of the page's own frame deltas while the surface moves. */
  const frameCost = async (scroll) => page.evaluate(async (mode) => {
    const deltas = []
    let previous = performance.now()
    let ticks = 0
    await new Promise((done) => {
      const step = () => {
        const now = performance.now()
        deltas.push(now - previous)
        previous = now
        // Scrolling is what makes a backdrop filter re-read its backdrop every
        // frame; a still page can cache the blurred layer and cost nothing.
        if (mode === 'window') window.scrollBy(0, ticks % 40 < 20 ? 24 : -24)
        ticks += 1
        if (ticks < 150) requestAnimationFrame(step)
        else done()
      }
      requestAnimationFrame(step)
    })
    const sorted = deltas.slice(2).sort((left, right) => left - right)
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
    return {
      frames: sorted.length,
      meanMs: Number(mean.toFixed(2)),
      p95Ms: Number(sorted[Math.floor(sorted.length * .95)].toFixed(2)),
      medianMs: Number(sorted[Math.floor(sorted.length * .5)].toFixed(2)),
    }
  }, scroll)

  for (const name of wanted) {
    const target = TARGETS[name]
    if (!target) throw new Error(`unknown target ${name}`)
    await page.emulateMedia({ reducedMotion: target.still ? 'reduce' : 'no-preference' })
    await page.goto(`${baseUrl}${target.route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(target.settle, { timeout: 90000 })
    await page.waitForTimeout(3000)
    const layers = await page.locator(target.selector).count()
    // Twenty-six lock scrims exist on the Firm screen and most of them are
    // below the fold, so a viewport shot taken where the page opens contains
    // none of the thing on trial. Bring the first one into view and shoot
    // there; the rest of the run is unchanged.
    if (layers) {
      await page.locator(target.selector).first().scrollIntoViewIfNeeded({ timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(1500)
    }

    const shotAfter = await page.screenshot({ timeout: 120000, fullPage: false })
    // Read while the page is still where it was photographed. Measuring the
    // frame cost scrolls it, and a rectangle read afterwards describes a
    // viewport the screenshots never saw.
    const regions = await page.locator(target.selector).evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: Math.floor(rect.x), y: Math.floor(rect.y), w: Math.ceil(rect.width), h: Math.ceil(rect.height) }
    }))
    const ratio = await page.evaluate(() => window.devicePixelRatio)
    // The old rule, pushed back in over the top of the new one.
    const handle = await page.addStyleTag({ content: target.restore })
    await page.waitForTimeout(1200)
    const shotBefore = await page.screenshot({ timeout: 120000, fullPage: false })

    // Throttle only a page that has headroom to lose. A surface already
    // drawing at two frames a second does not need help coming off the vsync
    // cap, and slowing it six times over turns a measurement into a wait.
    const probe = await frameCost('none')
    const throttled = probe.medianMs < 17.5
    if (throttled) { await throttle(6); await page.waitForTimeout(600) }
    const costBefore = await frameCost(target.scroll)
    await page.evaluate(() => window.scrollTo(0, 0))
    await handle.evaluate((element) => element.remove())
    await page.waitForTimeout(1500)
    const costAfter = await frameCost(target.scroll)
    if (throttled) await throttle(1)

    // Decoding and comparing in the page, because the compositor is the only
    // thing here that has both images and no image library has to be installed
    // on a machine with six gigabytes left on it.
    // The region on trial is the union of the surface's own rectangles.
    // Everything else on these screens is alive — the unlocked cards each hold
    // an animated character — so a whole-page diff of two shots taken a second
    // apart measures the cast breathing rather than the rule, and is reported
    // separately for exactly that reason.
    const diff = await page.evaluate(async ([before, after, boxes, ratio]) => {
      const decode = async (base64) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const scratch = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = scratch.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const left = await decode(before)
      const right = await decode(after)
      if (left.width !== right.width || left.height !== right.height) return { error: 'size mismatch' }
      // The screenshot is in device pixels and the boxes are in CSS pixels.
      const inside = new Uint8Array(left.width * left.height)
      for (const box of boxes) {
        const x0 = Math.max(0, Math.floor(box.x * ratio))
        const y0 = Math.max(0, Math.floor(box.y * ratio))
        const x1 = Math.min(left.width, Math.ceil((box.x + box.w) * ratio))
        const y1 = Math.min(left.height, Math.ceil((box.y + box.h) * ratio))
        for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) inside[y * left.width + x] = 1
      }
      const total = left.width * left.height
      const empty = () => ({ pixels: 0, changed: 0, visible: 0, sum: 0, worst: 0, bias: [0, 0, 0] })
      const tally = { on: empty(), off: empty() }
      const canvas = new OffscreenCanvas(left.width, left.height)
      const context = canvas.getContext('2d')
      const out = context.createImageData(left.width, left.height)
      for (let index = 0; index < total; index += 1) {
        const at = index * 4
        const delta = Math.max(
          Math.abs(left.data[at] - right.data[at]),
          Math.abs(left.data[at + 1] - right.data[at + 1]),
          Math.abs(left.data[at + 2] - right.data[at + 2]),
        )
        const bucket = inside[index] ? tally.on : tally.off
        bucket.pixels += 1
        bucket.sum += delta
        // Signed, per channel, because "how different" does not say which way.
        // A scrim that replaces a filter is tuned by reading this back.
        bucket.bias[0] += right.data[at] - left.data[at]
        bucket.bias[1] += right.data[at + 1] - left.data[at + 1]
        bucket.bias[2] += right.data[at + 2] - left.data[at + 2]
        if (delta > bucket.worst) bucket.worst = delta
        if (delta > 0) bucket.changed += 1
        // Two levels out of 255 is under a percent of the range and below what
        // this panel can resolve; past that a human could in principle see it,
        // so that is where "different" starts.
        if (delta > 2) bucket.visible += 1
        out.data[at] = Math.min(255, delta * 8)
        out.data[at + 1] = Math.min(255, delta * 8)
        out.data[at + 2] = Math.min(255, delta * 8)
        out.data[at + 3] = 255
      }
      context.putImageData(out, 0, 0)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const buffer = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (const byte of buffer) binary += String.fromCharCode(byte)
      const summarise = (bucket) => ({
        pixels: bucket.pixels,
        changedPercent: Number((bucket.changed / Math.max(1, bucket.pixels) * 100).toFixed(3)),
        visiblePercent: Number((bucket.visible / Math.max(1, bucket.pixels) * 100).toFixed(3)),
        meanDelta: Number((bucket.sum / Math.max(1, bucket.pixels)).toFixed(3)),
        maxDelta: bucket.worst,
        bias: bucket.bias.map((total) => Number((total / Math.max(1, bucket.pixels)).toFixed(2))),
      })
      return {
        width: left.width, height: left.height, pixels: total,
        onSurface: summarise(tally.on),
        elsewhere: summarise(tally.off),
        image: btoa(binary),
      }
    }, [shotBefore.toString('base64'), shotAfter.toString('base64'), regions, ratio])

    await writeFile(`${outDir}/${name}-before.png`, shotBefore)
    await writeFile(`${outDir}/${name}-after.png`, shotAfter)
    if (diff.image) {
      await writeFile(`${outDir}/${name}-diff.png`, Buffer.from(diff.image, 'base64'))
      delete diff.image
    }
    report.push({ target: name, route: target.route, selector: target.selector, layers, regions: regions.length, diff, costBefore, costAfter })
    await writeFile(`${outDir}/report.json`, JSON.stringify({ report, errors }, null, 2))
  }

  const line = (where, stats) => `      ${where.padEnd(10)} changed ${String(stats.changedPercent).padStart(7)}%  over-2 ${String(stats.visiblePercent).padStart(7)}%  mean ${String(stats.meanDelta).padStart(6)}/255  max ${String(stats.maxDelta).padStart(3)}  bias ${stats.bias.join('/')}\n`
  for (const entry of report) {
    process.stdout.write(
      `${entry.target.padEnd(6)} ${String(entry.layers).padStart(3)} x ${entry.selector}\n`
      + line('on surface', entry.diff.onSurface)
      + line('elsewhere', entry.diff.elsewhere)
      + `      frame with blur   mean ${String(entry.costBefore.meanMs).padStart(7)} ms  median ${String(entry.costBefore.medianMs).padStart(7)} ms  p95 ${String(entry.costBefore.p95Ms).padStart(7)} ms\n`
      + `      frame without     mean ${String(entry.costAfter.meanMs).padStart(7)} ms  median ${String(entry.costAfter.medianMs).padStart(7)} ms  p95 ${String(entry.costAfter.p95Ms).padStart(7)} ms\n`,
    )
  }
  if (errors.length) process.stdout.write(`PAGE ERRORS (${errors.length}):\n${errors.slice(0, 6).join('\n')}\n`)
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
}
