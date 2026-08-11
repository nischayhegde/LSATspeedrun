/**
 * Does this office have a roof, and what does its window actually show?
 *
 * Two questions that are both about the room's envelope and both invisible from
 * the framing the player gets. The office camera looks slightly down, so the
 * ceiling is off the top of the frame at every tier: a room with no ceiling at
 * all renders exactly like a room with one until the camera is pitched up or
 * the geometry is asked directly. It is asked directly here.
 *
 * ## Roof coverage
 *
 * A grid of points over the floor, one ray straight up from each. A covered
 * room answers every ray with something above head height; a room whose
 * ceiling is only its beams answers a few. Reported as the covered share, the
 * height of what was hit and its material colour, per tier, per floor.
 *
 * Rays skip `navIgnore` geometry, which is what the backdrop beyond the glass
 * is flagged as — the window view runs out to 260 m and would otherwise answer
 * every ray with sky.
 *
 * ## The window
 *
 * The opening's four corners are projected through the real camera, so the crop
 * is the glass as the player sees it rather than a diagnostic view down the
 * sightline. Alongside it: the view's own triangle and mesh count, the room's
 * draw calls and triangles on a forced frame, and the build phases.
 *
 * Usage: node tools/light-qa/office-audit.mjs <tag> [tier...] [--window]
 *   LIGHT_BASE=http://127.0.0.1:5373 LIGHT_FLOOR=practice|chambers
 *
 * `--window` keeps the glass and the counters and drops the roof survey and the
 * three whole-room stills. The full pass is a minute a tier, nearly all of it
 * 121 rays against the scene graph and four 1.9 MB screenshots, and composing
 * what is outside the glass takes several looks at it — a rate that turns a
 * morning's art direction into an afternoon of waiting.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launch } from './browser.mjs'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5373'
const ROOT = process.env.LIGHT_OUT || fileURLToPath(new URL('../../.light', import.meta.url))
const tag = process.argv[2] ?? 'audit'
const tiers = process.argv.slice(3).map(Number).filter((n) => Number.isFinite(n))
const TIERS = tiers.length ? tiers : [0, 1, 2, 5, 8, 11, 14]
/** Glass and counters only. See the header. */
const WINDOW_ONLY = process.argv.includes('--window')
const FLOOR = process.env.LIGHT_FLOOR || ''

const SHOTS = `${ROOT}/.light-shots/${tag}`
const REPORTS = `${ROOT}/.light-run`
mkdirSync(SHOTS, { recursive: true })
mkdirSync(REPORTS, { recursive: true })

const report = { tag, base: BASE, floor: FLOOR || 'default', at: new Date().toISOString(), tiers: {}, errors: [] }

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', (error) => report.errors.push(String(error.message).slice(0, 200)))
page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text().slice(0, 200)) })

