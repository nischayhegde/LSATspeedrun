# Live-demo notes

Everything below was measured on 2026-08-10 against the real stack on this
machine, not reasoned about. Screenshot paths are absolute and live outside the
repo, in `/tmp/deck-demo-verify/`, so nothing here is committed by accident.

## The short version

All seven demo routes frame cleanly inside an authenticated iframe. There is
one way to get it wrong and it fails silently: **the deck must be opened at
`http://localhost:5180`, never `http://127.0.0.1:5180`.**

## Startup order that worked

```bash
# 1. backend — must be 5001, the frontend's Vite proxy targets that port only
cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py

# 2. app dev server — 5173
cd frontend && npm run dev

# 3. seed the account and wire the deck to it
cd deck && npm run prepare-demo

# 4. the deck itself — 5180
cd deck && npm run dev
```

Then, once, in the browser you will actually present from (step 3 prints this
too — a Playwright profile is not your Chrome profile):

1. Open `http://localhost:5173/login`, click **Enter local development firm**.
2. On that same tab, devtools console:
   `localStorage.setItem('lsat-tycoon:guided-tour:v6', 'complete')`
3. Open `http://localhost:5180`.

## Seeded live session

`86377d89-6852-4660-baf9-72ce64147345` — already written into
`demo.config.ts`. It is a `cases` run, 8 questions, sitting at index 2, and
question 3 renders the **prephrase** strategy prompt ("Guess before you look").

## Per-route framing results

Framed from `http://localhost:5199/harness.html` — a throwaway static server
whose one page is a full-viewport iframe and nothing else, listening dual-stack
so `localhost` reaches it whichever of `::1` / `127.0.0.1` the browser picks.
Viewport 1440×900, `deviceScaleFactor: 2`. "Ready" is measured from the harness
navigation, not from the frame's own navigation, so it includes the iframe
handshake. Numbers are from the third (warm Vite) run; the cold-start column is
from the first run of the day, before Vite had transformed the office and map
chunks.

| Route | Framed authenticated | DOM | Ready (warm) | Ready (cold) |
|---|---|---|---|---|
| `/progress` | yes | 309 ms | 1.0 s | 1.2 s |
| `/cases/{id}` | yes | 251 ms | 0.4 s | 0.4 s |
| `/firm?tab=upgrades` | yes | 226 ms | 1.1 s | 1.3 s |
| `/office` | yes | 260 ms | 1.4 s | 9.3 s |
| `/office?officeTier=0` | yes | 1.0 s | 2.6 s | 1.7 s |
| `/office?officeTier=14&officeAll=1` | yes | 1.2 s | 3.1 s | 1.8 s |
| `/map` | yes | 450 ms | 2.0 s | 2.5 s |

Nothing had a problem. No route redirected to `/login`, no route showed the
guided tour, and no route was blocked by `X-Frame-Options` — that header is on
`/v1` responses only, and the iframes point at the Vite-served HTML.

`DemoFrame` puts `sandbox="allow-same-origin allow-scripts allow-forms
allow-popups"` on its iframe, which my harness does not, so I re-ran
`/progress`, the case, and `/office` through a frame carrying that exact
attribute: all three still authenticated. `allow-same-origin` is what keeps the
frame's real origin and therefore its cookies; dropping it would give the frame
an opaque origin and silently sign it out.
(`/tmp/deck-demo-verify/sandbox-check.mjs`, shots `sandboxed-*.png`.)

Screenshots (`-plus2s` is the same frame two seconds later, to show whether the
first was caught mid-build):

```
/tmp/deck-demo-verify/shots/frame-progress.png
/tmp/deck-demo-verify/shots/frame-case.png
/tmp/deck-demo-verify/shots/frame-firm-upgrades.png
/tmp/deck-demo-verify/shots/frame-office.png
/tmp/deck-demo-verify/shots/frame-office-tier0.png
/tmp/deck-demo-verify/shots/frame-office-tier14.png
/tmp/deck-demo-verify/shots/frame-map.png
/tmp/deck-demo-verify/shots/control-127-progress.png
/tmp/deck-demo-verify/report.json          machine-readable version of the table
/tmp/deck-demo-verify/verify.mjs           the harness that produced all of it
```

