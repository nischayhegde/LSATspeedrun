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
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GL_ARGS, findChrome, launchChromium } from '../playwright-env.mjs'

export const BASE = process.env.MAPS_BASE || 'http://127.0.0.1:5173'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Where a run leaves its output: `<repo>/.maps/<name>`, both git-ignored.
 *
 * Every harness here wrote to `/Users/alan/LSATspeedrun/.maps/…` — the same
 * directory, named through one particular home directory — so all nine died on
 * `EACCES: mkdir '/Users/alan/…'` before their first frame anywhere else. Same
 * defect as the hardcoded browser path above and worth fixing in the same pass:
 * a harness that cannot start is not a harness. `MAPS_OUT` relocates it.
 */
export const scratch = (name) => resolve(process.env.MAPS_OUT || resolve(REPO_ROOT, '.maps'), name)
export const SHOTS_DIR = process.env.MAPS_SHOTS || resolve(REPO_ROOT, '.map-shots')

/**
 * The browser used to be named outright rather than discovered, because
 * `channel: 'chromium'` resolved to the x64 build on the machine this was
 * written on and then reported it as not installed — which reads like a missing
 * download rather than an architecture mismatch and costs a run to work out.
 *
 * The name it was given was an Apple-silicon app bundle under a literal
 * `chromium-1234`, so the fix for one machine was a hard failure on every other
 * one. `tools/playwright-env.mjs` lets Playwright's own registry answer first
 * and only scans the disk — every platform's layout, newest build first — when
 * that throws, which handles the original case without hardcoding its answer.
 * `MAPS_CHROME` still overrides.
 */
export { findChrome as resolveChrome }
export const CHROME_ARGS = GL_ARGS

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
 * and that is its only source of nondeterminism: there is no `Math.random` in
 * any of the map modules, so given the same sequence of deltas a district is a
 * pure function of the code. Replacing rAF with a queue that only advances when
 * asked therefore makes a whole run reproducible.
 *
 * It has to be in place *before the loop's first frame*. Evaluating it once the
 * scene is up is too late: that leaves an unknown number of real frames between
 * the scene becoming ready and the harness taking over, each advancing the
 * world by up to the delta clamp, and a district of seven walkers is chaotic
 * enough that this is not a small error. On identical code it moved The
 * Circuit's walkers-in-any-solid between .274 and .430 and the Old Quarter's
 * between .022 and .068 — larger than any effect this harness is used to judge.
 *
 * Capturing from document start instead is too early: the app never finishes
 * building the district, because something on the way to it wants a real frame.
 *
 * So capture is armed by the scene itself. `__mapScene` is an accessor here,
 * and the scene publishing itself is the trigger — which happens three lines
 * above the `requestAnimationFrame(animate)` that starts the loop, so the loop
 * is captured from its own first frame with nothing real in front of it, while
 * everything before that point still gets ordinary frames.
 */
const CLOCK_SCRIPT = () => {
  const realRequest = window.requestAnimationFrame.bind(window)
  const realCancel = window.cancelAnimationFrame.bind(window)
  const realNow = performance.now.bind(performance)
  // Captured handles live in their own numeric range so that cancelling one is
  // never confused with cancelling a real frame the page still owns.
  const CAPTURED = 1e9
  let nextId = CAPTURED
  let capturing = false
  let queue = new Map()
  const clock = {
    now: realNow(),
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
    capturing: () => capturing,
    /**
     * Gives the page real frames back, for as long as it needs to build a
     * district. Re-arms on its own when the new scene publishes itself.
     */
    release() {
      capturing = false
      for (const callback of queue.values()) realRequest(callback)
      queue = new Map()
    },
    detach() {
      clock.release()
      window.requestAnimationFrame = realRequest
      window.cancelAnimationFrame = realCancel
      performance.now = realNow
    },
  }
  /*
   * The wall clock has to go too, not just the frame clock.
   *
   * Owning rAF is not enough on its own, and believing it was cost this
   * harness its credibility for a while: two runs of the same code, same
   * district, same frame count, reported The Circuit's walkers-in-a-solid as
   * 4.3% and 7.2%, and bodies-inside-a-vehicle as 118 and 0. The scene reads
   * `performance.now()` directly in four places the frame timestamp does not
   * reach — it rebases `previousFrame` on it after a visibility change, and it
   * measures the idle interval that starts the camera's slow drift from it.
   * The camera is what decides which spawn points are unseen, and spawning is
   * what decides who is on the pavement, so a run's population depended on how
   * long the harness had taken to get there.
   *
   * Frozen between ticks and advanced by exactly one step with each, so the two
   * clocks tell the same time and a district is a function of its frame count.
   */
  performance.now = () => (capturing ? clock.now : realNow())
  window.requestAnimationFrame = (callback) => {
    if (!capturing) return realRequest(callback)
    const id = nextId += 1
    queue.set(id, callback)
    return id
  }
  window.cancelAnimationFrame = (id) => {
    if (id >= CAPTURED) queue.delete(id)
    else realCancel(id)
  }

  let published
  Object.defineProperty(window, '__mapScene', {
    configurable: true,
    get: () => published,
    set: (value) => {
      published = value
      if (!value || capturing) return
      capturing = true
      // Behind the scene's own `previousFrame`, so the loop's first delta
      // clamps to zero and every delta after it is exactly one step. Rebasing
      // to the current instant instead would leave the first frame carrying
      // whatever sub-millisecond gap the assignment happened to take.
      clock.now = realNow() - 10000
    },
  })
  window.__clock = clock
}

