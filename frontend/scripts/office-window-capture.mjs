// What the office window actually shows, and what the view costs.
//
// The window view is a purely visual feature, so the only honest report on it
// is a picture of the running app. This drives the real office page at chosen
// tiers through the dev tier override, crops the window bay out of the canvas,
// and reads back the build-phase stopwatch and the renderer's own triangle
// count. `officeWindowView=0` builds the same room without the view, which is
// what makes the cost a subtraction rather than a guess.
//
// Captures are written one at a time and the caller is expected to delete them:
// this machine's data volume runs at 97% and an image matrix is how the last
// few agents on this feature died.
//
// Usage: node scripts/office-window-capture.mjs <outDir> <spec>[,<spec>...]
//   spec = tier[:mode]
//     window  the opening, framed on the scene's own projection of it, with the
//             office's HTML overlays hidden so the glass is not behind a card
//     wide    the whole canvas as the owner sees it, overlays and all
//     plate   the whole canvas with purchased wall decor cleared but the staff
//             kept, which is the composition shot: owned decor is placed against
//             the front wall and a bought whiteboard hangs across the bay
//     cost    the same room with `officeWindowView=0`, measured and not captured
//     none    measured only
// Example: node scripts/office-window-capture.mjs .shots 1:window,8:window,10:wide

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.OFFICE_BASE_URL ?? 'http://localhost:5173'
const outDir = process.argv[2] ?? '.office-shots'
const specs = (process.argv[3] ?? '1:window').split(',').filter(Boolean).map((entry) => {
  const [tier, crop = 'window'] = entry.split(':')
  return { tier: Number(tier), crop }
})

// The headless shell rather than full Chrome: it is a third of the resident set
// of the branded build, which on a machine already swapping is the difference
// between a capture and a crash.
const executablePath = process.env.OFFICE_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const CDP_PORT = Number(process.env.OFFICE_CDP_PORT ?? 9357)
const profileDir = join(tmpdir(), `office-window-${process.pid}`)

const chromeProcess = spawn(executablePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-sandbox',
  // No GPU on this machine under a headless shell, so the raster is
  // SwiftShader's. Geometry, depth and the contour pass are exact; absolute
  // frame times are not, and nothing here reports one.
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--force-color-profile=srgb',
  'about:blank',
], { stdio: 'ignore' })

async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) return
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`headless shell did not expose CDP on port ${CDP_PORT}`)
}

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
const report = []

