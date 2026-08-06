import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * One owner for the fact "a blocking, full-screen layer is on the page".
 *
 * Several unrelated systems each want the whole viewport: first-use orientation,
 * a story chapter cutscene, and (next) the tier-up chapter prompt. Two of them at
 * once means two click-catchers and two focus traps fighting over the same
 * pixels, which reads as a soft-lock until the player refreshes. Tuning z-index
 * only decides which one is on top — both still swallow clicks. So every such
 * layer declares itself here and exactly one, the highest priority currently
 * asking, is allowed to render.
 *
 * TO REGISTER A NEW OVERLAY:
 *   1. Add a key to OVERLAY_PRIORITY below with a priority. Higher wins; leave
 *      gaps between numbers so a later layer can slot in between.
 *   2. In the component, call `useBlockingOverlay('your-key', shouldBeVisible, dismiss)`
 *      and return null when it returns false. `dismiss` is what Escape should do
 *      (see "ESCAPE" below); omit it only for a layer that must not be escapable.
 *   3. Decide where the dismissal is remembered (see "PERSISTENCE POLICY" below)
 *      and write it there in the same handler.
 * Nothing else changes. A layer that loses only yields — it reappears on its own
 * the moment the layer above it closes, because `shouldBeVisible` is still true.
 *
 * ESCAPE
 * Every blocking layer is closable with Escape, and exactly one — the layer that
 * currently owns the screen — reacts to a given press. The listener lives here
 * rather than in each layer because the layers do not know about each other: two
 * of them listening at once closed both, and a layer that forgot to listen (the
 * story cutscene, the one full-screen layer a player is most likely to want out
 * of) left no keyboard way out at all.
 *
 * PERSISTENCE POLICY — where a dismissal is remembered
 * The rule is that the storage matches the lifetime of the fact:
 *   - Once-per-account, "never show me this again anywhere" acknowledgements go
 *     to the server, because the player's expectation is about the account, not
 *     about the browser. Clearing site data or opening a second device must not
 *     re-block server-persisted progress. That is the guided tour
 *     (`users.guided_tour_completed_at`) and the epilogue
 *     (`player_story_states.epilogue_read_at`).
 *   - "Not right now" deferrals of something that is still genuinely pending go
 *     to localStorage, keyed by the pending thing. The authority for whether the
 *     chapter still needs a decision is the server; the local note only records
 *     that this player has already declined to be interrupted by it, and it is
 *     cleared the moment they ask for the chapter themselves.
 *   - At-most-once-a-day greetings go to localStorage, date-stamped, and record
 *     *two* facts: that the greeting is owed, and that it has actually been
 *     shown. Collapsing those into one marker is what let the daily streak
 *     greeting be consumed by an instance that never rendered it.
 * Nothing here is allowed to be "dismissed in React state only": every blocking
 * layer is mounted under a route element, so it remounts on every navigation and
 * in-memory dismissal survives roughly one click.
 */
export const OVERLAY_PRIORITY = {
  /**
   * First-use orientation. Outranks the story because a player who does not know
   * what the screens are yet should not simultaneously be handed a plot decision.
   */
  'guided-tour': 300,
  /**
   * The ending record. Outranks a chapter because reaching it means there is no
   * chapter left to play, and it is read once.
   */
  epilogue: 250,
  /**
   * A story chapter awaiting a decision. Safe to defer: the pending chapter is
   * server state, so it is still there after the layer above it closes.
   */
  'story-cutscene': 200,
  /**
   * The "you kept your streak alive" nudge. Sits below every other layer: a
   * brand-new player should be oriented by the tour rather than congratulated,
   * and an earned chapter or the once-ever epilogue are each the bigger moment
   * when they also want the screen. Losing here only defers it — the same
   * `daily_streak` bump that asked for it is still there once the layer above
   * closes, so a returning player who is not mid-tour or mid-chapter still
   * sees it promptly.
   */
  'streak-welcome': 150,
} as const

export type OverlayKey = keyof typeof OVERLAY_PRIORITY

/**
 * The shell's slot for chrome that is *not* a blocking overlay but still comes
 * from outside the page — currently only the waiting-chapter prompt.
 *
 * It exists because "float it in the corner" is not free: a 370×197 fixed card
 * bottom-right sat on top of a dashboard metric card, and a fixed element
 * cannot be made to stop covering content by reserving space at the end of the
 * document. Rendered into this slot the prompt is in normal flow under the
 * header, so it pushes the page down instead of landing on it, and no hit test
 * can find it in front of anything interactive.
 *
 * `AppShell` renders the slot; the narrative layer portals into it, which keeps
 * that layer one self-contained module rather than a prop threaded through the
 * shell.
 */
