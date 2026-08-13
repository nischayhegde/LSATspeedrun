import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'

import type { AppSceneSlot } from '../engine/use-deck'
import { setStageOccluded } from './occlusion'

/**
 * The layer that hosts the two **ported app scenes**.
 *
 * `OfficeThreeScene` and `MapThreeScene` are lifted unchanged out of the product
 * (see `src/app-art/PORT.md`), and each constructs its own `WebGLRenderer` on
 * mount exactly as it does inside the app. That is why they are not residents of
 * the shared stage: bringing them under one renderer would mean forking four
 * thousand lines of the app's art, and a fork is the one thing that would let the
 * deck's office drift away from the product's.
 *
 * So they are mounted here instead, on a layer above the stage canvas and below
 * the slide copy. The runtime keeps at most three slots alive — the current
 * slide's, the outgoing one's during a transition, and one warm neighbour — which
 * is three WebGL contexts plus the stage's own, comfortably inside any browser's
 * limit and the price of never paying a room build on a keystroke.
 */

const DeckOfficeScene = lazy(async () => ({
  default: (await import('./office-scene')).DeckOfficeScene,
}))
const DeckMapScene = lazy(async () => ({
  default: (await import('./map-scene')).DeckMapScene,
}))

/**
 * The app's own boot plate, reused.
 *
 * A room takes a few hundred milliseconds to build and the deck should say so in
 * the product's voice rather than with a generic spinner. This is the gold pixel
 * chip from `frontend/index.html`, at the same bevel.
 */
function SceneBooting({ label }: { label: string }) {
  return (
    <div className="scene-booting" role="status">
      <i className="bevel" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path
            d="M7 20h10v2H7z M10 18h4v2h-4z M11 7h2v11h-2z M10 3h4v3h-4z M3 6h18v2H3z M4 8h1v3H4z M19 8h1v3h-1z M1 11h7l-1.75 3.25h-3.5z M16 11h7l-1.75 3.25h-3.5z"
            fill="currentColor"
          />
        </svg>
      </i>
      <span>{label}</span>
    </div>
  )
}

/**
 * Tier 0 beside tier 14, in the same framing, with a draggable divider.
 *
 * ## Why a slider and not a cut
 *
 * A cut between the two rooms makes the audience compare two pictures from
 * memory. A divider makes them compare two pictures at once, and because both
 * sides are the same scene at the same camera the eye lands immediately on what
 * changed: the room is wider, the window is glazed, and there are sixteen people
 * in it instead of one. That comparison is the single strongest image in the deck,
 * and it is worth two WebGL contexts.
 *
 * ## The cost, measured rather than assumed
 *
 * The office manifest records the real numbers: a tier-14 practice floor is about
 * 1,798 draw calls and 330,000 triangles with its full shift, and an empty floor
 * is 292 and 53,000. Tier 0 with almost nothing owned sits near the bottom of that
 * range, so the pair is roughly 2,100 draw calls across two contexts. If that does
 * not hold 60fps on the presenting machine, the `S` key swaps the whole deck to
 * stills and this slide falls back to the two captured frames — which is a real
 * fallback rather than a theoretical one, because those two stills are the images
 * this scene was composed against.
 *
 * The divider drifts on its own, so the slide is alive if the presenter never
 * touches it, and drag takes over the moment they do.
 */
