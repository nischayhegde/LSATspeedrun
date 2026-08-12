"""Replay every attempt already on file through the difficulty estimator.

The tables `0037_difficulty_calibration` creates start empty, so on a database
with history the ratings would begin from zero while the evidence for them was
already sitting in `attempts`. This replays that evidence, oldest first, through
exactly the update `services.submit_attempt` performs — same function, same
arithmetic, same order — so the result is indistinguishable from having had the
feature switched on all along.

    python backend/scripts/calibration_backfill.py --dry-run
    python backend/scripts/calibration_backfill.py --reset

Exposure is read from the attempt rather than assumed. Every historical row is
'blind', and that is a fact rather than a convenience: question selection has
never read difficulty, so exposure has been independent of it for the whole
history of this application.

Safe to run twice only with `--reset`, which clears both tables first. Without
it, a second run would count every response a second time and hand every item a
confidence it has not earned.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.orm import selectinload  # noqa: E402

from app import create_app  # noqa: E402
from app.calibration import EXPOSURE_BLIND, bank_summary, record_response  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import (  # noqa: E402
    Attempt,
    LearnerRating,
    Question,
    QuestionCalibration,
    SessionItem,
)

BATCH = 2000


def backfill(*, reset: bool, dry_run: bool) -> int:
    existing = db.session.query(db.func.count(QuestionCalibration.question_id)).scalar() or 0
    if existing and not reset:
        print(
            f"{existing} questions already carry a calibration row. Re-running would "
            "double-count every response behind them. Pass --reset to start over."
        )
        return 1
    if reset and not dry_run:
        db.session.query(QuestionCalibration).delete()
        db.session.query(LearnerRating).delete()
        db.session.commit()
        print(f"cleared {existing} calibration rows")

    rows = (
        db.session.query(Attempt.user_id, SessionItem.question_id, Attempt.is_correct, Attempt.exposure_policy)
        .join(SessionItem, Attempt.session_item_id == SessionItem.id)
        .order_by(Attempt.created_at.asc(), Attempt.id.asc())
        .all()
    )
    print(f"{len(rows)} attempts to replay")
    if not rows:
        print("Nothing to replay. Every question stays uncalibrated, which is correct.")
        return 0
    if dry_run:
        exposures: dict[str, int] = {}
        for _user, _question, _correct, exposure in rows:
            key = exposure or EXPOSURE_BLIND
            exposures[key] = exposures.get(key, 0) + 1
        print(f"would replay: {exposures}")
        print(f"distinct questions: {len({row[1] for row in rows})}")
        return 0

    # The estimator reads `len(question.choices)` for the guessing floor, so the
    # choices come with the questions rather than one lazy load per response.
    questions = {
        question.id: question
        for question in Question.query.options(selectinload(Question.choices)).filter(
            Question.id.in_({row[1] for row in rows})
        )
    }
    replayed = 0
    for user_id, question_id, is_correct, exposure in rows:
        question = questions.get(question_id)
        if question is None:
            # An attempt whose question has since been deleted. It taught the
            # student something; it can teach the bank nothing.
            continue
        record_response(
            user_id,
            question,
            bool(is_correct),
            exposure=exposure or EXPOSURE_BLIND,
        )
        replayed += 1
        if replayed % BATCH == 0:
            db.session.commit()
            print(f"  {replayed}/{len(rows)}")
    db.session.commit()
    print(f"replayed {replayed} responses")
    print(bank_summary())
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="clear the calibration tables first")
    parser.add_argument("--dry-run", action="store_true", help="report what would be replayed")
    args = parser.parse_args()
    application = create_app()
    with application.app_context():
        return backfill(reset=args.reset, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
