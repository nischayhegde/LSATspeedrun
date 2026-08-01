# Single "Do Cases" Practice Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four practice styles (`speedrun`, `deep`, `infinite`, `review`) with one mode called `cases` in which every question requires a graded explanation, carries a strategy trial, and settles into the game economy.

**Architecture:** `deep` is renamed to `cases` and the other three styles are deleted, so every per-style lookup table collapses to a constant. Spaced review stops being a mode a student picks and becomes a seeding rule inside question selection, which moves the enqueue-versus-advance decision from the session onto a new `SessionItem.from_review_queue` flag. Removing the `deep`-only pay gate means the economy now touches every measured practice attempt, so the dashboard headline narrows to the diagnostic — the one surface the economy cannot reach.

**Tech Stack:** Flask + SQLAlchemy + Alembic (batch migrations, SQLite in tests / PostgreSQL in production), pytest, React 19 + TypeScript + Vite + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-01-single-do-cases-practice-mode-design.md`

## Global Constraints

- The only practice style is `"cases"`. The diagnostic keeps `mode = "diagnostic"` and `practice_style = "diagnostic"` and is otherwise untouched: no explanation, no coaching, no strategy trial, no cash.
- The explanation floor is **120 characters** for every practice question and **0** for diagnostic questions.
- Practice sessions are always `feedback_policy = "immediate"`. Diagnostic sessions stay `"delayed"`.
- Repairs are capped at **half the run** (`session_size // 2`) and occupy the **first** positions.
- A `question_type`-filtered run seeds **no** repairs.
- Historical `attempts.evidence_class` values are **never** rewritten.
- Run all backend tests from the repo root: `python -m pytest` (config in `pytest.ini`, `testpaths = backend/tests`).
- Run frontend checks from `frontend/`: `npm run typecheck` and `npm run lint`.
- Commit after every task. Do not skip hooks.

**Deviation from the spec, deliberate:** the spec names the docket field `cases.repairs_included`; this plan uses `cases.repairs_due` because the value is an integer count of due repairs, not a boolean. Everything else follows the spec exactly.

**Known pre-existing issue, out of scope:** `backend/scripts/migrate_sqlite_to_postgres.py:11` pins `REQUIRED_TARGET_REVISION = "0014_story_campaign"` and has not been bumped for migrations 0015–0020. Do not bump it here; it is unrelated to this change and fixing it silently would alter that script's behavior.

---

### Task 1: Add the review-origin flag and the migration

Nothing changes behaviorally. This lands the column and the data conversion so later tasks have somewhere to write.

**Files:**
- Modify: `backend/app/models.py:133`
- Create: `backend/migrations/versions/0021_single_practice_mode.py`
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `SessionItem.from_review_queue` — `bool`, `NOT NULL`, defaults `False`. Task 3 sets it; Task 3 and Task 6 read it.

- [ ] **Step 1: Write the failing test**

Add at the end of `backend/tests/test_flow.py`:

```python
def test_session_items_record_review_queue_origin(app):
    with app.app_context():
        columns = {column.name for column in SessionItem.__table__.columns}
        assert "from_review_queue" in columns
        assert SessionItem.__table__.c.from_review_queue.nullable is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_flow.py::test_session_items_record_review_queue_origin -v`
Expected: FAIL with `AssertionError` — `"from_review_queue" not in columns`.

- [ ] **Step 3: Add the column to the model**

In `backend/app/models.py`, inside `class SessionItem`, immediately after the `requires_reasoning` line (`:133`):

```python
    requires_reasoning = db.Column(db.Boolean, nullable=False, default=False)
    from_review_queue = db.Column(db.Boolean, nullable=False, default=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_flow.py::test_session_items_record_review_queue_origin -v`
Expected: PASS.

- [ ] **Step 5: Write the migration**

Create `backend/migrations/versions/0021_single_practice_mode.py`:

```python
"""Collapse the four practice styles into a single "cases" mode.

Revision ID: 0021_single_practice_mode
Revises: 0020_profile_scoped_ledger
"""

from alembic import op
import sqlalchemy as sa


revision = "0021_single_practice_mode"
down_revision = "0020_profile_scoped_ledger"
branch_labels = None
depends_on = None


session_items = sa.table(
    "session_items",
    sa.column("session_id", sa.String),
    sa.column("from_review_queue", sa.Boolean),
)
study_sessions = sa.table(
    "study_sessions",
    sa.column("id", sa.String),
    sa.column("mode", sa.String),
    sa.column("practice_style", sa.String),
    sa.column("feedback_policy", sa.String),
)


def upgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(
            sa.Column("from_review_queue", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    # Items served by an old review run are exactly the repairs of the new
    # single mode, so review-recovery history survives the collapse.
    op.execute(
        session_items.update()
        .where(
            session_items.c.session_id.in_(
                sa.select(study_sessions.c.id).where(study_sessions.c.practice_style == "review")
            )
        )
        .values(from_review_queue=True)
    )
    # In-flight runs convert in place. A paused Sprint resumes as a cases run
    # with immediate feedback; force-completing it would destroy queued work to
    # fix a cosmetic inconsistency the student can already discard themselves.
    op.execute(
        study_sessions.update()
        .where(study_sessions.c.mode == "practice")
        .values(practice_style="cases", feedback_policy="immediate")
    )


def downgrade():
    """The original style of a converted session is not recoverable.

    Every practice session becomes 'deep' on the way back, which is the style
    whose behavior 'cases' inherited.
    """
    op.execute(
        study_sessions.update()
        .where(study_sessions.c.mode == "practice")
        .values(practice_style="deep")
    )
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("from_review_queue")
```

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest`
Expected: PASS — no existing test asserts on the new column.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/0021_single_practice_mode.py backend/tests/test_flow.py
git commit -m "Record whether a session item came from the review queue"
```

---

### Task 2: Collapse the four practice styles into one

This is the atomic core of the change and the largest task. The four styles cannot be removed one at a time — every lookup table, the infinite-run machinery, the route payload, and the daily docket all key on the style, so a partial removal leaves the suite red. Work through the steps in order.

**Files:**
- Modify: `backend/app/services.py:19-42` (constants), `:433-508` (`create_study_session`), `:611-637` (`finish_infinite_session`), `:682-767` (`daily_docket_snapshot`), `:840-860` (`_append_infinite_item`), `:1072-1073` (infinite branch in `submit_attempt`)
- Modify: `backend/app/routes.py:47` (import), `:509-555` (`start_practice_session`), `:668-680` (finish route)
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `PRACTICE_STYLES = {"cases"}`, `EVIDENCE_CLASS = {"cases": "coached_practice", "diagnostic": "diagnostic"}`, `REASONING_MIN_CHARS = 120` (an `int`, no longer a dict).
  - `create_study_session(user, *, count=None, question_type=None, practice_style="cases") -> StudySession` — the `feedback_policy` parameter is gone.
  - `daily_docket_snapshot(user, timezone_name="UTC") -> dict` with top-level keys `date`, `timezone`, `active_session`, `cases`, `deep_brief`, `next_action`. The `review` and `speedrun` keys are gone. `next_action["kind"]` is one of `resume`, `start_cases`, `open_brief`, `done`.

