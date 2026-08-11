/**
 * Account for every timer, frame callback and listener the page takes out.
 *
 * Injected by `stress.mjs` with `addInitScript`, so it wraps the four APIs
 * before a single module of the deck has been parsed and therefore sees all of
 * them. Nothing here changes behaviour: every wrapper delegates to the original
 * and returns what the original returned.
 *
 * ## Why the deck needs this and a console listener does not suffice
 *
 * The failure this deck has been bitten by twice is a callback belonging to
 * slide N that is still live on slide N+3. That is only *sometimes* a console
 * error — it is one when the callback touches something that has been unmounted,
 * and it is silent when it merely runs. The silent case is the expensive one: it
 * is a slide's worth of work added to every subsequent frame for the rest of the
 * talk, which is what "very glitchy" looks like from the audience.
 *
 * So the leak is measured directly. What is outstanding, and which line took it
 * out.
 *
 * ## Reading the frame-callback number
 *
 * `rafPerSecond` is the count of `requestAnimationFrame` registrations in one
 * second at rest, which for a self-rescheduling loop is the number of loops
 * running times the display's refresh rate. Divide before believing it. The deck
 * at rest on a text slide should have exactly one: `DeckStage.tick`. A slide
 * with a ported app scene has two, and the app scene's own
 * `IntersectionObserver` is supposed to take it back to one when that scene is
 * parked off-viewport.
 */
;(() => {
  const raw = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
  }

  const timeouts = new Map()
  const intervals = new Map()
  const listeners = new Map()
  let rafCount = 0

  /**
   * Where the call came from, minus this file's own frames.
   *
   * Trimmed to four lines because the useful frame is always near the top and an
   * untrimmed stack makes the report unreadable — and sliced to 300 characters
   * because a Vite dev URL is most of a line on its own.
   */
  const site = () => {
    const stack = new Error().stack || ''
    return stack
      .split('\n')
      .slice(1)
      .filter((line) => !line.includes('ledger') && !/at (site|wrapped)/.test(line))
      .slice(0, 4)
      .map((line) => line.trim().slice(0, 300))
      .join(' | ')
  }

  window.setTimeout = function (handler, delay, ...args) {
    const id = raw.setTimeout(
      function (...called) {
        timeouts.delete(id)
        if (typeof handler === 'function') return handler.apply(this, called)
        return undefined
      },
      delay,
      ...args,
    )
    timeouts.set(id, { delay: Number(delay) || 0, at: performance.now(), site: site() })
    return id
  }

  window.clearTimeout = function (id) {
    timeouts.delete(id)
    return raw.clearTimeout(id)
  }

  window.setInterval = function (handler, delay, ...args) {
    const id = raw.setInterval(handler, delay, ...args)
    intervals.set(id, { delay: Number(delay) || 0, at: performance.now(), site: site() })
    return id
  }

  window.clearInterval = function (id) {
    intervals.delete(id)
    return raw.clearInterval(id)
  }

  window.requestAnimationFrame = function (callback) {
    rafCount += 1
    return raw.requestAnimationFrame(callback)
  }

  // Listeners are counted net, by target and type, because the absolute number
  // is meaningless — React attaches its own at the root and the browser attaches
  // more. What matters is whether the count for a given type goes up on every
  // lap of the deck, which is the signature of a listener added on mount and not
  // taken off on unmount.
  const targets = [
    [window, 'window'],
    [document, 'document'],
  ]
  for (const [target, name] of targets) {
    const add = target.addEventListener.bind(target)
    const remove = target.removeEventListener.bind(target)
    target.addEventListener = function (type, ...rest) {
      const key = `${name}:${type}`
      listeners.set(key, (listeners.get(key) || 0) + 1)
      return add(type, ...rest)
    }
    target.removeEventListener = function (type, ...rest) {
      const key = `${name}:${type}`
      listeners.set(key, (listeners.get(key) || 0) - 1)
      return remove(type, ...rest)
    }
  }

  window.__deckLedger = {
    /** Frame callbacks registered over `ms`, which for a self-rescheduling loop is loops × refresh rate. */
    async rafPerSecond(ms = 1000) {
      const before = rafCount
      await new Promise((done) => raw.setTimeout(done, ms))
      return Math.round(((rafCount - before) * 1000) / ms)
    },
    read() {
      const now = performance.now()
      const outstanding = (map) =>
        [...map.values()].map((entry) => ({ ...entry, ageMs: Math.round(now - entry.at) }))
      return {
        intervals: outstanding(intervals),
        // A timeout that has been armed longer than the deck's slowest
        // transition and has not fired is either a very long deliberate delay or
        // a callback whose owner has gone. Both are worth naming; neither is
        // common enough for the list to be noisy.
        staleTimeouts: outstanding(timeouts).filter((entry) => entry.ageMs > 4000),
        liveTimeouts: timeouts.size,
        listeners: [...listeners.entries()]
          .filter(([, count]) => count !== 0)
          .map(([key, count]) => ({ key, net: count }))
          .sort((a, b) => b.net - a.net),
      }
    },
  }
})()
