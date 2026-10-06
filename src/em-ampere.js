// Ampere loop of the magnetostatic sandbox: enclosed current, path samples and the circulation of H. Pure: no DOM.
//
// The loop lies in the viewed plane (a circle or an axis-aligned rectangle) and is traversed counter-clockwise on the screen
// (orientation +1) or clockwise (-1). The right-hand rule gives the sign of the enclosed current: a current that crosses the
// disk toward the viewer counts positive for orientation +1.
//
//   ampereEnclosure   which sources pierce the disk (I_enc), which only miss it, and which make the comparison unsupported
//   ampereCoarse      a cheap midpoint-rule circulation (while dragging) with the extremes of |H| along the path
//   amperePrecise     the converged circulation (circle: doubled midpoint rule; rectangle: doubled 5-point Gauss-Legendre panels)
import { dot3, sub3, norm3, MU0 } from './em-physics.js';
import { circleBasis, createCurrentEvaluator, hFromB, isActive, planeBasis, strengthOf, wirePierces } from './em-current-field.js';

export const AMPERE_MIN = 0.05;
export const AMPERE_MAX = 5;
const EDGE = 0.001; // a source this close to the path is "on" it: the integrand is singular there

/**
 * Keep an Ampere loop inside the supported size and coordinate range. A value that is not a finite number (NaN, ±Infinity,
 * a missing field) is not passed through: the same field of `previous` is kept, else the default (size 1 / 1 / 0.7, centre 0).
 */
export function clampAmpere(loop, previous = null) {
  const pick = (value, old, fallback) => (Number.isFinite(value) ? value : Number.isFinite(old) ? old : fallback);
  const clamp = value => Math.min(AMPERE_MAX, Math.max(AMPERE_MIN, value));
  const radius = clamp(pick(loop.radius, previous?.radius, 1)), halfWidth = clamp(pick(loop.halfWidth, previous?.halfWidth, 1));
  const halfHeight = clamp(pick(loop.halfHeight, previous?.halfHeight, 0.7));
  const reach = loop.shape === 'rect' ? Math.hypot(halfWidth, halfHeight) : radius, limit = 20 - reach;
  return {
    ...loop, radius, halfWidth, halfHeight, orientation: loop.orientation === -1 ? -1 : 1,
    center: [0, 1, 2].map(i => Math.min(limit, Math.max(-limit, pick(loop.center?.[i], previous?.center?.[i], 0)))),
  };
}

/** Signed distance (m) from an in-plane point (u, v), measured from the loop centre, to the path: negative inside. */
export function pathGap(loop, u, v) {
  if (loop.shape === 'rect') {
    const dx = Math.abs(u) - loop.halfWidth, dy = Math.abs(v) - loop.halfHeight;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  }
  return Math.hypot(u, v) - loop.radius;
}

const classify = gap => (gap < -EDGE ? 'inside' : gap > EDGE ? 'outside' : 'boundary');

// A line in the loop plane (u, v) with unit direction (du, dv) through (u0, v0): does it touch the closed loop region?
function lineTouchesRegion(loop, u0, v0, du, dv) {
  const side = (u, v) => (u - u0) * dv - (v - v0) * du; // signed distance to the line (unit direction)
  if (loop.shape === 'rect') {
    const sides = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => side(x * loop.halfWidth, y * loop.halfHeight));
    return Math.min(...sides) <= EDGE && Math.max(...sides) >= -EDGE;
  }
  return Math.abs(side(0, 0)) <= loop.radius + EDGE;
}

/**
 * Classify every active source against the Ampere loop in `plane`.
 * status 'ok': enclosedCurrent (A) is exact: the signed sum over the wires / current loops that pierce the disk.
 * status 'excluded': a wire or a crossing point of a loop lies on the path (the integrand is singular there).
 * status 'unsupported': the path crosses a sheet or a wire / loop in its own plane, or a finite wire exists (not a closed circuit).
 * Also returns nearGap: the smallest distance (m) from the path to a piercing point (small values make H spiky on the path).
 */
