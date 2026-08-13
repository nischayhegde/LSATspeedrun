/**
 * Before/after instrument for the lighting work.
 *
 * One browser, one pass over every surface the lighting change touches: the
 * five districts, the office at a low and a high tier, and a page of portraits.
 * Each surface reports what it costs to draw and leaves a still behind, so a
 * claim about the look and a claim about the price come out of the same run.
 *
 * ## What is trustworthy here and what is not
 *
 * Draw calls, triangles, geometries and programs are stable: they are counted
 * off one forced render of a scene graph that is a pure function of the code.
 * Frame time is measured by driving frames as fast as they will go and then
 * blocking on the GPU, which is far steadier than sampling a vsynced rAF, but
 * it is still a wall-clock number on a loaded machine.
 *
 * The map's crowd population is known to differ between dev-server lifetimes,
 * so a before and an after must be taken against *the same server process*.
 * That is why this is one script that runs every surface rather than one per
 * surface: the arms differ by the tag on the command line and by nothing else.
 *
 * Usage: node tools/light-qa/bench.mjs <tag> [surface...]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launch } from './browser.mjs'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5411'
// This checkout's own scratch, not a worktree path typed out once on one
// machine. `.light` is ignored, so nothing here can reach a commit.
const ROOT = process.env.LIGHT_OUT || fileURLToPath(new URL('../../.light', import.meta.url))

const tag = process.argv[2] ?? 'run'
const only = new Set(process.argv.slice(3))
const wanted = (name) => only.size === 0 || only.has(name)

const SHOTS = `${ROOT}/.light-shots/${tag}`
const REPORTS = `${ROOT}/.light-run`
mkdirSync(SHOTS, { recursive: true })
mkdirSync(REPORTS, { recursive: true })

const REGIONS = [
  ['city', 'Old Quarter'],
  ['nation', 'The Circuit'],
  ['ocean', 'Treaty Sea'],
  ['continent', 'Sovereign Arc'],
  ['orbit', 'Global Compact'],
]

/**
 * Office tiers to look at: the back room everyone starts in, and a tower.
 *
 * Overridable, because "which tiers" is the question in some passes and not in
 * others — a roof audit wants all fifteen and a lighting A/B wants two.
 */
const TIERS = (process.env.LIGHT_TIERS ?? '0,11').split(',').map(Number).filter((n) => Number.isFinite(n))

/*
 * The synthetic frame clock, copied in from `tools/map-qa/lib.mjs`.
 *
 * Taken rather than imported because that module hard-codes its own base url
 * and report directory, and because this harness needs the clock to arm on the
 * map and stay out of the way on the office, which has no `__mapScene` to arm
 * it. Both properties fall out of the original design; the copy is here so the
 * two harnesses cannot drift into disagreeing about what a frame is.
 */
const CLOCK_SCRIPT = () => {
  const realRequest = window.requestAnimationFrame.bind(window)
  const realCancel = window.cancelAnimationFrame.bind(window)
  const realNow = performance.now.bind(performance)
  const CAPTURED = 1e9
  let nextId = CAPTURED
  let capturing = false
  let queue = new Map()
  const clock = {
    now: realNow(),
    step: 1000 / 60,
    frames: 0,
    errors: [],
    realNow,
    tick(count = 1) {
      for (let index = 0; index < count; index += 1) {
        clock.now += clock.step
        clock.frames += 1
        const due = queue
        queue = new Map()
        for (const callback of due.values()) {
          try { callback(clock.now) } catch (error) { if (clock.errors.length < 5) clock.errors.push(String(error)) }
        }
      }
    },
    pending: () => queue.size,
    capturing: () => capturing,
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
      clock.now = realNow() - 10000
    },
  })
  window.__clock = clock
}

async function dismissOverlays(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const defer = page.locator('.cutscene-defer, .cutscene-continue, button:has-text("Not now")')
    if (await defer.count() === 0) return
    await defer.first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(250)
  }
}

