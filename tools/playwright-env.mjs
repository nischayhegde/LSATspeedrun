/**
 * Where this repository's harnesses find Playwright, and a Chromium to launch.
 *
 * Seventeen scripts across `deck/scripts/`, `tools/map-qa/` and
 * `tools/css-split/` needed the same two answers and each carried its own copy
 * of them, hardcoded to one laptop: the module was imported from
 * `/private/tmp/pwrt/node_modules/playwright/index.mjs` — an absolute path
 * outside the repository, under a directory macOS empties — and the browser was
 * looked for only as a macOS arm64 app bundle under
 * `~/Library/Caches/ms-playwright`, with a literal `chromium-1234` as the last
 * resort. Every one was overridable by an environment variable, so on any other
 * machine they did not *fail*, they asked to be configured — which is the same
 * thing as not running, and a verification script nobody can run verifies
 * nothing. `verify-demo-continuity` is the regression test for the deck's
 * single most expensive slide and it had never been run anywhere but that
 * laptop.
 *
 * So the answers are resolved rather than assumed, in one place, and the
 * environment variables remain as overrides rather than as the only way
 * through. It sits in `tools/` because three separate trees import it and none
 * of them owns the other; `deck/scripts/playwright-env.mjs` re-exports it so
 * the deck's harnesses keep their local import.
 *
 * ## Finding the module
 *
 * In order: `DECK_PLAYWRIGHT`, the repository's own `node_modules/playwright`,
 * the deck's, and finally the bare specifier — which picks up a global install
 * or a parent workspace. The repository root is where it belongs: the root
 * `package.json` is git-ignored on purpose (see `.gitignore`, "Root-level
 * harness dependencies") and declares Playwright for exactly these scripts, so
 * a fresh clone runs `npm install` there and everything here works. The deck's
 * own manifest deliberately does not carry it — three runtime packages and no
 * browser-automation stack in its lockfile.
 *
 * ## Finding a browser
 *
 * Preferably not at all. Playwright resolves the browser it downloaded itself,
 * correctly, on every platform it supports, so the first attempt passes no
 * `executablePath` and simply lets it. The scan below is the fallback for the
 * one case that motivated the hardcoding in the first place: a Playwright module
 * loaded from outside the repository whose own registry does not line up with
 * the browsers actually on disk. It looks in both cache locations, for both
 * macOS bundles and the Linux binary, newest build first.
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TOOLS_DIR, '..')
const DECK_DIR = resolve(REPO_ROOT, 'deck')

/**
 * Software rendering, explicitly. A headless Chromium on a machine with no
 * attached display will otherwise decide it has no usable GPU and hand back a
 * context that fails on the first shader compile — which surfaces as a scene
 * that is simply absent, with nothing in the console. `--use-gl=angle` plus
 * SwiftShader is the combination the map harness settled on and it is the one
 * that produces pixels here too.
 */
export const GL_ARGS = ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

/**
 * The override names the three trees already used, all still honoured.
 *
 * `deck/scripts/` read `DECK_PLAYWRIGHT` / `DECK_CHROME`, `tools/css-split/`
 * read `LSAT_PLAYWRIGHT` / `LSAT_CHROME`, and `tools/map-qa/` read
 * `MAPS_CHROME`. Collapsing them to one name would be tidier and would silently
 * ignore whatever anyone has in a shell profile or a note, which is the one
 * failure mode an override exists to prevent.
 */
const MODULE_OVERRIDE = process.env.DECK_PLAYWRIGHT || process.env.LSAT_PLAYWRIGHT
const CHROME_OVERRIDE = process.env.DECK_CHROME || process.env.LSAT_CHROME || process.env.MAPS_CHROME

const MODULE_CANDIDATES = [
  MODULE_OVERRIDE,
  resolve(REPO_ROOT, 'node_modules/playwright/index.mjs'),
  resolve(DECK_DIR, 'node_modules/playwright/index.mjs'),
].filter(Boolean)

/** Where Playwright puts its downloads, on each of the platforms this runs on. */
function browserCaches() {
  const caches = []
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) caches.push(process.env.PLAYWRIGHT_BROWSERS_PATH)
  caches.push(
    platform() === 'darwin'
      ? `${homedir()}/Library/Caches/ms-playwright`
      : `${homedir()}/.cache/ms-playwright`,
  )
  return caches
}

/**
 * The relative paths a `chromium-<build>` directory can hold its binary at.
 * Both macOS bundles are listed because an Intel mac and an Apple-silicon one
 * download different layouts, and naming the wrong one reports "not installed"
 * rather than "wrong architecture".
 */
const BINARIES = [
  // `chrome-linux64` is the current layout and `chrome-linux` the older one;
  // which of the two a build uses depends on the Playwright version rather than
  // on anything visible here, so both are tried.
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-win/chrome.exe',
  'chrome-win64/chrome.exe',
]

/** A Chromium on disk, newest build first, or null. An override wins. */
export function findChrome() {
  if (CHROME_OVERRIDE) return CHROME_OVERRIDE
  for (const cache of browserCaches()) {
    let builds = []
    try {
      builds = readdirSync(cache)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    } catch {
      continue
    }
    for (const build of builds) {
      for (const binary of BINARIES) {
        const path = `${cache}/${build}/${binary}`
        if (existsSync(path)) return path
      }
    }
  }
  return null
}

/** The Playwright module, from the repo if it is there. */
export async function importPlaywright() {
  const tried = []
  for (const candidate of MODULE_CANDIDATES) {
    if (!existsSync(candidate)) { tried.push(candidate); continue }
    return await import(pathToFileURL(candidate).href)
  }
  try {
    return await import('playwright')
  } catch {
    throw new Error(
      `no Playwright module found. Tried:\n  ${tried.join('\n  ')}\n  playwright (bare specifier)\n`
      + 'Install it for these harnesses:\n'
      + `  cd ${REPO_ROOT} && npm install playwright && npx playwright install chromium\n`
      + 'Or point DECK_PLAYWRIGHT at an existing install.',
    )
  }
}

/**
 * Launch Chromium the way every script here wants it.
 *
 * Playwright's own resolution first; the disk scan only if that throws, which
 * is the honest order — its registry knows about the browser it downloaded and
 * this file does not.
 */
export async function launchChromium(options = {}) {
  const { chromium } = await importPlaywright()
  // `args: []` opts out, which the css-split harnesses do: they measure first
  // contentful paint, and forcing SwiftShader would be measuring a different
  // renderer than the one their recorded numbers were taken on.
  const args = options.args ?? GL_ARGS
  if (CHROME_OVERRIDE) return chromium.launch({ ...options, args, executablePath: CHROME_OVERRIDE })
  try {
    return await chromium.launch({ ...options, args })
  } catch (error) {
    const found = findChrome()
    if (!found) {
      throw new Error(
        `${error}\n\nNo Chromium on disk either. Download one:\n`
        + `  cd ${REPO_ROOT} && npx playwright install chromium\n`
        + 'Or point DECK_CHROME at a Chromium binary.',
      )
    }
    return chromium.launch({ ...options, args, executablePath: found })
  }
}
