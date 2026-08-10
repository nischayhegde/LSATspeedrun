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
}

const INITIAL: DemoStatus = {
  health: 'checking',
  showStill: false,
  label: 'connecting',
  sessionId: '',
}

let status: DemoStatus = INITIAL

export function setStatus(next: Partial<DemoStatus>): void {
  const merged = { ...status, ...next }
  if (
    merged.health === status.health
    && merged.showStill === status.showStill
    && merged.label === status.label
    && merged.sessionId === status.sessionId
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
 */
export function resolveRoute(route: string, sessionId: string): string {
  return route
    .replace('{session}', sessionId)
    .replace('{verdictSession}', demoConfig.verdictSessionId)
}
