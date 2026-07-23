import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CharacterGender, GameAsset, GameState } from './types'

type OfficeSceneProps = {
  game?: GameState | null
  gender?: CharacterGender
  previewTier?: number
  className?: string
}

type Direction = 'up' | 'down' | 'left' | 'right'
type Position = { x: number; y: number }
type PersonAccessory = 'none' | 'files' | 'brief' | 'clipboard' | 'folio' | 'coffee' | 'phone' | 'briefcase' | 'shopping-bag' | 'tablet' | 'portfolio'

export type CharacterMood = 'happy' | 'unhappy' | 'neutral'

const skinTones = ['#d59a72', '#b87555', '#e0ad80', '#8f5b45', '#c98963', '#684333', '#f0c19a']
const hairTones = ['#30251f', '#5a3728', '#1d2933', '#70492d', '#241e29', '#b59665', '#17191d']
const staffColors = ['#8d3f64', '#315b70', '#5b4675', '#2d4f55', '#745032', '#5e3038', '#426045']
const heroJackets = ['#68513e', '#46576b', '#2e6158', '#245070', '#61364f', '#1b3149', '#161b29', '#183d48', '#202c52', '#4a285d', '#173f56', '#135063', '#273464', '#3b286b', '#171f4d']
const heroTies = ['#9b5b45', '#b95749', '#c58a42', '#b9ced5', '#dfad4f', '#e0b960', '#f0cc67', '#6ee0d0', '#78d7ef', '#e3bd67', '#65e2ff', '#89f0df', '#c5b2ff', '#f2c369', '#fff1a2']

function PixelPerson({
  gender = 'female',
  tier = 1,
  variant = 0,
  direction = 'down',
  walking = false,
  accessory = 'none',
  className = '',
  label,
}: {
  gender?: CharacterGender
  tier?: number
  variant?: number
  direction?: Direction
  walking?: boolean
  accessory?: PersonAccessory
  className?: string
  label?: string
}) {
  const visualTier = Math.max(0, Math.min(heroJackets.length - 1, tier))
  const jacket = variant === 0
    ? heroJackets[visualTier]
    : staffColors[(variant - 1) % staffColors.length]
  const skin = skinTones[variant % skinTones.length]
  const hair = hairTones[variant % hairTones.length]
  return (
    <div
      className={`pixel-person facing-${direction} ${walking ? 'is-walking' : ''} ${className}`}
      data-gender={gender}
      data-tier={tier}
      data-variant={variant % 7}
      data-hero={variant === 0 ? 'true' : undefined}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      <i className="pp-shadow" />
      <i className="pp-leg pp-leg-left" />
      <i className="pp-leg pp-leg-right" />
      <i className="pp-trouser-light pp-trouser-light-left" />
      <i className="pp-trouser-light pp-trouser-light-right" />
      <i className="pp-shoes" />
      <i className="pp-shoulders" style={{ backgroundColor: jacket }} />
      <i className="pp-body" style={{ backgroundColor: jacket }} />
      <i className="pp-hips" style={{ backgroundColor: jacket }} />
      <i className="pp-chest-contour" />
      {variant === 0 && tier >= 3 && <i className="pp-waistcoat" />}
      <i className="pp-shirt" />
      <i className="pp-collar pp-collar-left" />
      <i className="pp-collar pp-collar-right" />
      <i className="pp-tie" style={{ backgroundColor: variant === 0 ? heroTies[visualTier] : '#b95749' }} />
      <i className="pp-lapel pp-lapel-left" />
      <i className="pp-lapel pp-lapel-right" />
      <i className="pp-belt" />
      <i className="pp-buttons" />
      <i className="pp-pocket" />
      <i className="pp-arm pp-arm-left" style={{ backgroundColor: jacket }} />
      <i className="pp-arm pp-arm-right" style={{ backgroundColor: jacket }} />
      <i className="pp-cuff pp-cuff-left" />
      <i className="pp-cuff pp-cuff-right" />
      <i className="pp-hand pp-hand-left" style={{ backgroundColor: skin }} />
      <i className="pp-hand pp-hand-right" style={{ backgroundColor: skin }} />
      <i className="pp-neck" style={{ backgroundColor: skin }} />
      <i className={`pp-hair-back ${gender === 'female' ? 'long' : ''}`} style={{ backgroundColor: hair }} />
      <i className="pp-ear pp-ear-left" style={{ backgroundColor: skin }} />
      <i className="pp-ear pp-ear-right" style={{ backgroundColor: skin }} />
      <i className="pp-head" style={{ backgroundColor: skin }} />
      <i className="pp-face-light" />
      <i className="pp-jawline" />
      <i className={`pp-hair ${gender === 'female' ? 'long' : ''}`} style={{ backgroundColor: hair }} />
      <i className="pp-fringe" style={{ backgroundColor: hair }} />
      <i className="pp-hair-shine" />
      <i className="pp-eyes" />
      <i className="pp-pupils" />
      <i className="pp-lashes" />
      <i className="pp-brows" />
      <i className="pp-nose" />
      <i className="pp-mouth" />
      <i className="pp-lip-highlight" />
      <i className="pp-cheeks" />
      <i className="pp-earrings" />
      {accessory !== 'none' && <i className={`pp-accessory pp-accessory-${accessory}`}><b /><span /></i>}
      {tier >= 3 && variant === 0 && <i className="pp-watch" />}
      {tier >= 5 && variant === 0 && <i className="pp-pin" />}
      {tier >= 4 && variant === 0 && <i className="pp-pocket-square" />}
      {tier >= 6 && variant === 0 && <i className="pp-cufflinks" />}
    </div>
  )
}

const cutsceneCast: Record<string, { gender: CharacterGender; variant: number; accessory: PersonAccessory }> = {
  rainy_shack: { gender: 'female', variant: 5, accessory: 'briefcase' },
  market_showdown: { gender: 'female', variant: 1, accessory: 'folio' },
  city_hall_night: { gender: 'female', variant: 6, accessory: 'phone' },
  sterling_tower: { gender: 'male', variant: 6, accessory: 'portfolio' },
  midnight_exchange: { gender: 'female', variant: 6, accessory: 'phone' },
  continental_forum: { gender: 'female', variant: 5, accessory: 'briefcase' },
  orbital_hearing: { gender: 'female', variant: 2, accessory: 'tablet' },
  planetary_nexus: { gender: 'female', variant: 1, accessory: 'folio' },
}

