// Ad-hoc diagnostic: open one office URL and say what the page is actually
// showing, for the case where the capture harness times out waiting for the
// canvas and the interesting question is why.
//
// Usage: node scripts/office-probe.mjs "<path+query>" [waitMs]

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.OFFICE_BASE_URL ?? 'http://localhost:5474'
const target = process.argv[2] ?? '/office?officeTier=14&officeAll=1'
const waitMs = Number(process.argv[3] ?? 45000)

const executablePath = process.env.OFFICE_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const CDP_PORT = Number(process.env.OFFICE_CDP_PORT ?? 9372)
// One reused profile rather than one per run. This machine is at 99% disk and
// a fresh Chromium profile is 20 MB a go.
const profileDir = join(tmpdir(), 'office-probe-profile')

const chromeProcess = spawn(executablePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' })

async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) return } catch { /* not up */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('no CDP')
}

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
try {
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 1400, height: 940 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('requestfailed', (request) => errors.push(`requestfailed ${request.url()} ${request.failure()?.errorText}`))

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  const signIn = page.locator('button', { hasText: 'Enter local development firm' })
  await Promise.race([
    signIn.first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
  ])
  if (await signIn.count() > 0) {
    await signIn.first().click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {})
  }
  process.stdout.write(`after login: ${page.url()}\n`)

  await page.goto(`${baseUrl}${target}`, { waitUntil: 'domcontentloaded' })
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      url: location.pathname + location.search,
      canvas: document.querySelector('.office-three-canvas')?.className ?? null,
      ready: Boolean(document.querySelector('.office-three-canvas.is-ready')),
      headings: [...document.querySelectorAll('h1,h2')].map((node) => node.textContent?.trim()).slice(0, 6),
      body: document.body.innerText.slice(0, 600),
    }))
    if (state.ready) { process.stdout.write(`READY ${JSON.stringify(state.canvas)}\n`); break }
    if (Date.now() + 3000 >= deadline) process.stdout.write(`${JSON.stringify(state, null, 2)}\n`)
    await page.waitForTimeout(2000)
  }
  process.stdout.write(`errors:\n${errors.slice(0, 15).join('\n')}\n`)
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
}
