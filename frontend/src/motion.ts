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
