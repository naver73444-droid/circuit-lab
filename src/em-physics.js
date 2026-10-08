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

// ---- closed-form loop field --------------------------------------------------------------------------------------------
// A circular loop has an exact field in complete elliptic integrals (cylindrical coordinates about the loop axis):
//   B_z   = mu0 I / (2 pi) / sqrt((a+rho)^2+z^2) * [ K(m) + (a^2-rho^2-z^2) / ((a-rho)^2+z^2) * E(m) ]
//   B_rho = mu0 I / (2 pi) * z / (rho sqrt((a+rho)^2+z^2)) * [ (a^2+rho^2+z^2) / ((a-rho)^2+z^2) * E(m) - K(m) ]
//   m = 4 a rho / ((a+rho)^2+z^2)
// K and E come from the arithmetic-geometric mean (a handful of iterations), so the cost of one point is constant and
// independent of how close it is to the wire.

/** Complete elliptic integrals K(m), E(m) by the AGM; kPrime = sqrt(1-m) is passed in so that m near 1 loses no digits. */
export function ellipticKE(m, kPrime) {
  let a = 1, b = kPrime, sum = 0.5 * m, power = 1;
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-16 * a; i++) {
    const next = (a + b) / 2, c = (a - b) / 2;
    b = Math.sqrt(a * b); a = next; power *= 2;
    sum += power / 2 * c * c;
  }
  const K = Math.PI / (2 * a);
  return { K, E: K * (1 - sum) };
}

const LOOP_AXIS_FRACTION = 1e-6; // closer to the axis than this fraction of the radius the on-axis series replaces the closed form

/** B (T) of the loop at `point`: exact, constant cost. The caller handles the wire exclusion zone. */
export function loopFieldClosedForm({ current, center = [0, 0, 0], radius, normal = [0, 0, 1] }, point) {
  const I = finite(current, '전류'), a = finite(radius, '고리 반지름');
  if (Math.abs(I) > 100) throw new EMInputError('전류는 ±100 A 범위여야 합니다.', 'OUT_OF_RANGE');
  if (a < .05 || a > 5) throw new EMInputError('고리 반지름은 0.05…5 m 범위여야 합니다.', 'OUT_OF_RANGE');
  if (I === 0) return v();
  const { n, e1, e2 } = loopBasis(normal), d = sub3(point, center);
  const z = dot3(d, n), x = dot3(d, e1), y = dot3(d, e2), rho = Math.hypot(x, y);
  const factor = MU0 * I / (2 * Math.PI);
  let bRho, bz;
  if (rho < LOOP_AXIS_FRACTION * a) {
    // On the axis B_z is the axis formula and B_rho ~ 3 mu0 I a^2 z rho / (4 (a^2+z^2)^(5/2)) to first order.
    const s2 = a * a + z * z;
    bz = MU0 * I * a * a / (2 * s2 ** 1.5);
    bRho = 3 * MU0 * I * a * a * z * rho / (4 * s2 ** 2.5);
  } else {
    const alpha2 = (a - rho) ** 2 + z * z, beta2 = (a + rho) ** 2 + z * z, beta = Math.sqrt(beta2);
    const { K: k, E: e } = ellipticKE(4 * a * rho / beta2, Math.sqrt(alpha2 / beta2));
    bz = factor / beta * (k + (a * a - rho * rho - z * z) / alpha2 * e);
    bRho = factor * z / (rho * beta) * ((a * a + rho * rho + z * z) / alpha2 * e - k);
  }
  const radial = rho > 0 ? [x / rho, y / rho] : [0, 0];
  return add3(scale3(n, bz), add3(scale3(e1, bRho * radial[0]), scale3(e2, bRho * radial[1])));
}

function loopExclusion(model, p) {
  const R = finite(model.radius, '고리 반지름');
  const exclusion = Math.max(EXCLUSION_METERS, .02 * R);
  if (finite(model.current, '전류') !== 0 && loopWireDistance(model, p) <= exclusion) {
    return { status: 'excluded', reason: `고리 도선 ${exclusion.toPrecision(3)} m 모델 제외영역`, B: null };
  }
  return null;
}

