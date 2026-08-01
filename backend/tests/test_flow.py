from __future__ import annotations

import json
from datetime import timedelta

import pytest
from sqlalchemy import update

from app import create_app
from app.extensions import db
from app.game import (
    ASSETS,
    ASSET_BY_KEY,
    CLIENT_BY_KEY,
    FINAL_CASE_KEY,
    FIRM_TIERS,
    TIER_GATED_ASSET_TYPES,
    settle_upkeep,
)
from app.models import (
    AiJob,
    AuthSession,
    Attempt,
    AttemptSettlement,
    DailyProgress,
    LedgerEntry,
    Passage,
    PlayerAsset,
    PlayerClientContract,
    PlayerProfile,
    PlayerStoryState,
    Question,
    QuestionChoice,
    ReviewQueueItem,
    SessionItem,
    StudySession,
    User,
    utcnow,
)
from app.seed import SOURCE_PREFIX, seed_questions


def add_question(index: int, section: str) -> None:
    question_id = f"hf-lsat-{'lr' if section == 'Logical Reasoning' else 'rc'}:sample-{index}"
    passage_id = None
    stimulus = f"Argument stimulus {index}."
    if section == "Reading Comprehension":
        passage_id = f"sample-passage-{index // 2}"
        passage = db.session.get(Passage, passage_id)
        if not passage:
            db.session.add(
                Passage(
                    id=passage_id,
                    canonical_text=f"Reading passage {index // 2}. It contains enough text for a sample question.",
                    passage_type="Reading Comprehension",
                    source=f"{SOURCE_PREFIX}rc",
                    review_status="published",
                )
            )
        stimulus = None
    question = Question(
        id=question_id,
        passage_id=passage_id,
        section=section,
        question_type="Inference",
        difficulty=3,
        stimulus=stimulus,
        stem=f"Which answer is best for sample question {index}?",
        correct_answer="C",
        source=f"{SOURCE_PREFIX}{'lr' if section == 'Logical Reasoning' else 'rc'} · train",
        license_status="upstream_terms_apply",
        review_status="published",
    )
    db.session.add(question)
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"{question_id}-{label}",
                question_id=question_id,
                label=label,
                canonical_text=f"Answer {label} for question {index}",
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
            "PRACTICE_SESSION_SIZE": 3,
            "TFY_URL": "",
            "TFY_API_KEY": "",
        }
    )
    with application.app_context():
        for index in range(8):
            add_question(index, "Logical Reasoning")
        for index in range(8, 12):
            add_question(index, "Reading Comprehension")
        db.session.commit()
    return application


def explanation(marker: str) -> str:
    """A gradable explanation that clears the 120-character Method Lab floor.

    Distinct per ``marker`` on purpose: ``game._is_reused_reasoning`` compares an
    attempt against the same user's last 50 explanations and forces an Invalid
    band on a repeat, so reusing one literal string inside a test would silently
    change what that test settles.
    """
    return (
        f"The conclusion depends on the link that {marker} makes explicit, and the credited "
        "choice supplies exactly that connection while every other option either widens "
        "the scope or swaps the term the argument actually needs."
    )


def login(client, email: str = "student@example.test") -> dict[str, str]:
    response = client.post("/v1/auth/dev", json={"email": email, "display_name": "Test Student"})
    assert response.status_code == 200
    csrf = client.get_cookie("lsat_csrf")
    assert csrf
    return {"X-CSRF-Token": csrf.value}


def mobile_login(client, email: str = "student@example.test") -> dict[str, str]:
    response = client.post("/v1/auth/mobile/dev", json={"email": email, "display_name": "Mobile Student"})
    assert response.status_code == 200
    assert response.json["access_token"]
    assert response.json["expires_at"]
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def test_development_auth_fails_closed(monkeypatch):
    monkeypatch.setenv("FLASK_ENV", "development")
    monkeypatch.setenv("DEV_AUTH_ENABLED", "false")
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
        }
    )
    assert application.test_client().post("/v1/auth/dev").status_code == 404

    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("DEV_AUTH_ENABLED", "true")
    with pytest.raises(RuntimeError, match="DEV_AUTH_ENABLED"):
        create_app({"TESTING": True, "AUTO_SEED": False})


def test_mobile_bearer_sessions_are_revocable_and_do_not_require_csrf(app):
    client = app.test_client()
    headers = mobile_login(client, "native@example.test")

    me = client.get("/v1/me", headers=headers)
    assert me.status_code == 200
    assert me.json["user"]["email"] == "native@example.test"

    # Cookie sessions still protect state-changing endpoints with CSRF. Device
    # bearer sessions use the Authorization header instead and are exempt from
    # that browser-only check.
    created = client.post(
        "/v1/game/profile",
        json={"lawyer_name": "Native Counsel", "firm_name": "Native Legal", "character_gender": "female"},
        headers=headers,
    )
    assert created.status_code == 201

    logged_out = client.post("/v1/auth/logout", headers=headers)
    assert logged_out.status_code == 200
    assert client.get("/v1/me", headers=headers).status_code == 401
    with app.app_context():
        assert AuthSession.query.filter(AuthSession.revoked_at.isnot(None)).count() == 1


def test_custom_instance_path_supports_read_only_deployment_layout(tmp_path):
    instance_path = tmp_path / "lambda-instance"
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
        },
        instance_path=str(instance_path),
    )

    assert application.instance_path == str(instance_path)
    assert instance_path.is_dir()


def create_game(client, headers, gender: str = "female"):
    response = client.post(
        "/v1/game/profile",
        json={"lawyer_name": "Alex Morgan", "firm_name": "Morgan Legal", "character_gender": gender},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json["game"]


def coach_and_settle(app, monkeypatch, attempt_id: str, grade: int = 80) -> None:
    """Coach one attempt so its settlement lands, the way production does.

    Every case carries game context now, so `/debrief/acknowledge` refuses to
    advance the run until the visible attempt is settled. Any test that answers
    more than one question has to coach each answer before moving on.
    """
    monkeypatch.setattr(
        "app.services.generate_attempt_coaching",
        lambda _attempt: (
            {
                "explanation_grade": grade,
                "reasoning_verdict": "strong",
                "reasoning_summary": "The decisive inference was identified.",
                "model": "test-model",
            },
            {},
        ),
    )
    with app.app_context():
        from app.services import run_attempt_coaching

        run_attempt_coaching(db.session.get(Attempt, attempt_id))


def test_office_rent_rates_are_systematic_and_one_active_day_settles_once(app):
    client = app.test_client()
    headers = login(client, "rent-active@example.test")
    created = create_game(client, headers)
    now = utcnow().replace(microsecond=0)

    assert [tier["rent_daily"] for tier in FIRM_TIERS] == [
        max(15, tier["cost"] // 50) for tier in FIRM_TIERS
    ]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = 1_000
        profile.upkeep_settled_at = now - timedelta(days=1)
        profile.last_active_at = now - timedelta(days=1)
        db.session.commit()

        state = settle_upkeep(profile, now)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert state["settlement"] == {"new_rent": 15, "paid": 15, "reputation_change": 0.0}
        assert profile.cash == 985
        assert profile.lifetime_rent_paid == 15
        assert profile.rent_arrears == 0
        assert LedgerEntry.query.filter_by(user_id=profile.user_id, kind="office_rent").count() == 1

        settle_upkeep(profile, now)
        assert LedgerEntry.query.filter_by(user_id=profile.user_id, kind="office_rent").count() == 1


def test_mixed_active_and_offline_rent_and_inactivity_reputation_decay(app):
    client = app.test_client()
    headers = login(client, "rent-offline@example.test")
    created = create_game(client, headers)
    now = utcnow().replace(microsecond=0)

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = 1_000
        profile.reputation = 50
        profile.upkeep_settled_at = now - timedelta(days=3)
        profile.last_active_at = now - timedelta(days=3)
        db.session.commit()

        state = settle_upkeep(profile, now)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        # $15 for the first active day + two days at the 20% away rate.
        assert state["settlement"]["new_rent"] == 21
        assert profile.cash == 979
        assert profile.reputation == 49.8
        assert state["offline_daily_rent"] == 3
        assert state["reputation_grace_hours"] == 48


def test_reputation_guard_reduces_inactivity_loss(app):
    client = app.test_client()
    headers = login(client, "rent-guard@example.test")
    created = create_game(client, headers)
    now = utcnow().replace(microsecond=0)

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = 1_000
        profile.reputation = 50
        profile.upkeep_settled_at = now - timedelta(days=4)
        profile.last_active_at = now - timedelta(days=4)
        db.session.add(PlayerAsset(
            profile_id=profile.id,
            asset_key="media_response_room",
            asset_type="upgrade",
            purchase_price=ASSET_BY_KEY["media_response_room"]["cost"],
        ))
        db.session.commit()

        state = settle_upkeep(profile, now)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert state["base_reputation_decay_daily"] == .25
        assert state["reputation_decay_daily"] == .2
        assert state["reputation_guard"] == 1
        assert profile.reputation == 49.6


def test_rent_arrears_are_capped_repaid_and_fractional_accrual_is_preserved(app):
    client = app.test_client()
    headers = login(client, "rent-arrears@example.test")
    created = create_game(client, headers)
    now = utcnow().replace(microsecond=0)

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 1
        profile.cash = 0
        profile.upkeep_settled_at = now - timedelta(days=30)
        profile.last_active_at = now - timedelta(days=30)
        db.session.commit()

        state = settle_upkeep(profile, now)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert state["arrears_cap"] == FIRM_TIERS[1]["rent_daily"] * 3
        assert profile.rent_arrears == state["arrears_cap"]

        profile.cash = 500
        db.session.commit()
        settle_upkeep(profile, now)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert profile.rent_arrears == 0
        assert profile.cash == 500 - state["arrears_cap"]
        assert LedgerEntry.query.filter_by(user_id=profile.user_id, kind="office_rent").count() == 1

    fractional_client = app.test_client()
    fractional_headers = login(fractional_client, "rent-fractional@example.test")
    fractional = create_game(fractional_client, fractional_headers)
    start = now + timedelta(days=1)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=fractional["id"]).one()
        profile.cash = 1_000
        profile.upkeep_settled_at = start
        profile.last_active_at = start
        db.session.commit()
        for hour in range(1, 25):
            settle_upkeep(profile, start + timedelta(hours=hour))
        profile = PlayerProfile.query.filter_by(id=fractional["id"]).one()
        assert profile.cash == 985
        assert profile.lifetime_rent_paid == 15
        assert profile.rent_accrual_micros == 0


def test_final_case_completion_stops_future_rent_and_reputation_decay(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "rent-complete@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 14
        profile.reputation = 94
        profile.story_state.active_quest_key = FINAL_CASE_KEY
        profile.story_state.quest_progress = 7
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "Choice C follows from the controlling premise while each alternative adds an unsupported condition, so the credited answer is the only one the argument licenses.",
        },
        headers={**headers, "Idempotency-Key": "complete-final-charter"},
    ).json["result"]
    coaching = {
        "explanation_grade": 90,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The controlling premise and unsupported alternatives were identified.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))

    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert FINAL_CASE_KEY in profile.story_state.quest_history_json
        assert profile.game_completed_at is not None
        cash_after = profile.cash
        reputation_after = profile.reputation

        future = utcnow().replace(microsecond=0) + timedelta(days=60)
        profile.upkeep_settled_at = future - timedelta(days=60)
        profile.last_active_at = future - timedelta(days=60)
        db.session.commit()
        state = settle_upkeep(profile, future)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert state["completed"] is True
        assert state["accruing"] is False
        assert profile.cash == cash_after
        assert profile.reputation == reputation_after


