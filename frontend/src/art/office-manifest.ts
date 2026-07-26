import type { GameAsset } from '../types'

export type OfficeVisualZone =
  | 'desk' | 'lighting' | 'workstation' | 'library' | 'conference'
  | 'evidence' | 'simulation' | 'media' | 'operations' | 'mobility'
  | 'network' | 'archive' | 'jurisdiction' | 'campus' | 'prestige'
  | 'staff-floor' | 'relationship-wall' | 'acquisition-gallery'

export type OfficeAssetVisual = {
  zone: OfficeVisualZone
  label: string
  location: string
  stage: number
}

const visual = (zone: OfficeVisualZone, label: string, location: string, stage: number): OfficeAssetVisual => ({ zone, label, location, stage })

/**
 * Every purchasable catalog key has an intentional office destination. Later
 * assets advance a coherent installation instead of adding disconnected props.
 */
export const OFFICE_ASSET_MANIFEST = {
  repaired_desk: visual('desk', 'Restored partner desk', 'Partner workspace', 1),
  proper_lighting: visual('lighting', 'Professional task lighting', 'Ceiling and desk lighting', 1),
  case_management: visual('workstation', 'Case-management terminal', 'Partner workstation', 1),
  legal_library: visual('library', 'Working legal library', 'Research wall', 1),
  secure_client_portal: visual('workstation', 'Secure client portal', 'Partner workstation', 2),
  deposition_studio: visual('conference', 'Deposition recording studio', 'Client conference area', 1),
  conference_room: visual('conference', 'Client conference suite', 'Client conference area', 2),
  e_discovery_suite: visual('evidence', 'E-discovery evidence wall', 'Evidence wall', 1),
  moot_court: visual('simulation', 'Moot courtroom', 'Advocacy studio', 1),
  research_floor: visual('library', 'Research floor collection', 'Research wall', 2),
  trial_analytics_lab: visual('evidence', 'Trial analytics display', 'Evidence wall', 2),
  media_response_room: visual('media', 'Media response studio', 'Communications bay', 1),
  executive_suite: visual('desk', 'Executive partner suite', 'Partner workspace', 2),
  litigation_war_room: visual('operations', 'Litigation war room', 'Operations table', 1),
  jury_simulator: visual('simulation', 'Predictive jury theater', 'Advocacy studio', 2),
  branch_command: visual('operations', 'Branch command center', 'Operations table', 2),
  legal_airship: visual('mobility', 'Counsel airship model', 'Mobility display', 1),
  ai_brief_foundry: visual('workstation', 'AI brief foundry', 'Partner workstation', 3),
  national_litigation_grid: visual('network', 'National litigation grid', 'Jurisdiction network wall', 1),
  translation_cloud: visual('network', 'Live translation cloud', 'Jurisdiction network wall', 2),
  satellite_docket: visual('network', 'Satellite docket array', 'Jurisdiction network wall', 3),
  global_crisis_center: visual('operations', 'Global crisis command', 'Operations table', 3),
  vault_archive: visual('archive', 'Subterranean precedent vault', 'Archive portal', 1),
  treaty_chamber: visual('jurisdiction', 'Holographic treaty chamber', 'Jurisdiction model', 1),
  prediction_engine: visual('evidence', 'Precedent prediction engine', 'Evidence wall', 3),
  autonomous_case_campus: visual('campus', 'Autonomous case campus', 'Headquarters model', 1),
  supersonic_courier: visual('mobility', 'Supersonic counsel shuttle', 'Mobility display', 2),
  oceanic_campus: visual('campus', 'Floating arbitration forum', 'Headquarters model', 2),
  digital_twin_court: visual('simulation', 'Digital-twin courtroom', 'Advocacy studio', 3),
  orbital_hearing_ring: visual('jurisdiction', 'Zero-gravity hearing ring', 'Jurisdiction model', 2),
  precedent_supercomputer: visual('workstation', 'Precedent supercomputer', 'Partner workstation', 4),
  lunar_embassy: visual('jurisdiction', 'Lunar treaty embassy', 'Jurisdiction model', 3),
  chronicle_vault: visual('archive', 'Civilization chronicle vault', 'Archive portal', 2),
  planetary_command: visual('operations', 'Planetary justice command', 'Operations table', 4),
  justice_constellation: visual('prestige', 'Justice constellation', 'Legacy installation', 1),

  paralegal: visual('staff-floor', 'Maya’s active desk', 'Firm floor', 1),
  junior_associate: visual('staff-floor', 'Theo’s active desk', 'Firm floor', 2),
  office_manager: visual('staff-floor', 'Nina’s operations desk', 'Firm floor', 3),
  senior_associate: visual('staff-floor', 'Avery’s case station', 'Firm floor', 4),
  partner: visual('staff-floor', 'Jordan’s partner station', 'Firm floor', 5),
  rainmaker: visual('staff-floor', 'Morgan’s client station', 'Firm floor', 6),
  intake_specialist: visual('staff-floor', 'Iris’s intake station', 'Firm floor', 7),
  private_investigator: visual('staff-floor', 'Darius’s investigation station', 'Firm floor', 8),
  litigation_technologist: visual('staff-floor', 'Sora’s technology station', 'Firm floor', 9),
  legal_nurse: visual('staff-floor', 'Amara’s records station', 'Firm floor', 10),
  trial_consultant: visual('staff-floor', 'Mateo’s strategy station', 'Firm floor', 11),
  communications_director: visual('staff-floor', 'Zuri’s communications station', 'Firm floor', 12),
  appellate_counsel: visual('staff-floor', 'Noah’s appellate station', 'Firm floor', 13),
  chief_operating_officer: visual('staff-floor', 'Leila’s operations station', 'Firm floor', 14),
  cybersecurity_counsel: visual('staff-floor', 'Kenji’s security station', 'Firm floor', 15),
  branch_director: visual('staff-floor', 'Elena’s branch station', 'Firm floor', 16),
  economist: visual('staff-floor', 'Caleb’s economics station', 'Firm floor', 17),
  international_arbitrator: visual('staff-floor', 'Nadia’s arbitration station', 'Firm floor', 18),
  diplomatic_liaison: visual('staff-floor', 'Tomas’s diplomatic station', 'Firm floor', 19),
  crisis_commander: visual('staff-floor', 'Rin’s crisis station', 'Firm floor', 20),
  data_scientist: visual('staff-floor', 'Omar’s data station', 'Firm floor', 21),
  sovereign_envoy: visual('staff-floor', 'Anika’s sovereign station', 'Firm floor', 22),
  treaty_architect: visual('staff-floor', 'Gabriel’s treaty station', 'Firm floor', 23),
  automation_director: visual('staff-floor', 'Mei’s automation station', 'Firm floor', 24),
  quantum_analyst: visual('staff-floor', 'Idris’s evidence station', 'Firm floor', 25),
  oceanic_counsel: visual('staff-floor', 'Marisol’s oceanic station', 'Firm floor', 26),
  systems_advocate: visual('staff-floor', 'Vik’s systems station', 'Firm floor', 27),
  orbital_counsel: visual('staff-floor', 'Asha’s orbital station', 'Firm floor', 28),
  lunar_envoy: visual('staff-floor', 'Sol’s lunar station', 'Firm floor', 29),
  chief_justice_strategist: visual('staff-floor', 'Nova’s strategy station', 'Firm floor', 30),

  local_bar: visual('relationship-wall', 'Local bar seal', 'Relationship wall', 1),
  business_network: visual('relationship-wall', 'Business network seal', 'Relationship wall', 2),
  board_network: visual('relationship-wall', 'Corporate board seal', 'Relationship wall', 3),
  international_network: visual('relationship-wall', 'International network seal', 'Relationship wall', 4),
  civic_referral_council: visual('relationship-wall', 'Civic referral seal', 'Relationship wall', 5),
  entertainment_circle: visual('relationship-wall', 'Entertainment circle seal', 'Relationship wall', 6),
  national_gc_council: visual('relationship-wall', 'National GC seal', 'Relationship wall', 7),
  diplomatic_forum: visual('relationship-wall', 'Diplomatic forum seal', 'Relationship wall', 8),
  global_exchange: visual('relationship-wall', 'Global exchange seal', 'Relationship wall', 9),
  sovereign_council: visual('relationship-wall', 'Sovereign council seal', 'Relationship wall', 10),
  innovation_compact: visual('relationship-wall', 'Innovation compact seal', 'Relationship wall', 11),
  oceanic_compact: visual('relationship-wall', 'Oceanic compact seal', 'Relationship wall', 12),
  orbital_bar: visual('relationship-wall', 'Orbital bar seal', 'Relationship wall', 13),
  interworld_assembly: visual('relationship-wall', 'Interworld assembly seal', 'Relationship wall', 14),

  neighborhood_practice: visual('acquisition-gallery', 'Harrow & Finch plaque', 'Acquisition gallery', 1),
  downtown_boutique: visual('acquisition-gallery', 'Vale Legal plaque', 'Acquisition gallery', 2),
  regional_firm: visual('acquisition-gallery', 'Northstar Law plaque', 'Acquisition gallery', 3),
  national_competitor: visual('acquisition-gallery', 'Sterling Global plaque', 'Acquisition gallery', 4),
  appellate_chambers: visual('acquisition-gallery', 'Blackstone Chambers plaque', 'Acquisition gallery', 5),
  media_law_collective: visual('acquisition-gallery', 'Neon & Gold plaque', 'Acquisition gallery', 6),
  transatlantic_firm: visual('acquisition-gallery', 'Meridian Atlantic plaque', 'Acquisition gallery', 7),
  global_crisis_firm: visual('acquisition-gallery', 'Redline Counsel plaque', 'Acquisition gallery', 8),
  sovereign_rival: visual('acquisition-gallery', 'Crown Meridian plaque', 'Acquisition gallery', 9),
  continental_rival: visual('acquisition-gallery', 'Atlas Juris plaque', 'Acquisition gallery', 10),
  oceanic_rival: visual('acquisition-gallery', 'Pelagic Partners plaque', 'Acquisition gallery', 11),
  orbital_rival: visual('acquisition-gallery', 'Zenith Orbital plaque', 'Acquisition gallery', 12),
  lunar_rival: visual('acquisition-gallery', 'Selene Accord plaque', 'Acquisition gallery', 13),
  planetary_rival: visual('acquisition-gallery', 'Apex Justice Network plaque', 'Acquisition gallery', 14),
} satisfies Record<string, OfficeAssetVisual>

