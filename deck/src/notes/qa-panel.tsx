import { useEffect, useMemo, useRef, useState } from 'react'

import { CUT_ORDER, DO_NOT_CUT, DO_NOT_TRIM, FULL_CUT_SECONDS } from './cuts'
import { QA, QA_TOPICS, type QaTopic } from './qa'
import { OPEN_ACTIONS, WARNINGS } from './warnings'

/**
 * The presenter's back pocket, on `Q`.
 *
 * ## Why it is one panel and not three
 *
 * The three things in here — the Q&A answers, evidence guardrails and the
 * cut list — are needed at three different moments, but they are needed under the
 * same conditions: on stage, in front of a room, with one hand on a clicker. A
 * presenter in that state will not navigate a tab bar to find out whether the
 * 1989 survey objection has an answer. So there is one search field over all
 * three bodies of text, every result is expanded, and the panel is scrolled
 * rather than paged.
 *
 * ## What is shown before anything is typed
 *
 * The open action, always, at the top, in its own region. It is the one item in
 * the warning block that is not closed, and the morning of the pitch is the only
 * time it can be closed. A panel that hid it behind a search would be worse than
 * no panel.
 *
 * ## Styling
 *
 * Nothing here carries a visual decision. Every element emits a semantic class
 * name under the `deck-qa-` prefix and the deck's stylesheet owns what they look
 * like. The one inline style is the search field's autofocus behaviour, which is
 * not a style at all.
 */

type Props = {
  /** Bound to `Q` and to Escape by the caller; also called by the close button. */
  onClose?: () => void
}

function normalise(value: string) {
  return value.toLowerCase()
}

/** Everything about an entry that a presenter might type a word from. */
function haystacks(parts: ReadonlyArray<string | readonly string[] | undefined>) {
  const collected: string[] = []
  for (const part of parts) {
    if (!part) continue
    if (typeof part === 'string') collected.push(part)
    else collected.push(...part)
  }
  return normalise(collected.join(' · '))
}

