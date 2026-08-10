import * as THREE from 'three'

/**
 * The deck's WebGL transition: an ink bleed through a noise field.
 *
 * ## Why this is a two-target composite and not a CSS crossfade
 *
 * A crossfade between two 3D scenes shows both of them at half strength in the
 * middle, which on a scene made of ink contours reads as a double exposure —
 * every silhouette in the outgoing frame ghosts through the incoming one. The
 * app's own look is drawn rather than photographed (see `render-style.ts`), and
 * the transition that belongs to a drawing is a wash spreading across paper, not
 * a lap dissolve.
 *
 * So the two frames are composited through a threshold on a noise field instead.
 * At any moment each pixel shows exactly one of the two images, and the boundary
 * between them is a wet ink edge that advances. Nothing is ever half-visible, so
 * there is no ghosting, and the boundary itself carries the paper texture.
 *
 * ## Why the outgoing frame is frozen
 *
 * The outgoing scene is rendered **once**, into a target, at the moment the
 * transition starts, and that texture is then read for the rest of the blend.
 * Rendering both scenes live would double the frame cost at exactly the moment
 * the deck is also building the incoming scene's geometry, which is the one
 * moment it cannot afford it. A held final frame is also what a cut in film
 * actually is.
 *
 * The cost of the transition is therefore: one scene render (the incoming one,
 * which would have happened anyway) plus one fullscreen triangle.
 *
 * ## The noise
 *
 * Value-noise FBM, three octaves, plus a horizontal fibre term at a much higher
 * frequency on one axis only. The fibre term is deliberate: it is the same
 * horizontal-stroke structure the app's laid-paper texture is built from
 * (`--laid-paper`, whose SVG is nothing but horizontal strokes), so the edge
 * breaks along the grain of the paper the rest of the deck is printed on rather
 * than along a generic cloud.
 *
 * A directional bias is mixed in so the wash has a travel direction; the
 * `direction` uniform is a unit vector the caller can point wherever the
 * composition wants.
 */

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0., 1.);
}
`

const FRAGMENT = /* glsl */`
precision highp float;

uniform sampler2D tFrom;
uniform sampler2D tTo;
uniform float uProgress;
uniform float uAspect;
uniform vec2 uDirection;
uniform vec3 uInk;
/** Width of the wet edge, in threshold units. 0 gives a hard tear. */
uniform float uEdge;
/** How much the noise field contributes against the directional sweep. */
uniform float uTurbulence;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

/** Value noise with a smooth (quintic) interpolant, so the field has no
 *  visible lattice at the low frequencies where the wash reads. */
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  float a = hash(i);
  float b = hash(i + vec2(1., 0.));
  float c = hash(i + vec2(0., 1.));
  float d = hash(i + vec2(1., 1.));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.;
  float amplitude = .5;
  for (int octave = 0; octave < 3; octave += 1) {
    sum += valueNoise(p) * amplitude;
    p *= 2.07;          // not exactly 2, so octaves do not align on a grid
    amplitude *= .5;
  }
  return sum;
}

void main() {
  // Correct for aspect so the wash is isotropic on a 16:9 panel rather than
  // stretched into horizontal bands.
  vec2 p = vec2(vUv.x * uAspect, vUv.y);

  float cloud = fbm(p * 3.4);
  // Paper grain: high frequency across the sheet, almost none along it. This is
  // the laid-paper structure, and it is what makes the edge tear rather than
  // wander.
  float fibre = valueNoise(vec2(p.x * 1.6, p.y * 46.)) * .16;
  // Where the wash starts from. Dot against a unit direction and remap to 0..1.
  float sweep = dot(vUv - .5, normalize(uDirection)) * .5 + .5;

  float field = mix(sweep, cloud + fibre, uTurbulence);

  // The threshold has to travel further than 0..1 or the extremes of the field
  // never flip, and the transition would end with islands of the old frame
  // still showing. Padding by the edge width on both sides guarantees a
  // complete wipe at progress 1 and an untouched frame at 0.
  float threshold = mix(-uEdge, 1. + uEdge, uProgress);
  float wash = smoothstep(threshold - uEdge, threshold + uEdge, field);

  vec4 from = texture2D(tFrom, vUv);
  vec4 to = texture2D(tTo, vUv);
  // wash is 0 on the incoming side and 1 on the outgoing side, so it selects
  // rather than averages: away from the edge band exactly one image is shown.
  vec3 colour = mix(to.rgb, from.rgb, wash);

  // The wet edge. Ink pools where a wash is still advancing, so the boundary
  // band is darkened toward the app's own contour colour. Peaks in the middle
  // of the band and vanishes at both ends, so it cannot tint either frame.
  float band = wash * (1. - wash) * 4.;
  colour = mix(colour, uInk, pow(band, 1.6) * .55);

  gl_FragColor = vec4(colour, 1.);
}
`

/**
 * Composites two full-frame textures through the ink bleed.
 *
 * Owns only the shader and its fullscreen triangle. The render targets belong to
 * the stage, because it is the stage that decides when a frame is captured.
 */
export class InkDissolve {
  private readonly material: THREE.ShaderMaterial
  private readonly quadScene: THREE.Scene
  private readonly quadCamera: THREE.OrthographicCamera
  private readonly quad: THREE.Mesh

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tFrom: { value: null },
        tTo: { value: null },
        uProgress: { value: 0 },
        uAspect: { value: 16 / 9 },
        uDirection: { value: new THREE.Vector2(1, .35) },
        // The ink the app's contour pass uses, so the wet edge is the same
        // near-black the drawing is already outlined in.
        uInk: { value: new THREE.Color(0x1b1a24) },
        uEdge: { value: .14 },
        uTurbulence: { value: .72 },
      },
    })

    // One oversized triangle, for the same reason `render-style.ts` uses one:
    // a single primitive, no seam down the diagonal, every pixel shaded once.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
    this.quad = new THREE.Mesh(geometry, this.material)
    this.quad.frustumCulled = false
    this.quadScene = new THREE.Scene()
    this.quadScene.add(this.quad)
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }

  /** Aim the wash. Any vector; it is normalised in the shader. */
  setDirection(x: number, y: number) {
    this.material.uniforms.uDirection.value.set(x, y)
  }

  render(
    renderer: THREE.WebGLRenderer,
    from: THREE.Texture,
    to: THREE.Texture,
    progress: number,
    aspect: number,
  ) {
    const uniforms = this.material.uniforms
    uniforms.tFrom.value = from
    uniforms.tTo.value = to
    uniforms.uProgress.value = progress
    uniforms.uAspect.value = aspect
    renderer.setRenderTarget(null)
    renderer.render(this.quadScene, this.quadCamera)
  }

  dispose() {
    this.material.dispose()
    this.quad.geometry.dispose()
  }
}
