import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baseSignal, baseEdges, transformedSignal, transformedEdges, timeImage, normalizeScale, markerDomain,
  defaultMarker, sequenceTransform, describeTimeMap, TIME_FAMILIES, TIME_SEQUENCE, isDiscrete, normalizeTimeParams, timeLesson,
} from '../../../src/signals-time-model.js';

const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const CONTINUOUS = ['tri', 'rect', 'exp'];

test('asymmetric fin: piecewise linear, zero outside', () => {
  near(baseSignal('tri', -1), 0);
  near(baseSignal('tri', 0), 0.5);
  near(baseSignal('tri', 1), 1);
  near(baseSignal('tri', 1.2), 0.5);
  near(baseSignal('tri', 1.4), 0);
  assert.equal(baseSignal('tri', -3), 0);
  assert.equal(baseSignal('tri', 3), 0);
});

test('every marker maps tau to t=(tau+b)/a with the same height, for any sign of a', () => {
  for (const family of CONTINUOUS) {
    const { min, max } = markerDomain(family);
    for (const a of [-3, -1.5, -0.25, 0.1, 1, 2.5]) {
      for (const b of [-3, -1, 0, 1.5, 3]) {
        for (const f of [0.1, 0.37, 0.62, 0.9]) {
          const tau = min + (max - min) * f;
          near(transformedSignal(family, a, b, timeImage(tau, a, b)), baseSignal(family, tau), 1e-9);
        }
      }
    }
  }
});

test('x(at-b) equals the delayed x(a(t-b/a)): b/a is the shift, a<0 reverses', () => {
  for (const family of CONTINUOUS) {
    for (const t of [-1.3, -0.2, 0.45, 1.1, 2.6]) {
      near(transformedSignal(family, 2, 1, t), baseSignal(family, 2 * (t - 0.5)), 1e-12);
      near(transformedSignal(family, -2, 1, t), baseSignal(family, -2 * (t + 0.5)), 1e-12);
    }
  }
  // the fin peak (tau=1) lands at t=(1+b)/a: delayed for b/a>0, mirrored to the left for a<0
  near(timeImage(1, 2, 1), 1);
  near(timeImage(1, -2, 1), -1);
});

test('edges of the transformed signal sit where a t - b hits the original edges', () => {
  for (const family of CONTINUOUS) {
    for (const edge of transformedEdges(family, -2, 1)) {
      assert.ok(baseEdges(family).some((e) => Math.abs(-2 * edge - 1 - e) < 1e-12));
    }
  }
});

test('discrete case keeps only integer images and reverses the grid', () => {
  assert.deepEqual(sequenceTransform([2, 4, 6], -1, 2, 1), [{ k: -1, n: 0, value: 2 }, { k: 1, n: 1, value: 6 }]);
  assert.deepEqual(sequenceTransform([2, 4, 6], -1, -1, 0).map((v) => v.value), [6, 4, 2]);
  assert.throws(() => sequenceTransform([1], 0, 0, 1));
  assert.throws(() => sequenceTransform([1], 0, 1.5, 1));
  const kept = sequenceTransform(TIME_SEQUENCE.values, TIME_SEQUENCE.start, 2, 1);
  assert.ok(kept.every((p) => Number.isInteger(p.n)));
  assert.equal(kept.length, 3); // k+1 even for k = -1, 1, 3
});

test('scale 0 is never used: continuous clamps to +-0.1, discrete to 1', () => {
  assert.equal(normalizeScale(0, false), 0.1);
  assert.equal(normalizeScale(-0.04, false), -0.1);
  assert.equal(normalizeScale(1.5, false), 1.5);
  assert.equal(normalizeScale(0, true), 1);
  assert.equal(normalizeScale(-2.4, true), -2);
});

test('default markers lie inside each support', () => {
  for (const { value } of TIME_FAMILIES) {
    const { min, max } = markerDomain(value);
    const marker = defaultMarker(value);
    assert.ok(marker >= min && marker <= max, value);
    assert.equal(isDiscrete(value), value === 'seq' || value === 'up');
  }
});

test('readout says what happens: direction, compression, shift side', () => {
  const text = describeTimeMap({ family: 'tri', a: -2, b: 1, tau: 0.4 });
  assert.match(text, /좌우 반전/);
  assert.match(text, /압축/);
  assert.match(text, /왼쪽/);
  // a < 0: the stage figure shifts before the reversal, so the sentence names both references
  assert.match(describeTimeMap({ family: 'steps-r', a: -4, b: -2, tau: 1 }), /반전 전 0\.5 왼쪽 이동 → 반전 \(반전 후 기준으로는 0\.5 오른쪽\)/);
  assert.match(text, /반전 전 0\.5 오른쪽 이동 → 반전 \(반전 후 기준으로는 0\.5 왼쪽\)/);
  assert.match(describeTimeMap({ family: 'tri', a: 2, b: 1, tau: 0.4 }), /오른쪽/);
  assert.match(describeTimeMap({ family: 'seq', a: 2, b: 0, tau: 1 }), /사라집니다|n=0.5|정수/);
  assert.match(describeTimeMap({ family: 'seq', a: 1, b: 2, tau: 1 }), /=3 /);
});

test('normalizeTimeParams writes back the scale that is really drawn and explains a clamped a', () => {
  const zero = normalizeTimeParams('tri', { a: 0, b: 1 });
  assert.equal(zero.params.a, 0.1);
  assert.match(zero.note, /a=0은 정의되지 않음/);
  const near0 = normalizeTimeParams('tri', { a: -0.05, b: 1 });
  assert.equal(near0.params.a, -0.1);
  assert.match(near0.note, /a≈0은 정의되지 않음/);
  const discrete = normalizeTimeParams('seq', { a: 0, b: 1.4 });
  assert.equal(discrete.params.a, 1);
  assert.equal(discrete.params.b, 1);
  assert.match(discrete.note, /a=0/);
  assert.equal(normalizeTimeParams('tri', { a: 2, b: 1 }).note, '');
  assert.equal(normalizeTimeParams('tri', { a: 2, b: 1 }).params.a, 2);
  assert.equal(timeLesson.normalize, normalizeTimeParams);
  assert.match(timeLesson.formula('seq'), /y\[n\]=x\[a n−b\]/);
  assert.match(timeLesson.formula('tri'), /y\(t\)=x\(a t−b\)/);
});
