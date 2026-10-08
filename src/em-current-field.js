// Magnetostatic sources of the plane sandbox and the field they make (Biot-Savart / Ampere superposition). Pure: no DOM.
//
// Source types (SI, 3D; "position" is a point of the source, directions are unit vectors):
//   wire     infinite straight wire:  { current (A), position, direction }        B = mu0 I / (2 pi rho) a_phi
//   segment  finite straight wire:    { current (A), start, end }                 B = mu0 I / (4 pi rho) (sin t2 - sin t1)
//   loop     circular current loop:   { current (A), position (centre), radius, normal }   closed-form elliptic integrals
//   sheet    infinite current sheet:  { K (A/m), position, normal, direction }    B = (mu0 K / 2) k x a_N  (a_N points at the field point)
// A positive current / K flows along +direction (wire, sheet) or counter-clockwise about +normal (loop) or start -> end (segment).
import { EXCLUSION_METERS, MU0, add3, createLoopSampler, cross3, dot3, loopCurrentField, norm3, scale3, sub3 } from './em-physics.js';
import { PointChargeInputError, inModelRange, validatePoint } from './em-playground-physics.js';

export const MAX_CURRENT_SOURCES = 16;
export const MAX_CURRENT = 100; // A
export const MAX_SHEET_K = 1000; // A/m
export const MIN_LOOP_RADIUS = 0.05;
export const MAX_LOOP_RADIUS = 5;
export const MIN_SEGMENT_LENGTH = 1e-3;
export const CURRENT_TYPES = Object.freeze(['wire', 'segment', 'loop', 'sheet']);

export const strengthOf = source => (source.type === 'sheet' ? source.K : source.current);
export const strengthUnit = source => (source.type === 'sheet' ? 'A/m' : 'A');
export const isActive = source => source.enabled !== false && strengthOf(source) !== 0;

function finite(value, label) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) throw new PointChargeInputError(`${label}은(는) 빈값일 수 없습니다.`);
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new PointChargeInputError(`${label}은(는) 유한한 숫자여야 합니다.`);
  return number;
}

function unitVector(vector, label) {
  validateVector(vector, label);
  const length = norm3(vector);
  if (!(length > 0)) throw new PointChargeInputError(`${label} 방향은 0일 수 없습니다.`, 'DEGENERATE_SOURCE');
  return vector.map(value => value / length);
}

function validateVector(vector, label) {
  if (!Array.isArray(vector) || vector.length !== 3) throw new PointChargeInputError(`${label}는 xyz 세 성분이어야 합니다.`);
  vector.forEach((value, i) => finite(value, `${label} ${'xyz'[i]}`));
}

/** Validate and normalise a list of current sources (throws PointChargeInputError). Returns fresh objects. */
export function validateCurrentSources(sources) {
  if (!Array.isArray(sources)) throw new PointChargeInputError('전류 원천 목록이 필요합니다.');
  if (sources.length > MAX_CURRENT_SOURCES) throw new PointChargeInputError(`전류 원천은 최대 ${MAX_CURRENT_SOURCES}개입니다.`, 'TOO_MANY_SOURCES');
  const ids = new Set();
  return sources.map((source, index) => {
    const id = String(source?.id ?? '');
    if (!id || ids.has(id)) throw new PointChargeInputError(`전류 원천 ${index + 1}의 ID가 비었거나 중복됩니다.`, 'INVALID_ID');
    ids.add(id);
    const type = source.type;
    if (!CURRENT_TYPES.includes(type)) throw new PointChargeInputError(`알 수 없는 전류 원천 type: ${type}`, 'UNKNOWN_SOURCE');
    const common = { id, type, enabled: source.enabled !== false, visible: source.visible !== false };
    if (type === 'sheet') {
      const K = finite(source.K, `면전류 ${id}의 K`);
      if (Math.abs(K) > MAX_SHEET_K) throw new PointChargeInputError(`면전류 ${id}의 K는 ±${MAX_SHEET_K} A/m 범위여야 합니다.`, 'OUT_OF_RANGE');
      const normal = unitVector(source.normal, `면전류 ${id} 법선`);
      const raw = unitVector(source.direction, `면전류 ${id} K`);
      const along = dot3(raw, normal), flat = sub3(raw, scale3(normal, along));
      if (!(norm3(flat) > 1e-9)) throw new PointChargeInputError(`면전류 ${id}의 K 방향은 판 안에 있어야 합니다.`, 'DEGENERATE_SOURCE');
      return { ...common, K, position: validatePoint(source.position, `면전류 ${id} 기준점`), normal, direction: scale3(flat, 1 / norm3(flat)) };
    }
    const current = finite(source.current, `전류 ${id}의 I`);
    if (Math.abs(current) > MAX_CURRENT) throw new PointChargeInputError(`전류 ${id}의 I는 ±${MAX_CURRENT} A 범위여야 합니다.`, 'OUT_OF_RANGE');
    if (type === 'wire') {
      return { ...common, current, position: validatePoint(source.position, `도선 ${id} 기준점`), direction: unitVector(source.direction, `도선 ${id}`) };
    }
    if (type === 'segment') {
      const start = validatePoint(source.start, `유한 도선 ${id} 시작점`), end = validatePoint(source.end, `유한 도선 ${id} 끝점`);
      if (norm3(sub3(end, start)) < MIN_SEGMENT_LENGTH) throw new PointChargeInputError(`유한 도선 ${id}의 길이는 1 mm 이상이어야 합니다.`, 'DEGENERATE_SOURCE');
      return { ...common, current, start, end };
    }
    const radius = finite(source.radius, `루프 ${id}의 반지름`);
    if (radius < MIN_LOOP_RADIUS || radius > MAX_LOOP_RADIUS) {
      throw new PointChargeInputError(`루프 ${id}의 반지름은 ${MIN_LOOP_RADIUS}…${MAX_LOOP_RADIUS} m 범위여야 합니다.`, 'OUT_OF_RANGE');
    }
    return { ...common, current, radius, position: validatePoint(source.position, `루프 ${id} 중심`), normal: unitVector(source.normal, `루프 ${id} 법선`) };
  });
}

