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
