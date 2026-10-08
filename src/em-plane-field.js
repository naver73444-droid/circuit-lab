// Fields as the plane view needs them: one evaluate(point) plus grid sampling. Pure: no DOM.
//
// A "plane field" is { kind, electric, unit, evaluate(display3) => { status, vector, scalar } }.
//   display3: a point in display coordinates (metres, except the plane wave, which is shown in wavelengths: unit = lambda).
//   vector:   E (V/m) for electric models, B (T) for current models, E for the wave.
//   scalar:   the potential (V) where one exists, otherwise |vector| (the map shows the strength).
// The sandbox fields (charges, currents) also offer fast paths for the picture:
//   sample(x, y, z, out) => boolean   vector into out[0..2], scalar into out[3], no arrays per point (same numbers as evaluate)
//   parts, inRange, scalarOfSum       one contribution per source, for the per-source cache of createSuperpositionSampler
import { C, norm3, sceneMeasurement } from './em-physics.js';
import {
  createPointChargeEvaluator, createPointChargeSampler, inModelRange, pointChargeParts, validatePointSources,
} from './em-playground-physics.js';
import { planeAxes, planeNormal } from './em-plane-geometry.js';
import { traceSourceLines, traceStreamline } from './em-fieldlines.js';
import { traceCurrentLines } from './em-current-lines.js';

const FAILED = { status: 'excluded', vector: null, scalar: NaN };

/** Field of the free charge sandbox (point and line sources). */
export function createSandboxField(sources) {
  const evaluator = createPointChargeEvaluator(sources), validated = validatePointSources(sources), parts = pointChargeParts(validated);
  return {
    kind: 'sandbox', electric: true, unit: 1, scalarName: 'V',
    sample: createPointChargeSampler(validated, parts), parts, inRange: inModelRange, scalarOfSum: 'sum',
    evaluate(point) {
      let result;
      try { result = evaluator(point); } catch { return FAILED; } // beyond the +-20 m model range
      return result.status === 'valid' ? { status: 'valid', vector: result.E, scalar: result.potential } : FAILED;
    },
  };
}

/**
 * Field of one of the built-in scenes (charge, dipole, line, loop, wave) at wave time `timeCycles` periods.
 * Every value is exact and cheap: the loop uses the closed-form elliptic-integral field of em-physics, so the map, the lines and
 * the sensor share one converged evaluator and no draft approximation exists. Draft quality only lowers the sampling resolution.
 */
export function createSceneField(model, timeCycles = 0) {
  const isWave = model.kind === 'wave', unit = isWave ? C / model.frequency : 1;
  return {
    kind: model.kind, electric: model.kind === 'charge' || model.kind === 'dipole' || isWave, unit,
    scalarName: model.kind === 'charge' || model.kind === 'dipole' ? 'V' : isWave ? '|E|' : '|B|',
    evaluate(display) {
      const point = display.map(value => value * unit);
      let result;
      try {
        result = sceneMeasurement(model, point, isWave ? timeCycles / model.frequency : 0);
      } catch { return FAILED; }
      if (result.status !== 'valid') return FAILED;
      const vector = result.E ?? result.B;
      return { status: 'valid', vector, scalar: Number.isFinite(result.potential) ? result.potential : norm3(vector) };
    },
  };
}

/** The field at (x, y, z) into out (vector 0..2, scalar 3); false where it has no value. Uses the fast path when there is one. */
function samplerOf(field) {
  if (field.sample) return field.sample;
  return (x, y, z, out) => {
    const result = field.evaluate([x, y, z]);
    if (result.status !== 'valid') return false;
    out[0] = result.vector[0]; out[1] = result.vector[1]; out[2] = result.vector[2]; out[3] = result.scalar;
    return true;
  };
}

// Plane positions of a grid as a flat [x, y, z, x, y, z, ...] list (display coordinates). `centres` false: cols x rows points
// with the outer ones on the edges of the area (the colour grid); true: the centres of cols x rows cells (the arrow grid).
function gridPoints(plane, fixed, area, cols, rows, centres) {
  const [axisA, axisB] = planeAxes(plane), normal = planeNormal(plane), points = new Float64Array(cols * rows * 3);
  for (let row = 0; row < rows; row += 1) {
    const b = centres ? area.bMax - (area.bMax - area.bMin) * (row + 0.5) / rows : area.bMax - (area.bMax - area.bMin) * row / (rows - 1);
    for (let col = 0; col < cols; col += 1) {
      const a = centres ? area.aMin + (area.aMax - area.aMin) * (col + 0.5) / cols : area.aMin + (area.aMax - area.aMin) * col / (cols - 1);
      const i = 3 * (row * cols + col);
      points[i + axisA] = a; points[i + axisB] = b; points[i + normal] = fixed;
    }
  }
  return points;
}

/**
 * Scalar values on a cols x rows grid covering `area` (cell centres on the edges of the area, like an image of
 * cols x rows pixels stretched over it). NaN marks points inside a model exclusion zone.
 */