const excluded = (source, what) => ({ status: 'excluded', B: null, sourceId: source.id, reason: `${what} ${source.id}의 모델 제외영역` });

/** B (T) of an infinite wire: mu0 I / (2 pi rho) in the direction d x rho_hat. */
export function wireField(source, point) {
  const delta = sub3(point, source.position), axial = dot3(delta, source.direction);
  const radial = sub3(delta, scale3(source.direction, axial)), rho = norm3(radial);
  if (rho <= EXCLUSION_METERS) return excluded(source, '무한 직선전류 축 1 mm');
  return { status: 'valid', B: scale3(cross3(source.direction, radial), MU0 * source.current / (2 * Math.PI * rho * rho)) };
}

/** B (T) of a finite straight wire (start -> end): mu0 I / (4 pi rho) (cos a1 + cos a2). Zero on its own line beyond the ends. */
export function segmentField(source, point) {
  const axis = sub3(source.end, source.start), length = norm3(axis), u = scale3(axis, 1 / length);
  const delta = sub3(point, source.start), t = dot3(delta, u), radial = sub3(delta, scale3(u, t)), rho = norm3(radial);
  if (Math.hypot(rho, Math.max(0, -t, t - length)) <= EXCLUSION_METERS) return excluded(source, '유한 직선전류 1 mm');
  if (!(rho > 1e-12)) return { status: 'valid', B: [0, 0, 0] };
  const magnitude = MU0 * source.current / (4 * Math.PI * rho)
    * ((length - t) / Math.hypot(rho, length - t) + t / Math.hypot(rho, t));
  return { status: 'valid', B: scale3(cross3(u, radial), magnitude / rho) };
}

/** B (T) of an infinite current sheet: (mu0 K / 2) k x a_N on the side of the point. Excluded within 1 mm of the sheet. */
export function sheetField(source, point) {
  const h = dot3(sub3(point, source.position), source.normal);
  if (Math.abs(h) <= EXCLUSION_METERS) return excluded(source, '면전류 판 1 mm');
  const aN = scale3(source.normal, Math.sign(h));
  return { status: 'valid', B: scale3(cross3(source.direction, aN), MU0 * source.K / 2) };
}

/** B (T) of a circular loop: the closed form of em-physics with its 0.02 R wire exclusion zone. */
export function loopField(source, point) {
  const result = loopCurrentField({ current: source.current, center: source.position, radius: source.radius, normal: source.normal }, point);
  return result.status === 'valid' ? { status: 'valid', B: result.B } : excluded(source, '전류 루프 도선');
}

const FIELD_OF = { wire: wireField, segment: segmentField, sheet: sheetField, loop: loopField };

/**
 * Superposition evaluator over validated sources: point => { status, B } (B in tesla). Disabled and zero sources are skipped;
 * a point inside any model exclusion zone is { status: 'excluded' }. `skipId` leaves one source out (field of the others).
 */
export function createCurrentEvaluator(sources, { skipId = null } = {}) {
  const active = sources.filter(source => isActive(source) && source.id !== skipId);
  return point => {
    let B = [0, 0, 0];
    for (const source of active) {
      const part = FIELD_OF[source.type](source, point);
      if (part.status !== 'valid') return part;
      B = add3(B, part.B);
    }
    return { status: 'valid', B };
  };
}

