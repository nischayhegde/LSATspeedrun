import * as THREE from 'three'
import type { XZ } from './map-agents'

/**
 * Keeping the things that move clear of the things that do not.
 *
 * The traffic simulation drives agents down the centrelines the district
 * contributed and has no idea what is standing on them. Nothing ever told it,
 * and nothing ever checked: measured on the shipped scenes, a car was
 * intersecting solid geometry on **every frame** of the Old Quarter, a train ran
 * through The Circuit's parish church for a third of the run, and a berthed boat
 * on the Treaty Sea sat permanently inside the pier it was tied up to.
 *
 * Braking for it is the wrong fix. A lamp post in a lane is not traffic that
 * will move off, so a vehicle that yielded to it would stop there for good and
 * the queue behind it with it. The fault is in the authoring — a carriageway and
 * a building were laid out by unrelated passes and nobody reconciled them — so
 * this reconciles them, once, at build time, in the only place that knows about
 * every street and every prop at the same moment.
 *
 * Two consumers, because the scene holds its two populations differently.
 * Distant buildings are instances in a batched mesh and can only be moved while
 * they are still a plan, so they are filtered as records; props are real objects
 * and are nudged in place.
 */

/** A strip of ground that has to stay clear, and by how much. */
export type ClearanceCorridor = {
  points: XZ[]
  /**
   * Half-width of the strip to keep clear. This is not the carriageway's own
   * half-width: it is that plus the half-width of the widest body that will use
   * it, because the thing being kept out has to clear the *vehicle*, not the
   * kerb.
   */
  halfWidth: number
  closed?: boolean
  /** For diagnostics only. */
  label?: string
}

type Segment = {
  x0: number; z0: number
  dx: number; dz: number
  length: number
  halfWidth: number
  /** The corridor's `label`, carried through so an intrusion can name it. */
  label?: string
}

export type ClearanceField = {
  segments: Segment[]
  cells: Map<number, number[]>
  cellSize: number
  columns: number
  originX: number
  originZ: number
}

/**
 * A grid index keyed on a packed cell number rather than a string, because this
 * is queried once per prop and once per planned building on every scene build
 * and the string keys were measurable in the build time.
 */
function cellIndex(field: ClearanceField, x: number, z: number) {
  const column = Math.floor((x - field.originX) / field.cellSize)
  const row = Math.floor((z - field.originZ) / field.cellSize)
  return row * field.columns + column
}

export function prepareClearance(corridors: ClearanceCorridor[], cellSize = 4): ClearanceField {
  const segments: Segment[] = []
  for (const corridor of corridors) {
    const points = corridor.points
    if (points.length < 2) continue
    const last = corridor.closed ? points.length : points.length - 1
    for (let index = 0; index < last; index += 1) {
      const [x0, z0] = points[index]
      const [x1, z1] = points[(index + 1) % points.length]
      const dx = x1 - x0
      const dz = z1 - z0
      const length = Math.hypot(dx, dz)
      if (length < 1e-4) continue
      segments.push({ x0, z0, dx: dx / length, dz: dz / length, length, halfWidth: corridor.halfWidth, label: corridor.label })
    }
  }
  const field: ClearanceField = {
    segments,
    cells: new Map(),
    cellSize,
    columns: 1,
    originX: 0,
    originZ: 0,
  }
  if (!segments.length) return field
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const segment of segments) {
    const x1 = segment.x0 + segment.dx * segment.length
    const z1 = segment.z0 + segment.dz * segment.length
    minX = Math.min(minX, segment.x0 - segment.halfWidth, x1 - segment.halfWidth)
    maxX = Math.max(maxX, segment.x0 + segment.halfWidth, x1 + segment.halfWidth)
    minZ = Math.min(minZ, segment.z0 - segment.halfWidth, z1 - segment.halfWidth)
    maxZ = Math.max(maxZ, segment.z0 + segment.halfWidth, z1 + segment.halfWidth)
  }
  field.originX = Math.floor(minX) - cellSize
  field.originZ = Math.floor(minZ) - cellSize
  field.columns = Math.ceil((maxX - field.originX) / cellSize) + 2
  const rows = Math.ceil((maxZ - field.originZ) / cellSize) + 2
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const x1 = segment.x0 + segment.dx * segment.length
    const z1 = segment.z0 + segment.dz * segment.length
    const c0 = Math.max(0, Math.floor((Math.min(segment.x0, x1) - segment.halfWidth - field.originX) / cellSize))
    const c1 = Math.min(field.columns - 1, Math.floor((Math.max(segment.x0, x1) + segment.halfWidth - field.originX) / cellSize))
    const r0 = Math.max(0, Math.floor((Math.min(segment.z0, z1) - segment.halfWidth - field.originZ) / cellSize))
    const r1 = Math.min(rows - 1, Math.floor((Math.max(segment.z0, z1) + segment.halfWidth - field.originZ) / cellSize))
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        const key = row * field.columns + column
        const bucket = field.cells.get(key)
        if (bucket) bucket.push(index)
        else field.cells.set(key, [index])
      }
    }
  }
  return field
}

