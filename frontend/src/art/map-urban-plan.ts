/**
 * Urban-planning primitives shared by the three inhabited map regions.
 *
 * The map regions used to be authored as lists of hand-placed buildings, which
 * is why they read as scatter: real settlements are not a set of objects, they
 * are a *street network* that cuts land into blocks, blocks subdivided into
 * lots, and lots developed at a density that falls off from the centre. This
 * module models exactly that sequence and nothing else — it is pure data, with
 * no Three.js dependency, so the scene builder stays responsible for turning
 * plans into geometry (and for instancing them).
 *
 * The concepts encoded here, in the order the planner applies them:
 *
 *  1. Street hierarchy — arterials carry through traffic and get the widest
 *     right-of-way and the deepest lots; collectors feed them; local streets
 *     and rear alleys serve the block interior. Street class drives width,
 *     setback and lot depth, which is what makes a grid read as a grid with a
 *     centre rather than as graph paper.
 *  2. Block formation — the network cuts the ground into blocks. Blocks are
 *     the unit of land use, not buildings.
 *  3. Lot subdivision — each street-facing block edge is cut into lots of
 *     varying frontage. Varied frontage along a shared building line is the
 *     single strongest visual cue that a street grew rather than got stamped.
 *  4. Perimeter-block development — buildings occupy the street frontage and
 *     leave the block interior as a courtyard/garden. This is the traditional
 *     European block; the alternative (free-standing objects in the middle of
 *     a block) is exactly the "random field of buildings" look being fixed.
 *  5. Zoning gradient — storeys, lot coverage, party-wall vs. side-yard, and
 *     roof form all interpolate from a dense core to a low-rise fringe, the
 *     familiar bid-rent profile of a real town.
 *  6. Deliberate voids — squares, parks and civic forecourts are *planned*
 *     absences of building, and are what stop a dense grid reading as a slab.
 */

export type XZ = [number, number]

export type StreetClass = 'arterial' | 'collector' | 'local' | 'alley'

export type StreetAxis = 'ns' | 'ew'

export type PlannedStreet = {
  axis: StreetAxis
  /** x for a north–south street, z for an east–west street. */
  position: number
  from: number
  to: number
  streetClass: StreetClass
}

export type RoofForm = 'parapet' | 'flat' | 'pitched' | 'stepped'

export type PlannedBuilding = {
  x: number
  z: number
  /** Frontage width, measured in the building's own rotated frame. */
  width: number
  /** Depth back from the street, in the building's own rotated frame. */
  depth: number
  height: number
  rotationY: number
  color: number
  lit: boolean
  roof: RoofForm
  /** Corner sites are the valuable ones, and read as such. */
  corner: boolean
}

export type BlockRect = {
  x: number
  z: number
  width: number
  depth: number
  /** Small rotations give an organic, pre-grid core its slightly skewed feel. */
  rotation: number
  /** Class of the widest street this block fronts. */
  frontage: StreetClass
  row: number
  column: number
  seed: number
}

export type BlockSpec = {
  seed: number
  /** Lot frontage range. A wide range is what produces varied street rhythm. */
  lotMin: number
  lotMax: number
  /** How far back from the street the building line sits. */
  setback: number
  /** Depth of the built strip; the remainder of the block is courtyard. */
  buildingDepth: number
  /** 0 for party-wall terraces, >0 for detached houses with side yards. */
  gap: number
  storeyHeight: number
  storeysMin: number
  storeysMax: number
  palette: number[]
  roof: RoofForm
  /** 0..1 chance that a given building shows lit windows. */
  litChance: number
  /** Which block edges are developed. Defaults to all four. */
  edges?: Array<'n' | 's' | 'e' | 'w'>
  /** Extra storeys granted to corner sites. */
  cornerBonus?: number
  /** Chance a lot is left empty (yard, infill site, side access). */
  vacancy?: number
}

export type ReservedSite = { x: number; z: number; radius: number }

export function hashUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123
  return value - Math.floor(value)
}

/**
 * Smooth value noise on the ground plane, in 0..1.
 *
 * A settlement's edge is the one place a purely radial rule gives itself away.
 * Anything derived from distance alone — density, height, vacancy — draws a
 * circle, and a circle centred on the plan's own centre reads as a vignette
 * painted over the map rather than as land that ran out. What is needed instead
 * is a field with no centre in it at all, so the falloff can be *modulated*
 * spatially: the same nominal distance out is built up here and empty there.
 *
 * Interpolation is smoothstepped rather than linear because the lattice
 * otherwise shows through as a grid of creases at exactly the scale the
 * buildings sit on, which is a worse artefact than the one being fixed.
 */
export function valueNoise2D(x: number, z: number, frequency: number, seed: number) {
  const fx = x * frequency
  const fz = z * frequency
  const cellX = Math.floor(fx)
  const cellZ = Math.floor(fz)
  const tx = fx - cellX
  const tz = fz - cellZ
  const sx = tx * tx * (3 - 2 * tx)
  const sz = tz * tz * (3 - 2 * tz)
  const corner = (ix: number, iz: number) => hashUnit(seed + ix * 57.31 + iz * 113.97)
  const near = corner(cellX, cellZ)
  const nearEast = corner(cellX + 1, cellZ)
  const far = corner(cellX, cellZ + 1)
  const farEast = corner(cellX + 1, cellZ + 1)
  const top = near + (nearEast - near) * sx
  const bottom = far + (farEast - far) * sx
  return top + (bottom - top) * sz
}

