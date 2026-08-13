import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CircleDollarSign,
  ScrollText,
  Shirt,
  Trophy,
  Wrench,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, formatMoney, LoadingScreen } from '../components'
import { createDemoCursor, demoSleep, waitForPainted } from '../demo/demo-cursor'
import { OfficeEventPopup } from '../office-event'
import { ClientPortrait, ExplorableOffice } from '../game-art'
import { openEpilogue } from '../narrative'
import { useAmbientMusic, useSound } from '../sound'
import { WardrobePanel } from '../wardrobe'
import { effectiveClient, useGame } from './shared'
// The rules in `styles.css` that only this screen can render.
import '../office-page.css'
import '../mobile/office-page.css'


export function OfficePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const deckDemoKind = searchParams.get('deckDemo')
  const deckDemo = deckDemoKind === 'client'
  const deckTreasury = deckDemoKind === 'treasury'
  const { play } = useSound()
  useAmbientMusic('office')
  const [mobileBriefOpen, setMobileBriefOpen] = useState(false)
  const [wardrobeOpen, setWardrobeOpen] = useState(false)
  const [demoBeat, setDemoBeat] = useState(0)
  const gameQuery = useGame()
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const start = useMutation({
    mutationFn: () => api.startPractice({ size: 3 }),
    onSuccess: ({ session }) => {
      void play('file-open', { id: `office-case-open:${session.id}`, seed: session.id, intensity: .58 })
      navigate(`/cases/${session.id}${deckDemo ? '?deckDemo=client' : ''}`)
    },
  })
  useEffect(() => {
    if (!deckDemo || gameQuery.isLoading || current.isLoading) return
    let cancelled = false
    const cursor = createDemoCursor()
    const abort = new AbortController()
    const hotspotSelector = '.office-page[data-deck-demo="client"] .world-zone.zone-case.is-client-anchor, .office-page[data-deck-demo="client"] .world-zone.zone-case'
    void (async () => {
      const hotspot = await waitForPainted(hotspotSelector, 8_000, abort.signal)
      if (cancelled || !hotspot) return
      cursor.showAt(window.innerWidth * 0.36, window.innerHeight * 0.58)
      await demoSleep(2_800, abort.signal)
      if (cancelled) return
      await cursor.hoverClick(hotspot, { hoverMs: 1_050, moveMs: 640, signal: abort.signal })
      if (cancelled) return
      setDemoBeat(1)
      await demoSleep(2_400, abort.signal)
      if (cancelled) return
      const revealed = document.querySelector<HTMLElement>('.office-page[data-deck-demo="client"] .world-zone.zone-case.is-revealed') ?? hotspot
      await cursor.hoverClick(revealed, { hoverMs: 920, moveMs: 320, signal: abort.signal })
      if (cancelled) return
      setDemoBeat(2)
      await demoSleep(2_400, abort.signal)
      cursor.hide()
    })()
    return () => {
      cancelled = true
      abort.abort()
      cursor.destroy()
    }
  }, [deckDemo, gameQuery.isLoading, current.isLoading])
  useEffect(() => {
    if (!deckTreasury || gameQuery.isLoading) return
    let cancelled = false
    const abort = new AbortController()
    const timers: number[] = []
    const focusShelf = () => {
      const office = document.querySelector('.av-office')
      office?.dispatchEvent(new CustomEvent('office-focus-asset', { detail: { key: 'trophy_shelf' } }))
    }
    void (async () => {
      const office = await waitForPainted('.av-office', 8_000, abort.signal)
      if (cancelled || !office) return
      await demoSleep(400, abort.signal)
      if (cancelled) return
      focusShelf()
      // One retry if the shelf mesh was not in the scene on the first ping.
      timers.push(window.setTimeout(focusShelf, 800))
    })()
    return () => {
      cancelled = true
      abort.abort()
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [deckTreasury, gameQuery.isLoading])
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

  const openCase = () => active ? navigate(`/cases/${active.id}${deckDemo ? '?deckDemo=client' : ''}`) : start.mutate()
  const demoCopy = [
    ['The working office', 'The 3D room is the navigation surface. People and objects are live entry points.'],
    ['Walk-in client', `${workingClient.name} is waiting. Taking this case starts a real LSAT question.`],
    ['Resume the case', 'Retrieval, explanation, strategy — that loop is what grows the firm.'],
  ] as const
  const treasuryCopy = [
    'The fee became an object',
    'The trophy shelf is in the room because you practised. Cash moved. The office changed.',
  ] as const

  return (
    <div className="office-page office-game-page" data-deck-demo={deckTreasury ? 'treasury' : deckDemo ? 'client' : undefined}>
      {deckDemo && (
        <div className="deck-demo-sequence" data-live="true" aria-hidden="true">
          <span data-state={demoBeat === 0 ? 'active' : 'complete'}>01 · Office scene</span>
          <i />
          <span data-state={demoBeat === 1 ? 'active' : demoBeat > 1 ? 'complete' : 'next'}>02 · Click client</span>
          <i />
          <span data-state={demoBeat === 2 ? 'active' : 'next'}>03 · Resume question</span>
        </div>
      )}
      {deckTreasury && (
        <div className="deck-demo-sequence" data-live="true" aria-hidden="true">
          <span data-state="complete">01 · Treasury</span>
          <i />
          <span data-state="complete">02 · Purchase</span>
          <i />
          <span data-state="active">03 · Office updates</span>
        </div>
      )}
      {deckDemo && (
        <div className="deck-demo-caption" key={demoBeat} aria-live="polite">
          <small>PRODUCT LOOP · {String(demoBeat + 1).padStart(2, '0')}</small>
          <strong>{demoCopy[demoBeat][0]}</strong>
          <span>{demoCopy[demoBeat][1]}</span>
        </div>
      )}
      {deckTreasury && (
        <div className="deck-demo-caption" aria-live="polite">
          <small>FEES → FIRM · 03</small>
          <strong>{treasuryCopy[0]}</strong>
          <span>{treasuryCopy[1]}</span>
        </div>
      )}
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
          {/* Cash, firm value and reputation are here as well as the training
              figures, because on a phone this sheet is the only place on this
              route that has them. The economy ledger those three normally live
              in is a fixed corner card, and mobile.css stands it down on the
              office and the map so the scene's own HUD can have that corner —
              which left "$21K to go" below with no cash figure anywhere on
              screen to read it against. Compact notation, unlike the ledger:
              nothing here ticks between refetches, so there is no whole-dollar
              step for rounding to swallow. */}
          <div className="office-mobile-brief-metrics">
            <span><small>CASH</small><strong>{formatMoney(game.cash, true)}</strong><em>on hand</em></span>
            <span><small>FIRM VALUE</small><strong>{formatMoney(game.firm_valuation, true)}</strong><em>{game.reputation_band.name} counsel</em></span>
            <span><small>LEASE</small><strong>{game.upkeep.completed ? 'Closed' : formatMoney(game.upkeep.daily_rent, true)}</strong><em>{game.upkeep.completed ? 'charter complete' : 'per day'}</em></span>
            <span><small>TRAINING</small><strong>{game.daily.cases_completed}/10</strong><em>questions today</em></span>
            <span><small>ACCURACY</small><strong>{game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0}%</strong><em>{game.total_cases} measured</em></span>
            <span><small>REPUTATION</small><strong>{Math.round(game.reputation).toLocaleString()}</strong><em>standing</em></span>
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
      {/* No greeting band above the room, and no stat overlay inside it either.
          Firm value, cash and the lease all move on their own, so they live in
          the fixed economy ledger; repeating them here would be two readings of
          the same number that can disagree mid-refetch. The active client is not
          an economy figure and keeps its home below, on the ACTIVE CONTRACT
          card.

          "Visible from every screen" is true of the ledger on a desktop and not
          on a phone, where it stands down on this route and the map so the
          scene HUD can have that corner — which is why the mobile brief sheet
          above carries its own copy of the three figures. That sheet is opened
          deliberately and is gone again on the next tap, so the two readings
          are never on screen together to disagree. */}
      <section className="office-world-shell">
        <ExplorableOffice
          game={game}
          activeCase={activeCase}
          onCase={openCase}
          onFirm={() => navigate('/firm')}
          onEmpire={() => navigate('/map')}
          onStory={() => navigate('/story')}
          demo={deckDemo || deckTreasury}
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

      {deckDemo || deckTreasury ? null : <OfficeEventPopup game={game} />}

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
