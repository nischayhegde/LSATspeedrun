/**
 * Why a car drove into somebody.
 *
 * `collide.mjs` counts bodies inside a vehicle. It cannot say whose fault it
 * was, and the answer matters: a crossing the crowd never told the traffic
 * about, a gap the crowd misjudged, and a car that was told in time and could
 * not stop are three different repairs.
 *
 * Two passes, and the first one is the important one because it does not run
 * the simulation at all.
 *
 * `audit`   — build-time only. Every crossing the crowd derived, with its
 *             conflict list, and an independent re-derivation of whether that
 *             link actually lies over a carriageway. A link that crosses a road
 *             and carries no conflict is unmanaged: `gapIsSafe` returns true for
 *             an empty conflict list and `claimRoadway` returns without marking,
 *             so the walker steps off blind and no vehicle ever hears about it.
 *             Deterministic, so it can be compared between arms without the
 *             replicate discipline the frame counts need.
 *
 * `watch`    — runs frames and, on any frame where a body is contained by a
 *             vehicle hull, records both sides: the walker's crossing state and
 *             the vehicle's, plus whether the crowd had marked the lane the
 *             vehicle was on. `markPedestrian` is wrapped rather than inferred,
 *             because "the crowd claimed this lane" is the one fact that
 *             separates a wiring fault from a braking one, and the claim array
 *             is cleared at the end of every `update`.
 */
import { open, region, save, TABS } from './lib.mjs'

const tag = process.argv[2] ?? 'probe'
const keys = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const REGIONS = keys.length ? keys : ['city', 'nation', 'continent']
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)
const dir = `/Users/alan/LSATspeedrun/.maps/yield-${tag}`

