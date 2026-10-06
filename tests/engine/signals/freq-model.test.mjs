import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREQ_FAMILIES, freqFrame, freqLesson, rcH, rlcH, rlcDamping, rlcResonance, steadyState, pulseCoefficient, trainOutputCoefficient,
  trainOutput, trainInput, trainExact, trainPowers, pulseX, pulseOutput, describeFreq, INPUT_AMPLITUDE,
} from '../../../src/signals-freq-model.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const TAU = 2 * Math.PI;

test('H(w) of the RC low-pass is 1/(1 + j w/w_c): |H| = 1/sqrt(1+(w/w_c)^2), angle = -atan(w/w_c)', () => {
  const fc = 80; // w_c = 160 pi rad/s (Ex 4.45)
  const wc = TAU * fc;
  near(wc, 160 * Math.PI);
  for (const f of [0, 20, 80, 100, 500, -40]) {
    const w = TAU * f;
    const den = 1 + (w / wc) ** 2;
    const h = rcH(fc, f);
    near(h.re, 1 / den);
    near(h.im, -(w / wc) / den);
    near(h.mag, 1 / Math.sqrt(den));
    near(h.phase, -Math.atan(w / wc));
    near(Math.hypot(h.re, h.im), h.mag);
  }
  near(rcH(80, 80).mag, Math.SQRT1_2); // -3 dB at the cutoff
  near(rcH(80, 80).phase, -Math.PI / 4);
});

test('Ex 4.45: 5 cos(2 pi f t) through the RC (f_c = 80 Hz) at 20, 100, 200, 500 Hz, recomputed from the definition', () => {
  const rows = [[20, 0.9701, -0.245, 4.8507], [100, 0.6247, -0.896, 3.1235], [200, 0.3714, -1.19, 1.857], [500, 0.158, -1.4121, 0.79]];
  for (const [f, mag, phase, amp] of rows) {
    const h = rcH(80, f);
    near(h.mag, mag, 6e-5);
    near(h.phase, phase, 1e-3);
    const ss = steadyState(h, INPUT_AMPLITUDE, f);
    near(ss.amplitude, amp, 1e-3);
    // y(t) = |H| A cos(w t + Theta) and the delay t_d = -Theta/w
    for (const t of [0, 0.0007, 0.0123]) near(ss.y(t), amp === 0 ? 0 : INPUT_AMPLITUDE * h.mag * Math.cos(TAU * f * t + h.phase));
    near(ss.delay, -h.phase / (TAU * f));
  }
  const first = steadyState(rcH(80, 20), 5, 20);
  near(first.delay, 0.00195, 3e-5); // 1.9 ms: 4.8507 cos(40 pi (t - 0.0019))
  near(first.y(0.0019), 5 * 0.9701 * Math.cos(TAU * 20 * 0.0019 - 0.245), 5e-3);
  assert.match(freqLesson.describe({ family: 'rc', params: { fc: 80, fin: 20, axis: 1, scale: 0 } }), /\|H\|=0\.9701, Θ=−0\.245 rad/);
});

test('input phase: A cos(2 pi f t + phi) -> A|H| cos(2 pi f t + phi + Theta); the delay does not depend on phi', () => {
  const h = rcH(80, 100);
  for (const phi of [-1.2, 0, 0.7, 2.9]) {
    const ss = steadyState(h, 5, 100, phi);
    near(ss.phase, phi + h.phase);
    near(ss.delay, -h.phase / (TAU * 100));
    for (const t of [0, 0.0013, 0.0044]) {
      near(ss.x(t), 5 * Math.cos(TAU * 100 * t + phi));
      near(ss.y(t), 5 * h.mag * Math.cos(TAU * 100 * (t - ss.delay) + phi)); // the output is the input delayed by t_d and scaled
    }
  }
  assert.ok(freqLesson.describe({ family: 'rc', params: { fc: 80, fin: 20, phi: 0.5, axis: 1, scale: 0 } }).includes('y=4.851cos(2πft+0.255)'));
  assert.deepEqual(freqLesson.controls('rc', {}).filter((c) => !c.options).map((c) => c.key), ['fc', 'fin', 'phi']);
});

