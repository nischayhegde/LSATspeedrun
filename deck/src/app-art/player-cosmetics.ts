import type { CharacterCosmetics } from './types'

/**
 * Publish the player's wardrobe to the procedural character builder.
 *
 * The office hero and the office-scene figure receive their look as a React
 * prop. The world map cannot: it builds its counsel rig inside a three.js
 * scene graph with no React tree within reach, so `buildStylizedCounsel` keeps
 * a module-level registry for the player's own figure and this is what fills
 * it. See `setPlayerCosmetics` for why only the player's rig reads it.
 *
 * The import is dynamic for the same reason every other art entry point in
 * this folder is: the builder pulls in three.js, and a screen with no 3D on it
 * should not pay for that.
 */
export async function applyPlayerCosmetics(cosmetics: CharacterCosmetics | null) {
  const module = await import('./stylized-counsel')
  module.setPlayerCosmetics(cosmetics ?? null)
}
