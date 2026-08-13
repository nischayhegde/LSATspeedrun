#!/usr/bin/env node
/**
 * Measure the slide 10 → 11 counsel pull and fail if it stops being true.
 *
 *     cd deck && npm run dev            # then, in another shell:
 *     cd deck && node scripts/verify-counsel-pull.mjs
 *
 * ## Why this exists
 *
 * The character walks over to the incoming slide and hauls it on. Every part of
 * that claim is checkable, and each one had to be checked by hand at least once
 * because it had previously been asserted and was false:
 *
 *   - the planted foot does not slide, so the walk is a walk and not a statue
 *     being translated;
 *   - the torso stays over the hips, so nothing shears;
 *   - the hand is *on* the sheet's edge at contact, not near it;
 *   - the sheet's travel is driven by the hand rather than by an ease that
 *     happens to run at the same time;
 *   - and the sheet finishes at the identity transform, full-bleed, with the
 *     deck's chrome still there.
 *
 * The numbers come from the scene's own probe (`window.__deckCounselStage`),
 * which reports world-space bone positions, and from the DOM, which reports
 * where the real slide layer actually is. Nothing here trusts the animation to
 * have played: the clock is the wall clock, so a stall shows up as a failure
 * rather than as a slow pass.
 *
 * Distances are in scene units. The figure is ~6.2 units tall for a 1.83 m man,
 * so one unit is roughly 30 cm and the thresholds below are about 6 cm of foot
 * scuff in locomotion, 9 cm across a crossfade, and 6 cm of shear.
 *
 * ## What it sweeps
 *
 * Three viewports, because the whole move is *laid out* from the frame: where
 * he stands is solved backwards from where his hand has to be for the sheet's
 * edge to sit at the frame edge, so a different aspect ratio is a different
 * choreography rather than the same one scaled. 1366×768 is the one that bites
 * — it is the widest relative to its height, so he walks furthest right and is
 * closest to leaving frame.
 *
 * Then reduced motion, which must not play the walk at all, and a
 * 10 → 11 → 10 → 11 round trip, which is where a scene that leaks state shows
 * it: the second run has to lay out, stand and land exactly like the first, on
 * the same ground plane.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { launchChromium } from './playwright-env.mjs'

const BASE = process.env.DECK_URL ?? 'http://localhost:5180'
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? null
const SHOTS = Number(process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? 10)

/** Scene units. Steady-state locomotion, either direction. */
const FOOT_SLIDE_SOLO = 0.2
/**
 * Scene units. Allowed only while two clips are crossfading.
 *
 * Tighter than it was. The idle → walk fade used to run over the first strides
 * of the walk and cost 0.31 of drift; it now runs inside the pivot, where the
 * body is not covering ground, and the only fade left under a moving body is
 * the one into the backpedal.
 */
const FOOT_SLIDE_BLEND = 0.3
/**
 * Scene units the shoulder line may sit *sideways* of the hip line.
 *
 * Sideways only. Fore-and-aft is lean, which a walking body has and a hauling
 * body has more of, and the scene reports it separately as `leanPeak` so it
 * can be read without being policed.
 */
const TORSO_OVER_HIPS = 0.2
/** CSS pixels the fingers must be *past* the sheet's edge while gripping. */
const BITE_MIN = 4
/** Share of the sheet's journey the hand has to carry. */
const HAND_DRIVEN = 0.9
/**
 * Scene units the shoe bottom may sit off the deck when he is standing.
 *
 * Measured off the figure's own geometry, not off an ankle — the ankle sits a
 * shoe's depth up by construction and reads about 0.22 no matter how well he
 * is standing. A twentieth of a unit is a centimetre and a half, well under
 * the contact shadow.
 */
const SOLE_ON_FLOOR = 0.05
/**
 * Scene units his standing spot may move between two visits to slide 10.
 *
 * Not zero, and not a leak. The whole move is solved against the camera, and
 * the camera carries a pointer parallax that is still easing toward rest when
 * the layout runs — so arriving from slide 9 and arriving back from slide 11
 * solve against lenses a few hundredths apart. Five hundredths of a unit is
 * about a centimetre and a half on a 1.83 m man: below the width of his own
 * shoe, and far below anything an audience could see move.
 */
