import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  BookOpenCheck,
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  Flame,
  LogOut,
  Menu,
  PauseCircle,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'

import { api } from './api'
import type { AttemptResult, CoachingFeedback, CoachingHint, StudySession, User } from './types'
import { AnimatedStoryStage } from './story/AnimatedStoryStage'
import { adaptStoryBeat, type CinematicStoryPayload } from './story/adaptStoryBeat'
import { sessionStoryArcView, type SessionStoryArcView } from './story/sessionStoryArc'

const MemoizedStoryStage = memo(AnimatedStoryStage)
const SESSION_EXIT_EVENT = 'sherlock:prepare-session-exit'

type SessionExitEvent = CustomEvent<{ tasks: Array<Promise<unknown>> }>

export function LoadingScreen({ label = 'Opening the case file…' }: { label?: string }) {
  return (
    <div className="loading-screen">
      <div className="loader-seal"><FileSearch size={24} /></div>
      <p>{label}</p>
    </div>
  )
}

export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return <div className="error-notice" role="alert">{message}</div>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <span className="brand-mark"><FileSearch size={20} /></span>
      <span><strong>LSAT</strong> SHERLOCK</span>
    </div>
  )
}

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const logout = useMutation({
    mutationFn: async () => {
      const detail = { tasks: [] as Array<Promise<unknown>> }
      window.dispatchEvent(new CustomEvent(SESSION_EXIT_EVENT, { detail }))
      await Promise.allSettled(detail.tasks)
      return api.logout()
    },
    onSuccess: () => {
      queryClient.clear()
      navigate('/login')
    },
  })
  const levelProgress = Math.min(100, (user.story.xp % 500) / 5)

  return (
    <div className="app-frame">
      <header className="topbar">
        <NavLink to="/study" className="brand-link"><Brand compact /></NavLink>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="main-navigation"><Menu /></button>
        <nav id="main-navigation" className={menuOpen ? 'nav-open' : ''} aria-label="Main navigation">
          <NavLink to="/study" onClick={() => setMenuOpen(false)}><BookOpenCheck size={17} /> Cases</NavLink>
          <NavLink to="/story" onClick={() => setMenuOpen(false)}><Sparkles size={17} /> Story</NavLink>
          <NavLink to="/progress" onClick={() => setMenuOpen(false)}><BarChart3 size={17} /> Progress</NavLink>
        </nav>
        <div className="profile-cluster">
          <div className="xp-chip"><Flame size={15} /><strong>{user.story.xp}</strong> XP</div>
          <div className="avatar" title={user.display_name}>
            {user.avatar_url ? <img src={user.avatar_url} alt="" /> : user.display_name.slice(0, 1).toUpperCase()}
          </div>
          <button className="icon-button" onClick={() => logout.mutate()} aria-label="Sign out"><LogOut size={17} /></button>
        </div>
      </header>
      <div className="rank-line" aria-hidden="true"><span style={{ width: `${levelProgress}%` }} /></div>
      <main>{children}</main>
    </div>
  )
}

