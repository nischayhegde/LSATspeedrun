import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpen, BriefcaseBusiness, Building2, Check, Clock3, Map, Scale, Sparkles } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useSound } from './sound'
import { loadStylizedCharacter } from './art/scene-loaders'
import './guided-tour.css'

const StylizedCharacter = lazy(() => loadStylizedCharacter().then((module) => ({ default: module.StylizedCharacter })))

const TOUR_STORAGE_KEY = 'lawyer-speedrun:guided-tour:v5'
const TOUR_REPLAY_EVENT = 'lawyer-speedrun:replay-tour'

type TourStep = {
  /** `feature` explains a mechanic that has no single element to point at. */
  kind: 'premise' | 'spotlight' | 'practice' | 'feature' | 'finish'
  eyebrow: string
  title: string
  body: string
  /** Short scannable specifics. Prose says why; these say what. */
  facts?: string[]
  target?: string
  route?: string
  cue?: string
}

const steps: TourStep[] = [
  {
    kind: 'premise',
    eyebrow: 'YOUR FIRST MORNING',
    title: 'The firm is small. Your docket is not.',
    body: 'Every LSAT question arrives as a matter to solve. Strong answers build skill; durable understanding builds the firm.',
  },
  {
    kind: 'premise',
    eyebrow: 'THE TRAINING LOOP',
    title: 'Diagnose. Drill. Review. Transfer.',
    body: 'You will move quickly when fluency matters, slow down when an error needs repair, and prove improvement on unseen questions.',
  },
  {
    kind: 'spotlight',
    eyebrow: '01 · DASHBOARD',
    title: 'Start from evidence, not guesswork.',
    body: 'Accuracy, pacing, confidence, and retention are reported separately, because they fail separately. The Speedrun Index sits on top, and the app never claims a trend it cannot support with a sample.',
    target: '[data-tour="nav-progress"]',
    route: '/progress',
    cue: 'Dashboard',
  },
  {
    kind: 'feature',
    eyebrow: '02 · THE MEGA-LITIGATION',
    title: 'Basically a full practice LSAT.',
    body: 'The one measurement that pays nothing, prompts nothing, and coaches nothing — which is exactly what makes it worth trusting. Sit one whenever you have the afternoon.',
    facts: [
      '75 questions in three blocks under one clock, about 105 minutes',
      'One sitting: no pause, no save, and the clock runs if you close the tab',
      'Clear 70% of the form and your firm jumps a tier, prerequisites unlocked free',
      'Never required — nothing in the firm waits on one',
    ],
    cue: 'Mega-litigation',
  },
  {
    kind: 'spotlight',
    eyebrow: '03 · PRACTICE',
    title: 'The docket knows the next right move.',
    body: 'One button always points at today’s work. Every run mixes unseen questions with whatever repairs have come due, so review happens without you scheduling it.',
    target: '[data-tour="nav-cases"]',
    route: '/cases',
    cue: 'Practice',
  },
  {
    kind: 'practice',
    eyebrow: 'ANSWERING A QUESTION',
    title: 'Make one clean commitment.',
    body: 'Read for the task, choose the answer the text proves, and record confidence honestly. Feedback then explains the reasoning—not just the letter.',
    route: '/cases',
    cue: 'Question workflow',
  },
  {
    kind: 'feature',
    eyebrow: '04 · WRITE, THEN LEARN',
    title: 'The explanation is the work.',
    body: 'Every case wants your reasoning in writing before it accepts the letter. The coach then grades that reasoning, names the first place it went wrong, and shows why each choice lives or dies.',
    facts: [
      'At least 120 characters of reasoning per case',
      'Rate your confidence 1–5 — an assured miss is treated as worse than a hesitant one',
      'Graded Invalid, Weak, Good, or Excellent, and the grade moves your fee',
      'You cannot skip past the debrief to the next question',
    ],
    cue: 'Reasoning',
  },
  {
    kind: 'feature',
    eyebrow: '05 · REPAIR',
    title: 'Mistakes come back on a schedule.',
    body: 'Anything you missed, guessed at, or solved too slowly is queued and folded into a later run at widening intervals — until you get it right on a day you had forgotten it.',
    facts: [
      'A confident miss comes due immediately — so does a right answer you doubted',
      'Repairs fill up to half a run and go first',
      'Getting one right pushes the interval out; missing it resets to today',
      'The post-run brief ranks the decisions worth re-reading',
    ],
    cue: 'Repair queue',
  },
  {
    kind: 'feature',
    eyebrow: '06 · THE METHOD LAB',
    title: 'Fourteen methods, tested on you.',
    body: 'Each case suggests a named LSAT method and asks whether you used it. Skipping is a real answer — a quarter of cases stay silent on purpose, so the app can compare you with the method against you without it.',
    facts: [
      'Accuracy, pace, and explanation quality are compared, not vibes',
      'A verdict reads "forming" until both sides of the comparison have a sample',
      'Weak question types keep getting tested longer before the app settles',
      'The Dashboard shows the lift for each method, with or without',
    ],
    cue: 'Method Lab',
  },
  {
    kind: 'feature',
    eyebrow: '07 · GETTING PAID',
    title: 'Every case is billable.',
    body: 'A client pays a base fee; what you actually collect depends on the verdict, the quality of your written reasoning, how fast you closed, and everything you have built.',
    facts: [
      'Fee = client base × your score × your firm, plus streak, staff, and contract bonuses',
      'Reputation rises on wins and falls on losses; pro bono pays normally and shields the loss',
      'Streaks compound, and one careless miss ends them',
      'The exact breakdown is shown after every case — nothing is hidden',
    ],
    cue: 'The economy',
  },
  {
    kind: 'feature',
    eyebrow: '08 · RENT COMES DUE',
    title: 'A firm left alone loses ground.',
    body: 'Your office bills rent every day whether you show up or not, and a silent week costs reputation as well as cash. It is the one pressure that makes a daily habit the cheap option.',
    facts: [
      'Daily rent scales with your tier; away from the desk it accrues at a fifth of the rate',
      'Arrears stop at three days — you can always dig out',
      'Reputation only starts slipping after two quiet days, and staff can shield it',
      'Passive income accrues hourly up to a cap; collect it in the office',
    ],
    cue: 'Upkeep',
  },
  {
    kind: 'spotlight',
    eyebrow: '09 · OFFICE',
    title: 'Your working day lives here.',
    body: 'Open the next case, meet the active client, collect passive income, and clear daily goals. The workspace itself fills in with every upgrade you actually own.',
    target: '[data-tour="nav-office"]',
    route: '/office',
    cue: 'Office',
  },
  {
    kind: 'spotlight',
    eyebrow: '10 · FIRM',
    title: 'Spend what the work earned.',
    body: 'Upgrades, staff, connections, cosmetics, and rival acquisitions all sit here, each with a plain line telling you exactly what is still missing. Headquarters tiers need reputation, cash, and a specific checklist of assets.',
    target: '[data-tour="nav-firm"]',
    route: '/firm',
    cue: 'Firm',
  },
  {
    kind: 'feature',
    eyebrow: '11 · THE CAMPAIGN',
    title: 'The work has a story attached.',
    body: 'Chapters arrive as you climb the tiers, and the choices in them are not cosmetic: they move where you sit between principled and ruthless, and that changes which work will have you.',
    facts: [
      'Ethics, heat, influence, and intel all track separately',
      'Quests run alongside cases: pro bono, investigations, shadow work, legacy matters',
      'Rival operations can buy out a competitor cleanly — or not cleanly, for a price',
      'Heat surcharges every future gray operation, so ruthless is a real bet',
    ],
    cue: 'Story',
  },
  {
    kind: 'spotlight',
    eyebrow: '12 · WORLD',
    title: 'The map is your career record.',
    body: 'Each arc is a living legal environment. Levels sit on one deliberate route, with districts unlocking as your firm and LSAT skill advance.',
    target: '[data-tour="nav-map"]',
    route: '/map',
    cue: 'World',
  },
  {
    kind: 'spotlight',
    eyebrow: '13 · YOUR EVIDENCE',
    title: 'Read the signal, not the decoration.',
    body: 'This compact standing shows verified accuracy and completed questions. The Dashboard holds the deeper analysis.',
    target: '[data-tour="standing"]',
    route: '/map',
    cue: 'Standing',
  },
  {
    kind: 'spotlight',
    eyebrow: '14 · SETTINGS',
    title: 'Sound and settings live here.',
    body: 'Sound marks navigation, files, verdicts, and promotions — keep it on, lower it, use Lite mode, or mute it from this menu. It also holds tutorial replay and sign out.',
    target: '[data-tour="account"]',
    route: '/map',
    cue: 'Settings',
  },
  {
    kind: 'finish',
    eyebrow: 'THE DOCKET IS OPEN',
    title: 'Take a case. Or take the whole test.',
    body: 'Start billing cases whenever you like. When you have a free couple of hours, a mega-litigation — basically a full practice LSAT — tells the app what to prescribe, and clearing 70% of it promotes your firm.',
  },
]

