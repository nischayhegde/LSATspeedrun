import * as THREE from 'three'

import { addNavyCyc, parkNavyKey } from './navy-stage'
import { CameraRig, PALETTE, disposeTree, seededRandom } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * `pov-volume-burns` — the same navy room as counsel-stage, a few exam
 * sheets falling on fire, and a centred lockup.
 *
 * Fall: a paper drop — a few seconds, top of frame to floor — with flutter
 * and tumble in the air. Sheets stay behind the DOM lockup: world Z never
 * crosses the type plane, and they occupy the left, right, and lower thirds
 * rather than the centred lockup (headline, punch, citations). Landing
 * eases into rest on the sides, then the pose freezes. Flight is
 * continuous aero, no teleport.
 *
 * Fire: the last picture was a gold tint on a static rim plus ten shared
 * radial blobs. This is a marching char front, simplex-driven additive
 * flame cards on that front, HDR cores so ACES still leaves white-hot
 * tongues, embers that rise and die, and a thin navy-gold haze. No second
 * renderer; the shared illustrated pass is the composite.
 *
 * `setFraming('fade')` is 10 → 11: papers, fire and embers ease out on
 * the shared navy; counsel-stage fades in on the same cyc. No consume,
 * no fire wipe. 11 → 12 is a different override and is not touched.
 */

const LENS = {
  position: [0, 2.48, 5.2] as [number, number, number],
  target: [0, 1.68, 0.4] as [number, number, number],
  fov: 36,
}

/** Exam sheet in world units. Half the old letter, ~28% of frame height face-on. */
const SHEET = { w: .7, h: .9 }

/*
 * Mass scales with area so face-on terminal stays ~1.1 m/s — a 2.5–4s drop
 * from the top of the frame — then the sheet rests. No bounce loop.
 */
const MASS = .016
const GRAVITY = 9.8
const AIR = .33
const CD_FACE = 1.18
const CD_EDGE = .18
const CL_PEAK = .22
const ANGULAR_DAMP = 2.4
const FLOOR_Y = .02
const SUBSTEPS = 2
const GROUND_BAND = .08
const MAX_OMEGA = 2.4
const MAX_SPEED = 3.2
const LAND_SEC = .4
const REST_SPEED = .62
const REST_OMEGA = .9
/** Closest a sheet centre may come toward the camera. Lockup sits in front. */
const TYPE_PLANE_Z = .16
/** World X the centred lockup occupies — papers stay in the side columns. */
const TYPE_HALF_X = 1.62
const TYPE_Y_LO = .88
const TYPE_Y_HI = 3.05
/** Floor rest must clear the centred column so a landed sheet cannot sit under the punch. */
const REST_HALF_X = 1.72

const EMBER_PER_SHEET = 22
const SMOKE_PER_SHEET = 10
const FLAME_PER_SHEET = 6
const PAPER_COUNT = 5
const BURN_IDLE_CAP = .38
const FADE_SEC = .62

const CHAR = new THREE.Color(0x1a100c)
const EMBER = new THREE.Color(0xff9a32)
const EMBER_HOT = new THREE.Color(0xffe7a0)
const FLAME_CORE = new THREE.Color(0xfff6d8)

type BurnUniforms = {
  uBurn: { value: number }
  uTime: { value: number }
  uOrigin: { value: THREE.Vector2 }
}

type Ember = {
  age: number
  life: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

type Smoke = Ember

type Flame = {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  u: number
  side: number
  phase: number
  cluster: boolean
}

type Sheet = {
  group: THREE.Group
  mesh: THREE.SkinnedMesh
  left: THREE.Bone
  right: THREE.Bone
  light: THREE.PointLight
  hotLight: THREE.PointLight
  bloom: THREE.Mesh
  bloomMat: THREE.ShaderMaterial
  origin: THREE.Vector2
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  linear: THREE.Vector3
  angular: THREE.Vector3
  burn: number
  burnRate: number
  uniforms: BurnUniforms
  embers: Ember[]
  smoke: Smoke[]
  flames: Flame[]
  fold: number
  foldTarget: number
  flap: number
  flapTarget: number
  age: number
  phase: number
  flutter: number
  spawnDelay: number
  drag: number
  lift: number
  drift: number
  flutterHz: number
  resting: boolean
  restLocked: boolean
  landT: number
  landFromQuat: THREE.Quaternion
  restQuat: THREE.Quaternion
  restX: number
  restY: number
  restZ: number
  landFromX: number
  landFromZ: number
}

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [SHEET.w / 2, SHEET.h / 2],
  [SHEET.w / 2, -SHEET.h / 2],
  [-SHEET.w / 2, SHEET.h / 2],
  [-SHEET.w / 2, -SHEET.h / 2],
]

const IXX = MASS / 12 * (SHEET.h * SHEET.h)
const IYY = MASS / 12 * (SHEET.w * SHEET.w)
const IZZ = MASS / 12 * (SHEET.w * SHEET.w + SHEET.h * SHEET.h)

const _n = new THREE.Vector3()
const _vt = new THREE.Vector3()
const _force = new THREE.Vector3()
const _aero = new THREE.Vector3()
const _torque = new THREE.Vector3()
const _r = new THREE.Vector3()
const _world = new THREE.Vector3()
const _qDot = new THREE.Quaternion()
const _localOmega = new THREE.Vector3()
const _localTorque = new THREE.Vector3()
const _invQ = new THREE.Quaternion()
const _cp = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _lift = new THREE.Vector3()
const _span = new THREE.Vector3()
const _vhat = new THREE.Vector3()
const _cam = new THREE.Vector3()
const _local = new THREE.Vector3()
const _front = new THREE.Vector3()
const _restN = new THREE.Vector3()
const _flat = new THREE.Vector3(0, 0, 1)
const _b0 = new THREE.Vector3()
const _b1 = new THREE.Vector3()
const _uv = new THREE.Vector2()

const NOISE_GLSL = /* glsl */`
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * valueNoise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}
`

