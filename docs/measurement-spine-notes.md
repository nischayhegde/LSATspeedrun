# Merge notes: the measurement spine and question types

Branch `cursor/measurement-spine-question-types-fdc0`, based on
`integration/all-features` at `82acaf6`.

Four other agents are working in adjacent areas, and three of them touch files
this branch touches. Read §2 before merging; one of the collisions is a
migration and one is a column this branch writes and another branch deletes.

---

## 1. What is on the branch

| file | what |
|---|---|
| `backend/app/experiments.py` | new. The spine: layer registry, exposure-typed assignment, realised propensity, per-student allocation health, ITT reading. |
| `backend/app/question_types.py` | new. Type inference from the stem, ordered named rules, provenance. |
| `backend/app/models.py` | `LayerAssignment` table; `questions.question_type_source`. |
| `backend/app/seed.py` | ingest calls `question_types.classify` instead of the local `_question_type`, and writes provenance. |
| `backend/app/services.py` | `create_study_session` mints the run id up front and puts weak-type targeting behind the spine. |
| `backend/migrations/versions/0037_layer_assignments.py` | new table. **Collides — see §2.1.** |
| `backend/migrations/versions/0038_question_type_source.py` | new column, backfilled as `unrecorded`, retypes nothing. |
| `backend/tests/test_experiments.py` | 14 tests. |
| `backend/tests/test_question_types.py` | 32 tests. |
| `tools/audit/adaptive_layers.py` | the census; realised allocation per student against a database. |
| `tools/audit/question_type_coverage.py` | coverage, movement, per-rule newly-matched. |
| `tools/audit/strategy_candidates.py` | what the types do to strategy matching, and how much practice an approach needs before it can be ranked. |
| `docs/learning-system.md` | the explanation, with the two Mermaid diagrams. |
| `docs/strategy-apparatus.md` | the recommendation. Nothing in it is acted on. |

`backend/tests`: 422 passing on this branch.

Not touched: `backend/app/strategies.py`, `backend/app/enforcement.py`,
`backend/app/scheduling.py`, anything in `frontend/`.

---

## 2. Collisions, in the order they will bite

### 2.1 Two migrations both numbered 0037

This branch adds `0037_layer_assignments`, revising `0036_sectioned_exam`. The
difficulty branch (`cursor/question-difficulty-elo-calibration-e522`) adds
`0037_difficulty_calibration`, revising the same parent. After a merge Alembic
will have two heads and `flask db upgrade` will refuse to run.

The chain here is `0036 → 0037_layer_assignments → 0038_question_type_source`,
so the cheapest fix is to put the difficulty revision first and hang this
branch's chain off it:

```python
# backend/migrations/versions/0037_layer_assignments.py
down_revision = "0037_difficulty_calibration"
```

Nothing else changes; the two migrations are independent and touch different
tables. The revision id keeps its name and the filename is then out of numeric
order, which is cosmetic — Alembic reads `revision`/`down_revision`, not the
filename. Rename both files if the ordering bothers you, but then update the
`down_revision` in `0038_question_type_source.py` too.

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

- **This branch** mints `session_id = new_id()` before the run is built and
  passes it to the `StudySession` constructor, then draws
  `weak_type_targeting` on `Exposure.run(session_id)`.
- **The strategy branch** (`cursor/strategy-matching-appropriateness-cf98`)
  adds `exposure=session.id` to `assign_strategy_trial`.
- **The economy branch** (`cursor/shorten-case-and-rescale-economy-508c`)
  rewrites the review ratio, section mix and jitter around it.

These compose, and none of them wants the other reverted. The one thing to
check: after merging, `session_id` and `session.id` are the same value, so the
strategy branch's `exposure=session.id` keeps working unchanged. If a resolution
drops the `id=session_id` argument from the `StudySession(...)` constructor,
the layer assignment rows will point at a run id that does not exist. There is
no foreign key on `layer_assignments.session_id` — deliberately, because the id
is minted before the row it names — so nothing will complain. `layer_reading`
will silently return zero answers. That is the one silent failure in this merge.

The check: create a run as a student with a completed mega-litigation, then

```sql
select count(*) from layer_assignments la
  join study_sessions s on s.id = la.session_id;
```

should equal the number of assignment rows, not zero.

### 2.4 Re-run the strategy probe after the strategy branch lands

`tools/audit/strategy_candidates.py` calls the real `_candidate_keys`, and that
branch rewrites it substantially. Every number in `docs/strategy-apparatus.md`
§2 comes from that probe and will move. The probe is checked in so the numbers
can be regenerated rather than argued about.

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

**One consequence worth knowing before you run it.** `skill_progress` rows are
keyed by the *name* of a question type, so a question moving from "Logical
Reasoning" to "Sufficient Assumption" leaves its old skill row behind under the
old name and starts a new one. That is correct behaviour — the old row is a
true record of answers filed against a bucket that meant "untyped" — but the
skill list will grow a tail of placeholder-named rows that stop gaining
answers. Only the history breakdown reads them, where they are honest.

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

Draw it only where the personalised and fixed shapes actually differ, and
decide that from history fixed before the run starts. That is the one rule the
weak-type layer follows and the reason its comparison is interpretable.

**`strategies.py` and the bandit.** Read closely, not edited. The exposure fix
on that branch is the model this spine generalises. Two follow-ups belong to
whoever merges it, and both are in `docs/strategy-apparatus.md`: fold the
control draw into `experiments.assign` on an `item` exposure, and delete
`experiments.contrast_sample`, which is a deliberate three-line duplicate of
`strategies._contrast_sample` that I did not want to import across a file being
rewritten.

**Anything reaching into a sibling's area.** Nothing did. The one change to
shared code is the four-line block in `create_study_session` described in §2.3.

---

## 5. What to check by hand after merging

1. **One migration head**, and `flask db upgrade` runs on a copy of a real
   database. `test_bootstrap_migrations` and `test_migration_preserves_data`
   both exercise this.
2. **`python3 tools/audit/question_type_coverage.py`** — placeholder coverage
   should read 12.5% after, 45.8% before. If the "after" number has moved, a
   merge changed the rules.
3. **`python3 tools/audit/strategy_candidates.py`** — expect the numbers to
   move once the strategy branch is in. They should move *up*: more candidates,
   not fewer.
4. **`python3 tools/audit/adaptive_layers.py`** — the census should list eight
   layers. If a sibling added an adaptive mechanism and it is not in the list,
   that is exactly the drift the registry exists to catch.
5. **Create a practice run as a student with a completed mega-litigation**, and
   check `layer_assignments` gets a row whose `session_id` joins to a real
   study session (§2.3). Then create twenty runs and confirm roughly a quarter
   drew `untargeted` — with twenty draws the honest expectation is five, so
   anything from two to eight is unremarkable and zero is a bug.
6. **A run built on the `untargeted` arm should not be steered.** The test
   `test_the_run_records_its_arm_and_the_off_arm_really_stops_the_steering`
   asserts this and fails if the arm is recorded but the run is steered anyway,
   which is the way this class of change usually breaks.
7. **The full backend suite**, from the repository root. Two tests
   (`test_flow.py::test_the_working_day_streak_counts_finished_cases_not_page_loads`
   and one in `test_territory_and_trial.py`) import `backend.app.game` and only
   pass when pytest is run from the root rather than from `backend/`. That
   predates this branch.
