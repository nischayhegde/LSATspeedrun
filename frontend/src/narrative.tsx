import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Check, ScrollText, Sparkles, Star, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { api } from './api'
import { ErrorNotice, formatMoney } from './components'
import { CutsceneArtwork } from './game-art'
import {
  clearOverlayNote,
  readOverlayNote,
  useBlockingOverlay,
  useTopOverlay,
  writeOverlayNote,
} from './overlays'
import { useSound } from './sound'
import type { GameResponse, GameState, StoryChapter } from './types'
import './narrative.css'


const OPEN_CHAPTER_EVENT = 'lsat-tycoon:open-chapter'
const OPEN_EPILOGUE_EVENT = 'lsat-tycoon:open-epilogue'

/** Lets a page hand a reader to the one narrative layer instead of mounting its own. */
export function openPendingChapter() {
  window.dispatchEvent(new Event(OPEN_CHAPTER_EVENT))
}

export function openEpilogue() {
  window.dispatchEvent(new Event(OPEN_EPILOGUE_EVENT))
}

function epilogueStorageKey(gameId: string) {
  return `lsat-tycoon:epilogue-read:${gameId}`
}

type ChapterView = 'cutscene' | 'prompt' | 'dismissed'
/** The two states a chapter can be put off *to*; `cutscene` is never a deferral. */
type ChapterDeferral = Exclude<ChapterView, 'cutscene'>

/**
 * Publishes the corner card's real height as `--chapter-prompt-height`.
 *
 * Every previous attempt to keep this card off the page's own controls picked a
 * constant — 210px — and reserved that much at the foot of the document. The
 * card is not that tall. It is whatever its title wraps to, which is two lines
 * for "The Sterling Invitation" and one for "The Harrow File", and the reserve
 * was 11px short of the card's own occupied band even in the shorter case. That
 * is exactly the overlap that was being reported on the caseboard and the Firm
 * catalog: the last row of the document could be scrolled to the top of the
 * card and no further.
 *
 * So the figure is measured instead of assumed, and everything that needs to
 * clear the card reads it. A ResizeObserver rather than a one-shot measurement
 * because the card's height changes with the viewport: it is capped and
 * scrollable on a short screen, and rotating a phone changes which case applies.
 */
