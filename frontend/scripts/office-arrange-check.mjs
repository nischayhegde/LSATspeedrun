// Does the rearrangeable, irregular office hold together?
//
// Three claims are checked here and all three are the kind that render fine
// while being wrong, which is why they are measured rather than looked at:
//
//   layout      the seeded entropy in `office-entropy` moves chairs, people,
//               desk clutter and whole department bays off the grid. Nothing
//               it moves may end up inside anything else. `layoutAudit`
//               walks the built room and reports every interpenetrating pair.
//   determinism the same office must be the same office on the next load. The
//               page is opened twice and the seat coordinates compared.
//   drag        every movable piece is picked up with real pointer events at
//               its own screen position, carried, and dropped, and the room
//               is re-audited afterwards. A piece that cannot be grabbed and
//               a piece that can be dropped inside a filing cabinet look the
//               same from a screenshot.
//
// Draw calls are reported alongside, before and after the drags, because
// taking a prop out of the room batch to move it is exactly the change that
// would quietly undo the batching work.
//
// Usage: node scripts/office-arrange-check.mjs <outDir> <spec>[,<spec>...] [--drag] [--shots]
//   spec = tier:floor[:width]   width defaults to 1440
// Example: node scripts/office-arrange-check.mjs .shots 14:practice,2:practice --drag --shots

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.OFFICE_BASE_URL ?? 'http://localhost:5474'
const flags = new Set(process.argv.slice(2).filter((entry) => entry.startsWith('--')))
const args = process.argv.slice(2).filter((entry) => !entry.startsWith('--'))
const outDir = args[0] ?? '.office-arrange'
const specs = (args[1] ?? '14:practice').split(',').filter(Boolean).map((entry) => {
  const [tier, floor = 'practice', width = '1440'] = entry.split(':')
  return { tier: Number(tier), floor, width: Number(width) }
})
const doDrag = flags.has('--drag')
const doShots = flags.has('--shots')

const executablePath = process.env.OFFICE_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const CDP_PORT = Number(process.env.OFFICE_CDP_PORT ?? 9377)
// One reused profile: this machine is at 99% disk and a fresh Chromium
// profile is 20 MB a run.
const profileDir = join(tmpdir(), 'office-arrange-profile')

const chromeProcess = spawn(executablePath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  'about:blank',
], { stdio: 'ignore' })

async function waitForCdp() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) return } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('headless shell never exposed CDP')
}

await waitForCdp()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
const report = []

