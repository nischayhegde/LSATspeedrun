import { lazy, Suspense } from 'react'

const OfficeThreeScene = lazy(() => import('./office-three').then((module) => ({ default: module.OfficeThreeScene })))

function roomTheme(tier: number) {
  if (tier >= 10) return 'summit'
  if (tier >= 5) return 'grand'
  if (tier >= 2) return 'firm'
  return 'humble'
}

export function OfficeRoom({ tier, owned, staffCount = 0 }: { tier: number; owned?: Set<string>; staffCount?: number }) {
  const upgrades = owned?.size ?? 0
  return (
    <div
      className={`av-room av-room-three theme-${roomTheme(tier)} tier-${tier}`}
      style={{ ['--amb' as string]: Math.min(1, upgrades / 24) }}
    >
      <Suspense fallback={<div className="office-three-loading" aria-hidden="true" />}>
        <OfficeThreeScene tier={tier} upgrades={upgrades} staffCount={staffCount} />
      </Suspense>
      <div className="av-room-glass-grade" aria-hidden="true" />
    </div>
  )
}
