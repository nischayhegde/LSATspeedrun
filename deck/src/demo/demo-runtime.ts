import { demoConfig } from '../../demo.config'
import type { DemoSpec } from '../slides/types'
import type { AppHealth } from './health'

type DemoSessionOverlay = {
  liveSessionId: string
  verdictSessionId: string
  soloSessionId: string
  soloAnswerKey: string
  autoplaySessionId: string
  autoplayAnswerKey: string
  demoEmail: string
}

const sessionOverlay: DemoSessionOverlay = {
  liveSessionId: demoConfig.liveSessionId,
  verdictSessionId: demoConfig.verdictSessionId,
  soloSessionId: demoConfig.soloSessionId,
  soloAnswerKey: demoConfig.soloAnswerKey,
  autoplaySessionId: demoConfig.autoplaySessionId,
  autoplayAnswerKey: demoConfig.autoplayAnswerKey,
  demoEmail: demoConfig.demoEmail,
}

export function getDemoSessions(): DemoSessionOverlay {
  return sessionOverlay
}

/**
 * Production staging writes `/pitch/demo-sessions.json` after it creates the
 * live sessions. The committed pins in `demo.config.ts` are local rehearsal
 * ids and will 404 against RDS, so the deck prefers this overlay when present.
 */
export async function loadDeployedDemoSessions(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const response = await fetch('/pitch/demo-sessions.json', { cache: 'no-store', credentials: 'same-origin' })
    if (!response.ok) return
    const data = await response.json() as Partial<DemoSessionOverlay>
    if (typeof data.liveSessionId === 'string' && data.liveSessionId) sessionOverlay.liveSessionId = data.liveSessionId
    if (typeof data.verdictSessionId === 'string' && data.verdictSessionId) sessionOverlay.verdictSessionId = data.verdictSessionId
    if (typeof data.soloSessionId === 'string' && data.soloSessionId) sessionOverlay.soloSessionId = data.soloSessionId
    if (typeof data.soloAnswerKey === 'string' && data.soloAnswerKey) sessionOverlay.soloAnswerKey = data.soloAnswerKey
    if (typeof data.autoplaySessionId === 'string' && data.autoplaySessionId) sessionOverlay.autoplaySessionId = data.autoplaySessionId
    if (typeof data.autoplayAnswerKey === 'string' && data.autoplayAnswerKey) sessionOverlay.autoplayAnswerKey = data.autoplayAnswerKey
    if (typeof data.demoEmail === 'string' && data.demoEmail) sessionOverlay.demoEmail = data.demoEmail
  } catch {
    // A missing overlay is the local-rehearsal case. Keep the committed pins.
  }
}

/**
 * The bus between the demo frame's chrome, which lives inside a slide, and the
 * live embed, which no longer does.
 *
 * Two things travel over it, in opposite directions.
 *
 * **Up: where each slide's screen slot is.** `slides/layouts.tsx` composes the
 * demo body and is owned by the narrative rather than by the demo runtime; it
 * renders `<DemoFrame>` and knows nothing about hoisting. So `DemoFrame` keeps
 * its signature and all of its chrome exactly where they were and publishes the
 * one thing the hoisted embed needs — the rect of the hole it should fill.
 * Keyed by the `DemoSpec` object itself. Both slide layers are in the document
 * during a transition, so the stage has to be able to ask for one particular
 * slide's slot rather than whichever registered last — and the spec is the only
 * identity the two ends already share. `DemoFrame` is handed one by
 * `slides/layouts.tsx` and the stage reads the same object off
 * `SLIDES[index].demo`, so neither has to be told a slide id that
 * `layouts.tsx` does not currently pass and that only its owner could add.
 *
 * **Down: whether the embed is live.** The probe, the stills override and the
 * session check all now happen in one place — `DemoStage` — instead of once per
 * mounted slide, because there is now one embed rather than one per slide and
 * two slides mid-transition must not disagree about what the lamp says. The
 * chrome reads the answer from here.
 *
 * Deliberately not React context: the two ends are on opposite sides of a
 * component tree owned by two different people, and a module is the only place
 * that belongs to neither.
 */

