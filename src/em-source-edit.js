// Inline inspector model for the selected source: which fields to show, how a field value becomes a source patch,
// and the charge slider scale. Pure: no DOM. Patches go to editor.updateSource() and apply live.
import { siText } from './em-format.js';
import { planeAxes } from './em-plane-geometry.js';

// Charge slider: position t in [-1, 1], centre notch = 0, then logarithmic from 0.01 nC to 1000 nC (the +-1 uC limit).
const NOTCH = 0.03, Q_MIN_NC = 0.01, Q_MAX_NC = 1000;
const SIGNIFICANT = value => Number(value.toPrecision(3));

/** Slider position -> strength in nC (or nC/m for lines). */
export function strengthFromSlider(t) {
  const magnitude = Math.abs(t);
  if (magnitude <= NOTCH) return 0;
  const fraction = Math.min(1, (magnitude - NOTCH) / (1 - NOTCH));
  return Math.sign(t) * SIGNIFICANT(Q_MIN_NC * (Q_MAX_NC / Q_MIN_NC) ** fraction);
}

/** Strength in nC -> slider position (inverse of strengthFromSlider, clamped). */
export function sliderFromStrength(nc) {
  const magnitude = Math.abs(nc);
  if (!(magnitude >= Q_MIN_NC)) return 0;
  const fraction = Math.log(Math.min(magnitude, Q_MAX_NC) / Q_MIN_NC) / Math.log(Q_MAX_NC / Q_MIN_NC);
  return Math.sign(nc) * (NOTCH + fraction * (1 - NOTCH));
}

const AXIS_NAME = ['x', 'y', 'z'];
const round = value => Number(value.toFixed(3));
const degrees = radians => (radians * 180 / Math.PI + 360) % 360;

/** Compact signed label such as "+1 nC" or "−2 nC/m" for a source. */
export function strengthText(source) {
  const strength = source.type === 'point' ? source.q : source.lambda;
  const text = siText(Math.abs(strength), source.type === 'point' ? 'C' : 'C/m', 3);
  return `${strength < 0 ? '−' : '+'}${text}`;
}

export function sourceTitle(source) {
  const kind = source.type === 'point' ? '점전하' : source.type === 'finite-line' ? '유한 선전하' : '무한 선전하';
  return `${source.id} · ${kind}`;
}

/**
 * Fields of the inspector for `source` viewed in `plane`.
 * Each: { id, label, unit, control: 'strength' | 'number' | 'angle', value } with display values (nC, m, degrees).
 */
export function inspectorFields(source, plane) {
  const [a, b] = planeAxes(plane);
  const axisLabel = (prefix, axis) => `${prefix}${AXIS_NAME[axis]}`;
  const strength = source.type === 'point'
    ? { id: 'strength', label: 'q', unit: 'nC', control: 'strength', value: source.q * 1e9 }
    : { id: 'strength', label: 'λ', unit: 'nC/m', control: 'strength', value: source.lambda * 1e9 };
  const number = (id, label, value) => ({ id, label, unit: 'm', control: 'number', value: round(value) });
  if (source.type === 'point') {
    return [strength, number('pa', AXIS_NAME[a], source.position[a]), number('pb', AXIS_NAME[b], source.position[b])];
  }
  if (source.type === 'finite-line') {
    return [
      strength,
      number('sa', axisLabel('A ', a), source.start[a]), number('sb', axisLabel('A ', b), source.start[b]),
      number('ea', axisLabel('B ', a), source.end[a]), number('eb', axisLabel('B ', b), source.end[b]),
    ];
  }
  const angle = degrees(Math.atan2(source.direction[b], source.direction[a]));
  return [
    strength,
    number('pa', axisLabel('기준 ', a), source.position[a]), number('pb', axisLabel('기준 ', b), source.position[b]),
    { id: 'angle', label: '방향', unit: '°', control: 'angle', value: round(angle) },
  ];
}

const withComponent = (vector, axis, value) => vector.map((component, i) => (i === axis ? value : component));

/** Patch for editor.updateSource(), or null when the field id does not apply to this source. */
export function patchFromField(source, plane, fieldId, value) {
  if (!Number.isFinite(value)) return null;
  const [a, b] = planeAxes(plane);
  if (fieldId === 'strength') return source.type === 'point' ? { q: value * 1e-9 } : { lambda: value * 1e-9 };
  if (source.type === 'point') {
    if (fieldId === 'pa') return { position: withComponent(source.position, a, value) };
    if (fieldId === 'pb') return { position: withComponent(source.position, b, value) };
  } else if (source.type === 'finite-line') {
    if (fieldId === 'sa') return { start: withComponent(source.start, a, value) };
    if (fieldId === 'sb') return { start: withComponent(source.start, b, value) };
    if (fieldId === 'ea') return { end: withComponent(source.end, a, value) };
    if (fieldId === 'eb') return { end: withComponent(source.end, b, value) };
  } else {
    if (fieldId === 'pa') return { position: withComponent(source.position, a, value) };
    if (fieldId === 'pb') return { position: withComponent(source.position, b, value) };
    if (fieldId === 'angle') {
      const radians = value * Math.PI / 180, direction = [0, 0, 0];
      direction[a] = Math.cos(radians);
      direction[b] = Math.sin(radians);
      return { direction };
    }
  }
  return null;
}

/** Patch that moves a whole source by (da, db) metres inside the viewed plane (keyboard nudging). */
export function nudgePatch(source, plane, da, db) {
  const [a, b] = planeAxes(plane);
  const move = vector => vector.map((value, i) => (i === a ? value + da : i === b ? value + db : value));
  if (source.type === 'finite-line') return { start: move(source.start), end: move(source.end) };
  return { position: move(source.position) };
}

// In-plane distance from (a, b) to a source: its point, its segment, or its whole line.
function planeDistance(source, axes, a, b) {
  const [u, v] = axes, point = (p, q) => Math.hypot(p - a, q - b);
  if (source.type === 'point') return point(source.position[u], source.position[v]);
  const start = source.type === 'finite-line' ? source.start : source.position;
  const end = source.type === 'finite-line' ? source.end : source.position.map((value, i) => value + source.direction[i]);
  const dx = end[u] - start[u], dy = end[v] - start[v], length2 = dx * dx + dy * dy;
  if (!length2) return point(start[u], start[v]);
  const t = ((a - start[u]) * dx + (b - start[v]) * dy) / length2;
  const clamped = source.type === 'finite-line' ? Math.max(0, Math.min(1, t)) : t;
  return point(start[u] + clamped * dx, start[v] + clamped * dy);
}

/**
 * A free in-plane spot for a new source: the first of a spiral of candidates that keeps `clearance` metres from every
 * existing source (points, segments, whole infinite lines) and from the sensor. Returns a 3D point on the plane
 * (normal coordinate = `fixed`).
 */
export function freeSpot(sources, plane, fixed, sensor, clearance = 0.7) {
  const axes = planeAxes(plane), [a, b] = axes, normal = 3 - a - b;
  for (let i = 0; i < 80; i += 1) {
    const angle = i * 2.399963, radius = i === 0 ? 0 : 0.55 * Math.sqrt(i) + 0.4;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    const clear = sources.every(source => planeDistance(source, axes, x, y) >= clearance)
      && Math.hypot(sensor[a] - x, sensor[b] - y) >= clearance;
    if (clear) {
      const spot = [0, 0, 0];
      spot[a] = x; spot[b] = y; spot[normal] = fixed;
      return spot;
    }
  }
  const fallback = [0, 0, 0];
  fallback[normal] = fixed;
  return fallback;
}