const STANDING_SPOT = 0.05
/**
 * CSS pixels per second the sheet's edge may change speed by, frame over
 * frame, on average.
 *
 * This is the shudder number: not how fast the sheet travels but how evenly.
 * It is near zero for anything under a smooth ease and large for anything whose
 * position comes off a noisy signal.
 *
 * It caught the defect it exists for. The body's ground position is read from a
 * curve measured off the planted foot, and that curve was crediting the *swing*
 * foot's velocity at every support handover — so the body reversed about seven
 * centimetres twice a stride, the sheet is written from his hand, and the whole
 * viewport shuddered. It measured 470 px/s per frame against a cruise of 720;
 * it now measures about 30. The bar is set well below the broken figure and
 * well above the fixed one, so it fails for a regression rather than for a
 * busy machine.
 */
const EDGE_JERK_MEAN = 90
/** And the worst single frame, which is where a one-off glitch would show. */
const EDGE_JERK_PEAK = 400
/**
 * World units per second the camera may change speed by, frame over frame.
 *
 * Separate from the sheet because it is a separate suspect: a camera easing its
 * pointer parallax while the choreography is solved against it would shake the
 * picture without the sheet's own transform ever looking wrong. It reads a flat
 * zero with the pointer at rest, which is the case under test.
 */
const CAM_JERK_MEAN = 0.25

/**
 * Identity, however the browser chose to spell it.
 *
 * The animated path lands on an explicit `translate3d(0,0,0)` and computes to a
 * matrix; the reduced-motion path never touches `transform` at all and computes
 * to `none`. Both mean the slide is sitting exactly where the layout put it,
 * which is the thing being asserted.
 */
const IDENTITY = new Set(['none', 'matrix(1, 0, 0, 1, 0, 0)'])

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
]

if (OUT) mkdirSync(OUT, { recursive: true })

const browser = await launchChromium()
const results = []

/** Everything worth knowing about one instant, from the scene and the DOM. */
const readFrom = (page) => page.evaluate(() => {
  const layer = document.querySelector('.deck-layer[data-slide="pov-graded-question"]')
  const box = layer?.getBoundingClientRect()
  return {
    probe: window.__deckCounselStage?.() ?? null,
    liveSlide: document.querySelector('.deck-layer.is-live')?.dataset.slide ?? null,
    layer: layer
      ? {
        computed: getComputedStyle(layer).transform,
        mask: getComputedStyle(layer).maskImage,
        rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
      }
      : null,
    chrome: {
      progress: Boolean(document.querySelector('.deck-progress')),
      folio: Boolean(document.querySelector('.deck-folio')),
    },
    stageVisible: document.querySelector('.deck-stage')?.dataset.visible ?? null,
  }
})

/** Park on slide 10 with the counsel built and standing. */
async function settleOnTen(page) {
  await page.waitForSelector('.deck-layer.is-live', { timeout: 20000 })
  await page.waitForFunction(() => typeof window.__deckCounselStage === 'function', null, { timeout: 20000 })
  await page.waitForTimeout(1200)
}

/**
 * Press through the pull, sampling as it goes.
 *
 * Sampling is on the wall clock rather than on the scene's own `t`, so a scene
 * that stopped advancing produces samples that repeat rather than a run that
 * quietly takes longer.
 */
async function runPull(page, { shots, dir }) {
  const idle = await readFrom(page)
  const total = idle.probe?.plan?.total ?? 4.5
  const samples = [{ at: 0, ...idle }]
  if (dir) await page.screenshot({ path: `${dir}/00-idle.png` })

  const t0 = Date.now()
  await page.keyboard.press('ArrowRight')
  for (let i = 0; i < shots; i += 1) {
    const wait = ((i + 1) / shots) * (total * 1000 + 500) - (Date.now() - t0)
    if (wait > 0) await page.waitForTimeout(wait)
    const at = (Date.now() - t0) / 1000
    samples.push({ at, ...await readFrom(page) })
    if (dir) await page.screenshot({ path: `${dir}/${String(i + 1).padStart(2, '0')}-${at.toFixed(2)}.png` })
  }
  await page.waitForTimeout(1200)
  const settled = { at: (Date.now() - t0) / 1000, ...await readFrom(page) }
  samples.push(settled)
  if (dir) await page.screenshot({ path: `${dir}/99-settled.png` })
  return { idle, settled, samples }
}

