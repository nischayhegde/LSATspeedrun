import * as THREE from 'three'

import {
  HumanoidActor,
  assignHumanoidLod,
} from './rig'
import type { StylizedCounselRig } from './stylized-counsel'

/**
 * Agents that live on a road network rather than on a single curve.
 *
 * The map used to move every vehicle by wrapping a parametric offset along one
 * closed CatmullRom circuit. That is cheap and it hides the wrap point, but it
 * buys the illusion at a high price: a car welded to one ring can never turn at
 * a junction, never yields, never varies its speed relative to its neighbours,
 * and — most visibly — exists from frame zero to the end of the mount, so the
 * district reads as a diorama with a few parts on rails rather than as a place
 * with traffic in it.
 *
 * This module replaces that with a small road graph and agents that path
 * through it. The graph is what makes the difference: two circuits that cross
 * share a welded node, so an agent arriving at that node has a genuine choice
 * of continuations, and the same structure gives us somewhere to hang car
 * following, junction yielding, docks and spawn portals.
 *
 * Nothing here imports from `map-three-scene.tsx` — that file imports this one,
 * and a cycle between a 5,000-line scene builder and its simulation would be a
 * maintenance trap. Everything the sim needs is passed in.
 */

/** Independent of the y axis: the whole network is flat, laid on the ground. */
export type XZ = [number, number]

export type LaneKind = 'road' | 'water' | 'rail'

export type RoadGraphSpec = {
  /** Polylines. Closed ones wrap; open ones terminate at their ends. */
  ways: Array<{
    points: XZ[]
    closed?: boolean
    kind?: LaneKind
    /** World units per second at free flow. */
    speed?: number
    /** Two-way by default. */
    oneWay?: boolean
    /** Nodes at either end of an open way become spawn/despawn portals. */
    portal?: boolean
    /**
     * Kerb-to-kerb width of the carriageway. Both sides read it: the pedestrian
     * planner to lay pavements beside it, and `TrafficSim` to solve a lane that
     * keeps the body between the kerbs. It has to agree with the width the scene
     * actually drew, and recording it on the way the scene already contributes
     * is the only way to keep the two from drifting apart.
     */
    width?: number
  }>
  /** Nodes within this distance of each other are welded into one junction. */
  weldRadius?: number
}

export type RoadNode = {
  index: number
  x: number
  z: number
  /** Indices into `RoadGraph.edges` of the edges leaving this node. */
  out: number[]
  /** Degree ≥ 3 means traffic has to be sequenced through here. */
  junction: boolean
  /** Agents may enter and leave the world here. */
  portal: boolean
  /** A dock, stop or stand: agents may pause here for a dwell. */
  dock: boolean
}

export type RoadEdge = {
  index: number
  from: number
  to: number
  /** Unit direction in the XZ plane, precomputed because the sim reads it every frame. */
  dx: number
  dz: number
  length: number
  kind: LaneKind
  /** Free-flow speed limit in world units per second. */
  speed: number
  /** Kerb-to-kerb width, for the pedestrian side's "is this in the road" tests. */
  width: number
  /** The edge running the other way between the same pair, or -1 on a one-way. */
  twin: number
}

export type RoadGraph = {
  nodes: RoadNode[]
  edges: RoadEdge[]
  /** Node indices agents may appear at and disappear through. */
  portals: number[]
  /** Node indices flagged as docks/stops by the caller. */
  docks: number[]
  /** Edge indices grouped by lane kind, so each sim only walks its own network. */
  edgesByKind: Record<LaneKind, number[]>
  /** Spatial hash backing `nodeNear`. Build-time only; never touched in `update`. */
  cells: Map<string, number[]>
  cellSize: number
  weldRadius: number
}

/**
 * The scene's own hash. Reproduced verbatim rather than imported so that a
 * seed which places a building in `map-three-scene.tsx` produces the same unit
 * value here — the two files have to agree or "deterministic from seed" is a
 * claim that only holds within one module.
 */
function hashUnit(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123
  return value - Math.floor(value)
}

const DEFAULT_SPEED: Record<LaneKind, number> = { road: 1.35, water: .82, rail: 3.1 }
/**
 * Fallback carriageway widths, for ways contributed without one. Deliberately
 * generous on the road case: a pedestrian test that thinks the street is wider
 * than it is errs towards keeping people out of it.
 */
const DEFAULT_WIDTH: Record<LaneKind, number> = { road: 1.5, water: 2.8, rail: 1.5 }

function cellKey(cellX: number, cellZ: number) {
  return `${cellX},${cellZ}`
}

/**
 * Build a directed graph from a set of polylines, welding coincident points.
 *
 * Welding is the entire point of this function. Two rings drawn independently
 * will cross at a place where each has a vertex, but until those two vertices
 * are the *same* node an agent on one ring has no way of discovering the other.
 * Snapping everything within `weldRadius` into a single node is what turns a
 * pile of unrelated circuits into a network with junctions in it.
 */
export function buildRoadGraph(spec: RoadGraphSpec): RoadGraph {
  const weldRadius = spec.weldRadius ?? .8
  const cellSize = Math.max(weldRadius * 2, .5)
  const cells = new Map<string, number[]>()
  const nodes: RoadNode[] = []
  const edges: RoadEdge[] = []
  const edgesByKind: Record<LaneKind, number[]> = { road: [], water: [], rail: [] }
  // A pair key per (from,to) so a way traced twice does not lay two parallel
  // edges between the same nodes, which would make the turn weights lopsided.
  const edgeIndexByPair = new Map<string, number>()

  const findOrCreateNode = (x: number, z: number) => {
    const cellX = Math.floor(x / cellSize)
    const cellZ = Math.floor(z / cellSize)
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        const bucket = cells.get(cellKey(cellX + offsetX, cellZ + offsetZ))
        if (!bucket) continue
        for (const index of bucket) {
          const node = nodes[index]
          if (Math.hypot(node.x - x, node.z - z) <= weldRadius) return index
        }
      }
    }
    const node: RoadNode = { index: nodes.length, x, z, out: [], junction: false, portal: false, dock: false }
    nodes.push(node)
    const key = cellKey(cellX, cellZ)
    const bucket = cells.get(key)
    if (bucket) bucket.push(node.index)
    else cells.set(key, [node.index])
    return node.index
  }

  const addEdge = (from: number, to: number, kind: LaneKind, speed: number, width: number) => {
    if (from === to) return -1
    const pair = `${from}>${to}`
    const existing = edgeIndexByPair.get(pair)
    if (existing !== undefined) return existing
    const a = nodes[from]
    const b = nodes[to]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (length < 1e-4) return -1
    const edge: RoadEdge = {
      index: edges.length,
      from,
      to,
      dx: (b.x - a.x) / length,
      dz: (b.z - a.z) / length,
      length,
      kind,
      speed,
      width,
      twin: -1,
    }
    edges.push(edge)
    edgeIndexByPair.set(pair, edge.index)
    a.out.push(edge.index)
    edgesByKind[kind].push(edge.index)
    const twin = edgeIndexByPair.get(`${to}>${from}`)
    if (twin !== undefined) {
      edge.twin = twin
      edges[twin].twin = edge.index
    }
    return edge.index
  }

  const flaggedPortals: number[] = []
  for (const way of spec.ways) {
    if (way.points.length < 2) continue
    const kind = way.kind ?? 'road'
    const speed = way.speed ?? DEFAULT_SPEED[kind]
    const width = way.width ?? DEFAULT_WIDTH[kind]
    const ids: number[] = []
    for (const [x, z] of way.points) {
      const id = findOrCreateNode(x, z)
      // A polyline that doubles back onto its own welded vertex contributes
      // nothing but a zero-length edge, so collapse the repeat here.
      if (ids.length && ids[ids.length - 1] === id) continue
      ids.push(id)
    }
    if (ids.length < 2) continue
    for (let index = 0; index < ids.length - 1; index += 1) {
      addEdge(ids[index], ids[index + 1], kind, speed, width)
      if (!way.oneWay) addEdge(ids[index + 1], ids[index], kind, speed, width)
    }
    if (way.closed) {
      addEdge(ids[ids.length - 1], ids[0], kind, speed, width)
      if (!way.oneWay) addEdge(ids[0], ids[ids.length - 1], kind, speed, width)
    } else if (way.portal) {
      // An explicit flag matters where an open way ends *on* another way: the
      // weld gives that node degree 3, so the degree test below would never
      // notice it is also where this route leaves the map.
      flaggedPortals.push(ids[0], ids[ids.length - 1])
    }
  }

  const portals: number[] = []
  for (const node of nodes) {
    node.junction = node.out.length >= 3
    // Degree 1 is a dead end: on a two-way road that is a node an agent can
    // only leave by reversing, which reads far worse than letting it drive off
    // the edge of the world and come back somewhere else.
    node.portal = node.out.length <= 1 || flaggedPortals.includes(node.index)
    if (node.portal) portals.push(node.index)
  }

  return { nodes, edges, portals, docks: [], edgesByKind, cells, cellSize, weldRadius }
}

/**
 * Nearest node to a world point, or -1. Build-time only: this is how the
 * caller turns "the quay is over there" into a graph node the sim understands.
 */
export function nodeNear(graph: RoadGraph, x: number, z: number, radius = Number.POSITIVE_INFINITY) {
  let best = -1
  let bestDistance = radius
  for (const node of graph.nodes) {
    const distance = Math.hypot(node.x - x, node.z - z)
    if (distance <= bestDistance) {
      bestDistance = distance
      best = node.index
    }
  }
  return best
}

/**
 * Flag the nodes nearest the supplied points as docks/stops and return them.
 * Docks are the only places an agent will voluntarily come to a stand, and for
 * `kind: 'water'` they are also where a boat is allowed to turn around, so a
 * water network with no docks produces boats that never berth.
 */
export function markDocks(graph: RoadGraph, points: XZ[], radius = 3): number[] {
  for (const [x, z] of points) {
    const index = nodeNear(graph, x, z, radius)
    if (index < 0) continue
    const node = graph.nodes[index]
    if (node.dock) continue
    node.dock = true
    graph.docks.push(index)
  }
  return graph.docks
}

/** The dock/stop nodes currently flagged on this graph. */
export function dockNodes(graph: RoadGraph): number[] {
  return graph.docks
}

// ---------------------------------------------------------------------------
// Shared scratch. Every vector, matrix and frustum the two simulations need is
// allocated exactly once, here. Allocating inside `update` is the single most
// expensive mistake available in this codebase: at 60fps a `new Vector3` per
// agent per frame is thousands of objects a second handed to the collector,
// and the resulting sawtooth is visible as hitching on the map.
// ---------------------------------------------------------------------------

const viewProjection = new THREE.Matrix4()
const cullFrustum = new THREE.Frustum()
const cameraPosition = new THREE.Vector3()
const probeSphere = new THREE.Sphere(new THREE.Vector3(), 1.6)
const scratchTarget = new THREE.Vector3()
const scratchMatrix = new THREE.Matrix4()
const scratchQuaternion = new THREE.Quaternion()
const scratchScale = new THREE.Vector3(1, 1, 1)
const scratchAxis = new THREE.Vector3(0, 1, 0)
const scratchWorld = new THREE.Vector3()
/** Reused each frame for `assignHumanoidLod`; never retained across frames. */
const lodActors: HumanoidActor[] = []

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * Set while a simulation is being warmed up ahead of the first frame.
 *
 * Refusing to spawn anywhere the camera can see is the right rule once the
 * player is watching, but it cannot fill a district that starts empty: every
 * position in shot is refused, so the streets the player is actually looking
 * at stay bare while the outskirts quietly fill up. Warming the simulation
 * forward before anything has been drawn produces the same distribution the
 * scene would have reached on its own after half a minute, and none of it is
 * a pop-in, because there is no earlier frame for it to contradict.
 */
let priming = false

function refreshCulling(camera: THREE.Camera) {
  // `matrixWorldInverse` is maintained by the renderer, so this is at worst one
  // frame stale when the sim runs before the draw call. One frame of lag on a
  // *visibility* test is invisible; recomputing the camera's world matrix here
  // would fight whatever the scene's own camera rig is doing.
  cameraPosition.setFromMatrixPosition(camera.matrixWorld)
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  cullFrustum.setFromProjectionMatrix(viewProjection)
}

/**
 * Is this point somewhere the player cannot currently see?
 *
 * The frustum test is deliberately conservative: it tests a sphere rather than
 * a point, so a spawn a few centimetres beyond the edge of the screen — about
 * to be swept into view by any camera motion at all — still counts as visible
 * and is refused. The fog fallback covers the other case, where a point is
 * technically in frustum but so far away that the scene's exponential fog has
 * already swallowed it.
 */
function unseen(point: THREE.Vector3, radius: number, fogDistance: number) {
  // While priming there is no previous frame, so there is nothing to pop in
  // from and every position counts as out of sight. See `prime` below.
  if (priming) return true
  probeSphere.center.copy(point)
  probeSphere.radius = radius
  if (!cullFrustum.intersectsSphere(probeSphere)) return true
  return point.distanceToSquared(cameraPosition) > fogDistance * fogDistance
}