export function CutsceneArtwork({ scene, game }: { scene: string; game: GameState }) {
  const speaker = cutsceneCast[scene] ?? cutsceneCast.rainy_shack
  return (
    <div className={`cutscene-art cutscene-${scene}`} role="img" aria-label={`Illustrated campaign scene: ${scene.replaceAll('_', ' ')}`}>
      <div className="cinema-sky"><i /><i /><i /><i /><i /><i /></div>
      <div className="cinema-city">{Array.from({ length: 11 }, (_, index) => <i key={index}><b /><b /><b /></i>)}</div>
      <div className="cinema-landmark"><i /><b /><span /></div>
      <div className="cinema-evidence">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div>
      <div className="cinema-orbit"><i /><b /><span /></div>
      <div className="cinema-floor" />
      <div className="cinema-cast cinema-speaker">
        <PixelPerson gender={speaker.gender} tier={Math.min(14, game.office_tier + 1)} variant={speaker.variant} accessory={speaker.accessory} label="Campaign character" />
      </div>
      <div className="cinema-cast cinema-player">
        <PixelPerson gender={game.character_gender} tier={game.office_tier} variant={0} accessory="brief" label={game.lawyer_name} />
      </div>
      <div className="cinema-rain">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
      <div className="cinema-light" />
      <div className="cinema-grain" />
    </div>
  )
}

const staffPortraits: Record<string, { gender: CharacterGender; tier: number; variant: number; prop: PersonAccessory; role: string; x: number; y: number }> = {
  paralegal: { gender: 'female', tier: 1, variant: 1, prop: 'files', role: 'MAYA · PARALEGAL', x: 25, y: 50 },
  junior_associate: { gender: 'male', tier: 2, variant: 2, prop: 'brief', role: 'THEO · ASSOCIATE', x: 59, y: 43 },
  office_manager: { gender: 'female', tier: 2, variant: 3, prop: 'clipboard', role: 'NINA · MANAGER', x: 34, y: 76 },
  senior_associate: { gender: 'female', tier: 3, variant: 4, prop: 'folio', role: 'AVERY · SENIOR', x: 65, y: 76 },
  partner: { gender: 'male', tier: 4, variant: 5, prop: 'coffee', role: 'JORDAN · PARTNER', x: 75, y: 51 },
  rainmaker: { gender: 'female', tier: 6, variant: 6, prop: 'phone', role: 'MORGAN · RAINMAKER', x: 51, y: 63 },
}

const staffProps: PersonAccessory[] = ['files', 'brief', 'clipboard', 'folio', 'coffee', 'phone', 'tablet', 'portfolio', 'briefcase']

function keyHash(key: string) {
  return [...key].reduce((total, character) => total + character.charCodeAt(0), 0)
}

function staffProfileFor(asset: GameAsset) {
  if (staffPortraits[asset.key]) return staffPortraits[asset.key]
  const hash = keyHash(asset.key)
  return {
    gender: (hash % 2 ? 'female' : 'male') as CharacterGender,
    tier: Math.min(6, asset.tier),
    variant: (hash % 6) + 1,
    prop: staffProps[hash % staffProps.length],
    role: asset.name.toUpperCase(),
    x: 18 + (hash % 7) * 10,
    y: 46 + (hash % 3) * 14,
  }
}

const clientPortraits: Record<string, { gender: CharacterGender; tier: number; variant: number; accessory: PersonAccessory; title: string }> = {
  briefcase: { gender: 'female', tier: 0, variant: 7, accessory: 'briefcase', title: 'WALK-IN' },
  home: { gender: 'male', tier: 1, variant: 1, accessory: 'portfolio', title: 'LOCAL REFERRAL' },
  store: { gender: 'female', tier: 2, variant: 2, accessory: 'shopping-bag', title: 'FOUNDER' },
  gem: { gender: 'male', tier: 3, variant: 3, accessory: 'phone', title: 'PRIVATE CLIENT' },
  building: { gender: 'female', tier: 4, variant: 4, accessory: 'tablet', title: 'GENERAL COUNSEL' },
  landmark: { gender: 'male', tier: 5, variant: 5, accessory: 'folio', title: 'NATIONAL BOARD' },
  globe: { gender: 'female', tier: 6, variant: 6, accessory: 'portfolio', title: 'GLOBAL CHAIR' },
  civic: { gender: 'female', tier: 3, variant: 2, accessory: 'files', title: 'CIVIC DIRECTOR' },
  hospitality: { gender: 'male', tier: 2, variant: 5, accessory: 'clipboard', title: 'HOSPITALITY GROUP' },
  property: { gender: 'female', tier: 4, variant: 3, accessory: 'tablet', title: 'CITY BUILDER' },
  health: { gender: 'male', tier: 4, variant: 1, accessory: 'files', title: 'HEALTH EXECUTIVE' },
  media: { gender: 'female', tier: 5, variant: 4, accessory: 'phone', title: 'STUDIO CHAIR' },
  tech: { gender: 'male', tier: 6, variant: 2, accessory: 'tablet', title: 'TECH FOUNDER' },
  sports: { gender: 'female', tier: 5, variant: 5, accessory: 'briefcase', title: 'LEAGUE COMMISSIONER' },
  energy: { gender: 'male', tier: 6, variant: 3, accessory: 'portfolio', title: 'GRID OPERATOR' },
  sovereign: { gender: 'female', tier: 6, variant: 6, accessory: 'folio', title: 'SOVEREIGN DIRECTOR' },
  bank: { gender: 'male', tier: 6, variant: 4, accessory: 'briefcase', title: 'CENTRAL BANKER' },
  quantum: { gender: 'female', tier: 6, variant: 2, accessory: 'tablet', title: 'QUANTUM CHAIR' },
  ocean: { gender: 'male', tier: 6, variant: 5, accessory: 'portfolio', title: 'OCEANIC COUNCIL' },
  orbit: { gender: 'female', tier: 6, variant: 3, accessory: 'tablet', title: 'ORBITAL DIRECTOR' },
  lunar: { gender: 'male', tier: 6, variant: 1, accessory: 'folio', title: 'LUNAR ENVOY' },
  nexus: { gender: 'female', tier: 6, variant: 6, accessory: 'portfolio', title: 'ASSEMBLY SPEAKER' },
}