- [ ] **Step 1: Write the failing tests**

Replace the parametrized `test_every_practice_style_requires_an_explanation` at `backend/tests/test_flow.py:2300-2312` with:

```python
def test_cases_is_the_only_practice_style(app):
    from app.services import PRACTICE_STYLES, REASONING_MIN_CHARS

    assert PRACTICE_STYLES == {"cases"}
    assert REASONING_MIN_CHARS == 120


def test_every_case_requires_a_full_explanation(app):
    client = app.test_client()
    headers = login(client, "requires-cases@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    assert session["practice_style"] == "cases"
    assert session["feedback_policy"] == "immediate"
    assert session["current_item"]["requires_reasoning"] is True
    assert session["current_item"]["reasoning_min_chars"] == 120


def test_requested_practice_style_is_ignored(app):
    client = app.test_client()
    headers = login(client, "ignored-style@example.test")
    create_game(client, headers)
    response = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "speedrun", "feedback_policy": "delayed"},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json["session"]["practice_style"] == "cases"
    assert response.json["session"]["feedback_policy"] == "immediate"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest backend/tests/test_flow.py::test_cases_is_the_only_practice_style backend/tests/test_flow.py::test_every_case_requires_a_full_explanation backend/tests/test_flow.py::test_requested_practice_style_is_ignored -v`
Expected: FAIL — `PRACTICE_STYLES` still has four members, and the session comes back as `speedrun`.

- [ ] **Step 3: Collapse the constants**

Replace `backend/app/services.py:19-42` with:

```python
PRACTICE_STYLES = {"cases"}
FEEDBACK_POLICIES = {"immediate", "delayed"}
EVIDENCE_CLASS = {
    "cases": "coached_practice",
    "diagnostic": "diagnostic",
}
REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)
REASONING_MIN_CHARS = 120


def reasoning_min_chars(session: StudySession) -> int:
    """Characters of written explanation a session demands before an answer counts."""
    if session.mode == "diagnostic":
        return 0
    return REASONING_MIN_CHARS
```

`STYLE_FEEDBACK_POLICY` is deleted entirely.

- [ ] **Step 4: Simplify `create_study_session`**

In `backend/app/services.py`, change the signature at `:433-440` to drop `feedback_policy`:

```python
def create_study_session(
    user: User,
    *,
    count: int | None = None,
    question_type: str | None = None,
    practice_style: str = "cases",
) -> StudySession:
```

Replace the validation and question-selection block at `:451-469` with:

```python
    if practice_style not in PRACTICE_STYLES:
        raise ValueError("invalid_practice_style")
    policy = "immediate"

    session_size = count if count is not None else int(current_app.config["PRACTICE_SESSION_SIZE"])
    questions = select_random_questions(session_size, question_type, user_id=user.id)
    if not questions:
        raise RuntimeError("No Hugging Face LSAT questions are available")
```

Leave the rest of the function alone — Task 3 rewrites the selection block again to fold in repairs.

- [ ] **Step 5: Delete the infinite-run machinery**

In `backend/app/services.py`, delete `finish_infinite_session` (`:611-637`) and `_append_infinite_item` (`:840-860`) in full.

In `submit_attempt`, replace `:1072-1078`:

```python
    if session.practice_style == "infinite" and session.current_index >= session.total_items:
        _append_infinite_item(session, user)
    elif session.current_index >= session.total_items:
```

with:

```python
    if session.current_index >= session.total_items:
```

Leave `:1071` (`session.pending_attempt_id = attempt.id if session.feedback_policy == "immediate" else None`) exactly as it is — the diagnostic is still a delayed-feedback session and needs that branch.

- [ ] **Step 6: Delete the finish route**

In `backend/app/routes.py`, remove `finish_infinite_session` from the import block at `:47`, and delete the whole `@api.post("/study-sessions/<session_id>/finish")` handler at `:668-680`.

- [ ] **Step 7: Simplify the start-practice route**

In `backend/app/routes.py`, replace `:520-537` with:

```python
    payload = request.get_json(silent=True) or {}
    try:
        requested_size = int(payload.get("size", current_app.config["PRACTICE_SESSION_SIZE"]))
    except (TypeError, ValueError):
        return error("invalid_session_size", "Choose a run between 1 and 50 questions.")
    if requested_size < 1 or requested_size > 50:
        return error("invalid_session_size", "Choose a run between 1 and 50 questions.")
    question_type = str(payload.get("question_type") or "").strip()[:100] or None
    try:
        session = create_study_session(
            g.current_user,
            count=requested_size,
            question_type=question_type,
        )
```

A `practice_style` or `feedback_policy` in the payload is now simply ignored rather than rejected — an old client keeps working.

Replace the `messages` dict at `:547-551` with:

```python
        messages = {
            "onboarding_required": "Create your lawyer before starting cases.",
        }
```

- [ ] **Step 8: Reshape the daily docket**

In `backend/app/services.py`, replace the body of `daily_docket_snapshot` from `:703` (`completed_review = ...`) through the closing `}` of the return at `:767` with:

```python
    completed_cases = next(
        (item for item in completed_today if item.mode == "practice" and item.total_items >= 5),
        None,
    )
    active = find_resumable_session(user)
    queue = review_queue_snapshot(user)

    cases_state = "active" if active else "complete" if completed_cases else "ready"
    priority_count = 0
    if completed_cases:
        priority_count = sum(bool(item["priority_reason"]) for item in session_review(completed_cases)["items"])
    brief_state = (
        "complete" if completed_cases and completed_cases.summary_seen_at
        else "ready" if completed_cases
        else "locked"
    )

    if active:
        next_action = {"kind": "resume", "session_id": active.id, "label": "Resume active run"}
    elif brief_state == "ready":
        next_action = {"kind": "open_brief", "session_id": completed_cases.id, "label": "Open Deep Brief"}
    elif cases_state == "ready":
        next_action = {"kind": "start_cases", "label": "Start 10 cases"}
    else:
        next_action = {"kind": "done", "label": "Daily docket complete"}

    return {
        "date": local_date.isoformat(),
        "timezone": timezone_name,
        "active_session": serialize_session(active, False) if active else None,
        "cases": {
            "state": cases_state,
            "target": 10,
            "repairs_due": queue["due"],
            "session_id": (active.id if active else completed_cases.id if completed_cases else None),
            "summary": completed_cases.summary_json if completed_cases else None,
        },
        "deep_brief": {
            "state": brief_state,
            "session_id": completed_cases.id if completed_cases else None,
            "priority_count": priority_count,
        },
        "next_action": next_action,
    }
```

