// Numerical differential and integral operators on a field function: central-difference Jacobian (div, curl),
// flux through a sphere and circulation around a circle, each with a coarse/fine convergence check.
// A field is point => { status, E }; `sources` lets the operators refuse geometry that touches a model exclusion zone.
import { cross3, dot3, norm3, scale3, add3 } from './em-physics.js';

const TOUCH = 0.001; // the 1 mm model exclusion zone around a source
const strengthOf = source => (source.type === 'point' ? source.q : source.lambda);
const active = source => source.enabled !== false && strengthOf(source) !== 0;
const sub = (a, b) => a.map((value, i) => value - b[i]);

/** Mathematical test fields: F = alpha r (radial) or F = alpha (-y, x, 0) (rotational). */
export const mathField = (mode, alpha = 1, origin = [0, 0, 0]) => point => {
  const [x, y, z] = sub(point, origin);
  return mode === 'radial'
    ? { status: 'valid', E: [alpha * x, alpha * y, alpha * z], potential: alpha * (x * x + y * y + z * z) / 2 }
    : { status: 'valid', E: [-alpha * y, alpha * x, 0], potential: null };
};

// ---- distances from a stencil segment to the sources -------------------------------------------------------------

const pointSegmentDistance = (p, a, b) => {
  const ab = sub(b, a), ap = sub(p, a), length2 = dot3(ab, ab);
  const t = length2 ? Math.max(0, Math.min(1, dot3(ap, ab) / length2)) : 0;
  return norm3(p.map((v, i) => v - a[i] - t * ab[i]));
};

const segmentSegmentDistance = (p1, q1, p2, q2) => {
  let minimum = Math.min(
    pointSegmentDistance(p1, p2, q2), pointSegmentDistance(q1, p2, q2),
    pointSegmentDistance(p2, p1, q1), pointSegmentDistance(q2, p1, q1),
  );
  const u = sub(q1, p1), v = sub(q2, p2), w = sub(p1, p2);
  const a = dot3(u, u), b = dot3(u, v), c = dot3(v, v), d = dot3(u, w), e = dot3(v, w), den = a * c - b * b;
  if (den > 1e-15) {
    const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) minimum = Math.min(minimum, norm3(w.map((x, i) => x + s * u[i] - t * v[i])));
  }
  return minimum;
};

const segmentInfiniteDistance = (a, b, p, u) => {
  const v = sub(b, a), w = sub(a, p), A = dot3(v, v), B = dot3(v, u), C = dot3(u, u), D = dot3(v, w), E = dot3(u, w);
  const den = A * C - B * B;
  const s = Math.max(0, Math.min(1, den ? (B * E - C * D) / den : 0)), t = (B * s + E) / C;
  return norm3(a.map((x, i) => x + s * v[i] - p[i] - t * u[i]));
};

const touches = (source, a, b) => {
  if (!active(source)) return false;
  if (source.type === 'point') return pointSegmentDistance(source.position, a, b) <= TOUCH;
  if (source.type === 'finite-line') return segmentSegmentDistance(a, b, source.start, source.end) <= TOUCH;
  return segmentInfiniteDistance(a, b, source.position, source.direction) <= TOUCH;
};

// ---- divergence and curl -----------------------------------------------------------------------------------------

/** Central-difference Jacobian at `point` with step h (0.0001...0.1 m); div and curl follow from it. */
export function differential3D(field, point, h = 0.005, sources = []) {
  if (!Number.isFinite(h) || h < 0.0001 || h > 0.1) throw new Error('미분 h는 0.0001…0.1 m여야 합니다.');
  if (point.some(value => !Number.isFinite(value) || Math.abs(value) + h > 20)) {
    return { status: 'excluded', reason: '미분 stencil이 좌표 범위를 벗어납니다.' };
  }
  const jacobian = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let axis = 0; axis < 3; axis++) {
    const plus = [...point], minus = [...point];
    plus[axis] += h;
    minus[axis] -= h;
    if (sources.some(source => touches(source, minus, plus))) {
      return { status: 'excluded', reason: '미분 stencil 구간이 source 제외영역을 가로지릅니다.' };
    }
    const a = field(plus), b = field(minus);
    if (a.status !== 'valid' || b.status !== 'valid') return { status: 'excluded', reason: '미분 stencil이 모델 제외영역을 가로지릅니다.' };
    for (let c = 0; c < 3; c++) jacobian[c][axis] = (a.E[c] - b.E[c]) / (2 * h);
  }
  const noiseScale = Math.max(...jacobian.flat().map(Math.abs));
  return {
    status: 'valid', jacobian, noiseScale, h,
    divergence: jacobian[0][0] + jacobian[1][1] + jacobian[2][2],
    curl: [jacobian[2][1] - jacobian[1][2], jacobian[0][2] - jacobian[2][0], jacobian[1][0] - jacobian[0][1]],
  };
}