test('series RLC (output across C): H = w0^2 / ((w0^2 - w^2) + j w R/L); resonance and damping', () => {
  const R = 2;
  const w2 = 26; // Ex 2.15a: R=2, L=1, C=1/26
  for (const f of [0, 0.3, 0.81, 2]) {
    const w = TAU * f;
    const den = { re: w2 - w * w, im: w * R };
    const h = rlcH(R, w2, f);
    // |H| = w0^2/|den|, angle = -arg(den)
    near(h.mag, w2 / Math.hypot(den.re, den.im));
    near(h.phase, -Math.atan2(den.im, den.re));
    // complex value times the denominator gives w0^2
    near(h.re * den.re - h.im * den.im, w2);
    near(h.re * den.im + h.im * den.re, 0, 1e-9);
  }
  near(rlcH(R, w2, 0).mag, 1); // DC gain 1
  near(rlcDamping(2, 26), 1 / Math.sqrt(26));
  const res = rlcResonance(R, w2);
  near(res.omega, Math.sqrt(26 - 2), 1e-12); // w0 sqrt(1 - 2 zeta^2) = sqrt(w0^2 - R^2/2)
  near(rlcH(R, w2, res.omega / TAU).mag, res.peak, 1e-9);
  assert.equal(rlcResonance(6, 9).peak, 1); // zeta = 1: no resonance peak
  // the lecture form H = 1/((26 - w^2) + j 2 w) is the same function divided by w0^2
  near(rlcH(2, 26, 0.4).mag * (1 / 26), 1 / Math.hypot(26 - (TAU * 0.4) ** 2, 2 * TAU * 0.4));
});

test('Ex 4.46: periodic pulse train (T0 = 50 ms, d = 0.2) through the RC: d_k = c_k H(k f0)', () => {
  const d = 0.2;
  const f0 = 20;
  for (let k = -6; k <= 6; k++) near(pulseCoefficient(d, k), d * (k === 0 ? 1 : Math.sin(Math.PI * k * d) / (Math.PI * k * d)));
  near(pulseCoefficient(d, 0), 0.2);
  for (const k of [1, 2, 3, 5, -4]) {
    const q = trainOutputCoefficient(d, 80, k);
    const h = rcH(80, k * f0);
    near(q.mag, Math.abs(pulseCoefficient(d, k)) * h.mag);
    // angle d_k = angle c_k - atan(k f0 / f_c)
    const expected = (pulseCoefficient(d, k) < 0 ? Math.PI : 0) - Math.atan((k * f0) / 80);
    near(Math.cos(q.phase), Math.cos(expected));
    near(Math.sin(q.phase), Math.sin(expected));
  }
  // c_k from the waveform by direct integration over one period
  for (const k of [0, 1, 2, 3]) {
    let c = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const t = -0.025 + ((i + 0.5) / n) * 0.05;
      c += trainInput(d, t) * Math.cos((TAU * k * t) / 0.05) / n;
    }
    near(c, pulseCoefficient(d, k), 1e-4);
  }
});

test('harmonic sum of the output converges to the exact exponential charge/discharge response', () => {
  for (const [d, fc] of [[0.2, 80], [0.5, 40], [0.1, 150]]) {
    for (const t of [-0.021, -0.0076, 0.0021, 0.0087, 0.0241]) {
      near(trainOutput(d, fc, 3000, t), trainExact(d, fc, t), 2e-3);
    }
  }
  // the output stays in [0, 1], is periodic and has the time-domain DC value d
  const exact = (t) => trainExact(0.2, 80, t);
  near(exact(0.013), exact(0.013 + 0.05), 1e-12);
  let mean = 0;
  for (let i = 0; i < 20000; i++) mean += exact(-0.025 + ((i + 0.5) / 20000) * 0.05) / 20000;
  near(mean, 0.2, 1e-4);
  // few harmonics: still a partial sum with the DC term first
  near(trainOutput(0.2, 80, 0, 0.003), 0.2);
  // Parseval: total power of the input pulse train = d (height 1)
  const p = trainPowers(0.2, 4000);
  near(p.total, 0.2);
  near(p.partial, 0.2, 1e-3);
  near(p.dc, 0.04);
  near(trainPowers(1 / 3, 1).dc, 1 / 9, 1e-12); // Ex 4.38: P_dc = (1/3)^2 = 0.1111
});

