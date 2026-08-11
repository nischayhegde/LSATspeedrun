/**
 * Does every feature actually reach a phone?
 *
 * The mobile client is an Expo shell around a WebView pointed at the same
 * build the browser gets (`mobile/src/web-app.tsx`), so "it reaches mobile"
 * means two separate things and the brief asks for both:
 *
 *   1. The surface exists and is *operable* at a phone viewport with a finger.
 *      Not "the CSS has a rule for it" — tapped, with a touch pointer, and the
 *      thing it promises to do observed happening.
 *   2. Nothing the native shell does gets in its way. That half is checked by
 *      `--shell`, which drives the same bridge the Expo app listens on and
 *      asserts the page reports itself guarded when a tap would otherwise
 *      reload a timed section out from under the player.
 *
 * Every check writes a screenshot whether it passes or fails, because a pass
 * that was never looked at is an assertion.
 *
 *   node tools/ui-qa/mobile-reach.mjs [--only=focus,markup] [--width=390]
 */
import { chromium, devices } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:5001'
const EMAIL = process.env.UI_QA_EMAIL ?? 'ui-qa@localhost.test'
const OUT = process.env.UI_QA_OUT ?? '/workspace/.qa-run/mobile'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const WIDTH = Number(args.width ?? 390)
const HEIGHT = Number(args.height ?? 844)

mkdirSync(OUT, { recursive: true })

const results = []
const record = (name, ok, note) => {
  results.push({ name, ok, note })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${note ?? ''}`)
}

/** The user agent string the Expo shell appends, so the page sees what it will see. */
const NATIVE_UA = `${devices['iPhone 13'].userAgent} LSATTycoonMobile/1.0`

/**
 * The half of the bridge the WebView provides. The page posts to
 * `window.ReactNativeWebView.postMessage`; the shell parses it and turns
 * pull-to-refresh and the back-swipe off. Standing one in here is what lets a
 * browser prove the web half of a native contract.
 */
const SHELL_BRIDGE = `
  window.__shellMessages = []
  window.ReactNativeWebView = {
    postMessage: (payload) => {
      try { window.__shellMessages.push(JSON.parse(payload)) } catch { window.__shellMessages.push({ raw: payload }) }
    },
  }
`

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${WIDTH}-${name}.png` }).catch(() => {})
}

/* Headless Chromium's default rasteriser cannot get a frame out of either 3D
   scene, so the office reads as a zero-height canvas and the check that the
   office reaches a phone becomes a check that this machine has a GPU. */
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  userAgent: NATIVE_UA,
})
await context.addInitScript(SHELL_BRIDGE)
const login = await context.request.post(`${API}/v1/auth/dev`, { data: { email: EMAIL, display_name: 'UI QA' } })
if (!login.ok()) throw new Error(`dev login failed: ${login.status()}`)
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

const only = args.only ? String(args.only).split(',') : null
const should = (name) => !only || only.includes(name)

const goto = async (path, settle = 1800) => {
  await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(settle)
}

/* ----------------------------------------------------------- the nav itself */
if (should('nav')) {
  await goto('/progress')
  const nav = await page.evaluate(() => {
    const bar = document.querySelector('nav.mobile-nav')
    if (!bar) return null
    const links = Array.from(bar.querySelectorAll('a')).map((a) => ({
      label: a.textContent.trim(),
      h: Math.round(a.getBoundingClientRect().height),
      w: Math.round(a.getBoundingClientRect().width),
    }))
    return { links, small: links.filter((l) => l.h < 44 || l.w < 44) }
  })
  record('nav', Boolean(nav) && nav.small.length === 0,
    nav ? `${nav.links.map((l) => l.label).join(', ')}${nav.small.length ? ` — under 44px: ${JSON.stringify(nav.small)}` : ''}` : 'no mobile nav')
  await shot(page, 'nav')
}

