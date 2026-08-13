# Merge notes: the illustrated-language sweep

Branch `cursor/visual-language-sweep-9124`, based on `integration/all-features`.

The rules this branch held everything to are written down in
[`visual-language.md`](./visual-language.md). This file is only the merge
surface: what was touched, why, and where it is likely to argue with the three
branches landing beside it.

## Files touched

Every entry is a visual-language change — colour, type, border, elevation,
texture, icon, or an outdated component replaced. No layout, no responsiveness,
no 3D scene file, no render pipeline.

| File | What changed | Conflict risk |
| --- | --- | --- |
| `frontend/index.html` | Boot plate redrawn to match the spinner it stands in for; favicon replaced with the firm's own mark | Low — two isolated blocks |
| `frontend/src/styles.css` | Token block, shared buttons, header chrome, error notice, spinner, account sheet, focus ring, global `details` marker, `--font-body`/`--font-ui` defined | **High** — this is the shared sheet; expect textual conflicts anywhere another branch also edited it |
| `frontend/src/art/art.css` | `--pixel-*` tokens repointed at the illustrated palette; scene frames; study-vignette styling; the two font tokens named | Medium — the 3D branch owns the scene-side of this file's lower half |
| `frontend/src/art/pixel-scenery.tsx` | The last pixel art in the interface redrawn as cel-shaded vignettes; component API unchanged | Low — self-contained, and callers did not change |
| `frontend/src/case-instrument.css` | Button overrides brought onto the shared press mechanics | Low |
| `frontend/src/case-session-styles.css` | Exam paper, verdict and debrief re-inked | Medium — the case session is actively worked on |
| `frontend/src/exam-flow.css` | Section labels moved to the HUD face; sheet cell off `#fff` onto `--surface` | Low |
| `frontend/src/firm-page.css` | Trophy pill, treasury wallet, wallet clasp, catalog toolbar | **High** — the firm page is another branch's interaction territory |
| `frontend/src/focus-mode-gate.css` | Container, mark and heading redrawn; heading capitalised where it is displayed | Low |
| `frontend/src/login-page.css`, `frontend/src/mobile/login-page.css`, `frontend/src/pages/login-page.tsx` | Pixel-hand sheets replaced; the `.tsx` change swaps the `lucide` scale for the drawn crest | Medium on the `.tsx` |
| `frontend/src/markup.css`, `frontend/src/markup.tsx` | The pen swatch's inline colour variable renamed `--ink` to `--markup-ink`, off a collision with the app's outline token | Low, but the rename spans both files and must land together |
| `frontend/src/mobile.css`, `frontend/src/mobile/firm-page.css` | Crest, overflow trigger, and the firm filter's face | **High** — the responsiveness branch owns both files |
| `frontend/src/performance.css`, `frontend/src/pages/dashboard-page.tsx` | The mega-litigation panel on `/progress`: shared `panel-heading`, the score promoted to the panel's figure, the four terms attached to the action, and the shell moved onto the palette | **High** — the dashboard is another branch's surface. See the note below |
| `frontend/src/mega-litigation.css` | The `.mega-panel` shell follows `.diagnostic-lab` onto the palette, which is what its own comment promises | Low — one rule, three declarations |
| `frontend/src/narrative.css` | Cutscene overlay and campaign chrome | Medium |
| `frontend/src/office-page.css`, `frontend/src/story-page.css` | Game bar and story board laid on the desk register | Medium |
| `frontend/src/onboarding-page.css` | Character choice cards, goal step, native date picker weight | Medium |
| `frontend/src/review-panels.css` | Panel borders and fills onto tokens | Low |
| `frontend/src/rival-capture-cutscene.css`, `frontend/src/rival-war-room.css` | The capture beat drawn like the room it fires from | Low |
| `frontend/src/wardrobe.css` | Cards, chips and the selected state | Low |
| `docs/visual-language.md` | New: the rules, the deliberate exceptions, and what was left | None |
| `docs/visual-sweep-merge-notes.md` | This file | None |

## The changes most likely to bite

1. **`--pixel-*` tokens now resolve to illustrated values.** Nothing was
   renamed, so no call site broke, but every rule that reads a `--pixel-*`
   token changed appearance. If another branch added a surface expecting the
   old cold-grey values, it will come across warm after the merge. That is the
   intended direction; the fix is to accept the new value, not to re-point the
   token.

2. **`--font-body` and `--font-ui` are now defined.** Twenty-one rules already
   read them and were silently falling back to the inherited stack. They are
   both Inter, which is what the fallback resolved to in practice, so this
   should be visually inert — but it is a token-level change, so a branch that
   set either variable locally will now be overriding rather than defining.

3. **A global `details`/`summary` marker.** Any new disclosure gets a chevron
   automatically. Summaries that already contain an `svg` are excluded, so a
   branch that adds a custom marker as an inline SVG needs no change; one that
   adds a custom marker as a pseudo-element will draw two chevrons.

4. **Shared button press mechanics.** The 3px diagonal slide is gone in favour
   of a 1px inner shadow. Anything that reimplemented the old press locally
   will now be out of step with the header and the shared controls.