export function NoirScene({ chapter = 1, compact = false }: { chapter?: number; compact?: boolean }) {
  return (
    <div className={`noir-scene ${compact ? 'scene-compact' : ''}`} aria-hidden="true">
      <div className="moon" />
      <div className="city city-back" />
      <div className="city city-front" />
      <div className="rain" />
      <div className="lamp"><span /></div>
      <div className="detective-silhouette"><span className="hat" /><span className="coat" /></div>
      <div className="scene-caption">CHAPTER {chapter} · THE LANTERN BUREAU</div>
    </div>
  )
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function storyPayloadAfterAttempt(
  preAnswerPayload: CinematicStoryPayload | null | undefined,
  attempt: AttemptResult | null | undefined,
): CinematicStoryPayload | null {
  if (!attempt) return preAnswerPayload || null
  // The attempt snapshot is the authoritative post-grade reveal. Pre-answer
  // responses deliberately omit outcomes and the next payoff hook.
  if (attempt.story_snapshot) return attempt.story_snapshot

  // Compatibility for attempts created before snapshots were persisted.
  const payload = { ...(preAnswerPayload || {}) }
  if (attempt.is_correct) payload.correct_outcome ||= attempt.feedback.narrative_outcome
  else payload.incorrect_outcome ||= attempt.feedback.narrative_outcome
  payload.next_hook ||= attempt.feedback.transition
  return payload
}

function SavedDebriefPanel({ mode, onResume }: { mode: StudySession['mode']; onResume: () => void }) {
  return (
    <div className="paused-page page-hero">
      <div className="intro-scene"><NoirScene chapter={1} compact /></div>
      <div className="intro-copy">
        <div className="pause-seal"><PauseCircle /></div>
        <div className="eyebrow">DEBRIEF SAFELY BOOKMARKED</div>
        <h1>Your review is<br />ready when you are.</h1>
        <p>Your filed answer, story outcome, written reasoning, and AI review are saved. No additional evidence time is running.</p>
        <button className="primary-button large-button" onClick={onResume}>
          Resume {mode === 'diagnostic' ? 'diagnostic' : 'case'} debrief <ChevronRight />
        </button>
        <small>You can close this tab or use the Bureau navigation and return later.</small>
      </div>
    </div>
  )
}

function SessionStoryArcCard({ arc, outcomeResolved }: { arc: SessionStoryArcView; outcomeResolved: boolean }) {
  return (
    <section className="session-arc-card" aria-label={`Session story arc: ${arc.title}`}>
      <div className="session-arc-heading">
        <span><Sparkles size={13} /> {arc.aiPlanned ? 'TRUEFOUNDRY SESSION ARC' : 'BUREAU SESSION ARC'}</span>
        <strong>{arc.current}/{arc.total}</strong>
      </div>
      <h2>{arc.title}</h2>
      <p className="session-arc-premise">{arc.premise}</p>
      <div className="session-arc-objective"><small>ARC OBJECTIVE</small><p>{arc.objective}</p></div>
      <div className={`session-episode-thread ${outcomeResolved ? 'is-resolved' : ''}`}>
        <small>{outcomeResolved ? 'THREAD CARRIED FORWARD' : 'CURRENT STORY BEAT'}</small>
        <strong>{arc.episodeLabel} {String(arc.current).padStart(2, '0')} · {arc.roleLabel}</strong>
        <p>{arc.hook}</p>
      </div>
      <div
        className="session-arc-progress"
        role="progressbar"
        aria-label={`${arc.episodeLabel} progress`}
        aria-valuemin={1}
        aria-valuemax={arc.total}
        aria-valuenow={arc.current}
      >
        <span style={{ width: `${arc.progress}%` }} />
      </div>
    </section>
  )
}

export function QuestionFlow({ session }: { session: StudySession }) {
  const item = session.pending_item || session.current_item
  const restoredResult = session.pending_result || null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [result, setResult] = useState<AttemptResult | null>(restoredResult)
  const [hints, setHints] = useState<CoachingHint[]>(item?.hints || [])
  const [coaching, setCoaching] = useState<CoachingFeedback | null>(null)
  const [coachingStarted, setCoachingStarted] = useState(false)
  const [coachingSkipped, setCoachingSkipped] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [clockStartedAt, setClockStartedAt] = useState(Date.now())
  const [evidenceStarted, setEvidenceStarted] = useState(Boolean(item?.timer_started || restoredResult))
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [debriefSavedForLater, setDebriefSavedForLater] = useState(false)
  const [hintPausedAt, setHintPausedAt] = useState<number | null>(null)
  const draftVersion = useRef(0)
  const hintPausedAtRef = useRef<number | null>(null)
  const displayedAttemptId = useRef<string | null>(restoredResult?.attempt_id || null)
  const answerFiled = useRef(Boolean(restoredResult))
  const evidencePanelRef = useRef<HTMLElement | null>(null)
  const storyPanelRef = useRef<HTMLElement | null>(null)
  const currentStoryItemId = useRef(item?.id || null)
  const storyRequestedFor = useRef<string | null>(null)
  const [storyPayload, setStoryPayload] = useState<CinematicStoryPayload | null>(() => storyPayloadAfterAttempt(item?.story, restoredResult))

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setSelected(restoredResult?.feedback.selected_label || item?.draft.selected_label || '')
    setReasoning(item?.draft.reasoning || '')
    setResult(session.pending_item?.id === item?.id ? restoredResult : null)
    setHints(item?.hints || [])
    setCoaching(restoredResult?.feedback.coaching || null)
    setCoachingStarted(Boolean(restoredResult?.feedback.coaching))
    setCoachingSkipped(false)
    displayedAttemptId.current = restoredResult?.attempt_id || null
    answerFiled.current = Boolean(restoredResult)
    currentStoryItemId.current = item?.id || null
    storyRequestedFor.current = null
    setStoryPayload(storyPayloadAfterAttempt(item?.story, restoredResult))
    setNow(Date.now())
    setClockStartedAt(Date.now())
    setEvidenceStarted(Boolean(item?.timer_started || restoredResult))
    setDraftStatus(item?.draft.updated_at ? 'saved' : 'idle')
    setDebriefSavedForLater(false)
    hintPausedAtRef.current = null
    setHintPausedAt(null)
    setRequestId(crypto.randomUUID())
    const restoreEvidence = Boolean(restoredResult || item?.timer_started)
    const timer = window.setTimeout(() => {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      if (restoreEvidence) {
        evidencePanelRef.current?.scrollIntoView({ block: 'start', behavior })
        evidencePanelRef.current?.focus({ preventScroll: true })
      } else {
        window.scrollTo({ top: 0, behavior })
        storyPanelRef.current?.focus({ preventScroll: true })
      }
    }, 50)
    return () => window.clearTimeout(timer)
  }, [item?.id])

  useEffect(() => {
    setNow(Date.now())
    setClockStartedAt(Date.now())
  }, [item?.id, item?.elapsed_ms])

  const elapsed = useMemo(
    () => result ? result.elapsed_ms : item ? Math.max(0, item.elapsed_ms + (evidenceStarted ? (hintPausedAt ?? now) - clockStartedAt : 0)) : 0,
    [item, now, clockStartedAt, result, evidenceStarted, hintPausedAt],
  )
  const mutation = useMutation({
    mutationFn: () => api.submitAttempt(session.id, {
      item_id: item!.id,
      selected_label: selected,
      reasoning,
      elapsed_ms: elapsed,
    }, requestId),
    onSuccess: ({ result: attempt }) => {
      setResult(attempt)
      answerFiled.current = true
      displayedAttemptId.current = attempt.attempt_id
      setStoryPayload((current) => storyPayloadAfterAttempt(current || item?.story, attempt))
      setCoaching(attempt.feedback.coaching || null)
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      void queryClient.invalidateQueries({ queryKey: ['story-progress'] })
    },
  })
  const hintMutation = useMutation({
    mutationFn: () => api.requestHint(session.id, item!.id),
    onMutate: () => {
      const pausedAt = Date.now()
      hintPausedAtRef.current = pausedAt
      setHintPausedAt(pausedAt)
      setNow(pausedAt)
    },
    onSuccess: ({ hint }) => setHints((current) => [...current.filter((value) => value.level !== hint.level), hint].sort((a, b) => a.level - b.level)),
    onSettled: () => {
      const pausedAt = hintPausedAtRef.current
      if (pausedAt != null) setClockStartedAt((startedAt) => startedAt + Math.max(0, Date.now() - pausedAt))
      hintPausedAtRef.current = null
      setHintPausedAt(null)
      setNow(Date.now())
    },
  })
  const coachingMutation = useMutation({
    mutationFn: (attemptId: string) => api.coaching(attemptId),
    onSuccess: ({ coaching: feedback }, attemptId) => {
      if (displayedAttemptId.current === attemptId) setCoaching(feedback)
    },
  })
  const storyMutation = useMutation({
    mutationFn: ({ sessionId, itemId }: { sessionId: string; itemId: string }) => api.generateStory(sessionId, itemId),
    onSuccess: ({ story }, variables) => {
      if (currentStoryItemId.current === variables.itemId && !answerFiled.current) setStoryPayload(story)
    },
  })
  const timerMutation = useMutation({
    mutationFn: () => api.startEvidenceTimer(session.id, item!.id),
    onSuccess: () => {
      setEvidenceStarted(true)
      setNow(Date.now())
      setClockStartedAt(Date.now())
      window.setTimeout(() => evidencePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20)
    },
  })
  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (!result) await api.saveDraft(session.id, item!.id, { selected_label: selected || undefined, reasoning })
      if (session.status === 'completed') return { session }
      return api.pauseSession(session.id)
    },
    onSuccess: async ({ session: pausedSession }) => {
      queryClient.setQueryData(['session', session.id], { session: pausedSession })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      await queryClient.invalidateQueries({ queryKey: session.mode === 'diagnostic' ? ['diagnostic'] : ['current-session', 'daily'] })
      if (result) {
        setDebriefSavedForLater(true)
        return
      }
      navigate(session.mode === 'diagnostic' ? '/diagnostic?paused=1' : '/study')
    },
  })
  const continueMutation = useMutation({
    mutationFn: async () => {
      const acknowledged = await api.acknowledgeDebrief(session.id)
      if (!result?.session_complete && acknowledged.session.status === 'paused') return api.resumeSession(session.id)
      return acknowledged
    },
    onSuccess: async ({ session: nextSession }) => {
      queryClient.setQueryData(['session', session.id], { session: nextSession })
      if (result?.session_complete) {
        await queryClient.invalidateQueries({ queryKey: ['me'] })
        await queryClient.invalidateQueries({ queryKey: session.mode === 'diagnostic' ? ['diagnostic'] : ['current-session', 'daily'] })
        await queryClient.invalidateQueries({ queryKey: ['progress'] })
        navigate(session.mode === 'diagnostic' ? '/diagnostic/results' : `/session/${session.id}/summary`)
        return
      }
      if (session.mode === 'diagnostic') await queryClient.invalidateQueries({ queryKey: ['diagnostic'] })
      else await queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    },
  })

  useEffect(() => {
    if (result && !result.feedback.coaching && !coachingStarted) {
      setCoachingStarted(true)
      coachingMutation.mutate(result.attempt_id)
    }
  }, [result, coachingStarted])

  useEffect(() => {
    if (!item || result || storyPayload?.source === 'truefoundry' || storyRequestedFor.current === item.id) return
    storyRequestedFor.current = item.id
    storyMutation.mutate({ sessionId: session.id, itemId: item.id })
  }, [session.id, item?.id, storyPayload?.source, Boolean(result)])

  useEffect(() => {
    if (!item || result) return
    const version = ++draftVersion.current
    let retryTimer: number | undefined
    setDraftStatus('saving')
    const save = () => {
      api.saveDraft(session.id, item.id, { selected_label: selected || undefined, reasoning })
        .then(() => { if (draftVersion.current === version) setDraftStatus('saved') })
        .catch(() => {
          if (draftVersion.current !== version) return
          setDraftStatus('error')
          retryTimer = window.setTimeout(save, 3000)
        })
    }
    const timer = window.setTimeout(save, 650)
    return () => {
      window.clearTimeout(timer)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [session.id, item?.id, selected, reasoning, Boolean(result)])

  useEffect(() => {
    const persistThenLeave = async (destination?: string) => {
      if (item && !result) await api.saveDraft(session.id, item.id, { selected_label: selected || undefined, reasoning }).catch(() => undefined)
      await api.pauseSession(session.id).catch(() => undefined)
      if (destination) navigate(destination)
    }
    const interceptNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      event.preventDefault()
      void persistThenLeave(`${destination.pathname}${destination.search}${destination.hash}`)
    }
    const handleHistoryExit = () => { void persistThenLeave() }
    document.addEventListener('click', interceptNavigation, true)
    window.addEventListener('popstate', handleHistoryExit)
    return () => {
      document.removeEventListener('click', interceptNavigation, true)
      window.removeEventListener('popstate', handleHistoryExit)
    }
  }, [session.id, item?.id, selected, reasoning, Boolean(result), navigate])

  useEffect(() => {
    const prepareForSignOut = (event: Event) => {
      const tasks = (event as SessionExitEvent).detail?.tasks
      if (!tasks) return
      tasks.push((async () => {
        if (item && !result) {
          await api.saveDraft(session.id, item.id, { selected_label: selected || undefined, reasoning }).catch(() => undefined)
        }
        await api.pauseSession(session.id).catch(() => undefined)
      })())
    }
    window.addEventListener(SESSION_EXIT_EVENT, prepareForSignOut)
    return () => window.removeEventListener(SESSION_EXIT_EVENT, prepareForSignOut)
  }, [session.id, item?.id, selected, reasoning, Boolean(result)])

  useEffect(() => {
    const pauseOnExit = () => {
      if (item && !result) void api.saveDraft(session.id, item.id, { selected_label: selected || undefined, reasoning }, true).catch(() => undefined)
      void api.pauseSession(session.id, true).catch(() => undefined)
    }
    window.addEventListener('pagehide', pauseOnExit)
    return () => window.removeEventListener('pagehide', pauseOnExit)
  }, [session.id, item?.id, selected, reasoning, Boolean(result)])

  const storyArc = useMemo(
    () => item ? sessionStoryArcView(
      session,
      item,
      Boolean(result),
      result ? storyPayload?.next_hook || storyPayload?.transition : undefined,
      result?.planned_story_beat?.payoff_hook,
    ) : null,
    [session.story_plan, session.total_items, session.mode, item?.id, item?.position, item?.planned_story_role, item?.planned_story_beat, item?.planned_beat, Boolean(result), result?.planned_story_beat?.payoff_hook, storyPayload?.next_hook, storyPayload?.transition],
  )
  const stageBeat = useMemo(() => {
    if (!item) return null
    const beat = adaptStoryBeat(storyPayload || item.story, item.id, item.position, session.total_items, session.mode)
    if (!session.story_plan || !storyArc) return beat
    return {
      ...beat,
      chapter: storyArc.title,
      sequence: { current: storyArc.current, total: storyArc.total, label: storyArc.episodeLabel },
    }
  }, [storyPayload, item?.id, item?.position, item?.story, session.total_items, session.mode, session.story_plan, storyArc?.title, storyArc?.current, storyArc?.total, storyArc?.episodeLabel])
  if (!item || !stageBeat || !storyArc) return <LoadingScreen label="Finding the next evidence file…" />
  if (debriefSavedForLater) return <SavedDebriefPanel mode={session.mode} onResume={() => setDebriefSavedForLater(false)} />
  const mustWaitForReasoningGrade = Boolean(result && (result.has_reasoning || !result.is_correct) && !coaching && !coachingSkipped)

  return (
    <div className="case-page">
      <section className="case-story-panel" ref={storyPanelRef} tabIndex={-1} aria-label={`Story briefing for evidence file ${item.position + 1}`}>
        <div className="case-exit-bar">
          <div>
            <button onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending || mutation.isPending}>
              <Save size={15} /> {pauseMutation.isPending ? 'Saving…' : 'Save & exit'}
            </button>
            <button onClick={() => evidenceStarted ? evidencePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : timerMutation.mutate()} disabled={timerMutation.isPending}>
              <FileSearch size={15} /> {timerMutation.isPending ? 'Opening…' : evidenceStarted ? 'View evidence' : 'Open evidence'}
            </button>
          </div>
          <span>{draftStatus === 'saving' ? 'Saving draft…' : draftStatus === 'error' ? 'Draft save will retry' : 'Draft and progress saved'}</span>
        </div>
        {pauseMutation.error && <ErrorNotice error={pauseMutation.error} />}
        <SessionStoryArcCard arc={storyArc} outcomeResolved={Boolean(result)} />
        <MemoizedStoryStage
          beat={stageBeat}
          mode={session.mode}
          compact
          autoPlay
          loading={false}
          onDialogueComplete={() => {
            if (window.matchMedia('(max-width: 760px)').matches) evidencePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          outcome={!result ? 'unresolved' : result.is_correct ? 'correct' : 'incorrect'}
        />
        {storyMutation.isPending && <div className="story-fallback-note is-writing">Story director is matching the next beat to this evidence…</div>}
        {storyMutation.error && <div className="story-fallback-note">Live storyline unavailable—continuing with the saved Bureau scene.</div>}
      </section>

      <section className="evidence-panel" ref={evidencePanelRef} tabIndex={-1} aria-label={`Evidence file ${item.position + 1} of ${session.total_items}`}>
        <div className="question-toolbar">
          <div><span>{item.question.section}</span><strong>{item.question.question_type}</strong></div>
          <div className={`timer ${hintMutation.isPending ? 'is-paused' : ''}`} aria-label={evidenceStarted ? hintMutation.isPending ? `Evidence timer paused for hint at ${formatTime(elapsed)}` : `Elapsed evidence time ${formatTime(elapsed)}` : 'Evidence timer has not started'}>
            <Clock3 size={16} /> {evidenceStarted ? formatTime(elapsed) : 'STORY'}
            {hintMutation.isPending && <small>HINT PAUSE</small>}
          </div>
        </div>
        <div className="session-progress" aria-label={`Question ${item.position + 1} of ${session.total_items}`}>
          <span style={{ width: `${((item.position + 1) / session.total_items) * 100}%` }} />
        </div>
        {!evidenceStarted && !result ? (
          <div className="sealed-evidence">
            <div className="sealed-evidence-mark"><FileSearch /></div>
            <div className="eyebrow">CINEMATIC BRIEFING ACTIVE</div>
            <h2>Open the evidence when you’re ready.</h2>
            <p>The scored timer excludes story dialogue and starts only when the canonical question is revealed.</p>
            {timerMutation.error && <ErrorNotice error={timerMutation.error} />}
            <button className="primary-button large-button" onClick={() => timerMutation.mutate()} disabled={timerMutation.isPending}>
              {timerMutation.isPending ? 'Unsealing evidence…' : <>Open evidence & start timer <ChevronRight /></>}
            </button>
            {session.mode === 'diagnostic' && <small>Hints are disabled during the baseline diagnostic to protect the estimate.</small>}
          </div>
        ) : <>
        <div className="evidence-heading">
          <div className="paperclip" />
          <div><small>EVIDENCE FILE {String(item.position + 1).padStart(2, '0')}</small><h2>Review the record</h2></div>
          <div className="difficulty" aria-label={`Difficulty ${item.question.difficulty} of 5`}><span className="difficulty-filled" aria-hidden="true">{'◆'.repeat(item.question.difficulty)}</span><span aria-hidden="true">{'◇'.repeat(5 - item.question.difficulty)}</span></div>
        </div>

        {item.question.passage && (
          <details className="passage" open>
            <summary>Reading passage</summary>
            {item.question.passage.text.split(/(?=Passage [AB] )/).map((part, index) => <p key={index}>{part}</p>)}
          </details>
        )}
        {item.question.stimulus && <p className="stimulus">{item.question.stimulus}</p>}
        <h3 className="stem">{item.question.stem}</h3>

        {!result && session.mode !== 'diagnostic' && (
          <div className="hint-section" aria-live="polite" aria-busy={hintMutation.isPending}>
            <div className="hint-actions">
              <button className="hint-button" onClick={() => hintMutation.mutate()} disabled={hintMutation.isPending || hints.length >= 3}>
                <Sparkles size={16} />
                {hintMutation.isPending ? 'Rowan is reviewing the file…' : hints.length >= 3 ? 'All 3 clues revealed' : hints.length ? `Request clue ${hints.length + 1} of 3` : 'Ask Rowan for a controlled hint'}
              </button>
              <small>Hints guide the method without revealing the keyed answer.</small>
            </div>
            {hintMutation.error && <ErrorNotice error={hintMutation.error} />}
            {hints.map((hint) => (
              <div className="hint-card" key={hint.level}>
                <span>CLUE {hint.level}</span>
                <div><strong>{hint.focus}</strong><p>{hint.hint}</p><small>Try this: {hint.strategy}</small></div>
              </div>
            ))}
          </div>
        )}

        <fieldset className="choices" disabled={Boolean(result) || mutation.isPending || hintMutation.isPending}>
          <legend className="sr-only">Answer choices</legend>
          {item.question.choices.map((choice) => (
            <label key={choice.label} className={`choice ${selected === choice.label ? 'selected' : ''}`}>
              <input type="radio" name="answer" value={choice.label} checked={selected === choice.label} onChange={() => setSelected(choice.label)} />
              <span className="choice-label">{choice.label}</span>
              <span>{choice.text}</span>
            </label>
          ))}
        </fieldset>

        {!result && (
          <label className="reasoning-box">
            <span><Sparkles size={16} /> Explain your answer <em>{item.requires_reasoning ? 'Required for this file' : 'Optional · graded if provided'}</em></span>
            <textarea value={reasoning} onChange={(event) => setReasoning(event.target.value)} maxLength={4000} minLength={item.requires_reasoning ? 20 : undefined} required={item.requires_reasoning} aria-required={item.requires_reasoning} aria-describedby={`reasoning-help-${item.id}`} placeholder="What is the conclusion, what logical work must the answer do, and why does your choice do it?" />
            <small id={`reasoning-help-${item.id}`}>{reasoning.length}/4000{item.requires_reasoning ? ' · 20 character minimum' : ''} · TrueFoundry grades reasoning separately from whether the selected answer is correct.</small>
          </label>
        )}

        {mutation.error && <ErrorNotice error={mutation.error} />}
        {!result && (
          <button className="primary-button submit-answer" disabled={!selected || mutation.isPending || hintMutation.isPending || (item.requires_reasoning && reasoning.trim().length < 20)} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Filing answer…' : <>File answer <ChevronRight size={18} /></>}
          </button>
        )}

        {result && (
          <div className={`debrief ${result.is_correct ? 'correct' : 'incorrect'}`}>
            <div className="result-icon">{result.is_correct ? <Check /> : <X />}</div>
            <div className="debrief-copy">
              <div className="eyebrow">DETERMINISTIC ANSWER CHECK</div>
              <h2>{result.feedback.headline}</h2>
              <p>{result.feedback.diagnosis}</p>
              <div className="coaching-note"><ShieldCheck size={18} /><span>{result.feedback.coaching_notice}</span></div>
              <div className="ai-coaching-panel" aria-live="polite" aria-busy={coachingMutation.isPending}>
                <div className="ai-coaching-header">
                  <div><Sparkles size={18} /><span><strong>TrueFoundry reasoning review</strong><small>gpt-5.6-luna · xhigh · AI-generated analysis</small></span></div>
                  <span className="verified-pill"><ShieldCheck size={13} /> Answer key verified</span>
                </div>
                {!coaching && coachingMutation.isPending && (
                  <div className="coaching-loading"><span className="coaching-spinner" /><div><strong>Tracing your reasoning…</strong><small>Grading the explanation and analyzing each answer choice.</small></div></div>
                )}
                {!coaching && coachingMutation.error && (
                  <div className="coaching-retry">
                    <ErrorNotice error={coachingMutation.error} />
                    <div className="coaching-retry-actions">
                      <button className="secondary-button" onClick={() => { setCoachingSkipped(false); coachingMutation.mutate(result.attempt_id) }}>Retry AI review</button>
                      <button className="text-button" onClick={() => setCoachingSkipped(true)}>Continue without AI review</button>
                    </div>
                  </div>
                )}
                {coaching && (
                  <div className="coaching-results">
                    <div className="grade-row">
                      <div className="explanation-grade">
                        {coaching.explanation_grade == null ? <strong>—</strong> : <strong>{coaching.explanation_grade}</strong>}
                        <span>{coaching.explanation_grade == null ? 'QUICK FILE' : 'REASONING / 100'}</span>
                      </div>
                      <div><span className={`verdict verdict-${coaching.reasoning_verdict}`}>{coaching.reasoning_verdict.replace('_', ' ')}</span><p>{coaching.reasoning_summary}</p></div>
                    </div>
                    {coaching.first_error && (
                      <div className="first-error-card">
                        <span>FIRST REASONING BREAK · {coaching.first_error.code.replaceAll('_', ' ')}</span>
                        <strong>{coaching.first_error.description}</strong>
                        <p><b>Repair:</b> {coaching.first_error.repair}</p>
                      </div>
                    )}
                    <div className="answer-analysis-card correct-analysis">
                      <span>WHY {result.feedback.correct_label} WORKS</span>
                      <p>{coaching.answer_analysis.correct_answer_explanation}</p>
                    </div>
                    {!result.is_correct && (
                      <div className="answer-analysis-card wrong-analysis">
                        <span>WHY {result.feedback.selected_label} FAILS</span>
                        <p>{coaching.answer_analysis.selected_answer_explanation}</p>
                      </div>
                    )}
                    <details className="choice-analysis-list">
                      <summary>Review every answer choice</summary>
                      {coaching.answer_analysis.choice_explanations.map((choice) => (
                        <div key={choice.label}><span className={choice.is_correct ? 'correct-choice-mark' : ''}>{choice.label}</span><p>{choice.explanation}</p></div>
                      ))}
                    </details>
                    <div className="next-step"><strong>Next-step clue</strong><p>{coaching.next_step_hint}</p></div>
                    <p className="ai-debrief">{coaching.debrief}</p>
                  </div>
                )}
              </div>
              <blockquote>{result.feedback.narrative_outcome}</blockquote>
              <div className="result-meta"><span>+{result.xp_earned} XP</span><span>{formatTime(result.elapsed_ms)}</span></div>
              {continueMutation.error && <ErrorNotice error={continueMutation.error} />}
              <button className="primary-button" onClick={() => continueMutation.mutate()} disabled={mustWaitForReasoningGrade || continueMutation.isPending}>
                {mustWaitForReasoningGrade ? 'Grading your explanation…' : continueMutation.isPending ? 'Opening the next file…' : result.session_complete ? 'Open session debrief' : 'Open next case'} {!mustWaitForReasoningGrade && !continueMutation.isPending && <ChevronRight size={18} />}
              </button>
            </div>
          </div>
        )}
        </>}
      </section>
    </div>
  )
}
