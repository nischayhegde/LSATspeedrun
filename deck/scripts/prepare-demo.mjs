#!/usr/bin/env node
/**
 * Gets a machine ready to present the deck's live demos.
 *
 * Run it once, after the backend is up and before opening the deck:
 *
 *     cd backend && DEV_AUTH_ENABLED=true ../.venv/bin/python run.py   # port 5001
 *     cd frontend && npm run dev                                       # port 5173
 *     cd deck && npm run prepare-demo
 *     cd deck && npm run dev                                           # port 5180
 *
 * What it does:
 *   1. Runs `backend/scripts/seed_demo.py --apply`, which installs the lived-in
 *      demo account and leaves one case open on a strategy prompt.
 *   2. Runs `backend/scripts/stage_demo.py --apply --no-model`, which pins the
 *      demo question and stages the fifteen-question run the app drives itself
 *      through. `--no-model` keeps an already-graded verdict rather than
 *      replacing it, so this is safe to run repeatedly.
 *   3. Works out the open case's session id, the pre-graded verdict's, and the
 *      driven run's credited answers, and writes all of them into
 *      `demo.config.ts`.
 *   4. Proves, in a headless browser, that a localhost page can frame the
 *      signed-in app — and then reminds the presenter of the one thing a
 *      Playwright profile cannot do for them: open the deck on the `localhost`
 *      spelling. Nothing else is manual; the deck signs itself in and the tour
 *      is silenced server-side (`DEMO-NOTES.md` §10).
 *
 * Flags: --help, --skip-seed, --skip-stage, --email <address>.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(DECK_DIR, '..')
const CONFIG_PATH = resolve(DECK_DIR, 'demo.config.ts')
const VENV_PYTHON = resolve(REPO_ROOT, '.venv/bin/python')

const BACKEND_ORIGIN = 'http://127.0.0.1:5001'
const APP_ORIGIN = 'http://localhost:5173'
const HARNESS_PORT = 5179
/** `TOUR_STORAGE_KEY` in frontend/src/guided-tour.tsx. Verified 2026-08-10. */
const TOUR_KEY = 'lsat-tycoon:guided-tour:v6'

const HELP = `
prepare-demo — seed the demo account and wire the deck to it.

  node scripts/prepare-demo.mjs [--skip-seed] [--email <address>]

  --skip-seed       Do not re-run the seeder. Resolves the already-open case
                    from the running backend, rewrites demo.config.ts, and does
                    the browser checks. Use this when the account is already
                    seeded and you only want the config and the tour key.
  --skip-stage      Do not re-run stage_demo.py. Leaves the solo and autoplay
                    ids in demo.config.ts exactly as they are.
  --email <address> Account to seed. Must end in @localhost.test.
                    Default: student@localhost.test
  --help            This text.

Requires the backend on ${BACKEND_ORIGIN} with DEV_AUTH_ENABLED=true.
The frontend on ${APP_ORIGIN} is only needed for the browser
checks; without it the script still seeds and still writes the config, and
says so rather than pretending it checked.
`.trim()

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

const step = (text) => console.log(`\n\u2022 ${text}`)
const ok = (text) => console.log(`  \u2713 ${text}`)
const warn = (text, hint) => {
  console.log(`  ! ${text}`)
  if (hint) console.log(hint.replace(/^/gm, '    '))
}
/**
 * Below `warn`: something is not as intended, but nothing on stage changes
 * today. Separate from `warn` so that the `!` marks stay worth reading — a
 * report where everything is a warning is a report nobody reads to the end.
 */
const note = (text, hint) => {
  console.log(`  \u00b7 ${text}`)
  if (hint) console.log(hint.replace(/^/gm, '    '))
}