const FLAME_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FLAME_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uTime;
uniform float uPhase;
uniform float uIntensity;
uniform float uFade;
uniform float uKind;
uniform sampler2D uDisc;
${NOISE_GLSL}
void main() {
  vec2 uv = vUv;
  float disc = texture2D(uDisc, uv).a;
  if (disc < 0.01) discard;
  float t = uTime * 1.9 + uPhase;
  float d = length(uv - vec2(0.5));
  if (uKind > 0.5) {
    float g = exp(-d * 7.4) * disc * uIntensity * uFade;
    if (g < 0.02) discard;
    float flicker = 0.82 + 0.18 * sin(t * 11.0);
    vec3 col = mix(vec3(1.0, 0.28, 0.02), vec3(1.0, 0.72, 0.2), clamp(g * 1.6, 0.0, 1.0));
    col *= g * flicker * 2.8;
    gl_FragColor = vec4(col, 0.0);
    return;
  }
  float n = fbm(vec2(uv.x * 4.2 + t * 0.45, uv.y * 4.2 - t * 1.7));
  float g = exp(-d * 5.1) * disc;
  g *= 0.72 + n * 0.5;
  g *= 0.84 + 0.16 * sin(t * 8.5);
  g *= uIntensity * uFade;
  if (g < 0.02) discard;
  vec3 cool = vec3(0.7, 0.06, 0.0);
  vec3 mid = vec3(1.0, 0.38, 0.04);
  vec3 hot = vec3(1.0, 0.8, 0.18);
  vec3 core = vec3(1.0, 0.97, 0.84);
  vec3 col = mix(cool, mid, clamp(g * 1.6, 0.0, 1.0));
  col = mix(col, hot, pow(clamp(g, 0.0, 1.0), 1.5));
  col = mix(col, core, pow(clamp(g, 0.0, 1.0), 3.2));
  col *= 1.4 + g * 4.8;
  gl_FragColor = vec4(col * g, 0.0);
}
`

const POINT_VERT = /* glsl */`
attribute float aLife;
uniform float uSize;
uniform float uViewport;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = smoothstep(0.0, 0.12, aLife) * (1.0 - smoothstep(0.55, 1.0, aLife));
  gl_PointSize = max(1.5, uSize * fade * uViewport / max(0.12, -mv.z));
}
`

const EMBER_FRAG = /* glsl */`
uniform sampler2D uMap;
varying float vLife;
void main() {
  if (vLife < 0.001) discard;
  vec2 pc = gl_PointCoord - vec2(0.5);
  if (dot(pc, pc) > 0.23) discard;
  vec4 sprite = texture2D(uMap, gl_PointCoord);
  float a = sprite.a * vLife;
  if (a < 0.03) discard;
  vec3 col = mix(vec3(1.0, 0.32, 0.04), vec3(1.0, 0.92, 0.7), vLife);
  col *= 2.8 + vLife * 4.5;
  gl_FragColor = vec4(col * a, 0.0);
}
`

const SMOKE_FRAG = /* glsl */`
uniform sampler2D uMap;
varying float vLife;
void main() {
  if (vLife < 0.001) discard;
  vec2 pc = gl_PointCoord - vec2(0.5);
  if (dot(pc, pc) > 0.23) discard;
  vec4 sprite = texture2D(uMap, gl_PointCoord);
  float a = sprite.a * vLife * 0.22;
  if (a < 0.02) discard;
  vec3 navy = vec3(0.14, 0.27, 0.38);
  vec3 gold = vec3(0.78, 0.58, 0.28);
  vec3 col = mix(navy, gold, 0.22 + vLife * 0.18);
  col *= 0.85;
  gl_FragColor = vec4(col * a, 0.0);
}
`

function paintPaper(random: () => number) {
  const size = 2048
  const pad = 96
  const surface = document.createElement('canvas')
  surface.width = size
  surface.height = size
  const ctx = surface.getContext('2d')!
  ctx.fillStyle = '#f4ead6'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#f8f3e8'
  ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2)

  const fiber = ctx.getImageData(0, 0, size, size)
  const data = fiber.data
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - .5) * 11
    data[i] = Math.min(255, Math.max(0, data[i] + n))
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n * .92))
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n * .78))
    data[i + 3] = 255
  }
  ctx.putImageData(fiber, 0, 0)

  ctx.fillStyle = 'rgba(200, 155, 75, .22)'
  ctx.fillRect(pad, pad, size - pad * 2, 10)

  const left = pad + 88
  const top = pad + 96
  ctx.fillStyle = 'rgba(24, 32, 39, .28)'
  ctx.font = '600 52px "IBM Plex Mono", ui-monospace, monospace'
  ctx.fillText('SECTION I', left, top)
  ctx.font = '400 34px "IBM Plex Mono", ui-monospace, monospace'
  ctx.fillText('Time—35 minutes     25 Questions', left, top + 52)

  ctx.strokeStyle = 'rgba(24, 32, 39, .16)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(left, top + 78)
  ctx.lineTo(size - pad - 88, top + 78)
  ctx.stroke()

  const lines = [
    'Directions. The questions that follow are based on the',
    'reasoning in brief statements or passages. Choose the',
    'response that most accurately and completely answers',
    'the question. Do not assume that more than one choice',
    'could be correct.',
    '',
    '1. A city that published its practice-exam completion',
    'rates found that the students who finished even one',
    'timed section scored higher than those who only',
    'watched recorded lectures of the same material.',
    '',
    'The argument depends on assuming which one of',
    'the following?',
    '',
    '(A)  Students who finish a section are already the',
    '     stronger cohort, independent of the work.',
    '(B)  Watching a lecture is not itself a form of',
    '     practice for the skills the exam measures.',
    '(C)  Completion rates are a reliable proxy for the',
    '     hours a student intended to study.',
    '(D)  The lectures were shorter than a timed section.',
    '(E)  Cities that publish rates attract stronger students.',
    '',
    '2. Ethicist: Advice that cannot be followed is not',
    'advice. A method that asks for two hundred hours',
    'from a person who will stop at forty has described',
    'a path, not offered one.',
  ]

  ctx.font = '400 36px Georgia, "Times New Roman", serif'
  ctx.fillStyle = 'rgba(24, 32, 39, .3)'
  let y = top + 140
  for (const line of lines) {
    ctx.fillText(line, left, y)
    y += 52
  }

  const texture = new THREE.CanvasTexture(surface)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

function radialSprite(stops: ReadonlyArray<readonly [number, string]>, size = 128) {
  const surface = document.createElement('canvas')
  surface.width = size
  surface.height = size
  const ctx = surface.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2)
  for (const [stop, colour] of stops) gradient.addColorStop(stop, colour)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(surface)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function discSprite(size = 256) {
  const surface = document.createElement('canvas')
  surface.width = size
  surface.height = size
  const ctx = surface.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * .46)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(.55, 'rgba(255, 255, 255, .7)')
  gradient.addColorStop(.82, 'rgba(255, 255, 255, .12)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * .46, 0, Math.PI * 2)
  ctx.fill()
  const texture = new THREE.CanvasTexture(surface)
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function patchBurn(material: THREE.MeshStandardMaterial, uniforms: BurnUniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurn = uniforms.uBurn
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uOrigin = uniforms.uOrigin
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vBurnUv;`,
      )
      .replace(
        'void main() {',
        `void main() {
vBurnUv = uv;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uBurn;
uniform float uTime;
uniform vec2 uOrigin;
varying vec2 vBurnUv;
${NOISE_GLSL}
float burnField(vec2 uv) {
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  vec2 d = (uv - uOrigin) * vec2(1.0, 1.28);
  float radial = length(d);
  float n = fbm(uv * 6.4 + vec2(uTime * 0.16, uTime * 0.05));
  float crawl = sin(uv.x * 27.0 + uv.y * 19.0 + uTime * 2.7) * 0.012;
  crawl += sin(uv.y * 41.0 - uTime * 3.4) * 0.008;
  return edge * 0.55 + radial * 0.42 + (n - 0.5) * 0.07 + crawl;
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec2 burnUv = vBurnUv;
#ifdef USE_MAP
  burnUv = vMapUv;
#endif
  float field = burnField(burnUv);
  float front = uBurn;
  float nFire = fbm(vec2(burnUv.x * 13.0 + burnUv.y * 2.4, field * 24.0 - uTime * 7.8));
  float nFire2 = valueNoise(vec2(burnUv.y * 17.0, burnUv.x * 9.0 - uTime * 5.4));
  float tongue = pow(nFire, 1.4) * 0.08 + nFire2 * 0.025;
  float flicker = 0.7 + 0.3 * sin(uTime * 18.0 + burnUv.x * 32.0 + burnUv.y * 14.0);
  float gone = 1.0 - smoothstep(front - 0.04, front - 0.012, field);
  float flame = smoothstep(front - 0.018, front + 0.008, field)
    * (1.0 - smoothstep(front + 0.004, front + 0.03 + tongue, field));
  flame *= flicker;
  float ember = smoothstep(front + 0.008, front + 0.032, field)
    * (1.0 - smoothstep(front + 0.032, front + 0.08, field));
  float charAmt = (1.0 - gone) * (1.0 - flame) * (1.0 - smoothstep(front + 0.045, front + 0.17, field));
  vec3 charCol = vec3(${CHAR.r.toFixed(3)}, ${CHAR.g.toFixed(3)}, ${CHAR.b.toFixed(3)});
  vec3 emberCol = vec3(${EMBER.r.toFixed(3)}, ${EMBER.g.toFixed(3)}, ${EMBER.b.toFixed(3)});
  vec3 emberHot = vec3(${EMBER_HOT.r.toFixed(3)}, ${EMBER_HOT.g.toFixed(3)}, ${EMBER_HOT.b.toFixed(3)});
  vec3 core = vec3(${FLAME_CORE.r.toFixed(3)}, ${FLAME_CORE.g.toFixed(3)}, ${FLAME_CORE.b.toFixed(3)});
  diffuseColor.rgb = mix(diffuseColor.rgb, charCol, charAmt);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(emberCol, emberHot, flicker), ember * 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(emberHot, core, flicker), flame);
  diffuseColor.a *= 1.0 - gone;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec2 burnUv = vBurnUv;
#ifdef USE_MAP
  burnUv = vMapUv;
#endif
  float field = burnField(burnUv);
  float front = uBurn;
  float nFire = fbm(vec2(burnUv.x * 13.0 + burnUv.y * 2.4, field * 24.0 - uTime * 7.8));
  float nFire2 = valueNoise(vec2(burnUv.y * 17.0, burnUv.x * 9.0 - uTime * 5.4));
  float tongue = pow(nFire, 1.4) * 0.08 + nFire2 * 0.025;
  float flicker = 0.7 + 0.3 * sin(uTime * 18.0 + burnUv.x * 32.0 + burnUv.y * 14.0);
  float flame = smoothstep(front - 0.018, front + 0.008, field)
    * (1.0 - smoothstep(front + 0.004, front + 0.03 + tongue, field));
  flame *= flicker;
  float ember = smoothstep(front + 0.008, front + 0.032, field)
    * (1.0 - smoothstep(front + 0.032, front + 0.08, field));
  vec3 emberCol = vec3(${EMBER.r.toFixed(3)}, ${EMBER.g.toFixed(3)}, ${EMBER.b.toFixed(3)});
  vec3 emberHot = vec3(${EMBER_HOT.r.toFixed(3)}, ${EMBER_HOT.g.toFixed(3)}, ${EMBER_HOT.b.toFixed(3)});
  vec3 core = vec3(${FLAME_CORE.r.toFixed(3)}, ${FLAME_CORE.g.toFixed(3)}, ${FLAME_CORE.b.toFixed(3)});
  totalEmissiveRadiance += mix(emberCol, emberHot, flicker) * ember * 10.0;
  totalEmissiveRadiance += mix(emberHot, core, pow(flame, 0.55)) * flame * 36.0;
  totalEmissiveRadiance += core * pow(flame, 3.2) * 48.0;
}`,
      )
  }
  material.customProgramCacheKey = () => 'burnout-sheet-v8'
}

