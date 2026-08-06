/**
 * A navigable representation of a floor, plus the steering that walks a body
 * across it.
 *
 * The scenes in this app used to move their characters by lerping between two
 * authored points. That is not navigation: the straight line between a desk
 * and a doorway is a straight line whether or not there is a chair on it, and
 * every "route" had to be re-authored by hand whenever the furniture moved.
 * When it fell out of date - which it did, because furniture is generated from
 * the player's purchases and the room grows with tier - characters walked
 * through desks.
 *
 * This module replaces that with an actual walkable surface:
 *
 *   1. `NavField` rasterises the floor into a grid, marks every cell covered by
 *      an obstacle, and runs a chamfer distance transform so every free cell
 *      knows how far it is from the nearest blocked one. That clearance field
 *      does three jobs at once - it inflates obstacles by the body radius for
 *      free, it lets the planner prefer the middle of a corridor over scraping
 *      a desk corner, and its gradient gives a cheap, always-correct push-out
 *      for a body that somehow ends up inside geometry.
 *   2. `findPath` is A* over that grid, followed by string-pulling against a
 *      supercover line-of-sight test, so the result is a short polyline through
 *      open floor rather than a staircase of grid cells.
 *   3. `NavAgent` follows the polyline with acceleration limits, a limited turn
 *      rate, speed that falls off while turning, arrival easing, and reciprocal
 *      separation from other agents. It reports the ground speed it actually
 *      achieved, which is what the gait clip needs in order not to skate.
 *
 * Nothing here knows about three.js scene structure beyond plain numbers, so it
 * is equally usable by the office interior and by the map's pedestrians.
 */

/** An axis-aligned rectangle on the XZ plane, in world units. */
export type NavRect = { minX: number; minZ: number; maxX: number; maxZ: number }

/** A point on the floor. */
export type NavPoint = { x: number; z: number }

export type NavFieldOptions = {
  /** Outer walkable rectangle. Cells outside it are blocked. */
  bounds: NavRect
  /** Obstacle footprints in world XZ. Overlapping entries are fine. */
  obstacles: readonly NavRect[]
  /**
   * Grid resolution in world units. 0.15-0.25 is the useful range for a room:
   * fine enough to find a gap between a chair and a desk, coarse enough that
   * the whole field builds in well under a millisecond.
   */
  cell?: number
  /**
   * How much clearance a path would *like* to have. Cells with less are still
   * walkable but cost more, which is what keeps bodies off furniture corners
   * instead of grazing them.
   */
  preferredClearance?: number
}

const SQRT2 = Math.SQRT2

/**
 * A rasterised floor with a clearance field over it.
 *
 * Build one per scene (or per rebuild), then query it from the animation loop.
 * Every query is allocation-free apart from `findPath`, which returns a fresh
 * array.
 */
export class NavField {
  readonly bounds: NavRect
  readonly cell: number
  readonly cols: number
  readonly rows: number
  readonly obstacles: readonly NavRect[]
  readonly preferredClearance: number

  /** 1 where an obstacle or out-of-bounds, 0 where open floor. */
  private readonly blocked: Uint8Array
  /** World-unit distance from each cell centre to the nearest blocked cell. */
  private readonly clearance: Float32Array

  // A* scratch, retained so repeated planning does not churn the heap.
  private readonly gScore: Float32Array
  private readonly fScore: Float32Array
  private readonly cameFrom: Int32Array
  private readonly visitStamp: Int32Array
  /** Marks cells already expanded this search. See the pop loop. */
  private readonly closedStamp: Int32Array
  private visitEpoch = 0
  private readonly openHeap: number[] = []

  constructor(options: NavFieldOptions) {
    this.bounds = options.bounds
    this.cell = options.cell ?? .18
    this.obstacles = options.obstacles
    this.preferredClearance = options.preferredClearance ?? .42
    this.cols = Math.max(1, Math.ceil((this.bounds.maxX - this.bounds.minX) / this.cell))
    this.rows = Math.max(1, Math.ceil((this.bounds.maxZ - this.bounds.minZ) / this.cell))
    const count = this.cols * this.rows
    this.blocked = new Uint8Array(count)
    this.clearance = new Float32Array(count)
    this.gScore = new Float32Array(count)
    this.fScore = new Float32Array(count)
    this.cameFrom = new Int32Array(count)
    this.visitStamp = new Int32Array(count)
    this.closedStamp = new Int32Array(count)
    this.rasterise()
    this.buildClearance()
  }

