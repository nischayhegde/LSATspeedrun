/**
 * The deck's harnesses import their Playwright from here; the resolver itself
 * lives in `tools/playwright-env.mjs`.
 *
 * It moved when `tools/map-qa/` and `tools/css-split/` turned out to carry the
 * same hardcoded `/private/tmp/pwrt` path and the same macOS-only browser scan
 * this was written to remove. Three trees, one answer, and none of the three is
 * the natural owner of the other two — so it sits in `tools/` and this file
 * stays as the deck's import, both because ten scripts in this directory name
 * it and because a resolver two levels up is a worse thing to stumble on than a
 * one-line re-export beside the scripts that use it.
 */
export { GL_ARGS, findChrome, importPlaywright, launchChromium } from '../../tools/playwright-env.mjs'
