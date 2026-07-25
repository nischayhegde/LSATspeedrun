import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { CharacterGender, GameAsset, GameState } from './types'
import { Bust, Person, type Mood } from './art/people'
import { SiteArt } from './art/structures'
import { OfficeRoom } from './art/office'
import { TerrainArt } from './art/terrains'
import { MapWebGLLayer } from './art/map-webgl'
import { UnifiedEmpireMap } from './art/unified-empire-map'
import { useSound } from './sound'
import {
  clientArt, connectionArt, judgeArt, keyHash, ownerArt, playerArt, playerStage, staffArt, upgradeArt, cutsceneArt,
} from './art/assets'

const ArticulatedCharacter = lazy(() => import('./art/articulated-character').then((module) => ({ default: module.ArticulatedCharacter })))

type OfficeSceneProps = {
  game?: GameState | null
  gender?: CharacterGender
  previewTier?: number
  className?: string
}

type Position = { x: number; y: number }
type OfficeAnchorKey = 'lamp' | 'window' | 'coffee' | 'cat' | 'case' | 'firm' | 'empire' | 'story'
type OfficeAnchorMap = Partial<Record<OfficeAnchorKey, Position>>

export type CharacterMood = Mood

/* --------------------------------------------------------- parallax */

function useParallax<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--px', (((event.clientX - rect.left) / rect.width - 0.5) * 2).toFixed(3))
    el.style.setProperty('--py', (((event.clientY - rect.top) / rect.height - 0.5) * 2).toFixed(3))
  }, [])
  const onPointerLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--px', '0')
    el.style.setProperty('--py', '0')
  }, [])
  return { ref, onPointerMove, onPointerLeave }
}

/* ------------------------------------------------------------- cast */

const staffPortraits: Record<string, { role: string; x: number; y: number }> = {
  paralegal: { role: 'MAYA · PARALEGAL', x: 25, y: 50 },
  junior_associate: { role: 'THEO · ASSOCIATE', x: 59, y: 43 },
  office_manager: { role: 'NINA · MANAGER', x: 34, y: 76 },
  senior_associate: { role: 'AVERY · SENIOR', x: 65, y: 76 },
  partner: { role: 'JORDAN · PARTNER', x: 75, y: 51 },
  rainmaker: { role: 'MORGAN · RAINMAKER', x: 51, y: 63 },
}

function staffProfileFor(asset: GameAsset) {
  if (staffPortraits[asset.key]) return staffPortraits[asset.key]
  const hash = keyHash(asset.key)
  return {
    role: asset.name.toUpperCase(),
    x: 16 + (hash % 6) * 11,
    y: 44 + (hash % 3) * 15,
  }
}

const clientPortraits: Record<string, { title: string; bg: string }> = {
  briefcase: { title: 'WALK-IN', bg: '#3c4a58' },
  home: { title: 'LOCAL REFERRAL', bg: '#2e5a52' },
  store: { title: 'FOUNDER', bg: '#7c5b3c' },
  gem: { title: 'PRIVATE CLIENT', bg: '#54406b' },
  building: { title: 'GENERAL COUNSEL', bg: '#31435e' },
  landmark: { title: 'NATIONAL BOARD', bg: '#1c3a4a' },
  globe: { title: 'GLOBAL CHAIR', bg: '#25415c' },
  civic: { title: 'CIVIC DIRECTOR', bg: '#4f6b62' },
  hospitality: { title: 'HOSPITALITY GROUP', bg: '#8a4f3a' },
  property: { title: 'CITY BUILDER', bg: '#6d6152' },
  health: { title: 'HEALTH EXECUTIVE', bg: '#2d5049' },
  media: { title: 'STUDIO CHAIR', bg: '#5e2b50' },
  tech: { title: 'TECH FOUNDER', bg: '#1f4247' },
  sports: { title: 'LEAGUE COMMISSIONER', bg: '#7c4460' },
  energy: { title: 'GRID OPERATOR', bg: '#75513a' },
  sovereign: { title: 'SOVEREIGN DIRECTOR', bg: '#3c2f57' },
  bank: { title: 'CENTRAL BANKER', bg: '#123c50' },
  quantum: { title: 'QUANTUM CHAIR', bg: '#2a3160' },
  ocean: { title: 'OCEANIC COUNCIL', bg: '#0e3a58' },
  orbit: { title: 'ORBITAL DIRECTOR', bg: '#1c2438' },
  lunar: { title: 'LUNAR ENVOY', bg: '#3a3350' },
  nexus: { title: 'ASSEMBLY SPEAKER', bg: '#151d3d' },
}

const rivalProfiles: Record<string, { owner: string; title: string; mark: string; architecture: string }> = {
  neighborhood_practice: { owner: 'Eleanor Harrow', title: 'Founding partner', mark: 'H&F', architecture: 'brick-house' },
  downtown_boutique: { owner: 'Lucien Vale', title: 'Trial strategist', mark: 'V', architecture: 'art-deco' },
  regional_firm: { owner: 'Priya Nayar', title: 'Managing partner', mark: '★', architecture: 'northstar' },
  national_competitor: { owner: 'Sebastian Sterling', title: 'Global chair', mark: 'SG', architecture: 'mega-tower' },
  appellate_chambers: { owner: 'Inez Blackstone', title: 'Head of chambers', mark: 'BC', architecture: 'gothic' },
  media_law_collective: { owner: 'Juno Gold', title: 'Creative partner', mark: 'N+G', architecture: 'neon' },
  transatlantic_firm: { owner: 'Arthur Meridian', title: 'Atlantic chair', mark: 'MA', architecture: 'glass-arc' },
  global_crisis_firm: { owner: 'Cass Redline', title: 'Crisis commander', mark: 'R!', architecture: 'command' },
  sovereign_rival: { owner: 'Mina Crown', title: 'Sovereign counsel', mark: 'CM', architecture: 'citadel' },
  continental_rival: { owner: 'Atlas Okafor', title: 'Continental chair', mark: 'AJ', architecture: 'campus' },
  oceanic_rival: { owner: 'Kai Pelagic', title: 'Oceanic founder', mark: 'PP', architecture: 'ocean' },
  orbital_rival: { owner: 'Yara Zenith', title: 'Orbital managing partner', mark: 'ZO', architecture: 'orbital' },
  lunar_rival: { owner: 'Remy Selene', title: 'Lunar accord keeper', mark: 'SA', architecture: 'lunar' },
  planetary_rival: { owner: 'Apex Council', title: 'Network stewards', mark: 'AX', architecture: 'nexus' },
}

/* -------------------------------------------------------- cutscenes */

