# One Practice Mode: Do Cases

**Date:** 2026-08-01
**Status:** approved, ready for implementation

## Problem

There are four practice styles — `speedrun` (Sprint), `deep` (Method Lab),
`infinite` (Infinite), and `review` (Review) — plus the diagnostic as a separate
session mode. Every behavior in the practice loop is a lookup keyed on which one
the student picked: the feedback policy, the evidence class, the explanation
floor, whether a strategy trial fires, and whether the case pays anything.

The split costs more than it buys.

**The student is asked to choose a mode before they have any basis to choose.**
The lobby presents four options across three separate surfaces
(`pages.tsx:927`, `pages.tsx:933`, `pages.tsx:996`), and the copy explaining the
choice — "choose the amount of friction you need" — asks a beginner to decide
how much coaching they deserve.

**Three of the four modes are strictly weaker than the fourth.** Only `deep`
runs the full loop: written explanation, AI grade, coaching panel, strategy
trial, and game settlement. Sprint and Infinite skip the strategy trial entirely
(`strategies.py:311` excludes Sprint; `assign_strategy_trial` is gated to
`{"deep", "infinite"}`). Only `deep` attaches game context, so only `deep` pays
(`services.py:208`). A student who follows the app's own suggested flow — the
quick-start buttons at `pages.tsx:72` and `pages.tsx:76` both hardcode
`speedrun`, and the Daily Docket's `next_action` emits `start_speedrun` — never
touches the mode that does the most for them.

**The mode branch is load-bearing in places it should not be.**
`_schedule_review` decides whether to advance a review card or enqueue a new one
by asking `session.practice_style == "review"` (`services.py:935`). That is a
per-session answer to a per-question question, and it is why a run cannot
contain both fresh work and repairs.

## Goals

1. One practice mode, "do cases". No pre-run choice.
2. Every case runs the strategy trial and switching algorithm.
3. Every case requires a written explanation, grades it, and lets that grade
   move both the game score and the measurement panels.
4. Spaced review survives as scheduling, not as a mode the student picks.

## Non-goals

- The diagnostic is unchanged: no explanation, no coaching, no strategy trial,
  no cash. It remains a separate session `mode`.
- The grading prompt, band thresholds, review interval ladder, and economy
  payout math are unchanged.
- The 8-run queue, pause/resume/discard, and server-authoritative timing are
  unchanged.

## Decisions

| Question | Decision |
| --- | --- |
| How to collapse | Rename `deep` to `cases`; delete the other three styles. Keep the `practice_style` column. |
| Spaced review | Folded into question selection, capped at half a run. |
| Strategy trial cadence | Every question is trial-eligible. |
| What pays | Every practice case. The `deep`-only pay gate is removed. |
| Dashboard headline | Diagnostic accuracy only. Coached practice gets its own panel. |
| Historical `evidence_class` | Not rewritten. |
| In-flight runs at migration | Converted in place. |

### Why keep `practice_style`

With one value the column is near-redundant with `mode`. Dropping it means a
`DROP COLUMN` on an indexed `NOT NULL` column plus a rewrite of every read site
including `seed_demo.py`, `live_trial_state.py`, and `types.ts`, for no
user-visible gain, in the same change that is already rewriting the practice
loop. `EVIDENCE_CLASS` and `reasoning_min_chars` already dispatch on it, and the
diagnostic still stores `"diagnostic"` there. Removing it is a reasonable
follow-up once this has settled; it is not part of this change.

## The mode (`backend/app/services.py`)

```python
PRACTICE_STYLES = {"cases"}
```

Four lookups collapse to constants:

| Site | Today | After |
| --- | --- | --- |
| `STYLE_FEEDBACK_POLICY` (`:21`) | per style | always `immediate` |
| `EVIDENCE_CLASS` (`:27`) | per style | `cases` → `coached_practice`; `diagnostic` unchanged |
| `REASONING_MIN_CHARS` (`:35`) | 120 / 40 split | always `120` |
| `reasoning_min_chars` (`:38`) | `0` for diagnostic, else table | unchanged in behavior |

