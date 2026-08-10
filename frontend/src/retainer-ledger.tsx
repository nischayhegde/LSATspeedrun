import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Stamp } from 'lucide-react'

import { api } from './api'
import { formatMoney } from './format'
import { useRollup, useRollupInt } from './motion'
import { useSound } from './sound'
import type { GameState, TerritoryDistrict } from './types'
import { storeGame } from './pages/shared'

/* Standing retainers, in the tab that houses firm interactions.
 *
 * The map already carries a retainer board and this is deliberately not a copy
 * of it. A retainer has two halves and each surface owns one:
 *
 *   the map     — where a district *is*. It is scoped to the region you are
 *                 standing in, joins the district to a landmark the planner
 *                 laid out, and flies the camera there when you sign.
 *   this ledger — what the firm *holds*. Every region at once, the two figures
 *                 the holding pays (a reputation floor, and relief against the
 *                 daily lease), what the next district costs, and the signature.
 *
 * So the map answers "where", the ledger answers "how much", and each hands off
 * to the other rather than restating it: rows here carry the same "show it on
 * the map" affordance the connection and rival cards already use.
 */

/** How long a signature's confirmation stays on screen.
 *
 *  Held in React rather than in the tail of a CSS animation on purpose. The
 *  global reduced-motion rule collapses every `animation-duration` to .01ms
 *  with `!important`, so any gesture that fades *out* at its last keyframe --
 *  which is how the rest of this page's flashes are written -- lands on
 *  "invisible" the instant it starts and a reduced-motion reader sees no
 *  feedback at all. Every animation below therefore ends on the state worth
 *  seeing, and this timer is what takes it away again. */
const SIGNED_HOLD_MS = 2200

function reliefPercent(bps: number) {
  return (bps / 100).toFixed(bps >= 1000 ? 0 : 1)
}

function DistrictPlot({ district, signing, justSigned, onSign, onShowOnMap }: {
  district: TerritoryDistrict
  signing: boolean
  justSigned: boolean
  onSign: (district: TerritoryDistrict) => void
  onShowOnMap: (district: TerritoryDistrict) => void
}) {
  const state = district.owned ? 'held' : district.available ? 'open' : 'locked'
  return (
    <article className={`retainer-plot is-${state}${justSigned ? ' just-signed' : ''}`}>
      <div className="retainer-plot-head">
        <strong>{district.name}</strong>
        {district.landmark_key && (
          <button
            type="button"
            className="retainer-plot-map"
            aria-label={`Show ${district.name} on the map`}
            onClick={() => onShowOnMap(district)}
          >
            <MapPin size={12} />
          </button>
        )}
      </div>
      <em>Retains {district.retainer}</em>
      {district.owned ? (
        <p className="retainer-plot-yield">
          <span>+{district.standing.toFixed(2)} standing</span>
          <span>{reliefPercent(district.rent_relief_bps)}% of the lease</span>
        </p>
      ) : district.locks.length ? (
        <p className="retainer-plot-lock">{district.locks.join(' · ')}</p>
      ) : (
        <div className="retainer-plot-buy">
          <b>{formatMoney(district.cost, true)}</b>
          <button type="button" disabled={!district.affordable || signing} onClick={() => onSign(district)}>
            {signing ? 'Signing…' : district.affordable ? 'Sign' : 'Keep earning'}
          </button>
        </div>
      )}
      {justSigned && <span className="retainer-plot-seal" aria-hidden="true"><Stamp size={15} /> RETAINED</span>}
    </article>
  )
}

