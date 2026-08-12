# The visual language, written down

Lawyer Tycoon has been through three visual directions and the tree still
carries all three. This file says which one is current, what its rules are, and
which differences are deliberate rather than left over. It was written for a
sweep whose job was to make the app uniformly current, and it is the standard
that sweep held everything to.

The tokens are in `frontend/src/art/art.css`. That sheet is loaded on every
route, after `styles.css`, so it has the last word on what a token means.

---

## The three hands, in order

**1. Prestige print (to 2026-07).** Cream `#fffdf7` cards, 11–18px radii,
1px `#d9d0c2` borders, soft blurred shadows, Georgia headings, `--navy`
`#102735` on `--paper` `#f8f3e8`. Still the base layer of
`firm-page.css`, `login-page.css` and much of `styles.css`, mostly overridden.

**2. Pixel Empire (2026-07).** The "game-first visual system" block in
`styles.css`. 2–5px pure-black borders, `border-radius: 0` or `2px`, hard
offset shadows (`4px 4px 0 #171923`), inner bevels
(`inset -4px -4px …, inset 2px 2px …`), `"Courier New"` as `--font-pixel`,
`shape-rendering: crispEdges`. This is the hand that produced most of what
still looks out of date.

**3. Illustrated (current, 2026-07-22 onward).** `planning/2026-07-22-visual-overhaul-design.md`
is the design note; `frontend/src/art/render-style.ts` is the 3D half of it and
`frontend/src/art-2d/marks.tsx` the 2D half. Ink contours, cel-flattened paint,
paper grain, a warm parchment-and-brass palette. Fraunces for display, Archivo
for HUD, Inter for body. Hairline outlines and soft elevation rather than hard
bevels.

Direction 3 replaced 1 and 2. Where they survive, they are legacy unless this
file says otherwise.

---

## The rules

### Colour

The interface draws itself out of the same palette the scenes are rendered in.
Every value below is taken from something that already ships.

| Token | Value | Where it comes from |
| --- | --- | --- |
| `--ink` | `#1b1a24` | the contour colour `IllustratedStyleOptions.ink` draws every 3D silhouette and crease in |
| `--ink-line` | `rgba(27,26,36,.55)` | the same ink as an outline over a lit surface |
| `--parchment` | `#ded1ad` | the office scene's own desk paper |
| `--brass` / `--brass-lit` | `#c89b4b` / `#f2d791` | the brass plate `art.css` draws for the office floor selector, map site marks and the gavel |
| `--brass-bright` | `#e8c87c` | brass type on a dark panel |
| `--verdigris` | `#7bc8bd` | the office's emissive glow; the live/positive accent |
| `--night` | `#0e1521` | the ground of every dark panel |
| `--panel` | `rgba(13,20,32,.88)` | the panel fill the newest surfaces already use |
| `--hairline` | `rgba(232,200,124,.32)` | brass at outline strength |

Rules:

- **No pure black and no cold near-black.** Ink is warm. `#000`, `#080c13`,
  `#171923`, `#10151e`, `#141721` and their nine cousins are the pixel hand.
- **One brass, one mint.** A new surface uses `--brass*` and `--verdigris`
  rather than inventing a value three points away. The sweep counted 491
  distinct "brass" literals and 99 distinct "mint" literals across the
  stylesheets; that is the drift these tokens exist to stop.
- Red is a returned filing, not an alarm: `#a84645` family, never saturated.

### Type

Three faces, and the rule is which face does which job, not what size it is
set at.

- **Fraunces** (`--font-display`), 620 weight, `-0.01em`: headings, figures a
  reader is meant to register, plaque names.
- **Archivo** (`--font-hud`, aliased as `--font-pixel`): labels, control text,
  eyebrows, chips — anything that is tracked caps. Typically 7.5–11px at
  800–900, tracked 0.06–0.24em.
- **Inter** (`--font-body`, aliased as `--font-ui`): body copy and sentences.
  Nothing else.
- Georgia appears in ~20 rules and is the prestige-print hand. It is only
  correct where a surface is deliberately printed matter.

