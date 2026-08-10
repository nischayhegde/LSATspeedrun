"""Re-point `deck/demo.config.ts` at the case session that is open right now.

`prepare-demo.mjs` does this too, but it also launches a headless browser and
takes about two minutes. This does only the part that goes stale — the session
id — and finishes in about a second, which is what you want when you are
minutes from presenting.

Use it whenever the case slide shows a login screen or an error: any re-run of
`seed_demo.py`, by anyone on this machine, deletes the open session and stages
a new one with a new id, which leaves the pinned id in demo.config.ts dangling.

    .venv/bin/python backend/scripts/repin_demo_session.py          # check only
    .venv/bin/python backend/scripts/repin_demo_session.py --write  # re-pin

Exits non-zero when the pinned id is wrong (or absent) and `--write` was not
passed, so it doubles as a pre-flight check.
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
ASSIGNMENT = re.compile(r"(liveSessionId:\s*)(['\"])([^'\"]*)\2")


def _request(path: str, *, payload: dict | None = None, cookie: str | None = None):
    """Return (json_body, set_cookie_header_list)."""
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(f"{BACKEND_ORIGIN}{path}", data=data)
    if data is not None:
        request.add_header("content-type", "application/json")
    if cookie:
        request.add_header("cookie", cookie)
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.loads(response.read() or b"null")
        return body, response.headers.get_all("Set-Cookie") or []


def open_session(email: str) -> dict | None:
    _login, cookies = _request("/v1/auth/dev", payload={"email": email})
    cookie = "; ".join(value.split(";")[0] for value in cookies)
    # `/v1/study-sessions/current` can take tens of seconds on its first call
    # after a seed, because it freezes and serializes the pending item.
    body, _ = _request("/v1/study-sessions/current", cookie=cookie)
    return (body or {}).get("session")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--write", action="store_true", help="Rewrite demo.config.ts.")
    args = parser.parse_args()

    try:
        session = open_session(args.email)
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"backend not answering on {BACKEND_ORIGIN}: {error}", file=sys.stderr)
        print("Start it:  cd backend && PORT=5001 DEV_AUTH_ENABLED=true ../.venv/bin/python run.py", file=sys.stderr)
        return 2

    if not session:
        print("No open case session. Re-run the seeder:", file=sys.stderr)
        print("  cd backend && DEV_AUTH_ENABLED=true ../.venv/bin/python scripts/seed_demo.py --apply", file=sys.stderr)
        return 2

    item = session.get("current_item") or {}
    live_id = session["id"]
    renders_prompt = bool(item.get("strategy_trial"))

    config = CONFIG_PATH.read_text()
    matches = list(ASSIGNMENT.finditer(config))
    if len(matches) != 1:
        print(f"expected one liveSessionId in {CONFIG_PATH}, found {len(matches)}", file=sys.stderr)
        return 2
    pinned = matches[0].group(3)

    print(f"open session   {live_id}  (question {item.get('position', '?')} of {session.get('total_items', '?')})")
    print(f"strategy brief {'yes' if renders_prompt else 'NO — this session will not show the brief'}")
    print(f"pinned in deck {pinned or '(empty)'}")

    if pinned == live_id:
        print("\nOK — the deck is pinned to the open session.")
        return 0 if renders_prompt else 1

    if not args.write:
        print("\nSTALE — the deck points at a session that is not the open one.")
        print("Re-pin with:  .venv/bin/python backend/scripts/repin_demo_session.py --write")
        return 1

    CONFIG_PATH.write_text(ASSIGNMENT.sub(rf"\g<1>'{live_id}'", config))
    print(f"\nre-pinned {pinned or '(empty)'} -> {live_id}")
    print("Vite hot-reloads the deck; just reload the browser tab.")
    return 0 if renders_prompt else 1


if __name__ == "__main__":
    raise SystemExit(main())