test('Ex 4.47: pulse input: Y = H X, checked against the Fourier transform of the exact output (Ex 2.21)', () => {
  const fc = 0.5;
  const tau = 1 / (TAU * fc);
  // |Y| = |sinc f| / sqrt(1 + (f/fc)^2); angle Y = angle X - atan(f/fc)
  for (const f of [0, 0.4, 1.3, 2.5]) {
    const x = pulseX(f);
    near(x.mag, Math.abs(f === 0 ? 1 : Math.sin(Math.PI * f) / (Math.PI * f)));
    // numerical transform of y(t)
    let re = 0;
    let im = 0;
    const lo = -0.5;
    const hi = 12 * tau + 1;
    const n = 80000;
    const h = (hi - lo) / n;
    for (let i = 0; i < n; i++) {
      const t = lo + (i + 0.5) * h;
      const y = pulseOutput(fc, t);
      re += y * Math.cos(TAU * f * t) * h;
      im -= y * Math.sin(TAU * f * t) * h;
    }
    const H = rcH(fc, f);
    const sinc = f === 0 ? 1 : Math.sin(Math.PI * f) / (Math.PI * f);
    near(re, sinc * H.re, 2e-4);
    near(im, sinc * H.im, 2e-4);
  }
  // output: rises to 1 - e^{-1/RC} at t = 1/2, then decays; the area is H(0) X(0) = 1
  near(pulseOutput(fc, 0.5), 1 - Math.exp(-1 / tau));
  assert.equal(pulseOutput(fc, -0.7), 0);
  // the slide's f_c = 80 Hz: RC is tiny, the output is almost the input
  near(pulseOutput(80, 0.4), 1, 5e-3);
  assert.match(describeFreq('pulse', { fc: 0.5, axis: 0 }), /y 최댓값 0\.9568/);
});

test('every example draws finite frames at the slider extremes with both axis conventions and both scales', () => {
  for (const { value } of FREQ_FAMILIES) {
    const controls = freqLesson.controls(value, {});
    for (const pick of [(c) => c.initial, (c) => c.min, (c) => c.max]) {
      for (const axis of [0, 1]) {
        for (const scale of [0, 1]) {
          const params = { ...Object.fromEntries(controls.map((c) => [c.key, pick(c)])), axis, scale };
          const frame = freqFrame(value, params);
          assert.ok(frame.panes.length === 3, value);
          for (const pane of frame.panes) {
            assert.ok(pane.x[1] > pane.x[0] && pane.y[1] > pane.y[0], `${value}: ${pane.title}`);
            for (const item of [...(pane.lines ?? []), ...(pane.stems ?? [])]) for (const [x, y] of item.pts) assert.ok(Number.isFinite(x) && y !== Infinity, `${value} ${x} ${y}`);
          }
          assert.doesNotMatch(freqLesson.describe({ family: value, params }), /NaN|undefined|Infinity/);
        }
      }
    }
    const read = freqLesson.read(value);
    assert.ok(read.length > 20 && read.length < 160, `${value}: ${read.length}`);
  }
  assert.throws(() => freqFrame('nope', {}));
});

