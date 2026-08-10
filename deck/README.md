# Lawyer Tycoon — the deck

A 23-slide pitch deck that frames the real product, live, on seven of its slides.
9:40 of talk, 3:14 of it inside a running app.

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

Vite prints `http://127.0.0.1:5180/` in the terminal because the dev server binds
to that address. Do not click it. Type `localhost` yourself. The same applies to
signing in: sign in at `http://localhost:5173/login`, not at `127.0.0.1:5173`.

---

## Start-up, in order

Four terminals, from the repository root. Each step assumes the one before it
finished.

### 1 — Backend, port 5001

```bash
cd backend
PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py
```

5001 is not negotiable: the frontend's Vite proxy targets that port only.
`DEV_AUTH_ENABLED=true` is what enables the dev-login button in step 4.

### 2 — Seed the demo account

```bash
../.venv/bin/python backend/scripts/seed_demo.py --apply
```

This installs the lived-in demo account and leaves one case open on a strategy
prompt.

**Expect it to exit 1 with a traceback**, in `_verify()`, on `KeyError: 'status'`.
That is a known, cosmetic failure: `_verify()` still expects the old shape of
`strategy_performance()`, it runs *after* every write, and the seeder commits as
it goes. The account, the firm and the staged live case are fully installed by
the time it falls over. What is lost is the JSON report, which is why step 5 has
a fallback.

### 3 — Frontend dev server, port 5173

```bash
cd frontend
npm run dev
```

### 4 — Sign in once, by hand, in the browser you will present from

A Playwright profile is not your Chrome profile, so this cannot be automated for
you.

1. Open `http://localhost:5173/login`.
2. Click **Enter local development firm**. That signs you in as
   `student@localhost.test`.
3. In that same tab's devtools console, suppress the guided tour:
   ```js
   localStorage.setItem('lsat-tycoon:guided-tour:v6', 'complete')
   ```
4. While you are there, visit `http://localhost:5173/office` and
   `http://localhost:5173/map` once each. The first office build of the day takes
   about nine seconds while Vite transforms the scene module; warm it now, not in
   front of an audience.

### 5 — Wire the deck to the seeded session

```bash
cd deck
npm run prepare-demo
```

It runs the seeder, works out the open case's session id, writes it into
`demo.config.ts`, and proves in a headless browser that a localhost page can frame
the signed-in app. Because the seeder cannot print its report (step 2), the script
falls back to signing in against the backend directly and reading
`/v1/study-sessions/current` — the same answer the app's own "Resume current run"
button uses. It says out loud which of the two routes it took.

Useful flags: `--skip-seed` (re-resolve the session and rewrite the config without
re-seeding), `--email <address>`, `--help`.

**Re-run this shortly before presenting.** Opening the live case starts its clock,
so after a rehearsal the case header will read something like 8:26 against a 2:30
target, in warning colours. Re-running re-seeds and stages a fresh case with the
timer at zero.

### 6 — The deck, port 5180

```bash
cd deck
npm run dev
```

Then open **`http://localhost:5180`** and press `F` for fullscreen.

### If `prepare-demo` cannot find the session

Paste it in by hand. Get the id from the app: open
`http://localhost:5173/progress`, click **Resume current run**, and read the id out
of the URL — `/cases/<this-part>`. Then edit
[`demo.config.ts`](./demo.config.ts):

```ts
export const demoConfig: DemoConfig = {
  appOrigin: 'http://localhost:5173',
  liveSessionId: '69bb283e-9312-41bd-ae44-837ea1751e3b', // ← paste here
  useStills: false,
}
```

Only `demo-case-answer` needs it — it is the one route with `{session}` in it. An
empty string is handled: that slide falls back to its still image rather than
framing a broken URL.

---

## Keyboard

| Key | Does |
| --- | --- |
| `→` `↓` `space` `PageDown` `enter` | Next slide |
| `←` `↑` `PageUp` `backspace` | Previous slide |
| `Home` / `End` | First / last slide |
| `G` | Grid overview of all 23 slides — click one to jump |
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

