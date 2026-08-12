/**
 * Where the browser comes from, for every harness in this directory.
 *
 * Each of these scripts used to open with the same two lines: a hard-coded
 * `import { chromium } from '/private/tmp/pwrt/...'` and a hard-coded macOS
 * path to a Playwright build. Both are one developer's scratch install on one
 * machine, and on any other checkout the import failed at parse time — before
 * the script could print so much as a usage line, which reads like a broken
 * harness rather than like a missing dependency. Eight copies also meant eight
 * places to fix it.
 *
 * Resolution order, for both the module and the browser: an environment
 * variable, then the paths this project has actually used, then whatever the
 * machine has installed. The failure message says what to install.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

const MODULES = [
  process.env.LIGHT_PLAYWRIGHT,
  process.env.MAPS_PLAYWRIGHT,
  'playwright',
  '/tmp/pwrt/node_modules/playwright/index.mjs',
  '/private/tmp/pwrt/node_modules/playwright/index.mjs',
].filter(Boolean)

const BROWSERS = [
  process.env.LIGHT_CHROME,
  process.env.MAPS_CHROME,
  `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

export const CHROME = BROWSERS.find((path) => existsSync(path)) ?? BROWSERS[0]

/** Software GL, so a headless machine with no display still renders WebGL. */
export const GL_ARGS = ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

export async function chromiumModule() {
  const failures = []
  for (const candidate of MODULES) {
    try {
      const module = await import(candidate)
      if (module.chromium) return module.chromium
    } catch (error) {
      failures.push(`${candidate}: ${String(error.message).split('\n')[0]}`)
    }
  }
  throw new Error(
    'playwright not found. Install it anywhere node can resolve it and set LIGHT_PLAYWRIGHT, e.g.\n'
    + '  mkdir -p /tmp/pwrt && cd /tmp/pwrt && npm init -y && npm install playwright\n'
    + `Tried:\n  ${failures.join('\n  ')}`,
  )
}

/** The browser these harnesses want: software GL, and the resolved executable. */
export async function launch(options = {}) {
  const chromium = await chromiumModule()
  return chromium.launch({ executablePath: CHROME, args: GL_ARGS, ...options })
}
