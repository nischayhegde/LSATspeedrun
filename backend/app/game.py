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
from .story import (
    advance_quest,
    ensure_story_state,
    execute_rival_operation,
    operation_catalog,
    resolve_story_choice,
    rival_discount_bps,
    serialize_story,
    start_quest,
)


RULE_VERSION = "lawyer-tycoon-v3"
STARTING_CASH = 250
DAILY_REWARD_MULTIPLIERS = {5: 1, 10: 3, 20: 8}
TARGET_CASES_PER_MILESTONE = 4
FIRM_TIER_COST_MULTIPLIER = 2

FIRM_TIERS = [
    {"tier": 0, "name": "Wooden Shack", "cost": 0, "reputation": 0, "region": "Old Quarter", "feature": "Street-level practice", "short": "A one-desk practice with a lot to prove."},
    {"tier": 1, "name": "Shared Office", "cost": 6_000, "reputation": 20, "region": "Old Quarter", "feature": "Client intake suite", "short": "A real address, a repaired roof, and room for help."},
    {"tier": 2, "name": "Neighborhood Firm", "cost": 36_000, "reputation": 32, "region": "Market Ward", "feature": "Community courtroom", "short": "A storefront practice trusted by local businesses."},
    {"tier": 3, "name": "Downtown Firm", "cost": 180_000, "reputation": 42, "region": "Civic Center", "feature": "Trial strategy floor", "short": "A polished suite overlooking the city docket."},
    {"tier": 4, "name": "City Power Firm", "cost": 800_000, "reputation": 50, "region": "Financial District", "feature": "Predictive jury theater", "short": "A landmark office for high-stakes clients."},
    {"tier": 5, "name": "Regional Headquarters", "cost": 3_600_000, "reputation": 56, "region": "Harbor Exchange", "feature": "Branch command center", "short": "A waterfront headquarters coordinating offices across the state."},
    {"tier": 6, "name": "National Firm", "cost": 16_000_000, "reputation": 62, "region": "Midtown Crown", "feature": "National litigation grid", "short": "Coast-to-coast branches and a national client book."},
    {"tier": 7, "name": "International Practice", "cost": 70_000_000, "reputation": 68, "region": "Embassy Row", "feature": "Live translation cloud", "short": "Diplomatic reach and cross-border teams working around the clock."},
    {"tier": 8, "name": "Global Legal Empire", "cost": 300_000_000, "reputation": 74, "region": "Skyline Heights", "feature": "Global crisis command", "short": "A worldwide practice whose crest changes skylines."},
    {"tier": 9, "name": "Sovereign Counsel Tower", "cost": 1_200_000_000, "reputation": 79, "region": "Sovereign Enclave", "feature": "Treaty negotiation chamber", "short": "Governments and institutions bring their defining disputes here."},
    {"tier": 10, "name": "Continental Justice Campus", "cost": 4_000_000_000, "reputation": 83, "region": "Innovation Arc", "feature": "Autonomous case campus", "short": "An entire district built around research, advocacy, and legal technology."},
    {"tier": 11, "name": "Oceanic Law Citadel", "cost": 12_000_000_000, "reputation": 86, "region": "Azure Coast", "feature": "Floating arbitration forum", "short": "A self-sustaining coastal citadel for planet-scale matters."},
    {"tier": 12, "name": "Orbital Arbitration Ring", "cost": 30_000_000_000, "reputation": 89, "region": "Aerospace Basin", "feature": "Zero-gravity hearing rooms", "short": "The first legal headquarters with a permanent orbital docket."},
    {"tier": 13, "name": "Lunar Embassy of Law", "cost": 70_000_000_000, "reputation": 92, "region": "Lunar Gate", "feature": "Interworld treaty vault", "short": "A moon-linked embassy settling disputes beyond national borders."},
    {"tier": 14, "name": "Planetary Justice Nexus", "cost": 160_000_000_000, "reputation": 94, "region": "Celestial Crown", "feature": "Justice constellation", "short": "A legendary network that coordinates law across an entire civilization."},
]

def _asset(key, asset_type, name, cost, reputation, tier, benefit, description, *, requires=(), region=None, art=None, **effects):
    return {
        "key": key, "type": asset_type, "name": name, "cost": cost,
        "reputation": reputation, "tier": tier, "benefit": benefit,
        "description": description, "requires": list(requires),
        "region": region or FIRM_TIERS[tier]["region"], "art": art,
        **effects,
    }


UPGRADES = [
    {
        "key": "repaired_desk", "type": "upgrade", "name": "Repaired oak desk", "cost": 350,
        "reputation": 0, "tier": 0, "benefit": "+3% active case payout", "payout_mult": .03, "region": "Old Quarter", "art": "workshop",
        "description": "A solid place to turn careful reasoning into a real practice.",
    },
    {
        "key": "proper_lighting", "type": "upgrade", "name": "Proper lighting", "cost": 850,
        "reputation": 0, "tier": 0, "requires": ["repaired_desk"], "benefit": "+3% active case payout", "payout_mult": .03, "region": "Old Quarter", "art": "workshop",
        "description": "Warm lamps replace the flicker and make late briefs feel possible.",
    },
    {
        "key": "case_management", "type": "upgrade", "name": "Case-management system", "cost": 1_800,
        "reputation": 20, "tier": 0, "requires": ["proper_lighting"], "benefit": "+6% active case payout", "payout_mult": .06, "region": "Old Quarter", "art": "tech",
        "description": "Organized files, faster billing, and fewer papers underfoot.",
    },
    {
        "key": "legal_library", "type": "upgrade", "name": "Legal library", "cost": 5_500,
        "reputation": 20, "tier": 1, "benefit": "+8% active case payout", "payout_mult": .08, "region": "Old Quarter", "art": "library",
        "description": "A wall of references that changes the room—and client confidence.",
    },
    _asset("secure_client_portal", "upgrade", "Secure client portal", 8_000, 24, 1, "+7% payout · +2h retainer storage", "Encrypted intake, instant signatures, and a client experience far beyond the old shack.", requires=("case_management",), art="tech", payout_mult=.07, storage_hours=2),
    _asset("deposition_studio", "upgrade", "Deposition studio", 11_000, 28, 1, "+9% active case payout", "Broadcast-grade recording catches the pause, contradiction, and detail that decide a matter.", requires=("legal_library",), art="courtroom", payout_mult=.09),
    {
        "key": "conference_room", "type": "upgrade", "name": "Conference room", "cost": 16_000,
        "reputation": 32, "tier": 2, "requires": ["legal_library"], "benefit": "+10% active case payout", "payout_mult": .10, "region": "Market Ward", "art": "courtroom",
        "description": "Space for serious clients and serious preparation.",
    },
    _asset("e_discovery_suite", "upgrade", "E-discovery suite", 28_000, 34, 2, "+12% active case payout", "A searchable evidence wall turns mountains of documents into a winning chronology.", requires=("secure_client_portal",), art="tech", payout_mult=.12),
    _asset("moot_court", "upgrade", "Moot courtroom", 45_000, 36, 2, "+12% payout · streak cap +5%", "Practice the decisive exchange before a judge ever hears it.", requires=("conference_room",), art="courtroom", payout_mult=.12, streak_bonus_cap=.05),
    {
        "key": "research_floor", "type": "upgrade", "name": "Research floor", "cost": 85_000,
        "reputation": 42, "tier": 3, "requires": ["conference_room"], "benefit": "+12% active case payout", "payout_mult": .12, "region": "Civic Center", "art": "library",
        "description": "A dedicated analytical team turns good work into a citywide reputation.",
    },
    _asset("trial_analytics_lab", "upgrade", "Trial analytics lab", 130_000, 44, 3, "+15% payout · streak cap +5%", "Replay arguments against thousands of courtroom patterns without losing their human edge.", requires=("e_discovery_suite",), art="analytics", payout_mult=.15, streak_bonus_cap=.05),
    _asset("media_response_room", "upgrade", "Media response room", 210_000, 46, 3, "+12% payout · reputation guard", "A rapid-response studio protects the client and the firm's name when every camera turns on.", requires=("research_floor",), art="media", payout_mult=.12, reputation_guard=1.0),
    {
        "key": "executive_suite", "type": "upgrade", "name": "Executive partner suite", "cost": 400_000,
        "reputation": 50, "tier": 4, "requires": ["research_floor"], "benefit": "+15% active case payout", "payout_mult": .15, "region": "Financial District", "art": "executive",
        "description": "An unmistakable headquarters for a firm with influence.",
    },
    _asset("litigation_war_room", "upgrade", "Litigation war room", 620_000, 52, 4, "+18% payout · +1× contract bonus", "A wall-sized living case map keeps every team on the same decisive theory.", requires=("trial_analytics_lab",), art="command", payout_mult=.18, contract_bonus_mult=1),
    _asset("jury_simulator", "upgrade", "Predictive jury theater", 950_000, 54, 4, "+20% payout · streak cap +10%", "An immersive jury simulator stress-tests narrative, sequence, and every vulnerable assumption.", requires=("litigation_war_room",), art="hologram", payout_mult=.20, streak_bonus_cap=.10),
    _asset("branch_command", "upgrade", "Branch command center", 1_600_000, 56, 5, "+20% payout · +4h retainer storage", "Coordinate the whole region from a luminous operations table.", requires=("executive_suite",), art="command", payout_mult=.20, storage_hours=4),
    _asset("legal_airship", "upgrade", "Counsel airship", 3_200_000, 58, 5, "+25% active case payout", "A mobile office crosses the region overnight with a courtroom-ready team aboard.", requires=("branch_command",), art="transit", payout_mult=.25),
    _asset("ai_brief_foundry", "upgrade", "AI brief foundry", 7_000_000, 62, 6, "+28% payout · +1× contract bonus", "A supervised research foundry assembles authorities at national scale while counsel makes every judgment.", requires=("trial_analytics_lab",), art="tech", payout_mult=.28, contract_bonus_mult=1),
    _asset("national_litigation_grid", "upgrade", "National litigation grid", 12_000_000, 64, 6, "+30% payout · +6h retainer storage", "Every branch shares live arguments, evidence, and expert capacity.", requires=("ai_brief_foundry",), art="network", payout_mult=.30, storage_hours=6),
    _asset("translation_cloud", "upgrade", "Live translation cloud", 28_000_000, 68, 7, "+32% active case payout", "Cross-border teams hear nuance, not delay, in every negotiation.", requires=("national_litigation_grid",), art="network", payout_mult=.32),
    _asset("satellite_docket", "upgrade", "Satellite docket array", 55_000_000, 70, 7, "+35% payout · streak cap +10%", "Secure satellite links put a command-quality hearing room anywhere on Earth.", requires=("translation_cloud",), art="space", payout_mult=.35, streak_bonus_cap=.10),
    _asset("global_crisis_center", "upgrade", "Global crisis command", 130_000_000, 74, 8, "+38% payout · reputation shield", "A twenty-four-hour command floor stabilizes matters that cross markets and borders in minutes.", requires=("satellite_docket",), art="command", payout_mult=.38, reputation_guard=1.5),
    _asset("vault_archive", "upgrade", "Subterranean precedent vault", 240_000_000, 76, 8, "+40% payout · +8h retainer storage", "A climate-sealed archive preserves the arguments that built the empire.", requires=("global_crisis_center",), art="library", payout_mult=.40, storage_hours=8),
    _asset("treaty_chamber", "upgrade", "Holographic treaty chamber", 520_000_000, 79, 9, "+45% payout · +1× contract bonus", "Delegations negotiate around a living model of every border, resource, and obligation.", requires=("vault_archive",), art="hologram", payout_mult=.45, contract_bonus_mult=1),
    _asset("prediction_engine", "upgrade", "Precedent prediction engine", 900_000_000, 81, 9, "+48% payout · streak cap +15%", "A transparent simulation reveals which theory survives every likely counterargument.", requires=("treaty_chamber",), art="analytics", payout_mult=.48, streak_bonus_cap=.15),
    _asset("autonomous_case_campus", "upgrade", "Autonomous case campus", 1_700_000_000, 83, 10, "+50% payout · $80M/hour", "Robotic archives, hearing halls, and research wings keep major matters moving continuously.", requires=("prediction_engine",), art="future", payout_mult=.50, passive_hourly=80_000_000),
    _asset("supersonic_courier", "upgrade", "Supersonic counsel shuttle", 3_200_000_000, 85, 10, "+55% active case payout", "Counsel and evidence cross a continent between filing and argument.", requires=("autonomous_case_campus",), art="transit", payout_mult=.55),
    _asset("oceanic_campus", "upgrade", "Floating arbitration forum", 5_000_000_000, 86, 11, "+60% payout · +12h retainer storage", "A neutral, self-sustaining forum hosts the world's largest commercial disputes offshore.", requires=("supersonic_courier",), art="ocean", payout_mult=.60, storage_hours=12),
    _asset("digital_twin_court", "upgrade", "Digital-twin courtroom", 8_500_000_000, 87, 11, "+65% payout · +2× contract bonus", "Reconstruct systems, cities, and events in a courtroom-scale interactive twin.", requires=("oceanic_campus",), art="hologram", payout_mult=.65, contract_bonus_mult=2),
    _asset("orbital_hearing_ring", "upgrade", "Zero-gravity hearing ring", 13_000_000_000, 89, 12, "+70% payout · streak cap +20%", "An orbital forum built for disputes no terrestrial venue can fairly contain.", requires=("digital_twin_court",), art="space", payout_mult=.70, streak_bonus_cap=.20),
    _asset("precedent_supercomputer", "upgrade", "Precedent supercomputer", 19_000_000_000, 90, 12, "+75% payout · $400M/hour", "A moon-cold legal computer models centuries of doctrine while preserving a human decision trail.", requires=("orbital_hearing_ring",), art="future", payout_mult=.75, passive_hourly=400_000_000),
    _asset("lunar_embassy", "upgrade", "Lunar treaty embassy", 30_000_000_000, 92, 13, "+80% payout · reputation shield", "A permanent embassy gives new settlements a trusted neutral table.", requires=("precedent_supercomputer",), art="space", payout_mult=.80, reputation_guard=2.0),
    _asset("chronicle_vault", "upgrade", "Civilization chronicle vault", 48_000_000_000, 93, 13, "+90% payout · +24h retainer storage", "The definitive record of laws, promises, and judgments is mirrored beyond Earth.", requires=("lunar_embassy",), art="library", payout_mult=.90, storage_hours=24),
    _asset("planetary_command", "upgrade", "Planetary justice command", 72_000_000_000, 94, 14, "+100% payout · +3× contract bonus", "A planet-wide legal operations center routes the right advocate to any crisis in moments.", requires=("chronicle_vault",), art="command", payout_mult=1.0, contract_bonus_mult=3),
    _asset("justice_constellation", "upgrade", "Justice constellation", 120_000_000_000, 96, 14, "+125% payout · unlimited-scale retainers", "A constellation of courts, archives, and advocates turns the firm's final crest into civic infrastructure.", requires=("planetary_command",), art="space", payout_mult=1.25, storage_hours=48, streak_bonus_cap=.25),
]

