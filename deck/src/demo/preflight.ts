import { demoConfig, liveDemoIsPossibleHere } from '../../demo.config'
import { getDemoSessions, getStatus, loadDeployedDemoSessions, setStatus } from './demo-runtime'
import { probeApp } from './health'

/**
 * Everything that can make a live demo fail, checked before anyone is on stage.
 *
 * The five demo slides depend on four things being simultaneously true, and
 * every one of them has actually been false on this machine during preparation:
 * the app dev server is up; the backend is up; *this browser profile* is signed
 * in; and the case session the slides point at is the one that is currently open.
 * The last is the worst, because it fails silently and it fails on its own — every
 * run of `seed_demo.py` deletes the open case and stages a new one, and that
 * happened three times in ninety minutes during verification.
 *
 * ## Why the session id is resolved rather than trusted
 *
 * `demo.config.ts` pins one. The pin is now a *fallback*: `resolveSession` asks
 * the backend which run is actually resumable and the case slide frames that,
 * so re-seeding cannot break the pitch and nobody has to remember to re-pin. The
 * pinned value is still used when the lookup cannot be made at all — a production
 * build, or a backend that is down — because a stale id that might work is worth
 * more than no id, which is guaranteed not to.
 *
 * ## Why the calls go through `/demo-api`
 *
 * They cannot be made directly. The backend allows CORS from the app's origin and
 * nothing else, so a credentialed fetch from the deck's origin is refused by the
 * browser. `vite.config.ts` proxies `/demo-api` to the backend, which makes these
 * same-origin requests with no preflight; the session cookie rides along because
 * cookies are scoped by host and ignore the port. See the long note there.
 */

/** Where `vite.config.ts` mounts the backend. Same-origin, so no CORS. */
const API = '/demo-api/v1'

/**
 * Generous. A backend that has just been re-seeded can take many seconds to
 * answer its first authenticated query while SQLAlchemy warms up — the timing
 * that cost `prepare-demo.mjs` a run at 4s — and this call is made while the
 * room is still looking at the start card, so there is no hurry at all. Measured
 * warm on 2026-08-10: 12–90ms.
 */
const LOOKUP_TIMEOUT_MS = 30_000

export type CheckState = 'checking' | 'ok' | 'warn' | 'bad'

export type Check = {
  id: 'origin' | 'app' | 'api' | 'auth' | 'session'
  /** Two or three words, for a status strip that is read at a glance. */
  label: string
  state: CheckState
  /** One sentence, and when it is bad it must say what to do about it. */
  detail: string
}

export type PreflightResult = {
  checks: readonly Check[]
  /** What the case route will actually use. */
  sessionId: string
  sessionSource: 'resolved' | 'pinned' | 'none'
  /** False when at least one check is `bad`. */
  ok: boolean
  /**
   * `'stills'` when nothing below was run because nothing below could help —
   * see `runPreflight`. `checks` is empty and there is nothing to display but
   * the fact itself.
   */
  mode: 'live' | 'stills'
}

