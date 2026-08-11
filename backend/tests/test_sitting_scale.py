"""The sitting got shorter and nothing else was allowed to move.

A practice run went from ten questions to six (`game.SITTING_QUESTIONS`). The
whole point of the exercise was that this is a change to the *shape* of a
session and not to the economy underneath it, so what these tests guard is the
absence of a change: the campaign is the same length, the same number of
questions, and every progress bar the player watches is the same length or
shorter.

Why these exist separately from the band tests in `test_game_catalog.py`: those
bound each rung to one-to-two hours, which is a 2x window, and the campaign to
93-186 hours. Real drift hides comfortably inside that. The first version of
this change came out 2.2% shorter than the ladder it replaced and every band
test passed. So the figures below are pinned against the ladder as it stood at
`82acaf6`, the commit before the sitting moved, and the tolerance is tight
enough to catch a percent.

If one of these fails after a deliberate retune, the right response is to
re-measure with `scripts/simulate_economy_curve.py`, state the new figure and
why it moved, and update the constant here. The wrong response is to widen the
tolerance.
"""

from __future__ import annotations

import pytest

from app import PRACTICE_QUEUE_QUESTIONS, create_app
from app.game import (
    ASSETS,
    CLIENTS,
    DAILY_REWARD_MULTIPLIERS,
    FIRM_TIERS,
    LEGACY_CONTRACT_BONUS_MULTS,
    LEGACY_CONTRACT_LENGTHS,
    LEGACY_SITTING_QUESTIONS,
    SITTING_QUESTIONS,
    TERRITORY_STANDING_CAP,
    TERRITORY_STANDING_FLOOR_CEILING,
)
from app.services import PASSAGE_OVERSHOOT_ALLOWANCE, passage_overshoot_allowance
from scripts.simulate_economy_curve import Player, curve, total_campaign, upgrade_band

# The campaign as it stood at 82acaf6, measured with the same script on the same
# default player: 2,085.68 played cases, 121.95 hours on cases, and a per-upgrade
# band of 17.38 to 29.31 cases. Every one of these is a *question* count; see
# SITTING_QUESTIONS for why that distinction is worth a comment.
BASELINE_CAMPAIGN_CASES = 2085.7
BASELINE_UPGRADE_BAND = (17.38, 29.31)

# The same measurement for each player the script models, so a change that holds
# the average by moving two scenarios in opposite directions is still caught.
BASELINE_BY_SCENARIO = {
    "realistic": (Player(), 2085.7),
    "flawless": (Player(accuracy=1.0), 1275.9),
    "pro bono docket": (Player(pro_bono=True), 3241.1),
    "grader outage": (Player(ungraded_share=0.2), 2190.4),
    "rent retired": (Player(rent_relief_share=1.0), 2060.8),
    "light day": (Player(cases_per_day=6.0), 1844.4),
    "never collects idle": (Player(passive_collections_per_day=0.0), 2335.4),
    "never claims dailies": (Player(claims_dailies=False), 2311.7),
}

# How far any of the above may drift. The rescale as it stands lands within
# 0.05%; 1% is loose enough not to fail on a rounding change somewhere unrelated
# and tight enough that the 2.2% miss this test was written for cannot pass.
TOLERANCE = 0.01


def test_the_campaign_is_the_same_length_it_was_before_the_run_was_shortened():
    """Total question volume and total playtime, the two stated invariants.

    They are one measurement, not two: the script converts cases to hours with a
    fixed per-question budget, so pinning the case count pins the hours. Both are
    asserted anyway, because the conversion is exactly the sort of thing that
    gets "fixed" by a later session and the failure should say which half moved.
    """
    cases, hours = total_campaign(Player())
    assert cases == pytest.approx(BASELINE_CAMPAIGN_CASES, rel=TOLERANCE), (
        f"{cases:,.1f} played cases against a baseline of {BASELINE_CAMPAIGN_CASES:,.1f}"
    )
    assert hours == pytest.approx(121.95, rel=TOLERANCE), f"{hours:.2f} hours"


def test_no_scenario_the_simulation_models_changed_length():
    for label, (player, baseline) in BASELINE_BY_SCENARIO.items():
        cases, _ = total_campaign(player)
        assert cases == pytest.approx(baseline, rel=TOLERANCE), (
            f"{label}: {cases:,.1f} played cases against a baseline of {baseline:,.1f}"
        )


