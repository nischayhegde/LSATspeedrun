"""Does a question's rating predict how students answer it? Check, do not assume.

A difficulty estimate that does not predict held-out responses is not a
difficulty measure, however reasonable its arithmetic looks. This script is the
check, and it runs the same way against two very different corpora:

    python backend/scripts/calibration_validate.py --simulate
    python backend/scripts/calibration_validate.py --database

`--simulate` invents responses from a generative model that is deliberately not
the one the estimator assumes (2PL, per-item guessing, drifting ability — see
`scripts/calibration_lab.py`), so a good result is a statement about the
estimator rather than about the simulation.

`--database` runs the identical evaluation over whatever real attempts exist in
`DATABASE_URL`. Do that after answering some questions; on a fresh install it
will correctly report that there is nothing to validate. Both modes print the
same table, so the two are directly comparable.

The number that decides the question is `elo` against `learner`. The `learner`
baseline knows exactly who is answering and nothing whatsoever about what they
are answering. Whatever the item rating is worth shows up as the gap between
those two rows and nowhere else.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.calibration_lab import (  # noqa: E402
    Response,
    evaluate,
    percent_correct_recovery,
    recovery,
    replay,
    simulate,
    spearman,
)


def _table(result: dict) -> str:
    if "models" not in result:
        return json.dumps(result, indent=2)
    lines = [
        f"  fit {result['fit']:,} responses · holdout {result['holdout']:,} · "
        f"{result['items']:,} items · {result['learners']:,} learner-sections · "
        f"base rate {result['base_rate']:.3f}",
        f"  {'model':<22}{'log loss':>10}{'brier':>9}{'AUC':>8}",
    ]
    for row in result["models"]:
        auc = f"{row['auc']:.4f}" if row["auc"] is not None else "     -"
        lines.append(f"  {row['model']:<22}{row['log_loss']:>10.5f}{row['brier']:>9.5f}{auc:>8}")
    lines.append(
        f"  item rating is worth {result['elo_vs_learner_log_loss']:+.5f} nats against a "
        "learner-only model"
    )
    lines.append(
        f"  and {result['elo_vs_item_rate_log_loss']:+.5f} against learner × raw percent-correct"
    )
    if result.get("rating_vs_holdout_difficulty_spearman") is not None:
        lines.append(
            f"  rating vs held-out difficulty: Spearman "
            f"{result['rating_vs_holdout_difficulty_spearman']:+.4f} "
            f"over {result['items_in_rank_check']} items with 8+ held-out responses"
        )
    return "\n".join(lines)


def run_simulation(args) -> int:
    print("Synthetic corpus. Generator is 2PL with per-item guessing and drifting")
    print("ability; the estimator is Rasch/Elo with a fixed guessing floor, so it is")
    print("wrong about all three on purpose.\n")

    print("== Predictive check ==")
    simulation = simulate(
        items=args.items,
        learners=args.learners,
        responses_per_learner=args.responses,
        seed=args.seed,
    )
    result = evaluate(simulation.responses, holdout=args.holdout, seed=args.seed + 1)
    print(_table(result))

    print("\n== Recovery of the difficulties that generated the data ==")
    print("  (a Rasch estimator cannot recover a 2PL difficulty exactly; read the rank)")
    full = replay(simulation.responses)
    print("  " + json.dumps(recovery(full, simulation.truth)))

    print("\n== How many responses per item before the rating is worth reading? ==")
    print("  Corpus size varied, bank and cohort held fixed. `recovery` is against the")
    print("  difficulties that generated the data; `worth` is held-out log loss saved")
    print("  against a model that knows the student and nothing about the question.")
    print("  The status ladder in calibration.py is set from this table.")
    print("  `vs p%` is the same saving against the strong baseline: learner rate")
    print("  combined with the item's raw percent-correct.")
    print(f"  {'per item':>9}{'responses':>11}{'rho':>8}{'rmse':>8}{'worth':>9}{'vs p%':>9}{'AUC':>8}")
    for per_learner in (10, 25, 50, 80, 150, 300):
        corpus = simulate(
            items=args.items,
            learners=args.learners,
            responses_per_learner=per_learner,
            seed=args.seed,
        )
        recovered = recovery(replay(corpus.responses), corpus.truth)
        scored = evaluate(corpus.responses, holdout=args.holdout, seed=args.seed + 1)
        elo = next(row for row in scored["models"] if row["model"] == "elo")
        print(
            f"  {recovered['mean_responses_per_item']:>9.1f}{len(corpus.responses):>11,}"
            f"{recovered['spearman']:>8.3f}{recovered['rmse']:>8.3f}"
            f"{scored['elo_vs_learner_log_loss']:>+9.4f}"
            f"{scored['elo_vs_item_rate_log_loss']:>+9.4f}{elo['auc']:>8.4f}"
        )

    print("\n== Selection bias, and what the random slice is for ==")
    print("  'targeting' is the share of exposures chosen because of the item's")
    print("  estimated difficulty; 'holdout' is the share of those slots forced back to")
    print("  a uniform draw, which is what calibration.exposure_draw reserves. Rank")
    print("  correlation against the true difficulties, so higher is better.")
    print("    elo(all)   the rating as recorded")
    print("    elo(blind) the rating rebuilt from unbiased exposure alone")
    print("    %-correct  difficulty measured as 'few people got it right'")
    print(f"  {'targeting':>10}{'holdout':>9}{'unbiased n':>12}{'elo(all)':>10}"
          f"{'elo(blind)':>12}{'%-correct':>11}")
    for targeting, holdout_share in ((0.0, 0.0), (1.0, 0.0), (1.0, 0.25), (0.75, 0.25)):
        biased = simulate(
            items=args.items,
            learners=args.learners,
            responses_per_learner=args.responses,
            seed=args.seed,
            targeting=targeting,
            random_holdout=holdout_share,
        )
        unbiased_count = sum(1 for row in biased.responses if row.exposure != "targeted")
        everything = recovery(replay(biased.responses), biased.truth)
        blind = recovery(replay(biased.responses, unbiased_only=True), biased.truth)
        naive = percent_correct_recovery(biased.responses, biased.truth)

        def show(value) -> str:
            return f"{value:.4f}" if isinstance(value, (int, float)) else "-"

        print(
            f"  {targeting:>10.2f}{holdout_share:>9.2f}{unbiased_count:>12,}"
            f"{show(everything.get('spearman')):>10}"
            f"{show(blind.get('spearman')):>12}"
            f"{show(naive.get('spearman')):>11}"
        )
    print("  Read the last column first: percent-correct is what targeting destroys.")
    return 0


def load_from_database() -> list[Response]:
    """Every real answer on file, oldest first, as the estimator would see it."""
    from app import create_app
    from app.extensions import db
    from app.models import Attempt, Question, QuestionChoice, SessionItem

    application = create_app()
    with application.app_context():
        choice_counts = dict(
            db.session.query(QuestionChoice.question_id, db.func.count(QuestionChoice.id))
            .group_by(QuestionChoice.question_id)
            .all()
        )
        rows = (
            db.session.query(
                Attempt.user_id,
                SessionItem.question_id,
                Question.section,
                Attempt.is_correct,
                Attempt.exposure_policy,
            )
            .join(SessionItem, Attempt.session_item_id == SessionItem.id)
            .join(Question, SessionItem.question_id == Question.id)
            .order_by(Attempt.created_at.asc(), Attempt.id.asc())
            .all()
        )
    return [
        Response(
            learner=user_id,
            item=question_id,
            scope=section or "Logical Reasoning",
            correct=bool(is_correct),
            choices=choice_counts.get(question_id, 5),
            exposure=exposure or "blind",
        )
        for user_id, question_id, section, is_correct, exposure in rows
    ]


def run_database(args) -> int:
    responses = load_from_database()
    print(f"Real corpus: {len(responses):,} attempts on file.\n")
    if len(responses) < 200:
        print("Too few to validate anything. This is the expected state of a bank nobody")
        print("has answered yet, and it is the reason the ratings ship as NULL rather than")
        print("as a number: there is no evidence, so there is no value.")
        return 0
    exposures: dict[str, int] = {}
    for response in responses:
        exposures[response.exposure] = exposures.get(response.exposure, 0) + 1
    print(f"  exposure policies: {exposures}")
    if exposures.get("targeted"):
        print("  a selector is targeting on difficulty; compare `blind` below against `all`")

    print("\n== Predictive check ==")
    print(_table(evaluate(responses, holdout=args.holdout, seed=args.seed + 1)))

    print("\n== Only items with enough evidence to be worth reading ==")
    for minimum in (12, 50):
        sliced = evaluate(
            responses, holdout=args.holdout, seed=args.seed + 1, min_item_responses=minimum
        )
        print(f"\n  items with >= {minimum} responses in the fit set:")
        print(_table(sliced))

    if exposures.get("targeted"):
        print("\n== Selection bias ==")
        everything = replay(responses)
        unbiased = replay(responses, unbiased_only=True)
        shared = [
            item_id
            for item_id in everything.items
            if item_id in unbiased.items and unbiased.items[item_id].responses >= 8
        ]
        if len(shared) >= 3:
            left = [everything.items[i].rating - everything.centre() for i in shared]
            right = [unbiased.items[i].rating - unbiased.centre() for i in shared]
            gaps = [a - b for a, b in zip(left, right)]
            print(f"  {len(shared)} items with 8+ unbiased responses")
            print(f"  Spearman(all, unbiased) = {spearman(left, right)}")
            print(f"  mean gap {sum(gaps) / len(gaps):+.4f} logits, "
                  f"largest |gap| {max(abs(gap) for gap in gaps):.4f}")
        else:
            print("  not enough unbiased responses per item to compare yet")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--simulate", action="store_true", help="synthetic corpus")
    source.add_argument("--database", action="store_true", help="real attempts from DATABASE_URL")
    parser.add_argument("--items", type=int, default=400)
    parser.add_argument("--learners", type=int, default=120)
    parser.add_argument("--responses", type=int, default=80, help="per learner")
    parser.add_argument("--holdout", type=float, default=0.3)
    parser.add_argument("--seed", type=int, default=20260812)
    args = parser.parse_args()
    return run_simulation(args) if args.simulate else run_database(args)


if __name__ == "__main__":
    raise SystemExit(main())
