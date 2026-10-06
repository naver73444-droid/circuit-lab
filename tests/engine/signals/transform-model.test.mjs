import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSFORM_FAMILIES, spectrumValue, dirichletValue, timeSignal, transformMetrics, transformControls,
  transformLesson, describeTransform, spectrumCurves,
} from '../../../src/signals-transform-model.js';
import { controlDefaults } from '../../../src/signals-util.js';
import { finiteDTFT, rectangleFT } from './reference.mjs';

const transformDefaults = (family) => controlDefaults(transformControls(family));

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const CT = ['rect', 'tri', 'exp', 'gauss'];

// X(f) = integral x(t) e^{-j 2 pi f t} dt by direct summation.
function numericTransform(family, p, f) {
  const lo = -14;
  const hi = 14;
  const N = 80000;
  const d = (hi - lo) / N;
  let re = 0;
  let im = 0;
  for (let k = 0; k < N; k++) {
    const t = lo + (k + 0.5) * d;
    const x = timeSignal(family, p, t);
    re += x * Math.cos(2 * Math.PI * f * t);
    im -= x * Math.sin(2 * Math.PI * f * t);
  }
  return { re: re * d, im: im * d };
}

test('closed-form spectra, with shift, agree with direct integration of the time signal', () => {
  for (const family of CT) {
    const p = { ...transformDefaults(family), t0: 0.35 };
    for (const f of [0, 0.37, 1.2, -0.8]) {
      const a = spectrumValue(family, p, f);
      const b = numericTransform(family, p, f);
      near(a.re, b.re, 2e-3);
      near(a.im, b.im, 2e-3);
    }
  }
});

test('X(0) is the area under x(t); a time shift changes the phase only', () => {
  const rect = { T: 2, t0: 0 };
  near(spectrumValue('rect', rect, 0).mag, 2);
  near(spectrumValue('tri', { T: 2, t0: 0 }, 0).mag, 1);
  near(spectrumValue('gauss', { sigma: 0.5, t0: 0 }, 0).mag, 0.5 * Math.sqrt(2 * Math.PI));
  for (const family of CT) {
    const base = transformDefaults(family);
    for (const f of [0.2, 0.9, 2.1]) {
      const a = spectrumValue(family, { ...base, t0: 0 }, f);
      const b = spectrumValue(family, { ...base, t0: 1.3 }, f);
      near(a.mag, b.mag, 1e-12);
    }
  }
  const shifted = spectrumValue('rect', { T: 1, t0: 0.25 }, 0.5);
  const unshifted = spectrumValue('rect', { T: 1, t0: 0 }, 0.5);
  near(Math.atan2(Math.sin(shifted.phase - unshifted.phase), Math.cos(shifted.phase - unshifted.phase)), -Math.PI / 4);
});

test('rect spectrum reuses the course normalization (T sinc(fT) in Hz = rectangleFT in rad/s)', () => {
  for (const f of [0, 0.3, 1.7]) near(spectrumValue('rect', { T: 1.5, t0: 0 }, f).re, rectangleFT(1, 1.5, 2 * Math.PI * f));
});

test('duality: stretching the signal by 2 narrows the spectrum by 2 (time-scaling property)', () => {
  const pairs = {
    rect: [{ T: 2 }, { T: 1 }],
    tri: [{ T: 2 }, { T: 1 }],
    gauss: [{ sigma: 0.8 }, { sigma: 0.4 }],
    exp: [{ alpha: 1 }, { alpha: 2 }], // larger alpha decays faster = narrower
  };
  for (const [family, [wide, narrow]] of Object.entries(pairs)) {
    const w = transformMetrics(family, { ...wide, t0: 0 });
    const n = transformMetrics(family, { ...narrow, t0: 0 });
    near(w.timeWidth / n.timeWidth, 2, 0.03);
    near(w.freqWidth / n.freqWidth, 0.5, 0.03);
    near((w.timeWidth * w.freqWidth) / (n.timeWidth * n.freqWidth), 1, 0.05);
  }
  near(transformMetrics('rect', { T: 2, t0: 0 }).timeWidth, 2, 0.01);
});

test('DTFT of L ones: closed form equals the course DTFT, is 2π periodic and conjugate symmetric', () => {
  for (const [L, n0] of [[1, 0], [5, -3], [16, 8]]) {
    for (const w of [-6.283185307179586, -2.5, -1e-12, 0, 0.7, Math.PI, 6.283185307179586]) {
      const a = dirichletValue(L, n0, w);
      const b = finiteDTFT(Array(L).fill(1), w, n0);
      near(a.re, b.re, 1e-9);
      near(a.im, b.im, 1e-9);
    }
    const x = spectrumValue('dt', { L, n0 }, 0.9);
    const y = spectrumValue('dt', { L, n0 }, 0.9 + 2 * Math.PI);
    near(x.mag, y.mag, 1e-9);
    near(spectrumValue('dt', { L, n0 }, -0.9).mag, x.mag, 1e-9);
  }
  near(spectrumValue('dt', { L: 5, n0: 0 }, 0).mag, 5);
  near(spectrumValue('dt', { L: 4, n0: 2 }, (2 * Math.PI) / 4).mag, 0);
});

