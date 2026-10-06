// Course pictures: the cross-section / profile canvas with the draggable probe, the coax B(r) profile, and the small
// emf(t) trace. These only draw what the experiment definitions evaluate. Colours come from the page palette.
import { cssRgba } from './em-palette.js';

const axesFor = plane => (plane === 'xz' ? [0, 2] : plane === 'yz' ? [1, 2] : [0, 1]);
const magnitude = vector => Math.hypot(...vector);
const FONT = 'system-ui, "Malgun Gothic", sans-serif';
const isCoax = definition => definition.id.startsWith('coax-current');

// Assigning canvas.width/height clears and reallocates the backing store, so only do it when the pixel size changes.
function prepareCanvas(canvas, ctx, dpr) {
  const width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 1; ctx.lineCap = 'butt';
}

// Redraw when the canvas changes size (window resize, a note appearing above it, a column reflowing).
function observeSize(canvas, render, signal) {
  const observer = new ResizeObserver(() => render());
  observer.observe(canvas);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}

function drawArrow(ctx, x, y, dx, dy, color, length = 14) {
  const n = Math.hypot(dx, dy);
  if (!n) return;
  const ux = dx / n, uy = dy / n, head = 5;
  ctx.strokeStyle = color; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x - ux * length / 2, y - uy * length / 2); ctx.lineTo(x + ux * length / 2, y + uy * length / 2);
  ctx.lineTo(x + ux * (length / 2 - head) - uy * head / 2, y + uy * (length / 2 - head) + ux * head / 2);
  ctx.moveTo(x + ux * length / 2, y + uy * length / 2);
  ctx.lineTo(x + ux * (length / 2 - head) + uy * head / 2, y + uy * (length / 2 - head) - ux * head / 2);
  ctx.stroke();
}

// Out-of-plane vectors are drawn as the usual dot (toward the viewer) and cross (away).
function drawOutOfPlane(ctx, x, y, positive, color) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.stroke();
  if (positive) { ctx.beginPath(); ctx.arc(x, y, 1.7, 0, 2 * Math.PI); ctx.fill(); }
  else { ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke(); }
}

function colorsOf(palette) {
  const css = name => palette[name].css, soft = (name, alpha) => cssRgba(palette[name].rgb, alpha);
  return {
    bg: css('bg'), grid: css('grid'), text: css('text'), muted: css('muted'), line: css('line'),
    field: css('neg'), fieldSoft: soft('neg', 0.35), source: css('accent'), probe: css('sensor'), pos: css('pos'), neg: css('neg'),
    gauss: css('gauss'), path: css('sensor'), pathFill: soft('sensor', 0.1),
  };
}