  private index(col: number, row: number) { return row * this.cols + col }
  private colOf(x: number) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.bounds.minX) / this.cell)))
  }
  private rowOf(z: number) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.bounds.minZ) / this.cell)))
  }
  private centreX(col: number) { return this.bounds.minX + (col + .5) * this.cell }
  private centreZ(row: number) { return this.bounds.minZ + (row + .5) * this.cell }

  private rasterise() {
    for (const rect of this.obstacles) {
      // Mark any cell the rectangle touches at all, not just cells whose
      // centre it contains. Under-marking a thin obstacle - a chair leg, a
      // shelf edge - is what lets a body clip its corner.
      const c0 = this.colOf(rect.minX - this.cell)
      const c1 = this.colOf(rect.maxX + this.cell)
      const r0 = this.rowOf(rect.minZ - this.cell)
      const r1 = this.rowOf(rect.maxZ + this.cell)
      for (let row = r0; row <= r1; row += 1) {
        const cz = this.centreZ(row)
        if (cz + this.cell * .5 < rect.minZ || cz - this.cell * .5 > rect.maxZ) continue
        for (let col = c0; col <= c1; col += 1) {
          const cx = this.centreX(col)
          if (cx + this.cell * .5 < rect.minX || cx - this.cell * .5 > rect.maxX) continue
          this.blocked[this.index(col, row)] = 1
        }
      }
    }
  }

  /**
   * Two-pass chamfer distance transform. The room boundary counts as blocked,
   * so a body is pushed away from walls by exactly the same machinery that
   * pushes it away from a desk.
   */
  private buildClearance() {
    const { cols, rows, cell, clearance, blocked } = this
    const far = (cols + rows) * cell
    for (let index = 0; index < clearance.length; index += 1) {
      clearance[index] = blocked[index] ? 0 : far
    }
    const relax = (index: number, from: number, weight: number) => {
      const candidate = clearance[from] + weight
      if (candidate < clearance[index]) clearance[index] = candidate
    }
    // Outside the grid is solid: seed the border from a virtual blocked ring.
    for (let col = 0; col < cols; col += 1) {
      const top = this.index(col, 0)
      const bottom = this.index(col, rows - 1)
      if (clearance[top] > cell) clearance[top] = cell
      if (clearance[bottom] > cell) clearance[bottom] = cell
    }
    for (let row = 0; row < rows; row += 1) {
      const left = this.index(0, row)
      const right = this.index(cols - 1, row)
      if (clearance[left] > cell) clearance[left] = cell
      if (clearance[right] > cell) clearance[right] = cell
    }
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = this.index(col, row)
        if (!clearance[index]) continue
        if (row > 0) {
          relax(index, this.index(col, row - 1), cell)
          if (col > 0) relax(index, this.index(col - 1, row - 1), cell * SQRT2)
          if (col < cols - 1) relax(index, this.index(col + 1, row - 1), cell * SQRT2)
        }
        if (col > 0) relax(index, this.index(col - 1, row), cell)
      }
    }
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let col = cols - 1; col >= 0; col -= 1) {
        const index = this.index(col, row)
        if (!clearance[index]) continue
        if (row < rows - 1) {
          relax(index, this.index(col, row + 1), cell)
          if (col > 0) relax(index, this.index(col - 1, row + 1), cell * SQRT2)
          if (col < cols - 1) relax(index, this.index(col + 1, row + 1), cell * SQRT2)
        }
        if (col < cols - 1) relax(index, this.index(col + 1, row), cell)
      }
    }
  }

  /** Distance from a world point to the nearest obstacle or wall, bilinear. */
  clearanceAt(x: number, z: number): number {
    const fx = (x - this.bounds.minX) / this.cell - .5
    const fz = (z - this.bounds.minZ) / this.cell - .5
    const c0 = Math.min(this.cols - 1, Math.max(0, Math.floor(fx)))
    const r0 = Math.min(this.rows - 1, Math.max(0, Math.floor(fz)))
    const c1 = Math.min(this.cols - 1, c0 + 1)
    const r1 = Math.min(this.rows - 1, r0 + 1)
    const tx = Math.min(1, Math.max(0, fx - c0))
    const tz = Math.min(1, Math.max(0, fz - r0))
    const a = this.clearance[this.index(c0, r0)]
    const b = this.clearance[this.index(c1, r0)]
    const c = this.clearance[this.index(c0, r1)]
    const d = this.clearance[this.index(c1, r1)]
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
  }

  /**
   * Direction of increasing clearance, i.e. "the way out". Returns false when
   * the sample sits on a plateau and there is nothing useful to say.
   */
  escapeDirection(x: number, z: number, out: { x: number; z: number }): boolean {
    const step = this.cell
    const dx = this.clearanceAt(x + step, z) - this.clearanceAt(x - step, z)
    const dz = this.clearanceAt(x, z + step) - this.clearanceAt(x, z - step)
    const length = Math.hypot(dx, dz)
    if (length < 1e-5) return false
    out.x = dx / length
    out.z = dz / length
    return true
  }

  /** Is a body of `radius` able to stand at this point? */
  isFree(x: number, z: number, radius = 0): boolean {
    return this.clearanceAt(x, z) >= radius
  }

  /**
   * Nearest standable point to a requested one. Spirals outward over the grid
   * rather than stepping along the clearance gradient, because a point buried
   * deep inside a desk has no useful gradient.
   */
  nearestFree(x: number, z: number, radius: number, out: NavPoint = { x: 0, z: 0 }): NavPoint {
    if (this.isFree(x, z, radius)) { out.x = x; out.z = z; return out }
    const startCol = this.colOf(x)
    const startRow = this.rowOf(z)
    const limit = Math.max(this.cols, this.rows)
    for (let ring = 1; ring <= limit; ring += 1) {
      let best = -1
      let bestDistance = Infinity
      for (let row = startRow - ring; row <= startRow + ring; row += 1) {
        if (row < 0 || row >= this.rows) continue
        const edge = Math.abs(row - startRow) === ring
        for (let col = startCol - ring; col <= startCol + ring; col += 1) {
          if (col < 0 || col >= this.cols) continue
          if (!edge && Math.abs(col - startCol) !== ring) continue
          const index = this.index(col, row)
          if (this.clearance[index] < radius) continue
          const px = this.centreX(col)
          const pz = this.centreZ(row)
          const distance = (px - x) * (px - x) + (pz - z) * (pz - z)
          if (distance < bestDistance) { bestDistance = distance; best = index }
        }
      }
      if (best >= 0) {
        out.x = this.centreX(best % this.cols)
        out.z = this.centreZ(Math.floor(best / this.cols))
        return out
      }
    }
    out.x = x
    out.z = z
    return out
  }

  /**
   * Supercover line test: walks every cell the segment touches, so a segment
   * that slips diagonally between two blocked cells is correctly rejected.
   */
  lineOfSight(ax: number, az: number, bx: number, bz: number, radius: number): boolean {
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) return this.isFree(ax, az, radius)
    const steps = Math.ceil(length / (this.cell * .5))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      if (this.clearanceAt(ax + dx * t, az + dz * t) < radius) return false
    }
    return true
  }

  /**
   * A* from one world point to another, returned as a string-pulled polyline
   * that always starts at `from` and ends at the reachable point closest to
   * `to`. Returns an empty array only if the start itself cannot be resolved.
   */
  findPath(from: NavPoint, to: NavPoint, radius: number): NavPoint[] {
    const start = this.nearestFree(from.x, from.z, radius)
    const startCol = this.colOf(start.x)
    const startRow = this.rowOf(start.z)
    const goal = this.nearestFree(to.x, to.z, radius)
    const goalCol = this.colOf(goal.x)
    const goalRow = this.rowOf(goal.z)
    const startIndex = this.index(startCol, startRow)
    const goalIndex = this.index(goalCol, goalRow)
    if (startIndex === goalIndex) return this.pull([{ x: from.x, z: from.z }, { x: goal.x, z: goal.z }], radius)

    this.visitEpoch += 1
    const epoch = this.visitEpoch
    const { cols, rows, cell, clearance, gScore, fScore, cameFrom, visitStamp, closedStamp, openHeap } = this
    openHeap.length = 0
    const heuristic = (index: number) => {
      const col = index % cols
      const row = (index - col) / cols
      return Math.hypot(col - goalCol, row - goalRow) * cell
    }
    const push = (index: number) => {
      openHeap.push(index)
      let child = openHeap.length - 1
      while (child > 0) {
        const parent = (child - 1) >> 1
        if (fScore[openHeap[parent]] <= fScore[openHeap[child]]) break
        const swap = openHeap[parent]; openHeap[parent] = openHeap[child]; openHeap[child] = swap
        child = parent
      }
    }
    const pop = () => {
      const top = openHeap[0]
      const last = openHeap.pop() as number
      if (openHeap.length) {
        openHeap[0] = last
        let parent = 0
        for (;;) {
          const left = parent * 2 + 1
          const right = left + 1
          let best = parent
          if (left < openHeap.length && fScore[openHeap[left]] < fScore[openHeap[best]]) best = left
          if (right < openHeap.length && fScore[openHeap[right]] < fScore[openHeap[best]]) best = right
          if (best === parent) break
          const swap = openHeap[best]; openHeap[best] = openHeap[parent]; openHeap[parent] = swap
          parent = best
        }
      }
      return top
    }

    visitStamp[startIndex] = epoch
    gScore[startIndex] = 0
    fScore[startIndex] = heuristic(startIndex)
    cameFrom[startIndex] = -1
    push(startIndex)

    let reached = -1
    // Best-effort target, kept as the search runs.
    //
    // A room is not always fully connected at a given body radius: a
    // workstation bay can be walled in by its own desk and chair, and a player
    // is free to drag a chair into the only gap. When that happens the honest
    // answer is not "no path" - a body that cannot reach the far side of the
    // room can still walk to the near edge of the bay - and it is certainly
    // not the stay-put path this used to hand back, which read to the caller
    // as a completed errand and left half the room's staff standing at their
    // desks for the whole session. So the closest reachable cell is
    // remembered, and if the goal proves unreachable the walk goes there.
    let closest = startIndex
    let closestScore = heuristic(startIndex)
    // The heap holds duplicates by design.
    //
    // Improving a cell's score pushes it again rather than sifting the old
    // entry out, which is the usual "lazy deletion" A* and is much cheaper per
    // relaxation - but it means the number of *pops* is not bounded by the
    // number of cells, and with a squeeze penalty that reorders the frontier
    // it can run to several times it. Bounding the loop by pops alone
    // therefore truncated long searches, and truncation here is invisible:
    // the function falls back to its closest-reachable answer and hands back a
    // path to somewhere three metres away, which the caller cannot tell from a
    // genuinely walled-off destination. It was not even monotone in radius - a
    // narrower body could fail a route a wider one completed - which is how it
    // was caught. Skipping cells that have already been expanded restores the
    // real bound (every cell is expanded at most once) and makes the guard the
    // safety net it was meant to be rather than a search limit.
    let guard = cols * rows * 8
    while (openHeap.length && guard-- > 0) {
      const current = pop()
      if (closedStamp[current] === epoch) continue
      closedStamp[current] = epoch
      if (current === goalIndex) { reached = current; break }
      const distance = heuristic(current)
      if (distance < closestScore) { closestScore = distance; closest = current }
      const col = current % cols
      const row = (current - col) / cols
      for (let dz = -1; dz <= 1; dz += 1) {
        const nextRow = row + dz
        if (nextRow < 0 || nextRow >= rows) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dz) continue
          const nextCol = col + dx
          if (nextCol < 0 || nextCol >= cols) continue
          const neighbour = this.index(nextCol, nextRow)
          if (closedStamp[neighbour] === epoch) continue
          if (clearance[neighbour] < radius) continue
          // Refuse to cut a corner between two blocked cells.
          if (dx && dz) {
            if (clearance[this.index(col + dx, row)] < radius) continue
            if (clearance[this.index(col, row + dz)] < radius) continue
          }
          const step = (dx && dz ? SQRT2 : 1) * cell
          // Hugging furniture is walkable but expensive, so an open lane wins
          // whenever one exists.
          const squeeze = Math.max(0, this.preferredClearance + radius - clearance[neighbour])
          const tentative = gScore[current] + step * (1 + squeeze * 2.4)
          if (visitStamp[neighbour] !== epoch || tentative < gScore[neighbour]) {
            visitStamp[neighbour] = epoch
            gScore[neighbour] = tentative
            fScore[neighbour] = tentative + heuristic(neighbour)
            cameFrom[neighbour] = current
            push(neighbour)
          }
        }
      }
    }

    const end = reached >= 0 ? reached : closest
    // Nothing worth walking: the search never got anywhere the body is not
    // already standing. An empty path says so, so a caller can choose another
    // destination instead of believing it has arrived.
    if (end === startIndex) return []
    const reversed: NavPoint[] = []
    for (let node = end; node >= 0; node = cameFrom[node]) {
      const col = node % cols
      const row = (node - col) / cols
      reversed.push({ x: this.centreX(col), z: this.centreZ(row) })
      if (cameFrom[node] < 0) break
    }
    reversed.reverse()
    reversed[0] = { x: from.x, z: from.z }
    if (reached >= 0) reversed.push({ x: goal.x, z: goal.z })
    return this.pull(reversed, radius)
  }

  /** String-pull: drop any waypoint the previous kept point can already see. */
  private pull(points: NavPoint[], radius: number): NavPoint[] {
    if (points.length <= 2) return points
    const output: NavPoint[] = [points[0]]
    let anchor = 0
    while (anchor < points.length - 1) {
      let furthest = anchor + 1
      for (let probe = points.length - 1; probe > anchor + 1; probe -= 1) {
        if (this.lineOfSight(points[anchor].x, points[anchor].z, points[probe].x, points[probe].z, radius)) {
          furthest = probe
          break
        }
      }
      output.push(points[furthest])
      anchor = furthest
    }
    return output
  }

  /**
   * Labels every free cell with the index of the walkable region it belongs
   * to, for a body of `radius`. Cells too tight for that body get -1.
   */
  private label(radius: number): { labels: Int32Array; count: number } {
    const { cols, rows, clearance } = this
    const labels = new Int32Array(cols * rows).fill(-1)
    const stack: number[] = []
    let count = 0
    for (let seed = 0; seed < labels.length; seed += 1) {
      if (labels[seed] >= 0 || clearance[seed] < radius) continue
      const id = count
      count += 1
      labels[seed] = id
      stack.length = 0
      stack.push(seed)
      while (stack.length) {
        const node = stack.pop() as number
        const col = node % cols
        const row = (node - col) / cols
        if (col > 0) { const next = node - 1; if (labels[next] < 0 && clearance[next] >= radius) { labels[next] = id; stack.push(next) } }
        if (col < cols - 1) { const next = node + 1; if (labels[next] < 0 && clearance[next] >= radius) { labels[next] = id; stack.push(next) } }
        if (row > 0) { const next = node - cols; if (labels[next] < 0 && clearance[next] >= radius) { labels[next] = id; stack.push(next) } }
        if (row < rows - 1) { const next = node + cols; if (labels[next] < 0 && clearance[next] >= radius) { labels[next] = id; stack.push(next) } }
      }
    }
    return { labels, count }
  }

  /**
   * The largest body radius at which all of these points share one walkable
   * region, or `minimum` if no radius in range achieves it.
   *
   * Rooms in this game are assembled from whatever the player has bought, so
   * whether an aisle is wide enough for a given body is a property of the save
   * file, not something anyone can guarantee while authoring. Measured at tier
   * nine, the free floor is a single region for a body of radius 0.30 and
   * shatters into seven disconnected pockets at 0.32 - one bay per member of
   * staff - because a wall shelf pinches the west aisle to 0.38 units. Every
   * character was therefore sealed into their own bay: routes existed only to
   * places they could already stand, so the room's staff simply never walked,
   * which is a large part of why the scene looked static.
   *
   * Rather than hand-tune a radius per tier, the scene asks for the widest one
   * that keeps its people connected. Furniture footprints here are axis-
   * aligned boxes around meshes that are mostly narrower than their bounds, so
   * a body passing a little closer than its shoulder half-width is a fair
   * trade for a room that can actually be walked. Bodies still keep their full
   * radius from each other.
   */
  connectedRadius(points: readonly NavPoint[], maximum: number, minimum: number): number {
    if (points.length < 2) return maximum
    const step = this.cell * .25
    for (let radius = maximum; radius > minimum; radius -= step) {
      if (this.pointsConnected(points, radius)) return radius
    }
    return minimum
  }

  /** Do all these points sit in the same walkable region at this radius? */
  pointsConnected(points: readonly NavPoint[], radius: number): boolean {
    const { labels } = this.label(radius)
    let shared = -1
    const probe: NavPoint = { x: 0, z: 0 }
    for (const point of points) {
      this.nearestFree(point.x, point.z, radius, probe)
      const index = this.index(this.colOf(probe.x), this.rowOf(probe.z))
      const id = labels[index]
      if (id < 0) return false
      if (shared < 0) shared = id
      else if (id !== shared) return false
    }
    return true
  }

  /** Debug aid: the blocked mask as a row-major array of 0/1. */
  debugMask(): Uint8Array { return this.blocked.slice() }

  /** Debug aid: how many walkable regions exist for a body of this radius. */
  debugRegions(radius: number): number { return this.label(radius).count }
}

