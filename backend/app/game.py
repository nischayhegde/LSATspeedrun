from __future__ import annotations

import math
import re
from datetime import timezone

from sqlalchemy import or_

from .extensions import db
from .models import (
    Attempt,
    AttemptSettlement,
    DailyProgress,
    LedgerEntry,
    PlayerAsset,
    PlayerClientContract,
    PlayerProfile,
    SessionItem,
    utcnow,
)


RULE_VERSION = "lawyer-tycoon-v1"
STARTING_CASH = 250
DAILY_REWARDS = {5: 500, 10: 1500, 20: 4000}

FIRM_TIERS = [
    {"tier": 0, "name": "Wooden Shack", "cost": 0, "reputation": 0, "short": "A one-desk practice with a lot to prove."},
    {"tier": 1, "name": "Shared Office", "cost": 3_000, "reputation": 40, "short": "A real address, a repaired roof, and room for help."},
    {"tier": 2, "name": "Neighborhood Firm", "cost": 20_000, "reputation": 55, "short": "A storefront practice trusted by local businesses."},
    {"tier": 3, "name": "Downtown Firm", "cost": 100_000, "reputation": 65, "short": "A polished suite overlooking the city docket."},
    {"tier": 4, "name": "City Power Firm", "cost": 500_000, "reputation": 75, "short": "A landmark office for high-stakes clients."},
    {"tier": 5, "name": "National Firm", "cost": 3_000_000, "reputation": 85, "short": "Regional branches and a national client book."},
    {"tier": 6, "name": "Global Legal Empire", "cost": 20_000_000, "reputation": 92, "short": "An international practice at the top of the profession."},
]

