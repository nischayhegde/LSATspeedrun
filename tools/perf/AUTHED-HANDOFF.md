# The first authenticated measurements, and the handoff

Session of 2026-08-10, 20:12–21:40, in the `/private/tmp/lsat-harness` worktree
on `feat/harness` (cut from `integration/all-features` at `7977772`). Nothing
was written to the main checkout or to any other worker's worktree.

## What now exists

An authenticated harness, described in `README.md` next to this file. It is a
library plus a backend script, not a one-off: `signIn()`, `authedContext()` and
`proveSignedIn()` are three lines to add to any tool, and `waterfall.mjs --auth`
is the worked example.

**It is proved, both ways.** On the HEAD build:

```
9/9 routes proved signed in                       load 22.7 16.6 14.6
  /login and /  ->  /cases/b80cb8fc-…             (the redirect a signed-in reader gets)
  /office /progress /cases /cases/:id /firm /story /map   landed where asked
control, no session, same rig:
  /firm /cases /story  ->  /login, me 401         3/3 bounced
```

The control matters as much as the run. It is the evidence that the rig really
does require a session, and therefore that the signed-in run measured something
a signed-out one could not have. Raw output in `.harness/measure/`.

## The three routes nobody had measured

Cold load, 390px, 4x CPU, 1.6 Mbps / 150 ms rtt, brotli as production's
CloudFront serves it, one load each, signed in and proved so.

| route | first paint | largest paint | requests | wire | load |
|---|---|---|---|---|---|
| `/cases/:id` | 1068 ms | 3184 ms | 41 | 737.7 kB | 12.7 |
| `/firm` | 464 ms | 3296 ms | 44 | 855.6 kB | 11.0 |
| `/story` | 356 ms | 3188 ms | 43 | 845.5 kB | 13.2 |

One load per route is a shape, not a result — enough to see where the time goes,
not enough to defend a 100 ms difference. The load average was 11–13 throughout,
which is busy but was stable across the three.

## The finding these routes were wanted for

**The route's stylesheets are hinted from the document at ~210 ms. Its script is
not requested until ~1600 ms.** Identical on all three:

| route | route CSS discovered | route JS discovered | JS lands | JS size (brotli) |
|---|---|---|---|---|
| `/cases/:id` | 209 ms | 1600 ms | 2284 ms | 26.6 kB |
| `/firm` | 229 ms | 1601 ms | 1901 ms | 6.8 kB |
| `/story` | 210 ms | 1559 ms | 1809 ms | 3.1 kB |

The CSS is early because `lsat-route-stylesheets` writes it into the document.
The JS is late because nothing does the same for scripts: the chunk cannot be
named until the entry bundle has downloaded, parsed and run and React has asked
for it. That is the gap the reverted route-script hints close, and it is ~1.39 s
of pure serialisation on `/cases/:id` — on a route whose chunk is 26.6 kB on the
wire, not the 2.1 kB `/login` chunk that made the earlier attempt unmeasurable.

The mechanism is already half-built and can be finished in one small change:
`redirectRouteHints()` in `frontend/vite.config.ts` emits `window.__lsatHintRoute(to)`,
which takes a path, matches it against `ROUTE_ENTRY_CHUNKS` and appends
`modulepreload` links. It is currently called from `index.html` for `/` only,
and only for the four `REDIRECT_DESTINATIONS`. Hinting the *current* path at
document time — the same call, `__lsatHintRoute(location.pathname)`, with
`REDIRECT_DESTINATIONS` widened — is the whole change.

**I did not reinstate it, because I could not measure it in the time left.** A
single before/after waterfall would show the discovery time move, and that would
prove the mechanism works while saying nothing about whether it pays: 1.39 s of
earlier discovery on a 26.6 kB chunk may or may not move first or largest paint,
and this repository has already been burned twice by claiming an effect smaller
than the machine's own drift. It needs the pairwise interleaved A/B, and the
command is now a one-liner because the harness can hold a session:

```sh
tools/perf/harness-backend.sh                       # 5810, its own database
cd frontend && npx vite build && cp -r dist /tmp/base
#   … make the change …
npx vite build && cp -r dist /tmp/head
node tools/css-split/fcp-ab.mjs /tmp/base /tmp/head --auth --route /cases/:id --sessions 3 --pairs 7
node tools/css-split/fcp-ab.mjs /tmp/base /tmp/head --auth --route /firm --sessions 3 --pairs 7
```

`fcp-ab.mjs` has **not** been given `--auth` yet — that is the first thing to do
and it is the same four lines the waterfall took (`signIn`, `resolveRoutes`,
`authedContext` for each load instead of `newPage`, `proveSignedIn` before the
pair is counted). Do not skip the last one: the whole point is that a pair which
silently measured `/login` twice must not be allowed to vote.

## Things the next person needs to know about this machine

- **The Playwright browser cache was deleted mid-session.**
  `~/Library/Caches/ms-playwright/chromium-1234` no longer exists — a process
  was still running out of it while the directory was gone, so somebody freed
  disk under a live run. Every tool here defaults to that path. Set
  `LSAT_CHROME="/Applications/Google Chrome/Google Chrome.app/Contents/MacOS/Google Chrome"`
  (Chrome 151, note the unusual directory — it is a mounted image, not
  `/Applications/Google Chrome.app`), which is what all the numbers above were
  taken with.
- **Chromium cannot launch under the agent sandbox.** Run perf tooling with
  full permissions.
- Disk went from 2.6 GB free to 6.4 GB during this session, presumably the same
  cleanup. The harness database is 19 MB and a `dist` is 20 MB.
- The harness backend does not survive the shell that started it in every
  configuration; if a tool reports "The harness API is not answering on 5810",
  restart it and re-run. Nothing is lost — the database persists.
- The build is fast: `npx vite build` is ~7 s, so keeping a base and a head dist
  side by side costs 40 MB and no time.

## What remains

1. Give `fcp-ab.mjs` the same `--auth` treatment `waterfall.mjs` has.
2. Reinstate the route-script hints behind the A/B above, on `/cases/:id` and
   `/firm`. Reinstate with the numbers, or say plainly that they do not pay.
3. `/office` and `/map` are still unmeasured on this rig; they now can be. They
   are the two three.js routes, so expect the scene chunk to dominate.
4. `/onboarding` remains the one route nobody has ever rendered — signed out it
   redirects to `/login`, and this harness's account has completed onboarding so
   it redirects to `/cases/:id`. It needs a second seeded account that has not
   onboarded, which `seed_demo_learner.py` can produce.
