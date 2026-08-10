/**
 * Work paid for while the room is looking at the start card.
 *
 * The expensive part of starting this deck — building the WebGL stage, compiling
 * its shaders, constructing the title slide's hero scene, warming the two
 * neighbouring scenes — is not scheduled here at all: the deck is mounted
 * underneath the card from the first frame, so all of that happens on its own
 * while the card covers it. See the note at the top of `start-screen.tsx`.
 *
 * What is left is the handful of things that are *not* triggered by mounting the
 * deck and that would otherwise be paid for at a visible moment. Each one is
 * cheap, none of them blocks the button, and every failure is swallowed: a warm
 * cache is an optimisation and must never be a reason the deck does not start.
 */

/**
 * After this the queue stops; a presenter who has not pressed Start by now is
 * talking. Raised from 20s when route warming joined the queue: the office scene
 * alone can take nine seconds to transform cold, and a budget that expired before
 * reaching the map route would have quietly warmed only half of what it claims to.
 * Moot in the ordinary case — pressing Start cancels the queue outright.
 */
const IDLE_BUDGET_MS = 45_000

/** Per route. Generous, since the thing being paid for is a nine-second transform. */
const ROUTE_BUDGET_MS = 15_000

type IdleHandle = { cancel: () => void }

/** `requestIdleCallback` where it exists, a timeout where it does not. */
function whenIdle(task: () => void, timeout = 1200): IdleHandle {
  const idle = (window as unknown as {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (handle: number) => void
  })
  if (typeof idle.requestIdleCallback === 'function') {
    const handle = idle.requestIdleCallback(task, { timeout })
    return { cancel: () => idle.cancelIdleCallback?.(handle) }
  }
  const handle = window.setTimeout(task, Math.min(timeout, 300))
  return { cancel: () => window.clearTimeout(handle) }
}

/**
 * Every weight the deck sets, forced.
 *
 * `index.html` requests them with `display=swap`, which is right — nothing should
 * ever be hidden waiting for a font on conference wifi — but it means the title
 * slide can paint in the fallback and then reflow a moment later. If the curtain
 * is going to rise on a headline, the headline should already be in the face it is
 * designed in, and `document.fonts.load` is the only way to ask for a specific
 * instance rather than hoping the browser has decided it is needed.
 *
 * All four are Archivo since the display face moved off Fraunces. Google serves
 * Archivo as *static instances*, so each weight is its own file and each one has
 * to be asked for by name: a weight that is requested here but absent from the
 * `index.html` stylesheet resolves to the nearest available and gets synthesised,
 * which is a smeared approximation rather than the drawn weight. 800 is display,
 * 500 is text, and 600 and 700 are set in between by the slide layouts.
 */
async function warmFonts(): Promise<void> {
  if (!('fonts' in document)) return
  const faces = [
    '800 120px Archivo',
    '700 40px Archivo',
    '600 20px Archivo',
    '500 20px Archivo',
  ]
  await Promise.all(faces.map((face) => document.fonts.load(face).catch(() => undefined)))
}

/**
 * Fetch and decode an image off the main thread's critical path.
 *
 * `decode()` is the point rather than the fetch: a 2MB still that is in the HTTP
 * cache but not decoded still costs tens of milliseconds of main thread the first
 * time it is painted, and on a demo slide that is the frame the audience is
 * looking at.
 */
function warmImage(src: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.src = src
    const done = () => resolve()
    if (typeof image.decode === 'function') {
      image.decode().then(done, done)
      return
    }
    image.onload = done
    image.onerror = done
  })
}

/**
 * Load an app route in a hidden frame, then throw the frame away.
 *
 * The office and map routes each pull a scene module that Vite has to transform on
 * first request: about nine seconds cold against 1.4 warm, measured on this
 * machine. The transform is cached by the dev server for the rest of its run, so
 * paying it here — behind a title card, before anyone is watching — is the whole
 * trick. The frame is discarded immediately; only the server-side cache and the
 * HTTP cache are wanted, and keeping it would hold a WebGL context the demo stage
 * has a budget for.
 *
 * This used to be a step in the runbook asking the presenter to visit both routes
 * by hand before starting. Steps that exist to prevent a nine-second stall are
 * exactly the steps that get skipped on the morning they matter.
 *
 * Resolves on load or after `timeoutMs`, whichever comes first, and never rejects:
 * a warm-up that blocks the queue is worse than a cold route.
 */
function warmRoute(url: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    // Off-screen rather than `display:none`: a hidden frame is allowed to skip
    // rendering entirely, which would skip the scene compile this is here to pay.
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px;border:0;opacity:0;pointer-events:none'
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      frame.remove()
      resolve()
    }
    const timer = window.setTimeout(done, timeoutMs)
    frame.addEventListener('load', () => {
      // A moment past `load` for the scene's first frame, which is the expensive
      // part and happens after the document is considered loaded.
      window.setTimeout(done, 1200)
    })
    frame.src = url
    document.body.appendChild(frame)
  })
}

/**
 * Runs the queue. Returns a cancel function; call it when the deck is entered so
 * nothing is still fetching while the presenter is talking over slide 1.
 */
export function startWarmUp(options: { stills?: readonly string[]; routes?: readonly string[] } = {}): () => void {
  let cancelled = false
  const handles: IdleHandle[] = []
  const deadline = window.setTimeout(() => { cancelled = true }, IDLE_BUDGET_MS)

  const queue: Array<() => Promise<void> | void> = [
    warmFonts,
    // The panic-button stills, in the order they would be needed. These are the
    // largest files in the deck and the whole point of them is to appear the
    // instant something has gone wrong, which is not a moment to be fetching
    // two megabytes.
    ...(options.stills ?? []).map((src) => () => warmImage(src)),
    // Last, because they are the slowest and the least likely to be needed
    // (a stills-only run never touches them), and because the queue is abandoned
    // the moment the presenter presses Start.
    ...(options.routes ?? []).map((url) => () => warmRoute(url, ROUTE_BUDGET_MS)),
  ]

  const pump = () => {
    if (cancelled) return
    const task = queue.shift()
    if (!task) return
    void Promise.resolve()
      .then(task)
      .catch(() => undefined)
      .then(() => { handles.push(whenIdle(pump)) })
  }
  handles.push(whenIdle(pump, 400))

  return () => {
    cancelled = true
    window.clearTimeout(deadline)
    for (const handle of handles) handle.cancel()
  }
}
