# Merge notes: the measurement spine, question types, and rolling weak types

Branch `cursor/measurement-spine-question-types-fdc0`, based on
`integration/all-features` at `82acaf6`.

Four other agents are working in adjacent areas, and three of them touch files
this branch touches. Read §2 before merging; one of the collisions is a
migration chain and one is a column this branch writes and another branch
deletes. §2.5 is the one failure in this merge that would be silent.

---

## 1. What is on the branch

### New modules

| file | what |
|---|---|
| `backend/app/experiments.py` | The spine: layer registry, exposure-typed assignment, realised propensity, per-student allocation health, and a reading that knows which window and which strata a layer declared. |
| `backend/app/question_types.py` | Type inference from the stem, ordered named rules, provenance. |
| `backend/app/type_focus.py` | The rolling per-type weakness signal, and the cohort reading over it. |

### Changed

| file | what |
|---|---|
| `backend/app/models.py` | `LayerAssignment` table with a `signal` column; `questions.question_type_source`; `strategy_selection_arm` and `strategy_selection_propensity` on `session_items` and `attempts`; `attempts.predicted_retrievability`. |
| `backend/app/services.py` | `create_study_session` mints the run id up front, draws `weak_type_targeting` and `run_ordering`, and reads `type_focus.rolling_focus` where it used to read `focus.diagnostic_focus`. `practice_style` is gone from the signature. |
| `backend/app/scheduling.py` | `front_load` (the off arm for ordering), `BLOCKED_SECTIONS`, `predicted_recall`, and `review_calibration`. |
| `backend/app/strategies.py` | `strategy_selection` drawn through `experiments.draw`; the offer arm's hash no longer includes the chosen approach; `strategy_population_reading`, `strategy_selection_reading` and `strategy_selection_health`; `_contrast_sample` delegates to `experiments`. |
| `backend/app/seed.py` | Ingest calls `question_types.classify` and writes provenance. |
| `backend/app/routes.py`, `backend/scripts/seed_demo.py`, `FEATURES.md` | Follow-on from removing `practice_style`. |
| `frontend/src/types.ts`, `frontend/src/pages/dashboard-page.tsx`, `deck/src/app-art/types.ts` | The focus panel reads the rolling signal's shape instead of the sitting's. **This is the only front-end change on the branch**; see §2.6. |

### Migrations

`0037_layer_assignments` → `0038_question_type_source` →
`0039_strategy_selection_arm` → `0040_predicted_retrievability` →
`0041_layer_assignment_signal`. The first collides — see §2.1.

### Tests and probes

`backend/tests`: **467 passing**, from the repository root (§5.7).
New files: `test_experiments.py`, `test_question_types.py`, `test_type_focus.py`,
`test_strategy_selection.py`, `test_strategy_population.py`,
`test_review_calibration.py`.

Nine probes under `tools/audit/`, all report-only, all runnable with
`python3 tools/audit/<name>.py` and no arguments. Two of them
(`adaptive_layers.py --database-url`, `strategy_trial_population.py`) can be
pointed at a database and read it only.

Not touched: `backend/app/enforcement.py`, `backend/app/focus.py`.

---

## 2. Collisions, in the order they will bite

### 2.1 Two migrations both numbered 0037

This branch adds `0037_layer_assignments`, revising `0036_sectioned_exam`. The
difficulty branch (`cursor/question-difficulty-elo-calibration-e522`) adds
`0037_difficulty_calibration`, revising the same parent. After a merge Alembic
will have two heads and `flask db upgrade` will refuse to run.

The chain here is five migrations long now, so the cheapest fix is still to put
the difficulty revision first and hang this branch's chain off it:

```python
# backend/migrations/versions/0037_layer_assignments.py
down_revision = "0037_difficulty_calibration"
```

Nothing else changes; the migrations are independent and touch different
tables. The filenames are then out of numeric order, which is cosmetic —
Alembic reads `revision`/`down_revision`, not the filename.

Verify after merging:

```
cd backend && python3 -c "from alembic.script import ScriptDirectory; print(ScriptDirectory('migrations').get_heads())"
```

One head, or the merge is not finished.