try {
  await mkdir(outDir, { recursive: true })
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 1400, height: 940 })
  // The scene announces where its own anchors land on the canvas, as per-cent of
  // it. Latching the window anchor from that is what makes the crop follow the
  // opening rather than guess at a fraction of a canvas whose size moves with
  // the page's layout. Registered before any app code runs, because the first
  // dispatch happens on the frame the room becomes ready.
  await page.addInitScript(() => {
    window.__windowAnchor = null
    document.addEventListener('office-anchor-update', (event) => {
      const anchor = event.detail?.window
      if (anchor) window.__windowAnchor = anchor
    }, true)
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  // A session may already be live, in which case `/login` bounces to the app on
  // its own and there is no button to press. Waiting unconditionally for the
  // button turns that into a spurious timeout.
  // `count()` does not auto-wait the way `click()` does, so this has to wait for
  // one of the two outcomes itself rather than sampling before React mounts.
  const signIn = page.locator('button', { hasText: 'Enter local development firm' })
  await Promise.race([
    signIn.first().waitFor({ state: 'visible', timeout: 30000 }),
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 }),
  ])
  if (await signIn.count() > 0) {
    await signIn.first().click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
  }

  // The seeded firm opens on whatever narrative beat it left off on and a
  // cutscene sits over the whole surface. It comes back on every navigation, so
  // this has to run per page load and not once at sign-in.
  const dismissCutscenes = async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      // Two different surfaces sit over the room: the cutscene, and the chapter
      // prompt card the office route raises when a narrative beat is waiting.
      // The card writes a deferral note when dismissed, so it stays gone across
      // the remount that the next navigation causes.
      const defer = page.locator('.cutscene-defer, .cutscene-continue, .chapter-prompt-later')
      if (await defer.count() === 0) return
      await defer.first().click()
      await page.waitForTimeout(350)
    }
  }
  await dismissCutscenes()

  for (const { tier, crop } of specs) {
    const withoutView = crop === 'cost'
    // `officeAssets` naming nothing that exists empties the purchase set, which
    // is how the glass gets judged on its own. Owned furniture and wall decor
    // are placed against the front wall and some of it stands in the bay; that
    // placement is older than the view and unchanged by it, but it makes a
    // picture of the view a picture of a whiteboard.
    const query = `officeTier=${tier}`
      + (withoutView ? '&officeWindowView=0' : '')
      + (crop === 'bare' || crop === 'calib' ? '&officeAssets=none&officeStaff=none' : '')
      + (crop === 'plate' ? '&officeAssets=none' : '')
      + (crop === 'calib' ? '&officeWindowDebugSheets=1' : '')
    await page.goto(`${baseUrl}/office?${query}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.office-three-canvas.is-ready', { timeout: 60000 })
    await dismissCutscenes()
    // The build stopwatch is complete at `is-ready`, but the scene stats are
    // written in the same tick and the actors settle over the next second or
    // two; a shot taken immediately catches staff mid-stride at the origin.
    await page.waitForTimeout(2600)

    const stats = await page.evaluate(() => ({
      phases: window.__officeBuildPhases ?? null,
      scene: window.__officeSceneStats ?? null,
      url: location.pathname + location.search,
    }))
    const total = stats.phases ? stats.phases.reduce((sum, [, ms]) => sum + ms, 0) : null
    report.push({ tier, crop, url: stats.url, buildMs: total === null ? null : Number(total.toFixed(1)), scene: stats.scene, phases: stats.phases })
    // The office route is behind a session. Logged out, the app serves a fixed
    // preview room that ignores the tier override, and every tier comes back
    // with the same triangle count — which is exactly how a capture run can
    // look successful and mean nothing.
    if (stats.scene && stats.scene.level !== tier) {
      throw new Error(`asked for tier ${tier} and the scene built tier ${stats.scene.level}; the session is probably not logged in (${stats.url})`)
    }

    if (crop === 'none' || withoutView) continue

    const box = await page.evaluate((mode) => {
      const canvas = document.querySelector('.office-three-canvas')
      if (!canvas) return null
      canvas.scrollIntoView({ block: 'center' })
      if (mode !== 'wide' && mode !== 'plate') {
        // The office's cards, badges and readouts are anchored in front of the
        // glass on purpose, and one of them covers most of the opening. They
        // belong in the composition shot and would make this one a photograph
        // of a card, so for the framed shot the overlay siblings step aside.
        // Hiding the office's direct children is not enough: the earnings
        // readout is a sibling of the canvas inside the same room wrapper, so
        // the walk has to descend through every ancestor of the canvas and hide
        // that ancestor's other children.
        const office = canvas.closest('.av-office')
        for (let node = canvas; node && node !== office; node = node.parentElement) {
          for (const sibling of node.parentElement?.children ?? []) {
            if (sibling !== node) sibling.style.visibility = 'hidden'
          }
        }
      }
      const rect = canvas.getBoundingClientRect()
      if (mode === 'wide' || mode === 'plate') {
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      }
      const anchor = window.__windowAnchor
      if (!anchor) return null
      // The opening is about three and a half metres across at roughly seven
      // from the camera, which on this field of view is a little under half the
      // canvas; a little over half gives the frame and its jambs room.
      const width = rect.width * .46
      const height = width * 1.05
      const centreX = rect.x + rect.width * (anchor.x / 100)
      const centreY = rect.y + rect.height * (anchor.y / 100)
      return {
        x: Math.round(Math.max(rect.x, Math.min(rect.x + rect.width - width, centreX - width / 2))),
        y: Math.round(Math.max(rect.y, Math.min(rect.y + rect.height - height, centreY - height / 2))),
        width: Math.round(width),
        height: Math.round(height),
      }
    }, crop)
    if (!box) throw new Error(`no crop for tier ${tier}: canvas or window anchor missing`)

    const shot = await page.screenshot({ path: `${outDir}/tier-${String(tier).padStart(2, '0')}-${crop}.png`, clip: box })

    // What the view's bands actually come back as, up the middle of the opening.
    //
    // An aerial perspective is an ordering of values before it is anything else,
    // and "is the sky brighter than the ground" is not a question to settle by
    // squinting at a screenshot. Read through the compositor rather than off the
    // WebGL canvas, which without `preserveDrawingBuffer` hands back nothing.
    if (crop !== 'wide' && crop !== 'plate') {
      const bands = await page.evaluate(async ([base64, mode]) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const scratch = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = scratch.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        // A narrow column up the centre of the opening, in five stripes from the
        // head of the window to the sill.
        const columnX = Math.round(bitmap.width * .42)
        const columnWidth = Math.round(bitmap.width * .16)
        const rows = mode === 'calib'
          ? Array.from({ length: 19 }, (unused, index) => .08 + index * .036)
          : [.2, .35, .5, .62, .76]
        return rows.map((fraction) => {
          const y = Math.round(bitmap.height * fraction)
          const data = context.getImageData(columnX, y, columnWidth, Math.max(2, Math.round(bitmap.height * .03))).data
          let r = 0, g = 0, b = 0
          for (let index = 0; index < data.length; index += 4) { r += data[index]; g += data[index + 1]; b += data[index + 2] }
          const pixels = data.length / 4
          return {
            at: fraction,
            rgb: [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)],
            luma: Math.round((r * .2126 + g * .7152 + b * .0722) / pixels),
          }
        })
      }, [shot.toString('base64'), crop])
      report[report.length - 1].bands = bands
    }
  }

  await writeFile(`${outDir}/report.json`, JSON.stringify({ report, errors }, null, 2))
  for (const entry of report) {
    const scene = entry.scene ?? {}
    process.stdout.write(
      `tier ${String(entry.tier).padStart(2)} ${entry.crop.padEnd(7)} build ${String(entry.buildMs).padStart(7)} ms  `
      + `triangles ${String(scene.triangles ?? '?').padStart(7)}  draws ${String(scene.calls ?? '?').padStart(4)}  `
      + `geometries ${String(scene.geometries ?? '?').padStart(4)}  `
      + `view ${String(scene.windowRegion ?? '-').padEnd(9)} ${String(scene.windowTriangles ?? '-').padStart(5)} tris `
      + `in ${String(scene.windowMeshes ?? '-').padStart(2)} meshes\n`,
    )
    if (entry.bands) {
      process.stdout.write(`         head-to-sill luma  ${entry.bands.map((band) => String(band.luma).padStart(3)).join('  ')}\n`)
    }
  }
  if (errors.length) process.stdout.write(`PAGE ERRORS (${errors.length}):\n${errors.slice(0, 10).join('\n')}\n`)
  else process.stdout.write('no page errors\n')
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
}
