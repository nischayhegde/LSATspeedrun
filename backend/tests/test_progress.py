"""Progress tracking: attempt history, projected score, and review scheduling."""

from __future__ import annotations

from collections import defaultdict

import pytest

from app import create_app
from app.extensions import db
from app.models import Passage, Question, QuestionChoice
from app.seed import SOURCE_PREFIX


def add_question(index: int, section: str, question_type: str = "Inference") -> None:
    prefix = "lr" if section == "Logical Reasoning" else "rc"
    question_id = f"hf-lsat-{prefix}:progress-{index}"
    passage_id = None
    stimulus = f"Argument stimulus {index}."
    if section == "Reading Comprehension":
        passage_id = f"progress-passage-{index // 2}"
        if not db.session.get(Passage, passage_id):
            db.session.add(
                Passage(
                    id=passage_id,
                    canonical_text=f"Reading passage {index // 2}. Long enough to read like a real passage.",
                    passage_type="Reading Comprehension",
                    source=f"{SOURCE_PREFIX}rc",
                    review_status="published",
                )
            )
        stimulus = None
    db.session.add(
        Question(
            id=question_id,
            passage_id=passage_id,
            section=section,
            question_type=question_type,
            difficulty=3,
            stimulus=stimulus,
            stem=f"Which answer is best for progress question {index}?",
            correct_answer="C",
            source=f"{SOURCE_PREFIX}{prefix} · train",
            license_status="upstream_terms_apply",
            review_status="published",
        )
    )
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"{question_id}-{label}",
                question_id=question_id,
                label=label,
                canonical_text=f"Answer {label} for progress question {index}",
                position=position,
            )
        )


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "PRACTICE_SESSION_SIZE": 4,
            "TFY_URL": "",
            "TFY_API_KEY": "",
            "AI_JOBS_MODE": "sync",
            # History and projection maths, not strategy gates. Enforcement has
            # its own module and runs there at the production default.
            "STRATEGY_ENFORCEMENT_ENABLED": False,
        }
    )
    with application.app_context():
        for index in range(20):
            add_question(index, "Logical Reasoning", "Assumption" if index % 2 else "Flaw")
        for index in range(20, 30):
            add_question(index, "Reading Comprehension", "Main Point")
        db.session.commit()
    return application


def login(client, email: str = "progress@example.test") -> dict[str, str]:
    response = client.post("/v1/auth/dev", json={"email": email, "display_name": "Progress Student"})
    assert response.status_code == 200
    csrf = client.get_cookie("lsat_csrf")
    assert csrf
    return {"X-CSRF-Token": csrf.value}


