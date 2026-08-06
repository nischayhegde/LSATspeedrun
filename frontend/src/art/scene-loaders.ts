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

/**
 * The dock puts Office and World one tap away from every page, and both need
 * the same (shared) three.js chunk. Warming them while the main thread is idle
 * means the first visit does not also pay for the download. Skipped inside a
 * case session, where the dock is hidden and the reader owns the bandwidth.
 */
export function preloadDockArt(pathname: string) {
  if (/^\/cases\/.+/.test(pathname)) return
  void loadStylizedCharacter()
  void loadOfficeScene()
  void loadMapScene()
}

/**
 * Warm the two persistent scene tabs without making authentication or a case
 * reader compete with Three.js. Safari/WKWebView still does not consistently
 * expose requestIdleCallback, so the timeout path is required on iOS rather
 * than being an optional nicety.
 */
export function scheduleDockArtPreload(pathname: string) {
  let cancelled = false
  const preload = () => {
    if (!cancelled) preloadDockArt(pathname)
  }

  if (typeof window.requestIdleCallback === 'function') {
    const idle = window.requestIdleCallback(preload, { timeout: 900 })
    return () => {
      cancelled = true
      window.cancelIdleCallback(idle)
    }
  }

  const timer = window.setTimeout(preload, 250)
  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}

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
