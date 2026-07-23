import { useEffect, useRef } from 'react'

export type PixelWebGLVariant = 'office' | 'scene' | 'map'

function rgb(hex: string) {
  const value = hex.replace('#', '')
  const normalized = value.length === 3 ? value.split('').map((part) => part + part).join('') : value
  const integer = Number.parseInt(normalized, 16)
  return [((integer >> 16) & 255) / 255, ((integer >> 8) & 255) / 255, (integer & 255) / 255]
}

export function PixelWebGLAtmosphere({
  accent = '#65c9c2',
  className = '',
  variant = 'scene',
  intensity = 1,
}: {
  accent?: string
  className?: string
  variant?: PixelWebGLVariant
  intensity?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
    })
    if (!gl) {
      canvas.dataset.fallback = 'true'
      return
    }
    const vertexSource = `
      attribute vec2 position;
      varying vec2 uv;
      void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
    `
    const fragmentSource = `
      precision mediump float;
      varying vec2 uv;
      uniform float time;
      uniform vec3 accent;
      uniform vec2 pointer;
      uniform vec2 resolution;
      uniform float variant;
      uniform float intensity;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(mix(hash(i), hash(i + vec2(1.,0.)), f.x), mix(hash(i + vec2(0.,1.)), hash(i + vec2(1.,1.)), f.x), f.y);
      }
      void main() {
        vec2 pixelScale = max(vec2(96.,54.), resolution / 5.);
        vec2 p = floor((uv + (pointer - .5) * .012) * pixelScale) / pixelScale;
        float horizon = smoothstep(.16, .82, p.y);
        vec2 perspective = vec2((p.x - .5) / max(.17, p.y), 1. / max(.17, p.y));
        float gridX = step(.965, fract(perspective.x * 5.));
        float gridY = step(.972, fract(perspective.y * 1.7 - time * .08));
        float grid = (gridX + gridY) * horizon;
        float glint = step(.994, hash(floor(p * vec2(80.,45.)) + floor(time * .7)));
        float sweep = smoothstep(.045, 0., abs(fract(p.x * .42 + p.y * .2 + time * .035) - .5));
        float contourNoise = noise(p * 8. + vec2(time * .018, 0.));
        float contour = step(.91, fract(contourNoise * 8. + p.y * 7.));
        float cityPulse = smoothstep(.04, 0., abs(fract((p.x + p.y * .55) * 3. - time * .045) - .5));
        float shaft = smoothstep(.19, 0., abs(p.x - mix(.2,.8, pointer.x) + (p.y - .5) * .18));
        float mapMask = step(1.5, variant);
        float officeMask = 1. - step(.5, variant);
        float sceneMask = step(.5, variant) * (1. - mapMask);
        float mapFx = (contour * .11 + cityPulse * .1) * mapMask;
        float roomFx = (shaft * .09 + grid * .1) * (officeMask + sceneMask);
        float vignette = smoothstep(.76, .2, distance(p, vec2(.5)));
        vec3 color = accent * (grid * .3 + glint * .8 + sweep * .13 + mapFx + roomFx);
        color += accent * mapMask * noise(p * 14. + time * .025) * .025;
        float alpha = min(.42, (grid * .12 + glint * .25 + sweep * .065 + mapFx + roomFx) * intensity) * vignette;
        gl_FragColor = vec4(color, alpha);
      }
    `
    const shader = (kind: number, source: string) => {
      const item = gl.createShader(kind)
      if (!item) return null
      gl.shaderSource(item, source)
      gl.compileShader(item)
      if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) { gl.deleteShader(item); return null }
      return item
    }
    const vertex = shader(gl.VERTEX_SHADER, vertexSource)
    const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource)
    if (!vertex || !fragment) return
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW)
    gl.useProgram(program)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const timeLocation = gl.getUniformLocation(program, 'time')
    const accentLocation = gl.getUniformLocation(program, 'accent')
    const pointerLocation = gl.getUniformLocation(program, 'pointer')
    const resolutionLocation = gl.getUniformLocation(program, 'resolution')
    const variantLocation = gl.getUniformLocation(program, 'variant')
    const intensityLocation = gl.getUniformLocation(program, 'intensity')
    gl.uniform3fv(accentLocation, rgb(accent))
    gl.uniform1f(variantLocation, variant === 'office' ? 0 : variant === 'scene' ? 1 : 2)
    gl.uniform1f(intensityLocation, Math.max(.25, Math.min(1.8, intensity)))
    const pointer = { x: .5, y: .5 }
    const pointerTarget = { x: .5, y: .5 }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduced = motion.matches
    let frame = 0
    let start = performance.now()
    let visible = true
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.max(240, Math.round(canvas.clientWidth * ratio / 2))
      const height = Math.max(135, Math.round(canvas.clientHeight * ratio / 2))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      gl.viewport(0, 0, width, height)
      gl.uniform2f(resolutionLocation, width, height)
    }
    const draw = (now: number) => {
      pointer.x += (pointerTarget.x - pointer.x) * .07
      pointer.y += (pointerTarget.y - pointer.y) * .07
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(timeLocation, (now - start) / 1000)
      gl.uniform2f(pointerLocation, pointer.x, pointer.y)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      if (!reduced && visible) frame = window.requestAnimationFrame(draw)
    }
    const move = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      pointerTarget.x = (event.clientX - bounds.left) / bounds.width
      pointerTarget.y = 1 - (event.clientY - bounds.top) / bounds.height
    }
    const parent = canvas.parentElement
    parent?.addEventListener('pointermove', move, { passive: true })
    resize()
    draw(start)
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      const nextVisible = entry.isIntersecting
      if (nextVisible && !visible && !reduced) {
        visible = true
        start = performance.now() - Math.min(120000, performance.now() - start)
        frame = window.requestAnimationFrame(draw)
      } else if (!nextVisible) {
        visible = false
        if (frame) window.cancelAnimationFrame(frame)
      }
    }, { threshold: .02 })
    visibilityObserver.observe(canvas)
    const motionChanged = () => {
      reduced = motion.matches
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      if (visible) {
        if (reduced) draw(performance.now())
        else frame = window.requestAnimationFrame(draw)
      }
    }
    motion.addEventListener('change', motionChanged)
    return () => {
      observer.disconnect()
      visibilityObserver.disconnect()
      motion.removeEventListener('change', motionChanged)
      parent?.removeEventListener('pointermove', move)
      if (frame) window.cancelAnimationFrame(frame)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }
  }, [accent, intensity, variant])

  return <canvas ref={canvasRef} className={`pixel-webgl-atmosphere ${className}`} aria-hidden="true" />
}

