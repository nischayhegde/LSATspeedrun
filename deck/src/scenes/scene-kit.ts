import * as THREE from 'three'

/**
 * Shared apparatus for the deck's own scenes.
 *
 * The four scenes built here — hero, cast, tier ladder, metric panel — are
 * deck-original rather than ported, but they have to sit in the same picture as
 * the two that are ported, so the palette below is the product's tokens as
 * numbers and the lighting rig is the one `rig-harness.html` uses. Nothing here
 * invents a colour.
 */

/** `frontend/src/styles.css`, both token blocks, as hex numbers. */
export const PALETTE = {
  navy: 0x102735,
  navy2: 0x18394a,
  ink: 0x182027,
  paper: 0xf8f3e8,
  surface: 0xfffdf7,
  gold: 0xc89b4b,
  goldDark: 0x9a6c28,
  goldSoft: 0xf5e8c8,
  line: 0xd8d0c2,
  green: 0x267557,
  red: 0xa84645,
  pixelNight: 0x101725,
  pixelBlue: 0x172b40,
  pixelBlue2: 0x264962,
  pixelGold: 0xf2c75b,
  pixelGoldDark: 0x9d692c,
  pixelCyan: 0x65c9c2,
  pixelPaper: 0xf6e7bf,
  /** `.cutscene-overlay`'s field. The deck's stage colour. */
  stage: 0x05080d,
} as const

export type Framing = {
  position: [number, number, number]
  target: [number, number, number]
  fov?: number
  /** How much of the stage pointer this framing lets through, 0..1. */
  parallax?: number
}

/**
 * A camera that travels between named framings.
 *
 * The tween is on position and target separately and both are eased, which is
 * what makes a move read as a camera rather than as an interpolation: a camera
 * operator settles the frame before they settle the dolly, so the target arrives
 * first. `immediate` snaps, for the first frame of a scene that has just been
 * shown.
 *
 * Interruption is the case that matters. A move asked for while another is
 * running starts from wherever the camera actually is, not from the framing it
 * was nominally leaving, so mashing the arrow keys cannot desync the camera from
 * the slide — it just produces a faster, shorter move.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private readonly framings = new Map<string, Framing>()
  private readonly fromPosition = new THREE.Vector3()
  private readonly fromTarget = new THREE.Vector3()
  private readonly toPosition = new THREE.Vector3()
  private readonly toTarget = new THREE.Vector3()
  private readonly livePosition = new THREE.Vector3()
  private readonly liveTarget = new THREE.Vector3()
  private fromFov = 40
  private toFov = 40
  private progress = 1
  private duration = 1.5
  private parallax = 1

  constructor(framings: Record<string, Framing>, initial: string, aspect = 16 / 9) {
    for (const [name, framing] of Object.entries(framings)) this.framings.set(name, framing)
    const first = this.framings.get(initial) ?? Object.values(framings)[0]
    this.camera = new THREE.PerspectiveCamera(first.fov ?? 40, aspect, .1, 400)
    this.livePosition.fromArray(first.position)
    this.liveTarget.fromArray(first.target)
    this.toPosition.copy(this.livePosition)
    this.toTarget.copy(this.liveTarget)
    this.fromFov = this.toFov = first.fov ?? 40
    this.parallax = first.parallax ?? 1
    this.camera.position.copy(this.livePosition)
    this.camera.lookAt(this.liveTarget)
  }

  has(name: string | undefined): boolean {
    return Boolean(name && this.framings.has(name))
  }

  go(name: string | undefined, immediate: boolean, seconds = 1.6) {
    const framing = name ? this.framings.get(name) : undefined
    if (!framing) return
    this.fromPosition.copy(this.livePosition)
    this.fromTarget.copy(this.liveTarget)
    this.fromFov = this.camera.fov
    this.toPosition.fromArray(framing.position)
    this.toTarget.fromArray(framing.target)
    this.toFov = framing.fov ?? this.camera.fov
    this.parallax = framing.parallax ?? 1
    this.duration = Math.max(.001, seconds)
    this.progress = immediate ? 1 : 0
    if (immediate) this.settle()
  }

  private settle() {
    this.livePosition.copy(this.toPosition)
    this.liveTarget.copy(this.toTarget)
    this.camera.fov = this.toFov
    this.camera.updateProjectionMatrix()
  }

  /** Call once per frame, before rendering, with the stage pointer. */
  update(delta: number, pointer: { x: number; y: number }) {
    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + delta / this.duration)
      // The target leads the position: `sharp` is further along the curve than
      // `soft`, so the frame composes before the dolly finishes arriving.
      const soft = easeInOutCubic(this.progress)
      const sharp = easeOutCubic(this.progress)
      this.livePosition.lerpVectors(this.fromPosition, this.toPosition, soft)
      this.liveTarget.lerpVectors(this.fromTarget, this.toTarget, sharp)
      this.camera.fov = this.fromFov + (this.toFov - this.fromFov) * soft
      this.camera.updateProjectionMatrix()
    }
    const sway = this.parallax
    this.camera.position.set(
      this.livePosition.x + pointer.x * .55 * sway,
      this.livePosition.y - pointer.y * .34 * sway,
      this.livePosition.z,
    )
    this.camera.lookAt(this.liveTarget)
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }
}

