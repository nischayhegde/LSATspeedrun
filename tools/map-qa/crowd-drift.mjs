/**
 * Do two crowd scales walk the same walk?
 *
 * `crowd-arm.mjs` claims in its own docstring that a render scale cannot change
 * the plan, because it is a scale on a root: the pavement network is built from
 * setbacks and clearances that know nothing about how big the figure is drawn.
 * Its pinned control is supposed to prove that, and after the control's body was
 * pinned in all three dimensions it *still* moved — the Old Quarter read .0183 at
 * .278 and .0291 at .139 with an identical test volume — and The Circuit's
 * stranded walker disappeared. So either the plan does change, or the walk does.
 *
 * This finds out which, and where, by fingerprinting the simulation rather than
 * measuring an outcome. Same page, same lifetime, same synthetic clock: two
 * scales, and at a series of tick counts every active walker's `(way, distance,
 * lateral, x, z)`. Two arms that walk the same walk are identical to the digit at
 * every checkpoint; two that do not have a first checkpoint where they are not,
 * and a first walker that differs, which is a lead rather than a mystery.
 *
 * The network is fingerprinted too — way count, total length, per-way half widths
 * — because "the plan is identical" is the premise the whole comparison rests on
 * and it costs nothing to check rather than assert.
 *
 * Usage: node tools/map-qa/crowd-drift.mjs [region…]
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const keys = process.argv.slice(2).filter((argument) => TABS[argument])
const REGIONS = keys.length ? keys : ['city']
const SCALES = (process.env.MAPS_SCALES ?? '.278,.139').split(',').map(Number)
const CHECKPOINTS = (process.env.MAPS_CHECKPOINTS ?? '0,30,120,300,600').split(',').map(Number)
const NEUTER = process.env.MAPS_NEUTER ?? 'none'

function fingerprint(settings) {
  const scene = window.__mapScene
  const crowd = scene.crowd
  // Parked, like every other probe here: the walk is what is being measured and
  // drawing it costs a second a frame on a software rasteriser.
  scene.renderer.render = () => {}

  const round = (value) => +Number(value ?? 0).toFixed(4)
  const ways = (crowd?.ways ?? []).map((way) => `${round(way.length)}:${round(way.halfWidth)}`)
  const walkers = () => (crowd?.walkers ?? []).map((walker) => {
    const body = walker.rig?.root ?? walker.root
    return {
      seed: round(walker.seed),
      active: Boolean(walker.active),
      way: walker.way,
      distance: round(walker.distance),
      lateral: round(walker.lateral),
      speed: round(walker.speed),
      errand: walker.errand,
      crossPhase: walker.crossPhase,
      x: round(body?.position.x),
      z: round(body?.position.z),
      // The rest of the state, so a divergence names its own mechanism rather
      // than being reported as "the walker is somewhere else now".
      phase: walker.phase,
      ramp: round(walker.ramp),
      life: round(walker.life),
      errandTimer: round(walker.errandTimer),
      companion: walker.companion,
      crossing: walker.crossing,
      crossProgress: round(walker.crossProgress),
      crossTimer: round(walker.crossTimer),
      crossHeld: round(walker.crossHeld),
      crossGlance: round(walker.crossGlance),
      pace: round(walker.pace),
      walking: Boolean(walker.walking),
      heading: round(walker.heading),
      scale: round(body?.scale.x),
    }
  })

  /*
   * The bisect: take the animation out of the loop.
   *
   * `Crowd.update` reads exactly one thing back from the actor that poses the
   * body — `humanoid.isPlayingGesture`, which gates the glance a walker plays
   * while it waits at a kerb — and the actor's own solves are in world units, so
   * a body drawn at half size crosses their thresholds on different frames. If
   * that is the whole coupling, then neutering the actor should make two scales
   * bit-identical; if they still diverge, the coupling is in the simulation and
   * this is the wrong tree.
   */
  if (settings.neuter === 'actor') {
    for (const walker of crowd?.walkers ?? []) {
      const humanoid = walker.humanoid
      if (!humanoid) continue
      humanoid.update = () => {}
      humanoid.playGesture = () => {}
      Object.defineProperty(humanoid, 'isPlayingGesture', { configurable: true, get: () => false })
    }
  }

  const frames = []
  let ticked = 0
  for (const checkpoint of settings.checkpoints) {
    if (checkpoint > ticked) {
      window.__clock.tick(checkpoint - ticked)
      ticked = checkpoint
    }
    frames.push({ at: checkpoint, elapsed: crowd?.elapsed ?? null, walkers: walkers() })
  }

  /*
   * How much figure is standing about, which is the first suspect for a
   * scale-dependent walk: the contacts and the rival guards are bodies drawn at
   * the same scale as the crowd, and `insideMetric` excludes the *crowd's*
   * batches from its solid set but has no reason to know about theirs. If they
   * are in the set, then the test body is being tested against a set of solids
   * that changes size with the arm.
   */
  let standing = 0
  let standingGroups = 0
  scene.world.traverse((child) => {
    if (!child.isInstancedMesh) return
    if (child.parent === scene.crowdRenderer?.group) return
    // A body's parts are shared geometry from `stylized-counsel`'s cache, which
    // tags itself; that is what tells a batched person from a batched bollard.
    if (!child.userData?.characterShared && !child.geometry?.userData?.characterShared) return
    standingGroups += 1
    standing += child.count
  })

  return {
    region: scene.region,
    ways: { count: ways.length, digest: ways.join('|').length, total: +ways.reduce((sum, entry) => sum + Number(entry.split(':')[0]), 0).toFixed(2) },
    standing: { groups: standingGroups, instances: standing },
    frames,
  }
}

