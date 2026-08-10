#!/usr/bin/env node
/**
 * A screenshot and console-error sweep of every slide in the deck.
 *
 * This is the deck's equivalent of `tools/map-qa/shot.mjs`, and it borrows that
 * file's browser setup wholesale — the named Chromium executable, the ANGLE
 * flags, the `deviceScaleFactor` handling — because those three things are the
 * ones that are non-obvious and have already cost this repo a day each. What it
 * does *not* borrow is the synthetic frame clock; see "Why there is no
 * synthetic clock" below.
 *
 *     cd deck && npm run dev            # 5180, in another terminal
 *     cd deck && node scripts/shoot.mjs
 *
 * It never starts the dev server itself. A harness that starts its own server
 * is a harness that cannot be pointed at the one you are actually debugging,
 * and the deck's Vite config uses `strictPort`, so a second one would not come
 * up anyway.
 *
 * ## What it is for
 *
 * Two things, and the second is the one that pays for the file:
 *
 *   1. A visual record of the whole deck at projector resolution, in deck
 *      order, that can be diffed against the last one.
 *   2. A per-slide answer to "did this slide throw, fail to fetch something, or
 *      render nothing at all". A deck is twenty-odd WebGL scenes and five live
 *      iframes; the failure mode that matters is a slide that looks fine in the
 *      terminal and is black on the projector.
 *
 * ## Why a fresh page per capture
 *
 * The deck is a hash-routed single-page app, so the obvious loop is to load it
 * once and walk the hash. That does not work here and would fail quietly:
 * `useDeck` reads the hash in a `useState` initialiser and thereafter only
 * listens for `popstate`, so assigning `location.hash` on a live document fires
 * `hashchange`, moves the address bar and moves nothing else. Playwright's
 * `goto` to a URL that differs only in its fragment is likewise a same-document
 * navigation. Every capture therefore gets its own page.
 *
 * That is not just a workaround. One page per slide is what makes the console
 * errors attributable: an error collected on a shared page belongs to whichever
 * slide happened to be on screen when it fired, which for an async scene build
 * is usually the next one. It also means a hung slide can be abandoned by
 * closing its page, and that each WebGL context is released rather than
 * accumulating against the browser's limit.
 *
 * ## Why there is no synthetic clock
 *
 * `tools/map-qa/lib.mjs` replaces `requestAnimationFrame` so a measurement is a
 * function of the frame count rather than of machine load, and that is right
 * for the map, whose whole state is advanced by the animate loop. It is wrong
 * here. The deck's entrance animations and slide transitions run on CSS and the
 * Web Animations API, which are driven by the compositor's own timeline and not
 * by rAF; freezing rAF would stall the WebGL stage while the DOM carried on,
 * and every capture would be a frame with a finished headline over a scene
 * frozen at its first frame — which is worse than a slow capture, because it
 * looks deliberate.
 *
 * So the settle is wall time, and it is generous on purpose (1800ms). The
 * `foil-seal` and `type` transitions alone run for over a second, the stage
 * tweens its camera on top of that, and a capture taken early is not obviously
 * early — it is just a slightly different composition, which is exactly the
 * kind of difference a screenshot diff will report forever. Before spending it
 * the harness waits for two real animation frames, so the settle starts once
 * the page is genuinely painting rather than while it is still parsing modules.
 *
 * ## deviceScaleFactor
 *
 * 2 by default, as in the map harness. The deck is read on a projector and the
 * things worth looking at in a screenshot — hairline rules, the engraved
 * plates, 11px monospace in the demo title bar — are exactly the things that
 * alias away at 1. A 1920x1080 capture at scale 2 is a 3840x2160 file; that is
 * the intended cost.
 *
 * ## Blank detection
 *
 * Every capture is decoded (see `pngStats`) and reduced to a spread of
 * luminance and a count of distinct quantised colours. A slide that produced a
 * single flat colour is the signature of a dead WebGL context, a scene that
 * never built, or a stylesheet that failed to load, and it is the one failure
 * that a passing exit code must not hide. The check is on the composited PNG
 * rather than on the canvas in the page, because the PNG is what a human would
 * have looked at. The known limitation of that choice: a slide whose DOM copy
 * renders over a dead black stage is *not* flagged, because the frame as a
 * whole is not flat.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// browser location
// ---------------------------------------------------------------------------

/**
 * Playwright is not a dependency of the deck and is deliberately not being made
 * one: the deck ships three runtime packages and adding a browser automation
 * stack to its lockfile to take screenshots would be a poor trade. It is taken
 * from the same out-of-tree install the map harnesses use.
 */
const PLAYWRIGHT = process.env.DECK_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'

