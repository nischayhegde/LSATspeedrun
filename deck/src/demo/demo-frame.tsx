import { useEffect, useRef, useSyncExternalStore } from 'react'

import { demoConfig } from '../../demo.config'
import type { DemoSpec } from '../slides/types'
import { getStatus, registerSlot, resolveRoute, runtimeVersion, subscribeRuntime } from './demo-runtime'

/**
 * The frame around a live embed of the running product: its chrome, its caption,
 * its still, and the hole the embed goes in.
 *
 * ## Why an iframe at all
 *
 * The alternative is a video, and a video of software is a claim about software.
 * On these five slides the app is genuinely running on the presenter's machine
 * against a seeded account, and the presenter can click it. That is worth the
 * operational risk, and the rest of the demo runtime is about making that risk
 * bounded.
 *
 * ## Why the iframe is not in this file any more
 *
 * It used to be, and that was the bug. `use-deck.ts` empties the outgoing slide's
 * layer when a transition completes, so an iframe rendered here was destroyed on
 * every slide change — including the change from slide 12 to slide 13, which the
 * narrative writes as one continuous session with a question already answered in
 * it. The embed therefore lives in `DemoStage`, mounted once above the slide
 * layers, and survives a run of consecutive demo slides. See the long note there.
 *
 * What is left here is everything that legitimately belongs to the slide: the
 * engine-turned title bar with the route and the lamp, the caption, the still,
 * and a `.demo-screen` element whose only job now is to be measured. It publishes
 * itself to `demo-runtime` and the stage positions the embed over it, which means
 * the slide layout — owned by the narrative, in `slides/layouts.tsx` — still
 * decides where and how big the demo is, exactly as before.
 *
 * ## The three things that make it safe on stage
 *
 * 1. **A health probe with a hard timeout**, in the stage, once for the deck.
 *    A dead app origin swaps every embed to its still, with a lamp in this title
 *    bar so the presenter can see which they are looking at without being told.
 * 2. **A global override.** `?stills=1`, or the `S` key at any time, forces every
 *    embed to its still. If a demo misbehaves mid-talk that is one keystroke away.
 * 3. **One embed, ever.** There was never more than one visible; now there is
 *    never more than one at all, so nothing is running the app in a background
 *    layer competing for the main thread.
 *
 * ## Legibility, which is a real constraint
 *
 * The app's dashboard is authored for a desktop browser. Rendered into a 1100px
 * slot on a projector it is unreadable from the fourth row. So the iframe is given
 * a *logical* width (1440 by default) and then scaled to fit the slot with
 * `transform`, which means the app lays out as it would on a desktop and every
 * glyph is then magnified. `zoom` above 1 shrinks the logical width further, which
 * magnifies more. This is the only way to get an app designed for a desk to read
 * across a room without restyling it. The arithmetic is in the stage, against the
 * measured rect of the slot below.
 *
 * ## Auth
 *
 * The app's session cookies are `SameSite=Lax`, so a framed app page stays signed
 * in only when the framing document is on the same site — and site is host, not
 * origin, so `localhost:5180` framing `localhost:5173` works and `127.0.0.1:5180`
 * framing it does not. The runbook says to open the deck as `localhost:5180`, and
 * the preflight on the start card now checks it rather than trusting it.
 */

type Props = {
  demo: DemoSpec
  /** The deck-wide stills override. */
  stills: boolean
  /** How many annotations to show. Advanced with `A`. Rendered by the stage. */
  annotations: number
  /** False for a slide that is warm but not on screen. */
  active: boolean
}

export function DemoFrame({ demo, stills, active }: Props) {
  useSyncExternalStore(subscribeRuntime, runtimeVersion)
  const status = getStatus()
  const slot = useRef<HTMLDivElement | null>(null)

  const sessionId = status.sessionId || demoConfig.liveSessionId
  const route = resolveRoute(demo.route, sessionId)
  const sessionMissing = demo.route.includes('{session}') && !sessionId
  const showStill = stills || demoConfig.useStills || demo.stillOnly || sessionMissing || status.health === 'unreachable'

  /**
   * Published under this slide's own `DemoSpec`, and only while this layer is the
   * live one. Both slide layers are mounted during a transition, and the stage
   * has to be able to ask for the rect of one particular slide's slot rather than
   * whichever happened to register last.
   */
  useEffect(() => {
    if (!active) return
    // A `stillOnly` slide never registers, and that is what actually makes the
    // flag work. Painting the still here is not enough on its own: the stage
    // positions the live embed *over* this slot, so a registered slot with a
    // healthy origin puts the running app on top of the picture. No slot, no
    // embed. Deliberately narrower than `showStill` — the global `?stills=1`
    // override and the unreachable-origin fallback keep registering exactly as
    // before, so this changes one slide and no other path.
    if (demo.stillOnly) return
    registerSlot(demo, slot.current)
    return () => registerSlot(demo, null)
  }, [active, demo])

  const label = sessionMissing
    ? 'no seeded session'
    : stills || demoConfig.useStills || demo.stillOnly
      ? 'stills'
      : status.health === 'live'
        ? 'live'
        : status.health === 'checking'
          ? 'connecting'
          : 'app not running'

  return (
    <figure className="demo">
      <div className="demo-chrome">
        {/* The title bar is the app's own chrome language: an engine-turned navy
            plate, a gold bevelled chip for the mark, monospace for the route. */}
        <header className="demo-bar engraved">
          <span className="demo-chip bevel" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                d="M7 20h10v2H7z M10 18h4v2h-4z M11 7h2v11h-2z M10 3h4v3h-4z M3 6h18v2H3z M4 8h1v3H4z M19 8h1v3h-1z M1 11h7l-1.75 3.25h-3.5z M16 11h7l-1.75 3.25h-3.5z"
                fill="currentColor"
              />
            </svg>
          </span>
          <code>{demoConfig.appOrigin.replace(/^https?:\/\//, '')}{route}</code>
          <span className={`demo-lamp is-${label.replace(/\s+/g, '-')}`} title={label}>{label}</span>
        </header>

        {/* Measured by the stage, which positions the live embed over it. The
            still is painted here rather than there so that it transitions with
            the slide it belongs to. */}
        <div className="demo-screen" ref={slot}>
          {showStill ? (
            <img className="demo-still" src={`/stills/${demo.still}`} alt={demo.caption ?? route} />
          ) : null}
        </div>
      </div>

      {demo.caption ? <figcaption>{demo.caption}</figcaption> : null}
    </figure>
  )
}
