/*
 * Is anybody standing in the road while they wait to cross?
 *
 * The defect this answers is a car driving into a stationary pedestrian at a
 * kerb on The Circuit. `collide.mjs` sees it only when a car happens to come
 * while somebody happens to be standing there, which is a coincidence and comes
 * and goes between runs. The standing itself is not a coincidence: either the
 * waiting body is inside the path the traffic takes or it is not, every frame
 * it waits, whether or not a car arrives.
 *
 * So this counts wait-frames and asks, of each one, how much room that body has
 * against a passing vehicle — using `TrafficSim.sweptClearance`, which is the
 * lane the vehicles actually drive rather than the carriageway they drive
 * inside. A district with zero exposed wait-frames cannot produce this contact.
 * One with thousands is only waiting for a car.
 */
import { open, region, save, TABS, OUT } from './lib.mjs'

const tag = process.argv[2] ?? 'base'
const only = process.argv.slice(3).filter((a) => !a.startsWith('--'))
const keys = only.length ? only : ['city', 'nation', 'continent']
const FRAMES = Number(process.env.MAPS_FRAMES ?? 3600)
/** `MAPS_STANDOFF=off` is the control: same build, kerb standoff disabled. */
const STANDOFF = process.env.MAPS_STANDOFF !== 'off'