/**
 * Named outright rather than through `channel: 'chromium'`, for the reason
 * given in `tools/map-qa/lib.mjs`: on this machine the channel lookup resolves
 * to the x64 build and then reports the browser as *not installed*, which reads
 * like a missing download rather than an architecture mismatch and costs a run
 * to work out.
 *
 * The build number is discovered rather than hardcoded — `lib.mjs` pins
 * `chromium-1234` and will need editing the first time Playwright is updated.
 */
function findChrome() {
  if (process.env.DECK_CHROME) return process.env.DECK_CHROME
  const cache = `${homedir()}/Library/Caches/ms-playwright`
  let builds = []
  try {
    builds = readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  } catch {
    /* fall through to the pinned path, which will produce a clearer error */
  }
  for (const build of builds) {
    const path = `${cache}/${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    if (existsSync(path)) return path
  }
  return `${cache}/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
}

/**
 * Software rendering, explicitly. A headless Chromium on a machine with no
 * attached display will otherwise decide it has no usable GPU and hand back a
 * context that fails on the first shader compile — which surfaces as a scene
 * that is simply absent, with nothing in the console. `--use-gl=angle` plus
 * SwiftShader is the combination the map harness settled on and it is the one
 * that produces pixels here too.
 */
const GL_ARGS = ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

const HELP = `
shoot — screenshot every slide of the deck and report what broke.

  node scripts/shoot.mjs [options]

  --base=<url>      Deck dev server. Default http://localhost:5180
                    Must be spelled "localhost" for the live demo embeds to be
                    signed in; see --no-auth below.
  --no-auth         Do not sign the browser in before shooting. The six live
                    demo slides will render the app's sign-in page.
  --out=<dir>       Output directory. Default .deck-shots
  --slides=<list>   Comma-separated slide ids and/or indices, or "all".
                    Default all.
  --width=<px>      Viewport width. Default 1920
  --height=<px>     Viewport height. Default 1080
  --scale=<n>       deviceScaleFactor. Default 2
  --settle=<ms>     Wall time to let entrance animations finish. Default 1800
  --timeout=<ms>    Give up on one slide and move on. Default 45000
  --stills          Append ?stills=1, forcing every demo embed to its still.
  --presenter       Also capture each slide with the presenter overlay open.
  --grid            Also capture the grid overview (one shot, not per slide).
  --full[=WxH]      Second pass at another viewport. Bare flag means 1280x800.
  --help            This text.

Writes NN-<slide-id>.png plus report.json into the out dir. Exits non-zero if
any slide threw a page error or produced a flat, blank capture.
`.trim()

const argv = process.argv.slice(2)
const flags = new Map()
for (const raw of argv) {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) {
    console.error(`shoot: unrecognised argument "${raw}"\n\n${HELP}`)
    process.exit(2)
  }
  flags.set(match[1], match[2] ?? '')
}
if (flags.has('help')) {
  console.log(HELP)
  process.exit(0)
}
const KNOWN = new Set(['base', 'out', 'slides', 'width', 'height', 'scale', 'settle', 'timeout', 'stills', 'presenter', 'grid', 'full', 'help', 'no-auth', 'app', 'email'])
const unknown = [...flags.keys()].filter((name) => !KNOWN.has(name))
if (unknown.length) {
  console.error(`shoot: unknown flag${unknown.length > 1 ? 's' : ''} --${unknown.join(' --')}\n\n${HELP}`)
  process.exit(2)
}

const number = (name, fallback) => {
  if (!flags.has(name)) return fallback
  const value = Number(flags.get(name))
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`shoot: --${name} needs a positive number, got "${flags.get(name)}"`)
    process.exit(2)
  }
  return value
}

// `localhost`, not `127.0.0.1`. The two are the same server and different
// *sites* to a browser, and the app's session cookies are `SameSite=Lax`, so on
// the dotted spelling they are not sent into the demo iframes and all six live
// demo slides render the app's sign-in page. This default used to be
// `127.0.0.1`, which produced exactly that: a full screenshot pass in which
// every demo slide looked plausible and showed a login screen.
const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
/** The app the demo slides frame. Must be `localhost` for the same cookie reason. */
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const NO_AUTH = flags.has('no-auth')
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots')
const WANTED = (flags.get('slides') || 'all').trim()
const WIDTH = number('width', 1920)
const HEIGHT = number('height', 1080)
const SCALE = number('scale', 2)
const SETTLE = flags.has('settle') ? Number(flags.get('settle')) : 1800
const TIMEOUT = number('timeout', 45000)
const STILLS = flags.has('stills')
const PRESENTER = flags.has('presenter')
const GRID = flags.has('grid')

