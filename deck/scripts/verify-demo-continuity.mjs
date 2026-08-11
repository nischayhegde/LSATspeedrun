#!/usr/bin/env node
/**
 * Proves that a run of consecutive demo slides is one session of the app.
 *
 *     cd deck && npm run dev                              # 5180
 *     cd frontend && npm run dev                          # 5173
 *     cd backend && ... run.py                            # 5001
 *     cd deck && node scripts/verify-demo-continuity.mjs
 *
 * This is the regression test for the defect the demo runtime was rebuilt to fix:
 * `demo-case-answer`, `demo-case-verdict-review` and `demo-mega-litigation` are
 * authored as one continuous shot — work a case, read the verdict, then see the
 * firm's numbers — and every slide used to render its own `<iframe>` inside its
 * own slide layer, which `use-deck.ts` destroys when a transition completes. Each
 * seam reloaded the app from cold and dropped the session.
 *
 * Slides are named by id throughout, never by number. The deck is renumbered
 * often enough that a message reading "12 → 13" was wrong within a week, and a
 * verification script whose output lies about which slides it looked at is worse
 * than no script.
 *
 * ## What the current choreography is
 *
 * Worth stating, because several of the checks below look like regressions if
 * you are remembering the old cut (see `DEMO-NOTES.md` §5):
 *
 *   - The case slide **plays itself, and it submits**. `demo-case-answer` frames
 *     `{autoplay}` — the staged solo session plus the credited answer it is
 *     driven with — and a driver inside the app takes up the suggested approach,
 *     reads the question, shows the written case theory, picks the answer and
 *     submits it. The presenter narrates and touches nothing. The old cut ended
 *     this slide unsubmitted on a confidence click, and these checks used to
 *     *enforce* that; enforcing it now would fail a slide that works.
 *   - **The submit is a database read.** The attempt is answered and graded
 *     during staging, so the stamp and the coaching paint from stored state
 *     rather than from a 20-40 second model call. That is the claim the whole
 *     act rests on, so it is checked directly rather than assumed: at rest there
 *     must be no grading spinner anywhere on screen.
 *   - The verdict slide is **the dashboard's answer wall**, not a second case.
 *     `demo-case-verdict-review` frames `/progress?tab=answers`, so the room
 *     watches that same question become a durable record.
 *   - The deck and the app are on different origins, so a route change can only
 *     be done by reassigning `src`. Each seam therefore legitimately costs
 *     **exactly one** warm, already-authenticated reload. One is correct; two or
 *     more is the defect coming back.
 *
 * ## How it proves it rather than asserting it
 *
 * Independent signals, because any one alone could be satisfied by a frame that
 * merely *looks* continuous:
 *
 *   1. **Element identity.** The iframe is stamped with a random token on the
 *      case slide. If React remounted it the stamp is gone, because a remount is
 *      a new element. This is the invariant that carries the whole thing: the
 *      element surviving is what keeps the session cookie and the warm
 *      connection, which is what makes a reload warm instead of a cold boot.
 *   2. **Load count.** A `load` listener on that element increments a counter, so
 *      a frame that survived but was re-`src`'d more than the choreography calls
 *      for still fails. This is the difference between "the element persisted"
 *      and "the session persisted".
 *   3. **The sequence, watched to rest.** The script does not drive the case.
 *      Driving it would race the driver for the same controls. It watches —
 *      polling the app's own DOM until the page stops changing — and then asserts
 *      the end state the next slide depends on: a verdict stamp, a coaching
 *      panel, no spinner, the credited letter selected, and the driver's own
 *      `window.__autoplay.stop` still null. That last one matters more than it
 *      looks: the driver's failure mode is to go quiet and look composed, so it
 *      records *why* it stopped, and reading its own account beats inferring one
 *      from a missing element.
 *   4. **Time to rest.** The same poll times the sequence and holds it to the
 *      slide's budget. Four reference runs landed between 20.8 and 25.6 seconds
 *      against a 30-second budget, so a run outside that is either a regression
 *      or a machine too loaded to present from — both worth knowing before the
 *      talk rather than during it.
 *   5. **Route identity.** The verdict slide must land on the answer wall, not
 *      merely on the dashboard: `/progress` alone opens on the skills matrix,
 *      two clicks away from the entire subject of the slide.
 *
 * It also checks the things that must still happen: the arrow key advances off a
 * demo slide at all (the embed captures the keyboard, and a presenter who cannot
 * leave the autoplay slide is stranded immediately after the best 25 seconds of
 * the talk), leaving the run tears the frame down, `L` deliberately reloads the
 * current slide's route, and `?stills=1` swaps every embed for a still.
 *
 * ## The trap this script fell into once, written down so it is not repeated
 *
 * Its predecessor asserted that the case slide "must end UNSUBMITTED", and that
 * assertion **passed** for as long as it existed after the choreography it
 * described had been replaced by one that submits. It passed because it sampled
 * the case about 3.5 seconds in and the sequence does not submit until about 17.
 * A check that is green because of *when* it looked is worse than no check, and
 * shifting a settle by a few seconds would have failed a slide that works
 * perfectly. So everything below either waits for a settled state, or says out
 * loud in its own message that it is a sample taken at a moment.
 *
 * Signing in is done through the API rather than the login screen: this runs in a
 * throwaway browser profile, and `/v1/auth/dev` is exactly the affordance the
 * runbook tells a human to click.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchChromium } from './playwright-env.mjs'

const DECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flags = new Map(process.argv.slice(2).map((raw) => {
  const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(raw)
  if (!match) { console.error(`verify-demo-continuity: unrecognised argument "${raw}"`); process.exit(2) }
  return [match[1], match[2] ?? '']
}))

/**
 * `localhost`, never `127.0.0.1`. The app's cookies are `SameSite=Lax` and site
 * is compared by host rather than by origin, so a deck on `127.0.0.1` framing an
 * app on `localhost` is cross-site and every frame bounces to the login screen.
 */
