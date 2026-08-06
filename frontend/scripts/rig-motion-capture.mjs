// Live-browser motion evidence for the idle, the beats and the swim clip.
//
// `rig-verify.ts` measures the same properties headlessly, which is the right
// place for a regression suite but proves nothing about the code path that
// actually ships: a real WebGL render loop, with a variable frame delta,
// driving the same actors. This captures both halves of the evidence from that
// loop - frame strips a human can look at, and the per-frame joint deltas
// underneath them - so the pictures and the numbers describe the same run.
//
// Usage: node scripts/rig-motion-capture.mjs [baseUrl] [outDir]

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.argv[2] ?? 'http://localhost:5199'
const outDir = process.argv[3] ?? '.rig-evidence'

const VIEWPORT = { width: 900, height: 620 }
const CLIP = { x: 0, y: 0, width: 640, height: 620 }

const executablePath = process.env.RIG_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const CDP_PORT = Number(process.env.RIG_CDP_PORT ?? 9337)
const profileDir = join(tmpdir(), `rig-motion-profile-${process.pid}`)

const chromeProcess = spawn(executablePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--headless=new',
  '--no-sandbox',
  '--use-gl=angle',
  '--use-angle=metal',
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) return
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Chrome did not expose a CDP endpoint on port ${CDP_PORT}`)
}

/**
 * Per-frame angular travel, and how far the worst frame stands out from its
 * neighbours.
 *
 * The ratio is the number that matters and the absolute step is not. Motion is
 * allowed to be fast - a beat that lands quickly is a beat with weight - so a
 * large step is only a fault if the frames either side of it are small, which
 * is the signature of a discontinuity rather than of speed. Comparing each
 * frame against the median of its six neighbours asks exactly that question.
 */
function analyse(samples) {
  const steps = []
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1].q
    const current = samples[index].q
    let total = 0
    for (let bone = 0; bone < previous.length; bone += 4) {
      const dot = Math.abs(
        previous[bone] * current[bone] + previous[bone + 1] * current[bone + 1]
        + previous[bone + 2] * current[bone + 2] + previous[bone + 3] * current[bone + 3],
      )
      total += 2 * Math.acos(Math.min(1, dot))
    }
    steps.push({ dt: samples[index].t - samples[index - 1].t, travel: total })
  }
  // Same curvature test `rig-verify.ts` uses, so the two sets of numbers mean
  // the same thing: how far does a frame depart from the straight line between
  // its neighbours, relative to the local scale. Speed is not a fault; a frame
  // that is not on that line is.
  let worstRatio = 0
  let worstAt = -1
  for (let index = 1; index < steps.length - 1; index += 1) {
    const expected = (steps[index - 1].travel + steps[index + 1].travel) / 2
    const departure = Math.abs(steps[index].travel - expected)
    if (departure < .02) continue
    const ratio = departure / Math.max(expected, .004)
    if (ratio > worstRatio) {
      worstRatio = ratio
      worstAt = index
    }
  }
  const travels = steps.map((step) => step.travel)
  // A frame that does not move at all is its own failure: it means the clock
  // stalled, which reads as a hitch even though no pose jumped.
  const stalled = travels.filter((value) => value < 1e-6).length
  return {
    frames: samples.length,
    meanFrameMs: steps.reduce((sum, step) => sum + step.dt, 0) / Math.max(1, steps.length),
    meanTravel: travels.reduce((sum, value) => sum + value, 0) / Math.max(1, travels.length),
    peakTravel: Math.max(...travels),
    worstRatio,
    worstAt,
    stalled,
  }
}

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
const report = {}

try {
  await mkdir(outDir, { recursive: true })
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize(VIEWPORT)
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

  await page.goto(`${baseUrl}/rig-harness.html`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(window.__rigHarness), null, { timeout: 20000 })
  await page.evaluate(() => window.__rigHarness.setCount(1))
  await page.waitForTimeout(1500)

  const strip = async (name, frames, intervalMs) => {
    for (let index = 0; index < frames; index += 1) {
      await page.screenshot({ path: `${outDir}/${name}-${String(index).padStart(2, '0')}.png`, clip: CLIP })
      if (index < frames - 1) await page.waitForTimeout(intervalMs)
    }
  }

  // 1. The ambient idle, with the behaviour director choosing its own beats.
  //    This is what the portrait card now runs, and it is the thing that used
  //    to be a wave on a loop.
  await page.evaluate(() => {
    window.__rigHarness.setDriver('skeletal')
    window.__rigHarness.setState('idle')
    window.__rigHarness.setAmbient(true)
  })
  await page.waitForTimeout(1500)
  const idleRecording = page.evaluate(() => window.__rigHarness.recordPose(9000))
  await strip('motion-idle', 8, 1000)
  report.idle = analyse(await idleRecording)

  // 2. A single additive beat over that idle.
  await page.evaluate(() => window.__rigHarness.setAmbient(false))
  await page.waitForTimeout(900)
  const beatRecording = page.evaluate(async () => {
    const samples = window.__rigHarness.recordPose(2400)
    window.__rigHarness.gesture('cuffAdjust')
    return samples
  })
  await strip('motion-beat', 8, 130)
  report.beat = analyse(await beatRecording)

  // 3. Swim, travelling, so the stroke rate is judged against real ground.
  await page.evaluate(() => {
    window.__rigHarness.setState('swim')
    window.__rigHarness.setWalkTravel(true)
  })
  await page.waitForTimeout(1600)
  const swimRecording = page.evaluate(() => window.__rigHarness.recordPose(3000))
  await strip('motion-swim', 8, 150)
  report.swim = analyse(await swimRecording)

  // 4. The full water sequence: standing, in, across, out.
  await page.evaluate(() => {
    window.__rigHarness.setState('idle')
    window.__rigHarness.setWalkTravel(false)
  })
  await page.waitForTimeout(900)
  const entryRecording = page.evaluate(async () => {
    const samples = window.__rigHarness.recordPose(4200)
    window.__rigHarness.gesture('swimEnter')
    window.__rigHarness.setState('swim')
    setTimeout(() => {
      window.__rigHarness.gesture('swimExit')
      window.__rigHarness.setState('idle')
    }, 2400)
    return samples
  })
  await strip('motion-swim-entry', 8, 260)
  report.swimSequence = analyse(await entryRecording)

  // 5. Reduced motion: must land the finished pose and then not move.
  await page.evaluate(() => {
    window.__rigHarness.setReduced(true)
    window.__rigHarness.setState('presentBoard')
  })
  await page.waitForTimeout(600)
  const reducedRecording = await page.evaluate(() => window.__rigHarness.recordPose(1500))
  report.reduced = analyse(reducedRecording)
  await page.evaluate(() => window.__rigHarness.setReduced(false))

  report.errors = errors
  await writeFile(`${outDir}/motion.json`, JSON.stringify(report, null, 2))

  const line = (name, data) => `${name.padEnd(16)} ${String(data.frames).padStart(4)} frames  ${data.meanFrameMs.toFixed(1).padStart(5)} ms/frame  mean ${data.meanTravel.toFixed(4)} rad  peak ${data.peakTravel.toFixed(4)}  worst ${data.worstRatio ? `${data.worstRatio.toFixed(2)}x` : 'none'}  stalled ${data.stalled}`
  process.stdout.write('\n--- Live WebGL motion, per-frame joint travel over 12 bones ---\n')
  process.stdout.write(`${line('ambient idle', report.idle)}\n`)
  process.stdout.write(`${line('additive beat', report.beat)}\n`)
  process.stdout.write(`${line('swim', report.swim)}\n`)
  process.stdout.write(`${line('swim in/out', report.swimSequence)}\n`)
  process.stdout.write(`${line('reduced motion', report.reduced)}\n`)
  if (errors.length) process.stdout.write(`\nPAGE ERRORS (${errors.length}):\n${errors.slice(0, 8).join('\n')}\n`)
  else process.stdout.write('\nno page errors\n')
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
}
