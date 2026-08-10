import * as THREE from 'three'

import { CameraRig, PALETTE, disposeTree, seededRandom } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * The scene a slide with no scene gets.
 *
 * Not an empty canvas and not a hidden one. Two reasons. First, the deck's
 * transition system composites the outgoing and incoming *frames*, so every
 * slide needs a frame — making the canvas absent for some slides would mean two
 * separate transition paths and one of them would be the one that breaks on
 * stage. Second, a slide of pure copy over a flat field looks like a slide, and
 * the brief was that it should not.
 *
 * So it is a held wide shot of nothing: a floor lit from one side, an engraved
 * plane far behind, a slow drift of motes. It costs three draw calls and it is
 * the thing text sits on for most of Act I and Act II.
 */
export function createBackdropScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.stage)
  scene.fog = new THREE.FogExp2(0x05080d, .021)

  const rig = new CameraRig(
    {
      // Three framings that are all the same shot from slightly different
      // places. Consecutive copy slides can therefore share this scene and still
      // get a continuous, almost imperceptible camera move between them, which is
      // the parallax the brief asks for without a scene change.
      still: { position: [0, 3.4, 16], target: [0, 2.4, -4], fov: 42, parallax: 1 },
      drift: { position: [-4.2, 2.6, 14.5], target: [1.6, 2.2, -5], fov: 46, parallax: 1 },
      low: { position: [2.8, 1.3, 12], target: [-1.4, 3.1, -6], fov: 50, parallax: 1 },
    },
    'still',
    context.width / Math.max(1, context.height),
  )

  scene.add(new THREE.HemisphereLight(0x24435c, 0x04060a, .95))
  const key = new THREE.DirectionalLight(0xffe8c4, 1.35)
  key.position.set(-9, 8, 7)
  scene.add(key)
  const edge = new THREE.PointLight(PALETTE.gold, 22, 26, 2)
  edge.position.set(6, 2.2, 3)
  scene.add(edge)

  const materials: THREE.Material[] = []
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x0c1420, roughness: .94, metalness: .03 })
  materials.push(floorMaterial)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  // Ribs across the floor, receding. The only structure in the shot, and what
  // gives the parallax something to be measured against — a camera moving over a
  // featureless plane is a camera that appears not to move.
  const ribMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.navy2, roughness: .8, metalness: .1 })
  materials.push(ribMaterial)
  for (let index = 0; index < 22; index += 1) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(70, .06, .16), ribMaterial)
    rib.position.set(0, .03, 4 - index * 3.1)
    scene.add(rib)
  }

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x0e1a28, roughness: .96, metalness: 0 })
  materials.push(wallMaterial)
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(140, 44), wallMaterial)
  wall.position.set(0, 21, -46)
  scene.add(wall)

  const random = seededRandom(7716)
  const moteCount = 260
  const positions = new Float32Array(moteCount * 3)
  const speeds = new Float32Array(moteCount)
  for (let index = 0; index < moteCount; index += 1) {
    positions[index * 3] = (random() - .5) * 54
    positions[index * 3 + 1] = random() * 16
    positions[index * 3 + 2] = -random() * 40 + 6
    speeds[index] = .06 + random() * .2
  }
  const moteGeometry = new THREE.BufferGeometry()
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const moteMaterial = new THREE.PointsMaterial({
    color: 0xffdda0, size: .075, sizeAttenuation: true, transparent: true, opacity: .42,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })
  materials.push(moteMaterial)
  const motes = new THREE.Points(moteGeometry, moteMaterial)
  scene.add(motes)

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      if (!context.reduced) {
        const attribute = moteGeometry.attributes.position as THREE.BufferAttribute
        for (let index = 0; index < moteCount; index += 1) {
          const y = attribute.getY(index) + speeds[index] * delta
          attribute.setY(index, y > 17 ? -.5 : y)
        }
        attribute.needsUpdate = true
        edge.intensity = 22 + Math.sin(elapsed * .6) * 5
      }
      rig.update(delta, context.pointer)
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      // Slow, because the audience is reading during this move and a camera that
      // arrives is a camera that interrupts.
      rig.go(name, immediate, 4.5)
    },

    dispose() {
      disposeTree(scene)
      for (const material of materials) material.dispose()
      moteGeometry.dispose()
    },
  }
}
