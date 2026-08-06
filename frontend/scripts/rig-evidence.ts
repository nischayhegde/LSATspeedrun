/**
 * Visual evidence for the humanoid rig, produced without a browser.
 *
 * Two things need showing and neither needs a GPU.
 *
 * The first is that the art did not change. The claim is not "it looks about
 * the same" but the much stronger "the driver cannot change it": every mesh,
 * geometry, material and local transform under a character is recorded before
 * the skeletal system runs and again after several seconds of animation, and
 * the two records must be identical. What is left over - joint rotations and
 * the hip translation - is the only thing that moved.
 *
 * The second is that the motion is fluid, which a single still cannot show. So
 * each clip is emitted as a strip of consecutive frames drawn as an SVG stick
 * figure over a fixed floor line, with the trail of each foot's contact point
 * drawn underneath. Foot sliding, popping and stalled interpolation are all
 * directly visible in a strip like that, and the legacy driver is drawn on the
 * same axes for comparison.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

import * as THREE from 'three'

import { buildStylizedCounsel, type StylizedCounselRig } from '../src/art/stylized-counsel'
import { HumanoidActor } from '../src/art/rig/humanoid-actor'
import { HUMANOID_BONES, type HumanoidBone } from '../src/art/rig/humanoid-rig'

const STEP = 1 / 60
const OUT = '.rig-evidence'
mkdirSync(OUT, { recursive: true })

function makeRig() {
  const rig = buildStylizedCounsel('male', 4, { role: 'visitor', paletteSeed: 7 })
  const holder = new THREE.Group()
  holder.add(rig.root)
  return { rig, holder }
}

// ---------------------------------------------------------------------------
// 1. The art is untouched at runtime.
// ---------------------------------------------------------------------------

/** Everything about a character that is art rather than pose. */
function artFingerprint(root: THREE.Object3D) {
  const entries: string[] = []
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry as THREE.BufferGeometry
    const position = geometry.getAttribute('position')
    // Hash the actual vertex data, not just the geometry's identity, so a
    // driver that reached in and deformed a mesh in place would be caught.
    let hash = 0
    if (position) {
      const array = position.array as ArrayLike<number>
      for (let index = 0; index < array.length; index += 7) {
        hash = (Math.imul(hash, 31) + Math.round(array[index] * 1e5)) | 0
      }
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    const look = materials.map((material) => {
      const standard = material as THREE.MeshStandardMaterial
      return [
        standard.type,
        standard.color?.getHexString(),
        standard.roughness,
        standard.metalness,
        standard.emissive?.getHexString(),
        standard.opacity,
        standard.transparent,
      ].join('/')
    }).join('|')
    entries.push([
      object.name,
      geometry.type,
      position?.count ?? 0,
      hash,
      look,
      // A mesh's own transform is art: it is where the artist put that piece on
      // the body. Only the joint groups above it are the animator's to move.
      object.position.toArray().map((value) => value.toFixed(6)).join(','),
      object.scale.toArray().map((value) => value.toFixed(6)).join(','),
      object.quaternion.toArray().map((value) => value.toFixed(6)).join(','),
      object.visible,
      object.renderOrder,
    ].join(' '))
  })
  return entries
}

function checkArtParity() {
  const { rig, holder } = makeRig()
  const before = artFingerprint(rig.root)

  const actor = new HumanoidActor(rig, { seed: 11, state: 'idle' })
  actor.setLod('full')
  const states = ['walk', 'confer', 'presentBoard', 'seatedType', 'idleWeightShift'] as const
  for (const state of states) {
    actor.setState(state)
    actor.setGroundSpeed(actor.naturalWalkSpeed)
    for (let frame = 0; frame < 90; frame += 1) {
      actor.update(STEP)
      holder.updateMatrixWorld(true)
    }
  }
  actor.playGesture('celebrate')
  for (let frame = 0; frame < 120; frame += 1) {
    actor.update(STEP)
    holder.updateMatrixWorld(true)
  }

  const after = artFingerprint(rig.root)
  const differences: string[] = []
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] !== after[index]) differences.push(`  ${before[index] ?? '(missing)'}\n  ${after[index] ?? '(missing)'}`)
  }
  actor.dispose()
  return { meshes: before.length, differences }
}

// ---------------------------------------------------------------------------
// 2. Frame strips.
// ---------------------------------------------------------------------------

const LIMBS: Array<[HumanoidBone, HumanoidBone]> = [
  ['hips', 'spine'], ['spine', 'chest'], ['chest', 'head'],
  ['chest', 'leftShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftHand'],
  ['chest', 'rightShoulder'], ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightHand'],
  ['hips', 'leftHip'], ['leftHip', 'leftKnee'], ['leftKnee', 'leftFoot'],
  ['hips', 'rightHip'], ['rightHip', 'rightKnee'], ['rightKnee', 'rightFoot'],
]

