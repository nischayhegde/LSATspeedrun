import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronDown, Clock3, Gauge, Hourglass, Lock, ShieldAlert, Target, Trophy, X } from 'lucide-react'

import { api } from './api'
import { AttemptDetail } from './progress-history'
import type { HistoryAttempt, HistorySession, MegaLitigationPromotionStatus } from './types'
import './progress-history.css'
import './mega-litigation.css'

/**
 * The mega-litigation's home on the Practice tab, plus every one already sat.
 *
 * A mega-litigation is the highest-stakes thing in the app — it is the only
 * unprompted, uncoached, single-sitting measurement, and it is what the score
 * projection is anchored on — but until now it was only advertised from the
 * dashboard, and a finished one vanished into the session list. This gives it
 * a home next to the practice it is supposed to steer, and gives every past
 * sitting a real result page.
 *
 * Past sittings come from `/history/sessions?mode=diagnostic`. A mixed
 * practice feed can bury the only form behind fifty case runs, so the filter
 * is on the query. A result is `/history/attempts?session_id=…`, which carries
 * enough per-question detail to rebuild the score, the section split and the
 * type split client-side; a single question is `/history/attempts/<id>`
 * through the dashboard's own reader.
 */

function formatDate(value: string | null) {
  if (!value) return 'Date unknown'
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatSeconds(milliseconds: number) {
  const total = Math.round(milliseconds / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}


function formatCountdown(milliseconds: number) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!rest) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${hours}h ${rest}m`
}


function formatClock(value: Date) {
  const sameDay = value.toDateString() === new Date().toDateString()
  const time = value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return sameDay ? time : `${time} on ${value.toLocaleDateString(undefined, { weekday: 'long' })}`
}


/**
 * The free tier a cleared mega-litigation was going to hand over, and why it
 * did not.
 *
 * `promotion_status` only reaches the client on the branch where the form
 * cleared 70% and the promotion was refused, so there is no ambiguity to
 * resolve here: if this renders at all, the student earned a bonus and did not
 * get it. Seventy-five questions and an hour and three quarters answered with
 * nothing on screen reads as a broken app, which is the whole reason this
 * exists.
 */
export function WithheldPromotionNotice({ status }: { status?: MegaLitigationPromotionStatus | null }) {
  const availableAtIso = status?.available_at ?? null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!availableAtIso) return
    // A minute's resolution is all the copy shows, so a 30s tick is enough to
    // keep it honest for a student sitting on the results page.
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [availableAtIso])
  const availableAt = availableAtIso ? new Date(availableAtIso) : null

  if (!status || status.available) return null
  const remaining = availableAt ? availableAt.getTime() - now : 0
  const elapsed = availableAt !== null && remaining <= 0
  const reason = status.blocked_reason

  const headline = reason === 'max_tier'
    ? 'Your firm is already at the top of the ladder.'
    : reason === 'lifetime_limit'
      ? `All ${status.limit} free promotions have already been used.`
      : elapsed
        ? 'The 24-hour wait has since passed.'
        : `Another one is not due for ${formatCountdown(remaining)}.`

  const why = reason === 'max_tier'
    ? 'There is no tier above the one you already hold, so there was nothing left to hand over.'
    : reason === 'lifetime_limit'
      ? `A free tier is a head start, not a way of playing: ${status.limit} is the lifetime allowance, and it is spent.`
      : `A mega-litigation promotes the firm at most once every ${status.cooldown_hours} hours, and one was already granted inside that window.`

  const when = reason === 'max_tier'
    ? 'Never — this is the last tier in the game.'
    : reason === 'lifetime_limit'
      ? 'Never. This one is permanent: every tier from here is bought with case fees and reputation on the Firm screen.'
      : elapsed
        ? 'Now. The next mega-litigation you clear will promote your firm.'
        : availableAt
          ? `In about ${formatCountdown(remaining)} — ${formatClock(availableAt)}. Clear another form after that and the tier is yours.`
          : `Once ${status.cooldown_hours} hours have passed since the last promotion.`

  return (
    <section className="mega-withheld" role="status" aria-label="Firm promotion withheld">
      <div className="mega-withheld-head">
        {reason === 'cooldown' ? <Hourglass aria-hidden="true" /> : <Lock aria-hidden="true" />}
        <div>
          <span>BONUS WITHHELD</span>
          <strong>You cleared the 70% bar, but your firm was not promoted.</strong>
          <p>{headline}</p>
        </div>
      </div>
      <dl className="mega-withheld-terms">
        <div>
          <dt>WHAT YOU DID NOT GET</dt>
          <dd>One free firm tier — its cash price, its reputation floor, and any prerequisite upgrades it needs, all waived.</dd>
        </div>
        <div>
          <dt>WHY</dt>
          <dd>{why}</dd>
        </div>
        <div>
          <dt>BACK ON OFFER</dt>
          <dd>{when}</dd>
        </div>
      </dl>
      <small>
        {reason === 'cooldown' && status.remaining > 0
          ? `${status.remaining} of ${status.limit} free promotions left. `
          : ''}
        Everything else about this sitting counted in full: the score, the projected band it moved, and what your
        practice runs drill next.
      </small>
    </section>
  )
}


/** One finished sitting, rebuilt from its attempts. */
function MegaResult({ session }: { session: HistorySession }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [scopeType, setScopeType] = useState<string | null>(null)
  const attemptsQuery = useQuery({
    queryKey: ['mega-attempts', session.id],
    queryFn: () => api.attemptHistory({ session_id: session.id, limit: 200 }),
    staleTime: 5 * 60_000,
  })
  const attempts: HistoryAttempt[] = useMemo(
    () => [...(attemptsQuery.data?.attempts ?? [])].sort((a, b) => a.position - b.position),
    [attemptsQuery.data],
  )

  const summary = useMemo(() => {
    const bucket = (rows: HistoryAttempt[]) => ({
      attempts: rows.length,
      correct: rows.filter((row) => row.is_correct).length,
      elapsed: rows.reduce((sum, row) => sum + row.elapsed_ms, 0),
    })
    const sections = new Map<string, HistoryAttempt[]>()
    const types = new Map<string, HistoryAttempt[]>()
    for (const attempt of attempts) {
      sections.set(attempt.section, [...(sections.get(attempt.section) ?? []), attempt])
      types.set(attempt.question_type, [...(types.get(attempt.question_type) ?? []), attempt])
    }
    return {
      overall: bucket(attempts),
      overTarget: attempts.filter((attempt) => attempt.over_target).length,
      sections: [...sections.entries()]
        .map(([name, rows]) => ({ name, ...bucket(rows) }))
        .sort((a, b) => b.attempts - a.attempts),
      types: [...types.entries()]
        .map(([name, rows]) => ({ name, ...bucket(rows) }))
        .sort((a, b) => b.attempts - a.attempts),
    }
  }, [attempts])

  // The form total, not the answered total: a sitting that ran out of clock
  // leaves questions blank, and those blanks are part of the score.
  const formTotal = session.total_items || summary.overall.attempts
  const formAccuracy = formTotal ? Math.round((summary.overall.correct / formTotal) * 100) : 0
  const visible = scopeType ? attempts.filter((attempt) => attempt.question_type === scopeType) : attempts
  const openAttempt = visible.some((attempt) => attempt.attempt_id === selected) ? selected : null

  if (attemptsQuery.isLoading) return <div className="mega-result"><p className="mega-result-loading">Rebuilding that sitting…</p></div>
  if (attemptsQuery.error) return <div className="mega-result"><p className="mega-result-error">That sitting could not be loaded.</p></div>

  return (
    <div className="mega-result" role="region" aria-label={`Mega-litigation results from ${formatDate(session.completed_at ?? session.started_at)}`}>
      <div className="mega-result-facts">
        <div>
          <span>SCORE</span>
          <strong>{summary.overall.correct}<small> / {formTotal}</small></strong>
          <small>{formTotal - summary.overall.attempts > 0 ? `${formTotal - summary.overall.attempts} left blank` : 'whole form answered'}</small>
        </div>
        <div>
          <span>ACCURACY</span>
          <strong className={formAccuracy >= 70 ? 'is-teal' : 'is-amber'}>{formAccuracy}%</strong>
          <small>{formAccuracy >= 70 ? 'above the promotion bar' : 'promotion bar is 70%'}</small>
        </div>
        <div>
          <span>TIME</span>
          <strong>{session.elapsed_minutes}<small> min</small></strong>
          <small>{summary.overall.attempts ? `${formatSeconds(summary.overall.elapsed / summary.overall.attempts)} a question` : 'no timing recorded'}</small>
        </div>
        <div>
          <span>OVER TARGET</span>
          <strong className={summary.overTarget > summary.overall.attempts / 2 ? 'is-amber' : ''}>{summary.overTarget}</strong>
          <small>questions past their split</small>
        </div>
      </div>

      <div className="mega-result-split">
        <div>
          <span>BY SECTION</span>
          <div className="metric-breakdown">
            {summary.sections.map((section) => (
              <div className="metric-breakdown-row is-static" key={section.name}>
                <span>{section.name}</span>
                <i style={{ width: `${section.attempts ? Math.round((section.correct / section.attempts) * 100) : 0}%` }} />
                <b>{section.correct}/{section.attempts}</b>
              </div>
            ))}
          </div>
        </div>
        <div>
          <span>WEAKEST QUESTION TYPES</span>
          <div className="metric-breakdown">
            {summary.types
              .slice()
              .sort((a, b) => a.correct / Math.max(1, a.attempts) - b.correct / Math.max(1, b.attempts))
              .slice(0, 5)
              .map((type) => (
                <button
                  type="button"
                  key={type.name}
                  className={`metric-breakdown-row${scopeType === type.name ? ' is-highlighted' : ''}`}
                  onClick={() => setScopeType((previous) => (previous === type.name ? null : type.name))}
                >
                  <span>{type.name}</span>
                  <i style={{ width: `${type.attempts ? Math.round((type.correct / type.attempts) * 100) : 0}%` }} />
                  <b>{type.correct}/{type.attempts}</b>
                </button>
              ))}
          </div>
        </div>
      </div>

      <div className="mega-result-wall">
        <span>EVERY QUESTION ON THIS FORM</span>
        {scopeType && (
          <p className="mega-result-scope">
            <span>Showing {scopeType} only.</span>
            <button type="button" className="mega-history-more" onClick={() => setScopeType(null)}>Clear</button>
          </p>
        )}
        <div className="answer-log-grid" aria-label="Questions on this form, in order">
          {visible.map((attempt) => {
            const label = `Question ${attempt.position + 1} · ${attempt.question_type} · ${attempt.is_correct ? 'correct' : 'missed'} · ${formatSeconds(attempt.elapsed_ms)}`
            return (
              <button
                type="button"
                key={attempt.attempt_id}
                className={[
                  'answer-tile',
                  attempt.is_correct ? 'is-correct' : 'is-wrong',
                  selected === attempt.attempt_id ? 'is-open' : '',
                ].filter(Boolean).join(' ')}
                aria-pressed={selected === attempt.attempt_id}
                aria-label={label}
                title={label}
                onClick={() => setSelected((previous) => (previous === attempt.attempt_id ? null : attempt.attempt_id))}
              >
                {attempt.is_correct ? <Check size={13} /> : <X size={13} />}
                {attempt.over_target && <Clock3 className="answer-tile-slow" size={9} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </div>

      {openAttempt && <AttemptDetail attemptId={openAttempt} onClose={() => setSelected(null)} />}
    </div>
  )
}


function PastMegaLitigations() {
  const [open, setOpen] = useState<string | null>(null)
  const history = useInfiniteQuery({
    queryKey: ['mega-history'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.sessionHistory({ limit: 100, offset: pageParam as number, mode: 'diagnostic' }),
    getNextPageParam: (last) => (last.has_more ? last.offset + last.limit : undefined),
  })
  const sessions = (history.data?.pages.flatMap((page) => page.sessions) ?? [])
    // A form opened and backed out of before a single answer has no result to
    // show; the feed still carries it, so it is dropped here rather than
    // listed as an empty sitting.
    .filter((session) => session.mode === 'diagnostic' && (session.answered > 0 || session.status !== 'abandoned'))
  const loadMore = history.hasNextPage && (
    <button
      type="button"
      className="mega-history-more"
      disabled={history.isFetchingNextPage}
      onClick={() => void history.fetchNextPage()}
    >
      {history.isFetchingNextPage ? 'Loading…' : 'Load older sittings'}
    </button>
  )

  return (
    <div className="mega-history">
      <div className="mega-history-head">
        <span>PAST MEGA-LITIGATIONS</span>
        {sessions.length > 0 && <small>{sessions.length} sat · newest first</small>}
      </div>
      {history.isLoading ? (
        <p className="mega-history-empty">Pulling your past sittings…</p>
      ) : history.error ? (
        <p className="mega-history-empty">Your past sittings could not be loaded.</p>
      ) : sessions.length === 0 ? (
        <>
          <p className="mega-history-empty">
            Nothing sat yet. The first mega-litigation is what turns the projected band on the dashboard from
            a guess into a measurement — and everything you answer on it lands here, question by question.
          </p>
          {/* The feed is mixed, so an account with a long practice history can
              page past 50 rows before the first diagnostic shows up. */}
          {loadMore}
        </>
      ) : (
        <>
          <div className="mega-history-list">
            {sessions.map((session) => {
              const isOpen = open === session.id
              const accuracy = session.total_items ? Math.round((session.correct / session.total_items) * 100) : 0
              return (
                <div key={session.id}>
                  <button
                    type="button"
                    className={`mega-history-row${isOpen ? ' is-open' : ''}${session.status === 'completed' ? ' is-complete' : ''}`}
                    aria-expanded={isOpen}
                    onClick={() => setOpen((previous) => (previous === session.id ? null : session.id))}
                  >
                    <b>
                      {formatDate(session.completed_at ?? session.started_at)}
                      <small>{session.total_items} questions · {session.elapsed_minutes} min</small>
                    </b>
                    <i>{session.correct}/{session.total_items}<small>SCORE</small></i>
                    <span>{accuracy}%</span>
                    <em>{session.status === 'completed' ? 'COMPLETE' : session.status === 'in_progress' ? 'RUNNING' : 'ENDED EARLY'}</em>
                    <ChevronDown size={15} />
                  </button>
                  {isOpen && <MegaResult session={session} />}
                </div>
              )
            })}
          </div>
          {loadMore}
        </>
      )}
    </div>
  )
}


export function MegaLitigationPanel({
  onStart,
  onResume,
  pending = false,
  error = null,
}: {
  onStart: () => void
  onResume: (sessionId: string) => void
  pending?: boolean
  error?: unknown
}) {
  // Same query key the Practice tab already holds, so mounting this costs a
  // cache read rather than a second request.
  const diagnostic = useQuery({ queryKey: ['diagnostic'], queryFn: api.currentDiagnostic })
  const live = diagnostic.data?.session ?? null
  const latest = diagnostic.data?.latest ?? null
  // The slot also carries a sealed form and its untimed retry, neither of
  // which is a form running on the clock, and a retry's size is its miss
  // count rather than the paper's.
  const openForm = live?.mode === 'diagnostic' && live.status !== 'completed' ? live : null
  const sealed = live && !openForm
  const size = openForm?.total_items || latest?.session.total_items || 75
  const minutes = openForm?.target_minutes || latest?.session.target_minutes || 105

  return (
    <section className="mega-panel" aria-labelledby="mega-panel-title">
      <div className="panel-heading">
        <div>
          <span>MEGA-LITIGATION</span>
          <h2 id="mega-panel-title">{openForm ? 'A form is open on the clock.' : sealed ? 'A sat form is waiting on its blind review.' : 'Basically a full practice LSAT.'}</h2>
        </div>
        <Target />
      </div>

      <div className="mega-panel-body">
        <div className="mega-panel-copy">
          <p>
            {size} LR and RC questions administered the way the real test is: three separately timed
            35-minute sections with a 10-minute intermission after the second, results held to the end. It
            is the only measurement here that pays nothing, prompts nothing and coaches nothing — which is
            exactly why it is the one your projected score is anchored on.
          </p>
          <ul className="mega-terms">
            <li><Clock3 /><div><strong>35 minutes a section</strong><small>Move freely inside a section and change answers; the clock is the server's.</small></div></li>
            <li><ShieldAlert /><div><strong>A section ends hard</strong><small>Anything blank at the bell stays blank, and you cannot go back to it.</small></div></li>
            <li><Trophy /><div><strong>Above 70% promotes your firm</strong><small>Prerequisite upgrades for that tier unlock free.</small></div></li>
            <li><Target /><div><strong>It sets what you practise</strong><small>What it finds is what your case runs drill next.</small></div></li>
          </ul>
          <div className="mega-panel-actions">
            {live ? (
              <button type="button" className="mega-resume-button" onClick={() => onResume(live.id)}>
                {openForm ? 'Return to the open form' : live.mode === 'blind_review' ? 'Return to the blind review' : 'Start the blind review'} <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" className="mega-start-button" disabled={pending} onClick={onStart}>
                {pending ? 'Filing…' : latest ? 'Sit a new mega-litigation' : 'Sit your first mega-litigation'} <ArrowRight size={15} />
              </button>
            )}
          </div>
          {Boolean(error) && <p className="mega-panel-error" role="alert">That form could not be filed. Try again in a moment.</p>}
        </div>

        <div className={`mega-score${latest ? '' : ' is-empty'}`}>
          {latest ? (
            <>
              <small>LAST FORM SCORE</small>
              <strong>{latest.summary.correct}/{latest.session.total_items}</strong>
              <span>{latest.summary.form_accuracy ?? latest.summary.accuracy}% of the whole form</span>
              <p>
                {latest.summary.promotion
                  ? `Cleared: your firm was promoted to ${latest.summary.promotion.name}.`
                  : latest.summary.promotion_status && !latest.summary.promotion_status.available
                    ? 'Cleared the bar — the free tier was withheld. See below.'
                    : `Sat ${formatDate(latest.session.completed_at ?? latest.session.started_at)} in ${latest.summary.elapsed_minutes} minutes.`}
              </p>
            </>
          ) : (
            <>
              <small>{live ? 'FORM IN PROGRESS' : 'NO FORM SAT YET'}</small>
              <Gauge className="mega-score-glyph" />
              <span>{size} questions · 3 × 35 min · {minutes} min of testing</span>
              <p>Scaled-score projections stay withheld until a form has a validated conversion.</p>
            </>
          )}
        </div>
      </div>

      {/* Sits between the last score and the list of past sittings, so a student
          who clears the bar and finds their firm unchanged is told why on the
          one screen that mega-litigations belong to. */}
      <WithheldPromotionNotice status={latest?.summary.promotion_status} />

      <PastMegaLitigations />
    </section>
  )
}

export default MegaLitigationPanel
