/**
 * Pixel-aligned before/after stills for anything the composite can be told to
 * stop doing.
 *
 * Two runs of the harness cannot be compared pixel for pixel: the crowd
 * populates differently between dev-server lifetimes, so a diff of two runs is
 * mostly pedestrians. Toggling a uniform on one built scene and photographing
 * it twice gives a pair that differs by exactly the thing under discussion, and
 * a difference image that means something.
 *
 * Only the canvas is captured, not the page, because the surrounding chrome is
 * identical in both arms and its text antialiasing is not.
 *
 * Usage: node tools/light-qa/ab-stills.mjs <tag> [surface...]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import { homedir } from 'node:os'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5411'
const CHROME = process.env.LIGHT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const REGIONS = { city: 'Old Quarter', nation: 'The Circuit', ocean: 'Treaty Sea', continent: 'Sovereign Arc', orbit: 'Global Compact' }
const tag = process.argv[2] ?? 'ab'
const asked = process.argv.slice(3)
const regionKeys = (asked.length ? asked : Object.keys(REGIONS)).filter((key) => REGIONS[key])
const officeTiers = (asked.length ? asked : ['office0', 'office11']).filter((key) => /^office\d+$/.test(key)).map((key) => Number(key.slice(6)))

const OUT = `/private/tmp/lsat-light/.light-shots/${tag}`
mkdirSync(OUT, { recursive: true })

const CLOCK_SCRIPT = () => {
  const realRequest = window.requestAnimationFrame.bind(window)
  const realCancel = window.cancelAnimationFrame.bind(window)
  const realNow = performance.now.bind(performance)
  const CAPTURED = 1e9
  let nextId = CAPTURED
  let capturing = false
  let queue = new Map()
  const clock = {
    now: realNow(), step: 1000 / 60, frames: 0,
    tick(count = 1) {
      for (let index = 0; index < count; index += 1) {
        clock.now += clock.step
        clock.frames += 1
        const due = queue
        queue = new Map()
        for (const callback of due.values()) { try { callback(clock.now) } catch { /* not this tool's business */ } }
      }
    },
    pending: () => queue.size,
    capturing: () => capturing,
    release() { capturing = false; for (const callback of queue.values()) realRequest(callback); queue = new Map() },
  }
  performance.now = () => (capturing ? clock.now : realNow())
  window.requestAnimationFrame = (callback) => {
    if (!capturing) return realRequest(callback)
    const id = nextId += 1
    queue.set(id, callback)
    return id
  }
  window.cancelAnimationFrame = (id) => { if (id >= CAPTURED) queue.delete(id); else realCancel(id) }
  let published
  Object.defineProperty(window, '__mapScene', {
    configurable: true,
    get: () => published,
    set: (value) => { published = value; if (!value || capturing) return; capturing = true; clock.now = realNow() - 10000 },
  })
  window.__clock = clock
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(CLOCK_SCRIPT)
const written = []

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})

  for (const tier of officeTiers) {
    await page.goto(`${BASE}/office?officeTier=${tier}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__officeDebug), { timeout: 180000, polling: 200 })
    if (!new URL(page.url()).pathname.startsWith('/office')) throw new Error(`/office redirected to ${page.url()}`)
    // The room opens behind a story cutscene at several tiers. An element
    // screenshot photographs the page region the element occupies, overlay and
    // all, so without this the office arm returns two beautiful pictures of a
    // narrative panel.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const defer = page.locator('.cutscene-defer, .cutscene-continue, button:has-text("Not now")')
      if (await defer.count() === 0) break
      await defer.first().click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(300)
    }
    await page.waitForTimeout(2500)
    // Named exactly. A comma-separated selector resolves in document order,
    // not in the order the alternatives are written, and the office page's
    // first canvas is the lawyer portrait in the sidebar — which photographs
    // perfectly well and is not the room.
    const canvas = page.locator('canvas.office-three-canvas').first()
    const authored = await page.evaluate(() => window.__officeDebug.stylePass.occlusionStrength)
    for (const [name, strength] of [['off', 0], ['on', authored]]) {
      await page.evaluate((value) => window.__officeDebug.stylePass.configure({ occlusion: value }), strength)
      await page.waitForTimeout(500)
      const file = `${OUT}/office${tier}-${name}.png`
      await canvas.screenshot({ path: file })
      written.push(file)
    }
    await page.evaluate((value) => window.__officeDebug.stylePass.configure({ occlusion: value }), authored)
    console.log(`office${tier} authored occlusion ${authored}`)
  }

  if (regionKeys.length) {
    await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__mapScene), { timeout: 180000, polling: 100 })
    const toggle = page.locator('.uw-atlas-toggle')
    for (const key of regionKeys) {
      const current = await page.evaluate(() => window.__mapScene?.region)
      if (current !== key) {
        await page.evaluate(() => window.__clock?.release())
        if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') { await toggle.click(); await page.waitForTimeout(400) }
        const button = page.locator('.uw-arc-navigation button', { hasText: REGIONS[key] }).first()
        await button.waitFor({ state: 'visible', timeout: 30000 })
        await button.click()
        await page.waitForFunction((want) => window.__mapScene?.region === want, key, { timeout: 180000, polling: 50 })
      }
      for (const selector of ['.cutscene-defer', '.cutscene-continue', 'button:has-text("Not now")']) {
        const found = page.locator(selector)
        if (await found.count()) await found.first().click({ timeout: 3000 }).catch(() => {})
      }
      await page.waitForFunction(() => window.__clock?.capturing() && window.__clock?.pending() > 0, { timeout: 60000, polling: 100 })
      await page.evaluate(() => window.__clock.tick(600))
      const canvas = page.locator('canvas.uw-three-canvas').first()
      const authored = await page.evaluate(() => window.__mapScene.stylePass.occlusionStrength)
      for (const [name, strength] of [['off', 0], ['on', authored]]) {
        // Ticked rather than slept: the loop is parked on the synthetic clock,
        // so one tick is exactly one frame drawn with the new setting and
        // nothing in the world has moved between the two arms.
        await page.evaluate((value) => { window.__mapScene.stylePass.configure({ occlusion: value }); window.__clock.tick(1) }, strength)
        const file = `${OUT}/map-${key}-${name}.png`
        await canvas.screenshot({ path: file })
        written.push(file)
      }
      await page.evaluate((value) => { window.__mapScene.stylePass.configure({ occlusion: value }); window.__clock.tick(1) }, authored)
      console.log(`${key} authored occlusion ${authored}`)
    }
  }
} finally {
  writeFileSync(`${OUT}/index.json`, JSON.stringify(written, null, 2))
  await browser.close().catch(() => {})
}
console.log(`\n${written.length} stills in ${OUT}`)