export type NavAgentOptions = {
  radius?: number
  /**
   * Radius used against furniture, if it differs from the one used against
   * other bodies. Defaults to `radius`.
   *
   * The two are not the same problem. Two people occupy space that genuinely
   * cannot overlap. A person and a desk overlap all the time - shoulders pass
   * over a desk edge, a jacket brushes a chair - and the desk's footprint here
   * is an axis-aligned box drawn around a mesh that is usually narrower than
   * its bounds. Holding furniture to the full shoulder half-width closes
   * aisles that a person would walk down without noticing.
   */
  passRadius?: number
  /** Comfortable cruising speed in world units per second. */
  maxSpeed?: number
  /** How hard the body can change speed. Lower reads as more weight. */
  acceleration?: number
  /** Radians per second the body can turn on the spot. */
  turnRate?: number
  /**
   * How far ahead of contact the body starts steering around other bodies.
   *
   * Separation on overlap alone is a collision response, not avoidance: it
   * fires once two people are already inside each other and resolves along
   * the line between them, which for a head-on meeting is a straight shove
   * backwards. Both bodies then re-aim at the waypoint behind the other and
   * shove again. Give them a metre of warning and they read as two people
   * noticing each other and each drifting a shoulder's width aside, which is
   * both what happens in a corridor and what breaks the deadlock.
   */
  lookahead?: number
}

