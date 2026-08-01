import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpen, BriefcaseBusiness, Building2, Check, Clock3, Map, Scale, Sparkles } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useSound } from './sound'
import { loadStylizedCharacter } from './art/scene-loaders'
import './guided-tour.css'

const StylizedCharacter = lazy(() => loadStylizedCharacter().then((module) => ({ default: module.StylizedCharacter })))

const TOUR_STORAGE_KEY = 'lawyer-speedrun:guided-tour:v4'
const TOUR_REPLAY_EVENT = 'lawyer-speedrun:replay-tour'

type TourStep = {
  kind: 'premise' | 'spotlight' | 'practice' | 'finish'
  eyebrow: string
  title: string
  body: string
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
    eyebrow: '01 · TRAINING',
    title: 'Start from evidence, not guesswork.',
    body: 'Take the diagnostic, follow today’s prescription, and watch accuracy, pacing, confidence, and retention improve separately.',
    target: '[data-tour="nav-progress"]',
    route: '/progress',
    cue: 'Training',
  },
  {
    kind: 'spotlight',
    eyebrow: '02 · PRACTICE',
    title: 'Choose the right depth for the moment.',
    body: 'Every run is the same: unseen questions with any due repairs folded in, a written explanation on each one, and coaching after every answer.',
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
    kind: 'spotlight',
    eyebrow: '03 · OFFICE',
    title: 'Your working day lives here.',
    body: 'Open the next case, meet the active client, and see the serious workspace evolve as your demonstrated mastery rises.',
    target: '[data-tour="nav-office"]',
    route: '/office',
    cue: 'Office',
  },
  {
    kind: 'spotlight',
    eyebrow: '04 · FIRM',
    title: 'Progression follows learning.',
    body: 'Upgrades, staff, and acquisitions reflect your practice history. They support the loop; they never replace instruction.',
    target: '[data-tour="nav-firm"]',
    route: '/firm',
    cue: 'Firm',
  },
  {
    kind: 'spotlight',
    eyebrow: '05 · WORLD',
    title: 'The map is your career record.',
    body: 'Each arc is a living legal environment. Levels sit on one deliberate route, with districts unlocking as your firm and LSAT skill advance.',
    target: '[data-tour="nav-map"]',
    route: '/map',
    cue: 'World',
  },
  {
    kind: 'spotlight',
    eyebrow: '06 · YOUR EVIDENCE',
    title: 'Read the signal, not the decoration.',
    body: 'This compact standing shows verified accuracy and completed questions. The Training page holds the deeper analysis.',
    target: '[data-tour="standing"]',
    route: '/map',
    cue: 'Standing',
  },
  {
    kind: 'spotlight',
    eyebrow: '07 · SOUND',
    title: 'A quiet layer of feedback.',
    body: 'Sound marks navigation, files, verdicts, and promotions. Keep it on, lower it, use Lite mode, or mute it at any time.',
    target: '[data-tour="sound"]',
    route: '/map',
    cue: 'Sound controls',
  },
  {
    kind: 'finish',
    eyebrow: 'THE DOCKET IS OPEN',
    title: 'Begin with a baseline.',
    body: 'Your first best move is the diagnostic. After that, the app can prescribe the fastest useful work instead of merely giving you more work.',
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
    const measure = () => {
      const target = findVisibleTarget(step.target)
      if (!target) {
        frame = window.requestAnimationFrame(measure)
        return
      }
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
            <div className="tour-confidence"><span>Confidence</span><button type="button" tabIndex={-1}>Low</button><button type="button" className="active" tabIndex={-1}>Medium</button><button type="button" tabIndex={-1}>High</button></div>
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
            {step.kind === 'finish' ? 'Open Training' : step.kind === 'practice' && !practiceRevealed ? 'Lock answer' : step.kind === 'premise' ? 'Continue' : `Next · ${step.cue ?? 'Continue'}`}
            <ArrowRight />
          </button>
        </div>
        <small className="tour-required">First-use orientation · complete once, replay any time from the header</small>
      </section>
    </div>
  )
}