/**
 * Two octaves of `valueNoise2D`, in 0..1 with a mean near .5.
 *
 * The long wavelength is roughly a quarter's worth of ground — it decides
 * whether a whole neighbourhood got built — and the short one is about a block,
 * which is what breaks up the boundary between a built patch and an empty one
 * so it does not read as a drawn line.
 */
export function fabricNoise(x: number, z: number, seed: number) {
  return valueNoise2D(x, z, .052, seed) * .64 + valueNoise2D(x, z, .168, seed + 91.7) * .36
}

/**
 * Cuts a frontage of `length` into lots between `min` and `max` wide.
 *
 * Slivers are absorbed into their neighbour rather than built on, the way a
 * real subdivision consolidates an unusable remainder, so no street ends in a
 * half-metre building.
 */
export function subdivideFrontage(length: number, min: number, max: number, seed: number) {
  const lots: number[] = []
  let remaining = length
  let index = 0
  while (remaining >= min) {
    const lot = Math.min(remaining, min + hashUnit(seed * 37 + index * 19) * Math.max(0, max - min))
    if (remaining - lot < min * .8) {
      lots.push(remaining)
      return lots
    }
    lots.push(lot)
    remaining -= lot
    index += 1
  }
  if (remaining > 0 && lots.length) lots[lots.length - 1] += remaining
  return lots
}

const STREET_WIDTH: Record<StreetClass, number> = {
  arterial: 1.95,
  collector: 1.35,
  local: .92,
  alley: .52,
}

export function streetWidth(streetClass: StreetClass) {
  return STREET_WIDTH[streetClass]
}

/**
 * How far the paving reaches beyond the kerb on each side, by street class.
 *
 * A street is its carriageway *and* its pavements; the plot line is behind the
 * paving, not at the kerb. An alley has neither kerb nor pavement, so its plots
 * come right up to the carriageway.
 */
const STREET_VERGE: Record<StreetClass, number> = {
  arterial: .37,
  collector: .37,
  local: .37,
  alley: 0,
}

/**
 * Half the full paved width of a street: carriageway, kerb and footway.
 *
 * `addPlannedStreets` draws its apron to exactly this, so a caller that insets
 * from it and the drawn paving cannot disagree about where the street ends.
 */
export function streetHalfPaved(streetClass: StreetClass) {
  return STREET_WIDTH[streetClass] / 2 + STREET_VERGE[streetClass]
}

/**
 * Builds the block lattice implied by a set of north–south and east–west
 * street lines. Each block is inset by half of each bounding street's *paved*
 * width, so the whole street — carriageway and both pavements — is genuinely
 * between blocks rather than painted over them.
 *
 * Insetting by the carriageway alone, which is what this did, is the reason
 * people were seen walking through buildings. It put the full width of every
 * pavement inside the block: `addPlannedStreets` centres a footway .28 beyond
 * the kerb with .09 of paving either side, so the entire walkable band sat
 * between .19 and .37 *inside* the block that the buildings then filled. A
 * walker is bound to its footway polyline and may only shift within that
 * footway's half-width, so it had no way not to be inside a frontage.
 *
 * Measured over 600 deterministic frames before this change, walkers were
 * inside a planned building for 20.5% of all samples on the Old Quarter and
 * 22.1% on The Circuit — and neither figure had ever been seen, because the
 * collision harness skipped instanced meshes and every planned building is one.
 */
export function blocksFromGrid(
  avenues: Array<{ position: number; streetClass: StreetClass }>,
  streets: Array<{ position: number; streetClass: StreetClass }>,
  options?: { rotation?: (column: number, row: number) => number; seed?: number; verge?: boolean },
) {
  const blocks: BlockRect[] = []
  const seedBase = options?.seed ?? 0
  // `verge: false` keeps the old plot line, at the kerb.
  //
  // Only The Circuit's villages ask for it, and only because their authored
  // props were sited by eye against the old lattice: measured over the same 600
  // frames, correcting the plot line there moved walkers in solid geometry from
  // 42.2% to 51.2% of samples, because the farmstead, the halt shelter and the
  // milestones stayed put while everything around them stepped back and the
  // crowd's obstacle set — which is what decides where in a pavement a walker
  // actually stands — changed underneath them. The same correction on the Old
  // Quarter took 27.9% to 10.8%. The villages need their props re-sited before
  // they can have it, and that is a separate piece of work.
  const inset = options?.verge === false
    ? (streetClass: StreetClass) => STREET_WIDTH[streetClass] / 2
    : streetHalfPaved
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
      const widest = [west, east, north, south]
        .map((street) => street.streetClass)
        .sort((a, b) => STREET_WIDTH[b] - STREET_WIDTH[a])[0]
      blocks.push({
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        width,
        depth,
        rotation: options?.rotation?.(column, row) ?? 0,
        frontage: widest,
        row,
        column,
        seed: seedBase + column * 131 + row * 617,
      })
    }
  }
  return blocks
}