const TAU = Math.PI * 2
const wrapAngle = (angle: number) => {
  const wrapped = (angle + Math.PI) % TAU
  return (wrapped < 0 ? wrapped + TAU : wrapped) - Math.PI
}

/**
 * A body walking a path across a `NavField`.
 *
 * The steering deliberately reads as weight rather than as a cursor being
 * dragged: speed is integrated through an acceleration limit so starts and
 * stops take time, heading is integrated through a turn-rate limit so corners
 * are arcs, and the speed target is scaled down while the heading error is
 * large so the body slows into a turn and accelerates out of it. Those three
 * together are what stop a walk cycle from looking like a slide.
 */
export class NavAgent {
  x = 0
  z = 0
  heading = 0
  /** Ground speed actually achieved last update. Feed this to the gait. */
  speed = 0
  radius: number
  /** Radius honoured against the navigation field. See `NavAgentOptions`. */
  passRadius: number
  maxSpeed: number
  acceleration: number
  turnRate: number
  /** Distance at which other bodies start bending this one's course. */
  lookahead: number

  private path: NavPoint[] = []
  private leg = 0
  private desiredSpeed = 0
  private readonly escape = { x: 0, z: 0 }
  /** Seconds spent loitering next to the final waypoint without reaching it. */
  private dwell = 0