try {
  await mkdir(outDir, { recursive: true })
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  // Same HMR stub the floor harness uses: a save anywhere in `src` reloads the
  // page and destroys a run mid-measurement.
  await page.addInitScript(() => {
    const RealWebSocket = window.WebSocket
    window.WebSocket = function (url, protocols) {
      const requested = Array.isArray(protocols) ? protocols : protocols ? [protocols] : []
      if (!requested.includes('vite-hmr')) return new RealWebSocket(url, protocols)
      return {
        readyState: 0, url: String(url), protocol: '', bufferedAmount: 0, extensions: '', binaryType: 'blob',
        onopen: null, onclose: null, onerror: null, onmessage: null,
        send() {}, close() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false },
      }
    }
    window.WebSocket.prototype = RealWebSocket.prototype
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    document.addEventListener('DOMContentLoaded', () => {
      const sheet = document.createElement('style')
      sheet.textContent = '.chapter-prompt, .story-cutscene, .cutscene, .av-cutscene { display: none !important; }'
      document.head.append(sheet)
    })
  })

  await page.setViewportSize({ width: 1440, height: 940 })
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  const signIn = page.locator('button', { hasText: 'Enter local development firm' })
  await Promise.race([
    signIn.first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {}),
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40000 }).catch(() => {}),
  ])
  if (await signIn.count() > 0) {
    await signIn.first().evaluate((element) => element.click())
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40000 }).catch(() => {})
  }

  const openOffice = async ({ tier, floor, width }, extra = '') => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 940 })
    await page.goto(`${baseUrl}/office?officeTier=${tier}&officeFloor=${floor}&officeAll=1${extra}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.office-three-canvas.is-ready', { timeout: 120000 })
    await page.waitForTimeout(2600)
  }
  const readScene = async () => page.evaluate(() => {
    const canvas = document.querySelector('.office-three-canvas')
    return {
      stats: window.__officeSceneStats ?? null,
      // Live, unlike `__officeSceneStats`, which is a first-frame snapshot.
      frame: window.__officeDebug?.frameStats?.() ?? null,
      audit: window.__officeDebug?.layoutAudit?.() ?? null,
      batch: window.__officeDebug?.roomBatchCensus?.() ?? null,
      drift: window.__officeDebug?.roomDrift?.() ?? null,
      draggables: window.__officeDebug?.draggables?.() ?? [],
      earnings: canvas?.__officeEarningsProbe?.() ?? [],
      seats: (window.__officePose?.().staff ?? []).map((person) => `${person.key}@${person.x},${person.z}`),
    }
  })

  for (const spec of specs) {
    // Anything a previous run left in local storage would move the furniture
    // before this one had a chance to measure where it starts.
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith('lsat-tycoon:office-layout:')) window.localStorage.removeItem(key)
      }
    }).catch(() => {})

    await openOffice(spec)
    const before = await readScene()

    // Determinism: the same page, opened again, has to seat the same people
    // in the same centimetres.
    await openOffice(spec)
    const second = await readScene()
    const stable = JSON.stringify(before.seats) === JSON.stringify(second.seats)

    // And the grid it was taken off, for the A/B.
    await openOffice(spec, '&officeEntropy=0')
    const rigid = await readScene()

    await openOffice(spec)
    const moved = []
    if (doDrag) {
      const items = (await readScene()).draggables.filter((item) => item.onScreen)
      for (const item of items) {
        const target = await page.evaluate((key) => {
          const found = window.__officeDebug.draggables().find((entry) => entry.key === key)
          return found ?? null
        }, item.key)
        if (!target || !target.onScreen) continue
        // Arm the drop listener before the gesture, not after it: the event
        // fires on release, so a listener attached later never hears it.
        await page.evaluate(() => {
          window.__dropHeard = null
          const canvas = document.querySelector('.office-three-canvas')
          if (canvas.__dropSpy) canvas.removeEventListener('office-furniture-moved', canvas.__dropSpy)
          canvas.__dropSpy = (event) => { window.__dropHeard = event.detail }
          canvas.addEventListener('office-furniture-moved', canvas.__dropSpy)
        })
        // A real gesture: press on the piece, travel in steps so the move
        // handler runs the way it does under a hand, release.
        await page.mouse.move(target.clientX, target.clientY)
        await page.waitForTimeout(90)
        // Two different failures look identical from the outside: the hit test
        // missing the piece, and the pointer landing on a panel stacked over
        // the canvas. Ask which one it is.
        const aim = await page.evaluate(([x, y]) => {
          const top = document.elementFromPoint(x, y)
          return {
            cursor: document.querySelector('.office-three-canvas').style.cursor,
            over: top ? `${top.tagName.toLowerCase()}.${(top.className?.baseVal ?? top.className ?? '').toString().split(' ')[0]}` : null,
            pick: window.__officeDebug?.dragPick?.(x, y) ?? null,
          }
        }, [target.clientX, target.clientY])
        await page.mouse.down()
        for (let step = 1; step <= 8; step += 1) {
          await page.mouse.move(target.clientX - step * 9, target.clientY + step * 4)
          await page.waitForTimeout(24)
        }
        const cursorDuring = await page.evaluate(() => document.querySelector('.office-three-canvas').style.cursor)
        await page.mouse.up()
        await page.waitForTimeout(80)
        const events = await page.evaluate(() => window.__dropHeard ?? null)
        const settled = await page.evaluate((key) => {
          const found = window.__officeDebug.draggables().find((entry) => entry.key === key)
          return found ? { x: found.x, z: found.z, released: found.released } : null
        }, item.key)
        moved.push({
          key: item.key,
          from: [item.x, item.z],
          to: settled ? [settled.x, settled.z] : null,
          released: settled?.released ?? false,
          travelled: settled ? Number(Math.hypot(settled.x - item.x, settled.z - item.z).toFixed(3)) : 0,
          aim,
          cursorDuring,
          event: events,
        })
        await page.waitForTimeout(120)
      }
    }
    const after = await readScene()
    const persisted = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith('lsat-tycoon:office-layout:')))

    if (doShots) {
      const box = await page.evaluate(() => {
        const canvas = document.querySelector('.office-three-canvas')
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      })
      if (box) {
        await page.screenshot({
          path: `${outDir}/t${String(spec.tier).padStart(2, '0')}-${spec.floor}-${spec.width}.png`,
          clip: box,
          timeout: 120000,
        })
      }
    }

    report.push({ spec, stable, before, rigid, moved, after, persisted })
    await writeFile(`${outDir}/arrange.json`, JSON.stringify({ report, errors }, null, 2))
  }

  for (const entry of report) {
    const { spec, before, rigid, after } = entry
    process.stdout.write(
      `\ntier ${spec.tier} ${spec.floor} @${spec.width}\n`
      + `  draws   entropy ${before.stats?.calls}  rigid ${rigid.stats?.calls}  after drags ${after.stats?.calls} (first frame)\n`
      + `  live    entropy ${before.frame?.calls}  rigid ${rigid.frame?.calls}  after drags ${after.frame?.calls}`
      + `  (${after.frame?.released} mesh(es) still out of batch)\n`
      + `  tris    entropy ${before.stats?.triangles}  rigid ${rigid.stats?.triangles}\n`
      + `  batch   ${before.batch ? `${before.batch.batched}/${before.batch.reached} meshes in ${before.batch.batches} batches, ${before.batch.left} left` : '-'}\n`
      + `  audit   seats ${before.audit?.seats}  chairGap ${before.audit?.chairGap}  bodyGap ${before.audit?.bodyGap}  faults ${before.audit?.faults.length}\n`
      + `  rigid   chairGap ${rigid.audit?.chairGap}  bodyGap ${rigid.audit?.bodyGap}  faults ${rigid.audit?.faults.length}\n`
      + `  after   chairGap ${after.audit?.chairGap}  bodyGap ${after.audit?.bodyGap}  faults ${after.audit?.faults.length}\n`
      + `  drift   ${before.drift ? before.drift.length : '-'}\n`
      + `  same on reload: ${entry.stable}\n`
      + `  earnings ${before.earnings.length} items, ${before.earnings.filter((item) => item.onScreen).length} centred on screen, `
      + `${before.earnings.filter((item) => item.reachable).length} reachable by pointer\n`
      + (before.earnings.some((item) => !item.reachable)
        ? `  UNREACHABLE: ${before.earnings.filter((item) => !item.reachable).map((item) => item.key).join(', ')}\n`
        : ''),
    )
    if (before.audit?.faults.length) process.stdout.write(`  FAULTS: ${before.audit.faults.join('; ')}\n`)
    if (rigid.audit?.faults.length) process.stdout.write(`  FAULTS IN RIGID GRID: ${rigid.audit.faults.join('; ')}\n`)
    if (after.audit?.faults.length) process.stdout.write(`  FAULTS AFTER DRAG: ${after.audit.faults.join('; ')}\n`)
    for (const move of entry.moved) {
      process.stdout.write(
        `  drag ${move.key.padEnd(20)} ${JSON.stringify(move.from)} -> ${JSON.stringify(move.to)} `
        + `moved ${move.travelled}  pick ${move.aim?.pick}  over ${move.aim?.over}  `
        + `cursor ${move.aim?.cursor}/${move.cursorDuring}  event ${move.event ? move.event.item : 'none'}\n`,
      )
    }
    process.stdout.write(`  persisted ${entry.persisted.length} key(s)\n`)
  }
  if (errors.length) process.stdout.write(`\nPAGE ERRORS (${errors.length}):\n${errors.slice(0, 8).join('\n')}\n`)
  else process.stdout.write('\nno page errors\n')
} finally {
  await browser.close().catch(() => {})
  chromeProcess.kill()
}
