# Theme conformance scans

Static scans and browser harnesses behind `docs/visual-language.md`. The static
ones need nothing; the browser ones need the dev server on 5173 and the API on
5001, and **must be run unsandboxed** — Chromium cannot launch under the agent
sandbox in this repository. Browser and Playwright resolution is delegated to
`tools/playwright-env.mjs`.

## Static

| Script | What it answers |
| --- | --- |
| `scan.mjs` | Every raw value used for radius, shadow, font, tracking and blur, by frequency, plus a hex-literal census. Values appearing once or twice are drift candidates. |
| `undefined-vars.mjs` | Custom properties read but never declared. A `var()` with no declaration and no fallback drops the whole declaration — and inside a `font:` shorthand it drops the size and weight too. Should be clean apart from `--font-ui` in `office-page.css`, which is handed over. |
| `token-clashes.mjs` | One token, two base declarations, different sheets, different values. Should be empty. |
| `selector-clashes.mjs` | The same for selectors that cannot be separated by specificity. Everything it currently reports is explained in `docs/visual-language.md`. |

## Browser

| Script | What it does |
| --- | --- |
| `harness.mjs` | Shared launch/sign-in/visit. Not run directly. |
| `sweep.mjs --tag=NAME` | Screenshots every route at 1440 and 390 and writes a font census per route. |
| `states.mjs --tag=NAME` | The states a url cannot reach: the case session, the answered state, the route error plate, the signed-out login, and the firm tabs with locked and empty variants. |
| `offenders.mjs` | Every element whose used face is Georgia, grouped, with a sample of its text. |
| `probe.mjs` | The face, size, weight and tracking of the same job — page heading, section heading, card heading, eyebrow, body — on each route. Diffing this column-wise is what found `/firm`. |
| `prod-check.mjs` | Repeats the census against `frontend/dist` served with a real API proxy. Not optional: `lsat-route-stylesheets` is `apply: 'build'`, so dev and production order route sheets differently and a dev screenshot cannot speak for production. |
| `diff-shots.mjs` | Per-pixel diff of `.theme-audit/before` against `.theme-audit/after`. |
| `diff-pair.mjs A B` | The same between any two tags. |
| `crop.mjs NAME y0 y1 [x0 x1]` | Stacks the same band from two tags so a small change can be looked at. `PAIR=a,b` to pick tags. |

Output goes to `.theme-audit/`, which is gitignored.

Two things make a screenshot diff noisier than the change being tested: the
economy ticks in real time, so cash and firm-value readouts differ between any
two runs, and the `/office` and `/map` 3D scenes frame themselves differently
each load. Both show up as diffs and neither is a style change.
