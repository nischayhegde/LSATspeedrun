/**
 * Photograph the mandatory approach card on a real case surface, at the two
 * widths the strategy instruments were rebuilt against.
 *
 * The point is the two numbers it prints: how far the case scrolls with a
 * standing order on it, at 1440 and at 390. The rebuild that cut desktop
 * scroll from 890px to 235px is the thing this feature must not undo, and a
 * card that reads well in isolation can still push the answer choices under
 * the fold.
 *
 * It measures three states, because the comparison that matters is not the one
 * that first suggests itself. A mandatory question opens with its gate already
 * armed, so setting it beside an unarmed suggestion would charge this feature
 * for a panel that was always there. The state to beat is the suggestion after
 * the student presses Use it, which is the same gate reached one click later.
 *
 * Needs a browser driver, which is deliberately not a dependency of the app:
 *   npm i --no-save playwright-core
 *
 * Run against a stack of your own, not the shared one:
 *   backend:  PORT=5099 DEV_AUTH_ENABLED=true python run.py
 *   frontend: LSAT_API_PORT=5099 npx vite --port 5199 --strictPort
 *   node scripts/shoot-standing-order.mjs
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:5199'
const OUT = new URL('../.strategy-shots/', import.meta.url).pathname

/**
 * Take runs until one opens on the kind of question asked for, from inside the
 * page so the session belongs to the browser's own cookie.
 */
async function sessionOpeningOn(page, wantRequired) {
  return page.evaluate(async (want) => {
    const csrf = () => document.cookie.split('; ').find((c) => c.startsWith('lsat_csrf='))?.slice(10) || ''
    const call = async (method, path, body) => {
      const response = await fetch(`/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return response.json().catch(() => ({}))
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      // A fresh student each time. The daily cap is per student and counts
      // every run dealt today, abandoned or not, so reusing one would run out
      // of mandatory questions after the first few runs -- the cap working,
      // not the draw failing.
      const email = `shot-${Math.random().toString(36).slice(2, 10)}@localhost.test`
      await call('POST', '/auth/dev', { email, display_name: 'Shot Student' })
      await call('POST', '/game/profile', {
        lawyer_name: 'Alex Morgan',
        firm_name: 'Morgan Legal',
        character_gender: 'female',
      })
      const { session } = await call('POST', '/study-sessions', { size: 10 })
      const trial = session?.current_item?.strategy_trial
      const gate = session?.current_item?.strategy_gate
      if (trial && gate && Boolean(trial.required) === want) return session.id
      if (session?.id) await call('POST', `/study-sessions/${session.id}/abandon`)
    }
    return null
  }, wantRequired)
}

/** What the case surface costs the eye, in the two ways it can cost it. */
function measure(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.strategy-tip')
    const worstPane = [...document.querySelectorAll('*')]
      .map((node) => Math.max(0, node.scrollHeight - node.clientHeight))
      .reduce((worst, value) => Math.max(worst, value), 0)
    return {
      // The document and whichever pane scrolls furthest inside it. The case
      // surface is a fixed-height layout, so the document number on its own
      // would report a comfortable page that has hidden its answers in a pane.
      documentScroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      worstPaneScroll: worstPane,
      cardHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
      cardText: card?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? null,
      overflowsX: document.documentElement.scrollWidth > window.innerWidth + 1,
    }
  })
}

async function shoot(browser, { label, width, height }, required) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: width < 700,
    hasTouch: width < 700,
  })
  const page = await context.newPage()
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
  const sessionId = await sessionOpeningOn(page, required)
  if (!sessionId) throw new Error(`no run opened on a ${required ? 'mandatory' : 'optional'} prompt`)

  // Not `networkidle`: the case surface keeps a poll open, so idle never comes.
  await page.goto(`${ORIGIN}/cases/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.strategy-tip', { timeout: 30000 })
  // Let the entry animation settle so the height below is the resting one.
  await page.waitForTimeout(1200)

  const measured = await measure(page)

  const name = `${required ? 'standing-order' : 'optional-prompt'}-${label}`
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false })

  // The honest comparison for an optional prompt is the state it reaches when
  // the student says yes, because that is the same gate the mandatory arm
  // opens on arrival. Comparing an unarmed card against an armed one would
  // charge this feature for the panel it did not add.
  let armed = null
  if (!required) {
    const use = page.getByRole('button', { name: 'Use it' })
    if (await use.count()) {
      await use.first().click()
      await page.waitForTimeout(1200)
      armed = await measure(page)
      await page.screenshot({ path: `${OUT}${name}-armed.png`, fullPage: false })
    }
  }
  await context.close()
  return { ...measured, armed }
}

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM ||
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  args: ['--disable-dev-shm-usage', '--no-sandbox'],
})
await mkdir(OUT, { recursive: true })
try {
  for (const viewport of [
    { label: '1440', width: 1440, height: 900 },
    { label: '390', width: 390, height: 844 },
  ]) {
    console.log(`\n${viewport.label}px`)
    for (const required of [false, true]) {
      const measured = await shoot(browser, viewport, required)
      const line = (name, state) =>
        `  ${name.padEnd(24)} card ${String(state.cardHeight).padStart(4)}px` +
        `   document ${String(state.documentScroll).padStart(5)}px` +
        `   worst pane ${String(state.worstPaneScroll).padStart(5)}px` +
        `   x-overflow ${state.overflowsX}`
      console.log(line(required ? 'standing order' : 'optional prompt', measured))
      if (measured.armed) console.log(line('optional prompt, armed', measured.armed))
    }
  }
} finally {
  await browser.close()
}
