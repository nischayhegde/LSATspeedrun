/** Which screens actually put a character canvas on the page, and under what class. */
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import { homedir } from 'node:os'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5411'
const CHROME = process.env.LIGHT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})
  for (const path of ['/office', '/firm', '/progress', '/practice', '/story', '/onboarding']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)
    const found = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll('canvas')]
      return {
        url: location.pathname,
        canvases: canvases.map((canvas) => ({
          own: canvas.className || '(none)',
          parent: canvas.parentElement?.className || '(none)',
          size: `${canvas.width}x${canvas.height}`,
        })),
        characters: window.__lsatCharacters ? window.__lsatCharacters.size : null,
      }
    })
    console.log(JSON.stringify(found, null, 1))
  }
} finally {
  await browser.close().catch(() => {})
}