const report = { tag, base: BASE, at: new Date().toISOString(), map: {}, office: {}, portrait: {}, errors: [] }

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(CLOCK_SCRIPT)
page.on('pageerror', (error) => report.errors.push(String(error.message).slice(0, 200)))
page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text().slice(0, 200)) })

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})

  // ---- office ------------------------------------------------------------
  // Taken first, while the clock has never armed. The capture flag latches on
  // once a map has published itself and does not clear when that map is torn
  // down, so a room visited after a district would sit on a frame queue nobody
  // drains and would never draw at all.
  for (const tier of TIERS) {
    if (!wanted(`office${tier}`)) continue
    await page.goto(`${BASE}/office?officeTier=${tier}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__officeSceneStats && window.__officeDebug), null, { timeout: 180000, polling: 200 })
    // An account with no game profile bounces to `/onboarding`, whose opening
    // scene is a tier-0 office preview that publishes the same globals. It
    // renders and it measures, so the run comes back with confident numbers for
    // the wrong room unless the landing url is checked.
    if (!new URL(page.url()).pathname.startsWith('/office')) {
      throw new Error(`/office redirected to ${page.url()} — run tools/light-qa/bootstrap.mjs first`)
    }
    await dismissOverlays(page)
    await page.waitForTimeout(1800)
    report.office[tier] = await page.evaluate(async () => {
      const stats = window.__officeSceneStats
      const phases = window.__officeBuildPhases ?? []
      const debug = window.__officeDebug
      const { renderer, scene, camera } = debug
      renderer.info.reset()
      renderer.render(scene, camera)
      const forced = {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? null,
      }
      // The room's own profiler, which separates the draw from the animation
      // that feeds it. Sampled over enough real frames to average out a
      // scheduler hiccup.
      window.__officeFrameProfile.start()
      await new Promise((resolve) => setTimeout(resolve, 2500))
      const profile = window.__officeFrameProfile.stop()
      return {
        firstFrame: {
          calls: stats.calls,
          triangles: stats.triangles,
          geometries: stats.geometries,
          textures: stats.textures,
          level: stats.level,
          windowRegion: stats.windowRegion,
          windowTriangles: stats.windowTriangles,
        },
        forced,
        // Total time from the effect starting to the first frame being on
        // screen: the last phase's cumulative mark.
        buildMs: phases.length ? phases[phases.length - 1][1] : null,
        phases,
        frame: profile.frames
          ? {
            frames: profile.frames,
            totalMsPerFrame: Number((profile.total / profile.frames).toFixed(3)),
            renderMsPerFrame: Number((profile.render / profile.frames).toFixed(3)),
          }
          : null,
      }
    })
    await page.screenshot({ path: `${SHOTS}/office-tier${tier}.png` })
    console.log(`office${tier}`, JSON.stringify(report.office[tier].forced), 'build', report.office[tier].buildMs)
  }

  // ---- portraits ---------------------------------------------------------
  if (wanted('portrait')) {
    // Whichever screen this account actually has portraits on. A bust is drawn
    // by a pooled renderer into a small canvas, so an empty page reports a
    // perfectly healthy zero and the portrait arm silently measures nothing.
    let surface = null
    for (const path of ['/firm', '/progress', '/story']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
      await dismissOverlays(page)
      await page.waitForTimeout(3500)
      const found = await page.evaluate(() => document.querySelectorAll('.av-bust canvas, .av-person canvas').length)
      if (found > 0) { surface = path; break }
    }
    report.portrait = await page.evaluate(() => ({
      canvases: document.querySelectorAll('.av-bust canvas, .av-person canvas').length,
      busts: document.querySelectorAll('.av-bust').length,
      people: document.querySelectorAll('.av-person').length,
    }))
    report.portrait.surface = surface
    await page.screenshot({ path: `${SHOTS}/portraits-page.png` })
    const bust = page.locator('.av-bust, .av-person').first()
    if (await bust.count()) await bust.screenshot({ path: `${SHOTS}/portrait-closeup.png` }).catch(() => {})
    console.log('portrait', JSON.stringify(report.portrait))
  }

  // ---- maps --------------------------------------------------------------
  const mapWanted = REGIONS.filter(([key]) => wanted(key))
  if (mapWanted.length) {
    await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__mapScene), null, { timeout: 180000, polling: 100 })
    await dismissOverlays(page)

    for (const [key, label] of mapWanted) {
      const current = await page.evaluate(() => window.__mapScene?.region)
      if (current !== key) {
        await page.evaluate(() => window.__clock?.release())
        const toggle = page.locator('.uw-atlas-toggle')
        if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') {
          await toggle.click()
          await page.waitForTimeout(250)
        }
        await page.locator('.uw-arc-navigation button', { hasText: label }).first().click()
        await page.waitForFunction((want) => window.__mapScene?.region === want, key, { timeout: 180000, polling: 50 })
        if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
      }
      await dismissOverlays(page)
      await page.waitForFunction(() => window.__clock?.capturing() && window.__clock?.pending() > 0, null, { timeout: 60000, polling: 100 })
      await page.evaluate(() => window.__clock.tick(600))

      report.map[key] = await page.evaluate(() => {
        const { renderer, scene, camera, world, firstFrameMs } = window.__mapScene
        renderer.info.reset()
        renderer.render(scene, camera)
        let meshes = 0
        let instanced = 0
        world.traverse((child) => {
          if (child.isInstancedMesh) instanced += 1
          else if (child.isMesh) meshes += 1
        })
        const cost = {
          triangles: renderer.info.render.triangles,
          calls: renderer.info.render.calls,
          programs: renderer.info.programs?.length ?? null,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          meshes,
          instanced,
          firstFrameMs: Number(firstFrameMs.toFixed(1)),
        }
        /*
         * Frame time, driven rather than sampled.
         *
         * Ticking the synthetic clock runs whole frames — animation, culling,
         * the scene render and the illustrated composite — back to back with no
         * vsync in the way, which is what makes a shader change visible at all.
         * `finish` at the end is what makes it honest: without it the numbers
         * measure how fast the main thread can queue work, not how long the GPU
         * takes to do it.
         *
         * `Date.now` rather than `performance.now`, because the clock owns
         * `performance.now` while it is capturing and would report the
         * synthetic time back.
         */
        const gl = renderer.getContext()
        window.__clock.tick(20)
        gl.finish()
        const started = Date.now()
        const frames = 150
        window.__clock.tick(frames)
        gl.finish()
        cost.frameMs = Number(((Date.now() - started) / frames).toFixed(3))
        return cost
      })
      await page.screenshot({ path: `${SHOTS}/map-${key}.png` })
      console.log(key.padEnd(10), JSON.stringify(report.map[key]))
    }
  }
} finally {
  writeFileSync(`${REPORTS}/bench-${tag}.json`, JSON.stringify(report, null, 2))
  await browser.close().catch(() => {})
}
console.log(`\nwrote ${REPORTS}/bench-${tag}.json and ${SHOTS}`)