export type OfficeEnvironment = {
  tier: number
  name: string
  identity: string
  centerpiece: OfficeVisualZone
  furnishingDensity: number
  staffOnShift: number
  finish: 'rustic' | 'heritage' | 'professional' | 'executive' | 'international' | 'frontier'
}

export type OfficeStaffStation = 'reception' | 'casework' | 'investigation' | 'technology' | 'leadership' | 'diplomatic'

export type OfficeLayoutFamilyKey = 'founding' | 'neighborhood' | 'executive' | 'diplomatic' | 'campus' | 'frontier'

export type OfficeLayoutFamily = {
  key: OfficeLayoutFamilyKey
  tiers: readonly number[]
  stationInset: number
  stationRows: readonly [number, number, number]
  stationCant: readonly [number, number, number]
}

/**
 * Adjacent office tiers deliberately reuse a proven floor plan. Upgrading an
 * office changes its finishes, density, lighting and centerpiece without
 * teleporting employees to arbitrary coordinates. New tiers can therefore be
 * added by selecting a layout family and layering their own environment data.
 */
export const OFFICE_LAYOUT_FAMILIES: readonly OfficeLayoutFamily[] = [
  { key: 'founding', tiers: [0, 1], stationInset: 2.0, stationRows: [.82, -.78, -2.38], stationCant: [.1, .06, .03] },
  { key: 'neighborhood', tiers: [2, 3], stationInset: 2.2, stationRows: [.92, -.72, -2.42], stationCant: [.08, .05, .03] },
  { key: 'executive', tiers: [4, 5, 6], stationInset: 2.35, stationRows: [1.05, -.62, -2.48], stationCant: [.06, .035, .02] },
  { key: 'diplomatic', tiers: [7, 8, 9], stationInset: 2.42, stationRows: [1.18, -.5, -2.32], stationCant: [.11, .055, .025] },
  { key: 'campus', tiers: [10, 11], stationInset: 2.5, stationRows: [1.22, -.55, -2.52], stationCant: [.07, .04, .018] },
  { key: 'frontier', tiers: [12, 13, 14], stationInset: 2.58, stationRows: [1.28, -.42, -2.42], stationCant: [.055, .03, .015] },
]

