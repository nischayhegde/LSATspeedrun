import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CharacterGender, GameAsset, GameState } from './types'
import { Bust, Person, type Mood } from './art/people'
import { SiteArt } from './art/structures'
import { OfficeRoom } from './art/office'
import { TerrainArt } from './art/terrains'
import { useSound } from './sound'
import {
  clientArt, connectionArt, judgeArt, keyHash, ownerArt, playerArt, playerStage, propArt, staffArt, upgradeArt, cutsceneArt,
} from './art/assets'

type OfficeSceneProps = {
  game?: GameState | null
  gender?: CharacterGender
  previewTier?: number
  className?: string
}

type Position = { x: number; y: number }

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

const staffChatter: Record<string, string[]> = {
  paralegal: ['Filed. Indexed. Color-coded.', 'These folders won’t sort themselves.'],
  junior_associate: ['I found a precedent from 1912!', 'Coffee first. Then justice.'],
  office_manager: ['Billing closes at five, people.', 'Who moved my label maker?'],
  senior_associate: ['This motion needs one more pass.', 'Cite it or strike it.'],
  partner: ['Espresso, then the merger brief.', 'We settle from strength.'],
  rainmaker: ['Table at eight. Bring the retainer.', 'They called us. Remember that.'],
  private_investigator: ['The ledger doesn’t match the docks.', 'Everyone leaves a paper trail.'],
  crisis_commander: ['Status check. Every desk. Now.'],
  data_scientist: ['The pattern is in the appeals data.'],
  litigation_technologist: ['Discovery servers are humming.'],
}
const genericChatter = ['Back to the docket.', 'Another one for the win column.', 'Has anyone seen the stapler?', 'The client files are ready.']

