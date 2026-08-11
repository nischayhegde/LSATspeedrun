import * as THREE from 'three'

/**
 * What the firm can actually see out of its own window.
 *
 * ## Why this exists
 *
 * The window used to show a dozen boxes standing on the glass: a strip of
 * skyline authored per finish level, four centimetres deep, wedged between the
 * sky plane and the pane. It read as wallpaper because it was wallpaper, and it
 * agreed with nothing — at tier 5 the window showed a harbour while the world
 * map had the firm out on The Circuit's turnpike, in open country.
 *
 * ## Why this is not a picture of the map
 *
 * The obvious move is to render the map's district to a texture and hang the
 * texture in the frame. Three things rule it out. The office scene is on the
 * critical path and its first frame is already dominated by shader compilation,
 * so putting a second scene build and a second program link in front of it
 * hands back everything the last optimisation pass won. A texture on a quad is
 * also flat in the depth buffer, and the illustrated look is a depth-driven
 * contour pass — a flat quad comes back with one outline around the frame and
 * nothing inside it, which is the wallpaper problem restated. And the map's
 * geometry is authored for a camera thirty metres up looking down; almost none
 * of what it spends its triangles on is legible from a window at eye level.
 *
 * ## What this does instead
 *
 * It builds the view the way a background painter would: a small number of
 * flat-shaded masses at their real distances, from a couple of metres beyond
 * the glass out to about eighty. Distance is real, so parallax, occlusion and
 * the contour pass all come out correct for free, and the whole view is five or
 * six merged meshes rather than a district.
 *
 * Everything is unlit `MeshBasicMaterial` with baked vertex colours. Outside is
 * lit by the sun and inside is lit by desk lamps; running the view through the
 * room's lights would be wrong as well as expensive, and it would drag the
 * backdrop into the interior's exponential fog. Aerial perspective is baked
 * into the same vertex colours instead, which is cheaper and controllable: the
 * far hills fade to the horizon rather than to the office's murk.
 *
 * ## Consistency with the map
 *
 * The five regions' sky, ground, stone, accent and road colours are the ones
 * `ARC` in `map-three-scene.tsx` grades each district to, and the built forms
 * follow the same descriptions the map's planner works from: the Old Quarter's
 * brick terraces and municipal rail, The Circuit's surveyed turnpike through
 * enclosed fields, Treaty Sea's working quays, the Sovereign Arc's ceremonial
 * axis. They are restated here rather than imported because the map module is a
 * nine-thousand-line scene and pulling it into the office's chunk to read five
 * palettes would cost more than the entire view does.
 */

export type OfficeWindowRegion = 'city' | 'nation' | 'ocean' | 'continent' | 'orbit'

/**
 * Which region of the world map a headquarters of this tier stands in.
 *
 * These bands are the career route's own, as the world map lays them out. The
 * office used to run a separate ladder of exterior names — a harbour at 5, a
 * generic "world" from 6 to 8 — which is how the window came to disagree with
 * the map about where the firm was.
 */
export function officeWindowRegionFor(tier: number): OfficeWindowRegion {
  if (tier <= 4) return 'city'
  if (tier <= 6) return 'nation'
  if (tier <= 9) return 'ocean'
  if (tier <= 11) return 'continent'
  return 'orbit'
}

type RegionLook = {
  /** Zenith, straight from the region's own sky grade. */
  skyTop: number
  /** The horizon, which is also what every distance fades into. */
  haze: number
  /** How completely the farthest things fade, 0-1. */
  hazeDepth: number
  /**
   * The same, for the ground plane, which needs its own.
   *
   * A ground plane runs from under the window to the horizon in one surface,
   * so it resolves the whole depth ramp at once and any error in it shows up
   * as the flattest, largest area in the frame. Water is the case that forces
   * the split: fade it at the rate the buildings fade and the sea arrives at
   * the horizon holding exactly the sky's colour, which is true of a real hazy
   * day and useless in a painting, because it leaves no horizon.
   */
  groundHaze: number
  ground: number
  stone: number
  accent: number
  road: number
  roof: number
  /** Colour of the daylight this view throws back into the room. */
  daylight: number
  /** Strength of that spill, as a multiple of the authored interior level. */
  daylightStrength: number
  night: boolean
}

/**
 * Palettes are authored roughly twice as bright as the colour they are meant to
 * arrive at, because this pipeline darkens.
 *
 * An earlier pass here assumed the opposite — that tone mapping at the office's
 * exposure and encoding to sRGB lifts a mid-grey, so the palettes should be
 * authored two or three stops down. Measured end to end, by building a grey ramp
 * into the sky plane behind the real window and reading it back off the
 * compositor, it is the other way about and not by a little: an authored 0xc0
 * returns as luma 91, 0xa0 as 75, 0x80 as 56, 0x60 as 42. About 0.45x, near
 * enough linearly, once the scene's tone mapping, the style pass and the pane
 * have all had their turn.
 *
 * Authored dark on top of that, the view came back with its sky at luma 37
 * against interior walls at 40-60, so the brightest thing in the room was the
 * desk lamp and the window read as a dim vitrine. These values are picked so the
 * horizon lands near 90 and the sunlit masses in the eighties, which is what
 * puts daylight on the far side of the glass.
 *
 * They cannot simply be scaled up without limit either: a gain sweep above white
 * is strongly compressive, so buying brightness with one big multiplier costs
 * the separation between the near masses and the horizon, and that range is the
 * whole point of an aerial perspective. The ordering matters more than the
 * level, and the ordering is: haze brightest, then sunlit stone, then ground,
 * then anything in shadow.
 */
const LOOKS: Record<OfficeWindowRegion, RegionLook> = {
  city: {
    skyTop: 0x6b9fc0, haze: 0xb0b3a8, hazeDepth: .44, groundHaze: .8,
    ground: 0x7e8c78, stone: 0xa89c84, accent: 0xd08a5c, road: 0x5e6866, roof: 0x7d6a5f,
    daylight: 0xf0d3a6, daylightStrength: 1.14, night: false,
  },
  nation: {
    skyTop: 0x74a6c4, haze: 0xb6b9ab, hazeDepth: .4, groundHaze: .74,
    ground: 0x86a172, stone: 0xa2977f, accent: 0x6e9689, road: 0xbfae90, roof: 0xc0a469,
    daylight: 0xf4e2bb, daylightStrength: 1.24, night: false,
  },
  ocean: {
    skyTop: 0x5c99b8, haze: 0xa8b5b8, hazeDepth: .44, groundHaze: .3,
    ground: 0x35646e, stone: 0x9e988a, accent: 0x4b8b93, road: 0x767d79, roof: 0x6d6156,
    daylight: 0xcfe4e6, daylightStrength: 1.26, night: false,
  },
  continent: {
    skyTop: 0x6795b6, haze: 0xb2b1a7, hazeDepth: .4, groundHaze: .74,
    ground: 0x818e6f, stone: 0xaaa393, accent: 0xc08b64, road: 0xada492, roof: 0x949ba3,
    daylight: 0xf3d5b4, daylightStrength: 1.18, night: false,
  },
  // Night keeps its darkness — this is the one region where the room being
  // brighter than the window is the truth — but not so much of it that the
  // 0.45x transfer takes the whole view to black. Stone and accent carry the
  // orbital structure's own running lights, which is all that is legible out
  // there anyway.
  orbit: {
    skyTop: 0x0a1024, haze: 0x2a3358, hazeDepth: .5, groundHaze: .7,
    ground: 0x24323f, stone: 0x8a9694, accent: 0x6fd0d8, road: 0x353f47, roof: 0x4b555f,
    daylight: 0x9fd6de, daylightStrength: .86, night: true,
  },
}

/**
 * How high above the exterior grade the middle of the window sits, in metres.
 *
 * A back room and a sovereign tower are not on the same storey, and elevation
 * is most of what makes a view read as prestigious: from a ground floor you are
 * inside the street; from higher up the street is a thing that happens below
 * you and the district resolves into a horizon.
 *
 * The floor of this office is three and a half metres below the middle of its
 * window — it is a tall room with a tall window — so the ground-floor entry is
 * 3.4 and not the 1.5 a real sill sits at. Anything less puts the pavement
 * above the floorboards, and both are in frame at once.
 *
 * The ceiling is deliberately not the literal storey count of a forty-floor
 * tower. A window is an aperture, and the cone of ground it admits is narrow:
 * past about thirty metres of eye height nothing but sky and the tops of the
 * tallest neighbours can reach the frame at all, so pushing the number higher
 * buys no extra sense of altitude and costs the whole district.
 *
 * It climbs the whole way and never steps back down. An earlier pass restarted
 * the ladder at each new region — 13 metres at the City Power Firm, then 6.5 at
 * the Regional Headquarters — on the reasoning that a new region is a new and
 * lower-rise setting. It reads as a demotion, because it is one: buying the next
 * headquarters dropped the sightline back off the roofs and into the street it
 * had just cleared, and `STREET_LEVEL` flipped with it, so the view swapped a
 * skyline for a canal bank as a reward for promotion. The career only ever goes
 * up, so this does too.
 *
 * The first three offices are below `STREET_LEVEL` and look into the quarter;
 * from the Downtown Firm on, the sightline is over it.
 */
const EYE_HEIGHTS = [3.4, 4.2, 6.4, 8.5, 11, 12.5, 14, 15.5, 17, 18.5, 20, 21.5, 23, 24.5, 26]

function eyeHeightFor(tier: number) {
  return EYE_HEIGHTS[Math.max(0, Math.min(EYE_HEIGHTS.length - 1, Math.round(tier)))]
}

/** Below this the window still looks into the street rather than over it. */
const STREET_LEVEL = 7

