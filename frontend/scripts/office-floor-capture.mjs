// What each floor of the firm actually holds, and what it costs to draw.
//
// The office was split over two floors for one reason — thirty people in one
// room — so the claim that needs evidence is arithmetic before it is aesthetic:
// who is seated on which floor, how many of them, and what the room submits per
// frame with them in it and without. This drives the real office page through
// the dev overrides, reads the scene's own probes (`__officeSceneStats`,
// `__officeBuildPhases`, `__officePose`, `__officeFrameProfile`) and, on
// request, exercises the floor switch by clicking the control a player clicks.
//
// The renderer here is SwiftShader: there is no GPU under the headless shell on
// this machine. Triangle counts, draw calls, seat positions and build times are
// exact. Frame times are software raster and are only meaningful against each
// other, which is why every timing below is reported as a pair.
//
// Captures are written one at a time and the caller is expected to delete them.
//
// Usage: node scripts/office-floor-capture.mjs <outDir> <spec>[,<spec>...] [--switch]
//   spec = tier:floor:roster[:mode]
//     floor   practice | chambers
//     roster  all   the whole hireable firm, capped by the tier's own capacity
//             none  an empty floor, which is what makes staff cost a subtraction
//             a+b+c an explicit list of catalog keys, staff and fittings alike
//     mode    wide  screenshot the whole canvas as the owner sees it (default)
//             none  measure only
//   --switch  after the run, click the directory from floor one to floor two and
//             confirm the scene rebuilt into the other floor's roster
// Example: node scripts/office-floor-capture.mjs .shots 14:practice:all,14:chambers:all --switch

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.OFFICE_BASE_URL ?? 'http://localhost:5173'
const args = process.argv.slice(2).filter((entry) => entry !== '--switch')
const switchTest = process.argv.includes('--switch')
const outDir = args[0] ?? '.office-floor-shots'
const specs = (args[1] ?? '14:practice:all').split(',').filter(Boolean).map((entry) => {
  const [tier, floor = 'practice', roster = 'all', mode = 'wide'] = entry.split(':')
  return { tier: Number(tier), floor, roster, mode }
})

const executablePath = process.env.OFFICE_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const CDP_PORT = Number(process.env.OFFICE_CDP_PORT ?? 9361)
const profileDir = join(tmpdir(), `office-floor-${process.pid}`)

const chromeProcess = spawn(executablePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-sandbox',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--force-color-profile=srgb',
  'about:blank',
], { stdio: 'ignore' })

async function waitForCdp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) return
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`headless shell did not expose CDP on port ${CDP_PORT}`)
}

/**
 * Roster spec to the query the scene and the directory both read.
 *
 * An explicit list goes to `officeAssets`, which owns the purchase set and the
 * shift together — a starter office is a room with two things in it *and* one
 * person in it, and asking for the staff alone leaves whatever the seeded save
 * happened to have bought standing behind them.
 */
function rosterQuery(roster) {
  if (roster === 'all') return 'officeAll=1'
  if (roster === 'none') return 'officeAssets=none&officeStaff=none'
  return `officeAssets=${roster.split('+').join(',')}`
}

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
const report = []
let switchResult = null

