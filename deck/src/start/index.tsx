import { useEffect } from 'react'

import { demoConfig } from '../../demo.config'
import { preflight } from '../demo/preflight-strip'
import { SLIDES } from '../slides'
import { StartScreen } from './start-screen'
import { useStartGate } from './use-start-gate'
import { startWarmUp } from './warm-up'

export { FOUNDERS, UT_SEAL } from './founders'
export { startWarmUp } from './warm-up'

/**
 * The deck, behind a start card.
 *
 * `children` is the deck, and it is mounted from the first frame whether the card
 * is up or not — see `start-screen.tsx` for why that is the whole reason Start is
 * instant. This component is therefore a *cover*, not a router: it renders the
 * deck and then, conditionally, something opaque on top of it.
 */
export function StartGate({ children }: { children: React.ReactNode }) {
  const gate = useStartGate()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Started here rather than inside the card, because it has to happen on a deep
  // link too: resolving the live case session id is what keeps the demo slides
  // pointing at a session that exists, and a presenter who reloads onto slide 12
  // needs that as much as one who starts at the top. The card only *displays* it.
  useEffect(() => { void preflight() }, [])

  // Fetched and decoded while the card is up, then stopped. The stills are the
  // panic button's ammunition: `S` swaps every live embed for one of these, and
  // the moment that is wanted is not a moment to be pulling two megabytes off
  // disk. Deduplicated because several slides share a still.
  useEffect(() => {
    if (!gate.showing) return
    const stills = [...new Set(
      SLIDES.map((slide) => slide.demo?.still).filter((still): still is string => Boolean(still)),
    )].map((still) => `/stills/${still}`)
    // The two app routes whose scene modules Vite has to transform on first
    // request. Warmed here so the office slide does not open with a nine-second
    // stall — the job the runbook used to hand to the presenter.
    // `deck-warm` is ignored by the app and is there for the verification
    // scripts, which locate the demo embed by origin: without a marker a warm
    // frame can be mistaken for the embed and measured instead of it.
    const routes = [
      `${demoConfig.appOrigin}/office?deck-warm=1`,
      `${demoConfig.appOrigin}/map?deck-warm=1`,
    ]
    return startWarmUp({ stills, routes })
  }, [gate.showing])

  return (
    <>
      {children}
      {gate.showing ? (
        <StartScreen
          onEnter={gate.dismiss}
          arrival={gate.arrival}
          reduced={reduced}
          slideCount={SLIDES.length}
        />
      ) : null}
    </>
  )
}