/**
 * How many things of about `width` metres it takes to cross `span` metres.
 *
 * The bands are as wide as the frame needs them to be, and the frame's width at
 * a given depth is not a constant — it depends on the opening, and on where in
 * the room the eye is. A terrace authored as "thirteen houses across the span"
 * therefore has no fixed house in it: widen the span and the houses widen with
 * it until a terrace of thirteen reads as a row of hangars. Authoring the size
 * of the thing and counting how many fit is the way round that survives a change
 * to the framing.
 */
function spanCount(span: number, width: number, minimum = 5) {
  return Math.max(minimum, Math.round(span / width))
}

function hash(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123
  return value - Math.floor(value)
}

/**
 * Sun high, to the right and behind the viewer, so the fronts facing the window
 * read as mid-tone and every mass shows a lit flank against a shaded one. The
 * shadow floor is skylight only; a face turned away from the sun outdoors is
 * lit by half the sky and is nowhere near black.
 */
const SUN = new THREE.Vector3(.55, .74, .38).normalize()
/**
 * The sun is high and only slightly toward the viewer, so the faces turned at
 * the window take about a third of it and the roofs take nearly all of it. That
 * is correct for the light and it means the window-facing faces — the ones the
 * whole view is made of — sit at `SKYLIGHT + SUNLIGHT * .38`. With a skylight
 * floor of .3 that was .54, and after the pipeline's own 0.45x it put every
 * facade in the frame at half the value it was authored at.
 *
 * The floor is high because it is honest: a wall facing away from the sun
 * outdoors is lit by half the sky and is nowhere near black, and the ratio
 * between a lit flank and a shaded one outdoors is nothing like the ratio inside
 * a room lit by two lamps.
 */
const SKYLIGHT = .5
const SUNLIGHT = .62

const FORWARD = new THREE.Vector3(0, 0, 1)
const BACKWARD = new THREE.Vector3(0, 0, -1)
const RIGHT = new THREE.Vector3(1, 0, 0)
const LEFT = new THREE.Vector3(-1, 0, 0)
const UP = new THREE.Vector3(0, 1, 0)

/**
 * An sRGB hex under a lighting factor, in the linear space a vertex colour
 * attribute is read in.
 *
 * A fresh colour per call rather than a shared scratch, because the graded
 * emitters take two at once and a scratch would silently hand them the same
 * one. This runs a few thousand times at build and never again.
 */
function tone(hex: number, factor: number) {
  return new THREE.Color().setHex(hex).multiplyScalar(factor)
}

const mixFrom = new THREE.Color()
const mixTo = new THREE.Color()
function mixHex(from: number, to: number, amount: number) {
  mixFrom.setHex(from)
  mixTo.setHex(to)
  return mixFrom.lerp(mixTo, amount).getHex()
}

/**
 * One merged, flat-shaded mesh under construction.
 *
 * Every emitter writes triangles straight into two plain arrays; a band of
 * thirty buildings ends up as one geometry and one draw call. Aerial
 * perspective is applied per vertex as it is written, which is why a ground
 * strip running from six metres out to eighty fades correctly along its length
 * instead of taking a single colour for the whole quad.
 */
class Sheet {
  private readonly position: number[] = []
  private readonly colour: number[] = []
  private readonly haze = new THREE.Color()

  constructor(look: RegionLook, private readonly hazeStart: number, private readonly hazeEnd: number, private readonly hazeDepth = look.hazeDepth) {
    this.haze.setHex(look.haze)
  }

  get triangles() {
    return this.position.length / 9
  }

  debugColour: [number, number, number] | null = null

  private vertex(x: number, y: number, z: number, r: number, g: number, b: number) {
    if (this.debugColour) {
      this.position.push(x, y, z)
      this.colour.push(...this.debugColour)
      return
    }
    // `z` runs negative away from the glass, so distance is its magnitude.
    const reach = Math.min(1, Math.max(0, (-z - this.hazeStart) / (this.hazeEnd - this.hazeStart)))
    const amount = Math.pow(reach, .72) * this.hazeDepth
    this.position.push(x, y, z)
    this.colour.push(
      r + (this.haze.r - r) * amount,
      g + (this.haze.g - g) * amount,
      b + (this.haze.b - b) * amount,
    )
  }

  triangle(a: Point, b: Point, c: Point, colour: THREE.Color) {
    this.vertex(...a, colour.r, colour.g, colour.b)
    this.vertex(...b, colour.r, colour.g, colour.b)
    this.vertex(...c, colour.r, colour.g, colour.b)
  }

  quad(a: Point, b: Point, c: Point, d: Point, colour: THREE.Color) {
    this.triangle(a, b, c, colour)
    this.triangle(a, c, d, colour)
  }

  /** A quad whose first and second edges carry different colours. */
  gradedQuad(a: Point, b: Point, c: Point, d: Point, near: THREE.Color, far: THREE.Color) {
    this.vertex(...a, near.r, near.g, near.b)
    this.vertex(...b, near.r, near.g, near.b)
    this.vertex(...c, far.r, far.g, far.b)
    this.vertex(...a, near.r, near.g, near.b)
    this.vertex(...c, far.r, far.g, far.b)
    this.vertex(...d, far.r, far.g, far.b)
  }

  /**
   * A rectangular mass, five faces. The underside is never visible from a
   * window and is the one face worth not paying for.
   */
  box(x: number, y: number, z: number, width: number, height: number, depth: number, base: number, brightness = 1) {
    const hw = width / 2
    const hd = depth / 2
    const top = y + height
    const shade = (normal: THREE.Vector3) => tone(base, (SKYLIGHT + SUNLIGHT * Math.max(0, normal.dot(SUN))) * brightness)
    this.quad([x - hw, y, z + hd], [x + hw, y, z + hd], [x + hw, top, z + hd], [x - hw, top, z + hd], shade(FORWARD))
    this.quad([x + hw, y, z - hd], [x - hw, y, z - hd], [x - hw, top, z - hd], [x + hw, top, z - hd], shade(BACKWARD))
    this.quad([x + hw, y, z + hd], [x + hw, y, z - hd], [x + hw, top, z - hd], [x + hw, top, z + hd], shade(RIGHT))
    this.quad([x - hw, y, z - hd], [x - hw, y, z + hd], [x - hw, top, z + hd], [x - hw, top, z - hd], shade(LEFT))
    this.quad([x - hw, top, z + hd], [x + hw, top, z + hd], [x + hw, top, z - hd], [x - hw, top, z - hd], shade(UP))
  }

  /** A pitched roof over a mass, ridge running along x. */
  gable(x: number, y: number, z: number, width: number, depth: number, rise: number, base: number) {
    const hw = width / 2
    const hd = depth / 2
    const ridge = y + rise
    this.quad([x - hw, y, z + hd], [x + hw, y, z + hd], [x + hw, ridge, z], [x - hw, ridge, z], tone(base, SKYLIGHT + SUNLIGHT * .74))
    this.quad([x + hw, y, z - hd], [x - hw, y, z - hd], [x - hw, ridge, z], [x + hw, ridge, z], tone(base, SKYLIGHT + SUNLIGHT * .3))
    const end = tone(base, SKYLIGHT + SUNLIGHT * .5)
    this.triangle([x + hw, y, z + hd], [x + hw, y, z - hd], [x + hw, ridge, z], end)
    this.triangle([x - hw, y, z - hd], [x - hw, y, z + hd], [x - hw, ridge, z], end)
  }

  /** A pyramidal cap, for spires, campaniles and obelisks. */
  spire(x: number, y: number, z: number, width: number, rise: number, base: number) {
    const hw = width / 2
    const lit = tone(base, SKYLIGHT + SUNLIGHT * .8)
    const shaded = tone(base, SKYLIGHT + SUNLIGHT * .26)
    this.triangle([x - hw, y, z + hw], [x + hw, y, z + hw], [x, y + rise, z], lit)
    this.triangle([x + hw, y, z - hw], [x - hw, y, z - hw], [x, y + rise, z], shaded)
    this.triangle([x + hw, y, z + hw], [x + hw, y, z - hw], [x, y + rise, z], lit)
    this.triangle([x - hw, y, z - hw], [x - hw, y, z + hw], [x, y + rise, z], shaded)
  }

  /**
   * A dome, as gores in three latitude bands.
   *
   * One band is a cone, and a cone is what the first version of this drew: a
   * hard straight silhouette running to a point, which on a civic building the
   * whole composition is aimed at reads as a marquee. Three bands is the least
   * that gives the profile a shoulder, and the cost is forty triangles on the
   * one form these regions cannot do without.
   */
  dome(x: number, y: number, z: number, radius: number, height: number, base: number, gores = 8) {
    const bands = 3
    // Circular profile rather than linear, so the shoulder sits where a dome's
    // does: wide most of the way up and turning over quickly near the crown.
    const ring = (index: number) => {
      const t = index / bands
      return { r: radius * Math.cos(t * Math.PI / 2), y: y + height * Math.sin(t * Math.PI / 2) }
    }
    for (let band = 0; band < bands; band += 1) {
      const lower = ring(band)
      const upper = ring(band + 1)
      for (let index = 0; index < gores; index += 1) {
        const from = (index / gores) * Math.PI * 2
        const to = ((index + 1) / gores) * Math.PI * 2
        const centre = (from + to) / 2
        // The band's own inclination tilts its normal toward the sky, so the
        // crown catches more sun than the haunches on the same side.
        const tilt = (band + .5) / bands
        const normalY = Math.sin(tilt * Math.PI / 2)
        const normalR = Math.cos(tilt * Math.PI / 2)
        const lambert = Math.max(0, (Math.cos(centre) * SUN.x + Math.sin(centre) * SUN.z) * normalR + SUN.y * normalY)
        const colour = tone(base, SKYLIGHT + SUNLIGHT * lambert)
        if (band === bands - 1) {
          this.triangle(
            [x + Math.cos(from) * lower.r, lower.y, z + Math.sin(from) * lower.r],
            [x + Math.cos(to) * lower.r, lower.y, z + Math.sin(to) * lower.r],
            [x, y + height, z],
            colour,
          )
          continue
        }
        this.quad(
          [x + Math.cos(from) * lower.r, lower.y, z + Math.sin(from) * lower.r],
          [x + Math.cos(to) * lower.r, lower.y, z + Math.sin(to) * lower.r],
          [x + Math.cos(to) * upper.r, upper.y, z + Math.sin(to) * upper.r],
          [x + Math.cos(from) * upper.r, upper.y, z + Math.sin(from) * upper.r],
          colour,
        )
      }
    }
  }

