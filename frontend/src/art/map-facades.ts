import * as THREE from 'three'
import type { RoofForm } from './map-urban-plan'
import { hashUnit } from './map-urban-plan'

/**
 * Facade materials for the instanced districts.
 *
 * The districts used to draw every background building as a flat single-colour
 * box with six tiny window quads bolted onto the front. That reads as a stack
 * of monochrome bricks from any distance the camera actually sits at, and the
 * window quads cost six extra instances per building for a detail that is two
 * pixels tall by the time you can see the street it belongs to.
 *
 * The replacement here trades all of that for one procedurally generated
 * texture atlas. A single cell of the atlas holds a seamlessly tileable stretch
 * of one material family with its fenestration already baked in, so the windows
 * come for free with the wall and the separate window mesh disappears entirely.
 * Which cell an instance samples, how many times the cell repeats across its
 * elevation, how lit it is and how weathered it is all arrive as per-instance
 * attributes, which means eight visibly different materials and a whole
 * district's worth of tonal variation still cost the same two draw calls a
 * single flat colour used to.
 *
 * The important realism lever is the repeat count. A window bay and a brick
 * course are physical sizes; they do not get bigger because the building did.
 * Deriving the repeats from each building's real dimensions is what stops a
 * warehouse and a terraced house both showing exactly three windows, and it is
 * the difference between a skyline that reads as architecture and one that
 * reads as scaled-up boxes.
 */

export type FacadeFamily = 'brick' | 'stone' | 'render' | 'timber' | 'glass' | 'concrete' | 'plank' | 'civic'

export type FacadeRegion = 'city' | 'nation' | 'ocean' | 'continent' | 'orbit'

export type FacadeRecord = {
  x: number; z: number
  width: number; height: number; depth: number
  color: number
  lit: boolean
  rotationY?: number
  roof?: RoofForm
  /** Chosen by the caller, or derived from the region + a seed when omitted. */
  family?: FacadeFamily
  /** Stable per-building seed so variation is deterministic. */
  seed?: number
}

// ---------------------------------------------------------------------------
// Atlas layout
// ---------------------------------------------------------------------------

/**
 * Four columns by two rows of 256px cells. Eight families is exactly what the
 * five regions need between them, and a 1024x512 albedo is small enough that
 * the whole material system costs less texture memory than a single one of the
 * ground textures this scene already uploads per region.
 */
const ATLAS_COLS = 4
const ATLAS_ROWS = 2
const CELL = 256

const FAMILY_ORDER: FacadeFamily[] = ['brick', 'stone', 'render', 'timber', 'glass', 'concrete', 'plank', 'civic']
const FAMILY_INDEX: Record<FacadeFamily, number> = {
  brick: 0, stone: 1, render: 2, timber: 3, glass: 4, concrete: 5, plank: 6, civic: 7,
}

/**
 * One cell covers two window bays and two storeys rather than one of each. The
 * repeat maths works out the same either way, but a two-by-two tile lets the
 * four openings in a cell differ from one another, so a wall only visibly
 * repeats every two bays instead of every single one.
 */
const BAY_WIDTH = .62
const STOREY_HEIGHT = .74
const TILE_SPAN_X = BAY_WIDTH * 2
const TILE_SPAN_Y = STOREY_HEIGHT * 2

const ALBEDO_WIDTH = ATLAS_COLS * CELL
const ALBEDO_HEIGHT = ATLAS_ROWS * CELL

/**
 * Roughness and emissive carry far less detail than albedo does — one is a
 * broad "is this glass or is it brick" mask and the other is a set of hard
 * rectangles — so they are generated at half resolution. Atlas UVs are
 * normalised, so the same coordinates address all three without any change in
 * the shader; only the inset has to be sized for the coarsest of them.
 */
const DATA_SCALE = .5
const DATA_WIDTH = ALBEDO_WIDTH * DATA_SCALE
const DATA_HEIGHT = ALBEDO_HEIGHT * DATA_SCALE

const INSET_U = 1 / DATA_WIDTH
const INSET_V = 1 / DATA_HEIGHT
const SPAN_U = 1 / ATLAS_COLS - INSET_U * 2
const SPAN_V = 1 / ATLAS_ROWS - INSET_V * 2

/**
 * Roughly mip level five of the albedo atlas. Past that a cell is averaged down
 * to a few texels and starts pulling in whatever sits beside it in the grid,
 * which shows up as brick quietly turning into stone as the camera pulls back.
 * Clamping the gradient costs one instruction and is the only reason a shared
 * atlas can be mipmapped at all.
 */
const MAX_GRADIENT = .024

// ---------------------------------------------------------------------------
// Canvas painting
// ---------------------------------------------------------------------------

type Layer = 'albedo' | 'rough' | 'emissive'

type Painter = CanvasRenderingContext2D

function grey(value: number) {
  const clamped = Math.max(0, Math.min(255, Math.round(value)))
  return `rgb(${clamped},${clamped},${clamped})`
}

/**
 * All three atlases are painted by the same code so their features stay in
 * register: a window drawn at a given rectangle is dark in albedo, smooth in
 * roughness and bright in emissive without anyone having to keep three sets of
 * coordinates in sync by hand.
 */
function ink(layer: Layer, albedo: string, rough: number, emissive = 0) {
  if (layer === 'albedo') return albedo
  return grey(layer === 'rough' ? rough : emissive)
}

/**
 * Stamps a rectangle at its wrapped positions as well as its own. Every cell
 * has to tile seamlessly in both axes, and re-drawing the handful of shapes
 * that cross an edge is a great deal simpler than arranging for nothing ever to
 * cross one.
 */
function tileFill(context: Painter, x: number, y: number, width: number, height: number) {
  context.fillRect(x, y, width, height)
  const wrapX = x + width > CELL ? -CELL : x < 0 ? CELL : 0
  const wrapY = y + height > CELL ? -CELL : y < 0 ? CELL : 0
  if (wrapX) context.fillRect(x + wrapX, y, width, height)
  if (wrapY) context.fillRect(x, y + wrapY, width, height)
  if (wrapX && wrapY) context.fillRect(x + wrapX, y + wrapY, width, height)
}

function makeRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/**
 * Scattered translucent flecks. Real masonry is never one value, and without
 * this the tiling reads as a printed pattern rather than a surface.
 */
function mottle(context: Painter, layer: Layer, random: () => number, options: { count: number; low: number; high: number; alpha: number; size: number }) {
  if (layer !== 'albedo') return
  for (let index = 0; index < options.count; index += 1) {
    const tone = Math.round(options.low + random() * (options.high - options.low))
    context.fillStyle = `rgba(${tone},${tone},${tone},${options.alpha})`
    tileFill(context, random() * CELL, random() * CELL, options.size * (.4 + random()), options.size * (.3 + random()))
  }
}

