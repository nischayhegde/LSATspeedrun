from __future__ import annotations

from .extensions import db
from .models import PlayerProfile, PlayerStoryState


STORY_CHAPTERS = [
    {
        "key": "one_light_on", "act": "PROLOGUE", "tier": 0, "scene": "rainy_shack",
        "title": "One Light On", "location": "Old Quarter · 11:47 PM", "speaker": "ADA MERCER · RETIRED PUBLIC DEFENDER",
        "dialogue": [
            "The roof leaks, the sign is crooked, and one client is waiting in the rain.",
            "Ada Mercer leaves a brass office key on your desk. She built her career taking cases the city preferred not to see.",
            "‘Decide what the name on that door means before the city decides for you.’",
        ],
        "choices": [
            {"key": "open_door", "label": "Keep a light on for anyone", "stakes": "+8 Ethics · +2 Influence", "result": "Ada pins the legal-aid overflow list beside your first docket.", "effects": {"ethics": 8, "influence": 2}},
            {"key": "build_fast", "label": "Promise to build something powerful", "stakes": "+$500 · +2 Intel · −4 Ethics", "result": "Ada nods without smiling. A sealed market report appears beneath the key.", "effects": {"cash": 500, "intel": 2, "ethics": -4}},
        ],
    },
    {
        "key": "the_harrow_file", "act": "ACT I", "tier": 2, "scene": "market_showdown",
        "title": "The Harrow File", "location": "Market Ward · Courthouse Steps", "speaker": "ELEANOR HARROW · RIVAL FOUNDING PARTNER",
        "dialogue": [
            "Eleanor Harrow wins the morning hearing, then hands you the exhibit that should have defeated her.",
            "The deed is forged. Both firms were hired to fight over it while a third buyer quietly assembled the block.",
            "The buyer's mark is a silver S: Sterling Global. Your first rival may be the first person telling you the truth.",
        ],
        "choices": [
            {"key": "share_file", "label": "Share evidence with Harrow", "stakes": "+5 Ethics · +3 Intel · +2 Reputation", "result": "A professional rivalry becomes a wary alliance, and the forged-deed investigation opens.", "effects": {"ethics": 5, "intel": 3, "reputation": 2}},
            {"key": "keep_leverage", "label": "Keep the best page as leverage", "stakes": "+4 Intel · −5 Ethics · +5 Heat", "result": "Harrow notices the missing page. She says nothing, which is worse.", "effects": {"ethics": -5, "intel": 4, "heat": 5}},
        ],
    },
    {
        "key": "city_hall_cipher", "act": "ACT II", "tier": 4, "scene": "city_hall_night",
        "title": "The City Hall Cipher", "location": "Financial District · Evidence Room", "speaker": "MOTH · ANONYMOUS SOURCE",
        "dialogue": [
            "A voice-modulated caller leads you to procurement files hidden inside ordinary zoning appeals.",
            "Sterling's rivals did not simply lose clients. They were pressured, embarrassed, and purchased after their valuations collapsed.",
            "Moth offers the cipher key—but asks whether you want justice, control, or merely a better price.",
        ],
        "choices": [
            {"key": "publish_cipher", "label": "Give the cipher to investigators", "stakes": "+7 Ethics · +4 Reputation · +3 Influence", "result": "The city opens an inquiry. Sterling's public smile finally slips.", "effects": {"ethics": 7, "reputation": 4, "influence": 3, "heat": -3}},
            {"key": "hold_cipher", "label": "Keep it in the firm's black vault", "stakes": "+6 Intel · $150K · −8 Ethics · +12 Heat", "result": "The evidence becomes leverage. So does your silence.", "effects": {"cash": 150_000, "ethics": -8, "intel": 6, "heat": 12}},
        ],
    },
    {
        "key": "sterling_invitation", "act": "ACT III", "tier": 6, "scene": "sterling_tower",
        "title": "The Sterling Invitation", "location": "Midtown Crown · 88th Floor", "speaker": "SEBASTIAN STERLING · GLOBAL CHAIR",
        "dialogue": [
            "Sebastian Sterling serves coffee in a room with no visible doors and your firm's entire history on one wall.",
            "He calls sabotage ‘market correction’ and offers you a national seat if you stop asking who corrected the market.",
            "‘Every empire has a private ledger,’ he says. ‘The honest ones simply lie about it.’",
        ],
        "choices": [
            {"key": "walk_out", "label": "Walk out and challenge him publicly", "stakes": "+6 Ethics · +5 Reputation · +3 Influence", "result": "By sunset, every national firm knows you refused Sterling's table.", "effects": {"ethics": 6, "reputation": 5, "influence": 3}},
            {"key": "take_seat", "label": "Take the seat—and copy the ledger", "stakes": "+8 Intel · $12M · −10 Ethics · +18 Heat", "result": "You leave richer, compromised, and carrying the first page of Sterling's black book.", "effects": {"cash": 12_000_000, "ethics": -10, "intel": 8, "heat": 18}},
        ],
    },
    {
        "key": "midnight_ledger", "act": "ACT IV", "tier": 8, "scene": "midnight_exchange",
        "title": "The Midnight Ledger", "location": "Harbor Exchange · Market Close", "speaker": "MOTH · IDENTITY UNKNOWN",
        "dialogue": [
            "Moth reveals that Sterling will announce a merger at dawn. The target's shares will triple.",
            "Reporting the tip could protect the market. Trading on it could fund the next headquarters overnight.",
            "Across the harbor, Sterling's tower lights spell a single word: CHOOSE.",
        ],
        "choices": [
            {"key": "report_tip", "label": "Report the tip and trace its source", "stakes": "+8 Ethics · +5 Reputation · +5 Intel", "result": "Regulators halt the merger. Moth sends a final coordinate: the Sovereign Enclave.", "effects": {"ethics": 8, "reputation": 5, "intel": 5, "heat": -8}},
            {"key": "trade_tip", "label": "Route the trade through a shell", "stakes": "+$300M · −8 Reputation · −14 Ethics · +30 Heat", "result": "The trade clears. The money is real; so is the inquiry now following it.", "effects": {"cash": 300_000_000, "reputation": -8, "ethics": -14, "heat": 30, "intel": 2}},
        ],
    },
    {
        "key": "charter_of_counsel", "act": "ACT V", "tier": 10, "scene": "continental_forum",
        "title": "The Charter of Counsel", "location": "Innovation Arc · Continental Forum", "speaker": "ADA MERCER · HOLOGRAPHIC RECORDING",
        "dialogue": [
            "Ada's old key opens a recording she made before your first client arrived.",
            "She knew Sterling's network would eventually reach public courts, automated cities, and the rules themselves.",
            "The campus can become a private machine for winning—or a chartered institution that outlives its founder.",
        ],
        "choices": [
            {"key": "public_charter", "label": "Adopt the public-interest charter", "stakes": "+10 Ethics · +7 Reputation · Pro-bono rewards strengthened", "result": "Every branch reserves a floor for matters no balance sheet would choose.", "effects": {"ethics": 10, "reputation": 7, "influence": 5}},
            {"key": "private_charter", "label": "Keep the campus privately governed", "stakes": "+$2B · +5 Intel · −10 Ethics", "result": "The campus answers to one name. Its efficiency is breathtaking and unsettling.", "effects": {"cash": 2_000_000_000, "ethics": -10, "intel": 5, "heat": 8}},
        ],
    },
    {
        "key": "zenith_hearing", "act": "ACT VI", "tier": 12, "scene": "orbital_hearing",
        "title": "The Zenith Hearing", "location": "Orbital Ring · Hearing Chamber One", "speaker": "YARA ZENITH · ORBITAL RIVAL",
        "dialogue": [
            "The first orbital hearing begins with your navigation systems locked and Sterling's final acquisition offer on every screen.",
            "Yara Zenith admits her firm caused the lockout. She also has proof Sterling ordered something far worse.",
            "You can expose both, or bury her part in exchange for the evidence that ends him.",
        ],
        "choices": [
            {"key": "full_record", "label": "Put the entire record before the tribunal", "stakes": "+10 Ethics · +8 Reputation · +6 Influence", "result": "Zenith accepts the consequences. The tribunal issues the first orbital ethics order.", "effects": {"ethics": 10, "reputation": 8, "influence": 6, "heat": -12}},
            {"key": "sealed_deal", "label": "Seal Zenith's sabotage for her testimony", "stakes": "+9 Intel · −7 Ethics · +12 Heat", "result": "The testimony can destroy Sterling. The sealed page can implicate you both.", "effects": {"ethics": -7, "intel": 9, "heat": 12}},
        ],
    },
    {
        "key": "name_in_the_sky", "act": "FINALE", "tier": 14, "scene": "planetary_nexus",
        "title": "A Name in the Sky", "location": "Celestial Crown · Planetary Assembly", "speaker": "ELEANOR HARROW · ASSEMBLY COUNSEL",
        "dialogue": [
            "Sterling's network is broken, acquired, or reformed. The assembly asks who should control the justice constellation.",
            "Your answer will become the last line beneath the firm's name—and the first line of whatever follows it.",
            "Harrow places Ada's brass key in your hand. It still opens the old shack.",
        ],
        "choices": [
            {"key": "give_constellation", "label": "Place the constellation in public trust", "stakes": "+12 Ethics · Legendary civic ending", "result": "The firm's name remains on the door, but the light belongs to everyone.", "effects": {"ethics": 12, "reputation": 6, "influence": 10, "heat": -30}},
            {"key": "rule_constellation", "label": "Keep the constellation under firm control", "stakes": "+$100B · Empire ending · −18 Ethics", "result": "Every court in the night sky carries your crest. No one can tell where counsel ends and rule begins.", "effects": {"cash": 100_000_000_000, "ethics": -18, "influence": 5, "heat": 20}},
        ],
    },
]


