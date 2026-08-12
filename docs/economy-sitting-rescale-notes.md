# The sitting went from ten questions to six

Branch `cursor/shorten-case-and-rescale-economy-508c`, based on
`integration/all-features` at `82acaf6`.

Two changes, in order.

**One:** a practice run is six questions instead of ten, and every constant that
was counted in whole runs was re-expressed so that neither the campaign's length
nor its question count moved.

**Two:** Reading Comprehension is served as whole-passage cases. Shortening the
sitting exposed — and worsened — a defect the QA agent's interleaving audit
measured: the general question filler cannot reach an RC passage at all, so
practice was serving 0.0% Reading Comprehension to anyone with a review queue,
against a bank that is 34.4% RC. A practice case is now either an argument case
or a reading case, and the measured share is 33.7%. See "Reading Comprehension
is now a case shape" below.

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

**The allowance was not enough, and a later pass on this branch replaced the
mechanism.** See the next section.

---

## Reading Comprehension is now a case shape, not a share of a mixed run

The allowance above was aimed at the right problem and did not solve it. The QA
agent's interleaving audit (`docs/audits/interleaving-audit.md`) measured
`select_random_questions` directly, 40 calls per budget, against the real
6,886-question bank, and found that at the fresh budgets every entry point in
the app produces, the served Reading Comprehension share was **0.0%**.

The mechanism: a session asks the review scheduler for `session_size // 2`
first, so the fresh budget is about half the sitting. A passage is indivisible
and 88.3% of passages are six questions or longer, so a whole passage has to win
a slot race against roughly 4,520 single Logical Reasoning questions inside a
budget of 3. It essentially never does. And because fresh selection served no
RC, no new RC entered the review queue either — so from about a student's tenth
answered question onward, practice was 100% Logical Reasoning, permanently.

Shortening the sitting made this worse, which is why it landed on this branch:
at ten the fresh budget was 5, and a cold-start student on a size-10 run was the
one remaining window at 18–26%. At six the budget is 3, and that window closes.

Reproduced on this branch before changing anything, with
`tools/audit/rc_reachability_probe.py`:

| fresh budget | RC share | runs containing any RC |
|---:|---:|---:|
| 2 | 0.0% | 0 of 40 |
| 3 | 0.0% | 0 of 40 |
| 5 | 0.0% | 0 of 40 |
| 6 | 15.7% | 6 of 40 |
| 10 | 23.3% | 15 of 40 |

The allowance is visible in the 6 and 10 rows — it is why they are not the
audit's 5.0% and 18.5%. It does nothing at 3, which is the budget that matters.

### The design

**A practice case is one of two shapes.**

* An **argument case** is the old one: `SITTING_QUESTIONS` questions, up to half
  of them review, **Logical Reasoning only**.
* A **reading case** is **one passage plus its questions**, served whole.

`services.RC_CASE_SHARE = 1/3` decides which. A third is over-determined: the
bank is 34.4% RC, the scored exam is about the same (27 RC against 51 LR), and
the form the mega-litigation imitates is literally one section in three — LR I,
RC, LR II. In *questions* a third of cases works out at about 36%, because a
passage averages 6.8 questions where an argument case is 6. That is stated
rather than tuned away; landing exactly on 34.4% wants a share of 0.316, and
buying 1.6 points of precision with a number nobody can read off the design is a
bad trade.

**Drawn per run, not rotated.** A rotation needs a counter that survives across
sessions, and up to `PRACTICE_QUEUE_MAX` runs can be queued and abandoned before
any is answered, so the only counter cheap enough to reach `create_study_session`
(`profile.total_cases`, which moves on settlement) would hand every queued run
the same shape. The cost of a draw is variance early on: a 13% chance of seeing
no reading case in the first five runs. Worth saying out loud, and still the
whole section arriving instead of none of it.

**Review splits across cases rather than inside one**, because a passage is one
unit and a case built on it cannot be half review the way an argument case is.
Half of reading cases are **review-led** — built on the passage carrying the
weakest due card, so the card comes back inside a re-read of the passage it
belongs to. The rest are **fresh-led**, on a passage with unseen questions. All
of it, one way or the other: an all-fresh rule would never return an RC card, an
all-review rule would never put a new one in.

