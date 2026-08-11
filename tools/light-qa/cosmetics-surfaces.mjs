/**
 * Does an equipped piece reach the surfaces the player actually looks at?
 *
 * `wardrobe-audit.mjs` asks the builder, which is the right first question and
 * cannot answer the second one. It calls `buildStylizedCounsel` itself, so it
 * proves a piece *can* reach a figure; it says nothing about whether the app
 * ever asks for that figure. Everything between the wardrobe screen and the
 * scene is untested by it: the PATCH, the refetch, `applyPlayerCosmetics`,
 * whether the registry is filled before `createLawyer` runs, and whether a rig
 * built once is rebuilt when the player changes their mind.
 *
 * So this drives the real path. Each piece is equipped through
 * `PATCH /v1/game/cosmetics` — the same endpoint the wardrobe screen calls, with
 * the same unlock gate, which is why it needs a firm that has unlocked
 * everything (`tools/map-qa/late-firm.py`) — and then both surfaces are opened
 * and the *live* rigs in them are measured:
 *
 *   portrait  `window.__lsatCharacters`, the office hero's own rig
 *   map       the `userData.lawyer` root inside `window.__mapScene`
 *
 * A piece is judged reached if the live rig differs from the same surface's
 * undressed baseline. Stills are captured beside every measurement, because a
 * count cannot say whether a briefcase is in the hand or through the shin.
 *
 *   python tools/map-qa/late-firm.py
 *   LIGHT_BASE=http://127.0.0.1:5174 node tools/light-qa/cosmetics-surfaces.mjs v1
 *   ... v1 suit_pinstripe accessory_briefcase    # named pieces only
 *   ... v1 --sample                              # one piece per category on the map
 *   ... v1 --map                                 # skip the portrait half
 *
 * Both surfaces are rebuilt from scratch for every piece, which is a page load
 * and a region build each: about twelve seconds a piece, six minutes for the
 * suite. That is cheap enough that the default run does all twenty-eight on both.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launch } from './browser.mjs'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5174'
const EMAIL = process.env.LIGHT_EMAIL || 'late-firm@localhost.test'
const ROOT = process.env.LIGHT_OUT || fileURLToPath(new URL('../../.light', import.meta.url))
const argv = process.argv.slice(2)
const tag = argv[0] ?? 'surfaces'
const named = argv.slice(1).filter((entry) => !entry.startsWith('--'))
const mapOnly = argv.includes('--map')
const SHOTS = `${ROOT}/.light-shots/cosmetics-${tag}`
const REPORTS = `${ROOT}/.light-run`
mkdirSync(SHOTS, { recursive: true })
mkdirSync(REPORTS, { recursive: true })

/** The suite, restated: see the note in `wardrobe-audit.mjs` on why. */
const SUITE = {
  suit: ['suit_house_navy', 'suit_charcoal', 'suit_slate', 'suit_forest', 'suit_oxblood', 'suit_cream_linen', 'suit_pinstripe'],
  tie: ['tie_house_burgundy', 'tie_open_collar', 'tie_regimental', 'tie_gold_foulard', 'tie_bow', 'tie_cravat'],
  hair: ['hair_signature', 'hair_cropped', 'hair_full', 'hair_distinguished'],
  eyewear: ['eyewear_as_issued', 'eyewear_none', 'eyewear_round', 'eyewear_rectangular', 'eyewear_tortoiseshell'],
  accessory: ['accessory_as_issued', 'accessory_none', 'accessory_lapel_pin', 'accessory_pocket_square', 'accessory_wristwatch', 'accessory_briefcase'],
}
const CATEGORY_OF = Object.fromEntries(
  Object.entries(SUITE).flatMap(([category, keys]) => keys.map((key) => [key, category])),
)
/** One piece per category that adds geometry, when `--sample` cuts the run. */
const MAP_SAMPLE = ['suit_pinstripe', 'tie_regimental', 'hair_full', 'eyewear_tortoiseshell', 'accessory_briefcase']

/** Daylight, and the region whose own street the figure was drawn against. */
const REGION = 'city'
const REGION_TAB = 'Old Quarter'

const items = named.length ? named : Object.values(SUITE).flat()
const mapItems = named.length ? named : argv.includes('--sample') ? MAP_SAMPLE : items