/** The street segments implied by the same lattice, for rendering. */
export function streetsFromGrid(
  avenues: Array<{ position: number; streetClass: StreetClass }>,
  streets: Array<{ position: number; streetClass: StreetClass }>,
): PlannedStreet[] {
  const minZ = streets[0].position
  const maxZ = streets[streets.length - 1].position
  const minX = avenues[0].position
  const maxX = avenues[avenues.length - 1].position
  return [
    ...avenues.map((avenue) => ({
      axis: 'ns' as const, position: avenue.position, from: minZ, to: maxZ, streetClass: avenue.streetClass,
    })),
    ...streets.map((street) => ({
      axis: 'ew' as const, position: street.position, from: minX, to: maxX, streetClass: street.streetClass,
    })),
  ]
}

function rotatePoint(x: number, z: number, cx: number, cz: number, angle: number): XZ {
  if (!angle) return [x, z]
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const dx = x - cx
  const dz = z - cz
  return [cx + dx * cos - dz * sin, cz + dx * sin + dz * cos]
}

const EDGE_ROTATION = { n: 0, s: Math.PI, w: -Math.PI / 2, e: Math.PI / 2 } as const

/**
 * Develops one block as a perimeter block: buildings line the street edges
 * behind a setback, the interior is left as courtyard. Corner sites get an
 * extra storey, lot frontage varies, and a configurable share of lots stay
 * vacant so that no street face is perfectly continuous.
 */
export function developBlock(block: BlockRect, spec: BlockSpec): PlannedBuilding[] {
  const out: PlannedBuilding[] = []
  const edges = spec.edges ?? ['n', 's', 'e', 'w']
  const built = Math.min(spec.buildingDepth, Math.min(block.width, block.depth) * .46)
  const halfWidth = block.width / 2
  const halfDepth = block.depth / 2
  let counter = 0

  edges.forEach((edge, edgeIndex) => {
    const horizontal = edge === 'n' || edge === 's'
    // Edges running east–west take the full block width; the north–south
    // edges stop short of the corners so the two runs do not overlap.
    const run = horizontal ? block.width : block.depth - (built + spec.setback) * 2
    if (run < spec.lotMin) return
    const lots = subdivideFrontage(run, spec.lotMin, spec.lotMax, spec.seed + edgeIndex * 977)
    let cursor = -run / 2
    lots.forEach((lot) => {
      const centre = cursor + lot / 2
      cursor += lot
      const seed = spec.seed + edgeIndex * 313 + counter * 29
      counter += 1
      if (spec.vacancy && hashUnit(seed * 3 + 7) < spec.vacancy) return
      const corner = run / 2 - Math.abs(centre) < spec.lotMax * .75
      const storeySpan = Math.max(0, spec.storeysMax - spec.storeysMin)
      const storeys = spec.storeysMin + hashUnit(seed) * storeySpan + (corner ? (spec.cornerBonus ?? 0) : 0)
      const width = Math.max(.5, lot - spec.gap)
      const depth = built * (.78 + hashUnit(seed + 5) * .22)
      const offset = spec.setback + depth / 2
      let localX: number
      let localZ: number
      if (edge === 'n') { localX = centre; localZ = -halfDepth + offset } else if (edge === 's') { localX = centre; localZ = halfDepth - offset } else if (edge === 'w') { localX = -halfWidth + offset; localZ = centre } else { localX = halfWidth - offset; localZ = centre }
      const [x, z] = rotatePoint(block.x + localX, block.z + localZ, block.x, block.z, block.rotation)
      out.push({
        x,
        z,
        width,
        depth,
        height: Math.max(.6, storeys * spec.storeyHeight),
        rotationY: EDGE_ROTATION[edge] + block.rotation,
        color: spec.palette[Math.floor(hashUnit(seed + 11) * spec.palette.length) % spec.palette.length],
        lit: hashUnit(seed + 23) < spec.litChance,
        roof: spec.roof,
        corner,
      })
    })
  })
  return out
}

/** The open interior a perimeter block leaves behind, if any. */
export function blockCourtyard(block: BlockRect, spec: BlockSpec) {
  const built = Math.min(spec.buildingDepth, Math.min(block.width, block.depth) * .46)
  const inset = (built + spec.setback) * 2
  const width = block.width - inset
  const depth = block.depth - inset
  if (width < .8 || depth < .8) return null
  return { x: block.x, z: block.z, width, depth, rotation: block.rotation }
}

/**
 * Frontage around a circular street: how a market square, a rond-point, or a
 * village green is actually built up. Buildings face the centre (or away from
 * it) and are spaced by arc length, so the ring reads as one continuous
 * street wall rather than a ring of separate objects.
 */