function die(message, hint) {
  console.error(`\nprepare-demo failed: ${message}`)
  if (hint) console.error(`\n${hint}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(HELP)
  process.exit(0)
}
const skipSeed = argv.includes('--skip-seed')
const skipStage = argv.includes('--skip-stage')
const emailIndex = argv.indexOf('--email')
const email = emailIndex === -1 ? 'student@localhost.test' : argv[emailIndex + 1]
if (emailIndex !== -1 && !email) die('--email needs a value.')
const KNOWN_FLAGS = ['--help', '-h', '--skip-seed', '--skip-stage', '--email']
const unknown = argv.filter(
  (value, index) =>
    value.startsWith('-')
    && !KNOWN_FLAGS.includes(value)
    // The value of --email is not a flag, even on the day someone names an
    // account something perverse.
    && !(emailIndex !== -1 && index === emailIndex + 1),
)
if (unknown.length) die(`unrecognised flag: ${unknown.join(' ')}`, HELP)

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** GET with a hard timeout, resolving `null` rather than throwing. */
async function getJson(url, timeoutMs = 4000, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Did anything at all answer HTTP on this origin? */
async function originAnswers(url, timeoutMs = 2500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(url, { method: 'HEAD', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The seeder prints a JSON report on stdout and a progress log on stderr, so
 * the report is whatever parses from the first line that opens an object.
 * Written defensively because the report is not guaranteed: the seeder's final
 * verification pass can raise after the account is already fully written.
 */
function parseReport(stdout) {
  const start = stdout.indexOf('\n{')
  const candidates = start === -1 ? [stdout] : [stdout.slice(start + 1), stdout]
  for (const candidate of candidates) {
    const opening = candidate.indexOf('{')
    if (opening === -1) continue
    try {
      return JSON.parse(candidate.slice(opening))
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** Run one of the backend's scripts, streaming its log and keeping its report. */
function runPython(script, args) {
  return new Promise((resolveRun) => {
    const child = spawn(VENV_PYTHON, [`scripts/${script}`, ...args], {
      cwd: resolve(REPO_ROOT, 'backend'),
      env: { ...process.env, DEV_AUTH_ENABLED: 'true' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on('error', (error) => resolveRun({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }))
    child.on('close', (code) => resolveRun({ code, stdout, stderr }))
  })
}

// ---------------------------------------------------------------------------
// 1. preflight
// ---------------------------------------------------------------------------

step('Checking the local stack')

if (!existsSync(VENV_PYTHON)) {
  die(
    `no interpreter at ${VENV_PYTHON}`,
    'Create the backend virtualenv first:\n  python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt',
  )
}
ok(`venv python at ${VENV_PYTHON}`)

const health = await getJson(`${BACKEND_ORIGIN}/v1/health`)
if (!health) {
  die(
    `the backend did not answer on ${BACKEND_ORIGIN}`,
    'Start it on 5001 — the frontend dev proxy targets that port and nothing else:\n'
      + '  cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py',
  )
}
ok(`backend up (${health.questions?.total ?? '?'} questions loaded)`)

const authConfig = await getJson(`${BACKEND_ORIGIN}/v1/auth/config`)
if (!authConfig?.dev_auth_enabled) {
  die(
    'the backend is running without DEV_AUTH_ENABLED',
    'The demo account is a dev-login account, and the seeder refuses to run without it. Restart the backend:\n'
      + '  cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py',
  )
}
ok('dev login enabled')

const appAnswered = await originAnswers(`${APP_ORIGIN}/`)
if (appAnswered) ok(`app dev server answering on ${APP_ORIGIN}`)
else warn(`nothing on ${APP_ORIGIN} — seeding anyway, but the browser checks below will be skipped`)

// ---------------------------------------------------------------------------
// 2. seed
// ---------------------------------------------------------------------------

let report = null
let seedExit = null

if (skipSeed) {
  step('Skipping the seeder (--skip-seed)')
} else {
  step('Seeding the demo account (this takes about a minute)')
  const seeded = await runPython('seed_demo.py', ['--apply', '--email', email])
  seedExit = seeded.code
  report = parseReport(seeded.stdout)

  if (seedExit === 0 && report) {
    ok(`seeded ${email}: ${report.attempts} attempts, office tier ${report.firm?.tier}`)
    if (report.problems?.length) warn(`seeder flagged: ${report.problems.join('; ')}`)
  } else if (report) {
    warn(`seeder exited ${seedExit} with problems: ${(report.problems || []).join('; ') || 'unknown'}`)
  } else {
    // The account is written incrementally and committed as it goes, so a
    // crash in the seeder's closing verification leaves a usable demo and no
    // report. Say so plainly instead of pretending either way.
    warn(`seeder exited ${seedExit} without printing a report — see the traceback above.`)
    warn('The account may still be fully seeded: the seeder commits as it goes and')
    warn('only builds its report at the very end. Resolving the open case from the')
    warn('backend instead, and checking it in a browser below.')
  }
}

// ---------------------------------------------------------------------------
// 2b. stage the pinned question and the driven run
// ---------------------------------------------------------------------------
//
// The seeder builds a believable account; staging is what makes it presentable
// in four minutes. It is run here, and not left to the presenter, for one value
// that cannot be recovered any other way: the credited answers to the
// fifteen-question run the app drives itself through. Every other id in this
// config can be re-derived from the running backend, because the API will tell
// you what sessions exist — but it will never tell you which answer is right
// (`serialize_question` omits `correct_answer` deliberately), so the key has to
// be carried out of the database by the script that reads it.
//
// `--no-model` because this is the cheap, repeatable half of staging: it keeps
// an already-graded verdict rather than spending 20-40s regenerating one, which
// is what makes it safe to sit in a command the presenter runs casually. The
// full `npm run stage-demo` is still what grades a verdict the first time.

let autoplay = null
let solo = null

if (skipStage) {
  step('Skipping stage_demo.py (--skip-stage)')
} else {
  step('Staging the pinned question, the solo case and the autoplay run')
  const staged = await runPython('stage_demo.py', ['--apply', '--no-model', '--email', email])
  const stagedReport = parseReport(staged.stdout)
  if (staged.code === 0 && stagedReport?.autoplay?.answer_key) {
    autoplay = stagedReport.autoplay
    ok(`case pinned to ${stagedReport.answer_key?.question_id ?? 'the demo question'}`)
    ok(`autoplay run ${autoplay.session_id}: ${autoplay.questions} questions, `
      + `${autoplay.question_types?.length ?? '?'} types`)
  } else {
    warn(
      `stage_demo.py exited ${staged.code} without a usable report`,
      'The autoplay ids below are left as they are. The rest of the demo is\n'
      + 'unaffected — nothing in the deck requests autoplay by default.',
    )
  }
  if (stagedReport?.solo?.answer_key) {
    solo = stagedReport.solo
    // An ungraded solo case is the one staging outcome that costs a slide
    // rather than a convenience: the sequence still plays, submits and stamps
    // a verdict, but the coaching it exists to reveal is not there to reveal.
    if (solo.coaching?.grade == null) {
      warn(
        `solo case ${solo.session_id} is staged but ungraded`,
        `${solo.coaching?.mechanism || 'no grade was produced'}\n`
        + 'The sequence will play and submit, but the feedback beat will show the\n'
        + 'grading placeholder instead of the coach. Re-run to try the call again.\n'
        + '\n'
        + 'If this machine has no TFY_API_KEY / TFY_URL it never will, and no login\n'
        + 'changes that — the coach is called by the backend, not by the browser. Run\n'
        + '`npm run capture-coaching` once on a machine where the gateway works and\n'
        + 'commit backend/scripts/demo_fixtures/coaching.json; every machine then\n'
        + 'stages this beat from that captured grade. See that folder\'s README.',
      )
    } else {
      ok(`solo case ${solo.session_id}: answer ${solo.answer_key}, `
        + `graded ${solo.coaching.grade}, fee ${solo.settled_payout ?? '?'}`)
      // Say so when the payoff beat is running on the committed capture rather
      // than on a grade this machine just produced. Both are real output from
      // the same model on the same reasoning, so neither is a problem — but a
      // presenter who does not know which one is on screen cannot tell that
      // their gateway went down, and this is the one beat where that matters.
      if (/^replayed the committed capture/.test(solo.coaching.mechanism || '')) {
        note(`solo case grade came from ${'scripts/demo_fixtures/coaching.json'}`,
          `${solo.coaching.mechanism}\n`
          + 'This is the intended fallback and the slide is fine. If you expected a live\n'
          + 'grade, your TFY_API_KEY / TFY_URL are not reaching the coach from here.')
      }
    }
    if (solo.coaching?.capture) note('coaching capture updated', `${solo.coaching.capture}\nCommit it.`)
  }
  // The same check for the verdict twin, which was not being made at all.
  //
  // Reported rather than warned, and the distinction is deliberate: no slide
  // requests `{verdictSession}` today — `demo-case-verdict-review` goes to the
  // answer wall at /progress?tab=answers — so an ungraded twin currently costs
  // nothing on stage. It stays staged and pinned because it is what a slide
  // would point back at to show the post-submit verdict screen without waiting
  // on a live model call, and it would fail badly if it did: the screen's whole
  // content is the stored grade, so with none it renders a thinking judge over
  // an empty panel and polls a result that never arrives.
  //
  // Saying "the verdict slide will break" when there is no such slide is how a
  // presenter learns to scroll past this whole section.
  const verdict = stagedReport?.verdict
  if (verdict?.session_id) {
    if (verdict.coaching?.grade == null) {
      note(`verdict twin ${verdict.session_id} is staged but ungraded`,
        `${verdict.coaching?.mechanism || 'no grade was produced'}\n`
        + 'No slide requests it today, so nothing on stage changes. It is pinned for a\n'
        + 'slide that wants the post-submit verdict screen as a read; point one at\n'
        + '{verdictSession} and this becomes a grading spinner that never resolves.')
    } else {
      ok(`verdict twin ${verdict.session_id}: graded ${verdict.coaching.grade}`
        + ` (${verdict.coaching.model || 'model unrecorded'})`)
    }
    if (verdict.coaching?.capture) note('coaching capture updated', `${verdict.coaching.capture}\nCommit it.`)
  }
}

// ---------------------------------------------------------------------------
// 3. resolve the live session id
// ---------------------------------------------------------------------------

step('Finding the case left open for the live demo')

let sessionId = ''
let sessionSource = ''

// `/v1/auth/dev` is CSRF-exempt (see AUTH_EXEMPT_PATHS in backend/app/auth.py),
// so a bare fetch can sign in and ask which runs exist. Hoisted out of the
// lookup below because the verdict session needs the same cookie.
const login = await fetch(`${BACKEND_ORIGIN}/v1/auth/dev`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email }),
}).catch(() => null)
const cookie = (login?.headers.getSetCookie?.() || [])
  .map((value) => value.split(';')[0])
  .join('; ')

const reportedUrl = report?.live_demo?.url
if (typeof reportedUrl === 'string') {
  sessionId = reportedUrl.split('/').filter(Boolean).pop() || ''
  if (sessionId) sessionSource = "the seeder's report"
}

if (!sessionId && login?.ok && cookie) {
  // `find_resumable_session` walks every queued run and re-serves the current
  // item; measured at 6-14s locally and reported as high as 19s on a cold
  // process. A 4s budget here failed silently and fell back to a pinned id,
  // which is how a stale session id reached the stage in the first place.
  const current = await getJson(`${BACKEND_ORIGIN}/v1/study-sessions/current`, 30000, { headers: { cookie } })
  sessionId = current?.session?.id || ''
  if (sessionId) sessionSource = `${BACKEND_ORIGIN}/v1/study-sessions/current`
}

if (!sessionId) {
  die(
    'no open case session could be found for ' + email,
    skipSeed
      ? 'Run without --skip-seed so the seeder can stage one.'
      : 'The seeder did not leave a resumable run. Read its output above; the demo\n'
        + 'slides that need a session fall back to their stills until this is fixed.',
  )
}
ok(`session ${sessionId} (from ${sessionSource})`)

// ---------------------------------------------------------------------------
// 3b. resolve the pre-graded verdict session
// ---------------------------------------------------------------------------
//
// `stage_demo.py` deletes and rebuilds the graded twin on every run, so its id
// changes every time the demo is staged. This step used to be missing, which
// meant `npm run reset-demo` reliably left `verdictSessionId` pointing at a
// session that had just been deleted — the payoff beat of the whole deck, broken
// by the command whose job is to make the demo work.
//
// Found by what it is rather than by its id: the twin is a *paused* run that
// already holds a graded attempt (`pending_result`). `serialize_session` reports
// that for any session with a `pending_attempt_id`, which is exactly the trick
// the staging script uses to make the verdict screen a read instead of a live
// model call. The open case is `in_progress` and has no pending result, so the
// two can never be confused.

step('Finding the pre-graded verdict session')

let verdictId = ''
if (cookie) {
  const active = await getJson(`${BACKEND_ORIGIN}/v1/study-sessions/active`, 30000, { headers: { cookie } })
  const twins = (active?.sessions || []).filter((entry) => (
    entry?.id !== sessionId
    && entry?.status === 'paused'
    && Boolean(entry?.pending_result?.attempt_id)
  ))
  verdictId = twins[0]?.id || ''
  if (twins.length > 1) {
    warn(`${twins.length} pre-graded sessions exist; taking ${verdictId}.`,
      'Re-run `npm run stage-demo` to collapse them to one.')
  }
}

if (!verdictId) {
  warn(
    'no pre-graded verdict session found',
    'The verdict slide will point at whatever `verdictSessionId` already says, and\n'
    + 'may wait on a live model call or bounce. Run `npm run stage-demo` (without\n'
    + '--no-model, so the coaching is actually generated) and then re-run this.',
  )
} else {
  ok(`verdict session ${verdictId}`)
}

// ---------------------------------------------------------------------------
// 4. rewrite demo.config.ts in place
// ---------------------------------------------------------------------------

step('Writing demo.config.ts')

const configBefore = await readFile(CONFIG_PATH, 'utf8').catch(() => null)
if (configBefore === null) die(`cannot read ${CONFIG_PATH}`)

/**
 * Repoint one `name: '...'` in the config.
 *
 * Only the object literal is quoted; the type declarations read
 * `liveSessionId: string`, so requiring a quoted value cannot hit them.
 */
const pin = (source, name, value) => {
  const assignment = new RegExp(`(${name}:\\s*)(['"\`])([^'"\`]*)\\2`, 'g')
  const matches = [...source.matchAll(assignment)]
  if (matches.length !== 1) {
    die(
      `expected exactly one \`${name}: '...'\` in demo.config.ts, found ${matches.length}`,
      `Set it by hand instead:\n  ${name}: '${value}',`,
    )
  }
  const previous = matches[0][3]
  ok(previous === value ? `${name} unchanged` : `${name} ${previous ? `${previous} \u2192 ` : ''}${value}`)
  return source.replace(assignment, `$1'${value}'`)
}

let configAfter = pin(configBefore, 'liveSessionId', sessionId)
if (verdictId) configAfter = pin(configAfter, 'verdictSessionId', verdictId)
if (solo) {
  configAfter = pin(configAfter, 'soloSessionId', solo.session_id)
  configAfter = pin(configAfter, 'soloAnswerKey', solo.answer_key)
}
if (autoplay) {
  // Together or not at all: a session id paired with the previous run's answer
  // key is fifteen wrong answers played to an audience, which reads as a broken
  // product rather than a broken demo.
  configAfter = pin(configAfter, 'autoplaySessionId', autoplay.session_id)
  configAfter = pin(configAfter, 'autoplayAnswerKey', autoplay.answer_key)
}
await writeFile(CONFIG_PATH, configAfter)

// ---------------------------------------------------------------------------
// 5. headless proof that a localhost page can frame the signed-in app
// ---------------------------------------------------------------------------

step('Checking that the signed-in app survives being framed')

const framed = { attempted: false, authenticated: null, note: '' }

if (!appAnswered) {
  framed.note = `skipped: ${APP_ORIGIN} is not up`
  warn(framed.note)
} else {
  {
    framed.attempted = true
    // Served without a host argument so the socket is dual-stack: whichever of
    // ::1 / 127.0.0.1 the browser picks for `localhost`, it lands here. The
    // spelling matters — see the note printed at the end.
    const server = createServer((request, response) => {
      const target = new URL(request.url, 'http://localhost').searchParams.get('u') || 'about:blank'
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}iframe{width:100vw;height:100vh;border:0}</style><iframe id="app" src="${target}"></iframe>`)
    })
    await new Promise((resolveListen) => server.listen(HARNESS_PORT, resolveListen))
    let browser = null
    try {
      browser = await launchChromium()
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      await page.goto(`${APP_ORIGIN}/login`, { waitUntil: 'domcontentloaded' })
      await page.locator('button', { hasText: 'Enter local development firm' }).click()
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
      await page.evaluate((key) => window.localStorage.setItem(key, 'complete'), TOUR_KEY)

      const target = `${APP_ORIGIN}/cases/${sessionId}`
      await page.goto(`http://localhost:${HARNESS_PORT}/?u=${encodeURIComponent(target)}`, { waitUntil: 'domcontentloaded' })
      const handle = await page.waitForSelector('#app')
      let frame = null
      for (let attempt = 0; attempt < 200 && !frame; attempt += 1) {
        frame = await handle.contentFrame()
        if (frame && frame.url() === 'about:blank') frame = null
        if (!frame) await page.waitForTimeout(50)
      }
      await frame?.waitForLoadState('domcontentloaded').catch(() => {})
      await page.waitForTimeout(1500)
      framed.authenticated = frame
        ? !(await frame.locator('button', { hasText: 'Enter local development firm' }).count())
        : false
      framed.frameUrl = frame?.url() ?? null
      if (framed.authenticated) ok(`framed ${target} while signed in`)
      else warn(`the frame fell back to ${framed.frameUrl} — it was not authenticated`)
    } catch (error) {
      framed.note = `check failed: ${String(error).slice(0, 200)}`
      warn(framed.note)
    } finally {
      await browser?.close().catch(() => {})
      server.close()
    }
  }
}

// ---------------------------------------------------------------------------
// 6. what the presenter still has to do by hand
// ---------------------------------------------------------------------------

console.log(`
${'-'.repeat(72)}
IN THE BROWSER YOU WILL PRESENT FROM

One thing, and it is about the address bar rather than about signing in:

  Open the deck at  http://localhost:5180  — spelled "localhost".
  http://127.0.0.1:5180 renders identically and will silently sign the
  iframes out: the browser treats 127.0.0.1 and localhost as different
  sites, and the app's cookies are SameSite=Lax.

There is deliberately no sign-in step and no devtools paste any more. Both
were invisible per-profile state that worked on the machine they were set up
on and failed on a fresh profile, in a guest window, or on a borrowed laptop
— which is a fair description of presentation morning. The deck signs itself
in during preflight through /v1/auth/dev, and stage_demo.py marks the demo
account as already oriented server-side, so the 21-step guided tour is
silenced for every browser at once. See DEMO-NOTES.md §10.

(The check above still signs in and sets '${TOUR_KEY}'
in its own throwaway Playwright profile. That is the harness proving the
framed path works, not a step anybody has to repeat by hand.)
${'-'.repeat(72)}`)

// ---------------------------------------------------------------------------
// 7. summary
// ---------------------------------------------------------------------------

console.log(`
Summary
  live session id  ${sessionId}
  solo case        ${solo ? `${solo.session_id} (${solo.answer_key}, grade ${solo.coaching?.grade ?? 'none'})` : skipStage ? 'left as-is (--skip-stage)' : 'not staged'}
  autoplay run     ${autoplay ? `${autoplay.session_id} (${autoplay.answer_key})` : skipStage ? 'left as-is (--skip-stage)' : 'not staged'}
  written to       ${CONFIG_PATH}
  app origin       ${APP_ORIGIN}   (answering: ${appAnswered ? 'yes' : 'NO'})
  seeder           ${skipSeed ? 'skipped (--skip-seed)' : `exit ${seedExit}${report ? '' : ', no report parsed'}`}
  framed check     ${framed.attempted ? (framed.authenticated ? 'authenticated' : 'NOT authenticated') : framed.note || 'not run'}

Next:  cd deck && npm run dev      then open http://localhost:5180
`)

// A demo that would show the login page on stage is not a success.
if (framed.attempted && framed.authenticated === false) process.exit(1)
