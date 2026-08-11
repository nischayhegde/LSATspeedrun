/**
 * What ground a region actually has, and what is already standing on it.
 *
 * Written for the two regions that were authored without landmarks. A landmark
 * is a position and a pick radius rather than an object — see `registerLandmark`
 * — so siting one is a question about the *region*, not about the scene graph:
 * where is there ground, what is on it, and which stretches are open.
 *
 * Reverse-engineering that from the builders is how you site a district on top
 * of a rival's compound. The Treaty Sea in particular is now eight small
 * landforms on open water, each placed by a different pass, and the only place
 * their final positions exist together is the built scene.
 *
 *   node tools/map-qa/sites.mjs [tag] [region...]
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'sites'
const keys = process.argv.slice(3).length ? process.argv.slice(3) : ['ocean', 'orbit']

const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(() => {
      const scene = window.__mapScene
      // The scene publishes its own three, beside itself and for this.
      const THREE = window.__mapThree
      const world = scene.world
      const round = (value) => Number(value.toFixed(2))
      // Every piece of standing ground, as its own footprint. Islands are
      // extruded shapes and station parcels are squashed cylinders, so a
      // bounding box in world space is the only description they share.
      const ground = []
      const box = new THREE.Box3()
      world.traverse((child) => {
        if (!child.isMesh || child.isInstancedMesh) return
        const type = child.geometry?.type ?? ''
        if (type !== 'ExtrudeGeometry' && type !== 'CylinderGeometry') return
        box.setFromObject(child)
        const size = box.getSize(new THREE.Vector3())
        // Ground, not furniture: wide and flat. A lamp post is a cylinder too.
        if (size.y > 1.2 || size.x < .8) return
        const centre = box.getCenter(new THREE.Vector3())
        ground.push({
          geometry: type,
          x: round(centre.x), z: round(centre.z),
          hx: round(size.x / 2), hz: round(size.z / 2), top: round(box.max.y),
        })
      })
      return {
        region: scene.region,
        landmarks: (world.userData.landmarks ?? []).map((entry) => `${entry.key} @ ${entry.position.map(round)} r${entry.radius}`),
        // Where the career offices, the rival compounds and any contacts ended
        // up, which is the list of ground a landmark must not be sited over.
        siting: (world.userData.landmarkSiting ?? []).map((row) => ({
          label: row.label, cleared: row.cleared, x: round(row.x), z: round(row.z), moved: round(row.moved),
        })),
        ground: ground.sort((a, b) => a.x - b.x),
        ways: (world.userData.roadWays ?? []).map((way) => ({
          kind: way.kind ?? 'road', closed: Boolean(way.closed), points: way.points.length,
          x: [round(Math.min(...way.points.map((p) => p[0]))), round(Math.max(...way.points.map((p) => p[0])))],
          z: [round(Math.min(...way.points.map((p) => p[1]))), round(Math.max(...way.points.map((p) => p[1])))],
        })),
        obstacles: (world.userData.crowdObstacles ?? []).length,
        triangles: scene.renderer.info.render.triangles,
        calls: scene.renderer.info.render.calls,
      }
    })
    console.log(`\n=== ${key} ===`, JSON.stringify(report[key], null, 1))
    await page.screenshot({ path: `${OUT}/sites-${tag}/${key}.png` })
  }
  report._errors = errors.slice(0, 10)
  save(`${OUT}/sites-${tag}/report.json`, report)
} finally {
  await browser.close().catch(() => {})
}