export function CasePageTurn({ turnKey, direction = 1 }: { turnKey: number; direction?: 1 | -1 }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: false, powerPreference: 'low-power' })
    if (!gl) { canvas.dataset.fallback = 'true'; return }
    const vertexSource = `
      attribute vec2 position;
      varying vec2 uv;
      void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
    `
    const fragmentSource = `
      precision mediump float;
      varying vec2 uv;
      uniform float progress;
      uniform float direction;
      uniform vec2 resolution;
      void main() {
        float phase = progress < .5 ? progress * 2. : (1. - progress) * 2.;
        float x = direction > 0. ? uv.x : 1. - uv.x;
        float edge = mix(1.08, -.08, smoothstep(0., 1., phase));
        float paper = smoothstep(edge - .015, edge + .015, x);
        float curl = 1. - smoothstep(0., .18, abs(x - edge));
        float fold = 1. - smoothstep(0., .055, abs(x - edge));
        float ruled = step(.965, fract(uv.y * max(18., resolution.y / 26.)));
        float fibers = step(.985, fract((uv.x + uv.y * .37) * max(25., resolution.x / 24.)));
        vec3 parchment = mix(vec3(.94,.87,.67), vec3(.58,.43,.25), curl * .62);
        parchment += ruled * vec3(.035,.055,.06) + fibers * vec3(.04,.025,.01);
        parchment = mix(parchment, vec3(.23,.78,.72), fold * .2);
        float shadow = (1. - smoothstep(0., .24, edge - x)) * (1. - paper) * .34;
        float alpha = min(1., paper * .98 + curl * .52 + shadow);
        gl_FragColor = vec4(parchment * (1. - shadow * .65), alpha);
      }
    `
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null }
      return shader
    }
    const vertex = compile(gl.VERTEX_SHADER, vertexSource)
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
    if (!vertex || !fragment) { canvas.dataset.fallback = 'true'; return }
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { canvas.dataset.fallback = 'true'; return }
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
    gl.useProgram(program)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const progressLocation = gl.getUniformLocation(program, 'progress')
    const directionLocation = gl.getUniformLocation(program, 'direction')
    const resolutionLocation = gl.getUniformLocation(program, 'resolution')
    gl.uniform1f(directionLocation, direction)
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.max(240, Math.round(canvas.clientWidth * ratio))
      const height = Math.max(180, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      gl.viewport(0, 0, width, height)
      gl.uniform2f(resolutionLocation, width, height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const started = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const progress = Math.min(1, (now - started) / 620)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(progressLocation, progress)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      if (progress < 1) frame = window.requestAnimationFrame(draw)
    }
    frame = window.requestAnimationFrame(draw)
    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }
  }, [direction, turnKey])

  return <canvas ref={canvasRef} className="case-page-turn-webgl" aria-hidden="true" />
}
