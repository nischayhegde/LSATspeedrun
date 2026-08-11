/**
 * Portraits, with and without the contact term, on one mounted card.
 *
 * The busts are drawn by a pooled renderer that is resized to each entry in
 * turn, so there is no single long-lived scene to reach into the way the map
 * and the office have. `__lsatCharacters` is the live registry, and every
 * entry on it carries its own composite, which is enough: the whole set can be
 * retuned together and the page photographed twice.
 *
 * Usage: node tools/light-qa/portrait-ab.mjs <tag>
 */
import { mkdirSync } from 'node:fs'
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import { homedir } from 'node:os'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5411'
const CHROME = process.env.LIGHT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const tag = process.argv[2] ?? 'portrait'
const OUT = `/private/tmp/lsat-light/.light-shots/${tag}`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
// The hero idles, so the two arms of the comparison would otherwise photograph
// two different poses. Reduced motion parks the rig and makes the pair
// pixel-comparable.
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' })
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click({ timeout: 180000 })
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 })
  await page.evaluate(() => localStorage.setItem('lsat-tour-v6', 'done')).catch(() => {})

  // Only the office hero owns a renderer, and so a composite, of its own; the
  // busts share a pooled renderer and never see the illustrated pass. So the
  // hero is the portrait surface the contact term has to be judged on.
  for (const [path, label] of [['/office', 'office']]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    // The opening chapter takes the whole screen on a fresh firm, and it arrives
    // a beat after the route does, so wait for it before trying to clear it.
    // "Decide later" hands it to the corner prompt, and "Not now" retires that.
    await page.waitForSelector('.cutscene-overlay', { timeout: 25000 }).catch(() => {})
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const layer = page.locator('.cutscene-defer, .chapter-prompt-later')
      if (await layer.count() === 0) break
      await layer.first().click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(500)
    }
    await page.waitForFunction(() => [...(window.__lsatCharacters ?? [])].some((entry) => entry.stylePass), { timeout: 90000, polling: 200 })
    await page.waitForTimeout(4000)

    const authored = await page.evaluate(() => {
      const first = [...window.__lsatCharacters].find((entry) => entry.stylePass)
      return first ? first.stylePass.occlusionStrength : null
    })
    for (const [name, strength] of [['off', 0], ['on', authored]]) {
      // Entries repaint on demand, so retuning the composite is not enough on
      // its own — each one has to be marked dirty to be redrawn.
      // A reduced-motion entry parks its frame loop once it is painted, so a
      // dirty flag would never be picked up. The hero owns its renderer and its
      // composite draws straight to its canvas, so the pass can be driven from
      // here — which also holds the pose still between the two arms.
      await page.evaluate((value) => {
        for (const entry of window.__lsatCharacters) {
          if (!entry.stylePass || !entry.renderer) continue
          entry.stylePass.configure({ occlusion: value })
          entry.renderer.clear(true, true, true)
          entry.stylePass.render(entry.scene, entry.camera)
        }
      }, strength)
      await page.waitForTimeout(400)
      for (const [index, node] of (await page.locator('.stylized-character').all()).entries()) {
        const classes = await node.getAttribute('class')
        if (!classes?.includes('hero') && !classes?.includes('full')) continue
        await node.screenshot({ path: `${OUT}/${label}-${index}-hero-${name}.png` }).catch(() => {})
      }
      await page.locator('.av-character-panel').first().screenshot({ path: `${OUT}/${label}-panel-${name}.png` }).catch(() => {})
    }
    await page.evaluate((value) => {
      for (const entry of window.__lsatCharacters) entry.stylePass?.configure({ occlusion: value })
    }, authored)
    console.log(`${label}: ${await page.locator('.stylized-character').count()} characters, authored occlusion ${authored}`)
  }
} finally {
  await browser.close().catch(() => {})
}
console.log(`stills in ${OUT}`)