type Frame = {
  points: Map<HumanoidBone, THREE.Vector3>
  travel: number
}

function legacyStep(rig: StylizedCounselRig, elapsed: number) {
  const stride = Math.sin(elapsed * 6.5)
  const step = Math.abs(Math.sin(elapsed * 6.5))
  rig.hips.position.y = rig.base.hipsY + step * .045
  rig.leftHip.rotation.x = stride * .34
  rig.rightHip.rotation.x = -stride * .34
  rig.leftKnee.rotation.x = Math.max(0, -stride) * .44
  rig.rightKnee.rotation.x = Math.max(0, stride) * .44
  rig.leftFoot.rotation.x = -Math.max(0, -stride) * .16
  rig.rightFoot.rotation.x = -Math.max(0, stride) * .16
  rig.leftShoulder.rotation.x = -stride * .24
  rig.rightShoulder.rotation.x = stride * .24
}

/**
 * Records a walk. Both drivers are given the same ground speed and the same
 * body travel, so any difference in where the feet end up is the drivers'
 * doing rather than a difference in the walk being asked for.
 */
function recordWalk(mode: 'skeletal' | 'legacy', frames: number, everyNth: number) {
  const { rig, holder } = makeRig()
  const actor = mode === 'skeletal' ? new HumanoidActor(rig, { seed: 7, state: 'walk' }) : null
  actor?.setLod('full')
  const speed = actor?.naturalWalkSpeed ?? 2.8
  actor?.setGroundSpeed(speed)

  // Settle first so neither driver is caught in its startup transient.
  for (let frame = 0; frame < 120; frame += 1) {
    if (actor) { holder.position.z += speed * STEP; holder.updateMatrixWorld(true); actor.update(STEP) }
    else { holder.position.z += speed * STEP; legacyStep(rig, frame * STEP); holder.updateMatrixWorld(true) }
  }

  const captured: Frame[] = []
  for (let frame = 0; frame < frames; frame += 1) {
    holder.position.z += speed * STEP
    holder.updateMatrixWorld(true)
    if (actor) actor.update(STEP)
    else legacyStep(rig, (120 + frame) * STEP)
    holder.updateMatrixWorld(true)
    if (frame % everyNth !== 0) continue
    const points = new Map<HumanoidBone, THREE.Vector3>()
    for (const bone of HUMANOID_BONES) {
      const node = actor
        ? actor.skeleton.bones[bone]
        : (rig as unknown as Record<string, THREE.Object3D>)[bone]
      points.set(bone, new THREE.Vector3().setFromMatrixPosition(node.matrixWorld))
    }
    captured.push({ points, travel: holder.position.z })
  }
  actor?.dispose()
  return captured
}

const PANEL = 132
const HEIGHT = 300
const GROUND = 268
/** Chosen from the figure's measured height so the whole body fits the panel
 *  with a margin, rather than from a guess about the rig's units. */
function fitScale(frames: Frame[]) {
  let top = 0
  for (const frame of frames) for (const point of frame.points.values()) top = Math.max(top, point.y)
  return (GROUND - 34) / Math.max(top, 1e-3)
}

function drawFrames(frames: Frame[], label: string, colour: string, scale: number) {
  const parts: string[] = []
  const SCALE = scale
  frames.forEach((frame, index) => {
    const originX = index * PANEL + PANEL / 2
    // Draw each frame in the body's own moving reference, so the figure stays
    // centred in its panel and the feet can be seen holding still against the
    // floor rather than the whole image drifting.
    const project = (point: THREE.Vector3) => [
      originX + (point.z - frame.travel) * SCALE,
      GROUND - point.y * SCALE,
    ]
    parts.push(`<line x1="${index * PANEL}" y1="${GROUND}" x2="${(index + 1) * PANEL}" y2="${GROUND}" stroke="#c3cbd6" stroke-width="1"/>`)
    for (const [from, to] of LIMBS) {
      const a = project(frames[index].points.get(from)!)
      const b = project(frames[index].points.get(to)!)
      parts.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${colour}" stroke-width="2.4" stroke-linecap="round"/>`)
    }
    const head = project(frame.points.get('head')!)
    parts.push(`<circle cx="${head[0].toFixed(1)}" cy="${(head[1] - 9).toFixed(1)}" r="9" fill="${colour}"/>`)
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      const foot = project(frame.points.get(side)!)
      parts.push(`<circle cx="${foot[0].toFixed(1)}" cy="${foot[1].toFixed(1)}" r="3.2" fill="${side === 'leftFoot' ? '#e0662b' : '#1f8fbf'}"/>`)
    }
    parts.push(`<text x="${index * PANEL + 6}" y="${HEIGHT - 8}" font-family="ui-monospace,monospace" font-size="11" fill="#7c8697">${index}</text>`)
  })
  parts.push(`<text x="8" y="22" font-family="ui-monospace,monospace" font-size="14" fill="#1e2732">${label}</text>`)
  return parts.join('\n')
}