### 2.2 `question.difficulty` is deleted by another branch

`seed._upsert_row` contains `question.difficulty = 3`. This branch does not
change that line, but it changes the line directly above it, so git will show
both in the same hunk. The difficulty branch **renames the column to
`published_difficulty` and empties it**, deliberately — a hardcoded 3 on all
6,886 rows is worse than a null because it poisons downstream targeting with
fake information, and I agree with them.

Take their side of the difficulty line, and this branch's side of the two lines
above it:

```python
question.question_type, question.question_type_source, _rule = classify(section, stem)
# whatever the difficulty branch does here — not this branch's business
```

### 2.3 `create_study_session` is edited by three branches

- **This branch** mints `session_id = new_id()` before the run is built, draws
  `weak_type_targeting` on `Exposure.run(session_id)` — passing the weak types
  as `signal` — and draws `run_ordering` on the same exposure.
- **The strategy branch** (`cursor/strategy-matching-appropriateness-cf98`)
  adds `exposure=session.id` to `assign_strategy_trial`. This branch has taken
  that change and depends on it.
- **The economy branch** (`cursor/shorten-case-and-rescale-economy-508c`)
  rewrites the review ratio, section mix and jitter around it.

These compose and none of them wants the other reverted. The economy branch's
work is what `run_sequencing` is registered as a seam for; wiring it is the
snippet in §4.

### 2.4 `strategies.assign_strategy_trial` is rewritten by two branches

This branch adds a nested draw inside it and removes the chosen approach from
the offer arm's hash. The strategy branch is rewriting the exploration term in
the same function.

Both changes are wanted, and they are in different halves of it: theirs is in
the `score`/`ranked` block, mine is the `experiments.draw` call underneath it
and the `control:{seed}` line below that. The one thing that must survive any
resolution is that **the offer arm's hash does not contain `key`**. If it comes
back, the offer draw and the selection draw share an input, they stop being
independent, and the argument for reading the selection layer inside the treated
population collapses. `test_strategy_selection.py` has a test that fails if it
does. The design version on `strategy_offer` moved for this reason.

### 2.5 The silent one: a run id that names no run

`layer_assignments.session_id` has **no foreign key**, deliberately, because the
id is minted before the row it names exists — that is what lets the draw precede
question selection. So if a merge resolution drops the `id=session_id` argument
from the `StudySession(...)` constructor, the assignment rows will point at a
run that does not exist, nothing will complain, and `layer_reading` will quietly
return zero answers forever.

Every reading on this branch except the calibration one joins through that
column. This is the failure to check for by hand.

```sql
select count(*) from layer_assignments la
  join study_sessions s on s.id = la.session_id;
```

should equal the number of rows in `layer_assignments`, not zero.

### 2.6 The front-end shape of `focus`

`PracticeSummary.focus` changed shape: it now carries `weak`,
`section_baselines`, `first_encounters` and `half_life_days`, with the old
sitting-derived detail nested under `focus.sitting`. Both `frontend/src/types.ts`
and `deck/src/app-art/types.ts` are updated, and the dashboard reads the new
fields. A sibling branch editing the dashboard will conflict in one place, in
the block that explains the focus list to the student.

### 2.7 Re-run the probes after the strategy branch lands

`tools/audit/strategy_candidates.py` and `tools/audit/rank_reachability.py`
call the real `_candidate_keys` and the real `assign_strategy_trial`, and that
branch rewrites both. Every number in `docs/strategy-apparatus.md` §2 and in
the §2.3 annotation of `docs/audits/interleaving-audit.md` comes from those
probes and will move. They are checked in so the numbers can be regenerated
rather than argued about.

---

## 3. Applying the new question types

The migration deliberately does not retype anything. Inference belongs at
ingest, where the stem is in hand and the rules are tested, not inside a schema
change that runs once against whatever the code said that day. To apply it:

```
flask db upgrade
flask seed --force
```

`seed_questions` upserts by id, so this rewrites `question_type` and
`question_type_source` in place and touches nothing else — attempts, review
cards and skill history all key off ids that do not move.

**Two consequences worth knowing before you run it.**