STAFF = [
    {
        "key": "paralegal", "type": "staff", "name": "Maya · Paralegal", "cost": 2_500,
        "reputation": 20, "tier": 1, "benefit": "Up to +$20 per active case", "staff_flat": 20, "region": "Old Quarter", "art": "files",
        "description": "Keeps the docket moving and every case file exactly where it belongs.",
    },
    {
        "key": "junior_associate", "type": "staff", "name": "Theo · Junior Associate", "cost": 8_000,
        "reputation": 30, "tier": 1, "benefit": "$30 passive income per hour", "passive_hourly": 30, "region": "Old Quarter", "art": "brief",
        "description": "Handles routine retainers while you focus on the decisive arguments.",
    },
    {
        "key": "office_manager", "type": "staff", "name": "Nina · Office Manager", "cost": 25_000,
        "reputation": 32, "tier": 2, "benefit": "+5% active case payout", "payout_mult": .05, "region": "Market Ward", "art": "clipboard",
        "description": "Keeps filing, scheduling, and billing efficient on every active case.",
    },
    {
        "key": "senior_associate", "type": "staff", "name": "Avery · Senior Associate", "cost": 42_000,
        "reputation": 42, "tier": 3, "requires": ["junior_associate"], "benefit": "$130 passive income per hour", "passive_hourly": 130, "region": "Civic Center", "art": "folio",
        "description": "Owns complex client work and makes the office feel formidable.",
    },
    {
        "key": "partner", "type": "staff", "name": "Jordan · Partner", "cost": 180_000,
        "reputation": 50, "tier": 4, "requires": ["senior_associate"], "benefit": "+8% active case payout", "payout_mult": .08, "region": "Financial District", "art": "coffee",
        "description": "A proven partner who attracts the cases other firms want.",
    },
    {
        "key": "rainmaker", "type": "staff", "name": "Morgan · Rainmaker", "cost": 850_000,
        "reputation": 56, "tier": 5, "requires": ["partner"], "benefit": "+5% active case payout", "payout_mult": .05, "region": "Harbor Exchange", "art": "phone",
        "description": "Turns elite relationships into a national book of business.",
    },
    _asset("intake_specialist", "staff", "Iris · Intake Specialist", 1_200, 10, 0, "+$75 per active case", "Makes every caller feel heard and spots the promising matter in a crowded inbox.", art="phone", staff_flat=75),
    _asset("private_investigator", "staff", "Darius · Investigator", 13_000, 32, 2, "+8% active case payout", "Finds the witness, missing timestamp, and inconvenient fact before opposing counsel does.", requires=("paralegal",), art="briefcase", payout_mult=.08),
    _asset("litigation_technologist", "staff", "Sora · Litigation Technologist", 32_000, 36, 2, "$4,000/hour · +4h storage", "Builds clean evidence pipelines and keeps the courtroom presentation flawless.", requires=("office_manager",), art="tablet", passive_hourly=4_000, storage_hours=4),
    _asset("legal_nurse", "staff", "Amara · Legal Nurse", 70_000, 42, 3, "+10% payout · reputation guard", "Translates dense medical records into a precise, humane case story.", art="clipboard", payout_mult=.10, reputation_guard=.5),
    _asset("trial_consultant", "staff", "Mateo · Trial Consultant", 145_000, 46, 3, "+12% payout · streak cap +5%", "Finds where a technically correct argument loses the room—and repairs it.", requires=("senior_associate",), art="folio", payout_mult=.12, streak_bonus_cap=.05),
    _asset("communications_director", "staff", "Zuri · Communications Director", 300_000, 50, 4, "+14% payout · reputation shield", "Keeps public facts straight when a major case becomes the city's story.", requires=("media_response_room",), art="phone", payout_mult=.14, reputation_guard=1),
    _asset("appellate_counsel", "staff", "Noah · Appellate Counsel", 650_000, 54, 4, "+18% active case payout", "Turns the record into a clean rule, a narrow issue, and an argument built to last.", requires=("partner",), art="brief", payout_mult=.18),
    _asset("chief_operating_officer", "staff", "Leila · Chief Operating Officer", 1_400_000, 56, 5, "$180,000/hour · +6h storage", "Runs a multi-office firm like one excellent team instead of ten busy islands.", requires=("office_manager",), art="tablet", passive_hourly=180_000, storage_hours=6),
    _asset("cybersecurity_counsel", "staff", "Kenji · Cybersecurity Counsel", 3_000_000, 60, 5, "+22% payout · reputation guard", "Handles breach response at technical speed without losing legal precision.", requires=("litigation_technologist",), art="tablet", payout_mult=.22, reputation_guard=1),
    _asset("branch_director", "staff", "Elena · National Branch Director", 6_500_000, 62, 6, "$800,000/hour", "Builds local excellence into a dependable national system.", requires=("chief_operating_officer",), art="clipboard", passive_hourly=800_000),
    _asset("economist", "staff", "Caleb · Chief Economist", 11_000_000, 65, 6, "+26% active case payout", "Makes the market consequence of an argument visible, testable, and hard to dismiss.", art="brief", payout_mult=.26),
    _asset("international_arbitrator", "staff", "Nadia · International Arbitrator", 26_000_000, 68, 7, "+30% payout · +1× contract bonus", "Moves between legal systems without flattening the difference that matters.", requires=("appellate_counsel",), art="folio", payout_mult=.30, contract_bonus_mult=1),
    _asset("diplomatic_liaison", "staff", "Tomas · Diplomatic Liaison", 52_000_000, 71, 7, "$6,000,000/hour · reputation shield", "Keeps high-stakes negotiations open when protocol and pressure collide.", art="phone", passive_hourly=6_000_000, reputation_guard=1.5),
    _asset("crisis_commander", "staff", "Rin · Global Crisis Commander", 115_000_000, 74, 8, "+35% payout · +8h storage", "Coordinates experts and advocates through the first chaotic hours of a global matter.", requires=("global_crisis_center",), art="tablet", payout_mult=.35, storage_hours=8),
    _asset("data_scientist", "staff", "Omar · Legal Data Scientist", 220_000_000, 77, 8, "$24,000,000/hour", "Audits the models, exposes weak correlations, and makes powerful evidence legible.", requires=("trial_analytics_lab",), art="tablet", passive_hourly=24_000_000),
    _asset("sovereign_envoy", "staff", "Anika · Sovereign Envoy", 480_000_000, 79, 9, "+42% payout · reputation shield", "Carries the firm's credibility into rooms where every word becomes policy.", requires=("international_arbitrator",), art="portfolio", payout_mult=.42, reputation_guard=2),
    _asset("treaty_architect", "staff", "Gabriel · Treaty Architect", 850_000_000, 81, 9, "+45% payout · +2× contract bonus", "Designs agreements that remain workable after the ceremony and headlines are gone.", requires=("sovereign_envoy",), art="folio", payout_mult=.45, contract_bonus_mult=2),
    _asset("automation_director", "staff", "Mei · Automation Director", 1_600_000_000, 83, 10, "$140,000,000/hour", "Automates repetition while keeping every strategic and ethical judgment with counsel.", requires=("data_scientist",), art="tablet", passive_hourly=140_000_000),
    _asset("quantum_analyst", "staff", "Idris · Quantum Evidence Analyst", 3_000_000_000, 85, 10, "+55% active case payout", "Tests impossible-scale evidence without turning uncertainty into false confidence.", requires=("automation_director",), art="brief", payout_mult=.55),
    _asset("oceanic_counsel", "staff", "Marisol · Oceanic Counsel", 5_000_000_000, 86, 11, "+60% payout · $300M/hour", "Navigates maritime, climate, and resource law from the floating forum.", requires=("international_arbitrator",), art="portfolio", payout_mult=.60, passive_hourly=300_000_000),
    _asset("systems_advocate", "staff", "Vik · Systems Advocate", 8_000_000_000, 88, 11, "+65% payout · reputation shield", "Explains planet-scale systems without losing the people affected by them.", requires=("oceanic_counsel",), art="folio", payout_mult=.65, reputation_guard=2),
    _asset("orbital_counsel", "staff", "Asha · Orbital Counsel", 12_000_000_000, 89, 12, "+72% payout · $700M/hour", "Writes the doctrine for commerce, safety, and responsibility beyond the atmosphere.", requires=("systems_advocate",), art="portfolio", payout_mult=.72, passive_hourly=700_000_000),
    _asset("lunar_envoy", "staff", "Sol · Lunar Envoy", 27_000_000_000, 92, 13, "+85% payout · +3× contract bonus", "Keeps Earth and lunar settlements at one table when distance magnifies every dispute.", requires=("orbital_counsel",), art="phone", payout_mult=.85, contract_bonus_mult=3),
    _asset("chief_justice_strategist", "staff", "Nova · Chief Justice Strategist", 65_000_000_000, 94, 14, "+100% payout · maximum reputation shield", "Leads the final network with judgment equal to its impossible reach.", requires=("lunar_envoy",), art="folio", payout_mult=1.0, reputation_guard=3),
]

