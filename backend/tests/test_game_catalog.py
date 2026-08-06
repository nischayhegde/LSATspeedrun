from __future__ import annotations

import pytest

from app.game import (
    ASSETS,
    ASSET_BY_KEY,
    CLIENTS,
    COSMETICS,
    FIRM_TIERS,
    FIRM_TIER_COST_MULTIPLIER,
    PRO_BONO_FEE_SHARE,
    TARGET_CASES_PER_MILESTONE,
    TIER_GATED_ASSET_TYPES,
    UNBALANCED_ASSET_TYPES,
    WARDROBE,
    WARDROBE_BY_KEY,
    WARDROBE_CATEGORY_KEYS,
    WARDROBE_DEFAULTS,
    _case_target_for_tier,
    _expected_firm_multiplier,
    _missing_tier_assets,
    _public_client,
    _tier_effort_scale,
    _wardrobe_requirement,
    _wardrobe_unlocked,
    serialize_wardrobe,
    wardrobe_selection,
)
from app.models import PlayerClientContract, PlayerProfile, PlayerStoryState
from app.story import CHAPTER_BY_KEY, QUESTS, STORY_CHAPTERS


def _milestone_case_budget(tier: int) -> float:
    """Solid cases the headquarters above ``tier`` is meant to cost."""
    return TARGET_CASES_PER_MILESTONE * FIRM_TIER_COST_MULTIPLIER * _tier_effort_scale(tier)


def test_empire_catalog_is_large_coherent_and_frontier_scaled():
    assert len(FIRM_TIERS) == 15
    assert len(ASSETS) >= 90
    assert len(CLIENTS) >= 50
    # Big enough to read as an empire, small enough to stay human money. The top
    # of the ladder used to be a $160,000,000,000 headquarters paying itself off
    # with $72,000,000,000 client fees, which left the header rendering the
    # player's balance in quadrillions.
    assert 100_000_000 <= max(tier["cost"] for tier in FIRM_TIERS) <= 1_000_000_000
    assert max(asset["cost"] for asset in ASSETS) <= 1_000_000_000
    assert max(client["base_fee"] for client in CLIENTS) <= 10_000_000
    assert max(int(asset.get("passive_hourly", 0)) for asset in ASSETS) <= 10_000_000

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


def test_firm_tiers_climb_a_legible_price_curve():
    assert [tier["cost"] for tier in FIRM_TIERS] == [
        0,
        6_000,
        18_000,
        50_000,
        130_000,
        320_000,
        750_000,
        1_700_000,
        3_600_000,
        7_500_000,
        15_000_000,
        30_000_000,
        60_000_000,
        120_000_000,
        240_000_000,
    ]
    # Each office is a real step up without the price ever running away from
    # money a person can picture.
    for tier in range(2, len(FIRM_TIERS)):
        growth = FIRM_TIERS[tier]["cost"] / FIRM_TIERS[tier - 1]["cost"]
        assert 1.9 <= growth <= 3.1, FIRM_TIERS[tier]["name"]


def test_every_rung_of_the_ladder_costs_eight_to_twelve_cases():
    """Progress arrives at the same rate at the top of the ladder as the bottom.

    The rungs used to widen steeply — eight cases for the first headquarters,
    seventy-four for the last — on the theory that late tiers should be
    multi-week climbs. Simulated against a realistic player that produced a
    1,944-case campaign in which a late purchase cost thirty-four cases, so the
    reward for climbing shrank the higher you got. Both quotes now sit inside
    the same eight-to-twelve band, and the mild upward drift is all that is left
    of the old escalation.

    The figures here are *nominal*: they assume every case is a solid win paying
    exactly `_case_target_for_tier`, which ignores contract closes, streaks,
    support staff, and passive income. Those matter more the richer the firm
    gets, so nominal overstates the late rungs. Simulating the real catalog
    against a 72%-accuracy player puts the realized cost at 8.2-11.7 cases per
    purchase across all fourteen rungs, for a 940-case, 69-hour campaign.
    """
    budgets = [_milestone_case_budget(tier) for tier in range(len(FIRM_TIERS) - 1)]
    assert budgets == sorted(budgets)
    for tier, budget in enumerate(budgets):
        assert 9 <= budget <= 14, f"tier {tier} headquarters costs {budget:.1f} cases"
    # A late rung still costs visibly more work than an early one, but the whole
    # spread across fifteen tiers is smaller than the spread between the
    # cheapest and dearest purchase inside any single tier.
    assert 1.2 <= budgets[-1] / budgets[0] <= 1.8