/** Shortest-arc exponential approach, so headings never take the long way round. */
function approachAngle(current: number, target: number, rate: number, delta: number) {
  let difference = target - current
  while (difference > Math.PI) difference -= Math.PI * 2
  while (difference < -Math.PI) difference += Math.PI * 2
  return current + difference * (1 - Math.exp(-rate * delta))
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

export type TrafficOptions = {
  /**
   * Finish the graph before constructing the sim: the spawn tables are built
   * once, in the constructor, so a dock flagged by `markDocks` afterwards will
   * be honoured as a stop but never chosen as a starting point.
   */
  graph: RoadGraph
  /** Pooled vehicle bodies. The sim only moves and shows/hides them. */
  vehicles: THREE.Object3D[]
  /** Half-width of the carriageway; agents drive offset to the right of the centreline. */
  laneOffset?: number
  /** Bodies are modelled facing local +X (see `createVehicle` in the scene file). */
  facing?: 'x' | 'z'
  /** Seconds an agent spends fading in/out. */
  fade?: number
  kind?: LaneKind
  /** Ride height. The graph is flat, so this is the whole of the y story. */
  lift?: number
  /** Beyond this distance from the camera a point counts as hidden by fog. */
  fogDistance?: number
  /** Fraction of the pool that should be on the road at any moment, 0..1. */
  occupancy?: number
  /** Nose-to-tail gap an agent will not close below, in world units. */
  gap?: number
  /** Salts every per-agent random draw so two sims on one graph differ. */
  seed?: number
}

type TrafficAgent = {
  object: THREE.Object3D
  /** Authored scale of the pooled body, restored at the end of the fade-in. */
  baseScale: number
  active: boolean
  /** Directed edge the agent is on, and how far along it in world units. */
  edge: number
  distance: number
  /** Chosen continuation, picked on entry so car-following can look across the node. */
  nextEdge: number
  speed: number
  /** Persistent personal speed multiplier: the reason a convoy spreads out. */
  personal: number
  heading: number
  /** 0..1 ramp; drives scale, and gates the despawn hand-off. */
  ramp: number
  phase: 'in' | 'run' | 'out' | 'idle'
  /** Seconds of travel left before the agent becomes eligible to leave. */
  life: number
  /** Seconds still to be spent standing at a dock. */
  dwell: number
  /** True when this agent has decided to stop at the node ahead. */
  stopAtEnd: boolean
  /** Seconds spent waiting to enter a junction, used to break deadlocks. */
  yielded: number
  /** Node whose occupancy token this agent currently holds, or -1. */
  token: number
  /** Dock this agent has booked a berth at, or -1. */
  reserved: number
  seed: number
  /** Bumped on every turn so successive choices by one agent are decorrelated. */
  turns: number
}

const MAX_DELTA = .05
const ACCELERATION = 2.2
const DECELERATION = 4.4
/**
 * How far from a junction an agent starts caring about it. This has to exceed
 * the braking distance from the fastest free-flow speed on the network plus the
 * standoff below, or an agent discovers the junction too late to stop short of
 * it and coasts into the vehicle already crossing.
 */
const JUNCTION_CLAIM = 2.8
/** Seconds an agent will wait its turn before forcing the issue. See below. */
const YIELD_PATIENCE = 2.2
/** How far ahead of a node an agent starts watching the edge beyond it. */
const FOLLOW_LOOKAHEAD = 4.5
/** Ceiling on the turn chooser's scratch. No plausible street meets 12 others. */
const MAX_DEGREE = 12
/**
 * How far short of a body in the road a vehicle holds. Larger than the
 * nose-to-tail gap it keeps behind another vehicle, because a pedestrian is
 * not travelling in the same direction and cannot be relied on to move off.
 */
const PEDESTRIAN_STANDOFF = 1.5
/**
 * How far behind its own reference point a vehicle still counts a body as being
 * alongside it rather than behind it. Roughly half a car.
 */
const PEDESTRIAN_ABREAST = .45
/**
 * How far past a point a vehicle's reference must be before the vehicle has
 * genuinely left it. A nose that has passed is not a road that is clear: most
 * of the body is still over the point behind it.
 */
const VEHICLE_CLEAR = 1.4
/**
 * Above this a vehicle straddling a point will be gone by the time anyone on
 * foot could reach it, so it does not need to be treated as an obstruction.
 */
const CRAWLING = .8

/**
 * Gap left between a body's flank and the kerb it drives beside, and between
 * two bodies passing in opposite directions. Small, because it is a tolerance
 * rather than a comfort margin: the lane solver below is already working
 * inside carriageways that only just fit what stands in them.
 */
const LANE_MARGIN = .02
/** Half-width assumed for a pooled body that carries no hull tag. */
const DEFAULT_BODY_HALF = .22

export class TrafficSim {
  private readonly graph: RoadGraph
  private readonly kind: LaneKind
  private readonly laneOffset: number
  /**
   * Per-edge lane offset, solved once against the width of each carriageway.
   *
   * `laneOffset` alone was a single constant applied to every edge in a network
   * whose widths span .52 to 1.95, and the sim never looked at `edge.width` at
   * all. On the widest streets that parked the traffic near the centreline and
   * left the kerbside — where the parked cars are — as the only part of the
   * road anyone used. On an alley it was larger than the whole half-carriageway,
   * so vehicles drove outside the alley and through the vans at its docks.
   */
  private readonly lane: Float32Array
  private readonly facing: 'x' | 'z'
  private readonly fade: number
  private readonly lift: number
  private readonly fogDistance: number
  private readonly gap: number
  private readonly seed: number
  private readonly targetAlive: number
  private readonly agents: TrafficAgent[] = []
  /** Head of a per-edge intrusive list of occupants; `agentNext` is the link. */
  private readonly edgeHead: Int32Array
  private readonly agentNext: Int32Array
  /** One occupancy token per node; holds the agent index crossing it, or -1. */
  private readonly nodeToken: Int32Array
  /**
   * One berth per dock. A stop is a single point on the graph, so without a
   * booking two vehicles both decide to use it and end up parked on top of each
   * other for the length of the longer dwell — a stand-off that, unlike a
   * junction one, no amount of patience resolves, because both parties believe
   * they have arrived.
   */
  private readonly nodeDwell: Int32Array
  /**
   * Per-edge distance of the nearest body standing in the carriageway, or
   * +Infinity. Written by the crowd through `markPedestrian` and read here as
   * one array lookup per agent per frame, which is the whole reason this is an
   * array rather than a query: a vehicle asking the crowd "is anyone in front
   * of me" would be O(vehicles × walkers), and the point of the crossing work
   * is that neither side ever scans the other.
   */
  private readonly pedestrian: Float32Array
  /** Scratch for the turn chooser, sized to the largest plausible degree. */
  private readonly candidates = new Int32Array(MAX_DEGREE)
  private readonly weights = new Float32Array(MAX_DEGREE)
  private readonly spawnPreferred: number[] = []
  private readonly spawnAnywhere: number[] = []
  private spawnCursor = 0
  private spawnCooldown = 0
  private elapsed = 0
  private disposed = false

  constructor(options: TrafficOptions) {
    this.graph = options.graph
    this.kind = options.kind ?? 'road'
    this.laneOffset = options.laneOffset ?? .34
    this.facing = options.facing ?? 'x'
    this.fade = Math.max(.05, options.fade ?? 1.1)
    this.lift = options.lift ?? .1
    this.fogDistance = options.fogDistance ?? 58
    this.gap = options.gap ?? 1.15
    this.seed = options.seed ?? 17.3
    this.edgeHead = new Int32Array(Math.max(1, this.graph.edges.length))
    this.agentNext = new Int32Array(Math.max(1, options.vehicles.length))
    this.nodeToken = new Int32Array(Math.max(1, this.graph.nodes.length)).fill(-1)
    this.nodeDwell = new Int32Array(Math.max(1, this.graph.nodes.length)).fill(-1)
    this.pedestrian = new Float32Array(Math.max(1, this.graph.edges.length)).fill(Number.POSITIVE_INFINITY)

    options.vehicles.forEach((object, index) => {
      object.visible = false
      this.agents.push({
        object,
        // Pooled bodies arrive pre-scaled (the scene shrinks its second ferry,
        // for instance), so the fade has to ramp towards the authored scale
        // rather than towards 1 or the vehicle would grow on spawn.
        baseScale: object.scale.x || 1,
        active: false,
        edge: -1,
        distance: 0,
        nextEdge: -1,
        speed: 0,
        personal: .72 + hashUnit(this.seed + index * 3.71) * .63,
        heading: 0,
        ramp: 0,
        phase: 'idle',
        life: 0,
        dwell: 0,
        stopAtEnd: false,
        yielded: 0,
        token: -1,
        reserved: -1,
        seed: this.seed + index * 11.17,
        turns: 0,
      })
    })
    // Widest body in the pool, read from the hull tags the scene attaches at
    // construction. Solving the lane against the actual fleet rather than a
    // guessed figure is the whole reason those tags are worth carrying.
    let bodyHalf = 0
    for (const object of options.vehicles) {
      const hull = object.userData?.vehicleHull as { halfWidth?: number } | undefined
      const half = (hull?.halfWidth ?? DEFAULT_BODY_HALF) * (Math.abs(object.scale.z) || 1)
      if (half > bodyHalf) bodyHalf = half
    }
    if (bodyHalf <= 0) bodyHalf = DEFAULT_BODY_HALF

    this.lane = new Float32Array(Math.max(1, this.graph.edges.length))
    for (const edge of this.graph.edges) {
      // The furthest a lane centre can sit and still keep the body between the
      // kerbs, and the nearest it can sit without a two-way street's opposing
      // flows sharing ground. On a carriageway wide enough for both these do
      // not conflict and the authored offset is used untouched.
      const inside = edge.width / 2 - bodyHalf - LANE_MARGIN
      const apart = bodyHalf + LANE_MARGIN
      const solved = Math.min(this.laneOffset, Math.max(0, inside))
      // Where the street is too narrow to hold two bodies abreast, keeping them
      // apart wins over keeping them off the kerb: a head-on is a worse defect
      // than an overhang, and the real fault is a carriageway drawn narrower
      // than the traffic assigned to it, which belongs to the plan not here.
      this.lane[edge.index] = edge.twin >= 0 ? Math.max(apart, solved) : solved
    }

    // Keeping a slice of the pool parked is what makes the churn legible: with
    // every body on the road at once, "despawn" would only ever be immediately
    // followed by a respawn of the same object somewhere else.
    this.targetAlive = Math.max(0, Math.round(this.agents.length * (options.occupancy ?? .85)))

    for (const node of this.graph.nodes) {
      if (!this.hasOutgoing(node)) continue
      this.spawnAnywhere.push(node.index)
      if (node.portal || node.dock) this.spawnPreferred.push(node.index)
    }
  }

  private hasOutgoing(node: RoadNode) {
    for (const edgeIndex of node.out) if (this.graph.edges[edgeIndex].kind === this.kind) return true
    return false
  }

  /**
   * Agents currently on the network. Useful when tuning pool sizes.
   *
   * Indexed rather than `for…of`, like every other loop reachable from
   * `update`. V8 does usually escape-analyse an array iterator away, but
   * "usually" is not a guarantee, and this file's whole claim to being cheap
   * rests on nothing in the update path ever reaching the allocator.
   */
  alive() {
    let count = 0
    for (let index = 0; index < this.agents.length; index += 1) if (this.agents[index].active) count += 1
    return count
  }

  /**
   * Pick the continuation at the far end of `fromEdge`.
   *
   * Weighting by the turn angle — cubed, so the falloff is steep — is what
   * produces traffic that looks like it is going somewhere. An unweighted
   * choice sends a quarter of all vehicles round every corner and the network
   * reads as a random walk; a straight-only rule puts every car back on its own
   * ring, which is the behaviour this module exists to replace.
   */
  private chooseEdge(fromEdge: number, agent: TrafficAgent) {
    const edge = this.graph.edges[fromEdge]
    const node = this.graph.nodes[edge.to]
    let count = 0
    let total = 0
    for (let slot = 0; slot < node.out.length; slot += 1) {
      if (count >= MAX_DEGREE) break
      const candidateIndex = node.out[slot]
      const candidate = this.graph.edges[candidateIndex]
      if (candidate.kind !== this.kind) continue
      const alignment = edge.dx * candidate.dx + edge.dz * candidate.dz
      // A u-turn keeps a vanishingly small weight rather than none at all, so a
      // dead end is still escapable without a special case for it.
      const weight = candidateIndex === edge.twin
        ? 1e-5
        : Math.pow(Math.max(.02, (alignment + 1) * .5), 3.2)
      this.candidates[count] = candidateIndex
      this.weights[count] = weight
      total += weight
      count += 1
    }
    if (!count) return -1
    agent.turns += 1
    let roll = hashUnit(agent.seed + agent.turns * 7.13) * total
    for (let index = 0; index < count; index += 1) {
      roll -= this.weights[index]
      if (roll <= 0) return this.candidates[index]
    }
    return this.candidates[count - 1]
  }

  private releaseBerth(agent: TrafficAgent, index: number) {
    if (agent.reserved < 0) return
    if (this.nodeDwell[agent.reserved] === index) this.nodeDwell[agent.reserved] = -1
    agent.reserved = -1
  }

  /** Put the agent on an edge and pick the continuation beyond it. */
  private enterEdge(agent: TrafficAgent, edgeIndex: number) {
    agent.edge = edgeIndex
    agent.nextEdge = this.chooseEdge(edgeIndex, agent)
  }

  /**
   * Decide whether to stop at the node this edge ends on, and book the berth
   * now rather than on arrival.
   *
   * Booking on approach is the point. Boats always berth; road traffic stops at
   * a stand only sometimes, because a vehicle that halts at every shelter on
   * every pass reads as scripted. Either way a second vehicle heading for an
   * already-spoken-for stop learns that on the way in and drives past, instead
   * of discovering it on arrival when it is already parked in the same spot.
   */
  private decideStop(agent: TrafficAgent, index: number, edgeIndex: number) {
    this.releaseBerth(agent, index)
    const to = this.graph.edges[edgeIndex].to
    const wanted = this.graph.nodes[to].dock
      && (this.kind === 'water' || hashUnit(agent.seed + agent.turns * 3.31 + 5.5) < .45)
    agent.stopAtEnd = wanted && this.nodeDwell[to] < 0
    if (agent.stopAtEnd) {
      this.nodeDwell[to] = index
      agent.reserved = to
    }
  }

  private releaseToken(agent: TrafficAgent, index: number) {
    if (agent.token < 0) return
    if (this.nodeToken[agent.token] === index) this.nodeToken[agent.token] = -1
    agent.token = -1
  }

  /**
   * Take a junction's token, dispossessing whoever held it.
   *
   * Clearing the previous holder's own record is not bookkeeping pedantry: an
   * agent that still believes it holds a token skips the give-way test
   * entirely, so a token taken by the patience rule while the original holder
   * was still approaching left *both* of them convinced they had right of way
   * and both of them driving through at full speed.
   */
  private claimToken(agent: TrafficAgent, index: number, node: number) {
    const previous = this.nodeToken[node]
    if (previous >= 0 && previous !== index) this.agents[previous].token = -1
    this.nodeToken[node] = index
    agent.token = node
    agent.yielded = 0
  }

  /**
   * Is anyone physically inside this junction?
   *
   * The token sequences agents; this checks the thing the token is a proxy for.
   * Having both matters because the token's deadlock escape hatch is, by
   * design, willing to be unfair — and an unfair token with no occupancy test
   * behind it waves an agent into a box that still has a car in it. Walking the
   * incident edges' occupancy buckets costs degree × occupants, which on a
   * street network is a handful of comparisons.
   */
  private junctionOccupied(node: RoadNode, self: number) {
    for (let slot = 0; slot < node.out.length; slot += 1) {
      const outIndex = node.out[slot]
      const out = this.graph.edges[outIndex]
      if (out.kind !== this.kind) continue
      // Departing traffic: still in the box until it is a following distance clear.
      for (let other = this.edgeHead[outIndex]; other >= 0; other = this.agentNext[other]) {
        if (other !== self && this.agents[other].distance < this.gap) return true
      }
      // Arriving traffic that has come to a stand right on the node, typically
      // a vehicle dwelling at a stop that happens to sit on a junction.
      if (out.twin < 0) continue
      const twin = this.graph.edges[out.twin]
      for (let other = this.edgeHead[out.twin]; other >= 0; other = this.agentNext[other]) {
        if (other !== self && twin.length - this.agents[other].distance < .2) return true
      }
    }
    return false
  }

  /**
   * Report a body standing in the carriageway at `distance` along `edge`.
   *
   * Called by the crowd for the frames a walker is actually out in the road.
   * The claim is written to the twin as well, because a crossing spans the
   * whole carriageway: the two lane centrelines are two thirds of a metre
   * apart at map scale, so a walker in one of them is in both, and a vehicle
   * that only checked its own direction would drive round the back of a
   * pedestrian it had every reason to stop for.
   *
   * Claims live for exactly one frame. `update` reads them and then clears
   * them, so the crowd's writes are always the most recent set and a walker
   * that has finished crossing stops holding traffic up immediately.
   */
  markPedestrian(edgeIndex: number, distance: number) {
    if (edgeIndex < 0 || edgeIndex >= this.pedestrian.length) return
    const edge = this.graph.edges[edgeIndex]
    if (edge.kind !== this.kind) return
    if (distance < this.pedestrian[edgeIndex]) this.pedestrian[edgeIndex] = distance
    if (edge.twin >= 0) {
      const mirrored = edge.length - distance
      if (mirrored < this.pedestrian[edge.twin]) this.pedestrian[edge.twin] = mirrored
    }
  }

  /**
   * Seconds until the first vehicle travelling along `edge` reaches a point
   * `offset` past the end of that edge, or Infinity if nothing is coming.
   * `via`, when not -1, restricts the answer to vehicles that have already
   * chosen `via` as their next edge.
   *
   * This is the pedestrian's side of the crossing, and it is deliberately
   * dumber than a route query: the caller has already worked out, once, every
   * way a vehicle can reach the point it cares about — see `buildApproaches` —
   * so all this has to do is walk the per-edge occupancy bucket the
   * car-following pass has already built this frame. Cost is the handful of
   * vehicles on one edge, with nothing proportional to the size of either
   * population, which is the whole reason the crossing work does not turn the
   * crowd update into a scan over the traffic.
   *
   * A stopped vehicle is not "arriving": a queue held at a junction is exactly
   * when a pedestrian should cross. Standing on the point itself is a block
   * rather than a gap, though, or a walker would set off through a stationary
   * car.
   */
  timeAlong(edgeIndex: number, via: number, offset: number) {
    if (this.disposed || edgeIndex < 0 || edgeIndex >= this.graph.edges.length) return Number.POSITIVE_INFINITY
    const edge = this.graph.edges[edgeIndex]
    if (edge.kind !== this.kind) return Number.POSITIVE_INFINITY
    let soonest = Number.POSITIVE_INFINITY
    for (let other = this.edgeHead[edgeIndex]; other >= 0; other = this.agentNext[other]) {
      const rival = this.agents[other]
      if (via >= 0 && rival.nextEdge !== via) continue
      const approach = offset + edge.length - rival.distance
      if (approach < -.1) {
        // Nose past the point. Whether that is a gap depends on the speed it is
        // leaving at: a vehicle still crawling out of the crossing, or stopped
        // half way across it in a queue, is a wall to walk into rather than a
        // road that has cleared. One at speed is gone before anyone on foot
        // could reach the lane, so it is ignored — otherwise every walker would
        // stand at the kerb watching the back of a car that had already passed.
        if (approach > -VEHICLE_CLEAR && rival.speed < CRAWLING) return 0
        continue
      }
      if (approach < .1) return 0
      if (rival.speed < .06) continue
      const time = approach / rival.speed
      if (time < soonest) soonest = time
    }
    return soonest
  }

  private despawn(agent: TrafficAgent, index: number) {
    this.releaseToken(agent, index)
    this.releaseBerth(agent, index)
    agent.active = false
    agent.phase = 'idle'
    agent.ramp = 0
    agent.edge = -1
    agent.object.visible = false
  }

  /**
   * Begin the fade-out, wherever the agent stands.
   *
   * The agent is parked exactly where it stopped and then frozen: an exit is
   * either taken at a portal (the edge of the network, with nothing behind it
   * to watch the vehicle dissolve from) or off-camera, so there is no motion
   * left worth simulating. Freezing also removes the trap that a leaving agent
   * still sitting at the far end of its edge would re-trigger the node crossing
   * on every subsequent frame.
   */
  private beginExit(agent: TrafficAgent, index: number) {
    this.releaseToken(agent, index)
    this.releaseBerth(agent, index)
    agent.phase = 'out'
    agent.speed = 0
    agent.stopAtEnd = false
    agent.dwell = 0
  }

  /**
   * Try to bring one parked body onto the network.
   *
   * The rule that matters is the last one: a candidate is only accepted if it
   * is *currently unseen*. Portals and docks are preferred as start points
   * because they are the places a vehicle plausibly comes from, but preference
   * is not permission — a portal sitting in the middle of the shot is refused
   * exactly like any other visible point. The brief's headline requirement is
   * that nothing ever pops into existence in view, and the only way to
   * guarantee that is to make the visibility test unconditional rather than an
   * alternative to the portal test. The cost of being strict is that on a
   * camera which happens to see the whole network no traffic enters; that is
   * both the correct behaviour and self-correcting, since the sim retries every
   * frame and the map's cameras always have something off-screen.
   */
  private trySpawn(agent: TrafficAgent, index: number) {
    const pool = this.spawnPreferred.length && hashUnit(this.seed + this.spawnCursor * 2.71) < .62
      ? this.spawnPreferred
      : this.spawnAnywhere
    if (!pool.length) return false
    this.spawnCursor += 1
    const node = this.graph.nodes[pool[Math.floor(hashUnit(this.seed + this.spawnCursor * 5.19) * pool.length) % pool.length]]
    scratchTarget.set(node.x, this.lift, node.z)
    if (!unseen(scratchTarget, 2.2, this.fogDistance)) return false

    let chosen = -1
    let seen = 0
    for (let slot = 0; slot < node.out.length; slot += 1) {
      const edgeIndex = node.out[slot]
      if (this.graph.edges[edgeIndex].kind !== this.kind) continue
      seen += 1
      // Reservoir choice: one pass, no array, uniform over the valid edges.
      if (hashUnit(this.seed + this.spawnCursor * 9.41 + seen) < 1 / seen) chosen = edgeIndex
    }
    if (chosen < 0) return false

    const edge = this.graph.edges[chosen]
    const start = Math.min(hashUnit(agent.seed + this.spawnCursor) * .4, edge.length * .5)
    const lane = this.lane[chosen]
    scratchTarget.set(
      node.x + edge.dx * start - edge.dz * lane,
      this.lift,
      node.z + edge.dz * start + edge.dx * lane,
    )
    // A world-space clearance test rather than a same-edge one. The spawn node
    // is by definition somewhere several edges meet, so a vehicle about to
    // arrive on any of them can be metres away along its own edge and yet right
    // on top of the spawn point. Checking against every agent is O(agents) once
    // per spawn interval, which is nothing next to being wrong.
    for (let other = 0; other < this.agents.length; other += 1) {
      const rival = this.agents[other]
      if (!rival.active) continue
      if (rival.object.position.distanceToSquared(scratchTarget) < this.gap * this.gap * 4) return false
    }

    agent.active = true
    agent.phase = 'in'
    agent.ramp = 0
    agent.distance = Math.min(start, edge.length * .5)
    agent.speed = edge.speed * agent.personal * .45
    agent.dwell = 0
    agent.yielded = 0
    agent.token = -1
    agent.reserved = -1
    agent.life = 26 + hashUnit(agent.seed + this.spawnCursor * 1.77) * 46
    this.enterEdge(agent, chosen)
    this.decideStop(agent, index, chosen)
    agent.heading = Math.atan2(edge.dx, edge.dz)
    this.place(agent, 1)
    agent.object.scale.setScalar(.001)
    agent.object.visible = true
    return true
  }

  /** Write the agent's transform. `blend` of 1 snaps; anything less eases. */
  private place(agent: TrafficAgent, blend: number) {
    const edge = this.graph.edges[agent.edge]
    const from = this.graph.nodes[edge.from]
    // Right of travel is (-dz, dx) — the same lateral convention `offsetCurve`
    // uses in the scene, so a lane laid out there and an agent driven here
    // agree about which side of the centreline they are on.
    const lane = this.lane[agent.edge]
    scratchTarget.set(
      from.x + edge.dx * agent.distance - edge.dz * lane,
      this.lift,
      from.z + edge.dz * agent.distance + edge.dx * lane,
    )
    // Easing the *rendered* position rather than the simulated one is what
    // rounds off a corner: the two offset centrelines meeting at a junction are
    // a lateral step of up to twice the lane offset, and stepping it would read
    // as the vehicle jinking sideways as it turns.
    if (blend >= 1) {
      agent.object.position.copy(scratchTarget)
    } else {
      agent.object.position.lerp(scratchTarget, blend)
      // The ease is only allowed to round a corner off towards the kerb.
      //
      // Lagging behind the target is a lateral offset in whichever direction
      // the previous edge's lane happened to lie, and on a two-way street half
      // of those directions are over the centreline into the oncoming lane.
      // That is not a car cutting a corner, it is a car on the wrong side of
      // the road, and it accounted for every wrong-side frame this simulation
      // reported. Clamping the eased position back to the lane keeps the whole
      // of the outward half of the ease — which is where the visible rounding
      // is, since a vehicle turning away from its lane has the furthest to
      // travel — and refuses the inward half.
      if (edge.twin >= 0) {
        const lateral = (agent.object.position.x - from.x) * -edge.dz + (agent.object.position.z - from.z) * edge.dx
        if (lateral < lane) {
          const push = lane - lateral
          agent.object.position.x -= edge.dz * push
          agent.object.position.z += edge.dx * push
        }
      }
    }
    agent.object.rotation.y = this.facing === 'x' ? agent.heading - Math.PI / 2 : agent.heading
  }

  /**
   * File every active agent under the edge it is currently on.
   *
   * Run at both ends of `update`, and the second one is not redundant. The list
   * is the only index into "who is on this edge", and `timeAlong` — the
   * pedestrian's whole view of the traffic — walks it. An agent that crosses a
   * node during the integration below has already been given its new `edge`,
   * `nextEdge` and `distance` by `enterEdge`, while the list still files it
   * under the edge it left. The two halves of its identity then disagree, and a
   * caller loses the vehicle completely rather than reading it late: the
   * approach that names the edge it has joined is looked up in a bucket it is
   * not in, and the approach that names the edge it is filed under is gated on
   * a `via` it no longer has, because `nextEdge` moved on with the rest.
   *
   * That is a one-frame hole, and one frame is enough. The crowd runs after
   * every traffic sim, so it reads exactly this state; a walker at a kerb asks
   * `gapIsSafe` on every one of the six hundred frames it is willing to wait,
   * and steps off the first time the answer is yes. So a car crossing a node
   * beside a crossing is invisible for the frame it does it, and the walker
   * standing there is all but certain to pick that frame. Measured on the Old
   * Quarter, a walker stepped off in front of a vehicle 1.16m away doing
   * 2.06m/s, which the crossing read as an empty road.
   */
  private refile() {
    this.edgeHead.fill(-1)
    for (let index = 0; index < this.agents.length; index += 1) {
      const agent = this.agents[index]
      if (!agent.active || agent.edge < 0) continue
      this.agentNext[index] = this.edgeHead[agent.edge]
      this.edgeHead[agent.edge] = index
    }
  }

  update(delta: number, camera: THREE.Camera) {
    if (this.disposed || !this.agents.length || !this.graph.edgesByKind[this.kind].length) return
    const step = Math.min(Math.max(delta, 0), MAX_DELTA)
    if (step <= 0) return
    this.elapsed += step
    this.spawnCooldown -= step
    refreshCulling(camera)

    // Rebuild the occupancy buckets from last frame's positions. One frame of
    // lag in a following distance is imperceptible and it keeps the whole
    // update to a single pass over the agents.
    this.refile()

    for (let index = 0; index < this.agents.length; index += 1) {
      const agent = this.agents[index]
      if (!agent.active) continue

      // A departing agent is parked and frozen; all that is left is the ramp.
      // Handling it here rather than at the bottom of the loop keeps a leaving
      // agent out of the node-crossing code, which would otherwise re-fire on
      // it every frame now that it is sitting at the far end of its edge.
      if (agent.phase === 'out') {
        agent.ramp -= step / this.fade
        if (agent.ramp <= 0) { this.despawn(agent, index); continue }
        agent.object.scale.setScalar(Math.max(.001, agent.baseScale * THREE.MathUtils.smoothstep(agent.ramp, 0, 1)))
        continue
      }

      const edge = this.graph.edges[agent.edge]
      const remaining = edge.length - agent.distance

      // --- constraints -------------------------------------------------
      // Everything that could stop this agent is reduced to one number: the
      // distance at which it must be stationary. Deriving the speed from that
      // single figure is what stops the rules fighting each other, which is
      // how a yielding vehicle used to end up creeping through a junction.
      let stopDistance = Number.POSITIVE_INFINITY

      for (let other = this.edgeHead[agent.edge]; other >= 0; other = this.agentNext[other]) {
        if (other === index) continue
        const ahead = this.agents[other].distance - agent.distance
        if (ahead > 0 && ahead - this.gap < stopDistance) stopDistance = ahead - this.gap
      }
      // Anyone on foot in the carriageway ahead. Read from last frame's claims,
      // which at 60fps is a centimetre or two of vehicle travel — the same
      // one-frame staleness the occupancy buckets above already accept.
      const bodyAhead = this.pedestrian[agent.edge]
      // Only bodies at or in front of the nose count. A walker a metre behind
      // the boot is someone the vehicle has already passed, and braking for
      // them would leave a car stopped in the road for a crossing that is
      // finished behind it.
      if (bodyAhead < Number.POSITIVE_INFINITY && bodyAhead > agent.distance - PEDESTRIAN_ABREAST) {
        const ahead = bodyAhead - agent.distance - PEDESTRIAN_STANDOFF
        if (ahead < stopDistance) stopDistance = ahead
      }
      if (agent.nextEdge >= 0 && remaining < FOLLOW_LOOKAHEAD) {
        const next = this.graph.edges[agent.nextEdge]
        const alignment = edge.dx * next.dx + edge.dz * next.dz
        const rightness = edge.dx * next.dz - edge.dz * next.dx
        // Distance measured along the centrelines overstates the gap around a
        // right-hand turn, because the right-offset lane cuts the inside of the
        // corner: on a square corner it is 2·laneOffset shorter than the
        // centreline it is derived from. Without this correction two vehicles
        // holding a perfectly legal following distance close to within a body
        // length of each other as they turn, which is exactly what it looks
        // like. `2·offset·tan(θ/2)` is the shortening; the clamp keeps a near
        // hairpin from demanding an absurd gap.
        // Both lanes now differ per edge, so the shortening is taken on the
        // wider of the two: it is the one that cuts the corner hardest, and
        // asking for the larger gap is the safe way to be wrong here.
        const turnLane = Math.max(this.lane[agent.edge], this.lane[agent.nextEdge])
        const corner = rightness > 0
          ? Math.min(turnLane * 3, 2 * turnLane * Math.sqrt(Math.max(0, 1 - alignment) / Math.max(.08, 1 + alignment)))
          : 0
        for (let other = this.edgeHead[agent.nextEdge]; other >= 0; other = this.agentNext[other]) {
          const ahead = remaining + this.agents[other].distance - corner
          if (ahead - this.gap < stopDistance) stopDistance = ahead - this.gap
        }
        // A crossing on the far side of the junction, which is where most of
        // them are: the footways either side of a street meet at its ends.
        const bodyBeyond = this.pedestrian[agent.nextEdge]
        if (bodyBeyond < Number.POSITIVE_INFINITY) {
          const ahead = remaining + bodyBeyond - PEDESTRIAN_STANDOFF
          if (ahead < stopDistance) stopDistance = ahead
        }
      }

      const destination = this.graph.nodes[edge.to]
      if (destination.junction && remaining < JUNCTION_CLAIM) {
        let blocked = false
        if (agent.token !== edge.to) {
          const holder = this.nodeToken[edge.to]
          const free = holder < 0
            || holder === index
            || !this.agents[holder].active
            || this.agents[holder].token !== edge.to
          if (free) this.claimToken(agent, index, edge.to)
          else blocked = true
        }
        if (!blocked && this.junctionOccupied(destination, index)) blocked = true
        if (!blocked) {
          agent.yielded = 0
        } else {
          agent.yielded += step
          // A pure "wait your turn" rule deadlocks the moment two agents claim
          // each other's junction, so patience is bounded: after a couple of
          // seconds an agent goes regardless. Traffic that nudges through a
          // stand-off is enormously better than traffic frozen in one.
          if (agent.yielded > YIELD_PATIENCE) {
            this.claimToken(agent, index, edge.to)
          } else if (remaining - this.gap < stopDistance) {
            // Stop a full following distance short of the node, not a token
            // gesture short of it. The agent already inside the junction is
            // typically less than a body length past the node, so a waiting
            // vehicle that creeps right up to the give-way line is still
            // touching it — the two arms of a crossing meet at a point, and the
            // lane offsets put the two paths closer together there than the
            // distances measured along either one suggest.
            stopDistance = remaining - this.gap
          }
        }
      }
      if (agent.stopAtEnd && remaining - .12 < stopDistance) stopDistance = remaining - .12
      if (agent.dwell > 0) stopDistance = 0
      if (agent.nextEdge < 0 && remaining - .1 < stopDistance) stopDistance = remaining - .1

      // --- speed -------------------------------------------------------
      const free = edge.speed * agent.personal
      // The braking curve of a vehicle that must be stopped in `stopDistance`.
      const braked = stopDistance >= 1e4
        ? free
        : Math.sqrt(Math.max(0, 2 * DECELERATION * Math.max(0, stopDistance)))
      const desired = Math.min(free, braked)
      const rate = desired > agent.speed ? ACCELERATION : DECELERATION
      agent.speed += THREE.MathUtils.clamp(desired - agent.speed, -rate * step, rate * step)
      if (agent.speed < .02) agent.speed = 0

      // --- integrate ---------------------------------------------------
      if (agent.dwell > 0) {
        agent.dwell -= step
        if (agent.dwell <= 0) {
          agent.dwell = 0
          // Casting off: the berth is given up and the agent decides afresh
          // whether the next node on its departure leg is somewhere to stop.
          this.decideStop(agent, index, agent.edge)
        }
      } else {
        agent.distance += agent.speed * step
        agent.life -= step
      }

      let left = false
      // A `while` rather than an `if`: a very short edge between two welded
      // nodes can be shorter than one frame's travel, and skipping the node in
      // that case would leave the agent's edge and position disagreeing.
      while (agent.distance >= this.graph.edges[agent.edge].length) {
        const current = this.graph.edges[agent.edge]
        const arrived = this.graph.nodes[current.to]
        const overshoot = agent.distance - current.length
        const berthing = agent.stopAtEnd && agent.reserved === current.to
        // Reaching a portal is a clean exit: the agent leaves the map the way a
        // real vehicle leaves a modelled district, by driving off the end of it.
        const exiting = !berthing && arrived.portal
          && (agent.life <= 0 || arrived.out.length <= 1 || hashUnit(agent.seed + agent.turns * 13.7) < .5)
        const next = exiting ? -1 : agent.nextEdge >= 0 ? agent.nextEdge : this.chooseEdge(agent.edge, agent)
        if (next < 0) {
          // Pinned to the end of the edge it is actually on. An agent that
          // stops crossing has to keep the geometry it stopped at; carrying the
          // overshoot onto an edge it never entered would fling it the whole
          // length of that edge, back to its start node, in one frame.
          agent.distance = current.length
          left = true
          break
        }
        agent.stopAtEnd = false
        this.enterEdge(agent, next)
        if (berthing) {
          // Berth at the node itself but already turned onto the departure leg,
          // so a boat swings round at its mooring and pulls away rather than
          // pirouetting on the spot the moment the dwell ends. The booking is
          // held for the length of the dwell, not released here.
          agent.distance = 0
          agent.dwell = this.kind === 'water'
            ? 3.4 + hashUnit(agent.seed + this.elapsed) * 5.2
            : 2.1 + hashUnit(agent.seed + this.elapsed) * 3.6
          break
        }
        agent.distance = overshoot
        this.decideStop(agent, index, next)
      }

      if (left) {
        this.beginExit(agent, index)
      } else if (agent.phase === 'run' && agent.life <= 0) {
        // Lifetime alone is not enough to justify leaving: an agent that has
        // simply been on the road long enough waits until it is off-camera, and
        // otherwise buys itself another few seconds and asks again. Testing the
        // eased render position rather than re-deriving the exact one is
        // deliberate — it is what the player is actually looking at.
        if (unseen(agent.object.position, 2.2, this.fogDistance)) this.beginExit(agent, index)
        else agent.life = 6 + hashUnit(agent.seed + this.elapsed) * 6
      }

      if (agent.token >= 0 && agent.token !== this.graph.edges[agent.edge].to) {
        // Released once clear of the junction, not the instant it is entered,
        // or a second agent would be waved in alongside the first. "Clear" is
        // the following distance plus a margin, which is the same figure the
        // waiting agent is holding station at on the other arm.
        const holdNode = this.graph.nodes[agent.token]
        if (Math.hypot(agent.object.position.x - holdNode.x, agent.object.position.z - holdNode.z) > this.gap + .4) {
          this.releaseToken(agent, index)
        }
      }

      // --- pose --------------------------------------------------------
      if (agent.edge >= 0) {
        const active = this.graph.edges[agent.edge]
        const targetHeading = Math.atan2(active.dx, active.dz)
        // Turning slowly when moving slowly keeps a stationary agent from
        // spinning on the spot while it waits at a junction.
        const turnRate = 2.4 + Math.min(6, agent.speed * 3.4)
        agent.heading = approachAngle(agent.heading, targetHeading, turnRate, step)
        this.place(agent, 1 - Math.exp(-11 * step))
      }

      // --- ramp --------------------------------------------------------
      // Scale-only. The scene shares its materials aggressively — `material()`
      // hands the same `MeshStandardMaterial` to hundreds of meshes and
      // `setOccluderFade` goes to the trouble of swapping in a cloned twin
      // rather than touching one — so ramping opacity here would fade every
      // building that happens to share a colour with a car. Cloning a twin per
      // vehicle would work but costs a material and a shader permutation each,
      // for an effect that a scale ramp on an already-off-screen object sells
      // just as well. The refusal to spawn in view is what makes that enough.
      if (agent.phase === 'in') {
        agent.ramp = Math.min(1, agent.ramp + step / this.fade)
        if (agent.ramp >= 1) agent.phase = 'run'
      }
      if (agent.phase !== 'run') {
        const eased = THREE.MathUtils.smoothstep(agent.ramp, 0, 1)
        agent.object.scale.setScalar(Math.max(.001, agent.baseScale * eased))
      } else if (agent.object.scale.x !== agent.baseScale) {
        agent.object.scale.setScalar(agent.baseScale)
      }
    }

    // --- restock ---------------------------------------------------------
    // One attempt per interval, not one per parked body: a burst that puts six
    // vehicles on the network in a single frame is exactly the "traffic
    // appeared" artefact this is meant to avoid, even when each of the six is
    // individually off-screen.
    if (this.spawnCooldown <= 0) {
      this.spawnCooldown = .45
      if (this.alive() < this.targetAlive) {
        for (let index = 0; index < this.agents.length; index += 1) {
          const agent = this.agents[index]
          if (agent.active) continue
          if (this.trySpawn(agent, index)) break
        }
      }
    }

    // Cleared after the constraints have been read, so the crowd's next pass
    // writes a fresh set. A claim that persisted would hold traffic at a
    // crossing for good the first time anybody used it.
    this.pedestrian.fill(Number.POSITIVE_INFINITY)

    // Everything above may have moved an agent onto a different edge or brought
    // a new one onto the network, so the list is refiled before anyone outside
    // this class reads it. See `refile`.
    this.refile()
  }

  /**
   * Warm the network up before the first frame. See `priming`.
   *
   * The step is the simulation's own maximum, so this is the coarsest — and
   * therefore cheapest — integration it will accept without changing
   * behaviour, and the spawn interval still paces arrivals so agents come onto
   * the network spread out rather than all at the first tick.
   */
  prime(seconds: number, camera: THREE.Camera) {
    camera.updateMatrixWorld()
    priming = true
    try {
      for (let remaining = seconds; remaining > 0; remaining -= MAX_DELTA) this.update(MAX_DELTA, camera)
    } finally {
      priming = false
    }
  }

  /**
   * Park every agent. The pooled bodies belong to the caller — they were built
   * by the scene and are disposed with it — so this releases the simulation's
   * hold on them without touching their geometry or materials.
   */
  dispose() {
    this.disposed = true
    for (let index = 0; index < this.agents.length; index += 1) this.despawn(this.agents[index], index)
    this.nodeToken.fill(-1)
    this.edgeHead.fill(-1)
    this.pedestrian.fill(Number.POSITIVE_INFINITY)
  }
}

// ---------------------------------------------------------------------------
// Pedestrians
// ---------------------------------------------------------------------------

/** One pavement, as the scene contributes it. */
export type FootwaySpec = {
  points: XZ[]
  closed?: boolean
  /**
   * Half the usable paved width, measured from the polyline. Walkers spread
   * across it, so this has to be the paving the scene actually drew: the
   * default is sized for a generous promenade and will put people in the
   * gutter of a narrow street.
   */
  halfWidth?: number
  /**
   * Where that usable width sits across the polyline, positive to its left.
   * Zero unless `cutFootwaysAroundSolids` had to move the band off something
   * standing over one edge of it. See `Footway.centre`.
   */
  centre?: number
  /**
   * Relative likelihood a spawning walker chooses this pavement, multiplied by
   * its length. A high street and a back lane both being one entry in a list is
   * how a district ends up with the same number of people on each.
   */
  weight?: number
  /**
   * An opaque id shared by the pavements laid down either side of the same
   * carriageway, and inherited by the pieces they are cut into.
   *
   * Two pavement ends facing each other over open ground are either the two
   * kerbs of a street or a shortcut through a building, and no amount of
   * geometry tells the crowd which: the map has streets it draws in full — a
   * kerb, a carriageway, marked bays, parked cars — without contributing them
   * to the driving network, and across one of those the two answers look
   * identical. The scene knows, so it says.
   */
  street?: number
  /**
   * That there is nowhere along this pavement a body can stand outside a
   * building, as decided by `cutFootwaysAroundSolids` against the solids the
   * scene declared.
   *
   * Kept in the network for its connectivity and avoided as a place to be. See
   * `Crowd.pickCrossing`.
   */
  obstructed?: boolean
}

/** One carriageway, for the purposes of laying pavements beside it. */
export type CarriagewaySpec = {
  points: XZ[]
  closed?: boolean
  kind?: LaneKind
  width?: number
}

/** Gap left between a kerb line and the end of the pavement that stops at it. */
const KERB_SETBACK = .28
/**
 * How square a pavement has to meet a street before the meeting counts as a
 * junction to be cut at, as |cos| between the two directions. A pavement
 * grazing a carriageway at a shallow angle is not a junction; it is the same
 * street seen twice, and cutting there would shred it.
 */
const CUT_SQUARENESS = .5
/** Shortest pavement stub worth keeping after cutting. */
const MIN_PIECE = .8

/**
 * Split each pavement where it runs into a carriageway, leaving the two halves
 * facing each other across the kerb line.
 *
 * This is the fix for the thing that made the maps read as unpeopled rather
 * than as cities. A pavement was authored as one polyline down the whole length
 * of a street, correctly offset from *its own* carriageway — and then it ran
 * straight through every side street on the way, because nothing had ever
 * looked at the two networks together. Measured on the Old Quarter, 39% of all
 * pavement length was inside a carriageway, and the walkers on it were simply
 * in the road for that whole distance with no kerb, no wait and no traffic
 * check. It also meant that the only place two pavements ever ended near each
 * other was the outer edge of the district, so the crossings the crowd derived
 * from pavement ends were nearly all strung along the perimeter road.
 *
 * Doing it here, against the recorded network, rather than in each of the eight
 * places that draw streets, is deliberate: a grid, a ring road, a curved high
 * street and a village lane are drawn by completely different code and all have
 * the same defect, and a rule applied to the finished record cannot be
 * forgotten by the ninth builder.
 *
 * The cut ends are what the crowd then pairs into crossings, so the geometry
 * here decides the crossing geometry: an end left at `width/2 + KERB_SETBACK`
 * from the centreline faces its opposite number square across the street.
 */
export function planFootways(
  ways: FootwaySpec[],
  roads: CarriagewaySpec[],
  options: { setback?: number; minPiece?: number } = {},
): { ways: FootwaySpec[]; cuts: number; unsliced: number } {
  const setback = options.setback ?? KERB_SETBACK
  const minPiece = options.minPiece ?? MIN_PIECE

  type Bar = { ax: number; az: number; bx: number; bz: number; ux: number; uz: number; half: number }
  const bars: Bar[] = []
  for (const road of roads) {
    // Only carriageways. A rail line or a shipping lane crossing a pavement is
    // not a kerb, and the crowd has no yielding behaviour for either.
    if ((road.kind ?? 'road') !== 'road') continue
    const half = (road.width ?? DEFAULT_WIDTH.road) / 2
    const count = road.closed ? road.points.length : road.points.length - 1
    for (let index = 0; index < count; index += 1) {
      const [ax, az] = road.points[index]
      const [bx, bz] = road.points[(index + 1) % road.points.length]
      const length = Math.hypot(bx - ax, bz - az)
      if (length < 1e-4) continue
      bars.push({ ax, az, bx, bz, ux: (bx - ax) / length, uz: (bz - az) / length, half })
    }
  }

  const out: FootwaySpec[] = []
  let cuts = 0
  let unsliced = 0
  for (const way of ways) {
    const points = way.points
    if (points.length < 2) continue
    const closed = way.closed ?? false
    const loop = closed ? [...points, points[0]] : points
    const cumulative: number[] = [0]
    for (let index = 1; index < loop.length; index += 1) {
      cumulative.push(cumulative[index - 1] + Math.hypot(loop[index][0] - loop[index - 1][0], loop[index][1] - loop[index - 1][1]))
    }
    const total = cumulative[cumulative.length - 1]
    if (total < 1e-3) continue

    const found: Array<{ s: number; half: number }> = []
    for (let index = 1; index < loop.length; index += 1) {
      const [ax, az] = loop[index - 1]
      const [bx, bz] = loop[index]
      const span = cumulative[index] - cumulative[index - 1]
      if (span < 1e-5) continue
      const ux = (bx - ax) / span
      const uz = (bz - az) / span
      const minX = Math.min(ax, bx)
      const maxX = Math.max(ax, bx)
      const minZ = Math.min(az, bz)
      const maxZ = Math.max(az, bz)
      for (const bar of bars) {
        if (Math.min(bar.ax, bar.bx) > maxX || Math.max(bar.ax, bar.bx) < minX) continue
        if (Math.min(bar.az, bar.bz) > maxZ || Math.max(bar.az, bar.bz) < minZ) continue
        if (Math.abs(ux * bar.ux + uz * bar.uz) > CUT_SQUARENESS) continue
        const hit = segmentCross(ax, az, bx, bz, bar.ax, bar.az, bar.bx, bar.bz)
        if (!hit) continue
        found.push({ s: cumulative[index - 1] + hit.t * span, half: bar.half })
      }
    }
    if (!found.length) {
      out.push(way)
      continue
    }
    found.sort((a, b) => a.s - b.s)
    // One street is many graph segments and often two overlapping records, so
    // several hits land at the same junction. Merged, keeping the widest, which
    // is the one whose kerb the pavement has to stop at.
    const merged: Array<{ s: number; half: number }> = []
    for (const cut of found) {
      const last = merged[merged.length - 1]
      if (last && cut.s - last.s < .4) {
        last.half = Math.max(last.half, cut.half)
        continue
      }
      merged.push({ ...cut })
    }
    cuts += merged.length

    // A ring pavement cut anywhere is no longer a ring. Rotating the arc to
    // start just past the first cut turns it into the open case, so there is
    // only one piece of slicing code.
    let arcFrom = 0
    let arcTo = total
    let spans: Array<[number, number]> = []
    if (closed) {
      const first = merged[0]
      arcFrom = first.s + first.half + setback
      arcTo = first.s + total - first.half - setback
      let cursor = arcFrom
      for (let index = 1; index < merged.length; index += 1) {
        const cut = merged[index]
        const stop = cut.s - cut.half - setback
        if (stop - cursor >= minPiece) spans.push([cursor, stop])
        cursor = cut.s + cut.half + setback
      }
      if (arcTo - cursor >= minPiece) spans.push([cursor, arcTo])
    } else {
      let cursor = 0
      for (const cut of merged) {
        const stop = cut.s - cut.half - setback
        if (stop - cursor >= minPiece) spans.push([cursor, stop])
        cursor = cut.s + cut.half + setback
      }
      if (total - cursor >= minPiece) spans.push([cursor, total])
    }
    if (!spans.length) {
      // Every piece was shorter than a stub: a short path that happens to end
      // in a junction, most often. Better whole and slightly wrong than gone,
      // because a pavement removed here is a pavement no walker can reach.
      unsliced += 1
      out.push(way)
      continue
    }
    for (const [from, to] of spans) {
      const piece = subPolyline(loop, cumulative, from, to, total)
      if (piece.length >= 2) out.push({ points: piece, halfWidth: way.halfWidth, centre: way.centre, weight: way.weight, street: way.street, obstructed: way.obstructed })
    }
  }
  return { ways: out, cuts, unsliced }
}

/**
 * A footprint a walker has to go *round*, given in world space.
 *
 * The distinction between this and `CrowdOptions.obstacles` is the whole of the
 * pedestrian-versus-props problem, and getting it wrong has cost this project
 * two reverted passes. A bench, a lamp standard, a bollard or a planter belongs
 * on a pavement: a person walks past it, brushing a shoulder round it, and the
 * per-frame steering models exactly that. A cafe, a farmstead, a market stall
 * or a building does not: there is no shoulder-width shift that gets past it,
 * because it *is* the pavement for as long as it stands there.
 *
 * Only the second kind belongs here. Treating the first kind as solid is the
 * mistake the reverted prop-clearance pass made from the other direction —
 * it pushed benches and bollards off carriageways and onto pavements, where a
 * walker bound to a polyline could not get round them, and the pedestrian
 * figures got worse.
 */
export type SolidFootprint = {
  x: number
  z: number
  /** Circumscribing radius. The only shape a disc-shaped footprint needs. */
  radius: number
  /**
   * Half extents and heading of the footprint's real rectangle, where it has
   * one. Optional because most authored props genuinely are round-ish, but it
   * matters enormously for the ones that are not.
   *
   * A terrace block twelve metres long and four deep, described as a disc, is
   * wrong in both directions at once: the disc is three metres too fat across
   * the frontage, so the cut takes out pavement on a street the building never
   * touches, and it is two metres too thin at the corners, so the link guard
   * below waves through a crossing that goes clean through the corner of the
   * building. Both were measured. Cutting on discs alone moved the Sovereign
   * Arc from .0535 to .0890 and The Circuit from .2928 to .3479.
   */
  hx?: number
  hz?: number
  rotationY?: number
}

/**
 * A strip of ground, as solid footprints: one oriented rectangle per segment.
 *
 * Written for the railway, which is the one corridor on the map that a
 * pedestrian route must not touch at all. A carriageway may be crossed, and
 * `planFootways` cuts pavements at one so the crowd can wait, look and step
 * across; a railway may not, because a transport runs on a fixed curve and
 * cannot see, steer or stop, and the crowd has no yielding behaviour for it. So
 * the right-of-way is subtracted from the pedestrian network exactly as a
 * building's footprint is, and the same link guard that refuses a crossing
 * through a farmstead refuses one over the tracks.
 *
 * Measured before this existed: the Sovereign Arc's ring-boulevard pavement
 * runs across the line at `11,7`, and over 600 frames a walker's body was
 * inside a moving train for 119 of them.
 */
export function corridorFootprints(
  points: XZ[],
  halfWidth: number,
  closed = false,
): SolidFootprint[] {
  const out: SolidFootprint[] = []
  const count = closed ? points.length : points.length - 1
  for (let index = 0; index < count; index += 1) {
    const [ax, az] = points[index]
    const [bx, bz] = points[(index + 1) % points.length]
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz)
    if (length < 1e-4) continue
    const hx = length / 2
    out.push({
      x: (ax + bx) / 2,
      z: (az + bz) / 2,
      radius: Math.hypot(hx, halfWidth),
      hx,
      hz: halfWidth,
      // `solidDistance` reads `rotationY` as an object's own rotation, so the
      // angle wanted here is the one whose local +x lands along the segment:
      // a y-rotation of `a` sends local +x to world `(cos a, -sin a)`.
      rotationY: Math.atan2(-dz / length, dx / length),
    })
  }
  return out
}

