import type { GameAsset } from '../types'

export type OfficeVisualZone =
  | 'desk' | 'lighting' | 'workstation' | 'library' | 'conference'
  | 'evidence' | 'simulation' | 'media' | 'operations' | 'mobility'
  | 'network' | 'archive' | 'jurisdiction' | 'campus' | 'prestige'
  | 'staff-floor' | 'relationship-wall' | 'acquisition-gallery' | 'decor'

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

  // Cosmetics share one zone but never merge into a staged installation: each
  // one is an individual authored prop in a reserved spot, so `stage` is only a
  // stable ordering hint for the inventory list.
  bar_certificate: visual('decor', 'Framed bar certificate', 'Front wall', 1),
  banker_lamp: visual('decor', 'Brass banker’s lamp', 'Partner desk', 2),
  persian_rug: visual('decor', 'Persian rug', 'Entry floor', 3),
  fig_tree: visual('decor', 'Potted fig tree', 'Window corner', 4),
  chesterfield: visual('decor', 'Leather chesterfield', 'Client reading corner', 5),
  reporter_wall: visual('decor', 'Bound reporter shelf', 'Front wall', 6),
  grandfather_clock: visual('decor', 'Grandfather clock', 'Front wall', 7),
  skyline_painting: visual('decor', 'Commissioned skyline painting', 'Conference-side wall', 8),
  trophy_shelf: visual('decor', 'Advocacy trophy shelf', 'Firm-floor wall', 9),
  justice_bust: visual('decor', 'Marble bust of Justice', 'Front wall plinth', 10),
  globe_bar: visual('decor', 'Antique globe bar', 'Front wall lounge', 11),
  stained_glass: visual('decor', 'Stained-glass panel', 'Window wall', 12),
  charter_vitrine: visual('decor', 'First-charter vitrine', 'Entry gallery', 13),
  orchid_wall: visual('decor', 'Living orchid wall', 'Entry wall', 14),

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
  /**
   * How far the department plan below opens out from the room's centre line,
   * and how far it reaches toward the window wall. One authored plan scaled by
   * two numbers, rather than six hand-placed plans: a shack and a planetary
   * command chamber seat the same departments in the same relative order, and
   * what changes between them is how much floor those departments are allowed
   * to take.
   */
  spread: number
  reach: number
}

/**
 * Adjacent office tiers deliberately reuse a proven floor plan. Upgrading an
 * office changes its finishes, density, lighting and centerpiece without
 * teleporting employees to arbitrary coordinates. New tiers can therefore be
 * added by selecting a layout family and layering their own environment data.
 */
export const OFFICE_LAYOUT_FAMILIES: readonly OfficeLayoutFamily[] = [
  { key: 'founding', tiers: [0, 1], spread: .52, reach: .62 },
  { key: 'neighborhood', tiers: [2, 3], spread: .66, reach: .74 },
  { key: 'executive', tiers: [4, 5, 6], spread: .80, reach: .85 },
  { key: 'diplomatic', tiers: [7, 8, 9], spread: .89, reach: .93 },
  { key: 'campus', tiers: [10, 11], spread: .95, reach: .97 },
  { key: 'frontier', tiers: [12, 13, 14], spread: 1, reach: 1 },
]

export type OfficeDepartmentBay = {
  station: OfficeStaffStation
  /** Where the department sits on the floor of the widest room, in world
   *  units, before the family's spread and reach scale it inward. */
  x: number
  z: number
  /** Which way the department faces: its occupants look along the bay's +z. */
  rotation: number
  /** Centre-to-centre spacing of neighbouring seats along the run. */
  seatPitch: number
  /**
   * Zero runs the seats in a straight line. A radius curves them onto a
   * crescent that opens toward the camera, which is how the two large
   * client-facing departments seat seven people without becoming a row.
   */
  crescent: number
  /** Seats this department can ever hold, which is how many roles name it. */
  capacity: number
  /**
   * How much of the low-headcount retreat this bay takes, from none to all.
   *
   * A half-empty floor is shot from closer in, and the bays have to come back
   * with the camera or they fall out of the bottom of the frame. A bay already
   * parked at the window has nowhere to go, though, and retreating it puts its
   * occupants inside the glazing — so the window rank barely moves and the
   * foreground bays do all the travelling.
   */
  retreat: number
  /**
   * How close to the room's centre line the bay may ever be pulled.
   *
   * `spread` closes the plan in as the tier falls, and one bay cannot be
   * allowed to follow it all the way: the reception pod sits beside the
   * partner desk, and at the bottom of the ladder that scaling walked it into
   * the desk lamp. It cannot simply be raised until the pod is clear of the
   * desk as well: three seats wide, the far one leaves the frame. The desk
   * moved instead.
   */
  minAbs?: number
  /**
   * Local z of the department's shared signature — its shelf, pinboard, cable
   * spine or plinth. Negative is behind the run. It is authored per bay
   * because a bay parked at the window has a wall a few centimetres behind it
   * and a bay in open floor has two metres.
   */
  signature: number
}

