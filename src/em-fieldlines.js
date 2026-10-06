// Field lines (streamlines) by second-order Runge-Kutta. Pure: no DOM.
//
// A field is a function point => vector (arrays of equal length, 2 or 3 numbers) or null when the point is
// outside the model (excluded zone, invalid). Lines follow the field direction only; the step length adapts to the
// distance from the nearest stop so a line crawls near a charge and strides through empty space.

const length = v => Math.hypot(...v);
const distance = (a, b) => length(a.map((value, i) => value - b[i]));
const inside = (p, bounds) => p.every((value, i) => value >= bounds.min[i] && value <= bounds.max[i]);

// A stop is a disk (point charge) or, with `end`, a capsule around the segment center-end (a line charge seen in the
// plane). stopAxisPoint is the nearest point of the stop's axis; stopGap is the distance from q to the stop's surface.
function stopAxisPoint(stop, q) {
  if (!stop.end) return stop.center;
  const ab = stop.end.map((value, i) => value - stop.center[i]), ap = q.map((value, i) => value - stop.center[i]);
  const len2 = ab.reduce((sum, value) => sum + value * value, 0);
  const t = len2 ? Math.max(0, Math.min(1, ap.reduce((sum, value, i) => sum + value * ab[i], 0) / len2)) : 0;
  return stop.center.map((value, i) => value + t * ab[i]);
}
const stopGap = (stop, q) => distance(q, stopAxisPoint(stop, q)) - stop.radius;

// First stop entered by the step p -> next, or null. The gap from a point moving along a straight step to a stop is a convex
// function of the step parameter (distance to a convex set), so its minimum is found by ternary search and the entry point
// by bisection before it: a step that crosses a thin line charge is caught even when both end points are far outside it.
// A step shorter than the gap to a stop cannot reach it, which rejects almost every stop without any search.
function firstHit(p, next, stops) {
  const reach = distance(p, next);
  let best = null;
  stops.forEach((stop, index) => {
    if (stopGap(stop, p) > reach) return;
    const at = t => p.map((value, i) => value + t * (next[i] - value));
    const gap = t => stopGap(stop, at(t));
    let found = 0;
    if (gap(0) > 0) {
      let lo = 0, hi = 1;
      for (let iter = 0; iter < 40; iter += 1) {
        const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
        if (gap(a) < gap(b)) hi = b; else lo = a;
      }
      const bottom = (lo + hi) / 2;
      if (gap(bottom) > 0) return;
      lo = 0; hi = bottom;
      for (let iter = 0; iter < 40; iter += 1) { const mid = (lo + hi) / 2; if (gap(mid) <= 0) hi = mid; else lo = mid; }
      found = hi;
    }
    if (!best || found < best.t) best = { index, t: found, point: at(found) };
  });
  return best;
}

/**
 * Trace one line from `seed`, along the field (direction = 1) or against it (direction = -1).
 *   field   point => vector | null
 *   bounds  { min: number[], max: number[] }  the line stops on leaving this box
 *   stops   [{ center: number[], radius: number, end?: number[] }]  absorbing disks or capsules (point / line charges)
 *   step    { min, max, fraction }  step = clamp(fraction * distance to nearest stop, min, max)
 * A stop with `end` is a line charge (capsule along center-end): the step length also shrinks near it and the path
 * segment of each step is tested against it, so a line can neither jump over nor pass through a line charge.
 * Returns { points, end: { reason, stopIndex? } } with reason one of
 *   'bounds' | 'stop' (point charge) | 'charge' (line charge) | 'zero' (null or reversal) | 'excluded' | 'closed' | 'max-steps'.
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
      const d = stopGap(stop, q);
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
    const hit = firstHit(p, next, stops);
    if (hit) {
      const stop = stops[hit.index];
      points.push(stopAxisPoint(stop, hit.point).slice());
      return { points, end: { reason: stop.reason ?? (stop.end ? 'charge' : 'stop'), stopIndex: hit.index } };
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
 * The part of the segment p0 -> p1 (2D) inside the box { aMin, aMax, bMin, bMax } as a parameter range [t0, t1] within [0, 1]
 * (Liang-Barsky), or null when the segment misses the box.
 */
export function clipSegmentToBox(p0, p1, box) {
  let t0 = 0, t1 = 1;
  const d = [p1[0] - p0[0], p1[1] - p0[1]];
  const limits = [[-d[0], p0[0] - box.aMin], [d[0], box.aMax - p0[0]], [-d[1], p0[1] - box.bMin], [d[1], box.bMax - p0[1]]];
  for (const [direction, room] of limits) {
    if (direction === 0) { if (room < 0) return null; continue; }
    const t = room / direction;
    if (direction < 0) { if (t > t1) return null; t0 = Math.max(t0, t); } else { if (t < t0) return null; t1 = Math.min(t1, t); }
  }
  return t1 > t0 ? [t0, t1] : null;
}

/**
 * Seed positions around the sources, in the view plane (3D points with the plane's normal coordinate fixed).
 * Count scales with |source| so a stronger source emits more lines (3 to `maxPerSource`).
 * With `bounds` ({ aMin, aMax, bMin, bMax }, the view) a line charge is seeded along its VISIBLE part only: a long or off-centre
 * line gets its full share of seeds inside the view (an infinite line counts as a segment of LINE_REACH each way), and a line
 * wholly outside the view gets none.
 * Returns [{ point, sourceId, sign }] where sign is the sign of the emitting source.
 */