export type Intrusion = {
  /** How far inside the cleared strip the disc reaches, in world units. */
  depth: number
  /** Unit direction to push along to get out, away from the centreline. */
  x: number
  z: number
  /**
   * Which corridor it is standing in, where it is, and how wide it keeps.
   *
   * A parcel that cannot be sited is the hardest thing in this area to
   * diagnose: the ground looks empty from above and each audit tool answers a
   * different question. Asking the field to name the offender is what
   * identified the Old Quarter's blockers as the ward lanes rather than the
   * avenues everyone had assumed.
   */
  label?: string
  atX?: number
  atZ?: number
  halfWidth?: number
}

/**
 * An oriented rectangular footprint, for callers whose object is not round.
 *
 * A disc is the right body for a lamp post and the wrong one for a building.
 * Tested as its inscribed disc, a 3.2 by 1.1 block lying *across* a street
 * reads as a 0.55 radius object 0.22 from the centreline and clears; tested as
 * itself it is 1.68 of solid wall over the carriageway. That is how the
 * Sovereign Arc kept a car inside a building on three quarters of its frames
 * with the clearance pass switched on and reporting success.
 */
export type Footprint = {
  /** Half-extents in the footprint's own frame. */
  hx: number
  hz: number
  /** `Math.cos`/`Math.sin` of its `rotationY`, precomputed by the caller. */
  cos: number
  sin: number
}

/**
 * The rectangle's half-extent along a direction — its support width.
 *
 * This is what makes the test honest without making it timid: a building that
 * fronts the street it stands on presents its *depth* to the carriageway, which
 * is the same small figure the inscribed disc used, so nothing that was
 * correctly placed moves. Only a footprint turned across the street grows.
 */
function support(footprint: Footprint, dirX: number, dirZ: number) {
  // Local axes in world space for a three.js `rotation.y`.
  const alongX = Math.abs(dirX * footprint.cos - dirZ * footprint.sin)
  const alongZ = Math.abs(dirX * footprint.sin + dirZ * footprint.cos)
  return alongX * footprint.hx + alongZ * footprint.hz
}

/**
 * How far a disc of `radius` at (x, z) reaches into the nearest cleared strip.
 *
 * The deepest intrusion wins, and its escape direction is the one that is
 * perpendicular to the offending segment: pushing along the shortest way out is
 * what keeps a nudged building parallel to the street it was set back from
 * rather than sliding along it.
 *
 * `footprint` replaces the disc with an oriented rectangle. `radius` is still
 * required and is used to size the broad-phase query, so it should be the
 * rectangle's circumscribed radius when one is given.
 */
export function clearanceIntrusion(
  field: ClearanceField,
  x: number,
  z: number,
  radius: number,
  footprint?: Footprint,
): Intrusion | null {
  if (!field.segments.length) return null
  let deepest: Intrusion | null = null
  const reach = radius
  const c0 = Math.floor((x - reach - field.originX) / field.cellSize)
  const c1 = Math.floor((x + reach - field.originX) / field.cellSize)
  const r0 = Math.floor((z - reach - field.originZ) / field.cellSize)
  const r1 = Math.floor((z + reach - field.originZ) / field.cellSize)
  const seen = new Set<number>()
  for (let row = r0; row <= r1; row += 1) {
    for (let column = c0; column <= c1; column += 1) {
      const bucket = field.cells.get(row * field.columns + column)
      if (!bucket) continue
      for (const index of bucket) {
        if (seen.has(index)) continue
        seen.add(index)
        const segment = field.segments[index]
        const offsetX = x - segment.x0
        const offsetZ = z - segment.z0
        const along = Math.max(0, Math.min(segment.length, offsetX * segment.dx + offsetZ * segment.dz))
        const nearestX = segment.x0 + segment.dx * along
        const nearestZ = segment.z0 + segment.dz * along
        const awayX = x - nearestX
        const awayZ = z - nearestZ
        const distance = Math.hypot(awayX, awayZ)
        // The body's reach towards this particular strip. For a rectangle that
        // is its support width along the strip's own normal, so the same block
        // is a thin thing to the street it fronts and a wide one to the street
        // it lies across.
        const bodyReach = footprint ? support(footprint, -segment.dz, segment.dx) : radius
        const depth = segment.halfWidth + bodyReach - distance
        if (depth <= 0) continue
        if (deepest && depth <= deepest.depth) continue
        // On the centreline itself there is no "away", so the segment's own
        // normal is used: a prop dropped exactly on a street still has to pick
        // a side, and either side is equally correct.
        const scale = distance > 1e-4 ? 1 / distance : 0
        const named = { label: segment.label, atX: nearestX, atZ: nearestZ, halfWidth: segment.halfWidth }
        deepest = scale
          ? { depth, x: awayX * scale, z: awayZ * scale, ...named }
          : { depth, x: -segment.dz, z: segment.dx, ...named }
      }
    }
  }
  return deepest
}

