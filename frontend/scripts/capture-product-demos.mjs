import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import gifenc from 'gifenc'
import pngjs from 'pngjs'
import { chromium } from 'playwright-core'

const { GIFEncoder, applyPalette, quantize } = gifenc
const { PNG } = pngjs
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(scriptDir, '..')
const repoDir = path.resolve(frontendDir, '..')
const outputDir = path.resolve(process.env.DEMO_OUTPUT_DIR || path.join(repoDir, 'docs', 'demos'))
const baseUrl = (process.env.DEMO_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')
const viewport = {
  width: Number(process.env.DEMO_WIDTH || 960),
  height: Number(process.env.DEMO_HEIGHT || 600),
}

const demoFiles = [
  'dashboard-metrics.gif',
  'strategy-methods.gif',
  'game-money-upgrades.gif',
  'game-office.gif',
  'game-career-map.gif',
  'practice-exam.gif',
  'answer-feedback-loop.gif',
  'llm-reasoning-feedback.gif',
]

function findBrowser() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

async function requireDemoServer() {
  let response
  try {
    response = await fetch(`${baseUrl}/v1/auth/config`)
  } catch {
    throw new Error(`The demo app is not reachable at ${baseUrl}. Start the API on port 5001 and Vite on port 5173.`)
  }
  if (!response.ok) throw new Error(`The demo API returned HTTP ${response.status}.`)
  const config = await response.json()
  if (!config.dev_auth_enabled) throw new Error('DEV_AUTH_ENABLED=true is required for local demo capture.')
}

class GifRecorder {
  constructor(page, name) {
    this.page = page
    this.name = name
    this.frames = []
  }

  async snap(delay = 180) {
    const screenshot = await this.page.screenshot({ type: 'png', animations: 'allow' })
    const png = PNG.sync.read(screenshot)
    if (png.width !== viewport.width || png.height !== viewport.height) {
      throw new Error(`${this.name}: expected ${viewport.width}x${viewport.height}, got ${png.width}x${png.height}`)
    }
    this.frames.push({ rgba: png.data, delay })
  }

  async burst(duration, fps = 7) {
    const delay = Math.max(60, Math.round(1000 / fps))
    const count = Math.max(1, Math.round(duration / delay))
    for (let index = 0; index < count; index += 1) {
      await this.snap(delay)
      if (index < count - 1) await this.page.waitForTimeout(Math.max(20, delay - 45))
    }
  }

  async finish() {
    if (!this.frames.length) throw new Error(`${this.name}: no frames were recorded.`)

    // A single sampled palette keeps colors stable between frames and avoids
    // paying for a local 256-color table on every image in the GIF.
    const sampleStride = 12
    const sampledPixelCount = this.frames.reduce(
      (total, frame) => total + Math.ceil(frame.rgba.length / 4 / sampleStride),
      0,
    )
    const samples = new Uint8Array(sampledPixelCount * 4)
    let sampleOffset = 0
    for (const frame of this.frames) {
      for (let source = 0; source < frame.rgba.length; source += 4 * sampleStride) {
        samples[sampleOffset++] = frame.rgba[source]
        samples[sampleOffset++] = frame.rgba[source + 1]
        samples[sampleOffset++] = frame.rgba[source + 2]
        samples[sampleOffset++] = 255
      }
    }

    const palette = quantize(samples.subarray(0, sampleOffset), 256, { format: 'rgb565' })
    const gif = GIFEncoder()
    this.frames.forEach((frame, index) => {
      const indexed = applyPalette(frame.rgba, palette, 'rgb565')
      gif.writeFrame(indexed, viewport.width, viewport.height, {
        palette: index === 0 ? palette : undefined,
        delay: frame.delay,
        repeat: 0,
      })
    })
    gif.finish()

    const outputPath = path.join(outputDir, this.name)
    const bytes = Buffer.from(gif.bytes())
    await writeFile(outputPath, bytes)
    return {
      file: this.name,
      frames: this.frames.length,
      duration_ms: this.frames.reduce((total, frame) => total + frame.delay, 0),
      bytes: bytes.length,
      width: viewport.width,
      height: viewport.height,
    }
  }
}

async function visible(locator) {
  return locator.isVisible().catch(() => false)
}

async function dismissNarrative(page) {
  // A seeded learner has a pending prologue. Defer the full cutscene, then
  // dismiss its compact reminder for this browser so it cannot cover a demo.
  await page.waitForTimeout(1800)
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const defer = page.getByRole('button', { name: 'Decide later' })
    if (await visible(defer)) {
      await defer.click()
      await page.waitForTimeout(350)
      continue
    }
    const later = page.getByRole('button', { name: 'Not now' })
    if (await visible(later)) {
      await later.click()
      await page.waitForTimeout(350)
      continue
    }
    const dismiss = page.getByRole('button', { name: 'Dismiss until you open the caseboard' })
    if (await visible(dismiss)) {
      await dismiss.click()
      await page.waitForTimeout(350)
      continue
    }
    if (attempt >= 5 && await page.locator('.cutscene-overlay, .chapter-prompt').count() === 0) return
    await page.waitForTimeout(300)
  }
}

