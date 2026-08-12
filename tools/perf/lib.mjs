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
 * The emulation the numbers in `FINDINGS.md` are taken under: a 390px phone,
 * 4x CPU throttle, and by default a 1.6 Mbps / 150 ms link. That default is
 * deliberately the profile `tools/css-split` uses, so a number from either
 * side is comparable with a number from the other.
 *
 * The link is a parameter and not a constant because it turned out to decide
 * the answer. At 1.6 Mbps the pipe is the bottleneck and moving a download
 * earlier only takes bandwidth from something the page needs first; at 12 Mbps
 * the round trip is the bottleneck and the same move is free. A conclusion
 * drawn at one of those speeds does not hold at the other, so the speed is
 * stated in every result.
 */
export const LINKS = {
  /** Chrome's own "Slow 4G", and the profile every earlier number here used. */
  'slow-4g': { label: '1.6 Mbps / 150 ms', mbps: 1.6, rtt: 150, up: 750 },
  /** A good mobile connection: bandwidth stops being the binding constraint. */
  '4g': { label: '9 Mbps / 85 ms', mbps: 9, rtt: 85, up: 3000 },
  /** Home broadband over a distant edge — latency-bound, not bandwidth-bound. */
  cable: { label: '24 Mbps / 60 ms', mbps: 24, rtt: 60, up: 6000 },
}

export const netConditions = (name = 'slow-4g') => {
  const link = LINKS[name]
  if (!link) throw new Error(`unknown link "${name}"; try ${Object.keys(LINKS).join(', ')}`)
  return {
    offline: false,
    latency: link.rtt,
    downloadThroughput: (link.mbps * 1024 * 1024) / 8,
    uploadThroughput: (link.up * 1024) / 8,
  }
}

export const EMULATION = {
  viewport: { width: 390, height: 844 },
  cpuThrottle: 4,
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
export async function measureRoute(browser, { origin, route, cookies = null, routeChunk = null, link = 'slow-4g' }) {
  const context = await browser.newContext({ viewport: EMULATION.viewport })
  if (cookies?.length) await context.addCookies(cookies)
  const page = await context.newPage()
  const client = await page.context().newCDPSession(page)

  const requests = []
  const byId = new Map()
  client.on('Network.requestWillBeSent', (e) => {
    const row = { url: e.request.url, at: e.timestamp, type: e.type, initiator: e.initiator, priority: e.request.initialPriority }
    requests.push(row)
    byId.set(e.requestId, row)
  })
  client.on('Network.loadingFinished', (e) => {
    const row = byId.get(e.requestId)
    if (row) { row.end = e.timestamp; row.bytes = e.encodedDataLength }
  })
  await client.send('Network.enable')
  await client.send('Emulation.setCPUThrottlingRate', { rate: EMULATION.cpuThrottle })
  await client.send('Network.emulateNetworkConditions', netConditions(link))

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
    /**
     * The whole waterfall, relative to the navigation, for `--trace`. A
     * request whose initiator is another request is a serialised hop, and
     * those are the only things worth trying to remove — but see `FINDINGS.md`
     * on why a hop being serial does not mean it is costing what it looks
     * like it costs.
     */
    trace: requests.map((r) => ({
      url: r.url,
      start: ms(r.at),
      end: r.end ? ms(r.end) : null,
      bytes: r.bytes ?? null,
      priority: r.priority || '',
      cause: describeInitiator(r.initiator),
    })).sort((x, y) => x.start - y.start),
  }
}

/** What discovered a request: the parser, the preload scanner, or a script. */
function describeInitiator(initiator) {
  const i = initiator || {}
  if (i.type === 'parser') return `parser ${short(i.url || '')}`
  if (i.type === 'preload') return 'preload scanner'
  if (i.type === 'script') {
    const top = (i.stack?.callFrames || [])[0]
    return top ? `script ${short(top.url)}${top.functionName ? ` (${top.functionName})` : ''}` : 'script'
  }
  return i.type || '?'
}

export const short = (url) => {
  try {
    const u = new URL(url)
    const name = u.pathname.split('/').pop() || u.pathname
    return u.hostname === '127.0.0.1' ? name || '/' : `${u.hostname}${u.pathname}`
  } catch { return String(url).slice(0, 40) }
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
