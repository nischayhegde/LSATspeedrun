/**
 * Two questions, both of which a number alone answers badly.
 *
 * 1. Did the firm's connections end up somewhere a person could plausibly
 *    stand? `siteOnPlan` reports whether it found clear ground, but "clear of
 *    the pedestrian network and clear of every planned building" is not the
 *    same as "beside the courthouse door rather than in the middle of the
 *    carriageway", and only a picture settles that.
 * 2. Does selecting a district read at the distance the region opens at, and
 *    does it still read when that district is also held? The held accent and
 *    the hover wash are both teal and both on the ground; a third ground
 *    overlay is exactly the sort of thing that turns into mud, or that paints
 *    over the labels the way ground rings once did.
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import { open, region, save, TABS, OUT, BASE } from './lib.mjs'

const tag = process.argv[2] ?? 'after'
const keys = process.argv.slice(3)
const dir = `${OUT}/connections-${tag}`
mkdirSync(dir, { recursive: true })
const report = {}

/** Contacts, districts and every label's draw order, read off the built world. */
function survey() {
  const THREE = window.__mapThree
  const scene = window.__mapScene
  const siting = (scene.world.userData.landmarkSiting ?? []).filter((row) => row.label.startsWith('contact-'))
  const labels = []
  scene.scene.traverse((child) => {
    if (!child.isSprite) return
    if (!child.userData?.mapLabelKind && !child.userData?.mapLabelAlways) return
    labels.push({ kind: child.userData.mapLabelKind ?? 'always', order: child.renderOrder, visible: child.visible })
  })
  const overlays = []
  scene.world.traverse((child) => {
    if (!child.userData?.regionWash && child.geometry?.type !== 'RingGeometry') return
    if (!child.visible) return
    const box = new THREE.Box3().setFromObject(child)
    overlays.push({
      kind: child.userData?.regionWash ? 'wash' : 'ring',
      at: [Number(child.position.x.toFixed(2)), Number(child.position.z.toFixed(2))],
      radius: Number(box.max.x.toFixed(2)) - Number(child.position.x.toFixed(2)),
      colour: `#${child.material.color.getHexString()}`,
      opacity: Number(child.material.opacity.toFixed(3)),
      depthTest: child.material.depthTest,
      order: child.renderOrder,
    })
  })
  return {
    region: scene.region,
    contacts: siting.map((row) => ({ key: row.label, at: [Number(row.x.toFixed(2)), Number(row.z.toFixed(2))], moved: Number(row.moved.toFixed(2)), cleared: row.cleared })),
    landmarks: (scene.landmarks ?? []).map((l) => ({ key: l.key, at: l.position, radius: l.radius })),
    labels: { count: labels.length, minOrder: labels.length ? Math.min(...labels.map((l) => l.order)) : null, contactsVisible: labels.filter((l) => l.kind === 'contact' && l.visible).length },
    overlays,
    triangles: scene.renderer.info.render.triangles,
    calls: scene.renderer.info.render.calls,
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

/** Puts the camera on a spot at a human-scale distance and renders. */
async function frame(page, at, height = 3.4, back = 5.2) {
  await page.evaluate(([x, z, h, b]) => {
    const { camera } = window.__mapScene
    camera.position.set(x + b * .7, h, z + b)
    camera.lookAt(x, .8, z)
    camera.updateProjectionMatrix()
  }, [at[0], at[1], height, back])
}

const { browser, page, errors } = await open()
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    const found = await page.evaluate(survey)
    report[key] = found
    console.log(`\n=== ${key} ===`)
    console.log('contacts:', JSON.stringify(found.contacts))
    console.log('labels:', JSON.stringify(found.labels), 'cost:', found.triangles, 'tris /', found.calls, 'calls')

    await shoot(page, `${key}-overview`)
    for (const contact of found.contacts) {
      await frame(page, contact.at)
      await shoot(page, `${key}-${contact.key}`)
      // Straight down as well: a street-level shot can be blocked by the very
      // building the question is about, and a plan view cannot be.
      await page.evaluate(([x, z]) => {
        const { camera } = window.__mapScene
        camera.position.set(x, 11, z + .001)
        camera.lookAt(x, 0, z)
        camera.updateProjectionMatrix()
      }, contact.at)
      await shoot(page, `${key}-${contact.key}-plan`)
    }

    // Selection: driven the way the player drives it, by clicking a name in the
    // district directory, so the React state and the scene prop are both
    // exercised rather than the scene's internals being poked directly.
    const opened = await page.evaluate(() => {
      const toggle = [...document.querySelectorAll('.uw-district-guide-toggle')][0]
      if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
      return Boolean(toggle)
    })
    await page.waitForTimeout(200)
    const chose = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.uw-district-guide-list button')]
      const row = rows[Math.floor(rows.length / 2)]
      if (row) row.click()
      return row ? row.textContent : null
    })
    await page.waitForTimeout(400)
    await page.evaluate(() => window.__clock?.tick(60))
    report[`${key}-selected`] = { opened, chose, ...(await page.evaluate(survey)) }
    console.log('selected:', chose, 'overlays:', JSON.stringify(report[`${key}-selected`].overlays))
    await shoot(page, `${key}-selected-overview`)
    const chosen = report[`${key}-selected`].overlays.find((o) => o.colour === 'e4c36e' || o.colour === '#e4c36e')
    if (chosen) {
      await frame(page, chosen.at, 6.2, 9.4)
      await shoot(page, `${key}-selected-close`)
    }
    // The directory brief is the other half of the answer, so capture the rail.
    const rail = await page.$('.uw-map-rail')
    if (rail) await rail.screenshot({ path: `${dir}/${key}-brief.png` }).catch(() => {})
  }
  report._errors = errors.slice(0, 10)
  save(`${dir}/report.json`, report)
  console.log('\nwrote', dir, 'from', BASE)
} finally {
  await browser.close().catch(() => {})
}
