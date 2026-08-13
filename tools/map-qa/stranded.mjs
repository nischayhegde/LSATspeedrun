/**
 * Is anybody stuck?
 *
 * Every other pedestrian instrument here answers "where should this walker not
 * be", and a change that constrains the router can improve all of them by the
 * simple expedient of leaving people unable to go anywhere at all. A walker
 * standing still is inside nothing, so `inside.mjs` scores it as a success.
 *
 * This measures the opposite failure. It ticks the clock and watches each
 * walker's own progress: how far it actually travels, whether it is moving at
 * the end of a long window, and how much of the population is parked. The
 * network's own shape is reported alongside — ways, total length and how many
 * of them have no walkable width left — because a route that cannot be walked
 * and a route that has been deleted look identical from inside a walker.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'
import { strandedMetric } from './metrics.mjs'

const tag = process.argv[2] ?? 'stranded'
const keys = process.argv.slice(3).filter((argument) => !argument.startsWith('--'))
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)

const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(strandedMetric, { frames: FRAMES })
    const row = report[key]
    console.log(`=== ${key} === ways ${row.ways} (${row.wayLength} m, ${row.zeroWidthWays} with no width)`
      + ` walkers ${row.tracked}/${row.walkers} parked ${row.parked} (${row.parkedShare})`
      + ` travelled median ${row.travelledMedian} min ${row.travelledMin}`)
  }
  report._errors = errors.slice(0, 10)
  save(`${OUT}/stranded-${tag}/report.json`, report)
} finally {
  await browser.close().catch(() => {})
}