  /** A flat card facing the window, for shapes only ever seen head-on. */
  plate(x: number, y: number, z: number, width: number, height: number, colour: THREE.Color) {
    const hw = width / 2
    this.quad([x - hw, y, z], [x + hw, y, z], [x + hw, y + height, z], [x - hw, y + height, z], colour)
  }

  /** A horizontal panel of ground, water, paving or roof. */
  panel(x0: number, x1: number, z0: number, z1: number, y: number, near: THREE.Color, far: THREE.Color) {
    this.gradedQuad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], near, far)
  }

  build(material: THREE.Material) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colour, 3))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = false
    mesh.receiveShadow = false
    // Nothing out here is pickable, draggable or navigable, and the office's
    // hover picking and furniture drag both walk the graph looking for exactly
    // those flags.
    mesh.userData.navIgnore = true
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    return mesh
  }
}

type Point = [number, number, number]

export type OfficeWindowView = {
  root: THREE.Group
  region: OfficeWindowRegion
  /** Colour the room's window spill should take, so inside agrees with out. */
  daylight: number
  daylightStrength: number
  /**
   * Where the sun stands, in the room's own axes.
   *
   * The view is built around a fixed `SUN` and then yawed onto the sightline,
   * so the direction the district is lit from is only knowable here. The room
   * needs it because its own key has to agree: with the sun up and to the
   * viewer's right outside, every lit flank in the window faces right, and a
   * key that rakes the room from the left puts the two halves of one picture
   * under two different afternoons. Nobody names that and everybody sees it.
   */
  sunDirection: THREE.Vector3
  update: (elapsed: number) => void
  triangles: number
  meshes: number
}

type Mover = {
  object: THREE.Object3D
  from: number
  to: number
  speed: number
  restY: number
  /** Vertical bob, for anything afloat. */
  bob: number
}

const NEAR_EDGE = 2.4
/** How far out anything built stands. Nothing is modelled beyond this. */
const FAR_EDGE = 76
const SKY_DEPTH = 78
/**
 * How far the ground plane itself runs, which is much further than that.
 *
 * The ground has to reach the horizon or the eye sees over its far edge, and
 * what is behind that edge is the sky quad's below-horizon part: a band of flat
 * haze sitting exactly where the middle distance should be. It is not subtle.
 * Ending the ground at the built edge of seventy-six metres left a nine-degree
 * wedge of it from a twelve-metre floor, which is close to half the ground in
 * frame, and it was the real reason the sea and the civic lawn came back as one
 * pale slab. Running the plane out to a quarter-kilometre closes the wedge to
 * under three degrees, and costs the ten triangles of one more grid row.
 */
const GROUND_EDGE = 260

/**
 * How much wider than the resting cone the view is built, in metres at the
 * glass, to survive the room being turned.
 *
 * The window swings out of frame long before the orbit is finished, so this does
 * not have to cover the full sweep — it has to cover the part of the sweep in
 * which the glass is still worth looking through.
 */
const ORBIT_SLACK = 2.2

export function buildOfficeWindowView({ tier, openingWidth, openingHeight, standoff = 7, lateralOffset = 4.6, verticalOffset = 1.6, storeyLift = 0 }: {
  tier: number
  openingWidth: number
  openingHeight: number
  /**
   * Extra metres of eye height, for a floor of the building above the one the
   * tier ladder describes. The chambers floor uses it, and it is the cheapest
   * honest cue that the lift went up: the street drops, the neighbours' roofs
   * come into the frame, and more of the window is sky.
   */
  storeyLift?: number
  /** How far back the viewer normally stands from the glass. */
  standoff?: number
  /**
   * How far to the side of the opening's centre the viewer stands.
   *
   * This is the number the first pass did not have, and it is the one that
   * decides which way the window looks. See `coverHalfWidth`.
   */
  lateralOffset?: number
  /** The same vertically, which only widens the cone and does not turn it. */
  verticalOffset?: number
}): OfficeWindowView {
  const region = officeWindowRegionFor(tier)
  const look = LOOKS[region]
  const eye = eyeHeightFor(tier) + storeyLift
  const grade = -eye
  const overStreet = eye > STREET_LEVEL

  const root = new THREE.Group()
  // The view is a fixture of the building, not something that animates. Its one
  // transform is the sightline yaw set below, applied once.
  root.matrixAutoUpdate = false

  /**
   * The view is turned to face the way the window is actually looked through.
   *
   * A window is not a picture the viewer stands square to. This office's camera
   * orbits a pivot in the middle of the room and the window is in the front-left
   * wall, so the eye sits about four metres to the *side* of the opening's
   * centre and seven back from it. The cone admitted by the glass is therefore
   * raked across the district by nearly thirty degrees, and it keeps raking: the
   * line of sight leaves the window centre and arrives, at the sky plane, forty
   * metres off the axis everything was built symmetrically about.
   *
   * The first pass built the district square to the wall and sized it as if the
   * eye were on the window's own axis, with a flat 1.4-metre margin "for the
   * camera's own lateral travel". Both halves of that are wrong in the same way:
   * the offset is not a margin at the glass, it is an angle. What the window
   * showed was the far left edge of the scene and then, past it, nothing at all
   * — a flat dark pane where the sky should be, which is what a window with no
   * world behind it looks like.
   *
   * Turning the whole view onto the sightline fixes both at once. The district
   * is then symmetric about the axis it is actually seen down, so a composition
   * centred in the authoring is centred in the frame; the eye is on that axis,
   * so the coverage is the plain cone again, with a slack term for how far the
   * room can be orbited before the window leaves the frame anyway. It also puts
   * the masses at three-quarters rather than dead-on, so their side faces do
   * some work.
   */
  root.rotation.y = Math.atan2(lateralOffset, standoff)
  // Along the sightline, not along the wall's normal.
  const eyeDistance = Math.hypot(lateralOffset, standoff)
  const coverHalfWidth = (distance: number) => {
    const reach = (distance + eyeDistance) / eyeDistance
    return (openingWidth / 2 + .6) * reach + ORBIT_SLACK * (reach - 1)
  }
  const coverHalfHeight = (distance: number) => {
    const reach = (distance + eyeDistance) / eyeDistance
    return (openingHeight / 2 + .6) * reach + verticalOffset * (reach - 1)
  }

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // Outside is not in the room's fog and is not lit by the room's lamps.
    fog: false,
    // These faces are emitted by hand, and one mis-wound face in a backdrop is
    // a hole in the world. Culling saves nothing measurable on a thousand
    // triangles that cover a tenth of the screen.
    side: THREE.DoubleSide,
  })

  // Each band hazes over the range it actually occupies, so the gradient is
  // resolved where that band's own depth cues live rather than being a slice
  // of one global ramp.
  //
  // The ranges reach well past anything that is built, and deliberately. An
  // earlier pass had the near band fading from twelve metres to forty-eight,
  // which put the far bank of the canal at thirty metres nearly half way to flat
  // grey — and at thirty metres real air has done nothing at all. Every facade in
  // the view lost its brick and the whole thing read as a fogged pane rather
  // than as distance. Ending the ramps out past the horizon leaves the built
  // range using only the first, gentlest part of the curve, which is the part
  // that is true.
  const sky = new Sheet(look, SKY_DEPTH, SKY_DEPTH + 1, 0)
  const ground = new Sheet(look, 8, GROUND_EDGE * .72, look.groundHaze)
  const far = new Sheet(look, 34, 96)
  const mid = new Sheet(look, 30, 108)
  const close = new Sheet(look, 26, 120)
  const movers: Mover[] = []

  // Which sheet a mass ended up on, in flat primaries. An aerial perspective is
  // a set of distance bands, and "this thing is hazed wrong" is almost always
  // "this thing is on the wrong band" — a question no amount of squinting at the
  // finished picture answers. Gated the way the room's other inspection
  // overrides are, so it is compiled out of production builds.
  if (import.meta.env.DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('officeWindowDebugSheets') === '1') {
    sky.debugColour = [1, 0, 1]
    ground.debugColour = [1, 1, 0]
    far.debugColour = [1, 0, 0]
    mid.debugColour = [0, 1, 0]
    close.debugColour = [0, 0, 1]
  }

  buildSky(sky, look, coverHalfWidth(SKY_DEPTH), coverHalfHeight(SKY_DEPTH))
  buildGround(ground, look, region, grade, coverHalfWidth)

  const context: RegionContext = {
    look, region, tier, grade, overStreet, coverHalfWidth,
    mover: (options, paint) => addMover(root, material, movers, look, options, paint),
  }
  if (region === 'city') buildOldQuarter(far, mid, close, context)
  else if (region === 'nation') buildCircuit(far, mid, close, context)
  else if (region === 'ocean') buildTreatySea(far, mid, close, context)
  else if (region === 'continent') buildSovereignArc(far, mid, close, context)
  else buildGlobalCompact(far, mid, close, context)

  // From above the street the immediate foreground is the firm's own building:
  // the roof of the storey below, its parapet, and its plant. It anchors the
  // view at exactly the tiers where the ground has dropped out of the frame.
  if (overStreet) buildOwnSetback(close, look, coverHalfWidth)

  let triangles = 0
  for (const sheet of [sky, ground, far, mid, close]) {
    if (sheet.triangles === 0) continue
    triangles += sheet.triangles
    root.add(sheet.build(material))
  }
  for (const mover of movers) triangles += (mover.object.userData.triangles as number) ?? 0
  root.updateMatrix()

  const update = (elapsed: number) => {
    for (const mover of movers) {
      const span = mover.to - mover.from
      mover.object.position.x = mover.from + (((elapsed * mover.speed) % span) + span) % span
      if (mover.bob) mover.object.position.y = mover.restY + Math.sin(elapsed * .7 + mover.from) * mover.bob
      mover.object.updateMatrix()
    }
  }
  update(0)

  return {
    root,
    region,
    daylight: look.daylight,
    daylightStrength: look.daylightStrength,
    // The yaw is the only transform between this view's axes and the room's,
    // so rotating the authored sun by it is the whole conversion.
    sunDirection: SUN.clone().applyAxisAngle(UP, root.rotation.y),
    update,
    triangles,
    meshes: root.children.length,
  }
}