function usePublishedPromptHeight(open: boolean) {
  const card = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const node = card.current
    const root = document.documentElement
    if (!open || !node) {
      root.style.removeProperty('--chapter-prompt-height')
      return
    }
    // `offsetHeight`, not the bounding rect: the card animates in from
    // `scale(.97)`, and a rect measured mid-animation is 3% short — which is
    // the whole point of measuring, so a reserve 6px under the truth would put
    // the bug straight back.
    const publish = () => root.style.setProperty('--chapter-prompt-height', `${node.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--chapter-prompt-height')
    }
  }, [open])
  return card
}

function chapterDeferralKey(gameId: string, chapterKey: string) {
  return `lsat-tycoon:chapter-deferred:${gameId}:${chapterKey}`
}

/**
 * "This player has already put this exact chapter off."
 *
 * Browser-local on purpose (see the persistence policy in overlays.tsx): the
 * chapter itself is server state and stays pending until a choice is made, so
 * the only thing worth remembering here is that this player has declined to be
 * interrupted by it — which is a per-browser courtesy, not an account fact.
 * It has to be remembered *somewhere* durable, though: every layer in this file
 * is mounted under a route element and so remounts on each navigation, and a
 * deferral held in React state lasts exactly until the next nav click.
 */
function readChapterDeferral(gameId: string, chapterKey: string | null): ChapterDeferral | null {
  if (!chapterKey) return null
  const stored = readOverlayNote(chapterDeferralKey(gameId, chapterKey))
  if (stored === 'prompt') return 'prompt'
  // `marker` is what a dismissal used to be written as, back when it collapsed
  // to a standing chip instead of leaving the screen. Same intent, so a note
  // carried over from that build is honoured rather than re-prompting.
  return stored === 'dismissed' || stored === 'marker' ? 'dismissed' : null
}

function useAppEvent(name: string, handler: () => void) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const listener = () => latest.current()
    window.addEventListener(name, listener)
    return () => window.removeEventListener(name, listener)
  }, [name])
}

/**
 * A case run owns the viewport while it is open, so narrative surfaces stand
 * down there.
 *
 * Standing down for the guided tour is not handled here: the full-screen layers
 * below register with the blocking-overlay owner in overlays.tsx, which grants
 * the screen to exactly one of them. The non-blocking chapter prompt still checks
 * `useTopOverlay()` so it does not chatter underneath whichever modal is up.
 */
function useNarrativeSuppressed() {
  const location = useLocation()
  return /^\/cases\/[^/]+/.test(location.pathname)
}


function storeGame(queryClient: ReturnType<typeof useQueryClient>, game: GameState) {
  queryClient.setQueryData<GameResponse>(['game'], (current) => ({ game, pending_reviews: current?.pending_reviews ?? [] }))
}


function StoryCutscene({ game, chapter, onDefer }: { game: GameState; chapter: StoryChapter; onDefer: () => void }) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const [resolution, setResolution] = useState<Awaited<ReturnType<typeof api.chooseStory>> | null>(null)
  useEffect(() => setResolution(null), [chapter.key])
  const choose = useMutation({
    mutationFn: (choiceKey: string) => api.chooseStory(chapter.key, choiceKey),
    onSuccess: (nextResolution, choiceKey) => {
      void play('story', {
        id: `story-choice:${chapter.key}:${choiceKey}`,
        seed: choiceKey,
        intensity: .8,
        profile: {
          officeTier: nextResolution.game.office_tier,
          alignment: nextResolution.game.story.alignment,
        },
      })
      setResolution(nextResolution)
    },
  })
  const continueStory = () => {
    if (!resolution) return
    const nextGame = resolution.game
    void play('paper', { seed: chapter.key, intensity: .45 })
    setResolution(null)
    storeGame(queryClient, nextGame)
  }
  return (
    <div className="cutscene-overlay" role="dialog" aria-modal="true" aria-labelledby="cutscene-title">
      <div className="cutscene-letterbox top" />
      <div className="cutscene-frame">
        <CutsceneArtwork scene={chapter.scene} game={game} />
        <div className="cutscene-act"><span>{chapter.act}</span><small>{chapter.location}</small></div>
        <section className="cutscene-dialogue">
          <span>{chapter.speaker}</span>
          <h2 id="cutscene-title">{chapter.title}</h2>
          {resolution ? (
            <div className="cutscene-resolution">
              <p>{resolution.result.result}</p>
              <button className="cutscene-continue" onClick={continueStory}>Continue <ArrowRight /></button>
            </div>
          ) : (
            <>
              <div className="dialogue-beats">{chapter.dialogue.map((line) => <p key={line}>{line}</p>)}</div>
              <div className="cutscene-choices">
                {chapter.choices.map((choice) => (
                  <button key={choice.key} disabled={choose.isPending} onClick={() => choose.mutate(choice.key)}>
                    <strong>{choice.label}</strong><span>{choice.stakes}</span>
                  </button>
                ))}
              </div>
              {choose.error && <ErrorNotice error={choose.error} />}
              <button type="button" className="cutscene-defer" onClick={onDefer}>Decide later</button>
            </>
          )}
        </section>
      </div>
      <div className="cutscene-letterbox bottom"><span>YOUR DECISION BECOMES PART OF THE FIRM</span></div>
    </div>
  )
}


/**
 * A chapter is earned by reaching a headquarters tier, so it is played at the
 * moment it is earned rather than banked until someone opens the caseboard.
 * A chapter that unlocks while the app is open runs straight away, since the
 * player just finished the upgrade that bought it. A chapter carried in from an
 * earlier session opens a corner prompt instead, which leaves the screen for
 * good if the answer is "not now" — the caseboard's own "Play this chapter"
 * button is the way back in, so nothing is stranded behind the dismissal.
 *
 * Which of the three views is showing is derived from storage on mount rather
 * than reset to a default, because this component remounts on every navigation
 * (`AppShell` and everything beside it live inside the route element). Holding
 * "the player said later" in component state meant the full-screen cutscene
 * came straight back on the next nav click and on reload, with nine header
 * controls behind its click-catcher — an unusable app for anyone who did not
 * want to make the decision yet.
 */
function PendingChapterLayer({ game, muted }: { game: GameState; muted: boolean }) {
  const { play } = useSound()
  const chapter = game.story.pending_chapter ?? null
  const chapterKey = chapter?.key ?? null
  const openingBeat = game.story.chapters.every((entry) => !entry.seen)
  const [view, setView] = useState<ChapterView>(() => (
    readChapterDeferral(game.id, chapterKey) ?? (chapterKey && openingBeat ? 'cutscene' : 'prompt')
  ))
  const lastKey = useRef<string | null>(chapterKey)

  const defer = useCallback((next: ChapterDeferral) => {
    if (chapterKey) writeOverlayNote(chapterDeferralKey(game.id, chapterKey), next)
    setView(next)
  }, [chapterKey, game.id])

  // "Not now" means gone, not shrunk: the note is what keeps it gone across the
  // remount every navigation causes, so it is written before the view changes.
  const dismiss = useCallback(() => {
    void play('paper', { seed: `chapter-defer:${chapterKey}`, intensity: .3 })
    defer('dismissed')
  }, [chapterKey, defer, play])

  const openChapter = useCallback(() => {
    // Asking for the chapter withdraws the deferral, so a later remount opens
    // where the player left off rather than re-collapsing it.
    if (chapterKey) clearOverlayNote(chapterDeferralKey(game.id, chapterKey))
    setView('cutscene')
  }, [chapterKey, game.id])

  // The cutscene is full-screen and blocking, so it asks the overlay owner for
  // the screen rather than assuming it has it (see overlays.tsx). Losing to the
  // guided tour only defers it: `view` is untouched, so it opens the moment the
  // tour closes. Escape does exactly what "Decide later" does, deferral and all.
  const cutsceneAllowed = useBlockingOverlay(
    'story-cutscene',
    Boolean(chapter) && !muted && view === 'cutscene',
    () => defer('prompt'),
  )
  // The prompt does not block anything, but it should not sit chirping in the
  // corner underneath a modal either.
  const blockedByModal = useTopOverlay() !== null

  useEffect(() => {
    const previousKey = lastKey.current
    if (previousKey === chapterKey) return
    lastKey.current = chapterKey
    // Whatever was pending has been resolved or replaced, so its note is spent.
    if (previousKey) clearOverlayNote(chapterDeferralKey(game.id, previousKey))
    if (!chapterKey) return
    // Unlocked while the player was watching — they just bought the upgrade that
    // earned it, so it plays rather than waits.
    setView(readChapterDeferral(game.id, chapterKey) ?? 'cutscene')
  }, [chapterKey, game.id])

  useAppEvent(OPEN_CHAPTER_EVENT, openChapter)

  const openNow = useCallback(() => {
    void play('story', { seed: `chapter-open:${chapterKey}`, intensity: .55 })
    openChapter()
  }, [chapterKey, openChapter, play])

  const promptOpen = Boolean(chapter) && !muted && view === 'prompt' && !blockedByModal
  const promptCard = usePublishedPromptHeight(promptOpen)

  if (!chapter || muted) return null

  if (view === 'cutscene') {
    return cutsceneAllowed ? <StoryCutscene game={game} chapter={chapter} onDefer={() => defer('prompt')} /> : null
  }

  if (blockedByModal || view === 'dismissed') return null

  return (
    <aside className="chapter-prompt" role="dialog" aria-labelledby="chapter-prompt-title" ref={promptCard}>
      <div className="chapter-prompt-seal" aria-hidden="true"><ScrollText size={17} /></div>
      <button
        type="button"
        className="chapter-prompt-close"
        aria-label="Dismiss until you open the caseboard"
        onClick={dismiss}
      >
        <X size={15} />
      </button>
      <span className="chapter-prompt-eyebrow">{chapter.act} · HEADQUARTERS {chapter.tier} REACHED</span>
      <h2 id="chapter-prompt-title">{chapter.title}</h2>
      <p>{chapter.speaker.split(' · ')[0]} is waiting on a decision the firm cannot delegate.</p>
      <div className="chapter-prompt-actions">
        <button type="button" className="chapter-prompt-open" onClick={openNow}>Take the meeting <ArrowRight size={15} /></button>
        <button type="button" className="chapter-prompt-later" onClick={dismiss}>Not now</button>
      </div>
    </aside>
  )
}


/**
 * The closing record, shown once. "Once" means once per account rather than
 * once per browser: it is the end of the campaign, and a player who has read it
 * should not be handed the full-screen final record again because they opened
 * the app on a second device or cleared site data. So the acknowledgement lives
 * on the campaign (`player_story_states.epilogue_read_at`), exactly as the
 * guided tour's lives on the account — see the persistence policy in
 * overlays.tsx. The localStorage marker stays as the instant local answer and
 * as the fallback for a player whose network is down when they close it.
 */
function EpilogueLayer({ game }: { game: GameState; }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const epilogue = game.story.epilogue ?? null
  const [open, setOpen] = useState(false)
  const announced = useRef(false)
  const acknowledgement = useQuery({
    queryKey: ['epilogue-acknowledgement'],
    queryFn: api.epilogueAcknowledgement,
    enabled: Boolean(epilogue),
    staleTime: Infinity,
  })
  const acknowledge = useMutation({
    mutationFn: api.acknowledgeEpilogue,
    onSuccess: (data) => queryClient.setQueryData(['epilogue-acknowledgement'], data),
  })
  const acknowledged = acknowledgement.data?.read ?? false

  // Marks the record read as well as closing it, on the account and locally.
  // Escape goes through here too (see overlays.tsx): dismissing without
  // recording it re-opens the ending on the next load.
  const close = useCallback(() => {
    writeOverlayNote(epilogueStorageKey(game.id), 'read')
    if (!acknowledged) acknowledge.mutate()
    void play('paper', { seed: `epilogue-close:${game.id}`, intensity: .4 })
    setOpen(false)
  }, [acknowledge, acknowledged, game.id, play])

  // Also a full-screen layer, so it claims the screen the same way (overlays.tsx).
  const visible = useBlockingOverlay('epilogue', open && Boolean(epilogue), close)

  useEffect(() => {
    if (!epilogue || announced.current) return
    if (readOverlayNote(epilogueStorageKey(game.id))) {
      announced.current = true
      return
    }
    // The account is the authority, so wait for its answer rather than flashing
    // the final record at someone who already closed it elsewhere. A failed
    // request settles too, and falls through to showing it.
    if (acknowledgement.isPending) return
    announced.current = true
    if (acknowledgement.data?.read) return
    setOpen(true)
  }, [acknowledgement.data, acknowledgement.isPending, epilogue, game.id])

  useAppEvent(OPEN_EPILOGUE_EVENT, () => setOpen(true))

  useEffect(() => {
    if (!visible) return
    void play('event', { id: `epilogue:${game.id}`, seed: game.id, intensity: .9 })
  }, [visible, game.id, play])

  if (!epilogue || !visible) return null
  const accuracy = game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0
  const achievements = game.achievements.filter((entry) => entry.unlocked).length
  const ledger = [
    { group: 'THE PRACTICE', rows: [
      { label: 'Cases closed', value: String(game.total_cases) },
      { label: 'Accuracy', value: `${accuracy}%` },
      { label: 'Verified reasoning', value: String(game.total_validated_correct) },
      { label: 'Best streak', value: String(game.best_streak) },
    ] },
    { group: 'THE FIRM', rows: [
      { label: 'Headquarters', value: `${game.office.name} · tier ${game.office_tier}` },
      { label: 'Reputation', value: `${game.reputation.toFixed(1)} · ${game.reputation_band.name}` },
      { label: 'Firm value', value: formatMoney(game.firm_valuation, true) },
      { label: 'Lifetime fees', value: formatMoney(game.lifetime_earnings, true) },
    ] },
    { group: 'THE CAMPAIGN', rows: [
      { label: 'Chapters resolved', value: `${epilogue.chapters_resolved} / ${epilogue.chapters_total}` },
      { label: 'Files closed', value: `${epilogue.quests_closed} / ${epilogue.quests_total}` },
      { label: 'Shadow files', value: String(epilogue.shadow_files_closed) },
      { label: 'Commendations', value: `${achievements} / ${game.achievements.length}` },
    ] },
  ]

  return (
    <div className="epilogue-overlay" role="dialog" aria-modal="true" aria-labelledby="epilogue-title">
      <div className="epilogue-letterbox top"><span>FINAL RECORD · THE MERCER FILES</span></div>
      <div className="epilogue-scroll">
        <article className="epilogue-sheet">
          <header className="epilogue-head">
            <div className="epilogue-stamp"><Star size={14} /><span>{epilogue.verdict}</span></div>
            <span className="epilogue-eyebrow">{game.firm_name} · {game.lawyer_name}</span>
            <h1 id="epilogue-title">{epilogue.title}</h1>
          </header>

          <section className="epilogue-beats">
            {epilogue.beats.map((beat) => <p key={beat}>{beat}</p>)}
          </section>

          {epilogue.promise && (
            <blockquote className="epilogue-promise"><BookOpen size={16} /><p>{epilogue.promise}</p></blockquote>
          )}

          <section className="epilogue-ledger" aria-label="Final record of the firm">
            {ledger.map((block) => (
              <div key={block.group}>
                <h2>{block.group}</h2>
                <dl>
                  {block.rows.map((row) => (
                    <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                  ))}
                </dl>
              </div>
            ))}
          </section>

          <section className="epilogue-standing">
            <div><span>PATH</span><strong>{epilogue.alignment}</strong><small>{epilogue.alignment_note}</small></div>
            <div><span>ETHICS</span><strong>{game.story.ethics.toFixed(1)}</strong><small>Heat {game.story.heat.toFixed(1)} · Influence {game.story.influence} · Intel {game.story.intel}</small></div>
            {epilogue.days_elapsed !== null && epilogue.days_elapsed !== undefined && (
              <div><span>TIME ON THE DOCKET</span><strong>{epilogue.days_elapsed} {epilogue.days_elapsed === 1 ? 'day' : 'days'}</strong><small>From the first light in the Old Quarter</small></div>
            )}
          </section>

          <p className="epilogue-closing">{epilogue.closing}</p>
          <p className="epilogue-signature"><Sparkles size={13} />{epilogue.signature}</p>

          <div className="epilogue-actions">
            <button type="button" className="epilogue-primary" onClick={close}><Check size={16} /> Close the record</button>
            <button type="button" className="epilogue-secondary" onClick={() => { close(); navigate('/story') }}>Open the caseboard</button>
          </div>
        </article>
      </div>
      <div className="epilogue-letterbox bottom"><span>THE FIRM KEEPS A LIGHT ON</span></div>
    </div>
  )
}


/**
 * One narrative layer for the whole app. Chapters used to appear only on the
 * two screens that happened to render a cutscene, which let a whole campaign
 * sit unseen behind a player who lived on the Dashboard and the case runner.
 */
export function StoryOverlays({ game }: { game: GameState }) {
  const suppressed = useNarrativeSuppressed()
  const finished = Boolean(game.story.epilogue)
  return (
    <>
      <PendingChapterLayer game={game} muted={suppressed || finished} />
      {!suppressed && <EpilogueLayer game={game} />}
    </>
  )
}