CONNECTIONS = [
    {
        "key": "local_bar", "type": "connection", "name": "Local bar association", "cost": 4_500,
        "reputation": 20, "tier": 1, "benefit": "Unlocks small-business clients", "region": "Old Quarter", "art": "local",
        "description": "A trusted circle of local attorneys and referrals.",
    },
    {
        "key": "business_network", "type": "connection", "name": "Business-owner network", "cost": 18_000,
        "reputation": 32, "tier": 2, "requires": ["local_bar"], "benefit": "Unlocks private and property clients", "region": "Market Ward", "art": "business",
        "description": "Founders and operators who remember excellent work.",
    },
    {
        "key": "board_network", "type": "connection", "name": "Corporate board network", "cost": 140_000,
        "reputation": 42, "tier": 3, "requires": ["business_network", "senior_associate"], "benefit": "Unlocks corporate clients", "region": "Civic Center", "art": "board",
        "description": "Boardroom relationships built on results, not shortcuts.",
    },
    {
        "key": "international_network", "type": "connection", "name": "International legal network", "cost": 2_000_000,
        "reputation": 56, "tier": 5, "requires": ["board_network", "rainmaker"], "benefit": "Unlocks global clients", "region": "Harbor Exchange", "art": "global",
        "description": "A cross-border referral network for the final climb.",
    },
    _asset("civic_referral_council", "connection", "Civic referral council", 70_000, 40, 3, "Unlocks hospitals and public institutions", "Judges, nonprofits, and civic leaders who send difficult matters to steady hands.", requires=("business_network",), art="civic"),
    _asset("entertainment_circle", "connection", "Entertainment leadership circle", 330_000, 50, 4, "Unlocks media and sports clients", "Producers, athletes, and rights owners who need calm counsel under bright lights.", requires=("board_network",), art="media"),
    _asset("national_gc_council", "connection", "National GC council", 6_000_000, 62, 6, "Unlocks national enterprise clients", "General counsel who share trust only after the work proves it.", requires=("international_network",), art="national"),
    _asset("diplomatic_forum", "connection", "Diplomatic legal forum", 24_000_000, 68, 7, "Unlocks sovereign and treaty clients", "A neutral forum of embassies, arbitrators, and treaty experts.", requires=("international_network",), art="diplomatic"),
    _asset("global_exchange", "connection", "Global executive exchange", 105_000_000, 74, 8, "Unlocks megacap and biotech clients", "A worldwide table of builders whose risks no longer fit in one jurisdiction.", requires=("diplomatic_forum",), art="global"),
    _asset("sovereign_council", "connection", "Sovereign counsel council", 420_000_000, 79, 9, "Unlocks central banks and governments", "Trusted counsel for institutions that think in generations.", requires=("global_exchange",), art="sovereign"),
    _asset("innovation_compact", "connection", "Continental innovation compact", 1_500_000_000, 83, 10, "Unlocks quantum and infrastructure clients", "Research cities and frontier industries sharing one rules framework.", requires=("sovereign_council",), art="future"),
    _asset("oceanic_compact", "connection", "Oceanic governance compact", 4_500_000_000, 86, 11, "Unlocks oceanic consortiums", "Coastal states, climate institutions, and maritime operators at one neutral table.", requires=("innovation_compact",), art="ocean"),
    _asset("orbital_bar", "connection", "Orbital bar association", 11_000_000_000, 89, 12, "Unlocks orbital industry clients", "The first professional network licensed across Earth and orbital habitats.", requires=("oceanic_compact",), art="space"),
    _asset("interworld_assembly", "connection", "Interworld legal assembly", 26_000_000_000, 92, 13, "Unlocks lunar and interworld clients", "A new assembly writing trusted procedure across worlds.", requires=("orbital_bar",), art="space"),
]

RIVALS = [
    {
        "key": "neighborhood_practice", "type": "rival", "name": "Acquire Harrow & Finch", "cost": 75_000,
        "reputation": 34, "tier": 2, "requires": ["local_bar"], "benefit": "+5% payout · $250/hour", "payout_mult": .05, "passive_hourly": 250, "region": "Market Ward", "art": "brick-house",
        "description": "Bring a respected neighborhood practice into your growing firm.",
    },
    {
        "key": "downtown_boutique", "type": "rival", "name": "Acquire Vale Legal", "cost": 750_000,
        "reputation": 50, "tier": 4, "requires": ["neighborhood_practice", "board_network"], "benefit": "+8% payout · $1,200/hour", "payout_mult": .08, "passive_hourly": 1_200, "region": "Financial District", "art": "art-deco",
        "description": "Absorb a polished boutique and its premium client book.",
    },
    {
        "key": "regional_firm", "type": "rival", "name": "Acquire Northstar Law", "cost": 5_000_000,
        "reputation": 58, "tier": 5, "requires": ["downtown_boutique"], "benefit": "+10% payout · $6,000/hour", "payout_mult": .10, "passive_hourly": 6_000, "region": "Harbor Exchange", "art": "northstar",
        "description": "Your first multi-region acquisition changes the skyline for good.",
    },
    {
        "key": "national_competitor", "type": "rival", "name": "Acquire Sterling Global", "cost": 30_000_000,
        "reputation": 64, "tier": 6, "requires": ["regional_firm", "international_network"], "benefit": "+15% payout · $25,000/hour", "payout_mult": .15, "passive_hourly": 25_000, "region": "Midtown Crown", "art": "mega-tower",
        "description": "The defining acquisition of a national legal empire.",
    },
    _asset("appellate_chambers", "rival", "Acquire Blackstone Chambers", 160_000, 43, 3, "+8% payout · $15,000/hour", "A feared appellate chamber brings a century of arguments and a beautiful civic archive.", requires=("neighborhood_practice",), art="gothic", payout_mult=.08, passive_hourly=15_000),
    _asset("media_law_collective", "rival", "Acquire Neon & Gold", 1_400_000, 54, 4, "+12% payout · $90,000/hour", "A neon-lit media collective adds entertainment fluency and a formidable trial studio.", requires=("downtown_boutique",), art="neon", payout_mult=.12, passive_hourly=90_000),
    _asset("transatlantic_firm", "rival", "Acquire Meridian Atlantic", 60_000_000, 68, 7, "+18% payout · $4M/hour", "A transatlantic institution gives the empire genuine cross-border depth.", requires=("national_competitor",), art="glass-arc", payout_mult=.18, passive_hourly=4_000_000),
    _asset("global_crisis_firm", "rival", "Acquire Redline Counsel", 260_000_000, 74, 8, "+22% payout · $18M/hour", "The world's fastest crisis firm becomes your always-awake response division.", requires=("transatlantic_firm",), art="command", payout_mult=.22, passive_hourly=18_000_000),
    _asset("sovereign_rival", "rival", "Acquire Crown Meridian", 950_000_000, 79, 9, "+28% payout · $65M/hour", "A sovereign advisory house unlocks treaty halls once closed to outsiders.", requires=("global_crisis_firm", "sovereign_council"), art="citadel", payout_mult=.28, passive_hourly=65_000_000),
    _asset("continental_rival", "rival", "Acquire Atlas Juris", 3_500_000_000, 83, 10, "+35% payout · $220M/hour", "An autonomous continental campus joins your crest after the largest merger in legal history.", requires=("sovereign_rival",), art="campus", payout_mult=.35, passive_hourly=220_000_000),
    _asset("oceanic_rival", "rival", "Acquire Pelagic Partners", 9_000_000_000, 86, 11, "+42% payout · $550M/hour", "The floating blue citadel and its climate practice become the empire's oceanic wing.", requires=("continental_rival", "oceanic_compact"), art="ocean", payout_mult=.42, passive_hourly=550_000_000),
    _asset("orbital_rival", "rival", "Acquire Zenith Orbital", 22_000_000_000, 89, 12, "+55% payout · $1.2B/hour", "The rival orbital ring docks with yours, joining two unprecedented bodies of space law.", requires=("oceanic_rival", "orbital_bar"), art="orbital", payout_mult=.55, passive_hourly=1_200_000_000),
    _asset("lunar_rival", "rival", "Acquire Selene Accord", 50_000_000_000, 92, 13, "+70% payout · $2.5B/hour", "The lunar settlement's founding law house accepts a place in the interworld alliance.", requires=("orbital_rival", "interworld_assembly"), art="lunar", payout_mult=.70, passive_hourly=2_500_000_000),
    _asset("planetary_rival", "rival", "Acquire Apex Justice Network", 140_000_000_000, 95, 14, "+100% payout · $6B/hour", "The final rival becomes the other half of a planetary public-interest legal network.", requires=("lunar_rival", "justice_constellation"), art="nexus", payout_mult=1.0, passive_hourly=6_000_000_000),
]

