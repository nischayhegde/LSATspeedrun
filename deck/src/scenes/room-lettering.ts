import * as THREE from 'three'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js'

import face from './archivo-display.typeface.json'

/**
 * The close's copy, as geometry standing in the close's room.
 *
 * ## Why the copy is in the scene at all
 *
 * Every other slide in the deck sets its copy in the DOM over the stage, and
 * that is the right default: DOM type is the browser's own hinted, subpixel-
 * positioned rendering, it is selectable and readable by a screen reader, and
 * it costs nothing. This slide is the one exception, because the founders asked
 * for the copy to be *in* the room rather than on top of it — lettering that
 * stands in the same space as the figure and takes the same light.
 *
 * ## Why *all* of it moved, including the lines that are not extruded
 *
 * The obvious build is a hybrid: the headline as geometry, the small copy left
 * in the DOM where it is sharpest. It does not survive contact with the deck's
 * own sizing rule. `deck.css` sets `--u: min(1vw, 1.7778vh)`, so DOM type is a
 * fraction of the viewport's *width* on a 16:9 panel and of its *height* on
 * anything taller, while a perspective camera maps a world point to a screen
 * position that depends on the aspect ratio in neither of those two ways. The
 * two agree exactly at 16:9 and drift apart everywhere else, and `deck.css`
 * says in as many words that the deck expects to meet a 16:10 or 4:3 projector.
 * A headline and the sentence under it that share a left edge on the presenter's
 * laptop and miss it by a couple of per cent in the room is a worse outcome than
 * either choice made wholly.
 *
 * So the whole block is one object in world space. It cannot drift against
 * itself, and it reframes with the room on an odd panel exactly as the figure
 * does.
 *
 * ## Extruded and flat, and why the line is drawn where it is
 *
 * `depth` of zero builds `ShapeGeometry` instead of `ExtrudeGeometry` — the same
 * glyph outlines, one face, no sides. Both are vector geometry, so both are
 * resolution-independent; what extrusion buys is a lit edge, and what it costs
 * is that a letter's side faces catch this room's key more squarely than its
 * front does, so every stroke gains a bright rim. On a headline at four units
 * that rim is a chamfer. On a sentence at three quarters of a unit it is a
 * sizeable fraction of the stroke, and it closes up the counters of `a`, `e`
 * and `s`. Hence: display sizes extrude, text sizes do not.
 *
 * The extrusion is shallow and unbevelled on purpose. `bevelEnabled` is three's
 * default-on and is what makes extruded type look like a 1998 title card; a flat
 * chamfer-free side wall is what cut lettering actually has.
 */

/** Parsed once. `FontLoader.parse` is pure and the result is immutable. */
let cached: Font | undefined

function displayFont(): Font {
  // The typeface is Archivo instanced at `--weight-display`, cut by
  // `scripts/make-typeface.py` from the same woff2 the DOM sets. Using a
  // different face here would be visible: this slide is the deck's last, and
  // the eye compares its headline to the twenty-two before it.
  cached ??= new FontLoader().parse(face as unknown as Parameters<FontLoader['parse']>[0])
  return cached
}

export type LetteringLine = {
  readonly text: string
  /** Cap-to-baseline size in world units. */
  readonly size: number
  /** Extrusion in world units. Zero builds a single flat face. */
  readonly depth: number
  readonly color: number
  /**
   * Extra advance between glyphs, as a fraction of `size`. The eyebrow is
   * tracked wide in the DOM and looks wrong at zero here.
   */
  readonly tracking?: number
  /** Baseline drop from the previous line's baseline, in world units. */
  readonly lead: number
  /** Emissive fraction, for the one line that has to hold its value. */
  readonly glow?: number
}

export type LetteringRule = {
  /** Baseline drop from the previous line's baseline, in world units. */
  readonly lead: number
  readonly width: number
  readonly thickness: number
  readonly color: number
  readonly glow: number
}

export type LetteringItem = LetteringLine | LetteringRule

function isRule(item: LetteringItem): item is LetteringRule {
  return 'thickness' in item
}

export type Lettering = {
  readonly group: THREE.Group
  dispose(): void
}

/**
 * Build a left-aligned block of lettering standing in the XY plane, facing +z.
 *
 * The group's origin is the left edge of the first line's baseline, so a caller
 * positions the block by the one point it can reason about — where the headline
 * starts — rather than by a bounding box that moves whenever the copy changes.
 */