/** Loop field with the 0.02 R wire exclusion zone; exact (closed form), so it is cheap everywhere and always converged. */
export function loopCurrentField(model, point) {
  const p = point.map((x, i) => coordinate(x, `${'xyz'[i]} 좌표`));
  return loopExclusion(model, p) ?? { status: 'valid', B: loopFieldClosedForm(model, p), converged: true, closedForm: true };
}

/**
 * loopCurrentField for pictures that sample many points: (x, y, z, out) => boolean writes B into out[0..2] and returns false
 * inside the wire exclusion zone. The loop basis and the checks of the model are worked out once; per point the arithmetic is
 * that of loopExclusion + loopFieldClosedForm in the same order, so the numbers are bit-identical (tested). The caller keeps
 * the point within the ±20 m model range (loopCurrentField refuses points outside it).
 */
export function createLoopSampler({ current, center = [0, 0, 0], radius, normal = [0, 0, 1] }) {
  const I = finite(current, '전류'), a = finite(radius, '고리 반지름');
  if (Math.abs(I) > 100) throw new EMInputError('전류는 ±100 A 범위여야 합니다.', 'OUT_OF_RANGE');
  if (a < .05 || a > 5) throw new EMInputError('고리 반지름은 0.05…5 m 범위여야 합니다.', 'OUT_OF_RANGE');
  const { n: [n0, n1, n2], e1: [f0, f1, f2], e2: [g0, g1, g2] } = loopBasis(normal), [c0, c1, c2] = center;
  const exclusion = Math.max(EXCLUSION_METERS, .02 * a), factor = MU0 * I / (2 * Math.PI);
  return (px, py, pz, out) => {
    const d0 = px - c0, d1 = py - c1, d2 = pz - c2, z = d0 * n0 + d1 * n1 + d2 * n2;
    if (I !== 0 && Math.hypot(Math.hypot(d0 - n0 * z, d1 - n1 * z, d2 - n2 * z) - a, z) <= exclusion) return false;
    if (I === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return true; }
    const x = d0 * f0 + d1 * f1 + d2 * f2, y = d0 * g0 + d1 * g1 + d2 * g2, rho = Math.hypot(x, y);
    let bRho, bz;
    if (rho < LOOP_AXIS_FRACTION * a) {
      const s2 = a * a + z * z;
      bz = MU0 * I * a * a / (2 * s2 ** 1.5);
      bRho = 3 * MU0 * I * a * a * z * rho / (4 * s2 ** 2.5);
    } else {
      const alpha2 = (a - rho) ** 2 + z * z, beta2 = (a + rho) ** 2 + z * z, beta = Math.sqrt(beta2);
      const { K: k, E: e } = ellipticKE(4 * a * rho / beta2, Math.sqrt(alpha2 / beta2));
      bz = factor / beta * (k + (a * a - rho * rho - z * z) / alpha2 * e);
      bRho = factor * z / (rho * beta) * ((a * a + rho * rho + z * z) / alpha2 * e - k);
    }
    const r0 = rho > 0 ? x / rho : 0, r1 = rho > 0 ? y / rho : 0, s = bRho * r0, t = bRho * r1;
    out[0] = n0 * bz + (f0 * s + g0 * t); out[1] = n1 * bz + (f1 * s + g1 * t); out[2] = n2 * bz + (f2 * s + g2 * t);
    return true;
  };
}

/**
 * The converged numerical alternative (Biot-Savart segment sums, 64 -> 1024 segments until two passes agree). Kept as the
 * independent reference the closed form is tested against; it gets slow close to the wire.
 */
export function loopCurrentFieldNumeric(model, point) {
  const p = point.map((x, i) => coordinate(x, `${'xyz'[i]} 좌표`));
  const excluded = loopExclusion(model, p);
  if (excluded) return excluded;
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