  constructor(options: NavAgentOptions = {}) {
    this.radius = options.radius ?? .32
    this.passRadius = options.passRadius ?? this.radius
    this.maxSpeed = options.maxSpeed ?? 1.15
    this.acceleration = options.acceleration ?? 1.9
    this.turnRate = options.turnRate ?? 3.2
    this.lookahead = options.lookahead ?? 1.05
  }

  get hasPath() { return this.leg < this.path.length }
  get remainingLegs() { return Math.max(0, this.path.length - this.leg) }

  /** Current goal, or null when the agent is standing still. */
  get goal(): NavPoint | null {
    return this.path.length ? this.path[this.path.length - 1] : null
  }

  place(x: number, z: number, heading = this.heading) {
    this.x = x
    this.z = z
    this.heading = heading
    this.speed = 0
    this.path = []
    this.leg = 0
  }

  setPath(points: NavPoint[]) {
    // Drop a leading waypoint that is effectively where we already stand, so
    // the first heading target is a direction the body can act on.
    this.path = points
    this.leg = 0
    this.dwell = 0
    while (this.leg < this.path.length - 1
      && Math.hypot(this.path[this.leg].x - this.x, this.path[this.leg].z - this.z) < this.radius * .5) {
      this.leg += 1
    }
  }

  clearPath() {
    this.path = []
    this.leg = 0
    this.dwell = 0
  }

  /**
   * Keep out of other bodies without going anywhere.
   *
   * A body that is not walking is not steered, and for most of a session most
   * of the cast is not walking: standing at a post, sitting at a desk, or
   * parked mid-errand. Those positions are set directly - eased onto a desk,
   * or simply left where the last step finished - and if nothing checks them
   * against the rest of the room then anyone can be walked into, and anyone
   * can be eased into someone already standing there. Neither party objects,
   * because neither party is running the steering that would have objected.
   *
   * Measured over 9,000 frames that was the whole of the remaining
   * interpenetration: the deepest overlap in the room, 19 cm, was one body
   * settling back onto its post through another that happened to be standing
   * on it. So the contact half of `update` runs for everyone, every frame,
   * whether or not they are going anywhere.
   *
   * Radial only, and half of it, exactly as in `update`: a stationary body
   * should be nudged out of a collision, not sent sliding around the room.
   */
  resolveContacts(
    field: NavField,
    neighbours: readonly { x: number; z: number; radius: number }[],
    /** Half-width to honour, when it differs from `radius` - a body tucked
     *  under a desk advertises less of itself, and should be held to what it
     *  advertises rather than being evicted from its own chair. */
    selfRadius = this.radius,
  ) {
    let nextX = this.x
    let nextZ = this.z
    for (const other of neighbours) {
      const dx = nextX - other.x
      const dz = nextZ - other.z
      const wanted = selfRadius + other.radius
      const distance = Math.hypot(dx, dz)
      if (distance >= wanted || distance < 1e-5) continue
      const push = (wanted - distance) * .5
      nextX += (dx / distance) * push
      nextZ += (dz / distance) * push
    }
    if (nextX === this.x && nextZ === this.z) return

    // Being shoved clear of a colleague is not a licence to stand in a desk -
    // but neither is it grounds for evicting somebody from their own chair.
    //
    // A stationary body is very often legitimately inside furniture: that is
    // what sitting down is, and the navigation field is quite right to call a
    // chair solid. Applying the full escape gradient here would climb out of
    // it at up to a pass radius per frame, every frame, against a settle that
    // is pulling straight back in - a body vibrating in and out of its own
    // desk, and shoving whoever stood behind it a third of a metre each time.
    //
    // So the escape only ever buys back the clearance the contact push just
    // spent. Somebody already in a chair stays in it; somebody pushed into one
    // is pushed straight back out.
    const before = field.clearanceAt(this.x, this.z)
    const after = field.clearanceAt(nextX, nextZ)
    if (after < this.passRadius && after < before && field.escapeDirection(nextX, nextZ, this.escape)) {
      const correction = Math.min(before - after, this.passRadius - after) + 1e-3
      nextX += this.escape.x * correction
      nextZ += this.escape.z * correction
    }
    this.x = nextX
    this.z = nextZ
  }

