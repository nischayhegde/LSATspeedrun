/**
 * Browser harness for the theme conformance sweep.
 *
 * Runs against the dev server with a real signed-in session, because most of
 * the surfaces worth auditing (ledger, retainers, review panels, on-hold
 * cards) only exist once there is a game. Chromium cannot start under the
 * agent sandbox, so every script that imports this has to be run unsandboxed.
 *
 * Browser and Playwright resolution is delegated to `tools/playwright-env.mjs`
 * rather than re-hardcoded here; `.shots/lib.mjs` predates that module and
 * still points at a path under /private/tmp that macOS empties.
 */
import { mkdirSync } from 'node:fs'
import { launchChromium } from '../playwright-env.mjs'

export const BASE = process.env.BASE || 'http://127.0.0.1:5173'

export const WIDTHS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
}

export async function launch() {
  // No GL args: these are flat DOM screenshots and SwiftShader only slows the
  // office and map scenes down. The two scene routes pass GL_ARGS themselves.
  return launchChromium({ args: [] })
}

/** Signs in through the dev-auth button once; later contexts reuse the state. */
export async function signIn(browser) {
  const context = await browser.newContext({ viewport: WIDTHS.desktop })
  const page = await context.newPage()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Enter local development firm').click({ noWaitAfter: true, timeout: 30000 })
    try {
      await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 })
      break
    } catch {
      if (attempt === 3) throw new Error('sign-in never left /login')
    }
  }
  await page.waitForTimeout(1200)
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done'))
  const state = await context.storageState()
  await context.close()
  return state
}

export async function open(browser, state, viewport) {
  const context = await browser.newContext({
    viewport,
    storageState: state,
    // Animations are held still so a screenshot pair differs only where the
    // rules differ, not by where each run happened to catch a transition.
    reducedMotion: 'reduce',
    hasTouch: viewport.width <= 900,
    isMobile: false,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message))
  return { context, page }
}

export async function visit(page, route, { settle = 2000 } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})
  await page.waitForTimeout(settle)
}

export function shotDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}