function OfficeBackdrop({ game, previewTier, children }: OfficeSceneProps & { children?: React.ReactNode }) {
  const { play } = useSound()
  const tier = previewTier ?? game?.office_tier ?? 0
  const owned = useMemo(() => new Set(game?.owned_assets ?? []), [game?.owned_assets])
  const staff = (game?.catalog.assets ?? [])
    .filter((asset) => asset.type === 'staff' && owned.has(asset.key))
    .slice(-8)
    .map((asset) => ({ key: asset.key, ...staffProfileFor(asset) }))
  const activeClient = game?.catalog.clients.find((client) => client.key === game.active_client.effective_key)
  const clientKind = activeClient?.icon ?? 'briefcase'
  const clientProfile = clientPortraits[clientKind] ?? clientPortraits.briefcase
  const parallax = useParallax<HTMLDivElement>()

  const [catAwake, setCatAwake] = useState(false)
  const [cozyUntil, setCozyUntil] = useState(0)
  const cozy = cozyUntil > Date.now()
  const [chat, setChat] = useState<{ key: string; line: string } | null>(null)

  const petCat = useCallback(() => {
    void play('cat', { seed: game?.id ?? 'preview-office', intensity: .55 })
    setCatAwake(true)
    window.setTimeout(() => setCatAwake(false), 4200)
  }, [game?.id, play])
  const brewCoffee = useCallback(() => {
    void play('coffee', { seed: game?.id ?? 'preview-office', intensity: .48 })
    setCozyUntil(Date.now() + 45_000)
  }, [game?.id, play])

  const staffKeys = staff.map((member) => member.key).join(',')
  useEffect(() => {
    if (!staffKeys) return
    const keys = staffKeys.split(',')
    const speak = () => {
      const key = keys[Math.floor(Math.random() * keys.length)]
      const lines = staffChatter[key] ?? genericChatter
      setChat({ key, line: lines[Math.floor(Math.random() * lines.length)] })
      window.setTimeout(() => setChat(null), 5600)
    }
    const first = window.setTimeout(speak, 4000)
    const interval = window.setInterval(speak, 13_000)
    return () => { window.clearTimeout(first); window.clearInterval(interval) }
  }, [staffKeys])

  return (
    <div
      className={`av-office office-tier-${tier} ${cozy ? 'is-cozy' : ''}`}
      data-tier={tier}
      ref={parallax.ref}
      onPointerMove={parallax.onPointerMove}
      onPointerLeave={parallax.onPointerLeave}
    >
      <OfficeRoom tier={tier} owned={owned} />
      <div className="av-firm-sign"><strong>{game?.firm_name ?? 'COUNSEL & CO.'}</strong><span>ATTORNEYS AT LAW</span></div>
      {staff.map((member, index) => (
        <div
          className={`world-person npc-person npc-${member.key}`}
          key={member.key}
          style={{ left: `${member.x}%`, top: `${member.y}%`, ['--enter-delay' as string]: `${index * 90}ms` }}
        >
          {chat?.key === member.key && <span className="chatter-bubble">{chat.line}</span>}
          <Person src={staffArt(member.key)} label={member.role} />
          <span className="wp-label">{member.role}</span>
        </div>
      ))}
      <button type="button" className={`office-prop prop-cat ${catAwake ? 'is-awake' : ''}`} style={{ left: '7.5%', top: '92%' }} onClick={petCat} aria-label="The office cat">
        <img src={propArt(catAwake ? 'cat-awake' : 'cat-sleep')} alt="" draggable={false} />
        {catAwake
          ? <span className="prop-hearts" aria-hidden="true"><i>♥</i><i>♥</i><i>♥</i></span>
          : <span className="cat-zzz" aria-hidden="true">z</span>}
      </button>
      <button type="button" className={`office-prop prop-coffee ${cozy ? 'is-brewing' : ''}`} style={{ left: '93.5%', top: '90%' }} onClick={brewCoffee} aria-label="Brew a coffee for the team">
        <img src={propArt('coffee')} alt="" draggable={false} />
        <span className="prop-steam" aria-hidden="true"><i /><i /><i /></span>
      </button>
      <div className="cozy-glow" aria-hidden="true" />
      <div className={`world-person client-person world-client-${clientKind}`} style={{ left: '74%', top: '82%' }}>
        <div className="quest-bubble">!</div>
        <span className="av-client-token" style={{ ['--token-bg' as string]: clientProfile.bg }}>
          <Bust src={clientArt(clientKind)} backdrop="none" label={activeClient?.name ?? 'Waiting client'} />
        </span>
        <span className="wp-label">{clientProfile.title}</span>
      </div>
      {children}
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
  return (
    <aside className="av-character-panel" aria-label={`${game.lawyer_name}, your lawyer`}>
      <div className="av-hero-stage">
        <i className="av-hero-halo" />
        <img className="av-hero-img" src={playerArt(game.character_gender, game.office_tier)} alt="" draggable={false} />
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
  onCollect,
}: {
  game: GameState
  activeCase: boolean
  onCase: () => void
  onFirm: () => void
  onEmpire: () => void
  onStory: () => void
  onCollect: () => void
}) {
  const { play } = useSound()
  const zones = useMemo(() => [
    { key: 'case', x: 74, y: 76, label: activeCase ? 'Resume the active case' : 'Meet your waiting client', detail: `${game.active_client.name} · ${game.active_client.base_fee.toLocaleString()} base fee`, action: onCase },
    { key: 'firm', x: 15, y: 51, label: 'Manage the firm', detail: 'Upgrades · staff · clients', action: onFirm },
    { key: 'empire', x: 89, y: 48, label: 'Enter the empire map', detail: 'Explore offices and rivals', action: onEmpire },
    { key: 'story', x: 29, y: 34, label: 'Open the caseboard', detail: game.story.active_quest ? game.story.active_quest.title : 'Campaign · quests · rival intelligence', action: onStory },
    { key: 'retainers', x: 23, y: 82, label: 'Open the retainer safe', detail: `${game.passive_income.available.toLocaleString()} ready`, action: onCollect },
  ], [activeCase, game.active_client.base_fee, game.active_client.name, game.passive_income.available, game.story.active_quest, onCase, onCollect, onEmpire, onFirm, onStory])

  return (
    <div className="av-office-duo">
      <CharacterPanel game={game} />
      <div className="office-explorer game-viewport av-viewport" aria-label="Explorable law office">
        <OfficeBackdrop game={game}>
          {zones.map((zone) => (
            <button
              key={zone.key}
              className={`world-zone zone-${zone.key}`}
              style={{ left: `${zone.x}%`, top: `${zone.y}%` }}
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
  { key: 'city', scale: 'CITY MAP', name: 'THE CITY', districts: 'OLD QUARTER → FINANCIAL DISTRICT', detail: 'Street courts, civic halls and downtown towers', minTier: 0, maxTier: 4 },
  { key: 'nation', scale: 'NATIONAL MAP', name: 'THE NATION', districts: 'HARBOR EXCHANGE → MIDTOWN CROWN', detail: 'Regional branches and national headquarters', minTier: 5, maxTier: 6 },
  { key: 'world', scale: 'WORLD MAP', name: 'THE OPEN SEA', districts: 'EMBASSY ROW → SOVEREIGN ENCLAVE', detail: 'Global counsel sails aboard flagship firms', minTier: 7, maxTier: 9 },
  { key: 'continent', scale: 'CONTINENTAL MAP', name: 'THE CONTINENT', districts: 'INNOVATION ARC → AZURE COAST', detail: 'Continental campuses and oceanic citadels', minTier: 10, maxTier: 11 },
  { key: 'space', scale: 'PLANETARY MAP', name: 'BEYOND EARTH', districts: 'EARTH ORBIT → LUNAR GATE → JUSTICE NEXUS', detail: 'Stations, embassies and the justice constellation', minTier: 12, maxTier: 14 },
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

function sectionPosition(sectionKey: MapSection['key'], kind: 'tier' | 'rival', index: number): Position {
  const layout = siteLayouts[sectionKey]
  const list = kind === 'tier' ? layout.tier : layout.rival
  return list[index % list.length] ?? { x: 20 + index * 20, y: kind === 'tier' ? 60 : 26 }
}

export function EmpireWorldMap({ game, onManage }: { game: GameState; onManage: (tab: 'upgrades' | 'rivals') => void }) {
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
  const selectedPoint = points.find((point) => point.key === selected) ?? points[0]
  const selectedRivalProfile = selectedPoint.kind === 'rival' ? (rivalProfiles[selectedPoint.data.key] ?? rivalProfiles.neighborhood_practice) : null
  const activeSection = mapSections.find((section) => section.key === activeSectionKey) ?? mapSections[0]
  const hqSection = initialSection
  const parallax = useParallax<HTMLDivElement>()

  const jumpToSection = (section: MapSection) => {
    if (section.key !== activeSectionKey) void play('map', { seed: section.key, intensity: .42 })
    setActiveSectionKey(section.key)
    const sectionPoints = points.filter((point) => point.sectionKey === section.key)
    const currentSelection = sectionPoints.find((point) => point.key === selected)
    const currentHq = sectionPoints.find((point) => point.key === `tier-${game.office_tier}`)
    const destination = currentSelection ?? currentHq ?? sectionPoints[0]
    if (!destination) return
    setSelected(destination.key)
  }

  return (
    <div className="empire-map-shell av-map-shell">
      <nav className="map-section-nav" aria-label="Empire map sections">
        {mapSections.map((section, index) => {
          const siteCount = points.filter((point) => point.sectionKey === section.key).length
          return (
            <button
              type="button"
              className={`${activeSection.key === section.key ? 'active' : ''} ${hqSection.key === section.key ? 'contains-hq' : ''}`}
              aria-pressed={activeSection.key === section.key}
              onClick={() => jumpToSection(section)}
              key={section.key}
            >
              <small>{String(index + 1).padStart(2, '0')}</small>
              <span><strong>{section.name}</strong><em>{section.scale}</em></span>
              <b>{siteCount} SITES</b>
            </button>
          )
        })}
      </nav>
      <div className="empire-explorer game-viewport av-viewport" aria-label="Explorable legal empire map">
        <div
          className={`av-terrain av-terrain-${activeSection.key}`}
          key={activeSection.key}
          ref={parallax.ref}
          onPointerMove={parallax.onPointerMove}
          onPointerLeave={parallax.onPointerLeave}
        >
          <TerrainArt section={activeSection.key} />
          <div className="map-area-identity av-map-identity" aria-hidden="true">
            <small>{activeSection.scale}</small><strong>{activeSection.name}</strong><span>{activeSection.districts}</span><em>{activeSection.detail}</em>
          </div>
          {tierPoints.filter((point) => point.sectionKey === activeSection.key).map(({ data: tier, position }) => {
            const status = tier.tier < game.office_tier ? 'complete' : tier.tier === game.office_tier ? 'current' : 'future'
            return (
              <button
                className={`empire-node av-node tier-map-node ${status} ${selected === `tier-${tier.tier}` ? 'is-selected' : ''}`}
                key={tier.tier}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                onClick={() => {
                  const next = `tier-${tier.tier}`
                  if (selected !== next) void play('select', { seed: next, intensity: .3 })
                  setSelected(next)
                }}
                aria-label={`${tier.name}, tier ${tier.tier}, ${status}`}
              >
                <SiteArt kind="tier" tier={tier.tier} />
                <span><b>{tier.name}</b><small>TIER {tier.tier} · {status === 'complete' ? 'ESTABLISHED' : status === 'current' ? 'HEADQUARTERS' : 'FUTURE'}</small></span>
              </button>
            )
          })}
          {rivalPoints.filter((point) => point.sectionKey === activeSection.key).map(({ data: rival, position }) => {
            const profile = rivalProfiles[rival.key] ?? rivalProfiles.neighborhood_practice
            return (
              <button
                className={`empire-node av-node rival-map-node ${rival.owned ? 'owned' : ''} ${selected === `rival-${rival.key}` ? 'is-selected' : ''}`}
                key={rival.key}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                onClick={() => {
                  const next = `rival-${rival.key}`
                  if (selected !== next) void play('select', { seed: next, intensity: .3 })
                  setSelected(next)
                }}
                aria-label={`${rival.name.replace('Acquire ', '')}, ${rival.owned ? 'acquired' : 'rival firm'}`}
              >
                <SiteArt kind="rival" tier={rival.tier} architecture={profile.architecture} mark={profile.mark} owned={rival.owned} />
                <span><b>{rival.name.replace('Acquire ', '')}</b><small>{rival.owned ? 'ACQUIRED' : 'RIVAL FIRM'}</small></span>
              </button>
            )
          })}
          {activeSection.key === hqSection.key && (
            <div className="world-person map-player" style={{ left: `${Math.min(92, hqPoint.position.x + 7)}%`, top: `${Math.min(86, hqPoint.position.y + 1)}%` }}>
              <Person gender={game.character_gender} tier={game.office_tier} label={`${game.lawyer_name}, at headquarters`} />
            </div>
          )}
        </div>
        <div className="map-legend av-map-legend"><span><i className="legend-owned" />OWNED</span><span><i className="legend-current" />HQ</span><span><i className="legend-rival" />RIVAL</span></div>
        <div className="empire-inspector av-inspector">
          <span>{selectedPoint.kind === 'tier' ? 'FIRM DESTINATION' : 'ACQUISITION TARGET'}</span>
          <h2>{selectedPoint.data.name.replace('Acquire ', '')}</h2>
          <small className="inspector-region">{selectedPoint.data.region}</small>
          {selectedPoint.kind === 'rival' && selectedRivalProfile && (
            <div className="rival-owner-inspector av-owner-chip">
              <Bust src={ownerArt(selectedPoint.data.key)} backdrop="#1a2735" />
              <span><small>RIVAL OWNER</small><strong>{selectedRivalProfile.owner}</strong><i>{selectedRivalProfile.title}</i></span>
            </div>
          )}
          <p>{selectedPoint.kind === 'tier' ? selectedPoint.data.short : selectedPoint.data.description}</p>
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
