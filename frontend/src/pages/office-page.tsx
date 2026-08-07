import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CircleDollarSign,
  ScrollText,
  Shirt,
  TrendingUp,
  Trophy,
  Wrench,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, formatMoney, LoadingScreen } from '../components'
import { OfficeEventPopup } from '../office-event'
import { ClientPortrait, ExplorableOffice } from '../game-art'
import { openEpilogue } from '../narrative'
import { useAmbientMusic, useSound } from '../sound'
import { WardrobePanel } from '../wardrobe'
import { effectiveClient, useGame } from './shared'


export function OfficePage() {
  const navigate = useNavigate()
  const { play } = useSound()
  useAmbientMusic('office')
  const [mobileBriefOpen, setMobileBriefOpen] = useState(false)
  const [wardrobeOpen, setWardrobeOpen] = useState(false)
  const gameQuery = useGame()
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const start = useMutation({
    mutationFn: () => api.startPractice({ size: 3 }),
    onSuccess: ({ session }) => {
      void play('file-open', { id: `office-case-open:${session.id}`, seed: session.id, intensity: .58 })
      navigate(`/cases/${session.id}`)
    },
  })
  if (gameQuery.isLoading || current.isLoading) return <LoadingScreen />
  if (gameQuery.error) return <div className="contained"><ErrorNotice error={gameQuery.error} /></div>
  const game = gameQuery.data!.game!
  const workingClient = effectiveClient(game)
  const active = current.data?.session
  const activeItem = active?.pending_item ?? active?.current_item
  const activeCase = active ? {
    sessionId: active.id,
    clientKey: activeItem?.case_terms?.client_key ?? game.active_client.effective_key,
    clientName: activeItem?.case_terms?.client_name ?? workingClient.name,
    baseFee: activeItem?.case_terms?.base_fee ?? workingClient.base_fee,
  } : null
  const milestone = game.next_milestone
  const milestoneProgress = milestone ? Math.min(100, Math.round(game.cash / Math.max(1, milestone.cost) * 100)) : 100

  const openCase = () => active ? navigate(`/cases/${active.id}`) : start.mutate()

  return (
    <div className="office-page office-game-page">
      {current.error && (
        <div className="partial-load-notice">
          <ErrorNotice error={current.error} retrying={current.isFetching} onRetry={() => void current.refetch()} />
          <p>Your active case could not be checked, so the office may not show work already in progress.</p>
        </div>
      )}
      <div className="office-mobile-scene-status" aria-hidden="true">
        <small>HQ {game.office_tier + 1} · {game.reputation_band.name.toUpperCase()}</small>
        <strong>{game.office.name}</strong>
      </div>
      <button
        type="button"
        className="office-mobile-brief-toggle"
        aria-expanded={mobileBriefOpen}
        aria-controls="office-mobile-brief-sheet"
        onClick={() => {
          void play(mobileBriefOpen ? 'paper' : 'ledger', { seed: 'office-mobile-brief', intensity: .24 })
          setMobileBriefOpen((open) => !open)
        }}
      >
        <BriefcaseBusiness size={16} />
        <span>Today</span>
      </button>
      {mobileBriefOpen && (
        <aside className="office-mobile-brief-sheet" id="office-mobile-brief-sheet" role="dialog" aria-modal="true" aria-labelledby="office-mobile-brief-title">
          <header>
            <div><small>OFFICE BRIEF</small><h2 id="office-mobile-brief-title">Today at the firm</h2></div>
            <button type="button" aria-label="Close office brief" onClick={() => setMobileBriefOpen(false)}>×</button>
          </header>
          <button type="button" className="office-mobile-current-case" onClick={() => { setMobileBriefOpen(false); openCase() }}>
            <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
            <span><small>{active ? 'CASE IN PROGRESS' : 'ACTIVE CLIENT'}</small><strong>{workingClient.name}</strong><em>{game.active_client.cases_remaining} files · {formatMoney(workingClient.base_fee)} base</em></span>
            <b>{active ? 'Resume' : 'Start'} <ArrowRight size={15} /></b>
          </button>
          <div className="office-mobile-brief-metrics">
            <span><small>TRAINING</small><strong>{game.daily.cases_completed}/10</strong><em>questions today</em></span>
            <span><small>ACCURACY</small><strong>{game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0}%</strong><em>{game.total_cases} measured</em></span>
            <span><small>LEASE</small><strong>{game.upkeep.completed ? 'Closed' : formatMoney(game.upkeep.daily_rent, true)}</strong><em>{game.upkeep.completed ? 'charter complete' : 'per day'}</em></span>
          </div>
          <div className="office-mobile-next-office">
            <span><small>NEXT OFFICE</small><strong>{milestone?.name ?? 'Empire complete'}</strong></span>
            {milestone && <div><i style={{ width: `${milestoneProgress}%` }} /><small>{formatMoney(Math.max(0, milestone.cost - game.cash), true)} to go</small></div>}
          </div>
          <nav aria-label="Office actions">
            <button type="button" onClick={() => { setMobileBriefOpen(false); navigate('/progress') }}><BarChart3 size={17} />Progress</button>
            <button type="button" onClick={() => { setMobileBriefOpen(false); navigate('/firm') }}><Wrench size={17} />Build</button>
            <button type="button" onClick={() => { setMobileBriefOpen(false); navigate('/story') }}><ScrollText size={17} />Caseboard</button>
            {/* A phone hides the office portrait, and with it the plaque the
                wardrobe normally hangs under, so the brief carries the way in. */}
            <button type="button" className="wardrobe-brief-action" onClick={() => { setMobileBriefOpen(false); setWardrobeOpen(true) }}><Shirt size={17} />Wardrobe</button>
          </nav>
        </aside>
      )}
      {wardrobeOpen && <WardrobePanel game={game} onClose={() => setWardrobeOpen(false)} />}
      <section className="office-command-bar">
        <div>
          <span className="pixel-kicker">{game.reputation_band.name.toUpperCase()} COUNSEL · HQ LEVEL {game.office_tier}</span>
          <h1>{new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}, {game.lawyer_name.split(' ')[0]}. <em>The office is alive.</em></h1>
        </div>
        <div className="command-stats">
          <span><small>FIRM VALUE</small><strong>{formatMoney(game.firm_valuation, true)}</strong><TrendingUp /></span>
          <span><small>ACTIVE CLIENT</small><strong>{workingClient.name}</strong><BriefcaseBusiness /></span>
          <span className={game.upkeep.rent_arrears ? 'has-arrears' : ''}><small>{game.upkeep.completed ? 'LEASE RETIRED' : 'DAILY LEASE'}</small><strong>{game.upkeep.completed ? 'Charter complete' : `${formatMoney(game.upkeep.daily_rent, true)} / day`}</strong><CircleDollarSign /></span>
        </div>
      </section>

      <section className="office-world-shell">
        <ExplorableOffice
          game={game}
          activeCase={activeCase}
          onCase={openCase}
          onFirm={() => navigate('/firm')}
          onEmpire={() => navigate('/map')}
          onStory={() => navigate('/story')}
        />

        <aside className={`office-upkeep-strip ${game.upkeep.completed ? 'is-complete' : ''} ${game.upkeep.rent_arrears ? 'has-arrears' : ''}`}>
          <div className="office-upkeep-heading">
            <CircleDollarSign />
            <span><small>OFFICE LEASE</small><strong>{game.upkeep.completed ? 'Obligation retired' : 'Operating account'}</strong></span>
          </div>
          {game.upkeep.completed ? (
            <>
              <p>The final charter is closed. Rent and inactivity loss no longer accrue.</p>
              {game.story.epilogue && (
                <button type="button" className="office-epilogue-button" onClick={openEpilogue}>
                  <Trophy size={15} /> Read the final record
                </button>
              )}
            </>
          ) : (
            <div className="office-upkeep-terms">
              <span><small>ACTIVE RATE</small><strong>{formatMoney(game.upkeep.daily_rent)} / day</strong></span>
              <span><small>AWAY AFTER 24H</small><strong>{formatMoney(game.upkeep.offline_daily_rent)} / day</strong></span>
              <span><small>AFTER 48H AWAY</small><strong>−{game.upkeep.reputation_decay_daily} Rep / day</strong></span>
              <span className={game.upkeep.rent_arrears ? 'is-due' : ''}><small>OUTSTANDING</small><strong>{game.upkeep.rent_arrears ? formatMoney(game.upkeep.rent_arrears) : 'Current'}</strong></span>
            </div>
          )}
          <small className="office-upkeep-note">{game.upkeep.completed ? game.upkeep.completion_requirement.label : `Settles on activity · unpaid balance capped at ${formatMoney(game.upkeep.arrears_cap)}`}</small>
        </aside>

        <aside className="office-milestone-strip">
          <div className="office-milestone-copy">
            <span>NEXT OFFICE</span>
            <h2>{milestone?.name ?? 'Empire complete'}</h2>
          </div>
          {milestone ? (
            <>
              <div className="office-milestone-progress">
                <div className="pixel-meter"><i style={{ width: `${milestoneProgress}%` }} /></div>
                <p><b>{formatMoney(game.cash, true)}</b> / {formatMoney(milestone.cost, true)}</p>
                <small>{milestone.reputation > game.reputation ? `LOCKED · NEED ${milestone.reputation} REP` : `${formatMoney(Math.max(0, milestone.cost - game.cash), true)} TO GO`}</small>
              </div>
            </>
          ) : <p>Every skyline starts here.</p>}
          <button onClick={() => { void play('ledger', { seed: 'milestone', intensity: .45 }); navigate('/firm') }}>OPEN BUILD MENU <ArrowRight /></button>
        </aside>
      </section>

      <OfficeEventPopup game={game} />

      <section className="office-gamebar">
        <article className="client-quest-card">
          <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
          <div><span>ACTIVE CONTRACT</span><h3>{workingClient.name}</h3><p>{game.active_client.on_hold ? 'Original contract on hold' : `${game.active_client.cases_remaining} files remaining`} · {formatMoney(workingClient.base_fee)} base</p></div>
          <button onClick={() => {
            if (active) void play('resume', { seed: active.id, intensity: .55 })
            openCase()
          }}>{active ? 'RESUME' : 'TAKE CASE'} <ArrowRight /></button>
        </article>

        <article className="training-focus-card">
          <div><span>TODAY’S TRAINING BLOCK</span><h3>{game.daily.cases_completed} / 10 QUESTIONS</h3><p>Volume builds recognition. Reviewed reasoning makes the volume count.</p></div>
          <button onClick={openCase}>{active ? 'RESUME' : 'START'} <ArrowRight /></button>
        </article>

        <article className="training-evidence-card">
          <div><span>LEARNING EVIDENCE</span><strong>{game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0}%</strong><small>{game.total_correct} correct across {game.total_cases} questions</small></div>
          <button onClick={() => navigate('/progress')}>VIEW PROGRESS</button>
        </article>
      </section>
      {start.error && <ErrorNotice error={start.error} />}
    </div>
  )
}