def test_firm_advance_is_blocked_until_every_prior_upgrade_hire_and_acquisition_is_owned(app):
    client = app.test_client()
    headers = login(client, "tier-gate@example.test")
    created = create_game(client, headers)
    required = [
        asset
        for asset in ASSETS
        if asset["type"] in TIER_GATED_ASSET_TYPES and asset["tier"] == 0
    ]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = FIRM_TIERS[1]["cost"]
        profile.reputation = FIRM_TIERS[1]["reputation"]
        db.session.commit()

    locked_game = client.get("/v1/game").json["game"]
    next_tier = next(tier for tier in locked_game["catalog"]["tiers"] if tier["next"])
    assert set(next_tier["missing_assets"]) == {asset["key"] for asset in required}
    assert next_tier["available"] is False
    blocked = client.post("/v1/game/advance", json={"target_tier": 1}, headers=headers)
    assert blocked.status_code == 409
    assert blocked.json["error"]["code"] == "requirements_not_met"

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        for asset in required:
            db.session.add(
                PlayerAsset(
                    profile_id=profile.id,
                    asset_key=asset["key"],
                    asset_type=asset["type"],
                    purchase_price=asset["cost"],
                )
            )
        db.session.commit()

    advanced = client.post("/v1/game/advance", json={"target_tier": 1}, headers=headers)
    assert advanced.status_code == 200
    assert advanced.json["game"]["office_tier"] == 1
    assert advanced.json["game"]["cash"] == 0


def test_account_onboards_then_goes_to_random_cases(app, monkeypatch):
    chosen_ids = []

    def reverse_sample(values, k):
        chosen = list(reversed(values))[:k]
        chosen_ids.extend(question.id for question in chosen)
        return chosen

    monkeypatch.setattr("app.services.random.sample", reverse_sample)
    client = app.test_client()
    headers = login(client)

    me = client.get("/v1/me")
    assert me.status_code == 200
    assert me.json["user"]["next_route"] == "/onboarding"
    assert me.json["user"]["diagnostic_complete"] is False
    game = create_game(client, headers)
    assert game["character_gender"] == "female"
    assert game["cash"] == 250
    assert game["next_milestone"] == {
        "kind": "asset",
        "name": "Repaired oak desk",
        "cost": ASSET_BY_KEY["repaired_desk"]["cost"],
        "reputation": 0,
    }
    assert client.get("/v1/me").json["user"]["next_route"] == "/progress"

    response = client.post("/v1/study-sessions", headers=headers)
    assert response.status_code == 201
    session = response.json["session"]
    assert session["mode"] == "practice"
    assert session["total_items"] == 3
    assert session["current_item"]["question"]["id"] == chosen_ids[0]
    assert session["current_item"]["case_terms"] == {
        "client_key": "walk_in",
        "client_name": "Walk-in client",
        "base_fee": CLIENT_BY_KEY["walk_in"]["base_fee"],
    }
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert [item.question_id for item in items] == chosen_ids
        assert all(item.question.source.startswith(SOURCE_PREFIX) for item in items)
        assert all(not hasattr(item, "story_json") for item in items)
        assert all(item.requires_reasoning is True for item in items)
        assert all(item.target_time_seconds in {135, 150, 330} for item in items)
        assert items[0].game_context_json
        assert all(item.game_context_json is None for item in items[1:])

    # Starting a second practice run no longer just resumes the first — it
    # queues a new run (a student may hold several at once, up to the cap)
    # and auto-pauses whichever run was still ticking, since only one run may
    # ever have an actively-running timer at a time.
    second_start = client.post("/v1/study-sessions", headers=headers)
    assert second_start.status_code == 201
    second_session = second_start.json["session"]
    assert second_session["id"] != session["id"]

    with app.app_context():
        first_after = db.session.get(StudySession, session["id"])
        assert first_after.status == "paused"
        second_after = db.session.get(StudySession, second_session["id"])
        assert second_after.status == "in_progress"

    active_list = client.get("/v1/study-sessions/active", headers=headers)
    assert active_list.status_code == 200
    assert active_list.json["queue_cap"] == 8
    active_ids = {entry["id"] for entry in active_list.json["sessions"]}
    assert active_ids == {session["id"], second_session["id"]}

    diagnostics = client.get("/v1/diagnostics/current", headers=headers)
    assert diagnostics.status_code == 200
    assert diagnostics.json == {"session": None, "latest": None}
    assert client.get("/v1/story/progress").status_code == 404


def test_practice_queue_cap_and_single_active_timer(app):
    client = app.test_client()
    headers = login(client, "queue-cap@example.test")
    create_game(client, headers)

    started_ids = []
    for _ in range(8):
        response = client.post("/v1/study-sessions", json={"size": 1}, headers=headers)
        assert response.status_code == 201
        started_ids.append(response.json["session"]["id"])

    overflow = client.post("/v1/study-sessions", json={"size": 1}, headers=headers)
    assert overflow.status_code == 409
    assert overflow.json["error"]["code"] == "queue_full"

    with app.app_context():
        statuses = {
            session_id: db.session.get(StudySession, session_id).status
            for session_id in started_ids
        }
        # Only the most-recently-started run may be ticking; every other
        # queued run must have been auto-paused as soon as the next one began,
        # otherwise two items could accumulate active_elapsed_ms at once.
        assert sum(status == "in_progress" for status in statuses.values()) == 1
        assert statuses[started_ids[-1]] == "in_progress"
        assert all(statuses[session_id] == "paused" for session_id in started_ids[:-1])

    active = client.get("/v1/study-sessions/active", headers=headers)
    assert active.status_code == 200
    assert active.json["queue_cap"] == 8
    assert {entry["id"] for entry in active.json["sessions"]} == set(started_ids)

    # Explicitly resuming an older paused run must re-pause whatever else was
    # ticking, so the "exactly one in_progress session" invariant survives
    # switching focus between already-queued runs, not just creating new ones.
    resumed = client.post(f"/v1/study-sessions/{started_ids[0]}/resume", headers=headers)
    assert resumed.status_code == 200
    assert resumed.json["session"]["status"] == "in_progress"
    with app.app_context():
        statuses = {
            session_id: db.session.get(StudySession, session_id).status
            for session_id in started_ids
        }
        assert sum(status == "in_progress" for status in statuses.values()) == 1
        assert statuses[started_ids[0]] == "in_progress"

    discarded = client.post(f"/v1/study-sessions/{started_ids[1]}/abandon", headers=headers)
    assert discarded.status_code == 200
    assert discarded.json["session"]["status"] == "abandoned"

    freed = client.post("/v1/study-sessions", json={"size": 1}, headers=headers)
    assert freed.status_code == 201


def test_diagnostic_is_neutral_and_feeds_performance(app):
    client = app.test_client()
    headers = login(client, "diagnostic@example.test")
    create_game(client, headers)

    started = client.post("/v1/diagnostics", headers=headers)
    assert started.status_code == 201
    session = started.json["session"]
    assert session["mode"] == "diagnostic"
    assert session["current_item"]["case_terms"] is None
    assert session["total_items"] >= 1

    item = session["current_item"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "A",
            "strategy_applied": True,
            "reasoning": "I identified the conclusion and tested A against the exact logical requirement.",
        },
        headers={**headers, "Idempotency-Key": "diagnostic-answer-one"},
    )
    assert answered.status_code == 200
    assert answered.json["result"]["game_reward"] is None

    performance = client.get("/v1/performance", headers=headers)
    assert performance.status_code == 200
    snapshot = performance.json["performance"]
    assert snapshot["overall"]["attempts"] == 1
    assert snapshot["overall"]["evidence"] == "baseline"
    assert snapshot["overall"]["accuracy_delta"] is None
    assert snapshot["overall"]["pace_delta"] is None
    assert snapshot["overall"]["average_seconds_delta"] is None
    assert snapshot["overall"]["reasoning_delta"] is None
    assert snapshot["skills"][0]["attempts"] == 1


