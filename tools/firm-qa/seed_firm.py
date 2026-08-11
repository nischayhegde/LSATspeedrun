"""Seed the isolated QA database with a firm advanced enough to show every
state the Firm tab can be in: held districts, unheld-but-signable districts,
districts locked behind a network the firm does not hold, owned and unowned
connections, decor, staff and a live client contract.

Runs through the real game module so cash, ledger rows and gates stay
consistent with what the running server will report.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path("/private/tmp/lsat-firm/backend")
sys.path.insert(0, str(BACKEND))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import User  # noqa: E402
from app import game  # noqa: E402

EMAIL = "firm-qa@localhost.test"

app = create_app()
with app.app_context():
    user = User.query.filter_by(email=EMAIL).first()
    if not user:
        user = User(email=EMAIL, display_name="Firm QA")
        db.session.add(user)
        db.session.commit()

    profile = user.game_profile
    if not profile:
        profile = game.create_profile(user, {"lawyer_name": "Rowan Vance", "firm_name": "Vance & Co.", "character_gender": "female"})
        db.session.commit()
    profile.cash = 90_000_000
    profile.reputation = 78.0
    profile.total_cases = 420
    db.session.commit()

    TARGET_TIER = 6

    def buy_everything_available(predicate):
        """Requirement chains are order-dependent, so sweep until nothing moves."""
        while True:
            owned = game._owned_keys(profile)
            progressed = False
            for item in game.ASSETS:
                if item["key"] in owned or not predicate(item):
                    continue
                if any(req not in owned for req in item.get("requires", ())):
                    continue
                profile.cash = max(profile.cash, item["cost"] * 2)
                profile.reputation = max(profile.reputation, float(item["reputation"]))
                db.session.commit()
                try:
                    game.purchase_asset(profile, item["key"])
                    progressed = True
                except Exception:  # noqa: BLE001, S110
                    pass
            if not progressed:
                return

    # Walk the tier ladder for real: each rung needs every prior upgrade, staff
    # hire and acquisition, which is exactly the owned catalog we want. Leave
    # the connections out of the sweep -- an unowned network is what puts a
    # locked district on the board, which is a state worth photographing.
    for target in range(1, TARGET_TIER + 1):
        # Connections included: tier advancement gates on rivals, and several
        # rivals require a network, so leaving them out stalls the ladder.
        buy_everything_available(lambda item, t=target: item["tier"] <= t)
        for key in game._tier_required_asset_keys(target):
            if key not in game._owned_keys(profile):
                profile.cash = max(profile.cash, game.ASSET_BY_KEY[key]["cost"] * 2)
                profile.reputation = max(profile.reputation, float(game.ASSET_BY_KEY[key]["reputation"]))
                db.session.commit()
                try:
                    game.purchase_asset(profile, key)
                except Exception as exc:  # noqa: BLE001
                    print("skip asset", key, exc)
        profile.cash = max(profile.cash, game.FIRM_TIERS[target]["cost"] * 2)
        profile.reputation = max(profile.reputation, float(game.FIRM_TIERS[target]["reputation"]))
        db.session.commit()
        try:
            game.advance_firm(profile, target)
        except Exception as exc:  # noqa: BLE001
            print("skip tier", target, exc)

    # Three of the fourteen networks, so the Districts tab carries owned cards,
    # affordable cards and locked cards at once.
    for key in ("local_bar", "business_network", "board_network"):
        profile.cash = max(profile.cash, game.ASSET_BY_KEY[key]["cost"] * 2)
        db.session.commit()
        try:
            game.purchase_asset(profile, key)
        except Exception as exc:  # noqa: BLE001
            print("skip connection", key, exc)

    # Districts: hold a spread across the first two regions, and deliberately
    # leave signable ones and connection-locked ones on the board.
    profile.cash = 90_000_000
    profile.reputation = 78.0
    db.session.commit()
    for district in game.DISTRICTS[:7]:
        try:
            game.secure_district(profile, district["key"])
        except Exception as exc:  # noqa: BLE001
            print("skip district", district["key"], exc)

    # Answer every story chapter that is waiting, so the prologue modal is not
    # sitting over the Firm tab in every screenshot.
    for _ in range(40):
        pending = game.serialize_game(profile)["story"].get("pending_chapter")
        if not pending or not pending.get("choices"):
            break
        try:
            game.choose_story(profile, pending["key"], pending["choices"][0]["key"])
        except Exception as exc:  # noqa: BLE001
            print("skip story", exc)
            break

    try:
        game.select_client(profile, "regional_corporation")
    except Exception as exc:  # noqa: BLE001
        print("skip client", exc)

    profile.cash = 12_400_000
    db.session.commit()

    state = game.territory_state(profile)
    owned = game._owned_keys(profile)
    connections = [a for a in game.ASSETS if a["type"] == "connection"]
    print("tier", profile.office_tier, "cash", profile.cash, "rep", round(profile.reputation, 1))
    print("districts held", state["held"], "/", state["total"], "standing", state["standing"])
    print("regions", [(r["name"], r["held"], r["total"]) for r in state["regions"]])
    print("connections owned", sum(1 for c in connections if c["key"] in owned), "/", len(connections))
    print("signable now", [d["key"] for d in state["districts"] if d["available"] and d["affordable"]][:6])
    print("connection-locked", [d["key"] for d in state["districts"] if any("network" in l or "circle" in l or "council" in l or "bar" in l or "forum" in l or "exchange" in l or "compact" in l or "assembly" in l for l in d["locks"])][:6])
