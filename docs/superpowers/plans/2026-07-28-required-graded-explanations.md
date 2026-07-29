# Required Graded Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Require a written explanation on every non-diagnostic question, and let the AI grade of that explanation drive both the spaced-review queue and strategy trial selection.

**Architecture:** The grading pipeline already exists — the coach returns `explanation_grade` 0–100, and `game.explanation_band` converts it to Invalid/Weak/Good/Excellent for the economy. This plan flips the `requires_reasoning` gate on for all four practice styles, adds a per-style minimum length, and makes `_schedule_review` and the strategy bandit read the resulting grade. Because grading is an async LLM call, scheduling runs provisionally on submit and is re-run when the grade lands.

**Tech Stack:** Flask + SQLAlchemy + Alembic (backend), pytest, React + TypeScript (frontend).

## Global Constraints

- Minimum explanation length by practice style, exact values: `{"deep": 120, "review": 120, "speedrun": 40, "infinite": 40}`. Diagnostic requires nothing.
- The diagnostic never requires an explanation, never gets coaching, never gets a strategy prompt.
- The grading prompt (`coaching.py`), band thresholds (`game.explanation_band`), and economy payout math (`game._points`) are NOT modified.
- Strategy trial cadence is unchanged: trials fire only in `deep`/`infinite` at `position % 4 == 2`.
- `Attempt.explanation_score` is a normalized 0–1 float. `game.explanation_band` takes a raw 0–100 int. Always convert with `round(score * 100)`.
- The review ladder stays `REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)`.
- Do NOT bump `REQUIRED_TARGET_REVISION` in `backend/scripts/migrate_sqlite_to_postgres.py`. It is pinned at `0014_story_campaign` and is already four revisions stale; keeping it in sync is not this change's job.
- Run backend tests from the `backend/` directory: `cd backend && python -m pytest`.

---

### Task 1: Review queue schema for pending grades

**Files:**
- Modify: `backend/app/models.py:449-467`
- Create: `backend/migrations/versions/0019_explanation_scheduling.py`
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ReviewQueueItem.grade_pending: bool` (not null, default False) and `ReviewQueueItem.pre_grade_interval_index: int | None`. Tasks 3 and 4 read and write both.

- [x] **Step 1: Write the failing test**

Add to `backend/tests/test_flow.py`:

```python
def test_review_queue_tracks_pending_grade_state(app):
    with app.app_context():
        columns = {column.name for column in ReviewQueueItem.__table__.columns}
        assert "grade_pending" in columns
        assert "pre_grade_interval_index" in columns
        assert ReviewQueueItem.__table__.c.grade_pending.nullable is False
        assert ReviewQueueItem.__table__.c.pre_grade_interval_index.nullable is True
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_flow.py::test_review_queue_tracks_pending_grade_state -v`
Expected: FAIL with `AssertionError` — `grade_pending` is not in the column set.

- [x] **Step 3: Add the columns to the model**

In `backend/app/models.py`, inside `class ReviewQueueItem`, immediately after the `interval_index` column (line 461):

```python
    interval_index = db.Column(db.Integer, nullable=False, default=0)
    grade_pending = db.Column(db.Boolean, nullable=False, default=False)
    pre_grade_interval_index = db.Column(db.Integer, nullable=True)
```

- [x] **Step 4: Write the migration**

Create `backend/migrations/versions/0019_explanation_scheduling.py`:

```python
"""Add explanation-grade scheduling state to the review queue.

Revision ID: 0019_explanation_scheduling
Revises: 0018_office_upkeep
"""

from alembic import op
import sqlalchemy as sa


