import * as THREE from 'three'

import { CameraRig, PALETTE, disposeTree, labelPlane, seededRandom, smoothstep } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * The instrument panel: what the dashboard actually computes, as an object.
 *
 * Twelve gauges on a curved rack, each labelled with a measure the product really
 * derives, and in front of them the score projection — a band that starts wide
 * and narrows as the sample grows, which is the single most honest thing the
 * dashboard does and the hardest to convey on a chart in a deck.
 *
 * The gauge readings are seeded constants, not live data. The deck has no
 * backend and inventing a live-looking number would be a lie told in 3D; these
 * are stated as illustrative and the slide's copy says so. The *shape* of the
 * projection band, though, is the real behaviour: lower and upper bounds
 * converging on a mean as evidence accumulates.
 */

/** Measures the dashboard genuinely computes. Names, not numbers. */
const GAUGES: Array<{ label: string; fill: number; tint: number }> = [
  { label: 'Speedrun Index', fill: .78, tint: PALETTE.pixelGold },
  { label: 'Overall accuracy', fill: .71, tint: PALETTE.pixelCyan },
  { label: 'Reasoning quality', fill: .64, tint: PALETTE.pixelCyan },
  { label: 'Pace adherence', fill: .83, tint: PALETTE.green },
  { label: 'Review recovery', fill: .69, tint: PALETTE.green },
  { label: 'Confidence calibration', fill: .58, tint: PALETTE.red },
  { label: 'Readiness', fill: .74, tint: PALETTE.pixelGold },
  { label: 'Last 20 vs prior 20', fill: .62, tint: PALETTE.pixelCyan },
  { label: 'Per-type accuracy', fill: .66, tint: PALETTE.pixelCyan },
  { label: 'Method lift (pp)', fill: .52, tint: PALETTE.pixelGold },
  { label: 'Memory stability', fill: .79, tint: PALETTE.green },
  { label: 'Evidence confidence', fill: .61, tint: PALETTE.pixelGold },
]

const BAND_SEGMENTS = 96

