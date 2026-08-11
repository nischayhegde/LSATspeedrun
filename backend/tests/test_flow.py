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
    DAILY_REWARD_MULTIPLIERS,
    FINAL_CASE_KEY,
    FIRM_TIERS,
    TIER_GATED_ASSET_TYPES,
    UNGRADED_CREDIT,
    UNGRADED_MULTIPLIER,
    WARDROBE_CATEGORY_KEYS,
    WARDROBE_DEFAULTS,
    daily_reward_for_tier,
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
    SessionSection,
    StudySession,
    User,
    utcnow,
)
from app.seed import SOURCE_PREFIX, seed_questions
from app.story import QUESTS, STORY_CHAPTERS


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
            # Tests drive the worker directly rather than through a background
            # thread: an in-memory SQLite database is not visible to another
            # connection, so the transport is always chosen explicitly here.
            "AI_JOBS_MODE": "sync",
            # These cases exercise the economy, coaching, and scheduling paths,
            # where a strategy prompt is incidental scenery. Strategy gates get
            # their own module (tests/test_enforcement.py) which runs at the
            # production default instead of turning it off here.
            "STRATEGY_ENFORCEMENT_ENABLED": False,
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


def test_declared_target_score_defaults_new_user_into_focus_mode(app):
    """168+ sets Focus Mode automatically, but only while onboarding is open."""
    client = app.test_client()
    headers = login(client, "focus-declared@example.test")

    response = client.patch("/v1/me", json={"target_score": 172}, headers=headers)
    assert response.status_code == 200
    assert response.json["user"]["target_score"] == 172
    assert response.json["user"]["assistance_level"] == "focus"

    # Onboarding is over now (a profile exists); a later target-score edit must
    # not silently flip the toggle the student may have already set back.
    create_game(client, headers)
    client.patch("/v1/me", json={"assistance_level": "full"}, headers=headers)
    response = client.patch("/v1/me", json={"target_score": 178}, headers=headers)
    assert response.status_code == 200
    assert response.json["user"]["assistance_level"] == "full"


def test_declared_test_date_inside_eight_weeks_defaults_into_focus_mode(app):
    client = app.test_client()
    headers = login(client, "focus-date@example.test")
    soon = (utcnow().date() + timedelta(weeks=4)).isoformat()
    response = client.patch("/v1/me", json={"target_test_date": soon}, headers=headers)
    assert response.status_code == 200
    assert response.json["user"]["assistance_level"] == "focus"


def test_a_modest_target_leaves_the_full_experience_on_by_default(app):
    client = app.test_client()
    headers = login(client, "focus-modest@example.test")
    far_out = (utcnow().date() + timedelta(weeks=20)).isoformat()
    response = client.patch("/v1/me", json={"target_score": 155, "target_test_date": far_out}, headers=headers)
    assert response.status_code == 200
    assert response.json["user"]["assistance_level"] == "full"


def test_assistance_level_toggle_is_explicit_and_persists(app):
    client = app.test_client()
    headers = login(client, "focus-toggle@example.test")
    create_game(client, headers)
    response = client.patch("/v1/me", json={"assistance_level": "focus"}, headers=headers)
    assert response.status_code == 200
    assert response.json["user"]["assistance_level"] == "focus"
    assert client.get("/v1/me", headers=headers).json["user"]["assistance_level"] == "focus"

    invalid = client.patch("/v1/me", json={"assistance_level": "minimal"}, headers=headers)
    assert invalid.status_code == 400
    assert invalid.json["error"]["code"] == "invalid_assistance_level"


def test_guided_tour_completion_is_recorded_on_the_account(app):
    """Whether the tour was finished or skipped lives with the account, so clearing
    browser storage or switching devices cannot force a player back through it."""
    client = app.test_client()
    headers = login(client, "tour-state@example.test")
    assert client.get("/v1/me", headers=headers).json["user"]["guided_tour_completed"] is False

    saved = client.patch("/v1/me", json={"guided_tour_completed": True}, headers=headers)
    assert saved.status_code == 200
    assert saved.json["user"]["guided_tour_completed"] is True

    fresh = app.test_client()
    revisit = login(fresh, "tour-state@example.test")
    assert fresh.get("/v1/me", headers=revisit).json["user"]["guided_tour_completed"] is True

    # Replaying the tour is a local action; a client cannot clear the account flag.
    cleared = client.patch("/v1/me", json={"guided_tour_completed": False}, headers=headers)
    assert cleared.json["user"]["guided_tour_completed"] is True


def test_epilogue_acknowledgement_is_recorded_on_the_account(app):
    """Reading the closing record is an account fact, not a browser fact — the
    same policy as the guided tour above. A finished player who opens the app on
    another device must not be handed the full-screen final record again."""
    client = app.test_client()
    headers = login(client, "epilogue-state@example.test")
    create_game(client, headers)
    assert client.get("/v1/game/story/epilogue", headers=headers).json["read"] is False

    saved = client.post("/v1/game/story/epilogue/read", headers=headers)
    assert saved.status_code == 200
    assert saved.json["read"] is True

    fresh = app.test_client()
    revisit = login(fresh, "epilogue-state@example.test")
    assert fresh.get("/v1/game/story/epilogue", headers=revisit).json["read"] is True

    # Idempotent: closing it again does not move the recorded moment.
    assert client.post("/v1/game/story/epilogue/read", headers=headers).json["read"] is True


def test_epilogue_acknowledgement_requires_a_firm(app):
    client = app.test_client()
    headers = login(client, "epilogue-no-firm@example.test")
    assert client.get("/v1/game/story/epilogue", headers=headers).json["read"] is False
    blocked = client.post("/v1/game/story/epilogue/read", headers=headers)
    assert blocked.status_code == 409
    assert blocked.json["error"]["code"] == "onboarding_required"


def test_wardrobe_starts_as_issued_and_saves_an_unlocked_choice(app):
    client = app.test_client()
    headers = login(client, "wardrobe-save@example.test")
    created = create_game(client, headers, gender="male")
    assert created["cosmetics"] == WARDROBE_DEFAULTS

    catalog = client.get("/v1/game/cosmetics", headers=headers)
    assert catalog.status_code == 200
    assert catalog.json["cosmetics"]["selection"] == WARDROBE_DEFAULTS
    assert [category["key"] for category in catalog.json["cosmetics"]["categories"]] == WARDROBE_CATEGORY_KEYS

    saved = client.patch(
        "/v1/game/cosmetics",
        json={"selection": {"suit": "suit_charcoal", "eyewear": "eyewear_round"}},
        headers=headers,
    )
    assert saved.status_code == 200
    assert saved.json["cosmetics"]["selection"]["suit"] == "suit_charcoal"
    assert saved.json["cosmetics"]["selection"]["eyewear"] == "eyewear_round"
    # Categories the request did not name keep whatever they were wearing.
    assert saved.json["cosmetics"]["selection"]["tie"] == WARDROBE_DEFAULTS["tie"]
    assert saved.json["game"]["cosmetics"]["suit"] == "suit_charcoal"

    # And it is the account's look, not the browser's.
    fresh = app.test_client()
    revisit = login(fresh, "wardrobe-save@example.test")
    assert fresh.get("/v1/game", headers=revisit).json["game"]["cosmetics"]["suit"] == "suit_charcoal"


def test_wardrobe_issues_the_female_cut_the_collar_she_has_always_worn(app):
    """The two cuts are drawn differently, so their issued neckwear differs.

    Both pieces are in the catalog for either character; only the one that
    arrives unchosen follows the cut, which is what keeps a new account looking
    exactly as it did before the wardrobe existed.
    """
    client = app.test_client()
    headers = login(client, "wardrobe-collar@example.test")
    created = create_game(client, headers, gender="female")
    assert created["cosmetics"]["tie"] == "tie_open_collar"

    catalog = client.get("/v1/game/cosmetics", headers=headers).json["cosmetics"]
    neckwear = next(category for category in catalog["categories"] if category["key"] == "tie")
    assert neckwear["default"] == "tie_open_collar"
    assert neckwear["selected"] == "tie_open_collar"

    # And she can still put the house tie on, which is the whole point of it
    # being a catalog piece rather than a property of the cut.
    worn = client.patch("/v1/game/cosmetics", json={"selection": {"tie": "tie_house_burgundy"}}, headers=headers)
    assert worn.status_code == 200
    assert worn.json["game"]["cosmetics"]["tie"] == "tie_house_burgundy"


def test_wardrobe_refuses_pieces_the_player_has_not_earned(app):
    client = app.test_client()
    headers = login(client, "wardrobe-locked@example.test")
    created = create_game(client, headers)

    locked = client.patch("/v1/game/cosmetics", json={"selection": {"suit": "suit_forest"}}, headers=headers)
    assert locked.status_code == 409
    assert locked.json["error"]["code"] == "cosmetic_locked"
    assert client.get("/v1/game", headers=headers).json["game"]["cosmetics"]["suit"] == WARDROBE_DEFAULTS["suit"]

    unknown = client.patch("/v1/game/cosmetics", json={"selection": {"suit": "suit_of_armour"}}, headers=headers)
    assert unknown.status_code == 404
    assert unknown.json["error"]["code"] == "cosmetic_not_found"

    # A real key filed under the wrong category is refused too, so the category
    # a piece was authored in is the only place it can ever be worn.
    misfiled = client.patch("/v1/game/cosmetics", json={"selection": {"tie": "suit_charcoal"}}, headers=headers)
    assert misfiled.status_code == 404
    assert misfiled.json["error"]["code"] == "cosmetic_not_found"

    nonsense = client.patch("/v1/game/cosmetics", json={"selection": {"hat": "suit_charcoal"}}, headers=headers)
    assert nonsense.status_code == 404
    assert nonsense.json["error"]["code"] == "cosmetic_category_not_found"

    # The same request succeeds once the firm has actually reached the tier.
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 3
        db.session.commit()
    earned = client.patch("/v1/game/cosmetics", json={"selection": {"suit": "suit_forest"}}, headers=headers)
    assert earned.status_code == 200
    assert earned.json["cosmetics"]["selection"]["suit"] == "suit_forest"


def test_wardrobe_marks_progression_pieces_unlocked_as_the_campaign_advances(app):
    client = app.test_client()
    headers = login(client, "wardrobe-progress@example.test")
    created = create_game(client, headers)

    def state(key: str) -> bool:
        payload = client.get("/v1/game/cosmetics", headers=headers).json["cosmetics"]
        return next(
            item
            for category in payload["categories"]
            for item in category["items"]
            if item["key"] == key
        )["unlocked"]

    assert state("accessory_briefcase") is False
    assert state("tie_cravat") is False
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.total_cases = 100
        story = profile.story_state
        story.seen_chapters_json = ["charter_of_counsel"]
        db.session.commit()
    assert state("accessory_briefcase") is True
    assert state("tie_cravat") is True


def test_wardrobe_requires_a_firm(app):
    client = app.test_client()
    headers = login(client, "wardrobe-no-firm@example.test")
    assert client.get("/v1/game/cosmetics", headers=headers).status_code == 409
    blocked = client.patch("/v1/game/cosmetics", json={"selection": {"suit": "suit_charcoal"}}, headers=headers)
    assert blocked.status_code == 409
    assert blocked.json["error"]["code"] == "onboarding_required"


def test_target_score_out_of_range_is_rejected(app):
    client = app.test_client()
    headers = login(client, "focus-invalid@example.test")
    response = client.patch("/v1/me", json={"target_score": 300}, headers=headers)
    assert response.status_code == 400
    assert response.json["error"]["code"] == "invalid_target_score"


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


def test_claiming_every_daily_goal_is_a_bonus_not_a_free_office(app):
    """End to end: what a full day of daily goals actually pays into the bank.

    The reward used to be `max(flat_floor, active_client_fee * multiplier)` with
    floors of 500/1500/4000 authored when a case fee was 5.6x larger. A brand
    new player could claim 6,000 on day one against a 3,800 first upgrade and a
    6,000 first headquarters, so a day of dailies *was* the office and the early
    game ran at half the length the pace band set. It is now priced off the
    tier's own case value (DAILY_REWARD_CASE_BUDGET), and this exercises the
    real endpoint, the ledger, and the numbers the claim screen renders.
    """
    client = app.test_client()
    headers = login(client, "daily-rewards@example.test")
    created = create_game(client, headers)

    # Read off the catalog rather than retyped as 5/10/20: the milestones are
    # one, two and three sittings and moved when the sitting did.
    milestones = sorted(DAILY_REWARD_MULTIPLIERS)
    smallest, middle, largest = milestones
    expected = {milestone: daily_reward_for_tier(0, milestone) for milestone in milestones}
    assert [goal["reward"] for goal in created["daily"]["goals"]] == [expected[m] for m in milestones]
    assert not any(goal["complete"] for goal in created["daily"]["goals"])

    # Nothing is claimable before the cases are actually worked.
    refused = client.post(f"/v1/game/daily-rewards/{smallest}/claim", headers=headers)
    assert refused.status_code == 409 and refused.json["error"]["code"] == "goal_incomplete"
    not_a_goal = next(value for value in range(1, 100) if value not in DAILY_REWARD_MULTIPLIERS)
    invalid = client.post(f"/v1/game/daily-rewards/{not_a_goal}/claim", headers=headers)
    assert invalid.status_code == 409 and invalid.json["error"]["code"] == "invalid_milestone"

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        progress = DailyProgress.query.filter_by(profile_id=profile.id).one()
        progress.cases_completed = largest
        db.session.commit()

    banked = 0
    for milestone in milestones:
        response = client.post(f"/v1/game/daily-rewards/{milestone}/claim", headers=headers)
        assert response.status_code == 200, response.json
        assert response.json["claimed"] == expected[milestone]
        banked += response.json["claimed"]
        repeated = client.post(f"/v1/game/daily-rewards/{milestone}/claim", headers=headers)
        assert repeated.status_code == 409 and repeated.json["error"]["code"] == "already_claimed"

    # Escalating, so the last goal of the day is the one worth staying for.
    assert expected[smallest] < expected[middle] < expected[largest]
    assert expected[largest] > banked / 2

    # And the whole day is a fraction of the cheapest thing the ladder makes
    # the player buy, rather than the whole of it.
    first_upgrade = ASSET_BY_KEY["repaired_desk"]["cost"]
    assert banked < first_upgrade * .2, f"{banked:,} against a {first_upgrade:,} upgrade"
    assert banked > first_upgrade * .05

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert profile.cash == 250 + banked
        assert profile.lifetime_earnings == 250 + banked
        rewards = LedgerEntry.query.filter_by(user_id=profile.user_id, kind="daily_reward").all()
        assert sorted(entry.amount for entry in rewards) == sorted(expected.values())

        # A bigger office pays a bigger daily, without the client on the desk
        # having anything to do with it.
        profile.office_tier = 3
        db.session.commit()
    promoted = client.get("/v1/game", headers=headers).json["game"]
    assert [goal["reward"] for goal in promoted["daily"]["goals"]] == [
        daily_reward_for_tier(3, milestone) for milestone in milestones
    ]
    assert promoted["daily"]["goals"][2]["reward"] > expected[largest]


