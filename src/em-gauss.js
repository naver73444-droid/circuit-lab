// Gauss surface (sphere) helpers for the charge sandbox. Pure: no DOM.
//
// enclosure(): which sources are inside, and whether the surface can be integrated at all.
// coarseSphereFlux(): a cheap midpoint-rule flux used while the surface is dragged; the precise, converged value on
// release comes from sphereFlux() in em-playground-calculus.js.
import { EPS0 } from './em-physics.js';

export const GAUSS_MIN_RADIUS = 0.05;
export const GAUSS_MAX_RADIUS = 5;
const EDGE = 0.001; // the 1 mm model exclusion zone of a source

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function pointSegmentDistance(p, a, b) {
  const ab = b.map((value, i) => value - a[i]);
  const len2 = ab.reduce((sum, value) => sum + value * value, 0);
  const t = len2 ? Math.max(0, Math.min(1, p.reduce((sum, value, i) => sum + (value - a[i]) * ab[i], 0) / len2)) : 0;
  return dist(p, a.map((value, i) => value + t * ab[i]));
}

const strengthOf = source => (source.type === 'point' ? source.q : source.lambda);

/**
 * Classify every active source against the sphere (center, radius).
 * status 'ok': enclosedCharge is exact (point charges inside, finite lines wholly inside, in coulombs).
 * status 'excluded': a point charge sits on the surface (the flux integrand is singular there).
 * status 'unsupported': a line crosses the surface, so the enclosed charge is not a finite sum of the sources.
 */
export function gaussEnclosure(sources, center, radius) {
  const enclosedIds = [], outsideIds = [], crossingIds = [];
  let enclosedCharge = 0, boundaryId = null, boundaryGap = Infinity;
  for (const source of sources) {
    if (source.enabled === false || strengthOf(source) === 0) continue;
    if (source.type === 'point') {
      const d = dist(source.position, center);
      boundaryGap = Math.min(boundaryGap, Math.abs(d - radius));
      if (Math.abs(d - radius) <= EDGE) boundaryId = source.id;
      else if (d < radius) { enclosedIds.push(source.id); enclosedCharge += source.q; } else outsideIds.push(source.id);
    } else if (source.type === 'finite-line') {
      const near = pointSegmentDistance(center, source.start, source.end);
      const far = Math.max(dist(source.start, center), dist(source.end, center));
      if (near <= radius + EDGE && far >= radius - EDGE) crossingIds.push(source.id);
      else if (far < radius - EDGE) {
        enclosedIds.push(source.id);
        enclosedCharge += source.lambda * dist(source.start, source.end);
      } else outsideIds.push(source.id);
    } else {
      const delta = center.map((value, i) => value - source.position[i]);
      const along = delta.reduce((sum, value, i) => sum + value * source.direction[i], 0);
      const perpendicular = Math.hypot(...delta.map((value, i) => value - along * source.direction[i]));
      if (perpendicular <= radius + EDGE) crossingIds.push(source.id); else outsideIds.push(source.id);
    }
  }
  // boundaryGap: distance (m) from the surface to the nearest point charge; a small gap makes the flux integrand spiky.
  const base = { enclosedIds, outsideIds, crossingIds, enclosedCharge, boundaryGap, radius };
  if (boundaryId) return { ...base, status: 'excluded', reason: `점전하 ${boundaryId}가 가우스 면 위에 놓였습니다.` };
  if (crossingIds.length) return { ...base, status: 'unsupported', reason: '선전하가 가우스 면을 가로지릅니다.' };
  return { ...base, status: 'ok' };
}

/** Gauss's law prediction: flux = Q_enclosed / eps0 (V·m). */
export const predictedFlux = enclosedCharge => enclosedCharge / EPS0;

/**
 * Midpoint-rule flux of E through the sphere, outward normal. evaluate(point) => { status, E }.
 * Returns { status: 'valid', flux, samples } or { status: 'excluded' } when a sample falls in an exclusion zone.
 */
export function coarseSphereFlux(evaluate, center, radius, { mu = 24, phi = 48 } = {}) {
  const dMu = 2 / mu, dPhi = 2 * Math.PI / phi;
  let flux = 0;
  for (let i = 0; i < mu; i += 1) {
    const cosine = -1 + (i + 0.5) * dMu, sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
    for (let j = 0; j < phi; j += 1) {
      const angle = (j + 0.5) * dPhi;
      const n = [sine * Math.cos(angle), sine * Math.sin(angle), cosine];
      const result = evaluate([center[0] + radius * n[0], center[1] + radius * n[1], center[2] + radius * n[2]]);
      if (result.status !== 'valid') return { status: 'excluded' };
      flux += (result.E[0] * n[0] + result.E[1] * n[1] + result.E[2] * n[2]) * radius * radius * dMu * dPhi;
    }
  }
  return { status: 'valid', flux, samples: mu * phi };
}

/** True when two fluxes agree within `relative` of the larger magnitude (or an absolute floor for ~0). */
export function fluxAgrees(a, b, relative = 0.02, floor = 1e-9) {
  return Math.abs(a - b) <= Math.max(floor, relative * Math.max(Math.abs(a), Math.abs(b)));
}

/** Keep a Gauss sphere inside the supported size and coordinate range. */
export function clampGauss({ center, radius }) {
  const r = Math.min(GAUSS_MAX_RADIUS, Math.max(GAUSS_MIN_RADIUS, radius));
  const limit = 20 - r;
  return { center: center.map(value => Math.min(limit, Math.max(-limit, value))), radius: r };
}