export function createMetricsScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x070c15)
  scene.fog = new THREE.FogExp2(0x070c15, .019)

  const rig = new CameraRig(
    {
      panel: { position: [0, 1.1, 15.4], target: [0, 1.2, 0], fov: 38, parallax: 1 },
      band: { position: [-1.4, .4, 7.2], target: [.6, .1, -.6], fov: 32, parallax: .5 },
      wide: { position: [8.6, 4.4, 17], target: [-1, 1, -1], fov: 44, parallax: .8 },
    },
    'panel',
    context.width / Math.max(1, context.height),
  )

  scene.add(new THREE.HemisphereLight(0x30506c, 0x070a10, 1.05))
  const key = new THREE.DirectionalLight(0xffeed2, 1.55)
  key.position.set(-6, 11, 12)
  scene.add(key)
  const fill = new THREE.DirectionalLight(PALETTE.pixelCyan, .5)
  fill.position.set(8, 3, 6)
  scene.add(fill)

  const materials: THREE.Material[] = []
  const track = (options: THREE.MeshStandardMaterialParameters) => {
    const made = new THREE.MeshStandardMaterial(options)
    materials.push(made)
    return made
  }
  const basic = (options: THREE.MeshBasicMaterialParameters) => {
    const made = new THREE.MeshBasicMaterial(options)
    materials.push(made)
    return made
  }

  const rackMaterial = track({ color: 0x121d2b, roughness: .88, metalness: .06 })
  const chipMaterial = track({ color: 0x0d1622, roughness: .82, metalness: .04 })
  const labelMaterials: THREE.Material[] = []

  // --- the rack ------------------------------------------------------------
  // Twelve chips on a shallow cylinder, in three rows of four, so the whole panel
  // faces the camera without any of it being edge-on. Curvature rather than a
  // flat wall because a flat wall of tiles at this width has to be shot from far
  // enough back that nothing on it is legible.
  const gauges: Array<{ bar: THREE.Mesh; fill: number; glow: THREE.Mesh }> = []
  const rackRadius = 9.6
  for (let index = 0; index < GAUGES.length; index += 1) {
    const gauge = GAUGES[index]
    const column = index % 4
    const row = Math.floor(index / 4)
    const angle = (column - 1.5) * .175
    const y = 3.1 - row * 1.62

    const holder = new THREE.Group()
    holder.position.set(Math.sin(angle) * rackRadius, y, Math.cos(angle) * rackRadius - rackRadius)
    holder.rotation.y = -angle
    scene.add(holder)

    // The chip carries the pixel bevel's logic in geometry: a recessed dark
    // panel inside a raised frame, which is what the app's `inset` box-shadow
    // draws in two dimensions.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.3, .22), rackMaterial)
    holder.add(frame)
    const recess = new THREE.Mesh(new THREE.BoxGeometry(3.24, 1.06, .1), chipMaterial)
    recess.position.z = .1
    holder.add(recess)

    const label = labelPlane(gauge.label, .2, {
      pixels: 40, weight: 700, font: 'Archivo, sans-serif', color: '#cfd8dd', letterSpacing: .6,
    })
    label.position.set(-1.5 + (label.geometry as THREE.PlaneGeometry).parameters.width / 2, .34, .17)
    holder.add(label)
    labelMaterials.push(label.material as THREE.Material)

    // The bar. Scaled on X from a left-anchored geometry, so `scale.x` is
    // literally the reading and there is no pivot arithmetic to get wrong.
    const barGeometry = new THREE.BoxGeometry(2.9, .3, .12)
    barGeometry.translate(1.45, 0, 0)
    const barMaterial = track({ color: gauge.tint, roughness: .38, metalness: .3, emissive: new THREE.Color(gauge.tint).multiplyScalar(.16) })
    materials.push(barMaterial)
    const bar = new THREE.Mesh(barGeometry, barMaterial)
    bar.position.set(-1.45, -.18, .17)
    bar.scale.x = 0
    holder.add(bar)

    const trough = new THREE.Mesh(new THREE.BoxGeometry(2.9, .3, .06), chipMaterial)
    trough.position.set(0, -.18, .15)
    holder.add(trough)

    // An additive sliver at the head of the bar, so a reading has a bright tip
    // rather than a flat end. Additive and depth-write-off, so the contour pass
    // does not outline it.
    const glowMaterial = basic({
      color: gauge.tint, transparent: true, opacity: .5, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    })
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(.22, .46), glowMaterial)
    glow.position.set(-1.45, -.18, .26)
    holder.add(glow)

    gauges.push({ bar, fill: gauge.fill, glow })
  }

  // --- the projection band -------------------------------------------------
  // Two curves and the ribbon between them. `x` is evidence accumulating left to
  // right; the mean climbs and the bounds close in on it. Built as an explicit
  // vertex strip rather than as a mesh from a shape, because the geometry is
  // rewritten every frame during the reveal and a strip is the one form where
  // that is a single attribute update.
  const bandGroup = new THREE.Group()
  bandGroup.position.set(.4, -1.15, 4.4)
  scene.add(bandGroup)

  const bandPositions = new Float32Array((BAND_SEGMENTS + 1) * 2 * 3)
  const bandIndices: number[] = []
  for (let segment = 0; segment < BAND_SEGMENTS; segment += 1) {
    const a = segment * 2
    bandIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const bandGeometry = new THREE.BufferGeometry()
  bandGeometry.setAttribute('position', new THREE.BufferAttribute(bandPositions, 3))
  bandGeometry.setIndex(bandIndices)
  const bandMaterial = basic({
    color: PALETTE.pixelGold, transparent: true, opacity: .2, side: THREE.DoubleSide,
    depthWrite: false, toneMapped: false,
  })
  const band = new THREE.Mesh(bandGeometry, bandMaterial)
  bandGroup.add(band)

  const meanPositions = new Float32Array((BAND_SEGMENTS + 1) * 3)
  const meanGeometry = new THREE.BufferGeometry()
  meanGeometry.setAttribute('position', new THREE.BufferAttribute(meanPositions, 3))
  const meanMaterial = new THREE.LineBasicMaterial({ color: PALETTE.pixelGold, transparent: true, opacity: .95 })
  materials.push(meanMaterial)
  const meanLine = new THREE.Line(meanGeometry, meanMaterial)
  bandGroup.add(meanLine)

  const edgePositions = new Float32Array((BAND_SEGMENTS + 1) * 2 * 3)
  const edgeGeometry = new THREE.BufferGeometry()
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3))
  const edgeMaterial = new THREE.LineBasicMaterial({ color: PALETTE.pixelCyan, transparent: true, opacity: .55 })
  materials.push(edgeMaterial)
  const upperEdge = new THREE.Line(edgeGeometry, edgeMaterial)
  bandGroup.add(upperEdge)

  const WIDTH = 8.4
  const HEIGHT = 2.5
  /** Where the mean sits, 0..1 of the plot height, at evidence `t`. */
  const meanAt = (t: number) => .34 + smoothstep(t) * .46
  /** Half-width of the interval at evidence `t`. Wide and early, tight and late. */
  const spreadAt = (t: number) => (.3 - t * .245) * (1 + Math.sin(t * 9) * .05)

  let reveal = context.reduced ? 1 : 0

  const writeBand = () => {
    const shown = Math.max(2, Math.floor(reveal * BAND_SEGMENTS))
    for (let segment = 0; segment <= BAND_SEGMENTS; segment += 1) {
      // Everything past the reveal front is pinned to the front, which collapses
      // the unrevealed triangles to zero area rather than drawing them. Cheaper
      // and more robust than re-indexing the geometry every frame.
      const clamped = Math.min(segment, shown)
      const t = clamped / BAND_SEGMENTS
      const x = (t - .5) * WIDTH
      const centre = meanAt(t) * HEIGHT
      const spread = spreadAt(t) * HEIGHT
      bandPositions[segment * 6] = x
      bandPositions[segment * 6 + 1] = centre - spread
      bandPositions[segment * 6 + 2] = 0
      bandPositions[segment * 6 + 3] = x
      bandPositions[segment * 6 + 4] = centre + spread
      bandPositions[segment * 6 + 5] = 0
      meanPositions[segment * 3] = x
      meanPositions[segment * 3 + 1] = centre
      meanPositions[segment * 3 + 2] = .01
      edgePositions[segment * 3] = x
      edgePositions[segment * 3 + 1] = centre + spread
      edgePositions[segment * 3 + 2] = .01
    }
    bandGeometry.attributes.position.needsUpdate = true
    meanGeometry.attributes.position.needsUpdate = true
    edgeGeometry.attributes.position.needsUpdate = true
  }
  writeBand()

  const bandLabel = labelPlane('SCORE PROJECTION — bounds narrow as evidence accumulates', .2, {
    pixels: 40, weight: 700, font: '"Courier New", monospace', letterSpacing: 1.6, color: 'rgba(246,231,191,.8)', align: 'center',
  })
  bandLabel.position.set(0, -.42, .02)
  bandGroup.add(bandLabel)
  labelMaterials.push(bandLabel.material as THREE.Material)

  // --- the constellation behind it -----------------------------------------
  // The product ships an endgame cosmetic literally called the justice
  // constellation, so the metric wall is backed by one: points on a shell with
  // faint chords between the near ones.
  const random = seededRandom(90210)
  const starCount = 240
  const starPositions = new Float32Array(starCount * 3)
  const nodes: THREE.Vector3[] = []
  for (let index = 0; index < starCount; index += 1) {
    const node = new THREE.Vector3(
      (random() - .5) * 52,
      (random() - .1) * 22,
      -14 - random() * 30,
    )
    nodes.push(node)
    node.toArray(starPositions, index * 3)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMaterial = new THREE.PointsMaterial({
    color: 0xbfe4ef, size: .16, sizeAttenuation: true, transparent: true, opacity: .55,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })
  materials.push(starMaterial)
  const constellation = new THREE.Points(starGeometry, starMaterial)
  scene.add(constellation)

  const chords: number[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    for (let other = index + 1; other < nodes.length; other += 1) {
      if (nodes[index].distanceTo(nodes[other]) > 5.2) continue
      chords.push(...nodes[index].toArray(), ...nodes[other].toArray())
      // A cap, because the pair loop is quadratic and a constellation with four
      // thousand chords in it is a fog bank.
      if (chords.length > 2400) break
    }
    if (chords.length > 2400) break
  }
  const chordGeometry = new THREE.BufferGeometry()
  chordGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(chords), 3))
  const chordMaterial = new THREE.LineBasicMaterial({
    color: PALETTE.pixelCyan, transparent: true, opacity: .1, blending: THREE.AdditiveBlending, depthWrite: false,
  })
  materials.push(chordMaterial)
  const chordLines = new THREE.LineSegments(chordGeometry, chordMaterial)
  scene.add(chordLines)

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      if (!context.reduced) {
        reveal = Math.min(1, reveal + delta / 3.4)
        writeBand()
        for (let index = 0; index < gauges.length; index += 1) {
          const gauge = gauges[index]
          // Each gauge fills over its own window, in reading order, so the panel
          // comes up like an instrument rack powering on rather than all at once.
          const local = (reveal * 1.5 - index * .055) / .5
          const value = gauge.fill * smoothstep(local)
          gauge.bar.scale.x = value
          gauge.glow.position.x = -1.45 + value * 2.9
          const glowMaterial = gauge.glow.material as THREE.MeshBasicMaterial
          glowMaterial.opacity = value > .02 ? .35 + Math.sin(elapsed * 2.4 + index) * .12 : 0
        }
        constellation.rotation.y = Math.sin(elapsed * .05) * .06
        chordLines.rotation.y = constellation.rotation.y
      }
      bandLabel.lookAt(rig.camera.position)
      rig.update(delta, context.pointer)
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      rig.go(name, immediate, 1.9)
    },

    dispose() {
      disposeTree(scene)
      for (const entry of [...materials, ...labelMaterials]) entry.dispose()
      for (const geometry of [bandGeometry, meanGeometry, edgeGeometry, starGeometry, chordGeometry]) {
        geometry.dispose()
      }
    },
  }
}
