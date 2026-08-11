/**
 * What is standing at a given point.
 *
 * `collide.mjs` reports a walker site as `walker@-12,-7` and attributes it to a
 * named prop when one is close enough, but a site with no `prop` beside it is
 * just a rounded coordinate: the harness could not name it, and three separate
 * rounds of work have then argued about what it might be. This answers that
 * question directly — it runs no frames, walks the same static geometry the
 * collision grid is built from, and reports every object with a triangle over
 * the queried column, deepest ancestor chain and all.
 *
 * Usage: node tools/map-qa/whatis.mjs <region> <x,z> [<x,z> ...]
 */
import { TABS, open, region, save, scratch } from './lib.mjs'

const key = process.argv[2] ?? 'nation'
const points = process.argv.slice(3).map((pair) => {
  const [x, z] = pair.split(',').map(Number)
  return { x, z }
})
if (!points.length) points.push({ x: 0, z: 0 })
const RADIUS = Number(process.env.MAPS_RADIUS ?? 0.5)
const FLOOR_Y = Number(process.env.MAPS_FLOOR ?? 0.2)

function identify(settings) {
  const { queries, radius, floorY } = settings
  const scene = window.__mapScene
  const THREE = window.__mapThree
  const world = scene.world
  world.updateMatrixWorld(true)

  const excluded = new Set()
  const mark = (root) => root?.traverse((child) => excluded.add(child))
  for (const sim of scene.trafficSims ?? []) for (const agent of sim.agents) mark(agent.object)
  for (const path of scene.transports ?? []) mark(path.object)
  if (scene.lawyer) mark(scene.lawyer)
  if (scene.crowdRenderer?.group) mark(scene.crowdRenderer.group)

  /*
   * `batchStaticScenery` merges the loose props into a handful of
   * `static-batch-*` meshes long before this runs, so a name is often not
   * available at all. Each link therefore carries the node's own position and
   * child count as well, which is usually enough to recognise a set-piece
   * against the code that placed it.
   */
  const chain = (object) => {
    const parts = []
    for (let node = object; node && node !== world; node = node.parent) {
      const audit = node.userData?.propAudit?.name
      const at = `${+node.position.x.toFixed(2)},${+node.position.z.toFixed(2)}`
      const name = audit ? `<${audit}>` : (node.name || node.type)
      parts.push(node.isGroup ? `${name}@${at}[${node.children.length}]` : `${name}@${at}`)
    }
    return parts.reverse().join(' / ')
  }

  const found = queries.map(() => new Map())
  const vertex = new THREE.Vector3()
  const consider = (child, instanced) => {
    const geometry = child.geometry
    const position = geometry?.attributes?.position
    if (!position) return
    const index = geometry.index
    const count = index ? index.count : position.count
    const matrices = []
    if (instanced) {
      const matrix = new THREE.Matrix4()
      for (let i = 0; i < child.count; i += 1) {
        child.getMatrixAt(i, matrix)
        matrices.push(matrix.clone().premultiply(child.matrixWorld))
      }
    } else {
      matrices.push(child.matrixWorld)
    }
    for (const matrix of matrices) {
      for (let i = 0; i + 2 < count; i += 3) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
        for (let corner = 0; corner < 3; corner += 1) {
          const vertexIndex = index ? index.getX(i + corner) : i + corner
          vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix)
          if (vertex.x < minX) minX = vertex.x
          if (vertex.x > maxX) maxX = vertex.x
          if (vertex.y < minY) minY = vertex.y
          if (vertex.y > maxY) maxY = vertex.y
          if (vertex.z < minZ) minZ = vertex.z
          if (vertex.z > maxZ) maxZ = vertex.z
        }
        if (maxY <= floorY) continue
        for (let q = 0; q < queries.length; q += 1) {
          const { x, z } = queries[q]
          if (maxX < x - radius || minX > x + radius) continue
          if (maxZ < z - radius || minZ > z + radius) continue
          const label = chain(child)
          const bucket = found[q]
          const seen = bucket.get(label) ?? { label, instanced, triangles: 0, low: Infinity, high: -Infinity, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
          seen.triangles += 1
          seen.low = Math.min(seen.low, minY)
          seen.high = Math.max(seen.high, maxY)
          seen.minX = Math.min(seen.minX, minX)
          seen.maxX = Math.max(seen.maxX, maxX)
          seen.minZ = Math.min(seen.minZ, minZ)
          seen.maxZ = Math.max(seen.maxZ, maxZ)
          bucket.set(label, seen)
        }
      }
    }
  }

  world.traverse((child) => {
    if (excluded.has(child) || !child.isMesh || !child.geometry) return
    if (child.isSkinnedMesh) return
    const data = child.userData ?? {}
    if (
      data.cloud || data.skyUniforms || data.auroraUniforms || data.waterUniforms || data.atmosphere
      || data.mapLabelKind || data.mapLabelAlways || data.mapEmphasisKind || data.destinationMarker
      || data.lawyerBeacon || data.playerMarker || data.lighthouseBeam || data.heldLandmarkAccent
      || data.ambientActor || data.ambientWing || data.planet || data.orbitalRing || data.flagUniforms
    ) return
    if (child.material?.depthWrite === false) return
    consider(child, Boolean(child.isInstancedMesh))
  })

  const round = (value) => +Number(value).toFixed(2)
  return queries.map((query, q) => ({
    at: `${query.x},${query.z}`,
    objects: [...found[q].values()]
      .sort((a, b) => b.high - a.high)
      .map((entry) => ({
        what: entry.label,
        instanced: entry.instanced,
        triangles: entry.triangles,
        y: [round(entry.low), round(entry.high)],
        x: [round(entry.minX), round(entry.maxX)],
        z: [round(entry.minZ), round(entry.maxZ)],
      })),
  }))
}

const { browser, page, errors } = await open()
try {
  await region(page, TABS[key], { key, warmup: 0 })
  const result = await page.evaluate(identify, { queries: points, radius: RADIUS, floorY: FLOOR_Y })
  for (const site of result) {
    console.log(`\n@ ${site.at} (r=${RADIUS})`)
    for (const object of site.objects) console.log('  ', JSON.stringify(object))
  }
  save(scratch(`whatis-${key}.json`), { region: key, radius: RADIUS, sites: result, errors })
} finally {
  await browser.close().catch(() => {})
}
