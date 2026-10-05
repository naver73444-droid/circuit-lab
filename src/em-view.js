import { add3, cross3, norm3, scale3, sub3, unit3 } from './em-physics.js';
import { screenRay } from './em-playground-interaction.js';

const vertexShader = `attribute vec3 a_position; attribute vec3 a_color; uniform mat4 u_matrix; varying vec3 v_color; void main(){ gl_Position=u_matrix*vec4(a_position,1.0); v_color=a_color; gl_PointSize=7.0; }`;
const fragmentShader = `precision mediump float; varying vec3 v_color; void main(){ gl_FragColor=vec4(v_color,1.0); }`;

function shader(gl, type, source) {
  const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(value); gl.deleteShader(value); throw new Error(message); }
  return value;
}

function multiply(a, b) {
  const out = Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function perspective(aspect) {
  const f = 1 / Math.tan(Math.PI / 8), near = .05, far = 100;
  return [f / aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0];
}

function lookAt(camera) {
  const eye = [camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw), camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw), camera.distance * Math.sin(camera.pitch)];
  const z = scale3(eye, 1 / norm3(eye)), x0 = [-z[1], z[0], 0], xn = norm3(x0) || 1, x = scale3(x0, 1 / xn);
  const y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -x[0]*eye[0]-x[1]*eye[1]-x[2]*eye[2], -y[0]*eye[0]-y[1]*eye[1]-y[2]*eye[2], -z[0]*eye[0]-z[1]*eye[1]-z[2]*eye[2],1];
}

const pushSegment = (data, a, b, color) => { data.push(...a, ...color, ...b, ...color); };

export function waveDisplayGeometry(scene, timeCycles, count = 48) {
  if (scene.amplitude === 0) return [];
  const k = unit3(scene.direction), e = unit3(scene.polarization), b = unit3(cross3(k, e)), segments = [];
  for (let i = 0; i < count; i++) {
    const u = -2 + 4 * i / (count - 1), base = scale3(k, u);
    const oscillation = Math.cos(2 * Math.PI * u - 2 * Math.PI * timeCycles + scene.phase);
    segments.push({ base, electric: add3(base, scale3(e, .35 * oscillation)), magnetic: add3(base, scale3(b, .35 * oscillation)) });
  }
  return segments;
}

export class EMView {
  constructor(canvas, message) {
    this.canvas = canvas; this.message = message; this.disposed = false; this.pointers = new Map(); this.cameraListener = null; this.interactionListener = null; this.camera = null;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
    if (!gl) { message.textContent = 'WebGL을 만들 수 없습니다. 브라우저 그래픽 가속을 확인한 뒤 다시 여세요. 수치 결과만 사용할 수 있습니다.'; this.gl = null; return; }
    this.gl = gl;
    try {
      const vs = shader(gl, gl.VERTEX_SHADER, vertexShader), fs = shader(gl, gl.FRAGMENT_SHADER, fragmentShader);
      const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.program = program; this.vs = vs; this.fs = fs; this.buffer = gl.createBuffer();
      this.position = gl.getAttribLocation(program, 'a_position'); this.color = gl.getAttribLocation(program, 'a_color'); this.matrix = gl.getUniformLocation(program, 'u_matrix');
      message.textContent = 'native WebGL · 실제 xyz 깊이 투영 · 화면 화살표 길이는 물리 크기와 독립 정규화';
      canvas.addEventListener('webglcontextlost', this.onLost = event => { event.preventDefault(); message.textContent = 'WebGL 컨텍스트가 손실되었습니다. 페이지를 다시 열어 재시도하세요. 수치 결과는 보존됩니다.'; });
      this.installInput();
    } catch (error) { message.textContent = `WebGL 초기화 실패: ${error.message}`; this.dispose(); }
  }

