# Freeform Markup on the Case File

**Date:** 2026-08-05
**Status:** approved, implemented

## Problem

A student sitting the real LSAT marks up the page. They circle the conclusion,
strike out the two choices they have ruled out, and diagram a conditional chain
in the margin. `QuestionFlow` (`components.tsx:579`) offers none of that. The
case file is read-only prose and a set of radio buttons, so every intermediate
thought has to be held in the head or written into the reasoning box, which is
graded and therefore the wrong place for scratch work.

## Decisions

Five choices were settled before design, and each one narrows the build:

1. **Freeform ink**, not text-anchored highlighting. Arrows, circles and
   conditional diagrams matter more than surviving reflow.
2. **The whole case file is drawable** — passage, stimulus, stem and answer
   choices — behind a mode toggle. Striking out a choice is core technique and
   was the reason not to restrict ink to the prose.
3. **Ink is ephemeral.** It belongs to the question on screen and is gone on the
   next one. Nothing is sent to the server; there is no migration and no
   autosave traffic.
4. **Pen in three colours, highlighter, eraser, undo, clear all.**
5. **A persistent toolbar whose pointer tool is the off state** — the
   Figma/Excalidraw model. Ink stays visible when disarmed and clicks reach the
   choices underneath. Escape disarms.

## Why per-card SVG

**The layer has to be per-card, parented inside each card.** On desktop the
passage card scrolls internally while the answer card scrolls with the page
(`styles.css:423`). On phones `.question-layout` becomes a `100dvh` flex column
with `overflow: hidden` and each card becomes its own `height: 100%` scrolling
pane (`mobile.css:2310`, `mobile.css:2423`). The one invariant across every
breakpoint is that both cards are their own scroll containers, so ink parented
inside a card scrolls with its own text for free. A single page-level canvas
would have to re-project on every scroll of two independent scrollers and clip
manually to each card's visible rect.

**SVG paths rather than a canvas**, because three things that are real work on a
canvas fall out for free:

- **Reflow.** The answer card grows substantially when the verdict, coaching,
  settlement and score panels mount after a submission. A canvas must be
  resized and fully redrawn; SVG reflows.
- **Crispness.** No `devicePixelRatio` scaling maths, sharp in the phone
  webview.
- **The highlighter.** A translucent canvas stroke drawn incrementally
  double-darkens at every overlap and joint, and the usual fix is an offscreen
  buffer per stroke. One SVG path with `stroke-opacity` paints as a single shape,
  so self-crossings stay flat.

A canvas only pays off in the thousands of strokes, which markup on one question
never reaches.

**Accepted limitation:** ink is positioned, not text-anchored. If the window
resizes and the prose reflows, ink stays put. Within a question this is almost
always invisible, because content that appears after a submission is appended
*below* the choices — the exception is that the reasoning box and confidence row
unmount on submit, so anything drawn over those shifts relative to what is
beneath it. For ephemeral scratch work that is a fair trade against anchoring
machinery.

## Sizing: the sentinel

This is the one subtle part of the implementation.

A layer with `inset: 0` inside a scroll container resolves against the **padding
box**. It scrolls with the content correctly but stands only one screenful tall,
so pointer hit-testing dies below the fold. Sizing it from `scrollHeight`
deadlocks instead: the layer is absolutely positioned, so it contributes to the
container's scroll overflow, feeds its own height back in, and never comes down
again once the content shrinks.

A content wrapper would solve it and is **not available**. On phones the cards
are flex columns whose direct children are deliberately `flex: 0 0 auto`
(`mobile.css:2448-2452`, with a comment explaining that this is what lets a short
question push its action bar to the foot of the pane). Wrapping the content would
make that wrapper the sole flex child and break it, and would also change `> *`
semantics at `styles.css:655`.

So each card gets **two direct children**: the layer, and a zero-height sentinel
rendered last. The sentinel is the last in-flow child, so its `offsetTop` is
exactly the content height, and an out-of-flow layer cannot push it down.
`offsetTop` and the layer's `top: 0` share the same padding-edge origin, so the
measurement maps directly onto the layer's height. Measuring on every render and
committing only on a real change settles in one extra pass and costs nothing
after that; one `ResizeObserver` on the card catches window resizes that do not
re-render React. Measurement is skipped when `offsetParent` is null, so the
phone pane swap's `display: none` does not clobber a good height to zero.

This needs **no changes to existing selectors**. Both additions are direct
children, so `styles.css:655` hands them `position: relative; z-index: 1` and the
layer overrides to `position: absolute` — the same pattern `.paperclip` already
uses at `styles.css:661`.

