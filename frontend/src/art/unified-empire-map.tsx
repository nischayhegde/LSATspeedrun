import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { ChevronMark, CloseMark, HomeMark, MenuMark, MinusMark, PlusMark, TargetMark } from '../art-2d/marks'
import { formatMoney } from '../components'
import type { GameState, TerritoryDistrict } from '../types'
import { useAmbientMusic, useSound } from '../sound'
import type {
  MapCameraAction,
  MapLandmark,
  MapLandmarkKind,
  MapRegionKey,
  MapSceneContact,
  MapSceneEvent,
  MapScenePoint,
  MapSceneRival,
  MapSceneTier,
  MapViewMode,
} from './map-three-scene'
import { applyPlayerCosmetics } from './player-cosmetics'
import { loadMapScene } from './scene-loaders'
import { STANDING_COPY, rivalFirmName, rivalStanding } from '../rival-war-room'
import './unified-empire-map.css'

const MapThreeScene = lazy(() => loadMapScene().then((module) => ({ default: module.MapThreeScene })))

const regions: Array<{
  key: MapRegionKey
  number: string
  name: string
  short: string
  range: [number, number]
  character: string
}> = [
  { key: 'city', number: '01', name: 'Old Quarter', short: 'Street practice', range: [0, 4], character: 'Brick courts, chambers, and the municipal rail.' },
  { key: 'nation', number: '02', name: 'The Circuit', short: 'National network', range: [5, 6], character: 'Regional courts connected by the appellate line.' },
  { key: 'ocean', number: '03', name: 'Treaty Sea', short: 'Global counsel', range: [7, 9], character: 'Embassies, working quays, and a diplomatic harbor.' },
  { key: 'continent', number: '04', name: 'Sovereign Arc', short: 'Continental firm', range: [10, 11], character: 'Civic campuses set into a formal continental axis.' },
  { key: 'orbit', number: '05', name: 'Global Compact', short: 'Worldwide counsel', range: [12, 14], character: 'An international chamber surrounded by the final offices.' },
]

/* Rival sites used to be assigned by their index in the catalog, which put a
   tier-5 firm in the Old Quarter and a tier-3 chamber out at sea. A rival now
   sits in whichever region its own tier belongs to, the same rule the career
   route uses, so "this firm is in my way" and "this firm is where I am" agree. */

const worldEvents = [
  { key: 'docket', name: 'Morning docket', detail: 'A municipal hearing is assembling outside the courthouse.', minTier: 0 },
  { key: 'tip', name: 'Client lead', detail: 'A referral is waiting at the Old Quarter bulletin.', minTier: 1 },
  { key: 'circuit', name: 'Circuit calendar', detail: 'The appellate train has posted a new calendar.', minTier: 5 },
  { key: 'embassy', name: 'Embassy brief', detail: 'Treaty counsel have arrived at the diplomatic quay.', minTier: 7 },
  { key: 'trade', name: 'Trade dispute', detail: 'A commercial matter has reached the harbor docket.', minTier: 8 },
  { key: 'summit', name: 'Sovereign summit', detail: 'Delegations have opened a continental hearing.', minTier: 10 },
  { key: 'signal', name: 'Council bulletin', detail: 'A priority international filing has reached the firm.', minTier: 12 },
  { key: 'vote', name: 'High-court calendar', detail: 'The international assembly is entering session.', minTier: 14 },
]

const landmarkTag: Record<MapLandmarkKind, string> = {
  civic: 'CIV',
  transit: 'TRN',
  market: 'MKT',
  green: 'GRN',
  water: 'WTR',
  industry: 'IND',
  housing: 'HSG',
  monument: 'MON',
}

/* Standing retainers, surfaced in the region they belong to.
 *
 * This is coverage, not conquest: signing a district's institutions to a
 * standing retainer makes your firm the default counsel there. It buys no
 * payout multiplier and absorbs no competitor, which is what keeps it from
 * treading on the rival acquisitions the same map already carries — those are
 * discrete moves against named firms, priced at a full five cases each.
 *
 * Collapsed by default, and it stays a strip on the left rail beside the
 * district guide rather than becoming a board the map has to wear. */
