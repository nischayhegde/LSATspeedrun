from __future__ import annotations

import pytest

from app.game import (
    ASSETS,
    ASSET_BY_KEY,
    CLIENTS,
    COSMETICS,
    DAILY_REWARD_CASE_BUDGET,
    DAILY_REWARD_MULTIPLIERS,
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
    _daily_reward_amount,
    _expected_firm_multiplier,
    _missing_tier_assets,
    _public_client,
    _tier_effort_scale,
    _wardrobe_requirement,
    _wardrobe_unlocked,
    daily_reward_for_tier,
    serialize_wardrobe,
    wardrobe_selection,
)
from app.models import PlayerClientContract, PlayerProfile, PlayerStoryState
from app.story import CHAPTER_BY_KEY, QUESTS, STORY_CHAPTERS
from scripts.simulate_economy_curve import (
    FALLBACK_SECONDS_PER_CASE,
    MINUTES_PER_CASE,
    TARGET_HOURS_PER_UPGRADE,
    Player,
    curve,
    fee_inversions,
    total_campaign,
    upgrade_band,
)

# Derived from the documented fallback instead of imported. The module-level
# `TARGET_BAND` divides by `SECONDS_PER_CASE`, which `seconds_per_case()` reads
# out of backend/instance/lsat_sherlock.db — so a dev server answering questions
# in the background moves this band while the suite runs. It drifted across the
# measured floor mid-release once, failing a catalog that had not changed. The
# catalog these tests guard is a fixed artifact, so the band that judges it has
# to be fixed too.
TARGET_BAND = tuple(
    hours * 3600 / FALLBACK_SECONDS_PER_CASE for hours in TARGET_HOURS_PER_UPGRADE
)

# 79 tier-gated assets plus 14 headquarters. Nothing else has to be bought to
# finish the ladder.
MANDATORY_PURCHASES = 93


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
    # Fees are quoted per *case*, so retuning the ladder to one-to-two hours an
    # upgrade cut every fee about 5.6x without moving a single price the player
    # pays: the same headquarters now has to be earned in 5.6x as many cases.
    # The ceiling that matters is the one above, on what things cost.
    assert max(client["base_fee"] for client in CLIENTS) <= 20_000_000
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


def test_every_rung_of_the_ladder_costs_one_to_two_hours():
    """Progress arrives at the same rate at the top of the ladder as the bottom.

    The rungs used to widen steeply — eight cases for the first headquarters,
    seventy-four for the last — on the theory that late tiers should be
    multi-week climbs. Simulated against a realistic player that produced a
    campaign in which a late purchase cost ten times an early one, so the reward
    for climbing shrank the higher you got. Both quotes now sit inside the same
    one-to-two-hour band, and the mild upward drift is all that is left of the
    old escalation.

    The band is asserted in hours rather than in cases because hours are what
    the brief asks for and cases are only the unit the catalog happens to be
    priced in. A previous revision pinned "3 to 6 cases" as a literal, which
    read as an hour or two to whoever wrote it but is 10-21 minutes at the pace
    the app actually serves: a case is one attempted question, not a sitting.
    `TARGET_BAND` converts through the shipped `_target_time_seconds`, so this
    test follows the pacing model instead of freezing one conversion of it.

    The figures here are *nominal*: they assume every case is a solid win paying
    exactly `_case_target_for_tier`, which ignores contract closes, streaks,
    support staff, and idle retainers. `test_the_measured_curve_stays_inside_the
    _one_to_two_hour_band` is the one that checks the number a player actually
    experiences; this one is the cheap guard on the budget the catalog is priced
    from.
    """
    budgets = [_milestone_case_budget(tier) for tier in range(len(FIRM_TIERS) - 1)]
    assert budgets == sorted(budgets)
    low, high = TARGET_BAND
    for tier, budget in enumerate(budgets):
        hours = budget * MINUTES_PER_CASE / 60
        assert low <= budget <= high, (
            f"tier {tier} headquarters costs {budget:.1f} cases ({hours:.2f}h), "
            f"outside {low:.1f}-{high:.1f} cases"
        )
    # A late rung still costs visibly more work than an early one. The drift has
    # to stay small: a purchase costs three to five cases by design, a 1.67x
    # spread inside every single tier, and the band is only 2x wide, so the
    # whole fifteen-tier climb has to fit in the 1.2x left over. A drift of
    # 1.36x did not, which is why no base could hold the band. That constraint
    # is a ratio and so did not move when the band was restated in hours.
    assert 1.1 <= budgets[-1] / budgets[0] <= 1.2


