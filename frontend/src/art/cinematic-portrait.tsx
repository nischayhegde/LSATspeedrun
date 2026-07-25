import { useEffect, useRef } from 'react'

const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * .5 + .5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

/* This is a shallow portrait renderer, not a CSS filter: it treats the
   player art as a lit surface with camera response, film grain and a moving
   key light. The fallback image remains available when WebGL is unavailable. */
const fragmentSource = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform vec2 u_pointer;
  uniform float u_time;
  uniform float u_image_aspect;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 coverUv(vec2 uv) {
    float screen = u_resolution.x / max(1.0, u_resolution.y);
    if (screen > u_image_aspect) uv.x = (uv.x - .5) * screen / u_image_aspect + .5;
    else uv.y = (uv.y - .5) * u_image_aspect / screen + .5;
    return uv;
  }

  void main() {
    vec2 uv = coverUv(v_uv);
    if (uv.x < .001 || uv.x > .999 || uv.y < .001 || uv.y > .999) { gl_FragColor = vec4(0.0); return; }
    vec2 pointer = u_pointer - .5;
    vec4 initialSample = texture2D(u_texture, uv);
    vec3 initial = initialSample.rgb;
    float luma = dot(initial, vec3(.299,.587,.114));
    float portraitDepth = smoothstep(.08,.82,luma) * .72 + smoothstep(.70,.1,length(uv - vec2(.5,.57))) * .28;
    vec2 camera = pointer * (.003 + portraitDepth * .014);
    float breathing = sin(u_time * .72 + uv.y * 9.0) * .00075;
    vec4 sampled = texture2D(u_texture, clamp(uv + camera + vec2(breathing,0.), .001,.999));
    vec3 color = sampled.rgb;
    vec3 red = texture2D(u_texture, clamp(uv + camera * 1.18 + vec2(.00075,0.), .001,.999)).rgb;
    vec3 blue = texture2D(u_texture, clamp(uv + camera * .84 - vec2(.00075,0.), .001,.999)).rgb;
    color.r = red.r; color.b = blue.b;

    float key = smoothstep(.95,.12,length(uv - vec2(.29 + pointer.x*.08,.25 - pointer.y*.04)));
    float rim = smoothstep(.76,.28,abs(uv.x-.72)) * smoothstep(.12,.74,uv.y);
    float grain = hash(gl_FragCoord.xy + fract(u_time)*83.0) - .5;
    color += vec3(.11,.082,.04) * key * (.26 + portraitDepth*.16);
    color += vec3(.035,.075,.085) * rim * .13;
    color += grain * .022;
    float vignette = smoothstep(.91,.32,length(v_uv - vec2(.5)));
    color *= .78 + vignette*.22;
    color = mix(color, color * vec3(.94,.99,1.04), .12);
    gl_FragColor = vec4(color, sampled.a);
  }
`

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null }
  return shader
}

function createProgram(gl: WebGLRenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null }
  return program
}

export function CinematicPortrait({ src, alt = '' }: { src: string; alt?: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'high-performance' })
    if (!gl) return
    const activeProgram = createProgram(gl)
    const texture = gl.createTexture()
    const buffer = gl.createBuffer()
    if (!activeProgram || !texture || !buffer) return
    gl.useProgram(activeProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
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
    const timeLocation = gl.getUniformLocation(activeProgram, 'u_time')
    const aspectLocation = gl.getUniformLocation(activeProgram, 'u_image_aspect')
    const pointer = { x: .5, y: .5 }
    const image = new Image()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let ready = false
    let frame = 0
    const startedAt = performance.now()

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(bounds.width * ratio))
      const height = Math.max(1, Math.round(bounds.height * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      gl.viewport(0,0,width,height)
    }
    const onMove = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect()
      pointer.x = Math.max(0,Math.min(1,(event.clientX-bounds.left)/Math.max(1,bounds.width)))
      pointer.y = Math.max(0,Math.min(1,1-(event.clientY-bounds.top)/Math.max(1,bounds.height)))
    }
    const onLeave = () => { pointer.x=.5; pointer.y=.5 }
    const observer = new ResizeObserver(resize)
    observer.observe(root)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', onLeave)
    resize()
    const draw = (now: number) => {
      if (!ready) return
      gl.clearColor(0,0,0,0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(resolution,canvas.width,canvas.height)
      gl.uniform2f(pointerLocation,pointer.x,pointer.y)
      gl.uniform1f(timeLocation,reducedMotion ? 0 : (now-startedAt)/1000)
      gl.uniform1f(aspectLocation,image.naturalWidth/Math.max(1,image.naturalHeight))
      gl.drawArrays(gl.TRIANGLES,0,6)
      if (!reducedMotion) frame=window.requestAnimationFrame(draw)
    }
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D,texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1)
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image)
      ready=true
      canvas.classList.add('is-ready')
      draw(performance.now())
    }
    image.src=src

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      root.removeEventListener('pointermove',onMove)
      root.removeEventListener('pointerleave',onLeave)
      gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(activeProgram)
    }
  }, [src])

  return <div className="cinematic-portrait" ref={rootRef}><img src={src} alt={alt} draggable={false} /><canvas ref={canvasRef} aria-hidden="true" /><i aria-hidden="true" /></div>
}
