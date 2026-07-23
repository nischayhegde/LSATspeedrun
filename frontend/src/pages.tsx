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
  Eye,
  FileSearch,
  Flame,
  Globe2,
  Gavel,
  Handshake,
  HeartHandshake,
  Lock,
  Play,
  Scale,
  ScrollText,
  ShieldAlert,
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
import { ClientPortrait, CutsceneArtwork, EmpireWorldMap, ExplorableOffice, MiniAvatar, OfficeScene, PixelAssetArtwork } from './game-art'
import { DailyLearningBrief, StudyFocusPicker } from './learning-ux'
import { PixelWebGLAtmosphere } from './pixel-webgl'
import { learnerScenes } from './scene-registry'
import type { CharacterGender, GameAsset, GameClient, GameResponse, GameState, PracticeSummary, StoryChapter, StoryQuest } from './types'


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


function StoryCutscene({ game, chapter }: { game: GameState; chapter: StoryChapter }) {
  const queryClient = useQueryClient()
  const [resolution, setResolution] = useState<Awaited<ReturnType<typeof api.chooseStory>> | null>(null)
  useEffect(() => setResolution(null), [chapter.key])
  const choose = useMutation({
    mutationFn: (choiceKey: string) => api.chooseStory(chapter.key, choiceKey),
    onSuccess: setResolution,
  })
  const continueStory = () => {
    if (!resolution) return
    const nextGame = resolution.game
    setResolution(null)
    storeGame(queryClient, nextGame)
  }
  return (
    <div className="cutscene-overlay" role="dialog" aria-modal="true" aria-labelledby="cutscene-title">
      <div className="cutscene-letterbox top" />
      <div className="cutscene-frame">
        <CutsceneArtwork scene={chapter.scene} game={game} />
        <div className="cutscene-act"><span>{chapter.act}</span><small>{chapter.location}</small></div>
        <section className="cutscene-dialogue">
          <span>{chapter.speaker}</span>
          <h2 id="cutscene-title">{chapter.title}</h2>
          {resolution ? (
            <div className="cutscene-resolution">
              <p>{resolution.result.result}</p>
              <button className="cutscene-continue" onClick={continueStory}>Continue <ArrowRight /></button>
            </div>
          ) : (
            <>
              <div className="dialogue-beats">{chapter.dialogue.map((line) => <p key={line}>{line}</p>)}</div>
              <div className="cutscene-choices">
                {chapter.choices.map((choice) => (
                  <button key={choice.key} disabled={choose.isPending} onClick={() => choose.mutate(choice.key)}>
                    <strong>{choice.label}</strong><span>{choice.stakes}</span>
                  </button>
                ))}
              </div>
              {choose.error && <ErrorNotice error={choose.error} />}
            </>
          )}
        </section>
      </div>
      <div className="cutscene-letterbox bottom"><span>YOUR DECISION BECOMES PART OF THE FIRM</span></div>
    </div>
  )
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
      <header className="login-nav"><Brand light /><span>Serious LSAT practice. A firm built through progress.</span></header>
      <section className="login-hero">
        <div className="login-copy">
          <div className="eyebrow gold">BUILD YOUR PRACTICE ONE CASE AT A TIME</div>
          <h1>Practice the reasoning.<br /><em>Build the firm.</em></h1>
          <p>Every LSAT question becomes a case. Choose the answer, explain why, and use earned fees to grow your practice.</p>
          <div className="feature-list">
            <span><Scale /> Verified answer keys determine correctness</span>
            <span><BrainIcon /> Reasoning feedback after every case</span>
            <span><Building2 /> A living office that grows with you</span>
          </div>
        </div>
        <OfficeScene previewTier={3} gender="female" className="login-scene" />
      </section>
      <aside className="login-panel-wrap">
        <div className="login-panel">
          <div className="crest"><Scale /></div>
          <span className="eyebrow">YOUR FIRM AWAITS</span>
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
          <small>No energy limits, loot boxes, or paid answer advantages.</small>
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
          <h2>Your first desk.<br />Your first client.</h2>
          <p>Build from here.</p>
        </div>
      </section>
      <section className="onboarding-panel">
        <span className="step-indicator">YOUR FIRM · 01</span>
        <h1>Choose your lawyer.</h1>
        <p>Appearance does not affect progression, outfits, or abilities, and you can change it later.</p>
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
  const review = useQuery({ queryKey: ['review-availability'], queryFn: api.reviewAvailability })
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
          <span className="pixel-kicker">{game.reputation_band.name.toUpperCase()} COUNSEL · OFFICE TIER {game.office_tier}</span>
          <h1>{new Date().getHours() < 12 ? 'Morning' : 'Evening'}, {game.lawyer_name.split(' ')[0]}. <em>Here’s today’s work.</em></h1>
        </div>
        <div className="command-stats">
          <span><small>FIRM VALUE</small><strong>{formatMoney(game.firm_valuation, true)}</strong><TrendingUp /></span>
          <span><small>ACTIVE CLIENT</small><strong>{workingClient.name}</strong><BriefcaseBusiness /></span>
        </div>
      </section>

      <section className="office-world-shell" data-tour="office">
        <ExplorableOffice
          game={game}
          activeCase={Boolean(active)}
          onCase={openCase}
          onFirm={() => navigate('/firm')}
          onEmpire={() => navigate('/map')}
          onStory={() => navigate('/story')}
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
          ) : <><h2>All milestones reached</h2><p>The firm is fully expanded.</p></>}
          <button onClick={() => navigate('/firm')}>MANAGE FIRM <ArrowRight /></button>
        </aside>
      </section>

      <DailyLearningBrief reviewCount={review.data?.available_questions ?? 0} />

      <section className="office-gamebar">
        <article className="client-quest-card">
          <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
          <div><span>ACTIVE CONTRACT</span><h3>{workingClient.name}</h3><p>{game.active_client.on_hold ? 'Original contract on hold' : `${game.active_client.cases_remaining} files remaining`} · {formatMoney(workingClient.base_fee)} base</p></div>
          <button onClick={openCase}>{active ? 'RESUME' : 'TAKE CASE'} <ArrowRight /></button>
        </article>

        <article className="daily-quest-card">
          <div className="daily-heading"><div><span>DAILY PRACTICE</span><h3>{game.daily.cases_completed} CASES CLOSED</h3></div><Flame /></div>
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
          <div><span>RETAINER ACCOUNT</span><strong>{formatMoney(game.passive_income.available)}</strong><small>{formatMoney(game.passive_income.hourly_rate)}/HR · {game.passive_income.cap_hours}H MAX</small></div>
          <button disabled={!game.passive_income.available || collect.isPending} onClick={() => collect.mutate()}>{collect.isPending ? '...' : 'COLLECT'}</button>
        </article>
      </section>
      {(start.error || collect.error || claim.error) && <ErrorNotice error={start.error || collect.error || claim.error} />}
    </div>
  )
}