def test_run_size_and_focus_are_bounded(app):
    client = app.test_client()
    headers = login(client, "focused-speedrun@example.test")
    create_game(client, headers)

    started = client.post(
        "/v1/study-sessions",
        json={"size": 2, "question_type": "Inference"},
        headers=headers,
    )
    assert started.status_code == 201
    assert started.json["session"]["total_items"] == 2

    other_client = app.test_client()
    other_headers = login(other_client, "invalid-speedrun@example.test")
    create_game(other_client, other_headers)
    invalid = other_client.post("/v1/study-sessions", json={"size": 51}, headers=other_headers)
    assert invalid.status_code == 400
    assert invalid.json["error"]["code"] == "invalid_session_size"


def test_a_case_run_releases_feedback_immediately_and_seeds_review(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "answer-only-speedrun@example.test")
    create_game(client, headers)

    started = client.post("/v1/study-sessions", json={"size": 2}, headers=headers)
    assert started.status_code == 201
    session = started.json["session"]
    assert session["practice_style"] == "cases"
    assert session["feedback_policy"] == "immediate"
    assert session["current_item"]["requires_reasoning"] is True

    first = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "A",
            "strategy_applied": True,
            "confidence": 5,
            "reasoning": explanation("the first sprint answer"),
        },
        headers={**headers, "Idempotency-Key": "speedrun-delayed-one"},
    )
    assert first.status_code == 200
    first_result = first.json["result"]
    assert first_result["feedback_released"] is True
    assert first_result["is_correct"] is False
    coach_and_settle(app, monkeypatch, first_result["attempt_id"])
    client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)

    resumed = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
    second = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": resumed["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "confidence": 5,
            "reasoning": explanation("the resumed sprint answer"),
        },
        headers={**headers, "Idempotency-Key": "speedrun-delayed-two"},
    )
    assert second.status_code == 200
    assert second.json["result"]["feedback_released"] is True
    assert second.json["result"]["session_complete"] is True
    coach_and_settle(app, monkeypatch, second.json["result"]["attempt_id"])

    review = client.get(f"/v1/study-sessions/{session['id']}/review", headers=headers)
    assert review.status_code == 200
    assert review.json["review"]["summary"]["correct"] == 1
    assert len(review.json["review"]["items"]) == 2
    assert review.json["review"]["items"][0]["selected_label"] == "A"
    assert review.json["review"]["items"][0]["correct_label"] == "C"
    assert review.json["review"]["items"][0]["evidence_class"] == "coached_practice"

    queue = client.get("/v1/reviews", headers=headers)
    assert queue.status_code == 200
    assert queue.json["review_queue"]["due"] == 1
    assert queue.json["review_queue"]["items"][0]["reason_code"] == "high_confidence_error"

    with app.app_context():
        attempts = (
            Attempt.query.join(SessionItem)
            .filter(SessionItem.session_id == session["id"])
            .order_by(Attempt.created_at)
            .all()
        )
        # Every case now settles into the economy, which is the point of the collapse.
        assert all(attempt.evidence_class == "coached_practice" for attempt in attempts)
        assert all(attempt.settlement is not None for attempt in attempts)


def test_daily_docket_drives_cases_into_priority_deep_brief(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "daily-docket@example.test")
    create_game(client, headers)

    fresh = client.get("/v1/daily-docket?timezone=America/Chicago", headers=headers)
    assert fresh.status_code == 200
    docket = fresh.json["daily_docket"]
    assert docket["timezone"] == "America/Chicago"
    assert docket["cases"]["state"] == "ready"
    assert docket["deep_brief"]["state"] == "locked"
    assert docket["next_action"]["kind"] == "start_cases"

    session = client.post("/v1/study-sessions", json={"size": 5}, headers=headers).json["session"]
    for index in range(5):
        current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
        answer = "A" if index == 0 else "C"
        response = client.post(
            f"/v1/study-sessions/{session['id']}/attempts",
            json={
                "item_id": current["current_item"]["id"],
                "selected_label": answer,
                "strategy_applied": True,
                "confidence": 5,
                "reasoning": explanation(f"docket question {index}"),
            },
            headers={**headers, "Idempotency-Key": f"daily-docket-{index}"},
        )
        assert response.status_code == 200
        # Immediate feedback parks the attempt on a debrief the student owes,
        # and the debrief will not clear until the case has settled.
        coach_and_settle(app, monkeypatch, response.json["result"]["attempt_id"])
        client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)

    review = client.get(f"/v1/study-sessions/{session['id']}/review", headers=headers)
    assert review.status_code == 200
    first_item = review.json["review"]["items"][0]
    assert first_item["priority_reason"] == "high_confidence_miss"
    assert first_item["target_time_seconds"] in {135, 150, 330}

    briefing = client.get("/v1/daily-docket?timezone=America/Chicago", headers=headers).json["daily_docket"]
    assert briefing["cases"]["state"] == "complete"
    assert briefing["deep_brief"]["state"] == "ready"
    assert briefing["deep_brief"]["priority_count"] == 1
    assert briefing["next_action"] == {
        "kind": "open_brief",
        "label": "Open Deep Brief",
        "session_id": session["id"],
    }

    closed = client.post(f"/v1/study-sessions/{session['id']}/review/acknowledge", headers=headers)
    assert closed.status_code == 200
    assert closed.json["brief_complete"] is True
    completed = client.get("/v1/daily-docket?timezone=America/Chicago", headers=headers).json["daily_docket"]
    assert completed["deep_brief"]["state"] == "complete"
    assert completed["next_action"]["kind"] == "done"


def test_scheduled_reviews_are_timezone_safe(app):
    """A future-due row exercises SQLite's naive-timestamp behavior.

    SQLite drops timezone information even on timezone-aware columns while
    PostgreSQL preserves it, so a row scheduled for tomorrow must read back as
    scheduled-but-not-due on both.
    """
    client = app.test_client()
    headers = login(client, "infinite-review@example.test")
    created = create_game(client, headers)

    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "A",
            "strategy_applied": True,
            "confidence": 4,
            "reasoning": explanation("the seeded sprint miss"),
        },
        headers={**headers, "Idempotency-Key": "review-seed-miss"},
    )

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        row = ReviewQueueItem.query.filter_by(user_id=profile.user_id).one()
        row.due_at = utcnow() + timedelta(days=1)
        db.session.commit()

    queue = client.get("/v1/reviews", headers=headers)
    assert queue.status_code == 200
    assert queue.json["review_queue"]["due"] == 0
    assert queue.json["review_queue"]["scheduled"] == 1
    performance = client.get("/v1/performance", headers=headers)
    assert performance.status_code == 200
    assert performance.json["performance"]["review"]["scheduled"] == 1


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


def test_completed_run_stops_at_training_lab_boundary(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "completed-speedrun@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "C follows from the stated relationship; the alternatives add claims the stimulus does not support, which is why they fail even though they restate its vocabulary.",
        },
        headers={**headers, "Idempotency-Key": "one-question-speedrun"},
    ).json["result"]
    monkeypatch.setattr(
        "app.services.generate_attempt_coaching",
        lambda _attempt: (
            {
                "explanation_grade": 82,
                "reasoning_verdict": "mostly_correct",
                "reasoning_summary": "The controlling relationship was identified.",
                "model": "test-model",
            },
            {},
        ),
    )
    with app.app_context():
        from app.services import run_attempt_coaching

        run_attempt_coaching(db.session.get(Attempt, answered["attempt_id"]))

    completed = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert completed.status_code == 200
    assert completed.json["run_complete"] is True
    assert completed.json["session"]["status"] == "completed"
    assert client.get("/v1/study-sessions/current", headers=headers).json == {"session": None}


def test_answer_choice_explanations_and_reasoning_grade_are_preserved(app, monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "model": "gpt-5.6-luna",
                "choices": [{"message": {"content": json.dumps(self.content)}}],
                "usage": {},
            }

        def __init__(self, content):
            self.content = content

    captured = {}

    def fake_post(_url, headers, json: dict, timeout):
        captured["request"] = json
        submitted = __import__("json").loads(json["messages"][1]["content"].split("\n\n", 1)[1])
        question = submitted["question"]
        correct = question["verified_correct_label"]
        selected = submitted["student_submission"]["selected_label"]
        return FakeResponse(
            {
                "explanation_grade": 84,
                "reasoning_verdict": "mostly_correct",
                "reasoning_summary": "The reasoning identified the key inference but could distinguish the distractor more explicitly.",
                "first_error": {
                    "code": "incomplete_elimination",
                    "description": "The nearest distractor was not fully eliminated.",
                    "repair": "State the unsupported leap in that option.",
                },
                "answer_analysis": {
                    "correct_answer_explanation": f"Choice {correct} follows from the supplied evidence.",
                    "selected_answer_explanation": f"Choice {selected} is evaluated against the exact task.",
                    "choice_explanations": [
                        {"label": choice["label"], "explanation": f"Choice {choice['label']} receives a specific explanation."}
                        for choice in question["choices"]
                    ],
                },
                "next_step_hint": "Name the exact task before comparing options.",
                "debrief": "Keep the valid inference and make elimination explicit.",
            }
        )

    monkeypatch.setattr("app.coaching.requests.post", fake_post)
    monkeypatch.setitem(app.config, "TFY_URL", "https://truefoundry.example/v1")
    monkeypatch.setitem(app.config, "TFY_API_KEY", "test-key")

    client = app.test_client()
    headers = login(client, "coaching@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    item = session["current_item"]
    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "B",
            "strategy_applied": True,
            "reasoning": "The premises support B, and C appears to go beyond the evidence provided by asserting a degree of certainty the argument never earns anywhere in its chain.",
        },
        headers={**headers, "Idempotency-Key": "first-answer"},
    )
    assert response.status_code == 200
    result = response.json["result"]
    assert result["feedback"]["correct_label"] == "C"

    coaching_response = client.post(f"/v1/attempts/{result['attempt_id']}/coaching", headers=headers)
    assert coaching_response.status_code == 200
    coaching = coaching_response.json["coaching"]
    assert coaching["explanation_grade"] == 84
    assert coaching["reasoning_verdict"] == "mostly_correct"
    assert len(coaching["answer_analysis"]["choice_explanations"]) == 5
    assert {choice["label"] for choice in coaching["answer_analysis"]["choice_explanations"]} == set("ABCDE")
    assert coaching["prompt_version"] == "coaching-v2-plain-language"
    assert captured["request"]["reasoning_effort"] == "xhigh"
    assert "one decisive bottom-line sentence" in captured["request"]["messages"][0]["content"]
    assert coaching_response.json["reward"]["explanation_grade"] == "Excellent"
    assert coaching_response.json["reward"]["score"] == 3
    assert coaching_response.json["game"]["total_cases"] == 1

    resumed = client.get(f"/v1/study-sessions/{session['id']}").json["session"]
    assert resumed["pending_result"]["feedback"]["coaching"]["explanation_grade"] == 84
    continued = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert continued.status_code == 200
    assert continued.json["session"]["current_item"]["position"] == 1


