import { useEffect, useMemo, useRef } from 'react'

import { OfficeThreeScene } from '../app-art/office-three'
import '../app-art/office-scene-host.css'
import { DECK_CONSULTATION_CLIENT_KEY, fullEmpireAssets, shackAssets, syntheticConsultation } from './synthetic-state'

/**
 * The app's 3D office, on a slide.
 *
 * ONE AT A TIME. `OfficeThreeScene` creates its own `WebGLRenderer` (and so its
 * own WebGL context) on mount and disposes it on unmount. That is the app's
 * design and it is fine, but browsers cap live contexts at roughly 8-16 and
 * silently kill the oldest when the cap is passed, so the deck must never have
 * two of these — or one of these and a `DeckMapScene` — mounted at the same
 * time. Unmount the outgoing scene before mounting the incoming one; do not
 * cross-fade them.
 */

export type DeckOfficeSceneProps = {
  /** 0..14 */
  tier: number
  /** false = the sparse shack set; true = the whole catalog and full staff. */
  full: boolean
  floor?: 'practice' | 'chambers'
  /**
   * Whether a client is in consultation at the partner desk.
   *
   * On by default, and the reason is the walkthrough's note that the characters
   * are not integrated. See `syntheticConsultation` for what the room builds when
   * this is true and why it is the one character in the scene that is doing
   * something. Off for the side-by-side tier comparison, where the subject is the
   * *room* and an identical visitor in both halves is a distraction from the only
   * thing the slide asks the audience to compare.
   */
  client?: boolean
  /**
   * Whether to select the client, which is what points the camera at her.
   *
   * Defaults to on wherever there is a client. Off for a room that is being
   * shown as a room.
   */
  attend?: boolean
  /**
   * A yaw offset from the room's own opening framing, in radians.
   *
   * Negative rakes the shot to the left, which walks the room's contents
   * rightward across the frame — the lever for a slide whose copy plate is
   * sitting on the half of the room worth looking at. Zero is the framing the
   * app composed, and is the default because it is a composed framing.
   */
  rake?: number
  /**
   * The room's mood, in the app's own vocabulary.
   *
   * `focus` is the lighting state the product's focus mode puts the office in —
   * the desk lamp comes up by about eighty percent and everything else stays
   * where it is. `storm` pushes the window's spill. Both are read by the scene
   * off its host element every frame, so a slide can change its mind mid-talk.
   */
  mood?: 'focus' | 'storm'
}

/**
 * The element the ported scene looks for.
 *
 * `office-three.tsx` resolves its host with `canvas.closest('.av-office')` and
 * treats that element as the surface it talks to: it listens there for
 * `office-focus-asset` and `office-camera-rotate`, and reads `room-focus`,
 * `room-storm`, `is-cozy`, `cat-awake` and `show-office-details` off its class
 * list every frame.
 *
 * The deck's host was `deck-office-host` alone, so `closest` returned null and
 * every one of those features was dead here — the deck was mounting the app's
 * office and then declining to use the only interface it exposes. Adding the
 * class back is the whole fix, and it is a deck-side change: `av-office` carries
 * no styling in the deck, because `app-art/art.css` is not imported (the two
 * rules the canvas needs live in `office-scene-host.css`), so this is a contract
 * name and nothing else.
 */
const APP_SURFACE_CLASS = 'av-office'

/**
 * How long the room holds a selected person, from `onFocusAsset`.
 *
 * A slide can be on screen for minutes, so the selection is re-asserted inside
 * that window rather than left to lapse. Re-selecting the same key is idempotent
 * apart from the camera aim, which is already where it is being aimed.
 */
const ATTENTION_MS = 20_000

export function DeckOfficeScene({ tier, full, floor = 'practice', client = true, attend, rake = 0, mood }: DeckOfficeSceneProps) {
  const ownedAssets = useMemo(() => (full ? fullEmpireAssets() : shackAssets()), [full])
  // Memoised because `OfficeThreeScene` signs the case into its rebuild key, so a
  // fresh object identity per render would be a fresh signature and a full room
  // teardown on every parent render.
  const activeCase = useMemo(() => (client ? syntheticConsultation() : null), [client])
  // The scene tears down and rebuilds the whole room when this changes, which
  // is exactly what a slide change wants. A full tier-14 floor is a few hundred
  // primitives and costs on the order of a second to build, so treat every
  // change of these three as paying for a rebuild.
  const layoutKey = `${tier}:${full ? 'full' : 'shack'}:${floor}`
  const host = useRef<HTMLDivElement | null>(null)

  // Put the room's attention on the client, through the app's own selection.
  //
  // What this buys, all of it already written in `office-three.tsx` and none of
  // it reachable before: a focus light rises on her, her chair takes a halo, and
  // `setLookTarget(camera)` makes her lift her head and hold the room's eye for
  // as long as she stays selected. That is the difference between a character
  // standing in a scene and a character doing something, and it costs the deck
  // one event.
  //
  // ## Why the camera is then put straight back
  //
  // Selecting anything also aims the camera at it, and for this one target that
  // aim is unusable. It is computed to the focus object's *origin*, which for a
  // rig is the floor under it, and from a pivot that stands at the partner desk
  // the client is 80 degrees off the axis and two and a half metres below: the
  // yaw swings almost a quarter turn onto the side wall and the pitch pins to
  // its own downward limit. Photographed, that is a room seen from the ceiling.
  //
  // `office-camera-rotate` with `reset` restores the framing the scene composed
  // for its own headcount — the pullback, pitch, pivot drop and field of view
  // that the framing block earns per head — and it touches nothing else, so the
  // halo, the light and the held gaze all survive it. `rake` is then the one
  // deliberate departure from that framing, and it is a slide's decision.
  //
  // Ordering is not luck: the scene builds and attaches its listener inside its
  // own effect, which React runs before this one because it is the child. The
  // build is synchronous from `createRenderer` to `addEventListener`, so by the
  // time this fires there is something on the far side of the dispatch. All
  // three events land in the same task, so the eased camera only ever sees the
  // final target and never travels toward the intermediate one.
  const selecting = attend ?? client
  useEffect(() => {
    const surface = host.current
    if (!surface) return
    const send = (type: string, detail: unknown) => {
      surface.dispatchEvent(new CustomEvent(type, { detail }))
    }
    const compose = () => {
      if (client && selecting) send('office-focus-asset', { key: DECK_CONSULTATION_CLIENT_KEY })
      send('office-camera-rotate', { reset: true })
      if (rake) send('office-camera-rotate', { delta: rake })
    }
    compose()
    // Re-asserted inside the twenty seconds the room holds a selection for,
    // because a slide is spoken over for minutes. Idempotent: every value it
    // sets is absolute apart from the rake, and the reset that precedes the rake
    // is what makes even that absolute.
    const timer = window.setInterval(compose, ATTENTION_MS * .7)
    return () => window.clearInterval(timer)
    // `layoutKey` is in here because a change to it tears the room down and
    // builds a new one, whose focus register is empty until something selects
    // into it again.
  }, [client, selecting, rake, layoutKey])

  return (
    <div
      className={[
        'deck-office-host',
        APP_SURFACE_CLASS,
        mood === 'focus' ? 'room-focus' : '',
        mood === 'storm' ? 'room-storm' : '',
      ].filter(Boolean).join(' ')}
      ref={host}
    >
      <OfficeThreeScene
        tier={tier}
        ownedAssets={ownedAssets}
        layoutKey={layoutKey}
        activeCase={activeCase}
        floor={floor}
      />
    </div>
  )
}