export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

export function easeInOutCubic(t: number) {
  return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * The harness lighting rig, which is the one every character in the product is
 * lit by: a wide warm hemisphere, a warm key from the upper left, a cool fill
 * from the right. Reproduced rather than re-invented so a rig built here and a
 * rig built by the office read as the same material.
 */
export function addStandardLights(scene: THREE.Scene, intensity = 1) {
  const hemisphere = new THREE.HemisphereLight(0xf5ecdf, 0x1b2631, 1.25 * intensity)
  scene.add(hemisphere)
  const key = new THREE.DirectionalLight(0xffe5ca, 2 * intensity)
  key.position.set(-6, 12, 9)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xa9d3df, .65 * intensity)
  fill.position.set(7, 6, 8)
  scene.add(fill)
  return { hemisphere, key, fill }
}

/**
 * Type as a texture.
 *
 * The deck's 3D scenes carry a certain amount of copy — fifteen firm-tier names,
 * a dozen metric labels — and there are only three ways to put type in a WebGL
 * scene: an SDF font atlas, extruded geometry, or a canvas. A canvas is the only
 * one of the three that needs no asset, renders in the deck's actual webfont, and
 * costs a single quad; and at the sizes these labels appear it is
 * indistinguishable from the alternatives. The trade is that a label cannot be
 * scaled arbitrarily after the fact, which is why `pixels` is a parameter.
 */
export function labelTexture(
  text: string,
  options: {
    pixels?: number
    color?: string
    font?: string
    weight?: number
    letterSpacing?: number
    uppercase?: boolean
    align?: 'left' | 'center' | 'right'
  } = {},
): { texture: THREE.CanvasTexture; aspect: number } {
  const pixels = options.pixels ?? 64
  const label = options.uppercase ? text.toUpperCase() : text
  const font = `${options.weight ?? 700} ${pixels}px ${options.font ?? 'Archivo, sans-serif'}`
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const spacing = options.letterSpacing ?? 0
  const width = Math.ceil(measure.measureText(label).width + spacing * label.length + pixels * .5)
  const height = Math.ceil(pixels * 1.5)

  const surface = document.createElement('canvas')
  surface.width = Math.max(2, width)
  surface.height = Math.max(2, height)
  const context = surface.getContext('2d')!
  context.font = font
  context.fillStyle = options.color ?? '#f6e7bf'
  context.textBaseline = 'middle'
  context.textAlign = 'left'
  let x = options.align === 'right' ? surface.width - (width - pixels * .5) : pixels * .25
  if (options.align === 'center') x = (surface.width - (width - pixels * .5)) / 2
  if (spacing) {
    for (const glyph of label) {
      context.fillText(glyph, x, surface.height / 2)
      x += context.measureText(glyph).width + spacing
    }
  } else {
    context.fillText(label, x, surface.height / 2)
  }

  const texture = new THREE.CanvasTexture(surface)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  return { texture, aspect: surface.width / surface.height }
}

/** A label as a camera-facing plane. Returns the sprite and its own material. */
export function labelPlane(
  text: string,
  worldHeight: number,
  options: Parameters<typeof labelTexture>[1] = {},
) {
  const { texture, aspect } = labelTexture(text, options)
  const geometry = new THREE.PlaneGeometry(worldHeight * aspect, worldHeight)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  return mesh
}

/**
 * A deterministic pseudo-random source.
 *
 * Every scene in the deck is seeded, because a presentation that composes
 * itself differently on each run cannot be rehearsed. The same slide has to look
 * the same on the tenth pass as on the first.
 */
export function seededRandom(seed: number) {
  let state = (seed | 0) || 1
  return () => {
    state = (state * 1664525 + 1013904223) | 0
    return ((state >>> 8) & 0xffffff) / 0xffffff
  }
}

/**
 * Recursively free everything a scene created.
 *
 * The `characterShared` guard is load-bearing: `office-three.tsx` and the
 * character rigs keep module-level geometry caches deliberately, so that a
 * rebuild after a purchase does not re-tessellate every keyboard key in the
 * room. Disposing one of those from here would leave a later rebuild holding a
 * destroyed buffer.
 */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry && !mesh.geometry.userData.characterShared) mesh.geometry.dispose()
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material
    if (!material) return
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (entry.userData.characterShared) continue
      const withMap = entry as unknown as Record<string, unknown>
      for (const slot of ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap']) {
        const texture = withMap[slot] as THREE.Texture | null | undefined
        if (texture && typeof texture.dispose === 'function') texture.dispose()
      }
      entry.dispose()
    }
  })
}
