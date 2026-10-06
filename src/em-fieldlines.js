// Field lines (streamlines) by second-order Runge-Kutta. Pure: no DOM.
//
// A field is a function point => vector (arrays of equal length, 2 or 3 numbers) or null when the point is
// outside the model (excluded zone, invalid). Lines follow the field direction only; the step length adapts to the
// distance from the nearest stop so a line crawls near a charge and strides through empty space.

const length = v => Math.hypot(...v);
const distance = (a, b) => length(a.map((value, i) => value - b[i]));
const inside = (p, bounds) => p.every((value, i) => value >= bounds.min[i] && value <= bounds.max[i]);

/**
 * Trace one line from `seed`, along the field (direction = 1) or against it (direction = -1).
 *   field   point => vector | null
 *   bounds  { min: number[], max: number[] }  the line stops on leaving this box
 *   stops   [{ center: number[], radius: number }]  absorbing disks, for example point charges
 *   step    { min, max, fraction }  step = clamp(fraction * distance to nearest stop, min, max)
 * Returns { points, end: { reason, stopIndex? } } with reason one of
 *   'bounds' | 'stop' | 'zero' (null or reversal) | 'excluded' | 'closed' | 'max-steps'.
 */
export function traceStreamline({
  field, seed, direction = 1, bounds, stops = [], step = {}, maxSteps = 400, project = v => v,
}) {
  const { min = 0.01, max = 0.12, fraction = 0.3 } = step;
  const unitAt = p => {
    const raw = field(p);
    if (!raw) return null;
    const v = project(raw), n = length(v);
    return n > 0 && Number.isFinite(n) ? v.map(value => direction * value / n) : undefined;
  };
  const points = [seed.slice()];
  let p = seed.slice(), travelled = 0, heading = null;
  const nearest = q => {
    let best = Infinity, index = -1;
    stops.forEach((stop, i) => {
      const d = distance(q, stop.center) - stop.radius;
      if (d < best) { best = d; index = i; }
    });
    return { distance: best, index };
  };
  for (let count = 0; count < maxSteps; count += 1) {
    const k1 = unitAt(p);
    if (k1 === null) return { points, end: { reason: 'excluded' } };
    if (k1 === undefined) return { points, end: { reason: 'zero' } };
    // A streamline never turns back on itself; a reversal means the step jumped across a null of the field.
    if (heading && k1.reduce((sum, value, i) => sum + value * heading[i], 0) < -0.3) return { points, end: { reason: 'zero' } };
    heading = k1;
    const near = nearest(p);
    const h = Math.max(min, Math.min(max, fraction * near.distance));
    const mid = p.map((value, i) => value + 0.5 * h * k1[i]);
    const k2 = unitAt(mid) ?? k1;
    const next = p.map((value, i) => value + h * k2[i]);
    travelled += h;
    const hit = nearest(next);
    if (hit.distance <= 0) {
      points.push(stops[hit.index].center.slice());
      return { points, end: { reason: 'stop', stopIndex: hit.index } };
    }
    points.push(next);
    if (!inside(next, bounds)) return { points, end: { reason: 'bounds' } };
    if (travelled > 8 * max && distance(next, seed) < 1.5 * h) return { points, end: { reason: 'closed' } };
    p = next;
  }
  return { points, end: { reason: 'max-steps' } };
}

// In-plane position builder: (a, b) => 3D point on the plane whose normal coordinate is `fixed`.
function planePoint(axes, normal, fixed) {
  return (a, b) => {
    const p = [0, 0, 0];
    p[axes[0]] = a; p[axes[1]] = b; p[normal] = fixed;
    return p;
  };
}

const strengthOf = source => (source.type === 'point' ? source.q : source.lambda);

/**
 * Seed positions around the sources, in the view plane (3D points with the plane's normal coordinate fixed).
 * Count scales with |source| so a stronger source emits more lines (3 to `maxPerSource`).
 * Returns [{ point, sourceId, sign }] where sign is the sign of the emitting source.
 */
