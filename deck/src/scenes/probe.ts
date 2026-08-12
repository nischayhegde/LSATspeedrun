/**
 * THE TELEMETRY HATCH.
 *
 * Frame time, draw calls and `renderer.info.memory` were readable only through
 * the presenter HUD, which meant the only way to check the render budget was to
 * put a debug overlay on the slide. The HUD staying off unless `?hud` is asked
 * for is a fix that has to survive, so the numbers are published here instead:
 * on `window`, where a console or a Playwright pass can read them and an
 * audience never can.
 *
 * Three renderers have to be visible through it, not one. The deck owns a
 * single shared `WebGLRenderer` by design, but the two ported app scenes — the
 * office and the city map — construct their own, exactly as they do inside the
 * app, and those two are precisely the scenes whose draw calls need watching. A
 * hatch that could only see the stage would be blind to the expensive half of
 * the deck.
 *
 * Deliberately dependency-free. It is imported from both `scenes/` and
 * `app-art/`, and anything heavier than this would be creating a real edge
 * between those two layers for the sake of ten lines.
 *
 *     // in the browser console, or from Playwright:
 *     __deckStage()          // the shared stage
 *     __deckOffice()         // the office, while it is mounted
 *     __deckMap()            // the city map, while it is mounted
 */

/** Publish a live reader under `name`, or withdraw it by passing `undefined`. */
export function registerProbe(name: string, read: (() => unknown) | undefined) {
  const host = window as unknown as Record<string, unknown>
  if (read) host[name] = read
  else delete host[name]
}

/**
 * Withdraw `read` from `name`, but only if it is still the published reader.
 *
 * A name here is global while the things behind it are not, and the stage can
 * hold two instances of one scene at once: `warm` and `show` race, both build,
 * and the loser is disposed *after* the winner has been cached and has already
 * published. An unconditional withdraw in that dispose deletes the live
 * scene's reader, and the hatch goes dark on exactly the fast navigation it
 * exists to measure. Withdrawing by identity rather than by name means the
 * loser's dispose is a no-op, which is what it should have been.
 */
export function withdrawProbe(name: string, read: () => unknown) {
  const host = window as unknown as Record<string, unknown>
  if (host[name] === read) delete host[name]
}
