/**
 * Fabricated game state for the deck.
 *
 * The deck has no backend and no save, but the ported art modules were written
 * against the API's payloads: the office builds itself from a list of owned
 * `GameAsset`s, and the map builds itself from a list of `MapScenePoint`s. So
 * the deck manufactures both, from the same real keys and the same real firm
 * tiers the app ships, rather than from invented ones. Anything a slide shows
 * is a thing the game actually has.
 */

import type { ActiveOfficeCase, FirmTier, GameAsset } from '../app-art/types'
import type { MapRegionKey, MapScenePoint, MapSceneEvent, MapSceneRival, MapSceneTier } from '../app-art/map-three-scene'
import { OFFICE_ASSET_MANIFEST, OFFICE_HIRE_ORDER } from '../app-art/office-manifest'

const STAFF_KEYS = new Set<string>(OFFICE_HIRE_ORDER)

/** The catalog category a manifest key belongs to, read off its office zone. */
function assetTypeFor(key: string): GameAsset['type'] {
  if (STAFF_KEYS.has(key)) return 'staff'
  const zone = OFFICE_ASSET_MANIFEST[key as keyof typeof OFFICE_ASSET_MANIFEST]?.zone
  if (zone === 'decor') return 'cosmetic'
  if (zone === 'relationship-wall') return 'connection'
  if (zone === 'acquisition-gallery') return 'rival'
  return 'upgrade'
}

/** A fabricated owned asset, shaped like the API's `GameAsset`. */
export function syntheticAsset(key: string, type: string, index: number): GameAsset {
  const visual = OFFICE_ASSET_MANIFEST[key as keyof typeof OFFICE_ASSET_MANIFEST]
  const name = visual?.label ?? key
  const tier = Math.min(14, Math.floor(index / 6))
  return {
    key,
    type: type as GameAsset['type'],
    name,
    cost: 1000 * (index + 1),
    reputation: Math.min(94, index),
    tier,
    benefit: visual?.location ?? 'Installed in the office',
    description: visual?.label ?? key,
    owned: true,
    available: true,
    requirements: { reputation: 0, tier, assets: [] },
  }
}

/**
 * The near-empty tier-0 shack: only what a first case affords.
 *
 * Deliberately sparse rather than "tier-0's affordable set" — the point of the
 * shot is a rundown room, so it carries a repaired desk and the certificate on
 * the wall and nothing else. No staff: the shack is one person.
 */
export function shackAssets(): GameAsset[] {
  return ['repaired_desk', 'bar_certificate'].map((key, index) => syntheticAsset(key, assetTypeFor(key), index))
}

/** Every upgrade, cosmetic, connection, acquisition and all 30 staff owned. */
export function fullEmpireAssets(): GameAsset[] {
  return Object.keys(OFFICE_ASSET_MANIFEST).map((key, index) => syntheticAsset(key, assetTypeFor(key), index))
}

/**
 * A matter open on the partner's desk, so the office has a client in it.
 *
 * `OfficeThreeScene` treats a non-null `activeCase` as an instruction to build a
 * consultation: a seated visitor in a chair beside the partner desk, a side table
 * with a coffee on it, an open portfolio under their hands, the case card anchored
 * to their head, and a selection halo. It is the most integrated character in
 * either ported scene — it has a purpose-built seated arm chain because the
 * standing rig's looked detached in a chair, and a `seatedGuest` behaviour
 * repertoire with every arm-moving beat deliberately removed.
 *
 * The deck was passing `null` and getting none of it. What it showed instead was
 * the staff floor: sixteen people at workstations, correct and completely
 * decorative, which is the note the walkthrough returned. A client sitting across
 * the desk is the same slide's own argument in the room — the deck's line for
 * `demo-clients-walk-in` is "a client sits down; taking their case is starting a
 * practice run" — so the character is doing the work of the sentence rather than
 * standing near it.
 *
 * Fixed rather than random, because the figure's face, build, palette, glasses and
 * satchel are all seeded from the client's *name* via `clientCastSeed`: a name
 * chosen once is a person who looks the same in every rehearsal and in every
 * screenshot taken of this slide.
 */
export function syntheticConsultation(): ActiveOfficeCase {
  return {
    sessionId: 'deck-consultation',
    clientKey: DECK_CONSULTATION_CLIENT_KEY,
    clientName: 'Marguerite Okonjo',
    baseFee: 4_800,
  }
}