revision = "0019_explanation_scheduling"
down_revision = "0018_office_upkeep"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("review_queue_items") as batch_op:
        batch_op.add_column(sa.Column("grade_pending", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("pre_grade_interval_index", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("review_queue_items") as batch_op:
        batch_op.drop_column("pre_grade_interval_index")
        batch_op.drop_column("grade_pending")
```

- [x] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_flow.py::test_review_queue_tracks_pending_grade_state tests/test_migration_integrity.py -v`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/0019_explanation_scheduling.py backend/tests/test_flow.py
git commit -m "Add review queue columns for pending explanation grades"
```

---

### Task 2: Require an explanation on every non-diagnostic question

**Files:**
- Modify: `backend/app/services.py:19-34` (constants), `:192-246` (`serialize_item`), `:441`, `:770`, `:877-879` (`submit_attempt`)
- Modify: `backend/app/routes.py:663-676`
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `services.reasoning_min_chars(session: StudySession) -> int`, and a `reasoning_min_chars` integer field on every serialized session item. Task 7 consumes the serialized field.

**Note on the gate expression:** the spec writes this as `practice_style != "diagnostic"`. `create_study_session` can only ever produce the four practice styles, so the literal `True` below is equivalent and clearer. The diagnostic path is a separate function and keeps its explicit `False`.

- [x] **Step 1: Write the failing tests**

Add to `backend/tests/test_flow.py`:

```python
@pytest.mark.parametrize("practice_style", ["deep", "speedrun", "infinite"])
def test_every_practice_style_requires_an_explanation(app, practice_style):
    client = app.test_client()
    headers = login(client, f"requires-{practice_style}@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": practice_style},
        headers=headers,
    ).json["session"]
    assert session["current_item"]["requires_reasoning"] is True
    expected = 120 if practice_style == "deep" else 40
    assert session["current_item"]["reasoning_min_chars"] == expected


def test_diagnostic_never_requires_an_explanation(app):
    client = app.test_client()
    headers = login(client, "diagnostic-no-reasoning@example.test")
    create_game(client, headers)
    session = client.post("/v1/diagnostics", json={}, headers=headers).json["session"]
    assert session["current_item"]["requires_reasoning"] is False
    assert session["current_item"]["reasoning_min_chars"] == 0


def test_missing_explanation_is_rejected(app):
    client = app.test_client()
    headers = login(client, "no-reasoning@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "speedrun"},
        headers=headers,
    ).json["session"]
    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": session["current_item"]["id"], "selected_label": "C"},
        headers={**headers, "Idempotency-Key": "no-reasoning"},
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "reasoning_required"


def test_short_explanation_is_rejected_with_its_own_code(app):
    client = app.test_client()
    headers = login(client, "short-reasoning@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "speedrun"},
        headers=headers,
    ).json["session"]
    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": session["current_item"]["id"], "selected_label": "C", "reasoning": "C is right."},
        headers={**headers, "Idempotency-Key": "too-short"},
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "reasoning_too_short"


def test_deep_practice_enforces_the_longer_floor(app):
    client = app.test_client()
    headers = login(client, "deep-floor@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "deep"},
        headers=headers,
    ).json["session"]
    # 60 characters clears the speedrun floor of 40 but not the deep floor of 120.
    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "reasoning": "C follows from the premise and the others overreach here.",
        },
        headers={**headers, "Idempotency-Key": "deep-too-short"},
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "reasoning_too_short"
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_flow.py -k "requires_an_explanation or never_requires or short_explanation or longer_floor" -v`
Expected: FAIL — `reasoning_min_chars` is absent from the payload, and short explanations return 200.

- [x] **Step 3: Add the constant and helper**

In `backend/app/services.py`, after `REVIEW_INTERVAL_DAYS` (line 34):

```python
REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)
REASONING_MIN_CHARS = {"deep": 120, "review": 120, "speedrun": 40, "infinite": 40}


def reasoning_min_chars(session: StudySession) -> int:
    """Characters of written explanation this session demands before an answer counts."""
    if session.mode == "diagnostic":
        return 0
    return REASONING_MIN_CHARS.get(session.practice_style, 0)
```

- [x] **Step 4: Flip the gate at all three creation sites**

`backend/app/services.py:441`, inside the `SessionItem(...)` built by `create_study_session`:

```python
                requires_reasoning=True,
```

`backend/app/services.py:770`, inside `_append_infinite_item`:

```python
            requires_reasoning=True,
```

`backend/app/services.py:488` in `create_diagnostic_session` keeps `requires_reasoning=False` — do not touch it.

- [x] **Step 5: Publish the floor on the serialized item**

In `serialize_item` (`backend/app/services.py:225`), directly after the `requires_reasoning` entry:

```python
        "requires_reasoning": item.requires_reasoning,
        "reasoning_min_chars": reasoning_min_chars(item.session),
```

- [x] **Step 6: Enforce the floor on submit**

Replace `backend/app/services.py:877-879`:

```python
    reasoning = str(payload.get("reasoning") or "").strip()[:4000] or None
    if item.requires_reasoning:
        if not reasoning:
            raise ValueError("reasoning_required")
        if len(reasoning) < reasoning_min_chars(session):
            raise ValueError("reasoning_too_short")
```

- [x] **Step 7: Map the new error code**

In `backend/app/routes.py`, add to the `messages` dict after line 671:

```python
            "reasoning_required": "Explain your reasoning before submitting the case.",
            "reasoning_too_short": "Your explanation is too short to grade — add the reasoning that decided your answer.",
```

And add the code to the 400 set on line 676:

```python
        status = 400 if code in {"invalid_choice", "reasoning_required", "reasoning_too_short", "invalid_confidence", "strategy_decision_required", "invalid_strategy_prompt_time"} else 409
