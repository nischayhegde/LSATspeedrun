import * as THREE from 'three'

import { PALETTE } from './scene-kit'

/**
 * The navy cyclorama and Luxo rig shared by counsel-stage and burnout.
 *
 * Both slides are the same room. Slide 10 (`pov-volume-burns`) holds the
 * lockup in that room while a few sheets fall; slide 11 (`concept-lawyer-tycoon`)
 * walks a counsel across it and pulls the next claim on by hand. Building the
 * shell twice — even from the same numbers — is how a cut between them grows
 * a seam: a wash that sat 20cm left, a key that was 3% hotter, a ground disc
 * that wrote depth on one slide and not the other. One builder, one room.
 */

export const NAVY_STAGE = {
  field: PALETTE.navy,
  goldHot: PALETTE.pixelGold,
} as const

export const NAVY_SHADOW = { size: 2048, bias: -.0014 } as const

/**
 * A soft radial wash, for laying light on the cyclorama and pooling it on the
 * floor.
 *
 * The room has to be readable as a room without there being a room: the hard
 * requirement is no seam between wall and floor, so there is no wall and no
 * floor, only a navy shell and a shadow. What tells the eye where the ground is
 * is that the light falls off — a flat field with a figure on it reads as a
 * cut-out, and the previous pass at this scene was described in review as a
 * black void for exactly that reason.
 */
export function wash(width: number, depth: number, colour: string, opacity: number) {
  const size = 256
  const surface = document.createElement('canvas')
  surface.width = size
  surface.height = size
  const ctx = surface.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, colour)
    gradient.addColorStop(.5, colour)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = 1
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(surface)
  texture.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  )
}

export type NavyCyc = {
  cyc: THREE.Mesh
  ground: THREE.Mesh
  backWash: THREE.Mesh
  floorWash: THREE.Mesh
  key: THREE.DirectionalLight
  bounce: THREE.DirectionalLight
  fill: THREE.DirectionalLight
  rim: THREE.DirectionalLight
}

/**
 * Close the navy shell and hang the Luxo key.
 *
 * Counsel-stage then walks the key with the figure. Burnout parks it on the
 * same rest pose the counsel starts from, so the cut between the two slides
 * is a change of subject, not a change of room.
 */
export function addNavyCyc(scene: THREE.Scene): NavyCyc {
  scene.background = new THREE.Color(NAVY_STAGE.field)
  scene.fog = null

  // A closed navy shell rather than a wall and a floor. There is no seam
  // because there is no join: the horizon is the inside of a sphere, and the
  // only thing marking the ground is the shadow lying on it.
  const cyc = new THREE.Mesh(
    new THREE.SphereGeometry(48, 64, 48),
    new THREE.MeshLambertMaterial({ color: NAVY_STAGE.field, side: THREE.BackSide }),
  )
  cyc.position.set(0, 3.2, 0)
  scene.add(cyc)

  // `depthWrite: false` is load-bearing, not hygiene. A `ShadowMaterial` draws
  // nothing where nothing is shadowed but still writes depth, which culled the
  // cyclorama behind it — so inside this disc the frame showed the flat clear
  // colour and outside it showed the lit shell, and the boundary was a faint
  // straight line across the floor at exactly the radius of the disc. That is
  // the wall/floor seam this scene is explicitly not allowed to have, arriving
  // from the one object in the scene that has no visible surface.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(34, 48),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: .42, transparent: true, depthWrite: false }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = .002
  ground.receiveShadow = true
  scene.add(ground)

  // Light on the cyc, and a pool of it on the deck. Both are wide enough to
  // cover a walk across the frame; a pool that ran out halfway would be a
  // seam by another name.
  const backWash = wash(64, 30, 'rgba(34,74,102,.85)', .5)
  backWash.position.set(0, 5.5, -13)
  scene.add(backWash)

  const floorWash = wash(56, 26, 'rgba(38,80,108,.8)', .42)
  floorWash.rotation.x = -Math.PI / 2
  floorWash.position.set(-1, .008, 1)
  scene.add(floorWash)

  scene.add(new THREE.HemisphereLight(0xfff3e4, NAVY_STAGE.field, .5))
  scene.add(new THREE.AmbientLight(0xfff6ea, .17))

  // Luxo key: high, upstage-left, hard enough to lay a shadow across the floor.
  const key = new THREE.DirectionalLight(0xfff2dc, 3.4)
  key.castShadow = true
  key.shadow.mapSize.set(NAVY_SHADOW.size, NAVY_SHADOW.size)
  key.shadow.bias = NAVY_SHADOW.bias
  key.shadow.normalBias = .03
  key.shadow.camera.near = 1
  key.shadow.camera.far = 44
  // Square and generous. A tighter box is cheaper per texel and lays a faint
  // straight line across the floor where its own frustum ends, which on an
  // otherwise empty navy stage is exactly the seam this scene is not allowed to
  // have. 24 units across 2048 is still 85 texels per unit on a six-unit man.
  key.shadow.camera.left = -12
  key.shadow.camera.right = 12
  key.shadow.camera.top = 12
  key.shadow.camera.bottom = -12
  scene.add(key)
  scene.add(key.target)

  const bounce = new THREE.DirectionalLight(0xfff4e8, .72)
  bounce.position.set(3.4, 4.8, 9.2)
  scene.add(bounce)
  scene.add(bounce.target)

  const fill = new THREE.DirectionalLight(0xfff4e8, .42)
  fill.position.set(6.2, 5.4, 8)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(NAVY_STAGE.goldHot, .38)
  rim.position.set(5.4, 5.6, -6)
  scene.add(rim)

  return { cyc, ground, backWash, floorWash, key, bounce, fill, rim }
}

/** Park the Luxo on the counsel's rest pose — centre stage, facing the room. */
export function parkNavyKey(lights: Pick<NavyCyc, 'key' | 'bounce'>, x = 0, z = 0) {
  lights.key.position.set(x - 7.2, 11.5, z + 7.4)
  lights.key.target.position.set(x + 1.2, 1.8, z)
  lights.bounce.target.position.set(x, 1.8, z)
  lights.key.updateMatrixWorld(true)
  lights.key.target.updateMatrixWorld(true)
}