/**
 * A downward fade of dirt. Weathering is overwhelmingly a vertical phenomenon —
 * water runs off sills and joints and leaves a tail — so a plain gradient in one
 * axis buys most of the effect.
 */
function streak(context: Painter, layer: Layer, x: number, y: number, width: number, height: number, tone: number, alpha: number) {
  if (layer !== 'albedo') return
  const gradient = context.createLinearGradient(0, y, 0, y + height)
  gradient.addColorStop(0, `rgba(${tone},${tone},${tone},${alpha})`)
  gradient.addColorStop(1, `rgba(${tone},${tone},${tone},0)`)
  context.fillStyle = gradient
  context.fillRect(x, y, width, height)
}

type Glazing = {
  glass: string
  glassRough: number
  frame: string
  frameRough: number
  frameWidth?: number
  bars?: number
  transoms?: number
}

function drawGlazing(context: Painter, layer: Layer, x: number, y: number, width: number, height: number, glow: number, style: Glazing) {
  context.fillStyle = ink(layer, style.glass, style.glassRough, glow)
  tileFill(context, x, y, width, height)
  const thickness = style.frameWidth ?? 3
  context.fillStyle = ink(layer, style.frame, style.frameRough, 0)
  tileFill(context, x, y, width, thickness)
  tileFill(context, x, y + height - thickness, width, thickness)
  tileFill(context, x, y, thickness, height)
  tileFill(context, x + width - thickness, y, thickness, height)
  const bars = style.bars ?? 1
  for (let index = 1; index < bars; index += 1) tileFill(context, x + Math.round(index * width / bars) - 1, y, 2, height)
  const transoms = style.transoms ?? 1
  for (let index = 1; index < transoms; index += 1) tileFill(context, x, y + Math.round(index * height / transoms) - 1, width, 2)
}

/**
 * Not every window in a lit building is lit, and a terrace where they all match
 * looks like a switch was thrown. Varying the glow across the four openings in a
 * cell — combined with the half-tile UV offset each instance gets — means two
 * neighbours of the same family light up differently.
 */
const OPENING_GLOW = [236, 104, 192, 46]

const BASE_ALBEDO: Record<FacadeFamily, number> = {
  brick: 132, stone: 120, render: 200, timber: 205, glass: 116, concrete: 178, plank: 150, civic: 202,
}

const BASE_ROUGH: Record<FacadeFamily, number> = {
  brick: 240, stone: 220, render: 205, timber: 185, glass: 40, concrete: 210, plank: 175, civic: 212,
}

function paintBrick(context: Painter, layer: Layer, random: () => number) {
  const courses = 24
  const courseHeight = CELL / courses
  for (let course = 0; course < courses; course += 1) {
    const shift = (course % 2) * 16
    for (let index = 0; index < 8; index += 1) {
      const tone = 148 + Math.round(random() * 54)
      context.fillStyle = ink(layer, grey(tone), 224 + Math.round(random() * 18))
      tileFill(context, index * 32 + shift + 1, course * courseHeight + 1, 30, courseHeight - 2)
    }
  }
  mottle(context, layer, random, { count: 90, low: 70, high: 190, alpha: .07, size: 26 })
  for (let storey = 0; storey < 2; storey += 1) for (let bay = 0; bay < 2; bay += 1) {
    const ox = bay * 128
    const oy = storey * 128
    context.fillStyle = ink(layer, grey(184), 222)
    tileFill(context, ox + 32, oy + 22, 64, 11)
    context.fillStyle = ink(layer, grey(66), 244)
    tileFill(context, ox + 38, oy + 32, 52, 70)
    drawGlazing(context, layer, ox + 40, oy + 34, 48, 66, OPENING_GLOW[storey * 2 + bay], {
      glass: grey(58), glassRough: 62, frame: grey(196), frameRough: 130, transoms: 2,
    })
    context.fillStyle = ink(layer, grey(202), 200)
    tileFill(context, ox + 30, oy + 100, 68, 7)
    streak(context, layer, ox + 34, oy + 107, 60, 20, 74, .3)
  }
}

function paintStone(context: Painter, layer: Layer, random: () => number) {
  for (let row = 0; row < 8; row += 1) {
    const shift = (row % 2) * 32
    for (let index = 0; index < 4; index += 1) {
      const tone = 164 + Math.round(random() * 44)
      context.fillStyle = ink(layer, grey(tone), 206 + Math.round(random() * 26))
      tileFill(context, index * 64 + shift + 2, row * 32 + 2, 60, 28)
    }
  }
  mottle(context, layer, random, { count: 130, low: 90, high: 210, alpha: .06, size: 34 })
  for (let storey = 0; storey < 2; storey += 1) for (let bay = 0; bay < 2; bay += 1) {
    const ox = bay * 128
    const oy = storey * 128
    const glow = OPENING_GLOW[(storey * 2 + bay + 1) % 4]
    context.fillStyle = ink(layer, grey(214), 196)
    tileFill(context, ox + 32, oy + 18, 64, 12)
    tileFill(context, ox + 57, oy + 14, 14, 18)
    context.fillStyle = ink(layer, grey(62), 246)
    tileFill(context, ox + 38, oy + 30, 52, 74)
    drawGlazing(context, layer, ox + 41, oy + 32, 46, 70, glow, {
      glass: grey(54), glassRough: 60, frame: grey(188), frameRough: 140, transoms: 3,
    })
    context.fillStyle = ink(layer, grey(220), 188)
    tileFill(context, ox + 30, oy + 102, 68, 8)
    streak(context, layer, ox + 32, oy + 110, 64, 24, 88, .26)
  }
}

function paintRender(context: Painter, layer: Layer, random: () => number) {
  mottle(context, layer, random, { count: 180, low: 150, high: 235, alpha: .08, size: 46 })
  for (let storey = 0; storey < 2; storey += 1) {
    const oy = storey * 128
    context.fillStyle = ink(layer, grey(224), 196)
    tileFill(context, 0, oy + 116, CELL, 7)
    context.fillStyle = ink(layer, grey(158), 210)
    tileFill(context, 0, oy + 123, CELL, 3)
    for (let bay = 0; bay < 2; bay += 1) {
      const ox = bay * 128
      context.fillStyle = ink(layer, grey(226), 190)
      tileFill(context, ox + 32, oy + 26, 64, 76)
      context.fillStyle = ink(layer, grey(72), 236)
      tileFill(context, ox + 36, oy + 30, 56, 68)
      drawGlazing(context, layer, ox + 38, oy + 32, 52, 64, OPENING_GLOW[(storey + bay * 3) % 4], {
        glass: grey(60), glassRough: 58, frame: grey(232), frameRough: 120, bars: 2, transoms: 2,
      })
      streak(context, layer, ox + 34, oy + 100, 60, 26, 96, .24)
    }
  }
  // Render always fails somewhere, and the patches of exposed substrate are what
  // separate a limewashed cottage from a flat-shaded cube.
  if (layer === 'albedo') for (let index = 0; index < 7; index += 1) {
    context.fillStyle = `rgba(140,136,130,${.14 + random() * .2})`
    tileFill(context, random() * CELL, 96 + random() * 140, 14 + random() * 34, 10 + random() * 22)
  }
}

