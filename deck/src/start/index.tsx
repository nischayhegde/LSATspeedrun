import { useEffect } from 'react'

import { demoConfig } from '../../demo.config'
import { preflight } from '../demo/preflight-strip'
import { publicUrl } from '../public-url'
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
    // Toggle variants included, and the omission was not academic.
    // `demo-office-transformation` is scripted as a toggle: `O` swaps the embed
    // to tier 14, and `demo-office-tier14.webp` is both that beat's still and the
    // panic-button image for it. Reading only `demo.still` warmed the tier-0
    // frame and left the toggled-to one cold, so the one keystroke the slide
    // exists for pulled a multi-megabyte file off disk in front of the room —
    // the exact stall this warm-up was written to prevent, on the exact slide
    // that most needs it.
    const stills = [...new Set(
      SLIDES.flatMap((slide) => [slide.demo?.still, slide.demo?.toggle?.still])
        .filter((still): still is string => Boolean(still)),
    )].map((still) => publicUrl(`stills/${still}`))
    // The two app routes whose scene modules Vite has to transform on first
    // request. Warmed here so the office slide does not open with a nine-second
    // stall — the job the runbook used to hand to the presenter.
    // `deck-warm` is ignored by the app and is there for the verification
    // scripts, which locate the demo embed by origin: without a marker a warm
    // frame can be mistaken for the embed and measured instead of it.
    // Nothing to warm on a machine that can only show stills.
    //
    // `warm-up.ts` already says of these that "a stills-only run never touches
    // them", and that was true of the intent and not of the code: the queue puts
    // them last, but it is handed them unconditionally and never consults the
    // flag. So a stills-only machine — which is every machine that cannot reach
    // the app, including the one this deck is presented from if the backend is
    // down — loaded two full app documents and about 175 requests it had no way
    // to use, competing with the still fetches immediately above that it does
    // need. The flag has to be read at the call site, because `startWarmUp` is a
    // generic queue and has no business knowing what a demo is.
    const routes = demoConfig.useStills ? [] : [
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
