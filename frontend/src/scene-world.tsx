import { type CSSProperties, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Coins,
  DoorOpen,
  Lock,
  MapPinned,
  Play,
  Star,
  UsersRound,
} from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { api } from './api'
import { CaseJourneyRail, ErrorNotice, formatMoney, LoadingScreen } from './components'
import { PixelPerson } from './game-art'
import { PixelWebGLAtmosphere } from './pixel-webgl'
import { learnerScenes, sceneBySlug, type SceneAction, type SceneDefinition } from './scene-registry'
import { journeyStageForScene } from './scene-workflow'
import type { GameState, StudySession } from './types'

const characterPositions = [
  { left: '42%', top: '75%' }, { left: '58%', top: '70%' },
  { left: '72%', top: '78%' }, { left: '27%', top: '72%' },
]

type Inspection = { kind: 'NEXT STEP' | 'COLLEAGUE' | 'OFFICE DETAIL'; label: string; detail: string }

function actionTarget(action: SceneAction, session?: StudySession | null) {
  if (action.to !== '/cases?view=active') return action.to
  return session ? `/cases/${session.id}` : '/cases'
}

function actionDetail(action: SceneAction, session?: StudySession | null) {
  if (action.to !== '/cases?view=active') return action.detail
  return session ? `Resume case ${session.current_index + 1} of ${session.total_items}. Your draft and elapsed time are saved.` : 'No file is open. Return to the Docket to choose rewarded work.'
}

function roomBrief(scene: SceneDefinition, game: GameState, session?: StudySession | null) {
  const accuracy = game.total_cases ? Math.round((game.total_correct / game.total_cases) * 100) : 0
  if (scene.category === 'casework') return {
    kicker: 'CURRENT CASE',
    headline: session ? 'An active file is waiting.' : 'The docket is ready.',
    detail: session ? `Matter ${Math.min(session.current_index + 1, session.total_items)} of ${session.total_items} is ready to resume.` : 'Choose a next step to open a verified question.',
    metrics: [[session ? `${session.current_index + 1}/${session.total_items}` : 'READY', 'DOCKET'], [`${accuracy}%`, 'ACCURACY'], [game.active_client.name, 'CLIENT']],
  }
  if (scene.category === 'learning') return {
    kicker: 'PRACTICE RECORD',
    headline: `${game.total_validated_correct} explanations met the standard.`,
    detail: 'Review the reasoning, repair the first weak step, and apply the lesson to another case.',
    metrics: [[String(game.total_cases), 'CASES'], [`${accuracy}%`, 'ACCURACY'], [String(game.best_streak), 'BEST STREAK']],
  }
  if (scene.category === 'firm') return {
    kicker: 'FIRM SNAPSHOT',
    headline: `${game.office.name} · Tier ${game.office_tier}`,
    detail: 'Earned fees and Reputation fund the people, tools, and space that support the practice.',
    metrics: [[formatMoney(game.cash, true), 'CASH'], [game.reputation.toFixed(1), 'REPUTATION'], [String(game.owned_assets.length), 'ASSETS']],
  }
  if (scene.category === 'social') return {
    kicker: 'TODAY’S PRACTICE',
    headline: `${game.daily.cases_completed} matters closed today.`,
    detail: 'Take a moment to review your progress and choose the next manageable piece of work.',
    metrics: [[String(game.current_streak), 'STREAK'], [String(game.daily.cases_completed), 'TODAY'], [formatMoney(game.firm_valuation, true), 'FIRM VALUE']],
  }
  return {
    kicker: 'AROUND THE FIRM',
    headline: `${scene.district} is within reach.`,
    detail: 'Choose a destination in the office, a learning space, or elsewhere in the city.',
    metrics: [[`T${game.office_tier}`, 'FIRM TIER'], [game.reputation.toFixed(1), 'REPUTATION'], [String(game.owned_assets.length), 'ASSETS']],
  }
}

function SceneFixture({ scene, inspection, onInspect }: { scene: SceneDefinition; inspection: Inspection | null; onInspect: (inspection: Inspection) => void }) {
  return (
    <>
      <div className="scene-ceiling"><i /><i /><i /></div>
      <div className="scene-back-wall">
        <div className="scene-window"><i /><i /><i /><b /></div>
        <button type="button" className={`scene-wall-display ${inspection?.label === scene.shortTitle ? 'selected' : ''}`} aria-pressed={inspection?.label === scene.shortTitle} onClick={() => onInspect({ kind: 'OFFICE DETAIL', label: scene.shortTitle, detail: scene.purpose })}><span>{scene.kicker}</span><strong>{scene.shortTitle}</strong><i /></button>
      </div>
      <div className="scene-floor-plane"><i /><i /><i /><i /><i /></div>
      <div className="scene-depth-rig"><i /><i /><i /></div>
      <div className="scene-main-fixture"><i /><b /><span /></div>
      <div className="scene-side-fixture left"><i /><b /></div>
      <div className="scene-side-fixture right"><i /><b /></div>
      <div className="scene-layout-emblem">§</div>
      <div className="scene-prop-row" aria-label="Office details">
        {scene.props.map((item, index) => <button type="button" key={item} className={`scene-prop prop-${index + 1} ${inspection?.label === item ? 'selected' : ''}`} aria-pressed={inspection?.label === item} onClick={() => onInspect({ kind: 'OFFICE DETAIL', label: item, detail: scene.purpose })}><i /><b>{item}</b></button>)}
      </div>
    </>
  )
}