def create_game(client, headers):
    response = client.post(
        "/v1/game/profile",
        json={"lawyer_name": "Ada Rowan", "firm_name": "Rowan Legal", "character_gender": "female"},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json["game"]


def explanation(marker: str) -> str:
    """A gradable explanation over the 120-character floor, unique per marker.

    Uniqueness matters: `game._is_reused_reasoning` forces an Invalid band when
    an account repeats itself, which would silently change what a test settles.
    """
    return (
        f"The conclusion turns on the link {marker} makes explicit, and the credited choice "
        "supplies exactly that connection while every other option widens the scope or swaps "
        "a term the argument actually needs."
    )


@pytest.fixture(autouse=True)
def stub_coaching(monkeypatch):
    """Grade every explanation deterministically instead of calling a provider.

    `/debrief/acknowledge` refuses to advance a run until the visible attempt
    has settled, and settlement waits on the explanation grade — so any test
    that answers more than one question has to coach each answer.
    """
    grade = {"value": 80}

    monkeypatch.setattr(
        "app.services.generate_attempt_coaching",
        lambda _attempt: (
            {
                "explanation_grade": grade["value"],
                "reasoning_verdict": "strong",
                "reasoning_summary": "The decisive inference was identified.",
                "model": "test-model",
            },
            {},
        ),
    )
    return grade


def run_session(
    app,
    client,
    headers,
    marker: str,
    *,
    size: int = 4,
    correct: int = 2,
    confidence: int = 3,
) -> str:
    """Play one practice run to completion, getting `correct` questions right."""
    from app.models import Attempt
    from app.services import run_attempt_coaching

    session = client.post("/v1/study-sessions", json={"size": size}, headers=headers).json["session"]
    session_id = session["id"]
    for position in range(size):
        current = client.get(f"/v1/study-sessions/{session_id}", headers=headers).json["session"]
        item = current.get("current_item")
        if not item:
            break
        answered = client.post(
            f"/v1/study-sessions/{session_id}/attempts",
            json={
                "item_id": item["id"],
                "selected_label": "C" if position < correct else "A",
                "strategy_applied": True,
                "confidence": confidence,
                "reasoning": explanation(f"{marker}-{position}"),
            },
            headers={**headers, "Idempotency-Key": f"{marker}-{position}"},
        )
        assert answered.status_code == 200, answered.json
        with app.app_context():
            run_attempt_coaching(db.session.get(Attempt, answered.json["result"]["attempt_id"]))
        client.post(f"/v1/study-sessions/{session_id}/debrief/acknowledge", headers=headers)
    return session_id


# ---------------------------------------------------------------------------
# 1. Attempt history
# ---------------------------------------------------------------------------


def test_past_sessions_are_listable_with_their_counts(app):
    client = app.test_client()
    headers = login(client, "history-sessions@example.test")
    create_game(client, headers)
    first = run_session(app, client, headers, "hist-a", size=4, correct=3)
    second = run_session(app, client, headers, "hist-b", size=4, correct=1)

    response = client.get("/v1/history/sessions", headers=headers)
    assert response.status_code == 200
    body = response.json
    assert body["total"] == 2
    assert [row["id"] for row in body["sessions"]] == [second, first]
    newest = body["sessions"][0]
    assert newest["answered"] == 4
    assert newest["correct"] == 1
    assert newest["accuracy"] == 25
    assert newest["reviewable"] is True
    assert body["has_more"] is False


def test_session_history_paginates(app):
    client = app.test_client()
    headers = login(client, "history-page@example.test")
    create_game(client, headers)
    for index in range(3):
        run_session(app, client, headers, f"page-{index}", size=2, correct=1)

    first_page = client.get("/v1/history/sessions?limit=2", headers=headers).json
    assert len(first_page["sessions"]) == 2
    assert first_page["total"] == 3
    assert first_page["has_more"] is True

    second_page = client.get("/v1/history/sessions?limit=2&offset=2", headers=headers).json
    assert len(second_page["sessions"]) == 1
    assert second_page["has_more"] is False
    assert {row["id"] for row in first_page["sessions"]} & {row["id"] for row in second_page["sessions"]} == set()


def test_previously_answered_questions_are_browsable_and_filterable(app):
    client = app.test_client()
    headers = login(client, "history-attempts@example.test")
    create_game(client, headers)
    session_id = run_session(app, client, headers, "browse", size=4, correct=2)

    everything = client.get("/v1/history/attempts", headers=headers).json
    assert everything["total"] == 4
    assert len(everything["attempts"]) == 4
    row = everything["attempts"][0]
    assert {"attempt_id", "question_type", "is_correct", "selected_label", "correct_label"} <= set(row)
    assert row["target_time_seconds"] > 0
    assert row["pace_ratio"] is not None

    misses = client.get("/v1/history/attempts?correct=false", headers=headers).json
    assert misses["total"] == 2
    assert all(not attempt["is_correct"] for attempt in misses["attempts"])
    assert misses["filters"]["correct"] is False

    scoped = client.get(f"/v1/history/attempts?session_id={session_id}", headers=headers).json
    assert scoped["total"] == 4

    by_type = client.get("/v1/history/attempts?question_type=Assumption", headers=headers).json
    assert all(attempt["question_type"] == "Assumption" for attempt in by_type["attempts"])

    empty = client.get("/v1/history/attempts?question_type=Nonexistent", headers=headers).json
    assert empty["total"] == 0
    assert empty["attempts"] == []


def test_attempt_history_pagination_and_detail_payload(app):
    client = app.test_client()
    headers = login(client, "history-detail@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "detail", size=4, correct=2)

    page = client.get("/v1/history/attempts?limit=2", headers=headers).json
    assert len(page["attempts"]) == 2
    assert page["has_more"] is True
    assert page["total"] == 4

    detailed = client.get("/v1/history/attempts?limit=2&detail=1", headers=headers).json
    first = detailed["attempts"][0]
    assert first["question"]["stem"]
    assert len(first["question"]["choices"]) == 5
    assert first["reasoning_text"]
    assert "feedback" in first

    single = client.get(f"/v1/history/attempts/{first['attempt_id']}", headers=headers).json["attempt"]
    assert single["attempt_id"] == first["attempt_id"]
    assert single["question"]["stem"] == first["question"]["stem"]
    assert single["correct_label"] == "C"

    # An oversized page is clamped rather than honoured.
    clamped = client.get("/v1/history/attempts?limit=9999", headers=headers).json
    assert clamped["limit"] == 200
    clamped_detail = client.get("/v1/history/attempts?limit=9999&detail=1", headers=headers).json
    assert clamped_detail["limit"] == 25


def test_attempt_history_is_scoped_to_the_account(app):
    client = app.test_client()
    owner = login(client, "history-owner@example.test")
    create_game(client, owner)
    run_session(app, client, owner, "owned", size=2, correct=1)
    mine = client.get("/v1/history/attempts", headers=owner).json
    attempt_id = mine["attempts"][0]["attempt_id"]

    other_client = app.test_client()
    stranger = login(other_client, "history-stranger@example.test")
    create_game(other_client, stranger)
    assert other_client.get("/v1/history/attempts", headers=stranger).json["total"] == 0
    assert other_client.get(f"/v1/history/attempts/{attempt_id}", headers=stranger).status_code == 404


def test_history_facets_describe_only_what_the_account_has_seen(app):
    client = app.test_client()
    headers = login(client, "history-facets@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "facets", size=4, correct=3)

    facets = client.get("/v1/history/facets", headers=headers).json
    assert facets["attempts"] == 4
    assert facets["correct"] == 3
    assert facets["incorrect"] == 1
    assert facets["question_types"]
    assert sum(row["attempts"] for row in facets["question_types"]) == 4
    assert facets["first_attempt_at"] and facets["last_attempt_at"]


def test_history_endpoints_do_not_scale_queries_with_page_size(app):
    """A wide page must not mean one extra round trip per row.

    `/performance` has already had an N+1 regression fixed once. The browse
    endpoint reads `attempt.session_item.question` on every row and, in detail
    mode, that question's choices and passage too — all of which are lazy by
    default. This pins the query count so a later refactor that drops the
    eager loaders fails here instead of in production.
    """
    from sqlalchemy import event

    client = app.test_client()
    headers = login(client, "history-queries@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "nplusone-a", size=4, correct=2)
    run_session(app, client, headers, "nplusone-b", size=4, correct=2)

    statements: list[str] = []

    with app.app_context():
        engine = db.engine

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        statements.clear()
        client.get("/v1/history/attempts?limit=8", headers=headers)
        compact_queries = len(statements)
        statements.clear()
        client.get("/v1/history/attempts?limit=8&detail=1", headers=headers)
        detail_queries = len(statements)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    # Auth lookups plus a count and a page. The ceiling is loose enough to
    # survive an extra bookkeeping query and tight enough that 8 rows each
    # fetching their own question (or choices) would blow straight through it.
    assert compact_queries <= 10, statements
    assert detail_queries <= 14, statements


# ---------------------------------------------------------------------------
# 2. Projected score
# ---------------------------------------------------------------------------


def test_the_conversion_table_matches_the_published_lsac_scale(app):
    """Spot-checks against the median of 59 published LSAC charts.

    These are the anchors quoted in the module docstring: the modern form is 77
    scored items, a 160 costs 58 of them and a 150 costs 44, and the scale floors
    at 120 rather than running down to zero.
    """
    from app.scoring import FORM_ITEMS, RAW_TO_SCALED, scaled_from_raw

    assert FORM_ITEMS == 77
    assert RAW_TO_SCALED[77] == 180
    assert RAW_TO_SCALED[69] == 170
    assert RAW_TO_SCALED[57] == 160
    assert RAW_TO_SCALED[44] == 150
    assert RAW_TO_SCALED[0] == 120
    # Monotone, as an equated conversion must be.
    assert all(b >= a for a, b in zip(RAW_TO_SCALED, RAW_TO_SCALED[1:]))
    # Fractional raws interpolate between the steps rather than jumping.
    assert RAW_TO_SCALED[68] <= scaled_from_raw(68.5) <= RAW_TO_SCALED[69]


def test_the_conversion_table_agrees_with_the_pre_2024_charts_in_proportion(app):
    """The two eras are different forms but must describe the same test.

    The 94-form pre-2024 dataset and the 59-form modern one were transcribed by
    different people from different charts a decade apart. Converted to
    proportion-correct they agree to within two points at every score level,
    which is the strongest available evidence that neither is garbled — several
    circulating third-party tables fail exactly this check.
    """
    from app.scoring import FORM_ITEMS, RAW_TO_SCALED

    old_format_proportion = {180: 0.980, 170: 0.881, 160: 0.733, 150: 0.554, 140: 0.386}
    for scaled, expected in old_format_proportion.items():
        lowest_raw = next(raw for raw, value in enumerate(RAW_TO_SCALED) if value >= scaled)
        assert abs(lowest_raw / FORM_ITEMS - expected) < 0.02, scaled


def test_percentiles_come_from_the_published_lsac_table(app):
    from app.scoring import percentile_for

    assert percentile_for(170) == 94.48
    assert percentile_for(154) == 50.43
    assert percentile_for(150) == 36.56
    assert percentile_for(180) == 99.85


def test_a_projection_is_a_band_and_it_narrows_as_evidence_accumulates(app):
    """Four answers must not produce the same confidence as forty.

    The point estimate is held fixed at 50% accuracy in both arms so the only
    thing that can move the width is the sample size.
    """
    from app.models import User
    from app.scoring import project_score

    client = app.test_client()
    headers = login(client, "projection-band@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "band-a", size=4, correct=2)

    with app.app_context():
        user = User.query.filter_by(email="projection-band@example.test").one()
        thin = project_score(user)
        assert thin["available"] is True
        assert 120 <= thin["lower_bound"] <= thin["scaled_score"] <= thin["upper_bound"] <= 180
        assert thin["evidence_grade"] == "baseline"
        # Every published term is present and the total is their quadrature sum.
        terms = thin["uncertainty"]
        assert terms["lsat_sem"] == 2.6
        assert terms["total"] >= terms["lsat_sem"]

    for index in range(6):
        run_session(app, client, headers, f"band-b{index}", size=4, correct=2)

    with app.app_context():
        user = User.query.filter_by(email="projection-band@example.test").one()
        thick = project_score(user)
        assert thick["observed_attempts"] > thin["observed_attempts"]
        assert thick["effective_sample"] > thin["effective_sample"]
        assert thick["uncertainty"]["sampling"] < thin["uncertainty"]["sampling"]
        assert (thick["upper_bound"] - thick["lower_bound"]) <= (thin["upper_bound"] - thin["lower_bound"])
        # The band never collapses to a point: LSAC's own SEM is a floor.
        assert thick["upper_bound"] > thick["lower_bound"]


def test_a_projection_reweights_the_practice_mix_to_the_form_mix(app):
    """Practising only LR must not be scored as if the form were all LR.

    With no RC evidence at all the RC rate is borrowed from LR, and the band
    widens by the missing-section allowance to say so out loud.
    """
    from app.models import User
    from app.scoring import MISSING_SECTION_SD, project_score

    client = app.test_client()
    headers = login(client, "projection-mix@example.test")
    create_game(client, headers)
    for index in range(3):
        session = client.post(
            "/v1/study-sessions",
            json={"size": 2, "question_type": "Flaw"},
            headers=headers,
        ).json["session"]
        for position in range(2):
            current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
            item = current.get("current_item")
            if not item:
                break
            client.post(
                f"/v1/study-sessions/{session['id']}/attempts",
                json={
                    "item_id": item["id"],
                    "selected_label": "C",
                    "strategy_applied": True,
                    "confidence": 3,
                    "reasoning": explanation(f"mix-{index}-{position}"),
                },
                headers={**headers, "Idempotency-Key": f"mix-{index}-{position}"},
            )
            client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)

    with app.app_context():
        user = User.query.filter_by(email="projection-mix@example.test").one()
        projection = project_score(user)
        assert projection["rc_attempts"] == 0
        assert projection["missing_sections"] == ["Reading Comprehension"]
        assert projection["uncertainty"]["missing_section"] == MISSING_SECTION_SD
        # Borrowed, not zeroed: a student who never touched RC is not scored
        # as if they had missed all 25 RC items.
        assert projection["rc_accuracy"] == projection["lr_accuracy"]


def test_coached_practice_is_weaker_evidence_than_a_sat_diagnostic(app):
    """`evidence_class` has to move the band, not just sit in a column."""
    from app.models import Attempt, User
    from app.scoring import project_score

    client = app.test_client()
    headers = login(client, "projection-evidence@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "evidence", size=4, correct=2)

    with app.app_context():
        user = User.query.filter_by(email="projection-evidence@example.test").one()
        coached = project_score(user)
        assert all(
            attempt.evidence_class == "coached_practice"
            for attempt in Attempt.query.filter_by(user_id=user.id).all()
        )
        for attempt in Attempt.query.filter_by(user_id=user.id).all():
            attempt.evidence_class = "diagnostic"
        db.session.commit()
        sat = project_score(user)

    # Same answers, so the *observed* rate is identical. The estimate itself is
    # not: a diagnostic answer is stronger evidence, so it is shrunk less toward
    # the population prior than a coached one is.
    assert sat["observed_accuracy"] == coached["observed_accuracy"]
    assert sat["effective_sample"] > coached["effective_sample"]
    assert (sat["upper_bound"] - sat["lower_bound"]) <= (coached["upper_bound"] - coached["lower_bound"])


def test_old_attempts_count_for_less_than_recent_ones(app):
    from datetime import timedelta

    from app.models import Attempt, User, utcnow
    from app.scoring import project_score

    client = app.test_client()
    headers = login(client, "projection-recency@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "recency", size=4, correct=4)

    with app.app_context():
        user = User.query.filter_by(email="projection-recency@example.test").one()
        fresh = project_score(user)
        for attempt in Attempt.query.filter_by(user_id=user.id).all():
            attempt.created_at = utcnow() - timedelta(days=120)
        db.session.commit()
        stale = project_score(user)

    # Same answers, same observed accuracy — but four-month-old work carries a
    # fraction of the weight, so the effective sample collapses, the band widens,
    # and the estimate falls further back toward the population prior.
    assert stale["observed_accuracy"] == fresh["observed_accuracy"]
    assert stale["effective_sample"] < fresh["effective_sample"]
    assert stale["estimated_accuracy"] < fresh["estimated_accuracy"]
    assert (stale["upper_bound"] - stale["lower_bound"]) >= (fresh["upper_bound"] - fresh["lower_bound"])


def test_no_attempts_yields_an_honest_refusal_rather_than_a_number(app):
    from app.models import User
    from app.scoring import project_score

    client = app.test_client()
    headers = login(client, "projection-empty@example.test")
    create_game(client, headers)
    with app.app_context():
        user = User.query.filter_by(email="projection-empty@example.test").one()
        projection = project_score(user)
    assert projection["available"] is False
    assert projection["reason"] == "no_evidence"
    assert "scaled_score" not in projection


def test_projection_snapshots_are_persisted_for_the_trend_without_duplicating(app):
    from app.models import ScoreProjection, User
    from app.scoring import projection_snapshot

    client = app.test_client()
    headers = login(client, "projection-trend@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "trend", size=4, correct=2)

    with app.app_context():
        user = User.query.filter_by(email="projection-trend@example.test").one()
        first = projection_snapshot(user)
        assert first["history"]
        assert ScoreProjection.query.filter_by(user_id=user.id).count() == 1
        # A dashboard refresh minutes later must not plot a second identical point.
        projection_snapshot(user)
        assert ScoreProjection.query.filter_by(user_id=user.id).count() == 1


_HISTORY_OFFSET = [1_000]


def write_history(user, total: int, correct) -> list:
    """Write `total` attempts straight to the database and read them back as the
    flat rows the projection consumes, oldest first.

    Deliberately bypasses the HTTP flow. A prefix sweep needs hundreds of
    answers on hundreds of *distinct* questions — only a first attempt per
    question is evidence — and playing that through the API would take minutes
    to assert something about arithmetic.

    Reading back through `attempt_facts` rather than returning mapped `Attempt`
    rows is what `project_score` is actually handed in production, so the sweep
    below exercises the real query as well as the arithmetic.
    """
    from datetime import timedelta

    from app.models import Attempt, SessionItem, StudySession, utcnow
    from app.scoring import attempt_facts

    session = StudySession(
        user_id=user.id,
        mode="practice",
        practice_style="cases",
        target_minutes=35,
        total_items=total,
    )
    db.session.add(session)
    db.session.flush()
    # Every call gets its own slice of the question-id space, so two accounts in
    # one test never collide on a seeded question.
    offset = _HISTORY_OFFSET[0]
    _HISTORY_OFFSET[0] += 10_000
    now = utcnow()
    for index in range(total):
        # One RC answer in every four, and the first answer is LR, so the sweep
        # passes through the missing-section case on its way out of it.
        section = "Reading Comprehension" if index % 4 == 3 else "Logical Reasoning"
        add_question(offset + index, section)
        item = SessionItem(
            session_id=session.id,
            question_id=f"hf-lsat-{'rc' if section == 'Reading Comprehension' else 'lr'}:progress-{offset + index}",
            position=index,
            target_time_seconds=150,
        )
        db.session.add(item)
        db.session.flush()
        db.session.add(
            Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"sweep-{offset}-{index}",
                selected_label="C" if correct(index) else "A",
                is_correct=correct(index),
                confidence=3,
                evidence_class="coached_practice",
                server_elapsed_ms=120_000,
                created_at=now - timedelta(days=60 * (total - index) / total),
            )
        )
    db.session.commit()
    return attempt_facts(user.id)


@pytest.mark.parametrize(
    "name,correct",
    [
        ("mixed", lambda index: index % 3 != 0),
        ("every answer correct", lambda index: True),
        ("every answer wrong", lambda index: False),
    ],
)
def test_the_band_never_widens_as_evidence_accumulates(app, name, correct):
    """The band width must be non-increasing across a prefix sweep, always.

    Before shrinkage and a symmetric interval this failed badly: replaying a
    real 640-attempt history prefix by prefix gave widths of 22 at n=1, 44 at
    n=2, 31 at n=5, 14 at n=20 and 18 at n=30 — a student could do thirty
    questions of honest work and watch the app get *less* sure of them.

    The two adversarial arms matter as much as the mixed one. All-correct walks
    the estimate into the 180 ceiling and all-wrong into the 120 floor, which is
    where a band that has to be clipped to the scale could otherwise start
    growing again as the estimate moves back off the boundary.
    """
    from app.models import User, utcnow
    from app.scoring import project_score

    client = app.test_client()
    email = f"projection-sweep-{name.replace(' ', '-')}@example.test"
    headers = login(client, email)
    create_game(client, headers)

    with app.app_context():
        user = User.query.filter_by(email=email).one()
        attempts = write_history(user, 160, correct)
        now = utcnow()
        widths = []
        for size in range(1, len(attempts) + 1):
            projection = project_score(user, attempts=attempts[:size], now=now)
            assert projection["available"] is True
            # The reported number is the midpoint of the reported band. Exactly.
            assert projection["lower_bound"] + projection["upper_bound"] == 2 * projection["scaled_score"]
            assert 120 <= projection["lower_bound"] <= projection["upper_bound"] <= 180
            widths.append(projection["upper_bound"] - projection["lower_bound"])

    assert widths == sorted(widths, reverse=True), name
    assert widths[-1] < widths[0], "160 answers must buy a narrower band than one"


def test_one_answer_can_never_be_shown_a_perfect_score(app):
    """A single correct answer is not a 180 at the 99.85th percentile.

    It used to be exactly that: one right answer meant 100% accuracy, a raw 77,
    and a headline claiming the top of the scale. The estimate is shrunk toward
    the population median instead, and the shrinkage is symmetric — one *wrong*
    answer is not a 120 either, because "we have one data point" says nothing
    about the student in either direction.
    """
    from app.models import User, utcnow
    from app.scoring import PRIOR_SCALED, project_score

    client = app.test_client()
    projections = {}
    for label, correct in (("right", lambda index: True), ("wrong", lambda index: False)):
        email = f"projection-single-{label}@example.test"
        headers = login(client, email)
        create_game(client, headers)
        with app.app_context():
            user = User.query.filter_by(email=email).one()
            attempts = write_history(user, 1, correct)
            projections[label] = project_score(user, attempts=attempts, now=utcnow())

    for label, projection in projections.items():
        assert projection["scaled_score"] < 180, label
        assert projection["scaled_score"] > 120, label
        assert abs(projection["scaled_score"] - PRIOR_SCALED) <= 3, label
        assert projection["percentile"] < 99, label
        assert projection["evidence_grade"] == "baseline", label
        # And the band is still a band, not a point.
        assert projection["upper_bound"] > projection["lower_bound"], label
    # One right answer still beats one wrong answer — the prior dominates, it
    # does not erase the evidence.
    assert projections["right"]["scaled_score"] > projections["wrong"]["scaled_score"]


def test_the_projection_endpoint_neither_walks_the_history_nor_writes_to_it(app):
    """`GET /projection` is a constant number of queries and zero writes.

    Two separate defects met here. `project_score` read
    `attempt.session_item.question.section` with nothing eager-loaded, which is
    two statements per attempt — 2,100 statements and 308ms for one dashboard
    load on a 1,099-attempt account, every one of them a network round trip
    against RDS. And the endpoint defaulted to `record=True`, so a plain GET
    opened a write transaction and committed a snapshot row.
    """
    from sqlalchemy import event

    from app.models import ScoreProjection, User

    client = app.test_client()
    headers = login(client, "projection-queries@example.test")
    create_game(client, headers)
    with app.app_context():
        user = User.query.filter_by(email="projection-queries@example.test").one()
        write_history(user, 120, lambda index: index % 2 == 0)
        engine = db.engine

    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        statements.clear()
        response = client.get("/v1/projection", headers=headers)
        query_count = len(statements)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert response.status_code == 200
    assert response.json["projection"]["observed_attempts"] == 120
    # Auth, the attempt page, the snapshot history, the account row. 120 attempts
    # each fetching their own session item and question would be 240 more.
    assert query_count <= 12, statements
    assert not any(statement.lstrip().upper().startswith(("INSERT", "UPDATE")) for statement in statements), statements

    with app.app_context():
        user = User.query.filter_by(email="projection-queries@example.test").one()
        assert ScoreProjection.query.filter_by(user_id=user.id).count() == 0
        # Asking for it explicitly still works, for a caller that means it.
    assert client.get("/v1/projection?record=1", headers=headers).status_code == 200
    with app.app_context():
        user = User.query.filter_by(email="projection-queries@example.test").one()
        assert ScoreProjection.query.filter_by(user_id=user.id).count() == 1


def test_finishing_a_run_is_what_writes_a_snapshot(app):
    """The trend line gains points where the evidence changes, not where it is read."""
    from app.models import ScoreProjection, User

    client = app.test_client()
    headers = login(client, "projection-onfinish@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "onfinish", size=4, correct=2)

    with app.app_context():
        user = User.query.filter_by(email="projection-onfinish@example.test").one()
        assert ScoreProjection.query.filter_by(user_id=user.id).count() == 1

    # And a dashboard refresh does not add another.
    client.get("/v1/performance", headers=headers)
    client.get("/v1/projection", headers=headers)
    with app.app_context():
        user = User.query.filter_by(email="projection-onfinish@example.test").one()
        assert ScoreProjection.query.filter_by(user_id=user.id).count() == 1


def test_the_performance_endpoint_carries_the_projection(app):
    client = app.test_client()
    headers = login(client, "projection-endpoint@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "endpoint", size=4, correct=3)

    performance = client.get("/v1/performance", headers=headers).json["performance"]
    projection = performance["projection"]
    assert projection["available"] is True
    assert 120 <= projection["scaled_score"] <= 180
    assert "LSAC conversion charts" in projection["method"]["conversion_table"]

    standalone = client.get("/v1/projection", headers=headers)
    assert standalone.status_code == 200
    assert standalone.json["projection"]["scaled_score"] == projection["scaled_score"]


# ---------------------------------------------------------------------------
# 3. Question selection: fixed form length, intact passages
# ---------------------------------------------------------------------------


def test_the_mega_litigation_form_is_exactly_the_length_it_says(app):
    """One number of questions, every time, with no passage cut in half.

    The RC loop used to test `len(selected_rc) >= rc_target` *before* extending
    by a whole passage group, so the last passage always overshot and the
    negative remainder clamped to zero. A nominally 75-item form came out at 76,
    77, 78, 79, 80, 81 or 82 depending on how the passage sizes landed — and the
    projected score converts against a fixed reference form while the practice
    panel promises the player the previous run's count.
    """
    import random as random_module

    from app.services import select_diagnostic_questions

    with app.app_context():
        passage_sizes: dict[str, int] = defaultdict(int)
        for question in Question.query.all():
            if question.passage_id:
                passage_sizes[question.passage_id] += 1

        for seed in range(30):
            random_module.seed(seed)
            for requested in (12, 20, 24):
                questions, section_indexes, plan = select_diagnostic_questions(requested)
                assert len(questions) == requested, (seed, requested)
                assert len(section_indexes) == len(questions)
                assert sum(block["questions"] for block in plan) == requested
                assert len({question.id for question in questions}) == requested

                # No passage is ever partially included, and its questions are
                # contiguous so the student reads it once.
                positions: dict[str, list[int]] = defaultdict(list)
                for position, question in enumerate(questions):
                    if question.passage_id:
                        positions[question.passage_id].append(position)
                for passage_id, found in positions.items():
                    assert len(found) == passage_sizes[passage_id], (seed, requested, passage_id)
                    assert found == list(range(found[0], found[0] + len(found)))


def test_the_form_size_default_matches_the_scoring_reference_form(monkeypatch):
    """Two constants describing one thing have to be the same constant.

    The form was 75 items and the conversion table it is scored against is a
    77-item form — a quiet two-item handicap. The environment's own values are
    stripped for this check because a local `.env` may deliberately be running a
    short form, which is an explicit choice and warns at startup.
    """
    from app import create_app
    from app.scoring import FORM_ITEMS, FORM_LR_ITEMS, FORM_RC_ITEMS

    assert FORM_LR_ITEMS + FORM_RC_ITEMS == FORM_ITEMS
    monkeypatch.setattr("app.load_dotenv", lambda *args, **kwargs: None)
    monkeypatch.delenv("DIAGNOSTIC_SESSION_SIZE", raising=False)
    monkeypatch.delenv("DIAGNOSTIC_SIZE", raising=False)
    default_app = create_app(
        {"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:", "AUTO_SEED": False}
    )
    assert default_app.config["DIAGNOSTIC_SESSION_SIZE"] == FORM_ITEMS


def test_practice_never_serves_a_lone_reading_comprehension_question(app):
    """A student must never be handed one question that needs a whole passage.

    The mega-litigation path always kept passages intact; the practice path did
    not, so a run could serve question 3 of a passage on its own. That inflates
    the session's real length and corrupts the pace metrics the same session
    records, because the target times assume the first question on a passage
    pays for the reading and the rest do not.
    """
    import random as random_module

    from app.services import select_random_questions

    with app.app_context():
        passage_sizes: dict[str, int] = defaultdict(int)
        for question in Question.query.all():
            if question.passage_id:
                passage_sizes[question.passage_id] += 1

        seen_a_passage = False
        for seed in range(20):
            random_module.seed(seed)
            for requested in (4, 6, 10):
                selected = select_random_questions(requested)
                assert len(selected) == requested, (seed, requested)
                grouped: dict[str, int] = defaultdict(int)
                for question in selected:
                    if question.passage_id:
                        grouped[question.passage_id] += 1
                for passage_id, count in grouped.items():
                    seen_a_passage = True
                    assert count == passage_sizes[passage_id], (seed, requested, passage_id)
        assert seen_a_passage, "the sweep never picked a passage, so it proved nothing"


def test_a_practice_run_serves_passage_mates_back_to_back(app):
    """Intact is not enough — the questions have to arrive together."""
    from app.models import SessionItem

    client = app.test_client()
    headers = login(client, "practice-passage-order@example.test")
    create_game(client, headers)

    found_a_passage = False
    for index in range(6):
        session = client.post("/v1/study-sessions", json={"size": 6}, headers=headers).json["session"]
        with app.app_context():
            items = (
                SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
            )
            positions: dict[str, list[int]] = defaultdict(list)
            for item in items:
                if item.question.passage_id:
                    positions[item.question.passage_id].append(item.position)
            for found in positions.values():
                found_a_passage = True
                assert found == list(range(found[0], found[0] + len(found)))
            # And the pace targets follow: only the first question on a passage
            # is charged for reading it.
            for item in items:
                assert item.target_time_seconds in {135, 150, 330}
    assert found_a_passage


def test_due_review_passage_mates_are_brought_together(app):
    """Two due questions on one passage should cost one reading, not two.

    Passage-mates that are *not* due are deliberately left out — see
    `cluster_passage_mates`.
    """
    from app.scheduling import cluster_passage_mates

    class Item:
        def __init__(self, name, passage_id=None):
            self.name = name
            self.passage_id = passage_id

        def __repr__(self):
            return self.name

    ranked = [Item("rc-a1", "p1"), Item("lr1"), Item("rc-b1", "p2"), Item("rc-a2", "p1"), Item("lr2")]
    clustered = [item.name for item in cluster_passage_mates(ranked)]
    assert clustered == ["rc-a1", "rc-a2", "lr1", "rc-b1", "lr2"]
    assert cluster_passage_mates([]) == []


# ---------------------------------------------------------------------------
# 4. History endpoints: malformed input is a client bug, not a default
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "query,parameter",
    [
        ("limit=abc", "limit"),
        ("limit=1.5", "limit"),
        ("offset=twenty", "offset"),
        ("since=not-a-date", "since"),
        ("until=2026-13-45", "until"),
        ("correct=maybe", "correct"),
        ("from_review_queue=sometimes", "from_review_queue"),
        ("detail=perhaps", "detail"),
    ],
)
def test_malformed_history_parameters_are_rejected_rather_than_defaulted(app, query, parameter):
    """`limit=abc` returning 200 with 50 rows hides the bug that produced it."""
    client = app.test_client()
    headers = login(client, "history-invalid@example.test")
    create_game(client, headers)

    response = client.get(f"/v1/history/attempts?{query}", headers=headers)
    assert response.status_code == 400, response.json
    assert response.json["error"]["code"] == "invalid_parameter"
    assert parameter in response.json["error"]["message"]


def test_session_history_also_refuses_nonsense_pagination(app):
    client = app.test_client()
    headers = login(client, "history-invalid-sessions@example.test")
    create_game(client, headers)

    assert client.get("/v1/history/sessions?limit=abc", headers=headers).status_code == 400
    assert client.get("/v1/history/sessions?offset=lots", headers=headers).status_code == 400


def test_well_formed_but_out_of_range_pagination_is_still_clamped(app):
    """A coherent ask for more than the server will send is not a client bug.

    `limit=0` and `limit=-1` are honoured as "the smallest page", `limit=9999` as
    "the largest", and the ceiling is reported back so the client need not guess.
    """
    from app.history import MAX_PAGE_SIZE, MAX_SESSION_PAGE_SIZE

    client = app.test_client()
    headers = login(client, "history-clamped@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "clamped", size=4, correct=2)

    for value in ("0", "-1", "-500"):
        page = client.get(f"/v1/history/attempts?limit={value}", headers=headers)
        assert page.status_code == 200
        assert page.json["limit"] == 1
        assert len(page.json["attempts"]) == 1

    wide = client.get("/v1/history/attempts?limit=9999", headers=headers).json
    assert wide["limit"] == MAX_PAGE_SIZE
    assert wide["max_limit"] == MAX_PAGE_SIZE

    # An empty parameter means "not supplied", which is not an error either.
    blank = client.get("/v1/history/attempts?limit=&since=&correct=", headers=headers)
    assert blank.status_code == 200
    assert blank.json["limit"] == 50

    sessions = client.get("/v1/history/sessions?limit=9999", headers=headers).json
    assert sessions["limit"] == MAX_SESSION_PAGE_SIZE
    assert sessions["max_limit"] == MAX_SESSION_PAGE_SIZE


# ---------------------------------------------------------------------------
# 5. SQLite concurrency
# ---------------------------------------------------------------------------


def test_sqlite_connections_run_in_wal_mode(tmp_path):
    """Rollback-journal SQLite plus in-process grading threads is a lock storm.

    `AI_JOBS_MODE=local` grades explanations on background threads in this same
    process, so a writer overlapping a reader is the normal case. Under the
    default journal that is `database is locked`; under WAL the reader proceeds
    against the last committed snapshot.
    """
    from app import create_app

    database = tmp_path / "wal-check.db"
    application = create_app(
        {"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{database}", "AUTO_SEED": False}
    )
    with application.app_context():
        assert db.session.execute(db.text("PRAGMA journal_mode")).scalar().lower() == "wal"
        assert db.session.execute(db.text("PRAGMA busy_timeout")).scalar() == 5000


# ---------------------------------------------------------------------------
# 6. Review scheduling (FSRS-6)
# ---------------------------------------------------------------------------


def test_stability_is_defined_as_ninety_percent_recall(app):
    """R(S, S) = 0.9 is the definition of stability, not an approximation."""
    from app.scheduling import DESIRED_RETENTION, interval_days, retrievability

    assert retrievability(10.0, 10.0) == pytest.approx(0.9, abs=1e-6)
    assert retrievability(10.0, 0.0) == pytest.approx(1.0, abs=1e-9)
    assert retrievability(10.0, 100.0) < 0.9
    # And the interval solver inverts it.
    assert retrievability(10.0, interval_days(10.0)) == pytest.approx(DESIRED_RETENTION, abs=1e-6)
    assert interval_days(10.0, 0.9) == pytest.approx(10.0, abs=1e-6)


def test_the_memory_model_matches_the_fsrs_reference_transitions(app):
    """Anchors on the published FSRS-6 formulas rather than on this app's wiring.

    Initial stability is w[G-1] verbatim; a lapse must never return a longer
    interval than the card already had; and a card recalled after real decay
    must come back stronger than one recalled immediately (the spacing effect).
    """
    from app.scheduling import (
        DEFAULT_PARAMETERS,
        GRADE_AGAIN,
        GRADE_GOOD,
        initial_difficulty,
        initial_stability,
        next_state,
    )

    for grade in (1, 2, 3, 4):
        assert initial_stability(grade) == pytest.approx(DEFAULT_PARAMETERS[grade - 1])
        assert 1.0 <= initial_difficulty(grade) <= 10.0
    assert initial_difficulty(1) > initial_difficulty(4)

    lapsed, _ = next_state(10.0, 5.0, 10.0, GRADE_AGAIN)
    assert lapsed < 10.0

    just_seen, _ = next_state(10.0, 5.0, 0.0, GRADE_GOOD)
    well_decayed, _ = next_state(10.0, 5.0, 10.0, GRADE_GOOD)
    assert well_decayed > just_seen


def test_the_grade_is_derived_from_signals_the_student_never_sees(app):
    """No ratings prompt exists, so every FSRS input comes off the attempt."""
    from types import SimpleNamespace

    from app.scheduling import GRADE_AGAIN, GRADE_EASY, GRADE_GOOD, GRADE_HARD, derive_grade

    def attempt(**overrides):
        base = {
            "is_correct": True,
            "server_elapsed_ms": 60_000,
            "confidence": 5,
            "explanation_score": 0.9,
            "answer_changed": False,
        }
        base.update(overrides)
        return SimpleNamespace(session_item=SimpleNamespace(target_time_seconds=150), **base)

    assert derive_grade(attempt(is_correct=False)) == GRADE_AGAIN
    assert derive_grade(attempt()) == GRADE_EASY
    # Correct but unable to justify it: the app's "unsupported correct" case.
    assert derive_grade(attempt(explanation_score=0.05)) == GRADE_HARD
    # Correct but four minutes over target on a 150s item.
    assert derive_grade(attempt(server_elapsed_ms=400_000, confidence=2, explanation_score=0.5)) == GRADE_HARD
    # An ungraded explanation is treated as unknown, not as excellent.
    assert derive_grade(attempt(explanation_score=None)) == GRADE_GOOD
    # Hesitation costs: the same answer, changed, grades lower.
    assert derive_grade(attempt(explanation_score=0.7, answer_changed=True)) < derive_grade(
        attempt(explanation_score=0.7)
    )


def test_review_selection_ranks_by_retrievability_not_by_calendar_date(app):
    """A student sprinting before a test date is never told to come back later.

    Both cards here are dated in the future, so a `due_at <= now` gate would
    return nothing. The weaker card must still come back, and first.
    """
    from datetime import timedelta

    from app.models import Question, ReviewQueueItem, User, utcnow
    from app.scheduling import due_for_review

    client = app.test_client()
    headers = login(client, "scheduler-order@example.test")
    create_game(client, headers)

    with app.app_context():
        user = User.query.filter_by(email="scheduler-order@example.test").one()
        weak, strong = Question.query.order_by(Question.id).limit(2).all()
        db.session.add(
            ReviewQueueItem(
                user_id=user.id,
                question_id=weak.id,
                status="due",
                reason_code="incorrect",
                interval_index=1,
                stability=2.0,
                difficulty=7.0,
                reps=1,
                last_grade=3,
                last_reviewed_at=utcnow() - timedelta(days=8),
                due_at=utcnow() + timedelta(days=30),
            )
        )
        db.session.add(
            ReviewQueueItem(
                user_id=user.id,
                question_id=strong.id,
                status="due",
                reason_code="incorrect",
                interval_index=1,
                stability=90.0,
                difficulty=3.0,
                reps=4,
                last_grade=4,
                last_reviewed_at=utcnow() - timedelta(days=1),
                due_at=utcnow() + timedelta(days=60),
            )
        )
        db.session.commit()

        ordered = due_for_review(user.id, 2)
        assert [question.id for question in ordered] == [weak.id, strong.id]
        assert due_for_review(user.id, 1)[0].id == weak.id


def test_review_items_are_interleaved_rather_than_front_loaded(app):
    from app.scheduling import interleave

    class Item:
        def __init__(self, name, question_type="Flaw", passage_id=None):
            self.name = name
            self.question_type = question_type
            self.passage_id = passage_id

        def __repr__(self):
            return self.name

    reviews = [Item(f"r{index}") for index in range(3)]
    fresh = [Item(f"f{index}", question_type="Assumption") for index in range(7)]
    ordered = interleave(reviews, fresh)

    assert len(ordered) == 10
    assert set(ordered) == set(reviews) | set(fresh)
    positions = sorted(ordered.index(item) for item in reviews)
    assert positions != [0, 1, 2], "reviews are still front-loaded"
    # Spread out: no two reviews adjacent, and none in the opening slot.
    assert all(second - first > 1 for first, second in zip(positions, positions[1:]))
    assert positions[0] > 0

    # Degenerate inputs pass straight through.
    assert interleave([], fresh) == fresh
    assert interleave(reviews, []) == reviews


def test_interleaving_keeps_passage_mates_together(app):
    """Reading Comprehension questions on one passage must not be scattered."""
    from app.scheduling import interleave

    class Item:
        def __init__(self, name, question_type, passage_id=None):
            self.name = name
            self.question_type = question_type
            self.passage_id = passage_id

    fresh = [
        Item("rc1", "Main Point", "p1"),
        Item("rc2", "Inference", "p1"),
        Item("rc3", "Detail", "p1"),
        Item("lr1", "Flaw"),
        Item("lr2", "Assumption"),
    ]
    reviews = [Item("rev", "Flaw")]
    ordered = interleave(reviews, fresh)
    names = [item.name for item in ordered]
    passage_positions = [names.index(name) for name in ("rc1", "rc2", "rc3")]
    assert passage_positions == sorted(passage_positions)
    assert passage_positions[-1] - passage_positions[0] == 2


def test_practice_runs_never_expose_the_scheduler(app):
    """The student presses practice; no rating, deck, or due-date UI appears."""
    client = app.test_client()
    headers = login(client, "scheduler-hidden@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "hidden", size=4, correct=1)

    session = client.post("/v1/study-sessions", json={"size": 4}, headers=headers).json["session"]
    serialized = str(session)
    for leaked in ("stability", "difficulty", "retrievability", "grade", "interval"):
        assert leaked not in serialized
    item = session["current_item"]
    assert "from_review_queue" not in item
    assert set(item["question"]) >= {"id", "section", "question_type", "stem"}


def test_a_missed_question_comes_straight_back_and_a_clean_one_does_not(app):
    from app.models import Attempt, ReviewQueueItem, User
    from app.scheduling import DESIRED_RETENTION, card_retrievability

    client = app.test_client()
    headers = login(client, "scheduler-loop@example.test")
    create_game(client, headers)
    run_session(app, client, headers, "loop", size=4, correct=2)

    with app.app_context():
        user = User.query.filter_by(email="scheduler-loop@example.test").one()
        cards = ReviewQueueItem.query.filter_by(user_id=user.id).all()
        assert cards, "a missed question should have entered the queue"
        missed = [card for card in cards if card.last_grade == 1]
        assert missed
        for card in missed:
            # Relearning: maximally weak, and available now rather than on a date.
            assert card_retrievability(card) == 0.0
            assert card_retrievability(card) < DESIRED_RETENTION
            assert card.stability is not None
            assert card.reps >= 1

        # Every queued card traces back to a real attempt.
        for card in cards:
            assert db.session.get(Attempt, card.source_attempt_id) is not None
