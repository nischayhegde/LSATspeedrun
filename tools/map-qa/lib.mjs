/**
 * Shared browser harness for the map scenes.
 *
 * This file is the one `collide.mjs`, `footway-audit.mjs` and `retainer.mjs`
 * all import. It used to live in `.maps/`, which is throwaway scratch and was
 * cleaned up, taking it with it and leaving three tracked harnesses that could
 * not be run. It lives beside them now.
 *
 * Two things it provides that a plain Playwright script does not:
 *
 *   region()  — puts the scene on a named district and waits for the rebuild,
 *               rather than sleeping and hoping.
 *   __clock   — a synthetic frame clock, so a measurement is a pure function of
 *               the code rather than of how loaded the machine was.
 */
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'

export const BASE = process.env.MAPS_BASE || 'http://127.0.0.1:5173'

// Named outright rather than through `channel: 'chromium'`. The channel lookup
// resolves to the x64 build on this machine and then reports the browser as not
// installed, which reads like a missing download rather than an architecture
// mismatch and costs a run to work out.
export const CHROME = process.env.MAPS_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

/** Region key to the label its navigation button carries. */
export const TABS = {
  city: 'Old Quarter',
  nation: 'The Circuit',
  ocean: 'Treaty Sea',
  continent: 'Sovereign Arc',
  orbit: 'Global Compact',
}

export function save(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

/*
 * The synthetic frame clock.
 *
 * The scene's animate loop derives its delta from the timestamp rAF hands it,
 * and that is its only source of nondeterminism: everything else — traffic,
 * crowd, transports — is a pure function of that delta. Replacing rAF with a
 * queue that only advances when asked therefore makes a whole run reproducible.
 *
 * Installed *after* the scene is up rather than at document start, deliberately.
 * Overriding rAF before the app boots risks starving anything in React or the
 * app shell that waits on a frame to make progress. Installing late means the
 * loop has one real frame in flight; that frame re-registers through the
 * override and the loop is synthetic from then on, which `handover` waits for.
 */
const INSTALL_CLOCK = () => {
  if (window.__clock) return
  const realRequest = window.requestAnimationFrame.bind(window)
  const realCancel = window.cancelAnimationFrame.bind(window)
  let nextId = 1
  let queue = new Map()
  const clock = {
    now: performance.now(),
    step: 1000 / 60,
    frames: 0,
    errors: [],
    tick(count = 1) {
      for (let index = 0; index < count; index += 1) {
        clock.now += clock.step
        clock.frames += 1
        // Swapped out before draining: a callback re-registers for the next
        // frame, and running those in this frame would be an unbounded loop.
        const due = queue
        queue = new Map()
        for (const callback of due.values()) {
          try {
            callback(clock.now)
          } catch (error) {
            if (clock.errors.length < 5) clock.errors.push(String(error))
          }
        }
      }
    },
    pending: () => queue.size,
    /** Hands the queued frames back to the browser and steps out of the way. */
    detach() {
      window.requestAnimationFrame = realRequest
      window.cancelAnimationFrame = realCancel
      for (const callback of queue.values()) realRequest(callback)
      queue = new Map()
      window.__clock = undefined
    },
  }
  window.requestAnimationFrame = (callback) => {
    const id = nextId += 1
    queue.set(id, callback)
    return id
  }
  window.cancelAnimationFrame = (id) => { queue.delete(id) }
  window.__clock = clock
}

async function installClock(page) {
  await page.evaluate(INSTALL_CLOCK)
  // Wait for the in-flight real frame to re-register through the override. A
  // measurement against a loop that never handed over would tick 900 times and
  // report a frozen scene as a clean one, so this is a hard failure.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await page.evaluate(() => (window.__clock?.pending() ?? 0) > 0)) return
    await page.waitForTimeout(50)
  }
  throw new Error('animate loop never handed over to the synthetic clock')
}

async function detachClock(page) {
  await page.evaluate(() => window.__clock?.detach())
}

async function dismissOverlays(page) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const defer = page.locator('.cutscene-defer, .cutscene-continue')
    if (await defer.count() === 0) return
    await defer.first().click().catch(() => {})
    await page.waitForTimeout(300)
  }
}

/** Signs in, opens the map, and waits for a scene to exist. */
export async function open({ viewport = { width: 1440, height: 900 } } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 200))
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})

  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__mapScene), { timeout: 120000 })
  await dismissOverlays(page)
  return { browser, page, errors }
}

/**
 * Puts the scene on one district and returns it under the synthetic clock.
 *
 * `settle` is real time, before the handover: the crowd and traffic want a
 * moment to reach a steady state, and doing that on the wall clock rather than
 * on ticks keeps the tick budget for the measurement itself. It is a fixed
 * duration so that two arms see the same amount of it.
 */
export async function region(page, label, { key, settle = 1600, warmup = 90 } = {}) {
  if (await page.evaluate(() => Boolean(window.__clock))) await detachClock(page)

  const current = await page.evaluate(() => window.__mapScene?.region)
  if (current !== key) {
    const toggle = page.locator('.uw-atlas-toggle')
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') {
      await toggle.click()
      await page.waitForTimeout(250)
    }
    await page.locator('.uw-arc-navigation button', { hasText: label }).first().click()
    await page.waitForFunction((want) => window.__mapScene?.region === want, key, { timeout: 120000 })
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') {
      await toggle.click()
    }
  }
  await dismissOverlays(page)
  await page.waitForTimeout(settle)
  await installClock(page)
  // A fixed number of ticks before anything is counted, so a district is
  // measured in motion rather than in the pose it was built in.
  if (warmup) await page.evaluate((count) => window.__clock.tick(count), warmup)
  return page
}

export { installClock, detachClock }
