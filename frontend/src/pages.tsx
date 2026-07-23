import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Award,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Coins,
  Crown,
  Flame,
  Globe2,
  Handshake,
  Lock,
  Play,
  Scale,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  UserRound,
  UsersRound,
  Wrench,
} from 'lucide-react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api } from './api'
import { Brand, CaseJourneyRail, ErrorNotice, formatMoney, LoadingScreen, PauseButton, QuestionFlow } from './components'
import { ClientPortrait, EmpireWorldMap, ExplorableOffice, MiniAvatar, OfficeScene } from './game-art'
import { PixelWebGLAtmosphere } from './pixel-webgl'
import { learnerScenes } from './scene-registry'
import type { CharacterGender, GameAsset, GameClient, GameResponse, GameState, PracticeSummary } from './types'


function useGame() {
  return useQuery({ queryKey: ['game'], queryFn: api.game })
}


function storeGame(queryClient: ReturnType<typeof useQueryClient>, game: GameState) {
  queryClient.setQueryData<GameResponse>(['game'], (current) => ({ game, pending_reviews: current?.pending_reviews ?? [] }))
}


function storeAuthenticatedUser(queryClient: ReturnType<typeof useQueryClient>, data: Awaited<ReturnType<typeof api.me>>) {
  queryClient.clear()
  queryClient.setQueryData(['me'], data)
}


function effectiveClient(game: GameState): GameClient {
  return game.catalog.clients.find((client) => client.key === game.active_client.effective_key) ?? game.active_client
}


export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [authError, setAuthError] = useState<unknown>(null)
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig })
  const existing = useQuery({ queryKey: ['me'], queryFn: api.me })

  useEffect(() => {
    if (existing.data?.user) navigate(existing.data.user.next_route, { replace: true })
  }, [existing.data, navigate])

  useEffect(() => {
    if (!config.data?.google_client_id) return
    const finishLogin = async (credential: string) => {
      try {
        const data = await api.googleLogin(credential)
        storeAuthenticatedUser(queryClient, data)
        navigate(data.user.next_route)
      } catch (error) {
        setAuthError(error)
      }
    }
    const render = () => {
      if (!window.google || !buttonRef.current) return
      window.google.accounts.id.initialize({
        client_id: config.data!.google_client_id!,
        callback: ({ credential }) => void finishLogin(credential),
      })
      buttonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline', size: 'large', shape: 'pill', width: 320, text: 'continue_with',
      })
    }
    if (window.google) render()
    else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = render
      document.head.appendChild(script)
      return () => script.remove()
    }
  }, [config.data?.google_client_id, navigate, queryClient])

  const devLogin = useMutation({
    mutationFn: api.devLogin,
    onSuccess: (data) => {
      storeAuthenticatedUser(queryClient, data)
      navigate(data.user.next_route)
    },
  })

  return (
    <div className="login-page">
      <header className="login-nav"><Brand light /><span>Serious LSAT practice. An empire you earn.</span></header>
      <section className="login-hero">
        <div className="login-copy">
          <div className="eyebrow gold">FROM WOODEN SHACK TO LEGAL EMPIRE</div>
          <h1>Build the firm.<br /><em>Win the reasoning.</em></h1>
          <p>Every LSAT question is a case. Explain it well, earn your fee, grow your reputation, and watch a one-desk practice become a global firm.</p>
          <div className="feature-list">
            <span><Scale /> Verified answers, never AI guesses</span>
            <span><BrainIcon /> Reasoning feedback after every case</span>
            <span><Building2 /> A living office that grows with you</span>
          </div>
        </div>
        <OfficeScene previewTier={3} gender="female" className="login-scene" />
      </section>
      <aside className="login-panel-wrap">
        <div className="login-panel">
          <div className="crest"><Scale /></div>
          <span className="eyebrow">THE BAR IS OPEN</span>
          <h2>Enter your firm</h2>
          <p>Your cases, cash, reputation, character, office, and every acquisition stay with your account.</p>
          <div ref={buttonRef} className="google-button-slot" />
          {!config.isLoading && !config.data?.google_client_id && (
            <div className="config-note">Google sign-in needs <code>GOOGLE_CLIENT_ID</code>.</div>
          )}
          {config.data?.dev_auth_enabled && (
            <button className="secondary-button full" onClick={() => devLogin.mutate()} disabled={devLogin.isPending}>
              <Play size={17} /> {devLogin.isPending ? 'Opening the office…' : 'Enter local development firm'}
            </button>
          )}
          {(authError || devLogin.error) && <ErrorNotice error={authError || devLogin.error} />}
          <small>No energy. No loot boxes. No paid answer power.</small>
        </div>
      </aside>
    </div>
  )
}


function BrainIcon() {
  return <Sparkles />
}