function PixelScene({
  scene,
  game,
  locked,
  selectedAction,
  inspection,
  onSelectAction,
  onInspect,
}: {
  scene: SceneDefinition
  game: GameState
  locked: boolean
  selectedAction: number
  inspection: Inspection | null
  onSelectAction: (index: number) => void
  onInspect: (inspection: Inspection) => void
}) {
  const style = {
    '--scene-wall': scene.palette.wall,
    '--scene-floor': scene.palette.floor,
    '--scene-accent': scene.palette.accent,
    '--scene-dark': scene.palette.dark,
  } as CSSProperties
  return (
    <div className={`scene-pixel-shell layout-${scene.layout} ${locked ? 'scene-locked' : ''}`} style={style}>
      <PixelWebGLAtmosphere accent={scene.palette.accent} className="scene-webgl" variant="scene" intensity={1.35} />
      <div className="scene-pixel-room">
        <SceneFixture scene={scene} inspection={inspection} onInspect={onInspect} />
        {scene.cast.slice(0, 4).map((role, index) => (
          <button type="button" className={`scene-cast-member cast-${index + 1} ${inspection?.label === role ? 'selected' : ''}`} aria-pressed={inspection?.label === role} style={characterPositions[index]} key={`${role}-${index}`} onClick={() => onInspect({ kind: 'COLLEAGUE', label: role, detail: role === 'YOU' ? `${game.lawyer_name}, counsel for ${game.active_client.name}.` : `${role} is here to support the work in ${scene.shortTitle}.` })}>
            <PixelPerson gender={role === 'YOU' ? game.character_gender : index % 2 ? 'male' : 'female'} tier={game.office_tier} variant={role === 'YOU' ? 0 : index + 1} label={role} />
            <span>{role}</span>
          </button>
        ))}
        {!locked && scene.actions.slice(0, 3).map((action, index) => (
          <button type="button" key={action.label} className={`scene-world-hotspot hotspot-${index + 1} ${selectedAction === index ? 'selected' : ''}`} onClick={() => onSelectAction(index)} aria-pressed={selectedAction === index} aria-label={`Select action ${index + 1}: ${action.label}`}>
            <i>{index + 1}</i><span>{action.label}</span>
          </button>
        ))}
        <div className="scene-scanlines" />
        {locked && <div className="scene-lock-overlay"><Lock /><strong>{scene.internal ? 'STAFF ACCESS ONLY' : `UNLOCKS AT FIRM TIER ${scene.minTier}`}</strong><span>You can preview this space now. Its work opens with the required firm tier.</span></div>}
      </div>
    </div>
  )
}

