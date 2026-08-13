import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, MapPin, Stamp } from 'lucide-react'

import { api } from './api'
import { formatMoney } from './format'
import { useRollup, useRollupInt } from './motion'
import { useSound } from './sound'
import type { GameAsset, GameState, TerritoryDistrict } from './types'
import { storeGame } from './pages/shared'

/* Standing counsel, in the tab that houses firm interactions.
 *
 * ## Why this is not called a retainer any more
 *
 * It used to be, and so does the Clients tab three tabs away, and the two mean
 * opposite things. A *client retainer* is a paying relationship: it sets the
 * fee every case earns. A district seat pays no fee at all — it buys a
 * reputation floor and relief against the lease. Two surfaces in one tab used
 * one word for both, which is the likeliest source of the "am I taking up
 * cases or receiving cases?" confusion, and it got worse when this board moved
 * off the map and into the Firm tab beside the client list.
 *
 * So the word "retainer" now means one thing — a client paying your rate — and
 * a district appointment is *standing counsel*, which is both the correct term
 * of art and the word the district catalog was already written in: districts
 * describe themselves as having "never had counsel of their own" and having
 * "needed proper counsel for thirty years". The vocabulary was there before the
 * mechanic was named over the top of it.
 *
 * ## Why this board is not the map's board
 *
 * The map already carries one and this is deliberately not a copy. A seat has
 * two halves and each surface owns one:
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

function DistrictPlot({ district, signing, justSigned, asked, gate, onSign, onShowOnMap, onShowGate }: {
  district: TerritoryDistrict
  signing: boolean
  justSigned: boolean
  /** The map is looking at this one. Marked in the same selection gold the
      scene washes the chosen district with, so the two surfaces name the same
      row in the same colour. */
  asked: boolean
  /** The network this district is waiting on and the lock line that says so,
      when that is what is holding it up and the player does not own it yet. */
  gate: { asset: GameAsset; lock: string } | null
  onSign: (district: TerritoryDistrict) => void
  onShowOnMap: (district: TerritoryDistrict) => void
  onShowGate: (asset: GameAsset) => void
}) {
  const state = district.owned ? 'held' : district.available ? 'open' : 'locked'
  const card = useRef<HTMLElement | null>(null)
  useEffect(() => {
    // Eleven plots in a region, and on a phone they are a horizontal scroller,
    // so the asked-for one is routinely off screen when the map hands it over.
    if (asked) card.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [asked])
  return (
    <article ref={card} className={`retainer-plot is-${state}${justSigned ? ' just-signed' : ''}${asked ? ' is-asked-for' : ''}`}>
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
      <em>Counsel to {district.counsel}</em>
      {district.owned ? (
        <p className="retainer-plot-yield">
          <span>+{district.standing.toFixed(2)} standing</span>
          <span>{reliefPercent(district.rent_relief_bps)}% of the lease</span>
        </p>
      ) : district.locks.length ? (
        /* A lock that names a network is the one lock earning more money will
           never clear, and the card that clears it is on this same screen,
           some way down the catalog under two filters that may be hiding it.
           So it is a control rather than a sentence: the same "find that card"
           trip the staff roster makes, from the row that needs it. The other
           two locks — a tier, a reputation figure — stay plain text, because
           there is nothing on this page to send anyone to. */
        <p className="retainer-plot-lock">
          {district.locks.filter((lock) => lock !== gate?.lock).join(' · ')}
          {gate && (
            <button type="button" className="retainer-plot-gate" onClick={() => onShowGate(gate.asset)}>
              Requires the {gate.asset.name} <ChevronRight size={11} />
            </button>
          )}
        </p>
      ) : (
        <div className="retainer-plot-buy">
          <b>{formatMoney(district.cost, true)}</b>
          <button type="button" disabled={!district.affordable || signing} onClick={() => onSign(district)}>
            {signing ? 'Signing…' : district.affordable ? 'Sign' : 'Keep earning'}
          </button>
        </div>
      )}
      {justSigned && <span className="retainer-plot-seal" aria-hidden="true"><Stamp size={15} /> APPOINTED</span>}
    </article>
  )
}

/* Which network a district is waiting on.
 *
 * The server states the gate as prose — "Requires the local bar association" —
 * and publishes no key for it, so the name is matched back against the catalog
 * rather than looked up. Deliberately strict: only an unowned connection whose
 * whole lowercased name is one of the lock lines counts, and anything that does
 * not match leaves the lock exactly as the server wrote it. A wrong link here
 * would be worse than no link, and the failure mode of a miss is the sentence
 * that was already there. */
function gateNetwork(game: GameState, district: TerritoryDistrict) {
  if (!district.locks.length) return null
  for (const lock of district.locks) {
    const named = lock.replace(/^Requires the /, '').toLowerCase()
    if (named === lock.toLowerCase()) continue
    const asset = game.catalog.assets.find(
      (entry) => entry.type === 'connection' && !entry.owned && entry.name.toLowerCase() === named,
    )
    if (asset) return { asset, lock }
  }
  return null
}

export function RetainerLedger({ game, highlightKey, onShowOnMap, onShowGate }: {
  game: GameState
  /** A district the map named on the way here, by selecting it on the ground.
      The other half of `onShowOnMap`: that sends a row to the map, this is the
      map sending a place back, and both land on the same marked row. */
  highlightKey?: string | null
  onShowOnMap: (district: TerritoryDistrict) => void
  /** Send the reader to the catalog card for the network a district is waiting
      on. The Firm page owns that trip because it owns the filters that may be
      hiding the card. */
  onShowGate: (asset: GameAsset) => void
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
    const asked = highlightKey && territory.districts.find((district) => district.key === highlightKey)
    if (asked) return asked.region
    const canSign = territory.districts.find((district) => district.available && district.affordable)
    if (canSign) return canSign.region
    const partial = territory.regions.find((entry) => entry.held > 0 && entry.held < entry.total)
    return partial?.key ?? territory.regions.find((entry) => entry.held > 0)?.key ?? territory.regions[0]?.key ?? ''
  })

  /* The reader chooses the region above, except when the map asks for one.
     Distinct from re-deriving the opening region, which the comment above
     rules out: this only moves on an explicit hand-off, and only when the
     district asked for is somewhere else. */
  const askedRegion = highlightKey
    ? territory.districts.find((district) => district.key === highlightKey)?.region
    : undefined
  useEffect(() => {
    if (askedRegion) setRegionKey(askedRegion)
  }, [askedRegion, highlightKey])

  const secure = useMutation({
    mutationFn: (districtKey: string) => api.secureDistrict(districtKey),
    onSuccess: ({ game: next, counsel }) => {
      storeGame(queryClient, next)
      void queryClient.invalidateQueries({ queryKey: ['game'] })
      void play(counsel.region_swept ? 'bonus' : 'purchase', { seed: counsel.district, intensity: .6 })
      setPendingKey(null)
      setJustSigned(counsel.district)
      window.setTimeout(() => setJustSigned((current) => (current === counsel.district ? null : current)), SIGNED_HOLD_MS)
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
    <section className="retainer-ledger" aria-label="Standing counsel">
      {/* The map's copy of this board opens by saying what it is. This one did
          not, and this is where most players meet it first -- it is one tab
          along from the client list, so a reader arrives already holding the
          other meaning of the word. Hence the second sentence, which exists to
          be the difference rather than to describe the mechanic twice. */}
      <header className="retainer-ledger-head">
        <span className="eyebrow">STANDING COUNSEL · {territory.total} DISTRICTS</span>
        <h2>Where the firm is the first call.</h2>
        <p>
          Sign a district&apos;s institutions and your firm becomes their standing counsel.
          {' '}<b>This is not a client retainer and pays no fee per case.</b>
          {' '}It buys <b>standing</b>, which holds your reputation up from below, and a branch
          you are already paid to keep, which comes off the <b>daily lease</b>.
        </p>
      </header>
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

      {/* Each region names the tiers it covers. Directly beneath this rail sits
          the catalog's own region filter, listing Market Ward, Civic Center,
          Harbor Exchange and eleven more -- a completely different set of place
          names, which reads as a bug when the two are adjacent. They are in fact
          nested: a catalog region is the street address the firm held at one
          tier, and every one of them falls inside one of these five. Printing
          the tier span here, and grouping the filter below by region, is what
          turns the adjacency from a contradiction into a hierarchy. */}
      <nav className="retainer-regions" aria-label="Map regions">
        {territory.regions.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={entry.key === region.key ? 'active' : ''}
            aria-pressed={entry.key === region.key}
            onClick={() => chooseRegion(entry.key)}
          >
            <span>{entry.name}<em>TIERS {entry.tier_range[0]}–{entry.tier_range[1]}</em></span>
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
            asked={district.key === highlightKey}
            gate={gateNetwork(game, district)}
            onSign={sign}
            onShowOnMap={onShowOnMap}
            onShowGate={onShowGate}
          />
        ))}
      </div>
      {region.swept && <p className="retainer-sweep">{region.name} is swept · +{region.sweep_standing.toFixed(1)} standing</p>}
      {secure.error && <p className="retainer-error" role="alert">That appointment could not be signed. Try again.</p>}
    </section>
  )
}
