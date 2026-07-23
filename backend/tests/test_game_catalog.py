from __future__ import annotations

from app.game import (
    ASSETS,
    ASSET_BY_KEY,
    CLIENTS,
    CORE_COMPLETION_CASE_RANGE,
    FIRM_TIERS,
    PROGRESSION_CASE_TARGET_BY_TIER,
    _public_client,
    _score_multiplier,
    simulate_catalog_progression,
)
from app.models import PlayerClientContract, PlayerProfile


def test_empire_catalog_is_large_coherent_and_frontier_scaled():
    assert len(FIRM_TIERS) == 15
    assert len(ASSETS) >= 90
    assert len(CLIENTS) >= 50
    assert max(tier["cost"] for tier in FIRM_TIERS) >= 80_000_000_000
    assert max(asset["cost"] for asset in ASSETS) >= 100_000_000_000

    asset_keys = [asset["key"] for asset in ASSETS]
    client_keys = [client["key"] for client in CLIENTS]
    assert len(asset_keys) == len(set(asset_keys))
    assert len(client_keys) == len(set(client_keys))

    for definition in [*ASSETS, *CLIENTS]:
        assert 0 <= definition["tier"] < len(FIRM_TIERS)
        assert definition.get("region")
        assert set(definition.get("requires", ())) <= set(ASSET_BY_KEY)


def test_cash_only_catalog_progression_lands_in_the_three_to_four_week_window():
    report = simulate_catalog_progression()

    # The simulation purchases the whole gameplay catalog, not merely the 14
    # office shells, using the same cash settlement inputs as active play.
    assert report["purchase_count"] == len(ASSETS) + len(FIRM_TIERS) - 1
    assert report["asset_count"] == len(ASSETS)
    assert report["total_cases"] == 326
    assert CORE_COMPLETION_CASE_RANGE[0] <= report["total_cases"] <= CORE_COMPLETION_CASE_RANGE[1]

    # Every recommendation has a useful practice interval; later districts
    # increase gently from two to three to four cases instead of spiking.
    onboarding, *subsequent = report["purchases"]
    assert onboarding["key"] == "repaired_desk" and onboarding["cases"] == 1
    assert all(2 <= purchase["cases"] <= 5 for purchase in subsequent)
    assert tuple(sorted(set(PROGRESSION_CASE_TARGET_BY_TIER))) == (2, 3, 4)
    assert list(PROGRESSION_CASE_TARGET_BY_TIER) == sorted(PROGRESSION_CASE_TARGET_BY_TIER)
    for purchase in subsequent:
        assert purchase["cases"] == PROGRESSION_CASE_TARGET_BY_TIER[purchase["tier"]]


def test_every_cash_purchase_exposes_its_case_pacing_target():
    assert _score_multiplier(1) == .60
    for item in ASSETS:
        expected_cases = 1 if item["key"] == "repaired_desk" else PROGRESSION_CASE_TARGET_BY_TIER[item["tier"]]
        assert item["pacing_cases"] == expected_cases
        assert isinstance(item["cost"], int) and item["cost"] > 0
    for office in FIRM_TIERS[1:]:
        prior_tier = office["tier"] - 1
        assert office["pacing_cases"] == PROGRESSION_CASE_TARGET_BY_TIER[prior_tier]
        assert isinstance(office["cost"], int) and office["cost"] > 0


def test_character_clients_offer_real_contract_variety():
    archetypes = {client.get("archetype") for client in CLIENTS}
    assert {
        "Criminal defense",
        "Fraud recovery",
        "Repeat litigant",
        "Mass injury",
        "Corporate investigation",
        "White-collar defense",
    } <= archetypes
    twisted = [client for client in CLIENTS if client.get("special")]
    assert len(twisted) >= 25
    assert any(client.get("minimum_score_multiplier") for client in twisted)
    assert any(client.get("contract_bonus_mult") for client in twisted)
    assert any(client.get("reputation_guard") for client in twisted)


def test_signed_client_does_not_relock_after_reputation_dip():
    profile = PlayerProfile(
        id="profile",
        user_id="user",
        lawyer_name="Test Counsel",
        firm_name="Test Law",
        character_gender="female",
        reputation=0,
        office_tier=4,
        active_client_key="crypto_founder",
    )
    profile.client_contracts.append(
        PlayerClientContract(client_key="crypto_founder", cases_remaining=4)
    )
    public = _public_client(
        next(client for client in CLIENTS if client["key"] == "crypto_founder"),
        profile,
        set(),
    )
    assert public["unlocked"] is True
    assert public["on_hold"] is False
