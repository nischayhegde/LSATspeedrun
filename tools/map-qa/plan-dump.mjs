/**
 * The district's own plan, on disk, so siting questions can be answered
 * offline.
 *
 * Every re-siting decision in this tree has so far been made by reading the
 * builder and guessing where the result lands, and then paying for a browser
 * run to find out. The plan is entirely deterministic and small — a few hundred
 * polylines — so it can be pulled out once and asked as many questions as the
 * job needs: where a carriageway is, where the crowd's pavements ended up after
 * the cut, and therefore where a two-and-a-half metre building could stand
 * without either of them running through it.
 *
 * Usage: node tools/map-qa/plan-dump.mjs <region> [<region> ...]
 */
import { open, region, save, TABS } from './lib.mjs'

const keys = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const REGIONS = keys.length ? keys : ['nation']

function dump() {
  const scene = window.__mapScene
  const world = scene.world
  const round = (value) => +Number(value).toFixed(3)
  const line = (points) => points.map(([x, z]) => [round(x), round(z)])
  const crowd = scene.crowd
  return {
    region: scene.region,
    roadWays: (world.userData.roadWays ?? []).map((way) => ({
      points: line(way.points),
      closed: Boolean(way.closed),
      kind: way.kind ?? 'road',
      width: way.width ?? null,
    })),
    footWays: (world.userData.footWays ?? []).map((way) => ({
      points: line(way.points),
      closed: Boolean(way.closed),
      halfWidth: way.halfWidth ?? null,
    })),
    // What the crowd actually walks: after `planFootways` split them at every
    // junction and `cutFootwaysAroundSolids` took the width back off them.
    crowdWays: (crowd?.ways ?? []).map((way) => ({
      halfWidth: round(way.halfWidth),
      centre: round(way.centre ?? 0),
      length: round(way.length),
      obstructed: Boolean(way.obstructed),
      // Flat `[x, z, x, z, ...]`, which is how `buildFootway` stores them.
      flat: Array.from(way.points ?? []).map(round),
    })),
    buildings: (world.userData.buildingAudit ?? []).map((record) => ({
      x: round(record.x), z: round(record.z), width: round(record.width), depth: round(record.depth), rotationY: round(record.rotationY ?? 0),
    })),
    pedestrianPlan: world.userData.pedestrianPlan ?? null,
    propPlacements: (world.userData.propAudit?.placements ?? []).map((prop) => ({
      name: prop.name, x: round(prop.x), z: round(prop.z), width: round(prop.width), depth: round(prop.depth),
    })),
  }
}

const { browser, page } = await open()
try {
  for (const key of REGIONS) {
    await region(page, TABS[key], { key, warmup: 0 })
    const plan = await page.evaluate(dump)
    save(`/Users/alan/LSATspeedrun/.maps/plan-${key}.json`, plan)
    console.log(key, {
      roads: plan.roadWays.length,
      foots: plan.footWays.length,
      crowdWays: plan.crowdWays.length,
      buildings: plan.buildings.length,
      props: plan.propPlacements.length,
    })
  }
} finally {
  await browser.close().catch(() => {})
}
