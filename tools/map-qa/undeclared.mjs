/**
 * Which of the things standing on a pavement did the routing pass never hear
 * about.
 *
 * `footway-audit.mjs` says how much pavement is inside something solid and
 * `whatis.mjs` says what stands at one queried column. Neither answers the
 * question a generator fix needs, which is whether the blocker was *declared*:
 * `cutFootwaysAroundSolids` only ever sees `crowdObstacles`' props and the
 * `buildingAudit` records, so a blocker absent from both is one the cut could
 * not have removed however well it worked, and a blocker present in both is a
 * cut bug rather than a placement bug. Those are different repairs and the
 * measured share cannot tell them apart.
 *
 * Runs no frames.
 */
import { open, region, save, TABS } from './lib.mjs'

const key = process.argv[2] ?? 'nation'
const LIMIT = Number(process.env.MAPS_LIMIT ?? 24)

function survey(settings) {
  const { floorY, headroom, stride, span } = settings
  const THREE = window.__mapThree
  const scene = window.__mapScene
  const world = scene.world
  const crowd = scene.crowd
  world.updateMatrixWorld(true)

  const excluded = new Set()
  const mark = (root) => root?.traverse((child) => excluded.add(child))
  for (const sim of scene.trafficSims ?? []) for (const agent of sim.agents) mark(agent.object)
  for (const path of scene.transports ?? []) mark(path.object)
  mark(scene.lawyer)
  mark(scene.crowdRenderer?.group)
  mark(scene.rivalGuardRenderer?.group)

  const chain = (object) => {
    const parts = []
    for (let node = object; node && node !== world; node = node.parent) {
      const audit = node.userData?.propAudit?.name
      const radius = node.userData?.footprintRadius
      const at = `${+node.position.x.toFixed(2)},${+node.position.z.toFixed(2)}`
      const name = audit ? `<${audit}>` : (node.name || node.type)
      // `footprintSolid`, not `solid`: the flag `markSolidFootprint` sets and
      // the one `crowdObstacles` filters the routing list on. Reading the
      // shorter name reports every blocker as furniture, which is the wrong
      // diagnosis in the most persuasive possible way.
      const box = node.userData?.footprintBox
      const declared = radius === undefined && !box
        ? ''
        : `{${box ? `hx=${+box.hx.toFixed(2)},hz=${+box.hz.toFixed(2)}` : `r=${+Number(radius).toFixed(2)}`}`
          + `,${node.userData?.footprintSolid ? 'solid' : 'furniture'}}`
      parts.push(`${name}@${at}${declared}`)
    }
    return parts.reverse().join(' / ')
  }

  // The two lists the cut works from, so a blocker can be checked against them.
  const buildings = (world.userData.buildingAudit ?? []).map((record) => ({
    x: record.x, z: record.z, hx: record.width / 2, hz: record.depth / 2,
  }))
  const props = (world.userData.propAudit?.placements ?? [])
  const nearBuilding = (x, z) => {
    let best = Infinity
    for (const record of buildings) {
      const dx = Math.max(0, Math.abs(record.x - x) - record.hx)
      const dz = Math.max(0, Math.abs(record.z - z) - record.hz)
      best = Math.min(best, Math.hypot(dx, dz))
    }
    return best
  }
  const nearProp = (x, z) => {
    let best = Infinity
    let name = null
    for (const prop of props) {
      const dx = Math.max(0, Math.abs(prop.x - x) - prop.width / 2)
      const dz = Math.max(0, Math.abs(prop.z - z) - prop.depth / 2)
      const distance = Math.hypot(dx, dz)
      if (distance < best) { best = distance; name = prop.name }
    }
    return { distance: best, name }
  }

  // Every solid over the district, as a named box, the way the footway audit
  // builds them so the two agree about what counts.
  const solids = []
  const vertex = new THREE.Vector3()
  world.traverse((child) => {
    if (excluded.has(child) || !child.isMesh || !child.geometry) return
    if (child.isSkinnedMesh || child.isInstancedMesh) return
    const data = child.userData ?? {}
    if (
      data.cloud || data.skyUniforms || data.auroraUniforms || data.waterUniforms || data.atmosphere
      || data.mapLabelKind || data.mapLabelAlways || data.mapEmphasisKind || data.destinationMarker
      || data.lawyerBeacon || data.playerMarker || data.lighthouseBeam || data.heldLandmarkAccent
      || data.ambientActor || data.ambientWing || data.planet || data.orbitalRing || data.flagUniforms
    ) return
    if (child.material?.depthWrite === false) return
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
    const local = child.geometry.boundingBox
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = -Infinity
    for (let corner = 0; corner < 8; corner += 1) {
      vertex.set(
        corner & 1 ? local.max.x : local.min.x,
        corner & 2 ? local.max.y : local.min.y,
        corner & 4 ? local.max.z : local.min.z,
      ).applyMatrix4(child.matrixWorld)
      if (vertex.x < minX) minX = vertex.x
      if (vertex.x > maxX) maxX = vertex.x
      if (vertex.z < minZ) minZ = vertex.z
      if (vertex.z > maxZ) maxZ = vertex.z
      if (vertex.y > top) top = vertex.y
    }
    if (top < floorY + headroom) return
    if (minX < -70 || maxX > 70 || minZ < -70 || maxZ > 70) return
    if (maxX - minX > span || maxZ - minZ > span) return
    solids.push({ minX, maxX, minZ, maxZ, top, what: chain(child) })
  })

  // Walk the pavements and charge each blocked step to the box it is inside.
  const tally = new Map()
  let total = 0
  let blocked = 0
  for (const way of crowd.ways ?? []) {
    total += way.length
    const count = Math.max(2, Math.ceil(way.length / stride))
    const step = way.length / count
    for (let index = 0; index <= count; index += 1) {
      const distance = (index / count) * way.length
      let leg = 1
      while (leg < way.cumulative.length - 1 && way.cumulative[leg] < distance) leg += 1
      const back = way.cumulative[leg - 1]
      const t = Math.min(1, Math.max(0, (distance - back) / Math.max(1e-6, way.cumulative[leg] - back)))
      const ax = way.points[(leg - 1) * 2]
      const az = way.points[(leg - 1) * 2 + 1]
      const x = ax + (way.points[leg * 2] - ax) * t
      const z = az + (way.points[leg * 2 + 1] - az) * t
      let hit = null
      for (const box of solids) {
        if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) { hit = box; break }
      }
      if (!hit) continue
      blocked += step
      const found = tally.get(hit.what) ?? { what: hit.what, length: 0, top: +hit.top.toFixed(2), box: null }
      found.length += step
      found.box = {
        x: +((hit.minX + hit.maxX) / 2).toFixed(2), z: +((hit.minZ + hit.maxZ) / 2).toFixed(2),
        w: +(hit.maxX - hit.minX).toFixed(2), d: +(hit.maxZ - hit.minZ).toFixed(2),
      }
      tally.set(hit.what, found)
    }
  }

  return {
    region: scene.region,
    solids: solids.length,
    buildings: buildings.length,
    props: props.length,
    centrelineLength: +total.toFixed(1),
    centrelineBlocked: +blocked.toFixed(1),
    centrelineShare: +(blocked / Math.max(1e-6, total)).toFixed(4),
    worst: [...tally.values()]
      .sort((a, b) => b.length - a.length)
      .map((entry) => ({
        ...entry,
        length: +entry.length.toFixed(2),
        declaredBuilding: +nearBuilding(entry.box.x, entry.box.z).toFixed(2),
        declaredProp: nearProp(entry.box.x, entry.box.z),
      })),
  }
}

const { browser, page, errors } = await open()
try {
  await region(page, TABS[key], { key })
  const report = await page.evaluate(survey, { floorY: .16, headroom: .25, stride: .12, span: 12 })
  console.log(`${key}: solids ${report.solids}, declared buildings ${report.buildings}, props ${report.props}`)
  console.log(`centreline ${report.centrelineBlocked}/${report.centrelineLength} = ${report.centrelineShare}`)
  for (const row of report.worst.slice(0, LIMIT)) {
    console.log(`  ${row.length.toFixed(2).padStart(6)}  top ${String(row.top).padStart(5)}  box ${row.box.w}x${row.box.d}@${row.box.x},${row.box.z}`
      + `  building~${row.declaredBuilding} prop~${row.declaredProp.distance === Infinity ? 'none' : `${row.declaredProp.name}@${row.declaredProp.distance.toFixed(2)}`}`)
    console.log(`          ${row.what}`)
  }
  save(`/Users/alan/LSATspeedrun/.maps/undeclared-${key}.json`, { ...report, errors })
} finally {
  await browser.close().catch(() => {})
}