def test_the_working_day_streak_counts_finished_cases_not_page_loads(app):
    """The calendar-day streak is distinct from the validated-win streak.

    It advances once per new day on which the player *finishes a case*, resets on
    a missed day, and remembers the best run -- independent of
    `current_streak`/`best_streak`. It used to advance from `settle_upkeep`,
    which runs on every protected route, so simply loading a page kept it alive;
    this pins the fact that it no longer does.
    """
    from backend.app.game import _touch_daily_streak

    client = app.test_client()
    headers = login(client, "daily-streak@example.test")
    created = create_game(client, headers)
    assert created["daily_streak"] == 1
    assert created["daily_streak_best"] == 1
    # Pinned to noon so a same-day offset of a few hours can never cross a
    # midnight boundary regardless of when the suite happens to run.
    now = utcnow().replace(hour=12, minute=0, second=0, microsecond=0)

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.daily_streak_last_date = now.date()
        db.session.commit()

        # Merely being on a page the next day does nothing at all now.
        settle_upkeep(profile, now + timedelta(days=1))
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert profile.daily_streak_current == 1

        # A second finished case later the same day does not double-count.
        _touch_daily_streak(profile, now + timedelta(hours=6))
        assert profile.daily_streak_current == 1

        # A case finished exactly one calendar day later extends the streak.
        next_day = now + timedelta(days=1)
        _touch_daily_streak(profile, next_day)
        assert profile.daily_streak_current == 2
        assert profile.daily_streak_best == 2

        # Skipping a day resets the current streak but keeps the best one.
        after_gap = next_day + timedelta(days=3)
        _touch_daily_streak(profile, after_gap)
        assert profile.daily_streak_current == 1
        assert profile.daily_streak_best == 2

        # Extending past the old best updates it again.
        for extra_day in range(1, 3):
            _touch_daily_streak(profile, after_gap + timedelta(days=extra_day))
        assert profile.daily_streak_current == 3
        assert profile.daily_streak_best == 3
        db.session.rollback()


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
    # Practice now fills a run with whole passage blocks taken in shuffled
    # order, so pinning the shuffle is what makes the run deterministic;
    # `random.sample` is no longer the selector for the practice path.
    monkeypatch.setattr("app.services.random.shuffle", lambda values: None)
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
    assert session["current_item"]["case_terms"] == {
        "client_key": "walk_in",
        "client_name": "Walk-in client",
        "base_fee": CLIENT_BY_KEY["walk_in"]["base_fee"],
    }
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        chosen_ids = [item.question_id for item in items]
        # The item served first is position 0, and the run is three distinct
        # questions drawn from the seeded bank.
        assert session["current_item"]["question"]["id"] == chosen_ids[0]
        assert len(set(chosen_ids)) == 3
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
    assert active_list.json["queue_cap"] == app.config["PRACTICE_QUEUE_MAX"]
    assert active_list.json["session_size"] == app.config["PRACTICE_SESSION_SIZE"]
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

    # The cap is derived from how much queued work is allowed, in questions, so
    # it moves whenever the run length does — see `PRACTICE_QUEUE_QUESTIONS`.
    cap = app.config["PRACTICE_QUEUE_MAX"]
    started_ids = []
    for _ in range(cap):
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
    assert active.json["queue_cap"] == cap
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

    # A form takes answers onto its section's sheet, not one attempt at a time:
    # nothing is graded, and nothing is final, until the section closes.
    item = session["current_item"]
    refused = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": item["id"], "selected_label": "A"},
        headers={**headers, "Idempotency-Key": "diagnostic-answer-one"},
    )
    assert refused.status_code == 409
    assert refused.json["error"]["code"] == "exam_uses_answer_sheet"

    answered = client.put(
        f"/v1/study-sessions/{session['id']}/answers/{item['id']}",
        json={"selected_label": "A"},
        headers=headers,
    )
    assert answered.status_code == 200
    with app.app_context():
        # Recorded, but not yet an attempt: the section is still open.
        assert Attempt.query.count() == 0

    closed = client.post(
        f"/v1/study-sessions/{session['id']}/sections/0/submit",
        headers=headers,
    )
    assert closed.status_code == 200
    with app.app_context():
        attempt = Attempt.query.one()
        # A form pays nothing and grades no reasoning, so the only artefacts a
        # section leaves are the answer and the time it took.
        assert attempt.settlement is None
        assert attempt.reasoning_text is None
        assert attempt.evidence_class == "diagnostic"

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
    # `total_items`, not the 5 requested: a run that had to serve a Reading
    # Comprehension passage whole comes back a question longer, and leaving the
    # last one unanswered would leave the docket mid-run rather than complete.
    for index in range(session["total_items"]):
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
    """A well-stabilized row exercises SQLite's naive-timestamp behavior.

    SQLite drops timezone information even on timezone-aware columns while
    PostgreSQL preserves it, so the elapsed-days arithmetic behind
    retrievability has to cope with both. A card reviewed an hour ago with a
    fortnight of stability is nowhere near the retention target and must read
    back as scheduled-but-not-due on either database.
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
        row.last_grade = 3
        row.stability = 14.0
        row.difficulty = 5.0
        row.last_reviewed_at = utcnow() - timedelta(hours=1)
        row.due_at = utcnow() + timedelta(days=10)
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
    assert client.get("/v1/study-sessions/current", headers=headers).json["session"] is None


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
    assert coaching["prompt_version"] == "coaching-v3-invalid-is-a-finding"
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


def _answer_one_case(app, client, headers, key: str, *, selected: str = "C") -> dict:
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    result = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": selected,
            "strategy_applied": True,
            "reasoning": explanation(f"the step {key} turns on"),
        },
        headers={**headers, "Idempotency-Key": key},
    ).json["result"]
    return {"session_id": session["id"], "attempt_id": result["attempt_id"]}


def test_local_mode_hands_coaching_to_a_background_worker(app, monkeypatch):
    """The default transport keeps a 20-30 second grading call out of the request:
    the POST returns a job immediately and the same durable AiJob row carries it."""
    from app.jobs import process_ai_job

    client = app.test_client()
    headers = login(client, "local-worker@example.test")
    create_game(client, headers)
    answered = _answer_one_case(app, client, headers, "local-worker-answer")

    started = []
    monkeypatch.setitem(app.config, "TFY_URL", "https://truefoundry.example/v1")
    monkeypatch.setitem(app.config, "TFY_API_KEY", "test-key")
    monkeypatch.setitem(app.config, "AI_JOBS_MODE", "local")
    # The real dispatcher would run this on a thread, which cannot see an
    # in-memory SQLite database. Capture the handoff and drive it inline instead.
    monkeypatch.setattr("app.jobs._start_local_job", lambda job: started.append(job.id))
    coaching = {
        "explanation_grade": 82,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive step was named.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))

    accepted = client.post(f"/v1/attempts/{answered['attempt_id']}/coaching", headers=headers)
    assert accepted.status_code == 202
    assert accepted.json["job"]["status"] == "queued"
    job_id = accepted.json["job"]["id"]
    assert started == [job_id]
    # No queue URL is needed for the local transport, unlike the SQS one.
    assert client.get("/v1/health").json["async_jobs"] == {"mode": "local", "ready": True}

    with app.app_context():
        assert process_ai_job(job_id).status == "completed"
    settled = client.post(f"/v1/attempts/{answered['attempt_id']}/coaching", headers=headers)
    assert settled.json["status"] == "completed"
    assert settled.json["reward"]["payout"] > 0


def test_a_debrief_can_be_closed_while_grading_is_still_running(app, monkeypatch):
    """The player is not held on the debrief for the grading call. Once grading has
    been handed off, the next question opens and the case settles behind them."""
    client = app.test_client()
    headers = login(client, "nonblocking@example.test")
    create_game(client, headers)
    answered = _answer_one_case(app, client, headers, "nonblocking-answer")

    monkeypatch.setitem(app.config, "TFY_URL", "https://truefoundry.example/v1")
    monkeypatch.setitem(app.config, "TFY_API_KEY", "test-key")
    monkeypatch.setitem(app.config, "AI_JOBS_MODE", "local")
    monkeypatch.setattr("app.jobs._start_local_job", lambda _job: None)

    # Nothing has been sent for grading yet, so the settlement gate still holds.
    blocked = client.post(f"/v1/study-sessions/{answered['session_id']}/debrief/acknowledge", headers=headers)
    assert blocked.status_code == 409
    assert blocked.json["error"]["code"] == "settlement_required"

    assert client.post(f"/v1/attempts/{answered['attempt_id']}/coaching", headers=headers).status_code == 202
    moved_on = client.post(f"/v1/study-sessions/{answered['session_id']}/debrief/acknowledge", headers=headers)
    assert moved_on.status_code == 200
    assert moved_on.json["settlement_pending"] is True
    assert moved_on.json["session"]["current_item"]["position"] == 1

    coaching = {
        "explanation_grade": 82,
        "reasoning_verdict": "strong",
        "reasoning_summary": "Graded after the player moved on.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.jobs import process_ai_job
        from app.models import AiJob as AiJobModel
        from app.services import run_attempt_coaching  # noqa: F401 - imported by the worker

        job = AiJobModel.query.filter_by(dedup_key=f"coaching:{answered['attempt_id']}").one()
        assert process_ai_job(job.id).status == "completed"
        attempt = db.session.get(Attempt, answered["attempt_id"])
        assert attempt.settlement is not None
        assert attempt.settlement.payout > 0


def test_grading_that_never_lands_still_settles_the_case_from_the_answer_key(app, monkeypatch):
    """A provider outage must not leave a finished case unpaid. Correctness comes
    from the verified key, so the case settles ungraded and says so."""
    from app.coaching import CoachingProviderError
    from app.jobs import process_ai_job
    from app.models import AiJob as AiJobModel

    client = app.test_client()
    headers = login(client, "outage@example.test")
    create_game(client, headers)
    answered = _answer_one_case(app, client, headers, "outage-answer")

    monkeypatch.setitem(app.config, "TFY_URL", "https://truefoundry.example/v1")
    monkeypatch.setitem(app.config, "TFY_API_KEY", "test-key")
    monkeypatch.setitem(app.config, "AI_JOBS_MODE", "local")
    monkeypatch.setitem(app.config, "AI_JOB_MAX_ATTEMPTS", 1)
    monkeypatch.setattr("app.jobs._start_local_job", lambda _job: None)

    def always_down(_attempt):
        raise CoachingProviderError("The AI coach could not produce valid feedback.")

    monkeypatch.setattr("app.services.generate_attempt_coaching", always_down)
    assert client.post(f"/v1/attempts/{answered['attempt_id']}/coaching", headers=headers).status_code == 202
    with app.app_context():
        job = AiJobModel.query.filter_by(dedup_key=f"coaching:{answered['attempt_id']}").one()
        with pytest.raises(CoachingProviderError):
            process_ai_job(job.id)
        attempt = db.session.get(Attempt, answered["attempt_id"])
        assert attempt.coaching_status == "failed"
        # Correct answer, ungraded write-up: the thin-win path rather than $0.
        assert attempt.settlement is not None
        assert attempt.settlement.explanation_grade == "Invalid"
        assert attempt.settlement.payout > 0
        # No grade exists, so nothing was written to the explanation statistics.
        assert attempt.explanation_score is None

    unavailable = client.post(f"/v1/attempts/{answered['attempt_id']}/coaching", headers=headers)
    assert unavailable.json["status"] == "unavailable"
    assert unavailable.json["coaching"] is None
    assert "verified key" in unavailable.json["notice"]
    assert unavailable.json["reward"]["payout"] > 0
    # And the debrief closes rather than trapping the player behind a dead call.
    assert client.post(
        f"/v1/study-sessions/{answered['session_id']}/debrief/acknowledge",
        headers=headers,
    ).status_code == 200


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


def test_invalid_reasoning_on_a_correct_answer_pays_thin_and_skips_daily_goals(app, monkeypatch):
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
        # The letter was verified correct, so the case is a thin win rather than a
        # total loss: a reduced fee lands (see THIN_WIN_MULTIPLIER)...
        assert attempt.settlement.payout > 0
        assert profile.cash == 250 + attempt.settlement.payout
        assert profile.total_cases == 1
        # ...but the daily bonus goals still require a real written argument.
        assert daily.cases_completed == 0


def test_grading_outage_on_a_correct_answer_builds_standing_instead_of_draining_it(app):
    """A grading outage must not be scored as a bad write-up.

    `settle_uncoached_attempt` settles with no grade at all, which fell through
    to the Invalid band — the same verdict as prose a grader read and rejected.
    Standing is a rolling mean of `validated_credit`, so while the coaching
    provider was unreachable every correct answer paid 0.35 credit and dragged
    reputation toward 35. Tier 3 needs 42 and the last tier needs 94, so a
    player answering every question correctly was capped at tier 2 of 15 and
    could not finish a single quest with a "validated" objective.
    """
    client = app.test_client()
    headers = login(client, "outage-standing@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": "The stimulus concludes from a correlation in the survey data, and only this choice supplies the causal premise the argument needs to bridge that gap.",
        },
        headers={**headers, "Idempotency-Key": "outage-standing-answer"},
    ).json["result"]
    with app.app_context():
        from app.services import settle_uncoached_attempt

        assert settle_uncoached_attempt(submitted["attempt_id"]) is True
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        daily = DailyProgress.query.filter_by(profile_id=profile.id).one()
        settlement = attempt.settlement

        # Correctness is verified by the answer key, so the case settles as a win.
        assert settlement.validated_credit == UNGRADED_CREDIT
        assert settlement.reputation_after > settlement.reputation_before
        assert profile.reputation > 50
        assert profile.total_validated_correct == 1
        # The story runs on validated wins; an outage cannot make it unreachable.
        assert profile.current_streak == 1
        assert daily.cases_completed == 1
        # It still pays less than a graded win would, so nobody prefers an outage.
        assert settlement.score_multiplier_bps == round(UNGRADED_MULTIPLIER * 10_000)
        assert UNGRADED_MULTIPLIER < 1.20


def test_grading_outage_on_a_blank_explanation_stays_a_total_loss(app):
    """The absence of a grade is only an outage when there was prose to grade."""
    client = app.test_client()
    headers = login(client, "outage-blank@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    with app.app_context():
        item = db.session.get(SessionItem, session["current_item"]["id"])
        attempt = Attempt(
            user_id=item.session.user_id,
            session_item_id=item.id,
            idempotency_key="outage-blank-answer",
            selected_label="C",
            is_correct=True,
            reasoning_text="",
            server_elapsed_ms=140_000,
            coaching_status="failed",
        )
        db.session.add(attempt)
        item.completed_at = utcnow()
        db.session.commit()
        attempt_id = attempt.id

        from app.services import settle_uncoached_attempt

        settle_uncoached_attempt(attempt_id)
        settled = db.session.get(Attempt, attempt_id)
        assert settled.settlement.payout == 0
        assert settled.settlement.validated_credit == 0.0


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

    # The office scene reports what each item contributes, so the two numbers
    # behind that readout are published rather than left to be scraped out of
    # `benefit`. They have to agree with the catalog exactly: an item that earns
    # by the hour publishes its rate, and one that only multiplies case fees
    # publishes a rate of nothing at all rather than an absent field.
    associate = next(
        asset for asset in collected.json["game"]["catalog"]["assets"] if asset["key"] == "junior_associate"
    )
    assert associate["passive_hourly"] == ASSET_BY_KEY["junior_associate"]["passive_hourly"]
    assert associate["payout_mult"] == ASSET_BY_KEY["junior_associate"]["payout_mult"]
    assert manager["payout_mult"] == ASSET_BY_KEY["office_manager"]["payout_mult"]
    assert "passive_hourly" not in manager

    # Effects that no client surface reads stay private.
    for private in ("staff_flat", "storage_hours", "streak_bonus_cap", "reputation_guard"):
        assert private not in associate
        assert private not in manager


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

    # Decor buys nothing but the view, and the catalog entry has to say so in
    # the payload rather than merely omit the evidence. The office scene reads
    # these two fields to decide what an item is, so "absent" is what it uses to
    # mean "this genuinely earns nothing" -- a cosmetic that acquired either
    # field would start claiming an income it does not have.
    #
    # This once passed because every effect was stripped from every asset. It
    # now passes because decor really has no economics, which is the thing worth
    # asserting: `junior_associate` in the passive-collection test above proves
    # the same payload does publish both numbers when they exist.
    assert bought.json["game"]["passive_income"]["hourly_rate"] == 0
    catalog_lamp = next(asset for asset in bought.json["game"]["catalog"]["assets"] if asset["key"] == "banker_lamp")
    assert catalog_lamp["owned"] is True
    assert catalog_lamp["benefit"] == lamp["benefit"]
    assert "payout_mult" not in catalog_lamp
    assert "passive_hourly" not in catalog_lamp

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

    # Ethics and Intel reveal the file, but the shadow track still starts behind
    # the investigation that introduces the broker.
    game = client.get("/v1/game").json["game"]
    hidden = next(quest for quest in game["story"]["quests"] if quest["key"] == "market_whisper")
    assert hidden["available"] is False
    assert hidden["locked_by"] == ["The Missing Deed"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.story_state.quest_history_json = ["mercer_overflow", "harrow_missing_deed"]
        db.session.commit()

    game = client.get("/v1/game").json["game"]
    hidden = next(quest for quest in game["story"]["quests"] if quest["key"] == "market_whisper")
    assert hidden["available"] is True
    assert hidden["locked_by"] == []
    opened = client.post("/v1/game/quests/start", json={"quest_key": "market_whisper"}, headers=headers)
    assert opened.status_code == 200
    # Read the advance from the catalog rather than pinning a literal: it is
    # priced in cases at the quest's tier and moves with the economy.
    advance = next(quest for quest in QUESTS if quest["key"] == "market_whisper")["start"]["cash"]
    assert opened.json["result"]["advance"] == advance
    assert opened.json["game"]["story"]["active_quest"]["key"] == "market_whisper"
    assert opened.json["game"]["story"]["heat"] == 10
    assert opened.json["game"]["cash"] == created["cash"] + advance


def test_pending_chapter_follows_the_headquarters_tier(app):
    """A chapter becomes pending the moment its tier is reached and not before."""
    client = app.test_client()
    headers = login(client, "chapter-pacing@example.test")
    created = create_game(client, headers)

    story = client.get("/v1/game").json["game"]["story"]
    assert story["pending_chapter"]["key"] == "one_light_on"

    resolved = client.post(
        "/v1/game/story/choice",
        json={"chapter_key": "one_light_on", "choice_key": "open_door"},
        headers=headers,
    )
    assert resolved.status_code == 200
    # Act I belongs to headquarters 2, so nothing is waiting in the meantime.
    assert resolved.json["game"]["story"]["pending_chapter"] is None

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 2
        db.session.commit()

    story = client.get("/v1/game").json["game"]["story"]
    assert story["pending_chapter"]["key"] == "the_harrow_file"
    assert story["pending_chapter"]["tier"] == 2
    assert story["pending_chapter"]["act"] == "ACT I"


def test_the_final_tier_does_not_open_the_whole_caseboard(app):
    """Reaching tier 14 must not make every file startable at once."""
    client = app.test_client()
    headers = login(client, "caseboard-sequence@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 14
        profile.reputation = 95
        db.session.commit()

    story = client.get("/v1/game").json["game"]["story"]
    # The prologue has not been played, so even the first file is sealed.
    assert [quest["key"] for quest in story["quests"] if quest["available"]] == []

    client.post(
        "/v1/game/story/choice",
        json={"chapter_key": "one_light_on", "choice_key": "open_door"},
        headers=headers,
    )
    story = client.get("/v1/game").json["game"]["story"]
    assert [quest["key"] for quest in story["quests"] if quest["available"]] == ["mercer_overflow"]

    final = next(quest for quest in story["quests"] if quest["key"] == FINAL_CASE_KEY)
    assert final["available"] is False
    assert final["locked_by"] == [
        "FINALE: A Name in the Sky",
        "The Far-Side Workers' Appeal",
        "Signal From Hearing One",
    ]

    denied = client.post("/v1/game/quests/start", json={"quest_key": FINAL_CASE_KEY}, headers=headers)
    assert denied.status_code == 409
    assert denied.json["error"]["code"] == "quest_locked"


def test_closing_a_file_opens_the_next_one_on_its_track(app):
    client = app.test_client()
    headers = login(client, "caseboard-chain@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 4
        profile.story_state.seen_chapters_json = ["one_light_on", "the_harrow_file", "city_hall_cipher"]
        profile.story_state.quest_history_json = ["mercer_overflow"]
        db.session.commit()

    quests = {quest["key"]: quest for quest in client.get("/v1/game").json["game"]["story"]["quests"]}
    assert quests["innocence_archive"]["available"] is True
    assert quests["clinic_coverup"]["available"] is False
    assert quests["clinic_coverup"]["locked_by"] == ["The Innocence Archive"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.story_state.quest_history_json = ["mercer_overflow", "innocence_archive"]
        db.session.commit()

    quests = {quest["key"]: quest for quest in client.get("/v1/game").json["game"]["story"]["quests"]}
    assert quests["clinic_coverup"]["available"] is True
    assert quests["clinic_coverup"]["locked_by"] == []
    opened = client.post("/v1/game/quests/start", json={"quest_key": "clinic_coverup"}, headers=headers)
    assert opened.status_code == 200


def test_a_file_stays_sealed_until_its_chapter_is_played(app):
    client = app.test_client()
    headers = login(client, "caseboard-chapter-gate@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 4
        profile.story_state.seen_chapters_json = ["one_light_on", "the_harrow_file"]
        profile.story_state.quest_history_json = ["mercer_overflow", "harrow_missing_deed"]
        db.session.commit()

    quests = {quest["key"]: quest for quest in client.get("/v1/game").json["game"]["story"]["quests"]}
    assert quests["city_hall_trail"]["available"] is False
    assert quests["city_hall_trail"]["locked_by"] == ["ACT II: The City Hall Cipher"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.story_state.seen_chapters_json = [*profile.story_state.seen_chapters_json, "city_hall_cipher"]
        db.session.commit()

    quests = {quest["key"]: quest for quest in client.get("/v1/game").json["game"]["story"]["quests"]}
    assert quests["city_hall_trail"]["available"] is True


def test_closing_the_final_charter_writes_an_epilogue(app):
    client = app.test_client()
    headers = login(client, "epilogue@example.test")
    created = create_game(client, headers)
    assert client.get("/v1/game").json["game"]["story"]["epilogue"] is None

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 14
        profile.reputation = 92
        profile.total_cases = 240
        profile.total_correct = 198
        profile.story_state.ethics = 88
        profile.story_state.seen_chapters_json = [chapter["key"] for chapter in STORY_CHAPTERS]
        profile.story_state.choices_json = {
            "one_light_on": "open_door",
            "name_in_the_sky": "give_constellation",
        }
        profile.story_state.quest_history_json = ["mercer_overflow", "market_whisper", FINAL_CASE_KEY]
        db.session.commit()

    game = client.get("/v1/game").json["game"]
    epilogue = game["story"]["epilogue"]
    assert epilogue["ending_key"] == "give_constellation"
    assert epilogue["verdict"] == "CHARTERED IN PUBLIC TRUST"
    assert len(epilogue["beats"]) == 4
    assert epilogue["alignment"] == "Principled"
    assert epilogue["promise"].startswith("On the first night you promised Ada")
    assert epilogue["chapters_resolved"] == epilogue["chapters_total"] == len(STORY_CHAPTERS)
    assert epilogue["quests_closed"] == 3
    assert epilogue["shadow_files_closed"] == 1
    assert epilogue["days_elapsed"] == 0
    assert epilogue["completed_at"] and epilogue["opened_at"]
    assert game["upkeep"]["completed"] is True

    # The other ending is a different record, not the same text with a new stamp.
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.story_state.choices_json = {"name_in_the_sky": "rule_constellation"}
        db.session.commit()

    epilogue = client.get("/v1/game").json["game"]["story"]["epilogue"]
    assert epilogue["ending_key"] == "rule_constellation"
    assert epilogue["verdict"] == "HELD UNDER FIRM CONTROL"
    assert epilogue["promise"] is None


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
        profile.total_validated_correct = 12
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


def test_rival_operations_are_paid_for_with_validated_wins(app):
    """The war room spends casework, so it cannot be played without practising."""
    client = app.test_client()
    headers = login(client, "rival-casework@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = 1_000_000
        profile.reputation = 80
        profile.office_tier = 2
        profile.story_state.influence = 5
        # Every other requirement is met and the firm is rich. The only thing
        # missing is the casework, which is the whole point of the gate.
        profile.total_validated_correct = 1
        db.session.add(PlayerAsset(profile_id=profile.id, asset_key="local_bar", asset_type="connection", purchase_price=1))
        db.session.commit()

    state = client.get("/v1/game", headers=headers)
    assert state.json["game"]["story"]["casework"] == 1
    target = next(item for item in state.json["game"]["story"]["rival_targets"] if item["key"] == "neighborhood_practice")
    challenge = next(item for item in target["operations"] if item["key"] == "public_case_challenge")
    assert challenge["casework"] == 2
    assert challenge["available"] is False
    assert "1 more validated wins" in challenge["missing"]

    refused = client.post(
        "/v1/game/rival-operations",
        json={"rival_key": "neighborhood_practice", "operation_key": "public_case_challenge"},
        headers=headers,
    )
    assert refused.status_code == 409

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.total_validated_correct = 4
        db.session.commit()

    operated = client.post(
        "/v1/game/rival-operations",
        json={"rival_key": "neighborhood_practice", "operation_key": "public_case_challenge"},
        headers=headers,
    )
    assert operated.status_code == 200
    assert operated.json["result"]["casework"] == 2
    # Four wins earned, two committed, so two remain for the next operation.
    assert operated.json["game"]["story"]["casework"] == 2
    assert operated.json["game"]["story"]["casework_spent"] == 2

    # Casework already committed to one rival is not available to another, so
    # the discount ladder costs real practice all the way up.
    second = client.post(
        "/v1/game/rival-operations",
        json={"rival_key": "neighborhood_practice", "operation_key": "forensic_complaint"},
        headers=headers,
    )
    assert second.status_code == 409


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
        # Mercer's overflow docket pays one extra client fee on completion.
        assert settlement.quest_bonus == CLIENT_BY_KEY["eviction_defense_clinic"]["base_fee"]
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


def _settle_correct_answer(
    app,
    monkeypatch,
    email: str,
    grade: int,
    *,
    reasoning: str | None = None,
    reputation: float | None = None,
    prior_cases: int | None = None,
) -> dict:
    """Answer one case correctly (the key is always ``C``), coach it with the given
    grade, settle, and report the resulting economy state.

    ``prior_cases`` back-dates ``total_cases`` so the reputation warmup can be
    isolated: it is the only thing that field feeds into a settlement.
    """
    client = app.test_client()
    headers = login(client, email)
    create_game(client, headers)
    if reputation is not None or prior_cases is not None:
        with app.app_context():
            profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == email).one()
            if reputation is not None:
                profile.reputation = reputation
            if prior_cases is not None:
                profile.total_cases = prior_cases
            db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    text = reasoning or explanation(f"the link {email} relies on")
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "strategy_applied": True,
            "reasoning": text,
        },
        headers={**headers, "Idempotency-Key": f"{email}-correct"},
    ).json["result"]

    coaching = {
        "explanation_grade": grade,
        "reasoning_verdict": "partial",
        "reasoning_summary": "Graded for this test at a fixed band.",
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
            "reputation_before": attempt.settlement.reputation_before,
            "reputation_change": attempt.settlement.reputation_change,
            "reputation": profile.reputation,
            "daily_cases": daily.cases_completed,
            "streak": profile.current_streak,
        }


def test_a_correct_answer_graded_invalid_is_paid_and_not_sharply_penalized(app, monkeypatch):
    """The audited failure: a verified-correct answer whose write-up the grader
    called Invalid used to pay nothing and take the full -4.0 reputation hit from
    the 50.0 default. Solving the question is the signal the app teaches, so it is
    now a thin win instead."""
    result = _settle_correct_answer(
        app,
        monkeypatch,
        "thin-win@example.test",
        10,
        reasoning=(
            "I checked each choice against the gap between the evidence and the conclusion, "
            "and only one of them closed that gap without smuggling in a new comparison."
        ),
    )
    assert result["grade"] == "Invalid"
    assert result["reputation_before"] == 50.0
    assert result["payout"] > 0
    # Previously -4.0 from one data point. It still costs standing, but under a
    # point, and the drop is a fraction of what a careless miss costs.
    assert -1.0 < result["reputation_change"] < 0
    assert result["daily_cases"] == 0


def test_a_reused_explanation_keeps_the_full_invalid_penalty(app, monkeypatch):
    """The thin win only covers a judgment call about prose. Pasting the same
    explanation onto a second case is decidable without a model, so it stays
    unpaid even though the answer is correct."""
    client = app.test_client()
    headers = login(client, "reused-correct@example.test")
    create_game(client, headers)
    copied = (
        "The conclusion depends on a link the credited choice makes explicit while "
        "every other option widens the scope or swaps the term the argument needs."
    )
    coaching = {
        "explanation_grade": 90,
        "reasoning_verdict": "strong",
        "reasoning_summary": "Graded Excellent by the model both times.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching.copy(), {}))
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    settled = []
    for index in range(2):
        current = client.get(f"/v1/study-sessions/{session['id']}").json["session"]["current_item"]
        submitted = client.post(
            f"/v1/study-sessions/{session['id']}/attempts",
            json={
                "item_id": current["id"],
                "selected_label": "C",
                "strategy_applied": True,
                "reasoning": copied,
            },
            headers={**headers, "Idempotency-Key": f"reused-{index}"},
        ).json["result"]
        with app.app_context():
            from app.services import run_attempt_coaching

            attempt = db.session.get(Attempt, submitted["attempt_id"])
            run_attempt_coaching(attempt)
            settled.append(
                {"grade": attempt.settlement.explanation_grade, "payout": attempt.settlement.payout}
            )
        client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)

    assert settled[0]["grade"] == "Excellent" and settled[0]["payout"] > 0
    assert settled[1]["grade"] == "Invalid" and settled[1]["payout"] == 0


def test_written_reasoning_still_decides_what_a_correct_answer_is_worth(app, monkeypatch):
    """Dampening the Invalid case must not flatten the incentive: every band above
    it still pays strictly more and protects standing better."""
    excellent = _settle_correct_answer(app, monkeypatch, "band-excellent@example.test", 90)
    good = _settle_correct_answer(app, monkeypatch, "band-good@example.test", 65)
    weak = _settle_correct_answer(app, monkeypatch, "band-weak@example.test", 40)
    invalid = _settle_correct_answer(app, monkeypatch, "band-invalid@example.test", 10)

    assert [excellent["grade"], good["grade"], weak["grade"], invalid["grade"]] == [
        "Excellent",
        "Good",
        "Weak",
        "Invalid",
    ]
    # Excellent and Good share a score-multiplier bucket when the answer lands
    # instantly (no pace points), so only the weaker bands are strictly ordered.
    assert excellent["payout"] >= good["payout"] > weak["payout"] > invalid["payout"] > 0
    assert excellent["reputation"] >= good["reputation"] > weak["reputation"] > invalid["reputation"]
    # A thin win is a win for the ledger but not for the streak or the daily goals.
    assert excellent["streak"] == good["streak"] == 1
    assert weak["streak"] == invalid["streak"] == 0


def test_early_reputation_drops_are_dampened_and_reach_full_sensitivity(app):
    from app.game import REPUTATION_WARMUP_CASES, _reputation_warmup

    assert _reputation_warmup(0) < _reputation_warmup(1) < _reputation_warmup(REPUTATION_WARMUP_CASES)
    assert _reputation_warmup(REPUTATION_WARMUP_CASES) == 1.0
    assert _reputation_warmup(500) == 1.0
    # Warmup only ever shrinks a drop, so it can never invert a guard or band cap.
    assert 0 < _reputation_warmup(0) < 1


def test_a_first_case_dents_reputation_less_than_the_same_case_later(app, monkeypatch):
    """The same settlement, differing only in how much history precedes it. One
    shaky case in the first hour cannot read as a career verdict."""
    fresh = _settle_correct_answer(app, monkeypatch, "warmup-fresh@example.test", 10, reputation=60.0)
    veteran = _settle_correct_answer(
        app,
        monkeypatch,
        "warmup-veteran@example.test",
        10,
        reputation=60.0,
        prior_cases=40,
    )
    assert fresh["grade"] == veteran["grade"] == "Invalid"
    assert veteran["reputation_change"] < fresh["reputation_change"] < 0


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
        # Every position, not just the old position % 4 == 2 cadence. Counted
        # off the run rather than written out, because a run that served a
        # Reading Comprehension passage whole is a question or two longer than
        # the seven it asked for.
        assert [item.position for item in items if item.strategy_key] == list(range(len(items)))
        assert all(item.strategy_variant in {"prompt", "control_visible"} for item in items)


def test_every_item_in_a_long_run_arrives_with_a_card(app):
    """End to end, over a real run: no question arrives with nothing.

    This is the whole point of the visible control. A quarter of these carry the
    neutral card instead of a technique, which is what keeps the control arm —
    and therefore the approach ranking, which is a difference against it —
    alive. What the student must never see is a question with no card at all.

    A ten-question run is requested explicitly, twice the shipped
    `PRACTICE_SESSION_SIZE`, so that a run long enough to reach both arms is
    exercised and so that the fixture's smaller default runs are not what this
    is measured on.
    """
    from app.services import passage_overshoot_allowance, serialize_item

    client = app.test_client()
    headers = login(client, "long-run-cards@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 10}, headers=headers).json["session"]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert 10 <= len(items) <= 10 + passage_overshoot_allowance(10)

        cards = []
        for item in items:
            payload = serialize_item(item, commit=False)
            prompt, neutral = payload["strategy_trial"], payload["strategy_neutral"]
            # Exactly one card per question, never both and never neither.
            assert bool(prompt) != bool(neutral), f"position {item.position} has {prompt=} {neutral=}"
            cards.append("prompt" if prompt else "neutral")
            if neutral:
                # The neutral arm is the baseline, so it is never gated. This
                # falls out of `assign_enforcement_level` refusing any variant
                # that is not the prompt arm, which is why enforcement needed no
                # change to make this true.
                assert payload["strategy_gate"] is None
                assert item.strategy_enforcement_level == "none"

        assert len(cards) == len(items)
        # Both arms are reachable in a long run, which is what makes this a
        # trial rather than a universal prompt wearing one.
        assert set(cards) <= {"prompt", "neutral"}


def test_the_neutral_arm_needs_no_decision_and_records_no_self_report(app):
    """A card that offers nothing cannot be applied or declined.

    The prompt arm requires a bool `strategy_applied` and rejects a submission
    without one. The neutral arm must not, because there is no technique to
    report on — and recording one anyway would put a self-report on the control
    side of the very comparison that exists to avoid depending on self-reports.
    """
    client = app.test_client()
    headers = login(client, "neutral-no-decision@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", json={"size": 3}, headers=headers).json["session"]

    with app.app_context():
        study = db.session.get(StudySession, session["id"])
        item = next(value for value in study.items if value.position == study.current_index)
        item.strategy_key = "argument_core"
        item.strategy_variant = "control_visible"
        item.strategy_enforcement_level = "none"
        db.session.commit()
        item_id = item.id

    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item_id,
            "selected_label": "C",
            "reasoning": explanation("the controlling relationship"),
            "confidence": 3,
            # Deliberately no `strategy_applied`. The prompt arm would 400 here.
        },
        headers={**headers, "Idempotency-Key": "neutral-1"},
    )
    assert response.status_code == 200, response.json

    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_variant == "control_visible"
        assert attempt.strategy_key == "argument_core"
        # No self-report and no gate status: nothing was offered, so nothing was
        # applied, declined, satisfied or attested.
        assert attempt.strategy_applied is None
        assert attempt.strategy_gate_status is None


def test_the_visible_control_still_counts_as_the_control_side_of_the_ranking(app):
    """The renamed arm has to keep powering the LR/RC approach ranking.

    The ranking is a shrunk intention-to-treat difference against the arm that
    offered no technique. If the new label stopped counting as that arm,
    `_contrast_sample` would sit at zero, nothing would ever clear
    `MIN_CONTRAST_SAMPLE`, and the panel would go on advising students to
    collect un-prompted questions the app no longer produces. Both control
    labels therefore land on the same side, and the mix does not change the
    reading.
    """
    with app.app_context():
        user = User(email="visible-control-ranks@example.test", display_name="Ranks")
        db.session.add(user)
        db.session.flush()
        lr = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).first()

        # 20 prompted against 20 controls is an effective comparison of exactly
        # 10 a side, the smallest split that can carry a named approach — and
        # the control side is split across the old label and the new one.
        _seed_strategy_trials(
            user,
            lr,
            key="argument_core",
            prompt=(20, 16),
            control=(10, 5),
            tag="v-new",
            control_variant="control_visible",
        )
        _seed_strategy_trials(user, lr, key="argument_core", prompt=(0, 0), control=(10, 5), tag="v-old")

        sections = _sections(user)
        result = next(value for value in sections["LR"]["results"] if value["key"] == "argument_core")
        assert result["control_sample"] == 20, "both control labels have to count as control"
        assert result["contrast_sample"] == 10.0
        assert result["eligible"] is True
        assert sections["LR"]["status"] == "leader"
        assert sections["LR"]["leader"]["key"] == "argument_core"


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
        # The control arm still exists alongside the prompts. It is visible now
        # rather than hidden, but it is still an arm that offers no technique.
        assert {trial["variant"] for trial in first} <= {"prompt", "control_visible"}


def test_strategy_control_assignment_is_stable_and_names_no_technique(app, monkeypatch):
    """The control arm is visible now, and still offers nothing.

    It used to be invisible: a quarter of questions arrived bare. A card appears
    on those questions now and says so in as many words, which is what makes a
    prompt arrive on every question in a run without deleting the arm the
    dashboard's approach ranking is a difference against. What has not changed
    is the assignment — no technique is offered, so `strategy_trial` is still
    absent and there is still no decision to make.
    """
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
        assert assigned["variant"] == "control_visible"
        assert assigned["key"] in {"argument_core", "prephrase", "scope_precision", "conditional_chain"}
        # The arm's propensity is untouched by making it visible, so the
        # inverse-propensity weighting in `_arm_rate` reads the same as before.
        assert assigned["propensity"] == 0.25

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
        payload = serialize_item(item)
        # No technique was offered, so nothing here can be applied or skipped.
        assert payload["strategy_trial"] is None
        assert payload["strategy_gate"] is None
        # But a card does arrive, and it reads as a decision rather than a gap.
        assert payload["strategy_neutral"] is not None
        assert payload["strategy_neutral"]["variant"] == "control_visible"
        assert payload["strategy_neutral"]["plain_title"]
        assert payload["strategy_neutral"]["plain_line"]
        assert payload["strategy_neutral"]["note"]


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


def test_strategy_dashboard_uses_intention_to_treat_and_hedges_language(app):
    """The estimator compares everyone *assigned* prompt vs. everyone assigned
    control, regardless of self-reported `strategy_applied` — the fix for the
    selection-bias bug in `research/11-measurement-implementation-spec.md` § 1.
    It also never claims a personal verdict: no "confirmed", no "supported",
    and no percentage-point lift below the fraction-display threshold.
    """
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
            # Position 8 is assigned to the prompt arm but the student later
            # says they skipped it. Intention-to-treat still counts it in
            # `sample` — this is exactly the case the old code got wrong by
            # dropping it via a `strategy_applied.is_(True)` filter.
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
        # ITT: all 9 prompt-arm attempts count, including the skipped one.
        assert result["sample"] == 9
        assert result["control_sample"] == 4
        assert result["applied"] == 8
        assert result["skipped"] == 1
        assert result["accuracy"] == 67
        assert result["control_accuracy"] == 50
        assert result["lift"] == 17
        assert "status" not in result
        assert snapshot["trials_completed"] == 13
        assert snapshot["leader"]["key"] == "argument_core"

        # Never a binary verdict, regardless of sample size.
        assert result["verdict"] == "measuring"
        assert result["verdict_label"] == "measuring"
        assert "confirmed" not in result["summary"].lower()
        assert "supported" not in snapshot["evidence_note"].lower()
        assert result["plain_title"] == "Split the argument"
        # Below the fraction-display threshold (30/arm): fractions, not a
        # decimal-precision percentage, and no percentage-point difference.
        assert result["with_headline"] == "6/9"
        assert result["without_headline"] == "2/4"
        assert result["with_note"] == "9 questions with it"
        assert result["without_note"] == "4 questions without it"
        assert result["difference_headline"] == "—"
        assert result["summary"] == "So far you're at 6/9 with it and 2/4 without it."
        # The compliance rate — what strategy_applied is actually for now.
        assert result["detail"] == "You said you used it on 8 of the 9 times it came up."

    response = client.get("/v1/performance", headers=headers)
    assert response.status_code == 200
    assert response.json["performance"]["strategy_lab"]["leader"]["key"] == "argument_core"


def test_strategy_dashboard_shows_a_percentage_once_both_arms_are_large(app):
    """Above the ~30-observation-per-arm threshold, and only then, a
    percentage-point difference is shown instead of a raw fraction."""
    with app.app_context():
        user = User(email="strategy-large-sample@example.test", display_name="Large Sample")
        db.session.add(user)
        db.session.flush()
        question = Question.query.order_by(Question.id).first()
        session = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="deep",
            feedback_policy="immediate",
            target_minutes=35,
            total_items=64,
        )
        db.session.add(session)
        db.session.flush()
        for position in range(64):
            variant = "prompt" if position < 32 else "control"
            is_correct = (position < 32 and position % 4 != 0) or (position >= 32 and position % 2 == 0)
            item = SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                requires_reasoning=True,
                strategy_key="argument_core",
                strategy_variant=variant,
                target_time_seconds=150,
            )
            db.session.add(item)
            db.session.flush()
            db.session.add(
                Attempt(
                    user_id=user.id,
                    session_item_id=item.id,
                    idempotency_key=f"large-sample-{position}",
                    selected_label="C" if is_correct else "A",
                    is_correct=is_correct,
                    reasoning_text="A concrete argument analysis.",
                    confidence=4,
                    strategy_key="argument_core",
                    strategy_variant=variant,
                    strategy_applied=True if variant == "prompt" else None,
                    server_elapsed_ms=100_000,
                )
            )
        db.session.commit()

        from app.strategies import strategy_performance

        result = next(entry for entry in strategy_performance(user.id)["results"] if entry["key"] == "argument_core")
        assert result["sample"] == 32
        assert result["control_sample"] == 32
        assert result["with_headline"] == "75%"
        assert result["without_headline"] == "50%"
        assert result["difference_headline"] == "+25 points"
        assert "not a proven effect" in result["difference_note"]


def _seed_strategy_trials(
    user: User,
    question: Question,
    *,
    key: str,
    prompt: tuple[int, int],
    control: tuple[int, int],
    tag: str,
    applied: bool | None = True,
    propensity: bool = True,
    control_variant: str = "control",
) -> None:
    """Give ``user`` a strategy trial record on ``question``.

    ``prompt``/``control`` are (observations, correct) per arm. Everything lands
    on one question deliberately: the section a trial is counted under comes off
    that question, which is the property most of these tests are about.

    ``control_variant`` defaults to the pre-existing ``control`` label rather
    than the visible arm that replaced it, so every caller here keeps proving
    that historical control rows still count as control. Pass
    ``control_visible`` to seed the arm assigned today.
    """
    session = StudySession(
        user_id=user.id,
        mode="practice",
        practice_style="deep",
        feedback_policy="immediate",
        status="completed",
        target_minutes=35,
        total_items=prompt[0] + control[0],
    )
    db.session.add(session)
    db.session.flush()
    position = 0
    for variant, (observations, correct) in (("prompt", prompt), (control_variant, control)):
        for index in range(observations):
            item = SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                requires_reasoning=True,
                strategy_key=key,
                strategy_variant=variant,
                target_time_seconds=150,
                completed_at=utcnow(),
            )
            db.session.add(item)
            db.session.flush()
            db.session.add(
                Attempt(
                    user_id=user.id,
                    session_item_id=item.id,
                    idempotency_key=f"{tag}-{key}-{variant}-{position}",
                    selected_label="C" if index < correct else "A",
                    is_correct=index < correct,
                    reasoning_text="A concrete analysis.",
                    confidence=4,
                    strategy_key=key,
                    strategy_variant=variant,
                    strategy_applied=applied if variant == "prompt" else None,
                    strategy_propensity=(0.75 if variant == "prompt" else 0.25) if propensity else None,
                    strategy_candidates_n=3,
                    evidence_class="coached_practice",
                    server_elapsed_ms=100_000,
                )
            )
            position += 1
    db.session.commit()


def _sections(user: User) -> dict[str, dict]:
    from app.strategies import strategy_performance

    return {
        reading["short_label"]: reading for reading in strategy_performance(user.id)["sections"]
    }


def test_strategy_sections_name_a_separate_leader_for_lr_and_rc(app):
    """The two scored domains are measured apart, each off its own attempts.

    An approach is only ever offered on questions from its own section, so a
    single account-wide ranking is effectively a ranking of Logical Reasoning —
    it has twice the items and therefore twice the trials. Each section gets its
    own comparison here, and each is shrunk by its own evidence.
    """
    with app.app_context():
        user = User(email="strategy-sections@example.test", display_name="Sections")
        db.session.add(user)
        db.session.flush()
        lr = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).first()
        rc = Question.query.filter_by(section="Reading Comprehension").order_by(Question.id).first()
        # 20 against 20 is an effective comparison of exactly 10 a side, the
        # smallest split that can carry a named approach.
        _seed_strategy_trials(user, lr, key="argument_core", prompt=(20, 16), control=(20, 10), tag="s1")
        _seed_strategy_trials(user, lr, key="prephrase", prompt=(20, 11), control=(20, 10), tag="s2")
        _seed_strategy_trials(user, rc, key="passage_map", prompt=(20, 17), control=(20, 11), tag="s3")

        sections = _sections(user)
        assert set(sections) == {"LR", "RC"}
        assert sections["LR"]["section"] == "Logical Reasoning"
        assert sections["RC"]["section"] == "Reading Comprehension"

        # Each section names its own approach, from its own trials only.
        assert sections["LR"]["status"] == "leader"
        assert sections["LR"]["leader"]["key"] == "argument_core"
        assert sections["LR"]["trials"] == 80
        assert sections["RC"]["status"] == "leader"
        assert sections["RC"]["leader"]["key"] == "passage_map"
        assert sections["RC"]["trials"] == 40
        assert {result["key"] for result in sections["RC"]["results"]} == {"passage_map"}

        # Shrinkage: the reported difference is strictly inside the raw one, and
        # in the same direction. 80% against 50% is a raw 30 points; what the
        # student is shown is smaller, because 20 a side is not 30 points of
        # evidence.
        leader = sections["LR"]["leader"]
        assert leader["lift"] == 30
        assert 0 < leader["adjusted_lift"] < leader["lift"]
        assert sections["LR"]["lift_headline"] == "+20 pts"
        assert sections["LR"]["evidence_label"] == "emerging"
        assert sections["LR"]["minimum_contrast_sample"] == 10
        assert leader["contrast_sample"] == 10.0

        # Never a verdict, in either section.
        for reading in sections.values():
            for text in (reading["headline"], reading["summary"], reading["next_step"]):
                assert "confirmed" not in text.lower()
                assert "proves" not in text.lower()


def test_a_thin_section_refuses_to_name_a_top_strategy(app):
    """Below the bar the reading says what is missing instead of picking a winner.

    The failure mode this exists to prevent: 12 prompted questions against 3
    controls is a comparison worth 2.4 questions a side, and the approach on top
    of it is noise. Naming it would be the same fiction the trial calendar
    refuses to print.
    """
    with app.app_context():
        user = User(email="strategy-thin@example.test", display_name="Thin")
        db.session.add(user)
        db.session.flush()
        lr = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).first()
        _seed_strategy_trials(user, lr, key="argument_core", prompt=(12, 12), control=(3, 0), tag="thin")

        reading = _sections(user)["LR"]
        # A perfect 12/12 against 0/3 — the most tempting shape there is.
        assert reading["status"] == "insufficient"
        assert reading["leader"] is None
        assert reading["lift_headline"] == "—"
        assert reading["evidence_label"] is None
        assert not any(result["eligible"] for result in reading["results"])

        # It still says which approach is nearest and by how much, rather than
        # going silent — and it never states that approach as an answer.
        assert reading["focus"]["key"] == "argument_core"
        assert reading["headline"] == "Not enough LR evidence to name one"
        assert "Split the argument" not in reading["headline"]
        assert "12 questions with it and 3 without" in reading["summary"]
        # Exact, not a rule of thumb: 12 with it can never reach an effective 10
        # a side on its own, so both sides are quoted to the balanced solution.
        assert "8 more with it and 17 more without it" in reading["next_step"]

        # The account-wide panel is unchanged and still shows the running total.
        from app.strategies import strategy_performance

        assert strategy_performance(user.id)["leader"]["key"] == "argument_core"


def test_a_section_with_no_trials_says_so_rather_than_borrowing_the_other(app):
    with app.app_context():
        user = User(email="strategy-one-section@example.test", display_name="One Section")
        db.session.add(user)
        db.session.flush()
        lr = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).first()
        _seed_strategy_trials(user, lr, key="argument_core", prompt=(20, 16), control=(20, 10), tag="one")

        sections = _sections(user)
        assert sections["LR"]["status"] == "leader"
        assert sections["RC"]["status"] == "none"
        assert sections["RC"]["trials"] == 0
        assert sections["RC"]["results"] == []
        assert sections["RC"]["leader"] is None
        assert sections["RC"]["focus"] is None
        # The Logical Reasoning answer must not leak across the split.
        assert "Split the argument" not in sections["RC"]["summary"]


def test_section_totals_follow_the_question_not_the_catalogue_label(app):
    """A trial is counted where it happened, not where the approach belongs.

    `_candidate_keys` only offers Reading Comprehension approaches on Reading
    Comprehension questions, so the two almost always agree — but the catalogue
    `section` is a statement about what an approach is *for*, and grouping on it
    would be a display-time slice rather than a per-section statistic.
    """
    with app.app_context():
        user = User(email="strategy-crossed@example.test", display_name="Crossed")
        db.session.add(user)
        db.session.flush()
        rc = Question.query.filter_by(section="Reading Comprehension").order_by(Question.id).first()
        # A Logical Reasoning approach, recorded entirely on RC questions.
        _seed_strategy_trials(user, rc, key="argument_core", prompt=(20, 16), control=(20, 10), tag="cross")

        sections = _sections(user)
        assert sections["LR"]["trials"] == 0
        assert sections["RC"]["trials"] == 40
        assert sections["RC"]["leader"]["key"] == "argument_core"
        # The catalogue label survives on the result, where it describes the
        # approach; it is simply not what decided the grouping.
        assert sections["RC"]["leader"]["section"] == "Logical Reasoning"


def test_section_contrast_is_intention_to_treat_and_propensity_weighted(app):
    """Assignment defines treatment, and the logged propensity does the weighting."""
    with app.app_context():
        user = User(email="strategy-itt-sections@example.test", display_name="ITT")
        db.session.add(user)
        db.session.flush()
        lr = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).first()
        # Every prompt-arm question is one the student said they did *not* use
        # the approach on. Per-protocol would throw the whole arm away.
        _seed_strategy_trials(
            user, lr, key="argument_core", prompt=(20, 16), control=(20, 10), tag="itt", applied=False
        )

        reading = _sections(user)["LR"]
        assert reading["status"] == "leader"
        assert reading["leader"]["sample"] == 20
        assert reading["leader"]["applied"] == 0
        assert reading["leader"]["skipped"] == 20
        assert reading["itt"]["basis"] == "intention-to-treat"
        assert reading["itt"]["propensity_weighted"] is True
        assert reading["itt"]["mean_candidates"] == 3.0
        # And the student is told which of the two it is, in the panel.
        assert "not by whether you said you used it" in reading["itt"]["note"]


def test_arm_rate_weights_by_the_logged_propensity(app):
    """Hájek weighting: a no-op at constant propensity, correct when it varies."""
    from types import SimpleNamespace

    from app.strategies import _arm_rate

    def arm(*observations: tuple[bool, float | None]):
        return [
            SimpleNamespace(is_correct=correct, strategy_propensity=propensity)
            for correct, propensity in observations
        ]

    # Constant propensity: the weights cancel and this is the plain mean.
    assert _arm_rate(arm((True, 0.75), (True, 0.75), (False, 0.75), (False, 0.75))) == 0.5
    # Missing propensity on legacy rows falls back to unit weight rather than
    # dropping the observation, which would break intention-to-treat.
    assert _arm_rate(arm((True, None), (False, None))) == 0.5
    # Varying propensity: the rarely-assigned correct answer carries more.
    # (1/0.25) / (1/0.25 + 1/0.75) = 0.75.
    assert _arm_rate(arm((True, 0.25), (False, 0.75))) == pytest.approx(0.75)
    assert _arm_rate([]) == 0.0


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
        # Entering the queue is itself the card's first FSRS review, so it
        # arrives with real memory state rather than parked on rung zero.
        assert row.reps == 1
        assert row.stability > 0
        assert row.difficulty is not None
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
            "strategy_applied": True,
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


def test_review_recovery_reads_the_review_queue_flag(app, monkeypatch):
    """Recovery counts only the repaired item, wherever interleaving placed it."""
    client = app.test_client()
    headers = login(client, "recovery-flag@example.test")
    create_game(client, headers)
    with app.app_context():
        user = User.query.filter_by(email="recovery-flag@example.test").one()
        repaired = Question.query.order_by(Question.id).first()
        _queue_due_question(user.id, repaired.id)
        repaired_id = repaired.id

    session = client.post("/v1/study-sessions", json={"size": 2}, headers=headers).json["session"]
    for index in range(2):
        current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
        item = current["current_item"]
        result = client.post(
            f"/v1/study-sessions/{session['id']}/attempts",
            json={
                "item_id": item["id"],
                # Only the repaired question needs to come back correct; the
                # fresh one is deliberately answered wrong so a bug that counted
                # every attempt as a recovery would not read 100 either.
                "selected_label": "C" if item["question"]["id"] == repaired_id else "A",
                "strategy_applied": True,
                "confidence": 3,
                "reasoning": explanation("the recovered repair"),
            },
            headers={**headers, "Idempotency-Key": f"recovery-repair-{index}"},
        ).json["result"]
        coach_and_settle(app, monkeypatch, result["attempt_id"])
        client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)

    performance = client.get("/v1/performance", headers=headers).json["performance"]
    assert performance["review"]["recovery_rate"] == 100


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


def test_due_repairs_are_interleaved_through_a_run_and_capped_at_half(app):
    """Repairs fill at most half a run, spread through it rather than stacked.

    Front-loading is what the old `repairs + fresh` concatenation did, and it
    leaks the answer key: "the first three are the ones you got wrong" is a cue
    the student reads before the stem. See `app/scheduling.interleave`.
    """
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
        origins = [item.from_review_queue for item in items]
        assert sum(origins) == 3
        assert origins != [True, True, True, False, False, False]
        assert origins[0] is False


def test_an_empty_review_queue_still_produces_a_full_run(app):
    from app.services import passage_overshoot_allowance

    client = app.test_client()
    headers = login(client, "no-repairs@example.test")
    create_game(client, headers)
    response = client.post("/v1/study-sessions", json={"size": 4}, headers=headers)
    assert response.status_code == 201
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=response.json["session"]["id"]).all()
        assert 4 <= len(items) <= 4 + passage_overshoot_allowance(4)
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
        assert {item.from_review_queue for item in items} == {True, False}
        repair_position = next(item.position for item in items if item.from_review_queue)

    # The repair: a correct answer with a Good explanation advances its memory
    # state. The fresh item: a high-confidence miss must enter the queue.
    for index in range(2):
        current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]
        item = current["current_item"]
        is_repair = item["position"] == repair_position
        result = client.post(
            f"/v1/study-sessions/{session['id']}/attempts",
            json={
                "item_id": item["id"],
                "selected_label": "C" if is_repair else "A",
                "strategy_applied": True,
                "confidence": 4 if is_repair else 5,
                "reasoning": explanation("the repaired question" if is_repair else "the fresh question"),
            },
            headers={**headers, "Idempotency-Key": f"mixed-{index}"},
        ).json["result"]
        coach_and_settle(app, monkeypatch, result["attempt_id"], grade=65)
        client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
        if not is_repair:
            fresh_attempt_id = result["attempt_id"]

    with app.app_context():
        card = ReviewQueueItem.query.filter_by(question_id=repaired_id).one()
        # Recalled, so it gained stability and is no longer relearning.
        assert card.last_grade > 1
        assert card.stability > 0

        attempt = db.session.get(Attempt, fresh_attempt_id)
        fresh_card = ReviewQueueItem.query.filter_by(
            question_id=attempt.session_item.question_id
        ).one()
        assert fresh_card.reason_code == "high_confidence_error"
        assert fresh_card.last_grade == 1
        assert fresh_card.lapses == 1


def _advance_card(app, label: str, *, stability: float, score: float, is_correct: bool = True):
    """Run one attempt through `_schedule_review` against a seeded card."""
    user = User(email=f"advance-{label}@example.test", display_name="Advance")
    db.session.add(user)
    db.session.flush()
    question = Question.query.first()
    row = ReviewQueueItem(
        user_id=user.id,
        question_id=question.id,
        status="due",
        reason_code="incorrect",
        interval_index=1,
        due_at=utcnow(),
        stability=stability,
        difficulty=5.0,
        reps=1,
        last_grade=3,
        last_reviewed_at=utcnow() - timedelta(days=stability),
    )
    db.session.add(row)
    db.session.flush()

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
        # Memory state advances for items seeded from the queue, which is a
        # property of the item rather than of the whole run.
        from_review_queue=True,
        target_time_seconds=150,
    )
    db.session.add(item)
    db.session.flush()
    attempt = Attempt(
        user_id=user.id,
        session_item_id=item.id,
        idempotency_key=f"advance-{label}",
        selected_label=question.correct_answer if is_correct else "zzz",
        is_correct=is_correct,
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
    return db.session.get(ReviewQueueItem, row.id)


@pytest.mark.parametrize(
    ("label", "score", "expected_grade"),
    [
        ("excellent", 0.90, 4),
        ("good", 0.60, 3),
        ("weak", 0.20, 2),
    ],
)
def test_derived_grade_tracks_the_explanation_score(app, label, score, expected_grade):
    """Explanation quality is the heaviest term in the derived FSRS grade.

    Everything else about these three attempts is identical — same card, same
    pace, same confidence, all correct — so the grade separates purely on how
    well the student justified the answer.
    """
    with app.app_context():
        refreshed = _advance_card(app, label, stability=5.0, score=score)
        assert refreshed.last_grade == expected_grade
        assert refreshed.status == "due"


def test_a_recalled_card_gains_stability_and_a_missed_one_lapses(app):
    with app.app_context():
        from app.scheduling import interval_days

        recalled = _advance_card(app, "recalled", stability=5.0, score=0.90)
        assert recalled.stability > 5.0
        assert recalled.lapses == 0
        # Recalled after a full stability's worth of decay, so the next
        # interval must be longer than the one just survived.
        assert interval_days(recalled.stability) > 5.0

    with app.app_context():
        missed = _advance_card(app, "missed", stability=5.0, score=0.90, is_correct=False)
        # A lapse cannot come back with a longer interval than it had, and it
        # is available for repair immediately rather than on a future date.
        assert missed.stability < 5.0
        assert missed.lapses == 1
        assert missed.last_grade == 1
        assert missed.status == "due"


def test_a_card_stable_past_the_horizon_is_marked_mastered(app):
    """Mastery is a statement about stability, not about surviving four rungs."""
    with app.app_context():
        refreshed = _advance_card(app, "mastered", stability=60.0, score=0.95)
        assert refreshed.status == "mastered"


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


def _end_intermission(session_id: str) -> None:
    """Wind a running intermission back so the next section can be begun."""
    db.session.execute(
        update(StudySession)
        .where(StudySession.id == session_id)
        .values(intermission_started_at=utcnow() - timedelta(hours=1))
    )
    db.session.commit()


def _answer_mega_litigation(app, client, headers, session: dict, correct: int) -> dict:
    """Sit the whole form section by section, getting exactly ``correct`` right.

    Every fixture question is keyed "C", so a wrong answer is any other label.
    This walks the administration the way a student does: fill in the running
    section's sheet, submit it, take the intermission if one is owed, begin the
    next section. Nothing is graded until a section closes.
    """
    session_id = session["id"]
    answered = 0
    for _ in range(4 * max(1, len(session.get("exam", {}).get("sections", [1])))):
        current = client.get(f"/v1/study-sessions/{session_id}", headers=headers).json["session"]
        if current["status"] != "in_progress":
            break
        form = current.get("exam") or {}
        if form.get("stage") == "in_section":
            for entry in form["answer_sheet"]:
                recorded = client.put(
                    f"/v1/study-sessions/{session_id}/answers/{entry['item_id']}",
                    json={"selected_label": "C" if answered < correct else "A"},
                    headers=headers,
                )
                assert recorded.status_code == 200, recorded.json
                answered += 1
            closed = client.post(
                f"/v1/study-sessions/{session_id}/sections/{form['active_section_index']}/submit",
                headers=headers,
            )
            assert closed.status_code == 200, closed.json
            continue
        if form.get("next_section_index") is None:
            break
        if form.get("stage") == "intermission":
            with app.app_context():
                _end_intermission(session_id)
        started = client.post(
            f"/v1/study-sessions/{session_id}/sections/{form['next_section_index']}/start",
            headers=headers,
        )
        assert started.status_code == 200, started.json
    return client.get(f"/v1/study-sessions/{session_id}", headers=headers).json


def _expire_running_section(session_id: str) -> None:
    """Move the running section's bell into the past without touching its status.

    Written straight to the column so the run stays exactly as the student left
    it — the point of each test that calls this is what the *next* request does
    when it finds the clock already spent.
    """
    section = (
        SessionSection.query.filter_by(session_id=session_id, status="in_progress").one()
    )
    db.session.execute(
        update(SessionSection)
        .where(SessionSection.id == section.id)
        .values(deadline_at=utcnow() - timedelta(minutes=1))
    )
    db.session.commit()


def test_diagnostic_misses_become_one_untimed_blind_review_before_answers_unlock(app):
    client = app.test_client()
    headers = login(client, "blind-review@example.test")
    create_game(client, headers)
    diagnostic = client.post("/v1/diagnostics", headers=headers).json["session"]
    missed = 2

    finished = _answer_mega_litigation(
        app,
        client,
        headers,
        diagnostic,
        diagnostic["total_items"] - missed,
    )
    assert finished["session"]["blind_review"] == {
        "state": "ready",
        "session_id": None,
        "total_items": missed,
    }

    # Neither the answer audit nor coaching can leak a key before the retry.
    withheld = client.get(f"/v1/study-sessions/{diagnostic['id']}/review", headers=headers)
    assert withheld.status_code == 409
    assert withheld.json["error"]["code"] == "blind_review_required"
    with app.app_context():
        wrong_attempt = (
            Attempt.query.join(SessionItem)
            .filter(SessionItem.session_id == diagnostic["id"], Attempt.is_correct.is_(False))
            .first()
        )
        wrong_attempt_id = wrong_attempt.id
        wrong_question_ids = {
            attempt.session_item.question_id
            for attempt in (
                Attempt.query.join(SessionItem)
                .filter(SessionItem.session_id == diagnostic["id"], Attempt.is_correct.is_(False))
                .all()
            )
        }
    coaching = client.post(f"/v1/attempts/{wrong_attempt_id}/coaching", headers=headers)
    assert coaching.status_code == 409
    assert coaching.json["error"]["code"] == "answers_withheld"

    started = client.post(f"/v1/diagnostics/{diagnostic['id']}/blind-review", headers=headers)
    assert started.status_code == 201
    blind = started.json["session"]
    assert blind["mode"] == "blind_review"
    assert blind["diagnostic_session_id"] == diagnostic["id"]
    assert blind["feedback_policy"] == "delayed"
    assert blind["target_minutes"] == 0
    assert blind["deadline_at"] is None
    assert blind["time_limit_seconds"] is None
    assert blind["total_items"] == missed
    assert blind["current_item"]["requires_reasoning"] is False
    assert blind["current_item"]["case_terms"] is None

    # Starting twice resumes the same child instead of duplicating the misses.
    same = client.post(f"/v1/diagnostics/{diagnostic['id']}/blind-review", headers=headers)
    assert same.status_code == 201
    assert same.json["session"]["id"] == blind["id"]
    with app.app_context():
        review_items = SessionItem.query.filter_by(session_id=blind["id"]).all()
        assert {item.question_id for item in review_items} == wrong_question_ids

    for position in range(missed):
        current = client.get(f"/v1/study-sessions/{blind['id']}", headers=headers).json["session"]
        answered = client.post(
            f"/v1/study-sessions/{blind['id']}/attempts",
            json={
                "item_id": current["current_item"]["id"],
                "selected_label": "C" if position == 0 else "A",
            },
            headers={**headers, "Idempotency-Key": f"blind-retry-{position}"},
        )
        assert answered.status_code == 200
        assert answered.json["result"]["feedback_released"] is False

    combined = client.get(f"/v1/study-sessions/{blind['id']}/review", headers=headers)
    assert combined.status_code == 200
    review = combined.json["review"]
    assert review["comparison"]["diagnostic"]["summary"]["correct"] == diagnostic["total_items"] - missed
    assert review["comparison"]["blind_review"]["summary"]["correct"] == 1
    assert review["comparison"]["blind_review"]["summary"]["questions_completed"] == missed
    assert {item["diagnostic_selected_label"] for item in review["items"]} == {"A"}
    assert {item["blind_review_selected_label"] for item in review["items"]} == {"A", "C"}

    released = client.get(f"/v1/study-sessions/{diagnostic['id']}/review", headers=headers)
    assert released.status_code == 200
    assert released.json["review"]["comparison"]["blind_review"]["summary"]["correct"] == 1


def test_a_perfect_diagnostic_skips_an_empty_blind_review(app):
    client = app.test_client()
    headers = login(client, "perfect-blind-review@example.test")
    create_game(client, headers)
    diagnostic = client.post("/v1/diagnostics", headers=headers).json["session"]
    finished = _answer_mega_litigation(
        app,
        client,
        headers,
        diagnostic,
        diagnostic["total_items"],
    )

    assert finished["session"]["blind_review"]["state"] == "not_needed"
    assert client.get(f"/v1/study-sessions/{diagnostic['id']}/review", headers=headers).status_code == 200
    empty = client.post(f"/v1/diagnostics/{diagnostic['id']}/blind-review", headers=headers)
    assert empty.status_code == 200
    assert empty.json == {"blind_review_complete": True, "session": None}


def test_a_sealed_diagnostic_keeps_the_active_slot_until_its_blind_review_is_done(app):
    """A form with answers still sealed is what the app routes the student to.

    Until the retry is finished the diagnostic — not a new form — is the run
    `/diagnostics/current` and the post-login route hand back, which is what
    stops a student from stacking a second sitting on an unreleased one.
    """
    client = app.test_client()
    headers = login(client, "sealed-diagnostic@example.test")
    create_game(client, headers)
    diagnostic = client.post("/v1/diagnostics", headers=headers).json["session"]
    _answer_mega_litigation(app, client, headers, diagnostic, diagnostic["total_items"] - 1)

    current = client.get("/v1/diagnostics/current", headers=headers).json
    assert current["session"]["id"] == diagnostic["id"]
    assert current["session"]["blind_review"]["state"] == "ready"
    assert client.get("/v1/me", headers=headers).json["user"]["next_route"] == f"/cases/{diagnostic['id']}"

    blind = client.post(f"/v1/diagnostics/{diagnostic['id']}/blind-review", headers=headers).json["session"]
    # The retry itself now holds the slot, so the student lands back in it.
    assert client.get("/v1/diagnostics/current", headers=headers).json["session"]["id"] == blind["id"]

    item = client.get(f"/v1/study-sessions/{blind['id']}", headers=headers).json["session"]["current_item"]
    client.post(
        f"/v1/study-sessions/{blind['id']}/attempts",
        json={"item_id": item["id"], "selected_label": "C"},
        headers={**headers, "Idempotency-Key": "sealed-retry-0"},
    )

    released = client.get("/v1/diagnostics/current", headers=headers).json
    assert released["session"] is None
    assert released["latest"]["session"]["blind_review"]["state"] == "completed"
    assert client.get(f"/v1/study-sessions/{diagnostic['id']}/review", headers=headers).status_code == 200


def test_a_mega_litigation_runs_on_a_clock_per_section(app):
    """Three separately timed sections, one of them running, with a break owed.

    The real test is "four (4) separately timed, thirty-five (35) minute
    sections" with a ten-minute intermission between the second and the third
    (LSAC Candidate Agreement 2026-2027 § 15; LSAC FAQ). This form omits the
    unscored variable section, so it runs the three scored ones on the same
    terms.
    """
    client = app.test_client()
    headers = login(client, "mega-clock@example.test")
    create_game(client, headers)

    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    form = session["exam"]
    assert [section["label"] for section in form["sections"]] == [
        "Logical Reasoning I",
        "Reading Comprehension",
        "Logical Reasoning II",
    ]
    assert {section["time_limit_seconds"] for section in form["sections"]} == {35 * 60}
    # The break falls after the second section and nowhere else.
    assert [section["break_seconds"] for section in form["sections"]] == [0, 10 * 60, 0]

    # Section one is running because creating the form is the student saying
    # they are sitting it. Nothing after it has a clock yet.
    assert form["stage"] == "in_section"
    assert form["active_section_index"] == 0
    assert [section["status"] for section in form["sections"]] == ["in_progress", "pending", "pending"]
    assert form["sections"][0]["deadline_at"]
    assert all(section["deadline_at"] is None for section in form["sections"][1:])
    # The countdown the client is handed is the section's, never the form's.
    assert 0 < session["remaining_ms"] <= 35 * 60 * 1000
    assert form["warning_seconds"] == 5 * 60
    assert session["target_minutes"] == 3 * 35

    with app.app_context():
        record = db.session.get(StudySession, session["id"])
        for section in record.sections:
            targets = {
                item.target_time_seconds
                for item in SessionItem.query.filter(
                    SessionItem.session_id == record.id,
                    SessionItem.position >= section.start_position,
                    SessionItem.position <= section.end_position,
                )
            }
            # On pace means an even split of *this section's* clock, which is
            # the only budget that can actually run out on a student.
            assert targets == {round(section.time_limit_seconds / section.question_count)}


def test_a_form_refuses_work_outside_the_section_on_the_clock(app):
    """"During the time allotted for each section, you may work only on that section."

    Reaching forward into a section that has not started and back into one that
    has finished are the same prohibition, and both are refused here rather
    than merely hidden by the interface.
    """
    client = app.test_client()
    headers = login(client, "mega-boundaries@example.test")
    create_game(client, headers)
    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    session_id = session["id"]
    with app.app_context():
        record = db.session.get(StudySession, session_id)
        first, second = sorted(record.sections, key=lambda row: row.section_index)[:2]
        first_ids = [
            item.id
            for item in SessionItem.query.filter(
                SessionItem.session_id == record.id,
                SessionItem.position >= first.start_position,
                SessionItem.position <= first.end_position,
            ).order_by(SessionItem.position)
        ]
        ahead_id = SessionItem.query.filter_by(
            session_id=record.id, position=second.start_position
        ).one().id
        ahead_position = second.start_position

    # Ahead: the next section's questions are not answerable, not navigable,
    # and — the part an interface cannot be trusted with — not even served.
    assert client.put(
        f"/v1/study-sessions/{session_id}/answers/{ahead_id}",
        json={"selected_label": "C"},
        headers=headers,
    ).json["error"]["code"] == "item_outside_active_section"
    assert client.post(
        f"/v1/study-sessions/{session_id}/focus/{ahead_position}", headers=headers
    ).json["error"]["code"] == "item_outside_active_section"
    assert client.post(
        f"/v1/study-sessions/{session_id}/sections/1/start", headers=headers
    ).json["error"]["code"] == "section_already_running"

    # Inside the running section, everything is allowed: skip ahead, come back,
    # change the answer, take it off again, flag it.
    for item_id in first_ids:
        assert client.put(
            f"/v1/study-sessions/{session_id}/answers/{item_id}",
            json={"selected_label": "B"},
            headers=headers,
        ).status_code == 200
    changed = client.put(
        f"/v1/study-sessions/{session_id}/answers/{first_ids[0]}",
        json={"selected_label": "C", "flagged": True},
        headers=headers,
    )
    assert changed.json["answer"] == {
        "item_id": first_ids[0],
        "position": 0,
        "selected_label": "C",
        "flagged": True,
    }
    cleared = client.put(
        f"/v1/study-sessions/{session_id}/answers/{first_ids[1]}",
        json={"selected_label": ""},
        headers=headers,
    )
    assert cleared.json["answer"]["selected_label"] is None
    sheet = {row["position"]: row for row in cleared.json["exam"]["answer_sheet"]}
    assert sheet[0] == {**sheet[0], "answered": True, "flagged": True}
    assert sheet[1]["answered"] is False

    client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)

    # Behind: the section is closed and nothing reopens it. Nothing is running
    # at all at a boundary, which is the stronger refusal of the two.
    assert client.put(
        f"/v1/study-sessions/{session_id}/answers/{first_ids[0]}",
        json={"selected_label": "A"},
        headers=headers,
    ).json["error"]["code"] == "no_section_running"
    client.post(f"/v1/study-sessions/{session_id}/sections/1/start", headers=headers)
    assert client.put(
        f"/v1/study-sessions/{session_id}/answers/{first_ids[0]}",
        json={"selected_label": "A"},
        headers=headers,
    ).json["error"]["code"] == "item_outside_active_section"
    with app.app_context():
        graded = {
            attempt.session_item.position: attempt.selected_label
            for attempt in Attempt.query.join(SessionItem).filter(
                SessionItem.session_id == session_id
            )
        }
        # Three answers on the sheet at the bell, one taken back off it. The
        # first is the changed one, which is what got graded.
        assert graded[0] == "C"
        assert 1 not in graded
        item = SessionItem.query.filter_by(session_id=session_id, position=0).one()
        assert item.answer_revisions == 1
        assert item.flagged is True


def test_the_intermission_holds_the_third_section_shut(app):
    client = app.test_client()
    headers = login(client, "mega-intermission@example.test")
    create_game(client, headers)
    session_id = client.post("/v1/diagnostics", headers=headers).json["session"]["id"]

    client.post(f"/v1/study-sessions/{session_id}/sections/0/submit", headers=headers)
    # No break after the first section: the next one is startable at once.
    waiting = client.get(f"/v1/study-sessions/{session_id}", headers=headers).json["session"]
    assert waiting["exam"]["stage"] == "awaiting_section"
    assert waiting["exam"]["remaining_ms"] is None
    # Nothing from the next section crosses the wire before its clock starts.
    assert waiting["current_item"] is None

    client.post(f"/v1/study-sessions/{session_id}/sections/1/start", headers=headers)
    client.post(f"/v1/study-sessions/{session_id}/sections/1/submit", headers=headers)

    resting = client.get(f"/v1/study-sessions/{session_id}", headers=headers).json["session"]
    assert resting["exam"]["stage"] == "intermission"
    assert resting["exam"]["intermission_ends_at"]
    assert 0 < resting["exam"]["remaining_ms"] <= 10 * 60 * 1000
    early = client.post(f"/v1/study-sessions/{session_id}/sections/2/start", headers=headers)
    assert early.json["error"]["code"] == "intermission_in_progress"

    with app.app_context():
        _end_intermission(session_id)
    resumed = client.post(f"/v1/study-sessions/{session_id}/sections/2/start", headers=headers)
    assert resumed.status_code == 200
    assert resumed.json["session"]["exam"]["stage"] == "in_section"
    assert resumed.json["session"]["current_item"]

    # The last section closing ends the form; scoring runs without being asked.
    finished = client.post(f"/v1/study-sessions/{session_id}/sections/2/submit", headers=headers)
    assert finished.json["session"]["status"] == "completed"
    assert finished.json["summary"]["omitted"] == finished.json["session"]["total_items"]


def test_a_mega_litigation_is_the_full_reference_form_end_to_end(app):
    """The real `/v1/diagnostics` entry point has to land on 77, not just the
    question-selection helper in isolation.

    `select_diagnostic_questions` was already proven exact for whatever count
    it is handed (see `test_the_mega_litigation_form_is_exactly_the_length_it_says`
    in `test_progress.py`), and the default-config value was already proven to
    be `FORM_ITEMS` when no environment override is present (see
    `test_the_form_size_default_matches_the_scoring_reference_form`). Neither
    test exercises the actual seam between them: a real deployment's `.env` can
    carry a value under either the current name (`DIAGNOSTIC_SESSION_SIZE`) or
    the historical one (`DIAGNOSTIC_SIZE`), both of which `create_app` honours
    on purpose. A stale `DIAGNOSTIC_SIZE` left over from before that setting
    was renamed — dead for however long the old name went unread — silently
    starts mattering again the moment it collides with a real value, and
    nothing here would have caught that except a session that actually goes
    through `create_diagnostic_session` and comes out short. That is what put
    a "35 questions" mega-litigation on a real dashboard: this fixture's own
    `backend/.env` still had `DIAGNOSTIC_SIZE=35` fossilised in it from long
    before the 77-item reference form existed.
    """
    from app.scoring import FORM_ITEMS

    assert app.config["DIAGNOSTIC_SESSION_SIZE"] == FORM_ITEMS, (
        "DIAGNOSTIC_SESSION_SIZE resolved to a non-default value in a test run "
        "that never asked for one — check backend/.env for a stale "
        "DIAGNOSTIC_SIZE or DIAGNOSTIC_SESSION_SIZE left over from before the "
        f"form was fixed at {FORM_ITEMS} items."
    )

    # The shared fixture only seeds a dozen sample questions, plenty for tests
    # that check ordering or clocking but not enough for the bank to ever offer
    # a real 77-item form. Bulk up supply well past the reference form's size
    # so this test can prove the actual count, not just that the bank was the
    # bottleneck.
    with app.app_context():
        for index in range(12, 72):
            add_question(index, "Logical Reasoning")
        for index in range(72, 112):
            add_question(index, "Reading Comprehension")
        db.session.commit()

    client = app.test_client()
    headers = login(client, "mega-full-length@example.test")
    create_game(client, headers)

    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    assert session["total_items"] == FORM_ITEMS

    with app.app_context():
        record = db.session.get(StudySession, session["id"])
        assert record.total_items == FORM_ITEMS
        assert SessionItem.query.filter_by(session_id=record.id).count() == FORM_ITEMS
        assert sum(block["questions"] for block in record.section_plan_json) == FORM_ITEMS


def test_a_mega_litigation_cannot_be_paused_or_resumed(app):
    """One sitting means the clock is wall-clock, and nothing stops wall-clock."""
    client = app.test_client()
    headers = login(client, "mega-no-pause@example.test")
    create_game(client, headers)
    session = client.post("/v1/diagnostics", headers=headers).json["session"]

    paused = client.post(f"/v1/study-sessions/{session['id']}/pause", headers=headers)
    assert paused.status_code == 409
    assert paused.json["error"]["code"] == "diagnostic_no_pause"

    resumed = client.post(f"/v1/study-sessions/{session['id']}/resume", headers=headers)
    assert resumed.status_code == 409
    assert resumed.json["error"]["code"] == "diagnostic_no_pause"

    with app.app_context():
        assert db.session.get(StudySession, session["id"]).status == "in_progress"


def test_a_section_whose_clock_runs_out_ends_hard_and_the_form_carries_on(app):
    """"Once time expires for each section, no additional inputs may be made."

    The bell is not the end of the sitting — two sections are still owed — but
    it is the end of that section, and it is final: whatever was on the sheet
    is graded, whatever was not stays blank, and nothing reopens it. The
    expiry is discovered by the next request rather than by a sweeper, which
    is what makes shutting the laptop cost the student the time it costs.
    """
    client = app.test_client()
    headers = login(client, "mega-expired@example.test")
    create_game(client, headers)
    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    session_id = session["id"]
    first_item = session["current_item"]["id"]
    client.put(
        f"/v1/study-sessions/{session_id}/answers/{first_item}",
        json={"selected_label": "C"},
        headers=headers,
    )

    with app.app_context():
        _expire_running_section(session_id)
        section_size = db.session.get(StudySession, session_id).sections[0].question_count

    late = client.put(
        f"/v1/study-sessions/{session_id}/answers/{first_item}",
        json={"selected_label": "A"},
        headers=headers,
    )
    assert late.status_code == 409
    assert late.json["error"]["code"] == "no_section_running"

    after = client.get(f"/v1/study-sessions/{session_id}", headers=headers).json["session"]
    # The form is not over; the section is.
    assert after["status"] == "in_progress"
    assert after["exam"]["stage"] == "awaiting_section"
    closed = after["exam"]["sections"][0]
    assert closed["status"] == "completed"
    assert closed["ended_reason"] == "expired"
    assert closed["unanswered"] == section_size - 1

    with app.app_context():
        record = db.session.get(StudySession, session_id)
        expired = record.sections[0]
        # Credited to the bell, not to whenever the student next made a
        # request: an unattended expiry must not hand back the time it took to
        # notice it.
        assert expired.ended_at == expired.deadline_at
        answered = Attempt.query.join(SessionItem).filter(SessionItem.session_id == session_id).one()
        assert answered.selected_label == "C"
        assert answered.session_item.position == 0


def test_a_sitting_walked_away_from_at_a_boundary_is_closed_out(app):
    """One sitting, kept a fact rather than a label.

    A section that has not been started has no clock, so without this a form
    could be begun on Monday and finished on Friday and still enter the score
    projection as a timed administration. The grace period is generous, and
    what it protects is the meaning of the number.
    """
    client = app.test_client()
    headers = login(client, "mega-restart@example.test")
    create_game(client, headers)
    first = client.post("/v1/diagnostics", headers=headers).json["session"]

    with app.app_context():
        _expire_running_section(first["id"])
        # Still the active form immediately after the bell: two sections are
        # owed and the student has an hour to come back for them.
        user = User.query.filter_by(email="mega-restart@example.test").one()
        from app.services import find_active_diagnostic

        assert find_active_diagnostic(user).id == first["id"]

        db.session.execute(
            update(SessionSection)
            .where(SessionSection.session_id == first["id"], SessionSection.status == "completed")
            .values(ended_at=utcnow() - timedelta(hours=3))
        )
        db.session.commit()

        assert find_active_diagnostic(user) is None
        record = db.session.get(StudySession, first["id"])
        assert record.status == "completed"
        assert [section.ended_reason for section in record.sections] == [
            "expired",
            "abandoned",
            "abandoned",
        ]

    current = client.get("/v1/diagnostics/current", headers=headers).json
    assert current["session"] is None
    assert current["latest"]["session"]["id"] == first["id"]

    second = client.post("/v1/diagnostics", headers=headers)
    assert second.status_code == 201
    assert second.json["session"]["id"] != first["id"]


def test_clearing_a_mega_litigation_promotes_the_firm_and_unlocks_prerequisites(app):
    """Above 70% of the whole form: one tier, every gate opened, nothing paid."""
    client = app.test_client()
    headers = login(client, "mega-promoted@example.test")
    profile_id = create_game(client, headers)["id"]
    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    total = session["total_items"]
    cleared = int(0.70 * total) + 1

    finished = _answer_mega_litigation(app, client, headers, session, cleared)
    summary = finished["summary"]
    assert summary["correct"] == cleared
    assert summary["form_accuracy"] > 70

    promotion = summary["promotion"]
    required = {
        asset["key"] for asset in ASSETS if asset["type"] in TIER_GATED_ASSET_TYPES and asset["tier"] < 1
    }
    assert promotion["tier"] == 1
    assert promotion["name"] == FIRM_TIERS[1]["name"]
    assert {granted["key"] for granted in promotion["granted_assets"]} == required
    assert promotion["waived_cost"] == FIRM_TIERS[1]["cost"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        assert profile.office_tier == 1
        # Reputation follows the firm up: clients and assets unlock off
        # reputation, so a tier-1 office standing at tier-0 esteem would show
        # its owner a floor of work they cannot take.
        assert profile.reputation >= FIRM_TIERS[1]["reputation"]
        assert profile.cash == 250
        assert {asset.asset_key for asset in PlayerAsset.query.filter_by(profile_id=profile.id)} == required
        assert all(asset.purchase_price == 0 for asset in PlayerAsset.query.filter_by(profile_id=profile.id))
        entry = LedgerEntry.query.filter_by(kind="mega_litigation_promotion").one()
        assert entry.amount == 0


def test_a_mega_litigation_under_the_bar_promotes_nothing(app):
    client = app.test_client()
    headers = login(client, "mega-short@example.test")
    profile_id = create_game(client, headers)["id"]
    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    short = int(0.70 * session["total_items"])

    finished = _answer_mega_litigation(app, client, headers, session, short)
    assert finished["summary"]["form_accuracy"] <= 70
    assert "promotion" not in finished["summary"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        assert profile.office_tier == 0
        assert PlayerAsset.query.filter_by(profile_id=profile.id).count() == 0
        assert LedgerEntry.query.filter_by(kind="mega_litigation_promotion").count() == 0


def test_a_promotion_is_paid_once_however_often_the_form_is_finalized(app):
    """Finalization is reachable from the last answer and from the clock alike."""
    client = app.test_client()
    headers = login(client, "mega-once@example.test")
    profile_id = create_game(client, headers)["id"]
    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    cleared = int(0.70 * session["total_items"]) + 1
    _answer_mega_litigation(app, client, headers, session, cleared)

    with app.app_context():
        from app.services import finalize_diagnostic

        record = db.session.get(StudySession, session["id"])
        summary = finalize_diagnostic(record)
        assert summary["promotion"]["tier"] == 1
        assert LedgerEntry.query.filter_by(kind="mega_litigation_promotion").count() == 1
        assert PlayerProfile.query.filter_by(id=profile_id).one().office_tier == 1


def test_a_promotion_at_the_top_of_the_ladder_is_a_no_op(app):
    client = app.test_client()
    headers = login(client, "mega-topped-out@example.test")
    profile_id = create_game(client, headers)["id"]

    with app.app_context():
        from app.game import grant_mega_litigation_promotion

        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        profile.office_tier = len(FIRM_TIERS) - 1
        db.session.commit()

        assert grant_mega_litigation_promotion(profile, "nowhere-left-to-go") is None
        assert PlayerProfile.query.filter_by(id=profile_id).one().office_tier == len(FIRM_TIERS) - 1
        assert LedgerEntry.query.filter_by(kind="mega_litigation_promotion").count() == 0


def _clear_a_mega_litigation(app, client, headers) -> dict:
    """Sit a fresh form and clear the promotion bar. Returns its summary."""
    started = client.post("/v1/diagnostics", headers=headers)
    assert started.status_code == 201, started.json
    session = started.json["session"]
    cleared = int(0.70 * session["total_items"]) + 1
    finished = _answer_mega_litigation(app, client, headers, session, cleared)
    assert finished["summary"]["form_accuracy"] > 70
    return finished["summary"]


def test_a_second_mega_litigation_the_same_day_promotes_nothing(app):
    """The free tier is a daily windfall, not a ladder.

    Per-session idempotency never stopped this: it only refuses to pay the same
    form twice, and starting a brand new form was always one request away. A
    fresh account could chain forms tier 0 -> tier 14 in an afternoon.
    """
    client = app.test_client()
    headers = login(client, "mega-cooldown@example.test")
    profile_id = create_game(client, headers)["id"]

    assert _clear_a_mega_litigation(app, client, headers)["promotion"]["tier"] == 1

    blocked = _clear_a_mega_litigation(app, client, headers)
    assert "promotion" not in blocked
    assert blocked["promotion_status"]["blocked_reason"] == "cooldown"
    assert blocked["promotion_status"]["available"] is False
    assert blocked["promotion_status"]["available_at"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        assert profile.office_tier == 1
        assert profile.mega_litigation_promotions == 1
        assert LedgerEntry.query.filter_by(kind="mega_litigation_promotion").count() == 1


def test_a_mega_litigation_promotes_again_once_the_day_has_passed(app):
    client = app.test_client()
    headers = login(client, "mega-cooldown-elapsed@example.test")
    profile_id = create_game(client, headers)["id"]

    _clear_a_mega_litigation(app, client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        profile.mega_litigation_promoted_at = utcnow() - timedelta(hours=25)
        db.session.commit()

    promotion = _clear_a_mega_litigation(app, client, headers)["promotion"]
    assert promotion["tier"] == 2
    assert promotion["allowance"]["used"] == 2

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        assert profile.office_tier == 2
        assert profile.mega_litigation_promotions == 2
        assert LedgerEntry.query.filter_by(kind="mega_litigation_promotion").count() == 2


def test_free_promotions_stop_at_the_lifetime_allowance(app):
    """Enough of a head start to feel like a windfall; never a route to the top."""
    from app.game import MEGA_LITIGATION_PROMOTION_LIMIT

    client = app.test_client()
    headers = login(client, "mega-allowance@example.test")
    profile_id = create_game(client, headers)["id"]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        profile.mega_litigation_promotions = MEGA_LITIGATION_PROMOTION_LIMIT
        db.session.commit()

    spent = _clear_a_mega_litigation(app, client, headers)
    assert "promotion" not in spent
    assert spent["promotion_status"]["blocked_reason"] == "lifetime_limit"
    assert spent["promotion_status"]["remaining"] == 0

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=profile_id).one()
        # No cooldown left to wait out, and no free tier either.
        assert profile.office_tier == 0
        assert profile.mega_litigation_promoted_at is None
        assert LedgerEntry.query.filter_by(kind="mega_litigation_promotion").count() == 0
        assert MEGA_LITIGATION_PROMOTION_LIMIT < len(FIRM_TIERS) - 1


def _completed_mega_litigation(user_id: str, results: list[tuple[Question, bool]]) -> StudySession:
    """A finished form with a chosen right/wrong answer per question."""
    session = StudySession(
        user_id=user_id,
        mode="diagnostic",
        practice_style="diagnostic",
        feedback_policy="delayed",
        target_minutes=24,
        total_items=len(results),
        status="completed",
        completed_at=utcnow(),
    )
    db.session.add(session)
    db.session.flush()
    for position, (question, is_correct) in enumerate(results):
        item = SessionItem(
            session_id=session.id,
            question_id=question.id,
            position=position,
            requires_reasoning=False,
            target_time_seconds=84,
        )
        db.session.add(item)
        db.session.flush()
        db.session.add(
            Attempt(
                user_id=user_id,
                session_item_id=item.id,
                idempotency_key=f"focus-{session.id}-{position}",
                selected_label="C" if is_correct else "A",
                is_correct=is_correct,
                confidence=3,
                server_elapsed_ms=60_000,
                evidence_class="diagnostic",
            )
        )
    db.session.commit()
    return session


def test_focus_types_are_the_weak_spots_of_the_latest_mega_litigation(app):
    """Weak means below this student's own average on this form, not below a fixed bar."""
    with app.app_context():
        user = User(email="focus-types@example.test", display_name="Focus")
        db.session.add(user)
        db.session.flush()
        questions = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).all()
        for index, question in enumerate(questions[:6]):
            question.question_type = ["Flaw", "Flaw", "Assumption", "Assumption", "Inference", "Inference"][index]
        db.session.commit()

        flaw, assumption, inference = questions[0:2], questions[2:4], questions[4:6]
        _completed_mega_litigation(
            user.id,
            [(flaw[0], False), (flaw[1], False)]
            + [(assumption[0], True), (assumption[1], False)]
            + [(inference[0], True), (inference[1], True)],
        )

        from app.focus import diagnostic_focus_detail

        detail = diagnostic_focus_detail(user.id)
        # The form ran at 50%. Flaw (0%) and Assumption (50%)... Assumption sits
        # on the average, not under it, so only Flaw qualifies.
        assert detail["baseline_accuracy"] == 50
        assert detail["types"] == ["Flaw"]