const rivalProfiles: Record<string, { owner: string; title: string; gender: CharacterGender; tier: number; variant: number; mark: string; architecture: string }> = {
  neighborhood_practice: { owner: 'Eleanor Harrow', title: 'Founding partner', gender: 'female', tier: 2, variant: 1, mark: 'H&F', architecture: 'brick-house' },
  downtown_boutique: { owner: 'Lucien Vale', title: 'Trial strategist', gender: 'male', tier: 4, variant: 2, mark: 'V', architecture: 'art-deco' },
  regional_firm: { owner: 'Priya Nayar', title: 'Managing partner', gender: 'female', tier: 5, variant: 4, mark: '★', architecture: 'northstar' },
  national_competitor: { owner: 'Sebastian Sterling', title: 'Global chair', gender: 'male', tier: 6, variant: 6, mark: 'SG', architecture: 'mega-tower' },
  appellate_chambers: { owner: 'Inez Blackstone', title: 'Head of chambers', gender: 'female', tier: 3, variant: 3, mark: 'BC', architecture: 'gothic' },
  media_law_collective: { owner: 'Juno Gold', title: 'Creative partner', gender: 'female', tier: 4, variant: 5, mark: 'N+G', architecture: 'neon' },
  transatlantic_firm: { owner: 'Arthur Meridian', title: 'Atlantic chair', gender: 'male', tier: 6, variant: 2, mark: 'MA', architecture: 'glass-arc' },
  global_crisis_firm: { owner: 'Cass Redline', title: 'Crisis commander', gender: 'female', tier: 6, variant: 4, mark: 'R!', architecture: 'command' },
  sovereign_rival: { owner: 'Mina Crown', title: 'Sovereign counsel', gender: 'female', tier: 6, variant: 6, mark: 'CM', architecture: 'citadel' },
  continental_rival: { owner: 'Atlas Okafor', title: 'Continental chair', gender: 'male', tier: 6, variant: 3, mark: 'AJ', architecture: 'campus' },
  oceanic_rival: { owner: 'Kai Pelagic', title: 'Oceanic founder', gender: 'male', tier: 6, variant: 5, mark: 'PP', architecture: 'ocean' },
  orbital_rival: { owner: 'Yara Zenith', title: 'Orbital managing partner', gender: 'female', tier: 6, variant: 2, mark: 'ZO', architecture: 'orbital' },
  lunar_rival: { owner: 'Remy Selene', title: 'Lunar accord keeper', gender: 'male', tier: 6, variant: 4, mark: 'SA', architecture: 'lunar' },
  planetary_rival: { owner: 'Apex Council', title: 'Network stewards', gender: 'female', tier: 6, variant: 6, mark: 'AX', architecture: 'nexus' },
}

function UpgradeArtwork({ asset }: { asset: GameAsset }) {
  const assetKey = asset.key
  if (assetKey === 'repaired_desk') return (
    <div className="asset-vignette scene-desk">
      <i className="pixel-window-mini" /><i className="desk-picture" />
      <div className="oak-desk"><i /><i /><i /><b /></div>
      <div className="desk-hammer"><i /><b /></div><span className="sawdust"><i /><i /><i /><i /></span>
    </div>
  )
  if (assetKey === 'proper_lighting') return (
    <div className="asset-vignette scene-lighting">
      <div className="light-rays"><i /><i /><i /></div><div className="floor-lamp"><i /><b /><span /></div>
      <div className="reading-chair"><i /><b /></div><span className="light-motes"><i /><i /><i /></span>
    </div>
  )
  if (assetKey === 'case_management') return (
    <div className="asset-vignette scene-cases">
      <div className="case-monitor"><span><i /><i /><i /></span><b /></div>
      <div className="file-stack"><i /><i /><i /><i /></div><div className="case-keyboard"><i /><i /><i /><i /><i /></div>
      <span className="data-pips"><i /><i /><i /></span>
    </div>
  )
  if (assetKey === 'legal_library') return (
    <div className="asset-vignette scene-library">
      <div className="library-case"><span><i /><i /><i /><i /><i /></span><span><i /><i /><i /><i /><i /></span><b /></div>
      <div className="library-ladder"><i /><i /><i /></div><div className="flying-page"><i /></div>
    </div>
  )
  if (assetKey === 'conference_room') return (
    <div className="asset-vignette scene-conference">
      <div className="conference-window"><i /><i /><i /></div><div className="conference-mini-table"><i /><b /><b /><span /><span /></div>
      <div className="conference-chairs"><i /><i /><i /><i /></div><div className="coffee-steam"><i /><i /></div>
    </div>
  )
  if (assetKey === 'research_floor') return (
    <div className="asset-vignette scene-research">
      <div className="research-server"><i /><i /><i /><i /><i /></div><div className="research-screen"><span /><b /><i /><i /></div>
      <div className="research-desk"><i /></div><span className="signal-pulse"><i /><i /><i /></span>
    </div>
  )
  if (assetKey !== 'executive_suite') return (
    <div className={`asset-vignette scene-mega-upgrade upgrade-visual-${asset.art || 'future'}`}>
      <div className="mega-upgrade-sky"><i /><i /><i /><b /></div>
      <div className="mega-upgrade-platform"><i /><i /><i /><i /><span /></div>
      <div className="mega-upgrade-core"><i /><b /><span>{asset.tier >= 12 ? '✦' : asset.tier >= 8 ? '◇' : '§'}</span></div>
      <div className="mega-upgrade-console"><i /><i /><i /><b /></div>
      <div className="mega-upgrade-particles">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div>
      <strong>{asset.art?.replace('-', ' ') || 'FUTURE SYSTEM'}</strong>
    </div>
  )
  return (
    <div className="asset-vignette scene-executive">
      <div className="executive-skyline"><i /><i /><i /><i /><i /></div><div className="executive-desk"><i /><b /><span /></div>
      <div className="executive-chair"><i /><b /></div><div className="executive-globe"><i /><b /></div>
    </div>
  )
}

function StaffArtwork({ asset }: { asset: GameAsset }) {
  const portrait = staffProfileFor(asset)
  return (
    <div className={`asset-vignette scene-staff staff-${portrait.prop}`}>
      <div className="staff-office-window"><i /><i /><i /></div><div className="staff-rug" />
      <PixelPerson gender={portrait.gender} tier={portrait.tier} variant={portrait.variant} accessory={portrait.prop} walking label={asset.name} />
      <div className="staff-prop"><i /><b /><span /></div><span className="staff-sparkles"><i /><i /><i /></span>
    </div>
  )
}

