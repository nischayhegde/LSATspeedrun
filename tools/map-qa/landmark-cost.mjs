/**
 * What naming a place costs the region it is named in.
 *
 * The Treaty Sea was rebuilt as open water — triangles down 18%, draw calls
 * down 42% — and asked to stay that way, so twelve new districts had to be
 * authored without repopulating it. `registerLandmark` is a push into
 * `world.userData.landmarks`, which is an argument that the ring, the wash and
 * the label are overlay rather than scenery, but an argument is not a
 * measurement. This censuses the scene graph so the two arms can be compared:
 *
 *   node tools/map-qa/landmark-cost.mjs named ocean orbit     # as authored
 *   # comment out the registerLandmark loops
 *   node tools/map-qa/landmark-cost.mjs unnamed ocean orbit
 *
 * `renderer.info.render` cannot answer this. It reports 1 call and 1 triangle
 * whatever is on screen, because the style pass composites last and resets the
 * counter, so what survives a read is the final fullscreen pass.
 *
 * Both arms must be a tier-0 firm — the default dev profile, no `MAPS_EMAIL`.
 * A held district grows a mast, a flag and a ring, and a bought connection
 * stands a person up, so measuring the marginal cost of the *name* against a
 * late-game firm measures those instead.
 */
import { open, region, save, TABS, OUT, BASE, EMAIL } from './lib.mjs'

const tag = process.argv[2] ?? 'named'
const keys = process.argv.slice(3).length ? process.argv.slice(3) : ['ocean', 'orbit']
const dir = `${OUT}/landmark-cost-${tag}`

const { browser, page, errors } = await open()
const report = { base: BASE, email: EMAIL, regions: {} }
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    await page.evaluate(() => window.__clock?.tick(2))
    const found = await page.evaluate(() => {
      const world = window.__mapScene.world
      let meshes = 0
      let instanced = 0
      let triangles = 0
      let attributable = 0
      world.traverse((child) => {
        if (!child.isMesh) return
        const geometry = child.geometry
        const count = geometry?.index ? geometry.index.count : geometry?.attributes?.position?.count ?? 0
        triangles += (count / 3) * (child.isInstancedMesh ? child.count : 1)
        if (child.isInstancedMesh) instanced += 1
        else meshes += 1
        // A contact's footing is the one piece of geometry a *name* can add on
        // the water, so it is counted separately rather than hidden in the
        // total: open water is already clear, so `siteOnPlan` says yes and the
        // figure would otherwise stand on nothing.
        for (let node = child; node; node = node.parent) {
          if (node.userData?.contactLandform) { attributable += 1; break }
        }
      })
      return {
        region: window.__mapScene.region,
        landmarks: (world.userData.landmarks ?? []).length,
        meshes, instanced, triangles: Math.round(triangles), contactFootings: attributable,
      }
    })
    report.regions[key] = found
    console.log(`${key}: ${found.landmarks} landmarks · ${found.meshes} meshes + ${found.instanced} batches · ${found.triangles} triangles · ${found.contactFootings} footing meshes`)
    await page.screenshot({ path: `${dir}/${key}.png` })
  }
  report.errors = errors.slice(0, 10)
  save(`${dir}/report.json`, report)
  console.log('wrote', dir)
} finally {
  await browser.close().catch(() => {})
}