ASSETS = [
    {
        "key": "repaired_desk", "type": "upgrade", "name": "Repaired oak desk", "cost": 350,
        "reputation": 0, "tier": 0, "benefit": "+3% active case payout", "payout_mult": .03,
        "description": "A solid place to turn careful reasoning into a real practice.",
    },
    {
        "key": "proper_lighting", "type": "upgrade", "name": "Proper lighting", "cost": 850,
        "reputation": 0, "tier": 0, "requires": ["repaired_desk"], "benefit": "+3% active case payout", "payout_mult": .03,
        "description": "Warm lamps replace the flicker and make late briefs feel possible.",
    },
    {
        "key": "case_management", "type": "upgrade", "name": "Case-management system", "cost": 1_800,
        "reputation": 35, "tier": 0, "requires": ["proper_lighting"], "benefit": "+6% active case payout", "payout_mult": .06,
        "description": "Organized files, faster billing, and fewer papers underfoot.",
    },
    {
        "key": "legal_library", "type": "upgrade", "name": "Legal library", "cost": 5_500,
        "reputation": 45, "tier": 1, "benefit": "+8% active case payout", "payout_mult": .08,
        "description": "A wall of references that changes the room—and client confidence.",
    },
    {
        "key": "conference_room", "type": "upgrade", "name": "Conference room", "cost": 16_000,
        "reputation": 55, "tier": 2, "requires": ["legal_library"], "benefit": "+10% active case payout", "payout_mult": .10,
        "description": "Space for serious clients and serious preparation.",
    },
    {
        "key": "research_floor", "type": "upgrade", "name": "Research floor", "cost": 85_000,
        "reputation": 65, "tier": 3, "requires": ["conference_room"], "benefit": "+12% active case payout", "payout_mult": .12,
        "description": "A dedicated analytical team turns good work into a citywide reputation.",
    },
    {
        "key": "executive_suite", "type": "upgrade", "name": "Executive partner suite", "cost": 400_000,
        "reputation": 75, "tier": 4, "requires": ["research_floor"], "benefit": "+15% active case payout", "payout_mult": .15,
        "description": "An unmistakable headquarters for a firm with influence.",
    },
    {
        "key": "paralegal", "type": "staff", "name": "Maya · Paralegal", "cost": 2_500,
        "reputation": 40, "tier": 1, "benefit": "Up to +$20 per active case", "staff_flat": 20,
        "description": "Keeps the docket moving and every case file exactly where it belongs.",
    },
    {
        "key": "junior_associate", "type": "staff", "name": "Theo · Junior Associate", "cost": 8_000,
        "reputation": 55, "tier": 2, "benefit": "$30 passive income per hour", "passive_hourly": 30,
        "description": "Handles routine retainers while you focus on the decisive arguments.",
    },
    {
        "key": "office_manager", "type": "staff", "name": "Nina · Office Manager", "cost": 25_000,
        "reputation": 58, "tier": 2, "benefit": "+5% active case payout", "payout_mult": .05,
        "description": "Keeps filing, scheduling, and billing efficient on every active case.",
    },
    {
        "key": "senior_associate", "type": "staff", "name": "Avery · Senior Associate", "cost": 42_000,
        "reputation": 65, "tier": 3, "requires": ["junior_associate"], "benefit": "$130 passive income per hour", "passive_hourly": 130,
        "description": "Owns complex client work and makes the office feel formidable.",
    },
    {
        "key": "partner", "type": "staff", "name": "Jordan · Partner", "cost": 180_000,
        "reputation": 75, "tier": 4, "requires": ["senior_associate"], "benefit": "+8% active case payout", "payout_mult": .08,
        "description": "A proven partner who attracts the cases other firms want.",
    },
    {
        "key": "rainmaker", "type": "staff", "name": "Morgan · Rainmaker", "cost": 850_000,
        "reputation": 85, "tier": 5, "requires": ["partner"], "benefit": "+5% active case payout", "payout_mult": .05,
        "description": "Turns elite relationships into a national book of business.",
    },
    {
        "key": "local_bar", "type": "connection", "name": "Local bar association", "cost": 4_500,
        "reputation": 40, "tier": 1, "benefit": "Unlocks small-business clients",
        "description": "A trusted circle of local attorneys and referrals.",
    },
    {
        "key": "business_network", "type": "connection", "name": "Business-owner network", "cost": 18_000,
        "reputation": 55, "tier": 2, "requires": ["local_bar"], "benefit": "Unlocks wealthy clients",
        "description": "Founders and operators who remember excellent work.",
    },
    {
        "key": "board_network", "type": "connection", "name": "Corporate board network", "cost": 140_000,
        "reputation": 70, "tier": 3, "requires": ["business_network", "partner"], "benefit": "Unlocks corporate clients",
        "description": "Boardroom relationships built on results, not shortcuts.",
    },
    {
        "key": "international_network", "type": "connection", "name": "International legal network", "cost": 2_000_000,
        "reputation": 88, "tier": 5, "requires": ["board_network", "rainmaker"], "benefit": "Unlocks global clients",
        "description": "A cross-border referral network for the final climb.",
    },
    {
        "key": "neighborhood_practice", "type": "rival", "name": "Acquire Harrow & Finch", "cost": 75_000,
        "reputation": 60, "tier": 2, "requires": ["local_bar"], "benefit": "+5% payout · $250/hour", "payout_mult": .05, "passive_hourly": 250,
        "description": "Bring a respected neighborhood practice into your growing firm.",
    },
    {
        "key": "downtown_boutique", "type": "rival", "name": "Acquire Vale Legal", "cost": 750_000,
        "reputation": 75, "tier": 4, "requires": ["neighborhood_practice", "board_network"], "benefit": "+8% payout · $1,200/hour", "payout_mult": .08, "passive_hourly": 1_200,
        "description": "Absorb a polished boutique and its premium client book.",
    },
    {
        "key": "regional_firm", "type": "rival", "name": "Acquire Northstar Law", "cost": 5_000_000,
        "reputation": 85, "tier": 5, "requires": ["downtown_boutique"], "benefit": "+10% payout · $6,000/hour", "payout_mult": .10, "passive_hourly": 6_000,
        "description": "Your first multi-region acquisition changes the skyline for good.",
    },
    {
        "key": "national_competitor", "type": "rival", "name": "Acquire Sterling Global", "cost": 30_000_000,
        "reputation": 92, "tier": 6, "requires": ["regional_firm", "international_network"], "benefit": "+15% payout · $25,000/hour", "payout_mult": .15, "passive_hourly": 25_000,
        "description": "The defining acquisition of a global legal empire.",
    },
]

CLIENTS = [
    {"key": "walk_in", "name": "Walk-in client", "base_fee": 100, "reputation": 0, "tier": 0, "length": 10, "icon": "briefcase", "description": "Everyday people who need a sharp advocate."},
    {"key": "local_individual", "name": "Local client", "base_fee": 175, "reputation": 40, "tier": 0, "length": 10, "icon": "home", "description": "A referral from around the neighborhood."},
    {"key": "small_business", "name": "Small business", "base_fee": 300, "reputation": 50, "tier": 1, "requires": ["local_bar"], "length": 12, "icon": "store", "description": "A growing company with a full docket."},
    {"key": "wealthy_client", "name": "Private client", "base_fee": 650, "reputation": 60, "tier": 2, "requires": ["business_network"], "length": 12, "icon": "gem", "description": "High expectations, discreet matters, better fees."},
    {"key": "regional_corporation", "name": "Regional corporation", "base_fee": 1_500, "reputation": 70, "tier": 3, "requires": ["partner", "board_network"], "length": 15, "icon": "building", "description": "A serious company looking for outside counsel."},
    {"key": "national_corporation", "name": "National corporation", "base_fee": 5_000, "reputation": 82, "tier": 5, "requires": ["rainmaker"], "length": 18, "icon": "landmark", "description": "A national account that can transform the firm."},
    {"key": "global_conglomerate", "name": "Global conglomerate", "base_fee": 15_000, "reputation": 92, "tier": 6, "requires": ["international_network"], "length": 20, "icon": "globe", "description": "The most valuable client relationship in the game."},
]