export type OfficeFloorKey = 'practice' | 'chambers'

export type OfficeFloor = {
  key: OfficeFloorKey
  /** What the lift button says. */
  ordinal: number
  name: string
  /** One line for the floor control, in the firm's own voice. */
  blurb: string
  /** The departments that work here. Nobody appears on two floors. */
  stations: readonly OfficeStaffStation[]
  /** Which installations are fitted out up here. */
  zones: readonly OfficeVisualZone[]
  plan: readonly OfficeDepartmentBay[]
}

/**
 * The working floor, composed for the camera.
 *
 * Two things decide these coordinates and neither of them is the shape of the
 * room. The first is the frustum: the opening camera looks into the front half
 * of the office from above and behind, so the floor it can actually see is a
 * trapezoid about four metres deep, measured at 8.9 metres either side of the
 * centre line at the window wall and closing to 5.7 by the time it reaches the
 * foreground, with the near edge cropping people's feet beyond z ≈ 0.7.
 * Anything placed by measuring inward from a side wall leaves that trapezoid
 * as soon as the room grows, which is the mistake this plan exists to avoid.
 *
 * The second is the room's own furniture. The window wall carries the library
 * runs, the reporter shelf, the fig tree, the clock and the reading sofa, and
 * the partner desk holds the middle at x 0.2 to 2.8. Those are the things a
 * player bought and they are not moving, so the staff go in front of them:
 * two staggered ranks with the glass and the shelves behind, which is also the
 * one arrangement that guarantees nobody is parked across the window.
 *
 * Sixteen people in two ranks would still be a call centre, so no two bays
 * share a depth, an angle or a run shape: casework cants one way, the
 * investigation bench sits half a metre deeper, the technology bench is bowed,
 * and reception is a pod turned to face the room.
 */
export const OFFICE_PRACTICE_PLAN: readonly OfficeDepartmentBay[] = [
  { station: 'casework', x: -5.25, z: -2, rotation: .1, seatPitch: 1, crescent: 0, capacity: 4, signature: -.92, retreat: .45 },
  { station: 'investigation', x: 5.6, z: -2.5, rotation: -.13, seatPitch: 1, crescent: 0, capacity: 4, signature: -.88, retreat: .45 },
  { station: 'technology', x: -3.6, z: -.5, rotation: .02, seatPitch: 1, crescent: 14, capacity: 5, signature: -1, retreat: 1 },
  { station: 'reception', x: 4.4, z: -.75, rotation: -.5, seatPitch: 1, crescent: 0, capacity: 3, signature: -.95, retreat: .5, minAbs: 4.2 },
]

/**
 * The chambers floor.
 *
 * Upstairs there is no bullpen and no partner desk in the middle, so the two
 * ceremonial departments get the one thing they could never have downstairs:
 * the centre of the room. The treaty horseshoe takes the glass, the executive
 * crescent takes the foreground, and the models and the operations table are
 * pushed out to the flanks where a boardroom would put them anyway.
 *
 * Both are crescents because fourteen people in two straight lines facing a
 * camera is a class photograph. `crescent` is a radius rather than a bulge, so
 * a large number is a gentle curve: thirteen metres opens seven seats toward
 * the lens while bringing the ends only forty centimetres forward of the
 * middle, which matters because the frame narrows fast as it comes toward the
 * camera and the near edge crops feet.
 */
export const OFFICE_CHAMBERS_PLAN: readonly OfficeDepartmentBay[] = [
  { station: 'diplomatic', x: -3.6, z: -2.9, rotation: 0, seatPitch: 1.05, crescent: 13, capacity: 7, signature: -.55, retreat: .2 },
  { station: 'leadership', x: -.1, z: .15, rotation: 0, seatPitch: .95, crescent: 12, capacity: 7, signature: -1.15, retreat: 1.6 },
]