async function measure({ frames, standoff }) {
  const scene = window.__mapScene
  const THREE = window.__mapThree
  const crowd = scene.crowd
  /*
   * The control is the same build with the standoff switched off at runtime,
   * not a different checkout. Arm and control then share a server lifetime, a
   * street plan and a crowd, which is the only way to compare anything on this
   * map: the frame counts have a mode structure nobody has explained yet, and a
   * figure taken across two lifetimes cannot tell a fix from a mode.
   */
  if (!standoff) for (const link of crowd?.crossings ?? []) link.waitBack = 0
  const sims = (scene.trafficSims ?? []).filter((sim) => typeof sim.sweptClearance === 'function')
  if (!crowd?.walkers) return { error: 'no crowd' }
  if (!sims.length) return { error: 'no sim exposes sweptClearance' }
  const originalRender = scene.renderer.render.bind(scene.renderer)
  scene.renderer.render = () => {}

  // The same body the collision harness uses, off a live rig.
  let walkerRadius = .12
  {
    const radii = []
    for (const walker of crowd.walkers) {
      if (!walker.active) continue
      const root = walker.rig?.root ?? walker.root
      if (!root || !root.visible) continue
      const box = new THREE.Box3().setFromObject(root)
      if (box.isEmpty() || box.max.y - box.min.y < .5) continue
      radii.push(Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2)
    }
    if (radii.length) {
      radii.sort((a, b) => a - b)
      walkerRadius = Math.max(.06, radii[radii.length >> 1])
    }
  }

  const clearanceAt = (x, z) => {
    let nearest = Number.POSITIVE_INFINITY
    for (const sim of sims) {
      const gap = sim.sweptClearance(x, z)
      if (gap < nearest) nearest = gap
    }
    return nearest
  }

  let waitFrames = 0
  let exposedFrames = 0
  let worst = Number.POSITIVE_INFINITY
  let worstAt = null
  const exposedSites = {}
  const waitSites = {}
  /*
   * The same question asked of everybody, not just of the ones standing at a
   * kerb — and, unlike the wait figure, it turns out not to mean much. Every
   * district spends about a third of its walker-frames inside a swept path
   * (33% / 39% / 31%), including the Old Quarter, which scores no contacts at
   * all, and the figure barely moves when the crowd is deliberately held to the
   * clear part of each pavement. Kept because that is worth knowing: the
   * pavements on this map are broadly inside the traffic and it is the *wait*,
   * where somebody stands still in one place for seconds at a time, that turns
   * that into a collision.
   */
  let bodyFrames = 0
  let onRoadFrames = 0
  let worstOnRoad = Number.POSITIVE_INFINITY
  const onRoadSites = {}
  // Cached on a five-centimetre grid, because the scan is over every road edge
  // and a waiting walker asks the same question every frame it waits.
  const cache = new Map()
  const cached = (x, z) => {
    const key = `${Math.round(x * 20)},${Math.round(z * 20)}`
    let clearance = cache.get(key)
    if (clearance === undefined) {
      clearance = clearanceAt(x, z)
      cache.set(key, clearance)
    }
    return clearance
  }

  for (let frame = 0; frame < frames; frame += 1) {
    window.__clock.tick(1)
    for (const walker of crowd.walkers) {
      if (!walker.active) continue
      const body = walker.rig?.root ?? walker.root
      if (body) {
        bodyFrames += 1
        const clearance = cached(body.position.x, body.position.z) - walkerRadius
        if (clearance < 0) {
          onRoadFrames += 1
          const at = `${Math.round(body.position.x)},${Math.round(body.position.z)}`
          onRoadSites[at] = (onRoadSites[at] ?? 0) + 1
          if (clearance < worstOnRoad) worstOnRoad = clearance
        }
      }
      if (walker.crossing < 0) continue
      if (walker.crossPhase !== 'wait') continue
      const root = walker.rig?.root ?? walker.root
      if (!root) continue
      waitFrames += 1
      const clearance = cached(root.position.x, root.position.z)
      const site = `${Math.round(root.position.x)},${Math.round(root.position.z)}`
      waitSites[site] = (waitSites[site] ?? 0) + 1
      // Room between this body's own edge and the side of a passing vehicle.
      const standing = clearance - walkerRadius
      if (standing >= 0) continue
      exposedFrames += 1
      exposedSites[site] = (exposedSites[site] ?? 0) + 1
      if (standing < worst) {
        worst = standing
        worstAt = [+root.position.x.toFixed(2), +root.position.z.toFixed(2)]
      }
    }
  }

  scene.renderer.render = originalRender
  return {
    region: scene.region,
    frames,
    walkerRadius: +walkerRadius.toFixed(4),
    network: crowd.networkReport ? crowd.networkReport() : null,
    waitFrames,
    exposedFrames,
    exposedShare: +(exposedFrames / Math.max(1, waitFrames)).toFixed(4),
    worstStanding: Number.isFinite(worst) ? +worst.toFixed(3) : 0,
    worstAt,
    topExposedSites: Object.entries(exposedSites).sort((a, b) => b[1] - a[1]).slice(0, 8),
    topWaitSites: Object.entries(waitSites).sort((a, b) => b[1] - a[1]).slice(0, 8),
    bodyFrames,
    onRoadFrames,
    onRoadShare: +(onRoadFrames / Math.max(1, bodyFrames)).toFixed(4),
    worstOnRoad: Number.isFinite(worstOnRoad) ? +worstOnRoad.toFixed(3) : 0,
    topOnRoadSites: Object.entries(onRoadSites).sort((a, b) => b[1] - a[1]).slice(0, 8),
  }
}

const report = {}
const { browser, page, errors } = await open()
try {
  for (const key of keys) {
    await region(page, TABS[key], { key })
    report[key] = await page.evaluate(measure, { frames: FRAMES, standoff: STANDOFF })
    const value = report[key]
    if (value.error) {
      console.log(key, 'ERROR', value.error)
      continue
    }
    console.log(key, JSON.stringify({
      standoff: STANDOFF ? 'on' : 'off',
      waitFrames: value.waitFrames,
      exposedFrames: value.exposedFrames,
      exposedShare: value.exposedShare,
      worstStanding: value.worstStanding,
      worstAt: value.worstAt,
      onRoadFrames: value.onRoadFrames,
      onRoadShare: value.onRoadShare,
      worstOnRoad: value.worstOnRoad,
      standoffs: value.network?.standoffs,
    }))
    console.log('   exposed', JSON.stringify(value.topExposedSites))
    console.log('   onRoad ', JSON.stringify(value.topOnRoadSites))
    console.log('   waits  ', JSON.stringify(value.topWaitSites))
    save(`${OUT}/wait-${tag}/${key}.json`, value)
  }
} finally {
  if (errors.length) console.log('page errors:', errors.slice(0, 3))
  await browser.close().catch(() => {})
}