## Z-order

| layer | z-index | why |
| --- | --- | --- |
| prose, stem, answer choices | 1 | under the ink — striking out a choice is the point |
| `.markup-layer` | 2 | the ink |
| `.reasoning-box`, `.confidence-check`, `.answer-actions`, `.continue-row`, `.coaching-error` | 3 | stay live and clickable while armed |

The rule this encodes: **prose and choices are inkable; anything that commits an
answer or captures text stays live.** So drawing never has to be put away to
submit, type reasoning, or move to the next case — which removes the sharpest
edge of a mode toggle while keeping the behaviour that motivated it.

`.answer-card` carries `transform: rotate(.12deg)` (`styles.css:653`), which makes
it a stacking context. That isolates the layer's `mix-blend-mode: multiply` to
the card, so the highlighter blends with the paper rather than the page behind
it.

## Components

New `markup.tsx` and `markup.css`. `components.tsx` is already 1173 lines with
`QuestionFlow` taking 485 of them, so the ink system stays out of it;
`QuestionFlow` gains a hook call, a toolbar, and one layer per card.

```
useCaseMarkup(itemId)  tool + colour + stroke store; resets on item change
MarkupToolbar          the docked tray
MarkupLayer            one <svg> plus its sentinel, for one card
```

No context — three consumers, all inside `QuestionFlow`, so plain props are
clearer.

Strokes live in one flat chronological array so undo is global across both
cards, which is what a person expects from a single undo button. Each layer
filters by surface.

```ts
type Stroke = {
  id: string
  surface: 'passage' | 'answer'
  tool: 'pen' | 'highlighter'
  color: 'navy' | 'red' | 'gold'   // --navy, --red, --gold-dark
  points: Array<[number, number]>  // card content coords, CSS px
}
```

Strokes are rendered with quadratic midpoint smoothing, which turns a jittery
pointer trace into a line that looks drawn rather than plotted. Points closer
than 2px are dropped. A tap is a zero-length segment with a round linecap, so it
reads as a dot.

The **eraser removes whole strokes**, not pixels — one pass removes the circle
you drew instead of nibbling a gap into it, and it needs no compositing.

## Placement of the tray

A fixed tray centred at the bottom of the viewport on desktop. This deliberately
avoids making the toolbar sticky in the flow, which would have collided with the
sticky passage card (`top: 96px`) and required retuning its offset and
`max-height`.

Below 900px the tray joins the flow above the case documents instead, because a
fixed bottom tray would sit over the action bar docked at the foot of each mobile
pane. At phone sizes it declares `flex: 0 0 auto` to slot into the `100dvh` flex
column, and drops its text labels for icons because vertical space there is
budgeted against the reading panes.

## Touch behaviour

While a tool is armed the layer takes `touch-action: none`, so one finger draws
rather than scrolling. **To scroll a pane on a phone you switch back to Read**
(or press Escape); the tray sits outside the layer, so it is always reachable.
Desktop wheel and trackpad scrolling are unaffected, because the layer neither
listens for wheel events nor is governed by `touch-action`.

Drawing is disarmed on every new question, so a page turn never lands a student
mid-stroke over a question they have not read.

## Accessibility

The layer is `aria-hidden="true"` and `focusable="false"`. Ink is a purely
optional aid and no information reaches the student through ink alone, so nothing
is lost to a screen reader. The tray is a `role="toolbar"` of real buttons with
`aria-pressed` and descriptive `aria-label`s, since the phone layout shows icons
only. Escape disarms. Drawing itself is pointer-only, which is acceptable for an
optional aid; every tool remains clickable, per the project's click-based
interaction rule.

## Verification

There is no frontend test harness — `package.json` carries only lint, typecheck
and build. The pure geometry (`strokePath`, `strokeHit`) was verified by bundling
the real module with esbuild and exercising it in node across 21 assertions
covering dot/line/curve path generation, coordinate rounding, pen versus
highlighter reach, hits past a segment end, bent strokes, and custom radii.

`npm run typecheck`, `npm run lint` and `npm run build` all pass.

The DOM-dependent behaviour — sentinel measurement, pointer capture, and z-order
against the live cards — is not covered by automated checks and needs a look in
a browser. Introducing a frontend test runner would make that coverable and is a
separate decision.

## Out of scope

- Persistence of any kind, local or server-side.
- A guided-tour step. The tray is labelled and sits on the page; if
  discoverability proves to be a problem, a tour step is a cheap follow-up.
- Text-anchored highlighting, and a straight-line/arrow snap tool.