export function OnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const gameQuery = useGame()
  const [gender, setGender] = useState<CharacterGender>('female')
  const [lawyerName, setLawyerName] = useState('')
  const [firmName, setFirmName] = useState('')

  useEffect(() => {
    if (!lawyerName && me.data?.user.display_name) setLawyerName(me.data.user.display_name)
  }, [lawyerName, me.data?.user.display_name])

  const create = useMutation({
    mutationFn: () => api.createGame({ lawyer_name: lawyerName, firm_name: firmName, character_gender: gender }),
    onSuccess: (data) => {
      queryClient.setQueryData<GameResponse>(['game'], data)
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/office', { replace: true })
    },
  })

  if (me.isLoading || gameQuery.isLoading) return <LoadingScreen />
  if (gameQuery.data?.game) return <Navigate to="/office" replace />

  return (
    <div className="onboarding-page">
      <section className="onboarding-scene-wrap">
        <OfficeScene gender={gender} previewTier={0} />
        <div className="opening-caption">
          <span>DAY ONE</span>
          <h2>One flickering lamp.<br />One client at the door.</h2>
          <p>The rest is yours to build.</p>
        </div>
      </section>
      <section className="onboarding-panel">
        <span className="step-indicator">YOUR ORIGIN · 01</span>
        <h1>Name the lawyer<br />who changes this room.</h1>
        <p>Choose your character presentation. Both have identical progression, outfits, and abilities—and you can change it later.</p>
        <div className="character-choice" role="radiogroup" aria-label="Character presentation">
          {(['female', 'male'] as CharacterGender[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={gender === value}
              className={gender === value ? 'selected' : ''}
              onClick={() => setGender(value)}
            >
              <MiniAvatar gender={value} />
              <span>{value === 'female' ? 'Female character' : 'Male character'}</span>
              {gender === value && <Check size={18} />}
            </button>
          ))}
        </div>
        <div className="name-fields">
          <label>Lawyer name<input value={lawyerName} onChange={(event) => setLawyerName(event.target.value)} maxLength={50} placeholder="Alex Morgan" /></label>
          <label>Firm name<input value={firmName} onChange={(event) => setFirmName(event.target.value)} maxLength={80} placeholder="Morgan Legal" /></label>
        </div>
        {create.error && <ErrorNotice error={create.error} />}
        <button className="primary-button onboarding-cta" disabled={lawyerName.trim().length < 2 || firmName.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Hanging the sign…' : <>Open the doors <ArrowRight /></>}
        </button>
        <small>You begin with a $250 client retainer and Reputation 50.</small>
      </section>
    </div>
  )
}