/**
 * Two floors, and which half of the firm works on each.
 *
 * Thirty people in one room was ruled out on cost. Measured at tier fourteen
 * on a 1400x940 canvas, a person is expensive and it is the draw calls rather
 * than the triangles that hurt: the practice floor draws 292 calls and 53,000
 * triangles empty and 1,798 calls and 330,000 triangles with its sixteen in
 * it, which is about 94 calls and 17,000 triangles a head. Thirty in the same
 * room is therefore around 2,800 calls and 550,000 triangles, against 1,798
 * for the busier of the two floors — call it a third off the worst frame in
 * the game. Chambers is cheaper again at 1,228 calls and 249,000 triangles
 * for fourteen.
 *
 * Worth saying plainly: 1,798 calls is still a lot, and the split makes the
 * worst floor affordable rather than cheap. The next win here is batching a
 * seated body into fewer submissions, not moving people between floors.
 * (Numbers from `scripts/office-floor-capture.mjs`. Frame times on the
 * machine these were taken on are software-rastered and contended and are not
 * quoted for that reason; geometry counts are exact.)
 *
 * The other half of the argument is not arithmetic. The visible floor could
 * not seat thirty in front of the furniture without evicting the furniture,
 * so a single room would have had to choose between the staff a player hired
 * and the fittings a player bought.
 *
 * The seam is the firm's own: the people who do the work and meet the clients
 * are downstairs, and the people who sign and negotiate are upstairs. It is
 * also the seam the hire ladder already has, since every leadership and
 * diplomatic role is a later and dearer hire than every bullpen one, so the
 * upper floor is a thing the firm grows into rather than a thing it starts
 * with.
 */
export const OFFICE_FLOORS: readonly OfficeFloor[] = [
  {
    key: 'practice',
    ordinal: 1,
    name: 'Practice Floor',
    blurb: 'Intake, casework, investigation and systems.',
    stations: ['reception', 'casework', 'investigation', 'technology'],
    zones: ['desk', 'lighting', 'workstation', 'library', 'evidence', 'simulation', 'archive', 'mobility', 'staff-floor', 'decor'],
    plan: OFFICE_PRACTICE_PLAN,
  },
  {
    key: 'chambers',
    ordinal: 2,
    name: 'Chambers',
    blurb: 'Partners, crisis command and the treaty table.',
    stations: ['leadership', 'diplomatic'],
    zones: ['lighting', 'conference', 'media', 'operations', 'network', 'jurisdiction', 'campus', 'prestige', 'relationship-wall', 'acquisition-gallery', 'staff-floor', 'decor'],
    plan: OFFICE_CHAMBERS_PLAN,
  },
]

/**
 * The cosmetics, which are the one group whose home is a spot on a wall rather
 * than a zone, so they are split by hand. Downstairs keeps the things a
 * working office wears; upstairs keeps the ceremonial ones.
 */
const OFFICE_DECOR_FLOORS: Record<string, OfficeFloorKey> = {
  bar_certificate: 'practice',
  banker_lamp: 'practice',
  persian_rug: 'practice',
  fig_tree: 'practice',
  chesterfield: 'practice',
  reporter_wall: 'practice',
  grandfather_clock: 'practice',
  trophy_shelf: 'practice',
  stained_glass: 'practice',
  skyline_painting: 'chambers',
  justice_bust: 'chambers',
  globe_bar: 'chambers',
  charter_vitrine: 'chambers',
  orchid_wall: 'chambers',
}

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

/** A worn mark of the work, over and above the suit. Each one is a couple of
 *  small primitives on an existing joint; see `addInsignia`. */
export type OfficeStaffInsignia = 'none' | 'headset' | 'lanyard' | 'stole' | 'coat'

export type OfficeStaffLook = {
  /** The jacket. Authored per person, not rolled: this is the one cue that
   *  reads at office distance from any angle. */
  suit: number
  /** Which of the three authored haircuts, by silhouette: 0 side parting,
   *  1 cropped, 2 full. */
  hair: 0 | 1 | 2
  /** Overrides the seed's hair colour where age or seniority should show. */
  hairColor?: number
  eyewear: 'none' | 'round' | 'rectangular' | 'tortoiseshell'
  insignia: OfficeStaffInsignia
}