function paintTimber(context: Painter, layer: Layer, random: () => number) {
  mottle(context, layer, random, { count: 120, low: 175, high: 230, alpha: .09, size: 40 })
  context.fillStyle = ink(layer, grey(86), 200)
  for (const x of [0, 64, 128, 192]) tileFill(context, x - 5, 0, 11, CELL)
  for (const y of [0, 64, 128, 192]) tileFill(context, 0, y - 5, CELL, 11)
  // A brace per panel, kept clear of the panel edges so it never needs wrapping.
  if (layer !== 'emissive') for (let panelY = 0; panelY < 4; panelY += 1) for (let panelX = 0; panelX < 4; panelX += 1) {
    context.save()
    context.translate(panelX * 64 + 32, panelY * 64 + 32)
    context.rotate((panelX + panelY) % 2 === 0 ? .72 : -.72)
    context.fillStyle = ink(layer, grey(94), 198)
    context.fillRect(-4, -30, 8, 60)
    context.restore()
  }
  for (let storey = 0; storey < 2; storey += 1) for (let bay = 0; bay < 2; bay += 1) {
    const ox = bay * 128
    const oy = storey * 128
    drawGlazing(context, layer, ox + 42, oy + 78, 44, 42, OPENING_GLOW[(storey * 2 + bay + 2) % 4], {
      glass: grey(64), glassRough: 54, frame: grey(96), frameRough: 176, frameWidth: 4, bars: 3, transoms: 2,
    })
  }
}

function paintGlass(context: Painter, layer: Layer, random: () => number) {
  for (let storey = 0; storey < 2; storey += 1) {
    const oy = storey * 128
    context.fillStyle = ink(layer, grey(152), 176)
    tileFill(context, 0, oy + 96, CELL, 32)
    for (let module = 0; module < 8; module += 1) {
      const ox = module * 32
      const glow = OPENING_GLOW[(module + storey * 3) % 4]
      context.fillStyle = ink(layer, grey(92 + Math.round(random() * 34)), 34, glow)
      tileFill(context, ox + 3, oy + 4, 26, 88)
      // A slanted highlight across each pane. Curtain wall is legible almost
      // entirely through what it reflects, and a flat dark rectangle reads as a
      // hole rather than as glazing.
      if (layer === 'albedo') {
        context.save()
        context.beginPath()
        context.rect(ox + 3, oy + 4, 26, 88)
        context.clip()
        context.fillStyle = `rgba(220,228,236,${.1 + random() * .16})`
        context.translate(ox + 16, oy + 48)
        context.rotate(-.9)
        context.fillRect(-40, -14, 80, 16)
        context.restore()
      }
    }
    context.fillStyle = ink(layer, grey(174), 128)
    for (let mullion = 0; mullion < 8; mullion += 1) tileFill(context, mullion * 32 - 2, oy, 5, 128)
    tileFill(context, 0, oy + 92, CELL, 5)
    tileFill(context, 0, oy + 124, CELL, 5)
  }
}

function paintConcrete(context: Painter, layer: Layer, random: () => number) {
  if (layer !== 'emissive') for (let line = 0; line < 32; line += 1) {
    context.fillStyle = ink(layer, grey(168 + Math.round(random() * 22)), 206 + Math.round(random() * 14))
    tileFill(context, 0, line * 8, CELL, 7)
  }
  mottle(context, layer, random, { count: 150, low: 130, high: 215, alpha: .07, size: 44 })
  context.fillStyle = ink(layer, grey(112), 222)
  for (const x of [0, 128]) tileFill(context, x - 3, 0, 6, CELL)
  for (const y of [0, 64, 128, 192]) tileFill(context, 0, y - 3, CELL, 6)
  for (let storey = 0; storey < 2; storey += 1) for (let bay = 0; bay < 2; bay += 1) {
    const ox = bay * 128
    const oy = storey * 128
    context.fillStyle = ink(layer, grey(74), 234)
    tileFill(context, ox + 32, oy + 24, 64, 60)
    drawGlazing(context, layer, ox + 35, oy + 27, 58, 54, OPENING_GLOW[(storey + bay) % 4], {
      glass: grey(66), glassRough: 48, frame: grey(150), frameRough: 150, bars: 2,
    })
    streak(context, layer, ox + 30, oy + 84, 68, 40, 96, .22)
  }
  // Rust and run-off below the panel joints is the single cheapest cue that a
  // concrete surface has been standing outdoors for decades.
  for (let index = 0; index < 10; index += 1) streak(context, layer, random() * CELL, 4 + Math.floor(random() * 3) * 64, 3 + random() * 7, 30 + random() * 40, 92, .2)
}

function paintPlank(context: Painter, layer: Layer, random: () => number) {
  for (let plank = 0; plank < 16; plank += 1) {
    const tarred = plank % 5 === 0
    const tone = (tarred ? 96 : 142) + Math.round(random() * 46)
    context.fillStyle = ink(layer, grey(tone), tarred ? 150 : 182 + Math.round(random() * 20))
    tileFill(context, 0, plank * 16, CELL, 15)
    context.fillStyle = ink(layer, grey(78), 200)
    tileFill(context, 0, plank * 16 + 15, CELL, 1)
    const joint = (plank * 37) % CELL
    tileFill(context, joint, plank * 16, 3, 15)
    tileFill(context, (joint + 128) % CELL, plank * 16, 3, 15)
    if (layer === 'albedo') for (const nail of [joint + 8, joint + 136]) {
      context.fillStyle = 'rgba(64,60,56,.5)'
      tileFill(context, nail % CELL, plank * 16 + 6, 3, 3)
    }
  }
  mottle(context, layer, random, { count: 110, low: 110, high: 205, alpha: .08, size: 30 })
  for (let storey = 0; storey < 2; storey += 1) for (let bay = 0; bay < 2; bay += 1) {
    const ox = bay * 128
    const oy = storey * 128
    context.fillStyle = ink(layer, grey(88), 190)
    tileFill(context, ox + 40, oy + 30, 48, 48)
    drawGlazing(context, layer, ox + 44, oy + 34, 40, 40, OPENING_GLOW[(storey * 3 + bay) % 4], {
      glass: grey(56), glassRough: 56, frame: grey(126), frameRough: 178, frameWidth: 4, bars: 2, transoms: 2,
    })
    // A shutter hung off one side, because a working harbour boards things up.
    if ((storey + bay) % 2 === 0) {
      context.fillStyle = ink(layer, grey(104), 186)
      tileFill(context, ox + 90, oy + 30, 20, 48)
    }
    streak(context, layer, ox + 40, oy + 78, 48, 30, 82, .26)
  }
}

