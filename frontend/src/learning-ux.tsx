import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Brain, Check, Clock3, Eye, RotateCcw, Scale, Target } from 'lucide-react'
import { Link } from 'react-router-dom'


type StudyFocus = 'accuracy' | 'reasoning' | 'pacing'

const FOCUS_OPTIONS: Array<{ id: StudyFocus; label: string; detail: string; icon: typeof Target }> = [
  { id: 'accuracy', label: 'Accuracy first', detail: 'Slow down at the decisive step.', icon: Target },
  { id: 'reasoning', label: 'Explain the gap', detail: 'Name why the credited answer wins.', icon: Brain },
  { id: 'pacing', label: 'Steady pacing', detail: 'Move cleanly without racing the clock.', icon: Clock3 },
]

const DAILY_BRIEFS = [
  {
    skill: 'Necessary assumptions',
    rule: 'Use the denial test.',
    note: 'Negate the answer. If the argument can no longer work, you found something it needed.',
    recall: 'What is the exact conclusion—and which answer must be true for that conclusion to follow?',
  },
  {
    skill: 'Strengthen questions',
    rule: 'Support the link, not merely the topic.',
    note: 'A relevant fact is not enough. The best answer makes the conclusion more likely through the argument’s actual gap.',
    recall: 'State the conclusion, evidence, and missing bridge in one sentence before reading the choices.',
  },
  {
    skill: 'Reading viewpoints',
    rule: 'Track who believes what.',
    note: 'When a passage changes speakers, theories, or eras, mark the relationship: support, contrast, concession, or refinement.',
    recall: 'Can you describe each viewpoint and the author’s attitude without looking back?',
  },
  {
    skill: 'Weaken questions',
    rule: 'Attack the route to the conclusion.',
    note: 'Look for an alternative cause, missing comparison, reversed direction, or evidence that the proposed mechanism fails.',
    recall: 'What would make the evidence true while leaving the conclusion doubtful?',
  },
  {
    skill: 'Inference questions',
    rule: 'Stay inside the record.',
    note: 'The credited answer needs support, not plausibility. Prefer the modest claim you can prove over the bold claim you can imagine.',
    recall: 'Which words in the passage directly license your prediction?',
  },
  {
    skill: 'Method of reasoning',
    rule: 'Describe the move, not the subject.',
    note: 'Translate the argument into roles: it rejects, distinguishes, analogizes, concedes, or offers a counterexample.',
    recall: 'What did the author do with the evidence between the first sentence and the conclusion?',
  },
  {
    skill: 'Flaw questions',
    rule: 'Name the invalid leap precisely.',
    note: 'Match the structure of the mistake. Avoid answers that merely criticize the topic or demand evidence the argument does not need.',
    recall: 'How could the premises be true while the conclusion is false?',
  },
]

function dayIndex() {
  const now = new Date()
  const key = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor(key / 86_400_000)
}

function readFocus(): StudyFocus {
  const stored = window.localStorage.getItem('lawyer-tycoon-study-focus')
  return stored === 'reasoning' || stored === 'pacing' ? stored : 'accuracy'
}

export function StudyFocusPicker({ compact = false }: { compact?: boolean }) {
  const [focus, setFocus] = useState<StudyFocus>(() => readFocus())

  const choose = (next: StudyFocus) => {
    setFocus(next)
    window.localStorage.setItem('lawyer-tycoon-study-focus', next)
  }

  return (
    <section className={`study-focus-picker ${compact ? 'compact' : ''}`} aria-labelledby="study-focus-title">
      <div className="study-focus-heading">
        <span>YOUR FOCUS</span>
        <strong id="study-focus-title">What would make this session useful?</strong>
        <small>This changes your reminder—not your score.</small>
      </div>
      <div className="study-focus-options" role="radiogroup" aria-label="Session focus">
        {FOCUS_OPTIONS.map(({ id, label, detail, icon: Icon }) => (
          <button type="button" role="radio" aria-checked={focus === id} className={focus === id ? 'selected' : ''} onClick={() => choose(id)} key={id}>
            <Icon />
            <span><strong>{label}</strong><small>{detail}</small></span>
            {focus === id && <Check />}
          </button>
        ))}
      </div>
    </section>
  )
}