def test_hugging_face_schema_is_mapped_to_questions_and_passages(monkeypatch):
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "QUESTION_BANK_DIR": "",
        }
    )

    def fake_rows(dataset: str, split: str):
        is_rc = dataset.endswith("lsat-rc")
        yield {
            "context": "A shared reading passage." if is_rc else "A logical reasoning stimulus.",
            "id_string": f"{split}-{'RC' if is_rc else 'LR'}-1",
            "answers": ["one", "two", "three", "four", "five"],
            "label": 2,
            "question": "Which one of the following is most strongly supported?",
        }

    monkeypatch.setattr("app.seed._iter_dataset_rows", fake_rows)
    with application.app_context():
        assert seed_questions() == 6
        assert Question.query.count() == 6
        lr = Question.query.filter_by(section="Logical Reasoning").first()
        rc = Question.query.filter_by(section="Reading Comprehension").first()
        assert lr.stimulus == "A logical reasoning stimulus."
        assert lr.passage is None
        assert rc.stimulus is None
        assert rc.passage.canonical_text == "A shared reading passage."
        assert rc.correct_answer == "C"
        assert [choice.label for choice in rc.choices] == list("ABCDE")
        assert all(question.source.startswith(SOURCE_PREFIX) for question in Question.query.all())


def test_repository_snapshot_is_used_without_hugging_face(tmp_path, monkeypatch):
    bank_dir = tmp_path / "question_bank"
    for dataset_slug in ("lsat-lr", "lsat-rc"):
        for split in ("train", "validation", "test"):
            split_dir = bank_dir / dataset_slug
            split_dir.mkdir(parents=True, exist_ok=True)
            row = {
                "context": "A reading passage." if dataset_slug == "lsat-rc" else "A reasoning stimulus.",
                "id_string": f"{split}-{dataset_slug}",
                "answers": ["one", "two", "three", "four", "five"],
                "label": 1,
                "question": "Which answer is supported?",
            }
            (split_dir / f"{split}.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")

    def unexpected_download(_dataset: str, _split: str):
        raise AssertionError("Hugging Face should not be called when the repository snapshot is complete")

    monkeypatch.setattr("app.seed._iter_dataset_rows", unexpected_download)
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "QUESTION_BANK_DIR": str(bank_dir),
        }
    )
    with application.app_context():
        assert seed_questions() == 6
        assert Question.query.count() == 6


def test_coaching_can_run_as_a_durable_async_job(app, monkeypatch):
    from app.jobs import process_ai_job

    client = app.test_client()
    headers = login(client, "async@example.test")
    create_game(client, headers, "male")
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    item = session["current_item"]
    attempt = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "The credited choice follows directly from the stated evidence in this stimulus, while the remaining options depend on a comparison the author declines to make.",
        },
        headers={**headers, "Idempotency-Key": "async-answer"},
    ).json["result"]

    monkeypatch.setitem(app.config, "TFY_URL", "https://truefoundry.example/v1")
    monkeypatch.setitem(app.config, "TFY_API_KEY", "test-key")
    monkeypatch.setitem(app.config, "AI_JOBS_MODE", "sqs")
    monkeypatch.setitem(app.config, "AI_JOB_QUEUE_URL", "https://sqs.example/jobs")
    monkeypatch.setattr("app.jobs._send_job_message", lambda _job: None)
    expected = {"model": "test-model", "reasoning_summary": "Processed by the worker."}
    monkeypatch.setattr("app.services.run_attempt_coaching", lambda _attempt: expected)

    accepted = client.post(f"/v1/attempts/{attempt['attempt_id']}/coaching", headers=headers)
    assert accepted.status_code == 202
    job_id = accepted.json["job"]["id"]
    with app.app_context():
        assert process_ai_job(job_id).status == "completed"
    status = client.get(f"/v1/jobs/{job_id}")
    assert status.json["job"]["result"] == expected


def test_current_ai_job_lease_keeps_sqs_redelivery_retryable(app, monkeypatch):
    from app.jobs import JobLeaseActive, enqueue_coaching_job, process_ai_job

    client = app.test_client()
    headers = login(client, "current-lease@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "The credited answer is supported by the final premise and stays within its scope, whereas the distractors generalize past the single case the evidence describes.",
        },
        headers={**headers, "Idempotency-Key": "current-lease-answer"},
    ).json["result"]

    sent = []
    monkeypatch.setattr("app.jobs._send_job_message", lambda job: sent.append(job.id))
    with app.app_context():
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        job = AiJob(
            user_id=attempt.user_id,
            kind="coaching",
            resource_id=attempt.id,
            dedup_key=f"coaching:{attempt.id}",
            status="processing",
            attempt_count=1,
            queue_message_id="original-message",
            started_at=utcnow(),
            payload_json={},
        )
        db.session.add(job)
        db.session.commit()
        job_id = job.id

        with pytest.raises(JobLeaseActive):
            process_ai_job(job_id)
        stored = db.session.get(AiJob, job_id)
        assert stored.status == "processing"
        assert stored.attempt_count == 1

        retried = enqueue_coaching_job(attempt)
        assert retried.status == "processing"
        assert retried.attempt_count == 1
        assert sent == []


