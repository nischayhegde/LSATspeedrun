from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app import create_app
from app.extensions import db
from app.game import (
    ASSET_BY_KEY,
    DISTRICTS,
    DISTRICT_BY_KEY,
    DISTRICT_KEYS_BY_REGION,
    FIRM_TIERS,
    TERRITORY_REGIONS,
    TERRITORY_STANDING_CAP,
    TERRITORY_STANDING_FLOOR_CEILING,
    TERRITORY_TOTAL_CASE_BUDGET,
    UNBALANCED_ASSET_TYPES,
    _career_floor,
    _case_target_for_tier,
    _relieved_daily_rent,
    _territory_totals,
    secure_district,
    serialize_game,
    settle_upkeep,
    territory_state,
)
from app.models import PlayerProfile, PlayerTerritory, User, utcnow
from app.trial import (
    MAX_SUSTAINABLE_WEEKLY_CASES,
    TARGET_EVIDENCE_SAMPLE,
    _accuracy_for_scaled,
    _cases_to_close_gap,
    _retention,
    trial_plan,
)


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "TFY_URL": "",
            "TFY_API_KEY": "",
        }
    )
    with application.app_context():
        yield application


def make_profile(*, tier: int = 0, reputation: float = 0, cash: int = 0) -> PlayerProfile:
    user = User(email=f"t{utcnow().timestamp()}@example.test", display_name="Test")
    db.session.add(user)
    db.session.flush()
    profile = PlayerProfile(
        user_id=user.id,
        lawyer_name="Alex Morgan",
        firm_name="Morgan Legal",
        character_gender="female",
        office_tier=tier,
        reputation=reputation,
        cash=cash,
    )
    db.session.add(profile)
    db.session.commit()
    return profile


# --- Mechanic 1: standing retainers ----------------------------------------


def test_the_whole_retainer_board_costs_its_stated_case_budget():
    """The mechanic's total drag on playtime is one number, and this is it.

    Buying the core catalog out is ~950 solid cases and ~69 engaged hours. If
    this drifts, the campaign length claim in the audit drifts with it.
    """
    total = sum(item["cost"] / _case_target_for_tier(item["tier"]) for item in DISTRICTS)
    assert TERRITORY_TOTAL_CASE_BUDGET * 0.97 <= total <= TERRITORY_TOTAL_CASE_BUDGET * 1.03
    assert total <= 40, "territory must stay a rounding error against a 950-case campaign"


def test_no_district_is_a_better_deal_than_any_other():
    """Standing per case is flat, so there is no purchase order to optimise."""
    rates = [item["standing"] / (item["cost"] / _case_target_for_tier(item["tier"])) for item in DISTRICTS]
    assert max(rates) - min(rates) < 0.02


def test_every_district_is_cheaper_than_the_cheapest_real_asset_at_its_tier():
    """A retainer must never compete with an upgrade for the same money.

    Districts buy no payout multiplier at all. If one ever cost more than a
    tier's cheapest genuine upgrade it would be a trap purchase.
    """
    for item in DISTRICTS:
        peers = [
            asset["cost"]
            for asset in ASSET_BY_KEY.values()
            if asset["tier"] == item["tier"] and asset["type"] not in UNBALANCED_ASSET_TYPES
        ]
        if peers:
            assert item["cost"] < min(peers), item["key"]


def test_districts_are_not_assets_and_cannot_satisfy_a_tier_requirement(app):
    """The two namespaces stay separate, which is the whole point of the table."""
    assert not set(DISTRICT_BY_KEY) & set(ASSET_BY_KEY)
    for tier in FIRM_TIERS:
        for requirement in tier.get("requires", []) or []:
            assert requirement not in DISTRICT_BY_KEY


def test_a_district_is_gated_on_both_tier_and_reputation(app):
    profile = make_profile(tier=0, reputation=0, cash=10**12)
    board = {item["key"]: item for item in territory_state(profile)["districts"]}
    assert board["chancery_row"]["available"]
    assert not board["quarter_courthouse"]["available"]
    assert board["quarter_courthouse"]["locks"]

    with pytest.raises(ValueError, match="district_locked"):
        secure_district(profile, "quarter_courthouse")
    with pytest.raises(ValueError, match="district_not_found"):
        secure_district(profile, "not_a_place")


def test_securing_a_district_charges_cash_and_grants_standing(app):
    district = DISTRICT_BY_KEY["chancery_row"]
    profile = make_profile(tier=0, reputation=0, cash=district["cost"] * 2)
    before = profile.cash

    result = secure_district(profile, district["key"])
    assert result["price"] == district["cost"]
    assert profile.cash == before - district["cost"]
    assert profile.lifetime_spending == district["cost"]
    assert result["standing_gained"] == pytest.approx(district["standing"], abs=0.01)

    with pytest.raises(ValueError, match="district_already_held"):
        secure_district(profile, district["key"])
    assert PlayerTerritory.query.filter_by(profile_id=profile.id).count() == 1


