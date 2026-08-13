// Does the earnings card actually tick, and is every item hoverable?
//
// Two questions the arrange check can only answer slowly, because it opens the
// office four times to do its A/B. This opens it once.
//
//   ticking   hover a passive earner and sample the figure. The card's whole
//             claim is that the money is arriving now, and a figure that is
//             merely correct once looks identical in a screenshot to one that
//             is live.
//   reach     run the scene's own hit test over a patch around every item and
//             report the ones a pointer can never land on.
//
// It also takes the two screenshots that go with those answers: the room, and
// the room with a card open over an item that is earning.
//
// Usage: node scripts/office-readout-probe.mjs [tier] [floor] [width] [outDir]

import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.OFFICE_BASE_URL ?? 'http://localhost:5474'
const [tier = '14', floor = 'practice', width = '1440', outDir = ''] = process.argv.slice(2)
if (outDir) await mkdir(outDir, { recursive: true })
const executablePath = process.env.OFFICE_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`
// Both per-run: a crashed run leaves a browser holding the profile directory
// and listening on the port, and the next run then quietly attaches to the
// corpse instead of starting cleanly. The profile is removed on the way out,
// because this machine has four gigabytes free and each one is twenty
// megabytes.
const CDP_PORT = Number(process.env.OFFICE_CDP_PORT ?? 9380 + (process.pid % 60))
const profileDir = join(tmpdir(), `office-probe-${process.pid}`)

const chromeProcess = spawn(executablePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  'about:blank',
], { stdio: 'ignore' })

for (let attempt = 0; attempt < 150; attempt += 1) {
  try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break } catch { /* not up */ }
  await new Promise((resolve) => setTimeout(resolve, 200))
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
try {
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(() => {
    const RealWebSocket = window.WebSocket
    window.WebSocket = function (url, protocols) {
      const requested = Array.isArray(protocols) ? protocols : protocols ? [protocols] : []
      if (!requested.includes('vite-hmr')) return new RealWebSocket(url, protocols)
      return {
        readyState: 0, url: String(url), protocol: '', bufferedAmount: 0, extensions: '', binaryType: 'blob',
        onopen: null, onclose: null, onerror: null, onmessage: null,
        send() {}, close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false },
      }
    }
    window.WebSocket.prototype = RealWebSocket.prototype
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  })

  await page.setViewportSize({ width: Number(width), height: Number(width) < 500 ? 844 : 940 })
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  const signIn = page.locator('button', { hasText: 'Enter local development firm' })
  await Promise.race([
    signIn.first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {}),
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40000 }).catch(() => {}),
  ])
  if (await signIn.count() > 0) {
    await signIn.first().evaluate((element) => element.click())
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40000 }).catch(() => {})
  }

  // `OFFICE_EXTRA=&officeEntropy=0` builds the same room on the grid, which is
  // the only honest control for a claim about how a room looks.
  await page.goto(`${baseUrl}/office?officeTier=${tier}&officeFloor=${floor}&officeAll=1${process.env.OFFICE_EXTRA ?? ''}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.office-three-canvas.is-ready', { timeout: 120000 }).catch(async (error) => {
    // A timeout here is almost never the scene being slow; it is the page
    // showing something else entirely. Say which.
    const shown = await page.evaluate(() => ({
      url: location.href,
      canvas: Boolean(document.querySelector('.office-three-canvas')),
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
    }))
    throw new Error(`${error.message}\nPAGE SHOWS: ${JSON.stringify(shown)}\nCONSOLE: ${errors.slice(0, 4).join(' | ')}`)
  })
  await page.waitForTimeout(2400)

  const motion = await page.evaluate(() => ({
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    noPreference: window.matchMedia('(prefers-reduced-motion: no-preference)').matches,
  }))
  const items = await page.evaluate(() => document.querySelector('.office-three-canvas').__officeEarningsProbe())
  const unreachable = items.filter((item) => !item.reachable)
  process.stdout.write(
    `\ntier ${tier} ${floor} @${width}\n`
    + `  prefers-reduced-motion: ${motion.reduced ? 'reduce' : 'no-preference'}\n`
    + `  ${items.length} items, ${items.length - unreachable.length} reachable\n`
    + (unreachable.length
      ? `  UNREACHABLE:\n${unreachable.map((item) => `    ${item.key} (${item.mode}) — pointer finds ${item.blockedBy} instead; centre at ${Math.round(item.clientX)},${Math.round(item.clientY)} clip z ${item.depth}\n`).join('')}`
      : ''),
  )

  const stem = `${outDir}/t${String(tier).padStart(2, '0')}-${floor}-${width}${process.env.OFFICE_STEM ?? ''}`
  const clip = await page.evaluate(() => {
    const canvas = document.querySelector('.office-three-canvas')
    const rect = canvas.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  })
  // Screenshots are best-effort: the headless shell on this machine is short
  // of memory and dies in the encoder often enough that losing a capture must
  // not lose the measurements taken before it.
  const shoot = async (name) => {
    if (!outDir) return
    try { await page.screenshot({ path: `${stem}-${name}.png`, clip, timeout: 60000 }) }
    catch (error) { process.stdout.write(`  (screenshot ${name} failed: ${String(error).split('\n')[0]})\n`) }
  }
  await shoot('room')

  // One card of each kind, sampled over time.
  for (const mode of ['passive', 'casework', 'view']) {
    const item = items.find((entry) => entry.mode === mode && entry.reachable)
    if (!item) { process.stdout.write(`  ${mode}: none reachable\n`); continue }
    await page.mouse.move(item.reachX - 5, item.reachY - 5)
    await page.mouse.move(item.reachX, item.reachY)
    await page.waitForTimeout(500)
    const samples = []
    for (let sample = 0; sample < 6; sample += 1) {
      samples.push(await page.evaluate(() => {
        const card = document.querySelector('.office-readout')
        if (!card) return null
        return [
          card.querySelector('.office-readout-state')?.textContent,
          card.querySelector('.office-readout-figure')?.textContent,
        ].join(' | ')
      }))
      await page.waitForTimeout(600)
    }
    const distinct = new Set(samples.filter(Boolean))
    process.stdout.write(
      `  ${mode.padEnd(8)} ${item.key} — ${samples[0] ?? 'NO CARD'}\n`
      + `           ${distinct.size} distinct reading(s) over 3.6s: ${[...distinct].slice(0, 3).join('  //  ')}\n`,
    )
    await shoot(mode)
    await page.mouse.move(8, 8)
    await page.waitForTimeout(300)
  }
  // Anything the default framing puts outside the frame is a claim about this
  // camera, not about the item, so the camera is moved and the question asked
  // again — by dragging empty floor, which is how a player moves it.
  if (unreachable.length) {
    await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2 - step * 12)
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(900)
    const after = await page.evaluate(() => document.querySelector('.office-three-canvas').__officeEarningsProbe())
    const stillOut = after.filter((item) => !item.reachable)
    process.stdout.write(
      `  after orbiting the view: ${after.length - stillOut.length} reachable`
      + `${stillOut.length ? ` — still out: ${stillOut.map((item) => item.key).join(', ')}` : ''}\n`,
    )
    await shoot('orbited')
  }
  if (errors.length) process.stdout.write(`\nPAGE ERRORS: ${errors.slice(0, 5).join('\n')}\n`)
  else process.stdout.write('\nno page errors\n')
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
  await new Promise((resolve) => setTimeout(resolve, 400))
  await rm(profileDir, { recursive: true, force: true }).catch(() => {})
}
