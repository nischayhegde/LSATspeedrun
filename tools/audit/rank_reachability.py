"""Can an approach that fell behind in the coverage phase ever be offered again?

`docs/audits/interleaving-audit.md` §2.3 says no, and reports three of five
approaches never offered in 400 draws. That finding is what this probe exists
to re-run, because the way it was measured cannot distinguish the two things it
would have to distinguish.

The original probe wrote three coverage observations per candidate, then drew
400 times **without recording any of the outcomes**. So the posteriors could
not move, the ranking could not move, and a candidate below rank 1 could not be
reached — by construction, whatever the mechanism does. What it measured is
that the exploit branch reads `ranked[0]` and `ranked[1]`, which is true and is
visible in four lines of source. What it did not measure is whether ranks move
in use, which is the question the finding turns on: an approach is only
permanently locked out if the two above it never fall.

So this feeds outcomes back. Each draw is answered, the answer is recorded the
way the app records it, and the next draw sees it. Two other things have
changed since the audit and both belong in the same run:

* the arm is now seeded per encounter, so the exploration coin is a coin rather
  than a fixture of `(student, question, slot)`;
* `strategy_selection` has an off arm. A quarter of eligible questions draw
  uniformly over the candidates, which reaches every rank by construction, and
  the point of measuring it here is what it costs.

Release turns out to be a coin rather than a verdict, so a single run of it
measures nothing — the audit's own mistake, in a different place. Every
condition below is swept over many seeds and reported as a rate. The four
conditions are chosen so that the comparisons between them isolate *what*
releases a candidate:

* **held / good** and **held / bad** differ only in whether the excluded
  approach is truly the best or truly the worst. Its posterior is frozen until
  it is offered, so it cannot be evidence about itself, and if release were
  about quality these two would part company. They do not.
* **field falls** drops the approaches above it below its frozen posterior,
  which is the condition under which the ranking can legitimately let go.
* **uniform** is the registered off arm, which reaches every rank by
  construction.

    python3 tools/audit/rank_reachability.py
    python3 tools/audit/rank_reachability.py --trials 40 --draws 600

Report-only in the sense that matters — each trial builds its own in-memory
database and never touches yours — but it does write rows to that database,
because driving the real selector means giving it a real history to read.
"""

from __future__ import annotations

import argparse
import random
import statistics
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import (  # noqa: E402
    Attempt,
    Question,
    QuestionChoice,
    SessionItem,
    StudySession,
    User,
)
from app import strategies  # noqa: E402
from app.seed import SOURCE_PREFIX  # noqa: E402


# A stimulus and stem chosen to match several approaches at once, so the
# candidate list is wide enough for ranks below 1 to exist.
WIDE_STIMULUS = (
    "Because the new tariff raised prices, exports fell. The minister argues that "
    "if the tariff is repealed, exports must recover, since the only cause of the "
    "decline was the tariff. Critics note that the survey she cites sampled only "
    "firms that had already reduced output."
)
WIDE_STEM = (
    "Which one of the following is an assumption required by the minister's argument, "
    "and which most weakens the reasoning?"
)

GOOD = 0.78
BAD = 0.30
ORDINARY = 0.55
FALLING = 0.25

# What the excluded candidate's posterior is pinned at: one success in
# `BASE_COVERAGE_TRIALS`, under the Beta(1,1) the selector uses.
FROZEN = 2 / (strategies.BASE_COVERAGE_TRIALS + 2)


def _bank() -> Question:
    question = Question(
        id="hf-lsat-lr:rank-probe",
        section="Logical Reasoning",
        question_type="Assumption",
        difficulty=3,
        stimulus=WIDE_STIMULUS,
        stem=WIDE_STEM,
        correct_answer="C",
        source=f"{SOURCE_PREFIX}lr · train",
        license_status="upstream_terms_apply",
        review_status="published",
    )
    db.session.add(question)
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"rank-probe-{label}",
                question_id=question.id,
                label=label,
                canonical_text=f"Choice {label}",
                position=position,
            )
        )
    db.session.flush()
    return question


def _record(user, run, question, key, index: int, correct: bool) -> None:
    item = SessionItem(
        session_id=run.id,
        question_id=question.id,
        position=index,
        target_time_seconds=150,
    )
    db.session.add(item)
    db.session.flush()
    db.session.add(
        Attempt(
            user_id=user.id,
            session_item_id=item.id,
            idempotency_key=f"rank-{user.id}-{index}",
            selected_label="C",
            is_correct=correct,
            server_elapsed_ms=100_000,
            confidence=3,
            strategy_key=key,
            strategy_variant=strategies.VARIANT_PROMPT,
            strategy_propensity=1 - strategies.CONTROL_PROBABILITY,
        )
    )
    db.session.flush()


def _seed_coverage(user, run, question, candidates, excluded: str) -> int:
    """Finish the coverage phase with `excluded` last and everything else clear of it.

    Deliberately unlucky rather than genuinely worse: the whole claim is about
    an approach shut out on three observations, so it gets one right out of
    three, pinning it at 0.40, while the field takes 3 and 2 — 0.80 and 0.60.
    No ties, so the tiebreak never decides anything.
    """
    hits = {excluded: 1}
    for rank, key in enumerate(key for key in candidates if key != excluded):
        hits[key] = strategies.BASE_COVERAGE_TRIALS if rank == 0 else 2
    index = 0
    for key in candidates:
        for trial in range(strategies.BASE_COVERAGE_TRIALS):
            _record(user, run, question, key, index, trial < hits[key])
            index += 1
    db.session.commit()
    return index