function ConnectionArtwork({ asset }: { asset: GameAsset }) {
  const assetKey = asset.key
  const nodes = Math.min(9, 3 + Math.floor(asset.tier / 2))
  return (
    <div className={`asset-vignette scene-network network-${nodes}`}>
      <div className="network-map"><i /><i /><i /></div><div className="network-lines"><i /><i /><i /><i /><i /></div>
      <div className="network-hub"><span>{asset.tier >= 12 ? '☾' : asset.tier >= 7 ? '✦' : assetKey === 'board_network' ? '§' : '⚖'}</span><i /></div>
      <div className="network-nodes">{Array.from({ length: nodes }, (_, index) => <i key={index}><b /></i>)}</div>
      <span className="network-packet"><i /></span>
    </div>
  )
}

function RivalArtwork({ asset, owned }: { asset: GameAsset; owned: boolean }) {
  const profile = rivalProfiles[asset.key] ?? rivalProfiles.neighborhood_practice
  const rank = Math.min(4, Math.max(1, Math.ceil((asset.tier + 1) / 4)))
  return (
    <div className={`asset-vignette scene-rival rival-rank-${rank} rival-${asset.key} rival-${profile.architecture}`}>
      <div className="rival-card-sky"><i /><i /><i /></div><div className="rival-card-building"><span>{owned ? '✓' : profile.mark}</span><i /><i /><i /><i /><b /></div>
      <div className="rival-flag"><i /><b /></div><span className="rival-smoke-mini"><i /><i /><i /></span>
      <div className="rival-briefcase"><i /></div>
      <div className="rival-card-owner"><PixelPerson gender={profile.gender} tier={profile.tier} variant={profile.variant} accessory="briefcase" /><span>{profile.owner}<small>{profile.title}</small></span></div>
    </div>
  )
}

export function PixelAssetArtwork({ asset }: { asset: GameAsset }) {
  const state = asset.owned ? 'owned' : asset.available ? 'available' : 'locked'
  return (
    <div className={`pixel-asset-art asset-${asset.type} asset-${state} art-${asset.key}`} role="img" aria-label={`${asset.name} illustrated upgrade`}>
      <div className="asset-art-sky"><i /><i /><i /></div>
      {asset.type === 'upgrade' && <UpgradeArtwork asset={asset} />}
      {asset.type === 'staff' && <StaffArtwork asset={asset} />}
      {asset.type === 'connection' && <ConnectionArtwork asset={asset} />}
      {asset.type === 'rival' && <RivalArtwork asset={asset} owned={asset.owned} />}
      <div className="asset-art-floor" /><div className="asset-art-shine" /><div className="asset-art-scanlines" />
      {state === 'locked' && <div className="asset-art-lock"><i /><span>?</span></div>}
      <span className="asset-art-label">{asset.type === 'upgrade' ? 'OFFICE UPGRADE' : asset.type === 'staff' ? 'TEAM MEMBER' : asset.type === 'connection' ? 'NEW CONTACTS' : 'ACQUISITION'}</span>
    </div>
  )
}

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
    <div className={`client-portrait pixel-portrait client-${kind} mood-${mood} ${className}`} aria-label={`${name}, ${profile.title.toLowerCase()}, ${mood}`} role="img">
      <div className="portrait-skyline"><i /><i /><i /></div>
      <PixelPerson gender={profile.gender} tier={profile.tier} variant={profile.variant} accessory={profile.accessory} />
      <b>{['globe', 'orbit', 'lunar', 'nexus', 'quantum'].includes(kind) ? '✦' : name.slice(0, 1)}</b>
      <small>{profile.title}</small>
    </div>
  )
}

export function JudgePortrait({ thinking = false, pleased = false }: { thinking?: boolean; pleased?: boolean }) {
  return (
    <div className={`judge-portrait pixel-judge ${thinking ? 'is-thinking' : ''} ${pleased ? 'is-pleased' : ''}`} aria-hidden="true">
      <div className="judge-wig"><i /><i /><i /><i /><i /></div>
      <PixelPerson gender="female" tier={6} variant={3} />
      <div className="judge-gavel"><span /><b /></div>
      <div className="judge-pixels">{pleased ? '✓' : thinking ? '…' : '§'}</div>
    </div>
  )
}

function useWalker(initial: Position, bounds: { left: number; right: number; top: number; bottom: number }) {
  const [position, setPosition] = useState(initial)
  const [direction, setDirection] = useState<Direction>('down')
  const [walking, setWalking] = useState(false)
  const stopTimer = useRef<number | null>(null)

  const nudge = useCallback((nextDirection: Direction) => {
    const amount = 2.6
    setDirection(nextDirection)
    setWalking(true)
    setPosition((current) => ({
      x: Math.max(bounds.left, Math.min(bounds.right, current.x + (nextDirection === 'left' ? -amount : nextDirection === 'right' ? amount : 0))),
      y: Math.max(bounds.top, Math.min(bounds.bottom, current.y + (nextDirection === 'up' ? -amount : nextDirection === 'down' ? amount : 0))),
    }))
    if (stopTimer.current) window.clearTimeout(stopTimer.current)
    stopTimer.current = window.setTimeout(() => setWalking(false), 130)
  }, [bounds.bottom, bounds.left, bounds.right, bounds.top])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      const keyMap: Record<string, Direction> = {
        ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
        ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
      }
      const nextDirection = keyMap[event.key]
      if (!nextDirection) return
      event.preventDefault()
      nudge(nextDirection)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [nudge])

  useEffect(() => () => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current)
  }, [])

  return { position, setPosition, direction, walking, nudge }
}

function PixelWindow({ tier }: { tier: number }) {
  return (
    <div className={`pixel-window skyline-tier-${tier}`}>
      <div className="pixel-moon" />
      <div className="pixel-sun" />
      <div className="pixel-cloud cloud-one" /><div className="pixel-cloud cloud-two" />
      <div className="window-buildings">
        {[2, 4, 3, 6, 4, 5, 3].map((height, index) => (
          <i key={index} style={{ height: `${height * 9 + 10}%` }}><b /><b /><b /></i>
        ))}
      </div>
      {tier === 0 && <div className="pixel-rain">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>}
    </div>
  )
}

