// Inspector model of the current sources: titles, which fields to show, how a typed field value becomes a source patch, the
// strength slider scale and where a new source goes. The magnetostatic counterpart of em-source-edit. Pure: no DOM.
import { siText } from './em-format.js';
import {
  MAX_CURRENT, MAX_SHEET_K, MAX_LOOP_RADIUS, MIN_LOOP_RADIUS, inPlaneAngle, inPlaneDirection, planeBasis, screenSense, sheetLineDirection,
  strengthOf, strengthUnit, viewNormal,
} from './em-current-field.js';
import { add3, cross3, dot3, scale3 } from './em-physics.js';

const SIGNIFICANT = value => Number(value.toPrecision(3));
const NOTCH = 0.03;
// Strength slider: centre notch = 0, then logarithmic from I_MIN to the +-100 A limit (K: 1 A/m ... 1000 A/m).
const SCALE = { current: { min: 0.1, max: MAX_CURRENT }, K: { min: 1, max: MAX_SHEET_K } };
const scaleOf = source => (source.type === 'sheet' ? SCALE.K : SCALE.current);

/** Slider position t in [-1, 1] -> signed strength in A (or A/m for a sheet). */
export function strengthFromSlider(t, source) {
  const { min, max } = scaleOf(source), magnitude = Math.abs(t);
  if (magnitude <= NOTCH) return 0;
  const fraction = Math.min(1, (magnitude - NOTCH) / (1 - NOTCH));
  return Math.sign(t) * SIGNIFICANT(min * (max / min) ** fraction);
}

/** Strength -> slider position (inverse of strengthFromSlider, clamped). */
export function sliderFromStrength(value, source) {
  const { min, max } = scaleOf(source), magnitude = Math.abs(value);
  if (!(magnitude >= min)) return 0;
  return Math.sign(value) * (NOTCH + Math.log(Math.min(magnitude, max) / min) / Math.log(max / min) * (1 - NOTCH));
}

const KIND = { wire: '무한 직선전류', segment: '유한 직선전류', loop: '원형 전류 루프', sheet: '면전류 판' };
const AXIS_NAME = ['x', 'y', 'z'];
const round = value => Number(value.toFixed(3));

export function sourceTitle(source) { return `${source.id} · ${KIND[source.type]}`; }

/** "+10 A", "−2.5 A", "+20 A/m". */
export function strengthText(source) {
  const strength = strengthOf(source), text = siText(Math.abs(strength), strengthUnit(source), 3);
  return `${strength < 0 ? '−' : '+'}${text}`;
}

/** "⊙ 화면 밖" / "⊗ 화면 안" / "화면 안에서 흐름" for a wire, loop or sheet seen in `plane`. */
export function senseText(source, plane) {
  if (source.type === 'segment') return '유한 도선 (시작 → 끝)';
  const sense = screenSense(source, viewNormal(plane));
  if (source.type === 'loop') return sense === 0 ? '축이 화면 안 (옆에서 본 루프)' : sense > 0 ? '반시계 방향 (축이 화면 밖)' : '시계 방향 (축이 화면 안)';
  return sense > 0 ? '⊙ 화면 밖' : sense < 0 ? '⊗ 화면 안' : '화면 안에서 흐름';
}

/**
 * Fields of the inspector for `source` viewed in `plane`: { id, label, unit, control, value } with display values.
 * Position fields show the two in-plane coordinates; the third one stays as stored.
 */