/** `--full` alone means 1280x800; `--full=2560x1440` means what it says. */
let FULL = null
if (flags.has('full')) {
  const raw = flags.get('full') || '1280x800'
  const match = /^(\d+)x(\d+)$/.exec(raw)
  if (!match) {
    console.error(`shoot: --full wants WxH, got "${raw}"`)
    process.exit(2)
  }
  FULL = { width: Number(match[1]), height: Number(match[2]) }
}

if (!Number.isFinite(SETTLE) || SETTLE < 0) {
  console.error(`shoot: --settle needs a non-negative number of milliseconds`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// PNG statistics, for blank detection
// ---------------------------------------------------------------------------

const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * Decodes enough of a PNG to say whether it is a picture or a flat colour.
 *
 * Written out rather than pulled in because the deck has no image dependency
 * and this needs about sixty lines: Playwright writes 8-bit non-interlaced
 * PNGs, which is the one case that has to work. Anything else (16-bit, a
 * palette, Adam7) returns null and is reported as unknown rather than guessed
 * at, because a wrong "blank" verdict would fail a run that was fine.
 *
 * Scanlines have to be unfiltered in order — Up, Average and Paeth all read the
 * row above — so the whole image is reconstructed even though only a sample of
 * it is measured.
 */
function pngStats(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return null

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []

  for (let offset = 8; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      colorType = body[9]
      interlace = body[12]
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  const channels = PNG_CHANNELS[colorType]
  if (bitDepth !== 8 || interlace !== 0 || !channels || !width || !height) return null

  let raw
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }

  const stride = width * channels
  if (raw.length < (stride + 1) * height) return null

  // One row of history is all the filters need, so two buffers are enough and
  // the full image is never materialised — at 3840x2160 RGBA that would be
  // 33MB of copy for a statistic.
  let previous = Buffer.alloc(stride)
  let current = Buffer.alloc(stride)

  // A sample rather than every pixel: a flat frame is flat everywhere, and a
  // quarter of a million points is plenty to prove it is not.
  const columnStep = Math.max(1, Math.floor(width / 512))
  const rowStep = Math.max(1, Math.floor(height / 512))

  const seen = new Set()
  let count = 0
  let sum = 0
  let sumSquares = 0
  let min = 255
  let max = 0

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    raw.copy(current, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels] : 0
      const up = previous[index]
      const upLeft = index >= channels ? previous[index - channels] : 0
      switch (filter) {
        case 1: current[index] = (current[index] + left) & 0xff; break
        case 2: current[index] = (current[index] + up) & 0xff; break
        case 3: current[index] = (current[index] + ((left + up) >> 1)) & 0xff; break
        case 4: {
          const estimate = left + up - upLeft
          const dLeft = Math.abs(estimate - left)
          const dUp = Math.abs(estimate - up)
          const dUpLeft = Math.abs(estimate - upLeft)
          const best = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft
          current[index] = (current[index] + best) & 0xff
          break
        }
        default:
      }
    }

    if (y % rowStep === 0) {
      for (let x = 0; x < width; x += columnStep) {
        const base = x * channels
        const r = current[base]
        const g = channels >= 3 ? current[base + 1] : r
        const b = channels >= 3 ? current[base + 2] : r
        // Rec. 601 luma, integer — the absolute value does not matter, only
        // whether it moves.
        const luma = (r * 299 + g * 587 + b * 114) / 1000
        sum += luma
        sumSquares += luma * luma
        if (luma < min) min = luma
        if (luma > max) max = luma
        count += 1
        // Quantised to 5 bits a channel so that sensor-style dither and the
        // deck's own film grain do not read as detail.
        if (seen.size < 4096) seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3))
      }
    }

    const swap = previous
    previous = current
    current = swap
  }

  if (!count) return null
  const mean = sum / count
  const variance = Math.max(0, sumSquares / count - mean * mean)
  return {
    width,
    height,
    colours: seen.size,
    mean: Number(mean.toFixed(2)),
    stdDev: Number(Math.sqrt(variance).toFixed(3)),
    min: Math.round(min),
    max: Math.round(max),
  }
}

/**
 * The verdict.
 *
 * Both conditions have to hold. Spread alone would flag a legitimately dark
 * slide — the deck is a near-black theme and `pov-timed` over the drift framing
 * genuinely has a low standard deviation — and colour count alone would flag a
 * clean two-tone title card. Together they only fire on a frame with nothing in
 * it.
 */
function isBlank(stats) {
  if (!stats) return null
  return stats.stdDev < 0.75 && stats.colours <= 8
}

// ---------------------------------------------------------------------------
// slide discovery
// ---------------------------------------------------------------------------

