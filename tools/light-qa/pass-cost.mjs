/**
 * What the contact shading costs, in GPU milliseconds, measured against itself.
 *
 * ## Why not a wall clock
 *
 * The first version of this timed batches of frames with `Date.now` and a
 * `gl.finish`, and on a machine running four other agents' browsers it
 * reported the same district at 9.4 ms and at 63.9 ms within one run. A shader
 * term worth a millisecond cannot be found under that. Worse, it reported the
 * occlusion arm as *faster* than the plain arm twice out of two, which is the
 * signature of a measurement that is describing the machine rather than the
 * code.
 *
 * `EXT_disjoint_timer_query_webgl2` is available here on the real Metal
 * renderer, and it counts nanoseconds the GPU actually spent inside the
 * commands between `beginQuery` and `endQuery`. Other processes competing for
 * the GPU no longer land in the number, and the extension reports a disjoint
 * flag when something happened that would have corrupted it, so a spoiled
 * sample can be discarded rather than averaged in.
 *
 * ## Why the arms are interleaved
 *
 * Same reason as before: the scene is built once and both arms are taken from
 * it, flipping one uniform in between, so the crowd population, the camera and
 * the machine's mood are shared. The district's crowd is not reproducible
 * across dev-server lifetimes, so this is the only kind of comparison that
 * means anything here.
 *
 * Three things are timed per surface: the scene alone, straight to the canvas
 * with no composite; the composite without contact shading; and the composite
 * with it. That gives the answer as a share of a frame rather than as a bare
 * number, which is the form the decision is actually made in.
 *
 * Usage: node tools/light-qa/pass-cost.mjs [surface...]
 *   surfaces: city nation ocean continent orbit office0 office11
 */
import { writeFileSync } from 'node:fs'
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import { homedir } from 'node:os'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5411'
const CHROME = process.env.LIGHT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const REGIONS = { city: 'Old Quarter', nation: 'The Circuit', ocean: 'Treaty Sea', continent: 'Sovereign Arc', orbit: 'Global Compact' }
const asked = process.argv.slice(2)
const regionKeys = (asked.length ? asked : Object.keys(REGIONS)).filter((key) => REGIONS[key])
const officeTiers = (asked.length ? asked : ['office0', 'office11'])
  .filter((key) => /^office\d+$/.test(key))
  .map((key) => Number(key.slice(6)))

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

/**
 * Timed rendering, injected into the page.
 *
 * Defined as a string and evaluated because it has to close over nothing and
 * be reachable from several separate `page.evaluate` calls.
 */
const TIMER_SCRIPT = () => {
  window.__gpuTimer = (renderer) => {
    const gl = renderer.getContext()
    const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    if (!extension) throw new Error('EXT_disjoint_timer_query_webgl2 unavailable')
    return async (draw, samples) => {
      const times = []
      let spoiled = 0
      for (let index = 0; index < samples; index += 1) {
        const query = gl.createQuery()
        gl.beginQuery(extension.TIME_ELAPSED_EXT, query)
        draw()
        gl.endQuery(extension.TIME_ELAPSED_EXT)
        let value = null
        for (let attempt = 0; attempt < 400; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue
          // The driver raises this when it has done something — a context
          // switch, a power-state change — that makes the count meaningless.
          if (gl.getParameter(extension.GPU_DISJOINT_EXT)) spoiled += 1
          else value = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6
          break
        }
        gl.deleteQuery(query)
        if (value !== null) times.push(value)
      }
      times.sort((left, right) => left - right)
      return {
        samples: times.length,
        spoiled,
        median: times.length ? Number(times[Math.floor(times.length / 2)].toFixed(3)) : null,
        min: times.length ? Number(times[0].toFixed(3)) : null,
      }
    }
  }
}

const SAMPLES = Number(process.env.LIGHT_SAMPLES ?? 40)

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(CLOCK_SCRIPT)
await page.addInitScript(TIMER_SCRIPT)
const report = { at: new Date().toISOString(), samples: SAMPLES }

