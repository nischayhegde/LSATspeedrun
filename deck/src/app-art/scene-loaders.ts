export { applyPlayerCosmetics } from './player-cosmetics'

let characterModule: ReturnType<typeof importStylizedCharacter> | null = null
let officeModule: ReturnType<typeof importOfficeScene> | null = null
let mapModule: ReturnType<typeof importMapScene> | null = null

function importStylizedCharacter() {
  return import('./stylized-character')
}

function importOfficeScene() {
  return import('./office-three')
}

function importMapScene() {
  return import('./map-three-scene')
}

export function loadStylizedCharacter() {
  characterModule ??= importStylizedCharacter()
  return characterModule
}

export function loadOfficeScene() {
  officeModule ??= importOfficeScene()
  return officeModule
}

export function loadMapScene() {
  mapModule ??= importMapScene()
  return mapModule
}


type NetworkInformation = { saveData?: boolean; effectiveType?: string }

/**
 * Warming the dock costs roughly a megabyte of three.js and scene code. That is
 * a good trade on a connection with room to spare and a bad one on a metered or
 * slow link, where it competes with the screen the reader actually asked for.
 */
function preloadIsWelcome() {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (!connection) return true
  if (connection.saveData) return false
  return !(connection.effectiveType === '2g' || connection.effectiveType === 'slow-2g')
}

/**
 * A dynamic import is not just a download: the browser parses, compiles and
 * evaluates the module as soon as the bytes land, on the main thread, in one
 * unbroken task. Warming the whole dock the moment a route mounts therefore put
 * ~250 kB of minified scene code through the parser *while the scene the reader
 * asked for was still building its geometry*, and the two fought for the same
 * thread. Measured on the world map at 4x CPU throttle, the office chunk alone
 * was being parsed inside the window between the canvas appearing and its first
 * frame.
 *
 * So speculative warming now waits for the main thread to prove it is free.
 * `requestIdleCallback` alone is not proof — it fires between the long tasks of
 * a scene build too — so we also require a couple of consecutive animation
 * frames to have come back on time. A scene under construction starves rAF; a
 * settled one does not.
 *
 * The deadline is deliberately short. Waiting indefinitely for a perfectly calm
 * thread protects the current screen but leaves the *next* one cold, and a
 * measured 10-second ceiling cost more on navigation than it saved on load. Two
 * and a half seconds is past the scene build on a slow machine and still well
 * inside the time a reader spends reading before moving on.
 */
const QUIET_FRAMES_REQUIRED = 2
const QUIET_FRAME_BUDGET_MS = 26
const QUIET_DEADLINE_MS = 2_500

let quietPromise: Promise<void> | null = null

function whenMainThreadIsQuiet() {
  if (quietPromise) return quietPromise
  quietPromise = new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') {
      resolve()
      return
    }
    const startedAt = performance.now()
    let calm = 0
    let previous = performance.now()
    const tick = () => {
      const now = performance.now()
      const frame = now - previous
      previous = now
      calm = frame <= QUIET_FRAME_BUDGET_MS ? calm + 1 : 0
      if (calm >= QUIET_FRAMES_REQUIRED || now - startedAt > QUIET_DEADLINE_MS) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  return quietPromise
}

/**
 * Between two speculative modules we hand the thread back, so each parse is its
 * own short task rather than one long stall that a reader would feel as jank.
 */
function yieldToIdle() {
  return new Promise<void>((resolve) => {
    const idle = (window as Window & typeof globalThis).requestIdleCallback
    if (typeof idle === 'function') idle(() => resolve(), { timeout: 600 })
    else setTimeout(resolve, 32)
  })
}

let warmQueue: Promise<unknown> = Promise.resolve()

function warmWhenIdle(load: () => Promise<unknown>) {
  warmQueue = warmQueue
    .then(() => whenMainThreadIsQuiet())
    .then(() => yieldToIdle())
    .then(load)
    .catch(() => undefined)
  return warmQueue
}

/**
 * The dock puts Office and World one tap away from every page, and both need
 * the same (shared) three.js chunk. Warming them means the first visit does not
 * also pay for the download. Skipped inside a case session, where the dock is
 * hidden and the reader owns the bandwidth, and skipped when the connection has
 * asked not to be spent speculatively.
 *
 * Ordered nearest-first: whichever scene the current route does *not* already
 * need is the one a reader is most likely to open next.
 */
export function preloadDockArt(pathname: string) {
  if (/^\/cases\/.+/.test(pathname)) return
  if (!preloadIsWelcome()) return
  const onMap = pathname === '/map'
  void warmWhenIdle(loadStylizedCharacter)
  void warmWhenIdle(onMap ? loadOfficeScene : loadMapScene)
  void warmWhenIdle(onMap ? loadMapScene : loadOfficeScene)
}

/**
 * The modules the current route is about to render itself. These are on the
 * critical path either way, so starting the fetch as the route mounts only
 * overlaps the download with React's own render work — it never competes with a
 * scene, because it *is* the scene.
 */
export function preloadArtForRoute(pathname: string) {
  if (pathname === '/office' || pathname === '/login' || pathname === '/onboarding') {
    void loadStylizedCharacter()
    void loadOfficeScene()
  } else if (pathname === '/map') {
    void loadStylizedCharacter()
    void loadMapScene()
  } else if (pathname === '/firm' || pathname === '/story') {
    void loadStylizedCharacter()
  }
}

/**
 * Called when a reader signals they are about to open a scene — a pointer
 * resting on a dock link, or a touch starting on one. Intent is worth far more
 * than a guess, so this skips the quiet-thread wait entirely and starts the
 * download during the few hundred milliseconds before the click lands.
 */
export function preloadArtForIntent(pathname: string) {
  if (!preloadIsWelcome()) return
  if (pathname === '/office' || pathname === '/onboarding') {
    void loadStylizedCharacter()
    void loadOfficeScene()
  } else if (pathname === '/map') {
    void loadStylizedCharacter()
    void loadMapScene()
  } else if (pathname === '/firm' || pathname === '/story') {
    void loadStylizedCharacter()
  }
}
