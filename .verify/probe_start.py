"""Where the 790 ms of "Start practice" goes.

`POST /study-sessions` is the button that begins a study session, and it measured
793 ms against the development database — an order of magnitude worse than any
read on the dashboard, and the one number in this app a student waits on before
they can do anything. 70 SQL statements do not explain it; at loopback latency
that is tens of milliseconds, so most of the cost is Python.

cProfile, sorted by cumulative time, with the SQL grouped by shape alongside it,
so a slow line and a repeated query can be told apart.

Usage:
    python .verify/probe_start.py [--size N]
"""

from __future__ import annotations

import argparse
import cProfile
import pstats
import sys
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench_api import BACKEND, StatementCounter, build_app, clone_database, upgrade_copy  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", type=int, default=8)
    parser.add_argument("--email", default="qa-megalit-test1@localhost.test")
    parser.add_argument("--top", type=int, default=35)
    args = parser.parse_args()

    db_path = clone_database(BACKEND / "instance" / "lsat_sherlock.db")
    upgrade_copy(db_path)
    app = build_app(db_path)
    with app.app_context():
        from app.extensions import db

        counter = StatementCounter(db.engine)

    client = app.test_client()
    login = client.post("/v1/auth/dev", json={"email": args.email})
    if login.status_code != 200:
        print(f"dev login failed: {login.status_code}")
        return 1
    csrf = client.get_cookie("lsat_csrf").value
    headers = {"X-CSRF-Token": csrf}

    # One session first: import-time work and any lazily built cache should be
    # paid before the profiled call, so the profile shows steady-state cost.
    warm = client.post("/v1/study-sessions", json={"size": args.size}, headers=headers)
    print(f"warm-up session: {warm.status_code}")

    counter.reset()
    counter.capture = True
    profiler = cProfile.Profile()
    profiler.enable()
    response = client.post("/v1/study-sessions", json={"size": args.size}, headers=headers)
    profiler.disable()
    print(f"profiled session: {response.status_code}, {counter.total} statements, {counter.writes} writes")

    shapes: dict[str, int] = {}
    for statement in counter.statements:
        head = " ".join(statement.split())[:110]
        shapes[head] = shapes.get(head, 0) + 1
    print("\n== SQL by shape ==")
    for text, count in sorted(shapes.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>4}x  {text}")

    stream = StringIO()
    stats = pstats.Stats(profiler, stream=stream).sort_stats("cumulative")
    stats.print_stats(args.top)
    text = stream.getvalue()
    # Only the app's own frames and the SQLAlchemy boundary matter here; the rest
    # is interpreter plumbing that cannot be acted on.
    print("\n== cumulative, app frames only ==")
    for line in text.splitlines():
        if "/app/" in line or "sqlalchemy" in line or "ncalls" in line or "function calls" in line:
            print(line[:200])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