/* ------------------------------------------------------------- Focus Mode */
if (should('focus')) {
  await goto('/progress')
  /* On a phone the nav strip the desktop toggle hangs off does not exist, so
     the sheet behind the header's Menu button is its home. "Reaches mobile"
     here means two taps from any screen and operable when it gets there — so
     the check opens the sheet, taps the toggle, and confirms the app actually
     changed state rather than that a button exists. */
  let via = 'header'
  let size = await page.locator('.header-focus-toggle').first().boundingBox().catch(() => null)
  let toggle = page.locator('.header-focus-toggle').first()
  if (!size) {
    const trigger = page.locator('.mobile-overflow-trigger')
    if (await trigger.count()) {
      await trigger.tap()
      await page.waitForTimeout(500)
      toggle = page.locator('.mobile-focus-toggle')
      size = await toggle.boundingBox().catch(() => null)
      via = 'menu sheet'
    }
  }
  let flipped = false
  if (size) {
    const wasOn = await toggle.evaluate((el) => el.classList.contains('is-on'))
    await toggle.tap()
    await page.waitForTimeout(1400)
    const nowOn = await page.evaluate(() => Boolean(document.querySelector('.mobile-focus-toggle.is-on, .header-focus-toggle.is-on')))
    const navNow = await page.evaluate(() => Array.from(document.querySelectorAll('nav.mobile-nav a')).map((a) => a.textContent.trim()))
    flipped = nowOn !== wasOn
    // Put it back, so every later check sees the account it started with.
    if (flipped) { await toggle.tap(); await page.waitForTimeout(1200) }
    record('focus', flipped && size.height >= 44,
      `${via}, ${Math.round(size.width)}x${Math.round(size.height)}; toggled ${wasOn ? 'on→off' : 'off→on'}; nav became ${navNow.join(', ')}`)
  } else {
    record('focus', false, 'no Focus control on a phone, in the header or the sheet')
  }
  await shot(page, 'focus')
}

/* -------------------------------------------------------- the live ledger */
if (should('ledger')) {
  /* Not the office or the map: the strip deliberately stands down on the two
     full-bleed scene routes, whose own HUD already owns every edge. The Firm
     screen is where purchases are made and is where it has to be. */
  await goto('/firm?tab=upgrades', 2600)
  const ledger = await page.evaluate(() => {
    const el = document.querySelector('.economy-ledger')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const readings = Array.from(el.querySelectorAll('.economy-reading strong')).map((s) => s.textContent.trim())
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), bottom: Math.round(window.innerHeight - r.bottom), readings, yielded: el.hasAttribute('data-yield') }
  })
  const clearsDock = ledger && await page.evaluate(() => {
    const el = document.querySelector('.economy-ledger')
    const dock = document.querySelector('nav.mobile-nav')
    if (!el || !dock) return null
    const a = el.getBoundingClientRect(), b = dock.getBoundingClientRect()
    return Math.round(b.top - a.bottom)
  })
  record('ledger', Boolean(ledger) && ledger.readings.length > 0 && ledger.w > 0 && clearsDock !== null && clearsDock >= 0,
    ledger ? `${ledger.w}x${ledger.h}, ${clearsDock}px clear of the dock — ${ledger.readings.join(' / ')}${ledger.yielded ? ' (yielded)' : ''}` : 'absent')
  await shot(page, 'ledger')
}

/* ----------------------------------------------- office earnings, on a phone */
if (should('office')) {
  await goto('/office', 5000)
  // A story visitor can be standing in front of the room; the office is behind
  // it and is what this check is about.
  for (let i = 0; i < 5; i += 1) {
    const defer = page.locator('.cutscene-defer, .story-quest-decline, .cutscene-choices button').first()
    if (!(await defer.count())) break
    await defer.tap().catch(() => defer.click({ force: true }).catch(() => {}))
    await page.waitForTimeout(900)
  }
  await page.waitForTimeout(2500)
  const office = await page.evaluate(() => {
    // The scene canvas, not the first canvas in the document: the character
    // busts are canvases too and one of them is first and 0x0 while offscreen.
    const canvas = Array.from(document.querySelectorAll('canvas'))
      .map((c) => ({ w: c.clientWidth, h: c.clientHeight }))
      .sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null
    const brief = document.querySelector('.office-brief, .office-today, [class*="brief"]')
    return {
      canvas,
      landscape: document.body.classList.contains('scene-landscape') || Boolean(document.querySelector('.wide-scene-shell')),
      brief: brief ? brief.textContent.trim().replace(/\s+/g, ' ').slice(0, 64) : null,
      controls: Array.from(document.querySelectorAll('.office-page button'))
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => Math.round(b.getBoundingClientRect().height)),
    }
  })
  const small = office.controls.filter((h) => h < 44)
  record('office', Boolean(office.canvas) && office.canvas.h > 120 && small.length === 0,
    `scene canvas ${office.canvas ? `${office.canvas.w}x${office.canvas.h}` : 'none'}, wide-scene shell ${office.landscape}, ${office.controls.length} controls${small.length ? `, ${small.length} under 44px: ${small.join(', ')}` : ''}`)
  await shot(page, 'office')
}