QUESTS = [
    {"key": "mercer_overflow", "tier": 0, "category": "pro_bono", "scene": "legal_aid", "title": "Mercer's Overflow Docket", "patron": "Ada Mercer", "description": "Take three validated matters the public defender cannot reach.", "objective": "Win 3 cases with Good or Excellent reasoning", "condition": "validated", "target": 3, "reward_label": "+4 Reputation · +6 Ethics · 1× client fee", "rewards": {"reputation": 4, "ethics": 6, "fee_mult": 1}},
    {"key": "harrow_missing_deed", "tier": 2, "category": "investigation", "scene": "forged_deed", "title": "The Missing Deed", "patron": "Eleanor Harrow", "description": "Validate the forged-property trail that first points toward Sterling.", "objective": "Validate 3 case theories", "condition": "validated", "target": 3, "reward_label": "+4 Intel · +2 Influence · +2 Reputation", "rewards": {"intel": 4, "influence": 2, "reputation": 2}},
    {"key": "innocence_archive", "tier": 2, "category": "pro_bono", "scene": "evidence_archive", "title": "The Innocence Archive", "patron": "Market Ward Clinic", "description": "Reconstruct an old conviction from damaged transcripts and a recanted identification.", "objective": "Win 4 cases", "condition": "correct", "target": 4, "reward_label": "+7 Reputation · +7 Ethics · 1× client fee", "rewards": {"reputation": 7, "ethics": 7, "fee_mult": 1}},
    {"key": "city_hall_trail", "tier": 4, "category": "investigation", "scene": "cipher_room", "title": "Procurement in Invisible Ink", "patron": "Moth", "description": "Follow the city contracts hidden inside routine zoning files.", "objective": "Validate 4 case theories", "condition": "validated", "target": 4, "reward_label": "+6 Intel · +3 Influence", "rewards": {"intel": 6, "influence": 3, "reputation": 2}},
    {"key": "market_whisper", "tier": 4, "category": "shadow", "scene": "market_terminal", "title": "The Market Whisper", "patron": "Unknown Broker", "description": "Act on a confidential acquisition schedule before the market learns it exists.", "objective": "Complete 2 cases without attracting attention", "condition": "completed", "target": 2, "hidden": True, "discover": {"ethics_max": 72, "intel_min": 2}, "start_label": "$100K advance · −3 Reputation · −6 Ethics · +10 Heat", "start": {"cash": 100_000, "reputation": -3, "ethics": -6, "heat": 10}, "reward_label": "4× client fee · +3 Intel · +10 Heat", "rewards": {"fee_mult": 4, "intel": 3, "heat": 10}},
    {"key": "clinic_coverup", "tier": 4, "category": "pro_bono", "scene": "hospital_night", "title": "The Closed Ward", "patron": "Night Nurses Coalition", "description": "Protect patients and nurses exposing a device failure the board buried.", "objective": "Validate 3 cases", "condition": "validated", "target": 3, "reward_label": "+8 Reputation · +8 Ethics", "rewards": {"reputation": 8, "ethics": 8, "influence": 2}},
    {"key": "sterling_black_book", "tier": 6, "category": "investigation", "scene": "black_book", "title": "Sterling's Black Book", "patron": "Moth", "description": "Decode the acquisition pressure campaign without alerting Sterling's national office.", "objective": "Validate 5 cases", "condition": "validated", "target": 5, "reward_label": "+8 Intel · +4 Influence · +3 Reputation", "rewards": {"intel": 8, "influence": 4, "reputation": 3}},
    {"key": "witness_corridor", "tier": 6, "category": "pro_bono", "scene": "safe_corridor", "title": "The Witness Corridor", "patron": "Protected Witness Unit", "description": "Keep a cooperating accountant's family safe while the evidence crosses jurisdictions.", "objective": "Win 4 cases", "condition": "correct", "target": 4, "reward_label": "+7 Reputation · −12 Heat · +5 Ethics", "rewards": {"reputation": 7, "ethics": 5, "heat": -12, "intel": 3}},
    {"key": "jury_room_leak", "tier": 6, "category": "shadow", "scene": "jury_shadow", "title": "The Empty Jury Room", "patron": "Sterling Fixer", "description": "A consultant offers sealed sentiment reports from a rival's mock jury.", "objective": "Complete 3 cases", "condition": "completed", "target": 3, "hidden": True, "discover": {"ethics_max": 60, "intel_min": 4}, "start_label": "−4 Reputation · −8 Ethics · +15 Heat", "start": {"reputation": -4, "ethics": -8, "heat": 15, "intel": -2}, "reward_label": "6× client fee · +2 Intel", "rewards": {"fee_mult": 6, "intel": 2, "heat": 8}},
    {"key": "refugee_circuit", "tier": 7, "category": "pro_bono", "scene": "embassy_queue", "title": "The Refugee Circuit", "patron": "Embassy Legal Collective", "description": "Coordinate urgent status appeals across a corridor of conflicting rules.", "objective": "Validate 5 cases", "condition": "validated", "target": 5, "reward_label": "+10 Reputation · +10 Ethics · +4 Influence", "rewards": {"reputation": 10, "ethics": 10, "influence": 4}},
    {"key": "midnight_merger", "tier": 8, "category": "shadow", "scene": "merger_table", "title": "The Midnight Merger", "patron": "Shell Director", "description": "Draft the hidden structure that moves a target before regulators wake.", "objective": "Complete 3 cases", "condition": "completed", "target": 3, "hidden": True, "discover": {"ethics_max": 55, "intel_min": 6}, "start_label": "$25M advance · −6 Reputation · −10 Ethics · +20 Heat", "start": {"cash": 25_000_000, "reputation": -6, "ethics": -10, "heat": 20, "intel": -3}, "reward_label": "8× client fee · +5 Intel", "rewards": {"fee_mult": 8, "intel": 5, "heat": 12}},
    {"key": "ghost_fleet_ledger", "tier": 9, "category": "investigation", "scene": "ghost_fleet", "title": "The Ghost Fleet Ledger", "patron": "Sanctions Task Force", "description": "Connect flags, shell insurers, and silent ports to the owner behind the fleet.", "objective": "Validate 5 cases", "condition": "validated", "target": 5, "reward_label": "+10 Intel · +5 Influence · −10 Heat", "rewards": {"intel": 10, "influence": 5, "heat": -10, "reputation": 4}},
    {"key": "island_compact", "tier": 9, "category": "pro_bono", "scene": "island_forum", "title": "The Vanishing Islands Compact", "patron": "Coastal Youth Assembly", "description": "Turn displacement promises into enforceable rights before the next storm season.", "objective": "Win 5 cases", "condition": "correct", "target": 5, "reward_label": "+12 Reputation · +12 Ethics · +5 Influence", "rewards": {"reputation": 12, "ethics": 12, "influence": 5}},
    {"key": "algorithm_appeal", "tier": 10, "category": "pro_bono", "scene": "algorithm_city", "title": "The Algorithm Appeal", "patron": "Neighborhood Data Union", "description": "Prove that an invisible city model denied opportunity by address.", "objective": "Validate 6 cases", "condition": "validated", "target": 6, "reward_label": "+14 Reputation · +10 Ethics · +6 Influence", "rewards": {"reputation": 14, "ethics": 10, "influence": 6}},
    {"key": "ocean_rescue", "tier": 11, "category": "investigation", "scene": "storm_platform", "title": "The Silent Platform", "patron": "Oceanic Rescue Board", "description": "Discover why an automated platform ignored a distress call during the storm.", "objective": "Validate 5 cases", "condition": "validated", "target": 5, "reward_label": "+10 Intel · +6 Reputation · +4 Influence", "rewards": {"intel": 10, "reputation": 6, "influence": 4, "ethics": 4}},
    {"key": "orbital_signal", "tier": 12, "category": "investigation", "scene": "orbital_signal", "title": "Signal From Hearing One", "patron": "Yara Zenith", "description": "Trace the lockout command that nearly ended the first orbital hearing.", "objective": "Validate 6 cases", "condition": "validated", "target": 6, "reward_label": "+12 Intel · +7 Influence · −15 Heat", "rewards": {"intel": 12, "influence": 7, "heat": -15, "reputation": 5}},
    {"key": "lunar_claim_jump", "tier": 12, "category": "shadow", "scene": "lunar_claim", "title": "The Unregistered Crater", "patron": "Frontier Syndicate", "description": "File a mineral claim minutes before the survey becomes public.", "objective": "Complete 4 cases", "condition": "completed", "target": 4, "hidden": True, "discover": {"ethics_max": 50, "intel_min": 8}, "start_label": "$2B advance · −8 Reputation · −12 Ethics · +25 Heat", "start": {"cash": 2_000_000_000, "reputation": -8, "ethics": -12, "heat": 25, "intel": -4}, "reward_label": "10× client fee · +8 Intel", "rewards": {"fee_mult": 10, "intel": 8, "heat": 15}},
    {"key": "lunar_workers_appeal", "tier": 13, "category": "pro_bono", "scene": "lunar_workers", "title": "The Far-Side Workers' Appeal", "patron": "Lunar Mine Collective", "description": "Establish which safety promise follows a worker beyond Earth.", "objective": "Validate 6 cases", "condition": "validated", "target": 6, "reward_label": "+16 Reputation · +14 Ethics · +8 Influence", "rewards": {"reputation": 16, "ethics": 14, "influence": 8}},
    {"key": "constellation_charter", "tier": 14, "category": "legacy", "scene": "constellation", "title": "The Constellation Charter", "patron": "Planetary Assembly", "description": "Write the safeguards that decide whether the final network serves a firm or a civilization.", "objective": "Validate 8 final cases", "condition": "validated", "target": 8, "reward_label": "+20 Reputation · +15 Ethics · +10 Influence · 5× client fee", "rewards": {"reputation": 20, "ethics": 15, "influence": 10, "fee_mult": 5, "heat": -25}},
]