### Can the deck afford a live 3D iframe on stage?

Yes, with one caveat about the first time.

The `-plus2s` screenshots of `/office` and `/map` are indistinguishable from the
originals, so both scenes are visually complete at the readiness signal:
roughly **1.4 s for the office and 2.0 s for the map**, warm. Those are the
numbers to design the slide around.

The caveat is the cold path. On the very first `/office` load after the app dev
server starts, Vite has to transform the office scene module, and readiness took
**9.3 s**. The map did not show the same effect (2.5 s cold), because something
earlier in the deck's flow had already pulled its chunk. The fix is free: visit
`/office` and `/map` once in the presenting browser before going on stage, or
let the slide before them warm the iframe. Do not let the first office render of
the day happen in front of an audience.

Neither scene ever settles into a still image — the office crowd and the map's
traffic keep animating, and the map camera drifts on its own after a few idle
seconds. That is a feature on stage, but it means "wait for pixels to stop
changing" is not a usable readiness test.

## Gotchas the presenter must know

**1. `localhost` and `127.0.0.1` are different sites.** This is the one that
will ruin the demo. The app's cookies are `SameSite=Lax` (`lsat_session`,
`lsat_csrf`, set in `backend/app/auth.py`), so they only ride along with a
framed request when the framing page and the frame are the same site — and site
is compared by *host*, not by port. `localhost:5180` framing `localhost:5173` is
same-site and stays signed in. `127.0.0.1:5180` framing `localhost:5173` is
cross-site and the cookie is withheld.

I ran that as a control, not as a theory: same harness, same routes, only the
spelling of the framing origin changed, and the iframe landed on
`http://localhost:5173/login` showing the marketing page and the sign-in card.
See `/tmp/deck-demo-verify/shots/control-127-progress.png`.

`deck/vite.config.ts` sets `server.host: '127.0.0.1'`. That is fine — the socket
still answers requests addressed to `localhost` — but it means Vite will print
`http://127.0.0.1:5180/` in the terminal, which is exactly the URL you must not
click. Type `localhost` yourself.

The same applies to signing in: do it at `http://localhost:5173/login`. Signing
in at `http://127.0.0.1:5173/login` stores the cookie against the wrong host.

**2. Opening the live case starts its clock.** The seeder freezes question 3 and
the timer begins when the tab is first opened. By the time you have clicked
through it in rehearsal, the case header will read something like 8:26 against a
2:30 target, in warning colours. Re-run `npm run prepare-demo` shortly before
presenting; it re-seeds and stages a fresh case with the timer at zero. That is
also why the session id changes on every run and why the config is rewritten
rather than pinned.

**3. The guided tour key is `lsat-tycoon:guided-tour:v6`, value `'complete'`.**
Verified against `TOUR_STORAGE_KEY` at `frontend/src/guided-tour.tsx:20` and the
read at line 278. Note that `tools/map-qa/lib.mjs:227` sets a *different*,
obsolete key (`lsat-tour-v6`) — that harness has not suppressed the tour for
some time. Do not copy it. The account flag from the server is authoritative and
`seed_demo.py` sets `onboarding_complete`, so the tour did not appear in any of
my framed runs even before the key was set; the localStorage key is the belt to
that pair of braces, and it is cheap.

**4. Iframes must point at 5173, never 5001.** Every `/v1` response carries
`X-Frame-Options: DENY` (`backend/app/__init__.py`). The Vite-served HTML carries
nothing of the kind, which is why this works at all.