def test_the_measured_curve_stays_inside_the_one_to_two_hour_band():
    """What a real player pays for an upgrade, not what the budget intended.

    This runs `scripts/simulate_economy_curve.py` against the shipped catalog:
    72% accuracy, ordinary prose, rent every day, idle retainers collected once
    a day, contract closes and streaks amortised. Nominal and measured disagree
    by about 20% and not by a constant — idle income is worth nothing at tier 0
    and 15% of income by tier 6 — so the nominal guard above cannot stand in for
    this one.

    Every mandatory purchase counts, headquarters included, because the next
    office is the upgrade the player is saving for at every rung.

    Scoped to income the player earns *from casework*: 19.21-32.72 cases,
    1.12-1.90 hours. Daily-goal claims are excluded here and measured on their
    own in `test_the_band_holds_for_a_player_who_claims_their_daily_goals`. The
    split is not a convenience. This band is the one the catalog is priced
    against, and it has to keep failing on a mispriced asset rather than on a
    change to the reward schedule; the daily band moves with both and cannot
    tell you which one did. Until dailies were put in the income model at all
    they were missing from every number here, which is what let a tier-0 daily
    reward grow to 158% of a purchase unnoticed.

    This is the loose side now. `TIER_EFFORT_BASE` is tuned to the claiming
    player, who is the binding one, so the margin here is 12% at the floor and
    4.8% at the ceiling — and the ceiling is the edge to watch, because the
    dearest purchase for a player taking no daily income is the longest grind
    in the game.
    """
    rows = curve(Player(claims_dailies=False))
    low, high = upgrade_band(rows)
    floor, ceiling = TARGET_BAND
    assert floor <= low, (
        f"cheapest upgrade costs only {low:.2f} cases "
        f"({low * MINUTES_PER_CASE / 60:.2f}h, floor {floor:.1f})"
    )
    assert high <= ceiling, (
        f"dearest upgrade costs {high:.2f} cases "
        f"({high * MINUTES_PER_CASE / 60:.2f}h, ceiling {ceiling:.1f})"
    )

    # Fees must climb strictly: no inversion and no tie. The top tier has no
    # next milestone to price against and extrapolates its own, and an earlier
    # version of that extrapolation reused the final headquarters cost outright,
    # which flattened tier 14 onto tier 13 and could invert the ordering.
    # `fee_inversions` treats a tie as an inversion, and the two assertions
    # below re-check both properties directly rather than trusting it to.
    assert fee_inversions() == []
    fees = [_case_target_for_tier(tier) for tier in range(len(FIRM_TIERS))]
    assert all(later > earlier for earlier, later in zip(fees, fees[1:])), fees
    assert len(set(fees)) == len(fees), fees

    # No rung may be more than twice the work of any other, or the ladder is
    # back to escalating even while every rung sits inside the band.
    assert high / low <= 2.0


def test_the_band_holds_for_a_player_who_claims_their_daily_goals():
    """The binding band, and the one `TIER_EFFORT_BASE` is actually tuned to.

    A daily-claiming player is the normal player: the goals are one tap on a
    screen they are already looking at, and they are worth a tenth of income at
    every tier. They were nonetheless absent from the income model entirely,
    so the band was being measured against somebody who declines them. With
    them counted at TIER_EFFORT_BASE 5.16 the band read 16.65-28.27 cases and
    the tier-1 deposition studio cost 58 minutes, under the floor. The base was
    repaced to 5.33 rather than shrinking the reward to fit a measurement that
    was ignoring it, and the claiming player now measures 17.21-29.34
    (1.00-1.71 hours) with nothing under an hour.

    This is the tight side: 0.2% of clearance at the floor, against 12% for the
    case-income band above. That asymmetry is the point — the claiming player
    hits the floor first, so this is the test that fails when an income source
    grows, and the case-income band is what fails when an asset is mispriced.

    The floor assertion here is absolute: *no* mandatory purchase may cost less
    than an hour. It replaces a bound that tolerated exactly one, which was the
    honest description of the game before the base moved and is not any more.
    """
    claiming = curve(Player())
    case_income_only = curve(Player(claims_dailies=False))
    low, high = upgrade_band(claiming)
    floor, ceiling = TARGET_BAND

    assert floor <= low, (
        f"cheapest upgrade costs only {low:.2f} cases "
        f"({low * MINUTES_PER_CASE / 60:.2f}h, floor {floor:.1f})"
    )
    assert high <= ceiling, (
        f"dearest upgrade costs {high:.2f} cases "
        f"({high * MINUTES_PER_CASE / 60:.2f}h, ceiling {ceiling:.1f})"
    )

    # Not one purchase in the game, at any tier, is under an hour for them.
    under = [
        (row["tier"], round(value, 2))
        for row in claiming
        for value in (row["cheapest_cases"], row["dearest_cases"], row["headquarters_cases"])
        if value is not None and value < floor
    ]
    assert under == [], under

    # Dailies still bite, or the base was repaced for nothing: claiming has to
    # be strictly cheaper than not claiming, at every rung.
    for claimed, unclaimed in zip(claiming, case_income_only):
        assert claimed["cash_per_case"] > unclaimed["cash_per_case"], claimed["tier"]
    assert low < upgrade_band(case_income_only)[0]
    assert high < upgrade_band(case_income_only)[1]

    # And they are worth real money: a tenth of income at every tier, not a
    # rounding error and not a second salary.
    for row in claiming:
        earned = row["cash_per_case"] * Player().cases_per_day
        assert .07 <= row["daily_claims"] / earned <= .15, row["tier"]