ASSET_BY_KEY = {item["key"]: item for item in ASSETS}
CLIENT_BY_KEY = {item["key"]: item for item in CLIENTS}


def _iso_utc(value) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _owned_keys(profile: PlayerProfile) -> set[str]:
    return {
        asset_key
        for (asset_key,) in PlayerAsset.query.with_entities(PlayerAsset.asset_key)
        .filter_by(profile_id=profile.id)
        .all()
    }


def _lock_profile(profile: PlayerProfile) -> PlayerProfile:
    """Lock and refresh account state even when it is already in the identity map."""
    return (
        PlayerProfile.query.populate_existing()
        .filter_by(id=profile.id)
        .with_for_update()
        .one()
    )


def lock_user_profile(user_id: str) -> PlayerProfile | None:
    """Serialize account-wide gameplay operations for one authenticated user."""
    return (
        PlayerProfile.query.populate_existing()
        .filter_by(user_id=user_id)
        .with_for_update()
        .one_or_none()
    )


def _requirements_met(definition: dict, profile: PlayerProfile, owned: set[str]) -> bool:
    return (
        profile.reputation >= definition.get("reputation", 0)
        and profile.office_tier >= definition.get("tier", 0)
        and all(key in owned for key in definition.get("requires", []))
    )


def _requirement_copy(definition: dict) -> dict:
    return {
        "reputation": definition.get("reputation", 0),
        "tier": definition.get("tier", 0),
        "assets": definition.get("requires", []),
    }


def _daily(profile: PlayerProfile, persist: bool = True) -> DailyProgress:
    today = utcnow().date()
    progress = (
        DailyProgress.query.populate_existing()
        .filter_by(profile_id=profile.id, activity_date=today)
        .first()
    )
    if not progress:
        progress = DailyProgress(profile_id=profile.id, activity_date=today, cases_completed=0, claimed_json=[])
        if persist:
            db.session.add(progress)
            db.session.flush()
    return progress


def _passive_state(profile: PlayerProfile, owned: set[str] | None = None) -> dict:
    owned = owned if owned is not None else _owned_keys(profile)
    hourly = sum(int(ASSET_BY_KEY[key].get("passive_hourly", 0)) for key in owned if key in ASSET_BY_KEY)
    cap_hours = 8
    last = profile.last_passive_collected_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    elapsed_hours = max(0.0, (utcnow() - last).total_seconds() / 3600)
    stored_hours = min(elapsed_hours, cap_hours)
    return {
        "hourly_rate": hourly,
        "stored_hours": round(stored_hours, 2),
        "cap_hours": cap_hours,
        "available": math.floor(hourly * stored_hours),
        "last_collected_at": _iso_utc(profile.last_passive_collected_at),
    }


def _reputation_band(value: float) -> dict:
    if value >= 90:
        return {"name": "Elite", "minimum": 90, "next": None}
    if value >= 75:
        return {"name": "Prestigious", "minimum": 75, "next": 90}
    if value >= 60:
        return {"name": "Established", "minimum": 60, "next": 75}
    if value >= 40:
        return {"name": "Local", "minimum": 40, "next": 60}
    return {"name": "Unreliable", "minimum": 0, "next": 40}


def _valuation(profile: PlayerProfile) -> int:
    tier_investment = sum(tier["cost"] for tier in FIRM_TIERS[1 : profile.office_tier + 1])
    asset_investment = sum(asset.purchase_price for asset in profile.assets)
    return int(profile.cash + tier_investment + asset_investment)