RIVAL_OPERATIONS = [
    {"key": "public_case_challenge", "name": "Public case challenge", "category": "clean", "description": "Beat the rival's signature theory in public and weaken its acquisition premium.", "discount_bps": 500, "cost_rate": .02, "influence": 1, "effects": {"ethics": 1, "reputation": 1}},
    {"key": "forensic_complaint", "name": "Forensic regulatory complaint", "category": "clean", "description": "Spend verified intelligence on a documented complaint against the rival's billing structure.", "discount_bps": 1000, "cost_rate": .03, "intel": 2, "effects": {"ethics": 2, "heat": -2}},
    {"key": "talent_raid", "name": "Aggressive talent raid", "category": "gray", "description": "Buy out the rival's rainmakers days before negotiation and exploit the sudden revenue gap.", "discount_bps": 1500, "cost_rate": .04, "influence": 2, "effects": {"ethics": -3, "reputation": -1.5, "heat": 5}},
    {"key": "press_whisper", "name": "Anonymous press whisper", "category": "sabotage", "description": "Seed a damaging but unverified story so nervous partners accept a lower valuation.", "discount_bps": 2000, "cost_rate": .05, "intel": 2, "effects": {"ethics": -7, "reputation": -3, "heat": 12}},
    {"key": "docket_sabotage", "name": "Docket-room sabotage", "category": "sabotage", "description": "Disrupt the rival's filing operation during its largest week. Expensive, effective, and indefensible.", "discount_bps": 2500, "cost_rate": .07, "intel": 4, "ethics_max": 65, "effects": {"ethics": -12, "reputation": -6, "heat": 25}},
]