def test_a_type_seen_once_in_a_mega_litigation_is_not_yet_a_weakness(app):
    """One unlucky question must not brand a whole question type."""
    with app.app_context():
        user = User(email="focus-sample@example.test", display_name="Sample")
        db.session.add(user)
        db.session.flush()
        questions = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).all()
        questions[0].question_type = "Parallel Reasoning"
        for question in questions[1:4]:
            question.question_type = "Inference"
        db.session.commit()

        _completed_mega_litigation(
            user.id,
            [(questions[0], False), (questions[1], True), (questions[2], True), (questions[3], False)],
        )

        from app.focus import diagnostic_focus

        assert diagnostic_focus(user.id) == []


def test_a_focused_case_run_draws_most_of_its_questions_from_those_types(app):
    """A bias, not a filter: the rest of the test still gets practiced."""
    with app.app_context():
        questions = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).all()
        for question in questions[:4]:
            question.question_type = "Flaw"
        db.session.commit()

        from app.services import (
            FOCUS_FILL_RATIO,
            passage_overshoot_allowance,
            select_random_questions,
        )

        size = 5
        for _ in range(8):
            picked = select_random_questions(size, focus_types=["Flaw"])
            # A run reaches its size and may pass it only far enough to finish a
            # Reading Comprehension passage, focus quota or no focus quota.
            assert size <= len(picked) <= size + passage_overshoot_allowance(size)
            focused = sum(question.question_type == "Flaw" for question in picked)
            assert focused >= round(size * FOCUS_FILL_RATIO)
            assert focused < len(picked)

        # No focus, no bias — the run is a plain sample of everything eligible.
        unfocused = [
            sum(question.question_type == "Flaw" for question in select_random_questions(size))
            for _ in range(8)
        ]
        assert min(unfocused) < round(size * FOCUS_FILL_RATIO)


