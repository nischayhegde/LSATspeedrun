/**
 * Where the firm's connections ended up standing.
 *
 * A connection used to exist only as a crest on the office wall. It now has a
 * contact somewhere in the region whose districts it opens, sited by the same
 * `siteOnPlan` the headquarters and compounds use, and that siting can fail:
 * a network whose districts the planner never laid out has nowhere to stand,
 * and one whose landmark is boxed in by pavement on every side would be
 * reported stuck rather than moved somewhere silly.
 *
 * Also reports what the account actually owns, because a run against a fresh
 * profile places nothing and would otherwise read as a broken feature.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'contacts'
const keys = process.argv.slice(3)
const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(() => {
      const data = window.__mapScene.world.userData
      const siting = (data.landmarkSiting ?? []).filter((row) => row.label.startsWith('contact-'))
      return {
        placed: siting.length,
        cleared: siting.filter((row) => row.cleared).length,
        rows: siting.map((row) => `${row.label} ${row.cleared ? row.moved.toFixed(2) : 'STUCK'} @ ${row.x.toFixed(2)},${row.z.toFixed(2)}`),
      }
    })
    console.log(`\n=== ${key} ===`, JSON.stringify(report[key], null, 1))
  }
  report._owned = await page.evaluate(async () => {
    const response = await fetch('/v1/game', { headers: { accept: 'application/json' } })
    if (!response.ok) return { error: response.status }
    const body = await response.json()
    const game = body.game ?? body
    return {
      connections: (game.catalog?.assets ?? [])
        .filter((asset) => asset.type === 'connection')
        .map((asset) => `${asset.key}${asset.owned ? ' OWNED' : ''}`),
      districtsHeld: (game.territory?.districts ?? []).filter((district) => district.owned).map((district) => district.key),
    }
  })
  console.log('\n=== account ===', JSON.stringify(report._owned, null, 1))
  report._errors = errors.slice(0, 10)
  save(`${OUT}/contacts-${tag}/report.json`, report)
} finally {
  await browser.close().catch(() => {})
}
