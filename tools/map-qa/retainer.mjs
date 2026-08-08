// Does a signed retainer actually show up on the map?
//
// Three separate questions, because "retainers aren't visible" could be any of
// them and they have different fixes:
//
//   1. Does `ownedLandmarks` arrive at the scene populated at all? The
//      district-to-landmark join was checked statically, never live. Answered by
//      securing a district through the real endpoint and then counting the
//      accents the scene built.
//   2. Does the hover highlight fire? `landmarkRing` and the new area wash are
//      driven by pointer events, so this dispatches real ones at a landmark's
//      own screen position rather than calling an internal.
//   3. Do map labels still read on top? The ground indicators next to the wash
//      use `depthTest: false` at renderOrder 40-44, which is what forced labels
//      to renderOrder 70; a new ground overlay is exactly the kind of thing
//      that breaks that again.
import { open, region, save, TABS } from './lib.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'

const tag = process.argv[2] ?? 'after'
const dir = `/Users/alan/LSATspeedrun/.maps/retainer-${tag}`
mkdirSync(dir, { recursive: true })
const report = {}
const flush = () => save(`${dir}/report.json`, report)

/** The scene's own view of held territory: what it built, not what it was sent. */
function surveyHeld() {
  const THREE = window.__mapThree
  const scene = window.__mapScene
  const accents = []
  const washes = []
  scene.world.traverse((child) => {
    if (child.userData?.heldLandmarkAccent) {
      const box = new THREE.Box3().setFromObject(child)
      accents.push({
        at: [Number(child.position.x.toFixed(2)), Number(child.position.z.toFixed(2))],
        top: Number(box.max.y.toFixed(2)),
      })
    }
    if (child.userData?.regionWash) {
      washes.push({
        visible: child.visible,
        radius: Number(child.scale.x.toFixed(2)),
        y: Number(child.position.y.toFixed(3)),
        opacity: Number(child.material.opacity.toFixed(3)),
        // The trap: a ground overlay that disables depth testing and climbs the
        // render order is what painted over the labels last time.
        depthTest: child.material.depthTest,
        depthWrite: child.material.depthWrite,
        renderOrder: child.renderOrder,
      })
    }
  })
  // Every label, with the order it draws at, so "labels still win" is a fact
  // rather than an impression from a screenshot.
  const labels = []
  scene.scene.traverse((child) => {
    if (!child.isSprite) return
    if (!child.userData?.mapLabelKind && !child.userData?.mapLabelAlways) return
    labels.push(child.renderOrder)
  })
  return {
    region: scene.region,
    accents,
    washes,
    landmarks: (scene.landmarks ?? []).map((l) => ({ key: l.key, at: l.position, radius: l.radius })),
    labelCount: labels.length,
    labelMinRenderOrder: labels.length ? Math.min(...labels) : null,
  }
}

/** Screen position of a world point, in client pixels. */
function screenAt(point) {
  const THREE = window.__mapThree
  const { camera, renderer } = window.__mapScene
  const rect = renderer.domElement.getBoundingClientRect()
  const vector = new THREE.Vector3(point[0], .2, point[1]).project(camera)
  return {
    x: rect.left + (vector.x * .5 + .5) * rect.width,
    y: rect.top + (-vector.y * .5 + .5) * rect.height,
    onScreen: Math.abs(vector.x) <= 1 && Math.abs(vector.y) <= 1 && vector.z < 1,
  }
}

async function shoot(page, name) {
  const url = await page.evaluate(() => {
    const { scene, renderer, camera } = window.__mapScene
    renderer.render(scene, camera)
    return renderer.domElement.toDataURL('image/png')
  })
  writeFileSync(`${dir}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'))
}

const { browser, page, errors } = await open()

// ---------------------------------------------------------------- ownership
report.before = await page.evaluate(surveyHeld)
report.territory = await page.evaluate(async () => {
  const csrf = document.cookie.split('; ').find((row) => row.startsWith('lsat_csrf='))?.split('=')[1]
  // `GET /game` answers `{ game, pending_reviews }`, not the state directly.
  const body = await (await fetch('/v1/game', { credentials: 'include' })).json()
  const game = body?.game ?? body
  const districts = game?.territory?.districts ?? []
  const summary = {
    total: districts.length,
    owned: districts.filter((d) => d.owned).map((d) => d.key),
    ownedLandmarkKeys: districts.filter((d) => d.owned && d.landmark_key).map((d) => d.landmark_key),
    cash: game?.cash ?? null,
    // Districts with a landmark join, in the region the map opens on.
    cityAvailable: districts
      .filter((d) => d.region === 'city' && !d.owned && d.available)
      .map((d) => ({ key: d.key, landmark: d.landmark_key, cost: d.cost, affordable: d.affordable })),
    missingLandmarkJoin: districts.filter((d) => !d.landmark_key).map((d) => d.key),
  }
  // Sign one, so the whole path from `player_territory` to a flag on the ground
  // is exercised rather than assumed.
  const target = summary.cityAvailable.find((d) => d.affordable) ?? summary.cityAvailable[0]
  if (target) {
    const response = await fetch('/v1/game/territory', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}) },
      body: JSON.stringify({ district_key: target.key }),
    })
    const body = await response.json().catch(() => ({}))
    summary.secured = { key: target.key, ok: response.ok, status: response.status, error: body?.error?.message ?? null }
  }
  return summary
})
console.log('territory:', JSON.stringify(report.territory))
flush()

// The scene rebuilds when `ownedLandmarks` changes, so reload rather than trust
// an in-place update, and confirm what the fresh world contains.
await page.goto('http://127.0.0.1:5173/map', { waitUntil: 'commit' })
await page.waitForTimeout(1500)
for (let attempt = 0; attempt < 90; attempt += 1) {
  const up = await page.evaluate(() => {
    window.__clock?.tick(4)
    return Boolean(window.__mapScene?.scene)
  })
  if (up) break
  await page.waitForTimeout(400)
}
await page.evaluate(() => window.__clock?.tick(120))
report.after = await page.evaluate(surveyHeld)
console.log('accents:', report.after.accents.length, 'washes:', JSON.stringify(report.after.washes))
console.log('labels:', report.after.labelCount, 'minRenderOrder', report.after.labelMinRenderOrder)
flush()

// ------------------------------------------------------------------- shots
await shoot(page, 'held-overview')

// Frame the held district close enough to judge whether the wash reads.
const held = report.after.accents[0]
if (held) {
  await page.evaluate((at) => {
    const { camera } = window.__mapScene
    camera.position.set(at[0] + 5.2, 4.6, at[1] + 6.4)
    camera.lookAt(at[0], .4, at[1])
    camera.updateProjectionMatrix()
  }, held.at)
  await shoot(page, 'held-close')
}

// Hover: a real pointermove at a landmark's own screen position.
const hoverTarget = report.after.landmarks[Math.floor(report.after.landmarks.length / 2)]
if (hoverTarget) {
  const spot = await page.evaluate(screenAt, hoverTarget.at)
  report.hover = { landmark: hoverTarget.key, spot }
  if (spot.onScreen) {
    await page.mouse.move(spot.x, spot.y)
    await page.waitForTimeout(250)
    await page.evaluate(() => window.__clock?.tick(30))
    report.hoverState = await page.evaluate(surveyHeld)
    await shoot(page, 'hover-wash')
  }
  console.log('hover:', JSON.stringify(report.hover), 'washes now', JSON.stringify(report.hoverState?.washes))
}
report._errors = errors.slice(0, 10)
flush()
await browser.close()
