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

// The review's configuration: a (inside, 1.7 mm from the surface) and b (outside, 1.8 mm) both make a spike on the unit sphere.
const TWO = () => {
  const sources = validatePointSources([
    { id: 'a', q: 1.16e-9, position: [0.4586, 0.8516, 0.2471] }, { id: 'b', q: 0.7e-9, position: [0.9328, -0.3418, -0.1292] },
  ]);
  return { sources, field: createPointChargeEvaluator(sources) };
};

test('two charges near the surface: the flux is refined per charge and sums to Q/eps0 = 131.0 V·m (a inside, b outside)', () => {
  const { sources, field } = TWO();
  const plain = sphereFlux(field, [0, 0, 0], 1, sources);
  assert.equal(plain.converged, false, 'the uniform grids alone do not resolve both spikes');
  const refined = sphereFlux(field, [0, 0, 0], 1, sources, { refine: true });
  assert.equal(refined.status, 'valid');
  assert.equal(refined.nearCount, 2);
  assert.equal(refined.refined, true);
  assert.equal(refined.converged, true);
  const expected = 1.16e-9 / EPS0;
  assert.ok(Math.abs(expected - 131.0) < 0.05, `${expected}`);
  assert.ok(Math.abs(refined.flux - expected) < 0.2, `${refined.flux} vs ${expected}`);
});

test('two charges near the surface are never labelled converged when the split cannot be trusted (21% error otherwise)', () => {
  const { sources, field } = TWO();
  // A field that is not the sum of the sources: the per-charge split would integrate something else, so it is refused.
  const scaled = point => { const r = field(point); return r.status === 'valid' ? { ...r, E: r.E.map(value => value * 1.1) } : r; };
  const refused = sphereFlux(scaled, [0, 0, 0], 1, sources, { refine: true });
  assert.equal(refused.converged, false);
  assert.equal(refused.nearCount, 2);
  assert.equal(refused.refined, undefined);
  // the same two charges with a third one inside: still split correctly (one far source rides on the uniform grids)
  const three = validatePointSources([...sources, { id: 'c', q: -0.4e-9, position: [0.1, 0.1, -0.2] }]);
  const result = sphereFlux(createPointChargeEvaluator(three), [0, 0, 0], 1, three, { refine: true });
  assert.equal(result.converged, true);
  assert.ok(Math.abs(result.flux - (1.16e-9 - 0.4e-9) / EPS0) < 0.2, `${result.flux}`);
});
