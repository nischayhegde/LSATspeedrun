"""Check, in about a second, whether `deck/demo.config.ts` still describes reality.

Six values in that file are pinned to rows in this database, and a re-seed
invalidates all six at once: session ids come from `uuid.uuid4()`, so nothing
survives `seed_demo.py` rebuilding the account. This reads all six back and says
which ones are dead.

    .venv/bin/python backend/scripts/repin_demo_session.py

Exits non-zero when anything is stale, so it doubles as a pre-flight check —
run it before a rehearsal and again before the talk.

## Why it no longer writes anything

It used to take `--write` and re-pin, and it re-pinned exactly one of the six::

    ASSIGNMENT = re.compile(r"(liveSessionId:\\s*)(['\\"])([^'\\"]*)\\2")

That was worse than doing nothing, because of *which* one. Re-pinning
`liveSessionId` brings the ordinary case slide back, so the command appears to
have worked — while `verdictSessionId`, `soloSessionId`, `soloAnswerKey`,
`autoplaySessionId` and `autoplayAnswerKey` still point at sessions that were
deleted. The centrepiece is `demo-case-answer`, which frames `{autoplay}`: with
a dead `soloSessionId` it falls back to the ordinary live case and simply never
plays itself, silently, in front of the room. A presenter who ran this two
minutes before walking on would have had every reason to believe they had fixed
it.

Re-pinning cannot be made to work here either, and that is the real point. Four
of the six are not *pins* that drifted, they are *staging* that no longer
exists: after a re-seed there is no solo case with pre-written reasoning and no
fifteen-question driven run, so there is no id to point at. Two of them —
`soloAnswerKey` and `autoplayAnswerKey` — cannot be recovered over the API at
all, by anything, because `serialize_question` omits `correct_answer` on
purpose. They have to be carried out of the database by the script that stages
the run.

That script is `stage_demo.py`, and the command that runs it and then pins all
six is::

    cd deck && npm run reset-demo

which takes about twenty seconds. So this file checks, names what is wrong, and
prints that command. It does not offer a repair it cannot actually perform.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "deck" / "demo.config.ts"
BACKEND_ORIGIN = "http://127.0.0.1:5001"
DEFAULT_EMAIL = "student@localhost.test"

RECOVERY = "cd deck && npm run reset-demo"

# Every value the deck pins, read out of the object literal. The type
# declarations above it read `liveSessionId: string` with no quotes, so
# requiring a quoted value cannot match them — the same assumption
# `prepare-demo.mjs` makes when it writes the file.
PINNED_KEYS = (
    "liveSessionId",
    "verdictSessionId",
    "soloSessionId",
    "soloAnswerKey",
    "autoplaySessionId",
    "autoplayAnswerKey",
)

# How many items each staged run has, which is what tells them apart over the
# API. `stage_demo.py` builds the solo case with `count=1` and the driven run
# with `AUTOPLAY_ITEM_COUNT`; keep these two in step with it.
SOLO_ITEMS = 1
AUTOPLAY_ITEMS = 15


def _request(path: str, *, payload: dict | None = None, cookie: str | None = None):
    """Return (json_body, set_cookie_header_list)."""
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(f"{BACKEND_ORIGIN}{path}", data=data)
    if data is not None:
        request.add_header("content-type", "application/json")
    if cookie:
        request.add_header("cookie", cookie)
    with urllib.request.urlopen(request, timeout=40) as response:
        body = json.loads(response.read() or b"null")
        return body, response.headers.get_all("Set-Cookie") or []


def read_backend(email: str) -> dict:
    """Everything this check needs, in two calls."""
    _login, cookies = _request("/v1/auth/dev", payload={"email": email})
    cookie = "; ".join(value.split(";")[0] for value in cookies)
    # `/v1/study-sessions/current` can take tens of seconds on its first call
    # after a seed, because it freezes and serializes the pending item.
    current, _ = _request("/v1/study-sessions/current", cookie=cookie)
    active, _ = _request("/v1/study-sessions/active", cookie=cookie)
    return {
        "current": (current or {}).get("session"),
        "sessions": (active or {}).get("sessions") or [],
    }


def read_pins() -> dict[str, str]:
    config = CONFIG_PATH.read_text()
    pins: dict[str, str] = {}
    for key in PINNED_KEYS:
        matches = re.findall(rf"{key}:\s*(['\"])([^'\"]*)\1", config)
        if len(matches) != 1:
            raise SystemExit(
                f"expected exactly one `{key}: '...'` in {CONFIG_PATH}, found {len(matches)}"
            )
        pins[key] = matches[0][1]
    return pins


def check(pins: dict[str, str], backend: dict) -> list[tuple[str, bool, str]]:
    """One row per pinned value: (name, healthy, what was found)."""
    current = backend["current"]
    sessions = {entry["id"]: entry for entry in backend["sessions"] if entry.get("id")}
    rows: list[tuple[str, bool, str]] = []

    live = (current or {}).get("id")
    item = (current or {}).get("current_item") or {}
    if not live:
        rows.append(("liveSessionId", False, "the backend reports no open case at all"))
    elif pins["liveSessionId"] != live:
        rows.append(("liveSessionId", False, f"the open case is {live}"))
    else:
        brief = "with a strategy brief" if item.get("strategy_trial") else "but it shows NO strategy brief"
        rows.append((
            "liveSessionId",
            bool(item.get("strategy_trial")),
            f"open, question {item.get('position', '?')} of {(current or {}).get('total_items', '?')}, {brief}",
        ))

    # The pre-graded twin, identified by what it is rather than by its id — a
    # paused run holding an already-graded attempt. Same test `prepare-demo.mjs`
    # uses to find it, so the two cannot disagree about which session this is.
    twin = sessions.get(pins["verdictSessionId"])
    if twin is None:
        rows.append(("verdictSessionId", False, "no such session on this account"))
    elif twin.get("status") != "paused" or not (twin.get("pending_result") or {}).get("attempt_id"):
        rows.append(("verdictSessionId", False,
                     f"exists but is {twin.get('status')} with no pending result, so the verdict "
                     "screen would not render"))
    else:
        rows.append(("verdictSessionId", True, "paused, holding a graded attempt"))

    solo = sessions.get(pins["soloSessionId"])
    if solo is None:
        rows.append(("soloSessionId", False,
                     "no such session — the driven case slide will fall back to the ordinary "
                     "live case and never play itself"))
    elif solo.get("total_items") != SOLO_ITEMS:
        rows.append(("soloSessionId", False, f"exists but has {solo.get('total_items')} items, not {SOLO_ITEMS}"))
    else:
        rows.append(("soloSessionId", True, f"open, {solo.get('total_items')} item"))

    key = pins["soloAnswerKey"]
    if not re.fullmatch(r"[A-E]", key):
        rows.append(("soloAnswerKey", False, f"{key!r} is not a single A-E letter"))
    else:
        # The letter itself cannot be checked from out here: the API omits
        # `correct_answer` from every question it serves, which is exactly why
        # the key has to be carried in the config in the first place.
        rows.append(("soloAnswerKey", True, f"{key} — shape only; the API never reveals the credited letter"))

    run = sessions.get(pins["autoplaySessionId"])
    if run is None:
        rows.append(("autoplaySessionId", False, "no such session (nothing in the deck requests it today)"))
    elif run.get("total_items") != AUTOPLAY_ITEMS:
        rows.append(("autoplaySessionId", False, f"exists but has {run.get('total_items')} items, not {AUTOPLAY_ITEMS}"))
    else:
        rows.append(("autoplaySessionId", True, f"open, {run.get('total_items')} items"))

    run_key = pins["autoplayAnswerKey"]
    if not re.fullmatch(r"[A-E]+", run_key or ""):
        rows.append(("autoplayAnswerKey", False, f"{run_key!r} is not A-E letters"))
    elif run is None:
        # Well-formed, and there is nothing for it to be well-formed *against*.
        # Saying "matching the run" here — which this used to — reads as a pass
        # on the line directly under a dead session id.
        rows.append(("autoplayAnswerKey", True,
                     f"{len(run_key)} letters, but the run above is gone, so there is "
                     "nothing to check them against"))
    elif len(run_key) != (run.get("total_items") or 0):
        # A key of the wrong length is a key from a *previous* run, which is the
        # failure that answers every question wrong in front of an audience.
        rows.append(("autoplayAnswerKey", False,
                     f"{len(run_key)} letters against a {run.get('total_items')}-question run, "
                     "so it belongs to a different staging"))
    else:
        rows.append(("autoplayAnswerKey", True, f"{len(run_key)} letters, matching the run"))

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Accepted, and refused. See the explanation this prints.",
    )
    args = parser.parse_args()

    if args.write:
        print(
            "This script does not re-pin any more, and --write is refused rather than\n"
            "quietly ignored.\n\n"
            "It used to rewrite `liveSessionId` and nothing else, which brought the ordinary\n"
            "case slide back and left the driven slide — the centrepiece — pointing at a\n"
            "deleted session. It looked like it had worked.\n\n"
            "Four of the six pinned values are staging rather than pins: after a re-seed the\n"
            "solo case and the driven run do not exist to be pointed at, and their answer keys\n"
            "cannot be read over the API at all. Re-stage instead:\n\n"
            f"    {RECOVERY}\n\n"
            "It takes about twenty seconds and pins all six.",
            file=sys.stderr,
        )
        return 2

    try:
        backend = read_backend(args.email)
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"backend not answering on {BACKEND_ORIGIN}: {error}", file=sys.stderr)
        print("Start it:  cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py", file=sys.stderr)
        return 2

    pins = read_pins()
    rows = check(pins, backend)
    width = max(len(name) for name, _, _ in rows)
    for name, healthy, detail in rows:
        mark = "ok  " if healthy else "DEAD"
        print(f"{mark}  {name.ljust(width)}  {pins[name] or '(empty)'}  {detail}")

    broken = [name for name, healthy, _ in rows if not healthy]
    if not broken:
        print("\nOK — all six pinned values match this backend.")
        return 0

    print(f"\nSTALE — {len(broken)} of {len(rows)} pinned values are wrong: {', '.join(broken)}.")
    print(f"Re-stage and re-pin all six:\n\n    {RECOVERY}\n")
    print("Do not hand-edit one id. They are staged together and they go stale together;")
    print("fixing the one that is visibly broken is how the rest stay broken quietly.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
