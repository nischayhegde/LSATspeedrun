// The Circuit's three town lattices, recomputed outside the browser.
//
// `planAxisInterior`, `assembleAxis` and `blocksFromGrid` are pure and
// deterministic, so the market block a town hands its courthouse can be worked
// out without building a scene. Cheaper than a Playwright run and exact.
const STREET_WIDTH = { arterial: 1.95, collector: 1.35, local: .92, alley: .52 }
const STREET_VERGE = { arterial: .37, collector: .37, local: .37, alley: 0 }
const RANK = { arterial: 3, collector: 2, local: 1, alley: 0 }

function planAxisInterior(min, max, arterials, seed, targetLocal) {
  const out = []
  let state = Math.floor(Math.abs(seed)) % 2147483647
  if (state <= 0) state = 1
  const rnd = () => { state = (state * 16807) % 2147483647; return state / 2147483647 }
  const controls = [min, ...arterials, max].sort((a, b) => a - b)
  for (let index = 0; index < controls.length - 1; index += 1) {
    const a = controls[index]
    const b = controls[index + 1]
    const width = b - a
    const collectorCount = Math.max(1, Math.round(width / (targetLocal * 2.6) + (rnd() - .5) * .7))
    const bayEdges = [a]
    for (let k = 1; k < collectorCount; k += 1) {
      const position = a + width * (k / collectorCount + (rnd() - .5) * .16)
      bayEdges.push(position)
      out.push({ position, streetClass: 'collector' })
    }
    bayEdges.push(b)
    for (let j = 0; j < bayEdges.length - 1; j += 1) {
      const c = bayEdges[j]
      const d = bayEdges[j + 1]
      const localCount = Math.max(1, Math.round((d - c) / targetLocal + (rnd() - .5) * .85))
      for (let k = 1; k < localCount; k += 1) out.push({ position: c + (d - c) * (k / localCount + (rnd() - .5) * .26), streetClass: 'local' })
    }
  }
  return out
}

function assembleAxis(fixed, interior, minGap, anchored = false) {
  const all = [...fixed.map((l) => ({ ...l, anchor: anchored })), ...interior].sort((a, b) => a.position - b.position)
  const kept = []
  for (const line of all) {
    const prev = kept[kept.length - 1]
    if (prev && line.position - prev.position < minGap) {
      if (prev.anchor && !line.anchor) continue
      if (line.anchor && !prev.anchor) { kept[kept.length - 1] = line; continue }
      if (RANK[line.streetClass] > RANK[prev.streetClass]) kept[kept.length - 1] = line
      continue
    }
    kept.push(line)
  }
  return kept
}

function blocksFromGrid(avenues, streets, { seed = 0, verge = true } = {}) {
  const inset = verge === false
    ? (c) => STREET_WIDTH[c] / 2
    : (c) => STREET_WIDTH[c] / 2 + STREET_VERGE[c]
  const blocks = []
  for (let column = 0; column < avenues.length - 1; column += 1) {
    const west = avenues[column]
    const east = avenues[column + 1]
    for (let row = 0; row < streets.length - 1; row += 1) {
      const north = streets[row]
      const south = streets[row + 1]
      const minX = west.position + inset(west.streetClass)
      const maxX = east.position - inset(east.streetClass)
      const minZ = north.position + inset(north.streetClass)
      const maxZ = south.position - inset(south.streetClass)
      const width = maxX - minX
      const depth = maxZ - minZ
      if (width < 1.4 || depth < 1.4) continue
      const widest = [west, east, north, south].map((s) => s.streetClass).sort((a, b) => STREET_WIDTH[b] - STREET_WIDTH[a])[0]
      blocks.push({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width, depth, frontage: widest, row, column, seed: seed + column * 131 + row * 617 })
    }
  }
  return blocks
}

const TOWNS = [
  { key: 'nation-marlow', x: -10, z: -7.9, size: .88, seed: 2100, seat: false },
  { key: 'nation-seat', x: 0, z: -8.4, size: 1.24, seed: 3300, seat: true },
  { key: 'nation-ashgate', x: 10, z: -7.7, size: .68, seed: 4400, seat: false },
]

for (const town of TOWNS) {
  const halfX = 2.4 + town.size * 1.95
  const halfZ = 2.0 + town.size * 1.6
  const avenues = assembleAxis(
    [
      { position: town.x - halfX, streetClass: 'alley' },
      { position: town.x, streetClass: 'collector' },
      { position: town.x + halfX, streetClass: 'alley' },
    ],
    planAxisInterior(town.x - halfX, town.x + halfX, [town.x], town.seed + 11, 3.3),
    2.85,
    true,
  )
  const streets = assembleAxis(
    [
      { position: town.z - halfZ, streetClass: 'alley' },
      { position: town.z, streetClass: 'collector' },
      { position: town.z + halfZ, streetClass: 'alley' },
    ],
    planAxisInterior(town.z - halfZ, town.z + halfZ, [town.z], town.seed + 29, 3.1),
    2.7,
    true,
  )
  const blocks = blocksFromGrid(avenues, streets, { seed: town.seed, verge: false })
  let market = null
  let closest = Infinity
  for (const block of blocks) {
    const distance = Math.hypot(block.x - town.x, block.z - town.z)
    if (distance < closest) { closest = distance; market = block }
  }
  const scale = town.seat ? .74 : .44
  console.log(`\n${town.key}  halfX ${halfX.toFixed(2)} halfZ ${halfZ.toFixed(2)}  blocks ${blocks.length}`)
  console.log('  avenues', avenues.map((a) => `${a.position.toFixed(2)}:${a.streetClass}`).join(' '))
  console.log('  streets', streets.map((a) => `${a.position.toFixed(2)}:${a.streetClass}`).join(' '))
  console.log('  market', market && `${market.x.toFixed(2)},${market.z.toFixed(2)} ${market.width.toFixed(2)}x${market.depth.toFixed(2)} frontage ${market.frontage}`)
  if (market) {
    console.log(`  courthouse at scale ${scale}: ${(5.2 * scale).toFixed(2)} x ${(3.5 * scale).toFixed(2)}  (needs ${(5.2 * scale).toFixed(2)} x ${(3.5 * scale).toFixed(2)}, has ${market.width.toFixed(2)} x ${market.depth.toFixed(2)})`)
    const paved = STREET_VERGE[market.frontage]
    const margin = paved + .16
    const fitted = Math.min(scale, (market.width - margin * 2) / 5.2, (market.depth - margin * 2) / 3.5)
    console.log(`  fitted scale ${fitted.toFixed(3)} with margin ${margin.toFixed(2)} → ${(5.2 * fitted).toFixed(2)} x ${(3.5 * fitted).toFixed(2)}`)
  }
  const sorted = blocks.slice().sort((a, b) => b.width * b.depth - a.width * a.depth).slice(0, 4)
  console.log('  largest', sorted.map((b) => `${b.x.toFixed(2)},${b.z.toFixed(2)} ${b.width.toFixed(2)}x${b.depth.toFixed(2)}`).join('  '))
}
