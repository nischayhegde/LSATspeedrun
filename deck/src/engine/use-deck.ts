import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { SceneId, SlideSpec, TransitionKind } from '../slides/types'
import { sceneIsMounted, stageSceneFor } from '../scenes/registry'
import type { DeckStage } from '../scenes/stage'
import { runTransition, transitionBlendsScene, type RunningTransition } from './transitions'

/**
 * The deck runtime: which slide is on screen, how the last one left, and what the
 * stage and the mounted app scenes should be doing about it.
 *
 * ## The two-layer pool
 *
 * A transition needs both slides in the document at once, so the deck renders
 * exactly two slide layers and alternates which one is live. On a navigation the
 * incoming slide is put into whichever layer is *not* live, that layer becomes
 * live, and a transition is run between the two elements. When it finishes the
 * other layer is emptied.
 *
 * Two layers is enough even under arbitrarily fast input, and that is a
 * consequence of `finish()` rather than luck: a navigation arriving mid-transition
 * ends the one in flight instantly, which means the slide it was leaving is
 * already gone and its layer is free to take the new arrival. There is never a
 * third slide that still needs to be on screen. This is the property that makes
 * arrow-key mashing safe.
 *
 * ## Why the stage is not React state
 *
 * The WebGL stage is imperative and long-lived, and it renders on its own
 * `requestAnimationFrame` loop that has nothing to do with React's commit
 * schedule. Driving it from an effect that reacts to a state change would put a
 * scene swap one commit behind the DOM transition it is supposed to be part of.
 * So the runtime calls it directly, in the same turn as the navigation.
 */

export type DeckLayers = {
  a: number | null
  b: number | null
  live: 'a' | 'b'
}

export type DeckController = {
  slides: readonly SlideSpec[]
  /** Index of the slide that should be read as current. */
  index: number
  current: SlideSpec
  layers: DeckLayers
  /** Which layer element each index is in, for the transition to address. */
  registerLayer: (key: 'a' | 'b', element: HTMLDivElement | null) => void
  overlayRef: (element: HTMLDivElement | null) => void
  next: () => void
  previous: () => void
  goto: (target: number | string, options?: { push?: boolean }) => void
  /** True while a transition is in flight. */
  moving: boolean

  gridOpen: boolean
  toggleGrid: () => void
  /** The Q&A ammunition panel, opened with `Q`. Presenter-only, never projected. */
  qaOpen: boolean
  toggleQa: () => void
  presenterOpen: boolean
  togglePresenter: () => void
  hudOpen: boolean

  /** Global "every demo shows a still" override. `?stills=1` or the `S` key. */
  stills: boolean
  toggleStills: () => void

  /** How many annotations of the current demo have been revealed. */
  annotations: number
  revealAnnotation: () => void

  /** Seconds since the talk started, or since the timer was reset with `R`. */
  elapsed: number
  resetTimer: () => void

  reduced: boolean
  appScenes: AppSceneSlot[]
}

export type AppSceneSlot = {
  /** Stable across a transition so React does not remount the canvas. */
  key: string
  scene: SceneId
  params: Record<string, string | number | boolean>
  role: 'current' | 'outgoing' | 'warm'
}

const FORWARD_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Enter'])
const BACKWARD_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'])

function readHash(slides: readonly SlideSpec[]): number {
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (!raw) return 0
  const bySlug = slides.findIndex((slide) => slide.id === raw)
  if (bySlug >= 0) return bySlug
  const asNumber = Number(raw)
  if (Number.isFinite(asNumber)) return Math.min(slides.length - 1, Math.max(0, Math.round(asNumber)))
  return 0
}

