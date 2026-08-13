/**
 * How tall is a person, in the units the district is built in?
 *
 * Written because two numbers in this tree disagree by a factor of three and the
 * crowd-scale decision rests on which of them is right. `map-three-scene` says a
 * crowd body is **.49 units tall at `CROWD_RENDER_SCALE`**, and it says so where
 * it matters — the note on `OCEAN_LANDFORM_TOP` sets a landform's top from it.
 * `crowd-arm.mjs`'s survey measured the same body at **1.53**, and reported the
 * figure as nearly two storeys tall on the strength of it, which is the whole
 * case for halving the crowd.
 *
 * Both cannot be true, and neither is worth arguing about when the page can be
 * asked. This measures a body four independent ways in one lifetime:
 *
 *   built     `buildStylizedCounsel` on its own, at scale 1, which is what every
 *             per-scale figure has to be consistent with.
 *   root      the world box of a live walker's skeleton — what the survey did.
 *   drawn     the same walker reconstructed from the crowd's *instance matrices*,
 *             which is the only thing the renderer actually submits. If the
 *             skeletons are ever out of step with the batches, this is the
 *             number that counts.
 *   counsel   the player's own rig, which is scaled by the same call.
 *
 * And beside them the things a person is judged against: the doorway heights
 * `createBlockBuilding` authored, taken from the meshes rather than derived from
 * a facade height by re-applying the authoring rule.
 *
 * Usage: node tools/map-qa/yardstick.mjs [region…]
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const keys = process.argv.slice(2).filter((argument) => TABS[argument])
const REGIONS = keys.length ? keys : ['city']

function measure() {
  const scene = window.__mapScene
  const THREE = window.__mapThree
  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  const height = (object) => {
    box.setFromObject(object)
    if (box.isEmpty()) return null
    box.getSize(size)
    return { height: +size.y.toFixed(4), width: +size.x.toFixed(4), foot: +box.min.y.toFixed(4) }
  }

  const walker = (scene.crowd?.walkers ?? []).find((entry) => entry.active) ?? scene.crowd?.walkers?.[0]
  const walkerRoot = walker ? (walker.rig?.root ?? walker.root) : null
  if (walkerRoot) walkerRoot.updateMatrixWorld(true)

  /*
   * The drawn body, from the batches.
   *
   * Every part of every walker is one instance of one `InstancedMesh` in
   * `crowdRenderer.group`, and the matrix written for it is the part's own world
   * matrix. So the union of (part geometry box × instance matrix) over the
   * instances belonging to one walker is exactly the body on screen — no
   * assumption about where the skeleton lives or whether its scale has been
   * applied.
   */
  const instanceBox = new THREE.Box3()
  const partBox = new THREE.Box3()
  const matrix = new THREE.Matrix4()
  const group = scene.crowdRenderer?.group
  const scales = new Set()
  if (group) {
    for (const child of group.children) {
      if (!child.isInstancedMesh) continue
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
      for (let index = 0; index < child.count; index += 1) {
        child.getMatrixAt(index, matrix)
        const scale = new THREE.Vector3().setFromMatrixScale(matrix)
        if (scale.x > 1e-4) scales.add(+scale.x.toFixed(3))
        // One walker only, and the first walker's parts are the first instance
        // of each batch by construction: the batcher walks the walkers in order.
        if (index !== 0) continue
        partBox.copy(child.geometry.boundingBox).applyMatrix4(matrix)
        instanceBox.union(partBox)
      }
    }
  }
  instanceBox.getSize(size)

  // Doorways as authored, not as re-derived. `createBlockBuilding` tags them.
  const doors = []
  scene.world.traverse((child) => {
    const data = child.userData ?? {}
    if (!data.doorway && !String(child.name).includes('door')) return
    const measured = height(child)
    if (measured) doors.push(measured.height)
  })
  doors.sort((a, b) => a - b)

  return {
    region: scene.region,
    walkerSeed: walker?.seed ?? null,
    root: walkerRoot ? height(walkerRoot) : null,
    rootScale: walkerRoot ? +walkerRoot.scale.x.toFixed(4) : null,
    drawn: instanceBox.isEmpty() ? null : { height: +size.y.toFixed(4), foot: +instanceBox.min.y.toFixed(4) },
    instanceScales: [...scales].sort((a, b) => a - b).slice(0, 8),
    counsel: scene.lawyer ? height(scene.lawyer) : null,
    doors: { count: doors.length, min: doors[0] ?? null, median: doors[Math.floor(doors.length / 2)] ?? null, max: doors[doors.length - 1] ?? null },
  }
}

/** A body on its own, away from the map, at the scales the game draws it at. */
async function built(page) {
  return page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const counsel = await import('/src/art/stylized-counsel.ts')
    const out = {}
    for (const scale of [1, .5, .278, .139]) {
      const rig = counsel.buildStylizedCounsel('female', 4, { role: 'visitor', paletteSeed: 3700, renderScale: scale })
      rig.root.scale.setScalar(scale)
      rig.root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(rig.root)
      const size = new THREE.Vector3()
      box.getSize(size)
      out[String(scale)] = { height: +size.y.toFixed(4), head: +box.max.y.toFixed(4), foot: +box.min.y.toFixed(4) }
    }
    return out
  })
}

const report = { at: new Date().toISOString(), regions: {} }
const { browser, page, errors } = await open()
try {
  report.built = await built(page)
  console.log('a body on its own:')
  for (const [scale, value] of Object.entries(report.built)) {
    console.log(`  renderScale ${scale.padEnd(5)} height ${String(value.height).padStart(7)}  head at ${value.head}`)
  }
  for (const key of REGIONS) {
    await region(page, TABS[key], { key, warmup: 300 })
    const measured = await page.evaluate(measure)
    report.regions[key] = measured
    console.log(`\n=== ${key} ===`)
    console.log(`  walker root box  ${measured.root?.height} (root scale ${measured.rootScale}, foot ${measured.root?.foot})`)
    console.log(`  walker as drawn  ${measured.drawn?.height} (foot ${measured.drawn?.foot})`)
    console.log(`  instance scales  ${measured.instanceScales.join(', ')}`)
    console.log(`  the player       ${measured.counsel?.height}`)
    console.log(`  doorways         ${measured.doors.count} tagged, median ${measured.doors.median} (${measured.doors.min}-${measured.doors.max})`)
  }
} finally {
  report.errors = errors.slice(0, 10)
  save(`${OUT}/yardstick.json`, report)
  await browser.close().catch(() => {})
}
console.log(`\nwrote ${OUT}/yardstick.json`)
