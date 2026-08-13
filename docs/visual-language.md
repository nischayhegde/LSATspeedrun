# Visual language

What the app's surfaces are actually made of, derived from the shipped
stylesheets and from computed styles read out of the running app — not from
intent. Where the code and this document disagree, the code is the fact and
this document is the bug.

There was no such document before this one. `planning/2026-07-22-visual-overhaul-design.md`
is the nearest thing and it is a *design brief* for one change, written before
that change landed. It is still worth reading for the reasoning, but two of the
things it states are no longer true of the code (see
[Where the old brief is stale](#where-the-old-brief-is-stale)).

## The short version

A parchment ground with deep-navy panels on it, brass and amber for value and
emphasis, teal for measurement and progress, and brick for cost and risk. Panels
are physical: hard ink borders and a solid offset shadow, as though a card were
sitting on a desk. Type is a three-face system — a display serif for headings, a
grotesque for HUD labels, and a UI sans for everything a reader actually reads.

## Type

Three faces, all declared in one place: the `:root` block at the top of
`frontend/src/styles.css`.

| Token | Stack | Job |
| --- | --- | --- |
| `--font-display` | Fraunces → Georgia → serif | `h1`–`h3`, card titles, large figures, cutscene lettering |
| `--font-pixel` | Archivo → Inter → system sans | Eyebrows, HUD labels, badges, tab labels, status chips |
| `--font-body` | Inter → system sans | Body copy, descriptions, supporting prose. The document default. |

`--font-pixel` is a misnomer kept for compatibility: it names the Archivo stack,
not a pixel face. Roughly a hundred declarations reference it and renaming it is
a mechanical change nobody has needed enough to make. It is the *label* face.

Headings track at `-.01em` for all three levels, set once on `h1, h2, h3` in
`styles.css`.

### Rules

- Never name a family literally. `Georgia, serif` in particular was the display
  face before Fraunces and is now only the fallback inside `--font-display`;
  writing it by hand pins an element to the stand-in.
- The eyebrow is one component with two class names, `.eyebrow` and
  `.pixel-kicker`. Its face, size, weight, line-height and tracking are set once
  in `styles.css`: Archivo 900, 11px, `.14em`, `1.2`. `.eyebrow` additionally
  takes `--gold-dark` unless a page recolours it. Per-component size overrides
  exist and are tolerated where space is genuinely tight; tracking overrides are
  not.
- Do not introduce a fourth face, and do not introduce a second name for one of
  these three. `--font-ui` and `--font-mono` were exactly that and are gone.

## Colour

Two token families, both on `:root` in `styles.css`.

The **paper** set is the older, lighter layer: `--ink`, `--navy`, `--navy-2`,
`--muted`, `--line`, `--surface`, `--paper`, `--gold`, `--gold-dark`,
`--gold-soft`, `--green`, `--green-soft`, `--red`, `--red-soft`.

The **pixel-empire** set is the game layer and is what most of the app's chrome
is built from: `--pixel-ink #171923`, `--pixel-night #101725`, `--pixel-blue`,
`--pixel-blue-2`, `--pixel-paper #f6e7bf`, `--pixel-paper-dark`,
`--pixel-gold #f2c75b`, `--pixel-gold-dark`, `--pixel-cyan`, `--pixel-green`,
`--pixel-red`, `--pixel-shadow #090d15`.

Semantics, as used:

- **Brass / amber** — money, value, the primary action, the current thing.
- **Teal / cyan** — measurement, progress, accuracy, anything the app has counted.
- **Brick / maroon** — cost, risk, heat, scandal, destructive actions.
- **Parchment** — the ground and any surface meant to read as paper.
- **Deep navy** — panels, and anything that should read as a screen or a
  lacquered surface sitting on the paper.

Honest caveat: the token set describes the intent, and the app does not
consistently use it. There are 1,634 distinct hex literals across the
stylesheets, including about ten near-identical teals and a similar spread of
golds where one token would do. See [Known drift](#known-drift).

## Surfaces

The signature is a **hard border and a solid offset shadow** — no blur, no
spread. Two scales are in use and both are legitimate:

- **Card**: `3px` ink border, `radius: 0`, `box-shadow: 5px 5px <ink>`, often
  with an `inset 0 0 0 2px` liner in a lighter tone.
- **Hero panel**: `4–5px` ink border and an `8px 9px` offset shadow. The story
  hero and the rival war room are at this scale.

`--pixel-border` (`3px solid var(--pixel-ink)`) names the card border. There is
deliberately no token for the hero scale; it is used in two places.

Alongside these, `--el-1` / `--el-2` / `--el-3` define three steps of soft
elevation for the dark dashboard panels. They exist and are barely used — see
[Known drift](#known-drift).

### Do not reintroduce

- **Backdrop blur.** It was removed from several surfaces for measured scroll
  performance. There are currently zero `backdrop-filter` declarations in the
  frontend and it should stay that way. If a surface genuinely needs it, raise
  it rather than adding it.
- **Weight in the entry stylesheet.** `frontend/src/styles.css`, `art/art.css`,
  `review-panels.css`, `case-instrument.css` and `mobile.css` are the entry
  sheet, which every screen blocks on. It was deliberately cut down to improve
  first contentful paint. Route-specific rules belong in the route's own sheet.

## Motion

`--mo-1` … `--mo-4` for duration, `--mo-out` / `--mo-in` / `--mo-spring` /
`--mo-brass` for easing, `--mo-step` for stagger, all on `:root` in
`styles.css`, with shorter values under `620px` and `380px`. Only transform,
opacity and colour are animated, nothing loops, and every keyframe declares
`both` and states only its `from` frame so that reduced motion lands the
finished state rather than freezing on the first.

## The cascade, and why it keeps biting

This is the part most likely to cause a bug that looks like a design decision.

Sheets resolve in this order in a **production build**: route sheets (emitted as
real `<link>`s by `lsat-route-stylesheets` in `vite.config.ts`), then the entry
sheet — `review-panels.css`, `styles.css`, `art/art.css`, `case-instrument.css`,
`mobile.css`, in that order, as imported by `main.tsx`.

**In dev this is not true.** `lsat-route-stylesheets` is `apply: 'build'`. On the
dev server a route sheet is injected when its chunk executes, which for a lazily
imported sheet is *after* the entry sheet. So any rule where a route sheet and
the entry sheet tie on specificity resolves the opposite way in dev and in
production. `.rival-war-room` is a live example — see
[Known drift](#known-drift). Anything verified by screenshot should be checked
against a build; `tools/theme-audit/prod-check.mjs` does that.

The corollary: **a token or a base rule must be declared exactly once.** Where
two sheets both declared one, what shipped was decided by import order rather
than by anyone. Four cases of this were found and fixed in August 2026; the
scans that find them are `tools/theme-audit/token-clashes.mjs` and
`tools/theme-audit/selector-clashes.mjs`, and both should come back clean.

## Considered exceptions

Places that are off-system on purpose. Leave them alone.

- **`.passage-text, .stimulus`** (`case-session-styles.css`) is set in
  `Georgia, "Times New Roman", serif`. This is the LSAT stimulus, and the serif
  is a reading face chosen to match the printed test. It is deliberately neither
  the display face nor the body face, and it is the only hand-named family left
  in the app.
- **`.asset-card .requirements`** (`firm-page.css`) is in the label face at
  9.5px with a diamond bullet. It reads as prose but functions as a status line,
  and it is sized and marked as one.
- **`.progress-panel-fallback`** is declared in both `review-panels.css` and
  `styles.css`. This is layering, not a clash: the first supplies the box, the
  second deliberately repaints it as a ruled ledger, `border-style: solid`
  included. The comment above it in `styles.css` says so.
- **`/firm`'s page heading** is Archivo 900 uppercase where every other route's
  `h1` is Fraunces 620. It is part of a coherent local treatment — the whole
  route is styled as a manila catalogue — but it is the one place the app's
  heading face is not the display face, and it should be a deliberate decision
  rather than an inherited one.

## Known drift

Real, measured, and deliberately not fixed in the August 2026 sweep because each
is a large mechanical change that would be unreviewable mixed in with anything
else. Roughly in order of how much they cost.

1. **1,634 distinct hex literals**, against a token set of about 25 colours.
   The worst clusters are ten near-identical teals (`#74d3c1`, `#74d2bf`,
   `#70cabb`, `#6fc9ba`, `#79d0be`, `#73c9b9`, `#72cfbf`, `#8fdccb`, `#72b6ad`,
   `#7fd0ac`) and a comparable spread of golds and brick reds. One accent, ten
   spellings.
2. **345 distinct `box-shadow` values.** `--el-1/2/3` were introduced precisely
   so that "raised" would mean one distance, and they are referenced five times.
3. **60 distinct `border-radius` values**, covering every integer from 2 to 22.
   There is no radius scale token at all. Some of the 60 are organic shapes in
   the illustration CSS and are fine; the UI chrome ones are not.
4. **Eyebrow sizes** range from 7.5px to 11.5px across nine per-component
   overrides. The base is now single-sourced; the overrides are not audited.
5. **`.rival-war-room`** is declared in both `rival-war-room.css` (tokenised,
   using `--pixel-border` and `--pixel-shadow`) and `styles.css` (hardcoded
   `5px solid #080b11`, `8px 9px #1d1713`). Production renders the hardcoded
   one and dev renders the tokenised one. The hardcoded values are the ones that
   match the hero-panel scale, so the fix is probably to delete the tokenised
   block rather than to promote it — but it needs a look at both.

`tools/theme-audit/scan.mjs` regenerates all of these counts.

## Where the old brief is stale

`planning/2026-07-22-visual-overhaul-design.md` says `--font-pixel` "is
redefined to the Archivo stack". That happened in `art/art.css` while
`styles.css` went on declaring it as a Courier New stack, so the app had two
conflicting declarations for four months and Archivo won only because
`main.tsx` imports `art.css` second. It is now declared once. The brief also
predates the pixel-empire layer entirely, which is the visual system most of
the app's chrome is actually built from today.
