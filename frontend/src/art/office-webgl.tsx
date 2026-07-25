import { useEffect, useRef } from 'react'

const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() { v_uv = a_position * .5 + .5; gl_Position = vec4(a_position,0.,1.); }
`

/* Transparent, procedural atmosphere for the constructed office.  Nothing is
   rasterized here: rain highlights, reflected light and suspended dust are
   generated on the GPU over the architectural scene. */
const fragmentSource = `
  precision highp float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2 u_pointer;
  uniform float u_focus;

  float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y); }
  float softRect(vec2 p,vec2 a,vec2 b,float f) { vec2 lo=smoothstep(a-f,a+f,p), hi=1.-smoothstep(b-f,b+f,p); return lo.x*lo.y*hi.x*hi.y; }

  void main() {
    float time=u_time; vec2 p=u_pointer-.5;
    float window=softRect(v_uv,vec2(.19,.38),vec2(.405,.80),.018);
    float rainBand=fract(v_uv.x*96. + floor(v_uv.y*12.)*.37 + time*.07);
    float rain=window*smoothstep(.988,1.,rainBand)*smoothstep(.62,.03,fract(v_uv.y*9.-time*.48));
    float lamp=smoothstep(.34,.02,distance(v_uv,vec2(.715,.395)+p*.018));
    float floorLight=smoothstep(.42,.015,v_uv.y);
    float grain=hash(gl_FragCoord.xy+fract(time)*67.)-.5;
    float dust=step(.993,hash(floor(v_uv*vec2(96.,54.))+floor(time*.18)))*smoothstep(.16,.86,v_uv.y);
    vec3 color=vec3(0.0); float alpha=0.0;
    color += vec3(.36,.57,.66)*rain*.36; alpha += rain*.35;
    color += vec3(1.,.63,.22)*lamp*(.085+u_focus*.12); alpha += lamp*(.045+u_focus*.07);
    float reflection=(sin(v_uv.x*84.+time*1.4)+sin(v_uv.x*43.-time*.8))*0.5+.5;
    color += vec3(.25,.19,.11)*floorLight*reflection*.065; alpha += floorLight*reflection*.028;
    color += vec3(.93,.83,.62)*dust*.34; alpha += dust*.17;
    color += grain*.014; alpha += abs(grain)*.015;
    gl_FragColor=vec4(color,clamp(alpha,0.,.42));
  }
`

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source); gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null }
  return shader
}

function makeProgram(gl: WebGLRenderingContext) {
  const vertex=compile(gl,gl.VERTEX_SHADER,vertexSource), fragment=compile(gl,gl.FRAGMENT_SHADER,fragmentSource)
  if (!vertex || !fragment) return null
  const program=gl.createProgram(); if (!program) return null
  gl.attachShader(program,vertex); gl.attachShader(program,fragment); gl.linkProgram(program)
  gl.deleteShader(vertex); gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) { gl.deleteProgram(program); return null }
  return program
}

export function OfficeAtmosphereWebGL() {
  const canvasRef=useRef<HTMLCanvasElement|null>(null)
  useEffect(() => {
    const canvas=canvasRef.current
    if (!canvas) return
    const gl=canvas.getContext('webgl',{alpha:true,antialias:false,powerPreference:'low-power'})
    if (!gl) return
    const program=makeProgram(gl), buffer=gl.createBuffer()
    if (!program || !buffer) return
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER,buffer)
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW)
    const position=gl.getAttribLocation(program,'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0)
    const timeLocation=gl.getUniformLocation(program,'u_time'), pointerLocation=gl.getUniformLocation(program,'u_pointer'), focusLocation=gl.getUniformLocation(program,'u_focus')
    const pointer={x:.5,y:.5}; const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame=0; const startedAt=performance.now()
    const resize=()=>{const box=canvas.getBoundingClientRect(),ratio=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,Math.round(box.width*ratio)),h=Math.max(1,Math.round(box.height*ratio)); if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h};gl.viewport(0,0,w,h)}
    const office=canvas.closest<HTMLElement>('.av-office')
    const move=(event:PointerEvent)=>{const box=canvas.getBoundingClientRect();pointer.x=Math.max(0,Math.min(1,(event.clientX-box.left)/Math.max(1,box.width)));pointer.y=Math.max(0,Math.min(1,1-(event.clientY-box.top)/Math.max(1,box.height)))}
    const leave=()=>{pointer.x=.5;pointer.y=.5}
    const observer=new ResizeObserver(resize);observer.observe(canvas);office?.addEventListener('pointermove',move);office?.addEventListener('pointerleave',leave);resize()
    const draw=(now:number)=>{gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(timeLocation,reduced?0:(now-startedAt)/1000);gl.uniform2f(pointerLocation,pointer.x,pointer.y);gl.uniform1f(focusLocation,office?.classList.contains('room-focus')?1:0);gl.drawArrays(gl.TRIANGLES,0,6);if(!reduced)frame=window.requestAnimationFrame(draw)}
    draw(startedAt)
    return ()=>{if(frame)window.cancelAnimationFrame(frame);observer.disconnect();office?.removeEventListener('pointermove',move);office?.removeEventListener('pointerleave',leave);gl.deleteBuffer(buffer);gl.deleteProgram(program)}
  },[])
  return <canvas className="office-atmosphere-webgl" ref={canvasRef} aria-hidden="true" />
}