/** GET as JSON with a hard timeout. Resolves `null` rather than throwing. */
async function getJson<T>(path: string, timeoutMs: number): Promise<{ status: number; body: T | null }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API}${path}`, {
      // Same-origin through the dev proxy, so the session cookie is sent
      // without `include` and without tripping a CORS preflight.
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return { status: response.status, body: null }
    return { status: response.status, body: (await response.json()) as T }
  } catch {
    return { status: 0, body: null }
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * Sign this browser profile in, without anyone touching a keyboard.
 *
 * The presenter must never see or perform a sign-in — not on stage, and not
 * during setup. The startup sequence is three steps: start the backend, start the
 * app, open the deck. Anything else is a step that can be forgotten on the one
 * morning it matters.
 *
 * Before this existed the demos worked only because *this* browser profile had
 * been signed in by hand at some earlier point, and the runbook asked the
 * presenter to do it. That is invisible state: a fresh profile, another browser,
 * a guest window, a cleared cookie jar or a borrowed laptop would all have shown
 * the audience a login screen, and the deck would have looked fine right up until
 * the first demo slide.
 *
 * `POST /v1/auth/dev` is the same endpoint the app's own "Enter local development
 * firm" button calls. It is CSRF-exempt (`AUTH_EXEMPT_PATHS`) and refuses to
 * exist unless `DEV_AUTH_ENABLED` is set, so it cannot be reached in production.
 * Called through `/demo-api`, which makes it same-origin, so the `Set-Cookie`
 * lands on host `localhost` — and cookies ignore the port, so the app on :5174
 * is signed in by a request made from the deck on :5180.
 *
 * Only called when `/me` has already answered 401, which is what makes it
 * idempotent: an established session is a no-op, not a re-login.
 */
async function establishSession(timeoutMs: number): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API}/auth/dev`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: getDemoSessions().demoEmail }),
      signal: controller.signal,
    })
    return { ok: response.ok, status: response.status }
  } catch {
    return { ok: false, status: 0 }
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * The one check that needs no network and is the most common cause of a login
 * screen on a projector.
 *
 * The app's cookies are `SameSite=Lax`, so a framed app page stays signed in only
 * when the framing document is on the same *site*. Site is compared by host and
 * not by port, so `localhost:5180` framing `localhost:5174` is same-site and
 * `127.0.0.1:5180` framing `localhost:5174` is not — the two spellings of
 * loopback are different sites to the browser. Verified empirically: framing from
 * `127.0.0.1` bounces to `/login` every time.
 */
function checkOrigin(): Check {
  let appHost = ''
  try {
    appHost = new URL(demoConfig.appOrigin).hostname
  } catch {
    return { id: 'origin', label: 'Origin', state: 'bad', detail: `demo.config.ts appOrigin is not a URL: ${demoConfig.appOrigin}` }
  }
  const deckHost = window.location.hostname
  if (deckHost === appHost) {
    return { id: 'origin', label: 'Origin', state: 'ok', detail: `deck and app are both on ${deckHost} — cookies will ride into the frames` }
  }
  return {
    id: 'origin',
    label: 'Origin',
    state: 'bad',
    detail: `the deck is on ${deckHost} but the app is on ${appHost}. `
      + `SameSite=Lax cookies will not ride, so every demo is pinned to its still — `
      + `see \`liveDemoIsPossibleHere\` in demo.config.ts, which reads the same two hosts. `
      + `Reopen the deck as http://${appHost}:${window.location.port}${window.location.search}`,
  }
}

/**
 * Runs every check and settles on the session id the demos should use.
 *
 * Never throws and never rejects: this is the thing that is supposed to tell you
 * what is broken, so it cannot be a thing that breaks.
 */
export async function runPreflight(): Promise<PreflightResult> {
  await loadDeployedDemoSessions()
  const sessions = getDemoSessions()
  // Nothing below can help a deck that is not on the presenting machine, and
  // all of it hurts there. Every check is a question about a laptop this page
  // cannot reach, so each one fails, and the failures are rendered as a plate
  // headed "the live demos will not work yet" over the founders' photographs,
  // listing shell commands and a session UUID, on a build whose demos were
  // never going to be live and are already showing their stills. Add three
  // `/demo-api/v1` requests that 404 against the deck's own origin because the
  // proxy that serves them only exists in the dev server.
  //
  // So the check is skipped rather than made to fail more quietly, and the
  // condition is `liveDemoIsPossibleHere` — the same predicate `demo.config.ts`
  // uses to decide `useStills`, imported rather than restated so the strip and
  // the slides can never disagree about which of the two decks this is.
  if (!liveDemoIsPossibleHere()) {
    return {
      checks: [],
      sessionId: sessions.liveSessionId,
      sessionSource: sessions.liveSessionId ? 'pinned' : 'none',
      ok: true,
      mode: 'stills',
    }
  }

  const origin = checkOrigin()

  const [appHealth, health, firstMe, firstCurrent] = await Promise.all([
    probeApp(demoConfig.appOrigin, 4000),
    getJson<{ status?: string; questions?: { total?: number } }>('/health', 6000),
    getJson<{ email?: string }>('/me', 8000),
    getJson<{ session?: { id?: string } }>('/study-sessions/current', LOOKUP_TIMEOUT_MS),
  ])

  // Sign in if this profile is not signed in, then ask both questions again. In
  // the ordinary case — the deck reopened in a browser that already has the
  // cookie — none of this runs and the cost is zero. On a cold profile it is one
  // extra round trip, spent while the room is looking at the title card.
  let me = firstMe
  let current = firstCurrent
  /** Null when nothing was attempted, which is the common case. */
  let signIn: { ok: boolean; status: number } | null = null
  const publicHttps = window.location.protocol === 'https:'
  if (me.status === 401 && health.body && !publicHttps) {
    signIn = await establishSession(8000)
    if (signIn.ok) {
      ;[me, current] = await Promise.all([
        getJson<{ email?: string }>('/me', 8000),
        getJson<{ session?: { id?: string } }>('/study-sessions/current', LOOKUP_TIMEOUT_MS),
      ])
    }
  }

  const app: Check = appHealth === 'live'
    ? { id: 'app', label: 'App', state: 'ok', detail: `${demoConfig.appOrigin} is answering` }
    : {
      id: 'app',
      label: 'App',
      state: 'bad',
      detail: `nothing is answering on ${demoConfig.appOrigin}. Every demo will show its still. `
        + 'Start it with: cd frontend && npm run dev',
    }

  // A missing proxy is not a broken backend: it is what a production build looks
  // like, and the deck still works from the pinned id. Distinguished by whether
  // anything answered at all.
  const api: Check = health.body
    ? { id: 'api', label: 'API', state: 'ok', detail: `backend up, ${health.body.questions?.total ?? '?'} questions loaded` }
    : {
      id: 'api',
      label: 'API',
      state: health.status === 0 ? 'warn' : 'bad',
      detail: health.status === 0
        ? 'cannot reach the backend through /demo-api — either it is down, or this is a production build with no dev proxy. '
          + 'Falling back to the pinned session id.'
        : `the backend answered ${health.status} on /v1/health. Start it with: cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py`,
    }

  // No branch here asks the presenter to sign in. If the session cannot be
  // established automatically that is a setup fault to be fixed now, at the start
  // card, with the command that fixes it — not a chore handed to whoever is about
  // to speak. The failure has to be legible during setup rather than at the first
  // demo slide, where it would be a login screen in front of an audience.
  const auth: Check = me.body
    ? {
      id: 'auth',
      label: 'Signed in',
      state: 'ok',
      detail: signIn
        ? `signed in automatically as ${me.body.email ?? sessions.demoEmail} — nothing to do`
        : `already signed in as ${me.body.email ?? sessions.demoEmail}`,
    }
    : publicHttps && me.status === 401
      ? {
        id: 'auth',
        label: 'Signed in',
        state: 'bad',
        detail: `sign in with Google as ${sessions.demoEmail} at ${demoConfig.appOrigin}/login, then reload /pitch/. `
          + 'Development sign-in is disabled on this public deploy.',
      }
    : signIn && signIn.status === 404
      ? {
        id: 'auth',
        label: 'Signed in',
        state: 'bad',
        detail: 'the backend refuses development sign-in, so no demo can load. Restart it with '
          + 'DEV_AUTH_ENABLED=true: cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py',
      }
      : signIn
        ? {
          id: 'auth',
          label: 'Signed in',
          state: 'bad',
          detail: `automatic sign-in failed (${signIn.status || 'no response'}). Every demo will show a login screen. `
            + 'Check the backend is up on :5001 and re-open the deck.',
        }
        : me.status === 401
          ? {
            id: 'auth',
            label: 'Signed in',
            state: 'bad',
            detail: 'not signed in, and the backend could not be reached through /demo-api to fix it. '
              + 'Start the backend, then re-open the deck.',
          }
          : { id: 'auth', label: 'Signed in', state: 'warn', detail: 'could not check — the backend did not answer /v1/me' }

  const resolved = current.body?.session?.id ?? ''
  const pinned = sessions.liveSessionId
  let sessionId = resolved || pinned
  let sessionSource: PreflightResult['sessionSource'] = resolved ? 'resolved' : pinned ? 'pinned' : 'none'

  let soloSessionId = sessions.soloSessionId
  if (soloSessionId && me.body) {
    const solo = await getJson<{ session?: { id?: string; total_items?: number; status?: string } }>(
      `/study-sessions/${soloSessionId}`,
      8_000,
    )
    if (solo.status === 404 || !solo.body?.session) {
      const active = await getJson<{ sessions?: Array<{ id: string; total_items: number; status: string }> }>(
        '/study-sessions/active',
        8_000,
      )
      const replacement = (active.body?.sessions ?? []).find(
        (run) => run.total_items === 1 && (run.status === 'in_progress' || run.status === 'paused'),
      )
      soloSessionId = replacement?.id || ''
    }
  }

  let session: Check
  if (resolved && resolved === pinned) {
    session = { id: 'session', label: 'Case', state: 'ok', detail: `the open case is ${resolved}, which is what demo.config.ts pins` }
  } else if (resolved) {
    // The whole point of resolving: this used to be the failure that took the
    // case slide to a login screen, and it is now a line of prose nobody has to
    // act on.
    session = {
      id: 'session',
      label: 'Case',
      state: 'ok',
      detail: `resolved the open case as ${resolved} at runtime`
        + (pinned ? ` — demo.config.ts still pins the stale ${pinned}, which is now ignored` : ''),
    }
  } else if (pinned) {
    session = {
      id: 'session',
      label: 'Case',
      state: 'warn',
      detail: current.status === 401
        ? `not signed in, so the open case could not be resolved. Using the pinned ${pinned}, which may be stale.`
        : `could not resolve the open case. Using the pinned ${pinned}, which may be stale.`,
    }
  } else {
    sessionId = ''
    sessionSource = 'none'
    session = {
      id: 'session',
      label: 'Case',
      state: 'bad',
      detail: 'no open case session, and nothing pinned. The case slide will show its still. '
        + 'Run: cd deck && npm run prepare-demo',
    }
  }

  const checks = [origin, app, api, auth, session] as const
  // Publishing the epoch is what closes the race between this check and the warm
  // iframe: if the sign-in happened just now, any embed that already loaded did so
  // without a cookie and is sitting on `/login`, and the stage has to be told that
  // the same URL will answer differently if asked again.
  setStatus(signIn?.ok
    ? { sessionId, soloSessionId, authEpoch: getStatus().authEpoch + 1 }
    : { sessionId, soloSessionId })

  return { checks, sessionId, sessionSource, ok: !checks.some((check) => check.state === 'bad'), mode: 'live' }
}
