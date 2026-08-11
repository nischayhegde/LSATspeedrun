"""Stand up a late-game firm, so the late-game map can be looked at.

The map half of the district mechanic only exists from tier 7 up in the Treaty
Sea and from tier 12 up in the Global Compact, and a contact figure is placed
only for a connection the firm actually owns. A tier-0 development profile
therefore cannot show any of it, which is a large part of why twelve districts
went to merge with no landmark and nobody noticed.

Everything except the wallet goes through the game's own functions --
``purchase_asset``, ``advance_firm``, ``secure_district`` -- so what this
produces is a state the game can actually reach, not a row set invented beside
it. Only cash and reputation are written directly, because earning them is
fourteen tiers of play and is not what the map is being tested for.

It signs in a *separate* profile by default. Advancing the shared development
firm to tier 14 would silently change what every other probe on this machine is
measuring: the career parcels' states, which regions unlock, and the office the
window view is built for.

    python tools/map-qa/late-firm.py [email]

Then point a probe at it with ``MAPS_EMAIL``.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(ROOT))

from app import create_app, db  # noqa: E402
from app.game import (  # noqa: E402
    DISTRICTS,
    FIRM_TIERS,
    ASSETS,
    advance_firm,
    create_profile,
    purchase_asset,
    secure_district,
)
from app.models import User  # noqa: E402

EMAIL = (sys.argv[1] if len(sys.argv) > 1 else "late-firm@localhost.test").strip().lower()
# Enough to buy the whole catalog several times over, and to keep buying after
# upkeep has settled against it. The column is a BigInteger.
WALLET = 10**14


def main() -> int:
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=EMAIL).first()
        if not user:
            user = User(email=EMAIL, display_name="Late Firm")
            db.session.add(user)
            db.session.commit()
        profile = user.game_profile
        if not profile:
            profile = create_profile(
                user,
                {
                    "character_gender": "female",
                    "lawyer_name": "Late Firm",
                    "firm_name": "Late, Firm & Co.",
                },
            )
        profile.cash = WALLET
        profile.reputation = 100.0
        db.session.commit()

        # Assets in tier order, sweeping until a sweep buys nothing. `requires`
        # can name an asset at the same tier, so one ordered pass is not enough
        # and hard-coding the dependency order would rot the first time the
        # catalog moves.
        owned: set[str] = {asset.asset_key for asset in profile.assets}
        for _ in range(len(ASSETS) + 1):
            bought = 0
            for item in sorted(ASSETS, key=lambda entry: (entry["tier"], entry["cost"])):
                if item["key"] in owned:
                    continue
                try:
                    purchase_asset(profile, item["key"])
                except ValueError:
                    continue
                owned.add(item["key"])
                bought += 1
            if not bought:
                break
        print(f"assets {len(owned)}/{len(ASSETS)}")

        # One tier at a time, which is the only way `advance_firm` will move.
        for tier in range(profile.office_tier + 1, len(FIRM_TIERS)):
            profile.cash = WALLET
            db.session.commit()
            try:
                advance_firm(profile, tier)
            except ValueError as exc:
                print(f"stopped at tier {profile.office_tier}: {exc}")
                break
        print(f"tier {profile.office_tier}")

        held = {row.district_key for row in profile.territories}
        for district in DISTRICTS:
            if district["key"] in held:
                continue
            profile.cash = WALLET
            db.session.commit()
            try:
                secure_district(profile, district["key"])
            except ValueError as exc:
                print(f"  {district['key']}: {exc}")
                continue
            held.add(district["key"])
        by_region: dict[str, int] = {}
        for key in held:
            region = next(item["region"] for item in DISTRICTS if item["key"] == key)
            by_region[region] = by_region.get(region, 0) + 1
        print(f"districts {len(held)}/{len(DISTRICTS)} {by_region}")
        print(f"\n{EMAIL} is at tier {profile.office_tier}. Probe it with:")
        print(f"  MAPS_EMAIL={EMAIL} node tools/map-qa/landmarks.mjs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