/**
 * Confirms the loop is actually parked in the queue.
 *
 * A run against a scene whose loop never reached the clock would tick its way
 * through 900 frames of a frozen world and report it as clean, which is the one
 * failure this harness must never fail quietly at. The retry is for the case
 * where the surface observer, not the build, is what starts the loop; no real
 * frame can slip through while waiting, because capture is already armed.
 */
async function requireClock(page) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await page.evaluate(() => ({
      present: Boolean(window.__clock),
      capturing: window.__clock?.capturing() ?? false,
      pending: window.__clock?.pending() ?? 0,
    }))
    if (!state.present) throw new Error('synthetic clock missing: the init script did not run on this document')
    if (state.capturing && state.pending > 0) return state
    await page.waitForTimeout(100)
  }
  throw new Error('no frame queued: the animate loop never reached the synthetic clock')
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
  const browser = await launchChromium({ args: GL_ARGS })
  const page = await browser.newPage({ viewport })
  await page.addInitScript(CLOCK_SCRIPT)
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 200))
  })

  // Every failure from here on has to close the browser it opened. Callers put
  // their own work in a `finally` that closes it, but they cannot reach one
  // that never returned — and a sign-in that timed out because the backend was
  // busy left a full headless Chromium parented to init, which on a machine
  // this harness has already been blamed for exhausting is the worst possible
  // way to fail.
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.locator('button', { hasText: 'Enter local development firm' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40000 })
    await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})

    // Interval polling, not the default. The default polls on rAF, which this
    // document no longer services, so the wait would never resolve.
    await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__mapScene), { timeout: 120000, polling: 100 })
    await dismissOverlays(page)
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
  return { browser, page, errors }
}

/**
 * Puts the scene on one district and returns it under the synthetic clock.
 *
 * The clock goes on the moment the scene exists, and the district is then
 * settled in ticks rather than in wall time. Settling on the wall clock first
 * is the obvious way to write this and it is not reproducible: how many real
 * frames fit in a fixed sleep depends on machine load, each of those frames
 * advances the traffic and the crowd, and the measurement then starts from a
 * different world every run. Measured on the Old Quarter, that alone moved
 * walkers-in-a-solid between .0347 and .0220 on identical code — larger than
 * most of the effects this harness is used to judge.
 *
 * `waitForFunction` is given an interval rather than its default, which polls
 * on rAF: the override would starve that poll and the wait would hang.
 */
export async function region(page, label, { key, warmup = 600 } = {}) {
  const current = await page.evaluate(() => window.__mapScene?.region)
  if (current !== key) {
    // Real frames while the next district is built; the accessor re-arms the
    // capture the moment that district publishes itself.
    await page.evaluate(() => window.__clock?.release())
    const toggle = page.locator('.uw-atlas-toggle')
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') {
      await toggle.click()
      await page.waitForTimeout(250)
    }
    await page.locator('.uw-arc-navigation button', { hasText: label }).first().click()
    await page.waitForFunction((want) => window.__mapScene?.region === want, key, {
      timeout: 120000,
      polling: 50,
    })
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') {
      await toggle.click()
    }
  }
  await dismissOverlays(page)
  await requireClock(page)
  // Ticked, not slept. Ten virtual seconds is enough for the traffic to leave
  // its start positions and the crowd to reach its steady population, and it is
  // the same ten seconds in every arm.
  if (warmup) await page.evaluate((count) => window.__clock.tick(count), warmup)
  return page
}

export { requireClock, detachClock }