def _achievement_state(profile: PlayerProfile, owned: set[str]) -> list[dict]:
    values = [
        ("first_verdict", "First verdict", "Complete your first case.", profile.total_cases >= 1),
        ("ten_cases", "Docket regular", "Complete 10 cases.", profile.total_cases >= 10),
        ("streak_five", "On a roll", "Reach a validated 5-case streak.", profile.best_streak >= 5),
        ("established", "Established counsel", "Reach 60 Reputation.", profile.reputation >= 60),
        ("first_hire", "A growing team", "Hire your first staff member.", any(ASSET_BY_KEY[key]["type"] == "staff" for key in owned if key in ASSET_BY_KEY)),
        ("first_acquisition", "Name on the door", "Acquire a rival firm.", any(ASSET_BY_KEY[key]["type"] == "rival" for key in owned if key in ASSET_BY_KEY)),
        ("million_value", "Seven-figure firm", "Reach a $1,000,000 valuation.", _valuation(profile) >= 1_000_000),
    ]
    return [{"key": key, "name": name, "description": description, "unlocked": unlocked} for key, name, description, unlocked in values]


def _public_asset(item: dict, profile: PlayerProfile, owned: set[str]) -> dict:
    public = {key: value for key, value in item.items() if key not in {"payout_mult", "staff_flat", "passive_hourly", "storage_hours"}}
    public["owned"] = item["key"] in owned
    public["available"] = not public["owned"] and _requirements_met(item, profile, owned)
    public["requirements"] = _requirement_copy(item)
    return public


def _public_client(client: dict, profile: PlayerProfile, owned: set[str]) -> dict:
    public = dict(client)
    public["requirements"] = _requirement_copy(client)
    public["unlocked"] = _requirements_met(client, profile, owned)
    public["selected"] = profile.active_client_key == client["key"]
    public["on_hold"] = public["selected"] and not public["unlocked"]
    contract = next((value for value in profile.client_contracts if value.client_key == client["key"]), None)
    public["contract"] = (
        {
            "cases_remaining": contract.cases_remaining,
            "completed_contracts": contract.completed_contracts,
            "loyalty": contract.loyalty,
        }
        if contract
        else None
    )
    return public


def _next_milestone(profile: PlayerProfile, owned: set[str]) -> dict | None:
    eligible_assets = sorted(
        (
            item
            for item in ASSETS
            if item["key"] not in owned and _requirements_met(item, profile, owned)
        ),
        key=lambda item: item["cost"],
    )
    if profile.office_tier >= len(FIRM_TIERS) - 1:
        if not eligible_assets:
            return None
        item = eligible_assets[0]
        return {"kind": "asset", "name": item["name"], "cost": item["cost"], "reputation": item.get("reputation", 0)}
    tier = FIRM_TIERS[profile.office_tier + 1]
    if eligible_assets and eligible_assets[0]["cost"] <= tier["cost"] * .75:
        item = eligible_assets[0]
        return {"kind": "asset", "name": item["name"], "cost": item["cost"], "reputation": item.get("reputation", 0)}
    return {"kind": "tier", "name": tier["name"], "cost": tier["cost"], "reputation": tier["reputation"]}


def serialize_game(profile: PlayerProfile, include_catalog: bool = True) -> dict:
    owned = _owned_keys(profile)
    daily = _daily(profile, persist=False)
    active_client = CLIENT_BY_KEY.get(profile.active_client_key, CLIENT_BY_KEY["walk_in"])
    active_client_public = _public_client(active_client, profile, owned)
    active_contract = next(
        (value for value in profile.client_contracts if value.client_key == active_client["key"]),
        None,
    )
    payload = {
        "id": profile.id,
        "lawyer_name": profile.lawyer_name,
        "firm_name": profile.firm_name,
        "character_gender": profile.character_gender,
        "cash": profile.cash,
        "reputation": round(profile.reputation, 1),
        "reputation_band": _reputation_band(profile.reputation),
        "office_tier": profile.office_tier,
        "office": FIRM_TIERS[profile.office_tier],
        "current_streak": profile.current_streak,
        "best_streak": profile.best_streak,
        "total_cases": profile.total_cases,
        "total_correct": profile.total_correct,
        "total_validated_correct": profile.total_validated_correct,
        "lifetime_earnings": profile.lifetime_earnings,
        "firm_valuation": _valuation(profile),
        "owned_assets": sorted(owned),
        "active_client": {
            **active_client_public,
            "cases_remaining": active_contract.cases_remaining if active_contract else profile.client_cases_remaining,
            "effective_key": active_client["key"] if active_client_public["unlocked"] else "walk_in",
        },
        "passive_income": _passive_state(profile, owned),
        "daily": {
            "date": daily.activity_date.isoformat(),
            "cases_completed": daily.cases_completed,
            "claimed": daily.claimed_json or [],
            "goals": [
                {
                    "cases": cases,
                    "reward": reward,
                    "complete": daily.cases_completed >= cases,
                    "claimed": cases in (daily.claimed_json or []),
                }
                for cases, reward in DAILY_REWARDS.items()
            ],
        },
        "achievements": _achievement_state(profile, owned),
        "next_milestone": _next_milestone(profile, owned),
    }
    if include_catalog:
        payload["catalog"] = {
            "assets": [_public_asset(item, profile, owned) for item in ASSETS],
            "clients": [_public_client(client, profile, owned) for client in CLIENTS],
            "tiers": [
                {
                    **tier,
                    "owned": tier["tier"] <= profile.office_tier,
                    "next": tier["tier"] == profile.office_tier + 1,
                    "available": tier["tier"] == profile.office_tier + 1 and profile.reputation >= tier["reputation"],
                }
                for tier in FIRM_TIERS
            ],
        }
    return payload


