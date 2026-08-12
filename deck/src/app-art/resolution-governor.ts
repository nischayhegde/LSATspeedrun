import type * as THREE from 'three'

import type { IllustratedRenderPass } from './render-style'

/**
 * HOLDS A SCENE AT 60FPS BY SPENDING FEWER PIXELS ON IT.
 *
 * ## Why this exists rather than a constant
 *
 * The two ported scenes are fill-bound, not geometry-bound. Measured on an M1
 * with the tier-6 office — 363 draw calls, 272,000 triangles, unchanged between
 * runs — the frame time tracked the drawing buffer almost exactly:
 *
 *     1920×1080, 4 samples   41ms   24fps
 *     1364×767,  2 samples   26ms   37fps
 *     1364×767,  0 samples   24ms   42fps
 *      960×540,  4 samples  <16ms   63fps
 *
 * while a CPU profile over the same window showed the main thread idle 78% of
 * the time. Nothing about that is a draw-call problem, and the batching helpers
 * the scenes already use are not the lever; pixels are.
 *
 * A fixed pixel budget would work on this machine and be wrong on every other
 * one — too soft on a workstation, still too slow on a MacBook Air, and wrong
 * again the day someone plugs into a 4K projector. The frame rate is the
 * requirement and the resolution is the free variable, so the resolution is what
 * moves.
 *
 * ## How it settles
 *
 * A window of frame times, a median, and a multiplicative correction toward the
 * target. The median rather than the mean because a garbage collection or a
 * dropped frame during a transition is not evidence about resolution, and one
 * 90ms sample would drag a mean far enough to halve the picture.
 *
 * Corrections are damped and capped per step, and the whole thing stops after a
 * handful of them. This is a governor, not a control loop that runs for the
 * length of the talk: a scene that is still resizing itself two minutes in is a
 * scene that is flickering, and the audience would see every step. In practice
 * it takes one or two.
 *
 * It will only ever reduce below the ratio it was constructed at, never above —
 * the caller has already decided what full quality means for its own canvas, and
 * this is allowed to disagree in one direction.
 *
 * ## The first second is not evidence
 *
 * A scene's opening frames include shader compilation, the shadow map bake, and
 * the deck's own transition animating over the top. Sampling starts after those
 * are done, and restarts after every change so a resize is never judged on the
 * frame in which it happened.
 */

/** Below this the bands themselves start to stair and no frame rate is worth it. */
const FLOOR = .42

/** 16.7ms is the target; the trigger sits above it so a scene that is merely at
 *  the edge is left alone rather than nudged forever. */
const TARGET_MS = 16.7
const TOO_SLOW_MS = 18.5
const FAST_ENOUGH_MS = 13.5

/** Frames discarded after a change, then frames measured.
 *
 *  Short on purpose. A slide is spoken over for ten or fifteen seconds and the
 *  correction has to be finished long before the presenter's second sentence,
 *  so the window buys just enough samples for a median to mean something.
 *
 *  Shorter than it first looks, because these are *frames* and the scenes that
 *  need governing are by definition not producing sixty of them a second. At 12
 *  and 30 a single decision cost forty-two frames, which is seven tenths of a
 *  second on a healthy scene and a second and a half on the one actually being
 *  corrected — and the office needed three decisions, so the audience watched
 *  it soften in steps for eight seconds. Distinguishing 27ms from 17ms does not
 *  need thirty samples; eighteen is still a median rather than a reading, and
 *  frames over 100ms are thrown away before they reach it. */
const SETTLE = 8
const WINDOW = 18

/** Enough to cross a factor of two, and few enough that the last one lands
 *  inside the first few seconds of the slide. */
const MAX_STEPS = 4

export type ResolutionGovernor = {
  /** Call once per rendered frame with the frame's delta in seconds. */
  sample: (deltaSeconds: number) => void
  /** Discard the current window; call when the scene becomes visible again. */
  restart: () => void
  /** The ratio currently in force, for telemetry. */
  readonly ratio: number
  /** Corrections made so far, for telemetry. */
  readonly steps: number
}

