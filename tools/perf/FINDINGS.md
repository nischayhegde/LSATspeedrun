# `tools/perf` — findings

Read this before running anything here. Everything below is a measurement or a
mistake that cost a session, and re-deriving either is expensive.

## Why this directory exists

Every perf harness in this repository before it served `/v1/*` as a flat 401
(`tools/css-split/prod-serve.mjs --api`). That is right for `/` and `/login`
and wrong for every other screen: a 401 sends a protected route to the sign-in
page, so a run that asked for `/firm` timed `/login` and printed a number about
a screen nobody asked about.

That is the whole of the earlier note that "the only measurable route was too
small to show a difference". The measurable route was `/login`, which is 4.3 kB.
The routes worth measuring were never being measured at all.

`lib.mjs` proxies `/v1` to a real backend, signs in with dev auth before the
navigation, and then refuses to believe itself: a load counts only if the
browser finished on the path it asked for **and** that path's own marker
element is in the document. Anything else is reported as void.

## The control, and why every run has one

The signed-out arm is not decoration. The same route is loaded again with no
cookie and it **must** come back void, having bounced to `/login`. If it does
not, either the harness is not really signing in or the backend is serving a
protected screen to an anonymous caller — and in both cases the authenticated
number is meaningless. A green result with no control behind it is the exact
shape of claim this project has repeatedly found to be false.

## Running it

The backend has to be up with dev auth on, and an account has to exist:

```bash
export DATABASE_URL=sqlite:////tmp/lsat-perf/app.db DEV_AUTH_ENABLED=true PORT=5001
cd backend && ../.venv/bin/python -m flask --app run.py db upgrade && ../.venv/bin/python run.py &
.venv/bin/python backend/scripts/seed_demo.py --email perf@localhost.test --apply --no-backup

cd frontend && npm run build && cd ..
export LSAT_PLAYWRIGHT=/path/to/playwright/index.mjs LSAT_CHROME=/path/to/chrome
node tools/perf/route.mjs frontend/dist --route /firm --runs 5
```

`ab.mjs` takes two built directories and interleaves them, which is the only
form worth trusting for a difference under ~150 ms.

## Traps

**Serving assets uncompressed.** Production sits behind a CloudFront with
`Compress: true`. A harness handing back raw bytes spends 4.6x the real
bandwidth on the entry stylesheet, which moves the ranking of the critical path
and, on one occasion, inflated largest-contentful-paint from 1712 to 3688 ms and
sent a worker chasing a regression that did not exist. Compression is the
default in `prod-serve.mjs` and a run that wants raw bytes has to ask with
`--no-compress`.

**Machine load.** These timings are 4x-throttled, so anything else running on
the box lands directly in the result. Every tool here prints `loadavg` at the
start and end of the run; a pair of numbers taken at different loads is not a
pair. The numbers below were taken on an idle 8-core box at load < 0.3, and the
A/B form interleaves the arms so that drift hits both.

## Measured

### Baseline: what a signed-in reader waits for

`frontend/dist` at commit `82acaf6`, 390px / 4x CPU / 1.6 Mbps / 150 ms rtt,
brotli as CloudFront serves it, 3 runs, load 0.01.

| | /firm |
|---|---|
| route chunk requested | 1580 ms |
| first contentful paint | 204 ms |
| route on the glass | 2642 ms |
| largest contentful paint | 2820 ms |

The gap between the first paint and the route chunk request is the finding.
First paint is 204 ms because `index.html` draws its own opening plate, and the
route's **stylesheet** is in the document at about the same time — the
`lsat-route-stylesheets` plugin writes a real `<link>` for it at the top of
`<head>`, before the parser has even reached the entry sheet.

The route's **script** had no equivalent. It is requested by
`routeForPath(...)?.preload()` in `main.tsx`, which cannot run until the entry
chunk and the framework chunk have both been downloaded, parsed and executed.
Measured, that is 1580 ms — about 1.38 s after the browser already knew, from
the URL alone, exactly which chunk it was going to need.

### The route-script hint (landed)