type MoverOptions = { y: number; z: number; from: number; to: number; speed: number; bob?: number }

type RegionContext = {
  look: RegionLook
  region: OfficeWindowRegion
  tier: number
  /** Exterior ground level, relative to the middle of the window. */
  grade: number
  /** True once the sightline clears the roofs opposite. */
  overStreet: boolean
  coverHalfWidth: (distance: number) => number
  mover: (options: MoverOptions, paint: (sheet: Sheet) => void) => void
}

function addMover(
  root: THREE.Group,
  material: THREE.Material,
  movers: Mover[],
  look: RegionLook,
  options: MoverOptions,
  paint: (sheet: Sheet) => void,
) {
  const sheet = new Sheet(look, NEAR_EDGE, FAR_EDGE)
  paint(sheet)
  if (sheet.triangles === 0) return
  const mesh = sheet.build(material)
  mesh.userData.triangles = sheet.triangles
  mesh.position.set(options.from, options.y, options.z)
  mesh.updateMatrix()
  root.add(mesh)
  movers.push({ object: mesh, from: options.from, to: options.to, speed: options.speed, restY: options.y, bob: options.bob ?? 0 })
}

/**
 * The sky, as graded bands plus whatever hangs in it.
 *
 * Banded rather than smooth on purpose. The composite quantises everything
 * anyway, and authoring the steps means they land where the painting wants them
 * instead of wherever the posteriser happens to put them. The lowest band is
 * exactly the haze colour, which is what lets the ground plane's far edge
 * disappear into the horizon instead of ending on a visible lip.
 */
function buildSky(sheet: Sheet, look: RegionLook, halfWidth: number, halfHeight: number) {
  const bands = 6
  // Reaching well below the horizon costs two triangles and covers the sliver
  // of sky under the ground plane's far edge that a high floor can see past.
  const bottom = -halfHeight * 1.2
  const top = halfHeight * 1.2
  for (let index = 0; index < bands; index += 1) {
    const y0 = bottom + (top - bottom) * (index / bands)
    const y1 = bottom + (top - bottom) * ((index + 1) / bands)
    // Only the top half of the quad is sky proper; the part below the horizon
    // is there to be hidden, so the whole lower half stays at the haze value.
    const height = Math.max(0, (y0 + y1) / 2 / top)
    sheet.quad(
      [-halfWidth, y0, -SKY_DEPTH], [halfWidth, y0, -SKY_DEPTH],
      [halfWidth, y1, -SKY_DEPTH], [-halfWidth, y1, -SKY_DEPTH],
      tone(mixHex(look.haze, look.skyTop, Math.pow(height, .55)), 1),
    )
  }
  // Everything in the sky is drawn five centimetres in front of the bands and
  // nothing is drawn in front of that. The contour pass thresholds on depth
  // difference relative to distance, so at seventy-eight metres a five
  // centimetre step is three orders of magnitude below the edge threshold and
  // draws no line, while still clearing the depth buffer's precision there by
  // an order of magnitude. That is the whole trick: a cloud has to be a soft
  // shape with no ink around it, and the way to get that from a contour pass is
  // to give it nothing to contour.
  const plane = -SKY_DEPTH + .05

  if (look.night) {
    for (let index = 0; index < 30; index += 1) {
      const size = .3 + hash(index * 5.3) * .5
      sheet.plate(
        (hash(index * 3.1) - .5) * halfWidth * 1.8,
        halfHeight * hash(index * 7.7 + 2) * 1.1,
        plane, size, size,
        tone(0xdfe9f2, .45 + hash(index) * .55),
      )
    }
    return
  }

  // Kept low in the quad on purpose. The sky plane reaches far above what the
  // opening admits — it has to, so its own edge is never found — and clouds
  // scattered over the whole of it are clouds nobody sees. The band that is
  // actually in frame is the first fifth or so above the horizon.
  for (let index = 0; index < 6; index += 1) {
    cloud(
      sheet,
      (hash(index * 2.7) - .5) * halfWidth * 1.5,
      halfHeight * (.06 + hash(index * 4.1) * .34),
      plane,
      halfWidth * (.16 + hash(index * 6.3) * .2),
      look,
      index,
    )
  }
}

/**
 * One cumulus, as a flat-bottomed run of overlapping lobes.
 *
 * All of it is coplanar, so the lobes leave no seams between themselves and the
 * silhouette carries no ink. What separates the cloud from the sky is value
 * alone, which is how a cloud is painted anyway: a bright top, a cooler shaded
 * base picked out of the horizon colour, and a base line straight enough to
 * say the whole shelf is sitting at one altitude.
 */
function cloud(sheet: Sheet, x: number, y: number, z: number, width: number, look: RegionLook, seed: number) {
  const base = tone(mixHex(look.haze, 0xe9e2d2, .5), 1)
  const crown = tone(0xfaf3e2, .96)
  const lobes = 3 + Math.floor(hash(seed * 9.7) * 3)
  const step = width / lobes
  const floorY = y

  // The shaded underside first, as one low slab the lobes sit on.
  sheet.quad(
    [x - width / 2, floorY, z], [x + width / 2, floorY, z],
    [x + width / 2 * .88, floorY + step * .3, z], [x - width / 2 * .86, floorY + step * .3, z],
    base,
  )
  for (let index = 0; index < lobes; index += 1) {
    const lobeX = x - width / 2 + step * (index + .5)
    // The tallest lobe sits off-centre; a symmetric cloud reads as a logo.
    const rise = step * (.55 + hash(seed * 3.1 + index * 5.9) * .95)
    const half = step * (.62 + hash(seed * 7.3 + index) * .3)
    sheet.quad(
      [lobeX - half, floorY + step * .2, z], [lobeX + half, floorY + step * .2, z],
      [lobeX + half * .5, floorY + rise, z], [lobeX - half * .5, floorY + rise, z],
      crown,
    )
    sheet.triangle([lobeX - half, floorY + step * .2, z], [lobeX - half * .5, floorY + rise, z], [lobeX - half * 1.05, floorY + step * .5, z], crown)
    sheet.triangle([lobeX + half, floorY + step * .2, z], [lobeX + half * 1.05, floorY + step * .5, z], [lobeX + half * .5, floorY + rise, z], crown)
  }
}

/**
 * The ground, as a grid of panels running away to the horizon.
 *
 * Rows are spaced on a power curve, so the near ones are short and the far ones
 * long — which is what perspective does anyway, and it puts the resolution
 * where the haze gradient changes fastest. Each region tints the grid itself,
 * so field patchwork, a paved quarter and open water are the same twenty lines
 * of geometry with a different tint function.
 */
function buildGround(
  sheet: Sheet,
  look: RegionLook,
  region: OfficeWindowRegion,
  grade: number,
  coverHalfWidth: (distance: number) => number,
) {
  // The Circuit is the one region whose ground is the subject rather than the
  // floor, so it gets the cells to draw an enclosed landscape with.
  const rows = region === 'nation' ? 9 : 7
  // The Circuit needs cells to parcel the land into; the Sovereign Arc needs
  // them to keep its axis to the width of an avenue. On five columns the axis
  // was a fifth of the district wide, and a paved strip that wide converging to
  // the horizon reads as a wedge of light lying on the lawn.
  const columns = region === 'nation' || region === 'continent' ? 9 : 5
  const depthAt = (index: number) => NEAR_EDGE + (GROUND_EDGE - NEAR_EDGE) * Math.pow(index / rows, 2.6)
  const tint = groundTint(region, look)

  for (let row = 0; row < rows; row += 1) {
    const z0 = -depthAt(row)
    const z1 = -depthAt(row + 1)
    const halfNear = coverHalfWidth(-z0)
    const halfFar = coverHalfWidth(-z1)
    for (let column = 0; column < columns; column += 1) {
      const u0 = column / columns
      const u1 = (column + 1) / columns
      const seed = row * 31 + column * 7
      sheet.gradedQuad(
        [-halfNear + halfNear * 2 * u0, grade, z0],
        [-halfNear + halfNear * 2 * u1, grade, z0],
        [-halfFar + halfFar * 2 * u1, grade, z1],
        [-halfFar + halfFar * 2 * u0, grade, z1],
        tint((u0 + u1) / 2, row / rows, seed),
        tint((u0 + u1) / 2, (row + 1) / rows, seed),
      )
    }
  }
}