def test_insufficient_cash_leaves_the_board_untouched(app):
    district = DISTRICT_BY_KEY["chancery_row"]
    profile = make_profile(tier=0, reputation=0, cash=district["cost"] - 1)
    with pytest.raises(ValueError, match="insufficient_cash"):
        secure_district(profile, district["key"])
    assert PlayerTerritory.query.filter_by(profile_id=profile.id).count() == 0
    assert profile.cash == district["cost"] - 1


def test_sweeping_a_region_pays_a_bonus_and_the_total_is_capped(app):
    profile = make_profile(tier=14, reputation=100, cash=10**14)
    city_keys = DISTRICT_KEYS_BY_REGION["city"]
    for index, key in enumerate(city_keys):
        result = secure_district(profile, key)
        assert result["region_swept"] is (index == len(city_keys) - 1)

    state = territory_state(profile)
    city = next(region for region in state["regions"] if region["key"] == "city")
    assert city["swept"] and city["held"] == city["total"]
    assert state["standing"] > sum(DISTRICT_BY_KEY[key]["standing"] for key in city_keys)

    every = {item["key"] for item in DISTRICTS}
    assert _territory_totals(every)["standing"] == pytest.approx(TERRITORY_STANDING_CAP, abs=0.05)
    assert _territory_totals(every)["relief_bps"] == 10_000


def test_standing_lifts_the_reputation_floor_but_not_past_the_last_gates():
    """The 91-reputation pro bono work and the 94-reputation final headquarters
    have to be earned in answered questions, not bought."""
    cap = TERRITORY_STANDING_CAP
    # Early on, standing is worth real protection.
    assert _career_floor(0, 0, 0) == 50
    assert _career_floor(0, 0, 4.0) == 54
    # It is bounded, so no amount of money reaches the top of the ladder.
    assert _career_floor(0, 0, cap) <= TERRITORY_STANDING_FLOOR_CEILING
    assert _career_floor(30, 20, cap) == TERRITORY_STANDING_FLOOR_CEILING
    assert TERRITORY_STANDING_FLOOR_CEILING < 91

    # Casework alone still reaches every gate, unchanged by this mechanic.
    assert _career_floor(60, 40, 0) == _career_floor(60, 40, cap) == 96.0
    assert _career_floor(50, 30, 0) > 91


def test_holding_districts_reduces_the_office_lease(app):
    profile = make_profile(tier=4, reputation=100, cash=10**12)
    list_rent = int(FIRM_TIERS[4]["rent_daily"])
    assert _relieved_daily_rent(profile) == list_rent

    for key in DISTRICT_KEYS_BY_REGION["city"]:
        secure_district(profile, key)

    relieved = _relieved_daily_rent(profile)
    assert 0 < relieved < list_rent
    payload = serialize_game(profile)["upkeep"]
    assert payload["daily_rent"] == relieved
    assert payload["list_daily_rent"] == list_rent
    assert payload["rent_relief"] == list_rent - relieved

    # Total relief is bounded by the lease itself: rent can reach zero but never
    # turn into income.
    assert _relieved_daily_rent(profile, {item["key"] for item in DISTRICTS}) == 0


def test_a_fully_retained_map_stops_the_lease_without_breaking_settlement(app):
    """Relief reaches zero rent, which is the one arithmetic edge here: the
    arrears cap, the accrual, and the payment path are all derived from the
    daily figure."""
    profile = make_profile(tier=14, reputation=100, cash=10**15)
    for item in DISTRICTS:
        secure_district(profile, item["key"])

    profile.upkeep_settled_at = utcnow() - timedelta(days=9)
    profile.last_active_at = profile.upkeep_settled_at
    cash_before = profile.cash
    state = settle_upkeep(profile)

    assert state["daily_rent"] == 0
    assert state["rent_relief"] == state["list_daily_rent"] > 0
    assert state["settlement"]["new_rent"] == 0
    assert profile.rent_arrears == 0
    assert profile.cash == cash_before


def test_the_game_payload_carries_the_board(app):
    profile = make_profile(tier=0, reputation=0, cash=0)
    territory = serialize_game(profile)["territory"]
    assert territory["total"] == len(DISTRICTS) == 38
    assert territory["held"] == 0 and territory["standing"] == 0
    assert {region["key"] for region in territory["regions"]} == {
        region["key"] for region in TERRITORY_REGIONS
    }
    assert territory["standing_floor_ceiling"] == TERRITORY_STANDING_FLOOR_CEILING


# --- Mechanic 2: the trial calendar ----------------------------------------


def stub_projection(**overrides) -> dict:
    return {
        "available": True,
        "scaled_score": 155,
        "upper_bound": 160,
        "lower_bound": 150,
        "observed_accuracy": 0.72,
        "effective_sample": 20.0,
        "observed_attempts": 40,
        **overrides,
    }


def make_user(*, target_score=165, days_out=90) -> User:
    user = User(
        email=f"trial{utcnow().timestamp()}@example.test",
        display_name="Test",
        target_score=target_score,
        target_test_date=(date.today() + timedelta(days=days_out)) if days_out is not None else None,
    )
    db.session.add(user)
    db.session.commit()
    return user


