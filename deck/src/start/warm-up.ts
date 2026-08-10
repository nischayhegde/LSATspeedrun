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

/** After this the queue stops; a presenter who has not pressed Start by now is talking. */
const IDLE_BUDGET_MS = 20_000

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
 * The two display faces, forced.
 *
 * `index.html` requests them with `display=swap`, which is right — nothing should
 * ever be hidden waiting for a font on conference wifi — but it means the title
 * slide can paint in the fallback and then reflow to Fraunces a moment later. If
 * the curtain is going to rise on a headline, the headline should already be in
 * the face it is designed in, and `document.fonts.load` is the only way to ask
 * for a specific variation rather than hoping the browser has decided it is
 * needed. The sizes are the two the deck actually sets at display scale.
 */
async function warmFonts(): Promise<void> {
  if (!('fonts' in document)) return
  const faces = [
    '900 120px Fraunces',
    '620 40px Fraunces',
    '800 20px Archivo',
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
 * Runs the queue. Returns a cancel function; call it when the deck is entered so
 * nothing is still fetching while the presenter is talking over slide 1.
 */
export function startWarmUp(options: { stills?: readonly string[] } = {}): () => void {
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