def _clean_name(value: object, maximum: int) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(cleaned) < 2 or len(cleaned) > maximum or any(ord(char) < 32 for char in cleaned):
        raise ValueError("invalid_name")
    return cleaned


def create_profile(user, payload: dict) -> PlayerProfile:
    if user.game_profile:
        raise ValueError("profile_exists")
    gender = str(payload.get("character_gender") or "").lower()
    if gender not in {"male", "female"}:
        raise ValueError("invalid_character")
    profile = PlayerProfile(
        user_id=user.id,
        lawyer_name=_clean_name(payload.get("lawyer_name") or user.display_name, 50),
        firm_name=_clean_name(payload.get("firm_name"), 80),
        character_gender=gender,
        cash=STARTING_CASH,
        lifetime_earnings=STARTING_CASH,
        last_passive_collected_at=utcnow(),
    )
    db.session.add(profile)
    db.session.flush()
    db.session.add(
        PlayerClientContract(
            profile_id=profile.id,
            client_key="walk_in",
            cases_remaining=CLIENT_BY_KEY["walk_in"]["length"],
        )
    )
    db.session.add(
        LedgerEntry(
            user_id=user.id,
            kind="opening_balance",
            source_id=profile.id,
            amount=STARTING_CASH,
            balance_after=STARTING_CASH,
            detail_json={"label": "First client retainer"},
        )
    )
    _daily(profile)
    db.session.commit()
    return profile


def update_profile(profile: PlayerProfile, payload: dict) -> PlayerProfile:
    if "lawyer_name" in payload:
        profile.lawyer_name = _clean_name(payload["lawyer_name"], 50)
    if "firm_name" in payload:
        profile.firm_name = _clean_name(payload["firm_name"], 80)
    if "character_gender" in payload:
        gender = str(payload["character_gender"]).lower()
        if gender not in {"male", "female"}:
            raise ValueError("invalid_character")
        profile.character_gender = gender
    db.session.commit()
    return profile


def _ledger(profile: PlayerProfile, kind: str, source_id: str, amount: int, detail: dict) -> None:
    db.session.add(
        LedgerEntry(
            user_id=profile.user_id,
            kind=kind,
            source_id=source_id,
            amount=amount,
            balance_after=profile.cash,
            detail_json=detail,
        )
    )


def purchase_asset(profile: PlayerProfile, asset_key: str) -> PlayerAsset:
    item = ASSET_BY_KEY.get(asset_key)
    if not item:
        raise ValueError("asset_not_found")
    profile = _lock_profile(profile)
    owned = _owned_keys(profile)
    if asset_key in owned:
        raise ValueError("already_owned")
    if not _requirements_met(item, profile, owned):
        raise ValueError("requirements_not_met")
    _collect_passive_locked(profile)
    if profile.cash < item["cost"]:
        raise ValueError("insufficient_cash")
    profile.cash -= item["cost"]
    profile.lifetime_spending += item["cost"]
    asset = PlayerAsset(
        profile_id=profile.id,
        asset_key=asset_key,
        asset_type=item["type"],
        purchase_price=item["cost"],
    )
    db.session.add(asset)
    _ledger(profile, "asset_purchase", asset_key, -item["cost"], {"name": item["name"], "type": item["type"]})
    db.session.commit()
    return asset


def advance_firm(profile: PlayerProfile, target_tier: int) -> None:
    profile = _lock_profile(profile)
    if profile.office_tier == target_tier:
        return
    next_tier_number = profile.office_tier + 1
    if target_tier != next_tier_number:
        raise ValueError("invalid_target_tier")
    if next_tier_number >= len(FIRM_TIERS):
        raise ValueError("maximum_tier")
    tier = FIRM_TIERS[next_tier_number]
    if profile.reputation < tier["reputation"]:
        raise ValueError("requirements_not_met")
    if profile.cash < tier["cost"]:
        raise ValueError("insufficient_cash")
    profile.cash -= tier["cost"]
    profile.lifetime_spending += tier["cost"]
    profile.office_tier = next_tier_number
    _ledger(profile, "firm_advancement", str(next_tier_number), -tier["cost"], {"name": tier["name"]})
    db.session.commit()