export function useDeck(slides: readonly SlideSpec[], stage: DeckStage | null): DeckController {
  const reduced = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const search = useMemo(() => new URLSearchParams(window.location.search), [])

  const [index, setIndex] = useState(() => readHash(slides))
  const [layers, setLayers] = useState<DeckLayers>(() => ({ a: readHash(slides), b: null, live: 'a' }))
  const [moving, setMoving] = useState(false)
  const [gridOpen, setGridOpen] = useState(false)
  const [qaOpen, setQaOpen] = useState(false)
  const [presenterOpen, setPresenterOpen] = useState(() => search.has('notes') || search.has('present'))
  const [stills, setStills] = useState(() => search.get('stills') === '1')
  const [annotations, setAnnotations] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [appScenes, setAppScenes] = useState<AppSceneSlot[]>([])

  const layerRefs = useRef<{ a: HTMLDivElement | null; b: HTMLDivElement | null }>({ a: null, b: null })
  const overlayEl = useRef<HTMLDivElement | null>(null)
  const running = useRef<RunningTransition | null>(null)
  const timerStart = useRef(Date.now())
  /** Bumped per navigation; the layout effect keys off it. */
  const navToken = useRef(0)
  /** What the pending layout effect should do. */
  const pending = useRef<{ token: number; from: 'a' | 'b' | null; to: 'a' | 'b'; kind: TransitionKind; direction: 1 | -1; fromIndex: number | null } | null>(null)

  // Opt-in only. It used to default on in development, which meant it was on
  // in every screenshot and would have been on in front of the room the first
  // time the deck was presented from a dev server. `?hud` turns it back on.
  const hudOpen = search.has('hud')

  const registerLayer = useCallback((key: 'a' | 'b', element: HTMLDivElement | null) => {
    layerRefs.current[key] = element
  }, [])
  const overlayRef = useCallback((element: HTMLDivElement | null) => {
    overlayEl.current = element
  }, [])

  /** Mounted-scene slots for a given current/outgoing pair. */
  const computeAppScenes = useCallback((currentIndex: number, outgoingIndex: number | null) => {
    const slots: AppSceneSlot[] = []
    const push = (slideIndex: number | null, role: AppSceneSlot['role']) => {
      if (slideIndex === null) return
      const slide = slides[slideIndex]
      const scene = slide?.scene
      if (!scene || !sceneIsMounted(scene.id)) return
      const key = `${scene.id}:${JSON.stringify(scene.params ?? {})}`
      if (slots.some((slot) => slot.key === key)) return
      slots.push({ key, scene: scene.id, params: scene.params ?? {}, role })
    }
    push(currentIndex, 'current')
    push(outgoingIndex, 'outgoing')
    // Warm the neighbour ahead. A ported app scene takes a few hundred
    // milliseconds to construct its room, and paying that on a keystroke is the
    // one thing the deck must not do — so it is paid while the previous slide is
    // still being talked over. Capped at three slots, which is three WebGL
    // contexts plus the stage's own; well inside any browser's limit.
    if (slots.length < 3) push(currentIndex + 1, 'warm')
    if (slots.length < 3) push(currentIndex - 1, 'warm')
    return slots
  }, [slides])

  const goto = useCallback((target: number | string, options: { push?: boolean } = {}) => {
    const resolved = typeof target === 'number'
      ? target
      : slides.findIndex((slide) => slide.id === target)
    const clamped = Math.min(slides.length - 1, Math.max(0, resolved))
    if (clamped === index) return

    // Snap the transition in flight to its end state before starting another.
    // Synchronous, so by the time the state below is set the DOM is already
    // showing the finished result of the previous move.
    running.current?.finish()
    running.current = null

    const direction: 1 | -1 = clamped > index ? 1 : -1
    const slide = slides[clamped]
    const kind = slide.transition ?? 'cut'
    const from = layers.live
    const to: 'a' | 'b' = from === 'a' ? 'b' : 'a'

    navToken.current += 1
    pending.current = { token: navToken.current, from, to, kind, direction, fromIndex: index }

    setLayers({ ...layers, [to]: clamped, live: to } as DeckLayers)
    setIndex(clamped)
    setMoving(true)
    setAnnotations(0)
    setAppScenes(computeAppScenes(clamped, index))

    if (options.push !== false) {
      window.history.pushState({ slide: clamped }, '', `#/${slide.id}`)
    }
  }, [computeAppScenes, index, layers, slides])

  const next = useCallback(() => goto(index + 1), [goto, index])
  const previous = useCallback(() => goto(index - 1), [goto, index])

  // --- run the transition once the incoming layer is in the document ---------
  useLayoutEffect(() => {
    const job = pending.current
    if (!job || job.token !== navToken.current) return
    pending.current = null

    const to = layerRefs.current[job.to]
    const from = job.from ? layerRefs.current[job.from] : null
    const overlay = overlayEl.current
    if (!to || !overlay) return

    const slide = slides[index]

    // The stage moves in the same turn as the DOM. `camera` shows its work by
    // sharing a scene, so `stage.show` recognises the same id and tweens rather
    // than blending; everything else gets the ink field.
    if (stage) {
      const stageScene = stageSceneFor(slide.scene?.id)
      // Alternate the wash direction so two ink dissolves in a row are not the
      // same picture twice.
      stage.setDissolveDirection(job.direction > 0 ? 1 : -1, index % 2 ? .38 : -.3)
      void stage.show(stageScene, slide.scene?.framing, slide.scene?.params, transitionBlendsScene(job.kind))
    }

    const transition = runTransition(job.kind, {
      from,
      to,
      direction: job.direction,
      overlay,
      reduced,
      onMidpoint: () => {
        // The outgoing app scene is released here rather than on completion: it
        // is the heaviest thing in the deck and the moment it stops being
        // visible is the moment to stop paying for it.
        setAppScenes(computeAppScenes(index, null))
      },
    })
    running.current = transition

    let cancelled = false
    void transition.done.then(() => {
      if (cancelled) return
      running.current = null
      setMoving(false)
      // Empty the layer the outgoing slide was in, so only one slide's DOM — and
      // in particular only one slide's demo iframe — is alive at rest.
      setLayers((previousLayers) => (
        job.from && previousLayers.live !== job.from
          ? { ...previousLayers, [job.from]: null } as DeckLayers
          : previousLayers
      ))
    })
    return () => { cancelled = true }
    // `index` is the trigger; the rest are stable or read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  // --- first paint ----------------------------------------------------------
  useEffect(() => {
    if (!stage) return
    const slide = slides[index]
    void stage.show(stageSceneFor(slide.scene?.id), slide.scene?.framing, slide.scene?.params, 'none')
    setAppScenes(computeAppScenes(index, null))
    stage.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  // --- warm the neighbours --------------------------------------------------
  useEffect(() => {
    if (!stage) return
    for (const offset of [1, -1, 2]) {
      const slide = slides[index + offset]
      if (!slide) continue
      void stage.warm(stageSceneFor(slide.scene?.id))
    }
  }, [index, slides, stage])

  // --- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never swallow a key the presenter is typing into something.
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (FORWARD_KEYS.has(event.key)) { event.preventDefault(); next(); return }
      if (BACKWARD_KEYS.has(event.key)) { event.preventDefault(); previous(); return }

      switch (event.key.toLowerCase()) {
        case 'home': event.preventDefault(); goto(0); return
        case 'end': event.preventDefault(); goto(slides.length - 1); return
        case 'g': event.preventDefault(); setGridOpen((open) => !open); return
        // Q&A ammunition. Reachable from anywhere rather than only from the
        // presenter overlay, because the moment it is wanted is the moment a
        // question has just been asked and the deck is sitting on slide 23.
        case 'q': event.preventDefault(); setQaOpen((open) => !open); return
        case 'p': event.preventDefault(); setPresenterOpen((open) => !open); return
        case 's': event.preventDefault(); setStills((on) => !on); return
        case 'a': event.preventDefault(); setAnnotations((count) => count + 1); return
        case 'r': event.preventDefault(); timerStart.current = Date.now(); setElapsed(0); return
        case 'f':
          event.preventDefault()
          if (document.fullscreenElement) void document.exitFullscreen()
          else void document.documentElement.requestFullscreen().catch(() => undefined)
          return
        case 'escape':
          event.preventDefault()
          setGridOpen(false)
          setPresenterOpen(false)
          setQaOpen(false)
          return
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goto, next, previous, slides.length])

  // --- browser back / forward ----------------------------------------------
  useEffect(() => {
    const onPop = () => goto(readHash(slides), { push: false })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [goto, slides])

  // --- the presenter clock -------------------------------------------------
  //
  // Only while somebody is looking at it. `elapsed` has exactly one reader, the
  // presenter overlay, and it is a piece of *state on the root component* — so
  // running the interval unconditionally re-rendered the entire deck once a
  // second for the length of the talk: both slide layers, every figure, the
  // demo stage, the app-scene layer and twenty-four progress ticks, to move a
  // number nobody had asked to see. React bails out of nothing here, because
  // the layers are rebuilt inline in `deck.tsx` rather than memoised.
  //
  // It is also a clock rather than an accumulator — the elapsed value is
  // computed from `timerStart`, not counted up — so nothing is lost by not
  // running it. Reopening the overlay reads the true time immediately, which
  // is why the first read is taken before the interval rather than a second
  // later.
  useEffect(() => {
    if (!presenterOpen) return
    const read = () => setElapsed(Math.floor((Date.now() - timerStart.current) / 1000))
    read()
    const tick = window.setInterval(read, 1000)
    return () => window.clearInterval(tick)
  }, [presenterOpen])

  // --- the URL on first load ----------------------------------------------
  useEffect(() => {
    if (window.location.hash) return
    window.history.replaceState({ slide: index }, '', `#/${slides[index].id}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    slides,
    index,
    current: slides[index],
    layers,
    registerLayer,
    overlayRef,
    next,
    previous,
    goto,
    moving,
    gridOpen,
    toggleGrid: useCallback(() => setGridOpen((open) => !open), []),
    qaOpen,
    toggleQa: useCallback(() => setQaOpen((open) => !open), []),
    presenterOpen,
    togglePresenter: useCallback(() => setPresenterOpen((open) => !open), []),
    hudOpen,
    stills,
    toggleStills: useCallback(() => setStills((on) => !on), []),
    annotations,
    revealAnnotation: useCallback(() => setAnnotations((count) => count + 1), []),
    elapsed,
    resetTimer: useCallback(() => { timerStart.current = Date.now(); setElapsed(0) }, []),
    reduced,
    appScenes,
  }
}

/**
 * FAST REFRESH: RELOAD RATHER THAN PATCH THIS MODULE.
 *
 * The same defect `figures/kit.tsx` carries, and for the same structural
 * reason: this file exports a hook and no component, so it is not a Fast
 * Refresh boundary. Vite propagates an edit here into `deck.tsx`, and React
 * Refresh re-renders `Deck` **in place** — it decides whether to remount by
 * comparing a signature recorded at the component's own definition site, and
 * that signature names `useDeck` without describing it. Change the hook order
 * inside `useDeck` and `Deck`'s signature is still byte-identical: nothing
 * remounts, and the next render walks a hook queue built by the previous
 * version of this module.
 *
 * It is the worse of the two instances. `kit.tsx` can only desynchronise a
 * figure, so the damage is bounded by the sixteen slides that draw one; `Deck`
 * is mounted for the whole run, so a stale queue here can surface on *any*
 * slide. That is the most likely explanation for a hooks-order error that was
 * reported against a different slide on each sweep and never reproduced from a
 * cold load — it depended only on which slide happened to be on screen when
 * somebody saved this file.
 *
 * Editing `deck.tsx` directly is safe, because the signature is recomputed
 * there. Only a shared hook module consumed across a boundary can drift.
 *
 * `import.meta.hot` is undefined in a production build and this is dropped, so
 * a built deck never sees it.
 */
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload())
}
