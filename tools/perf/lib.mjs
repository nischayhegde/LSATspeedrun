/**
 * The shared rig for measuring a real, signed-in screen of this app.
 *
 * Every perf harness in this repository before this one served `/v1/*` as a
 * flat 401 (`tools/css-split/prod-serve.mjs`, `--api`). That is correct for
 * `/` and `/login` and wrong for everything else: a 401 sends every protected
 * route to the sign-in screen, so a run that asked for `/firm` timed the login
 * page and reported a number that had nothing to do with the route named in the
 * command. That is how "the only measurable route was too small to show a
 * difference" happened — the measurable route *was* `/login`.
 *
 * So this rig signs in. It proxies `/v1` to a real backend, takes a dev-auth
 * session cookie before the navigation, and then refuses to believe its own
 * result: a load is only counted if the browser finished on the path that was
 * asked for and the route's own marker element is in the document. A run that
 * bounced is reported as void rather than as a fast load.
 *
 * The signed-out control is the other half of that. The same route is measured
 * again with no cookie, and it MUST come back void. If it does not, either the
 * backend is handing out data to anonymous callers or the harness is not really
 * signing in — and in both cases the authenticated number means nothing. A
 * green result with no control behind it is exactly the kind of claim this
 * project has repeatedly found to be false.
 *
 * Findings, traps and the numbers taken with this rig are in `FINDINGS.md`
 * beside this file. Read it before running anything.
 */
import { loadavg } from 'node:os'
import { serveLikeProd, describeCompression } from '../css-split/prod-serve.mjs'

const PW = process.env.LSAT_PLAYWRIGHT || '/private/tmp/pwrt/node_modules/playwright/index.mjs'
export const { chromium } = await import(PW)

/**
 * Playwright is not always installed where it can find its own browser — the
 * mac checkouts resolve the host wrong, and a Linux CI box has it in the user
 * cache — so the binary is named rather than discovered, as the rest of the
 * repository's capture scripts already do.
 */
export const CHROME = process.env.LSAT_CHROME || null

export const launch = () => chromium.launch(CHROME ? { executablePath: CHROME } : {})

/**
 * The emulation every number in `FINDINGS.md` was taken under: a 390px phone,
 * 4x CPU throttle, and a 1.6 Mbps / 150 ms link. It is deliberately the same
 * profile `tools/css-split` uses, so a number from either side is comparable
 * with a number from the other.
 */