  /**
   * Advance one frame.
   *
   * `neighbours` are other bodies to stay out of; separation is reciprocal, so
   * each agent applies half the correction and the pair resolves without
   * either one being authoritative.
   */
  update(delta: number, field: NavField, neighbours: readonly { x: number; z: number; radius: number }[] = []) {
    if (delta <= 0) return
    const target = this.path[this.leg]
    let desiredHeading = this.heading
    let distanceToGoal = 0

    if (target) {
      const dx = target.x - this.x
      const dz = target.z - this.z
      const distance = Math.hypot(dx, dz)
      // Arrival radius scales with speed: at a walk you commit to the corner
      // early, standing still you have to reach it. The final point is held to
      // a tighter standard than a corner, because it is a destination rather
      // than something to round.
      const arrive = this.leg < this.path.length - 1
        ? Math.max(this.radius * .55, this.speed * .22)
        : Math.max(this.radius * .45, this.speed * .22)
      // Arriving is not the same as landing on the point.
      //
      // A tight acceptance radius plus a heading recomputed every frame is an
      // orbit: as the body closes on the waypoint the bearing to it swings
      // faster than the turn-rate limit can follow, the heading error grows,
      // the turn scale throttles the speed toward nothing, and the body hangs
      // a few centimetres out forever - moving too little to arrive and never
      // stopping either. The push-out makes it worse, because a waypoint whose
      // clearance is within a millimetre of the body's pass radius spends
      // every frame being nudged back out by however far the last step took it
      // in. Neither is hypothetical: between them they pinned the office cat to
      // one spot for an entire session, its patrol politely waiting for a leg
      // that was never going to complete.
      //
      // So there are two ways past a waypoint. Reaching it is one. Standing
      // beside it having run out of momentum is the other, and that is the one
      // that terminates an orbit, because an orbit is by definition slow and
      // close. The dwell has to be long enough not to fire on the natural
      // slow-down into a corner and short enough that a stuck body is not
      // visibly stuck.
      const passed = distance <= arrive
        || (distance < this.radius * 1.8 && this.speed < .1 && (this.dwell += delta) > .45)
      if (passed) {
        this.dwell = 0
        this.leg = this.leg < this.path.length - 1 ? this.leg + 1 : this.path.length
      } else if (distance >= this.radius * 1.8 || this.speed >= .1) {
        this.dwell = 0
      }
      if (distance > 1e-4) desiredHeading = Math.atan2(dx, dz)
      distanceToGoal = distance
      for (let index = this.leg; index < this.path.length - 1; index += 1) {
        distanceToGoal += Math.hypot(
          this.path[index + 1].x - this.path[index].x,
          this.path[index + 1].z - this.path[index].z,
        )
      }
    }

    // Pass on a side, and pick it before contact.
    //
    // Only bodies actually in the way count: something abreast or behind is
    // not an obstacle, and reacting to it would make a body swerve at people
    // it has already passed. For the ones ahead, the course bends away from
    // whichever side they are on, weighted by how close and how directly in
    // front they are, so a distant body barely registers and one about to be
    // walked into dominates.
    //
    // Two bodies exactly nose to nose are the case that matters, and it is
    // the one with no side to prefer. The tie is broken the same way in every
    // body's own frame, which is what makes it work: their frames are
    // opposed, so the same local choice sends them around opposite shoulders.
    if (target && neighbours.length) {
      const forwardX = Math.sin(desiredHeading)
      const forwardZ = Math.cos(desiredHeading)
      let bias = 0
      for (const other of neighbours) {
        const dx = other.x - this.x
        const dz = other.z - this.z
        const distance = Math.hypot(dx, dz)
        const range = this.radius + other.radius + this.lookahead
        if (distance >= range || distance < 1e-5) continue
        const ahead = (dx * forwardX + dz * forwardZ) / distance
        if (ahead <= .25) continue
        const side = (dx * forwardZ - dz * forwardX) / distance
        const urgency = (1 - distance / range) * ahead
        bias += (side >= 0 ? -1 : 1) * urgency
      }
      if (bias) {
        // Stepping aside is only polite if there is floor there. Choosing the
        // side purely from where the other body is will happily aim someone
        // into the desk run beside them, and once they are inside it the
        // push-out and the separation take turns shoving them back into each
        // other - a body pinned against furniture by a colleague, which is
        // exactly the standoff this is supposed to prevent. So the preferred
        // side is checked against the floor first and abandoned if it is a
        // desk, which in a corridor reliably sends both bodies the only way
        // either of them can actually go.
        const swing = Math.max(-1, Math.min(1, bias)) * .95
        const probe = this.radius + this.lookahead * .5
        const roomAt = (angle: number) => field.clearanceAt(
          this.x + Math.sin(angle) * probe,
          this.z + Math.cos(angle) * probe,
        )
        const preferred = roomAt(desiredHeading + swing)
        desiredHeading = wrapAngle(desiredHeading
          + (preferred >= this.passRadius || preferred >= roomAt(desiredHeading - swing) ? swing : -swing))
      }
    }

    const headingError = wrapAngle(desiredHeading - this.heading)
    const maxTurn = this.turnRate * delta
    this.heading = wrapAngle(this.heading + Math.max(-maxTurn, Math.min(maxTurn, headingError)))

    if (this.hasPath) {
      // Slow into corners, and ease the last stride into the goal rather than
      // stopping dead on it.
      const turnScale = Math.max(.18, 1 - Math.abs(headingError) / (Math.PI * .55))
      const brake = Math.min(1, Math.sqrt(Math.max(0, distanceToGoal) / Math.max(.35, this.maxSpeed * .62)))
      this.desiredSpeed = this.maxSpeed * turnScale * brake
    } else {
      this.desiredSpeed = 0
    }

    // Decelerating is allowed to be brisker than accelerating: bodies stop
    // faster than they start.
    const rate = this.desiredSpeed > this.speed ? this.acceleration : this.acceleration * 1.55
    const change = Math.max(-rate * delta, Math.min(rate * delta, this.desiredSpeed - this.speed))
    this.speed = Math.max(0, this.speed + change)

    let nextX = this.x + Math.sin(this.heading) * this.speed * delta
    let nextZ = this.z + Math.cos(this.heading) * this.speed * delta

    // Reciprocal separation. Each side moves half the overlap, which keeps two
    // bodies meeting head-on from shoving each other across the room.
    //
    // How much of the step the contact resolution was responsible for, so the
    // frame cap below can leave it alone. See the cap for why.
    let contactCorrection = 0
    for (const other of neighbours) {
      const dx = nextX - other.x
      const dz = nextZ - other.z
      const wanted = this.radius + other.radius
      const distance = Math.hypot(dx, dz)
      if (distance >= wanted || distance < 1e-5) continue
      const normalX = dx / distance
      const normalZ = dz / distance
      // Stop walking into it first, then push apart.
      //
      // Correcting position alone leaves a body still driving forward at
      // walking pace into a colleague it is already touching, so every frame
      // re-establishes most of the overlap the last frame removed and the pair
      // settles at whatever penetration one frame of that argument comes to.
      // Measured, that was two centimetres - a soft contact rather than a
      // clip, but two bodies visibly sharing space. Cancelling the component
      // of the step that points into the other body removes the thing being
      // corrected against, and the positional half-push then converges to
      // touching within a few frames instead of hovering above zero forever.
      //
      // Only the inward component goes; walking away, or past, is untouched,
      // so this brakes a collision without braking the recovery from one.
      const closing = (nextX - this.x) * normalX + (nextZ - this.z) * normalZ
      const blocked = closing < 0 ? -closing : 0
      if (blocked) {
        nextX += normalX * blocked
        nextZ += normalZ * blocked
      }
      const push = (wanted - distance) * .5
      nextX += normalX * push
      nextZ += normalZ * push
      // Part of the correction goes around rather than straight back, and so
      // does the motion that was just cancelled.
      //
      // Pure radial separation between two bodies that both want to be where
      // the other is has no way to end: each frame pushes them apart along the
      // line of centres and each frame they walk back down it. Sending some of
      // it tangentially turns that standoff into the pair rotating past one
      // another. Redirecting the cancelled approach the same way is what keeps
      // the cancellation from being a new way to get stuck: a body touching a
      // colleague still has somewhere to go, and it is around them, which is
      // what the walker was going to have to do regardless.
      //
      // The perpendicular is taken from the same difference vector both sides
      // compute, and that vector is negated between them, so the two slide
      // opposite ways and the rotation is coherent.
      const slide = (push + blocked) * .85
      nextX += -normalZ * slide
      nextZ += normalX * slide
      contactCorrection += blocked + push + slide
    }

    // Hard guarantee. Whatever the path said and whatever the separation did,
    // a body never finishes a frame inside furniture: if it is, it climbs the
    // clearance gradient until it is not. This is the backstop that makes
    // "walks through a desk" impossible rather than merely unlikely.
    let guard = 4
    while (guard-- > 0) {
      const clearance = field.clearanceAt(nextX, nextZ)
      if (clearance >= this.passRadius) break
      if (!field.escapeDirection(nextX, nextZ, this.escape)) {
        const rescue = field.nearestFree(nextX, nextZ, this.passRadius)
        nextX = rescue.x
        nextZ = rescue.z
        break
      }
      const correction = this.passRadius - clearance + 1e-3
      nextX += this.escape.x * correction
      nextZ += this.escape.z * correction
    }

    // Cap how far a single frame may move the body.
    //
    // The push-out above is a hard guarantee, and a body that starts a long
    // way inside geometry - someone rising from a chair, which the field quite
    // correctly regards as solid - would satisfy it by teleporting clear in
    // one frame. Limiting the step turns that into walking out over a couple
    // of tenths of a second instead, which is both what a person does and what
    // keeps the gait's speed input in a sane range. The guarantee still holds
    // within a few frames.
    //
    // Contact resolution is exempt. The cap exists for the escape gradient,
    // which can be metres deep; keeping people out of each other is at most a
    // couple of centimetres and is the one correction that must land in full,
    // because scaling it back is precisely how a residual overlap survives to
    // be visible.
    //
    // The allowance is a property of the body, not of what it did last frame.
    // Reading the previous frame's speed here made the cap self-referential:
    // the speed it compares against is itself derived from the distance the
    // cap allowed, so one large correction raised the ceiling that had been
    // holding corrections down, and the next one was free to be larger still.
    // Two bodies wedged between each other and a wall - the separation pushing
    // them apart, the wall's escape gradient pushing them back together - rode
    // that loop up to a measured 3.9 m/s, three and a half times a walk, and
    // shoved each other 19 cm deep in the process. Every one of the remaining
    // deep interpenetrations in the room was this.
    const budget = this.maxSpeed * 1.35 * delta + contactCorrection
    const stepX = nextX - this.x
    const stepZ = nextZ - this.z
    const stepLength = Math.hypot(stepX, stepZ)
    if (stepLength > budget && stepLength > 1e-6) {
      const scale = budget / stepLength
      nextX = this.x + stepX * scale
      nextZ = this.z + stepZ * scale
    }

    // Report the speed the body genuinely covered, separation and push-out
    // included. The gait is driven from this, so the feet agree with the floor
    // even on a frame where the agent was shoved sideways.
    //
    // Held to a walk, though. A frame in which contact resolution moved the
    // body further than a stride is a frame in which something was resolved,
    // not one in which the character sprinted, and handing that to the gait
    // asks the legs for a cadence no clip has.
    const travelled = Math.hypot(nextX - this.x, nextZ - this.z)
    this.speed = delta > 1e-5 ? Math.min(travelled / delta, this.maxSpeed * 1.35) : 0
    this.x = nextX
    this.z = nextZ
  }
}

