import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ActiveOfficeCase, CharacterGender, GameAsset, GameState } from './types'
import { CheckMark, DeliberatingMark, LockMark, MinusMark, PlusMark, ScalesMark, StatuteMark } from './art-2d/marks'
import { Bust, Person, type Mood } from './art/people'
import { OfficeRoom } from './art/office'
// Splitting this out of the entry bundle was tried and reverted: it saves ~16 kB
// there, and costs the world route a whole extra round trip, because the shell
// owns the `Suspense` boundary the scene sits behind and so has to land before
// the scene is even requested. Measured on a 4G profile that trade lost by a
// wide margin (warm navigation to the map, canvas creation +113%).
import { UnifiedEmpireMap } from './art/unified-empire-map'
import { useSound } from './sound'
import { MOTION_TIMING } from './motion'
import {
  clientCastIdentity, connectionArt, keyHash, playerStage, upgradeArt, cutsceneArt, rivalSiteArt,
} from './art/assets'
import { loadStylizedCharacter } from './art/scene-loaders'
import { officeEnvironmentFor, officeStaffStationFor, officeVisualFor, ownedOfficeAssets } from './art/office-manifest'
import { WardrobeLauncher } from './wardrobe'

const StylizedCharacter = lazy(() => loadStylizedCharacter().then((module) => ({ default: module.StylizedCharacter })))
const CatalogAssetRender = lazy(() => import('./art/catalog-asset-render').then((module) => ({ default: module.CatalogAssetRender })))

type OfficeSceneProps = {
  game?: GameState | null
  gender?: CharacterGender
  previewTier?: number
  className?: string
  activeCase?: ActiveOfficeCase | null
}

type Position = { x: number; y: number; visible?: boolean }
type OfficeAnchorKey = 'lamp' | 'window' | 'coffee' | 'cat' | 'chair' | 'case' | 'firm' | 'empire' | 'story'
type OfficeAnchorMap = Partial<Record<OfficeAnchorKey, Position>>

// Preview scenes do not have a game catalog. Keep this reference stable so a
// first anchor measurement cannot cause the WebGL office to tear itself down
// and rebuild on every React render.
const EMPTY_GAME_ASSETS: GameAsset[] = []

function sameOfficeAnchors(left: OfficeAnchorMap, right: OfficeAnchorMap) {
  const leftKeys = Object.keys(left) as OfficeAnchorKey[]
  const rightKeys = Object.keys(right) as OfficeAnchorKey[]
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => {
    const current = left[key]
    const next = right[key]
    return current?.x === next?.x && current?.y === next?.y && current?.visible === next?.visible
  })
}

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

