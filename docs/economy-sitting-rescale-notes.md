# The sitting went from ten questions to six

Branch `cursor/shorten-case-and-rescale-economy-508c`, based on
`integration/all-features` at `82acaf6`.

Everything here is one change: a practice run is six questions instead of ten,
and every constant that was counted in whole runs was re-expressed so that
neither the campaign's length nor its question count moved.

---

## The terminology trap, resolved first

The word "case" means two different things in this codebase and they are a
factor of six apart.

| Where | What "case" means | Examples |
|---|---|---|
| Economy code, `profile.total_cases`, `simulate_economy_curve.py` | **one attempted question** | `TARGET_CASES_PER_MILESTONE`, `TERRITORY_TOTAL_CASE_BUDGET`, `DAILY_REWARD_CASE_BUDGET`, `_case_target_for_tier`, client `length`, `REPUTATION_WARMUP_CASES`, story quest targets |
| Interface, and the user's own message | **a whole sitting of questions** | "Start 6 cases", the Practice tab, the guided tour |

`settle_attempt` runs once per answered question and does `profile.total_cases
+= 1`. That is the definition, and every price in `game.py` is quoted against
it. `game.SITTING_QUESTIONS` is now the single place in the app that means a
sitting, and it says so.

The trap has already cost this project once: `TIER_EFFORT_BASE` carries a
comment about a prior revision that priced the ladder against "3 to 6 cases"
while the brief meant "an hour or two". At 3.49 minutes a question those two
readings are 8x apart, and the ladder was mispriced until it was caught.

---

## The target figures, and where they came from

Recovered from `backend/scripts/simulate_economy_curve.py` and
`backend/tests/test_game_catalog.py`, not invented.

- **`TARGET_HOURS_PER_UPGRADE = (1.0, 2.0)`.** One mandatory purchase — a
  tier-gated upgrade, hire, acquisition, or the next headquarters — should cost
  one to two hours of play. The script pins hours rather than cases on purpose,
  because hours are what the player experiences and what survives a repacing.
- **The band as measured at `82acaf6`: 17.38 to 29.31 cases per upgrade**, which
  the script converts to 1.02 to 1.71 hours. This is the "1.08 to 1.85 hours"
  figure in the task description; it has moved slightly since whenever that was
  read off.
- **"Three to six cases per upgrade" is the misreading, not the target.** At the
  shipped pace that is 10 to 21 minutes. The correct statement is three to six
  *sittings* per upgrade, and the curve now prints that line too.
- **The whole campaign: 2,085.7 played cases and 121.95 hours** for the script's
  default player (72% accuracy, 20 cases a day, claims dailies). That is the
  figure the rescale had to hit, and it is now pinned in
  `backend/tests/test_sitting_scale.py`.

### One caveat on those hours, which was found while measuring and left alone

`simulate_economy_curve.py` converts cases to hours at 210.5 s/question,
documented as the section mix "the selector actually serves". It is not. 210.5
is the *catalog* mix, 66% Logical Reasoning to 34% Reading Comprehension by
question count. Selection draws indivisible passage blocks, and the bank holds
4,520 single-question LR blocks against 349 RC passages, so a shuffled draw is
overwhelmingly LR. Measured with the new
`backend/scripts/measure_served_section_mix.py`, a ten-question run serves 17.8%
RC and 152.7 s/question.

So every hour the script prints is about 38% high, and the campaign it calls 122
hours is nearer 88 hours of question time.

**The constant was deliberately not corrected.** It is what the shipped pace band
was tuned against — `TIER_EFFORT_BASE` was moved 5.16 to 5.33 to hold one-to-two
hours *measured this way*, and the band has 0.2% of clearance at its floor.
Correcting the conversion would not measure the ladder more accurately, it would
repace it: the one-to-two-hour band would become 23.6 to 47.2 cases and today's
17.3 to 29.2 would fall straight through the floor, needing a fresh
`TIER_EFFORT_BASE` and a fresh set of prices. That is a retune and needs asking
for, not smuggling in under a measurement fix. The reasoning is written into the
script beside the constant, and the curve now prints both numbers.

---

## The campaign, before and after

`backend/.venv/bin/python -m scripts.simulate_economy_curve`, run against
`82acaf6` in a worktree and against this branch.