The defect this rule catches is a **tracked-caps label set in Inter**, or a
sentence set in Archivo — two faces doing one job on one screen. The exam
bar's "SECTION 1 OF 3" against the paper's "QUESTION 1" 350 pixels below it
was the last of those.

There is deliberately **no minimum size** here. An earlier draft of this file
said 11.5px and called anything smaller legacy; that was written from the
instrument chrome and is wrong about the app. The HUD register runs at 7–9px
throughout `art.css`, the map HUD, the strategy gate and the projection
panel — hundreds of rules, drawn small and tracked on purpose so a readout
sits under the thing it labels without competing with it. Re-typesetting
those would be a redesign, not a sweep, and nothing in the sweep enforced it.

### Form

- **Radius**: `--r-card` 16px (panels, cards, modals), `--r-control` 10px
  (buttons, inputs, chips with square ends), `--r-chip` 999px (pills, badges).
  0 and 2px belong to the pixel hand.
- **Outline**: one hairline. 1px of `--hairline` on a dark surface, 1px of
  `--ink-line` on a light one. Borders of 3px, 4px and 5px belong to the pixel
  hand, except on the diegetic paper surfaces below.
- **Elevation**: `--el-1`/`--el-2`/`--el-3`, already defined in `styles.css`.
  Soft, downward, and coloured by the ink rather than by black.
- **Offset shadows**: a hard offset in flat opaque near-black
  (`4px 4px 0 #171923`) is the pixel hand and reads as printed onto the page.
  The diegetic paper below is allowed a real offset, but it is warm ink at
  low alpha and it is paired with a blurred `--el-*` — `7px 8px 0
  rgba(27, 26, 36, .18), var(--el-3)` is paper lifting off a desk; the same
  offset at full strength in `#171923` is a sprite.
- **Bevel**: none. `inset -4px -4px …` plus `inset 2px 2px …` is a pixel key.
  Depth comes from the hairline, a single inset highlight at the top edge, and
  the drop. A pressed control seats 1px into `inset 0 2px 5px`; it does not
  slide 3px diagonally onto a two-tone bevel.
- **Text shadows**: straight down, `0 2px 0` at low alpha. `3px 3px` diagonal
  into a cold near-black is the pixel hand, and was still on the treasury
  figure and the mobile login headline.

### Iconography

Three families, and only three:

1. `art-2d/marks.tsx` — filled, hand-drawn marks on a 24-unit grid. The brand
   crest, the loading mark, the focus mark, the alert seal, the map controls.
2. `lucide-react` — the line icon set, used throughout the interface. It is
   drawn at `stroke-width: 2` by default, which is visibly thinner than the
   marks beside it and than the cel-shaded scenes behind it. The app draws it
   at 2.35 so the two families read at one weight.
3. The scenes' own SVG and three.js drawing, which is not iconography.

A typographic character standing alone inside a button (`×`, `☰`, `§`, `›`) is
not an icon: whichever face the platform substituted decides its weight and
whether it centres. Those were replaced with marks and must not come back.

The platform's own `<details>` marker is the same defect wearing a different
hat, and it had survived on six of the app's ten disclosures. `styles.css`
now suppresses it everywhere and draws one chevron in its place; a summary
that already carries a real icon is skipped through `:has(svg)`, so nothing
ends up with two affordances for one action. A new `<details>` needs no rule.

The tab icon counts. It was a stroked line drawing on a navy disc long after
the interface stopped drawing anything that way, and it is the one mark a
reader sees before the app has loaded at all.

### Motion

Already decided and documented in the motion block at the foot of
`styles.css`: four durations (`--mo-1`…`--mo-4`), four easings
(`--mo-out`, `--mo-in`, `--mo-spring`, `--mo-brass`). Only transform, opacity
and colour animate. Nothing loops.

### Texture

- The page field is laid-paper fibres plus one light falloff from under the
  header, on `.app-shell`.
