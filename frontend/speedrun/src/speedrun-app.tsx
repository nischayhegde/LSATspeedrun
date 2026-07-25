import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  Crown,
  FileText,
  Flag,
  Flame,
  Gauge,
  GraduationCap,
  Home,
  Lightbulb,
  Lock,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Trophy,
  UsersRound,
  X,
  Zap,
} from 'lucide-react'

import './speedrun-app.css'

type Page = 'home' | 'speedrun' | 'learn' | 'tutor' | 'compete' | 'firm' | 'analytics' | 'mocks'

type RunQuestion = {
  type: string
  level: string
  stimulus: string
  stem: string
  choices: string[]
  answer: number
  insight: string
  trap: string
}

const questions: RunQuestion[] = [
  {
    type: 'Necessary assumption',
    level: '4.6 · calibrated',
    stimulus: 'The city should convert the unused rail corridor into a bike path. Residents who live near parks report being more physically active, and the corridor passes through three neighborhoods that currently have few recreational spaces.',
    stem: 'Which one of the following is an assumption required by the argument?',
    choices: [
      'A bike path would be less expensive to build than any other recreational facility.',
      'At least some residents near the rail corridor would use a bike path if one were available.',
      'Most residents who live near parks exercise there rather than elsewhere.',
      'The rail corridor is the only unused public land in the city.',
      'All neighborhoods should have the same number of recreational spaces.',
    ],
    answer: 1,
    insight: 'The recommendation needs a bridge from a nearby facility to increased activity: some nearby residents must actually use it.',
    trap: 'Topic match — choice A talks about building the path but never supports the activity claim.',
  },
  {
    type: 'Strengthen',
    level: '4.9 · calibrated',
    stimulus: 'After a museum began offering evening hours on Fridays, weekday membership renewals rose. The museum director concludes that the evening hours caused the increase in renewals.',
    stem: 'Which one of the following, if true, most strengthens the director’s conclusion?',
    choices: [
      'The museum’s Friday evening visitors are more likely to attend lectures than are daytime visitors.',
      'The museum did not change its membership prices or renewal reminders during the period in question.',
      'Several nearby museums also offer evening hours on Fridays.',
      'Many members visit the museum on weekdays rather than weekends.',
      'The museum’s most popular exhibition opened on a Saturday.',
    ],
    answer: 1,
    insight: 'The evidence is a timing correlation. Removing a plausible competing cause makes the new hours more credible as the cause.',
    trap: 'Compatible but unsupported — choice D can be true without telling us why renewals rose.',
  },
  {
    type: 'Method of reasoning',
    level: '5.1 · calibrated',
    stimulus: 'No proposal that omits a budget can receive committee approval. The Riverside proposal includes a detailed budget. So the Riverside proposal will receive committee approval.',
    stem: 'The argument’s reasoning is most vulnerable to criticism on the grounds that it',
    choices: [
      'treats a condition required for approval as if it were sufficient for approval',
      'fails to distinguish a proposal from the committee evaluating it',
      'presumes that every approved proposal has a detailed budget',
      'draws a general conclusion from an unrepresentative sample',
      'uses a term in two different senses',
    ],
    answer: 0,
    insight: '“Approval → budget” does not license “budget → approval.” The conclusion reverses the conditional relationship.',
    trap: 'Reversal — a necessary condition has been mistaken for a sufficient one.',
  },
  {
    type: 'Most strongly supported',
    level: '5.0 · calibrated',
    stimulus: 'Every editor at the journal has reviewed at least one article this month. No reviewer who has missed a deadline is eligible to chair the editorial meeting. Mina is eligible to chair the meeting.',
    stem: 'Which one of the following is most strongly supported by the statements above?',
    choices: [
      'Mina is an editor at the journal.',
      'Mina has reviewed at least one article this month.',
      'Mina has not missed a deadline.',
      'Every editor is eligible to chair the editorial meeting.',
      'No editor has missed a deadline.',
    ],
    answer: 2,
    insight: 'Eligibility to chair rules out having missed a deadline. Nothing connects Mina to being an editor.',
    trap: 'Scope drift — choices A and B import an editor fact that the stimulus never gives us.',
  },
  {
    type: 'Resolve the paradox',
    level: '5.3 · calibrated',
    stimulus: 'A bookstore reduced the number of titles it stocked last year. Yet despite having fewer titles available, the store’s total sales revenue increased.',
    stem: 'Which one of the following, if true, most helps to explain the apparent discrepancy?',
    choices: [
      'The bookstore’s largest competitors each stock more titles than it does.',
      'The bookstore kept the titles with the highest average profit margin and sales volume.',
      'The number of people who visited the bookstore last year did not increase.',
      'Several titles removed from the bookstore’s stock were available as e-books.',
      'The bookstore now displays its titles in a different arrangement.',
    ],
    answer: 1,
    insight: 'The discrepancy is fewer titles but more revenue. Keeping the strongest sellers directly joins those two facts.',
    trap: 'Partial relevance — a new display might help sales but does not explain why fewer titles were beneficial.',
  },
]

const nav: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'speedrun', label: 'Speedrun', icon: Zap },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'tutor', label: 'Tutor', icon: BrainCircuit },
  { id: 'compete', label: 'Compete', icon: Trophy },
  { id: 'firm', label: 'Firm', icon: BriefcaseBusiness },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'mocks', label: 'Mocks', icon: FileText },
]