def _strategy_observation(user_id: str, question: Question, key: str, index: int, is_correct: bool) -> None:
    session = StudySession(
        user_id=user_id,
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
        target_time_seconds=150,
        strategy_key=key,
        strategy_variant="prompt",
    )
    db.session.add(item)
    db.session.flush()
    db.session.add(
        Attempt(
            user_id=user_id,
            session_item_id=item.id,
            idempotency_key=f"coverage-{key}-{index}",
            selected_label="C" if is_correct else "A",
            is_correct=is_correct,
            reasoning_text=explanation(f"the {key} observation {index}"),
            confidence=3,
            server_elapsed_ms=60_000,
            strategy_key=key,
            strategy_variant="prompt",
            strategy_applied=True,
        )
    )


def test_a_weak_type_keeps_exploring_strategies_after_others_have_settled(app):
    """The extra runway goes where a wrong early winner would cost the most."""
    with app.app_context():
        user = User(email="focus-coverage@example.test", display_name="Coverage")
        db.session.add(user)
        db.session.flush()
        question = Question.query.filter_by(section="Logical Reasoning").order_by(Question.id).first()

        from app.strategies import (
            BASE_COVERAGE_TRIALS,
            FOCUS_COVERAGE_TRIALS,
            _candidate_keys,
            assign_strategy_trial,
        )

        candidates = _candidate_keys(question)
        assert len(candidates) > 1
        starved, *settled = candidates
        # Every approach but one has cleared the base coverage bar, and the one
        # that has not is also the worst performer — so coverage and exploit
        # cannot pick the same key.
        for index in range(BASE_COVERAGE_TRIALS):
            _strategy_observation(user.id, question, starved, index, is_correct=False)
        for key in settled:
            for index in range(BASE_COVERAGE_TRIALS + 1):
                _strategy_observation(user.id, question, key, index, is_correct=True)
        db.session.commit()

        assert BASE_COVERAGE_TRIALS < FOCUS_COVERAGE_TRIALS
        assert assign_strategy_trial(user.id, question, "cases", 1)["key"] != starved
        focused = assign_strategy_trial(
            user.id, question, "cases", 1, focus_types=[question.question_type]
        )
        assert focused["key"] == starved
        # The focus list is read by question type, not applied to everything.
        elsewhere = assign_strategy_trial(user.id, question, "cases", 1, focus_types=["Some Other Type"])
        assert elsewhere["key"] != starved