export const CHAPTER_DOCK_ID = 'chapter-dock'

type OverlayRegistry = {
  /** `dismiss` reports whether it actually handled the request. */
  claim: (key: OverlayKey, dismiss: () => boolean) => void
  release: (key: OverlayKey) => void
  top: OverlayKey | null
}

const OverlayContext = createContext<OverlayRegistry | null>(null)

export function BlockingOverlayProvider({ children }: { children: React.ReactNode }) {
  const [claims, setClaims] = useState<OverlayKey[]>([])
  // Dismiss handlers are a ref, not state: they change identity on every render
  // of the claiming layer, and re-rendering the whole app underneath because a
  // callback was recreated would be a needless cost for something only a key
  // press ever reads.
  const dismissers = useRef(new Map<OverlayKey, () => boolean>())
  const claim = useCallback((key: OverlayKey, dismiss: () => boolean) => {
    dismissers.current.set(key, dismiss)
    setClaims((current) => (current.includes(key) ? current : [...current, key]))
  }, [])
  const release = useCallback((key: OverlayKey) => {
    dismissers.current.delete(key)
    setClaims((current) => current.filter((entry) => entry !== key))
  }, [])
  const top = claims.reduce<OverlayKey | null>(
    (best, key) => (best === null || OVERLAY_PRIORITY[key] > OVERLAY_PRIORITY[best] ? key : best),
    null,
  )
  // Scroll locking belongs to whoever owns "something is blocking the page",
  // rather than to each layer separately, so it cannot be leaked or double-applied.
  useEffect(() => {
    if (!top) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [top])
  // Escape closes the layer that owns the screen, and only that one. A layer
  // that registered no handler (it wants Escape for itself, or it is genuinely
  // not dismissable) simply gets nothing from here.
  useEffect(() => {
    if (!top) return
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const dismiss = dismissers.current.get(top)
      if (!dismiss || !dismiss()) return
      event.preventDefault()
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [top])
  const registry = useMemo(() => ({ claim, release, top }), [claim, release, top])
  return <OverlayContext.Provider value={registry}>{children}</OverlayContext.Provider>
}

/**
 * Declare that this component wants the whole screen. Returns whether it is the
 * layer allowed to render right now.
 *
 * `dismiss` is invoked when the player presses Escape while this layer owns the
 * screen. It should do exactly what the layer's own visible close control does,
 * *including* persisting the dismissal — an Escape that only flips React state
 * is undone by the next navigation.
 */
export function useBlockingOverlay(key: OverlayKey, wanted: boolean, dismiss?: () => void) {
  const registry = useContext(OverlayContext)
  // Registered once per claim, but always calls the current render's handler.
  const latestDismiss = useRef(dismiss)
  latestDismiss.current = dismiss
  useEffect(() => {
    if (!registry || !wanted) return
    registry.claim(key, () => {
      if (!latestDismiss.current) return false
      latestDismiss.current()
      return true
    })
    return () => registry.release(key)
  }, [key, registry, wanted])
  // Rendered outside the provider (a test harness, a standalone story) the layer
  // is on its own and should behave exactly as it did before this existed.
  if (!registry) return wanted
  return wanted && registry.top === key
}

/**
 * Read-only: which blocking layer owns the screen right now, or null.
 *
 * For chrome that does not itself block — a corner prompt, a badge, a toast —
 * and should simply stay quiet while a modal is up rather than compete with it.
 */
export function useTopOverlay() {
  return useContext(OverlayContext)?.top ?? null
}

/**
 * The browser-local half of the persistence policy documented at the top of
 * this file.
 *
 * Every caller goes through here rather than touching `localStorage` directly,
 * for two reasons: the keys stay listed in one place next to the policy that
 * explains which of them are allowed to be browser-local at all, and a browser
 * that refuses storage (Safari's private mode throws on write, some enterprise
 * profiles throw on read) degrades to "nothing was remembered" instead of
 * taking the whole narrative layer down with an uncaught exception.
 */
export function readOverlayNote(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeOverlayNote(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // A player who cannot be remembered is shown the layer again; that is the
    // correct fallback, and it is not worth an error boundary.
  }
}

export function clearOverlayNote(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // See above.
  }
}
