import { useMemo } from 'react'

import { MapThreeScene } from '../app-art/map-three-scene'
import '../app-art/map-scene-host.css'
import { syntheticMapPoints } from './synthetic-state'

/**
 * The app's 3D world map, on a slide.
 *
 * ONE AT A TIME. Like `DeckOfficeScene`, `MapThreeScene` owns a `WebGLRenderer`
 * and a WebGL context for as long as it is mounted, and disposes it (with
 * `forceContextLoss`) on unmount. The deck must never have two 3D scenes
 * resident at once: unmount the outgoing one before mounting the next.
 */

export type DeckMapSceneProps = {
  region: 'city' | 'nation' | 'ocean' | 'continent' | 'orbit'
  /** Bump to issue a camera command (in / out / home cycling is up to you). */
  cameraTick?: number
}

/** What each bump of `cameraTick` asks the camera for, in order. */
const CAMERA_CYCLE = ['home', 'in', 'in', 'out'] as const

export function DeckMapScene({ region, cameraTick = 0 }: DeckMapSceneProps) {
  // The scene rebuilds its whole district when `points` changes identity, so
  // the array is memoised on the region and nothing else.
  const points = useMemo(() => syntheticMapPoints(region), [region])
  // `id` is what the scene watches; the action is read when the id moves.
  const cameraCommand = useMemo(
    () => ({ id: cameraTick, action: CAMERA_CYCLE[cameraTick % CAMERA_CYCLE.length] }),
    [cameraTick],
  )
  return (
    <div className="deck-map-host">
      <MapThreeScene
        region={region}
        points={points}
        selectedKey=""
        onSelect={noop}
        activity={1}
        cameraCommand={cameraCommand}
        viewMode="career"
        playerGender="female"
        playerTier={14}
        playerName="Counsel"
      />
    </div>
  )
}

/** Nothing on the deck is clickable; the scene still requires the handler. */
function noop() {}