def test_the_mega_litigation_reports_its_sitting_and_explains_the_focus(app):
    client = app.test_client()
    headers = login(client, "mega-report@example.test")
    create_game(client, headers)

    blank = client.get("/v1/performance", headers=headers).json["performance"]
    assert blank["focus"]["types"] == []
    assert "Finish a mega-litigation" in blank["focus"]["explanation"]

    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    total = session["total_items"]
    _answer_mega_litigation(app, client, headers, session, total - 1)

    snapshot = client.get("/v1/performance", headers=headers).json["performance"]
    report = snapshot["diagnostic"]
    assert report["form_total"] == total
    assert report["completion_percent"] == 100
    assert report["time_limit_minutes"] == session["target_minutes"]
    # The whole sitting is the unit now: how much of the budget went out, and
    # how much of the paper it bought.
    assert report["budget_used_percent"] == round(
        100 * report["elapsed_minutes"] / session["target_minutes"]
    )
    assert report["promotion"]["tier"] == 1
    # The diagnostic pays no per-question cash, so the promotion is the only
    # thing the whole form put in the ledger.
    with app.app_context():
        user = User.query.filter_by(email="mega-report@example.test").one()
        kinds = {entry.kind for entry in LedgerEntry.query.filter_by(user_id=user.id)}
        assert kinds == {"opening_balance", "mega_litigation_promotion"}