`lsat-route-script-hints` in `frontend/vite.config.ts` emits a `modulepreload`
for the current path's own chunk closure. Everything it needs was already
there: the same `ROUTE_ENTRY_CHUNKS` table and the same `staticClosure` walk
`redirectRouteHints` uses on `/`. Only the eight paths that *can* name their
screen from the url were left out.

Interleaved A/B, base is the same source without the plugin, same browser
lifetime, 390px / 4x CPU / 1.6 Mbps / 150 ms, brotli, load stated per run.

| route | chunk requested | route on the glass | largest paint | pairs won |
|---|---|---|---|---|
| `/story` | 1296 → 191 (−1105) | 2112 → 1708 (−404) | −380 | 9 of 9 |
| `/firm` | 1312 → 190 (−1122) | 1975 → 1756 (−219) | −192 | 9 of 9 |
| `/onboarding` | 1152 → 191 (−961) | 1617 → 1452 (−165) | −172 | 7 of 7 |
| `/cases` | 1296 → 192 (−1104) | 2222 → 2091 (−131) | −460 | 9 of 9 |
| `/progress` | 1262 → 189 (−1073) | 2405 → 2338 (−67) | −68 | 8 of 9 |
| `/cases/<id>` | 1339 → 187 (−1152) | 2357 → 2348 (−9) | −16 | 6 of 9 |
| `/login` | not hinted, see below | 1509 → 1508 (−1) | +4 | 4 of 9 |

`/cases/<id>` is a documented neutral rather than a win. Its chunk arrives
1.15 s earlier and the screen does not move, because that screen is gated on
the session fetch and not on its code. It is left hinted because it costs
nothing and 6 of 9 is not a regression, but nobody should expect it to help.

First contentful paint did not move on any route, and that is the correct
result: the opening plate is drawn by `index.html` itself, and nothing in the
bundle can make it earlier or later. `index.html` grew 2789 bytes raw and
**165 bytes brotli**.

`/office` and `/map` are excluded because `scenePreloadHints` already emits
their page chunk. `/login` is excluded because it measured 20 ms slower across
7 of 7 pairs — see Killed.

## Killed

**Hinting `/login`.** It is the one screen that cannot draw until a network
answer arrives: `auth-config` decides whether the dev sign-in button is shown,
so the route's own chunk is never what it is waiting for, and ~10 kB of hinted
bytes is pure contention on that reply. 1507 → 1527 ms to content, losing 7 of
7 pairs. Excluded by name in `HINT_LOSES`. This is the same shape as the 5.6 s
that hinting three.js on this route cost earlier, three orders of magnitude
smaller.

**The first reading of the route-script hint, which said it was a regression.**
Worth recording because the mistake is subtle and the harness was mine. The
first A/B reported the hint making `/firm` 264 ms *slower* and `/story` 328 ms
slower, losing 0 of 9 pairs on both, and the explanation was plausible:
bandwidth contention on a 1.6 Mbps pipe, exactly the trap the `vite.config.ts`
comment already records for three.js. It was wrong. The API proxy was
forwarding `/v1/game` uncompressed — 165 kB instead of 26 kB — so the pipe was
saturated by an artefact and every byte the hint moved forward really was
stealing from the critical path. With the proxy compressing the way CloudFront
does, the same comparison is a win of 67 to 404 ms winning 8 or 9 of 9 pairs.
The trap at the top of this file is not a historical note.

**Hinting three.js behind a redirect.** Recorded in `vite.config.ts` above
`SCENE_ENTRY_CHUNKS` and repeated here because it is the trap a route-script
hint invites: hinting `/login` pushed the already-signed-in bounce off that
route from 0.6 s to 6.2 s, because ~717 kB of three.js competed with the page's
own chunk and the `me` request that decides where the visitor goes. The hints
this directory measures are taken from `ROUTE_ENTRY_CHUNKS`, which is a route's
own page chunk and its *static* imports; the scene modules are dynamic imports
and are not in that closure. Verified in the emitted `index.html`, not assumed.
