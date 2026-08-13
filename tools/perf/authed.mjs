/**
 * A signed-in session for a browser harness, and the proof that it held.
 *
 * The tools in `tools/css-split/` serve a built `dist` from a private port with
 * nothing behind `/v1`, so `me` 401s, `Protected` redirects, and every number
 * they have ever recorded is a number about `/login`. Nobody meant to measure
 * `/login`; it is simply where an unauthenticated browser ends up, silently.
 *
 * `POST /v1/auth/dev` fixes that and always could have. What stopped it being
 * used is that it writes rows to whatever database the API is pointed at, and
 * on this machine that is the one the live demo is showing. So this talks to
 * the harness's own backend — `tools/perf/harness-backend.sh`, port 5810, a
 * throwaway SQLite file — and never to 5001.
 *
 * Everything here is deliberately a library rather than a script. The next
 * person should be able to authenticate a harness in three lines:
 *
 *     const session = await signIn()
 *     const ctx = await authedContext(browser, { port, session })
 *     await proveSignedIn(page, '/firm', session)     // throws if it is not
 */
import { loadavg } from 'node:os'

export const API = (process.env.LSAT_HARNESS_API || 'http://127.0.0.1:5810').replace(/\/$/, '')
export const EMAIL = process.env.LSAT_HARNESS_EMAIL || 'harness@localhost.test'

/** The routes worth measuring, in the order a reader meets them. */
export const ROUTES = ['/login', '/', '/office', '/progress', '/cases', '/cases/:id', '/firm', '/story', '/map']

/**
 * Routes a signed-in reader is redirected away from. Landing somewhere else is
 * correct here and a harness must not read it as a lost session: `/` has never
 * known its own screen (it goes wherever `me` reports `next_route`), and
 * `/login` and `/onboarding` are for people who are not signed in. The
 * destination is the account's `next_route`, which is why the check needs the
 * signed-in user rather than a hard-coded path.
 */
export const SIGNED_IN_REDIRECTS = new Set(['/', '/login', '/onboarding'])

/** Where `route` should end up for this session. */
export const expectedLanding = (route, session) => (
  SIGNED_IN_REDIRECTS.has(route) ? (session.user?.next_route || route) : route
)

const jarToHeader = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join('; ')

/**
 * `Set-Cookie` is the one header that legitimately repeats. `getSetCookie()`
 * is the accessor that keeps both of them; `headers.get('set-cookie')` and any
 * copy through a plain object keep one, and the one lost is the `HttpOnly`
 * session. That bug cost a previous session a whole QA sweep — see
 * `.qa-report.md` S4-7 — which is why the parsing lives in one place.
 */
const parseCookies = (response) => (response.headers.getSetCookie?.() ?? []).map((line) => {
  const [pair] = line.split(';')
  const eq = pair.indexOf('=')
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
})

/** A clear failure before a browser is launched, rather than a 401 later. */
export async function requireHarnessApi() {
  try {
    const r = await fetch(`${API}/v1/me`, { headers: { Accept: 'application/json' } })
    if (r.status !== 200 && r.status !== 401) throw new Error(`unexpected ${r.status}`)
  } catch (e) {
    throw new Error(
      `The harness API is not answering on ${API} (${e.message}). Start it with\n`
      + '    tools/perf/harness-backend.sh\n'
      + 'and do not point this at 5001 — that is the database the live demo is using.',
    )
  }
}

/**
 * Signs in as the seeded harness account and returns the cookie jar.
 *
 * Both cookies matter and for different reasons: `lsat_session` authenticates,
 * and `lsat_csrf` is required on every POST/PUT/PATCH/DELETE that is not bearer
 * authenticated, which includes starting the practice run `/cases/:id` needs.
 */
