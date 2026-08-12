/**
 * Is the crowd walking at a person's pace, or at a world constant's?
 *
 * Halving `CROWD_RENDER_SCALE` left the pavement looking like it had been put on
 * fast-forward, and the reason is a unit mismatch that was invisible while the
 * scale never changed. A walker's `cruise` is drawn in **world units per second**
 * — `.44 + hash * .72`, times a per-walker height variation — while the gait clip
 * is rate-matched against `HumanoidActor.naturalWalkSpeed`, which is
 * `strideLength * hipHeight * worldScale / duration` and therefore proportional
 * to how big the body is drawn. Halve the body and the speed stays, so the ratio
 * the clip is time-scaled by doubles, up to the `2.2` ceiling in
 * `setGroundSpeed`, past which the legs cannot keep up at all and the feet slide.
 *
 * So this reports the pace in the two frames of reference that matter and not in
 * world units, which is the frame that hides the bug:
 *
 *   ratio     cruise / naturalWalkSpeed. One means the clip plays at the rate it
 *             was authored at. Anything at the 2.2 ceiling is skating outright.
 *   cadence   the same thing in steps a second, since the walk clip is one cycle
 *             and therefore two steps. This is the form worth quoting: a person
 *             walks at about 1.9 steps a second, and 3.4 is a sprint.
 *   heights   cruise / drawn body height, in body-heights per second. A person
 *             walking at 1.4 m/s and 1.7 m tall is .82 of these.
 *   slip      how much of the body's travel the stance foot slides through,
 *             watched directly rather than derived. See where it is measured.
 *
 * Both are read off live walkers rather than derived, because `naturalWalkSpeed`
 * depends on a `worldScale` the actor refreshes per frame and on a stride it
 * measures from the bound skeleton — neither of which a calculation on this side
 * would get right.
 *
 * Usage: node tools/map-qa/pace.mjs [region…]
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const keys = process.argv.slice(2).filter((argument) => TABS[argument])
const REGIONS = keys.length ? keys : ['city', 'nation']
const SCALES = (process.env.MAPS_SCALES ?? '.278,.139').split(',').map(Number)
const SETTLE = Number(process.env.MAPS_SETTLE ?? 240)
/** Frames the feet are watched for. Two seconds is several strides. */
const WATCH = Number(process.env.MAPS_WATCH ?? 120)
/** `body` is the shipped band; `world` restores the old one in the page. */
const BANDS = (process.env.MAPS_BANDS ?? 'world,body').split(',')
/** The render scale the old world-unit band was tuned against. */
const REFERENCE = .278

/** A person's comfortable walk: 1.4 m/s over a 1.7 m frame. */
const HUMAN_HEIGHTS_PER_SECOND = .82
/** And the cadence that goes with it: about 114 steps a minute. */
const HUMAN_STEPS_PER_SECOND = 1.9