- [ ] **Step 9: Run the new tests**

Run: `python -m pytest backend/tests/test_flow.py::test_cases_is_the_only_practice_style backend/tests/test_flow.py::test_every_case_requires_a_full_explanation backend/tests/test_flow.py::test_requested_practice_style_is_ignored -v`
Expected: PASS.

- [ ] **Step 10: Run the full suite and list the failures**

Run: `python -m pytest -x -q`
Expected: FAIL. Every test that names a deleted style breaks. The known set:

| Test | Line | Why it breaks |
| --- | --- | --- |
| `test_speedrun_size_and_focus_are_bounded` | 596 | passes `practice_style` |
| `test_answer_only_speedrun_redacts_feedback_stays_neutral_and_seeds_review` | 617 | asserts delayed feedback and `timed_unseen` |
| `test_daily_docket_drives_speedrun_into_priority_deep_brief` | 693 | asserts `docket["speedrun"]` |
| `test_infinite_and_review_are_immediate_neutral_and_timezone_safe` | 751 | uses three deleted styles and `/finish` |
| `test_learning_mode_feedback_policies_are_server_bound` | 861 | parametrized over deleted styles |
| `test_completed_speedrun_stops_at_training_lab_boundary` | 878 | passes `practice_style` |
| `test_strategy_trials_are_sparse_and_never_contaminate_measurement_modes` | 1941 | asserts the sparse cadence |
| `test_missing_explanation_is_rejected` | 2324 | passes `practice_style` |
| `test_short_explanation_is_rejected_with_its_own_code` | 2342 | passes `practice_style` |
| `test_deep_practice_enforces_the_longer_floor` | 2360 | asserts the 40-character floor exists |

- [ ] **Step 11: Fix the mechanical failures**

For `test_speedrun_size_and_focus_are_bounded` (596), `test_completed_speedrun_stops_at_training_lab_boundary` (878), `test_missing_explanation_is_rejected` (2324), and `test_short_explanation_is_rejected_with_its_own_code` (2342): delete the `"practice_style"` and `"feedback_policy"` keys from each `json={...}` payload. Rename `test_speedrun_size_and_focus_are_bounded` to `test_run_size_and_focus_are_bounded` and `test_completed_speedrun_stops_at_training_lab_boundary` to `test_completed_run_stops_at_training_lab_boundary`.

Delete `test_deep_practice_enforces_the_longer_floor` (2360-2381) — `test_short_explanation_is_rejected_with_its_own_code` now covers the only floor there is.

Delete `test_learning_mode_feedback_policies_are_server_bound` (853-876) together with its `@pytest.mark.parametrize` decorator — there is no style/policy pairing left to bind.

- [ ] **Step 12: Rewrite the speedrun feedback test**

Replace `test_answer_only_speedrun_redacts_feedback_stays_neutral_and_seeds_review` (617-691) with a version that asserts the new contract. Keep the review-seeding coverage; drop the redaction coverage, which no longer exists.

```python
def test_a_case_run_releases_feedback_immediately_and_seeds_review(app):
    client = app.test_client()
    headers = login(client, "immediate-cases@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 2}, headers=headers).json["session"]
    assert session["feedback_policy"] == "immediate"

    first = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "A",
            "confidence": 4,
            "reasoning": explanation("the first case"),
        },
        headers={**headers, "Idempotency-Key": "cases-immediate-one"},
    ).json["result"]
    assert first["feedback_released"] is True
    assert first["is_correct"] is False

    with app.app_context():
        attempt = db.session.get(Attempt, first["attempt_id"])
        assert attempt.evidence_class == "coached_practice"
        # A high-confidence miss is the most urgent entry reason in the ladder.
        queued = ReviewQueueItem.query.filter_by(user_id=attempt.user_id).one()
        assert queued.reason_code == "high_confidence_error"
```

- [ ] **Step 13: Rewrite the docket test**

Replace `test_daily_docket_drives_speedrun_into_priority_deep_brief` (693-749) with:

```python
def test_daily_docket_drives_cases_into_priority_deep_brief(app):
    client = app.test_client()
    headers = login(client, "docket-cases@example.test")
    create_game(client, headers)

    docket = client.get("/v1/daily-docket", headers=headers).json["daily_docket"]
    assert docket["cases"]["state"] == "ready"
    assert docket["deep_brief"]["state"] == "locked"
    assert docket["next_action"]["kind"] == "start_cases"

    session = client.post("/v1/study-sessions", json={"size": 5}, headers=headers).json["session"]
    for index in range(5):
        current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
        item = current["pending_item"] or current["current_item"]
        client.post(
            f"/v1/study-sessions/{session['id']}/attempts",
            json={
                "item_id": item["id"],
                "selected_label": "C",
                "confidence": 3,
                "reasoning": explanation(f"docket case {index}"),
            },
            headers={**headers, "Idempotency-Key": f"docket-case-{index}"},
        )
        client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)

    briefing = client.get("/v1/daily-docket", headers=headers).json["daily_docket"]
    assert briefing["cases"]["state"] == "complete"
    assert briefing["deep_brief"]["state"] == "ready"
    assert briefing["next_action"]["kind"] == "open_brief"
```

- [ ] **Step 14: Rewrite the infinite/review test**

Replace `test_infinite_and_review_are_immediate_neutral_and_timezone_safe` (751-851) with a timezone-only test. Its infinite-run and review-mode coverage is replaced by Task 3's tests.

```python
def test_daily_docket_respects_the_requested_timezone(app):
    client = app.test_client()
    headers = login(client, "docket-timezone@example.test")
    create_game(client, headers)
    utc = client.get("/v1/daily-docket", headers=headers).json["daily_docket"]
    kiritimati = client.get("/v1/daily-docket?timezone=Pacific/Kiritimati", headers=headers).json["daily_docket"]
    invalid = client.get("/v1/daily-docket?timezone=Not/AZone", headers=headers).json["daily_docket"]

    assert utc["timezone"] == "UTC"
    assert kiritimati["timezone"] == "Pacific/Kiritimati"
    assert invalid["timezone"] == "UTC"
```

- [ ] **Step 15: Neutralize the strategy cadence test**

`test_strategy_trials_are_sparse_and_never_contaminate_measurement_modes` (1941-1964) is fully rewritten in Task 4. For now, delete it so the suite is green; Task 4 adds its replacement.

- [ ] **Step 16: Run the full suite**

Run: `python -m pytest`
Expected: PASS.

- [ ] **Step 17: Commit**

```bash
git add backend/app/services.py backend/app/routes.py backend/tests/test_flow.py
git commit -m "Collapse the four practice styles into a single cases mode"
```

---

### Task 3: Fold spaced review into question selection

