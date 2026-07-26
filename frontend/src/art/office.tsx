import { lazy, Suspense, useMemo } from 'react'
import type { ActiveOfficeCase, GameAsset } from '../types'
import { loadOfficeScene } from './scene-loaders'

const OfficeThreeScene = lazy(() => loadOfficeScene().then((module) => ({ default: module.OfficeThreeScene })))

function roomTheme(tier: number) {
  if (tier >= 10) return 'summit'
  if (tier >= 5) return 'grand'
  if (tier >= 2) return 'firm'
  return 'humble'
}

export function OfficeRoom({
  tier,
  assets = [],
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
      <Suspense fallback={<div className="office-three-loading" aria-hidden="true" />}>
        <OfficeThreeScene tier={tier} ownedAssets={ownedAssets} layoutKey={layoutKey} activeCase={activeCase} />
      </Suspense>
      <div className="av-room-glass-grade" aria-hidden="true" />
    </div>
  )
}
