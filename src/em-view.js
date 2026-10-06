// The 3D view (WebGL lines). Draws whatever the controller hands over; colours come from the page palette.
// Input: one pointer on empty space turns the camera, two pointers zoom, a pointer that grabs a source is passed to
// interactionListener (the controller maps it onto the editing plane).
import { add3, cross3, norm3, scale3, sub3, unit3 } from './em-physics.js';
import { screenRay } from './em-playground-interaction.js';
import { planeAxes, planeNormal } from './em-plane-geometry.js';

const vertexShader = `attribute vec3 a_position; attribute vec3 a_color; uniform mat4 u_matrix; varying vec3 v_color;
void main(){ gl_Position=u_matrix*vec4(a_position,1.0); v_color=a_color; }`;
const fragmentShader = 'precision mediump float; varying vec3 v_color; void main(){ gl_FragColor=vec4(v_color,1.0); }';

function shader(gl, type, source) {
  const value = gl.createShader(type);
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(value);
    gl.deleteShader(value);
    throw new Error(message);
  }
  return value;
}

function multiply(a, b) {
  const out = Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function perspective(aspect) {
  const f = 1 / Math.tan(Math.PI / 8), near = .05, far = 100;
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
}

function lookAt(camera) {
  const eye = [
    camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw),
    camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
    camera.distance * Math.sin(camera.pitch),
  ];
  const z = scale3(eye, 1 / norm3(eye)), x0 = [-z[1], z[0], 0], x = scale3(x0, 1 / (norm3(x0) || 1));
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -x[0] * eye[0] - x[1] * eye[1] - x[2] * eye[2], -y[0] * eye[0] - y[1] * eye[1] - y[2] * eye[2],
    -z[0] * eye[0] - z[1] * eye[1] - z[2] * eye[2], 1,
  ];
}

const pushSegment = (data, a, b, color) => { data.push(...a, ...color, ...b, ...color); };

function cross(data, p, size, color) {
  for (const axis of [0, 1, 2]) {
    const d = [0, 0, 0];
    d[axis] = size;
    pushSegment(data, sub3(p, d), add3(p, d), color);
  }
}

// Octahedron outline: a point charge as a small solid-looking marker.
function octahedron(data, p, size, color) {
  const tips = [[size, 0, 0], [-size, 0, 0], [0, size, 0], [0, -size, 0], [0, 0, size], [0, 0, -size]].map(d => add3(p, d));
  for (const i of [0, 1]) for (const j of [2, 3, 4, 5]) pushSegment(data, tips[i], tips[j], color);
  for (const [i, j] of [[2, 4], [4, 3], [3, 5], [5, 2]]) pushSegment(data, tips[i], tips[j], color);
}

function circle(data, center, u, v, radius, color, count = 48) {
  for (let i = 0; i < count; i++) {
    const a = 2 * Math.PI * i / count, b = 2 * Math.PI * (i + 1) / count;
    const point = t => add3(center, add3(scale3(u, radius * Math.cos(t)), scale3(v, radius * Math.sin(t))));
    pushSegment(data, point(a), point(b), color);
  }
}

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

const ZERO = [0, 0, 0], units = rgb => rgb.map(c => c / 255);

/** Colour set for the GL scene from the page palette ({ name: { rgb } }). */
function colorsOf(palette) {
  const c = name => units(palette[name].rgb);
  return {
    bg: c('bg'), text: c('text'), muted: c('muted'), grid: c('grid'), pos: c('pos'), neg: c('neg'),
    sensor: c('sensor'), gauss: c('gauss'), accent: c('accent'),
  };
}

function drawScene(data, scene, colors, timeCycles) {
  const sourceColor = (source, strength) => (source.enabled === false ? colors.muted : strength >= 0 ? colors.pos : colors.neg);
  if (scene.kind === 'charge') octahedron(data, scene.position, .12, colors.pos);
  if (scene.kind === 'playground') {
    for (const source of scene.sources.filter(item => item.visible !== false)) {
      const strength = source.type === 'point' ? source.q : source.lambda, color = sourceColor(source, strength);
      const selected = source.id === scene.selectedId;
      if (source.type === 'finite-line') {
        pushSegment(data, source.start, source.end, color);
        for (const p of [source.start, source.end]) cross(data, p, selected ? .12 : .08, color);
      } else if (source.type === 'infinite-line') {
        const span = scale3(source.direction, source.displayLength / 2);
        pushSegment(data, sub3(source.position, span), add3(source.position, span), color);
        cross(data, source.position, selected ? .12 : .08, color);
      } else {
        octahedron(data, source.position, selected ? .17 : .12, color);
        if (selected) cross(data, source.position, .26, colors.accent);
      }
    }
  }
  if (scene.kind === 'dipole') {
    const half = scale3(unit3(scene.axis), scene.separation / 2);
    octahedron(data, add3(scene.center, half), .1, colors.pos);
    octahedron(data, sub3(scene.center, half), .1, colors.neg);
  }
  if (scene.kind === 'line') {
    const span = scale3(unit3(scene.direction), 2);
    pushSegment(data, sub3(scene.position, span), add3(scene.position, span), colors.accent);
  }
  if (scene.kind === 'loop') {
    const n = unit3(scene.normal), seed = Math.abs(n[2]) < .9 ? [0, 0, 1] : [0, 1, 0];
    const e1 = unit3(cross3(seed, n)), e2 = cross3(n, e1);
    circle(data, scene.center, e1, e2, scene.radius, colors.accent, 64);
  }
  if (scene.kind === 'wave') {
    for (const segment of waveDisplayGeometry(scene, timeCycles)) {
      pushSegment(data, segment.base, segment.electric, colors.pos);
      pushSegment(data, segment.base, segment.magnetic, colors.neg);
    }
  }
}

