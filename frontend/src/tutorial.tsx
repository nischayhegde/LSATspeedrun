import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Brain,
  BriefcaseBusiness,
  Building2,
  Check,
  Clock3,
  Coins,
  Eye,
  Map,
  Scale,
  Sparkles,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { OfficeScene } from './game-art'
import type { GameState } from './types'
import './tutorial.css'


const STORAGE_PREFIX = 'lawyer-tycoon:tutorial:v2'

type FocusChoice = 'accuracy' | 'reasoning' | 'pacing'
type TutorialPhase = 'premise' | 'tour'
type SpotlightRect = { x: number; y: number; width: number; height: number }

type TourStep = {
  id: string
  label: string
  route: string
  targets: string[]
  title: string
  copy: string
  points: string[]
  icon: LucideIcon
}

const tourSteps: TourStep[] = [
  {
    id: 'office',
    label: 'Office',
    route: '/office',
    targets: ['office', 'nav-office'],
    title: 'Your office is the home screen—and the reward made visible.',
    copy: 'Walk through the room, meet the active client, collect retainers, and see every investment appear around your lawyer.',
    points: ['The waiting client opens or resumes the current case.', 'The milestone board shows the next affordable improvement.'],
    icon: Building2,
  },
  {
    id: 'docket',
    label: 'Docket',
    route: '/cases',
    targets: ['docket', 'nav-docket'],
    title: 'The Docket is where studying becomes casework.',
    copy: 'Start rewarded work, select a future client contract, or return to solved questions in zero-reward Rapid Review.',
    points: ['New cases require an answer, confidence judgment, and explanation.', 'An open file always keeps the client terms it began with.'],
    icon: BriefcaseBusiness,
  },
  {
    id: 'learning',
    label: 'Learning',
    route: '/learning',
    targets: ['learning', 'nav-learning'],
    title: 'Learning keeps the evidence honest.',
    copy: 'Use the daily retrieval brief, review your practice record, and choose what a useful session should emphasize.',
    points: ['Reading a tip never counts as mastery.', 'Confidence and reasoning make later feedback more useful.'],
    icon: Brain,
  },
  {
    id: 'firm',
    label: 'Firm',
    route: '/firm',
    targets: ['firm', 'nav-firm'],
    title: 'Firm turns earned fees into lasting progress.',
    copy: 'Buy upgrades, hire staff, sign clients, and expand headquarters. Purchases change the office and the economics of future files.',
    points: ['Requirements are visible before you spend.', 'The next purchase is normally two to five strong cases away.'],
    icon: Coins,
  },
  {
    id: 'empire',
    label: 'Empire',
    route: '/map',
    targets: ['empire', 'nav-empire'],
    title: 'Empire is the directory for the whole game world.',
    copy: 'Districts connect every learning room, firm space, client site, and future expansion. Open locations are playable now; locked ones show what comes next.',
    points: ['Scenes give the repeatable case loop a physical place.', 'The city grows through one clear progression route.'],
    icon: Map,
  },
  {
    id: 'brief',
    label: 'Your desk',
    route: '/office',
    targets: ['firm-brief', 'help'],
    title: 'You never need to remember where you left off.',
    copy: 'The firm brief preserves the active client, open file, and next useful investment. Help reopens this complete orientation at any time.',
    points: ['Leaving a page never discards an open file.', 'Use Help whenever the firm starts to feel unfamiliar.'],
    icon: BookOpenCheck,
  },
]

const focusChoices: Array<{ id: FocusChoice; label: string; detail: string; icon: LucideIcon }> = [
  { id: 'accuracy', label: 'Accuracy first', detail: 'Slow down at the decisive step.', icon: Target },
  { id: 'reasoning', label: 'Explain the gap', detail: 'Make every answer defensible.', icon: Brain },
  { id: 'pacing', label: 'Steady pacing', detail: 'Build speed without racing.', icon: Clock3 },
]


