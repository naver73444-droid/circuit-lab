import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleCurve, jumpList, breakWraps, wrapPhase } from '../../../src/signals-util.js';

const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const step = (t) => (t < 0 ? 0 : t === 0 ? 0.5 : 1);

test('sampleCurve keeps the three-point jump by default and cuts the polyline with { gaps: true }', () => {
  const plain = sampleCurve(step, -1, 1, 21, [0]);
  assert.equal(plain.filter(([x]) => Math.abs(x) < 1e-6).length, 3);
  assert.ok(plain.some(([x, y]) => x === 0 && y === 0.5)); // the midpoint at the jump (numerics keep it)
  const gapped = sampleCurve(step, -1, 1, 21, [0], { gaps: true });
  assert.ok(!gapped.some(([x, y]) => Math.abs(x) < 1e-6 && y === 0.5), 'no midpoint value is drawn');
  assert.equal(gapped.filter(([, y]) => Number.isNaN(y)).length, 1);
  // a kink without a jump stays continuous
  const kink = sampleCurve((t) => Math.abs(t), -1, 1, 21, [0], { gaps: true });
  assert.equal(kink.filter(([, y]) => Number.isNaN(y)).length, 0);
  assert.deepEqual(gapped.map((p) => p[0]), [...gapped.map((p) => p[0])].sort((a, b) => a - b));
});

test('jumpList reports one-sided limits only for real jumps, once per position, inside the window', () => {
  const list = jumpList(step, [0, 0, 1e-12, 5], -1, 1);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].x, Math.round(list[0].left), Math.round(list[0].right), list[0].closed], [0, 0, 1, null]);
  assert.deepEqual(jumpList((t) => Math.abs(t), [0], -1, 1), []);
  const closedRight = jumpList((t) => (t >= 0 ? 1 : 0), [0], -1, 1, { defined: true });
  assert.equal(closedRight[0].closed, 'right');
  const closedLeft = jumpList((t) => (t > 0 ? 1 : 0), [0], -1, 1, { defined: true });
  assert.equal(closedLeft[0].closed, 'left');
  assert.equal(jumpList((t) => (t > 0 ? 1 : 0), [0], -1, 1)[0].closed, null);
});

test('phase helpers: wrapPhase is the principal value and breakWraps cuts jumps larger than pi', () => {
  near(wrapPhase(-1, 0), Math.PI);
  near(wrapPhase(0, -1), -Math.PI / 2);
  const cut = breakWraps([[0, 3], [1, -3], [2, -2.5]]);
  assert.equal(cut.length, 4);
  assert.equal(cut[1][1], null);
  assert.equal(breakWraps([[0, 1], [1, 2]]).length, 2);
});