// ---- flux through a sphere ---------------------------------------------------------------------------------------

// Midpoint rule in (mu = cos theta, phi); surfaceContributions bins the flux by azimuth into 32 slices.
const spherePass = (field, center, radius, muCount, phiCount) => {
  let flux = 0, maxField = 0;
  const surfaceContributions = Array(32).fill(0), dMu = 2 / muCount, dPhi = 2 * Math.PI / phiCount;
  for (let i = 0; i < muCount; i++) {
    const mu = -1 + (i + 0.5) * dMu, s = Math.sqrt(Math.max(0, 1 - mu * mu));
    for (let j = 0; j < phiCount; j++) {
      const phi = (j + 0.5) * dPhi, n = [s * Math.cos(phi), s * Math.sin(phi), mu];
      const result = field(add3(center, scale3(n, radius)));
      if (result.status !== 'valid') return { status: 'excluded', reason: '구면 표본이 모델 제외영역에 닿았습니다.' };
      maxField = Math.max(maxField, norm3(result.E));
      const contribution = dot3(result.E, n) * radius * radius * dMu * dPhi;
      flux += contribution;
      surfaceContributions[Math.floor(j * 32 / phiCount)] += contribution;
    }
  }
  return { status: 'valid', flux, samples: muCount * phiCount, surfaceContributions, maxField };
};

// A source on or crossing the sphere makes the flux integral singular or unsupported.
function sphereRefusal(sources, center, radius) {
  for (const source of sources) {
    if (!active(source)) continue;
    if (source.type === 'point' && Math.abs(norm3(sub(source.position, center)) - radius) <= TOUCH) {
      return { status: 'excluded', reason: '점전하가 구면 경계에 놓입니다.' };
    }
    if (source.type === 'finite-line') {
      const d0 = norm3(sub(source.start, center)), d1 = norm3(sub(source.end, center));
      const minimum = pointSegmentDistance(center, source.start, source.end);
      if (minimum <= radius + TOUCH && Math.max(d0, d1) >= radius - TOUCH) {
        return { status: 'unsupported', reason: '선전하가 구면 경계를 횡단하는 적분은 현재 명시 미지원입니다.' };
      }
    }
    if (source.type === 'infinite-line') {
      const delta = sub(center, source.position), along = dot3(delta, source.direction);
      const distance = norm3(delta.map((v, i) => v - along * source.direction[i]));
      if (distance <= radius + TOUCH) {
        return { status: 'unsupported', reason: '무한 선전하가 구면 경계를 횡단하는 적분은 현재 명시 미지원입니다.' };
      }
    }
  }
  return null;
}

/** Outward flux of E through the sphere (center, radius 0.05...5 m): 64x128 and 128x256 grids must agree. */
export function sphereFlux(field, center, radius, sources = []) {
  if (!Number.isFinite(radius) || radius < 0.05 || radius > 5) throw new Error('구/루프 반경은 0.05…5 m여야 합니다.');
  if (center.some(value => !Number.isFinite(value) || Math.abs(value) + radius > 20)) {
    return { status: 'excluded', reason: '구면이 좌표 범위를 벗어납니다.' };
  }
  const refusal = sphereRefusal(sources, center, radius);
  if (refusal) return refusal;
  const coarse = spherePass(field, center, radius, 64, 128);
  if (coarse.status !== 'valid') return coarse;
  const fine = spherePass(field, center, radius, 128, 256);
  if (fine.status !== 'valid') return fine;
  const difference = Math.abs(fine.flux - coarse.flux), limit = 0.05 + 0.001 * Math.abs(fine.flux);
  return {
    ...fine, coarseFlux: coarse.flux, difference, converged: difference <= limit,
    noiseScale: Math.max(fine.maxField, coarse.maxField) * 4 * Math.PI * radius * radius,
  };
}

// ---- circulation around a circle ---------------------------------------------------------------------------------

const loopBasis = normal => {
  const n = scale3(normal, 1 / norm3(normal)), seed = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const e1 = scale3(cross3(seed, n), 1 / norm3(cross3(seed, n)));
  return { n, e1, e2: cross3(n, e1) };
};

