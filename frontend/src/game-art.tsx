import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PixelWebGLAtmosphere } from './pixel-webgl'
import { cityPlan } from './city-plan'
import { learnerScenes } from './scene-registry'
import type { CharacterGender, GameState, StudySession } from './types'

type OfficeSceneProps = {
  game?: GameState | null
  gender?: CharacterGender
  previewTier?: number
  className?: string
}

type Direction = 'up' | 'down' | 'left' | 'right'
type Position = { x: number; y: number }

export type CharacterMood = 'happy' | 'unhappy' | 'neutral'

const skinTones = ['#d59a72', '#b87555', '#e0ad80', '#8f5b45', '#c98963']
const hairTones = ['#30251f', '#5a3728', '#1d2933', '#70492d', '#241e29']
const staffColors = ['#8d3f64', '#315b70', '#5b4675', '#2d4f55', '#745032']

export function PixelPerson({
  gender = 'female',
  tier = 1,
  variant = 0,
  direction = 'down',
  walking = false,
  className = '',
  label,
}: {
  gender?: CharacterGender
  tier?: number
  variant?: number
  direction?: Direction
  walking?: boolean
  className?: string
  label?: string
}) {
  const jacket = variant === 0
    ? (tier === 0 ? '#62513f' : tier >= 5 ? '#152d43' : '#244459')
    : staffColors[(variant - 1) % staffColors.length]
  const skin = skinTones[variant % skinTones.length]
  const hair = hairTones[variant % hairTones.length]
  return (
    <div
      className={`pixel-person facing-${direction} ${walking ? 'is-walking' : ''} ${className}`}
      data-gender={gender}
      data-tier={tier}
      data-variant={variant % 5}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      <i className="pp-shadow" />
      <i className="pp-leg pp-leg-left" />
      <i className="pp-leg pp-leg-right" />
      <i className="pp-trouser-light pp-trouser-light-left" />
      <i className="pp-trouser-light pp-trouser-light-right" />
      <i className="pp-shoes" />
      <i className="pp-body" style={{ backgroundColor: jacket }} />
      <i className="pp-shirt" />
      <i className="pp-collar pp-collar-left" />
      <i className="pp-collar pp-collar-right" />
      <i className="pp-tie" style={{ backgroundColor: tier >= 5 ? '#e0b960' : '#b95749' }} />
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
      <i className={`pp-hair ${gender === 'female' ? 'long' : ''}`} style={{ backgroundColor: hair }} />
      <i className="pp-fringe" style={{ backgroundColor: hair }} />
      <i className="pp-hair-shine" />
      <i className="pp-eyes" />
      <i className="pp-pupils" />
      <i className="pp-brows" />
      <i className="pp-nose" />
      <i className="pp-mouth" />
      <i className="pp-cheeks" />
      {variant > 0 && <i className="pp-folder" />}
      {tier >= 3 && variant === 0 && <i className="pp-watch" />}
      {tier >= 5 && variant === 0 && <i className="pp-pin" />}
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
  const variant = kind === 'gem' ? 3 : kind === 'globe' ? 4 : kind === 'building' ? 2 : kind === 'landmark' ? 1 : 0
  return (
    <div className={`client-portrait pixel-portrait mood-${mood} ${className}`} aria-label={`${name}, ${mood}`} role="img">
      <div className="portrait-skyline"><i /><i /><i /></div>
      <PixelPerson gender={variant % 2 ? 'male' : 'female'} tier={Math.max(1, variant)} variant={variant + 1} />
      <b>{name.slice(0, 1)}</b>
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

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.matches('button, a, input, textarea, select, [contenteditable="true"]')) return
    const keyMap: Record<string, Direction> = {
      ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
      ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    }
    const nextDirection = keyMap[event.key]
    if (!nextDirection) return
    event.preventDefault()
    nudge(nextDirection)
  }, [nudge])

  useEffect(() => () => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current)
  }, [])

  return { position, setPosition, direction, walking, nudge, handleKeyDown }
}

