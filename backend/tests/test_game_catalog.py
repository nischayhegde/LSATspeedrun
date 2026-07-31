from __future__ import annotations

from app.game import (
    ASSETS,
    ASSET_BY_KEY,
    CLIENTS,
    COSMETICS,
    FIRM_TIERS,
    TIER_GATED_ASSET_TYPES,
    UNBALANCED_ASSET_TYPES,
    _case_target_for_tier,
    _missing_tier_assets,
    _public_client,
)
from app.models import PlayerClientContract, PlayerProfile


def test_empire_catalog_is_large_coherent_and_frontier_scaled():
    assert len(FIRM_TIERS) == 15
    assert len(ASSETS) >= 90
    assert len(CLIENTS) >= 50
    assert max(tier["cost"] for tier in FIRM_TIERS) >= 160_000_000_000
    assert max(asset["cost"] for asset in ASSETS) >= 100_000_000_000

    asset_keys = [asset["key"] for asset in ASSETS]
    client_keys = [client["key"] for client in CLIENTS]
    assert len(asset_keys) == len(set(asset_keys))
    assert len(client_keys) == len(set(client_keys))

    for definition in [*ASSETS, *CLIENTS]:
        assert 0 <= definition["tier"] < len(FIRM_TIERS)
        assert definition.get("region")
        assert set(definition.get("requires", ())) <= set(ASSET_BY_KEY)


def test_each_tier_requires_all_prior_upgrades_staff_and_acquisitions():
    for target_tier in range(1, len(FIRM_TIERS)):
        expected = {
            asset["key"]
            for asset in ASSETS
            if asset["type"] in TIER_GATED_ASSET_TYPES and asset["tier"] < target_tier
        }
        assert set(_missing_tier_assets(target_tier, set())) == expected
        assert _missing_tier_assets(target_tier, expected) == []


def test_firm_tiers_use_the_more_expensive_price_curve():
    assert [tier["cost"] for tier in FIRM_TIERS] == [
        0,
        6_000,
        36_000,
        180_000,
        800_000,
        3_600_000,
        16_000_000,
        70_000_000,
        300_000_000,
        1_200_000_000,
        4_000_000_000,
        12_000_000_000,
        30_000_000_000,
        70_000_000_000,
        160_000_000_000,
    ]


def _expected_solid_case_value(client: dict) -> float:
    tier = client["tier"]
    return client["base_fee"] * (
        1.20 * (1 + tier * .06) * client.get("payout_mult", 1)
        + (2 + client.get("contract_bonus_mult", 0)) / client["length"]
    )


def test_commercial_clients_fund_the_more_expensive_next_office_in_six_to_ten_good_cases():
    for client in CLIENTS:
        tier = client["tier"]
        if client.get("matter_type") == "pro_bono" or tier >= len(FIRM_TIERS) - 1:
            continue
        cases = FIRM_TIERS[tier + 1]["cost"] / _expected_solid_case_value(client)
        assert 6 <= cases <= 10, client["name"]


def test_same_tier_commercial_clients_have_comparable_expected_value():
    for tier in range(len(FIRM_TIERS)):
        values = [
            _expected_solid_case_value(client)
            for client in CLIENTS
            if client["tier"] == tier and client.get("matter_type") != "pro_bono"
        ]
        if len(values) > 1:
            assert max(values) / min(values) <= 1.05, FIRM_TIERS[tier]["name"]


def test_assets_are_useful_and_cost_about_three_to_five_good_cases():
    for asset in ASSETS:
        if asset["type"] in UNBALANCED_ASSET_TYPES:
            continue
        case_cost = asset["cost"] / _case_target_for_tier(asset["tier"])
        assert 3 <= case_cost <= 5.1, asset["name"]
        assert asset["payout_mult"] > 0, asset["name"]
        assert "case payout" in asset["benefit"], asset["name"]


def test_cosmetics_are_affordable_decor_with_no_economy_effect():
    cosmetics = [asset for asset in ASSETS if asset["type"] == "cosmetic"]
    assert len(cosmetics) >= 8
    assert COSMETICS == cosmetics
    # Decor spans the progression curve without duplicating a tier's identity.
    assert min(asset["tier"] for asset in cosmetics) == 0
    assert max(asset["tier"] for asset in cosmetics) >= 10
    for asset in cosmetics:
        # Every cosmetic is a cheap indulgence next to the functional purchase
        # at the same tier, which costs three to five good cases.
        case_cost = asset["cost"] / _case_target_for_tier(asset["tier"])
        assert .3 <= case_cost <= 1.6, asset["name"]
        assert asset["benefit"].startswith("Decor · "), asset["name"]
        for effect in ("payout_mult", "staff_flat", "passive_hourly", "storage_hours", "streak_bonus_cap", "contract_bonus_mult", "reputation_guard"):
            assert effect not in asset, f"{asset['name']} · {effect}"


def test_cosmetics_never_gate_a_headquarters_advance():
    assert "cosmetic" not in TIER_GATED_ASSET_TYPES
    cosmetic_keys = {asset["key"] for asset in ASSETS if asset["type"] == "cosmetic"}
    for target_tier in range(1, len(FIRM_TIERS)):
        assert not cosmetic_keys & set(_missing_tier_assets(target_tier, set()))


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
