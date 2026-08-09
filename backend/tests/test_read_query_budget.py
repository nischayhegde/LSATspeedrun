"""The dashboard reads must cost a fixed number of statements, not one per answer.

Every panel on the dashboard summarises an account's whole history, so each of
these endpoints is one query away from being O(answers) in *round trips* rather
than in rows — and against RDS a round trip is the unit that costs. Three of them
had already crossed that line:

  * `GET /performance` reached a question's type through
    `attempt.session_item.question`, lazily, inside a loop. It survived only
    because a sibling eager load happened to warm the identity map first.
  * `focus.diagnostic_focus_detail` did the same thing over one form's answers —
    162 statements for a 77-item mega-litigation — and it is also on the path
    that serves every practice question.
  * `services.calculate_session_summary` did the same over one run's answers.

Timings cannot express that invariant: they vary with the machine, and this
machine runs several agents at once. A statement count is exact, reproducible,
and fails for the right reason. The budgets below are deliberately loose — the
point is that they do not scale with `ANSWERS`, so a regression shows up as a
count in the hundreds rather than as a number a few milliseconds larger.
"""

from __future__ import annotations

import pytest
from sqlalchemy import event

from app.extensions import db
from app.models import Attempt, SessionItem, StudySession, User, utcnow

from test_progress import add_question, app, create_game, login, stub_coaching  # noqa: F401

# Enough answers that a per-answer query is unmistakable in the count, and few
# enough that the fixture stays fast.
ANSWERS = 60

# Each endpoint's statement allowance. Every one of these is a constant number of
# queries regardless of history size; the headroom is for incidental reads (auth,
# the profile, the review queue) rather than for anything per-answer.
BUDGETS = {
    "/v1/performance": 20,
    "/v1/projection": 10,
    "/v1/trial": 10,
    "/v1/game": 30,
    "/v1/daily-docket": 20,
}


class Counter:
    """Records every statement issued against the engine while armed."""

    def __init__(self):
        self.statements: list[str] = []
        self.armed = False

    def install(self, engine):
        event.listen(engine, "before_cursor_execute", self._on)

    def _on(self, _conn, _cursor, statement, _params, _context, _many):
        if self.armed:
            self.statements.append(" ".join(statement.split()))

    def count(self, client, path: str) -> int:
        client.get(path)  # warm: first-touch compilation is not per-answer cost
        self.statements.clear()
        self.armed = True
        try:
            response = client.get(path)
        finally:
            self.armed = False
        assert response.status_code == 200, f"{path} -> {response.status_code}"
        return len(self.statements)

    @property
    def writes(self) -> list[str]:
        return [
            statement
            for statement in self.statements
            if statement.lstrip()[:6].upper() in {"INSERT", "UPDATE", "DELETE"}
        ]


@pytest.fixture()
def loaded_account(app):  # noqa: F811 - the shared fixture from test_progress
    """An account with a completed diagnostic and `ANSWERS` answers behind it."""
    from datetime import timedelta

    client = app.test_client()
    headers = login(client, "query-budget@example.test")
    create_game(client, headers)

    with app.app_context():
        user = User.query.filter_by(email="query-budget@example.test").one()
        # A *completed diagnostic* specifically: it is what `diagnostic_focus_detail`
        # and the readiness panel read, and it is the form whose per-answer loop was
        # the worst of the three.
        session = StudySession(
            user_id=user.id,
            mode="diagnostic",
            status="completed",
            target_minutes=70,
            total_items=ANSWERS,
            current_index=ANSWERS,
            completed_at=utcnow(),
        )
        db.session.add(session)
        db.session.flush()
        now = utcnow()
        for index in range(ANSWERS):
            section = "Reading Comprehension" if index % 4 == 3 else "Logical Reasoning"
            add_question(9_000 + index, section, "Assumption" if index % 3 else "Flaw")
            prefix = "rc" if section == "Reading Comprehension" else "lr"
            item = SessionItem(
                session_id=session.id,
                question_id=f"hf-lsat-{prefix}:progress-{9_000 + index}",
                position=index,
                target_time_seconds=150,
            )
            db.session.add(item)
            db.session.flush()
            db.session.add(
                Attempt(
                    user_id=user.id,
                    session_item_id=item.id,
                    idempotency_key=f"budget-{index}",
                    selected_label="C" if index % 3 else "A",
                    is_correct=bool(index % 3),
                    confidence=3,
                    evidence_class="diagnostic",
                    server_elapsed_ms=90_000,
                    created_at=now - timedelta(minutes=ANSWERS - index),
                )
            )
        db.session.commit()

        counter = Counter()
        counter.install(db.engine)

    return app, client, counter, headers


