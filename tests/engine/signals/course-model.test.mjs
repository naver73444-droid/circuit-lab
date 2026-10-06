import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNALS_LESSONS, rectangleConvolution, exponentialConvolution, discreteConvolution,
  pulseSeriesCoefficient, affineSignal, samplingAlias, parseSignalsNumber, parseSignalsSequence,
} from '../../../src/signals-course-model.js';
import { finiteDTFT, rectangleFT } from './reference.mjs';

const near = (a, b, tol = 1e-10) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const integral = (fn, lo, hi, N = 30000) => {
  let sum = 0;
  const d = (hi - lo) / N;
  for (let k = 0; k < N; k++) sum += fn(lo + (k + 0.5) * d);
  return sum * d;
};

test('six lessons in a fixed order with short tab labels', () => {
  assert.deepEqual(SIGNALS_LESSONS.map((l) => l.id), ['time', 'convolution', 'series', 'fourier', 'roc', 'sampling']);
  for (const lesson of SIGNALS_LESSONS) {
    assert.ok(lesson.tab.length <= 12 && lesson.title.length > 3);
  }
});

test('time mapping handles negative scale, actual shift and CT boundaries', () => {
  near(affineSignal('rect', -0.75, -2, 1), 1);
  near(affineSignal('rect', 0.75, 2, 1), 1);
  near(affineSignal('rect', 1, 2, 1), 0.5);
  near(affineSignal('exp', -1, 2, 1), 0);
  near(affineSignal('exp', 1, 2, 1), Math.exp(-1));
  near(affineSignal('exp', 0.5, 2, 1), 0.5); // u(0) = 1/2
  assert.throws(() => affineSignal('rect', 1, 0, 0));
  assert.throws(() => affineSignal('step', 1, 1, 0));
  assert.throws(() => affineSignal('cos', 1, 1, 0));
});

test('rectangle convolution matches independent numerical integration for unequal widths', () => {
  for (const t of [-1, 0, 0.25, 1.5, 2.5, 3, 4]) {
    const expected = integral((tau) => (tau > 0 && tau < 2 && t - tau > 0 && t - tau < 1 ? 6 : 0), -2, 5, 28000);
    near(rectangleConvolution(t, 2, 1, 2, 3).y, expected, 2e-3);
  }
  assert.equal(rectangleConvolution(1.5, 2, 1).width, 1);
  assert.equal(rectangleConvolution(3, 2, 1).y, 0);
  assert.throws(() => rectangleConvolution(1, -1, 2));
});

test('rectangle output has product of input areas', () => {
  near(integral((t) => rectangleConvolution(t, 2, 3, 2, -1).y, 0, 5), -12, 1e-7);
});

test('exponential convolution distinct, equal, near-equal and negative time', () => {
  near(exponentialConvolution(2, 1, 1), 2 * Math.exp(-2));
  near(exponentialConvolution(2, 1, 2), Math.exp(-2) - Math.exp(-4));
  near(exponentialConvolution(2, 1, 1 + 1e-12), 2 * Math.exp(-2), 1e-10);
  near(exponentialConvolution(2, 2, 1), Math.exp(-2) - Math.exp(-4));
  near(exponentialConvolution(-1, 1, 2), 0);
  near(exponentialConvolution(2, 0.7, 1.3), integral((t) => Math.exp(-0.7 * t) * Math.exp(-1.3 * (2 - t)), 0, 2), 1e-9);
});

test('finite convolution preserves independent indices and commutativity', () => {
  assert.deepEqual(discreteConvolution([1, 2], [1, -1], -2, 3), { start: 1, values: [1, 1, -2] });
  assert.deepEqual(discreteConvolution([2, -1, 3], [1, 0, 2]).values, [2, -1, 7, -2, 6]);
  assert.deepEqual(discreteConvolution([1, -1], [1, 2], 3, -2), discreteConvolution([1, 2], [1, -1], -2, 3));
  assert.throws(() => discreteConvolution([Infinity], [1]));
});