def test_the_whole_campaign_is_priced_in_weeks_of_study():
    """Total cases a greedy playthrough must win to buy the game out.

    Roughly 950 solid cases, which simulation puts at about 940 played cases and
    69 engaged hours for a 72%-accuracy player at 4.4 minutes a case. That is
    47 days of twenty-case sittings or 94 days at ten a day, which is the one-to
    -two-month study habit the ladder is meant to carry. It replaces a 1,944-
    case, 144-hour campaign that was twice as long as anyone would finish, and
    an interim 443-case tuning that was half as long as the habit needed.
    Buying the catalog out is not the same as exhausting the app: the question
    bank and the review schedule outlast the firm ladder.
    """
    total_cases = 0.0
    for tier in range(len(FIRM_TIERS)):
        target = _case_target_for_tier(tier)
        if tier + 1 < len(FIRM_TIERS):
            total_cases += FIRM_TIERS[tier + 1]["cost"] / target
        total_cases += sum(
            asset["cost"] / target
            for asset in ASSETS
            if asset["tier"] == tier and asset["type"] not in UNBALANCED_ASSET_TYPES
        )
    assert 800 <= total_cases <= 1_150


def _expected_solid_case_value(client: dict) -> float:
    tier = client["tier"]
    return client["base_fee"] * (
        1.20 * _expected_firm_multiplier(tier) * client.get("payout_mult", 1)
        + (2 + client.get("contract_bonus_mult", 0)) / client["length"]
    )


def test_commercial_clients_fund_the_next_office_in_that_tiers_case_budget():
    for client in CLIENTS:
        tier = client["tier"]
        if client.get("matter_type") == "pro_bono" or tier >= len(FIRM_TIERS) - 1:
            continue
        cases = FIRM_TIERS[tier + 1]["cost"] / _expected_solid_case_value(client)
        budget = _milestone_case_budget(tier)
        assert budget * .94 <= cases <= budget * 1.06, client["name"]


def test_same_tier_commercial_clients_are_all_worth_one_case_target():
    """Which client you sign is a question of play style, never of income.

    The only spread is the two-significant-digit rounding every catalog price
    goes through, so this pins the absolute value rather than just the ratio.
    """
    for client in CLIENTS:
        if client.get("matter_type") == "pro_bono":
            continue
        assert _expected_solid_case_value(client) == pytest.approx(
            _case_target_for_tier(client["tier"]), rel=.05
        ), client["name"]


def test_pro_bono_matters_pay_below_the_market_rate_for_their_tier():
    """Service work buys standing, not cash.

    Their fees used to be authored by hand, which quietly made them the
    best-paying client at every tier once the economy was rescaled around them —
    so "take the highest fee on the board" and "take the pro bono matter" became
    the same instruction, and the trade-off stopped existing.
    """
    commercial = {}
    for client in CLIENTS:
        if client.get("matter_type") != "pro_bono":
            commercial.setdefault(client["tier"], []).append(_expected_solid_case_value(client))
    for client in CLIENTS:
        if client.get("matter_type") != "pro_bono":
            continue
        peers = commercial.get(client["tier"])
        assert peers, client["name"]
        ratio = _expected_solid_case_value(client) / (sum(peers) / len(peers))
        assert ratio == pytest.approx(PRO_BONO_FEE_SHARE, abs=.05), client["name"]
        assert client["reputation_win_bonus"] > 0, client["name"]


def test_assets_are_useful_and_cost_three_to_five_good_cases_at_their_tier():
    for asset in ASSETS:
        if asset["type"] in UNBALANCED_ASSET_TYPES:
            continue
        tier = asset["tier"]
        case_cost = asset["cost"] / (_case_target_for_tier(tier) * _tier_effort_scale(tier))
        assert 3 <= case_cost <= 5.2, asset["name"]
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


def _tier_bill(tier: int) -> int:
    """Every mandatory dollar the player spends while sitting at ``tier``."""
    catalog = sum(
        asset["cost"]
        for asset in ASSETS
        if asset["tier"] == tier and asset["type"] in TIER_GATED_ASSET_TYPES
    )
    headquarters = FIRM_TIERS[tier + 1]["cost"] if tier + 1 < len(FIRM_TIERS) else 0
    return catalog + headquarters