function survey(settings) {
  const scene = window.__mapScene
  const crowd = scene.crowd
  scene.renderer.render = () => {}

  /*
   * The `world` arm, restored in the page rather than measured in another
   * server lifetime.
   *
   * No copy of the band is needed to do it. The shipped band is a multiple of
   * `naturalWalkSpeed`, which is proportional to the render scale, and it was
   * converted so as to agree with the old world-unit band at `.278` — so the
   * old speed for any walker at any scale is simply the new speed it would have
   * been given at `.278`, which is `cruise * .278 / scale`. A probe that
   * restated `PACE_MIN` and `PACE_SPAN` instead would go quietly wrong the day
   * either is retuned.
   *
   * It carries its own null check: at `scale === .278` the factor is one, so the
   * two arms must come back identical, and a run where they do not has found
   * either a bad conversion or a bad harness.
   *
   * Same walkers, same pavement, same lifetime. Across lifetimes the crowd's
   * population and spawn cursor differ, and the comparison would be between two
   * districts rather than between two bands.
   */
  if (settings.band === 'world') {
    const factor = settings.reference / settings.scale
    for (const walker of crowd?.walkers ?? []) {
      walker.cruise *= factor
      walker.speed *= factor
    }
  }

  // The gait is only updated for walkers inside `animateWithin`, and the camera
  // decides who that is. Ticking here rather than at the caller keeps the pull
  // and the read in one page call, so nothing real happens between them.
  window.__clock.tick(settings.settle)

  const round = (value) => +Number(value ?? 0).toFixed(4)

  /*
   * Who counts: the population whose gait the crowd is actually driving.
   *
   * `Crowd.settle` returns before touching the actor for anything beyond
   * `animateWithin` of the camera, and `naturalWalkSpeed` reads a `worldScale`
   * the actor only refreshes inside `update` — so a distant walker reports a
   * natural speed for whatever size it last drew at, which for one that faded in
   * out of range is the `.001` of its first frame. That produced a natural speed
   * of .0028 and a ratio of 306 in the first run of this probe, which is not a
   * walker outrunning its legs, it is a stale number. Range is the honest filter
   * and it is the crowd's own.
   */
  const camera = scene.camera
  const reach = (crowd?.animateWithin ?? 30) ** 2
  const driven = (walker) => walker.active
    && walker.phase === 'run'
    && Boolean(walker.humanoid)
    && walker.root.position.distanceToSquared(camera.position) <= reach

  const rows = []
  for (const walker of crowd?.walkers ?? []) {
    if (!driven(walker)) continue
    const humanoid = walker.humanoid
    const natural = humanoid.naturalWalkSpeed
    if (!(natural > 0)) continue
    const drawn = walker.baseScale * settings.rigHeight
    const walk = humanoid.action?.('walk') ?? null
    // Steps a second, which is the form of this number a reader can check
    // against a pavement outside. The walk clip is one full cycle and therefore
    // two steps, so cadence is `2 * rate / duration`; the duration is read from
    // the clip's own metadata rather than restated here.
    const cycle = humanoid.meta?.get?.('walk')?.duration ?? 0
    const cadence = cycle > 0 ? 2 * (walker.cruise / natural) / cycle : 0
    rows.push({
      seed: round(walker.seed),
      cruise: round(walker.cruise),
      speed: round(walker.speed),
      natural: round(natural),
      ratio: round(walker.cruise / natural),
      cadence: round(cadence),
      heights: round(walker.cruise / drawn),
      drawn: round(drawn),
      scale: round(walker.baseScale),
      // What the mixer is actually running at, which is the ratio after the
      // clamp and the per-actor jitter. The clamp is the whole point: a ratio of
      // 3 and a ratio of 8 are the same picture, and it is a bad one.
      timeScale: round(walk?.getEffectiveTimeScale?.() ?? 0),
      walking: Boolean(walker.walking),
    })
  }

  /*
   * Foot slip: the measurement that does not depend on believing any of the
   * above.
   *
   * A walk clip whose rate matches the body's travel leaves the stance foot
   * standing still on the ground while the body passes over it. One that does
   * not drags it. So: watch both feet in world space, take the *slower* one each
   * frame — which is the one in stance, without having to ask the clip which
   * that is — and compare its speed with the body's. Zero is a planted foot.
   * One is a mannequin being slid along the pavement.
   *
   * Only bodies that are actually travelling are counted; a walker paused at a
   * shop window has a stationary body, a stationary stance foot and a ratio of
   * nothing over nothing.
   */
  // Read straight off the world matrices `CrowdRenderer.sync` has just
  // refreshed, rather than through `getWorldPosition`, so watching a hundred
  // feet allocates nothing and cannot itself perturb the frame it measures.
  const place = (node) => node.matrixWorld.elements.slice(12, 15)
  const planar = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
  const watched = []
  for (const walker of crowd?.walkers ?? []) {
    if (!driven(walker)) continue
    const rig = walker.rig
    if (!rig?.leftFoot || !rig?.rightFoot) continue
    watched.push({
      walker,
      seed: round(walker.seed),
      left: place(rig.leftFoot),
      right: place(rig.rightFoot),
      body: place(walker.root),
      slip: 0,
      travel: 0,
      worst: 0,
      frames: 0,
    })
  }
  for (let frame = 0; frame < settings.watch; frame += 1) {
    window.__clock.tick(1)
    for (const entry of watched) {
      // A walker that walks out of animation range mid-watch has its legs
      // stopped while its body carries on, which reads as a foot dragging the
      // whole of the travel and is the deliberate cost bound rather than a
      // gait fault. Measured as one it put a slip of 1.11 in the first run.
      if (!driven(entry.walker)) { entry.left = null; continue }
      const rig = entry.walker.rig
      const left = place(rig.leftFoot)
      const right = place(rig.rightFoot)
      const body = place(entry.walker.root)
      if (!entry.left) { entry.left = left; entry.right = right; entry.body = body; continue }
      const travel = planar(body, entry.body)
      // The stance foot is whichever moved less over the world this frame.
      const stance = Math.min(planar(left, entry.left), planar(right, entry.right))
      entry.left = left
      entry.right = right
      entry.body = body
      // A body standing still tells nothing about whether a stride matches it.
      if (travel > 1e-4) {
        entry.slip += stance
        entry.travel += travel
        entry.worst = Math.max(entry.worst, stance / travel)
        entry.frames += 1
      }
    }
  }
  const slips = watched
    .filter((entry) => entry.frames > 20 && entry.travel > 0)
    .map((entry) => ({ seed: entry.seed, slip: round(entry.slip / entry.travel), worst: round(entry.worst), frames: entry.frames }))

  const spread = (field) => {
    const values = rows.map((row) => row[field]).sort((a, b) => a - b)
    if (!values.length) return null
    const at = (fraction) => values[Math.min(values.length - 1, Math.floor(fraction * values.length))]
    return {
      min: round(values[0]),
      median: round(at(.5)),
      max: round(values[values.length - 1]),
      mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    }
  }

  const slipSpread = () => {
    const values = slips.map((entry) => entry.slip).sort((a, b) => a - b)
    if (!values.length) return null
    return {
      min: round(values[0]),
      median: round(values[Math.floor(values.length / 2)]),
      max: round(values[values.length - 1]),
      mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
      bodies: values.length,
    }
  }

  return {
    region: scene.region,
    band: settings.band,
    walkers: rows.length,
    // How many are pinned against the rate ceiling, which is the failure this
    // probe exists to name: at the ceiling the clip is as fast as it is allowed
    // to go and the body is still outrunning it.
    clamped: rows.filter((row) => row.ratio >= 2.2).length,
    floored: rows.filter((row) => row.ratio <= .35).length,
    cruise: spread('cruise'),
    natural: spread('natural'),
    ratio: spread('ratio'),
    cadence: spread('cadence'),
    heights: spread('heights'),
    slip: slipSpread(),
    slips,
    rows: rows.slice(0, 12),
  }
}