/**
 * Distance from a point to a solid footprint's surface, zero inside it.
 *
 * A disc unless the caller gave half extents, in which case the oriented
 * rectangle, which is what a building actually is.
 */
function solidDistance(solid: SolidFootprint, x: number, z: number) {
  const dx = x - solid.x
  const dz = z - solid.z
  if (solid.hx === undefined || solid.hz === undefined) {
    return Math.max(0, Math.hypot(dx, dz) - solid.radius)
  }
  const angle = solid.rotationY ?? 0
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // World -> footprint frame. The scene builds these as `rotation.y = a`, which
  // is a rotation of *the object*, so the inverse is what maps a world point in.
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos
  const outX = Math.abs(localX) - solid.hx
  const outZ = Math.abs(localZ) - solid.hz
  if (outX <= 0 && outZ <= 0) return 0
  return Math.hypot(Math.max(0, outX), Math.max(0, outZ))
}

/**
 * Room between a walker's centreline and a footprint before the two are
 * touching: the body, and nothing else.
 *
 * Deliberately *not* the `.34` the per-frame steering aims for. That figure is
 * a comfort margin — the distance a person chooses to leave when they have the
 * room — and cutting at it measured badly: on a footway with real width, an
 * obstacle the walker can pass with a hand's breadth to spare still fails a
 * .34 test, so whole pavements were removed for a lamp standard and the crowd
 * concentrated onto what was left. Measured over 600 frames at the .34
 * clearance, the Sovereign Arc's walkers-in-solid went .0535 -> .0890 and its
 * walker-vehicle contacts 24 -> 253, both from over-cutting.
 *
 * The cut therefore removes only the spans where the walker has no choice but
 * to overlap, and leaves the merely tight ones to the steering, which is what
 * steering is for. Same figure as `WALKER_HALF_BEAM` in the scene, which is
 * how far planned buildings are set back from a pavement for the same reason.
 */