function groundTint(region: OfficeWindowRegion, look: RegionLook) {
  return (u: number, v: number, seed: number) => {
    if (region === 'nation') {
      // Enclosed fields: pasture, plough and stubble in irregular parcels, each
      // one flat. The patchwork says "open country" from a window faster than
      // any building in it could.
      const roll = hash(seed * 1.7)
      const base = roll < .38 ? 0x76875f : roll < .62 ? 0x8f8158 : roll < .82 ? 0x607554 : 0x9e9366
      return tone(base, .84 + hash(seed * 3.3) * .2)
    }
    if (region === 'ocean') {
      // Water lightens toward the horizon but stops well short of the sky. It
      // is mixed to its own sea-horizon colour rather than to the atmospheric
      // haze so that the two never meet, and a line survives between them.
      const wind = hash(Math.floor(v * 5) * 13.1 + Math.floor(u * 3) * 3.7)
      // Held well below the sky the whole way out. Water that lightens to the
      // sky's own value at the horizon is true of a hazy day and useless in a
      // painting: it leaves no horizon, and the horizon is the only thing that
      // tells the eye it is looking at a sea rather than at more sky.
      return tone(mixHex(look.ground, 0x6d868c, Math.pow(v, 1.6)), .72 + wind * .2)
    }
    if (region === 'continent') {
      // Lawn, with the ceremonial axis kept clear of it down the middle. The
      // paving is only a little lighter than the grass: an avenue reads by being
      // the one straight empty thing in the plan, not by being bright.
      return tone(Math.abs(u - .5) < .06 ? mixHex(0x6d7a5e, look.road, .6) : 0x6d7a5e, .9 + hash(seed * 2.1) * .12)
    }
    if (region === 'orbit') {
      return tone(look.ground, .72 + hash(seed * 1.9) * .3)
    }
    // The Old Quarter is roofs and yards more than it is ground; what shows
    // between the blocks is setted paving and soot-darkened slate.
    return tone(hash(seed * 2.9) > .55 ? look.road : mixHex(look.ground, look.stone, .35), .82 + hash(seed * 4.7) * .24)
  }
}

/**
 * The roof of the storey below this one.
 *
 * Above the street the ground has left the frame entirely, and a view with no
 * foreground has no scale: distant masses float. This puts the firm's own
 * building back under the window — a setback roof, its parapet, and the plant
 * every large building carries — which is both what is actually there and the
 * cheapest possible thing to read depth against.
 */
function buildOwnSetback(sheet: Sheet, look: RegionLook, coverHalfWidth: (distance: number) => number) {
  const half = coverHalfWidth(5)
  // Deep enough below the sill to sit under the sightline rather than across
  // it. A setback that reaches the middle of the frame stops being a
  // foreground and becomes a floor, and the distance behind it disappears.
  const deck = -4.6
  const roof = mixHex(look.stone, 0x4c4a44, .62)
  const trim = mixHex(roof, 0x2e2c28, .34)
  sheet.panel(-half, half, -1.1, -7.4, deck, tone(roof, .92), tone(roof, .78))
  sheet.box(0, deck, -7.4, half * 2, .8, .5, trim)
  for (const side of [-1, 1]) sheet.box(side * half, deck, -4.2, .5, .8, 6.6, trim)
  sheet.box(-half * .48, deck, -5.6, 2.2, 1.3, 2, mixHex(roof, 0x6b6a62, .4))
  sheet.box(-half * .48, deck + 1.3, -5.6, 2.4, .18, 2.2, trim)
  sheet.box(half * .52, deck, -6.3, 1.5, .9, 1.5, mixHex(roof, 0x6b6a62, .4))
  sheet.box(half * .2, deck, -4.6, .42, 2.2, .42, mixHex(look.accent, 0x8d8a80, .5))
  // Duct runs and a lightning mast: the small horizontals are what stop a roof
  // deck from reading as an empty shelf.
  for (let index = 0; index < 3; index += 1) {
    sheet.box(-half * .1 + index * 1.4, deck + .35, -6.8, .28, .28, 2.4, mixHex(roof, 0x8f8d84, .3))
  }
  sheet.box(-half * .82, deck, -6.9, .16, 3.6, .16, trim)
}

// ---------------------------------------------------------------------------
// Old Quarter — brick terraces, the municipal rail, the canal
// ---------------------------------------------------------------------------

function buildOldQuarter(far: Sheet, mid: Sheet, close: Sheet, { look, tier, grade, overStreet, coverHalfWidth, mover }: RegionContext) {
  const brick = [0x8b5340, 0x77493a, 0x9a6149, 0x6a4337, 0x9c8064]

  // Far: the quarter running on to the ridge, with the courthouse dome and two
  // spires standing out of it. Cards rather than masses — nothing at fifty
  // metres turns far enough for a side face to earn its triangles.
  const farHalf = coverHalfWidth(50) * .95
  const farBlocks = spanCount(farHalf * 2, 2.7)
  for (let index = 0; index < farBlocks; index += 1) {
    const x = -farHalf + (index + hash(index * 3.1) * .7) * (farHalf * 2 / farBlocks)
    far.plate(
      x, grade, -50 - hash(index * 7.9) * 7,
      farHalf * 2 / farBlocks * (1.1 + hash(index * 2.3) * .5),
      7 + hash(index * 5.7) * 10 + tier * .5,
      tone(mixHex(look.stone, brick[index % brick.length], .42), .98),
    )
  }
  far.box(-farHalf * .34, grade, -47, 12, 14, 9, look.stone, .98)
  far.dome(-farHalf * .34, grade + 14, -47, 5.6, 5, mixHex(look.roof, 0x8d9296, .55))
  for (const spire of [farHalf * .24, farHalf * .6]) {
    const height = 18 + hash(spire) * 7
    far.box(spire, grade, -44, 3.4, height, 3.4, look.stone, .96)
    far.spire(spire, grade + height, -44, 3.8, 8, mixHex(look.roof, 0x59606a, .55))
  }

  // Middle: the block opposite and the streets behind it, as real masses so the
  // roofs read against one another rather than as one flat frieze. From inside
  // the street none of it is visible past the terrace on the far bank, and the
  // viaduct would be standing in the water, so it is the elevated view's.
  const midHalf = coverHalfWidth(24) * .92
  if (!overStreet) {
    buildOldQuarterBank(close, look, brick, grade, coverHalfWidth, mover)
    return
  }
  const midBlocks = spanCount(midHalf * 2, 2.3)
  for (let index = 0; index < midBlocks; index += 1) {
    const x = -midHalf + (index + .5) * (midHalf * 2 / midBlocks) + (hash(index * 4.3) - .5) * 1.4
    const z = -20 - hash(index * 6.1) * 12
    const height = 6 + hash(index * 8.3) * 7
    const width = midHalf * 2 / midBlocks * (.86 + hash(index * 2.9) * .34)
    const depth = 6 + hash(index) * 4
    mid.box(x, grade, z, width, height, depth, brick[index % brick.length])
    mid.gable(x, grade + height, z, width * 1.06, depth, 1.5 + hash(index * 9.1) * .9, look.roof)
    // Stacks. The one silhouette detail that makes a brick roofline read as a
    // brick roofline rather than a row of wedges.
    if (hash(index * 11.3) > .32) {
      mid.box(x + (hash(index * 13.7) - .5) * width * .5, grade + height + 1.4, z, .5, 1.6, .5, 0x634134)
    }
  }

  // The municipal rail, on its viaduct, crossing behind the block.
  const railY = grade + 6.5
  const viaductZ = -16.5
  mid.box(0, railY, viaductZ, midHalf * 2.4, 1.6, 2.8, mixHex(look.stone, 0x4f453c, .45))
  const piers = spanCount(midHalf * 2.2, 5.4, 4)
  for (let index = 0; index <= piers; index += 1) {
    mid.box(-midHalf * 1.1 + index * (midHalf * 2.2 / piers), grade, viaductZ, 1.8, railY - grade, 2.3, mixHex(look.stone, 0x4f453c, .3))
  }
  mover({ y: railY + 1.6, z: viaductZ, from: -midHalf * 1.35, to: midHalf * 1.35, speed: 1.2 }, (sheet) => {
    for (let carriage = 0; carriage < 4; carriage += 1) {
      sheet.box(carriage * 3.5, 0, 0, 3.1, 1.5, 1.8, carriage === 0 ? 0x3e5058 : 0x77593f)
      sheet.plate(carriage * 3.5, .55, .95, 2.4, .6, tone(0xf1dfae, .95))
    }
  })

}

/**
 * The Old Quarter from inside it: the basin, the far bank, the terrace on it.
 *
 * From inside the street the subject is not the skyline. A window at this
 * height has an upward cone of about ten degrees, so a terrace on the far bank
 * either sits far enough back to show its roofline or fills the frame with
 * undifferentiated wall. The basin is what buys that distance: water takes the
 * near half of the view, the far bank is a good twenty metres off, and the
 * roofs still clear the head of the window.
 */
