"""How much do we actually know about the difficulty of these questions?

    python backend/scripts/calibration_report.py
    python backend/scripts/calibration_report.py --question hf-lsat-lr:199106_3-LR1_1_1
    python backend/scripts/calibration_report.py --hardest 20 --status calibrated

The honest answer on a fresh install is "nothing about any of them", and this
prints that rather than a table of threes. Every number carries the evidence
behind it, because the difference between a rating off four responses and a
rating off four hundred is the entire point of the exercise.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from app.calibration import (  # noqa: E402
    STATUS_ORDER,
    bank_summary,
    scale_centre,
    signal,
)
from app.extensions import db  # noqa: E402
from app.models import Question, QuestionCalibration  # noqa: E402


def _one(question_id: str) -> int:
    question = Question.query.filter_by(id=question_id).first()
    if not question:
        print(f"no such question: {question_id}")
        return 1
    reading = signal(question)
    print(f"{question.id}")
    print(f"  {question.section} · {question.question_type}")
    print(f"  {(question.stem or '')[:110]}")
    print()
    for key, value in reading.items():
        print(f"  {key:<26}{value}")
    if reading["status"] == "uncalibrated":
        print("\n  Nobody has answered this question, so it has no difficulty. That is not")
        print("  a gap in the data; it is the data.")
    elif not reading["usable_for_targeting"]:
        print(f"\n  {reading['responses']} responses is not enough to steer anything with.")
    return 0


def _summary(args) -> int:
    counts = bank_summary()
    print("Question bank")
    print(f"  questions            {counts['questions']:,}")
    print(f"  published difficulty {counts['published']:,}  (a rating the test maker stated)")
    for status in STATUS_ORDER:
        print(f"  {status:<21}{counts[status]:,}")
    if counts["synthetic"]:
        print(
            f"  of which seeded      {counts['synthetic']:,}  (a seeder or a simulation "
            "answered these, so no consumer may steer on them)"
        )
    if counts["centre"] is not None:
        print(f"  scale centre         {counts['centre']} logits")
    if not counts["provisional"] and not counts["estimated"] and not counts["calibrated"]:
        print("\nNothing has been answered, so nothing has a difficulty. Run some")
        print("questions, or replay existing attempts with calibration_backfill.py.")
        return 0

    limit = args.hardest or args.easiest or 0
    if not limit:
        return 0
    query = QuestionCalibration.query.filter(QuestionCalibration.responses > 0)
    if args.status:
        query = query.filter(QuestionCalibration.status == args.status)
    order = QuestionCalibration.rating.desc() if args.hardest else QuestionCalibration.rating.asc()
    rows = query.order_by(order).limit(limit).all()
    centre = scale_centre()
    print(f"\n{'hardest' if args.hardest else 'easiest'} {len(rows)}:")
    print(f"  {'rating':>8}{'band':>6}{'SE':>8}{'n':>6}{'%corr':>7}  {'status':<13}{'origin':<11}question")
    for row in rows:
        reading = signal(row.question, row, centre=centre)
        band = reading["band"] if reading["band"] is not None else "-"
        error = f"{reading['standard_error']:.3f}" if reading["standard_error"] else "-"
        percent = round(100 * row.correct / row.responses)
        print(
            f"  {reading['rating']:>8.3f}{band:>6}{error:>8}{row.responses:>6}{percent:>6}%"
            f"  {reading['status']:<13}{reading['origin']:<11}{row.question_id}"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--question", help="report one question in full")
    parser.add_argument("--hardest", type=int, default=0)
    parser.add_argument("--easiest", type=int, default=0)
    parser.add_argument("--status", choices=STATUS_ORDER)
    args = parser.parse_args()
    application = create_app()
    with application.app_context():
        db.session.expire_on_commit = False
        return _one(args.question) if args.question else _summary(args)


if __name__ == "__main__":
    raise SystemExit(main())