const report = { tag, base: BASE, email: EMAIL, at: new Date().toISOString(), items: {}, errors: [] }

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
page.on('pageerror', (error) => report.errors.push(String(error.message).slice(0, 300)))
page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text().slice(0, 300)) })

/**
 * Everything about a live rig a wardrobe piece could move, read off the scene
 * graph the surface is drawing rather than off one this probe built.
 *
 * Installed as an init script rather than passed to `evaluate` as source and
 * eval'd, so it survives every navigation and needs no relaxation of whatever
 * the page's own script policy turns out to be.
 */
await page.addInitScript(() => {
  window.__rigSignature = (root, THREE) => {
    let meshes = 0
    let triangles = 0
    let colour = 0
    const box = new THREE.Box3()
    root.updateWorldMatrix(true, true)
    root.traverse((node) => {
      if (!node.isMesh) return
      meshes += 1
      const index = node.geometry.getIndex()
      const position = node.geometry.getAttribute('position')
      triangles += index ? index.count / 3 : (position ? position.count / 3 : 0)
      if (node.material && node.material.color) colour = (colour + node.material.color.getHex()) % 0xffffffff
      box.expandByObject(node)
    })
    const round = (value) => Number(value.toFixed(3))
    return {
      meshes, triangles, colour,
      box: [round(box.min.x), round(box.min.y), round(box.min.z), round(box.max.x), round(box.max.y), round(box.max.z)].join(),
    }
  }
})

async function equip(key) {
  const category = CATEGORY_OF[key]
  if (!category) throw new Error(`${key} is not in the suite`)
  return page.evaluate(async ({ category, key }) => {
    // The same header `api.ts` sends on every non-GET: without it the endpoint
    // answers 403 and the probe would report the whole suite as broken.
    const csrf = document.cookie.split('; ').find((row) => row.startsWith('lsat_csrf='))?.split('=')[1]
    const response = await fetch('/v1/game/cosmetics', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}) },
      credentials: 'include',
      body: JSON.stringify({ selection: { [category]: key } }),
    })
    const body = await response.json().catch(() => null)
    const error = body?.error
    return {
      status: response.status,
      wearing: body?.cosmetics?.selection ?? null,
      error: error ? (error.code ?? error.message ?? JSON.stringify(error)) : null,
    }
  }, { category, key })
}

/** The office hero's live rig, and a still of it. */
async function portrait(label) {
  await page.goto(`${BASE}/office`, { waitUntil: 'domcontentloaded' })
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const layer = page.locator('.cutscene-defer, .chapter-prompt-later, .tour-offer-decline')
    if (await layer.count() === 0) break
    await layer.first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
  await page.waitForFunction(() => {
    const entries = window.__lsatCharacters
    return Boolean(entries) && [...entries].some((entry) => entry.rig && entry.role === 'counsel')
  }, null, { timeout: 120000, polling: 200 })
  await page.waitForTimeout(1500)
  const measured = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    // The player's own portrait is an unseeded `counsel`; every other entry on
    // the page is a seeded cast member and is meant to be unaffected. Both are
    // returned, so an item leaking onto the cast would be visible too.
    const rows = []
    for (const entry of window.__lsatCharacters ?? []) {
      if (!entry.rig?.root) continue
      rows.push({ role: entry.role, mode: entry.mode, hero: Boolean(entry.stylePass), ...window.__rigSignature(entry.rig.root, THREE) })
    }
    return rows
  })
  const hero = page.locator('.stylized-character-hero, .stylized-character-full, .stylized-character').first()
  await hero.screenshot({ path: `${SHOTS}/portrait-${label}.png` }).catch(() => {})
  const own = measured.find((row) => row.role === 'counsel' && row.hero) ?? measured.find((row) => row.role === 'counsel')
  return { own, all: measured }
}

