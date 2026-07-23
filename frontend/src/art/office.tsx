/* The office set: a painted interior per firm tier plus animated atmosphere
   layers (ken-burns drift, god rays, dust motes, warm glow). Owning more
   upgrades warms the room via the --amb custom property. */

import { officeArt } from './assets'

const MOTES = Array.from({ length: 14 }, (_, i) => i)

function roomTheme(tier: number) {
  if (tier >= 12) return 'cosmic'
  if (tier >= 10) return 'frontier'
  if (tier >= 5) return 'grand'
  if (tier >= 2) return 'firm'
  return 'humble'
}

export function OfficeRoom({ tier, owned }: { tier: number; owned?: Set<string> }) {
  const ambience = Math.min(1, (owned?.size ?? 0) / 24)
  return (
    <div
      className={`av-room theme-${roomTheme(tier)}`}
      style={{ ['--amb' as string]: ambience }}
      aria-hidden="true"
    >
      <div className="av-layer av-layer-far">
        <img className="av-room-img" src={officeArt(tier)} alt="" draggable={false} />
      </div>
      <div className="av-layer av-layer-mid">
        <div className="av-room-rays"><i /><i /><i /></div>
        <div className="av-room-motes">
          {MOTES.map((i) => <i key={i} className={`mote m-${i % 7}`} />)}
        </div>
        {tier >= 12 && (
          <div className="av-room-stars">
            {Array.from({ length: 26 }, (_, i) => <i key={i} className={`tw tw-${i % 3}`} />)}
          </div>
        )}
      </div>
      <div className="av-room-glow" />
    </div>
  )
}
