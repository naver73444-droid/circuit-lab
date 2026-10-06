import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceControl, freqAxisControl, isOmega, toAxis, fromAxis, axisSymbol, axisUnit, spectrumName, formatFreq,
  rationalApprox, dtPeriod, normalizedFrequency,
} from '../../../src/signals-axis.js';

const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);

test('choice controls are 0..n-1 integer selects; the axis toggle offers f [Hz] and omega [rad/s]', () => {
  const c = choiceControl('mode', '모드', [{ value: 0, label: 'a' }, { value: 1, label: 'b' }, { value: 2, label: 'c' }], 2);
  assert.deepEqual([c.min, c.max, c.step, c.initial, c.integer], [0, 2, 1, 2, true]);
  const axis = freqAxisControl(1);
  assert.equal(axis.key, 'axis');
  assert.deepEqual(axis.options.map((o) => o.label), ['f [Hz]', 'ω [rad/s]']);
  assert.equal(axis.initial, 1);
});

test('axis conversion: omega = 2 pi f, round trip, labels follow the toggle', () => {
  near(toAxis(80, 0), 80);
  near(toAxis(80, 1), 160 * Math.PI);
  for (const axis of [0, 1]) near(fromAxis(toAxis(12.5, axis), axis), 12.5);
  assert.equal(isOmega(1), true);
  assert.equal(isOmega(0), false);
  assert.equal(axisSymbol(1), 'ω');
  assert.equal(axisUnit(0), 'Hz');
  assert.equal(spectrumName(1, 'H'), 'H(ω)');
  assert.equal(spectrumName(0), 'X(f)');
  assert.match(formatFreq(80, 1), /^503 rad\/s$/);
  assert.match(formatFreq(80, 0), /^80 Hz$/);
});

test('rational approximation finds small fractions and refuses irrational values', () => {
  assert.deepEqual(rationalApprox(0.15), { p: 3, q: 20 });
  assert.deepEqual(rationalApprox(0.1), { p: 1, q: 10 });
  assert.equal(rationalApprox(Math.PI / 10), null);
  assert.equal(rationalApprox(NaN), null);
});

test('DT sinusoid period N = k/F0: the lecture cases (Ch 1.4)', () => {
  // cos(0.2 n): Omega0 = 0.2 rad, F0 = 0.2/(2 pi) is irrational -> not periodic
  assert.equal(dtPeriod(0.2 / (2 * Math.PI)).periodic, false);
  // cos(0.2 pi n + pi/5): F0 = 0.1 -> N = 10 (k = 1)
  assert.deepEqual(dtPeriod(0.1), { N: 10, k: 1, periodic: true });
  // cos(0.3 pi n - pi/10): F0 = 0.15 = 3/20 -> N = 20 (k = 3)
  assert.deepEqual(dtPeriod(0.15), { N: 20, k: 3, periodic: true });
  assert.deepEqual(dtPeriod(0.5), { N: 2, k: 1, periodic: true });
  assert.equal(dtPeriod(0).N, 1);
  // the period really repeats
  for (const [F0, N] of [[0.1, 10], [0.15, 20], [0.7, 10]]) {
    for (let n = -5; n < 30; n++) near(Math.cos(2 * Math.PI * F0 * (n + N) + 0.3), Math.cos(2 * Math.PI * F0 * n + 0.3), 1e-9);
    assert.equal(dtPeriod(F0).N, N);
  }
});

test('sampling relation Omega0 = w0 Ts = 2 pi F0, F0 = f0/fs', () => {
  const { F0, Omega0 } = normalizedFrequency(7, 10);
  near(F0, 0.7);
  near(Omega0, 2 * Math.PI * 0.7);
  near(Omega0, (2 * Math.PI * 7) * (1 / 10));
});