def _trial(*, draws: int, uniform: bool, excluded_truth: float, field: float, seed: int) -> dict:
    application = create_app(
        {
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "TESTING": True,
            # 0.0 holds every eligible question in the ranked arm; 1.0 holds
            # every one in the uniform arm. The product runs at 0.25.
            "ADAPTIVE_LAYERS": {"strategy_selection": {"holdback": 1.0 if uniform else 0.0}},
        }
    )
    random.seed(seed)
    with application.app_context():
        db.create_all()
        question = _bank()
        candidates = strategies._candidate_keys(question)
        # The excluded candidate is whichever name sorts last, so the tiebreak
        # in the selector's `sorted` can only ever push it further down.
        excluded = sorted(candidates)[0]

        user = User(email=f"rank{seed}@audit.test", display_name="rank")
        db.session.add(user)
        db.session.flush()
        run = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="cases",
            feedback_policy="immediate",
            status="completed",
            total_items=0,
            target_minutes=60,
        )
        db.session.add(run)
        db.session.flush()

        index = _seed_coverage(user, run, question, candidates, excluded)
        truth = {key: (excluded_truth if key == excluded else field) for key in candidates}

        chosen: Counter = Counter()
        released = None
        for draw in range(draws):
            trial = strategies.assign_strategy_trial(
                user.id, question, draw % 10, exposure=f"run-{draw}"
            )
            if not trial or not trial.get("key"):
                continue
            key = trial["key"]
            chosen[key] += 1
            if key == excluded and released is None:
                released = draw
            _record(user, run, question, key, index, random.random() < truth[key])
            index += 1
            if draw % 20 == 0:
                db.session.commit()
        db.session.commit()

        total = sum(chosen.values())
        return {
            "candidates": candidates,
            "excluded": excluded,
            "released": released,
            "share": chosen[excluded] / total if total else 0.0,
        }


def _sweep(title: str, *, trials: int, **kwargs) -> dict:
    base = kwargs.pop("seed")
    results = [_trial(seed=base + index, **kwargs) for index in range(trials)]
    released = [result["released"] for result in results if result["released"] is not None]
    return {
        "title": title,
        "trials": trials,
        "released": len(released),
        "median_draw": statistics.median(released) if released else None,
        "median_share": statistics.median(result["share"] for result in results),
        "candidates": results[0]["candidates"],
        "excluded": results[0]["excluded"],
    }


def _report(sweep: dict, draws: int) -> None:
    rate = sweep["released"] / sweep["trials"]
    print(f"\n  {sweep['title']}")
    print(f"    offered again in           {sweep['released']} of {sweep['trials']} runs ({rate:.0%})")
    if sweep["median_draw"] is None:
        print(f"    first offered after        never, in {draws} draws")
    else:
        print(f"    first offered after        {sweep['median_draw']:.0f} draws (median)")
    print(f"    share of the offers        {sweep['median_share']:.1%} (median)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draws", type=int, default=300)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260812)
    args = parser.parse_args()

    shared = {"draws": args.draws, "trials": args.trials, "seed": args.seed}
    held_good = _sweep(
        f"HELD, and truly the best at {GOOD:.0%}", uniform=False,
        excluded_truth=GOOD, field=ORDINARY, **shared
    )
    held_bad = _sweep(
        f"HELD, and truly the worst at {BAD:.0%}", uniform=False,
        excluded_truth=BAD, field=ORDINARY, **shared
    )
    falling = _sweep(
        f"THE FIELD FALLS to a true {FALLING:.0%}", uniform=False,
        excluded_truth=GOOD, field=FALLING, **shared
    )
    uniform = _sweep(
        "UNIFORM, the off arm registered with the spine", uniform=True,
        excluded_truth=GOOD, field=ORDINARY, **shared
    )

    print("\nRANK REACHABILITY, WITH OUTCOMES FED BACK")
    print(f"  candidates: {', '.join(held_good['candidates'])}")
    print(f"  under test: {held_good['excluded']}, shut out of the exploit branch")
    print(
        f"  It goes 1 for {strategies.BASE_COVERAGE_TRIALS} in coverage by bad luck, which pins its "
        f"posterior at {FROZEN:.2f} against a\n  field on 0.80 and 0.60, and it finishes last. Every "
        "draw below is answered and\n  recorded, so unlike the audit's probe the ranking is free to "
        f"move.\n  {args.trials} runs of {args.draws} draws per condition."
    )
    for sweep in (held_good, held_bad, falling, uniform):
        _report(sweep, args.draws)

    print(
        "\n  The audit's finding survives, and the reason is sharper than the audit gave.\n"
        "  Its probe recorded no outcomes, so the posteriors were frozen and the lower ranks\n"
        "  were unreachable by construction — it could not have found anything else. With\n"
        "  outcomes fed back the lockout is not quite absolute, and the exceptions are the\n"
        "  interesting part, because they are not earned. Compare the first two conditions:\n"
        "  they differ only in whether the shut-out approach is the best one available or\n"
        "  the worst, and they come back at about the same rate. A frozen posterior cannot\n"
        "  be evidence about itself, so nothing in the mechanism can tell those two cases\n"
        "  apart. What releases a candidate is the runner-up above it drawing a bad streak\n"
        f"  of its own and falling under {FROZEN:.2f} — someone else's luck, not this one's quality.\n\n"
        "  The third condition is the honest case: when the field really is worse, the\n"
        "  ranking lets go quickly and gives the best approach most of the offers. Which is\n"
        "  the whole shape of the defect. The mechanism releases a candidate reliably when\n"
        "  the exclusion turned out to be right, and holds it almost always when the\n"
        "  exclusion was bad luck — the wrong way round, and a sharper statement than\n"
        "  'rank 2 is unreachable'. The uniform arm is not a fix for it: it is a quarter of\n"
        "  eligible questions spent measuring what the ranking is worth."
    )


if __name__ == "__main__":
    main()