function Ring({ value, size = 76, stroke = 7, className = '' }: { value: number; size?: number; stroke?: number; className?: string }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return <svg className={`ring ${className}`} viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-label={`${value}%`}>
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
    <circle className="ring-value" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} />
  </svg>
}

function ScorePill({ icon: Icon, children, accent = '' }: { icon: typeof Flame; children: React.ReactNode; accent?: string }) {
  return <span className={`score-pill ${accent}`}><Icon size={15} />{children}</span>
}

export default function SpeedrunApp() {
  const [page, setPage] = useState<Page>('home')
  const [runOpen, setRunOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }

  const changePage = (next: Page) => {
    setRunOpen(false)
    setMobileOpen(false)
    setPage(next)
  }

  const startRun = () => {
    setPage('speedrun')
    setRunOpen(true)
  }

  return (
    <div className="speedrun-product-shell">
      <header className="speedrun-topbar">
        <button className="speedrun-brand" onClick={() => changePage('home')} aria-label="Go to LSAT Speedrun home">
          <span className="speedrun-brand-mark"><Zap size={17} fill="currentColor" /></span>
          <span><strong>LSAT</strong><small>SPEEDRUN</small></span>
        </button>
        <nav className="speedrun-nav" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => changePage(id)}><Icon size={16} />{label}</button>)}
        </nav>
        <div className="topbar-actions">
          <ScorePill icon={Flame} accent="streak">7</ScorePill>
          <ScorePill icon={Trophy}>1,248</ScorePill>
          <button className="avatar-button" aria-label="Open account menu">AM</button>
          <button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Open navigation">{mobileOpen ? <X /> : <Menu />}</button>
        </div>
      </header>
      {mobileOpen && <nav className="mobile-speedrun-nav" aria-label="Mobile navigation">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => changePage(id)}><Icon size={17} />{label}</button>)}</nav>}
      <main className="speedrun-main">
        {page === 'home' && <HomePage onStart={startRun} onPage={changePage} />}
        {page === 'speedrun' && (runOpen ? <Player onExit={() => setRunOpen(false)} onTutor={() => { setRunOpen(false); setPage('tutor') }} /> : <SpeedrunPage onStart={() => setRunOpen(true)} onToast={showToast} />)}
        {page === 'learn' && <LearnPage onStart={startRun} />}
        {page === 'tutor' && <TutorPage onStart={startRun} />}
        {page === 'compete' && <CompetePage onStart={() => { setPage('speedrun'); setRunOpen(true) }} onToast={showToast} />}
        {page === 'firm' && <FirmPage onToast={showToast} />}
        {page === 'analytics' && <AnalyticsPage onStart={startRun} />}
        {page === 'mocks' && <MocksPage onToast={showToast} />}
      </main>
      {toast && <div className="speedrun-toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
    </div>
  )
}

function SectionHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}</div>{action}</div>
}

