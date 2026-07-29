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
    duplicate_start = client.post("/v1/study-sessions", headers=headers)
    assert duplicate_start.status_code == 201
    assert duplicate_start.json["session"]["id"] == session["id"]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert [item.question_id for item in items] == chosen_ids
        assert all(item.question.source.startswith(SOURCE_PREFIX) for item in items)
        assert all(not hasattr(item, "story_json") for item in items)
        assert all(item.requires_reasoning is True for item in items)
        assert all(item.target_time_seconds in {135, 150, 330} for item in items)
        assert items[0].game_context_json
        assert all(item.game_context_json is None for item in items[1:])

    diagnostics = client.get("/v1/diagnostics/current", headers=headers)
    assert diagnostics.status_code == 200
    assert diagnostics.json == {"session": None, "latest": None}
    assert client.get("/v1/story/progress").status_code == 404


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


def test_speedrun_size_and_focus_are_bounded(app):
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


def test_answer_only_speedrun_redacts_feedback_stays_neutral_and_seeds_review(app):
    client = app.test_client()
    headers = login(client, "answer-only-speedrun@example.test")
    created = create_game(client, headers)

    started = client.post(
        "/v1/study-sessions",
        json={"size": 2, "practice_style": "speedrun", "feedback_policy": "delayed"},
        headers=headers,
    )
    assert started.status_code == 201
    session = started.json["session"]
    assert session["practice_style"] == "speedrun"
    assert session["feedback_policy"] == "delayed"
    assert session["current_item"]["requires_reasoning"] is True
    assert session["current_item"]["case_terms"] is None

    first = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "A",
            "confidence": 5,
            "reasoning": explanation("the first sprint answer"),
        },
        headers={**headers, "Idempotency-Key": "speedrun-delayed-one"},
    )
    assert first.status_code == 200
    first_result = first.json["result"]
    assert first_result["feedback_released"] is False
    assert "is_correct" not in first_result
    assert "feedback" not in first_result
    assert first_result["game_reward"] is None

    resumed = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
    second = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": resumed["current_item"]["id"],
            "selected_label": "C",
            "confidence": 5,
            "reasoning": explanation("the resumed sprint answer"),
        },
        headers={**headers, "Idempotency-Key": "speedrun-delayed-two"},
    )
    assert second.status_code == 200
    assert second.json["result"]["feedback_released"] is False
    assert second.json["result"]["session_complete"] is True

    review = client.get(f"/v1/study-sessions/{session['id']}/review", headers=headers)
    assert review.status_code == 200
    assert review.json["review"]["summary"]["correct"] == 1
    assert len(review.json["review"]["items"]) == 2
    assert review.json["review"]["items"][0]["selected_label"] == "A"
    assert review.json["review"]["items"][0]["correct_label"] == "C"
    assert review.json["review"]["items"][0]["evidence_class"] == "timed_unseen"

    queue = client.get("/v1/reviews", headers=headers)
    assert queue.status_code == 200
    assert queue.json["review_queue"]["due"] == 1
    assert queue.json["review_queue"]["items"][0]["reason_code"] == "high_confidence_error"

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        attempts = (
            Attempt.query.join(SessionItem)
            .filter(SessionItem.session_id == session["id"])
            .order_by(Attempt.created_at)
            .all()
        )
        assert profile.cash == 250
        assert profile.total_cases == 0
        assert all(attempt.evidence_class == "timed_unseen" for attempt in attempts)
        assert all(attempt.settlement is None for attempt in attempts)


def test_daily_docket_drives_speedrun_into_priority_deep_brief(app):
    client = app.test_client()
    headers = login(client, "daily-docket@example.test")
    create_game(client, headers)

    fresh = client.get("/v1/daily-docket?timezone=America/Chicago", headers=headers)
    assert fresh.status_code == 200
    docket = fresh.json["daily_docket"]
    assert docket["timezone"] == "America/Chicago"
    assert docket["review"]["state"] == "clear"
    assert docket["speedrun"]["state"] == "ready"
    assert docket["deep_brief"]["state"] == "locked"
    assert docket["next_action"]["kind"] == "start_speedrun"

    session = client.post(
        "/v1/study-sessions",
        json={"size": 5, "practice_style": "speedrun", "feedback_policy": "delayed"},
        headers=headers,
    ).json["session"]
    for index in range(5):
        current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
        answer = "A" if index == 0 else "C"
        response = client.post(
            f"/v1/study-sessions/{session['id']}/attempts",
            json={
                "item_id": current["current_item"]["id"],
                "selected_label": answer,
                "confidence": 5,
                "reasoning": explanation(f"docket question {index}"),
            },
            headers={**headers, "Idempotency-Key": f"daily-docket-{index}"},
        )
        assert response.status_code == 200

    review = client.get(f"/v1/study-sessions/{session['id']}/review", headers=headers)
    assert review.status_code == 200
    first_item = review.json["review"]["items"][0]
    assert first_item["priority_reason"] == "high_confidence_miss"
    assert first_item["target_time_seconds"] in {135, 150, 330}

    briefing = client.get("/v1/daily-docket?timezone=America/Chicago", headers=headers).json["daily_docket"]
    assert briefing["speedrun"]["state"] == "complete"
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