ASSETS = UPGRADES + STAFF + CONNECTIONS + RIVALS
TIER_GATED_ASSET_TYPES = {"upgrade", "staff", "rival"}


def _tier_required_asset_keys(target_tier: int) -> list[str]:
    """Purchases that must be complete before entering ``target_tier``."""
    return [
        item["key"]
        for item in ASSETS
        if item["type"] in TIER_GATED_ASSET_TYPES and item["tier"] < target_tier
    ]


def _missing_tier_assets(target_tier: int, owned: set[str]) -> list[str]:
    return [key for key in _tier_required_asset_keys(target_tier) if key not in owned]

CLIENTS = [
    {"key": "walk_in", "name": "Walk-in client", "base_fee": 100, "reputation": 0, "tier": 0, "length": 8, "icon": "briefcase", "region": "Old Quarter", "description": "Everyday people who need a sharp advocate."},
    {"key": "local_individual", "name": "Local client", "base_fee": 1_100, "reputation": 15, "tier": 0, "length": 8, "icon": "home", "region": "Old Quarter", "description": "A referral from around the neighborhood with a real retainer ready."},
    {"key": "legal_aid_coalition", "name": "Legal aid coalition", "base_fee": 500, "reputation": 10, "tier": 0, "length": 6, "icon": "civic", "region": "Old Quarter", "description": "A community coalition with urgent matters and grant-backed fees."},
    {"key": "small_business", "name": "Small business", "base_fee": 4_500, "reputation": 20, "tier": 1, "requires": ["local_bar"], "length": 8, "icon": "store", "region": "Old Quarter", "description": "A growing company with a full docket."},
    {"key": "restaurant_group", "name": "Restaurant group", "base_fee": 6_000, "reputation": 25, "tier": 1, "length": 7, "icon": "hospitality", "region": "Old Quarter", "description": "A beloved local group protecting leases, staff, and a fast-growing brand."},
    {"key": "wealthy_client", "name": "Private client", "base_fee": 18_000, "reputation": 32, "tier": 2, "requires": ["business_network"], "length": 8, "icon": "gem", "region": "Market Ward", "description": "High expectations, discreet matters, better fees."},
    {"key": "property_developer", "name": "Property developer", "base_fee": 24_000, "reputation": 34, "tier": 2, "length": 9, "icon": "property", "region": "Market Ward", "description": "A city builder balancing financing, neighbors, and a complicated approval map."},
    {"key": "regional_corporation", "name": "Regional corporation", "base_fee": 85_000, "reputation": 42, "tier": 3, "requires": ["senior_associate", "board_network"], "length": 10, "icon": "building", "region": "Civic Center", "description": "A serious company looking for outside counsel."},
    {"key": "hospital_network", "name": "Hospital network", "base_fee": 110_000, "reputation": 44, "tier": 3, "requires": ["civic_referral_council"], "length": 8, "icon": "health", "region": "Civic Center", "description": "A regional care network facing questions where precision and empathy both matter."},
    {"key": "film_studio", "name": "Film studio", "base_fee": 360_000, "reputation": 50, "tier": 4, "requires": ["entertainment_circle"], "length": 9, "icon": "media", "region": "Financial District", "description": "A bright-lights client with rights, talent, and a release date on the line."},
    {"key": "fintech_unicorn", "name": "Fintech unicorn", "base_fee": 450_000, "reputation": 52, "tier": 4, "length": 8, "icon": "tech", "region": "Financial District", "description": "A fast-moving platform that needs rules to scale as quickly as its code."},
    {"key": "regional_infrastructure", "name": "Infrastructure authority", "base_fee": 1_600_000, "reputation": 56, "tier": 5, "length": 10, "icon": "civic", "region": "Harbor Exchange", "description": "The bridges, ports, and public contracts that keep a whole region moving."},
    {"key": "sports_league", "name": "National sports league", "base_fee": 2_100_000, "reputation": 58, "tier": 5, "requires": ["entertainment_circle"], "length": 10, "icon": "sports", "region": "Harbor Exchange", "description": "Teams, media rights, labor rules, and a season that will not wait."},
    {"key": "national_corporation", "name": "National corporation", "base_fee": 7_000_000, "reputation": 62, "tier": 6, "requires": ["rainmaker", "national_gc_council"], "length": 10, "icon": "landmark", "region": "Midtown Crown", "description": "A national account that can transform the firm."},
    {"key": "energy_grid", "name": "National energy grid", "base_fee": 9_000_000, "reputation": 64, "tier": 6, "length": 9, "icon": "energy", "region": "Midtown Crown", "description": "A critical grid modernizing under regulatory, market, and climate pressure."},
    {"key": "global_conglomerate", "name": "Global conglomerate", "base_fee": 30_000_000, "reputation": 68, "tier": 7, "requires": ["international_network"], "length": 12, "icon": "globe", "region": "Embassy Row", "description": "A worldwide client relationship that reshapes the practice."},
    {"key": "sovereign_wealth_fund", "name": "Sovereign wealth fund", "base_fee": 38_000_000, "reputation": 70, "tier": 7, "requires": ["diplomatic_forum"], "length": 10, "icon": "sovereign", "region": "Embassy Row", "description": "Long-horizon investments crossing industries, borders, and generations."},
    {"key": "biotech_alliance", "name": "Global biotech alliance", "base_fee": 130_000_000, "reputation": 74, "tier": 8, "requires": ["global_exchange"], "length": 10, "icon": "health", "region": "Skyline Heights", "description": "Frontier medicine where patents, access, safety, and time all collide."},
    {"key": "megacap_platform", "name": "Megacap technology platform", "base_fee": 160_000_000, "reputation": 76, "tier": 8, "length": 12, "icon": "tech", "region": "Skyline Heights", "description": "A platform whose smallest policy choice reaches a billion people."},
    {"key": "central_bank", "name": "Central bank consortium", "base_fee": 540_000_000, "reputation": 79, "tier": 9, "requires": ["sovereign_council"], "length": 10, "icon": "bank", "region": "Sovereign Enclave", "description": "Institutions coordinating stability while every market studies each word."},
    {"key": "climate_compact", "name": "Planetary climate compact", "base_fee": 680_000_000, "reputation": 81, "tier": 9, "length": 10, "icon": "energy", "region": "Sovereign Enclave", "description": "A treaty-scale coalition turning climate promises into enforceable systems."},
    {"key": "quantum_consortium", "name": "Quantum industry consortium", "base_fee": 1_900_000_000, "reputation": 83, "tier": 10, "requires": ["innovation_compact"], "length": 12, "icon": "quantum", "region": "Innovation Arc", "description": "Frontier computing firms writing the rules for capabilities that barely have names."},
    {"key": "continental_union", "name": "Continental infrastructure union", "base_fee": 2_400_000_000, "reputation": 84, "tier": 10, "length": 10, "icon": "property", "region": "Innovation Arc", "description": "Cities and nations building shared transit, energy, and communications systems."},
    {"key": "oceanic_consortium", "name": "Oceanic cities consortium", "base_fee": 5_800_000_000, "reputation": 86, "tier": 11, "requires": ["oceanic_compact"], "length": 12, "icon": "ocean", "region": "Azure Coast", "description": "Floating cities defining governance for a changing coast."},
    {"key": "orbital_industries", "name": "Orbital industries group", "base_fee": 13_000_000_000, "reputation": 89, "tier": 12, "requires": ["orbital_bar"], "length": 12, "icon": "orbit", "region": "Aerospace Basin", "description": "Stations, launch systems, and habitats building the first durable off-world economy."},
    {"key": "lunar_settlement", "name": "Lunar settlement council", "base_fee": 31_000_000_000, "reputation": 92, "tier": 13, "requires": ["interworld_assembly"], "length": 14, "icon": "lunar", "region": "Lunar Gate", "description": "A new society asking old legal principles to work under an unfamiliar sky."},
    {"key": "planetary_assembly", "name": "Planetary assembly", "base_fee": 72_000_000_000, "reputation": 94, "tier": 14, "requires": ["interworld_assembly", "planetary_command"], "length": 15, "icon": "nexus", "region": "Celestial Crown", "description": "The most consequential client in the game: a civilization choosing rules for its shared future."},
]

