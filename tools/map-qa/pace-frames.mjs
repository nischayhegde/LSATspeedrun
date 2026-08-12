/**
 * What the two pace bands look like, a frame at a time.
 *
 * `pace.mjs` reports the cadence as a number and the numbers are decisive, but a
 * gait is a thing you watch rather than read: the complaint that started this was
 * "the halved crowd looks like it is on fast-forward", which is a statement about
 * how far a leg swings between one frame and the next. So this takes the same
 * walker in both bands, at a fixed number of ticks apart, and writes a strip of
 * frames cropped to the body — where a longer swing per frame is the fault, in
 * the picture, rather than an inference from a ratio.
 *
 * Both strips are of *one* walker chosen for being near the camera and near the
 * middle of the frame, and the crop follows its projected position, because a
 * pedestrian is a hundred pixels tall in a 1600-wide district shot and a
 * full-frame screenshot of a crowd shows nothing about anybody's legs.
 *
 * The renderer is deliberately **not** parked here, unlike every measuring probe
 * in this directory: the whole output is what it drew.
 *
 * ## State: it crops the right body, and the framing is not yet worth reading
 *
 * The selection and the crop work — it follows one walker by seed across both
 * bands and tracks its projected position — but the strips it produced are not
 * usable evidence and the pace change was not argued from them. Two reasons, both
 * fixable and neither started: the headquarters brief panel overlays the middle of
 * the canvas and only `shot.mjs` knows to dismiss it, and the nearest on-screen
 * walker in the Old Quarter is twenty-odd units out, which is a forty-pixel
 * figure inside a two-hundred-pixel crop. It wants the overlay dismissed and the
 * camera pulled in the way `crowd-arm.mjs` does it, with the survey controls.
 *
 * The case for the change is in `pace.mjs` instead, which reports the cadence in
 * steps a second — a number that says "sprint" or "walk" without a picture.
 *
 * Usage: node tools/map-qa/pace-frames.mjs [region] [scale]
 */
import { mkdirSync } from 'node:fs'
import { open, region as toRegion, TABS, OUT } from './lib.mjs'

const key = process.argv[2] ?? 'city'
const SCALE = Number(process.argv[3] ?? .139)
const BANDS = (process.env.MAPS_BANDS ?? 'world,body').split(',')
/** Frames in the strip, and ticks between them. */
const FRAMES = Number(process.env.MAPS_FRAMES ?? 6)
const EVERY = Number(process.env.MAPS_EVERY ?? 8)
const REFERENCE = .278

const dir = `${OUT}/pace-frames`
mkdirSync(dir, { recursive: true })

/**
 * Pick the walker to follow, and hold the choice across both bands.
 *
 * Chosen by seed rather than by index so the two strips are the same person:
 * the population is rebuilt between bands and an index is a slot, not a walker.
 *
 * Chosen by where it lands *on screen* rather than by how near the camera it is,
 * which was the first version and does not work: the camera follows the counsel
 * at an oblique, so the closest walker in the district is as likely to be behind
 * it as in front, and the first run of this probe faithfully cropped to a point
 * two thousand pixels below a 798-pixel canvas six times over.
 */
function choose() {
  const scene = window.__mapScene
  const crowd = scene.crowd
  const camera = scene.camera
  const canvas = scene.renderer.domElement
  const rect = canvas.getBoundingClientRect()
  const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  let best = null
  for (const walker of crowd?.walkers ?? []) {
    if (!walker.active || walker.phase !== 'run') continue
    const distance = walker.root.position.distanceTo(camera.position)
    if (distance > (crowd.animateWithin ?? 30)) continue
    const vector = walker.root.position.clone().project(camera)
    if (vector.z <= -1 || vector.z >= 1 || Math.abs(vector.x) > .8 || Math.abs(vector.y) > .8) continue
    const x = rect.left + (vector.x * .5 + .5) * rect.width
    const y = rect.top + (-vector.y * .5 + .5) * rect.height
    // Near the middle of the frame, and near the camera as the tie-break, so
    // the body is as many pixels tall as this district will give.
    const offset = Math.hypot(x - centre.x, y - centre.y) + distance * 4
    if (!best || offset < best.offset) best = { seed: walker.seed, distance, offset, x, y }
  }
  return best
}