function rigSheet(material: THREE.Material) {
  const geo = new THREE.PlaneGeometry(SHEET.w, SHEET.h, 12, 16)
  const root = new THREE.Bone()
  const left = new THREE.Bone()
  const right = new THREE.Bone()
  root.add(left)
  root.add(right)
  const skeleton = new THREE.Skeleton([root, left, right])

  const pos = geo.attributes.position
  const skinIndex = new Uint16Array(pos.count * 4)
  const skinWeight = new Float32Array(pos.count * 4)
  const half = SHEET.w / 2
  for (let i = 0; i < pos.count; i += 1) {
    const t = THREE.MathUtils.clamp((pos.getX(i) + half) / SHEET.w, 0, 1)
    if (t < .5) {
      const k = THREE.MathUtils.smoothstep(t, .32, .5)
      skinIndex[i * 4] = 1
      skinIndex[i * 4 + 1] = 0
      skinWeight[i * 4] = 1 - k
      skinWeight[i * 4 + 1] = k
    } else {
      const k = THREE.MathUtils.smoothstep(t, .5, .68)
      skinIndex[i * 4] = 2
      skinIndex[i * 4 + 1] = 0
      skinWeight[i * 4] = k
      skinWeight[i * 4 + 1] = 1 - k
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))

  const mesh = new THREE.SkinnedMesh(geo, material)
  mesh.add(root)
  mesh.bind(skeleton)
  mesh.frustumCulled = false
  mesh.castShadow = true
  mesh.receiveShadow = true
  return { mesh, root, left, right }
}

