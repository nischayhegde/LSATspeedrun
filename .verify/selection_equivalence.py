"""Proves the faster selection picks exactly the questions the old one picked.

`select_random_questions` is not a cache or a serialisation detail — it decides
what a student is about to study. Making it read four columns instead of twelve
is only a performance change if the run that comes out is the same run, and
"seems fine" is not a claim about a function whose output is random by design.

So: seed the RNG, ask for a run, record the ids in order. Run the same script
against a checkout of the old code over a byte-identical copy of the same
database, and diff. Order matters and is compared, because the order is what
becomes each item's `position`.

    python .verify/selection_equivalence.py --db <shared copy> --out <json>

The two outputs must be identical. `--db` is required precisely so that both
sides read the same bytes rather than each cloning the live file at a different
moment.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--email", default="qa-megalit-test1@localhost.test")
    args = parser.parse_args()

    sys.path.insert(0, str(BACKEND))
    os.environ["DATABASE_URL"] = f"sqlite:///{args.db}"
    os.environ["AUTO_SEED"] = "false"
    os.environ["DEV_AUTH_ENABLED"] = "true"
    os.environ["AI_JOBS_MODE"] = "sync"
    from app import create_app
    from app.models import User
    from app.services import select_random_questions

    app = create_app()
    runs = {}
    with app.app_context():
        user = User.query.filter_by(email=args.email).one()
        # A spread of the arguments the real caller uses: plain runs of several
        # sizes, a type-filtered drill, a focus-weighted run, and a run with the
        # exclusion set that review items produce.
        cases = [
            ("plain-8", dict(count=8, user_id=user.id)),
            ("plain-20", dict(count=20, user_id=user.id)),
            ("plain-77", dict(count=77, user_id=user.id)),
            ("typed-flaw", dict(count=10, question_type="Flaw", user_id=user.id)),
            ("focus", dict(count=12, user_id=user.id, focus_types=["Flaw", "Assumption"])),
            ("no-user", dict(count=8)),
        ]
        for name, kwargs in cases:
            # Reseeded per case so one case's draw cannot shift the next, and so a
            # single differing case is attributable on its own.
            random.seed(20260809)
            picked = select_random_questions(**kwargs)
            runs[name] = [question.id for question in picked]

        # The exclusion path needs ids that exist, so it is built from a draw.
        random.seed(1)
        blocked = {question.id for question in select_random_questions(count=30, user_id=user.id)}
        random.seed(20260809)
        runs["excluding-30"] = [
            question.id
            for question in select_random_questions(count=8, user_id=user.id, exclude_ids=blocked)
        ]

    Path(args.out).write_text(json.dumps(runs, indent=2))
    for name, ids in runs.items():
        print(f"{name:<14} {len(ids):>3} questions  {ids[:3]}")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