const SOLID_CLEARANCE = .16

/**
 * How far back from a blocked span a pavement stops.
 *
 * Enough that the walker turning at the new end is already clear of the thing
 * that closed the way, rather than standing against it.
 */
const SOLID_SETBACK = .12

/**
 * Step the blocked span is measured to. Comfortably finer than the setback, so
 * the rounding is always smaller than the margin it is rounding into.
 */
const SOLID_STEP = .02

/**
 * A pedestrian's actual horizontal reach, as opposed to the margin the cut
 * leaves round a route.
 *
 * `SOLID_CLEARANCE` above is a *half-beam*: it dates from the crowd being
 * capsule proxies at a .12 shoulder, and the buildings on a planned street are
 * set back by the same .16 for the same reason, so the two agree and the narrow
 * pavements come out exactly as authored. The crowd is not proxies any more. A
 * `buildStylizedCounsel` body at map scale measures .19 to .30 across depending
 * on where in the walk cycle its arms are, and .30 is the top of that range.
 *
 * Used only to decide how much of a footway's *width* a walker may use. It is
 * deliberately not used to decide whether a span of pavement exists: widening
 * the cut criterion to a real body deletes pavement, and deleting pavement is
 * this job's best-documented dead end.
 */
const WALKER_SHOULDER = .3

/** Arc-length lattice the usable width is measured on. */
const NARROW_STEP = .05

/** Lateral lattice the usable width is searched on. */
const NARROW_LATERAL = .02

/**
 * What a way's share of the crowd is multiplied by when the cut could not leave
 * a walkable piece of it. See the `!keep.length` branch.
 *
 * A route rather than a place: enough that the connection is still used, little
 * enough that the district's people stand on pavement that exists.
 */
const OBSTRUCTED_WEIGHT = .15

/**
 * Relative chance of turning onto a pavement that is inside a building, at a
 * corner that offers something else.
 *
 * Not zero. The obstructed way may be the only route between two halves of a
 * district, and a walker already standing on one has to be allowed off it; both
 * of those are links out of the same bucket as the link in. Small enough that a
 * corner offering one clear kerb and one blocked one sends about one person in
 * thirteen the wrong way.
 */
const OBSTRUCTED_TURN = .08

/** A point on a way and the unit normal across it, at arc length `s`. */
function sampleWay(points: XZ[], cumulative: number[], s: number) {
  const total = cumulative[cumulative.length - 1]
  if (s < 0 || s > total) return null
  let low = 0
  let high = cumulative.length - 1
  while (low < high - 1) {
    const middle = (low + high) >> 1
    if (cumulative[middle] <= s) low = middle
    else high = middle
  }
  const [ax, az] = points[low]
  const [bx, bz] = points[high]
  const span = cumulative[high] - cumulative[low]
  if (span < 1e-6) return { x: ax, z: az, nx: 0, nz: 0 }
  const t = (s - cumulative[low]) / span
  return {
    x: ax + (bx - ax) * t,
    z: az + (bz - az) * t,
    nx: (bz - az) / span,
    nz: -(bx - ax) / span,
  }
}

/**
 * Subtract solid footprints from the pedestrian network.
 *
 * This is the piece steering cannot do, and the reason it cannot is worth
 * stating plainly because three passes tried to steer out of it. `Crowd` binds
 * a walker to a footway and clamps its lateral offset to `±way.halfWidth`. On
 * a planned street that half-width is .09 — the paving either side of the
 * polyline, and the honest figure, since anything wider walks people into the
 * traffic. So when a footprint's clear band `[d - r - clearance, d + r +
 * clearance]` covers the whole of `[-halfWidth, halfWidth]`, the set of legal
 * offsets that clear it is *empty*. No steering rule can pick an element of an
 * empty set, and the walker goes through the building.
 *
 * The span a footprint closes is the chord of its clear circle at the far kerb:
 * with `reach = r + clearance` and `need = halfWidth + |d|`, the way is blocked
 * for `|s - s0| <= sqrt(reach² - need²)`, and not blocked at all when
 * `reach <= need`. Everything outside that keeps the pavement it had, so a
 * frontage shop with a stall outside it loses a couple of metres of pavement
 * rather than the street losing its pavement.
 *
 * A way whose every remaining piece is shorter than `minPiece` is dropped
 * outright rather than kept whole. That is the opposite of what `planFootways`
 * does with the same case, and deliberately so: there, a way that cannot be
 * sliced is a short path that happens to end at a junction and is better
 * slightly wrong than absent, because nothing is standing on it. Here, keeping
 * it whole *is* the defect.
 *
 * # The second half: taking back the width, not the pavement
 *
 * Everything above is about whether a station on a way exists at all, and it
 * decides that by asking whether *both* kerbs are inside the same solid — on
 * the stated grounds that if one of them is clear, "the walker has somewhere to
 * go". Nothing made that true. A walker's lateral offset is drawn at random
 * over the full `±halfWidth` when it spawns, is nudged by whoever it passes,
 * and is driven deliberately to the extreme edge by the `browse` errand; the
 * only thing that ever steers it back is `way.obstacles`, which holds the
 * pavement furniture and has never held a building. So a footway with a
 * farmstead over one kerb and open ground over the other survived the cut
 * intact and then put people inside the farmstead.
 *
 * Measured on The Circuit at the shipped tree, over 600 deterministic frames:
 * of the 1167 walker-frames inside a planned building, 1137 were at a lateral
 * offset of at least .75 of the way's own half-width, and 3 were within a
 * quarter of its centreline. The same split holds for the static solids — 814
 * of 923. People are not walking through walls because the route is wrong.
 * They are walking through walls because the route is declared wider than the
 * ground under it, and the widest part of it is inside a building.
 *
 * So each surviving piece is emitted with the largest half-width that keeps a
 * real body clear of every solid along it. This cannot remove a way, cannot
 * shorten one, cannot change what connects to what and cannot move anybody
 * towards a carriageway — it only ever moves walkers *towards* the centreline
 * of the pavement they are already on — which is what makes it safe to measure
 * against a real body (`WALKER_SHOULDER`) rather than against the half-beam the
 * cut itself has to keep using.
 *
 * The width is taken as the minimum over the whole piece rather than varying
 * along it. Subdividing at each change would keep a little more pavement usable
 * and would also manufacture a pair of coincident ends everywhere it did so,
 * which `Crowd` welds into a corner and offers as somewhere to turn; the
 * connectivity of the network is not worth trading for a few centimetres of
 * lateral wander.
 */
export function cutFootwaysAroundSolids(
  ways: FootwaySpec[],
  solids: SolidFootprint[],
  options: {
    defaultHalfWidth?: number
    clearance?: number
    minPiece?: number
    setback?: number
    /** Body the *width* is measured against. See `WALKER_SHOULDER`. */
    bodyRadius?: number
    /**
     * Ground the usable band must stay off, which is never a reason to remove
     * a pavement.
     *
     * The carriageways, in practice. Moving a band off a building moves it
     * towards whatever is on the other side, and on a village lane that is the
     * road: the first arm of this that could shift a band and knew only about
     * buildings took The Circuit's walker-in-a-building share from .5203 to
     * .4031 and its bodies-inside-a-vehicle from 0 to 56, which is not a
     * trade this job is allowed to make. Declaring the tarmac closes it.
     */
    keepOut?: SolidFootprint[]
    /**
     * Body `keepOut` is measured against, which is deliberately the half-beam
     * and not the shoulder.
     *
     * `KERB_TO_PAVEMENT` and the pavement half-widths were authored together
     * against `WALKER_HALF_BEAM`, so a planned street's pavement clears its own
     * carriageway by exactly that and no more. Asking for a shoulder here would
     * declare every correctly-authored pavement in the game unusable; asking
     * for the half-beam says only "no further towards the road than the layout
     * already puts people", which is all this needs to promise.
     */
    keepOutRadius?: number
    /**
     * Whether a piece that ends up standing inside one of these solids should
     * be marked as somewhere the crowd avoids. See `FootwaySpec.obstructed`.
     *
     * Off by default, because the two callers mean different things by
     * `solids`. A building is a thing that should not have people in it, and
     * that is what the flag is for. The railway right-of-way is a thing that
     * should not have a *pavement* on it, which the cut has already dealt with
     * by taking the pavement off it, and what is left is a level crossing,
     * which is a place people are supposed to walk through: marking those and
     * steering the crowd off them moved the Sovereign Arc's walkers onto the
     * ring boulevard and put 91 frames of a body inside a vehicle.
     */
    avoidWhenInside?: boolean
    /**
     * Whether to touch the usable width at all, or only to remove the spans
     * that are wholly blocked. See the right-of-way pass in the scene.
     */
    narrow?: boolean
  } = {},
): { ways: FootwaySpec[]; cut: number; unwalkable: number; blocked: number; narrowed: number; narrowedFrom: number; obstructed: number } {
  const keepOut = options.keepOut ?? []
  if (!solids.length && !keepOut.length) return { ways, cut: 0, unwalkable: 0, blocked: 0, narrowed: 0, narrowedFrom: 0, obstructed: 0 }
  const defaultHalfWidth = options.defaultHalfWidth ?? .65
  const clearance = options.clearance ?? SOLID_CLEARANCE
  const body = options.bodyRadius ?? WALKER_SHOULDER
  const keepOutBody = options.keepOutRadius ?? SOLID_CLEARANCE
  const avoidWhenInside = options.avoidWhenInside ?? false
  const narrowing = options.narrow ?? true
  // Shorter than `planFootways` keeps, and deliberately. That figure is about
  // whether a *junction* slice is worth having; this is about whether there is
  // anywhere to stand between two shopfronts, and a stride and a half is.
  const minPiece = options.minPiece ?? .6
  const setback = options.setback ?? SOLID_SETBACK

  const out: FootwaySpec[] = []
  let cut = 0
  let unwalkable = 0
  let blocked = 0
  let narrowed = 0
  let narrowedFrom = 0
  let obstructedWays = 0
  for (const way of ways) {
    const points = way.points
    if (points.length < 2) continue
    const halfWidth = way.halfWidth ?? defaultHalfWidth
    const closed = way.closed ?? false
    const loop = closed ? [...points, points[0]] : points
    const cumulative: number[] = [0]
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of loop) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    for (let index = 1; index < loop.length; index += 1) {
      cumulative.push(cumulative[index - 1] + Math.hypot(loop[index][0] - loop[index - 1][0], loop[index][1] - loop[index - 1][1]))
    }
    const total = cumulative[cumulative.length - 1]
    if (total < 1e-3) continue

    /**
     * The band a body still clears at each station of a `NARROW_STEP` lattice,
     * as its two edges across the polyline. Starts at what the way claims and
     * is only ever narrowed, so no walker ever reaches ground it could not
     * reach before — which is what makes this safe to do against a real body
     * without re-opening the walker-into-traffic question.
     */
    // Seeded from the band the way already has, not from the polyline: this
    // pass runs twice, once for the right-of-way and once for the solids, and
    // the second run must not hand back the width the first one took.
    const bandCentre = way.centre ?? 0
    const stations = Math.max(1, Math.ceil(total / NARROW_STEP))
    const bandLow = new Float64Array(stations + 1).fill(bandCentre - halfWidth)
    const bandHigh = new Float64Array(stations + 1).fill(bandCentre + halfWidth)

    /**
     * How much of the band one footprint takes, before asking whether it takes
     * all of it. Distance to a convex body is 1-Lipschitz along the cross line,
     * so a station whose whole remaining band is further off than the body
     * cannot be constrained by this footprint at all, and that reject is what
     * keeps a per-station search affordable.
     */
    const narrowAgainst = (solid: SolidFootprint, reachOfBody: number, along: number) => {
      const reach = solid.radius + reachOfBody + halfWidth + Math.abs(bandCentre)
      const first = Math.max(0, Math.floor((along - reach) / NARROW_STEP))
      const last = Math.min(stations, Math.ceil((along + reach) / NARROW_STEP))
      for (let station = first; station <= last; station += 1) {
        const lowEdge = bandLow[station]
        const highEdge = bandHigh[station]
        if (highEdge <= lowEdge) continue
        const at = sampleWay(loop, cumulative, Math.min(total, station * NARROW_STEP))
        if (!at) continue
        const reachOf = (offset: number) => solidDistance(solid, at.x + at.nx * offset, at.z + at.nz * offset)
        // Nothing in the band can be within a body of a footprint that is
        // further than that plus the band's own extent from the polyline.
        if (reachOf(0) >= reachOfBody + Math.max(Math.abs(lowEdge), Math.abs(highEdge))) continue
        // The offsets this solid takes are one interval, because distance to a
        // convex body along the cross line is convex. One sweep finds it; the
        // longer clear side of it is what the band becomes, which moves the
        // band off the building rather than shrinking it onto its own
        // centreline — the difference between a walker who can still sidestep
        // a bench and one who has nowhere left to sidestep into.
        let takenFrom = Infinity
        let takenTo = -Infinity
        let least = -Infinity
        let leastAt = lowEdge
        for (let offset = lowEdge; offset <= highEdge + 1e-9; offset += NARROW_LATERAL) {
          const room = reachOf(offset)
          if (room > least) { least = room; leastAt = offset }
          if (room >= reachOfBody) continue
          if (offset < takenFrom) takenFrom = offset
          takenTo = offset
        }
        if (takenFrom > takenTo) continue
        const belowRoom = takenFrom - NARROW_LATERAL - lowEdge
        const aboveRoom = highEdge - (takenTo + NARROW_LATERAL)
        if (belowRoom <= 0 && aboveRoom <= 0) {
          // Every offset touches, so the band becomes the single offset that is
          // least far inside. The midpoint of what was there is the obvious
          // alternative and is wrong where this matters: The Circuit has a lane
          // that runs *through* a building at `10,-7`, so "off the wall" and
          // "off the tarmac" have no common answer there, and splitting the
          // difference parks the walker in the middle of the carriageway.
          bandLow[station] = leastAt
          bandHigh[station] = leastAt
        } else if (belowRoom >= aboveRoom) {
          bandHigh[station] = takenFrom - NARROW_LATERAL
        } else {
          bandLow[station] = takenTo + NARROW_LATERAL
        }
      }
    }

    const nearby = (solid: SolidFootprint, body: number) => {
      const reach = solid.radius + body + halfWidth + Math.abs(bandCentre)
      if (solid.x < minX - reach || solid.x > maxX + reach) return false
      if (solid.z < minZ - reach || solid.z > maxZ + reach) return false
      return true
    }

    // The band first, off everything, including the tarmac. Then the cut, off
    // the solids only: a carriageway beside a pavement is where the pavement is
    // supposed to be and is never a reason to remove one.
    for (const edge of narrowing ? keepOut : []) {
      if (!nearby(edge, keepOutBody)) continue
      narrowAgainst(edge, keepOutBody, projectOntoPolyline(loop, cumulative, edge.x, edge.z).s)
    }

    const spans: Array<[number, number]> = []
    /** The solids this way is anywhere near, kept for the standing-in-it test. */
    const near: SolidFootprint[] = []
    for (const solid of solids) {
      if (!nearby(solid, Math.max(clearance, body))) continue
      near.push(solid)
      const hit = projectOntoPolyline(loop, cumulative, solid.x, solid.z)
      if (narrowing) narrowAgainst(solid, body, hit.s)

      // Both kerbs, because the blocked set across the way is an interval: the
      // distance to a convex body along a straight line is a convex function of
      // position on it, so if the two edges of the band are both inside the
      // clearance then everything between them is too, and if either is outside
      // then the walker has somewhere to go.
      const blockedAt = (s: number) => {
        const at = sampleWay(loop, cumulative, s)
        if (!at) return false
        return solidDistance(solid, at.x + at.nx * halfWidth, at.z + at.nz * halfWidth) < clearance
          && solidDistance(solid, at.x - at.nx * halfWidth, at.z - at.nz * halfWidth) < clearance
      }
      if (!blockedAt(hit.s)) continue
      // Marched rather than solved. A chord has a closed form only against a
      // circle on a straight way; this is the same question asked of a
      // rectangle on a way that bends, and the answer is wanted to about a
      // sixth of the setback, which one pass of small steps gives directly.
      let from = hit.s
      let to = hit.s
      const limit = solid.radius + clearance + halfWidth * 2
      while (from > hit.s - limit && blockedAt(from - SOLID_STEP)) from -= SOLID_STEP
      while (to < hit.s + limit && blockedAt(to + SOLID_STEP)) to += SOLID_STEP
      spans.push([from - setback, to + setback])
    }
    /**
     * The band every station of a piece can honour: the intersection of their
     * bands, which is the widest one interval that is clear along the whole
     * piece. Stations wrap modulo the lattice so a ring's rotated arc reads the
     * cells the unrotated one would.
     *
     * Taken over the piece as a whole rather than varying along it.
     * Subdividing at each change would keep a little more pavement usable and
     * would also manufacture a pair of coincident ends everywhere it did so,
     * which `Crowd` welds into a corner and offers as somewhere to turn; the
     * connectivity of the network is not worth a few centimetres of wander.
     */
    const bandOver = (from: number, to: number) => {
      let low = bandCentre - halfWidth
      let high = bandCentre + halfWidth
      const start = Math.floor(from / NARROW_STEP)
      const stop = Math.ceil(to / NARROW_STEP)
      for (let station = start; station <= stop; station += 1) {
        const slot = closed
          ? ((station % stations) + stations) % stations
          : Math.min(stations, Math.max(0, station))
        if (bandLow[slot] > low) low = bandLow[slot]
        if (bandHigh[slot] < high) high = bandHigh[slot]
      }
      // Disjoint bands along the piece leave no interval clear for all of it.
      // The midpoint of the tighter constraint is the least bad single line.
      if (high < low) { const middle = (low + high) / 2; return { centre: middle, half: 0 } }
      return { centre: (low + high) / 2, half: (high - low) / 2 }
    }
    /**
     * Whether the band a piece is left with is, for most of its length, ground
     * that is *inside* something rather than merely close to it.
     *
     * The width pass above answers "how much of this pavement can a body use",
     * and where the answer is none it has to fall back on a least-bad line and
     * carry on, because a pavement is a connection and the connection is worth
     * more than the overlap. This is the separate question of whether that
     * least-bad line is a place to put a person, and the two have to be asked
     * separately: a .18-wide planned-street pavement collapses to a line under
     * a body of .3 wherever anything at all stands near it, which is most of
     * The Circuit, and almost none of those are inside a building.
     *
     * Deliberately the *penetrating* test rather than the clearance one. A
     * walker whose shoulder is a centimetre off a shopfront is a pedestrian on
     * a narrow pavement; a walker whose centre is two metres inside a barn is
     * the reported defect, and only the second is worth rerouting a district
     * around.
     */
    const standingInside = (from: number, to: number, band: { centre: number; half: number }) => {
      // Only a pavement with no width left to it. A piece that still has a band
      // has somewhere on it a body fits, so the crowd can be left to use it:
      // taking people off every pavement with a building over part of it is a
      // much larger claim, and it measured as one — the Old Quarter, whose
      // frontages are continuous and whose pavements are all partly under
      // something, went .0117 to .0446 walkers-in-a-facade when this was asked
      // of every piece rather than of the ones with nowhere to stand.
      if (!avoidWhenInside || band.half > 1e-9 || !near.length) return false
      const offsets = [band.centre]
      let inside = 0
      let counted = 0
      for (let s = from; s <= to + 1e-9; s += NARROW_STEP) {
        const at = sampleWay(loop, cumulative, closed ? ((s % total) + total) % total : Math.min(total, Math.max(0, s)))
        if (!at) continue
        counted += 1
        let clear = false
        for (const offset of offsets) {
          const x = at.x + at.nx * offset
          const z = at.z + at.nz * offset
          let free = true
          for (const solid of near) {
            // `solidDistance` clamps at zero, so nought *is* the inside.
            if (solidDistance(solid, x, z) <= 0) { free = false; break }
          }
          if (free) { clear = true; break }
        }
        if (!clear) inside += 1
      }
      return counted > 0 && inside * 2 > counted
    }
    // A cut piece of a ring is not a ring, so `closed` is deliberately not
    // carried over, exactly as before this pass existed.
    const emit = (points: XZ[], from: number, to: number) => {
      const band = bandOver(from, to)
      if (band.half < halfWidth - 1e-9) {
        narrowed += 1
        narrowedFrom += halfWidth - band.half
      }
      const inside = standingInside(from, to, band)
      if (inside) obstructedWays += 1
      out.push({
        points,
        halfWidth: band.half,
        centre: band.centre,
        weight: way.weight,
        street: way.street,
        obstructed: way.obstructed || inside,
      })
    }

    if (!spans.length) {
      const band = bandOver(0, total)
      const inside = standingInside(0, total, band)
      if (inside) obstructedWays += 1
      if (band.half >= halfWidth - 1e-9 && !inside) out.push(way)
      else {
        if (band.half < halfWidth - 1e-9) {
          narrowed += 1
          narrowedFrom += halfWidth - band.half
        }
        out.push({ ...way, halfWidth: band.half, centre: band.centre, obstructed: way.obstructed || inside })
      }
      continue
    }
    spans.sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = []
    for (const span of spans) {
      const last = merged[merged.length - 1]
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
      else merged.push([span[0], span[1]])
    }
    for (const [from, to] of merged) blocked += Math.min(to, total) - Math.max(from, 0)
    cut += merged.length

    // A ring cut anywhere is no longer a ring. Rotating the arc to start just
    // past the first cut turns it into the open case, exactly as `planFootways`
    // does, so there is only ever one piece of slicing code to be wrong.
    const keep: Array<[number, number]> = []
    if (closed) {
      const first = merged[0]
      let cursor = first[1]
      const arcTo = first[0] + total
      for (let index = 1; index < merged.length; index += 1) {
        const [start, stop] = merged[index]
        if (start - cursor >= minPiece) keep.push([cursor, start])
        cursor = stop
      }
      if (arcTo - cursor >= minPiece) keep.push([cursor, arcTo])
    } else {
      let cursor = 0
      for (const [start, stop] of merged) {
        if (start - cursor >= minPiece) keep.push([cursor, start])
        cursor = stop
      }
      if (total - cursor >= minPiece) keep.push([cursor, total])
    }
    if (!keep.length) {
      // Nothing survived, so keep the way as it was.
      //
      // Deleting it is the tidier answer and it measured badly. The Circuit is
      // 37 footways and 95 units of pavement for nine people, and four of those
      // ways vanished here — among them the walk across the market place, which
      // is short, which is lined with exactly the market cross and courthouse
      // that closed it, and which is the one path through the middle of the
      // village. The nine walkers redistributed onto the lanes, which run past
      // farmsteads, and the region went .2928 to .4894 on the .12 ruler while
      // the pass was nominally removing pedestrians from buildings.
      //
      // So the rule is: a pavement may be shortened but not abolished. Where a
      // way is so beset that no walkable piece is left, the honest reading is
      // that the region has no alternative route and losing the connection
      // costs more than the overlap does.
      //
      // Kept, but not kept *equal*. The connection is the reason to keep it and
      // is all it is being kept for: nowhere on it is a place a walker can stand
      // clear, so it should not be drawing its full share of the district's foot
      // traffic. Spawn weight is per metre of pavement (`buildFootway` stores
      // `length * weight`), so a way kept whole here otherwise competes for
      // people on the strength of the very length that is obstructed, and the
      // pieces cut out of its neighbours make it competitive in proportion to
      // how much of the district is blocked. Measured on The Circuit, which is
      // 43 ways and 99 units of pavement for nine people: declaring its
      // buildings took its fully-blocked ways from five to eight, and its
      // walkers-in-a-planned-building share from 0 to .1616 with no other change
      // to the network.
      //
      // Deliberately not zero, and deliberately not a deletion. Both starve the
      // connection, and deletion is the recorded dead end above.
      //
      // Narrowed as well as de-weighted, and for the same reason the surviving
      // pieces are: there is nowhere clear to stand on this way, but the
      // centreline is still the least bad line on it, and a walker held to the
      // centreline of a blocked pavement is less far inside the thing blocking
      // it than one drifting to the kerb of one.
      unwalkable += 1
      const band = bandOver(0, total)
      if (band.half < halfWidth - 1e-9) {
        narrowed += 1
        narrowedFrom += halfWidth - band.half
      }
      const inside = standingInside(0, total, band)
      if (inside) obstructedWays += 1
      out.push({
        ...way,
        halfWidth: band.half,
        centre: band.centre,
        weight: (way.weight ?? 1) * OBSTRUCTED_WEIGHT,
        obstructed: way.obstructed || inside,
      })
      continue
    }
    for (const [from, to] of keep) {
      const piece = subPolyline(loop, cumulative, Math.max(0, from), Math.min(closed ? from + total : total, to), total)
      if (piece.length >= 2) emit(piece, Math.max(0, from), to)
    }
  }
  return { ways: out, cut, unwalkable, blocked: +blocked.toFixed(2), narrowed, narrowedFrom: +narrowedFrom.toFixed(2), obstructed: obstructedWays }
}

