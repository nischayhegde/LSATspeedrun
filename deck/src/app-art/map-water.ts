import * as THREE from 'three'

/**
 * One water implementation for every map.
 *
 * The Treaty Sea's open water and the rivers on the other three used to be two
 * unrelated shaders. The sea was a displaced plane with value-noise swell, a
 * normal derived from the height field, fresnel, a sun specular and foam on the
 * crests. A river was a flat strip with `position.y += sin(uv.y*34 - t)` and a
 * `smoothstep` on `sin(uv.y*70)` for a highlight — which is why the canal read
 * as corrugated plastic and The Circuit's river as a sawtooth-edged ribbon laid
 * on the grass: no normal, so no light; a hard periodic glint, so stripes; and
 * displacement applied right out to the bank, so the silhouette against the
 * ground serrated.
 *
 * Both surfaces are now the same noise, the same normal reconstruction and the
 * same shading, differing only in what a river genuinely has and open water
 * does not:
 *
 *  - **flow.** A river's ripples travel downstream. The noise is sampled in
 *    ribbon space — across the channel and *along* it — and advected along the
 *    second axis, so the pattern moves the way the water does. The sea's noise
 *    drifts in world space with no preferred direction, which is what a swell
 *    does.
 *  - **banks.** Displacement, and the noise amplitude with it, is damped to
 *    zero at the water's edge, so the outline where it meets the bank is the
 *    geometry's own outline and does not move. The last fraction of the channel
 *    is shaded as shallow water with broken foam against the bank, which is
 *    what makes a strip of blue read as water in a channel rather than as paint.
 *  - **width variation.** A natural watercourse is not a constant-width canal,
 *    so the geometry can taper along its length. A built canal asks for zero
 *    taper and gets it.
 *
 * The sea additionally carries a wake, because a vessel crossing it should
 * disturb it. That is per-pixel rather than per-vertex on purpose: the swell is
 * tens of units long and is tessellated for that, so a two-unit boat's wake has
 * no vertices to move. Perturbing the normal and adding foam in the fragment
 * shader gives it the resolution it needs for nothing but arithmetic.
 */

/** Value noise and an fbm over it, at a caller-chosen octave count. */
function noiseChunk(octaves: number) {
  return `
    float hash21(vec2 p){
      p=fract(p*vec2(123.34,456.21));
      p+=dot(p,p+45.32);
      return fract(p.x*p.y);
    }
    float noise2(vec2 p){
      vec2 i=floor(p),f=fract(p);
      f=f*f*(3.0-2.0*f);
      return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.)),f.x),f.y);
    }
    float fbm(vec2 p){
      float value=0.;
      float amplitude=.5;
      mat2 turn=mat2(.80,-.60,.60,.80);
      for(int octave=0;octave<${octaves};octave++){
        value+=amplitude*(noise2(p)-.5);
        p=turn*p*2.03+vec2(11.7,7.9);
        amplitude*=.52;
      }
      return value;
    }`
}

/**
 * The shared surface shading. `depth` is 0 at the bank and 1 in open water, so
 * the sea passes 1 everywhere and a river passes its own bank ramp.
 */
const SHADE_CHUNK = `
  vec3 shadeWater(
    vec3 normal, vec3 world, float height, float foam, float depth,
    vec3 deep, vec3 shallow, vec3 sky, vec3 sun
  ){
    vec3 viewDirection=normalize(cameraPosition-world);
    vec3 lightDirection=normalize(vec3(-.42,.82,.36));
    float fresnel=pow(1.-max(dot(normal,viewDirection),0.),3.2);
    float specular=pow(max(dot(reflect(-lightDirection,normal),viewDirection),0.),78.);
    float broad=pow(max(dot(reflect(-lightDirection,normal),viewDirection),0.),11.);
    vec3 water=mix(deep,shallow,clamp(height*1.45+.42,0.,1.));
    // Shoaling: the bed shows through where the water is thin.
    water=mix(shallow,water,clamp(depth,0.,1.));
    water=mix(water,sky,(.18+fresnel*.6)*mix(.55,1.,clamp(depth,0.,1.)));
    water+=sun*(specular*.92+broad*.13);
    water=mix(water,vec3(.76,.84,.80),foam*.22);
    return water;
  }`

