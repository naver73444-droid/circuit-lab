import test from 'node:test';
import assert from 'node:assert/strict';
import { sphereFlux } from '../../../src/em-playground-calculus.js';
import { createPointChargeEvaluator, validatePointSources } from '../../../src/em-playground-physics.js';
import { EPS0 } from '../../../src/em-physics.js';

const setup = x => {
  const sources = validatePointSources([{ id: 'q', q: 1e-9, position: [x, 0, 0] }]);
  return { sources, field: createPointChargeEvaluator(sources) };
};
const EXPECTED = 1e-9 / EPS0; // 112.94 V·m

test('a charge 3 mm inside a 1 m sphere: the uniform grids disagree (76 vs 113 V·m, not converged), the refinement converges to Q/eps0', () => {
  const { sources, field } = setup(0.997);
  const plain = sphereFlux(field, [0, 0, 0], 1, sources);
  assert.equal(plain.converged, false);
  assert.ok(Math.abs(plain.flux - 76.4) < 0.5, 'the former wrong number');
  const refined = sphereFlux(field, [0, 0, 0], 1, sources, { refine: true });
  assert.equal(refined.status, 'valid');
  assert.equal(refined.converged, true);
  assert.equal(refined.refined, true);
  assert.ok(Math.abs(refined.flux - EXPECTED) < 0.05, `${refined.flux} vs ${EXPECTED}`);
});

test('refinement also handles a charge just outside the surface (flux ~ 0) and leaves well-resolved cases alone', () => {
  const outside = setup(1.01);
  const refined = sphereFlux(outside.field, [0, 0, 0], 1, outside.sources, { refine: true });
  assert.equal(refined.converged, true);
  assert.ok(Math.abs(refined.flux) < 0.05);
  const easy = setup(0.9);
  const result = sphereFlux(easy.field, [0, 0, 0], 1, easy.sources, { refine: true });
  assert.equal(result.converged, true);
  assert.equal(result.refined, undefined, 'no refinement when the plain grids already agree');
});

test('without the refine option nothing changes: the unconverged result is reported as such', () => {
  const { sources, field } = setup(0.99);
  const result = sphereFlux(field, [0, 0, 0], 1, sources);
  assert.equal(result.converged, false);
  assert.equal(result.refined, undefined);
});
