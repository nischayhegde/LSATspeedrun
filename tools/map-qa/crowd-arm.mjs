/**
 * The crowd's scale, arm and control in one server lifetime.
 *
 * The request is to halve it, so that people fit the architecture. The scene
 * reads the figure through `crowdRenderScale()`, which in development prefers
 * `window.__mapCrowdScale`, so both arms are built from the same code in the
 * same page against the same crowd — the discipline `beam-arm.mjs` records at
 * length, and for the same reason: two server lifetimes are two worlds.
 *
 * Three things are measured, because "halve it" can fail in three ways.
 *
 *   the census    a render scale selects the crowd's detail rung as well as
 *                 scaling its root, and dropping a rung would change the
 *                 geometry every walker shares. Meshes, batches and triangles
 *                 must come back identical or the arms are not comparable.
 *   containment   twice over. Unpinned uses the body the arm actually draws,
 *                 which is the honest answer to "do fewer people end up inside
 *                 the buildings". Pinned fixes both the radius and the height
 *                 of the test body, which answers "did the plan change" — and
 *                 it must not, because a render scale is a scale on a root and
 *                 touches no setback. Both are needed: at half scale the body's
 *                 own band drops out of reach of half the district's kerbs, so
 *                 an unpinned pair moves for two reasons at once.
 *   the yardstick a person is the wrong size against something, not in the
 *                 abstract. The district's own storey and door heights are
 *                 derived from the measured facade heights through the rules in
 *                 `createBlockBuilding`, and the figure is reported as a
 *                 fraction of both, beside a still of it standing there.
 *
 * Usage: node tools/map-qa/crowd-arm.mjs <tag> <scale,scale,…> [region…]
 *   e.g. node tools/map-qa/crowd-arm.mjs halve .278,.139 city nation continent
 *
 * MAPS_STILLS=only takes the stills without re-measuring, which is what a second
 * look at the same arms wants: the numbers took twenty minutes and have not
 * changed, and the pictures are the half of this that decides it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { open, region, save, TABS, OUT } from './lib.mjs'
import { insideMetric, strandedMetric, INSIDE_SETTINGS } from './metrics.mjs'

const tag = process.argv[2] ?? 'crowd'
const scales = (process.argv[3] ?? '.278,.139').split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)
const keys = process.argv.slice(4).filter((argument) => TABS[argument])
const REGIONS = keys.length ? keys : ['city', 'nation', 'continent']
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)
const PARK_FRAMES = Number(process.env.MAPS_PARK_FRAMES ?? 900)
/** The pinned control body, the same figure `beam-arm.mjs` pins. */
const RADIUS = Number(process.env.MAPS_RADIUS ?? .25)
/**
 * And its height, which `beam-arm.mjs` never had to pin.
 *
 * .49 is what the crowd measures at the shipped .278 — the value quoted in the
 * note on `OCEAN_LANDFORM_TOP` — so the control tests the same person in both
 * arms from shins to shoulders, not just the same waist.
 */
const HEIGHT = Number(process.env.MAPS_HEIGHT ?? .49)
/** `only` skips the numbers, `skip` skips the pictures, anything else takes both. */
const STILLS = process.env.MAPS_STILLS ?? 'both'
const dir = `${OUT}/crowd-${tag}`

/**
 * What the renderer has to draw, and how tall the district is.
 *
 * The census is `landmark-cost.mjs`'s, for the same reason it exists there:
 * `renderer.info.render` reports one call and one triangle whatever is on
 * screen, because the style pass composites last and resets the counter.
 *
 * The yardstick is the part that decides this question. A walker's height in
 * scene units means nothing on its own; what matters is the fraction of a
 * storey and of a doorway it comes to. Both of those are authored in
 * `createBlockBuilding` as functions of a building's height — `floors =
 * max(2, floor(height / .68))` and `doorway = min(.82, height * .38)` — so the
 * measured facade heights are put back through those rules rather than through
 * a guess at what a storey is.
 */