function OfficeTierDecor({ tier }: { tier: number }) {
  return (
    <div className={`office-tier-decor office-tier-decor-${tier}`} aria-hidden="true">
      {tier === 0 && <><div className="shack-rafters"><i /><i /><i /></div><div className="roof-leak"><i /><b /></div><div className="moving-boxes"><i /><i /><span>FILES</span></div></>}
      {tier === 1 && <><div className="shared-divider"><i /><i /><i /></div><div className="coat-rack"><i /><b /><span /></div><div className="first-nameplate">YOUR NAME, ESQ.</div></>}
      {tier === 2 && <><div className="storefront-awning"><i /><i /><i /><i /><i /></div><div className="neighborhood-board"><span>COMMUNITY</span><i /><i /><i /></div></>}
      {tier === 3 && <><div className="downtown-columns"><i /><i /></div><div className="downtown-art"><i /><b /><span /></div><div className="city-directory">SUITE 1800</div></>}
      {tier === 4 && <><div className="power-statue"><i>§</i><b /><span /></div><div className="marble-inlay"><i /><i /></div><div className="press-wall"><span>VERDICTS</span><i>★</i><i>★</i><i>★</i></div></>}
      {tier === 5 && <><div className="national-map-wall"><span>NATIONAL OFFICES</span>{Array.from({ length: 7 }, (_, index) => <i key={index} />)}<b /><b /></div><div className="branch-ticker">NYC · LA · CHI · DC · SEA</div></>}
      {tier >= 6 && <><div className="world-clocks"><span>NEW YORK</span><span>LONDON</span><span>TOKYO</span><i /><i /><i /></div><div className="global-hologram"><i /><b /><span>GLOBAL</span></div><div className="empire-crest">LT<i>✦</i></div></>}
      {tier >= 7 && <div className="sky-command-ribbon"><i /><i /><i /><span>{tier >= 12 ? 'ORBITAL LINK' : 'LIVE GLOBAL DOCKET'}</span></div>}
      {tier >= 9 && <div className="treaty-orbit"><i /><i /><i /><b /><span>ACCORD NETWORK</span></div>}
      {tier >= 10 && <div className="autonomous-office-core"><i /><i /><i /><b>AI</b><span>AUDITED CASE CORE</span></div>}
      {tier >= 12 && <div className="orbital-window-frame"><i /><i /><i /><b /></div>}
      {tier >= 13 && <div className="lunar-horizon"><i /><b /><span>LUNAR GATE</span></div>}
      {tier >= 14 && <div className="justice-constellation">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}<b>PLANETARY NEXUS</b></div>}
    </div>
  )
}

