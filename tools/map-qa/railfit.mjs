/**
 * Which pavements are laid on the tram tracks.
 *
 * The railway is the one corridor on the map that has to be empty: a transport
 * runs a fixed curve with no perception and no brakes, so a walker on it has
 * nothing to yield to and the crossing logic has no gap to judge. The scene
 * declares that right of way and `cutFootwaysAroundSolids` takes the pavement
 * out of it — but only where a piece has some pavement left afterwards. A piece
 * swallowed whole is deliberately kept rather than abolished, on the evidence
 * that abolishing pavements concentrates the crowd somewhere worse, and the
 * result is a pavement that survives *because* it is entirely on the tracks.
 *
 * That is a siting fault and it does not show up in any of the other probes:
 * the geometry audit sees clear ground, the walker audit sees nobody inside a
 * solid, and only the contact probe sees it, at the far end, as a tram running
 * through a crowd. This reads the plan dump and names it directly.
 *
 * Usage: node tools/map-qa/plan-dump.mjs <region> && node tools/map-qa/railfit.mjs <region>
 */
import { readFileSync } from 'node:fs'

// Deliberately not from `lib.mjs`: this reads a dump off disk and runs no
// browser, and importing the harness would drag playwright in to do it.
const OUT = process.env.MAPS_OUT ?? '.maps'

const keys = process.argv.slice(2)
const REGIONS = keys.length ? keys : ['continent']
/** Half the body, at the scale the crowd is drawn. Matches `WALKER_HALF_BEAM`. */
const BEAM = .16

const nearestOn = (points) => {
  const segments = []
  for (let index = 0; index + 1 < points.length; index += 1) segments.push([points[index], points[index + 1]])
  return (x, z) => {
    let best = Infinity
    for (const [[ax, az], [bx, bz]] of segments) {
      const dx = bx - ax
      const dz = bz - az
      const length = dx * dx + dz * dz || 1e-9
      let t = ((x - ax) * dx + (z - az) * dz) / length
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const distance = Math.hypot(x - (ax + t * dx), z - (az + t * dz))
      if (distance < best) best = distance
    }
    return best
  }
}

for (const key of REGIONS) {
  const plan = JSON.parse(readFileSync(`${OUT}/plan-${key}.json`, 'utf8'))
  const rail = (plan.corridors ?? []).find((corridor) => corridor.label === 'rail')
  if (!rail) {
    console.log(`${key}: no rail corridor declared`)
    continue
  }
  const distance = nearestOn(rail.points)
  const limit = rail.halfWidth
  const rows = []
  let onTrack = 0
  plan.crowdWays.forEach((way, index) => {
    const flat = way.flat
    let inside = 0
    let closest = Infinity
    let at = null
    let length = 0
    for (let k = 0; k + 3 < flat.length; k += 2) {
      const [x0, z0, x1, z1] = [flat[k], flat[k + 1], flat[k + 2], flat[k + 3]]
      const span = Math.hypot(x1 - x0, z1 - z0)
      length += span
      const steps = Math.max(2, Math.ceil(span / .05))
      for (let step = 0; step < steps; step += 1) {
        const t = (step + .5) / steps
        const x = x0 + (x1 - x0) * t
        const z = z0 + (z1 - z0) * t
        // The band, not just the centreline: a walker may use the whole of it.
        const reach = distance(x, z) - Math.min(way.halfWidth, BEAM)
        if (reach < closest) { closest = reach; at = [+x.toFixed(2), +z.toFixed(2)] }
        if (reach < limit) inside += span / steps
      }
    }
    if (inside < .1) return
    onTrack += inside
    rows.push({ way: index, onTrack: +inside.toFixed(2), of: +length.toFixed(2), share: +(inside / Math.max(length, 1e-6)).toFixed(2), closest: +closest.toFixed(2), at })
  })
  rows.sort((a, b) => b.onTrack - a.onTrack)
  const swallowed = rows.filter((row) => row.share > .85)
  console.log(`\n=== ${key} === rail half-width ${limit}; ${rows.length} pavements in the right of way, ${onTrack.toFixed(1)} m of walkable band on it`)
  console.log(`  ${swallowed.length} of them are on it for their whole length, which is the class the cut refuses to abolish`)
  for (const row of rows.slice(0, 12)) {
    console.log(`  way ${String(row.way).padStart(4)}  ${String(row.onTrack).padStart(6)} m of ${String(row.of).padEnd(6)} (${(row.share * 100).toFixed(0)}%)  closest ${row.closest}  at ${row.at}`)
  }
}