  installInput() {
    const canvas = this.canvas;
    this.down = event => { if (event.button !== 0 && event.pointerType !== 'touch') return;event.preventDefault();const existing=[...this.pointers.values()],hadInteraction=existing.some(pointer=>pointer.interaction);if(hadInteraction){this.interactionListener?.up?.({type:'pointercancel'},true,null);for(const [id,pointer] of this.pointers)this.pointers.set(id,{...pointer,interaction:false});}const ray=screenRay(canvas.getBoundingClientRect(),event.clientX,event.clientY,this.camera);const interaction=this.pointers.size===0&&Boolean(this.interactionListener?.down?.(event,ray));canvas.setPointerCapture?.(event.pointerId);this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,interaction}); };
    this.move = event => {
      const old = this.pointers.get(event.pointerId); if (!old) return;
      if(old.interaction){const ray=screenRay(canvas.getBoundingClientRect(),event.clientX,event.clientY,this.camera);this.interactionListener?.move?.(event,ray);this.pointers.set(event.pointerId,{...old,x:event.clientX,y:event.clientY});return;}
      const all = [...this.pointers.values()];
      if (this.pointers.size === 1) this.cameraListener?.({ yaw: (event.clientX-old.x)*.009, pitch: -(event.clientY-old.y)*.009, zoom: 0 });
      else if (this.pointers.size === 2) { const other = all.find(p => p !== old); const before = Math.hypot(old.x-other.x, old.y-other.y); const after = Math.hypot(event.clientX-other.x, event.clientY-other.y); this.cameraListener?.({ yaw: 0, pitch: 0, zoom: (before-after)*.012 }); }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    this.up = event => { const pointer=this.pointers.get(event.pointerId);if(!pointer)return;this.pointers.delete(event.pointerId);if(pointer.interaction){const ray=screenRay(canvas.getBoundingClientRect(),event.clientX??pointer.x,event.clientY??pointer.y,this.camera);this.interactionListener?.up?.(event,event.type!=='pointerup',ray);}try { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch {} };
    this.wheel = event => { event.preventDefault(); this.cameraListener?.({ yaw: 0, pitch: 0, zoom: Math.sign(event.deltaY)*.45 }); };
    canvas.addEventListener('pointerdown', this.down); canvas.addEventListener('pointermove', this.move); canvas.addEventListener('pointerup', this.up); canvas.addEventListener('pointercancel', this.up); canvas.addEventListener('lostpointercapture', this.up); canvas.addEventListener('wheel', this.wheel, { passive: false });
  }

  cancelPointers() { for (const id of [...this.pointers.keys()]) this.up({ pointerId: id, type:'pointercancel' }); this.pointers.clear(); }

  render({ camera, scene, point, vector, fieldLines = [], wave = null, gridVectors = [] }) {
    const gl = this.gl; if (!gl || this.disposed) return false;
    this.camera = camera;
    const dpr = Math.min(1.5, devicePixelRatio || 1), rect = this.canvas.getBoundingClientRect(), width = Math.max(2, Math.round(rect.width*dpr)), height = Math.max(2, Math.round(rect.height*dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0,0,width,height); gl.clearColor(.025,.035,.065,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    const data = [];
    pushSegment(data, [-2,0,0],[2,0,0],[.95,.25,.3]); pushSegment(data,[0,-2,0],[0,2,0],[.25,.85,.45]); pushSegment(data,[0,0,-2],[0,0,2],[.25,.55,1]);
    if (scene.kind === 'charge') { const p=scene.position; pushSegment(data,add3(p,[-.12,0,0]),add3(p,[.12,0,0]),[1,.72,.2]); pushSegment(data,add3(p,[0,-.12,0]),add3(p,[0,.12,0]),[1,.72,.2]); pushSegment(data,add3(p,[0,0,-.12]),add3(p,[0,0,.12]),[1,.72,.2]); }
    if (scene.kind === 'playground') for (const source of scene.sources.filter(item=>item.visible!==false)) { const strength=source.type==='point'?source.q:source.lambda,color=source.enabled===false?[.45,.45,.48]:strength>=0?[1,.35,.22]:[.25,.55,1];if(source.type==='finite-line'){pushSegment(data,source.start,source.end,color);for(const p of [source.start,source.end]){const size=source.id===scene.selectedId?.12:.08;pushSegment(data,add3(p,[-size,0,0]),add3(p,[size,0,0]),color);pushSegment(data,add3(p,[0,-size,0]),add3(p,[0,size,0]),color);}}else if(source.type==='infinite-line'){const span=scale3(source.direction,source.displayLength/2);pushSegment(data,sub3(source.position,span),add3(source.position,span),color);}else{const p=source.position,size=source.id===scene.selectedId?.16:.11;pushSegment(data,add3(p,[-size,0,0]),add3(p,[size,0,0]),color);pushSegment(data,add3(p,[0,-size,0]),add3(p,[0,size,0]),color);pushSegment(data,add3(p,[0,0,-size]),add3(p,[0,0,size]),color);} }
    if (scene.kind === 'dipole') { const half=scale3(unit3(scene.axis),scene.separation/2); pushSegment(data,sub3(scene.center,half),add3(scene.center,half),[1,.72,.2]); }
    if (scene.kind === 'line') { const span=scale3(unit3(scene.direction),2);pushSegment(data,sub3(scene.position,span),add3(scene.position,span),[1,.72,.2]); }
    if (scene.kind === 'loop') { const n=unit3(scene.normal),seed=Math.abs(n[2])<.9?[0,0,1]:[0,1,0],e1=unit3(cross3(seed,n)),e2=cross3(n,e1);for(let i=0;i<64;i++){const a=2*Math.PI*i/64,b=2*Math.PI*(i+1)/64,pa=add3(scene.center,scale3(add3(scale3(e1,Math.cos(a)),scale3(e2,Math.sin(a))),scene.radius)),pb=add3(scene.center,scale3(add3(scale3(e1,Math.cos(b)),scale3(e2,Math.sin(b))),scene.radius));pushSegment(data,pa,pb,[1,.72,.2]);} }
    if (scene.kind === 'wave' && wave) for (const segment of waveDisplayGeometry(scene,wave.timeCycles)) { pushSegment(data,segment.base,segment.electric,[.95,.35,.9]);pushSegment(data,segment.base,segment.magnetic,[1,.78,.18]); }
    const displayPoint=scene.kind==='wave'&&wave?point.map(value=>value/wave.wavelength):point;
    pushSegment(data, add3(displayPoint,[-.06,0,0]), add3(displayPoint,[.06,0,0]), [1,1,1]); pushSegment(data,add3(displayPoint,[0,-.06,0]),add3(displayPoint,[0,.06,0]),[1,1,1]);
    if(scene.kind==='wave'&&wave&&scene.amplitude>0){const eScale=scene.amplitude,bScale=scene.amplitude/wave.c,eNorm=norm3(wave.E),bNorm=norm3(wave.B);if(eNorm>eScale*1e-12)pushSegment(data,displayPoint,add3(displayPoint,scale3(wave.E,.75/eScale)),[.95,.35,.9]);if(bNorm>bScale*1e-12)pushSegment(data,displayPoint,add3(displayPoint,scale3(wave.B,.75/bScale)),[1,.78,.18]);}
    else {const n=norm3(vector); if(n>0){const normalized=scale3(vector,.75/n);pushSegment(data,displayPoint,add3(displayPoint,normalized),[.1,.9,1]);}}
    for (const line of fieldLines) for(let i=1;i<line.points.length;i++) pushSegment(data,line.points[i-1],line.points[i],[.3,.65,1]);
    for(const arrow of gridVectors)pushSegment(data,arrow.start,arrow.end,arrow.color??[.25,.72,.95]);
    gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.position); gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,24,0); gl.enableVertexAttribArray(this.color); gl.vertexAttribPointer(this.color,3,gl.FLOAT,false,24,12);
    gl.uniformMatrix4fv(this.matrix,false,new Float32Array(multiply(perspective(width/height),lookAt(camera)))); gl.drawArrays(gl.LINES,0,data.length/6);
    return true;
  }

  dispose() {
    if (this.disposed) return; this.disposed = true; this.cancelPointers();
    const gl=this.gl; if(gl){ if(this.buffer)gl.deleteBuffer(this.buffer); if(this.program)gl.deleteProgram(this.program); if(this.vs)gl.deleteShader(this.vs); if(this.fs)gl.deleteShader(this.fs); }
    if (this.onLost) this.canvas.removeEventListener('webglcontextlost',this.onLost);
    if (this.down) { this.canvas.removeEventListener('pointerdown',this.down); this.canvas.removeEventListener('pointermove',this.move); this.canvas.removeEventListener('pointerup',this.up); this.canvas.removeEventListener('pointercancel',this.up); this.canvas.removeEventListener('lostpointercapture',this.up); this.canvas.removeEventListener('wheel',this.wheel); }
  }
}
