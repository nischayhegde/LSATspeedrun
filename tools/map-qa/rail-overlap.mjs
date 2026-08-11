/*
 * Where a pavement lies inside a transport's swept path.
 *
 * Pure geometry, no frames, so it is free of the run-to-run burstiness that
 * makes `bodyInVehicleFrames` unreadable at these magnitudes: a walker only
 * ends up inside a tram when one happens to pass while somebody is standing
 * there, and whether that coincidence occurs in a given 3600 frames is close
 * to a coin toss. Whether the pavement is in the tram's path at all is not.
 *
 * `planFootways` cuts pavements against carriageways only — a rail line is
 * deliberately not a kerb — and the railway right-of-way is cut separately by
 * the scene. This asks whether anything survived both, and reports the walkable
 * *band*, not just the centreline, because a walker takes a lateral offset
 * anywhere inside it.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'rail'
const only = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const keys = only.length ? only : ['city', 'nation', 'continent']

async function measure() {
  const scene = window.__mapScene
  const crowd = scene.crowd
  const transports = scene.transports ?? []
  if (!crowd?.ways) return { error: 'no crowd' }

  // Half-width of the vehicle that runs on each path, from its own hull, so a
  // tram and a launch are judged at their real beams.
  const paths = transports.map((path, index) => {
    const object = path.object
    object.updateWorldMatrix(true, true)
    let halfBeam = .5
    const box = new (window.__mapThree.Box3)()
    box.setFromObject(object)
    if (Number.isFinite(box.min.x)) {
      halfBeam = Math.min(
        Math.max((box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2),
        Math.max(.3, Math.min((box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2)),
      )
    }
    const points = []
    const samples = 400
    for (let i = 0; i <= samples; i += 1) {
      const point = path.curve.getPointAt(i / samples)
      points.push(point.x, point.z)
    }
    return { index, halfBeam: +halfBeam.toFixed(3), points }
  })

  const near = (px, pz, path) => {
    let best = Infinity
    for (let i = 2; i < path.points.length; i += 2) {
      const ax = path.points[i - 2]
      const az = path.points[i - 1]
      const bx = path.points[i]
      const bz = path.points[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const span = dx * dx + dz * dz
      if (span < 1e-9) continue
      let t = ((px - ax) * dx + (pz - az) * dz) / span
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const distance = Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
      if (distance < best) best = distance
    }
    return best
  }

  const findings = []
  crowd.ways.forEach((way, wayIndex) => {
    const count = way.cumulative.length
    for (let vertex = 0; vertex < count; vertex += 1) {
      const x = way.points[vertex * 2]
      const z = way.points[vertex * 2 + 1]
      for (const path of paths) {
        const gap = near(x, z, path)
        // The band, not the line: `centre ± halfWidth` is where walkers stand.
        const reach = Math.abs(way.centre) + way.halfWidth
        const clearance = gap - reach - path.halfBeam
        if (clearance < 0) {
          findings.push({
            way: wayIndex,
            transport: path.index,
            at: [+x.toFixed(2), +z.toFixed(2)],
            centreGap: +gap.toFixed(3),
            halfWidth: +way.halfWidth.toFixed(3),
            centre: +way.centre.toFixed(3),
            beam: path.halfBeam,
            // Negative is overlap: how far the band reaches into the swept path.
            clearance: +clearance.toFixed(3),
            obstructed: Boolean(way.obstructed),
            street: way.street,
          })
        }
      }
    }
  })
  findings.sort((a, b) => a.clearance - b.clearance)
  return {
    region: scene.region,
    ways: crowd.ways.length,
    transports: paths.map((path) => ({ index: path.index, halfBeam: path.halfBeam })),
    overlaps: findings.length,
    waysAffected: new Set(findings.map((f) => f.way)).size,
    worst: findings.slice(0, 12),
  }
}

const report = {}
const { browser, page, errors } = await open()
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(measure)
    console.log(key, JSON.stringify({
      ways: report[key].ways,
      transports: report[key].transports,
      overlaps: report[key].overlaps,
      waysAffected: report[key].waysAffected,
    }))
    for (const item of report[key].worst ?? []) console.log('   ', JSON.stringify(item))
    save(`${OUT}/rail-${tag}/${key}.json`, report[key])
  }
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 3))
  await browser.close().catch(() => {})
}
