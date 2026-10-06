import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MU0, ellipticKE, loopCurrentField, loopCurrentFieldNumeric, loopFieldClosedForm, loopWireDistance, norm3, sub3,
} from '../../../src/em-physics.js';

const relative = (a, b) => norm3(sub3(a, b)) / norm3(b);

test('complete elliptic integrals by the AGM match known values', () => {
  const zero = ellipticKE(0, 1);
  assert.ok(Math.abs(zero.K - Math.PI / 2) < 1e-15 && Math.abs(zero.E - Math.PI / 2) < 1e-15);
  const half = ellipticKE(0.5, Math.sqrt(0.5)); // K(m = 1/2) = 1.8540746773013719, E(m = 1/2) = 1.3506438810476755
  assert.ok(Math.abs(half.K - 1.8540746773013719) < 1e-14, String(half.K));
  assert.ok(Math.abs(half.E - 1.3506438810476755) < 1e-14, String(half.E));
  const near = ellipticKE(1 - 1e-6, 1e-3); // K ~ ln(4 / k') = 8.3, E -> 1
  assert.ok(near.K > 8.2 && near.K < 8.4 && Math.abs(near.E - 1) < 1e-4);
});

test('closed-form loop field equals the converged numerical evaluator to 1e-6 relative, away from the wire', () => {
  const models = [
    { current: 1, radius: 1, center: [0, 0, 0], normal: [0, 0, 1] },
    { current: -2.5, radius: 0.6, center: [0.3, -0.2, 0.1], normal: [0, 1, 0] },
    { current: 1, radius: 2, center: [0, 0, 0], normal: [1, 1, 1] },
  ];
  let checked = 0;
  for (const model of models) {
    for (const [x, y, z] of [[.5, 0, .5], [.3, .4, .2], [1.5, .1, .8], [.2, -.9, 0], [2, 1, -1.3], [0, 0, .7], [.7, 0, .1], [-1.1, .8, .3], [.05, .02, .02]]) {
      const point = [model.center[0] + x, model.center[1] + y, model.center[2] + z];
      // keep at least 0.1 R from the wire (the numerical sum is the reference there)
      if (loopWireDistance(model, point) < 0.1 * model.radius) continue;
      const exact = loopCurrentField(model, point), numeric = loopCurrentFieldNumeric(model, point);
      assert.equal(exact.status, 'valid');
      assert.equal(exact.converged, true);
      assert.ok(relative(exact.B, numeric.B) < 1e-6, `${JSON.stringify(model)} at ${point}: ${relative(exact.B, numeric.B)}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `${checked} comparisons`);
});

test('closed form: axis, centre, the field at 0.021 R from the wire, symmetry and the exclusion zone', () => {
  const loop = { current: 1, radius: 1, center: [0, 0, 0], normal: [0, 0, 1] };
  // centre: mu0 I / (2 R); axis: mu0 I R^2 / (2 (R^2 + z^2)^1.5)
  assert.ok(Math.abs(loopFieldClosedForm(loop, [0, 0, 0])[2] - MU0 / 2) < 1e-15);
  assert.ok(Math.abs(loopFieldClosedForm(loop, [0, 0, 1])[2] - MU0 / (2 * 2 ** 1.5)) < 1e-15);
  // continuity onto the axis series: a point 1e-7 R off the axis agrees with the axis value to rounding
  const off = loopFieldClosedForm(loop, [1e-7, 0, 0.5]), on = loopFieldClosedForm(loop, [0, 0, 0.5]);
  assert.ok(Math.abs(off[2] - on[2]) < 1e-12 * on[2]);
  // the converged -8.937 uT of the review (a point 0.021 R from the wire), which a 64-segment sum misses by 74%
  assert.ok(Math.abs(loopFieldClosedForm(loop, [1.021, 0, 0])[2] + 8.937e-6) / 8.937e-6 < 1e-3);
  // mirror symmetry about the loop plane and the sign of the current
  const up = loopFieldClosedForm(loop, [.6, 0, .4]), down = loopFieldClosedForm(loop, [.6, 0, -.4]);
  assert.ok(Math.abs(up[0] + down[0]) < 1e-18 && Math.abs(up[2] - down[2]) < 1e-18);
  assert.ok(up[0] > 0, 'the field spreads outward above a counter-clockwise loop');
  const reversed = loopFieldClosedForm({ ...loop, current: -1 }, [.6, 0, .4]);
  assert.ok(relative(reversed, up.map(value => -value)) < 1e-15);
  assert.equal(loopCurrentField(loop, [1.01, 0, 0]).status, 'excluded');
  assert.deepEqual(loopFieldClosedForm({ ...loop, current: 0 }, [.5, 0, 0]), [0, 0, 0]);
});

test('closed form costs the same everywhere: thousands of points near the wire take a fraction of a second', () => {
  const loop = { current: 1, radius: 1, center: [0, 0, 0], normal: [0, 0, 1] };
  const started = performance.now();
  let sum = 0;
  for (let i = 0; i < 20000; i += 1) sum += loopCurrentField(loop, [1.03 + (i % 100) * 1e-4, 0, (i % 7) * 1e-3]).B[2];
  const elapsed = performance.now() - started;
  assert.ok(Number.isFinite(sum));
  // the converged numerical sum needs several hundred segments per point this close to the wire
  assert.ok(elapsed < 1500, `${elapsed} ms for 20000 points`);
});
