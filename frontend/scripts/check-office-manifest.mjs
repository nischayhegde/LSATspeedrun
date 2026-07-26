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

const catalogSections = ['UPGRADES', 'STAFF', 'CONNECTIONS', 'RIVALS']
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
  if (environment.shift < 1 || environment.shift > 5) fail(`tier ${environment.tier} active staff limit must be between 1 and 5`)
})

const layoutStart = manifest.indexOf('export const OFFICE_LAYOUT_FAMILIES')
const layoutEnd = manifest.indexOf('\n]', layoutStart)
if (layoutStart < 0 || layoutEnd < 0) throw new Error('Could not isolate OFFICE_LAYOUT_FAMILIES')
const layoutBody = manifest.slice(layoutStart, layoutEnd)
const layoutFamilies = [...layoutBody.matchAll(/\{ key: '([^']+)', tiers: \[([^\]]+)\], stationInset: ([\d.]+), stationRows: \[([^\]]+)\], stationCant: \[([^\]]+)\] \}/g)]
  .map((match) => ({
    key: match[1],
    tiers: match[2].split(',').map((value) => Number(value.trim())),
    inset: Number(match[3]),
    rows: match[4].split(',').map((value) => Number(value.trim())),
    cant: match[5].split(',').map((value) => Number(value.trim())),
  }))
const layoutTiers = layoutFamilies.flatMap((family) => family.tiers).sort((left, right) => left - right)
if (JSON.stringify(layoutTiers) !== JSON.stringify(expectedTiers)) fail(`layout families must cover every tier exactly once; found ${layoutTiers.join(', ')}`)
if (layoutFamilies.some((family) => family.tiers.length < 2)) fail('every layout family must be reusable across at least two office tiers')
layoutFamilies.forEach((family) => {
  if (family.rows.length !== 3 || family.cant.length !== 3) fail(`${family.key} must define exactly three staff rows and three angles`)
  if (family.inset < 1.5 || family.inset > 3.5) fail(`${family.key} station inset is outside the supported room envelope`)
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
