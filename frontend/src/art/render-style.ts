import * as THREE from 'three'

/**
 * The shared illustrated look: ink contours, flattened paint, paper grain.
 *
 * ## Why this is a screen-space pass and not a material change
 *
 * The scenes author roughly a hundred and fifteen materials inline, spread
 * across the map, the office, the characters and the catalog, so restyling by
 * editing call sites would mean touching all of them and would still miss the
 * next one somebody adds. Worse, giving materials a custom shading model
 * multiplies shader permutations, and shader compilation is already the single
 * largest stall on first frame - the scenes are fully procedural, so there is
 * no asset download to hide it behind.
 *
 * Doing the whole look in one composite pass instead costs a single fullscreen
 * draw, adds no permutations at all, and applies uniformly to every object
 * including ones authored later. The scene renders once into a target, and this
 * pass reads the colour and the depth buffer back to find contours.
 *
 * ## How the contours are found
 *
 * Two different edges matter and they need different detectors. A silhouette -
 * a roof against the sky - is a discontinuity in depth. A crease - where a wall
 * meets a floor - is perfectly continuous in depth and only shows up as a bend
 * in the surface normal. Detecting only depth loses every interior line and the
 * result reads as stickers rather than drawing, so both run and their responses
 * are combined.
 *
 * Normals are reconstructed from depth rather than rendered into a second
 * buffer, which would mean drawing all the geometry twice.
 */

export type IllustratedStyleOptions = {
  /** Contour colour. Defaults to a warm near-black rather than pure black. */
  ink?: THREE.ColorRepresentation
  /** Overall contour opacity. */
  inkStrength?: number
  /** Sensitivity of the silhouette (depth discontinuity) detector. */
  depthEdge?: number
  /** Sensitivity of the crease (normal bend) detector. */
  normalEdge?: number
  /** Number of paint bands. Lower is flatter. */
  bands?: number
  /** How far to push toward flat bands, 0 keeps the original gradient. */
  flatten?: number
  /** Paper grain strength. */
  grain?: number
  /** Saturation multiplier applied after flattening. */
  saturation?: number
  /** Must match the exposure the scene was graded at. */
  exposure?: number
  /** MSAA samples on the scene target. 4 is the default; 2 is cheaper in an embed. */
  samples?: number
}

const DEFAULTS: Required<IllustratedStyleOptions> = {
  ink: 0x1b1a24,
  inkStrength: .78,
  depthEdge: 1,
  normalEdge: 1,
  bands: 9,
  flatten: .34,
  grain: .05,
  saturation: 1.12,
  exposure: 1,
}

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0., 1.);
}
`

const FRAGMENT = /* glsl */`
precision highp float;

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform mat4 uInverseProjection;
uniform vec3 uInk;
uniform float uInkStrength;
uniform float uDepthEdge;
uniform float uNormalEdge;
uniform float uBands;
uniform float uFlatten;
uniform float uGrain;
uniform float uSaturation;
uniform float uExposure;
uniform float uOrthographic;

varying vec2 vUv;

/**
 * The scene is rendered into a linear target, because three skips tone mapping
 * and colour-space conversion whenever the destination is a render target
 * rather than the canvas. Both therefore have to happen here, and they have to
 * match what the renderer would have done, or every scene's carefully graded
 * exposure would shift the moment this pass was switched on.
 *
 * This is three's own ACES fit, reproduced so the grade is unchanged.
 */
vec3 rrtAndOdtFit(vec3 v) {
  vec3 a = v * (v + .0245786) - .000090537;
  vec3 b = v * (.983729 * v + .432951) + .238081;
  return a / b;
}