const report = { at: new Date().toISOString(), scales: SCALES, checkpoints: CHECKPOINTS, neuter: NEUTER, regions: {} }
const { browser, page, errors } = await open()
try {
  for (const key of REGIONS) {
    const arms = {}
    for (const scale of SCALES) {
      await page.evaluate((value) => { window.__mapCrowdScale = value }, scale)
      // A short warmup, so the crowd has spawned but the arms have had as little
      // opportunity to drift as possible before the first checkpoint.
      await region(page, TABS[key], { key, warmup: 60 })
      arms[scale] = await page.evaluate(fingerprint, { checkpoints: CHECKPOINTS, neuter: NEUTER })
      console.log(`${key} ${scale}: ways ${arms[scale].ways.count} (${arms[scale].ways.total} m)`
        + ` · standing bodies ${arms[scale].standing.instances} in ${arms[scale].standing.groups} batches`)
    }
    report.regions[key] = arms

    const [first, ...rest] = SCALES
    for (const scale of rest) {
      const a = arms[first]
      const b = arms[scale]
      console.log(`\n=== ${key}: ${first} vs ${scale} ===`)
      console.log(`  network  ${a.ways.count}/${a.ways.total} vs ${b.ways.count}/${b.ways.total}`
        + `  ${a.ways.digest === b.ways.digest && a.ways.total === b.ways.total ? 'identical' : 'DIFFERENT'}`)
      console.log(`  standing ${a.standing.instances} vs ${b.standing.instances}`)
      let announced = false
      for (let index = 0; index < a.frames.length; index += 1) {
        const left = a.frames[index]
        const right = b.frames[index]
        const differences = []
        for (let walker = 0; walker < Math.max(left.walkers.length, right.walkers.length); walker += 1) {
          const one = left.walkers[walker]
          const two = right.walkers[walker]
          if (!one || !two) { differences.push(`#${walker} present in one arm only`); continue }
          const fields = [
            'active', 'phase', 'ramp', 'way', 'distance', 'lateral', 'speed', 'pace', 'errand', 'errandTimer',
            'companion', 'crossing', 'crossPhase', 'crossProgress', 'crossTimer', 'crossHeld', 'crossGlance',
            'life', 'walking', 'heading', 'x', 'z', 'scale',
          ]
          for (const field of fields) {
            // The one field that is *supposed* to differ: the arm is a scale on
            // the root, and the fade ramps towards it.
            if (field === 'scale') continue
            if (one[field] !== two[field]) differences.push(`#${walker} seed ${one.seed} ${field} ${one[field]} vs ${two[field]}`)
          }
        }
        const tag = `  tick ${String(left.at).padStart(4)} (elapsed ${left.elapsed} vs ${right.elapsed})`
        if (!differences.length) console.log(`${tag}  identical`)
        else {
          console.log(`${tag}  ${differences.length} differences${announced ? '' : ' ← first divergence'}`)
          for (const line of differences.slice(0, 6)) console.log(`      ${line}`)
          announced = true
        }
      }
    }
  }
} finally {
  report.errors = errors.slice(0, 10)
  save(`${OUT}/crowd-drift.json`, report)
  await browser.close().catch(() => {})
}
console.log(`\nwrote ${OUT}/crowd-drift.json`)
