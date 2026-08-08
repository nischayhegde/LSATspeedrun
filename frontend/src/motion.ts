// Scripted interface sequences share a compact timing scale. Three-dimensional
// scenes deliberately do not inherit a global playback-rate multiplier: their
// cameras and actors use frame-rate-independent interpolation instead.
export const MOTION_TIMING = {
  characterEntranceMs: 1120,
  countUpMs: 280,
  pageTurnCurlMs: 105,
  pageTurnTotalMs: 285,
  toastMs: 620,
  popupDelayMs: 280,
} as const

// ---------------------------------------------------------------------------
// Figures that move when the data behind them moves.
//
// The durations and curve below mirror the CSS motion tokens at the end of
// `styles.css` (--mo-4 / --mo-out), so JS-driven and CSS-driven motion are the
// same hand. If those change, change these.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react'

const ROLLUP_MS = 420

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** cubic-bezier(.2,.7,.3,1) is close enough to this for a scalar. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Rolls a displayed figure to `value` whenever `value` changes.
 *
 * Unlike a count-up, this deliberately does not animate on first render. A
 * dashboard that counts every figure up from zero on load is slower to read
 * and slower to feel, and fast loads are a standing requirement here. The roll
 * only carries information when it shows that a number has *moved* since the
 * reader last looked — after a run is finished, or after a refetch — so that
 * is the only case it fires.
 *
 * Reduced motion lands the new value immediately. Landing the finished state
 * is the correct accommodation; a frozen or withheld figure would be a stall.
 * CSS cannot reach a requestAnimationFrame loop, so this is checked in JS.
 */
export function useRollup(value: number | null | undefined, duration = ROLLUP_MS): number | null | undefined {
  const [shown, setShown] = useState(value)
  const settled = useRef(value)
  const frame = useRef(0)

  useEffect(() => {
    const from = settled.current
    settled.current = value

    if (
      typeof value !== 'number'
      || typeof from !== 'number'
      || from === value
      || prefersReducedMotion()
    ) {
      setShown(value)
      return
    }

    const started = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      setShown(from + (value - from) * easeOut(t))
      if (t < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [value, duration])

  return shown
}

/** `useRollup` for figures displayed as whole numbers. */
export function useRollupInt(value: number | null | undefined, duration = ROLLUP_MS): number | null | undefined {
  const rolled = useRollup(value, duration)
  return typeof rolled === 'number' ? Math.round(rolled) : rolled
}

const ACCRUAL_TICK_MS = 600

/** What `useLiveAccrual` needs to reconstruct a pending accrual from scratch. */
export type AccrualRate = {
  /** Dollars per hour, as the server currently confirms it. Non-positive means nothing is accruing. */
  hourlyRate: number
  /** Hours the accrual can hold before it stops growing. */
  capHours: number
  /** ISO timestamp of the last server-side settlement this rate has been accruing since. */
  sinceIso: string
}

/**
 * The whole-dollar amount a confirmed hourly rate has added since `sinceIso`,
 * recomputed from that timestamp on a short interval rather than accumulated
 * in local state — so there is nothing here that can drift from the server.
 * Every tick asks "what would a fetch report right now", using only inputs
 * the server already confirmed (the rate, the cap, and the settlement time),
 * the same way `_passive_state` computes it on the backend. Feed the next
 * `AccrualRate` a refetch produces back in and this simply starts asking the
 * question from the new confirmed inputs — there is no running total of its
 * own to reconcile.
 *
 * Returns 0 — meaning "add nothing" — whenever there is nothing actually
 * accruing right now: no rate, an unparseable timestamp, the accrual has
 * already hit its cap, or the reader asked for reduced motion. Callers add
 * this on top of a confirmed base value; they should not treat 0 as "unknown".
 *
 * The interval is deliberately coarse (600ms, not a `requestAnimationFrame`
 * loop): the figure only needs to advance in whole-dollar steps that read as
 * continuous at reading distance, not to redraw every frame.
 */
export function useLiveAccrual(rate: AccrualRate | null | undefined): number {
  const [amount, setAmount] = useState(0)

  useEffect(() => {
    if (!rate || rate.hourlyRate <= 0 || prefersReducedMotion()) {
      setAmount(0)
      return
    }
    const sinceMs = Date.parse(rate.sinceIso)
    if (!Number.isFinite(sinceMs)) {
      setAmount(0)
      return
    }
    const capHours = Math.max(0, rate.capHours)
    const hourlyRate = rate.hourlyRate

    let timer = 0
    const tick = () => {
      const elapsedHours = Math.max(0, (Date.now() - sinceMs) / 3_600_000)
      const cappedHours = Math.min(elapsedHours, capHours)
      setAmount(Math.floor(hourlyRate * cappedHours))
      // Once the cap is reached the figure cannot move again until a refetch
      // brings a new `sinceIso` — stop polling rather than recompute the same
      // answer forever.
      if (elapsedHours >= capHours) window.clearInterval(timer)
    }
    tick()
    timer = window.setInterval(tick, ACCRUAL_TICK_MS)
    return () => window.clearInterval(timer)
  }, [rate?.hourlyRate, rate?.capHours, rate?.sinceIso])

  return amount
}

/**
 * The size of the last movement in `value`, held for `holdMs` and then cleared.
 *
 * Pairs with `useRollup`: the roll shows the figure travelling, this says how
 * far it travelled and in which direction. Both read the same input, so both
 * are describing a change the server has already confirmed — feed this the
 * value you render, never a predicted one, or the badge will announce a
 * movement that never happened.
 *
 * Nothing is reported for the first value seen. Arriving on a screen is not a
 * change, and a card that flashes "+$12,400" because it just mounted is
 * claiming an event that did not occur.
 */
export function useDelta(value: number | null | undefined, holdMs = 1600): number | null {
  const [delta, setDelta] = useState<number | null>(null)
  const previous = useRef(value)

  useEffect(() => {
    const from = previous.current
    previous.current = value
    if (typeof value !== 'number' || typeof from !== 'number' || from === value) return

    setDelta(value - from)
    const timer = window.setTimeout(() => setDelta(null), holdMs)
    return () => window.clearTimeout(timer)
  }, [value, holdMs])

  return delta
}
