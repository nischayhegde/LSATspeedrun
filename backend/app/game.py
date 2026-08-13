from __future__ import annotations

import math
import re
from datetime import timedelta, timezone

from sqlalchemy import or_

from .extensions import db
from .models import (
    Attempt,
    AttemptSettlement,
    DailyProgress,
    LedgerEntry,
    PlayerAsset,
    PlayerClientContract,
    PlayerProfile,
    PlayerTerritory,
    SessionItem,
    utcnow,
)
from .story import (
    CHAPTER_BY_KEY,
    advance_quest,
    ensure_story_state,
    execute_rival_operation,
    operation_catalog,
    resolve_story_choice,
    rival_discount_bps,
    serialize_story,
    start_quest,
)


# Stamped onto every settlement and frozen into every case context. v6 repaces
# the ladder to one-to-two *hours* an upgrade: prices did not move but every
# client fee fell about 5.6x, so settlements either side of it are not
# comparable and must not share a label. (v5 was the same knob turned the other
# way, to three-to-six cases an upgrade, on a brief that turned out to be using
# "case" to mean "sitting" -- see TIER_EFFORT_BASE.)
#
# v7 does not move the settlement formula at all: a case pays exactly what it
# paid under v6. What moved is the daily goal reward, which fell 13x at tier 0
# and rose by four orders of magnitude at the top (DAILY_REWARD_CASE_BUDGET).
# Cash and lifetime earnings therefore accumulate at a materially different
# rate either side of this label even though per-settlement figures are
# comparable, so anything aggregating income over time has to split on it.
#
# v8 repaces the ladder a second time, by 3.3%: TIER_EFFORT_BASE 5.16 -> 5.33,
# so every client fee is that much smaller and every settlement pays that much
# less. Small, but it is a change to the settlement formula and not a
# recalibration of a side reward, so it may not share v7's label. The reason it
# is here is v7: putting daily claims into the income model showed the band had
# been measured against a player who ignores a tenth of their income, and the
# base is what puts a daily-claiming player back inside one-to-two hours.
#
# v9 does not move the settlement formula either. A case pays exactly what it
# paid under v8, because every price in this module is quoted per *question*
# and v9 only changes how many questions a sitting contains (SITTING_QUESTIONS,
# 10 -> 6). What it does move is everything that was counted in whole sittings:
# client contract lengths fell by the same ratio and the daily goal milestones
# were rebased onto the new sitting. Neither changes what a day or a contract is
# worth -- both are re-derived so the money lands where it did -- but the
# *counts* stamped on a contract and on a daily goal are not comparable across
# this label, so anything reading `cases_remaining` or a claimed milestone out
# of history has to split on it.
RULE_VERSION = "lsat-tycoon-v9"
STARTING_CASH = 250

# How many questions the player sits down to answer in one go.
#
# This is the only place in the app where "case" means a *sitting* rather than
# one question, and the distinction is load-bearing enough that it has burned a
# previous session (see TIER_EFFORT_BASE). Everywhere else in this module -- and
# in `scripts/simulate_economy_curve.py`, and in `profile.total_cases` -- a
# "case" is one attempted question, because that is the unit `settle_attempt`
# pays out on. The interface uses the other sense: "Start 6 cases" starts one
# run of six questions. Getting the two the wrong way round is a factor-of-six
# error in every price in the game.
#
# 10 -> 6 because a ten-question run with a strategy prompt and a written
# argument on each question runs past half an hour, which is long enough that
# players do not start one. Six is a nearer reward for the same work: the
# campaign still asks for the same ~2,090 questions and the same wall-clock
# time, in 338 sittings instead of 209.
#
# Six rather than five is a measurement, not a preference. A Reading
# Comprehension passage in this bank runs 4 to 16 questions (median 7) and must
# be served whole, so the run target and the passage allowance together decide
# how much of the RC bank can ever be reached and therefore what the average
# question costs in wall-clock time. See `services.PASSAGE_OVERSHOOT_ALLOWANCE`
# for the measured comparison; six with a two-question allowance holds the
# served section mix, and so the campaign's length, to within 0.1%.
SITTING_QUESTIONS = 6
# The sitting length everything counted in whole sittings was authored against.
# Contract lengths and daily goals were both written when a sitting was ten
# questions, so they are re-expressed against SITTING_QUESTIONS rather than
# retyped: a contract that closed in about one sitting still closes in about one
# sitting, and a daily goal that landed on a sitting boundary still lands on one.
# Keeping the reference explicit is what lets the sitting move again later
# without a second round of hand-edited literals.
LEGACY_SITTING_QUESTIONS = 10


def _in_sittings(legacy_questions: float, *, minimum: int = 1) -> int:
    """Re-express a count authored in ten-question sittings against today's."""
    scaled = legacy_questions * SITTING_QUESTIONS / LEGACY_SITTING_QUESTIONS
    return max(minimum, round(scaled))


# The daily goals, in questions, and what each is worth relative to the others.
#
# One, two and three sittings, rather than the 5/10/20 they were authored as.
# The point of a daily goal is that finishing a run finishes a goal, and at
# 5/10/20 two of the three landed mid-run. At 6/12/18 all three close at the end
# of the first, second and third run of the day.
#
# Deliberately NOT `_in_sittings`, which would give 3/6/12 and hold the goals at
# half, one and two sittings. That preserves the wrong quantity. The day's ask
# is what keeps question volume up, and cutting the top goal from twenty
# questions to twelve would tell the player to stop at twelve.
#
# 18 rather than 20 is the one place this change asks for less than it did, and
# it is a choice rather than a rounding. Measured on the curve, 6/12/20 is
# indistinguishable from 6/12/18 -- 2,084.8 played cases and 121.90 hours either
# way, because the modelled player works twenty a day and claims all three goals
# under both -- so the economy does not decide it. 6/12/24 does move: 2,229.5
# cases and 130.4 hours, 7% longer, because a twenty-a-day player stops claiming
# the top goal at all. So the real choice was 18 against 20, and it went to 18
# because 20 is not a run boundary: a player chasing it either abandons a fourth
# run two questions in, which is the exact behaviour this whole change exists to
# reduce, or finishes it and does 24. 18 asks for three finished runs and
# nothing half-done. The cost is honest and small -- the nominal daily ask falls
# 20 -> 18, a tenth -- and 20 is a one-line change if that trade is not wanted.
#
# None of this changes what a day is *worth*. DAILY_REWARD_CASE_BUDGET fixes the
# whole day's cash at two nominal cases and the 1:3:8 ratio splits it, so a
# player working twenty questions a day claims exactly what they claimed before
# and the pace band does not move -- which matters, because TIER_EFFORT_BASE has
# 0.2% of clearance at its floor.
DAILY_REWARD_MULTIPLIERS = {
    SITTING_QUESTIONS: 1,
    SITTING_QUESTIONS * 2: 3,
    SITTING_QUESTIONS * 3: 8,
}
# What a full day of daily-goal claims is worth, quoted in cases like every
# other price here, and split between the three milestones in the 1:3:8 ratio
# above so the twenty-case claim is still the one worth staying for.
#
# It has to be quoted in cases. The previous rule was
# `max(flat_floor, active_client_fee * multiplier)` and both halves were wrong
# in the same direction at opposite ends of the ladder:
#
#   * The floors -- 500/1500/4000 -- were absolute currency authored when fees
#     were 5.6x larger. At tier 0 they paid 6,000 a day against a 3,800 first
#     upgrade and a 6,000 first headquarters, so a daily claim *was* the
#     upgrade. By tier 5 the same 6,000 is 1.2% of a purchase and the floor has
#     silently stopped existing.
#   * The fee term looks scale-free but is not. A client fee is
#     `_case_target_for_tier / average_value_factor`, and that divisor grows
#     with `_expected_firm_multiplier` as owned upgrades compound, so the fee
#     falls from 0.64 of a case at tier 0 to 0.13 at tier 14. Twelve times the
#     fee is therefore 47% of the cheapest tier-0 purchase and 6% of the
#     cheapest tier-14 one -- an eightfold drift in what a day is worth. It is
#     also 12x a number the player chooses: the active client may be any
#     unlocked one, so a tier-5 player still on walk-ins collected 1,800 while
#     the client beside them collected 99,600, and taking pro bono work cut the
#     daily reward to 30% for no reason anyone designed.
#
# Anchoring to `_case_target_for_tier` fixes both: the day is worth the same
# fraction of a purchase at every rung, and no client choice moves it.
#
# The size is 2.0 because a mandatory purchase costs 16-25 cases of nominal fee
# (`scripts/simulate_economy_curve.py`), so a two-case day is 8-12% of one
# purchase at every rung: ten days of claiming without playing would not buy a
# single upgrade, which is the invariant that failed under the flat floors.
# Against income it is a 10% raise on the twenty-case day it asks for.
#
# Sizing it cost TIER_EFFORT_BASE a repacing, which is worth knowing before
# moving it again. The one-to-two-hour band had only 8% of clearance at its
# lower edge, measured without dailies in the model at all, so *any* daily
# worth more than about 1.4 cases pushed the cheapest purchase under an hour.
# Rather than shrink the reward to fit a measurement that was ignoring it, the
# base was moved 5.16 -> 5.33 and the band now holds with dailies counted. The
# consequence is that this constant and TIER_EFFORT_BASE are coupled: raising
# this one lowers the measured band and there is now only 0.2% of clearance at
# the floor. See `test_a_full_day_of_daily_claims_never_approaches_an_upgrade`
# and `test_the_band_holds_for_a_player_who_claims_their_daily_goals`.
DAILY_REWARD_CASE_BUDGET = 2.0
# Every price in the catalog is quoted in *cases*: `_case_target_for_tier`
# converts one solid, well-argued win into cash, and each headquarters costs
# `TARGET_CASES_PER_MILESTONE * FIRM_TIER_COST_MULTIPLIER * _tier_effort_scale`
# of them while each upgrade, hire, or acquisition costs three to five times
# that same effort scale (`_rebalance_asset_catalog`).
#
# So this multiplier has to stay inside the three-to-five that assets already
# span, or the two quotes drift apart and no single effort scale can hold both
# inside one band. That is why it is 1 rather than the 2 it carried while
# offices were meant to be the rare, expensive rung, and why retuning the pace
# moves `_tier_effort_scale` -- which multiplies both quotes -- rather than this,
# which multiplies only one.
TARGET_CASES_PER_MILESTONE = 5
FIRM_TIER_COST_MULTIPLIER = 1
# How much longer a purchase costs at tier `t` than the same purchase would at
# the bottom of the ladder. This is a pure fee scale: raising it lowers
# `_case_target_for_tier` and every client fee with it, and moves not one price
# the player pays.
#
# The target is one to two *hours* of play per mandatory purchase, at every
# rung. That is the brief's own unit and the only one that survives a change of
# pace. A previous revision priced against "3 to 6 cases" instead, because the
# brief said both and they were assumed to agree. They do not: a case here is
# one attempted question (`profile.total_cases += 1` per settled attempt), so
# 3-6 cases is 10-21 minutes, not the hour or two the brief meant by it. The
# hour figure is the one the player experiences and the one that was kept.
#
# In cases, one to two hours is 17.2-34.4 at the shipped pace of 3.49 minutes a
# case -- `_target_time_seconds` blended over the section mix the selector
# actually serves, read back out of the database by
# `scripts/simulate_economy_curve.py` rather than retyped. That script measures
# the band against a realistic player (72% accuracy, ordinary prose grades)
# rather than against the nominal budget, because nominal flatters itself by
# assuming every case is a solid win.
#
# The base is pinned by the *daily-claiming* player, which is what 5.33 buys
# over the 5.16 that preceded it. Claiming the daily goals is one tap on a
# screen the player is already looking at and is worth a tenth of their income,
# but the curve did not model it, so the band was being measured against
# somebody who declines it. With dailies counted, 5.16 measured 16.7-28.3
# played cases -- the tier-1 deposition studio at 58 minutes, under the floor.
# At 5.33 the same player measures 17.2-29.3 (1.00-1.71 hours) with nothing
# under an hour, and a player who never claims measures 19.2-32.7 (1.12-1.90
# hours), so both are inside the band and the claiming one is the binding
# constraint. It measured 3.3-5.7 at the far older 0.925/0.012.
#
# The step is pinned to the base, and the room for it is tight. A purchase
# already costs three to five cases by design, a 1.67x spread *within* every
# tier, and a one-to-two-hour band is only 2x wide -- so the entire fifteen-tier
# drift has to fit in the 1.2x that is left over. 0.067 against a base of 5.33
# drifts 1.18x, which still makes a late purchase cost visibly more work than an
# early one. Anything near 1.36x exhausts the room on its own and *no* base
# satisfies the band. This constraint is a ratio, so it did not change when the
# band moved: the old 3-6 band was 2x wide too.
#
# What is left of the margin, and where: 0.2% at the floor for a claiming
# player and 4.8% at the ceiling for a non-claiming one. That is much tighter
# than it was, and deliberately so -- the band is now measured against both
# populations at once rather than against one of them. It means the next change
# to any income source, DAILY_REWARD_CASE_BUDGET included, has to be measured
# here before it ships rather than after.
#
# What this costs in total playtime is the honest headline. There are 93
# mandatory purchases (79 tier-gated assets plus 14 headquarters), so buying the
# catalog out is about 2,061 played cases and 120 hours on cases for a claiming
# player, 2,282 and 133 for one who never claims -- two months at two hours a
# day, four at one. Those hours are a floor: they count case time only and
# exclude coaching, story beats, and the map. An older brief asked for 55-88
# hours, which this band cannot produce from either end; 93 purchases at the
# very bottom of the band is still 93 * 17.2 * 3.49/60 = 93 hours. Buying the
# catalog out is in any case not the same as exhausting the app.
TIER_EFFORT_BASE = 5.33
TIER_EFFORT_STEP = 0.067
FINAL_CASE_KEY = "constellation_charter"
ACTIVE_RENT_WINDOW = timedelta(hours=24)
REPUTATION_GRACE_PERIOD = timedelta(hours=48)
OFFLINE_RENT_NUMERATOR = 1
OFFLINE_RENT_DENOMINATOR = 5
RENT_ARREARS_DAYS = 3
RENT_ACCRUAL_MICROS_PER_CENT = 1_000_000
SECONDS_PER_DAY = 24 * 60 * 60

FIRM_TIERS = [
    {"tier": 0, "name": "Wooden Shack", "cost": 0, "reputation": 0, "region": "Old Quarter", "feature": "Street-level practice", "short": "A one-desk practice with a lot to prove."},
    {"tier": 1, "name": "Shared Office", "cost": 6_000, "reputation": 20, "region": "Old Quarter", "feature": "Client intake suite", "short": "A real address, a repaired roof, and room for help."},
    {"tier": 2, "name": "Neighborhood Firm", "cost": 18_000, "reputation": 32, "region": "Market Ward", "feature": "Community courtroom", "short": "A storefront practice trusted by local businesses."},
    {"tier": 3, "name": "Downtown Firm", "cost": 50_000, "reputation": 42, "region": "Civic Center", "feature": "Trial strategy floor", "short": "A polished suite overlooking the city docket."},
    {"tier": 4, "name": "City Power Firm", "cost": 130_000, "reputation": 50, "region": "Financial District", "feature": "Predictive jury theater", "short": "A landmark office for high-stakes clients."},
    {"tier": 5, "name": "Regional Headquarters", "cost": 320_000, "reputation": 56, "region": "Harbor Exchange", "feature": "Branch command center", "short": "A waterfront headquarters coordinating offices across the state."},
    {"tier": 6, "name": "National Firm", "cost": 750_000, "reputation": 62, "region": "Midtown Crown", "feature": "National litigation grid", "short": "Coast-to-coast branches and a national client book."},
    {"tier": 7, "name": "International Practice", "cost": 1_700_000, "reputation": 68, "region": "Embassy Row", "feature": "Live translation cloud", "short": "Diplomatic reach and cross-border teams working around the clock."},
    {"tier": 8, "name": "Global Legal Empire", "cost": 3_600_000, "reputation": 74, "region": "Skyline Heights", "feature": "Global crisis command", "short": "A worldwide practice whose crest changes skylines."},
    {"tier": 9, "name": "Sovereign Counsel Tower", "cost": 7_500_000, "reputation": 79, "region": "Sovereign Enclave", "feature": "Treaty negotiation chamber", "short": "Governments and institutions bring their defining disputes here."},
    {"tier": 10, "name": "Continental Justice Campus", "cost": 15_000_000, "reputation": 83, "region": "Innovation Arc", "feature": "Autonomous case campus", "short": "An entire district built around research, advocacy, and legal technology."},
    {"tier": 11, "name": "Oceanic Law Citadel", "cost": 30_000_000, "reputation": 86, "region": "Azure Coast", "feature": "Floating arbitration forum", "short": "A self-sustaining coastal citadel for planet-scale matters."},
    {"tier": 12, "name": "Orbital Arbitration Ring", "cost": 60_000_000, "reputation": 89, "region": "Aerospace Basin", "feature": "Zero-gravity hearing rooms", "short": "The first legal headquarters with a permanent orbital docket."},
    {"tier": 13, "name": "Lunar Embassy of Law", "cost": 120_000_000, "reputation": 92, "region": "Lunar Gate", "feature": "Interworld treaty vault", "short": "A moon-linked embassy settling disputes beyond national borders."},
    {"tier": 14, "name": "Planetary Justice Nexus", "cost": 240_000_000, "reputation": 94, "region": "Celestial Crown", "feature": "Justice constellation", "short": "A legendary network that coordinates law across an entire civilization."},
]