export type ClearanceReport = {
  considered: number
  moved: number
  dropped: number
  /**
   * Objects that are in a lane and were left there because they are protected.
   * Never silently swallowed: a level entrance or a selectable landmark standing
   * in a carriageway is a planning fault that has to be fixed where it was
   * authored, and the only way that happens is if it is reported rather than
   * quietly deleted.
   */
  protectedIntrusions: number
  worstBefore: number
  worstAfter: number
  /** The deepest few intrusions found, for the harness to point a camera at. */
  sites: Array<{ x: number; z: number; depth: number; label: string; action: 'moved' | 'dropped' | 'protected' }>
}

function emptyReport(): ClearanceReport {
  return { considered: 0, moved: 0, dropped: 0, protectedIntrusions: 0, worstBefore: 0, worstAfter: 0, sites: [] }
}

/**
 * Push a point out of every corridor it intrudes into, or give up.
 *
 * Iterated, because clearing one street can push something into the next one
 * along — which is common at a crossroads, where two corridors overlap and the
 * only clear ground is diagonally out of both. Four passes settles every case
 * in these districts; the fifth has never moved one.
 *
 * A caller working against the *pedestrian* network needs more. A district grid
 * puts a second street behind the first, so leaving one pavement is commonly
 * entering another, and the clear ground is two or three corridors away rather
 * than one. `passes` is therefore the caller's, and only the callers that ask
 * for more get more.
 */
function escape(field: ClearanceField, x: number, z: number, radius: number, limit: number, footprint?: Footprint, passes = 4) {
  let atX = x
  let atZ = z
  let first = 0
  for (let pass = 0; pass < passes; pass += 1) {
    const intrusion = clearanceIntrusion(field, atX, atZ, radius, footprint)
    if (!intrusion) return { x: atX, z: atZ, first, cleared: true, travelled: Math.hypot(atX - x, atZ - z) }
    if (pass === 0) first = intrusion.depth
    // A hair past the edge, so a floating-point equal case does not re-trigger.
    atX += intrusion.x * (intrusion.depth + .01)
    atZ += intrusion.z * (intrusion.depth + .01)
    if (Math.hypot(atX - x, atZ - z) > limit) {
      return { x, z, first, cleared: false, travelled: 0 }
    }
  }
  const remaining = clearanceIntrusion(field, atX, atZ, radius, footprint)
  return remaining
    ? { x, z, first, cleared: false, travelled: 0 }
    : { x: atX, z: atZ, first, cleared: true, travelled: Math.hypot(atX - x, atZ - z) }
}

/**
 * The nearest point to `(x, z)` at which a disc of `radius` is out of every
 * corridor, for a caller placing something by hand.
 *
 * The pair of a site and the thing standing on it has to move together — the
 * building, its selection collider, its emphasis ring and the anchor the player
 * walks to — so an authored site is best corrected before anything is built on
 * it, rather than by shoving the finished object afterwards. Returns the original
 * point when no clear ground is within `limit`, so a caller that cannot honour the
 * correction still gets a usable answer.
 */
export function escapeCorridors(
  field: ClearanceField,
  x: number,
  z: number,
  radius: number,
  limit = 1.6,
  footprint?: Footprint,
  passes?: number,
) {
  const result = escape(field, x, z, radius, limit, footprint, passes)
  return { x: result.x, z: result.z, moved: result.travelled, cleared: result.cleared, before: result.first }
}

/** A planned building, as far as this pass needs to know. */
export type PlacedRecord = { x: number; z: number; width: number; depth: number; rotationY?: number }

/** The record as an oriented rectangle, which is what it actually is. */
function footprintOf(record: PlacedRecord): Footprint {
  const angle = record.rotationY ?? 0
  return { hx: record.width / 2, hz: record.depth / 2, cos: Math.cos(angle), sin: Math.sin(angle) }
}

/**
 * Filter a set of planned buildings so none of them stands in a corridor.
 *
 * A building is nudged if a small move clears it and dropped if not, because a
 * block whose frontage genuinely overlaps the carriageway is a planning fault
 * and the honest repair is that the building is not there. `limit` is deliberately
 * modest: a metre of slide is invisible in a street wall, and anything more
 * would be moving a building somewhere it was never designed to be.
 */