const cutsceneMeta: Record<string, { weather: 'rain' | 'stars' | 'dust' | 'none'; speakerRole: string }> = {
  rainy_shack: { weather: 'rain', speakerRole: 'A determined stranger' },
  market_showdown: { weather: 'dust', speakerRole: 'Market ward organizer' },
  city_hall_night: { weather: 'stars', speakerRole: 'City hall insider' },
  sterling_tower: { weather: 'none', speakerRole: 'Sterling emissary' },
  midnight_exchange: { weather: 'stars', speakerRole: 'Night contact' },
  continental_forum: { weather: 'dust', speakerRole: 'Forum arbiter' },
  orbital_hearing: { weather: 'stars', speakerRole: 'Orbital counsel' },
  planetary_nexus: { weather: 'stars', speakerRole: 'Nexus strategist' },
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
        <Suspense fallback={null}>
          <StylizedCharacter
            gender={keyHash(scene) % 2 ? 'female' : 'male'}
            tier={Math.min(5, game.office_tier + 1)}
            role="visitor"
            mode="scene"
            activity="briefing"
            direction="right"
            paletteSeed={keyHash(`${scene}:speaker`)}
            label={meta.speakerRole}
          />
        </Suspense>
      </div>
      <div className="av-cutscene-cast av-cutscene-player">
        <Suspense fallback={null}>
          <StylizedCharacter
            gender={game.character_gender}
            tier={game.office_tier}
            mode="scene"
            direction="left"
            cosmetics={game.cosmetics}
            label={game.lawyer_name}
          />
        </Suspense>
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
          {state === 'locked'
            ? <div className="av-vignette-locked-person" aria-hidden="true"><i /><b /></div>
            : <Person identity={asset.key} tier={asset.tier} label={asset.name} activity={state === 'owned' ? 'working' : 'briefing'} className="av-vignette-person" />}
        </div>
      ) : asset.type === 'rival' && profile ? (
        /* Rivals were the last catalog type still drawn from the old flat
           raster site set, which is why they read as a different game beside
           an upgrade or a connection. They now go through the same live 3D
           card renderer as everything else, with `art` selecting a real
           headquarters massing rather than a tinted CSS box. */
        <>
          <div className="av-card-frame av-card-frame-site">
            <Suspense fallback={<div className="av-card-render-placeholder" aria-hidden="true"><i /><i /><i /></div>}>
              <CatalogAssetRender asset={asset} fallbackSrc={rivalSiteArt(profile.architecture)} />
            </Suspense>
            <i className="av-card-sheen" />
            {profile.mark && <b className="av-card-mark">{profile.mark}</b>}
          </div>
          <div className="av-vignette-owner">
            <Bust identity={asset.key} tier={asset.tier} backdrop="none" />
            <span><strong>{profile.owner}</strong><small>{profile.title}</small></span>
          </div>
        </>
      ) : (
        <div className="av-card-frame">
          <Suspense fallback={<div className="av-card-render-placeholder" aria-hidden="true"><i /><i /><i /></div>}>
            <CatalogAssetRender
              asset={asset}
              fallbackSrc={asset.type === 'upgrade' || asset.type === 'cosmetic' ? upgradeArt(asset.key) : connectionArt(asset.key)}
            />
          </Suspense>
          <i className="av-card-sheen" />
        </div>
      )}
      {state === 'locked' && <div className="av-vignette-lock"><span><LockMark /></span></div>}
      {state === 'owned' && <div className="av-vignette-owned"><CheckMark /></div>}
      <span className="asset-art-label av-vignette-label">
        {asset.type === 'upgrade' ? 'OFFICE UPGRADE' : asset.type === 'cosmetic' ? 'OFFICE DECOR' : asset.type === 'staff' ? 'TEAM MEMBER' : asset.type === 'connection' ? 'NEW CONTACTS' : 'ACQUISITION'}
      </span>
    </div>
  )
}