// ---------------------------------------------------------------------------
// slots
// ---------------------------------------------------------------------------

const slots = new Map<DemoSpec, HTMLElement>()

export function registerSlot(demo: DemoSpec, element: HTMLElement | null): void {
  if (element) {
    if (slots.get(demo) === element) return
    slots.set(demo, element)
  } else if (!slots.delete(demo)) {
    return
  }
  publish()
}

export function getSlot(demo: DemoSpec | null | undefined): HTMLElement | null {
  return demo ? slots.get(demo) ?? null : null
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export type DemoStatus = {
  health: AppHealth
  /** True when every embed should be a still: `?stills=1`, `S`, a dead origin. */
  showStill: boolean
  /** What the lamp in the title bar reads. Also its class suffix. */
  label: 'live' | 'connecting' | 'stills' | 'app not running' | 'no seeded session'
  /** The session id the case route is actually using, pinned or resolved. */
  sessionId: string
  /**
   * The one-question autoplay case. May differ from the pin in `demo.config.ts`
   * when that id 404s and preflight finds a live replacement.
   */
  soloSessionId: string
  /**
   * Bumped when the deck signs this browser profile in during preflight.
   *
   * The stage watches it because of a race it would otherwise lose: on a cold
   * profile the warm iframe can load *before* the session cookie exists, land on
   * `/login`, and stay there, since the URL it was asked for never changed. A
   * changed epoch means "the same URL will answer differently now — load it
   * again". Zero when the profile was already signed in, which is the usual case
   * and costs nothing.
   */
  authEpoch: number
}

const INITIAL: DemoStatus = {
  health: 'checking',
  showStill: false,
  label: 'connecting',
  sessionId: '',
  soloSessionId: '',
  authEpoch: 0,
}

let status: DemoStatus = INITIAL

export function setStatus(next: Partial<DemoStatus>): void {
  const merged = { ...status, ...next }
  if (
    merged.health === status.health
    && merged.showStill === status.showStill
    && merged.label === status.label
    && merged.sessionId === status.sessionId
    && merged.soloSessionId === status.soloSessionId
    && merged.authEpoch === status.authEpoch
  ) return
  status = merged
  publish()
}

export function getStatus(): DemoStatus {
  return status
}

// ---------------------------------------------------------------------------
// subscription
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>()
/** One counter for both halves. `useSyncExternalStore` wants a primitive. */
let version = 0

function publish() {
  version += 1
  for (const listener of listeners) listener()
}

export function subscribeRuntime(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function runtimeVersion(): number {
  return version
}

// ---------------------------------------------------------------------------
// the one toggled demo
// ---------------------------------------------------------------------------

/**
 * Which demo slides are currently showing their toggled-to state.
 *
 * Keyed by the `DemoSpec` object, for the same reason the slot map is: the two
 * ends that need this answer are `demo-frame.tsx`, which paints the still, and
 * `demo-stage.tsx`, which navigates the embed, and the spec is the only identity
 * they already share. Module state rather than React state because those two
 * ends sit on opposite sides of a component tree neither of them owns — the same
 * argument the file header makes about the slot map and the status.
 *
 * A `Set` rather than a boolean, even though exactly one slide has a `toggle`
 * today: the alternative is a single global flag that would leak across slides
 * the moment a second one ever gets a toggle, and that class of bug is
 * invisible until it is on a projector.
 */
const toggled = new Set<DemoSpec>()

export function isToggled(demo: DemoSpec | null | undefined): boolean {
  return Boolean(demo && toggled.has(demo))
}

/** Flip a demo between its two states. Reversible, so a mis-press is recoverable. */
export function toggleDemo(demo: DemoSpec): void {
  if (!demo.toggle) return
  if (!toggled.delete(demo)) toggled.add(demo)
  publish()
}

/**
 * Put a demo back to its "before" state, called when its slide is left.
 *
 * This is the difference between a toggle that works once and one that works in
 * rehearsal. Without it the flag survives the slide: stepping back to
 * `demo-office-transformation`, or reaching it a second time in a run-through,
 * would open on the tier-14 office and the presenter would toggle *to the shack*
 * — the money shot played backwards, silently, with nothing on screen admitting
 * it. The slide's whole argument is the direction of travel.
 */
export function resetToggle(demo: DemoSpec | null | undefined): void {
  if (demo && toggled.delete(demo)) publish()
}

/**
 * The route and still a demo is showing right now, after the toggle.
 *
 * Everything that needs to know what is on screen goes through here — the frame's
 * title bar, the still it paints, the stage's navigation, `L`, and the presenter
 * overlay — so none of them can disagree about which of the two states the slide
 * is in. That mattered enough to centralise: `demo-focus-mode` once painted a
 * still captured at one route under a title bar naming another, and this slide
 * has two of each.
 */
export function activeState(demo: DemoSpec): { route: string; still: string } {
  return isToggled(demo) && demo.toggle
    ? { route: demo.toggle.route, still: demo.toggle.still }
    : { route: demo.route, still: demo.still }
}

// ---------------------------------------------------------------------------
// presenter-only chrome
// ---------------------------------------------------------------------------

/**
 * Whether to draw the affordances that exist for the presenter rather than the
 * audience — the live/still lamp and the demo budget bar.
 *
 * Off by default, opt in with `?hud`, which is the flag the debug HUD already
 * uses (`engine/use-deck.ts`). Same reasoning as that decision: anything shown
 * by default is shown in every screenshot and, eventually, in front of a room.
 * A status lamp reading "stills" is honest but it is operational metadata, and
 * on a projector it reads as a debug affordance rather than as design.
 *
 * Read once at module load rather than through the deck's hook, because the
 * demo chrome is rendered deep inside the narrative's slide layouts and the
 * value cannot change without a reload. The presenter does not lose the signal:
 * the presenter view (`P`) reports it, and that screen is not the projected one.
 */
export const presenterChrome = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('hud')

// ---------------------------------------------------------------------------
// route placeholders
// ---------------------------------------------------------------------------

/**
 * Fill a slide's route placeholders.
 *
 * `{session}` is the open case the presenter answers in, resolved at runtime by
 * preflight so a stale pinned id cannot reach the stage. `{verdictSession}` is
 * the pre-graded twin whose stored coaching makes the verdict beat instant; it
 * comes from config because it is written by the same command that grades it.
 * `{verdictSession}` cannot match the `{session}` pattern, so order is
 * irrelevant — but both live here so the stage and the frame chrome can never
 * disagree about the URL they claim to be showing.
 *
 * `{autoplay}` and `{autoplayRun}` are whole routes rather than ids: a driven
 * session plus the credited answers it is driven with, which the app has no
 * other way to learn (the API omits them from every question it serves). They
 * expand last and expand to nothing else, so a slide is either one of them or
 * it is not.
 *
 * `{autoplay}` is the case demo — one question played end to end, approach
 * applied, reasoning shown, answer submitted, graded feedback revealed.
 * `{autoplayRun}` is the fifteen-question volume run, kept because it works and
 * costs nothing to keep. Nothing asks for it.
 *
 * When a run has not been staged it falls back to the ordinary live case. A
 * slide that asked to play itself and instead sits on a real case the presenter
 * can answer by hand has lost a flourish; the same slide framing a URL with an
 * empty session id would show the room an error page.
 */
export function resolveRoute(route: string, sessionId: string): string {
  const solo = getStatus().soloSessionId || sessionOverlay.soloSessionId
  return route
    .replace('{session}', sessionId)
    .replace('{verdictSession}', sessionOverlay.verdictSessionId)
    .replace('{autoplayRun}', drivenRoute(sessionOverlay.autoplaySessionId, sessionOverlay.autoplayAnswerKey, sessionId))
    .replace('{autoplay}', drivenRoute(solo, sessionOverlay.soloAnswerKey, sessionId))
}

function drivenRoute(driven: string, answers: string, fallback: string): string {
  if (!driven || !answers) return `/cases/${fallback}`
  const pitch = answers.length === 1 ? '&autoplayScene=pitch' : ''
  return `/cases/${driven}?autoplay=${encodeURIComponent(answers)}${pitch}`
}

/** What a demo slide is actually going to show, right now. */
export type DemoSurface = {
  /** The still is painted and the live embed is not placed over this slot. */
  showStill: boolean
  /** Operational status, for presenter-facing surfaces only. */
  label: 'live' | 'connecting' | 'stills' | 'app not running' | 'no seeded session'
  /** The route with placeholders filled from the resolved session. */
  route: string
  /**
   * What the *room* is shown in the title bar. Not `route`, and the difference
   * is not cosmetic on one slide.
   *
   * `route` is a real URL against a dev server and it was printed verbatim, so
   * the audience read `localhost:5174` on all six demo slides — and, on the
   * centrepiece, `?autoplay=C`: the credited answer to the question they were
   * about to watch the app reason its way to, on screen for the whole beat,
   * above the app pretending not to know it. Query strings are dropped whole
   * rather than filtered, because there is no version of that rule with an
   * exception in it that stays right. `?officeTier=14&officeAll=1` goes the
   * same way and for the same reason: it says the firm was forced with a URL,
   * on the slide whose argument is that the firm was earned.
   */
  caption: string
  /**
   * The still to paint, which is not always `demo.still`: a toggled slide has a
   * second one. Returned from here rather than read off the spec by whoever is
   * painting, so the picture and the route in the title bar above it are decided
   * in the same place and cannot describe different states.
   */
  still: string
  /** True when this slide is showing its toggled-to state. Presenter-facing only. */
  toggled: boolean
}

/**
 * The title bar's text: the product where the dev origin was, and the path
 * without its query.
 *
 * `displayOrigin` is joined straight onto the path when it looks like a host,
 * so a real domain reads as one URL, and separated when it has a space in it,
 * because the default is the product's name and `Lawyer Tycoon/cases` is not a
 * thing anyone would write.
 */
function captionFor(route: string): string {
  // Session ids are `uuid.uuid4()`, so leaving them in prints 36 characters of
  // hex on the projector under a title bar whose whole job is to read as the
  // product. The path segment they sit in is the part that means anything.
  const path = route
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
  const origin = demoConfig.displayOrigin
  if (!origin) return path || '/'
  return /\s/.test(origin) ? `${origin} · ${path}` : `${origin}${path}`
}

/**
 * Decide, for one demo slide, whether the room is about to see the running app
 * or a photograph of it.
 *
 * Lives here rather than in the frame that draws it because two surfaces need
 * the same answer and must not be able to disagree: the frame, which paints the
 * still, and the presenter view, which is where the presenter learns which of
 * the two they are narrating over now that the lamp is off by default. When
 * those were computed separately the presenter's copy said `stills off` while
 * the slide showed a still, which is the exact confusion the lamp existed to
 * prevent.
 */
export function describeSurface(demo: DemoSpec, forceStills: boolean): DemoSurface {
  const status = getStatus()
  const sessionId = status.sessionId || demoConfig.liveSessionId
  const state = activeState(demo)
  const sessionMissing = state.route.includes('{session}') && !sessionId
  const pinnedToStill = forceStills || demoConfig.useStills || demo.stillOnly

  return {
    showStill: pinnedToStill || sessionMissing || status.health === 'unreachable',
    label: sessionMissing
      ? 'no seeded session'
      : pinnedToStill
        ? 'stills'
        : status.health === 'live'
          ? 'live'
          : status.health === 'checking'
            ? 'connecting'
            : 'app not running',
    route: resolveRoute(state.route, sessionId),
    caption: captionFor(resolveRoute(state.route, sessionId)),
    still: state.still,
    toggled: isToggled(demo),
  }
}