```

- [x] **Step 8: Repair the existing tests this breaks** — *wider than estimated; see note.*

> **Deviation as built.** Sixteen tests broke, not six. The estimate counted only call
> sites with *no* reasoning; because the default practice style is `deep`, its
> 120-character floor also rejected fourteen sites that already supplied 40–99
> characters. Fixed by adding an `explanation(marker)` helper (215 characters, distinct
> per marker) and lengthening each existing string in place, preserving intent where the
> wording carried meaning — the deliberately vacuous explanation in
> `test_invalid_reasoning_does_not_advance_cash_daily_goals` and the historical one in
> `test_finished_legacy_attempt_is_not_adopted_or_paid_retroactively`. Distinctness is
> load-bearing: `game._is_reused_reasoning` forces an Invalid band on a repeat within a
> user's last 50 attempts, so one shared literal would have silently changed what those
> tests settle.

Six existing call sites submit answers with no reasoning and will now 400. Each needs a reasoning string of at least 40 characters. Apply these exact edits in `backend/tests/test_flow.py`:

Line ~515 (`speedrun-delayed-one`) and line ~532 (`speedrun-delayed-two`) — add to each `json={...}`:

```python
            "reasoning": "The stimulus supports this choice directly and the others add unsupported conditions.",
```

Line ~594 (daily docket loop) — change the json to:

```python
            json={
                "item_id": current["current_item"]["id"],
                "selected_label": answer,
                "confidence": 5,
                "reasoning": "The stated evidence points to this choice and the rest overreach the passage.",
            },
```

Line ~636 (`review-seed-miss`) — change the json to:

```python
        json={
            "item_id": sprint["current_item"]["id"],
            "selected_label": "A",
            "confidence": 4,
            "reasoning": "I read the conclusion as requiring this choice, and eliminated the rest on scope.",
        },
```

Line ~685 (`infinite-answer`) — change the json to:

```python
        json={
            "item_id": infinite["current_item"]["id"],
            "selected_label": "C",
            "confidence": 5,
            "reasoning": "The credited choice restates the controlling relationship without adding new claims.",
        },
```

Line ~683 asserts the old gate. Change:

```python
    assert infinite["current_item"]["requires_reasoning"] is True
```

- [x] **Step 9: Run the full backend suite**

Run: `cd backend && python -m pytest`
Expected: PASS, all tests. If any test still fails with `reasoning_required` or `reasoning_too_short`, add a 40+ character `reasoning` value to that call site the same way.

- [x] **Step 10: Commit**

```bash
git add backend/app/services.py backend/app/routes.py backend/tests/test_flow.py
git commit -m "Require a written explanation on every non-diagnostic question"
```

---

### Task 3: Grade-aware review scheduling

**Files:**
- Modify: `backend/app/services.py:13` (import), `:779-835` (`_schedule_review`)
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: `ReviewQueueItem.grade_pending`, `ReviewQueueItem.pre_grade_interval_index` from Task 1.
- Produces: `_schedule_review(attempt: Attempt) -> None` — now safe to call more than once for the same attempt. Task 4 calls it a second time.

- [x] **Step 1: Write the failing tests**

Add to `backend/tests/test_flow.py`:

```python
def _graded_attempt(attempt_id: str, score: float | None):
    """Set a normalized 0-1 explanation score on an attempt and re-run scheduling."""
    from app.services import _schedule_review

    attempt = db.session.get(Attempt, attempt_id)
    attempt.explanation_score = score
    db.session.flush()
    _schedule_review(attempt)
    db.session.commit()
    return attempt


def test_correct_answer_with_invalid_explanation_enters_the_review_queue(app):
    client = app.test_client()
    headers = login(client, "unsupported-correct@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "speedrun"},
        headers=headers,
    ).json["session"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "confidence": 5,
            "reasoning": "It just felt like the best available answer to me on this one.",
        },
        headers={**headers, "Idempotency-Key": "guessed-right"},
    ).json["result"]

    with app.app_context():
        # Confident, fast, correct: nothing schedules it before the grade lands.
        assert ReviewQueueItem.query.count() == 0
        _graded_attempt(answered["attempt_id"], 0.10)
        row = ReviewQueueItem.query.one()
        assert row.reason_code == "unsupported_correct"
        assert row.interval_index == 0
        assert row.grade_pending is False


def test_good_explanation_on_a_confident_correct_answer_schedules_nothing(app):
    client = app.test_client()
    headers = login(client, "supported-correct@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "speedrun"},
        headers=headers,
    ).json["session"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "confidence": 5,
            "reasoning": "C restates the controlling relationship exactly; the others add conditions.",
        },
        headers={**headers, "Idempotency-Key": "earned-right"},
    ).json["result"]

    with app.app_context():
        _graded_attempt(answered["attempt_id"], 0.90)
        assert ReviewQueueItem.query.count() == 0