/**
 * Three ways to learn the slide order, best first.
 *
 * The deck does not currently publish anything on `window`, so in practice this
 * lands on (2). It is left as a cascade because (1) is the right answer the
 * moment the deck grows a debug handle, and because (3) is a regex over source
 * and should be the last resort it looks like.
 */
async function discoverSlides(page) {
  // 1. A debug handle, if the deck ever exposes one.
  const fromGlobal = await page.evaluate(() => {
    const handle = window.__deck
    if (!handle) return null
    const list = Array.isArray(handle) ? handle : handle.slides ?? handle.SLIDES
    if (!Array.isArray(list) || !list.length) return null
    return list
      .map((slide) => (typeof slide === 'string' ? { id: slide } : { id: slide?.id, kind: slide?.kind, demo: Boolean(slide?.demo) }))
      .filter((slide) => typeof slide.id === 'string')
  }).catch(() => null)
  if (fromGlobal?.length) return { slides: fromGlobal, source: 'window.__deck' }

  // 2. The registry module, pulled through the dev server's own transform. This
  //    is the real list, in the real order, with the real metadata — the same
  //    object the running deck is using — and it costs one extra fetch.
  const fromModule = await page.evaluate(async () => {
    try {
      const module = await import('/src/slides/index.ts')
      const list = module.SLIDES
      if (!Array.isArray(list) || !list.length) return null
      return list.map((slide) => ({
        id: slide.id,
        kind: slide.kind,
        section: slide.section,
        demo: Boolean(slide.demo),
        scene: slide.scene?.id ?? null,
      }))
    } catch {
      return null
    }
  }).catch(() => null)
  if (fromModule?.length) return { slides: fromModule, source: 'import("/src/slides/index.ts")' }

  // 3. The source on disk. Anchored at four spaces of indentation because that
  //    is where a slide's own `id` sits in the registry's array literal, and
  //    nothing else does: a scene's id is written inline (`scene: { id: ... }`)
  //    and so never starts a line. Fragile if the file is ever reformatted,
  //    which is why it is third.
  const source = readFileSync(resolve(DECK_DIR, 'src/slides/index.ts'), 'utf8')
  const ids = [...source.matchAll(/^ {4}id:\s*'([^']+)'/gm)].map((match) => ({ id: match[1] }))
  if (!ids.length) throw new Error('could not find any slide ids: window.__deck is absent, the registry module would not import, and the regex over src/slides/index.ts matched nothing')
  return { slides: ids, source: 'regex over src/slides/index.ts (fallback)' }
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

const pad = (index) => String(index).padStart(2, '0')

/** Wraps a capture so that one wedged slide costs one timeout, not the run. */
function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms)
    }),
  ])
}

/**
 * One slide, one page, one PNG.
 *
 * `waitUntil: 'domcontentloaded'` rather than `load` or `networkidle`: the deck
 * mounts from a module graph that Vite is still streaming, `load` fires long
 * before anything is on screen and means nothing, and `networkidle` never
 * arrives on a slide holding a live iframe of another dev server that is
 * itself doing HMR. The real readiness signal is the live slide layer, waited
 * for below.
 */
