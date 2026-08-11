/**
 * Regenerate `deck/public/stills/*.png` from the live app.
 *
 * Those PNGs are the deck's on-stage fallback: when a demo route fails to load,
 * or when the presenter hits `?stills=1`, the audience sees one of these instead
 * of the live product. The app is under active development, so they drift — and
 * a drifted still is worse than a visible failure, because it silently shows the
 * room a product that no longer exists. This makes recapture a command.
 *
 *   node scripts/recapture-stills.mjs                  # all of them
 *   node scripts/recapture-stills.mjs --only=focus-mode,map
 *   node scripts/recapture-stills.mjs --list
 *
 * Requires the app on :5173 and the backend on :5001, and a seeded demo account
 * (`cd deck && npm run reset-demo`).
 *
 * Two things here are deliberate and worth not "simplifying":
 *
 * 1. **The viewport is the embed's logical viewport, not the projector's.** The
 *    stage caps a demo iframe at 1150 logical pixels wide so app text is legible
 *    from the back of a room. Capturing at 1920 logical would lay the app out
 *    differently from the live embed, and the fallback would visibly reflow at
 *    the moment of failure. So the page is laid out at 1152x648 — 16:9, a hair
 *    inside the cap — and scaled up by the device pixel ratio to land on exactly
 *    1920x1080. Same layout as the live embed, projector-native pixels.
 *
 * 2. **Every timeout here is generous.** A previous version of the demo tooling
 *    gave `/v1/study-sessions/current` four seconds; it takes 6-14 and has been
 *    seen at 19, so it failed silently and fell back to a stale pinned id. If a
 *    step here is slow, it should be slow and correct rather than fast and
 *    wrong.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Playwright is not a deck dependency; the other harnesses share this install. */
const PLAYWRIGHT = process.env.DECK_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'

function findChrome() {
  if (process.env.DECK_CHROME) return process.env.DECK_CHROME
  const cache = `${homedir()}/Library/Caches/ms-playwright`
  let builds = []
  try {
    builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  } catch { /* fall through to the guess below */ }
  for (const build of builds) {
    const path = `${cache}/${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    if (existsSync(path)) return path
  }
  return `${cache}/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
}

const flags = new Map(process.argv.slice(2).map((raw) => {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`recapture-stills: unrecognised argument "${raw}"`); process.exit(2) }
  return [match[1], match[2] ?? '']
}))

/** `localhost`, never `127.0.0.1` — the app's cookies are `SameSite=Lax`. */
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const EMAIL = flags.get('email') || 'student@localhost.test'
const OUT = resolve(DECK_DIR, flags.get('out') || 'public/stills')

/** The stage's legibility cap, and the 16:9 box it implies. */
const LOGICAL = { width: 1152, height: 648 }
/** 1152 * 5/3 = 1920, 648 * 5/3 = 1080. */
const SCALE = Number(flags.get('scale') || 5 / 3)
/** Milliseconds to let a route settle before the shutter. 3D scenes need it. */
const SETTLE = Number(flags.get('settle') || 3500)

/**
 * The still catalogue. `route` is what the deck's slide asks for; `file` is what
 * the slide's `still:` field names. Keep this table and the table in
 * DEMO-NOTES.md in step.
 *
 * `focus` flips the account into Focus Mode for the duration of one capture,
 * because the focus-mode gate only renders for an account that has it on.
 */
