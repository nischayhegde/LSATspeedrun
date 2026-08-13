/**
 * Duration for the 10 → 11 reach-and-haul. Slide 11 is the real DOM layer,
 * driven on translateX only (identity when settled). No 3D plate.
 */

/**
 * Long, because it is a walk: he crosses the stage to the sheet and then backs
 * all the way across it again, hauling.
 *
 * 5.8s → 4.9s → 4.5s → this, and the last cut is a different kind from the ones
 * before it. Those divided the clock among the strides, so every second saved
 * came out of the gait — which is why the walk cycle had drifted to 1.25s and
 * stopped reading as walking. The scene now sets its own pace from
 * `WALK_CADENCE` and takes as long as that takes, so this number is no longer
 * an input to how he moves. It is a budget: long enough to contain the
 * choreography with a little standing still at the end, short enough that none
 * of that standing still is dead air.
 *
 * The saving came from the choreography instead — a step off the walk-in, and
 * the strides at a walking pace rather than a strolling one — which is why it
 * is the largest cut yet and the first one that did not cost gait quality.
 *
 * If the beat is ever lengthened, the surplus lands in the settle; if it is
 * shortened past what the strides take, the scene speeds them up rather than
 * being caught mid-haul at teardown. Both are safe. Neither is free.
 */
export const COUNSEL_PULL_MS = 3400
/**
 * Incoming slide is identity; counsel canvas is torn down here. Must sit after
 * the scene's own `haulEnd`, or the hand would still be carrying the sheet when
 * the stage goes.
 */
export const COUNSEL_PULL_MID = 0.96

/**
 * Where slide 11 waits, as a percentage of viewport width, before he takes
 * hold of it.
 *
 * Not 100. At 100 the sheet is exactly off stage, which means that at the
 * moment of contact his hand closes on the frame edge with nothing visible in
 * it — the grab has to be inferred from what happens next. Parked a few percent
 * in, there is a strip of the next page standing at the edge of the stage, he
 * walks over and takes hold of *that*, and the contact is something the
 * audience sees rather than works out. It does not move until he moves it:
 * this is where it is put, not somewhere it is eased to.
 *
 * The strip is also what decides how far right he has to walk, since he stops
 * an arm's length from its edge. Four percent is about sixty pixels of paper —
 * enough to be a thing he takes hold of, and enough to keep his whole figure
 * inside the frame while he does it.
 */
export const COUNSEL_PULL_PARK = 96

/** The identity beat he stands on. */
export const COUNSEL_PULL_FROM = 'concept-lawyer-tycoon'
/**
 * The slide he hauls on. Used to be `pov-ai-never-answers`; now the number-one
 * POV, so the walk still works and the claim it delivers is the method claim.
 */
export const COUNSEL_PULL_TO = 'pov-graded-question'

export function snapCounselSlide(layer: HTMLElement) {
  layer.style.transform = 'translate3d(0,0,0)'
  layer.style.clipPath = 'none'
  layer.style.maskImage = 'none'
  layer.style.webkitMaskImage = 'none'
  layer.style.removeProperty('-webkit-clip-path')
}