def test_stale_ai_job_is_resent_and_redelivery_settles_once(app, monkeypatch):
    from app.jobs import enqueue_coaching_job, process_ai_job

    client = app.test_client()
    headers = login(client, "stale-lease@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "Choice C follows from the stated evidence without adding a new assumption, and the other four each require a bridging claim the stimulus pointedly leaves out.",
        },
        headers={**headers, "Idempotency-Key": "stale-lease-answer"},
    ).json["result"]
    coaching = {
        "explanation_grade": 86,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive inference was identified.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    sent = []

    def fake_send(job):
        sent.append(job.id)
        job.queue_message_id = "replacement-message"
        db.session.commit()

    monkeypatch.setattr("app.jobs._send_job_message", fake_send)
    with app.app_context():
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        job = AiJob(
            user_id=attempt.user_id,
            kind="coaching",
            resource_id=attempt.id,
            dedup_key=f"coaching:{attempt.id}",
            status="processing",
            attempt_count=1,
            queue_message_id="lost-message",
            started_at=utcnow() - timedelta(seconds=300),
            payload_json={},
        )
        db.session.add(job)
        db.session.commit()
        job_id = job.id

        reclaimed = enqueue_coaching_job(attempt)
        assert reclaimed.status == "queued"
        assert reclaimed.started_at is None
        assert reclaimed.attempt_count == 1
        assert reclaimed.queue_message_id == "replacement-message"
        assert sent == [job_id]

        # Simulate a worker that claimed the replacement and crashed. The
        # stale SQS redelivery may safely execute it again.
        reclaimed.status = "processing"
        reclaimed.started_at = utcnow() - timedelta(seconds=300)
        db.session.commit()
        completed = process_ai_job(job_id)
        assert completed.status == "completed"
        assert completed.attempt_count == 2
        assert AttemptSettlement.query.filter_by(attempt_id=attempt.id).count() == 1
        # The key is scoped to the paying profile, so match on the attempt it names.
        payouts = LedgerEntry.query.filter_by(user_id=attempt.user_id, kind="case_payout").all()
        assert len(payouts) == 1
        assert payouts[0].source_id.endswith(f":{attempt.id}")

        duplicate = process_ai_job(job_id)
        assert duplicate.status == "completed"
        assert duplicate.attempt_count == 2
        assert AttemptSettlement.query.filter_by(attempt_id=attempt.id).count() == 1


def test_tycoon_scoring_gates_speed_and_reasoning():
    from app.game import _points

    assert _points(True, "Invalid", 100, 150) == (4, 0, 0, 4)
    assert _points(True, "Weak", 100, 150) == (4, 4, 0, 8)
    assert _points(True, "Good", 75, 150) == (4, 10, 4, 18)
    assert _points(True, "Excellent", 75, 150) == (4, 12, 4, 20)
    assert _points(True, "Excellent", 20, 150)[3] == 8
    assert _points(False, "Excellent", 75, 150) == (1, 2, 0, 3)
    assert _points(True, "Excellent", 75, 150, time_eligible=False) == (4, 12, 0, 16)


def test_reasoning_is_required_server_side(app):
    client = app.test_client()
    headers = login(client, "required@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": session["current_item"]["id"], "selected_label": "C"},
        headers={**headers, "Idempotency-Key": "blank-reasoning"},
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "reasoning_required"


def test_case_settlement_and_ledger_are_exactly_once(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "settlement@example.test")
    created = create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    item = session["current_item"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "The conclusion follows because the stated premise directly supports choice C, and no other option connects the evidence to the conclusion without a gap.",
        },
        headers={**headers, "Idempotency-Key": "settle-once"},
    ).json["result"]

    coaching = {
        "provider": "test",
        "model": "test-model",
        "reasoning_effort": "test",
        "prompt_version": "test",
        "explanation_grade": 86,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive inference was identified.",
        "understood_correctly": "The decisive inference was identified.",
        "first_error": None,
        "answer_analysis": {
            "correct_answer_explanation": "C follows.",
            "selected_answer_explanation": "C follows.",
            "choice_explanations": [],
        },
        "next_step_hint": "Repeat the same disciplined comparison.",
        "solution_method": "Identify the exact inference and test each option.",
        "debrief": "Sound work.",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        first = run_attempt_coaching(attempt)
        second = run_attempt_coaching(attempt)
        assert first == second
        assert AttemptSettlement.query.filter_by(attempt_id=attempt.id).count() == 1
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        # Ledger keys name the profile that recorded them; see `_scoped_source`.
        assert LedgerEntry.query.filter_by(
            user_id=attempt.user_id,
            kind="case_payout",
            source_id=f"{profile.id}:{attempt.id}",
        ).count() == 1
        assert profile.cash == created["cash"] + attempt.settlement.payout
        assert profile.total_cases == 1


def test_invalid_reasoning_does_not_advance_cash_daily_goals(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "invalid-daily@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "This answer is right because it is the right answer, and the other answers are wrong because they are not the right answer, which is how I knew to pick it.",
        },
        headers={**headers, "Idempotency-Key": "invalid-daily-answer"},
    ).json["result"]
    coaching = {
        "explanation_grade": 0,
        "reasoning_verdict": "unsupported",
        "reasoning_summary": "The explanation is generic and does not analyze this question.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        daily = DailyProgress.query.filter_by(profile_id=profile.id).one()
        assert attempt.settlement.explanation_grade == "Invalid"
        assert attempt.settlement.payout == 0
        assert profile.cash == 250
        assert profile.total_cases == 1
        assert daily.cases_completed == 0


def test_tycoon_review_cannot_skip_wrong_answer_settlement(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "no-skip@example.test")
    create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "no-skip@example.test").one()
        profile.reputation = 80
        profile.current_streak = 4
        profile.best_streak = 4
        profile.story_state.active_quest_key = "market_whisper"
        profile.story_state.quest_progress = 0
        contract = PlayerClientContract.query.filter_by(
            profile_id=profile.id,
            client_key="walk_in",
        ).one()
        starting_contract_cases = contract.cases_remaining
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "B",
            "strategy_applied": True,
            "reasoning": "Choice B seems plausible because it appears to follow from the final premise, though it quietly swaps the qualifier the author attached to that premise.",
        },
        headers={**headers, "Idempotency-Key": "wrong-cannot-skip"},
    ).json["result"]

    blocked = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert blocked.status_code == 409
    assert blocked.json["error"]["code"] == "settlement_required"
    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "no-skip@example.test").one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        stored_session = db.session.get(StudySession, session["id"])
        assert stored_session.pending_attempt_id == submitted["attempt_id"]
        assert profile.reputation == 80
        assert profile.current_streak == 4
        assert profile.total_cases == 0
        assert contract.cases_remaining == starting_contract_cases

    coaching = {
        "explanation_grade": 88,
        "reasoning_verdict": "mostly_correct",
        "reasoning_summary": "The explanation missed the credited inference.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        assert attempt.settlement is not None
        # A wrong answer with an Excellent explanation is a well-reasoned miss:
        # standing still drops (accuracy matters) but far less than a careless
        # guess, and it now earns a modest consultation fee instead of nothing.
        assert 78 < profile.reputation < 80
        assert profile.current_streak == 0
        assert profile.total_cases == 1
        assert attempt.settlement.payout > 0
        assert profile.cash == 250 + attempt.settlement.payout
        assert profile.story_state.quest_progress == 0
        # A miss never advances the client's contract, preserving win-based pacing.
        assert contract.cases_remaining == starting_contract_cases

    continued = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert continued.status_code == 200
    assert continued.json["session"]["current_item"]["position"] == 1


def test_finished_legacy_attempt_is_not_adopted_or_paid_retroactively(app):
    client = app.test_client()
    headers = login(client, "legacy-finished@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "B",
            "strategy_applied": True,
            "reasoning": "This is a historical explanation created before the tycoon economy existed, recorded when attempts were stored without any settlement or client context attached.",
        },
        headers={**headers, "Idempotency-Key": "finished-legacy"},
    ).json["result"]
    with app.app_context():
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        attempt.session_item.game_context_json = None
        db.session.commit()

    resumed = client.get(f"/v1/study-sessions/{session['id']}")
    assert resumed.status_code == 200
    assert resumed.json["session"]["pending_result"]["game_reward"] is None
    with app.app_context():
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        assert attempt.session_item.game_context_json is None
        assert attempt.settlement is None
        assert profile.total_cases == 0

    acknowledged = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert acknowledged.status_code == 200


def test_unfinished_legacy_rc_item_is_adopted_with_correct_target(app):
    client = app.test_client()
    headers = login(client, "legacy-rc@example.test")
    assert client.post("/v1/study-sessions", headers=headers).status_code == 409

    with app.app_context():
        user = User.query.filter_by(email="legacy-rc@example.test").one()
        rc_questions = Question.query.filter_by(section="Reading Comprehension").order_by(Question.id).limit(2).all()
        assert len(rc_questions) == 2
        assert rc_questions[0].passage_id == rc_questions[1].passage_id
        legacy_session = StudySession(
            user_id=user.id,
            mode="practice",
            status="in_progress",
            target_minutes=user.target_minutes,
            total_items=2,
            current_index=1,
        )
        db.session.add(legacy_session)
        db.session.flush()
        db.session.add_all(
            [
                SessionItem(
                    session_id=legacy_session.id,
                    question_id=rc_questions[0].id,
                    position=0,
                    requires_reasoning=False,
                    target_time_seconds=150,
                    completed_at=utcnow(),
                ),
                SessionItem(
                    session_id=legacy_session.id,
                    question_id=rc_questions[1].id,
                    position=1,
                    requires_reasoning=False,
                    target_time_seconds=150,
                ),
            ]
        )
        db.session.commit()
        session_id = legacy_session.id
        current_item_id = legacy_session.items[1].id

    rejected = client.post(
        f"/v1/study-sessions/{session_id}/attempts",
        json={
            "item_id": current_item_id,
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "The passage directly supports this choice.",
        },
        headers={**headers, "Idempotency-Key": "legacy-before-onboarding"},
    )
    assert rejected.status_code == 409
    assert rejected.json["error"]["code"] == "onboarding_required"

    create_game(client, headers)
    resumed = client.get(f"/v1/study-sessions/{session_id}")
    assert resumed.status_code == 200
    assert resumed.json["session"]["current_item"]["target_time_seconds"] == 135
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session_id).order_by(SessionItem.position).all()
        assert items[0].game_context_json is None
        assert items[1].game_context_json
        assert items[1].target_time_seconds == 135


def test_purchases_and_passive_income_are_account_bound(app):
    first = app.test_client()
    first_headers = login(first, "owner@example.test")
    create_game(first, first_headers)
    second = app.test_client()
    second_headers = login(second, "other@example.test")
    second_game = create_game(second, second_headers, "male")

    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "owner@example.test").one()
        desk_cost = ASSET_BY_KEY["repaired_desk"]["cost"]
        profile.cash = desk_cost + 650
        db.session.commit()

    bought = first.post("/v1/game/purchases", json={"asset_key": "repaired_desk"}, headers=first_headers)
    assert bought.status_code == 200
    assert bought.json["game"]["cash"] == 650
    assert first.post("/v1/game/purchases", json={"asset_key": "repaired_desk"}, headers=first_headers).status_code == 409
    assert second.get("/v1/game").json["game"]["cash"] == second_game["cash"]
    assert "repaired_desk" not in second.get("/v1/game").json["game"]["owned_assets"]

    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "owner@example.test").one()
        db.session.add(
            PlayerAsset(
                profile_id=profile.id,
                asset_key="junior_associate",
                asset_type="staff",
                purchase_price=8_000,
            )
        )
        db.session.add(
            PlayerAsset(
                profile_id=profile.id,
                asset_key="office_manager",
                asset_type="staff",
                purchase_price=25_000,
            )
        )
        profile.last_passive_collected_at = utcnow() - timedelta(hours=20)
        db.session.commit()
    collected = first.post("/v1/game/passive-income/collect", headers=first_headers)
    assert collected.status_code == 200
    cap_hours = collected.json["game"]["passive_income"]["cap_hours"]
    assert cap_hours == 8
    assert collected.json["collected"] == ASSET_BY_KEY["junior_associate"]["passive_hourly"] * cap_hours
    manager = next(
        asset for asset in collected.json["game"]["catalog"]["assets"] if asset["key"] == "office_manager"
    )
    assert manager["benefit"] == ASSET_BY_KEY["office_manager"]["benefit"]


