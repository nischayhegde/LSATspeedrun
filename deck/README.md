# Lawyer Tycoon — the deck

A 24-slide pitch deck that frames the real product, live, on six of its slides —
a seventh demo slide is a deliberate still rather than an embed.
4:54 of talk, 1:22 of it inside a running app.

This file is the runbook. Read **Start-up** before presentation day and
**Troubleshooting** on it.

- The narrative, verbatim, with visual direction and speaker notes: [`NARRATIVE.md`](./NARRATIVE.md)
- The fact-check behind every number: [`CITATIONS.md`](./CITATIONS.md)
- What was measured against the real stack: [`DEMO-NOTES.md`](./DEMO-NOTES.md)
- The slides themselves: [`src/slides/index.ts`](./src/slides/index.ts)

---

## The one rule

**Open the deck at `http://localhost:5180`. Never at `http://127.0.0.1:5180`, and
never from `file://`.**

The app's session cookies (`lsat_session`, `lsat_csrf`) are `SameSite=Lax`, so
they only ride along with a framed request when the framing document and the
frame are the *same site* — and site is compared by host, not by port.
`localhost:5180` framing `localhost:5173` is same-site and stays signed in.
`127.0.0.1:5180` framing `localhost:5173` is cross-site, the cookie is withheld,
and **every embedded demo silently lands on the login screen.** A `file://` page
fails the same way.

The deck's dev server binds the name `localhost`, so `127.0.0.1:5180` will refuse
the connection outright rather than serve you a deck whose demos are all login
screens. If a link or a script gives you "connection refused" on 5180, that is
this, and the fix is to type `localhost`.

---

## Start-up, on the day