| Player the script models | Before (played cases) | After | Drift |
|---|---|---|---|
| realistic, 72% accuracy | 2,085.7 | 2,084.8 | −0.04% |
| flawless, 100% accuracy | 1,275.9 | 1,277.3 | +0.11% |
| pro bono docket | 3,241.1 | 3,250.3 | +0.28% |
| grader outage on 1 case in 5 | 2,190.4 | 2,187.6 | −0.13% |
| every district held, rent retired | 2,060.8 | 2,059.8 | −0.05% |
| light day, 6 cases a day | 1,844.4 | 1,842.8 | −0.09% |
| never collects idle retainers | 2,335.4 | 2,334.8 | −0.03% |
| never claims daily goals | 2,311.7 | 2,310.5 | −0.05% |

Headline curve, realistic player:

```
before  band 17.38 - 29.31 cases (1.02h - 1.71h)  IN BAND
        whole campaign: 2,086 played cases, 122.0 hours

after   band 17.27 - 29.31 cases (1.01h - 1.71h)  IN BAND
        which is 2.9 - 4.9 sittings of 6 questions
        whole campaign: 2,085 played cases, 121.9 hours
        = 347 sittings; 88.4 hours at the pace the selector actually serves
```

No scenario changed its in-band / out-of-band verdict. The three that were
already out of band (flawless, pro bono, light day) were out of band before and
are out by the same margin.

### What the player actually feels

Measured with `measure_served_section_mix.py` at its defaults, 4,000 generated
runs per setting against the real bank:

| run | q/run | range | RC% | s/q | min/run |
|---|---|---|---|---|---|
| 10, no allowance (was) | 10.00 | 10–10 | 18.2% | 152.7 | **25.5** |
| 6, allowance 2 (shipped) | 6.20 | 6–8 | 16.7% | 152.6 | **15.8** |

A run is 15.8 budgeted minutes instead of 25.5, and the campaign is 347 sittings
instead of 209. Same questions, same hours, 66% more finished runs.

---

## Six rather than five, and why the allowance exists

A Reading Comprehension passage is one indivisible block — a prior session fixed
a bug that split passage-mates — and passages in this bank run 4 to 16 questions
with a median of 7. A run that may never exceed its target can therefore only
serve a passage *shorter* than the target:

| run may not exceed | passages reachable | RC questions reachable |
|---|---|---|
| 5 | 41 / 349 | 8.6% |
| 6 | 139 / 349 | 33.5% |
| 7 | 264 / 349 | 70.5% |
| 8 | 345 / 349 | **97.8%** |
| 10 | 347 / 349 | 98.6% |

At ten questions this cost nothing. At six it strands two thirds of Reading
Comprehension — and that is a *length* problem as well as a content one, because
RC is budgeted at 330s against LR's 150s, so squeezing RC out of the mix makes
the average question cheaper and the campaign quietly shorter with no price
changing.

`services.PASSAGE_OVERSHOOT_ALLOWANCE = 2` lets a run finish at 8 to serve a
passage whole. Six with an allowance of two holds the served mix at 16.7% RC and
152.6 s/question against ten's 18.2% and 152.7 — a difference of 0.1%, which is
the whole of the change in campaign length.

Five with an allowance of three was measured and is close (18.0% RC, 152.8
s/question) but gives a much less predictable run, 5 to 8 questions rather than 6
to 8. Six was chosen for that.

Four passages longer than eight questions (one of 9, one of 10, two of 16; 51
questions, 2.2% of the RC bank) are no longer reachable and were reachable at
ten. That is the price of the shorter run and it is paid knowingly.

---

## Every variable that moved