def select_client(profile: PlayerProfile, client_key: str) -> None:
    client = CLIENT_BY_KEY.get(client_key)
    if not client:
        raise ValueError("client_not_found")
    profile = _lock_profile(profile)
    if not _requirements_met(client, profile, _owned_keys(profile)):
        raise ValueError("requirements_not_met")
    contract = (
        PlayerClientContract.query.populate_existing()
        .filter_by(profile_id=profile.id, client_key=client_key)
        .with_for_update()
        .first()
    )
    if not contract:
        contract = PlayerClientContract(
            profile_id=profile.id,
            client_key=client_key,
            cases_remaining=client["length"],
        )
        db.session.add(contract)
    profile.active_client_key = client_key
    profile.client_cases_remaining = contract.cases_remaining
    db.session.commit()


def _collect_passive_locked(profile: PlayerProfile) -> int:
    state = _passive_state(profile)
    amount = state["available"]
    collected_at = utcnow()
    if amount <= 0:
        profile.last_passive_collected_at = collected_at
        return 0
    profile.cash += amount
    profile.lifetime_earnings += amount
    profile.last_passive_collected_at = collected_at
    _ledger(
        profile,
        "passive_collection",
        f"{profile.id}:{collected_at.isoformat()}",
        amount,
        {"stored_hours": state["stored_hours"], "hourly_rate": state["hourly_rate"]},
    )
    return amount


def collect_passive_income(profile: PlayerProfile) -> int:
    profile = _lock_profile(profile)
    amount = _collect_passive_locked(profile)
    db.session.commit()
    return amount


def claim_daily_reward(profile: PlayerProfile, milestone: int) -> int:
    if milestone not in DAILY_REWARDS:
        raise ValueError("invalid_milestone")
    profile = _lock_profile(profile)
    progress = _daily(profile)
    claimed = list(progress.claimed_json or [])
    if milestone in claimed:
        raise ValueError("already_claimed")
    if progress.cases_completed < milestone:
        raise ValueError("goal_incomplete")
    amount = DAILY_REWARDS[milestone]
    claimed.append(milestone)
    progress.claimed_json = sorted(claimed)
    profile.cash += amount
    profile.lifetime_earnings += amount
    _ledger(profile, "daily_reward", f"{progress.activity_date}:{milestone}", amount, {"cases": milestone})
    db.session.commit()
    return amount