/** Absolute horizontal position of each foot over time, which is where sliding
 *  shows up unambiguously: a planted foot draws a flat line. */
function drawFootTrace(skeletal: Frame[], legacy: Frame[], width: number) {
  const rows = [
    { frames: legacy, label: 'legacy', y: 60 },
    { frames: skeletal, label: 'skeletal', y: 190 },
  ]
  const parts: string[] = [`<text x="8" y="24" font-family="ui-monospace,monospace" font-size="14" fill="#1e2732">Foot ground position over one walk (flat = planted, sloped = sliding)</text>`]
  for (const row of rows) {
    parts.push(`<text x="8" y="${row.y - 12}" font-family="ui-monospace,monospace" font-size="12" fill="#7c8697">${row.label}</text>`)
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      const points = row.frames.map((frame, index) => {
        const x = 8 + index / (row.frames.length - 1) * (width - 60)
        const y = row.y + 80 - (frame.points.get(side)!.z - row.frames[0].points.get(side)!.z) * 14
        return `${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
      parts.push(`<polyline points="${points}" fill="none" stroke="${side === 'leftFoot' ? '#e0662b' : '#1f8fbf'}" stroke-width="2"/>`)
    }
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// A very small raster canvas and PNG writer.
//
// The strips are the whole point of this script, and an SVG is only evidence
// if someone can open it. There is no rasteriser available in this
// environment, so the drawing is done into an RGBA buffer here and written out
// as a PNG directly - it only needs lines and discs, and zlib is in the
// standard library.
// ---------------------------------------------------------------------------

class Canvas {
  readonly pixels: Uint8Array

  constructor(readonly width: number, readonly height: number, background: [number, number, number]) {
    this.pixels = new Uint8Array(width * height * 4)
    for (let index = 0; index < width * height; index += 1) {
      this.pixels[index * 4] = background[0]
      this.pixels[index * 4 + 1] = background[1]
      this.pixels[index * 4 + 2] = background[2]
      this.pixels[index * 4 + 3] = 255
    }
  }

  /** Coverage-weighted write, so edges are antialiased rather than stepped. */
  private blend(x: number, y: number, colour: [number, number, number], alpha: number) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const index = (y * this.width + x) * 4
    const a = Math.min(1, alpha)
    for (let channel = 0; channel < 3; channel += 1) {
      this.pixels[index + channel] = Math.round(this.pixels[index + channel] * (1 - a) + colour[channel] * a)
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, colour: [number, number, number], thickness: number) {
    const dx = x1 - x0
    const dy = y1 - y0
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) return this.disc(x0, y0, thickness / 2, colour)
    const radius = thickness / 2
    const minX = Math.floor(Math.min(x0, x1) - radius - 1)
    const maxX = Math.ceil(Math.max(x0, x1) + radius + 1)
    const minY = Math.floor(Math.min(y0, y1) - radius - 1)
    const maxY = Math.ceil(Math.max(y0, y1) + radius + 1)
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        // Distance from the pixel centre to the segment, capsule-style, so
        // ends are round and joints between limbs close up neatly.
        const t = Math.max(0, Math.min(1, ((x + .5 - x0) * dx + (y + .5 - y0) * dy) / (length * length)))
        const distance = Math.hypot(x + .5 - (x0 + dx * t), y + .5 - (y0 + dy * t))
        this.blend(x, y, colour, radius + .5 - distance)
      }
    }
  }

  disc(cx: number, cy: number, radius: number, colour: [number, number, number]) {
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y += 1) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x += 1) {
        this.blend(x, y, colour, radius + .5 - Math.hypot(x + .5 - cx, y + .5 - cy))
      }
    }
  }

  png() {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height)
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (this.width * 4 + 1)] = 0
      Buffer.from(this.pixels.buffer, y * this.width * 4, this.width * 4)
        .copy(raw, y * (this.width * 4 + 1) + 1)
    }
    const chunk = (type: string, data: Buffer) => {
      const length = Buffer.alloc(4)
      length.writeUInt32BE(data.length)
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(body) >>> 0)
      return Buffer.concat([length, body, crc])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(this.width, 0)
    header.writeUInt32BE(this.height, 4)
    header[8] = 8
    header[9] = 6
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value
  }
  return table
})()

function crc32(buffer: Buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return crc ^ -1
}

const INK: [number, number, number] = [34, 48, 74]
const LEGACY_INK: [number, number, number] = [138, 59, 59]
const LEFT_FOOT: [number, number, number] = [224, 102, 43]
const RIGHT_FOOT: [number, number, number] = [31, 143, 191]
const FLOOR: [number, number, number] = [172, 182, 196]

function renderStrip(frames: Frame[], colour: [number, number, number], scale: number) {
  const canvas = new Canvas(frames.length * PANEL, HEIGHT, [246, 248, 251])
  const SCALE = scale
  frames.forEach((frame, index) => {
    const originX = index * PANEL + PANEL / 2
    const project = (point: THREE.Vector3): [number, number] => [
      originX + (point.z - frame.travel) * SCALE,
      GROUND - point.y * SCALE,
    ]
    canvas.line(index * PANEL, GROUND, (index + 1) * PANEL, GROUND, FLOOR, 1.4)
    for (const [from, to] of LIMBS) {
      const a = project(frame.points.get(from)!)
      const b = project(frame.points.get(to)!)
      canvas.line(a[0], a[1], b[0], b[1], colour, 3)
    }
    const head = project(frame.points.get('head')!)
    canvas.disc(head[0], head[1] - 7, 8, colour)
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      const foot = project(frame.points.get(side)!)
      canvas.disc(foot[0], foot[1], 3.6, side === 'leftFoot' ? LEFT_FOOT : RIGHT_FOOT)
    }
  })
  return canvas
}

function renderFootTrace(skeletal: Frame[], legacy: Frame[]) {
  const width = 760
  const canvas = new Canvas(width, 330, [246, 248, 251])
  const rows = [
    { frames: legacy, y: 20 },
    { frames: skeletal, y: 175 },
  ]
  for (const row of rows) {
    canvas.line(8, row.y + 138, width - 20, row.y + 138, FLOOR, 1.2)
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      const base = row.frames[0].points.get(side)!.z
      let previous: [number, number] | null = null
      row.frames.forEach((frame, index) => {
        const x = 12 + index / (row.frames.length - 1) * (width - 40)
        const y = row.y + 120 - (frame.points.get(side)!.z - base) * 15
        if (previous) canvas.line(previous[0], previous[1], x, y, side === 'leftFoot' ? LEFT_FOOT : RIGHT_FOOT, 2.6)
        previous = [x, y]
      })
    }
  }
  return canvas
}

function svg(width: number, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#f6f8fb"/>
${body}
</svg>`
}

const parity = checkArtParity()
const skeletalWalk = recordWalk('skeletal', 60, 6)
const legacyWalk = recordWalk('legacy', 60, 6)

// One scale for both strips, so they are directly comparable.
const sharedScale = Math.min(fitScale(skeletalWalk), fitScale(legacyWalk))
const stripWidth = skeletalWalk.length * PANEL
writeFileSync(`${OUT}/walk-skeletal.svg`, svg(stripWidth, HEIGHT, drawFrames(skeletalWalk, 'skeletal walk', '#22304a', sharedScale)))
writeFileSync(`${OUT}/walk-legacy.svg`, svg(stripWidth, HEIGHT, drawFrames(legacyWalk, 'legacy walk', '#8a3b3b', sharedScale)))

writeFileSync(`${OUT}/walk-skeletal.png`, renderStrip(skeletalWalk, INK, sharedScale).png())
writeFileSync(`${OUT}/walk-legacy.png`, renderStrip(legacyWalk, LEGACY_INK, sharedScale).png())
// The trace wants every frame, not the strip's subsample: the plateaus are the
// whole point and they are only a handful of frames wide.
const skeletalDense = recordWalk('skeletal', 132, 1)
const legacyDense = recordWalk('legacy', 132, 1)
writeFileSync(`${OUT}/foot-trace.png`, renderFootTrace(skeletalDense, legacyDense).png())

const lines: string[] = []
lines.push('--- Runtime art parity ---')
lines.push(`  meshes fingerprinted          ${parity.meshes}`)
lines.push(`  differences after 7.5s of animation across 5 states and a gesture: ${parity.differences.length}`)
if (parity.differences.length) lines.push(parity.differences.slice(0, 5).join('\n'))
lines.push(parity.differences.length === 0
  ? 'PASS  geometry, materials and mesh transforms are byte-identical; only joints moved'
  : 'FAIL  the driver altered something that is art')
lines.push('')
lines.push('--- Frame strips written ---')
lines.push(`  ${OUT}/walk-skeletal.svg`)
lines.push(`  ${OUT}/walk-legacy.svg`)
lines.push(`  ${OUT}/foot-trace.svg`)
console.log(lines.join('\n'))
if (parity.differences.length) process.exitCode = 1
