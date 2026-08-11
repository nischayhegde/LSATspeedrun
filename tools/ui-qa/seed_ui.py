"""Seed the UI-QA database with an account far enough along that every surface
this sweep photographs has something real in it.

Adapted from `tools/firm-qa/seed_firm.py`, which hard-coded a worktree path and
one email. This one takes the backend from the repository it lives in and reads
its target from the environment, so it runs anywhere the repository is checked
out:

    DATABASE_URL=sqlite:////workspace/.qa-run/qa.db \
    UI_QA_EMAIL=ui-qa@localhost.test python3 tools/ui-qa/seed_ui.py

It walks the real tier ladder, so cash, ledger rows and gates stay consistent
with what the running server will report.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import User  # noqa: E402
from app import game  # noqa: E402

EMAIL = os.getenv("UI_QA_EMAIL", "ui-qa@localhost.test")
TARGET_TIER = int(os.getenv("UI_QA_TIER", "6"))

app = create_app()
with app.app_context():
    user = User.query.filter_by(email=EMAIL).first()
    if not user:
        user = User(email=EMAIL, display_name="UI QA")
        db.session.add(user)
        db.session.commit()

    profile = user.game_profile
    if not profile:
        profile = game.create_profile(
            user,
            {"lawyer_name": "Rowan Vance", "firm_name": "Vance & Co.", "character_gender": "female"},
        )
        db.session.commit()
    profile.cash = 90_000_000
    profile.reputation = 78.0
    profile.total_cases = 420
    profile.total_correct = 331
    db.session.commit()

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

    for target in range(1, TARGET_TIER + 1):
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

    for key in ("local_bar", "business_network", "board_network"):
        profile.cash = max(profile.cash, game.ASSET_BY_KEY[key]["cost"] * 2)
        db.session.commit()
        try:
            game.purchase_asset(profile, key)
        except Exception as exc:  # noqa: BLE001
            print("skip connection", key, exc)

    profile.cash = 90_000_000
    profile.reputation = 78.0
    db.session.commit()
    for district in game.DISTRICTS[:7]:
        try:
            game.secure_district(profile, district["key"])
        except Exception as exc:  # noqa: BLE001
            print("skip district", district["key"], exc)

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
    user.guided_tour_completed = True
    db.session.commit()

    state = game.territory_state(profile)
    owned = game._owned_keys(profile)
    connections = [a for a in game.ASSETS if a["type"] == "connection"]
    print("email", EMAIL)
    print("tier", profile.office_tier, "cash", profile.cash, "rep", round(profile.reputation, 1))
    print("districts held", state["held"], "/", state["total"], "standing", state["standing"])
    print("connections owned", sum(1 for c in connections if c["key"] in owned), "/", len(connections))