/** The map's own counsel figure, and a crop of the map around it. */
async function mapFigure(label) {
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    for (const button of document.querySelectorAll('.chapter-prompt-later, .tour-offer-decline, .cutscene-defer')) button.click()
  }).catch(() => {})
  await page.waitForFunction(() => Boolean(window.__mapScene?.world), null, { timeout: 180000, polling: 200 })
  // The Old Quarter, always: the map opens on whichever region the firm's tier
  // puts it in, which for a tier-14 firm is the Global Compact — a figure in
  // silhouette against a night sky, where a burgundy tie and an ivory cravat
  // are the same colour. Daylight is where a wardrobe can be judged.
  if (await page.evaluate(() => window.__mapScene?.region) !== REGION) {
    const toggle = page.locator('.uw-atlas-toggle')
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') {
      await toggle.click()
      await page.waitForTimeout(250)
    }
    await page.locator('.uw-arc-navigation button', { hasText: REGION_TAB }).first().click()
    await page.waitForFunction((want) => window.__mapScene?.region === want, REGION, { timeout: 120000, polling: 100 })
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
  }
  await page.waitForTimeout(2500)
  /*
   * The map's own two controls, not a camera this probe drove itself: "focus
   * camera on your lawyer", then closer four times. At the region's opening
   * standoff the figure is about twenty pixels tall, which is enough for a mesh
   * census and useless for judging whether a cravat is ivory. The scene eases
   * towards a camera target every frame, so an override written from here would
   * be walked back before the shutter; asking the app to move it is not.
   */
  await page.locator('button[aria-label="Focus camera on your lawyer"]').click().catch(() => {})
  for (let step = 0; step < 4; step += 1) {
    await page.locator('button[aria-label="Move camera closer"]').click().catch(() => {})
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(2200)
  const measured = await page.evaluate(async () => {
    const THREE = window.__mapThree ?? await import('/node_modules/three/build/three.module.js')
    const signature = window.__rigSignature
    const scene = window.__mapScene
    let lawyer = null
    scene.world.traverse((node) => { if (node.userData?.lawyer) lawyer = node })
    if (!lawyer) return null
    // The rig only: the beacon, the shingle and the label are the map's own
    // furniture and would drown a lapel pin in the counts.
    const rig = lawyer.children.find((child) => child.type === 'Group') ?? lawyer
    /*
     * The crop is fitted to the figure's own bounding box, projected corner by
     * corner, rather than to its origin. Two earlier versions framed on the
     * root's world position and cut the figure off: the origin is at the ground
     * between the feet, and the rig walks, so it is neither the middle of the
     * body nor reliably under it.
     */
    const box = new THREE.Box3().setFromObject(rig)
    const screen = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 }
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(scene.camera)
          screen.minX = Math.min(screen.minX, point.x)
          screen.maxX = Math.max(screen.maxX, point.x)
          screen.minY = Math.min(screen.minY, point.y)
          screen.maxY = Math.max(screen.maxY, point.y)
        }
      }
    }
    const round = (value) => Number(value.toFixed(3))
    return {
      ...signature(rig, THREE),
      screen: { minX: round(screen.minX), minY: round(screen.minY), maxX: round(screen.maxX), maxY: round(screen.maxY) },
      region: scene.region,
    }
  })
  if (measured?.screen) {
    const size = page.viewportSize()
    const { minX, minY, maxX, maxY } = measured.screen
    const left = (minX + 1) / 2 * size.width
    const right = (maxX + 1) / 2 * size.width
    const top = (1 - maxY) / 2 * size.height
    const bottom = (1 - minY) / 2 * size.height
    const margin = Math.max(40, (bottom - top) * .35)
    const x = Math.max(0, left - margin)
    const y = Math.max(0, top - margin)
    await page.screenshot({
      path: `${SHOTS}/map-${label}.png`,
      clip: {
        x, y,
        width: Math.min(size.width - x, right - left + margin * 2),
        height: Math.min(size.height - y, bottom - top + margin * 2),
      },
    }).catch(() => {})
  }
  return measured
}