/**
 * The key the room files the consulting client under in its focus register.
 *
 * Exported because selecting her is how the deck composes the shot on her: the
 * office turns its camera to whatever key arrives on an `office-focus-asset`
 * event, and that is the app's own selection mechanism rather than a camera
 * control invented for the deck. See `office-scene.tsx`.
 */
export const DECK_CONSULTATION_CLIENT_KEY = 'deck-consultation-client'

/** The 15 firm tiers, as the backend's `FIRM_TIERS` names them. */
const FIRM_TIERS: ReadonlyArray<Pick<FirmTier, 'tier' | 'name' | 'cost' | 'reputation' | 'region' | 'feature' | 'short'>> = [
  { tier: 0, name: 'Wooden Shack', cost: 0, reputation: 0, region: 'Old Quarter', feature: 'Street-level practice', short: 'A one-desk practice with a lot to prove.' },
  { tier: 1, name: 'Shared Office', cost: 6_000, reputation: 20, region: 'Old Quarter', feature: 'Client intake suite', short: 'A real address, a repaired roof, and room for help.' },
  { tier: 2, name: 'Neighborhood Firm', cost: 18_000, reputation: 32, region: 'Market Ward', feature: 'Community courtroom', short: 'A storefront practice trusted by local businesses.' },
  { tier: 3, name: 'Downtown Firm', cost: 50_000, reputation: 42, region: 'Civic Center', feature: 'Trial strategy floor', short: 'A polished suite overlooking the city docket.' },
  { tier: 4, name: 'City Power Firm', cost: 130_000, reputation: 50, region: 'Financial District', feature: 'Predictive jury theater', short: 'A landmark office for high-stakes clients.' },
  { tier: 5, name: 'Regional Headquarters', cost: 320_000, reputation: 56, region: 'Harbor Exchange', feature: 'Branch command center', short: 'A waterfront headquarters coordinating offices across the state.' },
  { tier: 6, name: 'National Firm', cost: 750_000, reputation: 62, region: 'Midtown Crown', feature: 'National litigation grid', short: 'Coast-to-coast branches and a national client book.' },
  { tier: 7, name: 'International Practice', cost: 1_700_000, reputation: 68, region: 'Embassy Row', feature: 'Live translation cloud', short: 'Diplomatic reach and cross-border teams working around the clock.' },
  { tier: 8, name: 'Global Legal Empire', cost: 3_600_000, reputation: 74, region: 'Skyline Heights', feature: 'Global crisis command', short: 'A worldwide practice whose crest changes skylines.' },
  { tier: 9, name: 'Sovereign Counsel Tower', cost: 7_500_000, reputation: 79, region: 'Sovereign Enclave', feature: 'Treaty negotiation chamber', short: 'Governments and institutions bring their defining disputes here.' },
  { tier: 10, name: 'Continental Justice Campus', cost: 15_000_000, reputation: 83, region: 'Innovation Arc', feature: 'Autonomous case campus', short: 'An entire district built around research, advocacy, and legal technology.' },
  { tier: 11, name: 'Oceanic Law Citadel', cost: 30_000_000, reputation: 86, region: 'Azure Coast', feature: 'Floating arbitration forum', short: 'A self-sustaining coastal citadel for planet-scale matters.' },
  { tier: 12, name: 'Orbital Arbitration Ring', cost: 60_000_000, reputation: 89, region: 'Aerospace Basin', feature: 'Zero-gravity hearing rooms', short: 'The first legal headquarters with a permanent orbital docket.' },
  { tier: 13, name: 'Lunar Embassy of Law', cost: 120_000_000, reputation: 92, region: 'Lunar Gate', feature: 'Interworld treaty vault', short: 'A moon-linked embassy settling disputes beyond national borders.' },
  { tier: 14, name: 'Planetary Justice Nexus', cost: 240_000_000, reputation: 94, region: 'Celestial Crown', feature: 'Justice constellation', short: 'A legendary network that coordinates law across an entire civilization.' },
]

/** Which arc of the world each tier stands in. Mirrors the app's `regions`. */
const REGION_RANGE: Record<MapRegionKey, [number, number]> = {
  city: [0, 4],
  nation: [5, 6],
  ocean: [7, 9],
  continent: [10, 11],
  orbit: [12, 14],
}

