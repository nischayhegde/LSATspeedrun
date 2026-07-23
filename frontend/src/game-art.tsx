import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CharacterGender, GameState } from './types'

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

function PixelPerson({
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
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      <i className="pp-shadow" />
      <i className="pp-leg pp-leg-left" />
      <i className="pp-leg pp-leg-right" />
      <i className="pp-body" style={{ backgroundColor: jacket }} />
      <i className="pp-shirt" />
      <i className="pp-tie" style={{ backgroundColor: tier >= 5 ? '#e0b960' : '#b95749' }} />
      <i className="pp-lapel pp-lapel-left" />
      <i className="pp-lapel pp-lapel-right" />
      <i className="pp-belt" />
      <i className="pp-arm pp-arm-left" style={{ backgroundColor: jacket }} />
      <i className="pp-arm pp-arm-right" style={{ backgroundColor: jacket }} />
      <i className="pp-hand pp-hand-left" style={{ backgroundColor: skin }} />
      <i className="pp-hand pp-hand-right" style={{ backgroundColor: skin }} />
      <i className="pp-head" style={{ backgroundColor: skin }} />
      <i className={`pp-hair ${gender === 'female' ? 'long' : ''}`} style={{ backgroundColor: hair }} />
      <i className="pp-eyes" />
      <i className="pp-brows" />
      <i className="pp-nose" />
      <i className="pp-mouth" />
      <i className="pp-shoes" />
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
              <div className="rival-building"><div className="rival-smoke"><i /><i /><i /></div><i>R</i><b /><b /><b /><span /></div>
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
