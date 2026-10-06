import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERIES_WAVES, SERIES_DEFAULTS, MAX_HARMONICS, fourierCoefficient, seriesCoefficients, exactWaveform, jumpPositions, partialSum, gibbsOvershoot,
  twoSidedSpectrum, seriesPower, seriesLesson, hasJump, hasDuty,
} from '../../../src/signals-series-model.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const TAU = 2 * Math.PI;
const sinc = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));
const WAVES = SERIES_WAVES.map((w) => w.value);

// c_k = integral over one period of x(t) e^{-j 2 pi k t} dt (unit period, midpoint rule on the exact waveform)
function integral(wave, D, k, n = 200000) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const t = -0.5 + (i + 0.5) / n;
    const x = exactWaveform(wave, D, t);
    re += (x * Math.cos(TAU * k * t)) / n;
    im -= (x * Math.sin(TAU * k * t)) / n;
  }
  return { re, im };
}

test('complex coefficients of every wave match direct integrals, with c_{-k} = conj(c_k)', () => {
  for (const wave of WAVES) {
    for (const k of [0, 1, 2, 3, 4, 7, -1, -3]) {
      const c = fourierCoefficient(wave, 0.35, k);
      const d = integral(wave, 0.35, k);
      near(c.re, d.re, 5e-4);
      near(c.im, d.im, 5e-4);
      const mirror = fourierCoefficient(wave, 0.35, -k);
      near(mirror.re, c.re, 1e-12);
      near(mirror.im, -c.im, 1e-12);
    }
  }
  assert.throws(() => fourierCoefficient('pulse', 0.4, 1.5));
});

test('Ex 4.1 / 4.2 / 4.11 (shifted pulse, T0 = 3 s, d = 1/3): a_k, b_k and the 4-harmonic compact series', () => {
  const D = 1 / 3;
  const c0 = fourierCoefficient('pulse0', D, 0);
  near(c0.re, 1 / 3);
  // a_k = sin(2 pi k/3)/(pi k), b_k = [1 - cos(2 pi k/3)]/(pi k); c_k = (a_k - j b_k)/2
  for (const k of [1, 2, 4, 5]) {
    const c = fourierCoefficient('pulse0', D, k);
    near(2 * c.re, Math.sin((TAU * k) / 3) / (Math.PI * k));
    near(-2 * c.im, (1 - Math.cos((TAU * k) / 3)) / (Math.PI * k));
  }
  // slide values: x4 = 0.3333 + 0.2757cos(2pi t/3) - 0.1378cos(4pi t/3) + 0.0689cos(8pi t/3) + 0.4775 sin(2pi t/3) + 0.2387 sin(4pi t/3) + 0.1194 sin(8pi t/3)
  const slide = [[1, 0.2757, 0.4775], [2, -0.1378, 0.2387], [4, 0.0689, 0.1194]];
  for (const [k, a, b] of slide) {
    const c = fourierCoefficient('pulse0', D, k);
    near(2 * c.re, a, 6e-5);
    near(-2 * c.im, b, 6e-5);
  }
  // k = 3 vanishes (sinc(1) = 0)
  const c3 = fourierCoefficient('pulse0', D, 3);
  near(Math.hypot(c3.re, c3.im), 0, 1e-12);
  // compact form (Ex 4.11): d_k = 2|c_k|, phase -pi k / 3 (mod pi sign): 0.5513 cos(w t - 1.0472), 0.2757 cos(2 w t - 2.0944), 0.1378 cos(4 w t - 1.0472)
  const { dc, terms } = seriesCoefficients('pulse0', D, 4);
  near(dc, 0.3333, 4e-5);
  near(terms[0].amp, 0.5513, 6e-5);
  near(terms[0].phase, -1.0472, 1e-4);
  near(terms[1].amp, 0.2757, 6e-5);
  near(terms[1].phase, -2.0944, 1e-4);
  assert.ok(terms[2].amp < 1e-12);
  near(terms[3].amp, 0.1378, 6e-5);
  near(terms[3].phase, -1.0472, 1e-4);
  // the 4-harmonic sum evaluated at some t equals the slide expression
  const t = 0.37 * 3;
  const slideValue = 0.3333 + 0.2757 * Math.cos((TAU * t) / 3) - 0.1378 * Math.cos((2 * TAU * t) / 3) + 0.0689 * Math.cos((4 * TAU * t) / 3)
    + 0.4775 * Math.sin((TAU * t) / 3) + 0.2387 * Math.sin((2 * TAU * t) / 3) + 0.1194 * Math.sin((4 * TAU * t) / 3);
  near(partialSum(seriesCoefficients('pulse0', D, 4), 4, t / 3), slideValue, 2e-4);
});