test('Fourier pulse coefficients agree with direct complex integral including DC', () => {
  for (const k of [0, 1, 2, -3]) {
    const actual = pulseSeriesCoefficient(3, 0.3, k);
    near(actual, integral((t) => 3 * Math.cos(2 * Math.PI * k * t), -0.15, 0.15), 1e-8);
    near(integral((t) => -3 * Math.sin(2 * Math.PI * k * t), -0.15, 0.15), 0, 1e-9);
  }
});

test('rectangle FT normalization and zeros agree with direct integral', () => {
  for (const w of [0, 0.3, 2, Math.PI]) near(rectangleFT(2, 2, w), integral((t) => 2 * Math.cos(w * t), -1, 1), 1e-8);
  near(rectangleFT(2, 2, 0), 4);
  near(rectangleFT(2, 2, Math.PI), 0);
});

test('CT exponential Fourier transform: independently integrate real and imaginary parts', () => {
  const a = 1.3;
  const w = 2.1;
  const den = a * a + w * w;
  near(integral((t) => Math.exp(-a * t) * Math.cos(w * t), 0, 30, 100000), a / den, 1e-7);
  near(integral((t) => -Math.exp(-a * t) * Math.sin(w * t), 0, 30, 100000), -w / den, 1e-7);
});

test('DTFT has the correct sign, offset, conjugate symmetry and 2π periodicity', () => {
  const a = finiteDTFT([1, 2, 1], Math.PI / 2);
  near(a.re, 0);
  near(a.im, -2);
  const b = finiteDTFT([1, 2, 1], Math.PI / 2, 1);
  near(b.re, -2);
  near(b.im, 0);
  const x = finiteDTFT([2, -1, 3], 0.73, -2);
  const y = finiteDTFT([2, -1, 3], 0.73 + 2 * Math.PI, -2);
  const z = finiteDTFT([2, -1, 3], -0.73, -2);
  near(x.re, y.re);
  near(x.im, y.im);
  near(x.re, z.re);
  near(x.im, -z.im);
});

test('bilateral Laplace signs and ROC correspond to independent integrals', () => {
  near(integral((t) => Math.exp(-(2 + 1) * t), 0, 20), 1 / 3, 1e-7);
  near(integral((t) => Math.exp(-(-3 + 1) * t), -20, 0), 0.5, 1e-7);
});

test('bilateral Z geometric sums match algebra for right/left ROC tests', () => {
  let r = 0;
  let l = 0;
  for (let n = 0; n < 100; n++) r += (0.5 / 2) ** n;
  for (let m = 1; m < 100; m++) l += (0.5 / 2) ** m;
  near(r, 2 / (2 - 0.5));
  near(l, -0.5 / (0.5 - 2));
});

test('sampling strict boundary, folding phase and sample equivalence', () => {
  assert.equal(samplingAlias(4.9, 10).status, 'alias-free');
  assert.equal(samplingAlias(5, 10).status, 'nyquist-boundary');
  const a = samplingAlias(7, 10);
  near(a.aliasHz, 3);
  assert.equal(a.phaseSign, -1);
  for (let n = 0; n < 30; n++) near(Math.cos((2 * Math.PI * 7 * n) / 10 + 0.4), Math.cos((2 * Math.PI * 3 * n) / 10 - 0.4));
  near(samplingAlias(27, 10).aliasHz, 3);
  for (let n = 0; n < 8; n++) near(Math.sin(Math.PI * n), 0);
  assert.throws(() => samplingAlias(1, 0));
});

test('draft parser rejects blanks, markup, unsupported infinities and underflow', () => {
  for (const value of ['', ' ', '1k', 'Infinity', '1e999', '1e-999', '<img src=x>', '1;2']) assert.throws(() => parseSignalsNumber(value));
  near(parseSignalsNumber('-2.5e-2'), -0.025);
  assert.deepEqual(parseSignalsSequence('1, 2,-.5'), [1, 2, -0.5]);
  for (const value of ['', '1,,2', '1,NaN']) assert.throws(() => parseSignalsSequence(value));
});