function PixelWindow({ tier }: { tier: number }) {
  return (
    <div className="pixel-window">
      <div className="pixel-moon" />
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
      <div className="pixel-desk main-desk"><div className="desk-lamp"><i /></div><div className="paper-stack"><i /><i /><i /></div><div className="desk-screen">LT</div><div className="pixel-keyboard">······</div><div className="desk-phone"><i /><b /></div><div className="coffee-mug"><i /></div><div className="open-case-file"><i /><b /></div></div>
      <div className="pixel-desk reception-desk"><span>RECEPTION</span><i /><b className="desk-bell" /></div>
      <div className="filing-cabinets"><i /><i /><i /></div>
      <div className="pixel-safe"><i>$</i></div>
      <div className="water-cooler"><i /><b /></div>
      <div className="office-plant plant-one"><i /><i /><i /><b /></div>
      {tier >= 2 && <div className="conference-table"><i /><i /><i /><i /><span /></div>}
      {(owned.has('case_management') || tier >= 2) && <div className="printer"><i /><b /></div>}
      {tier >= 4 && <div className="trophy-case">{Array.from({ length: 3 }, (_, index) => <i key={index}>★</i>)}</div>}
      <div className="map-elevator"><span>EMPIRE</span><i /><b /></div>
      <div className="office-clock"><i /><b /></div>
      <div className="desk-chair chair-main"><i /><b /></div><div className="desk-chair chair-reception"><i /><b /></div>
      <div className="file-cart"><i /><i /><i /><b /></div>
      <div className="legal-scale-prop"><i /><b /><span /></div>
      <div className="mail-cubbies">{Array.from({ length: 9 }, (_, index) => <i key={index}>{index % 3 === 0 ? '§' : ''}</i>)}</div>
      <div className="office-coat-rack"><i /><b /><span /></div>
      <div className="evidence-locker"><span>EVIDENCE</span><i /><i /><i /></div>
      <div className="desk-nameplate">{tier >= 3 ? 'PARTNER' : 'COUNSEL'}</div>
      <div className="floor-briefcase"><i /><b /></div>
      <div className="floor-cable"><i /><i /></div>
      {tier === 0 && <div className="old-radiator"><i /><i /><i /><i /><b /></div>}
    </>
  )
}