export function StaffRoster({ staff }: { staff: GameAsset[] }) {
  const visible = staff.filter((asset) => asset.type === 'staff' && (asset.owned || asset.available))
  return (
    <section className="firm-staff-roster" aria-label="Unlocked firm staff">
      <header>
        <span>YOUR PEOPLE</span>
        <h2>The firm floor</h2>
        <p>Hired staff work in the foreground; available candidates step forward when their requirements are met.</p>
      </header>
      <div className="firm-staff-roster-stage">
        {visible.length ? visible.map((asset, index) => {
          const profile = staffProfileFor(asset)
          const [name, title] = profile.role.split('·').map((part) => part.trim())
          return (
            <article className={asset.owned ? 'is-hired' : 'is-available'} key={asset.key}>
              <div className="firm-staff-model">
                <Person
                  identity={asset.key}
                  tier={asset.tier}
                  mood={asset.owned ? 'happy' : 'neutral'}
                  activity={asset.owned ? (index % 2 ? 'briefing' : 'working') : 'idle'}
                  label={`${name}, ${title || asset.name}`}
                />
              </div>
              <div className="firm-staff-nameplate">
                <small>{asset.owned ? 'ON STAFF' : 'READY TO HIRE'}</small>
                <strong>{name}</strong>
                <span>{title || asset.name}</span>
              </div>
            </article>
          )
        }) : (
          <div className="firm-staff-empty"><span>FIRST DESK AVAILABLE</span><strong>Your first colleague appears here when their requirements are met.</strong></div>
        )}
      </div>
    </section>
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
  // `identity` seeds every visual trait (skin, hair, build, accessories) below,
  // so it must be unique per-client. `kind` is a shared icon *category* (dozens
  // of clients share e.g. "briefcase" or "lunar"), which collapsed most of the
  // roster onto a handful of identical-looking faces. `name` is unique per
  // client in the catalog, giving each one its own deterministic appearance.
  //
  // It is also the *only* unique thing about a client that both this card and
  // the seated 3D client in the office scene hold, which is why the identity is
  // the bare name and not `kind:name`. Those two are the same person and have
  // to look it: the office scene has the client's name and key but no icon
  // category, so folding `kind` in here is what made the card and the body in
  // the room resolve to two different faces. See `clientCastSeed`, which is the
  // hash both sides run this through.
  const identity = clientCastIdentity(name)
  return (
    <div className={`client-portrait av-portrait client-${kind} mood-${mood} ${className}`} aria-label={`${name}, ${profile.title.toLowerCase()}, ${mood}`} role="img">
      <Bust identity={identity} backdrop={profile.bg} mood={mood} />
      <b>{['globe', 'orbit', 'lunar', 'nexus', 'quantum'].includes(kind) ? '✦' : name.slice(0, 1)}</b>
      <small>{profile.title}</small>
    </div>
  )
}

export function JudgePortrait({ thinking = false, pleased = false }: { thinking?: boolean; pleased?: boolean }) {
  return (
    <div className={`judge-portrait av-judge ${thinking ? 'is-thinking' : ''} ${pleased ? 'is-pleased' : ''}`} aria-hidden="true">
      <div className="av-judge-model">
        <Suspense fallback={null}>
          <StylizedCharacter gender="female" tier={5} role="judge" mode="portrait" mood={thinking ? 'thinking' : pleased ? 'happy' : 'neutral'} paletteSeed={2} />
        </Suspense>
      </div>
      <span className="av-judge-gavel"><ScalesMark /></span>
      <span className="av-judge-state">{pleased ? <CheckMark /> : thinking ? <DeliberatingMark /> : <StatuteMark />}</span>
    </div>
  )
}

export function CounselPortrait3D({ seed, rattled = false, label }: { seed: string; rattled?: boolean; label?: string }) {
  const hash = keyHash(seed)
  return (
    <div className={`counsel-portrait-3d ${rattled ? 'is-rattled' : ''}`}>
      <Suspense fallback={null}>
        <StylizedCharacter
          gender={hash % 2 ? 'female' : 'male'}
          tier={3 + (hash % 3)}
          role="visitor"
          mode="portrait"
          mood={rattled ? 'unhappy' : 'neutral'}
          paletteSeed={hash}
          label={label}
        />
      </Suspense>
    </div>
  )
}

export function EventVisitor3D({ seed, label }: { seed: string; label?: string }) {
  const hash = keyHash(seed)
  return (
    <Suspense fallback={null}>
      <StylizedCharacter
        gender={hash % 2 ? 'female' : 'male'}
        tier={2 + (hash % 4)}
        role="visitor"
        mode="scene"
        direction="right"
        paletteSeed={hash}
        label={label}
      />
    </Suspense>
  )
}

export function MiniAvatar({ gender, tier = 0 }: { gender: CharacterGender; tier?: number }) {
  return <div className="mini-avatar av-mini-avatar"><Person gender={gender} tier={tier} /></div>
}

/* ------------------------------------------------------- the office */

function OfficeBackdrop({ game, previewTier, activeCase, children }: OfficeSceneProps & { children?: React.ReactNode | ((anchors: OfficeAnchorMap) => React.ReactNode) }) {
  const { play } = useSound()
  const tier = previewTier ?? game?.office_tier ?? 0
  const assets = game?.catalog.assets ?? EMPTY_GAME_ASSETS
  const officeRef = useRef<HTMLDivElement | null>(null)

  const [officeAnchors, setOfficeAnchors] = useState<OfficeAnchorMap>({})

  useEffect(() => {
    const office = officeRef.current
    if (!office) return
    const updateAnchors = (event: Event) => {
      const nextAnchors = (event as CustomEvent<OfficeAnchorMap>).detail
      setOfficeAnchors((current) => sameOfficeAnchors(current, nextAnchors) ? current : nextAnchors)
    }
    const furnitureMoved = (event: Event) => {
      const detail = (event as CustomEvent<{ item: string; reset: boolean }>).detail
      void play('select', { seed: `${game?.id ?? 'preview-office'}:${detail.item}:${detail.reset ? 'reset' : 'move'}`, intensity: .28 })
    }
    office.addEventListener('office-anchor-update', updateAnchors)
    office.addEventListener('office-furniture-moved', furnitureMoved)
    return () => {
      office.removeEventListener('office-anchor-update', updateAnchors)
      office.removeEventListener('office-furniture-moved', furnitureMoved)
    }
  }, [game?.id, play])

  return (
    <div
      className={`av-office office-tier-${tier}`}
      data-tier={tier}
      ref={officeRef}
    >
      <OfficeRoom tier={tier} assets={assets} layoutKey={game?.id} activeCase={activeCase} />
      <div className="cozy-glow" aria-hidden="true" />
      {typeof children === 'function' ? children(officeAnchors) : children}
      <div className="av-office-vignette" />
    </div>
  )
}

export function OfficeScene(props: OfficeSceneProps) {
  return <div className={`office-scene av-scene ${props.className ?? ''}`}><OfficeBackdrop {...props} /></div>
}

/* ---------------------------------------------------- character panel */

const stageTitles = ['Street Counsel', 'Rising Associate', 'Downtown Advocate', 'Power Partner', 'Global Magnate', 'Celestial Counsel']
// Automatic entrances favor restrained professional gestures.
//
// This used to be a coin flip between a wave and a bow, which meant the app's
// largest and most-looked-at character opened with a wave half the time. Both
// remaining beats are grounded: a courteous acknowledgment, and the formal
// courtroom bow. Whichever fires, it lands over a continuing idle rather than
// replacing it, so the body is breathing throughout and settles back into the
// ambient repertoire instead of switching off.
const officeEntranceActivities = ['greeting', 'courtroom-bow'] as const
type OfficeEntranceActivity = (typeof officeEntranceActivities)[number]

export function CharacterPanel({ game }: { game: GameState }) {
  const stage = playerStage(game.office_tier)
  const motion = useParallax<HTMLElement>()
  const [characterActivity, setCharacterActivity] = useState<'idle' | OfficeEntranceActivity>(() => (
    officeEntranceActivities[Math.floor(Math.random() * officeEntranceActivities.length)]
  ))
  const entranceTimer = useRef<number | null>(null)
  const entranceStarted = useRef(false)
  // Opening the Office always earns one short character beat. It resolves to
  // a neutral idle automatically; there are no controls asking
  // the learner to repeatedly trigger decorative animation.
  const beginEntranceTimer = useCallback(() => {
    if (entranceStarted.current) return
    entranceStarted.current = true
    entranceTimer.current = window.setTimeout(() => setCharacterActivity('idle'), MOTION_TIMING.characterEntranceMs)
  }, [])
  useEffect(() => () => {
    if (entranceTimer.current !== null) window.clearTimeout(entranceTimer.current)
  }, [])
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
            <StylizedCharacter
              label={`${game.lawyer_name}, ${stageTitles[stage]}`}
              gender={game.character_gender}
              tier={game.office_tier}
              mode="hero"
              cosmetics={game.cosmetics}
              activity={characterActivity}
              onReady={beginEntranceTimer}
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
        <WardrobeLauncher game={game} />
      </div>
    </aside>
  )
}