/** Where a world point falls on a plain polyline: along, across, distance. */
function projectOntoPolyline(points: XZ[], cumulative: number[], x: number, z: number) {
  let bestS = 0
  let bestD = 0
  let bestSquared = Infinity
  for (let index = 1; index < points.length; index += 1) {
    const [ax, az] = points[index - 1]
    const [bx, bz] = points[index]
    const dx = bx - ax
    const dz = bz - az
    const span = dx * dx + dz * dz
    if (span < 1e-8) continue
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / span))
    const px = ax + dx * t
    const pz = az + dz * t
    const squared = (x - px) * (x - px) + (z - pz) * (z - pz)
    if (squared >= bestSquared) continue
    bestSquared = squared
    const magnitude = Math.sqrt(span)
    bestS = cumulative[index - 1] + magnitude * t
    bestD = (x - px) * (dz / magnitude) - (z - pz) * (dx / magnitude)
  }
  return { s: bestS, d: bestD, distance: Math.sqrt(bestSquared) }
}

/**
 * The part of a polyline between two arc lengths, with the original vertices in
 * between preserved. `wrap` lets a closed way be read past its own end.
 */
function subPolyline(points: XZ[], cumulative: number[], from: number, to: number, wrap: number): XZ[] {
  const at = (s: number): XZ => {
    let target = s
    if (target > cumulative[cumulative.length - 1]) target -= wrap
    if (target < 0) target += wrap
    let low = 0
    let high = cumulative.length - 1
    while (low < high - 1) {
      const middle = (low + high) >> 1
      if (cumulative[middle] <= target) low = middle
      else high = middle
    }
    const span = cumulative[high] - cumulative[low]
    const t = span > 1e-5 ? (target - cumulative[low]) / span : 0
    return [
      points[low][0] + (points[high][0] - points[low][0]) * t,
      points[low][1] + (points[high][1] - points[low][1]) * t,
    ]
  }
  const result: XZ[] = [at(from)]
  const push = (point: XZ) => {
    const last = result[result.length - 1]
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-3) result.push(point)
  }
  for (let index = 0; index < cumulative.length; index += 1) {
    const s = cumulative[index] + (cumulative[index] < from && to > wrap ? wrap : 0)
    if (s > from && s < to) push(points[index])
  }
  push(at(to))
  return result
}

export type CrowdOptions = {
  /** Footway polylines the crowd may walk along, in world space. */
  ways: FootwaySpec[]
  /** Articulated rigs, already built and parented by the caller. */
  rigs: Array<{ root: THREE.Object3D; rig: StylizedCounselRig; seed: number }>
  /** Optional cheap distant walkers, one InstancedMesh pair supplied by the caller. */
  instanced?: { mesh: THREE.InstancedMesh; count: number }
  /** Walkers further than this from the camera stop animating their limbs. */
  animateWithin?: number
  /** Usable width of the footway; walkers spread across it rather than queueing. */
  width?: number
  /** Walking height of the rig root. */
  lift?: number
  /** Seconds a walker spends fading in/out. */
  fade?: number
  /** Beyond this distance a point counts as hidden by fog. */
  fogDistance?: number
  /** Walkers further than this from the camera are recycled. */
  cullRadius?: number
  /** Fraction of the rig pool on the street at any moment, 0..1. */
  occupancy?: number
  /**
   * Ground furniture walkers have to get round: benches, planters, stalls,
   * bollards. Given in world space; each is projected onto whichever footways
   * pass close to it when the crowd is built.
   */
  obstacles?: Array<{ x: number; z: number; radius: number }>
  /**
   * The subset of those footprints that a walker cannot pass at all. See
   * `SolidFootprint` and `cutFootwaysAroundSolids`, which is what removes the
   * pavement under them.
   *
   * They are needed a second time here because cutting a pavement leaves two
   * ends facing each other across the thing that closed it, and the crossing
   * pass pairs ends that face each other. Under `CORNER_JOIN` those two ends
   * are a metre apart with no carriageway between them, which is the exact
   * description of a kerbside corner — so without this the crossing pass
   * cheerfully relinks the cut and routes the walker straight back through the
   * building the cut just took them out of.
   */
  solids?: SolidFootprint[]
  /**
   * How far apart two footway ends may be and still count as opposite kerbs of
   * the same crossing. Zero disables crossings entirely.
   */
  crossingRange?: number
  /**
   * The road network the crossings cut across, and the simulations running on
   * it. Supplying both is what makes a crossing traffic-aware: the crowd
   * resolves each kerb-to-kerb link against the graph once, at build time, and
   * from then on a walker at a kerb asks the traffic for a time-to-arrival at
   * exactly the points its route crosses a carriageway. Omit them and
   * crossings still work, on a timer, as they did before.
   */
  roadGraph?: RoadGraph
  traffic?: TrafficSim[]
}

/**
 * One way a vehicle can reach a conflict point: the edge it is on, the edge it
 * must have chosen next for this route to apply (-1 where it is already on the
 * final approach), and the distance from the end of that edge to the point.
 */
type Approach = { edge: number; via: number; offset: number }

/**
 * Where one crossing meets one carriageway: which directed edge, how far along
 * it, how far along the crossing itself the conflict sits, and every route by
 * which traffic arrives there.
 *
 * Resolved once when the crowd is built. The whole point of precomputing it is
 * that the per-frame question — "is anything coming?" — then reduces to a
 * lookup on the traffic sim's existing per-edge occupancy list, with no
 * geometry and no search.
 */
type CrossingConflict = { edge: number; distance: number; at: number; approaches: Approach[] }

/**
 * How far back up the network a crossing watches for traffic.
 *
 * This has to be a distance in world units rather than a hop count because the
 * road graph is subdivided far more finely than a street plan suggests: a
 * carriageway that reads as one block is a dozen two-metre edges, so "look one
 * edge back" is barely a second of warning at the sim's road speeds, and a
 * walker needs its whole crossing time plus a margin. Sized for the slowest
 * plausible walker against the fastest road: about eight seconds of warning at
 * default road speed, which is comfortably more than any crossing takes.
 */
const APPROACH_REACH = 11
/**
 * Ceiling on approach routes per conflict point. A junction with four arms and
 * a fine subdivision can otherwise fan out into hundreds of paths, and the
 * later ones are all far enough back to be irrelevant. Breadth-first order
 * means the cap always drops the most distant routes first.
 */
const APPROACH_CAP = 24

/**
 * Margin outside the kerb line within which a point still counts as being *in*
 * the carriageway. Added to the edge's own half-width, so a lane and an
 * arterial are judged at their real widths rather than at one guessed figure.
 */
const IN_LANE_MARGIN = .12
/** How nearly parallel to the carriageway, as |cos|, before it counts. */
const IN_LANE_PARALLEL = .7
/**
 * How square a crossing has to meet the carriageway it cuts, as |cos| between
 * the two directions. Zero is a right angle; this admits anything from about
 * sixty degrees up.
 *
 * The gate this feeds is the second half of the pavement fix. Pairing pavement
 * ends by proximity finds the crossings that matter — the two kerbs of a
 * street, and the mouth of a side street — but it also finds the diagonal
 * across a junction and, before the pavements were cut at junctions at all, a
 * long tail of links that simply ran down the middle of a road. A pedestrian
 * route that shares a lane with the traffic for its whole length is not a
 * crossing however carefully it is timed, so those are refused rather than
 * managed.
 *
 * Twenty-two degrees off square. Sixty was the first attempt and let through
 * eighty-eight corner-to-corner diagonals in the Old Quarter alone: a link from
 * one corner of a junction to the one opposite is only two thirds of the way to
 * parallel with one of the two streets, so it passes a loose test on angle and
 * a loose test on length at the same time.
 */
const CROSS_SQUARENESS = .38
/**
 * Longest link accepted between two corners with no carriageway between them at
 * all. At this length it is a break in the paving at a corner; any longer and,
 * between two pavements laid along streets, it is a route over whatever they
 * were laid around — which on a grid is a terrace.
 */
const CORNER_JOIN = 1.1
/**
 * How far the connectivity repair will reach to attach a stranded pavement, and
 * how many times it will try. The reach is generous because the alternative is
 * an island; the count is bounded because each pass is quadratic in corners, and
 * a region with hundreds of genuine islands has a scene problem that no amount
 * of stitching will hide.
 */
const STITCH_RANGE = 9
const MAX_STITCHES = 64
/**
 * Pavement ends closer than this are welded into one corner. Sized to absorb
 * the disagreement between the pavement offsets different builders use — a
 * grid street's kerb line and a curved high street's are set out by unrelated
 * code — while staying well under the narrowest street anyone can cross.
 */
const CORNER_WELD = .45
/**
 * How much longer than the carriageway it cuts, plus its two kerb setbacks, a
 * crossing may be. Covers a link taken at a slight angle and the difference
 * between the graph's welded geometry and the drawn one.
 *
 * Tight, because the squareness test alone does not catch a diagonal: a link
 * two blocks east and one north is within sixty degrees of square to the
 * north-south street it happens to cut, so it passes on angle and is only
 * refused on length. At .8 a scattering of those survived, reading in plan as
 * shortcuts clipping the corners of terraces.
 */
const CROSS_SLACK = .45
/** Longest link accepted between the two kerbs of a street with no traffic on it. */
const SAME_STREET_RANGE = 3.2

/** Minimum look-both-ways pause at a kerb, before traffic is even considered. */
const KERB_LOOK = .35
/**
 * Seconds of margin a walker wants between clearing a lane and the next
 * vehicle reaching it.
 */
const CROSS_MARGIN = .9
/** Width of carriageway a walker has to be clear of before a lane counts as behind them. */
const LANE_CLEARANCE = 1.1
/**
 * How long a walker will hold at a kerb before giving up and walking back the
 * way it came. A real pedestrian waits a long time; the cap exists because a
 * body held at a kerb for the whole mount is a walker permanently withdrawn
 * from the pavement, and on a busy junction that quietly empties the district.
 */
const KERB_PATIENCE = 11

/** An obstacle in one footway's own coordinates: along, across, and its size. */
type WayObstacle = { s: number; d: number; radius: number }

/**
 * One link between two corners of the pedestrian network.
 *
 * A corner is a place where pavements end, not one pavement's end: at an
 * ordinary crossroads eight pavement ends land on four corners, two to a
 * corner, and the crossing over the north arm is one piece of road whichever of
 * the two pavements at each side the walker happens to be on. Welding them
 * first is what keeps the link count proportional to the number of junctions
 * rather than to the square of the pavements meeting at them — on the Old
 * Quarter, four thousand links instead of twenty-six thousand, with the
 * conflict resolution and its approach search scaled down to match.
 */
type Crossing = {
  /** Pavement ends at the far corner, encoded `way * 2 + end`. */
  toEnds: number[]
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  length: number
  /**
   * The two ends are the same corner rather than opposite kerbs: where a
   * pavement running along one street meets the pavement running up the street
   * it has just stopped at. Turning that corner is not a crossing — there is no
   * carriageway between the two ends — so the walker takes it at pace instead
   * of standing at a kerb it is not actually at.
   */
  kerbside: boolean
}

type Footway = {
  /** Flat x,z pairs. Flat arrays because these are read every frame. */
  points: Float32Array
  /** Cumulative arc length at each vertex; `length` is its last entry. */
  cumulative: Float32Array
  length: number
  closed: boolean
  /**
   * Half the paved width available either side of the centreline. Per pavement,
   * because the aprons on this map are a fixed strip beside carriageways that
   * differ by a factor of four: one global figure either holds people to the
   * middle of an esplanade or walks them off the edge of a lane's kerb.
   */
  halfWidth: number
  /**
   * Where the usable band sits across the polyline, positive to the polyline's
   * left. Zero on a pavement with nothing over either edge of it.
   *
   * `halfWidth` alone can only describe a band centred on the line, and a
   * building standing over one kerb needs the band moved rather than shrunk:
   * shrinking a 1.3-wide village pavement to nothing because a farmstead is
   * .3 off one side of it holds everybody to a single file down the middle,
   * which takes away the room the furniture avoidance needs to work in and puts
   * them in the bench instead. See `cutFootwaysAroundSolids`.
   */
  centre: number
  /** Length × class weight, for choosing where a walker appears. */
  weight: number
  /** Which carriageway this pavement runs beside, or -1. See `FootwaySpec`. */
  street: number
  /** That most of this pavement is inside a building. See `FootwaySpec`. */
  obstructed: boolean
  /** Furniture on this pavement, sorted by distance along it. */
  obstacles: WayObstacle[]
}

type Walker = {
  root: THREE.Object3D
  rig: StylizedCounselRig
  humanoid: HumanoidActor
  seed: number
  baseScale: number
  active: boolean
  way: number
  distance: number
  direction: 1 | -1
  lateral: number
  targetLateral: number
  speed: number
  /** Speed this walker would hold if nothing were happening to it. */
  cruise: number
  /** What the walker is doing right now, and for how much longer. */
  errand: 'walk' | 'pause' | 'browse'
  errandTimer: number
  /** Eased multiplier on `cruise`, so pace changes are never a step. */
  pace: number
  /** Index of the walker this one is out with, or -1. */
  companion: number
  /** Index into `crossings` while stepping off one kerb for another, or -1. */
  crossing: number
  /** Standing at the kerb looking, or actually out in the road. */
  crossPhase: 'wait' | 'go'
  crossTimer: number
  crossProgress: number
  /** Seconds spent at the kerb on this attempt, for patience and for the idle. */
  crossHeld: number
  /** Countdown to the next look up or down the road while waiting. */
  crossGlance: number
  heading: number
  ramp: number
  phase: 'in' | 'run' | 'out' | 'idle'
  life: number
  /** Hysteresis gate for walk vs idle clip selection. */
  walking: boolean
  /** World position at end of last frame, for measuring ground speed. */
  previousWorld: THREE.Vector3
}

function buildFootway(points: XZ[], closed: boolean, halfWidth: number, weight: number, street: number, centre: number, obstructed: boolean): Footway | null {
  const count = points.length + (closed ? 1 : 0)
  if (points.length < 2) return null
  const flat = new Float32Array(count * 2)
  for (let index = 0; index < count; index += 1) {
    const [x, z] = points[index % points.length]
    flat[index * 2] = x
    flat[index * 2 + 1] = z
  }
  const cumulative = new Float32Array(count)
  for (let index = 1; index < count; index += 1) {
    const dx = flat[index * 2] - flat[(index - 1) * 2]
    const dz = flat[index * 2 + 1] - flat[(index - 1) * 2 + 1]
    cumulative[index] = cumulative[index - 1] + Math.hypot(dx, dz)
  }
  const length = cumulative[count - 1]
  if (length < 1e-3) return null
  return { points: flat, cumulative, length, closed, halfWidth, centre, weight: length * weight, street, obstructed, obstacles: [] }
}

/** First index whose `s` is at or past `value`, in a list sorted by `s`. */
function lowerBound(list: WayObstacle[], value: number) {
  let low = 0
  let high = list.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (list[middle].s < value) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Where a world-space point falls on a polyline: distance along, and signed
 * distance across. Used once per obstacle per footway when the crowd is built,
 * never per frame.
 */
function projectOntoWay(way: Footway, x: number, z: number) {
  let bestS = 0
  let bestD = 0
  let bestSquared = Infinity
  const count = way.cumulative.length
  for (let index = 1; index < count; index += 1) {
    const ax = way.points[(index - 1) * 2]
    const az = way.points[(index - 1) * 2 + 1]
    const bx = way.points[index * 2]
    const bz = way.points[index * 2 + 1]
    const dx = bx - ax
    const dz = bz - az
    const span = dx * dx + dz * dz
    if (span < 1e-8) continue
    const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / span, 0, 1)
    const px = ax + dx * t
    const pz = az + dz * t
    const squared = (x - px) * (x - px) + (z - pz) * (z - pz)
    if (squared >= bestSquared) continue
    bestSquared = squared
    const magnitude = Math.sqrt(span)
    bestS = way.cumulative[index - 1] + magnitude * t
    // Left of travel is negative, matching how `lateral` is applied below.
    bestD = ((x - px) * (dz / magnitude) - (z - pz) * (dx / magnitude))
  }
  return { s: bestS, d: bestD, distance: Math.sqrt(bestSquared) }
}

/**
 * Where two segments cross, as parameters along each, or null.
 *
 * Build-time only, once per crossing per candidate carriageway.
 */
function segmentCross(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
) {
  const rx = bx - ax
  const rz = bz - az
  const sx = dx - cx
  const sz = dz - cz
  const denominator = rx * sz - rz * sx
  // Parallel, which for a crossing and a road means the "crossing" runs along
  // the carriageway rather than over it. There is no conflict point on a
  // pavement that happens to be collinear with the street it serves.
  if (Math.abs(denominator) < 1e-6) return null
  const qpx = cx - ax
  const qpz = cz - az
  const t = (qpx * sz - qpz * sx) / denominator
  const u = (qpx * rz - qpz * rx) / denominator
  if (t < -.02 || t > 1.02 || u < -.02 || u > 1.02) return null
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) }
}

/**
 * Every route by which traffic reaches `distance` along `edge`, out to
 * `APPROACH_REACH`.
 *
 * A breadth-first walk *backwards* from the conflict point. Both carriageways
 * of a two-way street are seeded, because a crossing spans the whole road, and
 * from there each step takes the incoming arms of the node the previous edge
 * started at. An arm is only a genuine approach for vehicles that have chosen
 * the edge downstream of it, which is what `via` records: without it a car
 * approaching a junction it is about to turn away from would hold a pedestrian
 * on an unrelated arm. Incoming edges are found as the twins of a node's
 * outgoing ones — exact on the two-way network the map builds, and a genuinely
 * one-way arm is simply not watched, which the vehicle-side standoff covers.
 *
 * Build-time only, once per crossing per carriageway it cuts.
 */
