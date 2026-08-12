import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { demoConfig } from '../../demo.config'
import { TRANSITION_MS } from '../engine/transitions'
import type { DemoSpec, SlideSpec } from '../slides/types'
import {
  activeState,
  getSlot,
  getStatus,
  isToggled,
  resetToggle,
  resolveRoute,
  runtimeVersion,
  setStatus,
  subscribeRuntime,
  toggleDemo,
} from './demo-runtime'
import { probeApp } from './health'
import './demo-stage.css'

/**
 * One live embed of the product, for the whole deck.
 *
 * ## The defect this exists to fix
 *
 * Slides 12, 13 and 14 are authored as a single continuous shot: answer a case,
 * submit the reasoning, read the verdict, then watch that same question turn up
 * in the dashboard's review queue. That only works if it is the same session of
 * the same running app throughout.
 *
 * It was not. Every slide rendered its own `<iframe>` inside its own slide layer,
 * and `use-deck.ts` empties the outgoing layer when a transition completes — so
 * advancing from 12 to 13 destroyed the frame the presenter had just answered a
 * question in and loaded the app again from cold. The answered question, the
 * verdict and the coaching panel all went with it, and there was no way back:
 * the left arrow reloaded the case from the top.
 *
 * ## What replaces it
 *
 * The embed is hoisted out of the slide layers entirely and lives here, mounted
 * once from `deck.tsx`, positioned over whichever slide's screen slot is live.
 * A *run* of consecutive demo slides shares one iframe element that is never
 * unmounted, so crossing 12 → 13 → 14 changes nothing about the frame at all:
 * no load, no flash, no lost state. The frame is torn down when the run ends,
 * which is the first non-demo slide in either direction.
 *
 * ## What advancing inside a run does to the frame, and why
 *
 * Nothing, unless the slide asks for something else. The policy, in order:
 *
 *   1. **A new run** — the previous live slide had no demo. Mount a fresh frame
 *      at this slide's route. React remounts it because `runId` changed.
 *   2. **`continuesFrom` names the slide we just left** — leave the frame
 *      completely alone. This is slide 13, whose route is `/progress` while slide
 *      12's is `/cases/{id}`: the narrative has the presenter click *Dashboard in
 *      the app's own nav bar* while still on slide 12, so by the time the slide
 *      advances the app has already navigated itself, client-side, with its state
 *      intact. Loading `/progress` here would undo exactly that.
 *   3. **Same URL as the frame was last given** — leave it alone. This is 13 → 14,
 *      both `/progress`, and it is also what makes going *backwards* free.
 *   4. **Anything else** — set `src`, which navigates the existing element. This
 *      is 18 → 19, `/office` → `/office?officeTier=0`: a DEV query parameter is
 *      not reachable by clicking, so it has to be a load. The element, and
 *      therefore the app's cookies and its HTTP cache, survive.
 *
 * Rule 3 has one consequence worth knowing on stage: if the presenter navigated
 * inside the frame and then goes back a slide, the frame stays where they left it
 * rather than snapping to the route the slide names. That is the right default —
 * it is never destructive — and `L` reloads the current slide's route when it is
 * not.
 *
 * A slide with a `toggle` reaches rule 4 without the slide changing: the toggle
 * flips which route the slide is asking for, and the policy then performs the
 * navigation it already knew how to perform. Nothing here is special-cased for
 * it, which is deliberate — the toggle is one slide's editorial decision and this
 * file should not grow a mode for it.
 *
 * ## Where it sits
 *
 * `position: fixed` at the live slot's measured rect, under the transition's
 * letterbox bars and under the grain and scanlines, and on one of two sides of
 * the slide layers depending on the slide: z-index 4 for a demo framed inside a
 * slide's own chrome, and z-index 2 — below the layers — for the full-bleed demo
 * slides, where the app *is* the field and the layer above it holds nothing but a
 * plate of type. `data-under` carries which; `demo-stage.css` has the reasoning.
 *
 * The callouts moved up here with it, because they have to be over the frame and
 * the frame is now over the slide. They are still positioned in percentages of
 * the slot, so nothing about how they are authored changed.
 */

type Props = {
  slides: readonly SlideSpec[]
  index: number
  /** The deck-wide stills override: `?stills=1` or the `S` key. */
  stills: boolean
  annotations: number
  /** True while a transition is in flight. */
  moving: boolean
}

