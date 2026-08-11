import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const backendPath = resolve(here, '../../backend/app/game.py')
const manifestPath = resolve(here, '../src/art/office-manifest.ts')
const backend = readFileSync(backendPath, 'utf8')
const manifest = readFileSync(manifestPath, 'utf8')

const fail = (message) => {
  console.error(`Office manifest check failed: ${message}`)
  process.exitCode = 1
}

const pythonList = (name) => {
  const start = backend.indexOf(`${name} = [`)
  if (start < 0) throw new Error(`Could not find ${name} in backend catalog`)
  const remainder = backend.slice(start + name.length + 4)
  const next = remainder.search(/\n[A-Z][A-Z_]+ = \[/)
  return next < 0 ? remainder : remainder.slice(0, next)
}

const catalogSections = ['UPGRADES', 'STAFF', 'CONNECTIONS', 'RIVALS', 'COSMETICS']
const catalogKeys = new Map()
for (const section of catalogSections) {
  const keys = []
  for (const match of pythonList(section).matchAll(/"key"\s*:\s*"([^"]+)"|_asset\(\s*"([^"]+)"/g)) keys.push(match[1] ?? match[2])
  if (!keys.length) fail(`${section} yielded no catalog keys`)
  keys.forEach((key) => {
    if (catalogKeys.has(key)) fail(`${key} appears in both ${catalogKeys.get(key)} and ${section}`)
    catalogKeys.set(key, section)
  })
}

const manifestStart = manifest.indexOf('export const OFFICE_ASSET_MANIFEST = {')
const manifestEnd = manifest.indexOf('} satisfies Record<string, OfficeAssetVisual>', manifestStart)
if (manifestStart < 0 || manifestEnd < 0) throw new Error('Could not isolate OFFICE_ASSET_MANIFEST')
const manifestBody = manifest.slice(manifestStart, manifestEnd)
const manifestEntries = new Map()
for (const match of manifestBody.matchAll(/^\s{2}([a-z0-9_]+):\s*visual\('([^']+)',\s*'[^']+',\s*'[^']+',\s*(\d+)\)/gm)) {
  manifestEntries.set(match[1], { zone: match[2], stage: Number(match[3]) })
}

for (const [key, section] of catalogKeys) if (!manifestEntries.has(key)) fail(`${key} (${section}) has no visual destination`)
for (const key of manifestEntries.keys()) if (!catalogKeys.has(key)) fail(`${key} is mapped but absent from the backend catalog`)

const staffStationStart = manifest.indexOf('export const OFFICE_STAFF_STATIONS = {')
const staffStationEnd = manifest.indexOf('} satisfies Record<string, OfficeStaffStation>', staffStationStart)
if (staffStationStart < 0 || staffStationEnd < 0) throw new Error('Could not isolate OFFICE_STAFF_STATIONS')
const staffStationBody = manifest.slice(staffStationStart, staffStationEnd)
const staffStations = new Map([...staffStationBody.matchAll(/^\s{2}([a-z0-9_]+):\s*'([a-z-]+)'/gm)].map((match) => [match[1], match[2]]))
const backendStaff = new Set([...catalogKeys].filter(([, section]) => section === 'STAFF').map(([key]) => key))
for (const key of backendStaff) if (!staffStations.has(key)) fail(`${key} has no role-appropriate office station`)
for (const key of staffStations.keys()) if (!backendStaff.has(key)) fail(`${key} has a staff station but is not backend staff`)

// A purchase must create a new installation or visibly advance an existing
// one. Duplicate zone/stage pairs would make one upgrade visually inert.
const upgradeSignatures = new Map()
for (const [key, section] of catalogKeys) {
  if (section !== 'UPGRADES') continue
  const visual = manifestEntries.get(key)
  if (!visual) continue
  const signature = `${visual.zone}:${visual.stage}`
  if (upgradeSignatures.has(signature)) fail(`${key} and ${upgradeSignatures.get(signature)} share upgrade visual ${signature}`)
  upgradeSignatures.set(signature, key)
}

const environmentStart = manifest.indexOf('export const OFFICE_ENVIRONMENTS')
const environmentEnd = manifest.indexOf('\n]', environmentStart)
if (environmentStart < 0 || environmentEnd < 0) throw new Error('Could not isolate OFFICE_ENVIRONMENTS')
const environmentBody = manifest.slice(environmentStart, environmentEnd)
const environments = [...environmentBody.matchAll(/\{ tier:\s*(\d+), name:\s*'([^']+)', identity:\s*'([^']+)', centerpiece:\s*'([^']+)', furnishingDensity:\s*(\d+), staffOnShift:\s*(\d+), finish:\s*'([^']+)' \}/g)]
  .map((match) => ({ tier: Number(match[1]), name: match[2], identity: match[3], centerpiece: match[4], density: Number(match[5]), shift: Number(match[6]), finish: match[7] }))

const expectedTiers = Array.from({ length: 15 }, (_, index) => index)
const actualTiers = environments.map((environment) => environment.tier)
if (JSON.stringify(actualTiers) !== JSON.stringify(expectedTiers)) fail(`office tiers must be exactly 0–14; found ${actualTiers.join(', ')}`)
if (new Set(environments.map((environment) => environment.name)).size !== environments.length) fail('every office tier must have a distinct environment name')
if (new Set(environments.map((environment) => environment.identity)).size !== environments.length) fail('every office tier must have a distinct environmental identity')
environments.forEach((environment, index) => {
  if (!environment.centerpiece) fail(`tier ${environment.tier} has no centerpiece`)
  if (environment.density < 2 || (index > 0 && environment.density <= environments[index - 1].density)) fail(`tier ${environment.tier} furnishing density must increase from the previous office`)
  // `staffOnShift` is a headcount on the floor, not a rota size, and it runs
  // 1 at the shack to 30 at the nexus. The bound here used to be 1-5, which
  // was true of an earlier manifest and has been failing on thirteen of the
  // fifteen tiers since it stopped being. What is actually worth asserting is
  // the property the scene depends on: the floor never empties, and growing
  // the firm never removes people from it.
  if (environment.shift < 1) fail(`tier ${environment.tier} has nobody on the floor`)
  if (index > 0 && environment.shift < environments[index - 1].shift) {
    fail(`tier ${environment.tier} puts fewer staff on the floor than tier ${environments[index - 1].tier}`)
  }
})

const layoutStart = manifest.indexOf('export const OFFICE_LAYOUT_FAMILIES')
const layoutEnd = manifest.indexOf('\n]', layoutStart)
if (layoutStart < 0 || layoutEnd < 0) throw new Error('Could not isolate OFFICE_LAYOUT_FAMILIES')
const layoutBody = manifest.slice(layoutStart, layoutEnd)
// A family is now one authored plan scaled by two numbers rather than a set of
// hand-placed rows, so `stationInset`/`stationRows`/`stationCant` are gone and
// `spread`/`reach` replace them. The regex below matched none of the current
// entries, which is why this reported "found " with an empty tier list rather
// than reporting a real gap: a check that cannot parse its input fails in a way
// that looks like a data problem.
const layoutFamilies = [...layoutBody.matchAll(/\{ key: '([^']+)', tiers: \[([^\]]+)\], spread: ([\d.]+), reach: ([\d.]+) \}/g)]
  .map((match) => ({
    key: match[1],
    tiers: match[2].split(',').map((value) => Number(value.trim())),
    spread: Number(match[3]),
    reach: Number(match[4]),
  }))
if (!layoutFamilies.length) fail('OFFICE_LAYOUT_FAMILIES parsed to nothing; this check no longer understands its shape')
const layoutTiers = layoutFamilies.flatMap((family) => family.tiers).sort((left, right) => left - right)
if (JSON.stringify(layoutTiers) !== JSON.stringify(expectedTiers)) fail(`layout families must cover every tier exactly once; found ${layoutTiers.join(', ')}`)
if (layoutFamilies.some((family) => family.tiers.length < 2)) fail('every layout family must be reusable across at least two office tiers')
layoutFamilies.forEach((family, index) => {
  for (const [name, value] of [['spread', family.spread], ['reach', family.reach]]) {
    if (!(value > 0) || value > 1) fail(`${family.key} ${name} is ${value}; it scales the authored plan and must be within (0, 1]`)
  }
  // The plan opens out as the firm grows. A later family that took less floor
  // than an earlier one would make an office upgrade look like a downgrade.
  if (index > 0 && (family.spread < layoutFamilies[index - 1].spread || family.reach < layoutFamilies[index - 1].reach)) {
    fail(`${family.key} takes less floor than ${layoutFamilies[index - 1].key}`)
  }
})

const tierCatalog = pythonList('FIRM_TIERS')
const backendTierNames = [...tierCatalog.matchAll(/"tier"\s*:\s*(\d+),\s*"name"\s*:\s*"([^"]+)"/g)]
  .map((match) => ({ tier: Number(match[1]), name: match[2] }))
if (backendTierNames.length !== environments.length) fail(`backend has ${backendTierNames.length} office tiers while the scene has ${environments.length}`)
backendTierNames.forEach(({ tier, name }) => {
  if (environments[tier]?.name !== name) fail(`tier ${tier} scene is “${environments[tier]?.name}” but backend is “${name}”`)
})

if (!process.exitCode) {
  const counts = Object.fromEntries(catalogSections.map((section) => [section.toLowerCase(), [...catalogKeys.values()].filter((value) => value === section).length]))
  console.log(`Office manifest verified: ${manifestEntries.size} mapped assets (${Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(', ')}), ${staffStations.size} role-assigned staff stations, ${layoutFamilies.length} reusable floor plans, 15 distinct furnished environments, and ${upgradeSignatures.size} visible upgrade states.`)
}