function buildApproaches(graph: RoadGraph, edgeIndex: number, distance: number): Approach[] {
  const kind = graph.edges[edgeIndex].kind
  const found: Approach[] = []
  const seen = new Set<number>()
  const stride = graph.edges.length + 1
  const add = (edge: number, via: number, offset: number) => {
    const key = edge * stride + via + 1
    if (seen.has(key)) return false
    seen.add(key)
    found.push({ edge, via, offset })
    return true
  }
  // node: whose incoming arms to examine next; via: the edge a vehicle on one of
  // those arms must have chosen; offset: distance from that node to the point.
  const queue: Array<{ node: number; via: number; offset: number }> = []
  const seed = (index: number, at: number) => {
    const edge = graph.edges[index]
    add(index, -1, at - edge.length)
    queue.push({ node: edge.from, via: index, offset: at })
  }
  seed(edgeIndex, distance)
  const twin = graph.edges[edgeIndex].twin
  if (twin >= 0) seed(twin, graph.edges[twin].length - distance)

  // Most conflict points sit at a junction, because that is where the footways
  // either side of a street meet. A vehicle that has just turned out of one is
  // physically still over the point while being, as far as its own edge is
  // concerned, somewhere else entirely — so the arms leaving the node are worth
  // watching too. Added before the walk outward so the cap cannot crowd them
  // out, and only where the point is close enough to the node for a vehicle
  // leaving it to still be standing on the crossing.
  const departures = (index: number, at: number) => {
    const edge = graph.edges[index]
    if (edge.length - at > VEHICLE_CLEAR) return
    const arms = graph.nodes[edge.to].out
    for (let slot = 0; slot < arms.length; slot += 1) {
      const arm = graph.edges[arms[slot]]
      if (arm.kind !== kind || arms[slot] === edge.twin) continue
      // Negated length, so `timeAlong` reads a vehicle this far along the arm as
      // exactly that far past the point.
      add(arms[slot], -1, -arm.length)
    }
  }
  departures(edgeIndex, distance)
  if (twin >= 0) departures(twin, graph.edges[twin].length - distance)

  for (let head = 0; head < queue.length && found.length < APPROACH_CAP; head += 1) {
    const step = queue[head]
    if (step.offset >= APPROACH_REACH) continue
    const arms = graph.nodes[step.node].out
    const reverse = graph.edges[step.via].twin
    for (let slot = 0; slot < arms.length && found.length < APPROACH_CAP; slot += 1) {
      const incoming = graph.edges[arms[slot]].twin
      if (incoming < 0) continue
      // Entering `via` from its own twin is a U-turn, which the turn chooser
      // does not make.
      if (incoming === reverse) continue
      const arm = graph.edges[incoming]
      if (arm.kind !== kind) continue
      if (!add(incoming, step.via, step.offset)) continue
      queue.push({ node: arm.from, via: incoming, offset: step.offset + arm.length })
    }
  }
  return found
}

/**
 * Whether a pair of pavement ends is a crossing, a corner, or nothing.
 *
 * Pairing ends by proximity is the right way to discover crossings — it needs
 * no declaration, so it cannot drift from the art — but proximity on its own
 * has no opinion about the road, and that is exactly what the two ends are
 * separated by. Three answers:
 *
 *   `crossing`  cuts one or more carriageways, each roughly square on, or joins
 *               the two kerbs of one street. The walker waits and gives way.
 *   `kerbside`  cuts nothing and is short: the inside corner where the pavement
 *               along one street meets the pavement up the next. Walked
 *               straight through, because there is no road under it.
 *   `null`      shares a lane with the traffic, meets one at a shallow angle,
 *               or spans open ground with no carriageway to explain it —
 *               which, between two pavements of two different streets, is a
 *               route through whatever is between them.
 */
function linkVerdict(
  graph: RoadGraph | undefined,
  ax: number, az: number, bx: number, bz: number, gap: number,
  sameStreet: boolean,
): 'crossing' | 'kerbside' | null {
  const roads = graph?.edgesByKind.road
  if (!graph || !roads || !roads.length) {
    // Nothing to judge against: a quay, a network of park paths. Every pair in
    // range is a legitimate link, which is what it was before any of this.
    return gap < CORNER_JOIN ? 'kerbside' : 'crossing'
  }
  let widest = 0
  const corner = gap < CORNER_JOIN
  const dirX = gap > 1e-4 ? (bx - ax) / gap : 1
  const dirZ = gap > 1e-4 ? (bz - az) / gap : 0
  const midX = (ax + bx) / 2
  const midZ = (az + bz) / 2
  const minX = Math.min(ax, bx)
  const maxX = Math.max(ax, bx)
  const minZ = Math.min(az, bz)
  const maxZ = Math.max(az, bz)
  let crosses = 0
  for (let index = 0; index < roads.length; index += 1) {
    const edgeIndex = roads[index]
    const edge = graph.edges[edgeIndex]
    if (edge.twin >= 0 && edge.twin < edgeIndex) continue
    const from = graph.nodes[edge.from]
    const to = graph.nodes[edge.to]
    const reach = edge.width / 2 + IN_LANE_MARGIN
    if (Math.min(from.x, to.x) > maxX + reach) continue
    if (Math.max(from.x, to.x) < minX - reach) continue
    if (Math.min(from.z, to.z) > maxZ + reach) continue
    if (Math.max(from.z, to.z) < minZ - reach) continue
    const parallel = Math.abs(dirX * edge.dx + dirZ * edge.dz)
    if (segmentCross(ax, az, bx, bz, from.x, from.z, to.x, to.z)) {
      if (parallel > CROSS_SQUARENESS) return null
      crosses += 1
      widest = Math.max(widest, edge.width)
      continue
    }
    // A corner's direction is noise over a few centimetres, so it is tested for
    // standing in a lane whichever way it happens to point.
    if (!corner && parallel < IN_LANE_PARALLEL) continue
    const along = (midX - from.x) * edge.dx + (midZ - from.z) * edge.dz
    if (along < -.2 || along > edge.length + .2) continue
    if (Math.abs((midX - from.x) * edge.dz - (midZ - from.z) * edge.dx) <= reach) return null
  }
  if (crosses) {
    // A crossing is only ever about as long as the road under it. Without this,
    // any two corners inside the pairing radius that happen to have a street
    // between them become a link, and on a grid whose streets are two metres
    // apart that is a lattice of shortcuts diagonally over the blocks — walkers
    // strolling through terraces because the geometry allowed it.
    return gap <= widest + 2 * KERB_SETBACK + CROSS_SLACK ? 'crossing' : null
  }
  if (corner) return 'kerbside'
  // Nothing under it, but the two ends are opposite kerbs of one street: the Old
  // Quarter's high street is drawn in full — kerbs, markings, parked cars — and
  // never contributed to the driving network, and refusing to let anyone cross
  // it would cut the busiest pavement in the region in half. Guarded by
  // `sameStreet` being square-on, which the caller checks against the pavements'
  // own directions: two points on the same street are otherwise "opposite
  // kerbs" however far apart along it they are.
  if (sameStreet) return 'crossing'
  return null
}

/**
 * Room a pedestrian link keeps from a solid footprint.
 *
 * Smaller than `SOLID_CLEARANCE`, and for a different question. The cut asks
 * "can a walker travel *along* here comfortably", which wants a shoulder's
 * room; this asks "does this link go *through* the thing", which only wants the
 * body. Using the walking clearance here would refuse the perfectly ordinary
 * crossing that starts a pace away from a corner shop.
 */
const LINK_SOLID_MARGIN = .12

/**
 * Does a straight pedestrian link pass through something solid?
 *
 * Asked of every crossing, every corner turn and every repair link. Two ends
 * left facing each other by a cut are the case it exists for, but it is not
 * limited to them on purpose: a link that shortcuts through a farmstead is
 * wrong however it came to be proposed, and the pairing rules — which reason
 * about carriageways, because that is what a crossing crosses — have no other
 * way of knowing there is a building in the way.
 */
function linkThroughSolid(solids: SolidFootprint[], ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz)
  for (let index = 0; index < solids.length; index += 1) {
    const solid = solids[index]
    const reach = solid.radius + LINK_SOLID_MARGIN
    if (solid.x < Math.min(ax, bx) - reach || solid.x > Math.max(ax, bx) + reach) continue
    if (solid.z < Math.min(az, bz) - reach || solid.z > Math.max(az, bz) + reach) continue
    if (solid.hx === undefined || solid.hz === undefined) {
      const span = length * length
      const t = span > 1e-8 ? Math.max(0, Math.min(1, ((solid.x - ax) * dx + (solid.z - az) * dz) / span)) : 0
      if (Math.hypot(solid.x - ax - dx * t, solid.z - az - dz * t) < reach) return true
      continue
    }
    // Walked rather than clipped. The nearest point of a segment to a rectangle
    // has no one-liner, and the cheap substitute — the nearest point to the
    // rectangle's *centre* — is exactly the mistake that lets a link graze a
    // building's corner and be called clear.
    const steps = Math.max(2, Math.ceil(length / SOLID_STEP))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      if (solidDistance(solid, ax + dx * t, az + dz * t) < LINK_SOLID_MARGIN) return true
    }
  }
  return false
}

/**
 * Does this link share ground with the traffic — lying in a lane, or meeting one
 * at too shallow an angle to be a crossing? This is the half of `linkVerdict`
 * that is about safety rather than about urbanism, and it is the only half the
 * connectivity repair below is allowed to relax.
 */
function sharesALane(
  graph: RoadGraph | undefined,
  ax: number, az: number, bx: number, bz: number, gap: number,
): boolean {
  const roads = graph?.edgesByKind.road
  if (!graph || !roads || !roads.length) return false
  const dirX = gap > 1e-4 ? (bx - ax) / gap : 1
  const dirZ = gap > 1e-4 ? (bz - az) / gap : 0
  for (let index = 0; index < roads.length; index += 1) {
    const edgeIndex = roads[index]
    const edge = graph.edges[edgeIndex]
    if (edge.twin >= 0 && edge.twin < edgeIndex) continue
    const from = graph.nodes[edge.from]
    const to = graph.nodes[edge.to]
    const reach = edge.width / 2 + IN_LANE_MARGIN
    if (Math.min(from.x, to.x) > Math.max(ax, bx) + reach) continue
    if (Math.max(from.x, to.x) < Math.min(ax, bx) - reach) continue
    if (Math.min(from.z, to.z) > Math.max(az, bz) + reach) continue
    if (Math.max(from.z, to.z) < Math.min(az, bz) - reach) continue
    const parallel = Math.abs(dirX * edge.dx + dirZ * edge.dz)
    if (segmentCross(ax, az, bx, bz, from.x, from.z, to.x, to.z)) {
      if (parallel > CROSS_SQUARENESS) return true
      continue
    }
    if (parallel < IN_LANE_PARALLEL) continue
    // Sampled along the link rather than at its midpoint only: a repair link is
    // allowed to be long, and a long one can lie in a lane over part of its run
    // while its middle is clear.
    const steps = Math.max(2, Math.ceil(gap / .5))
    for (let step = 0; step <= steps; step += 1) {
      const px = ax + (bx - ax) * (step / steps)
      const pz = az + (bz - az) * (step / steps)
      const along = (px - from.x) * edge.dx + (pz - from.z) * edge.dz
      if (along < -.2 || along > edge.length + .2) continue
      if (Math.abs((px - from.x) * edge.dz - (pz - from.z) * edge.dx) <= reach) return true
    }
  }
  return false
}

export class Crowd {
  private readonly ways: Footway[] = []
  private readonly crossings: Crossing[] = []
  /** Conflicts per crossing, parallel to `crossings`. Empty where none. */
  private readonly conflicts: CrossingConflict[][] = []
  private readonly traffic: TrafficSim[] = []
  private readonly walkers: Walker[] = []
  private readonly instanced?: { mesh: THREE.InstancedMesh; count: number }
  private readonly animateWithin: number
  private readonly halfWidth: number
  private readonly lift: number
  private readonly fade: number
  private readonly fogDistance: number
  private readonly cullRadius: number
  private readonly targetAlive: number
  private readonly reduced: boolean
  /** Per-way intrusive occupant list, mirroring the traffic sim's edge buckets. */
  private readonly wayHead: Int32Array
  private readonly walkerNext: Int32Array
  /**
   * Crossing indices reachable from each pavement end, keyed `way * 2 + end`.
   * Built once because a district cut properly at its junctions has hundreds of
   * links and a walker reaches an end every few seconds.
   */
  private readonly crossingsByEnd: number[][] = []
  /**
   * Running total of `weight` over `ways`, for choosing where a walker appears.
   * Uniform choice over the list would put as many people on a six-metre stub of
   * back lane as on the high street, and cutting the pavements at junctions
   * turned twenty-seven ways into several hundred.
   */
  private readonly spawnCumulative: Float32Array
  /** How many conflicts came from a link lying *along* a lane. See `networkReport`. */
  private inLaneConflicts = 0
  /** How many came from a link running *into* one and stopping. Same place. */
  private intoLaneConflicts = 0
  /** How many links the connectivity repair had to add. See `stitch`. */
  private stitched = 0
  /** How many candidate links were refused for running through something solid. */
  private solidRefusals = 0
  /** Scratch for `sample`: written by every call, read immediately. */
  private sampleX = 0
  private sampleZ = 0
  private sampleDx = 0
  private sampleDz = 0
  private spawnCursor = 0
  private elapsed = 0

  constructor(options: CrowdOptions) {
    const defaultHalfWidth = (options.width ?? 1.5) * .5
    for (const way of options.ways) {
      const built = buildFootway(way.points, way.closed ?? false, way.halfWidth ?? defaultHalfWidth, way.weight ?? 1, way.street ?? -1, way.centre ?? 0, way.obstructed ?? false)
      if (built) this.ways.push(built)
    }
    this.instanced = options.instanced
    this.animateWithin = options.animateWithin ?? 34
    this.halfWidth = defaultHalfWidth
    this.lift = options.lift ?? .12
    this.fade = Math.max(.05, options.fade ?? 1.2)
    this.fogDistance = options.fogDistance ?? 58
    this.cullRadius = options.cullRadius ?? 120
    this.wayHead = new Int32Array(Math.max(1, this.ways.length))
    this.walkerNext = new Int32Array(Math.max(1, options.rigs.length))

    // Furniture, projected onto each pavement it stands on or beside. Doing
    // this once, in the footway's own along/across frame, is what makes the
    // per-frame avoidance a couple of comparisons rather than a distance test
    // against every prop in the district.
    for (const obstacle of options.obstacles ?? []) {
      for (const way of this.ways) {
        const hit = projectOntoWay(way, obstacle.x, obstacle.z)
        if (hit.distance > Math.abs(way.centre) + way.halfWidth + 1.4 + obstacle.radius) continue
        way.obstacles.push({ s: hit.s, d: hit.d, radius: obstacle.radius })
      }
    }
    for (const way of this.ways) way.obstacles.sort((a, b) => a.s - b.s)
    // Before the crossings, because the conflict resolution below only runs
    // where there is traffic for a walker to give way to.
    if (options.traffic?.length) this.traffic.push(...options.traffic)

    // Crossings. Two open footways whose ends nearly meet are the two kerbs of
    // one junction: walkers reaching such an end wait, look, and step across
    // rather than simply evaporating at the corner, which is what made the
    // pavements read as separate treadmills with no connection between them.
    //
    // Proximity alone is not enough to say that two ends face each other across
    // a street, and it used to be all that was asked. Ends cluster wherever
    // pavements stop, so the pairing also produced diagonals over junctions and
    // — where pavements ran the length of a district and could only stop at its
    // edge — links strung end to end down the perimeter road. Every candidate is
    // therefore put to the road network before it is accepted: it has to cut a
    // carriageway roughly square, or cut nothing and be short enough to be a
    // corner. See `linkVerdict`.
    const range = options.crossingRange ?? 3
    const graph = options.roadGraph
    const solids = options.solids ?? []
    for (let index = 0; index < this.ways.length * 2; index += 1) this.crossingsByEnd.push([])
    // Corners first: every pavement end within `CORNER_WELD` of another is the
    // same place on the ground, and the walkers standing there have the same
    // choices whichever pavement brought them.
    const corners: Array<{ x: number; z: number; ends: number[] }> = []
    if (range > 0) {
      const weldCell = Math.max(CORNER_WELD, .1)
      const weldBuckets = new Map<string, number[]>()
      const weldKey = (x: number, z: number) => `${Math.floor(x / weldCell)},${Math.floor(z / weldCell)}`
      const attach = (x: number, z: number, code: number) => {
        const cellX = Math.floor(x / weldCell)
        const cellZ = Math.floor(z / weldCell)
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
            for (const index of weldBuckets.get(`${cellX + offsetX},${cellZ + offsetZ}`) ?? []) {
              const corner = corners[index]
              if (Math.hypot(corner.x - x, corner.z - z) > CORNER_WELD) continue
              corner.ends.push(code)
              return
            }
          }
        }
        const created = corners.length
        corners.push({ x, z, ends: [code] })
        const key = weldKey(x, z)
        const bucket = weldBuckets.get(key)
        if (bucket) bucket.push(created)
        else weldBuckets.set(key, [created])
      }
      // Which way the pavement points as it arrives at its end, per end code.
      // Used to tell "the far kerb of this street" from "somewhere else on the
      // same street": both share a street id, and only one is a crossing.
      const endDirX = new Float32Array(this.ways.length * 2)
      const endDirZ = new Float32Array(this.ways.length * 2)
      this.ways.forEach((way, index) => {
        if (way.closed) return
        const last = way.cumulative.length - 1
        const tangent = (from: number, to: number, code: number) => {
          const dx = way.points[to * 2] - way.points[from * 2]
          const dz = way.points[to * 2 + 1] - way.points[from * 2 + 1]
          const magnitude = Math.hypot(dx, dz) || 1
          endDirX[code] = dx / magnitude
          endDirZ[code] = dz / magnitude
        }
        tangent(0, 1, index * 2)
        tangent(last, last - 1, index * 2 + 1)
        attach(way.points[0], way.points[1], index * 2)
        attach(way.points[last * 2], way.points[last * 2 + 1], index * 2 + 1)
      })

      // Turning a corner: from any pavement at this corner onto any other. No
      // carriageway is involved, so it is not a crossing and is not timed like
      // one — see the end-of-pavement handler, which steps straight across.
      for (const corner of corners) {
        if (corner.ends.length < 2) continue
        for (const code of corner.ends) {
          const others = corner.ends.filter((other) => (other >> 1) !== (code >> 1))
          if (!others.length) continue
          this.crossingsByEnd[code].push(this.crossings.length)
          this.crossings.push({ toEnds: others, fromX: corner.x, fromZ: corner.z, toX: corner.x, toZ: corner.z, length: 0, kerbside: true })
          this.conflicts.push([])
        }
      }

