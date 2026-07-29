import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { GameState } from '../types'
import { useAmbientMusic, useSound } from '../sound'
import type {
  MapRegionKey,
  MapSceneEvent,
  MapScenePoint,
  MapSceneRival,
  MapSceneTier,
  MapViewMode,
} from './map-three-scene'
import { loadMapScene } from './scene-loaders'
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

const rivalRegions: MapRegionKey[] = [
  'city', 'city', 'city', 'city',
  'nation', 'nation',
  'ocean', 'ocean', 'ocean',
  'continent', 'continent',
  'orbit', 'orbit', 'orbit',
]

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

function regionForTier(tier: number) {
  return regions.find((region) => tier >= region.range[0] && tier <= region.range[1]) ?? regions[0]
}

function tierState(tier: number, officeTier: number): MapSceneTier['state'] {
  if (tier < officeTier) return 'complete'
  if (tier === officeTier) return 'current'
  if (tier === officeTier + 1) return 'next'
  return 'locked'
}

export function UnifiedEmpireMap({ game, onManage }: { game: GameState; onManage: (tab: 'upgrades' | 'rivals') => void }) {
  const { play } = useSound()
  const navigate = useNavigate()
  const currentRegion = regionForTier(game.office_tier)
  const [activeRegionKey, setActiveRegionKey] = useState<MapRegionKey>(currentRegion.key)
  const [selectedKey, setSelectedKey] = useState('')
  const [viewMode, setViewMode] = useState<MapViewMode>('career')
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [cameraCommand, setCameraCommand] = useState<{ id: number; action: 'in' | 'out' | 'home' | 'focus' }>({ id: 0, action: 'focus' })
  const activeRegion = regions.find((region) => region.key === activeRegionKey) ?? currentRegion
  useAmbientMusic(activeRegionKey)

  const points = useMemo<MapScenePoint[]>(() => {
    const tiers: MapSceneTier[] = game.catalog.tiers
      .filter((tier) => regionForTier(tier.tier).key === activeRegionKey)
      .map((tier) => ({ key: `tier-${tier.tier}`, kind: 'tier', data: tier, state: tierState(tier.tier, game.office_tier) }))
    const rivals: MapSceneRival[] = game.catalog.assets
      .filter((asset) => asset.type === 'rival')
      .map((asset, index) => ({ key: `rival-${asset.key}`, kind: 'rival' as const, data: asset, locked: !asset.owned && !asset.available, region: rivalRegions[index] ?? 'orbit' }))
      .filter((point) => point.region === activeRegionKey)
      .map(({ region: _region, ...point }) => point)
    const events: MapSceneEvent[] = worldEvents
      .filter((event) => regionForTier(event.minTier).key === activeRegionKey)
      .map((event) => ({ key: `event-${event.key}`, kind: 'event', data: event, locked: game.office_tier < event.minTier }))
    return [...tiers, ...rivals, ...events]
  }, [activeRegionKey, game.catalog.assets, game.catalog.tiers, game.office_tier])

  const selected = points.find((point) => point.key === selectedKey)
  const established = game.catalog.tiers.filter((tier) => tier.tier <= game.office_tier).length
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
    if (point?.kind === 'tier' && !locked) setCameraCommand((command) => ({ id: command.id + 1, action: 'focus' }))
    void play(locked ? 'error' : 'select', { seed: key, intensity: locked ? .38 : .58 })
  }, [play, points])

  const focusRegion = (key: MapRegionKey) => {
    setActiveRegionKey(key)
    setSelectedKey('')
    setViewMode('career')
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

  const sendCameraCommand = (action: 'in' | 'out' | 'home' | 'focus') => {
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
      <header className="uw-world-ledger">
        <div>
          <small>YOUR PRACTICE · LIVING CAREER ATLAS</small>
          <strong>{game.office.name}</strong>
          <span>Level {game.office_tier + 1} of {game.catalog.tiers.length}</span>
        </div>
        <div className="uw-world-progress" aria-label={`${established} of ${game.catalog.tiers.length} headquarters established`}>
          <span><i style={{ width: `${established / Math.max(1, game.catalog.tiers.length) * 100}%` }} /></span>
          <small>{established} headquarters established</small>
        </div>
        <button type="button" onClick={focusHeadquarters}><b>⌂</b><span>My headquarters<small>{currentRegion.name}</small></span></button>
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
          <MapThreeScene
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
          />
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
          <span>{mobileControlsOpen ? 'Close' : 'Explore'}</span><b>{mobileControlsOpen ? '×' : '☰'}</b>
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
          <button type="button" onClick={() => sendCameraCommand('in')} aria-label="Move camera closer">+</button>
          <button type="button" onClick={() => sendCameraCommand('out')} aria-label="Move camera farther">−</button>
          <button type="button" onClick={() => sendCameraCommand('focus')} aria-label="Focus camera on your lawyer">◎</button>
          <button type="button" onClick={() => sendCameraCommand('home')} aria-label="Reset scene camera">⌂</button>
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

        {selected && (
          <aside className={`uw-location-card kind-${selected.kind}`} aria-live="polite">
            <button type="button" className="uw-card-close" onClick={() => setSelectedKey('')} aria-label="Close location card">×</button>
            <small>
              {selected.kind === 'tier'
                ? `LEVEL ${selected.data.tier + 1} · ${selected.state.toUpperCase()}`
                : selected.kind === 'rival'
                  ? selected.data.owned ? 'ACQUIRED OFFICE' : 'RIVAL OFFICE'
                  : selected.locked ? `LOCKED · LEVEL ${selected.data.minTier + 1}` : 'LIVE DISTRICT DOCKET'}
            </small>
            <strong>{selected.data.name.replace('Acquire ', '')}</strong>
            <p>{selected.kind === 'tier' ? selected.data.short : selected.kind === 'rival' ? selected.data.description : selected.data.detail}</p>
            {selected.kind !== 'event' && <div className="uw-card-cost"><span>${selected.data.cost.toLocaleString()}</span><span>★ {selected.data.reputation}</span>{selected.kind === 'tier' && <span>LEASE ${selected.data.rent_daily.toLocaleString()}/DAY</span>}</div>}
            {selected.kind !== 'event' && (
              <button type="button" className="uw-card-action" disabled={pointLocked(selected)} onClick={() => onManage(selected.kind === 'tier' ? 'upgrades' : 'rivals')}>
                {pointLocked(selected) ? 'Route not yet earned' : selected.kind === 'tier' ? 'Manage headquarters' : 'Open acquisition file'} <i>{pointLocked(selected) ? '×' : '›'}</i>
              </button>
            )}
            {selected.kind === 'event' && <div className={`uw-signal-state ${selected.locked ? '' : 'live'}`}>{selected.locked ? `Reach level ${selected.data.minTier + 1} to open this docket.` : selected.data.detail}</div>}
            {selected.kind === 'event' && !selected.locked && <button type="button" className="uw-card-action" onClick={() => navigate('/cases')}>Open Daily Docket <i>›</i></button>}
          </aside>
        )}
      </section>
    </div>
  )
}
