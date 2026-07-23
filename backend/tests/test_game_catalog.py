from __future__ import annotations

import math

from app.game import ASSETS, ASSET_BY_KEY, CLIENTS, FIRM_TIERS, _public_client, _score_multiplier
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


def test_each_office_is_reachable_in_five_floor_payout_cases():
    # Even a minimum-score result against the best prior-tier matter funds the
    # next headquarters within the intended 3–5 case progression window.
    assert _score_multiplier(1) == .60
    for tier in FIRM_TIERS[1:]:
        prior_tier = tier["tier"] - 1
        best_client = max(
            (client for client in CLIENTS if client["tier"] <= prior_tier),
            key=lambda client: client["base_fee"] * client.get("payout_mult", 1),
        )
        floor_payout = (
            best_client["base_fee"]
            * best_client.get("payout_mult", 1)
            * _score_multiplier(1)
            * (1 + prior_tier * .06)
        )
        assert math.ceil(tier["cost"] / floor_payout) <= 5, tier["name"]


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
