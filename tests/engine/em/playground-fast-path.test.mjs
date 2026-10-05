import test from "node:test";
import assert from "node:assert/strict";
import { createPointChargeEvaluator, evaluatePointChargeWorld, pointChargePlaneSample, validatePointSources } from "../../../src/em-playground-physics.js";
import { loopCirculation, sphereFlux } from "../../../src/em-playground-calculus.js";

const point = (id, q, position) => ({ id, type: 'point', q, position, enabled: true, visible: true });

const finite = { id: 'f1', type: 'finite-line', lambda: 2e-9, start: [-1, 2, 0], end: [1, 2.5, 0.3], enabled: true, visible: true };

const infinite = { id: 'i1', type: 'infinite-line', lambda: -1e-9, position: [0, -2.5, 0], direction: [0, 0, 1], sRef: 1, displayLength: 4, enabled: true, visible: true };

const sixteen = Array.from({ length: 16 }, (_, i) => point(`q${i}`, (i % 2 ? -1 : 1) * 1e-9, [Math.cos(i) * 1.5, Math.sin(i) * 1.5, Math.sin(2 * i) * 0.3]));

const probes = [[0.3, 0.4, 0.1], [1, 0, 0], [-0.7, 1.2, 0.5], [0, 0, 1.4], [3.3, -2.1, 0.8]];

test('fast evaluator and options give bit-identical E/potential to the default path', () => {
  for (const sources of [sixteen.slice(0, 2), sixteen, [...sixteen.slice(0, 3), finite, infinite]]) {
    const evaluator = createPointChargeEvaluator(sources);
    const validated = validatePointSources(sources);
    for (const p of probes) {
      const slow = evaluatePointChargeWorld(sources, p);
      const fast = evaluator(p);
      const viaOptions = evaluatePointChargeWorld(validated, p, { jacobian: false, validated: true });
      for (const result of [fast, viaOptions]) {
        assert.equal(result.status, slow.status);
        assert.deepEqual(result.E, slow.E);
        assert.equal(result.potential, slow.potential);
        assert.deepEqual(result.gradV, slow.gradV);
        assert.equal(result.jacobian, null, 'fast path never builds the Jacobian');
      }
    }
  }
});

test('sphere flux and loop circulation are numerically identical with the fast field', () => {
  const sources = sixteen.slice(0, 4);
  const slowField = p => evaluatePointChargeWorld(sources, p);
  const fastField = createPointChargeEvaluator(sources);
  const center = [0.3, 0.4, 0.1];
  const a = sphereFlux(slowField, center, 0.5, sources), b = sphereFlux(fastField, center, 0.5, sources);
  assert.equal(a.status, 'valid');
  assert.equal(b.flux, a.flux);
  assert.equal(b.coarseFlux, a.coarseFlux);
  assert.deepEqual(b.surfaceContributions, a.surfaceContributions);
  const c = loopCirculation(slowField, center, 0.5, [0, 0, 1], sources), d = loopCirculation(fastField, center, 0.5, [0, 0, 1], sources);
  assert.equal(d.circulation, c.circulation);
});

test('default evaluate keeps the point-charge Jacobian and the plane sample opt-out matches', () => {
  const two = sixteen.slice(0, 2);
  const result = evaluatePointChargeWorld(two, [0.3, 0.4, 0.1]);
  assert.equal(result.status, 'valid');
  assert.ok(Array.isArray(result.jacobian) && result.jacobian.length === 3);
  assert.ok(Math.abs(result.jacobian[0][0] + result.jacobian[1][1] + result.jacobian[2][2]) < 1e-3, 'point-charge Jacobian is traceless outside sources');
  const full = pointChargePlaneSample(two, 'xy', 0.2, { grid: 7 });
  const lean = pointChargePlaneSample(two, 'xy', 0.2, { grid: 7, jacobian: false });
  assert.ok(full.values.every(item => item.result.status !== 'valid' || item.result.jacobian));
  assert.ok(lean.values.every(item => item.result.jacobian === null));
  assert.deepEqual(lean.values.map(item => item.result.potential), full.values.map(item => item.result.potential));
  assert.equal(lean.maxAbsPotential, full.maxAbsPotential);
  assert.equal(lean.maxField, full.maxField);
});

test('Jacobian is null (not a silent point-only matrix) whenever an active line source contributes', () => {
  const p = [0.3, 0.4, 0.1];
  assert.equal(evaluatePointChargeWorld([sixteen[0], finite], p).jacobian, null);
  assert.equal(evaluatePointChargeWorld([sixteen[0], infinite], p).jacobian, null);
  assert.equal(evaluatePointChargeWorld([finite], p).status, 'valid');
  assert.ok(evaluatePointChargeWorld([sixteen[0], { ...finite, enabled: false }], p).jacobian, 'a disabled line contributes nothing, so the point Jacobian is complete');
  assert.ok(evaluatePointChargeWorld([sixteen[0], { ...finite, lambda: 0 }], p).jacobian);
  assert.ok(evaluatePointChargeWorld([sixteen[0]], p).jacobian);
});