**Files:**
- Modify: `backend/app/services.py:327-341` (`select_random_questions`), `:451-506` (`create_study_session`), `:919-969` (`_schedule_review`)
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: `SessionItem.from_review_queue` from Task 1.
- Produces: `select_random_questions(count, question_type=None, *, user_id=None, exclude_ids=None) -> list[Question]` — `exclude_ids` is an optional `set[str]` of question IDs to keep out of both the unseen pool and the seen fallback.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_flow.py`:

```python
def _queue_due_question(user_id: str, question_id: str) -> None:
    """Put one question in the review queue, due now."""
    db.session.add(
        ReviewQueueItem(
            user_id=user_id,
            question_id=question_id,
            status="due",
            reason_code="incorrect",
            interval_index=0,
            due_at=utcnow() - timedelta(days=1),
        )
    )
    db.session.commit()


def test_due_repairs_are_seeded_first_and_capped_at_half_a_run(app):
    client = app.test_client()
    headers = login(client, "folded-repairs@example.test")
    create_game(client, headers)
    with app.app_context():
        user = User.query.filter_by(email="folded-repairs@example.test").one()
        for question in Question.query.order_by(Question.id).limit(5).all():
            _queue_due_question(user.id, question.id)

    session = client.post("/v1/study-sessions", json={"size": 6}, headers=headers).json["session"]
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert [item.from_review_queue for item in items] == [True, True, True, False, False, False]


def test_an_empty_review_queue_still_produces_a_full_run(app):
    client = app.test_client()
    headers = login(client, "no-repairs@example.test")
    create_game(client, headers)
    response = client.post("/v1/study-sessions", json={"size": 4}, headers=headers)
    assert response.status_code == 201
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=response.json["session"]["id"]).all()
        assert len(items) == 4
        assert not any(item.from_review_queue for item in items)


def test_a_focused_run_seeds_no_repairs(app):
    client = app.test_client()
    headers = login(client, "focused-no-repairs@example.test")
    create_game(client, headers)
    with app.app_context():
        user = User.query.filter_by(email="focused-no-repairs@example.test").one()
        for question in Question.query.order_by(Question.id).limit(4).all():
            _queue_due_question(user.id, question.id)

    session = client.post(
        "/v1/study-sessions",
        json={"size": 4, "question_type": "Inference"},
        headers=headers,
    ).json["session"]
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).all()
        assert not any(item.from_review_queue for item in items)


def test_question_selection_never_returns_an_excluded_question(app):
    """The seen-question fallback must respect exclude_ids too.

    select_random_questions widens its pool to already-seen questions once the
    unseen pool is smaller than the requested count. Without filtering the
    exclusions out of `eligible` rather than only out of `unseen`, that widening
    can hand back a question already seeded as a repair, putting it twice in one
    run. Asking for the whole bank is the cheapest way to force the widening.
    """
    from app.services import select_random_questions

    with app.app_context():
        every_id = [question.id for question in Question.query.order_by(Question.id).all()]
        blocked = set(every_id[:3])
        picked = select_random_questions(len(every_id), exclude_ids=blocked)
        assert blocked.isdisjoint({question.id for question in picked})
        assert len(picked) == len(every_id) - len(blocked)


def test_one_run_can_both_advance_a_repair_and_enqueue_a_fresh_miss(app):
    client = app.test_client()
    headers = login(client, "mixed-run@example.test")
    create_game(client, headers)
    with app.app_context():
        user = User.query.filter_by(email="mixed-run@example.test").one()
        repaired = Question.query.order_by(Question.id).first()
        _queue_due_question(user.id, repaired.id)
        repaired_id = repaired.id

    session = client.post("/v1/study-sessions", json={"size": 2}, headers=headers).json["session"]
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert items[0].question_id == repaired_id
        assert items[0].from_review_queue is True
        assert items[1].from_review_queue is False

    # Position 0 is the repair: answer it correctly with a graded-Good explanation.
    first = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "confidence": 4,
            "reasoning": explanation("the repaired question"),
        },
        headers={**headers, "Idempotency-Key": "mixed-repair"},
    ).json["result"]
    client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    with app.app_context():
        _graded_attempt(first["attempt_id"], 0.65)
        card = ReviewQueueItem.query.filter_by(question_id=repaired_id).one()
        assert card.interval_index == 1

    # Position 1 is fresh: a high-confidence miss must enter the queue.
    current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
    second = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": current["current_item"]["id"],
            "selected_label": "A",
            "confidence": 5,
            "reasoning": explanation("the fresh question"),
        },
        headers={**headers, "Idempotency-Key": "mixed-fresh"},
    ).json["result"]
    with app.app_context():
        attempt = db.session.get(Attempt, second["attempt_id"])
        fresh_card = ReviewQueueItem.query.filter_by(
            question_id=attempt.session_item.question_id
        ).one()
        assert fresh_card.reason_code == "high_confidence_error"
        assert fresh_card.interval_index == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest backend/tests/test_flow.py -k "repairs or excluded_question or mixed_run" -v`
Expected: FAIL — nothing sets `from_review_queue`, so every list comes back all-`False`, and `select_random_questions` does not accept `exclude_ids`.

- [ ] **Step 3: Add `exclude_ids` to question selection**

Replace `backend/app/services.py:327-341` with:

```python
def select_random_questions(
    count: int,
    question_type: str | None = None,
    *,
    user_id: str | None = None,
    exclude_ids: set[str] | None = None,
) -> list[Question]:
    query = Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%"))
    if question_type:
        query = query.filter(Question.question_type == question_type)
    blocked = exclude_ids or set()
    eligible = [question for question in query.all() if question.id not in blocked]
    if not eligible:
        return []
    unseen = [question for question in eligible if not user_id or question.id not in _seen_question_ids(user_id)]
    pool = unseen if len(unseen) >= count else unseen + [question for question in eligible if question not in unseen]
    return random.sample(pool, k=min(count, len(pool)))