try {
  await mkdir(outDir, { recursive: true })
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 1400, height: 940 })
  // This dev server is shared with whoever else is editing the app, and Vite
  // answers any save anywhere in `src` with a full page reload. A reload in the
  // middle of a three-second frame-profile window does not produce a wrong
  // number, it produces a destroyed execution context and a dead run — which is
  // how the first attempt at this report was lost. The HMR socket announces
  // itself with the `vite-hmr` subprotocol, so it is the one socket that gets a
  // stub that never delivers a message. Nothing else on the page uses one.
  await page.addInitScript(() => {
    const RealWebSocket = window.WebSocket
    window.WebSocket = function (url, protocols) {
      const requested = Array.isArray(protocols) ? protocols : protocols ? [protocols] : []
      if (!requested.includes('vite-hmr')) return new RealWebSocket(url, protocols)
      return {
        readyState: 0, url: String(url), protocol: '', bufferedAmount: 0, extensions: '',
        binaryType: 'blob', onopen: null, onclose: null, onerror: null, onmessage: null,
        send() {}, close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false },
      }
    }
    window.WebSocket.prototype = RealWebSocket.prototype
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    // The office opens on whatever story beat the seeded firm left off on, and
    // the card that announces it sits over the room. It is dismissable and the
    // dismissal is tried first, but a shot of the office should never be a shot
    // of a card, so the card is also not allowed to draw.
    document.addEventListener('DOMContentLoaded', () => {
      const sheet = document.createElement('style')
      sheet.textContent = '.chapter-prompt, .story-cutscene, .cutscene, .av-cutscene { display: none !important; }'
      document.head.append(sheet)
    })
  })
  const errors = []
  const reloads = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) reloads.push(frame.url()) })

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  const signIn = page.locator('button', { hasText: 'Enter local development firm' })
  await Promise.race([
    signIn.first().waitFor({ state: 'visible', timeout: 30000 }),
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 }),
  ])
  if (await signIn.count() > 0) {
    await signIn.first().click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
  }

  // Presses that go through the DOM rather than through the input pipeline.
  //
  // This machine runs several agents' browsers at once and has been seen at a
  // load average of 163. Playwright's actionability checks are driven by the
  // page's own animation frames, so under that contention a button that is
  // visible, enabled and unobstructed still takes longer than any sane timeout
  // to be declared clickable, and a run dies on a dismissable card. Where the
  // point of the click is its effect rather than its reachability, dispatching
  // it directly is the honest cheaper path. Where reachability *is* the claim —
  // the floor switch — the real click is tried first and this is the fallback,
  // and the report says which one landed.
  const forceClick = async (locator, timeout = 20000) => {
    if (await locator.count({ timeout }).catch(() => 0) === 0) return false
    return locator.first().evaluate((element) => element.click(), null, { timeout })
      .then(() => true)
      .catch(() => false)
  }
  // Narrative cards are dismissed if the page will let go of the main thread
  // long enough to take the click, and hidden if it will not. Under load the
  // second path is the one that runs, and for a picture of the room a hidden
  // card and a dismissed one are the same picture.
  const dismissCutscenes = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const defer = page.locator('.cutscene-defer, .cutscene-continue, .chapter-prompt-later')
      if (!await forceClick(defer)) return
      await page.waitForTimeout(350)
    }
  }
  await dismissCutscenes()

  /**
   * Everything the probes know about the room currently on screen.
   *
   * `staff[].frame` is the part that answers the composition question without
   * an opinion in it. The pose probe reports world positions for each body's
   * head and both feet; projecting those through the scene's own camera says
   * whether a person the player has paid for is actually on the screen. A foot
   * at ndc y below -1 is a body cropped by the bottom edge, which is what a
   * nearly empty office used to do to its single hire.
   */
  const readRoom = async () => page.evaluate(() => {
    const pose = window.__officePose?.() ?? null
    const debug = window.__officeDebug
    const project = (point) => {
      if (!debug || !point) return null
      const vector = new debug.THREE.Vector3(point[0], point[1], point[2]).project(debug.camera)
      return [Number(vector.x.toFixed(3)), Number(vector.y.toFixed(3))]
    }
    const framing = (person) => {
      const head = project(person.head)
      const feet = [project(person.lFoot), project(person.rFoot)].filter(Boolean)
      if (!head || !feet.length) return null
      const low = Math.min(...feet.map((foot) => foot[1]))
      const wide = Math.max(Math.abs(head[0]), ...feet.map((foot) => Math.abs(foot[0])))
      return { head, low: Number(low.toFixed(3)), wide: Number(wide.toFixed(3)), whole: low > -1 && head[1] < 1 && wide < 1 }
    }
    window.__frameOf = framing
    const directory = [...document.querySelectorAll('.office-floor-button')].map((button) => ({
      storey: button.querySelector('.office-floor-storey')?.textContent ?? '',
      name: button.querySelector('.office-floor-name')?.textContent ?? '',
      seated: Number(button.querySelector('.office-floor-count-number')?.textContent ?? '-1'),
      current: button.classList.contains('is-current'),
    }))
    return {
      url: location.pathname + location.search,
      scene: window.__officeSceneStats ?? null,
      phases: window.__officeBuildPhases ?? null,
      staff: pose ? pose.staff.map((person) => ({
        key: person.key, station: person.station, state: person.state, x: person.x, z: person.z, lod: person.lod,
        frame: framing(person),
      })) : [],
      directory,
    }
  })

  /** Mean CPU cost of a frame over a fixed window, split by what spends it. */
  const readFrameCost = async (ms = 2500) => {
    await page.evaluate(() => window.__officeFrameProfile?.start())
    await page.waitForTimeout(ms)
    const profile = await page.evaluate(() => window.__officeFrameProfile?.stop() ?? null)
    if (!profile || !profile.frames) return null
    return {
      frames: profile.frames,
      frameMs: Number((profile.total / profile.frames).toFixed(3)),
      humanoidMs: Number((profile.humanoid / profile.frames).toFixed(3)),
      renderMs: Number((profile.render / profile.frames).toFixed(3)),
    }
  }

  for (const { tier, floor, roster, mode } of specs) {
    const query = `officeTier=${tier}&officeFloor=${floor}&${rosterQuery(roster)}`
    await page.goto(`${baseUrl}/office?${query}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.office-three-canvas.is-ready', { timeout: 90000 })
    await dismissCutscenes()
    // The stats land on the first frame; the actors settle over the next second
    // or two, and a shot taken before that catches a body mid-interpolation.
    await page.waitForTimeout(2600)

    const room = await readRoom()
    if (room.scene && room.scene.level !== tier) {
      throw new Error(`asked for tier ${tier} and the scene built tier ${room.scene.level}; the session is probably not logged in (${room.url})`)
    }
    const cost = await readFrameCost()
    const total = room.phases ? room.phases.reduce((sum, [, value]) => sum + value, 0) : null
    report.push({
      tier, floor, roster,
      url: room.url,
      buildMs: total === null ? null : Number(total.toFixed(1)),
      scene: room.scene,
      seated: room.staff.length,
      staff: room.staff,
      directory: room.directory,
      cost,
    })

    // Written per spec rather than at the end. A run that dies on its sixth
    // room should still be able to report the five it measured.
    await writeFile(`${outDir}/report.json`, JSON.stringify({ report, switchResult, errors, reloads }, null, 2))

    if (mode === 'none') continue
    const box = await page.evaluate(() => {
      const canvas = document.querySelector('.office-three-canvas')
      if (!canvas) return null
      canvas.scrollIntoView({ block: 'center' })
      const rect = canvas.getBoundingClientRect()
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    })
    if (!box) throw new Error(`no canvas for tier ${tier} ${floor}`)
    const label = roster === 'all' ? 'full' : roster === 'none' ? 'empty' : `${roster.split('+').length}-owned`
    await page.screenshot({ timeout: 120000, path: `${outDir}/tier-${String(tier).padStart(2, '0')}-${floor}-${label}.png`, clip: box })
  }

  // Written before the switch test, because the switch is the part most likely
  // to fail and losing a measured run to it is how the last attempt at this
  // report came back empty.
  await writeFile(`${outDir}/report.json`, JSON.stringify({ report, switchResult, errors, reloads }, null, 2))

  // The switch, exercised the way a player exercises it. A directory that
  // renders and does nothing looks identical to one that works in a report
  // built only from URLs.
  if (switchTest) {
    await page.goto(`${baseUrl}/office?officeTier=14&officeAll=1`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.office-three-canvas.is-ready', { timeout: 90000 })
    await dismissCutscenes()
    await page.waitForTimeout(2200)
    const before = await readRoom()
    const target = page.locator('.office-floor-button', { hasText: 'Chambers' })
    const found = await target.count()
    // Whether the control is reachable at all, before trying to press it: a
    // button under a transparent overlay and a button whose handler is slow
    // fail identically from the outside.
    const hitTest = found ? await target.first().evaluate((button) => {
      const rect = button.getBoundingClientRect()
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return { onTop: button.contains(top), topClass: top?.className ?? null, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }
    }) : null
    let switchMs = null
    let switchError = null
    let clickPath = null
    if (found) {
      const started = Date.now()
      try {
        await target.first().click({ timeout: 60000 })
        clickPath = 'pointer'
      } catch (error) {
        switchError = String(error).split('\n')[0]
        await forceClick(target)
        clickPath = 'dispatched'
      }
      await page.waitForSelector('.office-three-canvas.is-ready', { timeout: 180000 }).catch(() => {})
      switchMs = Date.now() - started
      await page.waitForTimeout(2200)
    }
    const after = await readRoom()
    switchResult = {
      buttons: found,
      hitTest,
      switchMs,
      switchError,
      clickPath,
      before: { staff: before.staff.map((person) => person.key), directory: before.directory },
      after: { staff: after.staff.map((person) => person.key), directory: after.directory },
    }
    await writeFile(`${outDir}/report.json`, JSON.stringify({ report, switchResult, errors, reloads }, null, 2))
  }
  for (const entry of report) {
    const scene = entry.scene ?? {}
    const cost = entry.cost ?? {}
    process.stdout.write(
      `tier ${String(entry.tier).padStart(2)} ${entry.floor.padEnd(9)} ${String(entry.seated).padStart(2)} seated  `
      + `tris ${String(scene.triangles ?? '?').padStart(7)}  draws ${String(scene.calls ?? '?').padStart(5)}  `
      + `geo ${String(scene.geometries ?? '?').padStart(4)}  build ${String(entry.buildMs).padStart(7)} ms  `
      + `frame ${String(cost.frameMs ?? '-').padStart(7)} ms (skel ${String(cost.humanoidMs ?? '-').padStart(6)})\n`,
    )
    const missing = entry.directory.map((floor) => `${floor.name}:${floor.seated}${floor.current ? '*' : ''}`).join('  ')
    if (missing) process.stdout.write(`         directory  ${missing}\n`)
    // The cast's own share, walked from the actors rather than subtracted from
    // an empty room. An empty room is empty of desks too, so the subtraction
    // was charging every body for the workstation it sits at.
    const cast = scene.cast
    if (cast && cast.bodies) {
      process.stdout.write(
        `         cast       ${cast.bodies} bodies (${cast.full} full, ${cast.reduced} reduced)  `
        + `parts ${String(cast.parts).padStart(4)} (${cast.partsPerBody}/body)  `
        + `tris ${String(cast.triangles).padStart(6)} (${cast.trianglesPerBody}/body)`
        + (cast.draws === undefined ? '' : `  draws ${String(cast.draws).padStart(4)} (${cast.drawsPerBody}/body)`)
        + '\n',
      )
    }
    const cropped = entry.staff.filter((person) => person.frame && !person.frame.whole)
    if (entry.staff.length) {
      process.stdout.write(
        `         framing    ${entry.staff.length - cropped.length}/${entry.staff.length} whole`
        + (cropped.length ? `  cropped: ${cropped.map((person) => `${person.key}(low ${person.frame.low}, wide ${person.frame.wide})`).join(', ')}` : '')
        + '\n',
      )
    }
  }
  if (switchResult) {
    process.stdout.write(
      `\nfloor switch: ${switchResult.buttons} button(s); `
      + `${switchResult.before.staff.length} seated before -> ${switchResult.after.staff.length} after, `
      + `${switchResult.before.staff.filter((key) => switchResult.after.staff.includes(key)).length} in common, `
      + `took ${switchResult.switchMs} ms via ${switchResult.clickPath}\n`,
    )
    process.stdout.write(`  hit test: ${JSON.stringify(switchResult.hitTest)}\n`)
    if (switchResult.switchError) process.stdout.write(`  click error: ${switchResult.switchError}\n`)
    process.stdout.write(`  floor 1: ${switchResult.before.staff.join(', ')}\n`)
    process.stdout.write(`  floor 2: ${switchResult.after.staff.join(', ')}\n`)
  }
  if (errors.length) process.stdout.write(`PAGE ERRORS (${errors.length}):\n${errors.slice(0, 10).join('\n')}\n`)
  else process.stdout.write('no page errors\n')
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
}
