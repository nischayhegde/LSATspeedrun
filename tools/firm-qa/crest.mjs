// What the office says about a connection when you hover its wall crest.
//
// The scene publishes a DEV-only probe (`__officeEarningsProbe`) giving every
// pickable item's on-screen position and whether a pointer can actually reach
// it, so this drives real pointer input at a real crest rather than sweeping
// the canvas. Headed system Chrome: the headless software rasteriser cannot
// get a frame out of this room.
import { mkdirSync, writeFileSync } from 'node:fs'
import playwright from '/Users/alan/LSATspeedrun/node_modules/playwright/index.js'
const { chromium } = playwright

const APP = 'http://127.0.0.1:4372'
const API = 'http://127.0.0.1:5372'
const want = process.argv[2] ?? 'local_bar'
const out = '.qa-run/shots/crest'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await context.request.post(`${API}/v1/auth/dev`, { data: { email: 'firm-qa@localhost.test' } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

// The relationship wall lives upstairs in Chambers, not on the practice floor.
await page.goto(`${APP}/office?officeFloor=chambers`, { waitUntil: 'domcontentloaded' })

// The prologue reopens on navigation until it is answered, and it sits over
// the canvas, so it has to go before any pointer work.
for (let attempt = 0; attempt < 8; attempt += 1) {
  const modal = page.locator('.story-modal, [role="dialog"]').first()
  if (!(await modal.count()) || !(await modal.isVisible().catch(() => false))) break
  const choice = modal.locator('button').filter({ hasNotText: /not now|decide later/i }).first()
  const defer = modal.locator('button', { hasText: /not now|decide later/i }).first()
  if (await choice.count()) await choice.click({ timeout: 4000 }).catch(() => {})
  else if (await defer.count()) await defer.click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(700)
}

await page.waitForTimeout(6000)

// The crests hang on a side wall the camera does not start facing, so swing to
// them with the same `office-focus-asset` event the Firm tab's "see it in the
// office" link fires. This is the real path a player takes to a crest.
await page.evaluate((key) => {
  document.querySelector('.av-office')?.dispatchEvent(new CustomEvent('office-focus-asset', { detail: { key } }))
}, want)
await page.waitForTimeout(2500)

const probe = await page.evaluate(() => {
  for (const canvas of document.querySelectorAll('canvas')) {
    const fn = canvas.__officeEarningsProbe
    if (typeof fn === 'function') return fn()
  }
  return null
})
if (!probe) { console.log('no probe on any canvas'); await browser.close(); process.exit(1) }

const connections = probe.filter((item) => /bar|network|council|circle|forum|exchange|compact|assembly/.test(item.key))
console.log('connections seen:', connections.map((c) => `${c.key}${c.reachable ? '' : ' (unreachable)'}`).join(', ') || 'none')
const target = probe.find((item) => item.key === want) ?? connections.find((item) => item.reachable)
if (!target) { console.log('no crest found'); await browser.close(); process.exit(1) }
console.log(JSON.stringify({ key: target.key, mode: target.mode, reachable: target.reachable, blockedBy: target.blockedBy, onScreen: target.onScreen }, null, 2))

if (target.reachable) {
  await page.mouse.move(target.reachX, target.reachY, { steps: 6 })
  await page.waitForTimeout(400)
  // The scene throttles hover, and the camera is still easing when the probe
  // reports, so a single move can land before the crest arrives under it.
  for (let nudge = 0; nudge < 6; nudge += 1) {
    if (await page.locator('.office-readout-card').count()) break
    await page.mouse.move(target.reachX + (nudge % 2 ? 3 : -3), target.reachY + (nudge % 3 ? 2 : -2))
    await page.waitForTimeout(450)
  }
  await page.waitForTimeout(400)
  const card = page.locator('.office-readout').first()
  if (await card.count()) {
    console.log('CARD:', (await card.innerText()).replace(/\n/g, ' | '))
    const box = await page.locator('.office-readout-card').first().boundingBox()
    if (box) {
      // Clipped from a page shot rather than an element shot: the card is
      // anchored to a moving object, and Playwright's element capture scrolls
      // and re-measures, which lands on whatever drifted underneath.
      await page.screenshot({
        path: `${out}/${target.key}.png`,
        clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 },
      }).catch((e) => console.log('card shot skipped', e.message.split('\n')[0]))
    }
  } else {
    console.log('no readout card appeared')
  }
  await page.screenshot({ path: `${out}/${target.key}-room.png` }).catch(() => {})
}
writeFileSync(`${out}/probe.json`, JSON.stringify(probe, null, 2))
console.log('errors:', errors.length ? errors.join(' / ') : 'none')
await browser.close()