export class EMView {
  constructor(canvas, message) {
    Object.assign(this, { canvas, message, disposed: false, pointers: new Map(), cameraListener: null, interactionListener: null, camera: null });
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
    if (!gl) {
      message.textContent = 'WebGL을 만들 수 없습니다. 브라우저 그래픽 가속을 확인한 뒤 다시 여세요. 수치 결과만 사용할 수 있습니다.';
      this.gl = null;
      return;
    }
    this.gl = gl;
    this.lost = false;
    this.lastRender = null;
    try {
      this.initProgram();
      canvas.addEventListener('webglcontextlost', this.onLost = event => {
        event.preventDefault();
        this.lost = true;
        message.textContent = 'WebGL 컨텍스트가 손실되었습니다. 복구되면 자동으로 다시 그립니다. 수치 결과는 보존됩니다.';
      });
      canvas.addEventListener('webglcontextrestored', this.onRestored = () => {
        // All GL objects died with the old context: rebuild program/buffer and redraw the last frame.
        try { this.initProgram(); this.lost = false; if (this.lastRender && !this.disposed) this.render(this.lastRender); }
        catch (error) { message.textContent = `WebGL 복구 실패: ${error.message}`; }
      });
      this.installInput();
    } catch (error) {
      message.textContent = `WebGL 초기화 실패: ${error.message}`;
      this.dispose();
    }
  }

  initProgram() {
    const gl = this.gl, vs = shader(gl, gl.VERTEX_SHADER, vertexShader), fs = shader(gl, gl.FRAGMENT_SHADER, fragmentShader);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    Object.assign(this, {
      program, vs, fs, buffer: gl.createBuffer(),
      position: gl.getAttribLocation(program, 'a_position'), color: gl.getAttribLocation(program, 'a_color'),
      matrix: gl.getUniformLocation(program, 'u_matrix'),
    });
    this.message.textContent = 'WebGL · 실제 xyz 깊이 투영 · 화살표 길이는 물리 크기와 무관';
  }

