# Hand-over: theme findings inside the Office / client-quest-card work

The August 2026 theme conformance sweep deliberately did not touch
`frontend/src/office-page.css`, the `.client-quest-card` rules in
`frontend/src/styles.css`, or the client portrait rendering, because a design
agent was mid-flight on them. These are the conformance findings inside that
boundary, for whoever owns it to fold in or reject.

Standards referenced below are set out in `docs/visual-language.md`.

## 1. `--font-ui` does not exist — `office-page.css:22`

```css
.office-upkeep-terms strong { … font-family: var(--font-ui); … }
```

`--font-ui` is declared nowhere. The declaration is therefore dropped and the
element inherits whichever face its parent has, rather than the one this rule
asks for.

It was one of three phantom font tokens; the other two (`--font-body`,
`--font-mono`) and the other thirteen `--font-ui` references were resolved in
the sweep. `--font-body` now exists and is the app's body face; the twelve
sibling uses of `--font-ui` in `art/unified-empire-map.css`,
`trial-calendar.css` and `mobile/firm-page.css` were all repointed to it with
no visual change, because inheriting Inter and asking for Inter look the same.

**Suggested fix:** `var(--font-ui)` → `var(--font-body)`. One token, one line.
Verify it does not change: this element is `font-weight: 800` at 11px, so if it
was inheriting the *label* face rather than the body face, this will visibly
change it and `var(--font-pixel)` is the right target instead.

`tools/theme-audit/undefined-vars.mjs` reports this and will go quiet once it is
done.

## 2. `.client-portrait > span` still names Georgia — `styles.css:502`

```css
.client-portrait > span { … font-family: Georgia, serif; … }
```

Every other hand-named `Georgia, serif` in the app was folded into
`var(--font-display)` in the sweep, on the grounds that Georgia is the *fallback*
inside that token and was the display face before Fraunces — so a rule naming it
literally pins the element to the stand-in while everything doing the same job
renders in Fraunces.

This one was left alone because it styles the client portrait badge and the
portrait render was reserved. It is a 12px weight-800 badge glyph, so the change
is small either way, but it is the last literal Georgia outside the one
deliberate exception (the LSAT stimulus).

**Suggested fix:** `Georgia, serif` → `var(--font-display)`.

## 3. Nothing else

For completeness: `office-page.css` was otherwise clean against the checks run
across the rest of the app. It declares no tokens of its own, has no
`backdrop-filter`, no duplicate base rules that tie with the entry sheet, and
its eyebrow usage inherits the shared rule rather than overriding it.

One thing to be aware of rather than to fix: `/office` is one of two routes
whose `h3` moved when the sweep unified heading tracking. `h1, h2, h3` now all
track at `-.01em`; `h3` was previously at `-.035em` because `styles.css` and
`art/art.css` each declared tracking for a different subset of the three and
art.css won for `h1, h2` only. On `/office` this affects the client card title
(`h3`, Archivo 13px), which is inside the reserved component. It is a
sub-pixel-per-character change and the measured whole-page diff was 0.02%, but
if the card is being tuned to the pixel it is worth knowing the baseline moved.