function OfficeBackdrop({ game, gender = 'female', previewTier, children }: OfficeSceneProps & { children?: React.ReactNode }) {
  const tier = previewTier ?? game?.office_tier ?? 0
  const owned = useMemo(() => new Set(game?.owned_assets ?? []), [game?.owned_assets])
  const staff = [
    owned.has('paralegal') && { role: 'PARALEGAL', x: 27, y: 49, variant: 1 },
    owned.has('junior_associate') && { role: 'ASSOCIATE', x: 60, y: 42, variant: 2 },
    owned.has('senior_associate') && { role: 'SENIOR', x: 35, y: 74, variant: 3 },
    owned.has('partner') && { role: 'PARTNER', x: 69, y: 73, variant: 4 },
  ].filter(Boolean) as Array<{ role: string; x: number; y: number; variant: number }>

  return (
    <div className="pixel-office-world" data-tier={tier}>
      <PixelWebGLAtmosphere accent={tier >= 4 ? '#8cd9d0' : '#efc55d'} className="office-webgl" variant="office" intensity={1.15} />
      <div className="office-back-wall" />
      <PixelWindow tier={tier} />
      <div className="firm-wall-sign"><strong>{game?.firm_name ?? 'COUNSEL & CO.'}</strong><span>ATTORNEYS AT LAW</span></div>
      <OfficeFurniture tier={tier} owned={owned} />
      {staff.map((member) => (
        <div className="world-person npc-person" key={member.role} style={{ left: `${member.x}%`, top: `${member.y}%` }}>
          <i className={`npc-status npc-status-${member.variant}`}>{member.variant === 1 ? '⌕' : member.variant === 2 ? '⌨' : member.variant === 3 ? '§' : '★'}</i>
          <PixelPerson gender={member.variant % 2 ? 'female' : 'male'} tier={tier} variant={member.variant} label={member.role} />
          <span>{member.role}</span>
        </div>
      ))}
      <div className="world-person client-person" style={{ left: '79%', top: '69%' }}>
        <div className="quest-bubble">!</div>
        <PixelPerson gender="male" tier={2} variant={5} label="Waiting client" />
        <span>CLIENT</span>
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

  const handleOfficeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key.toLowerCase() === 'e' && activeZone && !(event.target as HTMLElement).matches('button, a')) {
      event.preventDefault()
      activeZone.action()
      return
    }
    walker.handleKeyDown(event)
  }

  return (
    <div className="office-explorer game-viewport" role="region" aria-label="Explorable law office. Focus this area to use movement keys." tabIndex={0} onKeyDown={handleOfficeKeyDown}>
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

const tierPositions = cityPlan.tierPositions
const rivalPositions = cityPlan.rivalPositions
const sceneMapPositions = cityPlan.scenePositions
const mapDistricts = cityPlan.districts
const cityBlocks = cityPlan.blocks

function PixelMapRail({ style }: { style?: CSSProperties }) {
  const railRef = useRef<HTMLDivElement>(null)
  const trainRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rail = railRef.current
    const train = trainRef.current
    if (!rail || !train) return
    let animation: Animation | null = null
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const run = () => {
      animation?.cancel()
      const distance = rail.clientWidth + train.clientWidth + 45
      const reduced = motion.matches
      animation = train.animate(
        [{ transform: 'translate3d(-125px,0,0)' }, { transform: `translate3d(${distance}px,0,0)` }],
        { duration: reduced ? 1 : 17000, iterations: reduced ? 1 : Infinity, easing: 'linear' },
      )
      if (reduced) animation.pause()
    }
    run()
    const observer = new ResizeObserver(run)
    observer.observe(rail)
    motion.addEventListener('change', run)
    return () => { observer.disconnect(); motion.removeEventListener('change', run); animation?.cancel() }
  }, [])
  return (
    <div className="map-rail" ref={railRef} aria-hidden="true" style={style}>
      <span /><span /><span /><span /><span /><span /><span /><span />
      <div className="map-train" ref={trainRef}><i /><i /><i /></div>
    </div>
  )
}

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

