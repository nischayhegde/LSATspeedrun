"""What the strategy selector actually reaches, and which arm it actually deals.

The eligibility audit next door asks whether the right approaches are *candidates*
for a question. This one asks what happens to them afterwards, because a
candidate the selector can never choose is worth exactly as much as a candidate
that was never eligible.

Three measurements, each taken by running `assign_strategy_trial` rather than by
reading it:

1. **Rank reachability.** With coverage satisfied on every candidate, which ranks
   are ever offered? A selector that only ever picks the leader and the
   runner-up leaves everything below rank 1 permanently unreachable, and since
   an approach that is never offered never gains an observation, it can never
   climb back.
2. **Starvation recovery.** Give one candidate a bad run of luck and let the
   leader keep winning. Does the unlucky one ever come back? This is the
   property that matters more than reachability on a single draw: an approach
   excluded on three observations should not be excluded forever.
3. **Arm stability and its price.** The control arm is a threshold on a hash. If
   nothing in that hash distinguishes one encounter with a question from the
   next, then a question returning to the same slot draws the same arm every
   time, and for a student whose practice is half review that freezes a large
   part of their control arm. Measured separately for fresh and repeated
   encounters, because the design constant is only wrong for the repeats.

Report only, but it writes rows to build the histories it measures, so it runs
inside a transaction it rolls back and should still be pointed at a copy:

    DATABASE_URL=sqlite:////tmp/sel/audit.db python3 scripts/audit_strategy_selection.py

Every number is a property of the code rather than of the fixture: the histories
are synthetic and stated below, and what is being measured is how the selector
responds to them.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("AUTO_SEED", "false")
os.environ.setdefault("FLASK_ENV", "development")

from app import create_app  # noqa: E402
from app import strategies  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import Attempt, Question, SessionItem, StudySession, User, utcnow  # noqa: E402

DRAWS = 400
RECOVERY_DEALS = 240


def _widest_question() -> Question:
    """The question with the most candidates, so ranks 2 and below exist to miss."""
    best: Question | None = None
    best_width = 0
    for question in Question.query.all():
        width = len(strategies._candidate_keys(question))
        if width > best_width:
            best, best_width = question, width
    assert best is not None, "the bank is empty"
    return best


def _student(label: str) -> tuple[User, StudySession]:
    user = User(email=f"{label}-{utcnow().timestamp()}@selection.audit", display_name=label)
    db.session.add(user)
    db.session.flush()
    session = StudySession(
        user_id=user.id, mode="practice", practice_style="cases", status="completed",
        total_items=0, target_minutes=60,
    )
    db.session.add(session)
    db.session.flush()
    return user, session


def _observe(user: User, session: StudySession, question: Question, key: str, index: int, correct: bool) -> None:
    item = SessionItem(
        session_id=session.id, question_id=question.id, position=index, target_time_seconds=150
    )
    db.session.add(item)
    db.session.flush()
    db.session.add(
        Attempt(
            user_id=user.id,
            session_item_id=item.id,
            idempotency_key=f"sel-{user.id}-{key}-{index}",
            selected_label="A",
            is_correct=correct,
            server_elapsed_ms=100_000,
            client_elapsed_ms=100_000,
            confidence=3,
            strategy_key=key,
            strategy_variant=strategies.VARIANT_PROMPT,
            strategy_propensity=1 - strategies.CONTROL_PROBABILITY,
        )
    )
    db.session.flush()


def _deal(user: User, question: Question, position: int, *, exposure: str | None = None) -> dict:
    """One assignment, threading the exposure only where the selector takes one."""
    try:
        return strategies.assign_strategy_trial(
            user.id, question, "cases", position, exposure=exposure
        )
    except TypeError:
        # The pre-fix signature, so the baseline can be measured with this script.
        return strategies.assign_strategy_trial(user.id, question, "cases", position)


def measure_rank_reachability(question: Question) -> dict:
    """Coverage satisfied on every candidate, with an unambiguous true ranking."""
    candidates = strategies._candidate_keys(question)
    user, session = _student("ranks")
    index = 0
    # Candidate i gets (coverage - i) correct out of coverage, floored at one, so
    # the ordering is strict and rank 0 is genuinely the best performer.
    for rank, key in enumerate(candidates):
        correct = max(1, strategies.BASE_COVERAGE_TRIALS - rank)
        for trial in range(strategies.BASE_COVERAGE_TRIALS):
            _observe(user, session, question, key, index, trial < correct)
            index += 1
    dealt: Counter[str] = Counter()
    for position in range(DRAWS):
        dealt[_deal(user, question, position, exposure=f"run-{position}")["key"]] += 1
    return {
        "candidates": candidates,
        "dealt": dict(dealt),
        "never_offered": [key for key in candidates if key not in dealt],
        "reached": len(dealt),
    }


def measure_starvation_recovery(question: Question) -> dict:
    """One candidate unlucky on its coverage observations, and the leader winning.

    The question this answers is not "can rank 2 be dealt once" but "does an
    approach excluded early ever get another look". The leader is given a long
    winning record, which is exactly the condition under which a mean-only score
    keeps choosing it forever.
    """
    candidates = strategies._candidate_keys(question)
    starved, leader = candidates[-1], candidates[0]
    user, session = _student("starved")
    index = 0
    for key in candidates:
        for trial in range(strategies.BASE_COVERAGE_TRIALS):
            # The starved candidate goes 0 for 3; everything else goes 2 of 3.
            _observe(user, session, question, key, index, key != starved and trial < 2)
            index += 1
    # And the leader keeps being dealt and keeps winning, 60 times over.
    for _ in range(60):
        _observe(user, session, question, leader, index, True)
        index += 1
    observations = {
        key: Attempt.query.filter(
            Attempt.user_id == user.id,
            Attempt.strategy_key == key,
            Attempt.strategy_variant.in_(strategies.PROMPT_VARIANTS),
        ).count()
        for key in candidates
    }
    dealt: Counter[str] = Counter()
    first_seen: int | None = None
    for position in range(DRAWS):
        key = _deal(user, question, position, exposure=f"run-{position}")["key"]
        dealt[key] += 1
        if key == starved and first_seen is None:
            first_seen = position
    return {
        "starved": starved,
        "leader": leader,
        "observations": observations,
        "dealt": dict(dealt),
        "starved_share": round(dealt[starved] / DRAWS, 4),
        "draws_before_starved_was_dealt": first_seen,
    }


def measure_recovery(question: Question) -> dict:
    """Can an approach that is genuinely the best, but unlucky early, climb back?

    Reachability on a single draw is the weaker property. This is the one that
    matters: the selector's early verdict rests on three observations, so it will
    sometimes be wrong, and the question is whether being wrong is permanent.

    One candidate is given the highest true accuracy in the set and a coverage
    record of nothing but wrong answers; the rest are given a mediocre true
    accuracy and a clean coverage record. Then the selector is driven for
    `RECOVERY_DEALS` encounters and every assignment is answered according to the
    candidate's true accuracy, so its record grows out of its own performance
    rather than out of a fixture. Outcomes are drawn from the same stable hash as
    everything else here, so the run is reproducible.
    """
    candidates = strategies._candidate_keys(question)
    unlucky = candidates[-1]
    truth = {key: (0.85 if key == unlucky else 0.55) for key in candidates}
    user, session = _student("recovery")
    index = 0
    for key in candidates:
        for trial in range(strategies.BASE_COVERAGE_TRIALS):
            _observe(user, session, question, key, index, key != unlucky and trial < 2)
            index += 1

    dealt: list[str] = []
    for encounter in range(RECOVERY_DEALS):
        key = _deal(user, question, encounter % 10, exposure=f"recovery-{encounter}")["key"]
        dealt.append(key)
        correct = strategies._stable_fraction(f"outcome:{key}:{encounter}") < truth[key]
        _observe(user, session, question, key, index, correct)
        index += 1

    quarter = RECOVERY_DEALS // 4
    first, last = dealt[:quarter], dealt[-quarter:]
    return {
        "unlucky_but_best": unlucky,
        "true_accuracy": truth,
        "deals": RECOVERY_DEALS,
        "share_in_first_quarter": round(first.count(unlucky) / quarter, 4),
        "share_in_last_quarter": round(last.count(unlucky) / quarter, 4),
        "observations_gained": dealt.count(unlucky),
        "leads_at_the_end": Counter(last).most_common(1)[0][0] == unlucky,
    }


def measure_arm_stability(question: Question) -> dict:
    """The control share on encounters that are fresh, and on ones that repeat.

    A repeated encounter is the same question at the same slot, which is what a
    fixed review slot produces. `stable_within_exposure` is the property that
    must not be lost in fixing this: the same exposure, asked twice, has to give
    the same answer, or a student could be flipped mid-question.
    """
    user, _ = _student("arms")

    def control_share(deals: list[dict]) -> float:
        control = sum(1 for deal in deals if deal["variant"] in strategies.CONTROL_VARIANTS)
        return round(control / len(deals), 4)

    fresh = [_deal(user, question, position, exposure=f"run-{position}") for position in range(DRAWS)]
    # The same question at the same slot, met once per run over many runs.
    repeats = [_deal(user, question, 3, exposure=f"run-{index}") for index in range(DRAWS)]
    # And the same exposure asked twice, which must not change its answer.
    twice = [_deal(user, question, 3, exposure="run-7") for _ in range(20)]
    arms = {deal["variant"] for deal in twice}
    keys = {deal["key"] for deal in twice}
    repeat_arms = Counter(deal["variant"] for deal in repeats)
    return {
        "fresh_control_share": control_share(fresh),
        "repeat_control_share": control_share(repeats),
        "stable_within_exposure": len(arms) == 1 and len(keys) == 1,
        # How lopsided the repeats are. A frozen arm shows up as one variant
        # taking every single encounter.
        "repeat_arm_spread": dict(repeat_arms),
        # The propensity the row would carry, against the rate the mechanism
        # actually produced on repeats. These have to agree, or a later IPW fit
        # weights on a number the mechanism never used.
        "recorded_propensity_on_control": strategies.CONTROL_PROBABILITY,
        "realised_control_rate_on_repeats": control_share(repeats),
    }


def audit() -> dict:
    question = _widest_question()
    return {
        "probe_question": {
            "id": question.id,
            "section": question.section,
            "candidates": strategies._candidate_keys(question),
        },
        "draws": DRAWS,
        "rank_reachability": measure_rank_reachability(question),
        "starvation_recovery": measure_starvation_recovery(question),
        "recovery": measure_recovery(question),
        "arm_stability": measure_arm_stability(question),
    }


def _report(result: dict) -> None:
    probe = result["probe_question"]
    print(f"Probe question {probe['id']} ({probe['section']}), {len(probe['candidates'])} candidates")
    print(f"  {probe['candidates']}")

    ranks = result["rank_reachability"]
    print(f"\nRank reachability over {result['draws']} draws, coverage satisfied on all")
    print(f"  dealt: {ranks['dealt']}")
    print(f"  reached {ranks['reached']} of {len(ranks['candidates'])} candidates")
    print(f"  never offered: {ranks['never_offered'] or 'none'}")

    starved = result["starvation_recovery"]
    print(f"\nStarvation recovery: {starved['starved']} went 0 for "
          f"{strategies.BASE_COVERAGE_TRIALS}, {starved['leader']} has been winning")
    print(f"  observations per candidate: {starved['observations']}")
    print(f"  dealt: {starved['dealt']}")
    print(f"  the starved candidate took {starved['starved_share']:.1%} of draws, "
          f"first at draw {starved['draws_before_starved_was_dealt']}")

    recovery = result["recovery"]
    print(f"\nRecovery: {recovery['unlucky_but_best']} is the best approach in the set "
          f"and answered every coverage observation wrong")
    print(f"  over {recovery['deals']} encounters it was dealt {recovery['observations_gained']} times")
    print(f"  share of the first quarter: {recovery['share_in_first_quarter']:.1%}")
    print(f"  share of the last quarter:  {recovery['share_in_last_quarter']:.1%}")
    print(f"  leads the set by the end: {recovery['leads_at_the_end']}")

    arms = result["arm_stability"]
    print("\nControl arm, fresh encounters against repeated ones")
    print(f"  fresh (a new slot each time):      {arms['fresh_control_share']:.1%}")
    print(f"  repeats (same question, same slot): {arms['repeat_control_share']:.1%}")
    print(f"  design constant:                   {strategies.CONTROL_PROBABILITY:.1%}")
    print(f"  arm spread across repeats: {arms['repeat_arm_spread']}")
    print(f"  the same exposure asked twice agrees: {arms['stable_within_exposure']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, help="Write the full result to this path.")
    args = parser.parse_args()

    app = create_app({"AUTO_SEED": False})
    with app.app_context():
        try:
            result = audit()
        finally:
            # Nothing here is meant to survive; the histories exist to be measured.
            db.session.rollback()
    _report(result)
    if args.json:
        args.json.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"\nWrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
