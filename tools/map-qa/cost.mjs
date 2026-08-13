/**
 * What one district costs to draw.
 *
 * The scene stops rendering under the synthetic clock, so `renderer.info` reads
 * a stale one-triangle frame unless a frame is forced first. Everything here is
 * read after an explicit render for that reason.
 *
 * Reported per region so an addition can be attributed: a change that puts new
 * objects in one district and nothing in the others should move exactly one
 * row, and a change that moves all of them is doing something it did not say.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'cost'
const keys = process.argv.slice(3)
const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(() => {
      const { renderer, scene, camera, world } = window.__mapScene
      renderer.info.reset()
      renderer.render(scene, camera)
      let meshes = 0
      let instanced = 0
      let sprites = 0
      world.traverse((child) => {
        if (child.isInstancedMesh) instanced += 1
        else if (child.isMesh) meshes += 1
        if (child.isSprite) sprites += 1
      })
      return {
        triangles: renderer.info.render.triangles,
        calls: renderer.info.render.calls,
        programs: renderer.info.programs?.length ?? null,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        meshes,
        instanced,
        sprites,
      }
    })
    console.log(`${key.padEnd(10)}`, JSON.stringify(report[key]))
  }
  report._errors = errors.slice(0, 6)
  save(`${OUT}/cost-${tag}.json`, report)
} finally {
  await browser.close().catch(() => {})
}
