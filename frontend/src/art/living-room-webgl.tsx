import { useEffect, useRef } from 'react'

const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * .5 + .5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const fragmentSource = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform vec2 u_pointer;
  uniform float u_time;
  uniform float u_image_aspect;
  uniform float u_weather;

  vec2 coverUv(vec2 uv) {
    float screenAspect = u_resolution.x / max(1.0, u_resolution.y);
    if (screenAspect > u_image_aspect) {
      uv.y = (uv.y - .5) * screenAspect / u_image_aspect + .5;
    } else {
      uv.x = (uv.x - .5) * u_image_aspect / screenAspect + .5;
    }
    return uv;
  }

  float softRect(vec2 point, vec2 minPoint, vec2 maxPoint, float feather) {
    vec2 lower = smoothstep(minPoint - feather, minPoint + feather, point);
    vec2 upper = 1.0 - smoothstep(maxPoint - feather, maxPoint + feather, point);
    return lower.x * lower.y * upper.x * upper.y;
  }

  void main() {
    vec2 uv = coverUv(v_uv);
    vec2 pointer = u_pointer - .5;
    float distanceFromCenter = length(v_uv - .5);
    float depth = smoothstep(1.05, .08, distanceFromCenter);
    vec2 camera = pointer * (.012 + depth * .022);
    vec2 livingShift = vec2(
      sin(uv.y * 9.0 + u_time * .22) * .0022,
      cos(uv.x * 7.0 + u_time * .17) * .0014
    );
    vec4 color = texture2D(u_texture, clamp(uv + camera * .68 + livingShift, .001, .999));

    /* The starter office gets shallow, image-based depth: the rain window
       shifts a little more than the wall, while the lamp and desk settle
       closer to the viewer. This stays gentle enough to preserve the art. */
    float windowMask = softRect(uv, vec2(.20, .27), vec2(.39, .66), .055);
    float deskMask = softRect(uv, vec2(.46, .43), vec2(.79, .84), .09);
    vec4 windowLayer = texture2D(u_texture, clamp(uv + camera * 1.28 + livingShift * 1.35, .001, .999));
    vec4 deskLayer = texture2D(u_texture, clamp(uv + camera * .35 + livingShift * .55, .001, .999));
    color = mix(color, windowLayer, windowMask * .64);
    color = mix(color, deskLayer, deskMask * .28);

    float lampPulse = .5 + .5 * sin(u_time * .72 + uv.x * 2.7);
    float lampField = smoothstep(.78, .15, distance(uv, vec2(.72, .62)));
    color.rgb += vec3(.11, .075, .025) * lampField * (.22 + lampPulse * .16);

    float windowField = smoothstep(.58, .05, distance(uv, vec2(.18, .48)));
    color.rgb += vec3(.025, .055, .07) * windowField * (.22 + .18 * sin(u_time * .43));

    if (u_weather > .5) {
      float rain = fract(sin(dot(floor((uv + vec2(u_time * .006, -u_time * .10)) * vec2(74.0, 39.0)), vec2(12.9898,78.233))) * 43758.5453);
      float streak = smoothstep(.985, 1.0, rain) * smoothstep(.94, .76, fract(uv.y * 15.0 - u_time * .42));
      color.rgb += vec3(.10, .16, .19) * streak * .25;
    }

    float vignette = smoothstep(.92, .30, distance(v_uv, vec2(.5)));
    color.rgb *= .82 + vignette * .18;
    gl_FragColor = color;
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

/** Renders the existing painted room as a subtly responsive WebGL surface.
    The original <img> remains below it as a resilient fallback. */
export function LivingRoomWebGL({ src, tier }: { src: string; tier: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' })
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
    const time = gl.getUniformLocation(activeProgram, 'u_time')
    const imageAspect = gl.getUniformLocation(activeProgram, 'u_image_aspect')
    const weather = gl.getUniformLocation(activeProgram, 'u_weather')
    const pointer = { x: .5, y: .5 }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const image = new Image()
    let imageReady = false
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

    const draw = (now: number) => {
      if (!imageReady) return
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(resolution, canvas.width, canvas.height)
      gl.uniform2f(pointerLocation, pointer.x, pointer.y)
      gl.uniform1f(time, (now - startedAt) / 1000)
      gl.uniform1f(imageAspect, image.naturalWidth / Math.max(1, image.naturalHeight))
      gl.uniform1f(weather, tier < 2 ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      if (!reducedMotion) frame = window.requestAnimationFrame(draw)
    }

    const surface = canvas.closest<HTMLElement>('.av-office') ?? canvas.closest<HTMLElement>('.av-room')
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

    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      imageReady = true
      canvas.classList.add('is-ready')
      draw(performance.now())
    }
    image.src = src

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      surface?.removeEventListener('pointermove', onPointerMove)
      surface?.removeEventListener('pointerleave', onPointerLeave)
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(activeProgram)
    }
  }, [src, tier])

  return <canvas className="av-room-webgl" ref={canvasRef} aria-hidden="true" />
}