export function ringFrontage(
  centre: XZ,
  radius: number,
  count: number,
  spec: BlockSpec,
  options?: { faceOut?: boolean; arcGaps?: Array<[number, number]>; jitter?: number },
) {
  const out: PlannedBuilding[] = []
  const jitter = options?.jitter ?? .12
  const circumference = Math.PI * 2 * radius
  const nominal = circumference / count
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
    if (options?.arcGaps?.some(([from, to]) => angle >= from && angle <= to)) continue
    const seed = spec.seed + index * 53
    if (spec.vacancy && hashUnit(seed * 5 + 3) < spec.vacancy) continue
    const storeySpan = Math.max(0, spec.storeysMax - spec.storeysMin)
    const height = Math.max(.6, (spec.storeysMin + hashUnit(seed) * storeySpan) * spec.storeyHeight)
    const width = Math.max(.55, nominal * (.78 + hashUnit(seed + 3) * .3) - spec.gap)
    const depth = spec.buildingDepth * (.8 + hashUnit(seed + 9) * .3)
    const ring = radius + spec.setback + depth / 2 + (hashUnit(seed + 17) - .5) * jitter
    out.push({
      x: centre[0] + Math.cos(angle) * ring,
      z: centre[1] + Math.sin(angle) * ring,
      width,
      depth,
      height,
      // A building on the north side of a square faces south, so the facade
      // normal points back at the centre.
      rotationY: options?.faceOut ? -angle + Math.PI / 2 : -angle - Math.PI / 2,
      color: spec.palette[Math.floor(hashUnit(seed + 11) * spec.palette.length) % spec.palette.length],
      lit: hashUnit(seed + 23) < spec.litChance,
      roof: spec.roof,
      corner: false,
    })
  }
  return out
}

/**
 * Continuous frontage along one face of an elliptical ring street.
 *
 * A monumental plan struck from a single centre is built as *continuous curved
 * street walls* — the ring is one facade with the avenues cut through it, the
 * way Place Vendôme or a Parisian boulevard block is. Approximating that with
 * a ring of separate rectangular blocks, each rotated to its own sector angle,
 * gives you twenty-four little clusters with grass between them, which is the
 * single loudest scatter cue a formal plan can have: the one place buildings
 * are supposed to be perfectly continuous is the one place they are not.
 *
 * Lots are cut by *arc length along the building line*, not by angle, so a lot
 * is the same width on the flat sides of the ellipse as on the tight ends —
 * dividing by angle instead is what makes an elliptical crescent look like it
 * was drawn on a rubber sheet.
 */
export function ellipseFrontage(options: {
  centre: XZ
  radius: number
  /** z radius as a fraction of the x radius. 1 is a circle. */
  squash: number
  /** +1 for the frontage standing outside the ring, -1 for inside it. */
  side: 1 | -1
  setback: number
  depth: number
  lotMin: number
  lotMax: number
  gap?: number
  seed: number
  storeyHeight: number
  storeysMin: number
  storeysMax: number
  cornerBonus?: number
  palette: number[]
  roof: RoofForm
  litChance: number
  vacancy?: number
  /** Angle windows kept clear, in radians — where the radial avenues cross. */
  arcGaps?: Array<[number, number]>
}): PlannedBuilding[] {
  const out: PlannedBuilding[] = []
  const steps = 720
  const offset = options.setback + options.depth / 2
  // The building line: the ellipse pushed out (or in) by the setback along its
  // own outward normal, sampled once so both arc length and geometry come from
  // the same curve.
  const line: Array<{ angle: number; x: number; z: number; nx: number; nz: number }> = []
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rx = options.radius
    const rz = options.radius * options.squash
    // Outward normal of an ellipse, which is not the radius vector unless the
    // ellipse is a circle.
    const nxRaw = cos * rz
    const nzRaw = sin * rx
    const magnitude = Math.max(1e-6, Math.hypot(nxRaw, nzRaw))
    const nx = nxRaw / magnitude
    const nz = nzRaw / magnitude
    line.push({
      angle,
      x: options.centre[0] + cos * rx + nx * offset * options.side,
      z: options.centre[1] + sin * rz + nz * offset * options.side,
      nx, nz,
    })
  }
  const cumulative: number[] = [0]
  for (let step = 1; step <= steps; step += 1) {
    cumulative.push(cumulative[step - 1] + Math.hypot(line[step].x - line[step - 1].x, line[step].z - line[step - 1].z))
  }
  const perimeter = cumulative[steps]
  const at = (distance: number) => {
    const wrapped = ((distance % perimeter) + perimeter) % perimeter
    let low = 0
    let high = steps
    while (low < high - 1) {
      const mid = (low + high) >> 1
      if (cumulative[mid] <= wrapped) low = mid; else high = mid
    }
    return line[low]
  }

  // Junction windows, converted from angle to arc length so lots can be cut
  // in the runs between them.
  const windows = (options.arcGaps ?? [])
    .map(([from, to]) => [cumulative[Math.round(from / (Math.PI * 2) * steps)] ?? 0, cumulative[Math.round(to / (Math.PI * 2) * steps)] ?? 0] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const runs: Array<[number, number]> = []
  let cursor = 0
  for (const [from, to] of windows) {
    if (from > cursor) runs.push([cursor, from])
    cursor = Math.max(cursor, to)
  }
  if (perimeter > cursor) runs.push([cursor, perimeter])

  let counter = 0
  for (const [from, to] of runs) {
    const run = to - from
    if (run < options.lotMin) continue
    const lots = subdivideFrontage(run, options.lotMin, options.lotMax, options.seed + Math.round(from * 7))
    let position = from
    for (const lot of lots) {
      const centre = position + lot / 2
      position += lot
      counter += 1
      const seed = options.seed + counter * 31
      if (options.vacancy && hashUnit(seed * 3 + 7) < options.vacancy) continue
      const sample = at(centre)
      const corner = centre - from < options.lotMax * 1.2 || to - centre < options.lotMax * 1.2
      const storeys = options.storeysMin
        + hashUnit(seed) * Math.max(0, options.storeysMax - options.storeysMin)
        + (corner ? (options.cornerBonus ?? 0) : 0)
      // The facade's outward normal is its local +z, so it has to point back
      // across the carriageway — which is inward for frontage standing outside
      // the ring and outward for frontage standing inside it.
      const facadeX = -sample.nx * options.side
      const facadeZ = -sample.nz * options.side
      out.push({
        x: sample.x,
        z: sample.z,
        width: Math.max(.5, lot - (options.gap ?? .06)),
        depth: options.depth,
        height: Math.max(.6, storeys * options.storeyHeight),
        rotationY: Math.atan2(facadeX, facadeZ),
        color: options.palette[Math.floor(hashUnit(seed + 11) * options.palette.length) % options.palette.length],
        lit: hashUnit(seed + 23) < options.litChance,
        roof: options.roof,
        corner,
      })
    }
  }
  return out
}