test('axis toggle: omega mode labels the panes with omega and rad/s, Hz mode with f; H lesson defaults to omega, spectra to Hz', () => {
  const rc = freqLesson.controls('rc', {});
  assert.equal(rc.find((c) => c.key === 'axis').initial, 1);
  assert.equal(freqLesson.controls('train', {}).find((c) => c.key === 'axis').initial, 0);
  const base = { fc: 80, fin: 20, scale: 0 };
  const omega = freqFrame('rc', { ...base, axis: 1 });
  const hz = freqFrame('rc', { ...base, axis: 0 });
  assert.match(omega.panes[0].title, /ω \[rad\/s\]/);
  assert.match(hz.panes[0].title, /f \[Hz\]/);
  near(omega.panes[0].x[1] / hz.panes[0].x[1], TAU, 1e-12);
  // log scale: dB magnitude, decade ticks
  const log = freqFrame('rc', { ...base, axis: 0, scale: 1 });
  assert.match(log.panes[0].title, /dB/);
  assert.ok(log.panes[0].xTicks.every((t) => /^\d/.test(t.label)));
  assert.ok(log.panes[0].lines[0].pts.every(([, y]) => y <= 0.001)); // low-pass: never above 0 dB
});

test('the plot window always contains the input frequency (RC fc=10 Hz with 500 Hz; RLC w0^2=1 with 4 Hz), in both axes and scales', () => {
  const inside = (frame, f, axis, scale) => {
    const x = scale === 1 ? Math.log10(axis === 1 ? TAU * f : f) : (axis === 1 ? TAU * f : f);
    for (const pane of frame.panes.slice(0, 2)) assert.ok(x >= pane.x[0] && x <= pane.x[1], `x=${x} outside [${pane.x}]`);
    const marker = frame.panes[0].dots[0];
    assert.ok(Math.abs(marker.x - x) < 1e-9 && marker.x >= frame.panes[0].x[0] && marker.x <= frame.panes[0].x[1]);
  };
  for (const axis of [0, 1]) {
    for (const scale of [0, 1]) {
      inside(freqFrame('rc', { fc: 10, fin: 500, phi: 0, axis, scale }), 500, axis, scale);
      inside(freqFrame('rc', { fc: 200, fin: 5, phi: 0, axis, scale }), 5, axis, scale);
      inside(freqFrame('rlc', { R: 2, w2: 1, fin: 4, axis, scale }), 4, axis, scale);
      inside(freqFrame('rlc', { R: 2, w2: 1, fin: 0.05, axis, scale }), 0.05, axis, scale);
      inside(freqFrame('rlc', { R: 14, w2: 50, fin: 4, axis, scale }), 4, axis, scale);
    }
  }
  // the usual case keeps the usual window (7 f_c for RC, 3.2 f0 for RLC)
  near(freqFrame('rc', { fc: 80, fin: 20, phi: 0, axis: 0, scale: 0 }).panes[0].x[1], 560, 1e-9);
});

test('pulse train: the spectrum panes cover every synthesized harmonic (N up to 40)', () => {
  for (const N of [1, 20, 21, 40]) {
    const frame = freqFrame('train', { N, d: 0.2, fc: 80, axis: 0 });
    const f0 = 20;
    const used = frame.panes[0].stems.flatMap((s) => s.pts.map(([x]) => x));
    assert.ok(Math.max(...used) >= Math.max(20, N) * f0 - 0.2 * f0 - 1e-9, `N=${N}`);
    assert.ok(frame.panes[0].x[1] > Math.max(20, N) * f0, `N=${N}`);
    // each harmonic <= N is drawn as an included (non-faint) stem
    const included = frame.panes[0].stems.slice(0, 2).flatMap((s) => s.pts.map(([x]) => x));
    assert.equal(included.length, 2 * (2 * N + 1), `N=${N}`);
  }
});

test('RLC steady-state formula: the input amplitude 5 and the evaluated frequency appear, not the resonance value', () => {
  for (const family of ['rc', 'rlc']) {
    const text = freqLesson.formula(family);
    assert.ok(text.includes('x=5cos(ωt+θ) ⇒ y=5|H(ω)|cos(ωt+θ+Θ(ω))'), family);
    assert.ok(!text.includes('|H(ω₀)|cos'), family);
  }
});