@pytest.mark.parametrize(
    ("start_index", "score", "expected_index", "expected_status"),
    [
        (1, 0.90, 3, "due"),        # Excellent -> +2
        (1, 0.60, 2, "due"),        # Good      -> +1
        (1, 0.30, 1, "due"),        # Weak      -> hold
        (1, 0.10, 0, "due"),        # Invalid   -> reset
        (3, 0.90, 4, "mastered"),   # Excellent -> +2 overshoots the ladder
    ],
)
def test_review_advance_depends_on_the_explanation_grade(app, start_index, score, expected_index, expected_status):
    with app.app_context():
        user = User(email=f"advance-{start_index}-{score}@example.test", display_name="Advance")
        db.session.add(user)
        db.session.flush()
        question = Question.query.first()
        row = ReviewQueueItem(
            user_id=user.id,
            question_id=question.id,
            status="due",
            reason_code="incorrect",
            interval_index=start_index,
            due_at=utcnow(),
        )
        db.session.add(row)
        db.session.commit()

        session = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="review",
            feedback_policy="immediate",
            target_minutes=10,
            total_items=1,
        )
        db.session.add(session)
        db.session.flush()
        item = SessionItem(
            session_id=session.id,
            question_id=question.id,
            position=0,
            requires_reasoning=True,
            target_time_seconds=150,
        )
        db.session.add(item)
        db.session.flush()
        attempt = Attempt(
            user_id=user.id,
            session_item_id=item.id,
            idempotency_key=f"advance-{start_index}-{score}",
            selected_label=question.correct_answer,
            is_correct=True,
            reasoning_text="A written explanation long enough to be graded by the coach.",
            confidence=4,
            server_elapsed_ms=60_000,
            explanation_score=score,
        )
        db.session.add(attempt)
        db.session.flush()

        from app.services import _schedule_review

        _schedule_review(attempt)
        db.session.commit()

        refreshed = db.session.get(ReviewQueueItem, row.id)
        assert refreshed.interval_index == expected_index
        assert refreshed.status == expected_status
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_flow.py -k "unsupported_correct or supported_correct or review_advance" -v`
Expected: FAIL — no `unsupported_correct` reason exists, and advancement ignores the grade.

- [x] **Step 3: Import the band helper**

In `backend/app/services.py:13`, extend the existing `game` import:

```python
from .game import CLIENT_BY_KEY, explanation_band, lock_user_profile, serialize_settlement, settle_attempt, snapshot_case_context
```

- [x] **Step 4: Replace `_schedule_review` with the grade-aware version**

Replace the whole of `backend/app/services.py:779-835`:

```python
def _attempt_band(attempt: Attempt) -> str | None:
    """Economy band for a graded explanation, or None while the grade is missing.

    ``Attempt.explanation_score`` is normalized 0-1; ``explanation_band`` wants a
    raw 0-100 score. Reuse is already handled upstream: ``settle_attempt`` zeroes
    a recycled explanation's grade before it is written here.
    """
    if attempt.explanation_score is None:
        return None
    return explanation_band(round(attempt.explanation_score * 100), bool(attempt.reasoning_text))


def _entry_reason(attempt: Attempt, band: str | None) -> str | None:
    """First matching reason this attempt belongs in the review queue."""
    confidence = attempt.confidence or 3
    slow = attempt.server_elapsed_ms > attempt.session_item.target_time_seconds * 1000
    if not attempt.is_correct:
        return "high_confidence_error" if confidence >= 4 else "incorrect"
    if band in {"Invalid", "Weak"}:
        return "unsupported_correct"
    if confidence <= 2:
        return "low_confidence_correct"
    if slow:
        return "slow_correct"
    return None


def _advance_review(existing: ReviewQueueItem, attempt: Attempt, band: str | None, from_index: int) -> None:
    """Move a review card along the ladder according to answer and explanation."""
    if not attempt.is_correct:
        existing.status = "due"
        existing.interval_index = 0
        existing.reason_code = "repeat_error"
        existing.due_at = utcnow()
        return
    if band == "Invalid":
        existing.status = "due"
        existing.interval_index = 0
        existing.reason_code = "unsupported_correct"
        existing.due_at = utcnow()
        return
    if band == "Weak":
        existing.status = "due"
        existing.interval_index = from_index
        existing.reason_code = "unsupported_correct"
        existing.due_at = utcnow() + timedelta(days=1)
        return
    next_index = from_index + (2 if band == "Excellent" else 1)
    if next_index > len(REVIEW_INTERVAL_DAYS):
        existing.status = "mastered"
        existing.interval_index = len(REVIEW_INTERVAL_DAYS)
        existing.due_at = utcnow() + timedelta(days=REVIEW_INTERVAL_DAYS[-1])
    else:
        existing.status = "due"
        existing.interval_index = next_index
        existing.due_at = utcnow() + timedelta(days=REVIEW_INTERVAL_DAYS[next_index - 1])