CHAPTER_BY_KEY = {chapter["key"]: chapter for chapter in STORY_CHAPTERS}
QUEST_BY_KEY = {quest["key"]: quest for quest in QUESTS}
OPERATION_BY_KEY = {operation["key"]: operation for operation in RIVAL_OPERATIONS}


def ensure_story_state(profile: PlayerProfile) -> PlayerStoryState:
    if profile.story_state:
        return profile.story_state
    state = PlayerStoryState(
        profile_id=profile.id,
        ethics=70,
        heat=0,
        influence=0,
        intel=0,
        seen_chapters_json=[],
        choices_json={},
        quest_history_json=[],
        rival_discounts_json={},
        operations_json=[],
    )
    profile.story_state = state
    db.session.add(state)
    return state


def _read_story_state(profile: PlayerProfile) -> PlayerStoryState:
    return profile.story_state or PlayerStoryState(
        profile_id=profile.id,
        ethics=70,
        heat=0,
        influence=0,
        intel=0,
        seen_chapters_json=[],
        choices_json={},
        quest_history_json=[],
        rival_discounts_json={},
        operations_json=[],
    )


def _clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def _apply_effects(profile: PlayerProfile, state: PlayerStoryState, effects: dict, *, base_fee: int = 0) -> int:
    cash = int(effects.get("cash", 0)) + round(base_fee * float(effects.get("fee_mult", 0)))
    if cash:
        profile.cash += cash
        profile.lifetime_earnings += max(0, cash)
    profile.reputation = round(_clamp(profile.reputation + float(effects.get("reputation", 0))), 1)
    state.ethics = round(_clamp(state.ethics + float(effects.get("ethics", 0))), 1)
    state.heat = round(_clamp(state.heat + float(effects.get("heat", 0))), 1)
    state.influence = max(0, state.influence + int(effects.get("influence", 0)))
    state.intel = max(0, state.intel + int(effects.get("intel", 0)))
    return cash


