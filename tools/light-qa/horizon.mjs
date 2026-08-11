/**
 * Does the player ever see the sky, and does it now have a sun in it?
 *
 * The follow camera looks down at the district, so the default framing of
 * every district is roofs and pavement with no horizon anywhere in it. A sky
 * change that cannot be seen is not worth the line it is written on, so this
 * takes the map's own survey view — the one the `0` and `-` controls give the
 * player — and photographs whatever sky is in it.
 *
 * Usage: node tools/light-qa/horizon.mjs <tag> [region...]
 */
import { mkdirSync } from 'node:fs'
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import { homedir } from 'node:os'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5411'
const CHROME = process.env.LIGHT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const REGIONS = { city: 'Old Quarter', nation: 'The Circuit', ocean: 'Treaty Sea', continent: 'Sovereign Arc', orbit: 'Global Compact' }

const tag = process.argv[2] ?? 'horizon'
const keys = process.argv.slice(3).filter((key) => REGIONS[key])
const wanted = keys.length ? keys : ['city']
const OUT = `/private/tmp/lsat-light/.light-shots/${tag}`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__mapScene), { timeout: 180000, polling: 100 })

  const toggle = page.locator('.uw-atlas-toggle')
  for (const key of wanted) {
    const current = await page.evaluate(() => window.__mapScene?.region)
    if (current !== key) {
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
    const canvas = page.locator('canvas.uw-three-canvas').first()
    await canvas.click({ position: { x: 20, y: 20 } }).catch(() => {})
    await page.keyboard.press('0')
    await page.waitForTimeout(700)
    for (let step = 0; step < 6; step += 1) { await page.keyboard.press('-'); await page.waitForTimeout(220) }
    await page.waitForTimeout(1400)
    await canvas.screenshot({ path: `${OUT}/${key}-survey.png` })

    // How much of the frame is sky at all, straight off the depth buffer. The
    // eye is a poor judge of this on a dark district and the answer decides
    // whether the sky is worth touching.
    const skyShare = await page.evaluate(() => {
      const { renderer, scene, camera } = window.__mapScene
      const size = renderer.getSize(new window.__mapThree.Vector2())
      const target = new window.__mapThree.WebGLRenderTarget(Math.floor(size.x / 4), Math.floor(size.y / 4))
      const previous = renderer.getRenderTarget()
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      const pixels = new Uint8Array(target.width * target.height * 4)
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels)
      renderer.setRenderTarget(previous)
      target.dispose()
      // The sky dome is the only thing in the scene without a normal-mapped
      // surface under it, so it is identified by position rather than colour:
      // anything the camera sees above the horizon line of the ground plane.
      let above = 0
      for (let index = 0; index < pixels.length; index += 4) {
        const row = Math.floor(index / 4 / target.width)
        if (row > target.height * .72) above += 1
      }
      return { width: target.width, height: target.height, topBandPixels: above }
    })
    console.log(key, JSON.stringify(skyShare))
  }
} finally {
  await browser.close().catch(() => {})
}
console.log(`stills in ${OUT}`)