const same = (a, b) => Boolean(a) && Boolean(b) && a.meshes === b.meshes && a.triangles === b.triangles
  && a.colour === b.colour && a.box === b.box

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const signedIn = await page.evaluate(async (email) => {
    const response = await fetch('/v1/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, display_name: 'Late Firm' }),
    })
    return response.status
  }, EMAIL)
  if (signedIn !== 200) throw new Error(`dev sign-in for ${EMAIL} returned ${signedIn} (backend needs DEV_AUTH_ENABLED=true)`)

  /*
   * The baseline is the firm's own defaults, which is what "unchanged" has to be
   * measured against on a live surface. It cannot be the undressed figure the
   * builder audit uses: this firm is dressed by the time any page renders, and
   * `PATCH` cannot express "wear nothing".
   */
  const defaults = await page.evaluate(async () => {
    const response = await fetch('/v1/game/cosmetics', { credentials: 'include' })
    const body = await response.json()
    const categories = body.cosmetics.categories
    return Object.fromEntries(categories.map((category) => [category.key, category.default]))
  })
  report.defaults = defaults
  for (const [category, key] of Object.entries(defaults)) await equip(key)
  const basePortrait = mapOnly ? null : await portrait('baseline')
  const baseMap = await mapFigure('baseline')
  report.baseline = { portrait: basePortrait?.own ?? null, map: baseMap, wearing: defaults }
  console.log(`baseline  portrait ${basePortrait?.own?.meshes ?? '-'}m/${basePortrait?.own?.triangles ?? '-'}t`
    + `  map ${baseMap?.meshes ?? '-'}m/${baseMap?.triangles ?? '-'}t on ${baseMap?.region ?? '-'}`)
  if (!baseMap) report.errors.push('no userData.lawyer figure found in the map scene')

  const findings = []
  for (const key of items) {
    const wanted = mapItems.includes(key)
    const equipped = await equip(key)
    if (equipped.status !== 200) {
      findings.push(`${key}: PATCH returned ${equipped.status} ${equipped.error ?? ''}`)
      continue
    }
    if (equipped.wearing?.[CATEGORY_OF[key]] !== key) {
      findings.push(`${key}: the server says it is wearing ${equipped.wearing?.[CATEGORY_OF[key]]}`)
      continue
    }
    const row = { category: CATEGORY_OF[key], wearing: equipped.wearing }
    if (!mapOnly) {
      const shot = await portrait(key)
      row.portrait = shot.own
      row.portraitMovedFromDefault = !same(shot.own, basePortrait?.own)
      // A piece must not reach the seeded cast, who are other people.
      row.cast = shot.all.filter((entry) => entry.role !== 'counsel').length
    }
    if (wanted) {
      const figure = await mapFigure(key)
      row.map = figure
      row.mapMovedFromDefault = !same(figure, baseMap)
    }
    report.items[key] = row
    const isDefault = defaults[CATEGORY_OF[key]] === key
    const flags = []
    if (!mapOnly && !row.portraitMovedFromDefault && !isDefault) flags.push('PORTRAIT-SAME-AS-DEFAULT')
    if (wanted && !row.mapMovedFromDefault && !isDefault) flags.push('MAP-SAME-AS-DEFAULT')
    if (wanted && !figureAgrees(row)) flags.push('SURFACES-DISAGREE')
    if (flags.length) findings.push(`${key}: ${flags.join(' ')}`)
    console.log(
      `${key.padEnd(26)} portrait ${String(row.portrait?.meshes ?? '-').padStart(3)}m/${String(row.portrait?.triangles ?? '-').padStart(6)}t`
      + `  map ${String(row.map?.meshes ?? '-').padStart(3)}m/${String(row.map?.triangles ?? '-').padStart(5)}t`
      + `  ${flags.length ? flags.join(' ') : 'ok'}${isDefault ? ' (this firm\'s default)' : ''}`,
    )
  }
  for (const [category, key] of Object.entries(defaults)) await equip(key)
  report.findings = findings
  console.log(`\n${findings.length} findings`)
  for (const line of findings) console.log(`  ${line}`)
} finally {
  writeFileSync(`${REPORTS}/cosmetics-surfaces-${tag}.json`, JSON.stringify(report, null, 2))
  await browser.close().catch(() => {})
}

/**
 * The two surfaces have to agree about whether the piece arrived. They cannot
 * be compared directly — the map figure is a different rung of the same builder
 * and carries no beacon in this count — so what is compared is the verdict.
 */
function figureAgrees(row) {
  if (row.portrait === undefined || row.map === undefined) return true
  return row.portraitMovedFromDefault === row.mapMovedFromDefault
}

console.log(`\nwrote ${REPORTS}/cosmetics-surfaces-${tag}.json and stills in ${SHOTS}`)