export function sampleScalarGrid(field, plane, fixed, area, cols, rows) {
  const points = gridPoints(plane, fixed, area, cols, rows, false), values = new Float32Array(cols * rows);
  const at = samplerOf(field), out = new Float64Array(4);
  for (let i = 0; i < values.length; i += 1) values[i] = at(points[3 * i], points[3 * i + 1], points[3 * i + 2], out) ? out[3] : NaN;
  return { cols, rows, values };
}

/**
 * In-plane vector samples on a regular grid of `cols` x `rows` points inside the area (half a cell from its edge).
 * Returns [{ a, b, va, vb, magnitude }] with the in-plane components; excluded points are omitted.
 */
export function sampleVectorGrid(field, plane, fixed, area, cols, rows) {
  const points = gridPoints(plane, fixed, area, cols, rows, true), at = samplerOf(field);
  return vectorSamples(plane, points, (i, out) => at(points[3 * i], points[3 * i + 1], points[3 * i + 2], out));
}

function vectorSamples(plane, points, valueAt) {
  const [axisA, axisB] = planeAxes(plane), value = new Float64Array(4), out = [];
  for (let i = 0; 3 * i < points.length; i += 1) {
    if (!valueAt(i, value)) continue;
    const va = value[axisA], vb = value[axisB];
    out.push({
      a: points[3 * i + axisA], b: points[3 * i + axisB], va, vb, magnitude: Math.hypot(va, vb), full: Math.hypot(value[0], value[1], value[2]),
    });
  }
  return out;
}

/**
 * Colour and arrow grids with a per-source cache. Both grids are sums of one contribution per source (superposition), so while
 * one source is dragged only that source is evaluated on the grid and the remembered contributions of the others are added.
 * Contributions are added in source order starting from zero, exactly as the direct evaluation does, so the sums carry the same
 * bits as sampleScalarGrid / sampleVectorGrid (tested): the cache only skips evaluating sources whose description is unchanged.
 * Fields without parts (the built-in scenes) are sampled directly. The last `keep` point sets (draft, final, arrows) are
 * remembered; the contributions of sources that are gone are dropped on the next use of that point set. Each contribution keeps
 * only what its grid needs: the potential (electric colour grid: a sum of potentials) or the vector (|sum of B|, the arrows).
 */
export function createSuperpositionSampler({ keep = 4 } = {}) {
  // point-set key -> { points, vector, parts: Map(source key -> { valid: Uint8Array, values: Float64Array }) }
  const sets = new Map();
  const stats = { evaluated: 0, reused: 0 };

  // vector: the contributions keep E or B (three numbers per point); otherwise the potential only.
  function pointSet(plane, fixed, area, cols, rows, centres, vector) {
    const key = JSON.stringify([plane, fixed, area.aMin, area.aMax, area.bMin, area.bMax, cols, rows, centres, vector]);
    let set = sets.get(key);
    if (set) sets.delete(key); // re-inserted below: the map order is the order of use
    else set = { points: gridPoints(plane, fixed, area, cols, rows, centres), vector, parts: new Map() };
    sets.set(key, set);
    while (sets.size > keep) sets.delete(sets.keys().next().value);
    return set;
  }

  function contribution(set, part) {
    let entry = set.parts.get(part.key);
    if (entry) { stats.reused += 1; return entry; }
    const { points, vector } = set, count = points.length / 3, valid = new Uint8Array(count);
    const values = new Float64Array((vector ? 3 : 1) * count), one = new Float64Array(4);
    for (let i = 0; i < count; i += 1) {
      if (!part.at(points[3 * i], points[3 * i + 1], points[3 * i + 2], one)) continue;
      valid[i] = 1;
      if (vector) { values[3 * i] = one[0]; values[3 * i + 1] = one[1]; values[3 * i + 2] = one[2]; } else values[i] = one[3];
    }
    stats.evaluated += 1;
    entry = { valid, values };
    set.parts.set(part.key, entry);
    return entry;
  }

  // The summed field of all parts on a point set: (i, out) => boolean, like a field's sample() at point i.
  function summed(field, set) {
    const entries = field.parts.map(part => contribution(set, part)), used = new Set(field.parts.map(part => part.key));
    for (const key of [...set.parts.keys()]) if (!used.has(key)) set.parts.delete(key);
    const { points, vector } = set, magnitude = field.scalarOfSum === 'magnitude';
    if (!vector) {
      return (i, out) => {
        if (!field.inRange(points[3 * i], points[3 * i + 1], points[3 * i + 2])) return false;
        let scalar = 0;
        for (const { valid, values } of entries) { if (!valid[i]) return false; scalar += values[i]; }
        out[3] = scalar;
        return true;
      };
    }
    return (i, out) => {
      if (!field.inRange(points[3 * i], points[3 * i + 1], points[3 * i + 2])) return false;
      let v0 = 0, v1 = 0, v2 = 0;
      for (const { valid, values } of entries) {
        if (!valid[i]) return false;
        v0 += values[3 * i]; v1 += values[3 * i + 1]; v2 += values[3 * i + 2];
      }
      out[0] = v0; out[1] = v1; out[2] = v2; out[3] = magnitude ? Math.hypot(v0, v1, v2) : NaN;
      return true;
    };
  }

  return {
    stats,
    /** Same result as sampleScalarGrid(field, plane, fixed, area, cols, rows). */
    scalarGrid(field, plane, fixed, area, cols, rows) {
      if (!field.parts) return sampleScalarGrid(field, plane, fixed, area, cols, rows);
      const set = pointSet(plane, fixed, area, cols, rows, false, field.scalarOfSum === 'magnitude');
      const valueAt = summed(field, set), values = new Float32Array(cols * rows);
      const out = new Float64Array(4);
      for (let i = 0; i < values.length; i += 1) values[i] = valueAt(i, out) ? out[3] : NaN;
      return { cols, rows, values };
    },
    /** Same result as sampleVectorGrid(field, plane, fixed, area, cols, rows). */
    vectorGrid(field, plane, fixed, area, cols, rows) {
      if (!field.parts) return sampleVectorGrid(field, plane, fixed, area, cols, rows);
      const set = pointSet(plane, fixed, area, cols, rows, true, true);
      return vectorSamples(plane, set.points, summed(field, set));
    },
  };
}