/** Where that walker is on screen right now, as a crop box. */
function frame(settings) {
  const scene = window.__mapScene
  const crowd = scene.crowd
  const camera = scene.camera
  const canvas = scene.renderer.domElement
  const walker = (crowd?.walkers ?? []).find((entry) => entry.seed === settings.seed && entry.active)
  if (!walker) return null
  // Page coordinates, not canvas ones. `clip` is measured on the screenshot,
  // which is the whole page, and the canvas sits inside a laid-out document —
  // clipping in canvas space asked for a box off the top of the image.
  const rect = canvas.getBoundingClientRect()
  const rig = walker.rig
  // The head and the soles, projected, so the crop is the body's own extent
  // rather than a guessed number of pixels.
  //
  // Projected through a clone of a vector the scene already owns: `three` is a
  // bare specifier and `import('three')` does not resolve inside an evaluated
  // string, so there is no constructor to hand here — but every Object3D
  // carries a `position` that clones into one.
  const project = (object) => {
    const point = object.matrixWorld.elements
    const vector = walker.root.position.clone().set(point[12], point[13], point[14])
    vector.project(camera)
    return {
      x: rect.left + (vector.x * .5 + .5) * rect.width,
      y: rect.top + (-vector.y * .5 + .5) * rect.height,
      // Behind the camera, or outside the frustum, in which case there is
      // nothing to crop to and the strip should skip rather than guess.
      onScreen: vector.z > -1 && vector.z < 1 && Math.abs(vector.x) < 1.1 && Math.abs(vector.y) < 1.1,
    }
  }
  const top = project(rig.head ?? walker.root)
  const foot = project(walker.root)
  return {
    top,
    foot,
    onScreen: top.onScreen && foot.onScreen,
    head: Boolean(rig.head),
    page: { width: window.innerWidth, height: window.innerHeight },
    canvas: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  }
}

const { browser, page } = await open({ viewport: { width: 1600, height: 1000 } })
try {
  for (const band of BANDS) {
    await page.evaluate((value) => { window.__mapCrowdScale = value }, SCALE)
    await toRegion(page, TABS[key], { key, warmup: 300 })
    if (band === 'world') {
      // The same inversion `pace.mjs` uses: the old world-unit band is the
      // shipped band's speed at the reference scale, held there.
      await page.evaluate(({ reference, scale }) => {
        const factor = reference / scale
        for (const walker of window.__mapScene.crowd?.walkers ?? []) {
          walker.cruise *= factor
          walker.speed *= factor
        }
      }, { reference: REFERENCE, scale: SCALE })
    }
    // Let the crowd reach the pace it was just given before choosing anybody:
    // `speed` eases towards `cruise`, so the first frames after the rewrite are
    // of a walker still accelerating.
    await page.evaluate(() => window.__clock.tick(90))
    const pick = await page.evaluate(choose)
    if (!pick) { console.log(`${band}: nobody on screen`); continue }
    console.log(`${band} band: following seed ${pick.seed.toFixed(2)} at ${pick.distance.toFixed(1)} units,`
      + ` on screen at ${pick.x.toFixed(0)},${pick.y.toFixed(0)}`)
    for (let index = 0; index < FRAMES; index += 1) {
      const box = await page.evaluate(frame, { seed: pick.seed })
      if (!box) console.log(`  frame ${index}: the walker is gone`)
      else if (!box.onScreen) {
        console.log(`  frame ${index}: off screen — head ${box.top.x.toFixed(0)},${box.top.y.toFixed(0)}`
          + ` foot ${box.foot.x.toFixed(0)},${box.foot.y.toFixed(0)}`
          + ` canvas ${box.canvas.width.toFixed(0)}×${box.canvas.height.toFixed(0)}`
          + ` at ${box.canvas.left.toFixed(0)},${box.canvas.top.toFixed(0)}`
          + ` page ${box.page.width}×${box.page.height}${box.head ? '' : ' (no head node)'}`)
      }
      if (box?.onScreen) {
        // A body's height in pixels, padded, so the strip is legs and pavement
        // and not a district.
        const size = Math.max(80, Math.abs(box.foot.y - box.top.y) * 2.6 + 90)
        const centre = { x: (box.top.x + box.foot.x) / 2, y: (box.top.y + box.foot.y) / 2 }
        // Clamped to the page, so a walker near an edge yields a smaller strip
        // rather than an error. Playwright rejects a clip that leaves the image
        // at all, which cost this probe its first run.
        const x = Math.min(Math.max(0, centre.x - size / 2), Math.max(0, box.page.width - size))
        const y = Math.min(Math.max(0, centre.y - size / 2), Math.max(0, box.page.height - size))
        const clip = {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(Math.min(size, box.page.width - x)),
          height: Math.round(Math.min(size, box.page.height - y)),
        }
        const file = `${dir}/${key}-${SCALE}-${band}-${String(index).padStart(2, '0')}.png`
        await page.screenshot({ path: file, clip, timeout: 180000 })
        console.log(`  ${file} (${clip.width}×${clip.height} at ${clip.x},${clip.y})`)
      }
      // Chunked, with a pause: a screenshot on a software rasteriser is a
      // second of work on the same thread the frames run on, and ticking
      // straight through a strip of them times the shot out.
      await page.evaluate((count) => window.__clock.tick(count), EVERY)
      await page.waitForTimeout(60)
    }
  }
} finally {
  await browser.close().catch(() => {})
}
