/*
 * Is the kerb a walker waits at actually out of the road?
 *
 * A walker holding at a kerb sits at `crossProgress` 0, which is the crossing
 * link's own first endpoint, which is a welded pavement end. Pavement ends on
 * this map are documented as sometimes beginning between the kerbs. Where that
 * is true the walker is not waiting at the roadside, it is waiting in the
 * traffic, and the crossing rules cannot help because the walker is correctly
 * refusing to step off — the danger is where it is standing, not where it is
 * going.
 *
 * Pure geometry against the road graph the crossings were resolved from, so it
 * is deterministic and free of the mode structure that makes the frame counts
 * hard to read. Every endpoint of every link, measured against every
 * carriageway: negative clearance is a kerb inside a lane.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'base'
const only = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const keys = only.length ? only : ['city', 'nation', 'continent']

async function measure() {
  const scene = window.__mapScene
  const crowd = scene.crowd
  const graph = scene.roadGraph
  if (!crowd?.crossings || !graph) return { error: 'no crowd or graph' }

  // Same body the collision harness uses, so "inside a lane" is asked of the
  // disc that actually gets hit rather than of a point.
  let walkerRadius = .12
  {
    const radii = []
    for (const walker of crowd.walkers ?? []) {
      if (!walker.active) continue
      const root = walker.rig?.root ?? walker.root
      if (!root || !root.visible) continue
      const box = new (window.__mapThree.Box3)().setFromObject(root)
      if (box.isEmpty() || box.max.y - box.min.y < .5) continue
      radii.push(Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2)
    }
    if (radii.length) {
      radii.sort((a, b) => a - b)
      walkerRadius = Math.max(.06, radii[radii.length >> 1])
    }
  }

  /*
   * The band the traffic actually sweeps, which is not the carriageway.
   *
   * `TrafficSim` solves a lane offset per edge and, where a two-way street is
   * too narrow to hold two bodies abreast, deliberately prefers an overhang
   * past the kerb to a head-on. So a kerb can be outside the carriageway and
   * still inside the path of the cars on it, and the walkers waiting there are
   * standing where a car will be.
   */
  const sims = scene.trafficSims ?? []
  const roadSim = sims.find((sim) => sim.kind === 'road') ?? sims[0] ?? null
  const laneOf = (edgeIndex) => roadSim?.lane?.[edgeIndex] ?? 0
  let bodyHalf = .3
  if (roadSim?.agents?.length) {
    let widest = 0
    for (const agent of roadSim.agents) {
      const hull = agent.object?.userData?.vehicleHull
      const half = (hull?.halfWidth ?? .3) * (Math.abs(agent.object?.scale?.z) || 1)
      if (half > widest) widest = half
    }
    if (widest > 0) bodyHalf = widest
  }

  const roads = graph.edgesByKind?.road ?? []
  /** Signed clearance from the swept path of the traffic: negative is inside. */
  const sweptClearance = (x, z) => {
    let worst = Number.POSITIVE_INFINITY
    let atEdge = -1
    for (let index = 0; index < roads.length; index += 1) {
      const edgeIndex = roads[index]
      const edge = graph.edges[edgeIndex]
      const from = graph.nodes[edge.from]
      const to = graph.nodes[edge.to]
      const dx = to.x - from.x
      const dz = to.z - from.z
      const span = Math.hypot(dx, dz)
      if (span < 1e-6) continue
      // The lane centre, offset to the driving side of the road centreline.
      const offset = laneOf(edgeIndex)
      const nx = dz / span
      const nz = -dx / span
      const ax = from.x + nx * offset
      const az = from.z + nz * offset
      const bx = to.x + nx * offset
      const bz = to.z + nz * offset
      const rx = bx - ax
      const rz = bz - az
      const length = rx * rx + rz * rz
      if (length < 1e-9) continue
      let t = ((x - ax) * rx + (z - az) * rz) / length
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const gap = Math.hypot(x - (ax + rx * t), z - (az + rz * t))
      const clearance = gap - bodyHalf
      if (clearance < worst) {
        worst = clearance
        atEdge = edgeIndex
      }
    }
    return { clearance: worst, edge: atEdge }
  }
  /** Signed clearance from the nearest carriageway edge: negative is inside. */
  const laneClearance = (x, z) => {
    let worst = Number.POSITIVE_INFINITY
    let atEdge = -1
    for (let index = 0; index < roads.length; index += 1) {
      const edgeIndex = roads[index]
      const edge = graph.edges[edgeIndex]
      if (edge.twin >= 0 && edge.twin < edgeIndex) continue
      const from = graph.nodes[edge.from]
      const to = graph.nodes[edge.to]
      const dx = to.x - from.x
      const dz = to.z - from.z
      const span = dx * dx + dz * dz
      if (span < 1e-9) continue
      let t = ((x - from.x) * dx + (z - from.z) * dz) / span
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const gap = Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t))
      const clearance = gap - edge.width / 2
      if (clearance < worst) {
        worst = clearance
        atEdge = edgeIndex
      }
    }
    return { clearance: worst, edge: atEdge }
  }

  // One entry per distinct endpoint, since a corner carries many links.
  const seen = new Map()
  crowd.crossings.forEach((link, index) => {
    const key = `${link.fromX.toFixed(3)},${link.fromZ.toFixed(3)}`
    if (seen.has(key)) {
      seen.get(key).links += 1
      return
    }
    const found = laneClearance(link.fromX, link.fromZ)
    const swept = sweptClearance(link.fromX, link.fromZ)
    seen.set(key, {
      at: [+link.fromX.toFixed(2), +link.fromZ.toFixed(2)],
      kerbClearance: +found.clearance.toFixed(3),
      // What matters: how much room the waiting body has against a passing car.
      sweptClearance: +swept.clearance.toFixed(3),
      standing: +(swept.clearance - walkerRadius).toFixed(3),
      edge: swept.edge,
      width: found.edge >= 0 ? +graph.edges[found.edge].width.toFixed(3) : -1,
      kerbside: Boolean(link.kerbside),
      conflicts: (crowd.conflicts?.[index] ?? []).length,
      links: 1,
    })
  })

  const endpoints = [...seen.values()]
  // `standing` is the honest one: the gap between the waiting walker's own disc
  // and the side of a car using the lane. Negative means the two overlap and
  // the only thing keeping them apart is that no car happened to come.
  const overlapping = endpoints.filter((point) => point.standing < 0)
  const timed = overlapping.filter((point) => point.conflicts > 0)
  endpoints.sort((a, b) => a.standing - b.standing)
  return {
    region: scene.region,
    walkerRadius: +walkerRadius.toFixed(4),
    vehicleHalfWidth: +bodyHalf.toFixed(3),
    crossings: crowd.crossings.length,
    endpoints: endpoints.length,
    standingInTraffic: overlapping.length,
    standingInTrafficTimed: timed.length,
    worst: endpoints.slice(0, 10),
  }
}

const report = {}
const { browser, page, errors } = await open()
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(measure)
    const value = report[key]
    console.log(key, JSON.stringify({
      crossings: value.crossings,
      endpoints: value.endpoints,
      standingInTraffic: value.standingInTraffic,
      standingInTrafficTimed: value.standingInTrafficTimed,
      walkerRadius: value.walkerRadius,
      vehicleHalfWidth: value.vehicleHalfWidth,
    }))
    for (const point of value.worst ?? []) console.log('   ', JSON.stringify(point))
    save(`${OUT}/kerb-${tag}/${key}.json`, value)
  }
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 3))
  await browser.close().catch(() => {})
}
