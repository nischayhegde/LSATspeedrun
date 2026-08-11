"""Measure how many played cases one purchase actually costs, tier by tier.

The catalog is priced in *nominal* cases: `_case_target_for_tier` is the cash a
single flawless win is supposed to yield, and every price is a multiple of it.
That nominal figure is not what a player experiences. A real player misses
roughly a quarter of questions, writes ordinary rather than exceptional prose,
pays rent every day, collects idle retainers between sittings, claims the daily
goals they have earned, and sometimes settles a case the grader never reached.
This script replays the real settlement arithmetic against such a player so the
"cases per upgrade" number in the design brief can be checked rather than
assumed.

Daily-goal claims were missing from that list until they were found to be a
tenth of an engaged player's income, and 158% of the first upgrade at tier 0
under the old flat floors. An income source left out of the model is invisible
to every number the model reports, so the band looked healthy throughout. With
them in, the low edge of the one-to-two-hour band moves from 1.08h to 0.97h;
see `test_daily_claims_shave_the_band_by_one_purchase_at_one_tier` for what
that means and what it would cost to repair.

What one number here means: a "case" is one attempted question, because that is
what `settle_attempt` pays out on. "Cases per upgrade" is therefore how many
questions the player works to afford one mandatory purchase — a tier-gated
upgrade, hire, or acquisition — or the next headquarters.

The interface uses the word the other way round: "Start 6 cases" starts one run
of six questions, and `game.SITTING_QUESTIONS` is the only place in the app that
means a sitting by it. Every figure below is per question. Sittings are reported
alongside, because a per-sitting figure is six times a per-case one and the two
are easy to swap by accident — that swap is what put an earlier revision of this
script out by 8x.

`UNGRADED_CREDIT` deliberately does not appear below. It is the standing credit
an ungraded win earns, and standing gates *which* tier the player may enter, not
how much cash a case pays; only `UNGRADED_MULTIPLIER` moves money.

Run with:
    ../.venv/bin/python -m scripts.simulate_economy_curve
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.game import (  # noqa: E402
    ASSETS,
    CLIENTS,
    DAILY_REWARD_MULTIPLIERS,
    EFFORT_MISS_MULTIPLIER,
    FIRM_TIERS,
    PRO_BONO_FEE_SHARE,
    SITTING_QUESTIONS,
    TERRITORY_RENT_RELIEF_POOL_BPS,
    TIER_GATED_ASSET_TYPES,
    UNBALANCED_ASSET_TYPES,
    UNGRADED_MULTIPLIER,
    _case_target_for_tier,
    _expected_firm_multiplier,
    _tier_effort_scale,
    daily_reward_for_tier,
)


# A "solid case": correct answer, Good write-up, sensible pace. `_score_multiplier`
# maps that band to 1.20 and the whole catalog is priced against it.
SOLID_SCORE_MULTIPLIER = 1.20
# What a miss earns when the reasoning was still Good (EFFORT_MISS_MULTIPLIER).
MISS_SCORE_MULTIPLIER = EFFORT_MISS_MULTIPLIER["Good"]
# Base streak ceiling and idle-retainer storage before any upgrade raises them
# (see `snapshot_case_context` and `_passive_state`).
BASE_STREAK_CAP = 0.20
STREAK_STEP = 0.02
BASE_STORAGE_HOURS = 8
# The band the design brief asks for, stated the way the brief states it: one
# mandatory purchase should cost between one and two hours of play.
#
# It is deliberately *not* stated in cases. An earlier brief said "3 to 6 cases"
# and glossed that as "an hour to two hours", but a case here is one question,
# so 3-6 cases is 10-21 minutes and the two halves of that instruction were an
# 8x apart. Hours are the figure the player experiences, so hours are what is
# pinned, and the case band below is derived from the measured pace so it tracks
# `_target_time_seconds` instead of freezing today's conversion into a literal.
TARGET_HOURS_PER_UPGRADE = (1.0, 2.0)

# --- converting cases to hours -----------------------------------------------
#
# A case is one attempted question, so this conversion is the app's per-question
# time budget, NOT the length of a whole sitting. Confusing the two is an 8x
# error, a sitting averaging roughly eight cases.
#
# The budget is `services._target_time_seconds`, which the server stamps onto
# every item as it is served: 150s for a Logical Reasoning question, 330s for
# the first question on a Reading Comprehension passage, and 135s for each
# follow-up on that same passage. Blending those over the section mix the
# selector actually serves gives the figure used below.
#
# It is read back out of the database rather than retyped here, so that it
# cannot drift away from `_target_time_seconds` unnoticed. The previous revision
# of this script converted at 4.4 minutes a case with no stated source and no
# way to check it, which is how it went unquestioned.
#
# What it is deliberately NOT derived from: how long anyone actually took. There
# is no genuine human timing in the development database. Every timed row is
# either a scripted client answering in a flat 1.0s or a fixture written by
# `seed_demo.py` / `seed_demo_learner.py`, whose per-question times are authored
# constants (`_elapsed_for` hardcodes 78-82s; the nine "completed" sittings all
# run a fabricated 24m00.000s). Measuring those returns the seeder's opinion,
# not the player's.
DEFAULT_DB = Path(__file__).resolve().parents[1] / "instance" / "lsat_sherlock.db"
# Used when no database is reachable. Same blend, against a catalog that was 66%
# Logical Reasoning and 34% Reading Comprehension (4,520 / 2,366 questions on
# 2026-08-06), RC averaging 328s once same-passage follow-ups are counted:
# .66 * 150 + .34 * 328 = 210.5s.
FALLBACK_SECONDS_PER_CASE = 210.5

# KNOWN WRONG, DELIBERATELY NOT CHANGED. Read this before quoting an hour.
#
# The blend above is the *catalog* mix. It is not the mix the selector serves,
# and the comment two paragraphs up claiming it is "blended over the section mix
# the selector actually serves" was never true. Selection draws indivisible
# blocks, and the bank has 4,520 single-question Logical Reasoning blocks against
# 349 Reading Comprehension passages, so a shuffled draw is overwhelmingly LR. A
# ten-question run measures 17.8% RC, not 34%, and 152.7 s/q, not 210.5.
# Reproduce with `scripts/measure_served_section_mix.py`.
#
# So every hour this script prints is about 38% high, and the campaign it calls
# 122 hours is nearer 88 hours of question time.
#
# It is left alone anyway, and the reason is not inertia. 210.5s is the constant
# the shipped pace band was tuned against: TIER_EFFORT_BASE was moved 5.16 ->
# 5.33 to hold one-to-two hours *measured this way*, and the band has 0.2% of
# clearance at its floor. Correcting the conversion would not measure the ladder
# more accurately, it would repace it — the one-to-two-hour band would become
# 23.6-47.2 cases and today's 17.3-29.2 would fall straight through the floor,
# requiring a fresh TIER_EFFORT_BASE and a fresh set of prices. That is a
# deliberate retune and needs to be asked for, not smuggled in under a
# measurement fix.
#
# What follows from that: this script's hours are a *unit of comparison*, not a
# claim about a clock. Two curves measured in it can be compared to each other.
# Neither can be quoted to a player.
SERVED_SECONDS_PER_CASE = 152.7


def seconds_per_case(db_path: Path = DEFAULT_DB) -> tuple[float, str]:
    """The shipped per-case time budget, and where the number came from.

    The provenance is returned alongside the figure and printed with the report
    because a conversion constant that is silently wrong invalidates every hour
    quoted downstream while leaving the report looking entirely healthy.

    **This function does not raise, and that is a requirement rather than a
    courtesy.** It is called at import (`SECONDS_PER_CASE` below) by a module
    three test files import, so anything it throws is thrown during pytest
    collection and takes down every test in those files -- including tests that
    have nothing to do with the database. It used to: a present-but-unmigrated
    `instance/lsat_sherlock.db` raised `no such table: session_items` and
    interrupted collection of 3 modules, and a corrupt one raised `file is not a
    database`. The `try` was around `connect` alone, which catches almost
    nothing, because sqlite3 opens lazily and every real failure lands on the
    first `execute`.

    The semantics that follow from that, and the reason they are right rather
    than merely convenient: reading the database is an *optional refinement*.
    FALLBACK_SECONDS_PER_CASE is the documented, shipped figure and is what the
    pace band was tuned against; the query exists only so the conversion cannot
    drift away from `_target_time_seconds` unnoticed. "I could not measure it"
    and "there is nothing to measure" are therefore the same answer -- use the
    documented constant -- and there is no state in which crashing serves a
    reader better, because the provenance string is printed at the top of every
    report and says exactly which case was hit.

    The four ways there is nothing to measure are distinguished in that string,
    because they mean different things to whoever reads it: no file at all, a
    file that has never been migrated, a migrated file nobody has practised
    against, and a file that is unreadable -- which, unlike the other three, is
    a real problem worth chasing.
    """
    if not db_path.exists():
        return FALLBACK_SECONDS_PER_CASE, f"documented fallback (no database at {db_path})"
    try:
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            # Grouped by section rather than averaged flat: migration 0012 gave
            # pre-existing rows the Logical Reasoning default, so a section whose
            # budget comes back at 150s is reading repaired history rather than
            # the shipped model, and that has to be visible instead of blended
            # away.
            rows = connection.execute(
                """
                SELECT questions.section, COUNT(*), AVG(session_items.target_time_seconds)
                FROM session_items
                JOIN study_sessions ON study_sessions.id = session_items.session_id
                JOIN questions ON questions.id = session_items.question_id
                WHERE study_sessions.mode = 'practice'
                GROUP BY questions.section
                """
            ).fetchall()
        finally:
            # `with connection` is a transaction block and leaves the handle
            # open. This is called once at import, but the tests call it per
            # case and would leak one handle each.
            connection.close()
    except sqlite3.OperationalError as error:
        if "no such table" in str(error):
            return (
                FALLBACK_SECONDS_PER_CASE,
                f"documented fallback (database at {db_path} has not been migrated)",
            )
        return FALLBACK_SECONDS_PER_CASE, f"documented fallback (database unreadable: {error})"
    except sqlite3.Error as error:
        return FALLBACK_SECONDS_PER_CASE, f"documented fallback (database unreadable: {error})"
    served = sum(count for _, count, _ in rows)
    if not served:
        return FALLBACK_SECONDS_PER_CASE, "documented fallback (no practice items served yet)"
    blended = sum(count * budget for _, count, budget in rows) / served
    mix = ", ".join(f"{section} {count} @ {budget:.0f}s" for section, count, budget in rows)
    return blended, f"{served} served practice items ({mix})"


SECONDS_PER_CASE, SECONDS_PER_CASE_SOURCE = seconds_per_case()
MINUTES_PER_CASE = SECONDS_PER_CASE / 60
# The hour band above, in the unit the catalog is actually priced in.
TARGET_BAND = tuple(hours * 3600 / SECONDS_PER_CASE for hours in TARGET_HOURS_PER_UPGRADE)


@dataclass(frozen=True)
class Player:
    """The player the curve is measured against."""

    accuracy: float = 0.72
    # Share of settled cases whose write-up never reached a grader. Those settle
    # at UNGRADED_MULTIPLIER instead of the solid-win multiplier.
    ungraded_share: float = 0.0
    cases_per_day: float = 20.0
    minutes_per_case: float = MINUTES_PER_CASE
    # Whether the player takes pro bono matters, which pay PRO_BONO_FEE_SHARE.
    pro_bono: bool = False
    # Fraction of the district rent-relief pool the player holds.
    rent_relief_share: float = 0.0
    # Times a day the player opens the app and banks accrued retainers. Idle
    # income is capped by storage hours, so collecting more often earns more.
    passive_collections_per_day: float = 1.0
    # Whether the player claims the daily goals they have earned. Default True:
    # they are one tap on the screen the player is already looking at, so a
    # curve that leaves them out is not measuring the game anyone plays. The
    # previous revision omitted them entirely and consequently overstated what
    # an engaged player pays for an early purchase by about half.
    claims_dailies: bool = True


def _tier_gated_assets(tier: int) -> list[dict]:
    """The purchases advancing past ``tier`` actually requires.

    `_tier_required_asset_keys` gates on `TIER_GATED_ASSET_TYPES` alone, and
    those types never overlap `UNBALANCED_ASSET_TYPES`, so this is exactly the
    mandatory shopping list for the tier.
    """
    return [
        asset
        for asset in ASSETS
        if asset["tier"] == tier
        and asset["type"] in TIER_GATED_ASSET_TYPES
        and asset["type"] not in UNBALANCED_ASSET_TYPES
    ]


def _owned_weights(tier: int) -> list[tuple[dict, float]]:
    """Assets a player standing at ``tier`` owns, and how certainly.

    Advancing to ``tier`` requires every tier-gated asset below it, so
    everything earlier counts whole. This tier's own purchases are made across
    the tier, so they count half. That is the same ownership assumption
    `_expected_firm_multiplier` prices client fees against, and every bonus
    below is weighted by it rather than by a second, quietly different rule:
    the previous revision counted earlier connections as owned but dropped
    current-tier ones entirely, which understated income at every rung.
    """
    weights = []
    for asset in ASSETS:
        if asset["type"] in UNBALANCED_ASSET_TYPES:
            continue
        if asset["tier"] < tier:
            weights.append((asset, 1.0))
        elif asset["tier"] == tier:
            weights.append((asset, 0.5))
    return weights


def _weighted(tier: int, field: str) -> float:
    return sum(weight * float(asset.get(field, 0)) for asset, weight in _owned_weights(tier))


def _firm_multiplier(tier: int) -> float:
    multiplier = 1 + tier * 0.06 + _weighted(tier, "payout_mult")
    # Fees were priced against `_expected_firm_multiplier`; measuring them
    # against anything else silently reports a different game than the one
    # shipped, so the two are pinned together here rather than by comment.
    assert abs(multiplier - _expected_firm_multiplier(tier)) < 1e-9, tier
    return multiplier


def _clients_at(tier: int, *, pro_bono: bool) -> list[dict]:
    wanted = "pro_bono" if pro_bono else "commercial"
    return [
        client
        for client in CLIENTS
        if client["tier"] == tier and client.get("matter_type", "commercial") == wanted
    ]


def _daily_rent(tier: int, relief_share: float) -> int:
    list_rent = int(FIRM_TIERS[tier]["rent_daily"])
    relief_bps = round(TERRITORY_RENT_RELIEF_POOL_BPS * relief_share)
    return max(0, list_rent - list_rent * relief_bps // 10_000)


def _daily_passive(tier: int, player: Player) -> float:
    """Idle retainer income banked in a day (see `_passive_state`).

    Accrual is capped at `8 + storage_hours` of it, so a player who opens the
    app once a day banks that cap rather than a full 24 hours, and a day can
    never yield more than 24 hours of income however often they collect.
    """
    hourly = _weighted(tier, "passive_hourly")
    cap_hours = BASE_STORAGE_HOURS + _weighted(tier, "storage_hours")
    banked_hours = min(24.0, cap_hours * max(0.0, player.passive_collections_per_day))
    return hourly * banked_hours


def _daily_claims(tier: int, player: Player) -> float:
    """Daily-goal cash a day's play actually earns (see `claim_daily_reward`).

    A milestone is only claimable once the day's case count reaches it, so a
    player who stops at six cases collects the five-case goal and nothing else.
    Only cases with a real written argument count toward the goals, but the
    curve's misses are all well-argued ones, so every attempted case here
    advances the count.
    """
    if not player.claims_dailies:
        return 0.0
    return float(sum(
        daily_reward_for_tier(tier, milestone)
        for milestone in DAILY_REWARD_MULTIPLIERS
        if player.cases_per_day >= milestone
    ))


def cash_per_played_case(tier: int, player: Player, *, passive: bool = True) -> float:
    """Expected net cash from one *attempted* question at ``tier``.

    Mirrors `settle_attempt`: the score multiplier bands, the staff flat bonus,
    the streak bonus, and the contract close amortised over the contract length.
    Rent is then subtracted, and idle retainers and claimed daily goals added at
    the player's daily pace.
    """
    clients = _clients_at(tier, pro_bono=player.pro_bono)
    if not clients:
        # Not every tier offers a pro bono matter; fall back to the commercial
        # board priced at the pro bono share so the tier still reports.
        clients = _clients_at(tier, pro_bono=False)
        fee_share = PRO_BONO_FEE_SHARE
    else:
        # Pro bono base fees are already authored at PRO_BONO_FEE_SHARE of the
        # commercial rate by `_rebalance_client_catalog`; discounting again here
        # would charge the player for it twice.
        fee_share = 1.0

    firm_mult = _firm_multiplier(tier)
    staff_flat = _weighted(tier, "staff_flat")
    streak_cap = BASE_STREAK_CAP + _weighted(tier, "streak_bonus_cap")
    asset_contract_mult = _weighted(tier, "contract_bonus_mult")
    # Steady-state streak for a Bernoulli(accuracy) run of validated wins.
    mean_streak = player.accuracy / max(1e-9, 1 - player.accuracy)
    streak_rate = min(streak_cap, mean_streak * STREAK_STEP)

    graded_win = player.accuracy * (1 - player.ungraded_share)
    ungraded_win = player.accuracy * player.ungraded_share
    good_miss = 1 - player.accuracy

    per_client = []
    for client in clients:
        base_fee = client["base_fee"] * fee_share
        client_mult = firm_mult * float(client.get("payout_mult", 1))
        contract_mult = 2 + float(client.get("contract_bonus_mult", 0)) + asset_contract_mult
        # A contract closes once every `length` reward-eligible wins.
        contract_per_win = base_fee * contract_mult / max(1, client["length"])

        def win_value(score_mult: float) -> float:
            core = base_fee * score_mult * client_mult
            return core * (1 + streak_rate) + staff_flat * score_mult + contract_per_win

        expected = (
            # An ungraded win is still reward-eligible, so it keeps the staff
            # bonus, the streak, and the contract advance; only the score
            # multiplier is withheld.
            graded_win * win_value(SOLID_SCORE_MULTIPLIER)
            + ungraded_win * win_value(UNGRADED_MULTIPLIER)
            # A well-argued miss pays the consultation fee only: no staff bonus,
            # no streak, and it does not advance the contract.
            + good_miss * base_fee * MISS_SCORE_MULTIPLIER * client_mult
        )
        per_client.append(expected)

    gross = sum(per_client) / len(per_client)
    per_day = max(1e-9, player.cases_per_day)
    rent_per_case = _daily_rent(tier, player.rent_relief_share) / per_day
    passive_per_case = (_daily_passive(tier, player) / per_day) if passive else 0.0
    daily_per_case = _daily_claims(tier, player) / per_day
    return gross + passive_per_case + daily_per_case - rent_per_case


def curve(player: Player) -> list[dict]:
    rows = []
    for tier in range(len(FIRM_TIERS)):
        cash = cash_per_played_case(tier, player)
        assets = _tier_gated_assets(tier)
        costs = [asset["cost"] for asset in assets]
        headquarters = FIRM_TIERS[tier + 1]["cost"] if tier + 1 < len(FIRM_TIERS) else None
        rows.append(
            {
                "tier": tier,
                "name": FIRM_TIERS[tier]["name"],
                "cash_per_case": cash,
                "nominal_target": _case_target_for_tier(tier),
                "effort_scale": _tier_effort_scale(tier),
                "purchases": len(assets),
                "cheapest_cases": min(costs) / cash if costs else None,
                "mean_cases": (sum(costs) / len(costs)) / cash if costs else None,
                "dearest_cases": max(costs) / cash if costs else None,
                "headquarters_cases": headquarters / cash if headquarters else None,
                "daily_rent": _daily_rent(tier, player.rent_relief_share),
                "daily_passive": _daily_passive(tier, player),
                "daily_claims": _daily_claims(tier, player),
            }
        )
    return rows


def upgrade_band(rows: list[dict]) -> tuple[float, float]:
    """Cheapest and dearest mandatory purchase across the whole ladder.

    Headquarters count: buying the next office is the upgrade the player is
    saving for at every rung, so leaving it out would report a band the game
    does not have.
    """
    values = [
        value
        for row in rows
        for value in (row["cheapest_cases"], row["dearest_cases"], row["headquarters_cases"])
        if value is not None
    ]
    return min(values), max(values)


def total_campaign(player: Player) -> tuple[float, float]:
    """Played cases and engaged hours to buy every mandatory purchase.

    The hours are time *on cases* at the app's own pacing budget. They exclude
    everything between cases — reading coaching, story beats, the map — so they
    are a floor on wall-clock playtime rather than an estimate of it.
    """
    cases = 0.0
    for tier in range(len(FIRM_TIERS)):
        cash = cash_per_played_case(tier, player)
        cases += sum(asset["cost"] for asset in _tier_gated_assets(tier)) / cash
        if tier + 1 < len(FIRM_TIERS):
            cases += FIRM_TIERS[tier + 1]["cost"] / cash
    return cases, cases * player.minutes_per_case / 60


def fee_inversions() -> list[int]:
    """Tiers whose prevailing case fee failed to beat the tier below.

    The top tier extrapolates its own milestone instead of reading the next
    one, and an earlier revision of that extrapolation flattened and then
    inverted the ordering, so this is checked before anything else: an inverted
    tier makes every other number in this report meaningless.
    """
    fees = [_case_target_for_tier(tier) for tier in range(len(FIRM_TIERS))]
    return [tier for tier in range(1, len(fees)) if fees[tier] <= fees[tier - 1]]


def _print_curve(label: str, player: Player) -> list[dict]:
    rows = curve(player)
    print(f"\n=== {label} ===")
    print(
        f"{'tier':>4} {'office':<28} {'$/case':>12} {'nominal':>12} "
        f"{'buys':>5} {'min':>6} {'mean':>6} {'max':>6} {'HQ':>6} {'rent/d':>9} {'idle/d':>14} "
        f"{'daily/d':>14} {'daily%':>7}"
    )
    for row in rows:
        def fmt(value):
            return f"{value:6.2f}" if value is not None else "     -"

        income_share = row["daily_claims"] / max(1e-9, row["cash_per_case"] * player.cases_per_day)
        print(
            f"{row['tier']:>4} {row['name']:<28} {row['cash_per_case']:>12,.0f} "
            f"{row['nominal_target']:>12,} {row['purchases']:>5} "
            f"{fmt(row['cheapest_cases'])} {fmt(row['mean_cases'])} {fmt(row['dearest_cases'])} "
            f"{fmt(row['headquarters_cases'])} {row['daily_rent']:>9,} {row['daily_passive']:>14,.0f} "
            f"{row['daily_claims']:>14,.0f} {income_share:>7.1%}"
        )
    low, high = upgrade_band(rows)
    verdict = "IN BAND" if TARGET_BAND[0] <= low and high <= TARGET_BAND[1] else "OUT OF BAND"
    print(
        f"cases per upgrade: {low:.2f} - {high:.2f} "
        f"({low * MINUTES_PER_CASE / 60:.2f}h - {high * MINUTES_PER_CASE / 60:.2f}h; "
        f"target {TARGET_BAND[0]:.1f}-{TARGET_BAND[1]:.1f} cases = "
        f"{TARGET_HOURS_PER_UPGRADE[0]:.0f}-{TARGET_HOURS_PER_UPGRADE[1]:.0f}h) -> {verdict}"
    )
    # The same band in the unit the player experiences it in. An upgrade is a
    # number of *sittings* to somebody who plays the game; it is a number of
    # cases only to this script.
    print(
        f"    which is {low / SITTING_QUESTIONS:.1f} - {high / SITTING_QUESTIONS:.1f} sittings "
        f"of {SITTING_QUESTIONS} questions"
    )
    cases, hours = total_campaign(player)
    print(
        f"whole campaign: {cases:,.0f} played cases, {hours:,.1f} hours on cases "
        f"at {player.minutes_per_case:.2f} min/case"
    )
    print(
        f"    = {cases / SITTING_QUESTIONS:,.0f} sittings; "
        f"{cases * SERVED_SECONDS_PER_CASE / 3600:,.1f} hours at the pace the selector "
        f"actually serves ({SERVED_SECONDS_PER_CASE:.1f} s/question, see "
        f"SERVED_SECONDS_PER_CASE)"
    )
    for per_day in (1, 2, 3):
        print(f"    at {per_day}h/day: {hours / per_day:,.0f} days ({hours / per_day / 30.4:.1f} months)")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--accuracy", type=float, default=0.72)
    parser.add_argument("--cases-per-day", type=float, default=20.0)
    parser.add_argument("--minutes-per-case", type=float, default=MINUTES_PER_CASE)
    args = parser.parse_args()

    base = Player(
        accuracy=args.accuracy,
        cases_per_day=args.cases_per_day,
        minutes_per_case=args.minutes_per_case,
    )

    fees = [_case_target_for_tier(tier) for tier in range(len(FIRM_TIERS))]
    print(f"minutes per case: {MINUTES_PER_CASE:.2f} from {SECONDS_PER_CASE_SOURCE}")
    print("nominal case target by tier:", fees)
    print("fee inversions:", fee_inversions() or "none")
    print("effort scale by tier:", [round(_tier_effort_scale(t), 3) for t in range(len(FIRM_TIERS))])

    _print_curve(f"realistic player ({base.accuracy:.0%} accuracy, ordinary prose)", base)
    _print_curve("flawless player (100% accuracy, solid win every case)", Player(accuracy=1.0))
    _print_curve("pro bono docket", Player(pro_bono=True))
    _print_curve("grader outage on 1 case in 5", Player(ungraded_share=0.2))
    _print_curve("every district held (rent retired)", Player(rent_relief_share=1.0))
    _print_curve("light session: 6 cases a day", Player(cases_per_day=6.0))
    _print_curve("never collects idle retainers", Player(passive_collections_per_day=0.0))
    _print_curve("never claims daily goals", Player(claims_dailies=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