const loopPass = (field, center, radius, normal, count) => {
  if (!norm3(normal)) throw new Error('루프 법선은 0일 수 없습니다.');
  const { e1, e2 } = loopBasis(normal), pathContributions = Array(32).fill(0);
  let circulation = 0, maxField = 0;
  for (let i = 0; i < count; i++) {
    const theta = 2 * Math.PI * (i + 0.5) / count;
    const radial = add3(scale3(e1, Math.cos(theta)), scale3(e2, Math.sin(theta)));
    const point = add3(center, scale3(radial, radius));
    const tangent = add3(scale3(e1, -Math.sin(theta)), scale3(e2, Math.cos(theta)));
    const result = field(point);
    if (result.status !== 'valid') return { status: 'excluded', reason: '루프가 모델 제외영역에 닿았습니다.' };
    maxField = Math.max(maxField, norm3(result.E));
    const contribution = dot3(result.E, tangent) * radius * 2 * Math.PI / count;
    circulation += contribution;
    pathContributions[Math.floor(i * 32 / count)] += contribution;
  }
  return { status: 'valid', circulation, samples: count, pathContributions, maxField };
};

const pointLoopDistance = (point, center, radius, basis) => {
  const d = sub(point, center), z = dot3(d, basis.n), rho = Math.hypot(dot3(d, basis.e1), dot3(d, basis.e2));
  return Math.hypot(rho - radius, z);
};

// Does the parameter range [minT, maxT] of the line origin + t direction touch the circle?
const lineHitsLoop = (origin, direction, minT, maxT, center, radius, basis) => {
  const rel = sub(origin, center), den = dot3(direction, basis.n), height = dot3(rel, basis.n);
  if (Math.abs(den) > 1e-12) {
    const t = -height / den;
    if (t < minT || t > maxT) return false;
    return pointLoopDistance(origin.map((v, i) => v + t * direction[i]), center, radius, basis) <= TOUCH;
  }
  if (Math.abs(height) > TOUCH) return false;
  const x = dot3(rel, basis.e1), y = dot3(rel, basis.e2), dx = dot3(direction, basis.e1), dy = dot3(direction, basis.e2);
  const a = dx * dx + dy * dy, b = 2 * (x * dx + y * dy), c = x * x + y * y - radius * radius, disc = b * b - 4 * a * c;
  if (!a || disc < 0) return false;
  const root = Math.sqrt(disc);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)].some(t => t >= minT && t <= maxT);
};

const sourceCrossesLoop = (source, center, radius, basis) => {
  if (!active(source)) return false;
  if (source.type === 'point') return pointLoopDistance(source.position, center, radius, basis) <= TOUCH;
  if (source.type === 'finite-line') return lineHitsLoop(source.start, sub(source.end, source.start), 0, 1, center, radius, basis);
  return lineHitsLoop(source.position, source.direction, -Infinity, Infinity, center, radius, basis);
};

/** Circulation of E around the circle (center, radius 0.05...5 m, normal): 128 and 256 samples must agree. */
export function loopCirculation(field, center, radius, normal = [0, 0, 1], sources = []) {
  if (!Number.isFinite(radius) || radius < 0.05 || radius > 5) throw new Error('구/루프 반경은 0.05…5 m여야 합니다.');
  if (center.some(value => !Number.isFinite(value) || Math.abs(value) + radius > 20)) {
    return { status: 'excluded', reason: '루프가 좌표 범위를 벗어납니다.' };
  }
  if (!norm3(normal)) throw new Error('루프 법선은 0일 수 없습니다.');
  const basis = loopBasis(normal);
  if (sources.some(source => sourceCrossesLoop(source, center, radius, basis))) {
    return { status: 'excluded', reason: '루프 경로가 source 제외영역과 기하적으로 교차합니다.' };
  }
  const coarse = loopPass(field, center, radius, normal, 128), fine = loopPass(field, center, radius, normal, 256);
  if (coarse.status !== 'valid') return coarse;
  if (fine.status !== 'valid') return fine;
  const difference = Math.abs(fine.circulation - coarse.circulation), limit = 1e-8 + 1e-8 * Math.abs(fine.circulation);
  return {
    ...fine, coarseCirculation: coarse.circulation, difference, converged: difference <= limit,
    noiseScale: Math.max(fine.maxField, coarse.maxField) * 2 * Math.PI * radius,
  };
}