def _schedule_review(attempt: Attempt) -> None:
    """Place or move this question in the spaced-review queue.

    Safe to call twice for the same attempt: once on submit, when the
    explanation grade is still missing, and again from ``run_attempt_coaching``
    once the grade lands. The second call recomputes from
    ``pre_grade_interval_index`` so the provisional advance is not compounded.
    """
    session = attempt.session_item.session
    band = _attempt_band(attempt)
    pending = band is None and attempt.session_item.requires_reasoning
    existing = ReviewQueueItem.query.filter_by(
        user_id=attempt.user_id,
        question_id=attempt.session_item.question_id,
    ).first()

    if session.practice_style == "review":
        if not existing:
            return
        existing.last_attempt_id = attempt.id
        from_index = existing.pre_grade_interval_index
        if from_index is None:
            from_index = existing.interval_index
        existing.pre_grade_interval_index = from_index if pending else None
        existing.grade_pending = pending
        _advance_review(existing, attempt, band, from_index)
        return

    reason_code = _entry_reason(attempt, band)
    if not reason_code:
        return
    if not existing:
        existing = ReviewQueueItem(
            user_id=attempt.user_id,
            question_id=attempt.session_item.question_id,
            source_attempt_id=attempt.id,
            status="due",
            reason_code=reason_code,
            interval_index=0,
            due_at=utcnow(),
            grade_pending=pending,
        )
        db.session.add(existing)
    else:
        existing.source_attempt_id = existing.source_attempt_id or attempt.id
        existing.last_attempt_id = attempt.id
        existing.status = "due"
        existing.reason_code = reason_code
        existing.interval_index = 0
        existing.due_at = utcnow()
        existing.grade_pending = pending
```

- [x] **Step 5: Run the new tests**

Run: `cd backend && python -m pytest tests/test_flow.py -k "unsupported_correct or supported_correct or review_advance" -v`
Expected: PASS

- [x] **Step 6: Run the full backend suite**

Run: `cd backend && python -m pytest`
Expected: PASS. The existing assertion `review_item.interval_index == 1` (around line 712) still holds: that test never runs coaching, so the review attempt is graded `None`, `band` is `None`, and `_advance_review` takes the `+1` default.

- [x] **Step 7: Commit**

```bash
git add backend/app/services.py backend/tests/test_flow.py
git commit -m "Let explanation grades decide review queue entry and advancement"
```

---

### Task 4: Backfill scheduling when the grade lands

**Files:**
- Modify: `backend/app/services.py:1005-1015` (inside `run_attempt_coaching`)
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: `_schedule_review(attempt)` from Task 3.
- Produces: nothing new. Closes the loop so an async grade revises the provisional schedule.

- [x] **Step 1: Write the failing test**

Add to `backend/tests/test_flow.py`:

```python
def test_landing_grade_revises_the_provisional_schedule(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "backfill@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "speedrun"},
        headers=headers,
    ).json["session"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "confidence": 5,
            "reasoning": "I picked C because it seemed the most likely of the five choices.",
        },
        headers={**headers, "Idempotency-Key": "backfill-answer"},
    ).json["result"]

    with app.app_context():
        assert ReviewQueueItem.query.count() == 0

    monkeypatch.setattr(
        "app.services.generate_attempt_coaching",
        lambda _attempt: (
            {
                "explanation_grade": 12,
                "reasoning_verdict": "unsupported",
                "reasoning_summary": "The explanation never engages the argument.",
                "model": "test-model",
            },
            {},
        ),
    )
    with app.app_context():
        from app.services import run_attempt_coaching

        run_attempt_coaching(db.session.get(Attempt, answered["attempt_id"]))

        row = ReviewQueueItem.query.one()
        assert row.reason_code == "unsupported_correct"
        assert row.grade_pending is False
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_flow.py::test_landing_grade_revises_the_provisional_schedule -v`
Expected: FAIL with `NoResultFound` — nothing re-runs scheduling, so the queue stays empty.

- [x] **Step 3: Call the scheduler when the grade is first applied**

In `backend/app/services.py`, inside `run_attempt_coaching`, extend the existing block at lines 1005-1015 with one line at the end:

```python
    if coaching["explanation_grade"] is not None and not attempt.explanation_score_applied:
        normalized_score = coaching["explanation_grade"] / 100
        stat = SkillProgress.query.filter_by(
            user_id=attempt.user_id,
            skill_name=attempt.session_item.question.question_type,
        ).first()
        if stat:
            stat.explanation_total += normalized_score
            stat.explanation_count += 1
        attempt.explanation_score = normalized_score
        attempt.explanation_score_applied = True
        # The submit-time schedule was written without a grade. Redo it now.
        _schedule_review(attempt)
```

The guard means this runs exactly once per attempt, and it sits before the existing `db.session.commit()` at line 1027 so it shares that transaction.

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_flow.py::test_landing_grade_revises_the_provisional_schedule -v`
Expected: PASS