/* -------------------------------------------------- firm counsel + connections */
if (should('firm')) {
  await goto('/firm?tab=connections', 2400)
  const firm = await page.evaluate(() => {
    const ledger = document.querySelector('.retainer-ledger')
    const intro = ledger?.querySelector('h2')?.textContent.trim()
    const regions = Array.from(document.querySelectorAll('.retainer-regions button')).map((b) => ({
      label: b.textContent.trim().replace(/\s+/g, ' '),
      h: Math.round(b.getBoundingClientRect().height),
    }))
    const addressLabel = Array.from(document.querySelectorAll('.catalog-toolbar label span')).map((s) => s.textContent.trim())
    const chips = Array.from(document.querySelectorAll('.connection-districts, .asset-districts')).length
    const handoffs = Array.from(document.querySelectorAll('.asset-locate')).map((b) => b.textContent.trim().slice(0, 44))
    return { intro, regions, addressLabel, chips, handoffs: handoffs.slice(0, 4), retainerWord: (ledger?.textContent ?? '').match(/retainer/gi)?.length ?? 0 }
  })
  const ok = Boolean(firm.intro) && firm.regions.length > 0 && firm.regions.every((r) => r.h >= 40)
    && firm.addressLabel.includes('FIRM ADDRESS')
  record('firm', ok,
    `intro "${firm.intro}"; regions ${firm.regions.map((r) => `${r.label} (${r.h}px)`).join(', ')}; filter ${firm.addressLabel.join('/')}; ${firm.handoffs.length} hand-offs`)
  await shot(page, 'firm')
}

/* ------------------------------------------- a case: strategy gate + markup */
if (should('case')) {
  await goto('/cases', 2400)
  /* Either door into a case. A queue that has filled up over repeated runs
     offers "Resume active run" instead of "Start 10 cases", and a harness that
     only knew the first one reported the whole case surface as unreachable. */
  for (const label of [/start \d+ cases/i, /resume active run/i]) {
    const door = page.locator('button, a').filter({ hasText: label }).first()
    if (!(await door.count())) continue
    await door.tap().catch(() => door.click({ force: true }).catch(() => {}))
    await page.waitForTimeout(4500)
    if (await page.evaluate(() => Boolean(document.querySelector('.case-session, .question-card, .answer-card')))) break
  }
  const inCase = await page.evaluate(() => Boolean(document.querySelector('.case-session, .question-card, .answer-card')))
  await shot(page, 'case')

  if (inCase) {
    /* Strategy enforcement: the server can require an arm before the answer is
       accepted. What has to reach a phone is the control that satisfies it. */
    const gate = await page.evaluate(() => {
      const tip = document.querySelector('.strategy-tip')
      if (!tip) return null
      const buttons = Array.from(tip.querySelectorAll('button')).map((b) => ({
        label: b.textContent.trim().slice(0, 40),
        h: Math.round(b.getBoundingClientRect().height),
        w: Math.round(b.getBoundingClientRect().width),
      }))
      /* Two shapes. A *suggested* approach offers "Use it" and "Skip this
         one"; a *standing order* is enforced by the server and offers neither,
         because there is nothing to decide — the choices stay hidden until the
         step is worked. Both have to reach a phone; only the first has
         buttons to measure. */
      const enforced = tip.classList.contains('is-enforced') || /standing order/i.test(tip.textContent)
      const gated = Boolean(document.querySelector('.strategy-gate, .choice-gate, [class*="gate"]'))
        || /choices are hidden/i.test(tip.parentElement?.textContent ?? '')
      return { title: tip.getAttribute('aria-label') ?? tip.querySelector('strong')?.textContent.trim(), buttons, enforced, gated }
    })
    const strategyOk = Boolean(gate) && (gate.enforced
      ? gate.gated
      : gate.buttons.length > 0 && gate.buttons.every((b) => b.h >= 44))
    record('strategy', strategyOk,
      gate
        ? gate.enforced
          ? `standing order "${gate.title}" — enforced, choices ${gate.gated ? 'held back until the step is worked' : 'NOT held back'}`
          : `suggested "${gate.title}" — ${gate.buttons.map((b) => `${b.label} (${b.w}x${b.h})`).join('; ')}`
        : 'no strategy tip on this question')
    await shot(page, 'strategy')

    /* The whiteboard. Arm the pen, draw with a real touch drag, count the ink. */
    const toolbar = page.locator('.markup-toolbar')
    if (await toolbar.count()) {
      const pen = toolbar.locator('button').nth(1)
      await pen.tap().catch(() => pen.click({ force: true }).catch(() => {}))
      await page.waitForTimeout(300)
      const layer = page.locator('.markup-layer[data-armed]').first()
      const box = await layer.boundingBox().catch(() => null)
      let drew = 0
      if (box) {
        const x = box.x + box.width * .3
        const y = box.y + Math.min(box.height * .3, 240)
        await page.touchscreen.tap(x, y).catch(() => {})
        // A tap is not a stroke; dispatch the pointer sequence a finger makes.
        await page.evaluate(({ x, y }) => {
          const el = document.querySelector('.markup-layer[data-armed]')
          if (!el) return
          const send = (type, cx, cy) => el.dispatchEvent(new PointerEvent(type, {
            pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: cx, clientY: cy,
          }))
          send('pointerdown', x, y)
          for (let i = 1; i <= 12; i += 1) send('pointermove', x + i * 7, y + Math.sin(i / 2) * 9)
          send('pointerup', x + 84, y)
        }, { x, y })
        await page.waitForTimeout(400)
        drew = await page.evaluate(() => document.querySelectorAll('.markup-layer path, .markup-layer polyline').length)
      }
      const touchAction = await page.evaluate(() => {
        const el = document.querySelector('.markup-layer[data-armed]')
        return el ? getComputedStyle(el).touchAction : null
      })
      record('markup', drew > 0 && touchAction === 'none',
        `${drew} stroke${drew === 1 ? '' : 's'} drawn by touch; touch-action: ${touchAction}`)
      await shot(page, 'markup')
    } else {
      record('markup', false, 'no markup toolbar in the case')
    }

    /* The native shell contract: while a case is open the page must be telling
       the shell to hold the gestures that would throw the run away. */
    const guard = await page.evaluate(() => window.__shellMessages.filter((m) => m.type === 'lsat-shell-state'))
    const guarded = guard.length > 0 && guard[guard.length - 1].guarded === true
    record('shell-guard', guarded,
      guard.length ? `last: ${JSON.stringify(guard[guard.length - 1])}` : 'the page never told the shell anything')
  } else {
    record('strategy', false, 'could not open a case')
    record('markup', false, 'could not open a case')
    record('shell-guard', false, 'could not open a case')
  }
}

