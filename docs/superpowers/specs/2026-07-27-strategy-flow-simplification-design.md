# Strategy Flow Simplification

**Date:** 2026-07-27
**Status:** approved, ready for implementation

## Problem

The strategy A/B system works, but a student meets it as an experiment rather than as help. Three costs:

1. **Vocabulary.** The UI says trial, variant, control, lift, adherence, forming/directional/supported. Strategy names are technical: "Necessary-Assumption Negation", "Comparative Relationship Matrix", "Low-Resolution Passage Map".
2. **Card density.** The in-question card carries a decorative seal column, an eyebrow announcing a personalized experiment, a title, a one-line prompt, three steps, and an expander explaining the measurement design with outbound source links — all of it in front of a gate that disables the answer choices.
3. **Dashboard density.** The Progress panel shows a leader block, a three-tier evidence key with sample thresholds, a five-column comparison table, a 14-method catalog, and a caveat.

## Non-goals

Measurement is not being weakened. The assignment algorithm, cadence, matched candidate sets, hidden 25% control arm, adherence gate, prompt-time accounting, and three internal evidence tiers stay exactly as they are. No DB migration. This is a presentation change plus a copy contract.

## Decisions

| Question | Decision |
| --- | --- |
| Rigor | Keep the comparison; hide the machinery. Backend logic unchanged. |
| The gate | Keep pre-commitment (cleanest data), but present it as one tap: primary **Use it**, quiet **Skip this one**. |
| Dashboard | Plain-language rewrite of the same structure — leader block, comparison table, catalog. |
| Naming | Plain student-facing name up front; formal name survives as a subtitle in the catalog. |
| Copy ownership | Backend authors every user-visible string that names a strategy or makes a claim, including finished sentences and the verdict label. |

### Copy boundary

Backend owns: strategy names, one-line descriptions, steps, verdict words, the leader sentences, and every number rendered with its unit.

Frontend owns static chrome: button labels ("Use it", "Skip this one"), the `TRY THIS` / `PARTNER TIP` eyebrow, table column headers, and the locked-submit hint. Putting `"Use it"` in Python buys nothing and costs a deploy to reword.

## Backend contract (`backend/app/strategies.py`)

### Three copy fields per strategy

`_strategy()` gains `plain_title`, `plain_subject`, and `plain_line`. Two name fields are needed because the plain names are imperative phrases: `f"{plain_title} is helping you"` reads "Negate the answer is helping you". `plain_subject` is the gerund form used only inside sentences.

| key | formal title | plain_title | plain_subject |
| --- | --- | --- | --- |
| argument_core | Argument Core | Split the argument | Splitting the argument |
| prephrase | Prephrase Before Choices | Guess before you look | Guessing before you look |
| negation_test | Necessary-Assumption Negation | Negate the answer | Negating the answer |
| causal_audit | Causal Alternatives Audit | Question the cause | Questioning the cause |
| conditional_chain | Conditional Chain | Follow the if-thens | Following the if-thens |
| flaw_abstraction | Abstract the Flaw | Name the bad move | Naming the bad move |
| scope_precision | Scope and Force Check | Watch the wording | Watching the wording |
| role_map | Statement Role Map | Label each sentence | Labeling each sentence |
| passage_map | Low-Resolution Passage Map | Map the paragraphs | Mapping the paragraphs |
| viewpoint_ledger | Viewpoint Ledger | Track who thinks what | Tracking who thinks what |
| paragraph_function | Paragraph Function | Ask why this paragraph | Asking why each paragraph is there |
| textual_proof | Textual Proof Standard | Point to the line | Pointing to the line |
| comparative_matrix | Comparative Relationship Matrix | Compare the two passages | Comparing the two passages |
| main_point_synthesis | Main-Point Synthesis | Say the point in one line | Saying the point in one line |

`plain_line` restates each `prompt` without jargon — e.g. negation_test becomes "Flip a choice around. If the argument falls apart without it, that choice was required."

### Per-result fields from `strategy_performance`

Added alongside the existing numeric fields (which stay, so the internals remain inspectable):

