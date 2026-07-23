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
const heroJackets = ['#68513e', '#46576b', '#2e6158', '#245070', '#61364f', '#1b3149', '#161b29']
const heroTies = ['#9b5b45', '#b95749', '#c58a42', '#b9ced5', '#dfad4f', '#e0b960', '#f0cc67']

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
  const visualTier = Math.max(0, Math.min(6, tier))
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

const staffPortraits: Record<string, { gender: CharacterGender; tier: number; variant: number; prop: PersonAccessory; role: string; x: number; y: number }> = {
  paralegal: { gender: 'female', tier: 1, variant: 1, prop: 'files', role: 'MAYA · PARALEGAL', x: 25, y: 50 },
  junior_associate: { gender: 'male', tier: 2, variant: 2, prop: 'brief', role: 'THEO · ASSOCIATE', x: 59, y: 43 },
  office_manager: { gender: 'female', tier: 2, variant: 3, prop: 'clipboard', role: 'NINA · MANAGER', x: 34, y: 76 },
  senior_associate: { gender: 'female', tier: 3, variant: 4, prop: 'folio', role: 'AVERY · SENIOR', x: 65, y: 76 },
  partner: { gender: 'male', tier: 4, variant: 5, prop: 'coffee', role: 'JORDAN · PARTNER', x: 75, y: 51 },
  rainmaker: { gender: 'female', tier: 6, variant: 6, prop: 'phone', role: 'MORGAN · RAINMAKER', x: 51, y: 63 },
}

const clientPortraits: Record<string, { gender: CharacterGender; tier: number; variant: number; accessory: PersonAccessory; title: string }> = {
  briefcase: { gender: 'female', tier: 0, variant: 7, accessory: 'briefcase', title: 'WALK-IN' },
  home: { gender: 'male', tier: 1, variant: 1, accessory: 'portfolio', title: 'LOCAL REFERRAL' },
  store: { gender: 'female', tier: 2, variant: 2, accessory: 'shopping-bag', title: 'FOUNDER' },
  gem: { gender: 'male', tier: 3, variant: 3, accessory: 'phone', title: 'PRIVATE CLIENT' },
  building: { gender: 'female', tier: 4, variant: 4, accessory: 'tablet', title: 'GENERAL COUNSEL' },
  landmark: { gender: 'male', tier: 5, variant: 5, accessory: 'folio', title: 'NATIONAL BOARD' },
  globe: { gender: 'female', tier: 6, variant: 6, accessory: 'portfolio', title: 'GLOBAL CHAIR' },
}

const rivalProfiles: Record<string, { owner: string; title: string; gender: CharacterGender; tier: number; variant: number; mark: string; architecture: string }> = {
  neighborhood_practice: { owner: 'Eleanor Harrow', title: 'Founding partner', gender: 'female', tier: 2, variant: 1, mark: 'H&F', architecture: 'brick-house' },
  downtown_boutique: { owner: 'Lucien Vale', title: 'Trial strategist', gender: 'male', tier: 4, variant: 2, mark: 'V', architecture: 'art-deco' },
  regional_firm: { owner: 'Priya Nayar', title: 'Managing partner', gender: 'female', tier: 5, variant: 4, mark: '★', architecture: 'northstar' },
  national_competitor: { owner: 'Sebastian Sterling', title: 'Global chair', gender: 'male', tier: 6, variant: 6, mark: 'SG', architecture: 'mega-tower' },
}

function UpgradeArtwork({ assetKey }: { assetKey: string }) {
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
  return (
    <div className="asset-vignette scene-executive">
      <div className="executive-skyline"><i /><i /><i /><i /><i /></div><div className="executive-desk"><i /><b /><span /></div>
      <div className="executive-chair"><i /><b /></div><div className="executive-globe"><i /><b /></div>
    </div>
  )
}

function StaffArtwork({ asset }: { asset: GameAsset }) {
  const portrait = staffPortraits[asset.key] ?? staffPortraits.paralegal
  return (
    <div className={`asset-vignette scene-staff staff-${portrait.prop}`}>
      <div className="staff-office-window"><i /><i /><i /></div><div className="staff-rug" />
      <PixelPerson gender={portrait.gender} tier={portrait.tier} variant={portrait.variant} accessory={portrait.prop} walking label={asset.name} />
      <div className="staff-prop"><i /><b /><span /></div><span className="staff-sparkles"><i /><i /><i /></span>
    </div>
  )
}

