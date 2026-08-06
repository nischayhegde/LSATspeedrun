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

  const addEdge = (from: number, to: number, kind: LaneKind, speed: number) => {
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
      addEdge(ids[index], ids[index + 1], kind, speed)
      if (!way.oneWay) addEdge(ids[index + 1], ids[index], kind, speed)
    }
    if (way.closed) {
      addEdge(ids[ids.length - 1], ids[0], kind, speed)
      if (!way.oneWay) addEdge(ids[0], ids[ids.length - 1], kind, speed)
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
 * How close to a junction a vehicle still counts as "about to arrive" on the
 * edge beyond it. Only used by the pedestrian gap test, which has to see a car
 * that is one edge short of the crossing and already committed to turning onto
 * it — the alternative is a walker stepping off in front of a car that was
 * hidden behind a corner for the last two metres of its approach.
 */
const TURN_IN_REACH = 3.4

export class TrafficSim {
  private readonly graph: RoadGraph
  private readonly kind: LaneKind
  private readonly laneOffset: number
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
   * Seconds until the first vehicle reaches `distance` along `edge`, or
   * Infinity if nothing is coming.
   *
   * This is the pedestrian's side of the crossing. It walks the same per-edge
   * occupancy buckets the car-following pass uses — rebuilt at the top of
   * `update`, so they are this frame's — which makes the cost degree × the
   * handful of vehicles on those edges rather than anything proportional to
   * the size of either population. Three places a car can be coming from:
   *
   *  - this edge, behind the crossing point;
   *  - its twin, which approaches the same point from the other side;
   *  - an edge feeding the junction just short of the crossing, but only if
   *    that vehicle has already chosen this edge as its continuation. Turning
   *    traffic is otherwise invisible until the frame it enters the edge,
   *    which is far too late for a walker who has just committed.
   *
   * A stopped vehicle is not "arriving": a queue held at a junction is exactly
   * when a pedestrian should cross. Standing right on the crossing is a block
   * rather than a gap, though, or a walker would set off through a stationary
   * car.
   */
  timeToPoint(edgeIndex: number, distance: number) {
    if (this.disposed || edgeIndex < 0 || edgeIndex >= this.graph.edges.length) return Number.POSITIVE_INFINITY
    const edge = this.graph.edges[edgeIndex]
    if (edge.kind !== this.kind) return Number.POSITIVE_INFINITY
    let soonest = Number.POSITIVE_INFINITY
    const consider = (approach: number, speed: number) => {
      if (approach < .1) { soonest = 0; return }
      if (speed < .06) return
      const time = approach / speed
      if (time < soonest) soonest = time
    }
    for (let other = this.edgeHead[edgeIndex]; other >= 0; other = this.agentNext[other]) {
      const rival = this.agents[other]
      if (rival.distance > distance + .1) continue
      consider(distance - rival.distance, rival.speed)
    }
    if (edge.twin >= 0) {
      const twin = this.graph.edges[edge.twin]
      const mirrored = twin.length - distance
      for (let other = this.edgeHead[edge.twin]; other >= 0; other = this.agentNext[other]) {
        const rival = this.agents[other]
        if (rival.distance > mirrored + .1) continue
        consider(mirrored - rival.distance, rival.speed)
      }
    }
    // Traffic still one edge away, already turned towards this one.
    if (distance < TURN_IN_REACH) this.turningIn(edge.from, edgeIndex, distance, consider)
    if (edge.twin >= 0) {
      const twin = this.graph.edges[edge.twin]
      const mirrored = twin.length - distance
      if (mirrored < TURN_IN_REACH) this.turningIn(edge.to, edge.twin, mirrored, consider)
    }
    return soonest
  }

  /**
   * Vehicles on the arms feeding `node` that have already committed to
   * `edgeIndex`. The incoming edges are found as the twins of the node's
   * outgoing ones, which holds on a two-way street network and costs nothing;
   * a genuinely one-way arm is simply not seen, and the standoff on the
   * vehicle side covers that case.
   */
  private turningIn(node: number, edgeIndex: number, distance: number, consider: (approach: number, speed: number) => void) {
    const arms = this.graph.nodes[node].out
    for (let slot = 0; slot < arms.length; slot += 1) {
      const incoming = this.graph.edges[arms[slot]].twin
      if (incoming < 0 || incoming === edgeIndex) continue
      const arm = this.graph.edges[incoming]
      if (arm.kind !== this.kind) continue
      for (let other = this.edgeHead[incoming]; other >= 0; other = this.agentNext[other]) {
        const rival = this.agents[other]
        if (rival.nextEdge !== edgeIndex) continue
        consider(arm.length - rival.distance + distance, rival.speed)
      }
    }
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
    scratchTarget.set(
      node.x + edge.dx * start - edge.dz * this.laneOffset,
      this.lift,
      node.z + edge.dz * start + edge.dx * this.laneOffset,
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
    scratchTarget.set(
      from.x + edge.dx * agent.distance - edge.dz * this.laneOffset,
      this.lift,
      from.z + edge.dz * agent.distance + edge.dx * this.laneOffset,
    )
    // Easing the *rendered* position rather than the simulated one is what
    // rounds off a corner: the two offset centrelines meeting at a junction are
    // a lateral step of up to twice the lane offset, and stepping it would read
    // as the vehicle jinking sideways as it turns.
    if (blend >= 1) agent.object.position.copy(scratchTarget)
    else agent.object.position.lerp(scratchTarget, blend)
    agent.object.rotation.y = this.facing === 'x' ? agent.heading - Math.PI / 2 : agent.heading
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
    this.edgeHead.fill(-1)
    for (let index = 0; index < this.agents.length; index += 1) {
      const agent = this.agents[index]
      if (!agent.active || agent.edge < 0) continue
      this.agentNext[index] = this.edgeHead[agent.edge]
      this.edgeHead[agent.edge] = index
    }

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
        const corner = rightness > 0
          ? Math.min(this.laneOffset * 3, 2 * this.laneOffset * Math.sqrt(Math.max(0, 1 - alignment) / Math.max(.08, 1 + alignment)))
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

export type CrowdOptions = {
  /** Footway polylines the crowd may walk along, in world space. */
  ways: Array<{ points: XZ[]; closed?: boolean }>
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
 * Where one crossing meets one carriageway: which directed edge, how far along
 * it, and how far along the crossing itself the conflict sits.
 *
 * Resolved once when the crowd is built. The whole point of precomputing it is
 * that the per-frame question — "is anything coming?" — then reduces to a
 * lookup on the traffic sim's existing per-edge occupancy list, with no
 * geometry and no search.
 */
type CrossingConflict = { edge: number; distance: number; at: number }

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

/** One kerb-to-kerb link between the ends of two footways. */
type Crossing = {
  fromWay: number
  fromEnd: 0 | 1
  toWay: number
  toEnd: 0 | 1
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  length: number
}

type Footway = {
  /** Flat x,z pairs. Flat arrays because these are read every frame. */
  points: Float32Array
  /** Cumulative arc length at each vertex; `length` is its last entry. */
  cumulative: Float32Array
  length: number
  closed: boolean
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

function buildFootway(points: XZ[], closed: boolean): Footway | null {
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
  return { points: flat, cumulative, length, closed, obstacles: [] }
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
  /** Scratch for `sample`: written by every call, read immediately. */
  private sampleX = 0
  private sampleZ = 0
  private sampleDx = 0
  private sampleDz = 0
  private spawnCursor = 0
  private elapsed = 0

  constructor(options: CrowdOptions) {
    for (const way of options.ways) {
      const built = buildFootway(way.points, way.closed ?? false)
      if (built) this.ways.push(built)
    }
    this.instanced = options.instanced
    this.animateWithin = options.animateWithin ?? 34
    this.halfWidth = (options.width ?? 1.5) * .5
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
    const reach = this.halfWidth + 1.4
    for (const obstacle of options.obstacles ?? []) {
      for (const way of this.ways) {
        const hit = projectOntoWay(way, obstacle.x, obstacle.z)
        if (hit.distance > reach + obstacle.radius) continue
        way.obstacles.push({ s: hit.s, d: hit.d, radius: obstacle.radius })
      }
    }
    for (const way of this.ways) way.obstacles.sort((a, b) => a.s - b.s)

    // Crossings. Two open footways whose ends nearly meet are the two kerbs of
    // one junction: walkers reaching such an end wait, look, and step across
    // rather than simply evaporating at the corner, which is what made the
    // pavements read as separate treadmills with no connection between them.
    const range = options.crossingRange ?? 4.6
    if (range > 0) {
      const ends: Array<{ way: number; end: 0 | 1; x: number; z: number }> = []
      this.ways.forEach((way, index) => {
        if (way.closed) return
        const last = way.cumulative.length - 1
        ends.push({ way: index, end: 0, x: way.points[0], z: way.points[1] })
        ends.push({ way: index, end: 1, x: way.points[last * 2], z: way.points[last * 2 + 1] })
      })
      for (let a = 0; a < ends.length; a += 1) {
        for (let b = a + 1; b < ends.length; b += 1) {
          if (ends[a].way === ends[b].way) continue
          const gap = Math.hypot(ends[a].x - ends[b].x, ends[a].z - ends[b].z)
          // Below the lower bound the two ends are the same corner rather than
          // opposite kerbs, and a "crossing" there is a walker jittering on the
          // spot.
          if (gap < 1.1 || gap > range) continue
          this.crossings.push({ fromWay: ends[a].way, fromEnd: ends[a].end, toWay: ends[b].way, toEnd: ends[b].end, fromX: ends[a].x, fromZ: ends[a].z, toX: ends[b].x, toZ: ends[b].z, length: gap })
          this.crossings.push({ fromWay: ends[b].way, fromEnd: ends[b].end, toWay: ends[a].way, toEnd: ends[a].end, fromX: ends[b].x, fromZ: ends[b].z, toX: ends[a].x, toZ: ends[a].z, length: gap })
        }
      }
    }

    // Which carriageways each crossing actually cuts across.
    //
    // Derived from the road graph rather than declared, on the same principle
    // as the pavement furniture above: the footways and the road network were
    // both contributed by the scene as it drew the streets, so anything that
    // tied them together by hand would drift from the art the first time a
    // street moved. A crossing that turns out to cross nothing — a path over a
    // green, the two ends of a quay — simply gets an empty list and keeps the
    // old timer behaviour, which is the correct answer for it.
    if (options.traffic?.length) this.traffic.push(...options.traffic)
    const graph = options.roadGraph
    for (const link of this.crossings) {
      const found: CrossingConflict[] = []
      if (graph && this.traffic.length) {
        const roads = graph.edgesByKind.road
        for (let index = 0; index < roads.length; index += 1) {
          const edgeIndex = roads[index]
          const edge = graph.edges[edgeIndex]
          // One of each two-way pair. `markPedestrian` and `timeToPoint` both
          // handle the twin themselves, and recording both would double every
          // lookup for nothing.
          if (edge.twin >= 0 && edge.twin < edgeIndex) continue
          const from = graph.nodes[edge.from]
          const to = graph.nodes[edge.to]
          // Cheap reject before the intersection maths: most of the network is
          // nowhere near any given kerb.
          if (Math.min(from.x, to.x) > Math.max(link.fromX, link.toX) + .1) continue
          if (Math.max(from.x, to.x) < Math.min(link.fromX, link.toX) - .1) continue
          if (Math.min(from.z, to.z) > Math.max(link.fromZ, link.toZ) + .1) continue
          if (Math.max(from.z, to.z) < Math.min(link.fromZ, link.toZ) - .1) continue
          const hit = segmentCross(link.fromX, link.fromZ, link.toX, link.toZ, from.x, from.z, to.x, to.z)
          if (!hit) continue
          found.push({ edge: edgeIndex, distance: hit.u * edge.length, at: hit.t })
        }
      }
      this.conflicts.push(found)
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
   * A crossing leaving this kerb, or -1. Not everyone crosses: some proportion
   * of arrivals at any corner have simply got where they were going, and a
   * junction where every single pedestrian steps into the road looks as
   * mechanical as one where none of them do.
   */
  private pickCrossing(walker: Walker, end: 0 | 1) {
    if (!this.crossings.length) return -1
    if (hashUnit(walker.seed * 13.1 + this.elapsed) > .72) return -1
    let first = -1
    let count = 0
    for (let index = 0; index < this.crossings.length; index += 1) {
      const link = this.crossings[index]
      if (link.fromWay !== walker.way || link.fromEnd !== end) continue
      count += 1
      // Reservoir pick, so a corner with three kerbs off it does not send
      // everyone to the same one.
      if (first < 0 || hashUnit(walker.seed * 17.3 + this.elapsed + count) < 1 / count) first = index
    }
    return first
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
      for (let sim = 0; sim < this.traffic.length; sim += 1) {
        if (this.traffic[sim].timeToPoint(conflict.edge, conflict.distance) < needed) return false
      }
    }
    return true
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
        for (const sim of this.traffic) gap = Math.min(gap, sim.timeToPoint(conflict.edge, conflict.distance))
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
    const wayIndex = Math.floor(hashUnit(walker.seed + this.spawnCursor * 3.17) * this.ways.length) % this.ways.length
    const way = this.ways[wayIndex]
    const direction: 1 | -1 = hashUnit(walker.seed + this.spawnCursor * 4.13) < .5 ? 1 : -1
    // An open footway is entered from an end, which is the pedestrian analogue
    // of a portal; a closed loop can be joined anywhere that is out of sight.
    const distance = way.closed
      ? hashUnit(walker.seed + this.spawnCursor * 6.53) * way.length
      : direction > 0 ? 0 : way.length
    this.sample(way, distance)
    const lateral = (hashUnit(walker.seed + this.spawnCursor * 8.11) * 2 - 1) * this.halfWidth
    scratchTarget.set(
      this.sampleX - this.sampleDz * lateral * direction,
      this.lift,
      this.sampleZ + this.sampleDx * lateral * direction,
    )
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
        walker.lateral = THREE.MathUtils.clamp(other.lateral + (other.lateral > 0 ? -.42 : .42), -this.halfWidth, this.halfWidth)
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
          // Landed. Pick up the far footway from the end that was crossed to.
          walker.way = link.toWay
          const target = this.ways[link.toWay]
          walker.distance = link.toEnd === 0 ? 0 : target.length
          walker.direction = link.toEnd === 0 ? 1 : -1
          walker.lateral = 0
          walker.targetLateral = (hashUnit(walker.seed * 19.7 + this.elapsed) * 2 - 1) * this.halfWidth
          walker.crossing = -1
          walker.crossPhase = 'wait'
          walker.crossHeld = 0
          walker.companion = -1
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
          walker.targetLateral = (walker.lateral >= 0 ? 1 : -1) * this.halfWidth
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
          // `lateral` is measured with the walker's own direction applied, so
          // an obstacle's stored offset has to be read the same way round.
          const offset = obstacle.d * walker.direction
          const clear = obstacle.radius + .34
          if (Math.abs(walker.lateral - offset) > clear) continue
          crowded = true
          const leftRoom = offset - clear + this.halfWidth
          const rightRoom = this.halfWidth - (offset + clear)
          steer = rightRoom > leftRoom ? offset + clear : offset - clear
        }
        if (crowded) {
          walker.targetLateral = THREE.MathUtils.clamp(steer, -this.halfWidth, this.halfWidth)
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
        walker.targetLateral = THREE.MathUtils.clamp(walker.lateral + nudge, -this.halfWidth, this.halfWidth)
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
          walker.crossPhase = 'wait'
          // The look, only. How long the walker actually stands here is now
          // decided by the traffic — see `gapIsSafe` — so this is the reaction
          // time before it starts judging gaps, not the wait itself. Drawn per
          // walker so a group does not step off together the instant a gap
          // opens.
          walker.crossTimer = KERB_LOOK + hashUnit(walker.seed * 7.7 + this.elapsed) * .75
          walker.crossHeld = 0
          walker.crossGlance = .5 + hashUnit(walker.seed * 11.3 + this.elapsed) * 1.4
          walker.crossProgress = 0
          walker.errand = 'walk'
          walker.pace = 0
        } else {
          finished = true
        }
      }

      this.sample(way, walker.distance)
      const forwardX = this.sampleDx * walker.direction
      const forwardZ = this.sampleDz * walker.direction
      scratchTarget.set(
        this.sampleX - this.sampleDz * walker.lateral * walker.direction,
        this.lift,
        this.sampleZ + this.sampleDx * walker.lateral * walker.direction,
      )
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
      const wayIndex = index % this.ways.length
      const way = this.ways[wayIndex]
      const seed = index * 13.71 + 4.3
      const direction = hashUnit(seed) < .5 ? 1 : -1
      const speed = .5 + hashUnit(seed * 1.7) * .4
      const offset = hashUnit(seed * 2.3) * way.length
      let distance = (offset + this.elapsed * speed * direction) % way.length
      if (distance < 0) distance += way.length
      this.sample(way, distance)
      const lateral = (hashUnit(seed * 3.1) * 2 - 1) * this.halfWidth
      scratchTarget.set(
        this.sampleX - this.sampleDz * lateral,
        this.lift,
        this.sampleZ + this.sampleDx * lateral,
      )
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