export function OfficePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const gameQuery = useGame()
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const start = useMutation({
    mutationFn: api.startPractice,
    onSuccess: ({ session }) => navigate(`/cases/${session.id}`),
  })
  const collect = useMutation({
    mutationFn: api.collectPassive,
    onSuccess: ({ game }) => storeGame(queryClient, game),
  })
  const claim = useMutation({
    mutationFn: api.claimDaily,
    onSuccess: ({ game }) => storeGame(queryClient, game),
  })

  if (gameQuery.isLoading || current.isLoading) return <LoadingScreen />
  if (gameQuery.error) return <div className="contained"><ErrorNotice error={gameQuery.error} /></div>
  const game = gameQuery.data!.game!
  const workingClient = effectiveClient(game)
  const active = current.data?.session
  const milestone = game.next_milestone
  const milestoneCashProgress = milestone ? Math.min(100, Math.round(game.cash / Math.max(1, milestone.cost) * 100)) : 100
  const milestoneRepProgress = milestone ? Math.min(100, Math.round(game.reputation / Math.max(1, milestone.reputation) * 100)) : 100

  const openCase = () => active ? navigate(`/cases/${active.id}`) : start.mutate()

  return (
    <div className="office-page office-game-page">
      <section className="office-command-bar">
        <div>
          <span className="pixel-kicker">{game.reputation_band.name.toUpperCase()} COUNSEL · HQ LEVEL {game.office_tier}</span>
          <h1>{new Date().getHours() < 12 ? 'Morning' : 'Evening'}, {game.lawyer_name.split(' ')[0]}. <em>The office is alive.</em></h1>
        </div>
        <div className="command-stats">
          <span><small>FIRM VALUE</small><strong>{formatMoney(game.firm_valuation, true)}</strong><TrendingUp /></span>
          <span><small>ACTIVE CLIENT</small><strong>{workingClient.name}</strong><BriefcaseBusiness /></span>
        </div>
      </section>

      <section className="office-world-shell">
        <ExplorableOffice
          game={game}
          activeCase={Boolean(active)}
          onCase={openCase}
          onFirm={() => navigate('/firm')}
          onEmpire={() => navigate('/map')}
          onCollect={() => {
            if (game.passive_income.available && !collect.isPending) collect.mutate()
          }}
        />

        <aside className="world-mission-board">
          <div className="mission-pin" />
          <span>NEXT MILESTONE</span>
          {milestone ? (
            <>
              <h2>{milestone.name}</h2>
              <div className="mission-gates">
                <label><span>CAPITAL <b>{formatMoney(game.cash, true)} / {formatMoney(milestone.cost, true)}</b></span><div className="pixel-meter" role="progressbar" aria-label="Capital requirement" aria-valuemin={0} aria-valuemax={milestone.cost} aria-valuenow={Math.min(game.cash, milestone.cost)}><i style={{ width: `${milestoneCashProgress}%` }} /></div></label>
                <label><span>REPUTATION <b>{game.reputation.toFixed(1)} / {milestone.reputation}</b></span><div className="pixel-meter reputation" role="progressbar" aria-label="Reputation requirement" aria-valuemin={0} aria-valuemax={milestone.reputation} aria-valuenow={Math.min(game.reputation, milestone.reputation)}><i style={{ width: `${milestoneRepProgress}%` }} /></div></label>
              </div>
              <small>{milestone.reputation > game.reputation ? `${(milestone.reputation - game.reputation).toFixed(1)} REP TO GO` : `${formatMoney(Math.max(0, milestone.cost - game.cash), true)} CAPITAL TO GO`}</small>
            </>
          ) : <><h2>Empire complete</h2><p>Every skyline starts here.</p></>}
          <button onClick={() => navigate('/firm')}>OPEN BUILD MENU <ArrowRight /></button>
        </aside>
      </section>

      <section className="office-gamebar">
        <article className="client-quest-card">
          <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
          <div><span>ACTIVE CONTRACT</span><h3>{workingClient.name}</h3><p>{game.active_client.on_hold ? 'Original contract on hold' : `${game.active_client.cases_remaining} files remaining`} · {formatMoney(workingClient.base_fee)} base</p></div>
          <button onClick={openCase}>{active ? 'RESUME' : 'TAKE CASE'} <ArrowRight /></button>
        </article>

        <article className="daily-quest-card">
          <div className="daily-heading"><div><span>DAILY QUEST</span><h3>{game.daily.cases_completed} CASES CLOSED</h3></div><Flame /></div>
          <div className="daily-goals">
            {game.daily.goals.map((goal) => (
              <button key={goal.cases} className={`${goal.complete ? 'complete' : ''} ${goal.claimed ? 'claimed' : ''}`} disabled={!goal.complete || goal.claimed || claim.isPending} onClick={() => claim.mutate(goal.cases)}>
                <span>{goal.claimed ? <Check /> : goal.cases}</span><div><strong>{goal.cases} FILES</strong><small>{goal.claimed ? 'CLAIMED' : formatMoney(goal.reward)}</small></div>
              </button>
            ))}
          </div>
        </article>

        <article className="safe-card">
          <div className="safe-icon"><i>$</i></div>
          <div><span>RETAINER SAFE</span><strong>{formatMoney(game.passive_income.available)}</strong><small>{formatMoney(game.passive_income.hourly_rate)}/HR · {game.passive_income.cap_hours}H MAX</small></div>
          <button disabled={!game.passive_income.available || collect.isPending} onClick={() => collect.mutate()}>{collect.isPending ? '...' : 'COLLECT'}</button>
        </article>
      </section>
      {(start.error || collect.error || claim.error) && <ErrorNotice error={start.error || collect.error || claim.error} />}
    </div>
  )
}