- [x] **Step 5: Run the full backend suite**

Run: `cd backend && python -m pytest`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add backend/app/services.py backend/tests/test_flow.py
git commit -m "Re-run review scheduling when an explanation grade arrives"
```

---

### Task 5: Explanation quality in strategy trial scoring

**Files:**
- Modify: `backend/app/strategies.py:333-344`
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: `Attempt.explanation_score` (already exists).
- Produces: no new symbols. Changes the ranking inside `assign_strategy_trial`.

- [x] **Step 1: Write the failing test** — *implemented differently; see note.*

> **Deviation as built.** The test below asserts arithmetic on local literals plus a
> `STRATEGIES` membership check, so it never calls the code under test and passes
> before the change — Step 2's "Expected: FAIL" is not achievable. It was replaced
> with `test_strategy_scoring_weighs_explanation_quality`, which drives
> `assign_strategy_trial` over candidates tied on accuracy, pace, and calibration and
> differing only in `explanation_score`, pinning `_stable_fraction` to disable the 30%
> explore branch and the 25% control arm. It fails without the explanation term
> (selecting the sort's reverse-tiebreak winner) and passes with it.

Add to `backend/tests/test_flow.py`:

```python
def test_strategy_scoring_weighs_explanation_quality(app):
    """Two strategies tied on accuracy separate on explanation quality."""
    with app.app_context():
        from app.strategies import STRATEGIES

        # Rebuild the scoring expression the bandit uses, to assert the weights.
        # posterior is identical for both; only explanation_mean differs.
        posterior, pace, calibrated = 0.5, 1.0, 1.0
        strong = posterior * .50 + 0.9 * .30 + pace * .14 + calibrated * .06
        weak = posterior * .50 + 0.1 * .30 + pace * .14 + calibrated * .06
        assert strong > weak
        assert round(strong - weak, 4) == 0.24
        assert "argument_core" in STRATEGIES


def test_strategy_scoring_falls_back_without_graded_attempts(app):
    """A candidate with no graded explanations uses the original three-term formula."""
    with app.app_context():
        user = User(email="strategy-fallback@example.test", display_name="Fallback")
        db.session.add(user)
        db.session.flush()
        question = Question.query.filter_by(section="Logical Reasoning").first()
        session = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="deep",
            feedback_policy="immediate",
            target_minutes=10,
            total_items=1,
        )
        db.session.add(session)
        db.session.flush()
        for index in range(4):
            item = SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=index,
                requires_reasoning=True,
                target_time_seconds=150,
                strategy_key="argument_core",
                strategy_variant="prompt",
            )
            db.session.add(item)
            db.session.flush()
            db.session.add(
                Attempt(
                    user_id=user.id,
                    session_item_id=item.id,
                    idempotency_key=f"fallback-{index}",
                    selected_label=question.correct_answer,
                    is_correct=True,
                    reasoning_text="An ungraded but present written explanation for this attempt.",
                    confidence=4,
                    server_elapsed_ms=60_000,
                    strategy_key="argument_core",
                    strategy_variant="prompt",
                    strategy_applied=True,
                    explanation_score=None,
                )
            )
        db.session.commit()

        from app.strategies import assign_strategy_trial

        # Must not raise (a naive mean over None would) and must still assign.
        trial = assign_strategy_trial(user.id, question, "deep", 2)
        assert trial is not None
        assert trial["key"] in {"argument_core", "prephrase", "scope_precision", "role_map"}
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_flow.py -k "strategy_scoring" -v`
Expected: `test_strategy_scoring_weighs_explanation_quality` FAILS — it asserts the new weight split, which does not exist yet. `test_strategy_scoring_falls_back_without_graded_attempts` PASSES already; it is the regression guard that Step 3 must not break, since a naive `sum(...)/len(...)` over `None` scores raises `TypeError`.

- [x] **Step 3: Add the explanation term with a fallback**

Replace the `score` function in `backend/app/strategies.py:333-344`:

```python
        def score(candidate: str) -> float:
            values = grouped[candidate]
            correct = sum(value.is_correct for value in values)
            posterior_accuracy = (correct + 1) / (len(values) + 2)
            adjusted_seconds = [
                max(1, value.server_elapsed_ms - (value.strategy_prompt_ms or 0)) / 1000
                for value in values
            ]
            target_seconds = [value.session_item.target_time_seconds for value in values]
            pace = sum(elapsed <= target for elapsed, target in zip(adjusted_seconds, target_seconds)) / len(values)
            calibrated = sum((value.confidence or 3) <= 3 or value.is_correct for value in values) / len(values)
            graded = [value for value in values if value.explanation_score is not None]
            if not graded:
                # No graded explanation yet: fall back rather than penalize missing data.
                return posterior_accuracy * .76 + pace * .18 + calibrated * .06
            explanation_mean = sum(value.explanation_score for value in graded) / len(graded)
            return posterior_accuracy * .50 + explanation_mean * .30 + pace * .14 + calibrated * .06
