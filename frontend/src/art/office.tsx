import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ActiveOfficeCase, GameAsset } from '../types'
import { OfficeFloorDirectory, useFloorRoster } from './office-floors'
import type { OfficeFloorKey } from './office-manifest'
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
  const roster = useFloorRoster(ownedAssets)
  const [floor, setFloor] = useState<OfficeFloorKey>('practice')
  // Selling the last person upstairs, or loading a save that never hired one,
  // must not leave the player looking at an empty chamber with no way back.
  useEffect(() => {
    if (floor !== 'practice' && !(roster.get(floor)?.length ?? 0)) setFloor('practice')
  }, [floor, roster])
  return (
    <div
      className={`av-room av-room-three theme-${roomTheme(tier)} tier-${tier} floor-${floor}`}
      style={{ ['--amb' as string]: Math.min(1, ownedAssets.length / 24) }}
    >
      <Suspense fallback={<div className="office-three-loading" aria-hidden="true" />}>
        <OfficeThreeScene tier={tier} ownedAssets={ownedAssets} layoutKey={layoutKey} activeCase={activeCase} floor={floor} />
      </Suspense>
      <div className="av-room-glass-grade" aria-hidden="true" />
      <OfficeFloorDirectory current={floor} onSelect={setFloor} roster={roster} />
    </div>
  )
}