function buildOldQuarterBank(
  close: Sheet,
  look: RegionLook,
  brick: number[],
  grade: number,
  coverHalfWidth: (distance: number) => number,
  mover: RegionContext['mover'],
) {
  // Thirty metres of water is what it takes to get the far roofline back under
  // the head of the window. At twenty the terrace filled the frame edge to edge
  // with wall and the view had no sky in it at all, which is honest for a dense
  // quarter and unreadable as a picture. A turning basin is the excuse, and it
  // is the right one: this is where the barges wind.
  const bankZ = -30
  const nearHalf = coverHalfWidth(20)
  close.panel(-nearHalf, nearHalf, -4.6, bankZ + .8, grade + .35, tone(0x2b4948, 1), tone(0x365658, 1))
  close.box(0, grade + .35, -4.2, nearHalf * 2, 1.1, 1.3, mixHex(look.stone, 0x5b5044, .5))
  close.box(0, grade + .35, bankZ + 1.4, nearHalf * 2, 1.3, 1.6, mixHex(look.stone, 0x554c40, .5))

  const bays = spanCount(nearHalf * 2, 2.2)
  const bayWidth = nearHalf * 2 / bays
  for (let index = 0; index < bays; index += 1) {
    const x = -nearHalf + (index + .5) * bayWidth
    const storeys = 2 + Math.floor(hash(index * 5.3) * 1.6)
    const height = 2.6 + storeys * 2.4
    const face = brick[index % brick.length]
    // Each plot steps a little out of line with its neighbours. Coplanar bays
    // give the contour pass no depth difference to find and the whole terrace
    // comes back as one silhouette filled with flat colour; half a metre of
    // build line is enough to put an ink edge between every house.
    const step = (hash(index * 17.3) - .5) * 1.1
    const front = bankZ + step + 2.2
    close.box(x, grade + 1.3, bankZ + step, bayWidth * 1.02, height, 4.4, face)
    close.gable(x, grade + 1.3 + height, bankZ + step, bayWidth * 1.1, 4.4, 1.3 + hash(index * 2.7) * .7, look.roof)
    close.box(x + bayWidth * (hash(index * 8.1) - .5) * .6, grade + 2.6 + height, bankZ + step, .5, 1.6, .5, mixHex(face, 0x2b211c, .5))
    for (let storey = 0; storey < storeys; storey += 1) {
      for (let column = 0; column < 2; column += 1) {
        const wx = x - bayWidth * .24 + column * bayWidth * .48
        const wy = grade + 2.9 + storey * 2.4
        // Glass out of the sun is darker than any brick, and that contrast is
        // the whole reason a masonry facade reads as masonry at this distance.
        const glass = hash(index * 31 + storey * 7 + column) > .82 ? 0x9a8a63 : 0x1c2027
        close.plate(wx, wy, front + .03, .62, 1.3, tone(glass, 1))
        close.plate(wx, wy + 1.3, front + .04, .78, .15, tone(mixHex(look.stone, 0xd8cdb4, .5), .9))
      }
    }
    // Ground floors are trade: a dark doorway, and over about half of them the
    // deeper reveal of a shopfront under an awning.
    close.plate(x + bayWidth * .16, grade + 1.3, front + .03, .7, 1.9, tone(0x2a2018, 1))
    if (hash(index * 3.9) > .45) {
      close.plate(x - bayWidth * .2, grade + 1.5, front + .03, bayWidth * .42, 1.7, tone(0x232a2c, 1))
      close.box(x - bayWidth * .2, grade + 3.2, front + .3, bayWidth * .5, .14, .8, mixHex(look.accent, 0x8d5b3c, .4))
    }
  }

  // A footbridge over the basin, off to one side. One arch crossing the water
  // is what tells the eye the far bank is reachable and how wide the cut is.
  const bridgeX = -nearHalf * .58
  for (let index = 0; index < 6; index += 1) {
    const t = index / 5
    const z = -6.5 + (bankZ + 2 + 6.5) * t
    const rise = Math.sin(t * Math.PI) * 1.5
    close.box(bridgeX, grade + 1.4 + rise, z, 2.2, .3, Math.abs(bankZ + 8.5) / 5 + .4, mixHex(look.stone, 0x6e6455, .45))
    close.box(bridgeX - 1, grade + 1.7 + rise, z, .16, .8, .2, mixHex(look.stone, 0x574e42, .5))
    close.box(bridgeX + 1, grade + 1.7 + rise, z, .16, .8, .2, mixHex(look.stone, 0x574e42, .5))
  }

  mover({ y: grade + .5, z: -11, from: -nearHalf, to: nearHalf, speed: .5, bob: .05 }, (sheet) => {
    sheet.box(0, 0, 0, 5.4, .8, 1.8, 0x54422f)
    sheet.box(-1.5, .8, 0, 1.7, .95, 1.5, 0x435c57)
    sheet.plate(1.4, .8, .95, 2.6, .4, tone(0x9a8459, .95))
  })
  // Moored craft along the far bank, bollards on the near one, and two trees:
  // things at a known size, which is the only way the rest of it gets a scale.
  for (let index = 0; index < 3; index += 1) {
    const x = -nearHalf * .5 + index * (nearHalf * .55)
    close.box(x, grade + .45, bankZ + 3.4, 4.6 + hash(index) * 2, .75, 1.6, index % 2 ? 0x4c4032 : 0x3f4b4a)
    close.box(x - 1.2, grade + 1.2, bankZ + 3.4, 1.5, .8, 1.3, 0x435c57)
  }
  const bollards = spanCount(nearHalf * 1.6, 5.5, 4)
  for (let index = 0; index <= bollards; index += 1) {
    close.box(-nearHalf * .8 + index * (nearHalf * 1.6 / bollards), grade + 1.45, -4.2, .34, .9, .34, 0x454f4e)
  }
  for (const side of [-1, 1]) {
    close.box(side * nearHalf * .34, grade + 1.65, bankZ + 2.6, .3, 2.4, .3, 0x53412f)
    close.box(side * nearHalf * .34, grade + 4.05, bankZ + 2.6, 2.6, 2.7, 2.2, 0x3a5533)
  }
}

// ---------------------------------------------------------------------------
// The Circuit — the turnpike, enclosed fields, a market town on the ridge
// ---------------------------------------------------------------------------

function buildCircuit(far: Sheet, mid: Sheet, close: Sheet, { look, grade, overStreet, coverHalfWidth, mover }: RegionContext) {
  const wall = [0xb6a684, 0x998e70, 0xbdae90, 0x877c60]
  const roadHalf = 3.4
  // The alignment the map surveys this road on: long tangents joined by one
  // gentle easement, not a lane that changes direction every eighty metres.
  const drift = (t: number) => Math.sin(t * 1.25) * 5

  // Far: two ranges of low hills, and the market town in the gap between them,
  // on the road. A landform at sixty metres is a profile and nothing else.
  const farHalf = coverHalfWidth(58)
  // Hills are sized as a fraction of the frame rather than in metres: a range on
  // the horizon is read as a proportion of the view, not against a ruler.
  const ranges = spanCount(farHalf * 2, farHalf * .34, 5)
  for (let index = 0; index <= ranges; index += 1) {
    const x = -farHalf + index * (farHalf * 2 / ranges) + (hash(index * 3.7) - .5) * farHalf * .18
    const width = farHalf * (.28 + hash(index * 5.1) * .24)
    far.triangle(
      [x - width, grade, -58], [x + width, grade, -58], [x, grade + 5 + hash(index * 2.9) * 8, -58],
      tone(mixHex(look.ground, 0x8fa07c, .35), .95),
    )
  }
  const townX = drift(1) * .9
  far.box(townX, grade, -44, 3.2, 7.5, 3.2, look.stone, .97)
  far.box(townX, grade + 7.5, -44, 3.6, 1, 3.6, mixHex(look.stone, 0x585245, .5), .97)
  far.spire(townX, grade + 8.5, -44, 3.2, 5.5, mixHex(look.roof, 0x5d636a, .72))
  for (let index = 0; index < 7; index += 1) {
    const x = townX - farHalf * .26 + index * (farHalf * .52 / 6) + (hash(index * 7.3) - .5) * 2
    const z = -45 - hash(index) * 4
    const height = 2.8 + hash(index * 4.1) * 1.8
    far.box(x, grade, z, 2.6, height, 2.6, wall[index % wall.length], .97)
    far.gable(x, grade + height, z, 2.9, 2.6, 1, look.roof)
  }

  // The turnpike itself, running out from under the window to the town.
  const stations = 8
  for (let index = 0; index < stations; index += 1) {
    const t0 = index / stations
    const t1 = (index + 1) / stations
    const z0 = -(NEAR_EDGE + (52 - NEAR_EDGE) * Math.pow(t0, 1.7))
    const z1 = -(NEAR_EDGE + (52 - NEAR_EDGE) * Math.pow(t1, 1.7))
    const w0 = roadHalf * (1 - t0 * .5)
    const w1 = roadHalf * (1 - t1 * .5)
    mid.gradedQuad(
      [drift(t0) - w0, grade + .06, z0], [drift(t0) + w0, grade + .06, z0],
      [drift(t1) + w1, grade + .06, z1], [drift(t1) - w1, grade + .06, z1],
      tone(look.road, .96), tone(look.road, .9),
    )
    // Hedged verges. On open country the hedge line is what actually draws the
    // road; the metalling itself is barely a different colour from the stubble.
    const span = Math.abs(z1 - z0)
    mid.box(drift(t0) - w0 - .7, grade, (z0 + z1) / 2, .8, 1.2 + hash(index) * .4, span, 0x4a6642)
    mid.box(drift(t0) + w0 + .7, grade, (z0 + z1) / 2, .8, 1.2 + hash(index * 2.3) * .4, span, 0x445e3e)
  }
  mover({ y: grade, z: -26, from: -5, to: 9, speed: .25 }, (sheet) => {
    sheet.box(0, 0, 0, 1.6, .95, 2.5, 0x64492f)
    sheet.box(0, .95, -.5, 1.5, .85, 1.3, 0x9b9169)
  })

  // Enclosure. The patchwork in the ground tint says the land is parcelled;
  // the hedges are what make the parcels objects, and from any height above the
  // road they are the single strongest read of "enclosed country" available —
  // they catch the light on one side, cast the eye along the field boundaries,
  // and cost one box each.
  const fieldHalf = coverHalfWidth(46)
  for (let index = 0; index < 4; index += 1) {
    const z = -(22 + index * 13)
    const half = coverHalfWidth(-z) * .96
    mid.box(0, grade, z, half * 2, 1.2 + hash(index * 5.3) * .5, .7, index % 2 ? 0x44603c : 0x3d5738)
  }
  for (let index = 0; index < 5; index += 1) {
    const x = (index - 2) * fieldHalf * .42 + (hash(index * 7.1) - .5) * 3
    if (Math.abs(x) < roadHalf + 3) continue
    mid.box(x, grade, -40, .7, 1.3, 52, index % 2 ? 0x415c3a : 0x496542)
  }
  // Hedgerow trees, standing in the boundaries rather than scattered over the
  // fields, which is where a hedgerow tree actually stands.
  for (let index = 0; index < 4; index += 1) {
    const x = (index % 2 ? 1 : -1) * fieldHalf * (.22 + hash(index * 9.1) * .5)
    const z = -(20 + hash(index * 4.7) * 26)
    const trunk = 2.4 + hash(index) * 1.4
    mid.box(x, grade, z, .55, trunk, .55, 0x54432f)
    mid.box(x, grade + trunk, z, 3.4 + hash(index * 2.2), 3.6, 3.2, 0x466439)
  }

  // Middle: the village strung along the road, and a farmstead in the fields. A
  // rural street is a row with gaps in it. It sits out at twenty-five metres
  // and beyond because from a first-floor window nearer than that is under the
  // sill, and the earlier pass put it at eight, where it piled into itself.
  const midHalf = coverHalfWidth(30)
  for (let index = 0; index < 6; index += 1) {
    const along = 26 + index * 6.2
    const x = (index % 2 ? 1 : -1) * (roadHalf + 3.4 + hash(index * 5.9) * 2.5) + drift(along / 46)
    const height = 3.4 + hash(index * 3.1) * 1.8
    mid.box(x, grade, -along, 4, height, 3.6, wall[index % wall.length])
    // Thatch on the timber cottages, clay pantile on the rendered ones: the
    // pale, broken roofline is most of what makes a country street read light.
    mid.gable(x, grade + height, -along, 4.3, 3.6, 1.7 + hash(index * 8.7) * .5, hash(index * 6.3) > .5 ? 0xb49c63 : 0x8d5638)
    mid.box(x + 1.2, grade + height + 1.7, -along, .42, 1.2, .42, 0x74604c)
  }
  mid.box(-midHalf * .58, grade, -37, 8, 4.8, 5.4, 0x9c9268)
  mid.gable(-midHalf * .58, grade + 4.8, -37, 8.3, 5.4, 2.3, 0xb49c63)
  mid.box(-midHalf * .58 + 6.5, grade, -39, 4.4, 3.2, 4.4, 0x877c60)
  mid.gable(-midHalf * .58 + 6.5, grade + 3.2, -39, 4.7, 4.4, 1.5, 0x8d5638)

  if (overStreet) return
  // Near: the verge under the window, a milestone, and the hedge the road runs
  // out of. From the National Firm's floor the sightline is already over it.
  close.box(0, grade, -5, coverHalfWidth(5) * 2, 1.4, .9, 0x476040)
  close.box(-roadHalf - 1.2, grade + 1.4, -5.8, .36, .85, .3, look.stone)
}