export type ObstacleScanOptions = {
  /**
   * World-space vertical slab a body occupies. Anything whose bounding box
   * overlaps it is in the way; anything entirely above (a ceiling light, a wall
   * picture) or entirely below (a rug, the floor) is not.
   */
  minY: number
  maxY: number
  /** Footprints smaller than this on both axes are ignored as trim. */
  minFootprint?: number
  /** Footprints larger than this on both axes are treated as architecture. */
  maxFootprint?: number
  /** Return false to skip a subtree entirely (characters, halos, particles). */
  accept?: (object: { name?: string; userData?: Record<string, unknown> }) => boolean
}

/**
 * Minimal structural view of a three.js object, so this module stays free of a
 * three.js import and can be unit-tested with plain objects.
 */
export type ScannableObject = {
  name?: string
  visible?: boolean
  userData?: Record<string, unknown>
  children?: readonly ScannableObject[]
  isMesh?: boolean
  geometry?: { boundingBox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null; computeBoundingBox?: () => void }
  matrixWorld?: { elements: ArrayLike<number> }
}

/**
 * Derive obstacle footprints straight from a built scene.
 *
 * Authoring an obstacle list by hand next to a procedurally furnished room is
 * how the two drift apart, and drift is exactly what produced characters
 * walking through desks. Reading the geometry instead means the navigable floor
 * is correct for every tier and every combination of purchased furniture by
 * construction, including furniture the player has dragged.
 *
 * Call after the scene graph's world matrices are up to date.
 */
