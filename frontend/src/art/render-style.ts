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
  /**
   * How much light a fully enclosed crevice loses. 0 switches the contact
   * shading off entirely, and with it every tap it costs.
   */
  occlusion?: number
  /** How far, in world units, a surface looks for its own occluders. */
  occlusionRadius?: number
  /**
   * What an occluded surface fades towards.
   *
   * Not a grey. Occlusion is the loss of one particular light — the wide, soft
   * one, sky outdoors and ceiling indoors — while the short-range bounce off
   * whatever is doing the occluding survives. So a gutter under a warm stone
   * wall goes warm as it goes dark, and a corner of a cool teal room goes
   * cooler. Multiplying by a colour rather than a scalar is what carries that.
   */
  occlusionTint?: THREE.ColorRepresentation
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
  samples: 4,
  occlusion: 0,
  occlusionRadius: .5,
  occlusionTint: 0x8f8579,
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
uniform float uOcclusion;
uniform float uOcclusionRadius;
uniform vec3 uOcclusionTint;
uniform vec2 uProjScale;

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

/**
 * How much of the wide, soft light a point cannot see.
 *
 * ## Why this belongs here and not in the scenes
 *
 * Every one of these scenes lights with a hemisphere plus two or three
 * directionals, and that family of lights has no notion of anything standing in
 * its way: a skylight term is a function of the surface normal alone, so the
 * strip of pavement in the angle of a wall receives exactly as much sky as the
 * middle of the road, and the underside of a desk receives as much ceiling as
 * the desktop. That is the single largest reason these rooms and streets read
 * as assembled from separate pieces rather than as places — nothing is seated
 * on anything. The alternative the engine offers is shadow maps, one per light,
 * which is precisely the cost this project has spent months not paying.
 *
 * The depth buffer already in this pass answers the same question for free-ish.
 * Occlusion is a purely local property of the geometry around a point, the
 * depth buffer is a picture of that geometry, and no scene has to be re-drawn
 * to ask.
 *
 * ## The sampling pattern is deterministic on purpose
 *
 * The textbook version rotates the tap pattern per pixel by a hash and blurs
 * the noise away afterwards. Both halves are wrong here. The blur is a second
 * fullscreen pass, and the noise it exists to remove is screen-locked, so
 * without it a moving camera drags a field of static speckle across the world —
 * which is the one thing the grain in this shader is carefully arranged not to
 * do.
 *
 * A fixed rosette instead: eight directions at two radii, nudged by a fraction
 * of one step so the pattern does not lock to the pixel grid. It undersamples,
 * and undersampling shows up as a soft, smooth error rather than as noise —
 * which is a wash, and a wash is what an illustrator would have put there.
 */