def pending_chapter(profile: PlayerProfile, state: PlayerStoryState | None = None) -> dict | None:
    state = state or _read_story_state(profile)
    seen = set(state.seen_chapters_json or [])
    return next((chapter for chapter in STORY_CHAPTERS if chapter["tier"] <= profile.office_tier and chapter["key"] not in seen), None)


def resolve_story_choice(profile: PlayerProfile, chapter_key: str, choice_key: str) -> dict:
    state = ensure_story_state(profile)
    chapter = pending_chapter(profile, state)
    if not chapter or chapter["key"] != chapter_key:
        raise ValueError("chapter_not_pending")
    choice = next((item for item in chapter["choices"] if item["key"] == choice_key), None)
    if not choice:
        raise ValueError("choice_not_found")
    _apply_effects(profile, state, choice.get("effects", {}))
    state.seen_chapters_json = [*(state.seen_chapters_json or []), chapter_key]
    state.choices_json = {**(state.choices_json or {}), chapter_key: choice_key}
    return {"chapter": chapter_key, "choice": choice_key, "result": choice["result"]}


def _quest_discovered(quest: dict, profile: PlayerProfile, state: PlayerStoryState) -> bool:
    if profile.office_tier < quest["tier"]:
        return False
    discovery = quest.get("discover", {})
    if state.ethics > discovery.get("ethics_max", 100):
        return False
    if state.ethics < discovery.get("ethics_min", 0):
        return False
    if state.intel < discovery.get("intel_min", 0):
        return False
    return True