/**
 * Staff are placed by function, never by an arbitrary open coordinate. The
 * active-shift renderer uses these departments to choose both furniture and a
 * reserved bay in the office plan.
 */
export const OFFICE_STAFF_STATIONS = {
  paralegal: 'reception',
  office_manager: 'reception',
  intake_specialist: 'reception',

  junior_associate: 'casework',
  senior_associate: 'casework',
  legal_nurse: 'casework',
  appellate_counsel: 'casework',

  private_investigator: 'investigation',
  trial_consultant: 'investigation',
  economist: 'investigation',
  quantum_analyst: 'investigation',

  litigation_technologist: 'technology',
  cybersecurity_counsel: 'technology',
  data_scientist: 'technology',
  automation_director: 'technology',
  systems_advocate: 'technology',

  partner: 'leadership',
  rainmaker: 'leadership',
  communications_director: 'leadership',
  chief_operating_officer: 'leadership',
  branch_director: 'leadership',
  crisis_commander: 'leadership',
  chief_justice_strategist: 'leadership',

  international_arbitrator: 'diplomatic',
  diplomatic_liaison: 'diplomatic',
  sovereign_envoy: 'diplomatic',
  treaty_architect: 'diplomatic',
  oceanic_counsel: 'diplomatic',
  orbital_counsel: 'diplomatic',
  lunar_envoy: 'diplomatic',
} satisfies Record<string, OfficeStaffStation>

