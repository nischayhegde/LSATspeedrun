"""Find and clear rows recording an approach against the wrong section.

A Reading Comprehension approach on a Logical Reasoning question is a card that
asks the student to compare two passages when there is no passage in front of
them. The live path cannot produce one — `services.create_study_session`
settles the question list first and only then assigns an approach to each
question — but the demo seeder used to substitute a review-queue question into a
position whose approach had already been drawn, and it made 89 of them.

Re-running `seed_demo.py --apply` fixes the ones it wrote, because it deletes
the account's study history and writes it again. This exists for the rest: rows
on a hand-testing account, or on a database somebody would rather not reseed.

Cleared rather than corrected. Assigning a fitting approach after the fact
would invent an observation the student was never shown, and the Methods panel
reads these rows as an experiment. A row with no approach on it is the one true
thing that can be said: no technique was offered here.

    python3 backend/scripts/repair_strategy_rows.py            # report only
    python3 backend/scripts/repair_strategy_rows.py --apply     # clear them

Exits non-zero while any remain, so it doubles as a check.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import Attempt, Question, SessionItem, StudySession, User  # noqa: E402
from app.strategies import STRATEGIES  # noqa: E402

# Every column that records the strategy trial on a session item, and on the
# attempt that copied it at submit time. Listed rather than derived so adding a
# column to the experiment is a decision about this script too.
ITEM_COLUMNS = (
    "strategy_key",
    "strategy_variant",
    "strategy_propensity",
    "strategy_candidates_n",
    "strategy_stratum",
    "strategy_forcing_propensity",
)
ATTEMPT_COLUMNS = (
    "strategy_key",
    "strategy_variant",
    "strategy_applied",
    "strategy_propensity",
    "strategy_candidates_n",
    "strategy_gate_status",
    "strategy_stratum",
    "strategy_forcing_propensity",
    "strategy_enforcement_level",
    "strategy_enforcement_version",
    "strategy_artifact_json",
    "strategy_artifact_quality",
)


def mismatched_items() -> list[tuple[SessionItem, str, str]]:
    """Session items whose approach belongs to the other section."""
    rows = (
        SessionItem.query.join(Question, Question.id == SessionItem.question_id)
        .with_entities(SessionItem, Question.section, StudySession.user_id)
        .join(StudySession, SessionItem.session_id == StudySession.id)
        .filter(SessionItem.strategy_key.isnot(None))
        .all()
    )
    return [
        (item, section, user_id)
        for item, section, user_id in rows
        if item.strategy_key in STRATEGIES and STRATEGIES[item.strategy_key]["section"] != section
    ]


def describe(found: list[tuple[SessionItem, str, str]]) -> dict:
    emails = {user.id: user.email for user in User.query.all()}
    per_account: dict[str, int] = {}
    per_strategy: dict[str, int] = {}
    for item, _section, user_id in found:
        account = emails.get(user_id, user_id)
        per_account[account] = per_account.get(account, 0) + 1
        per_strategy[item.strategy_key] = per_strategy.get(item.strategy_key, 0) + 1
    return {
        "rows": len(found),
        "by_account": dict(sorted(per_account.items())),
        "by_approach": dict(sorted(per_strategy.items())),
        "examples": [
            {
                "approach": STRATEGIES[item.strategy_key]["title"],
                "approach_section": STRATEGIES[item.strategy_key]["section"],
                "question_section": section,
                "question": item.question_id,
            }
            for item, section, _user_id in found[:5]
        ],
    }


def clear(found: list[tuple[SessionItem, str, str]]) -> int:
    attempts = 0
    for item, _section, _user_id in found:
        for column in ITEM_COLUMNS:
            setattr(item, column, None)
        item.strategy_gate_rejections = 0
        item.strategy_enforcement_level = "none"
        for attempt in Attempt.query.filter_by(session_item_id=item.id).all():
            for column in ATTEMPT_COLUMNS:
                setattr(attempt, column, None)
            attempt.strategy_prompt_ms = 0
            attempt.strategy_gate_ms = 0
            attempt.strategy_gate_rejections = 0
            attempts += 1
    db.session.commit()
    return attempts


def main() -> int:
    parser = argparse.ArgumentParser(description="Clear cross-section strategy rows.")
    parser.add_argument("--apply", action="store_true", help="Clear the rows. Without this flag nothing changes.")
    args = parser.parse_args()

    app = create_app({"AUTO_SEED": False})
    with app.app_context():
        found = mismatched_items()
        report = describe(found)
        report["database"] = str(db.engine.url.database)
        if found and args.apply:
            report["attempts_cleared"] = clear(found)
            report["rows_remaining"] = len(mismatched_items())
        elif found:
            report["next"] = "Re-run with --apply to clear them."
        print(json.dumps(report, indent=2))
        return 1 if report.get("rows_remaining", report["rows"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
