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
    report[key] = await page.evaluate(() => {
      const data = window.__mapScene.world.userData
      const trees = []
      window.__mapScene.world.traverse((child) => {
        if (child.userData?.treesOffPavement) trees.push(child.userData.treesOffPavement)
      })
      // `siteOnPlan`'s log: one row per tier office and rival compound, saying
      // whether the plan had free ground for it and how far it had to look.
      const siting = (data.landmarkSiting ?? [])
      return {
        siting: {
          parcels: siting.length,
          onAsked: siting.filter((row) => row.cleared && row.moved === 0).length,
          resited: siting.filter((row) => row.cleared && row.moved > 0).length,
          stuck: siting.filter((row) => !row.cleared).map((row) => row.label),
          furthest: siting.reduce((most, row) => Math.max(most, row.moved), 0),
          rows: siting.map((row) => [
            row.label,
            row.cleared ? row.moved.toFixed(2) : 'STUCK',
            `@ ${row.x.toFixed(2)},${row.z.toFixed(2)}`,
            // What it is standing in, and how far into it, when it is stuck.
            row.cleared ? '' : `on ${row.blockedBy} by ${row.depth}`,
          ].join(' ')),
        },
        authored: data.authoredClearance ?? null,
        trees: trees.reduce(
          (total, row) => ({
            considered: total.considered + row.considered,
            moved: total.moved + row.moved,
            felled: total.felled + row.felled,
          }),
          { considered: 0, moved: 0, felled: 0 },
        ),
        treeFields: trees.length,
      }
    })
    console.log(`\n=== ${key} ===`, JSON.stringify(report[key], null, 1))
  }
  report._errors = errors.slice(0, 10)
  save(`${OUT}/authored-${tag}/report.json`, report)
} finally {
  await browser.close().catch(() => {})
}
