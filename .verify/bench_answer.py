"""Times the one action a student performs hundreds of times: answering a case.

Every measured pass on this app so far has benchmarked reads — the dashboard, the
firm, the projection. But the read a student does once per screen is not where
they spend their session; `POST /study-sessions/{id}/attempts` is. It grades the
answer, settles the reward, moves the campaign and returns new game state, and
nobody has ever put a number on it.

Same discipline as bench_api.py: a throwaway copy of the real development
database, in-process so statements can be counted, and the statement count is the
claim rather than the wall time.

Usage:
    python .verify/bench_answer.py [--label NAME] [--answers N]
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench_api import BACKEND, REPO, StatementCounter, build_app, clone_database, upgrade_copy  # noqa: E402


def statements_by_shape(statements: list[str]) -> list[tuple[int, str]]:
    """The same query issued forty times is one bug, not forty. Grouping by the
    statement text with its bind parameters stripped is what makes an N+1 visible
    as a count rather than as a wall of near-identical lines."""
    shapes: dict[str, int] = {}
    for statement in statements:
        shapes[statement] = shapes.get(statement, 0) + 1
    return sorted(((count, text) for text, count in shapes.items()), reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="answers")
    parser.add_argument("--answers", type=int, default=10)
    parser.add_argument("--email", default="qa-megalit-test1@localhost.test")
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
        print(f"dev login failed: {login.status_code} {login.get_data(as_text=True)[:300]}")
        return 1

    import time

    # Every mutating endpoint is CSRF-guarded, so the bench has to present the
    # token the same way the browser does: read it from the cookie the login
    # response set and echo it in the header.
    csrf = next((c.value for c in client.cookie_jar if c.name == "lsat_csrf"), None) if hasattr(client, "cookie_jar") else None
    if csrf is None:
        csrf = client.get_cookie("lsat_csrf").value  # Werkzeug 2.3+ dropped cookie_jar

    def timed(method: str, path: str, **kwargs):
        if method != "get":
            headers = dict(kwargs.get("headers") or {})
            headers.setdefault("X-CSRF-Token", csrf)
            kwargs["headers"] = headers
        counter.reset()
        counter.capture = True
        start = time.perf_counter()
        response = getattr(client, method)(path, **kwargs)
        elapsed = (time.perf_counter() - start) * 1000
        return response, elapsed, counter.total, counter.writes, list(counter.statements)

    # A session of practice questions, which is what the Cases screen starts.
    started, start_ms, start_stmts, start_writes, start_sql = timed(
        "post", "/v1/study-sessions", json={"size": args.answers}
    )
    if started.status_code not in (200, 201):
        print(f"could not start a session: {started.status_code} {started.get_data(as_text=True)[:400]}")
        return 1
    session = started.get_json()["session"]
    session_id = session["id"]
    items = session.get("items") or []
    print(f"\n== POST /study-sessions (size {args.answers}) ==")
    print(f"{start_ms:.1f} ms, {start_stmts} statements ({start_writes} writes), {len(items)} items")
    for count, text in statements_by_shape(start_sql)[:6]:
        print(f"  {count:>4}x  {text[:150]}")

    # Re-reading the session is what the case screen does on every navigation
    # between questions, so it is on the interactive path too.
    _read, read_ms, read_stmts, read_writes, read_sql = timed("get", f"/v1/study-sessions/{session_id}")
    print(f"\n== GET /study-sessions/{{id}} ==")
    print(f"{read_ms:.1f} ms, {read_stmts} statements ({read_writes} writes)")
    for count, text in statements_by_shape(read_sql)[:8]:
        print(f"  {count:>4}x  {text[:150]}")

    rows = []
    for index, item in enumerate(items[: args.answers]):
        label = (item.get("question") or {}).get("choices", [{}])[0].get("label") or "A"
        response, ms, stmts, writes, sql = timed(
            "post",
            f"/v1/study-sessions/{session_id}/attempts",
            json={
                "item_id": item["id"],
                "selected_label": label,
                "reasoning": "Benchmark answer: the stimulus supports this reading most directly.",
                "confidence": 3,
            },
            headers={"Idempotency-Key": f"bench-{session_id}-{index}"},
        )
        if response.status_code not in (200, 201):
            print(f"\nattempt {index} failed: {response.status_code} {response.get_data(as_text=True)[:400]}")
            break
        rows.append({"ms": ms, "statements": stmts, "writes": writes, "sql": sql})

    if not rows:
        return 1

    times = sorted(r["ms"] for r in rows)
    print(f"\n== POST /study-sessions/{{id}}/attempts, {len(rows)} answers ==")
    print(f"median {statistics.median(times):.1f} ms   min {times[0]:.1f}   p95 {times[min(len(times) - 1, int(len(times) * 0.95))]:.1f}")
    print(f"statements per answer: {[r['statements'] for r in rows]}")
    print(f"writes per answer:     {[r['writes'] for r in rows]}")
    print("\nquery shapes on the last answer, most repeated first:")
    for count, text in statements_by_shape(rows[-1]["sql"])[:14]:
        print(f"  {count:>4}x  {text[:170]}")

    out = {
        "label": args.label,
        "start": {"ms": round(start_ms, 2), "statements": start_stmts, "writes": start_writes},
        "session_read": {"ms": round(read_ms, 2), "statements": read_stmts, "writes": read_writes},
        "attempts": [{"ms": round(r["ms"], 2), "statements": r["statements"], "writes": r["writes"]} for r in rows],
        "attempt_ms_median": round(statistics.median(times), 2),
    }
    report = REPO / ".verify" / f"bench-{args.label}.json"
    report.write_text(json.dumps(out, indent=2))
    print(f"\nwrote {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