function makeFlameMaterial(phase: number, kind: number, disc: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: phase },
      uIntensity: { value: 1 },
      uFade: { value: 1 },
      uKind: { value: kind },
      uDisc: { value: disc },
    },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    premultipliedAlpha: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
}

function billboardUp(mesh: THREE.Object3D, camera: THREE.Camera) {
  const dx = camera.position.x - mesh.position.x
  const dz = camera.position.z - mesh.position.z
  mesh.rotation.set(0, Math.atan2(dx, dz), 0)
}

function emptySpark(): Ember {
  return { age: 99, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
}

function lowestCorner(position: THREE.Vector3, quaternion: THREE.Quaternion) {
  let lowest = Infinity
  for (const corner of CORNERS) {
    _r.set(corner[0], corner[1], 0).applyQuaternion(quaternion)
    lowest = Math.min(lowest, position.y + _r.y)
  }
  return lowest
}

function pinToFloor(sheet: Sheet, quaternion: THREE.Quaternion) {
  const lift = FLOOR_Y + .002 - lowestCorner(sheet.position, quaternion)
  sheet.position.y += lift
}

function beginRest(sheet: Sheet) {
  if (sheet.resting) return
  sheet.resting = true
  sheet.restLocked = false
  sheet.landT = 0
  sheet.linear.set(0, 0, 0)
  sheet.angular.set(0, 0, 0)
  sheet.flutter = 0
  sheet.landFromQuat.copy(sheet.quaternion)
  sheet.landFromX = sheet.position.x
  sheet.landFromZ = THREE.MathUtils.clamp(sheet.position.z, -1.15, TYPE_PLANE_Z)
  _n.set(0, 0, 1).applyQuaternion(sheet.quaternion)
  const sign = _n.y >= 0 ? 1 : -1
  _restN.set(_n.x * .28, sign, _n.z * .28).normalize()
  sheet.restQuat.setFromUnitVectors(_flat, _restN)
  const side = Math.sign(sheet.position.x || sheet.drift || 1)
  sheet.restX = side * Math.max(REST_HALF_X, Math.abs(sheet.position.x))
  sheet.restZ = sheet.landFromZ
  _tmp.set(sheet.restX, 0, sheet.restZ)
  sheet.restY = FLOOR_Y + .002 - lowestCorner(_tmp, sheet.restQuat)
  pinToFloor(sheet, sheet.quaternion)
}

function lockRest(sheet: Sheet) {
  sheet.restLocked = true
  sheet.landT = 1
  sheet.linear.set(0, 0, 0)
  sheet.angular.set(0, 0, 0)
  sheet.flutter = 0
  sheet.position.set(sheet.restX, sheet.restY, sheet.restZ)
  sheet.quaternion.copy(sheet.restQuat)
  pinToFloor(sheet, sheet.restQuat)
  sheet.restY = sheet.position.y
}

function clampVec(v: THREE.Vector3, max: number) {
  const len = v.length()
  if (len > max) v.multiplyScalar(max / len)
}

function sampleBurnField(u: number, v: number, origin: THREE.Vector2) {
  const edge = Math.min(u, 1 - u, v, 1 - v)
  const dx = u - origin.x
  const dy = (v - origin.y) * 1.28
  return edge * .55 + Math.hypot(dx, dy) * .42
}

function marchFront(sheet: Sheet, angle: number, out: THREE.Vector2) {
  const ox = sheet.origin.x
  const oy = sheet.origin.y
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const target = sheet.burn
  let lo = 0
  let hi = 1.8
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) * .5
    const u = ox + dx * mid
    const v = oy + dy * mid
    if (u <= 0 || u >= 1 || v <= 0 || v >= 1) {
      hi = mid
      continue
    }
    if (sampleBurnField(u, v, sheet.origin) < target) lo = mid
    else hi = mid
  }
  out.set(
    THREE.MathUtils.clamp(ox + dx * lo, .015, .985),
    THREE.MathUtils.clamp(oy + dy * lo, .015, .985),
  )
  return out
}

function skinnedWorld(sheet: Sheet, lx: number, ly: number, out: THREE.Vector3) {
  const t = THREE.MathUtils.clamp((lx + SHEET.w / 2) / SHEET.w, 0, 1)
  const root = sheet.mesh.skeleton.bones[0]
  let boneA: THREE.Bone
  let wA: number
  if (t < .5) {
    boneA = sheet.left
    wA = 1 - THREE.MathUtils.smoothstep(t, .32, .5)
  } else {
    boneA = sheet.right
    wA = THREE.MathUtils.smoothstep(t, .5, .68)
  }
  _b0.set(lx, ly, 0).applyMatrix4(boneA.matrixWorld)
  _b1.set(lx, ly, 0).applyMatrix4(root.matrixWorld)
  return out.lerpVectors(_b1, _b0, wA)
}

function uvToLocal(u: number, v: number, out: THREE.Vector3) {
  return out.set((u - .5) * SHEET.w, (v - .5) * SHEET.h, 0)
}

