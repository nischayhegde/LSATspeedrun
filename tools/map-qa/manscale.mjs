/**
 * How tall is a walker, against the things it walks past?
 *
 * `inside.mjs` derives the body it tests from the first crowd rig's world box.
 * Every hit it reports is therefore only as honest as that box, and a rig whose
 * box came out twice the drawn figure would report a district full of people
 * wearing the shop canopies as hats. This prints the box, the scale it came
 * through, and the deepest few parts by height, so the comparison can be made
 * rather than assumed.
 *
 * Usage: node tools/map-qa/manscale.mjs [region]
 */
import { open, region, TABS } from './lib.mjs'

const key = process.argv[2] ?? 'city'

const probe = () => {
  const THREE = window.__mapThree
  const scene = window.__mapScene
  const crowd = scene?.crowd
  const measure = (root) => {
    if (!root) return null
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return null
    const scale = new THREE.Vector3().setFromMatrixScale(root.matrixWorld)
    return {
      height: +(box.max.y - box.min.y).toFixed(3),
      width: +(box.max.x - box.min.x).toFixed(3),
      depth: +(box.max.z - box.min.z).toFixed(3),
      foot: +box.min.y.toFixed(3),
      scale: +scale.y.toFixed(4),
      tallest: root.children
        .map((child) => {
          const childBox = new THREE.Box3().setFromObject(child)
          return childBox.isEmpty()
            ? null
            : { name: child.name || child.type, top: +childBox.max.y.toFixed(3), lo: +childBox.min.y.toFixed(3) }
        })
        .filter(Boolean)
        .sort((a, b) => b.top - a.top)
        .slice(0, 4),
    }
  }
  return {
    walkers: (crowd?.walkers ?? []).map((walker) => ({
      active: Boolean(walker.active),
      radius: walker.radius ?? walker.bodyRadius ?? null,
      ...(measure(walker.rig?.root ?? walker.root) ?? { height: null }),
      tallest: undefined,
    })),
    counsel: measure(scene?.counsel?.rig?.root ?? scene?.counsel?.root ?? scene?.player?.root),
  }
}

const { browser, page } = await open()
try {
  await region(page, TABS[key], { key, warmup: 0 })
  console.log(JSON.stringify(await page.evaluate(probe), null, 1))
} finally {
  await browser.close().catch(() => {})
}