- `plain_title`, `plain_subject`
- `verdict`: `"confirmed"` when internal `status == "supported"`, else `"checking"` — the three tiers collapse to two visible states here, not in the frontend
- `verdict_label`: `"confirmed"` / `"still checking"`
- `summary`: one sentence. Confirmed + positive lift → "Negating the answer is helping you." Confirmed + non-positive → "…isn't helping you." Checking + positive → "…might be helping you." Otherwise → "…hasn't shown a difference yet."
- `detail`: "You get 71% right with it and 58% right without it on similar questions." Without a control sample: "You get 71% right with it. Not enough similar questions without it to compare yet."
- `next_step`: confirmed → "Keep using it when it shows up." checking → "A few more questions will make this clearer."
- `with_headline` / `with_note`, `without_headline` / `without_note`, `difference_headline` / `difference_note` — pre-formatted with units ("71%", "7 questions with it", "+13 points", "94s average with it"). Pace moves out of the table and into the difference tile's note.

### Panel-level fields

- `leader`: the result to feature, chosen server-side (supported → directional → any sampled → `null`). Removes the three-way `??` chain from `pages.tsx:97-99`.
- `intro`, `empty_state` (`{title, body}`), `catalog_note` — the honesty sentence currently hardcoded at `pages.tsx:199` moves here, since it is a claim.
- `evidence_note` stays as the single caveat sentence, rewritten plainly. The frontend stops appending a second sentence to it.
- `strongest`, `trials_completed`, `strategies_tested`, `catalog`, `results` unchanged.

`serialize_strategy` copies the whole dict, so the served trial picks up the new fields with no change to `services.py`.

## Question card (`frontend/src/components.tsx:695-721`)

Removed: the 116px seal column with its `§` glyph, the `PERSONALIZED STRATEGY EXPERIMENT · LR` eyebrow, the "Why this method is being tested" expander with its source links, and the three-column grid with both responsive overrides. Sources and rationale relocate to the Progress catalog.

Kept: the three steps (they are the instruction), the pre-commitment lock on answers/reasoning/confidence, `strategy_prompt_ms` stamped on first tap and clamped to 60s, reversibility before submit, and the post-answer confirmation.

Changed: single column; heading is `plain_title` and body is `plain_line`; eyebrow reads `PARTNER TIP` in Method Lab and `TRY THIS` in Infinite, preserving the office fiction in one word; one primary **Use it** plus a quiet **Skip this one**; blocked-submit label becomes "Pick Use it or Skip first"; confirmation becomes "Used this approach" / "Answered without it".

CSS classes rename `.strategy-trial*` → `.strategy-tip*`. `.strategy-decision-pending` keeps its name.

Control-variant students see nothing, exactly as today.

## Method Lab panel (`frontend/src/pages.tsx:148-205`)

- Heading: `WHAT'S WORKING FOR YOU` / "The approaches that actually help you."
- Intro, leader sentences, and numbers all render backend strings.
- Leader tiles: `WITH IT` / `WITHOUT IT` / `DIFFERENCE`.
- The three-tier evidence key (`pages.tsx:173-177`) is deleted; the badge plus `next_step` carries that information.
- Table drops to four columns: Approach | With it / without it | Difference | verdict badge. `min-width` 760px → 560px.
- Catalog: plain name as heading, formal title as an `<em>` subtitle, `plain_line`, steps, "Best for", sources.
- Badge classes become `.confirmed` / `.checking`.

## Testing

- `backend/tests/test_flow.py` already covers cadence, control hiding, candidate matching, the required decision, and the supported threshold; none of it asserts on title copy, so it must keep passing untouched. Run `pytest`.
- Add one backend test asserting every catalog entry carries the three copy fields and that a supported result yields `verdict == "confirmed"` with a non-empty `summary` — this is the guard against a 15th strategy shipping with missing copy.
- Frontend has no test runner; verification is `npm run typecheck` (`tsc -b`) plus `npm run build`.

## Risks

- Plain names lose precision a student would eventually meet in prep books; mitigated by the formal subtitle in the catalog.
- Sentences assembled in Python are harder to iterate on than JSX. Accepted deliberately: it keeps every claim about the experiment auditable in one file.
