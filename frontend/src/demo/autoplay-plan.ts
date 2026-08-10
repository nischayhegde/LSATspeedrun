/**
 * The parts of the pitch-deck autoplay driver that do not need React: reading
 * the request out of the URL, the pacing scale, and the scroll arithmetic.
 *
 * ## Why any of this exists
 *
 * The deck frames the live app in an iframe so the founders can narrate over a
 * running product rather than over a video. Clicking through fifteen questions
 * by hand while talking does not work — it splits the speaker's attention at
 * exactly the moment the room is deciding whether the product is real. So the
 * app can drive itself: real answers, submitted through the real endpoints,
 * against a session seeded for the purpose.
 *
 * ## Why it is behind a URL parameter
 *
 * `?autoplay=` is read once, here. Nothing in the deck passes it today, so
 * every existing demo slide behaves exactly as it did before this module
 * landed: `readAutoplayRequest` returns null, the hook that consumes it returns
 * an inert controller, and no timer, listener or scroll is ever installed. That
 * is deliberate — this ships alongside a demo the founders are actively
 * rehearsing, and a change that can only be reached by asking for it cannot
 * break a rehearsal.
 *
 * ## Why the answer key travels in the URL
 *
 * `serialize_question` never sends the credited answer to the client, on
 * purpose, so a driver that had to know the right answers could not read them
 * off the page. It is given them instead: `backend/scripts/stage_demo.py`
 * computes the key when it stages the run, `deck/scripts/prepare-demo.mjs`
 * pins it into `deck/demo.config.ts` beside the session id it belongs to, and
 * the two travel together into the iframe URL. No new endpoint, and nothing
 * that leaks an answer to a browser that was not handed one.
 */

/** Answer labels only, and never more than a session could hold. */
const ANSWER_KEY = /^[A-E]{1,60}$/

export type AutoplayPace = {
  /** Before the first move, so the room sees a composed page first. */
  warmupMs: number
  /** One eased scroll. Long enough to read as a hand, short enough to not idle. */
  scrollMs: number
  /** Dwell on the framed stem and choices before a choice is picked. */
  readMs: number
  /** Between the choice lighting up and the answer being submitted. */
  selectMs: number
  /** After the verdict lands, before the page is re-framed around it. */
  verdictSettleMs: number
  /** Dwell on the confirmation before the page turns. */
  verdictMs: number
}

/**
 * The measured pace, not an estimated one.
 *
 * The starting arithmetic for this deck was "about three seconds a question",
 * which is a third less than the cheapest legible version of the sequence. A
 * question has to arrive, be framed, be looked at, have a choice light up on
 * it, and come back stamped; and about half a second of every question is spent
 * on things no dwell controls — the submit round trip, the next-case round
 * trip, and the page-turn animation the app plays between cases. Three seconds
 * spends the whole budget on those and leaves the stem on screen for under a
 * second, which reads as a video of an app rather than an app.
 *
 * The first pass through these numbers ran a fifteen-question run in 92
 * seconds, which is a fifth of a five-minute talk spent watching. Trimmed to
 * what is below, the same run measures 66-70 seconds — about 4.5 seconds a
 * question — which keeps the two beats that carry the claim: roughly 1.8s of
 * question on screen before an answer is picked, and roughly 1.4s of verdict
 * stamp after. Under that the choice and the stamp start landing in the same
 * glance and the audience cannot tell which caused which.
 *
 * `?autoplayTempo=` scales all of it, because the right answer depends on a
 * script nobody has finished writing yet. A run costs the sum below plus about
 * half a second of network and page-turn per question, so re-tune against a
 * stopwatch rather than against this sum.
 */
export const AUTOPLAY_PACE: AutoplayPace = {
  warmupMs: 700,
  scrollMs: 500,
  readMs: 1350,
  selectMs: 480,
  verdictSettleMs: 220,
  verdictMs: 950,
}

export type AutoplayRequest = {
  /** Credited answers by item position, so a desynced driver stops rather than guesses. */
  answers: readonly string[]
  pace: AutoplayPace
}

function scalePace(pace: AutoplayPace, factor: number): AutoplayPace {
  if (factor === 1) return pace
  return {
    warmupMs: Math.round(pace.warmupMs * factor),
    // The scroll is a hand moving, not a beat of narration: stretching it with
    // everything else makes a slow run look sluggish rather than calm.
    scrollMs: Math.round(pace.scrollMs * Math.min(factor, 1.35)),
    readMs: Math.round(pace.readMs * factor),
    selectMs: Math.round(pace.selectMs * factor),
    verdictSettleMs: pace.verdictSettleMs,
    verdictMs: Math.round(pace.verdictMs * factor),
  }
}

/**
 * The autoplay request carried by a URL, or null for every URL that does not
 * carry one — which is all of them until a slide asks.
 *
 * `?autoplayTempo=` scales the dwells so the pace can be rehearsed against a
 * real script without a rebuild. It is clamped rather than validated into an
 * error: a mistyped tempo on stage must fall back to the tuned pace, not
 * refuse to play.
 */
