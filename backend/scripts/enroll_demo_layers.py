"""Enroll live run layers on a lived-in demo account that skipped assign().

`seed_demo.py` writes study history by hand rather than through
`create_study_session`, so a database seeded before that path called
`experiments.assign` has months of sittings and zero `layer_assignments`
rows. Difficulty targeting is live; without those rows the next sitting
looks like the first and the comparison has nothing to join.

This does not wipe sessions, rewrite exposure_policy, or reseed. It walks
existing unfiltered practice runs and records the same arms
`create_study_session` would have drawn, through `enroll_unfiltered_run`.

    DATABASE_URL=sqlite:////private/tmp/lsat-typefocus/backend/instance/demo.db \\
      AUTO_SEED=false python backend/scripts/enroll_demo_layers.py            # report
    DATABASE_URL=sqlite:////private/tmp/lsat-typefocus/backend/instance/demo.db \\
      AUTO_SEED=false python backend/scripts/enroll_demo_layers.py --apply    # write

Safe to run twice: `assign` returns the existing row for a given exposure.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import create_app  # noqa: E402
from app.experiments import UNFILTERED_RUN_LAYERS, enroll_unfiltered_run  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import LayerAssignment, StudySession, User  # noqa: E402

DEFAULT_DEMO_DB = Path("/private/tmp/lsat-typefocus/backend/instance/demo.db")
DEFAULT_EMAIL = "student@localhost.test"


def _sqlite_url(path: Path) -> str:
    return "sqlite:///" + str(path.resolve())


def _configure_database(path: Path) -> None:
    os.environ.setdefault("AUTO_SEED", "false")
    os.environ["DATABASE_URL"] = _sqlite_url(path)


def _assert_local_only(app, email: str) -> None:
    uri = str(app.config["SQLALCHEMY_DATABASE_URI"])
    if not uri.startswith("sqlite:"):
        raise RuntimeError("Layer enrollment is restricted to a local SQLite database.")
    if not email.endswith("@localhost.test"):
        raise RuntimeError("Layer enrollment only accepts an @localhost.test account.")


def pending_sessions(user: User) -> list[StudySession]:
    """Unfiltered practice runs that do not yet have a difficulty_targeting row."""
    enrolled = {
        row.session_id
        for row in LayerAssignment.query.filter_by(
            subject_id=user.id, layer="difficulty_targeting"
        ).all()
        if row.session_id
    }
    return [
        session
        for session in StudySession.query.filter_by(
            user_id=user.id, practice_style="cases"
        ).all()
        if session.id not in enrolled
    ]


def enroll(user: User) -> dict:
    missing = pending_sessions(user)
    for session in missing:
        enroll_unfiltered_run(user.id, session.id)
    db.session.commit()
    counts = {
        layer: LayerAssignment.query.filter_by(subject_id=user.id, layer=layer).count()
        for layer in UNFILTERED_RUN_LAYERS
    }
    return {
        "email": user.email,
        "enrolled_now": len(missing),
        "cases_sessions": StudySession.query.filter_by(
            user_id=user.id, practice_style="cases"
        ).count(),
        "all_sessions": StudySession.query.filter_by(user_id=user.id).count(),
        "users": User.query.count(),
        "assignments": counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enroll live run layers on an existing demo learner without reseeding."
    )
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument(
        "--database",
        default=str(DEFAULT_DEMO_DB),
        help="Absolute path to the SQLite file.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write assignment rows. Without this flag nothing changes.",
    )
    args = parser.parse_args()
    database = Path(args.database).resolve()
    if not database.is_file():
        print(json.dumps({"error": f"database not found: {database}"}), file=sys.stderr)
        return 1
    _configure_database(database)
    app = create_app({"AUTO_SEED": False})
    with app.app_context():
        _assert_local_only(app, args.email)
        user = User.query.filter_by(email=args.email).first()
        if not user:
            print(json.dumps({"error": f"no such user: {args.email}"}), file=sys.stderr)
            return 1
        missing = pending_sessions(user)
        if not args.apply:
            print(
                json.dumps(
                    {
                        "email": args.email,
                        "database": str(database),
                        "users": User.query.count(),
                        "sessions": StudySession.query.filter_by(user_id=user.id).count(),
                        "cases_missing_difficulty_targeting": len(missing),
                        "assignments": {
                            layer: LayerAssignment.query.filter_by(
                                subject_id=user.id, layer=layer
                            ).count()
                            for layer in UNFILTERED_RUN_LAYERS
                        },
                        "next": "Re-run with --apply to enroll without reseeding.",
                    },
                    indent=2,
                )
            )
            return 0
        report = enroll(user)
        report["database"] = str(database)
        print(json.dumps(report, indent=2))
        targeting = report["assignments"]["difficulty_targeting"]
        return 0 if targeting > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