/** The checks that apply to any completed pull, at any size. */
function pullChecks({ idle, settled, samples }, { width, height }) {
  const frames = samples.map((s) => s.probe).filter(Boolean)
  const peak = (key) => frames.reduce((worst, f) => Math.max(worst, f[key] ?? 0), 0)
  const gripping = frames.filter((f) => f.phase === 'haul' || f.phase === 'settle')
  const last = frames.at(-1)
  return [
    ['idle starts on the floor', idle.probe?.bodyY === 0, `bodyY=${idle.probe?.bodyY}`],
    [
      'soles start on the deck',
      Math.abs(idle.probe?.soleRest ?? 99) <= SOLE_ON_FLOOR,
      `soleRest=${idle.probe?.soleRest}`,
    ],
    ['foot planted through locomotion', peak('footSlidePeak') <= FOOT_SLIDE_SOLO, `peak=${peak('footSlidePeak')}`],
    // The drift figures skip frames that did not run on time, because a body
    // whose clock is the wall clock legitimately jumps when the browser
    // stalls and the sole goes with it. That exclusion is only honest while
    // the stalls are a minority — otherwise "the foot never slid" would mean
    // "hardly anything was looked at". Screenshots are what stall this run,
    // so the bar is loose; it is here to catch a measurement that stopped
    // measuring, not to grade the frame rate.
    [
      'enough frames ran on time to mean anything',
      (last?.measured ?? 0) >= 30 && (last?.hitches ?? 99) <= (last?.measured ?? 0),
      `measured=${last?.measured} hitches=${last?.hitches}`,
    ],
    ['foot slide bounded across blends', peak('footSlideBlend') <= FOOT_SLIDE_BLEND, `peak=${peak('footSlideBlend')}`],
    ['shoulders stacked over hips', peak('torsoPeak') <= TORSO_OVER_HIPS, `peak=${peak('torsoPeak')}`],
    [
      'sheet travelled without shuddering',
      (last?.stability?.edgeJerkMean ?? 99) <= EDGE_JERK_MEAN
        && (last?.stability?.edgeJerkPeak ?? 99) <= EDGE_JERK_PEAK
        // Frames that stalled are excluded from the figures above, so the
        // figures only mean something while most frames did not stall.
        && (last?.stability?.frames ?? 0) >= 60,
      `mean=${last?.stability?.edgeJerkMean} peak=${last?.stability?.edgeJerkPeak} px/s per frame`
      + ` over ${last?.stability?.frames} frames, ${last?.stability?.dropped} dropped`,
    ],
    [
      'camera held still',
      (last?.stability?.camJerkMean ?? 99) <= CAM_JERK_MEAN,
      `mean=${last?.stability?.camJerkMean} peak=${last?.stability?.camJerkPeak}`,
    ],
    [
      'fingers past the sheet edge while gripping',
      gripping.length > 0 && gripping.every((f) => f.bite >= BITE_MIN),
      `bite=${gripping.map((f) => f.bite).join(',')}`,
    ],
    ['hand carried the sheet', (last?.handDriven ?? 0) >= HAND_DRIVEN, `driven=${last?.handDriven}`],
    ['sheet landed at identity', IDENTITY.has(String(settled.layer?.computed)), String(settled.layer?.computed)],
    ['sheet is unmasked', settled.layer?.mask === 'none', String(settled.layer?.mask)],
    ['sheet is full-bleed', String(settled.layer?.rect) === `0,0,${width},${height}`, String(settled.layer?.rect)],
    ['slide 11 is live', settled.liveSlide === 'pov-graded-question', String(settled.liveSlide)],
    ['chrome survived', settled.chrome.progress && settled.chrome.folio, JSON.stringify(settled.chrome)],
    ['stage hidden after the haul', settled.stageVisible === 'false', String(settled.stageVisible)],
  ]
}

function logRun(label, samples) {
  console.log(`\n--- ${label} ---`)
  for (const s of samples) {
    const p = s.probe
    if (!p) continue
    console.log([
      `t=${String(p.t).padStart(5)}`,
      p.phase.padEnd(7),
      `body=(${String(p.bodyX).padStart(7)},${String(p.bodyZ).padStart(6)})`,
      `foot=${String(p.footY).padStart(7)}`,
      `footSolo=${String(p.footSlidePeak).padStart(6)}`,
      `footBlend=${String(p.footSlideBlend).padStart(6)}`,
      `shear=${String(p.torsoPeak).padStart(6)}`,
      `bite=${String(p.bite).padStart(6)}`,
      `tx=${String(p.slideTx).padStart(6)}`,
      `driven=${String(p.handDriven).padStart(6)}`,
    ].join(' '))
  }
  const end = samples.at(-1)?.probe
  if (end?.stability) {
    const s = end.stability
    console.log(
      `    steadiness: sheet ${s.edgeJerkMean}/${s.edgeJerkPeak} px/s per frame (mean/peak)`
      + `  camera ${s.camJerkMean}/${s.camJerkPeak}`
      + `  frames=${s.frames} dropped=${s.dropped} worst delta=${s.deltaMax}s`,
    )
    console.log(
      `    beat: ${end.plan.steps} steps, share=${end.plan.share}x authored`
      + ` (walk cycle ${(end.plan.walkCycleSec * end.plan.share).toFixed(2)}s)`
      + `  click→contact=${end.plan.contactAt}s  haul ends=${end.plan.haulEnd}s  total=${end.plan.total}s`,
    )
  }
}