function probe(settings) {
  const { frames } = settings
  const scene = window.__mapScene
  const THREE = window.__mapThree
  const original = scene.renderer.render.bind(scene.renderer)
  scene.renderer.render = () => {}
  const crowd = scene.crowd
  const graph = scene.roadGraph
  const sims = scene.trafficSims ?? []
  if (!crowd || !graph) return { failed: 'no crowd or no road graph' }

  const round = (value, places = 2) => +Number(value).toFixed(places)

  // ------------------------------------------------------------------ audit
  //
  // Re-derived here rather than read off the crowd, so this is a check on
  // `resolveConflicts` and not a restatement of it. A link is over a
  // carriageway if any sample along it lies within that edge's half width;
  // the same question `resolveConflicts` asks, asked independently.
  const overCarriageway = (a, b) => {
    const hits = []
    for (const edgeIndex of graph.edgesByKind.road) {
      const edge = graph.edges[edgeIndex]
      if (edge.twin >= 0 && edge.twin < edgeIndex) continue
      const from = graph.nodes[edge.from]
      const reach = edge.width / 2
      const steps = 24
      for (let sample = 0; sample <= steps; sample += 1) {
        const t = sample / steps
        const px = a.x + (b.x - a.x) * t
        const pz = a.z + (b.z - a.z) * t
        const along = (px - from.x) * edge.dx + (pz - from.z) * edge.dz
        if (along < 0 || along > edge.length) continue
        if (Math.abs((px - from.x) * edge.dz - (pz - from.z) * edge.dx) > reach) continue
        hits.push({ edge: edgeIndex, at: t, along: round(along) })
        break
      }
    }
    return hits
  }

  /**
   * How far a point is inside the nearest carriageway, or -Infinity if it is
   * outside every one. Positive means a body standing there is in the road.
   */
  const insideCarriageway = (x, z) => {
    let deepest = Number.NEGATIVE_INFINITY
    let which = -1
    for (const edgeIndex of graph.edgesByKind.road) {
      const edge = graph.edges[edgeIndex]
      if (edge.twin >= 0 && edge.twin < edgeIndex) continue
      const from = graph.nodes[edge.from]
      const along = (x - from.x) * edge.dx + (z - from.z) * edge.dz
      if (along < 0 || along > edge.length) continue
      const across = Math.abs((x - from.x) * edge.dz - (z - from.z) * edge.dx)
      const depth = edge.width / 2 - across
      if (depth > deepest) { deepest = depth; which = edgeIndex }
    }
    return { depth: deepest, edge: which }
  }

  const crossings = crowd.crossings ?? []
  const conflicts = crowd.conflicts ?? []
  const audit = {
    crossings: crossings.length,
    kerbside: 0,
    withConflicts: 0,
    unmanaged: [],
    unmanagedCount: 0,
    // A crossing whose conflict list is shorter than the number of carriageways
    // it actually lies over: partly managed, which reads as yielding right up to
    // the lane nobody watches.
    partial: [],
    partialCount: 0,
    approachlessCount: 0,
    /*
     * The one that matters. A walker in `wait` phase stands on the crossing's own
     * endpoint for as long as it takes to find a gap, and `claimRoadway` is only
     * called once it is going — so an endpoint inside a carriageway is a body
     * parked in a live lane that no vehicle is ever told about. It is not a
     * yielding failure at all; the car is driving down its own lane past a kerb
     * that is in it.
     */
    kerbInLane: [],
    kerbInLaneCount: 0,
    /*
     * The same test against the body rather than against the point. A kerb
     * fifteen centimetres outside the kerb line still puts most of a walker's
     * shoulders over it, and the containment test that counts these frames is
     * about the body.
     */
    kerbBodyInLaneCount: 0,
    /*
     * The same fault stated in the crowd's own numbers: a conflict at `at` near
     * zero or one sits at the crossing's endpoint rather than between the kerbs.
     */
    conflictAtEnd: 0,
  }
  for (let link = 0; link < crossings.length; link += 1) {
    const crossing = crossings[link]
    if (crossing.kerbside) audit.kerbside += 1
    const found = conflicts[link] ?? []
    if (found.length) audit.withConflicts += 1
    for (const conflict of found) {
      if (!conflict.approaches || !conflict.approaches.length) audit.approachlessCount += 1
    }
    const a = { x: crossing.fromX, z: crossing.fromZ }
    const b = { x: crossing.toX, z: crossing.toZ }
    if (crossing.length < 1e-4) continue
    const real = overCarriageway(a, b)
    const entry = {
      link,
      kerbside: Boolean(crossing.kerbside),
      from: [round(a.x), round(a.z)],
      to: [round(b.x), round(b.z)],
      length: round(crossing.length),
      conflicts: found.length,
      lanes: real.length,
      lanesAt: real.map((hit) => hit.edge),
      conflictsAt: found.map((conflict) => conflict.edge),
    }
    if (real.length && !found.length) {
      audit.unmanagedCount += 1
      if (audit.unmanaged.length < 20) audit.unmanaged.push(entry)
    } else if (real.length > found.length) {
      audit.partialCount += 1
      if (audit.partial.length < 20) audit.partial.push(entry)
    }
    for (const conflict of found) {
      if (conflict.at < .15 || conflict.at > .85) { audit.conflictAtEnd += 1; break }
    }
    // Only the start: a walker only ever stands still at the end it sets off
    // from, and every crossing exists in both directions.
    const kerb = insideCarriageway(a.x, a.z)
    if (kerb.depth > -settings.body) audit.kerbBodyInLaneCount += 1
    if (kerb.depth > 0) {
      audit.kerbInLaneCount += 1
      if (audit.kerbInLane.length < 24) {
        audit.kerbInLane.push({ ...entry, inside: round(kerb.depth, 3), lane: kerb.edge })
      }
    }
  }
  audit.kerbInLane.sort((a, b) => b.inside - a.inside)

  /*
   * Pavement, not crossings.
   *
   * A walker only claims a lane while it is crossing one. Standing on a pavement
   * it never claims anything, so a stretch of pavement whose walkable band lies
   * inside a carriageway is a place where a body sits in a live lane for as long
   * as it likes with nothing on either side aware of it — and no amount of
   * yielding logic can help, because nothing is asking. Sampled across the band
   * rather than down the centreline, since the band is where people actually
   * stand and it is not centred on the polyline.
   */
  const ways = crowd.ways ?? []
  const pavement = { samples: 0, inLane: 0, bodyInLane: 0, sites: {}, worst: [] }
  for (let index = 0; index < ways.length; index += 1) {
    const way = ways[index]
    const steps = Math.max(2, Math.ceil(way.length / .3))
    const cumulative = way.cumulative
    for (let station = 0; station <= steps; station += 1) {
      const s = (station / steps) * way.length
      let low = 0
      let high = cumulative.length - 1
      while (low < high - 1) {
        const middle = (low + high) >> 1
        if (cumulative[middle] <= s) low = middle
        else high = middle
      }
      const span = cumulative[high] - cumulative[low]
      const local = span > 1e-5 ? (s - cumulative[low]) / span : 0
      const ax = way.points[low * 2]
      const az = way.points[low * 2 + 1]
      const bx = way.points[high * 2]
      const bz = way.points[high * 2 + 1]
      const px = ax + (bx - ax) * local
      const pz = az + (bz - az) * local
      const magnitude = Math.hypot(bx - ax, bz - az) || 1
      // The one across-frame this file uses: the normal `(dz, -dx)`. Getting the
      // sign wrong here would audit the mirror image of the pavement.
      const nx = (bz - az) / magnitude
      const nz = -(bx - ax) / magnitude
      for (const offset of [-way.halfWidth, 0, way.halfWidth]) {
        const across = way.centre + offset
        const x = px + nx * across
        const z = pz + nz * across
        pavement.samples += 1
        const found = insideCarriageway(x, z)
        if (found.depth > -settings.body) pavement.bodyInLane += 1
        if (found.depth <= 0) continue
        pavement.inLane += 1
        const where = `${Math.round(x)},${Math.round(z)}`
        const held = pavement.sites[where]
        if (!held) pavement.sites[where] = { n: 1, deep: round(found.depth, 3), way: index }
        else {
          held.n += 1
          if (found.depth > held.deep) held.deep = round(found.depth, 3)
        }
      }
    }
  }
  pavement.worst = Object.entries(pavement.sites)
    .sort((a, b) => b[1].deep - a[1].deep)
    .slice(0, 10)
    .map(([where, value]) => ({ where, ...value }))
  pavement.siteCount = Object.keys(pavement.sites).length
  delete pavement.sites

  // ------------------------------------------------------------------ watch
  const movers = []
  const localExtent = (root) => {
    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    const inverse = new THREE.Matrix4()
    root.updateWorldMatrix(true, true)
    inverse.copy(root.matrixWorld).invert()
    root.traverse((child) => {
      if (!child.isMesh || !child.geometry) return
      if (child.material?.transparent && child.material?.depthWrite === false) return
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
      const local = child.geometry.boundingBox
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld)
      for (let corner = 0; corner < 8; corner += 1) {
        point.set(
          corner & 1 ? local.max.x : local.min.x,
          corner & 2 ? local.max.y : local.min.y,
          corner & 4 ? local.max.z : local.min.z,
        ).applyMatrix4(matrix)
        box.expandByPoint(point)
      }
    })
    return box
  }
  sims.forEach((sim, simIndex) => {
    sim.agents.forEach((agent, agentIndex) => {
      const box = localExtent(agent.object)
      if (!Number.isFinite(box.min.x)) return
      movers.push({
        object: agent.object,
        agent,
        sim,
        simIndex,
        label: `${sim.kind}-${simIndex}-${agentIndex}`,
        kind: sim.kind,
        cx: (box.min.x + box.max.x) / 2,
        cz: (box.min.z + box.max.z) / 2,
        hx: (box.max.x - box.min.x) / 2,
        hz: (box.max.z - box.min.z) / 2,
      })
    })
  })

  // Whatever the crowd told the traffic this frame, by sim and edge. Wrapped on
  // the instance so the class is untouched and the wrap dies with the page.
  const claims = new Map()
  const restore = []
  sims.forEach((sim, simIndex) => {
    const real = sim.markPedestrian.bind(sim)
    sim.markPedestrian = (edgeIndex, distance) => {
      let byEdge = claims.get(simIndex)
      if (!byEdge) { byEdge = new Map(); claims.set(simIndex, byEdge) }
      const previous = byEdge.get(edgeIndex)
      if (previous === undefined || distance < previous) byEdge.set(edgeIndex, distance)
      // The twin is marked inside the real one, so mirror it here too or a
      // vehicle on the other carriageway reads as unclaimed.
      const edge = graph.edges[edgeIndex]
      if (edge && edge.twin >= 0) {
        const mirrored = edge.length - distance
        const held = byEdge.get(edge.twin)
        if (held === undefined || mirrored < held) byEdge.set(edge.twin, mirrored)
      }
      return real(edgeIndex, distance)
    }
    restore.push(() => { sim.markPedestrian = real })
  })

  // Every step-off decision, so a hit can be traced back to the gap the walker
  // thought it had.
  const prototype = Object.getPrototypeOf(crowd)
  const realGap = prototype.gapIsSafe
  const decisions = new Map()
  /**
   * What the traffic actually looked like at the moment a walker decided to step
   * off. `timeToConflict` reduces a junction to one number and drops the reason,
   * and the reason is the whole question: a conflict point with nothing near it
   * and one with a car stopped a hand's breadth short of it both come back as
   * "clear", and only one of those is a road you can cross.
   */
  const traffic = (conflict) => {
    const seen = []
    for (const approach of conflict.approaches) {
      for (const sim of sims) {
        if (graph.edges[approach.edge].kind !== sim.kind) continue
        for (let other = sim.edgeHead[approach.edge]; other >= 0; other = sim.agentNext[other]) {
          const rival = sim.agents[other]
          if (approach.via >= 0 && rival.nextEdge !== approach.via) continue
          seen.push({
            edge: approach.edge,
            via: approach.via,
            // How far the vehicle still is from the conflict point, in the same
            // terms `timeAlong` computes it.
            approach: round(approach.offset + graph.edges[approach.edge].length - rival.distance, 2),
            speed: round(rival.speed, 3),
            stopAtEnd: Boolean(rival.stopAtEnd),
            yielded: round(rival.yielded, 2),
          })
        }
      }
    }
    return seen.sort((a, b) => Math.abs(a.approach) - Math.abs(b.approach)).slice(0, 4)
  }

  /**
   * Every vehicle physically near the conflict point, whether or not the
   * approach list can see it. The difference between this and `traffic` above is
   * the size of the blind spot: a vehicle in here and not in there is one the
   * walker had no way of knowing about.
   */
  const nearby = (conflict) => {
    const edge = graph.edges[conflict.edge]
    const from = graph.nodes[edge.from]
    const px = from.x + edge.dx * conflict.distance
    const pz = from.z + edge.dz * conflict.distance
    const watched = new Set()
    for (const approach of conflict.approaches) {
      for (let other = 0; other < 1; other += 1) void other
      watched.add(approach.edge)
    }
    const seen = []
    for (const sim of sims) {
      if (sim.kind !== 'road') continue
      for (const agent of sim.agents) {
        if (!agent.active || agent.edge < 0) continue
        const away = Math.hypot(agent.object.position.x - px, agent.object.position.z - pz)
        if (away > 7) continue
        const match = conflict.approaches.find((approach) => approach.edge === agent.edge
          && (approach.via < 0 || agent.nextEdge === approach.via))
        // Which edge's occupancy bucket this vehicle is actually filed under.
        // `timeAlong` only ever walks a bucket, so a vehicle filed under an edge
        // it has already left is looked up as being on that edge.
        let filed = -1
        for (let index = 0; index < sim.edgeHead.length && filed < 0; index += 1) {
          for (let other = sim.edgeHead[index]; other >= 0; other = sim.agentNext[other]) {
            if (sim.agents[other] === agent) { filed = index; break }
          }
        }
        seen.push({
          away: round(away),
          edge: agent.edge,
          nextEdge: agent.nextEdge,
          distance: round(agent.distance, 2),
          remaining: round(graph.edges[agent.edge].length - agent.distance, 2),
          speed: round(agent.speed, 3),
          filed,
          filedStale: filed !== agent.edge,
          // Why the approach list missed it, if it did. `offEdge` means no
          // approach names the edge it is on at all; `viaMismatch` means one does
          // but only for vehicles that have already committed to the turn.
          why: match ? 'watched' : watched.has(agent.edge) ? 'viaMismatch' : 'offEdge',
        })
      }
    }
    return seen.sort((a, b) => a.away - b.away).slice(0, 4)
  }

  crowd.gapIsSafe = function wrapped(walker, link) {
    const verdict = realGap.call(this, walker, link)
    if (verdict) {
      const found = conflicts[link] ?? []
      decisions.set(walker, {
        link,
        conflicts: found.length,
        frame: window.__clock.frames,
        saw: found.map((conflict) => ({
          at: round(conflict.at, 3),
          near: traffic(conflict),
          nearby: nearby(conflict),
        })),
      })
    }
    return verdict
  }
  restore.push(() => { delete crowd.gapIsSafe })

  // The walker body, fixed for the run rather than remeasured per frame: this
  // probe is asking who was at fault, and a threshold that breathes with the
  // crowd's arm poses makes two hits incomparable.
  let radius = .12
  {
    const radii = []
    for (const walker of crowd.walkers ?? []) {
      if (!walker.active) continue
      const root = walker.rig?.root ?? walker.root
      if (!root || !root.visible) continue
      const box = new THREE.Box3().setFromObject(root)
      if (box.isEmpty()) continue
      if (box.max.y - box.min.y < .5) continue
      radii.push(Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2)
    }
    radii.sort((a, b) => a - b)
    if (radii.length) radius = Math.max(.06, radii[radii.length >> 1])
  }

  const skin = .02
  const hits = []
  const sites = {}
  let hitFrames = 0
  const sample = () => {
    let any = false
    for (const mover of movers) {
      const agent = mover.agent
      if (!agent.active || !mover.object.visible) continue
      const object = mover.object
      const scale = object.scale.x
      const angle = object.rotation.y
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const ox = mover.cx * scale
      const oz = mover.cz * scale
      const hullX = object.position.x + ox * cos + oz * sin
      const hullZ = object.position.z - ox * sin + oz * cos
      const halfX = Math.max(0, mover.hx * scale - skin)
      const halfZ = Math.max(0, mover.hz * scale - skin)
      for (let index = 0; index < crowd.walkers.length; index += 1) {
        const walker = crowd.walkers[index]
        if (!walker.active) continue
        const dx = walker.root.position.x - hullX
        const dz = walker.root.position.z - hullZ
        const localX = dx * cos - dz * sin
        const localZ = dx * sin + dz * cos
        const clampedX = Math.min(Math.max(localX, -halfX), halfX)
        const clampedZ = Math.min(Math.max(localZ, -halfZ), halfZ)
        const depth = radius - Math.hypot(localX - clampedX, localZ - clampedZ)
        if (depth <= 0) continue
        any = true
        const where = `${mover.kind}@${Math.round(object.position.x)},${Math.round(object.position.z)}`
        sites[where] = (sites[where] ?? 0) + 1
        if (hits.length >= 240) continue
        const link = walker.crossing >= 0 ? crossings[walker.crossing] : null
        const found = walker.crossing >= 0 ? (conflicts[walker.crossing] ?? []) : []
        const byEdge = claims.get(mover.simIndex)
        const claimedHere = byEdge ? byEdge.get(agent.edge) : undefined
        const decision = decisions.get(walker)
        hits.push({
          frame: window.__clock.frames,
          where,
          depth: round(depth, 3),
          walker: {
            index,
            at: [round(walker.root.position.x), round(walker.root.position.z)],
            crossing: walker.crossing,
            phase: walker.crossPhase,
            progress: round(walker.crossProgress, 3),
            held: round(walker.crossHeld, 2),
            way: walker.way,
            lateral: round(walker.lateral, 3),
          },
          link: link ? {
            kerbside: Boolean(link.kerbside),
            length: round(link.length),
            from: [round(link.fromX), round(link.fromZ)],
            to: [round(link.toX), round(link.toZ)],
            conflicts: found.length,
            at: found.map((conflict) => round(conflict.at, 3)),
            approaches: found.map((conflict) => conflict.approaches.length),
          } : null,
          steppedOffWith: decision ?? null,
          vehicle: {
            kind: mover.kind,
            edge: agent.edge,
            distance: round(agent.distance, 2),
            edgeLength: agent.edge >= 0 ? round(graph.edges[agent.edge].length) : null,
            nextEdge: agent.nextEdge,
            speed: round(agent.speed, 3),
            stopAtEnd: Boolean(agent.stopAtEnd),
            yielded: round(agent.yielded, 2),
          },
          // The decisive field. `undefined` means the crowd never told this sim
          // there was a body on the lane the vehicle was driving down.
          claimedOnThisEdge: claimedHere === undefined ? null : round(claimedHere, 2),
          claimedEdges: byEdge ? [...byEdge.keys()].slice(0, 8) : [],
        })
      }
    }
    if (any) hitFrames += 1
  }

  for (let frame = 0; frame < frames; frame += 1) {
    // Cleared before the tick, so what a hit reads is this frame's claims: the
    // crowd runs inside the tick and the sim wipes the array at the end of it.
    claims.clear()
    window.__clock.tick(1)
    sample()
  }

  for (const undo of restore) undo()
  scene.renderer.render = original

  return {
    region: scene.region,
    frames,
    walkerRadius: round(radius, 4),
    movers: movers.length,
    network: crowd.networkReport ? crowd.networkReport() : null,
    audit,
    pavement,
    hitFrames,
    hitCount: Object.values(sites).reduce((sum, n) => sum + n, 0),
    sites,
    hits,
  }
}