export function createCourseView(canvas, onProbe, getPalette) {
  const events = new AbortController();
  let current = null, active = false, dragging = false, pendingMove = null, moveFrame = null;

  const geometry = () => {
    const { definition, params, point, viewScale = 1 } = current, view = definition.view || {};
    const axes = definition.id === 'motional-rod' ? [0, 1] : view.probeAxes?.length === 2 ? view.probeAxes : axesFor(view.plane);
    const base = isCoax(definition) ? Math.max(params.b, params.c || 0) * 1.55
      : Number(view.extent) > 0 ? Number(view.extent) : Math.max(0.01, ...point.map(Math.abs)) * 1.6;
    return { axes, extent: base * viewScale, axisOnly: view.kind === 'axis-only', profileMode: view.kind === 'profile' };
  };
  const profileDomain = () => {
    const points = current.profiles?.[0]?.points || [];
    const lo = Math.min(...points.map(p => p.coordinate)), hi = Math.max(...points.map(p => p.coordinate));
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [-1, 1];
    const center = (lo + hi) / 2, half = (hi - lo) / 2 * (current.viewScale || 1);
    return [center - half, center + half];
  };

  function renderProfile(ctx, w, h, C) {
    const series = (current.profiles || []).filter(p => p.points?.length && p.sampling?.status !== 'unresolved').slice(0, 3);
    const [xMin, xMax] = profileDomain(), left = 58, right = w - 14;
    ctx.font = `12px ${FONT}`;
    if (!series.length) {
      ctx.fillStyle = C.muted; ctx.fillText('표본 해상도 제한 · 곡선을 표시하지 않습니다.', 16, 44);
      canvas.dataset.profileSeries = '0';
      return;
    }
    // Wave and line experiments also hand over the instantaneous curve; the profile is then its amplitude envelope.
    const instant = current.instantProfile?.([xMin, xMax]);
    const mapX = x => left + (x - xMin) / (xMax - xMin) * (right - left);
    series.forEach((data, index) => {
      const top = 28 + index * (h - 48) / series.length, bottom = top + (h - 48) / series.length - 26;
      const live = instant?.[index], envelope = data.points.map(p => p.value);
      let yMin, yMax;
      if (live) {
        const peak = Math.max(...envelope.map(Math.abs), ...live.points.map(p => Math.abs(p.value))) * 1.1 || 1;
        yMin = -peak; yMax = peak;
      } else {
        const low = Math.min(...envelope), high = Math.max(...envelope);
        const pad = high === low ? Math.max(Math.abs(high) * 0.1, high === 0 ? 1 : 1e-20) : (high - low) * 0.1;
        yMin = low - pad; yMax = high + pad;
      }
      const mapY = y => bottom - (y - yMin) / (yMax - yMin) * (bottom - top);
      ctx.fillStyle = C.text;
      ctx.fillText(`${live ? live.label : data.label} (${data.unit})`, left, top - 8);
      ctx.fillStyle = C.muted;
      ctx.fillText(yMax.toExponential(1), 4, top + 5);
      ctx.fillText(yMin.toExponential(1), 4, bottom);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.save();
      ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
      const trace = (points, sign = 1) => {
        ctx.beginPath();
        points.forEach((p, i) => { const x = mapX(p.coordinate), y = mapY(sign * p.value); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      };
      if (live) {
        ctx.strokeStyle = C.fieldSoft; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
        trace(data.points); trace(data.points, -1);
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = index === 0 ? C.field : C.source; ctx.lineWidth = 2;
      trace(live ? live.points : data.points);
      const px = mapX(current.point[2]);
      ctx.strokeStyle = C.probe; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke();
      ctx.restore();
    });
    ctx.fillStyle = C.muted;
    ctx.fillText(`z ${xMin.toPrecision(3)} … ${xMax.toPrecision(3)} m · 점선: 측정 위치${instant ? ' · 파선: 진폭 포락선' : ''}`, 10, h - 17);
    Object.assign(canvas.dataset, { profileSeries: String(series.length), profileXMin: String(xMin), profileXMax: String(xMax) });
  }

  function renderAxisOnly(ctx, w, h, C, scale, extent, vectorKey) {
    ctx.strokeStyle = C.muted;
    ctx.beginPath(); ctx.moveTo(w / 2, 36); ctx.lineTo(w / 2, h - 36); ctx.stroke();
    const radius = Number(current.params.radius ?? current.params.R ?? 0.25 * extent);
    ctx.strokeStyle = C.source; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2, radius * scale, 9, 0, 0, 2 * Math.PI); ctx.stroke();
    if (current.display?.vectors !== false) {
      for (let i = -3; i <= 3; i++) {
        const p = [0, 0, i * extent / 4];
        try {
          const result = current.definition.evaluate(current.params, p), vector = result.status === 'valid' ? result.vectors?.[vectorKey] : null;
          if (vector) drawArrow(ctx, w / 2, h / 2 - p[2] * scale, 0, -vector[2], C.field);
        } catch { /* unsupported samples stay empty */ }
      }
    }
    ctx.fillStyle = C.muted; ctx.font = `13px ${FONT}`;
    ctx.fillText('축상 모델 · 축 밖의 장은 표시하지 않음', 12, 23);
  }

  function renderFieldArrows(ctx, w, h, C, { axes, scale, density, map, vectorKey }) {
    const faraday = current.definition.id === 'faraday-loop';
    const reference = Math.abs(current.params.B0) || 1;
    for (let iy = 1; iy < density + 2; iy++) {
      for (let ix = 1; ix < density + 2; ix++) {
        const p = [...current.point];
        p[axes[0]] = (ix / (density + 2) - 0.5) * w / scale;
        p[axes[1]] = (0.5 - iy / (density + 2)) * h / scale;
        try {
          const result = current.definition.evaluate(current.params, p), vector = result.status === 'valid' ? result.vectors?.[vectorKey] : null;
          if (!vector || !magnitude(vector)) continue;
          const [x, y] = map(p), dx = vector[axes[0]], dy = -vector[axes[1]];
          if (dx || dy) {
            // The faraday field breathes with time: the arrow length follows |B(t)| / |B0|.
            const length = faraday ? 6 + 14 * Math.min(1, magnitude(vector) / reference) : 14;
            drawArrow(ctx, x, y, dx, dy, C.field, length);
          } else {
            const normal = [0, 1, 2].find(a => !axes.includes(a));
            drawOutOfPlane(ctx, x, y, vector[normal] * (axes[0] === 0 && axes[1] === 2 ? -1 : 1) > 0, C.field);
          }
        } catch { /* no artificial field in excluded regions */ }
      }
    }
  }

  function renderCoax(ctx, w, h, C, scale) {
    const { params, point, result, definition } = current;
    for (const [key, color] of [['c', C.muted], ['b', C.source], ['a', C.source]]) {
      const radius = Number(params[key]);
      if (!(radius > 0)) continue;
      ctx.strokeStyle = color; ctx.lineWidth = key === 'c' ? 2 : 4;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, radius * scale, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(key, w / 2 + radius * scale + 6, h / 2 - 8);
    }
    const positive = params.current >= 0, outer = params.c ? (params.b + params.c) / 2 : params.b, surface = definition.id.endsWith('surface');
    const glyph = (x, y, forward) => {
      const color = forward ? C.source : C.neg;
      if (forward) { ctx.fillStyle = color; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill(); ctx.lineWidth = 1.7; ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.stroke(); }
      else { ctx.strokeStyle = color; ctx.lineWidth = 1.7; ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke(); }
    };
    if (params.current !== 0) {
      if (surface) for (let i = 0; i < 12; i++) glyph(w / 2 + params.a * scale * Math.cos(i * Math.PI / 6), h / 2 - params.a * scale * Math.sin(i * Math.PI / 6), positive);
      else glyph(w / 2, h / 2, positive);
      for (let i = 0; i < 8; i++) glyph(w / 2 + outer * scale * Math.cos(i * Math.PI / 4), h / 2 - outer * scale * Math.sin(i * Math.PI / 4), !positive);
    }
    ctx.fillStyle = C.source; ctx.fillText('내부 +I · 외부 −I', 12, 43);
    ctx.fillStyle = C.path; ctx.fillText('점선 원: 암페어 경로 · 음영: 포함 전류의 단면', 12, 62);
    canvas.dataset.probeRegion = result.region || '';
    canvas.dataset.enclosedCurrent = String(result.scalars?.find(v => v.key === 'enclosedCurrent')?.value ?? '');
    const radius = Math.hypot(point[0], point[1]);
    ctx.fillStyle = C.pathFill; ctx.strokeStyle = C.path; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.arc(w / 2, h / 2, radius * scale, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }

  function renderStructure(ctx, w, h, C, { scale, map }) {
    const { definition, params, result } = current, kind = definition.view?.kind;
    if (kind === 'plane-normal') {
      ctx.strokeStyle = C.source; ctx.lineWidth = 4;
      if (definition.id === 'line-finite') {
        const a = map([params.xStart, 0, 0]), b = map([params.xEnd, 0, 0]);
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
        ctx.fillStyle = C.source;
        for (const p of [a, b]) { ctx.beginPath(); ctx.arc(...p, 5, 0, 2 * Math.PI); ctx.fill(); }
      } else {
        const heights = definition.id === 'parallel-plate' ? [0, params.distance]
          : definition.id === 'layered-plate' ? [0, params.d1, params.d1 + params.d2] : [0];
        for (const z of heights) { const y = h / 2 - z * scale; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      }
    } else if (definition.id === 'faraday-loop') {
      const emf = result.scalars?.find(item => item.key === 'emf')?.value ?? 0;
      const radius = Math.sqrt(params.area / Math.PI) * scale;
      ctx.strokeStyle = emf > 0 ? C.pos : emf < 0 ? C.neg : C.source; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(w / 2, h / 2, radius, Math.max(0, Math.abs(Math.cos(params.theta)) * radius), 0, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.font = `13px ${FONT}`;
      ctx.fillText(`루프 개념도 · N=${params.turns} · θ=${params.theta.toPrecision(3)} rad · 색: 기전력 부호`, 12, 44);
    } else if (definition.id === 'motional-rod') {
      const { length, railLength, velocity } = params, x = result.scalars?.find(s => s.key === 'position')?.value;
      ctx.strokeStyle = C.source; ctx.lineWidth = 3;
      for (const y of [-length / 2, length / 2]) { const a = map([0, y, 0]), b = map([railLength, y, 0]); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
      if (Number.isFinite(x)) {
        const a = map([x, -length / 2, 0]), b = map([x, length / 2, 0]);
        ctx.strokeStyle = C.pos; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
        const center = map([x, 0, 0]);
        drawArrow(ctx, center[0], center[1], velocity, 0, C.source);
      }
      if (params.closedCircuit === 1) { const a = map([0, -length / 2, 0]), b = map([0, length / 2, 0]); ctx.strokeStyle = C.source; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
      ctx.fillStyle = C.muted; ctx.font = `13px ${FONT}`;
      ctx.fillText(`레일·이동도선 · v=${velocity} m/s · B는 z 방향`, 12, 44);
    } else if (kind !== 'coax-cross-section') {
      ctx.fillStyle = C.source; ctx.beginPath(); ctx.arc(w / 2, h / 2, 9, 0, 2 * Math.PI); ctx.fill();
    }
    if (definition.id.startsWith('gauss-') || definition.id === 'ampere-wire') {
      ctx.strokeStyle = C.gauss; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
      if (definition.id === 'gauss-sheet') {
        const half = Math.sqrt(params.area) / 2, z = params.centerZ, hz = params.halfHeight;
        const a = map([-half, 0, z + hz]), b = map([half, 0, z - hz]);
        ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      } else {
        const center = map([0, 0, params.centerZ || 0]), radius = (params.pathRadius ?? params.radius) * scale;
        ctx.beginPath(); ctx.arc(...center, radius, 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.fillStyle = C.gauss; ctx.font = `13px ${FONT}`;
      ctx.fillText(definition.id === 'ampere-wire' ? '점선: 암페어 경로 (방향은 입력 조건)' : '점선: 가우스면 단면 (3D 플럭스는 수치검증)', 12, 44);
    }
    if (['dielectric-interface', 'layered-plate'].includes(definition.id)) {
      ctx.fillStyle = C.gauss; ctx.font = `13px ${FONT}`;
      ctx.fillText(`εr1=${params.epsilon1R} · εr2=${params.epsilon2R} · 선: 재료/도체 경계`, 12, 44);
    }
  }

  function render() {
    if (!active || !current || !canvas.clientWidth || !canvas.clientHeight) return;
    const ctx = canvas.getContext('2d'), dpr = Math.min(1.5, devicePixelRatio || 1), C = colorsOf(getPalette());
    prepareCanvas(canvas, ctx, dpr);
    const w = canvas.clientWidth, h = canvas.clientHeight, { axes, extent, axisOnly, profileMode } = geometry();
    const scale = Math.min(w, h) / (2 * extent), map = point => [w / 2 + point[axes[0]] * scale, h / 2 - point[axes[1]] * scale];
    canvas.dataset.metersPerPixel = String(1 / scale);
    canvas.dataset.physicalAspect = 'equal';
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    if (profileMode) { renderProfile(ctx, w, h, C); drawClock(ctx, w, C); return; }
    const fieldKeys = ['E', 'D', 'B', 'H'], vectorKey = current.vectorKey || fieldKeys.find(key => current.result?.vectors?.[key]) || 'E';
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    if (!isCoax(current.definition)) {
      for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * w / 8, 0); ctx.lineTo(i * w / 8, h); ctx.moveTo(0, i * h / 8); ctx.lineTo(w, i * h / 8); ctx.stroke(); }
    }
    if (axisOnly) renderAxisOnly(ctx, w, h, C, scale, extent, vectorKey);
    else {
      const density = current.display?.density || 7;
      if (current.display?.lines !== false && (isCoax(current.definition) || current.definition.view?.kind === 'azimuthal')) {
        for (let i = 1; i <= density; i++) {
          const r = extent * i / (density + 1);
          let result;
          try { result = current.definition.evaluate(current.params, [r, 0, 0]); } catch { continue; }
          const vector = result.status === 'valid' ? result.vectors?.[vectorKey] : null;
          if (!vector || !magnitude(vector)) continue;
          ctx.strokeStyle = C.fieldSoft; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(w / 2, h / 2, r * scale, 0, 2 * Math.PI); ctx.stroke();
          const direction = Math.sign(vector[1]);
          for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
            drawArrow(ctx, w / 2 + r * scale * Math.cos(angle), h / 2 - r * scale * Math.sin(angle), -Math.sin(angle) * direction, -Math.cos(angle) * direction, C.field);
          }
        }
      }
      if (isCoax(current.definition)) renderCoax(ctx, w, h, C, scale);
      if (current.display?.vectors !== false) renderFieldArrows(ctx, w, h, C, { axes, scale, density, map, vectorKey });
      if (current.definition.view?.kind === 'coax-cross-section') {
        if (!isCoax(current.definition)) {
          for (const [key, color] of [['c', C.muted], ['b', C.source], ['a', C.source]]) {
            const radius = Number(current.params[key]);
            if (!(radius > 0)) continue;
            ctx.strokeStyle = color; ctx.lineWidth = key === 'c' ? 2 : 4;
            ctx.beginPath(); ctx.arc(w / 2, h / 2, radius * scale, 0, 2 * Math.PI); ctx.stroke();
            ctx.fillStyle = color; ctx.fillText(key, w / 2 + radius * scale + 6, h / 2 - 8);
          }
        }
      } else renderStructure(ctx, w, h, C, { scale, map });
      ctx.fillStyle = C.muted; ctx.font = `13px ${FONT}`;
      ctx.fillText(`${'xyz'[axes[0]]}${'xyz'[axes[1]]} 단면 · ${vectorKey} 방향`, 12, 23);
    }
    drawProbe(ctx, w, h, C, { axes, axisOnly, scale, map, vectorKey });
    drawClock(ctx, w, C);
  }

  function drawClock(ctx, w, C) {
    if (!current.timeText) return;
    ctx.font = `600 13px ${FONT}`; ctx.textAlign = 'right'; ctx.fillStyle = C.probe;
    ctx.fillText(current.timeText, w - 12, 23);
    ctx.textAlign = 'left';
  }

  function drawProbe(ctx, w, h, C, { axes, axisOnly, scale, map, vectorKey }) {
    const [px, py] = axisOnly ? [w / 2, h / 2 - current.point[2] * scale] : map(current.point);
    if (current.result.status === 'valid') {
      const vector = current.result.vectors?.[vectorKey];
      if (vector) drawArrow(ctx, px, py, vector[axes[0]], -vector[axes[1]], C.probe, 32);
    }
    ctx.strokeStyle = C.text; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 10, 0, 2 * Math.PI);
    ctx.moveTo(px - 16, py); ctx.lineTo(px + 16, py); ctx.moveTo(px, py - 16); ctx.lineTo(px, py + 16); ctx.stroke();
    ctx.fillStyle = C.text; ctx.font = `12px ${FONT}`;
    if (isCoax(current.definition)) { ctx.fillText('흰 점: 관측 위치 · 점선: 관측 반경', 12, h - 16); return; }
    ctx.fillText(axisOnly ? `z ±${(h / (2 * scale)).toPrecision(3)} m · 흰 원: 측정점`
      : `${'xyz'[axes[0]]} ±${(w / (2 * scale)).toPrecision(2)} / ${'xyz'[axes[1]]} ±${(h / (2 * scale)).toPrecision(2)} m · 등축비`, 12, h - 30);
    ctx.fillText('화살표: 장 방향 · 길이는 크기와 무관', 12, h - 13);
  }

  const move = event => {
    if (!active || !current) return;
    const { axes, extent, axisOnly, profileMode } = geometry(), r = canvas.getBoundingClientRect(), point = [...current.point];
    const scale = Math.min(canvas.clientWidth, canvas.clientHeight) / (2 * extent);
    if (profileMode) {
      const [lo, hi] = profileDomain();
      point[0] = 0; point[1] = 0; point[2] = lo + (event.clientX - r.left - 58) / (r.width - 72) * (hi - lo);
      onProbe(point);
      return;
    }
    if (axisOnly) { point[0] = 0; point[1] = 0; point[2] = (canvas.clientHeight / 2 - (event.clientY - r.top - canvas.clientTop)) / scale; }
    else {
      point[axes[0]] = (event.clientX - r.left - canvas.clientLeft - canvas.clientWidth / 2) / scale;
      point[axes[1]] = (canvas.clientHeight / 2 - (event.clientY - r.top - canvas.clientTop)) / scale;
    }
    onProbe(point);
  };
  canvas.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0) return;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    move(event);
  }, { signal: events.signal });
  // Pointer moves are merged to one probe update per animation frame; the last position is flushed when the drag ends.
  const cancelPending = () => { pendingMove = null; if (moveFrame !== null) { cancelAnimationFrame(moveFrame); moveFrame = null; } };
  const flushMove = () => {
    if (moveFrame !== null) { cancelAnimationFrame(moveFrame); moveFrame = null; }
    const pending = pendingMove;
    pendingMove = null;
    if (pending && dragging && active && current) move(pending);
  };
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    pendingMove = { clientX: event.clientX, clientY: event.clientY };
    if (moveFrame === null) moveFrame = requestAnimationFrame(() => { moveFrame = null; flushMove(); });
  }, { signal: events.signal });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { flushMove(); dragging = false; }, { signal: events.signal });
  canvas.addEventListener('keydown', event => {
    if (!active || !current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { onProbe([...current.definition.probeDefault]); return; }
    const { axes, extent, axisOnly, profileMode } = geometry(), point = [...current.point], vertical = ['ArrowUp', 'ArrowDown'].includes(event.key);
    if (profileMode) {
      if (vertical) return;
      const [lo, hi] = profileDomain();
      point[2] += (event.key === 'ArrowLeft' ? -1 : 1) * (hi - lo) * 0.025;
      onProbe(point);
      return;
    }
    if (axisOnly && !vertical) return;
    const axis = axisOnly ? 2 : axes[vertical ? 1 : 0], sign = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
    point[axis] += sign * extent * 0.05;
    onProbe(point);
  }, { signal: events.signal });
  observeSize(canvas, render, events.signal);
  return {
    update(value) { current = value; render(); },
    activate() { active = true; render(); },
    deactivate() { cancelPending(); active = false; dragging = false; },
    destroy() { events.abort(); cancelPending(); active = false; },
    inspect() { return { active, dragging }; },
  };
}