function stepSheet(sheet: Sheet, dt: number) {
  sheet.age += dt
  if (sheet.age < sheet.spawnDelay) return

  if (sheet.restLocked) {
    sheet.position.set(sheet.restX, sheet.restY, sheet.restZ)
    sheet.quaternion.copy(sheet.restQuat)
    sheet.linear.set(0, 0, 0)
    sheet.angular.set(0, 0, 0)
    sheet.fold += (sheet.foldTarget - sheet.fold) * (1 - Math.exp(-dt * 2.4))
    sheet.flap += (0 - sheet.flap) * (1 - Math.exp(-dt * 4.2))
    return
  }

  if (sheet.resting) {
    sheet.landT = Math.min(1, sheet.landT + dt / LAND_SEC)
    const ease = 1 - (1 - sheet.landT) * (1 - sheet.landT) * (1 - sheet.landT)
    sheet.quaternion.copy(sheet.landFromQuat).slerp(sheet.restQuat, ease)
    sheet.position.x = sheet.landFromX + (sheet.restX - sheet.landFromX) * ease
    sheet.position.z = sheet.landFromZ + (sheet.restZ - sheet.landFromZ) * ease
    pinToFloor(sheet, sheet.quaternion)
    sheet.linear.set(0, 0, 0)
    sheet.angular.set(0, 0, 0)
    sheet.flutter += (0 - sheet.flutter) * (1 - Math.exp(-dt * 5.2))
    sheet.foldTarget = .045 + Math.sin(sheet.phase) * .02
    sheet.flapTarget = 0
    sheet.fold += (sheet.foldTarget - sheet.fold) * (1 - Math.exp(-dt * 2.8))
    sheet.flap += (sheet.flapTarget - sheet.flap) * (1 - Math.exp(-dt * 4.2))
    if (sheet.landT >= 1) lockRest(sheet)
    return
  }

  sheet.quaternion.normalize()
  _n.set(0, 0, 1).applyQuaternion(sheet.quaternion)
  const speed = sheet.linear.length()
  const area = SHEET.w * SHEET.h
  const clearance = lowestCorner(sheet.position, sheet.quaternion) - FLOOR_Y
  const nearFloor = clearance < GROUND_BAND * 1.6

  _force.set(0, -MASS * GRAVITY, 0)
  _torque.set(0, 0, 0)
  let face = 0

  if (!nearFloor && speed > .04) {
    _vhat.copy(sheet.linear).multiplyScalar(1 / speed)
    const aoa = THREE.MathUtils.clamp(_n.dot(_vhat), -1, 1)
    face = aoa * aoa
    const cd = (CD_EDGE + (CD_FACE - CD_EDGE) * face) * sheet.drag
    const cl = CL_PEAK * 2.2 * aoa * (1 - Math.abs(aoa)) * sheet.lift
    const vn = sheet.linear.dot(_n)
    _aero.copy(_n).multiplyScalar(-.5 * AIR * cd * area * vn * Math.abs(vn))
    _vt.copy(sheet.linear).addScaledVector(_n, -vn)
    _span.crossVectors(_n, _vhat)
    if (_span.lengthSq() < 1e-6) _span.set(1, 0, 0).applyQuaternion(sheet.quaternion)
    else _span.normalize()
    _lift.crossVectors(_span, _vhat)
    if (_lift.lengthSq() > 1e-8) {
      _lift.normalize().multiplyScalar(.5 * AIR * cl * area * speed * speed)
    } else {
      _lift.set(0, 0, 0)
    }
    _force.add(_aero).add(_lift).addScaledVector(_vt, -.5 * AIR * .1 * area * speed)
    _force.x += Math.sin(sheet.age * .62 + sheet.phase) * .01
    _cp.set(Math.sign(aoa || 1) * SHEET.w * .12 * (1 - Math.abs(aoa)), 0, 0)
    _cp.applyQuaternion(sheet.quaternion)
    _torque.copy(_cp).cross(_aero)
    const tumble = Math.sin(sheet.age * (.55 + sheet.flutterHz * .18) + sheet.phase) * .018
    _torque.x += tumble
    _torque.z += Math.cos(sheet.age * .4 + sheet.phase) * .012
  }

  _torque.addScaledVector(sheet.angular, -ANGULAR_DAMP * sheet.drag)

  if (!nearFloor && sheet.position.y > TYPE_Y_LO && sheet.position.y < TYPE_Y_HI) {
    const ax = Math.abs(sheet.position.x)
    if (ax < TYPE_HALF_X) {
      const away = Math.sign(sheet.position.x || sheet.drift || 1) * (TYPE_HALF_X - ax)
      sheet.linear.x += away * 4.2 * dt
      sheet.position.x += away * .35
    }
  }

  const h = dt / SUBSTEPS
  for (let step = 0; step < SUBSTEPS; step += 1) {
    sheet.linear.addScaledVector(_force, h / MASS)
    clampVec(sheet.linear, MAX_SPEED)

    _invQ.copy(sheet.quaternion).invert()
    _localOmega.copy(sheet.angular).applyQuaternion(_invQ)
    _localTorque.copy(_torque).applyQuaternion(_invQ)
    _localOmega.x += (_localTorque.x / IXX) * h
    _localOmega.y += (_localTorque.y / IYY) * h
    _localOmega.z += (_localTorque.z / IZZ) * h
    _localOmega.multiplyScalar(Math.exp(-h * 1.15))
    sheet.angular.copy(_localOmega).applyQuaternion(sheet.quaternion)
    clampVec(sheet.angular, MAX_OMEGA)

    sheet.position.addScaledVector(sheet.linear, h)
    _qDot.set(sheet.angular.x, sheet.angular.y, sheet.angular.z, 0).multiply(sheet.quaternion)
    sheet.quaternion.x += _qDot.x * .5 * h
    sheet.quaternion.y += _qDot.y * .5 * h
    sheet.quaternion.z += _qDot.z * .5 * h
    sheet.quaternion.w += _qDot.w * .5 * h
    sheet.quaternion.normalize()

    if (sheet.position.z > TYPE_PLANE_Z) {
      sheet.position.z = TYPE_PLANE_Z
      if (sheet.linear.z > 0) sheet.linear.z = 0
    }
    if (sheet.position.z < -1.18) {
      sheet.position.z = -1.18
      if (sheet.linear.z < 0) sheet.linear.z = 0
    }
    const ax = Math.abs(sheet.position.x)
    if (ax > 2.62) {
      sheet.position.x = Math.sign(sheet.position.x) * 2.62
      sheet.linear.x = 0
    }

    const lowest = lowestCorner(sheet.position, sheet.quaternion)
    if (lowest < FLOOR_Y) {
      sheet.position.y += FLOOR_Y - lowest
      if (sheet.linear.y < 0) sheet.linear.y = 0
      sheet.linear.x *= .55
      sheet.linear.z *= .55
      sheet.angular.multiplyScalar(.4)
    }
  }

  const floorClearance = lowestCorner(sheet.position, sheet.quaternion) - FLOOR_Y
  const speedNow = sheet.linear.length()
  const omega = sheet.angular.length()
  if (
    floorClearance < GROUND_BAND && speedNow < REST_SPEED && omega < REST_OMEGA
    || floorClearance < .03 && sheet.linear.y > -.45
    || floorClearance < .12 && speedNow < .28
  ) {
    beginRest(sheet)
    return
  }

  const flutterTarget = nearFloor ? 0 : Math.min(speed, 2.2) * (1.05 - face) * .35
  sheet.flutter += (flutterTarget - sheet.flutter) * (1 - Math.exp(-dt * 2.1))
  const pressure = face * Math.min(speed, 2.4) * .05
  sheet.foldTarget = .07 + pressure * .45 + Math.abs(Math.sin(sheet.age * .9 + sheet.phase)) * .03
  sheet.flapTarget = pressure * .35 + sheet.flutter * .025
  sheet.fold += (sheet.foldTarget - sheet.fold) * (1 - Math.exp(-dt * 2.6))
  sheet.flap += (sheet.flapTarget - sheet.flap) * (1 - Math.exp(-dt * 2.8))
}