vec3 acesFilmic(vec3 colour) {
  const mat3 inputMatrix = mat3(
    .59719, .07600, .02840,
    .35458, .90834, .13383,
    .04823, .01566, .83777
  );
  const mat3 outputMatrix = mat3(
     1.60475, -.10208, -.00327,
     -.53108, 1.10813, -.07276,
     -.07367, -.00605, 1.07602
  );
  colour *= uExposure / .6;
  colour = inputMatrix * colour;
  colour = rrtAndOdtFit(colour);
  colour = outputMatrix * colour;
  return clamp(colour, 0., 1.);
}

vec3 linearToSRGB(vec3 colour) {
  return mix(colour * 12.92, 1.055 * pow(max(colour, vec3(0.)), vec3(1. / 2.4)) - .055, step(.0031308, colour));
}

float rawDepth(vec2 uv) {
  return texture2D(tDepth, uv).x;
}

/**
 * Eye-space distance, so thresholds can be expressed in world units.
 *
 * The two projections need different arithmetic. A perspective buffer stores
 * depth hyperbolically and has to be inverted; an orthographic one is already
 * linear across the frustum. Portraits use an orthographic camera, so treating
 * every camera as perspective would put the silhouette detector on a curve that
 * does not exist and the character would come back with no outline at all.
 */