# Character-driven clients sit alongside the institutional progression. Their
# shorter contracts and visible twists create meaningful choices within a tier.
CLIENTS += [
    {"key": "injury_victim", "name": "Injured bicycle courier", "base_fee": 900, "reputation": 8, "tier": 0, "length": 5, "icon": "health", "region": "Old Quarter", "archetype": "Injury claimant", "special": "Contingency finish · +2× contract bonus", "contract_bonus_mult": 2, "description": "A courier rebuilding a life after a dangerous delivery route and a denied claim."},
    {"key": "serial_plaintiff", "name": "Serial sidewalk plaintiff", "base_fee": 1_100, "reputation": 18, "tier": 0, "length": 4, "icon": "briefcase", "region": "Old Quarter", "archetype": "Repeat litigant", "special": "Rapid-fire 4-case contract", "description": "Knows every cracked curb in the district and arrives with three binders of prior pleadings."},
    {"key": "wrongfully_accused_driver", "name": "Wrongfully accused driver", "base_fee": 1_250, "reputation": 20, "tier": 0, "length": 6, "icon": "home", "region": "Old Quarter", "archetype": "Criminal defense", "special": "Protected retainer · 45% payout floor", "minimum_score_multiplier": .45, "description": "A rideshare driver whose borrowed car was linked to a robbery across town."},
    {"key": "scam_victims", "name": "Romance-scam survivors", "base_fee": 6_500, "reputation": 22, "tier": 1, "length": 6, "icon": "civic", "region": "Old Quarter", "archetype": "Fraud recovery", "special": "Recovery pool · +1× contract bonus", "contract_bonus_mult": 1, "description": "A determined group tracing money through shell accounts after the same invented romance."},
    {"key": "street_magician", "name": "Accused street magician", "base_fee": 7_500, "reputation": 24, "tier": 1, "length": 5, "icon": "media", "region": "Old Quarter", "archetype": "Theft defense", "special": "+10% intrigue premium", "payout_mult": 1.10, "description": "A theatrical performer accused of making a patron's antique watch disappear for good."},
    {"key": "tenant_organizer", "name": "Tenants' night-shift organizer", "base_fee": 8_000, "reputation": 26, "tier": 1, "length": 7, "icon": "property", "region": "Old Quarter", "archetype": "Housing rights", "special": "Community grant · 50% payout floor", "minimum_score_multiplier": .50, "description": "A hospital custodian organizing three buildings against an illegal mass eviction."},
    {"key": "alleged_art_forger", "name": "Alleged master art forger", "base_fee": 28_000, "reputation": 34, "tier": 2, "requires": ["private_investigator"], "length": 6, "icon": "media", "region": "Market Ward", "archetype": "White-collar defense", "special": "+15% authenticity premium", "payout_mult": 1.15, "description": "A charming restorer insists the impossible masterpiece is merely misunderstood provenance."},
    {"key": "true_crime_host", "name": "True-crime host under subpoena", "base_fee": 31_000, "reputation": 34, "tier": 2, "length": 5, "icon": "media", "region": "Market Ward", "archetype": "Media law", "special": "Short, premium contract", "description": "A famous host must protect sources without turning a cold case into another spectacle."},
    {"key": "serial_entrepreneur", "name": "Serially sued inventor", "base_fee": 34_000, "reputation": 36, "tier": 2, "length": 8, "icon": "tech", "region": "Market Ward", "archetype": "Patent defense", "special": "Loyalty-heavy 8-case docket", "description": "Every prototype works, every former partner sues, and every meeting begins with a new sketch."},
    {"key": "warehouse_survivors", "name": "Warehouse injury survivors", "base_fee": 38_000, "reputation": 36, "tier": 2, "length": 6, "icon": "health", "region": "Market Ward", "archetype": "Workplace injury", "special": "+2× contract close", "contract_bonus_mult": 2, "description": "Workers compare records after discovering the same safety system failed across three sites."},
    {"key": "city_hall_whistleblower", "name": "City Hall whistleblower", "base_fee": 125_000, "reputation": 42, "tier": 3, "length": 7, "icon": "civic", "region": "Civic Center", "archetype": "Public corruption", "special": "Reputation shield client", "reputation_guard": 1, "description": "A meticulous procurement analyst carries encrypted evidence of a contract-rigging scheme."},
    {"key": "class_action_survivors", "name": "Transit crash survivor class", "base_fee": 155_000, "reputation": 44, "tier": 3, "requires": ["civic_referral_council"], "length": 8, "icon": "health", "region": "Civic Center", "archetype": "Mass injury", "special": "+3× contract resolution", "contract_bonus_mult": 3, "description": "Dozens of passengers need one coherent case without losing their individual stories."},
    {"key": "accused_hacker", "name": "Teen hacker facing federal charges", "base_fee": 175_000, "reputation": 46, "tier": 3, "length": 6, "icon": "tech", "region": "Civic Center", "archetype": "Cybercrime defense", "special": "+15% technical premium", "payout_mult": 1.15, "description": "A gifted student found the vulnerability, reported it badly, and now faces a theory far larger than the facts."},
    {"key": "private_detective_agency", "name": "Private detective agency", "base_fee": 190_000, "reputation": 46, "tier": 3, "requires": ["private_investigator"], "length": 9, "icon": "briefcase", "region": "Civic Center", "archetype": "Professional liability", "special": "Long 9-file mystery docket", "description": "A rain-soaked agency brings surveillance disputes, missing heirs, and one file nobody will discuss."},
    {"key": "casino_magnate", "name": "Casino magnate", "base_fee": 520_000, "reputation": 50, "tier": 4, "length": 7, "icon": "gem", "region": "Financial District", "archetype": "Regulatory defense", "special": "+20% high-roller premium", "payout_mult": 1.20, "description": "A famously lucky owner faces a licensing fight involving algorithms, rivals, and a vanished compliance chief."},
    {"key": "crypto_founder", "name": "Crypto founder under investigation", "base_fee": 640_000, "reputation": 52, "tier": 4, "length": 8, "icon": "tech", "region": "Financial District", "archetype": "Financial crime defense", "special": "Volatile · +25% fee premium", "payout_mult": 1.25, "description": "A persuasive founder claims the missing reserves are locked, not gone; the transaction trail must decide."},
    {"key": "celebrity_divorce", "name": "Celebrity power-couple split", "base_fee": 580_000, "reputation": 52, "tier": 4, "requires": ["entertainment_circle"], "length": 5, "icon": "media", "region": "Financial District", "archetype": "Family and media law", "special": "Fast 5-case confidentiality sprint", "description": "Two global brands, one hidden songwriting catalog, and absolutely no appetite for a public filing."},
    {"key": "medical_device_victims", "name": "Medical-device injury coalition", "base_fee": 720_000, "reputation": 54, "tier": 4, "length": 8, "icon": "health", "region": "Financial District", "archetype": "Product liability", "special": "+3× contract resolution", "contract_bonus_mult": 3, "description": "Patients across the region discover that their supposedly rare complications share a design flaw."},
    {"key": "pharma_whistleblower", "name": "Pharma trial whistleblower", "base_fee": 2_500_000, "reputation": 57, "tier": 5, "length": 7, "icon": "health", "region": "Harbor Exchange", "archetype": "Corporate fraud", "special": "+25% sealed-evidence premium", "payout_mult": 1.25, "description": "A clinical researcher alleges that inconvenient trial results were quietly reclassified."},
    {"key": "union_reformer", "name": "Reform union president", "base_fee": 2_800_000, "reputation": 58, "tier": 5, "length": 9, "icon": "civic", "region": "Harbor Exchange", "archetype": "Labor racketeering defense", "special": "Protected 55% payout floor", "minimum_score_multiplier": .55, "description": "A reform leader targeted by old allies needs to prove the new books are clean."},
    {"key": "stolen_art_nations", "name": "Stolen-art recovery alliance", "base_fee": 3_100_000, "reputation": 60, "tier": 5, "requires": ["international_network"], "length": 8, "icon": "sovereign", "region": "Harbor Exchange", "archetype": "Cultural property", "special": "+2× recovery bonus", "contract_bonus_mult": 2, "description": "Museums and nations trace a celebrated collection through war, shell donors, and forged export papers."},
    {"key": "market_manipulation_suspect", "name": "Market-manipulation suspect", "base_fee": 11_000_000, "reputation": 63, "tier": 6, "length": 7, "icon": "bank", "region": "Midtown Crown", "archetype": "Securities defense", "special": "+25% complexity premium", "payout_mult": 1.25, "description": "A legendary short seller says the suspicious timing came from research, not an inside source."},
    {"key": "serial_patent_plaintiff", "name": "Serial patent plaintiff", "base_fee": 14_000_000, "reputation": 65, "tier": 6, "length": 5, "icon": "tech", "region": "Midtown Crown", "archetype": "Repeat plaintiff", "special": "Five-case licensing blitz", "description": "A tiny company owns one astonishing patent and has sued nearly everyone who owns a screen."},
    {"key": "protected_witness", "name": "Protected cartel accountant", "base_fee": 16_000_000, "reputation": 66, "tier": 6, "requires": ["cybersecurity_counsel"], "length": 6, "icon": "briefcase", "region": "Midtown Crown", "archetype": "Organized-crime cooperation", "special": "+30% danger premium", "payout_mult": 1.30, "description": "An accountant with perfect recall offers the ledger of a criminal network in exchange for safety and a fair deal."},
    {"key": "exiled_dissident", "name": "Exiled investigative publisher", "base_fee": 44_000_000, "reputation": 69, "tier": 7, "requires": ["diplomatic_forum"], "length": 7, "icon": "media", "region": "Embassy Row", "archetype": "Human-rights defense", "special": "Reputation shield · +20% premium", "payout_mult": 1.20, "reputation_guard": 2, "description": "A publisher pursued across borders needs protection for sources and a lawful path home."},
    {"key": "sanctions_investigator", "name": "Renegade sanctions investigator", "base_fee": 52_000_000, "reputation": 71, "tier": 7, "length": 8, "icon": "sovereign", "region": "Embassy Row", "archetype": "International enforcement", "special": "+25% cross-border premium", "payout_mult": 1.25, "description": "A former regulator follows a ghost fleet through flags, insurers, and companies that exist only on paper."},
    {"key": "deepfake_victims", "name": "Deepfake extortion survivors", "base_fee": 180_000_000, "reputation": 75, "tier": 8, "length": 7, "icon": "tech", "region": "Skyline Heights", "archetype": "Technology abuse", "special": "+3× recovery resolution", "contract_bonus_mult": 3, "description": "Public figures and ordinary families unite against one sophisticated synthetic-media extortion ring."},
    {"key": "rogue_ai_lab", "name": "Rogue AI lab board", "base_fee": 220_000_000, "reputation": 77, "tier": 8, "requires": ["global_exchange"], "length": 9, "icon": "quantum", "region": "Skyline Heights", "archetype": "Corporate investigation", "special": "High-risk · +30% premium", "payout_mult": 1.30, "description": "A divided board discovers its celebrated lab ran an unauthorized deployment with worldwide effects."},
    {"key": "ghost_fleet_owner", "name": "Alleged ghost-fleet owner", "base_fee": 760_000_000, "reputation": 80, "tier": 9, "length": 6, "icon": "ocean", "region": "Sovereign Enclave", "archetype": "Sanctions defense", "special": "+35% sovereign-risk premium", "payout_mult": 1.35, "description": "A shipping billionaire denies controlling the tankers that every investigator insists are his."},
    {"key": "autonomous_city", "name": "Autonomous city accused of bias", "base_fee": 2_700_000_000, "reputation": 84, "tier": 10, "length": 10, "icon": "quantum", "region": "Innovation Arc", "archetype": "Algorithmic civil rights", "special": "+4× systemic resolution", "contract_bonus_mult": 4, "description": "A smart city must answer whether its invisible systems quietly divided opportunity by neighborhood."},
    {"key": "orbital_salvager", "name": "Accused orbital salvager", "base_fee": 15_000_000_000, "reputation": 90, "tier": 12, "length": 6, "icon": "orbit", "region": "Aerospace Basin", "archetype": "Space-property defense", "special": "+40% frontier premium", "payout_mult": 1.40, "description": "A daring captain calls it abandoned equipment; three nations call it the first theft in orbit."},
    {"key": "lunar_injury_collective", "name": "Lunar mine injury collective", "base_fee": 36_000_000_000, "reputation": 92, "tier": 13, "length": 8, "icon": "lunar", "region": "Lunar Gate", "archetype": "Off-world mass injury", "special": "+5× contract resolution", "contract_bonus_mult": 5, "description": "Miners injured far from Earth ask which world's safety promise actually governs."},
]