const BASE = (flags.get('base') || 'http://localhost:5180').replace(/\/$/, '')
const APP = (flags.get('app') || 'http://localhost:5173').replace(/\/$/, '')
const EMAIL = flags.get('email') || 'student@localhost.test'
const OUT = resolve(DECK_DIR, flags.get('out') || '.deck-shots/continuity')
mkdirSync(OUT, { recursive: true })

/**
 * Seconds the driven case may take, from the app's document being ready to the
 * page coming to rest on the verdict.
 *
 * Must match `demo.budgetSeconds` on `demo-case-answer` in `src/slides/index.ts`.
 * Not imported: this is a plain `.mjs` script and that is a TypeScript module in
 * a Vite app, and adding a build step to a script whose whole value is that it
 * runs against the real stack in one command is a poor trade. `--budget=`
 * overrides it for a one-off measurement.
 */
const REST_BUDGET_S = Number(flags.get('budget') || 30)
/**
 * Well past the budget, deliberately. The job of this timeout is to end a run
 * that has stalled, not to be the thing that decides a slow run failed — that
 * judgement belongs to the budget check, which can say how long it actually took.
 */
const REST_TIMEOUT_MS = Math.round(REST_BUDGET_S * 1_000) + 25_000

/**
 * The credited answer, read out of `demo.config.ts` rather than written here.
 *
 * The letter is the most expensive thing in the deck to get wrong — the
 * presenter says it out loud to a room of lawyers-to-be, and it has been wrong
 * once already — and `prepare-demo.mjs` writes it beside the session it belongs
 * to, so this reads the same source rather than keeping a second copy that can
 * drift. Regexed rather than parsed, and a miss skips the check instead of
 * failing it: the file's format is not this script's to own.
 */
const expectedAnswer = (() => {
  try {
    return /soloAnswerKey:\s*'([A-E]+)'/.exec(readFileSync(resolve(DECK_DIR, 'demo.config.ts'), 'utf8'))?.[1] ?? null
  } catch {
    return null
  }
})()

/**
 * How hard this machine is working, per core, right now.
 *
 * The timing check below is the one assertion here that can be wrong through no
 * fault of the deck, and its own failure message tells the reader to "suspect
 * machine load first" — while giving them nothing to suspect it with. On the
 * first live run of this script the sequence took 33.8s against its 30s budget
 * with a one-minute load average of 31 on a 10-core machine, because something
 * else on the box was shooting screenshots; two runs of the same code minutes
 * earlier took 18.2s and 25.1s. A red result that means "your laptop was busy"
 * is a false alarm, and false alarms are how a check stops being read.
 */
const loadPerCore = () => loadavg()[0] / Math.max(1, cpus().length)
/** Above this, the machine is not one anybody would present from. */
const SATURATED = 1.5

const problems = []
const passes = []
/**
 * Observations that are not verdicts: a state this run could not catch, a number
 * that is inside its limit but uncomfortably close to it, something worth one
 * look by eye before the talk.
 *
 * These are printed at the end rather than where they are recorded. Several are
 * gathered in the middle of the case watch, and a line appearing between two
 * checks reads like the result of one of them.
 */
const notes = []
const fail = (text) => { problems.push(text); console.error(`  \u2717 ${text}`) }
const ok = (text) => { passes.push(text); console.log(`  \u2713 ${text}`) }
/**
 * Say it, rather than filing it.
 *
 * This used to be a bare `notes.push`, and the array it pushed into was written
 * to `report.json` and never printed — so the run's own hedges ("only 1.2s of
 * headroom", "the top tile is not the pinned question", "the first tile is off
 * screen, so you would have to scroll to it on stage") were invisible to anyone
 * who did not go and open the JSON afterwards. Every one of those exists to be
 * read before a talk, and a green "all checks passed" with the caveats filed out
 * of sight is the same species of lie this script was written to stop telling.
 */
const note = (text) => { notes.push(text); }

const browser = await launchChromium()
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
})

