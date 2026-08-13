/**
 * District highlights as tiled land, not as circles around a pin.
 *
 * A landmark used to carry a pick radius, and the wash, the hover ring and the
 * held accent were all the same disc scaled to that radius. That reads as a
 * pin with a glow. A district is a *region*: the Old Quarter is cut into
 * wards by its own streets, The Circuit into the towns and holdings that
 * divide the county, the sea into named water. Neighbouring districts have to
 * meet along a shared edge, not stack as overlapping discs.
 *
 * Two coverings, one mesh per district either way:
 *
 *   lattice   the region's own street grid, cell from centreline to
 *             centreline, assigned to the nearest landmark. This is what the
 *             Old Quarter uses, so a highlight is the blocks that belong to
 *             that ward.
 *   voronoi   a bound polygon (rectangle or ellipse) clipped by the
 *             perpendicular bisectors of the other sites. Used where there is
 *             no covering lattice — the county, the sea, the Arc, the deck.
 *
 * Fills are one merged BufferGeometry per layer (unsigned / held). Edges are
 * a fat ribbon, also merged. Hover and selection swap onto a pair of overlay
 * meshes rather than adding a mesh per district.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type XZ = [number, number]

export type DistrictTile = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type DistrictSite = {
  key: string
  x: number
  z: number
}

export type RegionBound =
  | { kind: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: 'ellipse'; cx: number; cz: number; rx: number; rz: number; segments: number }

export type DistrictRegion = {
  key: string
  fill: THREE.BufferGeometry
  edge: THREE.BufferGeometry
  contains: (x: number, z: number) => boolean
}

const FILL_Y = .095
const EDGE_Y = .16
const EDGE_WIDTH = .11
const INSET = .08

/** Street-centre to street-centre cells of a grid, so neighbouring tiles meet. */
export function tilesFromGrid(
  avenues: Array<{ position: number }>,
  streets: Array<{ position: number }>,
): DistrictTile[] {
  const ns = [...avenues].sort((a, b) => a.position - b.position)
  const ew = [...streets].sort((a, b) => a.position - b.position)
  const tiles: DistrictTile[] = []
  for (let column = 0; column < ns.length - 1; column += 1) {
    const minX = ns[column].position
    const maxX = ns[column + 1].position
    if (maxX - minX < .05) continue
    for (let row = 0; row < ew.length - 1; row += 1) {
      const minZ = ew[row].position
      const maxZ = ew[row + 1].position
      if (maxZ - minZ < .05) continue
      tiles.push({ minX, maxX, minZ, maxZ })
    }
  }
  return tiles
}

/** A regular lattice covering a rectangle, used where the region has no street grid. */
export function tilesFromRect(bound: Extract<RegionBound, { kind: 'rect' }>, step: number): DistrictTile[] {
  const tiles: DistrictTile[] = []
  const originX = bound.minX
  const originZ = bound.minZ
  const cols = Math.max(1, Math.round((bound.maxX - bound.minX) / step))
  const rows = Math.max(1, Math.round((bound.maxZ - bound.minZ) / step))
  const width = (bound.maxX - bound.minX) / cols
  const depth = (bound.maxZ - bound.minZ) / rows
  for (let column = 0; column < cols; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      tiles.push({
        minX: originX + column * width,
        maxX: originX + (column + 1) * width,
        minZ: originZ + row * depth,
        maxZ: originZ + (row + 1) * depth,
      })
    }
  }
  return tiles
}

export function boundPolygon(bound: RegionBound): XZ[] {
  if (bound.kind === 'rect') {
    return [
      [bound.minX, bound.minZ],
      [bound.maxX, bound.minZ],
      [bound.maxX, bound.maxZ],
      [bound.minX, bound.maxZ],
    ]
  }
  const ring: XZ[] = []
  for (let step = 0; step < bound.segments; step += 1) {
    const angle = step / bound.segments * Math.PI * 2
    ring.push([bound.cx + Math.cos(angle) * bound.rx, bound.cz + Math.sin(angle) * bound.rz])
  }
  return ring
}

function tileCenter(tile: DistrictTile): XZ {
  return [(tile.minX + tile.maxX) / 2, (tile.minZ + tile.maxZ) / 2]
}

function nearestSite(sites: DistrictSite[], x: number, z: number) {
  let best = sites[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const site of sites) {
    const distance = Math.hypot(site.x - x, site.z - z)
    if (distance < bestDistance) {
      best = site
      bestDistance = distance
    }
  }
  return best
}