/**
 * Frontage along a straight street running out from a centre — the radial
 * lanes that connect a village green or a monumental rond-point to its
 * surroundings. Density decays with distance, which is what makes the
 * settlement dissolve into countryside instead of ending at a hard edge.
 */
export function radialFrontage(
  centre: XZ,
  angle: number,
  from: number,
  to: number,
  spec: BlockSpec,
  options?: { falloff?: number; sides?: number[] },
) {
  const out: PlannedBuilding[] = []
  const dirX = Math.cos(angle)
  const dirZ = Math.sin(angle)
  const sides = options?.sides ?? [-1, 1]
  const falloff = options?.falloff ?? .55
  const lots = subdivideFrontage(to - from, spec.lotMin, spec.lotMax, spec.seed + 401)
  let cursor = from
  lots.forEach((lot, index) => {
    const distance = cursor + lot / 2
    cursor += lot
    for (const side of sides) {
      const seed = spec.seed + index * 71 + (side > 0 ? 3301 : 0)
      // Density decays with distance from the centre; the far end of a lane
      // is mostly gaps with the occasional cottage.
      const survival = 1 - falloff * ((distance - from) / Math.max(.001, to - from))
      if (hashUnit(seed * 7 + 13) > survival) continue
      const storeySpan = Math.max(0, spec.storeysMax - spec.storeysMin)
      const storeys = spec.storeysMin + hashUnit(seed) * storeySpan * survival
      const depth = spec.buildingDepth * (.8 + hashUnit(seed + 9) * .28)
      const lateral = (spec.setback + depth / 2) * side
      out.push({
        x: centre[0] + dirX * distance - dirZ * lateral,
        z: centre[1] + dirZ * distance + dirX * lateral,
        width: Math.max(.5, lot - spec.gap),
        depth,
        height: Math.max(.55, storeys * spec.storeyHeight),
        rotationY: side > 0 ? -angle + Math.PI / 2 : -angle - Math.PI / 2,
        color: spec.palette[Math.floor(hashUnit(seed + 11) * spec.palette.length) % spec.palette.length],
        lit: hashUnit(seed + 23) < spec.litChance,
        roof: spec.roof,
        corner: false,
      })
    }
  })
  return out
}

/**
 * The bid-rent curve, in one function: land nearer the centre is worth more,
 * so it is built taller and covers more of its lot. `centrality` is 1 at the
 * core and 0 at the edge of the settlement.
 */
export function zoningProfile(centrality: number, options: {
  coreStoreys: [number, number]
  fringeStoreys: [number, number]
  coreLot: [number, number]
  fringeLot: [number, number]
  coreGap: number
  fringeGap: number
}) {
  const mix = (a: number, b: number) => a + (b - a) * centrality
  return {
    storeysMin: mix(options.fringeStoreys[0], options.coreStoreys[0]),
    storeysMax: mix(options.fringeStoreys[1], options.coreStoreys[1]),
    lotMin: mix(options.fringeLot[0], options.coreLot[0]),
    lotMax: mix(options.fringeLot[1], options.coreLot[1]),
    gap: mix(options.fringeGap, options.coreGap),
  }
}

export function isReserved(x: number, z: number, reserved: ReservedSite[], pad = 0) {
  return reserved.some((site) => Math.hypot(site.x - x, site.z - z) < site.radius + pad)
}

/* ============================================================================
 * The corridor: laying out a place *from* its main street.
 *
 * Everything above this line plans a settlement as a grid and then has to find
 * somewhere in it to put the player's route. That ordering is the reason the
 * route has read as a strip dropped through unrelated terrain across three
 * attempts: the grid does not know the route exists, so the route can only ever
 * be a void cut through it, with a bare margin on both sides where the grid was
 * pushed away.
 *
 * A real high street is the other way round. The street comes first; it is the
 * organising spine. Frontage is measured from *it*, so the building line
 * follows its bends and the setback stays constant even where the street does
 * not run straight. Side streets meet it at junctions rather than passing near
 * it. Depth of development, and the intensity of use, fall away from it.
 *
 * So the model here is a curvilinear coordinate system: distance `s` along the
 * street, and signed lateral offset `d` from its centreline (positive to the
 * left of travel). Every lot, junction, tree, bench and block behind is placed
 * in (s, d) and converted to world space at the end. Nothing needs to know the
 * street's shape, and the shape can be as crooked as it likes.
 *
 * This module stays free of Three.js — the scene builder samples its route
 * curve into a polyline and hands that over — so the plan remains testable
 * data and the builder stays responsible for geometry and instancing.
 * ========================================================================== */

