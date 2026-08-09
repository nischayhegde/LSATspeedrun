"""Warm, repeated timing of "start practice", runnable from two checkouts.

bench_answer.py times the first such call in a fresh process, which is honest for
a cold worker but folds in one-off SQLAlchemy statement compilation. A student
meets a warm process almost every time, so the steady-state number is the one
that describes what they feel — and it is also the one where the difference is
largest, so it must not be the only number reported.

Takes `--db` rather than cloning, so an A/B can hand each side its own copy of
one snapshot. Session creation writes, so the two sides cannot share a file.

    python .verify/bench_start.py --db <copy> --label old --rounds 12
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--label", default="run")
    parser.add_argument("--rounds", type=int, default=12)
    parser.add_argument("--size", type=int, default=8)
    parser.add_argument("--email", default="qa-megalit-test1@localhost.test")
    args = parser.parse_args()

    sys.path.insert(0, str(BACKEND))
    os.environ["DATABASE_URL"] = f"sqlite:///{args.db}"
    os.environ["AUTO_SEED"] = "false"
    os.environ["DEV_AUTH_ENABLED"] = "true"
    os.environ["AI_JOBS_MODE"] = "sync"
    from app import create_app
    from app.extensions import db
    from sqlalchemy import event

    app = create_app()
    statements = [0]

    with app.app_context():
        event.listen(db.engine, "before_cursor_execute", lambda *_a: statements.__setitem__(0, statements[0] + 1))

    client = app.test_client()
    if client.post("/v1/auth/dev", json={"email": args.email}).status_code != 200:
        print("dev login failed")
        return 1
    headers = {"X-CSRF-Token": client.get_cookie("lsat_csrf").value}

    # The practice queue caps how many runs may be paused at once, so each timed
    # creation is followed by abandoning what it made. The abandon is outside the
    # timer and its statements are not counted.
    def create():
        statements[0] = 0
        start = time.perf_counter()
        response = client.post("/v1/study-sessions", json={"size": args.size}, headers=headers)
        elapsed = (time.perf_counter() - start) * 1000
        return response, elapsed, statements[0]

    for _ in range(2):  # warm: one-off statement compilation lands here
        response, _ms, _n = create()
        if response.status_code not in (200, 201):
            print(f"warm-up failed: {response.status_code} {response.get_data(as_text=True)[:300]}")
            return 1
        client.post(f"/v1/study-sessions/{response.get_json()['session']['id']}/abandon", headers=headers)

    samples = []
    counts = []
    for _ in range(args.rounds):
        response, ms, count = create()
        if response.status_code not in (200, 201):
            print(f"failed mid-run: {response.status_code} {response.get_data(as_text=True)[:200]}")
            break
        samples.append(ms)
        counts.append(count)
        client.post(f"/v1/study-sessions/{response.get_json()['session']['id']}/abandon", headers=headers)

    samples.sort()
    out = {
        "label": args.label,
        "rounds": len(samples),
        "size": args.size,
        "ms_median": round(statistics.median(samples), 2),
        "ms_min": round(samples[0], 2),
        "ms_p95": round(samples[min(len(samples) - 1, int(len(samples) * 0.95))], 2),
        "statements": counts[0] if counts else None,
    }
    print(json.dumps(out, indent=2))
    Path(f"/tmp/bench-start-{args.label}.json").write_text(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