function RetainerBoard({ game, regionKey, regionName, onTravel, defaultOpen = false }: {
  game: GameState
  regionKey: MapRegionKey
  regionName: string
  onTravel: (landmarkKey: string) => void
  /** Open on arrival when the Firm tab sent the player here to see what a
      connection unlocked. Anything the player was not asked for stays shut. */
  defaultOpen?: boolean
}) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const [open, setOpen] = useState(defaultOpen)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const secure = useMutation({
    mutationFn: (districtKey: string) => api.secureDistrict(districtKey),
    onSuccess: ({ game: next, retainer }) => {
      queryClient.setQueryData(['game'], { game: next })
      void queryClient.invalidateQueries({ queryKey: ['game'] })
      void play(retainer.region_swept ? 'bonus' : 'purchase', { seed: retainer.district, intensity: .55 })
      setPendingKey(null)
    },
    onError: () => setPendingKey(null),
  })

  const districts = game.territory.districts.filter((district) => district.region === regionKey)
  const region = game.territory.regions.find((entry) => entry.key === regionKey)
  if (!districts.length || !region) return null
  const openable = districts.some((district) => district.available && district.affordable)

  const sign = (district: TerritoryDistrict) => {
    setPendingKey(district.key)
    secure.mutate(district.key)
    if (district.landmark_key) onTravel(district.landmark_key)
  }

  return (
    <aside className={`uw-retainer-board ${open ? 'is-open' : ''} ${openable ? 'has-offer' : ''}`} aria-label={`${regionName} standing retainers`}>
      <button type="button" className="uw-retainer-toggle" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <small>STANDING RETAINERS</small>
        <strong>{region.held} of {region.total} districts</strong>
        <i aria-hidden="true">{open ? <MinusMark /> : <PlusMark />}</i>
      </button>
      {open && (
        <>
          <p className="uw-retainer-intro">
            Sign a district&apos;s institutions and every routine matter there arrives at your door.
            Standing holds your reputation up; a branch you are already paid to keep offsets the lease.
          </p>
          <div className="uw-retainer-list">
            {districts.map((district) => (
              <article className={`uw-retainer-row${district.owned ? ' is-held' : district.available ? ' is-open' : ' is-locked'}`} key={district.key}>
                {/* Not a <header>: inside the mobile Explore sheet a bare
                    header element inherits that sheet's own title styling. */}
                <div className="uw-retainer-head">
                  <strong>{district.name}</strong>
                  <b>{district.owned ? 'HELD' : formatMoney(district.cost, true)}</b>
                </div>
                <em>Retains {district.retainer}</em>
                {district.owned
                  ? <small>+{district.standing.toFixed(2)} standing · {(district.rent_relief_bps / 100).toFixed(1)}% of the lease</small>
                  : district.locks.length
                    ? <small className="uw-retainer-lock">{district.locks.join(' · ')}</small>
                    : (
                      <button
                        type="button"
                        disabled={!district.affordable || secure.isPending}
                        onClick={() => sign(district)}
                      >
                        {pendingKey === district.key && secure.isPending
                          ? 'Signing…'
                          : district.affordable ? 'Sign the retainer' : 'Not enough cash'}
                      </button>
                    )}
              </article>
            ))}
          </div>
          <p className="uw-retainer-foot">
            {region.swept
              ? `Every district in ${regionName} is retained. +${region.sweep_standing.toFixed(1)} standing for the sweep.`
              : `Hold all ${region.total} for a further +${region.sweep_standing.toFixed(1)} standing.`}
            {' '}Firm-wide: {game.territory.standing.toFixed(1)} of {game.territory.standing_cap.toFixed(1)} standing,
            {' '}{(game.territory.rent_relief_bps / 100).toFixed(0)}% of the lease covered.
          </p>
          {secure.error && <p className="uw-retainer-error">That retainer could not be signed. Try again.</p>}
        </>
      )}
    </aside>
  )
}

function regionForTier(tier: number) {
  return regions.find((region) => tier >= region.range[0] && tier <= region.range[1]) ?? regions[0]
}

function tierState(tier: number, officeTier: number): MapSceneTier['state'] {
  if (tier < officeTier) return 'complete'
  if (tier === officeTier) return 'current'
  if (tier === officeTier + 1) return 'next'
  return 'locked'
}

/**
 * What a place on the map is worth to the firm.
 *
 * The retainer board beneath this is the ledger: every district in the region,
 * sortable, signable, with the money in it. This is the other half of the same
 * question and the half a map is actually good at — you are looking at a
 * *place*, so what it says is what holding this ground would do, and what is
 * standing between you and it.
 *
 * Deliberately not a second buy button. Signing is the board's job and
 * duplicating it here would give the same act two homes.
 *
 * A landmark with no district behind it — the planner lays out far more places
 * than the catalog retains — falls back to the scene's own description, which
 * is what this line has always shown.
 */