def _quest_public(quest: dict, profile: PlayerProfile, state: PlayerStoryState) -> dict:
    history = set(state.quest_history_json or [])
    active = state.active_quest_key == quest["key"]
    return {
        key: value for key, value in quest.items() if key not in {"start", "rewards", "discover"}
    } | {
        "active": active,
        "completed": quest["key"] in history,
        "available": _quest_discovered(quest, profile, state) and not active and quest["key"] not in history and not state.active_quest_key,
        "progress": state.quest_progress if active else 0,
    }


def serialize_story(profile: PlayerProfile) -> dict:
    state = _read_story_state(profile)
    chapter = pending_chapter(profile, state)
    discovered_quests = [quest for quest in QUESTS if _quest_discovered(quest, profile, state)]
    active = QUEST_BY_KEY.get(state.active_quest_key or "")
    choices = state.choices_json or {}
    return {
        "ethics": round(state.ethics, 1),
        "heat": round(state.heat, 1),
        "influence": state.influence,
        "intel": state.intel,
        "alignment": "Principled" if state.ethics >= 75 else "Pragmatic" if state.ethics >= 45 else "Ruthless",
        "pending_chapter": chapter,
        "active_quest": _quest_public(active, profile, state) if active else None,
        "quests": [_quest_public(quest, profile, state) for quest in discovered_quests],
        "chapters": [
            {
                "key": item["key"], "act": item["act"], "tier": item["tier"], "title": item["title"],
                "scene": item["scene"], "seen": item["key"] in (state.seen_chapters_json or []),
                "choice": choices.get(item["key"]),
            }
            for item in STORY_CHAPTERS
        ],
        "completed_quests": list(state.quest_history_json or []),
        "rival_discounts": dict(state.rival_discounts_json or {}),
    }


