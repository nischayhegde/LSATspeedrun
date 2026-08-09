/**
 * A standalone rig for the strategy gates.
 *
 * The live question view lives in `components.tsx`, which is being edited
 * elsewhere, so this page mounts the same gate against the same API and the
 * same real practice session. What it renders around the gate is deliberately
 * the minimum: the stimulus, the choices, and the submit button, wired exactly
 * the way `QuestionFlow` will be wired. That makes this both the test surface
 * and a worked example of the integration.
 *
 * Served by the dev server at /gate-harness.html. It is not part of the app
 * bundle and nothing in `src/` imports it.
 */

import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { api, ApiError } from './api'
import { LockedChoicesNotice, useStrategyGate } from './strategy-enforcement'
import type { SessionItem, StudySession } from './types'
import './styles.css'
import './strategy-enforcement.css'

const EMAIL = 'gate-harness@example.test'

function requestId() {
  return `harness-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

function Harness() {
  const [session, setSession] = useState<StudySession | null>(null)
  const [status, setStatus] = useState('Signing in')
  const [applied, setApplied] = useState<boolean | null>(null)
  const [selected, setSelected] = useState('')
  const [reasoning, setReasoning] = useState(
    'The conclusion rests on a link the credited choice supplies directly, and every other option either widens the scope or swaps the term the argument needs.',
  )
  const [verdict, setVerdict] = useState('')
  const [submitError, setSubmitError] = useState('')

  const item: SessionItem | null = (session?.pending_item || session?.current_item) ?? null

  const gate = useStrategyGate(item, {
    armed: applied === true,
    selectedLabel: selected,
    locked: Boolean(session?.pending_result),
    onDrop: () => setApplied(false),
  })

  const boot = useCallback(async () => {
    setStatus('Signing in')
    await fetch('/v1/auth/dev', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, display_name: 'Gate Harness' }),
    })
    setStatus('Opening the firm')
    const game = await api.game().catch(() => null)
    if (!game?.game) {
      await api
        .createGame({ lawyer_name: 'Gate Harness', firm_name: 'Harness Legal', character_gender: 'female' })
        .catch(() => undefined)
    }
    setStatus('Starting a run')
    const current = await api.currentSession().catch(() => null)
    const next = current?.session ?? (await api.startPractice()).session
    setSession(next)
    setStatus('')
  }, [])

  useEffect(() => {
    void boot().catch((error) => setStatus(`Could not start: ${String(error)}`))
  }, [boot])

  const refresh = useCallback(async () => {
    if (!session) return
    const next = await api.session(session.id)
    setSession(next.session)
    setSelected('')
    setApplied(null)
    setVerdict('')
    setSubmitError('')
  }, [session])

  async function submit() {
    if (!item || !session) return
    setSubmitError('')
    try {
      const response = await api.submitAttempt(
        session.id,
        {
          item_id: item.id,
          selected_label: selected,
          reasoning,
          confidence: 3,
          ...(item.strategy_trial ? { strategy_applied: applied ?? false, strategy_prompt_ms: 900, ...gate.payload } : {}),
        },
        requestId(),
      )
      setVerdict(response.result.is_correct ? 'Recorded: correct' : 'Recorded: incorrect')
    } catch (error) {
      if (error instanceof ApiError) {
        gate.applyServerErrors(error.fields)
        setSubmitError(error.message)
      } else {
        setSubmitError(String(error))
      }
    }
  }

  if (!item) return <main className="harness"><p>{status || 'No question available.'}</p></main>

  const trial = item.strategy_trial
  const blocked = !selected || !gate.satisfied

  return (
    <main className="harness" data-strategy={trial?.key || 'none'} data-gate={item.strategy_gate?.kind || 'none'}>
      <h1>Strategy gate harness</h1>
      <p className="harness-meta" data-testid="meta">
        {trial ? `${trial.plain_title} · ${item.strategy_gate?.kind ?? 'no gate'} · ${item.strategy_gate?.strength ?? ''}` : 'No strategy on this question'}
      </p>

      {trial && (
        <section className="harness-card">
          <h2>{trial.plain_title}</h2>
          <p>{trial.plain_line}</p>
          <ol>{trial.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <div className="harness-actions">
            <button type="button" data-testid="use-it" aria-pressed={applied === true} onClick={() => setApplied(true)}>
              {item.strategy_gate?.copy.arm_label ?? 'Use it'}
            </button>
            <button type="button" data-testid="skip-it" aria-pressed={applied === false} onClick={() => setApplied(false)}>
              {item.strategy_gate?.copy.skip_label ?? 'Skip this one'}
            </button>
          </div>
        </section>
      )}

      {gate.panel}

      <section className="harness-card">
        {item.question.stimulus && <p data-testid="stimulus">{item.question.stimulus}</p>}
        <h2 data-testid="stem">{item.question.stem}</h2>
        {gate.choicesHidden && item.strategy_gate ? (
          <LockedChoicesNotice gate={item.strategy_gate} count={item.question.choices.length} />
        ) : (
          <div
            className="harness-choices"
            role="radiogroup"
            aria-label="Answer choices"
            data-testid="choices"
            data-gate-revealed={gate.justRevealed ? 'true' : undefined}
          >
            {item.question.choices.map((choice, choiceIndex) => {
              const stricken = gate.strickenLabels.includes(choice.label)
              return (
                <button
                  key={choice.label}
                  type="button"
                  role="radio"
                  aria-checked={selected === choice.label}
                  disabled={stricken}
                  style={{ ['--sg-index' as string]: choiceIndex }}
                  data-testid={`choice-${choice.label}`}
                  className={selected === choice.label ? 'is-on' : ''}
                  onClick={() => setSelected(choice.label)}
                >
                  <b>{choice.label}</b> {choice.text}
                </button>
              )
            })}
          </div>
        )}
        {gate.submitPanel}
        <label className="harness-reasoning">
          <span>Reasoning</span>
          <textarea value={reasoning} rows={3} onChange={(event) => setReasoning(event.target.value)} />
        </label>
        <button type="button" data-testid="submit" disabled={blocked} onClick={() => void submit()}>
          {blocked ? gate.blockedReason || 'Select an answer' : 'Submit'}
        </button>
        {submitError && (
          <p className="harness-error" role="alert" data-testid="submit-error">
            {submitError}
          </p>
        )}
        {verdict && (
          <p role="status" data-testid="verdict">
            {verdict}
          </p>
        )}
        <button type="button" data-testid="next" onClick={() => void refresh()}>
          Reload question
        </button>
      </section>
    </main>
  )
}

// The gate reads the student's own record with the strategy through the same
// query cache the app uses, so the harness has to provide one. Retries off:
// a harness that silently waits three times on a dev backend that is down
// looks like a harness that is broken.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  </StrictMode>,
)
