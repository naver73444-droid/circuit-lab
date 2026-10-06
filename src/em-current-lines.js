// Magnetic field lines of the current sandbox for the plane view. Pure: no DOM.
// B lines never end on a source: around a wire they are closed circles, around a loop they close through its opening. Seeds sit
// on rings (wires, segments) or on the line across the loop axis / a sheet; each line is traced forward until it returns to its
// seed (closed) and, if it leaves the view instead, backward too, so a line that crosses the view is one polyline.
import { traceStreamline } from './em-fieldlines.js';
import { isActive, planeBasis, sheetLineDirection, wireHit } from './em-current-field.js';
import { dot3 } from './em-physics.js';

const QUALITY = {
  draft: { rings: 7, maxSteps: 150 },
  final: { rings: 11, maxSteps: 420 },
};
const FIRST_RING = 0.1;
const RING_RATIO = 1.5;
const SEED_TOLERANCE = 0.1; // a seed closer than this fraction of its radius to an existing line adds nothing

/** The point where a wire meets the viewed plane (its normal coordinate = fixed), or null for a wire lying in the plane (the shared test). */
export const wirePierce = wireHit;

const ringRadii = rings => Array.from({ length: rings }, (_, k) => FIRST_RING * RING_RATIO ** k);

function ringSeeds(centre, rings, offset) {
  return ringRadii(rings).map((r, k) => {
    const angle = offset + k * 0.7;
    return { point: [centre[0] + r * Math.cos(angle), centre[1] + r * Math.sin(angle)], r };
  });
}

// Seeds along a line from `centre` in direction (du, dv), on both sides, at the given distances.
function ladderSeeds(centre, direction, distances) {
  return distances.flatMap(r => [1, -1].map(side => ({ point: [centre[0] + side * r * direction[0], centre[1] + side * r * direction[1]], r })));
}

/**
 * Seeds for the lines of `sources` in the viewed plane: [{ point: [u, v], r }] in plane coordinates (display metres).
 * `fixed` is the normal coordinate of the plane; `reach` limits the rings to what the view can show.
 */
export function currentSeeds(sources, plane, fixed, reach, rings) {
  const { a, b } = planeBasis(plane), seeds = [];
  const coords = p => [dot3(p, a), dot3(p, b)], ladder = [0.15, 0.45, 0.75, 1.3, 1.9];
  let index = 0;
  for (const source of sources.filter(isActive)) {
    index += 1;
    if (source.type === 'wire') {
      const hit = wirePierce(source, plane, fixed), [wu, wv] = coords(source.position);
      // A wire that meets the plane far outside the picture (nearly in the plane) looks like a line in it, so it is seeded like one.
      const near = hit && Math.hypot(coords(hit)[0] - wu, coords(hit)[1] - wv) <= reach;
      if (near) seeds.push(...ringSeeds(coords(hit), rings, index * 0.9));
      else {
        // A wire lying in the viewed plane: its lines run across the picture, so seed along the line across it.
        const [du, dv] = [dot3(source.direction, a), dot3(source.direction, b)], length = Math.hypot(du, dv);
        if (length > 1e-9) seeds.push(...ladderSeeds([wu, wv], [-dv / length, du / length], ladder.map(f => f * 0.5).concat(ringRadii(rings).slice(2))));
      }
    } else if (source.type === 'segment') {
      const mid = source.start.map((value, i) => (value + source.end[i]) / 2), line = source.end.map((value, i) => value - source.start[i]);
      const [mu, mv] = coords(mid), [lu, lv] = [dot3(line, a), dot3(line, b)], length = Math.hypot(lu, lv);
      if (length > 1e-9) seeds.push(...ladderSeeds([mu, mv], [-lv / length, lu / length], ringRadii(rings)));
      else seeds.push(...ringSeeds([mu, mv], rings, index * 0.9));
    } else if (source.type === 'loop') {
      const [cu, cv] = coords(source.position), axis = [dot3(source.normal, a), dot3(source.normal, b)], length = Math.hypot(...axis);
      // Across the axis (in the plane) the lines of the loop thread the opening and come back around it.
      const across = length > 1e-9 ? [-axis[1] / length, axis[0] / length] : [1, 0];
      seeds.push(...ladderSeeds([cu, cv], across, ladder.map(f => f * source.radius)));
    } else {
      const line = sheetLineDirection(source, plane);
      if (!line) continue;
      const [su, sv] = coords(source.position), across = [-dot3(line, b), dot3(line, a)];
      seeds.push(...ladderSeeds([su, sv], across, [0.1, 0.2, 0.4, 0.7, 1.1, 1.7].filter(r => r < reach)));
    }
  }
  return seeds.filter(seed => seed.r <= reach);
}

const nearAny = (point, lines, tolerance) => lines.some(line => line.some(p => Math.hypot(p[0] - point[0], p[1] - point[1]) < tolerance));

/**
 * Lines of the field `vectorOf(point3) => vector | null` through the seeds of `sources`.
 *   bounds   { aMin, aMax, bMin, bMax } of the view (plane coordinates)
 * Returns [{ points: 3D points on the plane, end, sourceId: 'current', sign: 1 }]; each line follows the field direction.
 */
export function traceCurrentLines(sources, vectorOf, { plane, fixed, bounds, quality = 'final' }) {
  const { axes: [ia, ib] } = planeBasis(plane), normal = 3 - ia - ib, options = QUALITY[quality] ?? QUALITY.final;
  const diagonal = Math.hypot(bounds.aMax - bounds.aMin, bounds.bMax - bounds.bMin);
  const seeds = currentSeeds(sources, plane, fixed, diagonal, options.rings);
  const toPlane = ([u, v]) => { const p = [0, 0, 0]; p[ia] = u; p[ib] = v; p[normal] = fixed; return p; };
  const field2 = point => { const vector = vectorOf(toPlane(point)); return vector ? [vector[ia], vector[ib]] : null; };
  const box = { min: [bounds.aMin, bounds.bMin], max: [bounds.aMax, bounds.bMax] };
  const stops = sources.filter(isActive).flatMap(source => {
    const hit = source.type === 'wire' ? wirePierce(source, plane, fixed) : null;
    return hit ? [{ center: [hit[ia], hit[ib]], radius: 0.02, reason: 'wire' }] : [];
  });
  const kept = [], lines = [];
  for (const seed of seeds) {
    const [u, v] = seed.point;
    if (u < box.min[0] || u > box.max[0] || v < box.min[1] || v > box.max[1]) continue;
    if (nearAny(seed.point, kept, SEED_TOLERANCE * seed.r)) continue;
    const step = { min: 0.004, max: Math.min(0.2, Math.max(0.01, seed.r / 14)), fraction: 0.3 };
    const trace = direction => traceStreamline({ field: field2, seed: seed.point, direction, bounds: box, stops, maxSteps: options.maxSteps, step });
    const forward = trace(1);
    let points = forward.points, end = forward.end;
    if (forward.end.reason === 'closed') points = [...forward.points, seed.point];
    else {
      const back = trace(-1);
      points = [...back.points.slice(1).reverse(), ...forward.points];
      if (back.end.reason === 'closed') end = back.end;
    }
    if (points.length < 4) continue;
    kept.push(points);
    lines.push({ points: points.map(toPlane), end, sourceId: 'current', sign: 1 });
  }
  return lines;
}
