import { useCallback, useEffect, useState } from 'react'

/**
 * Whether the start card is up, and the two deliberate ways it changes.
 *
 * ## When it appears
 *
 * On a fresh open of the deck, and only then. The rule is one line — the card is
 * shown when the URL does not name a slide — and it falls out of how a presenter
 * actually uses the deck:
 *
 *   - `http://localhost:5180`            → card. This is the pre-talk state.
 *   - `http://localhost:5180#/demo-map…` → no card. A deep link is a jump into
 *                                          the middle of the talk, and a curtain
 *                                          in front of it would be a bug.
 *   - a reload part-way through          → no card, for the same reason: the deck
 *                                          rewrites the hash on every navigation,
 *                                          so a reload is a deep link.
 *   - `?start=0` / `?start=1`            → forced off / forced on, for rehearsal
 *                                          and for screenshots.
 *
 * Deciding it on "is there a hash" rather than on "which slide is it" is also
 * what keeps this out of everyone else's way: the deck's own harnesses and every
 * ad-hoc Playwright script in this repo address a slide as `#/<id>`, and none of
 * them has to know the card exists. The two that open the deck at its bare URL —
 * `scripts/walk.mjs` and the grid capture in `scripts/shoot.mjs` — pass
 * `?start=0`.
 *
 * ## What backwards does
 *
 * Nothing. Left arrow on slide 1 stays on slide 1, exactly as it does today — the
 * card is not slide zero, and reversing into it would mean the first keystroke of
 * a talk could put a title card back over the room. Instead the card is reachable
 * on purpose with `T`, which brings it back over whatever slide is showing and
 * returns to that same slide when dismissed. It is a holding card, not a
 * navigation: nothing is lost by pressing it, including a live demo iframe, and
 * `Home` remains the way to actually go back to slide 1.
 */

export type StartGate = {
  showing: boolean
  /** `curtain` when the card is being brought back over a running deck. */
  arrival: 'immediate' | 'curtain'
  /** Called by the card once its shutter has opened on the deck. */
  dismiss: () => void
}

function initialState(): boolean {
  const search = new URLSearchParams(window.location.search)
  const forced = search.get('start')
  if (forced === '0' || forced === 'false') return false
  if (forced === '1' || forced === 'true') return true
  // Anything after the `#` is a deep link, including a bare `#/` — which only
  // exists because something navigated — so the only state that gets the card is
  // a URL with no fragment at all.
  return window.location.hash.replace(/^#\/?/, '') === ''
}

export function useStartGate(): StartGate {
  const [state, setState] = useState<{ showing: boolean; arrival: StartGate['arrival'] }>(
    () => ({ showing: initialState(), arrival: 'immediate' }),
  )

  const dismiss = useCallback(() => { setState({ showing: false, arrival: 'immediate' }) }, [])

  // `T` brings the card back. Registered only while the card is down, so there
  // is no chance of it fighting the card's own capture-phase handler, and in the
  // capture phase so it is decided before the deck's `window` listener sees it —
  // the deck has no `t` case today, but a deck that grew one would silently do
  // both things.
  useEffect(() => {
    if (state.showing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== 't') return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      event.preventDefault()
      event.stopPropagation()
      setState({ showing: true, arrival: 'curtain' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state.showing])

  return { showing: state.showing, arrival: state.arrival, dismiss }
}