```

`explanation_score` is already normalized 0–1, matching the scale of the other three terms, so no rescaling is applied here.

- [x] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_flow.py -k "strategy_scoring" -v`
Expected: PASS

- [x] **Step 5: Run the full backend suite**

Run: `cd backend && python -m pytest`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add backend/app/strategies.py backend/tests/test_flow.py
git commit -m "Weigh explanation quality when choosing which strategy to surface"
```

---

### Task 6: Explanation metrics on the strategy dashboard

**Files:**
- Modify: `backend/app/strategies.py:442-458`
- Modify: `frontend/src/types.ts` (strategy result type)
- Test: `backend/tests/test_flow.py`

**Interfaces:**
- Consumes: `Attempt.explanation_score`.
- Produces: `explanation_mean`, `control_explanation_mean`, `explanation_lift` on each entry of `strategy_performance()["results"]`. All three are `int | None` on a 0–100 scale.

- [x] **Step 1: Write the failing test**

Add to `backend/tests/test_flow.py`:

```python
def test_strategy_performance_reports_explanation_metrics(app):
    """strategy_performance is surfaced under performance.strategy_lab, not its own route."""
    with app.app_context():
        user = User(email="strategy-metrics@example.test", display_name="Metrics")
        db.session.add(user)
        db.session.flush()
        question = Question.query.filter_by(section="Logical Reasoning").first()
        session = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="deep",
            feedback_policy="immediate",
            target_minutes=10,
            total_items=2,
        )
        db.session.add(session)
        db.session.flush()
        for index, (variant, score) in enumerate((("prompt", 0.80), ("control", 0.40))):
            item = SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=index,
                requires_reasoning=True,
                target_time_seconds=150,
                strategy_key="argument_core",
                strategy_variant=variant,
            )
            db.session.add(item)
            db.session.flush()
            db.session.add(
                Attempt(
                    user_id=user.id,
                    session_item_id=item.id,
                    idempotency_key=f"metrics-{index}",
                    selected_label=question.correct_answer,
                    is_correct=True,
                    reasoning_text="A graded written explanation for this attempt.",
                    confidence=4,
                    server_elapsed_ms=60_000,
                    strategy_key="argument_core",
                    strategy_variant=variant,
                    strategy_applied=True if variant == "prompt" else None,
                    explanation_score=score,
                )
            )
        db.session.commit()

        from app.strategies import strategy_performance

        result = next(
            entry for entry in strategy_performance(user.id)["results"] if entry["key"] == "argument_core"
        )
        assert result["explanation_mean"] == 80
        assert result["control_explanation_mean"] == 40
        assert result["explanation_lift"] == 40
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_flow.py::test_strategy_performance_reports_explanation_metrics -v`
Expected: FAIL with `KeyError`/`AssertionError` — the keys do not exist.

- [x] **Step 3: Extend `metrics` to return an explanation mean**

In `backend/app/strategies.py`, replace the `metrics` helper and its two call sites (lines 442-458):

```python
        def metrics(sample: list[Attempt]) -> tuple[int, int, int, int | None, int | None]:
            if not sample:
                return 0, 0, 0, None, None
            correct = sum(value.is_correct for value in sample)
            adjusted = [max(1000, value.server_elapsed_ms - (value.strategy_prompt_ms or 0)) for value in sample]
            pace = sum(
                elapsed <= value.session_item.target_time_seconds * 1000
                for elapsed, value in zip(adjusted, sample)
            )
            graded = [value for value in sample if value.explanation_score is not None]
            explanation = round(sum(value.explanation_score for value in graded) / len(graded) * 100) if graded else None
            return (
                len(sample),
                round(correct / len(sample) * 100),
                round(sum(adjusted) / len(sample) / 1000),
                round(pace / len(sample) * 100),
                explanation,
            )

        sample, accuracy, seconds, pace, explanation_mean = metrics(prompted)
        control_sample, control_accuracy, control_seconds, _control_pace, control_explanation_mean = metrics(controls)
        status = "forming" if sample < 4 or control_sample < 2 else "directional" if sample < 8 or control_sample < 4 else "supported"
        lift = accuracy - control_accuracy if sample and control_sample else None
        explanation_lift = (
            explanation_mean - control_explanation_mean
            if explanation_mean is not None and control_explanation_mean is not None
            else None
        )
        posterior = (sum(value.is_correct for value in prompted) + 1) / (sample + 2)
        ranking_score = posterior * 100 + (pace or 0) * .08 + (lift or 0) * .25 + (explanation_lift or 0) * .15
