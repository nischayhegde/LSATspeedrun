import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BriefcaseBusiness,
  Brain,
  Building2,
  Check,
  ChevronDown,
  Flame,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Map,
  Menu,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { api } from './api'
import { AlertSealMark, FocusMark, ScalesMark } from './art-2d/marks'
import { EconomyLedger } from './economy-ledger'
import { SoundControls, useSound, useSoundProfile } from './sound'
import { replayGuidedTour } from './guided-tour-replay'
import { CHAPTER_DOCK_ID, clearOverlayNote, readOverlayNote, useBlockingOverlay, writeOverlayNote } from './overlays'
import { preloadArtForIntent } from './art/scene-loaders'
import { routeForPath } from './routes'
import type { GameState, User } from './types'

/* The app shell and the small pieces every route shares. The case run itself
   lives in `case-flow.tsx` and the Office visitor in `office-event.tsx`: both
   pull in the 3D portraits, and keeping them here put `game-art` — and through
   it the empire map and the wardrobe — in front of every first paint. */

// The guided tour renders on every screen but is in front of the reader on
// almost none of them, and it carries a 3D guide of its own. Kept in the entry
// bundle it was parsed before any screen could draw; deferred to the first idle
// moment it costs a first paint nothing, and a tour that opens a beat after the
// page has settled is the same tour.
const GuidedTour = lazy(() => import('./guided-tour').then((module) => ({ default: module.GuidedTour })))

/**
 * A pointer settling on a nav item is enough warning to fetch the screen behind
 * it, not just its artwork. Arriving with the module already resident is what
 * lets that screen render on the first commit instead of putting a Suspense
 * fallback in front of it — the same trick `main.tsx` plays for the route the
 * reader loads cold, extended to the ones they walk to.
 */
function preloadIntent(to: string) {
  preloadArtForIntent(to)
  void routeForPath(to)?.preload()
}

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
        <p>{isPersonalBest ? 'Your longest run yet.' : 'Sit a case tomorrow to keep it.'}</p>
        <button type="button" className="primary-button" onClick={close}>Back to work</button>
      </div>
    </div>
  )
}


export { formatMoney } from './format'


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
      <span className="brand-word"><strong>LAWYER</strong><small>{caseFile ? 'CASE FILE' : 'TYCOON'}</small></span>
    </>
  )
  if (caseFile) return <div className="brand case-brand" aria-label="Lawyer Tycoon active case">{contents}</div>
  return <Link className={`brand ${light ? 'light' : ''}`} to="/progress" aria-label="Lawyer Tycoon training lab" data-sound="navigate" data-sound-seed="progress">{contents}</Link>
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
              <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''} onPointerEnter={() => preloadIntent(to)} onFocus={() => preloadIntent(to)} data-sound="navigate" data-sound-seed={to} data-tour={`nav-${to.slice(1)}`}>
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
            <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''} onPointerEnter={() => preloadIntent(to)} onFocus={() => preloadIntent(to)} data-sound="navigate" data-sound-seed={to} data-tour={`nav-${to.slice(1)}`}>
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
      {/* Fixed, and deliberately outside <main>: these figures move while the
          student is on some other screen, which is the whole reason for it.
          Focus Mode passes `hidden`, which stops the rendering only — the game
          query and every mutation that moves these numbers sit above this and
          keep running, so turning Focus Mode back off shows current values
          rather than whatever was last on screen. A case in progress owns the
          viewport, so the ledger stands down for it. */}
      {game && !isActiveCase && <EconomyLedger game={game} hidden={isFocusMode} />}
      {game && <StreakWelcomeModal game={game} justAdvanced={streakJustAdvanced} suppressed={isOnCaseRoute} />}
    </div>
  )
}