async function captureSlide(context, { id, index }, options) {
  const started = Date.now()
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  /** Hoisted: the console handler reads it, and is installed before it is filled. */
  const expected = { aborted: 0, unauthorized: 0 }

  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error).slice(0, 300)))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text().slice(0, 300)
    // The browser's own line for the two expected preflight 401s below. It names
    // no URL, so it can only be recognised by shape, and only while one of those
    // probes has actually just 401'd.
    if (expected.unauthorized && /Failed to load resource.*401/.test(text)) return
    consoleErrors.push(text)
  })
  /**
   * Counted, then reported as a note rather than as a failure.
   *
   * Two things a healthy cold-profile run does look like network errors and are
   * not. A report that calls them failures is a report people learn to skim, which
   * is how a real signal gets missed — the failure mode this whole pass exists to
   * prevent.
   *
   * - `net::ERR_ABORTED` on the app's origin: the start card warms two scene
   *   routes in frames it then discards, and on a cold profile the preflight
   *   reloads an embed that loaded before the session cookie existed. Both cancel
   *   a navigation in flight. A genuinely broken embed is caught by `mounted`,
   *   `blank` and `signedOutEmbed`, which read the DOM rather than the wire.
   * - `401` on `/me` and `/study-sessions/current`: these two are what *trigger*
   *   the deck's automatic sign-in. Their absence would be the surprise.
   */
  const PREFLIGHT_PROBES = /\/demo-api\/v1\/(me|study-sessions\/current)$/

  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown'
    if (reason === 'net::ERR_ABORTED' && request.url().startsWith(APP)) { expected.aborted += 1; return }
    failedRequests.push({ url: request.url().slice(0, 200), reason })
  })
  page.on('response', (response) => {
    if (response.status() === 401 && PREFLIGHT_PROBES.test(new URL(response.url()).pathname)) {
      expected.unauthorized += 1
      return
    }
    if (response.status() >= 400) failedRequests.push({ url: response.url().slice(0, 200), reason: `HTTP ${response.status()}` })
  })

  const query = []
  if (STILLS) query.push('stills=1')
  if (options.presenter) query.push('present=1')
  const url = `${options.base}/${query.length ? `?${query.join('&')}` : ''}#/${id}`

  const result = { id, index, file: null, url, mounted: false, consoleErrors, pageErrors, failedRequests, memory: null, blank: null, stats: null, ms: 0, notes: [] }

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(TIMEOUT, 30000) })

    // The deck's own evidence that it mounted, and a failure in its own right.
    //
    // A build error is not a page error and not a blank frame: Vite serves a
    // 500 for the entry module and then paints its own error overlay, which is
    // a busy, colourful, entirely legible screenshot. Without this check the
    // run would report a deck that does not compile as twenty-three healthy
    // slides. The shot is still taken — the overlay names the broken import,
    // which is the most useful thing in the output when this fires.
    result.mounted = await page.waitForSelector('.deck-layer.is-live', { timeout: 15000 })
      .then(() => true)
      .catch(() => {
        result.notes.push('no .deck-layer.is-live appeared within 15s — the deck did not mount')
        return false
      })

    // Confirms the hash actually selected the slide it was supposed to. The HUD
    // carries the current slide's id and is on by default in dev; when the
    // presenter overlay is open it is suppressed, so this is best-effort.
    const hudId = await page.evaluate(() => document.querySelector('.deck-hud')?.children?.[1]?.textContent?.trim() ?? null).catch(() => null)
    if (hudId && hudId !== id) result.notes.push(`deck reports slide "${hudId}" but "${id}" was requested — the hash deep link may not be working`)

    // Two real frames before the clock starts, so the settle is spent on
    // animation rather than on module evaluation.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))
      .catch(() => result.notes.push('the page never served an animation frame'))
    if (options.settle) await page.waitForTimeout(options.settle)

    // `renderer.info.memory`, if the deck ever puts its stage somewhere
    // reachable. It does not today, so this is null on every slide and is
    // reported as null rather than as zero.
    result.memory = await page.evaluate(() => {
      const stage = window.__deck?.stage ?? window.__deckStage ?? null
      const memory = stage?.memory ?? stage?.renderer?.info?.memory ?? null
      if (!memory) return null
      return { geometries: memory.geometries ?? null, textures: memory.textures ?? null, cached: memory.cached ?? null }
    }).catch(() => null)

    // A demo slide showing the app's sign-in page is the most dangerous failure
    // this script can photograph, because it looks fine: a real screenshot of a
    // real app, correctly framed, with the right URL in the chrome above it. It
    // has already been reported once as six broken slides in the deck. So it is
    // named here explicitly rather than left for a human to notice.
    const embed = page.frames().find((frame) => /^https?:\/\/localhost:5173/.test(frame.url()) && !frame.url().includes('deck-warm'))
    if (embed) {
      const inner = await embed.evaluate(() => ({
        path: window.location.pathname,
        signIn: /Enter your firm|Continue with Google|Enter local development firm/i.test(document.body.innerText || ''),
      })).catch(() => null)
      if (inner && (inner.signIn || inner.path === '/login')) {
        result.notes.push('THE EMBED IS SHOWING THE APP\u2019S SIGN-IN PAGE, not the deep-linked route. '
          + `This shot is not evidence of anything. Embed is on ${inner.path}. `
          + 'Shoot from http://localhost:5180 (never 127.0.0.1) with the app and backend up; '
          + 'this script signs in for you unless --no-auth or --stills was passed.')
        result.signedOutEmbed = true
      }
    }

    // Recorded, not hidden: a reader who wants to know whether the deck signed
    // itself in on this run can see that it did, without it being called a failure.
    // Kept out of `notes`, which drives the `warn` mark: these are not warnings,
    // and a clean run flagged `warn` teaches the same lesson as a broken run
    // flagged `ok`.
    result.expected = expected

    const file = `${pad(index)}-${id}${options.suffix}.png`
    const path = `${options.out}/${file}`
    // Playwright's 30s default is not enough for the ported map: it waits for
    // fonts and then for a frame, and that scene under SwiftShader can take
    // longer than that to produce one. Given its own budget rather than the
    // per-slide one so a slow capture is not mistaken for a hung slide.
    const buffer = await page.screenshot({ path, animations: 'allow', timeout: Math.max(30000, TIMEOUT) })
    result.file = file
    result.stats = pngStats(buffer)
    result.blank = isBlank(result.stats)
    if (result.blank) result.notes.push('capture is a flat colour')
  } catch (error) {
    result.notes.push(String(error?.message ?? error).slice(0, 300))
  } finally {
    result.ms = Date.now() - started
    await page.close().catch(() => {})
  }
  return result
}

