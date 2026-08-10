/**
 * Verify the `stillOnly` slide mode, and that it composes with the other three
 * ways a demo slide can end up showing a still.
 *
 * `stillOnly` marks a slide that shows a captured frame and never embeds the
 * live app — `demo-focus-mode`, which was cut from a live demo to a still. Two
 * things have to be true for that to be safe on stage:
 *
 *   1. The slot must not register, or the hoisted stage would position the live
 *      embed on top of the still. (`demo-frame.tsx` handles this.)
 *   2. The stage must not treat the slide as live at all, or it navigates an
 *      iframe nobody can see and — because positioning bails out early when
 *      there is no slot — leaves that iframe painted at the *previous* slide's
 *      slot rect, live app and all, on top of the still.
 *
 * The second is what this file exists to catch. It is not hypothetical: before
 * `demo.stillOnly` was added to the stage's `showStill` expression, the still
 * was alone on screen only by accident, because the positioning effect happened
 * to return before updating the host.
 *
 *   node scripts/verify-still-only.mjs --base=http://localhost:5185
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAYWRIGHT = process.env.DECK_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'

function findChrome() {
  if (process.env.DECK_CHROME) return process.env.DECK_CHROME
  const cache = `${homedir()}/Library/Caches/ms-playwright`
  let builds = []
  try {
    builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  } catch { /* fall through */ }
  for (const build of builds) {
    const path = `${cache}/${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    if (existsSync(path)) return path
  }
  return `${cache}/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
}

const flags = new Map(process.argv.slice(2).map((raw) => {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`verify-still-only: unrecognised argument "${raw}"`); process.exit(2) }
  return [match[1], match[2] ?? '']
}))

const BASE = (flags.get('base') || 'http://localhost:5185').replace(/\/$/, '')
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const EMAIL = flags.get('email') || 'student@localhost.test'
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots/still-only')
mkdirSync(OUT, { recursive: true })

/** The slide that is a still and nothing else, and a genuinely live one. */
const STILL_ONLY_SLIDE = flags.get('slide') || 'demo-focus-mode'
const LIVE_SLIDE = 'demo-case-answer'

const problems = []
const fail = (text) => { problems.push(text); console.error(`  \u2717 ${text}`) }
const ok = (text) => console.log(`  \u2713 ${text}`)

const { chromium } = await import(PLAYWRIGHT)
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})

/**
 * What is on screen for the current slide: is there a live embed, is a still
 * painted, and do the two overlap.
 */
