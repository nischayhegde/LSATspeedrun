import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, BookOpen, Check, Clock3, Coffee, Flag, LockKeyhole, RotateCcw } from 'lucide-react'

import { api } from './api'
import { ErrorNotice } from './components'
import { useSound } from './sound'
import type { ExamPaper, ExamSection, ExamState, StudySession } from './types'
// Travels with this chunk. It restates nothing from `case-session-styles.css`
// except `.answer-card.exam-card`, which is deliberately more specific, so it
// is ranked immediately behind that sheet in `lsat-route-stylesheets`.
import './exam-flow.css'

/* The sectioned mega-litigation, kept apart from `case-flow.tsx` on purpose.
   A practice case is a client, a fee and a written argument; a form is a
   proctored administration where none of those exist. Sharing one component
   would mean threading "is this the real thing" through every branch of a
   thousand-line file, and the branches that mattered would be the ones nobody
   noticed — a confidence widget still rendering, a fee still counting up. What
   is shared is the stylesheet, so a passage and a choice list look the same
   in both. */

const MINUTE = 60_000

function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

function formatSpan(seconds: number) {
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`
}

/**
 * Count a server-issued deadline down locally, and never let the local count
 * be the thing that decides.
 *
 * The server owns the clock: `remaining_ms` arrives on every reply and this
 * resets to it whenever it changes, so a laptop with a wrong system time, a
 * throttled background tab, or a student who tries the obvious trick of
 * changing the clock all read the same section length. What runs here is only
 * the animation between replies. Reaching zero does not end anything; it asks
 * the server, which had already decided.
 */
function useServerClock(remainingMs: number | null | undefined, onElapsed: () => void) {
  const [left, setLeft] = useState(() => remainingMs ?? 0)
  const elapsedRef = useRef(onElapsed)
  elapsedRef.current = onElapsed

  useEffect(() => {
    if (remainingMs == null) return
    const endsAt = Date.now() + remainingMs
    setLeft(remainingMs)
    let fired = false
    const tick = () => {
      const next = endsAt - Date.now()
      setLeft(Math.max(0, next))
      if (next <= 0 && !fired) {
        fired = true
        elapsedRef.current()
      }
    }
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [remainingMs])

  return remainingMs == null ? null : left
}

/**
 * Re-read the sitting whenever the tab could have missed something.
 *
 * This is the disconnect policy made visible rather than a nicety. Closing a
 * laptop mid-section does not pause anything, so coming back has to show the
 * truth immediately — including "that section ended while you were gone" —
 * instead of a stale countdown that keeps ticking a section the student no
 * longer has. The slow interval covers a tab left open and idle.
 */
function useRefetchOnReturn(sessionId: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    const timer = window.setInterval(refresh, 30_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.clearInterval(timer)
    }
  }, [queryClient, sessionId])
}


function SectionRoster({ sections, activeIndex }: { sections: ExamSection[]; activeIndex: number | null }) {
  return (
    <ol className="exam-roster" aria-label="Sections of this form">
      {sections.map((section) => {
        const state = section.status === 'ended'
          ? (section.ended_reason === 'expired' ? 'expired' : 'done')
          : section.index === activeIndex ? 'active' : 'pending'
        return (
          <li key={section.index} className={`exam-roster-item is-${state}`} aria-current={state === 'active' || undefined}>
            <span>{section.index + 1}</span>
            <div>
              <strong>{section.label}</strong>
              <small>
                {state === 'done' && `${section.questions} questions · submitted`}
                {state === 'expired' && `${section.unanswered} left blank at the bell`}
                {state === 'active' && `${section.questions} questions · ${formatSpan(section.time_limit_seconds)}`}
                {state === 'pending' && `${section.questions} questions · ${formatSpan(section.time_limit_seconds)}`}
              </small>
            </div>
            {state === 'done' && <Check size={16} />}
            {state === 'expired' && <Clock3 size={16} />}
            {state === 'pending' && <LockKeyhole size={16} />}
          </li>
        )
      })}
    </ol>
  )
}


/** The boundary between sections: before the first, and before any later one. */
function SectionGate({ session, exam }: { session: StudySession; exam: ExamState }) {
  const queryClient = useQueryClient()
  const next = exam.sections.find((section) => section.index === exam.next_section_index)
  const start = useMutation({
    mutationFn: () => api.startExamSection(session.id, exam.next_section_index!),
    onSuccess: (data) => {
      queryClient.setQueryData(['session', session.id], data)
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    },
  })
  const expiresAt = exam.boundary_expires_at ? Date.parse(exam.boundary_expires_at) : null
  const [graceLeft, setGraceLeft] = useState(() => (expiresAt ? expiresAt - Date.now() : null))
  useEffect(() => {
    if (!expiresAt) return
    const timer = window.setInterval(() => setGraceLeft(expiresAt - Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  if (!next) return null
  return (
    <div className="exam-gate page-wrap">
      <span className="eyebrow">SECTION {next.index + 1} OF {exam.sections.length}</span>
      <h1>{next.label}</h1>
      <p className="exam-gate-terms">
        {next.questions} questions · {formatSpan(next.time_limit_seconds)} · the clock starts the moment you begin
        and does not stop for anything, including closing this tab.
      </p>
      <SectionRoster sections={exam.sections} activeIndex={null} />
      <button className="primary-button" disabled={start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? 'Starting…' : `Begin section ${next.index + 1}`} <ArrowRight size={18} />
      </button>
      {graceLeft != null && graceLeft < 20 * MINUTE && (
        <p className="exam-gate-grace" role="status">
          {graceLeft > 0
            ? `Begin within ${formatClock(graceLeft)} or this sitting is closed out and scored as it stands.`
            : 'This sitting has been left too long and is being closed out.'}
        </p>
      )}
      {start.error && <ErrorNotice error={start.error} />}
    </div>
  )
}


/** The ten-minute break the real administration gives after section two. */
function Intermission({ session, exam }: { session: StudySession; exam: ExamState }) {
  const queryClient = useQueryClient()
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
  }, [queryClient, session.id])
  const left = useServerClock(exam.remaining_ms, refresh)
  const next = exam.sections.find((section) => section.index === exam.next_section_index)
  const start = useMutation({
    mutationFn: () => api.startExamSection(session.id, exam.next_section_index!),
    onSuccess: (data) => queryClient.setQueryData(['session', session.id], data),
  })
  return (
    <div className="exam-intermission page-wrap">
      <div className="exam-intermission-mark"><Coffee size={30} /></div>
      <span className="eyebrow">INTERMISSION</span>
      <h1>{left != null && left > 0 ? formatClock(left) : 'Break over'}</h1>
      <p>
        Stand up, get water. The break runs on its own clock and ending it early does not add the time to the
        next section — on the real test it would not either.
      </p>
      {next && (
        <button className="primary-button" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? 'Starting…' : `Begin section ${next.index + 1}: ${next.label}`} <ArrowRight size={18} />
        </button>
      )}
      <SectionRoster sections={exam.sections} activeIndex={null} />
      {start.error && <ErrorNotice error={start.error} />}
    </div>
  )
}


function AnswerSheetBar({
  papers,
  answers,
  flags,
  position,
  onJump,
}: {
  papers: ExamPaper[]
  answers: Record<string, string | null>
  flags: Record<string, boolean>
  position: number
  onJump: (position: number) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [position])
  return (
    <nav className="exam-sheet" aria-label="Answer sheet">
      {papers.map((paper) => {
        const answered = Boolean(answers[paper.id])
        const flagged = Boolean(flags[paper.id])
        const current = paper.position === position
        return (
          <button
            key={paper.id}
            ref={current ? activeRef : undefined}
            type="button"
            className={`exam-sheet-cell ${answered ? 'is-answered' : ''} ${flagged ? 'is-flagged' : ''} ${current ? 'is-current' : ''}`}
            aria-current={current || undefined}
            aria-label={`Question ${paper.number}${answered ? `, answered ${answers[paper.id]}` : ', unanswered'}${flagged ? ', flagged' : ''}`}
            onClick={() => onJump(paper.position)}
          >
            {paper.number}
            {flagged && <i aria-hidden="true" />}
          </button>
        )
      })}
    </nav>
  )
}


function SectionRun({ session, exam }: { session: StudySession; exam: ExamState }) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const sectionIndex = exam.active_section_index!
  const section = exam.sections.find((entry) => entry.index === sectionIndex)!

  const papersQuery = useQuery({
    queryKey: ['exam-section', session.id, sectionIndex],
    queryFn: () => api.examSection(session.id),
    staleTime: Infinity,
    gcTime: 5 * MINUTE,
  })
  const papers = useMemo(() => papersQuery.data?.items ?? [], [papersQuery.data])

  // Mirrors of the sheet, so marking an answer paints instantly while the write
  // is in flight. The server's copy is the real one and wins on every reply.
  const [answers, setAnswers] = useState<Record<string, string | null>>({})
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!papers.length) return
    setAnswers(Object.fromEntries(papers.map((paper) => [paper.id, paper.selected_label])))
    setFlags(Object.fromEntries(papers.map((paper) => [paper.id, paper.flagged])))
  }, [papers])

  const [position, setPosition] = useState(session.current_index)
  useEffect(() => {
    setPosition((current) =>
      current >= section.start_position && current <= section.end_position ? current : section.start_position,
    )
  }, [section.start_position, section.end_position])

  const paper = papers.find((entry) => entry.position === position) ?? papers[0]
  const [mobilePane, setMobilePane] = useState<'passage' | 'question'>('question')
  useEffect(() => { setMobilePane(paper?.question.passage ? 'passage' : 'question') }, [paper?.id])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
  }, [queryClient, session.id])
  const left = useServerClock(exam.remaining_ms, refresh)

  const focus = useMutation({ mutationFn: (next: number) => api.focusExamItem(session.id, next) })
  const record = useMutation({
    mutationFn: (body: { itemId: string; selected_label?: string | null; flagged?: boolean }) =>
      api.recordExamAnswer(session.id, body.itemId, { selected_label: body.selected_label, flagged: body.flagged }),
    onSuccess: (data) => {
      setAnswers((current) => ({ ...current, [data.answer.item_id]: data.answer.selected_label }))
      setFlags((current) => ({ ...current, [data.answer.item_id]: data.answer.flagged }))
    },
    // A refused write means the section closed underneath this tab. Re-reading
    // is the only honest response: the sheet on screen is no longer the sheet.
    onError: refresh,
  })
  const [confirming, setConfirming] = useState(false)
  const submit = useMutation({
    mutationFn: () => api.submitExamSection(session.id, sectionIndex),
    onSuccess: (data) => {
      queryClient.setQueryData(['session', session.id], data)
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
      void queryClient.invalidateQueries({ queryKey: ['diagnostic'] })
    },
  })

  const jump = useCallback((next: number) => {
    if (next < section.start_position || next > section.end_position) return
    setPosition(next)
    // Fired and not awaited: the move has already happened on screen, and the
    // server call exists to bank the time on the question being left rather
    // than to authorise a move the student is entitled to make.
    focus.mutate(next)
  }, [focus, section.start_position, section.end_position])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.key === 'ArrowRight') jump(position + 1)
      if (event.key === 'ArrowLeft') jump(position - 1)
      if (paper && /^[a-eA-E]$/.test(event.key)) {
        const label = event.key.toUpperCase()
        if (paper.question.choices.some((choice) => choice.label === label)) {
          setAnswers((current) => ({ ...current, [paper.id]: label }))
          record.mutate({ itemId: paper.id, selected_label: label })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jump, position, paper, record])

  if (papersQuery.isLoading) return <div className="exam-loading page-wrap"><Clock3 size={26} /><p>Handing out the section…</p></div>
  if (papersQuery.error) return <div className="exam-loading page-wrap"><ErrorNotice error={papersQuery.error} /></div>
  if (!paper) return null

  const answeredCount = papers.filter((entry) => answers[entry.id]).length
  const warning = left != null && left <= exam.warning_seconds * 1000
  const selected = answers[paper.id] ?? null
  const flagged = Boolean(flags[paper.id])

  return (
    <div className="exam-run">
      <header className="exam-bar">
        <div className="exam-bar-section">
          <span>SECTION {sectionIndex + 1} OF {exam.sections.length}</span>
          <strong>{section.label}</strong>
        </div>
        <div className="exam-bar-count">
          <strong>Question {paper.number} of {section.questions}</strong>
          <small>{answeredCount} answered · {section.questions - answeredCount} blank</small>
        </div>
        <div className={`exam-clock ${warning ? 'is-warning' : ''}`} aria-live="off" aria-label="Time left in this section">
          <Clock3 size={18} />
          <span>{left == null ? '—' : formatClock(left)}</span>
          <small>{warning ? 'five minutes' : 'left in this section'}</small>
        </div>
      </header>

      <AnswerSheetBar papers={papers} answers={answers} flags={flags} position={position} onJump={jump} />

      {paper.question.passage && (
        <div className="mobile-case-pane-tabs" role="tablist" aria-label="Reading view">
          <button type="button" role="tab" aria-selected={mobilePane === 'passage'} className={mobilePane === 'passage' ? 'active' : ''} onClick={() => setMobilePane('passage')}><BookOpen size={15} /> Passage</button>
          <button type="button" role="tab" aria-selected={mobilePane === 'question'} className={mobilePane === 'question' ? 'active' : ''} onClick={() => setMobilePane('question')}>Question</button>
        </div>
      )}

      <div className={paper.question.passage ? `question-content with-passage mobile-pane-${mobilePane}` : 'question-content'}>
        {paper.question.passage && (
          <article className="passage-card">
            <div className="document-heading"><BookOpen size={16} /><span>READING PASSAGE</span></div>
            <div className="passage-text">{paper.question.passage.text}</div>
            <button type="button" className="mobile-open-question" onClick={() => setMobilePane('question')}>Go to the question <ArrowRight size={17} /></button>
          </article>
        )}

        <section className="answer-card exam-card">
          {paper.question.stimulus && <div className="stimulus">{paper.question.stimulus}</div>}
          <span className="question-label">QUESTION {paper.number}</span>
          <h1>{paper.question.stem}</h1>
          <div className="choices" role="radiogroup" aria-label="Answer choices">
            {paper.question.choices.map((choice) => (
              <button
                type="button"
                role="radio"
                aria-checked={selected === choice.label}
                className={`choice ${selected === choice.label ? 'selected' : ''}`}
                key={choice.label}
                onClick={() => {
                  if (selected !== choice.label) void play('select', { seed: `${paper.id}:${choice.label}`, intensity: .3 })
                  setAnswers((current) => ({ ...current, [paper.id]: choice.label }))
                  record.mutate({ itemId: paper.id, selected_label: choice.label })
                }}
              >
                <span className="choice-label">{choice.label}</span>
                <span>{choice.text}</span>
              </button>
            ))}
          </div>

          {/* Nothing is graded until the section closes, so every one of these
              is reversible and says so. The real interface has the same three. */}
          <div className="exam-item-actions">
            <button
              type="button"
              className={`exam-flag ${flagged ? 'is-on' : ''}`}
              aria-pressed={flagged}
              onClick={() => {
                setFlags((current) => ({ ...current, [paper.id]: !flagged }))
                record.mutate({ itemId: paper.id, flagged: !flagged })
              }}
            ><Flag size={16} /> {flagged ? 'Flagged' : 'Flag for review'}</button>
            <button
              type="button"
              className="exam-clear"
              disabled={!selected}
              onClick={() => {
                setAnswers((current) => ({ ...current, [paper.id]: null }))
                record.mutate({ itemId: paper.id, selected_label: null })
              }}
            ><RotateCcw size={16} /> Reset response</button>
          </div>
          {record.error && <ErrorNotice error={record.error} />}
        </section>
      </div>

      <footer className="exam-foot">
        <button type="button" className="exam-step" disabled={position <= section.start_position} onClick={() => jump(position - 1)}>
          <ArrowLeft size={17} /> Back
        </button>
        {confirming ? (
          <div className="exam-submit-confirm" role="alertdialog" aria-label="Confirm submitting this section">
            <strong>
              End section {sectionIndex + 1}?
              {section.questions - answeredCount > 0 && ` ${section.questions - answeredCount} of ${section.questions} are still blank.`}
            </strong>
            <small>You cannot come back to this section, and the time left on it is not carried forward.</small>
            <div>
              <button type="button" onClick={() => setConfirming(false)}>Keep working</button>
              <button type="button" className="primary-button" disabled={submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? 'Ending…' : 'End the section'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="exam-submit" onClick={() => setConfirming(true)}>End section {sectionIndex + 1}</button>
        )}
        <button type="button" className="exam-step" disabled={position >= section.end_position} onClick={() => jump(position + 1)}>
          Next <ArrowRight size={17} />
        </button>
      </footer>
      {submit.error && <ErrorNotice error={submit.error} />}
    </div>
  )
}


export function ExamFlow({ session }: { session: StudySession }) {
  const exam = session.exam!
  useRefetchOnReturn(session.id)
  if (exam.stage === 'in_section' && exam.active_section_index != null) {
    return <SectionRun key={exam.active_section_index} session={session} exam={exam} />
  }
  if (exam.stage === 'intermission') return <Intermission session={session} exam={exam} />
  if (exam.stage === 'awaiting_section') return <SectionGate session={session} exam={exam} />
  return null
}
