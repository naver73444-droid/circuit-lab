import { EXCLUSION_METERS, K } from './em-physics.js';

export const MAX_POINT_SOURCES = 16;
export const MAX_COORDINATE_METERS = 20;
export const MAX_CHARGE_COULOMBS = 1e-6;
export const MAX_LINE_DENSITY = 1e-6;
export const MIN_LINE_LENGTH = 1e-6;

export class PointChargeInputError extends Error {
  constructor(message, code = 'INVALID_INPUT') {
    super(message);
    this.name = 'PointChargeInputError';
    this.code = code;
  }
}

function finite(value, label) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    throw new PointChargeInputError(`${label}은(는) 빈값일 수 없습니다.`);
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new PointChargeInputError(`${label}은(는) 유한한 숫자여야 합니다.`);
  return number;
}

export function validatePoint(position, label = '좌표') {
  if (!Array.isArray(position) || position.length !== 3) throw new PointChargeInputError(`${label}는 xyz 세 성분이어야 합니다.`);
  return position.map((value, index) => {
    const number = finite(value, `${label} ${'xyz'[index]}`);
    if (Math.abs(number) > MAX_COORDINATE_METERS) throw new PointChargeInputError(`${label}는 각 축 ±20 m 범위여야 합니다.`, 'OUT_OF_RANGE');
    return number;
  });
}

const vectorLength = vector => Math.hypot(...vector);
const unit = (vector, label) => {
  const length = vectorLength(vector);
  if (!Number.isFinite(length) || length === 0) throw new PointChargeInputError(`${label} 방향은 0일 수 없습니다.`);
  return vector.map(value => value / length);
};

export function validatePointSources(sources) {
  if (!Array.isArray(sources)) throw new PointChargeInputError('점전하 목록이 필요합니다.');
  if (sources.length > MAX_POINT_SOURCES) throw new PointChargeInputError(`점전하는 최대 ${MAX_POINT_SOURCES}개입니다.`, 'TOO_MANY_SOURCES');
  const ids = new Set();
  return sources.map((source, index) => {
    const id = String(source?.id ?? '');
    if (!id || ids.has(id)) throw new PointChargeInputError(`점전하 ${index + 1}의 ID가 비었거나 중복됩니다.`, 'INVALID_ID');
    ids.add(id);
    const type = source.type ?? 'point';
    const common = { id, type, enabled: source.enabled !== false, visible: source.visible !== false };
    if (type === 'point') {
      const q = finite(source.q, `점전하 ${id}의 q`);
      if (Math.abs(q) > MAX_CHARGE_COULOMBS) throw new PointChargeInputError(`점전하 ${id}의 q는 ±1 µC 범위여야 합니다.`, 'OUT_OF_RANGE');
      return { ...common, q, position: validatePoint(source.position, `점전하 ${id} 좌표`) };
    }
    const lambda = finite(source.lambda, `선전하 ${id}의 λ`);
    if (Math.abs(lambda) > MAX_LINE_DENSITY) throw new PointChargeInputError(`선전하 ${id}의 λ는 ±1 µC/m 범위여야 합니다.`, 'OUT_OF_RANGE');
    if (type === 'finite-line') {
      const start = validatePoint(source.start, `유한선 ${id} 시작점`), end = validatePoint(source.end, `유한선 ${id} 끝점`);
      if (vectorLength(end.map((value, axis) => value - start[axis])) < MIN_LINE_LENGTH) throw new PointChargeInputError(`유한선 ${id}의 길이는 1 µm 이상이어야 합니다.`, 'DEGENERATE_SOURCE');
      return { ...common, lambda, start, end };
    }
    if (type === 'infinite-line') {
      const position = validatePoint(source.position, `무한선 ${id} 기준점`), direction = unit(validatePoint(source.direction, `무한선 ${id} 방향`), `무한선 ${id}`);
      const sRef = finite(source.sRef, `무한선 ${id}의 s_ref`), displayLength = finite(source.displayLength ?? 4, `무한선 ${id}의 표시 길이`);
      if (sRef < .001 || sRef > 20) throw new PointChargeInputError(`무한선 ${id}의 s_ref는 0.001…20 m 범위여야 합니다.`, 'OUT_OF_RANGE');
      if (displayLength < .1 || displayLength > 20) throw new PointChargeInputError(`무한선 ${id}의 표시 길이는 0.1…20 m 범위여야 합니다.`, 'OUT_OF_RANGE');
      return { ...common, lambda, position, direction, sRef, displayLength };
    }
    throw new PointChargeInputError(`알 수 없는 원천 type: ${type}`, 'UNKNOWN_SOURCE');
  });
}

export const validateEMSources = validatePointSources;

const segmentDistance = (point, start, direction, length) => {
  const delta = point.map((value, axis) => value - start[axis]), t = delta.reduce((sum, value, axis) => sum + value * direction[axis], 0), clamped = Math.max(0, Math.min(length, t));
  return { t, distance: vectorLength(delta.map((value, axis) => value - clamped * direction[axis])) };
};

