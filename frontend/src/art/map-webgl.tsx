import { useEffect, useRef } from 'react'

import type { TerrainSection } from './terrains'

type MapView = { x: number; y: number; w: number; h: number }

const MODE: Record<TerrainSection, number> = { city: 0, nation: 1, world: 2, continent: 3, space: 4 }

const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * .5 + .5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

/* A restrained atmospheric substrate for the civic atlas. It keeps terrain,
   moisture, cloud shadow and night light stable in world coordinates while
   the SVG layer carries the surveyed streets and architecture. */
const fragmentSource = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform vec2 u_pointer;
  uniform vec4 u_view;
  uniform vec2 u_world;
  uniform float u_time;
  uniform float u_mode;
  uniform float u_atlas;
  uniform float u_activity;
  uniform float u_has_texture;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.,0.)), f.x), mix(hash(i + vec2(0.,1.)), hash(i + vec2(1.,1.)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0; float amplitude = .5;
    for (int i = 0; i < 4; i++) { value += amplitude * noise(p); p = p * 2.04 + 19.2; amplitude *= .5; }
    return value;
  }
  float softRect(vec2 p, vec2 a, vec2 b, float feather) {
    vec2 lo = smoothstep(a - feather, a + feather, p);
    vec2 hi = 1.0 - smoothstep(b - feather, b + feather, p);
    return lo.x * lo.y * hi.x * hi.y;
  }

  void main() {
    vec2 worldUv = vec2(
      (u_view.x + v_uv.x * u_view.z) / u_world.x,
      1.0 - (u_view.y + (1.0 - v_uv.y) * u_view.w) / u_world.y
    );
    worldUv = clamp(worldUv, .001, .999);
    vec2 pointer = u_pointer - .5;
    float flow = fbm(worldUv * 13.0 + vec2(u_time * .022, -u_time * .017));
    float micro = fbm(worldUv * 44.0 - u_time * .042);
    vec2 refract = vec2(flow - .5, micro - .5) * .0014;
    refract += pointer * .0008;

    vec4 source = vec4(0.0);
    if (u_has_texture > .5) {
      vec3 base = texture2D(u_texture, clamp(worldUv + refract, .001, .999)).rgb;
      vec3 red = texture2D(u_texture, clamp(worldUv + refract * 1.7 + vec2(.0008,0.), .001, .999)).rgb;
      vec3 blue = texture2D(u_texture, clamp(worldUv + refract * .6 - vec2(.0008,0.), .001, .999)).rgb;
      base.r = red.r; base.b = blue.b;
      source = vec4(base, 1.0);
    }

    float effectiveMode = u_atlas > .5 ? floor(clamp(worldUv.x, 0.0, .9999) * 5.0) : u_mode;
    float city = 1.0 - step(.5, abs(effectiveMode - 0.0));
    float nation = 1.0 - step(.5, abs(effectiveMode - 1.0));
    float ocean = 1.0 - step(.5, abs(effectiveMode - 2.0));
    float continent = 1.0 - step(.5, abs(effectiveMode - 3.0));
    float space = 1.0 - step(.5, abs(effectiveMode - 4.0));
    float time = u_time;

    /* When no raster source is supplied, WebGL becomes the district's actual
       atmospheric substrate: elevation, wet pavement, water and civic light
       are generated in world coordinates and remain stable under pan/zoom. */
    if (u_has_texture < .5) {
      vec3 cityBase = mix(vec3(.045,.060,.063), vec3(.095,.105,.102), worldUv.y);
      vec3 nationBase = mix(vec3(.055,.078,.066), vec3(.105,.110,.082), worldUv.y);
      vec3 oceanBase = mix(vec3(.026,.080,.092), vec3(.055,.135,.142), worldUv.y);
      vec3 continentBase = mix(vec3(.072,.076,.065), vec3(.125,.108,.076), worldUv.y);
      vec3 globalBase = mix(vec3(.038,.058,.064), vec3(.082,.098,.102), worldUv.y);
      vec3 procedural = cityBase * city + nationBase * nation + oceanBase * ocean + continentBase * continent + globalBase * space;
      float elevation = fbm(worldUv * vec2(u_atlas > .5 ? 27.5 : 5.5, 8.0) + vec2(effectiveMode * 7.1, 0.0));
      float contour = smoothstep(.48,.52,abs(fract(elevation * 8.0)-.5));
      procedural *= .86 + elevation * .19;
      procedural += vec3(.11,.10,.075) * contour * .035;
      float pointerLight = smoothstep(.38, 0.0, distance(v_uv, u_pointer)) * .018;
      procedural += vec3(.18,.17,.14) * pointerLight;
      source = vec4(procedural, 1.0);
    }

    float grain = hash(gl_FragCoord.xy + fract(time) * 91.0) - .5;
    vec3 effects = vec3(0.0);
    float alpha = source.a;

    /* Rain looks like shallow refraction rather than a UI overlay. */
    float rainLane = fract(worldUv.x * 118.0 + floor(worldUv.y * 10.0) * .71);
    float rain = smoothstep(.985, 1.0, rainLane) * smoothstep(.18, .02, abs(fract(worldUv.y * 7.0 - time * .34) - .5));
    effects += vec3(.15,.23,.25) * rain * (city + nation * .45) * .10;

    /* The ocean and global district receive evolving caustics and a slow
       specular lane; continent gets warmer atmospheric drift instead. */
    float waveA = sin(worldUv.x * 94.0 + time * 1.3 + flow * 8.0);
    float waveB = sin(worldUv.y * 71.0 - time * .9 + micro * 6.0);
    float caustic = smoothstep(.87, 1.42, waveA + waveB);
    effects += vec3(.10,.25,.25) * caustic * ocean * .09;
    float heat = smoothstep(.60,.94,fbm(worldUv * 8.0 + vec2(time*.018,0.)));
    effects += vec3(.20,.15,.08) * heat * continent * .035;

    /* Stable building-grid luminance adds depth without drawing random
       objects or pretending to be the street network. */
    vec2 block = floor(worldUv * vec2(180.0, 92.0));
    float lampSeed = hash(block);
    float lamp = step(.992, lampSeed) * (.72 + .10 * sin(time * .22 + lampSeed * 6.28));
    effects += vec3(.30,.245,.14) * lamp * (city + space * .58) * (.22 + u_activity * .018);

    float cloudShadow = fbm(worldUv * vec2(8.0, 5.0) + vec2(time * .006, 0.0));
    source.rgb *= 1.0 - smoothstep(.60,.82,cloudShadow) * .035;

    float vignette = smoothstep(.94, .28, distance(v_uv, vec2(.5)));
    source.rgb = source.rgb * (.82 + vignette * .20) + effects;
    source.rgb += grain * .009;
    source.rgb = mix(source.rgb, source.rgb * vec3(.94,.98,.99), .11);
    gl_FragColor = vec4(source.rgb, alpha);
  }
`

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const value = gl.createShader(type)
  if (!value) return null
  gl.shaderSource(value, source)
  gl.compileShader(value)
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    gl.deleteShader(value)
    return null
  }
  return value
}

function program(gl: WebGLRenderingContext) {
  const vertex = shader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = shader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) return null
  const value = gl.createProgram()
  if (!value) return null
  gl.attachShader(value, vertex)
  gl.attachShader(value, fragment)
  gl.linkProgram(value)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(value, gl.LINK_STATUS)) {
    gl.deleteProgram(value)
    return null
  }
  return value
}

export function MapWebGLLayer({
  section,
  activity,
  src,
  atlas = false,
  view = { x: 0, y: 0, w: 1800, h: 900 },
  worldSize = { width: 1800, height: 900 },
}: {
  section: TerrainSection
  activity: number
  src?: string
  atlas?: boolean
  view?: MapView
  worldSize?: { width: number; height: number }
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'high-performance' })
    if (!gl) return
    const activeProgram = program(gl)
    if (!activeProgram) return
    const texture = gl.createTexture()
    const buffer = gl.createBuffer()
    if (!texture || !buffer) return

    gl.useProgram(activeProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(activeProgram, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    const resolution = gl.getUniformLocation(activeProgram, 'u_resolution')
    const pointerLocation = gl.getUniformLocation(activeProgram, 'u_pointer')
    const viewLocation = gl.getUniformLocation(activeProgram, 'u_view')
    const worldLocation = gl.getUniformLocation(activeProgram, 'u_world')
    const timeLocation = gl.getUniformLocation(activeProgram, 'u_time')
    const modeLocation = gl.getUniformLocation(activeProgram, 'u_mode')
    const atlasLocation = gl.getUniformLocation(activeProgram, 'u_atlas')
    const activityLocation = gl.getUniformLocation(activeProgram, 'u_activity')
    const hasTextureLocation = gl.getUniformLocation(activeProgram, 'u_has_texture')
    const pointer = { x: .5, y: .5 }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const image = new Image()
    let textureReady = false
    let frame = 0
    const startedAt = performance.now()

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(bounds.width * ratio))
      const height = Math.max(1, Math.round(bounds.height * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)
    }
    const surface = canvas.closest<HTMLElement>('[data-webgl-surface]') ?? canvas.closest<HTMLElement>('.av-terrain')
    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      pointer.x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)))
      pointer.y = Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / Math.max(1, bounds.height)))
    }
    const onPointerLeave = () => { pointer.x = .5; pointer.y = .5 }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    surface?.addEventListener('pointermove', onPointerMove)
    surface?.addEventListener('pointerleave', onPointerLeave)
    resize()

    const draw = (now: number) => {
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(resolution, canvas.width, canvas.height)
      gl.uniform2f(pointerLocation, pointer.x, pointer.y)
      gl.uniform4f(viewLocation, view.x, view.y, view.w, view.h)
      gl.uniform2f(worldLocation, worldSize.width, worldSize.height)
      gl.uniform1f(timeLocation, reducedMotion ? 0 : (now - startedAt) / 1000)
      gl.uniform1f(modeLocation, MODE[section])
      gl.uniform1f(atlasLocation, atlas ? 1 : 0)
      gl.uniform1f(activityLocation, activity)
      gl.uniform1f(hasTextureLocation, textureReady ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      if (!reducedMotion) frame = window.requestAnimationFrame(draw)
    }

    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      textureReady = true
      canvas.classList.add('is-ready')
    }
    if (src) image.src = src
    else canvas.classList.add('is-ready')
    draw(startedAt)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      surface?.removeEventListener('pointermove', onPointerMove)
      surface?.removeEventListener('pointerleave', onPointerLeave)
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(activeProgram)
    }
  }, [activity, atlas, section, src, view.h, view.w, view.x, view.y, worldSize.height, worldSize.width])

  return <canvas className="map-webgl-layer" ref={canvasRef} aria-hidden="true" />
}