export function DailyLearningBrief({ reviewCount = 0 }: { reviewCount?: number }) {
  const brief = useMemo(() => DAILY_BRIEFS[Math.abs(dayIndex()) % DAILY_BRIEFS.length], [])
  const storageKey = `lawyer-tycoon-brief-${new Date().toISOString().slice(0, 10)}`
  const [revealed, setRevealed] = useState(() => window.localStorage.getItem(storageKey) === 'revealed')

  const reveal = () => {
    setRevealed(true)
    window.localStorage.setItem(storageKey, 'revealed')
  }

  return (
    <section className="daily-learning-brief" aria-labelledby="daily-brief-title">
      <header>
        <div><span>THE DAILY BRIEF</span><h2 id="daily-brief-title">A useful idea for the next file.</h2></div>
        <small><Eye /> Quiet study · no rewards or mastery credit</small>
      </header>
      <div className="daily-brief-grid">
        <article className={`brief-rule-card ${revealed ? 'revealed' : 'held'}`}>
          <div><BookOpen /><span>{brief.skill}</span></div>
          <h3>{revealed ? brief.rule : 'Rule held until you retrieve.'}</h3>
          <p>{revealed ? brief.note : 'Answer the recall prompt from memory first. Then reveal the rule and compare your method.'}</p>
        </article>
        <article className={`brief-recall-card ${revealed ? 'revealed' : ''}`}>
          <div><Brain /><span>THIRTY-SECOND RECALL</span></div>
          <h3>{brief.recall}</h3>
          <p>{revealed ? 'Now compare your answer with the rule. Keep the useful method, not the wording.' : 'Say your answer in your own words before revealing the rule. Recognition feels fluent; retrieval builds access.'}</p>
          {!revealed && <button type="button" onClick={reveal}>Reveal rule & compare <Eye /></button>}
        </article>
        <article className="brief-review-card">
          <div><RotateCcw /><span>CLOSED FILES</span></div>
          <strong>{reviewCount}</strong>
          <p>{reviewCount ? 'Previously solved questions are ready for retrieval practice.' : 'Solved questions will collect here for later retrieval.'}</p>
          <Link to="/cases?view=review">{reviewCount ? 'Review a closed file' : 'See how review works'} <Scale /></Link>
        </article>
      </div>
    </section>
  )
}

export type ConfidenceLevel = 1 | 2 | 3 | 4

const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  1: 'Guessing',
  2: 'Leaning',
  3: 'Confident',
  4: 'Certain',
}

export function ConfidenceCheck({ value, onChange }: { value: ConfidenceLevel | null; onChange: (value: ConfidenceLevel) => void }) {
  return (
    <fieldset className="confidence-check">
      <legend><span>Before filing</span><strong>How confident are you?</strong><small>A quick prediction makes feedback more useful.</small></legend>
      <div>
        {([1, 2, 3, 4] as ConfidenceLevel[]).map((level) => (
          <button type="button" aria-pressed={value === level} className={value === level ? 'selected' : ''} onClick={() => onChange(level)} key={level}>
            <b>{level}</b><span>{CONFIDENCE_LABELS[level]}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function CalibrationNote({ confidence, correct }: { confidence: ConfidenceLevel | null; correct: boolean }) {
  if (!confidence) return null
  const high = confidence >= 3
  const title = correct
    ? high ? 'Your confidence matched the result.' : 'Your method was stronger than it felt.'
    : high ? 'This is a useful calibration miss.' : 'Your uncertainty was informative.'
  const detail = correct
    ? high ? 'Keep the reasoning move—not just the answer—in memory.' : 'Compare your valid steps with the point where doubt entered.'
    : high ? 'Find the first unsupported step before reading every explanation.' : 'Name what made the two leading choices difficult to separate.'
  return (
    <aside className={`calibration-note ${correct ? 'correct' : 'incorrect'}`}>
      <Target /><div><span>CONFIDENCE {confidence}/4 · {CONFIDENCE_LABELS[confidence]}</span><strong>{title}</strong><p>{detail}</p></div>
    </aside>
  )
}

export function useStoredConfidence(itemId?: string) {
  const [stored, setStored] = useState<{ itemId?: string; value: ConfidenceLevel | null }>({ itemId, value: null })

  useEffect(() => {
    if (!itemId) return
    const value = Number(window.localStorage.getItem(`lawyer-tycoon-confidence-${itemId}`))
    setStored({ itemId, value: value >= 1 && value <= 4 ? value as ConfidenceLevel : null })
  }, [itemId])

  const setConfidence = (value: ConfidenceLevel) => {
    setStored({ itemId, value })
    if (itemId) window.localStorage.setItem(`lawyer-tycoon-confidence-${itemId}`, String(value))
  }

  return [stored.itemId === itemId ? stored.value : null, setConfidence] as const
}