function DistrictBrief({ landmark, game, chosen }: { landmark: MapLandmark; game: GameState; chosen: boolean }) {
  const district = game.territory.districts.find((entry) => entry.landmark_key === landmark.key)
  if (!district) return <p className="uw-district-guide-detail">{landmark.detail}</p>
  // Which network opened it, named whether or not it is held: an unheld gate
  // appears in `locks` as prose, and a held one vanishes entirely, so the map
  // could otherwise never say "you are here because of the bar association".
  const opener = game.catalog.assets.find(
    (asset) => asset.type === 'connection' && (asset.districts ?? []).some((entry) => entry.key === district.key),
  )
  const state = district.owned ? 'held' : district.available ? 'open' : 'locked'
  // The connection gate gets its own sentence above, so it would otherwise be
  // stated twice; what is left is the tier and reputation bar.
  const openerLock = opener ? `requires the ${opener.name.toLowerCase()}` : null
  const otherLocks = district.locks.filter((lock) => lock.toLowerCase() !== openerLock)
  return (
    <div className={`uw-district-brief is-${state}${chosen ? ' is-chosen' : ''}`}>
      <p>{landmark.detail}</p>
      <div className="uw-district-brief-head">
        <b>{district.owned ? 'RETAINER HELD' : district.available ? 'RETAINER OPEN' : 'RETAINER LOCKED'}</b>
        <span>{district.retainer}</span>
      </div>
      <dl className="uw-district-brief-terms">
        <div><dt>Standing</dt><dd>+{district.standing.toFixed(1)}</dd></div>
        <div><dt>Rent relief</dt><dd>{(district.rent_relief_bps / 100).toFixed(0)}%</dd></div>
        <div><dt>{district.owned ? 'Paid' : 'Fee'}</dt><dd>{formatMoney(district.cost, true)}</dd></div>
      </dl>
      {opener && (
        <p className="uw-district-brief-gate">
          {opener.owned
            ? <>Open to you through the <b>{opener.name.toLowerCase()}</b>. Their contact stands here.</>
            : <>Gated by the <b>{opener.name.toLowerCase()}</b>, which your firm does not hold.</>}
        </p>
      )}
      {otherLocks.length > 0 && <p className="uw-district-brief-gate">{otherLocks.join(' · ')}</p>}
    </div>
  )
}

