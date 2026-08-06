// Pedestrian rig adoption QA: multi-frame Old Quarter sequence + Circuit perf baseline.
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import path from 'node:path'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('/Users/alan/LSATspeedrun/.rig-qa-shots')
fs.mkdirSync(OUT, { recursive: true })

const REGION_LABEL = {
  city: 'Old Quarter',
  nation: 'The Circuit',
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('button', { hasText: 'Enter local development firm' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 25000 })
}

async function dismissOverlays(page) {
  for (let i = 0; i < 12; i++) {
    const defer = page.locator('.cutscene-defer, .cutscene-continue')
    if (await defer.count() === 0) return
    await defer.first().click()
    await page.waitForTimeout(350)
  }
}

async function openMap(page) {
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__mapScene, { timeout: 90000 })
  await dismissOverlays(page)
}

async function openRegion(page, region) {
  if (await page.evaluate(() => window.__mapScene?.region) === region) return
  const toggle = page.locator('.uw-atlas-toggle')
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.locator('.uw-arc-navigation button', { hasText: REGION_LABEL[region] }).first().click()
  await page.waitForFunction((r) => window.__mapScene?.region === r, region, { timeout: 90000 })
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
  await page.waitForTimeout(1400)
}

async function measureFrames(page, frames = 90) {
  return page.evaluate((count) => new Promise((resolve) => {
    const samples = []
    let previous = performance.now()
    const tick = () => {
      const now = performance.now()
      samples.push(now - previous)
      previous = now
      if (samples.length >= count) {
        const sorted = samples.slice(4).sort((a, b) => a - b)
        const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
        const info = window.__mapScene?.renderer?.info
        resolve({
          medianMs: +at(.5).toFixed(2),
          p95Ms: +at(.95).toFixed(2),
          drawCalls: info?.render?.calls ?? null,
          triangles: info?.render?.triangles ?? null,
        })
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), frames)
}

async function measureRenderCost(page, iterations = 60) {
  return page.evaluate((count) => {
    const handle = window.__mapScene
    if (!handle) return null
    const { renderer, scene, camera } = handle
    for (let warm = 0; warm < 5; warm += 1) renderer.render(scene, camera)
    const samples = []
    for (let index = 0; index < count; index += 1) {
      const start = performance.now()
      renderer.render(scene, camera)
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    return {
      renderMedianMs: +samples[Math.floor(samples.length * .5)].toFixed(3),
      renderP95Ms: +samples[Math.floor(samples.length * .95)].toFixed(3),
    }
  }, iterations)
}

async function crowdFingerprint(page) {
  return page.evaluate(() => {
    const THREE = window.__mapThree
    const crowdRenderer = window.__mapScene?.crowdRenderer
    if (!crowdRenderer || !THREE) return { error: 'no crowd renderer' }
    let capsuleInstances = 0
    let sphereInstances = 0
    crowdRenderer.group?.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        if (object.geometry?.type === 'CapsuleGeometry') capsuleInstances = object.count
        if (object.geometry?.type === 'SphereGeometry') sphereInstances = object.count
      }
    })
    return {
      capsuleInstances,
      sphereInstances,
      groupChildren: crowdRenderer.group?.children?.length ?? 0,
    }
  })
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chromium',
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await login(page)
  await openMap(page)

  const report = { at: new Date().toISOString(), regions: {} }

  for (const region of ['city', 'nation']) {
    await openRegion(page, region)
    const canvas = page.locator('.uw-three-scene canvas')
    const reset = page.locator('.uw-map-toolbar button[aria-label="Reset scene camera"]')
    if (await reset.count()) { await reset.click(); await page.waitForTimeout(1400) }

    const closer = page.locator('.uw-map-toolbar button[aria-label="Move camera closer"]')
    if (region === 'city' && await closer.count()) {
      for (let i = 0; i < 4; i++) { await closer.click(); await page.waitForTimeout(220) }
      await page.waitForTimeout(800)
    }

    const build = await page.evaluate(() => ({
      firstFrameMs: +(window.__mapScene?.firstFrameMs ?? 0).toFixed(1),
    }))
    const frames = await measureFrames(page)
    const cost = await measureRenderCost(page)
    const fingerprint = await crowdFingerprint(page)
    report.regions[region] = { ...build, ...frames, ...cost, crowd: fingerprint }

    if (region === 'city') {
      for (let frame = 0; frame < 8; frame += 1) {
        await canvas.screenshot({ path: path.join(OUT, `city-pedestrians-${String(frame).padStart(2, '0')}.png`) })
        await page.waitForTimeout(400)
      }
    } else {
      await canvas.screenshot({ path: path.join(OUT, 'circuit-baseline-wide.png') })
    }
  }

  fs.writeFileSync(path.join(OUT, 'crowd-rig-metrics.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