export function ampereEnclosure(sources, loop, plane) {
  const { a, b, n } = planeBasis(plane), center = loop.center, orientation = loop.orientation === -1 ? -1 : 1;
  const enclosedIds = [], outsideIds = [], crossingIds = [], openIds = [], boundaryIds = [];
  let enclosedCurrent = 0, nearGap = Infinity;
  const coords = point => { const d = sub3(point, center); return [dot3(d, a), dot3(d, b)]; };
  const place = (id, point, current) => {
    const [u, v] = coords(point), gap = pathGap(loop, u, v);
    nearGap = Math.min(nearGap, Math.abs(gap));
    const where = classify(gap);
    if (where === 'boundary') { boundaryIds.push(id); return 'boundary'; }
    if (where === 'inside') enclosedCurrent += current;
    return where;
  };
  for (const source of sources) {
    if (!isActive(source)) continue;
    const id = source.id;
    if (source.type === 'segment') { openIds.push(id); continue; }
    if (source.type === 'wire') {
      const along = dot3(source.direction, n);
      if (wirePierces(source.direction, n)) { // the same test the picture uses for its dot / cross and the field-line seeds
        const t = dot3(sub3(center, source.position), n) / along, hit = source.position.map((value, i) => value + t * source.direction[i]);
        const where = place(id, hit, source.current * Math.sign(along) * orientation);
        if (where === 'inside') enclosedIds.push(id); else if (where === 'outside') outsideIds.push(id);
        continue;
      }
      if (Math.abs(dot3(sub3(source.position, center), n)) > EDGE) { outsideIds.push(id); continue; }
      const [u0, v0] = coords(source.position);
      if (lineTouchesRegion(loop, u0, v0, dot3(source.direction, a), dot3(source.direction, b))) crossingIds.push(id); else outsideIds.push(id);
    } else if (source.type === 'sheet') {
      const s = source.normal, parallel = Math.abs(dot3(s, n)) > 1 - 1e-9;
      if (parallel) {
        if (Math.abs(dot3(sub3(source.position, center), n)) <= EDGE) crossingIds.push(id); else outsideIds.push(id);
        continue;
      }
      const sa = dot3(s, a), sb = dot3(s, b), length = Math.hypot(sa, sb), offset = dot3(sub3(source.position, center), s);
      // The sheet cuts the loop plane along the line sa u + sb v = offset: unit direction (-sb, sa) / length.
      const u0 = offset * sa / (length * length), v0 = offset * sb / (length * length);
      if (lineTouchesRegion(loop, u0, v0, -sb / length, sa / length)) crossingIds.push(id); else outsideIds.push(id);
    } else {
      classifyLoop(source, loop, plane, { n, a, b, center, orientation, place, enclosedIds, outsideIds, crossingIds, coords });
    }
  }
  const base = { enclosedIds, outsideIds, crossingIds, openIds, enclosedCurrent, nearGap, orientation };
  if (openIds.length) {
    return { ...base, status: 'unsupported', reason: '유한 직선 도선은 닫힌 전류 경로가 아니어서 ∮H·dl = I내부 비교를 지원하지 않습니다.' };
  }
  if (crossingIds.length) {
    return { ...base, status: 'unsupported', reason: '암페어 경로가 면전류 판이나 같은 평면의 도선·루프와 만납니다. 그 자리에서 H가 불연속이거나 정의되지 않습니다.' };
  }
  if (boundaryIds.length) return { ...base, status: 'excluded', reason: `전류 ${boundaryIds.join(', ')}가 암페어 경로 위에 놓였습니다.`, boundaryIds };
  return { ...base, status: 'ok' };
}