def start_quest(profile: PlayerProfile, quest_key: str, *, base_fee: int) -> dict:
    state = ensure_story_state(profile)
    quest = QUEST_BY_KEY.get(quest_key)
    if not quest:
        raise ValueError("quest_not_found")
    if state.active_quest_key:
        raise ValueError("quest_already_active")
    if quest_key in (state.quest_history_json or []):
        raise ValueError("quest_already_completed")
    if not _quest_discovered(quest, profile, state):
        raise ValueError("quest_locked")
    start = quest.get("start", {})
    if state.intel + int(start.get("intel", 0)) < 0:
        raise ValueError("insufficient_intel")
    advance = _apply_effects(profile, state, start, base_fee=base_fee)
    state.active_quest_key = quest_key
    state.quest_progress = 0
    return {"quest": quest_key, "advance": advance}


def advance_quest(profile: PlayerProfile, *, validated: bool, correct: bool, band: str, base_fee: int) -> dict:
    state = ensure_story_state(profile)
    # Careful work slowly cools public scrutiny even outside a formal quest.
    if validated and state.heat > 0:
        state.heat = round(max(0, state.heat - .5), 1)
    quest = QUEST_BY_KEY.get(state.active_quest_key or "")
    if not quest:
        return {"quest_bonus": 0, "completed": None}
    qualifies = (
        quest["condition"] == "completed"
        or (quest["condition"] == "correct" and correct)
        or (quest["condition"] == "validated" and validated)
    )
    if not qualifies or band == "Invalid":
        return {"quest_bonus": 0, "completed": None}
    state.quest_progress += 1
    if state.quest_progress < quest["target"]:
        return {"quest_bonus": 0, "completed": None}
    bonus = _apply_effects(profile, state, quest.get("rewards", {}), base_fee=base_fee)
    state.quest_history_json = [*(state.quest_history_json or []), quest["key"]]
    state.active_quest_key = None
    state.quest_progress = 0
    return {"quest_bonus": max(0, bonus), "completed": quest["key"], "title": quest["title"]}