function OfficeTransform({ floor, live }: { floor: 'practice' | 'chambers'; live: boolean }) {
  const [split, setSplit] = useState(.5)
  const dragging = useRef(false)
  const host = useRef<HTMLDivElement | null>(null)
  const [drifting, setDrifting] = useState(true)

  // Only while this slot is the slide, and only until the presenter takes the
  // divider off it.
  //
  // The loop used to reschedule unconditionally for as long as the component
  // was mounted, which is two slides longer than it is on screen: a warm slot
  // is built one slide early and an outgoing slot is held through the
  // transition, and both of them would have gone on calling `setSplit` sixty
  // times a second — re-rendering two lazily-loaded WebGL scene components
  // apiece to move a divider nobody could see. It also kept rescheduling after
  // a drag had turned the drift off, so a presenter who touched the slider once
  // left a frame callback running for the rest of the talk to do nothing.
  //
  // No slide asks for this scene today, so neither of those was ever paid. That
  // is exactly why it is worth closing now rather than when one does.
  useEffect(() => {
    if (!live || !drifting) return
    let frame = 0
    const started = performance.now()
    const tick = (now: number) => {
      // A slow, wide sweep. Period chosen so a presenter talking for seventy
      // seconds sees it cross the frame twice and never sees it turn around at
      // the same moment twice.
      const t = (now - started) / 1000
      setSplit(.5 + Math.sin(t * .16) * .3)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [live, drifting])

  const move = useCallback((clientX: number) => {
    const box = host.current?.getBoundingClientRect()
    if (!box) return
    setSplit(Math.min(.97, Math.max(.03, (clientX - box.left) / box.width)))
  }, [])

  return (
    <div
      className="office-transform"
      ref={host}
      onPointerDown={(event) => {
        dragging.current = true
        setDrifting(false)
        move(event.clientX)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => { if (dragging.current) move(event.clientX) }}
      onPointerUp={() => { dragging.current = false }}
    >
      {/* Tier 14 fills the frame; tier 0 is clipped over the top of it, so the
          divider is one clip-path rather than two competing widths — which
          matters, because resizing a WebGL canvas mid-drag would rebuild the
          room. Both canvases stay at full size throughout. */}
      <div className="office-half is-full">
        <Suspense fallback={<SceneBooting label="Building the Planetary Justice Nexus" />}>
          <DeckOfficeScene tier={14} full floor={floor} client={false} attend={false} />
        </Suspense>
      </div>
      <div className="office-half is-shack" style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}>
        <Suspense fallback={<SceneBooting label="Building the Wooden Shack" />}>
          <DeckOfficeScene tier={0} full={false} floor={floor} client={false} attend={false} />
        </Suspense>
      </div>
      <div className="office-divider" style={{ left: `${split * 100}%` }}>
        <b>TIER 00 · WOODEN SHACK</b>
        <i />
        <b>TIER 14 · PLANETARY JUSTICE NEXUS</b>
      </div>
    </div>
  )
}

function Slot({ slot }: { slot: AppSceneSlot }) {
  const params = slot.params
  if (slot.scene === 'office-transform') {
    return (
      <OfficeTransform
        floor={params.floor === 'chambers' ? 'chambers' : 'practice'}
        live={slot.role === 'current'}
      />
    )
  }
  if (slot.scene === 'office') {
    return (
      <Suspense fallback={<SceneBooting label="Building the office" />}>
        <DeckOfficeScene
          tier={typeof params.tier === 'number' ? params.tier : 14}
          full={params.full !== false}
          floor={params.floor === 'chambers' ? 'chambers' : 'practice'}
          // A slide may turn the consultation off with `client: false`; nothing
          // needs to turn it on, because a room with a client in it is the shot
          // this scene should have been giving all along. `attend: false` keeps
          // her in the room but leaves the camera on its own opening framing,
          // and `mood` picks up the app's own lighting states.
          client={params.client !== false}
          attend={params.attend !== false}
          rake={typeof params.rake === 'number' ? params.rake : 0}
          mood={params.mood === 'focus' ? 'focus' : params.mood === 'storm' ? 'storm' : undefined}
        />
      </Suspense>
    )
  }
  if (slot.scene === 'map') {
    const region = typeof params.region === 'string' ? params.region : 'city'
    return (
      <Suspense fallback={<SceneBooting label="Surveying the district" />}>
        <DeckMapScene region={region as 'city' | 'nation' | 'ocean' | 'continent' | 'orbit'} />
      </Suspense>
    )
  }
  return null
}

export function AppSceneLayer({ slots }: { slots: AppSceneSlot[] }) {
  // While one of these is the slide, the stage canvas underneath is covered
  // edge to edge and can stop drawing. See `occlusion.ts` for the measurement
  // that made this worth a module.
  const covered = slots.some((slot) => slot.role === 'current')
  useEffect(() => {
    setStageOccluded('app-scene', covered)
    return () => setStageOccluded('app-scene', false)
  }, [covered])

  return (
    <>
      {slots.map((slot) => (
        <div
          key={slot.key}
          className="deck-appscene"
          data-role={slot.role}
          // A warm slot is built and sized but neither composited nor drawn.
          //
          // Not `display: none`: a display-none canvas is given no size, so the
          // scene would build against a 0x0 viewport and have to rebuild the
          // moment it was shown, which is the entire cost warming exists to
          // avoid. And not `opacity: 0` alone, which is what this used to be —
          // an invisible office is still an office, and it kept its animation
          // loop running at full price. Measured on a full pass: a warm office
          // slot used to keep drawing 363 calls and 272,000 triangles a frame
          // on the slides next to it, which dropped those slides to 20fps.
          // Everything else in the deck held 60.
          //
          // Parking it off the viewport is what fixes it, because both ported
          // scenes already watch their own canvas with an `IntersectionObserver`
          // and cancel their `requestAnimationFrame` when it stops intersecting
          // — that is the app's own idiom for an off-screen scene, and it
          // resumes on the next frame after the transform comes off. Neither
          // `opacity` nor `visibility` is visible to that observer; only
          // geometry is.
          style={slot.role === 'warm'
            ? { opacity: 0, pointerEvents: 'none', transform: 'translateY(-200vh)' }
            : undefined}
          aria-hidden={slot.role !== 'current'}
        >
          <Slot slot={slot} />
        </div>
      ))}
    </>
  )
}