def _current_item(client, headers, session_id: str) -> dict | None:
    body = client.get(f"/v1/study-sessions/{session_id}", headers=headers).json["session"]
    return body.get("current_item") or body.get("pending_item")


def _save_draft(client, headers, session_id: str, item_id: str, reasoning: str):
    return client.patch(
        f"/v1/study-sessions/{session_id}/items/{item_id}/draft",
        json={"selected_label": "B", "reasoning": reasoning},
        headers=headers,
    )


def test_draft_autosave_covers_every_openable_run_and_404s_only_once_the_run_is_gone(app):
    """The autosave is the only copy of reasoning a student is part-way through
    writing, so the shapes it accepts are a contract rather than an accident.

    `_owned_session` scopes by owner *and* by a mode allow-list, and both the
    draft path and the sibling `/attempts` path go through it. Narrowing either
    filter — adding a fourth mode, or excluding a run that is merely paused —
    would turn a legitimate save into a 404, and a 404 here is silently
    discarded written work rather than a visible failure. That is exactly the
    shape a QA sweep flagged, so it is pinned here in both directions: every run
    the case page can display accepts a draft, and a 404 is reserved for a run
    that genuinely is not there.
    """
    client = app.test_client()
    headers = login(client, "draft-autosave@example.test")
    create_game(client, headers)

    # A live practice run: the ordinary case page.
    first = client.post("/v1/study-sessions", json={"size": 3}, headers=headers).json["session"]
    first_item = _current_item(client, headers, first["id"])
    saved = _save_draft(client, headers, first["id"], first_item["id"], "The conclusion needs the missing link.")
    assert saved.status_code == 200
    assert saved.json["saved"] is True
    assert saved.json["draft"]["reasoning"] == "The conclusion needs the missing link."
    with app.app_context():
        assert db.session.get(SessionItem, first_item["id"]).draft_reasoning_text == (
            "The conclusion needs the missing link."
        )

    # Opening a second run auto-pauses the first. A queued run is still on a
    # student's docket and still holds their typing, so it must keep accepting
    # drafts — scoping the lookup to `in_progress` alone would lose that work.
    second = client.post("/v1/study-sessions", json={"size": 3}, headers=headers).json["session"]
    with app.app_context():
        assert db.session.get(StudySession, first["id"]).status == "paused"
    paused_save = _save_draft(client, headers, first["id"], first_item["id"], "Still mine while it waits.")
    assert paused_save.status_code == 200
    assert paused_save.json["draft"]["reasoning"] == "Still mine while it waits."

    # A form is the one run the autosave has nothing to hold. It is found
    # through the same lookup — the mode allow-list still admits it — and then
    # refused on its own terms, because a sectioned administration has no
    # reasoning box to be part-way through: `grade_exam_answer` writes
    # `reasoning_text=None` whatever is on the row. Refusing is the honest
    # answer rather than the convenient one. Accepting would let a stale tab
    # keep saving text that is silently dropped at the bell, which is the
    # failure this test exists to prevent, wearing the opposite mask.
    diagnostic = client.post("/v1/diagnostics", json={"length": 1}, headers=headers)
    assert diagnostic.status_code == 201
    diagnostic_session = diagnostic.json["session"]
    diagnostic_item = _current_item(client, headers, diagnostic_session["id"])
    refused = _save_draft(
        client, headers, diagnostic_session["id"], diagnostic_item["id"], "Reading the stimulus first."
    )
    assert refused.status_code == 409
    assert refused.json["error"]["code"] == "exam_uses_answer_sheet"
    with app.app_context():
        assert db.session.get(SessionItem, diagnostic_item["id"]).draft_reasoning_text is None

    # Someone else's run is not found rather than forbidden: whether a given id
    # exists is not something an unrelated account gets to learn.
    intruder = app.test_client()
    intruder_headers = login(intruder, "draft-intruder@example.test")
    create_game(intruder, intruder_headers)
    assert _save_draft(
        intruder, intruder_headers, first["id"], first_item["id"], "Not mine to write on."
    ).status_code == 404

    # And the honest 404: a run that has been removed underneath an open tab —
    # which is what `scripts/seed_demo.py` does to the demo account every time
    # it is re-run. The draft path and the sibling attempts path must agree,
    # because a client that sees one succeed and the other fail cannot tell
    # whether the work it is holding was kept.
    second_item = _current_item(client, headers, second["id"])
    with app.app_context():
        db.session.delete(db.session.get(StudySession, second["id"]))
        db.session.commit()
    gone_draft = _save_draft(client, headers, second["id"], second_item["id"], "Typed into a run that is gone.")
    assert gone_draft.status_code == 404
    assert gone_draft.json["error"]["code"] == "session_not_found"
    gone_attempt = client.post(
        f"/v1/study-sessions/{second['id']}/attempts",
        json={"item_id": second_item["id"], "selected_label": "C", "reasoning": explanation("gone"), "confidence": 3},
        headers=headers,
    )
    assert gone_attempt.status_code == 404
    assert gone_attempt.json["error"]["code"] == "session_not_found"