def rival_discount_bps(profile: PlayerProfile, rival_key: str) -> int:
    state = _read_story_state(profile)
    return min(4_500, int((state.rival_discounts_json or {}).get(rival_key, 0)))


def operation_catalog(profile: PlayerProfile, rival: dict) -> list[dict]:
    state = _read_story_state(profile)
    completed = set(state.operations_json or [])
    current_discount = rival_discount_bps(profile, rival["key"])
    values = []
    for operation in RIVAL_OPERATIONS:
        operation_id = f'{rival["key"]}:{operation["key"]}'
        heat_surcharge_bps = round(state.heat * 50) if operation["category"] in {"gray", "sabotage"} else 0
        cost = max(500, round(rival["cost"] * operation["cost_rate"] * (10_000 + heat_surcharge_bps) / 10_000))
        missing = []
        if profile.office_tier < max(1, rival["tier"] - 1):
            missing.append(f'Firm tier {max(1, rival["tier"] - 1)}')
        if state.intel < operation.get("intel", 0):
            missing.append(f'{operation["intel"]} Intel')
        if state.influence < operation.get("influence", 0):
            missing.append(f'{operation["influence"]} Influence')
        if state.ethics > operation.get("ethics_max", 100):
            missing.append(f'Ethics {operation["ethics_max"]} or lower')
        if profile.cash < cost:
            missing.append("More cash")
        public = {key: value for key, value in operation.items() if key not in {"effects", "cost_rate"}}
        public.update({
            "cost": cost,
            "heat_surcharge_bps": heat_surcharge_bps,
            "completed": operation_id in completed,
            "available": not missing and operation_id not in completed and current_discount < 4_500,
            "missing": missing,
        })
        values.append(public)
    return values


def execute_rival_operation(profile: PlayerProfile, rival: dict, operation_key: str) -> dict:
    state = ensure_story_state(profile)
    operation = OPERATION_BY_KEY.get(operation_key)
    if not operation:
        raise ValueError("operation_not_found")
    public = next(item for item in operation_catalog(profile, rival) if item["key"] == operation_key)
    operation_id = f'{rival["key"]}:{operation_key}'
    if operation_id in (state.operations_json or []):
        raise ValueError("operation_already_completed")
    if not public["available"]:
        raise ValueError("operation_requirements_not_met")
    profile.cash -= public["cost"]
    profile.lifetime_spending += public["cost"]
    state.intel -= int(operation.get("intel", 0))
    state.influence -= int(operation.get("influence", 0))
    _apply_effects(profile, state, operation.get("effects", {}))
    discounts = dict(state.rival_discounts_json or {})
    discounts[rival["key"]] = min(4_500, int(discounts.get(rival["key"], 0)) + operation["discount_bps"])
    state.rival_discounts_json = discounts
    state.operations_json = [*(state.operations_json or []), operation_id]
    return {
        "rival_key": rival["key"], "operation_key": operation_key,
        "cost": public["cost"], "discount_bps": discounts[rival["key"]],
    }
