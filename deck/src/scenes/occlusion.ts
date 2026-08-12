/**
 * Whether anything is covering the shared stage canvas edge to edge.
 *
 * The stage is not a cheap thing to draw behind something opaque: it renders a
 * scene and then runs the whole `IllustratedRenderPass` over the frame at full
 * resolution. There are two ways for that work to be invisible, and until now
 * only the first was known about.
 *
 * ## 1. A ported app scene is on top
 *
 * The office and the city map are lifted out of the product with their own
 * `WebGLRenderer` each, and they mount on a layer *above* the stage canvas,
 * filling it. Measured on an M1 at 1920×1080, `concept-lawyer-tycoon` — the
 * tier-6 office, 363 draw calls and 272,000 triangles of its own — ran at 20fps
 * with both renderers going and at 60 with only the one the audience can see.
 * Two full-screen post passes for one visible frame is the entire difference.
 *
 * ## 2. The slide paints a field
 *
 * Eighteen of the deck's twenty-four slides set `field` to `blue` or `beige`,
 * and a painted field is a fully opaque background on a layer above the stage.
 * Every one of those slides was rendering a scene and a full-screen post pass
 * per frame underneath an opaque rectangle, for the whole time the presenter
 * held the slide — which on the ones that also *name* a scene meant the tiers
 * helix and the metrics panel were being drawn, lit and post-processed for
 * nobody. It is the largest piece of pure waste left in the deck and it is
 * invisible by construction: the frame looks right, because the frame is the
 * field.
 *
 * Both reasons are registered by name rather than as one boolean, because they
 * are set by two unrelated parts of the app — the scene layer and the deck
 * root — and a single flag would have each of them clearing the other's state.
 *
 * ## The safety rule, and it is the whole design
 *
 * Occlusion is only ever true while nothing is moving. The moment a slide
 * change begins, both covers stop being covers: an app scene starts being
 * faded and dollied, and two opaque fields cross-dissolve through a window in
 * which the stage behind them is genuinely on screen (a `cut` at its midpoint
 * has both layers at roughly half opacity, so a quarter of the stage shows).
 * Callers therefore pass `false` for the duration of a transition. It is only
 * safe to skip a frame nobody could see.
 */

type Cover = 'app-scene' | 'field'

const covers = new Set<Cover>()

export function setStageOccluded(reason: Cover, value: boolean) {
  if (value) covers.add(reason)
  else covers.delete(reason)
}

export function isStageOccluded(): boolean {
  return covers.size > 0
}