export function readAutoplayRequest(search: string): AutoplayRequest | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    return null
  }
  const key = (params.get('autoplay') || '').trim().toUpperCase()
  if (!ANSWER_KEY.test(key)) return null
  const tempo = Number(params.get('autoplayTempo'))
  const factor = Number.isFinite(tempo) && tempo >= 0.4 && tempo <= 4 ? tempo : 1
  return { answers: key.split(''), pace: scalePace(AUTOPLAY_PACE, factor) }
}

// ---------------------------------------------------------------------------
// scrolling
// ---------------------------------------------------------------------------

/**
 * How much of the bottom of the frame is not usable.
 *
 * The case markup toolbar is `position: fixed; bottom: 20px`, so it floats over
 * whatever the page has scrolled under it. On a desk that is a small overlap a
 * reader scrolls past without noticing. On a projector, with the app showing
 * 781 logical pixels of a 1650-pixel page, it lands on the passage text and
 * stays there — which is the one thing a demo must not do, because the audience
 * cannot scroll it away.
 *
 * Measured rather than assumed: the toolbar's own rect decides how much room to
 * leave, so a restyled toolbar moves this without anyone remembering to. The
 * constant is only reached if the toolbar is not found at all, where guessing
 * high is the safe direction — it costs a little framing and cannot cause the
 * overlap.
 */
const TOOLBAR_FALLBACK_PX = 80
/** Breathing room between the framed content and the toolbar's top edge. */
const TOOLBAR_CLEARANCE_PX = 16
/** Never park content hard against the top edge of the frame. */
const FRAME_PAD_PX = 26

export function bottomSafeArea(): number {
  const toolbar = document.querySelector('.markup-toolbar')
  if (!toolbar) return window.innerWidth > 900 ? TOOLBAR_FALLBACK_PX : 0
  // At phone widths the toolbar is in the flow and overlaps nothing.
  if (window.getComputedStyle(toolbar).position !== 'fixed') return 0
  const rect = toolbar.getBoundingClientRect()
  if (rect.height <= 0) return 0
  return Math.max(0, Math.round(window.innerHeight - rect.top) + TOOLBAR_CLEARANCE_PX)
}

/** How many pixels of frame a driver may actually put content in, right now. */
export function readableBand(): number {
  return Math.max(160, window.innerHeight - bottomSafeArea() - FRAME_PAD_PX)
}

/**
 * Make room at the bottom of the document for the floating toolbar, and return
 * the undo.
 *
 * Framing alone cannot solve the overlap. `frameScrollTop` clamps to the
 * document's own maximum scroll, so when the thing that has to be readable is
 * the *last* thing on the page — the next-case button, at the end of a graded
 * case — there is simply no scroll position that lifts it clear, and the
 * toolbar sits across it. The page has to get longer.
 *
 * Scoped to a driven run rather than applied to the app, because the underlying
 * defect is the app's and belongs to whoever owns that toolbar: `position:
 * fixed; bottom: 20px` with no reserved space is going to clip the foot of any
 * short page, on a desk as well as on a projector. Reserving it here fixes the
 * demo without quietly changing a layout the founders are working in.
 */
export function reserveToolbarSpace(): () => void {
  const reserved = bottomSafeArea()
  if (reserved <= 0) return () => {}
  const previous = document.body.style.paddingBottom
  document.body.style.paddingBottom = `${reserved}px`
  return () => { document.body.style.paddingBottom = previous }
}

/** A span of the document, in document coordinates. */
export type Span = { top: number; bottom: number }

/**
 * The document-space span covering every element given, ignoring the ones that
 * are not on the page. Returns null when none of them are.
 */
export function spanOf(...elements: Array<Element | null | undefined>): Span | null {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const element of elements) {
    if (!element) continue
    const rect = element.getBoundingClientRect()
    if (rect.height <= 0 && rect.width <= 0) continue
    top = Math.min(top, rect.top + window.scrollY)
    bottom = Math.max(bottom, rect.bottom + window.scrollY)
  }
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null
}

/**
 * Where to scroll so `span` sits in the readable band of the frame.
 *
 * A span that fits is placed a third of the way down the free space rather than
 * dead centre: text is read from its first line, and a block centred in the
 * frame reads as a picture of a block. A span that does not fit is aligned to
 * its top, because the top of a question is the part that has to be read first.
 */
export function frameScrollTop(span: Span): number {
  const viewportHeight = window.innerHeight
  const band = readableBand()
  const spanHeight = Math.max(0, span.bottom - span.top)
  const slack = spanHeight <= band ? (band - spanHeight) * 0.32 : 0
  const target = span.top - FRAME_PAD_PX - slack
  const maximum = Math.max(0, document.documentElement.scrollHeight - viewportHeight)
  return Math.min(maximum, Math.max(0, Math.round(target)))
}