async function dismissOverlays() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const defer = page.locator('.cutscene-defer, .cutscene-continue, button:has-text("Not now")')
    if (await defer.count() === 0) return
    await defer.first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(250)
  }
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})
  await page.addInitScript((skip) => { window.__auditWindowOnly = skip }, WINDOW_ONLY)

  for (const tier of TIERS) {
    const floorParam = FLOOR ? `&officeFloor=${FLOOR}` : ''
    await page.goto(`${BASE}/office?officeTier=${tier}${floorParam}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.__officeSceneStats && window.__officeDebug), null, { timeout: 180000, polling: 200 })
    if (!new URL(page.url()).pathname.startsWith('/office')) {
      throw new Error(`/office redirected to ${page.url()} — the account has no game profile`)
    }
    await dismissOverlays()
    await page.waitForTimeout(1200)

    const measured = await page.evaluate(() => {
      const { THREE, scene, camera, renderer, root, roomHalf } = window.__officeDebug
      const stats = window.__officeSceneStats
      const phases = window.__officeBuildPhases ?? []

      // The room's own extent, from the geometry that is not the backdrop.
      const box = new THREE.Box3()
      const probe = new THREE.Box3()
      scene.traverse((node) => {
        if (!node.isMesh || node.userData.navIgnore === true || !node.visible) return
        let ignored = false
        for (let parent = node; parent; parent = parent.parent) {
          if (parent.userData?.navIgnore === true) { ignored = true; break }
        }
        if (ignored) return
        probe.setFromObject(node)
        // A room, not a district: anything spanning more than forty metres is
        // scenery that escaped the flag and would swallow the whole extent.
        if (probe.max.x - probe.min.x > 40 || probe.max.z - probe.min.z > 40) return
        box.union(probe)
      })

      const CEILING_Y = 5.5
      const floorY = root.position.y
      const skipRoof = window.__auditWindowOnly === true
      const raycaster = new THREE.Raycaster()
      raycaster.far = 40
      const up = new THREE.Vector3(0, 1, 0)
      // Inside the walls rather than up to them: a ray in the wall plane hits
      // the wall itself and would report a roof that is not there.
      const inset = .6
      const x0 = Math.max(box.min.x + inset, -roomHalf + inset)
      const x1 = Math.min(box.max.x - inset, roomHalf - inset)
      const z0 = box.min.z + inset
      const z1 = box.max.z - inset
      const steps = 11
      let covered = 0
      let total = 0
      let enclosed = 0
      let enclosedCovered = 0
      const heights = []
      const hitNames = new Map()
      for (let ix = 0; ix < (skipRoof ? 0 : steps); ix += 1) {
        for (let iz = 0; iz < steps; iz += 1) {
          const x = x0 + (x1 - x0) * (ix / (steps - 1))
          const z = z0 + (z1 - z0) * (iz / (steps - 1))
          const visibleHits = (direction) => {
            raycaster.set(new THREE.Vector3(x, floorY + 2.2, z), direction)
            return raycaster.intersectObject(scene, true).filter((hit) => {
              const object = hit.object
              if (!object.visible) return false
              for (let parent = object; parent; parent = parent.parent) {
                if (parent.userData?.navIgnore === true) return false
                if (parent.visible === false) return false
              }
              return true
            })
          }
          const hits = visibleHits(up)
          total += 1
          // The floor slab runs past the walls at both ends, so a grid over it
          // includes points standing outside the room, where there is correctly
          // no ceiling. A point only counts as enclosed if there is something
          // in front of it and something behind it.
          const inside = visibleHits(new THREE.Vector3(0, 0, -1)).length > 0
            && visibleHits(new THREE.Vector3(0, 0, 1)).length > 0
          if (inside) enclosed += 1
          // A ceiling, not the top of a bookcase. Only a surface above the
          // wall head counts, or the answer is a measure of the furniture: at
          // tier 0, whose plank ceiling is unambiguous, taking the first hit
          // of any height reported 100% while every tier above it reported
          // 62% — and that 62% was cabinets at 2.1 m, with nothing overhead
          // at all.
          const overhead = hits.filter((hit) => hit.point.y > CEILING_Y)
          if (overhead.length) {
            covered += 1
            if (inside) enclosedCovered += 1
            heights.push(Number(overhead[0].point.y.toFixed(2)))
            const object = overhead[0].object
            let name = object.name
            for (let parent = object; parent && !name; parent = parent.parent) name = parent.name
            const key = name || `${object.geometry?.type ?? 'mesh'}@${overhead[0].point.y.toFixed(1)}`
            hitNames.set(key, (hitNames.get(key) ?? 0) + 1)
          }
        }
      }

      // How much of the frame the camera is actually shown, above the horizon
      // of the room: if the ceiling is missing, this is where it shows.
      renderer.info.reset?.()
      renderer.render(scene, camera)
      const forced = {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        programs: renderer.info.programs?.length ?? null,
      }

      // The glass, projected. The window group is the parent of the view root,
      // which is the one object flagged `batchSkip` in the room.
      let opening = null
      scene.traverse((node) => {
        if (opening || node.userData?.batchSkip !== true) return
        const group = node.parent
        if (!group) return
        const glass = group.children.find((child) => child.isMesh && child.geometry?.type === 'PlaneGeometry')
        if (!glass) return
        const width = glass.geometry.parameters.width
        const height = glass.geometry.parameters.height
        const corners = [
          new THREE.Vector3(-width / 2, -height / 2, 0),
          new THREE.Vector3(width / 2, -height / 2, 0),
          new THREE.Vector3(width / 2, height / 2, 0),
          new THREE.Vector3(-width / 2, height / 2, 0),
        ].map((point) => glass.localToWorld(point).project(camera))
        const canvas = renderer.domElement
        const bounds = canvas.getBoundingClientRect()
        const xs = corners.map((c) => (c.x * .5 + .5) * bounds.width + bounds.left)
        const ys = corners.map((c) => (-c.y * .5 + .5) * bounds.height + bounds.top)
        opening = {
          width, height,
          x: Math.min(...xs), y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        }
      })

      return {
        room: {
          x: [Number(box.min.x.toFixed(2)), Number(box.max.x.toFixed(2))],
          y: [Number(box.min.y.toFixed(2)), Number(box.max.y.toFixed(2))],
          z: [Number(box.min.z.toFixed(2)), Number(box.max.z.toFixed(2))],
          floorY: Number(floorY.toFixed(2)),
        },
        roof: {
          covered, total,
          share: Number((covered / total).toFixed(4)),
          enclosed,
          enclosedShare: enclosed ? Number((enclosedCovered / enclosed).toFixed(4)) : null,
          minY: heights.length ? Math.min(...heights) : null,
          maxY: heights.length ? Math.max(...heights) : null,
          hits: [...hitNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
        },
        firstFrame: {
          calls: stats.calls, triangles: stats.triangles,
          windowRegion: stats.windowRegion,
          windowTriangles: stats.windowTriangles,
          windowMeshes: stats.windowMeshes,
        },
        forced,
        buildMs: phases.length ? phases[phases.length - 1][1] : null,
        phases,
        opening,
      }
    })

    report.tiers[tier] = measured
    if (!WINDOW_ONLY) await page.screenshot({ path: `${SHOTS}/tier${tier}-room.png` })
    if (measured.opening && measured.opening.w > 8 && measured.opening.h > 8) {
      const { x, y, w, h } = measured.opening
      await page.screenshot({
        path: `${SHOTS}/tier${tier}-window.png`,
        clip: { x: Math.max(0, x - 8), y: Math.max(0, y - 8), width: Math.min(1600 - x, w + 16), height: Math.min(1000 - y, h + 16) },
      }).catch((error) => report.errors.push(`clip tier ${tier}: ${error.message}`))
    }

    if (!WINDOW_ONLY) {
      // The ceiling, from a camera pitched up at it. This is the picture that
      // makes a missing roof visible rather than only measurable.
      // What the player sees when they look up, through the room's own control.
      // This is the picture that decides whether a missing ceiling is a defect or
      // a detail off the top of the frame: the pitch clamp is +.42 rad, so 24
      // degrees of upward look is reachable with the arrow keys on any tier.
      // Dispatched at the canvas, which is where the look handler is bound and
      // which owns its own focus (`canvas.tabIndex = 0`). A click on the canvas
      // does not reliably focus it in a headless browser, and the keypresses then
      // go to the document and do nothing, which looks like a clamp that is
      // tighter than it is.
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas')
        if (!canvas) return
        canvas.focus()
        for (let press = 0; press < 14; press += 1) {
          canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
        }
      })
      await page.waitForTimeout(1600)
      await page.screenshot({ path: `${SHOTS}/tier${tier}-lookup.png` })

      // The same thing through the primary control: a drag down the canvas is
      // how a player looks up, and it reaches the clamp in one gesture.
      const box = await page.locator('canvas').first().boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width * .5, box.y + box.height * .35)
        await page.mouse.down()
        for (let step = 1; step <= 12; step += 1) {
          await page.mouse.move(box.x + box.width * .5, box.y + box.height * .35 + step * 60)
          await page.waitForTimeout(40)
        }
        await page.mouse.up()
        await page.waitForTimeout(1400)
        await page.screenshot({ path: `${SHOTS}/tier${tier}-dragup.png` })
      }

      // The room's own loop rewrites the camera from its rig on every frame, so
      // an override followed by one render is overwritten before the screenshot
      // is taken — which reads as "the override did nothing". The loop is stopped
      // first, by taking rAF away from it; the next navigation restores it.
      await page.evaluate(() => { window.requestAnimationFrame = () => 0 })
      await page.waitForTimeout(250)
      await page.evaluate(() => {
        const { camera, renderer, scene, THREE } = window.__officeDebug
        camera.position.set(0, 3.2, 3.4)
        camera.lookAt(new THREE.Vector3(0, 8.5, -2))
        camera.updateMatrixWorld()
        renderer.render(scene, camera)
      })
      await page.screenshot({ path: `${SHOTS}/tier${tier}-ceiling.png` })
    }

    console.log(
      `tier ${String(tier).padStart(2)}  roof ${(measured.roof.share * 100).toFixed(1)}%`,
      `enclosed ${measured.roof.enclosedShare === null ? '—' : (measured.roof.enclosedShare * 100).toFixed(1)}% of ${measured.roof.enclosed}`,
      `y ${measured.roof.minY}-${measured.roof.maxY}`,
      `calls ${measured.forced.calls}`,
      `tris ${measured.forced.triangles}`,
      `window ${measured.firstFrame.windowRegion} ${measured.firstFrame.windowTriangles}t/${measured.firstFrame.windowMeshes}m`,
      `build ${measured.buildMs}ms`,
      `| ${measured.roof.hits.map(([name, count]) => `${name}×${count}`).join(' ')}`,
    )
  }
} finally {
  writeFileSync(`${REPORTS}/office-audit-${tag}.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`\nwrote ${REPORTS}/office-audit-${tag}.json and ${SHOTS}`)