def test_the_whole_campaign_is_priced_in_hours_of_study():
    """Total cases a greedy playthrough must win to buy the game out.

    Roughly 2,400 solid cases, which simulation puts at about 2,061 played cases
    and 120 hours for a 72%-accuracy player who claims their daily goals, or
    2,282 and 133 hours for one who never does.

    In hours: a case is one question, budgeted by `_target_time_seconds` at 150s
    for Logical Reasoning and 330s for a fresh Reading Comprehension passage,
    which blends to 3.49 minutes over the mix the selector serves. Note the
    unit: a sitting averages eight cases, so a per-sitting figure is eight times
    a per-case one and the two are easy to swap by accident. That swap is
    exactly what put the previous revision of this test at 395 cases and 23
    hours — the brief it was written from said "3 to 6 cases" and meant "an hour
    or two", and only one of those can be true at 3.49 minutes a case.

    The case count is *derived*, not chosen. Holding every rung inside one to
    two hours fixes the campaign at 93 mandatory purchases times that band, and
    nothing else is free to move. So the campaign cannot be shorter than 93
    hours or longer than 186 whatever else is tuned, and an older brief asking
    for 55-88 hours is unreachable from either end. 120 hours is four months at
    an hour a day, two at two hours, six weeks at three.

    Those hours are a floor. They count time on cases only, and exclude reading
    coaching, story beats, and map interaction. Buying the catalog out is also
    not the same as exhausting the app: the question bank and the review
    schedule outlast the firm ladder.
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
    # Bounded by the band itself rather than by a remembered figure, so this
    # tracks a change of pace instead of failing on one.
    assert MANDATORY_PURCHASES * TARGET_BAND[0] <= total_cases <= MANDATORY_PURCHASES * TARGET_BAND[1]

    # And the same total measured against a real player, in the unit the brief
    # is written in.
    played_cases, hours = total_campaign(Player())
    low, high = TARGET_HOURS_PER_UPGRADE
    assert MANDATORY_PURCHASES * low <= hours <= MANDATORY_PURCHASES * high, f"{hours:.0f}h"
    assert played_cases == pytest.approx(hours * 60 / MINUTES_PER_CASE)


def _cheapest_mandatory_purchase(tier: int) -> int:
    """The smallest thing at ``tier`` the player is actually required to buy."""
    costs = [
        asset["cost"]
        for asset in ASSETS
        if asset["tier"] == tier
        and asset["type"] in TIER_GATED_ASSET_TYPES
        and asset["type"] not in UNBALANCED_ASSET_TYPES
    ]
    if tier + 1 < len(FIRM_TIERS):
        costs.append(FIRM_TIERS[tier + 1]["cost"])
    return min(costs)


def test_a_full_day_of_daily_claims_never_approaches_an_upgrade():
    """The invariant that failed: a day of dailies is not a free office.

    The floors were flat currency — 500/1500/4000 — authored when a case fee
    was 5.6x what it is now. At tier 0 they paid 6,000 a day against a 3,800
    first upgrade and a 6,000 first headquarters: 158% of a purchase, one free
    office per day, and the early game ran at half the length the pace band set.
    Five tiers later the same 6,000 was 1.2% of a purchase and the floor had
    quietly stopped existing at all.

    Both failures are the same failure — an absolute price in a game where every
    other price is quoted in cases — so the fix is to quote this one in cases
    too, and the assertion is a *ratio at every tier* rather than a remembered
    dollar figure.
    """
    for tier in range(len(FIRM_TIERS)):
        rewards = {
            milestone: daily_reward_for_tier(tier, milestone)
            for milestone in DAILY_REWARD_MULTIPLIERS
        }
        day = sum(rewards.values())
        purchase = _cheapest_mandatory_purchase(tier)
        share = day / purchase
        assert share <= .15, (
            f"tier {tier}: a full day of claims pays {day:,} against a "
            f"{purchase:,} purchase ({share:.0%})"
        )
        # ...and is still worth the twenty cases it asks for.
        assert share >= .05, f"tier {tier}: {share:.1%} of a purchase is not worth claiming"

    # The share barely moves across fifteen tiers: 8.1%-12.5%, a 1.55x spread
    # that is almost all two-significant-figure rounding on the purchase side.
    # The old rule spread 25.7x (158% at tier 0 to 6.2% at tier 14), and neither
    # half of it was scale-free: the floors were absolute, and the client-fee
    # term drifted 8x on its own because a fee is the case target divided by
    # `_expected_firm_multiplier`, which compounds as upgrades are bought.
    # No single tier's numbers show that drift, which is why it is asserted
    # across the ladder rather than tier by tier.
    shares = [
        sum(daily_reward_for_tier(tier, milestone) for milestone in DAILY_REWARD_MULTIPLIERS)
        / _cheapest_mandatory_purchase(tier)
        for tier in range(len(FIRM_TIERS))
    ]
    assert max(shares) / min(shares) <= 1.7, [round(share, 3) for share in shares]


def test_daily_rewards_escalate_in_the_authored_ratio_and_track_the_tier():
    """Three goals, worth 1:3:8, priced off the tier and nothing else.

    The reward used to be `max(flat_floor, active_client_fee * multiplier)`, so
    a tier-5 player still taking walk-ins collected 1,800 for a full day while
    the player beside them collected 99,600, and choosing a pro bono docket cut
    the daily reward to 30% — a penalty on service work that nobody designed and
    that `test_pro_bono_matters_pay_below_the_market_rate_for_their_tier` had no
    reason to catch. The daily goal rewards attendance, so it may not depend on
    which client is on the desk.
    """
    total_multiplier = sum(DAILY_REWARD_MULTIPLIERS.values())
    for tier in range(len(FIRM_TIERS)):
        rewards = [daily_reward_for_tier(tier, milestone) for milestone in sorted(DAILY_REWARD_MULTIPLIERS)]
        assert rewards == sorted(rewards), tier
        assert len(set(rewards)) == len(rewards), tier
        day = sum(rewards)
        # A day of claims is DAILY_REWARD_CASE_BUDGET nominal cases, split in
        # the authored ratio. Loose enough only for two-significant-figure
        # rounding (`_round_game_amount`).
        assert day / _case_target_for_tier(tier) == pytest.approx(DAILY_REWARD_CASE_BUDGET, rel=.05), tier
        for milestone, reward in zip(sorted(DAILY_REWARD_MULTIPLIERS), rewards):
            expected = DAILY_REWARD_CASE_BUDGET * DAILY_REWARD_MULTIPLIERS[milestone] / total_multiplier
            assert reward / _case_target_for_tier(tier) == pytest.approx(expected, rel=.05), (tier, milestone)

    # The office decides the reward; the client on the desk does not.
    for tier in (0, 4, 9):
        walk_in = _wardrobe_profile(office_tier=tier, active_client_key="walk_in")
        richest = max(
            (client for client in CLIENTS if client["tier"] <= tier),
            key=lambda client: client["base_fee"],
        )
        signed = _wardrobe_profile(office_tier=tier, active_client_key=richest["key"])
        for milestone in DAILY_REWARD_MULTIPLIERS:
            assert _daily_reward_amount(walk_in, milestone) == _daily_reward_amount(signed, milestone)
            assert _daily_reward_amount(walk_in, milestone) == daily_reward_for_tier(tier, milestone)

    # Climbing an office is a visible raise on the daily board, every time.
    for tier in range(1, len(FIRM_TIERS)):
        assert daily_reward_for_tier(tier, 20) > daily_reward_for_tier(tier - 1, 20)


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
        # at the same tier, which costs three to five good cases. Measured the
        # same way that test measures it — against the tier's effort scale as
        # well as its case target — so the comparison survives a repacing. The
        # previous version divided by the case target alone, which stopped
        # meaning "a fraction of an upgrade" the moment the effort scale left
        # 1.0 and would have passed a cosmetic priced at 4% of its neighbour.
        case_cost = asset["cost"] / (_case_target_for_tier(asset["tier"]) * _tier_effort_scale(asset["tier"]))
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