function OfficeFurniture({ tier, owned }: { tier: number; owned: Set<string> }) {
  return (
    <>
      <div className="wall-molding"><i /><i /><i /><i /><i /><i /></div>
      <div className="wall-diplomas"><i>JD</i><i>BAR</i><i>★</i></div>
      <div className="case-pinboard"><span>DOCKET</span>{Array.from({ length: 6 }, (_, index) => <i key={index} />)}<b /></div>
      <div className="ceiling-lights"><i /><i /><i /></div>
      <div className="light-shafts"><i /><i /><i /></div>
      <div className="office-rug"><i /><i /><i /></div>
      <div className="pixel-bookcase">
        <span>LAW</span>
        <div>{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</div>
      </div>
      <div className={`pixel-desk main-desk ${owned.has('repaired_desk') || tier >= 1 ? 'desk-restored' : 'desk-battered'}`}><div className="desk-lamp"><i /></div><div className="paper-stack"><i /><i /><i /></div><div className="desk-screen">LT</div><div className="pixel-keyboard">······</div><div className="desk-phone"><i /><b /></div><div className="coffee-mug"><i /></div><div className="open-case-file"><i /><b /></div></div>
      <div className="pixel-desk reception-desk"><span>RECEPTION</span><i /><b className="desk-bell" /></div>
      <div className="filing-cabinets"><i /><i /><i /></div>
      <div className="pixel-safe"><i>$</i></div>
      <div className="water-cooler"><i /><b /></div>
      <div className="office-plant plant-one"><i /><i /><i /><b /></div>
      {tier >= 2 && <div className="conference-table"><i /><i /><i /><i /><span /></div>}
      {(owned.has('case_management') || tier >= 2) && <div className="printer"><i /><b /></div>}
      {tier >= 4 && <div className="trophy-case">{Array.from({ length: 3 }, (_, index) => <i key={index}>★</i>)}</div>}
      {(owned.has('legal_library') || tier >= 2) && <div className="earned-upgrade earned-library"><span>LEGAL ARCHIVE</span><i /><i /><i /><i /><i /></div>}
      {(owned.has('research_floor') || tier >= 4) && <div className="earned-upgrade earned-research"><span>RESEARCH</span><i /><i /><i /></div>}
      {(owned.has('executive_suite') || tier >= 5) && <div className="earned-upgrade earned-executive"><i>★</i><span>PARTNERS</span></div>}
      {(owned.has('jury_simulator') || tier >= 6) && <div className="earned-upgrade earned-jury"><i /><i /><i /><span>JURY SIM</span></div>}
      {(owned.has('global_crisis_center') || tier >= 9) && <div className="earned-upgrade earned-crisis"><i>!</i><span>CRISIS GRID</span></div>}
      {(owned.has('orbital_hearing_ring') || tier >= 12) && <div className="earned-upgrade earned-orbital"><i /><b /><span>ORBITAL COURT</span></div>}
      <div className="map-elevator"><span>EMPIRE</span><i /><b /></div>
      <div className="office-clock"><i /><b /></div>
      <div className="desk-chair chair-main"><i /><b /></div><div className="desk-chair chair-reception"><i /><b /></div>
      <div className="file-cart"><i /><i /><i /><b /></div>
      <div className="floor-cable"><i /><i /></div>
      {tier === 0 && <div className="old-radiator"><i /><i /><i /><i /><b /></div>}
    </>
  )
}

function OfficeBackdrop({ game, gender = 'female', previewTier, children }: OfficeSceneProps & { children?: React.ReactNode }) {
  const tier = previewTier ?? game?.office_tier ?? 0
  const owned = useMemo(() => new Set(game?.owned_assets ?? []), [game?.owned_assets])
  const staff = (game?.catalog.assets ?? [])
    .filter((asset) => asset.type === 'staff' && owned.has(asset.key))
    .slice(-10)
    .map((asset) => ({ key: asset.key, ...staffProfileFor(asset) }))
  const activeClient = game?.catalog.clients.find((client) => client.key === game.active_client.effective_key)
  const clientProfile = clientPortraits[activeClient?.icon ?? 'briefcase'] ?? clientPortraits.briefcase
  const upgradeClasses = [
    owned.has('proper_lighting') && 'has-proper-lighting',
    owned.has('case_management') && 'has-case-management',
    owned.has('conference_room') && 'has-conference-room',
    owned.has('research_floor') && 'has-research-floor',
    owned.has('executive_suite') && 'has-executive-suite',
    tier >= 8 && 'has-global-command',
    tier >= 12 && 'has-orbital-command',
  ].filter(Boolean).join(' ')

  return (
    <div className={`pixel-office-world office-tier-${tier} ${upgradeClasses}`} data-tier={tier}>
      <div className="office-back-wall" />
      <PixelWindow tier={tier} />
      <OfficeTierDecor tier={tier} />
      <div className="firm-wall-sign"><strong>{game?.firm_name ?? 'COUNSEL & CO.'}</strong><span>ATTORNEYS AT LAW</span></div>
      <OfficeFurniture tier={tier} owned={owned} />
      {staff.map((member) => (
        <div className={`world-person npc-person npc-${member.key}`} key={member.key} style={{ left: `${member.x}%`, top: `${member.y}%` }}>
          <i className={`npc-status npc-status-${member.variant}`}>{member.variant === 1 ? '⌕' : member.variant === 2 ? '⌨' : member.variant === 3 ? '§' : '★'}</i>
          <PixelPerson gender={member.gender} tier={member.tier} variant={member.variant} accessory={member.prop} label={member.role} />
          <span>{member.role}</span>
        </div>
      ))}
      <div className={`world-person client-person world-client-${activeClient?.icon ?? 'briefcase'}`} style={{ left: '81%', top: '72%' }}>
        <div className="quest-bubble">!</div>
        <PixelPerson gender={clientProfile.gender} tier={clientProfile.tier} variant={clientProfile.variant} accessory={clientProfile.accessory} label={activeClient?.name ?? 'Waiting client'} />
        <span>{clientProfile.title}</span>
      </div>
      {!children && (
        <div className="world-person preview-lawyer" style={{ left: '51%', top: '70%' }}>
          <PixelPerson gender={game?.character_gender ?? gender} tier={tier} variant={0} label="Your lawyer" />
        </div>
      )}
      {children}
      <div className="office-cat"><i /><b /><span /></div>
      <div className="floating-pages"><i>§</i><i>¶</i><i>•</i></div>
      <div className="ambient-pixels">{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</div>
      <div className="office-bokeh"><i /><i /><i /><i /><i /></div>
      <div className="foreground-shadow left-shadow" /><div className="foreground-shadow right-shadow" />
      <div className="scanlines" />
      <div className="scene-caption"><span>FIRM TIER {tier}</span><strong>{game?.office.name ?? (tier === 0 ? 'Wooden Shack' : 'Future Headquarters')}</strong></div>
    </div>
  )
}

export function OfficeScene(props: OfficeSceneProps) {
  return <div className={`office-scene pixel-scene ${props.className ?? ''}`}><OfficeBackdrop {...props} /></div>
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
  const walker = useWalker({ x: 51, y: 79 }, { left: 5, right: 94, top: 31, bottom: 87 })
  const zones = useMemo(() => [
    { key: 'case', x: 79, y: 69, label: activeCase ? 'Resume the active case' : 'Meet your waiting client', detail: `${game.active_client.name} · ${game.active_client.base_fee.toLocaleString()} base fee`, action: onCase },
    { key: 'firm', x: 15, y: 51, label: 'Manage the firm', detail: 'Upgrades · staff · clients', action: onFirm },
    { key: 'empire', x: 90, y: 36, label: 'Enter the empire map', detail: 'Explore offices and rivals', action: onEmpire },
    { key: 'story', x: 33, y: 33, label: 'Open the caseboard', detail: game.story.active_quest ? game.story.active_quest.title : 'Campaign · quests · rival intelligence', action: onStory },
    { key: 'retainers', x: 49, y: 31, label: 'Open the retainer safe', detail: `${game.passive_income.available.toLocaleString()} ready`, action: onCollect },
  ], [activeCase, game.active_client.base_fee, game.active_client.name, game.passive_income.available, game.story.active_quest, onCase, onCollect, onEmpire, onFirm, onStory])
  const activeZone = zones.find((zone) => Math.hypot((walker.position.x - zone.x) * 1.2, walker.position.y - zone.y) < 12)

  useEffect(() => {
    const interact = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || !activeZone) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      activeZone.action()
    }
    window.addEventListener('keydown', interact)
    return () => window.removeEventListener('keydown', interact)
  }, [activeZone])

  return (
    <div className="office-explorer game-viewport" aria-label="Explorable law office">
      <OfficeBackdrop game={game}>
        {zones.map((zone) => (
          <button
            key={zone.key}
            className={`world-zone zone-${zone.key} ${activeZone?.key === zone.key ? 'is-near' : ''}`}
            style={{ left: `${zone.x}%`, top: `${zone.y}%` }}
            onClick={zone.action}
            aria-label={`${zone.label}. ${zone.detail}`}
          >
            <i />
            <span><b>{zone.label}</b><small>{zone.detail}</small></span>
          </button>
        ))}
        <div className="world-person player-person" style={{ left: `${walker.position.x}%`, top: `${walker.position.y}%` }}>
          <PixelPerson gender={game.character_gender} tier={game.office_tier} direction={walker.direction} walking={walker.walking} label={`${game.lawyer_name}, player character`} />
          <span>{game.lawyer_name.split(' ')[0]}</span>
        </div>
      </OfficeBackdrop>
      <div className="world-objective">
        <span>ACTIVE QUEST</span>
        <strong>{activeCase ? 'Finish your argument' : 'A client is waiting'}</strong>
        <small>Walk to the <b>!</b> or click it to begin.</small>
      </div>
      <div className={`interaction-toast ${activeZone ? 'visible' : ''}`}>
        <kbd>E</kbd><span><strong>{activeZone?.label ?? 'Explore the office'}</strong><small>{activeZone?.detail ?? 'Move near a glowing marker'}</small></span>
      </div>
      <WorldControls nudge={walker.nudge} />
    </div>
  )
}

function WorldControls({ nudge }: { nudge: (direction: Direction) => void }) {
  return (
    <div className="world-controls" aria-label="Movement controls">
      <span>MOVE</span>
      <button onClick={() => nudge('up')} aria-label="Move up">▲</button>
      <button onClick={() => nudge('left')} aria-label="Move left">◀</button>
      <button onClick={() => nudge('down')} aria-label="Move down">▼</button>
      <button onClick={() => nudge('right')} aria-label="Move right">▶</button>
      <small>WASD / ARROWS</small>
    </div>
  )
}