def test_one_upgrade_still_costs_the_same_stretch_of_play():
    """The band the whole ladder is priced against, cheapest rung to dearest.

    `test_game_catalog` asserts this lands inside one to two hours. This asserts
    it landed on the *same* number it did before, which is a much narrower claim
    and the one that catches a rescale quietly making the early game cheaper.
    """
    low, high = upgrade_band(curve(Player()))
    assert low == pytest.approx(BASELINE_UPGRADE_BAND[0], rel=TOLERANCE), f"floor {low:.2f}"
    assert high == pytest.approx(BASELINE_UPGRADE_BAND[1], rel=TOLERANCE), f"ceiling {high:.2f}"


def test_no_contract_got_longer_when_the_run_got_shorter():
    """The user's own condition: three wins must not become six chores.

    A contract length is a player-visible progress bar on the client card, and it
    counts decisive wins, so it is denominated in questions. Leaving it alone
    while the run shrank would have doubled the number of runs each bar takes to
    fill without a single number on screen changing — the worst kind of
    regression, because nothing looks different.

    One-directional on purpose. A future session is free to shorten a contract
    further; it may never lengthen one past what the ten-question era asked for.
    """
    assert LEGACY_CONTRACT_LENGTHS, "the rescale did not run, so nothing here is being checked"
    for client in CLIENTS:
        was = LEGACY_CONTRACT_LENGTHS[client["key"]]
        assert client["length"] <= was, f"{client['key']}: {was} wins -> {client['length']}"


def test_a_contract_still_takes_about_as_many_runs_to_close():
    """The bar advances at the same rate per finished run, which is what is felt.

    A quarter of a run of slack, which is loose against what the catalog actually
    does and tight against the failure this guards. Rounding to whole wins can
    only ever cost half a win, an twelfth of a run, and the worst contract in the
    catalog drifts a tenth — `serial_plaintiff`, four wins, held at the
    three-win floor rather than the 2.4 the ratio asks for. Leaving the lengths
    alone entirely, which is the mistake this exists to catch, drifts a contract
    by half a run.
    """
    for client in CLIENTS:
        was_runs = LEGACY_CONTRACT_LENGTHS[client["key"]] / LEGACY_SITTING_QUESTIONS
        now_runs = client["length"] / SITTING_QUESTIONS
        assert abs(now_runs - was_runs) <= 0.25, (
            f"{client['key']}: {was_runs:.2f} runs -> {now_runs:.2f} runs"
        )
        assert client["length"] >= 3


def test_a_contract_bonus_is_worth_the_same_per_question():
    """The one thing in this change that moved money, and the reason it did.

    A contract bonus is a multiple of the fee paid once, when the contract
    closes. Its value per question is therefore `bonus / length`, so halving
    every length while leaving the bonus alone would have doubled what these
    eight assets are worth without moving their prices. That is not a rounding
    detail: it was the whole of the 2.2% the first attempt came out short.

    Scaled with the sitting, the bonus per question of contract is what it was.
    """
    assert LEGACY_CONTRACT_BONUS_MULTS, "the rescale did not run, so nothing here is being checked"
    for item in ASSETS:
        if not item.get("contract_bonus_mult"):
            continue
        was = LEGACY_CONTRACT_BONUS_MULTS[item["key"]] / LEGACY_SITTING_QUESTIONS
        now = item["contract_bonus_mult"] / SITTING_QUESTIONS
        assert now == pytest.approx(was, rel=0.02), f"{item['key']}: {was:.4f} -> {now:.4f} per question"


def test_every_daily_goal_lands_at_the_end_of_a_run():
    """A goal that closes mid-run is a reward the player has to stop short for.

    This is the reason the goals are 6/12/18 rather than a straight rescale of
    5/10/20, and the reason 20 was not kept as the top goal even though the curve
    cannot tell the two apart. See DAILY_REWARD_MULTIPLIERS.
    """
    for milestone in DAILY_REWARD_MULTIPLIERS:
        assert milestone % SITTING_QUESTIONS == 0, f"goal at {milestone} questions is mid-run"
    assert sorted(DAILY_REWARD_MULTIPLIERS) == [
        SITTING_QUESTIONS,
        SITTING_QUESTIONS * 2,
        SITTING_QUESTIONS * 3,
    ]