function paintCivic(context: Painter, layer: Layer, random: () => number) {
  for (let course = 0; course < 8; course += 1) {
    const shift = (course % 2) * 32
    for (let index = 0; index < 4; index += 1) {
      const tone = 196 + Math.round(random() * 26)
      context.fillStyle = ink(layer, grey(tone), 204 + Math.round(random() * 16))
      tileFill(context, index * 64 + shift + 1, course * 32 + 1, 62, 30)
    }
  }
  mottle(context, layer, random, { count: 100, low: 175, high: 235, alpha: .05, size: 40 })
  // A giant order: the pilasters run the full height of the cell so that they
  // remain unbroken however many times the cell repeats up the elevation. That
  // continuity is what makes the Sovereign Arc read as monumental rather than as
  // an ordinary office block wearing decoration.
  for (const x of [0, 128]) {
    context.fillStyle = ink(layer, grey(222), 198)
    tileFill(context, x - 18, 0, 36, CELL)
    context.fillStyle = ink(layer, grey(186), 210)
    for (const flute of [-8, 0, 8]) tileFill(context, x + flute - 1, 0, 2, CELL)
  }
  for (let storey = 0; storey < 2; storey += 1) for (let bay = 0; bay < 2; bay += 1) {
    const ox = bay * 128
    const oy = storey * 128
    context.fillStyle = ink(layer, grey(230), 194)
    tileFill(context, ox + 32, oy + 16, 64, 96)
    context.fillStyle = ink(layer, grey(70), 238)
    tileFill(context, ox + 36, oy + 20, 56, 88)
    drawGlazing(context, layer, ox + 38, oy + 22, 52, 84, OPENING_GLOW[(storey * 2 + bay + 3) % 4], {
      glass: grey(52), glassRough: 56, frame: grey(226), frameRough: 128, bars: 2, transoms: 4,
    })
    context.fillStyle = ink(layer, grey(214), 200)
    tileFill(context, ox + 26, oy + 116, 76, 8)
    streak(context, layer, ox + 32, oy + 112, 64, 18, 132, .18)
  }
}

function paintCell(context: Painter, family: FacadeFamily, layer: Layer) {
  const random = makeRandom(FAMILY_INDEX[family] * 9176 + 2411)
  context.fillStyle = ink(layer, grey(BASE_ALBEDO[family]), BASE_ROUGH[family])
  context.fillRect(0, 0, CELL, CELL)
  if (family === 'brick') paintBrick(context, layer, random)
  else if (family === 'stone') paintStone(context, layer, random)
  else if (family === 'render') paintRender(context, layer, random)
  else if (family === 'timber') paintTimber(context, layer, random)
  else if (family === 'glass') paintGlass(context, layer, random)
  else if (family === 'concrete') paintConcrete(context, layer, random)
  else if (family === 'plank') paintPlank(context, layer, random)
  else paintCivic(context, layer, random)
}

function paintAtlas(layer: Layer) {
  const scale = layer === 'albedo' ? 1 : DATA_SCALE
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(ALBEDO_WIDTH * scale)
  canvas.height = Math.round(ALBEDO_HEIGHT * scale)
  const context = canvas.getContext('2d')!
  context.fillStyle = layer === 'emissive' ? '#000000' : '#808080'
  context.fillRect(0, 0, canvas.width, canvas.height)
  FAMILY_ORDER.forEach((family, index) => {
    context.save()
    context.scale(scale, scale)
    context.translate((index % ATLAS_COLS) * CELL, Math.floor(index / ATLAS_COLS) * CELL)
    context.beginPath()
    context.rect(0, 0, CELL, CELL)
    context.clip()
    paintCell(context, family, layer)
    context.restore()
  })
  return canvas
}

/**
 * Where a normalised cell should average out to, in linear light.
 *
 * Two jobs in one number. The first is normalisation: the tint is the
 * building's colour and the atlas is its surface, and the two only compose
 * correctly if the atlas multiplies around a fixed level rather than around
 * whatever brightness its paint routine happened to land on. Painted raw the
 * pale families average about 0.85 and the dark ones about 0.35, so one tint
 * gave a limewashed cottage that clipped to white beside a brick terrace that
 * read as soot.
 *
 * The second is exposure. The districts are lit for a scene under an ACES
 * curve at 1.34 exposure, and a wall is the largest sunlit surface in shot, so
 * the level has to be a plausible reflectance rather than a bright one:
 * anything near the paint's own value burns out and takes its fenestration
 * with it. Real render sits near 0.5 and real brick near 0.2, and multiplying
 * through the tints in `REGION_TONE` this lands the families between them.
 */
const TARGET_LUMA = .58

/** Linear-light mean of each family's cell, filled in when the atlas is painted. */
const familyLuma = new Float32Array(FAMILY_ORDER.length).fill(TARGET_LUMA)

function toLinear(channel: number) {
  const value = channel / 255
  return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4)
}

/**
 * Mean of each cell, measured rather than declared.
 *
 * Measuring it means a paint routine can be retuned — a darker brick, a
 * busier plank wall — without anyone having to remember to re-balance a
 * constant somewhere else, which is exactly the kind of bookkeeping that
 * quietly stops being true.
 */
function measureFamilyLuma(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  FAMILY_ORDER.forEach((family, index) => {
    const column = index % ATLAS_COLS
    const row = Math.floor(index / ATLAS_COLS)
    // Every fourth texel in each axis. The cells are flat-shaded rectangles at
    // heart, so a sixteenth of the samples lands within a fraction of a percent
    // of the full mean and the whole measurement stays under a millisecond.
    const step = 4
    const { data } = context.getImageData(column * CELL, row * CELL, CELL, CELL)
    let total = 0
    let count = 0
    for (let y = 0; y < CELL; y += step) {
      for (let x = 0; x < CELL; x += step) {
        const offset = (y * CELL + x) * 4
        total += toLinear(data[offset]) * .2126 + toLinear(data[offset + 1]) * .7152 + toLinear(data[offset + 2]) * .0722
        count += 1
      }
    }
    familyLuma[FAMILY_INDEX[family]] = count ? Math.max(.02, total / count) : TARGET_LUMA
  })
}