export function inspectorFields(source, plane) {
  const { axes: [a, b] } = planeBasis(plane);
  const number = (id, label, unit, value) => ({ id, label, unit, control: 'number', value: round(value) });
  const strength = { id: 'strength', label: source.type === 'sheet' ? 'K' : 'I', unit: strengthUnit(source), control: 'strength', value: strengthOf(source) };
  if (source.type === 'segment') {
    return [
      strength,
      number('sa', `A ${AXIS_NAME[a]}`, 'm', source.start[a]), number('sb', `A ${AXIS_NAME[b]}`, 'm', source.start[b]),
      number('ea', `B ${AXIS_NAME[a]}`, 'm', source.end[a]), number('eb', `B ${AXIS_NAME[b]}`, 'm', source.end[b]),
    ];
  }
  const position = [number('pa', source.type === 'loop' ? `중심 ${AXIS_NAME[a]}` : `${AXIS_NAME[a]}`, 'm', source.position[a]),
    number('pb', source.type === 'loop' ? `중심 ${AXIS_NAME[b]}` : `${AXIS_NAME[b]}`, 'm', source.position[b])];
  if (source.type === 'wire') return [strength, ...position];
  if (source.type === 'loop') {
    const face = Math.abs(dot3(source.normal, viewNormal(plane))) > 0.99;
    return [
      strength, ...position, number('radius', '반지름 R', 'm', source.radius),
      ...(face ? [] : [{ id: 'angle', label: '축 방향', unit: '°', control: 'angle', value: round(inPlaneAngle(plane, source.normal)) }]),
    ];
  }
  const line = sheetLineDirection(source, plane);
  return [
    strength, ...position,
    ...(line ? [{ id: 'angle', label: '판 방향', unit: '°', control: 'angle', value: round(inPlaneAngle(plane, line)) }] : []),
  ];
}

const withComponent = (vector, axis, value) => vector.map((component, i) => (i === axis ? value : component));

/** Patch for editor.updateSource(), or null when the field id does not apply. */
export function patchFromField(source, plane, fieldId, value) {
  if (!Number.isFinite(value)) return null;
  const { axes: [a, b], n } = planeBasis(plane);
  if (fieldId === 'strength') return source.type === 'sheet' ? { K: value } : { current: value };
  if (source.type === 'segment') {
    if (fieldId === 'sa') return { start: withComponent(source.start, a, value) };
    if (fieldId === 'sb') return { start: withComponent(source.start, b, value) };
    if (fieldId === 'ea') return { end: withComponent(source.end, a, value) };
    if (fieldId === 'eb') return { end: withComponent(source.end, b, value) };
    return null;
  }
  if (fieldId === 'pa') return { position: withComponent(source.position, a, value) };
  if (fieldId === 'pb') return { position: withComponent(source.position, b, value) };
  if (source.type === 'loop') {
    if (fieldId === 'radius') return { radius: Math.min(MAX_LOOP_RADIUS, Math.max(MIN_LOOP_RADIUS, value)) };
    if (fieldId === 'angle') return { normal: inPlaneDirection(plane, value) };
  }
  if (source.type === 'sheet' && fieldId === 'angle') {
    const t = inPlaneDirection(plane, value), outOfPlane = Math.abs(dot3(source.direction, n)) >= 0.5;
    const oldT = sheetLineDirection(source, plane) ?? t, sign = Math.sign(dot3(source.direction, outOfPlane ? n : oldT)) || 1;
    return { normal: cross3(n, t), direction: scale3(outOfPlane ? n : t, sign) };
  }
  return null;
}

/** Buttons under the fields: [{ id, label }] and the patch an action makes. */
export function sourceActions(source, plane) {
  const face = Math.abs(dot3(source.normal ?? [0, 0, 0], viewNormal(plane))) > 0.99;
  if (source.type === 'loop') return [{ id: 'toggle-axis', label: face ? '옆에서 보기 (축을 화면 안으로)' : '정면에서 보기 (축을 화면 밖으로)' }];
  if (source.type === 'sheet') {
    const outOfPlane = Math.abs(dot3(source.direction, viewNormal(plane))) >= 0.5;
    return [{ id: 'toggle-k', label: outOfPlane ? 'K를 판을 따라 (화면 안)' : 'K를 화면 수직으로 (⊙/⊗)' }];
  }
  return [];
}