export type CorridorSample = {
  /** Arc length from the start of the corridor. */
  s: number
  x: number
  z: number
  /** Unit tangent, pointing along increasing `s`. */
  tx: number
  tz: number
}

export type Corridor = {
  length: number
  samples: CorridorSample[]
  /** World position at distance `s` along the street, offset `d` to its left. */
  at(s: number, d?: number): XZ
  tangent(s: number): XZ
  /**
   * Facade heading for a building on `side` of the street. A facade's outward
   * normal is its local +z, so it has to point back across the carriageway.
   */
  facing(s: number, side: 1 | -1): number
  /** Nearest distance from a world point to the centreline, and where. */
  project(x: number, z: number): { s: number; d: number; distance: number }
}

/**
 * Resamples an authored polyline at uniform arc length.
 *
 * Uniform spacing is what makes `at()` cheap and, more importantly, makes lot
 * frontage measured in `s` correspond to real frontage on the ground. Sampling
 * an unevenly-spaced control polygon instead gives lots that are visibly wider
 * wherever the author happened to place points further apart.
 */
export function buildCorridor(points: XZ[], resolution = .25): Corridor {
  // Catmull-Rom through the control points, so the street has the same smooth
  // shape the drawn route does rather than a chain of straight chords.
  const dense: XZ[] = []
  const count = points.length
  const pointAt = (index: number) => points[Math.max(0, Math.min(count - 1, index))]
  for (let index = 0; index < count - 1; index += 1) {
    const p0 = pointAt(index - 1)
    const p1 = pointAt(index)
    const p2 = pointAt(index + 1)
    const p3 = pointAt(index + 2)
    const steps = 12
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps
      const t2 = t * t
      const t3 = t2 * t
      dense.push([
        .5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        .5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  dense.push(points[count - 1])

  // Cumulative length along the dense polyline, then walk it at fixed spacing.
  const cumulative: number[] = [0]
  for (let index = 1; index < dense.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(dense[index][0] - dense[index - 1][0], dense[index][1] - dense[index - 1][1]))
  }
  const total = cumulative[cumulative.length - 1]
  const samples: CorridorSample[] = []
  const steps = Math.max(2, Math.ceil(total / resolution))
  let cursor = 0
  for (let step = 0; step <= steps; step += 1) {
    const s = total * (step / steps)
    while (cursor < cumulative.length - 2 && cumulative[cursor + 1] < s) cursor += 1
    const span = Math.max(1e-6, cumulative[cursor + 1] - cumulative[cursor])
    const blend = (s - cumulative[cursor]) / span
    const a = dense[cursor]
    const b = dense[cursor + 1]
    const x = a[0] + (b[0] - a[0]) * blend
    const z = a[1] + (b[1] - a[1]) * blend
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const magnitude = Math.max(1e-6, Math.hypot(dx, dz))
    samples.push({ s, x, z, tx: dx / magnitude, tz: dz / magnitude })
  }

  const sampleAt = (s: number) => {
    const clamped = Math.max(0, Math.min(total, s))
    const index = Math.max(0, Math.min(samples.length - 1, Math.round(clamped / total * steps)))
    return samples[index]
  }

  return {
    length: total,
    samples,
    at(s, d = 0) {
      const sample = sampleAt(s)
      // Left normal of the tangent, so positive `d` is consistently one side.
      return [sample.x - sample.tz * d, sample.z + sample.tx * d]
    },
    tangent(s) {
      const sample = sampleAt(s)
      return [sample.tx, sample.tz]
    },
    facing(s, side) {
      const sample = sampleAt(s)
      // Normal pointing away from the street on this side; the facade must
      // look back down it, hence the negation.
      const nx = -sample.tz * side
      const nz = sample.tx * side
      return Math.atan2(-nx, -nz)
    },
    project(x, z) {
      let best = samples[0]
      let bestDistance = Number.POSITIVE_INFINITY
      for (const sample of samples) {
        const distance = (sample.x - x) ** 2 + (sample.z - z) ** 2
        if (distance < bestDistance) { bestDistance = distance; best = sample }
      }
      // Signed offset: cross product of the tangent with the offset vector.
      const d = -best.tz * (x - best.x) + best.tx * (z - best.z)
      return { s: best.s, d, distance: Math.sqrt(bestDistance) }
    },
  }
}

export type CrossStreet = {
  /** Where it meets the spine. */
  s: number
  /** Which side it leaves on; a street that crosses appears once per side. */
  side: 1 | -1
  streetClass: StreetClass
  /** How far out from the spine it runs. */
  reach: number
  /** World polyline from the spine's kerb outwards. */
  points: XZ[]
}

/**
 * Side streets meeting the spine at junctions.
 *
 * Two details do most of the work of making these read as a street network
 * rather than as ticks on a ruler. First, spacing varies around a block module
 * instead of being constant — a real block is "about ninety metres", not
 * exactly. Second, each street leaves the junction perpendicular and only then
 * drifts off square, because junction geometry is the one place real streets
 * *are* square, and a side street that meets its arterial at a visible angle is
 * the single clearest sign a layout was generated rather than laid out.
 */
export function corridorCrossStreets(corridor: Corridor, options: {
  module: number
  /** Random share of the module added or removed, 0..1. */
  jitter?: number
  seed: number
  /** Distance from each end left free of junctions. */
  margin?: number
  reach: (s: number, side: 1 | -1) => number
  streetClass?: (index: number, side: 1 | -1) => StreetClass
  /** Return false to suppress a junction — a bridge, a park frontage, a quay. */
  allow?: (s: number, side: 1 | -1) => boolean
}): CrossStreet[] {
  const out: CrossStreet[] = []
  const jitter = options.jitter ?? .3
  const margin = options.margin ?? options.module * .6
  let s = margin
  let index = 0
  while (s < corridor.length - margin) {
    for (const side of [-1, 1] as const) {
      if (options.allow && !options.allow(s, side)) continue
      const reach = options.reach(s, side)
      if (reach < 1.2) continue
      const streetClass = options.streetClass?.(index, side) ?? (index % 3 === 0 ? 'collector' : 'local')
      // A gentle bend away from square, applied with distance so the junction
      // itself stays true.
      const bend = (hashUnit(options.seed + index * 61 + (side > 0 ? 977 : 0)) - .5) * .34
      const points: XZ[] = []
      const steps = 6
      for (let step = 0; step <= steps; step += 1) {
        const fraction = step / steps
        const outward = 1.05 + (reach - 1.05) * fraction
        // Drift measured along the spine, growing quadratically with distance.
        const drift = bend * reach * fraction * fraction
        points.push(corridor.at(s + drift, outward * side))
      }
      out.push({ s, side, streetClass, reach, points })
    }
    const step = options.module * (1 + (hashUnit(options.seed + index * 137) - .5) * 2 * jitter)
    s += Math.max(options.module * .45, step)
    index += 1
  }
  return out
}

/** What a lot on the street is used for. Drives geometry, colour and props. */
export type LandUse = 'shopfront' | 'civic' | 'housing' | 'workshop' | 'green' | 'plaza' | 'forecourt'

export type FrontageLot = {
  s: number
  side: 1 | -1
  /** Frontage along the street. */
  width: number
  /** Depth back from the building line. */
  depth: number
  setback: number
  x: number
  z: number
  rotationY: number
  height: number
  storeys: number
  use: LandUse
  color: number
  lit: boolean
  roof: RoofForm
  /** True where the lot abuts a junction — the corner sites. */
  corner: boolean
}

/**
 * Develops the street wall on both sides of the spine.
 *
 * Frontage is cut in corridor space, so a lot's width is genuine frontage
 * however the street bends, and the building line sits at a constant setback
 * from the kerb. Junctions are cut out of the run with a corner splay, which is
 * what leaves the corner sites reading as corners.
 */
export function corridorFrontage(corridor: Corridor, crossStreets: CrossStreet[], options: {
  seed: number
  lotMin: number
  lotMax: number
  setback: (s: number, side: 1 | -1) => number
  depth: (s: number, side: 1 | -1) => number
  storeyHeight: number
  storeys: (s: number, side: 1 | -1, use: LandUse) => [number, number]
  use: (s: number, side: 1 | -1, seed: number, corner: boolean) => LandUse
  palette: (use: LandUse, seed: number) => number
  roof?: (use: LandUse, storeys: number, seed: number) => RoofForm
  litChance?: (use: LandUse) => number
  margin?: number
  /** Suppress a lot entirely — a bridge deck, a reserved headquarters site. */
  allow?: (s: number, side: 1 | -1) => boolean
  /** Chance a lot is left as a gap: a yard, a passage, an infill site. */
  vacancy?: (s: number, side: 1 | -1) => number
  /**
   * Gap left between a building and its lot boundary, halved on each side.
   *
   * The default .16 is a side yard, and a terrace built with one is not a
   * terrace: every unit stands as its own object with a sliver of ground
   * showing between it and its neighbour, which at map scale is exactly the
   * "each building placed separately" read. Party-wall frontage — a continuous
   * shopping street, a strip-mall unit row — wants this near zero so adjacent
   * units meet, and it is the lot *widths* that vary, not the gaps.
   */
  partyGap?: number
}): FrontageLot[] {
  const out: FrontageLot[] = []
  const margin = options.margin ?? .8
  for (const side of [-1, 1] as const) {
    // Junction gaps on this side, as [from, to] in `s`.
    const gaps = crossStreets
      .filter((street) => street.side === side)
      .map((street) => {
        const half = streetWidth(street.streetClass) / 2 + .34
        return [street.s - half, street.s + half] as [number, number]
      })
      .sort((a, b) => a[0] - b[0])

    // The runs of frontage left between the junctions.
    const runs: Array<[number, number]> = []
    let cursor = margin
    for (const [from, to] of gaps) {
      if (from > cursor) runs.push([cursor, from])
      cursor = Math.max(cursor, to)
    }
    if (corridor.length - margin > cursor) runs.push([cursor, corridor.length - margin])

    let counter = 0
    for (const [from, to] of runs) {
      const run = to - from
      if (run < options.lotMin) continue
      const lots = subdivideFrontage(run, options.lotMin, options.lotMax, options.seed + Math.round(from * 13) + (side > 0 ? 5081 : 0))
      let position = from
      for (const lot of lots) {
        const centre = position + lot / 2
        position += lot
        counter += 1
        const seed = options.seed + counter * 29 + (side > 0 ? 3557 : 0)
        if (options.allow && !options.allow(centre, side)) continue
        // Within a lot-and-a-half of either end of the run is a corner site.
        const corner = centre - from < options.lotMax * 1.1 || to - centre < options.lotMax * 1.1
        const vacancy = options.vacancy?.(centre, side) ?? 0
        if (vacancy && hashUnit(seed * 3 + 7) < vacancy) continue
        const use = options.use(centre, side, seed, corner)
        const [storeysMin, storeysMax] = options.storeys(centre, side, use)
        const storeys = storeysMin + hashUnit(seed) * Math.max(0, storeysMax - storeysMin)
        const setback = options.setback(centre, side)
        const depth = options.depth(centre, side)
        const [x, z] = corridor.at(centre, (setback + depth / 2) * side)
        const roof = options.roof?.(use, storeys, seed) ?? (storeys > 3.2 ? 'parapet' : 'pitched')
        out.push({
          s: centre,
          side,
          width: Math.max(.45, lot - (options.partyGap ?? .16)),
          depth,
          setback,
          x,
          z,
          rotationY: corridor.facing(centre, side),
          height: Math.max(.5, storeys * options.storeyHeight),
          storeys,
          use,
          color: options.palette(use, seed),
          lit: hashUnit(seed + 23) < (options.litChance?.(use) ?? .2),
          roof,
          corner,
        })
      }
    }
  }
  return out
}

/**
 * The blocks behind the street wall, between consecutive side streets.
 *
 * These are what stop the corridor being a stage flat one building deep. They
 * sit in corridor space too, so the whole quarter shears with the street rather
 * than reverting to the world axes the moment you look past the frontage —
 * which is exactly the seam that made previous attempts read as a path laid
 * over an unrelated grid.
 */
export function corridorBackland(corridor: Corridor, crossStreets: CrossStreet[], options: {
  seed: number
  /** Lateral band the blocks occupy, measured from the centreline. */
  from: (side: 1 | -1) => number
  to: (side: 1 | -1) => number
  rows?: number
}): BlockRect[] {
  const out: BlockRect[] = []
  const rows = options.rows ?? 1
  for (const side of [-1, 1] as const) {
    const junctions = crossStreets.filter((street) => street.side === side).map((street) => street.s).sort((a, b) => a - b)
    if (junctions.length < 2) continue
    const near = options.from(side)
    const far = options.to(side)
    if (far - near < 1.4) continue
    const rowDepth = (far - near) / rows
    for (let index = 0; index < junctions.length - 1; index += 1) {
      const start = junctions[index]
      const end = junctions[index + 1]
      const width = end - start - .9
      if (width < 1.5) continue
      for (let row = 0; row < rows; row += 1) {
        const inner = near + rowDepth * row
        const depth = rowDepth - .8
        if (depth < 1.1) continue
        const centreS = (start + end) / 2
        const centreD = (inner + depth / 2 + .4) * side
        const [x, z] = corridor.at(centreS, centreD)
        const [tx, tz] = corridor.tangent(centreS)
        out.push({
          x,
          z,
          width,
          depth,
          // Blocks are aligned to the street, not to the world.
          rotation: -Math.atan2(tz, tx),
          frontage: row === 0 ? 'collector' : 'local',
          row,
          column: index,
          seed: options.seed + index * 419 + row * 71 + (side > 0 ? 2803 : 0),
        })
      }
    }
  }
  return out
}

/**
 * Somewhere along the street that is deliberately not built on.
 *
 * A high street with an unbroken wall of shops for its whole length is as
 * artificial as a field of scattered boxes. Squares, greens and waterfronts are
 * planned absences, and siting them by name — rather than leaving whatever gaps
 * a collision test happens to produce — is what makes them read as places.
 */
export type CorridorVoid = {
  s: number
  side: 1 | -1
  /** Along the street. */
  length: number
  /** Back from the building line. */
  depth: number
  use: Extract<LandUse, 'green' | 'plaza' | 'forecourt'>
}

export function voidCovers(voids: CorridorVoid[], s: number, side: 1 | -1, pad = 0) {
  return voids.some((hole) => hole.side === side && Math.abs(hole.s - s) < hole.length / 2 + pad)
}

/** Removes any planned building that would stand on a reserved site. */
export function clearReserved(buildings: PlannedBuilding[], reserved: ReservedSite[]) {
  if (!reserved.length) return buildings
  return buildings.filter((building) => !isReserved(building.x, building.z, reserved, Math.max(building.width, building.depth) * .45))
}