def test_no_test_date_is_an_invitation_not_an_error(app):
    plan = trial_plan(make_user(days_out=None), projection=stub_projection())
    assert plan["status"] == "unscheduled"
    assert plan["days_remaining"] is None
    assert "Set the date" in plan["detail"]


def test_a_past_test_date_offers_the_next_sitting(app):
    plan = trial_plan(make_user(days_out=-5), projection=stub_projection())
    assert plan["status"] == "passed"
    assert plan["days_remaining"] == -5
    assert "5 days ago" in plan["headline"]
    assert "carry over" in plan["detail"]


def test_the_countdown_survives_a_missing_projection_or_target(app):
    plan = trial_plan(make_user(), projection={"available": False, "reason": "no_evidence"})
    assert plan["status"] == "no_evidence"
    assert plan["days_remaining"] == 90 and plan["phase"]

    plan = trial_plan(make_user(target_score=None), projection=stub_projection())
    assert plan["status"] == "no_target"
    assert plan["days_remaining"] == 90


def test_phases_read_as_stages_of_a_case_not_as_warnings(app):
    for days, expected in ((0, "Trial"), (2, "Eve of trial"), (10, "Final preparation"),
                           (30, "Pre-trial conference"), (70, "Pre-trial motions"), (200, "Discovery")):
        plan = trial_plan(make_user(days_out=days), projection=stub_projection())
        assert plan["phase"] == expected, days
    assert trial_plan(make_user(days_out=0), projection=stub_projection())["headline"] == "Trial today"


def test_a_reachable_target_becomes_a_weekly_caseload(app):
    """Accuracy above the target means only shrinkage stands in the way, and
    the cases that clear it can be solved for exactly."""
    user = make_user(target_score=160, days_out=84)
    plan = trial_plan(user, projection=stub_projection(observed_accuracy=0.80, scaled_score=152))
    assert plan["status"] in {"on_plan", "tight"}
    assert plan["pace"]["weekly_target"] >= 3
    assert plan["pace"]["gap_cases"] is not None
    assert str(plan["pace"]["weekly_target"]) in plan["detail"]


def test_a_target_above_the_learners_own_answer_rate_is_named_honestly(app):
    """No number of cases at a 60% rate produces a 175, and the plan says so
    rather than printing an impossible weekly figure."""
    user = make_user(target_score=175, days_out=90)
    plan = trial_plan(user, projection=stub_projection(observed_accuracy=0.60, scaled_score=150))
    assert plan["status"] == "accuracy_gap"
    assert plan["pace"]["gap_cases"] is None
    assert "review-and-technique" in plan["detail"]
    assert plan["pace"]["weekly_target"] >= 3


def test_an_impossible_schedule_is_capped_rather_than_shouted(app):
    user = make_user(target_score=170, days_out=5)
    plan = trial_plan(user, projection=stub_projection(observed_accuracy=0.95, scaled_score=150, effective_sample=1.0))
    assert plan["pace"]["weekly_target"] <= MAX_SUSTAINABLE_WEEKLY_CASES
    if plan["status"] == "tight":
        assert "later sitting" in plan["detail"]


def test_the_weekly_target_falls_as_the_runway_lengthens(app):
    projection = stub_projection(observed_accuracy=0.82, scaled_score=152)
    short = trial_plan(make_user(target_score=160, days_out=21), projection=projection)
    long = trial_plan(make_user(target_score=160, days_out=140), projection=projection)
    assert short["pace"]["weekly_target"] >= long["pace"]["weekly_target"]


def test_pacing_reads_off_the_existing_projection_ruler():
    """The required accuracy comes out of the same conversion table the
    projection converts through, not a parallel one."""
    assert _accuracy_for_scaled(120) == 0.0
    assert 0 < _accuracy_for_scaled(155) < _accuracy_for_scaled(170) <= 1.0

    cases, _ = _cases_to_close_gap(
        observed_accuracy=0.80,
        effective_sample=5.0,
        required_accuracy=0.78,
        days_remaining=60,
        case_weight=0.55,
    )
    assert cases and cases > 0
    # A learner already carrying plenty of evidence at that rate needs less.
    fewer, _ = _cases_to_close_gap(
        observed_accuracy=0.80,
        effective_sample=200.0,
        required_accuracy=0.78,
        days_remaining=60,
        case_weight=0.55,
    )
    assert fewer <= cases


def test_recency_decay_is_priced_in_rather_than_ignored():
    """Cases lose weight while the run-up runs; a 90-day plan that ignored that
    would undercount by more than half."""
    assert _retention(0) == 1.0
    assert 0.9 < _retention(7) < 1.0
    assert _retention(90) < 0.55
    assert _retention(180) < _retention(90)


def test_target_evidence_sample_is_the_grade_the_dashboard_already_names():
    assert TARGET_EVIDENCE_SAMPLE == 80