Argument-case review is correspondingly restricted to Logical Reasoning cards. A
lone RC question between six arguments is 450 words arriving with no warning to
pay for one question — the bug the passage-mate fix removed, and not one to
reintroduce from the review side.

**A different sitting size for RC, deliberately.** A reading case is as long as
its passage: 5 to 8 questions where an argument case is 6. The passage is the
unit of work — you read it once and it pays for every question on it — so asking
it to be exactly six means either splitting it or discarding the 71% of passages
that are not six. In time the two shapes are comparable: a six-question argument
case is 15.0 budgeted minutes, the common 6–7 question passage is 16.8–18.1, and
the ceiling of 8 is 21.3.

**A sixteen-question passage** is served across consecutive cases, each still
that one passage and nothing else, cut at `reading_case_ceiling`. Unseen
questions sort first, so a second visit picks up where the first left off with
nothing stored to remember where that was. The alternative — excluding passages
longer than the ceiling — is 51 questions served to nobody, which is the same
defect as the one being fixed, forty-five times smaller and just as invisible.

**Two gates** keep the shape honest on banks that are not the shipped one.
`RC_CASE_MIN_SITTING = 6` because a passage does not fit in a three-question
drill; below it the ordinary shape is used. `reading_case_floor` requires a
passage to carry at least half the requested sitting, so a two-question passage
cannot become a "case". Neither fires on the shipped bank.

### Measured after, same instrument

`tools/audit/rc_reachability_probe.py`, 300 runs of size 6 through
`create_study_session` against the real bank:

| cohort | RC share | runs with any RC | q/run | rev/run | RC of review | s/question |
|---|---:|---:|---:|---:|---:|---:|
| cold (0 answered) | 39.0% | 108 of 300 | 6.29 | 0.00 | 0.0% | 155.3 |
| mid (60 answered) | 30.5% | 88 of 300 | 6.10 | 2.27 | 6.7% | 154.8 |
| **warmed (played in)** | **33.7%** | 92 of 300 | 6.28 | 3.46 | **39.8%** | 154.5 |

The warmed cohort is the one to read: a student whose history was produced by
this selector rather than by a synthetic draw, which is the only cohort whose
review queue has the shape real play makes. **33.7% of served questions against
a bank that is 34.4%, and 39.8% of review material, from 0.0%.**

The cold and mid rows straddle it because the shape is drawn: 300 draws at
p = 1/3 has a standard deviation of about 2.7 points.

### What it cost in time

`SERVED_SECONDS_PER_CASE` moves 152.7 → 154.5. That is the entire wall-clock
cost of nearly doubling the share of the slower section, and it is small for a
reason worth knowing: a passage served whole amortises its reading.
`_target_time_seconds` charges 330s for the first question on a passage and 135s
for each one after it, and 135s is *cheaper* than a Logical Reasoning question's
150s. So a seven-question passage averages 163s, not 330.

The simulated campaign curve does not move at all — bit-identical across all
eight modelled players, 0.00% drift — because the simulation converts cases to
hours with a fixed constant and its case counts come from prices and payouts,
neither of which the section mix touches.

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
- **`backend/app/strategies.py` and the strategy trial.** Owned by a sibling
  branch. Untouched. The bandit's rank ceiling and the control-arm collapse the
  audit found are going there, not here.
- **`select_random_questions`'s block filling.** Still the general filler, still
  unable to reach a passage at a budget of 3, and that is now correct rather
  than broken: it is what a type-filtered drill uses, and drills below six
  questions cannot hold a passage. Reading Comprehension does not come from it
  any more. `PASSAGE_OVERSHOOT_ALLOWANCE` is kept because a type-filtered drill
  on an RC question type still has passages to serve whole.
- **The mega-litigation's section blocking.** `select_diagnostic_questions`
  already built LR / intact-RC / LR blocks, which the audit called correct. The
  reading case makes practice resemble it more, not less.

