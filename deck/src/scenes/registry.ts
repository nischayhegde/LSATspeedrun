import type { SceneId } from '../slides/types'
import type { DeckStage } from './stage'
import type { SceneFactory } from './types'

/**
 * Which `SceneId`s the shared stage owns, and how each is built.
 *
 * Every factory is a dynamic import. That is not premature: `three` is ~740 kB
 * on its own, and the deck's own scenes together are another few hundred, so
 * putting them all in the entry chunk would put the whole deck behind the hero
 * slide's first paint. The stage warms the neighbouring slide's scene, so the
 * import cost lands during the previous slide rather than on a keystroke.
 *
 * The office and map scenes are **not** here. They are the ported app scenes,
 * each of which constructs its own `WebGLRenderer`, so the deck mounts them as
 * React components on a layer above the stage canvas instead. `sceneIsMounted`
 * below is the single place that distinction is expressed.
 */
const FACTORIES: Partial<Record<SceneId, () => Promise<SceneFactory>>> = {
  none: async () => (await import('./backdrop-scene')).createBackdropScene,
  hero: async () => (await import('./hero-scene')).createHeroScene,
  cast: async () => (await import('./cast-scene')).createCastScene,
  'close-room': async () => (await import('./close-room-scene')).createCloseRoomScene,
  tiers: async () => (await import('./tiers-scene')).createTiersScene,
  metrics: async () => (await import('./metrics-scene')).createMetricsScene,
}

/**
 * Scenes that are React components with their own WebGL context rather than
 * stage residents. At most one may be mounted at a time.
 */
export const MOUNTED_SCENES: ReadonlySet<SceneId> = new Set<SceneId>(['office', 'office-transform', 'map'])

export function sceneIsMounted(id: SceneId | undefined): boolean {
  return Boolean(id && MOUNTED_SCENES.has(id))
}

/**
 * Which stage scene backs a slide.
 *
 * A slide whose scene is a mounted React one still needs *something* on the
 * stage canvas underneath it, both because the app scene's canvas has its own
 * background and because the ink dissolve needs a frame to blend from. The
 * backdrop is that something.
 */
export function stageSceneFor(id: SceneId | undefined): SceneId {
  if (!id || sceneIsMounted(id)) return 'none'
  return id
}

export function registerScenes(stage: DeckStage) {
  for (const [id, load] of Object.entries(FACTORIES)) {
    stage.register(id, async (context) => (await load())(context))
  }
}