/**
 * Thirty people, designed rather than rolled.
 *
 * Every character in this cast is built by `buildStylizedCounsel`, which
 * derives skin, hair colour, height, build, face shape, stance and accessories
 * from a seed. That gives thirty *different* people and it does not give
 * thirty *designed* ones: a seed cannot know that the cybersecurity counsel
 * should be the one in graphite with a badge on, or that the treaty architect
 * wears a sash. So the four cues that read first at this distance — jacket
 * colour, hair silhouette, eyewear, and a worn mark of the job — are authored
 * here per role, and everything else stays seeded, which keeps the variation
 * the seed is good at without leaving the design to it.
 *
 * Colour is assigned by department first and by person second. A wing reads as
 * one team because its palette is one family, and nobody inside that wing is
 * mistakable for their neighbour because no two of the thirty share a jacket.
 */
export const OFFICE_STAFF_LOOKS = {
  // Front of house: warm, approachable, nothing severe.
  intake_specialist: { suit: 0xb98f63, hair: 0, eyewear: 'none', insignia: 'headset' },
  paralegal: { suit: 0x3f6b62, hair: 1, eyewear: 'rectangular', insignia: 'lanyard' },
  office_manager: { suit: 0x8c5a4a, hair: 2, eyewear: 'none', insignia: 'lanyard' },

  // The drafting bank: the classic associate register, plus one clinician.
  junior_associate: { suit: 0x2b4a6f, hair: 1, eyewear: 'none', insignia: 'none' },
  senior_associate: { suit: 0x1f3550, hair: 0, eyewear: 'rectangular', insignia: 'none' },
  legal_nurse: { suit: 0xd6d9d4, hair: 2, eyewear: 'none', insignia: 'coat' },
  appellate_counsel: { suit: 0x3a3f4a, hair: 0, hairColor: 0x9a9088, eyewear: 'tortoiseshell', insignia: 'none' },

  // Fieldwork: earth, wear, and no polish.
  private_investigator: { suit: 0x4a4536, hair: 1, eyewear: 'none', insignia: 'none' },
  trial_consultant: { suit: 0x5d3a3f, hair: 0, eyewear: 'round', insignia: 'none' },
  economist: { suit: 0x6b5a3c, hair: 2, hairColor: 0x8b8b8d, eyewear: 'tortoiseshell', insignia: 'none' },
  quantum_analyst: { suit: 0x2f4f4a, hair: 1, eyewear: 'rectangular', insignia: 'lanyard' },

  // The systems bench. Everyone here is badged, which is the point of a
  // department that holds the firm's credentials.
  litigation_technologist: { suit: 0x2c5560, hair: 1, eyewear: 'rectangular', insignia: 'lanyard' },
  cybersecurity_counsel: { suit: 0x24262c, hair: 1, eyewear: 'rectangular', insignia: 'lanyard' },
  data_scientist: { suit: 0x35406b, hair: 2, eyewear: 'round', insignia: 'lanyard' },
  automation_director: { suit: 0x1f4a52, hair: 0, eyewear: 'none', insignia: 'lanyard' },
  systems_advocate: { suit: 0x4a4f58, hair: 2, eyewear: 'tortoiseshell', insignia: 'lanyard' },

  // The crescent. The most formal wing, and the only one allowed near black.
  partner: { suit: 0x1b3857, hair: 0, eyewear: 'none', insignia: 'none' },
  rainmaker: { suit: 0x5b2f45, hair: 2, eyewear: 'none', insignia: 'none' },
  communications_director: { suit: 0x8a4a35, hair: 0, eyewear: 'none', insignia: 'headset' },
  chief_operating_officer: { suit: 0x30455e, hair: 1, eyewear: 'rectangular', insignia: 'none' },
  branch_director: { suit: 0x3d5148, hair: 0, eyewear: 'none', insignia: 'none' },
  crisis_commander: { suit: 0x6b2f2f, hair: 1, eyewear: 'none', insignia: 'headset' },
  chief_justice_strategist: { suit: 0x141a26, hair: 0, hairColor: 0xb4aea6, eyewear: 'none', insignia: 'stole' },

  // The horseshoe. Ceremonial, and the only wing that wears the sash.
  international_arbitrator: { suit: 0x2f5148, hair: 2, eyewear: 'none', insignia: 'stole' },
  diplomatic_liaison: { suit: 0x3c4a6b, hair: 0, eyewear: 'none', insignia: 'headset' },
  sovereign_envoy: { suit: 0x6b4a2f, hair: 0, eyewear: 'none', insignia: 'stole' },
  treaty_architect: { suit: 0x44405c, hair: 1, eyewear: 'round', insignia: 'stole' },
  oceanic_counsel: { suit: 0x1f5a6b, hair: 2, eyewear: 'none', insignia: 'stole' },
  orbital_counsel: { suit: 0x53575e, hair: 1, eyewear: 'rectangular', insignia: 'stole' },
  lunar_envoy: { suit: 0x6e6a63, hair: 0, hairColor: 0xab8f5c, eyewear: 'none', insignia: 'stole' },
} satisfies Record<string, OfficeStaffLook>

