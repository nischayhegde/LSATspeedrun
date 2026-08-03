# Simplifying the Dashboard and Practice Lobby

**Date:** 2026-08-03
**Status:** approved, ready for implementation

## Problem

The two tab landing pages a student sees most — Dashboard (`/progress`,
`PerformancePage`) and Practice (`/cases`, `CasesLobbyPage`) — are the most
cluttered surfaces in the app. Neither is missing information; both present far
too much of it at once, and a large share of what they present is the same thing
twice.

**Both pages render a full mobile layout and a full desktop layout into the same
DOM.** `PerformancePage` emits `.mobile-training-home` (`pages.tsx:204`) and then
`.performance-hero` (`pages.tsx:230`); `CasesLobbyPage` emits
`.mobile-practice-home` (`pages.tsx:963`) and then `.docket-hero`
(`pages.tsx:1002`). CSS hides one per breakpoint. This is why the same numbers
and the same controls exist several times over in the markup, why every layout
change has to be made twice, and why the two versions have already drifted apart
in wording.

**The consequence is duplicated content on screen.** Mega-litigation accuracy
appears four times on a single Dashboard render: the header standing chip
(`components.tsx:212`), the mobile score (`pages.tsx:210`), the desktop index
ring (`pages.tsx:240`), and the first metrics card (`pages.tsx:253`). "Start 10
cases" appears four times on the Practice lobby (`pages.tsx:996`,
`pages.tsx:1008`, plus the two docket next-action buttons at `pages.tsx:975` and
`pages.tsx:1030`). The weakest-skill recommendation is rendered twice on
Dashboard — once as a mobile priority tile (`pages.tsx:220`) and once as the
desktop `.priority-panel` (`pages.tsx:356`).

**Nine full-width sections stack vertically on Dashboard**: hero, evidence
strip, a five-card metrics row, the strategy lab (itself containing two nested
`<details>`, one holding a fourteen-approach catalog with external links), the
diagnostic lab, practice focus, comparison readiness, a two-panel grid holding
the trend chart and the priority panel, and the skill matrix. Everything is
expanded by default. There is no way to look at one thing.

**Six sections stack on Practice**, three of which never change: the 560px
`.docket-hero` with its 620px decorative `§` glyph (`styles.css:234`), the
client brief card, the two-step daily docket track, and a permanent four-step
"how scoring works" explainer.

**Labelling is applied in triplicate.** Nearly every section carries an ALL-CAPS
eyebrow, a separate prose headline, and an explanatory paragraph — `WHAT'S
WORKING FOR YOU` above "The approaches that actually help you." above the intro
text. Three labels for one panel.

## Goals

1. No information, control, or number is removed from either page. This is a
   reorganization, not a cut.
2. One responsive layout per page. The mobile/desktop DOM duplication ends.
3. One thing on screen at a time, via tabs on Dashboard and a collapsed drawer
   on Practice.
4. Each fact appears once per page.
5. The game theming survives.

## Non-goals

- The in-case question view (`QuestionFlow`) is untouched. Its chrome is heavy
  too, but it is out of scope for this change.
- No backend, API, or data-shape changes. Every field these pages read today is
  still read.
- No change to what practice runs contain or how they are scored.

## Design

### Dashboard: one summary block plus four tabs

**The summary block is always visible.** It is a single responsive component
replacing both `.mobile-training-home` and `.performance-hero`:

- Lead stat: mega-litigation accuracy, keeping the `index-ring` visual, with
  `N measured questions · comparison ready | evidence forming` beneath it, and
  the evidence-band sentence (`evidenceCopy`) folded in below that. This absorbs
  the whole `.evidence-strip` section.
- Three plain tiles beside it: average split, review recovery, due now.
- One training-priority line: weakest skill, its accuracy, the reason, and the
  "Run 3 focused questions" button. This merges the mobile priority tile and the
  desktop `.priority-panel`, which render the same recommendation today.
- Two buttons: Start 10 cases / Resume current run, and Sit a mega-litigation.

**Four tabs hold the nine sections.** Each tab renders one panel; the panels
keep their existing content and controls.

| Tab | Contents |
| --- | --- |
| Skills | skill matrix table, practice focus panel |
| Methods | strategy lab in full: leader comparison, results table, fourteen-approach catalog, evidence caveat |
| Mega-litigation | diagnostic description, last form score, mega-litigation CTA |
| Evidence | trend chart, the metric cards not in the summary (coached practice, confidence errors, pace adherence), readiness grid, "how evidence is separated" |