def test_cosmetics_are_purchasable_account_bound_and_respect_their_requirement(app):
    first = app.test_client()
    first_headers = login(first, "decor@example.test")
    created = create_game(first, first_headers)
    second = app.test_client()
    second_headers = login(second, "decor-other@example.test")
    create_game(second, second_headers, "male")

    lamp = ASSET_BY_KEY["banker_lamp"]
    assert lamp["type"] == "cosmetic"
    assert lamp["requires"] == ["repaired_desk"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = lamp["cost"] * 2
        db.session.commit()

    # The lamp needs a desk to stand on, so its requirement gates it exactly as
    # a functional upgrade's does.
    blocked = first.post("/v1/game/purchases", json={"asset_key": "banker_lamp"}, headers=first_headers)
    assert blocked.status_code == 409
    assert blocked.json["error"]["code"] == "requirements_not_met"

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        db.session.add(
            PlayerAsset(
                profile_id=profile.id,
                asset_key="repaired_desk",
                asset_type="upgrade",
                purchase_price=ASSET_BY_KEY["repaired_desk"]["cost"],
            )
        )
        db.session.commit()

    bought = first.post("/v1/game/purchases", json={"asset_key": "banker_lamp"}, headers=first_headers)
    assert bought.status_code == 200
    assert bought.json["game"]["cash"] == lamp["cost"]
    assert "banker_lamp" in bought.json["game"]["owned_assets"]
    assert first.post("/v1/game/purchases", json={"asset_key": "banker_lamp"}, headers=first_headers).status_code == 409

    # Decor buys nothing but the view: no passive income and no payout effect
    # leaks into the serialized catalog entry.
    assert bought.json["game"]["passive_income"]["hourly_rate"] == 0
    catalog_lamp = next(asset for asset in bought.json["game"]["catalog"]["assets"] if asset["key"] == "banker_lamp")
    assert catalog_lamp["owned"] is True
    assert catalog_lamp["benefit"] == lamp["benefit"]
    assert "payout_mult" not in catalog_lamp

    assert "banker_lamp" not in second.get("/v1/game").json["game"]["owned_assets"]


def test_locked_economy_action_refreshes_a_stale_profile(app):
    client = app.test_client()
    headers = login(client, "lock-refresh@example.test")
    create_game(client, headers)
    with app.app_context():
        from app.game import purchase_asset

        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "lock-refresh@example.test").one()
        assert profile.cash == 250
        desk_cost = ASSET_BY_KEY["repaired_desk"]["cost"]
        db.session.execute(
            update(PlayerProfile).where(PlayerProfile.id == profile.id).values(cash=desk_cost + 650),
            execution_options={"synchronize_session": False},
        )
        assert profile.cash == 250
        purchase_asset(profile, "repaired_desk")
        assert profile.cash == 650


def test_campaign_choice_is_persistent_and_cannot_be_replayed(app):
    client = app.test_client()
    headers = login(client, "campaign@example.test")
    game = create_game(client, headers)
    assert game["story"]["alignment"] == "Pragmatic"
    assert game["story"]["pending_chapter"]["key"] == "one_light_on"

    decided = client.post(
        "/v1/game/story/choice",
        json={"chapter_key": "one_light_on", "choice_key": "open_door"},
        headers=headers,
    )
    assert decided.status_code == 200
    story = decided.json["game"]["story"]
    assert story["ethics"] == 78
    assert story["influence"] == 2
    assert story["pending_chapter"] is None
    assert story["chapters"][0]["seen"] is True
    assert story["chapters"][0]["choice"] == "open_door"

    replay = client.post(
        "/v1/game/story/choice",
        json={"chapter_key": "one_light_on", "choice_key": "build_fast"},
        headers=headers,
    )
    assert replay.status_code == 409
    assert replay.json["error"]["code"] == "chapter_not_pending"
    with app.app_context():
        state = PlayerStoryState.query.one()
        assert state.seen_chapters_json == ["one_light_on"]


def test_ethics_and_intel_reveal_and_fund_a_hidden_quest(app):
    client = app.test_client()
    headers = login(client, "shadow@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 4
        profile.story_state.ethics = 60
        profile.story_state.intel = 3
        db.session.commit()

    game = client.get("/v1/game").json["game"]
    hidden = next(quest for quest in game["story"]["quests"] if quest["key"] == "market_whisper")
    assert hidden["available"] is True
    opened = client.post("/v1/game/quests/start", json={"quest_key": "market_whisper"}, headers=headers)
    assert opened.status_code == 200
    assert opened.json["result"]["advance"] == 100_000
    assert opened.json["game"]["story"]["active_quest"]["key"] == "market_whisper"
    assert opened.json["game"]["story"]["heat"] == 10
    assert opened.json["game"]["cash"] == created["cash"] + 100_000


def test_rival_operation_reduces_the_real_purchase_price(app):
    client = app.test_client()
    headers = login(client, "rival-ops@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = 1_000_000
        profile.reputation = 80
        profile.office_tier = 2
        profile.story_state.influence = 5
        db.session.add(PlayerAsset(profile_id=profile.id, asset_key="local_bar", asset_type="connection", purchase_price=1))
        db.session.commit()

    operated = client.post(
        "/v1/game/rival-operations",
        json={"rival_key": "neighborhood_practice", "operation_key": "public_case_challenge"},
        headers=headers,
    )
    rival = ASSET_BY_KEY["neighborhood_practice"]
    operation_cost = max(500, round(rival["cost"] * .02))
    discounted_cost = round(rival["cost"] * .95)
    assert operated.status_code == 200
    assert operated.json["result"]["cost"] == operation_cost
    target = next(item for item in operated.json["game"]["story"]["rival_targets"] if item["key"] == "neighborhood_practice")
    assert target["list_cost"] == rival["cost"]
    assert target["cost"] == discounted_cost
    assert target["discount_bps"] == 500

    bought = client.post("/v1/game/purchases", json={"asset_key": "neighborhood_practice"}, headers=headers)
    assert bought.status_code == 200
    assert bought.json["game"]["cash"] == 1_000_000 - operation_cost - discounted_cost
    with app.app_context():
        acquired = PlayerAsset.query.filter_by(asset_key="neighborhood_practice").one()
        assert acquired.purchase_price == discounted_cost


def test_pro_bono_win_and_caseboard_completion_change_the_settlement(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "pro-bono@example.test")
    created = create_game(client, headers)
    selected = client.post("/v1/game/client", json={"client_key": "eviction_defense_clinic"}, headers=headers)
    assert selected.status_code == 200
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.story_state.active_quest_key = "mercer_overflow"
        profile.story_state.quest_progress = 2
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "Choice C follows from the decisive premise while the other choices require facts not supplied, so only C survives a strict reading of what the passage actually claims.",
        },
        headers={**headers, "Idempotency-Key": "pro-bono-completion"},
    ).json["result"]
    coaching = {
        "explanation_grade": 88,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive premise and scope were identified.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        settlement = attempt.settlement
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert settlement.quest_bonus == 650
        assert settlement.payout >= settlement.quest_bonus
        assert settlement.reputation_after >= settlement.reputation_before + 2
        assert profile.story_state.active_quest_key is None
        assert "mercer_overflow" in profile.story_state.quest_history_json
        cash_after = profile.cash
        run_attempt_coaching(attempt)
        assert PlayerProfile.query.filter_by(id=created["id"]).one().cash == cash_after


def _settle_wrong_answer(app, monkeypatch, email: str, grade: int, *, reputation: float = 80.0) -> dict:
    """Answer one case incorrectly, coach it with the given grade, settle, and

    report the resulting economy state. The correct answer is always ``C``.
    """
    client = app.test_client()
    headers = login(client, email)
    create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == email).one()
        profile.reputation = reputation
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "B",
            "strategy_applied": True,
            "reasoning": (
                f"Choice B is tempting for {email}, but it only holds if we assume an "
                "unstated premise about scope that the stimulus never actually supplies."
            ),
        },
        headers={**headers, "Idempotency-Key": f"{email}-wrong"},
    ).json["result"]

    coaching = {
        "explanation_grade": grade,
        "reasoning_verdict": "mostly_correct",
        "reasoning_summary": "A specific analysis that isolates the decisive inference and the scope gap.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        daily = DailyProgress.query.filter_by(profile_id=profile.id).one()
        return {
            "grade": attempt.settlement.explanation_grade,
            "payout": attempt.settlement.payout,
            "cash": profile.cash,
            "reputation": profile.reputation,
            "streak": profile.current_streak,
            "total_cases": profile.total_cases,
            "daily_cases": daily.cases_completed,
        }


def test_well_reasoned_wrong_answer_earns_consolation_and_protects_reputation(app, monkeypatch):
    result = _settle_wrong_answer(app, monkeypatch, "excellent-miss@example.test", 88)
    assert result["grade"] == "Excellent"
    # A thoughtful miss is no longer a total loss: it earns a modest fee...
    assert result["payout"] > 0
    assert result["cash"] == 250 + result["payout"]
    # ...counts as a completed case toward daily goals...
    assert result["total_cases"] == 1
    assert result["daily_cases"] == 1
    # ...but still breaks the streak and dents reputation only slightly.
    assert result["streak"] == 0
    assert 78.0 < result["reputation"] < 80.0


def test_only_strong_reasoning_is_rewarded_on_a_wrong_answer(app, monkeypatch):
    excellent = _settle_wrong_answer(app, monkeypatch, "reward-excellent@example.test", 88)
    weak = _settle_wrong_answer(app, monkeypatch, "reward-weak@example.test", 40)
    invalid = _settle_wrong_answer(app, monkeypatch, "reward-invalid@example.test", 0)

    assert weak["grade"] == "Weak"
    assert invalid["grade"] == "Invalid"
    # A thin or unsupported rationale on a wrong answer still earns nothing, so
    # genuine reasoning — not just "showing up" — is what the consolation rewards.
    assert weak["payout"] == 0 and weak["cash"] == 250 and weak["daily_cases"] == 0
    assert invalid["payout"] == 0 and invalid["cash"] == 250 and invalid["daily_cases"] == 0
    # And a well-argued miss protects standing better than a careless one.
    assert excellent["payout"] > 0
    assert excellent["reputation"] > weak["reputation"]
    assert excellent["reputation"] > invalid["reputation"]


def test_completed_contract_auto_renews_so_a_client_can_be_replayed(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "renew@example.test")
    created = create_game(client, headers)
    walk_in_length = CLIENT_BY_KEY["walk_in"]["length"]
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        contract.cases_remaining = 1  # one decisive case away from finishing the contract
        profile.client_cases_remaining = 1
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "Choice C follows directly from the final premise without importing an unstated assumption, and the rest fail once that premise is read at its stated strength.",
        },
        headers={**headers, "Idempotency-Key": "renew-final-case"},
    ).json["result"]
    coaching = {
        "explanation_grade": 88,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive inference was identified.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        # Finishing the contract pays the completion bonus and immediately re-signs
        # the client, so a full fresh docket is always ready to be worked again.
        assert contract.completed_contracts == 1
        assert contract.cases_remaining == walk_in_length
        assert profile.client_cases_remaining == walk_in_length
        assert attempt.settlement.contract_bonus > 0


def test_player_is_never_stranded_without_an_available_client(app):
    client = app.test_client()
    headers = login(client, "stranded@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.reputation = 0  # rock bottom: nothing new can be unlocked
        profile.office_tier = 0
        db.session.commit()

    game = client.get("/v1/game").json["game"]
    walk_in = next(c for c in game["catalog"]["clients"] if c["key"] == "walk_in")
    assert walk_in["unlocked"] is True
    # This is exactly the dead-end scenario: no client other than the always-open
    # walk-in is unlockable here.
    unlocked_beyond_walk_in = [
        c["key"] for c in game["catalog"]["clients"] if c["unlocked"] and c["key"] != "walk_in"
    ]
    assert unlocked_beyond_walk_in == []

    with app.app_context():
        from app.game import select_client

        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        contract.cases_remaining = 0  # simulate a fully spent contract
        db.session.commit()
        # Re-selecting the client refills the docket, guaranteeing there is always
        # a case to work and progress never halts.
        select_client(profile, "walk_in")
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        assert contract.cases_remaining == CLIENT_BY_KEY["walk_in"]["length"]


def test_every_case_carries_a_strategy_trial(app):
    client = app.test_client()
    headers = login(client, "strategy-cadence@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 7}, headers=headers).json["session"]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        # Every position, not just the old position % 4 == 2 cadence.
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
        # The hidden control arm still exists alongside the prompts.
        assert {trial["variant"] for trial in first} <= {"prompt", "control"}


def test_strategy_control_assignment_is_stable_and_hidden(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "strategy-control@example.test")
    create_game(client, headers)
    with app.app_context():
        from app.services import serialize_item
        from app.strategies import assign_strategy_trial

        user = User.query.filter_by(email="strategy-control@example.test").one()
        question = Question.query.order_by(Question.id).first()
        monkeypatch.setattr("app.strategies._stable_fraction", lambda _value: 0.0)
        assigned = assign_strategy_trial(user.id, question, "deep", 2)
        assert assigned["variant"] == "control"
        assert assigned["key"] in {"argument_core", "prephrase", "scope_precision", "conditional_chain"}

        session = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="deep",
            feedback_policy="immediate",
            target_minutes=35,
            total_items=1,
        )
        db.session.add(session)
        db.session.flush()
        item = SessionItem(
            session_id=session.id,
            question_id=question.id,
            position=0,
            requires_reasoning=True,
            strategy_key=assigned["key"],
            strategy_variant=assigned["variant"],
        )
        db.session.add(item)
        db.session.flush()
        assert serialize_item(item)["strategy_trial"] is None


def test_strategy_candidates_respect_causal_and_assumption_boundaries(app):
    with app.app_context():
        from app.strategies import _candidate_keys

        question = Question.query.filter_by(section="Logical Reasoning").first()
        question.question_type = "Strengthen"
        question.stimulus = "A committee adopted the proposal after reviewing three reports."
        question.stem = "Which choice, if true, most strengthens the argument?"
        assert "causal_audit" not in _candidate_keys(question)

        question.stimulus = "The committee claims that the proposal caused the reported decline."
        assert "causal_audit" in _candidate_keys(question)

        question.question_type = "Assumption"
        question.stem = "Which assumption, if made, enables the conclusion to be properly drawn?"
        assert "negation_test" not in _candidate_keys(question)
        question.stem = "Which assumption is required by the argument?"
        assert "negation_test" in _candidate_keys(question)


def test_prompted_strategy_requires_a_decision_and_valid_prompt_time(app):
    client = app.test_client()
    headers = login(client, "strategy-submit@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    item_id = session["current_item"]["id"]
    # Deliberately omits strategy_applied: the first submission below must be
    # rejected for exactly that reason.
    payload = {
        "item_id": item_id,
        "selected_label": "C",
        "reasoning": "The credited answer follows from the stated relationship without adding a new assumption, while every competing choice needs a premise the argument never states.",
        "confidence": 4,
    }
    with app.app_context():
        item = db.session.get(SessionItem, item_id)
        item.strategy_key = "argument_core"
        item.strategy_variant = "prompt"
        db.session.commit()

    missing = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json=payload,
        headers={**headers, "Idempotency-Key": "strategy-missing-decision"},
    )
    assert missing.status_code == 400
    assert missing.json["error"]["code"] == "strategy_decision_required"

    invalid_time = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={**payload, "strategy_applied": True, "strategy_prompt_ms": "not-a-duration"},
        headers={**headers, "Idempotency-Key": "strategy-invalid-time"},
    )
    assert invalid_time.status_code == 400
    assert invalid_time.json["error"]["code"] == "invalid_strategy_prompt_time"

    accepted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={**payload, "strategy_applied": True, "strategy_prompt_ms": 2_400},
        headers={**headers, "Idempotency-Key": "strategy-accepted"},
    )
    assert accepted.status_code == 200
    with app.app_context():
        attempt = Attempt.query.filter_by(idempotency_key="strategy-accepted").one()
        assert attempt.strategy_key == "argument_core"
        assert attempt.strategy_variant == "prompt"
        assert attempt.strategy_applied is True
        assert attempt.strategy_prompt_ms == 2_400