function ConnectionArtwork({ assetKey }: { assetKey: string }) {
  const nodes = assetKey === 'local_bar' ? 3 : assetKey === 'business_network' ? 4 : assetKey === 'board_network' ? 5 : 6
  return (
    <div className={`asset-vignette scene-network network-${nodes}`}>
      <div className="network-map"><i /><i /><i /></div><div className="network-lines"><i /><i /><i /><i /><i /></div>
      <div className="network-hub"><span>{assetKey === 'international_network' ? '✦' : assetKey === 'board_network' ? '§' : '⚖'}</span><i /></div>
      <div className="network-nodes">{Array.from({ length: nodes }, (_, index) => <i key={index}><b /></i>)}</div>
      <span className="network-packet"><i /></span>
    </div>
  )
}

function RivalArtwork({ assetKey, owned }: { assetKey: string; owned: boolean }) {
  const rank = ['neighborhood_practice', 'downtown_boutique', 'regional_firm', 'national_competitor'].indexOf(assetKey) + 1
  const profile = rivalProfiles[assetKey] ?? rivalProfiles.neighborhood_practice
  return (
    <div className={`asset-vignette scene-rival rival-rank-${rank} rival-${assetKey} rival-${profile.architecture}`}>
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
      {asset.type === 'upgrade' && <UpgradeArtwork assetKey={asset.key} />}
      {asset.type === 'staff' && <StaffArtwork asset={asset} />}
      {asset.type === 'connection' && <ConnectionArtwork assetKey={asset.key} />}
      {asset.type === 'rival' && <RivalArtwork assetKey={asset.key} owned={asset.owned} />}
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
      <b>{kind === 'globe' ? '✦' : name.slice(0, 1)}</b>
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
  const staff = Object.entries(staffPortraits).filter(([key]) => owned.has(key)).map(([key, profile]) => ({ key, ...profile }))
  const activeClient = game?.catalog.clients.find((client) => client.key === game.active_client.effective_key)
  const clientProfile = clientPortraits[activeClient?.icon ?? 'briefcase'] ?? clientPortraits.briefcase
  const upgradeClasses = [
    owned.has('proper_lighting') && 'has-proper-lighting',
    owned.has('case_management') && 'has-case-management',
    owned.has('conference_room') && 'has-conference-room',
    owned.has('research_floor') && 'has-research-floor',
    owned.has('executive_suite') && 'has-executive-suite',
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
  onCollect,
}: {
  game: GameState
  activeCase: boolean
  onCase: () => void
  onFirm: () => void
  onEmpire: () => void
  onCollect: () => void
}) {
  const walker = useWalker({ x: 51, y: 79 }, { left: 5, right: 94, top: 31, bottom: 87 })
  const zones = useMemo(() => [
    { key: 'case', x: 79, y: 69, label: activeCase ? 'Resume the active case' : 'Meet your waiting client', detail: `${game.active_client.name} · ${game.active_client.base_fee.toLocaleString()} base fee`, action: onCase },
    { key: 'firm', x: 15, y: 51, label: 'Manage the firm', detail: 'Upgrades · staff · clients', action: onFirm },
    { key: 'empire', x: 90, y: 36, label: 'Enter the empire map', detail: 'Explore offices and rivals', action: onEmpire },
    { key: 'retainers', x: 49, y: 31, label: 'Open the retainer safe', detail: `${game.passive_income.available.toLocaleString()} ready`, action: onCollect },
  ], [activeCase, game.active_client.base_fee, game.active_client.name, game.passive_income.available, onCase, onCollect, onEmpire, onFirm])
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

const tierPositions: Position[] = [
  { x: 10, y: 75 }, { x: 24, y: 63 }, { x: 37, y: 74 }, { x: 50, y: 52 },
  { x: 64, y: 64 }, { x: 76, y: 39 }, { x: 89, y: 24 },
]

const rivalPositions: Position[] = [{ x: 23, y: 25 }, { x: 43, y: 28 }, { x: 68, y: 23 }, { x: 85, y: 70 }]

function PixelBuilding({ tier, locked }: { tier: number; locked: boolean }) {
  const floors = Math.min(7, tier + 2)
  return (
    <div className={`map-building building-${tier} ${locked ? 'locked' : ''}`}>
      <div className="building-antenna"><i /><b /></div>
      <div className="building-roof">{tier >= 4 && <i />}{tier >= 2 && <b />}</div>
      <div className="building-face">
        {Array.from({ length: floors * 3 }, (_, index) => <i key={index} />)}
      </div>
      <div className="building-sign">{tier >= 5 ? 'LT' : '§'}</div>
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
  const initial = tierPositions[game.office_tier] ?? tierPositions[0]
  const walker = useWalker({ x: initial.x, y: Math.min(86, initial.y + 10) }, { left: 4, right: 96, top: 12, bottom: 89 })
  const [selected, setSelected] = useState(`tier-${game.office_tier}`)
  const rivals = game.catalog.assets.filter((asset) => asset.type === 'rival')
  const points = [
    ...game.catalog.tiers.map((tier, index) => ({ key: `tier-${tier.tier}`, kind: 'tier' as const, position: tierPositions[index], data: tier })),
    ...rivals.map((rival, index) => ({ key: `rival-${rival.key}`, kind: 'rival' as const, position: rivalPositions[index] ?? { x: 82, y: 82 }, data: rival })),
  ]
  const nearby = points.find((point) => Math.hypot((walker.position.x - point.position.x) * 1.15, walker.position.y - point.position.y) < 11)
  const selectedPoint = points.find((point) => point.key === selected) ?? points[0]
  const selectedRivalProfile = selectedPoint.kind === 'rival' ? (rivalProfiles[selectedPoint.data.key] ?? rivalProfiles.neighborhood_practice) : null

  useEffect(() => {
    const interact = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || !nearby) return
      event.preventDefault()
      setSelected(nearby.key)
    }
    window.addEventListener('keydown', interact)
    return () => window.removeEventListener('keydown', interact)
  }, [nearby])

  return (
    <div className="empire-explorer game-viewport" aria-label="Explorable legal empire map">
      <div className="empire-terrain">
        <div className="terrain-speckles">{Array.from({ length: 28 }, (_, index) => <i key={index} />)}</div>
        <div className="map-water"><i /><i /><i /><span className="map-boat">▰</span></div>
        <div className="map-park park-one">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
        <div className="map-park park-two">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
        <div className="map-road road-a"><div className="road-traffic traffic-one"><i /><i /><i /></div></div>
        <div className="map-road road-b"><div className="road-traffic traffic-two"><i /><i /></div></div>
        <div className="map-road road-c" /><div className="map-road road-d" />
        <div className="map-bridge"><i /><i /><i /><i /></div>
        <div className="map-rail"><span /><span /><span /><span /><span /><span /><span /><span /><div className="map-train"><i /><i /><i /></div></div>
        <div className="map-streetlights">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
        <div className="map-fountain"><i /><b /><span /></div>
        <div className="map-birds"><i /><i /><i /><i /></div>
        <div className="leaf-particles">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
        {game.office_tier >= 4 && <div className="map-helicopter"><i /><b /><span /></div>}
        <div className="map-cloud map-cloud-a" /><div className="map-cloud map-cloud-b" />
        {game.catalog.tiers.map((tier, index) => {
          const position = tierPositions[index]
          const status = tier.tier < game.office_tier ? 'complete' : tier.tier === game.office_tier ? 'current' : 'future'
          return (
            <button
              className={`empire-node tier-map-node ${status} ${nearby?.key === `tier-${tier.tier}` ? 'is-near' : ''}`}
              key={tier.tier}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              onClick={() => setSelected(`tier-${tier.tier}`)}
            >
              <PixelBuilding tier={tier.tier} locked={status === 'future'} />
              <span><b>{tier.name}</b><small>TIER {tier.tier} · {status}</small></span>
            </button>
          )
        })}
        {rivals.map((rival, index) => {
          const position = rivalPositions[index] ?? { x: 82, y: 82 }
          return (
            <button
              className={`empire-node rival-map-node ${rival.owned ? 'owned' : ''} ${nearby?.key === `rival-${rival.key}` ? 'is-near' : ''}`}
              key={rival.key}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              onClick={() => setSelected(`rival-${rival.key}`)}
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
      <div className="map-compass"><i>N</i><span>✦</span></div>
      <div className="map-legend"><span><i className="legend-owned" />OWNED</span><span><i className="legend-current" />HQ</span><span><i className="legend-rival" />RIVAL</span></div>
      <div className="empire-inspector">
        <span>{selectedPoint.kind === 'tier' ? 'FIRM DESTINATION' : 'ACQUISITION TARGET'}</span>
        <h2>{selectedPoint.data.name.replace('Acquire ', '')}</h2>
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
  )
}

export function MiniAvatar({ gender, tier = 0 }: { gender: CharacterGender; tier?: number }) {
  return <div className="mini-avatar pixel-mini-avatar"><PixelPerson gender={gender} tier={tier} variant={0} /></div>
}
