import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePointChargeWorld, validatePointSources } from '../../../src/em-playground-physics.js';

const C_STAR = 299792458;
const MU_STAR = 1.25663706127e-6;
const K_STAR = MU_STAR * C_STAR ** 2 / (4 * Math.PI);
const A = K_STAR * 1e-9;
const close = (actual, expected, absolute = 1e-8, relative = 1e-10) => assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);
const vectorClose = (actual, expected) => actual.forEach((value, index) => close(value, expected[index]));
const q = (id, chargeNc, position, extra = {}) => ({ id, q: chargeNc * 1e-9, position, enabled: true, visible: true, ...extra });

test('P01–P03: sign and inverse-distance movement keep E, V and gradV coupled', () => {
  let result = evaluatePointChargeWorld([q('a', 1, [0, 0, 0])], [1, 0, 0]);
  vectorClose(result.E, [A, 0, 0]); close(result.potential, A); vectorClose(result.gradV, [-A, 0, 0]);
  result = evaluatePointChargeWorld([q('a', -1, [0, 0, 0])], [1, 0, 0]);
  vectorClose(result.E, [-A, 0, 0]); close(result.potential, -A); vectorClose(result.gradV, [A, 0, 0]);
  result = evaluatePointChargeWorld([q('a', 1, [0.5, 0, 0])], [1, 0, 0]);
  vectorClose(result.E, [4 * A, 0, 0]); close(result.potential, 2 * A); vectorClose(result.gradV, [-4 * A, 0, 0]);
});

test('P04–P05: superposition distinguishes zero potential from zero field', () => {
  let result = evaluatePointChargeWorld([q('left', 1, [-1, 0, 0]), q('right', -1, [1, 0, 0])], [0, 0, 0]);
  vectorClose(result.E, [2 * A, 0, 0]); close(result.potential, 0);
  result = evaluatePointChargeWorld([q('left', 1, [-1, 0, 0]), q('right', 1, [1, 0, 0])], [0, 0, 0]);
  vectorClose(result.E, [0, 0, 0]); close(result.potential, 2 * A); vectorClose(result.gradV, [0, 0, 0]);
});

test('P11: three-source result is order invariant and IDs do not affect physics', () => {
  const sources = [q('left', 1, [-1, 0, 0]), q('right', -1, [1, 0, 0]), q('third', 2, [0, -1, 0])];
  const first = evaluatePointChargeWorld(sources, [0, 0, 0]);
  const reordered = evaluatePointChargeWorld([sources[2], sources[0], sources[1]], [0, 0, 0]);
  vectorClose(first.E, [2 * A, 2 * A, 0]); close(first.potential, 2 * A);
  vectorClose(reordered.E, first.E); close(reordered.potential, first.potential); vectorClose(reordered.gradV, first.gradV);
});

test('3D point and P12 Jacobian retain the z derivative', () => {
  let result = evaluatePointChargeWorld([q('origin', 1, [0, 0, 0])], [1, 2, 2]);
  vectorClose(result.E, [A / 27, 2 * A / 27, 2 * A / 27]); close(result.potential, A / 3); vectorClose(result.gradV, result.E.map(value => -value));
  result = evaluatePointChargeWorld([q('origin', 1, [0, 0, 0])], [1, 0, 0]);
  close(result.jacobian[0][0], -2 * A); close(result.jacobian[1][1], A); close(result.jacobian[2][2], A);
  close(result.jacobian[0][0] + result.jacobian[1][1] + result.jacobian[2][2], 0);
  assert.notEqual(result.jacobian[0][0] + result.jacobian[1][1], 0, 'XY-only divergence must not masquerade as 3D divergence');
});

test('disabled and zero sources do not exclude, active sources do even when colocated charges cancel', () => {
  assert.equal(evaluatePointChargeWorld([q('zero', 0, [0, 0, 0])], [0, 0, 0]).status, 'valid');
  assert.equal(evaluatePointChargeWorld([q('off', 1, [0, 0, 0], { enabled: false })], [0, 0, 0]).status, 'valid');
  assert.equal(evaluatePointChargeWorld([q('a', 1, [0, 0, 0]), q('b', -1, [0, 0, 0])], [0, 0, 0]).status, 'excluded');
  assert.equal(evaluatePointChargeWorld([q('hidden', 1, [0, 0, 0], { visible: false })], [1, 0, 0]).potential, A);
});

test('source validation accepts 16, rejects 17, duplicates, invalid dimensions and ranges', () => {
  assert.equal(validatePointSources(Array.from({ length: 16 }, (_, index) => q(`q${index}`, 1, [index / 10, 0, 0]))).length, 16);
  assert.throws(() => validatePointSources(Array.from({ length: 17 }, (_, index) => q(`q${index}`, 1, [0, 0, 0]))), /최대 16개/);
  assert.throws(() => validatePointSources([q('same', 1, [0, 0, 0]), q('same', 1, [1, 0, 0])]), /중복/);
  assert.throws(() => validatePointSources([q('bad', 1001, [0, 0, 0])]), /±1 µC/);
  assert.throws(() => validatePointSources([q('bad', 1, [21, 0, 0])]), /±20 m/);
});
