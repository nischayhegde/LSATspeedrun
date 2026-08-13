/**
 * The map and the retainer ledger, checked as one surface rather than two.
 *
 * They were built by different hands against the same data: the ledger owns
 * what a retainer costs and the map owns where it is, and each can name a
 * district to the other. This walks that round trip in a browser, because the
 * failure mode is not a type error — it is the two ends agreeing on a key and
 * disagreeing about which row it means, which only shows when you click.
 *
 * Also confirms the backend under test actually publishes `GameAsset.districts`.
 * Without it the contacts on the map have nothing to join on and render
 * nothing at all, silently, which looks exactly like a scene that did not build.
 *
 *   node tools/map-qa/join.mjs [tag]        MAPS_BASE selects the stack.
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import { open, region, save, TABS, OUT, BASE } from './lib.mjs'

const tag = process.argv[2] ?? 'demo'
const dir = `${OUT}/join-${tag}`
mkdirSync(dir, { recursive: true })
const report = { base: BASE }

async function shot(page, name, selector) {
  const target = selector ? await page.$(selector) : page
  if (target) await target.screenshot({ path: `${dir}/${name}.png` }).catch(() => {})
}

const { browser, page, errors } = await open()
try {
  /* ---- the account, read the way the app reads it ---- */
  report.account = await page.evaluate(async () => {
    const game = (await (await fetch('/v1/game', { credentials: 'include' })).json()).game
    const connections = game.catalog.assets.filter((asset) => asset.type === 'connection')
    const quarter = game.territory.districts.filter((district) => district.region === 'city')
    return {
      office_tier: game.office_tier,
      session: Boolean(game.active_session ?? game.session ?? null),
      old_quarter: `${quarter.filter((district) => district.owned).length} of ${quarter.length}`,
      connections_owned: connections.filter((asset) => asset.owned).length,
      connections_total: connections.length,
      districts_published: connections.filter((asset) => Array.isArray(asset.districts)).length,
      opens: connections.filter((asset) => asset.owned)
        .map((asset) => `${asset.key}: ${(asset.districts ?? []).map((row) => row.key).join(',') || 'NONE'}`),
    }
  })
  console.log('account:', JSON.stringify(report.account, null, 2))

  /* ---- the map half: contacts sited, and a selection that lights ---- */
  await region(page, TABS.city, { key: 'city' })
  report.scene = await page.evaluate(() => {
    const scene = window.__mapScene
    const siting = (scene.world.userData.landmarkSiting ?? []).filter((row) => row.label.startsWith('contact-'))
    return {
      region: scene.region,
      contacts: siting.map((row) => ({ key: row.label, cleared: row.cleared, moved: Number(row.moved.toFixed(2)) })),
      triangles: scene.renderer.info.render.triangles,
      calls: scene.renderer.info.render.calls,
    }
  })
  console.log('contacts:', JSON.stringify(report.scene.contacts))

  // Open the board first so the marked row is on screen to be judged, then
  // choose a district from the directory the way a player would.
  await page.evaluate(() => {
    for (const toggle of document.querySelectorAll('.uw-retainer-toggle, .uw-district-guide-toggle')) {
      if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
    }
  })
  await page.waitForTimeout(250)
  report.chose = await page.evaluate(() => {
    // A district with a retainer over it, not merely any place the planner laid
    // out: most landmarks have no row to light and would prove nothing.
    const rows = [...document.querySelectorAll('.uw-district-guide-list button')]
    const named = [...document.querySelectorAll('.uw-retainer-head strong')].map((node) => node.textContent.trim())
    const match = rows.find((row) => named.some((name) => row.textContent.includes(name)))
    if (match) match.click()
    return match ? match.textContent.trim() : null
  })
  await page.waitForTimeout(500)
  // Ticked, not slept: the overlay is set from the animate loop, which the
  // synthetic clock owns, so a real-time wait leaves it exactly as it was.
  await page.evaluate(() => window.__clock?.tick(60))
  report.marked = await page.evaluate(() => {
    const row = document.querySelector('.uw-retainer-row.is-asked-for')
    const brief = document.querySelector('.uw-district-brief')
    return {
      row: row?.querySelector('strong')?.textContent ?? null,
      rowColour: row ? getComputedStyle(row).borderLeftColor : null,
      briefShown: Boolean(brief),
      ledgerLink: document.querySelector('.uw-district-brief-ledger')?.textContent?.trim() ?? null,
      wash: window.__mapScene.world.children.some((child) => child.userData?.regionWash && child.visible
        && child.material.color.getHexString() === 'e4c36e'),
      rowBackground: row ? getComputedStyle(row).backgroundColor : null,
    }
  })
  console.log('map marked:', JSON.stringify(report.marked))
  await shot(page, 'map-selected')
  await shot(page, 'map-rail', '.uw-map-rail')

  /* ---- across to the ledger, carrying the district ---- */
  await page.evaluate(() => document.querySelector('.uw-district-brief-ledger')?.click())
  await page.waitForTimeout(1200)
  report.ledger = await page.evaluate(() => {
    const plot = document.querySelector('.retainer-plot.is-asked-for')
    return {
      url: location.pathname + location.search,
      tabs: [...document.querySelectorAll('.firm-tabs button, .firm-tab-bar button')].map((node) => node.textContent.trim()),
      region: document.querySelector('.retainer-regions button.active span')?.textContent ?? null,
      plot: plot?.querySelector('strong')?.textContent ?? null,
      plotColour: plot ? getComputedStyle(plot).borderColor : null,
    }
  })
  console.log('ledger:', JSON.stringify(report.ledger))
  await shot(page, 'ledger-marked')

  /* ---- and back again, which is the leg that already existed ---- */
  await page.evaluate(() => document.querySelector('.retainer-plot.is-asked-for .retainer-plot-map')?.click())
  // `null` in the argument slot: the options are the *third* parameter, and
  // passing them second leaves the wait on its rAF default polling, which this
  // document does not service.
  await page.waitForFunction(() => location.pathname === '/map', null, { timeout: 30000, polling: 100 })
  await page.waitForFunction(() => Boolean(window.__mapScene), null, { timeout: 120000, polling: 100 })
  await page.waitForTimeout(3000)
  await page.evaluate(() => window.__clock?.tick(240))
  await page.evaluate(() => window.__clock?.tick(120))
  report.returned = await page.evaluate(() => ({
    url: location.pathname + location.search,
    row: document.querySelector('.uw-retainer-row.is-asked-for strong')?.textContent ?? null,
    boardOpen: document.querySelector('.uw-retainer-board.is-open') !== null,
  }))
  console.log('returned:', JSON.stringify(report.returned))
  await shot(page, 'map-returned')

  report.errors = errors.slice(0, 10)
  save(`${dir}/report.json`, report)
  console.log('\nwrote', dir)
} finally {
  await browser.close().catch(() => {})
}