const mapSections = [
  { key: 'city', scale: 'CITY MAP', name: 'THE CITY', districts: 'OLD QUARTER → FINANCIAL DISTRICT', detail: 'Street courts, civic halls and downtown towers', minTier: 0, maxTier: 4 },
  { key: 'nation', scale: 'NATIONAL MAP', name: 'THE NATION', districts: 'HARBOR EXCHANGE → MIDTOWN CROWN', detail: 'Regional branches and national headquarters', minTier: 5, maxTier: 6 },
  { key: 'world', scale: 'WORLD MAP', name: 'THE WORLD', districts: 'EMBASSY ROW → SOVEREIGN ENCLAVE', detail: 'International, global and sovereign counsel', minTier: 7, maxTier: 9 },
  { key: 'continent', scale: 'CONTINENTAL MAP', name: 'THE CONTINENT', districts: 'INNOVATION ARC → AZURE COAST', detail: 'Continental campuses and oceanic cities', minTier: 10, maxTier: 11 },
  { key: 'space', scale: 'PLANETARY MAP', name: 'BEYOND EARTH', districts: 'EARTH ORBIT → LUNAR GATE → JUSTICE NEXUS', detail: 'Orbital, lunar and planetary law', minTier: 12, maxTier: 14 },
] as const

type MapSection = (typeof mapSections)[number]

function mapSectionForTier(tier: number): MapSection {
  return mapSections.find((section) => tier >= section.minTier && tier <= section.maxTier) ?? mapSections[0]
}

const tierSectionLayouts: Record<number, Position[]> = {
  2: [{ x: 31, y: 70 }, { x: 68, y: 48 }],
  3: [{ x: 23, y: 72 }, { x: 50, y: 47 }, { x: 77, y: 70 }],
  5: [{ x: 13, y: 76 }, { x: 31, y: 53 }, { x: 49, y: 76 }, { x: 67, y: 48 }, { x: 84, y: 72 }],
}

const rivalSectionLayouts: Record<number, Position[]> = {
  2: [{ x: 29, y: 27 }, { x: 73, y: 25 }],
  3: [{ x: 20, y: 27 }, { x: 51, y: 23 }, { x: 81, y: 31 }],
  4: [{ x: 14, y: 28 }, { x: 38, y: 20 }, { x: 63, y: 27 }, { x: 85, y: 21 }],
}

function sectionPosition(kind: 'tier' | 'rival', index: number, count: number): Position {
  const layouts = kind === 'tier' ? tierSectionLayouts : rivalSectionLayouts
  return layouts[count]?.[index] ?? { x: 18 + (index % 4) * 22, y: kind === 'tier' ? 68 : 25 }
}

function PixelBuilding({ tier, locked }: { tier: number; locked: boolean }) {
  const floors = Math.min(8, tier + 2)
  return (
    <div className={`map-building building-${tier} building-era-${Math.min(4, Math.floor(tier / 3))} ${locked ? 'locked' : ''}`}>
      <div className="building-antenna"><i /><b /></div>
      <div className="building-roof">{tier >= 4 && <i />}{tier >= 2 && <b />}</div>
      <div className="building-face">
        {Array.from({ length: floors * 3 }, (_, index) => <i key={index} />)}
      </div>
      <div className="building-sign">{tier >= 12 ? '✦' : tier >= 5 ? 'LT' : '§'}</div>
      <div className="building-awning"><i /><i /><i /></div>
      <div className="building-door" />
      <div className="building-flag"><i /></div>
    </div>
  )
}

function RivalHeadquarters({ assetKey, owned }: { assetKey: string; owned: boolean }) {
  const profile = rivalProfiles[assetKey] ?? rivalProfiles.neighborhood_practice
  return (
    <div className={`rival-hq rival-hq-${profile.architecture} ${owned ? 'is-acquired' : ''}`} aria-hidden="true">
      <div className="rhq-smoke"><i /><i /></div>
      <div className="rhq-roof"><i /><b /></div>
      <div className="rhq-body">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}<b /></div>
      <div className="rhq-sign">{owned ? '✓' : profile.mark}</div>
      <div className="rhq-landmark"><i /><b /><span /></div>
    </div>
  )
}