test('metrics, curves and lesson description exist for every family', () => {
  for (const { value } of TRANSFORM_FAMILIES) {
    const p = transformDefaults(value);
    const m = transformMetrics(value, p);
    assert.ok(m.peak > 0 && m.timeWidth > 0 && m.freqWidth > 0, value);
    const { magnitude, phase } = spectrumCurves(value, p, 50);
    assert.equal(magnitude.length, 50);
    assert.equal(phase.length, 50);
    assert.ok(describeTransform(value, p).length > 10);
    assert.ok(transformLesson.formula(value).includes('X('));
    for (const c of transformControls(value)) assert.ok(c.initial >= c.min && c.initial <= c.max);
  }
  assert.throws(() => timeSignal('dt', {}, 0));
});

// Brute-force half-amplitude width of a sampled curve.
const gridWidth = (fn, lo, hi, N = 200001) => {
  const values = Array.from({ length: N }, (_, i) => fn(lo + ((hi - lo) * i) / (N - 1)));
  const level = values.reduce((m, v) => Math.max(m, v), 0) / 2;
  return (values.filter((v) => v >= level).length * (hi - lo)) / (N - 1);
};

test('closed-form widths agree with a brute-force grid, for every family and shift', () => {
  for (const family of CT) {
    for (const t0 of [0, 0.7]) {
      const p = { ...transformDefaults(family), t0 };
      const m = transformMetrics(family, p);
      near(m.timeWidth, gridWidth((t) => Math.abs(timeSignal(family, p, t)), -4, 4), 2e-3);
      near(m.freqWidth, gridWidth((f) => spectrumValue(family, p, f).mag, -4, 4), 2e-3);
      near(m.peak, spectrumValue(family, p, 0).mag, 1e-12);
      near(m.timeSpan[1] - m.timeSpan[0], m.timeWidth, 1e-12);
    }
  }
  const analytic = {
    rect: [{ T: 2 }, 2], tri: [{ T: 2 }, 1], exp: [{ alpha: 2 }, Math.LN2 / 2], gauss: [{ sigma: 0.5 }, 2 * 0.5 * Math.sqrt(2 * Math.LN2)],
  };
  for (const [family, [p, width]] of Object.entries(analytic)) near(transformMetrics(family, { ...p, t0: 0 }).timeWidth, width, 1e-12);
  for (const L of [1, 2, 3, 5, 16]) {
    const m = transformMetrics('dt', { L, n0: 0 });
    near(m.freqWidth, gridWidth((w) => dirichletValue(L, 0, w).mag, -Math.PI, Math.PI), 4e-3);
    assert.equal(m.timeWidth, L);
    assert.equal(m.peak, L);
  }
});

test('metrics are memoized per parameter set (same object while nothing changes)', () => {
  const p = { T: 1.5, t0: 0 };
  assert.equal(transformMetrics('rect', p), transformMetrics('rect', { ...p }));
  assert.notEqual(transformMetrics('rect', p), transformMetrics('rect', { T: 1.6, t0: 0 }));
});

test('phase is hidden below 2 % of the peak for every family, and wraps through +-pi break the line', () => {
  for (const family of ['rect', 'tri', 'exp', 'gauss', 'dt']) {
    const p = { ...transformDefaults(family), t0: 0.35, n0: 2 };
    const { magnitude, phase } = spectrumCurves(family, p, 400);
    const peak = transformMetrics(family, p).peak;
    const drawn = new Set(phase.filter((q) => q[1] !== null).map((q) => q[0]));
    for (const [f, mag] of magnitude) {
      if (mag <= 0.02 * peak) assert.equal(drawn.has(f), false, `${family} f=${f}`);
    }
    for (let i = 1; i < phase.length; i++) {
      if (phase[i][1] !== null && phase[i - 1][1] !== null) assert.ok(Math.abs(phase[i][1] - phase[i - 1][1]) <= Math.PI + 1e-12, `${family} ${i}`);
    }
  }
  // a delayed exponential wraps through +-pi many times: the polyline is cut there
  const wrapped = spectrumCurves('exp', { alpha: 1, t0: 2 }, 600).phase;
  assert.ok(wrapped.some((q) => q[1] === null));
});

test('readout uses SI-prefixed seconds', () => {
  assert.match(describeTransform('exp', { alpha: 1, t0: 0 }), /693 ms/);
  assert.match(describeTransform('rect', { T: 1.5, t0: 0 }), /1\.5 s/);
});