---

## Files touched, and where this may conflict

```
backend/app/game.py                            the economy: sitting, goals, contracts, bonuses
backend/app/services.py                        run construction, the two case shapes, daily docket
backend/app/scheduling.py                      due_for_review takes an optional section
backend/app/__init__.py                        PRACTICE_SESSION_SIZE / PRACTICE_QUEUE_MAX defaults
backend/app/routes.py                          serves session_size on two endpoints
backend/scripts/simulate_economy_curve.py      sittings in the report, the pace caveat, database fallback
backend/scripts/measure_served_section_mix.py  new
backend/tests/test_sitting_scale.py            new
backend/tests/test_economy_simulation.py       new
backend/tests/test_reading_cases.py            new
backend/tests/{test_flow,test_progress,test_game_catalog}.py   variable run length, realistic fixture passages
backend/.env.example                           stops pinning 10
deploy/ec2/cloudformation.yaml                 stops pinning 10 (one deleted line)
frontend/src/api.ts                            session_size on two response types
frontend/src/pages/{cases,dashboard}-page.tsx  copy reads the served size
frontend/src/guided-tour.tsx                   three sentences, numbers and the reading case
tools/audit/rc_reachability_probe.py           new, sits beside the QA branch's probes
```

`tools/audit/rc_reachability_probe.py` is written to live in the QA agent's
`tools/audit/` directory and imports nothing from it, so it merges cleanly
whichever branch lands first. Reproducing the measurements in this document
needs their `interleaving_probe.py` only for the cohort comparison; the RC
tables above come from the new probe alone.

**One fixture change worth flagging to whoever merges.** `test_flow.py` and
`test_progress.py` built two-question Reading Comprehension passages. The
shipped bank has nothing shorter than four and a median of seven, so those
fixtures described a bank that cannot exist — and specifically one where no
passage is long enough to be a reading case, meaning the end-to-end suite could
never have built the shape practice now serves a third of the time. They build
passages of five and six now, and `test_flow`'s bank grew from 4 RC questions to
12. This is the same class of problem as the one the audit found in
`seed_demo.py`: an instrument that agrees with whatever it is pointed at.

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
  questions now reads `session["total_items"]`, or uses
  `services.reading_case_floor`/`reading_case_ceiling`, or pins
  `PRACTICE_RC_CASE_SHARE` to the shape it means to exercise. Plus the fixture
  passage sizes noted above.
- `backend/app/scheduling.py`, if another branch is in `due_for_review`. My
  change is one optional `section` argument and a conditional join.

## What to check by hand after merging

1. Start half a dozen runs from the Practice tab. Most should be six Logical
   Reasoning questions; roughly one in three should be a single reading passage
   and all of its questions, 5 to 8 of them, with the passage whole and its
   questions consecutive. If you get six argument runs in a row, that is a 9%
   coincidence rather than a bug — start a few more.
2. Look at a client card. The contract bar should be 3 to 9 wins, and any client
   whose blurb quotes a length should quote the same number the bar shows.
3. Finish one run. The first daily goal should complete exactly as the run ends,
   not two questions before or after. A reading case can overshoot it, since a
   reading case is as long as its passage.
4. Queue runs until it refuses. It should take 13, not 8.
5. `backend/.venv/bin/python -m pytest` from the repo root: 407 pass. Note the
   suite must run from the repo root, not from `backend/` — `pytest.ini` sets
   `pythonpath = backend` and two tests import `backend.app.game` directly.
6. To re-measure the section mix end to end, seed a scratch database and run the
   probe:

   ```
   DATABASE_URL=sqlite:////tmp/audit.db backend/.venv/bin/python -m flask db upgrade
   DATABASE_URL=sqlite:////tmp/audit.db backend/.venv/bin/python -m flask seed
   cd backend && DATABASE_URL=sqlite:////tmp/audit.db \
     .venv/bin/python ../tools/audit/rc_reachability_probe.py --runs 40 --cases 300
   ```

   The warmed cohort is the row that matters. It takes about 45 seconds.

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