# Public-interest matters trade some immediate cash for unusually strong career
# standing. Their loss protection keeps a difficult LSAT question from making
# service-minded play feel punitive.
CLIENTS += [
    {"key": "eviction_defense_clinic", "name": "Eviction Defense Clinic", "base_fee": 650, "reputation": 8, "tier": 0, "length": 5, "icon": "home", "region": "Old Quarter", "archetype": "Pro bono housing defense", "matter_type": "pro_bono", "reputation_win_bonus": 2, "reputation_loss_cap": .5, "reputation_guard": 3.5, "special": "PRO BONO · +2 Reputation on a win · losses capped at −0.5", "description": "Ada Mercer's overflow list begins with families facing lockouts before their hearings."},
    {"key": "youth_record_project", "name": "Second-Chance Youth Project", "base_fee": 3_200, "reputation": 22, "tier": 1, "length": 6, "icon": "civic", "region": "Old Quarter", "archetype": "Pro bono record clearing", "matter_type": "pro_bono", "reputation_win_bonus": 3, "reputation_loss_cap": .5, "reputation_guard": 3.5, "special": "PRO BONO · +3 Reputation on a win · protected loss", "description": "Young adults seek to clear old records before a mistake becomes a lifetime sentence."},
    {"key": "innocence_archive_client", "name": "Innocence Archive", "base_fee": 14_000, "reputation": 32, "tier": 2, "length": 7, "icon": "briefcase", "region": "Market Ward", "archetype": "Pro bono innocence review", "matter_type": "pro_bono", "reputation_win_bonus": 4, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +4 Reputation on a win · protected loss", "description": "Damaged transcripts and a recanted identification may be all that stand between a prisoner and freedom."},
    {"key": "night_nurses_coalition", "name": "Night Nurses Coalition", "base_fee": 62_000, "reputation": 42, "tier": 3, "length": 6, "icon": "health", "region": "Civic Center", "archetype": "Pro bono whistleblower protection", "matter_type": "pro_bono", "reputation_win_bonus": 4, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +4 Reputation on a win · protected loss", "description": "Nurses who exposed a closed ward need counsel before the hospital board makes them disappear from the schedule."},
    {"key": "journalist_defense_fund", "name": "Free Press Defense Fund", "base_fee": 280_000, "reputation": 51, "tier": 4, "length": 7, "icon": "media", "region": "Financial District", "archetype": "Pro bono source protection", "matter_type": "pro_bono", "reputation_win_bonus": 5, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +5 Reputation on a win · protected loss", "description": "Local reporters face a coordinated subpoena campaign after tracing Sterling money into City Hall."},
    {"key": "witness_family_network", "name": "Witness Family Network", "base_fee": 1_100_000, "reputation": 57, "tier": 5, "length": 7, "icon": "civic", "region": "Harbor Exchange", "archetype": "Pro bono witness protection", "matter_type": "pro_bono", "reputation_win_bonus": 5, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +5 Reputation on a win · protected loss", "description": "Families displaced by organized-crime testimony need lawful status, safe housing, and someone who keeps promises."},
    {"key": "refugee_appeals_collective", "name": "Refugee Appeals Collective", "base_fee": 5_000_000, "reputation": 66, "tier": 7, "length": 8, "icon": "globe", "region": "Embassy Row", "archetype": "Pro bono human-rights appeals", "matter_type": "pro_bono", "reputation_win_bonus": 6, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +6 Reputation on a win · protected loss", "description": "A volunteer corridor races contradictory deadlines to keep families from being returned to danger."},
    {"key": "vanishing_islands_youth", "name": "Vanishing Islands Youth Assembly", "base_fee": 170_000_000, "reputation": 77, "tier": 9, "length": 8, "icon": "ocean", "region": "Sovereign Enclave", "archetype": "Pro bono climate justice", "matter_type": "pro_bono", "reputation_win_bonus": 7, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +7 Reputation on a win · protected loss", "description": "Young delegates ask the world's wealthiest institutions to turn relocation promises into enforceable rights."},
    {"key": "neighborhood_data_union", "name": "Neighborhood Data Union", "base_fee": 600_000_000, "reputation": 83, "tier": 10, "length": 9, "icon": "quantum", "region": "Innovation Arc", "archetype": "Pro bono algorithmic appeal", "matter_type": "pro_bono", "reputation_win_bonus": 7, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +7 Reputation on a win · protected loss", "description": "Residents challenge a city model that quietly decided who deserved work, credit, and safe streets."},
    {"key": "lunar_workers_collective", "name": "Far-Side Workers Collective", "base_fee": 7_500_000_000, "reputation": 91, "tier": 13, "length": 10, "icon": "lunar", "region": "Lunar Gate", "archetype": "Pro bono off-world labor", "matter_type": "pro_bono", "reputation_win_bonus": 8, "reputation_loss_cap": .5, "reputation_guard": 4, "special": "PRO BONO · +8 Reputation on a win · protected loss", "description": "The first off-world union asks which human guarantees survive the distance from Earth."},
]

def _round_game_amount(value: float) -> int:
    """Round economy values to readable two-significant-digit prices."""
    value = max(1, round(value))
    magnitude = 10 ** max(0, len(str(value)) - 2)
    return max(1, round(value / magnitude) * magnitude)


def _format_game_money(value: int) -> str:
    for threshold, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
        if value >= threshold:
            scaled = value / threshold
            return f"{scaled:.1f}".rstrip("0").rstrip(".") + suffix
    return f"{value:,}"


def _case_target_for_tier(tier: int) -> int:
    """Expected cash from one solid correct case at the current firm tier."""
    if tier < len(FIRM_TIERS) - 1:
        tier_cost = FIRM_TIERS[tier + 1]["cost"]
    else:
        tier_cost = FIRM_TIERS[-1]["cost"]
    # Headquarters now cost twice as much without inflating case fees or every
    # mandatory catalog purchase along with them.
    return round(tier_cost / (TARGET_CASES_PER_MILESTONE * FIRM_TIER_COST_MULTIPLIER))


def _replace_case_payout_benefit(item: dict, percentage: int) -> None:
    parts = [part.strip() for part in item["benefit"].split("·")]
    secondary = [part for part in parts if "payout" not in part.lower()]
    item["benefit"] = " · ".join([f"+{percentage}% case payout", *secondary])


def _rebalance_asset_catalog() -> None:
    """Give every purchase durable value and price it in successful cases."""
    for item in ASSETS:
        tier = item["tier"]
        original_payout = float(item.get("payout_mult", 0))
        base_percentage = 2 + tier // 3
        if original_payout:
            payout_percentage = min(10, base_percentage + max(1, round(original_payout * 5)))
        else:
            # Unlocks, passive specialists, and support hires still improve the
            # active loop, so none becomes a dead-end purchase after its gate.
            payout_percentage = min(8, base_percentage)
        item["payout_mult"] = payout_percentage / 100
        _replace_case_payout_benefit(item, payout_percentage)

        target = _case_target_for_tier(tier)
        if "staff_flat" in item:
            item["staff_flat"] = _round_game_amount(target * .10)
            parts = [part.strip() for part in item["benefit"].split("·") if "per active case" not in part.lower()]
            item["benefit"] = " · ".join([*parts, f"+${_format_game_money(item['staff_flat'])} flat case bonus"])
        if "passive_hourly" in item:
            passive_rate = .05 if item["type"] == "rival" else .04
            item["passive_hourly"] = _round_game_amount(target * passive_rate)
            parts = [
                part.strip()
                for part in item["benefit"].split("·")
                if "/hour" not in part.lower() and "per hour" not in part.lower()
            ]
            item["benefit"] = " · ".join([*parts, f"${_format_game_money(item['passive_hourly'])}/hour passive"])

        secondary_effects = sum(
            bool(item.get(key))
            for key in ("passive_hourly", "staff_flat", "storage_hours", "streak_bonus_cap", "contract_bonus_mult", "reputation_guard")
        )
        if item["type"] == "connection":
            secondary_effects += 1
        strength_premium = max(0, payout_percentage - base_percentage) * .18
        target_questions = min(5.0, 3.0 + strength_premium + secondary_effects * .32)
        if item["type"] == "rival":
            target_questions = 5.0
        item["cost"] = _round_game_amount(target * target_questions)


def _rebalance_client_catalog() -> None:
    """Equalize expected commercial value while preserving client play styles."""
    solid_score_multiplier = 1.20
    for client in CLIENTS:
        if client.get("matter_type") == "pro_bono":
            continue
        tier = client["tier"]
        firm_multiplier = 1 + tier * .06
        contract_multiplier = 2 + float(client.get("contract_bonus_mult", 0))
        average_value_factor = (
            solid_score_multiplier * firm_multiplier * float(client.get("payout_mult", 1))
            + contract_multiplier / max(1, client["length"])
        )
        client["base_fee"] = _round_game_amount(_case_target_for_tier(tier) / average_value_factor)


_rebalance_asset_catalog()
_rebalance_client_catalog()
CLIENTS.sort(key=lambda client: (client["tier"], client["base_fee"], client["name"]))

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


def _client_is_unlocked(client: dict, profile: PlayerProfile, owned: set[str]) -> bool:
    # Signed clients stay in the book even if a difficult case temporarily
    # lowers reputation. This prevents a loss from collapsing the fee tier.
    return _requirements_met(client, profile, owned) or any(
        contract.client_key == client["key"] for contract in profile.client_contracts
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
    cap_hours = 8 + sum(int(ASSET_BY_KEY[key].get("storage_hours", 0)) for key in owned if key in ASSET_BY_KEY)
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
    if value >= 94:
        return {"name": "Legendary", "minimum": 94, "next": None}
    if value >= 86:
        return {"name": "Elite", "minimum": 86, "next": 94}
    if value >= 75:
        return {"name": "Prestigious", "minimum": 75, "next": 86}
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
        ("hundred_cases", "Century docket", "Complete 100 cases.", profile.total_cases >= 100),
        ("global_counsel", "Global counsel", "Build an International Practice.", profile.office_tier >= 7),
        ("billion_value", "Billion-dollar practice", "Reach a $1,000,000,000 valuation.", _valuation(profile) >= 1_000_000_000),
        ("orbital_bar", "Beyond the atmosphere", "Join the Orbital Bar Association.", "orbital_bar" in owned),
        ("planetary_nexus", "Justice constellation", "Build the Planetary Justice Nexus.", profile.office_tier >= 14),
        ("rival_network", "Friendly competition", "Acquire five rival firms.", sum(ASSET_BY_KEY[key]["type"] == "rival" for key in owned if key in ASSET_BY_KEY) >= 5),
    ]
    return [{"key": key, "name": name, "description": description, "unlocked": unlocked} for key, name, description, unlocked in values]


def _public_asset(item: dict, profile: PlayerProfile, owned: set[str]) -> dict:
    private_effects = {
        "payout_mult", "staff_flat", "passive_hourly", "storage_hours",
        "streak_bonus_cap", "contract_bonus_mult", "reputation_guard",
    }
    public = {key: value for key, value in item.items() if key not in private_effects}
    if item["type"] == "rival":
        discount_bps = rival_discount_bps(profile, item["key"])
        public["list_cost"] = item["cost"]
        public["discount_bps"] = discount_bps
        public["cost"] = _asset_cost(profile, item)
    public["owned"] = item["key"] in owned
    public["available"] = not public["owned"] and _requirements_met(item, profile, owned)
    public["requirements"] = _requirement_copy(item)
    return public


def _asset_cost(profile: PlayerProfile, item: dict) -> int:
    if item["type"] != "rival":
        return item["cost"]
    return max(1, round(item["cost"] * (10_000 - rival_discount_bps(profile, item["key"])) / 10_000))


def _public_client(client: dict, profile: PlayerProfile, owned: set[str]) -> dict:
    public = dict(client)
    public["requirements"] = _requirement_copy(client)
    contract = next((value for value in profile.client_contracts if value.client_key == client["key"]), None)
    public["unlocked"] = _requirements_met(client, profile, owned) or contract is not None
    public["selected"] = profile.active_client_key == client["key"]
    public["on_hold"] = public["selected"] and not public["unlocked"]
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
        key=lambda item: _asset_cost(profile, item),
    )
    if profile.office_tier >= len(FIRM_TIERS) - 1:
        if not eligible_assets:
            return None
        item = eligible_assets[0]
        return {"kind": "asset", "name": item["name"], "cost": _asset_cost(profile, item), "reputation": item.get("reputation", 0)}
    tier = FIRM_TIERS[profile.office_tier + 1]
    missing_tier_assets = set(_missing_tier_assets(tier["tier"], owned))
    if missing_tier_assets:
        # Never advertise a locked headquarters as the next goal. Prefer a
        # currently purchasable required item, then another available purchase
        # (often a connection needed by an acquisition), and finally the first
        # locked required item when reputation is the remaining blocker.
        required_and_eligible = [item for item in eligible_assets if item["key"] in missing_tier_assets]
        candidates = required_and_eligible or eligible_assets
        if candidates:
            item = candidates[0]
        else:
            item = min(
                (ASSET_BY_KEY[key] for key in missing_tier_assets),
                key=lambda value: _asset_cost(profile, value),
            )
        return {"kind": "asset", "name": item["name"], "cost": _asset_cost(profile, item), "reputation": item.get("reputation", 0)}
    if eligible_assets and _asset_cost(profile, eligible_assets[0]) <= tier["cost"]:
        item = eligible_assets[0]
        return {"kind": "asset", "name": item["name"], "cost": _asset_cost(profile, item), "reputation": item.get("reputation", 0)}
    return {"kind": "tier", "name": tier["name"], "cost": tier["cost"], "reputation": tier["reputation"]}


def _daily_reward_amount(profile: PlayerProfile, milestone: int, owned: set[str] | None = None) -> int:
    owned = owned if owned is not None else _owned_keys(profile)
    selected = CLIENT_BY_KEY.get(profile.active_client_key, CLIENT_BY_KEY["walk_in"])
    client = selected if _client_is_unlocked(selected, profile, owned) else CLIENT_BY_KEY["walk_in"]
    return max({5: 500, 10: 1_500, 20: 4_000}[milestone], int(client["base_fee"] * DAILY_REWARD_MULTIPLIERS[milestone]))


def serialize_game(profile: PlayerProfile, include_catalog: bool = True) -> dict:
    owned = _owned_keys(profile)
    daily = _daily(profile, persist=False)
    active_client = CLIENT_BY_KEY.get(profile.active_client_key, CLIENT_BY_KEY["walk_in"])
    active_client_public = _public_client(active_client, profile, owned)
    active_contract = next(
        (value for value in profile.client_contracts if value.client_key == active_client["key"]),
        None,
    )
    story = serialize_story(profile)
    rival_targets = []
    for rival in RIVALS:
        if rival["key"] in owned:
            continue
        rival_targets.append({
            **_public_asset(rival, profile, owned),
            "operations": operation_catalog(profile, rival),
        })
    story["rival_targets"] = rival_targets
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
                    "reward": _daily_reward_amount(profile, cases, owned),
                    "complete": daily.cases_completed >= cases,
                    "claimed": cases in (daily.claimed_json or []),
                }
                for cases in DAILY_REWARD_MULTIPLIERS
            ],
        },
        "achievements": _achievement_state(profile, owned),
        "next_milestone": _next_milestone(profile, owned),
        "story": story,
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
                    "required_assets": _tier_required_asset_keys(tier["tier"]),
                    "missing_assets": _missing_tier_assets(tier["tier"], owned),
                    "available": (
                        tier["tier"] == profile.office_tier + 1
                        and profile.reputation >= tier["reputation"]
                        and not _missing_tier_assets(tier["tier"], owned)
                    ),
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
    ensure_story_state(profile)
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
    price = _asset_cost(profile, item)
    if profile.cash < price:
        raise ValueError("insufficient_cash")
    profile.cash -= price
    profile.lifetime_spending += price
    asset = PlayerAsset(
        profile_id=profile.id,
        asset_key=asset_key,
        asset_type=item["type"],
        purchase_price=price,
    )
    db.session.add(asset)
    _ledger(profile, "asset_purchase", asset_key, -price, {"name": item["name"], "type": item["type"], "list_cost": item["cost"]})
    db.session.commit()
    return asset


def choose_story(profile: PlayerProfile, chapter_key: str, choice_key: str) -> dict:
    profile = _lock_profile(profile)
    cash_before = profile.cash
    result = resolve_story_choice(profile, chapter_key, choice_key)
    cash_change = profile.cash - cash_before
    if cash_change:
        _ledger(profile, "story_choice", chapter_key, cash_change, {"choice": choice_key})
    db.session.commit()
    return result


def activate_quest(profile: PlayerProfile, quest_key: str) -> dict:
    profile = _lock_profile(profile)
    owned = _owned_keys(profile)
    selected = CLIENT_BY_KEY.get(profile.active_client_key, CLIENT_BY_KEY["walk_in"])
    client = selected if _client_is_unlocked(selected, profile, owned) else CLIENT_BY_KEY["walk_in"]
    cash_before = profile.cash
    result = start_quest(profile, quest_key, base_fee=client["base_fee"])
    cash_change = profile.cash - cash_before
    if cash_change:
        _ledger(profile, "quest_advance", quest_key, cash_change, {"client": client["key"]})
    db.session.commit()
    return result


def run_rival_operation(profile: PlayerProfile, rival_key: str, operation_key: str) -> dict:
    rival = ASSET_BY_KEY.get(rival_key)
    if not rival or rival["type"] != "rival":
        raise ValueError("rival_not_found")
    profile = _lock_profile(profile)
    if rival_key in _owned_keys(profile):
        raise ValueError("rival_already_owned")
    result = execute_rival_operation(profile, rival, operation_key)
    _ledger(profile, "rival_operation", f"{rival_key}:{operation_key}", -result["cost"], {"discount_bps": result["discount_bps"]})
    db.session.commit()
    return result


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
    if _missing_tier_assets(next_tier_number, _owned_keys(profile)):
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
    if not _client_is_unlocked(client, profile, _owned_keys(profile)):
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
    elif contract.cases_remaining == 0:
        # Re-signing a client whose contract is spent starts a fresh docket. Wins
        # already auto-renew a contract, so this is a defensive guarantee that a
        # player can always replay an existing client and never gets stranded
        # without an available case — even if no new client is unlockable yet.
        contract.cases_remaining = client["length"]
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
    if milestone not in DAILY_REWARD_MULTIPLIERS:
        raise ValueError("invalid_milestone")
    profile = _lock_profile(profile)
    progress = _daily(profile)
    claimed = list(progress.claimed_json or [])
    if milestone in claimed:
        raise ValueError("already_claimed")
    if progress.cases_completed < milestone:
        raise ValueError("goal_incomplete")
    amount = _daily_reward_amount(profile, milestone)
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


# A wrong answer backed by genuinely strong reasoning still reflects real legal
# skill, so it is no longer a total loss. A well-argued miss earns a modest
# consultation fee, keeps a little professional standing, and is shielded from a
# steep reputation drop. Careless or unsupported misses (Weak / Invalid bands)
# still earn nothing and take the full hit, so a correct answer stays clearly the
# most valuable outcome — a thoughtful miss pays only a fraction of a real win.
EFFORT_MISS_MULTIPLIER = {"Good": 0.15, "Excellent": 0.25}
EFFORT_MISS_CREDIT = {"Good": 0.20, "Excellent": 0.30}
EFFORT_MISS_DROP_CAP = {"Good": 2.5, "Excellent": 1.5}


def _score_multiplier(score: int) -> float:
    # Sloppy or rushed correct answers (weak/thin explanations land here) earn a
    # little less than before, so writing a real argument — not just guessing the
    # letter — is what pays. The "solid case" anchor (score 14-16 -> 1.20) and the
    # premium bands above it are unchanged, keeping the catalog pacing intact.
    if score <= 3:
        return .55
    if score <= 7:
        return .65
    if score <= 10:
        return .80
    if score <= 13:
        return 1.00
    if score <= 16:
        return 1.20
    if score <= 18:
        return 1.25
    if score == 19:
        return 1.45
    return 1.70


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
    multiplier = 1 + profile.office_tier * .06
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
    client = selected if _client_is_unlocked(selected, profile, owned) else CLIENT_BY_KEY["walk_in"]
    firm_multiplier, _ = _firm_bonuses(profile, owned, 1)
    firm_multiplier *= float(client.get("payout_mult", 1))
    staff_flat = sum(int(ASSET_BY_KEY[key].get("staff_flat", 0)) for key in owned if key in ASSET_BY_KEY)
    streak_cap = .20 + sum(float(ASSET_BY_KEY[key].get("streak_bonus_cap", 0)) for key in owned if key in ASSET_BY_KEY)
    contract_mult = 2 + float(client.get("contract_bonus_mult", 0)) + sum(float(ASSET_BY_KEY[key].get("contract_bonus_mult", 0)) for key in owned if key in ASSET_BY_KEY)
    public_charter = bool(
        profile.story_state
        and (profile.story_state.choices_json or {}).get("charter_of_counsel") == "public_charter"
    )
    reputation_win_bonus = float(client.get("reputation_win_bonus", 0)) * (1.5 if public_charter else 1)
    return {
        "rule_version": RULE_VERSION,
        "client_key": client["key"],
        "base_fee": client["base_fee"],
        "firm_multiplier_bps": round(firm_multiplier * 10_000),
        "staff_flat": staff_flat,
        "streak_cap_bps": round(streak_cap * 10_000),
        "contract_bonus_mult_bps": round(contract_mult * 10_000),
        "minimum_score_multiplier_bps": round(float(client.get("minimum_score_multiplier", 0)) * 10_000),
        "client_reputation_guard_bps": round(float(client.get("reputation_guard", 0)) * 10_000),
        "client_matter_type": client.get("matter_type", "commercial"),
        "client_reputation_win_bonus_bps": round(reputation_win_bonus * 10_000),
        "client_reputation_loss_cap_bps": round(float(client.get("reputation_loss_cap", 4)) * 10_000),
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
        "quest_bonus": settlement.quest_bonus,
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
    reward_eligible = locked_attempt.is_correct and band != "Invalid"
    # A wrong answer with a Good/Excellent explanation is a well-reasoned miss:
    # it earns a small consultation fee instead of nothing (see EFFORT_MISS_*).
    effort_eligible = (not locked_attempt.is_correct) and band in EFFORT_MISS_MULTIPLIER
    paid_case = reward_eligible or effort_eligible
    owned = _owned_keys(profile)
    context = locked_attempt.session_item.game_context_json
    if context is None:
        return None
    if reward_eligible:
        score_mult = max(_score_multiplier(total_score), int(context.get("minimum_score_multiplier_bps") or 0) / 10_000)
    elif effort_eligible:
        score_mult = EFFORT_MISS_MULTIPLIER[band]
    else:
        score_mult = 0.0
    client = CLIENT_BY_KEY.get(context.get("client_key"), CLIENT_BY_KEY["walk_in"])
    base_fee = int(context.get("base_fee") or client["base_fee"])
    firm_mult = int(context.get("firm_multiplier_bps") or 10_000) / 10_000
    # Support staff and streaks amplify decisive wins only; a miss pays the base
    # consultation fee so accuracy stays clearly the more valuable outcome.
    staff_bonus = round(int(context.get("staff_flat") or 0) * score_mult) if reward_eligible else 0

    validated = locked_attempt.is_correct and band in {"Good", "Excellent"}
    if not locked_attempt.is_correct:
        profile.current_streak = 0
    elif validated:
        profile.current_streak += 1
        profile.best_streak = max(profile.best_streak, profile.current_streak)
    core_payout = round(base_fee * score_mult * firm_mult) if paid_case else 0
    streak_cap = int(context.get("streak_cap_bps") or 2_000) / 10_000
    streak_bonus = round(core_payout * min(streak_cap, profile.current_streak * .02)) if validated else 0
    contract_bonus = 0
    contract = (
        PlayerClientContract.query.populate_existing()
        .filter_by(profile_id=profile.id, client_key=client["key"])
        .with_for_update()
        .first()
    )
    if contract and reward_eligible:
        # Only decisive wins advance and renew a client's contract, so the
        # intended "3-5 good cases per office" pacing is preserved and a
        # thoughtful miss simply keeps you on the same open matter.
        contract.cases_remaining = max(0, contract.cases_remaining - 1)
        contract.loyalty += 1
        if contract.cases_remaining == 0:
            contract_mult = int(context.get("contract_bonus_mult_bps") or 20_000) / 10_000
            contract_bonus = round(base_fee * contract_mult)
            contract.completed_contracts += 1
            # Re-sign the client automatically: a finished contract rolls into a
            # fresh docket so the player is never left without a case to work.
            contract.cases_remaining = client["length"]
        if profile.active_client_key == client["key"]:
            profile.client_cases_remaining = contract.cases_remaining
    standard_payout = max(1, core_payout + streak_bonus + staff_bonus + contract_bonus) if paid_case else 0

    credit = 0.0
    if locked_attempt.is_correct:
        credit = 1.0 if band in {"Good", "Excellent"} else .5 if band == "Weak" else 0.0
    elif effort_eligible:
        # Partial standing for a well-argued wrong answer lifts the rolling
        # average, so a thoughtful miss dents reputation far less than a guess.
        credit = EFFORT_MISS_CREDIT[band]
    reputation_before = profile.reputation
    reputation_after = _new_reputation(profile.user_id, locked_attempt.id, credit)
    projected_correct = profile.total_correct + int(locked_attempt.is_correct)
    projected_validated = profile.total_validated_correct + int(validated)
    reputation_guard = int(context.get("client_reputation_guard_bps") or 0) / 10_000
    reputation_guard += sum(float(ASSET_BY_KEY[key].get("reputation_guard", 0)) for key in owned if key in ASSET_BY_KEY)
    maximum_drop = max(.5, 4 - reputation_guard)
    if effort_eligible:
        # A genuinely well-reasoned miss should never collapse a reputation the
        # way a careless one can, regardless of how thin the rolling average is.
        maximum_drop = min(maximum_drop, EFFORT_MISS_DROP_CAP[band])
    if context.get("client_matter_type") == "pro_bono":
        maximum_drop = min(maximum_drop, int(context.get("client_reputation_loss_cap_bps") or 5_000) / 10_000)
    reputation_after = round(max(reputation_after, reputation_before - maximum_drop), 1)
    if reward_eligible:
        career_floor = min(94.0, 50 + projected_correct * .55 + projected_validated * .70)
        reputation_after = round(max(reputation_after, career_floor), 1)
        reputation_after = min(100, round(reputation_after + int(context.get("client_reputation_win_bonus_bps") or 0) / 10_000, 1))

    profile.reputation = reputation_after
    quest_result = advance_quest(
        profile,
        validated=validated,
        correct=locked_attempt.is_correct,
        band=band,
        base_fee=base_fee,
    )
    quest_bonus = int(quest_result["quest_bonus"])
    payout = standard_payout + quest_bonus
    # Quest cash rewards are applied by the story engine with their other
    # persistent effects. Add only the standard case portion here.
    profile.cash += standard_payout
    profile.lifetime_earnings += standard_payout
    reputation_after = profile.reputation
    profile.total_cases += 1
    profile.total_correct += int(locked_attempt.is_correct)
    profile.total_validated_correct += int(validated)
    daily = _daily(profile)
    if paid_case:
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
        quest_bonus=quest_bonus,
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