type Highlight = { left: number; top: number; width: number; height: number }

function findVisibleTarget(selector?: string) {
  if (!selector) return null
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }) ?? null
}

export function replayGuidedTour() {
  window.dispatchEvent(new Event(TOUR_REPLAY_EVENT))
}

export function GuidedTour() {
  const navigate = useNavigate()
  const location = useLocation()
  const { play } = useSound()
  const [open, setOpen] = useState(() => window.localStorage.getItem(TOUR_STORAGE_KEY) !== 'complete')
  const [index, setIndex] = useState(0)
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const [practiceChoice, setPracticeChoice] = useState<number | null>(null)
  const [practiceRevealed, setPracticeRevealed] = useState(false)
  const step = steps[index]

  useEffect(() => {
    const replay = () => {
      setIndex(0)
      setPracticeChoice(null)
      setPracticeRevealed(false)
      setOpen(true)
    }
    window.addEventListener(TOUR_REPLAY_EVENT, replay)
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, replay)
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])

  useEffect(() => {
    if (!open || !step) return
    if (step.route && location.pathname !== step.route) navigate(step.route, { replace: true })
  }, [location.pathname, navigate, open, step])

  useEffect(() => {
    if (!open || step.kind !== 'spotlight') {
      setHighlight(null)
      return
    }
    let frame = 0
    // A target can be a frame or two late (lazy art, a route still settling),
    // so retry — but give up rather than re-queue forever if the element is
    // hidden at this breakpoint. The step then reads without a spotlight
    // instead of spinning a rAF loop for as long as the tour is open.
    let attempts = 0
    const measure = () => {
      const target = findVisibleTarget(step.target)
      if (!target) {
        if (attempts++ < 90) frame = window.requestAnimationFrame(measure)
        return
      }
      attempts = 0
      const rect = target.getBoundingClientRect()
      const pad = 8
      setHighlight({
        left: Math.max(8, rect.left - pad),
        top: Math.max(8, rect.top - pad),
        width: Math.min(window.innerWidth - 16, rect.width + pad * 2),
        height: Math.min(window.innerHeight - 16, rect.height + pad * 2),
      })
    }
    frame = window.requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
    }
  }, [location.pathname, open, step])

  const progress = useMemo(() => Math.round((index + 1) / steps.length * 100), [index])
  if (!open || !step) return null

  const advance = () => {
    if (step.kind === 'practice' && !practiceRevealed) {
      if (practiceChoice === null) return
      setPracticeRevealed(true)
      void play(practiceChoice === 1 ? 'verdict-correct' : 'verdict-repair', { seed: `tour-practice:${practiceChoice}`, intensity: .52 })
      return
    }
    void play(step.kind === 'finish' ? 'event' : 'paper', { seed: `tour:${index}`, intensity: .46 })
    if (index === steps.length - 1) {
      window.localStorage.setItem(TOUR_STORAGE_KEY, 'complete')
      setOpen(false)
      navigate('/progress', { replace: true })
      return
    }
    setIndex((current) => current + 1)
  }

  const back = () => {
    if (index === 0) return
    void play('paper', { seed: `tour:back:${index}`, intensity: .3 })
    setIndex((current) => current - 1)
  }

  const placement = highlight && highlight.left + highlight.width / 2 > window.innerWidth * .55 ? 'left' : 'right'

  return (
    <div className={`guided-tour guided-tour-mode-${step.kind}`} role="dialog" aria-modal="true" aria-label="Lawyer Speedrun guided introduction">
      {step.kind === 'premise' && (
        <div className="tour-cinematic" aria-hidden="true">
          <div className="tour-skyline"><i /><i /><i /><i /><i /></div>
          <div className="tour-office-window" />
          <div className="tour-desk"><span /><b /><em /></div>
          <div className="tour-counsel-character">
            <Suspense fallback={null}>
              <StylizedCharacter gender="male" tier={1} role="guide" mode="scene" direction="right" activity="briefing" label="Your orientation guide" />
            </Suspense>
          </div>
          <div className="tour-case-stream"><i>LR</i><i>RC</i><i>LR</i></div>
        </div>
      )}
      {step.kind === 'finish' && (
        <div className="tour-finish-seal" aria-hidden="true"><Scale /><i /><span><Sparkles /></span></div>
      )}
      {highlight && (
        <div
          className="guided-tour-spotlight"
          style={{ left: highlight.left, top: highlight.top, width: highlight.width, height: highlight.height }}
          aria-hidden="true"
        />
      )}
      <section className={`guided-tour-card place-${placement}`}>
        <div className="tour-card-progress"><i style={{ width: `${progress}%` }} /></div>
        {step.kind !== 'premise' && (
          <div className="tour-guide-avatar" aria-hidden="true">
            <Suspense fallback={null}>
              <StylizedCharacter gender="male" tier={1} role="guide" mode="portrait" mood={step.kind === 'practice' ? 'thinking' : 'happy'} activity={step.kind === 'practice' ? 'working' : 'briefing'} />
            </Suspense>
          </div>
        )}
        <div className="tour-card-heading">
          <span>{step.eyebrow}</span>
          <small>{String(index + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</small>
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.facts && (
          <ul className="tour-facts">
            {step.facts.map((fact) => <li key={fact}><Check size={14} /><span>{fact}</span></li>)}
          </ul>
        )}
        {step.kind === 'premise' && index === 1 && (
          <div className="tour-loop" aria-label="The learning loop">
            <span><Scale /> Diagnose</span><i />
            <span><BriefcaseBusiness /> Practice</span><i />
            <span><Check /> Repair</span><i />
            <span><Map /> Transfer</span>
          </div>
        )}
        {step.kind === 'finish' && (
          <div className="tour-promise"><Building2 /><span><strong>Instruction first.</strong> The world grows because the learning is working.</span></div>
        )}
        {step.kind === 'practice' && (
          <div className="tour-question-demo">
            <div className="tour-question-meta"><span><BookOpen /> Logical Reasoning</span><span><Clock3 /> Untimed tutorial</span></div>
            <p>Every brief filed today is reviewed before closing. No reviewed brief is left unassigned. Which statement must be true?</p>
            <div className="tour-answer-list" role="radiogroup" aria-label="Tutorial answer choices">
              {[
                'Some unassigned briefs were filed today.',
                'Every brief filed today is assigned before closing.',
                'Only briefs filed today are reviewed.',
                'No brief filed today is urgent.',
              ].map((choice, choiceIndex) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={practiceChoice === choiceIndex}
                  disabled={practiceRevealed}
                  className={`${practiceChoice === choiceIndex ? 'selected' : ''} ${practiceRevealed && choiceIndex === 1 ? 'correct' : ''} ${practiceRevealed && practiceChoice === choiceIndex && choiceIndex !== 1 ? 'incorrect' : ''}`}
                  onClick={() => {
                    setPracticeChoice(choiceIndex)
                    void play('select', { seed: `tour-choice:${choiceIndex}`, intensity: .34 })
                  }}
                  key={choice}
                >
                  <i>{String.fromCharCode(65 + choiceIndex)}</i><span>{choice}</span>{practiceRevealed && choiceIndex === 1 && <Check />}
                </button>
              ))}
            </div>
            {/* Mirrors the real runner's 1–5 control so the first live case looks familiar. */}
            <div className="tour-confidence"><span>Confidence</span>{[1, 2, 3, 4, 5].map((value) => <button type="button" className={value === 3 ? 'active' : ''} tabIndex={-1} key={value}>{value}</button>)}<em>Moderate</em></div>
            {practiceRevealed && (
              <div className={`tour-answer-reasoning ${practiceChoice === 1 ? 'is-correct' : 'needs-repair'}`} role="status">
                <strong>{practiceChoice === 1 ? 'Correct reasoning' : 'Repair the chain'}</strong>
                <p><b>Filed today</b> → reviewed → assigned. Choice B is the only answer guaranteed by both rules. A contradicts the chain, C reverses it, and D introduces “urgent” without support.</p>
              </div>
            )}
          </div>
        )}
        <div className="tour-card-actions">
          <button type="button" className="tour-back" onClick={back} disabled={index === 0}>Back</button>
          {/* Moving focus into an aria-modal dialog on open is the intended
              dialog behaviour, not the stray page-load autofocus this rule
              guards against. */}
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="button" className="tour-next" onClick={advance} disabled={step.kind === 'practice' && practiceChoice === null} autoFocus>
            {step.kind === 'finish' ? 'Open Dashboard' :step.kind === 'practice' && !practiceRevealed ? 'Lock answer' : step.kind === 'premise' ? 'Continue' : `Next · ${step.cue ?? 'Continue'}`}
            <ArrowRight />
          </button>
        </div>
        <small className="tour-required">First-use orientation · complete once, replay any time from the header</small>
      </section>
    </div>
  )
}