/**
 * Every role the firm can hire, in the order the catalog lets a player hire
 * it, which is by headquarters tier and then by price.
 *
 * This is the same set of keys as `OFFICE_STAFF_STATIONS` and the same set the
 * backend's `STAFF` catalog sells; `officeRosterIsComplete` below asserts the
 * first of those, and the office harness checks its own copy against this one.
 * The order matters because `staffOnShift` is derived from it: a tier's
 * capacity is exactly the number of people who can have been hired by then.
 */
export const OFFICE_HIRE_ORDER = [
  'intake_specialist',
  'paralegal', 'junior_associate',
  'office_manager', 'private_investigator', 'litigation_technologist',
  'senior_associate', 'legal_nurse', 'trial_consultant',
  'partner', 'communications_director', 'appellate_counsel',
  'rainmaker', 'chief_operating_officer', 'cybersecurity_counsel',
  'branch_director', 'economist',
  'international_arbitrator', 'diplomatic_liaison',
  'crisis_commander', 'data_scientist',
  'sovereign_envoy', 'treaty_architect',
  'automation_director', 'quantum_analyst',
  'oceanic_counsel', 'systems_advocate',
  'orbital_counsel',
  'lunar_envoy',
  'chief_justice_strategist',
] as const

/**
 * Capacity is the whole firm, not a rota.
 *
 * `staffOnShift` used to cap at five from tier eight up, so a player who had
 * hired twenty-one people saw five of them and found the rest as studs on a
 * board bolted to the side wall. The number below is instead exactly how many
 * people can have been hired by that tier — the running total of
 * `OFFICE_HIRE_ORDER` against the catalog's tier gates — so a fully upgraded
 * office holds its entire roster and every earlier office grows into the one
 * above it. Nobody is ever hired and then left off the floor.
 */
