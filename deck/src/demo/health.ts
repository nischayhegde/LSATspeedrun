/**
 * Is the app dev server actually up?
 *
 * The demo slides frame `http://localhost:5173`. When that server is not
 * running the iframe renders the browser's own "connection refused" page,
 * which is the worst possible thing to have on a projector, so every demo
 * slide asks this first and falls back to a still image if the answer is no.
 *
 * Dependency-free on purpose: `fetch` and `AbortController`, nothing else.
 */

/** Result of probing the app dev server. */
export type AppHealth = 'checking' | 'live' | 'unreachable'

/** Requests longer than this are treated as a dead origin. */
const DEFAULT_TIMEOUT_MS = 2500

/**
 * Probes the app origin with a hard timeout. Resolves 'live' only if the app
 * dev server actually answered.
 *
 * The probe is a cross-origin `no-cors` HEAD of the origin root. `no-cors`
 * means the response is opaque — `status` reads as 0 and headers are stripped
 * — so the status code cannot be the signal. What can be: the fetch either
 * *settles* (something on the other end spoke HTTP, whatever it said) or it
 * *rejects* (connection refused, DNS failure, or our own abort). So a resolved
 * fetch is "live" and any throw is "unreachable". A 404 counts as live, which
 * is correct here: the question is whether a server is listening, not whether
 * one path exists.
 *
 * The root is used rather than a favicon because this app has no favicon file
 * — `index.html` inlines a data URI — so `/favicon.ico` is a 404 through the
 * SPA fallback. `HEAD /` on the Vite dev server answers 200 with no body,
 * which is the cheapest honest answer available.
 *
 * Never throws, and always settles inside `timeoutMs`, including when the
 * origin black-holes the connection instead of refusing it: the abort covers
 * the normal case, and the race covers a `fetch` that somehow ignores it.
 */
export function probeApp(origin: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<AppHealth> {
  if (typeof fetch !== 'function') return Promise.resolve<AppHealth>('unreachable')

  let url: string
  try {
    url = new URL('/', origin).href
  } catch {
    // A malformed `appOrigin` in demo.config.ts is a configuration error, not a
    // dead server, but the slide's fallback is the same either way.
    return Promise.resolve<AppHealth>('unreachable')
  }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<AppHealth>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve('unreachable')
    }, timeoutMs)
  })

  const request = fetch(url, {
    method: 'HEAD',
    mode: 'no-cors',
    cache: 'no-store',
    // The probe must not depend on, or disturb, the app's session cookie.
    credentials: 'omit',
    redirect: 'follow',
    signal: controller.signal,
  }).then<AppHealth, AppHealth>(
    () => 'live',
    () => 'unreachable',
  )

  return Promise.race([request, deadline]).finally(() => {
    clearTimeout(timer)
  })
}
