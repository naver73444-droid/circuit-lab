import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, formatNumber, formatSI, formatQuantity, niceTicks, sampleCurve, midpointRect, controlDefaults, r1 } from '../../../src/signals-util.js';

test('formatNumber: three significant digits, typographic minus, no trailing zeros', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(3), '3');
  assert.equal(formatNumber(-0.5), '−0.5');
  assert.equal(formatNumber(1.23456), '1.23');
  assert.equal(formatNumber(3.000000001), '3');
  assert.equal(formatNumber(NaN), '—');
  assert.equal(formatNumber(123456), '1.23×10^5');
  assert.equal(formatNumber(0.0001234), '1.23×10^−4');
});

test('formatSI picks the prefix and carries rounding', () => {
  assert.equal(formatSI(0.25, 's'), '250 ms');
  assert.equal(formatSI(2.5e-4, 's'), '250 µs');
  assert.equal(formatSI(2, 's'), '2 s');
  assert.equal(formatSI(1500, 'Hz'), '1.5 kHz');
  assert.equal(formatSI(999.9, 'Hz'), '1 kHz');
  assert.equal(formatSI(0, 's'), '0 s');
  assert.equal(formatSI(-0.016667, 's'), '−16.7 ms');
});

test('formatQuantity: seconds in SI, other units plain', () => {
  assert.equal(formatQuantity(0.5, 's'), '500 ms');
  assert.equal(formatQuantity(0.5, 'Hz'), '0.5 Hz');
  assert.equal(formatQuantity(2, '1/s'), '2 1/s');
  assert.equal(formatQuantity(1.25, ''), '1.25');
});

test('niceTicks stays inside the range with 1-2-5 steps', () => {
  assert.deepEqual(niceTicks(-1.2, 1.3), [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(1, 1), []);
  for (const [lo, hi] of [[-5, 5], [0, 0.37], [-30, 30], [0, 4]]) {
    const ticks = niceTicks(lo, hi, 5);
    assert.ok(ticks.length >= 2 && ticks.every((v) => v >= lo - 1e-9 && v <= hi + 1e-9));
  }
});

test('sampleCurve is uniform, sorted, and doubles jump points', () => {
  const step = (t) => (t > 1 ? 1 : 0);
  const points = sampleCurve(step, 0, 2, 101, [1]);
  assert.ok(points.every((p, i) => i === 0 || p[0] >= points[i - 1][0]));
  const atEdge = points.filter((p) => Math.abs(p[0] - 1) < 1e-6);
  assert.deepEqual(atEdge.map((p) => p[1]), [0, 0, 1]);
  assert.equal(sampleCurve((t) => t, 0, 1, 11).length, 11);
});

test('clamp, midpointRect, controlDefaults, r1', () => {
  assert.equal(midpointRect(0.5, 0, 1), 1);
  assert.equal(midpointRect(0, 0, 1), 0.5);
  assert.equal(midpointRect(1, 0, 1), 0.5);
  assert.equal(midpointRect(1.2, 0, 1), 0);
  assert.equal(midpointRect(-3, -3 + 1e-14, 2), 0.5);
  assert.deepEqual(controlDefaults([{ key: 'a', initial: 2 }, { key: 'b', initial: -1 }]), { a: 2, b: -1 });
  assert.equal(r1(1.26), 1.3);
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
});

test('formatNumber replaces every minus sign, including the exponent one', () => {
  assert.equal(formatNumber(-0.0001234), '−1.23×10^−4');
  assert.equal(formatNumber(-123456), '−1.23×10^5');
  assert.doesNotMatch(formatNumber(-0.00001), /-/);
});