- The header is engine-turned, a banknote engraving at 3.7% white.
- Both are inline data URIs, no request and no element.
- `mix-blend-mode` and `backdrop-filter` over a full viewport or a WebGL
  canvas are banned, with measurements, in `docs/cloud-sweep-brief.md`.

---

## Deliberately distinct, and why

Not everything should look the same. Two registers exist on purpose.

**The instrument chrome** — header, dark panels, the case file, the dashboard,
the office and map HUDs, overlays, buttons. This is the language above.

**Diegetic paper** — the Partners' Ledger on `/firm` and the campaign
caseboard on `/story` are objects in the world: a ledger open on a desk, a
corkboard of dossiers. They are allowed heavier ink, cast shadows with real
offset, and printed-matter typography, because they are drawn as physical
things rather than as interface. They are **not** allowed a different palette:
their ink is `--ink`, their paper is the parchment ramp, their brass is
`--brass`.

**The warm ground under a mega-litigation.** Two surfaces — `.diagnostic-lab`
on `/progress` and `.mega-panel` on `/cases` — are drawn on a warm brown-to-
night gradient rather than the navy every other dark panel grounds on, because
sitting a full form is not ordinary practice and the app marks it. That is a
distinction worth keeping, so the sweep kept it. What it did not keep was the
value: it was `rgba(93,66,39,.94)`, a desaturated brown at 94% over a parchment
page, so six percent of the paper lifted through and the panel read milky. It
is opaque now and both ends come off the ink-to-night ramp. The two rules are
identical, which is what the comment at the top of `mega-litigation.css` has
always claimed.

**The 3D scenes** have their own rendering pipeline and are out of scope for
interface rules entirely. Flattening a cel-shaded room to match a flat panel
would be a mistake.

**The proctored screen** — `/cases` once a mega-litigation is running — is a
fourth register and says so at the top of `exam-flow.css`: no leather, no
portraits, no stamps, because a student sitting a timed form is being
measured and every piece of decoration is somewhere for the eye to go that
the real test would not have offered. Its plainness is a decision. What it
still owes the rest of the app is the *face* a job is done in, not the
weight of its ornament.

---

## What the sweep did not change, and why

- `--font-pixel` keeps its name. It resolves to Archivo and has for months;
  renaming ~150 call sites is churn with a merge cost and no visual result.
  `--font-hud` is the name new work should use.
- `lsat-tycoon:` localStorage keys. Invisible to the player, and changing them
  would silently reset every reader's sound settings, tour state and deferred
  chapters.
- `README.md`'s "LSAT Tycoon" opening. It is owned by the documentation pass in
  `docs/cloud-sweep-brief.md` Priority 1b.
- The `Courier New` fallback on `--font-pixel` in `styles.css`. It is dead:
  `art.css` is on the entry sheet and always redefines the token. Removing it
  would be a change with no effect, in a file three other branches are editing.
- The pixel-hand rules in `styles.css` that a later sheet already fully
  overrides — `.pixel-asset-art`'s 4px outline and `✓` badge (`art.css` wins),
  the `.mobile-nav` bar (`mobile.css` wins), `.office-cat`, `.map-rail` and
  `.trophy-case` (no markup renders them). They are dead code, which belongs to
  the refactoring pass, and every one of them is in a file another branch is
  editing. The live ones in the same block were fixed.
- `guided-tour.css`. Its skyline and desk illustrations are still drawn in the
  pixel hand — 3px `#181c1b` outlines, a `steps(2)` window flicker — and they
  are the same defect the study vignettes were. The tutorial is another
  agent's remit and they have that file open; redrawing scenery underneath a
  rewrite would cost the user a merge for no gain. Reported, not touched.
- The map HUD's eight `backdrop-filter: blur()` panels over the WebGL canvas.
  The sheet already carries a measured note about removing a ninth for exactly
  this reason. That is the performance pass's call, not a visual one.
- The ~1,600 distinct hex literals across the sheets. Most are in `art.css`,
  which draws illustrations in CSS, and in the scene HUDs. The tokens exist so
  the next surface stops adding to that number, not so this sweep could
  mechanically rewrite every one of them.