/**
 * The logical viewport width the app is laid out at before being scaled to fit.
 *
 * This one number decides how large the app's own text appears on the projector,
 * and it does so independently of the projector — which is worth spelling out,
 * because it is not obvious. The slot is sized in the deck's stage unit, so it is
 * always the same *fraction* of the projected image (0.57 of the width, here).
 * The composed scale is therefore `slotFraction × imageWidth / DEFAULT_WIDTH`, and
 * the app's 16px body text lands at
 *
 *     16 × 0.57 × (16/9) / DEFAULT_WIDTH
 *
 * of the projected image height at 1280x720, at 1920x1080 and at 3840x2160 alike.
 * Nothing about a room changes it. Only this constant does.
 *
 * It was 1440, which put the app's body text at 1.19% of the image height — under
 * half the 2.67% the deck's own body copy occupies, and a *reduction* rather than a
 * magnification: the app was being rendered at 1358 logical pixels into a 1094px
 * hole, so every glyph came out smaller than it would on a laptop. Measured on a
 * 720p projector that is 8.6px of x-height-and-all, which is not readable from the
 * fourth row, and "the iframes should be properly sized" is mostly this.
 *
 * 1150 puts it at 1.49%, which is a magnification of about 1.06 for the common
 * `zoom: 1.06` slides rather than a reduction of 0.81 — a 25% increase in apparent
 * size. The limit on going further is that a narrower logical viewport reflows the
 * app, and eventually overflows it. Measured on 2026-08-10 across `/progress`,
 * `/office`, `/office?officeTier=0` and `/map`: no horizontal overflow at any
 * width down to 820px. At 1150 the most aggressive slide in the deck
 * (`zoom: 1.35`) lands at 852 logical pixels, which is inside that with margin.
 *
 * If the app grows a layout that needs more room, `scripts/verify-demo-sizing.mjs`
 * fails on the overflow invariant rather than on a screenshot, and
 * `--required` re-derives the floor.
 *
 * ## Why this is a cap and not just a default
 *
 * All seven demo slides in `slides/index.ts` pin `width: 1440` — the same value,
 * seven times, which is a field that was set once and copied rather than composed
 * per slide. Their `zoom` values are genuinely authored and do vary (1.06, 1.12,
 * 1.35). So the slide's `width` is honoured as an *upper bound* rather than as an
 * instruction: `zoom` keeps meaning exactly what it meant, and the base it
 * multiplies is capped at what is legible. A slide that deliberately asks for a
 * narrower viewport than this still gets it, because the cap is a `min`.
 *
 * ## Raised to 1400 when the demo slides went full-bleed
 *
 * Everything above was reasoned against a slot 1101px wide. Full-bleed made the
 * slot about 1610px, and at a 1150 cap the app was being rendered at 1027 logical
 * pixels and blown up 1.46x — which magnifies the type past the point of
 * usefulness and, worse, *shrinks what is on screen*: a 642px logical viewport
 * shows 39% of the case page's 1658px height, so the audience reads a third of the
 * thing being demonstrated.
 *
 * 1400 lands the scale near 1.15, still a magnification, while showing about half
 * the page. The rest is bought back by the autoplay driver scrolling the app to
 * whatever it is about to touch, which is a better answer than either number: the
 * audience sees the part that matters at the moment it matters.
 */
const LEGIBILITY_WIDTH = 1400
/** Used only when a slide names no width at all. */
const DEFAULT_WIDTH = 1400

/**
 * The shape the app is laid out at, which is now the shape of the hole rather
 * than a constant.
 *
 * This was `16 / 10`, and that one number was the letterbox. The frame is scaled
 * to *contain* — the app must never be cropped — so a logical box of one aspect
 * inside a slot of another leaves a band on two edges, and no amount of layout
 * work upstream can close it. Measured on the full-bleed slides before this
 * change, in stills mode at 1920x1080: the app occupied 77.2% of the viewport
 * height with 125px of black above it and 125px below. The founders' words were
 * "no vertical bars — have it take full viewport height."
 *
 * Deriving the logical height from the slot's own measured rect closes the band
 * arithmetically rather than by cropping or by zooming: both terms of the `min`
 * below become equal, so the frame lands exactly on the slot at every viewport
 * and every projector aspect. What changes for the app is the *shape* of the
 * viewport it is handed — 1250x703 rather than 1250x781 on a 16:9 screen — which
 * is a viewport it would meet on any laptop, and nothing about it is cut off.
 *
 * The clamp is for a slot nothing here anticipated. Below 1.2 the app would be
 * given a nearly square viewport, above 2.1 a letterbox slit; either is a shape
 * the app was not authored for, and a small band is better than a squashed
 * layout. Neither bound is reachable on any projector in the runbook — a 4:3
 * stage is 1.33 and an ultrawide is 2.39.
 */