/** The grid overview, which has no URL of its own — only the `G` key opens it. */
async function captureGrid(context, options) {
  const page = await context.newPage()
  // `?start=0` because this is the one capture that opens the deck without a
  // `#/<slide>` fragment, and a bare URL is what raises the start card.
  const url = `${options.base}/?start=0`
  const result = { id: '__grid', index: -1, file: null, url, mounted: null, consoleErrors: [], pageErrors: [], failedRequests: [], memory: null, blank: null, stats: null, ms: 0, notes: ['grid overview, opened with the G key'] }
  const started = Date.now()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    result.mounted = await page.waitForSelector('.deck-layer.is-live', { timeout: 15000 }).then(() => true).catch(() => false)
    await page.keyboard.press('g')
    await page.waitForSelector('.grid-overview', { timeout: 5000 })
      .catch(() => result.notes.push('no grid element appeared after pressing G'))
    await page.waitForTimeout(Math.max(600, options.settle / 2))
    const file = `grid${options.suffix}.png`
    const buffer = await page.screenshot({ path: `${options.out}/${file}` })
    result.file = file
    result.stats = pngStats(buffer)
    result.blank = isBlank(result.stats)
  } catch (error) {
    result.notes.push(String(error?.message ?? error).slice(0, 300))
  } finally {
    result.ms = Date.now() - started
    await page.close().catch(() => {})
  }
  return result
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

let chromium
try {
  ;({ chromium } = await import(PLAYWRIGHT))
} catch (error) {
  console.error(`shoot: no Playwright at ${PLAYWRIGHT}\n`
    + `Set DECK_PLAYWRIGHT to an install that has it, e.g.\n`
    + `  DECK_PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node scripts/shoot.mjs\n\n${error}`)
  process.exit(2)
}

// Reachability first, and with a real message. A run that goes straight to
// Playwright reports a dead dev server as ERR_CONNECTION_REFUSED sixty seconds
// later, buried in a browser stack trace.
const reachable = await fetch(`${BASE}/`, { method: 'GET', signal: AbortSignal.timeout(4000) })
  .then((response) => response.ok)
  .catch(() => false)
if (!reachable) {
  console.error(`shoot: nothing answering at ${BASE}\n\n`
    + `This harness does not start the dev server. In another terminal:\n`
    + `  cd deck && npm run dev\n\n`
    + `Then re-run, or point it elsewhere with --base=<url>.`)
  process.exit(2)
}

mkdirSync(OUT, { recursive: true })

const executablePath = findChrome()
let browser
try {
  browser = await chromium.launch({ executablePath, args: GL_ARGS })
} catch (error) {
  // Almost always one of two things, and the raw Playwright error — several
  // hundred characters of command line followed by `kill EPERM` — names
  // neither of them.
  console.error(`shoot: could not launch Chromium at\n  ${executablePath}\n\n`
    + `If that path does not exist, set DECK_CHROME to one that does.\n`
    + `If it does exist, the browser was most likely killed on launch by a\n`
    + `sandbox: run this outside one, or grant it process-spawning rights.\n\n${error}`)
  process.exit(2)
}
const results = []
let discovery = null