**Every demo shows the login screen.** You opened the deck on `127.0.0.1` instead
of `localhost`, or you signed in on `127.0.0.1:5173`. Close the tab, sign in at
`http://localhost:5173/login`, and reopen the deck at
`http://localhost:5180`. See [The one rule](#the-one-rule).

**A demo frame says "app not running".** The frontend dev server on 5173 is down,
or the backend on 5001 is. Press `S` and carry on with stills; the deck is
designed to be presentable that way. Fix it between acts, not on stage.

**The session expired, or the case shows a wrong timer.** Re-run
`npm run prepare-demo` in `deck/`. It re-seeds and stages a fresh case at zero,
and rewrites `demo.config.ts`. If the backend is up but the seeder is being
difficult, `npm run prepare-demo -- --skip-seed` will at least re-resolve the
session id.

**"WebGL context lost", or a scene renders black.** The deck keeps at most three
app scenes plus its own stage alive, but a projector switch or a GPU hiccup can
still drop a context. Reload the page — the deck restores the current slide from
the hash, so you land back where you were rather than at slide 1. If it happens
twice, press `S` for the rest of the talk: the slides that use a scene still read,
and the demo slides fall back to stills.

**The office slide takes forever the first time.** That is Vite transforming the
office chunk, about nine seconds cold against 1.4 seconds warm. Step 4 exists to
prevent it. If it happens live, keep talking; do not reload.

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

9:40 total. 3:14 of it live in the app, across the seven bolded slides.

| # | Slide id | Speaker | Seconds | Cumulative |
| --- | --- | --- | ---: | ---: |
| 1 | `title-lawyer-tycoon` | Nischay | 16 | 0:16 |
| 2 | `problem-coaching-tax` | Nischay | 27 | 0:43 |
| 3 | `problem-hours-and-price` | Nischay | 32 | 1:15 |
| 4 | `turn-nothing-to-teach` | Nischay | 30 | 1:45 |
| 5 | `thesis-speedrun` | Nischay | 21 | 2:06 |
| 6 | `pov-reasoning-is-the-work` | Nischay | 28 | 2:34 |
| 7 | `pov-confidence-signal` | Nischay | 20 | 2:54 |
| 8 | `concept-lawyer-tycoon` | Nischay | 26 | 3:20 |
| 9 | `pov-ai-never-answers` | Alan | 27 | 3:47 |
| 10 | `pov-strategy-inside-the-question` | Alan | 22 | 4:09 |
| 11 | `pov-real-clock` | Alan | 21 | 4:30 |
| 12 | `demo-case-answer` | Alan | **56** | 5:26 |
| 13 | `demo-case-verdict-review` | Alan | **38** | 6:04 |
| 14 | `demo-mega-litigation` | Alan | **38** | 6:42 |
| 15 | `dashboard-everything` | Alan | 30 | 7:12 |
| 16 | `pov-virtual-currency` | Alan | 21 | 7:33 |
| 17 | `game-by-design` | Alan | 17 | 7:50 |
| 18 | `demo-clients-walk-in` | Alan | **16** | 8:06 |
| 19 | `demo-office-transformation` | Alan | **18** | 8:24 |
| 20 | `demo-map-and-firm` | Alan | **18** | 8:42 |
| 21 | `demo-focus-mode` | Alan | **10** | 8:52 |
| 22 | `game-never-gates` | Alan | 20 | 9:12 |
| 23 | `close-one-stop-shop` | Nischay | 28 | 9:40 |

Pacing assumes roughly 170 spoken words per minute. Every figure is derived from
its slide's note length, so a slower speaker scales the whole table.

**Demo overrun is the thing that breaks this deck.** Slides 12, 13, 14, 18, 19, 20
and 21 each carry a written click path with per-beat seconds and an explicit list
of what to skip. Rehearse against those, not against the total.

---

## Cut list

If you are running long, cut in this order and stop when you fit. All six lands
you at **8:32**.

| # | Slide | Saves | What replaces it |
| --- | --- | ---: | --- |
| 1 | `pov-real-clock` | −21 | Fold into the mega-litigation demo, which already shows the clock. Alan adds "timed to real pacing from day one, and full forms are optional" over the click path. |
| 2 | `pov-confidence-signal` | −17 | Fold the confidence claim into `pov-reasoning-is-the-work` as one sentence. |
| 3 | `game-by-design` | −14 | Alan names two of the four Clark splits over the office transformation instead. |
| 4 | `demo-map-and-firm` → 10s | −8 | Map pull-back only; describe the firm tab without clicking. |
| 5 | `dashboard-everything` → 26s | −4 | Let the ring assemble and name six of the twelve. |
| 6 | `title-lawyer-tycoon` → 12s | −4 | Names and product category only; slide 2 carries the opening. |

**Never cut, under any circumstances:** `turn-nothing-to-teach`,
`pov-reasoning-is-the-work`, `pov-ai-never-answers`, `demo-case-answer`,
`demo-office-transformation`, `game-never-gates`, `close-one-stop-shop`.

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