/** Display coordinates <-> stored metres for a field (wave scenes show r / lambda). */
export const toDisplay = (field, metres) => metres.map(value => value / field.unit);
export const toMetres = (field, display) => display.map(value => value * field.unit);

// ---- field lines for the view -----------------------------------------------------------------------------------

const QUALITY = {
  draft: { perSource: 6, maxSteps: 140, ring: 0.14 },
  final: { perSource: 12, maxSteps: 360, ring: 0.12 },
};

/** Point-source stand-ins for the electric scenes, so their lines are seeded like the sandbox's. */
export function sceneChargeSources(model) {
  const source = (id, q, position) => ({ id, type: 'point', q, position, enabled: true, visible: true });
  if (model.kind === 'charge') return [source('q', model.q, model.position)];
  if (model.kind !== 'dipole') return [];
  const half = model.axis.map(value => value * model.separation / 2 / Math.hypot(...model.axis));
  return [
    source('+', model.q, model.center.map((value, i) => value + half[i])),
    source('−', -model.q, model.center.map((value, i) => value - half[i])),
  ];
}

// Seeds for the closed lines of the current scenes: points along the first in-plane axis (display coordinates).
function currentSeeds(model, plane, fixed) {
  const [a, b] = planeAxes(plane), normal = planeNormal(plane);
  const radii = model.kind === 'loop' ? [0.15, 0.45, 0.75, 1.3, 1.7].map(f => f * model.radius) : [0.4, 0.8, 1.2, 1.6];
  return radii.map(r => {
    const point = [0, 0, 0];
    point[a] = r; point[b] = 0; point[normal] = fixed;
    return point;
  });
}

/**
 * Field lines inside `area` for the sandbox or a scene: [{ points: 3D display points, sign }].
 * Charges (sandbox, charge, dipole) emit lines from each source; current scenes (line, loop) trace closed lines
 * through a few seed points in both directions; the plane wave has none.
 */
export function computePlaneLines(field, { plane, fixed, area, sources = [], model = null, quality = 'final' }) {
  const [a, b] = planeAxes(plane), normal = planeNormal(plane), options = QUALITY[quality];
  const bounds = { aMin: area.aMin, aMax: area.aMax, bMin: area.bMin, bMax: area.bMax };
  const at = samplerOf(field), out = new Float64Array(4);
  const vectorOf = point => (at(point[0], point[1], point[2], out) ? [out[0], out[1], out[2]] : null);
  if (field.kind === 'current') return traceCurrentLines(sources, vectorOf, { plane, fixed, bounds, quality });
  const chargeSources = model ? sceneChargeSources(model) : sources;
  if (chargeSources.length) {
    return traceSourceLines(chargeSources, vectorOf, {
      axes: [a, b], normal, fixed, bounds, maxPerSource: options.perSource, maxSteps: options.maxSteps, ring: options.ring,
    });
  }
  if (!model || (model.kind !== 'line' && model.kind !== 'loop')) return [];
  const box = { min: [bounds.aMin, bounds.bMin], max: [bounds.aMax, bounds.bMax] };
  const field2 = ([u, v]) => {
    const p = [0, 0, 0];
    p[a] = u; p[b] = v; p[normal] = fixed;
    const vector = vectorOf(p);
    return vector ? [vector[a], vector[b]] : null;
  };
  const lines = [];
  for (const seed of currentSeeds(model, plane, fixed)) {
    const start = [seed[a], seed[b]];
    const parts = [1, -1].map(direction => traceStreamline({
      field: field2, seed: start, direction, bounds: box, maxSteps: options.maxSteps, step: { min: 0.01, max: 0.1, fraction: 0.5 },
    }));
    const points = [...parts[1].points.slice(1).reverse(), ...parts[0].points];
    if (points.length < 3) continue;
    lines.push({
      points: points.map(([u, v]) => { const p = [0, 0, 0]; p[a] = u; p[b] = v; p[normal] = fixed; return p; }),
      end: parts[0].end, sourceId: model.kind, sign: 1,
    });
  }
  return lines;
}