// --- sign in ---------------------------------------------------------------
{
  const response = await context.request.post(`${APP}/v1/auth/dev`, { data: { email: EMAIL } })
  if (!response.ok()) {
    fail(`could not sign in through ${APP}/v1/auth/dev (${response.status()}). `
      + 'Is the backend up with DEV_AUTH_ENABLED=true?')
  } else {
    ok(`signed in as ${EMAIL}`)
  }
}

const page = await context.newPage()
page.on('pageerror', (error) => fail(`pageerror: ${String(error).slice(0, 180)}`))

/** The hoisted embed, stamped and instrumented so a remount is detectable. */
const instrument = () => page.evaluate(() => {
  const frame = document.querySelector('.demo-stage-frame')
  if (!frame) return null
  if (!frame.dataset.stamp) {
    frame.dataset.stamp = `s${Math.random().toString(36).slice(2)}`
    frame.dataset.loads = '0'
    frame.addEventListener('load', () => {
      frame.dataset.loads = String(Number(frame.dataset.loads ?? 0) + 1)
    })
  }
  return { stamp: frame.dataset.stamp, loads: Number(frame.dataset.loads) }
})

const readFrame = () => page.evaluate(() => {
  const frame = document.querySelector('.demo-stage-frame')
  // The *host* is what has to line up with the slot. The iframe inside it is the
  // app's logical viewport, scaled to fit and centred, so it is legitimately
  // narrower than the host on whichever axis does not bind.
  const host = document.querySelector('.demo-stage')?.getBoundingClientRect()
  const slot = document.querySelector('.deck-layer.is-live .demo-screen')?.getBoundingClientRect()
  return {
    present: Boolean(frame),
    stamp: frame?.dataset.stamp ?? null,
    loads: frame ? Number(frame.dataset.loads ?? -1) : null,
    hash: window.location.hash.replace(/^#\/?/, ''),
    focusInEmbed: document.activeElement === frame,
    fit: host && slot ? {
      dx: Math.round(host.left - slot.left),
      dy: Math.round(host.top - slot.top),
      dw: Math.round(host.width - slot.width),
      dh: Math.round(host.height - slot.height),
    } : null,
  }
})

/**
 * Advance the deck the way a presenter does after working inside the embed.
 *
 * The mouse move is not padding: while focus is inside the cross-origin frame the
 * deck's `window` keydown listener never sees a key, and moving the pointer off
 * the embed is the signal the stage uses to take the keyboard back. Exercising
 * that handover is part of what this script is for.
 */
const advance = async (key = 'ArrowRight') => {
  await page.mouse.move(12, 540)
  await page.waitForTimeout(140)
  await page.keyboard.press(key)
}

/** The app's own document inside the embed. */
const appFrame = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = page.frames().find((frame) => frame.url().startsWith(APP) && !frame.url().includes('deck-warm'))
    if (found) return found
    await page.waitForTimeout(250)
  }
  return null
}