export function CasesLobbyPage() {
  const navigate = useNavigate()
  const gameQuery = useGame()
  const contentStatus = useQuery({ queryKey: ['health'], queryFn: api.health })
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const start = useMutation({ mutationFn: api.startPractice, onSuccess: ({ session }) => navigate(`/cases/${session.id}`) })
  if (gameQuery.isLoading || current.isLoading) return <LoadingScreen label="Checking the docket…" />
  const game = gameQuery.data!.game!
  const workingClient = effectiveClient(game)
  const active = current.data?.session
  return (
    <div className="case-lobby page-wrap">
      <section className="docket-hero">
        <div className="docket-copy">
          <span className="eyebrow gold">DO CASES</span>
          <h1>One question.<br />One explanation.<br /><em>One step richer.</em></h1>
          <p>The verified key decides the answer. Your reasoning, time, client, and firm decide the fee.</p>
          {contentStatus.data && <div className="content-source-status"><CheckCircle2 /><span><strong>{contentStatus.data.questions.total.toLocaleString()} VERIFIED QUESTIONS</strong><small>{contentStatus.data.questions.lr.toLocaleString()} LR · {contentStatus.data.questions.rc.toLocaleString()} RC · INDEPENDENT ANSWER KEYS</small></span></div>}
          <button className="primary-button jumbo" onClick={() => active ? navigate(`/cases/${active.id}`) : start.mutate()} disabled={start.isPending}>
            <BriefcaseBusiness /> {active ? 'Resume active case' : start.isPending ? 'Opening a file…' : 'Take the next case'} <ArrowRight />
          </button>
          {start.error && <ErrorNotice error={start.error} />}
        </div>
        <div className="case-brief-card">
          <div className="brief-stamp">{game.active_client.on_hold ? 'EFFECTIVE CLIENT' : 'ACTIVE CLIENT'}</div>
          <ClientPortrait kind={workingClient.icon} name={workingClient.name} className="lobby-client-portrait" />
          <h2>{workingClient.name}</h2>
          <p>{game.active_client.on_hold
            ? `${game.active_client.name} is on hold until your Reputation recovers. Walk-in matters remain available at the fee below.`
            : workingClient.description}</p>
          <div className="brief-terms"><span><Coins /> Effective base fee<strong>{formatMoney(workingClient.base_fee)}</strong></span><span><BriefcaseBusiness /> Contract<strong>{game.active_client.on_hold ? `${game.active_client.name} paused` : `${game.active_client.cases_remaining} cases`}</strong></span><span><Flame /> Validated streak<strong>{game.current_streak}</strong></span></div>
        </div>
      </section>
      <CaseJourneyRail current="intake" />
      <section className="how-scoring-works">
        <span className="eyebrow">HOW THIS FEE IS WON</span>
        <div>
          <article><span>01</span><Scale /><h3>Choose precisely</h3><p>The source bank’s answer key—not the tutoring AI—determines correctness.</p></article>
          <article><span>02</span><BookOpen /><h3>Explain the logic</h3><p>Question-specific Good or Excellent reasoning unlocks speed points and full Reputation credit.</p></article>
          <article><span>03</span><Clock3 /><h3>Build clean speed</h3><p>Work inside the visible target, but never rush: suspiciously fast work is capped.</p></article>
          <article><span>04</span><Building2 /><h3>Grow the firm</h3><p>Every earned fee moves the next office, hire, client, or acquisition closer.</p></article>
        </div>
      </section>
    </div>
  )
}


export function CaseSessionPage() {
  const { sessionId } = useParams()
  const queryClient = useQueryClient()
  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.session(sessionId!),
    enabled: Boolean(sessionId),
  })
  const resume = useMutation({
    mutationFn: () => api.resumeSession(sessionId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session', sessionId] }),
  })
  if (!sessionId) return <Navigate to="/cases" replace />
  if (sessionQuery.isLoading) return <LoadingScreen label="Pulling the case file…" />
  if (sessionQuery.error) return <div className="contained"><ErrorNotice error={sessionQuery.error} /></div>
  const session = sessionQuery.data!.session
  if (session.status === 'paused') {
    return (
      <div className="paused-case page-wrap">
        <div className="paused-folder"><BriefcaseBusiness /></div>
        <span className="eyebrow">CASE FILE SAVED</span>
        <h1>Your argument is waiting.</h1>
        <p>Your answer choice and written reasoning are safe. Paused questions do not receive time-bonus points.</p>
        <button className="primary-button" onClick={() => resume.mutate()} disabled={resume.isPending}>
          <Play size={18} /> {resume.isPending ? 'Returning…' : 'Return to the case'}
        </button>
        {resume.error && <ErrorNotice error={resume.error} />}
      </div>
    )
  }
  if (session.status === 'completed' && !session.pending_result && sessionQuery.data!.summary) return <DocketResolution summary={sessionQuery.data!.summary} />
  if (session.status === 'completed' && !session.pending_result) return <LoadingScreen label="Preparing the docket resolution…" />
  return (
    <div className="session-page">
      {!session.pending_result && <div className="session-controls"><PauseButton sessionId={session.id} /></div>}
      <QuestionFlow session={session} />
    </div>
  )
}