export function WorldScenePage() {
  const { sceneSlug } = useParams()
  const navigate = useNavigate()
  const scene = sceneSlug ? sceneBySlug.get(sceneSlug) : undefined
  const gameQuery = useQuery({ queryKey: ['game'], queryFn: api.game })
  const sessionQuery = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const [selectedAction, setSelectedAction] = useState(0)
  const [inspection, setInspection] = useState<Inspection | null>(null)

  useEffect(() => {
    setSelectedAction(0)
    setInspection(scene?.actions[0] ? { kind: 'NEXT STEP', label: scene.actions[0].label, detail: scene.actions[0].detail } : null)
  }, [scene?.slug])

  useEffect(() => {
    if (!scene) return
    const shortcuts = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('a, button, input, textarea, select, [contenteditable="true"]')) return
      const index = Number(event.key) - 1
      if (index >= 0 && index < scene.actions.length) {
        event.preventDefault()
        setSelectedAction(index)
        setInspection({ kind: 'NEXT STEP', label: scene.actions[index].label, detail: scene.actions[index].detail })
      }
      if (event.key === 'Enter' && scene.actions[selectedAction]) {
        event.preventDefault()
        navigate(actionTarget(scene.actions[selectedAction], sessionQuery.data?.session))
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  }, [navigate, scene, selectedAction, sessionQuery.data?.session])

  if (!scene) return <Navigate to="/map" replace />
  if (gameQuery.isLoading || sessionQuery.isLoading) return <LoadingScreen label="Opening the room…" />
  if (gameQuery.error || sessionQuery.error) return <div className="page-wrap"><ErrorNotice error={gameQuery.error || sessionQuery.error} /></div>

  const game = gameQuery.data!.game!
  const session = sessionQuery.data?.session
  const locked = Boolean(scene.internal) || game.office_tier < scene.minTier
  const index = learnerScenes.findIndex((candidate) => candidate.id === scene.id)
  const learnerIndex = index < 0 ? 0 : index
  const previous = learnerScenes[(learnerIndex - 1 + learnerScenes.length) % learnerScenes.length]
  const next = learnerScenes[(learnerIndex + 1) % learnerScenes.length]
  const brief = roomBrief(scene, game, session)
  const journeyStage = journeyStageForScene(scene.slug)
  const selected = scene.actions[Math.min(selectedAction, scene.actions.length - 1)]
  const selectAction = (actionIndex: number) => {
    const action = scene.actions[actionIndex]
    setSelectedAction(actionIndex)
    setInspection({ kind: 'NEXT STEP', label: action.label, detail: actionDetail(action, session) })
  }
  const style = { '--scene-accent': scene.palette.accent, '--scene-dark': scene.palette.dark } as CSSProperties

  return (
    <div className="world-scene-page" style={style}>
      <nav className="scene-world-nav" aria-label="Scene world navigation">
        <Link className="scene-map-return" to="/map"><MapPinned />CITY DIRECTORY</Link>
        <div className="scene-location"><span>{scene.district.toUpperCase()}</span><strong>{scene.shortTitle}</strong><small>{scene.internal ? 'INTERNAL' : `${learnerIndex + 1} / ${learnerScenes.length}`}</small></div>
        <div className="scene-neighbor-controls">
          <Link to={`/world/${previous.slug}`} aria-label={`Previous room: ${previous.shortTitle}`}><ArrowLeft /><span>PREVIOUS<strong>{previous.shortTitle}</strong></span></Link>
          <Link to={`/world/${next.slug}`} aria-label={`Next room: ${next.shortTitle}`}><span>NEXT<strong>{next.shortTitle}</strong></span><ArrowRight /></Link>
        </div>
      </nav>

      <section className="scene-command-bar">
        <div><span className="pixel-kicker">{scene.kicker}</span><h1>{scene.title}</h1><p>{scene.purpose}</p></div>
        <div className="scene-state-chips"><span><Coins />{formatMoney(game.cash, true)}</span><span><Star />{game.reputation.toFixed(1)}</span><span className={session ? 'active' : ''}><BriefcaseBusiness />{session ? 'ACTIVE FILE' : 'DOCKET READY'}</span></div>
      </section>

      {journeyStage && <CaseJourneyRail current={journeyStage} />}

      <div className="scene-experience-grid">
        <PixelScene scene={scene} game={game} locked={locked} selectedAction={selectedAction} inspection={inspection} onSelectAction={selectAction} onInspect={setInspection} />
        <aside className="scene-control-desk" aria-label="Matter desk">
          <PixelWebGLAtmosphere accent={scene.palette.accent} className="scene-ui-webgl" variant="scene" intensity={1.7} />
          <div className="scene-console-header"><span>MATTER DESK</span><strong>{scene.shortTitle}</strong></div>
          <section className="scene-live-brief">
            <span>{brief.kicker}</span><h2>{brief.headline}</h2><p>{brief.detail}</p>
            <div>{brief.metrics.map(([value, label]) => <article key={label}><strong>{value}</strong><small>{label}</small></article>)}</div>
          </section>
          <section className="scene-inspection" aria-live="polite">
            <span>{inspection?.kind ?? 'OFFICE DETAIL'}</span>
            <h3>{inspection?.label ?? scene.shortTitle}</h3>
            <p>{inspection?.detail ?? scene.purpose}</p>
          </section>
          <div className="scene-action-heading"><span>CHOOSE A NEXT STEP</span><small>Keys 1–3 select</small></div>
          <div className="scene-action-stack">
            {scene.actions.map((action, actionIndex) => (
              <button type="button" disabled={locked} className={selectedAction === actionIndex ? 'selected' : ''} onClick={() => selectAction(actionIndex)} key={action.label} aria-pressed={selectedAction === actionIndex}>
                <b>{String(actionIndex + 1).padStart(2, '0')}</b><span><strong>{action.label}</strong><small>{actionDetail(action, session)}</small></span>{selectedAction === actionIndex ? <CheckCircle2 /> : <ArrowRight />}
              </button>
            ))}
          </div>
          {locked ? <Link className="scene-launch-action locked" to="/map"><Lock />RETURN TO THE CITY DIRECTORY</Link> : (
            <Link className="scene-launch-action" to={actionTarget(selected, session)}><Play />{selected.to === '/cases?view=active' && session ? 'RESUME ACTIVE FILE' : selected.label.toUpperCase()}<ArrowRight /></Link>
          )}
          <div className="scene-console-footer"><span><DoorOpen />Select a marker to learn more</span><span><BookOpen />Press Enter to open your selection</span></div>
        </aside>
      </div>

      <section className="scene-integration-strip">
        <div><Building2 /><span><strong>YOUR PLACE IS SAVED</strong><small>Visit the office, Docket, firm, or city without losing your open case.</small></span></div>
        <div><UsersRound /><span><strong>LOOK AROUND</strong><small>Select a colleague or office detail to learn more about this space.</small></span></div>
        <Link to="/office">RETURN TO HQ <ArrowRight /></Link>
      </section>
    </div>
  )
}