float linearDepth(vec2 uv) {
  float depth = rawDepth(uv);
  if (uOrthographic > .5) return uNear + depth * (uFar - uNear);
  float ndc = depth * 2. - 1.;
  return (2. * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

/** Unproject a pixel back to view space so normals can be recovered. */
vec3 viewPosition(vec2 uv) {
  float ndc = rawDepth(uv) * 2. - 1.;
  vec4 clip = vec4(uv * 2. - 1., ndc, 1.);
  vec4 view = uInverseProjection * clip;
  return view.xyz / view.w;
}

vec3 viewNormal(vec2 uv) {
  vec3 centre = viewPosition(uv);
  vec3 alongX = viewPosition(uv + vec2(uTexel.x, 0.)) - centre;
  vec3 alongY = viewPosition(uv + vec2(0., uTexel.y)) - centre;
  return normalize(cross(alongX, alongY));
}

/** Static value noise. Deliberately not animated: paper does not shimmer. */
float grainNoise(vec2 position) {
  return fract(sin(dot(position, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  float depth = rawDepth(vUv);

  // The clear plane carries no geometry, so skip the detectors there and let
  // the background stay clean rather than ringing around the screen border.
  float onGeometry = step(depth, .9999);

  // --- silhouettes -------------------------------------------------------
  // A Roberts cross on eye-space depth. The threshold scales with distance
  // because a fixed one either misses far edges or draws every near surface.
  float centre = linearDepth(vUv);
  float right = linearDepth(vUv + vec2(uTexel.x, 0.));
  float up = linearDepth(vUv + vec2(0., uTexel.y));
  float left = linearDepth(vUv - vec2(uTexel.x, 0.));
  float down = linearDepth(vUv - vec2(0., uTexel.y));
  // Second difference, not the sum of the two first differences.
  //
  // The previous form summed |centre-left| and |centre-right|, which on any
  // flat surface equals twice the depth gradient. A gradient is not an edge: it
  // is simply a surface leaning away from the camera. So every steeply angled
  // face inked itself, and rounded forms seen near their silhouette came back
  // covered in dense parallel stripes - a hand read as corduroy and a bevelled
  // panel read as a stack of paper.
  //
  // Curvature is what a silhouette actually is. A second difference is
  // identically zero across a constant gradient however steep, and spikes hard
  // at a genuine discontinuity, which is precisely the discrimination wanted.
  float depthDelta = max(
    abs(left + right - 2. * centre),
    abs(up + down - 2. * centre)
  );
  float depthEdge = smoothstep(.0025, .028, depthDelta / max(centre, .001) * uDepthEdge);

  // --- creases -----------------------------------------------------------
  // Interior lines where the surface bends but stays continuous in depth.
  vec3 normal = viewNormal(vUv);
  vec3 normalRight = viewNormal(vUv + vec2(uTexel.x * 2., 0.));
  vec3 normalUp = viewNormal(vUv + vec2(0., uTexel.y * 2.));
  float bend = (1. - max(dot(normal, normalRight), 0.)) + (1. - max(dot(normal, normalUp), 0.));
  // Creases are only believable on surfaces the camera can actually see into.
  // These normals are reconstructed from the depth buffer, and that
  // reconstruction degenerates as a surface turns edge-on: one texel of depth
  // noise swings the inferred normal wildly, so a smooth rounded form throws a
  // burst of false creases exactly where it curves away. That is what banded a
  // relaxed hand into corduroy while the hand beside it, facing the camera,
  // came out clean. Fading the crease term out as the surface goes grazing
  // costs nothing real, because a crease seen edge-on is a silhouette, and the
  // depth term above already draws that.
  float facing = smoothstep(.10, .42, abs(normal.z));
  float normalEdge = smoothstep(.22, .78, bend * uNormalEdge) * facing;

  float edge = clamp(max(depthEdge, normalEdge), 0., 1.) * onGeometry;

  // --- paint -------------------------------------------------------------
  // Grade first, then stylise, so the bands land on values the eye will
  // actually see rather than on unbounded linear radiance.
  vec3 colour = linearToSRGB(acesFilmic(source.rgb));

  // Quantising a smoothly lit surface straight to bands lays visible contour
  // rings across it - a wall washed by one lamp turns into a set of concentric
  // arcs. Offsetting each pixel by up to half a band before rounding scatters
  // the boundary instead, so the flat look survives but the terraces do not.
  // This is the same reason the noise has to be applied here and not after the
  // quantisation, where it would be grain sitting on top of visible steps.
  float noise = grainNoise(gl_FragCoord.xy) - .5;
  vec3 banded = floor((colour + noise / uBands) * uBands + .5) / uBands;
  colour = mix(colour, banded, uFlatten);

  float luma = dot(colour, vec3(.2126, .7152, .0722));
  colour = mix(vec3(luma), colour, uSaturation);

  // Paper tooth, keyed to the pixel rather than to time: paper does not shimmer.
  colour += noise * uGrain;

  colour = mix(colour, uInk, edge * uInkStrength);

  gl_FragColor = vec4(clamp(colour, 0., 1.), source.a);
}
`

/**
 * Wraps a renderer so scenes draw through the illustrated composite.
 *
 * Owns its render target and resizes with the canvas. Callers swap
 * `renderer.render(scene, camera)` for `pass.render(scene, camera)`.
 */
export class IllustratedRenderPass {
  private readonly renderer: THREE.WebGLRenderer
  private readonly target: THREE.WebGLRenderTarget
  private readonly quadScene: THREE.Scene
  private readonly quadCamera: THREE.OrthographicCamera
  private readonly material: THREE.ShaderMaterial
  private readonly quad: THREE.Mesh
  private width = 1
  private height = 1

  /** Set false to fall straight through to the plain renderer. */
  enabled = true

  constructor(renderer: THREE.WebGLRenderer, options: IllustratedStyleOptions = {}) {
    const settings = { ...DEFAULTS, ...options }
    this.renderer = renderer

    const size = renderer.getSize(new THREE.Vector2())
    this.width = Math.max(1, Math.floor(size.x))
    this.height = Math.max(1, Math.floor(size.y))
    const pixelRatio = renderer.getPixelRatio()

    const depthTexture = new THREE.DepthTexture(
      Math.floor(this.width * pixelRatio),
      Math.floor(this.height * pixelRatio),
    )
    depthTexture.type = THREE.UnsignedIntType
    depthTexture.minFilter = THREE.NearestFilter
    depthTexture.magFilter = THREE.NearestFilter

    this.target = new THREE.WebGLRenderTarget(
      Math.floor(this.width * pixelRatio),
      Math.floor(this.height * pixelRatio),
      {
        depthTexture,
        depthBuffer: true,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        // Half float and linear, so the composite receives unclipped radiance
        // and can apply the same tone map the renderer would have. An 8-bit
        // sRGB target would clip highlights before the grade ever ran.
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
        // Multisampling has to happen before the composite, because resolving
        // afterwards would mean edge-detecting an already-aliased image and the
        // contours would crawl.
        samples: options.samples ?? 4,
      },
    )

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        tDepth: { value: depthTexture },
        uTexel: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
        uNear: { value: .1 },
        uFar: { value: 1000 },
        uInverseProjection: { value: new THREE.Matrix4() },
        uInk: { value: new THREE.Color(settings.ink) },
        uInkStrength: { value: settings.inkStrength },
        uDepthEdge: { value: settings.depthEdge },
        uNormalEdge: { value: settings.normalEdge },
        uBands: { value: settings.bands },
        uFlatten: { value: settings.flatten },
        uGrain: { value: settings.grain },
        uSaturation: { value: settings.saturation },
        uExposure: { value: settings.exposure },
        uOrthographic: { value: 0 },
      },
    })

    // A single oversized triangle rather than a quad: one primitive, no seam
    // down the diagonal, and every pixel shaded exactly once.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
    this.quad = new THREE.Mesh(geometry, this.material)
    this.quad.frustumCulled = false
    this.quadScene = new THREE.Scene()
    this.quadScene.add(this.quad)
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width))
    this.height = Math.max(1, Math.floor(height))
    const pixelRatio = this.renderer.getPixelRatio()
    this.target.setSize(Math.floor(this.width * pixelRatio), Math.floor(this.height * pixelRatio))
    this.material.uniforms.uTexel.value.set(1 / this.width, 1 / this.height)
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null)
      this.renderer.render(scene, camera)
      return
    }

    const previousTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.target)
    // Clear explicitly, because the host may be running with `autoClear` off.
    //
    // The character renderer does exactly that: it clears once itself and then
    // draws, which is correct for the unstyled path. But its clear lands on the
    // default framebuffer, since no target is bound at that point, so this
    // pass's private offscreen target was never cleared at all and each frame
    // accumulated on top of the last. Static geometry hid it; anything that
    // moved - hands, eyes - trailed ghosts of its previous positions.
    //
    // The target belongs solely to this pass, so clearing it here is safe
    // whatever the host's own clear policy is, and costs one clear per frame.
    this.renderer.clear(true, true, true)
    this.renderer.render(scene, camera)

    const uniforms = this.material.uniforms
    const orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera === true
    uniforms.uOrthographic.value = orthographic ? 1 : 0
    uniforms.uNear.value = camera.near
    uniforms.uFar.value = camera.far
    uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse)

    this.renderer.setRenderTarget(previousTarget)
    this.renderer.render(this.quadScene, this.quadCamera)
  }

  /** Live-tune the look without rebuilding the pass. */
  configure(options: IllustratedStyleOptions) {
    const uniforms = this.material.uniforms
    if (options.ink !== undefined) uniforms.uInk.value.set(options.ink)
    if (options.inkStrength !== undefined) uniforms.uInkStrength.value = options.inkStrength
    if (options.depthEdge !== undefined) uniforms.uDepthEdge.value = options.depthEdge
    if (options.normalEdge !== undefined) uniforms.uNormalEdge.value = options.normalEdge
    if (options.bands !== undefined) uniforms.uBands.value = options.bands
    if (options.flatten !== undefined) uniforms.uFlatten.value = options.flatten
    if (options.grain !== undefined) uniforms.uGrain.value = options.grain
    if (options.saturation !== undefined) uniforms.uSaturation.value = options.saturation
    if (options.exposure !== undefined) uniforms.uExposure.value = options.exposure
  }

  dispose() {
    this.target.depthTexture?.dispose()
    this.target.dispose()
    this.material.dispose()
    this.quad.geometry.dispose()
  }
}
