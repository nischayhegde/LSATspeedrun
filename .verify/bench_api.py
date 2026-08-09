"""In-process endpoint benchmark against a copy of the real development database.

Why in-process rather than curl against the dev server: this attributes cost to
the handler instead of to Werkzeug's threading and the loopback, and it lets us
count SQL statements, which is the number that actually predicts behaviour
against RDS where every statement is a network round trip. Wall time here is a
lower bound on the real thing, but the *ratio* before/after is the claim.

The database is always a fresh copy under .verify/, never the live file, because
several of these endpoints commit.

Usage:
    python .verify/bench_api.py [--label NAME] [--runs N] [--email ADDR]
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import sqlite3
import statistics
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BACKEND = REPO / "backend"
SCRATCH = REPO / ".verify" / "scratch"

# Endpoints worth timing: every plain read the dashboard and the shell hit.
ENDPOINTS = [
    ("GET", "/v1/game"),
    ("GET", "/v1/performance"),
    ("GET", "/v1/projection"),
    ("GET", "/v1/me"),
    ("GET", "/v1/trial"),
    ("GET", "/v1/history/sessions"),
    ("GET", "/v1/daily-docket"),
    ("GET", "/v1/reviews"),
]


def clone_database(source: Path) -> Path:
    """A WAL-checkpointed copy of the dev database, so the live file is untouched."""
    SCRATCH.mkdir(parents=True, exist_ok=True)
    target = SCRATCH / "bench.db"
    for suffix in ("", "-wal", "-shm"):
        stale = Path(str(target) + suffix)
        if stale.exists():
            stale.unlink()
    # VACUUM INTO, not a file copy. The dev database runs in WAL mode with
    # megabytes of uncheckpointed commits, and neither a main-file-only copy nor
    # a hand-rolled main+wal copy reproduces them: the first comes out stamped
    # revisions behind, and the second loses the WAL outright whenever the live
    # server checkpoints between the two copies. VACUUM INTO reads one consistent
    # snapshot through sqlite itself and writes nothing to the source.
    source_db = sqlite3.connect(str(source))
    try:
        source_db.execute("VACUUM INTO ?", (str(target),))
    finally:
        source_db.close()
    return target


def upgrade_copy(db_path: Path) -> None:
    """Bring the copy to migration head. The dev database is often a revision or
    two behind, and a schema older than the mapped classes fails on unrelated
    columns rather than on anything we are measuring."""
    import subprocess

    env = dict(os.environ)
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    env["AUTO_SEED"] = "false"
    env["FLASK_APP"] = "run:app"
    done = subprocess.run(
        [sys.executable, "-m", "flask", "db", "upgrade"],
        cwd=str(BACKEND),
        env=env,
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        print(done.stdout[-2000:])
        print(done.stderr[-2000:])
        raise SystemExit("could not bring the benchmark copy to migration head")


def build_app(db_path: Path):
    sys.path.insert(0, str(BACKEND))
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["AUTO_SEED"] = "false"
    os.environ["DEV_AUTH_ENABLED"] = "true"
    os.environ["FLASK_ENV"] = "development"
    # An in-process grading thread would land writes in the middle of a timing
    # loop, which is noise we are not trying to measure.
    os.environ["AI_JOBS_MODE"] = "sync"
    from app import create_app  # noqa: PLC0415 - after the env is arranged

    return create_app()


class StatementCounter:
    """Counts SQL statements and separates the writes from the reads."""

    def __init__(self, engine):
        from sqlalchemy import event

        self.engine = engine
        self.reset()
        event.listen(engine, "before_cursor_execute", self._before)

    def _before(self, _conn, _cursor, statement, _params, _context, _many):
        head = statement.lstrip()[:6].upper()
        self.total += 1
        if head.startswith(("INSERT", "UPDATE", "DELETE")):
            self.writes += 1
        elif "FOR UPDATE" in statement.upper():
            self.locks += 1
        if self.capture:
            self.statements.append(" ".join(statement.split())[:220])

    def reset(self):
        self.total = 0
        self.writes = 0
        self.locks = 0
        self.statements: list[str] = []
        self.capture = False


def inspect(client, counter, method: str, path: str) -> dict:
    """The deterministic facts about one response: shape, size, statement count."""
    request = getattr(client, method.lower())
    # One warm call first, so import-time and first-touch costs land nowhere.
    warm = request(path, headers={"Accept-Encoding": "gzip"})
    if warm.status_code >= 400:
        return {"path": path, "status": warm.status_code, "error": warm.get_data(as_text=True)[:200]}

    counter.reset()
    single = request(path, headers={"Accept-Encoding": "gzip"})
    body = single.get_data()
    if single.headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(body)
        wire = len(body)
    else:
        raw = body
        wire = len(gzip.compress(body, 6))

    return {
        "path": path,
        "status": single.status_code,
        "bytes": len(raw),
        "gzip_bytes": wire,
        "statements": counter.total,
        "writes": counter.writes,
        "locks": counter.locks,
        "body": raw.decode("utf-8", "replace"),
    }


def time_rounds(client, paths: list[tuple[str, str]], rounds: int) -> dict[str, list[float]]:
    """Interleave the endpoints round by round rather than timing each to
    completion. This machine runs several agents at once, and a burst of load
    during a block of consecutive samples lands entirely on whichever endpoint
    happened to be under test; spreading each endpoint's samples across the whole
    run makes every one of them see the same weather."""
    samples: dict[str, list[float]] = {path: [] for _method, path in paths}
    for _ in range(rounds):
        for method, path in paths:
            request = getattr(client, method.lower())
            start = time.perf_counter()
            request(path, headers={"Accept-Encoding": "gzip"})
            samples[path].append((time.perf_counter() - start) * 1000)
    return samples


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="run")
    parser.add_argument("--runs", type=int, default=15)
    parser.add_argument("--email", default="qa-megalit-test1@localhost.test")
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    live = BACKEND / "instance" / "lsat_sherlock.db"
    db_path = clone_database(live)
    upgrade_copy(db_path)
    app = build_app(db_path)

    with app.app_context():
        from app.extensions import db

        counter = StatementCounter(db.engine)

    client = app.test_client()
    login = client.post("/v1/auth/dev", json={"email": args.email})
    if login.status_code != 200:
        print(f"dev login failed: {login.status_code} {login.get_data(as_text=True)[:300]}")
        return 1

    wanted = [pair for pair in ENDPOINTS if not args.only or args.only in pair[1]]
    rows = [inspect(client, counter, method, path) for method, path in wanted]
    healthy = [pair for pair, row in zip(wanted, rows) if "error" not in row]
    samples = time_rounds(client, healthy, args.runs)

    bodies = REPO / ".verify" / f"bodies-{args.label}"
    bodies.mkdir(parents=True, exist_ok=True)
    for row in rows:
        body = row.pop("body", None)
        if body is None:
            continue
        name = row["path"].strip("/").replace("/", "_") + ".json"
        try:
            body = json.dumps(json.loads(body), indent=2, sort_keys=True)
        except ValueError:
            pass
        (bodies / name).write_text(body)

    for row in rows:
        series = sorted(samples.get(row["path"], []))
        if not series:
            continue
        row["ms_median"] = round(statistics.median(series), 2)
        row["ms_min"] = round(series[0], 2)
        row["ms_p95"] = round(series[min(len(series) - 1, int(len(series) * 0.95))], 2)

    out = {"label": args.label, "email": args.email, "rounds": args.runs, "results": rows}
    report = REPO / ".verify" / f"bench-{args.label}.json"
    report.write_text(json.dumps(out, indent=2))

    header = f"{'endpoint':<26}{'med ms':>9}{'min ms':>9}{'p95 ms':>9}{'bytes':>10}{'gzip':>9}{'stmts':>7}{'wr':>5}{'lock':>6}"
    print(f"\n== {args.label} ({args.email}, {args.runs} interleaved rounds) ==")
    print(header)
    print("-" * len(header))
    for row in rows:
        if "ms_median" not in row:
            print(f"{row['path']:<26}  status {row['status']}  {row.get('error', '')}")
            continue
        print(
            f"{row['path']:<26}{row['ms_median']:>9}{row['ms_min']:>9}{row['ms_p95']:>9}"
            f"{row['bytes']:>10}{row['gzip_bytes']:>9}{row['statements']:>7}{row['writes']:>5}{row['locks']:>6}"
        )
    print(f"\nwrote {report} and {bodies}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
