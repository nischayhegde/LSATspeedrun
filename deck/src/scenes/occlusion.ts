/**
 * Whether a ported app scene is covering the whole frame.
 *
 * The office and the city map are lifted out of the product with their own
 * `WebGLRenderer` each, and they mount on a layer *above* the shared stage
 * canvas, filling it. For as long as one of them is the current slide, every
 * pixel the stage draws is behind an opaque canvas — and the stage is not a
 * cheap thing to draw behind something: it renders a scene and then runs the
 * whole `IllustratedRenderPass` over the frame at full resolution.
 *
 * Measured on an M1 at 1920×1080, `concept-lawyer-tycoon` — the tier-6 office,
 * 363 draw calls and 272,000 triangles of its own — ran at 20fps with both
 * renderers going and at 60 with only the one the audience can see. Two
 * full-screen post passes for one visible frame is the entire difference.
 *
 * A module-level flag rather than a prop, because the two ends of this are the
 * scene layer and the stage, and they have no relationship: the stage is
 * constructed once at boot and knows nothing about React, while the layer is a
 * component that knows nothing about the renderer. A one-bit signal between
 * them is a smaller thing to introduce than a channel.
 *
 * The flag is cleared the instant a slide change begins, because the moment an
 * app scene stops being `current` it starts being animated — faded, dollied,
 * pushed off — and the stage behind it becomes visible through the move. It is
 * only safe to skip a frame nobody could see.
 */

let occluded = false

export function setStageOccluded(value: boolean) {
  occluded = value
}

export function isStageOccluded(): boolean {
  return occluded
}