// ---------------------------------------------------------------------------
// Treaty Sea — the diplomatic harbour, working quays, open water
// ---------------------------------------------------------------------------

function buildTreatySea(far: Sheet, mid: Sheet, close: Sheet, { look, tier, grade, coverHalfWidth, mover }: RegionContext) {
  const sea = grade + .25

  // Far: the opposite shore as a low bar, an island, and the harbour light on
  // its mole. Almost entirely haze; it is there to give the water an end.
  const farHalf = coverHalfWidth(62)
  far.plate(0, sea, -62, farHalf * 2.1, 4.2, tone(mixHex(look.stone, 0x7d8c80, .45), 1))
  // A far shore is a profile with a town on part of it, not a ruled line. The
  // silhouette breaking twice is what stops the horizon reading as a seam
  // between two flat colours.
  far.triangle([-farHalf * .78, sea, -58], [-farHalf * .28, sea, -58], [-farHalf * .53, sea + 7, -58], tone(mixHex(look.ground, 0x74856f, .4), 1))
  far.triangle([farHalf * .1, sea, -60], [farHalf * .78, sea, -60], [farHalf * .44, sea + 4.5, -60], tone(mixHex(look.ground, 0x6e7f6c, .3), 1))
  const farTown = spanCount(farHalf * .63, farHalf * .07, 6)
  for (let index = 0; index < farTown; index += 1) {
    const x = -farHalf * .2 + index * (farHalf * .07)
    far.plate(x, sea + 1.6, -57, farHalf * .06, 1.4 + hash(index * 4.3) * 2.4, tone(mixHex(look.stone, 0xaba38d, .45), 1))
  }
  far.box(farHalf * .5, sea, -54, 1.8, 8, 1.8, mixHex(look.stone, 0xc4bda8, .5), 1.04)
  far.box(farHalf * .5, sea + 8, -54, 2.4, 1.2, 2.4, 0x9c463a, 1.06)

  // Middle: the quays. A mole reaching out to the left with warehouses and
  // cranes on it, the embassy terrace facing the water on the right, and
  // shipping moored between them.
  // The mole and the quay furniture are laid out along the mole's own length
  // rather than at fractions of the frame, so widening the frame lengthens the
  // working harbour instead of pulling five warehouses apart into five sheds
  // standing on their own in the water.
  const midHalf = coverHalfWidth(24)
  const moleLength = midHalf * 1.1
  const moleCentre = -midHalf * .62
  mid.box(moleCentre, sea, -25, moleLength, 1.7, 17, mixHex(look.stone, 0x645f57, .45))
  const sheds = spanCount(moleLength * .82, 7.5, 4)
  for (let index = 0; index < sheds; index += 1) {
    const x = moleCentre - moleLength * .41 + (index + .5) * (moleLength * .82 / sheds)
    const z = -23 - hash(index) * 8
    const height = 4.2 + hash(index * 3.3) * 3
    mid.box(x, sea + 1.7, z, 6, height, 6, mixHex(look.stone, 0x8a7c66, .5))
    mid.gable(x, sea + 1.7 + height, z, 6.3, 6, 1.2, look.roof)
  }
  const cranes = spanCount(moleLength * .7, 11, 3)
  for (let index = 0; index < cranes; index += 1) {
    const x = moleCentre - moleLength * .35 + (index + .5) * (moleLength * .7 / cranes)
    mid.box(x, sea + 1.7, -18, .55, 9.5 + index, .55, 0x8a6642)
    mid.box(x + 1.7, sea + 10.5 + index, -18, 4.4, .5, .5, 0x8a6642)
  }
  // The embassy row: formal, stone, colonnaded, facing the water. Prestige is
  // the axis that grows with tier here, not height.
  const embassyX = midHalf * .56
  const embassyHeight = 5.5 + (tier - 7) * .9
  // Sized off the frame, because a terrace whose job is to hold one whole side
  // of the composition has to be as long as that side is.
  const embassyWidth = Math.max(14, midHalf * .62)
  mid.box(embassyX, sea, -24, embassyWidth + 1, 1.5, 10, mixHex(look.stone, 0xb0a894, .4))
  mid.box(embassyX, sea + 1.5, -25.5, embassyWidth, embassyHeight, 7, mixHex(look.stone, 0xbdb5a0, .45))
  const columns = spanCount(embassyWidth * .8, 1.7, 6)
  for (let index = 0; index < columns; index += 1) {
    mid.box(embassyX - embassyWidth * .4 + (index + .5) * (embassyWidth * .8 / columns), sea + 1.5, -21.8, .58, embassyHeight - .4, .58, mixHex(look.stone, 0xcdc4ab, .5))
  }
  mid.box(embassyX, sea + 1.5 + embassyHeight, -25.5, embassyWidth + 1, .9, 7.6, mixHex(look.stone, 0x8e8672, .5))
  for (let index = 0; index < Math.min(4, tier - 5); index += 1) {
    mid.box(embassyX - 4 + index * 2.7, sea + 2.4 + embassyHeight, -21.8, .18, 3.4, .18, look.stone)
    mid.plate(embassyX - 3.5 + index * 2.7, sea + 4.6 + embassyHeight, -21.7, 1, .7, tone(look.accent, 1.1))
  }
  // Moored hulls with masts, which is what makes water read as a harbour.
  const hulls = spanCount(midHalf * 1.4, 13, 3)
  for (let index = 0; index < hulls; index += 1) {
    const x = -midHalf * .5 + (index + .5) * (midHalf * 1.4 / hulls)
    const z = -13 - hash(index * 5.5) * 8
    mid.box(x, sea, z, 6 + hash(index) * 3, 1.7, 2.3, index % 2 ? 0x455660 : 0x5e3f31)
    mid.box(x, sea + 1.7, z, 2.5, 1.5, 2, 0xb6aa8d)
    mid.box(x + 1.1, sea + 1.7, z, .26, 7.5 + hash(index * 2.7) * 3, .26, 0x7a6749)
  }

  // Near: the water, moving, and the quay edge under the window. Chop is a set
  // of flat streaks — the one thing that reads as water at this scale and the
  // one thing a lit specular would get wrong under a posteriser.
  for (let index = 0; index < 7; index += 1) {
    const z = -(7 + index * 3.4)
    const half = coverHalfWidth(-z)
    // Broken into a few streaks per line rather than one bar across the whole
    // width: an unbroken highlight is a horizon, and there is already one of
    // those. The gaps are what make it read as chop.
    const pieces = spanCount(half * 2, 9, 4)
    for (let piece = 0; piece < pieces; piece += 1) {
      const u = (piece + hash(index * 5.1 + piece) * .55) / pieces
      const width = (half * 2 / pieces) * (.16 + hash(index * 7.7 + piece) * .3)
      close.panel(
        -half + half * 2 * u, -half + half * 2 * u + width,
        z, z - .55 - hash(index + piece) * .5,
        sea + .07 + index * .004,
        // A highlight on water, not a surface. Authored bright and wide, seven
        // rows of these stopped reading as chop and became the sea itself: a
        // pale field at the same value as the sky, with the horizon lost in it.
        tone(0x86aeae, .34), tone(0x86aeae, .16),
      )
    }
  }
  close.box(0, grade, -5.5, coverHalfWidth(6) * 2, sea - grade + 1.2, 1.5, mixHex(look.stone, 0x6a655a, .5))
  mover({ y: sea, z: -10.5, from: -coverHalfWidth(11), to: coverHalfWidth(11), speed: .4, bob: .07 }, (sheet) => {
    sheet.box(0, 0, 0, 4.8, 1.3, 1.9, 0x47595f)
    sheet.box(-.7, 1.3, 0, 1.9, 1.05, 1.5, 0xc0b795)
    sheet.box(1.4, 1.3, 0, .24, 5.4, .24, 0x7a6749)
    sheet.plate(2, 2.1, .1, 1.6, 3.1, tone(0xefe6cd, 1))
  })
}