export function UnifiedEmpireMap({ game, focusRival, focusConnection, onManage, empireValueLabel }: {
  game: GameState
  /** A rival key handed over from the firm tab's "Show on the map". */
  focusRival?: string | null
  /** A connection key handed over the same way. A connection's whole effect is
      the retainer board it opens, so arriving from one lands on that board's
      region with the board already open — otherwise buying a network changes
      nothing the player can see. */
  focusConnection?: string | null
  onManage: (tab: 'upgrades' | 'rivals' | 'connections') => void
  empireValueLabel: string
}) {
  const { play } = useSound()
  const navigate = useNavigate()
  const currentRegion = regionForTier(game.office_tier)
  const focusAsset = focusRival ? game.catalog.assets.find((asset) => asset.key === focusRival && asset.type === 'rival') : undefined
  const focusNetwork = focusConnection ? game.catalog.assets.find((asset) => asset.key === focusConnection && asset.type === 'connection') : undefined
  const [activeRegionKey, setActiveRegionKey] = useState<MapRegionKey>(
    (focusAsset ? regionForTier(focusAsset.tier) : focusNetwork ? regionForTier(focusNetwork.tier) : currentRegion).key,
  )
  const [selectedKey, setSelectedKey] = useState(focusAsset ? `rival-${focusAsset.key}` : '')
  const [viewMode, setViewMode] = useState<MapViewMode>(focusAsset ? 'rivals' : 'career')
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [cameraCommand, setCameraCommand] = useState<{ id: number; action: MapCameraAction; landmark?: string }>({ id: 0, action: 'focus' })
  const [landmarks, setLandmarks] = useState<MapLandmark[]>([])
  const [activeLandmark, setActiveLandmark] = useState<MapLandmark | null>(null)
  /**
   * The district the player has chosen, as distinct from the one they are
   * pointing at. `activeLandmark` follows the pointer across the directory and
   * is what fills the detail line; this survives the pointer leaving, and is
   * what the scene draws its selection highlight from.
   */
  const [selectedDistrict, setSelectedDistrict] = useState<MapLandmark | null>(null)
  const [landmarkTip, setLandmarkTip] = useState<{ landmark: MapLandmark; x: number; y: number } | null>(null)
  // Collapsed by default. The district's places are discoverable in the world
  // itself (hover a building, click it); this is the index for someone who
  // wants to travel somewhere by name, not a panel the map has to wear.
  const [guideOpen, setGuideOpen] = useState(false)
  const activeRegion = regions.find((region) => region.key === activeRegionKey) ?? currentRegion
  useAmbientMusic(activeRegionKey)

  // The map's counsel figure is built inside the three.js scene, with no React
  // props reaching it, so the character builder reads the player's wardrobe
  // from a module registry instead. Filling that registry means loading the
  // builder's chunk, which is asynchronous, so the scene is held back one tick
  // until it is filled — otherwise the very first visit after a change would
  // build the figure in last session's suit.
  const cosmeticsKey = JSON.stringify(game.cosmetics ?? null)
  const [dressed, setDressed] = useState(false)
  useEffect(() => {
    let cancelled = false
    void applyPlayerCosmetics(JSON.parse(cosmeticsKey) as GameState['cosmetics'] | null).then(() => {
      if (!cancelled) setDressed(true)
    })
    return () => { cancelled = true }
  }, [cosmeticsKey])

  const points = useMemo<MapScenePoint[]>(() => {
    const tiers: MapSceneTier[] = game.catalog.tiers
      .filter((tier) => regionForTier(tier.tier).key === activeRegionKey)
      .map((tier) => ({ key: `tier-${tier.tier}`, kind: 'tier', data: tier, state: tierState(tier.tier, game.office_tier) }))
    const rivals: MapSceneRival[] = game.catalog.assets
      .filter((asset) => asset.type === 'rival' && regionForTier(asset.tier).key === activeRegionKey)
      .map((asset) => ({ key: `rival-${asset.key}`, kind: 'rival' as const, data: asset, locked: !asset.owned && !asset.available }))
    const events: MapSceneEvent[] = worldEvents
      .filter((event) => regionForTier(event.minTier).key === activeRegionKey)
      .map((event) => ({ key: `event-${event.key}`, kind: 'event', data: event, locked: game.office_tier < event.minTier }))
    return [...tiers, ...rivals, ...events]
  }, [activeRegionKey, game.catalog.assets, game.catalog.tiers, game.office_tier])

  // Districts the firm holds, named as the scene's own landmark keys — the
  // `TerritoryDistrict.landmark_key` -> `MapLandmark.key` join. Districts in
  // other regions and those the planner never laid out drop out here.
  //
  // Derived from a sorted key string rather than from `districts` directly
  // because the scene lists this among the dependencies that rebuild the whole
  // world, and `game` is refetched on a timer: filtering inline would hand it a
  // fresh array on every refetch and rebuild the map each time.
  const ownedLandmarkKeys = game.territory.districts
    .filter((district) => district.owned && district.landmark_key && district.region === activeRegionKey)
    .map((district) => district.landmark_key)
    .sort()
    .join(',')
  const ownedLandmarks = useMemo(
    () => (ownedLandmarkKeys ? ownedLandmarkKeys.split(',') : []),
    [ownedLandmarkKeys],
  )

  /*
   * The networks the firm holds that reach into this region, and the districts
   * in it they open.
   *
   * A connection has only ever existed as a crest on the office wall, and its
   * effect happens on the retainer board rather than where the crest hangs. The
   * scene can put a contact at a district; the catalog knows which districts a
   * network unlocks; the territory board is the only place the two meet, since
   * it is what carries `landmark_key`. So the join happens here.
   *
   * Flattened to a string for the same reason `ownedLandmarks` is: this is a
   * scene dependency, `game` is refetched on a timer, and handing the world a
   * freshly-built array every refetch would rebuild it every refetch.
   */
  const contactKey = game.catalog.assets
    .filter((asset) => asset.type === 'connection' && asset.owned)
    .map((asset) => {
      const opens = (asset.districts ?? [])
        .map((entry) => game.territory.districts.find((district) => district.key === entry.key))
        .filter((district): district is TerritoryDistrict => Boolean(district?.landmark_key) && district?.region === activeRegionKey)
      if (!opens.length) return ''
      const role = opens.length === 1 ? `Opens ${opens[0].name}` : `Opens ${opens.length} retainers here`
      return [asset.key, asset.name, role, opens.map((district) => district.landmark_key).join('~')].join('|')
    })
    .filter(Boolean)
    .join(';')
  const contacts = useMemo<MapSceneContact[]>(
    () => (contactKey ? contactKey.split(';').map((row) => {
      const [key, name, role, landmarks] = row.split('|')
      return { key, name, role, landmarks: landmarks.split('~') }
    }) : []),
    [contactKey],
  )

  const selected = points.find((point) => point.key === selectedKey)
  const established = game.catalog.tiers.filter((tier) => tier.tier <= game.office_tier).length
  // Empire-wide, not per-region: this is the count the page header used to
  // carry, and it answers "how far through the rivals am I" rather than
  // "what is in front of me right now", which the view tabs already show.
  const rivalAssets = game.catalog.assets.filter((asset) => asset.type === 'rival')
  const rivalsHeld = rivalAssets.filter((asset) => asset.owned).length
  const activity = Math.max(2, Math.min(9, 3 + points.filter((point) => point.kind === 'tier' && point.state !== 'locked').length))
  const pointCounts = {
    career: points.filter((point) => point.kind === 'tier').length,
    rivals: points.filter((point) => point.kind === 'rival').length,
    dockets: points.filter((point) => point.kind === 'event').length,
  }
  const careerTiers = points.filter((point): point is MapSceneTier => point.kind === 'tier')
  const rivalPoints = points.filter((point): point is MapSceneRival => point.kind === 'rival')
  const docketPoints = points.filter((point): point is MapSceneEvent => point.kind === 'event')
  const menuPoints: MapScenePoint[] = viewMode === 'career' ? careerTiers : viewMode === 'rivals' ? rivalPoints : docketPoints

  const choosePoint = useCallback((key: string) => {
    setSelectedKey(key)
    const point = points.find((candidate) => candidate.key === key)
    const locked = point?.kind === 'tier' ? point.state === 'locked' : point?.locked
    // A rival headquarters is a place before it is a menu entry, so selecting
    // one flies to it exactly like an office; the operations it offers arrive
    // with the location card rather than in a board of their own.
    if (!locked && (point?.kind === 'tier' || point?.kind === 'rival')) {
      setCameraCommand((command) => ({ id: command.id + 1, action: 'focus' }))
    }
    void play(locked ? 'error' : 'select', { seed: key, intensity: locked ? .38 : .58 })
  }, [play, points])

  const focusRegion = (key: MapRegionKey) => {
    setActiveRegionKey(key)
    setSelectedKey('')
    setViewMode('career')
    setLandmarks([])
    setActiveLandmark(null)
    setSelectedDistrict(null)
    setLandmarkTip(null)
    setCameraCommand((command) => ({ id: command.id + 1, action: 'focus' }))
    void play('map', { seed: `arc:${key}`, scene: key, intensity: .44 })
  }

  const focusHeadquarters = () => {
    setActiveRegionKey(currentRegion.key)
    setSelectedKey(`tier-${game.office_tier}`)
    setViewMode('career')
    setCameraCommand((command) => ({ id: command.id + 1, action: 'focus' }))
    void play('map', { seed: `headquarters:${game.office_tier}`, scene: currentRegion.key, intensity: .46 })
  }

  // The scene reports its own district directory once it has been built, so
  // the guide always matches whatever the procedural planner actually laid out.
  const handleLandmarks = useCallback((next: MapLandmark[]) => {
    setLandmarks(next)
    setActiveLandmark(null)
    setSelectedDistrict(null)
    setLandmarkTip(null)
  }, [])
  const handleLandmarkHover = useCallback((landmark: MapLandmark | null, client: { x: number; y: number } | null) => {
    setLandmarkTip(landmark && client ? { landmark, x: client.x, y: client.y } : null)
  }, [])
  const handleLandmarkSelect = useCallback((landmark: MapLandmark) => {
    setActiveLandmark(landmark)
    setSelectedDistrict(landmark)
    void play('select', { seed: `landmark:${landmark.key}`, intensity: .4 })
  }, [play])
  const travelToLandmark = (landmark: MapLandmark) => {
    setActiveLandmark(landmark)
    setSelectedDistrict(landmark)
    setCameraCommand((command) => ({ id: command.id + 1, action: 'landmark', landmark: landmark.key }))
    void play('map', { seed: `travel:${landmark.key}`, scene: activeRegionKey, intensity: .38 })
  }
  // Districts carry an optional `landmark_key` naming the place they are
  // retained over. The catalog is owned by the backend and the scene builds
  // its own directory procedurally, so the join is best-effort: when the
  // planner has laid that place out, signing its retainer flies there; when it
  // has not, the purchase simply happens where you are.
  const travelToLandmarkKey = useCallback((key: string) => {
    const landmark = landmarks.find((candidate) => candidate.key === key)
    if (landmark) travelToLandmark(landmark)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landmarks])

  const sendCameraCommand = (action: MapCameraAction) => {
    setCameraCommand((command) => ({ id: command.id + 1, action }))
    void play('select', { seed: `camera:${action}`, intensity: .24 })
  }

  const pointLocked = (point: MapScenePoint) => point.kind === 'tier' ? point.state === 'locked' : point.locked
  const chooseView = (mode: MapViewMode) => {
    setViewMode(mode)
    setSelectedKey('')
    void play('map', { seed: `map-view:${activeRegionKey}:${mode}`, scene: activeRegionKey, intensity: .32 })
  }

  const chooseMenuPoint = (key: string) => {
    if (!key) {
      setSelectedKey('')
      return
    }
    choosePoint(key)
    setMobileControlsOpen(false)
  }

  return (
    <div className="unified-empire">
      {/* One panel for every headquarters vital instead of two stacked cards
          repeating the same office name and level in different words — the
          progress bar's fraction *is* the "headquarters established" count,
          so that number only needs to appear once. */}
      <header className="uw-world-ledger">
        <div className="uw-ledger-hq">
          <small>YOUR PRACTICE</small>
          <strong>{game.office.name}</strong>
          <div className="uw-world-progress" aria-label={`Level ${game.office_tier + 1} of ${game.catalog.tiers.length}, ${established} headquarters established`}>
            <span><i style={{ width: `${established / Math.max(1, game.catalog.tiers.length) * 100}%` }} /></span>
            <small>Level {game.office_tier + 1} of {game.catalog.tiers.length}</small>
          </div>
        </div>
        <button type="button" className="uw-ledger-jump" onClick={focusHeadquarters} aria-label={`Jump to headquarters — ${currentRegion.name}`}>
          <b><HomeMark /></b>
          <span>{currentRegion.name}</span>
        </button>
      </header>

      <nav className="uw-arc-navigation" aria-label="Career environments">
        {regions.map((region) => {
          const total = region.range[1] - region.range[0] + 1
          const completed = game.catalog.tiers.filter((tier) => tier.tier >= region.range[0] && tier.tier <= region.range[1] && tier.tier <= game.office_tier).length
          const state = game.office_tier > region.range[1] ? 'complete' : game.office_tier >= region.range[0] ? 'current' : 'future'
          return (
            <button
              type="button"
              className={`${activeRegionKey === region.key ? 'active' : ''} is-${state}`}
              aria-pressed={activeRegionKey === region.key}
              onClick={() => focusRegion(region.key)}
              key={region.key}
            >
              <small>{region.number}</small>
              <span><strong>{region.name}</strong><em>{region.short}</em></span>
              <b>{completed}/{total}</b>
            </button>
          )
        })}
      </nav>

      <section className="uw-map-frame" data-webgl-surface aria-label={`${activeRegion.name} living career scene`}>
        <Suspense fallback={<div className="uw-three-loading"><i /><span>Building {activeRegion.name}</span></div>}>
          {!dressed && <div className="uw-three-loading"><i /><span>Building {activeRegion.name}</span></div>}
          {dressed && <MapThreeScene
            region={activeRegionKey}
            points={points}
            selectedKey={selectedKey}
            onSelect={choosePoint}
            activity={activity}
            cameraCommand={cameraCommand}
            viewMode={viewMode}
            playerGender={game.character_gender}
            playerTier={game.office_tier}
            playerName={game.lawyer_name}
            onLandmarks={handleLandmarks}
            onLandmarkHover={handleLandmarkHover}
            onLandmarkSelect={handleLandmarkSelect}
            ownedLandmarks={ownedLandmarks}
            contacts={contacts}
            selectedLandmark={selectedDistrict?.key ?? null}
          />}
        </Suspense>

        <div className="uw-mobile-scene-summary" aria-hidden="true">
          <small>{activeRegion.number} · {viewMode === 'career' ? 'CAREER' : viewMode === 'rivals' ? 'RIVALS' : 'DOCKETS'}</small>
          <strong>{activeRegion.name}</strong>
        </div>

        <button
          type="button"
          className="uw-mobile-scene-menu-toggle"
          aria-expanded={mobileControlsOpen}
          aria-controls="uw-mobile-scene-menu"
          onClick={() => {
            void play(mobileControlsOpen ? 'paper' : 'select', { seed: 'mobile-map-controls', intensity: .2 })
            setMobileControlsOpen((open) => !open)
          }}
        >
          <span>{mobileControlsOpen ? 'Close' : 'Explore'}</span><b>{mobileControlsOpen ? <CloseMark /> : <MenuMark />}</b>
        </button>

        {mobileControlsOpen && (
          <>
            <button type="button" className="mobile-scene-menu-scrim" aria-label="Close map controls" onClick={() => setMobileControlsOpen(false)} />
            <aside className="uw-mobile-scene-menu" id="uw-mobile-scene-menu" role="dialog" aria-modal="true" aria-labelledby="uw-mobile-scene-menu-title">
            <header><small>CAREER ATLAS</small><strong id="uw-mobile-scene-menu-title">Explore the district</strong></header>
            <div className="uw-mobile-progress-card">
              <span><small>CURRENT HEADQUARTERS</small><strong>{game.office.name}</strong><em>{currentRegion.name}</em></span>
              <div><i style={{ width: `${established / Math.max(1, game.catalog.tiers.length) * 100}%` }} /><small>{established} of {game.catalog.tiers.length} established</small></div>
            </div>
            <label>
              <span>Environment</span>
              <select value={activeRegionKey} onChange={(event) => focusRegion(event.target.value as MapRegionKey)}>
                {regions.map((region) => <option value={region.key} key={region.key}>{region.number} · {region.name}</option>)}
              </select>
            </label>
            <label>
              <span>Map layer</span>
              <select value={viewMode} onChange={(event) => chooseView(event.target.value as MapViewMode)}>
                <option value="career">Career route · {pointCounts.career}</option>
                <option value="rivals">Rival firms · {pointCounts.rivals}</option>
                <option value="dockets">Live dockets · {pointCounts.dockets}</option>
              </select>
            </label>
            <label>
              <span>Destination</span>
              <select value={selectedKey} onChange={(event) => chooseMenuPoint(event.target.value)}>
                <option value="">Choose a location</option>
                {menuPoints.map((point) => (
                  <option value={point.key} key={point.key}>
                    {point.kind === 'tier'
                      ? `Level ${point.data.tier + 1} · ${point.data.name}`
                      : point.kind === 'rival'
                        ? point.data.name.replace('Acquire ', '')
                        : point.data.name}
                  </option>
                ))}
              </select>
            </label>
            {/* On phones the map frame is the whole screen and its foot belongs
                to the tab bar, so the retainer board rides in the Explore sheet
                rather than in the desktop left rail. */}
            <RetainerBoard
              game={game}
              regionKey={activeRegionKey}
              regionName={activeRegion.name}
              onTravel={(key) => { travelToLandmarkKey(key); setMobileControlsOpen(false) }}
              defaultOpen={Boolean(focusNetwork)}
            />
            <div className="uw-mobile-camera-actions">
              <button type="button" onClick={() => { sendCameraCommand('focus'); setMobileControlsOpen(false) }}>Find counsel</button>
              <button type="button" onClick={() => { sendCameraCommand('home'); setMobileControlsOpen(false) }}>Reset view</button>
              <button type="button" onClick={() => { focusHeadquarters(); setMobileControlsOpen(false) }}>My HQ</button>
            </div>
            <p>Drag to survey · pinch to zoom · tap a marker to travel</p>
            </aside>
          </>
        )}

        <div className="uw-scene-title" aria-hidden="true">
          <small>{activeRegion.number} · CAREER ENVIRONMENT</small>
          <strong>{activeRegion.name}</strong>
          <span>{activeRegion.short} · {activeRegion.character}</span>
        </div>

        <div className="uw-scene-view-tabs" role="group" aria-label="Map view">
          {([
            ['career', 'Career route'],
            ['rivals', 'Rival firms'],
            ['dockets', 'Live dockets'],
          ] as Array<[MapViewMode, string]>).map(([mode, label]) => (
            <button type="button" className={viewMode === mode ? 'active' : ''} aria-pressed={viewMode === mode} onClick={() => chooseView(mode)} key={mode}>
              <span>{label}</span><b>{pointCounts[mode]}</b>
            </button>
          ))}
        </div>

        <div className="uw-map-toolbar" role="group" aria-label="Scene camera controls">
          <button type="button" onClick={() => sendCameraCommand('in')} aria-label="Move camera closer"><PlusMark /></button>
          <button type="button" onClick={() => sendCameraCommand('out')} aria-label="Move camera farther"><MinusMark /></button>
          <button type="button" onClick={() => sendCameraCommand('focus')} aria-label="Focus camera on your lawyer"><TargetMark /></button>
          <button type="button" onClick={() => sendCameraCommand('home')} aria-label="Reset scene camera"><HomeMark /></button>
        </div>

        <nav className="uw-level-navigator" aria-label={`${activeRegion.name} ${viewMode}`}>
          <div className="uw-level-navigator-heading">
            <b>{viewMode === 'career' ? 'FULL ROUTE' : viewMode === 'rivals' ? 'RIVAL NETWORK' : 'DISTRICT DOCKETS'}</b>
            <span>{viewMode === 'career' ? 'Every office remains selectable' : viewMode === 'rivals' ? 'Compare every firm in this arc' : 'Open live matters from the map'}</span>
          </div>
          <div className={`uw-level-navigator-track is-${viewMode}`}>
            {viewMode === 'career'
              ? careerTiers.map((point) => (
                <button
                  type="button"
                  className={`is-${point.state} ${selectedKey === point.key ? 'is-selected' : ''}`}
                  aria-current={point.state === 'current' ? 'step' : undefined}
                  aria-pressed={selectedKey === point.key}
                  onClick={() => choosePoint(point.key)}
                  key={point.key}
                >
                  <i>{point.data.tier + 1}</i>
                  <span><strong>{point.data.name}</strong><small>{point.state === 'current' ? 'Headquarters' : point.state}</small></span>
                </button>
              ))
              : viewMode === 'rivals'
                ? rivalPoints.map((point, index) => (
                  <button type="button" className={`${point.locked ? 'is-locked' : point.data.owned ? 'is-complete' : 'is-next'} ${selectedKey === point.key ? 'is-selected' : ''}`} aria-pressed={selectedKey === point.key} onClick={() => choosePoint(point.key)} key={point.key}>
                    <i>R{index + 1}</i>
                    <span><strong>{point.data.name.replace('Acquire ', '')}</strong><small>{point.data.owned ? 'acquired' : point.locked ? 'locked' : 'available'}</small></span>
                  </button>
                ))
                : docketPoints.map((point, index) => (
                  <button type="button" className={`${point.locked ? 'is-locked' : 'is-current'} ${selectedKey === point.key ? 'is-selected' : ''}`} aria-pressed={selectedKey === point.key} onClick={() => choosePoint(point.key)} key={point.key}>
                    <i>D{index + 1}</i>
                    <span><strong>{point.data.name}</strong><small>{point.locked ? `level ${point.data.minTier + 1}` : 'live now'}</small></span>
                  </button>
                ))}
          </div>
        </nav>

        <div className="uw-map-instructions"><b>SELECT AN OFFICE TO MOVE COUNSEL</b><i /><span>Drag to survey</span><i /><span>Scroll to zoom</span></div>

        <div className="uw-holdings">
          <b>CONTESTED TERRITORY</b>
          <span>{rivalsHeld} of {rivalAssets.length} rival firms held</span>
        </div>

        {/* The left rail: what is here (the scene's own place index) and what
            of it your firm holds. Both are collapsed strips, so the map stays
            the map until one of them is asked for. */}
        <div className="uw-map-rail">
          {landmarks.length > 0 && (
            <aside className={`uw-district-guide ${guideOpen ? 'is-open' : ''}`} aria-label={`${activeRegion.name} district guide`}>
              <button type="button" className="uw-district-guide-toggle" aria-expanded={guideOpen} onClick={() => setGuideOpen((open) => !open)}>
                <small>DISTRICT GUIDE</small>
                <strong>{landmarks.length} places</strong>
                <i aria-hidden="true">{guideOpen ? <MinusMark /> : <PlusMark />}</i>
              </button>
              {guideOpen && (
                <>
                  <div className="uw-district-guide-list">
                    {landmarks.map((landmark) => (
                      <button
                        type="button"
                        className={activeLandmark?.key === landmark.key ? 'is-active' : ''}
                        key={landmark.key}
                        onClick={() => travelToLandmark(landmark)}
                        onMouseEnter={() => setActiveLandmark(landmark)}
                      >
                        <b>{landmarkTag[landmark.kind]}</b>
                        <span>{landmark.name}</span>
                      </button>
                    ))}
                  </div>
                  {(activeLandmark ?? selectedDistrict) && (
                    <DistrictBrief
                      landmark={(activeLandmark ?? selectedDistrict)!}
                      game={game}
                      chosen={selectedDistrict?.key === (activeLandmark ?? selectedDistrict)!.key}
                    />
                  )}
                </>
              )}
            </aside>
          )}
          <RetainerBoard
            game={game}
            regionKey={activeRegionKey}
            regionName={activeRegion.name}
            onTravel={travelToLandmarkKey}
            defaultOpen={Boolean(focusNetwork)}
          />
        </div>

        {landmarkTip && (
          <div className="uw-landmark-tip" style={{ left: landmarkTip.x, top: landmarkTip.y }} aria-hidden="true">
            <b>{landmarkTag[landmarkTip.landmark.kind]}</b>
            <span>{landmarkTip.landmark.name}</span>
          </div>
        )}

        {selected && (
          <aside className={`uw-location-card kind-${selected.kind}`} aria-live="polite">
            <button type="button" className="uw-card-close" onClick={() => setSelectedKey('')} aria-label="Close location card"><CloseMark /></button>
            <small>
              {selected.kind === 'tier'
                ? `LEVEL ${selected.data.tier + 1} · ${selected.state.toUpperCase()}`
                : selected.kind === 'rival'
                  ? selected.data.owned ? 'ACQUIRED OFFICE' : 'RIVAL OFFICE'
                  : selected.locked ? `LOCKED · LEVEL ${selected.data.minTier + 1}` : 'LIVE DISTRICT DOCKET'}
            </small>
            <strong>{selected.kind === 'rival' ? rivalFirmName(selected.data) : selected.data.name}</strong>
            <p>{selected.kind === 'tier' ? selected.data.short : selected.kind === 'rival' ? selected.data.description : selected.data.detail}</p>
            {/* The territorial mechanic, surfaced at the place it applies to.
                This is the map's slice of the war room — where this firm stands
                and what it would cost today — not the board itself, which lives
                on the firm tab and is one button away. */}
            {selected.kind === 'rival' && (() => {
              const standing = rivalStanding(selected.data)
              const discount = (selected.data.discount_bps ?? 0) / 100
              const list = selected.data.list_cost ?? selected.data.cost
              return (
                <div className={`uw-card-standing is-${standing}`}>
                  <span className="uw-standing-chip">{STANDING_COPY[standing].label}</span>
                  <em>{STANDING_COPY[standing].blurb}</em>
                  <div className="uw-standing-price">
                    {discount > 0 && <del>${list.toLocaleString()}</del>}
                    <strong>${selected.data.cost.toLocaleString()}</strong>
                    {discount > 0 && <b>{discount.toFixed(0)}% off list</b>}
                  </div>
                </div>
              )
            })()}
            {selected.kind !== 'event' && <div className="uw-card-cost">{selected.kind === 'tier' && <span>${selected.data.cost.toLocaleString()}</span>}<span>★ {selected.data.reputation}</span>{selected.kind === 'tier' && <span>LEASE ${selected.data.rent_daily.toLocaleString()}/DAY</span>}</div>}
            {/* The header ledger used to carry this always-on; now it surfaces
                here, on the one card that is specifically about the office you
                are actually sitting in right now. */}
            {selected.kind === 'tier' && selected.state === 'current' && (
              <div className="uw-card-empire-value">
                <small>Empire value</small>
                <strong>{empireValueLabel}</strong>
              </div>
            )}
            {selected.kind !== 'event' && (
              <button type="button" className="uw-card-action" disabled={pointLocked(selected)} onClick={() => onManage(selected.kind === 'tier' ? 'upgrades' : 'rivals')}>
                {pointLocked(selected) ? 'Route not yet earned' : selected.kind === 'tier' ? 'Manage headquarters' : 'Run an operation'} <i>{pointLocked(selected) ? <CloseMark /> : <ChevronMark />}</i>
              </button>
            )}
            {selected.kind === 'event' && <div className={`uw-signal-state ${selected.locked ? '' : 'live'}`}>{selected.locked ? `Reach level ${selected.data.minTier + 1} to open this docket.` : selected.data.detail}</div>}
            {selected.kind === 'event' && !selected.locked && <button type="button" className="uw-card-action" onClick={() => navigate('/cases')}>Open Daily Docket <i><ChevronMark /></i></button>}
          </aside>
        )}
      </section>
    </div>
  )
}