type FacadeAtlas = {
  albedo: THREE.CanvasTexture
  roughness: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
  preview: HTMLCanvasElement
}

let cachedAtlas: FacadeAtlas | null = null

/**
 * Generated once for the lifetime of the tab and deliberately never disposed:
 * these outlive any single mount exactly as the scene's shared geometry and
 * materials do, and `disposeScene` skips anything flagged `mapShared`.
 */
function facadeAtlas(): FacadeAtlas {
  if (cachedAtlas) return cachedAtlas
  const albedoCanvas = paintAtlas('albedo')
  measureFamilyLuma(albedoCanvas)
  const albedo = new THREE.CanvasTexture(albedoCanvas)
  albedo.colorSpace = THREE.SRGBColorSpace
  // Anisotropy only on the albedo. It is the one atlas with detail fine enough
  // to smear at the grazing angles a street elevation is usually seen at; the
  // other two are broad masks and would gain nothing for the extra taps.
  albedo.anisotropy = 4
  const roughness = new THREE.CanvasTexture(paintAtlas('rough'))
  const emissive = new THREE.CanvasTexture(paintAtlas('emissive'))
  for (const texture of [albedo, roughness, emissive]) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    texture.userData.mapShared = true
  }
  cachedAtlas = { albedo, roughness, emissive, preview: albedoCanvas }
  return cachedAtlas
}

/** Returns the albedo atlas canvas so it can be inspected or screenshotted. */
export function __facadeAtlasPreview(): HTMLCanvasElement {
  return facadeAtlas().preview
}

// ---------------------------------------------------------------------------
// Shader
// ---------------------------------------------------------------------------

const FIXED = 6

const VERTEX_PARS = `
attribute vec4 aFacadeTile;
attribute vec2 aFacadeVary;
uniform float facadeNormalise[${FAMILY_ORDER.length}];
varying vec4 vFacadeUv;
varying vec4 vFacadeMeta;
`

const VERTEX_BODY = `
// Which box face a vertex sits on decides which of the building's horizontal
// dimensions the tiling has to follow: the +-X faces span its depth and the
// +-Z faces span its width. Picking per face is what keeps a window the same
// physical size on a building's flank as on its frontage.
float facadeRoof = step(0.5, abs(normal.y));
float facadeAcross = mix(aFacadeTile.x, aFacadeTile.z, step(0.5, abs(normal.x)));
vec2 facadeTiled = vec2(uv.x * facadeAcross, uv.y * aFacadeTile.y);
// A cell holds two bays, so shifting by half a tile slides the wall along by a
// whole bay. Neighbours therefore show different stretches of the same pattern
// without ever leaving a half window at a corner.
facadeTiled += floor(vec2(aFacadeVary.y * 3.97, aFacadeVary.y * 6.91)) * 0.5;
float facadeColumn = mod(aFacadeTile.w, ${ATLAS_COLS}.0);
float facadeRow = floor(aFacadeTile.w / ${ATLAS_COLS}.0);
vFacadeUv = vec4(
  facadeTiled,
  facadeColumn / ${ATLAS_COLS}.0 + ${INSET_U.toFixed(FIXED)},
  1.0 - (facadeRow + 1.0) / ${ATLAS_ROWS}.0 + ${INSET_V.toFixed(FIXED)}
);
// Two per-building brightness terms folded into one varying. The normalise
// factor brings the cell's own average to a common level so the tint decides
// how light a wall is, and the drift is what stops a terrace that shares a
// family and a tint from reading as one long extruded slab.
float facadeDrift = (0.86 + aFacadeVary.y * 0.26) * facadeNormalise[int(aFacadeTile.w)];
vFacadeMeta = vec4(facadeRoof, aFacadeVary.x, facadeDrift, uv.y);
`

const FRAGMENT_PARS = `
uniform sampler2D facadeAlbedo;
uniform sampler2D facadeRoughness;
uniform sampler2D facadeEmissive;
varying vec4 vFacadeUv;
varying vec4 vFacadeMeta;
vec2 gFacadeUv;
vec2 gFacadeDx;
vec2 gFacadeDy;
`

const FRAGMENT_MAP = `
// fract() is what turns a single atlas cell into a repeating wall, but it also
// leaves a derivative cliff on every tile seam which the hardware reads as
// "minified to nothing" and answers with the smallest mip. Deriving the
// gradient from the unwrapped coordinate keeps the seam as sharp as the rest of
// the elevation; clamping it stops a distant wall from reaching a mip coarse
// enough to average in the neighbouring cell and quietly turn brick into stone.
gFacadeUv = vFacadeUv.zw + fract(vFacadeUv.xy) * vec2(${SPAN_U.toFixed(FIXED)}, ${SPAN_V.toFixed(FIXED)});
gFacadeDx = clamp(dFdx(vFacadeUv.xy) * vec2(${SPAN_U.toFixed(FIXED)}, ${SPAN_V.toFixed(FIXED)}), -${MAX_GRADIENT.toFixed(FIXED)}, ${MAX_GRADIENT.toFixed(FIXED)});
gFacadeDy = clamp(dFdy(vFacadeUv.xy) * vec2(${SPAN_U.toFixed(FIXED)}, ${SPAN_V.toFixed(FIXED)}), -${MAX_GRADIENT.toFixed(FIXED)}, ${MAX_GRADIENT.toFixed(FIXED)});
vec3 facadeTexel = textureGrad(facadeAlbedo, gFacadeUv, gFacadeDx, gFacadeDy).rgb;
// The lid and the underside of the box are not elevations and must not carry
// rows of windows, so they drop back to a flat surface and let the roof mesh
// and the instance tint carry them.
facadeTexel = mix(facadeTexel, vec3(0.66), vFacadeMeta.x);
// Traffic film collects at pavement level. Fading it in from the foot of the
// wall costs one smoothstep and saves baking a distinct ground floor into the
// atlas, which the tiling could not have expressed anyway.
float facadeBase = mix(0.62, 1.0, smoothstep(0.0, 0.14, vFacadeMeta.w));
// The lid is already a flat grey, so the elevation's normalisation would only
// push it around for no reason; it opts out of both brightness terms.
diffuseColor.rgb *= facadeTexel * mix(vFacadeMeta.z, 1.0, vFacadeMeta.x) * mix(facadeBase, 1.0, vFacadeMeta.x);
`

const FRAGMENT_ROUGHNESS = `
float roughnessFactor = roughness * mix(textureGrad(facadeRoughness, gFacadeUv, gFacadeDx, gFacadeDy).g, 0.82, vFacadeMeta.x);
`