test('Ex 4.3 / 4.5: centered pulse, d = 1/3: a_k = (2/3) sinc(k/3), c_k = (1/3) sinc(k/3), zeros at multiples of 3', () => {
  for (let k = -9; k <= 9; k++) {
    const c = fourierCoefficient('pulse', 1 / 3, k);
    near(c.re, (1 / 3) * sinc(k / 3));
    near(c.im, 0);
  }
  near(fourierCoefficient('pulse', 1 / 3, 3).re, 0, 1e-12);
  near(fourierCoefficient('pulse', 1 / 3, 0).re, 1 / 3);
  const { terms } = seriesCoefficients('pulse', 1 / 3, 6);
  near(terms[0].amp, (4 / 3) * Math.abs(sinc(1 / 3)) / 2 * 1, 1e-12); // a_1 = (2/3) sinc(1/3): amp 2|c_1| = (2/3)|sinc(1/3)|
});

test('Ex 4.7: duty cycle d sets c_k = d sinc(kd); the first zero is at k = 1/d', () => {
  for (const [d, zero] of [[0.1, 10], [0.2, 5], [0.3, 10 / 3]]) {
    near(fourierCoefficient('pulse', d, 0).re, d);
    for (let k = 1; k <= 12; k++) near(fourierCoefficient('pulse', d, k).re, d * sinc(k * d), 1e-12);
    near(1 / d, zero, 1e-12);
  }
  // 1/60 grid of the duty slider holds the lecture duty cycles exactly
  const duty = seriesLesson.controls('pulse').find((c) => c.key === 'D');
  for (const value of [0.1, 0.2, 0.3, 1 / 3, 0.5]) {
    const steps = (value - duty.min) / duty.step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, String(value));
  }
});

test('Ex 4.4: odd square wave +-A: a_k = 0, b_k = 4A/(pi k) for odd k only; only odd harmonics and a sine phase', () => {
  for (let k = 1; k <= 9; k++) {
    const c = fourierCoefficient('odd', 0.5, k);
    near(2 * Math.abs(c.im), k % 2 ? 4 / (Math.PI * k) : 0, 1e-12); // |b_k| = 2|Im c_k|
    near(c.re, 0);
  }
  const { dc, terms } = seriesCoefficients('odd', 0.5, 5);
  near(dc, 0);
  assert.deepEqual(terms.map((t) => t.amp > 1e-12), [true, false, true, false, true]);
  near(terms[0].amp, 4 / Math.PI);
  near(terms[0].phase, -Math.PI / 2); // b sin = b cos(x - pi/2)
  assert.equal(exactWaveform('odd', 0.5, 0.25), 1);
  assert.equal(exactWaveform('odd', 0.5, 0.75), -1);
  assert.equal(exactWaveform('odd', 0.5, 0.5), 0);
  assert.ok(gibbsOvershoot('odd', 0.5, 99).fraction > 0.08); // ~9 % of the jump (the jump is 2)
});

test('Ex 4.8: ramp x = t/T0 on (0, T0): c0 = 1/2, c_k = j/(2 pi k): purely imaginary, phase +pi/2 for k > 0', () => {
  near(fourierCoefficient('ramp', 0.5, 0).re, 0.5);
  for (const k of [1, 2, 5]) {
    const c = fourierCoefficient('ramp', 0.5, k);
    near(c.re, 0);
    near(c.im, 1 / (TAU * k));
    near(seriesCoefficients('ramp', 0.5, 5).terms[k - 1].phase, Math.PI / 2);
  }
  near(fourierCoefficient('ramp', 0.5, -2).im, -1 / (TAU * 2));
  assert.equal(exactWaveform('ramp', 0.5, 0.25), 0.25);
  assert.equal(exactWaveform('ramp', 0.5, 1), 0.5); // jump 1 -> 0: midpoint
  // |c_k| = 1/(2 pi |k|) halves when k doubles
  near(Math.abs(fourierCoefficient('ramp', 0.5, 4).im) * 2, Math.abs(fourierCoefficient('ramp', 0.5, 2).im));
});

test('Ex 4.6: time shift is a linear phase: pulse0 = pulse shifted by D/2: |c_k| equal, angle -pi k D', () => {
  for (const D of [1 / 3, 0.2]) {
    for (let k = 1; k <= 8; k++) {
      const a = fourierCoefficient('pulse', D, k);
      const b = fourierCoefficient('pulse0', D, k);
      near(Math.hypot(b.re, b.im), Math.abs(a.re), 1e-12);
      // c_k(shifted) = c_k e^{-j 2 pi k (D/2)}
      near(b.re, a.re * Math.cos(Math.PI * k * D), 1e-12);
      near(b.im, -a.re * Math.sin(Math.PI * k * D), 1e-12);
    }
  }
});