export type WaterUniforms = {
  uTime: { value: number }
  uDeep: { value: THREE.Color }
  uShallow: { value: THREE.Color }
  uSky: { value: THREE.Color }
  uSun: { value: THREE.Color }
}

/** A vessel disturbing open water: XZ position, unit heading, 0..1 strength. */
export type WaterWake = {
  uWake: { value: THREE.Vector3 }
  uWakeDirection: { value: THREE.Vector2 }
}

/**
 * Both surfaces are plain meshes carrying their uniforms on `userData`, which is
 * the convention the scene's animate loop already looks for when it advances
 * `uTime`. Typing the `userData` bag itself is not worth the casts: three's own
 * `Record<string, any>` will not narrow, and the scene has one place that reads
 * these and it is right next to the place that writes them.
 */
export type SeaSurface = THREE.Mesh

/**
 * Open water.
 *
 * Tessellation is set from the swell it has to carry, not from the size of the
 * plane: the longest component has a wavelength of about nine units, so a
 * vertex every two and a half resolves it with room to spare. It used to be
 * every 1.2 units, which is four times the vertices and four times the
 * triangles for detail finer than the noise contains. The fbm is four octaves
 * for the same reason — the fifth and sixth contribute amplitudes of .07 and
 * .04 at wavelengths below the vertex spacing, so they could only ever alias.
 */