export function createResolutionGovernor(options: {
  renderer: THREE.WebGLRenderer
  stylePass: IllustratedRenderPass | null
  /** CSS pixel size of the surface, read fresh so a resize is respected. */
  measure: () => { width: number; height: number }
  /** The ratio the caller would use if the machine were fast enough. */
  initialRatio: number
  /** Off in tests and under reduced motion, where there is no steady state. */
  enabled?: boolean
}): ResolutionGovernor {
  const { renderer, stylePass, measure, initialRatio } = options
  let ratio = initialRatio
  let steps = 0
  let seen = 0
  const window_: number[] = []
  const enabled = options.enabled !== false
  /** The median that prompted the last reduction, and the ratio before it. */
  let before: { median: number; ratio: number } | null = null
  let stopped = false

  const apply = (next: number) => {
    ratio = next
    const size = measure()
    renderer.setPixelRatio(next)
    renderer.setSize(size.width, size.height, false)
    stylePass?.setSize(size.width, size.height)
  }

  return {
    get ratio() { return ratio },
    get steps() { return steps },
    restart() {
      seen = 0
      window_.length = 0
    },
    sample(deltaSeconds: number) {
      if (!enabled || stopped || steps >= MAX_STEPS) return
      seen += 1
      if (seen <= SETTLE) return
      // A frame longer than a tenth of a second is a stall — a scene build, a
      // tab coming back, a major layout — and says nothing about fill rate.
      const ms = deltaSeconds * 1000
      if (ms < 100) window_.push(ms)
      if (window_.length < WINDOW) return

      const sorted = window_.slice().sort((a, b) => a - b)
      const median = sorted[sorted.length >> 1]
      window_.length = 0
      seen = 0

      // Did the last reduction actually buy anything?
      //
      // Not every slow frame is a fill-rate frame. The office slide levels off
      // at about 20ms on the machine this was written on and stays there however
      // few pixels it is given, because what is left is draw calls, the scene's
      // own per-frame work, and the page composited around it. Carrying on
      // halving the buffer in that state costs the product shot its sharpness
      // and returns nothing.
      //
      // So a reduction has to prove itself — but "did not pay" and "is fast
      // enough" are two different questions, and conflating them was a bug.
      //
      // The rule used to be: if the reduction did not move the median by a real
      // margin, restore the previous ratio as the sharper of two equally fast
      // pictures, and retire. The flaw is in "equally fast". Restoring is only
      // right when the scene is *already inside budget*, and the office is the
      // case that proves it: at a 1292×727 buffer it sat at 27ms, the reduction
      // to 0.67 bought under eight percent, and the governor duly put the
      // resolution back up and stopped — retiring the scene at thirty frames a
      // second with a sharper picture nobody asked for. Softness is a bad trade
      // against nothing; it is a good trade against dropped frames.
      //
      // So the restore now requires the scene to be within budget. If a
      // reduction did not pay and the frame is still long, the lower ratio is
      // kept — it is never worse — and the governor carries on, because
      // whatever fixed cost is dominating may still be crossed by the next step.
      if (before) {
        const gained = (before.median - median) / before.median
        if (gained < .08 && median <= TOO_SLOW_MS) {
          apply(before.ratio)
          stopped = true
          return
        }
        before = null
      }

      if (median > TOO_SLOW_MS && ratio > FLOOR) {
        // Damped, because frame time is not perfectly linear in pixel count —
        // there is a fixed cost per frame that no amount of shrinking removes,
        // and correcting as though there were none overshoots into a soft
        // picture on the first step.
        //
        // Except when the scene is nowhere near budget. Under-correcting from
        // 27ms just buys another slow window and another visible step, and
        // three small steps are far more noticeable than one large one: the
        // audience reads a picture that keeps changing as a fault and a
        // picture that changed once as the picture. So past half again the
        // target, the correction is taken at face value.
        const ideal = Math.sqrt(TARGET_MS / median)
        const damped = median > TARGET_MS * 1.5 ? ideal : 1 - (1 - ideal) * .8
        before = { median, ratio }
        apply(Math.max(FLOOR, ratio * Math.max(.66, damped)))
        steps += 1
      } else if (median < FAST_ENOUGH_MS && ratio < initialRatio) {
        // Recovering resolution is allowed but deliberately timid: an audience
        // notices a picture getting softer far less than one that pulses.
        apply(Math.min(initialRatio, ratio * 1.12))
        steps += 1
      }
    },
  }
}