export const OFFICE_ENVIRONMENTS: readonly OfficeEnvironment[] = [
  { tier: 0, name: 'Wooden Shack', identity: 'A weathered one-room practice with a working hearth, joined timber furniture, files, and the tools of a first case.', centerpiece: 'desk', furnishingDensity: 2, staffOnShift: 1, finish: 'rustic' },
  { tier: 1, name: 'Shared Office', identity: 'A repaired heritage office with an intake corner, fitted storage, proper lighting, and two working desks.', centerpiece: 'conference', furnishingDensity: 4, staffOnShift: 3, finish: 'heritage' },
  { tier: 2, name: 'Neighborhood Firm', identity: 'A complete storefront firm with a community hearing nook, research wall, client seating, and staffed workstations.', centerpiece: 'library', furnishingDensity: 6, staffOnShift: 6, finish: 'professional' },
  { tier: 3, name: 'Downtown Firm', identity: 'An art-deco litigation suite with a strategy floor, deposition bay, conference table, and evidence display.', centerpiece: 'evidence', furnishingDensity: 8, staffOnShift: 9, finish: 'professional' },
  { tier: 4, name: 'City Power Firm', identity: 'A lavish executive practice organized around a jury theater, partner suite, media bay, and city-facing client salon.', centerpiece: 'simulation', furnishingDensity: 10, staffOnShift: 12, finish: 'executive' },
  { tier: 5, name: 'Regional Headquarters', identity: 'A waterfront command office with regional operations, a branch table, travel display, and multiple staffed departments.', centerpiece: 'operations', furnishingDensity: 11, staffOnShift: 15, finish: 'executive' },
  { tier: 6, name: 'National Firm', identity: 'A national litigation floor with a live jurisdiction grid, research foundry, briefing areas, and integrated evidence systems.', centerpiece: 'network', furnishingDensity: 12, staffOnShift: 17, finish: 'executive' },
  { tier: 7, name: 'International Practice', identity: 'A diplomatic legal salon with translation systems, international briefing tables, cultural archives, and secure communications.', centerpiece: 'network', furnishingDensity: 13, staffOnShift: 19, finish: 'international' },
  { tier: 8, name: 'Global Legal Empire', identity: 'A twenty-four-hour crisis headquarters with a command table, precedent archive, media response bay, and global staff floor.', centerpiece: 'operations', furnishingDensity: 14, staffOnShift: 21, finish: 'international' },
  { tier: 9, name: 'Sovereign Counsel Tower', identity: 'A formal treaty chamber with a living jurisdiction model, sovereign gallery, sealed archive, and ceremonial conference suite.', centerpiece: 'jurisdiction', furnishingDensity: 15, staffOnShift: 23, finish: 'international' },
  { tier: 10, name: 'Continental Justice Campus', identity: 'A campus command suite overlooking autonomous research, infrastructure models, simulation walls, and continental operations.', centerpiece: 'campus', furnishingDensity: 16, staffOnShift: 25, finish: 'frontier' },
  { tier: 11, name: 'Oceanic Law Citadel', identity: 'A luminous floating forum with maritime charts, arbitration seating, climate systems, and a fully furnished oceanic practice.', centerpiece: 'campus', furnishingDensity: 17, staffOnShift: 27, finish: 'frontier' },
  { tier: 12, name: 'Orbital Arbitration Ring', identity: 'An orbital hearing suite with restrained aerospace materials, a zero-gravity jurisdiction model, and Earth-facing counsel stations.', centerpiece: 'jurisdiction', furnishingDensity: 18, staffOnShift: 28, finish: 'frontier' },
  { tier: 13, name: 'Lunar Embassy of Law', identity: 'A lunar diplomatic residence with a treaty vault, embassy salon, chronicle archive, and fully appointed interworld chambers.', centerpiece: 'archive', furnishingDensity: 19, staffOnShift: 29, finish: 'frontier' },
  { tier: 14, name: 'Planetary Justice Nexus', identity: 'A complete planetary command chamber where the justice constellation, global operations, archives, and counsel network converge.', centerpiece: 'prestige', furnishingDensity: 20, staffOnShift: 30, finish: 'frontier' },
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

const FALLBACK_STAFF_LOOK: OfficeStaffLook = { suit: 0x39506b, hair: 0, eyewear: 'none', insignia: 'none' }

export function officeStaffLookFor(key: string): OfficeStaffLook {
  return OFFICE_STAFF_LOOKS[key as keyof typeof OFFICE_STAFF_LOOKS] ?? FALLBACK_STAFF_LOOK
}

export function officeFloorFor(key: OfficeFloorKey): OfficeFloor {
  return OFFICE_FLOORS.find((floor) => floor.key === key) ?? OFFICE_FLOORS[0]
}

/** Which floor a member of staff works on, by their department. */
export function officeFloorForStaff(key: string): OfficeFloorKey {
  const station = officeStaffStationFor(key)
  return OFFICE_FLOORS.find((floor) => floor.stations.includes(station))?.key ?? 'practice'
}

/**
 * Whether a purchase is fitted out on a given floor. Installations follow
 * their zone; cosmetics are placed by hand because their home is an authored
 * spot on a particular wall.
 */
export function officeAssetOnFloor(key: string, floor: OfficeFloorKey): boolean {
  const visual = officeVisualFor(key)
  if (!visual) return false
  if (visual.zone === 'staff-floor') return officeFloorForStaff(key) === floor
  if (visual.zone === 'decor') return (OFFICE_DECOR_FLOORS[key] ?? 'practice') === floor
  return officeFloorFor(floor).zones.includes(visual.zone)
}

/**
 * How many of a tier's shift work on each floor.
 *
 * Capacity is still the whole firm; this only says where they sit. The upper
 * floor stays dark until the firm hires its first partner, which the ladder
 * puts at the tenth hire, so an early office is one floor and one button.
 */
export function officeFloorHeadcount(tier: number): Record<OfficeFloorKey, number> {
  const shift = officeEnvironmentFor(tier).staffOnShift
  const hired = OFFICE_HIRE_ORDER.slice(0, shift)
  return {
    practice: hired.filter((key) => officeFloorForStaff(key) === 'practice').length,
    chambers: hired.filter((key) => officeFloorForStaff(key) === 'chambers').length,
  }
}

/**
 * The department bays for a tier and a floor, scaled by that tier's layout
 * family.
 *
 * `spread` closes the plan toward the room's centre line and `reach` pulls it
 * back from the window wall, so a shack seats its one hire where the camera
 * already is rather than in an unlit corner three metres away, and the top
 * tiers open out to the authored plan. Capacity is clamped to what the room is
 * wide enough to hold, which only ever binds at the bottom of the ladder.
 */
export function officeDepartmentPlanFor(tier: number, floor: OfficeFloorKey = 'practice'): OfficeDepartmentBay[] {
  const family = officeLayoutFor(tier)
  return officeFloorFor(floor).plan.map((bay) => ({
    ...bay,
    x: Math.sign(bay.x || 1) * Math.max(Math.abs(bay.x) * family.spread, bay.minAbs ?? 0),
    // Depth is authored, not scaled. The room grows sideways with tier and
    // never front-to-back — the glazing is at z -3.7 in a shack and in a
    // planetary command chamber alike — so scaling z by tier only squeezed the
    // gaps between the ranks until, at the neighbourhood office, the casework
    // bench and the technology bench were 0.5m apart and sitting in each
    // other. `reach` survives for the furniture that genuinely does step back
    // from the window with tier.
    z: bay.z,
    // A tighter plan wants its seats closer together, or a four-seat bench in
    // the founding office runs straight through the wall it is parked against.
    seatPitch: bay.seatPitch * (.86 + family.spread * .14),
    crescent: bay.crescent * family.spread,
  }))
}

/**
 * Guards the one invariant that has actually broken here: a role gains a
 * workstation in `OFFICE_STAFF_STATIONS` but no design, or the reverse, and
 * the office silently seats a stranger in the fallback jacket. Cheap enough to
 * run at module load, and it fails loudly in development rather than shipping
 * a floor with a duplicate on it.
 */
export function officeRosterIsComplete() {
  const stations = Object.keys(OFFICE_STAFF_STATIONS)
  const looks = Object.keys(OFFICE_STAFF_LOOKS)
  const missingLook = stations.filter((key) => !looks.includes(key))
  const missingStation = looks.filter((key) => !stations.includes(key))
  const missingOrder = stations.filter((key) => !OFFICE_HIRE_ORDER.includes(key as never))
  const suits = Object.values(OFFICE_STAFF_LOOKS).map((look) => look.suit)
  const duplicateSuits = suits.filter((suit, index) => suits.indexOf(suit) !== index)
  // A department with no floor seats nobody; a department on two floors seats
  // the same people twice. Both are silent at runtime and obvious here.
  const allStations: OfficeStaffStation[] = ['reception', 'casework', 'investigation', 'technology', 'leadership', 'diplomatic']
  const homelessStations = allStations.filter(
    (station) => OFFICE_FLOORS.filter((floor) => floor.stations.includes(station)).length !== 1,
  )
  // Every floor must be able to seat the departments assigned to it.
  const shortBays = OFFICE_FLOORS.flatMap((floor) => floor.stations
    .filter((station) => {
      const bay = floor.plan.find((entry) => entry.station === station)
      const roles = stations.filter((key) => officeStaffStationFor(key) === station).length
      return !bay || bay.capacity < roles
    })
    .map((station) => `${floor.key}:${station}`))
  const unplacedDecor = Object.keys(OFFICE_ASSET_MANIFEST)
    .filter((key) => officeVisualFor(key).zone === 'decor')
    .filter((key) => !OFFICE_FLOORS.some((floor) => officeAssetOnFloor(key, floor.key)))
  return { missingLook, missingStation, missingOrder, duplicateSuits, homelessStations, shortBays, unplacedDecor }
}

if (import.meta.env.DEV) {
  const faults = Object.entries(officeRosterIsComplete()).filter(([, keys]) => keys.length)
  for (const [fault, keys] of faults) console.error(`office roster: ${fault} — ${keys.join(', ')}`)
}

export function ownedOfficeAssets(assets: GameAsset[]) {
  return assets.filter((asset) => asset.owned && officeVisualFor(asset.key))
}