export function seedsAroundSources(sources, { axes, normal, fixed, maxPerSource = 12, ring = 0.12, bounds = null }) {
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
    let start = source.type === 'finite-line' ? source.start : source.position.map(
      (value, i) => value - source.direction[i] * source.displayLength / 2);
    let end = source.type === 'finite-line' ? source.end : source.position.map(
      (value, i) => value + source.direction[i] * source.displayLength / 2);
    let dx = end[axes[0]] - start[axes[0]], dy = end[axes[1]] - start[axes[1]];
    let span = Math.hypot(dx, dy);
    if (bounds && span >= ring) {
      // Seed along the part inside the view; an infinite line counts as a segment of LINE_REACH each way, not just the stretch
      // that is drawn around its reference point.
      if (source.type === 'infinite-line') {
        start = source.position.map((value, i) => value - source.direction[i] * LINE_REACH);
        end = source.position.map((value, i) => value + source.direction[i] * LINE_REACH);
      }
      const clipped = clipSegmentToBox([start[axes[0]], start[axes[1]]], [end[axes[0]], end[axes[1]]], bounds);
      if (!clipped) continue;
      const [from, to] = [start, end];
      start = from.map((value, i) => value + (to[i] - value) * clipped[0]);
      end = from.map((value, i) => value + (to[i] - value) * clipped[1]);
      dx = end[axes[0]] - start[axes[0]]; dy = end[axes[1]] - start[axes[1]];
      span = Math.hypot(dx, dy);
    }
    if (span < ring) {
      // A line (nearly) perpendicular to the view plane shows up as a single point where it pierces the plane: seed a ring
      // around that point exactly like a point charge, so the default xy examples with a z-directed line have field lines.
      const a = (start[axes[0]] + end[axes[0]]) / 2, b = (start[axes[1]] + end[axes[1]]) / 2, radius = ring + span / 2;
      const phase = Math.PI / count;
      for (let k = 0; k < count; k += 1) {
        const angle = phase + 2 * Math.PI * k / count;
        seeds.push({ point: make(a + radius * Math.cos(angle), b + radius * Math.sin(angle)), sourceId: source.id, sign });
      }
      continue;
    }
    const nx = -dy / span, ny = dx / span, along = Math.max(2, Math.round(count / 2));
    for (let k = 0; k < along; k += 1) {
      const t = (k + 0.5) / along;
      const a = start[axes[0]] + dx * t, b = start[axes[1]] + dy * t;
      for (const side of [1, -1]) seeds.push({ point: make(a + side * ring * nx, b + side * ring * ny), sourceId: source.id, sign });
    }
  }
  return seeds;
}

const LINE_REACH = 1e3; // metres: an infinite line is a segment far longer than any view
const PLANE_TOLERANCE = 0.01; // a parallel line this close (normal direction) to the view plane blocks lines in it

/**
 * Stop (absorbing region) of a line charge in the view plane, or null when it does not touch the plane.
 * In the plane (parallel to it): a capsule along its projection. Crossing the plane (perpendicular or oblique): a disk at the
 * piercing point; a finite line that ends before the plane is not seen there. `reason` is 'charge' for every line charge.
 */
export function lineChargeStop(source, { axes, normal, fixed, radius }) {
  const start = source.type === 'finite-line' ? source.start
    : source.position.map((value, i) => value - source.direction[i] * LINE_REACH);
  const end = source.type === 'finite-line' ? source.end
    : source.position.map((value, i) => value + source.direction[i] * LINE_REACH);
  const a0 = [start[axes[0]], start[axes[1]]], a1 = [end[axes[0]], end[axes[1]]];
  const dn = end[normal] - start[normal], total = Math.hypot(...end.map((value, i) => value - start[i]));
  const base = { radius, reason: 'charge', sign: Math.sign(source.lambda), sourceId: source.id };
  if (Math.abs(dn) <= 1e-9 * total) {
    return Math.abs(start[normal] - fixed) <= PLANE_TOLERANCE ? { ...base, center: a0, end: a1 } : null;
  }
  const t = (fixed - start[normal]) / dn;
  if (source.type === 'finite-line' && (t < 0 || t > 1)) return null;
  return { ...base, center: a0.map((value, i) => value + t * (a1[i] - value)) };
}

/**
 * Field lines for a set of sources: positive sources emit forward lines, negative sources emit lines traced against
 * the field (so they start at the negative charge and run outward). A backward line from a negative source that ends on a
 * positive charge (point or line) duplicates a line already emitted there, so it is dropped. Line charges absorb lines
 * ('charge' terminator): a line neither passes through a negative line charge nor jumps over a thin one.
 *
 *   field(p3)  3D point => 3D vector | null
 *   Returns [{ points: [x, y, z][], end, sourceId }] with points in 3D on the plane.
 */
export function traceSourceLines(sources, field, {
  axes, normal, fixed, bounds, stopRadius = 0.06, maxSteps = 360, maxPerSource = 12, ring = 0.12,
}) {
  const seeds = seedsAroundSources(sources, { axes, normal, fixed, maxPerSource, ring, bounds });
  const stops = [];
  for (const source of sources) {
    if (source.enabled === false || strengthOf(source) === 0) continue;
    if (source.type === 'point') {
      stops.push({ center: [source.position[axes[0]], source.position[axes[1]]], radius: stopRadius, sign: Math.sign(source.q), sourceId: source.id });
    } else {
      const stop = lineChargeStop(source, { axes, normal, fixed, radius: stopRadius });
      if (stop) stops.push(stop);
    }
  }
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
    const absorbed = traced.end.reason === 'stop' || traced.end.reason === 'charge';
    if (traced.points.length < 4 && !absorbed) continue;
    if (seed.sign < 0 && absorbed && stops[traced.end.stopIndex].sign > 0) continue;
    // Lines run from the emitting source outward; field lines of a negative source are listed source-first too.
    lines.push({
      points: traced.points.map(([a, b]) => toPlane(a, b)), end: traced.end, sourceId: seed.sourceId, sign: seed.sign,
    });
  }
  return lines;
}