const MIN_ASPECT = 1.2
const MAX_ASPECT = 2.1

/** How long after the last load to keep the cover up if `load` never fires. */
const COVER_TIMEOUT_MS = 6000

type Run = {
  /** Changes only when a genuinely new frame is wanted. It is the React key. */
  id: number
  /**
   * The frame's *initial* URL, and nothing else. Every later navigation is done
   * imperatively rather than by changing this, so that React never diffs `src`
   * and can never decide to reload the frame on its own.
   */
  src: string
}

function routeFor(demo: DemoSpec, sessionId: string): string {
  return resolveRoute(activeState(demo).route, sessionId)
}

export function DemoStage({ slides, index, stills, annotations, moving }: Props) {
  const version = useSyncExternalStore(subscribeRuntime, runtimeVersion)
  const status = getStatus()

  const slide = slides[index]
  const demo = slide?.demo
  /**
   * Whether this slide is showing its toggled-to state. Read through the runtime
   * rather than held here, because `demo-frame.tsx` paints the still off the same
   * answer and the two must not be able to disagree — and because it has to
   * survive this component re-rendering for any other reason.
   */
  const toggled = isToggled(demo)
  const sessionId = status.sessionId || demoConfig.liveSessionId
  const authEpoch = status.authEpoch
  /**
   * The epoch the frame's current contents were loaded under. Differs from
   * `authEpoch` only in the window between a cold iframe load and the preflight's
   * automatic sign-in landing, which is exactly when the frame is holding a login
   * screen that a reload will replace with the app.
   */
  const loadedUnderEpoch = useRef(authEpoch)
  const needsSession = Boolean(demo?.route.includes('{session}'))
  const sessionMissing = needsSession && !sessionId
  /**
   * Four independent reasons a demo slide shows its captured frame instead of
   * the app: the presenter's panic switch, the config-level dry-run flag, a
   * slide authored as a still (`stillOnly`), a missing seeded session, and an
   * app that is not answering.
   *
   * `stillOnly` has to be here and not only in `demo-frame.tsx`. The frame
   * withholds its slot for such a slide, which stops this stage from
   * *positioning* an embed — but without this clause the stage still considered
   * the slide live, navigated the surviving iframe to the slide's route, and,
   * because the positioning effect returns early when there is no slot, left
   * that iframe painted at the previous slide's rect. Measured before the fix:
   * the live `/progress` app sat pixel-for-pixel on top of the focus-mode
   * still, so `demo-focus-mode` showed the audience a dashboard. Correctness
   * that depends on an unrelated early return is correctness waiting to break.
   */
  const showStill = stills
    || demoConfig.useStills
    || Boolean(demo?.stillOnly)
    || sessionMissing
    || status.health === 'unreachable'

  const [run, setRun] = useState<Run | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const runCounter = useRef(0)
  /** Index of the previous *live* slide, demo or not. Drives the run policy. */
  const previousIndex = useRef<number | null>(null)
  /**
   * Whose slot to track. Held through the fade-out, since by then the slide layer
   * that owned it has been emptied by the runtime and the rect is frozen anyway.
   * Also the identity the callouts are read off.
   */
  const tracked = useRef<DemoSpec | null>(null)
  /**
   * Whether the slide the frame is serving is one of the full-bleed demo slides,
   * held through the fade-out for the same reason `tracked` is.
   *
   * It decides which side of the slide layers the embed sits on — see
   * `data-under` and the long note in `demo-stage.css`. A `split` slide that
   * carried a demo would be framed inside its own chrome, and that chrome is
   * opaque, so it keeps the embed above the layer exactly as before.
   */
  const trackedBleed = useRef(false)
  /**
   * Where we believe the frame currently is, which is not the same as what React
   * put in `src`: the presenter navigates inside it, and `continuesFrom` is the
   * slide saying so.
   */
  const believed = useRef('')

  // --- the single health probe, and the lamp -------------------------------
  // One probe for the whole deck rather than one per mounted slide: there is one
  // embed now, and two slides mid-transition must not disagree about whether the
  // app is up.
  useEffect(() => {
    if (demoConfig.useStills || stills) {
      setStatus({ showStill: true, label: 'stills' })
      return
    }
    let live = true
    void probeApp(demoConfig.appOrigin).then((health) => {
      if (!live) return
      setStatus({
        health,
        showStill: health === 'unreachable' || sessionMissing,
        label: sessionMissing
          ? 'no seeded session'
          : health === 'live' ? 'live' : health === 'checking' ? 'connecting' : 'app not running',
      })
    })
    return () => { live = false }
  }, [stills, sessionMissing, index])

  // --- the run policy ------------------------------------------------------
  useEffect(() => {
    const previous = previousIndex.current
    previousIndex.current = index
    const previousSlide = previous == null ? null : slides[previous]
    const previousDemo = previousSlide?.demo

    if (!demo) {
      if (!tracked.current) return
      // Fade out over the incoming transition rather than vanishing on the
      // keystroke: the outgoing demo slide is still on screen for the length of
      // the transition, and an embed that pops out at the start of it is more
      // noticeable than the transition itself. The slot is about to be
      // unregistered by the runtime emptying that layer, so the rect is frozen
      // where it is.
      setLeaving(true)
      const timer = window.setTimeout(() => {
        setRun(null)
        setLeaving(false)
        tracked.current = null
      }, TRANSITION_MS[slide?.transition ?? 'cut'] + 140)
      return () => window.clearTimeout(timer)
    }

    setLeaving(false)
    tracked.current = demo
    trackedBleed.current = slide?.kind === 'demo'

    // A still is showing, so there is no live frame to manage — but the stage
    // stays mounted, because it owns the callouts and they have to be over
    // whichever of the two the slide ended up with.
    if (showStill) {
      setRun(null)
      return
    }

    const url = `${demoConfig.appOrigin}${routeFor(demo, sessionId)}`
    const staleAuth = authEpoch !== loadedUnderEpoch.current
    loadedUnderEpoch.current = authEpoch

    // 1 — a new run.
    if (!run || !previousDemo) {
      runCounter.current += 1
      believed.current = url
      setRun({ id: runCounter.current, src: url })
      setLoading(true)
      return
    }
    // 2 — the slide says it continues the one we just left. The frame is left
    // completely alone, but the belief is updated: `continuesFrom` is precisely
    // the assertion that the presenter has already navigated the app here
    // themselves, so from now on this *is* where the frame is. Without this the
    // next slide would see a mismatch and reload — which is how 13 → 14, two
    // slides that both name `/progress`, managed to reload a frame that slide 13
    // had just been careful not to touch.
    if (demo.continuesFrom && previousSlide && demo.continuesFrom === previousSlide.id) {
      believed.current = url
      return
    }
    // 3 — the frame is already where this slide wants it. Unless the deck signed
    // this profile in since the frame was loaded, in which case the frame is
    // sitting on the login screen it was given when it had no cookie, and the same
    // URL will now answer with the app.
    if (believed.current === url && !staleAuth) return
    // 4 — a deliberate navigation of the surviving element. Imperative, so that
    // React's own view of `src` never enters into it.
    believed.current = url
    setLoading(true)
    if (frame.current) frame.current.src = url
    // `run` is read, not depended on: including it would re-run the policy on
    // every change and re-decide a decision already taken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, showStill, sessionId, authEpoch, toggled])

  // --- `L` reloads the current slide's route ------------------------------
  // The escape hatch for rule 3 above. Imperative rather than through state,
  // because the point is to reload a URL React already believes is set.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== 'l') return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!demo || !frame.current) return
      event.preventDefault()
      setLoading(true)
      frame.current.src = `${demoConfig.appOrigin}${routeFor(demo, sessionId)}`
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [demo, sessionId])

  // --- the toggle: one slide's before/after -------------------------------
  /**
   * `demo-office-transformation` is scripted as a toggle and had nothing that
   * toggled. Its key is declared on the spec (`demo.toggle.key`) rather than
   * fixed here, so the click path, the staging note and the presenter overlay
   * name the key the handler actually binds.
   *
   * Two properties this needs and a bare `src` assignment would not have:
   *
   * - **It flips state, not the iframe.** The run policy above already knows how
   *   to navigate a surviving element to a route the slide asks for — that is
   *   rule 4, and it is the same path `/office` → `/office?officeTier=0` takes
   *   between the previous slide and this one. So this only changes what the
   *   slide is asking *for*, and the existing policy performs it. That is also
   *   what makes it work with no live app at all: with a still on screen there is
   *   no frame to navigate, and `demo-frame.tsx` simply paints the other picture.
   * - **It is reversible.** A mis-press is one more press, not a stranded slide.
   *   On a slide with five scripted seconds of silence, the recovery mattering
   *   more than the flourish is the whole design.
   *
   * Guarded on the deck being the keyboard's owner the same way `L` is. If focus
   * has been taken by the embed the deck sees no keys at all, and the mitigation
   * is the pointer-driven blur below rather than anything specific to this key.
   */
  useEffect(() => {
    const wanted = demo?.toggle?.key?.toLowerCase()
    if (!demo || !wanted) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== wanted) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      event.preventDefault()
      toggleDemo(demo)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [demo])

  /**
   * Leaving the slide puts it back to its "before" state.
   *
   * Without this the toggle works exactly once per page load. Stepping back to
   * the slide, or reaching it again in a second run-through, would open on the
   * tier-14 office — so the presenter's toggle would play the money shot
   * backwards, from the built firm to the shack, with nothing on screen
   * admitting it. The direction of travel *is* the argument, and a rehearsal
   * loop is exactly where this would be discovered too late.
   */
  useEffect(() => {
    if (!demo?.toggle) return
    return () => resetToggle(demo)
  }, [demo])

  // --- giving the keyboard back -------------------------------------------
  /**
   * The embed steals the keyboard, and the deck cannot get it back on its own.
   *
   * This is the failure that framing a real app buys you and it is not obvious
   * until it happens on stage. The moment focus is inside the iframe — because
   * the presenter clicked an answer, or simply because the app autofocused an
   * input on load — every keystroke goes to the app's document and none of them
   * reach the deck's `window` listener. The presenter presses the right arrow to
   * advance off the demo and nothing happens. There is no way to intercept it
   * from out here: the frame is cross-origin, so its `keydown` is unreachable.
   *
   * What *is* reachable is the pointer. Any pointer event over the deck but
   * outside the embed is proof that the presenter is no longer working inside the
   * app, and blurring the iframe at that moment returns focus to the deck's
   * document without interrupting anything. So the rule is: while you are on the
   * demo the keyboard is the app's, and the instant you move off it the keyboard
   * is the deck's again.
   *
   * The two paths that never depended on focus still work regardless, and the
   * runbook says so: the click zones at the very edges of the stage, and a
   * presenter remote that drives a real mouse cursor.
   */
  useEffect(() => {
    const surrender = (event: PointerEvent) => {
      const active = document.activeElement
      if (!active || active !== frame.current) return
      const stage = host.current
      if (stage && event.target instanceof Node && stage.contains(event.target)) return
      frame.current?.blur()
    }
    window.addEventListener('pointermove', surrender, { passive: true })
    window.addEventListener('pointerdown', surrender, { passive: true })
    return () => {
      window.removeEventListener('pointermove', surrender)
      window.removeEventListener('pointerdown', surrender)
    }
  }, [])

  // --- position over the live slot ----------------------------------------
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 })

  const measure = useCallback(() => {
    const slot = getSlot(tracked.current)
    if (!slot) return
    const box = slot.getBoundingClientRect()
    setRect((current) => (
      Math.abs(current.left - box.left) < .5
        && Math.abs(current.top - box.top) < .5
        && Math.abs(current.width - box.width) < .5
        && Math.abs(current.height - box.height) < .5
        ? current
        : { left: box.left, top: box.top, width: box.width, height: box.height }
    ))
  }, [])

  /**
   * Measure, then keep measuring for a beat.
   *
   * One measurement is not enough on a cold load. The slide's own entrance
   * animation is still running, the two display faces may not have arrived yet,
   * and both move the slot by a few pixels after it first has a rect — which
   * leaves the embed sitting a few pixels off its hole, showing a sliver of the
   * plate underneath along one edge. A `ResizeObserver` does not catch it because
   * the slot's *size* never changes, only its position. So the settle is a short
   * bounded frame loop rather than a single read.
   */
  useLayoutEffect(() => {
    if (leaving) return
    measure()
    let raf = 0
    const until = performance.now() + 1000
    const tick = () => {
      measure()
      if (performance.now() < until) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    const onFonts = () => measure()
    void document.fonts?.ready.then(onFonts).catch(() => undefined)
    return () => window.cancelAnimationFrame(raf)
  }, [leaving, measure, index, version, run?.id])

  // A resize observer for layout changes, and a frame loop only while a
  // transition is in flight — the `cut` transition scales the incoming layer by
  // 1.4%, so at rest a rect is stable and during a move it is not. Not a
  // permanent loop: a `getBoundingClientRect` every frame for the length of a
  // twenty-minute talk is a layout thrash nobody needs.
  useEffect(() => {
    if (leaving) return
    const slot = getSlot(tracked.current)
    if (!slot) return
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [leaving, measure, index, version])

  useEffect(() => {
    if (!moving || leaving) return
    let raf = 0
    const tick = () => { measure(); raf = window.requestAnimationFrame(tick) }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [leaving, measure, moving])

  // --- the load cover -----------------------------------------------------
  useEffect(() => {
    if (!loading) return
    const timer = window.setTimeout(() => setLoading(false), COVER_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [loading, run?.src])

  if ((!demo && !leaving) || !rect.width || !rect.height) return null

  const spec = demo ?? tracked.current
  const logicalWidth = Math.round(
    Math.min(spec?.width ?? DEFAULT_WIDTH, LEGIBILITY_WIDTH) / (spec?.zoom ?? 1),
  )
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, rect.width / rect.height))
  const logicalHeight = Math.round(logicalWidth / aspect)
  // Contain, not cover: the app must never be cropped. With the logical box taken
  // from the slot's own aspect the two terms are equal, so containing and filling
  // are the same thing — and on the one shape that clamps, containing is what
  // keeps the app whole.
  const scale = Math.min(rect.width / logicalWidth, rect.height / logicalHeight)

  return (
    <div
      className="demo-stage"
      ref={host}
      data-leaving={leaving ? '' : undefined}
      data-loading={loading && run ? '' : undefined}
      // A full-bleed demo slide puts the app *under* its slide layer rather than
      // over it, because at full bleed the app is the slide's field and the only
      // thing left in the layer is type that has to be readable on top of it.
      // See the long note in `demo-stage.css`.
      data-under={(demo ? slide?.kind === 'demo' : trackedBleed.current) ? '' : undefined}
      // No live frame: the slide is showing its still, which is painted by the
      // chrome in the layer below. The stage has to become a sheet of glass
      // rather than a surface, or it would cover it.
      data-empty={run ? undefined : ''}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {run ? (
        <iframe
          // The key is the run, so React preserves this element for as long as
          // the run lasts and only ever touches `src` when the policy above
          // changed it. That is the whole continuity mechanism.
          key={run.id}
          ref={frame}
          className="demo-stage-frame"
          title={spec?.caption ?? run.src}
          src={run.src}
          onLoad={() => setLoading(false)}
          style={{
            width: `${logicalWidth}px`,
            height: `${logicalHeight}px`,
            // The translate is what centres it, and it has to come before the
            // scale: the element is laid out at its logical width, which is
            // wider than the slot on any viewport smaller than about 1600x900,
            // and an over-constrained `margin: auto` does not centre. See the
            // long note on `.demo-stage-frame` in `demo-stage.css`.
            transform: `translate(-50%, -50%) scale(${scale || 0.001})`,
          }}
          // Our own dev server, on our own machine. `allow-same-origin` is
          // required for the app to read its own cookies and localStorage, which
          // is the entire point of framing it rather than filming it.
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      ) : null}

      <div className="demo-stage-cover" aria-hidden="true"><span>Loading the app</span></div>

      {spec?.annotations?.map((annotation, position) => (
        <span
          key={annotation.label}
          className={`demo-callout from-${annotation.from ?? 'left'}${position < annotations ? ' is-shown' : ''}`}
          style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
          aria-hidden={position >= annotations}
        >
          <i className="demo-callout-pin" />
          <b>{annotation.label}</b>
        </span>
      ))}
    </div>
  )
}
