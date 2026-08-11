/**
 * Where the deck's scripts find Playwright, and a Chromium it can launch.
 *
 * Every harness in this directory needs the same two answers and each used to
 * carry its own copy of them, hardcoded to one laptop: the module was imported
 * from `/private/tmp/pwrt/node_modules/playwright/index.mjs` — an absolute path
 * outside the repository — and the browser was looked for only as a macOS arm64
 * app bundle under `~/Library/Caches/ms-playwright`, with a literal
 * `chromium-1234` as the last resort. Both were overridable with `DECK_PLAYWRIGHT`
 * and `DECK_CHROME`, so on any other machine the scripts did not *fail*, they
 * asked to be configured — which is the same thing as not running, since a
 * verification script nobody can run verifies nothing. `verify-demo-continuity`
 * is the regression test for the deck's single most expensive slide and it had
 * never been run anywhere but that laptop.
 *
 * So the answers are resolved rather than assumed, and the environment variables
 * remain as overrides rather than as the only way through.
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
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const DECK_DIR = resolve(SCRIPTS_DIR, '..')
const REPO_ROOT = resolve(DECK_DIR, '..')

/**
 * Software rendering, explicitly. A headless Chromium on a machine with no
 * attached display will otherwise decide it has no usable GPU and hand back a
 * context that fails on the first shader compile — which surfaces as a scene
 * that is simply absent, with nothing in the console. `--use-gl=angle` plus
 * SwiftShader is the combination the map harness settled on and it is the one
 * that produces pixels here too.
 */
export const GL_ARGS = ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

const MODULE_CANDIDATES = [
  process.env.DECK_PLAYWRIGHT,
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

/** A Chromium on disk, newest build first, or null. `DECK_CHROME` wins. */
export function findChrome() {
  if (process.env.DECK_CHROME) return process.env.DECK_CHROME
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
    return await import(candidate)
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
  const args = options.args ?? GL_ARGS
  const explicit = process.env.DECK_CHROME
  if (explicit) return chromium.launch({ ...options, args, executablePath: explicit })
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
