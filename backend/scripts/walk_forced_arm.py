"""Walk a real run over HTTP until a standing order blocks it, then get past it.

Everything in `tests/test_enforcement.py` runs in-process against Flask's test
client. That is the right place for the assignment arithmetic, but it cannot
catch a serialization bug, a cookie or CSRF mistake, or a field the browser
needs that never leaves the server. This walks what the browser walks, twice:
once answering the mandatory question with the work attached, and once refusing
it until the way out opens and then taking it.

Local only. Point it at a stack started with DEV_AUTH_ENABLED, which
`create_app` refuses outright in production.

    python scripts/walk_forced_arm.py --base http://127.0.0.1:5099/v1
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from http.cookiejar import CookieJar


class Client:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def _csrf(self) -> str:
        return next((cookie.value or "" for cookie in self.jar if cookie.name == "lsat_csrf"), "")

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"{self.base}{path}", data=data, method=method)
        request.add_header("Content-Type", "application/json")
        request.add_header("Idempotency-Key", str(uuid.uuid4()))
        token = self._csrf()
        if token:
            request.add_header("X-CSRF-Token", token)
        try:
            with self.opener.open(request, timeout=120) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if condition else 'FAIL'}  {label}{f'  [{detail}]' if detail else ''}")
    if not condition:
        sys.exit(1)


REASONING = (
    "The argument moves from a claim about the sample to a claim about the whole "
    "population, and the credited choice is the one that closes exactly that gap "
    "rather than widening the scope or swapping a term."
)

WORK = (
    "It has to close the step from the group that was studied to the wider "
    "population the conclusion is about, without adding a stronger claim than "
    "the support can carry."
)


def artifact_for(gate: dict) -> dict:
    """The work a text-only gate demands, in the shape the card submits it.

    Only text gates are walked. The rest want segment indices, struck choices or
    a chosen contrapositive, and satisfying those over HTTP would mean
    reimplementing the card's editors in a script to prove a point about
    routing.
    """

    return {"fields": {field["key"]: WORK for field in gate["fields"]}}


def standing_order(base: str) -> tuple[Client, str, dict]:
    """Take fresh runs until one opens on a mandatory, text-gated question.

    Answering forward to reach one would be the more faithful walk, but each
    answer waits on the settlement that grades it, which is a live model call
    and not available offline. Where in the run the draw lands is random, so
    the item this reaches is the same item.
    """

    seen: list[str] = []
    for attempt_number in range(80):
        client = Client(base)
        email = f"walk-{uuid.uuid4().hex[:10]}@localhost.test"
        status, _ = client.call("POST", "/auth/dev", {"email": email, "display_name": "Walk Student"})
        check("signed in", status == 200, str(status)) if not seen else None
        client.call(
            "POST",
            "/game/profile",
            {"lawyer_name": "Alex Morgan", "firm_name": "Morgan Legal", "character_gender": "female"},
        )
        status, payload = client.call("POST", "/study-sessions", {"size": 10})
        check("run started", status in (200, 201), json.dumps(payload)[:160]) if not seen else None
        session = payload.get("session") or {}
        item = session.get("current_item") or {}
        gate = item.get("strategy_gate") or {}
        seen.append(f"{(item.get('strategy_trial') or {}).get('variant')}/{gate.get('strategy_key')}")
        if (item.get("strategy_trial") or {}).get("required") and all(
            field["kind"] == "text" for field in gate.get("fields", [{"kind": "other"}])
        ):
            return client, session["id"], item
        client.call("POST", f"/study-sessions/{session['id']}/abandon")
    check("a run opened on a standing order", False, " | ".join(seen[:12]))
    raise SystemExit(1)


def answering(client: Client, session_id: str, item: dict, extra: dict) -> tuple[int, dict]:
    return client.call(
        "POST",
        f"/study-sessions/{session_id}/attempts",
        {
            "item_id": item["id"],
            "selected_label": item["question"]["choices"][0]["label"],
            "elapsed_ms": 45000,
            "confidence": 3,
            **({"reasoning": REASONING} if item.get("requires_reasoning") else {}),
            **extra,
        },
    )


def walk_the_work(base: str) -> None:
    print("\n  a standing order, worked")
    client, session_id, item = standing_order(base)
    gate = item["strategy_gate"]
    print(f"        approach '{gate['strategy_key']}', gate '{gate['kind']}'")
    check("marked required", item["strategy_trial"].get("required") is True, str(item["strategy_trial"].get("variant")))
    check("gate blocks", gate.get("blocking") is True and gate.get("required") is True)
    check("no way out offered yet", gate.get("stand_down_ready") is False)
    check("copy stays in the fiction", gate["copy"]["required_eyebrow"] == "STANDING ORDER", gate["copy"]["required_title"])

    status, payload = answering(client, session_id, item, {})
    error = payload.get("error", {})
    check("a bare answer is refused by the server", status == 409, str(status))
    check("refused by the gate", error.get("code") == "strategy_gate_unsatisfied", json.dumps(error)[:160])
    check("one refusal does not open the way out", error.get("stand_down") is False)

    status, payload = answering(
        client,
        session_id,
        item,
        {
            "strategy_key": gate["strategy_key"],
            "strategy_applied": True,
            "strategy_artifact": artifact_for(gate),
            "strategy_gate_ms": 34000,
        },
    )
    check("the same answer with the work attached is taken", status in (200, 201), json.dumps(payload)[:200])
    check("and the case settles as any other would", bool(payload.get("result", {}).get("feedback")))


def walk_the_way_out(base: str) -> None:
    """The relief valve, which is the difference between structure and a wall."""

    print("\n  a standing order, refused")
    client, session_id, item = standing_order(base)
    gate = item["strategy_gate"]
    print(f"        approach '{gate['strategy_key']}', gate '{gate['kind']}'")

    status, payload = answering(client, session_id, item, {"strategy_key": gate["strategy_key"], "strategy_applied": False})
    check("dropping it straight away is refused", status == 409, str(status))
    check("and the refusal says the exit is shut", payload.get("error", {}).get("stand_down") is False)

    # Only a real attempt at the work counts toward the way out. Asking to drop
    # it is not an attempt, which is why the request above changed nothing.
    for refusal in (1, 2):
        status, payload = answering(
            client,
            session_id,
            item,
            {"strategy_key": gate["strategy_key"], "strategy_applied": True, "strategy_artifact": {"fields": {"prediction": "no idea"}}},
        )
        check(f"attempt {refusal} at the work is refused", status == 409, str(status))
        opened = payload.get("error", {}).get("stand_down")
        check(
            "the exit is still shut" if refusal == 1 else "the second refusal opens the exit",
            opened is (refusal == 2),
            json.dumps(payload.get("error", {}).get("fields"))[:120],
        )

    status, payload = answering(client, session_id, item, {"strategy_key": gate["strategy_key"], "strategy_applied": False})
    check("and now the answer goes through without the approach", status in (200, 201), json.dumps(payload)[:200])
    check("the case still settles, unpunished", bool(payload.get("result", {}).get("feedback")))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:5099/v1")
    args = parser.parse_args()
    walk_the_work(args.base)
    walk_the_way_out(args.base)
    # What the rows end up holding -- gate status, stratum, propensity, refusal
    # count -- is asserted in tests/test_enforcement.py against the model. No
    # endpoint serializes those, and adding one to satisfy a script would be
    # shipping API surface for a debugging convenience.
    print("\n  walk complete\n")


if __name__ == "__main__":
    main()