export function buildLettering(items: readonly LetteringItem[]): Lettering {
  const font = displayFont()
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  let baseline = 0
  for (const item of items) {
    baseline -= item.lead

    if (isRule(item)) {
      const geometry = new THREE.PlaneGeometry(item.width, item.thickness)
      // Anchored left like the type, not centred like a plane.
      geometry.translate(item.width / 2, item.thickness / 2, 0)
      const material = new THREE.MeshStandardMaterial({
        color: item.color,
        roughness: .5,
        metalness: 0,
        emissive: item.color,
        emissiveIntensity: item.glow,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.y = baseline
      group.add(mesh)
      geometries.push(geometry)
      materials.push(material)
      continue
    }

    const geometry = lineGeometry(font, item)
    const material = new THREE.MeshStandardMaterial({
      color: item.color,
      // Matte. A specular highlight travelling along a stroke as the parallax
      // moves is the single fastest way to make lettering look like chrome.
      roughness: .82,
      metalness: 0,
      ...(item.glow
        ? { emissive: item.color, emissiveIntensity: item.glow }
        : {}),
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = baseline
    /*
      THE LETTERING DOES NOT CAST, AND THIS IS MEASURED RATHER THAN ASSUMED.

      The brief asked for it to, so it was built casting and then turned off on
      evidence: rendering the settled frame with the extruded lines casting and
      again with them not, and differencing the two, gives a difference image
      whose maximum channel value is zero. Not "hard to see" — identical.

      The reason is the key's direction, which is fixed by the figure's shadow
      and is not available to change. It throws upstage and to the left, so a
      letter's shadow lands up to five units left of the letter, and the copy
      is already against the left edge of the frame. Every letter's shadow is
      outside it. What is left inside the frame falls in the strip of floor the
      letter itself occludes from this camera.

      So it cost three draw calls and 10,480 triangles on every frame of a
      slide that is held for the whole question period, to change no pixels.
      Left explicit rather than left to the default, so that restoring
      `item.depth > 0` here is a decision rather than a tidy-up.
    */
    mesh.castShadow = false
    group.add(mesh)
    geometries.push(geometry)
    materials.push(material)
  }

  return {
    group,
    dispose() {
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}

/**
 * One line, as a single geometry.
 *
 * Tracked lines are laid out a glyph at a time and merged, because
 * `TextGeometry` has no letter-spacing and the alternative — a mesh per glyph —
 * would spend a draw call on each letter of a line that exists to be small.
 */
function lineGeometry(font: Font, line: LetteringLine): THREE.BufferGeometry {
  const options = {
    font,
    size: line.size,
    depth: line.depth,
    /*
      Four segments a curve, against three's default of twelve.

      This is per *curve command in the outline*, not per bowl, and a display
      face is drawn with a lot of short ones — Archivo's `O` spends a dozen on
      its outer contour alone. So the segment length is already small before
      anything is subdivided. Measured rather than assumed: sampling every
      curve in the headline at four divisions and again at 256, the furthest
      the coarse polyline ever falls from the true outline is 8.0e-4 world
      units. The headline renders at 138 pixels per unit on a 1920 frame, so
      that is 0.11 of a pixel — under the renderer's own antialiasing, and the
      reason the third-scale test cannot tell the two apart.

      The whole block is 28,912 triangles at four. Three's default of twelve
      makes it 81,616, which is 52,704 triangles a frame — nearly doubling the
      scene — for a tenth of a pixel nobody in the room could see.
    */
    curveSegments: 4,
    bevelEnabled: false,
  }

  if (!line.tracking) return new TextGeometry(line.text, options)

  const merged: THREE.BufferGeometry[] = []
  const extra = line.tracking * line.size
  let pen = 0
  for (const character of line.text) {
    if (character !== ' ') {
      const glyph = new TextGeometry(character, options)
      glyph.translate(pen, 0, 0)
      merged.push(glyph)
    }
    pen += advance(font, character) * line.size + extra
  }
  const geometry = mergeGeometries(merged)
  for (const part of merged) part.dispose()
  return geometry
}

/**
 * Break copy into lines: one sentence a line, wrapped if a sentence overruns.
 *
 * Sentence-first, because both pieces of copy on this slide are built out of
 * two short sentences and the pairing is the writing. "One place." over "Two
 * ways in." is a couplet and the count is the argument; "Walk in and answer
 * questions." over "And build the firm they pay for." is the same shape one
 * size down. A measure-only break puts the fold wherever the width happens to
 * run out — after "One", or leaving "And" stranded at the end of a line — and
 * turns a couplet into a wrap.
 *
 * The measure is still the backstop, because the copy is read out of the slide
 * registry rather than transcribed here: `index.ts` tells writers the headline
 * and the deck line are theirs to edit, and a sentence long enough to run off
 * the left third of the frame has to go somewhere. Greedy is the right
 * algorithm for that case — the balanced break Knuth-Plass would find differs
 * from it only on paragraphs, and there are none here.
 */
export function setCopy(text: string, size: number, measure: number): readonly string[] {
  const font = displayFont()
  const width = (value: string) => {
    let total = 0
    for (const character of value) total += advance(font, character) * size
    return total
  }

  const lines: string[] = []
  // Split after a full stop, question mark or exclamation followed by a space.
  for (const sentence of text.split(/(?<=[.?!])\s+/)) {
    let line = ''
    for (const word of sentence.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (line && width(candidate) > measure) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/** A glyph's advance width, in ems. */
function advance(font: Font, character: string): number {
  const data = font.data as unknown as {
    glyphs: Record<string, { ha: number } | undefined>
    resolution: number
  }
  const glyph = data.glyphs[character] ?? data.glyphs['?']
  return (glyph?.ha ?? data.resolution / 2) / data.resolution
}

/**
 * Concatenate geometries that share an attribute set.
 *
 * three ships `BufferGeometryUtils.mergeGeometries` for this, but importing it
 * pulls the whole utility module — several hundred lines of morph-target and
 * interleaved-buffer handling — for the one case here, which is a handful of
 * non-indexed `TextGeometry` outputs that all carry exactly position, normal
 * and uv.
 */
function mergeGeometries(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv'] as const) {
    const size = parts[0]?.getAttribute(name)?.itemSize ?? 3
    let total = 0
    for (const part of parts) total += part.getAttribute(name).count * size
    const values = new Float32Array(total)
    let at = 0
    for (const part of parts) {
      values.set(part.getAttribute(name).array as Float32Array, at)
      at += part.getAttribute(name).count * size
    }
    merged.setAttribute(name, new THREE.BufferAttribute(values, size))
  }
  return merged
}