function survey() {
  const scene = window.__mapScene
  const THREE = window.__mapThree
  const world = scene.world
  world.updateMatrixWorld(true)

  let meshes = 0
  let instanced = 0
  let instances = 0
  let triangles = 0
  /** Eaves height per building, from the facade batches' own instances. */
  const facadeHeights = []
  const box = new THREE.Box3()
  const matrix = new THREE.Matrix4()
  world.traverse((child) => {
    if (!child.isMesh) return
    const geometry = child.geometry
    const count = geometry?.index ? geometry.index.count : geometry?.attributes?.position?.count ?? 0
    triangles += (count / 3) * (child.isInstancedMesh ? child.count : 1)
    if (child.isInstancedMesh) {
      instanced += 1
      instances += child.count
    } else meshes += 1
    // Wall batches carry `aFacadeTile`; the rest of a facade group is roof and
    // ridge, and a ridge line is not what a person is measured against.
    if (!child.isInstancedMesh || !geometry?.attributes?.aFacadeTile) return
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    for (let index = 0; index < child.count; index += 1) {
      child.getMatrixAt(index, matrix)
      box.copy(geometry.boundingBox).applyMatrix4(matrix.premultiply(child.matrixWorld))
      const height = box.max.y - box.min.y
      if (height > .3) facadeHeights.push(height)
    }
  })

  const middle = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    if (!sorted.length) return null
    const half = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
  }
  const walkerHeights = []
  for (const walker of scene.crowd?.walkers ?? []) {
    const root = walker.rig?.root ?? walker.root
    if (!root) continue
    const bounds = new THREE.Box3().setFromObject(root)
    if (!bounds.isEmpty()) walkerHeights.push(bounds.max.y - bounds.min.y)
  }
  const lawyerRig = scene.lawyer?.children.find((child) => child.type === 'Group')
  const lawyerBounds = lawyerRig ? new THREE.Box3().setFromObject(lawyerRig) : null
  const round = (value) => (value === null ? null : +value.toFixed(3))

  const walker = middle(walkerHeights)
  const building = middle(facadeHeights)
  // The authored rules, applied to the measured building rather than to a
  // nominal one. `.68` is the target storey `createBlockBuilding` divides by;
  // what a storey actually comes to is the height divided by the floor count it
  // yields, which for a short building is taller than .68 and never shorter.
  const floors = building === null ? null : Math.max(2, Math.floor(building / .68))
  const storey = building === null ? null : building / floors
  const door = building === null ? null : Math.min(.82, building * .38)
  return {
    census: { meshes, instanced, instances, triangles: Math.round(triangles) },
    walkers: walkerHeights.length,
    walkerHeight: round(walker),
    lawyerHeight: lawyerBounds ? round(lawyerBounds.max.y - lawyerBounds.min.y) : null,
    buildings: facadeHeights.length,
    buildingHeight: round(building),
    storeyHeight: round(storey),
    doorHeight: round(door),
    // The two fractions the decision turns on. A person is about 58% of a
    // three-metre storey and about 87% of a two-metre door in the world the
    // player lives in.
    ofStorey: walker && storey ? +(walker / storey).toFixed(3) : null,
    ofDoor: walker && door ? +(walker / door).toFixed(3) : null,
  }
}

const report = { tag, scales, frames: FRAMES, pinned: { radius: RADIUS, height: HEIGHT }, at: new Date().toISOString(), arms: {} }
/*
 * A stills pass inherits the numbers rather than erasing them.
 *
 * Learned the direct way: `MAPS_STILLS=only` was added to re-take the pictures
 * for arms that had already been measured, it wrote its report at the end like
 * every other pass, and its report had an empty `arms` — so a second look at
 * the pictures destroyed the twenty minutes of measurement they were taken to
 * illustrate, under the same tag, with no warning.
 */
