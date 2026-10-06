import test from 'node:test';
import assert from 'node:assert/strict';
import { clampGauss, coarseSphereFlux, fluxAgrees, gaussEnclosure, predictedFlux } from '../../../src/em-gauss.js';
import { EPS0 } from '../../../src/em-physics.js';
import { createPointChargeEvaluator, validatePointSources } from '../../../src/em-playground-physics.js';
import { sphereFlux } from '../../../src/em-playground-calculus.js';

const point = (id, q, x, y, z = 0) => ({ id, type: 'point', q, position: [x, y, z], enabled: true, visible: true });
const evaluator = sources => createPointChargeEvaluator(validatePointSources(sources));

test('a sphere around one of two opposite charges encloses exactly that charge', () => {
  const sources = [point('p', 1e-9, -0.75, 0), point('n', -1e-9, 0.75, 0)];
  const around = gaussEnclosure(sources, [-0.75, 0, 0], 0.4);
  assert.equal(around.status, 'ok');
  assert.deepEqual(around.enclosedIds, ['p']);
  assert.deepEqual(around.outsideIds, ['n']);
  assert.equal(around.enclosedCharge, 1e-9);
  assert.equal(predictedFlux(around.enclosedCharge), 1e-9 / EPS0);
  const both = gaussEnclosure(sources, [0, 0, 0], 2);
  assert.equal(both.enclosedCharge, 0);
  assert.equal(both.enclosedIds.length, 2);
});

test('Phi from the coarse and the converged integral match q / eps0 within 2%', () => {
  const sources = [point('p', 1e-9, -0.75, 0), point('n', -1e-9, 0.75, 0)];
  const field = evaluator(sources);
  for (const [center, radius] of [[[-0.75, 0, 0], 0.4], [[-0.5, 0.2, 0], 0.9], [[-0.6, 0, 0], 0.3]]) {
    const enclosure = gaussEnclosure(sources, center, radius);
    assert.equal(enclosure.status, 'ok');
    const expected = predictedFlux(enclosure.enclosedCharge);
    const coarse = coarseSphereFlux(field, center, radius);
    const precise = sphereFlux(field, center, radius, sources);
    assert.equal(coarse.status, 'valid');
    assert.ok(fluxAgrees(coarse.flux, expected, 0.02), `coarse ${coarse.flux} vs ${expected}`);
    assert.ok(fluxAgrees(precise.flux, expected, 0.02), `precise ${precise.flux} vs ${expected}`);
  }
});

test('a sphere that encloses nothing has ~zero flux', () => {
  const sources = [point('p', 1e-9, -0.75, 0), point('n', -1e-9, 0.75, 0)];
  const center = [3, 3, 0], radius = 0.5;
  assert.equal(gaussEnclosure(sources, center, radius).enclosedCharge, 0);
  const coarse = coarseSphereFlux(evaluator(sources), center, radius);
  assert.ok(Math.abs(coarse.flux) < 0.02 * (1e-9 / EPS0));
});

test('a point charge on the surface is excluded; crossing lines are unsupported', () => {
  const sources = [point('p', 1e-9, 0.5, 0)];
  assert.equal(gaussEnclosure(sources, [0, 0, 0], 0.5).status, 'excluded');
  const lines = validatePointSources([
    { id: 'f', type: 'finite-line', lambda: 1e-9, start: [0, -1, 0], end: [0, 1, 0] },
  ]);
  const crossing = gaussEnclosure(lines, [0, 0, 0], 0.5);
  assert.equal(crossing.status, 'unsupported');
  assert.deepEqual(crossing.crossingIds, ['f']);
  const inside = gaussEnclosure(lines, [0, 0, 0], 2);
  assert.equal(inside.status, 'ok');
  assert.ok(Math.abs(inside.enclosedCharge - 2e-9) < 1e-21);
  const infinite = validatePointSources([
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [3, 0, 0], direction: [0, 0, 1], sRef: 1, displayLength: 4 },
  ]);
  assert.equal(gaussEnclosure(infinite, [0, 0, 0], 1).status, 'ok');
  assert.equal(gaussEnclosure(infinite, [0, 0, 0], 3.5).status, 'unsupported');
});

test('disabled sources are ignored and the surface is clamped to the supported range', () => {
  const sources = [{ ...point('off', 1e-9, 0, 0), enabled: false }];
  assert.equal(gaussEnclosure(sources, [0, 0, 0], 1).enclosedCharge, 0);
  assert.deepEqual(clampGauss({ center: [30, 0, 0], radius: 100 }), { center: [15, 0, 0], radius: 5 });
  assert.equal(clampGauss({ center: [0, 0, 0], radius: 0 }).radius, 0.05);
});
