import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_FAMILIES, baseSignal, baseEdges, transformedSignal, transformedEdges, stageSignals, sequenceUpsample, sequenceTransform, timeMap, affineText,
  normalizeTimeParams, timeLesson, markerDomain, isSteps, timeAxisOf, TIME_SEQUENCE, describeTimeMap, isJumpMarker,
} from '../../../src/signals-time-model.js';
import { sampleCurve, jumpList } from '../../../src/signals-util.js';

const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);

test('Ex 1.3 signal: 2 on [-1,2), 1 on [2,3), -0.5 on [3,6], 0 elsewhere', () => {
  const x = (u) => baseSignal('steps', u);
  assert.deepEqual([-2, -1, 0, 1.99, 2, 2.5, 3, 5.9, 6, 6.01].map(x), [0, 2, 2, 2, 1, 1, -0.5, -0.5, -0.5, 0]);
  assert.deepEqual(baseEdges('steps'), [-1, 2, 3, 6]);
  assert.equal(isSteps('steps-r'), true);
  assert.deepEqual(markerDomain('steps'), { min: -1, max: 6, step: 0.05 });
});

test('Ex 1.3(a): g(t) = x(2t - 5) is x(2(t - 2.5)): [2,3.5) -> 2, [3.5,4) -> 1, [4,5.5] -> -0.5', () => {
  const g = (t) => transformedSignal('steps', 2, 5, t);
  assert.deepEqual([2, 3, 3.49, 3.5, 3.9, 4, 5, 5.5, 5.51, 1.99].map(g), [2, 2, 2, 1, 1, -0.5, -0.5, -0.5, 0, 0]);
  assert.deepEqual(transformedEdges('steps', 2, 5), [2, 3.5, 4, 5.5]);
  // x(at - b) = x(a (t - b/a))
  for (const t of [-1.3, 0.2, 2.7, 3.7, 4.4, 5.4]) near(g(t), baseSignal('steps', 2 * (t - 5 / 2)));
  assert.equal(affineText(2, 5).plain, 'x(2t−5)');
  assert.equal(affineText(2, 5).grouped, 'x(2(t−2.5))');
  const map = timeMap('steps', { a: 2, b: 5 });
  assert.deepEqual([map.a, map.b], [2, 5]);
});

test('Ex 1.3(b): h(t) = x(-4t + 2) = x(a t - b) with a = -4, b = -2: [-1,-0.25] -> -0.5, (-0.25,0] -> 1, (0,0.75] -> 2', () => {
  const h = (t) => transformedSignal('steps-r', -4, -2, t);
  assert.deepEqual([-1, -0.6, -0.25, -0.2, 0, 0.01, 0.5, 0.75].map(h), [-0.5, -0.5, -0.5, 1, 1, 2, 2, 2]);
  assert.equal(h(-1.05), 0);
  assert.equal(h(0.76), 0);
  // the slider reaches a = -4 and b = -2 (the sliders now go to +-4 and +-5)
  const [a, b] = timeLesson.controls('steps-r');
  assert.deepEqual([a.initial, b.initial], [-4, -2]);
  assert.ok(a.min <= -4 && a.max >= 4 && b.min <= -5 && b.max >= 5);
  const text = affineText(-4, -2);
  assert.equal(text.plain, 'x(−4t+2)');
  assert.equal(text.grouped, 'x(−4(t−0.5))');
  assert.match(timeLesson.read('steps-r', { a: -4, b: -2 }), /x\(−4t\+2\) = x\(−4\(t−0\.5\)\) \(스케일→이동→반전\)/);
  assert.match(timeLesson.read('steps', { a: 2, b: 5 }), /x\(2t−5\) = x\(2\(t−2\.5\)\) \(스케일→이동\)/);
});