const STILLS = [
  { key: 'case', file: 'demo-case.png', route: '/cases/{session}' },
  { key: 'progress', file: 'demo-progress.png', route: '/progress' },
  {
    key: 'answer-log',
    file: 'demo-answer-log.png',
    // `?tab=` picks the panel and scrolls to it; the answer wall is behind a
    // dashboard tab rather than below the fold, so a bare `/progress` lands two
    // clicks away on the skills matrix and photographs the wrong screen.
    route: '/progress?tab=answers',
    // The drawer has no URL of its own — the router carries no per-attempt
    // route and the panel takes no parameter — so the one state this still
    // exists to show can only be reached by clicking a tile. Hence a `prepare`
    // step rather than a cleverer route.
    prepare: async (page) => {
      await page.click('.answer-log-grid .answer-tile', { timeout: 30_000 })
      await page.waitForSelector('.answer-log-coaching', { timeout: 30_000 })
      // Opening a tile scrolls the drawer to the top of the viewport by itself,
      // and matching the live embed's framing would be the better instinct —
      // but it cannot be had here. These stills are shot at 1152x648 logical
      // while the embed gives the app 826 of height, and the drawer runs 852
      // tall: live, the top of the drawer and both headings fit; at 648 they
      // cannot, and the app's own framing puts the coaching a screen below the
      // shutter. So the still is aimed at the pair of headings the slide's copy
      // points at and gives up the question above them, which is the right
      // thing to lose — the tile has already been established live.
      await page.evaluate(() => document.querySelector('.answer-log-reasoning')?.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(1_200)
    },
    // What the capture has to contain to be worth keeping. Checked against the
    // rendered frame below, because "it wrote a PNG" has never been the bar.
    require: ['.answer-log-reasoning', '.answer-log-coaching'],
  },
  { key: 'office', file: 'demo-office.png', route: '/office' },
  { key: 'office-tier0', file: 'demo-office-tier0.png', route: '/office?officeTier=0' },
  { key: 'office-tier14', file: 'demo-office-tier14.png', route: '/office?officeTier=14&officeAll=1' },
  { key: 'map', file: 'demo-map.png', route: '/map' },
  { key: 'firm-upgrades', file: 'demo-firm-upgrades.png', route: '/firm?tab=upgrades' },
  {
    key: 'focus-mode',
    file: 'demo-focus-mode.png',
    // The Office rather than the Firm or the Map: the audience has just watched
    // the office demo, so "the Office is put away" has a referent, and this
    // route's copy names three game systems at once. The frame has to carry the
    // claim "the game never gates practice" on its own.
    route: '/office',
    focus: true,
  },
]

if (flags.has('list')) {
  for (const still of STILLS) console.log(`${still.key.padEnd(14)} ${still.file.padEnd(26)} ${still.route}`)
  process.exit(0)
}

const only = (flags.get('only') || '').split(',').map((s) => s.trim()).filter(Boolean)
const wanted = only.length ? STILLS.filter((s) => only.includes(s.key)) : STILLS
if (only.length && wanted.length !== only.length) {
  const missing = only.filter((key) => !STILLS.some((s) => s.key === key))
  console.error(`recapture-stills: unknown still(s): ${missing.join(', ')}. Try --list.`)
  process.exit(2)
}

mkdirSync(OUT, { recursive: true })

const problems = []
const fail = (text) => { problems.push(text); console.error(`  \u2717 ${text}`) }
const ok = (text) => console.log(`  \u2713 ${text}`)

const { chromium } = await import(PLAYWRIGHT)
const browser = await chromium.launch({
  executablePath: findChrome(),
  // The office and map are Three.js scenes; without a GL backend they render
  // empty and the still would be a blank frame that looks fine in a file list.
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({
  viewport: LOGICAL,
  deviceScaleFactor: SCALE,
  reducedMotion: 'no-preference',
})

/** Set once we have flipped the account, so `finally` can always put it back. */
let focusModeLeftOn = false

/**
 * Decide whether what is on screen is fit to be a fallback.
 *
 * The states rejected here are the ones that look like a real screenshot in a
 * file listing but would mislead or embarrass on stage: the app's own error
 * card, the login screen, a spinner, and an empty document.
 */
async function inspect(page) {
  if (/\/login/.test(page.url())) return { reject: 'the app bounced to the login screen' }
  const seen = await page.evaluate(() => {
    const text = document.body?.innerText ?? ''
    return {
      text: text.slice(0, 4000),
      chars: text.trim().length,
      busy: Boolean(document.querySelector('[aria-busy="true"], .skeleton, [class*="spinner" i]')),
    }
  }).catch(() => null)
  if (!seen) return { reject: 'the page could not be read' }
  // Copy drawn from the app's own error and retry surfaces.
  const broken = [
    /could not be opened/i,
    /connection interrupted/i,
    /request could not be completed/i,
    /something went wrong/i,
    /failed to load/i,
  ].find((pattern) => pattern.test(seen.text))
  if (broken) return { reject: `the app rendered an error state (matched ${broken})` }
  if (seen.busy) return { reject: 'a spinner or skeleton was still on screen' }
  if (seen.chars < 40) return { reject: `the page looks empty (${seen.chars} characters of text)` }
  return { reject: null }
}

/** Cheap liveness check, so a dead backend stops the run instead of poisoning it. */
async function backendAlive() {
  const response = await context.request.get(`${APP}/v1/health`, { timeout: 30_000 }).catch(() => null)
  return Boolean(response?.ok())
}

async function setAssistanceLevel(level) {
  // Mutating requests are CSRF-checked against the `lsat_csrf` cookie, the same
  // way the app's own fetch wrapper does it. Without the header this is a 403.
  const cookies = await context.cookies(APP)
  const csrf = cookies.find((cookie) => cookie.name === 'lsat_csrf')?.value
  const response = await context.request.patch(`${APP}/v1/me`, {
    data: { assistance_level: level },
    headers: csrf ? { 'X-CSRF-Token': csrf } : {},
    timeout: 30_000,
  })
  if (!response.ok()) throw new Error(`PATCH /v1/me -> ${response.status()}`)
}

try {
  // --- refuse to start against a dead stack --------------------------------
  if (!await backendAlive()) {
    fail(`the backend is not answering through ${APP}/v1/health. `
      + 'Start it before recapturing — every still would otherwise be an error card.')
    throw new Error('backend down')
  }
  ok('the backend is up')

  // --- sign in -------------------------------------------------------------
  {
    const response = await context.request.post(`${APP}/v1/auth/dev`, {
      data: { email: EMAIL },
      timeout: 30_000,
    })
    if (!response.ok()) {
      fail(`could not sign in through ${APP}/v1/auth/dev (${response.status()}). `
        + 'Is the backend up with DEV_AUTH_ENABLED=true?')
      throw new Error('not signed in')
    }
    ok(`signed in as ${EMAIL}`)
  }

  // --- resolve the open case session ---------------------------------------
  //
  // Resolved live rather than read from demo.config.ts, so a recapture cannot
  // photograph a stale session's question. 30s, not 4s: see the header.
  let sessionId = ''
  if (wanted.some((still) => still.route.includes('{session}'))) {
    const response = await context.request.get(`${APP}/v1/study-sessions/current`, { timeout: 30_000 })
    if (response.ok()) {
      const body = await response.json().catch(() => null)
      sessionId = body?.session?.id ?? ''
    }
    if (sessionId) ok(`resolved the open case session ${sessionId}`)
    else fail('could not resolve an open case session — run `npm run reset-demo` first')
  }

  const page = await context.newPage()
  page.on('pageerror', (error) => fail(`pageerror: ${String(error).slice(0, 160)}`))

  for (const still of wanted) {
    const route = still.route.replace('{session}', sessionId)
    if (route.includes('{session}')) {
      fail(`skipped ${still.file}: no session id available`)
      continue
    }
    console.log(`\n\u2022 ${still.file} \u2014 ${route}`)

    // Re-checked per capture rather than once: the app is under active
    // development, so the backend can and does go away mid-run.
    if (!await backendAlive()) {
      fail(`${still.file}: NOT written — the backend stopped answering mid-run`)
      break
    }

    if (still.focus && !focusModeLeftOn) {
      await setAssistanceLevel('focus')
      focusModeLeftOn = true
      ok('Focus Mode on for this capture')
    } else if (!still.focus && focusModeLeftOn) {
      await setAssistanceLevel('full')
      focusModeLeftOn = false
      ok('Focus Mode back off')
    }

    await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined)
    await page.waitForTimeout(SETTLE)

    if (still.prepare) {
      try {
        await still.prepare(page)
      } catch (error) {
        fail(`${still.file}: NOT written — the setup step failed (${String(error.message).slice(0, 120)})`)
        continue
      }
    }

    const verdict = await inspect(page)
    if (verdict.reject) {
      // Refusing to write is the whole point. An earlier version of this script
      // photographed the app's "Connection interrupted" card over five good
      // stills when the backend died mid-run — which is precisely the silent
      // drift these files are dangerous for. A missing recapture is obvious; a
      // fallback that shows an error screen to the room is not.
      fail(`${still.file}: NOT written — ${verdict.reject}`)
      continue
    }

    // A still that renders but shows the wrong thing is the failure mode these
    // files have, not a still that fails to render: `demo-progress.png` stood in
    // for the review slide for a while and looked entirely fine while making
    // none of its point. So a still may name what it has to contain, and the
    // frame is checked for it before the bytes are kept.
    if (still.require) {
      const missing = await page.evaluate((selectors) => selectors.filter((selector) => {
        const element = document.querySelector(selector)
        if (!element) return true
        const box = element.getBoundingClientRect()
        return box.bottom <= 0 || box.top >= innerHeight || box.width === 0
      }), still.require)
      if (missing.length) {
        fail(`${still.file}: NOT written — not in frame: ${missing.join(', ')}`)
        continue
      }
    }

    // Write beside the target and move into place only once the bytes exist, so
    // an interrupted run cannot leave a truncated PNG as the fallback.
    const target = resolve(OUT, still.file)
    // Keeps the `.png` suffix, which Playwright uses to pick the encoder.
    const staging = resolve(OUT, `.tmp-${still.file}`)
    await page.screenshot({ path: staging, animations: 'disabled' })
    renameSync(staging, target)
    const kb = Math.round(statSync(target).size / 1024)
    ok(`wrote ${still.file} at ${Math.round(LOGICAL.width * SCALE)}x${Math.round(LOGICAL.height * SCALE)} (${kb} KB)`)
  }
} catch (error) {
  // The fatal paths above have already reported themselves through `fail`, so
  // there is nothing to add — a stack trace would only bury the explanation.
  if (!problems.length) fail(`unexpected failure: ${error.message}`)
} finally {
  // Leaving the account in Focus Mode would gate the office, firm and map demos
  // — every game slide in the talk would open on the "put away" screen. This
  // restore is the most important line in the file.
  if (focusModeLeftOn) {
    try {
      await setAssistanceLevel('full')
      ok('Focus Mode restored to off')
    } catch (error) {
      fail(`COULD NOT RESTORE Focus Mode: ${error.message}. `
        + 'Run: curl -X PATCH .../v1/me -d \'{"assistance_level":"full"}\' before presenting.')
    }
  }
  await browser.close()
}

console.log('')
if (problems.length) {
  console.error(`${problems.length} problem(s) \u2014 ${OUT}`)
  process.exit(1)
}
console.log(`stills written to ${OUT}`)
