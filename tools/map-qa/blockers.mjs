/**
 * What is standing between an authored parcel and the ground it asked for.
 *
 * `authored.mjs` says a parcel is STUCK; `whatis.mjs` says which triangles are
 * over a column. Neither answers the question siting actually failed on, which
 * is which *movement network* records overlap the plinth rectangle — a pavement
 * run and a carriageway are clearance corridors, not geometry, and a parcel can
 * be stuck on ground that is visibly empty.
 *
 * Usage: node tools/map-qa/blockers.mjs <region> [<x,z> ...]
 * With no points it reads the stuck parcels out of the scene's own siting log.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const key = process.argv[2] ?? 'city'
const asked = process.argv.slice(3).map((pair) => {
  const [x, z] = pair.split(',').map(Number)
  return { label: pair, x, z }
})

function look(points) {
  const world = window.__mapScene.world
  const walks = world.userData.footWays ?? []
  const roads = world.userData.roadWays ?? []
  const near = (list, x, z, kind) => {
    const hits = []
    for (const way of list) {
      const half = kind === 'road' ? (way.width ?? 1.7) / 2 : (way.halfWidth ?? 0)
      const pts = way.points
      for (let i = 0; i < pts.length - 1; i += 1) {
        const [ax, az] = pts[i]
        const [bx, bz] = pts[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 1e-4) continue
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)))
        const d = Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t))
        if (d - half < 2.2) {
          hits.push({
            kind: kind === 'road' ? (way.kind ?? 'road') : 'foot',
            gap: Number((d - half).toFixed(2)),
            half: Number(half.toFixed(2)),
            at: [Number((ax + (bx - ax) * t).toFixed(2)), Number((az + (bz - az) * t).toFixed(2))],
            street: way.street ?? null,
          })
        }
      }
    }
    return hits.sort((a, b) => a.gap - b.gap).slice(0, 6)
  }
  return points.map((point) => ({
    label: point.label,
    at: [point.x, point.z],
    blockers: [...near(walks, point.x, point.z, 'foot'), ...near(roads, point.x, point.z, 'road')]
      .sort((a, b) => a.gap - b.gap).slice(0, 8),
  }))
}

const { browser, page, errors } = await open()
try {
  await region(page, TABS[key], { key, warmup: 0 })
  const points = asked.length ? asked : await page.evaluate(() => (window.__mapScene.world.userData.landmarkSiting ?? [])
    .filter((row) => !row.cleared)
    .map((row) => ({ label: row.label, x: row.x, z: row.z })))
  const found = await page.evaluate(look, points)
  for (const row of found) {
    console.log(`\n${row.label} @ ${row.at}`)
    for (const hit of row.blockers) console.log(`   ${hit.kind.padEnd(5)} gap ${String(hit.gap).padStart(6)} half ${hit.half} at ${hit.at} street ${hit.street}`)
  }
  save(`${OUT}/blockers-${key}.json`, { found, errors: errors.slice(0, 5) })
} finally {
  await browser.close().catch(() => {})
}