Three terminals, three commands, then present. **You will not be asked to sign in,
and you must not sign in** — the deck signs itself in during preflight, while the
title card is up. See [Why there is no sign-in step](#why-there-is-no-sign-in-step).

### 1 — Backend, port 5001

```bash
cd backend
PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py
```

5001 is not negotiable: both Vite proxies target that port only.
`DEV_AUTH_ENABLED=true` is not optional either — it is what lets the deck
establish its own session. Without it the start card will tell you so, in red,
before you begin.

### 2 — Frontend dev server, port 5173

```bash
cd frontend
npm run dev
```

### 3 — The deck, port 5180

```bash
cd deck
npm run dev
```

Open **`http://localhost:5180`** and press `F` for fullscreen. The start card runs
five checks and shows five dots at the bottom right; all green means every live
demo will work. Press <kbd>Enter</kbd> to begin.

That is the whole sequence. Nothing to sign into, nothing to paste into a devtools
console, no browser profile that has to be the same one as last time.

### Why there is no sign-in step

It used to be step 4 of six: open the app's login page, click **Enter local
development firm**, then paste a localStorage key to stop the guided tour opening
over the demos.

Both were invisible per-browser-profile state, and that made the demos a trap. They
worked on the machine they were built on, and they would have failed on a fresh
profile, in another browser, in a guest window, after a cookie clear, or on a
borrowed laptop — by showing an audience a login screen. The two fixes:

- **The session.** `StartGate` runs the preflight on mount, and the preflight calls
  `POST /v1/auth/dev` — the same endpoint that login button calls — through the
  deck's own `/demo-api` proxy, so the cookie lands on host `localhost` and is sent
  to the app on 5173. It only fires when `/v1/me` has already answered 401, so a
  reload is a no-op rather than a second login.
- **The guided tour.** `stage_demo.py` marks the demo account as already oriented
  server-side (`guided_tour_completed_at`), which holds for every browser at once
  rather than one profile's localStorage.

Verified on a genuinely cold browser context — empty cookie jar, nothing signed in
— by `node scripts/verify-cold-start.mjs`, which also proves the start card fails
loudly when the sign-in cannot be made.

### Before the day — stage the demo data

Not part of the three steps, and not needed on presentation morning unless you
have rehearsed since staging. **A rehearsal consumes the demo state**: opening the
live case starts its 2:30 clock, so after one run-through the case header reads
something like 8:26 in warning colours, and the question may be answered.

```bash
cd deck
npm run reset-demo
```

That stages a fresh open case with the timer at zero, keeps the pre-graded verdict
so the review slide never waits on a model call, silences the guided tour, and
rewrites both session ids in `demo.config.ts`. It takes a few seconds and is safe
to run repeatedly. Run it once the night before and once again if you rehearse.

Useful flags on `npm run prepare-demo`: `--skip-seed` (re-resolve the session and
rewrite the config without re-seeding), `--email <address>`, `--help`.

### If `prepare-demo` cannot find the session

Paste it in by hand. Get the id from the app: open
`http://localhost:5173/progress`, click **Resume current run**, and read the id out
of the URL — `/cases/<this-part>`. Then edit
[`demo.config.ts`](./demo.config.ts):

```ts
export const demoConfig: DemoConfig = {
  appOrigin: 'http://localhost:5173',
  liveSessionId: '69bb283e-9312-41bd-ae44-837ea1751e3b', // ← paste here
  verdictSessionId: '...',
  demoEmail: 'student@localhost.test',
  useStills: false,
}
```

Only `demo-case-answer` needs `liveSessionId` — it is the one route with
`{session}` in it — and only `demo-verdict` needs `verdictSessionId`. An empty
string is handled: those slides fall back to their still images rather than framing
a broken URL. `demoEmail` is the account the deck signs itself in as, and it has to
match the one the demo data is seeded under.

---

## Keyboard

| Key | Does |
| --- | --- |
| `→` `↓` `space` `PageDown` `enter` | Next slide |
| `←` `↑` `PageUp` `backspace` | Previous slide |
| `Home` / `End` | First / last slide |
| `G` | Grid overview of all 24 slides — click one to jump |
| `P` | Presenter notes: this slide's notes, what's next, the clock, ahead/behind |
| `Q` | Q&A panel: ammunition, evidence warnings, the cut list — searchable |
| `A` | Reveal the next demo callout |
| `S` | Force still images for every demo, on and off |
| `F` | Fullscreen |
| `R` | Reset the presenter clock |
| `esc` | Close whatever overlay is open |

Two URL switches do the same jobs before the deck loads: `?notes` (or `?present`)
opens with the presenter overlay already up, for rehearsal, and `?stills=1` forces
still images from the first frame.

### Deep links

Every slide is a hash route, so any of these can be a bookmark or a jump mid-talk:

```
http://localhost:5180/#/turn-nothing-to-teach
http://localhost:5180/#/demo-case-answer
http://localhost:5180/#/close-one-stop-shop
```

The id is the one in the timing table below. Browser back and forward work.

---

## Forcing the still-image fallback

Three ways, in increasing order of commitment:

1. **`S`, any time.** Swaps every demo in the deck to its captured still,
   immediately. Press it again to go back. This is the on-stage escape hatch: if a
   demo misbehaves, it is one keystroke away.
2. **`?stills=1` on the URL.** Same thing, from the first frame:
   `http://localhost:5180/?stills=1`.
3. **`useStills: true` in [`demo.config.ts`](./demo.config.ts).** For a dry run on
   a machine with no stack running at all.

The deck also does this on its own: each demo frame probes the app origin on
mount, and swaps to a still if it is not answering. The small lamp in the frame's
title bar says which you are looking at — `live`, `stills`, `connecting`,
`app not running`, or `no seeded session`.

The stills are real captures of this seeded account, in `public/stills/`, and they
are the images the slides were composed against. They are a real fallback, not a
theoretical one.

---

## Troubleshooting

**Every demo shows the login screen.** Do not sign in — that treats the symptom
and hides the cause. Two things produce this, and the start card names both:

- The deck is on `127.0.0.1:5180` rather than `localhost:5180`, so the framed app
  is cross-site and its cookie is withheld. See [The one rule](#the-one-rule).
- The backend was started without `DEV_AUTH_ENABLED=true`, so the deck could not
  establish its own session. Restart it as in step 1 and reload the deck.

Reloading the deck is always safe: it re-runs the preflight, which re-establishes
the session if it is missing and reloads any embed that had loaded without it.

**A demo frame says "app not running".** The frontend dev server on 5173 is down,
or the backend on 5001 is. Press `S` and carry on with stills; the deck is
designed to be presentable that way. Fix it between acts, not on stage.

**The session expired, or the case shows a wrong timer.** Re-run
`npm run reset-demo` in `deck/`. It stages a fresh case at zero, keeps the
pre-graded verdict, and rewrites both session ids in `demo.config.ts`. If the
backend is up but the seeder is being difficult,
`npm run prepare-demo -- --skip-seed` will at least re-resolve the session id.

**"WebGL context lost", or a scene renders black.** The deck keeps at most three
app scenes plus its own stage alive, but a projector switch or a GPU hiccup can
still drop a context. Reload the page — the deck restores the current slide from
the hash, so you land back where you were rather than at slide 1. If it happens
twice, press `S` for the rest of the talk: the slides that use a scene still read,
and the demo slides fall back to stills.

**The office slide takes forever the first time.** That is Vite transforming the
office chunk, about nine seconds cold against 1.4 seconds warm. The start card
warms both scene routes in hidden frames while it is up, so this should not happen
— unless you pressed Start within a second or two of the deck loading, which skips
the warm-up. If it happens live, keep talking; do not reload.

**The projector is not 16:9.** The deck lays out fluidly and the demo frames scale
to fit their slot, so nothing crops — but a 16:10 or 4:3 projector will letterbox
the 3D scenes and make the demo frames smaller. Two mitigations: press `F` for
fullscreen so the browser chrome is not eating the top of the frame, and if the
app inside a demo is too small to read from the back, raise `zoom` on that slide's
`demo` block (it shrinks the logical width, which magnifies everything). Do that
in rehearsal, not on stage.

**A keystroke does nothing.** Check whether focus is inside the Q&A search box or
a demo iframe — the deck deliberately does not swallow keys aimed at an input, and
an iframe with focus receives its own keys. Click the slide background first.

---

## Where to edit copy

All of it is in **[`src/slides/index.ts`](./src/slides/index.ts)**, one object per
slide, in presentation order. Nothing in `engine/`, `scenes/` or `layouts.tsx`
contains a single word of copy, which is what makes it safe for a founder to
reword a slide the night before.

**You own these fields, and changing them cannot break the deck:**

| Field | What it is |
| --- | --- |
| `eyebrow` | the small line above the headline |
| `headline` | the slide's one claim |
| `deck` | one or two sentences under it |
| `points[]` | the fragment line under the slide — set as a numbered ledger on the text layouts, and as one middot-separated row on the figure layouts |
| `pull` | the single quotable line, where the layout uses one |
| `attribution` | the citation for `pull` |
| `credit` | the hairline source line in the corner |
| `notes` | speaker notes — `P` only, never on the audience screen |
| `speaker` | `'Alan'` or `'Nischay'` |

**Do not change `id`, `section`, `kind`, `field`, `figure`, `scene`, `demo` or
`transition`.** Those are staging. `id` is the deep link, so changing one breaks a bookmark the
presenter may already have and silently changes which slide `#/pov-real-clock`
lands on. The other five re-choreograph the deck: `transition` decides how a slide
arrives, `scene` decides what is behind it, and two consecutive slides naming the
same scene get a continuous camera move instead of a cut — so changing one slide's
scene can quietly turn a camera move somewhere else into a hard blend.

**Length is not enforced by the layout, so it is on you.** Headlines of six to
nine words, decks under thirty, at most five points. A fifteen-word headline will
render — it will just be small, and the `type` transition animates one glyph at a
time so it will take noticeably longer to land. The deck's whole design premise is
that the founders carry the room by speaking: if a detail will not fit, it belongs
in `notes`.

`dashboard-everything` is the one deliberate exception, with twelve signals. The
founders asked for the complete list on a single slide, so it is drawn as a
radial diagram — the Speedrun Index at the centre, the other eleven as nodes on
two rings — rather than set as body copy. Those twelve labels live in that
slide's `figure.nodes`, not in `points`, because printing them in both places
would put the whole list next to itself at half the size.

**The figures.** Twelve slides carry a `figure`, which is the graphic that
*is* the argument on that slide: the two bars on `problem-coaching-tax`, the
four re-sorting tiles on `pov-confidence-signal`, the paired Clark bars on
`game-by-design`. The numbers inside them are copy in every sense that matters —
several are figures `CITATIONS.md` had to correct — so they sit in this registry
rather than inside the components, and correcting 0.22 or `$65–$425` is a
one-line edit here. Changing the *shape* of a figure (its `kind`, or which
fields it has) is a layout change and belongs with staging.

**Budgets.** `budgetSeconds` on each slide drives the pacing bar in the presenter
overlay, and the seven demo slides carry a second, harder budget inside their
`demo` block, alongside the click path and the skip list. If you change a slide's
copy enough to change how long it takes to say, change `budgetSeconds` with it —
the overlay's ahead/behind figure is only as honest as those numbers.

Speaker notes and Q&A material live apart from the slides, in
[`src/notes/`](./src/notes): the Q&A ammunition, the evidence-integrity warnings
with their one open action, and the cut list. Same rule — it is data, edit the
data.

---

## Timing table

4:54 total. 1:22 of it live in the app, across the six bolded slides.

| # | Slide id | Speaker | Seconds | Cumulative |
| --- | --- | --- | ---: | ---: |
| 1 | `title-lawyer-tycoon` | Nischay | 7 | 0:07 |
| 2 | `problem-coaching-tax` | Nischay | 12 | 0:19 |
| 3 | `problem-hours-and-price` | Nischay | 11 | 0:30 |
| 4 | `turn-nothing-to-teach` | Nischay | 12 | 0:42 |
| 5 | `thesis-speedrun` | Nischay | 10 | 0:52 |
| 6 | `pov-reasoning-is-the-work` | Nischay | 14 | 1:06 |
| 7 | `pov-confidence-signal` | Nischay | 11 | 1:17 |
| 8 | `pov-volume-is-the-constraint` | Nischay | 21 | 1:38 |
| 9 | `concept-lawyer-tycoon` | Nischay | 14 | 1:52 |
| 10 | `pov-ai-never-answers` | Alan | 13 | 2:05 |
| 11 | `pov-strategy-inside-the-question` | Alan | 11 | 2:16 |
| 12 | `pov-real-clock` | Alan | 10 | 2:26 |
| 13 | `demo-case-answer` | Alan | **30** | 2:56 |
| 14 | `demo-case-verdict-review` | Alan | **13** | 3:09 |
| 15 | `demo-mega-litigation` | Alan | **14** | 3:23 |
| 16 | `dashboard-everything` | Alan | 12 | 3:35 |
| 17 | `pov-virtual-currency` | Alan | 13 | 3:48 |
| 18 | `game-by-design` | Alan | 8 | 3:56 |
| 19 | `demo-clients-walk-in` | Alan | **9** | 4:05 |
| 20 | `demo-office-transformation` | Alan | **9** | 4:14 |
| 21 | `demo-map-and-firm` | Alan | **8** | 4:22 |
| 22 | `demo-focus-mode` | Alan | *8* | 4:30 |
| 23 | `game-never-gates` | Alan | 11 | 4:41 |
| 24 | `close-one-stop-shop` | Nischay | 13 | 4:54 |

Slide 22's figure is *italicised* rather than bolded because it is not a live
embed: `demo-focus-mode` carries `stillOnly`, and its eight seconds are speech
over a frozen frame. The six bolded slides are the live ones.

Pacing assumes roughly 170 spoken words per minute. Every figure is derived from
its slide's note length, so a slower speaker scales the whole table.

**Demo overrun is the thing that breaks this deck.** `demo-case-answer`,
`demo-case-verdict-review`, `demo-mega-litigation`, `demo-clients-walk-in`,
`demo-office-transformation`, `demo-map-and-firm` and `demo-focus-mode` each
carry a written click path with per-beat seconds and an explicit list of what to
skip. Rehearse against those, not against the total. (They are named by id rather
than by index because the deck gets renumbered often enough that a written
"slide 12" goes stale — the convention `DEMO-NOTES.md` §3 states.)

---

## Cut list

**There is no cut list any more, and that is deliberate** — see §C of
[`NARRATIVE.md`](./NARRATIVE.md), which governs. At 4:54 against a 4–5 minute cap
there are 6 seconds of headroom, which is less than one stumble, and every slide
is now short enough that there is nothing to trim inside one: it is either said
or it is not. The order below is what to do if a cut is forced anyway. Each entry
saves exactly that slide's current budget, no single one buys much, and all six
together buy 56 seconds at the cost of six beats.

| # | Slide | Saves | What replaces it |
| --- | --- | ---: | --- |
| 1 | `pov-real-clock` | −10 | Fold into the mega-litigation demo, which already shows the clock. Alan adds "timed to real pacing from day one, and full forms are optional" over the click path. |
| 2 | `pov-confidence-signal` | −11 | Fold the confidence claim into `pov-reasoning-is-the-work` as one sentence. |
| 3 | `game-by-design` | −8 | Alan names two of the four Clark splits over the office transformation instead. |
| 4 | `demo-map-and-firm` | −8 | Describe the map and the firm tab in one sentence over the preceding slide's last frame. |
| 5 | `dashboard-everything` | −12 | The twelve signals go unshown, and the calibration argument goes with them into Q&A. |
| 6 | `title-lawyer-tycoon` | −7 | Nischay says the names and the product category over slide 2's opening frame. |

**Never cut, under any circumstances:** `turn-nothing-to-teach`,
`pov-reasoning-is-the-work`, `pov-volume-is-the-constraint`,
`pov-ai-never-answers`, `demo-case-answer`, `demo-office-transformation`,
`game-never-gates`, `close-one-stop-shop`.

**Do not trim `problem-hours-and-price` either.** Every corrected number in the
problem act lives there — the attributed hours, the competitors' own published
curricula, and the real price ladder. Cutting it for time is how a wrong figure
gets improvised back in.

---

## The morning of the pitch

One item, and it is the only thing in the evidence review that is still open:

**Re-check both competitor pricing pages** — <https://7sage.com/self-study/pricing>
and <https://www.lsatlab.com/pricing> — and update the price ribbon on
`problem-hours-and-price` and the pricing answer in `src/notes/qa.ts` if anything
moved. 7Sage was running a $79 first-month promotion on the Live tier as of
2026-08-10, and promotional pricing changes without notice. This is the one line
in the deck that anyone in the room can falsify from a phone in four seconds.

Everything else in the evidence review is closed; press `Q` to read it.

---

## What is in git, and how to rebuild what is not

The deck's sources are versioned. Its generated and copied artefacts are not,
because `deploy-sandbox.ps1` runs `git add --all` before it commits a release —
every tracked byte is pushed to main and re-fetched onto a 1 GiB build box.

Ignored, and how to get each one back:

| Path | Size | Rebuild with |
|---|---|---|
| `node_modules/` | 106 MB | `npm install` |
| `dist/` | 45 MB | `npm run build` |
| `.deck-shots/` | 181 MB | `npm run shoot` (see `--help` for the flags) |
| `tsconfig.tsbuildinfo` | — | any `tsc -b` |
| `public/art/` | 18 MB | `cp -R ../frontend/public/art/. public/art/` — run from `deck/` |

`public/art/` is the one worth explaining. It is a byte-identical copy of
`frontend/public/art/` (218 `.webp` catalog cards), which is itself tracked, so
versioning it here would carry the same 18 MB twice for no added safety. The
copy is documented as a copy in [`src/app-art/PORT.md`](./src/app-art/PORT.md),
and `diff -r public/art ../frontend/public/art` should always be silent. Run the
`cp` after a fresh clone, and again whenever the app's catalog art changes.

**`public/stills/` is tracked, deliberately, at 26 MB.** Nothing in this
repository regenerates it. The five route stills were captured by hand against a
seeded account in one specific state — a case 3 of 8 at 1:14, a $6.66M treasury,
a tier-4 office with 35 staff — and re-seeding produces a different state, not
those frames. The two office-tier stills were lifted from `.shots-keep/`, which
is git-ignored, so their originals are not in the repository either. They are
the fallback the whole talk leans on when a demo dies on stage, and they are the
images the slides were composed against. Do not add them to `.gitignore` on the
grounds that they are big. If they ever do get a generator, ignore them then.
