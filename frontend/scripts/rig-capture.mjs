// Frame-sequence capture for the humanoid rig harness.
//
// Single stills cannot show whether motion is smooth, so everything here is
// captured as an evenly spaced sequence: a strip of consecutive frames makes
// foot sliding, popping at clip boundaries and stalled interpolation visible
// in a way one screenshot never can.
//
// Usage: node scripts/rig-capture.mjs [baseUrl] [outDir]

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.argv[2] ?? 'http://localhost:5199'
const outDir = process.argv[3] ?? '.rig-evidence'

const VIEWPORT = { width: 1100, height: 720 }

async function capture(page, name, frames, intervalMs) {
  const paths = []
  for (let index = 0; index < frames; index += 1) {
    const file = `${outDir}/${name}-${String(index).padStart(2, '0')}.png`
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 820, height: 720 } })
    paths.push(file)
    if (index < frames - 1) await page.waitForTimeout(intervalMs)
  }
  return paths
}

async function settle(page, ms = 900) {
  await page.waitForTimeout(ms)
}

async function measure(page, driver, count) {
  await page.evaluate(([d, c]) => {
    window.__rigHarness.setDriver(d)
    window.__rigHarness.setCount(c)
    window.__rigHarness.setState('walk')
  }, [driver, count])
  // Let the rolling average fill before reading it.
  await page.waitForTimeout(2600)
  return page.evaluate(() => window.__rigHarness.metrics())
}

const results = { metrics: [], sequences: {} }

// Point at the already-cached browser rather than downloading one, and use the
// full Chrome build instead of the headless shell so WebGL runs on the real
// ANGLE/Metal path. Software rasterisation would make the performance numbers
// meaningless.
const executablePath = process.env.RIG_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

// Launch the browser ourselves on a localhost debugging port and attach over
// CDP. Playwright's default launch talks to the browser over an inherited file
// descriptor pair, which this environment does not permit; a TCP port on
// loopback works and is otherwise equivalent.
const CDP_PORT = Number(process.env.RIG_CDP_PORT ?? 9333)
const profileDir = process.env.RIG_PROFILE_DIR ?? join(tmpdir(), `rig-harness-profile-${process.pid}`)
const chromeProcess = spawn(executablePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--headless=new',
  '--no-sandbox',
  '--use-angle=metal',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--force-color-profile=srgb',
  'about:blank',
], { stdio: 'ignore' })

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Chrome did not expose a CDP endpoint on port ${CDP_PORT}`)
}
await waitForCdp()

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)

try {
  await mkdir(outDir, { recursive: true })
  // A CDP-attached browser already owns a default context; reuse it rather
  // than creating a second one.
  const context = browser.contexts()[0] ?? await browser.newContext()

  // --- Motion evidence, at normal speed ---------------------------------
  const page = await context.newPage()
  await page.setViewportSize(VIEWPORT)
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`${baseUrl}/rig-harness.html`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(window.__rigHarness), null, { timeout: 20000 })
  await settle(page, 1400)

  await page.evaluate(() => window.__rigHarness.setCount(1))
  await settle(page)

  // Walking is the headline case: it is where foot sliding shows, and the
  // checkerboard floor gives the feet a fixed reference to slide against.
  await page.evaluate(() => {
    window.__rigHarness.setDriver('skeletal')
    window.__rigHarness.setState('walk')
    window.__rigHarness.setWalkTravel(true)
  })
  await settle(page, 1200)
  results.sequences.walkSkeletal = await capture(page, 'walk-skeletal', 10, 90)

  await page.evaluate(() => window.__rigHarness.setDriver('legacy'))
  await settle(page, 1200)
  results.sequences.walkLegacy = await capture(page, 'walk-legacy', 10, 90)

  await page.evaluate(() => {
    window.__rigHarness.setDriver('skeletal')
    window.__rigHarness.setState('idle')
  })
  await settle(page, 1400)
  results.sequences.idle = await capture(page, 'idle-skeletal', 8, 220)

  // Sit and stand are the crossfade-quality cases: a pop at a clip boundary
  // shows up here first.
  await page.evaluate(() => window.__rigHarness.setState('idle'))
  await settle(page, 700)
  await page.evaluate(() => window.__rigHarness.gesture('sitDown'))
  results.sequences.sitDown = await capture(page, 'sit-down', 10, 85)
  await settle(page, 700)
  await page.evaluate(() => window.__rigHarness.gesture('standUp'))
  results.sequences.standUp = await capture(page, 'stand-up', 10, 85)

  await settle(page, 800)
  await page.evaluate(() => window.__rigHarness.gesture('celebrate'))
  results.sequences.celebrate = await capture(page, 'celebrate', 12, 75)

  // Ambient behavior: several actors choosing their own business.
  await page.evaluate(() => {
    window.__rigHarness.setCount(12)
    window.__rigHarness.setAmbient(true)
  })
  await settle(page, 2000)
  results.sequences.ambient = await capture(page, 'ambient', 8, 700)

  // --- Reduced motion ---------------------------------------------------
  await page.evaluate(() => {
    window.__rigHarness.setCount(1)
    window.__rigHarness.setAmbient(false)
    window.__rigHarness.setReduced(true)
    window.__rigHarness.setState('walk')
  })
  await settle(page, 900)
  results.sequences.reducedWalk = await capture(page, 'reduced-walk', 3, 400)
  await page.evaluate(() => window.__rigHarness.gesture('celebrate'))
  await settle(page, 600)
  results.sequences.reducedCelebrate = await capture(page, 'reduced-celebrate', 3, 400)
  await page.evaluate(() => window.__rigHarness.setReduced(false))

  results.errors = errors
  await page.close()

  // --- Performance ------------------------------------------------------
  // Desktop first, then the same sweep under CPU throttling to approximate a
  // mid-range phone.
  for (const [profile, throttleRate] of [['desktop', 1], ['mid-phone', 6]]) {
    const perfPage = await context.newPage()
    await perfPage.setViewportSize(VIEWPORT)
    await perfPage.goto(`${baseUrl}/rig-harness.html`, { waitUntil: 'networkidle' })
    await perfPage.waitForFunction(() => Boolean(window.__rigHarness), null, { timeout: 20000 })
    const session = await perfPage.context().newCDPSession(perfPage)
    if (throttleRate > 1) await session.send('Emulation.setCPUThrottlingRate', { rate: throttleRate })
    await perfPage.waitForTimeout(1200)
    for (const count of [1, 4, 12, 24]) {
      for (const driver of ['legacy', 'skeletal']) {
        const metrics = await measure(perfPage, driver, count)
        results.metrics.push({ profile, driver, count, ...metrics })
        process.stdout.write(`${profile.padEnd(10)} ${driver.padEnd(9)} n=${String(count).padStart(2)}  ${metrics.frameMs.toFixed(2)} ms  calls=${metrics.calls}  tris=${metrics.triangles}\n`)
      }
    }
    await perfPage.close()
  }

  await writeFile(`${outDir}/results.json`, JSON.stringify(results, null, 2))
  process.stdout.write(`\nwrote ${outDir}/results.json\n`)
  if (errors.length) {
    process.stdout.write(`\nPAGE ERRORS (${errors.length}):\n${errors.slice(0, 10).join('\n')}\n`)
  }
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
}