const FRAGMENT_METALNESS = `
// There is no metalness atlas, but across this palette "smooth" and "metallic"
// coincide closely enough that deriving one from the other buys the glint on
// curtain wall and on window glass without a fourth texture or a fourth sample.
float metalnessFactor = metalness + (1.0 - roughnessFactor) * 0.42;
`

const FRAGMENT_EMISSIVE = `
// Lit windows come out of the atlas rather than their own InstancedMesh, which
// is what let six extra instances per building disappear from every district.
float facadeWindow = textureGrad(facadeEmissive, gFacadeUv, gFacadeDx, gFacadeDy).r;
// The material's own emissive is an ambient floor rather than a glow: scaling it
// by the wall colour keeps an unlit elevation legible without laying the same
// flat grey haze over every surface in the region.
totalEmissiveRadiance = emissive * diffuseColor.rgb
  + facadeWindow * vFacadeMeta.y * (1.0 - vFacadeMeta.x) * vec3(1.0, 0.82, 0.55);
`

const warnedTokens = new Set<string>()

/**
 * A missing chunk would fail silently and leave the walls flat-shaded, which is
 * exactly the failure this file exists to remove, so it is worth one warning if
 * a three.js upgrade ever renames one of these hooks.
 */
function patch(source: string, token: string, replacement: string) {
  if (!source.includes(token)) {
    if (!warnedTokens.has(token)) {
      warnedTokens.add(token)
      console.warn(`map-facades: shader chunk ${token} not found; facades will render untextured`)
    }
    return source
  }
  return source.replace(token, replacement)
}

let cachedFacadeMaterial: THREE.MeshStandardMaterial | null = null

function facadeMaterial() {
  if (cachedFacadeMaterial) return cachedFacadeMaterial
  const atlas = facadeAtlas()
  const created = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: .03,
    emissive: 0xbcae95,
    emissiveIntensity: .34,
    // Deliberately false. `vertexColors` makes three declare a `color` vertex
    // attribute the box geometry does not have, and an unbound attribute reads
    // as black. Leaving it off still defines USE_COLOR in the fragment stage —
    // three does that for any InstancedMesh carrying an instanceColor — so the
    // per-building tint arrives intact and nothing renders black.
    vertexColors: false,
  })
  created.userData.mapShared = true
  created.customProgramCacheKey = () => 'map-facades:atlas'
  created.onBeforeCompile = (shader) => {
    shader.uniforms.facadeNormalise = {
      value: Array.from(familyLuma, (luma) => TARGET_LUMA / luma),
    }
    shader.uniforms.facadeAlbedo = { value: atlas.albedo }
    shader.uniforms.facadeRoughness = { value: atlas.roughness }
    shader.uniforms.facadeEmissive = { value: atlas.emissive }
    shader.vertexShader = patch(shader.vertexShader, '#include <common>', `#include <common>\n${VERTEX_PARS}`)
    shader.vertexShader = patch(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = patch(shader.fragmentShader, '#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    shader.fragmentShader = patch(shader.fragmentShader, '#include <map_fragment>', FRAGMENT_MAP)
    shader.fragmentShader = patch(shader.fragmentShader, '#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS)
    shader.fragmentShader = patch(shader.fragmentShader, '#include <metalnessmap_fragment>', FRAGMENT_METALNESS)
    shader.fragmentShader = patch(shader.fragmentShader, '#include <emissivemap_fragment>', FRAGMENT_EMISSIVE)
  }
  cachedFacadeMaterial = created
  return created
}

/**
 * Roofs stay off the atlas. A roof is seen almost entirely in silhouette and in
 * plan, never as a tiled elevation, so the only thing it needs from this system
 * is a convincing per-instance colour — and keeping it on a plain material means
 * the facade shader never has to carry a branch for geometry that has no walls.
 */
const sharedRoofMaterials = new Map<string, THREE.MeshStandardMaterial>()

function roofMaterial(key: 'cap' | 'pitched' | 'stepped') {
  const cached = sharedRoofMaterials.get(key)
  if (cached) return cached
  const created = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: key === 'pitched' ? .82 : .74,
    metalness: key === 'cap' ? .18 : .12,
    emissive: 0x3c3830,
    emissiveIntensity: key === 'pitched' ? .34 : .4,
    vertexColors: false,
  })
  created.userData.mapShared = true
  sharedRoofMaterials.set(key, created)
  return created
}

const sharedRoofGeometry = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 4),
}
Object.values(sharedRoofGeometry).forEach((geometry) => { geometry.userData.mapShared = true })

// ---------------------------------------------------------------------------
// Region character
// ---------------------------------------------------------------------------

/**
 * The mix of materials appropriate to a region, so callers can ask for
 * "an Old Quarter building" without hard-coding families.
 */
export function familyForRegion(region: FacadeRegion, seed: number, options?: { height?: number; civic?: boolean }): FacadeFamily {
  const roll = hashUnit(seed * 1.37 + 4.13)
  const height = options?.height ?? 2
  if (region === 'city') {
    // The Old Quarter is a brick city that grew over a stone one. Timber only
    // survives on the low, old fringe, which is why it is gated on height
    // rather than left to the dice.
    if (options?.civic) return 'civic'
    if (height < 1.75 && roll > .86) return 'timber'
    if (roll < .58) return 'brick'
    if (roll < .8) return 'stone'
    return 'render'
  }
  if (region === 'nation') {
    if (options?.civic) return 'stone'
    if (roll < .44) return 'render'
    if (roll < .72) return 'timber'
    if (roll < .92) return 'stone'
    return 'brick'
  }
  if (region === 'ocean') {
    // A working harbour is tarred timber in the low sheds along the quay and
    // poured concrete once a building gets tall enough to be worth the salt.
    if (options?.civic) return 'concrete'
    if (height < 2.6 && roll < .58) return 'plank'
    if (roll < .68) return 'concrete'
    if (roll < .86) return 'render'
    return 'stone'
  }
  if (region === 'continent') {
    // Glass belongs only to the commercial cluster, which is the one thing out
    // here tall enough to be distinguishable by height alone. The threshold is
    // set high deliberately: a stray glass tower inside the ring would break the
    // uniformity the whole region is built on.
    if (height > 5.2 && !options?.civic) return 'glass'
    if (options?.civic) return 'civic'
    // What is uniform about a planned capital is its *cornice line*, not its
    // masonry. Returning 'civic' for nearly three quarters of the fabric made
    // the whole region one colour, which is a different thing entirely and the
    // reason it read as washed out. The mix below is what a nineteenth-century
    // capital is actually built from: ashlar limestone, plastered infill, a
    // cooler granite, postwar concrete patches and the odd older brick
    // survivor — all at the same height.
    if (roll < .3) return 'stone'
    if (roll < .53) return 'render'
    if (roll < .72) return 'civic'
    if (roll < .88) return 'concrete'
    return 'brick'
  }
  if (options?.civic) return 'concrete'
  return roll < .46 ? 'concrete' : roll < .86 ? 'glass' : 'stone'
}