test('Ex 4.38: power spectrum of the pulse train (T0 = 3, d = 1/3): |c_k|^2 = 0.1111, 0.0760, 0.0190; total 1/3; Parseval', () => {
  const lines = twoSidedSpectrum('pulse', 1 / 3, 25);
  const power = (k) => lines.find((l) => l.k === k).power;
  near(power(0), 0.1111, 2e-4);
  near(power(1), 0.076, 2e-4);
  near(power(-1), power(1), 1e-15);
  near(power(2), 0.019, 2e-4);
  near(power(3), 0, 1e-24);
  const pw = seriesPower('pulse', 1 / 3, 1000);
  near(pw.total, 1 / 3);
  near(pw.partial, 1 / 3, 1e-3);
  // lecture: harmonics 1..2 carry 0.152 + 0.038, DC 0.1111
  const first = seriesPower('pulse', 1 / 3, 1);
  near(first.partial, 0.1111 + 0.152, 5e-4);
  for (const wave of WAVES) {
    const total = hasDuty(wave) ? 0.4 : { odd: 1, ramp: 1 / 3, saw: 1 / 3, tri: 1 / 3 }[wave];
    near(seriesPower(wave, 0.4, 1000).total, total, 1e-12);
    near(seriesPower(wave, 0.4, 1000).partial, total, 1e-3);
    // mean square of the exact waveform
    let ms = 0;
    for (let i = 0; i < 20000; i++) ms += exactWaveform(wave, 0.4, -0.5 + (i + 0.5) / 20000) ** 2 / 20000;
    near(ms, total, 2e-4);
  }
});

test('two-sided spectrum: phase hidden where the line vanishes; angle odd, magnitude even for a real signal', () => {
  const lines = twoSidedSpectrum('pulse0', 1 / 3, 12);
  assert.equal(lines.length, 25);
  const at = (k) => lines.find((l) => l.k === k);
  assert.equal(at(3).phase, null);
  assert.equal(at(-6).phase, null);
  for (let k = 1; k <= 12; k++) {
    near(at(k).mag, at(-k).mag, 1e-15);
    if (at(k).phase !== null) near(Math.sin(at(k).phase), -Math.sin(at(-k).phase), 1e-12);
  }
  // shifted pulse: angle of c_1 is -pi/3
  near(at(1).phase, -Math.PI / 3, 1e-12);
});

test('general T0: the controls, defaults and cursor follow the period', () => {
  for (const wave of WAVES) {
    const controls = seriesLesson.controls(wave, {});
    const keys = controls.map((c) => c.key);
    assert.deepEqual(keys.slice(0, 2), ['N', 'T0']);
    assert.ok(keys.includes('spec') && keys.includes('axis'));
    const defaults = SERIES_DEFAULTS[wave];
    assert.equal(controls.find((c) => c.key === 'T0').initial, defaults.T0);
    assert.equal(keys.includes('D'), hasDuty(wave));
  }
  assert.equal(SERIES_DEFAULTS.pulse.T0, 3);
  near(SERIES_DEFAULTS.pulse.D, 1 / 3);
  const spec = seriesLesson.cursor('pulse', { T0: 2.5 });
  near(spec.max, 5);
  near(spec.rate, 0.625);
  assert.equal(spec.loop, true);
  assert.match(seriesLesson.formula('pulse', { T0: 3, D: 1 / 3 }), /T₀=3 s, f₀=0\.333 Hz/);
  assert.match(seriesLesson.describe({ family: 'pulse', params: { N: 4, T0: 3, D: 1 / 3, spec: 0 } }), /T₀=3 s \(f₀=0\.333 Hz, ω₀=2\.09 rad\/s\)/);
  assert.match(seriesLesson.describe({ family: 'pulse', params: { N: 2, T0: 3, D: 1 / 3, spec: 2 } }), /전력 0\.301 \/ 0\.333 \(90\.3%\)/);
});

test('jumps: positions are where the exact waveform changes value; Gibbs holds for every jump wave', () => {
  for (const wave of WAVES) {
    const D = 0.35;
    const found = [];
    for (let i = 0; i < 4000; i++) {
      const t = (i + 0.5) / 4000;
      if (Math.abs(exactWaveform(wave, D, t) - exactWaveform(wave, D, t - 1 / 4000)) > 0.5) found.push(t);
    }
    const positions = jumpPositions(wave, D).map((p) => ((p % 1) + 1) % 1);
    assert.equal(hasJump(wave), positions.length > 0, wave);
    for (const p of positions) assert.ok(found.some((t) => Math.abs(t - p) < 1 / 2000) || p === 0, `${wave}: ${p}`);
  }
  for (const wave of ['pulse', 'pulse0', 'odd', 'ramp', 'saw']) assert.ok(gibbsOvershoot(wave, 0.4, 100).fraction > 0.07, wave);
  assert.equal(gibbsOvershoot('tri', 0.5, 25).fraction, 0);
  assert.equal(MAX_HARMONICS, 25);
});
