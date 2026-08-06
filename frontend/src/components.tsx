import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  Flame,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Map,
  Menu,
  Pause,
  Scale,
  ShieldAlert,
  Sparkles,
  Star,
  Target,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { api } from './api'
import { AlertSealMark, FocusMark, ScalesMark } from './art-2d/marks'
import { ClientPortrait, CounselPortrait3D, EventVisitor3D, JudgePortrait } from './game-art'
import { counselFor, eventArt, keyHash } from './art/assets'
import { SoundControls, useSound, useSoundProfile } from './sound'
import { replayGuidedTour } from './guided-tour-replay'
import { CHAPTER_DOCK_ID, clearOverlayNote, readOverlayNote, useBlockingOverlay, writeOverlayNote } from './overlays'
import { preloadArtForIntent } from './art/scene-loaders'
import { MOTION_TIMING } from './motion'
import { LockedChoicesNotice, useStrategyGate } from './strategy-enforcement'
import type { AttemptReward, CoachingFeedback, GameResponse, GameState, StoryQuest, StudySession, User } from './types'

// The in-run progress rail reads one page of attempt history and is pure
// supporting detail, so it is split out of the main chunk the same way the
// dashboard's heavy panels are. Its styling ships with the case view itself
// (see `case-instrument.css`, loaded from `main.tsx`) so nothing reflows when
// the chunk lands.
const CaseRunRail = lazy(() => import('./case-instrument').then((module) => ({ default: module.CaseRunRail })))

// The guided tour renders on every screen but is in front of the reader on
// almost none of them, and it carries a 3D guide of its own. Kept in the entry
// bundle it was parsed before any screen could draw; deferred to the first idle
// moment it costs a first paint nothing, and a tour that opens a beat after the
// page has settled is the same tour.
const GuidedTour = lazy(() => import('./guided-tour').then((module) => ({ default: module.GuidedTour })))

function useIdleMount() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const idle = window.requestIdleCallback
    if (typeof idle !== 'function') {
      const timer = window.setTimeout(() => setReady(true), 1200)
      return () => window.clearTimeout(timer)
    }
    const handle = idle(() => setReady(true), { timeout: 2500 })
    return () => window.cancelIdleCallback?.(handle)
  }, [])
  return ready
}


function useCountUp(target: number, duration = MOTION_TIMING.countUpMs) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}


// Flags a single brief window right after `value` ticks up, so a badge can
// play a quick on-brand flourish without any state beyond "did this just
// happen". `prefers-reduced-motion` is handled globally in styles.css.
//
// `persistKey`, when given, remembers the last-seen value in localStorage
// instead of only a React ref. That matters here because `AppShell` remounts
// on every route change (each route wraps its own `<Protected>`), and the
// daily streak is bumped server-side on the very first `GET /game` of a new
// day, before this component ever mounts with the old value in hand. Without
// a durable "last seen" baseline, the very moment this hook exists to catch
// would always be missed. Two calls with the same `persistKey` (the header
// badge and the welcome modal, see `StreakBadge`/`StreakWelcomeModal`) always
// agree, since they read and advance the same stored baseline.
export function useJustIncreased(value: number, holdMs = 850, persistKey?: string) {
  const previous = useRef<number | undefined>(undefined)
  if (previous.current === undefined) {
    const stored = persistKey ? window.localStorage.getItem(persistKey) : null
    previous.current = stored !== null && Number.isFinite(Number(stored)) ? Number(stored) : value
  }
  const [justIncreased, setJustIncreased] = useState(false)
  useEffect(() => {
    if (value <= previous.current!) {
      previous.current = value
      if (persistKey) window.localStorage.setItem(persistKey, String(value))
      return
    }
    previous.current = value
    if (persistKey) window.localStorage.setItem(persistKey, String(value))
    setJustIncreased(true)
    const timeout = window.setTimeout(() => setJustIncreased(false), holdMs)
    return () => window.clearTimeout(timeout)
  }, [value, holdMs, persistKey])
  return justIncreased
}


// A single, tasteful indicator for the one calendar-day activity streak
// (see `daily_streak` on `GameState`) — not the validated-win streak used for
// the payout bonus elsewhere. Deliberately as quiet as the "922 Q" standing
// badge beside it: a flame, a number, done.
//
// `justAdvanced` is lifted to the caller (see `AppShell`) rather than computed
// here, so the header glow and the streak welcome modal read the exact same
// "did this just tick up" signal instead of two independent hooks that could
// disagree about the moment.
function StreakBadge({ streak, justAdvanced }: { streak: number; justAdvanced: boolean }) {
  return (
    <span className={`streak${justAdvanced ? ' is-lit' : ''}`} title={`${streak}-day streak: consecutive days you've practiced`}>
      <Flame size={16} /><span className="streak-count">{streak}</span> d
    </span>
  )
}


// Two markers, not one, and this is the whole fix for a greeting that used to
// go missing. "Owed" is written the moment the streak ticks up, so the intent
// survives the remount that every navigation causes. "Shown" is written only
// once the modal has actually been on screen. Collapsing them into a single
// marker meant an instance that was suppressed mid-case consumed the day's
// marker while rendering nothing, and the next instance — by then `justAdvanced`
// had already been latched false against the persisted baseline — had no reason
// left to open. Both are date-stamped, so yesterday's pair never speaks for today.
function streakWelcomeShownKey(gameId: string) {
  return `lsat-tycoon:streak-welcome:${gameId}`
}

function streakWelcomeOwedKey(gameId: string) {
  return `lsat-tycoon:streak-welcome-owed:${gameId}`
}


/** The local calendar day, matching `daily_streak` itself being a calendar-day concept. */
function todayStamp() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}


/**
 * Greets the student the moment `daily_streak` ticks up for today — the exact
 * signal `StreakBadge` already glows for, passed down from `AppShell` so the
 * two can never disagree about when that moment happened. Registered with the
 * blocking-overlay owner (see `overlays.tsx`) so it cannot stack with the
 * guided tour, an earned chapter, or the epilogue, and gated on a per-day
 * localStorage marker so a reload or a second case that same day never shows
 * it twice.
 *
 * Mounted unconditionally alongside the always-live standing badge, not just
 * when the header chrome is showing, so the moment `daily_streak` ticks up
 * mid-case is never missed. `suppressed` only withholds the popup while a case
 * is actually open; the intent to show it is persisted, so it genuinely does
 * survive and fire the moment the student returns to the rest of the app —
 * which is the common path, since practising inside a case is the normal way a
 * streak advances in the first place.
 */
function StreakWelcomeModal({ game, justAdvanced, suppressed }: { game: GameState; justAdvanced: boolean; suppressed: boolean }) {
  const { play } = useSound()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const visible = useBlockingOverlay('streak-welcome', open && !suppressed, close)

  useEffect(() => {
    const today = todayStamp()
    if (readOverlayNote(streakWelcomeShownKey(game.id)) === today) return
    // Record the debt before trying to pay it. `justAdvanced` is a brief pulse
    // on one mount; the note is what carries it across the remount that leaving
    // a case causes.
    if (justAdvanced) writeOverlayNote(streakWelcomeOwedKey(game.id), today)
    if (readOverlayNote(streakWelcomeOwedKey(game.id)) === today) setOpen(true)
  }, [justAdvanced, game.id])

  // Settled only against a modal that was really on screen, so a suppressed
  // instance cannot spend the day's greeting on nobody.
  useEffect(() => {
    if (!visible) return
    const today = todayStamp()
    writeOverlayNote(streakWelcomeShownKey(game.id), today)
    clearOverlayNote(streakWelcomeOwedKey(game.id))
  }, [visible, game.id])

  useEffect(() => {
    if (!visible) return
    void play('bonus', { id: `streak-welcome:${game.id}:${game.daily_streak}`, seed: game.id, intensity: .5 })
  }, [visible, game.id, game.daily_streak, play])

  if (!visible) return null

  const isPersonalBest = game.daily_streak > 1 && game.daily_streak >= game.daily_streak_best
  return (
    <div className="streak-welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="streak-welcome-title">
      <button type="button" className="streak-welcome-scrim" aria-label="Close" onClick={close} />
      <div className="streak-welcome-card">
        <button type="button" className="streak-welcome-close icon-button" aria-label="Close" onClick={close}>
          <X size={16} />
        </button>
        <div className="streak-welcome-flame" aria-hidden="true">
          <Flame size={40} />
        </div>
        <span className="eyebrow gold">DAILY STREAK</span>
        <h2 id="streak-welcome-title" className="streak-welcome-count">
          <span>{game.daily_streak}</span> {game.daily_streak === 1 ? 'day' : 'days'}
        </h2>
        <p>
          {isPersonalBest
            ? 'Your longest run yet. One more case tomorrow keeps it climbing.'
            : 'Another day on the docket and the streak holds. Come back tomorrow to keep it alive.'}
        </p>
        <button type="button" className="primary-button" onClick={close}>Back to work</button>
      </div>
    </div>
  )
}