# Office rent scales predictably with the headquarters investment. The starter
# practice still has a modest ground lease, while every later office costs 2%
# of its purchase price per day to operate.
#
# This is absolute currency charged per day, and the two repacings multiplied
# the days in a campaign by 5.6 without touching it, so rent is about 5.6x
# heavier in real terms than when it was authored: 0.4-1.5% of income where it
# was 0.07-0.27%, and 24 played cases across the whole campaign. Examined and
# deliberately left, unlike the daily-goal floors and the decor branch, which
# were the same kind of drift. The difference is where each one landed. This
# one is still inside what it was authored to be -- "a fraction of one case per
# day", 0.07 of a case at tier 0 and 0.31 at tier 14, never approaching one --
# so what drifted away is slack, not the design.
#
# There is also a hard reason not to trim it now. It is income to the player if
# you do, and `TIER_EFFORT_BASE` has 0.2% of clearance at the band floor:
# retiring rent altogether already measures 0.99h for a daily-claiming player.
# Cutting rent moves the pace band, and it would hollow out the district
# board's rent relief, which TERRITORY_TOTAL_CASE_BUDGET was just priced
# against. Three coupled constants, one of them signed off; this one moves last
# if it moves at all.
for _firm_tier in FIRM_TIERS:
    _firm_tier["rent_daily"] = max(15, int(_firm_tier["cost"]) // 50)

def _asset(key, asset_type, name, cost, reputation, tier, benefit, description, *, requires=(), region=None, art=None, **effects):
    return {
        "key": key, "type": asset_type, "name": name, "cost": cost,
        "reputation": reputation, "tier": tier, "benefit": benefit,
        "description": description, "requires": list(requires),
        "region": region or FIRM_TIERS[tier]["region"], "art": art,
        **effects,
    }


UPGRADES = [
    {
        "key": "repaired_desk", "type": "upgrade", "name": "Repaired oak desk", "cost": 350,
        "reputation": 0, "tier": 0, "benefit": "+3% active case payout", "payout_mult": .03, "region": "Old Quarter", "art": "workshop",
        "description": "A solid place to turn careful reasoning into a real practice.",
    },
    {
        "key": "proper_lighting", "type": "upgrade", "name": "Proper lighting", "cost": 850,
        "reputation": 0, "tier": 0, "requires": ["repaired_desk"], "benefit": "+3% active case payout", "payout_mult": .03, "region": "Old Quarter", "art": "workshop",
        "description": "Warm lamps replace the flicker and make late briefs feel possible.",
    },
    {
        "key": "case_management", "type": "upgrade", "name": "Case-management system", "cost": 1_800,
        "reputation": 20, "tier": 0, "requires": ["proper_lighting"], "benefit": "+6% active case payout", "payout_mult": .06, "region": "Old Quarter", "art": "tech",
        "description": "Organized files, faster billing, and fewer papers underfoot.",
    },
    {
        "key": "legal_library", "type": "upgrade", "name": "Legal library", "cost": 5_500,
        "reputation": 20, "tier": 1, "benefit": "+8% active case payout", "payout_mult": .08, "region": "Old Quarter", "art": "library",
        "description": "A wall of references that changes the room—and client confidence.",
    },
    _asset("secure_client_portal", "upgrade", "Secure client portal", 8_000, 24, 1, "+7% payout · +2h safe storage", "Encrypted intake, instant signatures, and a client experience far beyond the old shack.", requires=("case_management",), art="tech", payout_mult=.07, storage_hours=2),
    _asset("deposition_studio", "upgrade", "Deposition studio", 11_000, 28, 1, "+9% active case payout", "Broadcast-grade recording catches the pause, contradiction, and detail that decide a matter.", requires=("legal_library",), art="courtroom", payout_mult=.09),
    {
        "key": "conference_room", "type": "upgrade", "name": "Conference room", "cost": 16_000,
        "reputation": 32, "tier": 2, "requires": ["legal_library"], "benefit": "+10% active case payout", "payout_mult": .10, "region": "Market Ward", "art": "courtroom",
        "description": "Space for serious clients and serious preparation.",
    },
    _asset("e_discovery_suite", "upgrade", "E-discovery suite", 28_000, 34, 2, "+12% active case payout", "A searchable evidence wall turns mountains of documents into a winning chronology.", requires=("secure_client_portal",), art="tech", payout_mult=.12),
    _asset("moot_court", "upgrade", "Moot courtroom", 45_000, 36, 2, "+12% payout · streak cap +5%", "Practice the decisive exchange before a judge ever hears it.", requires=("conference_room",), art="courtroom", payout_mult=.12, streak_bonus_cap=.05),
    {
        "key": "research_floor", "type": "upgrade", "name": "Research floor", "cost": 85_000,
        "reputation": 42, "tier": 3, "requires": ["conference_room"], "benefit": "+12% active case payout", "payout_mult": .12, "region": "Civic Center", "art": "library",
        "description": "A dedicated analytical team turns good work into a citywide reputation.",
    },
    _asset("trial_analytics_lab", "upgrade", "Trial analytics lab", 130_000, 44, 3, "+15% payout · streak cap +5%", "Replay arguments against thousands of courtroom patterns without losing their human edge.", requires=("e_discovery_suite",), art="analytics", payout_mult=.15, streak_bonus_cap=.05),
    _asset("media_response_room", "upgrade", "Media response room", 210_000, 46, 3, "+12% payout · reputation guard", "A rapid-response studio protects the client and the firm's name when every camera turns on.", requires=("research_floor",), art="media", payout_mult=.12, reputation_guard=1.0),
    {
        "key": "executive_suite", "type": "upgrade", "name": "Executive partner suite", "cost": 400_000,
        "reputation": 50, "tier": 4, "requires": ["research_floor"], "benefit": "+15% active case payout", "payout_mult": .15, "region": "Financial District", "art": "executive",
        "description": "An unmistakable headquarters for a firm with influence.",
    },
    _asset("litigation_war_room", "upgrade", "Litigation war room", 620_000, 52, 4, "+18% payout · +1× contract bonus", "A wall-sized living case map keeps every team on the same decisive theory.", requires=("trial_analytics_lab",), art="command", payout_mult=.18, contract_bonus_mult=1),
    _asset("jury_simulator", "upgrade", "Predictive jury theater", 950_000, 54, 4, "+20% payout · streak cap +10%", "An immersive jury simulator stress-tests narrative, sequence, and every vulnerable assumption.", requires=("litigation_war_room",), art="hologram", payout_mult=.20, streak_bonus_cap=.10),
    _asset("branch_command", "upgrade", "Branch command center", 1_600_000, 56, 5, "+20% payout · +4h safe storage", "Coordinate the whole region from a luminous operations table.", requires=("executive_suite",), art="command", payout_mult=.20, storage_hours=4),
    _asset("legal_airship", "upgrade", "Counsel airship", 3_200_000, 58, 5, "+25% active case payout", "A mobile office crosses the region overnight with a courtroom-ready team aboard.", requires=("branch_command",), art="transit", payout_mult=.25),
    _asset("ai_brief_foundry", "upgrade", "AI brief foundry", 7_000_000, 62, 6, "+28% payout · +1× contract bonus", "A supervised research foundry assembles authorities at national scale while counsel makes every judgment.", requires=("trial_analytics_lab",), art="tech", payout_mult=.28, contract_bonus_mult=1),
    _asset("national_litigation_grid", "upgrade", "National litigation grid", 12_000_000, 64, 6, "+30% payout · +6h safe storage", "Every branch shares live arguments, evidence, and expert capacity.", requires=("ai_brief_foundry",), art="network", payout_mult=.30, storage_hours=6),
    _asset("translation_cloud", "upgrade", "Live translation cloud", 28_000_000, 68, 7, "+32% active case payout", "Cross-border teams hear nuance, not delay, in every negotiation.", requires=("national_litigation_grid",), art="network", payout_mult=.32),
    _asset("satellite_docket", "upgrade", "Satellite docket array", 55_000_000, 70, 7, "+35% payout · streak cap +10%", "Secure satellite links put a command-quality hearing room anywhere on Earth.", requires=("translation_cloud",), art="space", payout_mult=.35, streak_bonus_cap=.10),
    _asset("global_crisis_center", "upgrade", "Global crisis command", 130_000_000, 74, 8, "+38% payout · reputation shield", "A twenty-four-hour command floor stabilizes matters that cross markets and borders in minutes.", requires=("satellite_docket",), art="command", payout_mult=.38, reputation_guard=1.5),
    _asset("vault_archive", "upgrade", "Subterranean precedent vault", 240_000_000, 76, 8, "+40% payout · +8h safe storage", "A climate-sealed archive preserves the arguments that built the empire.", requires=("global_crisis_center",), art="library", payout_mult=.40, storage_hours=8),
    _asset("treaty_chamber", "upgrade", "Holographic treaty chamber", 520_000_000, 79, 9, "+45% payout · +1× contract bonus", "Delegations negotiate around a living model of every border, resource, and obligation.", requires=("vault_archive",), art="hologram", payout_mult=.45, contract_bonus_mult=1),
    _asset("prediction_engine", "upgrade", "Precedent prediction engine", 900_000_000, 81, 9, "+48% payout · streak cap +15%", "A transparent simulation reveals which theory survives every likely counterargument.", requires=("treaty_chamber",), art="analytics", payout_mult=.48, streak_bonus_cap=.15),
    _asset("autonomous_case_campus", "upgrade", "Autonomous case campus", 1_700_000_000, 83, 10, "+50% payout · $80M/hour", "Robotic archives, hearing halls, and research wings keep major matters moving continuously.", requires=("prediction_engine",), art="future", payout_mult=.50, passive_hourly=80_000_000),
    _asset("supersonic_courier", "upgrade", "Supersonic counsel shuttle", 3_200_000_000, 85, 10, "+55% active case payout", "Counsel and evidence cross a continent between filing and argument.", requires=("autonomous_case_campus",), art="transit", payout_mult=.55),
    _asset("oceanic_campus", "upgrade", "Floating arbitration forum", 5_000_000_000, 86, 11, "+60% payout · +12h safe storage", "A neutral, self-sustaining forum hosts the world's largest commercial disputes offshore.", requires=("supersonic_courier",), art="ocean", payout_mult=.60, storage_hours=12),
    _asset("digital_twin_court", "upgrade", "Digital-twin courtroom", 8_500_000_000, 87, 11, "+65% payout · +2× contract bonus", "Reconstruct systems, cities, and events in a courtroom-scale interactive twin.", requires=("oceanic_campus",), art="hologram", payout_mult=.65, contract_bonus_mult=2),
    _asset("orbital_hearing_ring", "upgrade", "Zero-gravity hearing ring", 13_000_000_000, 89, 12, "+70% payout · streak cap +20%", "An orbital forum built for disputes no terrestrial venue can fairly contain.", requires=("digital_twin_court",), art="space", payout_mult=.70, streak_bonus_cap=.20),
    _asset("precedent_supercomputer", "upgrade", "Precedent supercomputer", 19_000_000_000, 90, 12, "+75% payout · $400M/hour", "A moon-cold legal computer models centuries of doctrine while preserving a human decision trail.", requires=("orbital_hearing_ring",), art="future", payout_mult=.75, passive_hourly=400_000_000),
    _asset("lunar_embassy", "upgrade", "Lunar treaty embassy", 30_000_000_000, 92, 13, "+80% payout · reputation shield", "A permanent embassy gives new settlements a trusted neutral table.", requires=("precedent_supercomputer",), art="space", payout_mult=.80, reputation_guard=2.0),
    _asset("chronicle_vault", "upgrade", "Civilization chronicle vault", 48_000_000_000, 93, 13, "+90% payout · +24h safe storage", "The definitive record of laws, promises, and judgments is mirrored beyond Earth.", requires=("lunar_embassy",), art="library", payout_mult=.90, storage_hours=24),
    _asset("planetary_command", "upgrade", "Planetary justice command", 72_000_000_000, 94, 14, "+100% payout · +3× contract bonus", "A planet-wide legal operations center routes the right advocate to any crisis in moments.", requires=("chronicle_vault",), art="command", payout_mult=1.0, contract_bonus_mult=3),
    _asset("justice_constellation", "upgrade", "Justice constellation", 120_000_000_000, 96, 14, "+125% payout · streak cap +25% · +48h safe storage", "A constellation of courts, archives, and advocates turns the firm's final crest into civic infrastructure.", requires=("planetary_command",), art="space", payout_mult=1.25, storage_hours=48, streak_bonus_cap=.25),
]

STAFF = [
    {
        "key": "paralegal", "type": "staff", "name": "Maya · Paralegal", "cost": 2_500,
        "reputation": 20, "tier": 1, "benefit": "Up to +$20 per active case", "staff_flat": 20, "region": "Old Quarter", "art": "files",
        "description": "Keeps the docket moving and every case file exactly where it belongs.",
    },
    {
        "key": "junior_associate", "type": "staff", "name": "Theo · Junior Associate", "cost": 8_000,
        "reputation": 30, "tier": 1, "benefit": "$30 passive income per hour", "passive_hourly": 30, "region": "Old Quarter", "art": "brief",
        "description": "Handles routine retainers while you focus on the decisive arguments.",
    },
    {
        "key": "office_manager", "type": "staff", "name": "Nina · Office Manager", "cost": 25_000,
        "reputation": 32, "tier": 2, "benefit": "+5% active case payout", "payout_mult": .05, "region": "Market Ward", "art": "clipboard",
        "description": "Keeps filing, scheduling, and billing efficient on every active case.",
    },
    {
        "key": "senior_associate", "type": "staff", "name": "Avery · Senior Associate", "cost": 42_000,
        "reputation": 42, "tier": 3, "requires": ["junior_associate"], "benefit": "$130 passive income per hour", "passive_hourly": 130, "region": "Civic Center", "art": "folio",
        "description": "Owns complex client work and makes the office feel formidable.",
    },
    {
        "key": "partner", "type": "staff", "name": "Jordan · Partner", "cost": 180_000,
        "reputation": 50, "tier": 4, "requires": ["senior_associate"], "benefit": "+8% active case payout", "payout_mult": .08, "region": "Financial District", "art": "coffee",
        "description": "A proven partner who attracts the cases other firms want.",
    },
    {
        "key": "rainmaker", "type": "staff", "name": "Morgan · Rainmaker", "cost": 850_000,
        "reputation": 56, "tier": 5, "requires": ["partner"], "benefit": "+5% active case payout", "payout_mult": .05, "region": "Harbor Exchange", "art": "phone",
        "description": "Turns elite relationships into a national book of business.",
    },
    _asset("intake_specialist", "staff", "Iris · Intake Specialist", 1_200, 10, 0, "+$75 per active case", "Makes every caller feel heard and spots the promising matter in a crowded inbox.", art="phone", staff_flat=75),
    _asset("private_investigator", "staff", "Darius · Investigator", 13_000, 32, 2, "+8% active case payout", "Finds the witness, missing timestamp, and inconvenient fact before opposing counsel does.", requires=("paralegal",), art="briefcase", payout_mult=.08),
    _asset("litigation_technologist", "staff", "Sora · Litigation Technologist", 32_000, 36, 2, "$4,000/hour · +4h storage", "Builds clean evidence pipelines and keeps the courtroom presentation flawless.", requires=("office_manager",), art="tablet", passive_hourly=4_000, storage_hours=4),
    _asset("legal_nurse", "staff", "Amara · Legal Nurse", 70_000, 42, 3, "+10% payout · reputation guard", "Translates dense medical records into a precise, humane case story.", art="clipboard", payout_mult=.10, reputation_guard=.5),
    _asset("trial_consultant", "staff", "Mateo · Trial Consultant", 145_000, 46, 3, "+12% payout · streak cap +5%", "Finds where a technically correct argument loses the room—and repairs it.", requires=("senior_associate",), art="folio", payout_mult=.12, streak_bonus_cap=.05),
    _asset("communications_director", "staff", "Zuri · Communications Director", 300_000, 50, 4, "+14% payout · reputation shield", "Keeps public facts straight when a major case becomes the city's story.", requires=("media_response_room",), art="phone", payout_mult=.14, reputation_guard=1),
    _asset("appellate_counsel", "staff", "Noah · Appellate Counsel", 650_000, 54, 4, "+18% active case payout", "Turns the record into a clean rule, a narrow issue, and an argument built to last.", requires=("partner",), art="brief", payout_mult=.18),
    _asset("chief_operating_officer", "staff", "Leila · Chief Operating Officer", 1_400_000, 56, 5, "$180,000/hour · +6h storage", "Runs a multi-office firm like one excellent team instead of ten busy islands.", requires=("office_manager",), art="tablet", passive_hourly=180_000, storage_hours=6),
    _asset("cybersecurity_counsel", "staff", "Kenji · Cybersecurity Counsel", 3_000_000, 60, 5, "+22% payout · reputation guard", "Handles breach response at technical speed without losing legal precision.", requires=("litigation_technologist",), art="tablet", payout_mult=.22, reputation_guard=1),
    _asset("branch_director", "staff", "Elena · National Branch Director", 6_500_000, 62, 6, "$800,000/hour", "Builds local excellence into a dependable national system.", requires=("chief_operating_officer",), art="clipboard", passive_hourly=800_000),
    _asset("economist", "staff", "Caleb · Chief Economist", 11_000_000, 65, 6, "+26% active case payout", "Makes the market consequence of an argument visible, testable, and hard to dismiss.", art="brief", payout_mult=.26),
    _asset("international_arbitrator", "staff", "Nadia · International Arbitrator", 26_000_000, 68, 7, "+30% payout · +1× contract bonus", "Moves between legal systems without flattening the difference that matters.", requires=("appellate_counsel",), art="folio", payout_mult=.30, contract_bonus_mult=1),
    _asset("diplomatic_liaison", "staff", "Tomas · Diplomatic Liaison", 52_000_000, 71, 7, "$6,000,000/hour · reputation shield", "Keeps high-stakes negotiations open when protocol and pressure collide.", art="phone", passive_hourly=6_000_000, reputation_guard=1.5),
    _asset("crisis_commander", "staff", "Rin · Global Crisis Commander", 115_000_000, 74, 8, "+35% payout · +8h storage", "Coordinates experts and advocates through the first chaotic hours of a global matter.", requires=("global_crisis_center",), art="tablet", payout_mult=.35, storage_hours=8),
    _asset("data_scientist", "staff", "Omar · Legal Data Scientist", 220_000_000, 77, 8, "$24,000,000/hour", "Audits the models, exposes weak correlations, and makes powerful evidence legible.", requires=("trial_analytics_lab",), art="tablet", passive_hourly=24_000_000),
    _asset("sovereign_envoy", "staff", "Anika · Sovereign Envoy", 480_000_000, 79, 9, "+42% payout · reputation shield", "Carries the firm's credibility into rooms where every word becomes policy.", requires=("international_arbitrator",), art="portfolio", payout_mult=.42, reputation_guard=2),
    _asset("treaty_architect", "staff", "Gabriel · Treaty Architect", 850_000_000, 81, 9, "+45% payout · +2× contract bonus", "Designs agreements that remain workable after the ceremony and headlines are gone.", requires=("sovereign_envoy",), art="folio", payout_mult=.45, contract_bonus_mult=2),
    _asset("automation_director", "staff", "Mei · Automation Director", 1_600_000_000, 83, 10, "$140,000,000/hour", "Automates repetition while keeping every strategic and ethical judgment with counsel.", requires=("data_scientist",), art="tablet", passive_hourly=140_000_000),
    _asset("quantum_analyst", "staff", "Idris · Quantum Evidence Analyst", 3_000_000_000, 85, 10, "+55% active case payout", "Tests impossible-scale evidence without turning uncertainty into false confidence.", requires=("automation_director",), art="brief", payout_mult=.55),
    _asset("oceanic_counsel", "staff", "Marisol · Oceanic Counsel", 5_000_000_000, 86, 11, "+60% payout · $300M/hour", "Navigates maritime, climate, and resource law from the floating forum.", requires=("international_arbitrator",), art="portfolio", payout_mult=.60, passive_hourly=300_000_000),
    _asset("systems_advocate", "staff", "Vik · Systems Advocate", 8_000_000_000, 88, 11, "+65% payout · reputation shield", "Explains planet-scale systems without losing the people affected by them.", requires=("oceanic_counsel",), art="folio", payout_mult=.65, reputation_guard=2),
    _asset("orbital_counsel", "staff", "Asha · Orbital Counsel", 12_000_000_000, 89, 12, "+72% payout · $700M/hour", "Writes the doctrine for commerce, safety, and responsibility beyond the atmosphere.", requires=("systems_advocate",), art="portfolio", payout_mult=.72, passive_hourly=700_000_000),
    _asset("lunar_envoy", "staff", "Sol · Lunar Envoy", 27_000_000_000, 92, 13, "+85% payout · +3× contract bonus", "Keeps Earth and lunar settlements at one table when distance magnifies every dispute.", requires=("orbital_counsel",), art="phone", payout_mult=.85, contract_bonus_mult=3),
    _asset("chief_justice_strategist", "staff", "Nova · Chief Justice Strategist", 65_000_000_000, 94, 14, "+100% payout · maximum reputation shield", "Leads the final network with judgment equal to its impossible reach.", requires=("lunar_envoy",), art="folio", payout_mult=1.0, reputation_guard=3),
]

CONNECTIONS = [
    {
        "key": "local_bar", "type": "connection", "name": "Local bar association", "cost": 4_500,
        "reputation": 20, "tier": 1, "benefit": "Unlocks small-business clients", "region": "Old Quarter", "art": "local",
        "description": "A trusted circle of local attorneys and referrals.",
    },
    {
        "key": "business_network", "type": "connection", "name": "Business-owner network", "cost": 18_000,
        "reputation": 32, "tier": 2, "requires": ["local_bar"], "benefit": "Unlocks private and property clients", "region": "Market Ward", "art": "business",
        "description": "Founders and operators who remember excellent work.",
    },
    {
        "key": "board_network", "type": "connection", "name": "Corporate board network", "cost": 140_000,
        "reputation": 42, "tier": 3, "requires": ["business_network", "senior_associate"], "benefit": "Unlocks corporate clients", "region": "Civic Center", "art": "board",
        "description": "Boardroom relationships built on results, not shortcuts.",
    },
    {
        "key": "international_network", "type": "connection", "name": "International legal network", "cost": 2_000_000,
        "reputation": 56, "tier": 5, "requires": ["board_network", "rainmaker"], "benefit": "Unlocks global clients", "region": "Harbor Exchange", "art": "global",
        "description": "A cross-border referral network for the final climb.",
    },
    _asset("civic_referral_council", "connection", "Civic referral council", 70_000, 40, 3, "Unlocks hospitals and public institutions", "Judges, nonprofits, and civic leaders who send difficult matters to steady hands.", requires=("business_network",), art="civic"),
    _asset("entertainment_circle", "connection", "Entertainment leadership circle", 330_000, 50, 4, "Unlocks media and sports clients", "Producers, athletes, and rights owners who need calm counsel under bright lights.", requires=("board_network",), art="media"),
    _asset("national_gc_council", "connection", "National GC council", 6_000_000, 62, 6, "Unlocks national enterprise clients", "General counsel who share trust only after the work proves it.", requires=("international_network",), art="national"),
    _asset("diplomatic_forum", "connection", "Diplomatic legal forum", 24_000_000, 68, 7, "Unlocks sovereign and treaty clients", "A neutral forum of embassies, arbitrators, and treaty experts.", requires=("international_network",), art="diplomatic"),
    _asset("global_exchange", "connection", "Global executive exchange", 105_000_000, 74, 8, "Unlocks megacap and biotech clients", "A worldwide table of builders whose risks no longer fit in one jurisdiction.", requires=("diplomatic_forum",), art="global"),
    _asset("sovereign_council", "connection", "Sovereign counsel council", 420_000_000, 79, 9, "Unlocks central banks and governments", "Trusted counsel for institutions that think in generations.", requires=("global_exchange",), art="sovereign"),
    _asset("innovation_compact", "connection", "Continental innovation compact", 1_500_000_000, 83, 10, "Unlocks quantum and infrastructure clients", "Research cities and frontier industries sharing one rules framework.", requires=("sovereign_council",), art="future"),
    _asset("oceanic_compact", "connection", "Oceanic governance compact", 4_500_000_000, 86, 11, "Unlocks oceanic consortiums", "Coastal states, climate institutions, and maritime operators at one neutral table.", requires=("innovation_compact",), art="ocean"),
    _asset("orbital_bar", "connection", "Orbital bar association", 11_000_000_000, 89, 12, "Unlocks orbital industry clients", "The first professional network licensed across Earth and orbital habitats.", requires=("oceanic_compact",), art="space"),
    _asset("interworld_assembly", "connection", "Interworld legal assembly", 26_000_000_000, 92, 13, "Unlocks lunar and interworld clients", "A new assembly writing trusted procedure across worlds.", requires=("orbital_bar",), art="space"),
]

RIVALS = [
    {
        "key": "neighborhood_practice", "type": "rival", "name": "Acquire Harrow & Finch", "cost": 75_000,
        "reputation": 34, "tier": 2, "requires": ["local_bar"], "benefit": "+5% payout · $250/hour", "payout_mult": .05, "passive_hourly": 250, "region": "Market Ward", "art": "brick-house",
        "description": "Bring a respected neighborhood practice into your growing firm.",
    },
    {
        "key": "downtown_boutique", "type": "rival", "name": "Acquire Vale Legal", "cost": 750_000,
        "reputation": 50, "tier": 4, "requires": ["neighborhood_practice", "board_network"], "benefit": "+8% payout · $1,200/hour", "payout_mult": .08, "passive_hourly": 1_200, "region": "Financial District", "art": "art-deco",
        "description": "Absorb a polished boutique and its premium client book.",
    },
    {
        "key": "regional_firm", "type": "rival", "name": "Acquire Northstar Law", "cost": 5_000_000,
        "reputation": 58, "tier": 5, "requires": ["downtown_boutique"], "benefit": "+10% payout · $6,000/hour", "payout_mult": .10, "passive_hourly": 6_000, "region": "Harbor Exchange", "art": "northstar",
        "description": "Your first multi-region acquisition changes the skyline for good.",
    },
    {
        "key": "national_competitor", "type": "rival", "name": "Acquire Sterling Global", "cost": 30_000_000,
        "reputation": 64, "tier": 6, "requires": ["regional_firm", "international_network"], "benefit": "+15% payout · $25,000/hour", "payout_mult": .15, "passive_hourly": 25_000, "region": "Midtown Crown", "art": "mega-tower",
        "description": "The defining acquisition of a national legal empire.",
    },
    _asset("appellate_chambers", "rival", "Acquire Blackstone Chambers", 160_000, 43, 3, "+8% payout · $15,000/hour", "A feared appellate chamber brings a century of arguments and a beautiful civic archive.", requires=("neighborhood_practice",), art="gothic", payout_mult=.08, passive_hourly=15_000),
    _asset("media_law_collective", "rival", "Acquire Neon & Gold", 1_400_000, 54, 4, "+12% payout · $90,000/hour", "A neon-lit media collective adds entertainment fluency and a formidable trial studio.", requires=("downtown_boutique",), art="neon", payout_mult=.12, passive_hourly=90_000),
    _asset("transatlantic_firm", "rival", "Acquire Meridian Atlantic", 60_000_000, 68, 7, "+18% payout · $4M/hour", "A transatlantic institution gives the empire genuine cross-border depth.", requires=("national_competitor",), art="glass-arc", payout_mult=.18, passive_hourly=4_000_000),
    _asset("global_crisis_firm", "rival", "Acquire Redline Counsel", 260_000_000, 74, 8, "+22% payout · $18M/hour", "The world's fastest crisis firm becomes your always-awake response division.", requires=("transatlantic_firm",), art="command", payout_mult=.22, passive_hourly=18_000_000),
    _asset("sovereign_rival", "rival", "Acquire Crown Meridian", 950_000_000, 79, 9, "+28% payout · $65M/hour", "A sovereign advisory house unlocks treaty halls once closed to outsiders.", requires=("global_crisis_firm", "sovereign_council"), art="citadel", payout_mult=.28, passive_hourly=65_000_000),
    _asset("continental_rival", "rival", "Acquire Atlas Juris", 3_500_000_000, 83, 10, "+35% payout · $220M/hour", "An autonomous continental campus joins your crest after the largest merger in legal history.", requires=("sovereign_rival",), art="campus", payout_mult=.35, passive_hourly=220_000_000),
    _asset("oceanic_rival", "rival", "Acquire Pelagic Partners", 9_000_000_000, 86, 11, "+42% payout · $550M/hour", "The floating blue citadel and its climate practice become the empire's oceanic wing.", requires=("continental_rival", "oceanic_compact"), art="ocean", payout_mult=.42, passive_hourly=550_000_000),
    _asset("orbital_rival", "rival", "Acquire Zenith Orbital", 22_000_000_000, 89, 12, "+55% payout · $1.2B/hour", "The rival orbital ring docks with yours, joining two unprecedented bodies of space law.", requires=("oceanic_rival", "orbital_bar"), art="orbital", payout_mult=.55, passive_hourly=1_200_000_000),
    _asset("lunar_rival", "rival", "Acquire Selene Accord", 50_000_000_000, 92, 13, "+70% payout · $2.5B/hour", "The lunar settlement's founding law house accepts a place in the interworld alliance.", requires=("orbital_rival", "interworld_assembly"), art="lunar", payout_mult=.70, passive_hourly=2_500_000_000),
    _asset("planetary_rival", "rival", "Acquire Apex Justice Network", 140_000_000_000, 95, 14, "+100% payout · $6B/hour", "The final rival becomes the other half of a planetary public-interest legal network.", requires=("lunar_rival", "justice_constellation"), art="nexus", payout_mult=1.0, passive_hourly=6_000_000_000),
]

# Cosmetics are the only purchases with no mechanical effect. They exist so a
# player can furnish the office to taste, so they are deliberately cheaper than
# the functional asset at the same tier and never gate a headquarters advance.
#
# Their prices are quoted in cases (`decor_cases`) like everything else rather
# than in dollars. They were authored in dollars until the ladder was rescaled
# for pacing, at which point the most extravagant decoration in the game cost a
# twentieth of a single late case — the failure mode the pro bono fees already
# ran into once. The share each piece carries is the one it had when these were
# hand-priced, so the relative indulgence is unchanged; only the anchor moved.
COSMETICS = [
    _asset("bar_certificate", "cosmetic", "Framed bar certificate", 500, 0, 0, "Decor · hangs beside the desk", "The document that started all of this, finally out of the drawer and under glass.", art="decor-frame", decor_cases=.55),
    _asset("banker_lamp", "cosmetic", "Brass banker's lamp", 1_200, 0, 0, "Decor · sits on the partner desk", "A green glass shade and a warm pool of light for the hours after everyone leaves.", requires=("repaired_desk",), art="decor-lamp", decor_cases=1.3),
    _asset("persian_rug", "cosmetic", "Hand-knotted Persian rug", 1_200, 20, 1, "Decor · covers the client floor", "Deep madder and indigo underfoot; the first thing a nervous client notices.", art="decor-rug", decor_cases=.75),
    _asset("fig_tree", "cosmetic", "Potted fig tree", 1_900, 20, 1, "Decor · fills the window corner", "Something alive in the room, kept carefully in the light from the window.", art="decor-plant", decor_cases=1.2),
    _asset("chesterfield", "cosmetic", "Leather chesterfield", 2_600, 32, 2, "Decor · client reading corner", "Buttoned oxblood leather that makes waiting feel like being taken seriously.", art="decor-seating", decor_cases=.85),
    _asset("reporter_wall", "cosmetic", "Wall of bound reporters", 3_800, 32, 2, "Decor · reading shelf beside the library", "Gilt spines from a century of decisions, arranged the way a partner actually reads them.", requires=("legal_library",), art="decor-books", decor_cases=1.2),
    _asset("grandfather_clock", "cosmetic", "Grandfather clock", 5_600, 42, 3, "Decor · stands against the window wall", "Walnut, brass, and a quarter chime that keeps the room honest about billable hours.", art="decor-clock", decor_cases=.9),
    _asset("skyline_painting", "cosmetic", "Commissioned skyline painting", 8_800, 42, 3, "Decor · hangs above the reception storage", "The city you argue in, painted by someone who clearly loves the courthouse dome.", art="decor-art", decor_cases=1.4),
    _asset("trophy_shelf", "cosmetic", "Advocacy trophy shelf", 13_000, 50, 4, "Decor · lit shelf behind the desk", "Advocacy prizes and bar honors, lit well enough to be read from the doorway.", art="decor-trophy", decor_cases=1.05),
    _asset("justice_bust", "cosmetic", "Marble bust of Justice", 23_000, 56, 5, "Decor · plinth near the entry", "Carrara marble on a black plinth, blindfold intact, watching the whole floor.", art="decor-bust", decor_cases=.95),
    _asset("globe_bar", "cosmetic", "Antique globe bar", 44_000, 62, 6, "Decor · beside the client seating", "A hollow terrestrial globe that opens into crystal and a very good decanter.", art="decor-globe", decor_cases=.9),
    _asset("stained_glass", "cosmetic", "Stained-glass jurisprudence panel", 77_000, 68, 7, "Decor · set into the window wall", "Scales, oath, and open book in leaded glass, throwing colour across the floor at dusk.", art="decor-glass", decor_cases=.85),
    _asset("charter_vitrine", "cosmetic", "First-charter vitrine", 290_000, 79, 9, "Decor · sealed case by the archive", "The firm's founding charter under museum glass, inert gas, and its own quiet light.", requires=("vault_archive",), art="decor-vitrine", decor_cases=.95),
    _asset("orchid_wall", "cosmetic", "Living orchid wall", 810_000, 86, 11, "Decor · planted wall on the rear wall", "A tended vertical garden that keeps a planet-scale practice breathing like a place people work.", art="decor-living-wall", decor_cases=.8),
]

ASSETS = UPGRADES + STAFF + CONNECTIONS + RIVALS + COSMETICS
TIER_GATED_ASSET_TYPES = {"upgrade", "staff", "rival"}
# Purely decorative purchases keep their authored price and carry no effects.
UNBALANCED_ASSET_TYPES = {"cosmetic"}


def _tier_required_asset_keys(target_tier: int) -> list[str]:
    """Purchases that must be complete before entering ``target_tier``."""
    return [
        item["key"]
        for item in ASSETS
        if item["type"] in TIER_GATED_ASSET_TYPES and item["tier"] < target_tier
    ]


def _missing_tier_assets(target_tier: int, owned: set[str]) -> list[str]:
    return [key for key in _tier_required_asset_keys(target_tier) if key not in owned]


# --------------------------------------------------------------- wardrobe
#
# How the player's own counsel is dressed, as distinct from `COSMETICS` above,
# which furnishes the room. Nothing here is bought: the office decor ladder is
# already the game's cash sink, and a second one competing with it for the same
# balance would make the wardrobe a tax on the upgrades that actually pay. Each
# piece is instead earned by playing — a headquarters reached, a reputation
# band held, a number of cases settled, a chapter resolved — so opening the
# wardrobe is a record of the campaign rather than a shop.
#
# Every category opens with an "as issued" default that applies no override at
# all, which is what keeps a brand-new account looking exactly as it did before
# this catalog existed.

WARDROBE_UNLOCK_START = {"kind": "start"}


def _wardrobe_tier(tier: int) -> dict:
    return {"kind": "tier", "value": tier}


def _wardrobe_reputation(value: int) -> dict:
    return {"kind": "reputation", "value": value}


def _wardrobe_cases(value: int) -> dict:
    return {"kind": "cases", "value": value}


def _wardrobe_chapter(key: str) -> dict:
    return {"kind": "chapter", "value": key}


def _wardrobe(key: str, category: str, name: str, flavor: str, unlock: dict) -> dict:
    return {"key": key, "category": category, "name": name, "flavor": flavor, "unlock": unlock}


WARDROBE_CATEGORIES = [
    {
        "key": "suit",
        "name": "Suit",
        "blurb": "The cloth the whole room reads first.",
    },
    {
        "key": "tie",
        "name": "Neckwear",
        "blurb": "Six inches of silk that decides how formal you look.",
    },
    {
        "key": "hair",
        "name": "Hair",
        "blurb": "How you wear it into chambers.",
    },
    {
        "key": "eyewear",
        "name": "Eyewear",
        "blurb": "For reading the paragraph nobody else read.",
    },
    {
        "key": "accessory",
        "name": "Accessory",
        "blurb": "One deliberate detail. Never two.",
    },
]

WARDROBE = [
    # Suits. The default keeps the tier-driven navy that deepens as the firm
    # climbs; every other colourway is a fixed cloth the player has chosen.
    _wardrobe("suit_house_navy", "suit", "Firm navy", "House cloth. Its indigo deepens with every headquarters you take.", WARDROBE_UNLOCK_START),
    _wardrobe("suit_charcoal", "suit", "Charcoal worsted", "The suit that has never once been the most interesting thing in the room.", WARDROBE_UNLOCK_START),
    _wardrobe("suit_slate", "suit", "Slate grey", "Cool, unhurried, and impossible to read across a negotiating table.", _wardrobe_reputation(35)),
    _wardrobe("suit_forest", "suit", "Forest green", "Deep bottle green with a countryside confidence the city never quite trusts.", _wardrobe_tier(3)),
    _wardrobe("suit_oxblood", "suit", "Oxblood", "A hundred and fifty files in, you have earned one suit that argues first.", _wardrobe_cases(150)),
    _wardrobe("suit_cream_linen", "suit", "Cream linen", "Cut for a jurisdiction where the courthouse has ceiling fans.", _wardrobe_tier(6)),
    _wardrobe("suit_pinstripe", "suit", "Chalk pinstripe", "The cloth Sterling wears. Wearing it back is its own kind of answer.", _wardrobe_chapter("sterling_invitation")),
    # Neckwear.
    _wardrobe("tie_house_burgundy", "tie", "House burgundy", "Standard issue since the first shingle went up in the rain.", WARDROBE_UNLOCK_START),
    _wardrobe("tie_open_collar", "tie", "Open collar", "No tie. The privilege of counsel whose work speaks before the collar does.", WARDROBE_UNLOCK_START),
    _wardrobe("tie_regimental", "tie", "Regimental stripe", "Diagonal navy and gold, worn by every advocate who has survived a first docket.", _wardrobe_cases(25)),
    _wardrobe("tie_gold_foulard", "tie", "Gold foulard", "Warm gold silk that photographs well on courthouse steps.", _wardrobe_reputation(60)),
    _wardrobe("tie_bow", "tie", "Black bow tie", "Hand-tied. Appellate counsel and nobody else can carry it in daylight.", _wardrobe_tier(5)),
    _wardrobe("tie_cravat", "tie", "Ivory cravat", "Chartered counsel, formal dress. Ada would have found it ridiculous and worn it anyway.", _wardrobe_chapter("charter_of_counsel")),
    # Hair.
    _wardrobe("hair_signature", "hair", "Signature cut", "However you wore it the day you were sworn in.", WARDROBE_UNLOCK_START),
    _wardrobe("hair_cropped", "hair", "Cropped", "Short, exact, and no longer a decision you make in the morning.", WARDROBE_UNLOCK_START),
    _wardrobe("hair_full", "hair", "Full volume", "More of it than the job strictly allows.", WARDROBE_UNLOCK_START),
    _wardrobe("hair_distinguished", "hair", "Distinguished silver", "Eight headquarters will do this to anybody's temples.", _wardrobe_tier(8)),
    # Eyewear.
    _wardrobe("eyewear_as_issued", "eyewear", "As issued", "Whatever you happened to have on when the first client walked in.", WARDROBE_UNLOCK_START),
    _wardrobe("eyewear_none", "eyewear", "None", "Nothing between you and the exhibit.", WARDROBE_UNLOCK_START),
    _wardrobe("eyewear_round", "eyewear", "Round wire frames", "Thin gold wire. Reads as scholarly until you start cross-examining.", WARDROBE_UNLOCK_START),
    _wardrobe("eyewear_rectangular", "eyewear", "Rectangular frames", "Fifty files of small print earned a pair built for small print.", _wardrobe_cases(50)),
    _wardrobe("eyewear_tortoiseshell", "eyewear", "Tortoiseshell", "Warm amber acetate. Expensive in a way only other lawyers notice.", _wardrobe_reputation(45)),
    # Accessories. Exactly one at a time, on purpose.
    _wardrobe("accessory_as_issued", "accessory", "As issued", "Whatever the firm handed you on the first morning.", WARDROBE_UNLOCK_START),
    _wardrobe("accessory_none", "accessory", "None", "Nothing on the lapel. Let the argument be the ornament.", WARDROBE_UNLOCK_START),
    _wardrobe("accessory_lapel_pin", "accessory", "Brass lapel pin", "The firm's crest, small enough that a client has to lean in to read it.", WARDROBE_UNLOCK_START),
    _wardrobe("accessory_pocket_square", "accessory", "Pocket square", "Folded once. A neighborhood firm's first small extravagance.", _wardrobe_tier(2)),
    _wardrobe("accessory_wristwatch", "accessory", "Gold wristwatch", "It keeps billable time and says you no longer need to.", _wardrobe_reputation(55)),
    _wardrobe("accessory_briefcase", "accessory", "Oxhide briefcase", "A hundred cases of scuffs. The clasp still shuts on the first try.", _wardrobe_cases(100)),
]

WARDROBE_BY_KEY = {item["key"]: item for item in WARDROBE}
WARDROBE_CATEGORY_KEYS = [category["key"] for category in WARDROBE_CATEGORIES]
# The first entry authored in each category is that category's "as issued"
# default, and every default applies no override to the rig.
WARDROBE_DEFAULTS = {
    category: next(item["key"] for item in WARDROBE if item["category"] == category)
    for category in WARDROBE_CATEGORY_KEYS
}


def _wardrobe_default(category: str, profile: PlayerProfile) -> str:
    """The "as issued" piece for one category on this character.

    Neckwear is the one category whose issued piece depends on the character:
    the female cut has always been drawn with an open shirt collar and the male
    cut with the house four-in-hand. Making the default follow the character is
    what lets "House burgundy" mean an actual burgundy tie for everyone, rather
    than meaning "whatever your cut is issued".
    """

    if category == "tie" and profile.character_gender == "female":
        return "tie_open_collar"
    return WARDROBE_DEFAULTS[category]


def _wardrobe_requirement(unlock: dict) -> str:
    kind = unlock["kind"]
    if kind == "tier":
        tier = FIRM_TIERS[int(unlock["value"])]
        return f"Reach the {tier['name']} (HQ tier {tier['tier']})"
    if kind == "reputation":
        return f"Hold {int(unlock['value'])} reputation"
    if kind == "cases":
        return f"Settle {int(unlock['value'])} cases"
    if kind == "chapter":
        chapter = CHAPTER_BY_KEY.get(str(unlock["value"]))
        return f"Resolve “{chapter['title']}”" if chapter else "Resolve the chapter"
    return "Available from your first day"


def _wardrobe_unlocked(item: dict, profile: PlayerProfile) -> bool:
    unlock = item["unlock"]
    kind = unlock["kind"]
    if kind == "start":
        return True
    if kind == "tier":
        return profile.office_tier >= int(unlock["value"])
    if kind == "reputation":
        return profile.reputation >= float(unlock["value"])
    if kind == "cases":
        return profile.total_cases >= int(unlock["value"])
    if kind == "chapter":
        state = profile.story_state
        return bool(state) and str(unlock["value"]) in set(state.seen_chapters_json or [])
    return False


def wardrobe_selection(profile: PlayerProfile) -> dict[str, str]:
    """The player's effective look, one entry per category.

    Stored choices are re-validated on read rather than trusted. A player can
    lose reputation, so an item that was unlocked when it was chosen may not be
    now; rather than silently dressing them in something they no longer have,
    the category falls back to its default until they meet the condition again.
    """

    stored = profile.cosmetics_json or {}
    selection = {}
    for category in WARDROBE_CATEGORY_KEYS:
        chosen = WARDROBE_BY_KEY.get(str(stored.get(category) or ""))
        usable = chosen and chosen["category"] == category and _wardrobe_unlocked(chosen, profile)
        selection[category] = chosen["key"] if usable else _wardrobe_default(category, profile)
    return selection


def serialize_wardrobe(profile: PlayerProfile) -> dict:
    selection = wardrobe_selection(profile)
    return {
        "selection": selection,
        "categories": [
            {
                **category,
                "default": _wardrobe_default(category["key"], profile),
                "selected": selection[category["key"]],
                "items": [
                    {
                        "key": item["key"],
                        "category": item["category"],
                        "name": item["name"],
                        "flavor": item["flavor"],
                        "unlocked": _wardrobe_unlocked(item, profile),
                        "requirement": _wardrobe_requirement(item["unlock"]),
                        "unlock": item["unlock"],
                    }
                    for item in WARDROBE
                    if item["category"] == category["key"]
                ],
            }
            for category in WARDROBE_CATEGORIES
        ],
    }


def set_wardrobe(profile: PlayerProfile, payload: dict) -> dict[str, str]:
    """Apply a partial wardrobe change.

    Only the categories named in ``payload`` move, so a client that knows about
    four categories cannot clear a fifth it has never heard of. Every named key
    has to exist, sit in the category it was filed under, and be unlocked for
    this profile — the client's own view of what is unlocked is never consulted.
    """

    if not isinstance(payload, dict):
        raise ValueError("invalid_cosmetic")
    updates: dict[str, str] = {}
    for category, value in payload.items():
        if category not in WARDROBE_DEFAULTS:
            raise ValueError("cosmetic_category_not_found")
        item = WARDROBE_BY_KEY.get(str(value or ""))
        if not item or item["category"] != category:
            raise ValueError("cosmetic_not_found")
        if not _wardrobe_unlocked(item, profile):
            raise ValueError("cosmetic_locked")
        updates[category] = item["key"]
    stored = dict(profile.cosmetics_json or {})
    stored.update(updates)
    # Defaults are the absence of a choice, not a choice: dropping them keeps
    # the stored mapping honest about what the player has actually customized
    # and keeps an untouched account's column empty.
    profile.cosmetics_json = {
        category: key
        for category, key in stored.items()
        if category in WARDROBE_DEFAULTS and key != _wardrobe_default(category, profile)
    }
    db.session.commit()
    return wardrobe_selection(profile)


CLIENTS = [
    {"key": "walk_in", "name": "Walk-in client", "base_fee": 100, "reputation": 0, "tier": 0, "length": 8, "icon": "briefcase", "region": "Old Quarter", "description": "Everyday people who need a sharp advocate."},
    {"key": "local_individual", "name": "Local client", "base_fee": 1_100, "reputation": 15, "tier": 0, "length": 8, "icon": "home", "region": "Old Quarter", "description": "A referral from around the neighborhood with a real retainer ready."},
    {"key": "legal_aid_coalition", "name": "Legal aid coalition", "base_fee": 500, "reputation": 10, "tier": 0, "length": 6, "icon": "civic", "region": "Old Quarter", "description": "A community coalition with urgent matters and grant-backed fees."},
    {"key": "small_business", "name": "Small business", "base_fee": 4_500, "reputation": 20, "tier": 1, "requires": ["local_bar"], "length": 8, "icon": "store", "region": "Old Quarter", "description": "A growing company with a full docket."},
    {"key": "restaurant_group", "name": "Restaurant group", "base_fee": 6_000, "reputation": 25, "tier": 1, "length": 7, "icon": "hospitality", "region": "Old Quarter", "description": "A beloved local group protecting leases, staff, and a fast-growing brand."},
    {"key": "wealthy_client", "name": "Private client", "base_fee": 18_000, "reputation": 32, "tier": 2, "requires": ["business_network"], "length": 8, "icon": "gem", "region": "Market Ward", "description": "High expectations, discreet matters, better fees."},
    {"key": "property_developer", "name": "Property developer", "base_fee": 24_000, "reputation": 34, "tier": 2, "length": 9, "icon": "property", "region": "Market Ward", "description": "A city builder balancing financing, neighbors, and a complicated approval map."},
    {"key": "regional_corporation", "name": "Regional corporation", "base_fee": 85_000, "reputation": 42, "tier": 3, "requires": ["senior_associate", "board_network"], "length": 10, "icon": "building", "region": "Civic Center", "description": "A serious company looking for outside counsel."},
    {"key": "hospital_network", "name": "Hospital network", "base_fee": 110_000, "reputation": 44, "tier": 3, "requires": ["civic_referral_council"], "length": 8, "icon": "health", "region": "Civic Center", "description": "A regional care network facing questions where precision and empathy both matter."},
    {"key": "film_studio", "name": "Film studio", "base_fee": 360_000, "reputation": 50, "tier": 4, "requires": ["entertainment_circle"], "length": 9, "icon": "media", "region": "Financial District", "description": "A bright-lights client with rights, talent, and a release date on the line."},
    {"key": "fintech_unicorn", "name": "Fintech unicorn", "base_fee": 450_000, "reputation": 52, "tier": 4, "length": 8, "icon": "tech", "region": "Financial District", "description": "A fast-moving platform that needs rules to scale as quickly as its code."},
    {"key": "regional_infrastructure", "name": "Infrastructure authority", "base_fee": 1_600_000, "reputation": 56, "tier": 5, "length": 10, "icon": "civic", "region": "Harbor Exchange", "description": "The bridges, ports, and public contracts that keep a whole region moving."},
    {"key": "sports_league", "name": "National sports league", "base_fee": 2_100_000, "reputation": 58, "tier": 5, "requires": ["entertainment_circle"], "length": 10, "icon": "sports", "region": "Harbor Exchange", "description": "Teams, media rights, labor rules, and a season that will not wait."},
    {"key": "national_corporation", "name": "National corporation", "base_fee": 7_000_000, "reputation": 62, "tier": 6, "requires": ["rainmaker", "national_gc_council"], "length": 10, "icon": "landmark", "region": "Midtown Crown", "description": "A national account that can transform the firm."},
    {"key": "energy_grid", "name": "National energy grid", "base_fee": 9_000_000, "reputation": 64, "tier": 6, "length": 9, "icon": "energy", "region": "Midtown Crown", "description": "A critical grid modernizing under regulatory, market, and climate pressure."},
    {"key": "global_conglomerate", "name": "Global conglomerate", "base_fee": 30_000_000, "reputation": 68, "tier": 7, "requires": ["international_network"], "length": 12, "icon": "globe", "region": "Embassy Row", "description": "A worldwide client relationship that reshapes the practice."},
    {"key": "sovereign_wealth_fund", "name": "Sovereign wealth fund", "base_fee": 38_000_000, "reputation": 70, "tier": 7, "requires": ["diplomatic_forum"], "length": 10, "icon": "sovereign", "region": "Embassy Row", "description": "Long-horizon investments crossing industries, borders, and generations."},
    {"key": "biotech_alliance", "name": "Global biotech alliance", "base_fee": 130_000_000, "reputation": 74, "tier": 8, "requires": ["global_exchange"], "length": 10, "icon": "health", "region": "Skyline Heights", "description": "Frontier medicine where patents, access, safety, and time all collide."},
    {"key": "megacap_platform", "name": "Megacap technology platform", "base_fee": 160_000_000, "reputation": 76, "tier": 8, "length": 12, "icon": "tech", "region": "Skyline Heights", "description": "A platform whose smallest policy choice reaches a billion people."},
    {"key": "central_bank", "name": "Central bank consortium", "base_fee": 540_000_000, "reputation": 79, "tier": 9, "requires": ["sovereign_council"], "length": 10, "icon": "bank", "region": "Sovereign Enclave", "description": "Institutions coordinating stability while every market studies each word."},
    {"key": "climate_compact", "name": "Planetary climate compact", "base_fee": 680_000_000, "reputation": 81, "tier": 9, "length": 10, "icon": "energy", "region": "Sovereign Enclave", "description": "A treaty-scale coalition turning climate promises into enforceable systems."},
    {"key": "quantum_consortium", "name": "Quantum industry consortium", "base_fee": 1_900_000_000, "reputation": 83, "tier": 10, "requires": ["innovation_compact"], "length": 12, "icon": "quantum", "region": "Innovation Arc", "description": "Frontier computing firms writing the rules for capabilities that barely have names."},
    {"key": "continental_union", "name": "Continental infrastructure union", "base_fee": 2_400_000_000, "reputation": 84, "tier": 10, "length": 10, "icon": "property", "region": "Innovation Arc", "description": "Cities and nations building shared transit, energy, and communications systems."},
    {"key": "oceanic_consortium", "name": "Oceanic cities consortium", "base_fee": 5_800_000_000, "reputation": 86, "tier": 11, "requires": ["oceanic_compact"], "length": 12, "icon": "ocean", "region": "Azure Coast", "description": "Floating cities defining governance for a changing coast."},
    {"key": "orbital_industries", "name": "Orbital industries group", "base_fee": 13_000_000_000, "reputation": 89, "tier": 12, "requires": ["orbital_bar"], "length": 12, "icon": "orbit", "region": "Aerospace Basin", "description": "Stations, launch systems, and habitats building the first durable off-world economy."},
    {"key": "lunar_settlement", "name": "Lunar settlement council", "base_fee": 31_000_000_000, "reputation": 92, "tier": 13, "requires": ["interworld_assembly"], "length": 14, "icon": "lunar", "region": "Lunar Gate", "description": "A new society asking old legal principles to work under an unfamiliar sky."},
    {"key": "planetary_assembly", "name": "Planetary assembly", "base_fee": 72_000_000_000, "reputation": 94, "tier": 14, "requires": ["interworld_assembly", "planetary_command"], "length": 15, "icon": "nexus", "region": "Celestial Crown", "description": "The most consequential client in the game: a civilization choosing rules for its shared future."},
]

# Character-driven clients sit alongside the institutional progression. Their
# shorter contracts and visible twists create meaningful choices within a tier.
CLIENTS += [
    {"key": "injury_victim", "name": "Injured bicycle courier", "base_fee": 900, "reputation": 8, "tier": 0, "length": 5, "icon": "health", "region": "Old Quarter", "archetype": "Injury claimant", "special": "Contingency finish · +2× contract bonus", "contract_bonus_mult": 2, "description": "A courier rebuilding a life after a dangerous delivery route and a denied claim."},
    {"key": "serial_plaintiff", "name": "Serial sidewalk plaintiff", "base_fee": 1_100, "reputation": 18, "tier": 0, "length": 4, "icon": "briefcase", "region": "Old Quarter", "archetype": "Repeat litigant", "special": "Rapid-fire 4-case contract", "description": "Knows every cracked curb in the district and arrives with three binders of prior pleadings."},
    {"key": "wrongfully_accused_driver", "name": "Wrongfully accused driver", "base_fee": 1_250, "reputation": 20, "tier": 0, "length": 6, "icon": "home", "region": "Old Quarter", "archetype": "Criminal defense", "special": "Protected retainer · 45% payout floor", "minimum_score_multiplier": .45, "description": "A rideshare driver whose borrowed car was linked to a robbery across town."},
    {"key": "scam_victims", "name": "Romance-scam survivors", "base_fee": 6_500, "reputation": 22, "tier": 1, "length": 6, "icon": "civic", "region": "Old Quarter", "archetype": "Fraud recovery", "special": "Recovery pool · +1× contract bonus", "contract_bonus_mult": 1, "description": "A determined group tracing money through shell accounts after the same invented romance."},
    {"key": "street_magician", "name": "Accused street magician", "base_fee": 7_500, "reputation": 24, "tier": 1, "length": 5, "icon": "media", "region": "Old Quarter", "archetype": "Theft defense", "special": "+10% intrigue premium", "payout_mult": 1.10, "description": "A theatrical performer accused of making a patron's antique watch disappear for good."},
    {"key": "tenant_organizer", "name": "Tenants' night-shift organizer", "base_fee": 8_000, "reputation": 26, "tier": 1, "length": 7, "icon": "property", "region": "Old Quarter", "archetype": "Housing rights", "special": "Community grant · 50% payout floor", "minimum_score_multiplier": .50, "description": "A hospital custodian organizing three buildings against an illegal mass eviction."},
    {"key": "alleged_art_forger", "name": "Alleged master art forger", "base_fee": 28_000, "reputation": 34, "tier": 2, "requires": ["private_investigator"], "length": 6, "icon": "media", "region": "Market Ward", "archetype": "White-collar defense", "special": "+15% authenticity premium", "payout_mult": 1.15, "description": "A charming restorer insists the impossible masterpiece is merely misunderstood provenance."},
    {"key": "true_crime_host", "name": "True-crime host under subpoena", "base_fee": 31_000, "reputation": 34, "tier": 2, "length": 5, "icon": "media", "region": "Market Ward", "archetype": "Media law", "special": "Short, premium contract", "description": "A famous host must protect sources without turning a cold case into another spectacle."},
    {"key": "serial_entrepreneur", "name": "Serially sued inventor", "base_fee": 34_000, "reputation": 36, "tier": 2, "length": 8, "icon": "tech", "region": "Market Ward", "archetype": "Patent defense", "special": "Loyalty-heavy 8-case docket", "description": "Every prototype works, every former partner sues, and every meeting begins with a new sketch."},
    {"key": "warehouse_survivors", "name": "Warehouse injury survivors", "base_fee": 38_000, "reputation": 36, "tier": 2, "length": 6, "icon": "health", "region": "Market Ward", "archetype": "Workplace injury", "special": "+2× contract close", "contract_bonus_mult": 2, "description": "Workers compare records after discovering the same safety system failed across three sites."},
    {"key": "city_hall_whistleblower", "name": "City Hall whistleblower", "base_fee": 125_000, "reputation": 42, "tier": 3, "length": 7, "icon": "civic", "region": "Civic Center", "archetype": "Public corruption", "special": "Reputation shield client", "reputation_guard": 1, "description": "A meticulous procurement analyst carries encrypted evidence of a contract-rigging scheme."},
    {"key": "class_action_survivors", "name": "Transit crash survivor class", "base_fee": 155_000, "reputation": 44, "tier": 3, "requires": ["civic_referral_council"], "length": 8, "icon": "health", "region": "Civic Center", "archetype": "Mass injury", "special": "+3× contract resolution", "contract_bonus_mult": 3, "description": "Dozens of passengers need one coherent case without losing their individual stories."},
    {"key": "accused_hacker", "name": "Teen hacker facing federal charges", "base_fee": 175_000, "reputation": 46, "tier": 3, "length": 6, "icon": "tech", "region": "Civic Center", "archetype": "Cybercrime defense", "special": "+15% technical premium", "payout_mult": 1.15, "description": "A gifted student found the vulnerability, reported it badly, and now faces a theory far larger than the facts."},
    {"key": "private_detective_agency", "name": "Private detective agency", "base_fee": 190_000, "reputation": 46, "tier": 3, "requires": ["private_investigator"], "length": 9, "icon": "briefcase", "region": "Civic Center", "archetype": "Professional liability", "special": "Long 9-file mystery docket", "description": "A rain-soaked agency brings surveillance disputes, missing heirs, and one file nobody will discuss."},
    {"key": "casino_magnate", "name": "Casino magnate", "base_fee": 520_000, "reputation": 50, "tier": 4, "length": 7, "icon": "gem", "region": "Financial District", "archetype": "Regulatory defense", "special": "+20% high-roller premium", "payout_mult": 1.20, "description": "A famously lucky owner faces a licensing fight involving algorithms, rivals, and a vanished compliance chief."},
    {"key": "crypto_founder", "name": "Crypto founder under investigation", "base_fee": 640_000, "reputation": 52, "tier": 4, "length": 8, "icon": "tech", "region": "Financial District", "archetype": "Financial crime defense", "special": "Volatile · +25% fee premium", "payout_mult": 1.25, "description": "A persuasive founder claims the missing reserves are locked, not gone; the transaction trail must decide."},
    {"key": "celebrity_divorce", "name": "Celebrity power-couple split", "base_fee": 580_000, "reputation": 52, "tier": 4, "requires": ["entertainment_circle"], "length": 5, "icon": "media", "region": "Financial District", "archetype": "Family and media law", "special": "Fast 5-case confidentiality sprint", "description": "Two global brands, one hidden songwriting catalog, and absolutely no appetite for a public filing."},
    {"key": "medical_device_victims", "name": "Medical-device injury coalition", "base_fee": 720_000, "reputation": 54, "tier": 4, "length": 8, "icon": "health", "region": "Financial District", "archetype": "Product liability", "special": "+3× contract resolution", "contract_bonus_mult": 3, "description": "Patients across the region discover that their supposedly rare complications share a design flaw."},
    {"key": "pharma_whistleblower", "name": "Pharma trial whistleblower", "base_fee": 2_500_000, "reputation": 57, "tier": 5, "length": 7, "icon": "health", "region": "Harbor Exchange", "archetype": "Corporate fraud", "special": "+25% sealed-evidence premium", "payout_mult": 1.25, "description": "A clinical researcher alleges that inconvenient trial results were quietly reclassified."},
    {"key": "union_reformer", "name": "Reform union president", "base_fee": 2_800_000, "reputation": 58, "tier": 5, "length": 9, "icon": "civic", "region": "Harbor Exchange", "archetype": "Labor racketeering defense", "special": "Protected 55% payout floor", "minimum_score_multiplier": .55, "description": "A reform leader targeted by old allies needs to prove the new books are clean."},
    {"key": "stolen_art_nations", "name": "Stolen-art recovery alliance", "base_fee": 3_100_000, "reputation": 60, "tier": 5, "requires": ["international_network"], "length": 8, "icon": "sovereign", "region": "Harbor Exchange", "archetype": "Cultural property", "special": "+2× recovery bonus", "contract_bonus_mult": 2, "description": "Museums and nations trace a celebrated collection through war, shell donors, and forged export papers."},
    {"key": "market_manipulation_suspect", "name": "Market-manipulation suspect", "base_fee": 11_000_000, "reputation": 63, "tier": 6, "length": 7, "icon": "bank", "region": "Midtown Crown", "archetype": "Securities defense", "special": "+25% complexity premium", "payout_mult": 1.25, "description": "A legendary short seller says the suspicious timing came from research, not an inside source."},
    {"key": "serial_patent_plaintiff", "name": "Serial patent plaintiff", "base_fee": 14_000_000, "reputation": 65, "tier": 6, "length": 5, "icon": "tech", "region": "Midtown Crown", "archetype": "Repeat plaintiff", "special": "Five-case licensing blitz", "description": "A tiny company owns one astonishing patent and has sued nearly everyone who owns a screen."},
    {"key": "protected_witness", "name": "Protected cartel accountant", "base_fee": 16_000_000, "reputation": 66, "tier": 6, "requires": ["cybersecurity_counsel"], "length": 6, "icon": "briefcase", "region": "Midtown Crown", "archetype": "Organized-crime cooperation", "special": "+30% danger premium", "payout_mult": 1.30, "description": "An accountant with perfect recall offers the ledger of a criminal network in exchange for safety and a fair deal."},
    {"key": "exiled_dissident", "name": "Exiled investigative publisher", "base_fee": 44_000_000, "reputation": 69, "tier": 7, "requires": ["diplomatic_forum"], "length": 7, "icon": "media", "region": "Embassy Row", "archetype": "Human-rights defense", "special": "Reputation shield · +20% premium", "payout_mult": 1.20, "reputation_guard": 2, "description": "A publisher pursued across borders needs protection for sources and a lawful path home."},
    {"key": "sanctions_investigator", "name": "Renegade sanctions investigator", "base_fee": 52_000_000, "reputation": 71, "tier": 7, "length": 8, "icon": "sovereign", "region": "Embassy Row", "archetype": "International enforcement", "special": "+25% cross-border premium", "payout_mult": 1.25, "description": "A former regulator follows a ghost fleet through flags, insurers, and companies that exist only on paper."},
    {"key": "deepfake_victims", "name": "Deepfake extortion survivors", "base_fee": 180_000_000, "reputation": 75, "tier": 8, "length": 7, "icon": "tech", "region": "Skyline Heights", "archetype": "Technology abuse", "special": "+3× recovery resolution", "contract_bonus_mult": 3, "description": "Public figures and ordinary families unite against one sophisticated synthetic-media extortion ring."},
    {"key": "rogue_ai_lab", "name": "Rogue AI lab board", "base_fee": 220_000_000, "reputation": 77, "tier": 8, "requires": ["global_exchange"], "length": 9, "icon": "quantum", "region": "Skyline Heights", "archetype": "Corporate investigation", "special": "High-risk · +30% premium", "payout_mult": 1.30, "description": "A divided board discovers its celebrated lab ran an unauthorized deployment with worldwide effects."},
    {"key": "ghost_fleet_owner", "name": "Alleged ghost-fleet owner", "base_fee": 760_000_000, "reputation": 80, "tier": 9, "length": 6, "icon": "ocean", "region": "Sovereign Enclave", "archetype": "Sanctions defense", "special": "+35% sovereign-risk premium", "payout_mult": 1.35, "description": "A shipping billionaire denies controlling the tankers that every investigator insists are his."},
    {"key": "autonomous_city", "name": "Autonomous city accused of bias", "base_fee": 2_700_000_000, "reputation": 84, "tier": 10, "length": 10, "icon": "quantum", "region": "Innovation Arc", "archetype": "Algorithmic civil rights", "special": "+4× systemic resolution", "contract_bonus_mult": 4, "description": "A smart city must answer whether its invisible systems quietly divided opportunity by neighborhood."},
    {"key": "orbital_salvager", "name": "Accused orbital salvager", "base_fee": 15_000_000_000, "reputation": 90, "tier": 12, "length": 6, "icon": "orbit", "region": "Aerospace Basin", "archetype": "Space-property defense", "special": "+40% frontier premium", "payout_mult": 1.40, "description": "A daring captain calls it abandoned equipment; three nations call it the first theft in orbit."},
    {"key": "lunar_injury_collective", "name": "Lunar mine injury collective", "base_fee": 36_000_000_000, "reputation": 92, "tier": 13, "length": 8, "icon": "lunar", "region": "Lunar Gate", "archetype": "Off-world mass injury", "special": "+5× contract resolution", "contract_bonus_mult": 5, "description": "Miners injured far from Earth ask which world's safety promise actually governs."},
]

# Public-interest matters trade some immediate cash for unusually strong career
# standing. Their loss protection keeps a difficult LSAT question from making
# service-minded play feel punitive.
#
# The fee is this share of the market rate for the same tier. Priced with every
# other client rather than authored by hand, because a hand-authored figure
# silently stops meaning anything the moment the economy is rescaled: these
# clients were the highest-paying matters on the board at every tier until this
# became a derived number, which made "take the best-paying client" and "take
# the pro bono client" the same instruction.
PRO_BONO_FEE_SHARE = .55
CLIENTS += [
    {"key": "eviction_defense_clinic", "name": "Eviction Defense Clinic", "base_fee": 650, "reputation": 8, "tier": 0, "length": 5, "icon": "home", "region": "Old Quarter", "archetype": "Pro bono housing defense", "matter_type": "pro_bono", "reputation_win_bonus": 2, "reputation_loss_cap": .5, "reputation_guard": 3.5, "special": "PRO BONO · +2 Reputation on a win · losses capped at −0.5", "description": "Ada Mercer's overflow list begins with families facing lockouts before their hearings."},
    {"key": "youth_record_project", "name": "Second-Chance Youth Project", "base_fee": 3_200, "reputation": 22, "tier": 1, "length": 6, "icon": "civic", "region": "Old Quarter", "archetype": "Pro bono record clearing", "matter_type": "pro_bono", "reputation_win_bonus": 3, "reputation_loss_cap": .5, "reputation_guard": 3.5, "special": "PRO BONO · +3 Reputation on a win · protected loss", "description": "Young adults seek to clear old records before a mistake becomes a lifetime sentence."},
    {"key": "innocence_archive_client", "name": "Innocence Archive", "base_fee": 14_000, "reputation": 32, "tier": 2, "length": 7, "icon": "briefcase", "region": "Market Ward", "archetype": "Pro bono innocence review", "matter_type": "pro_bono", "reputation_win_bonus": 4, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +4 Reputation on a win · protected loss", "description": "Damaged transcripts and a recanted identification may be all that stand between a prisoner and freedom."},
    {"key": "night_nurses_coalition", "name": "Night Nurses Coalition", "base_fee": 62_000, "reputation": 42, "tier": 3, "length": 6, "icon": "health", "region": "Civic Center", "archetype": "Pro bono whistleblower protection", "matter_type": "pro_bono", "reputation_win_bonus": 4, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +4 Reputation on a win · protected loss", "description": "Nurses who exposed a closed ward need counsel before the hospital board makes them disappear from the schedule."},
    {"key": "journalist_defense_fund", "name": "Free Press Defense Fund", "base_fee": 280_000, "reputation": 51, "tier": 4, "length": 7, "icon": "media", "region": "Financial District", "archetype": "Pro bono source protection", "matter_type": "pro_bono", "reputation_win_bonus": 5, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +5 Reputation on a win · protected loss", "description": "Local reporters face a coordinated subpoena campaign after tracing Sterling money into City Hall."},
    {"key": "witness_family_network", "name": "Witness Family Network", "base_fee": 1_100_000, "reputation": 57, "tier": 5, "length": 7, "icon": "civic", "region": "Harbor Exchange", "archetype": "Pro bono witness protection", "matter_type": "pro_bono", "reputation_win_bonus": 5, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +5 Reputation on a win · protected loss", "description": "Families displaced by organized-crime testimony need lawful status, safe housing, and someone who keeps promises."},
    {"key": "refugee_appeals_collective", "name": "Refugee Appeals Collective", "base_fee": 5_000_000, "reputation": 66, "tier": 7, "length": 8, "icon": "globe", "region": "Embassy Row", "archetype": "Pro bono human-rights appeals", "matter_type": "pro_bono", "reputation_win_bonus": 6, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +6 Reputation on a win · protected loss", "description": "A volunteer corridor races contradictory deadlines to keep families from being returned to danger."},
    {"key": "vanishing_islands_youth", "name": "Vanishing Islands Youth Assembly", "base_fee": 170_000_000, "reputation": 77, "tier": 9, "length": 8, "icon": "ocean", "region": "Sovereign Enclave", "archetype": "Pro bono climate justice", "matter_type": "pro_bono", "reputation_win_bonus": 7, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +7 Reputation on a win · protected loss", "description": "Young delegates ask the world's wealthiest institutions to turn relocation promises into enforceable rights."},
    {"key": "neighborhood_data_union", "name": "Neighborhood Data Union", "base_fee": 600_000_000, "reputation": 83, "tier": 10, "length": 9, "icon": "quantum", "region": "Innovation Arc", "archetype": "Pro bono algorithmic appeal", "matter_type": "pro_bono", "reputation_win_bonus": 7, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +7 Reputation on a win · protected loss", "description": "Residents challenge a city model that quietly decided who deserved work, credit, and safe streets."},
    {"key": "lunar_workers_collective", "name": "Far-Side Workers Collective", "base_fee": 7_500_000_000, "reputation": 91, "tier": 13, "length": 10, "icon": "lunar", "region": "Lunar Gate", "archetype": "Pro bono off-world labor", "matter_type": "pro_bono", "reputation_win_bonus": 8, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +8 Reputation on a win · protected loss", "description": "The first off-world union asks which human guarantees survive the distance from Earth."},
]

def _round_game_amount(value: float) -> int:
    """Round economy values to readable two-significant-digit prices."""
    value = max(1, round(value))
    magnitude = 10 ** max(0, len(str(value)) - 2)
    return max(1, round(value / magnitude) * magnitude)


def _format_game_money(value: int) -> str:
    for threshold, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
        if value >= threshold:
            scaled = value / threshold
            return f"{scaled:.1f}".rstrip("0").rstrip(".") + suffix
    return f"{value:,}"


def _tier_effort_scale(tier: int) -> float:
    """Case-cost multiplier applied to everything bought at ``tier``.

    See TIER_EFFORT_BASE: this is the single knob that decides how long the
    campaign runs, and it is deliberately the same knob for headquarters and
    catalog purchases so the two never drift apart.
    """
    return TIER_EFFORT_BASE + TIER_EFFORT_STEP * tier


def _case_target_for_tier(tier: int) -> int:
    """Expected cash from one solid correct case at the current firm tier."""
    if tier < len(FIRM_TIERS) - 1:
        tier_cost = FIRM_TIERS[tier + 1]["cost"]
    else:
        # There is no "next" milestone past the last defined firm tier, so
        # extrapolate using the same growth rate as the final known jump.
        # Reusing FIRM_TIERS[-1]["cost"] outright made this tier's target
        # identical to the prior tier's, which flattened (and could even
        # invert) client fees right at the top of the progression.
        last_cost = FIRM_TIERS[-1]["cost"]
        prior_cost = FIRM_TIERS[-2]["cost"] if len(FIRM_TIERS) > 1 else last_cost
        growth_ratio = (last_cost / prior_cost) if prior_cost else 1
        tier_cost = last_cost * growth_ratio
    # Headquarters cost twice as much without inflating case fees or every
    # mandatory catalog purchase along with them, and the effort scale is what
    # makes a late headquarters a campaign rather than an afternoon.
    milestone_cases = (
        TARGET_CASES_PER_MILESTONE * FIRM_TIER_COST_MULTIPLIER * _tier_effort_scale(tier)
    )
    return round(tier_cost / milestone_cases)


def _expected_firm_multiplier(tier: int) -> float:
    """The payout multiplier a player realistically fights a tier-``tier`` case with.

    Client fees were priced against ``1 + tier * .06`` alone, as if the office
    were the only thing that paid. It is not: every upgrade, hire, and
    acquisition also adds a payout percentage, and tier advancement *requires*
    owning all of them from earlier tiers. By the top of the ladder the real
    multiplier is around 6.4x rather than the assumed 1.8x, so late clients paid
    three to four times what the catalog thought they did and each tier funded
    the next several times over — the compounding that collapsed the whole
    progression. Earlier tiers' assets are certainly owned; this tier's are
    bought across the tier, so they count half.
    """
    total = 1 + tier * .06
    for item in ASSETS:
        if item["type"] in UNBALANCED_ASSET_TYPES:
            continue
        if item["tier"] < tier:
            total += float(item.get("payout_mult", 0))
        elif item["tier"] == tier:
            total += float(item.get("payout_mult", 0)) * .5
    return total


def _replace_case_payout_benefit(item: dict, percentage: int) -> None:
    parts = [part.strip() for part in item["benefit"].split("·")]
    secondary = [part for part in parts if "payout" not in part.lower()]
    item["benefit"] = " · ".join([f"+{percentage}% case payout", *secondary])


# What each contract-bonus asset was authored to pay, as a multiple of the fee,
# when a sitting was ten questions. Filled in by `_rebalance_asset_catalog` as it
# overwrites them, for the same reason as `LEGACY_CONTRACT_LENGTHS`: the authored
# figure is destroyed at import and it is the only thing the rescale can be
# checked against. See
# `test_sitting_scale.test_a_contract_bonus_is_worth_the_same_per_question`.
LEGACY_CONTRACT_BONUS_MULTS: dict[str, float] = {}


def _rebalance_asset_catalog() -> None:
    """Give every purchase durable value and price it in successful cases."""
    for item in ASSETS:
        if item["type"] in UNBALANCED_ASSET_TYPES:
            # Decor carries no effects to balance, but it still has to be priced
            # against the tier it sits in or it stops being a choice.
            #
            # The effort scale belongs here for the same reason it belongs on
            # the functional purchase below: `decor_cases` is a fraction of what
            # a real purchase at this tier costs, and a real purchase is
            # `target_questions * _tier_effort_scale`. It was omitted while the
            # scale sat near 1.0, where the mistake was invisible; repacing the
            # ladder turned it into an 82% price cut on every cosmetic, which is
            # how it was found.
            if "decor_cases" in item:
                item["cost"] = _round_game_amount(
                    _case_target_for_tier(item["tier"])
                    * float(item["decor_cases"])
                    * _tier_effort_scale(item["tier"])
                )
            continue
        tier = item["tier"]
        original_payout = float(item.get("payout_mult", 0))
        base_percentage = 2 + tier // 3
        if original_payout:
            payout_percentage = min(10, base_percentage + max(1, round(original_payout * 5)))
        else:
            # Unlocks, passive specialists, and support hires still improve the
            # active loop, so none becomes a dead-end purchase after its gate.
            payout_percentage = min(8, base_percentage)
        item["payout_mult"] = payout_percentage / 100
        _replace_case_payout_benefit(item, payout_percentage)

        target = _case_target_for_tier(tier)
        if "staff_flat" in item:
            item["staff_flat"] = _round_game_amount(target * .10)
            parts = [part.strip() for part in item["benefit"].split("·") if "per active case" not in part.lower()]
            item["benefit"] = " · ".join([*parts, f"+${_format_game_money(item['staff_flat'])} flat case bonus"])
        if "passive_hourly" in item:
            passive_rate = .05 if item["type"] == "rival" else .04
            item["passive_hourly"] = _round_game_amount(target * passive_rate)
            parts = [
                part.strip()
                for part in item["benefit"].split("·")
                if "/hour" not in part.lower() and "per hour" not in part.lower()
            ]
            item["benefit"] = " · ".join([*parts, f"${_format_game_money(item['passive_hourly'])}/hour passive"])
        if item.get("contract_bonus_mult"):
            # A contract bonus is a flat multiple of the fee paid *once per
            # contract*, so what it is worth per question is `bonus / length`.
            # Shortening contracts with `_rescale_contract_lengths` therefore
            # multiplies this asset's value by the same ratio it divides the
            # length by -- and these assets are priced in cases below, at prices
            # that did not move, so their value may not move either.
            #
            # This is not a rounding-order detail. It is the entire drift
            # between the old ladder and the new one: with lengths rescaled and
            # this left alone the campaign came out 2.2% shorter (2,041 played
            # cases against 2,086), and it is the only thing in this change that
            # moved money at all. Scaled with the sitting, it is 2,085.
            #
            # Eight assets carry it, one to three each, and at a six-question
            # sitting they read 0.6 to 1.8. The decimal is the honest number: the
            # bonus is smaller because contracts now close nearly twice as often.
            LEGACY_CONTRACT_BONUS_MULTS[item["key"]] = item["contract_bonus_mult"]
            item["contract_bonus_mult"] = round(
                float(item["contract_bonus_mult"]) * SITTING_QUESTIONS / LEGACY_SITTING_QUESTIONS, 2
            )
            parts = [
                part.strip()
                for part in item["benefit"].split("·")
                if "contract" not in part.lower()
            ]
            bonus = f"{item['contract_bonus_mult']:g}"
            item["benefit"] = " · ".join([*parts, f"+{bonus}× contract bonus"])

        secondary_effects = sum(
            bool(item.get(key))
            for key in ("passive_hourly", "staff_flat", "storage_hours", "streak_bonus_cap", "contract_bonus_mult", "reputation_guard")
        )
        if item["type"] == "connection":
            secondary_effects += 1
        strength_premium = max(0, payout_percentage - base_percentage) * .18
        target_questions = min(5.0, 3.0 + strength_premium + secondary_effects * .32)
        if item["type"] == "rival":
            target_questions = 5.0
        item["cost"] = _round_game_amount(target * target_questions * _tier_effort_scale(tier))


def _rebalance_client_catalog() -> None:
    """Equalize expected commercial value while preserving client play styles."""
    solid_score_multiplier = 1.20
    for client in CLIENTS:
        tier = client["tier"]
        firm_multiplier = _expected_firm_multiplier(tier)
        contract_multiplier = 2 + float(client.get("contract_bonus_mult", 0))
        average_value_factor = (
            solid_score_multiplier * firm_multiplier * float(client.get("payout_mult", 1))
            + contract_multiplier / max(1, client["length"])
        )
        share = PRO_BONO_FEE_SHARE if client.get("matter_type") == "pro_bono" else 1
        client["base_fee"] = _round_game_amount(
            _case_target_for_tier(tier) * share / average_value_factor
        )


# How much of a client's value waits until the contract closes, from the
# steadiest client at a tier to the most speculative one.
CLIENT_CLOSE_SHARE_RANGE = (.08, .22)


def _shape_client_contracts() -> None:
    """Give clients different shapes without giving them different values.

    `_rebalance_client_catalog` equalises expected value across every client at
    a tier by construction, which is what makes a client a play-style choice
    rather than an income choice. The problem was that there was very little play
    style left to choose: `contract_bonus_mult` was 0 for 58 of 69 clients, and
    the 13 that carry a `payout_mult` premium are compensated by a proportionally
    lower `base_fee`, so even that reduces to the same money arriving under a
    different name. The only real separator left was contract length, and its
    effect shrank all game (below).

    The axis chosen here is *when the money arrives*, not how much. A client's
    value is split between the per-case fee, which is banked the moment a case is
    won, and the contract close, which is a lump you only collect by finishing
    the contract. Longest contract at a tier is the most speculative and shortest
    is the steadiest, so the `length` the catalog already authored for flavour --
    a walk-in at 8, a serial plaintiff at 4 -- becomes the thing that decides the
    shape instead of being cosmetic.

    Why it is a real decision and not just variance: the close is forfeitable.
    `contract.cases_remaining` only falls on a decisive win, and if reputation
    slips the client goes on hold and the walk-in bills instead, stranding the
    progress. So a speculative contract is a bet that you will hold form long
    enough to close it -- which is exactly what streak standing now protects.
    Steady clients are correct when your reputation is fragile; speculative ones
    are correct when a streak is holding your floor up.

    Why it does not move the curve: `payout_mult`, `contract_bonus_mult` and
    `length` are all inputs to `average_value_factor`, so `base_fee` is re-derived
    against whatever this writes and expected value per case lands back on
    `_case_target_for_tier`. This must therefore run before the rebalance.

    It also fixes a collapse. The close was worth 16-39% of a tier-0 client and
    fell to under 4% by tier 9, because the old close was a flat `2 / length`
    against a firm multiplier that grows all game. The shape simply evaporated
    as the player progressed. Solving for a target share instead of a flat bonus
    keeps the choice alive at every tier.
    """
    by_tier: dict[int, list[dict]] = {}
    for client in CLIENTS:
        by_tier.setdefault(client["tier"], []).append(client)
    steadiest, most_speculative = CLIENT_CLOSE_SHARE_RANGE
    for tier, group in by_tier.items():
        firm_multiplier = _expected_firm_multiplier(tier)
        order = sorted(group, key=lambda client: (client["length"], client["key"]))
        for position, client in enumerate(order):
            target = (
                steadiest if len(order) == 1
                else steadiest + (most_speculative - steadiest) * position / (len(order) - 1)
            )
            per_case = 1.20 * firm_multiplier * float(client.get("payout_mult", 1))
            length = max(1, client["length"])
            bonus = round(max(0.0, per_case * target / (1 - target) * length - 2), 2)
            client["contract_bonus_mult"] = bonus
            # The realised share, not the target. At tier 0 the firm multiplier
            # is small enough that the hardcoded `+2` base contract multiplier
            # already exceeds the target on its own and the bonus clamps to zero,
            # so the two can differ. Publishing what actually happens keeps the
            # card honest instead of printing an intention.
            per_close = (2 + bonus) / length
            client["close_share_bps"] = round(per_close / (per_case + per_close) * 10_000)


def _rescale_contract_lengths() -> None:
    """Re-express every contract in sittings rather than in ten-question runs.

    `length` counts decisive wins, so it is denominated in questions and nothing
    about it is wrong when the sitting shortens -- which is exactly why it has to
    move. A walk-in closing in eight wins was a little over one ten-question
    sitting; left alone at a six-question sitting it becomes nearly two, and the
    progress bar on the client card advances half as far per run. The player
    reads that as the contract having got longer, because from where they are
    sitting it has.

    So the authored lengths are treated as what they were authored as -- a
    fraction of a sitting -- and re-expressed against the sitting the game
    actually serves. A contract that used to take about one run still takes about
    one run. It moves *down*, never up: shortening the run must not turn a
    three-win contract into six chores.

    This cannot move the pace band, and that is by construction rather than by
    luck. `length` is an input to `average_value_factor`, so `_rebalance_client_
    catalog` re-derives `base_fee` against whatever this writes and expected
    value per case lands back on `_case_target_for_tier`. It must therefore run
    before `_shape_client_contracts`, which reads `length` to decide the close
    share, and before the rebalance, which reads both.

    The floor is three wins. Below that the hardcoded `+2` base contract
    multiplier is a large enough share of a short contract's value that
    `_shape_client_contracts` clamps its bonus to zero at the low tiers and the
    close share stops tracking the target -- a distortion the catalog already
    has at length four and which gets worse the shorter contracts get.
    """
    for client in CLIENTS:
        LEGACY_CONTRACT_LENGTHS[client["key"]] = client["length"]
        client["length"] = _in_sittings(client["length"], minimum=3)


# What each contract was authored to take, in wins, when a sitting was ten
# questions. Filled in by `_rescale_contract_lengths` as it overwrites them.
#
# Kept because the authored figure is otherwise destroyed at import and it is
# the only thing the rescale can be checked against. The check that matters is
# one-directional and is the user's own condition on this change: a contract
# that used to take three wins must not become six chores, so no contract may
# come out of the rescale longer than it went in. See
# `test_sitting_scale.test_no_contract_got_longer_when_the_run_got_shorter`.
LEGACY_CONTRACT_LENGTHS: dict[str, int] = {}


_CONTRACT_LENGTH_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15,
}
# "Rapid-fire 4-case contract", "Long 9-file mystery docket". The count and the
# noun it counts, in the two spellings the catalog uses.
_CONTRACT_LENGTH_CLAIM = re.compile(
    r"\b(\d+|" + "|".join(_CONTRACT_LENGTH_WORDS) + r")(-)(case|file)\b",
    re.IGNORECASE,
)


def _restate_contract_length_copy() -> None:
    """Rewrite the client-card copy that quotes a contract length in words.

    Four clients describe themselves by their length -- "Fast 5-case
    confidentiality sprint", "Loyalty-heavy 8-case docket", "Long 9-file mystery
    docket", "Five-case licensing blitz" -- and none of them contains any of the
    words `_drop_stale_contract_copy` looks for, so they survive it and would
    quietly start lying the moment `_rescale_contract_lengths` moves the number.

    Restated rather than deleted, unlike the contract-bonus claims. Those quoted
    a multiplier the card draws as a bar anyway; these carry the client's whole
    character ("rapid-fire", "loyalty-heavy", "long"), and a docket that says it
    is long should still say so with the right number beside it.
    """
    for client in CLIENTS:
        special = str(client.get("special", ""))
        if not special:
            continue
        client["special"] = _CONTRACT_LENGTH_CLAIM.sub(
            lambda match: f"{client['length']}{match.group(2)}{match.group(3)}",
            special,
        )


def _drop_stale_contract_copy() -> None:
    """Strip the hand-written contract-close claims that `_shape_client_contracts` invalidates.

    Eleven clients carried copy like "+3× contract resolution" or "Contingency
    finish · +2× contract bonus" that quoted `contract_bonus_mult` directly. That
    field is now computed, so those clauses would silently start lying. Same
    treatment `_describe_connection_unlocks` gives connections: split on the
    separator the copy already uses and drop the clause that makes the claim.

    Nothing is generated to replace them. The split between fee and close is a
    proportion, and the client card draws it as a bar; a sentence saying the same
    thing next to the bar would be the redundant text this screen has too much of
    already. The flavour clauses -- "PRO BONO · +5 Reputation on a win",
    "Volatile · +25% fee premium" -- describe fields this does not touch and are
    kept.
    """
    quoted = ("contract", "resolution", "recovery bonus", "contingency")
    for client in CLIENTS:
        kept = [
            part.strip()
            for part in str(client.get("special", "")).split("·")
            if part.strip() and not any(word in part.lower() for word in quoted)
        ]
        client["special"] = " · ".join(kept)


_rebalance_asset_catalog()
# Order matters and is asserted by test_game_catalog: lengths are re-expressed
# first, then the copy that quotes them, then the close shape that reads them,
# then the fees that are solved against all three.
_rescale_contract_lengths()
_restate_contract_length_copy()
_shape_client_contracts()
_drop_stale_contract_copy()
_rebalance_client_catalog()
CLIENTS.sort(key=lambda client: (client["tier"], client["base_fee"], client["name"]))

ASSET_BY_KEY = {item["key"]: item for item in ASSETS}
CLIENT_BY_KEY = {item["key"]: item for item in CLIENTS}


# ---------------------------------------------------------------------------
# Standing counsel (map districts)
# ---------------------------------------------------------------------------
#
# A firm does not buy land, it buys standing. Taking a district means signing
# its institutions -- the courthouse's duty roster, a market's traders, a port
# authority -- to a standing appointment: the firm is who they call first.
#
# What that is worth, exactly, is the two effects below and nothing else: being
# a district's default counsel is what a reputation floor *is*, and a branch
# presence you are already paid to keep is what offsets the lease. It used to
# say here, and on screen, that every routine matter in the district then
# arrives at your door. It does not. Districts appear nowhere in the session or
# story code, no docket is district-flavoured, and the copy has been corrected
# rather than the mechanic invented: the economy is tuned so that three to six
# cases buy one upgrade, and a second source of matters is not a wording fix.
# If it is ever built, this is the comment to come back to.
#
# The word is "counsel" throughout, never "retainer". A *client* retainer is a
# different thing in this game and pays the per-case fee; a district
# appointment pays no fee at all. The two were both called retainers, in the
# same tab, which is the likeliest source of the "am I taking up cases or
# receiving them?" confusion.
#
# This deliberately does not overlap the rival system. A rival acquisition is a
# discrete, story-gated move against a *named competitor* that transfers their
# payout multiplier and passive income to you and is priced at a full five
# cases. An appointment is ambient, cheap, and buys no payout at all: it buys
# standing and overhead relief. One is conquest, the other is coverage.

TERRITORY_REGIONS: list[dict] = [
    {"key": "city", "name": "Old Quarter", "tiers": (0, 4), "seat": "the Quarter Courthouse"},
    {"key": "nation", "name": "The Circuit", "tiers": (5, 6), "seat": "the county seat"},
    {"key": "ocean", "name": "Treaty Sea", "tiers": (7, 9), "seat": "the free harbour court"},
    {"key": "continent", "name": "Sovereign Arc", "tiers": (10, 11), "seat": "the sovereign assembly"},
    {"key": "orbit", "name": "Global Compact", "tiers": (12, 14), "seat": "the compact registry"},
]
TERRITORY_REGION_BY_KEY = {region["key"]: region for region in TERRITORY_REGIONS}

# Total standing every district in the game is worth between them, plus the
# per-region bonus for a clean sweep. Both numbers are small on purpose: see
# `_career_floor` for the ceiling that stops standing reaching the last rungs.
TERRITORY_STANDING_POOL = 13.0
TERRITORY_REGION_SWEEP_STANDING = 1.0
TERRITORY_STANDING_CAP = TERRITORY_STANDING_POOL + TERRITORY_REGION_SWEEP_STANDING * len(TERRITORY_REGIONS)
# Standing may lift the reputation floor to here and no further. Everything
# above it -- the 91-reputation pro bono work and the 94-reputation final
# headquarters -- stays payable only in casework.
TERRITORY_STANDING_FLOOR_CEILING = 90.0
# Holding every district retires the office lease entirely. Rent is a small
# sink (a fraction of one case per day), so this is a legible reward rather
# than an economic lever.
TERRITORY_RENT_RELIEF_POOL_BPS = 10_000

# What the entire counsel board costs, in successful cases, and therefore the
# only number that decides how much this mechanic lengthens the campaign.
# Districts are priced *out* of this budget rather than each being priced on
# its own, so the mechanic's total cost cannot drift as districts are added.
#
# Priced against what the board *pays back*, which is the only comparison that
# survives a repacing, because only one side of it is quoted in cases. Rent is
# absolute currency charged per day, and repacing the ladder multiplied the
# days in a campaign by 5.6 without touching the daily figure. Retiring the
# lease is what a full sweep buys, so the sweep's value rose 5.6x while its
# price -- fixed in cases -- did not move at all. At the 34 this carried
# through the repacing, rent relief alone repaid 70% of the board before the 18
# points of standing were counted: an optional mechanic that is very nearly
# free is not a choice, it is a chore with a reward attached.
#
# At 65 the board costs 61.9 played cases (3.6 hours, 3.0% of the campaign) and
# refunds 24.3 in rent, so it is 39% self-financing and nets out at 37.7 cases.
# That is a real commitment that still clearly repays a player who wants the
# map, which is what an optional board should be.
#
# 65 rather than the ~167 that holding the old 8% share would require. Share is
# the wrong anchor: 8% of today's campaign is 9.3 hours, which makes an
# optional side board into a second campaign. What was authored was a
# proportion of the *ladder's* difficulty, and 3% of it buys the whole map.
#
# The standing it also buys cannot reach the top of the ladder by design:
# TERRITORY_STANDING_FLOOR_CEILING is 90 and the final headquarters needs 94,
# so no amount of map play skips a rung.
TERRITORY_TOTAL_CASE_BUDGET = 65.0

# `cases` is a relative weight, not a price. Costs are apportioned out of
# TERRITORY_TOTAL_CASE_BUDGET below, scaled by tier effort so a late district
# still reads as a larger commitment than an early one.
_DISTRICTS: list[dict] = [
    # -- Old Quarter (tiers 0-4) ------------------------------------------
    {"key": "chancery_row", "region": "city", "name": "Chancery Row", "landmark": "city-highstreet", "tier": 0, "reputation": 0, "cases": .40, "counsel": "the shopkeepers' association", "description": "Two rows of trade counters that have never had counsel of their own. Every lease dispute on the street starts here."},
    {"key": "coopers_market", "region": "city", "name": "Cooper's Market", "landmark": "city-market", "tier": 0, "reputation": 14, "cases": .45, "counsel": "the market traders", "description": "Weights, licences, and standing feuds. Dull work, but it is the first place in the Quarter that says your name without prompting."},
    {"key": "quarter_courthouse", "region": "city", "name": "Quarter Courthouse", "landmark": "city-court", "tier": 1, "reputation": 22, "cases": .70, "counsel": "the duty roster", "description": "A seat on the duty roster means the clerk hands you the day's unassigned matters. Nothing else in the Quarter carries the same weight."},
    {"key": "wool_hall_yard", "region": "city", "name": "Wool Hall Yard", "landmark": "city-wool-hall", "tier": 1, "reputation": 24, "cases": .50, "counsel": "the exchange floor", "description": "The old cloth exchange still arbitrates its own contracts. Sit in the corner long enough and it becomes your corner."},
    {"key": "guild_schoolhouse", "region": "city", "name": "Guild Schoolhouse", "landmark": "city-school", "tier": 2, "reputation": 32, "cases": .50, "counsel": "the apprenticeship board", "description": "Indentures, disputes, and the occasional expulsion appeal. It also puts your name in front of everyone the Quarter will be run by in a decade."},
    {"key": "quarter_halt", "region": "city", "name": "Old Quarter Halt", "landmark": "city-station", "tier": 2, "reputation": 34, "cases": .55, "counsel": "the stationmaster", "description": "Freight claims, injured porters, and a schedule nobody can read. Steady, unglamorous, and always there."},
    {"key": "millrace_wharf", "region": "city", "name": "Millrace Wharf", "landmark": "city-wharf", "tier": 3, "reputation": 42, "cases": .65, "counsel": "the wharfingers", "description": "Where the Quarter's goods actually change hands, and where its contracts actually get broken."},
    {"key": "coal_yard", "region": "city", "name": "The Coal Yard", "landmark": "city-goods", "tier": 3, "reputation": 43, "cases": .50, "counsel": "the haulage co-operative", "description": "Nobody wants the coal yard. That is precisely why holding it makes people assume you hold everything else."},
    {"key": "millrace_canal", "region": "city", "name": "Millrace Canal", "landmark": "city-canal", "tier": 4, "reputation": 50, "cases": .65, "counsel": "the navigation trust", "description": "Water rights predate every other claim in the Quarter and outrank most of them. The trust has needed proper counsel for thirty years."},
    {"key": "quarter_green", "region": "city", "name": "The Quarter Green", "landmark": "city-green", "tier": 4, "reputation": 50, "cases": .45, "counsel": "the parish board", "description": "Public land, public tempers, public record. Every hearing here is attended by people who talk."},
    {"key": "ward_gardens", "region": "city", "name": "Ward Gardens", "landmark": "city-ward-green", "tier": 4, "reputation": 52, "cases": .45, "counsel": "the ward committee", "description": "The last address in the Quarter that still asks who your family is before it asks what you charge."},
    # -- The Circuit (tiers 5-6) ------------------------------------------
    {"key": "fenwick_turnpike", "region": "nation", "name": "Fenwick Turnpike", "landmark": "nation-turnpike", "tier": 5, "reputation": 56, "cases": .60, "counsel": "the road trust", "description": "Every matter on the circuit travels this road, and the trust that maintains it is sued twice a season."},
    {"key": "fenwick_seat", "region": "nation", "name": "Fenwick County Seat", "landmark": "nation-seat", "tier": 5, "reputation": 57, "cases": .80, "counsel": "the county register", "description": "The register decides which firm the county calls first. There is exactly one such office on the circuit."},
    {"key": "fenwick_halt", "region": "nation", "name": "Fenwick Halt", "landmark": "nation-halt", "tier": 5, "reputation": 57, "cases": .50, "counsel": "the branch line", "description": "Two trains a day and a great deal of freight liability between them."},
    {"key": "marlow_crossing", "region": "nation", "name": "Marlow Crossing", "landmark": "nation-marlow", "tier": 5, "reputation": 58, "cases": .60, "counsel": "the parish of Marlow", "description": "A crossroads village that has been arguing about the same boundary since before the county existed."},
    {"key": "fenwick_green", "region": "nation", "name": "Fenwick Green", "landmark": "nation-green", "tier": 6, "reputation": 62, "cases": .45, "counsel": "the assizes committee", "description": "The circuit court sits here twice a year, and the committee that seats it never forgets who turned up."},
    {"key": "ashgate_village", "region": "nation", "name": "Ashgate", "landmark": "nation-ashgate", "tier": 6, "reputation": 62, "cases": .50, "counsel": "the village council", "description": "Small, stubborn, and entirely capable of funding a decade of litigation out of spite."},
    {"key": "ashgate_fair", "region": "nation", "name": "Ashgate Fair", "landmark": "nation-fair", "tier": 6, "reputation": 63, "cases": .50, "counsel": "the fair charter", "description": "A chartered fair still runs its own summary court. Whoever advises it advises half the county for one week a year."},
    {"key": "marlow_ford", "region": "nation", "name": "Marlow Ford", "landmark": "nation-ford", "tier": 6, "reputation": 63, "cases": .45, "counsel": "the ferry rights", "description": "Ancient crossing rights, modern insurers, and a permanent disagreement between them."},
    {"key": "marlow_mill_pond", "region": "nation", "name": "Marlow Mill Pond", "landmark": "nation-pond", "tier": 6, "reputation": 64, "cases": .40, "counsel": "the millers", "description": "Water, again. It is always water. The millers pay late but they pay every year."},
    {"key": "ellery_farms", "region": "nation", "name": "Ellery Farms", "landmark": "nation-farm", "tier": 6, "reputation": 64, "cases": .45, "counsel": "the tenant holdings", "description": "Tenancy, succession, and drainage. The least interesting file on the circuit and the one that never closes."},
    # -- Treaty Sea (tiers 7-9) -------------------------------------------
    {"key": "diplomatic_quay", "region": "ocean", "name": "The Diplomatic Quay", "landmark": "ocean-quay", "tier": 7, "reputation": 68, "cases": .65, "counsel": "the harbour authority", "description": "Where delegations come ashore. The authority wants one firm on call for everything that goes wrong before the talks begin."},
    {"key": "bonded_roads", "region": "ocean", "name": "The Bonded Roads", "landmark": "ocean-roads", "tier": 7, "reputation": 69, "cases": .60, "counsel": "the bonded warehouses", "description": "Cargo that is legally nowhere until someone signs for it. An entire practice lives in that gap."},
    {"key": "chandlers_row", "region": "ocean", "name": "Chandler's Row", "landmark": "ocean-chandlers", "tier": 8, "reputation": 74, "cases": .60, "counsel": "the ships' agents", "description": "Every agent on the row keeps a lawyer's name in a drawer for the day a master refuses to sail."},
    {"key": "lantern_light", "region": "ocean", "name": "The Lantern Light", "landmark": "ocean-lantern", "tier": 8, "reputation": 75, "cases": .50, "counsel": "the pilots' board", "description": "Pilotage is compulsory, which means pilotage is litigated. The board has never had counsel who understood both."},
    {"key": "treaty_anchorage", "region": "ocean", "name": "Treaty Anchorage", "landmark": "ocean-anchorage", "tier": 9, "reputation": 79, "cases": .70, "counsel": "the anchorage compact", "description": "Neutral water by agreement only. The agreement is the practice."},
    {"key": "free_harbour_court", "region": "ocean", "name": "Free Harbour Court", "landmark": "ocean-court", "tier": 9, "reputation": 80, "cases": .80, "counsel": "the admiralty roll", "description": "The sea's own courthouse. A place on the roll is the closest thing the Treaty Sea has to a permanent address."},
    # -- Sovereign Arc (tiers 10-11) --------------------------------------
    {"key": "concord_rondpoint", "region": "continent", "name": "Concord Rond-Point", "landmark": "continent-rondpoint", "tier": 10, "reputation": 83, "cases": .65, "counsel": "the quarter's chambers", "description": "Six embassies on one circle, each convinced the other five are in breach."},
    {"key": "sovereign_assembly", "region": "continent", "name": "The Sovereign Assembly", "landmark": "continent-assembly", "tier": 10, "reputation": 84, "cases": .85, "counsel": "the standing committee", "description": "Advising the committee that drafts the rules is not the same as arguing under them. It is considerably better."},
    {"key": "union_terminus", "region": "continent", "name": "Union Terminus", "landmark": "continent-transit", "tier": 10, "reputation": 84, "cases": .60, "counsel": "the transit union", "description": "Four jurisdictions meet under one roof, and the union has a grievance in every one of them."},
    {"key": "wall_ring", "region": "continent", "name": "The Wall Ring", "landmark": "continent-ring", "tier": 11, "reputation": 86, "cases": .65, "counsel": "the boundary commission", "description": "A commission that redraws lines for a living and is sued for every one it draws."},
    {"key": "north_quarter", "region": "continent", "name": "The North Quarter", "landmark": "continent-quarter", "tier": 11, "reputation": 87, "cases": .70, "counsel": "the residents' syndicate", "description": "Old money that has outlasted three constitutions and intends to outlast a fourth."},
    # -- Global Compact (tiers 12-14) -------------------------------------
    {"key": "compact_concourse", "region": "orbit", "name": "The Compact Concourse", "landmark": "orbit-concourse", "tier": 12, "reputation": 89, "cases": .70, "counsel": "the delegations' desk", "description": "Every signatory keeps a bench here. Being the desk's standing counsel means being in the room before the room convenes."},
    {"key": "hearing_chamber_one", "region": "orbit", "name": "Hearing Chamber One", "landmark": "orbit-chamber", "tier": 12, "reputation": 90, "cases": .85, "counsel": "the chamber list", "description": "The list decides who is heard and in what order. Nothing in this game is worth more and costs less to hold."},
    {"key": "registry_vault", "region": "orbit", "name": "The Registry Vault", "landmark": "orbit-registry", "tier": 13, "reputation": 92, "cases": .70, "counsel": "the compact registry", "description": "Where every treaty in force is actually kept. Custody is a duty, and duties are retained."},
    {"key": "far_side_landing", "region": "orbit", "name": "Far-Side Landing", "landmark": "orbit-landing", "tier": 13, "reputation": 92, "cases": .65, "counsel": "the landing authority", "description": "The furthest place a writ has ever been served, and the authority would rather it were served by you."},
    {"key": "assembly_gallery", "region": "orbit", "name": "The Assembly Gallery", "landmark": "orbit-gallery", "tier": 14, "reputation": 94, "cases": .80, "counsel": "the gallery secretariat", "description": "Public seats at a private negotiation. The secretariat needs someone who can say no to the powerful in writing."},
    {"key": "founders_reading_room", "region": "orbit", "name": "The Founders' Reading Room", "landmark": "orbit-reading-room", "tier": 14, "reputation": 95, "cases": .65, "counsel": "the charter trustees", "description": "Nine chairs and the original charter. There is no larger room to be invited into."},
]


def _apportion_exactly(total_units: int, shares: list[float]) -> list[int]:
    """Split ``total_units`` across ``shares`` so the parts sum to the whole.

    Rounding each share on its own does not do that, and the shortfall is
    invisible until it matters. Every district's rent relief was
    `round(POOL * share)`, which happened to sum to exactly 10,000 bps at one
    particular set of shares and stopped doing so the moment `_tier_effort_scale`
    moved and re-weighted them: the sum came to 9,998, so holding literally
    every district on the map left the player paying 1 a day at tier 4 and 960 a
    day at tier 14. "Holding every district retires the office lease entirely"
    is the mechanic's headline promise, and it was true by luck.

    Largest remainder makes it true by construction: floor everything, then hand
    the leftover units to the shares that lost the most in the flooring.
    """
    if not shares:
        return []
    raw = [total_units * share for share in shares]
    units = [int(value) for value in raw]
    leftover = total_units - sum(units)
    by_remainder = sorted(range(len(raw)), key=lambda index: raw[index] - units[index], reverse=True)
    for index in by_remainder[:leftover]:
        units[index] += 1
    return units


def _price_district_catalog() -> list[dict]:
    """Price, weight, and finalise the district catalog.

    Standing and rent relief are apportioned by the same share of the budget
    that sets the price, so a district is never a better deal in standing per
    case than any other and there is no ordering to optimise -- only the gates
    decide what is reachable.

    The two pools are apportioned exactly rather than rounded independently, so
    a full sweep is worth the whole pool and not the whole pool minus whatever
    rounding took. Price is not: it is quoted per district in readable money by
    `_round_game_amount`, and the budget it is drawn from is a design target
    with a 3% tolerance rather than a promise to the player.
    """
    weights = {
        item["key"]: float(item["cases"]) * _tier_effort_scale(int(item["tier"]))
        for item in _DISTRICTS
    }
    total_weight = sum(weights.values())
    shares = [weights[item["key"]] / total_weight for item in _DISTRICTS]
    relief = _apportion_exactly(TERRITORY_RENT_RELIEF_POOL_BPS, shares)
    # Standing is carried to two decimals, so it is apportioned in hundredths.
    standing = _apportion_exactly(round(TERRITORY_STANDING_POOL * 100), shares)
    catalog: list[dict] = []
    for item, share, relief_bps, standing_units in zip(_DISTRICTS, shares, relief, standing):
        tier = int(item["tier"])
        catalog.append(
            {
                **item,
                "case_price": round(TERRITORY_TOTAL_CASE_BUDGET * share, 2),
                "cost": _round_game_amount(
                    _case_target_for_tier(tier) * TERRITORY_TOTAL_CASE_BUDGET * share
                ),
                "standing": round(standing_units / 100, 2),
                "rent_relief_bps": relief_bps,
                "region_name": TERRITORY_REGION_BY_KEY[item["region"]]["name"],
            }
        )
    catalog.sort(key=lambda district: (district["tier"], district["reputation"], district["name"]))
    return catalog


DISTRICTS = _price_district_catalog()
DISTRICT_BY_KEY = {item["key"]: item for item in DISTRICTS}
DISTRICT_KEYS_BY_REGION = {
    region["key"]: [item["key"] for item in DISTRICTS if item["region"] == region["key"]]
    for region in TERRITORY_REGIONS
}


def _district_connection_gate() -> dict[str, str]:
    """Which connection a district's institutions want to see before they sign.

    Connections were the one asset class whose entire stated benefit was an
    unlock, and the unlock was worth nothing. `_rebalance_client_catalog`
    equalises expected commercial value across every client at a tier on
    purpose -- that is what makes a client a play-style choice rather than an
    income choice -- so "unlocks the corporate clients" cannot make anyone
    richer. What was left was a purchase that, at every one of the fourteen
    tiers it appears in, costs more than the best upgrade at the same tier and
    pays a smaller `payout_mult` than it. There was no board state in which
    buying one was correct.

    Rather than inflate them into a better upgrade -- the catalog has thirty-five
    of those already -- they now gate the mechanic they read like: a standing
    appointment over a whole district. That is what a professional network is
    for, it is the only Firm-tab purchase whose effect lands on the map, and it
    moves no money: districts already carry their own price, standing, and rent
    relief, all apportioned by `_price_district_catalog`.

    A district asks for the most developed network that is no more advanced than
    the district itself, so the requirement always sits at or below the tier the
    player has already reached. The two tier-0 districts stay ungated, which
    keeps a new player's first appointment and the onboarding path exactly as
    they were.
    """
    ladder = sorted(
        (item for item in ASSETS if item["type"] == "connection"),
        key=lambda item: (item["tier"], item["cost"], item["key"]),
    )
    tiers = sorted({item["tier"] for item in ladder})
    # Two connections share tier 3, and two districts sit at tier 3 with them.
    # Handing both districts to whichever one sorts last would leave the other
    # gating nothing, which is the defect this whole change exists to remove, so
    # districts are dealt round-robin across the connections they answer to.
    at_tier = {tier: [item["key"] for item in ladder if item["tier"] == tier] for tier in tiers}
    dealt: dict[int, int] = {}
    gate: dict[str, str] = {}
    for district in DISTRICTS:
        eligible = [tier for tier in tiers if tier <= district["tier"]]
        if not eligible:
            continue
        group = at_tier[eligible[-1]]
        index = dealt.get(eligible[-1], 0)
        gate[district["key"]] = group[index % len(group)]
        dealt[eligible[-1]] = index + 1
    return gate


DISTRICT_CONNECTION_GATE = _district_connection_gate()


def _connection_district_keys() -> dict[str, list[str]]:
    """The districts each connection opens, keyed."""
    opened: dict[str, list[str]] = {}
    for district_key, connection_key in DISTRICT_CONNECTION_GATE.items():
        opened.setdefault(connection_key, []).append(district_key)
    return opened


CONNECTION_DISTRICTS = _connection_district_keys()


def _connection_district_names() -> dict[str, list[str]]:
    """The districts each connection opens, for its catalog copy."""
    return {
        connection_key: [DISTRICT_BY_KEY[key]["name"] for key in district_keys]
        for connection_key, district_keys in CONNECTION_DISTRICTS.items()
    }


def _describe_connection_unlocks() -> None:
    """Replace "unlocks N clients" with the districts the network actually opens.

    The client half of the sentence was the part that was not worth acting on,
    and a benefit line that promises nothing measurable is worse than a shorter
    one. `_rebalance_asset_catalog` has already rewritten the payout clause by
    the time this runs, so only the trailing clause is replaced.
    """
    opened = _connection_district_names()
    for item in ASSETS:
        if item["type"] != "connection":
            continue
        names = opened.get(item["key"], [])
        parts = [part.strip() for part in item["benefit"].split("·") if "unlock" not in part.lower()]
        if names:
            # "Retainers" was the wrong word: a client retainer pays a fee and a
            # district appointment does not, and the Firm tab now shows both.
            parts.append(f"Counsel opens in {names[0]}" if len(names) == 1 else f"Counsel opens in {len(names)} districts")
        item["benefit"] = " · ".join(parts)


_describe_connection_unlocks()


def _iso_utc(value) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _owned_keys(profile: PlayerProfile) -> set[str]:
    return {
        asset_key
        for (asset_key,) in PlayerAsset.query.with_entities(PlayerAsset.asset_key)
        .filter_by(profile_id=profile.id)
        .all()
    }


def _held_district_keys(profile: PlayerProfile) -> set[str]:
    return {
        district_key
        for (district_key,) in PlayerTerritory.query.with_entities(PlayerTerritory.district_key)
        .filter_by(profile_id=profile.id)
        .all()
    }


def _territory_totals(held: set[str]) -> dict:
    """Standing and rent relief earned by a set of held districts."""
    standing = sum(DISTRICT_BY_KEY[key]["standing"] for key in held if key in DISTRICT_BY_KEY)
    relief_bps = sum(DISTRICT_BY_KEY[key]["rent_relief_bps"] for key in held if key in DISTRICT_BY_KEY)
    swept = [
        region["key"]
        for region in TERRITORY_REGIONS
        if DISTRICT_KEYS_BY_REGION[region["key"]]
        and all(key in held for key in DISTRICT_KEYS_BY_REGION[region["key"]])
    ]
    standing += TERRITORY_REGION_SWEEP_STANDING * len(swept)
    return {
        "standing": round(min(TERRITORY_STANDING_CAP, standing), 2),
        "relief_bps": min(TERRITORY_RENT_RELIEF_POOL_BPS, int(relief_bps)),
        "swept_regions": swept,
        "held": len(held & set(DISTRICT_BY_KEY)),
    }


def territory_standing(profile: PlayerProfile, held: set[str] | None = None) -> float:
    held = held if held is not None else _held_district_keys(profile)
    return _territory_totals(held)["standing"]


def _relieved_daily_rent(profile: PlayerProfile, held: set[str] | None = None) -> int:
    """Office rent after the branch offices the firm is already paid to keep."""
    daily_rent = int(FIRM_TIERS[profile.office_tier]["rent_daily"])
    relief_bps = _territory_totals(held if held is not None else _held_district_keys(profile))["relief_bps"]
    return max(0, daily_rent - daily_rent * relief_bps // 10_000)


def _district_locks(profile: PlayerProfile, district: dict, owned: set[str] | None = None) -> list[str]:
    locks: list[str] = []
    if profile.office_tier < district["tier"]:
        # Three of the fifteen office names begin with a vowel -- International
        # Practice, Oceanic Law Citadel, Orbital Arbitration Ring -- and the
        # article was fixed, so every district gated behind tier 7, 11 or 12
        # read "Requires a International Practice" on the counsel board and in
        # the map's district brief.
        tier_name = FIRM_TIERS[district["tier"]]["name"]
        article = "an" if tier_name[:1].upper() in "AEIOU" else "a"
        locks.append(f"Requires {article} {tier_name}")
    if profile.reputation < district["reputation"]:
        locks.append(f"Requires {district['reputation']} reputation")
    connection_key = DISTRICT_CONNECTION_GATE.get(district["key"])
    if connection_key:
        owned = owned if owned is not None else _owned_keys(profile)
        if connection_key not in owned:
            locks.append(f"Requires the {ASSET_BY_KEY[connection_key]['name'].lower()}")
    return locks


def territory_state(profile: PlayerProfile, held: set[str] | None = None) -> dict:
    """The full counsel board: every district, its gate, and what it is worth."""
    held = held if held is not None else _held_district_keys(profile)
    totals = _territory_totals(held)
    daily_rent = int(FIRM_TIERS[profile.office_tier]["rent_daily"])
    districts = []
    # Read once for the whole board: the connection gate is checked per district
    # and this is the only place that walks all thirty-eight of them.
    owned_assets = _owned_keys(profile)
    for district in DISTRICTS:
        owned = district["key"] in held
        locks = [] if owned else _district_locks(profile, district, owned_assets)
        districts.append(
            {
                "key": district["key"],
                "name": district["name"],
                "region": district["region"],
                "region_name": district["region_name"],
                "landmark_key": district["landmark"],
                "tier": district["tier"],
                "reputation": district["reputation"],
                "counsel": district["counsel"],
                "description": district["description"],
                "cost": district["cost"],
                "standing": district["standing"],
                "rent_relief_bps": district["rent_relief_bps"],
                "owned": owned,
                "locks": locks,
                "affordable": profile.cash >= district["cost"],
                "available": not owned and not locks,
            }
        )
    regions = []
    for region in TERRITORY_REGIONS:
        keys = DISTRICT_KEYS_BY_REGION[region["key"]]
        regions.append(
            {
                "key": region["key"],
                "name": region["name"],
                "seat": region["seat"],
                # Inclusive first/last firm tier this region covers. The live
                # Firm tab groups catalog addresses under these ranges; without
                # the field the page throws on `tier_range[0]` and the slide is
                # a cream shell. A catalog asset's `region` is the address the
                # firm occupied at its tier; a territory region is an area of
                # the map holding a run of tiers.
                "tier_range": list(region["tiers"]),
                "total": len(keys),
                "held": sum(1 for key in keys if key in held),
                "swept": region["key"] in totals["swept_regions"],
                "sweep_standing": TERRITORY_REGION_SWEEP_STANDING,
            }
        )
    return {
        "districts": districts,
        "regions": regions,
        "held": totals["held"],
        "total": len(DISTRICTS),
        "standing": totals["standing"],
        "standing_cap": round(TERRITORY_STANDING_CAP, 2),
        "standing_floor_ceiling": TERRITORY_STANDING_FLOOR_CEILING,
        "rent_relief_bps": totals["relief_bps"],
        "daily_rent": daily_rent,
        "relieved_daily_rent": _relieved_daily_rent(profile, held),
    }


def _career_floor(correct: int, validated: int, standing: float = 0.0) -> float:
    """The reputation a body of work guarantees, whatever the last 30 cases did.

    The rolling mean alone would gate the top of the ladder on keeping 28 of
    the last 30 cases validated -- that is, on an LLM's opinion of the player's
    prose, not on LSAT accuracy. This floor is what makes a body of work count,
    and it is capped just above the highest requirement in the catalog (94, the
    final headquarters) rather than exactly on it, so the last rung is not lost
    to a single bad case the moment it is met.

    District standing is the only thing money can add to it, and
    TERRITORY_STANDING_FLOOR_CEILING is where money stops counting. Being the
    district's default counsel is a real reason your standing does not collapse
    on a bad fortnight; it is not a reason anyone hands you the final
    headquarters. Everything above that line is payable in casework alone.
    """
    casework = 50 + correct * .55 + validated * .70
    with_standing = min(TERRITORY_STANDING_FLOOR_CEILING, casework + standing)
    return min(96.0, max(casework, with_standing))


def _lock_profile(profile: PlayerProfile) -> PlayerProfile:
    """Lock and refresh account state even when it is already in the identity map."""
    return (
        PlayerProfile.query.populate_existing()
        .filter_by(id=profile.id)
        .with_for_update()
        .one()
    )


def lock_user_profile(user_id: str) -> PlayerProfile | None:
    """Serialize account-wide gameplay operations for one authenticated user."""
    return (
        PlayerProfile.query.populate_existing()
        .filter_by(user_id=user_id)
        .with_for_update()
        .one_or_none()
    )


def _as_utc(value):
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _game_complete(profile: PlayerProfile) -> bool:
    if profile.game_completed_at is not None:
        return True
    state = profile.story_state
    return bool(state and FINAL_CASE_KEY in (state.quest_history_json or []))


def _reputation_decay_state(profile: PlayerProfile, owned: set[str] | None = None) -> dict:
    owned = owned if owned is not None else _owned_keys(profile)
    base_rate = .25 + .025 * profile.office_tier
    guard = sum(
        float(ASSET_BY_KEY[key].get("reputation_guard", 0))
        for key in owned
        if key in ASSET_BY_KEY
    )
    # Reputation safeguards can absorb at most 80% of neglect. Even the most
    # sophisticated firm still needs its lawyer to return and work cases.
    reduction = min(base_rate * .8, guard * .05)
    return {
        "base_rate": round(base_rate, 3),
        "guard": round(guard, 2),
        "effective_rate": round(max(.05, base_rate - reduction), 3),
    }


def _upkeep_state(
    profile: PlayerProfile,
    owned: set[str] | None = None,
    held: set[str] | None = None,
) -> dict:
    tier = FIRM_TIERS[profile.office_tier]
    list_rent = int(tier["rent_daily"])
    daily_rent = _relieved_daily_rent(profile, held)
    decay = _reputation_decay_state(profile, owned)
    completed = _game_complete(profile)
    return {
        "daily_rent": daily_rent,
        "list_daily_rent": list_rent,
        "rent_relief": list_rent - daily_rent,
        "offline_daily_rent": round(daily_rent * OFFLINE_RENT_NUMERATOR / OFFLINE_RENT_DENOMINATOR),
        "offline_multiplier": OFFLINE_RENT_NUMERATOR / OFFLINE_RENT_DENOMINATOR,
        "active_window_hours": round(ACTIVE_RENT_WINDOW.total_seconds() / 3600),
        "reputation_grace_hours": round(REPUTATION_GRACE_PERIOD.total_seconds() / 3600),
        "rent_arrears": int(profile.rent_arrears or 0),
        "arrears_cap": daily_rent * RENT_ARREARS_DAYS,
        "lifetime_rent_paid": int(profile.lifetime_rent_paid or 0),
        "last_settled_at": _iso_utc(profile.upkeep_settled_at),
        "last_active_at": _iso_utc(profile.last_active_at),
        "base_reputation_decay_daily": decay["base_rate"],
        "reputation_guard": decay["guard"],
        "reputation_decay_daily": 0 if completed else decay["effective_rate"],
        "accruing": not completed,
        "completed": completed,
        "completed_at": _iso_utc(profile.game_completed_at),
        "completion_requirement": {
            "key": FINAL_CASE_KEY,
            "label": "Complete The Constellation Charter, the final map case",
        },
    }


def _rent_segment_micros(daily_rent: int, start, end, *, numerator: int = 1, denominator: int = 1) -> int:
    """Return millionths of a cent without losing short settlement intervals."""
    if end <= start:
        return 0
    elapsed = end - start
    elapsed_micros = (
        elapsed.days * SECONDS_PER_DAY * 1_000_000
        + elapsed.seconds * 1_000_000
        + elapsed.microseconds
    )
    rent_micros_per_day = daily_rent * 100 * RENT_ACCRUAL_MICROS_PER_CENT
    return (
        rent_micros_per_day * elapsed_micros * numerator
        // (SECONDS_PER_DAY * 1_000_000 * denominator)
    )


def _pay_rent_arrears(
    profile: PlayerProfile,
    *,
    source_id: str,
    detail: dict | None = None,
) -> int:
    arrears = max(0, int(profile.rent_arrears or 0))
    paid = min(max(0, int(profile.cash)), arrears)
    if paid <= 0:
        return 0
    profile.cash -= paid
    profile.rent_arrears = arrears - paid
    profile.lifetime_rent_paid = int(profile.lifetime_rent_paid or 0) + paid
    profile.lifetime_spending += paid
    _ledger(
        profile,
        "office_rent",
        source_id,
        -paid,
        {
            "office": FIRM_TIERS[profile.office_tier]["name"],
            "daily_rent": FIRM_TIERS[profile.office_tier]["rent_daily"],
            "arrears_remaining": profile.rent_arrears,
            **(detail or {}),
        },
    )
    return paid


# The reputation a run of wins guarantees, and the day count that licenses it.
#
# Cases are minted on demand and without limit from Practice, so anything that
# pays per case is farmable per case. The ladder is therefore not the reward --
# the day count is. A player can hold only as much streak standing as
# consecutive *working* days support, and a working day is one on which a case
# was actually finished, so the ceiling on this mechanic is wall-clock time,
# which is the one resource the game cannot mint.
#
# It is also a floor and never a credit: it stops reputation falling, it never
# pushes it up. Farming a streak cannot buy a tier. It shares the standing
# argument -- and therefore TERRITORY_STANDING_FLOOR_CEILING -- with district
# counsel seats, so the two compose by addition under one shared cap instead of
# being two separate ladders racing each other to the top of the game.
STREAK_STANDING_LADDER: tuple[tuple[int, float], ...] = (
    (3, 1.0), (6, 2.0), (10, 3.0), (15, 4.0), (21, 5.0),
)
STREAK_STANDING_CAP = 5.0
# One day of consecutive casework licenses one point of the ladder.
STREAK_STANDING_PER_DAY = 1.0


def streak_standing(profile: PlayerProfile) -> float:
    """Reputation floor earned by the current run of validated wins.

    Two gates, both necessary. Depth is the ladder, which diminishes: the first
    point costs 3 wins and the fifth costs 6 more. Consistency is the day count,
    which is what stops a single long sitting from buying the whole ladder.
    """
    earned = 0.0
    for wins, standing in STREAK_STANDING_LADDER:
        if (profile.current_streak or 0) >= wins:
            earned = standing
    licensed = min(STREAK_STANDING_CAP, max(0, profile.daily_streak_current or 0) * STREAK_STANDING_PER_DAY)
    return min(earned, licensed)


def _streak_form(profile: PlayerProfile) -> dict:
    """What the streak is currently worth, and what the next rung costs.

    Both halves are reported because either one can be the thing holding the
    player back, and a bar that will not move however many cases are answered is
    worse than no bar. When the day count is the binding gate the UI can say so
    instead of implying more casework would help.
    """
    wins = profile.current_streak or 0
    days = max(0, profile.daily_streak_current or 0)
    earned = 0.0
    next_at = None
    for rung_wins, rung_standing in STREAK_STANDING_LADDER:
        if wins >= rung_wins:
            earned = rung_standing
        elif next_at is None:
            next_at = rung_wins
    licensed = min(STREAK_STANDING_CAP, days * STREAK_STANDING_PER_DAY)
    return {
        "wins": wins,
        "days": days,
        "standing": round(min(earned, licensed), 2),
        "earned_standing": round(earned, 2),
        "licensed_standing": round(licensed, 2),
        "cap": STREAK_STANDING_CAP,
        "next_win_target": next_at,
        # True when more casework today cannot raise the floor and only coming
        # back tomorrow can.
        "day_limited": earned > licensed,
    }


def _touch_daily_streak(profile: PlayerProfile, now) -> None:
    """Advance the working-day streak; a no-op after the first finished case each day.

    This counts consecutive days on which the player *finished a case*, not days
    the app was opened. It used to run from `_settle_upkeep_unflushed`, which is
    on every protected route, so loading any page advanced it -- a streak that
    rewarded showing up rather than working, and the only streak the UI showed.
    It is now called from the one place that also ticks `DailyProgress.cases_completed`,
    so both day counters answer to the same bar: a real attempt with a real
    argument, not a thin win and not a page load.

    It does not touch `current_streak`/`best_streak`, which count consecutive
    validated case wins for the payout bonus and are a different mechanic.
    """
    today = now.date()
    last = profile.daily_streak_last_date
    if last == today:
        return
    profile.daily_streak_current = profile.daily_streak_current + 1 if last is not None and (today - last).days == 1 else 1
    profile.daily_streak_best = max(profile.daily_streak_best, profile.daily_streak_current)
    profile.daily_streak_last_date = today


def _settle_upkeep_locked(profile: PlayerProfile, now=None) -> dict:
    """Accrue rent and inactivity loss through ``now`` on an already locked profile.

    Held in `no_autoflush` because the settlement reads three tables it never
    writes — held districts for the rent relief, owned assets for the reputation
    guard, and the story state for completion. Each of those reads is an autoflush
    point, so the accrual landed as two separate `UPDATE player_profiles`
    statements split around them (arrears and micros first, then the settled and
    active timestamps) where it is one row and one set of changes. Nothing in here
    reads back a row it has written, so there is nothing for a flush to be
    ordered against, and one statement is one round trip rather than two.
    """
    with db.session.no_autoflush:
        return _settle_upkeep_unflushed(profile, now)


def _settle_upkeep_unflushed(profile: PlayerProfile, now=None) -> dict:
    now = _as_utc(now or utcnow())
    settled_at = _as_utc(profile.upkeep_settled_at) or now
    last_active_at = _as_utc(profile.last_active_at) or settled_at

    # Read once and pass down, the way `serialize_game` already threads `owned`.
    # The rent relief needs the held districts and the reputation guard needs the
    # owned assets, and both are read again by `_upkeep_state` on the way out, so
    # leaving them to be looked up at each use cost two extra round trips per
    # settlement — on every protected route.
    held = _held_district_keys(profile)
    owned = _owned_keys(profile)

    if _game_complete(profile):
        profile.game_completed_at = profile.game_completed_at or now
        _pay_rent_arrears(
            profile,
            source_id=f"completion:{now.isoformat()}",
            detail={"income_source": "campaign_completion"},
        )
        profile.upkeep_settled_at = now
        profile.last_active_at = now
        return _upkeep_state(profile, owned, held)

    daily_rent = _relieved_daily_rent(profile, held)
    active_until = last_active_at + ACTIVE_RENT_WINDOW
    active_end = min(now, active_until)
    active_micros = _rent_segment_micros(daily_rent, settled_at, active_end)
    offline_start = max(settled_at, active_until)
    offline_micros = _rent_segment_micros(
        daily_rent,
        offline_start,
        now,
        numerator=OFFLINE_RENT_NUMERATOR,
        denominator=OFFLINE_RENT_DENOMINATOR,
    )

    accrued_micros = max(0, int(profile.rent_accrual_micros or 0)) + active_micros + offline_micros
    micros_per_dollar = 100 * RENT_ACCRUAL_MICROS_PER_CENT
    newly_due, profile.rent_accrual_micros = divmod(accrued_micros, micros_per_dollar)
    arrears_before = max(0, int(profile.rent_arrears or 0))
    arrears_cap = daily_rent * RENT_ARREARS_DAYS
    uncapped_arrears = arrears_before + newly_due
    profile.rent_arrears = min(arrears_cap, uncapped_arrears)

    decay = _reputation_decay_state(profile, owned)
    decay_start = max(settled_at, last_active_at + REPUTATION_GRACE_PERIOD)
    inactive_decay_seconds = max(0.0, (now - decay_start).total_seconds())
    reputation_before = profile.reputation
    if inactive_decay_seconds > 0:
        loss = decay["effective_rate"] * inactive_decay_seconds / SECONDS_PER_DAY
        profile.reputation = round(max(0, profile.reputation - loss), 1)

    paid = _pay_rent_arrears(
        profile,
        source_id=f"settle:{now.isoformat()}",
        detail={
            "new_rent": int(newly_due),
            "arrears_before": arrears_before,
            "arrears_waived": max(0, uncapped_arrears - arrears_cap),
            "offline_hours": round(max(0.0, (now - offline_start).total_seconds()) / 3600, 2),
            "reputation_change": round(profile.reputation - reputation_before, 1),
        },
    )
    profile.upkeep_settled_at = now
    profile.last_active_at = now
    state = _upkeep_state(profile, owned, held)
    state["settlement"] = {
        "new_rent": int(newly_due),
        "paid": paid,
        "reputation_change": round(profile.reputation - reputation_before, 1),
    }
    return state


def settle_upkeep(profile: PlayerProfile, now=None) -> dict:
    """Settle elapsed office upkeep exactly once and record the visit as activity."""
    profile = _lock_profile(profile)
    state = _settle_upkeep_locked(profile, now)
    db.session.commit()
    return state


def settle_upkeep_for_user(user_id: str, now=None) -> PlayerProfile | None:
    """Take the account's settlement lock, settle through ``now``, and hand the firm back.

    Every protected game route needs the same two things: the account's firm, and
    its upkeep brought up to date. Doing that as `user.game_profile` followed by
    `settle_upkeep` read the same row twice — once through the relationship, then
    again `FOR UPDATE` to settle against it. The lock is the load here, so there
    is no reason for the unlocked read to happen first.

    Returns None when the account has no firm yet, which is the caller's cue to
    answer "no profile" rather than to settle anything.
    """
    profile = lock_user_profile(user_id)
    if profile is None:
        return None
    _settle_upkeep_locked(profile, now)
    db.session.commit()
    return profile


def _requirements_met(definition: dict, profile: PlayerProfile, owned: set[str]) -> bool:
    return (
        profile.reputation >= definition.get("reputation", 0)
        and profile.office_tier >= definition.get("tier", 0)
        and all(key in owned for key in definition.get("requires", []))
    )


def _client_is_unlocked(client: dict, profile: PlayerProfile, owned: set[str]) -> bool:
    # Signed clients stay in the book even if a difficult case temporarily
    # lowers reputation. This prevents a loss from collapsing the fee tier.
    return _requirements_met(client, profile, owned) or any(
        contract.client_key == client["key"] for contract in profile.client_contracts
    )


def _requirement_copy(definition: dict) -> dict:
    return {
        "reputation": definition.get("reputation", 0),
        "tier": definition.get("tier", 0),
        "assets": definition.get("requires", []),
    }


def _daily(profile: PlayerProfile, persist: bool = True) -> DailyProgress:
    today = utcnow().date()
    progress = (
        DailyProgress.query.populate_existing()
        .filter_by(profile_id=profile.id, activity_date=today)
        .first()
    )
    if not progress:
        progress = DailyProgress(profile_id=profile.id, activity_date=today, cases_completed=0, claimed_json=[])
        if persist:
            db.session.add(progress)
            db.session.flush()
    return progress


def _passive_state(profile: PlayerProfile, owned: set[str] | None = None) -> dict:
    owned = owned if owned is not None else _owned_keys(profile)
    hourly = sum(int(ASSET_BY_KEY[key].get("passive_hourly", 0)) for key in owned if key in ASSET_BY_KEY)
    cap_hours = 8 + sum(int(ASSET_BY_KEY[key].get("storage_hours", 0)) for key in owned if key in ASSET_BY_KEY)
    last = profile.last_passive_collected_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    elapsed_hours = max(0.0, (utcnow() - last).total_seconds() / 3600)
    stored_hours = min(elapsed_hours, cap_hours)
    return {
        "hourly_rate": hourly,
        "stored_hours": round(stored_hours, 2),
        "cap_hours": cap_hours,
        "available": math.floor(hourly * stored_hours),
        "last_collected_at": _iso_utc(profile.last_passive_collected_at),
    }


def _reputation_band(value: float) -> dict:
    if value >= 94:
        return {"name": "Legendary", "minimum": 94, "next": None}
    if value >= 86:
        return {"name": "Elite", "minimum": 86, "next": 94}
    if value >= 75:
        return {"name": "Prestigious", "minimum": 75, "next": 86}
    if value >= 60:
        return {"name": "Established", "minimum": 60, "next": 75}
    if value >= 40:
        return {"name": "Local", "minimum": 40, "next": 60}
    return {"name": "Unreliable", "minimum": 0, "next": 40}


def _valuation(profile: PlayerProfile) -> int:
    tier_investment = sum(tier["cost"] for tier in FIRM_TIERS[1 : profile.office_tier + 1])
    asset_investment = sum(asset.purchase_price for asset in profile.assets)
    return int(profile.cash + tier_investment + asset_investment)


def _achievement_state(profile: PlayerProfile, owned: set[str]) -> list[dict]:
    """The firm's honours, and how far off the ones it has not earned are.

    These grant nothing, deliberately: the economy is tuned around three to six
    cases per upgrade and a cash prize for reaching 100 cases would quietly
    retune it. What they were missing is not a reward but a reading. Every one
    of them counts something the profile already tracks, so a locked honour can
    say "62 of 100 cases" instead of showing a padlock, which is the difference
    between a trophy cabinet and a list of things that have not happened.

    `progress` is a pair of plain numbers rather than a percentage so the client
    can show the count itself, with the unit it is counted in, because "412,000
    of 1,000,000" wants a dollar sign and "62 of 100" does not. Omitted for the
    honours that are not a count -- joining one specific network is a yes or a
    no, and "0 of 1" says less than the requirement line already does.
    """
    valuation = _valuation(profile)
    staff_hired = sum(ASSET_BY_KEY[key]["type"] == "staff" for key in owned if key in ASSET_BY_KEY)
    rivals_owned = sum(ASSET_BY_KEY[key]["type"] == "rival" for key in owned if key in ASSET_BY_KEY)
    values = [
        ("first_verdict", "First verdict", "Complete your first case.", profile.total_cases, 1, "cases"),
        ("ten_cases", "Docket regular", "Complete 10 cases.", profile.total_cases, 10, "cases"),
        ("streak_five", "On a roll", "Reach a validated 5-case streak.", profile.best_streak, 5, "streak"),
        ("established", "Established counsel", "Reach 60 Reputation.", profile.reputation, 60, "reputation"),
        ("first_hire", "A growing team", "Hire your first staff member.", staff_hired, 1, "hired"),
        ("first_acquisition", "Name on the door", "Acquire a rival firm.", rivals_owned, 1, "firms"),
        ("million_value", "Seven-figure firm", "Reach a $1,000,000 valuation.", valuation, 1_000_000, "money"),
        ("hundred_cases", "Century docket", "Complete 100 cases.", profile.total_cases, 100, "cases"),
        ("global_counsel", "Global counsel", "Build an International Practice.", profile.office_tier, 7, "tier"),
        ("billion_value", "Billion-dollar practice", "Reach a $1,000,000,000 valuation.", valuation, 1_000_000_000, "money"),
        ("orbital_bar", "Beyond the atmosphere", "Join the Orbital Bar Association.", 1 if "orbital_bar" in owned else 0, None, None),
        ("planetary_nexus", "Justice constellation", "Build the Planetary Justice Nexus.", profile.office_tier, 14, "tier"),
        ("rival_network", "Friendly competition", "Acquire five rival firms.", rivals_owned, 5, "firms"),
    ]
    state = []
    for key, name, description, current, target, unit in values:
        entry = {
            "key": key,
            "name": name,
            "description": description,
            "unlocked": current >= (target if target is not None else 1),
        }
        if target is not None:
            entry["progress"] = {
                "current": round(float(current), 1),
                "target": float(target),
                "unit": unit,
            }
        state.append(entry)
    return state


def _public_asset(item: dict, profile: PlayerProfile, owned: set[str], held: set[str] | None = None) -> dict:
    # `payout_mult` and `passive_hourly` are published as numbers because the
    # office scene reports what each item contributes, and it has to be able to
    # tell a genuine hourly earner from a case multiplier from a cosmetic that
    # earns nothing. Both values already reach the client inside `benefit`, and
    # `_rebalance_asset_catalog` writes that string from these exact fields, so
    # publishing them leaks nothing new -- it only stops a reader of the economy
    # having to parse display copy, which would break silently the first time a
    # benefit was reworded.
    #
    # The rest stay private. Nothing outside the settlement path needs them, and
    # `staff_flat` and `storage_hours` in particular are already described in
    # `benefit` for the one screen that mentions them.
    private_effects = {
        "staff_flat", "storage_hours",
        "streak_bonus_cap", "contract_bonus_mult", "reputation_guard",
        "decor_cases",
    }
    public = {key: value for key, value in item.items() if key not in private_effects}
    if item["type"] == "rival":
        discount_bps = rival_discount_bps(profile, item["key"])
        public["list_cost"] = item["cost"]
        public["discount_bps"] = discount_bps
        public["cost"] = _asset_cost(profile, item)
    if item["type"] == "connection":
        # The office draws one seal per connection and, until now, had no way to
        # tell them apart or to know whether the network had been used for
        # anything. Publishing the districts it gates lets the relationship wall
        # read directly off the map: a seal for a network you own, a ribbon for
        # each district that network let you sign.
        district_keys = CONNECTION_DISTRICTS.get(item["key"], [])
        public["districts"] = [
            {"key": key, "name": DISTRICT_BY_KEY[key]["name"], "held": key in (held or set())}
            for key in district_keys
        ]
        public["districts_held"] = sum(1 for key in district_keys if key in (held or set()))
    public["owned"] = item["key"] in owned
    public["available"] = not public["owned"] and _requirements_met(item, profile, owned)
    public["requirements"] = _requirement_copy(item)
    return public


def _asset_cost(profile: PlayerProfile, item: dict) -> int:
    if item["type"] != "rival":
        return item["cost"]
    return max(1, round(item["cost"] * (10_000 - rival_discount_bps(profile, item["key"])) / 10_000))


def _public_client(client: dict, profile: PlayerProfile, owned: set[str]) -> dict:
    public = dict(client)
    public["requirements"] = _requirement_copy(client)
    contract = next((value for value in profile.client_contracts if value.client_key == client["key"]), None)
    public["unlocked"] = _requirements_met(client, profile, owned) or contract is not None
    public["selected"] = profile.active_client_key == client["key"]
    public["on_hold"] = public["selected"] and not public["unlocked"]
    public["contract"] = (
        {
            "cases_remaining": contract.cases_remaining,
            "completed_contracts": contract.completed_contracts,
            "loyalty": contract.loyalty,
        }
        if contract
        else None
    )
    return public


def _next_milestone(profile: PlayerProfile, owned: set[str]) -> dict | None:
    eligible_assets = sorted(
        (
            item
            for item in ASSETS
            if item["key"] not in owned and _requirements_met(item, profile, owned)
        ),
        key=lambda item: _asset_cost(profile, item),
    )
    if profile.office_tier >= len(FIRM_TIERS) - 1:
        if not eligible_assets:
            return None
        item = eligible_assets[0]
        return {"kind": "asset", "name": item["name"], "cost": _asset_cost(profile, item), "reputation": item.get("reputation", 0)}
    tier = FIRM_TIERS[profile.office_tier + 1]
    missing_tier_assets = set(_missing_tier_assets(tier["tier"], owned))
    if missing_tier_assets:
        # Never advertise a locked headquarters as the next goal. Prefer a
        # currently purchasable required item, then another available purchase
        # (often a connection needed by an acquisition), and finally the first
        # locked required item when reputation is the remaining blocker.
        required_and_eligible = [item for item in eligible_assets if item["key"] in missing_tier_assets]
        candidates = required_and_eligible or eligible_assets
        if candidates:
            item = candidates[0]
        else:
            item = min(
                (ASSET_BY_KEY[key] for key in missing_tier_assets),
                key=lambda value: _asset_cost(profile, value),
            )
        return {"kind": "asset", "name": item["name"], "cost": _asset_cost(profile, item), "reputation": item.get("reputation", 0)}
    if eligible_assets and _asset_cost(profile, eligible_assets[0]) <= tier["cost"]:
        item = eligible_assets[0]
        return {"kind": "asset", "name": item["name"], "cost": _asset_cost(profile, item), "reputation": item.get("reputation", 0)}
    return {"kind": "tier", "name": tier["name"], "cost": tier["cost"], "reputation": tier["reputation"]}


def daily_reward_for_tier(tier: int, milestone: int) -> int:
    """Cash for claiming the ``milestone``-case daily goal at firm ``tier``.

    Priced off the tier's own case value rather than off the client the player
    happens to have selected -- see DAILY_REWARD_CASE_BUDGET. Kept free of
    `PlayerProfile` so `scripts/simulate_economy_curve.py` can put real daily
    income into the curve instead of modelling it a second time.
    """
    share = DAILY_REWARD_MULTIPLIERS[milestone] / sum(DAILY_REWARD_MULTIPLIERS.values())
    return _round_game_amount(_case_target_for_tier(tier) * DAILY_REWARD_CASE_BUDGET * share)


def _daily_reward_amount(profile: PlayerProfile, milestone: int) -> int:
    return daily_reward_for_tier(profile.office_tier, milestone)


def serialize_game(profile: PlayerProfile, include_catalog: bool = True) -> dict:
    owned = _owned_keys(profile)
    # Read alongside `owned` for the same reason: the upkeep block and the
    # territory block each need the held districts, and each used to fetch them.
    held = _held_district_keys(profile)
    daily = _daily(profile, persist=False)
    active_client = CLIENT_BY_KEY.get(profile.active_client_key, CLIENT_BY_KEY["walk_in"])
    active_client_public = _public_client(active_client, profile, owned)
    active_contract = next(
        (value for value in profile.client_contracts if value.client_key == active_client["key"]),
        None,
    )
    story = serialize_story(profile)
    rival_targets = []
    for rival in RIVALS:
        if rival["key"] in owned:
            continue
        rival_targets.append({
            **_public_asset(rival, profile, owned),
            "operations": operation_catalog(profile, rival),
        })
    story["rival_targets"] = rival_targets
    payload = {
        "id": profile.id,
        "lawyer_name": profile.lawyer_name,
        "firm_name": profile.firm_name,
        "character_gender": profile.character_gender,
        "cash": profile.cash,
        "reputation": round(profile.reputation, 1),
        "reputation_band": _reputation_band(profile.reputation),
        "office_tier": profile.office_tier,
        "office": FIRM_TIERS[profile.office_tier],
        "current_streak": profile.current_streak,
        "best_streak": profile.best_streak,
        "daily_streak": profile.daily_streak_current,
        "daily_streak_best": profile.daily_streak_best,
        "streak_form": _streak_form(profile),
        "total_cases": profile.total_cases,
        "total_correct": profile.total_correct,
        "total_validated_correct": profile.total_validated_correct,
        "lifetime_earnings": profile.lifetime_earnings,
        "firm_valuation": _valuation(profile),
        "owned_assets": sorted(owned),
        "active_client": {
            **active_client_public,
            "cases_remaining": active_contract.cases_remaining if active_contract else profile.client_cases_remaining,
            "effective_key": active_client["key"] if active_client_public["unlocked"] else "walk_in",
        },
        "upkeep": _upkeep_state(profile, owned, held),
        "territory": territory_state(profile, held),
        "passive_income": _passive_state(profile, owned),
        "daily": {
            "date": daily.activity_date.isoformat(),
            "cases_completed": daily.cases_completed,
            "claimed": daily.claimed_json or [],
            "goals": [
                {
                    "cases": cases,
                    "reward": _daily_reward_amount(profile, cases),
                    "complete": daily.cases_completed >= cases,
                    "claimed": cases in (daily.claimed_json or []),
                }
                for cases in DAILY_REWARD_MULTIPLIERS
            ],
        },
        "achievements": _achievement_state(profile, owned),
        "next_milestone": _next_milestone(profile, owned),
        "story": story,
        # The effective look travels with every game payload because the 3D rig
        # needs it on first paint, on three different screens. The full catalog
        # is a separate request: only the wardrobe panel ever wants it.
        "cosmetics": wardrobe_selection(profile),
    }
    if include_catalog:
        payload["catalog"] = {
            "assets": [_public_asset(item, profile, owned, held) for item in ASSETS],
            "clients": [_public_client(client, profile, owned) for client in CLIENTS],
            "tiers": [
                {
                    **tier,
                    "owned": tier["tier"] <= profile.office_tier,
                    "next": tier["tier"] == profile.office_tier + 1,
                    "required_assets": _tier_required_asset_keys(tier["tier"]),
                    "missing_assets": _missing_tier_assets(tier["tier"], owned),
                    "available": (
                        tier["tier"] == profile.office_tier + 1
                        and profile.reputation >= tier["reputation"]
                        and not _missing_tier_assets(tier["tier"], owned)
                    ),
                }
                for tier in FIRM_TIERS
            ],
        }
    return payload


def _clean_name(value: object, maximum: int) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(cleaned) < 2 or len(cleaned) > maximum or any(ord(char) < 32 for char in cleaned):
        raise ValueError("invalid_name")
    return cleaned


def create_profile(user, payload: dict) -> PlayerProfile:
    if user.game_profile:
        raise ValueError("profile_exists")
    gender = str(payload.get("character_gender") or "").lower()
    if gender not in {"male", "female"}:
        raise ValueError("invalid_character")
    opened_at = utcnow()
    profile = PlayerProfile(
        user_id=user.id,
        lawyer_name=_clean_name(payload.get("lawyer_name") or user.display_name, 50),
        firm_name=_clean_name(payload.get("firm_name"), 80),
        character_gender=gender,
        cash=STARTING_CASH,
        lifetime_earnings=STARTING_CASH,
        last_passive_collected_at=opened_at,
        upkeep_settled_at=opened_at,
        last_active_at=opened_at,
        daily_streak_current=1,
        daily_streak_best=1,
        daily_streak_last_date=opened_at.date(),
    )
    db.session.add(profile)
    db.session.flush()
    ensure_story_state(profile)
    db.session.add(
        PlayerClientContract(
            profile_id=profile.id,
            client_key="walk_in",
            cases_remaining=CLIENT_BY_KEY["walk_in"]["length"],
        )
    )
    db.session.add(
        LedgerEntry(
            user_id=user.id,
            kind="opening_balance",
            source_id=profile.id,
            amount=STARTING_CASH,
            balance_after=STARTING_CASH,
            detail_json={"label": "First client retainer"},
        )
    )
    _daily(profile)
    db.session.commit()
    return profile


def update_profile(profile: PlayerProfile, payload: dict) -> PlayerProfile:
    if "lawyer_name" in payload:
        profile.lawyer_name = _clean_name(payload["lawyer_name"], 50)
    if "firm_name" in payload:
        profile.firm_name = _clean_name(payload["firm_name"], 80)
    if "character_gender" in payload:
        gender = str(payload["character_gender"]).lower()
        if gender not in {"male", "female"}:
            raise ValueError("invalid_character")
        profile.character_gender = gender
    db.session.commit()
    return profile


_LEDGER_SOURCE_LIMIT = 100


def _scoped_source(profile: PlayerProfile, source_id: str) -> str:
    """Name the playthrough an event belongs to.

    A ledger row is owned by the user so that spending history survives the
    profile being replaced, and `uq_ledger_source` spans
    ``(user_id, kind, source_id)`` to make each event recordable once. The events
    themselves are per-profile facts though: acquiring an asset, reaching a firm
    tier, or resolving a chapter all describe one playthrough. Keyed on the bare
    content key, a replacement profile would collide with the previous profile's
    history and the insert would fail, so the profile is named here. That keeps
    the once-only guarantee while scoping it to the run it describes.

    Every write funnels through `_ledger`, so applying the rule here rather than
    at each call site is what stops a newly added ledger kind from reintroducing
    the collision. `create_profile` is the one exception and needs none: its
    opening balance is keyed on the profile id alone, which already cannot repeat.
    """

    prefix = f"{profile.id}:"
    # Trim the event key rather than the prefix, so a row stays attributable to
    # its profile even in the pathological case of an over-long key.
    return prefix + source_id[: _LEDGER_SOURCE_LIMIT - len(prefix)]


def _ledger(profile: PlayerProfile, kind: str, source_id: str, amount: int, detail: dict) -> None:
    db.session.add(
        LedgerEntry(
            user_id=profile.user_id,
            kind=kind,
            source_id=_scoped_source(profile, source_id),
            amount=amount,
            balance_after=profile.cash,
            detail_json=detail,
        )
    )


def purchase_asset(profile: PlayerProfile, asset_key: str) -> PlayerAsset:
    item = ASSET_BY_KEY.get(asset_key)
    if not item:
        raise ValueError("asset_not_found")
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    owned = _owned_keys(profile)
    if asset_key in owned:
        raise ValueError("already_owned")
    if not _requirements_met(item, profile, owned):
        raise ValueError("requirements_not_met")
    _collect_passive_locked(profile)
    price = _asset_cost(profile, item)
    if profile.cash < price:
        raise ValueError("insufficient_cash")
    profile.cash -= price
    profile.lifetime_spending += price
    asset = PlayerAsset(
        profile_id=profile.id,
        asset_key=asset_key,
        asset_type=item["type"],
        purchase_price=price,
    )
    db.session.add(asset)
    # Demo rewind deletes a stale purchase row; a released hire uniquifies
    # the next ledger key. Both hit `uq_ledger_source` if we write the bare key.
    stale = LedgerEntry.query.filter_by(
        user_id=profile.user_id,
        kind="asset_purchase",
        source_id=_scoped_source(profile, asset_key),
    ).all()
    for row in stale:
        db.session.delete(row)
    if stale:
        db.session.flush()
    prior_purchase = LedgerEntry.query.filter_by(
        user_id=profile.user_id,
        kind="asset_purchase",
        source_id=_scoped_source(profile, asset_key),
    ).first()
    ledger_key = f"{asset_key}:{asset.id}" if prior_purchase else asset_key
    _ledger(profile, "asset_purchase", ledger_key, -price, {"name": item["name"], "type": item["type"], "list_cost": item["cost"]})
    db.session.commit()
    return asset


def release_staff(profile: PlayerProfile, asset_key: str) -> None:
    """Let a hired person go. No refund — nothing in the catalog is sold back.

    Staff are optional. The firm can run with an empty floor, so there is no
    minimum roster to protect. Their bonuses and the office figure leave with
    the `PlayerAsset` row.
    """
    item = ASSET_BY_KEY.get(asset_key)
    if not item:
        raise ValueError("asset_not_found")
    if item["type"] != "staff":
        raise ValueError("not_staff")
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    asset = PlayerAsset.query.filter_by(profile_id=profile.id, asset_key=asset_key).one_or_none()
    if not asset:
        raise ValueError("not_owned")
    _collect_passive_locked(profile)
    asset_id = asset.id
    db.session.delete(asset)
    _ledger(
        profile,
        "staff_release",
        f"{asset_key}:{asset_id}",
        0,
        {"name": item["name"], "type": "staff"},
    )
    db.session.commit()


def secure_district(profile: PlayerProfile, district_key: str) -> dict:
    """Sign a district's institutions to a standing counsel appointment.

    The ledger event is `district_counsel`. It was `district_retainer` until
    migration 0037, which renamed the stored rows; nothing outside this module
    reads the key, but a ledger that says one word and a screen that says
    another is how the client/district confusion started.
    """
    district = DISTRICT_BY_KEY.get(district_key)
    if not district:
        raise ValueError("district_not_found")
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    held = _held_district_keys(profile)
    if district_key in held:
        raise ValueError("district_already_held")
    if _district_locks(profile, district):
        raise ValueError("district_locked")
    _collect_passive_locked(profile)
    price = int(district["cost"])
    if profile.cash < price:
        raise ValueError("insufficient_cash")
    standing_before = _territory_totals(held)["standing"]
    profile.cash -= price
    profile.lifetime_spending += price
    db.session.add(
        PlayerTerritory(
            profile_id=profile.id,
            district_key=district_key,
            region_key=district["region"],
            purchase_price=price,
        )
    )
    held = held | {district_key}
    totals = _territory_totals(held)
    _ledger(
        profile,
        "district_counsel",
        district_key,
        -price,
        {
            "name": district["name"],
            "region": district["region"],
            "standing": district["standing"],
            "rent_relief_bps": district["rent_relief_bps"],
        },
    )
    db.session.commit()
    return {
        "district": district_key,
        "name": district["name"],
        "price": price,
        "standing_gained": round(totals["standing"] - standing_before, 2),
        "region_swept": district["region"] in totals["swept_regions"],
        "territory": territory_state(profile, held),
    }


def choose_story(profile: PlayerProfile, chapter_key: str, choice_key: str) -> dict:
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    cash_before = profile.cash
    result = resolve_story_choice(profile, chapter_key, choice_key)
    cash_change = profile.cash - cash_before
    if cash_change:
        _ledger(profile, "story_choice", chapter_key, cash_change, {"choice": choice_key})
        if cash_change > 0:
            _pay_rent_arrears(profile, source_id=f"income:story:{chapter_key}", detail={"income_source": "story_choice"})
    db.session.commit()
    return result


def activate_quest(profile: PlayerProfile, quest_key: str) -> dict:
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    owned = _owned_keys(profile)
    selected = CLIENT_BY_KEY.get(profile.active_client_key, CLIENT_BY_KEY["walk_in"])
    client = selected if _client_is_unlocked(selected, profile, owned) else CLIENT_BY_KEY["walk_in"]
    cash_before = profile.cash
    result = start_quest(profile, quest_key, base_fee=client["base_fee"])
    cash_change = profile.cash - cash_before
    if cash_change:
        _ledger(profile, "quest_advance", quest_key, cash_change, {"client": client["key"]})
        if cash_change > 0:
            _pay_rent_arrears(profile, source_id=f"income:quest:{quest_key}", detail={"income_source": "quest_advance"})
    db.session.commit()
    return result


def run_rival_operation(profile: PlayerProfile, rival_key: str, operation_key: str) -> dict:
    rival = ASSET_BY_KEY.get(rival_key)
    if not rival or rival["type"] != "rival":
        raise ValueError("rival_not_found")
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    if rival_key in _owned_keys(profile):
        raise ValueError("rival_already_owned")
    result = execute_rival_operation(profile, rival, operation_key)
    _ledger(profile, "rival_operation", f"{rival_key}:{operation_key}", -result["cost"], {"discount_bps": result["discount_bps"]})
    db.session.commit()
    return result


def advance_firm(profile: PlayerProfile, target_tier: int) -> None:
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    if profile.office_tier == target_tier:
        return
    next_tier_number = profile.office_tier + 1
    if target_tier != next_tier_number:
        raise ValueError("invalid_target_tier")
    if next_tier_number >= len(FIRM_TIERS):
        raise ValueError("maximum_tier")
    tier = FIRM_TIERS[next_tier_number]
    if profile.reputation < tier["reputation"]:
        raise ValueError("requirements_not_met")
    if _missing_tier_assets(next_tier_number, _owned_keys(profile)):
        raise ValueError("requirements_not_met")
    if profile.cash < tier["cost"]:
        raise ValueError("insufficient_cash")
    profile.cash -= tier["cost"]
    profile.lifetime_spending += tier["cost"]
    profile.office_tier = next_tier_number
    _ledger(profile, "firm_advancement", str(next_tier_number), -tier["cost"], {"name": tier["name"]})
    db.session.commit()


MEGA_LITIGATION_LEDGER_KIND = "mega_litigation_promotion"

# The promotion hands over a whole tier — its price, its reputation floor, and
# every prerequisite purchase — for nothing but a good morning's test. That is
# a windfall only while it stays rare. Without these two limits the diagnostic
# button was the fastest route through the entire game: nothing stopped a
# student starting a fresh form the moment the last one finalized, so fourteen
# consecutive sittings took a new account from the Wooden Shack to the
# Planetary Justice Nexus without spending a dollar or writing a word of
# reasoning. A day between promotions is what the game already promises the
# player, and the lifetime allowance keeps the free route to a fifth of a
# fifteen-tier ladder: a real head start, never a way of playing.
MEGA_LITIGATION_PROMOTION_COOLDOWN = timedelta(hours=24)
MEGA_LITIGATION_PROMOTION_LIMIT = 3


def mega_litigation_promotion_state(profile: PlayerProfile, now=None) -> dict:
    """Whether a cleared mega-litigation would promote the firm, and why not."""
    now = _as_utc(now) or utcnow()
    used = int(profile.mega_litigation_promotions or 0)
    last = _as_utc(profile.mega_litigation_promoted_at)
    available_at = last + MEGA_LITIGATION_PROMOTION_COOLDOWN if last else None
    if profile.office_tier + 1 >= len(FIRM_TIERS):
        blocked_reason = "max_tier"
    elif used >= MEGA_LITIGATION_PROMOTION_LIMIT:
        blocked_reason = "lifetime_limit"
    elif available_at and available_at > now:
        blocked_reason = "cooldown"
    else:
        blocked_reason = None
    return {
        "available": blocked_reason is None,
        "blocked_reason": blocked_reason,
        "used": used,
        "limit": MEGA_LITIGATION_PROMOTION_LIMIT,
        "remaining": max(0, MEGA_LITIGATION_PROMOTION_LIMIT - used),
        "cooldown_hours": round(MEGA_LITIGATION_PROMOTION_COOLDOWN.total_seconds() / 3600),
        "available_at": _iso_utc(available_at) if blocked_reason == "cooldown" else None,
    }


def grant_mega_litigation_promotion(profile: PlayerProfile, session_id: str) -> dict | None:
    """Promote the firm one tier for winning a mega-litigation.

    This is the one advancement that ignores the tier's cash price, its
    reputation floor, and its prerequisite purchases — the missing prerequisites
    are handed over instead, at no charge, because a firm cannot hold a tier
    whose fittings it does not own. Everything after the promotion is priced
    normally, so a student who skips ahead still has to earn the next one.

    Returns None when there is nothing to grant: the firm is already at the top,
    this run has already paid out, the daily cooldown has not elapsed, or the
    lifetime allowance is spent. Idempotency is real rather than advisory —
    `uq_ledger_source` spans (user_id, kind, source_id) and the source is the
    session, so a second finalization of the same run cannot double-promote.
    """
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    next_tier_number = profile.office_tier + 1
    if next_tier_number >= len(FIRM_TIERS):
        db.session.commit()
        return None
    already_paid = LedgerEntry.query.filter_by(
        user_id=profile.user_id,
        kind=MEGA_LITIGATION_LEDGER_KIND,
        source_id=_scoped_source(profile, session_id),
    ).first()
    if already_paid:
        db.session.commit()
        return None
    granted_at = utcnow()
    allowance = mega_litigation_promotion_state(profile, granted_at)
    if not allowance["available"]:
        db.session.commit()
        return None

    tier = FIRM_TIERS[next_tier_number]
    granted = _missing_tier_assets(next_tier_number, _owned_keys(profile))
    for asset_key in granted:
        item = ASSET_BY_KEY[asset_key]
        db.session.add(
            PlayerAsset(
                profile_id=profile.id,
                asset_key=asset_key,
                asset_type=item["type"],
                purchase_price=0,
            )
        )
    reputation_before = profile.reputation
    # Clients and assets unlock off reputation, so a firm parked at a tier its
    # own standing cannot support would show a floor of locked work.
    if profile.reputation < tier["reputation"]:
        profile.reputation = float(tier["reputation"])
    profile.office_tier = next_tier_number
    profile.mega_litigation_promoted_at = granted_at
    profile.mega_litigation_promotions = allowance["used"] + 1
    detail = {
        "name": tier["name"],
        "tier": next_tier_number,
        "granted_assets": [{"key": key, "name": ASSET_BY_KEY[key]["name"]} for key in granted],
        "waived_cost": tier["cost"],
        "reputation_before": round(reputation_before, 1),
        "reputation_after": round(profile.reputation, 1),
        "allowance": mega_litigation_promotion_state(profile, granted_at),
    }
    _ledger(profile, MEGA_LITIGATION_LEDGER_KIND, session_id, 0, detail)
    db.session.commit()
    return detail


def select_client(profile: PlayerProfile, client_key: str) -> None:
    client = CLIENT_BY_KEY.get(client_key)
    if not client:
        raise ValueError("client_not_found")
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    if not _client_is_unlocked(client, profile, _owned_keys(profile)):
        raise ValueError("requirements_not_met")
    contract = (
        PlayerClientContract.query.populate_existing()
        .filter_by(profile_id=profile.id, client_key=client_key)
        .with_for_update()
        .first()
    )
    if not contract:
        contract = PlayerClientContract(
            profile_id=profile.id,
            client_key=client_key,
            cases_remaining=client["length"],
        )
        db.session.add(contract)
    elif contract.cases_remaining == 0:
        # Re-signing a client whose contract is spent starts a fresh docket. Wins
        # already auto-renew a contract, so this is a defensive guarantee that a
        # player can always replay an existing client and never gets stranded
        # without an available case — even if no new client is unlockable yet.
        contract.cases_remaining = client["length"]
    profile.active_client_key = client_key
    profile.client_cases_remaining = contract.cases_remaining
    db.session.commit()


def _collect_passive_locked(profile: PlayerProfile) -> int:
    state = _passive_state(profile)
    amount = state["available"]
    collected_at = utcnow()
    if amount <= 0:
        profile.last_passive_collected_at = collected_at
        return 0
    profile.cash += amount
    profile.lifetime_earnings += amount
    profile.last_passive_collected_at = collected_at
    _ledger(
        profile,
        "passive_collection",
        collected_at.isoformat(),
        amount,
        {"stored_hours": state["stored_hours"], "hourly_rate": state["hourly_rate"]},
    )
    _pay_rent_arrears(
        profile,
        source_id=f"income:passive:{collected_at.isoformat()}",
        detail={"income_source": "passive_collection"},
    )
    return amount


def collect_passive_income(profile: PlayerProfile) -> int:
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    amount = _collect_passive_locked(profile)
    db.session.commit()
    return amount


def claim_daily_reward(profile: PlayerProfile, milestone: int) -> int:
    if milestone not in DAILY_REWARD_MULTIPLIERS:
        raise ValueError("invalid_milestone")
    profile = _lock_profile(profile)
    _settle_upkeep_locked(profile)
    progress = _daily(profile)
    claimed = list(progress.claimed_json or [])
    if milestone in claimed:
        raise ValueError("already_claimed")
    if progress.cases_completed < milestone:
        raise ValueError("goal_incomplete")
    amount = _daily_reward_amount(profile, milestone)
    claimed.append(milestone)
    progress.claimed_json = sorted(claimed)
    profile.cash += amount
    profile.lifetime_earnings += amount
    _ledger(profile, "daily_reward", f"{progress.activity_date}:{milestone}", amount, {"cases": milestone})
    _pay_rent_arrears(
        profile,
        source_id=f"income:daily:{progress.activity_date}:{milestone}",
        detail={"income_source": "daily_reward"},
    )
    db.session.commit()
    return amount


def _normalize_reasoning(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def _is_reused_reasoning(attempt: Attempt) -> bool:
    normalized = _normalize_reasoning(attempt.reasoning_text)
    if len(normalized) < 12:
        return False
    recent = (
        Attempt.query.filter(
            Attempt.user_id == attempt.user_id,
            Attempt.id != attempt.id,
            Attempt.reasoning_text.isnot(None),
        )
        .order_by(Attempt.created_at.desc())
        .limit(50)
        .all()
    )
    return any(_normalize_reasoning(other.reasoning_text) == normalized for other in recent)


def explanation_band(score: int, has_reasoning: bool = True, reused: bool = False) -> str:
    if not has_reasoning or reused or score < 25:
        return "Invalid"
    if score < 50:
        return "Weak"
    if score < 80:
        return "Good"
    return "Excellent"


# A wrong answer backed by genuinely strong reasoning still reflects real legal
# skill, so it is no longer a total loss. A well-argued miss earns a modest
# consultation fee, keeps a little professional standing, and is shielded from a
# steep reputation drop. Careless or unsupported misses (Weak / Invalid bands)
# still earn nothing and take the full hit, so a correct answer stays clearly the
# most valuable outcome — a thoughtful miss pays only a fraction of a real win.
EFFORT_MISS_MULTIPLIER = {"Good": 0.15, "Excellent": 0.25}
EFFORT_MISS_CREDIT = {"Good": 0.20, "Excellent": 0.30}
EFFORT_MISS_DROP_CAP = {"Good": 2.5, "Excellent": 1.5}

# The mirror case: a *correct* answer whose write-up was graded Invalid. The
# answer key is verified, so the student demonstrably solved the question; the
# Invalid band is one model's judgment of prose, and the same argument rewritten
# can land in a different band. Zeroing the fee and taking a full reputation hit
# on top of that reads as arbitrary, and it lands hardest on beginners who reason
# correctly but write formulaically. So a correct answer settles as a *thin win*
# instead: a reduced consultation fee, partial standing, and a capped drop.
#
# The deterministic failures are deliberately excluded and keep the full Invalid
# consequences, because they are findings rather than judgments: no explanation
# at all, and an explanation repeated verbatim from an earlier case
# (`_is_reused_reasoning`). A thin win also stays worse than a correct answer
# with a merely Weak write-up on every axis, so writing a real argument is still
# what pays.
THIN_WIN_MULTIPLIER = 0.35
THIN_WIN_CREDIT = 0.35
CORRECT_DROP_CAP = 1.5

# A third case the two above do not cover: the write-up was never graded at all.
# `services.settle_uncoached_attempt` settles a finished case with
# `explanation_grade: None` when the coaching provider is unreachable, and a
# missing grade fell through `explanation_band` to "Invalid" — the same verdict
# as prose a grader read and rejected. That is the difference between a failed
# exam and an exam that was never marked, and scoring them alike made the game
# unwinnable during an outage: standing is a rolling mean of `validated_credit`,
# so a run of ungraded-but-correct answers converged reputation on 35 while the
# career floor below (which only lifts a *reward-eligible* case) never applied.
# Tier 3 needs 42. A player answering every question correctly was capped at
# tier 2 of 15, and every quest with a "validated" objective — most of the
# story — was unreachable.
#
# So an ungraded answer is settled on the strength of what is actually known:
# the answer key is verified, the prose is unknown. Correctness carries most of
# the credit and the withheld remainder is the part the grader would have
# supplied, which keeps a working grader strictly the better outcome and gives
# nobody a reason to prefer an outage. Deliberately excluded are the two cases
# where the *absence* of a grade is itself a finding rather than an outage: an
# empty explanation, and one repeated verbatim from an earlier case.
UNGRADED_MULTIPLIER = 0.75
UNGRADED_CREDIT = 0.85

# Reputation is a rolling average over the last thirty settled cases, so with
# almost no history one case moves it several points — the 50.0 default can swing
# 8% on a single data point. Ease the per-case drop ceiling in over the first ten
# cases instead. This scales the ceiling, so every ordering the guards and band
# caps establish is preserved; only the magnitude of an early dent changes.
REPUTATION_WARMUP_CASES = 10
REPUTATION_WARMUP_FLOOR = 0.55


def _score_multiplier(score: int) -> float:
    # Sloppy or rushed correct answers (weak/thin explanations land here) earn a
    # little less than before, so writing a real argument — not just guessing the
    # letter — is what pays. The "solid case" anchor (score 14-16 -> 1.20) and the
    # premium bands above it are unchanged, keeping the catalog pacing intact.
    if score <= 3:
        return .55
    if score <= 7:
        return .65
    if score <= 10:
        return .80
    if score <= 13:
        return 1.00
    if score <= 16:
        return 1.20
    if score <= 18:
        return 1.25
    if score == 19:
        return 1.45
    return 1.70


def _points(
    is_correct: bool,
    band: str,
    elapsed_seconds: int,
    target_seconds: int,
    time_eligible: bool = True,
    raw_elapsed_seconds: int | None = None,
) -> tuple[int, int, int, int]:
    answer_points = 4 if is_correct else 1
    if is_correct:
        explanation_points = {"Invalid": 0, "Weak": 4, "Good": 10, "Excellent": 12}[band]
    else:
        explanation_points = {"Invalid": 0, "Weak": 1, "Good": 2, "Excellent": 2}[band]
    time_points = 0
    if time_eligible and is_correct and band in {"Good", "Excellent"}:
        ratio = elapsed_seconds / max(1, target_seconds)
        if ratio < .25:
            time_points = 0
        elif ratio <= .70:
            time_points = 4
        elif ratio <= 1:
            time_points = 3
        elif ratio <= 1.25:
            time_points = 2
        elif ratio <= 1.5:
            time_points = 1
    total = answer_points + explanation_points + time_points
    if (raw_elapsed_seconds if raw_elapsed_seconds is not None else elapsed_seconds) < target_seconds * .25:
        total = min(total, 8)
    return answer_points, explanation_points, time_points, min(20, total)


def _firm_bonuses(profile: PlayerProfile, owned: set[str], score_mult: float) -> tuple[float, int]:
    multiplier = 1 + profile.office_tier * .06
    staff_flat = 0
    for key in owned:
        item = ASSET_BY_KEY.get(key, {})
        multiplier += float(item.get("payout_mult", 0))
        staff_flat += int(item.get("staff_flat", 0))
    return round(multiplier, 3), round(staff_flat * score_mult)


def snapshot_case_context(profile: PlayerProfile) -> dict:
    """Freeze economy inputs when a question first becomes visible."""
    owned = _owned_keys(profile)
    selected = CLIENT_BY_KEY.get(profile.active_client_key, CLIENT_BY_KEY["walk_in"])
    client = selected if _client_is_unlocked(selected, profile, owned) else CLIENT_BY_KEY["walk_in"]
    firm_multiplier, _ = _firm_bonuses(profile, owned, 1)
    firm_multiplier *= float(client.get("payout_mult", 1))
    staff_flat = sum(int(ASSET_BY_KEY[key].get("staff_flat", 0)) for key in owned if key in ASSET_BY_KEY)
    streak_cap = .20 + sum(float(ASSET_BY_KEY[key].get("streak_bonus_cap", 0)) for key in owned if key in ASSET_BY_KEY)
    contract_mult = 2 + float(client.get("contract_bonus_mult", 0)) + sum(float(ASSET_BY_KEY[key].get("contract_bonus_mult", 0)) for key in owned if key in ASSET_BY_KEY)
    public_charter = bool(
        profile.story_state
        and (profile.story_state.choices_json or {}).get("charter_of_counsel") == "public_charter"
    )
    reputation_win_bonus = float(client.get("reputation_win_bonus", 0)) * (1.5 if public_charter else 1)
    return {
        "rule_version": RULE_VERSION,
        "client_key": client["key"],
        "base_fee": client["base_fee"],
        "firm_multiplier_bps": round(firm_multiplier * 10_000),
        "staff_flat": staff_flat,
        "streak_cap_bps": round(streak_cap * 10_000),
        "contract_bonus_mult_bps": round(contract_mult * 10_000),
        "minimum_score_multiplier_bps": round(float(client.get("minimum_score_multiplier", 0)) * 10_000),
        "client_reputation_guard_bps": round(float(client.get("reputation_guard", 0)) * 10_000),
        "client_matter_type": client.get("matter_type", "commercial"),
        "client_reputation_win_bonus_bps": round(reputation_win_bonus * 10_000),
        "client_reputation_loss_cap_bps": round(float(client.get("reputation_loss_cap", 4)) * 10_000),
        "active_client_key": profile.active_client_key,
        "captured_at": _iso_utc(utcnow()),
    }


def _new_reputation(user_id: str, current_attempt_id: str, credit: float) -> float:
    prior = (
        AttemptSettlement.query.filter(
            AttemptSettlement.user_id == user_id,
            AttemptSettlement.attempt_id != current_attempt_id,
        )
        .order_by(AttemptSettlement.created_at.desc())
        .limit(29)
        .all()
    )
    credits = [entry.validated_credit for entry in reversed(prior)] + [credit]
    newest = credits[-10:]
    older = credits[:-10]
    weighted_points = sum(older) + 2 * sum(newest)
    weight = len(older) + 2 * len(newest)
    if len(credits) < 10:
        provisional = 10 - len(credits)
        weighted_points += provisional
        weight += provisional * 2
    return round(max(0, min(100, 100 * weighted_points / max(1, weight))), 1)


def _reputation_warmup(settled_cases: int) -> float:
    """Scale a per-case reputation drop down while the record is still thin.

    Returns REPUTATION_WARMUP_FLOOR on the very first case and reaches 1.0 (full
    sensitivity) at REPUTATION_WARMUP_CASES. Applied as a multiplier on the
    already-capped ceiling so guards, band caps, and pro bono protection keep
    their relative ordering.
    """
    if settled_cases >= REPUTATION_WARMUP_CASES:
        return 1.0
    span = 1.0 - REPUTATION_WARMUP_FLOOR
    return REPUTATION_WARMUP_FLOOR + span * (max(0, settled_cases) / REPUTATION_WARMUP_CASES)


def serialize_settlement(settlement: AttemptSettlement | None) -> dict | None:
    if not settlement:
        return None
    return {
        "id": settlement.id,
        "rule_version": settlement.rule_version,
        "explanation_grade": settlement.explanation_grade,
        "explanation_score": settlement.explanation_score,
        "score": settlement.total_score,
        "breakdown": {
            "answer": settlement.answer_points,
            "explanation": settlement.explanation_points,
            "time": settlement.time_points,
        },
        "timing": {"elapsed_seconds": settlement.elapsed_seconds, "target_seconds": settlement.target_time_seconds},
        "client_key": settlement.client_key,
        "base_fee": settlement.base_fee,
        "score_multiplier": settlement.score_multiplier_bps / 10_000,
        "firm_multiplier": settlement.firm_multiplier_bps / 10_000,
        "streak_bonus": settlement.streak_bonus,
        "staff_bonus": settlement.staff_bonus,
        "contract_bonus": settlement.contract_bonus,
        "quest_bonus": settlement.quest_bonus,
        "payout": settlement.payout,
        "reputation_before": round(settlement.reputation_before, 1),
        "reputation_after": round(settlement.reputation_after, 1),
        "reputation_change": round(settlement.reputation_change, 1),
        "created_at": _iso_utc(settlement.created_at),
    }


def settle_attempt(attempt: Attempt, coaching: dict) -> AttemptSettlement | None:
    """Apply the graded case once. Returns None when the player has not onboarded yet."""
    existing = AttemptSettlement.query.filter_by(attempt_id=attempt.id).first()
    if existing:
        return existing
    if attempt.session_item.game_context_json is None:
        # Attempts created before the tycoon rules were introduced are never paid retroactively.
        return None
    profile = lock_user_profile(attempt.user_id)
    if not profile:
        return None
    settled_at = utcnow()
    _settle_upkeep_locked(profile, settled_at)
    locked_attempt = (
        Attempt.query.populate_existing()
        .filter_by(id=attempt.id)
        .with_for_update()
        .one()
    )
    existing = AttemptSettlement.query.filter_by(attempt_id=locked_attempt.id).first()
    if existing:
        return existing

    # A grade of None is an outage, not a verdict — see UNGRADED_MULTIPLIER.
    graded = coaching.get("explanation_grade") is not None
    raw_score = int(coaching.get("explanation_grade") or 0)
    reused = _is_reused_reasoning(locked_attempt)
    band = explanation_band(raw_score, bool(locked_attempt.reasoning_text), reused)
    if reused:
        raw_score = 0
        coaching["explanation_grade"] = 0
        coaching["reasoning_verdict"] = "unsupported"
        coaching["reasoning_summary"] = "This explanation repeats reasoning used on an earlier case, so it cannot validate this answer."

    elapsed_seconds = max(1, round(locked_attempt.server_elapsed_ms / 1000))
    # Time spent inside an enforced strategy gate is scaffolding, not
    # deliberation, and charging it against the pace target would make choosing
    # to use an approach cost money. The raw clock is still what the "too fast
    # to have read it" floor looks at, because that guard is about whether the
    # student was in the question at all.
    scored_seconds = max(1, elapsed_seconds - round((locked_attempt.strategy_gate_ms or 0) / 1000))
    target_seconds = locked_attempt.session_item.target_time_seconds or 150
    answer_points, explanation_points, time_points, total_score = _points(
        locked_attempt.is_correct,
        band,
        scored_seconds,
        target_seconds,
        time_eligible=not locked_attempt.session_item.timer_compromised,
        raw_elapsed_seconds=elapsed_seconds,
    )
    # A correct answer whose write-up never reached a grader (see
    # UNGRADED_MULTIPLIER). Verified correctness is enough to settle the case as
    # a win; only the prose portion of the reward is withheld.
    ungraded_win = (
        not graded
        and locked_attempt.is_correct
        and bool(locked_attempt.reasoning_text)
        and not reused
    )
    reward_eligible = locked_attempt.is_correct and (band != "Invalid" or ungraded_win)
    # A wrong answer with a Good/Excellent explanation is a well-reasoned miss:
    # it earns a small consultation fee instead of nothing (see EFFORT_MISS_*).
    effort_eligible = (not locked_attempt.is_correct) and band in EFFORT_MISS_MULTIPLIER
    # A right answer whose write-up a grader read and rejected — neither blank
    # nor a verbatim repeat: a thin win rather than a total loss (see THIN_WIN_*).
    thin_win = (
        locked_attempt.is_correct
        and band == "Invalid"
        and not ungraded_win
        and bool(locked_attempt.reasoning_text)
        and not reused
    )
    paid_case = reward_eligible or effort_eligible or thin_win
    owned = _owned_keys(profile)
    context = locked_attempt.session_item.game_context_json
    if context is None:
        return None
    if ungraded_win:
        score_mult = max(UNGRADED_MULTIPLIER, int(context.get("minimum_score_multiplier_bps") or 0) / 10_000)
    elif reward_eligible:
        score_mult = max(_score_multiplier(total_score), int(context.get("minimum_score_multiplier_bps") or 0) / 10_000)
    elif thin_win:
        score_mult = THIN_WIN_MULTIPLIER
    elif effort_eligible:
        score_mult = EFFORT_MISS_MULTIPLIER[band]
    else:
        score_mult = 0.0
    client = CLIENT_BY_KEY.get(context.get("client_key"), CLIENT_BY_KEY["walk_in"])
    base_fee = int(context.get("base_fee") or client["base_fee"])
    firm_mult = int(context.get("firm_multiplier_bps") or 10_000) / 10_000
    # Support staff and streaks amplify decisive wins only; a miss pays the base
    # consultation fee so accuracy stays clearly the more valuable outcome.
    staff_bonus = round(int(context.get("staff_flat") or 0) * score_mult) if reward_eligible else 0

    # An ungraded win counts as validated: quest objectives, casework, and the
    # streak all key off this, and an outage must not make the story unreachable.
    validated = locked_attempt.is_correct and (band in {"Good", "Excellent"} or ungraded_win)
    if not locked_attempt.is_correct:
        profile.current_streak = 0
    elif validated:
        profile.current_streak += 1
        profile.best_streak = max(profile.best_streak, profile.current_streak)
    # Before the reputation floor below reads it: today has to be on the board
    # already, or the first finished case of a new day would be licensed against
    # yesterday's day count.
    if reward_eligible or effort_eligible:
        _touch_daily_streak(profile, settled_at)
    core_payout = round(base_fee * score_mult * firm_mult) if paid_case else 0
    streak_cap = int(context.get("streak_cap_bps") or 2_000) / 10_000
    streak_bonus = round(core_payout * min(streak_cap, profile.current_streak * .02)) if validated else 0
    contract_bonus = 0
    contract = (
        PlayerClientContract.query.populate_existing()
        .filter_by(profile_id=profile.id, client_key=client["key"])
        .with_for_update()
        .first()
    )
    if contract and reward_eligible:
        # Only decisive wins advance and renew a client's contract, so the
        # intended "3-5 good cases per office" pacing is preserved and a
        # thoughtful miss simply keeps you on the same open matter.
        contract.cases_remaining = max(0, contract.cases_remaining - 1)
        contract.loyalty += 1
        if contract.cases_remaining == 0:
            contract_mult = int(context.get("contract_bonus_mult_bps") or 20_000) / 10_000
            contract_bonus = round(base_fee * contract_mult)
            contract.completed_contracts += 1
            # Re-sign the client automatically: a finished contract rolls into a
            # fresh docket so the player is never left without a case to work.
            contract.cases_remaining = client["length"]
        if profile.active_client_key == client["key"]:
            profile.client_cases_remaining = contract.cases_remaining
    standard_payout = max(1, core_payout + streak_bonus + staff_bonus + contract_bonus) if paid_case else 0

    credit = 0.0
    if ungraded_win:
        credit = UNGRADED_CREDIT
    elif locked_attempt.is_correct:
        credit = 1.0 if band in {"Good", "Excellent"} else .5 if band == "Weak" else THIN_WIN_CREDIT if thin_win else 0.0
    elif effort_eligible:
        # Partial standing for a well-argued wrong answer lifts the rolling
        # average, so a thoughtful miss dents reputation far less than a guess.
        credit = EFFORT_MISS_CREDIT[band]
    reputation_before = profile.reputation
    reputation_after = _new_reputation(profile.user_id, locked_attempt.id, credit)
    projected_correct = profile.total_correct + int(locked_attempt.is_correct)
    projected_validated = profile.total_validated_correct + int(validated)
    reputation_guard = int(context.get("client_reputation_guard_bps") or 0) / 10_000
    reputation_guard += sum(float(ASSET_BY_KEY[key].get("reputation_guard", 0)) for key in owned if key in ASSET_BY_KEY)
    maximum_drop = max(.5, 4 - reputation_guard)
    if locked_attempt.is_correct:
        # Solving the question is the signal the app is actually teaching. However
        # the write-up reads, a verified-correct answer never moves standing the
        # way a miss can (see CORRECT_DROP_CAP).
        maximum_drop = min(maximum_drop, CORRECT_DROP_CAP)
    if effort_eligible:
        # A genuinely well-reasoned miss should never collapse a reputation the
        # way a careless one can, regardless of how thin the rolling average is.
        maximum_drop = min(maximum_drop, EFFORT_MISS_DROP_CAP[band])
    if context.get("client_matter_type") == "pro_bono":
        maximum_drop = min(maximum_drop, int(context.get("client_reputation_loss_cap_bps") or 5_000) / 10_000)
    maximum_drop *= _reputation_warmup(profile.total_cases)
    reputation_after = round(max(reputation_after, reputation_before - maximum_drop), 1)
    if reward_eligible:
        # District standing and streak standing are one argument on purpose.
        # `_career_floor` caps `casework + standing` at
        # TERRITORY_STANDING_FLOOR_CEILING, so the two add up under a single
        # shared ceiling rather than forming two ladders that each try to reach
        # the top of the game on their own.
        career_floor = _career_floor(
            projected_correct,
            projected_validated,
            territory_standing(profile) + streak_standing(profile),
        )
        reputation_after = round(max(reputation_after, career_floor), 1)
        reputation_after = min(100, round(reputation_after + int(context.get("client_reputation_win_bonus_bps") or 0) / 10_000, 1))

    profile.reputation = reputation_after
    quest_result = advance_quest(
        profile,
        validated=validated,
        correct=locked_attempt.is_correct,
        band=band,
        base_fee=base_fee,
    )
    if quest_result.get("completed") == FINAL_CASE_KEY:
        profile.game_completed_at = settled_at
        profile.upkeep_settled_at = settled_at
        profile.last_active_at = settled_at
    quest_bonus = int(quest_result["quest_bonus"])
    payout = standard_payout + quest_bonus
    # Quest cash rewards are applied by the story engine with their other
    # persistent effects. Add only the standard case portion here.
    profile.cash += standard_payout
    profile.lifetime_earnings += standard_payout
    reputation_after = profile.reputation
    profile.total_cases += 1
    profile.total_correct += int(locked_attempt.is_correct)
    profile.total_validated_correct += int(validated)
    daily = _daily(profile)
    if reward_eligible or effort_eligible:
        # A thin win is paid but deliberately does not tick a daily goal: the
        # daily bonuses are the one place where writing a real argument, not just
        # picking the right letter, still has to be earned.
        daily.cases_completed += 1

    settlement = AttemptSettlement(
        attempt_id=locked_attempt.id,
        user_id=locked_attempt.user_id,
        rule_version=RULE_VERSION,
        explanation_grade=band,
        explanation_score=raw_score,
        answer_points=answer_points,
        explanation_points=explanation_points,
        time_points=time_points,
        total_score=total_score,
        target_time_seconds=target_seconds,
        elapsed_seconds=elapsed_seconds,
        client_key=client["key"],
        base_fee=base_fee,
        score_multiplier_bps=round(score_mult * 10_000),
        firm_multiplier_bps=round(firm_mult * 10_000),
        streak_bonus=streak_bonus,
        staff_bonus=staff_bonus,
        contract_bonus=contract_bonus,
        quest_bonus=quest_bonus,
        payout=payout,
        reputation_before=reputation_before,
        reputation_after=reputation_after,
        reputation_change=round(reputation_after - reputation_before, 1),
        validated_credit=credit,
    )
    db.session.add(settlement)
    db.session.flush()
    _ledger(
        profile,
        "case_payout",
        locked_attempt.id,
        payout,
        {"score": total_score, "grade": band, "client": client["key"], "rule_version": RULE_VERSION},
    )
    _pay_rent_arrears(
        profile,
        source_id=f"income:case:{locked_attempt.id}",
        detail={"income_source": "case_payout"},
    )
    return settlement


def pending_review_attempts(user_id: str) -> list[str]:
    rows = (
        Attempt.query.join(SessionItem).outerjoin(AttemptSettlement)
        .filter(
            Attempt.user_id == user_id,
            SessionItem.game_context_json.isnot(None),
            AttemptSettlement.id.is_(None),
            or_(Attempt.coaching_status == "pending", Attempt.coaching_status == "failed"),
        )
        .order_by(Attempt.created_at.desc())
        .limit(10)
        .all()
    )
    return [attempt.id for attempt in rows]
