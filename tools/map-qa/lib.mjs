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
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * Playwright, wherever this machine happens to keep it.
 *
 * This used to be a hard-coded `/private/tmp/pwrt/...` import, which is one
 * developer's scratch install on one macOS machine: every other checkout —
 * including a Linux one — failed at parse time, before any of the discipline
 * below could run. Resolution is now: `MAPS_PLAYWRIGHT` if set, then the usual
 * candidates, and the error says what to install rather than naming a path
 * nobody else has.
 */
const PLAYWRIGHT_CANDIDATES = [
  process.env.MAPS_PLAYWRIGHT,
  'playwright',
  '/tmp/pwrt/node_modules/playwright/index.mjs',
  '/private/tmp/pwrt/node_modules/playwright/index.mjs',
].filter(Boolean)

async function loadChromium() {
  const failures = []
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try {
      const module = await import(candidate)
      if (module.chromium) return module.chromium
    } catch (error) {
      failures.push(`${candidate}: ${String(error.message).split('\n')[0]}`)
    }
  }
  throw new Error(
    `playwright not found. Install it anywhere node can resolve it and set MAPS_PLAYWRIGHT, e.g.\n`
    + `  mkdir -p /tmp/pwrt && cd /tmp/pwrt && npm init -y && npm install playwright\n`
    + `Tried:\n  ${failures.join('\n  ')}`,
  )
}

export const BASE = process.env.MAPS_BASE || 'http://127.0.0.1:5173'

/**
 * Where reports land: this checkout's own `.maps`, not a path typed out once
 * and then shared by every worktree on the machine. Several checkouts of this
 * branch are measured side by side, and a hard-coded home directory means two
 * arms overwrite each other's evidence with the same tag.
 */
export const OUT = process.env.MAPS_OUT || fileURLToPath(new URL('../../.maps', import.meta.url))