| Constant | Was | Now | Unit | Why |
|---|---|---|---|---|
| `game.SITTING_QUESTIONS` | (didn't exist; 10 implied) | **6** | sitting | The change itself |
| `game.LEGACY_SITTING_QUESTIONS` | — | **10** | sitting | So the rescale is re-derivable, not hand-typed |
| `game.RULE_VERSION` | `lsat-tycoon-v8` | **`lsat-tycoon-v9`** | — | Contract counters and claimed milestones are not comparable across it |
| `game.DAILY_REWARD_MULTIPLIERS` | `{5: 1, 10: 3, 20: 8}` | **`{6: 1, 12: 3, 18: 8}`** | questions | All three goals now close at a run boundary |
| Client contract `length`, all 69 clients (10 distinct) | 4, 5, 6, 7, 8, 9, 10, 12, 14, 15 | **3, 3, 4, 4, 5, 5, 6, 7, 8, 9** | wins (questions) | A bar that took one run still takes one run |
| Asset `contract_bonus_mult`, 8 assets | 1, 2, 3 | **0.6, 1.2, 1.8** | multiple of fee | Contracts close nearly twice as often, so the per-question value is held |
| `PRACTICE_SESSION_SIZE` default | `10` literal | **`SITTING_QUESTIONS`** | questions | One source |
| `PRACTICE_QUEUE_MAX` default | `8` literal | **13**, from `PRACTICE_QUEUE_QUESTIONS / SITTING_QUESTIONS` | runs | The cap is on queued *work*: 80 questions, not 8 presses |
| `services.PASSAGE_OVERSHOOT_ALLOWANCE` | (didn't exist; hard 0) | **2**, bounded to a third of the run | questions | Keeps 97.8% of RC reachable |
| `daily_docket` "substantial run" | `5` literal | **`round(session_size / 2)`** = 3 | questions | Was most of a ten-run, is more than half a six-run |
| `daily_docket` cases target and label | `10`, "Start 10 cases" | **`session_size`** | questions | Copy tracks the constant |

### Two the user named by hand

- **Walk-ins.** The walk-in is a client like any other and its contract is the
  shortest thing most players ever see. `length` 8 → **5**: it closed in a little
  over one ten-question run and still closes in a little under one six-question
  run. Left alone it would have taken nearly two.
- **Case pickup cadence.** There is no separate cadence constant to scale — how
  often a player picks up a case is set by the run length and the contract
  length, and both moved together. What I checked and found nothing to change in:
  story quest targets (2 to 5 questions, all still inside one run), the client
  unlock gates (reputation and tier, not cases), and the review queue's entry
  rules (per question).

### Client contract copy

Four clients described themselves by their length in prose — "Fast 5-case
confidentiality sprint", "Loyalty-heavy 8-case docket", "Long 9-file mystery
docket", "Five-case licensing blitz". None contains any of the words
`_drop_stale_contract_copy` strips, so they would have started lying silently.
`_restate_contract_length_copy` rewrites the number and keeps the character: a
docket that says it is long still says so, with the right count beside it.

---

## What was deliberately left alone

Everything below is denominated in **questions, currency, or days**, so the
sitting does not reach it. Rescaling any of it would have broken the campaign
invariant rather than preserved it.

- **`TARGET_CASES_PER_MILESTONE = 5`, `FIRM_TIER_COST_MULTIPLIER = 1`,
  `TIER_EFFORT_BASE`, `TIER_EFFORT_STEP`, every price in `ASSETS` and
  `FIRM_TIERS`.** Per question. These *are* the campaign length.
- **`DAILY_REWARD_CASE_BUDGET = 2.0`.** A day's claims are worth two nominal
  cases, split 1:3:8. Only the milestone *counts* moved; the money did not, which
  is why the pace band did not move either.
- **`TERRITORY_TOTAL_CASE_BUDGET = 65.0`** and the whole counsel board. Priced in
  questions and against rent, which is currency per day. Still 61.9 played cases,
  3.0% of the campaign, 39% self-financed by rent relief.
- **`TERRITORY_STANDING_FLOOR_CEILING = 90.0` against the final headquarters'
  94 reputation.** Both are reputation points; neither is reachable from the
  sitting. Now pinned by
  `test_district_standing_still_cannot_buy_the_last_headquarters`, because the
  relationship is load-bearing, invisible to the player, and easy to break from a
  direction that looks unrelated.
- **Rent: `ACTIVE_RENT_WINDOW` (24h), `OFFLINE_RENT_NUMERATOR/DENOMINATOR`,
  `RENT_ARREARS_DAYS`, `RENT_ACCRUAL_MICROS_PER_CENT`.** Per day and per hour.
  A day still holds the same number of questions, so a day still costs the same
  rent against the same income.
- **`STREAK_STANDING_LADDER` (3, 6, 10, 15, 21 wins), `STREAK_STANDING_CAP`,
  `STREAK_STANDING_PER_DAY`.** Wins are questions, and the binding gate is the
  *day* count — one point of standing per consecutive working day — which the
  sitting cannot touch. Shortening the ladder would have made streak standing
  cheaper, not neutral.
- **`REPUTATION_WARMUP_CASES = 10`.** Ten settled *questions*, easing the
  early-reputation drop ceiling. It used to end exactly at the end of run one and
  now ends part-way through run two, so a new player gets slightly more
  forgiveness rather than less. Left in questions on purpose.
- **Story quest targets (2 to 5 cases).** Per question. Every one still completes
  inside a single run.
- **Mega-litigation.** `DIAGNOSTIC_SESSION_SIZE` is 77 and is derived from
  nothing this change touches. Not one line of `exam.py` was edited.
- **`backend/app/strategies.py`.** Owned by a sibling branch. Untouched.

---

## Files touched, and where this may conflict

```
backend/app/game.py                            the economy: sitting, goals, contracts, bonuses
backend/app/services.py                        run construction, passage allowance, daily docket
backend/app/__init__.py                        PRACTICE_SESSION_SIZE / PRACTICE_QUEUE_MAX defaults
backend/app/routes.py                          serves session_size on two endpoints
backend/scripts/simulate_economy_curve.py      sittings in the report, the pace caveat, database fallback
backend/scripts/measure_served_section_mix.py  new
backend/tests/test_sitting_scale.py            new
backend/tests/test_economy_simulation.py       new
backend/tests/{test_flow,test_progress,test_game_catalog}.py   variable run length
backend/.env.example                           stops pinning 10
deploy/ec2/cloudformation.yaml                 stops pinning 10 (one deleted line)
frontend/src/api.ts                            session_size on two response types
frontend/src/pages/{cases,dashboard}-page.tsx  copy reads the served size
frontend/src/guided-tour.tsx                   two sentences, numbers only
```

**Expect conflicts on:**

- `deploy/ec2/cloudformation.yaml` — one deleted line, against the deploy branch.
  Resolve by keeping the deletion. Leaving `PRACTICE_SESSION_SIZE=10` in the
  user-data means production keeps ten-question runs while everything else in the
  app is built for six, which is worse than either choice on its own.
- `frontend/src/guided-tour.tsx` and the two page files, against the interface /
  mobile / tutorial branch. My edits are numbers and one added clause; if that
  branch has rewritten the surrounding copy, take theirs and re-check the number.
- `backend/tests/test_flow.py` and `test_progress.py`, against the QA branch. The
  edits there are all the same shape: a test that assumed a run is exactly `size`
  questions now reads `session["total_items"]` or uses
  `services.passage_overshoot_allowance`.

## What to check by hand after merging

1. Start a run from the Practice tab. It should say "Start 6 cases" and serve 6
   to 8 questions — 8 only when it picked up a reading passage, and the passage
   should be whole.
2. Look at a client card. The contract bar should be 3 to 9 wins, and any client
   whose blurb quotes a length should quote the same number the bar shows.
3. Finish one run. The first daily goal should complete exactly as the run ends,
   not two questions before or after.
4. Queue runs until it refuses. It should take 13, not 8.
5. `backend/.venv/bin/python -m pytest` from the repo root: 396 pass. Note the
   suite must run from the repo root, not from `backend/` — `pytest.ini` sets
   `pythonpath = backend` and two tests import `backend.app.game` directly.

## One unrelated fix carried on this branch

`simulate_economy_curve.py` reads the per-case time budget out of `instance/` at
import, and its `try` guarded `connect` alone. sqlite3 opens lazily, so every
real failure landed on the first `execute` unguarded — and because three test
modules import the script, the result was an interrupted collection rather than
a failed test:

```
before, with an unmigrated instance/lsat_sherlock.db
  322 tests collected, 3 errors -- Interrupted
after
  396 tests collected
```

Five states of that path were checked: absent, present-but-empty, valid SQLite
never migrated, migrated but never played against, and a file that is not a
database. Only the fourth worked; three of the others raised.

The judgement was that reading the database is an *optional refinement* —
`FALLBACK_SECONDS_PER_CASE` is the shipped figure and the one the pace band was
tuned against, and the query exists only so the conversion cannot drift away
from `_target_time_seconds` unnoticed. So "I could not measure it" and "there is
nothing to measure" get the same answer, and what differs is the provenance
string the report already prints at the top of every run. A database that has
merely not been migrated now reads differently from one that is unreadable,
because the first is ordinary and the second is worth chasing.

Covered by `backend/tests/test_economy_simulation.py`, which also asserts a
populated database is still measured — otherwise the fallback could widen into
one that swallows a working read.

## One decision worth a second opinion

The top daily goal fell from 20 questions to 18. It is the only place this change
asks for less work than it did, and it is a tenth.

Measured, `6/12/20` is indistinguishable from `6/12/18` on the curve — 2,084.8
played cases and 121.90 hours either way, because the modelled player works
twenty a day and claims all three goals under both. `6/12/24` does move it:
2,229.5 cases and 130.4 hours, 7% longer, because a twenty-a-day player stops
claiming the top goal at all.

So the economy did not decide between 18 and 20. It went to 18 because 20 is not
a run boundary: a player chasing it either abandons a fourth run two questions in
— the exact behaviour this change exists to reduce — or finishes it and does 24.
18 asks for three finished runs and nothing half-done.

If the exact 20-question ask matters more than the clean boundary, it is one line
in `DAILY_REWARD_MULTIPLIERS` and `test_every_daily_goal_lands_at_the_end_of_a_run`
is the test that would need relaxing.