test('intermediate stages: scale first, then shift by b/|a|, reversal last (h1 = x(4t), h2 = h1(t + 0.5), h = h2(-t))', () => {
  const s = stageSignals('steps-r', -4, -2);
  // h1(t) = x(4 t): [-0.25, 0.5) -> 2, [0.5, 0.75) -> 1, [0.75, 1.5] -> -0.5
  assert.deepEqual([-0.25, 0.3, 0.5, 0.7, 0.75, 1.4, 1.6].map(s.scaled), [2, 2, 1, 1, -0.5, -0.5, 0]);
  near(s.shiftBy, -0.5); // shifted left by 0.5: h2(t) = h1(t + 0.5)
  for (const t of [-0.8, -0.2, 0.1, 0.6, 1]) {
    near(s.shifted(t), s.scaled(t + 0.5)); // h2
    near(s.final(t), s.shifted(-t)); // h(t) = h2(-t)
    near(s.final(t), baseSignal('steps-r', -4 * t + 2));
  }
  // positive scale: no reversal, the shifted stage is the answer
  const p = stageSignals('steps', 2, 5);
  for (const t of [0, 2.2, 3.6, 4.2, 5]) near(p.shifted(t), p.final(t));
  near(p.shiftBy, 2.5);
  // every family and a general (a, b): stage composition equals the direct evaluation
  for (const family of ['tri', 'rect', 'exp', 'steps']) {
    for (const [a, b] of [[1.7, -0.3], [-2.2, 1.4], [0.6, 2], [-0.5, -3]]) {
      const st = stageSignals(family, a, b);
      for (const t of [-1.1, 0.3, 0.9, 2.4]) near(a > 0 ? st.shifted(t) : st.shifted(-t), transformedSignal(family, a, b, t), 1e-12);
    }
  }
});

test('open / closed circles: CT jumps are listed with both limits, the lecture steps mark the defined end as closed', () => {
  const jumps = jumpList((t) => baseSignal('steps', t), baseEdges('steps'), -3, 8, { defined: true });
  assert.deepEqual(jumps.map((j) => [j.x, j.left, j.right, j.closed]), [[-1, 0, 2, 'right'], [2, 2, 1, 'right'], [3, 1, -0.5, 'right'], [6, -0.5, 0, 'left']]);
  // u(0) undefined: the midpoint convention is not drawn, both limits are open
  const rect = jumpList((t) => baseSignal('rect', t), baseEdges('rect'), -5, 5);
  assert.deepEqual(rect.map((j) => [j.x, j.left, j.right, j.closed]), [[0, 0, 1, null], [1, 1, 0, null]]);
  const exp = jumpList((t) => baseSignal('exp', t), [0], -5, 5);
  near(exp[0].right, 1, 1e-6);
  assert.equal(exp[0].closed, null);
  // the polyline is cut at the jump (no vertical stroke, no midpoint)
  const curve = sampleCurve((t) => baseSignal('rect', t), -1, 2, 50, [0, 1], { gaps: true });
  assert.equal(curve.filter(([, y]) => Number.isNaN(y)).length, 2);
  assert.ok(curve.every(([x, y]) => Number.isNaN(y) || y === 0 || y === 1 || Math.abs(x) > 1e-3), 'no 1/2 value at the jump');
  assert.match(timeLesson.read('tri', { a: 2, b: 1 }), /열린 원은 CT에서 u\(0\)처럼 그 점의 값을 정하지 않는다/);
  assert.match(timeLesson.read('steps', { a: 2, b: 5 }), /채운 원/);
});