**5. The backend only listens on `127.0.0.1:5001`.** The browser never talks to
it directly — `/v1` goes through the Vite dev proxy — so this does not matter for
framing, but it does mean a probe of `http://localhost:5001` may fail on a
machine where `localhost` resolves to `::1` first.

## Known breakage: the seeder cannot print its report

`backend/scripts/seed_demo.py` **exits 1 with a traceback on every run**, and has
nothing to do with the deck:

```
File "backend/scripts/seed_demo.py", line 1159, in _verify
  supported = [r for r in lab["results"] if r["status"] == "supported"]
KeyError: 'status'
```

`_verify()` still expects the old shape of `strategy_performance()`. That read
model was rewritten — it now returns `leader` rather than `strongest`, and its
per-strategy rows have no `status` field (see `backend/app/strategies.py:1072`,
and the comment there explaining why a per-student verdict was deliberately
removed). The seeder was not updated with it.

This is cosmetic for us. `_verify()` runs *after* every write, and the seeder
commits as it goes, so the account, the firm, and the staged live case are all
fully installed by the time it falls over. What is lost is the JSON report — and
with it the documented `live_demo.url` that `prepare-demo.mjs` was supposed to
parse.

So `prepare-demo.mjs` does not depend on it. It tries the report first, and when
there is no report it signs in against the backend with a plain `fetch` (the
`/v1/auth/dev` endpoint is CSRF-exempt, see `AUTH_EXEMPT_PATHS` in
`backend/app/auth.py`) and reads `/v1/study-sessions/current`, which is the same
answer the app's own "Resume current run" button uses. It says loudly which of
the two it used. Fixing the seeder is a backend change and out of this
workstream's scope, but it is worth doing — the report also carries the
verification that the demo account is actually presentable.

## Fallback stills

In `deck/public/stills/`. The five route stills were captured at 1600×1000 with
`deviceScaleFactor: 2` (so 3200×2000 files) against this seeded account, straight
at the app rather than through an iframe. The two office-tier stills are the
existing canvas-only crops from `.shots-keep/`, at their native 1045×638, and are
duplicated under `scene-*` names on purpose so the two slides that use them
cannot break each other.

| File | Source | What it shows |
|---|---|---|
| `demo-progress.png` | captured | Dashboard: 58% mega-litigation accuracy, 154–162 projected, "Parallel Reasoning" next up, resume bar at 2 of 8 |
| `demo-case.png` | captured | Case 3/8 mid-question, prephrase prompt "Guess before you look", timer 1:14 against a 2:30 target, client and opposing-counsel portraits loaded |
| `demo-firm-upgrades.png` | captured | Firm → Upgrades, $6.66M treasury, Tier 5 Regional Headquarters locked, owned upgrades below |
| `demo-office.png` | captured | Tier-4 office in 3D with 35 staff, character panel, lease strip |
| `demo-office-tier0.png` | `.shots-keep/tier-00-practice-2-owned.png` | The rundown shack: one desk, a cat, a stove, near-dark |
| `demo-office-tier14.png` | `.shots-keep/tier-14-practice-full.png` | Full tier-14 practice floor, two rows of desks, floor directory overlay |
| `demo-map.png` | captured | Old Quarter district in 3D, café terraces, the lawyer figure mid-street, region rail across the top |
| `scene-office-tier0.png` | byte copy of `demo-office-tier0.png` | same |
| `scene-office-tier14.png` | byte copy of `demo-office-tier14.png` | same |

The five captured files are 1.5–8.9 MB each because of the 2× scale; `demo-map.png`
is the big one. They are served from `public/` on localhost so nothing downloads
them over a network, but if a slide ever needs several at once it is worth
knowing.

## Servers left running

Both were already up when this work started and are still up. Do not kill them.

- backend, pid 56442, `run.py` on `127.0.0.1:5001`, `DEV_AUTH_ENABLED` on (from
  `backend/.env`, not from the environment)
- frontend, pid 49059, `frontend/node_modules/.bin/vite` on `:5173`