export function EmpireWorldMap({ game, session, onManage, onScene }: { game: GameState; session?: StudySession | null; onManage: (tab: 'upgrades' | 'rivals') => void; onScene: (slug: string) => void }) {
  const initial = tierPositions[game.office_tier] ?? tierPositions[0]
  const walker = useWalker({ x: initial.x, y: Math.min(86, initial.y + 10) }, { left: 4, right: 96, top: 12, bottom: 89 })
  const startingDistrict = game.office_tier >= 3 ? 'Executive District' : game.office_tier >= 2 ? 'Firm Campus' : game.office_tier >= 1 ? 'Learning Quarter' : 'Founders Row'
  const startingDistrictPlan = cityPlan.districts.find((district) => district.name === startingDistrict) ?? cityPlan.districts[0]
  const [layer, setLayer] = useState<'scenes' | 'firm' | 'rivals'>('scenes')
  const [selected, setSelected] = useState(`district-${startingDistrictPlan.id}`)
  const [activeDistrict, setActiveDistrict] = useState(startingDistrict)
  const [zoom, setZoom] = useState(1)
  const [cameraCenter, setCameraCenter] = useState<Position>({ x: 50, y: 50 })
  const [inspectorOpen, setInspectorOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches)
  const rivals = game.catalog.assets.filter((asset) => asset.type === 'rival')
  const firmPoints = [
    ...game.catalog.tiers.map((tier, index) => ({ key: `tier-${tier.tier}`, kind: 'tier' as const, position: tierPositions[index], data: tier })),
  ]
  const rivalPoints = rivals.map((rival, index) => ({ key: `rival-${rival.key}`, kind: 'rival' as const, position: rivalPositions[index] ?? { x: 82, y: 82 }, data: rival }))
  const scenePoints = learnerScenes.filter((scene) => scene.id !== 'S25').map((scene) => ({ key: `scene-${scene.slug}`, kind: 'scene' as const, position: sceneMapPositions[scene.slug] ?? scene.position, data: scene }))
  const districtStats = mapDistricts.map((district) => {
    const districtScenes = scenePoints.filter((point) => point.data.district === district.name)
    return { ...district, scenes: districtScenes, total: districtScenes.length, open: districtScenes.filter((point) => game.office_tier >= point.data.minTier).length }
  })
  const districtPoints = districtStats.map((district) => ({ key: `district-${district.id}`, kind: 'district' as const, position: district.hub, data: district }))
  const points = layer === 'firm' ? firmPoints : layer === 'rivals' ? rivalPoints : districtPoints
  const nearby = points.find((point) => Math.hypot((walker.position.x - point.position.x) * 1.15, walker.position.y - point.position.y) < 12)
  const selectedPoint = points.find((point) => point.key === selected) ?? points[0]
  const recommendedScene = (districtName: string) => {
    const districtScenes = scenePoints.filter((point) => point.data.district === districtName && game.office_tier >= point.data.minTier)
    const preferred: Record<string, string> = {
      'Founders Row': session ? 'case-workspace' : 'reception-docket',
      'Learning Quarter': game.total_cases ? 'mentor-conference' : 'research-library',
      'Civic Center': 'appeals-chamber',
      'Firm Campus': 'operations-office',
      'Executive District': 'partner-office',
      'Client Corridor': 'client-site',
    }
    return districtScenes.find((point) => point.data.slug === preferred[districtName]) ?? districtScenes[0]
  }
  const selectedDistrictRooms = selectedPoint.kind === 'district' ? selectedPoint.data.scenes : []
  const selectedDistrictRecommended = selectedPoint.kind === 'district' ? recommendedScene(selectedPoint.data.name) : undefined

  const switchLayer = (next: 'scenes' | 'firm' | 'rivals') => {
    setLayer(next)
    const activeDistrictPoint = districtPoints.find((point) => point.data.name === activeDistrict) ?? districtPoints[0]
    setSelected(next === 'scenes' ? activeDistrictPoint.key : next === 'firm' ? `tier-${game.office_tier}` : rivalPoints[0]?.key ?? '')
    setZoom(1)
    setCameraCenter({ x: 50, y: 50 })
  }

  const focusDistrict = (districtName: string) => {
    setActiveDistrict(districtName)
    if (districtName === 'all') {
      setZoom(1)
      setCameraCenter({ x: 50, y: 50 })
      return
    }
    const district = mapDistricts.find((item) => item.name === districtName)
    if (district) {
      setZoom(1.2)
      setCameraCenter(district.hub)
      setSelected(`district-${district.id}`)
    }
  }

  const handleMapKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key.toLowerCase() === 'e' && nearby && !(event.target as HTMLElement).matches('button, a')) {
      event.preventDefault()
      setSelected(nearby.key)
      if (nearby.kind === 'district') {
        const nextRoom = recommendedScene(nearby.data.name)
        if (nextRoom) onScene(nextRoom.data.slug)
      } else {
        onManage(nearby.kind === 'tier' ? 'upgrades' : 'rivals')
      }
      return
    }
    walker.handleKeyDown(event)
  }

  return (
    <div className="empire-explorer game-viewport" role="region" aria-label="Explorable legal empire map. Focus this area to use movement keys." tabIndex={0} onKeyDown={handleMapKeyDown}>
      <div className="map-layer-tabs" role="group" aria-label="Map layers">
        <button aria-pressed={layer === 'scenes'} className={layer === 'scenes' ? 'active' : ''} onClick={() => switchLayer('scenes')}>JOURNEY</button>
        <button aria-pressed={layer === 'firm'} className={layer === 'firm' ? 'active' : ''} onClick={() => switchLayer('firm')}>FIRM</button>
        <button aria-pressed={layer === 'rivals'} className={layer === 'rivals' ? 'active' : ''} onClick={() => switchLayer('rivals')}>RIVALS</button>
      </div>
      {layer === 'scenes' && <div className="map-district-tabs" role="group" aria-label="Scene districts">
        <button aria-pressed={activeDistrict === 'all'} className={activeDistrict === 'all' ? 'active' : ''} onClick={() => focusDistrict('all')}><strong>ALL CITY</strong><small>{scenePoints.filter((point) => game.office_tier >= point.data.minTier).length}/{scenePoints.length}</small></button>
        {districtStats.map((district) => <button aria-pressed={activeDistrict === district.name} key={district.id} className={activeDistrict === district.name ? `active ${district.id}` : district.id} onClick={() => focusDistrict(district.name)}><strong>{district.short}</strong><small>{district.open}/{district.total}</small></button>)}
      </div>}
      <div className="map-camera-controls" role="group" aria-label="Map zoom controls">
        <button onClick={() => setZoom((current) => Math.min(1.55, current + .15))} aria-label="Zoom in">+</button>
        <button onClick={() => setZoom((current) => Math.max(1, current - .15))} aria-label="Zoom out">−</button>
        <button onClick={() => { setZoom(1); setCameraCenter({ x: 50, y: 50 }); setActiveDistrict('all') }} aria-label="Reset map overview">⌂</button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <div className="empire-terrain" style={{ transform: `scale(${zoom})`, transformOrigin: `${cameraCenter.x}% ${cameraCenter.y}%` }}>
        <PixelWebGLAtmosphere accent="#79d3c6" className="map-webgl" variant="map" intensity={1.35} />
        <svg className="map-city-plan" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g className="map-district-shapes">
            {mapDistricts.map((district) => <polygon key={district.id} className={`${district.id} ${activeDistrict === district.name ? 'active' : ''}`} points={district.points} />)}
          </g>
          <g className="map-transit-network">
            {layer === 'firm' && <polyline className="progression-route firm-route" points={tierPositions.map((position) => `${position.x},${position.y}`).join(' ')} />}
            {layer === 'rivals' && <polyline className="progression-route rival-row-route" points={rivalPositions.map((position) => `${position.x},${position.y}`).join(' ')} />}
            {layer === 'scenes' && activeDistrict !== 'all' && <circle className="district-focus-ring" cx={mapDistricts.find((district) => district.name === activeDistrict)?.hub.x} cy={mapDistricts.find((district) => district.name === activeDistrict)?.hub.y} r="4" />}
          </g>
        </svg>
        <div className="terrain-speckles">{Array.from({ length: 28 }, (_, index) => <i key={index} />)}</div>
        <div className="map-water"><i /><i /><i /><span className="map-boat">▰</span></div>
        <div className="map-park park-one">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
        <div className="map-park park-two">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
        {cityPlan.roads.map((road) => (
          <div
            className={`map-road planned-road ${road.orientation}`}
            data-road={road.name}
            key={road.id}
            style={{ left: `${road.x}%`, top: `${road.y}%`, width: `${road.w}%`, height: `${road.h}%` }}
          >
            {road.traffic === 'forward' && <div className="road-traffic traffic-one"><i /><i /><i /></div>}
            {road.traffic === 'reverse' && <div className="road-traffic traffic-two"><i /><i /></div>}
          </div>
        ))}
        <div className="map-bridge" style={{ left: `${cityPlan.bridge.x}%`, top: `${cityPlan.bridge.y}%`, width: `${cityPlan.bridge.w}%`, height: `${cityPlan.bridge.h}%` }}><i /><i /><i /><i /></div>
        <PixelMapRail style={{ left: `${cityPlan.rail.x}%`, bottom: `${cityPlan.rail.bottom}%`, width: `${cityPlan.rail.w}%` }} />
        <div className="map-city-blocks" aria-hidden="true">
          {cityBlocks.map((block, index) => <i key={index} className={`map-city-block ${block.kind}`} style={{ left: `${block.x}%`, top: `${block.y}%`, width: `${block.w}%`, height: `${block.h}%` }}><b /><span /></i>)}
        </div>
        <div className="map-landmarks" aria-hidden="true">
          <div className="map-landmark landmark-library"><i /><b /><span>LAW LIBRARY</span></div>
          <div className="map-landmark landmark-court"><i /><b /><span>COURTHOUSE</span></div>
          <div className="map-landmark landmark-tower"><i /><b /><span>PARTNER ROW</span></div>
          <div className="map-landmark landmark-campus"><i /><b /><span>FIRM CAMPUS</span></div>
        </div>
        <div className="map-streetlights">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
        <div className="map-fountain"><i /><b /><span /></div>
        <div className="map-birds"><i /><i /><i /><i /></div>
        <div className="leaf-particles">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
        {game.office_tier >= 4 && <div className="map-helicopter"><i /><b /><span /></div>}
        <div className="map-cloud map-cloud-a" /><div className="map-cloud map-cloud-b" />
        {layer === 'firm' && game.catalog.tiers.map((tier, index) => {
          const position = tierPositions[index]
          const status = tier.tier < game.office_tier ? 'complete' : tier.tier === game.office_tier ? 'current' : 'future'
          return (
            <button
              className={`empire-node tier-map-node ${status} ${selected === `tier-${tier.tier}` ? 'selected' : ''} ${nearby?.key === `tier-${tier.tier}` ? 'is-near' : ''}`}
              key={tier.tier}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              onClick={() => { setSelected(`tier-${tier.tier}`); setInspectorOpen(true) }}
              onFocus={() => setSelected(`tier-${tier.tier}`)}
              aria-pressed={selected === `tier-${tier.tier}`}
            >
              <PixelBuilding tier={tier.tier} locked={status === 'future'} />
              <span><b>{tier.name}</b><small>TIER {tier.tier} · {status}</small></span>
            </button>
          )
        })}
        {layer === 'rivals' && rivals.map((rival, index) => {
          const position = rivalPositions[index] ?? { x: 82, y: 82 }
          return (
            <button
              className={`empire-node rival-map-node ${rival.owned ? 'owned' : ''} ${selected === `rival-${rival.key}` ? 'selected' : ''} ${nearby?.key === `rival-${rival.key}` ? 'is-near' : ''}`}
              key={rival.key}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              onClick={() => { setSelected(`rival-${rival.key}`); setInspectorOpen(true) }}
              onFocus={() => setSelected(`rival-${rival.key}`)}
              aria-pressed={selected === `rival-${rival.key}`}
            >
              <div className="rival-building"><div className="rival-smoke"><i /><i /><i /></div><i>R</i><b /><b /><b /><span /></div>
              <span><b>{rival.name.replace('Acquire ', '')}</b><small>{rival.owned ? 'ACQUIRED' : 'RIVAL FIRM'}</small></span>
            </button>
          )
        })}
        {layer === 'scenes' && districtPoints.map((point) => {
          const district = point.data
          const nextRoom = recommendedScene(district.name)
          return (
            <button
              className={`district-hub-node ${district.id} ${selected === point.key ? 'selected' : ''} ${nearby?.key === point.key ? 'is-near' : ''} ${activeDistrict !== 'all' && activeDistrict !== district.name ? 'district-dimmed' : ''}`}
              key={district.id}
              style={{ left: `${point.position.x}%`, top: `${point.position.y}%` }}
              onClick={() => { focusDistrict(district.name); setSelected(point.key); setInspectorOpen(true) }}
              onFocus={() => setSelected(point.key)}
              onDoubleClick={() => nextRoom && onScene(nextRoom.data.slug)}
              tabIndex={activeDistrict !== 'all' && activeDistrict !== district.name ? -1 : 0}
              aria-pressed={selected === point.key}
              aria-label={`${district.name}. ${district.open} of ${district.total} rooms open.`}
            >
              <div className="district-hub-building"><i>{district.symbol}</i><b /><b /><b /></div>
              <span><strong>{district.short}</strong><small>{district.open}/{district.total} ROOMS · {nextRoom ? `NEXT: ${nextRoom.data.shortTitle}` : 'LOCKED'}</small></span>
            </button>
          )
        })}
        <div className="world-person map-player" style={{ left: `${walker.position.x}%`, top: `${walker.position.y}%` }}>
          <PixelPerson gender={game.character_gender} tier={game.office_tier} direction={walker.direction} walking={walker.walking} label={`${game.lawyer_name}, map explorer`} />
        </div>
        <div className="scanlines" />
      </div>
      <div className="map-compass"><i>N</i><span>✦</span></div>
      <div className="map-legend" aria-label={`${layer === 'scenes' ? 'journey' : layer} map legend`}>
        {layer === 'scenes' ? <><span><i className="legend-campus" />CAMPUS</span><span><i className="legend-owned" />OPEN ROOMS</span><span><i className="legend-rival" />LOCKED ROOMS</span></>
          : layer === 'firm' ? <><span><i className="legend-owned" />COMPLETE</span><span><i className="legend-current" />CURRENT</span><span><i className="legend-rival" />FUTURE</span></>
            : <><span><i className="legend-owned" />ACQUIRED</span><span><i className="legend-rival" />RIVAL</span></>}
      </div>
      <div className={`empire-inspector ${inspectorOpen ? 'open' : ''}`} aria-live="polite">
        <button className="map-inspector-toggle" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}>{inspectorOpen ? 'HIDE FILE' : 'SHOW SELECTED FILE'}</button>
        <span>{selectedPoint.kind === 'district' ? 'DISTRICT CASE JOURNEY' : selectedPoint.kind === 'tier' ? 'FIRM ASCENSION ROUTE' : 'GRAND AVENUE RIVAL'}</span>
        <h2>{selectedPoint.kind === 'district' ? selectedPoint.data.name : selectedPoint.data.name.replace('Acquire ', '')}</h2>
        <p>{selectedPoint.kind === 'district' ? selectedPoint.data.description : selectedPoint.kind === 'tier' ? selectedPoint.data.short : selectedPoint.data.description}</p>
        <div>
          {selectedPoint.kind === 'district' ? <><b>{selectedPoint.data.open}/{selectedPoint.data.total} OPEN</b><b>{selectedDistrictRecommended ? `NEXT · ${selectedDistrictRecommended.data.shortTitle}` : 'NO OPEN ROOMS'}</b></> : <><b>${selectedPoint.data.cost.toLocaleString()}</b><b>★ {selectedPoint.data.reputation} REP</b></>}
        </div>
        {selectedPoint.kind === 'district' && <>
          <div className="inspector-district-status"><span>{selectedPoint.data.short} CAMPUS</span><i><b style={{ width: `${Math.round(selectedPoint.data.open / Math.max(1, selectedPoint.data.total) * 100)}%` }} /></i></div>
          <div className="district-room-list" aria-label={`${selectedPoint.data.name} rooms`}>
            {selectedDistrictRooms.map((room) => {
              const locked = game.office_tier < room.data.minTier
              return <button type="button" disabled={locked} key={room.data.slug} onClick={() => onScene(room.data.slug)}><span>{room.data.id}</span><strong>{room.data.shortTitle}</strong><small>{locked ? `TIER ${room.data.minTier}` : room.data.category.toUpperCase()}</small></button>
            })}
          </div>
        </>}
        <button className="pixel-action" disabled={selectedPoint.kind === 'district' && !selectedDistrictRecommended} onClick={() => selectedPoint.kind === 'district' ? selectedDistrictRecommended && onScene(selectedDistrictRecommended.data.slug) : onManage(selectedPoint.kind === 'tier' ? 'upgrades' : 'rivals')}>
          {selectedPoint.kind === 'district' ? selectedDistrictRecommended ? `ENTER ${selectedDistrictRecommended.data.shortTitle.toUpperCase()}` : 'DISTRICT LOCKED' : selectedPoint.kind === 'tier' ? 'MANAGE OFFICE' : 'VIEW ACQUISITION'} <i>›</i>
        </button>
      </div>
      <div className={`interaction-toast map-interaction ${nearby ? 'visible' : ''}`}><kbd>E</kbd><span><strong>Travel to next room</strong><small>{nearby ? nearby.kind === 'district' ? nearby.data.name : nearby.data.name : 'Walk near a destination'}</small></span></div>
      <WorldControls nudge={walker.nudge} />
    </div>
  )
}

export function MiniAvatar({ gender, tier = 0 }: { gender: CharacterGender; tier?: number }) {
  return <div className="mini-avatar pixel-mini-avatar"><PixelPerson gender={gender} tier={tier} variant={0} /></div>
}