function DocketResolution({ summary }: { summary: PracticeSummary }) {
  const navigate = useNavigate()
  const start = useMutation({
    mutationFn: api.startPractice,
    onSuccess: ({ session }) => navigate(`/cases/${session.id}`),
  })
  return (
    <div className="docket-resolution page-wrap">
      <CaseJourneyRail current="resolution" />
      <section className="resolution-hero">
        <div><span className="pixel-kicker">DOCKET RESOLVED</span><h1>Evidence before rewards.</h1><p>You completed the full matter. Review the learning record, then decide where the firm goes next.</p></div>
        <div className="resolution-seal"><span>ACCURACY</span><strong>{summary.accuracy}%</strong><small>{summary.correct} / {summary.questions_completed} correct</small></div>
      </section>
      <section className="resolution-metrics" aria-label="Docket performance">
        <article><CheckCircle2 /><span>QUESTIONS CLOSED</span><strong>{summary.questions_completed}</strong><small>Complete case records</small></article>
        <article><BookOpen /><span>REASONING QUALITY</span><strong>{summary.explanation_accuracy == null ? '—' : `${summary.explanation_accuracy}%`}</strong><small>Validated explanation evidence</small></article>
        <article><Clock3 /><span>FOCUSED TIME</span><strong>{summary.elapsed_minutes}</strong><small>Minutes across the docket</small></article>
      </section>
      <section className="resolution-skills">
        <div><span className="pixel-kicker">PRACTICE GROUP RECORD</span><h2>What this docket demonstrated</h2></div>
        <div>{summary.skills.length ? summary.skills.map((skill) => <article key={skill.name}><span>{skill.name}</span><strong>{skill.accuracy}%</strong><small>{skill.attempts} {skill.attempts === 1 ? 'matter' : 'matters'}</small><i><b style={{ width: `${skill.accuracy}%` }} /></i></article>) : <p>Skill evidence will appear after more varied matters.</p>}</div>
      </section>
      <section className="resolution-actions">
        <button className="primary-button" disabled={start.isPending} onClick={() => start.mutate()}><BriefcaseBusiness />{start.isPending ? 'Opening docket…' : 'Open another docket'}</button>
        <button className="secondary-button" onClick={() => navigate('/world/appeals-chamber')}><Scale />Review and repair</button>
        <button className="secondary-button" onClick={() => navigate('/world/firm-shop')}><Wrench />Invest the earned fee</button>
        <button className="secondary-button" onClick={() => navigate('/office')}><Building2 />Return to the office</button>
        {start.error && <ErrorNotice error={start.error} />}
      </section>
    </div>
  )
}


type FirmTab = 'upgrades' | 'staff' | 'clients' | 'connections' | 'rivals' | 'achievements'

const firmTabs: Array<{ key: FirmTab; label: string; icon: typeof Wrench }> = [
  { key: 'upgrades', label: 'Upgrades', icon: Wrench },
  { key: 'staff', label: 'Staff', icon: UsersRound },
  { key: 'clients', label: 'Clients', icon: BriefcaseBusiness },
  { key: 'connections', label: 'Connections', icon: Handshake },
  { key: 'rivals', label: 'Rivals', icon: Trophy },
  { key: 'achievements', label: 'Achievements', icon: Award },
]


function RequirementLine({ asset, game }: { asset: GameAsset; game: GameState }) {
  const missing = [
    asset.requirements.reputation > game.reputation && `${asset.requirements.reputation} Reputation`,
    asset.requirements.tier > game.office_tier && `Firm tier ${asset.requirements.tier}`,
    ...asset.requirements.assets.filter((key) => !game.owned_assets.includes(key)).map((key) => key.replaceAll('_', ' ')),
  ].filter(Boolean)
  return <small className={missing.length ? 'requirements missing' : 'requirements met'}>{missing.length ? `Needs ${missing.join(' · ')}` : 'Requirements met'}</small>
}


function ClientRequirementLine({ client, game }: { client: GameClient; game: GameState }) {
  if (client.unlocked) return <small className="requirements met">{client.length}-case contract</small>
  const assetNames = client.requirements.assets.map((key) => game.catalog.assets.find((asset) => asset.key === key)?.name ?? key.replaceAll('_', ' '))
  const requirements = [
    client.requirements.reputation > 0 && `${client.requirements.reputation} Reputation`,
    client.requirements.tier > 0 && `Firm tier ${client.requirements.tier}`,
    ...assetNames,
  ].filter(Boolean)
  return <small className="requirements missing">Requires {requirements.join(' · ')}</small>
}