def test_strategy_dashboard_waits_for_supported_evidence_and_excludes_skips(app):
    client = app.test_client()
    headers = login(client, "strategy-dashboard@example.test")
    create_game(client, headers)
    with app.app_context():
        from app.strategies import strategy_performance

        user = User.query.filter_by(email="strategy-dashboard@example.test").one()
        question = Question.query.order_by(Question.id).first()
        session = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="deep",
            feedback_policy="immediate",
            status="completed",
            target_minutes=35,
            total_items=13,
            current_index=13,
        )
        db.session.add(session)
        db.session.flush()
        for position in range(13):
            variant = "prompt" if position < 9 else "control"
            applied = position < 8 if variant == "prompt" else None
            item = SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                requires_reasoning=True,
                strategy_key="argument_core",
                strategy_variant=variant,
                target_time_seconds=150,
                completed_at=utcnow(),
            )
            db.session.add(item)
            db.session.flush()
            is_correct = position in {0, 1, 2, 3, 4, 5, 9, 10}
            db.session.add(
                Attempt(
                    user_id=user.id,
                    session_item_id=item.id,
                    idempotency_key=f"strategy-dashboard-{position}",
                    selected_label="C" if is_correct else "A",
                    is_correct=is_correct,
                    reasoning_text="A concrete argument analysis.",
                    confidence=4,
                    strategy_key="argument_core",
                    strategy_variant=variant,
                    strategy_applied=applied,
                    strategy_prompt_ms=5_000 if applied else 0,
                    evidence_class="coached_practice",
                    server_elapsed_ms=100_000,
                )
            )
        db.session.commit()

        snapshot = strategy_performance(user.id)
        result = snapshot["results"][0]
        assert result["sample"] == 8
        assert result["control_sample"] == 4
        assert result["skipped"] == 1
        assert result["accuracy"] == 75
        assert result["control_accuracy"] == 50
        assert result["lift"] == 25
        assert result["average_seconds"] == 95
        assert result["status"] == "supported"
        assert snapshot["strongest"]["key"] == "argument_core"
        assert snapshot["trials_completed"] == 12

        assert snapshot["leader"]["key"] == "argument_core"
        assert result["verdict"] == "confirmed"
        assert result["verdict_label"] == "confirmed"
        assert result["plain_title"] == "Split the argument"
        assert result["summary"] == "Splitting the argument is helping you."
        assert result["detail"] == "You get 75% right with it and 50% right without it on similar questions."
        assert result["with_headline"] == "75%"
        assert result["with_note"] == "8 questions with it"
        assert result["without_note"] == "4 questions without it"
        assert result["difference_headline"] == "+25 points"
        assert result["difference_note"] == "95s average with it"

    response = client.get("/v1/performance", headers=headers)
    assert response.status_code == 200
    assert response.json["performance"]["strategy_lab"]["strongest"]["key"] == "argument_core"


def _replace_profile(app, client, headers, profile_id: str) -> dict:
    """Retire a profile and start a fresh one for the same account.

    `player_profiles.user_id` is unique, so a user's second playthrough can only
    exist after the first is gone. Spending history is deliberately user-owned and
    survives, which is the situation the ledger scoping has to tolerate.
    """

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        DailyProgress.query.filter_by(profile_id=profile.id).delete()
        db.session.delete(profile)
        db.session.commit()
        # `create_profile` reads `user.game_profile`, which is cached on the
        # identity map until the deleted row is expired.
        db.session.expire_all()
    return create_game(client, headers)