export function seedsAroundSources(sources, { axes, normal, fixed, maxPerSource = 12, ring = 0.12 }) {
  const active = sources.filter(s => s.enabled !== false && s.visible !== false && strengthOf(s) !== 0);
  const strongest = Math.max(...active.map(s => Math.abs(strengthOf(s))), 0);
  const make = planePoint(axes, normal, fixed);
  const seeds = [];
  for (const source of active) {
    const sign = Math.sign(strengthOf(source));
    const count = Math.max(3, Math.round(maxPerSource * Math.abs(strengthOf(source)) / strongest));
    if (source.type === 'point') {
      const [a, b] = [source.position[axes[0]], source.position[axes[1]]];
      const phase = Math.PI / count;
      for (let k = 0; k < count; k += 1) {
        const angle = phase + 2 * Math.PI * k / count;
        seeds.push({ point: make(a + ring * Math.cos(angle), b + ring * Math.sin(angle)), sourceId: source.id, sign });
      }
      continue;
    }
    const start = source.type === 'finite-line' ? source.start : source.position.map(
      (value, i) => value - source.direction[i] * source.displayLength / 2);
    const end = source.type === 'finite-line' ? source.end : source.position.map(
      (value, i) => value + source.direction[i] * source.displayLength / 2);
    const dx = end[axes[0]] - start[axes[0]], dy = end[axes[1]] - start[axes[1]];
    const span = Math.hypot(dx, dy);
    if (span < 1e-9) continue;
    const nx = -dy / span, ny = dx / span, along = Math.max(2, Math.round(count / 2));
    for (let k = 0; k < along; k += 1) {
      const t = (k + 0.5) / along;
      const a = start[axes[0]] + dx * t, b = start[axes[1]] + dy * t;
      for (const side of [1, -1]) seeds.push({ point: make(a + side * ring * nx, b + side * ring * ny), sourceId: source.id, sign });
    }
  }
  return seeds;
}

/**
 * Field lines for a set of sources: positive sources emit forward lines, negative sources emit lines traced against
 * the field (so they start at the negative charge and run outward). A backward line from a negative source that ends in a
 * positive point source duplicates a line already emitted there, so it is dropped.
 *
 *   field(p3)  3D point => 3D vector | null
 *   Returns [{ points: [x, y, z][], end, sourceId }] with points in 3D on the plane.
 */
export function traceSourceLines(sources, field, {
  axes, normal, fixed, bounds, stopRadius = 0.06, maxSteps = 360, maxPerSource = 12, ring = 0.12,
}) {
  const seeds = seedsAroundSources(sources, { axes, normal, fixed, maxPerSource, ring });
  const pointSources = sources.filter(s => s.type === 'point' && s.enabled !== false && s.q !== 0);
  const stops = pointSources.map(s => ({ center: [s.position[axes[0]], s.position[axes[1]]], radius: stopRadius }));
  const toPlane = planePoint(axes, normal, fixed);
  const field2 = ([a, b]) => {
    const v = field(toPlane(a, b));
    return v ? [v[axes[0]], v[axes[1]]] : null;
  };
  const box = {
    min: [bounds.aMin, bounds.bMin], max: [bounds.aMax, bounds.bMax],
  };
  const lines = [];
  for (const seed of seeds) {
    const traced = traceStreamline({
      field: field2, seed: [seed.point[axes[0]], seed.point[axes[1]]], direction: seed.sign,
      bounds: box, stops, maxSteps, step: { min: 0.01, max: 0.12, fraction: 0.3 },
    });
    if (traced.points.length < 4 && traced.end.reason !== 'stop') continue;
    if (seed.sign < 0 && traced.end.reason === 'stop' && pointSources[traced.end.stopIndex].q > 0) continue;
    // Lines run from the emitting source outward; field lines of a negative source are listed source-first too.
    lines.push({
      points: traced.points.map(([a, b]) => toPlane(a, b)), end: traced.end, sourceId: seed.sourceId, sign: seed.sign,
    });
  }
  return lines;
}