Tab state is local component state. The default tab is Skills. Tabs are a
`role="tablist"` of buttons with `aria-selected` and `aria-controls`, and each
panel is a `role="tabpanel"`.

The `.mobile-performance-deck` swipe-carousel wrapper is deleted. The tabs
behave identically at every breakpoint, so there is no second layout.

### Practice: one action card, the run queue, one drawer

**One action card** replaces `.docket-hero`, `.case-brief-card`,
`.mobile-practice-home`, and `.mobile-docket-next`:

- Client portrait, client name, effective base fee, contract status.
- What the run contains: `10 questions`, plus `N repairs folded in` when repairs
  are due.
- One primary button, whose label is Start 10 cases, Resume, or Queue full
  (`N/8`) depending on state.
- When the docket's `next_action` points at a brief rather than at cases, that
  becomes a secondary line on the same card rather than a second full-width
  button.

**The run queue** (`.run-queue-panel`) stays substantially as it is — it is
already the least cluttered part of the page — and continues to render only when
unfinished runs exist.

**One collapsed "How practice works" drawer** holds everything explanatory: the
client description prose, the two-step daily docket track, the four-step
learning-loop explainer, and the validated streak.

### Header

The right side of the header goes from five clusters to three: the standing
chip, the account avatar, and the mobile menu trigger. Sound controls, replay
tutorial, and sign out move into a popover behind the avatar — the desktop
mirror of the mobile menu that already holds exactly those three things
(`components.tsx:264`).

The popover is a `<details>`-free controlled component: a button with
`aria-expanded` and `aria-haspopup`, closing on Escape and on outside click,
matching how `mobileMenuOpen` already works.

### Guided tour interaction

`findVisibleTarget` (`guided-tour.tsx:212`) filters out elements with zero size
or `display: none`. When a spotlight step's target is never found, `measure`
re-queues itself on `requestAnimationFrame` indefinitely and the step renders
with no highlight — a silent hang, not an error.

Two steps depend on header elements:

- Step 13 targets `[data-tour="standing"]`. The standing chip stays visible, so
  this step is unaffected.
- Step 14 targets `[data-tour="sound"]`. Sound controls move inside a
  closed-by-default popover, so this target would be invisible. The step is
  retargeted to the account menu button and its body reworded to describe where
  sound settings now live.

### Text handling

Every explanatory paragraph, caveat, and empty-state message is kept. What is
dropped is the redundant ALL-CAPS eyebrow above a headline that says the same
thing, in the cases where a tab label or panel heading already names the panel.
Numbers, controls, prose, and substantive claims are all preserved.

### Decoration

`PixelStudyScenery` survives on both pages as a bounded band inside the lead
block instead of a full-bleed hero backdrop. The 620px `§` pseudo-element goes
with `.docket-hero`, since that container no longer exists.

## Files affected

- `frontend/src/pages.tsx` — `PerformancePage` and `CasesLobbyPage` rewritten.
- `frontend/src/components.tsx` — `AppShell` header right side; new account
  popover.
- `frontend/src/guided-tour.tsx` — step 14 retargeted and reworded.
- `frontend/src/styles.css`, `frontend/src/mobile.css` — roughly 350 rule
  references across the affected classes rewritten or deleted. `mobile.css`
  loses the `.mobile-training-*`, `.mobile-practice-*`, and
  `.mobile-performance-deck*` blocks entirely.

## Verification

There are no frontend tests in this repository. Verification is:

1. `npm run typecheck` — clean.
2. `npm run lint` — clean, including the `jsx-a11y` rules that cover the new
   tablist and popover.
3. `npm run build` — succeeds.
4. Run the app and confirm on both pages, at desktop and mobile widths: no
   duplicated numbers or buttons, every one of the nine Dashboard sections
   reachable through a tab, every Practice section reachable in the card or the
   drawer, and the guided tour completing all fourteen steps without a missing
   spotlight.
5. `grep` the stylesheets for the deleted class names to confirm no orphaned
   rules remain.

## Risks

- **Dead CSS.** The class surface is large and the two stylesheets contain
  breakpoint-specific overrides at several widths. Rules for deleted classes
  that are missed are harmless but leave the files misleading; step 5 of
  verification exists for this.
- **Behavior hidden in the duplicate layouts.** The mobile and desktop versions
  have drifted, so a control may exist in one and not the other — for example
  the mobile header carries an `Analysis` jump link (`pages.tsx:207`) with no
  desktop equivalent. Each such difference is resolved in favour of keeping the
  control.