async function go(page, pathname, ready) {
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' })
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(550)
}

async function captureDashboard(page) {
  await go(page, '/progress', '.dash-summary')
  await dismissNarrative(page)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const recorder = new GifRecorder(page, 'dashboard-metrics.gif')
  await recorder.snap(900)

  const evidenceTab = page.locator('#dash-tab-evidence')
  await evidenceTab.scrollIntoViewIfNeeded()
  await recorder.snap(320)
  await evidenceTab.click()
  await recorder.burst(650, 7)
  await page.locator('.performance-metrics').scrollIntoViewIfNeeded()
  await recorder.snap(850)

  const performance = page.locator('.metric-card-trigger').first()
  await performance.click()
  await recorder.burst(520, 7)
  await recorder.snap(900)
  return recorder.finish()
}

async function captureStrategies(page) {
  await go(page, '/progress', '.dash-summary')
  const recorder = new GifRecorder(page, 'strategy-methods.gif')
  const methodsTab = page.locator('#dash-tab-methods')
  await methodsTab.scrollIntoViewIfNeeded()
  await recorder.snap(480)
  await methodsTab.click()
  await page.locator('.strategy-lab-panel').waitFor({ state: 'visible' })
  await recorder.burst(650, 7)
  await page.locator('.strategy-lab-panel').scrollIntoViewIfNeeded()
  await recorder.snap(850)

  const section = page.locator('details.strategy-section-row').first()
  if (await visible(section)) {
    await section.locator('summary').click()
    await recorder.burst(500, 7)
    await recorder.snap(780)
  }

  const allResults = page.locator('details.strategy-results-detail')
  if (await visible(allResults)) {
    await allResults.locator('summary').scrollIntoViewIfNeeded()
    await allResults.locator('summary').click()
    await recorder.burst(450, 7)
    await recorder.snap(820)
  }
  return recorder.finish()
}

async function captureMoneyUpgrades(page) {
  await go(page, '/firm', '.firm-wallet')
  await dismissNarrative(page)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const recorder = new GifRecorder(page, 'game-money-upgrades.gif')
  await recorder.snap(750)

  const nextTier = page.locator('.tier-upgrade-banner')
  await nextTier.scrollIntoViewIfNeeded()
  await recorder.burst(300, 7)
  await recorder.snap(700)

  const readyFilter = page.getByRole('button', { name: 'ready', exact: true })
  await readyFilter.click()
  const conferenceRoom = page.locator('.asset-card').filter({ hasText: 'Conference room' })
  await conferenceRoom.waitFor({ state: 'visible' })
  await recorder.burst(300, 7)
  await conferenceRoom.scrollIntoViewIfNeeded()
  await recorder.snap(750)

  await conferenceRoom.getByRole('button', { name: 'Purchase' }).click()
  await recorder.burst(300, 8)
  await page.getByRole('button', { name: 'owned', exact: true }).click()
  await conferenceRoom.waitFor({ state: 'visible' })
  await conferenceRoom.scrollIntoViewIfNeeded()
  await recorder.burst(600, 8)
  await conferenceRoom.getByRole('button', { name: 'Installed' }).waitFor({ state: 'visible' })
  await page.locator('.asset-card.just-bought').waitFor({ state: 'hidden', timeout: 5_000 })
  await recorder.snap(700)

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await recorder.burst(350, 7)
  await recorder.snap(800)
  return recorder.finish()
}

async function captureOffice(page) {
  await go(page, '/office', 'canvas.office-three-canvas')
  await page.locator('canvas.office-three-canvas.is-ready').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.office-world-shell').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1000)
  const recorder = new GifRecorder(page, 'game-office.gif')
  const canvas = page.locator('canvas.office-three-canvas')
  await recorder.snap(750)
  await canvas.focus()
  await canvas.press('ArrowRight')
  await recorder.burst(1600, 8)
  await recorder.snap(600)
  await canvas.press('ArrowLeft')
  await recorder.burst(1250, 8)
  await recorder.snap(750)
  return recorder.finish()
}