/** One surface's three arms, given handles onto its scene. */
const ARMS = async ({ renderer, scene, camera, stylePass }, samples) => {
  const time = window.__gpuTimer(renderer)
  const authored = stylePass.occlusionStrength
  // Warm: first draws of a program pay for pipeline state the later ones reuse.
  stylePass.render(scene, camera)
  renderer.setRenderTarget(null)
  renderer.render(scene, camera)

  const plain = await time(() => { renderer.setRenderTarget(null); renderer.render(scene, camera) }, Math.round(samples / 2))
  stylePass.configure({ occlusion: 0 })
  const withoutFirst = await time(() => stylePass.render(scene, camera), Math.round(samples / 2))
  stylePass.configure({ occlusion: authored })
  const withOcclusion = await time(() => stylePass.render(scene, camera), samples)
  stylePass.configure({ occlusion: 0 })
  const withoutSecond = await time(() => stylePass.render(scene, camera), Math.round(samples / 2))
  stylePass.configure({ occlusion: authored })

  const without = { ...withoutFirst, median: Math.min(withoutFirst.median, withoutSecond.median), min: Math.min(withoutFirst.min, withoutSecond.min) }
  return {
    authored,
    sceneOnlyMs: plain.median,
    compositeOffMs: without.median,
    compositeOnMs: withOcclusion.median,
    occlusionMs: Number((withOcclusion.median - without.median).toFixed(3)),
    // The composite's own share, so the occlusion term can be read against the
    // thing it was added to rather than against the whole frame.
    passOffMs: Number((without.median - plain.median).toFixed(3)),
    detail: { plain, withoutFirst, withoutSecond, withOcclusion },
  }
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})

  for (const tier of officeTiers) {
    await page.goto(`${BASE}/office?officeTier=${tier}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__officeDebug), { timeout: 180000, polling: 200 })
    if (!new URL(page.url()).pathname.startsWith('/office')) throw new Error(`/office redirected to ${page.url()}`)
    await page.waitForTimeout(2500)
    report[`office${tier}`] = await page.evaluate(async ({ samples, source }) => {
      // Park the room's own animation loop by arming the synthetic clock, so
      // the only GPU work inside a query is the draw this tool asked for.
      window.__mapScene = { region: 'parked-for-measurement' }
      await new Promise((resolve) => setTimeout(resolve, 120))
      // eslint-disable-next-line no-new-func
      return new Function(`return (${source})`)()(window.__officeDebug, samples)
    }, { samples: SAMPLES, source: ARMS.toString() })
    const row = report[`office${tier}`]
    console.log(`office${String(tier).padEnd(4)} scene ${String(row.sceneOnlyMs).padStart(7)}  composite ${String(row.compositeOffMs).padStart(7)}  +occlusion ${String(row.compositeOnMs).padStart(7)}  cost ${String(row.occlusionMs).padStart(6)} ms`)
  }

  if (regionKeys.length) {
    await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__mapScene), { timeout: 180000, polling: 100 })
    for (const key of regionKeys) {
      const current = await page.evaluate(() => window.__mapScene?.region)
      if (current !== key) {
        await page.evaluate(() => window.__clock?.release())
        const toggle = page.locator('.uw-atlas-toggle')
        // Opened and left open. Closing it between districts was enough, on a
        // loaded machine, for the next district's button to still be mid
        // transition when the click went in, and a click on an invisible
        // button fails the whole run twenty minutes deep.
        if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') {
          await toggle.click()
          await page.waitForTimeout(400)
        }
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
      report[key] = await page.evaluate(async ({ samples, source }) => {
        // eslint-disable-next-line no-new-func
        return new Function(`return (${source})`)()(window.__mapScene, samples)
      }, { samples: SAMPLES, source: ARMS.toString() })
      const row = report[key]
      console.log(`${key.padEnd(10)} scene ${String(row.sceneOnlyMs).padStart(7)}  composite ${String(row.compositeOffMs).padStart(7)}  +occlusion ${String(row.compositeOnMs).padStart(7)}  cost ${String(row.occlusionMs).padStart(6)} ms`)
    }
  }
} finally {
  writeFileSync('/private/tmp/lsat-light/.light-run/pass-cost.json', JSON.stringify(report, null, 2))
  await browser.close().catch(() => {})
}