export function scanObstacleRects(root: ScannableObject, options: ObstacleScanOptions): NavRect[] {
  const rects: NavRect[] = []
  const minFootprint = options.minFootprint ?? .07
  const maxFootprint = options.maxFootprint ?? 1e9
  const corner = { x: 0, y: 0, z: 0 }

  const visit = (object: ScannableObject) => {
    if (object.visible === false) return
    if (options.accept && !options.accept(object)) return
    if (object.isMesh && object.geometry && object.matrixWorld) {
      const geometry = object.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox?.()
      const box = geometry.boundingBox
      if (box) {
        const e = object.matrixWorld.elements
        let minX = Infinity, minY = Infinity, minZ = Infinity
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
        for (let bit = 0; bit < 8; bit += 1) {
          corner.x = bit & 1 ? box.max.x : box.min.x
          corner.y = bit & 2 ? box.max.y : box.min.y
          corner.z = bit & 4 ? box.max.z : box.min.z
          const wx = e[0] * corner.x + e[4] * corner.y + e[8] * corner.z + e[12]
          const wy = e[1] * corner.x + e[5] * corner.y + e[9] * corner.z + e[13]
          const wz = e[2] * corner.x + e[6] * corner.y + e[10] * corner.z + e[14]
          if (wx < minX) minX = wx
          if (wx > maxX) maxX = wx
          if (wy < minY) minY = wy
          if (wy > maxY) maxY = wy
          if (wz < minZ) minZ = wz
          if (wz > maxZ) maxZ = wz
        }
        const overlapsBody = maxY > options.minY && minY < options.maxY
        const width = maxX - minX
        const depth = maxZ - minZ
        if (overlapsBody
          && (width >= minFootprint || depth >= minFootprint)
          && (width <= maxFootprint || depth <= maxFootprint)) {
          rects.push({ minX, minZ, maxX, maxZ })
        }
      }
    }
    const children = object.children
    if (children) for (const child of children) visit(child)
  }

  visit(root)
  return mergeRects(rects)
}

/**
 * Collapse a rect soup into a smaller equivalent set.
 *
 * A desk arrives as sixty separate primitives - a top, four legs, a monitor,
 * every key on its keyboard. Rasterising sixty overlapping rectangles gives the
 * same grid as rasterising the handful of unions they form, for a fraction of
 * the work, and keeps the debug output legible.
 */
export function mergeRects(input: readonly NavRect[], tolerance = .04): NavRect[] {
  const rects = input.map((rect) => ({ ...rect }))
  let merged = true
  let guard = 6
  while (merged && guard-- > 0) {
    merged = false
    for (let a = 0; a < rects.length; a += 1) {
      const left = rects[a]
      if (!left) continue
      for (let b = a + 1; b < rects.length; b += 1) {
        const right = rects[b]
        if (!right) continue
        const overlapX = Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX)
        const overlapZ = Math.min(left.maxZ, right.maxZ) - Math.max(left.minZ, right.minZ)
        if (overlapX < -tolerance || overlapZ < -tolerance) continue
        const unionArea = (Math.max(left.maxX, right.maxX) - Math.min(left.minX, right.minX))
          * (Math.max(left.maxZ, right.maxZ) - Math.min(left.minZ, right.minZ))
        const leftArea = (left.maxX - left.minX) * (left.maxZ - left.minZ)
        const rightArea = (right.maxX - right.minX) * (right.maxZ - right.minZ)
        // Only merge when the union does not invent much floor that neither
        // rectangle covered, or a chair beside a desk would swallow the gap
        // between them and close a real walkable lane.
        if (unionArea > (leftArea + rightArea) * 1.18 + .02) continue
        left.minX = Math.min(left.minX, right.minX)
        left.minZ = Math.min(left.minZ, right.minZ)
        left.maxX = Math.max(left.maxX, right.maxX)
        left.maxZ = Math.max(left.maxZ, right.maxZ)
        rects.splice(b, 1)
        b -= 1
        merged = true
      }
    }
  }
  return rects
}
