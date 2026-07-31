# Required Graded Explanations Drive Scheduling

**Date:** 2026-07-28
**Status:** approved, ready for implementation

## Problem

The app already grades written explanations end to end. The coach returns an
`explanation_grade` (0–100), a `reasoning_verdict`, and a typed `first_error`
(`backend/app/coaching.py:212-220`); `game.py:1243-1314` converts the grade into
Invalid/Weak/Good/Excellent bands that drive the economy. Two things are wrong
with how that machinery is used.

**The explanation is rarely asked for.** `requires_reasoning` is true only for
`deep` and `review` (`backend/app/services.py:441`). Every entry point into
practice hands the student a `speedrun`: the style picker defaults to it
(`frontend/src/pages.tsx:631`), both quick-start buttons hardcode it
(`pages.tsx:72`, `pages.tsx:76`), and the Daily Docket's `next_action` never
emits `deep` at all (`services.py:652-661`). A student following the suggested
flow writes an explanation only on review days.

**The grade changes nothing about what gets served.** Review scheduling keys off
correctness, confidence, and pace (`services.py:809-817`). Strategy trial
selection scores on accuracy, pace, and calibration (`strategies.py:333-344`).
Neither reads `explanation_score`. A student can click the right letter for the
wrong reason, at high confidence and good speed, and that question is never seen
again — the coach even emits a `lucky_guess` error code that nothing consumes.

## Goals

1. Require a written explanation on every non-diagnostic question.
2. Let the AI grade of that explanation decide what returns to the review queue
   and how fast it graduates.
3. Let the same grade decide which strategy the bandit surfaces.

## Non-goals

- The diagnostic stays a clean measurement surface: no explanation, no coaching,
  no strategy prompt.
- The grading prompt, band thresholds, and economy payout math are unchanged.
- Strategy trial *cadence* is unchanged (see Out of scope).

## Decisions

| Question | Decision |
| --- | --- |
| Which modes require an explanation | All four practice styles. Diagnostic never. |
| How much writing | Full case theory in `deep`/`review` (120 chars); short justification in `speedrun`/`infinite` (40 chars). |
| Review queue reach | Grade controls both entry and interval advancement. |
| Strategy score weight | Explanation quality is co-equal with accuracy, just below it. |
| Ungraded attempts | Schedule provisionally on submit, revise when the grade lands. Never block. |

### Why a shorter floor when timed

Speedrun is tagged `timed_unseen` (`services.py:27-33`) and is the only evidence
class feeding the timed score estimate. Requiring a full case theory there would
make it measure timed *writing* rather than timed test-taking. A 40-character
floor keeps the pace signal meaningful while still producing a gradable
artifact. Speedrun's identity as a score proxy is weakened by this change either
way; the shorter floor limits the damage rather than eliminating it.

## The gate (`backend/app/services.py`)

```python
REASONING_MIN_CHARS = {"deep": 120, "review": 120, "speedrun": 40, "infinite": 40}
```

| Site | Current | New |
| --- | --- | --- |
| `services.py:441` (`create_study_session`) | `practice_style in {"deep", "review"}` | `practice_style != "diagnostic"` |
| `services.py:770` (`_append_infinite_item`) | `False` | `True` |
| `services.py:488` (`create_diagnostic_session`) | `False` | unchanged |

`submit_attempt` (`services.py:877-879`) today rejects only an empty string. It
gains a length check against the session's floor, raising
`reasoning_too_short`. `routes.py:671` maps that to 400 with "Your explanation
is too short to grade — add the reasoning that decided your answer."

`serialize_item` (`services.py:192`) emits `reasoning_min_chars` so the client
enforces the identical floor. The floor is derived from
`session.practice_style` at serialization and validation time rather than stored
per item — it is policy, not per-question data, and storing it would require a
migration to change a constant.

## Data model

One migration, `backend/migrations/versions/0019_explanation_scheduling.py`,
adding two nullable columns to `review_queue_items`:

| Column | Type | Purpose |
| --- | --- | --- |
| `grade_pending` | bool, default false, not null | This row was decided without a grade and must be revisited when one arrives. |
| `pre_grade_interval_index` | int, nullable | The `interval_index` before a provisional advance, so the backfill recomputes deterministically instead of inferring. |

`Attempt.explanation_score` already exists as a normalized 0–1 float
(`models.py:177`), written in `run_attempt_coaching` (`services.py:1005-1015`).
No attempt-side migration.

## Review scheduling (`_schedule_review`, `services.py:779`)

The function splits into two passes over the same rules. Bands come from
`explanation_band` (`game.py:1243`), imported rather than reimplemented, so the
economy and the scheduler can never disagree about what "Weak" means.

### Entry — non-review sessions

Evaluated in order; first match wins. Only `unsupported_correct` is new, placed
above the softer correct-answer reasons because a confidently wrong-reasoned
correct answer is the most urgent case in the list.

```
wrong   + confidence >= 4   -> high_confidence_error
wrong                       -> incorrect
correct + Invalid or Weak   -> unsupported_correct        [NEW]
correct + confidence <= 2   -> low_confidence_correct
correct + over target time  -> slow_correct
otherwise                   -> not enqueued
```

### Advance — review sessions