// A circular current loop: the points where its wire crosses the plane of the Ampere loop carry the linked current.
function classifyLoop(source, loop, plane, ctx) {
  const { n, center, orientation, place, enclosedIds, outsideIds, crossingIds, coords } = ctx, id = source.id;
  const { e1, e2 } = circleBasis(source.normal), R = source.radius;
  const A = dot3(sub3(source.position, center), n), B = R * dot3(e1, n), C = R * dot3(e2, n), M = Math.hypot(B, C);
  const at = theta => source.position.map((value, i) => value + R * (e1[i] * Math.cos(theta) + e2[i] * Math.sin(theta)));
  if (M < 1e-9 * R) {
    // The two planes are parallel: nothing pierces unless the loop wire lies in the plane and meets the path.
    if (Math.abs(A) > EDGE) { outsideIds.push(id); return; }
    const gaps = Array.from({ length: 96 }, (_, i) => { const [u, v] = coords(at(2 * Math.PI * i / 96)); return pathGap(loop, u, v); });
    if (gaps.some(gap => Math.abs(gap) <= EDGE) || (gaps.some(gap => gap < 0) && gaps.some(gap => gap > 0))) crossingIds.push(id);
    else outsideIds.push(id);
    return;
  }
  const ratio = -A / M;
  if (Math.abs(ratio) > 1 - 1e-12) { // grazing or missing the plane: no net current through the disk
    if (Math.abs(ratio) <= 1 + 1e-12) {
      const theta = Math.atan2(C, B) + (ratio > 0 ? 0 : Math.PI), [u, v] = coords(at(theta));
      if (classify(pathGap(loop, u, v)) === 'boundary') { crossingIds.push(id); return; }
    }
    outsideIds.push(id);
    return;
  }
  const phi = Math.atan2(C, B), spread = Math.acos(ratio);
  let inside = 0;
  for (const theta of [phi + spread, phi - spread]) {
    // dh/dtheta = -B sin + C cos: the sign of the current crossing the plane toward the viewer.
    const slope = -B * Math.sin(theta) + C * Math.cos(theta);
    const where = place(id, at(theta), source.current * Math.sign(slope) * orientation);
    if (where === 'inside') inside += 1;
  }
  // Both crossing points inside the path: the wire goes in and comes out again, so nothing links the path.
  if (inside === 1) enclosedIds.push(id); else outsideIds.push(id);
}

// ---- path samples ------------------------------------------------------------------------------------------------------

// 5-point Gauss-Legendre nodes / weights on [-1, 1]: the converged rectangle uses panels of these (exponential convergence).
const GAUSS5 = [[0, 0.5688888888888889], [-0.5384693101056831, 0.4786286704993665], [0.5384693101056831, 0.4786286704993665],
  [-0.906179845938664, 0.2369268850561891], [0.906179845938664, 0.2369268850561891]];

/**
 * Samples of the path: [{ point, tangent, dl }] with the tangent following the orientation (dl is the quadrature weight in m).
 * A circle takes `count` midpoint samples (exact for a periodic integrand); a rectangle spreads about `count` over its four
 * sides in proportion to their lengths, by the midpoint rule or, with `gauss`, by 5-point Gauss-Legendre panels.
 */
export function ampereSamples(loop, plane, count, { gauss = false } = {}) {
  const { a, b } = planeBasis(plane), c = loop.center, orientation = loop.orientation === -1 ? -1 : 1;
  const place = (u, v) => c.map((value, i) => value + u * a[i] + v * b[i]);
  const direction = (du, dv) => a.map((value, i) => orientation * (du * value + dv * b[i]));
  const samples = [];
  if (loop.shape === 'rect') {
    const w = loop.halfWidth, h = loop.halfHeight, perimeter = 4 * (w + h);
    const sides = [
      { from: [-w, -h], to: [w, -h], length: 2 * w }, { from: [w, -h], to: [w, h], length: 2 * h },
      { from: [w, h], to: [-w, h], length: 2 * w }, { from: [-w, h], to: [-w, -h], length: 2 * h },
    ];
    for (const side of sides) {
      const du = (side.to[0] - side.from[0]) / side.length, dv = (side.to[1] - side.from[1]) / side.length;
      const at = s => place(side.from[0] + du * s, side.from[1] + dv * s), tangent = direction(du, dv);
      if (gauss) {
        const panels = Math.max(1, Math.round(count * side.length / perimeter / GAUSS5.length)), width = side.length / panels;
        for (let i = 0; i < panels; i += 1) {
          for (const [x, weight] of GAUSS5) samples.push({ point: at((i + 0.5 + x / 2) * width), tangent, dl: weight * width / 2 });
        }
        continue;
      }
      const steps = Math.max(2, Math.round(count * side.length / perimeter)), dl = side.length / steps;
      for (let i = 0; i < steps; i += 1) samples.push({ point: at((i + 0.5) * dl), tangent, dl });
    }
    return samples;
  }
  const R = loop.radius, dl = 2 * Math.PI * R / count;
  for (let i = 0; i < count; i += 1) {
    const theta = 2 * Math.PI * (i + 0.5) / count;
    samples.push({ point: place(R * Math.cos(theta), R * Math.sin(theta)), tangent: direction(-Math.sin(theta), Math.cos(theta)), dl });
  }
  return samples;
}

