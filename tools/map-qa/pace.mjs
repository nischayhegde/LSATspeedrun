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
 *   heights   cruise / drawn body height, in body-heights per second. A person
 *             walking at 1.4 m/s and 1.7 m tall is .82 of these, which is the
 *             only external number in this file.
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

/** A person's comfortable walk: 1.4 m/s over a 1.7 m frame. */
const HUMAN_HEIGHTS_PER_SECOND = .82

function survey(settings) {
  const scene = window.__mapScene
  const crowd = scene.crowd
  scene.renderer.render = () => {}

  // The gait is only updated for walkers inside `animateWithin`, and the camera
  // decides who that is. Ticking here rather than at the caller keeps the pull
  // and the read in one page call, so nothing real happens between them.
  window.__clock.tick(settings.settle)

  const round = (value) => +Number(value ?? 0).toFixed(4)
  const rows = []
  for (const walker of crowd?.walkers ?? []) {
    if (!walker.active || walker.phase !== 'run') continue
    const humanoid = walker.humanoid
    if (!humanoid) continue
    // The actor refreshes `worldScale` inside `update`, and `naturalWalkSpeed`
    // reads it, so an inactive or just-spawned body reports a natural speed for
    // whatever scale it last drew at. Only bodies the crowd has been animating.
    const natural = humanoid.naturalWalkSpeed
    if (!(natural > 0)) continue
    const drawn = walker.baseScale * settings.rigHeight
    const walk = humanoid.action?.('walk') ?? null
    rows.push({
      seed: round(walker.seed),
      cruise: round(walker.cruise),
      speed: round(walker.speed),
      natural: round(natural),
      ratio: round(walker.cruise / natural),
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

  return {
    region: scene.region,
    walkers: rows.length,
    // How many are pinned against the rate ceiling, which is the failure this
    // probe exists to name: at the ceiling the clip is as fast as it is allowed
    // to go and the body is still outrunning it.
    clamped: rows.filter((row) => row.ratio >= 2.2).length,
    floored: rows.filter((row) => row.ratio <= .35).length,
    cruise: spread('cruise'),
    natural: spread('natural'),
    ratio: spread('ratio'),
    heights: spread('heights'),
    rows: rows.slice(0, 12),
  }
}

const report = { at: new Date().toISOString(), scales: SCALES, settle: SETTLE, regions: {} }
const { browser, page, errors } = await open()
try {
  const rigHeight = await page.evaluate(async () => {
    const module = await import('/src/art/stylized-counsel.ts')
    return module.COUNSEL_RIG_HEIGHT
  })
  report.rigHeight = rigHeight
  for (const key of REGIONS) {
    const arms = {}
    for (const scale of SCALES) {
      await page.evaluate((value) => { window.__mapCrowdScale = value }, scale)
      await region(page, TABS[key], { key, warmup: 300 })
      arms[scale] = await page.evaluate(survey, { settle: SETTLE, rigHeight })
      const arm = arms[scale]
      console.log(`\n${key} @ ${scale}: ${arm.walkers} walkers animating`
        + (arm.clamped ? `, ${arm.clamped} pinned at the rate ceiling` : '')
        + (arm.floored ? `, ${arm.floored} at the floor` : ''))
      if (!arm.ratio) { console.log('  no walkers in animation range'); continue }
      console.log(`  cruise    ${arm.cruise.min}–${arm.cruise.max} world u/s (median ${arm.cruise.median})`)
      console.log(`  natural   ${arm.natural.min}–${arm.natural.max} world u/s (median ${arm.natural.median})`)
      console.log(`  ratio     ${arm.ratio.min}–${arm.ratio.max} × authored rate (median ${arm.ratio.median})`)
      console.log(`  heights   ${arm.heights.min}–${arm.heights.max} body-heights/s (median ${arm.heights.median})`
        + `  [a person is ${HUMAN_HEIGHTS_PER_SECOND}]`)
    }
    report.regions[key] = arms
  }
} finally {
  report.errors = errors.slice(0, 10)
  save(`${OUT}/pace.json`, report)
  await browser.close().catch(() => {})
}
console.log(`\nwrote ${OUT}/pace.json`)