float contactOcclusion(vec3 origin, vec3 normal) {
  // A world-space radius has to become a uv radius, and the two projections
  // disagree about how. Perspective shrinks with distance; orthographic does
  // not shrink at all, and dividing by depth there would give a portrait's
  // shoulders a metre-wide search and its nose a millimetre.
  vec2 radiusUv = uOcclusionRadius * uProjScale;
  if (uOrthographic < .5) radiusUv /= max(-origin.z, .05);

  // Below about a pixel there is nothing left to sample but the texel the
  // centre already read, and every tap comes back reporting the surface
  // occluding itself. Far geometry therefore fades out of the effect instead
  // of turning into a grey film.
  float footprint = smoothstep(.6, 2.5, min(radiusUv.x / uTexel.x, radiusUv.y / uTexel.y));
  if (footprint <= 0.) return 0.;

  // A fraction of one angular step, from the same static field as the paper
  // grain, so the rosette does not print itself onto the image as an
  // eight-petalled flower around every object.
  float turn = grainNoise(gl_FragCoord.xy * .5) * .7853981634;
  float sum = 0.;
  for (int index = 0; index < 8; index += 1) {
    float angle = float(index) * .7853981634 + turn;
    // Alternating radii, so eight taps cover two rings: the inner one catches
    // the tight crease where a chair leg meets the floor, the outer one the
    // broad darkening under a desk.
    float reach = mod(float(index), 2.) < .5 ? .48 : 1.;
    vec2 sampleUv = vUv + vec2(cos(angle), sin(angle)) * radiusUv * reach;

    // Off-screen taps clamp to the border texel, which would draw a dark frame
    // around the whole image.
    vec2 inside = step(vec2(0.), sampleUv) * step(sampleUv, vec2(1.));
    float valid = inside.x * inside.y;

    vec3 toSample = viewPosition(sampleUv) - origin;
    float distance = length(toSample);
    // The horizon term. A sample above the tangent plane is blocking light;
    // one below it is behind the surface and blocks nothing. The bias keeps a
    // flat surface from occluding itself out of sheer depth-buffer precision.
    float horizon = max(dot(normal, toSample / max(distance, .0001)) - .07, 0.);
    // Anything past the radius is a different object seen behind this one, not
    // a neighbour. Without this every silhouette wears a dark halo of the
    // background it happens to stand in front of.
    float within = 1. - smoothstep(.55, 1., distance / uOcclusionRadius);
    sum += horizon * within * valid;
  }
  return clamp(sum * .3 * footprint, 0., 1.);
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

  // --- contact shading ---------------------------------------------------
  // Before the grade, not after, because this is a light that is missing
  // rather than a darkening of the picture. Taking it out of the linear
  // radiance lets the tone map roll it off the way it rolls off every other
  // shortfall of light; taken out of the graded image it would crush the
  // shadow end and read as soot.
  //
  // The whole term is behind a uniform branch, so a surface that asks for no
  // occlusion pays for none of the taps rather than multiplying by zero at the
  // end. Portraits and the smaller busts are the reason: they are drawn many
  // to a frame through a shared renderer and have almost nothing to occlude.
  vec3 radiance = source.rgb;
  if (uOcclusion > 0. && onGeometry > .5) {
    float ambientLoss = contactOcclusion(viewPosition(vUv), normal) * uOcclusion;
    radiance *= mix(vec3(1.), uOcclusionTint, ambientLoss);
  }

  // --- paint -------------------------------------------------------------
  // Grade first, then stylise, so the bands land on values the eye will
  // actually see rather than on unbounded linear radiance.
  vec3 colour = linearToSRGB(acesFilmic(radiance));

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
        uOcclusion: { value: settings.occlusion },
        uOcclusionRadius: { value: settings.occlusionRadius },
        uOcclusionTint: { value: new THREE.Color(settings.occlusionTint) },
        // Half the projection's own scale factors, which is what turns a world
        // radius into a uv radius. Refreshed per frame from the camera below,
        // because a scene that changes its field of view mid-flight would
        // otherwise keep searching the wrong distance.
        uProjScale: { value: new THREE.Vector2(1, 1) },
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
    const projection = camera.projectionMatrix.elements
    uniforms.uProjScale.value.set(projection[0] * .5, projection[5] * .5)

    this.renderer.setRenderTarget(previousTarget)
    this.renderer.render(this.quadScene, this.quadCamera)
  }

  /**
   * The contact-shading strength this scene was authored with.
   *
   * Readable so a harness can switch the term off, measure, and put back
   * exactly what was there rather than a number copied out of a source file
   * that may since have moved.
   */
  get occlusionStrength() {
    return this.material.uniforms.uOcclusion.value as number
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
    if (options.occlusion !== undefined) uniforms.uOcclusion.value = options.occlusion
    if (options.occlusionRadius !== undefined) uniforms.uOcclusionRadius.value = options.occlusionRadius
    if (options.occlusionTint !== undefined) uniforms.uOcclusionTint.value.set(options.occlusionTint)
  }

  dispose() {
    this.target.depthTexture?.dispose()
    this.target.dispose()
    this.material.dispose()
    this.quad.geometry.dispose()
  }
}
