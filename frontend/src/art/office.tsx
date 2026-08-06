import { lazy, Suspense, useMemo } from 'react'
import type { ActiveOfficeCase, GameAsset } from '../types'
import { loadOfficeScene } from './scene-loaders'

const OfficeThreeScene = lazy(() => loadOfficeScene().then((module) => ({ default: module.OfficeThreeScene })))
const EMPTY_ASSETS: GameAsset[] = []

function roomTheme(tier: number) {
  if (tier >= 10) return 'summit'
  if (tier >= 5) return 'grand'
  if (tier >= 2) return 'firm'
  return 'humble'
}

export function OfficeRoom({
  tier,
  assets = EMPTY_ASSETS,
  layoutKey,
  activeCase,
}: {
  tier: number
  assets?: GameAsset[]
  layoutKey?: string
  activeCase?: ActiveOfficeCase | null
}) {
  const ownedAssets = useMemo(() => assets.filter((asset) => asset.owned), [assets])
  return (
    <div
      className={`av-room av-room-three theme-${roomTheme(tier)} tier-${tier}`}
      style={{ ['--amb' as string]: Math.min(1, ownedAssets.length / 24) }}
    >
      <Suspense fallback={null}>
        <OfficeThreeScene tier={tier} ownedAssets={ownedAssets} layoutKey={layoutKey} activeCase={activeCase} />
      </Suspense>
      {/* This remains behind the transparent canvas until its first real frame;
          Suspense alone disappears as soon as the JS module downloads, which
          previously exposed a blank gap during procedural scene construction. */}
      <div className="office-three-loading" aria-hidden="true"><i /><span>Preparing office</span></div>
      <div className="av-room-glass-grade" aria-hidden="true" />
    </div>
  )
}
