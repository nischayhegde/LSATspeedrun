"""Re-point seeded demo progress onto a Google account on the deployed database.

Idempotent. Typical cases:

- Only the seed user exists: rename its email to the Google address so the
  next Google login finds it by email and attaches ``google_sub``.
- Only the Google user exists: nothing to move.
- Both exist: keep the Google user's id and ``google_sub``, replace its
  learner/empire rows with the seed user's, then delete the seed user.

Does not enable DEV_AUTH. Requires ``ALLOW_DEPLOYED_DEMO_SEED=1`` when the
database is not local SQLite.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import inspect, text  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import User  # noqa: E402

DEFAULT_SOURCE = "student@localhost.test"
DEFAULT_TARGET = "alanmakeel@gmail.com"


def _require_deployed_guard(app) -> None:
    uri = str(app.config["SQLALCHEMY_DATABASE_URI"])
    if uri.startswith("sqlite:"):
        return
    if os.getenv("ALLOW_DEPLOYED_DEMO_SEED") != "1":
        raise SystemExit("Set ALLOW_DEPLOYED_DEMO_SEED=1 to merge identities on a deployed database.")


def _user_id_tables() -> list[str]:
    inspector = inspect(db.engine)
    tables = []
    for table_name in inspector.get_table_names():
        if table_name == "users":
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "user_id" in columns:
            tables.append(table_name)
    return sorted(tables)


def _count_rows(table: str, user_id: str) -> int:
    return int(db.session.execute(
        text(f"SELECT COUNT(*) FROM {table} WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).scalar_one())


def _delete_user_rows(table: str, user_id: str) -> int:
    result = db.session.execute(
        text(f"DELETE FROM {table} WHERE user_id = :user_id"),
        {"user_id": user_id},
    )
    return int(result.rowcount or 0)


def _reassign_user_rows(table: str, source_id: str, target_id: str) -> int:
    result = db.session.execute(
        text(f"UPDATE {table} SET user_id = :target_id WHERE user_id = :source_id"),
        {"source_id": source_id, "target_id": target_id},
    )
    return int(result.rowcount or 0)


def merge_identity(source_email: str, target_email: str) -> dict:
    source_email = source_email.strip().lower()
    target_email = target_email.strip().lower()
    if source_email == target_email:
        raise SystemExit("Source and target emails are the same.")

    source = User.query.filter_by(email=source_email).first()
    target = User.query.filter_by(email=target_email).first()
    tables = _user_id_tables()

    if source is None and target is None:
        return {
            "action": "missing",
            "source_email": source_email,
            "target_email": target_email,
            "tables": tables,
        }

    if source is None:
        return {
            "action": "already_target",
            "target_email": target_email,
            "target_id": target.id,
            "google_sub_present": bool(target.google_sub),
            "tables": {table: _count_rows(table, target.id) for table in tables},
        }

    if target is None:
        source.email = target_email
        if not source.display_name or source.display_name == "Local Student":
            source.display_name = target_email.split("@")[0]
        db.session.commit()
        return {
            "action": "renamed",
            "target_email": target_email,
            "target_id": source.id,
            "google_sub_present": bool(source.google_sub),
            "tables": {table: _count_rows(table, source.id) for table in tables},
        }

    moved = {}
    wiped = {}
    # Auth cookies on the seed user are useless after the merge.
    if "auth_sessions" in tables:
        wiped["auth_sessions_source"] = _delete_user_rows("auth_sessions", source.id)
    for table in tables:
        if table == "auth_sessions":
            continue
        wiped[table] = _delete_user_rows(table, target.id)
        moved[table] = _reassign_user_rows(table, source.id, target.id)

    target.display_name = source.display_name or target.display_name
    target.onboarding_complete = source.onboarding_complete or target.onboarding_complete
    target.story_intro_seen = source.story_intro_seen or target.story_intro_seen
    target.assistance_level = source.assistance_level or target.assistance_level
    target.target_minutes = source.target_minutes
    target.target_score = source.target_score or target.target_score
    target.target_test_date = source.target_test_date or target.target_test_date
    target.guided_tour_completed_at = source.guided_tour_completed_at or target.guided_tour_completed_at
    db.session.delete(source)
    db.session.commit()
    return {
        "action": "merged",
        "target_email": target_email,
        "target_id": target.id,
        "google_sub_present": bool(target.google_sub),
        "wiped_target_rows": wiped,
        "moved_rows": moved,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Attach seeded demo progress to a Google account.")
    parser.add_argument("--from-email", default=DEFAULT_SOURCE)
    parser.add_argument("--to-email", default=DEFAULT_TARGET)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    app = create_app({"AUTO_SEED": False})
    with app.app_context():
        _require_deployed_guard(app)
        if not args.apply:
            source = User.query.filter_by(email=args.from_email.strip().lower()).first()
            target = User.query.filter_by(email=args.to_email.strip().lower()).first()
            print(json.dumps(
                {
                    "from": args.from_email,
                    "to": args.to_email,
                    "source_exists": bool(source),
                    "target_exists": bool(target),
                    "next": "Re-run with --apply to merge.",
                },
                indent=2,
            ))
            return 0
        print(json.dumps(merge_identity(args.from_email, args.to_email), indent=2, default=str))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
