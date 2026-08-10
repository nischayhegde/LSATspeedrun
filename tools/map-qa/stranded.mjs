/**
 * Is anybody stuck?
 *
 * Every other pedestrian instrument here answers "where should this walker not
 * be", and a change that constrains the router can improve all of them by the
 * simple expedient of leaving people unable to go anywhere at all. A walker
 * standing still is inside nothing, so `inside.mjs` scores it as a success.
 *
 * This measures the opposite failure. It ticks the clock and watches each
 * walker's own progress: how far it actually travels, whether it is moving at
 * the end of a long window, and how much of the population is parked. The
 * network's own shape is reported alongside — ways, total length and how many
 * of them have no walkable width left — because a route that cannot be walked
 * and a route that has been deleted look identical from inside a walker.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'stranded'
const keys = process.argv.slice(3).filter((argument) => !argument.startsWith('--'))
const FRAMES = Number(process.env.MAPS_FRAMES ?? 900)

function watch(settings) {
  const { frames } = settings
  const scene = window.__mapScene
  scene.renderer.render = () => {}
  const crowd = scene.crowd

  const ways = crowd?.ways ?? []
  let length = 0
  let zeroWidth = 0
  for (const way of ways) {
    length += way.length ?? 0
    const half = way.halfWidth ?? way.half ?? null
    if (half !== null && half <= 0) zeroWidth += 1
  }

  const body = (walker) => walker.rig?.root ?? walker.root
  const seen = new Map()
  const note = () => {
    for (const walker of crowd?.walkers ?? []) {
      const object = body(walker)
      if (!object) continue
      const record = seen.get(walker) ?? (seen.set(walker, {
        travelled: 0, activeFrames: 0, lastX: object.position.x, lastZ: object.position.z,
        recentX: object.position.x, recentZ: object.position.z, recent: 0,
      }), seen.get(walker))
      if (!walker.active) continue
      record.activeFrames += 1
      record.travelled += Math.hypot(object.position.x - record.lastX, object.position.z - record.lastZ)
      record.lastX = object.position.x
      record.lastZ = object.position.z
    }
  }

  note()
  for (let frame = 0; frame < frames; frame += 1) {
    window.__clock.tick(1)
    note()
    // The last quarter on its own, so a walker that moved early and has since
    // parked is not hidden by the distance it covered before it stopped.
    if (frame === Math.floor(frames * .75)) {
      for (const [walker, record] of seen) {
        const object = body(walker)
        record.recentX = object ? object.position.x : record.lastX
        record.recentZ = object ? object.position.z : record.lastZ
        record.recent = 0
      }
    }
  }
  for (const [walker, record] of seen) {
    const object = body(walker)
    if (object) record.recent = Math.hypot(object.position.x - record.recentX, object.position.z - record.recentZ)
  }

  const rows = [...seen.values()].filter((record) => record.activeFrames > frames * .5)
  const travelled = rows.map((record) => record.travelled)
  const parked = rows.filter((record) => record.recent < .25).length
  travelled.sort((a, b) => a - b)
  return {
    region: scene.region,
    ways: ways.length,
    wayLength: +length.toFixed(1),
    zeroWidthWays: zeroWidth,
    walkers: crowd?.walkers?.length ?? 0,
    tracked: rows.length,
    parked,
    parkedShare: +(parked / Math.max(1, rows.length)).toFixed(4),
    travelledMedian: +(travelled[Math.floor(travelled.length / 2)] ?? 0).toFixed(2),
    travelledMin: +(travelled[0] ?? 0).toFixed(2),
  }
}

const { browser, page, errors } = await open()
const report = {}
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(watch, { frames: FRAMES })
    const row = report[key]
    console.log(`=== ${key} === ways ${row.ways} (${row.wayLength} m, ${row.zeroWidthWays} with no width)`
      + ` walkers ${row.tracked}/${row.walkers} parked ${row.parked} (${row.parkedShare})`
      + ` travelled median ${row.travelledMedian} min ${row.travelledMin}`)
  }
  report._errors = errors.slice(0, 10)
  save(`${OUT}/stranded-${tag}/report.json`, report)
} finally {
  await browser.close().catch(() => {})
}
