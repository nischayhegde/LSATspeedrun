"""Install the seeded empire on the deployed database for a Google account.

Runs seed + stage + identity merge, then writes `/pitch/demo-sessions.json`
so the production deck frames the sessions this run just created.

Requires ``ALLOW_DEPLOYED_DEMO_SEED=1``. Does not enable DEV_AUTH.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_EMAIL = "alanmakeel@gmail.com"
DEFAULT_SOURCE = "student@localhost.test"
SESSIONS_PATH = Path("/var/www/lsat-speedrun/pitch/demo-sessions.json")


def _run(script: str, extra: list[str]) -> dict:
    env = os.environ.copy()
    env["ALLOW_DEPLOYED_DEMO_SEED"] = "1"
    command = [sys.executable, str(BACKEND_DIR / "scripts" / script), "--apply", "--allow-deployed", *extra]
    if script == "merge_demo_identity.py":
        command = [sys.executable, str(BACKEND_DIR / "scripts" / script), "--apply", *extra]
    completed = subprocess.run(
        command,
        cwd=str(BACKEND_DIR),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    text = completed.stdout.strip()
    if not text:
        raise SystemExit(f"{script} produced no output.\n{completed.stderr}")
    start = text.find("{")
    if start < 0:
        raise SystemExit(f"{script} did not print JSON.\n{text}\n{completed.stderr}")
    return json.loads(text[start:])


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision the deployed Google demo account.")
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--from-email", default=DEFAULT_SOURCE)
    parser.add_argument("--sessions-path", default=str(SESSIONS_PATH))
    parser.add_argument("--no-model", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if os.getenv("ALLOW_DEPLOYED_DEMO_SEED") != "1":
        raise SystemExit("Set ALLOW_DEPLOYED_DEMO_SEED=1 to provision the deployed demo account.")
    if not args.apply:
        raise SystemExit("Refusing to run without --apply.")

    merge = _run("merge_demo_identity.py", ["--from-email", args.from_email, "--to-email", args.email])
    seed = _run("seed_demo.py", ["--email", args.email, "--no-backup"])
    stage_args = ["--email", args.email]
    if args.no_model:
        stage_args.append("--no-model")
    stage = _run("stage_demo.py", stage_args)

    sessions = {
        "demoEmail": args.email,
        "liveSessionId": stage.get("open_case", {}).get("session_id", ""),
        "verdictSessionId": stage.get("verdict", {}).get("session_id", ""),
        "soloSessionId": stage.get("solo", {}).get("session_id", ""),
        "soloAnswerKey": stage.get("solo", {}).get("answer_key", ""),
        "autoplaySessionId": stage.get("autoplay", {}).get("session_id", ""),
        "autoplayAnswerKey": stage.get("autoplay", {}).get("answer_key", ""),
    }
    destination = Path(args.sessions_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(sessions, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(
        {
            "email": args.email,
            "merge": merge,
            "seeded": bool(seed.get("seeded")),
            "sessions": sessions,
            "sessions_path": str(destination),
            "solo_coaching": stage.get("solo", {}).get("coaching_status") or stage.get("solo", {}).get("status"),
            "verdict_coaching": stage.get("verdict", {}).get("coaching_status") or stage.get("verdict", {}).get("status"),
        },
        indent=2,
        default=str,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