export function RetainerLedger({ game, onShowOnMap }: {
  game: GameState
  onShowOnMap: (district: TerritoryDistrict) => void
}) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const territory = game.territory
  const [justSigned, setJustSigned] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  /* Land where there is something to do, and then stay put. A ledger that
     always opens on the first region shows a new player five held districts
     and an old one a wall of locks; opening on the region that has an
     affordable signature puts the move on screen. Chosen once, at mount:
     signing changes what is affordable, and re-deriving it would move the
     reader to another region between one click and the next. */
  const [regionKey, setRegionKey] = useState(() => {
    const canSign = territory.districts.find((district) => district.available && district.affordable)
    if (canSign) return canSign.region
    const partial = territory.regions.find((entry) => entry.held > 0 && entry.held < entry.total)
    return partial?.key ?? territory.regions.find((entry) => entry.held > 0)?.key ?? territory.regions[0]?.key ?? ''
  })

  const secure = useMutation({
    mutationFn: (districtKey: string) => api.secureDistrict(districtKey),
    onSuccess: ({ game: next, retainer }) => {
      storeGame(queryClient, next)
      void queryClient.invalidateQueries({ queryKey: ['game'] })
      void play(retainer.region_swept ? 'bonus' : 'purchase', { seed: retainer.district, intensity: .6 })
      setPendingKey(null)
      setJustSigned(retainer.district)
      window.setTimeout(() => setJustSigned((current) => (current === retainer.district ? null : current)), SIGNED_HOLD_MS)
    },
    onError: () => setPendingKey(null),
  })

  const region = territory.regions.find((entry) => entry.key === regionKey) ?? territory.regions[0]
  const districts = territory.districts.filter((district) => district.region === region?.key)
  const heldShown = useRollupInt(territory.held) ?? territory.held
  const standingShown = useRollup(territory.standing) ?? territory.standing
  const rentShown = useRollupInt(territory.relieved_daily_rent) ?? territory.relieved_daily_rent
  const relieved = territory.daily_rent - territory.relieved_daily_rent

  if (!region) return null

  const chooseRegion = (key: string) => {
    if (key === regionKey) return
    void play('select', { seed: `retainer:${key}`, intensity: .25 })
    setRegionKey(key)
  }
  const sign = (district: TerritoryDistrict) => {
    setPendingKey(district.key)
    secure.mutate(district.key)
  }

  return (
    <section className="retainer-ledger" aria-label="Standing retainers">
      <div className="retainer-totals">
        <div>
          <small>DISTRICTS HELD</small>
          <strong>{heldShown}<i> / {territory.total}</i></strong>
        </div>
        <div>
          <small>STANDING</small>
          <strong>{standingShown.toFixed(2)}<i> / {territory.standing_cap.toFixed(0)}</i></strong>
          <span className="retainer-meter" aria-hidden="true">
            <i style={{ width: `${Math.min(100, territory.standing / Math.max(1, territory.standing_cap) * 100)}%` }} />
          </span>
          <em>Reputation floor, to {territory.standing_floor_ceiling}</em>
        </div>
        <div>
          <small>DAILY LEASE</small>
          <strong>{formatMoney(rentShown)}</strong>
          <span className="retainer-meter is-lease" aria-hidden="true">
            <i style={{ width: `${Math.min(100, territory.rent_relief_bps / 100)}%` }} />
          </span>
          <em>{relieved > 0 ? `${formatMoney(relieved)} covered · was ${formatMoney(territory.daily_rent)}` : `No relief yet · ${formatMoney(territory.daily_rent)} in full`}</em>
        </div>
      </div>

      <nav className="retainer-regions" aria-label="Retainer regions">
        {territory.regions.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={entry.key === region.key ? 'active' : ''}
            aria-pressed={entry.key === region.key}
            onClick={() => chooseRegion(entry.key)}
          >
            <span>{entry.name}</span>
            <b>{entry.held}/{entry.total}</b>
            <i aria-hidden="true" style={{ width: `${entry.held / Math.max(1, entry.total) * 100}%` }} />
          </button>
        ))}
      </nav>

      <div className="retainer-plots">
        {districts.map((district) => (
          <DistrictPlot
            key={district.key}
            district={district}
            signing={pendingKey === district.key && secure.isPending}
            justSigned={justSigned === district.key}
            onSign={sign}
            onShowOnMap={onShowOnMap}
          />
        ))}
      </div>
      {region.swept && <p className="retainer-sweep">{region.name} is swept · +{region.sweep_standing.toFixed(1)} standing</p>}
      {secure.error && <p className="retainer-error" role="alert">That retainer could not be signed. Try again.</p>}
    </section>
  )
}