@pytest.mark.parametrize("path,budget", sorted(BUDGETS.items()))
def test_a_dashboard_read_costs_a_fixed_number_of_statements(loaded_account, path, budget):
    _app, client, counter, _headers = loaded_account
    issued = counter.count(client, path)
    assert issued <= budget, (
        f"{path} issued {issued} statements for an account with {ANSWERS} answers, "
        f"over its budget of {budget}. A count near or above {ANSWERS} means something "
        "is reaching through a relationship inside a loop — read the columns in the "
        "query instead (see scoring.attempt_facts)."
    )


def test_reading_the_firm_costs_one_write_and_not_several(loaded_account):
    """`GET /game` legitimately writes: office rent accrues in real time, so the
    read settles it. What it must not do is turn one row's worth of changes into
    several statements. The accrual used to land as two `UPDATE player_profiles`
    split around the reads it interleaved with, which is two round trips and two
    chances to contend for the row it holds a lock on.
    """
    _app, client, counter, _headers = loaded_account
    counter.count(client, "/v1/game")

    writes = counter.writes
    assert len(writes) <= 1, f"GET /game issued {len(writes)} writes: {writes}"
    if writes:
        assert writes[0].startswith("UPDATE player_profiles"), writes[0]


def test_starting_a_run_never_reads_the_text_of_a_question_it_did_not_choose(loaded_account):
    """Choosing eight questions must not load the whole bank.

    `select_random_questions` used to answer `Question.query.filter(source LIKE
    …).all()` and sort the result in Python. Every eligible question came back as
    a full ORM instance with its stimulus, its stem and its explanation attached —
    7,101 of them on the development bank — so that eight could be kept. That was
    480 ms of the 790 ms it took to press "start practice", and it grows with the
    question bank, which is the direction a question bank only ever moves.

    A statement count cannot express this, because the bug was a single statement
    that happened to return seven thousand wide rows. The shape of the SQL can:
    selection reads four scalar columns, and the only queries allowed to pull a
    question's *text* are the ones restricted to the ids that were chosen. If a
    wide read ever goes out unbounded again this fails, whatever it costs in
    milliseconds on the machine that runs it.
    """
    _app, client, counter, headers = loaded_account

    # A twenty-question run, so that "one query per chosen question" would be
    # unmistakable in the count below rather than lost in the fixed overhead.
    client.post("/v1/study-sessions", json={"size": 4}, headers=headers)  # warm
    counter.statements.clear()
    counter.armed = True
    try:
        response = client.post("/v1/study-sessions", json={"size": 20}, headers=headers)
    finally:
        counter.armed = False
    assert response.status_code in (200, 201), response.get_data(as_text=True)[:300]

    wide = [
        statement
        for statement in counter.statements
        if "questions.stimulus" in statement and "questions.id IN" not in statement and "questions.id = ?" not in statement
    ]
    assert not wide, (
        "starting a run read whole question rows without restricting to the questions "
        f"it chose:\n  " + "\n  ".join(statement[:200] for statement in wide)
    )

    questions_read = [statement for statement in counter.statements if " FROM questions" in statement]
    assert len(questions_read) <= 10, (
        f"starting a 20-question run issued {len(questions_read)} queries against questions, "
        "which is the shape of one read per question rather than one for the run: "
        + "; ".join(statement[:120] for statement in questions_read)
    )


def test_the_focus_read_does_not_scale_with_the_form_it_reads(loaded_account):
    """`diagnostic_focus_detail` is also on the question-serving path, so its own
    budget is asserted directly rather than only through `/performance`."""
    application, _client, counter, _headers = loaded_account
    from app.focus import diagnostic_focus_detail

    with application.app_context():
        user = User.query.filter_by(email="query-budget@example.test").one()
        counter.statements.clear()
        counter.armed = True
        try:
            detail = diagnostic_focus_detail(user.id)
        finally:
            counter.armed = False

    assert detail["session_id"] is not None, "the fixture's completed diagnostic was not found"
    # One statement to find the form, one to read its answers' types.
    assert len(counter.statements) == 2, counter.statements