/** Perimeter (m) of the path. */
export const ampereLength = loop => (loop.shape === 'rect' ? 4 * (loop.halfWidth + loop.halfHeight) : 2 * Math.PI * loop.radius);

const hOf = evaluate => point => {
  const result = evaluate(point);
  return result.status === 'valid' ? { status: 'valid', E: hFromB(result.B) } : { status: 'excluded' };
};

function pass(evaluateH, loop, plane, count, options) {
  let circulation = 0, maxH = 0, minH = Infinity;
  for (const { point, tangent, dl } of ampereSamples(loop, plane, count, options)) {
    const result = evaluateH(point);
    if (result.status !== 'valid') return { status: 'excluded', reason: '암페어 경로가 모델 제외영역에 닿았습니다.' };
    const magnitude = norm3(result.E);
    maxH = Math.max(maxH, magnitude); minH = Math.min(minH, magnitude);
    circulation += (result.E[0] * tangent[0] + result.E[1] * tangent[1] + result.E[2] * tangent[2]) * dl;
  }
  return { status: 'valid', circulation, maxH, minH, samples: count };
}

/** A cheap circulation of H (A) with the extremes of |H| (A/m) on the path. evaluate(point) => { status, B }. */
export function ampereCoarse(evaluate, loop, plane, count = 96) {
  return { ...pass(hOf(evaluate), loop, plane, count), converged: null };
}

/**
 * The converged circulation of H. Both shapes double their sample count until two passes agree to 1e-9: the circle takes midpoint
 * samples (exact for a periodic integrand, error ~ (r/R)^N for a wire at r/R of the path, so a wire 0.1 m inside a 1 m path needs
 * ~512 samples where a fixed 128 / 256 pair cannot agree), the rectangle 5-point Gauss-Legendre panels. `converged` is false when
 * the largest pass still disagrees with the one before it (a wire practically on the path).
 */
export function amperePrecise(evaluate, loop, plane) {
  const evaluateH = hOf(evaluate), circle = loop.shape !== 'rect';
  const first = circle ? 128 : 80, limit = circle ? 16384 : 2560, options = circle ? {} : { gauss: true };
  let previous = null, last = null;
  for (let count = first; count <= limit; count *= 2) {
    last = pass(evaluateH, loop, plane, count, options);
    if (last.status !== 'valid') return last;
    if (previous !== null && Math.abs(last.circulation - previous) <= 1e-9 + 1e-9 * Math.abs(last.circulation)) {
      return { status: 'valid', circulation: last.circulation, maxH: last.maxH, minH: last.minH, samples: count, converged: true };
    }
    previous = last.circulation;
  }
  return { status: 'valid', circulation: last.circulation, maxH: last.maxH, minH: last.minH, samples: limit, converged: false };
}

/** Circulation (A) of H along the Ampere loop for a validated source list: the one call the plane controller needs. */
export function ampereMeasure(sources, loop, plane, { precise = false } = {}) {
  const evaluate = createCurrentEvaluator(sources), enclosure = ampereEnclosure(sources, loop, plane);
  if (enclosure.status !== 'ok') return { enclosure, numeric: null };
  const numeric = precise ? amperePrecise(evaluate, loop, plane) : ampereCoarse(evaluate, loop, plane);
  return { enclosure, numeric, precise };
}

/** True when the numeric circulation matches I_enc within `relative` of the larger magnitude (or a floor for ~0), amperes. */
export function circulationAgrees(numeric, expected, relative = 0.01, floor = 1e-6) {
  return Math.abs(numeric - expected) <= Math.max(floor, relative * Math.max(Math.abs(numeric), Math.abs(expected)));
}

/** B-circulation prediction mu0 * I_enc (T·m). */
export const predictedBCirculation = enclosedCurrent => MU0 * enclosedCurrent;

/** Which sources carry current inside the loop: the ids with their signed current, for the readout. */
export function enclosedSummary(sources, enclosure) {
  return enclosure.enclosedIds.map(id => {
    const source = sources.find(item => item.id === id);
    return { id, current: source ? strengthOf(source) : 0 };
  });
}