def _normalize_reasoning(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def _is_reused_reasoning(attempt: Attempt) -> bool:
    normalized = _normalize_reasoning(attempt.reasoning_text)
    if len(normalized) < 12:
        return False
    recent = (
        Attempt.query.filter(
            Attempt.user_id == attempt.user_id,
            Attempt.id != attempt.id,
            Attempt.reasoning_text.isnot(None),
        )
        .order_by(Attempt.created_at.desc())
        .limit(50)
        .all()
    )
    return any(_normalize_reasoning(other.reasoning_text) == normalized for other in recent)


def explanation_band(score: int, has_reasoning: bool = True, reused: bool = False) -> str:
    if not has_reasoning or reused or score < 25:
        return "Invalid"
    if score < 50:
        return "Weak"
    if score < 80:
        return "Good"
    return "Excellent"


def _score_multiplier(score: int) -> float:
    if score <= 3:
        return .02
    if score <= 7:
        return .05
    if score <= 10:
        return .20
    if score <= 13:
        return .50
    if score <= 16:
        return .90
    if score <= 18:
        return 1.15
    if score == 19:
        return 1.30
    return 1.50


def _points(
    is_correct: bool,
    band: str,
    elapsed_seconds: int,
    target_seconds: int,
    time_eligible: bool = True,
) -> tuple[int, int, int, int]:
    answer_points = 4 if is_correct else 1
    if is_correct:
        explanation_points = {"Invalid": 0, "Weak": 4, "Good": 10, "Excellent": 12}[band]
    else:
        explanation_points = {"Invalid": 0, "Weak": 1, "Good": 2, "Excellent": 2}[band]
    time_points = 0
    if time_eligible and is_correct and band in {"Good", "Excellent"}:
        ratio = elapsed_seconds / max(1, target_seconds)
        if ratio < .25:
            time_points = 0
        elif ratio <= .70:
            time_points = 4
        elif ratio <= 1:
            time_points = 3
        elif ratio <= 1.25:
            time_points = 2
        elif ratio <= 1.5:
            time_points = 1
    total = answer_points + explanation_points + time_points
    if elapsed_seconds < target_seconds * .25:
        total = min(total, 8)
    return answer_points, explanation_points, time_points, min(20, total)


def _firm_bonuses(profile: PlayerProfile, owned: set[str], score_mult: float) -> tuple[float, int]:
    multiplier = 1 + profile.office_tier * .03
    staff_flat = 0
    for key in owned:
        item = ASSET_BY_KEY.get(key, {})
        multiplier += float(item.get("payout_mult", 0))
        staff_flat += int(item.get("staff_flat", 0))
    return round(multiplier, 3), round(staff_flat * score_mult)


def snapshot_case_context(profile: PlayerProfile) -> dict:
    """Freeze economy inputs when a question first becomes visible."""
    owned = _owned_keys(profile)
    selected = CLIENT_BY_KEY.get(profile.active_client_key, CLIENT_BY_KEY["walk_in"])
    client = selected if _requirements_met(selected, profile, owned) else CLIENT_BY_KEY["walk_in"]
    firm_multiplier, _ = _firm_bonuses(profile, owned, 1)
    staff_flat = sum(int(ASSET_BY_KEY[key].get("staff_flat", 0)) for key in owned if key in ASSET_BY_KEY)
    return {
        "rule_version": RULE_VERSION,
        "client_key": client["key"],
        "base_fee": client["base_fee"],
        "firm_multiplier_bps": round(firm_multiplier * 10_000),
        "staff_flat": staff_flat,
        "active_client_key": profile.active_client_key,
        "captured_at": _iso_utc(utcnow()),
    }


def _new_reputation(user_id: str, current_attempt_id: str, credit: float) -> float:
    prior = (
        AttemptSettlement.query.filter(
            AttemptSettlement.user_id == user_id,
            AttemptSettlement.attempt_id != current_attempt_id,
        )
        .order_by(AttemptSettlement.created_at.desc())
        .limit(29)
        .all()
    )
    credits = [entry.validated_credit for entry in reversed(prior)] + [credit]
    newest = credits[-10:]
    older = credits[:-10]
    weighted_points = sum(older) + 2 * sum(newest)
    weight = len(older) + 2 * len(newest)
    if len(credits) < 10:
        provisional = 10 - len(credits)
        weighted_points += provisional
        weight += provisional * 2
    return round(max(0, min(100, 100 * weighted_points / max(1, weight))), 1)


def serialize_settlement(settlement: AttemptSettlement | None) -> dict | None:
    if not settlement:
        return None
    return {
        "id": settlement.id,
        "rule_version": settlement.rule_version,
        "explanation_grade": settlement.explanation_grade,
        "explanation_score": settlement.explanation_score,
        "score": settlement.total_score,
        "breakdown": {
            "answer": settlement.answer_points,
            "explanation": settlement.explanation_points,
            "time": settlement.time_points,
        },
        "timing": {"elapsed_seconds": settlement.elapsed_seconds, "target_seconds": settlement.target_time_seconds},
        "client_key": settlement.client_key,
        "base_fee": settlement.base_fee,
        "score_multiplier": settlement.score_multiplier_bps / 10_000,
        "firm_multiplier": settlement.firm_multiplier_bps / 10_000,
        "streak_bonus": settlement.streak_bonus,
        "staff_bonus": settlement.staff_bonus,
        "contract_bonus": settlement.contract_bonus,
        "payout": settlement.payout,
        "reputation_before": round(settlement.reputation_before, 1),
        "reputation_after": round(settlement.reputation_after, 1),
        "reputation_change": round(settlement.reputation_change, 1),
        "created_at": _iso_utc(settlement.created_at),
    }


def settle_attempt(attempt: Attempt, coaching: dict) -> AttemptSettlement | None:
    """Apply the graded case once. Returns None when the player has not onboarded yet."""
    existing = AttemptSettlement.query.filter_by(attempt_id=attempt.id).first()
    if existing:
        return existing
    if attempt.session_item.game_context_json is None:
        # Attempts created before the tycoon rules were introduced are never paid retroactively.
        return None
    profile = lock_user_profile(attempt.user_id)
    if not profile:
        return None
    locked_attempt = (
        Attempt.query.populate_existing()
        .filter_by(id=attempt.id)
        .with_for_update()
        .one()
    )
    existing = AttemptSettlement.query.filter_by(attempt_id=locked_attempt.id).first()
    if existing:
        return existing

    raw_score = int(coaching.get("explanation_grade") or 0)
    reused = _is_reused_reasoning(locked_attempt)
    band = explanation_band(raw_score, bool(locked_attempt.reasoning_text), reused)
    if reused:
        raw_score = 0
        coaching["explanation_grade"] = 0
        coaching["reasoning_verdict"] = "unsupported"
        coaching["reasoning_summary"] = "This explanation repeats reasoning used on an earlier case, so it cannot validate this answer."

    elapsed_seconds = max(1, round(locked_attempt.server_elapsed_ms / 1000))
    target_seconds = locked_attempt.session_item.target_time_seconds or 150
    answer_points, explanation_points, time_points, total_score = _points(
        locked_attempt.is_correct,
        band,
        elapsed_seconds,
        target_seconds,
        time_eligible=not locked_attempt.session_item.timer_compromised,
    )
    score_mult = _score_multiplier(total_score)
    owned = _owned_keys(profile)
    context = locked_attempt.session_item.game_context_json
    if context is None:
        return None
    client = CLIENT_BY_KEY.get(context.get("client_key"), CLIENT_BY_KEY["walk_in"])
    base_fee = int(context.get("base_fee") or client["base_fee"])
    firm_mult = int(context.get("firm_multiplier_bps") or 10_000) / 10_000
    staff_bonus = round(int(context.get("staff_flat") or 0) * score_mult)

    validated = locked_attempt.is_correct and band in {"Good", "Excellent"}
    if not locked_attempt.is_correct:
        profile.current_streak = 0
    elif validated:
        profile.current_streak += 1
        profile.best_streak = max(profile.best_streak, profile.current_streak)
    core_payout = round(base_fee * score_mult * firm_mult)
    streak_bonus = round(core_payout * min(.20, profile.current_streak * .02)) if validated else 0
    contract_bonus = 0
    contract = (
        PlayerClientContract.query.populate_existing()
        .filter_by(profile_id=profile.id, client_key=client["key"])
        .with_for_update()
        .first()
    )
    if contract:
        contract.cases_remaining = max(0, contract.cases_remaining - 1)
        if locked_attempt.is_correct:
            contract.loyalty += 1
        if contract.cases_remaining == 0:
            contract_bonus = base_fee * 2
            contract.completed_contracts += 1
            contract.cases_remaining = client["length"]
        if profile.active_client_key == client["key"]:
            profile.client_cases_remaining = contract.cases_remaining
    payout = max(1, core_payout + streak_bonus + staff_bonus + contract_bonus)

    credit = 0.0
    if locked_attempt.is_correct:
        credit = 1.0 if band in {"Good", "Excellent"} else .5 if band == "Weak" else 0.0
    reputation_before = profile.reputation
    reputation_after = _new_reputation(profile.user_id, locked_attempt.id, credit)

    profile.cash += payout
    profile.lifetime_earnings += payout
    profile.reputation = reputation_after
    profile.total_cases += 1
    profile.total_correct += int(locked_attempt.is_correct)
    profile.total_validated_correct += int(validated)
    daily = _daily(profile)
    if band != "Invalid":
        daily.cases_completed += 1

    settlement = AttemptSettlement(
        attempt_id=locked_attempt.id,
        user_id=locked_attempt.user_id,
        rule_version=RULE_VERSION,
        explanation_grade=band,
        explanation_score=raw_score,
        answer_points=answer_points,
        explanation_points=explanation_points,
        time_points=time_points,
        total_score=total_score,
        target_time_seconds=target_seconds,
        elapsed_seconds=elapsed_seconds,
        client_key=client["key"],
        base_fee=base_fee,
        score_multiplier_bps=round(score_mult * 10_000),
        firm_multiplier_bps=round(firm_mult * 10_000),
        streak_bonus=streak_bonus,
        staff_bonus=staff_bonus,
        contract_bonus=contract_bonus,
        payout=payout,
        reputation_before=reputation_before,
        reputation_after=reputation_after,
        reputation_change=round(reputation_after - reputation_before, 1),
        validated_credit=credit,
    )
    db.session.add(settlement)
    db.session.flush()
    _ledger(
        profile,
        "case_payout",
        locked_attempt.id,
        payout,
        {"score": total_score, "grade": band, "client": client["key"], "rule_version": RULE_VERSION},
    )
    return settlement


def pending_review_attempts(user_id: str) -> list[str]:
    rows = (
        Attempt.query.join(SessionItem).outerjoin(AttemptSettlement)
        .filter(
            Attempt.user_id == user_id,
            SessionItem.game_context_json.isnot(None),
            AttemptSettlement.id.is_(None),
            or_(Attempt.coaching_status == "pending", Attempt.coaching_status == "failed"),
        )
        .order_by(Attempt.created_at.desc())
        .limit(10)
        .all()
    )
    return [attempt.id for attempt in rows]