export function FirmPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initial = (params.get('tab') as FirmTab) || 'upgrades'
  const [tab, setTab] = useState<FirmTab>(firmTabs.some((item) => item.key === initial) ? initial : 'upgrades')
  const queryClient = useQueryClient()
  const gameQuery = useGame()
  const currentCaseQuery = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession, enabled: tab === 'clients' })
  const [justBought, setJustBought] = useState<string | null>(null)
  const [justActivated, setJustActivated] = useState<string | null>(null)
  const purchase = useMutation({
    mutationFn: api.purchase,
    onSuccess: ({ game }, key) => {
      storeGame(queryClient, game)
      setJustBought(key)
      window.setTimeout(() => setJustBought(null), 1800)
    },
  })
  const advance = useMutation({ mutationFn: api.advanceFirm, onSuccess: ({ game }) => storeGame(queryClient, game) })
  const client = useMutation({
    mutationFn: api.selectClient,
    onSuccess: ({ game }, key) => {
      storeGame(queryClient, game)
      setJustActivated(key)
      window.setTimeout(() => setJustActivated(null), 2200)
    },
  })
  const appearance = useMutation({
    mutationFn: (characterGender: CharacterGender) => api.updateGame({ character_gender: characterGender }),
    onSuccess: ({ game }) => storeGame(queryClient, game),
  })

  if (gameQuery.isLoading) return <LoadingScreen />
  const game = gameQuery.data!.game!
  const typeMap: Record<FirmTab, GameAsset['type'] | null> = { upgrades: 'upgrade', staff: 'staff', clients: null, connections: 'connection', rivals: 'rival', achievements: null }
  const assets = game.catalog.assets.filter((item) => item.type === typeMap[tab])
  const nextTier = game.catalog.tiers.find((tier) => tier.next)
  const workingClient = effectiveClient(game)
  const ownedAssetCount = game.catalog.assets.filter((item) => item.owned).length
  const mappedScenes = learnerScenes.filter((scene) => scene.id !== 'S25')
  const unlockedSceneCount = mappedScenes.filter((scene) => scene.minTier <= game.office_tier).length
  const caseAccuracy = game.total_cases ? Math.round((game.total_correct / game.total_cases) * 100) : 0
  const currentTierFloor = game.catalog.tiers.find((tier) => tier.tier === game.office_tier)?.reputation ?? 0
  const nextTierProgress = nextTier ? Math.min(100, Math.max(0, Math.round(((game.reputation - currentTierFloor) / Math.max(1, nextTier.reputation - currentTierFloor)) * 100))) : 100
  const managementPortals = [
    { label: 'Design studio', detail: 'Preview upgrades in-world', to: '/world/firm-shop', icon: Building2, tier: 0 },
    { label: 'Operations', detail: 'Inspect workload and staff', to: '/world/operations-office', icon: BriefcaseBusiness, tier: 2 },
    { label: 'City directory', detail: 'Plan the full legal empire', to: '/map', icon: Globe2, tier: 0 },
  ]
  const selectTab = (next: FirmTab) => {
    setTab(next)
    setParams(next === 'upgrades' ? {} : { tab: next })
  }
  useEffect(() => {
    const requested = (params.get('tab') as FirmTab) || 'upgrades'
    if (firmTabs.some((item) => item.key === requested) && requested !== tab) setTab(requested)
  }, [params, tab])
  const openSession = currentCaseQuery.data?.session
  const openCaseItem = openSession?.pending_item || openSession?.current_item
  const openCaseTerms = openCaseItem?.case_terms
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: FirmTab) => {
    const currentIndex = firmTabs.findIndex((item) => item.key === current)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % firmTabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + firmTabs.length) % firmTabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = firmTabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = firmTabs[nextIndex].key
    selectTab(next)
    window.requestAnimationFrame(() => document.getElementById(`firm-tab-${next}`)?.focus())
  }

  return (
    <div className="firm-page page-wrap">
      <section className="page-heading">
        <div><span className="eyebrow">MANAGE THE FIRM</span><h1>Turn every fee into leverage.</h1><p>Every purchase lists its exact benefit. Reputation is earned in cases and cannot be bought.</p></div>
        <div className="firm-wallet">
          <small>AVAILABLE CASH</small><strong>{formatMoney(game.cash)}</strong><span><Star size={15} /> {game.reputation.toFixed(1)} Reputation</span>
          <button
            className="appearance-button"
            disabled={appearance.isPending}
            aria-label={`Switch to the ${game.character_gender === 'female' ? 'male' : 'female'} character`}
            onClick={() => appearance.mutate(game.character_gender === 'female' ? 'male' : 'female')}
          >
            <UserRound size={14} />
            {appearance.isPending ? 'Updating character…' : <>Character: {game.character_gender === 'female' ? 'Female' : 'Male'}<span>Switch</span></>}
          </button>
        </div>
      </section>
      <div className="firm-tabs" role="tablist" aria-label="Firm management sections">
        {firmTabs.map(({ key, label, icon: Icon }) => <button key={key} id={`firm-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`firm-panel-${key}`} tabIndex={tab === key ? 0 : -1} className={tab === key ? 'active' : ''} onKeyDown={(event) => moveTab(event, key)} onClick={() => selectTab(key)}><Icon size={17} />{label}</button>)}
      </div>

      <section className="firm-command-center" aria-label="Firm command center">
        <PixelWebGLAtmosphere accent="#efc55d" className="firm-command-webgl" variant="office" intensity={1.3} />
        <div className="firm-rank-console">
          <span className="pixel-kicker">CURRENT COMMAND</span>
          <div><b>TIER {game.office_tier}</b><h2>{game.office.name}</h2></div>
          <p>{nextTier ? `${nextTier.name} is the next office transformation.` : 'The firm has reached its final headquarters tier.'}</p>
          <div className="firm-rank-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nextTierProgress} aria-label={`${nextTierProgress}% of reputation requirement earned`}>
            <i><b style={{ width: `${nextTierProgress}%` }} /></i>
            <span>{nextTier ? `${game.reputation.toFixed(1)} / ${nextTier.reputation} REP` : 'MAXIMUM RANK'}</span>
          </div>
        </div>
        <div className="firm-briefing-grid">
          <article><span>CASE RECORD</span><strong>{caseAccuracy}%</strong><small>{game.total_correct} of {game.total_cases} correct</small></article>
          <article><span>SCENE NETWORK</span><strong>{unlockedSceneCount}/{mappedScenes.length}</strong><small>destinations accessible</small></article>
          <article><span>ASSET LOADOUT</span><strong>{ownedAssetCount}/{game.catalog.assets.length}</strong><small>firm systems acquired</small></article>
          <article><span>PASSIVE RATE</span><strong>{formatMoney(game.passive_income.hourly_rate)}</strong><small>generated per hour</small></article>
        </div>
        <nav className="firm-scene-portals" aria-label="Firm scene shortcuts">
          <span>QUICK TRAVEL</span>
          {managementPortals.map(({ label, detail, to, icon: Icon, tier }) => (
            <button key={to} onClick={() => navigate(to)} className={game.office_tier < tier ? 'locked' : ''}>
              <Icon /><span><strong>{label}</strong><small>{game.office_tier < tier ? `Preview room · unlocks at tier ${tier}` : detail}</small></span><ArrowRight />
            </button>
          ))}
        </nav>
      </section>

      {firmTabs.filter(({ key }) => key !== tab).map(({ key }) => <div key={key} id={`firm-panel-${key}`} role="tabpanel" aria-labelledby={`firm-tab-${key}`} hidden />)}
      <div id={`firm-panel-${tab}`} role="tabpanel" aria-labelledby={`firm-tab-${tab}`} tabIndex={0}>
        {tab === 'upgrades' && nextTier && (
          <section className="tier-upgrade-banner">
          <div className="tier-preview"><Building2 /><span>TIER {nextTier.tier}</span></div>
          <div><span className="eyebrow">OFFICE TRANSFORMATION</span><h2>{nextTier.name}</h2><p>{nextTier.short}</p><div className="tier-gates"><span className={game.reputation >= nextTier.reputation ? 'met' : ''}>{game.reputation.toFixed(1)} / {nextTier.reputation} REP</span><span className={game.cash >= nextTier.cost ? 'met' : ''}>{formatMoney(game.cash)} / {formatMoney(nextTier.cost)}</span></div></div>
          <div className="tier-buy"><strong>{formatMoney(nextTier.cost)}</strong><button className="primary-button" disabled={!nextTier.available || game.cash < nextTier.cost || advance.isPending} onClick={() => advance.mutate(nextTier.tier)}>{advance.isPending ? 'Renovating…' : 'Advance firm'}</button></div>
          </section>
        )}

        {tab === 'clients' ? (
          <>
            <section className="client-roster-status">
              <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
              <div><span className="eyebrow">CURRENT WORKING CLIENT</span><h2>{workingClient.name}</h2><p>{game.active_client.on_hold ? `${game.active_client.name} is on hold; new matters use this client instead.` : `${game.active_client.cases_remaining} cases remain in this contract.`}</p></div>
              <aside className={openCaseTerms ? 'has-open-file' : ''}>
                <span>{openCaseTerms ? 'OPEN CASE FILE' : 'NEXT CASE FILE'}</span>
                <strong>{openCaseTerms?.client_name || workingClient.name}</strong>
                <small>{openCaseTerms
                  ? openCaseTerms.client_key === workingClient.key ? 'This case matches your current contract.' : `This file stays with ${openCaseTerms.client_name}; the new client starts after it closes.`
                  : `Your next case will be for ${workingClient.name}.`}</small>
              </aside>
            </section>
            <div className="management-grid client-grid">
            {game.catalog.clients.map((item) => (
              <article key={item.key} className={`management-card client-card ${item.selected ? 'selected' : ''} ${!item.unlocked ? 'locked' : ''} ${justActivated === item.key ? 'just-activated' : ''}`}>
                <ClientPortrait kind={item.icon} name={item.name} mood={item.selected ? 'happy' : 'neutral'} className="client-card-portrait" />
                <div className="card-status">{item.on_hold ? <><Lock size={12} /> ON HOLD</> : item.selected ? 'WORKING NOW' : item.unlocked ? 'AVAILABLE' : <><Lock size={12} /> LOCKED</>}</div>
                <h3>{item.name}</h3><p>{item.description}</p>
                <div className="client-fee"><span>Base fee per case</span><strong>{formatMoney(item.base_fee)}</strong></div>
                {item.on_hold && <div className="effective-client-note"><BriefcaseBusiness size={13} />Cases use {workingClient.name} · {formatMoney(workingClient.base_fee)} base fee</div>}
                {item.contract && <div className="contract-mini"><span>{item.contract.cases_remaining} left</span><span>{item.contract.loyalty} loyalty</span></div>}
                <ClientRequirementLine client={item} game={game} />
                <button className={item.selected ? 'secondary-button full' : 'primary-button full'} disabled={!item.unlocked || item.selected || client.isPending} onClick={() => client.mutate(item.key)}>{client.isPending && client.variables === item.key ? 'Switching files…' : item.on_hold ? 'Current client · On hold' : item.selected ? 'Working these cases' : `Work for ${item.name}`}</button>
                {justActivated === item.key && <div className="client-activated-flash"><Check /> NEW CLIENT ACTIVE</div>}
              </article>
            ))}
            </div>
          </>
      ) : tab === 'achievements' ? (
        <div className="achievement-grid">
          {game.achievements.map((item, index) => (
            <article key={item.key} className={item.unlocked ? 'unlocked' : ''}>
              <div>{item.unlocked ? <Trophy /> : <Lock />}</div><span>{String(index + 1).padStart(2, '0')}</span><h3>{item.name}</h3><p>{item.description}</p>{item.unlocked && <small><Check /> ACHIEVED</small>}
            </article>
          ))}
        </div>
      ) : (
        <div className="management-grid">
          {assets.map((item, index) => (
            <article key={item.key} className={`management-card ${item.owned ? 'owned' : ''} ${justBought === item.key ? 'just-bought' : ''}`}>
              <span className="management-card-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="card-icon"><AssetIcon type={item.type} /></div>
              <div className="card-status">{item.owned ? <><Check size={13} /> OWNED</> : item.available ? 'AVAILABLE' : <><Lock size={12} /> LOCKED</>}</div>
              <h3>{item.name}</h3><p>{item.description}</p><div className="benefit-pill"><Sparkles size={14} />{item.benefit}</div>
              <RequirementLine asset={item} game={game} />
              <div className={`asset-readiness ${item.owned ? 'complete' : item.available ? 'ready' : ''}`}><span>{item.owned ? 'INSTALLED' : item.available ? 'READY TO ACQUIRE' : 'DEPENDENCIES PENDING'}</span><i><b /></i></div>
              <div className="purchase-row"><strong>{formatMoney(item.cost)}</strong><button className="primary-button" disabled={item.owned || !item.available || game.cash < item.cost || purchase.isPending} onClick={() => purchase.mutate(item.key)}>{item.owned ? 'Installed' : game.cash < item.cost ? 'Keep earning' : 'Purchase'}</button></div>
            </article>
          ))}
        </div>
        )}
      </div>
      {(purchase.error || advance.error || client.error || appearance.error) && <ErrorNotice error={purchase.error || advance.error || client.error || appearance.error} />}
    </div>
  )
}


function AssetIcon({ type }: { type: GameAsset['type'] }) {
  if (type === 'staff') return <UserRound />
  if (type === 'connection') return <Handshake />
  if (type === 'rival') return <Trophy />
  return <Wrench />
}


function TierArtIcon({ tier }: { tier: number }) {
  if (tier === 0) return <BriefcaseBusiness />
  if (tier === 1) return <UsersRound />
  if (tier <= 3) return <Building2 />
  if (tier === 4) return <Crown />
  if (tier === 5) return <Globe2 />
  return <Trophy />
}


export function ProgressionMapPage() {
  const navigate = useNavigate()
  const gameQuery = useGame()
  const sessionQuery = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  if (gameQuery.isLoading || sessionQuery.isLoading) return <LoadingScreen />
  if (gameQuery.error || sessionQuery.error) return <div className="page-wrap"><ErrorNotice error={gameQuery.error || sessionQuery.error} /></div>
  const game = gameQuery.data!.game!
  const mappedScenes = learnerScenes.filter((scene) => scene.id !== 'S25')
  const openScenes = mappedScenes.filter((scene) => scene.minTier <= game.office_tier).length
  const nextLockedScene = mappedScenes.find((scene) => scene.minTier > game.office_tier)
  return (
    <div className="map-page empire-game-page">
      <section className="empire-command-bar">
        <div><span className="pixel-kicker">CITY DIRECTORY · 6 CAMPUSES · {mappedScenes.length} INTERIOR ROOMS</span><h1>Your legal empire</h1><p>Choose a district campus, then enter its ordered rooms. Firm growth follows one ascension route; rival firms share Grand Avenue.</p></div>
        <div className="empire-command-summary">
          <div><small>EMPIRE VALUE</small><strong>{formatMoney(game.firm_valuation, true)}</strong><span>HQ · {game.office.name}</span></div>
          <div><small>NETWORK ACCESS</small><strong>{openScenes}/{mappedScenes.length}</strong><span>Destinations currently open</span></div>
          <div><small>NEXT FRONTIER</small><strong>{nextLockedScene ? `TIER ${nextLockedScene.minTier}` : 'COMPLETE'}</strong><span>{nextLockedScene?.district ?? 'Entire city accessible'}</span></div>
        </div>
      </section>
      <EmpireWorldMap game={game} session={sessionQuery.data?.session} onManage={(tab) => navigate(`/firm?tab=${tab}`)} onScene={(slug) => navigate(`/world/${slug}`)} />
    </div>
  )
}