export function formatMoney(value: number, compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
  }).format(value)
}


function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}


/**
 * The wait is the firm's own mark with the beam still settling, rather than a
 * generic glyph pulsing inside a box. Same drawing as `Brand`, so a route that
 * takes a moment reads as the same object the header carries rather than as a
 * loading widget borrowed from somewhere else.
 */
export function LoadingScreen({ label = 'Opening the firm…' }: { label?: string }) {
  return (
    <div className="loading-screen" role="status">
      <span className="legal-spinner"><ScalesMark tipping /></span>
      <span>{label}</span>
    </div>
  )
}


/**
 * `onRetry` is optional so that a failed read can offer a way out instead of
 * leaving a reload as the only recovery. Mutation errors, which the user can
 * retry by resubmitting, keep the plain message.
 */
export function ErrorNotice({ error, onRetry, retrying = false }: { error: unknown; onRetry?: () => void; retrying?: boolean }) {
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  return (
    <div className="error-notice" role="alert">
      <AlertSealMark />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="error-notice-retry" disabled={retrying} onClick={onRetry}>
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  )
}


export function Brand({ light = false, caseFile = false }: { light?: boolean; caseFile?: boolean }) {
  const contents = (
    <>
      <span className="brand-mark"><ScalesMark /></span>
      <span className="brand-word"><strong>LSAT</strong><small>{caseFile ? 'CASE FILE' : 'TYCOON'}</small></span>
    </>
  )
  if (caseFile) return <div className="brand case-brand" aria-label="LSAT Tycoon active case">{contents}</div>
  return <Link className={`brand ${light ? 'light' : ''}`} to="/progress" aria-label="LSAT Tycoon training lab" data-sound="navigate" data-sound-seed="progress">{contents}</Link>
}


const navItems = [
  { to: '/progress', label: 'Dashboard', icon: Brain },
  { to: '/cases', label: 'Practice', icon: BriefcaseBusiness },
  { to: '/office', label: 'Office', icon: Building2 },
  { to: '/firm', label: 'Firm', icon: LayoutGrid },
  { to: '/map', label: 'World', icon: Map },
]

// Focus Mode (assistance_level === 'focus') drops the office/firm/world chrome
// and leaves only the two screens a student actually needs to raise a score.
const FOCUS_MODE_ROUTES = new Set(['/progress', '/cases'])

const mobileNavItems = navItems.filter(({ to }) => to !== '/firm')


/* A case route normally hides the header and bottom nav so the reader owns the
   whole viewport. Screens that live on the same route but are ordinary scrolling
   pages (the paused card, the post-run review) call `useRestoredChrome` to get
   the navigation back and leave the locked-height shell. */
const RestoreChromeContext = createContext<(restored: boolean) => void>(() => {})

export function useRestoredChrome() {
  const setRestored = useContext(RestoreChromeContext)
  useLayoutEffect(() => {
    setRestored(true)
    return () => setRestored(false)
  }, [setRestored])
}


// A mega-litigation blocks nothing and is not required, so nothing nags about
// one. The Progress tab advertises it where a student is already looking at
// their own numbers, which is where it is worth taking.


