import { demoConfig } from '../../demo.config'
import type { DemoSpec } from '../slides/types'
import type { AppHealth } from './health'

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
// route placeholders
// ---------------------------------------------------------------------------

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
 * `{autoplay}` is a whole route rather than an id: the fifteen-question run the
 * app drives itself through, plus the credited answers it is driven with, which
 * the app has no other way to learn (the API omits them from every question it
 * serves). It expands last and expands to nothing else, so a slide is either
 * `{autoplay}` or it is not.
 *
 * When that run has not been staged it falls back to the ordinary live case.
 * A slide that asked to play itself and instead sits on a real case the
 * presenter can answer by hand has lost a flourish; the same slide framing a
 * URL with an empty session id would show the room an error page.
 */
export function resolveRoute(route: string, sessionId: string): string {
  return route
    .replace('{session}', sessionId)
    .replace('{verdictSession}', demoConfig.verdictSessionId)
    .replace('{autoplay}', autoplayRoute(sessionId))
}

function autoplayRoute(sessionId: string): string {
  const { autoplaySessionId, autoplayAnswerKey } = demoConfig
  if (!autoplaySessionId || !autoplayAnswerKey) return `/cases/${sessionId}`
  return `/cases/${autoplaySessionId}?autoplay=${encodeURIComponent(autoplayAnswerKey)}`
}

/** What a demo slide is actually going to show, right now. */
export type DemoSurface = {
  /** The still is painted and the live embed is not placed over this slot. */
  showStill: boolean
  /** Operational status, for presenter-facing surfaces only. */
  label: 'live' | 'connecting' | 'stills' | 'app not running' | 'no seeded session'
  /** The route with placeholders filled from the resolved session. */
  route: string
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
  const sessionMissing = demo.route.includes('{session}') && !sessionId
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
    route: resolveRoute(demo.route, sessionId),
  }
}