export function createBurnoutScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  const lights = addNavyCyc(scene)
  parkNavyKey(lights)

  const rig = new CameraRig(
    { still: { ...LENS, parallax: 0 } },
    'still',
    context.width / Math.max(1, context.height),
  )

  const random = seededRandom(20260813)
  const reduced = context.reduced
  const paperMap = paintPaper(random)
  paperMap.anisotropy = Math.min(16, context.renderer.capabilities.getMaxAnisotropy())
  const emberMap = radialSprite([
    [0, 'rgba(255, 244, 210, 1)'],
    [.22, 'rgba(255, 168, 48, .95)'],
    [.62, 'rgba(255, 70, 10, .28)'],
    [1, 'rgba(0, 0, 0, 0)'],
  ])
  const smokeMap = radialSprite([
    [0, 'rgba(210, 190, 150, .55)'],
    [.4, 'rgba(90, 120, 150, .22)'],
    [1, 'rgba(0, 0, 0, 0)'],
  ], 256)
  const discMap = discSprite()

  const flameGeo = new THREE.CircleGeometry(.13, 28)
  const bloomGeo = new THREE.PlaneGeometry(.55, .55)
  const viewport = { value: Math.max(1, context.height) * context.renderer.getPixelRatio() * .55 }

  const seeds = [
    {
      position: [-2.32, 5.28, -.48] as const,
      linear: [-.58, -.64, -.12] as const,
      angular: [1.35, -1.55, .95] as const,
      quaternion: [0.26, 0.34, -0.16, 0.89] as const,
      origin: [0.1, 0.12] as const,
      burn: .07,
      burnRate: .013,
      phase: .35,
      delay: 0,
      drag: .94,
      lift: 1.06,
      drift: -.46,
      flutterHz: .55,
    },
    {
      position: [2.26, 5.52, .04] as const,
      linear: [.62, -.58, .14] as const,
      angular: [-1.45, 1.28, -1.22] as const,
      quaternion: [-0.14, 0.4, 0.26, 0.86] as const,
      origin: [0.88, 0.14] as const,
      burn: .05,
      burnRate: .011,
      phase: 1.9,
      delay: .52,
      drag: 1.06,
      lift: .94,
      drift: .5,
      flutterHz: 1.45,
    },
    {
      position: [-1.78, 3.92, -.92] as const,
      linear: [-.32, -.72, -.18] as const,
      angular: [.85, 1.7, -.72] as const,
      quaternion: [0.4, -0.2, 0.1, 0.89] as const,
      origin: [0.14, 0.88] as const,
      burn: .08,
      burnRate: .014,
      phase: 3.4,
      delay: 1.08,
      drag: .98,
      lift: 1.04,
      drift: -.28,
      flutterHz: .92,
    },
    {
      position: [1.82, 5.12, -.32] as const,
      linear: [.38, -.7, .16] as const,
      angular: [1.12, -.95, 1.38] as const,
      quaternion: [0.18, -0.36, 0.22, 0.89] as const,
      origin: [0.86, 0.82] as const,
      burn: .06,
      burnRate: .012,
      phase: 2.6,
      delay: 1.68,
      drag: 1.04,
      lift: .92,
      drift: .34,
      flutterHz: 1.78,
    },
    {
      position: [2.08, 3.78, -.62] as const,
      linear: [.22, -.55, .2] as const,
      angular: [-1.18, .82, -1.05] as const,
      quaternion: [-0.32, 0.12, 0.28, 0.89] as const,
      origin: [0.12, 0.78] as const,
      burn: .055,
      burnRate: .012,
      phase: 4.1,
      delay: 2.22,
      drag: 1.08,
      lift: .98,
      drift: .42,
      flutterHz: .38,
    },
  ]

  const sheets: Sheet[] = []
  for (const seed of seeds.slice(0, PAPER_COUNT)) {
    const uniforms: BurnUniforms = {
      uBurn: { value: seed.burn },
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector2(seed.origin[0], seed.origin[1]) },
    }
    const material = new THREE.MeshStandardMaterial({
      map: paperMap,
      color: 0xffffff,
      roughness: .78,
      metalness: 0,
      transparent: false,
      alphaTest: .4,
      depthWrite: true,
      side: THREE.DoubleSide,
      emissive: PALETTE.paper,
      emissiveIntensity: .12,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
    patchBurn(material, uniforms)
    const { mesh, left, right } = rigSheet(material)
    const group = new THREE.Group()
    group.add(mesh)
    scene.add(group)

    const light = new THREE.PointLight(0xffc060, 12, 3.6, 2)
    const hotLight = new THREE.PointLight(0xffe7a8, 22, 2.8, 2)
    scene.add(light)
    scene.add(hotLight)

    const bloomMat = makeFlameMaterial(seed.phase, 1, discMap)
    const bloom = new THREE.Mesh(bloomGeo, bloomMat)
    bloom.renderOrder = 3
    bloom.frustumCulled = false
    scene.add(bloom)

    const flames: Flame[] = []
    for (let i = 0; i < FLAME_PER_SHEET; i += 1) {
      const flameMat = makeFlameMaterial(seed.phase + i * .73, 0, discMap)
      const sprite = new THREE.Mesh(flameGeo, flameMat)
      sprite.renderOrder = 5
      sprite.frustumCulled = false
      scene.add(sprite)
      flames.push({
        mesh: sprite,
        material: flameMat,
        u: (i + .5) / FLAME_PER_SHEET,
        side: i % 4,
        phase: seed.phase + i * .73,
        cluster: true,
      })
    }

    const sheet: Sheet = {
      group,
      mesh,
      left,
      right,
      light,
      hotLight,
      bloom,
      bloomMat,
      origin: new THREE.Vector2(seed.origin[0], seed.origin[1]),
      position: new THREE.Vector3(...seed.position),
      quaternion: new THREE.Quaternion(...seed.quaternion).normalize(),
      linear: new THREE.Vector3(...seed.linear),
      angular: new THREE.Vector3(...seed.angular),
      burn: seed.burn,
      burnRate: seed.burnRate,
      uniforms,
      embers: Array.from({ length: EMBER_PER_SHEET }, emptySpark),
      smoke: Array.from({ length: SMOKE_PER_SHEET }, emptySpark),
      flames,
      fold: .1,
      foldTarget: .1,
      flap: .04,
      flapTarget: .04,
      age: 0,
      phase: seed.phase,
      flutter: 1.15,
      spawnDelay: seed.delay,
      drag: seed.drag,
      lift: seed.lift,
      drift: seed.drift,
      flutterHz: seed.flutterHz,
      resting: false,
      restLocked: false,
      landT: 0,
      landFromQuat: new THREE.Quaternion(),
      restQuat: new THREE.Quaternion(),
      restX: seed.position[0],
      restY: FLOOR_Y + SHEET.h * .02,
      restZ: seed.position[2],
      landFromX: seed.position[0],
      landFromZ: seed.position[2],
    }
    if (reduced) {
      sheet.position.set(seed.position[0], 0.12 + seed.phase * .04, seed.position[2])
      sheet.linear.set(0, 0, 0)
      sheet.angular.set(0, 0, 0)
      sheet.spawnDelay = 0
      beginRest(sheet)
      lockRest(sheet)
    }
    sheet.group.position.copy(sheet.position)
    sheet.group.quaternion.copy(sheet.quaternion)
    sheets.push(sheet)
  }

  const emberCount = PAPER_COUNT * EMBER_PER_SHEET
  const emberGeo = new THREE.BufferGeometry()
  const emberPos = new Float32Array(emberCount * 3)
  const emberLife = new Float32Array(emberCount)
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3))
  emberGeo.setAttribute('aLife', new THREE.BufferAttribute(emberLife, 1))
  const emberMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: emberMap }, uSize: { value: .045 }, uViewport: viewport },
    vertexShader: POINT_VERT,
    fragmentShader: EMBER_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    premultipliedAlpha: true,
    toneMapped: false,
  })
  const embers = new THREE.Points(emberGeo, emberMat)
  embers.frustumCulled = false
  scene.add(embers)

  const smokeCount = PAPER_COUNT * SMOKE_PER_SHEET
  const smokeGeo = new THREE.BufferGeometry()
  const smokePos = new Float32Array(smokeCount * 3)
  const smokeLife = new Float32Array(smokeCount)
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3))
  smokeGeo.setAttribute('aLife', new THREE.BufferAttribute(smokeLife, 1))
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: smokeMap }, uSize: { value: .22 }, uViewport: viewport },
    vertexShader: POINT_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    premultipliedAlpha: true,
    toneMapped: false,
  })
  const smokePts = new THREE.Points(smokeGeo, smokeMat)
  smokePts.frustumCulled = false
  scene.add(smokePts)

  const flameUV = (sheet: Sheet, flame: Flame) => {
    const intoU = sheet.origin.x < .5 ? 1 : -1
    const intoV = sheet.origin.y < .5 ? 1 : -1
    const base = Math.atan2(intoV, intoU)
    const spread = 1.48
    const ang = base + (flame.u - .5) * spread * 2
    return marchFront(sheet, ang, _uv)
  }

  const writeSheet = (sheet: Sheet, elapsed: number, fade = 1) => {
    const born = sheet.age >= sheet.spawnDelay
    sheet.group.visible = born
    if (!born) {
      sheet.light.intensity = 0
      sheet.hotLight.intensity = 0
      sheet.bloom.visible = false
      for (const flame of sheet.flames) flame.mesh.visible = false
      return
    }
    sheet.group.position.copy(sheet.position)
    sheet.group.quaternion.copy(sheet.quaternion)
    const locked = sheet.restLocked
    const curl = locked ? 0 : Math.sin(elapsed * .85 + sheet.phase) * (.03 + sheet.flutter * .018)
    const flapL = locked ? 0 : (sheet.flap + Math.sin(elapsed * 1.7 + sheet.phase) * sheet.flutter * .03)
    const flapR = locked ? 0 : (sheet.flap * .9 + Math.cos(elapsed * 1.45 + sheet.phase) * sheet.flutter * .026)
    sheet.left.rotation.y = sheet.fold + curl
    sheet.right.rotation.y = -(sheet.fold - curl * .55)
    sheet.left.rotation.x = flapL
    sheet.right.rotation.x = -flapR
    sheet.mesh.updateMatrixWorld(true)
    sheet.uniforms.uBurn.value = sheet.burn
    sheet.uniforms.uTime.value = elapsed
    sheet.uniforms.uOrigin.value.copy(sheet.origin)

    _n.set(0, 0, 1).applyQuaternion(sheet.quaternion)
    _cam.copy(rig.camera.position).sub(sheet.position)
    if (_n.dot(_cam) < 0) _n.negate()

    const flicker = .86 + Math.sin(elapsed * 9.2 + sheet.phase) * .08
      + Math.sin(elapsed * 17 + sheet.phase * 1.3) * .04
    const heat = THREE.MathUtils.clamp(.4 + sheet.burn * 3.4, .5, 1.7)

    uvToLocal(sheet.origin.x, sheet.origin.y, _local)
    skinnedWorld(sheet, _local.x, _local.y, _world)
    _world.addScaledVector(_n, .01)

    sheet.light.intensity = 10 * heat * flicker * fade
    sheet.light.color.setRGB(1, .62 + flicker * .18, .22 + flicker * .12)
    sheet.light.position.copy(_world)

    sheet.hotLight.intensity = 18 * heat * flicker * fade
    sheet.hotLight.color.setRGB(1, .78 + flicker * .16, .42)
    sheet.hotLight.position.copy(_world).addScaledVector(_n, .02)

    const mat = sheet.mesh.material as THREE.MeshStandardMaterial
    mat.opacity = fade
    mat.transparent = fade < .98

    const alive = fade > .04
    sheet.bloom.position.copy(_world).addScaledVector(_n, .006)
    const bloomScale = (.4 + sheet.burn * 1.1) * (0.88 + flicker * .1)
    sheet.bloom.scale.setScalar(bloomScale)
    sheet.bloom.visible = alive
    billboardUp(sheet.bloom, rig.camera)
    sheet.bloomMat.uniforms.uTime.value = elapsed
    sheet.bloomMat.uniforms.uIntensity.value = (.4 + sheet.burn * 1.1) * fade
    sheet.bloomMat.uniforms.uFade.value = fade

    for (const flame of sheet.flames) {
      const uv = flameUV(sheet, flame)
      uvToLocal(uv.x, uv.y, _local)
      skinnedWorld(sheet, _local.x, _local.y, _front)
      const onFront = sheet.burn > .04
      const intensity = THREE.MathUtils.clamp(.7 + sheet.burn * 1.5, .5, 1.4)
        * (.9 + Math.sin(elapsed * 8.5 + flame.phase) * .1)
      flame.mesh.position.copy(_front).addScaledVector(_n, .008)
      const tongue = (.55 + sheet.burn * .9) * (.94 + Math.sin(elapsed * 11 + flame.phase) * .06)
      flame.mesh.scale.setScalar(tongue)
      flame.mesh.visible = alive && onFront && intensity > .08
      billboardUp(flame.mesh, rig.camera)
      flame.material.uniforms.uTime.value = elapsed
      flame.material.uniforms.uIntensity.value = intensity * fade
      flame.material.uniforms.uFade.value = fade
    }
  }

  const takeSpark = (pool: Ember[], randomN: () => number) => {
    const slot = pool.reduce((best, spark, index) => (
      spark.age >= spark.life && (best < 0 || pool[best].age < spark.age) ? index : best
    ), -1)
    return pool[slot >= 0 ? slot : Math.floor(randomN() * pool.length)]
  }

  const spawnAtFront = (sheet: Sheet, randomN: () => number, spark: Ember, rise: number, life: number) => {
    const intoU = sheet.origin.x < .5 ? 1 : -1
    const intoV = sheet.origin.y < .5 ? 1 : -1
    const base = Math.atan2(intoV, intoU)
    marchFront(sheet, base + (randomN() - .5) * 2.2, _uv)
    uvToLocal(_uv.x, _uv.y, _local)
    skinnedWorld(sheet, _local.x, _local.y, _world)
    spark.x = _world.x
    spark.y = _world.y
    spark.z = _world.z
    spark.vx = (randomN() - .5) * .55
    spark.vy = rise
    spark.vz = (randomN() - .5) * .55
    spark.age = 0
    spark.life = life
  }

  for (const sheet of sheets) writeSheet(sheet, 0)

  let emberClock = 0
  let smokeClock = 0
  let fading = false
  let fadeT = 0

  return {
    scene,
    camera: rig.camera,
    grade: {
      flatten: 0,
      grain: .014,
      inkStrength: .16,
      bands: 56,
      saturation: 1.05,
    },
    update(delta, elapsed) {
      rig.update(delta, { x: 0, y: 0 })
      if (reduced) {
        for (const sheet of sheets) {
          sheet.burn = Math.min(BURN_IDLE_CAP, sheet.burn + sheet.burnRate * Math.min(.033, delta))
          writeSheet(sheet, elapsed, 1)
        }
        return
      }

      const dt = Math.min(.033, delta)
      if (fading) fadeT = Math.min(1, fadeT + dt / FADE_SEC)
      const fade = fading ? (1 - fadeT) * (1 - fadeT) : 1
      emberClock += dt
      smokeClock += dt
      let emberIndex = 0
      let smokeIndex = 0
      for (const sheet of sheets) {
        stepSheet(sheet, dt)
        sheet.burn = Math.min(BURN_IDLE_CAP, sheet.burn + sheet.burnRate * dt)
        writeSheet(sheet, elapsed, fade)

        if (!fading && emberClock > .032 && sheet.age >= sheet.spawnDelay) {
          spawnAtFront(sheet, random, takeSpark(sheet.embers, random), 1.35 + random() * 1.8, .45 + random() * .7)
          spawnAtFront(sheet, random, takeSpark(sheet.embers, random), 1.1 + random() * 1.5, .5 + random() * .8)
        }
        if (!fading && smokeClock > .11 && sheet.age >= sheet.spawnDelay) {
          const puff = takeSpark(sheet.smoke, random)
          spawnAtFront(sheet, random, puff, .28 + random() * .45, 1.5 + random() * 1.4)
          puff.vx *= .45
          puff.vz *= .45
        }

        for (const ember of sheet.embers) {
          ember.age += dt
          ember.vy += 1.15 * dt
          ember.vx *= .955
          ember.vz *= .955
          ember.x += ember.vx * dt
          ember.y += ember.vy * dt
          ember.z += ember.vz * dt
          const live = fade > .04 && ember.age < ember.life
          const remain = live ? 1 - ember.age / ember.life : 0
          emberPos[emberIndex * 3] = live ? ember.x : 0
          emberPos[emberIndex * 3 + 1] = live ? ember.y : -40
          emberPos[emberIndex * 3 + 2] = live ? ember.z : 0
          emberLife[emberIndex] = remain
          emberIndex += 1
        }
        for (const puff of sheet.smoke) {
          puff.age += dt
          puff.vy += .22 * dt
          puff.vx *= .97
          puff.vz *= .97
          puff.x += puff.vx * dt
          puff.y += puff.vy * dt
          puff.z += puff.vz * dt
          const live = fade > .04 && puff.age < puff.life
          const remain = live ? 1 - puff.age / puff.life : 0
          smokePos[smokeIndex * 3] = live ? puff.x : 0
          smokePos[smokeIndex * 3 + 1] = live ? puff.y : -40
          smokePos[smokeIndex * 3 + 2] = live ? puff.z : 0
          smokeLife[smokeIndex] = remain
          smokeIndex += 1
        }
      }
      if (!fading && emberClock > .032) emberClock = 0
      if (!fading && smokeClock > .11) smokeClock = 0
      emberGeo.attributes.position.needsUpdate = true
      emberGeo.attributes.aLife.needsUpdate = true
      smokeGeo.attributes.position.needsUpdate = true
      smokeGeo.attributes.aLife.needsUpdate = true
    },
    resize(width, height) {
      rig.resize(width, height)
      viewport.value = Math.max(1, height) * context.renderer.getPixelRatio() * .55
    },
    setFraming(name, immediate) {
      if (name === 'fade') {
        fading = true
        return
      }
      fading = false
      fadeT = 0
      rig.go(name, immediate, 1.1)
    },
    dispose() {
      paperMap.dispose()
      emberMap.dispose()
      smokeMap.dispose()
      discMap.dispose()
      flameGeo.dispose()
      bloomGeo.dispose()
      emberGeo.dispose()
      smokeGeo.dispose()
      emberMat.dispose()
      smokeMat.dispose()
      disposeTree(scene)
    },
  }
}