export function AppShell({ user, game, children }: { user: User; game?: GameState | null; children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { play } = useSound()
  useSoundProfile({
    seed: `${user.id}:${game?.id ?? 'profile'}`,
    officeTier: game?.office_tier ?? 0,
    alignment: game?.story.alignment ?? 'Pragmatic',
  })
  const [chromeRestored, setChromeRestored] = useState(false)
  const tourReady = useIdleMount()
  const isOnCaseRoute = /^\/cases\/[^/]+/.test(location.pathname)
  const isActiveCase = isOnCaseRoute && !chromeRestored
  const isWideScene = /^\/(office|map)\/?$/.test(location.pathname)
  const isFocusMode = user.assistance_level === 'focus'
  const visibleNavItems = isFocusMode ? navItems.filter((item) => FOCUS_MODE_ROUTES.has(item.to)) : navItems
  const visibleMobileNavItems = isFocusMode ? mobileNavItems.filter((item) => FOCUS_MODE_ROUTES.has(item.to)) : mobileNavItems
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  useEffect(() => setMobileMenuOpen(false), [location.pathname])
  useEffect(() => {
    if (!mobileMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileMenuOpen])
  // The desktop account dropdown carries the tour replay and sign out — rare
  // controls with nowhere better to be — so the header row itself only has to
  // fit the nav, sound, and standing badge before this one trigger.
  //
  // Focus Mode is not in here. It was, and being in here is how it went
  // missing: a study-discipline switch two clicks deep behind an unlabelled
  // avatar is a switch nobody turns on. It now lives at the end of the nav
  // strip, which is the only part of the UI it visibly changes.
  //
  // The phone reaches all of these through the slide-out instead, since it has
  // no nav strip in the header at all. The sheet stays a strict superset of
  // the desktop dropdown: one surface per width, same controls in it.
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  useEffect(() => setAccountMenuOpen(false), [location.pathname])
  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && accountMenuRef.current?.contains(event.target)) return
      setAccountMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('pointerdown', closeOnOutsideClick)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('pointerdown', closeOnOutsideClick)
    }
  }, [accountMenuOpen])
  const playDataSound = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return
    const target = event.target.closest<HTMLElement>('[data-sound="navigate"]')
    if (!target || !event.currentTarget.contains(target)) return
    void play('navigate', {
      seed: target.dataset.soundSeed || target.getAttribute('href') || location.pathname,
      intensity: .42,
    })
  }
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })
  const toggleFocusMode = useMutation({
    mutationFn: () => api.updateMe({ assistance_level: isFocusMode ? 'full' : 'focus' }),
    onSuccess: (data) => queryClient.setQueryData(['me'], data),
  })
  // Single source of truth for "the streak just ticked up today", shared by the
  // header badge's glow and the streak welcome modal (see `narrative.tsx`) so
  // the two can never disagree about the moment.
  const streakJustAdvanced = useJustIncreased(game?.daily_streak ?? 0, 850, game ? `lsat-streak-seen:${game.id}` : undefined)
  return (
    /* The shell is not a control. This handler only delegates: it looks for a
       real link or button carrying `data-sound` and plays a cue for it. Keyboard
       activation of those native elements dispatches a click that bubbles here,
       so keyboard users get the same cue without a separate key listener. */
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <div className={`app-shell ${isActiveCase ? 'active-case' : ''} ${isWideScene ? 'wide-scene-shell' : ''}`} onClick={playDataSound}>
      <header className="app-header">
        <Brand caseFile={isActiveCase} />
        {game && !isActiveCase && (
          <nav className="desktop-nav" aria-label="Primary navigation">
            {visibleNavItems.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''} onPointerEnter={() => preloadArtForIntent(to)} onFocus={() => preloadArtForIntent(to)} data-sound="navigate" data-sound-seed={to} data-tour={`nav-${to.slice(1)}`}>
                <Icon size={17} /><span>{label}</span>
              </NavLink>
            ))}
            {/* Focus Mode sits at the end of the strip it governs, behind a
                hairline, because the only thing it visibly does is take three
                tabs out of this row. Buried in the account dropdown it was a
                setting nobody found; here, the switch and its effect are the
                same object, and when it is on the lit control stands exactly
                where the missing tabs were, which answers the only question
                the state raises. Icon-only while the row is full, labelled the
                moment Focus Mode empties three slots — see styles.css. */}
            <button
              type="button"
              className={`header-focus-toggle${isFocusMode ? ' is-on' : ''}`}
              onClick={() => toggleFocusMode.mutate()}
              disabled={toggleFocusMode.isPending}
              aria-pressed={isFocusMode}
              /* The visible word is one of the two shortest things that will
                 fit this row, so the name a screen reader gets is spelled out
                 here instead. It contains the visible text, which is what
                 keeps voice control able to say "click Focus". */
              aria-label={isFocusMode ? 'Focus Mode on. Show the office, firm, and world screens again' : 'Focus Mode. Hide the office, firm, and world screens'}
              title={isFocusMode ? 'Focus Mode is on — show the office, firm, and world screens again' : 'Focus Mode — hide the office, firm, and world screens'}
            >
              <FocusMark on={isFocusMode} />
              <span className="header-focus-label">{isFocusMode ? 'Focus Mode on' : 'Focus'}</span>
            </button>
          </nav>
        )}
        <div className="header-right">
          <div data-tour="sound"><SoundControls className="header-sound-controls" compact /></div>
          {/* Three badges fit a desktop header row; a phone's fits one or two.
              The classes exist so mobile.css can give them up by name in a
              deliberate order — question count first, accuracy second — rather
              than by position. The streak is the last to go because it is the
              only one of the three that can change on a day the student has
              not opened the app, and the only one the Dashboard below does not
              already spell out in full. */}
          {game && (
            <div className="header-economy training-standing" aria-label="Training standing" data-tour="standing">
              <span className="standing-accuracy" title={`${game.total_correct} of ${game.total_cases} billed cases won`}><Check size={16} />{game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0}%</span>
              {/* Billed cases, not answers: a case bills when its write-up is
                  scored, and a mega-litigation is measured rather than billed at
                  all. This badge used to read "49 Q", which put it in
                  competition with the two answer counts on the Dashboard. */}
              <span className="standing-questions" title={`${game.total_cases} cases billed by your firm — a case bills once its write-up is scored, and mega-litigation questions are measured rather than billed`}><BriefcaseBusiness size={16} />{game.total_cases} cases</span>
              <StreakBadge streak={game.daily_streak} justAdvanced={streakJustAdvanced} />
            </div>
          )}
          {/* The tour replay and sign out used to each stake out their own spot on
              the desktop header row, which is what actually overflowed at laptop
              widths. Neither is a guided-tour target, so on desktop they join
              Focus Mode in one anchored dropdown off the avatar/name trigger —
              the same grouping the mobile slide-out already uses, just as a small
              popover instead of a full-screen sheet. */}
          <div className={`account-menu ${accountMenuOpen ? 'is-open' : ''}`} ref={accountMenuRef}>
            <button
              type="button"
              className="account-menu-trigger"
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
            >
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
                : <span className="avatar-fallback">{user.display_name.slice(0, 1).toUpperCase()}</span>}
              <span className="account-name">{game?.lawyer_name || user.display_name}</span>
              <ChevronDown size={14} className="account-menu-chevron" aria-hidden="true" />
            </button>
            {accountMenuOpen && (
              <div className="account-menu-panel" role="menu" aria-label="Account">
                {/* Focus Mode is no longer listed here. It went back into the
                    nav strip, which is the row it actually changes; keeping a
                    second copy in this panel would have been the same control
                    twice at one width. */}
                {game && !isActiveCase && (
                  <button
                    type="button"
                    role="menuitem"
                    className="account-menu-item tour-replay-button"
                    onClick={() => { replayGuidedTour(); setAccountMenuOpen(false) }}
                  >
                    <HelpCircle size={17} />
                    <span><strong>Replay guided tour</strong><small>Tour the current learning workflow</small></span>
                  </button>
                )}
                {/* Between 1180px and the mobile cutover the header row keeps
                    only the mute button, and volume and the short-cue toggle
                    live here instead — the same grouping the mobile sheet
                    already uses. Hidden by CSS on a full-width desktop header,
                    where the whole cluster still fits in the row. */}
                <div className="account-menu-audio" role="group" aria-label="Sound">
                  <span><strong>Audio</strong><small>Volume and short cues</small></span>
                  <SoundControls className="account-menu-sound" compact={false} />
                </div>
                <button type="button" role="menuitem" className="account-menu-item sign-out" onClick={() => logout.mutate()} disabled={logout.isPending}>
                  <LogOut size={17} />
                  <span><strong>Sign out</strong></span>
                </button>
              </div>
            )}
          </div>
          {game && !isActiveCase && (
            <button
              type="button"
              className="mobile-overflow-trigger"
              aria-label={mobileMenuOpen ? 'Close account and firm menu' : 'Open account and firm menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => {
                void play(mobileMenuOpen ? 'paper' : 'ledger', { seed: 'mobile-firm-menu', intensity: .22 })
                setMobileMenuOpen((open) => !open)
              }}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              <span>{mobileMenuOpen ? 'Close' : 'Menu'}</span>
            </button>
          )}
        </div>
      </header>
      {/* Filled by the narrative layer when a story chapter is waiting; empty
          and zero-height otherwise. In flow rather than floating so the prompt
          reflows the page instead of covering a card on it — see overlays.tsx. */}
      <div id={CHAPTER_DOCK_ID} className="chapter-dock" />
      <main><RestoreChromeContext.Provider value={setChromeRestored}>{children}</RestoreChromeContext.Provider></main>
      {game && !isActiveCase && mobileMenuOpen && (
        <aside className="mobile-site-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-site-menu-title">
          <button type="button" className="mobile-site-menu-scrim" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} />
          <section>
            <header>
              <div>
                <small>FIRM MENU</small>
                <h2 id="mobile-site-menu-title">{game.lawyer_name}</h2>
                <span>{game.reputation_band.name} counsel · {game.total_cases} questions</span>
              </div>
            </header>
            {!isFocusMode && (
              <nav aria-label="Secondary navigation">
                <NavLink to="/firm" data-sound="navigate" data-sound-seed="/firm"><LayoutGrid /><span><strong>Manage firm</strong><small>Upgrades, staff, clients, and assets</small></span><ArrowRight /></NavLink>
                <NavLink to="/map" data-sound="navigate" data-sound-seed="/map"><Map /><span><strong>Career world</strong><small>Levels, rivals, and district dockets</small></span><ArrowRight /></NavLink>
              </nav>
            )}
            <div className="mobile-site-menu-tools">
              {/* The phone has no nav strip to hang the toggle off, so the
                  sheet stays its home — same mark, same wording. */}
              <button type="button" className={`mobile-focus-toggle${isFocusMode ? ' is-on' : ''}`} onClick={() => toggleFocusMode.mutate()} disabled={toggleFocusMode.isPending} aria-pressed={isFocusMode}>
                <FocusMark on={isFocusMode} /><span><strong>{isFocusMode ? 'Focus Mode: on' : 'Focus Mode: off'}</strong><small>{isFocusMode ? 'Show office, firm, and world screens again' : 'Hide office, firm, and world screens'}</small></span>
              </button>
              <button type="button" onClick={() => { replayGuidedTour(); setMobileMenuOpen(false) }}><HelpCircle /><span><strong>Replay tutorial</strong><small>Tour the current learning workflow</small></span></button>
              <div><span><strong>Audio</strong><small>Effects, volume, and scene music</small></span><SoundControls className="mobile-menu-sound" compact={false} /></div>
            </div>
            <footer>
              <span className="avatar-fallback">{user.display_name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{user.display_name}</strong><small>{user.email}</small></div>
              <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut /><span>Sign out</span></button>
            </footer>
          </section>
        </aside>
      )}
      {game && !isActiveCase && (
        <nav className="mobile-nav" aria-label="Primary navigation">
          {visibleMobileNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''} onPointerEnter={() => preloadArtForIntent(to)} onFocus={() => preloadArtForIntent(to)} data-sound="navigate" data-sound-seed={to} data-tour={`nav-${to.slice(1)}`}>
              <Icon size={20} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
      {/* "Already oriented" is account state, not browser state: a player who
          finished or skipped the tour on any device, or who has billed a case at
          all, is never handed it again. */}
      {game && !isActiveCase && tourReady && (
        <Suspense fallback={null}>
          <GuidedTour oriented={user.guided_tour_completed || game.total_cases > 0} />
        </Suspense>
      )}
      {game && <StreakWelcomeModal game={game} justAdvanced={streakJustAdvanced} suppressed={isOnCaseRoute} />}
    </div>
  )
}