export function QaPanel({ onClose }: Props) {
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<QaTopic | null>(null)
  const search = useRef<HTMLInputElement | null>(null)

  // Opened with a keystroke, so the next keystroke should be the search. The deck
  // runtime ignores keys aimed at an input, so typing here cannot advance a slide.
  useEffect(() => {
    search.current?.focus()
  }, [])

  const needle = normalise(query.trim())

  const questions = useMemo(() => {
    return QA.filter((entry) => {
      if (topic && !entry.topics.includes(topic)) return false
      if (!needle) return true
      return haystacks([entry.question, entry.answer, entry.caveat, entry.topics, entry.sources]).includes(needle)
    })
  }, [needle, topic])

  const warnings = useMemo(() => {
    if (topic) return []
    if (!needle) return WARNINGS
    return WARNINGS.filter((item) => haystacks([item.title, item.body, item.slides, item.sources, item.openAction?.what]).includes(needle))
  }, [needle, topic])

  const cuts = useMemo(() => {
    if (topic) return []
    if (!needle) return CUT_ORDER
    return CUT_ORDER.filter((cut) => haystacks([cut.slideId, cut.how, cut.action]).includes(needle))
  }, [needle, topic])

  const found = questions.length + warnings.length + cuts.length

  return (
    <aside
      className="deck-qa"
      role="dialog"
      aria-label="Q and A, evidence warnings and cut list"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose?.()
        }
      }}
    >
      <header className="deck-qa-head">
        <h2 className="deck-qa-title">Q&amp;A · guardrails · cuts</h2>
        <input
          className="deck-qa-search"
          ref={search}
          type="search"
          value={query}
          placeholder="Search — practice, feedback, game, timing…"
          aria-label="Search the Q and A"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="deck-qa-count">{found} {found === 1 ? 'match' : 'matches'}</span>
        <button type="button" className="deck-qa-close" onClick={() => onClose?.()}>
          close <kbd>Q</kbd>
        </button>
      </header>

      {OPEN_ACTIONS.length ? (
        <section className="deck-qa-open" aria-label="Open action items">
          {OPEN_ACTIONS.map((item) => (
            <div key={item.number} className="deck-qa-open-item">
              <b className="deck-qa-open-when">{item.openAction?.when}</b>
              <p className="deck-qa-open-what">{item.openAction?.what}</p>
            </div>
          ))}
        </section>
      ) : null}

      <div className="deck-qa-topics" role="group" aria-label="Filter by topic">
        <button
          type="button"
          className={`deck-qa-topic${topic === null ? ' is-active' : ''}`}
          onClick={() => setTopic(null)}
        >
          all
        </button>
        {QA_TOPICS.map((name) => (
          <button
            key={name}
            type="button"
            className={`deck-qa-topic${topic === name ? ' is-active' : ''}`}
            onClick={() => setTopic(topic === name ? null : name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="deck-qa-scroll">
        {questions.length ? (
          <section className="deck-qa-section" data-kind="questions">
            <h3 className="deck-qa-section-title">Ammunition</h3>
            <ol className="deck-qa-list">
              {questions.map((entry) => (
                <li key={entry.id} className="deck-qa-entry" id={`deck-qa-${entry.id}`}>
                  <h4 className="deck-qa-question">{entry.question}</h4>
                  <p className="deck-qa-answer">{entry.answer}</p>
                  {entry.caveat ? <p className="deck-qa-caveat">{entry.caveat}</p> : null}
                  <ul className="deck-qa-tags">
                    {entry.topics.map((name) => (
                      <li key={name} className="deck-qa-tag">{name}</li>
                    ))}
                  </ul>
                  {entry.sources?.length ? (
                    <ul className="deck-qa-sources">
                      {entry.sources.map((source) => (
                        <li key={source} className="deck-qa-source">{source}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {warnings.length ? (
          <section className="deck-qa-section" data-kind="warnings">
            <h3 className="deck-qa-section-title">Evidence integrity — read before rehearsing</h3>
            <ol className="deck-qa-list">
              {warnings.map((item) => (
                <li key={item.number} className="deck-qa-warning" data-status={item.status}>
                  <h4 className="deck-qa-warning-title">
                    <i className="deck-qa-warning-number">{item.number}</i>
                    {item.title}
                    <em className="deck-qa-warning-status">{item.status}</em>
                  </h4>
                  <p className="deck-qa-warning-body">{item.body}</p>
                  {item.openAction ? (
                    <p className="deck-qa-warning-action">
                      <b>{item.openAction.when}</b> {item.openAction.what}
                    </p>
                  ) : null}
                  {item.slides?.length ? (
                    <ul className="deck-qa-slides">
                      {item.slides.map((slide) => (
                        <li key={slide} className="deck-qa-slide">
                          <a href={`#/${slide}`}>#/{slide}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {cuts.length ? (
          <section className="deck-qa-section" data-kind="cuts">
            <h3 className="deck-qa-section-title">
              Cut order if running long — all six lands at 8:32 (−{FULL_CUT_SECONDS}s)
            </h3>
            <ol className="deck-qa-list">
              {cuts.map((cut) => (
                <li key={cut.slideId} className="deck-qa-cut" data-action={cut.action}>
                  <h4 className="deck-qa-cut-title">
                    <i className="deck-qa-cut-order">{cut.order}</i>
                    <a href={`#/${cut.slideId}`}>{cut.slideId}</a>
                    <b className="deck-qa-cut-saving">−{cut.secondsSaved}s</b>
                    {cut.trimToSeconds ? <em className="deck-qa-cut-trim">trim to {cut.trimToSeconds}s</em> : null}
                  </h4>
                  <p className="deck-qa-cut-how">{cut.how}</p>
                </li>
              ))}
            </ol>

            <div className="deck-qa-nocut">
              <h4 className="deck-qa-nocut-title">Never cut</h4>
              <ul className="deck-qa-nocut-list">
                {DO_NOT_CUT.map((slide) => (
                  <li key={slide} className="deck-qa-nocut-item">
                    <a href={`#/${slide}`}>{slide}</a>
                  </li>
                ))}
              </ul>
              <p className="deck-qa-nocut-note">
                <a href={`#/${DO_NOT_TRIM.slideId}`}>{DO_NOT_TRIM.slideId}</a> — {DO_NOT_TRIM.why}
              </p>
            </div>
          </section>
        ) : null}

        {found === 0 ? <p className="deck-qa-empty">Nothing matches “{query}”.</p> : null}
      </div>
    </aside>
  )
}