def test_a_replacement_profile_can_repurchase_an_asset_the_ledger_still_records(app):
    """The reported 500: a surviving ledger row with no matching asset row.

    `purchase_asset` decides ownership from `player_assets`, which belongs to the
    profile, while `uq_ledger_source` spans the user. A replacement profile
    therefore saw the asset as unowned and then collided with the retired
    profile's ledger row on insert.
    """

    client = app.test_client()
    headers = login(client, "second-firm@example.test")
    created = create_game(client, headers)
    desk_cost = ASSET_BY_KEY["repaired_desk"]["cost"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = desk_cost
        db.session.commit()
    assert client.post("/v1/game/purchases", json={"asset_key": "repaired_desk"}, headers=headers).status_code == 200

    restarted = _replace_profile(app, client, headers, created["id"])
    assert restarted["id"] != created["id"]
    with app.app_context():
        user_id = PlayerProfile.query.filter_by(id=restarted["id"]).one().user_id
        # Exactly the inconsistency that used to fail: the purchase is still in the
        # ledger, but nothing owns the asset any more.
        assert LedgerEntry.query.filter_by(user_id=user_id, kind="asset_purchase").count() == 1
        assert PlayerAsset.query.filter_by(asset_key="repaired_desk").count() == 0

        profile = PlayerProfile.query.filter_by(id=restarted["id"]).one()
        profile.cash = desk_cost
        db.session.commit()

    repeated = client.post("/v1/game/purchases", json={"asset_key": "repaired_desk"}, headers=headers)
    assert repeated.status_code == 200
    assert repeated.json["game"]["cash"] == 0

    with app.app_context():
        rows = LedgerEntry.query.filter_by(user_id=user_id, kind="asset_purchase").all()
        assert len(rows) == 2
        assert len({row.source_id for row in rows}) == 2
        assert all(row.source_id.endswith(":repaired_desk") for row in rows)
        assert {created["id"], restarted["id"]} == {row.source_id.split(":")[0] for row in rows}


def test_profile_scoped_ledger_keys_let_each_playthrough_record_the_same_content(app):
    from app.game import _ledger, _scoped_source

    # Every kind that keys on a content name rather than a unique event id.
    content_keys = {
        "asset_purchase": "repaired_desk",
        "firm_advancement": "1",
        "story_choice": "sterling_invitation",
        "quest_advance": "mercer_overflow",
    }

    client = app.test_client()
    headers = login(client, "two-runs@example.test")
    created = create_game(client, headers)

    def record(profile_id: str) -> None:
        with app.app_context():
            profile = PlayerProfile.query.filter_by(id=profile_id).one()
            for kind, source in content_keys.items():
                _ledger(profile, kind, source, -1, {"note": "scoping"})
            db.session.commit()

    record(created["id"])
    restarted = _replace_profile(app, client, headers, created["id"])
    # Would raise IntegrityError on uq_ledger_source before the keys were scoped.
    record(restarted["id"])

    with app.app_context():
        user_id = PlayerProfile.query.filter_by(id=restarted["id"]).one().user_id
        for kind, source in content_keys.items():
            rows = LedgerEntry.query.filter_by(user_id=user_id, kind=kind).all()
            recorded = {row.source_id for row in rows if row.source_id.endswith(f":{source}")}
            assert recorded == {f'{created["id"]}:{source}', f'{restarted["id"]}:{source}'}

        # The opening balance is keyed on the profile id alone and needs no prefix,
        # so each playthrough still contributes exactly one.
        opening = LedgerEntry.query.filter_by(user_id=user_id, kind="opening_balance").all()
        assert {row.source_id for row in opening} == {created["id"], restarted["id"]}

        profile = PlayerProfile.query.filter_by(id=restarted["id"]).one()
        assert _scoped_source(profile, "repaired_desk") == f'{restarted["id"]}:repaired_desk'
        # An over-long key loses its tail rather than the profile it belongs to.
        scoped = _scoped_source(profile, "x" * 200)
        assert len(scoped) == 100
        assert scoped.startswith(f'{restarted["id"]}:')


def test_every_strategy_carries_student_facing_copy(app):
    with app.app_context():
        from app.strategies import STRATEGIES, serialize_strategy, strategy_catalog

        catalog = strategy_catalog()
        assert len(catalog) == len(STRATEGIES)
        for strategy in catalog:
            for field in ("plain_title", "plain_subject", "plain_line"):
                assert strategy[field].strip(), f"{strategy['key']} is missing {field}"
            assert strategy["plain_title"] != strategy["title"]
            assert len(strategy["steps"]) == 3

        served = serialize_strategy("negation_test")
        assert served["plain_title"] == "Negate the answer"
        assert served["plain_subject"] == "Negating the answer"
        assert served["title"] == "Necessary-Assumption Negation"


def test_review_queue_tracks_pending_grade_state(app):
    with app.app_context():
        columns = {column.name for column in ReviewQueueItem.__table__.columns}
        assert "grade_pending" in columns
        assert "pre_grade_interval_index" in columns
        assert ReviewQueueItem.__table__.c.grade_pending.nullable is False
        assert ReviewQueueItem.__table__.c.pre_grade_interval_index.nullable is True


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
        json={"item_id": session["current_item"]["id"], "selected_label": "C", "strategy_applied": True, "reasoning": "C is right."},
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
            "strategy_applied": True,
            "reasoning": "C follows from the premise and the others overreach here.",
        },
        headers={**headers, "Idempotency-Key": "deep-too-short"},
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "reasoning_too_short"


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
    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "confidence": 5,
            # Long enough to clear the floor, but still says nothing about the
            # argument — exactly the answer the grader should call unsupported.
            "reasoning": (
                "It just felt like the best available answer to me on this one, and the others "
                "looked wrong somehow, so I went with my gut and moved on to the next question."
            ),
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
    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "confidence": 5,
            "reasoning": explanation("the controlling relationship"),
        },
        headers={**headers, "Idempotency-Key": "earned-right"},
    ).json["result"]

    with app.app_context():
        _graded_attempt(answered["attempt_id"], 0.90)
        assert ReviewQueueItem.query.count() == 0


def test_session_items_record_review_queue_origin(app):
    with app.app_context():
        columns = {column.name for column in SessionItem.__table__.columns}
        assert "from_review_queue" in columns
        assert SessionItem.__table__.c.from_review_queue.nullable is False


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


def test_one_run_can_both_advance_a_repair_and_enqueue_a_fresh_miss(app, monkeypatch):
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

    # Position 0 is the repair: a correct answer with a Good explanation advances it.
    first = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "confidence": 4,
            "reasoning": explanation("the repaired question"),
        },
        headers={**headers, "Idempotency-Key": "mixed-repair"},
    ).json["result"]
    coach_and_settle(app, monkeypatch, first["attempt_id"], grade=65)
    client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    with app.app_context():
        card = ReviewQueueItem.query.filter_by(question_id=repaired_id).one()
        assert card.interval_index == 1

    # Position 1 is fresh: a high-confidence miss must enter the queue at zero.
    current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
    second = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": current["current_item"]["id"],
            "selected_label": "A",
            "strategy_applied": True,
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
            practice_style="cases",
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
            # The ladder advances for items seeded from the queue, which is now
            # a property of the item rather than of the whole run.
            from_review_queue=True,
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


def test_landing_grade_revises_the_provisional_schedule(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "backfill@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "confidence": 5,
            "reasoning": (
                "I picked C because it seemed the most likely of the five choices, and none of "
                "the other options jumped out at me as obviously better than it did on a reread."
            ),
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


def test_strategy_scoring_weighs_explanation_quality(app, monkeypatch):
    """Candidates tied on accuracy, pace, and calibration separate on explanation quality.

    Drives assign_strategy_trial rather than restating its arithmetic, so the test
    fails if the explanation term is ever dropped. _stable_fraction is pinned to
    0.5 to disable the 30% explore branch and the 25% control arm, leaving the
    assigned key equal to the top-ranked candidate.
    """
    with app.app_context():
        from app.strategies import _candidate_keys

        user = User(email="strategy-weight@example.test", display_name="Weight")
        db.session.add(user)
        db.session.flush()
        question = Question.query.filter_by(section="Logical Reasoning").first()
        candidates = _candidate_keys(question)
        assert len(candidates) >= 2

        # The best-explained candidate is the alphabetically first one. Before the
        # explanation term exists every candidate ties, and the sort's reverse
        # tiebreak on the key name picks the alphabetically last one instead.
        best = sorted(candidates)[0]

        session = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="deep",
            feedback_policy="immediate",
            target_minutes=10,
            total_items=len(candidates) * 3,
        )
        db.session.add(session)
        db.session.flush()
        position = 0
        for candidate in candidates:
            for _ in range(3):
                item = SessionItem(
                    session_id=session.id,
                    question_id=question.id,
                    position=position,
                    requires_reasoning=True,
                    target_time_seconds=150,
                    strategy_key=candidate,
                    strategy_variant="prompt",
                )
                db.session.add(item)
                db.session.flush()
                db.session.add(
                    Attempt(
                        user_id=user.id,
                        session_item_id=item.id,
                        idempotency_key=f"weigh-{candidate}-{position}",
                        selected_label=question.correct_answer,
                        is_correct=True,
                        reasoning_text=explanation(f"weighted attempt {position}"),
                        confidence=4,
                        server_elapsed_ms=60_000,
                        strategy_key=candidate,
                        strategy_variant="prompt",
                        strategy_applied=True,
                        explanation_score=0.95 if candidate == best else 0.05,
                    )
                )
                position += 1
        db.session.commit()

        monkeypatch.setattr("app.strategies._stable_fraction", lambda _value: 0.5)

        from app.strategies import assign_strategy_trial

        trial = assign_strategy_trial(user.id, question, "deep", 2)
        assert trial is not None
        assert trial["variant"] == "prompt"
        assert trial["key"] == best


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


def test_explanation_floor_boundary_matches_the_published_minimum(app):
    """The served floor is exactly the enforced floor.

    The client enables submit at ``length >= reasoning_min_chars`` while the server
    rejects at ``len < reasoning_min_chars``. An off-by-one on either side would
    leave the button enabled on an answer the API refuses, so assert the boundary
    from both directions.
    """
    floor = 120
    client = app.test_client()
    headers = login(client, "boundary-cases@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    item_id = session["current_item"]["id"]
    assert session["current_item"]["reasoning_min_chars"] == floor

    under = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": item_id, "selected_label": "C", "strategy_applied": True, "reasoning": "x" * (floor - 1)},
        headers={**headers, "Idempotency-Key": "under-cases"},
    )
    assert under.status_code == 400
    assert under.json["error"]["code"] == "reasoning_too_short"

    exact = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": item_id, "selected_label": "C", "strategy_applied": True, "reasoning": "y" * floor},
        headers={**headers, "Idempotency-Key": "exact-cases"},
    )
    assert exact.status_code == 200
