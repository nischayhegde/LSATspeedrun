// Which object is the walker standing in?
//
// `collide.mjs` rasterises the district into a grid, which is the right shape
// for "how often" and throws away the one thing needed for "why": the identity
// of the thing being stood in. Its worst-site list can only say that something
// 2.89 tall at (-12,-7) had people in it for 229 frames.
//
// This keeps every solid as a named box instead. Slower, and it only has to run
// when a number needs explaining rather than on every arm.
//
// The measurement itself lives in `metrics.mjs`, because `beam-arm.mjs` needs
// the same one and a second copy of it produced a share of 1.0 on a district
// that measures .2330. See that file's header.
import { open, region, save, TABS, OUT } from './lib.mjs'
import { insideMetric, INSIDE_SETTINGS } from './metrics.mjs'

const tag = process.argv[2] ?? 'inside'
const keys = process.argv.slice(3).filter((argument) => !argument.startsWith('--'))
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)
const dir = `${OUT}/inside-${tag}`

const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(insideMetric, { frames: FRAMES, ...INSIDE_SETTINGS })
    console.log(`\n=== ${key} === solids ${report[key].solids} (facade ${report[key].facades}) share ${report[key].share}`)
    console.log(`  entry ${JSON.stringify(report[key].entry)}`)
    for (const row of report[key].worst) {
      console.log(`  ${String(row.frames).padStart(5)}  ${row.what.padEnd(22)} ${row.box}  depth ${row.depth}  near ${row.near}`)
    }
    report._errors = errors.slice(0, 10)
    save(`${dir}/report.json`, report)
  }
} finally {
  await browser.close().catch(() => {})
}
