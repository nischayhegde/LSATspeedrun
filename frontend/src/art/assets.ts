/* Manifest of the generated art set in /public/art. Every helper returns a
   stable URL for a key and falls back deterministically for unknown keys, so
   new backend catalog entries always render something sensible. */

import type { CharacterGender } from '../types'

const BASE = `${import.meta.env.BASE_URL}art`

const pad2 = (n: number) => String(Math.trunc(n)).padStart(2, '0')
const clampTier = (tier: number) => Math.max(0, Math.min(14, Math.round(tier)))

export function keyHash(key: string) {
  return [...key].reduce((total, character) => total + character.charCodeAt(0), 0)
}

/* ------------------------------------------------------------ scenes */

export const officeArt = (tier: number) => `${BASE}/office/tier-${pad2(clampTier(tier))}.webp`

export type TerrainSection = 'city' | 'nation' | 'world' | 'continent' | 'space'
export const terrainArt = (section: TerrainSection) => `${BASE}/terrain/${section}.webp`

export const CUTSCENE_KEYS = [
  'rainy_shack', 'market_showdown', 'city_hall_night', 'sterling_tower',
  'midnight_exchange', 'continental_forum', 'orbital_hearing', 'planetary_nexus',
] as const
export const cutsceneArt = (scene: string) =>
  `${BASE}/cutscene/${(CUTSCENE_KEYS as readonly string[]).includes(scene) ? scene : 'rainy_shack'}.webp`

/* ------------------------------------------------------------- sites */

export const tierSiteArt = (tier: number) => `${BASE}/site/tier-${pad2(clampTier(tier))}.webp`

export const RIVAL_ARCHITECTURES = [
  'brick-house', 'art-deco', 'northstar', 'mega-tower', 'gothic', 'neon', 'glass-arc',
  'command', 'citadel', 'campus', 'ocean', 'orbital', 'lunar', 'nexus',
] as const
export const rivalSiteArt = (architecture: string) => {
  const known = (RIVAL_ARCHITECTURES as readonly string[]).includes(architecture)
    ? architecture
    : RIVAL_ARCHITECTURES[keyHash(architecture) % RIVAL_ARCHITECTURES.length]
  return `${BASE}/site/rival-${known}.webp`
}

/* ------------------------------------------------------------- cards */

export const UPGRADE_KEYS = [
  'repaired_desk', 'proper_lighting', 'case_management', 'legal_library', 'conference_room',
  'research_floor', 'executive_suite', 'secure_client_portal', 'deposition_studio',
  'e_discovery_suite', 'moot_court', 'trial_analytics_lab', 'media_response_room',
  'litigation_war_room', 'jury_simulator', 'branch_command', 'legal_airship',
  'ai_brief_foundry', 'national_litigation_grid', 'translation_cloud', 'satellite_docket',
  'global_crisis_center', 'vault_archive', 'treaty_chamber', 'prediction_engine',
  'autonomous_case_campus', 'supersonic_courier', 'oceanic_campus', 'digital_twin_court',
  'orbital_hearing_ring', 'precedent_supercomputer', 'lunar_embassy', 'chronicle_vault',
  'planetary_command', 'justice_constellation',
] as const

export const CONNECTION_KEYS = [
  'local_bar', 'business_network', 'board_network', 'international_network',
  'civic_referral_council', 'entertainment_circle', 'national_gc_council', 'diplomatic_forum',
  'global_exchange', 'sovereign_council', 'innovation_compact', 'oceanic_compact',
  'orbital_bar', 'interworld_assembly',
] as const

export const upgradeArt = (key: string) => {
  const known = (UPGRADE_KEYS as readonly string[]).includes(key)
    ? key
    : UPGRADE_KEYS[keyHash(key) % UPGRADE_KEYS.length]
  return `${BASE}/upgrade/${known}.webp`
}

export const connectionArt = (key: string) => {
  const known = (CONNECTION_KEYS as readonly string[]).includes(key)
    ? key
    : CONNECTION_KEYS[keyHash(key) % CONNECTION_KEYS.length]
  return `${BASE}/connection/${known}.webp`
}

/* ------------------------------------------------------------ people */

export const STAFF_KEYS = [
  'paralegal', 'junior_associate', 'office_manager', 'senior_associate', 'partner',
  'rainmaker', 'intake_specialist', 'private_investigator', 'litigation_technologist',
  'legal_nurse', 'trial_consultant', 'communications_director', 'appellate_counsel',
  'chief_operating_officer', 'cybersecurity_counsel', 'branch_director', 'economist',
  'international_arbitrator', 'diplomatic_liaison', 'crisis_commander', 'data_scientist',
  'sovereign_envoy', 'treaty_architect', 'automation_director', 'quantum_analyst',
  'oceanic_counsel', 'systems_advocate', 'orbital_counsel', 'lunar_envoy',
  'chief_justice_strategist',
] as const

export const staffArt = (key: string) => {
  const known = (STAFF_KEYS as readonly string[]).includes(key)
    ? key
    : STAFF_KEYS[keyHash(key) % STAFF_KEYS.length]
  return `${BASE}/staff/${known}.webp`
}

/** Deterministic full-body sprite for generic cast members (cutscene speakers,
    unknown people) drawn from the staff ensemble. */
export const castArt = (gender: CharacterGender, variant: number) =>
  `${BASE}/staff/${STAFF_KEYS[(keyHash(gender) + variant * 7) % STAFF_KEYS.length]}.webp`

export const CLIENT_KINDS = [
  'briefcase', 'home', 'store', 'gem', 'building', 'landmark', 'globe', 'civic',
  'hospitality', 'property', 'health', 'media', 'tech', 'sports', 'energy', 'sovereign',
  'bank', 'quantum', 'ocean', 'orbit', 'lunar', 'nexus',
] as const

export const clientArt = (kind: string) => {
  const known = (CLIENT_KINDS as readonly string[]).includes(kind)
    ? kind
    : CLIENT_KINDS[keyHash(kind) % CLIENT_KINDS.length]
  return `${BASE}/client/${known}.webp`
}

export const OWNER_KEYS = [
  'neighborhood_practice', 'downtown_boutique', 'regional_firm', 'national_competitor',
  'appellate_chambers', 'media_law_collective', 'transatlantic_firm', 'global_crisis_firm',
  'sovereign_rival', 'continental_rival', 'oceanic_rival', 'orbital_rival', 'lunar_rival',
  'planetary_rival',
] as const

export const ownerArt = (rivalKey: string) => {
  const known = (OWNER_KEYS as readonly string[]).includes(rivalKey)
    ? rivalKey
    : OWNER_KEYS[keyHash(rivalKey) % OWNER_KEYS.length]
  return `${BASE}/owner/${known}.webp`
}

/** Wardrobe stages: the player's look levels up with the firm. */
export const playerStage = (tier: number) => {
  const t = clampTier(tier)
  if (t >= 11) return 5
  if (t >= 8) return 4
  if (t >= 5) return 3
  if (t >= 3) return 2
  if (t >= 1) return 1
  return 0
}

export const playerArt = (gender: CharacterGender, tier: number) =>
  `${BASE}/player/${gender === 'male' ? 'male' : 'female'}-${playerStage(tier)}.webp`

export const judgeArt = (pleased: boolean) => `${BASE}/judge/${pleased ? 'pleased' : 'neutral'}.webp`