`create_study_session` (`:433`) keeps its `practice_style` parameter with a
default of `"cases"` so the diagnostic path and tests stay explicit, but the
validation branch, the `feedback_policy` mismatch check, and the
`practice_style == "review"` question-selection branch are all deleted.

Run size stays `PRACTICE_SESSION_SIZE` (default 10, `__init__.py:87`).

`finish_infinite_session` (`:611`) and its `not_infinite` guard are deleted along
with `_append_infinite_item` (`:840`) and the `/study-sessions/<id>/finish`
route that reaches them. An unbounded run has no meaning once every run has a
fixed length.

## Review folds into question selection

`create_study_session` seeds due repairs first, then fills the rest with unseen
questions:

```python
repairs = [] if question_type else _questions_due_for_review(user.id, session_size // 2)
fresh = select_random_questions(
    session_size - len(repairs), question_type, user_id=user.id,
    exclude_ids={question.id for question in repairs},
)
questions = repairs + fresh
```

Half the run is the ceiling so a large queue cannot turn every run into pure
repetition. An empty queue yields a full fresh run, so `no_reviews_due` stops
being an error condition and its handler in `routes.py:550` is deleted.

Repairs come first in position order. Retrieval practice is most useful before
fatigue, and it keeps the seeding deterministic and easy to assert in tests.

A `question_type`-filtered run — the focused drill started from
`pages.tsx:76` — skips repair seeding entirely. Mixing off-type repairs into a
run the student asked to be about one question type would defeat the filter.

`select_random_questions` (`:327`) needs a new `exclude_ids` argument. Its
current fallback is `pool = unseen if len(unseen) >= count else unseen + seen`,
so once the bank runs low it will happily return a question the student has
already seen — including one just seeded as a repair, which would put the same
question twice in one run. Filtering `exclude_ids` out of both `unseen` and the
fallback tail closes that.

### `SessionItem.from_review_queue`

`_schedule_review` (`:919`) currently branches on
`session.practice_style == "review"` to choose between advancing a card along
the ladder and enqueueing a new one. That discriminator disappears, and it was
always answering a per-question question at session granularity.

A new column `session_items.from_review_queue` (bool, `NOT NULL`, default false)
is set true on seeded repairs. `_schedule_review` branches on
`attempt.session_item.from_review_queue`. `_advance_review` (`:888`) is
unchanged — it already takes the card and the attempt, not the session.

This is strictly more correct than today: a single run can now contain repairs
and fresh work, and each item is scheduled by what it actually is.

## Strategy trials on every question (`backend/app/strategies.py`)

`assign_strategy_trial` (`:303`) drops both gates:

```python
if practice_style not in {"deep", "infinite"} or position % 4 != 2:
    return None
```

becomes

```python
if practice_style == "diagnostic":
    return None
```

Unchanged: `_candidate_keys`, the coverage phase (`minimum < 3`), the posterior
score with `explanation_mean` weighted `.30`, the 30% explore branch, the hidden
25% control arm, and `_stable_fraction` seeding.

The sparse cadence existed to keep Sprint and Infinite clean as measurement
surfaces. With the diagnostic as the only clean surface, that reason is gone,
and firing on every question makes the prompt-versus-control comparison
converge roughly four times faster.

The seed string is `f"{user_id}:{question.id}:{position}:{practice_style}"`, and
`practice_style` changes value from `deep` to `cases`. Existing users get a
one-time reshuffle of which strategy they would be assigned on a given question.
Recorded `strategy_key` values on past attempts are unaffected, so
`strategy_performance` history is intact.

`strategy_performance`'s `empty_state.body` (`strategies.py:522`) says "Answer
questions in Method Lab or Infinite." It becomes "Answer a few cases. Every
question arrives with a suggested approach."

## Explanation grade reaches the score (`backend/app/game.py`)

