// Scripted interface sequences share a compact timing scale. Three-dimensional
// scenes deliberately do not inherit a global playback-rate multiplier: their
// cameras and actors use frame-rate-independent interpolation instead.
export const MOTION_TIMING = {
  characterEntranceMs: 1120,
  countUpMs: 280,
  pageTurnCurlMs: 105,
  pageTurnTotalMs: 285,
  toastMs: 620,
  popupDelayMs: 280,
} as const