// ---- allocation-free sampling for pictures (same arithmetic, same order as the functions above: bit-identical) ----------

function wirePart({ position: [px, py, pz], direction: [ux, uy, uz], current }) {
  return (x, y, z, out) => {
    const d0 = x - px, d1 = y - py, d2 = z - pz, axial = d0 * ux + d1 * uy + d2 * uz;
    const r0 = d0 - ux * axial, r1 = d1 - uy * axial, r2 = d2 - uz * axial, rho = Math.hypot(r0, r1, r2);
    if (rho <= EXCLUSION_METERS) return false;
    const k = MU0 * current / (2 * Math.PI * rho * rho);
    out[0] = (uy * r2 - uz * r1) * k; out[1] = (uz * r0 - ux * r2) * k; out[2] = (ux * r1 - uy * r0) * k;
    return true;
  };
}

function segmentPart({ start, end, current }) {
  const axis = sub3(end, start), length = norm3(axis), [u0, u1, u2] = scale3(axis, 1 / length), [sx, sy, sz] = start;
  return (x, y, z, out) => {
    const d0 = x - sx, d1 = y - sy, d2 = z - sz, t = d0 * u0 + d1 * u1 + d2 * u2;
    const r0 = d0 - u0 * t, r1 = d1 - u1 * t, r2 = d2 - u2 * t, rho = Math.hypot(r0, r1, r2);
    if (Math.hypot(rho, Math.max(0, -t, t - length)) <= EXCLUSION_METERS) return false;
    if (!(rho > 1e-12)) { out[0] = 0; out[1] = 0; out[2] = 0; return true; }
    const magnitude = MU0 * current / (4 * Math.PI * rho)
      * ((length - t) / Math.hypot(rho, length - t) + t / Math.hypot(rho, t));
    const k = magnitude / rho;
    out[0] = (u1 * r2 - u2 * r1) * k; out[1] = (u2 * r0 - u0 * r2) * k; out[2] = (u0 * r1 - u1 * r0) * k;
    return true;
  };
}

function sheetPart({ position: [px, py, pz], normal: [n0, n1, n2], direction: [k0, k1, k2], K }) {
  const size = MU0 * K / 2;
  return (x, y, z, out) => {
    const h = (x - px) * n0 + (y - py) * n1 + (z - pz) * n2;
    if (Math.abs(h) <= EXCLUSION_METERS) return false;
    const sign = Math.sign(h), a0 = n0 * sign, a1 = n1 * sign, a2 = n2 * sign;
    out[0] = (k1 * a2 - k2 * a1) * size; out[1] = (k2 * a0 - k0 * a2) * size; out[2] = (k0 * a1 - k1 * a0) * size;
    return true;
  };
}

function loopPart(source) {
  try {
    return createLoopSampler({ current: source.current, center: source.position, radius: source.radius, normal: source.normal });
  } catch { return () => false; } // a loop the model refuses has no field anywhere (loopField throws for every point)
}

const PART_OF = { wire: wirePart, segment: segmentPart, sheet: sheetPart, loop: loopPart };

/**
 * One entry per active source in source order: { key, at(x, y, z, out) } where `at` writes that source's B (out[0..2], tesla)
 * and returns false inside its exclusion zone. `key` changes whenever the source does. `sources` must be validated.
 */
export function currentParts(sources) {
  return sources.filter(isActive).map(source => ({ key: JSON.stringify(source), at: PART_OF[source.type](source) }));
}

/** (x, y, z, out) => boolean: total B into out[0..2] and |B| into out[3]; same numbers as createCurrentPlaneField's evaluate. */
export function createCurrentSampler(sources, parts = currentParts(sources)) {
  const ats = parts.map(part => part.at), one = new Float64Array(4);
  return (x, y, z, out) => {
    if (!inModelRange(x, y, z)) return false;
    let b0 = 0, b1 = 0, b2 = 0;
    for (const at of ats) {
      if (!at(x, y, z, one)) return false;
      b0 += one[0]; b1 += one[1]; b2 += one[2];
    }
    out[0] = b0; out[1] = b1; out[2] = b2; out[3] = Math.hypot(b0, b1, b2);
    return true;
  };
}

/** Total B (T) at a point, or null where a model exclusion zone makes it undefined. */
export function currentFieldAt(sources, point, options) {
  const result = createCurrentEvaluator(sources, options)(point);
  return result.status === 'valid' ? result.B : null;
}

/** H = B / mu0 (A/m, vacuum). The magnetic field strength is the "source" quantity of Ampere's law. */
export const hFromB = B => scale3(B, 1 / MU0);