export function keepRecordsClear<T extends PlacedRecord>(
  records: T[],
  field: ClearanceField,
  { limit = 1.1, label = 'building' } = {},
): { kept: T[]; report: ClearanceReport } {
  const report = emptyReport()
  if (!field.segments.length) return { kept: records, report }
  const kept: T[] = []
  for (const record of records) {
    report.considered += 1
    // Tested as the rectangle it is, against each street's own normal. The
    // inscribed disc that stood here read a block lying across a carriageway as
    // a small round thing beside it, which is most of what was left of the
    // vehicle-in-building count once the pass was switched on.
    const footprint = footprintOf(record)
    const radius = Math.hypot(footprint.hx, footprint.hz)
    const result = escape(field, record.x, record.z, radius, limit, footprint)
    if (result.first > 0) report.worstBefore = Math.max(report.worstBefore, result.first)
    if (!result.cleared) {
      report.dropped += 1
      if (report.sites.length < 12) report.sites.push({ x: +record.x.toFixed(2), z: +record.z.toFixed(2), depth: +result.first.toFixed(3), label, action: 'dropped' })
      continue
    }
    if (result.travelled > 1e-3) {
      report.moved += 1
      if (report.sites.length < 12) report.sites.push({ x: +record.x.toFixed(2), z: +record.z.toFixed(2), depth: +result.first.toFixed(3), label, action: 'moved' })
      kept.push({ ...record, x: result.x, z: result.z })
    } else {
      kept.push(record)
    }
  }
  for (const record of kept) {
    const footprint = footprintOf(record)
    const remaining = clearanceIntrusion(field, record.x, record.z, Math.hypot(footprint.hx, footprint.hz), footprint)
    if (remaining) report.worstAfter = Math.max(report.worstAfter, remaining.depth)
  }
  return { kept, report }
}

/**
 * Nudge every placed object with a footprint out of the corridors, removing the
 * ones that cannot be cleared.
 *
 * Operates on objects rather than records, so it has to run before
 * `batchStaticScenery` merges them away. `footprintRadius` is the same figure
 * the crowd already steers around, which is the point: the set a person has to
 * walk round and the set a vehicle has to not drive through are the same set,
 * and maintaining two of them is how they drift apart.
 */
export function clearObjects(
  root: THREE.Object3D,
  field: ClearanceField,
  { limit = 1.4, keepAbove = 1.2, protect = () => false }: {
    limit?: number
    /**
     * Footprint radius above which an object is reported rather than removed.
     *
     * A bench, a bollard or a bike rack in a lane should just not be there, and
     * deleting it is the right repair. A church, a farmstead or a courthouse in a
     * lane is a different fault entirely — the *lane* is in the wrong place — and
     * quietly deleting the village church to make a train fit would be trading a
     * visible collision for a much worse invisible one.
     */
    keepAbove?: number
    /** Anything the district cannot lose: level entrances, selectable landmarks. */
    protect?: (object: THREE.Object3D) => boolean
  } = {},
): ClearanceReport {
  const report = emptyReport()
  if (!field.segments.length) return report
  const doomed: THREE.Object3D[] = []
  const world = new THREE.Vector3()
  root.updateWorldMatrix(true, true)
  const name = (object: THREE.Object3D) => String(
    object.userData?.propAudit?.name ?? object.userData?.mapSelection?.key ?? object.name ?? 'prop',
  )
  root.traverse((object) => {
    const radius = object.userData?.footprintRadius as number | undefined
    if (typeof radius !== 'number' || radius <= 0) return
    const keep = protect(object) || radius > keepAbove
    report.considered += 1
    // World position, since a prop may be a child of a group the pass placed.
    object.getWorldPosition(world)
    const result = escape(field, world.x, world.z, radius, limit)
    if (result.first > 0) report.worstBefore = Math.max(report.worstBefore, result.first)
    if (!result.cleared) {
      // Nudging failed. Something that may not be removed is reported instead, so
      // the conflict surfaces as a number rather than as a missing church.
      if (keep) {
        report.protectedIntrusions += 1
        if (report.sites.length < 24) report.sites.push({ x: +world.x.toFixed(2), z: +world.z.toFixed(2), depth: +result.first.toFixed(3), label: name(object), action: 'protected' })
        return
      }
      doomed.push(object)
      if (report.sites.length < 24) report.sites.push({ x: +world.x.toFixed(2), z: +world.z.toFixed(2), depth: +result.first.toFixed(3), label: name(object), action: 'dropped' })
      return
    }
    if (result.travelled > 1e-3) {
      report.moved += 1
      object.position.x += result.x - world.x
      object.position.z += result.z - world.z
      if (report.sites.length < 24) report.sites.push({ x: +world.x.toFixed(2), z: +world.z.toFixed(2), depth: +result.first.toFixed(3), label: name(object), action: 'moved' })
    }
  })
  for (const object of doomed) {
    report.dropped += 1
    object.parent?.remove(object)
  }
  return report
}