export function actionPatch(source, plane, actionId) {
  const { a, n } = planeBasis(plane);
  if (source.type === 'loop' && actionId === 'toggle-axis') {
    return { normal: Math.abs(dot3(source.normal, n)) > 0.99 ? a : n };
  }
  if (source.type === 'sheet' && actionId === 'toggle-k') {
    const line = sheetLineDirection(source, plane);
    if (!line) return null;
    const outOfPlane = Math.abs(dot3(source.direction, n)) >= 0.5, sign = Math.sign(dot3(source.direction, outOfPlane ? n : line)) || 1;
    return { direction: scale3(outOfPlane ? line : n, sign) };
  }
  return null;
}

/** Patch that moves a whole source by (da, db) metres in the viewed plane (keyboard nudging). */
export function nudgePatch(source, plane, da, db) {
  const { a, b } = planeBasis(plane), move = vector => add3(vector, add3(scale3(a, da), scale3(b, db)));
  if (source.type === 'segment') return { start: move(source.start), end: move(source.end) };
  return { position: move(source.position) };
}

// In-plane distance from (u, v) to a source's picture: its point, its segment or its whole line.
function planeDistance(source, plane, u, v) {
  const { a, b } = planeBasis(plane), coords = point => [dot3(point, a), dot3(point, b)];
  const point = ([p, q]) => Math.hypot(p - u, q - v);
  if (source.type === 'segment') {
    const [x1, y1] = coords(source.start), [x2, y2] = coords(source.end), dx = x2 - x1, dy = y2 - y1, length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / length2)) : 0;
    return point([x1 + t * dx, y1 + t * dy]);
  }
  if (source.type === 'sheet') {
    const line = sheetLineDirection(source, plane);
    if (!line) return Infinity;
    const [x0, y0] = coords(source.position);
    return Math.abs((u - x0) * dot3(line, b) - (v - y0) * dot3(line, a));
  }
  return point(coords(source.position));
}

/** A free in-plane spot for a new source (3D point on the plane with the normal coordinate `fixed`). */
export function freeCurrentSpot(sources, plane, fixed, sensor, clearance = 0.7) {
  const { a, b, n } = planeBasis(plane);
  for (let i = 0; i < 80; i += 1) {
    const angle = i * 2.399963, radius = i === 0 ? 0 : 0.55 * Math.sqrt(i) + 0.4;
    const u = Math.cos(angle) * radius, v = Math.sin(angle) * radius;
    const clear = sources.every(source => planeDistance(source, plane, u, v) >= clearance)
      && Math.hypot(dot3(sensor, a) - u, dot3(sensor, b) - v) >= clearance;
    if (clear) return add3(add3(scale3(a, u), scale3(b, v)), scale3(n, fixed));
  }
  return scale3(n, fixed);
}

/** Template of a new source of `kind` at `spot` for the viewed plane. kind: 'out' | 'in' | 'loop' | 'sheet' | 'segment'. */
export function newSource(kind, plane, spot) {
  const { a, b, n } = planeBasis(plane);
  if (kind === 'out' || kind === 'in') return { type: 'wire', current: kind === 'out' ? 10 : -10, position: spot, direction: n };
  if (kind === 'segment') return { type: 'segment', current: 10, start: add3(spot, scale3(a, -0.75)), end: add3(spot, scale3(a, 0.75)) };
  if (kind === 'loop') return { type: 'loop', current: 10, position: spot, radius: 0.5, normal: a };
  return { type: 'sheet', K: 20, position: spot, normal: b, direction: n };
}

export const emptyNote = '도선·루프·판을 누르면 여기서 전류와 위치를 바꿀 수 있습니다.';

/** Center of a current source (a segment's midpoint, otherwise its base point). */
export const sourceCenter = source => (source.type === 'segment' ? source.start.map((value, i) => (value + source.end[i]) / 2) : source.position);