const cutsceneMeta: Record<string, { weather: 'rain' | 'stars' | 'dust' | 'none'; speaker: string; speakerRole: string }> = {
  rainy_shack: { weather: 'rain', speaker: staffArt('international_arbitrator'), speakerRole: 'A determined stranger' },
  market_showdown: { weather: 'dust', speaker: staffArt('office_manager'), speakerRole: 'Market ward organizer' },
  city_hall_night: { weather: 'stars', speaker: staffArt('communications_director'), speakerRole: 'City hall insider' },
  sterling_tower: { weather: 'none', speaker: staffArt('partner'), speakerRole: 'Sterling emissary' },
  midnight_exchange: { weather: 'stars', speaker: staffArt('private_investigator'), speakerRole: 'Night contact' },
  continental_forum: { weather: 'dust', speaker: staffArt('sovereign_envoy'), speakerRole: 'Forum arbiter' },
  orbital_hearing: { weather: 'stars', speaker: staffArt('orbital_counsel'), speakerRole: 'Orbital counsel' },
  planetary_nexus: { weather: 'stars', speaker: staffArt('chief_justice_strategist'), speakerRole: 'Nexus strategist' },
}

export function CutsceneArtwork({ scene, game }: { scene: string; game: GameState }) {
  const meta = cutsceneMeta[scene] ?? cutsceneMeta.rainy_shack
  const parallax = useParallax<HTMLDivElement>()
  return (
    <div
      className={`cutscene-art av-cutscene cutscene-${scene}`}
      role="img"
      aria-label={`Illustrated campaign scene: ${scene.replaceAll('_', ' ')}`}
      ref={parallax.ref}
      onPointerMove={parallax.onPointerMove}
      onPointerLeave={parallax.onPointerLeave}
    >
      <div className="av-layer av-layer-far">
        <img className="av-cutscene-img" src={cutsceneArt(scene)} alt="" draggable={false} />
      </div>
      {meta.weather === 'rain' && (
        <div className="av-ov-rain" aria-hidden="true">
          {Array.from({ length: 46 }, (_, i) => (
            <i key={i} className={`drop d-${i % 3}`} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 0.17}s` }} />
          ))}
        </div>
      )}
      {meta.weather === 'stars' && (
        <div className="av-ov-stars" aria-hidden="true">
          {Array.from({ length: 30 }, (_, i) => (
            <i key={i} className={`tw tw-${i % 3}`} style={{ left: `${(i * 43) % 100}%`, top: `${(i * 19) % 55}%` }} />
          ))}
        </div>
      )}
      {meta.weather === 'dust' && (
        <div className="av-ov-dust" aria-hidden="true">
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} className={`mote m-${i % 7}`} style={{ left: `${(i * 61) % 100}%`, top: `${20 + ((i * 29) % 70)}%` }} />
          ))}
        </div>
      )}
      <div className="av-cutscene-cast av-cutscene-speaker">
        <Person src={meta.speaker} direction="right" label={meta.speakerRole} />
      </div>
      <div className="av-cutscene-cast av-cutscene-player">
        <Person gender={game.character_gender} tier={game.office_tier} direction="left" label={game.lawyer_name} />
      </div>
      <div className="av-cutscene-grade" />
      <div className="av-letterbox av-letterbox-top" />
      <div className="av-letterbox av-letterbox-bottom" />
    </div>
  )
}

/* --------------------------------------------------- asset vignettes */

export function PixelAssetArtwork({ asset }: { asset: GameAsset }) {
  const state = asset.owned ? 'owned' : asset.available ? 'available' : 'locked'
  const profile = asset.type === 'rival' ? (rivalProfiles[asset.key] ?? rivalProfiles.neighborhood_practice) : null
  const staff = asset.type === 'staff' ? staffProfileFor(asset) : null
  return (
    <div className={`pixel-asset-art av-vignette asset-${asset.type} asset-${state}`} role="img" aria-label={`${asset.name} illustration`}>
      {asset.type === 'staff' && staff ? (
        <div className="av-vignette-stage">
          <div className="av-vignette-backwall" />
          <Person src={staffArt(asset.key)} label={asset.name} className="av-vignette-person" />
        </div>
      ) : asset.type === 'rival' && profile ? (
        <>
          <div className="av-vignette-site">
            <SiteArt kind="rival" tier={asset.tier} architecture={profile.architecture} mark={profile.mark} owned={asset.owned} />
          </div>
          <div className="av-vignette-owner">
            <Bust src={ownerArt(asset.key)} backdrop="none" />
            <span><strong>{profile.owner}</strong><small>{profile.title}</small></span>
          </div>
        </>
      ) : (
        <div className="av-card-frame">
          <img
            className="av-card-img"
            src={asset.type === 'upgrade' ? upgradeArt(asset.key) : connectionArt(asset.key)}
            alt=""
            draggable={false}
            loading="lazy"
          />
          <i className="av-card-sheen" />
        </div>
      )}
      {state === 'locked' && <div className="av-vignette-lock"><span>?</span></div>}
      {state === 'owned' && <div className="av-vignette-owned">✓</div>}
      <span className="asset-art-label av-vignette-label">
        {asset.type === 'upgrade' ? 'OFFICE UPGRADE' : asset.type === 'staff' ? 'TEAM MEMBER' : asset.type === 'connection' ? 'NEW CONTACTS' : 'ACQUISITION'}
      </span>
    </div>
  )
}

/* -------------------------------------------------------- portraits */

export function ClientPortrait({
  kind = 'briefcase',
  name,
  mood = 'neutral',
  className = '',
}: {
  kind?: string
  name: string
  mood?: CharacterMood
  className?: string
}) {
  const profile = clientPortraits[kind] ?? clientPortraits.briefcase
  return (
    <div className={`client-portrait av-portrait client-${kind} mood-${mood} ${className}`} aria-label={`${name}, ${profile.title.toLowerCase()}, ${mood}`} role="img">
      <Bust src={clientArt(kind)} backdrop={profile.bg} mood={mood} />
      <b>{['globe', 'orbit', 'lunar', 'nexus', 'quantum'].includes(kind) ? '✦' : name.slice(0, 1)}</b>
      <small>{profile.title}</small>
    </div>
  )
}

export function JudgePortrait({ thinking = false, pleased = false }: { thinking?: boolean; pleased?: boolean }) {
  return (
    <div className={`judge-portrait av-judge ${thinking ? 'is-thinking' : ''} ${pleased ? 'is-pleased' : ''}`} aria-hidden="true">
      <Bust src={judgeArt(pleased)} backdrop="#2c2438" />
      <span className="av-judge-gavel">⚖</span>
      <span className="av-judge-state">{pleased ? '✓' : thinking ? '…' : '§'}</span>
    </div>
  )
}

export function MiniAvatar({ gender, tier = 0 }: { gender: CharacterGender; tier?: number }) {
  return <div className="mini-avatar av-mini-avatar"><Person gender={gender} tier={tier} /></div>
}

/* ------------------------------------------------------- the office */

function OfficeBackdrop({ game, previewTier, children }: OfficeSceneProps & { children?: React.ReactNode | ((anchors: OfficeAnchorMap) => React.ReactNode) }) {
  const { play } = useSound()
  const tier = previewTier ?? game?.office_tier ?? 0
  const owned = useMemo(() => new Set(game?.owned_assets ?? []), [game?.owned_assets])
  const staff = (game?.catalog.assets ?? [])
    .filter((asset) => asset.type === 'staff' && owned.has(asset.key))
    .slice(-8)
  const parallax = useParallax<HTMLDivElement>()

  const [catAwake, setCatAwake] = useState(false)
  const [cozyUntil, setCozyUntil] = useState(0)
  const cozy = cozyUntil > Date.now()
  const [roomMode, setRoomMode] = useState<'focus' | 'storm' | null>(null)
  const [officeAnchors, setOfficeAnchors] = useState<OfficeAnchorMap>({})

  useEffect(() => {
    const office = parallax.ref.current
    if (!office) return
    const updateAnchors = (event: Event) => setOfficeAnchors((event as CustomEvent<OfficeAnchorMap>).detail)
    office.addEventListener('office-anchor-update', updateAnchors)
    return () => office.removeEventListener('office-anchor-update', updateAnchors)
  }, [parallax.ref])

  const anchorStyle = (key: OfficeAnchorKey, fallback: Position): CSSProperties => {
    const anchor = officeAnchors[key] ?? fallback
    return { left: `${anchor.x}%`, top: `${anchor.y}%` }
  }

  const petCat = useCallback(() => {
    void play('cat', { seed: game?.id ?? 'preview-office', intensity: .55 })
    setCatAwake(true)
    window.setTimeout(() => setCatAwake(false), 4200)
  }, [game?.id, play])
  const brewCoffee = useCallback(() => {
    void play('coffee', { seed: game?.id ?? 'preview-office', intensity: .48 })
    setCozyUntil(Date.now() + 45_000)
  }, [game?.id, play])
  const setRoomScene = useCallback((mode: 'focus' | 'storm') => {
    void play(mode === 'focus' ? 'select' : 'story', { seed: `${game?.id ?? 'preview-office'}:${mode}`, intensity: .42 })
    setRoomMode((current) => current === mode ? null : mode)
  }, [game?.id, play])

  return (
    <div
      className={`av-office office-tier-${tier} ${cozy ? 'is-cozy' : ''} ${catAwake ? 'cat-awake' : ''} ${roomMode ? `room-${roomMode}` : ''}`}
      data-tier={tier}
      ref={parallax.ref}
      onPointerMove={parallax.onPointerMove}
      onPointerLeave={parallax.onPointerLeave}
    >
      <OfficeRoom tier={tier} owned={owned} staffCount={staff.length} />
      <div className="av-firm-sign"><strong>{game?.firm_name ?? 'COUNSEL & CO.'}</strong><span>ATTORNEYS AT LAW</span></div>
      <button type="button" className="office-touchpoint touchpoint-cat" style={anchorStyle('cat', { x: 15.75, y: 86 })} onClick={petCat} aria-label="Pet the office cat"><span>Pet cat</span></button>
      <button type="button" className="office-touchpoint touchpoint-coffee" style={anchorStyle('coffee', { x: 79.25, y: 71.5 })} onClick={brewCoffee} aria-label="Make coffee for the team"><span>Make coffee</span></button>
      <button type="button" className={`office-hotspot hotspot-lamp ${roomMode === 'focus' ? 'is-active' : ''}`} style={anchorStyle('lamp', { x: 71.5, y: 64 })} onClick={() => setRoomScene('focus')} aria-label="Toggle the desk lamp study light"><i /><span>Desk light</span></button>
      {tier < 2 && <button type="button" className={`office-hotspot hotspot-window ${roomMode === 'storm' ? 'is-active' : ''}`} style={anchorStyle('window', { x: 28, y: 44 })} onClick={() => setRoomScene('storm')} aria-label="Toggle the rain at the window"><i /><span>Window weather</span></button>}
      {roomMode && <div className="room-activity-note" role="status">{roomMode === 'focus' ? 'Desk light on — settle into the file.' : 'Rain at the window — the room grows quiet.'}</div>}
      <div className="cozy-glow" aria-hidden="true" />
      {typeof children === 'function' ? children(officeAnchors) : children}
      <div className="av-office-vignette" />
      <div className="scene-caption av-scene-caption"><span>FIRM TIER {tier}</span><strong>{game?.office.name ?? (tier === 0 ? 'Wooden Shack' : 'Future Headquarters')}</strong></div>
    </div>
  )
}

export function OfficeScene(props: OfficeSceneProps) {
  return <div className={`office-scene av-scene ${props.className ?? ''}`}><OfficeBackdrop {...props} /></div>
}

/* ---------------------------------------------------- character panel */

const stageTitles = ['Street Counsel', 'Rising Associate', 'Downtown Advocate', 'Power Partner', 'Global Magnate', 'Celestial Counsel']

export function CharacterPanel({ game }: { game: GameState }) {
  const stage = playerStage(game.office_tier)
  const motion = useParallax<HTMLElement>()
  return (
    <aside
      className="av-character-panel"
      data-character-stage={stage}
      aria-label={`${game.lawyer_name}, your lawyer`}
      ref={motion.ref}
      onPointerMove={motion.onPointerMove}
      onPointerLeave={motion.onPointerLeave}
    >
      <div className="av-hero-stage">
        <i className="av-hero-halo" />
        <div className="av-hero-figure">
          <Suspense fallback={<div className="av-rigged-character-loading" aria-label={`Preparing ${game.lawyer_name}`}><span>Rendering counsel</span></div>}>
            <ArticulatedCharacter
              alt={`${game.lawyer_name}, ${stageTitles[stage]}`}
              gender={game.character_gender}
              tier={game.office_tier}
            />
          </Suspense>
          <i className="av-hero-breath-light" aria-hidden="true" />
        </div>
        <i className="av-hero-rim" aria-hidden="true" />
        <i className="av-hero-floor" />
      </div>
      <div className="av-hero-plaque">
        <small>YOUR LAWYER</small>
        <strong>{game.lawyer_name}</strong>
        <span>{stageTitles[stage]}</span>
        <em>★ {game.reputation} REPUTATION</em>
      </div>
    </aside>
  )
}

export function ExplorableOffice({
  game,
  activeCase,
  onCase,
  onFirm,
  onEmpire,
  onStory,
}: {
  game: GameState
  activeCase: boolean
  onCase: () => void
  onFirm: () => void
  onEmpire: () => void
  onStory: () => void
}) {
  const { play } = useSound()
  const zones = useMemo(() => [
    { key: 'case', x: 72, y: 72, label: activeCase ? 'Resume the active case' : 'Open the client file', detail: `${game.active_client.name} · ${game.active_client.base_fee.toLocaleString()} base fee`, action: onCase },
    { key: 'firm', x: 12, y: 59, label: 'Manage the firm', detail: 'Upgrades · staff · clients', action: onFirm },
    { key: 'empire', x: 88, y: 60, label: 'Enter the empire map', detail: 'Explore offices and rivals', action: onEmpire },
    { key: 'story', x: 61, y: 43, label: 'Open the caseboard', detail: game.story.active_quest ? game.story.active_quest.title : 'Campaign · quests · rival intelligence', action: onStory },
  ], [activeCase, game.active_client.base_fee, game.active_client.name, game.story.active_quest, onCase, onEmpire, onFirm, onStory])

  return (
    <div className="av-office-duo">
      <CharacterPanel game={game} />
      <div className="office-explorer game-viewport av-viewport" aria-label="Explorable law office">
        <OfficeBackdrop game={game}>
          {(anchors) => zones.map((zone) => (
            <button
              key={zone.key}
              className={`world-zone zone-${zone.key}`}
              style={{
                left: `${anchors[zone.key as OfficeAnchorKey]?.x ?? zone.x}%`,
                top: `${anchors[zone.key as OfficeAnchorKey]?.y ?? zone.y}%`,
              }}
              onClick={() => {
                if (zone.key === 'case' && activeCase) void play('resume', { seed: game.id, intensity: .48 })
                else if (zone.key === 'empire') void play('map', { seed: zone.key, intensity: .48 })
                else if (zone.key === 'story') void play('story', { seed: zone.key, intensity: .48 })
                else if (zone.key === 'firm') void play('ledger', { seed: zone.key, intensity: .48 })
                zone.action()
              }}
              aria-label={`${zone.label}. ${zone.detail}`}
            >
              <i />
              <span><b>{zone.label}</b><small>{zone.detail}</small></span>
            </button>
          ))}
        </OfficeBackdrop>
        <div className="world-objective">
          <span>ACTIVE QUEST</span>
          <strong>{activeCase ? 'Finish your argument' : 'A client is waiting'}</strong>
          <small>Click the <b>!</b> to begin.</small>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- empire map */

const mapSections = [
  { key: 'city', scale: 'CITY MAP', name: 'THE CITY', districts: 'OLD QUARTER → CIVIC CENTER → FINANCIAL DISTRICT', detail: 'Build a street practice into the city’s signature firm.', minTier: 0, maxTier: 4 },
  { key: 'nation', scale: 'NATIONAL MAP', name: 'THE NATION', districts: 'HARBOR EXCHANGE → MIDTOWN CROWN', detail: 'Link regional branches into a national litigation network.', minTier: 5, maxTier: 6 },
  { key: 'world', scale: 'WORLD MAP', name: 'THE OPEN SEA', districts: 'EMBASSY ROW → SOVEREIGN ENCLAVE', detail: 'Carry international matters between ports, courts and capitals.', minTier: 7, maxTier: 9 },
  { key: 'continent', scale: 'CONTINENTAL MAP', name: 'THE CONTINENT', districts: 'INNOVATION ARC → AZURE COAST', detail: 'Coordinate continental campuses and oceanic counsel.', minTier: 10, maxTier: 11 },
  { key: 'space', scale: 'PLANETARY MAP', name: 'BEYOND EARTH', districts: 'EARTH ORBIT → LUNAR GATE → JUSTICE NEXUS', detail: 'Set precedent across orbital and lunar jurisdictions.', minTier: 12, maxTier: 14 },
] as const

type MapSection = (typeof mapSections)[number]

function mapSectionForTier(tier: number): MapSection {
  return mapSections.find((section) => tier >= section.minTier && tier <= section.maxTier) ?? mapSections[0]
}

const siteLayouts: Record<MapSection['key'], { tier: Position[]; rival: Position[] }> = {
  /* keep the bottom-right corner free — the inspector panel lives there */
  city: {
    tier: [{ x: 14, y: 72 }, { x: 31, y: 55 }, { x: 48, y: 74 }, { x: 66, y: 54 }, { x: 87, y: 46 }],
    rival: [{ x: 26, y: 36 }, { x: 43, y: 23 }, { x: 63, y: 31 }, { x: 84, y: 22 }],
  },
  nation: {
    tier: [{ x: 56, y: 68 }, { x: 30, y: 38 }],
    rival: [{ x: 22, y: 72 }, { x: 46, y: 22 }],
  },
  world: {
    tier: [{ x: 24, y: 54 }, { x: 52, y: 38 }, { x: 74, y: 36 }],
    rival: [{ x: 36, y: 72 }, { x: 60, y: 20 }, { x: 88, y: 16 }],
  },
  continent: {
    tier: [{ x: 30, y: 40 }, { x: 67, y: 70 }],
    rival: [{ x: 16, y: 70 }, { x: 81, y: 38 }],
  },
  space: {
    tier: [{ x: 26, y: 38 }, { x: 84, y: 26 }, { x: 55, y: 60 }],
    rival: [{ x: 13, y: 64 }, { x: 68, y: 14 }, { x: 40, y: 80 }],
  },
}

const commuterRoutes: Record<MapSection['key'], Array<{ from: Position; to: Position; delay: number; duration: number }>> = {
  city: [
    { from: { x: 8, y: 84 }, to: { x: 37, y: 61 }, delay: -2, duration: 15 },
    { from: { x: 45, y: 86 }, to: { x: 72, y: 61 }, delay: -8, duration: 18 },
    { from: { x: 32, y: 43 }, to: { x: 57, y: 35 }, delay: -4, duration: 20 },
    { from: { x: 71, y: 78 }, to: { x: 91, y: 62 }, delay: -11, duration: 16 },
  ],
  nation: [
    { from: { x: 10, y: 79 }, to: { x: 42, y: 58 }, delay: -5, duration: 19 },
    { from: { x: 42, y: 57 }, to: { x: 68, y: 41 }, delay: -12, duration: 22 },
    { from: { x: 55, y: 79 }, to: { x: 85, y: 63 }, delay: -2, duration: 18 },
  ],
  world: [
    { from: { x: 10, y: 75 }, to: { x: 35, y: 58 }, delay: -7, duration: 20 },
    { from: { x: 44, y: 59 }, to: { x: 68, y: 42 }, delay: -2, duration: 23 },
    { from: { x: 65, y: 76 }, to: { x: 88, y: 59 }, delay: -13, duration: 21 },
  ],
  continent: [
    { from: { x: 10, y: 65 }, to: { x: 38, y: 47 }, delay: -8, duration: 20 },
    { from: { x: 42, y: 79 }, to: { x: 71, y: 64 }, delay: -3, duration: 17 },
    { from: { x: 64, y: 42 }, to: { x: 88, y: 28 }, delay: -12, duration: 24 },
  ],
  space: [
    { from: { x: 15, y: 72 }, to: { x: 39, y: 54 }, delay: -4, duration: 22 },
    { from: { x: 49, y: 79 }, to: { x: 73, y: 61 }, delay: -14, duration: 25 },
    { from: { x: 63, y: 39 }, to: { x: 89, y: 24 }, delay: -7, duration: 24 },
  ],
}

type MapLiveEvent = { key: string; name: string; detail: string; icon: string; minTier: number; position: Position }

const mapLiveEvents: Record<MapSection['key'], MapLiveEvent[]> = {
  city: [
    { key: 'morning-docket', name: 'Morning docket', detail: 'The civic courts are filling for the day’s hearings.', icon: '§', minTier: 0, position: { x: 55, y: 20 } },
    { key: 'client-tip', name: 'Client tip', detail: 'A neighborhood contact has left a lead near the market.', icon: '!', minTier: 1, position: { x: 20, y: 51 } },
    { key: 'bar-mixer', name: 'Bar mixer', detail: 'Senior counsel are gathering in the financial district.', icon: '◆', minTier: 3, position: { x: 77, y: 69 } },
  ],
  nation: [
    { key: 'circuit-calendar', name: 'Circuit calendar', detail: 'A regional appellate panel has posted its schedule.', icon: '§', minTier: 5, position: { x: 42, y: 52 } },
    { key: 'express-brief', name: 'Express brief', detail: 'The national courier is departing from Central Station.', icon: '⇢', minTier: 6, position: { x: 75, y: 72 } },
  ],
  world: [
    { key: 'embassy-docket', name: 'Embassy docket', detail: 'Cross-border counsel are convening at the treaty port.', icon: '◎', minTier: 7, position: { x: 18, y: 35 } },
    { key: 'trade-dispute', name: 'Trade dispute', detail: 'A new commercial matter is moving through the shipping lanes.', icon: '⚑', minTier: 8, position: { x: 63, y: 66 } },
    { key: 'sovereign-summit', name: 'Sovereign summit', detail: 'Delegations are arriving at the international forum.', icon: '◆', minTier: 9, position: { x: 83, y: 27 } },
  ],
  continent: [
    { key: 'innovation-hearing', name: 'Innovation hearing', detail: 'Technology counsel have opened a public hearing.', icon: '⌁', minTier: 10, position: { x: 42, y: 31 } },
    { key: 'coastal-arbitration', name: 'Coastal arbitration', detail: 'Maritime arbitrators are gathering at the Azure Coast.', icon: '⚖', minTier: 11, position: { x: 72, y: 55 } },
  ],
  space: [
    { key: 'orbital-session', name: 'Orbital session', detail: 'The hearing ring has called its first matter.', icon: '◉', minTier: 12, position: { x: 30, y: 56 } },
    { key: 'lunar-signal', name: 'Lunar signal', detail: 'A priority transmission is waiting at the lunar gate.', icon: '⌁', minTier: 13, position: { x: 72, y: 34 } },
    { key: 'nexus-vote', name: 'Nexus vote', detail: 'The interworld assembly is entering a decisive vote.', icon: '✦', minTier: 14, position: { x: 51, y: 20 } },
  ],
}

function sectionPosition(sectionKey: MapSection['key'], kind: 'tier' | 'rival', index: number): Position {
  const layout = siteLayouts[sectionKey]
  const list = kind === 'tier' ? layout.tier : layout.rival
  return list[index % list.length] ?? { x: 20 + index * 20, y: kind === 'tier' ? 60 : 26 }
}

function LegacyEmpireWorldMap({ game, onManage }: { game: GameState; onManage: (tab: 'upgrades' | 'rivals') => void }) {
  const { play } = useSound()
  const rivals = game.catalog.assets.filter((asset) => asset.type === 'rival')
  const tierPoints = mapSections.flatMap((section) => {
    const tiers = game.catalog.tiers.filter((tier) => tier.tier >= section.minTier && tier.tier <= section.maxTier)
    return tiers.map((tier, index) => ({ key: `tier-${tier.tier}`, kind: 'tier' as const, sectionKey: section.key, position: sectionPosition(section.key, 'tier', index), data: tier }))
  })
  const rivalPoints = mapSections.flatMap((section) => {
    const sectionRivals = rivals.filter((rival) => rival.tier >= section.minTier && rival.tier <= section.maxTier)
    return sectionRivals.map((rival, index) => ({ key: `rival-${rival.key}`, kind: 'rival' as const, sectionKey: section.key, position: sectionPosition(section.key, 'rival', index), data: rival }))
  })
  const points = [...tierPoints, ...rivalPoints]
  const initialSection = mapSectionForTier(game.office_tier)
  const hqPoint = tierPoints.find((point) => point.key === `tier-${game.office_tier}`) ?? tierPoints[0]
  const [selected, setSelected] = useState(`tier-${game.office_tier}`)
  const [activeSectionKey, setActiveSectionKey] = useState<MapSection['key']>(initialSection.key)
  const [traveler, setTraveler] = useState({ sectionKey: initialSection.key, position: hqPoint.position, pointKey: hqPoint.key })
  const [isTraveling, setIsTraveling] = useState(false)
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1.08 })
  const [isPanning, setIsPanning] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [activeEvent, setActiveEvent] = useState<MapLiveEvent | null>(null)
  const travelTimer = useRef<number | null>(null)
  const terrainRef = useRef<HTMLDivElement | null>(null)
  const cameraDrag = useRef<{ pointerId: number; startX: number; startY: number; cameraX: number; cameraY: number; moved: boolean } | null>(null)
  const selectedPoint = points.find((point) => point.key === selected) ?? points[0]
  const selectedRivalProfile = selectedPoint.kind === 'rival' ? (rivalProfiles[selectedPoint.data.key] ?? rivalProfiles.neighborhood_practice) : null
  const activeSection = mapSections.find((section) => section.key === activeSectionKey) ?? mapSections[0]
  const hqSection = initialSection
  const parallax = useParallax<HTMLDivElement>()
  const totalTiers = game.catalog.tiers.length
  const careerPercent = totalTiers > 1 ? (game.office_tier / (totalTiers - 1)) * 100 : 100
  const nextTier = game.catalog.tiers.find((tier) => tier.tier === game.office_tier + 1)
  const activeTiers = tierPoints.filter((point) => point.sectionKey === activeSection.key)
  const activeRivals = rivalPoints.filter((point) => point.sectionKey === activeSection.key)
  const establishedInSection = activeTiers.filter((point) => point.data.tier <= game.office_tier).length
  const ownedRivalsInSection = activeRivals.filter((point) => point.data.owned).length
  const sectionActivity = Math.min(5, 1 + establishedInSection + ownedRivalsInSection)
  const visibleCommuters = commuterRoutes[activeSection.key].slice(0, Math.max(2, sectionActivity))
  const activeEvents = mapLiveEvents[activeSection.key]

  const clampCamera = (x: number, y: number, zoom: number) => {
    const bounds = terrainRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0, zoom }
    const maxX = Math.max(0, bounds.width * (zoom - 1) * .5)
    const maxY = Math.max(0, bounds.height * (zoom - 1) * .5)
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)), zoom }
  }

  const zoomMap = (amount: number) => {
    setCamera((current) => {
      const zoom = Math.max(1.08, Math.min(2.2, current.zoom + amount))
      return clampCamera(current.x, current.y, zoom)
    })
  }

  const resetCamera = () => setCamera({ x: 0, y: 0, zoom: 1.08 })

  const focusPoint = (position: Position) => {
    const bounds = terrainRef.current?.getBoundingClientRect()
    if (!bounds) return
    const zoom = Math.max(camera.zoom, 1.35)
    const x = -((position.x / 100) * bounds.width - bounds.width / 2) * zoom
    const y = -((position.y / 100) * bounds.height - bounds.height / 2) * zoom
    setCamera(clampCamera(x, y, zoom))
  }

  const walkTo = (clientX: number, clientY: number) => {
    const bounds = terrainRef.current?.getBoundingClientRect()
    if (!bounds) return
    const mapX = ((clientX - bounds.left - bounds.width / 2 - camera.x) / camera.zoom + bounds.width / 2) / bounds.width * 100
    const mapY = ((clientY - bounds.top - bounds.height / 2 - camera.y) / camera.zoom + bounds.height / 2) / bounds.height * 100
    const position = { x: Math.max(4, Math.min(96, mapX)), y: Math.max(8, Math.min(92, mapY)) }
    if (travelTimer.current !== null) window.clearTimeout(travelTimer.current)
    setTraveler({ sectionKey: activeSection.key, position, pointKey: 'free-roam' })
    setIsTraveling(true)
    setActiveEvent(null)
    void play('map', { seed: `walk:${activeSection.key}:${Math.round(position.x)}:${Math.round(position.y)}`, intensity: .48 })
    travelTimer.current = window.setTimeout(() => setIsTraveling(false), 900)
  }

  const onMapPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    if (event.target.closest('button,.empire-inspector,.map-area-identity,.map-district-status,.map-event-card')) return
    cameraDrag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cameraX: camera.x, cameraY: camera.y, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onMapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    parallax.onPointerMove(event)
    const drag = cameraDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(deltaX, deltaY) > 5) {
      drag.moved = true
      setIsPanning(true)
    }
    if (drag.moved) setCamera(clampCamera(drag.cameraX + deltaX, drag.cameraY + deltaY, camera.zoom))
  }

  const onMapPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = cameraDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved) walkTo(event.clientX, event.clientY)
    cameraDrag.current = null
    setIsPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onMapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const directions: Record<string, Position> = {
      ArrowLeft: { x: 32, y: 0 }, a: { x: 32, y: 0 },
      ArrowRight: { x: -32, y: 0 }, d: { x: -32, y: 0 },
      ArrowUp: { x: 0, y: 26 }, w: { x: 0, y: 26 },
      ArrowDown: { x: 0, y: -26 }, s: { x: 0, y: -26 },
    }
    const direction = directions[event.key]
    if (direction) {
      event.preventDefault()
      setCamera((current) => clampCamera(current.x + direction.x, current.y + direction.y, current.zoom))
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault(); zoomMap(.16)
    } else if (event.key === '-') {
      event.preventDefault(); zoomMap(-.16)
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault(); resetCamera()
    }
  }

  useEffect(() => () => {
    if (travelTimer.current !== null) window.clearTimeout(travelTimer.current)
  }, [])

  const visitPoint = (point: (typeof points)[number]) => {
    if (selected !== point.key) void play('select', { seed: point.key, intensity: .3 })
    setSelected(point.key)
    setInspectorOpen(true)
    setActiveEvent(null)
    if (traveler.sectionKey !== point.sectionKey) {
      setTraveler({ sectionKey: point.sectionKey, position: point.position, pointKey: point.key })
      return
    }
    if (travelTimer.current !== null) window.clearTimeout(travelTimer.current)
    setIsTraveling(true)
    setTraveler({ sectionKey: point.sectionKey, position: point.position, pointKey: point.key })
    void play('map', { seed: `travel:${point.key}`, intensity: .58 })
    travelTimer.current = window.setTimeout(() => setIsTraveling(false), 900)
  }

  const jumpToSection = (section: MapSection) => {
    if (section.key !== activeSectionKey) void play('map', { seed: section.key, intensity: .78 })
    setActiveSectionKey(section.key)
    setCamera({ x: 0, y: 0, zoom: 1.08 })
    setInspectorOpen(false)
    setActiveEvent(null)
    const sectionPoints = points.filter((point) => point.sectionKey === section.key)
    const currentSelection = sectionPoints.find((point) => point.key === selected)
    const currentHq = sectionPoints.find((point) => point.key === `tier-${game.office_tier}`)
    const destination = currentSelection ?? currentHq ?? sectionPoints[0]
    if (!destination) return
    setSelected(destination.key)
    setTraveler({ sectionKey: section.key, position: destination.position, pointKey: destination.key })
    setIsTraveling(false)
  }

  return (
    <div className="empire-map-shell av-map-shell">
      <section className="empire-career-route" aria-label={`Career progress: level ${game.office_tier + 1} of ${totalTiers}`}>
        <div className="career-route-copy">
          <small>CAREER ROUTE</small>
          <strong>Level {game.office_tier + 1} of {totalTiers}</strong>
          <span>{game.office.name}</span>
        </div>
        <div className="career-route-track" aria-hidden="true">
          <i style={{ width: `${careerPercent}%` }} />
          {game.catalog.tiers.map((tier) => (
            <b
              key={tier.tier}
              className={tier.tier < game.office_tier ? 'complete' : tier.tier === game.office_tier ? 'current' : 'future'}
              style={{ left: `${(tier.tier / Math.max(1, totalTiers - 1)) * 100}%` }}
            />
          ))}
        </div>
        <div className="career-route-next">
          <small>{nextTier ? 'NEXT HEADQUARTERS' : 'EMPIRE COMPLETE'}</small>
          <strong>{nextTier?.name ?? 'Justice Nexus'}</strong>
          <span>{nextTier ? `$${nextTier.cost.toLocaleString()} · ★ ${nextTier.reputation}` : 'All headquarters established'}</span>
        </div>
      </section>
      <nav className="map-section-nav" aria-label="Empire map sections">
        {mapSections.map((section, index) => {
          const siteCount = points.filter((point) => point.sectionKey === section.key).length
          const sectionTiers = game.catalog.tiers.filter((tier) => tier.tier >= section.minTier && tier.tier <= section.maxTier)
          const established = sectionTiers.filter((tier) => tier.tier <= game.office_tier).length
          const sectionState = game.office_tier > section.maxTier ? 'complete' : game.office_tier >= section.minTier ? 'current' : 'future'
          return (
            <button
              type="button"
              className={`${activeSection.key === section.key ? 'active' : ''} ${hqSection.key === section.key ? 'contains-hq' : ''} section-${sectionState}`}
              aria-pressed={activeSection.key === section.key}
              onClick={() => jumpToSection(section)}
              key={section.key}
            >
              <small>{String(index + 1).padStart(2, '0')}</small>
              <span><strong>{section.name}</strong><em>{section.scale}</em></span>
              <b>{established}/{sectionTiers.length} LEVELS · {siteCount} SITES</b>
            </button>
          )
        })}
      </nav>
      <div className="empire-explorer game-viewport av-viewport" aria-label="Explorable legal empire map">
        <div
          className={`av-terrain av-terrain-${activeSection.key} ${isPanning ? 'is-panning' : ''}`}
          key={activeSection.key}
          ref={(node) => { parallax.ref.current = node; terrainRef.current = node }}
          tabIndex={0}
          aria-label={`${activeSection.name} interactive map. Click to walk, drag to pan, and use the mouse wheel to zoom.`}
          onPointerDown={onMapPointerDown}
          onPointerMove={onMapPointerMove}
          onPointerUp={onMapPointerUp}
          onPointerCancel={() => { cameraDrag.current = null; setIsPanning(false) }}
          onPointerLeave={parallax.onPointerLeave}
          onWheel={(event) => { event.preventDefault(); zoomMap(event.deltaY < 0 ? .12 : -.12) }}
          onKeyDown={onMapKeyDown}
        >
          <div
            className="map-camera-stage"
            style={{ '--map-camera-x': `${camera.x}px`, '--map-camera-y': `${camera.y}px`, '--map-camera-zoom': camera.zoom } as CSSProperties}
          >
          <TerrainArt section={activeSection.key} activity={sectionActivity} />
          <MapWebGLLayer section={activeSection.key} activity={sectionActivity} />
          <svg className="map-progression-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <filter id={`route-glow-${activeSection.key}`} x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="0.6" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {activeTiers.slice(1).map((point, index) => {
              const previous = activeTiers[index]
              const routeState = point.data.tier <= game.office_tier ? 'complete' : point.data.tier === game.office_tier + 1 ? 'next' : 'future'
              return <line key={point.key} className={`map-route-segment ${routeState}`} x1={previous.position.x} y1={previous.position.y} x2={point.position.x} y2={point.position.y} vectorEffect="non-scaling-stroke" />
            })}
            {activeTiers.map((point) => <circle key={point.key} className={point.data.tier <= game.office_tier ? 'route-stop established' : 'route-stop'} cx={point.position.x} cy={point.position.y} r="0.72" vectorEffect="non-scaling-stroke" />)}
          </svg>
          <div className="map-commuters" aria-hidden="true">
            {visibleCommuters.map((route, index) => (
              <div
                className={`map-commuter commuter-${index + 1}`}
                key={`${activeSection.key}-${index}`}
                style={{
                  '--from-x': `${route.from.x}%`, '--from-y': `${route.from.y}%`,
                  '--to-x': `${route.to.x}%`, '--to-y': `${route.to.y}%`,
                  '--commute-delay': `${route.delay}s`, '--commute-speed': `${route.duration}s`,
                } as CSSProperties}
              >
                <Person variant={index + 1} tier={Math.min(game.office_tier, 8)} direction={index % 2 ? 'left' : 'right'} walking />
              </div>
            ))}
          </div>
          <div className="map-live-events">
            {activeEvents.map((event) => {
              const unlocked = game.office_tier >= event.minTier
              return (
                <button
                  type="button"
                  className={`map-live-event ${unlocked ? 'unlocked' : 'locked'} ${activeEvent?.key === event.key ? 'active' : ''}`}
                  style={{ left: `${event.position.x}%`, top: `${event.position.y}%` }}
                  aria-label={`${event.name}. ${unlocked ? event.detail : `Unlocks at level ${event.minTier + 1}`}`}
                  onClick={() => {
                    setActiveEvent(event)
                    setInspectorOpen(false)
                    void play(unlocked ? 'event' : 'error', { seed: event.key, intensity: unlocked ? .72 : .42 })
                  }}
                  key={event.key}
                >
                  <i>{unlocked ? event.icon : '×'}</i><span>{event.name}<small>{unlocked ? 'LIVE' : `LEVEL ${event.minTier + 1}`}</small></span>
                </button>
              )
            })}
          </div>
          {activeTiers.map((point) => {
            const { data: tier, position } = point
            const status = tier.tier < game.office_tier ? 'complete' : tier.tier === game.office_tier ? 'current' : 'future'
            return (
              <button
                className={`empire-node av-node tier-map-node ${status} ${selected === `tier-${tier.tier}` ? 'is-selected' : ''}`}
                key={tier.tier}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                onClick={() => visitPoint(point)}
                aria-label={`${tier.name}, tier ${tier.tier}, ${status}`}
              >
                <SiteArt kind="tier" tier={tier.tier} />
                <span><b>{tier.name}</b><small>TIER {tier.tier} · {status === 'complete' ? 'ESTABLISHED' : status === 'current' ? 'HEADQUARTERS' : 'FUTURE'}</small></span>
              </button>
            )
          })}
          {activeRivals.map((point) => {
            const { data: rival, position } = point
            const profile = rivalProfiles[rival.key] ?? rivalProfiles.neighborhood_practice
            return (
              <button
                className={`empire-node av-node rival-map-node ${rival.owned ? 'owned' : ''} ${selected === `rival-${rival.key}` ? 'is-selected' : ''}`}
                key={rival.key}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                onClick={() => visitPoint(point)}
                aria-label={`${rival.name.replace('Acquire ', '')}, ${rival.owned ? 'acquired' : 'rival firm'}`}
              >
                <SiteArt kind="rival" tier={rival.tier} architecture={profile.architecture} mark={profile.mark} owned={rival.owned} />
                <span><b>{rival.name.replace('Acquire ', '')}</b><small>{rival.owned ? 'ACQUIRED' : 'RIVAL FIRM'}</small></span>
              </button>
            )
          })}
          {traveler.sectionKey === activeSection.key && (
            <div className={`world-person map-player ${isTraveling ? 'is-traveling' : ''}`} style={{ left: `${Math.min(94, traveler.position.x + 5)}%`, top: `${Math.min(90, traveler.position.y + 1)}%` }}>
              <Person gender={game.character_gender} tier={game.office_tier} direction={isTraveling ? 'right' : 'down'} walking={isTraveling} label={`${game.lawyer_name}, ${isTraveling ? 'traveling' : 'on location'}`} />
              <span className="map-player-label">{isTraveling ? 'EN ROUTE' : traveler.pointKey === hqPoint.key ? 'HEADQUARTERS' : 'ON SITE'}</span>
            </div>
          )}
          </div>
          <div className="map-area-identity av-map-identity" aria-hidden="true">
            <small>{activeSection.scale}</small><strong>{activeSection.name}</strong><span>{activeSection.districts}</span><em>{activeSection.detail}</em>
          </div>
          <div className="map-mobile-selection" aria-hidden="true">
            <small>SELECTED SITE</small><strong>{selectedPoint.data.name.replace('Acquire ', '')}</strong>
          </div>
          <div className="map-district-status" aria-hidden="true">
            <span>LIVE NETWORK</span><strong>{establishedInSection}/{activeTiers.length} HQs · {ownedRivalsInSection}/{activeRivals.length} RIVALS · ACTIVITY {sectionActivity}</strong>
          </div>
          <div className="map-control-deck" role="group" aria-label="Map camera controls">
            <button type="button" onClick={() => zoomMap(.16)} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => zoomMap(-.16)} aria-label="Zoom out">−</button>
            <button type="button" onClick={resetCamera} aria-label="Reset map camera">⌂</button>
            <button type="button" onClick={() => focusPoint(selectedPoint.position)} aria-label="Focus selected site">◎</button>
            <span>{Math.round(camera.zoom * 100)}%</span>
          </div>
          <div className="map-interaction-hint"><b>EXPLORE</b><span>Click to walk</span><i>•</i><span>Drag to pan</span><i>•</i><span>Scroll to zoom</span></div>
          {activeEvent && (
            <aside className={`map-event-card ${game.office_tier >= activeEvent.minTier ? 'unlocked' : 'locked'}`} aria-live="polite">
              <button type="button" onClick={() => setActiveEvent(null)} aria-label="Close district event">×</button>
              <small>DISTRICT SIGNAL · {game.office_tier >= activeEvent.minTier ? 'LIVE NOW' : `LEVEL ${activeEvent.minTier + 1}`}</small>
              <strong>{activeEvent.name}</strong>
              <p>{game.office_tier >= activeEvent.minTier ? activeEvent.detail : `Rise to level ${activeEvent.minTier + 1} to activate this district signal.`}</p>
            </aside>
          )}
        </div>
        <div className="map-legend av-map-legend"><span><i className="legend-owned" />OWNED</span><span><i className="legend-current" />HQ</span><span><i className="legend-rival" />RIVAL</span></div>
        {!inspectorOpen && (
          <button className="map-dossier-toggle" type="button" onClick={() => setInspectorOpen(true)} aria-label={`Open dossier for ${selectedPoint.data.name.replace('Acquire ', '')}`}>
            <small>SELECTED DOSSIER</small><strong>{selectedPoint.data.name.replace('Acquire ', '')}</strong><i>⌃</i>
          </button>
        )}
        <div className={`empire-inspector av-inspector ${inspectorOpen ? 'is-open' : 'is-closed'}`} aria-hidden={!inspectorOpen}>
          <button className="inspector-close" type="button" onClick={() => setInspectorOpen(false)} aria-label="Close location dossier">×</button>
          <span>{selectedPoint.kind === 'tier' ? `LEVEL ${selectedPoint.data.tier + 1} · FIRM DESTINATION` : 'ACQUISITION TARGET'}</span>
          <h2>{selectedPoint.data.name.replace('Acquire ', '')}</h2>
          <small className="inspector-region">{selectedPoint.data.region}</small>
          {selectedPoint.kind === 'rival' && selectedRivalProfile && (
            <div className="rival-owner-inspector av-owner-chip">
              <Bust src={ownerArt(selectedPoint.data.key)} backdrop="none" label={selectedRivalProfile.owner} />
              <span><small>RIVAL OWNER</small><strong>{selectedRivalProfile.owner}</strong><i>{selectedRivalProfile.title}</i></span>
            </div>
          )}
          <p>{selectedPoint.kind === 'tier' ? selectedPoint.data.short : selectedPoint.data.description}</p>
          <div className="inspector-readiness">
            <span className={game.cash >= selectedPoint.data.cost ? 'ready' : ''}><i style={{ width: `${Math.min(100, (game.cash / Math.max(1, selectedPoint.data.cost)) * 100)}%` }} />CASH</span>
            <span className={game.reputation >= selectedPoint.data.reputation ? 'ready' : ''}><i style={{ width: `${Math.min(100, (game.reputation / Math.max(1, selectedPoint.data.reputation)) * 100)}%` }} />REPUTATION</span>
          </div>
          <div>
            <b>${selectedPoint.data.cost.toLocaleString()}</b>
            <b>★ {selectedPoint.data.reputation} REP</b>
          </div>
          <button className="pixel-action av-inspector-action" onClick={() => {
            void play('navigate', { seed: selectedPoint.key, intensity: .42 })
            onManage(selectedPoint.kind === 'tier' ? 'upgrades' : 'rivals')
          }}>
            {selectedPoint.kind === 'tier' ? 'MANAGE OFFICE' : 'VIEW ACQUISITION'} <i>›</i>
          </button>
        </div>
      </div>
    </div>
  )
}

export function EmpireWorldMap({ game, onManage }: { game: GameState; onManage: (tab: 'upgrades' | 'rivals') => void }) {
  return <UnifiedEmpireMap game={game} onManage={onManage} />
}