const report = { at: new Date().toISOString(), scales: SCALES, bands: BANDS, settle: SETTLE, watch: WATCH, regions: {} }
const { browser, page, errors } = await open()
try {
  const rigHeight = await page.evaluate(async () => {
    const counsel = await import('/src/art/stylized-counsel.ts')
    return counsel.COUNSEL_RIG_HEIGHT
  })
  report.rigHeight = rigHeight
  for (const key of REGIONS) {
    const arms = {}
    for (const scale of SCALES) {
      for (const band of BANDS) {
        await page.evaluate((value) => { window.__mapCrowdScale = value }, scale)
        await region(page, TABS[key], { key, warmup: 300 })
        const arm = await page.evaluate(survey, {
          settle: SETTLE, watch: WATCH, rigHeight, band, scale, reference: REFERENCE,
        })
        arms[`${scale} ${band}`] = arm
        console.log(`\n${key} @ ${scale}, ${band} band: ${arm.walkers} walkers animating`
          + (arm.clamped ? `, ${arm.clamped} pinned at the rate ceiling` : '')
          + (arm.floored ? `, ${arm.floored} at the floor` : ''))
        if (!arm.ratio) { console.log('  no walkers in animation range'); continue }
        console.log(`  cruise    ${arm.cruise.min}–${arm.cruise.max} world u/s (median ${arm.cruise.median})`)
        console.log(`  natural   ${arm.natural.min}–${arm.natural.max} world u/s (median ${arm.natural.median})`)
        console.log(`  ratio     ${arm.ratio.min}–${arm.ratio.max} × authored rate (median ${arm.ratio.median})`)
        console.log(`  cadence   ${arm.cadence.min}–${arm.cadence.max} steps/s (median ${arm.cadence.median})`
          + `  [a person walks at ${HUMAN_STEPS_PER_SECOND}]`)
        console.log(`  heights   ${arm.heights.min}–${arm.heights.max} body-heights/s (median ${arm.heights.median})`
          + `  [a person is ${HUMAN_HEIGHTS_PER_SECOND}]`)
        if (arm.slip) {
          console.log(`  foot slip ${arm.slip.min}–${arm.slip.max} of travel (median ${arm.slip.median})`
            + ` over ${arm.slip.bodies} bodies  [0 is a planted foot]`)
        }
      }
    }
    report.regions[key] = arms
  }
} finally {
  report.errors = errors.slice(0, 10)
  save(`${OUT}/pace.json`, report)
  await browser.close().catch(() => {})
}
console.log(`\nwrote ${OUT}/pace.json`)