      // Then the crossings between corners. Proximity alone is not enough to
      // say two corners face each other over a street, and it used to be all
      // that was asked: ends cluster wherever pavements stop, so the pairing
      // also produced diagonals over junctions and — where pavements ran the
      // length of a district and could only stop at its edge — links strung end
      // to end down the perimeter road. Every candidate is put to the road
      // network before it is accepted. See `linkVerdict`.
      const cell = Math.max(range, .5)
      const buckets = new Map<string, number[]>()
      corners.forEach((corner, index) => {
        const key = `${Math.floor(corner.x / cell)},${Math.floor(corner.z / cell)}`
        const bucket = buckets.get(key)
        if (bucket) bucket.push(index)
        else buckets.set(key, [index])
      })
      /**
       * Are these two corners the two kerbs of one street, at the same point
       * along it? Both have to carry a pavement of the same street, and both of
       * those pavements have to run square to the link — which is what a kerb
       * opposite a kerb looks like, and what two corners a block apart on the
       * same street does not.
       */
      const facingKerbs = (
        a: { ends: number[] }, b: { ends: number[] }, dirX: number, dirZ: number,
      ) => {
        const square = (corner: { ends: number[] }, street: number) => corner.ends.some((code) => (
          this.ways[code >> 1].street === street
          && Math.abs(endDirX[code] * dirX + endDirZ[code] * dirZ) <= CROSS_SQUARENESS
        ))
        for (const code of a.ends) {
          const street = this.ways[code >> 1].street
          if (street < 0) continue
          if (square(a, street) && square(b, street)) return true
        }
        return false
      }
      for (let a = 0; a < corners.length; a += 1) {
        const cellX = Math.floor(corners[a].x / cell)
        const cellZ = Math.floor(corners[a].z / cell)
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
            for (const b of buckets.get(`${cellX + offsetX},${cellZ + offsetZ}`) ?? []) {
              // Each unordered pair once; both directed links come from it.
              if (b <= a) continue
              const gap = Math.hypot(corners[a].x - corners[b].x, corners[a].z - corners[b].z)
              if (gap < CORNER_WELD || gap > range) continue
              const sameStreet = gap <= SAME_STREET_RANGE && facingKerbs(
                corners[a], corners[b],
                (corners[b].x - corners[a].x) / gap, (corners[b].z - corners[a].z) / gap,
              )
              const verdict = linkVerdict(graph, corners[a].x, corners[a].z, corners[b].x, corners[b].z, gap, sameStreet)
              if (!verdict) continue
              // The cut's own failure mode, closed here rather than by tagging
              // the ends the cut made: two ends left facing each other across a
              // farmstead are exactly what `linkVerdict` calls a kerbside
              // corner — short, and with no carriageway under it — and relinking
              // them puts the walker back through the building. Asked of every
              // pair, not only of cut ends, because a pavement that was always
              // this shape has the same problem.
              if (linkThroughSolid(solids, corners[a].x, corners[a].z, corners[b].x, corners[b].z)) {
                this.solidRefusals += 1
                continue
              }
              // Asked of corner turns too, not just of crossings. A corner is
              // short and has no carriageway across it, which is why it is
              // walked straight through — but "no carriageway across it" is not
              // "no carriageway near it", and a corner cut at the mouth of a
              // side street can still sit inside a lane. Those came back from
              // the audit as links a walker would step onto without looking.
              const conflicts = this.resolveConflicts(graph, corners[a], corners[b], gap)
              const kerbside = verdict === 'kerbside' && !conflicts.length
              for (const code of corners[a].ends) this.crossingsByEnd[code].push(this.crossings.length)
              this.crossings.push({ toEnds: corners[b].ends, fromX: corners[a].x, fromZ: corners[a].z, toX: corners[b].x, toZ: corners[b].z, length: gap, kerbside })
              this.conflicts.push(conflicts)
              for (const code of corners[b].ends) this.crossingsByEnd[code].push(this.crossings.length)
              this.crossings.push({ toEnds: corners[a].ends, fromX: corners[b].x, fromZ: corners[b].z, toX: corners[a].x, toZ: corners[a].z, length: gap, kerbside })
              // The same points from the other side: the same carriageways at
              // the same places, measured from the other end of the link.
              this.conflicts.push(conflicts.map((conflict) => ({ ...conflict, at: 1 - conflict.at })))
            }
          }
        }
      }
      this.stitch(corners, graph, solids)
    }

    /**
     * Nobody starts the day standing in a barn.
     *
     * A pavement the cut found no clear ground on keeps its place in the graph
     * and its links, so the district stays as reachable as it was, but it stops
     * being somewhere a walker can appear. The reduced weight the cut already
     * gives such a way is the right answer for a pavement that is merely
     * pinched; it is not enough for one that is wholly inside a building, and
     * The Circuit is the case that shows the difference — its nine walkers were
     * spending whole runs shuttling between three ways inside one landmark.
     *
     * Guarded, because a district where every pavement is obstructed still has
     * to put its people somewhere, and a crowd that cannot spawn is a worse
     * artefact than one standing in a wall.
     */
    let cumulative = 0
    const anyClear = this.ways.some((way) => !way.obstructed)
    this.spawnCumulative = new Float32Array(Math.max(1, this.ways.length))
    for (let index = 0; index < this.ways.length; index += 1) {
      const way = this.ways[index]
      cumulative += anyClear && way.obstructed ? 0 : way.weight
      this.spawnCumulative[index] = cumulative
    }
    this.reduced = prefersReducedMotion()

    for (const entry of options.rigs) {
      entry.root.visible = false
      const seed = entry.seed
      const height = .93 + hashUnit(seed * 1.31) * .16
      // Height variation is applied as root scale rather than by rebuilding the
      // rig: the rig's joint offsets are tuned, and scaling the root preserves
      // those proportions for nothing. The caller has already scaled the root to
      // architectural size, so the fade ramps towards that figure, not towards 1.
      const baseScale = (entry.root.scale.x || 1) * height
      entry.root.scale.setScalar(baseScale)
      // Bind after scale is final: the skeleton measures limb lengths from the
      // bind pose in world space.
      entry.root.updateWorldMatrix(true, true)
      const humanoid = new HumanoidActor(entry.rig, {
        seed,
        state: 'walk',
        reduced: this.reduced,
      })
      this.walkers.push({
        root: entry.root,
        rig: entry.rig,
        humanoid,
        seed,
        baseScale,
        active: false,
        way: 0,
        distance: 0,
        direction: 1,
        lateral: 0,
        targetLateral: 0,
        // Pace is drawn per walker from its own seed and spans a genuinely
        // wide range: a pavement where everyone moves at .8 reads as a
        // conveyor no matter how good the gait is. The clip rate is driven
        // from measured ground speed further down, so a slow walker really
        // does take slower steps rather than sliding.
        speed: (.44 + hashUnit(seed * 2.17) * .72) * height,
        cruise: (.44 + hashUnit(seed * 2.17) * .72) * height,
        errand: 'walk',
        errandTimer: 2 + hashUnit(seed * 5.09) * 9,
        pace: 1,
        companion: -1,
        crossing: -1,
        crossPhase: 'wait',
        crossTimer: 0,
        crossProgress: 0,
        crossHeld: 0,
        crossGlance: 0,
        heading: 0,
        ramp: 0,
        phase: 'idle',
        life: 0,
        walking: true,
        previousWorld: new THREE.Vector3(),
      })
    }
    this.targetAlive = Math.max(0, Math.round(this.walkers.length * (options.occupancy ?? .8)))
  }

  /**
   * Position and tangent at an arc length along a footway, into the sample
   * scratch fields. A binary search rather than a cached segment cursor: it is
   * O(log n) on a polyline of a dozen points, it allocates nothing, and unlike
   * a cursor it stays correct when a walker is re-seeded to an arbitrary point.
   */
  private sample(way: Footway, distance: number) {
    const cumulative = way.cumulative
    let low = 0
    let high = cumulative.length - 1
    while (low < high - 1) {
      const middle = (low + high) >> 1
      if (cumulative[middle] <= distance) low = middle
      else high = middle
    }
    const span = cumulative[high] - cumulative[low]
    const local = span > 1e-5 ? (distance - cumulative[low]) / span : 0
    const ax = way.points[low * 2]
    const az = way.points[low * 2 + 1]
    const bx = way.points[high * 2]
    const bz = way.points[high * 2 + 1]
    this.sampleX = ax + (bx - ax) * local
    this.sampleZ = az + (bz - az) * local
    const dx = bx - ax
    const dz = bz - az
    const magnitude = Math.hypot(dx, dz) || 1
    this.sampleDx = dx / magnitude
    this.sampleDz = dz / magnitude
  }

  /**
   * The last sample, `across` metres to the side of it, into the target scratch.
   *
   * There is one across-frame in this file and it is the one `sampleWay` and
   * `projectOntoWay` measure in: the normal `(dz, -dx)`. Everything a footway
   * hands the crowd is stated in it — `Footway.centre`, an obstacle's `d` — so
   * the step from an offset to a place on the ground has to use it too.
   *
   * It used to use the opposite normal, and mirrored both of those. A bench sat
   * on a walker's left was avoided by stepping right into it, and, since
   * `cutFootwaysAroundSolids` began moving a band off the buildings standing on
   * it, a band shifted a foot clear of a wall put people a foot inside it
   * instead. That second one is why the villages, whose bands move furthest
   * because their lanes are narrow and their barns sit hard against them, had
   * four pavements running through a building and a fifth of all frames with
   * somebody inside one.
   */
  private placeAcross(across: number) {
    scratchTarget.set(
      this.sampleX + this.sampleDz * across,
      this.lift,
      this.sampleZ - this.sampleDx * across,
    )
  }

  /**
   * A crossing leaving this kerb, or -1. Not everyone crosses: some proportion
   * of arrivals at any corner have simply got where they were going, and a
   * junction where every single pedestrian steps into the road looks as
   * mechanical as one where none of them do.
   */
  private pickCrossing(walker: Walker, end: 0 | 1) {
    const bucket = this.crossingsByEnd[walker.way * 2 + end]
    if (!bucket || !bucket.length) return -1
    let chosen = -1
    let seen = 0
    for (let count = 1; count <= bucket.length; count += 1) {
      const link = bucket[count - 1]
      // Weighted reservoir pick, so a corner with three kerbs off it does not
      // send everyone to the same one, and so the one that leads into a
      // building is the one nobody takes. A link is only ever discouraged, not
      // refused: it may be the sole way off the pavement the walker is on, and
      // it is certainly the way *out* of one that is obstructed.
      const weight = this.crossings[link].toEnds.some((code) => !this.ways[code >> 1].obstructed)
        ? 1
        : OBSTRUCTED_TURN
      seen += weight
      if (chosen < 0 || hashUnit(walker.seed * 17.3 + this.elapsed + count) < weight / seen) chosen = link
    }
    // Not everyone carries on. Some proportion of arrivals at any corner have
    // simply got where they were going, and a junction where every single
    // pedestrian steps into the road looks as mechanical as one where none of
    // them do. Rolled against the link that came up rather than before it,
    // because turning a corner onto the next pavement is not the same decision
    // as stepping into a road, and pavements cut at their junctions put a walker
    // at one end or the other every few seconds.
    const stop = this.crossings[chosen].kerbside ? .03 : .12
    return hashUnit(walker.seed * 13.1 + this.elapsed) < stop ? -1 : chosen
  }

  /**
   * Join up whatever the crossing rules left stranded.
   *
   * The rules above are deliberately strict, and strictness costs reach: a
   * pavement that only ever met the rest of the network through a link that ran
   * down a lane is an island once that link is refused. An island is worse than
   * an ugly link — walkers spawn on it and can never leave — so rather than
   * loosening the rules everywhere to keep a few places attached, connectivity
   * is repaired afterwards, deliberately and only where it is missing.
   *
   * Repeatedly: take the shortest link between two corners that are not yet
   * connected, refuse it if it would put walkers in a lane, and accept it
   * otherwise. Stop when nothing is left within `STITCH_RANGE` — quays across a
   * harbour are genuinely separate places and pretending otherwise would have
   * people walking on water.
   */
  private stitch(corners: Array<{ x: number; z: number; ends: number[] }>, graph: RoadGraph | undefined, solids: SolidFootprint[]) {
    const parent = new Int32Array(this.ways.length)
    for (let index = 0; index < parent.length; index += 1) parent[index] = index
    const find = (index: number): number => {
      let root = index
      while (parent[root] !== root) root = parent[root]
      while (parent[index] !== root) {
        const next = parent[index]
        parent[index] = root
        index = next
      }
      return root
    }
    const union = (a: number, b: number) => {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) parent[rootB] = rootA
    }
    // Seed from the links that were accepted. A link reached from end `code`
    // lands on the ends listed in its `toEnds`, so those pavements are mutually
    // reachable.
    this.crossingsByEnd.forEach((bucket, code) => {
      for (const index of bucket) {
        for (const far of this.crossings[index].toEnds) union(code >> 1, far >> 1)
      }
    })
    // Corners bind their own pavements together whether or not a link was made.
    for (const corner of corners) {
      for (let index = 1; index < corner.ends.length; index += 1) {
        union(corner.ends[0] >> 1, corner.ends[index] >> 1)
      }
    }

    for (let attempt = 0; attempt < MAX_STITCHES; attempt += 1) {
      let bestGap = STITCH_RANGE
      let bestA = -1
      let bestB = -1
      for (let a = 0; a < corners.length; a += 1) {
        const rootA = find(corners[a].ends[0] >> 1)
        for (let b = a + 1; b < corners.length; b += 1) {
          if (find(corners[b].ends[0] >> 1) === rootA) continue
          const gap = Math.hypot(corners[a].x - corners[b].x, corners[a].z - corners[b].z)
          if (gap >= bestGap) continue
          if (sharesALane(graph, corners[a].x, corners[a].z, corners[b].x, corners[b].z, gap)) continue
          // A repair link is long by nature and is chosen for reach, so left
          // alone it is the likeliest link in the whole network to be a route
          // through a building. An island is better than that.
          if (linkThroughSolid(solids, corners[a].x, corners[a].z, corners[b].x, corners[b].z)) continue
          bestGap = gap
          bestA = a
          bestB = b
        }
      }
      if (bestA < 0) break
      const a = corners[bestA]
      const b = corners[bestB]
      // Timed like any other crossing if it cuts a carriageway, walked straight
      // through if it does not. A repair link is long by nature, so it is never
      // treated as a corner turn.
      const conflicts = this.resolveConflicts(graph, a, b, bestGap)
      const kerbside = !conflicts.length
      this.stitched += 1
      for (const code of a.ends) this.crossingsByEnd[code].push(this.crossings.length)
      this.crossings.push({ toEnds: b.ends, fromX: a.x, fromZ: a.z, toX: b.x, toZ: b.z, length: bestGap, kerbside })
      this.conflicts.push(conflicts)
      for (const code of b.ends) this.crossingsByEnd[code].push(this.crossings.length)
      this.crossings.push({ toEnds: a.ends, fromX: b.x, fromZ: b.z, toX: a.x, toZ: a.z, length: bestGap, kerbside })
      this.conflicts.push(conflicts.map((conflict) => ({ ...conflict, at: 1 - conflict.at })))
      union(a.ends[0] >> 1, b.ends[0] >> 1)
    }
  }

  /**
   * Which carriageways one crossing puts a walker into.
   *
   * The question is "does this link put a body on that road surface", and it
   * has one answer with two ways of finding it. The link may *cut* the
   * carriageway, in which case the conflict sits at the intersection and is
   * found exactly. Or it may occupy the carriageway without ever reaching its
   * centreline, in which case there is no intersection to find and the link is
   * walked instead, with the conflict recorded at the sample nearest its
   * midpoint.
   *
   * The second used to be tested only for links within forty-five degrees of
   * parallel with the lane, and that gate is the bug this note records. It came
   * from the shape the branch was written for — a pavement running uncut down a
   * lane, which in the Old Quarter was 56 of 80 crossings before the pavements
   * were cut at their junctions — and it silently excluded the opposite shape:
   * a link that runs *square* at a road and stops inside it, because the
   * pavement it is heading for begins between the kerbs. That link crosses no
   * centreline and lies parallel to nothing, so it got an empty conflict list,
   * was marked `kerbside` for having no carriageway under it, and was then
   * walked straight out into the traffic against a 3% refusal instead of the
   * 12% and the gap check a crossing gets. Measured on the Sovereign Arc, which
   * is the region whose pavements begin inside carriageways: 22 links, against
   * none in the Old Quarter and none on The Circuit.
   *
   * Angle is now not consulted at all, which is the honest form of the test: a
   * walker standing in a lane is in the lane whichever way it is facing.
   * `networkReport()` reports the two shapes separately as `inLaneConflicts`
   * and `intoLaneConflicts`, because they say different things about the
   * network that produced them.
   *
   * Nothing here is declared. The footways and the road network were both
   * contributed by the scene as it drew the streets, so anything tying them
   * together by hand would drift from the art the first time a street moved. A
   * link that turns out to touch nothing — a path over a green, the two ends of
   * a quay — gets an empty list and keeps the plain timer behaviour, which is
   * the correct answer for it. Run once, at build time.
   */
  private resolveConflicts(
    graph: RoadGraph | undefined,
    a: { x: number; z: number },
    b: { x: number; z: number },
    length: number,
  ): CrossingConflict[] {
    const found: CrossingConflict[] = []
    if (!graph || !this.traffic.length || length < 1e-4) return found
    const dirX = (b.x - a.x) / length
    const dirZ = (b.z - a.z) / length
    const roads = graph.edgesByKind.road
    for (let index = 0; index < roads.length; index += 1) {
      const edgeIndex = roads[index]
      const edge = graph.edges[edgeIndex]
      // One of each two-way pair. `markPedestrian` handles the twin itself and
      // `buildApproaches` seeds both, so recording both here would double every
      // lookup for nothing.
      if (edge.twin >= 0 && edge.twin < edgeIndex) continue
      const from = graph.nodes[edge.from]
      const to = graph.nodes[edge.to]
      const reach = edge.width / 2 + IN_LANE_MARGIN
      // Cheap reject before the geometry: most of the network is nowhere near
      // any given kerb. The margin covers the lane-sharing test below, which
      // looks slightly wider than the link's own bounding box.
      if (Math.min(from.x, to.x) > Math.max(a.x, b.x) + reach) continue
      if (Math.max(from.x, to.x) < Math.min(a.x, b.x) - reach) continue
      if (Math.min(from.z, to.z) > Math.max(a.z, b.z) + reach) continue
      if (Math.max(from.z, to.z) < Math.min(a.z, b.z) - reach) continue
      const hit = segmentCross(a.x, a.z, b.x, b.z, from.x, from.z, to.x, to.z)
      if (hit) {
        const distance = hit.u * edge.length
        found.push({ edge: edgeIndex, distance, at: hit.t, approaches: buildApproaches(graph, edgeIndex, distance) })
        continue
      }
      // Sampled at a fixed spacing on the ground rather than at five points on
      // the link, so a long repair link cannot step over a lane between two
      // samples.
      const steps = Math.max(4, Math.ceil(length / .2))
      let inLaneAt = -1
      let inLaneAlong = 0
      for (let sample = 0; sample <= steps; sample += 1) {
        const t = sample / steps
        const px = a.x + (b.x - a.x) * t
        const pz = a.z + (b.z - a.z) * t
        const along = (px - from.x) * edge.dx + (pz - from.z) * edge.dz
        if (along < -.2 || along > edge.length + .2) continue
        if (Math.abs((px - from.x) * edge.dz - (pz - from.z) * edge.dx) > reach) continue
        // The midpoint if it qualifies, since that is where the walker is most
        // exposed and where `claimRoadway` centres its window; otherwise the
        // sample nearest to it. Not the *deepest* sample, which reads better
        // and measures worse: `claimRoadway` holds the traffic only within a
        // window either side of this point, so moving it towards the end of a
        // four-metre link stops the walker claiming the lane it is actually
        // standing in halfway across.
        if (inLaneAt < 0 || Math.abs(t - .5) < Math.abs(inLaneAt - .5)) {
          inLaneAt = t
          inLaneAlong = along
        }
      }
      if (inLaneAt < 0) continue
      if (Math.abs(dirX * edge.dx + dirZ * edge.dz) >= IN_LANE_PARALLEL) this.inLaneConflicts += 1
      else this.intoLaneConflicts += 1
      const distance = THREE.MathUtils.clamp(inLaneAlong, 0, edge.length)
      found.push({ edge: edgeIndex, distance, at: inLaneAt, approaches: buildApproaches(graph, edgeIndex, distance) })
    }
    return found
  }

  /**
   * Set a walker down on the far side of a link. Which pavement, of however
   * many meet at that corner, is drawn here rather than baked into the link:
   * one link serves every pavement at each of its two corners, and a crossing
   * that always deposited people on the same one would turn every junction into
   * a funnel.
   */
  private land(walker: Walker, link: number) {
    const ends = this.crossings[link].toEnds
    const code = ends[Math.floor(hashUnit(walker.seed * 23.9 + this.elapsed) * ends.length) % ends.length]
    const target = this.ways[code >> 1]
    walker.way = code >> 1
    walker.distance = (code & 1) === 0 ? 0 : target.length
    walker.direction = (code & 1) === 0 ? 1 : -1
    walker.lateral = 0
    walker.targetLateral = (hashUnit(walker.seed * 19.7 + this.elapsed) * 2 - 1) * target.halfWidth
    walker.crossing = -1
    walker.crossPhase = 'wait'
    walker.crossHeld = 0
    walker.companion = -1
  }

  /** Index of the pavement a new walker appears on, by length and class weight. */
  private pickWay(unit: number) {
    const total = this.spawnCumulative[this.spawnCumulative.length - 1]
    if (!(total > 0)) return 0
    const target = unit * total
    let low = 0
    let high = this.spawnCumulative.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.spawnCumulative[middle] < target) low = middle + 1
      else high = middle
    }
    return low
  }

  /**
   * The shape of the pedestrian network, for a headless harness. None of this
   * is read by `update`; it exists so that "pavements run beside the roads and
   * everywhere stays reachable" can be a measurement rather than a claim.
   */
  networkReport() {
    // Union-find over pavements, joined by every link a walker can take.
    const parent = this.ways.map((_, index) => index)
    const find = (index: number): number => {
      let root = index
      while (parent[root] !== root) root = parent[root]
      while (parent[index] !== root) { const next = parent[index]; parent[index] = root; index = next }
      return root
    }
    this.crossingsByEnd.forEach((bucket, code) => {
      for (const index of bucket) {
        for (const target of this.crossings[index].toEnds) {
          const a = find(code >> 1)
          const b = find(target >> 1)
          if (a !== b) parent[a] = b
        }
      }
    })
    const sizes = new Map<number, number>()
    const lengths = new Map<number, number>()
    let total = 0
    this.ways.forEach((way, index) => {
      const root = find(index)
      sizes.set(root, (sizes.get(root) ?? 0) + 1)
      lengths.set(root, (lengths.get(root) ?? 0) + way.length)
      total += way.length
    })
    const largest = [...lengths.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      ways: this.ways.length,
      crossings: this.crossings.length,
      kerbsideJoins: this.crossings.filter((link) => link.kerbside).length,
      crossingsWithConflicts: this.conflicts.filter((found) => found.length).length,
      /** Conflicts found by a link lying along a lane rather than by intersection. */
      inLaneConflicts: this.inLaneConflicts,
      /** Conflicts found by a link running into a lane and stopping in it. */
      intoLaneConflicts: this.intoLaneConflicts,
      /** Links the connectivity repair had to add. See `stitch`. */
      stitched: this.stitched,
      /** Links refused for passing through a solid footprint. See `linkThroughSolid`. */
      solidRefusals: this.solidRefusals,
      components: sizes.size,
      componentSizes: [...sizes.values()].sort((a, b) => b - a).slice(0, 10),
      largestComponentWays: largest ? sizes.get(largest[0]) ?? 0 : 0,
      reachableLengthFraction: total > 0 && largest ? +(largest[1] / total).toFixed(3) : 0,
      totalLength: +total.toFixed(1),
    }
  }

  /**
   * Is there room in the traffic to start this crossing?
   *
   * Judged as a time-to-arrival against the moment this walker would be clear
   * of each lane, not as a distance: a car forty metres back at speed and one
   * ten metres back crawling are the same distance problem and completely
   * different crossing problems. The walker's own pace is in the sum, so a slow
   * walker genuinely does need a bigger gap than a fast one, which is the
   * detail that stops every pedestrian on the map stepping off at the same
   * moment.
   */
  private gapIsSafe(walker: Walker, link: number) {
    const conflicts = this.conflicts[link]
    if (!conflicts || !conflicts.length || !this.traffic.length) return true
    const length = Math.max(.4, this.crossings[link].length)
    const pace = Math.max(.25, walker.cruise * 1.12)
    for (let index = 0; index < conflicts.length; index += 1) {
      const conflict = conflicts[index]
      // When this body would be past the far side of that lane.
      const needed = (conflict.at * length + LANE_CLEARANCE) / pace + CROSS_MARGIN
      if (this.timeToConflict(conflict, needed) < needed) return false
    }
    return true
  }

  /**
   * Soonest arrival of any vehicle at one conflict point, abandoning the search
   * as soon as it is known to be under `limit`. The early exit is what keeps a
   * kerb wait cheap on a busy junction: the answer the caller wants is almost
   * always "no", and it can be given from the first car that is too close.
   */
  private timeToConflict(conflict: CrossingConflict, limit: number) {
    let soonest = Number.POSITIVE_INFINITY
    const approaches = conflict.approaches
    for (let index = 0; index < approaches.length; index += 1) {
      const approach = approaches[index]
      for (let sim = 0; sim < this.traffic.length; sim += 1) {
        const time = this.traffic[sim].timeAlong(approach.edge, approach.via, approach.offset)
        if (time < soonest) soonest = time
      }
      if (soonest < limit) return soonest
    }
    return soonest
  }

  /**
   * Tell the traffic there is a body in the road, for the lanes this walker is
   * currently in or about to enter.
   *
   * Claimed on a window around the conflict point rather than for the whole
   * crossing, so a walker still on the first kerb is not holding up traffic in
   * a lane it has not reached, and one that has finished with a lane releases
   * it. The window starts before the walker arrives because a driver brakes for
   * someone stepping into the road, not for someone already in front of them.
   */
  private claimRoadway(walker: Walker, link: number) {
    const conflicts = this.conflicts[link]
    if (!conflicts || !conflicts.length || !this.traffic.length) return
    const length = Math.max(.4, this.crossings[link].length)
    const here = THREE.MathUtils.clamp(walker.crossProgress, 0, 1) * length
    for (let index = 0; index < conflicts.length; index += 1) {
      const conflict = conflicts[index]
      const along = conflict.at * length
      if (here < along - 1.6 || here > along + LANE_CLEARANCE) continue
      // A vehicle already standing in this lane is let out rather than held.
      // Both parties waiting for the other is the one outcome worse than either
      // going first: the walker cannot pass a stopped car, and the car will not
      // move while a body is claimed in front of it, so the claim is dropped
      // while the walker is still on the kerb and has lost nothing by waiting.
      if (walker.crossPhase === 'wait' && this.timeToConflict(conflict, .05) <= 0) continue
      for (let sim = 0; sim < this.traffic.length; sim += 1) {
        this.traffic[sim].markPedestrian(conflict.edge, conflict.distance)
      }
    }
  }

  /**
   * Who is currently crossing, or waiting to. Introspection for a headless
   * harness: "a pedestrian waits for traffic" is otherwise a claim about a
   * screenshot, and this turns it into a number that can be watched over a
   * sequence of frames. Not called from `update`.
   */
  crossingReport() {
    const out: Array<{
      index: number; phase: 'wait' | 'go'; held: number; progress: number
      x: number; z: number; conflicts: number; gap: number
    }> = []
    for (let index = 0; index < this.walkers.length; index += 1) {
      const walker = this.walkers[index]
      if (!walker.active || walker.crossing < 0) continue
      const conflicts = this.conflicts[walker.crossing] ?? []
      let gap = Number.POSITIVE_INFINITY
      for (const conflict of conflicts) {
        gap = Math.min(gap, this.timeToConflict(conflict, Number.NEGATIVE_INFINITY))
      }
      out.push({
        index,
        phase: walker.crossPhase,
        held: +walker.crossHeld.toFixed(2),
        progress: +walker.crossProgress.toFixed(3),
        x: +walker.root.position.x.toFixed(2),
        z: +walker.root.position.z.toFixed(2),
        conflicts: conflicts.length,
        gap: Number.isFinite(gap) ? +gap.toFixed(2) : -1,
      })
    }
    return out
  }

  private despawn(walker: Walker) {
    if (walker.companion >= 0) {
      const partner = this.walkers[walker.companion]
      if (partner) partner.companion = -1
      walker.companion = -1
    }
    walker.active = false
    walker.phase = 'idle'
    walker.crossing = -1
    walker.ramp = 0
    walker.root.visible = false
    walker.humanoid.setState('idle')
  }

  /**
   * Re-seed a walker at a point the camera cannot see. Identical discipline to
   * the traffic sim: a pedestrian materialising on a pavement in shot is the
   * same artefact as a car materialising in a street, and no amount of fading
   * disguises it when the fade cannot touch shared materials.
   */
  private trySpawn(walker: Walker) {
    if (!this.ways.length) return false
    this.spawnCursor += 1
    const wayIndex = this.pickWay(hashUnit(walker.seed + this.spawnCursor * 3.17))
    const way = this.ways[wayIndex]
    const direction: 1 | -1 = hashUnit(walker.seed + this.spawnCursor * 4.13) < .5 ? 1 : -1
    // An open footway is entered from an end, which is the pedestrian analogue
    // of a portal; a closed loop can be joined anywhere that is out of sight.
    const distance = way.closed
      ? hashUnit(walker.seed + this.spawnCursor * 6.53) * way.length
      : direction > 0 ? 0 : way.length
    this.sample(way, distance)
    const lateral = (hashUnit(walker.seed + this.spawnCursor * 8.11) * 2 - 1) * way.halfWidth
    this.placeAcross(way.centre + lateral * direction)
    if (!unseen(scratchTarget, 1.2, this.fogDistance)) return false

    walker.active = true
    walker.phase = 'in'
    walker.ramp = 0
    walker.way = wayIndex
    walker.distance = distance
    walker.direction = direction
    walker.lateral = lateral
    walker.targetLateral = lateral
    walker.life = 30 + hashUnit(walker.seed + this.spawnCursor * 9.29) * 60
    walker.errand = 'walk'
    walker.errandTimer = 2 + hashUnit(walker.seed + this.spawnCursor * 5.09) * 9
    walker.crossing = -1
    walker.crossHeld = 0
    walker.pace = 1
    walker.speed = walker.cruise
    // Some people are out with someone. A new arrival that finds an active
    // walker going the same way on the same footway, close by and unattached,
    // falls in beside them: the pair then match pace and hold station on each
    // other, which is most of what reads as two people walking together.
    walker.companion = -1
    if (hashUnit(walker.seed + this.spawnCursor * 11.7) < .34) {
      for (let index = 0; index < this.walkers.length; index += 1) {
        const other = this.walkers[index]
        if (other === walker || !other.active || other.companion >= 0) continue
        if (other.way !== wayIndex || other.direction !== direction) continue
        if (Math.abs(other.distance - distance) > 3.5) continue
        walker.companion = index
        other.companion = this.walkers.indexOf(walker)
        walker.distance = other.distance
        walker.lateral = THREE.MathUtils.clamp(other.lateral + (other.lateral > 0 ? -.42 : .42), -way.halfWidth, way.halfWidth)
        walker.targetLateral = walker.lateral
        break
      }
    }
    walker.heading = Math.atan2(this.sampleDx * direction, this.sampleDz * direction)
    walker.root.position.copy(scratchTarget)
    walker.root.rotation.y = walker.heading
    walker.previousWorld.copy(scratchTarget)
    walker.root.scale.setScalar(.001)
    walker.root.visible = true
    walker.humanoid.setState('walk')
    return true
  }

  /**
   * Fade, cull and animation bookkeeping, shared by the pavement path and the
   * crossing path. Everything above this decides where the body is; this
   * decides whether it is visible and how its legs are moving to get there.
   */
  private settle(walker: Walker, step: number, cullSquared: number, animateWithinSquared: number, finished: boolean) {
    const distanceSquared = walker.root.position.distanceToSquared(cameraPosition)
    if (walker.phase === 'run' && (finished || walker.life <= 0 || distanceSquared > cullSquared)) {
      if (finished || unseen(walker.root.position, 1.2, this.fogDistance)) walker.phase = 'out'
      else walker.life = 5 + hashUnit(walker.seed + this.elapsed) * 6
    }
    if (walker.phase === 'in') {
      walker.ramp = Math.min(1, walker.ramp + step / this.fade)
      if (walker.ramp >= 1) walker.phase = 'run'
    } else if (walker.phase === 'out') {
      walker.ramp -= step / this.fade
      if (walker.ramp <= 0) { this.despawn(walker); return }
    }
    const eased = walker.phase === 'run' ? 1 : THREE.MathUtils.smoothstep(walker.ramp, 0, 1)
    if (walker.phase !== 'run' || walker.root.scale.x !== walker.baseScale) {
      walker.root.scale.setScalar(Math.max(.001, walker.baseScale * eased))
    }
    // The hard cost bound. A distant walker still moves — a pavement that
    // freezes solid at the fog line is worse than one with slightly stiff
    // figures on it — but the skeletal clips are skipped beyond this radius,
    // which is where almost all of the per-walker cost lives.
    if (distanceSquared > animateWithinSquared) return
    walker.root.updateWorldMatrix(true, false)
    walker.root.getWorldPosition(scratchWorld)
    const moved = scratchWorld.distanceTo(walker.previousWorld)
    walker.previousWorld.copy(scratchWorld)
    const groundSpeed = step > 1e-4 ? moved / step : 0
    // During spawn/despawn fades the body still moves, but the gait should not
    // arrive at full amplitude until the figure is fully visible.
    const locomotion = groundSpeed * eased
    const walking = walker.walking ? locomotion > .04 : locomotion > .1
    if (walking !== walker.walking) {
      walker.walking = walking
      walker.humanoid.setState(walking ? 'walk' : 'idle')
    }
    if (walking) walker.humanoid.setGroundSpeed(locomotion)
    walker.humanoid.update(step)
  }

  update(delta: number, camera: THREE.Camera) {
    if (!this.walkers.length || !this.ways.length) return
    const step = Math.min(Math.max(delta, 0), MAX_DELTA)
    if (step <= 0) return
    this.elapsed += step
    refreshCulling(camera)
    const animateWithinSquared = this.animateWithin * this.animateWithin
    const cullSquared = this.cullRadius * this.cullRadius

    this.wayHead.fill(-1)
    for (let index = 0; index < this.walkers.length; index += 1) {
      const walker = this.walkers[index]
      if (!walker.active) continue
      this.walkerNext[index] = this.wayHead[walker.way]
      this.wayHead[walker.way] = index
    }

    // LOD from last frame's positions: one frame of lag on a grading decision is
    // invisible, and doing it here keeps a single pass over the walkers.
    lodActors.length = 0
    for (let index = 0; index < this.walkers.length; index += 1) {
      const walker = this.walkers[index]
      if (!walker.active) continue
      if (walker.root.position.distanceToSquared(cameraPosition) <= animateWithinSquared) {
        lodActors.push(walker.humanoid)
      } else {
        walker.humanoid.setLod('frozen')
      }
    }
    if (lodActors.length && !this.reduced) {
      assignHumanoidLod(lodActors, camera, { fullBudget: 3, mediumBudget: 8, farDistance: this.animateWithin })
    }

    let alive = 0
    for (let index = 0; index < this.walkers.length; index += 1) {
      const walker = this.walkers[index]
      if (!walker.active) continue
      alive += 1
      const way = this.ways[walker.way]

      // Out in the road. A crossing is its own little state machine and none of
      // the pavement logic below applies to it, so it runs here and skips
      // straight to the fade and animation bookkeeping at the bottom.
      if (walker.crossing >= 0) {
        const link = this.crossings[walker.crossing]
        if (walker.crossPhase === 'wait') {
          walker.crossTimer -= step
          walker.crossHeld += step
          walker.speed = 0
          // Look, then wait for a gap. Splitting it this way is what makes the
          // behaviour legible: there is always a short pause at the kerb even
          // on an empty street, so the stop reads as deliberate rather than as
          // a stutter, and the part that varies is the part that depends on
          // the traffic.
          if (walker.crossTimer <= 0 && this.gapIsSafe(walker, walker.crossing)) {
            walker.crossPhase = 'go'
          } else if (walker.crossHeld > KERB_PATIENCE) {
            // Given up. Turning back down the pavement is the only honest
            // alternative to stepping out: a walker that vanishes at the kerb
            // or forces the crossing regardless would both undo the point of
            // the wait.
            walker.crossing = -1
            walker.crossPhase = 'wait'
            walker.crossHeld = 0
            walker.direction = walker.direction === 1 ? -1 : 1
            walker.errand = 'walk'
            walker.errandTimer = 4 + hashUnit(walker.seed * 4.9 + this.elapsed) * 8
            walker.pace = 0
            this.settle(walker, step, cullSquared, animateWithinSquared, false)
            continue
          } else {
            // Something to do while waiting. Two glances alternating reads as
            // checking both ways; a repeated identical one reads as a tic, so
            // the direction alternates and the interval is redrawn each time.
            walker.crossGlance -= step
            if (walker.crossGlance <= 0) {
              walker.crossGlance = 1.6 + hashUnit(walker.seed * 21.3 + this.elapsed) * 2.2
              if (!walker.humanoid.isPlayingGesture) {
                walker.humanoid.playGesture(
                  hashUnit(walker.seed * 3.3 + this.elapsed) < .5 ? 'glance' : 'glanceMirrored',
                  { amplitude: .8 + hashUnit(walker.seed * 7.1 + this.elapsed) * .5 },
                )
              }
            }
          }
        } else {
          walker.speed = walker.cruise * 1.12
          walker.crossProgress += (walker.speed * step) / Math.max(.4, link.length)
          this.claimRoadway(walker, walker.crossing)
        }
        const t = THREE.MathUtils.clamp(walker.crossProgress, 0, 1)
        scratchTarget.set(
          link.fromX + (link.toX - link.fromX) * t,
          this.lift,
          link.fromZ + (link.toZ - link.fromZ) * t,
        )
        walker.root.position.lerp(scratchTarget, 1 - Math.exp(-11 * step))
        // Facing the far kerb while crossing; while waiting, the head turns to
        // look up and down the road it is about to step into.
        const face = Math.atan2(link.toX - link.fromX, link.toZ - link.fromZ)
        const look = walker.crossPhase === 'wait' ? Math.sin(this.elapsed * 1.6 + walker.seed) * .85 : 0
        walker.heading = approachAngle(walker.heading, face + look, 7, step)
        walker.root.rotation.y = walker.heading
        walker.pace += ((walker.crossPhase === 'go' ? 1 : 0) - walker.pace) * (1 - Math.exp(-6 * step))
        walker.life -= step
        if (walker.crossProgress >= 1) {
          this.land(walker, walker.crossing)
        }
        this.settle(walker, step, cullSquared, animateWithinSquared, false)
        continue
      }

      // What this walker is doing, re-rolled on its own clock. Everyone on the
      // pavement used to hold one speed for their entire life and never stop,
      // which is the single loudest tell that a crowd is a scroller: real
      // pavements are full of people standing still, looking in windows, and
      // changing their minds. Each roll is seeded from the walker *and* the
      // clock, so no two figures ever share a schedule.
      walker.errandTimer -= step
      if (walker.errandTimer <= 0) {
        const roll = hashUnit(walker.seed * 3.7 + this.elapsed * 1.31)
        if (walker.errand !== 'walk') {
          walker.errand = 'walk'
          walker.errandTimer = 5 + hashUnit(walker.seed * 6.1 + this.elapsed) * 14
        } else if (roll < .17) {
          // Stopped: checking a phone, waiting for someone, reading a menu.
          walker.errand = 'pause'
          walker.errandTimer = 1.8 + hashUnit(walker.seed * 8.3 + this.elapsed) * 4.5
        } else if (roll < .34) {
          // Window shopping: slows right down and drifts to the shop side.
          walker.errand = 'browse'
          walker.errandTimer = 2.6 + hashUnit(walker.seed * 9.7 + this.elapsed) * 5
          walker.targetLateral = (walker.lateral >= 0 ? 1 : -1) * way.halfWidth
        } else {
          walker.errand = 'walk'
          walker.errandTimer = 4 + hashUnit(walker.seed * 4.9 + this.elapsed) * 16
          // Occasionally somebody turns round and goes back the way they came.
          if (roll > .93 && !way.closed) walker.direction = walker.direction === 1 ? -1 : 1
        }
      }
      const wanted = walker.errand === 'pause' ? 0 : walker.errand === 'browse' ? .3 : 1
      walker.pace += (wanted - walker.pace) * (1 - Math.exp(-3.4 * step))
      walker.speed = walker.cruise * walker.pace

      // Two people walking together keep pace with each other rather than each
      // walking at their own speed and slowly separating.
      if (walker.companion >= 0) {
        const partner = this.walkers[walker.companion]
        if (!partner || !partner.active || partner.way !== walker.way || partner.companion < 0) {
          walker.companion = -1
        } else if (partner.errand === 'pause' || walker.errand === 'pause') {
          walker.speed = 0
        } else {
          const gap = (partner.distance - walker.distance) * walker.direction
          walker.speed = THREE.MathUtils.clamp(
            Math.min(walker.speed, partner.cruise * partner.pace) + gap * .55,
            0,
            walker.cruise * 1.6,
          )
        }
      }

      // Furniture. A walker used to march straight through benches, planters
      // and market stalls, which on the one map with a busy high street is the
      // detail the eye goes to first. The look-ahead is deliberately short —
      // people do not plan a route round a bench, they notice it a stride or
      // two out and shift a shoulder's width — and it steers to whichever side
      // has the room rather than always the same way.
      if (way.obstacles.length) {
        const ahead = walker.distance + walker.direction * 1.9
        const near = Math.min(walker.distance, ahead) - .6
        const far = Math.max(walker.distance, ahead) + .6
        let steer = 0
        let crowded = false
        // The list is sorted along the way, so the scan starts at the first
        // candidate rather than at the beginning.
        let cursor = lowerBound(way.obstacles, near)
        for (; cursor < way.obstacles.length; cursor += 1) {
          const obstacle = way.obstacles[cursor]
          if (obstacle.s > far) break
          // `lateral` is measured from the middle of the *usable band* with
          // the walker's own direction applied, so an obstacle's offset — which
          // is stored across the polyline — has to be moved onto that band and
          // then read the same way round.
          const offset = (obstacle.d - way.centre) * walker.direction
          const clear = obstacle.radius + .34
          if (Math.abs(walker.lateral - offset) > clear) continue
          crowded = true
          const leftRoom = offset - clear + way.halfWidth
          const rightRoom = way.halfWidth - (offset + clear)
          steer = rightRoom > leftRoom ? offset + clear : offset - clear
        }
        if (crowded) {
          walker.targetLateral = THREE.MathUtils.clamp(steer, -way.halfWidth, way.halfWidth)
          // And slow down for it, because squeezing past something is slower
          // than walking at it and then teleporting through.
          walker.speed *= .78
        }
      }

      // Pedestrians deliberately do not car-follow. People on a pavement do not
      // queue behind each other, they step aside and pass, so the only
      // interaction modelled is a lateral nudge: a walker closing on someone at
      // nearly the same offset drifts towards the far side of the footway.
      let nudge = 0
      for (let other = this.wayHead[walker.way]; other >= 0; other = this.walkerNext[other]) {
        if (other === index) continue
        const neighbour = this.walkers[other]
        if (Math.abs(neighbour.distance - walker.distance) > 1.2) continue
        const separation = walker.lateral - neighbour.lateral
        if (Math.abs(separation) < .48) nudge += separation >= 0 ? .9 : -.9
      }
      if (nudge !== 0) {
        walker.targetLateral = THREE.MathUtils.clamp(walker.lateral + nudge, -way.halfWidth, way.halfWidth)
      }
      walker.lateral += (walker.targetLateral - walker.lateral) * (1 - Math.exp(-2.6 * step))

      const travelled = walker.speed * step
      walker.distance += travelled * walker.direction
      walker.life -= step

      let finished = false
      if (way.closed) {
        if (walker.distance < 0) walker.distance += way.length
        else if (walker.distance > way.length) walker.distance -= way.length
      } else if (walker.distance < 0 || walker.distance > way.length) {
        walker.distance = THREE.MathUtils.clamp(walker.distance, 0, way.length)
        // Reaching the end of an open footway is a junction. If there is a
        // kerb opposite, most people cross to it and carry on; the rest have
        // arrived where they were going. Turning round on the spot would be
        // cheaper than either but it is also the tell that gave the old shuttle
        // vehicles away: nobody walks to the end of a street and immediately
        // walks back.
        const end: 0 | 1 = walker.distance <= 0 ? 0 : 1
        const link = this.pickCrossing(walker, end)
        if (link >= 0) {
          walker.crossing = link
          walker.crossHeld = 0
          walker.crossProgress = 0
          walker.errand = 'walk'
          if (this.crossings[link].length < .25) {
            // Turning a corner: the pavement it is stepping onto starts where
            // the one it is leaving stopped. Nothing to cross and nowhere to go,
            // so the transfer happens on the spot rather than through the
            // crossing state machine, whose progress rate has a floor that would
            // hold the walker still for half a second at every junction.
            this.land(walker, link)
          } else if (this.crossings[link].kerbside) {
            // A step across a gap in the paving, still with no carriageway under
            // it. Walked, but not waited at.
            walker.crossPhase = 'go'
            walker.crossTimer = 0
            walker.crossGlance = 0
          } else {
            walker.crossPhase = 'wait'
            // The look, only. How long the walker actually stands here is now
            // decided by the traffic — see `gapIsSafe` — so this is the reaction
            // time before it starts judging gaps, not the wait itself. Drawn per
            // walker so a group does not step off together the instant a gap
            // opens.
            walker.crossTimer = KERB_LOOK + hashUnit(walker.seed * 7.7 + this.elapsed) * .75
            walker.crossGlance = .5 + hashUnit(walker.seed * 11.3 + this.elapsed) * 1.4
            walker.pace = 0
          }
        } else {
          finished = true
        }
      }

      this.sample(way, walker.distance)
      const forwardX = this.sampleDx * walker.direction
      const forwardZ = this.sampleDz * walker.direction
      this.placeAcross(way.centre + walker.lateral * walker.direction)
      walker.root.position.lerp(scratchTarget, 1 - Math.exp(-9 * step))
      walker.heading = approachAngle(walker.heading, Math.atan2(forwardX, forwardZ), 6.5, step)
      walker.root.rotation.y = walker.heading

      this.settle(walker, step, cullSquared, animateWithinSquared, finished)
    }

    if (alive < this.targetAlive) {
      for (let index = 0; index < this.walkers.length; index += 1) {
        const candidate = this.walkers[index]
        if (candidate.active) continue
        if (this.trySpawn(candidate)) break
      }
    }

    if (this.instanced) this.updateInstanced()
  }

  /**
   * Distant filler. These have no rig and no state beyond a phase derived from
   * their index and the elapsed time, because their entire job is to put
   * movement on a pavement too far away for anyone to read a gait on. Deriving
   * the phase from `elapsed` rather than integrating a step means a filler's
   * position is a pure function of time, so it cannot drift after a dropped
   * frame. They collapse to zero scale inside the articulated walkers' range so
   * the two populations never overlap.
   */
  private updateInstanced() {
    const instanced = this.instanced
    if (!instanced || !instanced.count) return
    const near = this.animateWithin * .75
    const nearSquared = near * near
    for (let index = 0; index < instanced.count; index += 1) {
      const seed = index * 13.71 + 4.3
      const way = this.ways[this.pickWay(hashUnit(seed * 1.13))]
      const direction = hashUnit(seed) < .5 ? 1 : -1
      const speed = .5 + hashUnit(seed * 1.7) * .4
      const offset = hashUnit(seed * 2.3) * way.length
      let distance = (offset + this.elapsed * speed * direction) % way.length
      if (distance < 0) distance += way.length
      this.sample(way, distance)
      this.placeAcross(way.centre + (hashUnit(seed * 3.1) * 2 - 1) * way.halfWidth)
      const hidden = scratchTarget.distanceToSquared(cameraPosition) < nearSquared
      scratchScale.setScalar(hidden ? 0 : 1)
      scratchQuaternion.setFromAxisAngle(scratchAxis, Math.atan2(this.sampleDx * direction, this.sampleDz * direction))
      scratchMatrix.compose(scratchTarget, scratchQuaternion, scratchScale)
      instanced.mesh.setMatrixAt(index, scratchMatrix)
    }
    instanced.mesh.instanceMatrix.needsUpdate = true
  }

  /** Warm the pavements up before the first frame. See `priming`. */
  prime(seconds: number, camera: THREE.Camera) {
    camera.updateMatrixWorld()
    priming = true
    try {
      for (let remaining = seconds; remaining > 0; remaining -= MAX_DELTA) this.update(MAX_DELTA, camera)
    } finally {
      priming = false
    }
  }

  /** Park every walker; the rigs themselves belong to the caller. */
  dispose() {
    for (const walker of this.walkers) {
      this.despawn(walker)
      walker.humanoid.dispose()
    }
    this.wayHead.fill(-1)
  }
}