  installInput() {
    const canvas = this.canvas;
    const rayAt = (clientX, clientY) => screenRay(canvas.getBoundingClientRect(), clientX, clientY, this.camera);
    this.down = event => {
      if (event.button !== 0 && event.pointerType !== 'touch') return;
      event.preventDefault();
      if ([...this.pointers.values()].some(pointer => pointer.interaction)) {
        this.interactionListener?.up?.({ type: 'pointercancel' }, true, null);
        for (const [id, pointer] of this.pointers) this.pointers.set(id, { ...pointer, interaction: false });
      }
      const grabbed = this.pointers.size === 0 && Boolean(this.interactionListener?.down?.(event, rayAt(event.clientX, event.clientY)));
      canvas.setPointerCapture?.(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, interaction: grabbed });
    };
    this.move = event => {
      const old = this.pointers.get(event.pointerId);
      if (!old) return;
      if (old.interaction) {
        this.interactionListener?.move?.(event, rayAt(event.clientX, event.clientY));
        this.pointers.set(event.pointerId, { ...old, x: event.clientX, y: event.clientY });
        return;
      }
      if (this.pointers.size === 1) {
        this.cameraListener?.({ yaw: (event.clientX - old.x) * .009, pitch: -(event.clientY - old.y) * .009, zoom: 0 });
      } else if (this.pointers.size === 2) {
        const other = [...this.pointers.values()].find(p => p !== old);
        const before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        this.cameraListener?.({ yaw: 0, pitch: 0, zoom: (before - after) * .012 });
      }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    this.up = event => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
      this.pointers.delete(event.pointerId);
      if (pointer.interaction) {
        this.interactionListener?.up?.(event, event.type !== 'pointerup', rayAt(event.clientX ?? pointer.x, event.clientY ?? pointer.y));
      }
      try { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    };
    this.wheel = event => { event.preventDefault(); this.cameraListener?.({ yaw: 0, pitch: 0, zoom: Math.sign(event.deltaY) * .45 }); };
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(name, { pointerdown: this.down, pointermove: this.move }[name] ?? this.up);
    }
    canvas.addEventListener('wheel', this.wheel, { passive: false });
  }

  cancelPointers() {
    for (const id of [...this.pointers.keys()]) this.up({ pointerId: id, type: 'pointercancel' });
    this.pointers.clear();
  }

  /**
   * One frame. `palette` is the page palette; `plane` / `fixed` draw the editing plane's grid; `gauss` a sphere
   * { center, radius }; `sensor` { point, vector }.
   */
  render(frame) {
    const { camera, scene, point, vector, fieldLines = [], wave = null, gridVectors = [], palette, plane = null, fixed = 0, gauss = null } = frame;
    const gl = this.gl;
    if (!gl || this.disposed) return false;
    this.camera = camera;
    this.lastRender = frame;
    if (this.lost || gl.isContextLost?.()) return false;
    const colors = colorsOf(palette);
    const dpr = Math.min(1.5, devicePixelRatio || 1), rect = this.canvas.getBoundingClientRect();
    const width = Math.max(2, Math.round(rect.width * dpr)), height = Math.max(2, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clearColor(...colors.bg, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const data = [];
    this.drawFrame(data, { scene, point, vector, fieldLines, wave, gridVectors, plane, fixed, gauss }, colors);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.position);
    gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(this.color);
    gl.vertexAttribPointer(this.color, 3, gl.FLOAT, false, 24, 12);
    gl.uniformMatrix4fv(this.matrix, false, new Float32Array(multiply(perspective(width / height), lookAt(camera))));
    gl.drawArrays(gl.LINES, 0, data.length / 6);
    return true;
  }

  drawFrame(data, { scene, point, vector, fieldLines, wave, gridVectors, plane, fixed, gauss }, colors) {
    const isWave = scene.kind === 'wave' && wave;
    // axes, then the editing-plane grid
    pushSegment(data, [-2, 0, 0], [2, 0, 0], colors.pos);
    pushSegment(data, [0, -2, 0], [0, 2, 0], colors.gauss);
    pushSegment(data, [0, 0, -2], [0, 0, 2], colors.neg);
    if (plane) {
      const [a, b] = planeAxes(plane), normal = planeNormal(plane);
      for (let k = -3; k <= 3; k++) {
        for (const [from, to] of [[[k, -3], [k, 3]], [[-3, k], [3, k]]]) {
          const p = [0, 0, 0], q = [0, 0, 0];
          p[a] = from[0]; p[b] = from[1]; p[normal] = fixed;
          q[a] = to[0]; q[b] = to[1]; q[normal] = fixed;
          pushSegment(data, p, q, colors.grid);
        }
      }
    }
    drawScene(data, scene, colors, wave?.timeCycles ?? 0);
    const displayPoint = isWave ? point.map(value => value / wave.wavelength) : point;
    cross(data, displayPoint, .09, colors.sensor);
    if (isWave && scene.amplitude > 0) {
      const eScale = scene.amplitude, bScale = scene.amplitude / wave.c;
      if (norm3(wave.E) > eScale * 1e-12) pushSegment(data, displayPoint, add3(displayPoint, scale3(wave.E, .75 / eScale)), colors.pos);
      if (norm3(wave.B) > bScale * 1e-12) pushSegment(data, displayPoint, add3(displayPoint, scale3(wave.B, .75 / bScale)), colors.neg);
    } else if (norm3(vector ?? ZERO) > 0) {
      pushSegment(data, displayPoint, add3(displayPoint, scale3(vector, .75 / norm3(vector))), colors.sensor);
    }
    for (const line of fieldLines) for (let i = 1; i < line.points.length; i++) pushSegment(data, line.points[i - 1], line.points[i], colors.text);
    for (const arrow of gridVectors) pushSegment(data, arrow.start, arrow.end, colors.muted);
    if (gauss) {
      const { center, radius } = gauss;
      circle(data, center, [1, 0, 0], [0, 1, 0], radius, colors.gauss, 64);
      circle(data, center, [1, 0, 0], [0, 0, 1], radius, colors.gauss, 64);
      circle(data, center, [0, 1, 0], [0, 0, 1], radius, colors.gauss, 64);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPointers();
    const gl = this.gl;
    if (gl) {
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      if (this.vs) gl.deleteShader(this.vs);
      if (this.fs) gl.deleteShader(this.fs);
    }
    if (this.onLost) this.canvas.removeEventListener('webglcontextlost', this.onLost);
    if (this.onRestored) this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    if (this.down) {
      for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        this.canvas.removeEventListener(name, { pointerdown: this.down, pointermove: this.move }[name] ?? this.up);
      }
      this.canvas.removeEventListener('wheel', this.wheel);
    }
  }
}