function pointInRing(ring: XZ[], x: number, z: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i]
    const [xj, zj] = ring[j]
    const crosses = (zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function pointInTile(tile: DistrictTile, x: number, z: number) {
  return x >= tile.minX && x <= tile.maxX && z >= tile.minZ && z <= tile.maxZ
}

function signedArea(ring: XZ[]) {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return area / 2
}

function ensureCcw(ring: XZ[]) {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring
}

function intersect(a: XZ, b: XZ, px: number, pz: number, nx: number, nz: number): XZ {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const denom = dx * nx + dz * nz
  const t = Math.abs(denom) < 1e-9 ? 0 : ((px - a[0]) * nx + (pz - a[1]) * nz) / denom
  const u = Math.min(1, Math.max(0, t))
  return [a[0] + dx * u, a[1] + dz * u]
}

/** Keep the side of the infinite line through the midpoint of A–B that contains A. */
function clipHalfPlane(ring: XZ[], ax: number, az: number, bx: number, bz: number): XZ[] {
  const mx = (ax + bx) / 2
  const mz = (az + bz) / 2
  const nx = bx - ax
  const nz = bz - az
  const inside = (p: XZ) => (p[0] - mx) * nx + (p[1] - mz) * nz <= 1e-7
  const out: XZ[] = []
  for (let i = 0; i < ring.length; i += 1) {
    const current = ring[i]
    const previous = ring[(i + ring.length - 1) % ring.length]
    const currentIn = inside(current)
    const previousIn = inside(previous)
    if (currentIn) {
      if (!previousIn) out.push(intersect(previous, current, mx, mz, nx, nz))
      out.push(current)
    } else if (previousIn) {
      out.push(intersect(previous, current, mx, mz, nx, nz))
    }
  }
  return out
}

function voronoiCell(site: DistrictSite, sites: DistrictSite[], bound: XZ[]): XZ[] {
  let cell = bound
  for (const other of sites) {
    if (other.key === site.key) continue
    if (Math.hypot(other.x - site.x, other.z - site.z) < 1e-4) continue
    cell = clipHalfPlane(cell, site.x, site.z, other.x, other.z)
    if (cell.length < 3) return []
  }
  return ensureCcw(cell)
}

function insetConvex(ring: XZ[], amount: number): XZ[] {
  if (ring.length < 3 || amount <= 0) return ring
  const count = ring.length
  const shifted: Array<{ px: number; pz: number; nx: number; nz: number }> = []
  for (let i = 0; i < count; i += 1) {
    const [x0, z0] = ring[i]
    const [x1, z1] = ring[(i + 1) % count]
    const dx = x1 - x0
    const dz = z1 - z0
    const length = Math.hypot(dx, dz) || 1
    // CCW ring: interior is to the left, so the inward normal is (-dz, dx).
    const nx = -dz / length
    const nz = dx / length
    shifted.push({ px: x0 + nx * amount, pz: z0 + nz * amount, nx, nz })
  }
  const out: XZ[] = []
  for (let i = 0; i < count; i += 1) {
    const a = shifted[i]
    const b = shifted[(i + 1) % count]
    const denom = a.nx * b.nz - a.nz * b.nx
    if (Math.abs(denom) < 1e-8) {
      out.push([a.px, a.pz])
      continue
    }
    const c1 = a.nx * a.px + a.nz * a.pz
    const c2 = b.nx * b.px + b.nz * b.pz
    out.push([
      (c1 * b.nz - a.nz * c2) / denom,
      (a.nx * c2 - c1 * b.nx) / denom,
    ])
  }
  return out.length >= 3 ? out : ring
}

function fillFromRing(ring: XZ[], y: number) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z))
  const triangles = THREE.ShapeUtils.triangulateShape(contour, [])
  const positions: number[] = []
  const normals: number[] = []
  for (const tri of triangles) {
    for (const index of tri) {
      positions.push(contour[index].x, y, contour[index].y)
      normals.push(0, 1, 0)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geometry
}

function fillFromTiles(tiles: DistrictTile[], y: number) {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (const tile of tiles) {
    const base = positions.length / 3
    positions.push(
      tile.minX, y, tile.minZ,
      tile.maxX, y, tile.minZ,
      tile.maxX, y, tile.maxZ,
      tile.minX, y, tile.maxZ,
    )
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return geometry
}

function edgeFromRing(ring: XZ[], y: number, width: number) {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const half = width / 2
  const inset = insetConvex(ring, Math.min(INSET, width))
  const path = inset.length >= 3 ? inset : ring
  const count = path.length
  for (let i = 0; i <= count; i += 1) {
    const [x, z] = path[i % count]
    const [px, pz] = path[(i + count - 1) % count]
    const [nx, nz] = path[(i + 1) % count]
    const dx = nx - px
    const dz = nz - pz
    const length = Math.hypot(dx, dz) || 1
    const sx = (-dz / length) * half
    const sz = (dx / length) * half
    positions.push(x + sx, y, z + sz, x - sx, y, z - sz)
    normals.push(0, 1, 0, 0, 1, 0)
    if (i < count) {
      const a = i * 2
      indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return geometry
}

function quantize(value: number) {
  return Math.round(value * 1000) / 1000
}

function edgeFromTiles(tiles: DistrictTile[], y: number, width: number) {
  const keyOf = (x: number, z: number) => `${quantize(x)},${quantize(z)}`
  const undirected = new Map<string, { a: XZ; b: XZ; count: number }>()
  const add = (x1: number, z1: number, x2: number, z2: number) => {
    const ka = keyOf(x1, z1)
    const kb = keyOf(x2, z2)
    const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    const entry = undirected.get(id)
    if (entry) entry.count += 1
    else undirected.set(id, { a: [x1, z1], b: [x2, z2], count: 1 })
  }
  for (const tile of tiles) {
    add(tile.minX, tile.minZ, tile.maxX, tile.minZ)
    add(tile.maxX, tile.minZ, tile.maxX, tile.maxZ)
    add(tile.maxX, tile.maxZ, tile.minX, tile.maxZ)
    add(tile.minX, tile.maxZ, tile.minX, tile.minZ)
  }
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const half = width / 2
  for (const segment of undirected.values()) {
    if (segment.count !== 1) continue
    const [x0, z0] = segment.a
    const [x1, z1] = segment.b
    const dx = x1 - x0
    const dz = z1 - z0
    const length = Math.hypot(dx, dz) || 1
    const sx = (-dz / length) * half
    const sz = (dx / length) * half
    const base = positions.length / 3
    positions.push(
      x0 + sx, y, z0 + sz,
      x0 - sx, y, z0 - sz,
      x1 + sx, y, z1 + sz,
      x1 - sx, y, z1 - sz,
    )
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0)
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return geometry
}

function emptyGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
  return geometry
}

function regionFromTiles(key: string, tiles: DistrictTile[]): DistrictRegion {
  const fill = tiles.length ? fillFromTiles(tiles, FILL_Y) : emptyGeometry()
  const edge = tiles.length ? edgeFromTiles(tiles, EDGE_Y, EDGE_WIDTH) : emptyGeometry()
  return {
    key,
    fill,
    edge,
    contains: (x, z) => tiles.some((tile) => pointInTile(tile, x, z)),
  }
}

function regionFromRing(key: string, ring: XZ[]): DistrictRegion {
  const inset = ring.length >= 3 ? insetConvex(ring, INSET) : ring
  const used = inset.length >= 3 ? inset : ring
  return {
    key,
    fill: used.length >= 3 ? fillFromRing(used, FILL_Y) : emptyGeometry(),
    edge: used.length >= 3 ? edgeFromRing(used, EDGE_Y, EDGE_WIDTH) : emptyGeometry(),
    contains: (x, z) => ring.length >= 3 && pointInRing(ring, x, z),
  }
}

/**
 * One region per site, tiling `bound` without overlap.
 *
 * When `tiles` is supplied and covers the bound (the Old Quarter street
 * lattice), each parcel goes to the nearest site and the highlight is the
 * extruded outline of those parcels. Otherwise the bound is Voronoi-clipped
 * so a town, a stretch of water or a deck pad still owns a polygonal share
 * of the whole region rather than a disc around its pin.
 */
export function buildDistrictRegions(
  sites: DistrictSite[],
  bound: RegionBound,
  tiles?: DistrictTile[],
): DistrictRegion[] {
  if (!sites.length) return []
  if (tiles?.length) {
    const grouped = new Map<string, DistrictTile[]>()
    for (const site of sites) grouped.set(site.key, [])
    const clip = bound.kind === 'ellipse'
      ? (x: number, z: number) => ((x - bound.cx) / bound.rx) ** 2 + ((z - bound.cz) / bound.rz) ** 2 <= 1.02
      : () => true
    for (const tile of tiles) {
      const [cx, cz] = tileCenter(tile)
      if (!clip(cx, cz)) continue
      const owner = nearestSite(sites, cx, cz)
      grouped.get(owner.key)?.push(tile)
    }
    return sites.map((site) => regionFromTiles(site.key, grouped.get(site.key) ?? []))
  }
  const polygon = boundPolygon(bound)
  return sites.map((site) => regionFromRing(site.key, voronoiCell(site, sites, polygon)))
}

export function mergeRegionLayer(regions: DistrictRegion[], kind: 'fill' | 'edge') {
  const parts = regions.map((region) => region[kind]).filter((geometry) => geometry.getAttribute('position')?.count)
  if (!parts.length) return emptyGeometry()
  const merged = mergeGeometries(parts, false)
  return merged ?? emptyGeometry()
}