export function finiteLineChargeField(source, point) {
  const deltaLine = source.end.map((value, axis) => value - source.start[axis]), length = vectorLength(deltaLine), u = deltaLine.map(value => value / length);
  const delta = point.map((value, axis) => value - source.start[axis]), t = delta.reduce((sum, value, axis) => sum + value * u[axis], 0), w = delta.map((value, axis) => value - t * u[axis]), rho = vectorLength(w);
  const nearest = segmentDistance(point, source.start, u, length);
  if (nearest.distance <= EXCLUSION_METERS) return { status: 'excluded', reason: `유한 선전하 ${source.id}의 1 mm 모델 제외영역`, sourceId: source.id };
  const factor = K * source.lambda;
  if (rho === 0) {
    if (t > length) return { status: 'valid', E: u.map(value => factor * (1 / (t - length) - 1 / t) * value), potential: factor * Math.log(t / (t - length)) };
    if (t < 0) return { status: 'valid', E: u.map(value => factor * (1 / (length - t) - 1 / (-t)) * value), potential: factor * Math.log((length - t) / (-t)) };
  }
  const r0 = Math.hypot(rho, t), d = t - length, r1 = Math.hypot(rho, d);
  let radialCoefficient;
  if (t > length) radialCoefficient = length * (2 * t - length) / ((t * r1 + d * r0) * r0 * r1);
  else if (t < 0) { const a = -t, b = length - t; radialCoefficient = length * (length - 2 * t) / ((b * r0 + a * r1) * r0 * r1); }
  else radialCoefficient = (t / r0 - d / r1) / (rho * rho);
  const axialCoefficient = length * (2 * t - length) / ((r0 + r1) * r0 * r1);
  const potential = factor * (t > length ? Math.log((t + r0) / (d + r1)) : t < 0 ? Math.log((length - t + r1) / (-t + r0)) : Math.asinh(t / rho) - Math.asinh(d / rho));
  return { status: 'valid', E: w.map((value, axis) => factor * (radialCoefficient * value + axialCoefficient * u[axis])), potential };
}

export function infiniteLineChargeField(source, point) {
  const delta = point.map((value, axis) => value - source.position[axis]), axial = delta.reduce((sum, value, axis) => sum + value * source.direction[axis], 0), rhoVector = delta.map((value, axis) => value - axial * source.direction[axis]), rho = vectorLength(rhoVector);
  if (rho <= EXCLUSION_METERS) return { status: 'excluded', reason: `무한 선전하 ${source.id}의 1 mm 모델 제외영역`, sourceId: source.id };
  const factor = K * source.lambda;
  return { status: 'valid', E: rhoVector.map(value => 2 * factor * value / (rho * rho)), potential: -2 * factor * Math.log(rho / source.sRef) };
}

export function evaluatePointChargeWorld(sources, point) {
  const validated = validatePointSources(sources);
  const p = validatePoint(point, '측정점');
  const E = [0, 0, 0];
  const jacobian = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let potential = 0;
  for (const source of validated) {
    const strength = source.type === 'point' ? source.q : source.lambda;
    if (!source.enabled || strength === 0) continue;
    if (source.type !== 'point') {
      const contribution = source.type === 'finite-line' ? finiteLineChargeField(source, p) : infiniteLineChargeField(source, p);
      if (contribution.status !== 'valid') return { ...contribution, E: null, potential: null, gradV: null, jacobian: null };
      for (let axis = 0; axis < 3; axis += 1) E[axis] += contribution.E[axis];
      potential += contribution.potential;
      continue;
    }
    const R = p.map((value, index) => value - source.position[index]);
    const r = Math.hypot(...R);
    if (r <= EXCLUSION_METERS) {
      return {
        status: 'excluded',
        reason: `점전하 ${source.id}의 1 mm 모델 제외영역`,
        sourceId: source.id,
        E: null,
        potential: null,
        gradV: null,
        jacobian: null,
      };
    }
    const invR3 = 1 / r ** 3;
    const invR5 = 1 / r ** 5;
    const factor = K * source.q;
    potential += factor / r;
    for (let i = 0; i < 3; i += 1) {
      E[i] += factor * R[i] * invR3;
      for (let j = 0; j < 3; j += 1) {
        jacobian[i][j] += factor * ((i === j ? invR3 : 0) - 3 * R[i] * R[j] * invR5);
      }
    }
  }
  return {
    status: 'valid',
    E,
    potential,
    gradV: E.map(value => -value),
    jacobian,
  };
}

export function pointChargePlaneSample(sources, plane, fixedCoordinate, { grid = 25, span = 2 } = {}) {
  if (!['xy', 'xz', 'yz'].includes(plane)) throw new PointChargeInputError('편집 평면은 XY, XZ, YZ 중 하나여야 합니다.');
  const fixed = finite(fixedCoordinate, '평면 고정 좌표');
  const values = [];
  let maxAbsPotential = 0;
  let maxField = 0;
  for (let row = 0; row < grid; row += 1) {
    for (let column = 0; column < grid; column += 1) {
      const a = -span + 2 * span * column / (grid - 1);
      const b = span - 2 * span * row / (grid - 1);
      const point = plane === 'xy' ? [a, b, fixed] : plane === 'xz' ? [a, fixed, b] : [fixed, a, b];
      const result = evaluatePointChargeWorld(sources, point);
      const item = { point, result };
      values.push(item);
      if (result.status === 'valid') {
        maxAbsPotential = Math.max(maxAbsPotential, Math.abs(result.potential));
        maxField = Math.max(maxField, Math.hypot(...result.E));
      }
    }
  }
  return { plane, fixedCoordinate: fixed, grid, span, values, maxAbsPotential, maxField };
}