The grading path is already complete and does not change: `run_attempt_coaching`
(`services.py:1115`) writes `Attempt.explanation_score`, `explanation_band`
(`game.py:1295`) maps it to Invalid/Weak/Good/Excellent, and `_score_multiplier`
plus `EFFORT_MISS_MULTIPLIER` turn that into money and reputation.

One condition changes. `_freeze_current_case` (`services.py:204`) refuses to
attach game context unless `practice_style == "deep"`, which is the sole reason
only Method Lab pays:

```python
if (
    item.session.mode == "diagnostic"
    or item.session.practice_style != "deep"     # deleted
    or item.game_context_json is not None
    ...
```

With that clause gone, every practice case snapshots a client and settles. A
well-argued wrong answer earns the `EFFORT_MISS_MULTIPLIER` consultation fee; a
correct answer with an Invalid explanation earns the `.55` floor multiplier.

### The measurement principle this breaks

`FEATURES.md:36` states as a design principle that "the game layer must not be
able to distort measurement — only one practice mode pays money." That
principle does not survive this change: every measured practice attempt now
carries a cash incentive.

The containment is the dashboard change below. The diagnostic pays nothing and
becomes the only headline number, so the surface used to claim performance is
the one surface the economy cannot touch. `FEATURES.md` must be rewritten to say
this rather than left contradicting the code.

## Dashboard (`performance_snapshot`, `services.py:1241`)

| Site | Change |
| --- | --- |
| `:1345` `test_values` | filter narrows from `{"timed_unseen", "diagnostic"}` to `{"diagnostic"}` |
| `:1350` `readiness_status` | unchanged formula, now fed only by diagnostic attempts |
| `:1352` `review_values` | reads items with `from_review_queue`, not the `spaced_review` evidence class |
| new | a `coached_practice` panel: accuracy, pace adherence, and mean explanation grade over `coached_practice` first attempts |

Readiness survives the narrowing. `select_diagnostic_questions` (`:344`) splits
`count * 2/3` LR to the remainder RC, so a 75-question diagnostic yields exactly
50 LR and 25 RC against the 40/20 gate — one completed diagnostic still clears
it.

Frontend labels follow: "TIMED UNSEEN ACCURACY" becomes "DIAGNOSTIC ACCURACY"
at `pages.tsx:145`, `:148`, `:175-178`, and `:188`, and the "Comparable Sprint
and Diagnostic work only" note at `:189` becomes diagnostic-only. The evidence
separation explainer at `:269` is rewritten for two surfaces instead of five.

Historical `attempts.evidence_class` values are **not** rewritten. They record
how an attempt was actually collected, and the `evidence_classes` breakdown
should keep showing that history honestly. Review recovery history survives
because the migration backfills `from_review_queue` from old review sessions.

## Daily docket (`daily_docket_snapshot`, `services.py:682`)

Two of its three steps referenced modes that no longer exist. It becomes:

| Step | State source |
| --- | --- |
| 01 · Do cases | a `cases` run completed today with `total_items >= 5` |
| 02 · Brief | that run's `summary_seen_at` |

`next_action` kinds `start_review` and `start_speedrun` merge into
`start_cases`. `resume`, `open_brief`, and `done` are unchanged. The response
keys `review` and `speedrun` are replaced by a single `cases` key;
`deep_brief` keeps its name and its `priority_count`, still computed from
`session_review`'s `priority_reason` items.

The `review` key's `due` count still has a consumer — the lobby shows how many
repairs are waiting even though they can no longer be started directly — so it
moves to `cases.repairs_included`.

## Frontend (`frontend/src`)

Deletions in `pages.tsx`:

| Site | What goes |
| --- | --- |
| `:732` | `practiceStyle` state |
| `:802` | `practiceModeCopy` |
| `:927-932` | the mobile mode tablist |
| `:933-938` | the spaced-review button |
| `:995` | the "CHOOSE ANOTHER MODE" heading |
| `:996-1001` | the `practice-mode-picker` section |
| `:72`, `:76` | `practice_style` / `feedback_policy` arguments to `startPractice` |