export const OFFICE_ENVIRONMENTS: readonly OfficeEnvironment[] = [
  { tier: 0, name: 'Wooden Shack', identity: 'A weathered one-room practice with a working hearth, joined timber furniture, files, and the tools of a first case.', centerpiece: 'desk', furnishingDensity: 2, staffOnShift: 1, finish: 'rustic' },
  { tier: 1, name: 'Shared Office', identity: 'A repaired heritage office with an intake corner, fitted storage, proper lighting, and two working desks.', centerpiece: 'conference', furnishingDensity: 4, staffOnShift: 2, finish: 'heritage' },
  { tier: 2, name: 'Neighborhood Firm', identity: 'A complete storefront firm with a community hearing nook, research wall, client seating, and staffed workstations.', centerpiece: 'library', furnishingDensity: 6, staffOnShift: 3, finish: 'professional' },
  { tier: 3, name: 'Downtown Firm', identity: 'An art-deco litigation suite with a strategy floor, deposition bay, conference table, and evidence display.', centerpiece: 'evidence', furnishingDensity: 8, staffOnShift: 3, finish: 'professional' },
  { tier: 4, name: 'City Power Firm', identity: 'A lavish executive practice organized around a jury theater, partner suite, media bay, and city-facing client salon.', centerpiece: 'simulation', furnishingDensity: 10, staffOnShift: 4, finish: 'executive' },
  { tier: 5, name: 'Regional Headquarters', identity: 'A waterfront command office with regional operations, a branch table, travel display, and multiple staffed departments.', centerpiece: 'operations', furnishingDensity: 11, staffOnShift: 4, finish: 'executive' },
  { tier: 6, name: 'National Firm', identity: 'A national litigation floor with a live jurisdiction grid, research foundry, briefing areas, and integrated evidence systems.', centerpiece: 'network', furnishingDensity: 12, staffOnShift: 4, finish: 'executive' },
  { tier: 7, name: 'International Practice', identity: 'A diplomatic legal salon with translation systems, international briefing tables, cultural archives, and secure communications.', centerpiece: 'network', furnishingDensity: 13, staffOnShift: 4, finish: 'international' },
  { tier: 8, name: 'Global Legal Empire', identity: 'A twenty-four-hour crisis headquarters with a command table, precedent archive, media response bay, and global staff floor.', centerpiece: 'operations', furnishingDensity: 14, staffOnShift: 5, finish: 'international' },
  { tier: 9, name: 'Sovereign Counsel Tower', identity: 'A formal treaty chamber with a living jurisdiction model, sovereign gallery, sealed archive, and ceremonial conference suite.', centerpiece: 'jurisdiction', furnishingDensity: 15, staffOnShift: 5, finish: 'international' },
  { tier: 10, name: 'Continental Justice Campus', identity: 'A campus command suite overlooking autonomous research, infrastructure models, simulation walls, and continental operations.', centerpiece: 'campus', furnishingDensity: 16, staffOnShift: 5, finish: 'frontier' },
  { tier: 11, name: 'Oceanic Law Citadel', identity: 'A luminous floating forum with maritime charts, arbitration seating, climate systems, and a fully furnished oceanic practice.', centerpiece: 'campus', furnishingDensity: 17, staffOnShift: 5, finish: 'frontier' },
  { tier: 12, name: 'Orbital Arbitration Ring', identity: 'An orbital hearing suite with restrained aerospace materials, a zero-gravity jurisdiction model, and Earth-facing counsel stations.', centerpiece: 'jurisdiction', furnishingDensity: 18, staffOnShift: 5, finish: 'frontier' },
  { tier: 13, name: 'Lunar Embassy of Law', identity: 'A lunar diplomatic residence with a treaty vault, embassy salon, chronicle archive, and fully appointed interworld chambers.', centerpiece: 'archive', furnishingDensity: 19, staffOnShift: 5, finish: 'frontier' },
  { tier: 14, name: 'Planetary Justice Nexus', identity: 'A complete planetary command chamber where the justice constellation, global operations, archives, and counsel network converge.', centerpiece: 'prestige', furnishingDensity: 20, staffOnShift: 5, finish: 'frontier' },
]

export function officeVisualFor(key: string) {
  return OFFICE_ASSET_MANIFEST[key as keyof typeof OFFICE_ASSET_MANIFEST]
}

export function officeEnvironmentFor(tier: number) {
  return OFFICE_ENVIRONMENTS[Math.max(0, Math.min(OFFICE_ENVIRONMENTS.length - 1, Math.round(tier)))]
}

export function officeStaffStationFor(key: string): OfficeStaffStation {
  return OFFICE_STAFF_STATIONS[key as keyof typeof OFFICE_STAFF_STATIONS] ?? 'casework'
}

export function officeLayoutFor(tier: number): OfficeLayoutFamily {
  const normalizedTier = Math.max(0, Math.min(14, Math.round(tier)))
  return OFFICE_LAYOUT_FAMILIES.find((family) => family.tiers.includes(normalizedTier)) ?? OFFICE_LAYOUT_FAMILIES[0]
}

export function ownedOfficeAssets(assets: GameAsset[]) {
  return assets.filter((asset) => asset.owned && officeVisualFor(asset.key))
}