```

Filtering `blocked` out of `eligible` — not just out of `unseen` — is what keeps the seen fallback from re-serving a question already seeded as a repair.

- [ ] **Step 4: Seed repairs in `create_study_session`**

Replace the selection block written in Task 2 Step 4 with:

```python
    session_size = count if count is not None else int(current_app.config["PRACTICE_SESSION_SIZE"])
    # A type-filtered run is a focused drill; mixing off-type repairs into it
    # would defeat the filter the student explicitly asked for.
    repairs = [] if question_type else _questions_due_for_review(user.id, session_size // 2)
    fresh = select_random_questions(
        session_size - len(repairs),
        question_type,
        user_id=user.id,
        exclude_ids={question.id for question in repairs},
    )
    questions = repairs + fresh
    if not questions:
        raise RuntimeError("No Hugging Face LSAT questions are available")
    repair_ids = {question.id for question in repairs}
```

Then, in the item loop at `:489-506`, add the flag to the `SessionItem(...)` construction:

```python
                requires_reasoning=True,
                from_review_queue=question.id in repair_ids,
```

- [ ] **Step 5: Schedule review per item, not per session**

In `backend/app/services.py`, inside `_schedule_review`, replace `:935`:

```python
    if session.practice_style == "review":
```

with:

```python
    if attempt.session_item.from_review_queue:
```

The `session = attempt.session_item.session` binding at `:927` is now unused inside this function — delete that line too.

- [ ] **Step 6: Run the new tests**

Run: `python -m pytest backend/tests/test_flow.py -k "repairs or excluded_question or mixed_run" -v`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services.py backend/tests/test_flow.py
git commit -m "Fold due repairs into every run and schedule review per item"
```

---

### Task 4: Run a strategy trial on every question

**Files:**
- Modify: `backend/app/strategies.py:303-312`, `:520-523`
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `assign_strategy_trial(user_id, question, practice_style, position) -> dict | None` — returns `None` only for `practice_style == "diagnostic"`; otherwise always returns `{"key": str, "variant": "prompt" | "control"}`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_flow.py` (this replaces the test deleted in Task 2 Step 15):

```python
def test_every_case_carries_a_strategy_trial(app):
    client = app.test_client()
    headers = login(client, "strategy-cadence@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 7}, headers=headers).json["session"]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        # Every position, not just position % 4 == 2.
        assert [item.position for item in items if item.strategy_key] == [0, 1, 2, 3, 4, 5, 6]
        assert all(item.strategy_variant in {"prompt", "control"} for item in items)


def test_the_diagnostic_still_has_no_strategy_trial(app):
    client = app.test_client()
    headers = login(client, "diagnostic-no-trial@example.test")
    create_game(client, headers)
    session = client.post("/v1/diagnostics", json={}, headers=headers).json["session"]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).all()
        assert all(item.strategy_key is None for item in items)

        from app.strategies import assign_strategy_trial

        user = User.query.filter_by(email="diagnostic-no-trial@example.test").one()
        question = Question.query.order_by(Question.id).first()
        assert assign_strategy_trial(user.id, question, "diagnostic", 2) is None
        assert assign_strategy_trial(user.id, question, "cases", 1) is not None


def test_strategy_assignment_stays_deterministic_across_identical_runs(app):
    client = app.test_client()
    headers = login(client, "strategy-stable@example.test")
    create_game(client, headers)

    with app.app_context():
        from app.strategies import assign_strategy_trial

        user = User.query.filter_by(email="strategy-stable@example.test").one()
        question = Question.query.order_by(Question.id).first()
        first = [assign_strategy_trial(user.id, question, "cases", position) for position in range(6)]
        second = [assign_strategy_trial(user.id, question, "cases", position) for position in range(6)]
        assert first == second
        # The hidden control arm still exists alongside prompts.
        assert {trial["variant"] for trial in first} <= {"prompt", "control"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest backend/tests/test_flow.py -k "strategy_trial or strategy_cadence or every_case_carries or strategy_stable or diagnostic_still" -v`
Expected: FAIL — only positions `2` and `6` carry a `strategy_key`.

- [ ] **Step 3: Remove both gates**

In `backend/app/strategies.py`, replace `:311`:

```python
    if practice_style not in {"deep", "infinite"} or position % 4 != 2:
        return None
```

with:

```python
    if practice_style == "diagnostic":
        return None
```

Update the docstring at `:304-310` to match:

```python
    """Assign a balanced within-student strategy trial on every question.

    The diagnostic stays a clean measurement surface and gets no trial. Early
    trials force coverage across the candidate approaches; later trials favor
    the best posterior performer while preserving a challenger and an invisible
    25% control condition.
    """
```

- [ ] **Step 4: Update the strategy-lab empty state**

In `backend/app/strategies.py:520-523`, replace the `empty_state` body:

```python
        "empty_state": {
            "title": "Nothing to compare yet.",
            "body": "Answer a few cases. Every question arrives with a suggested approach.",
        },
```

- [ ] **Step 5: Run the new tests**

Run: `python -m pytest backend/tests/test_flow.py -k "every_case_carries or strategy_stable or diagnostic_still" -v`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest`
Expected: PASS. Note that `test_strategy_dashboard_waits_for_supported_evidence_and_excludes_skips` (2076) constructs its attempts directly rather than through session creation, so the cadence change does not affect it.

- [ ] **Step 7: Commit**

```bash
git add backend/app/strategies.py backend/tests/test_flow.py
git commit -m "Run a strategy trial on every case instead of every fourth"
```

---

### Task 5: Pay for every case

**Files:**
- Modify: `backend/app/services.py:204-218` (`_freeze_current_case`)
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: nothing.
- Produces: no signature change. `_freeze_current_case(item, user) -> bool` now returns `True` for any unfinished current item in a practice session.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_flow.py`:

```python
def test_every_case_attaches_game_context_and_the_diagnostic_never_does(app):
    client = app.test_client()
    headers = login(client, "every-case-pays@example.test")
    create_game(client, headers)

    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    with app.app_context():
        item = SessionItem.query.filter_by(session_id=session["id"]).one()
        assert item.game_context_json is not None

    diagnostic = client.post("/v1/diagnostics", json={}, headers=headers).json["session"]
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=diagnostic["id"]).all()
        assert all(item.game_context_json is None for item in items)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest backend/tests/test_flow.py::test_every_case_attaches_game_context_and_the_diagnostic_never_does -v`
Expected: FAIL — `item.game_context_json is None` for the practice item, because the gate still demands `practice_style == "deep"`.

- [ ] **Step 3: Remove the deep-only gate**

In `backend/app/services.py`, replace `_freeze_current_case` (`:204-218`) with:

```python
def _freeze_current_case(item: SessionItem, user: User) -> bool:
    """Adopt only the visible unfinished case into the tycoon economy."""
    if (
        item.session.mode == "diagnostic"
        or item.game_context_json is not None
        or not user.game_profile
        or not _is_unfinished_current_item(item)
    ):
        return False
    # Migration 0012 gave old rows the LR default. Recompute RC timing when an
    # unfinished legacy item first enters the tycoon flow.
    item.target_time_seconds = _target_time_seconds(item)
    item.game_context_json = snapshot_case_context(user.game_profile)
    return True
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest backend/tests/test_flow.py::test_every_case_attaches_game_context_and_the_diagnostic_never_does -v`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest`
Expected: PASS. `test_finished_legacy_attempt_is_not_adopted_or_paid_retroactively` (1422) and `test_unfinished_legacy_rc_item_is_adopted_with_correct_target` (1455) both exercise the `_is_unfinished_current_item` and `game_context_json is not None` guards, which are unchanged.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services.py backend/tests/test_flow.py
git commit -m "Settle every practice case into the economy, not only Method Lab"
```

---

### Task 6: Narrow the dashboard headline to the diagnostic

**Files:**
- Modify: `backend/app/services.py:1345-1353` (`performance_snapshot`)
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: `SessionItem.from_review_queue` from Task 1, and the `_queue_due_question` test helper added to `backend/tests/test_flow.py` in Task 3 Step 1. If Task 3 has not landed, add that helper first — it is reproduced in Task 3's step.
- Produces: `performance_snapshot(user)` gains a top-level `coached_practice` key holding the same shape `summarize()` returns for `test_performance`: `{"attempts": int, "accuracy": int, "average_seconds": int, "pace_adherence": int, "reasoning": int | None}`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_flow.py`:

```python
def test_headline_counts_diagnostic_only_and_cases_get_their_own_panel(app):
    client = app.test_client()
    headers = login(client, "headline-split@example.test")
    create_game(client, headers)

    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "confidence": 3,
            "reasoning": explanation("the headline case"),
        },
        headers={**headers, "Idempotency-Key": "headline-case"},
    )

    performance = client.get("/v1/performance", headers=headers).json["performance"]
    # A cases attempt is coached practice; it must not reach the headline.
    assert performance["test_performance"]["attempts"] == 0
    assert performance["coached_practice"]["attempts"] == 1
    assert performance["coached_practice"]["accuracy"] == 100


def test_review_recovery_reads_the_review_queue_flag(app):
    client = app.test_client()
    headers = login(client, "recovery-flag@example.test")
    create_game(client, headers)
    with app.app_context():
        user = User.query.filter_by(email="recovery-flag@example.test").one()
        _queue_due_question(user.id, Question.query.order_by(Question.id).first().id)

    session = client.post("/v1/study-sessions", json={"size": 2}, headers=headers).json["session"]
    client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "confidence": 3,
            "reasoning": explanation("the recovered repair"),
        },
        headers={**headers, "Idempotency-Key": "recovery-repair"},
    )

    performance = client.get("/v1/performance", headers=headers).json["performance"]
    assert performance["review"]["recovery_rate"] == 100
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest backend/tests/test_flow.py -k "headline_counts or recovery_reads" -v`
Expected: FAIL — `performance["coached_practice"]` raises `KeyError`, and `recovery_rate` is `None` because nothing writes the `spaced_review` evidence class any more.

- [ ] **Step 3: Narrow the headline and add the coached panel**

In `backend/app/services.py`, replace `:1345-1346`:

```python
    test_values = [attempt for attempt in first_attempts if attempt.evidence_class in {"timed_unseen", "diagnostic"}]
    test_performance = summarize(test_values)
```

with:

```python
    # The diagnostic pays nothing and prompts nothing, so it is the only
    # surface the economy and the strategy prompts cannot reach. Everything
    # else is coached practice and gets its own panel.
    test_values = [attempt for attempt in first_attempts if attempt.evidence_class == "diagnostic"]
    test_performance = summarize(test_values)
    coached_practice = summarize(
        [attempt for attempt in first_attempts if attempt.evidence_class == "coached_practice"]
    )
```

- [ ] **Step 4: Move review recovery onto the flag**

Replace `:1352-1353`:

```python
    review_values = by_evidence.get("spaced_review", [])
```

with:

```python
    review_values = [attempt for attempt in attempts if attempt.session_item.from_review_queue]
```

The `review_recovery` line below it is unchanged.

- [ ] **Step 5: Return the new panel**

In the `return {` block of `performance_snapshot`, add the key immediately after `"test_performance": test_performance,`:

```python
        "test_performance": test_performance,
        "coached_practice": coached_practice,
```

- [ ] **Step 6: Run the new tests**

Run: `python -m pytest backend/tests/test_flow.py -k "headline_counts or recovery_reads" -v`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest`
Expected: PASS. `test_diagnostic_is_neutral_and_feeds_performance` (559) asserts the diagnostic reaches `test_performance`, which is still true and now exclusively true.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services.py backend/tests/test_flow.py
git commit -m "Make the diagnostic the only headline measurement surface"
```

---

### Task 7: Remove the mode picker from the client

**Files:**
- Modify: `frontend/src/types.ts:291,335,464-478`, `frontend/src/api.ts:129,142-143`, `frontend/src/pages.tsx:72,76,110,145-190,269,286,728-1013,1044-1045,1074,1083,1099,1138`, `frontend/src/components.tsx:557-563,651-652,808,836`, `frontend/src/guided-tour.tsx:11,50`, `frontend/src/styles.css`, `frontend/src/mobile.css`
- Test: `npm run typecheck` and `npm run lint` (this codebase has no frontend unit tests; the type checker is the gate)

**Interfaces:**
- Consumes: the response shapes produced by Tasks 2 and 6 — `practice_style: 'cases' | 'diagnostic'`, `daily_docket.cases`, `daily_docket.next_action.kind`, `performance.coached_practice`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Narrow the types**

In `frontend/src/types.ts:335`:

```ts
  practice_style: 'cases' | 'diagnostic'
```

Add the coached-practice panel to the performance type, beside the existing `test_performance` field:

```ts
  coached_practice: {
    attempts: number
    accuracy: number
    average_seconds: number
    pace_adherence: number
    reasoning: number | null
  }
```

Replace the docket shape at `:475-478`:

```ts
  cases: {
    state: DailyDocketState
    target: number
    repairs_due: number
    session_id?: string | null
    summary?: PracticeSummary | null
  }
  deep_brief: { state: DailyDocketState; session_id?: string | null; priority_count: number }
  next_action: {
    kind: 'resume' | 'start_cases' | 'open_brief' | 'done'
    session_id?: string | null
    label: string
  }
```

Delete the `speedrun` and `review` docket fields.

- [ ] **Step 2: Narrow the API surface**

In `frontend/src/api.ts:129`, delete the `practice_style` line from the `startPractice` payload type so it reads:

```ts
  startPractice: (body: { size?: number; question_type?: string }) =>
```

Delete the `finishSession` helper at `frontend/src/api.ts:142-143` — Task 2 deleted the `/study-sessions/<id>/finish` route it calls. Its only caller is the `finishInfinite` mutation at `frontend/src/components.tsx:651-652`, which is deleted in Step 5 along with the "End run" button at `components.tsx:808`.

- [ ] **Step 3: Strip the mode picker from the lobby**

In `frontend/src/pages.tsx`, inside `CasesLobbyPage`:

- Delete the `practiceStyle` state at `:732`.
- Delete the `practiceModeCopy` object at `:802-807` and the `selectedMode` / `SelectedModeIcon` bindings at `:808-809`.
- Change the `start` mutation at `:737-742` to:

```tsx
  const start = useMutation({
    mutationFn: (plan?: { size?: number }) => api.startPractice({ size: plan?.size ?? 10 }),
```

- Change `startNewRun` at `:822-825` to take `plan?: { size?: number }`.
- In `runNextDocketStep` at `:792-801`, replace the two `start.mutate` branches with:

```tsx
    if (daily.next_action.kind === 'start_cases') start.mutate({ size: 10 })
```

- In the run-queue list at `:866-867`, replace the `practiceModeCopy` lookup with a fixed label and icon:

```tsx
              const RunIcon = BriefcaseBusiness
```

and render `<strong>Cases</strong>` in place of `{copy.title}` at `:874`.

- Delete the mode tablist at `:926-932`, the spaced-review button at `:933-938`, and the `mobile-practice-selection` block at `:940-946`.
- Change the mobile start button at `:947-949` to:

```tsx
        <button className="mobile-practice-start" onClick={() => startNewRun()} disabled={start.isPending || queueFull}>
          {start.isPending ? 'Preparing run…' : queueFull ? 'Queue full' : 'Start 10 cases'} <ArrowRight />
        </button>
```

- Replace the docket button's `disabled` expression at `:919` and `:984` with:

```tsx
            disabled={start.isPending || daily.next_action.kind === 'done' || (queueFull && daily.next_action.kind === 'start_cases')}
```

- Replace the docket summary line at `:921` with:

```tsx
            <span><small>TODAY’S DOCKET</small><strong>{daily.next_action.kind === 'done' ? 'Training loop complete' : daily.next_action.label}</strong><em>{daily.cases.repairs_due} repair{daily.cases.repairs_due === 1 ? '' : 's'} folded in · {daily.deep_brief.priority_count} to brief</em></span>
```

- Replace the hero copy and button at `:958-965`:

```tsx
          <p>Every run is the same shape: unseen questions, due repairs folded in, a written explanation on each one, and coaching after every answer.</p>
          <button className="primary-button jumbo" onClick={() => startNewRun()} disabled={start.isPending || queueFull}>
            <BriefcaseBusiness /> {start.isPending ? 'Building your run…' : queueFull ? `Queue full (${runs.length}/${queueCap})` : 'Start 10 cases'} <ArrowRight />
          </button>
```

- Replace the two-step docket track at `:989-993` with the `cases` and `deep_brief` steps:

```tsx
          <article className={`state-${daily.cases.state}`}><b>01</b><div><span><BriefcaseBusiness /> CASES</span><strong>10 questions{daily.cases.repairs_due ? `, ${Math.min(5, daily.cases.repairs_due)} repairs folded in` : ''}</strong><small>Written explanation · graded · coaching after every answer</small></div><i>{daily.cases.state === 'complete' ? <Check /> : daily.cases.state === 'active' ? 'LIVE' : 'NOW'}</i></article>
          <article className={`state-${daily.deep_brief.state}`}><b>02</b><div><span><Brain /> DEEP BRIEF</span><strong>{daily.deep_brief.priority_count ? `${daily.deep_brief.priority_count} decision${daily.deep_brief.priority_count === 1 ? '' : 's'} to audit` : 'Confirm what held'}</strong><small>Correct rule · selected trap · transfer cue</small></div><i>{daily.deep_brief.state === 'complete' ? <Check /> : daily.deep_brief.state === 'locked' ? <Lock /> : 'OPEN'}</i></article>
```

- Delete the "CHOOSE ANOTHER MODE" heading at `:995` and the whole `practice-mode-picker` section at `:996-1001`.
- Delete the now-unused `dueReviews` binding at `:781` if nothing else references it, and drop `TimerReset`, `Activity`, and `BookOpen` from the lucide import if they became unused.

- [ ] **Step 4: Relabel the dashboard headline**

In `frontend/src/pages.tsx`, inside `PerformancePage`:

- Replace `TIMED UNSEEN ACCURACY` with `DIAGNOSTIC ACCURACY` at `:148`, `:177`, and in the `aria-label` at `:145` and `:175`.
- At `:188`, change the metric card copy to `<small>{testMetrics.attempts} diagnostic attempts · {testMetrics.pace_adherence}% inside target</small>` and its heading to `DIAGNOSTIC PERFORMANCE`.
- At `:189`, change the split note to `<small>Diagnostic work only</small>`.
- At `:148` and `:178`, replace the "Run a baseline sprint to establish your line." / "evidence forming" copy with "Take the baseline diagnostic to establish your line."
- At `:160` and `:171`, change the primary button label from `Start 10-question sprint` / `Start 10-question Sprint` to `Start 10 cases`, and point `startSpeedrun` at `api.startPractice({ size: 10 })` (rename the mutation to `startCases`).
- At `:76`, drop `practice_style` and `feedback_policy` from the focus-sprint mutation.
- At `:110`, update the strategy-lab fallback `empty_state.body` to `'Answer a few cases. Every question arrives with a suggested approach.'`
- At `:269`, replace the evidence explainer with: `<p>The diagnostic estimates test performance. Everything else is coached practice — explained, graded, and paid. Repeated questions never inflate the diagnostic headline.</p>`
- At `:286`, replace "Complete the diagnostic or a speedrun to identify the first training priority." with "Complete the diagnostic or a few cases to identify the first training priority."
- Add a coached-practice card to the `performance-metrics` section using `performance.coached_practice`:

```tsx
        <article><div><Brain /><span>COACHED PRACTICE</span></div><strong>{performance.coached_practice.attempts ? `${performance.coached_practice.accuracy}%` : '—'}</strong><small>{performance.coached_practice.attempts} cases · {performance.coached_practice.reasoning === null ? 'no grades yet' : `${performance.coached_practice.reasoning}% mean explanation`}</small></article>
```

- [ ] **Step 5: Collapse the case-view branches**

In `frontend/src/components.tsx`, delete the four style-derived bindings at `:557-563` (`isInfinite`, `compactReview`, `learningOnly`, `shortForm`) and replace every use:

- `isInfinite` → always `false`. Delete the end-run control and the `isInfinite ? '' : \`/ ${session.total_items}\`` branch at `:836`, which becomes an unconditional ` / {session.total_items}`.
- `compactReview` and `learningOnly` → always `false`, so the full coaching panel renders unconditionally. Delete both branches and keep the full-panel arm.
- `shortForm` → always `false`. Keep the "Your case theory" label and the long-form placeholder.
- At `:836`, replace the mode-name expression with `{isDiagnostic ? 'Diagnostic' : 'Case'}`.

Keep `minChars` at `:562` — it still reads `item.reasoning_min_chars` from the server, which is the right source of truth.

- [ ] **Step 6: Unblock the Deep Brief**

`SessionReviewPage` gates the "Finish Deep Brief" button on
`const isSpeedrun = review.session.practice_style === 'speedrun'` (`pages.tsx:1074`,
used at `:1138`). After Task 2 that expression is permanently `false`, so the
brief could never be acknowledged, `summary_seen_at` would never be set, and the
docket would sit at `brief_state === "ready"` forever. Fix all four uses:

- `:1074` — replace the binding with `const isBrief = !isDiagnostic`.
- `:1083` — the eyebrow becomes `{isDiagnostic ? 'DIAGNOSTIC COMPLETE' : 'DEEP BRIEF'}`, dropping the `review.session.practice_style.toUpperCase()` fallback.
- `:1099` — replace `isSpeedrun` with `isBrief`.
- `:1138` — replace `isSpeedrun` with `isBrief`.

In the same component, the repair mutation at `:1044-1045` still asks for a
review-style run. Change it to a normal run — due repairs are folded in
automatically now:

```tsx
  const startRepair = useMutation({
    mutationFn: () => api.startPractice({ size: Math.min(5, Math.max(1, dueReviews)) }),
```

- [ ] **Step 7: Update the guided tour**

In `frontend/src/guided-tour.tsx:50`, replace the modes sentence:

```ts
    body: 'Every run is the same: unseen questions with any due repairs folded in, a written explanation on each one, and coaching after every answer.',
```

Bump `TOUR_STORAGE_KEY` at `:11` from `'lawyer-speedrun:guided-tour:v3'` to `':v4'` so returning students see the corrected tour.

- [ ] **Step 8: Remove the dead CSS**

In `frontend/src/styles.css` and `frontend/src/mobile.css`, delete the rule blocks for `.practice-mode-picker`, `.practice-mode-heading`, `.mobile-practice-modes`, `.mobile-practice-review`, and `.mobile-practice-selection`.

- [ ] **Step 9: Typecheck and lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both PASS. The type checker is what proves no reference to a deleted style or docket field survives.

- [ ] **Step 10: Commit**

```bash
git add frontend/src frontend/src/styles.css frontend/src/mobile.css
git commit -m "Remove the practice mode picker from the client"
```

---

### Task 8: Update the seed scripts and the feature documentation

**Files:**
- Modify: `backend/scripts/seed_demo.py:156,621,1045,1126,1167`, `backend/scripts/seed_demo_learner.py:336,350,487,504`, `backend/scripts/live_trial_state.py:58`
- Modify: `FEATURES.md:34,36,90-115,202-210,254-259,417-424,508-510,616,652,755,799,819`
- Test: `backend/tests/test_flow.py` (existing suite, plus a smoke run of the seeders)

**Interfaces:**
- Consumes: `create_study_session(user, *, count=None, question_type=None, practice_style="cases")` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Point the demo seeders at the single style**

In `backend/scripts/seed_demo.py`, change the session schedule comment and data at `:156` so every entry uses `"cases"`, change the `practice_style=style` construction at `:621` and the `create_study_session(..., practice_style=style)` call at `:1126` to pass `"cases"`, and replace the `.filter(StudySession.practice_style.in_(["deep", "review"]))` at `:1045` with `.filter(StudySession.practice_style == "cases")`. Update the serialized `"practice_style": style` at `:1167` accordingly.

In `backend/scripts/seed_demo_learner.py`, change `:336` to `settle=session.mode == "practice"`, and change the three `create_study_session` calls at `:350`, `:487`, and `:504` to drop their `practice_style` arguments so they take the `"cases"` default.

In `backend/scripts/live_trial_state.py:58`, replace `filter_by(user_id=user.id, practice_style="infinite")` with `filter_by(user_id=user.id, practice_style="cases")`.

- [ ] **Step 2: Smoke-run the seeder**

Run: `python -m pytest backend/tests/test_game_catalog.py -v`
Expected: PASS.

Then confirm the demo seeder still imports and its module-level schedule is consistent:

Run: `python -c "import sys; sys.path.insert(0, 'backend'); import scripts.seed_demo"`
Expected: no output, exit 0.

- [ ] **Step 3: Rewrite the FEATURES.md practice-style section**

Replace the table and prose at `FEATURES.md:90-115` with:

```markdown
### 2.3 The practice mode

There is one practice mode plus the diagnostic, which is a separate session `mode` rather than a practice style.

| Style (API) | UI name | Feedback | Reasoning required | Evidence class | Purpose |
| --- | --- | --- | --- | --- | --- |
| `cases` | Cases | Immediate | **Yes**, 120 characters | `coached_practice` | Written reasoning, full AI coaching, a strategy trial on every question, and game settlement |
| `diagnostic` (mode) | Diagnostic | Delayed to end | No | `diagnostic` | Sectioned neutral baseline |

Every run is the same shape: due repairs from the spaced-review queue fill up to half the run and occupy the
first positions, and unseen questions fill the rest. A `question_type`-filtered run seeds no repairs, because
mixing off-type repairs into a focused drill would defeat the filter. `SessionItem.from_review_queue` records
which items were repairs, and that flag — not the session — decides whether an answer advances a review card or
enqueues a new one.
```

- [ ] **Step 4: Replace the measurement principle**

`FEATURES.md:36` currently reads that only one practice mode pays money so the game layer cannot distort
measurement. Replace that bullet with:

```markdown
- **The game layer must not be able to distort measurement.** Every practice case now pays, so the containment
  moved: the diagnostic is the only surface that feeds the headline accuracy number, and it pays nothing,
  prompts no strategy, and coaches nothing. Coached practice reports its own accuracy in its own panel, where a
  cash incentive on every question is a known property of the number rather than a hidden one.
```

- [ ] **Step 5: Update the remaining FEATURES.md references**

- `:34` — the list of distinct `evidence_class` values becomes `coached_practice` and `diagnostic`.
- `:202-210` — the Daily Docket is two steps: cases, then deep brief.
- `:254-259` — `assign_strategy_trial` returns `None` only for the diagnostic; every practice question is trial-eligible, and the 25% control arm is what keeps the comparison honest.
- `:417-424` — every answer shows the full coaching panel; only the diagnostic shows nothing during the run.
- `:508-510` — `_freeze_current_case` attaches game context to every unfinished current practice item; only the diagnostic is excluded.
- `:616` and `:652` — the `/progress` row keeps the Method Lab panel and gains the coached-practice card.
- `:755` — the worked example starts "A learner in a cases run opens question 3 of a session."
- `:799` — the load note refers to a "Start 10 cases" click.
- `:819` — delete the "only one of four practice modes pays" caveat; it is no longer true.

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/scripts FEATURES.md
git commit -m "Point the seeders and the feature docs at the single cases mode"
```

---

## Verification

After Task 8, confirm the whole change end to end:

- [ ] `python -m pytest` — full backend suite green.
- [ ] `cd frontend && npm run typecheck && npm run lint` — both green.
- [ ] `grep -rn "speedrun\|infinite\|practice_style.*review" backend/app frontend/src` returns only the `lawyer-speedrun:` localStorage key prefixes in `components.tsx`, `guided-tour.tsx`, and `art/office-three.tsx`, which are unrelated storage namespaces and must not be renamed.
- [ ] `flask db upgrade` against a copy of the sandbox database, then `flask db downgrade` and `flask db upgrade` again, to prove `0021` round-trips.