async function captureCareerMap(page) {
  await go(page, '/map', '.uw-map-frame')
  await page.locator('.uw-map-frame canvas').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => !document.querySelector('.uw-three-loading'), null, { timeout: 30_000 })
  await page.locator('.uw-map-frame').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1500)
  const recorder = new GifRecorder(page, 'game-career-map.gif')
  await recorder.burst(850, 7)

  const rivals = page.getByRole('button', { name: /Rival firms/ }).first()
  await rivals.click()
  await recorder.burst(700, 7)
  const firstRival = page.locator('.uw-level-navigator-track.is-rivals button').first()
  if (await visible(firstRival)) {
    await firstRival.click()
    await recorder.burst(1450, 8)
    await recorder.snap(650)
  }

  await page.getByRole('button', { name: /Career route/ }).first().click()
  await page.getByRole('button', { name: 'Move camera closer' }).click()
  await recorder.burst(950, 8)
  await recorder.snap(750)
  return recorder.finish()
}

async function post(page, pathname) {
  return page.evaluate(async ({ pathname, baseUrl }) => {
    const csrf = document.cookie
      .split('; ')
      .find((row) => row.startsWith('lsat_csrf='))
      ?.split('=')[1]
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {},
    })
    return { ok: response.ok, status: response.status }
  }, { pathname, baseUrl })
}