// ---------------------------------------------------------------------------
// Sovereign Arc — the civic axis, struck straight from the chamber
// ---------------------------------------------------------------------------

function buildSovereignArc(far: Sheet, mid: Sheet, close: Sheet, { look, tier, grade, mover }: RegionContext) {
  // Dressed stone in sun, but not white. Mixed to near-white it arrived at the
  // sky's own value, and a chamber the same value as the sky behind it has no
  // silhouette — the dome went missing and the whole axis read as one pale field.
  const ashlar = mixHex(look.stone, 0xc9c2ad, .5)
  const shadowed = mixHex(look.stone, 0x7d7568, .5)
  const prestige = (tier - 10) * .8

  // The whole composition is symmetric about x = 0, because that is what a
  // Beaux-Arts plan is: the axis is the instrument the rest is set out from,
  // and breaking it by a metre reads instantly as a mistake.

  // Far: the assembly, closing the axis. Wings, portico, drum, dome.
  for (const side of [-1, 1]) far.box(side * 21, grade, -52, 16, 7 + prestige, 10, mixHex(ashlar, look.haze, .22), .98)
  far.box(0, grade, -55, 26, 9 + prestige, 15, ashlar, .99)
  far.box(0, grade, -48.5, 15, 12 + prestige, 4, ashlar, 1.02)
  for (let index = 0; index < 9; index += 1) {
    far.box(-6.4 + index * 1.6, grade, -46.9, .8, 11 + prestige, .8, mixHex(ashlar, 0xffffff, .2), 1.02)
  }
  far.box(0, grade + 12 + prestige, -48.5, 16.5, 1.5, 5.4, shadowed, 1)
  far.box(0, grade + 9 + prestige, -55, 13, 5, 13, ashlar, 1)
  far.dome(0, grade + 14 + prestige, -55, 6.6, 6, mixHex(look.roof, 0xb4bbbe, .55))
  far.box(0, grade + 20 + prestige, -55, 1.6, 1.8, 1.6, ashlar, 1.04)
  far.box(0, grade + 21.8 + prestige, -55, .8, 2.6, .8, mixHex(look.accent, 0xe0bd79, .55), 1.12)

  // Middle: the avenue's two walls, identical, receding. One cornice height
  // held all the way down is the other half of what makes a formal street read
  // as formal rather than as a row of buildings that happen to be near it.
  for (let index = 0; index < 5; index += 1) {
    const z = -(14 + index * 8)
    const offset = 10.5 + index * 1.5
    const height = 8.5 - index * .3
    for (const side of [-1, 1]) {
      mid.box(side * offset, grade, z, 9, height, 7, index % 2 ? ashlar : mixHex(ashlar, shadowed, .32))
      mid.box(side * offset, grade + height, z, 9.7, 1, 7.6, shadowed)
      mid.box(side * offset, grade + height + 1, z, 8, 1.9, 6, mixHex(look.roof, 0x7d848a, .45))
      for (let column = 0; column < 4; column += 1) {
        mid.box(side * (offset - 3.3 + column * 2.2), grade, z + 3.6, .64, height - 1.5, .64, mixHex(ashlar, 0xffffff, .14))
      }
    }
  }
  // Everything at ground level out here has to stand further off than a plan
  // would put it, because the window is twenty metres up. The cone of ground an
  // aperture admits starts well out from the wall: nearer than about thirty
  // metres the pavement is below the sill, so a parterre at nine metres and a
  // lamp standard at seven are geometry spent under the floorboards. They are
  // set out from where the ground actually enters the frame instead.
  for (let index = 0; index < 4; index += 1) {
    const z = -(30 + index * 9)
    for (const side of [-1, 1]) {
      mid.box(side * 5.6, grade, z, 5, .55, 5.4, 0x56684a)
      mid.box(side * 5.6, grade + .55, z, 3.8, .2, 4.2, 0x78885a)
    }
  }
  // Lamp standards, paired down the axis, and the obelisk on it — the one thing
  // allowed to break the skyline between the window and the chamber. Tall
  // enough to be read as street furniture from up here rather than as studs.
  for (let index = 0; index < 5; index += 1) {
    const z = -(26 + index * 7)
    for (const side of [-1, 1]) {
      close.box(side * 3.4, grade, z, .36, 6.4, .36, mixHex(look.stone, 0x534e46, .6))
      close.box(side * 3.4, grade + 6.4, z, .8, .8, .8, 0xf6e7c0, 1.3)
    }
  }
  // Kept short. On the axis it is directly in front of the chamber, and at
  // seventeen metres it stood across the dome and became the subject — which is
  // the one thing a monument on a ceremonial approach must not do. Its tip sits
  // below the drum, so it marks the plaza and lets the dome close the view.
  close.box(0, grade, -38, 3.4, 1.6, 3.4, ashlar)
  close.box(0, grade + 1.6, -38, 1.4, 8.5, 1.4, mixHex(look.accent, 0xc4a382, .4))
  close.spire(0, grade + 10.1, -38, 1.5, 2.6, mixHex(look.accent, 0xe0bd79, .55))

  // A single slow motorcade on the axis is the only movement a ceremonial plan
  // tolerates; everything else out here is meant to be still.
  mover({ y: grade, z: -30, from: -11, to: 11, speed: .5 }, (sheet) => {
    sheet.box(0, 0, 0, 1.3, .95, 2.7, 0x2b3036)
    sheet.box(0, 0, -3.6, 1.3, .95, 2.7, 0x2b3036)
  })
}

// ---------------------------------------------------------------------------
// Global Compact — the international assembly, at night
// ---------------------------------------------------------------------------

function buildGlobalCompact(far: Sheet, mid: Sheet, close: Sheet, { look, tier, grade, coverHalfWidth, mover }: RegionContext) {
  const shell = mixHex(look.stone, 0x38424c, .58)
  const lit = mixHex(look.accent, 0xdff2f4, .35)

  // Far: the assembly ring, lit from within, sitting on the horizon. Everything
  // else in this region defers to it, so it is built at monumental scale — from
  // this height a normal building would not reach the frame at all.
  // The chamber is sized to about two thirds of the frame at this distance and
  // no more. Built to fill it, as the first pass did, there is no room left on
  // either side for the city that is supposed to be deferring to it, and the
  // whole region comes back as one silhouette on an empty sky.
  far.box(0, grade, -56, 20, 13, 16, shell, 1.02)
  far.dome(0, grade + 13, -56, 7.5, 6.5, mixHex(shell, lit, .28), 10)
  for (let index = 0; index < 11; index += 1) {
    const angle = (index / 10) * Math.PI
    far.box(Math.cos(angle) * 9, grade + 13, -56 + Math.sin(angle) * 5, .6, 6, .6, lit, 1.55)
  }
  for (let index = 0; index < 14; index += 1) {
    const side = index % 2 ? 1 : -1
    const x = side * (11 + Math.floor(index / 2) * 3.4 + hash(index * 3.9) * 2.2)
    const z = -46 - hash(index) * 14
    const height = 16 + hash(index * 5.3) * 30
    far.box(x, grade, z, 3.6, height, 3.6, shell, 1)
    // Lit floors only over the top of the shaft. The lower two thirds of a
    // tower at this range sits below the window's sightline, so every window
    // drawn down there is a triangle spent under the sill.
    const floors = Math.floor(height / 3.4)
    for (let floor = Math.floor(floors * .45); floor < floors; floor += 1) {
      if (hash(index * 7 + floor) < .42) continue
      far.plate(x, grade + 2 + floor * 3.4, z + 1.85, 2.7, .9, tone(lit, 1.35))
    }
  }

  // Middle: the approach, terraced, lit at its edges, with the two flanking
  // chambers the final tiers add height to.
  const midHalf = coverHalfWidth(24)
  for (let index = 0; index < 4; index += 1) {
    const z = -(14 + index * 9)
    mid.box(0, grade + index, z, midHalf * (1.6 - index * .12), 1.1, 8, mixHex(shell, 0x1d262e, .42))
    for (const side of [-1, 1]) {
      mid.box(side * midHalf * (.7 - index * .05), grade + index + 1.1, z, .55, 2.8, .55, lit, 1.45)
    }
  }
  for (const side of [-1, 1]) {
    const height = 24 + (tier - 12) * 2.5
    mid.box(side * midHalf * .82, grade, -26, 9, height, 9, shell)
    mid.box(side * midHalf * .82, grade + height, -26, 9.8, .8, 9.8, mixHex(shell, 0x0f161c, .4))
    // Banded at the head rather than glazed all the way down: what reaches the
    // window from a flanking block this close is its crown.
    for (let floor = 0; floor < 5; floor += 1) {
      mid.plate(side * midHalf * .82, grade + height - 3 - floor * 3, -21.4, 6.5, 1.1, tone(lit, 1.25))
    }
  }

  // Near: the parapet of the ring itself, and its beacons — the only things up
  // here allowed to move.
  const nearHalf = coverHalfWidth(6)
  close.box(0, -3.4, -5.6, nearHalf * 2, 1.6, 1.2, mixHex(shell, 0x151d24, .5))
  for (let index = 0; index < 4; index += 1) {
    close.box(-nearHalf * .6 + index * (nearHalf * .4), -1.8, -5.6, .32, .55, .32, lit, 1.7)
  }
  mover({ y: grade + 22, z: -34, from: -midHalf, to: midHalf, speed: .85 }, (sheet) => {
    sheet.box(0, 0, 0, 1, .34, 1, lit, 1.9)
  })
}