// Named outright rather than through `channel: 'chromium'`. The channel lookup
// resolves to the x64 build on this machine and then reports the browser as not
// installed, which reads like a missing download rather than an architecture
// mismatch and costs a run to work out.
const BUNDLED = `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
/**
 * Stock Chrome, as the fallback.
 *
 * The `ms-playwright` cache is 400 MB of a disk that has been at 99% all day,
 * and it was deleted out from under a running measurement this evening to
 * reclaim space — which presents as "executable doesn't exist" and reads like a
 * broken harness rather than like the disk. Re-downloading it costs back the
 * space somebody deliberately freed, so prefer the browser already installed.
 */
const STOCK = [
  '/Applications/Google Chrome/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
export const CHROME = process.env.MAPS_CHROME
  || (existsSync(BUNDLED) ? BUNDLED : STOCK.find((path) => existsSync(path)))

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
    now: 0,
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
      /*
       * Zero, and the same zero every run. This one line was the bimodality.
       *
       * It used to be `realNow() - 10000`, which is behind the scene's own
       * `previousFrame` — so the loop's first delta still clamps to zero, which
       * was the point — but it also made every synthetic timestamp a sum of
       * steps onto an origin that was different in every server lifetime. The
       * loop computes its delta as `(frameNow - previousFrame) / 1000`, and in
       * float64 that subtraction rounds differently depending on the magnitude
       * of its operands, so the crowd's accumulated time came out a few units
       * in the last place apart between runs. Its decisions are drawn from
       * `hashUnit(agent.seed + this.elapsed)`, and once in a while a walker
       * landed the other side of a threshold, took a different turning, and
       * spent the rest of the run inside a building.
       *
       * That is why a run was never a spread but one of a handful of discrete,
       * perfectly reproducible worlds — a handful being how many distinct
       * rounding patterns the origin can fall into — and why the other worker
       * saw a fresh run reproduce an earlier one bit for bit across a restart.
       * Observed directly before the fix: the crowd's `elapsed` came back as
       * 29.99999999999958 or 30.00000000000056, and its spawn cursor as 23, 25
       * or 26, on an untouched tree at the same frame count.
       *
       * A fixed origin makes the whole timestamp sequence bit-identical, and
       * zero keeps it as far behind any real timestamp the page captured before
       * capture began as the old value did.
       */
      clock.now = 0
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

/**
 * Whether the dev server behind `BASE` has hot-reloaded since it started.
 *
 * Measured, this matters more than most of the changes this harness is used to
 * judge: an unmodified tree read .0021 on a freshly started server and .0109 on
 * one that had hot-reloaded through six edits, and the static geometry was
 * identical to the unit both times. Vite keeps a module graph across an edit and
 * the scene does not come back the same. Every arm measured without a restart
 * is therefore comparing against a control taken in a different world.
 *
 * Detected rather than trusted to discipline: the server's own start time
 * against the newest source file under it. Best-effort — a remote `BASE`, a
 * missing `lsof` or a production build all return `null`, which is reported as
 * unknown rather than as clean.
 */
function serverWarmth(base) {
  try {
    const port = new URL(base).port
    if (!port) return null
    const pid = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0]
    if (!pid) return null
    // `etime` is elapsed wall time, which needs no date parsing and no locale.
    const elapsed = execFileSync('ps', ['-o', 'etime=', '-p', pid], { encoding: 'utf8' }).trim()
    const parts = elapsed.split(/[-:]/).map(Number).reverse()
    const seconds = (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600 + (parts[3] ?? 0) * 86400
    const started = Date.now() - seconds * 1000
    const root = fileURLToPath(new URL('../../frontend/src', import.meta.url))
    let newest = 0
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const at = statSync(`${entry.parentPath ?? entry.path}/${entry.name}`).mtimeMs
      if (at > newest) newest = at
    }
    return { cold: newest <= started, editedAgoMs: Date.now() - newest, upMs: Date.now() - started }
  } catch {
    return null
  }
}

/**
 * Which development firm to sign in as.
 *
 * The button on the login page always signs in the one default profile, and
 * most probes want that. The late-game map does not exist on it: districts in
 * the Treaty Sea and the Global Compact only unlock at tier 7 and tier 12, and
 * a contact figure is placed only for a connection the firm owns. Setting this
 * signs in by email instead, so `tools/map-qa/late-firm.py` can stand a tier-14
 * firm up beside the tier-0 one rather than on top of it.
 */
export const EMAIL = process.env.MAPS_EMAIL || null

/** Signs in, opens the map, and waits for a scene to exist. */
export async function open({ viewport = { width: 1440, height: 900 }, email = EMAIL } = {}) {
  const warmth = serverWarmth(BASE)
  if (warmth && !warmth.cold) {
    console.warn('\n!! HOT SERVER: a source file has changed since this dev server started.')
    console.warn('!! Restart it before measuring. An unmodified tree reads .0021 cold and .0109 hot.')
    console.warn(`!! (up ${(warmth.upMs / 1000).toFixed(0)}s, last edit ${(warmth.editedAgoMs / 1000).toFixed(0)}s ago)\n`)
  }
  const chromium = await loadChromium()
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
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
    if (email) {
      // The same endpoint the button posts to, with a chosen firm. Done in the
      // page so the auth cookies land on this context exactly as they would.
      const signedIn = await page.evaluate(async (address) => {
        const response = await fetch('/v1/auth/dev', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: address, display_name: 'Late Firm' }),
        })
        return response.status
      }, email)
      if (signedIn !== 200) throw new Error(`dev sign-in for ${email} returned ${signedIn}`)
    } else {
      // Generous, because the first load of a cold dev server compiles the whole
      // module graph before the page renders at all, and the default 30 s expires
      // on a loaded machine while Vite is still optimising dependencies. That
      // presents as "the dev-login button does not exist", which sends a reader
      // looking at the backend's auth config instead of at the clock.
      await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40000 })
    }
    await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})

    // Interval polling, not the default. The default polls on rAF, which this
    // document no longer services, so the wait would never resolve.
    await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
    // Options are `waitForFunction`'s THIRD parameter; the second is the
    // argument passed to the predicate. Written as two, the 120 s and the
    // interval poll were being handed to the page as an unused argument while
    // the wait ran on its rAF default and its own 30 s — which on a
    // software-GL machine, where building a district takes longer than that,
    // presents as "the scene never publishes".
    await page.waitForFunction(() => Boolean(window.__mapScene), null, { timeout: 180000, polling: 100 })
    await dismissOverlays(page)
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
  return { browser, page, errors }
}

/**
 * Clicks through to a district and waits for it, **without giving the page a
 * single real frame** while it builds.
 *
 * This is the fix for the thing that made every number this harness has ever
 * produced unreadable. A run does not draw from a distribution: it lands in one
 * of a handful of discrete worlds, each perfectly reproducible, and what
 * selects the world is how many real frames elapsed while the district was
 * being built. The old code called `__clock.release()` here for exactly that
 * stretch, on the reasoning that a build wants real frames — so the count was
 * whatever the machine's load allowed, and the Old Quarter came back as either
 * .0021 or .0109 depending on which side of a threshold it fell.
 *
 * It turns out the build wants no frames at all. It is synchronous inside a
 * React effect, and everything it waits on is a promise rather than a frame, so
 * polling on an interval while the capture stays armed gets the same district
 * every time with an elapsed frame count of exactly zero. Mostly: some builds do
 * want a frame — Sovereign Arc reliably, and the others now and then — so a
 * build that has not published in twenty seconds gets real frames rather than
 * hanging out the run. That is the unreproducible path, so it is counted on
 * `window.__unpinnedBuilds` and reported in every probe's `entry` block; a run
 * with a non-zero count is a run whose crowd started from wherever the machine's
 * load left it, and it should not be compared with anything.
 */
async function switchTo(page, label, key) {
  const toggle = page.locator('.uw-atlas-toggle')
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') {
    await toggle.click()
    await page.waitForTimeout(250)
  }
  await page.locator('.uw-arc-navigation button', { hasText: label }).first().click()
  const arrived = (want) => window.__mapScene?.region === want
  try {
    await page.waitForFunction(arrived, key, { timeout: 20000, polling: 50 })
  } catch {
    await page.evaluate(() => {
      window.__unpinnedBuilds = (window.__unpinnedBuilds ?? 0) + 1
      window.__clock?.release()
    })
    await page.waitForFunction(arrived, key, { timeout: 120000, polling: 50 })
  }
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') {
    await toggle.click()
  }
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
export async function region(page, label, { key, warmup = 600, cold = true } = {}) {
  // Always build the district under measurement here, even when the app has
  // already landed on it. The one the page arrives on was built while the
  // harness was still signing in, with however many real frames the machine
  // happened to fit into that window — which is the variable this whole
  // function exists to remove. Building it again costs a second and makes the
  // district a function of the code.
  // A key with no tab spends two minutes clicking whichever button matched
  // `undefined` and then times out waiting for a region that cannot arrive.
  // Sovereign Arc is `continent`, not `arc`, and that mistake has cost two runs.
  if (!TABS[key]) throw new Error(`unknown region ${key}; expected one of ${Object.keys(TABS).join(', ')}`)
  if (cold) {
    const away = Object.entries(TABS).find(([other]) => other !== key)
    if (await page.evaluate(() => window.__mapScene?.region) === key && away) {
      await switchTo(page, away[1], away[0])
    }
    await switchTo(page, label, key)
  } else if (await page.evaluate(() => window.__mapScene?.region) !== key) {
    await switchTo(page, label, key)
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