def test_story_cash_stays_a_windfall_not_a_shortcut():
    """A story beat may hand over an upgrade or two, never the rest of the game.

    Chapter payouts and quest advances were authored against an older economy
    and never rescaled with it: the tier-10 charter paid $2,000,000,000 into a
    ladder whose fifteen headquarters cost $479,074,000 in total, so one
    dialogue choice was worth more than four times everything left to buy.

    Measured in dollars against what the money actually buys, rather than in
    cases. Both sides of this ratio are fixed catalog prices, so retuning the
    pace of the game — which moves `_case_target_for_tier` and nothing else —
    cannot make a correctly sized payout look wrong. A case-denominated version
    of this test failed the first time the ladder was repaced even though every
    payout was still worth exactly the same fraction of a tier's shopping list.
    """
    payouts = [
        (f"{chapter['key']}/{choice['key']}", chapter["tier"], choice["effects"]["cash"])
        for chapter in STORY_CHAPTERS
        for choice in chapter["choices"]
        if choice["effects"].get("cash")
    ]
    advances = [
        (f"quest {quest['key']}", quest["tier"], quest["start"]["cash"])
        for quest in QUESTS
        if (quest.get("start") or {}).get("cash")
    ]
    assert len(payouts) >= 5 and len(advances) >= 3
    for name, tier, cash in payouts:
        share = cash / _tier_bill(tier)
        assert .05 <= share <= .50, f"{name} pays {share:.0%} of its tier's bill"
    for name, tier, cash in advances:
        # An advance is taken against work not yet done and costs standing and
        # ethics up front, so it stays smaller than an act's own payout.
        share = cash / _tier_bill(tier)
        assert .05 <= share <= .25, f"{name} advances {share:.0%} of its tier's bill"
    # And no beat that still has a ladder above it dents that ladder much. The
    # finale is exempt: it fires at the top tier, on the choice that ends the
    # campaign, when there is nothing left to buy.
    for name, tier, cash in [*payouts, *advances]:
        if tier >= len(FIRM_TIERS) - 1:
            continue
        remaining = sum(_tier_bill(above) for above in range(tier, len(FIRM_TIERS)))
        assert cash / remaining <= .05, f"{name} pays {cash / remaining:.0%} of the rest of the game"


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


def _wardrobe_profile(**overrides) -> PlayerProfile:
    fields = {
        "id": "profile",
        "user_id": "user",
        "lawyer_name": "Test Counsel",
        "firm_name": "Test Law",
        "character_gender": "female",
        "reputation": 50.0,
        "office_tier": 0,
        "total_cases": 0,
        "cosmetics_json": {},
    }
    fields.update(overrides)
    return PlayerProfile(**fields)


def test_wardrobe_covers_every_category_and_opens_each_one_from_the_start():
    keys = [item["key"] for item in WARDROBE]
    assert len(keys) == len(set(keys))
    assert WARDROBE_CATEGORY_KEYS == ["suit", "tie", "hair", "eyewear", "accessory"]
    assert {item["category"] for item in WARDROBE} == set(WARDROBE_CATEGORY_KEYS)

    fresh = _wardrobe_profile()
    for category in WARDROBE_CATEGORY_KEYS:
        pieces = [item for item in WARDROBE if item["category"] == category]
        # Three or more pieces per category, at least two of which a brand-new
        # account can already wear, so the panel is never an empty locked wall.
        assert len(pieces) >= 3
        assert len([item for item in pieces if _wardrobe_unlocked(item, fresh)]) >= 2
        # The default is the category's first entry and is always available.
        assert pieces[0]["key"] == WARDROBE_DEFAULTS[category]
        assert pieces[0]["unlock"]["kind"] == "start"
    assert len([item for item in WARDROBE if item["unlock"]["kind"] != "start"]) >= 10


def test_every_wardrobe_unlock_names_real_progression_and_reads_plainly():
    for item in WARDROBE:
        unlock = item["unlock"]
        assert item["name"] and item["flavor"]
        requirement = _wardrobe_requirement(unlock)
        assert requirement and requirement[0].isupper()
        if unlock["kind"] == "tier":
            assert 0 < int(unlock["value"]) < len(FIRM_TIERS)
            assert FIRM_TIERS[int(unlock["value"])]["name"] in requirement
        elif unlock["kind"] == "reputation":
            assert 0 < int(unlock["value"]) <= 100
        elif unlock["kind"] == "cases":
            assert int(unlock["value"]) > 0
        elif unlock["kind"] == "chapter":
            assert unlock["value"] in CHAPTER_BY_KEY
            assert CHAPTER_BY_KEY[unlock["value"]]["title"] in requirement
        else:
            assert unlock["kind"] == "start"
    # Each unlock kind is actually used, so the panel teaches every route the
    # game has for earning something.
    assert {item["unlock"]["kind"] for item in WARDROBE} == {"start", "tier", "reputation", "cases", "chapter"}