// --- the case --------------------------------------------------------------
console.log('\n\u2022 demo-case-answer \u2014 the case')
await page.goto(`${BASE}/#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('.demo-stage-frame', { timeout: 20000 }).catch(() => {
  fail('no hoisted demo frame appeared on demo-case-answer')
})
let embedded = await appFrame()
/** The case embed's URL, kept so the autoplay key it must carry can be checked. */
let openCaseUrl = ''
if (!embedded) fail('the app never loaded inside the embed')
else {
  await embedded.waitForLoadState('domcontentloaded').catch(() => undefined)
  // Short, and it used to be 3500ms. The sequence starts as soon as the app's
  // layout settles, and the opening beat — the choices locked behind a pending
  // approach — is over inside about five seconds, so a long blocking wait here
  // spent the very window the watch below exists to observe.
  await page.waitForTimeout(600)
  const url = embedded.url()
  openCaseUrl = url
  if (/\/login/.test(url)) {
    fail(`the embed bounced to the login screen (${url}). `
      + `The deck must be opened as ${BASE} and not as a 127.0.0.1 spelling.`)
  } else {
    ok(`the embed is on ${url.replace(APP, '')}`)
  }
}
const first = await instrument()
if (!first) fail('could not instrument the embed')
// Two frames of this slide, because it has two states worth looking at and the
// interesting one did not exist when this script only took one. The opening is
// the locked-choices beat; the payoff is shot below, once the page is at rest.
// Named by slide id, not by position. These were `12-`, `13-` and `14-` while
// the slides they photograph sit at 13, 14 and 15 — the deck gained a slide and
// the filenames kept insisting on the old numbers, which is the exact failure
// this file's header opens by forbidding. A number here buys an ordered
// directory listing and pays for it by going quietly wrong on every reorder.
await page.screenshot({ path: resolve(OUT, 'demo-case-answer-opening.png') })

// --- the case plays itself, and comes to rest on a stored verdict ----------
//
// The script watches; it does not drive. Its predecessor clicked "Use it" and
// then a confidence button, which was the choreography at the time. Doing either
// now would race the driver for the same controls and make this script the cause
// of the failure it reports.
console.log('\n\u2022 demo-case-answer \u2014 the app drives the sequence to rest')

if (embedded) {
  // The one silent failure on this slide. `{autoplay}` expands to the staged
  // solo session and its credited answer, but `drivenRoute` falls back to the
  // ordinary live case when either half is empty in `demo.config.ts` — which is
  // the right thing to do on stage (a case the presenter can work by hand beats
  // a URL that answers nothing) and completely invisible from the audience side.
  // Caught here rather than discovered on stage as a slide that never moves.
  if (!/[?&]autoplay=/.test(openCaseUrl)) {
    fail(`the case embed is on ${openCaseUrl.replace(APP, '') || '(unknown)'}, which carries no ?autoplay= key, `
      + 'so the slide will not play itself. `{autoplay}` falls back to the ordinary live case when '
      + '`soloSessionId` or `soloAnswerKey` is empty. Run `npm run reset-demo`.')
  } else {
    ok('the case embed carries an ?autoplay= key, so this is the driven slide')
  }
}

/**
 * One cheap read of everything the sequence is judged on.
 *
 * Deliberately a single `evaluate` rather than several: this runs a few times a
 * second for up to half a minute against an app that is animating a scroll, and
 * four round trips per sample is four more chances to interleave with it.
 */
const sampleCase = (frame) => frame.evaluate(() => {
  const stop = window.__autoplay?.stop ?? null
  const box = document.querySelector('.reasoning-box textarea')
  // Not `.strategy-tip` alone: the control arm of the strategy trial renders an
  // `.is-neutral` card in the same slot, and it offers nothing to take up.
  const tip = document.querySelector('.strategy-tip:not(.is-neutral)')
  const recorded = Boolean(tip?.querySelector('.strategy-tip-recorded'))
  const choices = [...document.querySelectorAll('.choices .choice')]
  return {
    driven: document.documentElement.classList.contains('autoplay-run'),
    stop: stop ? { reason: String(stop.reason), at: Number(stop.at) } : null,
    reasoningChars: box ? box.value.trim().length : -1,
    approachPending: Boolean(tip) && !recorded,
    approachRecorded: recorded,
    // The gate, observed rather than described: every choice is disabled until
    // the approach is answered. The slide's script says this out loud, so it is
    // worth knowing whether the room will actually see it.
    choicesLocked: choices.length > 0 && choices.every((choice) => choice.disabled),
    selected: document.querySelector('.choices .choice.selected .choice-label')?.textContent?.trim() ?? null,
    stamp: document.querySelector('.verdict-stamp')?.textContent?.trim() ?? null,
    coaching: Boolean(document.querySelector('.coaching-panel')),
    // Either of these on screen means the room is watching a model call.
    spinner: Boolean(document.querySelector('.grading-pending') || document.querySelector('.judge-thinking')),
  }
}).catch(() => null)

const watched = { driven: false, lockedChoices: false, approachRecorded: false, reasoningChars: -1, stop: null }
let atRest = null
let restSeconds = 0
/** Sampled while the sequence runs, so it describes the run being timed. */
let loadDuringRun = 0
if (embedded) {
  // The clock starts at the app's document being ready rather than at the
  // keypress that would put a presenter here, so this reads a little under the
  // wall-clock beat: the deck's own load cover is up before it starts. It is the
  // same boundary on every run, which is what makes the number comparable.
  const startedAt = Date.now()
  while (Date.now() - startedAt < REST_TIMEOUT_MS) {
    const sample = await sampleCase(embedded)
    if (sample) {
      watched.driven = watched.driven || sample.driven
      watched.lockedChoices = watched.lockedChoices || (sample.choicesLocked && sample.approachPending)
      watched.approachRecorded = watched.approachRecorded || sample.approachRecorded
      // The reasoning box unmounts the instant the verdict lands, so the only
      // chance to read it is while the sequence is still running. Kept as the
      // high-water mark rather than the last read, for the same reason.
      if (sample.reasoningChars > watched.reasoningChars) watched.reasoningChars = sample.reasoningChars
      watched.stop = sample.stop ?? watched.stop
      // Rest: the stamp is up and nothing is still being waited on. A driver
      // that has given up is also at rest, in the sense that matters here —
      // nothing else is going to happen — so that ends the watch too.
      if (sample.stop || (sample.stamp && !sample.spinner)) { atRest = sample; break }
    }
    loadDuringRun = Math.max(loadDuringRun, loadPerCore())
    await page.waitForTimeout(200)
  }
  restSeconds = (Date.now() - startedAt) / 1000
}

if (!embedded) {
  note('no app frame, so the autoplay sequence could not be watched')
} else if (!watched.driven) {
  fail('the app never engaged its autoplay driver (no `autoplay-run` class on the document). '
    + 'The URL carried a key the app refused: `soloAnswerKey` has to be A-E letters, one per item in the '
    + 'staged session, or `readAutoplayRequest` returns null and the slide sits there.')
} else {
  ok('the app engaged its autoplay driver, so the slide is playing itself')
}

if (watched.stop) {
  // The driver's own account of why it stopped, which is the whole reason it
  // keeps one: its failure mode is to go quiet on a composed frame, so a stalled
  // rehearsal is otherwise an hour of guessing.
  fail(`the driver gave up ${(watched.stop.at / 1000).toFixed(1)}s in: "${watched.stop.reason}" `
    + '(read from `window.__autoplay.stop` inside the embed)')
}

if (!atRest?.stamp) {
  // One cause, so one explanation: when the driver has already said why it
  // stopped, repeating the symptom as a second independent failure just makes
  // the report look worse than the defect is.
  fail(watched.stop
    ? 'the case never reached a verdict, because the driver stopped for the reason above. The slide\u2019s payoff '
      + 'is the stamp and the coach\u2019s reading landing together, and neither happened.'
    : `the case never reached a verdict within ${Math.round(REST_TIMEOUT_MS / 1000)}s, and the driver did not `
      + 'record giving up either — so it is still waiting on something. The slide\u2019s entire payoff is the stamp '
      + 'and the coach\u2019s reading landing together.')
} else {
  if (!watched.stop) ok('the driver played the whole sequence without giving up')
  ok(`the case played itself to a verdict ("${atRest.stamp}") in ${restSeconds.toFixed(1)}s`)
  if (!/SUSTAINED/i.test(atRest.stamp)) {
    fail(`the verdict stamp reads "${atRest.stamp}". The staged case is answered correctly by design, and an `
      + 'OVERRULED stamp contradicts the script the presenter is speaking over it.')
  }
  const headroom = REST_BUDGET_S - restSeconds
  if (headroom < 0 && loadDuringRun > SATURATED) {
    // Voided rather than failed. This machine was not in a state anybody would
    // present from, so the run measured the machine and not the deck — and a red
    // that means "your laptop was busy" teaches the reader to skip the check.
    note(`the sequence took ${restSeconds.toFixed(1)}s, over its ${REST_BUDGET_S}s budget — but the machine was at `
      + `${loadDuringRun.toFixed(1)} per core during the run, so this timed a saturated machine rather than the `
      + 'deck and the number means nothing either way. Reference runs on an idle machine landed between 20.8 and '
      + '25.6s. Re-run with nothing else going on before believing a regression.')
  } else if (headroom < 0) {
    fail(`the sequence took ${restSeconds.toFixed(1)}s to come to rest against the ${REST_BUDGET_S}s budget on `
      + '`demo-case-answer`, and the machine was idle enough to believe it '
      + `(${loadDuringRun.toFixed(1)} per core at the busiest). Reference runs landed between 20.8 and 25.6s, so `
      + 'either the pace in the app\u2019s `autoplay-plan.ts` moved or the budget has to.')
  } else if (headroom < 3) {
    note(`only ${headroom.toFixed(1)}s of headroom under the ${REST_BUDGET_S}s budget, which is thin `
      + 'for a machine also driving a projector')
  } else {
    ok(`${headroom.toFixed(1)}s of headroom under the ${REST_BUDGET_S}s budget`)
  }
  if (atRest.spinner) {
    fail('a grading spinner is on screen at rest. The verdict is supposed to paint from the attempt\u2019s stored '
      + 'coaching — a spinner here means the room is watching a live 20-40 second model call, which is the single '
      + 'largest risk in the talk. Re-run `npm run reset-demo` so the attempt is graded before the talk.')
  } else {
    ok('no grading spinner at rest, so the verdict and the coaching painted from stored state')
  }
  if (!atRest.coaching) {
    fail('the verdict landed with no coaching panel, so the slide reaches its stamp and never makes its point — '
      + 'that the grade is about the reasoning rather than the letter.')
  } else {
    ok('the coach\u2019s reading of the reasoning is on screen beside the verdict')
  }
  if (expectedAnswer && atRest.selected && atRest.selected !== expectedAnswer) {
    fail(`the app selected (${atRest.selected}) but demo.config.ts credits (${expectedAnswer}). The presenter says `
      + 'this letter out loud to the room, so a mismatch here is the most expensive error the deck can make.')
  } else if (expectedAnswer && atRest.selected) {
    ok(`the app selected (${atRest.selected}), which is the credited answer pinned in demo.config.ts`)
  } else if (!atRest.selected) {
    note('could not read which choice was selected at rest')
  }
}

// Said once, and it colours everything below it: every settle in this script is
// a fixed number of milliseconds, chosen against a machine that is doing nothing
// else. On a saturated box they are all short, so an isolated failure below is a
// reason to re-run rather than a finding.
if (loadDuringRun > SATURATED) {
  note(`this machine reached ${loadDuringRun.toFixed(1)} per core during the run. Every wait in this script is a `
    + 'fixed delay tuned for an idle machine, so treat a single failure below as a prompt to re-run on a quiet one.')
}

// The case theory is the beat the slide is built on — 827 characters of written
// argument, shown rather than typed. An empty box is that beat missing.
if (watched.reasoningChars < 0) {
  note('the reasoning box was never sampled before the verdict replaced it, so the pre-written case '
    + 'theory could not be checked')
} else if (watched.reasoningChars < 120) {
  fail(`the case theory is not pre-written (${watched.reasoningChars} chars seen). The sequence shows it rather `
    + 'than typing it, so this is the slide\u2019s central beat missing. Run `npm run stage-demo:fast`.')
} else {
  ok(`the case theory is pre-written (${watched.reasoningChars} chars), which is what the sequence shows`)
}

// Both of these are samples of a state that exists for about three seconds near
// the start of the sequence, so missing one is weak evidence of anything. Said
// plainly rather than failed: a flaky failure in this script costs more than a
// missing observation, and a script nobody trusts catches nothing.
if (watched.lockedChoices) {
  ok('the choices were seen locked behind the pending approach — the method enforced, which the script claims aloud')
} else {
  note('never caught the choices locked behind a pending approach. Either the poll missed a ~3s window '
    + 'or the strategy gate is not engaging — worth one look by eye before the talk, since the slide says it aloud')
}
if (!watched.approachRecorded) {
  note('never saw the approach card record a decision, which the driver makes about 3s in')
}

// Register, measured once the slide has stopped moving. The entrance animation
// and the two display faces both nudge the slot in the first second, so this
// used to be taken while it was still settling.
const twelve = await readFrame()
if (twelve.fit) {
  const worst = Math.max(...Object.values(twelve.fit).map(Math.abs))
  if (worst > 2) fail(`the hoisted embed is ${worst}px out of register with its slot: ${JSON.stringify(twelve.fit)}`)
  else ok(`the embed is registered on its slot to within ${worst}px`)
}
await page.screenshot({ path: resolve(OUT, 'demo-case-answer-verdict.png') })

// The same read: the frame is at rest, so a second `readFrame()` here would only
// be a second chance for the stamp and load count to disagree with themselves.
const beforeAdvance = twelve
if (beforeAdvance.focusInEmbed) {
  ok('the embed had taken the keyboard, as it does on stage — so the advance below exercises the handover')
} else {
  // Not a failure, and worth saying: the driver calls the app's handlers rather
  // than clicking, so a driven run can reach rest without focus ever entering
  // the frame. That makes the advance below an easier test than the stage is,
  // which is why the pointer move in `advance()` stays.
  note('focus was not inside the embed, so this advance is a gentler test than a hand-worked slide')
}

// --- demo-case-verdict-review: the answer wall, in the same element --------
console.log('\n\u2022 demo-case-answer \u2192 demo-case-verdict-review — the seam')
await advance()
// Longer than the 2200ms this used to allow. The dashboard's panels are lazy
// chunks and the `?tab=` deep link scrolls the tab strip up once they have
// height, so a shorter settle photographed a page that was still assembling —
// and the screenshot below is meant to be looked at.
await page.waitForTimeout(3400)
const thirteen = await readFrame()

// This is also the arrow-key regression test, and it is worth naming as one.
// The embed is cross-origin, so while it holds focus every keystroke goes to the
// app's document and none reach the deck's window listener — a presenter who
// cannot advance is stranded on the demo slide with no keyboard route off it.
// The stage's mitigation is to blur the frame on a pointer event outside the
// embed, which is what the mouse move inside `advance()` exercises.
if (thirteen.hash !== 'demo-case-verdict-review') {
  fail(`ArrowRight did not advance off demo-case-answer (hash is still "${thirteen.hash}"). `
    + 'If the embed had focus, the deck never saw the key: check the pointer-driven blur in `demo-stage.tsx`.')
} else {
  ok('ArrowRight advanced off the demo slide, so the presenter is not stranded on it')
}
if (!thirteen.present) fail('the embed disappeared crossing into demo-case-verdict-review')
if (thirteen.stamp !== beforeAdvance.stamp) {
  fail(`the embed was remounted crossing into demo-case-verdict-review (stamp ${beforeAdvance.stamp} \u2192 ${thirteen.stamp}). `
    + 'This is the original defect.')
} else {
  ok(`the same iframe element survived into demo-case-verdict-review (stamp ${thirteen.stamp})`)
}
// This slide points somewhere else in the app — historically a second, pre-graded
// session; now the dashboard's answer wall. Either way the deck and the app are
// on different origins, so a route change can only be done by reassigning `src`,
// which reloads. One load event here is therefore correct; the invariant worth
// holding is that the *element* survives, so the session cookie and the warm
// connection are kept and no login appears.
if (thirteen.loads > beforeAdvance.loads + 1) {
  fail(`the embed reloaded ${thirteen.loads - beforeAdvance.loads} times crossing into demo-case-verdict-review; `
    + 'the choreography allows exactly one warm reload for the route change')
} else {
  ok(`${thirteen.loads - beforeAdvance.loads} warm reload crossing into demo-case-verdict-review, as the route change requires`)
}
{
  // What this slide has to be on changed, and the check has to change with it.
  // It used to re-display a verdict on a second pre-graded case, so the check
  // was "a case route, but not the open one". The autoplay sequence now earns
  // its verdict on the slide before, and this slide was repurposed to the beat
  // the founders asked for at the start — that same question waiting in review
  // on the dashboard. So the requirement is the dashboard, and specifically the
  // answer wall: `/progress` alone lands on the skills matrix, two clicks from
  // the thing the slide is about.
  const url = page.frames().find((frame) => frame.url().startsWith(APP) && !frame.url().includes('deck-warm'))?.url() ?? ''
  const route = url.replace(APP, '')
  if (!/^\/progress/.test(route)) {
    fail(`demo-case-verdict-review is not on the dashboard (${route}). It is the review beat: it needs /progress.`)
  } else if (!/[?&]tab=answers\b/.test(route)) {
    fail(`demo-case-verdict-review is on ${route}, which opens the dashboard on the skills matrix. `
      + 'The Answer Log is behind a tab, not below the fold, so the route needs `/progress?tab=answers` '
      + 'or the presenter has to find it on stage.')
  } else {
    ok(`the embed is on the answer wall (${route})`)
  }
}

// The route is the means; the panel being on screen is the end. Checked
// separately because they can come apart in exactly one way that matters: the
// app decides what `?tab=` does, so if that support is ever removed the URL
// still reads `?tab=answers` and the slide quietly opens on the skills matrix
// again. A check that only reads the URL would keep passing through that.
{
  const wall = await appFrame()
  const found = wall
    ? await wall.waitForSelector('.answer-log-grid .answer-tile', { timeout: 12_000 }).then(() => true).catch(() => false)
    : false
  if (!found) {
    fail('the Answer Log never appeared on demo-case-verdict-review. The slide is the tile wall and the drawer '
      + 'opened off it; without the wall there is nothing for the presenter to click and the beat does not exist. '
      + 'Check that the app still honours `?tab=` on /progress.')
  } else {
    // The claim this slide rests on: the attempt the room just watched is the
    // tile the presenter reaches for. Its title carries type, outcome, time and
    // date, so it is printed whole — a person reading this report can see which
    // question is on top without running anything.
    const first = await wall.evaluate(() => {
      const tile = document.querySelector('.answer-log-grid .answer-tile')
      if (!tile) return null
      const box = tile.getBoundingClientRect()
      return {
        title: tile.getAttribute('title') ?? '',
        correct: tile.classList.contains('is-correct'),
        inView: box.width > 0 && box.bottom > 0 && box.top < window.innerHeight,
      }
    }).catch(() => null)
    if (!first) {
      note('the Answer Log rendered but its first tile could not be read')
    } else {
      ok(`the answer wall is up, first tile: "${first.title}"`)
      if (!first.correct) {
        fail(`the first tile in the Answer Log is marked missed ("${first.title}"). The presenter opens this tile `
          + 'while saying it is the question the room just watched being answered correctly. Staging stamps the '
          + "driven attempt's `created_at` so it sorts first — a wrong tile on top means something else was "
          + 'answered on this account since. Re-run `npm run stage-demo:fast`.')
      }
      // Weaker, and flagged rather than failed: the pinned question's type is
      // recorded in `DEMO-NOTES.md` §2 rather than anywhere this script can read,
      // so a mismatch is a prompt to look, not proof of a defect.
      if (!/^Assumption\b/.test(first.title)) {
        note(`the top tile reads "${first.title}", and DEMO-NOTES §2 pins the demo question as an `
          + 'Assumption item. Worth one look before the talk.')
      }
      if (!first.inView) {
        note('the first tile is outside the frame\u2019s viewport, so the presenter would have to '
          + 'scroll to it on stage')
      }
    }
  }
}

if (thirteen.fit) {
  const worst = Math.max(...Object.values(thirteen.fit).map(Math.abs))
  if (worst > 2) fail(`out of register on demo-case-verdict-review by ${worst}px: ${JSON.stringify(thirteen.fit)}`)
  else ok(`still registered to within ${worst}px on demo-case-verdict-review`)
}
await page.screenshot({ path: resolve(OUT, 'demo-case-verdict-review.png') })

// --- demo-mega-litigation: a different route, so one navigation, same element ---
console.log('\n\u2022 demo-case-verdict-review \u2192 demo-mega-litigation — on to /progress')
await advance()
await page.waitForTimeout(2200)
const fourteen = await readFrame()
if (fourteen.stamp !== thirteen.stamp) fail(`the embed was remounted crossing into demo-mega-litigation (${thirteen.stamp} \u2192 ${fourteen.stamp})`)
else if (fourteen.loads > thirteen.loads + 1) fail(`the embed reloaded ${fourteen.loads - thirteen.loads} times crossing into demo-mega-litigation; the choreography allows exactly one`)
else ok(`the same element carried through to demo-mega-litigation ("${fourteen.hash}"), signed in throughout`)
await page.screenshot({ path: resolve(OUT, 'demo-mega-litigation.png') })

// --- L reloads the slide's own route ---------------------------------------
console.log('\n\u2022 L \u2014 deliberately reload this slide\u2019s route')
await advance('l')
await page.waitForTimeout(3000)
const reloaded = await readFrame()
if (reloaded.stamp !== fourteen.stamp) fail('L replaced the element instead of navigating it')
else if (reloaded.loads <= fourteen.loads) fail(`L did not reload the embed (${fourteen.loads} \u2192 ${reloaded.loads} load events)`)
else ok(`L reloaded the route in the same element (${fourteen.loads} \u2192 ${reloaded.loads} load events)`)

// --- leaving the run tears it down ----------------------------------------
console.log('\n\u2022 Leaving the run')
await advance()
await page.waitForTimeout(2600)
const after = await readFrame()
if (after.present) fail(`the embed is still mounted on a non-demo slide ("${after.hash}")`)
else ok(`the embed is torn down on the first non-demo slide ("${after.hash}")`)

// --- and the panic button still works -------------------------------------
console.log('\n\u2022 The panic button')
await page.goto(`${BASE}/?stills=1#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
const stills = await page.evaluate(() => {
  const image = document.querySelector('.demo-still')
  return {
    still: Boolean(image),
    src: image?.getAttribute('src') ?? null,
    // A file can be named and missing. The fallback for the fallback is nothing
    // at all, so the bytes are confirmed to have arrived rather than requested.
    loaded: Boolean(image?.complete && image.naturalWidth > 0),
    frame: Boolean(document.querySelector('.demo-stage-frame')),
    lamp: document.querySelector('.demo-lamp')?.textContent ?? null,
    budget: Boolean(document.querySelector('.demo-budget')),
  }
})
if (!stills.still) fail('?stills=1 did not put a still on the case slide')
else if (stills.frame) fail('?stills=1 left a live embed mounted as well as the still')
else if (!stills.loaded) fail(`?stills=1 asks for ${stills.src}, which did not load. `
  + 'The slide names a file that is not in deck/public/stills — so the panic button shows an empty frame.')
// Which frame, not merely that there is one. `demo-case-answer` fell back to
// `demo-case.png` for a while: the *opening* beat, partner tip up and the choices
// still dimmed. It looked entirely correct — it is a real screenshot of this very
// route — and it stopped the slide three seconds into a thirty second story, so
// on the stills path the room saw the question and never saw it answered. Naming
// the wrong-but-plausible file is the failure worth guarding, so it is named.
else if (/demo-case\.png$/.test(stills.src)) {
  fail(`?stills=1 falls back to ${stills.src}, which is the opening frame of this slide — partner tip up, `
    + 'choices dimmed, no verdict. The slide is the whole case to a ruling, so its still has to be the end '
    + 'state: demo-case-answered.png.')
} else {
  ok(`?stills=1 shows ${stills.src} and no embed`)
}
await page.screenshot({ path: resolve(OUT, 'demo-case-answer-stills.png') })

// --- presenter-only chrome stays off the projector -------------------------
//
// The status lamp and the budget bar are instruments for the presenter, and the
// worst case for both is the same: the deck is opened without thinking about it
// and the audience reads "stills" off the screen. So the default is bare, and
// `?hud` — the flag the debug HUD already uses — brings them back for rehearsal.
// Checked on the stills path deliberately: that is the case where the lamp has
// something to say and therefore the case where leaking it costs the most.
console.log('\n\u2022 Presenter-only chrome')
if (stills.lamp !== null) fail(`the status lamp is on the audience's screen by default (reads "${stills.lamp}")`)
else ok('no status lamp without ?hud, so a fallback is invisible to the room')
if (stills.budget) fail("the demo budget bar is on the audience's screen by default")
else ok('no budget bar without ?hud')

await page.goto(`${BASE}/?stills=1&hud#/demo-case-answer`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2500)
const rehearsal = await page.evaluate(() => ({
  lamp: document.querySelector('.demo-lamp')?.textContent ?? null,
  budget: Boolean(document.querySelector('.demo-budget')),
}))
if (rehearsal.lamp !== 'stills') fail(`?hud did not bring the lamp back reading "stills" (got "${rehearsal.lamp}")`)
else ok('?hud restores the lamp, reading "stills" — the presenter can still tell live from still')
if (!rehearsal.budget) fail('?hud did not bring the demo budget bar back')
else ok('?hud restores the budget bar')

await browser.close()
writeFileSync(resolve(OUT, 'report.json'), `${JSON.stringify({
  base: BASE,
  app: APP,
  when: new Date().toISOString(),
  problems,
  notes,
  passes,
}, null, 2)}\n`)

// The notes, out loud. Under their own heading and after the checks, so nothing
// here can be mistaken for a verdict — but on the screen of the person who ran
// it, which is the only place they are any use.
if (notes.length) {
  console.log(`\n${notes.length} thing(s) this run could not settle, worth one look before the talk:`)
  for (const text of notes) console.log(`  \u2022 ${text}`)
}
console.log(`\n${problems.length ? `${problems.length} problem(s)` : `all ${passes.length} checks passed`} \u2014 ${OUT}`)
process.exit(problems.length ? 1 : 0)