// This view transforms the producer's sampled profile; it does not solve a field.
export function createRadialProfileView(canvas, onRadius, getPalette) {
  const events = new AbortController();
  let current = null, active = false, dragging = false, domain = [0, 1], factor = 1;
  function render() {
    if (!active || !current || canvas.hidden || !canvas.clientWidth || !canvas.clientHeight) return;
    const ctx = canvas.getContext('2d'), dpr = Math.min(1.5, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    const C = colorsOf(getPalette());
    prepareCanvas(canvas, ctx, dpr);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    const series = current.profiles?.find(p => p.key === 'Bphi'), points = series?.points || [];
    if (!points.length) { canvas.dataset.profileSeries = '0'; return; }
    factor = current.normalized ? current.params.a : 1;
    const mu = current.result.scalars?.find(s => s.key === 'permeability')?.value;
    const normalizer = current.normalized ? mu * current.params.current / (2 * Math.PI * current.params.a) : 1;
    const normalized = current.normalized && Number.isFinite(normalizer) && normalizer !== 0;
    const values = points.map(p => p.value / (normalized ? normalizer : 1));
    const low = Math.min(0, ...values), high = Math.max(...values), pad = high === low ? 1 : (high - low) * 0.12;
    const yMin = low - pad, yMax = high + pad;
    domain = [Math.min(...points.map(p => p.coordinate)) / factor, Math.max(...points.map(p => p.coordinate)) / factor];
    const left = 58, right = w - 18, top = 34, bottom = h - 40;
    const mapX = x => left + (x - domain[0]) / (domain[1] - domain[0]) * (right - left), mapY = y => bottom - (y - yMin) / (yMax - yMin) * (bottom - top);
    ctx.font = `12px ${FONT}`; ctx.fillStyle = C.text;
    ctx.fillText(normalized ? 'Bφ/B₀ · B₀=μI/(2πa)' : 'Bφ (T)' + (current.normalized ? ' · I=0: 정규화 없음' : ''), 12, 20);
    ctx.fillStyle = C.muted;
    ctx.fillText(yMax.toPrecision(3), 3, top + 5);
    ctx.fillText(yMin.toPrecision(3), 3, bottom);
    ctx.strokeStyle = C.grid; ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    for (const key of ['a', 'b', 'c']) {
      if (!current.params[key]) continue;
      const x = mapX(current.params[key] / factor);
      ctx.strokeStyle = C.line; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = C.source; ctx.fillText(key, x + 4, top + 14);
    }
    ctx.setLineDash([]); ctx.strokeStyle = C.field; ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => { const x = mapX(p.coordinate / factor), y = mapY(values[i]); if (!i || p.breakBefore) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    const radius = Math.hypot(current.point[0], current.point[1]), cursor = radius / factor, x = mapX(cursor);
    ctx.strokeStyle = C.probe; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
    const value = current.result.scalars?.find(s => s.key === 'Bphi')?.value;
    if (Number.isFinite(value)) { ctx.fillStyle = C.probe; ctx.beginPath(); ctx.arc(x, mapY(value / (normalized ? normalizer : 1)), 5, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = C.text;
    ctx.fillText((current.normalized ? 'r/a' : 'r (m)') + ' · ' + domain[0].toPrecision(3) + ' … ' + domain[1].toPrecision(3) + ' · 드래그로 관측점 이동', 12, h - 15);
    Object.assign(canvas.dataset, {
      profileSeries: '1', radius: String(radius), cursor: String(cursor), normalized: String(normalized),
      profileXMin: String(domain[0]), profileXMax: String(domain[1]), probeRegion: current.result.region || '',
    });
  }
  const move = event => {
    if (!active || !current) return;
    const r = canvas.getBoundingClientRect(), fraction = Math.max(0, Math.min(1, (event.clientX - r.left - 58) / (r.width - 76)));
    onRadius((domain[0] + fraction * (domain[1] - domain[0])) * factor);
  };
  canvas.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0) return;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    move(event);
  }, { signal: events.signal });
  canvas.addEventListener('pointermove', event => { if (dragging) move(event); }, { signal: events.signal });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { dragging = false; }, { signal: events.signal });
  canvas.addEventListener('keydown', event => {
    if (!active || !current || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    const radius = Math.hypot(current.point[0], current.point[1]);
    onRadius(event.key === 'Home' ? Math.hypot(...current.definition.probeDefault.slice(0, 2))
      : Math.max(0, radius + (event.key === 'ArrowLeft' ? -1 : 1) * (domain[1] - domain[0]) * factor * 0.025));
  }, { signal: events.signal });
  observeSize(canvas, render, events.signal);
  return {
    update(value) { current = value; render(); },
    activate() { active = true; render(); },
    deactivate() { active = false; dragging = false; },
    destroy() { events.abort(); active = false; },
    inspect() { return { active, dragging, domain: [...domain], factor }; },
  };
}

/** emf(t) strip: the curve over the sweep with a cursor at the current time. trace = { points: [{ t, value }], unit }. */
export function drawTimeTrace(canvas, trace, time, palette, label) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h || !trace) return;
  const ctx = canvas.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), C = colorsOf(palette);
  prepareCanvas(canvas, ctx, dpr);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
  const left = 52, right = w - 12, top = 22, bottom = h - 18;
  const values = trace.points.map(p => p.value), low = Math.min(0, ...values), high = Math.max(0, ...values);
  const pad = high === low ? 1 : (high - low) * 0.12, yMin = low - pad, yMax = high + pad;
  const t0 = trace.points[0].t, t1 = trace.points.at(-1).t;
  const mapX = t => left + (t - t0) / (t1 - t0 || 1) * (right - left), mapY = v => bottom - (v - yMin) / (yMax - yMin) * (bottom - top);
  ctx.font = `12px ${FONT}`; ctx.fillStyle = C.text;
  ctx.fillText(`${label} (${trace.unit})`, left, 14);
  ctx.strokeStyle = C.grid; ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(left, mapY(0)); ctx.lineTo(right, mapY(0)); ctx.stroke();
  ctx.strokeStyle = C.field; ctx.lineWidth = 2; ctx.beginPath();
  trace.points.forEach((p, i) => { const x = mapX(p.t), y = mapY(p.value); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  const x = Math.max(left, Math.min(right, mapX(time)));
  ctx.strokeStyle = C.probe; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C.muted;
  ctx.fillText(yMax.toPrecision(2), 4, top + 8);
  ctx.fillText(yMin.toPrecision(2), 4, bottom);
}