5. **The mega-litigation panel's markup moved, on a route another branch is
   working.** `.diagnostic-lab` in `dashboard-page.tsx` gained a
   `.panel-heading` and a `.diagnostic-lab-body` wrapper, and its score block
   is now rendered before the copy when a score exists and after it when one
   does not — that ordering is the whole point of the change, since the score
   is the panel's subject and was reading last on a phone. The numbers and
   their fallbacks (`raw_correct ?? summary.correct`,
   `form_total ?? raw_total`) are untouched. If this conflicts, keep the two
   conditional score blocks and the `has-result` class; everything in
   `performance.css` depends on both.

6. **Several sheets carry whole blocks minified onto one line** —
   `styles.css` (8), `art/art.css` (3), `case-session-styles.css` (2),
   `firm-page.css` (2), `story-page.css` (2) and `office-page.css` (1). Git
   cannot merge two edits to the same line, so a sibling branch that touched any
   of those lines will produce a conflict covering thousands of characters. If
   that happens, take this branch's line and re-apply the other branch's change
   on top rather than reading the two versions side by side: every change here
   is a colour, a border, a radius, a shadow or a font token, so the other
   branch's edit is almost certainly about something else in the same string.

## The office contract card, on its own branch

`cursor/office-contract-card-9124`, cut from the head of this branch so the
dashboard work can land first without dragging it along. Four files:

| File | What changed | Conflict risk |
| --- | --- | --- |
| `frontend/src/styles.css` | Deleted `.client-portrait > span`, a dead 2D badge rule that had started matching the 3D bust; `.client-quest-card span` eyebrow onto `--brass-deep` | **High** — shared sheet, and the deleted rule is one line inside a region other branches edit |
| `frontend/src/office-page.css` | `.client-quest-card` recomposed: name in Fraunces, the two contract figures as chips, an on-hold state, the portrait's title pill sized to fit | Medium — the interface branch may also be in this sheet |
| `frontend/src/pages/office-page.tsx` | The contract card's terms split into two elements and an `is-on-hold` class on the article. Same fields, same words | Medium — same reason |
| `frontend/src/mobile/office-page.css` | The portrait's title pill stood down on the phone brief sheet, where it hung 15px outside the sheet's border | **High** — the responsiveness branch owns the mobile sheets |

One known limit: the title pill is centred on the bust and set `nowrap`, so
what fits is a function of how much room the card reserves either side of an
86px portrait. At the size it is now set, every client class in the catalog
reads in full except the 19-character "LEAGUE COMMISSIONER", which still
ellipsises. Buying that last one costs the text column real width on every
card, and the title is on the portrait's `aria-label` either way.

The one that reaches beyond this card is the `styles.css` deletion. It changes
every `ClientPortrait` in the app — the office card, the Firm tab's retainer
panel and client roster, the Practice docket header, the case session's matter
banner — because that rule was silently overriding `art.css` on all of them.
Each gets back the frame the portrait camera is actually composed for, the
client's own backdrop colour instead of `var(--navy)`, and 2px of bust that a
badge border had been eating. If it conflicts, keep the deletion: the rule
describes an element (`.client-portrait > span` as a 24px initial badge) that
no component has rendered since `ClientPortrait` moved to `<b>`.

## Handed to the other branches

- **Mobile, not mine to fix:** the phone's form of the contract card,
  `.office-mobile-current-case` in `office-page.tsx`, never renders the on-hold
  branch. It reads `{cases_remaining} files · {fee} base` unconditionally, so a
  player whose reputation has fallen under their client's requirement is shown
  a walk-in's name and fee with no indication that their real contract is
  suspended. The desktop card and the Firm tab's retainer panel both say so.
  One conditional, in a component the responsiveness branch owns.
- **Layout, not mine to fix:** on `/story` at 1440, the always-on live ledger
  overlay sits on top of the first resource card. Same overlay clips the
  bottom-left of `/progress` and `/cases`. It is correctly styled; it is
  positioned over content.
- **Performance, not mine to fix:** the map HUD still applies `backdrop-filter`
  over a live WebGL canvas. The mobile firm tab rail had the same problem and
  was already resolved to an opaque fill by whoever wrote the comment there;
  the map has not had that pass.
- **3D, reported not edited:** no palette conflict found. `render-style.ts`
  inks at `0x1b1a24` and the interface's `--ink` is `#1b1a24` — the same value.
  The scenes and the interface are already drawn with the same pen.
- **Copy, out of remit:** "LSAT Tycoon" survives in `deploy/ec2/cloudformation.yaml`,
  `deploy-sandbox.ps1`, `backend/migrations/README`, `backend/app/models.py`
  (docstring), `backend/app/coaching.py` (a model-facing system prompt) and
  `backend/scripts/seed_demo.py` (argparse help). None of it reaches a player's
  screen, and the deploy templates belong to whoever owns infrastructure.
  Product copy that names the LSAT as the exam being studied is correct and was
  left alone.