The run queue at `:865` renders `practiceModeCopy[run.practice_style]` for each
queued run; it becomes a single label and icon. The lobby's start button loses
its four-way ternary (`:964`) and reads "Start 10 cases", showing repairs folded
in when the queue is non-empty.

In `components.tsx`, `isInfinite`, `compactReview`, `learningOnly`, and
`shortForm` (`:557-563`) become constants — the full coaching panel renders on
every answer — and the "end infinite run" control is deleted with them.

`api.ts:129` drops `practice_style` and `feedback_policy` from the
`startPractice` payload type. `types.ts:335` narrows to
`'cases' | 'diagnostic'`; `types.ts:475-478` follow the docket reshape.

Corresponding CSS for the deleted picker sections is removed from `styles.css`
and `mobile.css`.

## Migration (`0021_single_practice_mode.py`)

Revises `0020_profile_scoped_ledger`.

1. Add `session_items.from_review_queue`, bool, `NOT NULL`, server default false.
2. Backfill it true for items whose session had `practice_style = 'review'`.
3. `UPDATE study_sessions SET practice_style = 'cases', feedback_policy = 'immediate' WHERE mode = 'practice'`.

`attempts.evidence_class` is left alone.

In-flight runs convert in place: a paused Sprint resumes as a cases run with
immediate feedback and a 120-character explanation floor. Already-submitted
attempts inside it keep their recorded evidence class and their (absent) game
settlement. The alternative — force-completing queued runs — destroys student
work to avoid a cosmetic inconsistency in a run they can discard themselves.

`downgrade` restores the column and reverses step 1; it cannot restore which
style a converted session originally had, and says so in its docstring.

## Testing (`backend/tests/test_flow.py`)

1. `create_study_session` rejects any style other than `cases`, and the route
   ignores a `practice_style` in the payload.
2. Every item in a cases run has `requires_reasoning = True` and a
   `reasoning_min_chars` of 120; a diagnostic item has 0.
3. With N due repairs and a run size of 10, exactly `min(N, 5)` items carry
   `from_review_queue`, they occupy the first positions, and the remainder are
   unseen.
4. An empty review queue produces a full fresh run rather than an error.
5. A `from_review_queue` item advances the ladder on a correct Excellent answer
   (`interval_index + 2`); a fresh item in the same run enqueues via
   `_entry_reason` instead. Both in one session.
6. Every position in a cases run carries a `strategy_key`, including positions
   where `position % 4 != 2`. Trial assignment is deterministic
   (`_stable_fraction`), so the test asserts an exact per-position variant
   sequence for a fixed user and question set rather than a proportion.
7. A focused run (`question_type` set) contains no `from_review_queue` items
   even when repairs are due, and every question matches the requested type.
8. When the unseen pool is smaller than the run size, no question appears twice
   in a run that also seeded repairs.
9. A cases attempt attaches `game_context_json` and settles cash and reputation;
   a diagnostic attempt does neither.
10. `performance_snapshot`'s `test_performance` counts diagnostic attempts only,
    and the new coached-practice panel counts cases attempts.
11. `review_recovery` is computed from `from_review_queue` attempts.
12. `daily_docket_snapshot` returns `start_cases` when nothing is done today and
    `open_brief` after a cases run completes.

`test_migration_integrity.py` covers `0021` by construction.

## Documentation

`FEATURES.md` sections 2.3 (the practice styles table), 2.4, 3 (strategy trial
eligibility), the routing table at `:616`, and the "only one of four practice
modes pays" note at `:819` are rewritten. The design principle at `:36` is
replaced with the diagnostic-only-measurement statement above rather than
deleted, so the reasoning stays on the record.

## Risk

Every measured practice attempt now carries a cash incentive, and every question
now carries a strategy prompt or a silent control. Both were previously diluted
across four modes. If the strategy prompt turns out to slow students down, it
now slows down all of their practice rather than a quarter of it — the 25%
control arm is what makes that detectable, and it is the first thing to look at
after this ships.