def test_wardrobe_unlocks_track_tier_reputation_casework_and_chapters():
    assert not _wardrobe_unlocked(WARDROBE_BY_KEY["suit_forest"], _wardrobe_profile(office_tier=2))
    assert _wardrobe_unlocked(WARDROBE_BY_KEY["suit_forest"], _wardrobe_profile(office_tier=3))
    assert not _wardrobe_unlocked(WARDROBE_BY_KEY["tie_gold_foulard"], _wardrobe_profile(reputation=59))
    assert _wardrobe_unlocked(WARDROBE_BY_KEY["tie_gold_foulard"], _wardrobe_profile(reputation=60))
    assert not _wardrobe_unlocked(WARDROBE_BY_KEY["eyewear_rectangular"], _wardrobe_profile(total_cases=49))
    assert _wardrobe_unlocked(WARDROBE_BY_KEY["eyewear_rectangular"], _wardrobe_profile(total_cases=50))

    chaptered = _wardrobe_profile()
    assert not _wardrobe_unlocked(WARDROBE_BY_KEY["suit_pinstripe"], chaptered)
    chaptered.story_state = PlayerStoryState(seen_chapters_json=["sterling_invitation"])
    assert _wardrobe_unlocked(WARDROBE_BY_KEY["suit_pinstripe"], chaptered)


def test_untouched_profile_reads_as_wearing_every_default():
    profile = _wardrobe_profile(character_gender="male")
    assert wardrobe_selection(profile) == WARDROBE_DEFAULTS


def test_issued_neckwear_follows_the_character_the_player_chose():
    """The two cuts are drawn differently, so "as issued" differs too.

    The male cut has always worn the house four-in-hand and the female cut an
    open shirt collar. Both are catalog pieces either character can choose; only
    which one arrives unchosen depends on the character.
    """
    assert wardrobe_selection(_wardrobe_profile(character_gender="male"))["tie"] == "tie_house_burgundy"
    assert wardrobe_selection(_wardrobe_profile(character_gender="female"))["tie"] == "tie_open_collar"
    for gender in ("male", "female"):
        profile = _wardrobe_profile(character_gender=gender, cosmetics_json={"tie": "tie_house_burgundy"})
        assert wardrobe_selection(profile)["tie"] == "tie_house_burgundy"


def test_selection_falls_back_when_a_stored_piece_is_no_longer_earned():
    """Reputation can fall, so a stored choice is re-checked on every read."""
    profile = _wardrobe_profile(character_gender="male", reputation=60, cosmetics_json={"tie": "tie_gold_foulard"})
    assert wardrobe_selection(profile)["tie"] == "tie_gold_foulard"
    profile.reputation = 40
    assert wardrobe_selection(profile)["tie"] == WARDROBE_DEFAULTS["tie"]
    # And the stored choice is kept rather than erased, so climbing back to the
    # band the player already earned restores the look they chose.
    assert profile.cosmetics_json == {"tie": "tie_gold_foulard"}


def test_selection_ignores_unknown_and_miscategorized_stored_keys():
    profile = _wardrobe_profile(character_gender="male", cosmetics_json={"suit": "suit_from_the_future", "tie": "suit_charcoal"})
    selection = wardrobe_selection(profile)
    assert selection["suit"] == WARDROBE_DEFAULTS["suit"]
    assert selection["tie"] == WARDROBE_DEFAULTS["tie"]


def test_serialized_wardrobe_states_the_requirement_on_every_locked_piece():
    payload = serialize_wardrobe(_wardrobe_profile(character_gender="male", office_tier=1, reputation=20, total_cases=3))
    assert [category["key"] for category in payload["categories"]] == WARDROBE_CATEGORY_KEYS
    assert payload["selection"] == WARDROBE_DEFAULTS
    locked = [
        item
        for category in payload["categories"]
        for item in category["items"]
        if not item["unlocked"]
    ]
    assert locked
    for item in locked:
        assert item["requirement"] and item["requirement"] != "Available from your first day"
    for category in payload["categories"]:
        assert category["selected"] == category["default"]
        assert any(item["unlocked"] for item in category["items"])
        assert category["blurb"] and category["name"]


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
