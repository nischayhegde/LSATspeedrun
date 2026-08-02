# Mega-Litigation: one clock, one sitting, one tier

**Date:** 2026-08-02
**Status:** approved

## Summary

The diagnostic becomes the **Mega-Litigation**: a full practice LSAT timed as a single
countdown instead of question by question, taken in one sitting, rewarded with a free firm
tier when it clears 70%, and used to steer which practice questions and strategies the app
serves afterwards. It remains optional and blocks nothing.

`mode = "diagnostic"` stays the name in the database, the API, and this codebase. Everything a
player reads says "Mega-Litigation."

## Decisions

| Question | Decision |
| --- | --- |
| Clock | One countdown for the whole form, hard stop at zero |
| Leaving mid-run | Clock keeps running on wall-clock time; no pause, no reset |
| Tier reward | Every run above 70% advances exactly one tier, unlimited |
| Practice shaping | Automatic weighting toward measured weaknesses, explained in the UI |
| Free navigation between questions | Out of scope; the run stays linear |

## 1. The clock

`StudySession` gains `deadline_at`. `create_diagnostic_session` sets it to
`started_at + target_minutes × 60`, where `target_minutes` is the block-plan sum the function
already computes (~105 minutes for 75 questions) scaled by the accommodation multiplier
(1.0×, 1.5×, 2.0×).

The clock is wall-clock and nothing pauses it. `pause_study_session` and the resume path
reject diagnostics with `diagnostic_no_pause`. The client shows a confirmation gate — one
sitting, ~105 minutes, a full practice LSAT, no pausing, no saving — **before** the POST that
creates the session, so no "armed but not started" state has to exist.

`enforce_diagnostic_deadline(session)` runs at the top of every path that touches a
diagnostic: `find_active_diagnostic`, session serialization, draft save, attempt submit,
debrief acknowledge. Past the deadline it finalizes the run:

- `status = "completed"`, `completed_at = deadline_at`, `summary_json` computed
- unanswered questions are counted as omitted (`summary["omitted"]`, already implemented)
- the tier promotion is evaluated (§2)

Enforcing inside `find_active_diagnostic` means a run that expires while nobody is looking is
already finalized the next time the Progress page or `next_route` asks about it. No sweeper
job. An attempt that arrives after the deadline is rejected with `diagnostic_expired` and the
run finalizes — strict, like a proctored section.

`serialize_session` exposes `deadline_at`, `time_limit_seconds`, and a server-computed
`remaining_ms` for diagnostics so the client never has to trust its own wall clock for
anything but the second-by-second tick between polls.

### What happens to per-question timing

The three blocks (LR I / RC / LR II) survive as **labels**: they keep RC passages intact and
give the results a breakdown. `section_plan_json` loses its per-section `minutes`, because
there are no section clocks any more.

Per-question splits keep recording (`active_elapsed_ms`, `server_elapsed_ms`), so results can
still show where the time went. What changes is what they are measured against. Measuring a
student against a 150-second target the app no longer shows or enforces would be dishonest —
and the old targets were never coherent for a form anyway: 150 s LR / 330 s RC summed to
roughly 15 750 seconds against a 6 300-second budget.

So `create_diagnostic_session` overwrites every item's `target_time_seconds` with an even
split of the form budget, `max(30, round(target_minutes × 60 / len(questions)))`. Per-question
pace adherence stays meaningful, keeps working for `pace_adherence` and the Speedrun Index
without any frontend change, and now means something honest: "an even split of the clock."
Session-level pace is reported alongside it — time used against budget, and how far into the
form they got. Coached practice keeps its realistic per-question targets untouched.

## 2. The tier reward

A finished Mega-Litigation with `correct / total_items > 0.70` advances the firm one tier for
free. The denominator is the **whole form**, not the questions answered — otherwise answering
three questions correctly and walking away would clear the bar.

`grant_mega_litigation_promotion(profile, session)` in `game.py`:

1. Locks the profile and settles upkeep, like every other economy mutation.
2. No-ops at the maximum tier.
3. Grants every missing tier-gated prerequisite (`_missing_tier_assets(target)`) as a
   `PlayerAsset` at `purchase_price = 0`.
4. Raises reputation to the new tier's minimum if it is below — otherwise the profile would
   sit at a tier its own reputation says it cannot hold, and client unlocks key off
   reputation.
5. Sets `office_tier`, writes a `mega_litigation_promotion` ledger row keyed on the session id.

Idempotency comes from `uq_ledger_source` on `(user_id, kind, source_id)`: a promotion is
attempted once per session id and the constraint is the backstop. Finalization runs from two
paths (last answer acknowledged, deadline expiry), so this matters.

The promotion result rides back on the diagnostic-complete response and on the session review
payload, so the results screen can show what the firm won.

**Stated risk.** The diagnostic is the one surface the headline accuracy number trusts, and it
has paid nothing until now precisely so the economy could not distort it. A free tier at 70%
gives a student a reason to cheat on the only honest number in the app. This is a deliberate
trade for progression that rewards skill: the run still pays no per-question cash, prompts no
strategy, and coaches nothing mid-form, so the distortion is a single lump at the end rather
than a pull on every question.

## 3. Shaping practice

New module `focus.py` — imported by both `services.py` and `strategies.py`, importing only
models, so no import cycle.

`diagnostic_focus(user_id)` reads the most recent completed diagnostic, groups its attempts by
`question_type`, keeps types with at least two attempts, and returns those below the run's own
accuracy, weakest first, capped at five. No diagnostic, or no weakness, returns an empty
focus.

**Question selection.** `select_random_questions` accepts the focus list and fills up to 60%
of the fresh (non-repair) slots from focus types when enough unseen questions exist, the rest
at random. Practice never becomes pure drilling on one type.

**Strategy trials.** `assign_strategy_trial` raises the coverage threshold from 3 to 5
observations for questions in a focus type. On a measured weakness the trial keeps exploring
candidate approaches longer before it settles on the best performer, which is where the
exploration is worth paying for. The hidden 25% control arm is untouched, so the
prompt-versus-control comparison stays valid.

**Explanation.** `performance_snapshot` returns a `focus` block (the types, the source run,
and a sentence naming them). The practice surfaces render it, so the weighting is visible
rather than mysterious.

## 4. Naming and de-nagging

- Every player-facing string becomes "Mega-Litigation," subtitled as a full practice LSAT
  (75 questions, ~105 minutes).
- `DiagnosticReminderBanner` is deleted. Nothing nags.
- The readiness panel drops "1 required" and describes what a Mega-Litigation adds instead.
  The underlying readiness maths is unchanged — it is a statistical-confidence label, not a
  gate on anything.
- `next_route` still points at an *in-progress* Mega-Litigation, because its clock is burning;
  it never points at one that has not been started.

## 5. Testing

Backend (`backend/tests/test_flow.py`):

- a diagnostic carries a `deadline_at` of `started_at + target_minutes`
- pause and resume are rejected for a diagnostic
- an attempt after the deadline is rejected and the run finalizes with the right omitted count
- `find_active_diagnostic` finalizes an expired run rather than returning it
- above 70% grants exactly one tier plus every missing prerequisite asset, at zero cash
- at or below 70% grants nothing
- the promotion is written once even when finalization is reached twice
- a promotion at the maximum tier is a no-op
- focus types come from the latest diagnostic's weakest question types
- a practice run built with a focus draws most of its fresh questions from those types
- a focus type raises the strategy coverage threshold; a non-focus type does not
- the diagnostic still attaches no game context, no strategy trial, and no per-question cash

Frontend: `npm run typecheck` and `npm run lint`.