const readStage = (page) => page.evaluate(() => {
  const frame = document.querySelector('.demo-stage-frame')
  const host = document.querySelector('.demo-stage')
  const still = document.querySelector('.deck-layer.is-live .demo-still')
  const rect = (node) => {
    if (!node) return null
    const box = node.getBoundingClientRect()
    return {
      x: Math.round(box.left), y: Math.round(box.top),
      w: Math.round(box.width), h: Math.round(box.height),
    }
  }
  const visible = (node) => {
    if (!node) return false
    const style = getComputedStyle(node)
    const box = node.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0.01 && box.width > 1 && box.height > 1
  }
  return {
    hash: window.location.hash.replace(/^#\/?/, ''),
    frame: Boolean(frame),
    frameVisible: visible(frame),
    frameSrc: frame?.getAttribute('src') ?? null,
    hostRect: rect(host),
    hostVisible: visible(host),
    still: Boolean(still),
    stillSrc: still?.getAttribute('src') ?? null,
    stillRect: rect(still),
  }
})

/** Do two rects share any area? */
function overlaps(a, b) {
  if (!a || !b) return false
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

async function gotoSlide(page, slide, query = '') {
  await page.goto(`${BASE}/${query ? `?${query}` : ''}#/${slide}`, {
    waitUntil: 'domcontentloaded', timeout: 60_000,
  })
  await page.waitForTimeout(4500)
}

try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  const signIn = await context.request.post(`${APP}/v1/auth/dev`, {
    data: { email: EMAIL }, timeout: 30_000,
  }).catch(() => null)
  if (signIn?.ok()) ok(`signed in as ${EMAIL}`)
  else fail('could not sign in — the live-mount check will be meaningless')

  // --- 1. the stillOnly slide, reached by advancing into it ----------------
  //
  // Reached by advancing rather than deep-linked, because the defect this is
  // looking for needs a *previous* demo slide to have left a slot rect behind.
  console.log(`\n\u2022 advancing into ${STILL_ONLY_SLIDE} from the demo run`)
  {
    const page = await context.newPage()
    await gotoSlide(page, LIVE_SLIDE)
    const before = await readStage(page)
    if (!before.frame) fail(`no live embed on ${LIVE_SLIDE}, so this walk proves nothing`)

    // Walk forward until the stillOnly slide is on screen.
    let seen = null
    for (let step = 0; step < 12; step += 1) {
      await page.mouse.move(12, 540)
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(1400)
      const state = await readStage(page)
      if (state.hash === STILL_ONLY_SLIDE) { seen = state; break }
    }
    if (!seen) {
      fail(`never reached ${STILL_ONLY_SLIDE} by advancing — is it still in the deck?`)
    } else {
      await page.waitForTimeout(2500)
      const state = await readStage(page)
      await page.screenshot({ path: resolve(OUT, 'still-only-slide.png') })

      if (!state.still) fail(`${STILL_ONLY_SLIDE} painted no still`)
      else ok(`the still is painted (${state.stillSrc})`)

      if (state.frame && state.frameVisible && overlaps(state.hostRect, state.stillRect)) {
        fail(`a LIVE EMBED is painted over the still on ${STILL_ONLY_SLIDE} `
          + `(embed at ${JSON.stringify(state.hostRect)}, still at ${JSON.stringify(state.stillRect)}, `
          + `src ${state.frameSrc}). This is the defect.`)
      } else if (state.frame && state.frameVisible) {
        fail(`a live embed is mounted and visible on ${STILL_ONLY_SLIDE} at `
          + `${JSON.stringify(state.hostRect)} — off the still, but it should not exist at all`)
      } else if (state.frame) {
        fail(`a live embed is still mounted on ${STILL_ONLY_SLIDE} (hidden, src ${state.frameSrc}) — `
          + 'it is loading an app route for a slide that never shows it')
      } else {
        ok('no live embed exists on the slide — the still is alone on screen')
      }
    }
    await page.close()
  }

  // --- 2. a genuinely live demo slide still mounts -------------------------
  console.log(`\n\u2022 ${LIVE_SLIDE} — a live demo must still embed`)
  {
    const page = await context.newPage()
    await gotoSlide(page, LIVE_SLIDE)
    const state = await readStage(page)
    if (!state.frame) fail(`${LIVE_SLIDE} did not mount a live embed`)
    else if (!state.frameVisible) fail(`${LIVE_SLIDE} mounted an embed that is not visible`)
    else ok(`the live embed mounted and is visible (${state.frameSrc})`)
    await page.screenshot({ path: resolve(OUT, 'live-slide.png') })
    await page.close()
  }

  // --- 3. the global stills override still wins ---------------------------
  console.log('\n\u2022 ?stills=1 — the panic button')
  {
    const page = await context.newPage()
    await gotoSlide(page, LIVE_SLIDE, 'stills=1')
    const state = await readStage(page)
    if (state.frame) fail('?stills=1 left a live embed mounted')
    else ok('no embed under ?stills=1')
    if (!state.still) fail('?stills=1 painted no still')
    else ok(`the still is painted instead (${state.stillSrc})`)
    await page.screenshot({ path: resolve(OUT, 'stills-override.png') })
    await page.close()
  }

  // --- 4. the unreachable-origin fallback still engages -------------------
  //
  // The app origin is refused at the network layer rather than stopped, so this
  // does not disturb the running stack or the other checks.
  console.log('\n\u2022 app origin unreachable — the health fallback')
  {
    const blocked = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    })
    await blocked.route(`${APP}/**`, (route) => route.abort())
    const page = await blocked.newPage()
    await gotoSlide(page, LIVE_SLIDE)
    await page.waitForTimeout(3000)
    const state = await readStage(page)
    if (!state.still) fail('with the app unreachable, no still was painted')
    else ok(`the fallback still engaged (${state.stillSrc})`)
    if (state.frame && state.frameVisible) {
      fail('an embed is visible even though the app origin is unreachable')
    } else {
      ok('no visible embed while the origin is unreachable')
    }
    await page.screenshot({ path: resolve(OUT, 'unreachable-fallback.png') })
    await blocked.close()
  }
} finally {
  await browser.close()
}

console.log('')
if (problems.length) {
  console.error(`${problems.length} problem(s) \u2014 ${OUT}`)
  process.exit(1)
}
console.log(`all clear \u2014 ${OUT}`)