def test_the_day_still_asks_for_about_as_much_work_as_it_did():
    """Question volume, at the scale the player meets it: one day.

    The top goal fell from 20 questions to 18 to land on a run boundary. That is
    the single place this change asks for less than it did, it is a tenth, and it
    is bounded here so a later session cannot widen it into a real cut. The
    number of *finished runs* the day asks for went up, 2 to 3, which is the
    trade.
    """
    top_goal = max(DAILY_REWARD_MULTIPLIERS)
    legacy_top_goal = 20
    assert top_goal >= legacy_top_goal * 0.9, f"the day now asks for {top_goal} questions, was {legacy_top_goal}"
    assert top_goal / SITTING_QUESTIONS > legacy_top_goal / LEGACY_SITTING_QUESTIONS


def test_district_standing_still_cannot_buy_the_last_headquarters():
    """Map play must not skip a career rung, and nothing here was rescaled.

    Both halves are in reputation points, not cases, so the sitting does not
    reach them — which is exactly why it is worth a test: this relationship is
    load-bearing, undocumented anywhere the player can see, and easy to break
    from a direction that looks unrelated.
    """
    final_headquarters = FIRM_TIERS[-1]["reputation"]
    assert TERRITORY_STANDING_FLOOR_CEILING < final_headquarters
    assert TERRITORY_STANDING_CAP < final_headquarters


def test_the_queue_still_holds_the_same_amount_of_unfinished_work():
    """The cap is on queued *work*, not on presses of the start button.

    Eight ten-question runs was eighty questions. Holding the cap at eight while
    the run shortened would have cut that to forty-eight, and it would have bitten
    the student a shorter run exists to help: the one who picks a case up often.

    Read off a real application rather than recomputed here, because the whole
    risk is that the two derivations disagree.
    """
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "TFY_URL": "",
            "TFY_API_KEY": "",
        }
    )
    cap = int(application.config["PRACTICE_QUEUE_MAX"])
    assert int(application.config["PRACTICE_SESSION_SIZE"]) == SITTING_QUESTIONS
    assert cap * SITTING_QUESTIONS == pytest.approx(PRACTICE_QUEUE_QUESTIONS, abs=SITTING_QUESTIONS)
    assert PRACTICE_QUEUE_QUESTIONS == 8 * LEGACY_SITTING_QUESTIONS


def test_a_run_can_still_finish_almost_every_reading_passage_whole():
    """Passage-mates are served together or the passage is not served at all.

    Blocks are indivisible, so the longest passage a run can serve is its target
    plus whatever overshoot it allows. Measured against the shipped bank with
    `scripts/measure_served_section_mix.py`: 345 of 349 passages are eight
    questions or shorter, which is 97.8% of Reading Comprehension. A ceiling of
    eight therefore keeps essentially the whole section reachable, where a flat
    six-question run reaches 33.5% of it and a flat five reaches 8.6%.

    This is a length invariant as much as a content one. Reading Comprehension is
    budgeted at 330s against Logical Reasoning's 150s, so squeezing RC out of the
    mix makes the average question cheaper and the campaign quietly shorter
    without a single price changing.
    """
    ceiling = SITTING_QUESTIONS + passage_overshoot_allowance(SITTING_QUESTIONS)
    assert ceiling >= 8
    assert passage_overshoot_allowance(SITTING_QUESTIONS) == PASSAGE_OVERSHOOT_ALLOWANCE


def test_a_small_run_is_served_at_the_size_it_asked_for():
    """The allowance is sized for a real run and is nonsense applied to a tiny one.

    A caller asking for two questions and being handed four has not had its run
    stretched, it has had a different run built.
    """
    for count in (1, 2, 3, 4, 5):
        assert count + passage_overshoot_allowance(count) <= count + count / 3 + 1


def test_the_sitting_is_short_enough_to_sit_down_to():
    """The change the user actually asked for, stated as a bound.

    Roughly five to six questions. Measured against the shipped bank a run of six
    with the passage allowance serves 6.19 questions and 15.7 minutes of budgeted
    time, against 10 questions and 25.4 minutes before.
    """
    assert 5 <= SITTING_QUESTIONS <= 6
    assert SITTING_QUESTIONS < LEGACY_SITTING_QUESTIONS
