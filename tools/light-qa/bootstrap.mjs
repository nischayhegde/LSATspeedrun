/**
 * Gives this checkout's database a firm, once.
 *
 * A fresh database has an account but no game profile, so `/office` and `/map`
 * both bounce to `/onboarding` and every measurement is taken against the
 * onboarding screen's tier-0 preview instead of the room that was asked for.
 * That is not obvious from the numbers — the preview renders perfectly well and
 * reports a plausible 107 draw calls — which is exactly why it is worth a
 * script rather than a step in a comment.
 *
 * Usage: node tools/light-qa/bootstrap.mjs
 */
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import { homedir } from 'node:os'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5411'
const CHROME = process.env.LIGHT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})

  if (!page.url().includes('/onboarding')) {
    await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
  }
  if (page.url().includes('/progress')) {
    console.log('already has a firm')
  } else {
    await page.locator('button', { hasText: "Skip — I'll decide later" }).click({ timeout: 60000 })
    await page.locator('label', { hasText: 'Lawyer name' }).locator('input').fill('Lighting Counsel')
    await page.locator('label', { hasText: 'Firm name' }).locator('input').fill('Lumen & Partners')
    await page.locator('button', { hasText: 'Open the doors' }).click()
    await page.waitForURL((url) => url.pathname.startsWith('/progress'), { timeout: 60000 })
    console.log('firm created')
  }
} finally {
  await browser.close().catch(() => {})
}