export function createSeaSurface(color: number): SeaSurface {
  const geometry = new THREE.PlaneGeometry(220, 180, 88, 72)
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(color).multiplyScalar(.62) },
    uShallow: { value: new THREE.Color(color).lerp(new THREE.Color(0x4f9698), .5) },
    uSky: { value: new THREE.Color(0xb9d3cf) },
    uSun: { value: new THREE.Color(0xf1d49a) },
  }
  const wake: WaterWake = {
    uWake: { value: new THREE.Vector3(0, 0, 0) },
    uWakeDirection: { value: new THREE.Vector2(1, 0) },
  }
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, ...wake },
    transparent: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      varying float vHeight;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      ${noiseChunk(4)}
      float waterHeight(vec2 p){
        float slow=fbm(p*.115+vec2(uTime*.075,-uTime*.038));
        float crossing=fbm((p*vec2(.19,.14))+vec2(-uTime*.052,uTime*.066));
        float swell=sin(p.x*.12+p.y*.07+uTime*.52)*.12+sin(p.x*-.055+p.y*.15-uTime*.38)*.075;
        return slow*.34+crossing*.18+swell;
      }
      void main(){
        vec3 p=position;
        float e=.28;
        float h=waterHeight(p.xy);
        float hx=waterHeight(p.xy+vec2(e,0.));
        float hy=waterHeight(p.xy+vec2(0.,e));
        p.z=h;
        vHeight=h;
        vNormalW=normalize(normalMatrix*vec3((h-hx)/e,(h-hy)/e,1.));
        vWorld=(modelMatrix*vec4(p,1.)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSun; uniform float uTime;
      uniform vec3 uWake; uniform vec2 uWakeDirection;
      varying float vHeight; varying vec3 vWorld; varying vec3 vNormalW;
      float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      ${SHADE_CHUNK}
      // A vessel's wake: two Kelvin arms trailing at about 19 degrees, a train
      // of transverse crests between them, and a bow cushion at the stem. Cheap
      // enough to evaluate per pixel, and skipped entirely both when nothing is
      // under way and, per pixel, outside the wake's own bounding strip.
      //
      // Comments inside these shader strings stay on line comments on purpose:
      // a JSDoc block here is one stray backtick away from closing the template
      // literal it lives in, which is exactly how this file first broke a build.
      float wakeField(vec2 at, out float foam){
        foam=0.;
        if(uWake.z<=0.001) return 0.;
        vec2 offset=at-uWake.xy;
        float astern=-dot(offset,uWakeDirection);
        float across=abs(offset.x*uWakeDirection.y-offset.y*uWakeDirection.x);
        if(astern<-2.2||astern>26.||across>12.) return 0.;
        float fade=uWake.z*exp(-max(astern,0.)*.075);
        // The arms.
        float arm=across-.32-max(astern,0.)*.355;
        float armBand=exp(-arm*arm*2.6);
        float armWave=sin(across*3.1-astern*1.4-uTime*3.4);
        // Transverse crests, only inside the arms.
        float inside=1.-smoothstep(0.,1.4,arm);
        float transverse=sin(astern*2.35-uTime*4.6)*exp(-max(astern,0.)*.14)*inside;
        // The bow cushion, ahead of and beside the stem.
        float bow=exp(-(offset.x*offset.x+offset.y*offset.y)*.55)*step(-2.2,astern)*step(astern,1.1);
        foam=clamp((armBand*(.55+armWave*.3)+bow*.9+max(transverse,0.)*.28)*fade*1.5,0.,1.);
        return (armBand*armWave*.55+transverse*.35+bow*.8)*fade;
      }
      void main(){
        float wakeFoam=0.;
        float wake=wakeField(vWorld.xz,wakeFoam);
        vec3 normal=normalize(vNormalW);
        if(abs(wake)>0.0005){
          // Slope of the wake field, by central difference in world XZ.
          float step=.35;
          float ignored;
          float dx=wakeField(vWorld.xz+vec2(step,0.),ignored)-wakeField(vWorld.xz-vec2(step,0.),ignored);
          float dz=wakeField(vWorld.xz+vec2(0.,step),ignored)-wakeField(vWorld.xz-vec2(0.,step),ignored);
          normal=normalize(normal+vec3(-dx/step,0.,-dz/step)*.42);
        }
        float micro=hash21(floor(vWorld.xz*2.1)+floor(uTime*2.));
        float foam=smoothstep(.23,.38,vHeight+micro*.045);
        vec3 water=shadeWater(normal,vWorld,vHeight+wake*.5,max(foam,wakeFoam),1.,uDeep,uShallow,uSky,uSun);
        float distanceHaze=smoothstep(35.,100.,distance(cameraPosition,vWorld));
        water=mix(water,uSky,distanceHaze*.24);
        gl_FragColor=vec4(water,1.);
      }`,
  })
  const sea = new THREE.Mesh(geometry, material)
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -.22
  sea.receiveShadow = true
  sea.userData.waterUniforms = uniforms
  sea.userData.waterWake = wake
  return sea
}

/**
 * Report a vessel's position and heading to a sea surface.
 *
 * `speed` is in world units per second, and the wake hides itself below
 * steerage way rather than following a berthed vessel around — the same rule
 * `attachWake` applies to the geometric bow wave on the hull, so the two agree
 * about when a boat is under way.
 */
export function setSeaWake(
  sea: SeaSurface,
  x: number,
  z: number,
  headingX: number,
  headingZ: number,
  speed: number,
) {
  const wake = sea.userData.waterWake as WaterWake | undefined
  if (!wake) return
  const length = Math.hypot(headingX, headingZ)
  if (length > 1e-4) wake.uWakeDirection.value.set(headingX / length, headingZ / length)
  wake.uWake.value.set(x, z, THREE.MathUtils.clamp((speed - .12) / .85, 0, 1))
}

export type RiverOptions = {
  /** Kerb-to-kerb width at the widest point, in world units. */
  width: number
  color?: number
  /**
   * Fraction of the width the channel narrows by along its length, as a
   * meander: 0 is a built canal of constant section, .3 a natural river.
   */
  taper?: number
  /** How fast the surface pattern travels downstream, in world units/second. */
  flow?: number
  /** Vertical scale of the ripple. Rivers are not swell. */
  amplitude?: number
  /** Samples along the curve. Costs two triangles per column per sample. */
  segments?: number
  /** Height of the water surface. */
  y?: number
}

export type RiverSurface = THREE.Mesh

/** How much of each edge of the channel is shaded and damped as bank. */
const BANK_FRACTION = .22

/**
 * Ribbon geometry in river space.
 *
 * Carries two things the shared `ribbonGeometry` does not, and cannot be given
 * without changing every road in the district: a *world-unit* coordinate along
 * and across the channel, so flow speed and ripple scale are physical rather
 * than a function of how long the river happens to be; and the channel's own
 * frame per vertex, so the shader can build a world-space normal out of a
 * gradient it computed in ribbon space.
 */
function riverGeometry(curve: THREE.Curve<THREE.Vector3>, options: RiverOptions) {
  const segments = options.segments ?? 132
  const columns = 5
  const taper = options.taper ?? 0
  const positions: number[] = []
  const uvs: number[] = []
  const across: number[] = []
  const along: number[] = []
  const span: number[] = []
  const indices: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3()
  let travelled = 0
  let previous: THREE.Vector3 | null = null
  for (let step = 0; step <= segments; step += 1) {
    const t = step / segments
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(Math.min(.9995, t)).normalize()
    side.crossVectors(up, tangent).normalize()
    if (previous) travelled += point.distanceTo(previous)
    previous = point.clone()
    // A meander in section: two out-of-phase waves so the narrowings do not
    // land at a regular pitch, and never below half the nominal width.
    const wobble = taper > 0
      ? 1 - taper * (.5 + .5 * Math.sin(t * Math.PI * 3.7 + 1.1)) * (.7 + .3 * Math.sin(t * Math.PI * 8.3))
      : 1
    const half = options.width / 2 * wobble
    for (let column = 0; column < columns; column += 1) {
      const u = column / (columns - 1)
      const lateral = (u - .5) * 2 * half
      positions.push(point.x + side.x * lateral, options.y ?? point.y, point.z + side.z * lateral)
      uvs.push(u, t)
      across.push(side.x, side.z)
      along.push(tangent.x, tangent.z)
      span.push(lateral, travelled)
    }
    if (step < segments) {
      const base = step * columns
      for (let column = 0; column < columns - 1; column += 1) {
        const a = base + column
        indices.push(a, a + columns, a + 1, a + columns, a + columns + 1, a + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 2))
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 2))
  geometry.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A river, canal or brook: the sea's water in a channel, flowing.
 *
 * Opaque, unlike the strip it replaces. A .94-alpha surface meant every bridge
 * deck over the canal showed through the water it was crossing, and cost a
 * transparency sort for the privilege.
 */
export function createRiverSurface(curve: THREE.Curve<THREE.Vector3>, options: RiverOptions): RiverSurface {
  const color = options.color ?? 0x3f7f86
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(color).multiplyScalar(.66) },
    // A river shoals to silt rather than to open-sea turquoise.
    uShallow: { value: new THREE.Color(color).lerp(new THREE.Color(0x8f9c7e), .42) },
    uSky: { value: new THREE.Color(0xb9d3cf) },
    uSun: { value: new THREE.Color(0xf1d49a) },
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uFlow: { value: options.flow ?? .55 },
      uAmplitude: { value: options.amplitude ?? .055 },
      uBank: { value: BANK_FRACTION },
    },
    transparent: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime; uniform float uFlow; uniform float uAmplitude; uniform float uBank;
      attribute vec2 aAcross; attribute vec2 aAlong; attribute vec2 aSpan;
      varying float vHeight; varying float vBank; varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vSpan;
      ${noiseChunk(3)}
      // Height in channel space: p.x across in world units, p.y downstream in
      // world units. Everything is advected along +y by the flow, which is the
      // whole difference between this and open water.
      float riverHeight(vec2 p){
        float drift=uTime*uFlow;
        float travelling=fbm(vec2(p.x*1.35,(p.y-drift)*.62));
        float chop=fbm(vec2(p.x*3.6+drift*.22,(p.y-drift*1.9)*2.1));
        float wavelet=sin((p.y-drift*1.15)*2.1+p.x*.9)*.34;
        return travelling*.62+chop*.24+wavelet*.2;
      }
      void main(){
        // Damped to nothing at the water's edge, so the outline where the river
        // meets its bank is the geometry's and does not crawl.
        float bank=smoothstep(0.,uBank,min(uv.x,1.-uv.x));
        vBank=bank;
        vSpan=aSpan;
        float e=.22;
        float h=riverHeight(aSpan);
        float hu=riverHeight(aSpan+vec2(e,0.));
        float hv=riverHeight(aSpan+vec2(0.,e));
        float amplitude=uAmplitude*bank;
        vec3 p=position;
        p.y+=h*amplitude;
        vHeight=h;
        // N = up - (dh/dv)*along - (dh/du)*across, from the cross product of the
        // two surface tangents; the channel frame arrives per vertex so the
        // gradient computed in ribbon space lands in world space.
        vec3 across3=vec3(aAcross.x,0.,aAcross.y);
        vec3 along3=vec3(aAlong.x,0.,aAlong.y);
        float du=(hu-h)/e*amplitude;
        float dv=(hv-h)/e*amplitude;
        vNormalW=normalize(vec3(0.,1.,0.)-along3*dv-across3*du);
        vWorld=(modelMatrix*vec4(p,1.)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSun;
      uniform float uTime; uniform float uFlow;
      varying float vHeight; varying float vBank; varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vSpan;
      float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      ${SHADE_CHUNK}
      void main(){
        vec3 normal=normalize(vNormalW);
        // Broken water where the flow drags along the bank, travelling with it
        // rather than sitting still, plus a little on the crests mid-channel.
        float edge=1.-vBank;
        float scud=hash21(floor(vec2(vSpan.x*7.,(vSpan.y-uTime*uFlow)*7.)));
        float bankFoam=smoothstep(.45,1.,edge)*(.45+scud*.55);
        float crestFoam=smoothstep(.14,.32,vHeight)*vBank*.5;
        vec3 water=shadeWater(
          normal,vWorld,vHeight,clamp(bankFoam+crestFoam,0.,1.),
          smoothstep(0.,.75,vBank),uDeep,uShallow,uSky,uSun
        );
        gl_FragColor=vec4(water,1.);
      }`,
  })
  const river = new THREE.Mesh(riverGeometry(curve, options), material)
  river.receiveShadow = true
  river.userData.waterUniforms = uniforms
  return river
}

/**
 * The bed a river sits in.
 *
 * Water laid straight onto the ground is what made The Circuit's river read as
 * a ribbon dropped on a lawn: there was no channel, so nothing said the water
 * was *in* anything. This is a slightly wider, slightly lower skirt of bank
 * material under the surface, so the eye is given a shore before it is given
 * water. Built from the same curve and the same taper, so the two cannot drift
 * apart.
 */
export function createRiverBed(curve: THREE.Curve<THREE.Vector3>, options: RiverOptions, color = 0x6f6a58) {
  const bed = new THREE.Mesh(
    riverGeometry(curve, {
      ...options,
      width: options.width + Math.max(.34, options.width * .3),
      y: (options.y ?? .045) - .035,
      segments: Math.max(24, Math.round((options.segments ?? 132) * .5)),
    }),
    new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }),
  )
  bed.receiveShadow = true
  bed.castShadow = false
  return bed
}