function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}


/** A whole-form clock runs past an hour, where bare minutes stop reading as a time. */
function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  if (!hours) return formatTime(milliseconds)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}:${minutes.toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`
}


function ClientSettlement({
  reward,
  clientName,
  clientKind,
  satisfied,
}: {
  reward: AttemptReward
  clientName: string
  clientKind?: string
  satisfied: boolean
}) {
  const repPositive = reward.reputation_change >= 0
  const shownPayout = useCountUp(reward.payout)
  return (
    <section className={`client-settlement ${satisfied ? 'happy' : 'unhappy'}`} role="status" aria-live="polite">
      <div className="settlement-client">
        <ClientPortrait kind={clientKind} name={clientName} mood={satisfied ? 'happy' : 'unhappy'} />
        <div className="client-speech">
          <span>{satisfied ? 'CLIENT IMPRESSED' : 'CLIENT UNCONVINCED'}</span>
          <strong>{satisfied ? '“That’s the argument I hired you for!”' : '“We need a tighter argument next time.”'}</strong>
          <small>{clientName} closes the file and settles this matter.</small>
        </div>
      </div>
      <div className="reward-transfer" aria-label={`${formatMoney(reward.payout)} fee and ${reward.reputation_change.toFixed(1)} reputation`}>
        <div className="flying-coin coin-one">$</div>
        <div className="flying-coin coin-two">★</div>
        <div className="reward-packet fee-packet">
          <Coins /><span>Fee received</span><strong>+{formatMoney(shownPayout)}</strong>
          {reward.payout > 0 && (
            <span className="coin-burst" aria-hidden="true">
              {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
            </span>
          )}
        </div>
        <div className={`reward-packet rep-packet ${repPositive ? 'positive' : 'negative'}`}>
          <Star /><span>Reputation</span><strong>{repPositive ? '+' : ''}{reward.reputation_change.toFixed(1)}</strong>
        </div>
      </div>
    </section>
  )
}


const COUNSEL_LOSS_LINES = [
  '“Objection sustained.”',
  '“The record speaks for itself.”',
  '“Motion to strike that theory — granted.”',
  '“Is that the whole argument?”',
]
const COUNSEL_WIN_LINES = [
  '“…no further questions.”',
  '“Objection withdrawn.”',
  '“We will… review our position.”',
  '“Noted. Regrettably.”',
]


function CaseScore({ reward }: { reward: AttemptReward }) {
  const repPositive = reward.reputation_change >= 0
  return (
    <section className="case-score-card" aria-label="Case score and payout details">
      <div className="score-seal">
        <span>CASE SCORE</span>
        <strong>{reward.score}</strong>
        <small>/ 20</small>
      </div>
      <div className="score-breakdown">
        <div><span>Verified answer</span><strong>+{reward.breakdown.answer}</strong></div>
        <div><span>{reward.explanation_grade} reasoning</span><strong>+{reward.breakdown.explanation}</strong></div>
        <div><span>Time · {Math.round(reward.timing.elapsed_seconds)}s / {reward.timing.target_seconds}s</span><strong>+{reward.breakdown.time}</strong></div>
      </div>
      <div className="settlement-total">
        <div><Coins /><span>Fee earned</span><strong>+{formatMoney(reward.payout)}</strong></div>
        <div className={repPositive ? 'positive' : 'negative'}>
          <Star /><span>Reputation</span><strong>{repPositive ? '+' : ''}{reward.reputation_change.toFixed(1)}</strong>
        </div>
      </div>
      {(reward.streak_bonus > 0 || reward.staff_bonus > 0 || reward.contract_bonus > 0 || reward.quest_bonus > 0) && (
        <div className="bonus-ribbon">
          <Sparkles size={16} />
          {[
            reward.streak_bonus > 0 && `Streak +${formatMoney(reward.streak_bonus)}`,
            reward.staff_bonus > 0 && `Staff +${formatMoney(reward.staff_bonus)}`,
            reward.contract_bonus > 0 && `Contract +${formatMoney(reward.contract_bonus)}`,
            reward.quest_bonus > 0 && `Caseboard +${formatMoney(reward.quest_bonus)}`,
          ].filter(Boolean).join(' · ')}
        </div>
      )}
    </section>
  )
}


function JudgeReview({
  isCorrect,
  diagnosis,
  coaching,
  reward,
  loading,
}: {
  isCorrect: boolean
  diagnosis: string
  coaching?: CoachingFeedback
  reward?: AttemptReward | null
  loading: boolean
}) {
  const strongReasoning = reward?.explanation_grade === 'Good' || reward?.explanation_grade === 'Excellent'
  const title = coaching
    ? strongReasoning ? 'The logic holds up under questioning.' : 'Here is where the argument turns.'
    : isCorrect ? 'The verified answer is sustained.' : 'The verified answer overrules your choice.'
  const message = coaching?.reasoning_summary || diagnosis
  return (
    <section className="judge-review" role="status" aria-live="polite">
      <div className="judge-bench">
        <div className="bench-nameplate"><span>AI</span> THE HON. LOGICA</div>
        <JudgePortrait thinking={loading} pleased={Boolean(coaching && isCorrect && strongReasoning)} />
      </div>
      <div className="judge-speech">
        <div className="judge-status-row">
          <span className={isCorrect ? 'verified-correct' : 'verified-incorrect'}>{isCorrect ? <Check /> : <X />} VERIFIED ANSWER</span>
          {reward && <span className={`grade-pill grade-${reward.explanation_grade.toLowerCase()}`}>{reward.explanation_grade} REASONING</span>}
        </div>
        <h2>{title}</h2>
        <p>{message}</p>
        {loading && <div className="judge-thinking"><i /><i /><i /> Reviewing your case theory…</div>}
        <small>The answer key decides correctness. The judge coaches your explanation.</small>
      </div>
    </section>
  )
}


function CoachingPanel({ coaching, reward, selectedLabel }: { coaching: CoachingFeedback; reward?: AttemptReward | null; selectedLabel?: string }) {
  const correctLabel = coaching.answer_analysis.choice_explanations.find((choice) => choice.is_correct)?.label
  const selectedIsWrong = Boolean(selectedLabel && correctLabel && selectedLabel !== correctLabel)
  return (
    <section className="coaching-panel">
      <div className="coaching-heading">
        <div>
          <span className="eyebrow">THE JUDGE’S BENCH NOTES</span>
          <h2>Three things to carry into the next case</h2>
        </div>
        {reward && <span className={`grade-pill grade-${reward.explanation_grade.toLowerCase()}`}>{reward.explanation_grade}</span>}
      </div>

      <div className="debrief-roadmap">
        <article className="debrief-step strength">
          <b>1</b>
          <div><span><Check size={15} /> KEEP THIS</span>
          <p>{coaching.understood_correctly || coaching.reasoning_summary}</p>
          </div>
        </article>
        <article className="debrief-step repair">
          <b>2</b>
          <div><span><Brain size={15} /> FIX THIS FIRST</span>
          <p>{coaching.first_error ? `${coaching.first_error.description} ${coaching.first_error.repair}` : coaching.next_step_hint}</p>
          </div>
        </article>
        <article className="debrief-step method">
          <b>3</b>
          <div><span><Scale size={15} /> CLEAN APPROACH</span>
          <p>{coaching.solution_method || coaching.debrief}</p>
          </div>
        </article>
      </div>

      <div className="correct-explanation">
        <div><Check size={18} /></div>
        <div><strong>Why the credited answer wins</strong><p>{coaching.answer_analysis.correct_answer_explanation}</p></div>
      </div>
      {selectedIsWrong && (
        <div className="selected-explanation">
          <div><X size={18} /></div>
          <div><strong>Why your choice {selectedLabel} falls short</strong><p>{coaching.answer_analysis.selected_answer_explanation}</p></div>
        </div>
      )}
      <div className="choice-audit-heading"><span>FULL ANSWER AUDIT</span><small>Open any choice to see the judge’s reasoning.</small></div>
      <div className="choice-explanations">
        {coaching.answer_analysis.choice_explanations.map((choice) => (
          <details className={choice.is_correct ? 'choice-explanation correct' : 'choice-explanation'} key={choice.label} open={choice.is_correct}>
            <summary><span>{choice.label}</span><strong>{choice.is_correct ? 'Credited answer' : 'Why it falls short'}</strong></summary>
            <p>{choice.explanation}</p>
          </details>
        ))}
      </div>
      <div className="next-step"><Brain size={18} /><span><b>Your one-line rule for the next case:</b> {coaching.next_step_hint}</span></div>
    </section>
  )
}

function CompactReasoningPanel({ coaching, selectedLabel }: { coaching: CoachingFeedback; selectedLabel?: string }) {
  const selectedIsWrong = coaching.answer_analysis.choice_explanations.some(
    (choice) => choice.label === selectedLabel && !choice.is_correct,
  )
  return (
    <section className="compact-reasoning" aria-label="Concise answer reasoning">
      <div className="compact-reasoning-head"><Brain size={17} /><div><span>WHY THE CREDITED ANSWER WINS</span><strong>{coaching.answer_analysis.correct_answer_explanation}</strong></div></div>
      {selectedIsWrong && <p><b>Why your choice falls short:</b> {coaching.answer_analysis.selected_answer_explanation}</p>}
      <div className="compact-reasoning-rule"><Scale size={15} /><span>{coaching.next_step_hint}</span></div>
      <details><summary>Audit all five choices</summary><div>{coaching.answer_analysis.choice_explanations.map((choice) => <p key={choice.label}><b>{choice.label}</b> {choice.explanation}</p>)}</div></details>
    </section>
  )
}


function CasePageTurn({ active, spread }: { active: boolean; spread: boolean }) {
  return (
    <div className={`case-page-turn ${active ? 'is-turning' : ''} ${spread ? 'is-spread' : 'is-single'}`} aria-hidden="true">
      <div className="case-page-turn-underlay"><i /><i /><i /></div>
      <div className="case-page-turn-shadow" />
      <div className="case-page-turn-sheet">
        <div className="case-page-turn-front"><span>CASE ANALYSIS</span><b>COUNSEL WORK PRODUCT</b><i /><i /><i /><i /><em /></div>
        <div className="case-page-turn-back"><span>CONTINUED</span><b>CONFIDENTIAL</b><i /><i /><i /><em /></div>
        <div className="case-page-turn-curl" />
        <div className="case-page-turn-edge" />
      </div>
    </div>
  )
}


export function QuestionFlow({ session }: { session: StudySession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { play } = useSound()
  const gameQuery = useQuery({ queryKey: ['game'], queryFn: api.game })
  const item = session.pending_item || session.current_item
  const result = session.pending_result
  const isDiagnostic = session.mode === 'diagnostic'
  const requiresReasoning = Boolean(item?.requires_reasoning)
  // Every practice run is a paid, fully coached case now, so the only banner
  // and panel split left is diagnostic versus everything else.
  const learningOnly = isDiagnostic
  const [selected, setSelected] = useState(item?.draft.selected_label || '')
  const [reasoning, setReasoning] = useState(item?.draft.reasoning || '')
  const minChars = item?.reasoning_min_chars ?? 0
  const reasoningLength = reasoning.trim().length
  const reasoningComplete = !requiresReasoning || reasoningLength >= minChars
  const [confidence, setConfidence] = useState(3)
  const [answerChanged, setAnswerChanged] = useState(false)
  const [strategyApplied, setStrategyApplied] = useState<boolean | null>(null)
  const [strategyPromptMs, setStrategyPromptMs] = useState(0)
  const [pageTurning, setPageTurning] = useState(false)
  // Picking "Use it" arms the gate. Everything the gate withholds is withheld
  // from here down, so the wrong order is unreachable rather than discouraged.
  const strategyGate = useStrategyGate(item, {
    armed: strategyApplied === true,
    selectedLabel: selected,
    locked: Boolean(result),
  })
  const [mobileCasePane, setMobileCasePane] = useState<'passage' | 'question'>(() => item?.question.passage ? 'passage' : 'question')
  const [clock, setClock] = useState(Date.now())
  const [openedAt, setOpenedAt] = useState(Date.now())
  const [formClock, setFormClock] = useState(Date.now())
  const verdictRef = useRef<HTMLDivElement>(null)
  const pageTurnRunRef = useRef(0)
  const formExpiredRef = useRef(false)

  useEffect(() => {
    setSelected(item?.draft.selected_label || '')
    setReasoning(item?.draft.reasoning || '')
    setConfidence(3)
    setAnswerChanged(false)
    setStrategyApplied(null)
    setStrategyPromptMs(0)
    setMobileCasePane(item?.question.passage ? 'passage' : 'question')
    setOpenedAt(Date.now())
  }, [item?.id])

  useEffect(() => () => {
    pageTurnRunRef.current += 1
  }, [])

  useEffect(() => {
    if (!item?.timer_active || result) return
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [item?.timer_active, result])

  // The whole-form clock. The server sends the milliseconds left and rejects
  // anything that arrives after zero; this only counts down between polls, and
  // re-anchors every time the session is refetched.
  const formDeadline = useMemo(
    () => (session.remaining_ms == null ? null : Date.now() + session.remaining_ms),
    [session.id, session.remaining_ms],
  )
  const formRemaining = formDeadline == null ? null : Math.max(0, formDeadline - formClock)

  useEffect(() => {
    if (formDeadline == null) return
    formExpiredRef.current = false
    const interval = window.setInterval(() => setFormClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [formDeadline])

  useEffect(() => {
    if (formRemaining !== 0 || formExpiredRef.current) return
    // Time is up. The server has already decided; ask it what the form became.
    formExpiredRef.current = true
    void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    void queryClient.invalidateQueries({ queryKey: ['diagnostic'] })
    void queryClient.invalidateQueries({ queryKey: ['performance'] })
    void queryClient.invalidateQueries({ queryKey: ['game'] })
  }, [formRemaining, queryClient, session.id])

  useEffect(() => {
    if (result) verdictRef.current?.focus()
  }, [result?.attempt_id])

  useEffect(() => {
    if (!item || result) return
    const timeout = window.setTimeout(() => {
      void api.saveDraft(session.id, item.id, { selected_label: selected || undefined, reasoning }).catch(() => undefined)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [item?.id, reasoning, result, selected, session.id])

  const beginPageTurn = async (afterCurl: () => unknown | Promise<unknown>) => {
    if (pageTurning) return
    const run = ++pageTurnRunRef.current
    const startedAt = Date.now()
    setPageTurning(true)
    void play('paper', { seed: `page-turn:${session.id}:${item?.position ?? 0}`, intensity: .54 })
    await new Promise((resolve) => window.setTimeout(resolve, MOTION_TIMING.pageTurnCurlMs))
    if (pageTurnRunRef.current !== run) return
    try {
      await afterCurl()
    } catch {
      if (pageTurnRunRef.current === run) setPageTurning(false)
      return
    }
    const remaining = Math.max(0, MOTION_TIMING.pageTurnTotalMs - (Date.now() - startedAt))
    if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining))
    if (pageTurnRunRef.current === run) setPageTurning(false)
  }

  const submit = useMutation({
    mutationFn: () => api.submitAttempt(
      session.id,
      {
        item_id: item!.id,
        selected_label: selected,
        reasoning,
        confidence,
        answer_changed: answerChanged,
        ...(item?.strategy_trial ? { strategy_applied: strategyApplied ?? undefined, strategy_prompt_ms: strategyPromptMs } : {}),
        ...strategyGate.payload,
      },
      createRequestId(),
    ),
    onSuccess: ({ result: submittedResult }) => {
      if (!submittedResult.feedback_released && !submittedResult.session_complete) {
        void beginPageTurn(() => queryClient.invalidateQueries({ queryKey: ['session', session.id] }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    },
    onError: (error) => {
      setPageTurning(false)
      // A rejected gate comes back as a 409 with field-level messages on it.
      strategyGate.applyServerErrors((error as unknown as { fields?: Array<{ field: string | null; message: string }> }).fields)
    },
  })
  const continueCases = useMutation({
    mutationFn: () => api.acknowledgeReview(session.id),
    onSuccess: ({ session: nextSession, settlement_pending: settlementPending }) => {
      if (settlementPending) {
        // The player moved on before grading finished. The settlement lands on
        // the worker's own schedule, so re-read the firm shortly to pick up the
        // fee rather than leaving stale cash on screen.
        window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ['game'] })
        }, 6_000)
      }
      if (isDiagnostic && nextSession.status === 'completed') {
        void queryClient.invalidateQueries({ queryKey: ['performance'] })
        void queryClient.invalidateQueries({ queryKey: ['diagnostic'] })
        void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
        navigate(`/cases/${session.id}`, { replace: true })
        return
      }
      if (nextSession.status === 'completed') {
        void queryClient.invalidateQueries({ queryKey: ['performance'] })
        void queryClient.invalidateQueries({ queryKey: ['current-session'] })
        void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
        void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
        navigate(`/cases/${session.id}`, { replace: true })
        return
      }
      void play('file-open', {
        id: `next-file:${nextSession.id}:${nextSession.current_index}`,
        seed: `${nextSession.id}:${nextSession.current_index}`,
        intensity: .58,
      })
      void queryClient.invalidateQueries({ queryKey: ['game'] })
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      if (nextSession.id !== session.id) navigate(`/cases/${nextSession.id}`, { replace: true })
      else void queryClient.invalidateQueries({ queryKey: ['session', session.id] })
    },
    onError: () => setPageTurning(false),
  })
  const savedCoaching = result?.feedback?.coaching
  const savedReward = result?.game_reward
  const coaching = useQuery({
    queryKey: ['coaching', result?.attempt_id],
    queryFn: () => api.coaching(result!.attempt_id),
    enabled: Boolean(result?.feedback_released && (!savedCoaching || (!isDiagnostic && !savedReward))),
    retry: false,
    // Grading runs on a background worker, so a look that comes back "pending"
    // is polled rather than awaited. Nothing on screen waits for it.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1_500 : false),
  })
  const coachingFeedback = savedCoaching || coaching.data?.coaching
  const reward = savedReward || coaching.data?.reward
  const coachingReady = Boolean(coachingFeedback)
  const gradingUnavailable = coaching.data?.status === 'unavailable'
  const gradingPending = !coachingReady && !gradingUnavailable && !coaching.error && Boolean(result?.feedback_released)

  useEffect(() => {
    if (!result) return
    void play(result.is_correct ? 'verdict-correct' : 'verdict-repair', {
      id: `verdict:${result.attempt_id}`,
      seed: result.attempt_id,
      intensity: .9,
    })
  }, [play, result?.attempt_id, result?.is_correct])

  useEffect(() => {
    if (!result || !reward || !coachingReady) return
    const timers: number[] = []
    const reasoningValidated = result.is_correct && (reward.explanation_grade === 'Good' || reward.explanation_grade === 'Excellent')
    const hasBonus = reward.streak_bonus > 0 || reward.staff_bonus > 0 || reward.contract_bonus > 0 || reward.quest_bonus > 0
    const hasPayout = reward.payout > 0
    const ledgerDelay = reasoningValidated ? 220 : 140

    if (reasoningValidated) {
      timers.push(window.setTimeout(() => {
        void play('reasoning-validated', {
          id: `reasoning:${reward.id}`,
          seed: reward.id,
          intensity: .68,
        })
      }, 105))
    }
    if (hasPayout) {
      timers.push(window.setTimeout(() => {
        void play('ledger', {
          id: `ledger:${reward.id}`,
          seed: reward.id,
          intensity: .48,
        })
      }, ledgerDelay))
      if (hasBonus) {
        timers.push(window.setTimeout(() => {
          void play('bonus', {
            id: `bonus:${reward.id}`,
            seed: reward.id,
            intensity: .58,
          })
        }, ledgerDelay + 70))
      }
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [
    play,
    coachingReady,
    result?.attempt_id,
    result?.is_correct,
    reward?.contract_bonus,
    reward?.explanation_grade,
    reward?.id,
    reward?.payout,
    reward?.quest_bonus,
    reward?.staff_bonus,
    reward?.streak_bonus,
  ])

  useEffect(() => {
    if (!coaching.data?.game) return
    queryClient.setQueryData<GameResponse>(['game'], { game: coaching.data.game, pending_reviews: [] })
  }, [coaching.data?.game, queryClient])

  const elapsed = useMemo(() => {
    if (!item) return 0
    return item.elapsed_ms + (item.timer_active && !result ? Math.max(0, clock - openedAt) : 0)
  }, [clock, item, openedAt, result])

  if (!item) return <ErrorNotice error={new Error('This case file could not be loaded.')} />
  const question = item.question
  const strategyTrial = item.strategy_trial
  const strategyDecisionRequired = Boolean(strategyTrial && strategyApplied === null && !result)
  const timerRatio = elapsed / Math.max(1, item.target_time_seconds * 1000)
  const caseClient = gameQuery.data?.game?.catalog.clients.find((client) => client.key === item.case_terms?.client_key)
  const clientName = item.case_terms?.client_name || caseClient?.name || 'Walk-in Client'
  const clientKind = caseClient?.icon
  const clientSatisfied = Boolean(result?.is_correct && reward && ['Good', 'Excellent'].includes(reward.explanation_grade))
  const mobileSessionLabel = isDiagnostic ? 'Mega-litigation' : 'Cases'

  const counsel = counselFor(session.id)
  const counselRattled = Boolean(result?.is_correct)
  const counselLine = result
    ? (result.is_correct ? COUNSEL_WIN_LINES : COUNSEL_LOSS_LINES)[keyHash(result.attempt_id) % COUNSEL_WIN_LINES.length]
    : null

  return (
    <div className="question-layout case-instrument">
      <CasePageTurn active={pageTurning} spread={Boolean(question.passage)} />
      {isDiagnostic ? (
        <section
          className="learning-mode-banner diagnostic-session-banner"
          aria-label="Mega-litigation in progress"
        >
          <div><Target size={20} /><span>MEGA-LITIGATION</span></div>
          <strong>A full practice LSAT · one sitting, one clock · no fees, reputation, or streak until the verdict</strong>
        </section>
      ) : <section className="active-matter-banner" aria-label={`Current case for ${clientName}`}>
        <ClientPortrait kind={clientKind} name={clientName} />
        <div className="active-matter-copy">
          <span>YOU ARE REPRESENTING</span>
          <strong>{clientName}</strong>
          <small>This client is locked to this open case, even if you change contracts later.</small>
        </div>
        <div className="active-matter-fee"><span>POTENTIAL BASE FEE</span><strong>{formatMoney(item.case_terms?.base_fee || 0)}</strong><small>Answer + reasoning + speed set the final fee</small></div>
        <div className={`opposing-counsel ${result ? (counselRattled ? 'is-rattled' : 'is-smug') : ''}`}>
          <div className="counsel-portrait">
            <CounselPortrait3D seed={counsel.key} rattled={counselRattled} label={`Opposing counsel ${counsel.name}`} />
          </div>
          <div className="counsel-copy">
            <span>OPPOSING COUNSEL</span>
            <strong>{counsel.name}</strong>
            <small>{counsel.firm}</small>
          </div>
          {counselLine && <div className="counsel-bubble" key={result?.attempt_id}>{counselLine}</div>}
        </div>
      </section>}
      <div className="case-file-topbar">
        <div className="matter-tag">
          <span>{question.section === 'Logical Reasoning' ? 'LR' : 'RC'}</span>
          <div><small>{learningOnly ? 'QUESTION TYPE' : 'ACTIVE MATTER'}</small><strong>{question.question_type}</strong></div>
        </div>
        <div className="question-progress">
          <strong>{isDiagnostic ? 'Question' : 'Case'} {Math.min(item.position + 1, session.total_items)} / {session.total_items}</strong>
          {item.case_terms && <span>{item.case_terms.client_name} · {formatMoney(item.case_terms.base_fee)} base fee</span>}
        </div>
        {formRemaining == null ? (
          <div className={`case-timer ${timerRatio > 1 ? 'over' : ''}`}>
            <Clock3 size={17} />
            <span>{formatTime(elapsed)}</span>
            <small>target {formatTime(item.target_time_seconds * 1000)}</small>
          </div>
        ) : (
          // One clock for the sitting. Spending it unevenly is the student's
          // call, so the per-question target is a reference, not the headline.
          <div className={`case-timer ${formRemaining <= 5 * 60_000 ? 'over' : ''}`} aria-label="Time left in this sitting">
            <Clock3 size={17} />
            <span>{formatCountdown(formRemaining)}</span>
            <small>left · {formatTime(item.target_time_seconds * 1000)} a question keeps you on pace</small>
          </div>
        )}
      </div>
      <div className="progress-track"><span style={{ width: `${session.progress_percent}%` }} /></div>

      <Suspense fallback={null}>
        <CaseRunRail session={session} />
      </Suspense>

      <div className={`mobile-case-reader-header ${formRemaining == null ? '' : 'is-form-sitting'}`} aria-label="Case reader controls">
        <div className="mobile-case-reader-meta">
          <span>{question.section === 'Logical Reasoning' ? 'LR' : 'RC'}</span>
          <div><small>{mobileSessionLabel}</small><strong>{item.position + 1} of {session.total_items}</strong></div>
        </div>
        {question.passage && (
          <div className="mobile-case-pane-tabs" role="tablist" aria-label="Reading view">
            <button type="button" role="tab" aria-selected={mobileCasePane === 'passage'} className={mobileCasePane === 'passage' ? 'active' : ''} onClick={() => { setMobileCasePane('passage'); void play('paper', { seed: `${item.id}:passage`, intensity: .2 }) }}><BookOpen size={15} /> Passage</button>
            <button type="button" role="tab" aria-selected={mobileCasePane === 'question'} className={mobileCasePane === 'question' ? 'active' : ''} onClick={() => { setMobileCasePane('question'); void play('tab', { seed: `${item.id}:question`, intensity: .22 }) }}>Question</button>
          </div>
        )}
        {/* A mega-litigation has one clock for the whole sitting and no pause, so
            the countdown has to stay on screen here — the desktop topbar that
            normally carries it is hidden at phone widths. */}
        {formRemaining == null ? (
          <div className={`mobile-case-reader-time ${timerRatio > 1 ? 'over' : ''}`}><Clock3 size={14} /><span>{formatTime(elapsed)}</span></div>
        ) : (
          <div className={`mobile-case-reader-time is-form-clock ${formRemaining <= 5 * 60_000 ? 'over' : ''}`} aria-label="Time left in this sitting">
            <Clock3 size={14} /><span>{formatCountdown(formRemaining)}</span><small>left</small>
          </div>
        )}
      </div>

      {strategyTrial && (
        <section className={`strategy-tip ${strategyApplied === true ? 'is-applied' : strategyApplied === false ? 'is-skipped' : ''}`} aria-label={`Suggested approach: ${strategyTrial.plain_title}`}>
          <div className="strategy-tip-head">
            <span><Brain size={15} /> PARTNER TIP</span>
            {!result && <small>Pick one before you answer</small>}
          </div>
          <h2>{strategyTrial.plain_title}</h2>
          <p>{strategyTrial.plain_line}</p>
          <ol>{strategyTrial.steps.map((step, index) => <li key={step}><b>{index + 1}</b>{step}</li>)}</ol>
          <div className="strategy-tip-actions">
            {!result ? <>
              <button type="button" className={`strategy-tip-use ${strategyApplied === true ? 'active' : ''}`} aria-pressed={strategyApplied === true} onClick={() => {
                if (strategyApplied === null) setStrategyPromptMs(Math.min(60_000, Date.now() - openedAt))
                setStrategyApplied(true)
                void play('select', { seed: `${item.id}:strategy-use`, intensity: .36 })
              }}><Check size={15} /> Use it</button>
              <button type="button" className={`strategy-tip-skip ${strategyApplied === false ? 'active' : ''}`} aria-pressed={strategyApplied === false} onClick={() => {
                if (strategyApplied === null) setStrategyPromptMs(Math.min(60_000, Date.now() - openedAt))
                setStrategyApplied(false)
                void play('paper', { seed: `${item.id}:strategy-skip`, intensity: .25 })
              }}>Skip this one</button>
            </> : <div className="strategy-tip-recorded"><Check size={17} /><span>{strategyApplied ? 'Used this approach' : 'Answered without it'}</span></div>}
          </div>
        </section>
      )}

      {strategyGate.panel}

      <div className={`${question.passage ? `question-content with-passage mobile-pane-${mobileCasePane}` : 'question-content'} ${strategyDecisionRequired ? 'strategy-decision-pending' : ''}`}>
        {question.passage && (
          <article className="passage-card">
            <div className="document-heading"><BookOpen size={16} /><span>EXHIBIT A · READING PASSAGE</span></div>
            <div className="passage-text">{question.passage.text}</div>
            <button type="button" className="mobile-open-question" onClick={() => setMobileCasePane('question')}>Go to the question <ArrowRight size={17} /></button>
          </article>
        )}

        <section className={`answer-card ${result ? (result.is_correct ? 'case-won' : 'case-lost') : ''}`}>
          <div className="paperclip" aria-hidden="true" />
          {question.stimulus && <div className="stimulus">{question.stimulus}</div>}
          <span className="question-label">QUESTION PRESENTED</span>
          <h1>{question.stem}</h1>
          {strategyGate.choicesHidden && strategyGate.gate ? <LockedChoicesNotice gate={strategyGate.gate} /> : (
          <div className="choices" role="radiogroup" aria-label="Answer choices">
            {question.choices.map((choice) => {
              const chosen = (result?.feedback?.selected_label || selected) === choice.label
              const correct = result?.feedback?.correct_label === choice.label
              const wrongSelected = Boolean(result && chosen && !correct)
              const stricken = strategyGate.strickenLabels.includes(choice.label)
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={Boolean(result) || strategyDecisionRequired || (stricken && !result)}
                  className={`choice ${chosen ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrongSelected ? 'incorrect' : ''} ${stricken && !result ? 'gate-struck' : ''}`}
                  key={choice.label}
                  onClick={() => {
                    if (selected !== choice.label) void play('select', { seed: `${item.id}:${choice.label}`, intensity: .36 })
                    if (selected && selected !== choice.label) setAnswerChanged(true)
                    setSelected(choice.label)
                  }}
                >
                  <span className="choice-label">{choice.label}</span>
                  <span>{choice.text}</span>
                  {correct && <Check className="choice-status" size={18} />}
                  {wrongSelected && <X className="choice-status" size={18} />}
                </button>
              )
            })}
          </div>
          )}

          {!result && requiresReasoning && (
            <div className="reasoning-box">
              <div className="reasoning-heading">
                <label htmlFor="reasoning">Your case theory <b>Required</b></label>
                <span>{reasoningLength} / {minChars} characters</span>
              </div>
              <textarea
                id="reasoning"
                value={reasoning}
                disabled={strategyDecisionRequired}
                onChange={(event) => setReasoning(event.target.value)}
                placeholder="Identify the conclusion, decisive evidence or logical relationship, and why your choice answers the exact question…"
                rows={5}
                maxLength={4000}
              />
              <p>Substance beats length. Generic or repeated explanations receive no meaningful payout.</p>
            </div>
          )}

          {!result && (
            <div className="confidence-check" aria-label="Answer confidence">
              <span>Confidence</span>
              <div>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} disabled={strategyDecisionRequired} className={confidence === value ? 'active' : ''} onClick={() => setConfidence(value)} aria-pressed={confidence === value}>{value}</button>)}</div>
              <small>{confidence <= 2 ? 'Unsure' : confidence >= 4 ? 'Confident' : 'Moderate'}</small>
            </div>
          )}

          {!result && (
            <div className="answer-actions">
              {submit.error && <ErrorNotice error={submit.error} />}
              <button className="primary-button verdict-button" disabled={!selected || !reasoningComplete || strategyDecisionRequired || !strategyGate.satisfied || submit.isPending || pageTurning} onClick={() => {
                void play('submit', { seed: item.id, intensity: .68 })
                submit.mutate()
              }}>
                {strategyDecisionRequired ? 'Pick Use it or Skip first' : submit.isPending || pageTurning ? 'Recording answer…' : !strategyGate.satisfied ? strategyGate.blockedReason : !selected ? 'Select an answer' : !reasoningComplete ? `${minChars - reasoningLength} more characters` : <>{requiresReasoning ? 'Submit reasoning' : session.feedback_policy === 'delayed' ? 'Lock answer' : 'Check answer'} <Scale size={18} /></>}
              </button>
            </div>
          )}

          {result?.feedback && (
            <div ref={verdictRef} tabIndex={-1} className="judge-review-focus">
              <div className={`verdict-stamp ${result.is_correct ? 'stamp-won' : 'stamp-lost'}`} key={result.attempt_id} aria-hidden="true">
                <span>{result.is_correct ? 'SUSTAINED' : 'OVERRULED'}</span>
              </div>
              <JudgeReview
                isCorrect={Boolean(result.is_correct)}
                diagnosis={result.feedback.diagnosis}
                coaching={coachingFeedback}
                reward={reward}
                loading={gradingPending}
              />
            </div>
          )}
          {result && gradingPending && (
            <div className="grading-pending" role="status">
              <Brain size={17} />
              <div>
                <strong>The coach is still reading your reasoning.</strong>
                <small>
                  Your answer is already recorded and the fee is being settled. Move to the next case
                  whenever you like — the written feedback and the payout land in your ledger on their own.
                </small>
              </div>
            </div>
          )}
          {result && gradingUnavailable && (
            <div className="grading-pending is-unavailable" role="status">
              <ShieldAlert size={17} />
              <div>
                <strong>Written feedback is unavailable for this case.</strong>
                <small>{coaching.data?.notice}</small>
              </div>
            </div>
          )}
          {result && coaching.error && (!coachingFeedback || !reward) && (
            <div className="coaching-error">
              <ErrorNotice error={coaching.error} />
              <button className="secondary-button" onClick={() => coaching.refetch()}>Retry case review</button>
            </div>
          )}
          {coachingFeedback && (isDiagnostic
            ? <CompactReasoningPanel coaching={coachingFeedback} selectedLabel={result?.feedback?.selected_label} />
            : <CoachingPanel coaching={coachingFeedback} reward={reward} selectedLabel={result?.feedback?.selected_label} />)}
          {reward && (
            <>
              <ClientSettlement reward={reward} clientName={clientName} clientKind={clientKind} satisfied={clientSatisfied} />
              <CaseScore reward={reward} />
            </>
          )}

          {result && (
            <div className="continue-row">
              {continueCases.error && <ErrorNotice error={continueCases.error} />}
              {/* Never gated on grading. Waiting 20-30 seconds per case for a
                  frontier-model call is hours of dead time across a course, and
                  the settlement does not need the player present to land. */}
              <button
                className="primary-button next-case-button"
                disabled={continueCases.isPending || pageTurning}
                onClick={() => void beginPageTurn(() => continueCases.mutateAsync())}
              >
                {continueCases.isPending || pageTurning ? 'Turning the page…' : <>Next case <ArrowRight size={18} /></>}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}


/* ------------------------------------------------------ office events */

const EVENT_GLOBAL_COOLDOWN_MS = 5 * 60_000
const EVENT_DECLINE_COOLDOWN_MS = 30 * 60_000

const EVENT_CATEGORY_LABEL: Record<StoryQuest['category'], string> = {
  pro_bono: 'A CAUSE WORTH TAKING',
  investigation: 'AN INVESTIGATION OPENS',
  shadow: 'A SHADOW OFFER',
  legacy: 'A LEGACY MATTER',
}

export function OfficeEventPopup({ game }: { game: GameState }) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const [dismissed, setDismissed] = useState(false)
  const [visible, setVisible] = useState(false)

  const quest = useMemo(() => {
    if (game.story.active_quest || game.story.pending_chapter) return null
    const now = Date.now()
    if (now - Number(localStorage.getItem('lt-event-last') || 0) < EVENT_GLOBAL_COOLDOWN_MS) return null
    const options = game.story.quests.filter((entry) =>
      entry.available && !entry.active && !entry.completed
      && now - Number(localStorage.getItem(`lt-event-declined-${entry.key}`) || 0) > EVENT_DECLINE_COOLDOWN_MS)
    if (!options.length) return null
    return options[keyHash(game.id) % options.length]
  }, [game])

  useEffect(() => {
    if (!quest) return
    const timeout = window.setTimeout(() => setVisible(true), MOTION_TIMING.popupDelayMs)
    return () => window.clearTimeout(timeout)
  }, [quest])

  const accept = useMutation({
    mutationFn: () => api.startQuest(quest!.key),
    onSuccess: ({ game: nextGame }) => {
      void play('event', {
        id: `office-event-accepted:${nextGame.id}:${quest!.key}`,
        seed: quest!.key,
        intensity: .6,
      })
      localStorage.setItem('lt-event-last', String(Date.now()))
      queryClient.setQueryData<GameResponse>(['game'], { game: nextGame, pending_reviews: [] })
      setDismissed(true)
    },
  })

  if (!quest || dismissed || !visible) return null

  const decline = () => {
    void play('paper', { seed: `decline:${quest.key}`, intensity: .35 })
    localStorage.setItem(`lt-event-declined-${quest.key}`, String(Date.now()))
    localStorage.setItem('lt-event-last', String(Date.now()))
    setDismissed(true)
  }

  return (
    <div className="office-event-overlay" role="dialog" aria-modal="true" aria-labelledby="office-event-title">
      <article className={`office-event event-${quest.category}`}>
        <div className="event-art">
          <img src={eventArt(quest.scene)} alt="" draggable={false} />
          <div className="event-visitor-3d"><EventVisitor3D seed={quest.key} label={quest.patron} /></div>
          <span className="event-category">{EVENT_CATEGORY_LABEL[quest.category]}</span>
        </div>
        <div className="event-body">
          <span className="event-eyebrow">A VISITOR AT THE OFFICE</span>
          <h2 id="office-event-title">{quest.title}</h2>
          <small className="event-patron">{quest.patron} · {quest.objective}</small>
          <p>{quest.description}</p>
          <div className="event-stakes">
            {quest.start_label && <span className="stake-cost">{quest.start_label}</span>}
            <span className="stake-reward">{quest.reward_label}</span>
          </div>
          {accept.error && <ErrorNotice error={accept.error} />}
          <div className="event-actions">
            <button className="primary-button" onClick={() => accept.mutate()} disabled={accept.isPending}>
              {accept.isPending ? 'Opening the file…' : <>Take the matter <ArrowRight size={17} /></>}
            </button>
            <button className="secondary-button" onClick={decline}>Turn them away</button>
          </div>
        </div>
      </article>
    </div>
  )
}


export function PauseButton({ sessionId, returnTo = '/office' }: { sessionId: string; returnTo?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const pause = useMutation({
    mutationFn: () => api.pauseSession(sessionId),
    onSuccess: () => {
      void play('pause', { id: `pause:${sessionId}`, seed: sessionId, intensity: .52 })
      void queryClient.invalidateQueries({ queryKey: ['current-session'] })
      void queryClient.invalidateQueries({ queryKey: ['active-sessions'] })
      navigate(returnTo)
    },
  })
  return (
    <button className="secondary-button compact" onClick={() => pause.mutate()} disabled={pause.isPending}>
      <Pause size={15} /> Save & return
    </button>
  )
}