async function capturePracticeExam(page) {
  await go(page, '/progress', '.dash-summary')
  const recorder = new GifRecorder(page, 'practice-exam.gif')
  const megaTab = page.locator('#dash-tab-mega')
  await megaTab.scrollIntoViewIfNeeded()
  await recorder.snap(420)
  await megaTab.click()
  await page.locator('.diagnostic-lab').waitFor({ state: 'visible' })
  await recorder.burst(550, 7)
  await page.locator('.diagnostic-lab').scrollIntoViewIfNeeded()
  await recorder.snap(850)

  await page.locator('.diagnostic-lab').getByRole('button', { name: /Sit a new mega-litigation|Sit a mega-litigation/ }).click()
  await page.locator('.mega-gate').waitFor({ state: 'visible' })
  await recorder.burst(420, 7)
  await recorder.snap(1100)
  await page.getByRole('button', { name: /I have the time — start/ }).click()
  await page.waitForURL(/\/cases\/[^/]+$/, { timeout: 30_000 })
  const sessionId = page.url().split('/').pop()
  await page.locator('.session-page .answer-card').waitFor({ state: 'visible', timeout: 30_000 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await recorder.burst(550, 7)
  await recorder.snap(700)
  await page.locator('.answer-card').scrollIntoViewIfNeeded()
  await recorder.burst(420, 7)
  await recorder.snap(950)

  const abandoned = await post(page, `/v1/study-sessions/${sessionId}/abandon`)
  if (!abandoned.ok) throw new Error(`Could not discard the demo exam: HTTP ${abandoned.status}`)
  return recorder.finish()
}

async function createPracticeSession(page) {
  return page.evaluate(async (baseUrl) => {
    const csrf = document.cookie
      .split('; ')
      .find((row) => row.startsWith('lsat_csrf='))
      ?.split('=')[1]
    const response = await fetch(`${baseUrl}/v1/study-sessions`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}),
      },
      body: JSON.stringify({ size: 10 }),
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Could not start practice: HTTP ${response.status} ${body}`)
    }
    const data = await response.json()
    return data.session.id
  }, baseUrl)
}

async function captureAnswerFeedback(page) {
  await go(page, '/progress', '.dash-summary')
  const sessionId = await createPracticeSession(page)
  await go(page, `/cases/${sessionId}`, '.answer-card')

  const skipStrategy = page.getByRole('button', { name: 'Skip this one' })
  if (await visible(skipStrategy)) {
    await skipStrategy.click()
    await page.waitForTimeout(250)
  }
  await page.locator('.answer-card').scrollIntoViewIfNeeded()
  const recorder = new GifRecorder(page, 'answer-feedback-loop.gif')
  await recorder.snap(850)

  await page.getByRole('radio').first().click()
  await recorder.burst(320, 7)
  const reasoning = page.locator('textarea#reasoning')
  if (await visible(reasoning)) {
    const chunks = [
      'The conclusion depends on confusing a necessary condition ',
      'with a sufficient one. This choice identifies that exact gap ',
      'and directly answers the question presented.',
    ]
    let answer = ''
    for (const chunk of chunks) {
      answer += chunk
      await reasoning.fill(answer)
      await recorder.snap(260)
    }
  }
  const confidenceFour = page.locator('.confidence-check button').filter({ hasText: /^4$/ })
  if (await visible(confidenceFour)) await confidenceFour.click()
  await recorder.snap(450)

  const submit = page.getByRole('button', { name: /Submit reasoning|Check answer|Lock answer/ })
  await submit.click()
  await recorder.burst(700, 8)
  await page.locator('.verdict-stamp').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.judge-review-focus').scrollIntoViewIfNeeded()
  await recorder.burst(650, 8)
  await recorder.snap(1250)

  await page.waitForTimeout(800)
  await post(page, `/v1/study-sessions/${sessionId}/debrief/acknowledge`)
  await post(page, `/v1/study-sessions/${sessionId}/abandon`)
  return recorder.finish()
}

async function captureReasoningFeedback(page) {
  await go(page, '/progress', '.dash-summary')
  const recorder = new GifRecorder(page, 'llm-reasoning-feedback.gif')
  const answersTab = page.locator('#dash-tab-answers')
  await answersTab.scrollIntoViewIfNeeded()
  await recorder.snap(420)
  await answersTab.click()
  await page.locator('.answer-log-panel').waitFor({ state: 'visible' })
  await recorder.burst(520, 7)
  await page.locator('.answer-log-panel').scrollIntoViewIfNeeded()
  await recorder.snap(780)

  const missedAnswer = page.locator('button.answer-tile.is-wrong').first()
  await missedAnswer.click()
  await page.locator('.answer-log-detail').waitFor({ state: 'visible' })
  await recorder.burst(480, 7)
  await page.locator('.answer-log-detail-facts').scrollIntoViewIfNeeded()
  await recorder.snap(720)
  await page.locator('.answer-log-reasoning').scrollIntoViewIfNeeded()
  await recorder.burst(420, 7)
  await recorder.snap(1050)
  await page.locator('.answer-log-coaching').scrollIntoViewIfNeeded()
  await recorder.burst(480, 7)
  await recorder.snap(1500)
  return recorder.finish()
}

async function main() {
  await requireDemoServer()
  const executablePath = findBrowser()
  if (!executablePath) throw new Error('Chrome or Edge was not found. Set BROWSER_EXECUTABLE to a Chromium-based browser.')
  await mkdir(outputDir, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  })
  await context.route('https://accounts.google.com/**', (route) => route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)

  const results = []
  const onlyDemo = process.env.DEMO_ONLY?.trim()
  const wants = (file) => !onlyDemo || onlyDemo === file || onlyDemo === path.basename(file, '.gif')
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Enter local development firm/ }).click()
    await page.waitForURL(/\/(progress|office|cases|map|firm|story)/, { timeout: 30_000 })
    await page.locator('body').waitFor({ state: 'visible' })
    await dismissNarrative(page)

    // Capture game scenes before the answer demo changes the learner's case
    // totals. The filenames and manifest retain the requested presentation order.
    if (wants('dashboard-metrics.gif')) results.push(await captureDashboard(page))
    if (wants('strategy-methods.gif')) results.push(await captureStrategies(page))
    if (wants('game-money-upgrades.gif')) results.push(await captureMoneyUpgrades(page))
    if (wants('game-office.gif')) results.push(await captureOffice(page))
    if (wants('game-career-map.gif')) results.push(await captureCareerMap(page))
    if (wants('practice-exam.gif')) results.push(await capturePracticeExam(page))
    if (wants('answer-feedback-loop.gif')) results.push(await captureAnswerFeedback(page))
    if (wants('llm-reasoning-feedback.gif')) results.push(await captureReasoningFeedback(page))
  } finally {
    await browser.close()
  }

  if (onlyDemo && results.length === 0) throw new Error(`Unknown DEMO_ONLY value: ${onlyDemo}`)
  let manifestResults = results
  if (onlyDemo) {
    try {
      const previous = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'))
      manifestResults = [
        ...(previous.demos || []).filter((entry) => !results.some((result) => result.file === entry.file)),
        ...results,
      ]
    } catch {
      // A partial capture can also be the first capture in an empty directory.
    }
  }
  manifestResults.sort((a, b) => demoFiles.indexOf(a.file) - demoFiles.indexOf(b.file))
  const manifest = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    browser: path.basename(executablePath),
    demos: manifestResults,
  }
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const result of results) {
    console.log(`${result.file}: ${result.frames} frames, ${(result.duration_ms / 1000).toFixed(1)}s, ${(result.bytes / 1024 / 1024).toFixed(2)} MiB`)
  }
}

await main()
