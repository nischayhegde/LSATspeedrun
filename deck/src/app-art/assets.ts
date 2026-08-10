/* Manifest of the generated art set in /public/art. Every helper returns a
   stable URL for a key and falls back deterministically for unknown keys, so
   new backend catalog entries always render something sensible. */

const BASE = `${import.meta.env.BASE_URL}art`

const pad2 = (n: number) => String(Math.trunc(n)).padStart(2, '0')
const clampTier = (tier: number) => Math.max(0, Math.min(14, Math.round(tier)))

export function keyHash(key: string) {
  return [...key].reduce((total, character) => total + character.charCodeAt(0), 0)
}

/* ------------------------------------------------------------- cast
 *
 * One client is drawn twice: as the 2D-framed portrait on the contract card
 * (`ClientPortrait`, which is a `Bust` behind a plaque) and as the seated
 * figure in the 3D office. Both are the same procedural builder driven by a
 * palette seed, so they are the same person only for as long as both sides
 * seed from the same value — and they had drifted, because the card hashed
 * `icon:name` while the office hashed `session:clientKey`.
 *
 * The client's *name* is the one identifier both surfaces hold, and it is
 * unique per client in the catalog, so it is both the only workable choice and
 * a variety-preserving one. Seeding from the icon category or the client key
 * would put dozens of clients on one face, which is the regression this
 * deliberately avoids repeating.
 *
 * This lives here, rather than beside the character builder, because the
 * contract card must not pull three.js into the entry bundle to ask a question
 * about a string.
 */

/** The cast-identity string for one client, from its catalog name. */
export function clientCastIdentity(clientName: string) {
  return clientName
}

/** FNV-1a, matching the `castHash` the cast surfaces already hash identities
 *  with, so a seed computed here and one computed there agree exactly. */
export function clientCastSeed(clientName: string) {
  let hash = 2166136261
  for (const character of clientCastIdentity(clientName)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  }
  return hash >>> 0
}

/* ------------------------------------------------------------ scenes */

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

/* ---------------------------------------------------- opposing counsel */

export const OPPOSING_COUNSEL = [
  { key: 'vex', name: 'Sterling Vex', firm: 'Vale Legal' },
  { key: 'stone', name: 'Octavia Stone', firm: 'Blackstone Chambers' },
  { key: 'pike', name: 'Dorian Pike', firm: 'Harrow & Finch' },
  { key: 'frost', name: 'Camille Frost', firm: 'Meridian Atlantic' },
  { key: 'harrow_gus', name: 'Gus Harrow', firm: 'Northstar Law' },
] as const

export const counselFor = (seed: string) => OPPOSING_COUNSEL[keyHash(seed) % OPPOSING_COUNSEL.length]

/* ------------------------------------------------------- office events */

export const EVENT_SCENES = [
  'legal_aid', 'forged_deed', 'evidence_archive', 'cipher_room', 'market_terminal',
  'hospital_night', 'black_book', 'safe_corridor', 'jury_shadow', 'embassy_queue',
  'merger_table', 'ghost_fleet', 'island_forum', 'algorithm_city', 'storm_platform',
  'orbital_signal', 'lunar_claim', 'lunar_workers', 'constellation',
] as const

export const eventArt = (scene: string) => {
  const known = (EVENT_SCENES as readonly string[]).includes(scene)
    ? scene
    : EVENT_SCENES[keyHash(scene) % EVENT_SCENES.length]
  return `${BASE}/event/${known}.webp`
}