/* ---------------------------------------- progress, projection, meta litigation */
if (should('progress')) {
  await goto('/progress', 2600)
  // Projection and mega-litigation are tabs, not panels on the landing view.
  const tabs = page.locator('.dash-tabs button')
  const labels = await tabs.allTextContents()
  const sizes = await tabs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)))
  const openTab = async (match) => {
    const tab = tabs.filter({ hasText: match }).first()
    if (!(await tab.count())) return false
    await tab.tap()
    await page.waitForTimeout(1400)
    return true
  }
  const projectionOpened = await openTab(/projection/i)
  const projection = await page.evaluate(() => ({
    panel: Boolean(document.querySelector('.projection-panel')),
    charts: document.querySelectorAll('.projection-panel svg').length,
  }))
  await shot(page, 'progress-projection')
  const megaOpened = await openTab(/mega/i)
  const mega = await page.evaluate(() => document.body.textContent.match(/mega-litigation/gi)?.length ?? 0)
  record('progress', projectionOpened && projection.panel && megaOpened && sizes.every((h) => h >= 44),
    `tabs ${labels.map((l, i) => `${l.trim()} ${sizes[i]}px`).join(', ')}; projection panel ${projection.panel ? `present, ${projection.charts} charts` : 'absent'}; mega-litigation tab ${megaOpened ? `opened, named ${mega}x` : 'absent'}`)
  await shot(page, 'progress')
}

/* -------------------------------------------------------------- the tutorial */
if (should('tour')) {
  await goto('/progress', 2000)
  await page.evaluate(() => window.dispatchEvent(new Event('lsat-tycoon:replay-tour')))
  await page.waitForTimeout(1200)
  const tour = await page.evaluate(() => {
    const card = document.querySelector('.guided-tour-card')
    if (!card) return null
    const r = card.getBoundingClientRect()
    const next = card.querySelector('.tour-next')
    const nr = next?.getBoundingClientRect()
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      inside: r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
      next: nr ? { h: Math.round(nr.height), onScreen: nr.bottom <= window.innerHeight + 1 && nr.top >= 0 } : null,
      chapters: Array.from(card.querySelectorAll('.tour-chapters button')).map((b) => b.textContent.trim()),
    }
  })
  record('tour', Boolean(tour) && tour.inside && Boolean(tour.next?.onScreen) && tour.next.h >= 40,
    tour ? `card ${tour.w}x${tour.h} inside=${tour.inside}, Next ${tour.next ? `${tour.next.h}px onScreen=${tour.next.onScreen}` : 'missing'}, ${tour.chapters.length} chapters` : 'no tour card')
  await shot(page, 'tour')
}

await context.close()
await browser.close()

if (pageErrors.length) console.log(`\npage errors:\n  ${pageErrors.slice(0, 6).join('\n  ')}`)
writeFileSync(`${OUT}/reach-${WIDTH}.json`, JSON.stringify({ width: WIDTH, height: HEIGHT, results, pageErrors }, null, 2))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} reached ${WIDTH}px. Shots and report: ${OUT}`)
process.exitCode = failed.length ? 1 : 0