export async function signIn({ email = EMAIL } = {}) {
  await requireHarnessApi()
  const response = await fetch(`${API}/v1/auth/dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!response.ok) throw new Error(`dev sign-in answered ${response.status}`)
  const cookies = parseCookies(response)
  const session = cookies.find((c) => c.name === 'lsat_session')
  const csrf = cookies.find((c) => c.name === 'lsat_csrf')
  if (!session) {
    throw new Error(
      'Sign-in returned no lsat_session cookie. If this is going through a proxy, the proxy '
      + 'is collapsing the two Set-Cookie headers — use getSetCookie(). See .qa-report.md S4-7.',
    )
  }
  const { user } = await response.json()
  return { email, user, cookies, session: session.value, csrf: csrf?.value ?? null }
}

/** An authenticated call to the harness API, outside the browser. */
export const apiFetch = (session, path, init = {}) => fetch(`${API}/v1${path}`, {
  ...init,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Cookie: jarToHeader(session.cookies),
    ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}),
    ...(init.headers || {}),
  },
})

/**
 * `/cases/:id` is the heaviest route in the app and the one never measured. It
 * needs a real session id, so one is found or made. Written as a general route
 * resolver because the same problem will come back for any id-bearing route.
 */
export async function resolveRoutes(routes, session) {
  const needsCase = routes.some((r) => r.includes(':id'))
  let caseId = null
  if (needsCase) {
    const current = await apiFetch(session, '/study-sessions/current').then((r) => r.json())
    caseId = current?.session?.id ?? null
    if (!caseId) {
      const started = await apiFetch(session, '/study-sessions', { method: 'POST', body: JSON.stringify({ size: 10 }) })
      if (!started.ok) throw new Error(`could not start a practice run for /cases/:id (${started.status} ${await started.text()})`)
      caseId = (await started.json()).session.id
    }
  }
  return routes.map((r) => (r.includes(':id') ? r.replace(':id', caseId) : r))
}

/** A browser context carrying the session, for a server on `port`. */
export async function authedContext(browser, { port, session, viewport = { width: 390, height: 844 } }) {
  const context = await browser.newContext({ viewport })
  await context.addCookies(session.cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: c.name === 'lsat_session',
    secure: false,
    sameSite: 'Lax',
  })))
  if (port) context.__origin = `http://127.0.0.1:${port}`
  return context
}

/**
 * Three independent checks that the page really is the route, signed in.
 *
 * One check would not do. The URL alone passes if the app has not finished
 * bouncing; `me` alone passes on a page that rendered nothing; the absence of
 * the login screen alone passes on an error boundary. The expensive lesson
 * behind this function is that a harness which assumes sign-in worked produces
 * a clean-looking table in which every row is `/login`, and nothing in the
 * output says so.
 *
 * Throws by default. A measurement that cannot say which screen it measured is
 * worse than no measurement, because it gets written down.
 */
export async function proveSignedIn(page, route, session, { strict = true } = {}) {
  const landed = new URL(page.url()).pathname
  const expected = expectedLanding(route, session)
  const me = await page.evaluate(async () => {
    try {
      const r = await fetch('/v1/me', { credentials: 'include', headers: { Accept: 'application/json' } })
      const body = await r.json().catch(() => ({}))
      return { status: r.status, email: body?.user?.email ?? null }
    } catch (e) { return { status: 0, email: null, error: String(e) } }
  })
  const looksLikeLogin = await page.evaluate(() => {
    const text = document.body?.innerText || ''
    return /Enter local development firm|DIAGNOSE · SPEEDRUN/i.test(text)
  })
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length)
  const proof = {
    route,
    landed,
    expected,
    landedWhereAsked: landed === expected,
    redirected: expected !== route,
    meStatus: me.status,
    meEmail: me.email,
    isLoginScreen: looksLikeLogin,
    nodes,
  }
  proof.ok = proof.landedWhereAsked && me.status === 200 && me.email === session.email && !looksLikeLogin
  if (!proof.ok && strict) {
    throw new Error(
      `Not signed in on ${route}: expected ${expected}, landed on ${landed}, /v1/me ${me.status} ${me.email ?? '(no user)'}`
      + `${looksLikeLogin ? ', and the sign-in screen is on the glass' : ''}. `
      + 'Refusing to record a number for a route that was not loaded.',
    )
  }
  return proof
}

/** One line of proof, for a run's own output. */
export const describeProof = (p) => `${p.ok ? 'signed in' : 'NOT SIGNED IN'} on ${p.landed}`
  + `${p.redirected ? ' (redirect, as a signed-in reader gets)' : ''}`
  + `  (me ${p.meStatus}${p.meEmail ? ` ${p.meEmail}` : ''}, ${p.nodes} nodes)`

/**
 * The machine's load, which belongs in the output next to the numbers.
 *
 * The same production build measured 1.9 s largest paint at load 25 and 8.8 s
 * at load 68 on this box. A timing without the load it was taken at cannot be
 * compared with anything.
 */
export const load = () => loadavg().map((n) => n.toFixed(1)).join(' ')