if (STILLS === 'only' && existsSync(`${dir}/report.json`)) {
  try {
    const previous = JSON.parse(readFileSync(`${dir}/report.json`, 'utf8'))
    if (previous.arms && Object.keys(previous.arms).length) {
      report.arms = previous.arms
      report.measuredAt = previous.at
      console.log(`carrying forward measured arms from ${dir}/report.json (${Object.keys(previous.arms).join(', ')})`)
    }
  } catch {
    console.warn(`could not read ${dir}/report.json; the stills will be written beside whatever is there`)
  }
}
const { browser, page, errors } = await open()
try {
  for (const scale of STILLS === 'only' ? [] : scales) {
    report.arms[scale] = {}
    for (const key of REGIONS) {
      // Set before the rebuild: a walker is built at this scale as well as
      // scaled to it, so a district already on screen is wearing the last arm.
      await page.evaluate((value) => { window.__mapCrowdScale = value }, scale)
      await region(page, TABS[key], { key })
      const applied = await page.evaluate(() => window.__mapCrowdScale)
      if (applied !== scale) throw new Error(`crowd scale override did not stick: asked ${scale}, page has ${applied}`)
      const surveyed = await page.evaluate(survey)
      const inside = await page.evaluate(insideMetric, { frames: FRAMES, ...INSIDE_SETTINGS })
      const control = await page.evaluate(insideMetric, { frames: FRAMES, radius: RADIUS, height: HEIGHT, ...INSIDE_SETTINGS })
      const parked = await page.evaluate(strandedMetric, { frames: PARK_FRAMES })
      report.arms[scale][key] = { applied, survey: surveyed, inside, control, parked }
      console.log(
        `\n=== ${key} crowd ${scale} === inside ${inside.share} (${inside.hits}/${inside.samples})`,
        `body r${inside.body.radius} h${inside.body.height} · control ${control.share} (r${control.body.radius} h${control.body.height})`,
      )
      console.log(
        `    ${surveyed.walkers} walkers at ${surveyed.walkerHeight} tall, counsel ${surveyed.lawyerHeight};`,
        `storey ${surveyed.storeyHeight} door ${surveyed.doorHeight} over ${surveyed.buildings} facades`,
      )
      console.log(`    a person is ${surveyed.ofStorey} of a storey and ${surveyed.ofDoor} of a door (people read .58 and .87)`)
      console.log(`    census ${surveyed.census.meshes} meshes + ${surveyed.census.instanced} batches`
        + ` (${surveyed.census.instances} instances) · ${surveyed.census.triangles} triangles`)
      console.log(
        `    ways ${parked.ways} (${parked.wayLength} m) parked ${parked.parked}/${parked.tracked} (${parked.parkedShare})`,
        `travelled median ${parked.travelledMedian}`,
      )
      for (const row of inside.worst.slice(0, 5)) {
        console.log(`    ${String(row.frames).padStart(5)}  ${row.what.padEnd(22)} ${row.box}  depth ${row.depth}  near ${row.near}`)
      }
      report.errors = errors.slice(0, 10)
      save(`${dir}/report.json`, report)
    }
  }

  /*
   * The stills, which are the half of this that decides it, in a pass of their
   * own on a reloaded page.
   *
   * They cannot be taken beside the numbers. `insideMetric` replaces
   * `renderer.render` with a no-op and does not put it back — deliberately, so
   * that nine hundred ticked frames cost nothing — and that renderer lives as
   * long as the map is mounted. Restoring it by hand does work and makes every
   * later district's six-hundred-tick warmup draw six hundred real frames on a
   * software rasteriser, which is where the first attempt at this spent its
   * thirty-second screenshot timeout. A reload is a new renderer, and a still
   * does not need the crowd pinned.
   *
   * The camera is moved with the map's own controls rather than by writing to
   * it: the scene eases towards its target every frame and would walk an
   * assignment back before the shutter. The easing is under the synthetic clock,
   * so its frames are ticked and not slept.
   *
   * Both stills start from a reset, and the first pass of this did not, which
   * made the pair of pictures the arm turns on incomparable. Zoom is a scene
   * variable that outlives a district rebuild: the four `in` clicks the close
   * still needs were still applied when the next arm's district still was taken,
   * so the second arm was photographed from a third of the distance and the two
   * pictures could not be laid over each other. `home` and `focus` both assign
   * `zoom = 1` outright and clear the pan, so a still that opens with one is
   * framed the same whatever the last one did.
   *
   * How long to wait after one is bounded at both ends, which is why it is a
   * number and not a guess. The camera lerps towards its resting place at
   * `1 - exp(-3.4 * delta)` a frame, so forty frames leaves a tenth of the
   * previous still's distance still in the shot — the reset was pressed and the
   * pictures were *still* framed differently. Three seconds is converged to
   * within a part in ten thousand. It cannot be much more than that: the
   * ambient camera drift fades in once the player has been idle 3.5 s, and its
   * yaw is a function of the scene's elapsed time, so a still taken after that
   * point is swaying by an amount that differs between arms.
   */
  const SETTLE = 170
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__mapScene), null, { timeout: 180000, polling: 100 })
  const settle = (count) => page.evaluate((frames) => window.__clock.tick(frames), count)
  const press = (label) => page.locator(`button[aria-label="${label}"]`).click().catch(() => {})
  for (const scale of STILLS === 'skip' ? [] : scales) {
    for (const key of REGIONS) {
      await page.evaluate((value) => { window.__mapCrowdScale = value }, scale)
      await region(page, TABS[key], { key, warmup: 90 })
      await press('Reset scene camera')
      await settle(SETTLE)
      await page.screenshot({ path: `${dir}/${key}-${scale}-district.png`, timeout: 120000 })
      await press('Focus camera on your lawyer')
      await settle(20)
      for (let step = 0; step < 4; step += 1) {
        await press('Move camera closer')
        await settle(8)
      }
      await settle(SETTLE)
      await page.screenshot({ path: `${dir}/${key}-${scale}-close.png`, timeout: 120000 })
      console.log(`stills ${key} ${scale}`)
    }
  }
} finally {
  report.errors = errors.slice(0, 10)
  save(`${dir}/report.json`, report)
  await browser.close().catch(() => {})
}
console.log(`\nwrote ${dir}/report.json`)
