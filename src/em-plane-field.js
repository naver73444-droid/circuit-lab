// Fields as the plane view needs them: one evaluate(point) plus grid sampling. Pure: no DOM.
//
// A "plane field" is { kind, electric, unit, evaluate(display3) => { status, vector, scalar } }.
//   display3: a point in display coordinates (metres, except the plane wave, which is shown in wavelengths: unit = lambda).
//   vector:   E (V/m) for electric models, B (T) for current models, E for the wave.
//   scalar:   the potential (V) where one exists, otherwise |vector| (the map shows the strength).
import { C, norm3, sceneMeasurement, loopFieldAtN, loopWireDistance } from './em-physics.js';
import { createPointChargeEvaluator } from './em-playground-physics.js';
import { planeAxes, planeNormal } from './em-plane-geometry.js';
import { traceSourceLines, traceStreamline } from './em-fieldlines.js';

const FAILED = { status: 'excluded', vector: null, scalar: NaN };

/** Field of the free charge sandbox (point and line sources). */
export function createSandboxField(sources) {
  const evaluator = createPointChargeEvaluator(sources);
  return {
    kind: 'sandbox', electric: true, unit: 1, scalarName: 'V',
    evaluate(point) {
      let result;
      try { result = evaluator(point); } catch { return FAILED; } // beyond the +-20 m model range
      return result.status === 'valid' ? { status: 'valid', vector: result.E, scalar: result.potential } : FAILED;
    },
  };
}

// The loop's wire is drawn with 64 segments; the display excludes 2% of R around the wire like the numeric model.
function visualMeasurement(model, point) {
  if (model.kind !== 'loop') return sceneMeasurement(model, point, 0);
  const exclusion = Math.max(0.001, 0.02 * model.radius);
  if (model.current !== 0 && loopWireDistance(model, point) <= exclusion) return { status: 'excluded' };
  return { status: 'valid', B: loopFieldAtN(model, point, 64) };
}

/** Field of one of the built-in scenes (charge, dipole, line, loop, wave) at wave time `timeCycles` periods. */
export function createSceneField(model, timeCycles = 0) {
  const isWave = model.kind === 'wave', unit = isWave ? C / model.frequency : 1;
  return {
    kind: model.kind, electric: model.kind === 'charge' || model.kind === 'dipole' || isWave, unit,
    scalarName: model.kind === 'charge' || model.kind === 'dipole' ? 'V' : isWave ? '|E|' : '|B|',
    evaluate(display) {
      const point = display.map(value => value * unit);
      let result;
      try {
        result = isWave ? sceneMeasurement(model, point, timeCycles / model.frequency) : visualMeasurement(model, point);
      } catch { return FAILED; }
      if (result.status !== 'valid') return FAILED;
      const vector = result.E ?? result.B;
      return { status: 'valid', vector, scalar: Number.isFinite(result.potential) ? result.potential : norm3(vector) };
    },
  };
}

function planePointBuilder(plane, fixed) {
  const [a, b] = planeAxes(plane), normal = planeNormal(plane);
  return (u, v) => {
    const p = [0, 0, 0];
    p[a] = u; p[b] = v; p[normal] = fixed;
    return p;
  };
}

/**
 * Scalar values on a cols x rows grid covering `area` (cell centres on the edges of the area, like an image of
 * cols x rows pixels stretched over it). NaN marks points inside a model exclusion zone.
 */
export function sampleScalarGrid(field, plane, fixed, area, cols, rows) {
  const make = planePointBuilder(plane, fixed), values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const b = area.bMax - (area.bMax - area.bMin) * row / (rows - 1);
    for (let col = 0; col < cols; col += 1) {
      const a = area.aMin + (area.aMax - area.aMin) * col / (cols - 1);
      const result = field.evaluate(make(a, b));
      values[row * cols + col] = result.status === 'valid' ? result.scalar : NaN;
    }
  }
  return { cols, rows, values };
}

/**
 * In-plane vector samples on a regular grid of `cols` x `rows` points inside the area (half a cell from its edge).
 * Returns [{ a, b, va, vb, magnitude }] with the in-plane components; excluded points are omitted.
 */
export function sampleVectorGrid(field, plane, fixed, area, cols, rows) {
  const make = planePointBuilder(plane, fixed), [axisA, axisB] = planeAxes(plane), out = [];
  for (let row = 0; row < rows; row += 1) {
    const b = area.bMax - (area.bMax - area.bMin) * (row + 0.5) / rows;
    for (let col = 0; col < cols; col += 1) {
      const a = area.aMin + (area.aMax - area.aMin) * (col + 0.5) / cols;
      const result = field.evaluate(make(a, b));
      if (result.status !== 'valid') continue;
      const va = result.vector[axisA], vb = result.vector[axisB];
      out.push({ a, b, va, vb, magnitude: Math.hypot(va, vb), full: norm3(result.vector) });
    }
  }
  return out;
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
  const vectorOf = point => { const r = field.evaluate(point); return r.status === 'valid' ? r.vector : null; };
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