export function EmpireWorldMap({ game, onManage }: { game: GameState; onManage: (tab: 'upgrades' | 'rivals') => void }) {
  const rivals = game.catalog.assets.filter((asset) => asset.type === 'rival')
  const tierPoints = mapSections.flatMap((section) => {
    const tiers = game.catalog.tiers.filter((tier) => tier.tier >= section.minTier && tier.tier <= section.maxTier)
    return tiers.map((tier, index) => ({ key: `tier-${tier.tier}`, kind: 'tier' as const, sectionKey: section.key, position: sectionPosition('tier', index, tiers.length), data: tier }))
  })
  const rivalPoints = mapSections.flatMap((section) => {
    const sectionRivals = rivals.filter((rival) => rival.tier >= section.minTier && rival.tier <= section.maxTier)
    return sectionRivals.map((rival, index) => ({ key: `rival-${rival.key}`, kind: 'rival' as const, sectionKey: section.key, position: sectionPosition('rival', index, sectionRivals.length), data: rival }))
  })
  const points = [...tierPoints, ...rivalPoints]
  const initialSection = mapSectionForTier(game.office_tier)
  const initialPoint = tierPoints.find((point) => point.key === `tier-${game.office_tier}`) ?? tierPoints[0]
  const initial = initialPoint.position
  const walker = useWalker({ x: initial.x, y: Math.min(86, initial.y + 10) }, { left: 4, right: 96, top: 12, bottom: 89 })
  const [selected, setSelected] = useState(`tier-${game.office_tier}`)
  const [activeSectionKey, setActiveSectionKey] = useState<MapSection['key']>(initialSection.key)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const activePoints = points.filter((point) => point.sectionKey === activeSectionKey)
  const nearby = activePoints.find((point) => Math.hypot((walker.position.x - point.position.x) * 1.15, walker.position.y - point.position.y) < 11)
  const selectedPoint = points.find((point) => point.key === selected) ?? points[0]
  const selectedRivalProfile = selectedPoint.kind === 'rival' ? (rivalProfiles[selectedPoint.data.key] ?? rivalProfiles.neighborhood_practice) : null
  const activeSection = mapSections.find((section) => section.key === activeSectionKey) ?? mapSections[0]
  const hqSection = initialSection

  const jumpToSection = (section: MapSection) => {
    setActiveSectionKey(section.key)
    const sectionPoints = points.filter((point) => point.sectionKey === section.key)
    const currentSelection = sectionPoints.find((point) => point.key === selected)
    const currentHq = sectionPoints.find((point) => point.key === `tier-${game.office_tier}`)
    const destination = currentSelection ?? currentHq ?? sectionPoints[0]
    if (!destination) return
    setSelected(destination.key)
    walker.setPosition({ x: destination.position.x, y: Math.min(86, destination.position.y + 10) })
  }

  useEffect(() => {
    const interact = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || !nearby) return
      event.preventDefault()
      setSelected(nearby.key)
    }
    window.addEventListener('keydown', interact)
    return () => window.removeEventListener('keydown', interact)
  }, [nearby])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return
    scroller.scrollTo({ left: (walker.position.x / 100) * scroller.scrollWidth - scroller.clientWidth / 2, behavior: 'auto' })
  }, [activeSectionKey, walker.position.x])

  return (
    <div className="empire-map-shell">
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
      <div className="empire-explorer game-viewport" aria-label="Explorable legal empire map">
      <div className="empire-map-scroll" ref={scrollRef}>
      <div className={`empire-terrain map-world-${activeSection.key}`}>
        <div className="map-area-identity" aria-hidden="true">
          <small>{activeSection.scale}</small><strong>{activeSection.name}</strong><span>{activeSection.districts}</span><em>{activeSection.detail}</em>
        </div>
        {activeSection.key === 'city' && <><div className="map-park park-one">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</div><div className="map-road road-a" /><div className="map-road road-c" /><div className="map-streetlights">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div><div className="map-fountain"><i /><b /><span /></div><div className="map-courthouse"><i /><i /><i /><b>§</b><span>CIVIC COURT</span></div></>}
        {activeSection.key === 'nation' && <><div className="map-water"><i /><span className="map-boat">▰</span></div><div className="map-road road-a" /><div className="map-road road-b" /><div className="map-bridge"><i /><i /><i /><i /></div><div className="map-rail"><span /><span /><span /><span /><span /><span /><div className="map-train"><i /><i /></div></div><div className="map-harbor-cranes"><i /><i /><b /><span /></div><div className="map-airport"><i /><b /><span>LEGAL AIR</span></div></>}
        {activeSection.key === 'world' && <><div className="map-water"><i /><i /><span className="map-boat">▰</span></div><div className="map-bridge"><i /><i /><i /><i /></div><div className="map-airport"><i /><b /><span>GLOBAL AIR</span></div></>}
        {activeSection.key === 'continent' && <><div className="map-water"><i /><i /></div><div className="map-park park-two">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div><div className="map-harbor-cranes"><i /><i /><b /><span /></div></>}
        {activeSection.key === 'space' && <div className="map-orbital-pad"><i /><b /><span>ORBITAL GATE</span></div>}
        {tierPoints.filter((point) => point.sectionKey === activeSection.key).map(({ data: tier, position }) => {
          const status = tier.tier < game.office_tier ? 'complete' : tier.tier === game.office_tier ? 'current' : 'future'
          return (
            <button
              className={`empire-node tier-map-node ${status} ${selected === `tier-${tier.tier}` ? 'is-selected' : ''} ${nearby?.key === `tier-${tier.tier}` ? 'is-near' : ''}`}
              key={tier.tier}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              onClick={() => setSelected(`tier-${tier.tier}`)}
              aria-label={`${tier.name}, tier ${tier.tier}, ${status}`}
            >
              <PixelBuilding tier={tier.tier} locked={status === 'future'} />
              <span><b>{tier.name}</b><small>TIER {tier.tier} · {status}</small></span>
            </button>
          )
        })}
        {rivalPoints.filter((point) => point.sectionKey === activeSection.key).map(({ data: rival, position }) => {
          return (
            <button
              className={`empire-node rival-map-node ${rival.owned ? 'owned' : ''} ${selected === `rival-${rival.key}` ? 'is-selected' : ''} ${nearby?.key === `rival-${rival.key}` ? 'is-near' : ''}`}
              key={rival.key}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              onClick={() => setSelected(`rival-${rival.key}`)}
              aria-label={`${rival.name.replace('Acquire ', '')}, ${rival.owned ? 'acquired' : 'rival firm'}`}
            >
              <RivalHeadquarters assetKey={rival.key} owned={rival.owned} />
              <span><b>{rival.name.replace('Acquire ', '')}</b><small>{rival.owned ? 'ACQUIRED' : 'RIVAL FIRM'}</small></span>
            </button>
          )
        })}
        <div className="world-person map-player" style={{ left: `${walker.position.x}%`, top: `${walker.position.y}%` }}>
          <PixelPerson gender={game.character_gender} tier={game.office_tier} direction={walker.direction} walking={walker.walking} label={`${game.lawyer_name}, map explorer`} />
        </div>
        <div className="scanlines" />
      </div>
      </div>
      <div className="map-compass"><i>N</i><span>✦</span></div>
      <div className="map-legend"><span><i className="legend-owned" />OWNED</span><span><i className="legend-current" />HQ</span><span><i className="legend-rival" />RIVAL</span></div>
      <div className="empire-inspector">
        <span>{selectedPoint.kind === 'tier' ? 'FIRM DESTINATION' : 'ACQUISITION TARGET'}</span>
        <h2>{selectedPoint.data.name.replace('Acquire ', '')}</h2>
        <small className="inspector-region">{selectedPoint.data.region}</small>
        {selectedRivalProfile && <div className="rival-owner-inspector"><PixelPerson gender={selectedRivalProfile.gender} tier={selectedRivalProfile.tier} variant={selectedRivalProfile.variant} accessory="briefcase" /><span><small>RIVAL OWNER</small><strong>{selectedRivalProfile.owner}</strong><i>{selectedRivalProfile.title}</i></span></div>}
        <p>{selectedPoint.kind === 'tier' ? selectedPoint.data.short : selectedPoint.data.description}</p>
        <div>
          <b>${selectedPoint.data.cost.toLocaleString()}</b>
          <b>★ {selectedPoint.data.reputation} REP</b>
        </div>
        <button className="pixel-action" onClick={() => onManage(selectedPoint.kind === 'tier' ? 'upgrades' : 'rivals')}>
          {selectedPoint.kind === 'tier' ? 'MANAGE OFFICE' : 'VIEW ACQUISITION'} <i>›</i>
        </button>
      </div>
      <div className={`interaction-toast map-interaction ${nearby ? 'visible' : ''}`}><kbd>E</kbd><span><strong>Inspect destination</strong><small>{nearby?.data.name ?? 'Walk near a building'}</small></span></div>
      <WorldControls nudge={walker.nudge} />
      </div>
    </div>
  )
}

export function MiniAvatar({ gender, tier = 0 }: { gender: CharacterGender; tier?: number }) {
  return <div className="mini-avatar pixel-mini-avatar"><PixelPerson gender={gender} tier={tier} variant={0} /></div>
}