export const EMULATION = {
  viewport: { width: 390, height: 844 },
  cpuThrottle: 4,
  network: {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
}

/**
 * The element that proves a route drew itself, keyed by the path.
 *
 * Each is the outermost class the route's own module writes, so it cannot
 * appear on any other screen and cannot appear before that screen's chunk has
 * arrived, been executed and been rendered. That is what makes it a usable
 * "the route is on the glass" signal as well as an anti-fake check.
 */
export const ROUTE_MARKERS = {
  '/firm': '.firm-page',
  '/progress': '.performance-page',
  '/cases': '.case-lobby',
  '/story': '.story-page',
  '/office': '.office-page',
  '/map': '.map-page',
  '/login': '.login-page',
  '/onboarding': '.onboarding-page',
}

/** The marker for a path, including the `/cases/<id>` session screen. */
export function markerFor(route) {
  const path = route.split('?')[0].replace(/\/$/, '') || '/'
  if (ROUTE_MARKERS[path]) return ROUTE_MARKERS[path]
  if (/^\/(cases|practice)\/.+/.test(path)) return '.session-page, .session-review-page'
  return null
}

/** Signs in against the real backend and returns cookies for a browser context. */
export async function devAuthCookies(apiOrigin, email, host = '127.0.0.1') {
  const res = await fetch(new URL('/v1/auth/dev', apiOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`dev sign-in failed: ${res.status} ${await res.text()}`)
  const jar = res.headers.getSetCookie?.() ?? []
  if (!jar.length) throw new Error('dev sign-in returned no cookies; is DEV_AUTH_ENABLED set?')
  return jar.map((line) => {
    const [pair] = line.split(';')
    const at = pair.indexOf('=')
    return {
      name: pair.slice(0, at).trim(),
      value: pair.slice(at + 1).trim(),
      domain: host,
      path: '/',
      httpOnly: /httponly/i.test(line),
      secure: false,
      sameSite: 'Lax',
    }
  })
}

/** Where `me` says this account should land, which is what `/` will redirect to. */
export async function nextRouteFor(apiOrigin, cookies) {
  const res = await fetch(new URL('/v1/me', apiOrigin), {
    headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
  })
  if (!res.ok) return null
  return (await res.json())?.user?.next_route ?? null
}

/**
 * One cold load of one route, timed.
 *
 * `contentAt` is the moment the route's marker element first exists, taken by
 * an observer installed before any of the app's own script runs. It is the
 * number that matters for a route-script hint: first paint is drawn by the
 * document's opening plate and is nearly immune to anything the bundle does,
 * while the marker cannot appear until the route's chunk has been requested,
 * downloaded, executed and rendered.
 *
 * `chunkAt` is when the route's own JavaScript was requested. That is the thing
 * a hint moves, and reporting it beside `contentAt` is what distinguishes "the
 * hint did nothing" from "the hint worked and the screen is gated on something
 * else".
 */
export async function measureRoute(browser, { origin, route, cookies = null, routeChunk = null }) {
  const context = await browser.newContext({ viewport: EMULATION.viewport })
  if (cookies?.length) await context.addCookies(cookies)
  const page = await context.newPage()
  const client = await page.context().newCDPSession(page)

  const requests = []
  client.on('Network.requestWillBeSent', (e) => {
    requests.push({ url: e.request.url, at: e.timestamp, type: e.type })
  })
  await client.send('Network.enable')
  await client.send('Emulation.setCPUThrottlingRate', { rate: EMULATION.cpuThrottle })
  await client.send('Network.emulateNetworkConditions', EMULATION.network)

  const marker = markerFor(route)
  await page.addInitScript((sel) => {
    window.__lcp = []
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lcp.push({ at: e.startTime, size: e.size })
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    if (!sel) return
    window.__contentAt = null
    const check = () => {
      if (window.__contentAt != null) return false
      if (!document.querySelector(sel)) return false
      window.__contentAt = performance.now()
      return true
    }
    const start = () => {
      if (check()) return
      const obs = new MutationObserver(() => { if (check()) obs.disconnect() })
      obs.observe(document.documentElement, { childList: true, subtree: true })
    }
    if (document.documentElement) start()
    else document.addEventListener('readystatechange', start, { once: true })
  }, marker)

  const t0 = Date.now()
  await page.goto(`${origin}${route}`, { waitUntil: 'commit' })
  const paint = await page.evaluate(() => new Promise((ok) => {
    const seen = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')
    if (seen) return ok(seen.startTime)
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') { obs.disconnect(); ok(e.startTime) }
    })
    obs.observe({ type: 'paint', buffered: true })
    setTimeout(() => ok(null), 25000)
  }))
  /**
   * Wait for the marker rather than for a fixed timeout. A fixed wait either
   * truncates a slow load (which reports the treatment as void and flatters
   * whichever arm happened to be quicker) or pads every fast one.
   */
  let landed = true
  if (marker) {
    try { await page.waitForSelector(marker, { timeout: 20000, state: 'attached' }) } catch { landed = false }
  }
  await page.waitForTimeout(500)

  const contentAt = await page.evaluate(() => window.__contentAt ?? null)
  const lcpAll = await page.evaluate(() => window.__lcp || [])
  const path = new URL(page.url()).pathname.replace(/\/$/, '') || '/'
  const wanted = route.split('?')[0].replace(/\/$/, '') || '/'

  const nav = requests.find((r) => r.type === 'Document')
  const base = nav ? nav.at : Math.min(...requests.map((r) => r.at))
  const ms = (t) => Math.round((t - base) * 1000)
  const chunk = routeChunk ? requests.find((r) => r.url.includes(routeChunk)) : null

  await context.close()
  return {
    route,
    landedOn: path,
    /**
     * A load counts only if it finished on the path it asked for with that
     * path's own element in the document. Anything else is a bounce, and the
     * time it took is the time some other screen took.
     */
    valid: landed && path === wanted && contentAt != null,
    fcp: paint == null ? null : Math.round(paint),
    lcp: lcpAll.length ? Math.round(lcpAll[lcpAll.length - 1].at) : null,
    contentAt: contentAt == null ? null : Math.round(contentAt),
    chunkAt: chunk ? ms(chunk.at) : null,
    requests: requests.length,
    wall: Date.now() - t0,
  }
}

/** Serves a built `dist` the way production does, with `/v1` going to a real API. */
export const serveApp = (dist, apiOrigin, compress = 'auto') => (
  serveLikeProd(dist, { compress, apiOrigin })
)

export { describeCompression }

/** Median of the non-null values, or null when there are none. */
export function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2)
}

/**
 * The machine's own load, printed with every result.
 *
 * A previous session lost a day to comparing a number taken on an idle machine
 * with one taken while a build was running. Nothing in a browser timing says
 * which of those it is, so it is recorded rather than remembered.
 */
export const loadLine = () => {
  const [one, five, fifteen] = loadavg()
  return `load ${one.toFixed(2)} / ${five.toFixed(2)} / ${fifteen.toFixed(2)}`
}