export function CasesLobbyPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const requestedView = params.get('view')
  const view = requestedView === 'intake' || requestedView === 'review' ? requestedView : 'work'
  const gameQuery = useGame()
  const contentStatus = useQuery({ queryKey: ['health'], queryFn: api.health })
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const review = useQuery({ queryKey: ['review-availability'], queryFn: api.reviewAvailability })
  const start = useMutation({ mutationFn: api.startPractice, onSuccess: ({ session }) => navigate(`/cases/${session.id}`) })
  const startReview = useMutation({ mutationFn: api.startReview, onSuccess: ({ session }) => navigate(`/cases/${session.id}`) })
  const selectClient = useMutation({
    mutationFn: api.selectClient,
    onSuccess: ({ game }) => {
      storeGame(queryClient, game)
      setParams({ view: 'work' })
    },
  })
  if (gameQuery.isLoading || current.isLoading || review.isLoading) return <LoadingScreen label="Checking the docket…" />
  const game = gameQuery.data!.game!
  const workingClient = effectiveClient(game)
  const active = current.data?.session
  const activeReview = review.data?.session
  const openItem = active?.pending_item || active?.current_item
  const availableClients = game.catalog.clients.filter((client) => client.unlocked).sort((a, b) => Number(b.selected) - Number(a.selected) || b.base_fee - a.base_fee)
  const changeView = (next: 'work' | 'intake' | 'review') => setParams(next === 'work' ? {} : { view: next })
  return (
    <div className="case-lobby page-wrap">
      <section className="docket-hub-heading" data-tour="docket">
        <div><span className="eyebrow gold">THE DOCKET · CASE INTAKE & PRACTICE</span><h1>Choose the kind of work.</h1><p>Client Intake sets terms for future cases. An open case keeps the terms it began with. Rapid Review revisits solved questions with no game rewards.</p></div>
        <div className="docket-state-card"><span>{active ? 'OPEN FILE' : 'NO OPEN FILE'}</span><strong>{openItem?.case_terms?.client_name || workingClient.name}</strong><small>{active ? `Case ${Math.min(active.current_index + 1, active.total_items)} of ${active.total_items} · terms preserved` : `${game.active_client.cases_remaining} files remain on the active contract`}</small></div>
      </section>
      <StudyFocusPicker compact />
      <nav className="docket-mode-tabs" aria-label="Docket modes">
        <button className={view === 'work' ? 'active' : ''} aria-pressed={view === 'work'} onClick={() => changeView('work')}><BriefcaseBusiness /><span><strong>Active Work</strong><small>Start or resume rewarded cases</small></span></button>
        <button className={view === 'intake' ? 'active' : ''} aria-pressed={view === 'intake'} onClick={() => changeView('intake')}><UserRound /><span><strong>Client Intake</strong><small>Choose the next contract</small></span></button>
        <button className={view === 'review' ? 'active' : ''} aria-pressed={view === 'review'} onClick={() => changeView('review')}><BookOpen /><span><strong>Rapid Review</strong><small>Revisit solved questions</small></span></button>
      </nav>

      {view === 'work' && <><section className="docket-hero">
        <div className="docket-copy">
          <span className="eyebrow gold">ACTIVE WORK</span>
          <h1>Read carefully.<br />Choose precisely.<br /><em>Explain your reasoning.</em></h1>
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
          <div className="brief-terms"><span><Coins /> Effective base fee<strong>{formatMoney(workingClient.base_fee)}</strong></span><span><BriefcaseBusiness /> Contract<strong>{game.active_client.on_hold ? `${game.active_client.name} paused` : `${game.active_client.cases_remaining} cases`}</strong></span><span><Flame /> Strong-answer streak<strong>{game.current_streak}</strong></span></div>
        </div>
      </section>
      <CaseJourneyRail current="docket" />
      <section className="how-scoring-works">
        <span className="eyebrow">HOW THIS FEE IS WON</span>
        <div>
          <article><span>01</span><Scale /><h3>Choose precisely</h3><p>The verified answer key determines correctness. Your coach helps with the reasoning.</p></article>
          <article><span>02</span><BookOpen /><h3>Explain the logic</h3><p>Strong, question-specific reasoning earns full Reputation credit and makes speed points available.</p></article>
          <article><span>03</span><Clock3 /><h3>Work toward the target</h3><p>Use the visible target as a guide. Accuracy and sound reasoning come first.</p></article>
          <article><span>04</span><Building2 /><h3>Grow the firm</h3><p>Every earned fee moves the next office, hire, client, or acquisition closer.</p></article>
        </div>
      </section></>}

      {view === 'intake' && <section className="docket-intake-panel">
        <CaseJourneyRail current="intake" />
        <header><div><span className="eyebrow">CLIENT INTAKE · FUTURE FILES</span><h2>Select the firm’s active contract.</h2><p>{active ? `Your open file remains with ${openItem?.case_terms?.client_name || 'its original client'}. A new selection applies only after that file closes.` : 'The selected contract supplies the client and fee terms when the next case opens.'}</p></div><div className="intake-rule"><ShieldAlert /><span><strong>Terms never change mid-file.</strong><small>Changing clients affects future cases only.</small></span></div></header>
        <div className="docket-client-grid">
          {availableClients.map((client) => <article key={client.key} className={client.selected ? 'selected' : ''}>
            <ClientPortrait kind={client.icon} name={client.name} mood={client.selected ? 'happy' : 'neutral'} />
            <div><span>{client.selected ? 'ACTIVE CONTRACT' : client.contract ? 'SIGNED CLIENT' : 'AVAILABLE CLIENT'}</span><h3>{client.name}</h3><p>{client.description}</p></div>
            <dl><div><dt>Base fee</dt><dd>{formatMoney(client.base_fee)}</dd></div><div><dt>Contract</dt><dd>{client.contract?.cases_remaining ?? client.length} cases</dd></div>{client.contract && <div><dt>Loyalty</dt><dd>{client.contract.loyalty}</dd></div>}</dl>
            {client.special && <small className="client-intake-special"><Sparkles />{client.special}</small>}
            <button className={client.selected ? 'secondary-button' : 'primary-button'} disabled={client.selected || selectClient.isPending} onClick={() => selectClient.mutate(client.key)}>{client.selected ? 'Current contract' : selectClient.isPending && selectClient.variables === client.key ? 'Preparing retainer…' : `Select ${client.name}`}</button>
          </article>)}
        </div>
        {selectClient.error && <ErrorNotice error={selectClient.error} />}
      </section>}

      {view === 'review' && <section className="rapid-review-panel">
        <PixelWebGLAtmosphere accent="#6fd0c2" className="review-panel-webgl" variant="scene" intensity={1.3} />
        <div className="review-archive-art"><BookOpen /><i /><i /><i /></div>
        <div><span className="eyebrow">RAPID REVIEW · NO REWARDS</span><h2>Revisit questions you have already answered.</h2><p>See the verified key immediately, then open the coach’s notes if you want a deeper review. These attempts do not change rewards or recorded mastery.</p><div className="review-guardrails"><span><Check />Previously attempted questions only</span><span><Check />No repeats within a review docket</span><span><Check />No cash, Reputation, streak, daily, loyalty, or quest progress</span></div></div>
        <aside><span>REVIEWABLE ARCHIVE</span><strong>{review.data?.available_questions ?? 0}</strong><small>distinct solved questions</small><button className="primary-button" disabled={!review.data?.available_questions || startReview.isPending} onClick={() => activeReview ? navigate(`/cases/${activeReview.id}`) : startReview.mutate()}>{activeReview ? 'Resume Rapid Review' : startReview.isPending ? 'Opening archive…' : 'Start Rapid Review'} <ArrowRight /></button>{startReview.error && <ErrorNotice error={startReview.error} />}</aside>
      </section>}
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
  return (
    <div className="docket-resolution page-wrap">
      {summary.kind === 'practice' && <CaseJourneyRail current="resolution" />}
      <section className="resolution-hero">
        <div><span className="pixel-kicker">{summary.kind === 'review' ? 'RAPID REVIEW COMPLETE' : 'DOCKET RESOLVED'}</span><h1>{summary.kind === 'review' ? 'Review complete.' : 'Matter closed.'}</h1><p>{summary.kind === 'review' ? 'No rewards or recorded mastery changed. Return to the Docket when you are ready for new work.' : 'Review the answer record and your reasoning, then choose the firm’s next step.'}</p></div>
        <div className="resolution-seal"><span>ACCURACY</span><strong>{summary.accuracy}%</strong><small>{summary.correct} / {summary.questions_completed} correct</small></div>
      </section>
      <section className="resolution-metrics" aria-label="Docket performance">
        <article><CheckCircle2 /><span>QUESTIONS CLOSED</span><strong>{summary.questions_completed}</strong><small>Complete case records</small></article>
        <article><BookOpen /><span>REASONING QUALITY</span><strong>{summary.explanation_accuracy == null ? '—' : `${summary.explanation_accuracy}%`}</strong><small>Average coach score</small></article>
        <article><Clock3 /><span>FOCUSED TIME</span><strong>{summary.elapsed_minutes}</strong><small>Minutes across the docket</small></article>
      </section>
      <section className="resolution-skills">
        <div><span className="pixel-kicker">PRACTICE GROUP RECORD</span><h2>What this docket demonstrated</h2></div>
        <div>{summary.skills.length ? summary.skills.map((skill) => <article key={skill.name}><span>{skill.name}</span><strong>{skill.accuracy}%</strong><small>{skill.attempts} {skill.attempts === 1 ? 'matter' : 'matters'}</small><i><b style={{ width: `${skill.accuracy}%` }} /></i></article>) : <p>Skill evidence will appear after more varied matters.</p>}</div>
      </section>
      <section className="resolution-actions">
        {summary.kind === 'practice' && <button className="primary-button" onClick={() => navigate('/cases')}><BriefcaseBusiness />Return to the Docket</button>}
        {summary.kind === 'review' && <button className="primary-button" onClick={() => navigate('/cases')}><BriefcaseBusiness />Return to the Docket</button>}
        {summary.kind === 'practice' && <button className="secondary-button" onClick={() => navigate('/world/appeals-chamber')}><Scale />Review and repair</button>}
        {summary.kind === 'practice' && <button className="secondary-button" onClick={() => navigate('/world/firm-shop')}><Wrench />Invest the earned fee</button>}
        {summary.kind === 'review' && <button className="secondary-button" onClick={() => navigate('/cases?view=review')}><BookOpen />Open another Rapid Review</button>}
        <button className="secondary-button" onClick={() => navigate('/office')}><Building2 />Return to the office</button>
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
  const [catalogView, setCatalogView] = useState<'all' | 'ready' | 'owned'>('all')
  const [catalogRegion, setCatalogRegion] = useState('all')
  const queryClient = useQueryClient()
  const gameQuery = useGame()
  const currentCaseQuery = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession, enabled: tab === 'clients' })
  const [justBought, setJustBought] = useState<string | null>(null)
  const purchase = useMutation({
    mutationFn: api.purchase,
    onSuccess: ({ game }, key) => {
      storeGame(queryClient, game)
      setJustBought(key)
      window.setTimeout(() => setJustBought(null), 1800)
    },
  })
  const advance = useMutation({ mutationFn: api.advanceFirm, onSuccess: ({ game }) => storeGame(queryClient, game) })
  const appearance = useMutation({
    mutationFn: (characterGender: CharacterGender) => api.updateGame({ character_gender: characterGender }),
    onSuccess: ({ game }) => storeGame(queryClient, game),
  })

  if (gameQuery.isLoading) return <LoadingScreen />
  const game = gameQuery.data!.game!
  const typeMap: Record<FirmTab, GameAsset['type'] | null> = { upgrades: 'upgrade', staff: 'staff', clients: null, connections: 'connection', rivals: 'rival', achievements: null }
  const assets = game.catalog.assets.filter((item) => item.type === typeMap[tab])
  const regions = Array.from(new Set([
    ...game.catalog.tiers.map((tier) => tier.region),
    ...game.catalog.assets.map((asset) => asset.region).filter((region): region is string => Boolean(region)),
  ]))
  const visibleAssets = assets.filter((item) =>
    (catalogRegion === 'all' || item.region === catalogRegion)
    && (catalogView === 'all' || (catalogView === 'ready' ? item.available : item.owned)),
  )
  const visibleClients = game.catalog.clients.filter((item) =>
    (catalogRegion === 'all' || item.region === catalogRegion)
    && (catalogView === 'all' || (catalogView === 'ready' ? item.unlocked : item.selected)),
  )
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
      <section className="page-heading firm-ledger-heading" data-tour="firm">
        <div className="firm-heading-copy"><span className="eyebrow">THE PARTNERS' LEDGER · MANAGE THE FIRM</span><h1>Invest in the practice.</h1><p>Use earned case fees for offices, staff, clients, connections, and acquisitions. Each investment becomes part of the firm.</p><div className="ledger-rule"><i /><span>§</span><i /></div></div>
        <div className="firm-wallet">
          <div className="wallet-clasp"><i /><i /></div><small>FIRM TREASURY</small><strong>{formatMoney(game.cash)}</strong><span><Star size={15} /> {game.reputation.toFixed(1)} Reputation</span>
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
        {firmTabs.map(({ key, label, icon: Icon }, index) => <button key={key} id={`firm-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`firm-panel-${key}`} tabIndex={tab === key ? 0 : -1} className={tab === key ? 'active' : ''} onKeyDown={(event) => moveTab(event, key)} onClick={() => selectTab(key)}><span className="firm-tab-icon"><Icon size={17} /></span><span>{label}</span><small>{String(index + 1).padStart(2, '0')}</small></button>)}
      </div>

      <section className="firm-command-center" aria-label="Firm overview">
        <PixelWebGLAtmosphere accent="#efc55d" className="firm-command-webgl" variant="office" intensity={1.3} />
        <div className="firm-rank-console">
          <span className="pixel-kicker">CURRENT OFFICE</span>
          <div><b>TIER {game.office_tier}</b><h2>{game.office.name}</h2></div>
          <p>{nextTier ? `${nextTier.name} is the next office transformation.` : 'The firm has reached its final headquarters tier.'}</p>
          <div className="firm-rank-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nextTierProgress} aria-label={`${nextTierProgress}% of reputation requirement earned`}>
            <i><b style={{ width: `${nextTierProgress}%` }} /></i>
            <span>{nextTier ? `${game.reputation.toFixed(1)} / ${nextTier.reputation} REP` : 'MAXIMUM RANK'}</span>
          </div>
        </div>
        <div className="firm-briefing-grid">
          <article><span>CASE RECORD</span><strong>{caseAccuracy}%</strong><small>{game.total_correct} of {game.total_cases} correct</small></article>
          <article><span>OPEN LOCATIONS</span><strong>{unlockedSceneCount}/{mappedScenes.length}</strong><small>destinations available</small></article>
          <article><span>FIRM ASSETS</span><strong>{ownedAssetCount}/{game.catalog.assets.length}</strong><small>investments acquired</small></article>
          <article><span>PASSIVE RATE</span><strong>{formatMoney(game.passive_income.hourly_rate)}</strong><small>generated per hour</small></article>
        </div>
        <nav className="firm-scene-portals" aria-label="Firm scene shortcuts">
          <span>VISIT</span>
          {managementPortals.map(({ label, detail, to, icon: Icon, tier }) => (
            <button key={to} onClick={() => navigate(to)} className={game.office_tier < tier ? 'locked' : ''}>
              <Icon /><span><strong>{label}</strong><small>{game.office_tier < tier ? `Opens at firm tier ${tier}` : detail}</small></span><ArrowRight />
            </button>
          ))}
        </nav>
      </section>

      {firmTabs.filter(({ key }) => key !== tab).map(({ key }) => <div key={key} id={`firm-panel-${key}`} role="tabpanel" aria-labelledby={`firm-tab-${key}`} hidden />)}
      <div id={`firm-panel-${tab}`} className={`firm-panel firm-panel-${tab}`} role="tabpanel" aria-labelledby={`firm-tab-${tab}`} tabIndex={0}>
        {tab !== 'achievements' && (
          <div className="catalog-toolbar">
            <div><span>CATALOG VIEW</span><strong>{tab === 'clients' ? visibleClients.length : visibleAssets.length} RESULTS</strong></div>
            <div className="catalog-view-buttons" role="group" aria-label="Filter catalog status">
              {(['all', 'ready', 'owned'] as const).map((view) => <button key={view} className={catalogView === view ? 'active' : ''} onClick={() => setCatalogView(view)}>{view === 'owned' && tab === 'clients' ? 'Active' : view}</button>)}
            </div>
            <label><span>CITY REGION</span><select value={catalogRegion} onChange={(event) => setCatalogRegion(event.target.value)}><option value="all">All districts</option>{regions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
          </div>
        )}
        {tab === 'upgrades' && nextTier && (
          <section className="tier-upgrade-banner">
          <div className="tier-preview"><Building2 /><span>TIER {nextTier.tier}</span></div>
          <div><span className="eyebrow">{nextTier.region} · OFFICE TRANSFORMATION</span><h2>{nextTier.name}</h2><p>{nextTier.short}</p><small>{nextTier.feature}</small><div className="tier-gates"><span className={game.reputation >= nextTier.reputation ? 'met' : ''}>{game.reputation.toFixed(1)} / {nextTier.reputation} REP</span><span className={game.cash >= nextTier.cost ? 'met' : ''}>{formatMoney(game.cash)} / {formatMoney(nextTier.cost)}</span></div></div>
          <div className="tier-buy"><strong>{formatMoney(nextTier.cost)}</strong><button className="primary-button" disabled={!nextTier.available || game.cash < nextTier.cost || advance.isPending} onClick={() => advance.mutate(nextTier.tier)}>{advance.isPending ? 'Renovating…' : 'Advance firm'}</button></div>
          </section>
        )}

        {tab === 'clients' ? (
          <>
            <section className="client-roster-status">
              <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
              <div><span className="eyebrow">CLIENT ROSTER · CONTRACTS SET IN THE DOCKET</span><h2>{workingClient.name}</h2><p>{game.active_client.on_hold ? `${game.active_client.name} is on hold; new matters use this client instead.` : `${game.active_client.cases_remaining} cases remain in this contract.`} Choose a new client in Docket Intake.</p><button className="primary-button compact" onClick={() => navigate('/cases?view=intake')}>Open Client Intake <ArrowRight /></button></div>
              <aside className={openCaseTerms ? 'has-open-file' : ''}>
                <span>{openCaseTerms ? 'OPEN CASE FILE' : 'NEXT CASE FILE'}</span>
                <strong>{openCaseTerms?.client_name || workingClient.name}</strong>
                <small>{openCaseTerms
                  ? openCaseTerms.client_key === workingClient.key ? 'This case matches your current contract.' : `This file stays with ${openCaseTerms.client_name}; the new client starts after it closes.`
                  : `Your next case will be for ${workingClient.name}.`}</small>
              </aside>
            </section>
            <div className="management-grid client-grid">
            {visibleClients.map((item) => (
              <article key={item.key} className={`management-card client-card ${item.matter_type === 'pro_bono' ? 'pro-bono-client' : ''} ${item.selected ? 'selected' : ''} ${!item.unlocked ? 'locked' : ''}`}>
                <ClientPortrait kind={item.icon} name={item.name} mood={item.selected ? 'happy' : 'neutral'} className="client-card-portrait" />
                {item.matter_type === 'pro_bono' && <div className="pro-bono-seal"><HeartHandshake /> PRO BONO</div>}
                <div className="card-status">{item.on_hold ? <><Lock size={12} /> ON HOLD</> : item.selected ? 'WORKING NOW' : item.unlocked ? 'AVAILABLE' : <><Lock size={12} /> LOCKED</>}</div>
                <div className="content-location-tag">{item.region || `TIER ${item.tier}`}{item.archetype && <b>{item.archetype}</b>}</div>
                <h3>{item.name}</h3><p>{item.description}</p>
                <div className="client-fee"><span>Base fee per case</span><strong>{formatMoney(item.base_fee)}</strong></div>
                {item.special && <div className="client-special"><Sparkles size={13} /><span><small>CASE TWIST</small>{item.special}</span></div>}
                {item.on_hold && <div className="effective-client-note"><BriefcaseBusiness size={13} />Cases use {workingClient.name} · {formatMoney(workingClient.base_fee)} base fee</div>}
                {item.contract && <div className="contract-mini"><span>{item.contract.cases_remaining} left</span><span>{item.contract.loyalty} loyalty</span></div>}
                <ClientRequirementLine client={item} game={game} />
                <button className="secondary-button full" disabled>{item.on_hold ? 'Current client · On hold' : item.selected ? 'Active contract' : item.contract ? 'Signed contract · Select in Intake' : item.unlocked ? 'Available in Docket Intake' : 'Contract locked'}</button>
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
        <div className="management-grid asset-management-grid">
          {visibleAssets.map((item) => (
            <article key={item.key} className={`management-card asset-card asset-card-${item.type} ${item.owned ? 'owned' : ''} ${!item.available && !item.owned ? 'locked' : ''} ${justBought === item.key ? 'just-bought' : ''}`}>
              <PixelAssetArtwork asset={item} />
              <div className="card-status">{item.owned ? <><Check size={13} /> OWNED</> : item.available ? 'AVAILABLE' : <><Lock size={12} /> LOCKED</>}</div>
              <div className="asset-card-copy"><span className="asset-card-number">ASSET {String(assets.indexOf(item) + 1).padStart(2, '0')} · {item.region?.toUpperCase()}</span><h3>{item.name}</h3><p>{item.description}</p></div><div className="benefit-pill"><Sparkles size={14} /><span><small>FIRM BENEFIT</small>{item.benefit}</span></div>
              <RequirementLine asset={item} game={game} />
              <div className={`asset-readiness ${item.owned ? 'complete' : item.available ? 'ready' : ''}`}><span>{item.owned ? 'INSTALLED' : item.available ? 'READY TO ACQUIRE' : 'REQUIREMENTS NOT MET'}</span><i><b /></i></div>
              <div className="purchase-row"><strong>{item.list_cost && item.list_cost > item.cost ? <><del>{formatMoney(item.list_cost)}</del>{formatMoney(item.cost)} <small>−{(item.discount_bps! / 100).toFixed(0)}%</small></> : formatMoney(item.cost)}</strong><button className="primary-button" disabled={item.owned || !item.available || game.cash < item.cost || purchase.isPending} onClick={() => purchase.mutate(item.key)}>{item.owned ? 'Installed' : game.cash < item.cost ? 'Keep earning' : 'Purchase'}</button></div>
            </article>
          ))}
        </div>
        )}
      </div>
      {(purchase.error || advance.error || appearance.error) && <ErrorNotice error={purchase.error || advance.error || appearance.error} />}
    </div>
  )
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
      <section className="empire-command-bar" data-tour="empire">
        <div><span className="pixel-kicker">CITY DIRECTORY · {mappedScenes.length} DESTINATIONS</span><h1>Explore the firm’s city.</h1><p>Choose a district, visit its offices, or review the rival firms along Grand Avenue.</p></div>
        <div className="empire-command-summary">
          <div><small>EMPIRE VALUE</small><strong>{formatMoney(game.firm_valuation, true)}</strong><span>HQ · {game.office.name}</span></div>
          <div><small>OPEN LOCATIONS</small><strong>{openScenes}/{mappedScenes.length}</strong><span>Destinations currently available</span></div>
          <div><small>NEXT EXPANSION</small><strong>{nextLockedScene ? `TIER ${nextLockedScene.minTier}` : 'COMPLETE'}</strong><span>{nextLockedScene?.district ?? 'Entire city accessible'}</span></div>
        </div>
      </section>
      <EmpireWorldMap game={game} session={sessionQuery.data?.session} onManage={(tab) => navigate(`/firm?tab=${tab}`)} onScene={(slug) => navigate(`/world/${slug}`)} />
    </div>
  )
}


const questPresentation: Record<StoryQuest['category'], { label: string; icon: typeof FileSearch; copy: string }> = {
  pro_bono: { label: 'Public Interest', icon: HeartHandshake, copy: 'Lower fees. Greater standing. A promise kept.' },
  investigation: { label: 'Investigations', icon: FileSearch, copy: 'Build Intel and uncover Sterling’s hidden network.' },
  shadow: { label: 'Shadow Files', icon: Eye, copy: 'Lucrative, secret, and dangerous to the firm’s name.' },
  legacy: { label: 'Legacy Matter', icon: ScrollText, copy: 'Write the rule that survives the empire.' },
}


export function StoryPage() {
  const queryClient = useQueryClient()
  const gameQuery = useGame()
  const [selectedRival, setSelectedRival] = useState<string | null>(null)
  const startQuestMutation = useMutation({
    mutationFn: api.startQuest,
    onSuccess: ({ game }) => storeGame(queryClient, game),
  })
  const operation = useMutation({
    mutationFn: ({ rivalKey, operationKey }: { rivalKey: string; operationKey: string }) => api.rivalOperation(rivalKey, operationKey),
    onSuccess: ({ game }) => storeGame(queryClient, game),
  })
  if (gameQuery.isLoading) return <LoadingScreen label="Developing the caseboard…" />
  if (gameQuery.error) return <div className="contained"><ErrorNotice error={gameQuery.error} /></div>
  const game = gameQuery.data!.game!
  const story = game.story
  const rival = story.rival_targets.find((item) => item.key === selectedRival) ?? story.rival_targets[0]
  const grouped = (['pro_bono', 'investigation', 'shadow', 'legacy'] as const)
    .map((category) => ({ category, quests: story.quests.filter((quest) => quest.category === category) }))
    .filter((group) => group.quests.length)

  return (
    <div className={`story-page story-alignment-${story.alignment.toLowerCase()} page-wrap`}>
      <section className="story-hero">
        <div className="story-hero-copy">
          <span className="pixel-kicker">THE MERCER FILES · OPTIONAL SPECIAL MATTERS</span>
          <h1>What will the name<br />on the door <em>mean?</em></h1>
          <p>Ada’s key, Harrow’s evidence, Moth’s secrets, and Sterling’s empire are one case. Every choice changes the resources—and the ending—you can reach.</p>
          <div className="story-alignment-stamp"><Scale /><span>CURRENT PATH</span><strong>{story.alignment}</strong></div>
        </div>
        <div className="story-board-art" aria-hidden="true">
          <div className="board-photo photo-ada">ADA</div><div className="board-photo photo-sterling">STERLING</div><div className="board-photo photo-moth">MOTH?</div>
          <i className="thread t1" /><i className="thread t2" /><i className="thread t3" />
          <div className="board-note">FORGED DEED<br />→ CITY HALL<br />→ ACQUISITIONS</div>
          <span className="board-key">⚿</span>
        </div>
      </section>

      <section className="story-resources" aria-label="Special matter resources">
        <article className="ethics"><Scale /><span>ETHICS<small>Which doors remain open</small></span><strong>{story.ethics.toFixed(1)}</strong><div><i style={{ width: `${story.ethics}%` }} /></div></article>
        <article className="heat"><ShieldAlert /><span>HEAT<small>Scrutiny and scandal risk</small></span><strong>{story.heat.toFixed(1)}</strong><div><i style={{ width: `${story.heat}%` }} /></div></article>
        <article><FileSearch /><span>INTEL<small>Evidence for investigations</small></span><strong>{story.intel}</strong></article>
        <article><Gavel /><span>INFLUENCE<small>Clean competitive leverage</small></span><strong>{story.influence}</strong></article>
      </section>

      <section className="campaign-timeline">
        <div className="story-section-heading"><span>01 · OPTIONAL MILESTONE FILES</span><h2>From one light to a constellation</h2><p>These fiction-led decisions unlock with headquarters tiers. They enrich the firm fantasy but never replace the Docket’s learning loop.</p></div>
        <div className="chapter-track">
          {story.chapters.map((chapter, index) => (
            <article key={chapter.key} className={`${chapter.seen ? 'seen' : ''} ${story.pending_chapter?.key === chapter.key ? 'pending' : ''}`}>
              <i>{chapter.seen ? <Check /> : story.pending_chapter?.key === chapter.key ? '!' : <Lock />}</i>
              <span>{chapter.act} · HQ {chapter.tier}</span><h3>{chapter.title}</h3>
              <small>{chapter.choice ? `Decision: ${chapter.choice.replaceAll('_', ' ')}` : chapter.tier <= game.office_tier ? 'Decision waiting' : `Unlocks at headquarters tier ${chapter.tier}`}</small>
              {index < story.chapters.length - 1 && <b />}
            </article>
          ))}
        </div>
      </section>

      {story.active_quest && (
        <section className={`active-caseboard active-${story.active_quest.category}`}>
          <div className="dossier-tab">ACTIVE FILE</div>
          <span>{story.active_quest.patron}</span><h2>{story.active_quest.title}</h2><p>{story.active_quest.description}</p>
          <div className="quest-progress"><div><i style={{ width: `${story.active_quest.progress / story.active_quest.target * 100}%` }} /></div><strong>{story.active_quest.progress} / {story.active_quest.target}</strong></div>
          <small>{story.active_quest.objective} · Reward: {story.active_quest.reward_label}</small>
        </section>
      )}

      <section className="quest-caseboard">
        <div className="story-section-heading"><span>02 · OPTIONAL FILES</span><h2>Choose a special matter</h2><p>Only one special matter can be active at a time. Additional files appear as your Ethics and Intel change.</p></div>
        {grouped.map(({ category, quests }) => {
          const presentation = questPresentation[category]
          const Icon = presentation.icon
          return <div className={`quest-shelf quest-shelf-${category}`} key={category}>
            <header><Icon /><div><span>{presentation.label}</span><small>{presentation.copy}</small></div></header>
            <div className="quest-grid">{quests.map((quest) => (
              <article key={quest.key} className={`${quest.active ? 'active' : ''} ${quest.completed ? 'completed' : ''}`}>
                <div className="dossier-top"><span>HQ {quest.tier} · {quest.patron}</span><i>{quest.completed ? 'CLOSED' : quest.active ? 'ACTIVE' : 'OPEN'}</i></div>
                <h3>{quest.title}</h3><p>{quest.description}</p><strong>{quest.objective}</strong>
                {quest.start_label && <small className="quest-cost">Opening cost: {quest.start_label}</small>}
                <small className="quest-reward">Reward: {quest.reward_label}</small>
                <button disabled={!quest.available || startQuestMutation.isPending} onClick={() => startQuestMutation.mutate(quest.key)}>{quest.completed ? 'File closed' : quest.active ? `${quest.progress} / ${quest.target}` : story.active_quest ? 'Caseboard occupied' : 'Open this file'}</button>
              </article>
            ))}</div>
          </div>
        })}
      </section>

      <section className="rival-war-room">
        <div className="story-section-heading light"><span>03 · RIVAL STRATEGY</span><h2>Choose your approach.</h2><p>Each strategy can be used once per rival. Discounts stack to 45%; sabotage lowers the price at a cost to the firm’s reputation.</p></div>
        {rival ? <>
          <div className="rival-target-strip">
            {story.rival_targets.map((target) => <button key={target.key} className={target.key === rival.key ? 'active' : ''} onClick={() => setSelectedRival(target.key)}><PixelAssetArtwork asset={target} /><span>{target.name.replace('Acquire ', '')}</span><small>HQ {target.tier}</small></button>)}
          </div>
          <div className="rival-valuation-card">
            <div><span>ACQUISITION TARGET</span><h3>{rival.name}</h3><p>{rival.description}</p></div>
            <div><small>LIST VALUE</small><del>{formatMoney(rival.list_cost ?? rival.cost)}</del><small>NEGOTIATED VALUE</small><strong>{formatMoney(rival.cost)}</strong><b>{(rival.discount_bps ?? 0) / 100}% DISCOUNT</b></div>
          </div>
          <div className="operation-grid">{rival.operations.map((item) => (
            <article key={item.key} className={`operation-${item.category} ${item.completed ? 'completed' : ''}`}>
              <div><span>{item.category}</span><strong>−{item.discount_bps / 100}%</strong></div><h3>{item.name}</h3><p>{item.description}</p>
              <small>{formatMoney(item.cost)}{item.intel ? ` · ${item.intel} Intel` : ''}{item.influence ? ` · ${item.influence} Influence` : ''}{item.heat_surcharge_bps ? ` · +${item.heat_surcharge_bps / 100}% Heat surcharge` : ''}</small>
              {item.missing.length > 0 && <em>Needs {item.missing.join(' · ')}</em>}
              <button disabled={!item.available || operation.isPending} onClick={() => operation.mutate({ rivalKey: rival.key, operationKey: item.key })}>{item.completed ? 'Strategy complete' : item.category === 'sabotage' ? 'Proceed with sabotage' : 'Use this strategy'}</button>
            </article>
          ))}</div>
        </> : <div className="all-rivals-acquired"><Trophy /><h3>Every rival has joined the network.</h3><p>The war room is quiet. The legacy question remains.</p></div>}
      </section>
      {(startQuestMutation.error || operation.error) && <ErrorNotice error={startQuestMutation.error || operation.error} />}
      {story.pending_chapter && <StoryCutscene game={game} chapter={story.pending_chapter} />}
    </div>
  )
}
