/**
 * Screenshots of a district, taken through the game's own camera.
 *
 * The other tools in here measure; this one is the visual record that goes with
 * a change, because three passes of map work in a row have been argued about
 * from numbers alone and then had their evidence deleted.
 *
 * It does not touch the camera directly. The animate loop re-derives the camera
 * from the counsel's position every frame, so anything written into
 * `camera.position` is gone by the next tick and the canvas still holds the old
 * frame. Instead it walks the counsel to where the change is, using the scene's
 * own `walkTo`, and lets the follow camera arrive on its own. What lands in the
 * file is therefore a frame the game actually drew, post-processing and all.
 *
 * Usage: node tools/map-qa/shot.mjs <tag> <region> [x,z[,label]]...
 *   node tools/map-qa/shot.mjs after nation -3.5,6.4,green 7,-2.4,farmstead
 */
import { mkdirSync } from 'node:fs'
import { open, region as toRegion, TABS } from './lib.mjs'

const tag = process.argv[2] ?? 'shot'
const key = process.argv[3] ?? 'nation'
const stops = process.argv.slice(4).map((argument) => {
  const [x, z, label] = argument.split(',')
  return { x: Number(x), z: Number(z), label: label || `${x}_${z}` }
})

const dir = `/Users/alan/LSATspeedrun/.map-shots`
mkdirSync(dir, { recursive: true })

const { browser, page } = await open({ viewport: { width: 1600, height: 1000 } })
try {
  await toRegion(page, TABS[key], { key, warmup: 600 })
  const shot = async (name) => {
    const file = `${dir}/${tag}-${key}-${name}.png`
    await page.screenshot({ path: file })
    console.log(file)
  }
  // The panel an act intro puts over a third of the screen. `dismissOverlays`
  // only knows the cutscene's own two buttons; the headquarters brief carries a
  // third.
  const notNow = page.locator('button', { hasText: /^Not now$/ })
  if (await notNow.count()) await notNow.first().click().catch(() => {})

  // The district from above, through the map's own survey controls: `0` detaches
  // from the counsel and recentres, `-` steps the zoom out, and the loop lifts
  // the camera as it goes so a zoomed-out map is not just more rooftops at the
  // walking camera's oblique.
  const canvas = page.locator('canvas').first()
  await canvas.click({ position: { x: 20, y: 20 } }).catch(() => {})
  await page.keyboard.press('0')
  // Three steps, not eight. The zoom ceiling is far enough out that the scene
  // has already dropped to its distant line-art tier by then, which is a map of
  // the district rather than a picture of it.
  for (let step = 0; step < Number(process.env.MAPS_ZOOM_OUT ?? 3); step += 1) await page.keyboard.press('-')
  await page.evaluate(() => window.__clock.tick(180))
  await shot('survey')

  for (const stop of stops) {
    // A fixed walk time rather than one scaled by distance: the follow camera
    // settles on an exponential, so the last stretch of the approach is what
    // decides the framing, and it wants the same number of frames every time.
    await page.evaluate(({ x, z }) => window.__mapScene.walkTo(x, z, 4000), stop)
    await page.evaluate(() => window.__clock.tick(420))
    await shot(stop.label)
  }
} finally {
  await browser.close().catch(() => {})
}