`skill_progress` rows are keyed by the *name* of a question type, so a question
moving from "Logical Reasoning" to "Sufficient Assumption" leaves its old skill
row behind under the old name and starts a new one. That is correct behaviour —
the old row is a true record of answers filed against a bucket that meant
"untyped" — but the skill list will grow a tail of placeholder-named rows that
stop gaining answers. Only the history breakdown reads them, where they are
honest.

The rolling weak-type signal reads `question_type` on every past attempt, so
retyping the bank changes what it says for existing students, once, at the
moment the reseed runs. That is the intended direction — it is the whole reason
this signal is now possible — but it means the first runs after a reseed may
target something the student's history did not previously imply. The layer's
`design_version` does not move for it, because the arms and the draw are
unchanged; if that matters for an analysis in flight, bump it.

---

## 4. What I left to siblings, on purpose

**Difficulty estimation.** Consumed, never built. `difficulty_targeting` is in
the registry as `planned` with its arms declared and a note saying it must stay
off while the signal is a constant. When the Elo work lands, wiring it is one
`experiments.assign` call and a change of `status` to `live`.

**Session construction and sequencing.** `run_sequencing` is registered as a
`seam`, with the arms and the question already written down, and nothing in
`services.py` reads it yet. When the economy branch lands, the wiring is:

```python
shape = experiments.assign("run_sequencing", user.id, exposure=Exposure.run(session_id))
# if shape.on: the personalised review ratio / section mix / jitter
# else:        the fixed half-review, one-in-three-reading default
```

Draw it only where the personalised and fixed shapes actually differ, and decide
that from history fixed before the run starts. Then decide the two fields the
registry now asks for: **which window** the effect is expected in, and **what
must never be pooled**. `docs/learning-system.md` §4.3 is the procedure and §4.4
is why those two questions are not optional — two of the layers here would have
reported a benefit as a harm if they had been read in the obvious window.

**The offer trial's own control draw.** Still its own `_stable_fraction` call
rather than `experiments.draw`. Folding it in is the last step of the merge
described in `docs/strategy-apparatus.md` §5, and it was left alone here
because this branch already changed that hash once (§2.4) and doing both at
once would make neither reviewable.

**Reading Comprehension's reachability.** The largest open finding in
`docs/audits/interleaving-audit.md`, re-measured on this branch and not fixed by
it. `python3 tools/audit/section_reach.py`.

---

## 5. What to check by hand after merging

1. **One migration head**, and `flask db upgrade` runs on a copy of a real
   database. `test_bootstrap_migrations` and `test_migration_preserves_data`
   both exercise this.
2. **`python3 tools/audit/question_type_coverage.py`** — placeholder coverage
   should read 12.5% after, 45.8% before. If the "after" number has moved, a
   merge changed the rules.
3. **`python3 tools/audit/adaptive_layers.py`** — the census should list eight
   layers, of which five are `live`, one `calibrated`, one `seam` and one
   `planned`. **No layer should be `unmeasured`**; `test_experiments.py` asserts
   it, and a sibling adding an adaptive mechanism without registering it is
   exactly the drift the registry exists to catch.
4. **The session_id join in §2.5.** This is the silent one.
5. **Create twenty runs** as a student with some history and confirm roughly a
   quarter drew `untargeted` and a quarter `front_loaded`. With twenty draws the
   honest expectation is five, so anything from two to eight is unremarkable and
   zero is a bug.
6. **A run built on the `untargeted` arm should not be steered**, and one on
   `front_loaded` should really front-load. `test_the_run_records_its_arm_and_the_off_arm_really_stops_the_steering`
   and `test_the_front_loaded_arm_really_front_loads` assert both, and fail if
   the arm is recorded while the run is built the other way — which is how this
   class of change usually breaks.
7. **The full backend suite, from the repository root.** Two tests
   (`test_flow.py::test_the_working_day_streak_counts_finished_cases_not_page_loads`
   and one in `test_territory_and_trial.py`) import `backend.app.game` and only
   pass when pytest is run from the root rather than from `backend/`. That
   predates this branch.
8. **The frontend builds**, because of §2.6. Nothing else on the branch touches
   it.
