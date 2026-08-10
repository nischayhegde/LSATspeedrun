// Where the authored parcels ended up.
//
// `siteAuthoredParcel` records every tier office and rival compound it had to
// move off the movement network, and by how far. A parcel that travels a long
// way is not a success: it has left the street it was authored against, and the
// crowd still walks to it. That distinction is invisible in the geometry audit
// and is the whole of why the parcel-siting arm regressed.
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'authored'
const keys = process.argv.slice(3)
const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(() => window.__mapScene.world.userData.authoredClearance ?? null)
    console.log(`\n=== ${key} ===`, JSON.stringify(report[key], null, 1))
  }
  report._errors = errors.slice(0, 10)
  save(`${OUT}/authored-${tag}/report.json`, report)
} finally {
  await browser.close().catch(() => {})
}