function OfficeInventory({ game, onFocus }: { game: GameState; onFocus: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const environment = officeEnvironmentFor(game.office_tier)
  const installed = useMemo(() => ownedOfficeAssets(game.catalog.assets), [game.catalog.assets])
  const counts = installed.reduce<Record<string, number>>((totals, asset) => {
    totals[asset.type] = (totals[asset.type] ?? 0) + 1
    return totals
  }, {})
  return (
    <aside className={`office-inventory ${open ? 'is-open' : ''}`} aria-label="Installed office features">
      <button type="button" className="office-inventory-toggle" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>IN THIS OFFICE</span><strong>{installed.length}</strong><i>{open ? <MinusMark /> : <PlusMark />}</i>
      </button>
      {open && (
        <div className="office-inventory-panel">
          <header>
            <small>HEADQUARTERS TIER {game.office_tier}</small>
            <h3>{environment.name}</h3>
            <p>{environment.identity}</p>
            <div><span>{counts.upgrade ?? 0} upgrades</span><span>{counts.staff ?? 0} people</span><span>{(counts.connection ?? 0) + (counts.rival ?? 0)} network</span><span>{counts.cosmetic ?? 0} decor</span></div>
          </header>
          <div className="office-inventory-list" aria-label="Installed assets">
            {installed.map((asset) => {
              const visual = officeVisualFor(asset.key)
              const department = asset.type === 'staff' ? officeStaffStationFor(asset.key).replace(/^./, (letter) => letter.toUpperCase()) : null
              return (
                <button type="button" key={asset.key} aria-label={`Focus ${asset.name.replace('Acquire ', '')} in the office`} onClick={() => { onFocus(asset.key); setOpen(false) }}>
                  <i className={`inventory-type type-${asset.type}`} />
                  <span><strong>{asset.name.replace('Acquire ', '')}</strong><small>{department ? `${department} station` : visual.label} · {visual.location}</small></span>
                  <b>FOCUS</b>
                </button>
              )
            })}
            {!installed.length && <p className="office-inventory-empty">Your first purchase will be installed here.</p>}
          </div>
        </div>
      )}
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
  activeCase: ActiveOfficeCase | null
  onCase: () => void
  onFirm: () => void
  onEmpire: () => void
  onStory: () => void
}) {
  const { play } = useSound()
  const explorerRef = useRef<HTMLDivElement | null>(null)
  const [revealedZone, setRevealedZone] = useState('')
  const zones = useMemo(() => [
    {
      key: 'case',
      x: 72,
      y: 72,
      label: activeCase ? `Resume ${activeCase.clientName}'s case` : 'Open the client file',
      detail: activeCase
        ? `Your client is waiting · ${activeCase.baseFee.toLocaleString()} base fee`
        : `${game.active_client.name} · ${game.active_client.base_fee.toLocaleString()} base fee`,
      action: onCase,
    },
    { key: 'firm', x: 12, y: 59, label: 'Manage the firm', detail: 'Upgrades · staff · clients', action: onFirm },
    { key: 'empire', x: 88, y: 60, label: 'Enter the empire map', detail: 'Explore offices and rivals', action: onEmpire },
    { key: 'story', x: 61, y: 43, label: 'Open the caseboard', detail: game.story.active_quest ? game.story.active_quest.title : 'Campaign · quests · rival intelligence', action: onStory },
  ], [activeCase, game.active_client.base_fee, game.active_client.name, game.story.active_quest, onCase, onEmpire, onFirm, onStory])

  const focusInstalledAsset = useCallback((key: string) => {
    const office = explorerRef.current?.querySelector('.av-office')
    office?.dispatchEvent(new CustomEvent('office-focus-asset', { detail: { key } }))
    void play('select', { seed: `office-installation:${key}`, intensity: .46 })
  }, [play])

  return (
    <div className="av-office-duo">
      <CharacterPanel game={game} />
      <div className="office-explorer game-viewport av-viewport" aria-label="Explorable law office" ref={explorerRef}>
        <OfficeBackdrop game={game} activeCase={activeCase}>
          {(anchors) => zones.map((zone) => (
            <button
              key={zone.key}
              className={`world-zone zone-${zone.key} ${zone.key === 'case' && activeCase ? 'is-client-anchor' : ''} ${revealedZone === zone.key ? 'is-revealed' : ''}`}
              style={(() => {
                const anchor = anchors[zone.key as OfficeAnchorKey]
                return {
                  left: `${anchor?.x ?? zone.x}%`,
                  top: `${anchor?.y ?? zone.y}%`,
                  opacity: anchor?.visible === false ? 0 : undefined,
                  pointerEvents: anchor?.visible === false ? 'none' : undefined,
                }
              })()}
              onClick={() => {
                if (window.matchMedia('(hover: none)').matches && revealedZone !== zone.key) {
                  setRevealedZone(zone.key)
                  return
                }
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
        <OfficeInventory game={game} onFocus={focusInstalledAsset} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------- empire map */

export function EmpireWorldMap({ game, focusRival, focusConnection, focusDistrict, onManage, empireValueLabel }: { game: GameState; focusRival?: string | null; focusConnection?: string | null; focusDistrict?: string | null; onManage: (tab: 'upgrades' | 'rivals' | 'connections', districtKey?: string) => void; empireValueLabel: string }) {
  return <UnifiedEmpireMap game={game} focusRival={focusRival} focusConnection={focusConnection} focusDistrict={focusDistrict} onManage={onManage} empireValueLabel={empireValueLabel} />
}