try {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: SCALE,
    // The deck checks this and drops its transitions when it is set. Left off
    // deliberately: the point of the sweep is to see what the audience sees.
    reducedMotion: 'no-preference',
  })

  // -------------------------------------------------------------------------
  // Make the live demo embeds work, or say loudly that they will not.
  // -------------------------------------------------------------------------
  //
  // Three separate things are required for a demo slide to photograph as the
  // running app rather than as a sign-in page, and a harness that gets any one of
  // them wrong still produces a full set of plausible-looking screenshots. That
  // has now happened: a 24-slide pass reported six demo slides "loading the
  // sign-in landing page", which was the harness, not the deck.
  //
  //   1. The deck must be served from `localhost`. Same server as `127.0.0.1`,
  //      different *site* to a browser, and the app's cookies are `SameSite=Lax`.
  //   2. This browser profile must hold a session cookie. Playwright starts with
  //      an empty jar, so a screenshot harness is signed out unless it signs in.
  //      Measured: signed out, every embed lands on /login with 6 API 401s —
  //      whichever spelling of localhost is used.
  //   3. The app's guided tour must be marked complete, or a 21-step overlay
  //      opens inside the iframe and covers the thing being photographed.
  // Enforced only when live embeds are in play. A `--stills` pass mounts no
  // iframes, so no cookie has to cross an origin and the spelling cannot matter.
  const deckHost = new URL(BASE).hostname
  if (deckHost !== 'localhost' && !STILLS && !NO_AUTH) {
    console.error(`\nshoot: --base is ${BASE}, whose host is "${deckHost}".\n\n`
      + 'The live demo embeds will all render the app\'s sign-in page: the app\'s\n'
      + 'session cookies are SameSite=Lax, and a browser treats "localhost" and\n'
      + `"${deckHost}" as different sites, so the cookies are not sent into the\n`
      + 'iframes. Re-run with --base=http://localhost:' + (new URL(BASE).port || '80') + '\n')
    await browser.close()
    process.exit(2)
  }

  // Belt and braces since the deck signs itself in during preflight: doing it here
  // too only saves the couple of 401s and the one embed reload that recovery costs.
  // `--no-auth` leaves it to the deck, which is the presenter's path exactly.
  if (!NO_AUTH && !STILLS) {
    const app = APP
    const email = flags.get('email') || 'student@localhost.test'
    const signIn = await context.request.post(`${app}/v1/auth/dev`, { data: { email } })
      .then((response) => (response.ok() ? null : `${response.status()}`))
      .catch((error) => String(error.message ?? error))
    if (signIn) {
      console.error(`\nshoot: could not sign in at ${app}/v1/auth/dev (${signIn}).\n\n`
        + 'Every live demo slide would photograph as a sign-in page. Start the app\n'
        + '(cd frontend && npm run dev) and the backend with DEV_AUTH_ENABLED=true,\n'
        + 'or pass --stills to shoot the fallback images instead, or --no-auth to\n'
        + 'shoot signed out on purpose.\n')
      await browser.close()
      process.exit(2)
    }
    console.log(`       signed in as ${email} — demo embeds will be authenticated`)

    // Same key the runbook has the presenter paste by hand. Set for the app's
    // origin, which is where the tour reads it from.
    await context.addInitScript(() => {
      try { window.localStorage.setItem('lsat-tycoon:guided-tour:v6', 'complete') } catch { /* not our origin */ }
    })
  }

  const probe = await context.newPage()
  await probe.goto(`${BASE}/?start=0`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await probe.waitForSelector('.deck-layer.is-live', { timeout: 15000 }).catch(() => {})
  discovery = await discoverSlides(probe)
  await probe.close()

  const all = discovery.slides
  let chosen = all.map((slide, index) => ({ ...slide, index }))
  if (WANTED && WANTED !== 'all') {
    const asked = WANTED.split(',').map((value) => value.trim()).filter(Boolean)
    const picked = []
    for (const token of asked) {
      const byIndex = Number(token)
      const found = Number.isInteger(byIndex) && String(byIndex) === token
        ? chosen[byIndex]
        : chosen.find((slide) => slide.id === token)
      if (!found) {
        console.error(`shoot: no slide "${token}". Known ids:\n  ${all.map((slide) => slide.id).join('\n  ')}`)
        await browser.close()
        process.exit(2)
      }
      picked.push(found)
    }
    chosen = picked
  }

  console.log(`shoot: ${BASE} — ${chosen.length} of ${all.length} slides, ${WIDTH}x${HEIGHT} @${SCALE}x, settle ${SETTLE}ms`)
  console.log(`       slide list from ${discovery.source}`)
  if (STILLS) console.log('       ?stills=1 — demo embeds forced to their still images')

  const passes = [{ viewport: { width: WIDTH, height: HEIGHT }, suffix: '', presenter: false }]
  if (PRESENTER) passes.push({ viewport: { width: WIDTH, height: HEIGHT }, suffix: '-presenter', presenter: true })
  if (FULL) passes.push({ viewport: FULL, suffix: `@${FULL.width}x${FULL.height}`, presenter: false })

  for (const pass of passes) {
    const passContext = pass.viewport.width === WIDTH && pass.viewport.height === HEIGHT
      ? context
      : await browser.newContext({ viewport: pass.viewport, deviceScaleFactor: SCALE, reducedMotion: 'no-preference' })

    for (const slide of chosen) {
      const options = { base: BASE, out: OUT, settle: SETTLE, suffix: pass.suffix, presenter: pass.presenter }
      let result
      try {
        result = await withTimeout(captureSlide(passContext, slide, options), TIMEOUT, `${slide.id}${pass.suffix}`)
      } catch (error) {
        result = { id: slide.id, index: slide.index, file: null, mounted: false, consoleErrors: [], pageErrors: [], failedRequests: [], memory: null, blank: null, stats: null, ms: TIMEOUT, notes: [String(error.message)] }
      }
      result.pass = pass.suffix || 'main'
      results.push(result)
      const mark = result.signedOutEmbed ? 'NOAUTH' : result.pageErrors.length ? 'ERR' : result.blank ? 'BLANK' : !result.mounted ? 'DEAD' : result.notes.length ? 'warn' : 'ok'
      // The cold-profile bookkeeping, appended to the line rather than given one:
      // it is context for the numbers beside it, not an event.
      const cold = [
        result.expected?.unauthorized ? `${result.expected.unauthorized} pre-sign-in 401` : '',
        result.expected?.aborted ? `${result.expected.aborted} cancelled nav` : '',
      ].filter(Boolean).join(', ')
      console.log(`  ${mark.padEnd(5)} ${pad(slide.index)}-${slide.id}${pass.suffix}  ${result.ms}ms`
        + (result.stats ? `  sd ${result.stats.stdDev} colours ${result.stats.colours}` : '  (undecodable)')
        + (cold ? `  [${cold}]` : '')
        + (result.notes.length ? `\n        ${result.notes.join('\n        ')}` : ''))
    }

    if (passContext !== context) await passContext.close()
  }

  if (GRID) {
    const result = await captureGrid(context, { base: BASE, out: OUT, settle: SETTLE, suffix: '' })
    result.pass = 'grid'
    results.push(result)
    console.log(`  ${result.notes.length > 1 ? 'warn ' : 'ok   '} grid  ${result.ms}ms`)
  }
} finally {
  await browser.close().catch(() => {})
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const report = {
  base: BASE,
  ranAt: new Date().toISOString(),
  viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE },
  settleMs: SETTLE,
  stills: STILLS,
  slideSource: discovery?.source ?? 'unknown',
  slides: results,
}
writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`)

const withPageErrors = results.filter((result) => result.pageErrors.length)
const unmounted = results.filter((result) => result.mounted === false)
const blanks = results.filter((result) => result.blank === true)
const withConsole = results.filter((result) => result.consoleErrors.length)
const withRequests = results.filter((result) => result.failedRequests.length)
const undecodable = results.filter((result) => result.file && !result.stats)
const signedOut = results.filter((result) => result.signedOutEmbed)

console.log(`\n${'-'.repeat(64)}`)
console.log(`captured   ${results.filter((result) => result.file).length}/${results.length}  ->  ${OUT}`)
console.log(`did not mount    ${unmounted.length}${unmounted.length ? `  (${unmounted.map((r) => r.id).join(', ')})` : ''}`)
console.log(`page errors      ${withPageErrors.length}${withPageErrors.length ? `  (${withPageErrors.map((r) => r.id).join(', ')})` : ''}`)
console.log(`blank captures   ${blanks.length}${blanks.length ? `  (${blanks.map((r) => r.id).join(', ')})` : ''}`)
console.log(`console errors   ${withConsole.length}${withConsole.length ? `  (${withConsole.map((r) => r.id).join(', ')})` : ''}`)
console.log(`failed requests  ${withRequests.length}${withRequests.length ? `  (${withRequests.map((r) => r.id).join(', ')})` : ''}`)
if (undecodable.length) console.log(`undecodable PNGs ${undecodable.length}  (blank check did not run on these)`)
console.log(`signed-out embeds ${signedOut.length}${signedOut.length ? `  (${signedOut.map((r) => r.id).join(', ')})` : ''}`)
console.log(`report           ${OUT}/report.json`)

if (signedOut.length) {
  console.log(`\n${'!'.repeat(64)}`)
  console.log(`${signedOut.length} demo slide(s) photographed the app's SIGN-IN PAGE instead of the app:`)
  console.log(`  ${signedOut.map((r) => r.id).join(', ')}`)
  console.log('\nThose shots look like working slides and are not. Do not use them to judge')
  console.log('the deck. Shoot from http://localhost:5180 — never 127.0.0.1 — with the app')
  console.log('on :5173 and the backend on :5001, after `cd deck && npm run reset-demo`.')
  console.log('See "Shooting a screenshot pass" in deck/DEMO-NOTES.md.')
  console.log(`${'!'.repeat(64)}`)
}

if (withPageErrors.length || blanks.length || unmounted.length || signedOut.length) {
  console.log('\nFAILED — a slide threw, did not mount, rendered nothing, or was signed out.')
  process.exit(1)
}
console.log('\nOK')