function HomePage({ onStart, onPage }: { onStart: () => void; onPage: (page: Page) => void }) {
  return <div className="home-page">
    <section className="home-hero">
      <div className="hero-copy">
        <span className="eyebrow">FRIDAY · JULY 24</span>
        <h1>Build the habit.<br /><em>Then beat your level.</em></h1>
        <p>Your next gain is sitting in Necessary Assumption: the method is there; your last two misses came from spending too long on the gap.</p>
        <div className="hero-actions"><button className="button primary" onClick={onStart}><Play size={17} fill="currentColor" />Start today’s Speedrun <ArrowRight size={17} /></button><button className="button ghost" onClick={() => onPage('learn')}><BookOpen size={17} />Warm up first</button></div>
        <div className="hero-proof"><span><CheckCircle2 />5 questions</span><span><Timer />~ 9 minutes</span><span><ShieldCheck />Calibrated pool</span></div>
      </div>
      <article className="next-run-card">
        <div className="next-run-top"><span>RECOMMENDED RUN</span><button aria-label="More options"><MoreHorizontal size={18} /></button></div>
        <div className="next-run-title"><div className="run-symbol"><Target /></div><div><h2>Close the gap</h2><p>Necessary assumption · LR</p></div></div>
        <div className="run-progress"><div><span>YOUR MASTERY</span><strong>61%</strong></div><div className="small-meter"><i style={{ width: '61%' }} /></div><small>Unstable timing · due now</small></div>
        <div className="run-spec"><span><Clock3 />9 min</span><span><CircleHelp />5 items</span><span><Gauge />4.8 avg</span></div>
        <button className="text-action" onClick={onStart}>See run details <ChevronRight size={16} /></button>
      </article>
    </section>
    <section className="home-signal-row">
      <article className="readiness-card"><div className="readiness-ring"><Ring value={74} size={84} /><strong>74</strong></div><div><span>WEEKLY READINESS</span><h2>On pace for 164–168</h2><p>2 focused runs and one RC section will keep the estimate current.</p></div><button onClick={() => onPage('analytics')} aria-label="Open readiness details"><ChevronRight /></button></article>
      <article className="prediction-card"><span className="prediction-icon"><Sparkles size={17} /></span><div><span>LSAT-FORMAT ESTIMATE</span><h2>162 <small>80% range 158–166</small></h2><p>Medium confidence · 126 calibrated items · updated today</p></div><button onClick={() => onPage('analytics')}>See model <ArrowRight size={15} /></button></article>
      <article className="league-card"><div className="league-badge">C</div><div><span>COUNSEL LEAGUE</span><h2>7th of 30</h2><p>Promotion zone · 3 valid runs left</p></div><button onClick={() => onPage('compete')}><Trophy size={16} />League</button></article>
    </section>
    <section className="home-grid">
      <article className="today-card surface-card">
        <div className="card-heading"><div><span className="eyebrow">TODAY’S PLAN</span><h2>One meaningful session</h2></div><span className="plan-completion">1 / 3 complete</span></div>
        <div className="plan-list">
          <div className="plan-item done"><span className="plan-dot"><Check size={14} /></span><div><strong>Retrieval warmup</strong><small>2 Must Be True items · completed this morning</small></div><span>4 min</span></div>
          <button className="plan-item current" onClick={onStart}><span className="plan-dot"><Zap size={14} /></span><div><strong>Close the gap</strong><small>Necessary Assumption · focus on prediction</small></div><span>9 min <ArrowRight size={15} /></span></button>
          <button className="plan-item" onClick={() => onPage('tutor')}><span className="plan-dot"><BrainCircuit size={15} /></span><div><strong>Resolve 2 review items</strong><small>Return to recurring trap patterns</small></div><span>6 min <ChevronRight size={16} /></span></button>
        </div>
      </article>
      <article className="skill-radar surface-card">
        <div className="card-heading"><div><span className="eyebrow">SKILL SIGNAL</span><h2>Where to put attention</h2></div><button className="icon-text" onClick={() => onPage('analytics')}>Full map <ArrowRight size={14} /></button></div>
        <div className="skill-feature"><div className="skill-rank">01</div><div><h3>Necessary vs. sufficient</h3><p>Accuracy holds at 74%. The opportunity is deciding faster after you name the gap.</p><div className="mastery-track"><i style={{ width: '61%' }} /></div><small>61% stable mastery · 3 items due</small></div></div>
        <div className="skill-mini"><span><i className="dot good" />Causal reasoning <strong>78%</strong></span><span><i className="dot warm" />RC inference <strong>67%</strong></span></div>
      </article>
    </section>
    <section className="activity-strip">
      <div><span className="eyebrow">LAST 7 DAYS</span><h2>Consistency that compounds</h2></div>
      <div className="day-bars" aria-label="Seven day activity chart">{[46, 70, 32, 82, 58, 92, 52].map((height, index) => <span key={index} className={index === 5 ? 'today' : ''}><i style={{ height: `${height}%` }} /><small>{['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][index]}</small></span>)}</div>
      <div className="activity-stat"><strong>4.2h</strong><span>focused study</span></div><div className="activity-stat"><strong>83%</strong><span>review rate</span></div>
    </section>
  </div>
}

function SpeedrunPage({ onStart, onToast }: { onStart: () => void; onToast: (message: string) => void }) {
  const [selected, setSelected] = useState<'recommended' | 'daily' | 'ranked'>('recommended')
  const cards = [
    { id: 'recommended' as const, tag: 'FOR YOU', title: 'Close the gap', copy: 'Necessary Assumption · matched to your timing pattern', icon: Target, meta: ['5 questions', '9 min', 'Practice ability'] },
    { id: 'daily' as const, tag: 'DAILY RUN', title: 'The Friday brief', copy: 'A balanced LR set on the same blueprint as your peers', icon: Sparkles, meta: ['5 questions', '10 min', 'Briefs + league XP'] },
    { id: 'ranked' as const, tag: 'RANKED · OPEN', title: 'Counsel qualifier', copy: 'Calibrated common pool · no hints · current season', icon: Trophy, meta: ['5 questions', '9 min', 'Elo eligible'] },
  ]
  return <div className="speedrun-lobby">
    <SectionHeading eyebrow="SPEEDRUN" title="Choose a focused contest." copy="Short, purposeful sets. Accuracy leads; speed only matters after the reasoning is clean." action={<button className="button ghost" onClick={() => onToast('Custom run builder is ready for your next session.')}><Plus size={16} />Custom run</button>} />
    <div className="run-choice-grid">{cards.map((card) => { const Icon = card.icon; return <button className={`run-choice ${selected === card.id ? 'selected' : ''}`} key={card.id} onClick={() => setSelected(card.id)}><div className="run-choice-header"><span>{card.tag}</span>{selected === card.id && <CheckCircle2 size={18} />}</div><div className="run-choice-icon"><Icon size={22} /></div><h2>{card.title}</h2><p>{card.copy}</p><div>{card.meta.map((item) => <small key={item}>{item}</small>)}</div></button>})}</div>
    <section className="lobby-bottom">
      <div className="run-preview"><div><span className="eyebrow">RUN PREVIEW</span><h2>{selected === 'recommended' ? 'Close the gap' : selected === 'daily' ? 'The Friday brief' : 'Counsel qualifier'}</h2><p>Five items calibrated around your current practice ability. We’ll use your response time only after a plausible reasoning floor.</p></div><div className="preview-steps"><span><Check />No explanation or tutor in the player</span><span><Check />Review queue unlocks after the result</span><span><Check />Stop any time; unsubmitted items do not affect results</span></div></div>
      <aside className="run-reward"><span>ON COMPLETION</span><strong>+42 <small>Briefs</small></strong><p>Practice runs build mastery. Elo changes only in a controlled ranked run.</p><button className="button primary full" onClick={onStart}><Play size={16} fill="currentColor" />Start 5-question run</button></aside>
    </section>
    <section className="how-scoring-works"><ShieldCheck /><div><strong>Fair scoring, visible boundaries.</strong><p>Learning mastery, competitive Elo, and LSAT-format estimates are separate systems. Tycoon items never affect any of them.</p></div><button onClick={() => onToast('Scoring: correctness dominates. Time is bounded and never rewards guessing.')}>How scoring works <ArrowRight size={14} /></button></section>
  </div>
}

function Player({ onExit, onTutor }: { onExit: () => void; onTutor: () => void }) {
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [answers, setAnswers] = useState<Array<number | null>>([])
  const [seconds, setSeconds] = useState(9 * 60)
  const [flagged, setFlagged] = useState(false)
  const [finished, setFinished] = useState(false)
  const question = questions[index]
  const correct = answers.filter((answer, answerIndex) => answer === questions[answerIndex]?.answer).length

  useEffect(() => {
    if (submitted || finished) return
    const timer = window.setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [submitted, finished])

  const submit = () => {
    if (selected === null) return
    setAnswers((current) => [...current, selected])
    setSubmitted(true)
  }
  const next = () => {
    if (index === questions.length - 1) { setFinished(true); return }
    setIndex((current) => current + 1)
    setSelected(null)
    setSubmitted(false)
    setFlagged(false)
  }

  if (finished) return <RunResults correct={correct} seconds={seconds} onExit={onExit} onTutor={onTutor} />
  const minutes = Math.floor(seconds / 60)
  const remaining = String(seconds % 60).padStart(2, '0')
  return <div className="player-page">
    <header className="player-header"><button onClick={onExit}><X size={18} />Exit run</button><div className="player-progress"><span>QUESTION {index + 1} OF {questions.length}</span><div>{questions.map((_, i) => <i key={i} className={i < index ? 'done' : i === index ? 'current' : ''} />)}</div></div><div className={`player-timer ${seconds < 90 ? 'urgent' : ''}`}><Timer size={17} /><strong>{minutes}:{remaining}</strong><small>RUN TIME</small></div></header>
    <div className="question-workspace">
      <aside className="question-rail"><button className={flagged ? 'flagged' : ''} onClick={() => setFlagged(!flagged)}><Flag size={16} fill={flagged ? 'currentColor' : 'none'} />{flagged ? 'Flagged' : 'Flag'}</button><span>{question.type}</span><small>{question.level}</small><div className="question-numbers">{questions.map((_, i) => <button key={i} className={i === index ? 'active' : i < index ? 'complete' : ''} onClick={() => { if (i < index) { setIndex(i); setSelected(answers[i]); setSubmitted(true) } }}>{i + 1}</button>)}</div></aside>
      <section className="question-panel"><div className="question-type"><span>LOGICAL REASONING</span><small>{question.type.toUpperCase()}</small></div><p className="stimulus">{question.stimulus}</p><h1>{question.stem}</h1><div className="answer-list" role="radiogroup" aria-label="Answer choices">{question.choices.map((choice, choiceIndex) => { const status = submitted ? (choiceIndex === question.answer ? 'correct' : choiceIndex === selected ? 'incorrect' : '') : selected === choiceIndex ? 'selected' : ''; return <button key={choice} className={`answer-choice ${status}`} onClick={() => !submitted && setSelected(choiceIndex)} role="radio" aria-checked={selected === choiceIndex}><span>{String.fromCharCode(65 + choiceIndex)}</span><p>{choice}</p>{submitted && choiceIndex === question.answer && <CheckCircle2 />}{submitted && choiceIndex === selected && choiceIndex !== question.answer && <X />}</button> })}</div>
        {submitted && <div className={`answer-feedback ${selected === question.answer ? 'right' : 'wrong'}`}><div>{selected === question.answer ? <CheckCircle2 /> : <CircleHelp />}<strong>{selected === question.answer ? 'Clean solve.' : 'A useful miss.'}</strong></div><p>{question.insight}</p>{selected !== question.answer && <small><Lightbulb size={14} />Trap: {question.trap}</small>}</div>}
        <div className="question-controls">{submitted ? <button className="button primary" onClick={next}>{index === questions.length - 1 ? 'See results' : 'Next question'} <ArrowRight size={17} /></button> : <><small>Choose an answer when you have a prediction. You can change it before submitting.</small><button className="button primary" disabled={selected === null} onClick={submit}>Lock answer <ArrowRight size={17} /></button></>}</div>
      </section>
    </div>
  </div>
}

function RunResults({ correct, seconds, onExit, onTutor }: { correct: number; seconds: number; onExit: () => void; onTutor: () => void }) {
  const accuracy = Math.round((correct / questions.length) * 100)
  const elapsed = 9 * 60 - seconds
  return <div className="results-page"><section className="results-hero"><div><span className="eyebrow">RUN COMPLETE · PRACTICE</span><h1>{accuracy >= 80 ? 'The method held.' : 'You found the seam.'}</h1><p>{accuracy >= 80 ? 'Your accuracy cleared expectation. The next step is carrying that same prediction into a mixed set.' : 'Your misses have a shared shape: move from the conclusion to the missing link before comparing choices.'}</p><div className="results-actions"><button className="button primary" onClick={onTutor}><BrainCircuit size={17} />Review {questions.length - correct || 1} item{questions.length - correct === 1 ? '' : 's'}</button><button className="button ghost" onClick={onExit}>Back to Speedrun</button></div></div><div className="results-score"><Ring value={accuracy} size={148} stroke={10} /><div><strong>{correct}<small> / {questions.length}</small></strong><span>correct</span></div></div></section>
    <section className="result-metrics"><article><span>LEARNING RESULT</span><strong>{accuracy}% <small>accuracy</small></strong><p>Expected: 68% at this difficulty</p></article><article><span>TIME</span><strong>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} <small>elapsed</small></strong><p>75th percentile · no speed bonus below floor</p></article><article><span>MASTERY UPDATE</span><strong>+6 <small>points</small></strong><p>Necessary/sufficient: 61% → 67%</p></article><article><span>GAME RESULT</span><strong>+42 <small>Briefs</small></strong><p>Practice run · no Elo change</p></article></section>
    <section className="one-thing"><div className="one-thing-icon"><Lightbulb /></div><div><span>ONE THING TO FIX</span><h2>Write the bridge before you hunt for it.</h2><p>On the two causal items, you went to the choices before naming what would connect the evidence to the recommendation. Your review will practice that move first.</p></div><button onClick={onTutor}>Reason it out <ArrowRight size={16} /></button></section>
    <section className="timeline-result"><div className="card-heading"><div><span className="eyebrow">ITEM TIMELINE</span><h2>Keep the signal, not the shame.</h2></div><span className="results-legend"><i className="correct" />Correct <i className="miss" />Review</span></div><div className="result-items">{questions.map((q, i) => <article key={q.type}><span className={i < correct ? 'correct' : 'miss'}>{i < correct ? <Check size={15} /> : <RotateCcw size={15} />}</span><div><strong>{q.type}</strong><small>Difficulty {q.level.split(' ')[0]} · {i === 0 ? '1:31' : `${1 + i}:0${i + 2}`}</small></div><button onClick={i >= correct ? onTutor : undefined}>{i >= correct ? 'Review' : 'View'} <ChevronRight size={15} /></button></article>)}</div></section>
  </div>
}

function LearnPage({ onStart }: { onStart: () => void }) {
  const [choice, setChoice] = useState<number | null>(null)
  const lessons = [
    ['Necessary assumption', 'Find the missing bridge in an argument.', '61%', 'DUE NOW', Target],
    ['Causal reasoning', 'Separate a cause from a correlated event.', '78%', 'STABLE', Compass],
    ['RC inference', 'Stay at the supportable level of strength.', '67%', 'IN PROGRESS', BookOpen],
    ['Conditional logic', 'Translate, chain, and contrapose with precision.', '72%', 'RETRIEVAL DUE', BrainCircuit],
  ] as const
  return <div className="learn-page"><SectionHeading eyebrow="LEARN" title="Build a method you can repeat." copy="Lessons are brief and active: example, completion problem, independent attempt, then later retrieval." action={<button className="button ghost" onClick={onStart}><Zap size={16} />Jump to practice</button>} />
    <div className="learning-path"><span>YOUR CURRENT PATH</span><div><button className="path-node complete"><Check /></button><i /><button className="path-node active">2</button><i /><button className="path-node">3</button><i /><button className="path-node">4</button></div><p><strong>2. Necessary assumption</strong> · guided practice</p></div>
    <section className="lesson-grid">{lessons.map(([title, copy, mastery, status, Icon]) => <article key={title} className={status === 'DUE NOW' ? 'lesson-card featured' : 'lesson-card'}><div><span className="lesson-icon"><Icon size={19} /></span><small>{status}</small></div><h2>{title}</h2><p>{copy}</p><div className="lesson-footer"><div><div className="small-meter"><i style={{ width: mastery }} /></div><span>{mastery} mastery</span></div><button aria-label={`Open ${title}`}><ChevronRight size={18} /></button></div></article>)}</section>
    <section className="interactive-lesson"><div className="interactive-copy"><span className="eyebrow">60-SECOND WARMUP</span><h2>What does a necessary assumption have to do?</h2><p>The conclusion says the bike path will increase activity. Before you look at choices, name the kind of statement it needs.</p><div className="quick-options">{['Prove the conclusion beyond doubt', 'Connect the evidence to the conclusion', 'Describe a related benefit'].map((label, i) => <button key={label} className={choice === i ? (i === 1 ? 'correct' : 'wrong') : ''} onClick={() => setChoice(i)}>{choice === i && (i === 1 ? <CheckCircle2 size={17} /> : <X size={17} />)}{label}</button>)}</div>{choice !== null && <div className="warmup-result"><Lightbulb size={17} />{choice === 1 ? 'Exactly. A necessary assumption is a required bridge, not proof that the conclusion is certain.' : 'Try the gap: the evidence concerns nearby recreation, while the conclusion predicts more activity.'}</div>}</div><div className="lesson-paper"><span>ARGUMENT MAP</span><div><small>EVIDENCE</small><p>Nearby parks → residents report more activity</p></div><i>?</i><div className="conclusion"><small>CONCLUSION</small><p>Bike path → activity will increase</p></div><strong>Find the required bridge</strong></div></section>
  </div>
}

function TutorPage({ onStart }: { onStart: () => void }) {
  const steps = ['Name the task', 'Mark the conclusion', 'Find the gap', 'Predict the answer', 'Compare choices', 'Transfer']
  const [step, setStep] = useState(0)
  const [hint, setHint] = useState(0)
  const [response, setResponse] = useState('')
  const [complete, setComplete] = useState(false)
  const prompts: Array<[string, string, string[]]> = [
    ['What is this question asking you to identify?', 'Select the task', ['A necessary assumption', 'The argument’s conclusion', 'A flaw in an answer choice']],
    ['Which claim is the author trying to establish?', 'Select the conclusion', ['Residents near parks are active', 'The city should convert the corridor into a bike path', 'The corridor passes through three neighborhoods']],
    ['What must be true for nearby recreation to support the predicted increase in activity?', 'Write a bridge in your own words', []],
    ['Before choices, which prediction is best?', 'Select a prediction', ['The path must be the cheapest option', 'Some nearby residents would use the bike path', 'Every neighborhood needs a recreation space']],
    ['Which answer choice supplies that bridge?', 'Select choice', ['A', 'B', 'C']],
    ['A city adds a free evening bus route and says this will increase attendance at public events. What bridge should you look for?', 'Write a reusable rule', []],
  ]
  const prompt = prompts[step]
  const advance = () => { if (step === steps.length - 1) setComplete(true); else { setStep(step + 1); setResponse(''); setHint(0) } }
  if (complete) return <div className="tutor-complete"><div className="tutor-complete-badge"><CheckCircle2 /></div><span className="eyebrow">REVIEW RESOLVED</span><h1>You named the move.</h1><p>You built the necessary bridge without a reveal. That’s stronger than recognizing the answer after the fact.</p><div className="transfer-score"><span>TRANSFER CHECK</span><strong>Scheduled for tomorrow</strong><small>Independent item · no tutor</small></div><div><button className="button primary" onClick={onStart}><Zap size={16} />Use it in a Speedrun</button><button className="button ghost" onClick={() => setComplete(false)}>Review another item</button></div></div>
  return <div className="tutor-page"><SectionHeading eyebrow="TUTOR · REVIEW QUEUE" title="Reason it out before we reveal it." copy="Tutor mode is separate from competition. Hints reduce mastery credit; your own model comes first." action={<span className="tutor-credit"><ShieldCheck size={15} />Learning credit · 100%</span>} />
    <div className="tutor-layout"><aside className="tutor-steps"><span>GUIDED REASONING</span>{steps.map((label, i) => <button className={i === step ? 'active' : i < step ? 'done' : ''} key={label} onClick={() => i < step && setStep(i)}><i>{i < step ? <Check size={13} /> : i + 1}</i>{label}</button>)}<div className="hint-meter"><span>HINT LADDER</span><div>{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < hint ? 'used' : ''} />)}</div><small>{hint === 0 ? 'No hints used' : `Hint ${hint} of 4 · reduced credit`}</small></div></aside>
      <section className="tutor-workspace"><div className="tutor-stimulus"><span>THE ARGUMENT</span><p>{questions[0].stimulus}</p><small>{questions[0].stem}</small></div><div className="tutor-prompt"><span>STEP {step + 1} OF {steps.length}</span><h2>{prompt[0]}</h2>{prompt[2].length ? <div className="tutor-options">{prompt[2].map((option, i) => <button key={option} className={response === option ? 'chosen' : ''} onClick={() => setResponse(option)}><span>{String.fromCharCode(65 + i)}</span>{option}</button>)}</div> : <textarea value={response} onChange={(event) => setResponse(event.target.value)} placeholder={prompt[1]} rows={3} />}{hint > 0 && <aside className="hint-card"><Lightbulb size={17} /><div><strong>{hint === 1 ? 'Look at the conclusion.' : hint === 2 ? 'Name the relationship the author assumes.' : hint === 3 ? 'The path only helps if it changes what people do.' : 'Partial representation: nearby bike path → some residents use it → more activity.'}</strong><p>Use this to create your own answer, then continue.</p></div></aside>}<div className="tutor-controls"><button className="hint-button" onClick={() => setHint(Math.min(4, hint + 1))} disabled={hint === 4}><Lightbulb size={16} />{hint === 0 ? 'Use a hint' : 'One more hint'}</button><button className="button primary" disabled={!response} onClick={advance}>{step === steps.length - 1 ? 'Finish review' : 'Commit this step'} <ArrowRight size={16} /></button></div></div></section></div>
  </div>
}

function CompetePage({ onStart, onToast }: { onStart: () => void; onToast: (message: string) => void }) {
  const players = [['1', 'Noor V.', '1,382', 'up'], ['2', 'James R.', '1,335', 'up'], ['3', 'Mina K.', '1,301', 'down'], ['7', 'You', '1,248', 'same'], ['8', 'Tori L.', '1,242', 'up'], ['9', 'Eli N.', '1,218', 'down']]
  return <div className="compete-page"><SectionHeading eyebrow="COMPETE · SEASON 4" title="A league at your level." copy="Opt in when competition helps. Your learning profile stays private; the ladder sees only valid match results." action={<button className="button primary" onClick={onStart}><Play size={16} fill="currentColor" />Play ranked</button>} />
    <section className="league-hero"><div className="league-crest"><Crown /></div><div><span>COUNSEL LEAGUE</span><h2>Promotion is within reach.</h2><p>Finish 3 valid ranked runs before Sunday to be eligible for Partner promotion.</p><div className="league-tags"><small><Trophy size={13} />1,248 Elo</small><small><UsersRound size={13} />7th of 30</small><small><Clock3 size={13} />2d 14h left</small></div></div><div className="league-progress"><Ring value={73} size={92} /><div><strong>73rd</strong><span>percentile</span></div><small>Top 20% promotes</small></div></section>
    <div className="compete-grid"><article className="ladder surface-card"><div className="card-heading"><div><span className="eyebrow">YOUR NEIGHBORHOOD</span><h2>Counsel ladder</h2></div><button onClick={() => onToast('The ladder moves with your local rating neighborhood, not a global top 100.')}>Why this group? <CircleHelp size={14} /></button></div><div className="ladder-list">{players.map(([rank, name, elo, trend]) => <div key={name} className={name === 'You' ? 'you' : ''}><strong>{rank}</strong><span className="ladder-avatar">{name === 'You' ? 'AM' : name.slice(0, 1)}</span><b>{name}</b><small>{trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'} {elo}</small>{name === 'You' && <i>YOU</i>}</div>)}</div><button className="text-action" onClick={() => onToast('Full ladder opens after your next valid run.')}>View all 30 players <ArrowRight size={15} /></button></article>
      <aside className="match-card"><span className="eyebrow">RANKED RUN</span><h2>Five calibrated LR items.</h2><p>Independent answers. No tutor or reveal in the player. Your result is matched against the common pool after you finish.</p><div><span><Check />Difficulty frozen for the season</span><span><Check />Accommodation-aware timing</span><span><Check />No paid advantage</span></div><button className="button primary full" onClick={onStart}>Enter qualifier <ArrowRight size={16} /></button></aside></div>
    <section className="social-choices"><article><div className="social-icon"><UsersRound /></div><div><span>FRIEND CHALLENGE</span><h2>Send the same seeded run.</h2><p>Results reveal after both players finish or the timer expires.</p></div><button onClick={() => onToast('Challenge link copied — ready to send to a study partner.')}>Create challenge <ArrowRight size={15} /></button></article><article><div className="social-icon gold"><Trophy /></div><div><span>PRIVATE LEAGUE</span><h2>Study with your people.</h2><p>Weekly totals use best valid runs with participation caps.</p></div><button onClick={() => onToast('Private league setup is ready for your next invite.')}>Start a league <ArrowRight size={15} /></button></article></section>
  </div>
}

function FirmPage({ onToast }: { onToast: (message: string) => void }) {
  const [briefs, setBriefs] = useState(342)
  const [upgrade, setUpgrade] = useState(false)
  const collect = () => { setBriefs((value) => value + 28); onToast('28 Briefs collected from completed review.') }
  return <div className="firm-page"><SectionHeading eyebrow="YOUR FIRM" title="A small place for progress to live." copy="The Firm is intentionally light. It reflects durable work; it never changes difficulty, hints, matchmaking, or Elo." action={<div className="briefs-display"><BriefcaseBusiness size={16} /><strong>{briefs}</strong> Briefs</div>} />
    <section className="firm-hero"><div className="firm-illustration"><div className="sky" /><div className="city city-a" /><div className="city city-b" /><div className="office-building"><i /><i /><i /><i /><i /><i /><i /><i /><b>RATIO<br />&amp; CO.</b></div><div className="office-ground" /></div><div className="firm-hero-copy"><span>COUNSEL OFFICE · LEVEL 3</span><h2>Your firm grows after the work is done.</h2><p>You closed 8 review cases this week. One more focused session unlocks the Research Room.</p><div><button className="button primary" onClick={collect}><Plus size={16} />Collect review briefs</button><button className="button ghost" onClick={() => onToast('Firm customization is cosmetic — nothing here changes your study outcome.')}>Customize</button></div></div></section>
    <section className="firm-grid"><article className="firm-objective surface-card"><div className="card-heading"><div><span className="eyebrow">WEEKLY OBJECTIVE</span><h2>Close 10 reasoning cases</h2></div><span>8 / 10</span></div><p>Completed reviews give you a moment to reflect and help fund cosmetic improvements.</p><div className="objective-progress"><i style={{ width: '80%' }} /></div><div className="objective-reward"><span><Sparkles size={16} />+80 Briefs</span><small>2 reviews to go</small></div></article><article className="upgrade-card"><div className="upgrade-icon"><BookOpen /></div><div><span>AVAILABLE UPGRADE</span><h2>Research Room</h2><p>A quieter room, a warmer palette, and a new desk lamp. Cosmetic only.</p></div><button className="button primary" disabled={upgrade || briefs < 300} onClick={() => { setBriefs((value) => value - 300); setUpgrade(true); onToast('Research Room added to your firm.') }}>{upgrade ? <><Check size={15} />Added</> : '300 Briefs'}</button></article></section>
    <section className="firm-values"><div><ShieldCheck /><div><strong>No pay-to-win, by design.</strong><p>Briefs buy customization and celebration. They cannot buy rating, estimates, ranked hints, opponents, or mastery credit.</p></div></div><div><Clock3 /><div><strong>30–90 seconds, then back to study.</strong><p>Animations are skippable, and you can hide the Firm from your navigation at any time.</p></div></div></section>
  </div>
}

function AnalyticsPage({ onStart }: { onStart: () => void }) {
  const skillRows = [['Necessary / sufficient', 61, 'Unstable timing', 'warm'], ['Causal reasoning', 78, 'Stable', 'good'], ['RC inference', 67, 'More RC needed', 'blue'], ['Method / flaw', 73, 'Stable', 'good'], ['Principle application', 56, 'Low sample', 'muted']]
  return <div className="analytics-page"><SectionHeading eyebrow="ANALYTICS" title="The score is a range. The next move is clear." copy="We show confidence, sample size, and what is missing. A five-question drill never pretends to be a full LSAT." action={<button className="button primary" onClick={onStart}><Zap size={16} />Run next recommendation</button>} />
    <section className="predictor-panel"><div className="predictor-main"><div><span className="eyebrow">LSAT-FORMAT PERFORMANCE ESTIMATE</span><h2>162 <small>80% range · 158–166</small></h2><p>Medium confidence. Based on 126 calibrated questions over 9 sessions. This is a practice estimate, not an official score or an admissions prediction.</p></div><div className="prediction-chart"><div className="chart-range"><i /><b style={{ left: '43%' }}>158</b><strong style={{ left: '57%' }}>162</strong><b style={{ left: '72%' }}>166</b></div><span>YOUR LIKELY PERFORMANCE RANGE</span></div></div><div className="predictor-facts"><div><span>DATA READINESS</span><strong>72 / 100</strong><small>Standard estimate not yet unlocked</small></div><div><span>LAST UPDATED</span><strong>Today, 4:12 PM</strong><small>After a calibrated LR run</small></div><div><span>BIGGEST UNKNOWN</span><strong>RC endurance</strong><small>Only 12 timed RC items sampled</small></div><button>How this is calculated <ArrowRight size={14} /></button></div></section>
    <div className="analytics-grid"><article className="mastery-table surface-card"><div className="card-heading"><div><span className="eyebrow">MASTERY MAP</span><h2>Skill-level evidence</h2></div><button>Taxonomy <ChevronRight size={15} /></button></div>{skillRows.map(([name, value, status, style]) => <div className="mastery-row" key={name as string}><div><strong>{name}</strong><small>{status}</small></div><div className="mastery-bar"><i className={style as string} style={{ width: `${value}%` }} /></div><b>{value}%</b></div>)}<p className="data-note"><ShieldCheck size={14} />Mastery reflects per-skill evidence, not intelligence or a permanent limit.</p></article>
      <article className="timing-panel surface-card"><div className="card-heading"><div><span className="eyebrow">SPEED × ACCURACY</span><h2>Better, not merely faster</h2></div><Gauge /></div><div className="timing-chart"><svg viewBox="0 0 420 190" role="img" aria-label="Response time and accuracy trend"><line x1="28" y1="150" x2="400" y2="150" /><line x1="28" y1="28" x2="28" y2="150" />{[0, 1, 2, 3, 4, 5, 6].map((i) => <circle key={i} cx={76 + i * 43} cy={[118, 105, 128, 88, 100, 70, 62][i]} r="6" />)}<polyline points="76,118 119,105 162,128 205,88 248,100 291,70 334,62" /></svg><div><span><i />Accuracy trend</span><span><i className="gray" />Response time</span></div></div><p>Your median split has fallen 14 seconds while accuracy is steady — a healthy speed signal.</p></article></div>
    <section className="uncertainty-card"><div className="uncertainty-icon"><CircleHelp /></div><div><span>TO TIGHTEN THIS ESTIMATE</span><h2>Complete one timed RC section.</h2><p>It would add endurance evidence and move the predictor from medium toward standard confidence. We will never fill this gap with your Elo.</p></div><button className="button ghost">Schedule section <ArrowRight size={16} /></button></section>
  </div>
}

function MocksPage({ onToast }: { onToast: (message: string) => void }) {
  return <div className="mocks-page"><SectionHeading eyebrow="MOCKS" title="Test format, kept honest." copy="Full simulations are distinct from game-like Speedruns. Current LSAT format: two scored LR sections, one scored RC section, and one unscored LR or RC section." action={<button className="button ghost" onClick={() => onToast('Mock accommodations open before you begin — your timing profile remains private.')}>Timing accommodations</button>} />
    <section className="mock-feature"><div className="mock-feature-copy"><span>FULL FORMAT SIMULATION</span><h2>Build a real baseline.</h2><p>Four 35-minute sections in current LSAT format. The experimental section is unscored, just as it should be. Review stays locked until your simulation is complete.</p><div className="mock-section-badges"><small><strong>1</strong>LR · scored</small><small><strong>2</strong>RC · scored</small><small><strong>3</strong>LR · scored</small><small><strong>4</strong>LR / RC · experimental</small></div><button className="button primary" onClick={() => onToast('Your full mock is queued. Start it when you have a quiet 2h 35m block.')}><Play size={16} fill="currentColor" />Schedule full mock</button></div><div className="mock-clock"><Timer /><strong>2:35</strong><span>HOURS · INCLUDING 10-MINUTE BREAK</span><small>Predictor-ready when completed</small></div></section>
    <section className="mock-options"><article><div className="mock-option-icon"><Timer /></div><span>35-MINUTE SECTION</span><h2>Timed RC endurance</h2><p>The highest-value missing sample for your current prediction.</p><button onClick={() => onToast('Timed RC section is ready when you are.')}>Start section <ArrowRight size={15} /></button></article><article><div className="mock-option-icon blue"><Zap /></div><span>SECTION SPRINT</span><h2>12-question LR sprint</h2><p>Train pace under format-like pressure without calling it a mock.</p><button onClick={() => onToast('Section sprint added to your plan.')}>Add to plan <ArrowRight size={15} /></button></article><article><div className="mock-option-icon gold"><FileText /></div><span>REVIEW</span><h2>Last simulation</h2><p>No full mock yet. Your first completed format will become an anchor.</p><button disabled>Available after first mock <Lock size={14} /></button></article></section>
    <section className="mock-boundary"><ShieldCheck /><p><strong>Score-model boundary:</strong> a full mock is a stronger signal than a drill, but still an LSAT-format practice estimate—not an official LSAT score.</p></section>
  </div>
}