```

- [x] **Step 4: Add the three fields to the result payload**

In the same `results.append({...})` block in `backend/app/strategies.py`, after the existing `"lift": lift,` entry:

```python
                "lift": lift,
                "explanation_mean": explanation_mean,
                "control_explanation_mean": control_explanation_mean,
                "explanation_lift": explanation_lift,
```

- [x] **Step 5: Add the fields to the frontend type**

In `frontend/src/types.ts`, in `export type StrategyResult` (line 375), directly after `lift: number | null` on line 389:

```typescript
  lift: number | null
  explanation_mean: number | null
  control_explanation_mean: number | null
  explanation_lift: number | null
```

- [x] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_flow.py::test_strategy_performance_reports_explanation_metrics -v && python -m pytest`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add backend/app/strategies.py frontend/src/types.ts backend/tests/test_flow.py
git commit -m "Report explanation lift alongside accuracy lift per strategy"
```

---

### Task 7: Frontend explanation gate

**Files:**
- Modify: `frontend/src/types.ts:290`
- Modify: `frontend/src/components.tsx:418-436`, `:655`, `:762-779`, `:792-796`

**Interfaces:**
- Consumes: `reasoning_min_chars` on the serialized session item (Task 2).
- Produces: nothing consumed downstream.

- [x] **Step 1: Add the field to the item type**

In `frontend/src/types.ts`, in the interface containing `requires_reasoning: boolean` (line 290):

```typescript
  requires_reasoning: boolean
  reasoning_min_chars: number
```

- [x] **Step 2: Read the floor in the component**

In `frontend/src/components.tsx`, beside the existing `requiresReasoning` declaration (line 418):

```typescript
  const requiresReasoning = Boolean(item?.requires_reasoning)
  const minChars = item?.reasoning_min_chars ?? 0
  const shortForm = session.practice_style === 'speedrun' || session.practice_style === 'infinite'
  const reasoningLength = reasoning.trim().length
  const reasoningComplete = !requiresReasoning || reasoningLength >= minChars
```

`reasoning` is declared on line 423, so place these lines after it.

- [x] **Step 3: Update the run header**

Replace line 655 of `frontend/src/components.tsx`:

```tsx
          <strong>{isInfinite ? 'Answer → explain → continue' : session.practice_style === 'review' ? 'Repair the questions you missed, in writing' : 'Answer and justify · full coaching unlocks when the run ends'}</strong>
```

- [x] **Step 4: Adapt the explanation box to the mode**

Replace lines 762-779 of `frontend/src/components.tsx`:

```tsx
          {!result && requiresReasoning && (
            <div className="reasoning-box">
              <div className="reasoning-heading">
                <label htmlFor="reasoning">{shortForm ? 'Why this answer' : 'Your case theory'} <b>Required</b></label>
                <span>{reasoningLength} / {minChars} characters</span>
              </div>
              <textarea
                id="reasoning"
                value={reasoning}
                disabled={strategyDecisionRequired}
                onChange={(event) => setReasoning(event.target.value)}
                placeholder={shortForm
                  ? 'One or two sentences: what in the text decided it…'
                  : 'Identify the conclusion, decisive evidence or logical relationship, and why your choice answers the exact question…'}
                rows={shortForm ? 3 : 5}
                maxLength={4000}
              />
              <p>Substance beats length. Generic or repeated explanations receive no meaningful payout.</p>
            </div>
          )}
```

- [x] **Step 5: Gate the submit button on the floor**

Replace the `disabled` expression on line 792 of `frontend/src/components.tsx`:

```tsx
              <button className="primary-button verdict-button" disabled={!selected || !reasoningComplete || strategyDecisionRequired || submit.isPending || pageTurning} onClick={() => {
```

And the button label on line 796 — replace `requiresReasoning ? 'Submit reasoning'` with a floor-aware hint:

```tsx
                {strategyDecisionRequired ? 'Pick Use it or Skip first' : submit.isPending || pageTurning ? 'Recording answer…' : !reasoningComplete ? `${minChars - reasoningLength} more characters` : <>{requiresReasoning ? 'Submit reasoning' : session.feedback_policy === 'delayed' ? 'Lock answer' : 'Check answer'} <Scale size={18} /></>}
```

- [x] **Step 6: Typecheck and build**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors.

- [x] **Step 7: Commit**

```bash
git add frontend/src/types.ts frontend/src/components.tsx
git commit -m "Ask for an explanation on every non-diagnostic question in the UI"
```

---

## Verification

- [x] **Full backend suite**

Run: `cd backend && python -m pytest`
Expected: PASS, with the new tests from Tasks 1–6 included.

- [x] **Frontend build**

Run: `cd frontend && npm run build`
Expected: success.

- [x] **Manual smoke**

Start a Speedrun. Confirm the explanation box appears, the button reads "N more characters" until 40 are typed, and the answer submits at 40. Start a Method Lab run and confirm the floor is 120.
