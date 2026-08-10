import { useEffect, useMemo, useRef, useState } from 'react'

import { demoConfig } from '../../demo.config'
import type { DemoSpec } from '../slides/types'
import { probeApp, type AppHealth } from './health'

/**
 * A live embed of the running product, in a frame that belongs to the deck.
 *
 * ## Why an iframe at all
 *
 * The alternative is a video, and a video of software is a claim about software.
 * On these five slides the app is genuinely running on the presenter's machine
 * against a seeded account, and the presenter can click it. That is worth the
 * operational risk, and the rest of this component is about making that risk
 * bounded.
 *
 * ## The three things that make it safe on stage
 *
 * 1. **A health probe with a hard timeout.** On mount the component asks whether
 *    the app origin is answering and swaps to a still if it is not, with a small
 *    lamp in the frame's title bar so the presenter can see which they are
 *    looking at without being told.
 * 2. **A global override.** `?stills=1` on the deck URL, or the `S` key at any
 *    time, forces every embed in the deck to its still. If a demo misbehaves
 *    mid-talk that is one keystroke away.
 * 3. **Only the visible slide's frame exists.** The runtime empties the outgoing
 *    slide's layer when a transition completes, so there is never a second
 *    iframe running the app in the background competing for the main thread.
 *
 * ## Legibility, which is a real constraint
 *
 * The app's dashboard is authored for a desktop browser. Rendered into a 1100px
 * slot on a projector it is unreadable from the fourth row. So the iframe is given
 * a *logical* width (1440 by default) and then scaled to fit the slot with
 * `transform`, which means the app lays out as it would on a desktop and every
 * glyph is then magnified. `zoom` above 1 shrinks the logical width further, which
 * magnifies more. This is the only way to get an app designed for a desk to read
 * across a room without restyling it.
 *
 * ## Auth
 *
 * The app's session cookies are `SameSite=Lax`, so a framed app page stays signed
 * in only when the framing document is itself on `localhost`. The deck's dev
 * server is therefore bound to `127.0.0.1:5180` and the runbook says to open it
 * as `localhost:5180`. `X-Frame-Options: DENY` is set on the backend's `/v1`
 * responses but not on the Vite-served HTML, which is why these frames point at
 * the app's dev server and never at the API origin.
 */

type Props = {
  demo: DemoSpec
  /** The deck-wide stills override. */
  stills: boolean
  /** How many annotations to show. Advanced with `A`. */
  annotations: number
  /** False for a slide that is warm but not on screen; suppresses the probe. */
  active: boolean
}

const DEFAULT_WIDTH = 1440
/** 16:10 rather than 16:9 — the app's dashboard is tall, and a 16:9 slot crops it. */
const ASPECT = 16 / 10

export function DemoFrame({ demo, stills, annotations, active }: Props) {
  const [health, setHealth] = useState<AppHealth>('checking')
  const [slot, setSlot] = useState({ width: 0, height: 0 })
  const slotRef = useRef<HTMLDivElement | null>(null)

  const logicalWidth = Math.round((demo.width ?? DEFAULT_WIDTH) / (demo.zoom ?? 1))
  const logicalHeight = Math.round(logicalWidth / ASPECT)

  /**
   * `{session}` is substituted here rather than stored in the registry, because a
   * seeded session id changes every time the demo database is rebuilt and a
   * registry holding one would be wrong by the morning of the talk.
   */
  const route = useMemo(
    () => demo.route.replace('{session}', demoConfig.liveSessionId),
    [demo.route],
  )
  const needsSession = demo.route.includes('{session}')
  const sessionMissing = needsSession && !demoConfig.liveSessionId

  const showStill = stills || demoConfig.useStills || sessionMissing || health === 'unreachable'

  useEffect(() => {
    if (!active || demoConfig.useStills || stills) return
    let live = true
    void probeApp(demoConfig.appOrigin).then((result) => { if (live) setHealth(result) })
    return () => { live = false }
  }, [active, stills])

  useEffect(() => {
    const element = slotRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setSlot({ width: element.clientWidth, height: element.clientHeight })
    })
    observer.observe(element)
    setSlot({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [])

  // Fit the logical viewport into the slot, letterboxing on whichever axis binds.
  const scale = slot.width && slot.height
    ? Math.min(slot.width / logicalWidth, slot.height / logicalHeight)
    : 0

  const status = sessionMissing
    ? 'no seeded session'
    : stills || demoConfig.useStills
      ? 'stills'
      : health === 'live'
        ? 'live'
        : health === 'checking'
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
          <span className={`demo-lamp is-${status.replace(/\s+/g, '-')}`} title={status}>{status}</span>
        </header>

        <div className="demo-screen" ref={slotRef}>
          {showStill ? (
            <img className="demo-still" src={`/stills/${demo.still}`} alt={demo.caption ?? route} />
          ) : (
            <iframe
              className="demo-iframe"
              title={demo.caption ?? route}
              src={`${demoConfig.appOrigin}${route}`}
              style={{
                width: `${logicalWidth}px`,
                height: `${logicalHeight}px`,
                transform: `scale(${scale || 0.001})`,
              }}
              // The frame is a demo of our own dev server on our own machine.
              // `allow-same-origin` is required for it to read its own cookies and
              // localStorage, which is the whole point.
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          )}

          {/* Annotations. Positioned in percentages of the screen slot so a change
              of zoom or of projector aspect does not move a callout off its
              target. Revealed one keystroke at a time. */}
          {demo.annotations?.map((annotation, position) => (
            <span
              key={annotation.label}
              className={`demo-callout from-${annotation.from ?? 'left'}${position < annotations ? ' is-shown' : ''}`}
              style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
              aria-hidden={position >= annotations}
            >
              <i className="demo-callout-pin" />
              <b>{annotation.label}</b>
            </span>
          ))}
        </div>
      </div>

      {demo.caption ? <figcaption>{demo.caption}</figcaption> : null}
    </figure>
  )
}
