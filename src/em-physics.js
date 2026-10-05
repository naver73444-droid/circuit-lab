export const C = 299792458;
export const MU0 = 1.25663706127e-6;
export const EPS0 = 1 / (MU0 * C * C);
export const K = 1 / (4 * Math.PI * EPS0);
export const EXCLUSION_METERS = 1e-3;

const v = (x = 0, y = 0, z = 0) => [x, y, z];
export const add3 = (a, b) => v(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
export const sub3 = (a, b) => v(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const scale3 = (a, s) => v(a[0] * s, a[1] * s, a[2] * s);
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => v(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
export const norm3 = a => Math.hypot(a[0], a[1], a[2]);
export const unit3 = a => { const n = norm3(a); if (!Number.isFinite(n) || n === 0) throw new EMInputError('방향 벡터는 0일 수 없습니다.'); return scale3(a, 1 / n); };

export class EMInputError extends Error {
  constructor(message, code = 'INVALID_INPUT') { super(message); this.name = 'EMInputError'; this.code = code; }
}

const finite = (value, label) => {
  if (value == null || (typeof value === 'string' && !value.trim())) throw new EMInputError(`${label}은(는) 빈값일 수 없습니다.`);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new EMInputError(`${label}은(는) 유한한 숫자여야 합니다.`);
  return n;
};

export function coordinate(value, label = '좌표') {
  const n = finite(value, label);
  if (Math.abs(n) > 20) throw new EMInputError(`${label}은(는) -20…20 m 범위여야 합니다.`, 'OUT_OF_RANGE');
  return n;
}

export function pointChargesField(charges, point) {
  const p = point.map((x, i) => coordinate(x, `${'xyz'[i]} 좌표`));
  if (!Array.isArray(charges) || charges.length > 2) throw new EMInputError('점전하는 최대 2개입니다.');
  let E = v(), potential = 0;
  for (const source of charges) {
    const q = finite(source.q, '전하량');
    if (Math.abs(q) > 1e-6) throw new EMInputError('전하량은 ±1 µC 범위여야 합니다.', 'OUT_OF_RANGE');
    const position = source.position.map((x, i) => coordinate(x, `전하 ${'xyz'[i]}`));
    if (q === 0) continue;
    const r = sub3(p, position), distance = norm3(r);
    if (distance <= EXCLUSION_METERS) return { status: 'excluded', reason: '점전하 1 mm 모델 제외영역', E: null, potential: null };
    E = add3(E, scale3(r, K * q / distance ** 3));
    potential += K * q / distance;
  }
  return { status: 'valid', E, potential };
}

export function dipoleField({ q, separation, axis = [1, 0, 0], center = [0, 0, 0] }, point) {
  const d = finite(separation, '쌍극자 간격');
  if (d < .01 || d > 10) throw new EMInputError('쌍극자 간격은 0.01…10 m 범위여야 합니다.', 'OUT_OF_RANGE');
  const u = unit3(axis), half = scale3(u, d / 2);
  return pointChargesField([
    { q: finite(q, '전하량'), position: add3(center, half) },
    { q: -finite(q, '전하량'), position: sub3(center, half) },
  ], point);
}

export function lineCurrentField({ current, position = [0, 0, 0], direction = [0, 0, 1] }, point) {
  const I = finite(current, '전류');
  if (Math.abs(I) > 100) throw new EMInputError('전류는 ±100 A 범위여야 합니다.', 'OUT_OF_RANGE');
  const p = point.map((x, i) => coordinate(x, `${'xyz'[i]} 좌표`));
  if (I === 0) return { status: 'valid', B: v() };
  const u = unit3(direction), delta = sub3(p, position);
  const rho = sub3(delta, scale3(u, dot3(u, delta))), distance = norm3(rho);
  if (distance <= EXCLUSION_METERS) return { status: 'excluded', reason: '무한 직선전류 축 1 mm 모델 제외영역', B: null };
  return { status: 'valid', B: scale3(cross3(u, rho), MU0 * I / (2 * Math.PI * distance ** 2)) };
}

function loopBasis(normal) {
  const n = unit3(normal);
  const seed = Math.abs(n[2]) < .9 ? [0, 0, 1] : [0, 1, 0];
  const e1 = unit3(cross3(seed, n));
  return { n, e1, e2: cross3(n, e1) };
}

export function loopWireDistance({ center = [0, 0, 0], radius, normal = [0, 0, 1] }, point) {
  const R = finite(radius, '고리 반지름');
  const n = unit3(normal), d = sub3(point, center), axial = dot3(d, n);
  const radial = norm3(sub3(d, scale3(n, axial)));
  return Math.hypot(radial - R, axial);
}

export function loopFieldAtN({ current, center = [0, 0, 0], radius, normal = [0, 0, 1] }, point, count) {
  const I = finite(current, '전류'), R = finite(radius, '고리 반지름');
  if (Math.abs(I) > 100) throw new EMInputError('전류는 ±100 A 범위여야 합니다.', 'OUT_OF_RANGE');
  if (R < .05 || R > 5) throw new EMInputError('고리 반지름은 0.05…5 m 범위여야 합니다.', 'OUT_OF_RANGE');
  if (I === 0) return v();
  const { e1, e2 } = loopBasis(normal), dtheta = 2 * Math.PI / count;
  let sum = v();
  for (let i = 0; i < count; i++) {
    const theta = (i + .5) * dtheta, cs = Math.cos(theta), sn = Math.sin(theta);
    const source = add3(center, scale3(add3(scale3(e1, cs), scale3(e2, sn)), R));
    const dl = scale3(add3(scale3(e1, -sn), scale3(e2, cs)), R * dtheta);
    const delta = sub3(point, source), distance = norm3(delta);
    sum = add3(sum, scale3(cross3(dl, delta), 1 / distance ** 3));
  }
  return scale3(sum, MU0 * I / (4 * Math.PI));
}

export function loopCurrentField(model, point) {
  const p = point.map((x, i) => coordinate(x, `${'xyz'[i]} 좌표`));
  const R = finite(model.radius, '고리 반지름');
  const exclusion = Math.max(EXCLUSION_METERS, .02 * R);
  if (finite(model.current, '전류') !== 0 && loopWireDistance(model, p) <= exclusion) {
    return { status: 'excluded', reason: `고리 도선 ${exclusion.toPrecision(3)} m 모델 제외영역`, B: null };
  }
  let previous = null, difference = null, B = v(), samples = 64;
  for (samples = 64; samples <= 1024; samples *= 2) {
    B = loopFieldAtN(model, p, samples);
    if (previous) {
      difference = norm3(sub3(B, previous));
      if (difference <= 1e-12 + 1e-3 * norm3(B)) return { status: 'valid', B, samples, difference, converged: true };
    }
    previous = B;
  }
  return { status: 'approximate-unconverged', B, samples: 1024, difference, converged: false };
}

export function planeWaveField({ amplitude, frequency, phase = 0, direction = [0, 0, 1], polarization = [1, 0, 0] }, point, time) {
  const E0 = finite(amplitude, 'E peak'), f = finite(frequency, '주파수'), t = finite(time, '시간');
  if (E0 < 0 || E0 > 1000) throw new EMInputError('E peak는 0…1000 V/m 범위여야 합니다.', 'OUT_OF_RANGE');
  if (f < 1 || f > 1e9) throw new EMInputError('주파수는 1…1e9 Hz 범위여야 합니다.', 'OUT_OF_RANGE');
  const kHat = unit3(direction), rawE = sub3(polarization, scale3(kHat, dot3(polarization, kHat)));
  const eHat = unit3(rawE), omega = 2 * Math.PI * f, lambda = C / f;
  const psi = (omega / C) * dot3(kHat, point) - omega * t + finite(phase, '위상');
  const E = scale3(eHat, E0 * Math.cos(psi));
  return { status: 'valid', E, B: scale3(cross3(kHat, E), 1 / C), wavelength: lambda, period: 1 / f, phase: psi };
}

export function sceneMeasurement(scene, point, time = 0) {
  switch (scene.kind) {
    case 'charge': return pointChargesField([{ q: scene.q, position: scene.position }], point);
    case 'dipole': return dipoleField(scene, point);
    case 'line': return lineCurrentField(scene, point);
    case 'loop': return loopCurrentField(scene, point);
    case 'wave': return planeWaveField(scene, point, time);
    default: throw new EMInputError('알 수 없는 전자기학 장면입니다.');
  }
}