// --- the sweep ---------------------------------------------------------------
for (const viewport of VIEWPORTS) {
  const label = `${viewport.width}x${viewport.height}`
  const dir = OUT ? `${OUT}/${label}` : null
  if (dir) mkdirSync(dir, { recursive: true })

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))

  await page.goto(`${BASE}/#/concept-lawyer-tycoon`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await settleOnTen(page)

  const run = await runPull(page, { shots: SHOTS, dir })
  logRun(label, run.samples)
  const checks = pullChecks(run, viewport)
  checks.push(['no page errors', errors.length === 0, errors.join(' | ')])
  results.push({ label, checks, samples: run.samples, errors })

  // --- and again, from the top -----------------------------------------------
  //
  // Back to 10 and forward again on the same page. The scene is rebuilt or
  // reset in between and both paths have to land in the same place: this is
  // where a leaked `running`, a stale plan or a pelvis lowered twice by its
  // own sole offset would show up, and none of it is visible in a single pass.
  if (viewport.width === 1600) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(2000)
    const back = await readFrom(page)
    const second = await runPull(page, { shots: 4, dir: null })
    logRun(`${label} round trip`, [back, ...second.samples])

    const first = run.idle.probe
    const again = second.idle.probe
    results.push({
      label: `${label} round trip`,
      checks: [
        [
          'stands in the same place on the way back',
          Math.abs((again?.bodyX ?? 0) - (first?.bodyX ?? 99)) < STANDING_SPOT
          && Math.abs((again?.bodyZ ?? 0) - (first?.bodyZ ?? 99)) < STANDING_SPOT,
          `first=(${first?.bodyX},${first?.bodyZ}) again=(${again?.bodyX},${again?.bodyZ})`,
        ],
        [
          'same ground plane on the way back',
          Math.abs((again?.footY ?? 99) - (first?.footY ?? 0)) < 0.01
          && Math.abs((again?.soleRest ?? 99) - (first?.soleRest ?? 0)) < 0.01,
          `first=${first?.footY}/${first?.soleRest} again=${again?.footY}/${again?.soleRest}`,
        ],
        ['returned to slide 10', back.liveSlide === 'concept-lawyer-tycoon', String(back.liveSlide)],
        ...pullChecks(second, viewport),
        ['no page errors', errors.length === 0, errors.join(' | ')],
      ],
      samples: second.samples,
      errors,
    })
  }

  await page.close()
}

// --- reduced motion ----------------------------------------------------------
//
// No walk, no haul: the scene snaps to the end and the sheet is simply there.
// What still has to hold is the landing, because that is the part the audience
// keeps either way.
{
  const viewport = { width: 1600, height: 900 }
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${BASE}/#/concept-lawyer-tycoon`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.deck-layer.is-live', { timeout: 20000 })
  await page.waitForTimeout(1500)

  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(2500)
  const settled = await readFrom(page)
  if (OUT) {
    mkdirSync(`${OUT}/reduced`, { recursive: true })
    await page.screenshot({ path: `${OUT}/reduced/99-settled.png` })
  }

  results.push({
    label: 'reduced motion',
    checks: [
      ['slide 11 is live', settled.liveSlide === 'pov-graded-question', String(settled.liveSlide)],
      ['sheet landed at identity', IDENTITY.has(String(settled.layer?.computed)), String(settled.layer?.computed)],
      ['sheet is full-bleed', String(settled.layer?.rect) === '0,0,1600,900', String(settled.layer?.rect)],
      ['sheet is unmasked', settled.layer?.mask === 'none', String(settled.layer?.mask)],
      ['chrome survived', settled.chrome.progress && settled.chrome.folio, JSON.stringify(settled.chrome)],
      ['no page errors', errors.length === 0, errors.join(' | ')],
    ],
    samples: [settled],
    errors,
  })
  await page.close()
}

if (OUT) writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2))

let failed = 0
for (const { label, checks } of results) {
  console.log(`\n[${label}]`)
  for (const [name, ok, detail] of checks) {
    if (!ok) failed += 1
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`)
  }
}

await browser.close()
if (failed) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\ncounsel pull: all checks passed.')