type Hsl = [number, number, number]

/**
 * Base hue/saturation/lightness per region and family, plus how far a single
 * building is allowed to drift from it. The drift figure is doing real work:
 * the Old Quarter needs neighbours that visibly disagree with one another,
 * while on the Sovereign Arc the uniformity IS the character and anything more
 * than a whisper of variation reads as untidiness rather than as age.
 */
const REGION_TONE: Record<FacadeRegion, { drift: number; palette: Partial<Record<FacadeFamily, Hsl>>; fallback: Hsl }> = {
  city: {
    drift: 1,
    fallback: [.075, .16, .5],
    palette: {
      // Lightness runs a little higher than the intended result everywhere in
      // this table, because the atlas it multiplies against is normalised to
      // sit just under one and a tint picked to look right on its own comes out
      // as mud on the wall.
      brick: [.038, .3, .5],
      stone: [.095, .13, .64],
      render: [.1, .16, .7],
      timber: [.07, .2, .52],
      civic: [.1, .1, .7],
      concrete: [.09, .05, .55],
    },
  },
  nation: {
    drift: .9,
    fallback: [.11, .12, .68],
    palette: {
      render: [.13, .11, .8],
      timber: [.075, .19, .46],
      stone: [.105, .09, .68],
      brick: [.04, .22, .5],
      civic: [.11, .08, .74],
    },
  },
  ocean: {
    drift: 1.05,
    fallback: [.53, .07, .6],
    palette: {
      plank: [.075, .12, .48],
      concrete: [.55, .05, .6],
      render: [.5, .08, .68],
      stone: [.12, .06, .62],
      glass: [.53, .16, .42],
    },
  },
  continent: {
    // Still the most disciplined region, but no longer a single tone. At .3
    // every wall in the capital landed inside a three-percent lightness band
    // around .78, which is why it read as flat cream rather than as stone:
    // there was nothing for a shadow to be darker *than*. The base lightnesses
    // have come down out of the highlights too, so the sun has somewhere to
    // put a highlight and the shaded elevations have somewhere to fall.
    drift: .74,
    fallback: [.09, .1, .59],
    palette: {
      // Warm ashlar limestone — the monumental default.
      civic: [.1, .12, .65],
      // A deeper, browner stone for the ordinary fabric.
      stone: [.085, .14, .55],
      // Plastered infill, the lightest thing on the street.
      render: [.08, .15, .68],
      // Cool grey postwar concrete: the one thing here that is not warm, and
      // therefore what keeps the warm stone reading as warm.
      concrete: [.57, .05, .5],
      // Older brick survivors, kept rare and kept saturated.
      brick: [.035, .25, .43],
      glass: [.55, .15, .41],
    },
  },
  orbit: {
    drift: .6,
    fallback: [.58, .07, .38],
    palette: {
      concrete: [.6, .06, .38],
      glass: [.56, .2, .3],
      stone: [.6, .04, .42],
    },
  },
}

const scratchColor = new THREE.Color()

/** Region-appropriate facade tints, already weathered/varied. */
export function facadeTint(region: FacadeRegion, family: FacadeFamily, seed: number): number {
  const tone = REGION_TONE[region]
  const [hue, saturation, lightness] = tone.palette[family] ?? tone.fallback
  const drift = tone.drift
  const hueJitter = (hashUnit(seed * 2.11 + .7) - .5) * .022 * drift
  const saturationJitter = (hashUnit(seed * 3.71 + 1.9) - .5) * .1 * drift
  // Lightness is the axis neighbours actually read as "different building", so
  // it gets several times the swing the other two do.
  const lightnessJitter = (hashUnit(seed * 5.23 + 3.3) - .5) * .18 * drift
  scratchColor.setHSL(
    (hue + hueJitter + 1) % 1,
    Math.max(0, Math.min(1, saturation + saturationJitter)),
    Math.max(.08, Math.min(.94, lightness + lightnessJitter)),
  )
  return scratchColor.getHex()
}

/**
 * Roof colours are chosen from the roof's own material world — slate, clay,
 * lead, tarred felt, standing-seam metal — rather than from a shift of the wall
 * colour. A roof tinted from its walls is the single clearest giveaway that a
 * building was generated, because in reality the two are bought separately.
 */
const ROOF_BY_FAMILY: Record<FacadeFamily, number> = {
  brick: 0x60483c,
  stone: 0x4f545a,
  render: 0x6f4a38,
  timber: 0x5d3f31,
  glass: 0x59616a,
  concrete: 0x5c6469,
  plank: 0x38342f,
  civic: 0x767c82,
}

const ROOF_BY_REGION: Partial<Record<FacadeRegion, number>> = {
  ocean: 0x413b34,
  continent: 0x7a8087,
  orbit: 0x3b434b,
}

/**
 * Roofs a region covers differently from everywhere else.
 *
 * The Circuit is the one region whose roofs are a *rural* vocabulary rather
 * than an urban one: a timber-framed cottage out here is thatched, not slated,
 * and thatch is far paler than any wall in the village — which is most of what
 * gives a country street its light, broken roofline. Reusing the city's dark
 * timber roof made every cottage read as one brown mass from the map camera.
 */
const ROOF_BY_REGION_FAMILY: Partial<Record<FacadeRegion, Partial<Record<FacadeFamily, number>>>> = {
  nation: {
    // Thatch: straw, weathered grey-gold on the north pitch.
    timber: 0x9c8552,
    // Clay pantile on the rendered cottages, Welsh slate on the stone ones.
    render: 0x7d4c33,
    stone: 0x4a4f57,
    brick: 0x6a4d3c,
  },
}

function roofTint(region: FacadeRegion, family: FacadeFamily, seed: number, target: THREE.Color) {
  const perFamily = ROOF_BY_REGION_FAMILY[region]?.[family]
  const regional = ROOF_BY_REGION[region]
  const base = perFamily !== undefined
    ? perFamily
    : regional !== undefined && (family === 'civic' || family === 'concrete' || family === 'glass' || family === 'plank')
      ? regional
      : ROOF_BY_FAMILY[family]
  return target.setHex(base).offsetHSL(
    (hashUnit(seed * 7.13 + 2.4) - .5) * .02,
    (hashUnit(seed * 9.41 + 5.1) - .5) * .06,
    (hashUnit(seed * 11.7 + 8.2) - .5) * .09,
  )
}

// ---------------------------------------------------------------------------
// Group construction
// ---------------------------------------------------------------------------

/**
 * Repeats are quantised to half a tile — one bay, one storey — so that however
 * odd a building's proportions are, its elevation always ends on a whole window
 * rather than slicing one down the middle at the corner.
 */