const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of REGIONS) {
    try {
      await region(page, TABS[key], { key })
    } catch (error) {
      report[key] = { failed: String(error).split('\n')[0] }
      save(`${dir}/report.json`, report)
      continue
    }
    // The body used by the two "would a walker's shoulders be in this" tests.
    // Fixed rather than measured, so an audit is comparable between regions and
    // between arms; `collide.mjs` reports the live figure and it sits at .26-.28
    // on every district.
    report[key] = await page.evaluate(probe, { frames: FRAMES, body: .27 })
    const found = report[key]
    console.log(key, JSON.stringify({
      radius: found.walkerRadius,
      hitFrames: found.hitFrames,
      hits: found.hitCount,
      sites: found.sites,
    }))
    console.log('   audit:', JSON.stringify({
      crossings: found.audit?.crossings,
      kerbside: found.audit?.kerbside,
      withConflicts: found.audit?.withConflicts,
      unmanaged: found.audit?.unmanagedCount,
      partial: found.audit?.partialCount,
      approachless: found.audit?.approachlessCount,
      kerbInLane: found.audit?.kerbInLaneCount,
      kerbBodyInLane: found.audit?.kerbBodyInLaneCount,
      conflictAtEnd: found.audit?.conflictAtEnd,
    }))
    console.log('   pavement:', JSON.stringify({
      samples: found.pavement?.samples,
      inLane: found.pavement?.inLane,
      bodyInLane: found.pavement?.bodyInLane,
      share: found.pavement ? +(found.pavement.inLane / Math.max(1, found.pavement.samples)).toFixed(4) : null,
      sites: found.pavement?.siteCount,
      worst: found.pavement?.worst?.slice(0, 6),
    }))
    if (found.audit?.kerbInLane?.length) {
      console.log('   kerbInLane:', JSON.stringify(found.audit.kerbInLane.slice(0, 8)))
    }
    if (found.audit?.unmanaged?.length) {
      console.log('   unmanaged:', JSON.stringify(found.audit.unmanaged.slice(0, 6)))
    }
    if (found.audit?.partial?.length) {
      console.log('   partial:', JSON.stringify(found.audit.partial.slice(0, 6)))
    }
    for (const hit of (found.hits ?? []).slice(0, 6)) console.log('   hit:', JSON.stringify(hit))
    save(`${dir}/report.json`, report)
  }
  report._errors = errors.slice(0, 10)
  save(`${dir}/report.json`, report)
} finally {
  await browser.close().catch(() => {})
}