```
correct + Excellent -> interval_index + 2
correct + Good      -> interval_index + 1     (today's behavior)
correct + Weak      -> hold index, due in 1 day
correct + Invalid   -> reset to 0, due now
incorrect           -> reset to 0, due now, reason repeat_error
```

Advancement is clamped to `len(REVIEW_INTERVAL_DAYS)`. Today `mastered` requires
`interval_index >= 4`; with the `+2` jump it becomes reachable from index 3,
which is intended — two consecutive excellent explanations is a stronger signal
than four correct clicks.

### Scale and reuse

`explanation_band` takes a raw 0–100 int, but `Attempt.explanation_score` is
normalized 0–1. The scheduler must pass `round(explanation_score * 100)`. Both
representations are load-bearing elsewhere, so neither is being changed; the
conversion belongs at the one call site.

Reuse is already handled upstream: `settle_attempt` zeroes
`coaching["explanation_grade"]` for a repeated explanation (`game.py:1436-1443`)
and runs *before* `explanation_score` is written, so a recycled explanation
arrives at the scheduler as Invalid without any extra check.

### Provisional scheduling and backfill

On submit with no grade available, the entry rules run with the band term
omitted (so only the pre-existing reasons can fire), `pre_grade_interval_index`
records the index before any advance, and `grade_pending` is set.

`run_attempt_coaching` calls the backfill immediately after it writes
`explanation_score` (`services.py:1005-1015`), inside the same transaction that
already commits the coaching result. The backfill recomputes from
`pre_grade_interval_index`, applies the full rules including the band, and
clears both new columns.

If coaching fails permanently, the row keeps its provisional state forever. That
is a deliberate degradation to today's behavior, not a hole: the question is
still scheduled, just without the explanation signal.

## Strategy scoring (`strategies.py:333`)

```python
graded = [v for v in values if v.explanation_score is not None]
if not graded:
    return posterior * .76 + pace * .18 + calibrated * .06        # current formula
explanation_mean = sum(v.explanation_score for v in graded) / len(graded)
return posterior * .50 + explanation_mean * .30 + pace * .14 + calibrated * .06
```

`explanation_score` is already normalized 0–1, matching the scale of
`posterior`, `pace`, and `calibrated`, so no rescaling is needed. A strategy with
zero graded attempts falls back to the existing three-term formula rather than
being penalized for missing data.

`strategy_performance` (`strategies.py:422`) gains `explanation_mean`,
`control_explanation_mean`, and `explanation_lift` in each result, and folds
`explanation_lift` into `ranking_score`. The coverage phase, the 30% explore
branch, the hidden 25% control arm, and the `_stable_fraction` seeding are all
unchanged.

## Frontend (`frontend/src`)

| Site | Change |
| --- | --- |
| `components.tsx:762-779` | Block now renders for every non-diagnostic item. Label and placeholder switch on `practice_style`: "Your case theory" for deep/review, "Why this answer" for speedrun/infinite. |
| `components.tsx:766` | Counter becomes `X / min characters`. |
| `components.tsx:792` | Submit gate checks `reasoning.trim().length >= item.reasoning_min_chars`, not just non-empty. |
| `components.tsx:655` | Run header drops "Answer-only · explanations unlock when the run ends" for speedrun. |
| `types.ts:290` | `SessionItem` gains `reasoning_min_chars: number`. |

Draft autosave (`components.tsx:461` → `routes.py:508`) already persists
reasoning text and needs no change.

## Testing (`backend/tests/test_flow.py`)

Extending the existing 45 tests:

1. `requires_reasoning` is true for each of the four practice styles and false
   for diagnostic.
2. Submitting with no reasoning raises `reasoning_required`.
3. Submitting under the floor raises `reasoning_too_short`, with the deep floor
   and the speedrun floor asserted separately.
4. A correct answer graded Invalid enqueues `unsupported_correct`; a correct
   answer graded Good with high confidence and good pace enqueues nothing.
5. Each of the four advance branches moves `interval_index` and `due_at` as
   specified, including the `+2` path reaching `mastered`.
6. A provisional entry followed by a landing grade revises the row and clears
   `grade_pending` and `pre_grade_interval_index`.
7. Strategy scoring falls back to the three-term formula when a candidate has no
   graded attempts, and uses the four-term formula when it has some.

`test_migration_integrity.py` covers the new migration by construction.

## Out of scope

- **Strategy trial cadence.** Trials stay in `deep`/`infinite` at
  `position % 4 == 2`. Extending them to speedrun is a second friction change on
  top of the writing requirement and should be measured separately.
- **`_result_copy` student-facing strategy copy** (`strategies.py:360`). It will
  quote accuracy while the ranking partly reflects explanation quality. Worth a
  follow-up once the new numbers have data behind them.
- **Daily Docket routing** (`services.py:652-661`). Method Lab stays reachable
  only from the style picker.
- **`select_random_questions` N+1** (`services.py:309`). `_seen_question_ids` is
  called once per eligible question inside a comprehension. Real, unrelated.

## Risk

This puts an LLM grade on the critical path of every question's schedule.
Grader quality now moves what a student is served, not just what they are told.
The backfill design keeps it off the request path, and a total grader outage
degrades to today's scheduling — but the coupling is new and should be watched.
