/**
 * The walker beam, arm and control in one server lifetime.
 *
 * `WALKER_HALF_BEAM` decides how much ground every setback in every plan
 * reserves for a person, so it cannot be A/B'd by editing the file: the two
 * arms would land in two server lifetimes, and the whole reason this map's
 * numbers were untrustworthy for a week is that two lifetimes are two different
 * worlds. The scene reads the figure through `walkerHalfBeam()`, which in
 * development prefers `window.__mapWalkerBeam`, and `region()` rebuilds a
 * district on demand — so both arms are built from the same code, in the same
 * page, against the same crowd, minutes apart.
 *
 * Both metrics come from `metrics.mjs`, which is `inside.mjs`'s and
 * `stranded.mjs`'s own code rather than a copy of it. The first version of this
 * probe did copy them, and the copy was wrong in a way that looked entirely
 * plausible: it tested a walker's root position against whole bounding boxes
 * instead of the per-triangle boxes a static batch has to be broken into, and
 * against a solid's full height instead of the band a body occupies. It
 * reported The Circuit at a share of 1.000 and the Old Quarter at .3369 against
 * a known 0. Numbers that stable are the dangerous kind.
 *
 * They are reported together, always: taking ground away from the plan is
 * exactly what disconnects a network, and a walker who cannot move is inside
 * nothing at all and scores as a success on containment alone.
 *
 * Usage: node tools/map-qa/beam-arm.mjs <tag> <beam,beam,…> [region…]
 *   e.g. node tools/map-qa/beam-arm.mjs beam .16,.25 city nation continent
 */
import { open, region, save, TABS, OUT } from './lib.mjs'
import { insideMetric, strandedMetric, INSIDE_SETTINGS } from './metrics.mjs'

const tag = process.argv[2] ?? 'beam'
const beams = (process.argv[3] ?? '.16,.25').split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)
const keys = process.argv.slice(4).filter((argument) => TABS[argument])
const REGIONS = keys.length ? keys : ['city', 'nation', 'continent']
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)
const PARK_FRAMES = Number(process.env.MAPS_PARK_FRAMES ?? 900)

const report = { tag, beams, frames: FRAMES, at: new Date().toISOString(), arms: {} }
const { browser, page, errors } = await open()
try {
  for (const beam of beams) {
    report.arms[beam] = {}
    for (const key of REGIONS) {
      // Set before the rebuild, because the plan is built from it. A district
      // already on screen was planned with the previous value, which is why
      // `region()` is asked for a cold build rather than reused.
      await page.evaluate((value) => { window.__mapWalkerBeam = value }, beam)
      await region(page, TABS[key], { key })
      const applied = await page.evaluate(() => window.__mapWalkerBeam)
      if (applied !== beam) throw new Error(`beam override did not stick: asked ${beam}, page has ${applied}`)
      const inside = await page.evaluate(insideMetric, { frames: FRAMES, ...INSIDE_SETTINGS })
      const parked = await page.evaluate(strandedMetric, { frames: PARK_FRAMES })
      report.arms[beam][key] = { applied, inside, parked }
      console.log(
        `\n=== ${key} beam ${beam} === share ${inside.share} (${inside.hits}/${inside.samples})`,
        `body r${inside.body.radius} solids ${inside.solids} (facade ${inside.facades})`,
      )
      console.log(`    entry ${JSON.stringify(inside.entry)}`)
      console.log(
        `    ways ${parked.ways} (${parked.wayLength} m, ${parked.zeroWidthWays} with no width)`,
        `parked ${parked.parked}/${parked.tracked} (${parked.parkedShare})`,
        `travelled median ${parked.travelledMedian} min ${parked.travelledMin}`,
      )
      for (const row of inside.worst.slice(0, 6)) {
        console.log(`    ${String(row.frames).padStart(5)}  ${row.what.padEnd(22)} ${row.box}  depth ${row.depth}  near ${row.near}`)
      }
      report.errors = errors.slice(0, 10)
      save(`${OUT}/beam-${tag}.json`, report)
    }
  }
} finally {
  report.errors = errors.slice(0, 10)
  save(`${OUT}/beam-${tag}.json`, report)
  await browser.close().catch(() => {})
}
console.log(`\nwrote ${OUT}/beam-${tag}.json`)