test('CT marker on a jump of x(t) (rect edges 0 and 1, exp edge 0): value undefined, the readout says so; interval-defined steps and kinks are unaffected', () => {
  for (const [family, tau] of [['rect', 0], ['rect', 1], ['exp', 0]]) {
    assert.equal(isJumpMarker(family, tau), true, `${family} ${tau}`);
    assert.match(timeLesson.describe({ family, params: { a: 2, b: 1 }, cursor: tau }), /점프 위치라 x\(τ\)는 미정의 — 좌·우 극한만/);
  }
  assert.equal(isJumpMarker('rect', 0.3), false);
  assert.equal(isJumpMarker('rect', 1e-6), false);
  assert.equal(isJumpMarker('exp', 0.5), false);
  assert.equal(isJumpMarker('tri', 1), false); // continuous kink
  assert.equal(isJumpMarker('tri', -1), false);
  assert.equal(isJumpMarker('steps', 2), false); // defined by its intervals ([2,3) is closed on the left)
  assert.equal(isJumpMarker('seq', 1), false);
  assert.doesNotMatch(timeLesson.describe({ family: 'rect', params: { a: 2, b: 1 }, cursor: 0.3 }), /미정의/);
  // the one-sided limits at the jump: x(0-) = 0, x(0+) = 1 for the rectangle, the same two values the view prints
  const [j] = jumpList((t) => baseSignal('rect', t), baseEdges('rect'), -5, 5);
  assert.equal(j.x, 0);
  near(j.left, 0, 1e-12);
  near(j.right, 1, 1e-6);
});

test('DT upsample x[n/L] inserts zeros: g[n] = x[n/2] for even n (lecture), 0 for odd n', () => {
  const up = sequenceUpsample([3, 5, 7], -1, 2, 0);
  assert.deepEqual(up.map((p) => p.n), [-2, -1, 0, 1, 2]);
  assert.deepEqual(up.map((p) => p.value), [3, 0, 5, 0, 7]);
  assert.deepEqual(up.map((p) => p.inserted), [false, true, false, true, false]);
});

test('DT upsample details: zero insertion, positions L k + b, no values lost', () => {
  const x = TIME_SEQUENCE.values;
  for (const [L, b] of [[1, 0], [2, 0], [3, 1], [4, -2]]) {
    const up = sequenceUpsample(x, TIME_SEQUENCE.start, L, b);
    const byN = new Map(up.map((p) => [p.n, p]));
    x.forEach((v, i) => {
      const n = L * (TIME_SEQUENCE.start + i) + b;
      assert.equal(byN.get(n).value, v);
      assert.equal(byN.get(n).inserted, false);
    });
    assert.equal(up.filter((p) => p.inserted).every((p) => p.value === 0), true);
    assert.equal(up.length, L * (x.length - 1) + 1);
  }
  assert.throws(() => sequenceUpsample(x, 0, 0, 0));
  assert.throws(() => sequenceUpsample(x, 0, 2, 0.5));
  // decimation x[2n] / x[3n] and reversal x[-n] keep exactly the samples whose index is a multiple
  assert.deepEqual(sequenceTransform([1, 2, 3, 4, 5, 6, 7], 0, 3, 0).map((p) => p.value), [1, 4, 7]);
  assert.deepEqual(sequenceTransform([1, 2, 3], 0, -1, 0).map((p) => [p.n, p.value]), [[-2, 3], [-1, 2], [0, 1]]);
  assert.equal(describeTimeMap({ family: 'up', a: 0.5, b: 0, tau: 2, L: 2 }).includes('n=L k+b=4'), true);
  assert.match(timeLesson.describe({ family: 'up', params: { L: 3, b: 1 }, cursor: 2 }), /n=L k\+b=7 · 표본 사이에 0을 2개씩 삽입/);
});

test('slider families: up has L and b, CT families have a, b and the stage select; normalization keeps legal values', () => {
  assert.deepEqual(timeLesson.controls('up').map((c) => c.key), ['L', 'b']);
  assert.deepEqual(timeLesson.controls('tri').map((c) => c.key), ['a', 'b', 'stage']);
  assert.deepEqual(timeLesson.controls('seq').map((c) => c.key), ['a', 'b']);
  assert.deepEqual(normalizeTimeParams('up', { L: 0, b: 2.6 }).params, { L: 1, b: 3 });
  assert.equal(TIME_FAMILIES.length, 7);
  for (const family of ['steps', 'steps-r']) {
    const axis = timeAxisOf(family);
    assert.ok(axis.lo < -1 && axis.hi > 6);
  }
  const map = timeMap('up', { L: 3, b: 1 });
  near(map.a, 1 / 3);
  near((2 + map.b) / map.a, 3 * 2 + 1); // tau -> L tau + b
});