/**
 * Wait until the page has stopped moving under its own weight.
 *
 * The framing rules read element positions, and on a cold load those positions
 * are wrong for a second or so. Traced on the real page: at 615ms the document
 * is 781 pixels tall and the answer card does not exist; at 1131ms the card is
 * there and its stimulus starts at 384; at 1427ms the stimulus has moved to
 * 479 and the document has grown to 1195. A frame computed at 1131ms lands 95
 * pixels short, which is the difference between the submit button sitting in
 * the frame and hanging out of the bottom of it.
 *
 * Stability is measured rather than inferred, because the obvious signal lies:
 * `document.fonts.ready` resolves at 615ms on this page — before the case
 * screen has mounted and therefore before the fonts it needs have been asked
 * for — and then the fonts load and everything moves. So this watches the two
 * numbers the framing actually depends on and waits for them to hold still.
 *
 * Only the first question of a run can hit this. Capped, because an asset that
 * never arrives must cost a slightly worse frame, not the run.
 */
export function settleLayout(signal: AbortSignal, timeoutMs = 2_500): Promise<void> {
  const shape = () => {
    const card = document.querySelector('.answer-card')
    const top = card ? Math.round(card.getBoundingClientRect().top + window.scrollY) : -1
    return `${document.documentElement.scrollHeight}:${top}`
  }
  let last = ''
  let holds = 0
  return waitFor(
    () => {
      const now = shape()
      holds = now === last ? holds + 1 : 0
      last = now
      // Roughly half a second of stillness, and never before the card exists.
      // Two reads was not enough: the traced page holds one shape for 130ms
      // between the card mounting and its fonts landing, so a short quorum
      // framed the intermediate layout and then had to correct itself — a
      // visible two-stage scroll, which is worse than the miss it fixed.
      return holds >= 4 && !now.endsWith(':-1')
    },
    timeoutMs,
    signal,
    110,
  ).then(() => {})
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Scroll the window to `target` over `durationMs`, resolving when it lands or
 * when `signal` aborts.
 *
 * Hand-animated rather than `behavior: 'smooth'` for two reasons that both
 * matter on stage: the duration of a smooth scroll is the browser's to choose,
 * so the pacing could not be tuned; and a smooth scroll cannot be interrupted
 * cleanly, so a driver that had to stop mid-scroll would keep gliding after it
 * had given up. Every write is `behavior: 'instant'` because `styles.css` sets
 * `html { scroll-behavior: smooth }`, which would otherwise animate each frame
 * of this animation.
 */
export function easeScroll(target: number, durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const from = window.scrollY
    const distance = target - from
    if (signal.aborted || distance === 0 || durationMs <= 0 || prefersReducedMotion()) {
      window.scrollTo({ top: target, behavior: 'instant' })
      resolve()
      return
    }
    const started = performance.now()
    let frame = 0
    const finish = () => {
      cancelAnimationFrame(frame)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
    const tick = (now: number) => {
      if (signal.aborted) return
      const t = Math.min(1, (now - started) / durationMs)
      window.scrollTo({ top: Math.round(from + distance * easeInOut(t)), behavior: 'instant' })
      if (t < 1) frame = requestAnimationFrame(tick)
      else finish()
    }
    frame = requestAnimationFrame(tick)
  })
}

/** A cancellable pause. Resolves early — never rejects — when `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve()
      return
    }
    const finish = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Wait until `predicate` holds, polling on a short interval.
 *
 * Used for the things the driver genuinely has to wait on — the server
 * accepting an answer, the next case arriving, explanation grading having been
 * *handed off* — all of which are observed through React state rather than
 * promised to us. Resolves false on timeout so the caller can degrade instead
 * of hanging.
 *
 * The timeout counts time the page was actually running, not wall-clock. A
 * demo machine is doing several things at once — a dev server, a deck, and a
 * backend grading fifteen answers on a background worker — and under that load
 * this tab's main thread has been observed frozen for fifteen seconds at a
 * stretch. Wall-clock deadlines turn that into a stopped demo: no poll runs
 * during the freeze, and the first one afterwards finds the budget spent and
 * gives up on a run that was fine. So a gap much longer than the poll interval
 * is treated as time the driver was not conscious for, and given back. What
 * stays bounded is the thing the timeout is actually for — a server that is
 * answering, slowly or not at all.
 */
export function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  signal: AbortSignal,
  pollMs = 90,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (predicate()) {
      resolve(true)
      return
    }
    let deadline = performance.now() + timeoutMs
    let previous = performance.now()
    const finish = (value: boolean) => {
      window.clearInterval(timer)
      signal.removeEventListener('abort', abort)
      resolve(value)
    }
    const abort = () => finish(false)
    const timer = window.setInterval(() => {
      const now = performance.now()
      const gap = now - previous
      previous = now
      if (gap > pollMs * 4) deadline += gap - pollMs
      if (predicate()) finish(true)
      else if (now > deadline) finish(false)
    }, pollMs)
    signal.addEventListener('abort', abort, { once: true })
  })
}