/**
 * One test for "does this infinite wire pierce the viewed plane?", used by the Ampere loop (which counts the pierced current), the
 * field-line seeds and the dot / cross symbol, so what the picture shows is what I_enc counts. A wire with any component along the
 * normal meets the plane at exactly one point; only a wire exactly in the plane (to rounding) does not.
 */
export const WIRE_PIERCE_MIN = 1e-9;
export const wirePierces = (direction, normal) => Math.abs(dot3(direction, normal)) > WIRE_PIERCE_MIN;

/** The point where an infinite wire meets the viewed plane (normal coordinate = fixed), or null for a wire lying in the plane. */
export function wireHit(source, plane, fixed) {
  const { n, axes } = planeBasis(plane), normal = 3 - axes[0] - axes[1];
  if (!wirePierces(source.direction, n)) return null;
  const t = (fixed - source.position[normal]) / source.direction[normal];
  return source.position.map((value, i) => value + t * source.direction[i]);
}

/** Sign (+1 out of the screen / -1 into it / 0 in the plane) of a source current seen in a view with normal `viewNormalVector`. */
export function screenSense(source, viewNormalVector) {
  const direction = source.type === 'wire' || source.type === 'sheet' ? source.direction : source.type === 'loop' ? source.normal : null;
  if (!direction) return 0;
  const along = dot3(direction, viewNormalVector);
  if (source.type === 'wire' ? !wirePierces(direction, viewNormalVector) : Math.abs(along) < 0.5) return 0;
  return Math.sign(strengthOf(source) * along);
}

/** Plane-view field object (same shape as the sandbox / scene fields of em-plane-field): kind 'current', vector = B in tesla. */
export function createCurrentPlaneField(sources) {
  const evaluator = createCurrentEvaluator(sources), parts = currentParts(sources);
  return {
    kind: 'current', electric: false, unit: 1, scalarName: '|B|', magnetic: true,
    // Fast paths for the picture (em-plane-field): the same numbers without per-point arrays, and one part per source so the
    // colour grid can keep the contributions of the sources that did not move. The scalar of the sum is |sum of B|.
    sample: createCurrentSampler(sources, parts), parts, inRange: inModelRange, scalarOfSum: 'magnitude',
    evaluate(point) {
      let result;
      try { result = evaluator(validatePoint(point, '측정점')); } catch { return { status: 'excluded', vector: null, scalar: NaN }; }
      return result.status === 'valid'
        ? { status: 'valid', vector: result.B, scalar: norm3(result.B) } : { status: 'excluded', vector: null, scalar: NaN, reason: result.reason };
    },
  };
}

// ---- view helpers ------------------------------------------------------------------------------------------------------

const PLANE_AXES = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };
const unitAxis = index => [0, 0, 0].map((_, i) => (i === index ? 1 : 0));

/** { a, b, n } unit vectors of a view plane: a to the right, b up, n = a x b toward the viewer (xz looks from -y). */
export function planeBasis(plane) {
  const [ia, ib] = PLANE_AXES[plane] ?? PLANE_AXES.xy, a = unitAxis(ia), b = unitAxis(ib);
  return { a, b, n: cross3(a, b), axes: [ia, ib] };
}

/** The direction toward the viewer: a current along it shows as a dot, against it as a cross. */
export const viewNormal = plane => planeBasis(plane).n;

/** Unit direction (in the viewed plane) of the line a sheet makes with the plane, or null for a sheet parallel to the view. */
export function sheetLineDirection(source, plane) {
  const line = cross3(viewNormal(plane), source.normal), length = norm3(line);
  return length > 1e-9 ? scale3(line, 1 / length) : null;
}

/** 3D angle helper: a unit vector at `degrees` from the plane's a axis toward its b axis. */
export function inPlaneDirection(plane, degrees) {
  const { a, b } = planeBasis(plane), radians = degrees * Math.PI / 180;
  return add3(scale3(a, Math.cos(radians)), scale3(b, Math.sin(radians)));
}

/** Angle (degrees, 0...360) of a vector's in-plane part from the a axis toward b. */
export function inPlaneAngle(plane, vector) {
  const { a, b } = planeBasis(plane), degrees = Math.atan2(dot3(vector, b), dot3(vector, a)) * 180 / Math.PI;
  return (degrees + 360) % 360;
}

/** Right-handed unit vectors e1, e2 spanning the plane of a circle with the given unit normal (counter-clockwise about it). */
export function circleBasis(normal) {
  const seed = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], raw = cross3(seed, normal), e1 = scale3(raw, 1 / norm3(raw));
  return { e1, e2: cross3(normal, e1) };
}
