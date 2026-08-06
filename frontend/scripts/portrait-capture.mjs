// Frame strip of the actual portrait card in the running app.
//
// The harness proves the rig works; this proves the surface the owner was
// looking at is the one that changed. It logs into the seeded dev firm, finds
// the "your lawyer" portrait canvas, and captures it over several seconds -
// the same card, at the same size, that produced the mannequin screenshot.
//
// Usage: node scripts/portrait-capture.mjs [baseUrl] [outDir]

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? '.rig-evidence'

const executablePath = process.env.RIG_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const CDP_PORT = Number(process.env.RIG_CDP_PORT ?? 9341)
const profileDir = join(tmpdir(), `portrait-profile-${process.pid}`)

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

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)

try {
  await mkdir(outDir, { recursive: true })
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

  await page.goto(baseUrl, { waitUntil: 'networkidle' })

  const devLogin = page.getByText(/Enter local development firm/i)
  if (await devLogin.count()) {
    await devLogin.first().click()
    await page.waitForTimeout(5000)
  }
  // The dev login lands wherever the learner left off; the portrait lives on
  // the office page.
  await page.goto(`${baseUrl}/office`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.av-hero-figure canvas', { timeout: 25000 })
  await page.waitForTimeout(3500)

  const box = await page.evaluate(() => {
    const canvas = document.querySelector('.av-hero-figure canvas')
    if (!canvas) return null
    canvas.scrollIntoView({ block: 'center' })
    const rect = canvas.getBoundingClientRect()
    return { x: Math.max(0, rect.x - 10), y: Math.max(0, rect.y - 10), width: rect.width + 20, height: rect.height + 20 }
  })
  if (!box) throw new Error('no portrait canvas found on the office page')

  // Six seconds at 450 ms, which is long enough to contain at least one
  // ambient beat on top of the continuous idle.
  const FRAMES = 13
  const shots = []
  for (let index = 0; index < FRAMES; index += 1) {
    shots.push(await page.screenshot({
      path: `${outDir}/portrait-${String(index).padStart(2, '0')}.png`,
      clip: box,
    }))
    if (index < FRAMES - 1) await page.waitForTimeout(450)
  }

  // Diff the screenshots rather than the canvas.
  //
  // Reading the WebGL canvas back with `drawImage` is the obvious way to do
  // this and it silently returns nothing: without `preserveDrawingBuffer` the
  // drawing buffer is gone by the time script runs after a composite, so every
  // frame hashes identically and a perfectly animated portrait scores as
  // frozen. The screenshots are taken through the compositor and do not have
  // that problem, so they are the thing to compare.
  const diffs = await page.evaluate(async (encoded) => {
    const bitmaps = await Promise.all(encoded.map(async (base64) => {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    }))
    const width = 96
    const height = Math.round(width * bitmaps[0].height / bitmaps[0].width)
    const scratch = new OffscreenCanvas(width, height)
    const context = scratch.getContext('2d')
    const frames = bitmaps.map((bitmap) => {
      context.clearRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)
      return context.getImageData(0, 0, width, height).data
    })
    const out = []
    for (let index = 1; index < frames.length; index += 1) {
      const a = frames[index - 1]
      const b = frames[index]
      let total = 0
      for (let i = 0; i < a.length; i += 4) {
        total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      }
      out.push(total / (a.length / 4) / 3)
    }
    return out
  }, shots.map((buffer) => buffer.toString('base64')))

  const still = diffs.filter((value) => value < .05).length
  const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length
  await writeFile(`${outDir}/portrait.json`, JSON.stringify({ box, diffs, errors }, null, 2))
  process.stdout.write(`portrait canvas ${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)})\n`)
  process.stdout.write(`frame-to-frame pixel change, 0-255 per channel:\n  ${diffs.map((value) => value.toFixed(2)).join('  ')}\n`)
  process.stdout.write(`mean ${mean.toFixed(2)}, peak ${Math.max(...diffs).toFixed(2)}, motionless frames ${still} of ${diffs.length}\n`)
  if (errors.length) process.stdout.write(`PAGE ERRORS (${errors.length}):\n${errors.slice(0, 8).join('\n')}\n`)
  else process.stdout.write('no page errors\n')
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
}
