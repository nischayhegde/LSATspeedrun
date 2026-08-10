import { useMemo } from 'react'

import { OfficeThreeScene } from '../app-art/office-three'
import '../app-art/office-scene-host.css'
import { fullEmpireAssets, shackAssets } from './synthetic-state'

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
}

export function DeckOfficeScene({ tier, full, floor = 'practice' }: DeckOfficeSceneProps) {
  const ownedAssets = useMemo(() => (full ? fullEmpireAssets() : shackAssets()), [full])
  // The scene tears down and rebuilds the whole room when this changes, which
  // is exactly what a slide change wants. A full tier-14 floor is a few hundred
  // primitives and costs on the order of a second to build, so treat every
  // change of these three as paying for a rebuild.
  const layoutKey = `${tier}:${full ? 'full' : 'shack'}:${floor}`
  return (
    <div className="deck-office-host">
      <OfficeThreeScene
        tier={tier}
        ownedAssets={ownedAssets}
        layoutKey={layoutKey}
        activeCase={null}
        floor={floor}
      />
    </div>
  )
}