def test_infinite_and_review_are_immediate_neutral_and_timezone_safe(app):
    client = app.test_client()
    headers = login(client, "infinite-review@example.test")
    created = create_game(client, headers)

    # Seed one due review with a neutral Sprint miss.
    sprint = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "speedrun"},
        headers=headers,
    ).json["session"]
    client.post(
        f"/v1/study-sessions/{sprint['id']}/attempts",
        json={
            "item_id": sprint["current_item"]["id"],
            "selected_label": "A",
            "confidence": 4,
            "reasoning": explanation("the seeded sprint miss"),
        },
        headers={**headers, "Idempotency-Key": "review-seed-miss"},
    )

    review_session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "review"},
        headers=headers,
    )
    assert review_session.status_code == 201
    review_session = review_session.json["session"]
    assert review_session["feedback_policy"] == "immediate"
    assert review_session["current_item"]["requires_reasoning"] is True
    reviewed = client.post(
        f"/v1/study-sessions/{review_session['id']}/attempts",
        json={
            "item_id": review_session["current_item"]["id"],
            "selected_label": "C",
            "reasoning": "C is the only choice directly supported by the stated relationship, and each other option either reverses that relationship or introduces a term the passage never establishes.",
            "confidence": 4,
        },
        headers={**headers, "Idempotency-Key": "spaced-review-correct"},
    )
    assert reviewed.status_code == 200
    assert reviewed.json["result"]["feedback_released"] is True
    assert reviewed.json["result"]["is_correct"] is True
    assert reviewed.json["result"]["game_reward"] is None
    client.post(f"/v1/study-sessions/{review_session['id']}/debrief/acknowledge", headers=headers)

    # Reading the future-due row exercises SQLite's naive timestamp behavior.
    queue = client.get("/v1/reviews", headers=headers)
    assert queue.status_code == 200
    assert queue.json["review_queue"]["due"] == 0
    assert queue.json["review_queue"]["scheduled"] == 1
    performance = client.get("/v1/performance", headers=headers)
    assert performance.status_code == 200
    assert performance.json["performance"]["review"]["scheduled"] == 1

    infinite = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "infinite"},
        headers=headers,
    )
    assert infinite.status_code == 201
    infinite = infinite.json["session"]
    assert infinite["feedback_policy"] == "immediate"
    assert infinite["current_item"]["requires_reasoning"] is True
    answered = client.post(
        f"/v1/study-sessions/{infinite['id']}/attempts",
        json={
            "item_id": infinite["current_item"]["id"],
            "selected_label": "C",
            "confidence": 5,
            "reasoning": explanation("the infinite-run answer"),
        },
        headers={**headers, "Idempotency-Key": "infinite-answer"},
    )
    assert answered.status_code == 200
    assert answered.json["result"]["feedback_released"] is True
    assert answered.json["result"]["game_reward"] is None
    client.post(f"/v1/study-sessions/{infinite['id']}/debrief/acknowledge", headers=headers)
    finished = client.post(f"/v1/study-sessions/{infinite['id']}/finish", headers=headers)
    assert finished.status_code == 200
    assert finished.json["session"]["ended_by_user"] is True
    assert finished.json["session"]["total_items"] == 1
    summary = client.get(f"/v1/study-sessions/{infinite['id']}", headers=headers).json["summary"]
    assert summary["questions_completed"] == 1
    assert summary["omitted"] == 0

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert profile.cash == 250
        assert profile.total_cases == 0
        evidence = {
            attempt.evidence_class
            for attempt in Attempt.query.filter_by(user_id=profile.user_id).all()
        }
        assert {"timed_unseen", "spaced_review", "fluency"}.issubset(evidence)
        assert AttemptSettlement.query.filter_by(user_id=profile.user_id).count() == 0
        review_item = ReviewQueueItem.query.filter_by(user_id=profile.user_id).one()
        assert review_item.interval_index == 1


@pytest.mark.parametrize(
    ("practice_style", "feedback_policy"),
    [
        ("speedrun", "immediate"),
        ("deep", "delayed"),
        ("infinite", "delayed"),
        ("review", "delayed"),
    ],
)
def test_learning_mode_feedback_policies_are_server_bound(app, practice_style, feedback_policy):
    client = app.test_client()
    headers = login(client, f"policy-{practice_style}@example.test")
    create_game(client, headers)
    response = client.post(
        "/v1/study-sessions",
        json={
            "size": 1,
            "practice_style": practice_style,
            "feedback_policy": feedback_policy,
        },
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "invalid_feedback_policy"


def test_completed_speedrun_stops_at_training_lab_boundary(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "completed-speedrun@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 1}, headers=headers).json["session"]
    answered = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
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
        assert LedgerEntry.query.filter_by(
            user_id=attempt.user_id,
            kind="case_payout",
            source_id=attempt.id,
        ).count() == 1

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
        assert LedgerEntry.query.filter_by(user_id=attempt.user_id, kind="case_payout", source_id=attempt.id).count() == 1
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
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


def test_strategy_trials_are_sparse_and_never_contaminate_measurement_modes(app):
    client = app.test_client()
    headers = login(client, "strategy-cadence@example.test")
    create_game(client, headers)
    session = client.post(
        "/v1/study-sessions",
        json={"size": 7, "practice_style": "deep"},
        headers=headers,
    ).json["session"]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert [item.position for item in items if item.strategy_key] == [2, 6]
        assert all(item.strategy_variant in {"prompt", "control"} for item in items if item.strategy_key)

        from app.strategies import assign_strategy_trial

        user = User.query.filter_by(email="strategy-cadence@example.test").one()
        question = Question.query.order_by(Question.id).first()
        assert assign_strategy_trial(user.id, question, "speedrun", 2) is None
        assert assign_strategy_trial(user.id, question, "review", 2) is None
        assert assign_strategy_trial(user.id, question, "deep", 1) is None
        assert assign_strategy_trial(user.id, question, "infinite", 2) is not None


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
    session = client.post(
        "/v1/study-sessions",
        json={"size": 1, "practice_style": "deep"},
        headers=headers,
    ).json["session"]
    item_id = session["current_item"]["id"]
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