function tileRepeat(span: number, tile: number) {
  return Math.max(.5, Math.round(span / tile * 2) / 2)
}

/** Replacement for buildInstancedBlockGroup. Same shape of result: a Group of InstancedMeshes. */
export function buildFacadeGroup(records: FacadeRecord[], options: { region: FacadeRegion }): THREE.Group {
  const group = new THREE.Group()
  if (records.length === 0) return group
  const region = options.region
  const count = records.length

  // The facade geometry is per call site because the per-instance attributes
  // live on it; it is a 24-vertex box, so the allocation is nothing next to the
  // draw call it saves. It is deliberately NOT flagged `mapShared`, so the
  // scene's disposal pass reclaims it on unmount.
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const tileData = new Float32Array(count * 4)
  const varyData = new Float32Array(count * 2)
  const tileAttribute = new THREE.InstancedBufferAttribute(tileData, 4)
  const varyAttribute = new THREE.InstancedBufferAttribute(varyData, 2)
  geometry.setAttribute('aFacadeTile', tileAttribute)
  geometry.setAttribute('aFacadeVary', varyAttribute)

  const facades = new THREE.InstancedMesh(geometry, facadeMaterial(), count)
  const roofs = new THREE.InstancedMesh(sharedRoofGeometry.box, roofMaterial('cap'), count)

  // Silhouette variants are allocated only when the batch actually contains
  // them, so a purely commercial street still costs two draw calls.
  const pitchedCount = records.reduce((total, record) => total + (record.roof === 'pitched' ? 1 : 0), 0)
  const steppedCount = records.reduce((total, record) => total + (record.roof === 'stepped' ? 1 : 0), 0)
  const pitched = pitchedCount ? new THREE.InstancedMesh(sharedRoofGeometry.cone, roofMaterial('pitched'), pitchedCount) : null
  const stepped = steppedCount ? new THREE.InstancedMesh(sharedRoofGeometry.box, roofMaterial('stepped'), steppedCount) : null

  // One dummy and one colour for the entire batch. Allocating either per record
  // is what turned a large district into a garbage-collection spike on mount.
  const dummy = new THREE.Object3D()
  const colour = new THREE.Color()
  let pitchedIndex = 0
  let steppedIndex = 0

  records.forEach((record, index) => {
    const seed = record.seed ?? hashUnit(record.x * 3.11 + record.z * 7.73 + record.width * 1.9 + index)
    const family = record.family ?? familyForRegion(region, seed, { height: record.height })
    const rotationY = record.rotationY ?? 0

    dummy.position.set(record.x, record.height / 2 - .08, record.z)
    dummy.scale.set(record.width, record.height, record.depth)
    dummy.rotation.set(0, rotationY, 0)
    dummy.updateMatrix()
    facades.setMatrixAt(index, dummy.matrix)
    facades.setColorAt(index, colour.setHex(record.color))

    const offset = index * 4
    tileData[offset] = tileRepeat(record.width, TILE_SPAN_X)
    tileData[offset + 1] = tileRepeat(record.height, TILE_SPAN_Y)
    tileData[offset + 2] = tileRepeat(record.depth, TILE_SPAN_X)
    tileData[offset + 3] = FAMILY_INDEX[family]
    // Lit buildings vary in how brightly, so a lit street has depth to it
    // instead of every window burning at the same value.
    varyData[index * 2] = record.lit ? .68 + hashUnit(seed * 13.3 + 6.6) * .5 : 0
    // Hashed rather than passed through. The shader treats this as a fraction —
    // it scales a brightness drift and picks a bay offset with it — and callers
    // supply `record.seed` as whatever number identifies the building, which for
    // the planned districts is a grid ordinal in the thousands. Feeding that in
    // raw multiplied every wall's albedo by several hundred, which is why whole
    // terraces used to render as flat clipped white with their windows burnt
    // out, while the buildings that fell back to the hashed default looked
    // right. Nothing downstream wants the ordinal itself.
    varyData[index * 2 + 1] = hashUnit(seed * 1.913 + 11.7)

    // A parapet stands slightly proud of the facade and hides the roof; a
    // flat/pitched/stepped roof gets a thin eaves band instead.
    const parapet = (record.roof ?? 'parapet') === 'parapet'
    dummy.position.set(record.x, record.height - (parapet ? -.02 : .025), record.z)
    dummy.scale.set(record.width + (parapet ? .1 : .18), parapet ? .2 : .11, record.depth + (parapet ? .09 : .16))
    dummy.updateMatrix()
    roofs.setMatrixAt(index, dummy.matrix)
    // A parapet is coping, which belongs to the wall and is cut from the same
    // stone; an eaves band is fascia and gutter, which belongs to the roof.
    if (parapet) roofs.setColorAt(index, colour.setHex(record.color).offsetHSL(0, -.06, .1))
    else roofs.setColorAt(index, roofTint(region, family, seed, colour))

    if (pitched && record.roof === 'pitched') {
      const ridge = Math.min(record.width, record.depth) * .58
      dummy.position.set(record.x, record.height + ridge / 2, record.z)
      dummy.scale.set(record.width * .78, ridge, record.depth * .78)
      dummy.rotation.set(0, rotationY + Math.PI / 4, 0)
      dummy.updateMatrix()
      pitched.setMatrixAt(pitchedIndex, dummy.matrix)
      pitched.setColorAt(pitchedIndex, roofTint(region, family, seed + 1.7, colour))
      pitchedIndex += 1
      dummy.rotation.set(0, rotationY, 0)
    } else if (stepped && record.roof === 'stepped') {
      const cap = .34 + hashUnit(index * 17) * .5
      dummy.position.set(record.x, record.height + cap / 2, record.z)
      dummy.scale.set(record.width * .58, cap, record.depth * .58)
      dummy.updateMatrix()
      stepped.setMatrixAt(steppedIndex, dummy.matrix)
      // A setback storey is still part of the building, so unlike the roof it
      // does take its colour from the wall below it.
      stepped.setColorAt(steppedIndex, colour.setHex(record.color).offsetHSL(0, -.03, .05))
      steppedIndex += 1
    }
  })

  tileAttribute.needsUpdate = true
  varyAttribute.needsUpdate = true

  const meshes: THREE.InstancedMesh[] = [facades, roofs]
  if (pitched) meshes.push(pitched)
  if (stepped) meshes.push(stepped)
  for (const item of meshes) {
    item.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    item.castShadow = false
    item.receiveShadow = true
    item.frustumCulled = true
    item.computeBoundingSphere()
    if (item.instanceColor) item.instanceColor.needsUpdate = true
  }
  group.add(...meshes)
  return group
}