/** The rival firms the acquisition gallery is hung with, by the tier they sit at. */
const RIVALS: ReadonlyArray<{ key: string; name: string; tier: number }> = [
  { key: 'neighborhood_practice', name: 'Harrow & Finch', tier: 2 },
  { key: 'downtown_boutique', name: 'Vale Legal', tier: 3 },
  { key: 'regional_firm', name: 'Northstar Law', tier: 5 },
  { key: 'national_competitor', name: 'Sterling Global', tier: 6 },
  { key: 'appellate_chambers', name: 'Blackstone Chambers', tier: 7 },
  { key: 'media_law_collective', name: 'Neon & Gold', tier: 8 },
  { key: 'transatlantic_firm', name: 'Meridian Atlantic', tier: 9 },
  { key: 'global_crisis_firm', name: 'Redline Counsel', tier: 10 },
  { key: 'sovereign_rival', name: 'Crown Meridian', tier: 11 },
  { key: 'continental_rival', name: 'Atlas Juris', tier: 12 },
  { key: 'oceanic_rival', name: 'Pelagic Partners', tier: 13 },
  { key: 'orbital_rival', name: 'Zenith Orbital', tier: 14 },
]

/** The ambient dockets the app scatters across the arcs. */
const EVENTS: ReadonlyArray<MapSceneEvent['data']> = [
  { key: 'docket', name: 'Morning docket', detail: 'A municipal hearing is assembling outside the courthouse.', minTier: 0 },
  { key: 'tip', name: 'Client lead', detail: 'A referral is waiting at the Old Quarter bulletin.', minTier: 1 },
  { key: 'circuit', name: 'Circuit calendar', detail: 'The appellate train has posted a new calendar.', minTier: 5 },
  { key: 'embassy', name: 'Embassy brief', detail: 'Treaty counsel have arrived at the diplomatic quay.', minTier: 7 },
  { key: 'trade', name: 'Trade dispute', detail: 'A commercial matter has reached the harbor docket.', minTier: 8 },
  { key: 'summit', name: 'Sovereign summit', detail: 'Delegations have opened a continental hearing.', minTier: 10 },
  { key: 'signal', name: 'Council bulletin', detail: 'A priority international filing has reached the firm.', minTier: 12 },
  { key: 'vote', name: 'High-court calendar', detail: 'The international assembly is entering session.', minTier: 14 },
]

function inRegion(tier: number, region: MapRegionKey) {
  const [low, high] = REGION_RANGE[region]
  return tier >= low && tier <= high
}

/**
 * How far the deck's imaginary firm has got. Everything below the top tier of
 * the region being shown reads as won, so no arc is a field of grey padlocks.
 */
function deckOfficeTier(region: MapRegionKey) {
  return REGION_RANGE[region][1]
}

/** Synthetic map points for a region, enough to populate the scene. */
export function syntheticMapPoints(region: MapRegionKey): MapScenePoint[] {
  const officeTier = deckOfficeTier(region)
  const tiers: MapSceneTier[] = FIRM_TIERS
    .filter((tier) => inRegion(tier.tier, region))
    .map((tier) => ({
      key: `tier-${tier.tier}`,
      kind: 'tier',
      data: {
        ...tier,
        // The lease is roughly a hundredth of the purchase price a day; the
        // deck never prints the figure, it only has to be a number.
        rent_daily: Math.round(tier.cost / 100),
        owned: tier.tier <= officeTier,
        next: tier.tier === officeTier + 1,
        available: tier.tier <= officeTier + 1,
      },
      state: tier.tier < officeTier ? 'complete' : tier.tier === officeTier ? 'current' : 'next',
    }))
  const rivals: MapSceneRival[] = RIVALS
    .filter((rival) => inRegion(rival.tier, region))
    .map((rival, index) => ({
      key: `rival-${rival.key}`,
      kind: 'rival',
      data: { ...syntheticAsset(rival.key, 'rival', index), name: rival.name, tier: rival.tier },
      locked: false,
    }))
  const events: MapSceneEvent[] = EVENTS
    .filter((event) => inRegion(event.minTier, region))
    .map((event) => ({ key: `event-${event.key}`, kind: 'event', data: event, locked: false }))
  return [...tiers, ...rivals, ...events]
}