function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`
}


function readTutorialState(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}


function writeTutorialState(key: string, value: 'pending' | 'seen') {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The guide remains available from Help when storage is unavailable.
  }
}


function trapFocus(event: globalThis.KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== 'Tab' || !root) return
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}


export function useFirmTutorial(userId: string, firmReady: boolean) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const key = storageKey(userId)
    const saved = readTutorialState(key)
    if (!firmReady) {
      if (saved === null) writeTutorialState(key, 'pending')
      return
    }
    if (saved !== 'seen') {
      // Mark it seen before opening so a refresh can never trap the learner.
      writeTutorialState(key, 'seen')
      setOpen(true)
    }
  }, [firmReady, userId])

  return {
    open,
    close: () => setOpen(false),
    reopen: () => setOpen(true),
  }
}


function PremiseIntro({ game, onTour, onClose }: { game?: GameState | null; onTour: () => void; onClose: () => void }) {
  const [beat, setBeat] = useState(0)
  const [inspection, setInspection] = useState('A walk-in client has brought the first file through the door.')
  const [focus, setFocus] = useState<FocusChoice | null>(null)
  const [previewTier, setPreviewTier] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }))
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft' && beat > 0) setBeat((current) => current - 1)
      else if (event.key === 'ArrowRight' && beat < 2) setBeat((current) => current + 1)
      else trapFocus(event, dialogRef.current)
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [beat, onClose])

  const chooseFocus = (choice: FocusChoice) => {
    setFocus(choice)
    window.localStorage.setItem('lawyer-tycoon-study-focus', choice)
  }

  return (
    <div className="premise-backdrop">
      <div ref={dialogRef} className="premise-cinematic" role="dialog" aria-modal="true" aria-labelledby="premise-title" tabIndex={-1}>
        <header className="premise-topbar">
          <div><Scale /><span>LAWYER TYCOON</span><small>ORIENTATION · {beat + 1}/3</small></div>
          <button onClick={onClose} aria-label="Skip orientation"><X /></button>
        </header>

        <div className="premise-progress" aria-label={`Opening scene ${beat + 1} of 3`}>
          {[0, 1, 2].map((index) => <i className={index <= beat ? 'active' : ''} key={index} />)}
        </div>

        <section className={`premise-beat premise-beat-${beat}`} key={beat} aria-live="polite" aria-atomic="true">
          {beat === 0 && (
            <>
              <div className="premise-scene-wrap">
                <OfficeScene game={game} previewTier={0} className="premise-office-scene" />
                <button className="premise-hotspot hotspot-file" onClick={() => setInspection('Every case is a real LSAT question. The verified key decides correctness.')}><BriefcaseBusiness /><span>THE FILE</span></button>
                <button className="premise-hotspot hotspot-desk" onClick={() => setInspection('Your written case theory forces the reasoning into the open.')}><Scale /><span>YOUR DESK</span></button>
                <button className="premise-hotspot hotspot-window" onClick={() => setInspection('Each strong case funds a larger office, a team, and eventually a citywide firm.')}><Building2 /><span>THE CITY</span></button>
                <div className="premise-inspection"><Eye /><span>LOOK AROUND</span><p>{inspection}</p></div>
              </div>
              <div className="premise-copy">
                <span>9:02 AM · YOUR FIRST MORNING</span>
                <h1 id="premise-title">One desk.<br />One client.<br /><em>One difficult question.</em></h1>
                <p>You are starting at the bottom of a nearly empty practice. The only way up is to make better judgments, explain them clearly, and keep taking the next file.</p>
                <button className="premise-primary" onClick={() => setBeat(1)}>Accept the first file <ArrowRight /></button>
              </div>
            </>
          )}

          {beat === 1 && (
            <>
              <div className="premise-caseboard" aria-hidden="true">
                <div className="caseboard-file"><BriefcaseBusiness /><span>NEW CASE</span><strong>What follows from the evidence?</strong></div>
                <div className="caseboard-thread"><i /><i /><i /></div>
                <div className="caseboard-loop">
                  <span><b>01</b>READ</span><span><b>02</b>DECIDE</span><span><b>03</b>EXPLAIN</span><span><b>04</b>REPAIR</span>
                </div>
                <div className="caseboard-verdict"><Scale /><span>VERIFIED KEY</span><strong>Reasoning reviewed after you commit.</strong></div>
              </div>
              <div className="premise-copy premise-focus-copy">
                <span>THE WORK THAT BUILDS THE FIRM</span>
                <h1 id="premise-title">An answer gets a verdict.<br /><em>Reasoning builds judgment.</em></h1>
                <p>Every rewarded case asks you to predict, choose, rate your confidence, and defend the decisive step. Pick the reminder you want beside today’s work.</p>
                <div className="premise-focus-options" role="radiogroup" aria-label="Choose a session approach">
                  {focusChoices.map(({ id, label, detail, icon: Icon }) => (
                    <button role="radio" aria-checked={focus === id} className={focus === id ? 'selected' : ''} onClick={() => chooseFocus(id)} key={id}><Icon /><span><strong>{label}</strong><small>{detail}</small></span>{focus === id && <Check />}</button>
                  ))}
                </div>
                <button className="premise-primary" disabled={!focus} onClick={() => setBeat(2)}>Set the approach <ArrowRight /></button>
              </div>
            </>
          )}

          {beat === 2 && (
            <>
              <div className="premise-scene-wrap premise-growth-scene">
                <OfficeScene game={game} previewTier={previewTier} className="premise-office-scene" />
                <div className="premise-rank-picker" aria-label="Preview firm growth">
                  {[0, 3, 8, 14].map((tier) => <button className={previewTier === tier ? 'selected' : ''} onClick={() => setPreviewTier(tier)} key={tier}><b>{tier}</b><span>{tier === 0 ? 'FIRST DESK' : tier === 3 ? 'CITY FIRM' : tier === 8 ? 'GLOBAL HQ' : 'FINAL TIER'}</span></button>)}
                </div>
                <div className="premise-growth-burst"><Sparkles /><span>FIRM TIER {previewTier}</span></div>
              </div>
              <div className="premise-copy">
                <span>FROM ZERO TO A LEGAL EMPIRE</span>
                <h1 id="premise-title">The world changes<br />because <em>you improve.</em></h1>
                <p>Fees buy the office, staff, clients, and expansion. But money never buys mastery: new work still requires your answer and your reasoning.</p>
                <div className="premise-promises"><span><Check />Cases remain the main activity</span><span><Check />Passive study grants no mastery</span><span><Check />Progress stays visible in the world</span></div>
                <button className="premise-primary" onClick={onTour}>Enter the firm <ArrowRight /></button>
              </div>
            </>
          )}
        </section>

        <footer className="premise-footer">
          <button onClick={beat ? () => setBeat((current) => current - 1) : onClose}>{beat ? <><ArrowLeft /> Previous scene</> : 'Skip orientation'}</button>
          <span>Click the highlighted objects · Arrow keys move · Esc closes</span>
          <button onClick={onTour}>Skip to website tour <ArrowRight /></button>
        </footer>
      </div>
    </div>
  )
}


function SpotlightTour({ onClose }: { onClose: () => void }) {
  const [activeStep, setActiveStep] = useState(0)
  const [rects, setRects] = useState<SpotlightRect[]>([])
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const dialogRef = useRef<HTMLDivElement>(null)
  const maskId = useId().replaceAll(':', '')
  const navigate = useNavigate()
  const location = useLocation()
  const step = tourSteps[activeStep]
  const StepIcon = step.icon
  const isLast = activeStep === tourSteps.length - 1

  const measure = useCallback(() => {
    const nextRects: SpotlightRect[] = []
    for (const target of step.targets) {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))
      const element = candidates.find((candidate) => {
        const bounds = candidate.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0
      })
      if (!element) continue
      const bounds = element.getBoundingClientRect()
      const padding = target.startsWith('nav-') || target === 'help' ? 5 : 9
      const x = Math.max(4, bounds.left - padding)
      const y = Math.max(4, bounds.top - padding)
      nextRects.push({
        x,
        y,
        width: Math.min(window.innerWidth - x - 4, bounds.width + padding * 2),
        height: Math.min(window.innerHeight - y - 4, bounds.height + padding * 2),
      })
    }
    setViewport({ width: window.innerWidth, height: window.innerHeight })
    setRects(nextRects)
  }, [step.targets])

  useEffect(() => {
    if (location.pathname !== step.route) navigate(step.route)
    setRects([])
    let measureTimer = 0
    const timer = window.setTimeout(() => {
      const primary = document.querySelector<HTMLElement>(`[data-tour="${step.targets[0]}"]`)
      primary?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
      measureTimer = window.setTimeout(measure, 180)
    }, 140)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(measureTimer)
    }
  }, [location.pathname, measure, navigate, step.route, step.targets])

  useEffect(() => {
    const refresh = () => measure()
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, true)
    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh, true)
    }
  }, [measure])

  useEffect(() => {
    window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }))
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight' && !isLast) setActiveStep((current) => current + 1)
      else if (event.key === 'ArrowLeft' && activeStep > 0) setActiveStep((current) => current - 1)
      else trapFocus(event, dialogRef.current)
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [activeStep, isLast, onClose])

  const anchor = rects[0]
  const cardStyle = (() => {
    if (viewport.width <= 700 || !anchor) return { left: 12, right: 12, bottom: 12 } as CSSProperties
    const cardWidth = Math.min(430, viewport.width - 32)
    const left = Math.min(viewport.width - cardWidth - 16, Math.max(16, anchor.x))
    const routeClearance = 76
    const minimumCardHeight = 300
    const gap = 16
    const below = anchor.y + anchor.height + 16
    const roomBelow = viewport.height - below - 12
    const preferredTop = roomBelow >= 340
      ? below
      : anchor.y - Math.min(520, viewport.height - routeClearance - 12) - gap
    const top = Math.min(
      viewport.height - minimumCardHeight - 12,
      Math.max(routeClearance, preferredTop),
    )
    const maxHeight = Math.max(minimumCardHeight, viewport.height - top - 12)
    return { width: cardWidth, left, top, maxHeight } as CSSProperties
  })()

  const complete = () => {
    navigate('/office')
    onClose()
  }

  return (
    <div className="spotlight-tour" role="dialog" aria-modal="true" aria-labelledby="spotlight-title">
      <svg className="spotlight-mask" viewBox={`0 0 ${viewport.width} ${viewport.height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect width={viewport.width} height={viewport.height} fill="white" />
            {rects.map((rect, index) => <rect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="7" fill="black" />)}
          </mask>
        </defs>
        <rect width={viewport.width} height={viewport.height} fill="rgba(3,7,11,.88)" mask={`url(#${maskId})`} />
        {rects.map((rect, index) => <rect className="spotlight-outline" key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="7" />)}
      </svg>

      <div className="tour-route-progress" aria-label={`Website tour step ${activeStep + 1} of ${tourSteps.length}`}>
        {tourSteps.map((item, index) => <button aria-label={`Go to ${item.label}`} aria-current={index === activeStep ? 'step' : undefined} className={index === activeStep ? 'active' : index < activeStep ? 'complete' : ''} onClick={() => setActiveStep(index)} key={item.id}><span>{index < activeStep ? <Check /> : index + 1}</span><strong>{item.label}</strong></button>)}
      </div>

      <section ref={dialogRef} className="spotlight-card" style={cardStyle} tabIndex={-1}>
        <header><span>WEBSITE TOUR · {activeStep + 1}/{tourSteps.length}</span><button onClick={onClose} aria-label="Close website tour"><X /></button></header>
        <div className="spotlight-card-body" key={step.id}>
          <div className="spotlight-step-icon"><StepIcon /></div>
          <span>{step.label.toUpperCase()}</span>
          <h2 id="spotlight-title">{step.title}</h2>
          <p>{step.copy}</p>
          <ul>{step.points.map((point) => <li key={point}><Check /><span>{point}</span></li>)}</ul>
        </div>
        <footer>
          <button disabled={activeStep === 0} onClick={() => setActiveStep((current) => current - 1)}><ArrowLeft /> Back</button>
          <div>{tourSteps.map((item, index) => <i className={index === activeStep ? 'active' : ''} key={item.id} />)}</div>
          <button className="spotlight-next" onClick={() => isLast ? complete() : setActiveStep((current) => current + 1)}>{isLast ? 'Start working' : 'Next'} {!isLast && <ArrowRight />}</button>
        </footer>
      </section>
    </div>
  )
}


export function FirmTutorial({ open, onClose, game }: { open: boolean; onClose: () => void; game?: GameState | null }) {
  const [phase, setPhase] = useState<TutorialPhase>('premise')
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setPhase('premise')
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => returnFocusRef.current?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null
  if (phase === 'premise') return <PremiseIntro game={game} onTour={() => setPhase('tour')} onClose={onClose} />
  return <SpotlightTour onClose={onClose} />
}
