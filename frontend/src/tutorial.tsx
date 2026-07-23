import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  Check,
  Coins,
  Map,
  Scale,
  X,
  type LucideIcon,
} from 'lucide-react'

import './tutorial.css'


const STORAGE_PREFIX = 'lawyer-tycoon:tutorial:v1'

type TutorialStep = {
  id: string
  label: string
  title: string
  copy: string
  points: string[]
  icon: LucideIcon
}

const tutorialSteps: TutorialStep[] = [
  {
    id: 'docket',
    label: 'Docket & Intake',
    title: 'Choose the work before you open the file.',
    copy: 'Docket is the work hub. Active Work starts or resumes rewarded cases; Client Intake selects the contract for future files.',
    points: [
      'An open file keeps its original client and fee terms.',
      'Rapid Review revisits solved questions without changing firm progress.',
    ],
    icon: BriefcaseBusiness,
  },
  {
    id: 'reasoning',
    label: 'Build the case',
    title: 'Answer, explain, then file for a verdict.',
    copy: 'Choose the strongest answer and write a short case theory: name the task, cite the decisive evidence, and dismiss the closest alternative.',
    points: [
      'Drafts save while you work, so an interrupted file can be resumed.',
      'A–E selects an answer; Command/Ctrl + Enter files it.',
    ],
    icon: Scale,
  },
  {
    id: 'feedback',
    label: 'Read the ruling',
    title: 'Use the ruling to tighten the next argument.',
    copy: 'The verified answer key decides correctness. The judge then reviews your reasoning, timing, and the choice that turned the case.',
    points: [
      'Open the answer audit when you want the logic behind every choice.',
      'Strong, question-specific reasoning earns the full fee and Reputation credit.',
    ],
    icon: BookOpenCheck,
  },
  {
    id: 'growth',
    label: 'Invest the fee',
    title: 'Turn clean reasoning into a stronger firm.',
    copy: 'Cases pay cash and Reputation. Spend them in Firm on office upgrades, staff, connections, and later acquisitions.',
    points: [
      'The command deck keeps your active file and next useful investment visible.',
      'Every purchase has clear cash, Reputation, tier, or dependency requirements.',
    ],
    icon: Coins,
  },
  {
    id: 'empire',
    label: 'Read the map',
    title: 'Use Empire as the directory for what opens next.',
    copy: 'The map links each campus and its rooms. New destinations open as the office advances through the firm’s single progression route.',
    points: [
      'Open districts show where you can work now; locked districts show the required tier.',
      'You can reopen this guide from the question-mark button in the header.',
    ],
    icon: Map,
  },
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


export function useFirmTutorial(userId: string, firmReady: boolean) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const key = storageKey(userId)
    const saved = readTutorialState(key)

    if (!firmReady) {
      if (saved === null) writeTutorialState(key, 'pending')
      return
    }

    if (saved === 'pending') {
      // Consume on entry so a refresh never traps someone in onboarding.
      writeTutorialState(key, 'seen')
      setOpen(true)
      return
    }

    // Existing firms predate this flag and should continue uninterrupted.
    if (saved === null) writeTutorialState(key, 'seen')
  }, [firmReady, userId])

  return {
    open,
    close: () => setOpen(false),
    reopen: () => setOpen(true),
  }
}


export function FirmTutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeStep, setActiveStep] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const step = tutorialSteps[activeStep]
  const StepIcon = step.icon
  const isLast = activeStep === tutorialSteps.length - 1

  useEffect(() => {
    if (!open) return
    setActiveStep(0)
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }))

    return () => {
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'ArrowRight' && activeStep < tutorialSteps.length - 1) {
        event.preventDefault()
        setActiveStep((current) => current + 1)
        return
      }

      if (event.key === 'ArrowLeft' && activeStep > 0) {
        event.preventDefault()
        setActiveStep((current) => current - 1)
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeStep, onClose, open])

  if (!open) return null

  return (
    <div
      className="firm-tutorial-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="firm-tutorial"
        role="dialog"
        aria-modal="true"
        aria-labelledby="firm-tutorial-title"
        aria-describedby="firm-tutorial-copy"
        tabIndex={-1}
      >
        <aside className="firm-tutorial-rail" aria-label="Guide sections">
          <div className="firm-tutorial-seal"><Building2 /><span>FIRM<br />GUIDE</span></div>
          <ol>
            {tutorialSteps.map((item, index) => {
              const complete = index < activeStep
              return (
                <li key={item.id}>
                  <button
                    className={index === activeStep ? 'active' : complete ? 'complete' : ''}
                    onClick={() => setActiveStep(index)}
                    aria-current={index === activeStep ? 'step' : undefined}
                    aria-controls="firm-tutorial-step"
                    aria-label={`${index + 1}. ${item.label}`}
                  >
                    <span>{complete ? <Check /> : String(index + 1).padStart(2, '0')}</span>
                    <strong>{item.label}</strong>
                  </button>
                </li>
              )
            })}
          </ol>
          <small>← → MOVE · ESC CLOSE</small>
        </aside>

        <section className="firm-tutorial-page">
          <header>
            <div><span>ORIENTATION FILE</span><strong>{activeStep + 1} / {tutorialSteps.length}</strong></div>
            <button className="firm-tutorial-close" onClick={onClose} aria-label="Close guide"><X /></button>
          </header>

          <div id="firm-tutorial-step" className="firm-tutorial-step" key={step.id} aria-live="polite" aria-atomic="true">
            <div className="firm-tutorial-icon"><StepIcon /></div>
            <span className="firm-tutorial-kicker">STEP {String(activeStep + 1).padStart(2, '0')} · {step.label.toUpperCase()}</span>
            <h2 id="firm-tutorial-title">{step.title}</h2>
            <p id="firm-tutorial-copy">{step.copy}</p>
            <ul>
              {step.points.map((point) => <li key={point}><Check /> <span>{point}</span></li>)}
            </ul>
          </div>

          <footer>
            <button className="firm-tutorial-skip" onClick={onClose}>Close guide</button>
            <div className="firm-tutorial-actions">
              <button onClick={() => setActiveStep((current) => current - 1)} disabled={activeStep === 0}>
                <ArrowLeft /> Back
              </button>
              <button className="firm-tutorial-next" onClick={() => isLast ? onClose() : setActiveStep((current) => current + 1)}>
                {isLast ? 'Done' : 'Next'} {!isLast && <ArrowRight />}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  )
}
