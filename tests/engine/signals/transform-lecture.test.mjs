import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSFORM_FAMILIES, spectrumValue, timeSignal, transformMetrics, transformControls, transformLesson, describeTransform, transformFrame,
  signalEnergy, bandEnergy, timeRange, freqRange, cosineAutocorrelation,
} from '../../../src/signals-transform-model.js';
import { controlDefaults } from '../../../src/signals-util.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const TAU = 2 * Math.PI;
const defaults = (family) => controlDefaults(transformControls(family));
const sinc = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));

// X(f) = integral x(t) e^{-j 2 pi f t} dt by the midpoint rule over [lo, hi]
function numericTransform(family, p, f, lo, hi, n = 160000) {
  const d = (hi - lo) / n;
  let re = 0;
  let im = 0;
  for (let k = 0; k < n; k++) {
    const t = lo + (k + 0.5) * d;
    const x = timeSignal(family, p, t);
    re += x * Math.cos(TAU * f * t) * d;
    im -= x * Math.sin(TAU * f * t) * d;
  }
  return { re, im };
}

test('Ex 4.12: rectangle of height A and width tau: X = A tau sinc(f tau); equal area keeps X(0) = 1 while the spectrum widens', () => {
  for (const [A, T] of [[1, 1], [2, 0.5], [0.5, 2]]) {
    const p = { A, T, t0: 0 };
    near(spectrumValue('rect', p, 0).mag, 1, 1e-12); // area A T = 1
    for (const f of [0.3, 1.1, 2.7]) near(spectrumValue('rect', p, f).re, A * T * sinc(f * T), 1e-12);
    near(spectrumValue('rect', p, 1 / T).mag, 0, 1e-12); // zeros at n/tau
    near(spectrumValue('rect', p, 2 / T).mag, 0, 1e-12);
    const num = numericTransform('rect', p, 0.4, -4, 4);
    near(num.re, spectrumValue('rect', p, 0.4).re, 3e-4);
  }
  // narrower pulse -> larger bandwidth
  assert.ok(transformMetrics('rect', { A: 2, T: 0.5, t0: 0 }).freqWidth > transformMetrics('rect', { A: 1, T: 1, t0: 0 }).freqWidth);
  assert.ok(transformMetrics('rect', { A: 0.5, T: 2, t0: 0 }).freqWidth < transformMetrics('rect', { A: 1, T: 1, t0: 0 }).freqWidth);
});

test('Ex 4.13: delayed pulse A Pi((t - tau/2)/tau): |X| unchanged, angle -pi f tau plus a pi step where sinc < 0', () => {
  const T = 1.5;
  const p = { A: 1, T, t0: T / 2 };
  for (const f of [0.2, 0.5, 0.9, 1.3, 1.9]) {
    const x = spectrumValue('rect', p, f);
    near(x.mag, Math.abs(T * sinc(f * T)), 1e-12);
    const expected = -Math.PI * f * T + (sinc(f * T) < 0 ? Math.PI : 0);
    near(Math.cos(x.phase), Math.cos(expected), 1e-9);
    near(Math.sin(x.phase), Math.sin(expected), 1e-9);
  }
});

test('Ex 4.16: two-sided exponential e^{-a|t|} has the real spectrum 2a/(a^2 + w^2); Ex 4.15: right-sided exponential is 1/(a + jw)', () => {
  for (const alpha of [0.5, 1, 2.5]) {
    for (const f of [0, 0.3, 1.2]) {
      const w = TAU * f;
      const x = spectrumValue('twoexp', { alpha, t0: 0 }, f);
      near(x.re, (2 * alpha) / (alpha * alpha + w * w));
      near(x.im, 0);
      const num = numericTransform('twoexp', { alpha, t0: 0 }, f, -30 / alpha, 30 / alpha, 400000);
      near(num.re, x.re, 2e-3);
      const r = spectrumValue('exp', { alpha, t0: 0 }, f);
      near(r.re, alpha / (alpha * alpha + w * w));
      near(r.im, -w / (alpha * alpha + w * w));
    }
  }
  const m = transformMetrics('twoexp', { alpha: 2, t0: 0 });
  near(m.peak, 1);
  near(m.timeWidth, Math.LN2, 1e-12); // |t| <= ln2/a
  near(m.freqWidth, 2 / Math.PI, 1e-12); // |X| = max/2 at w = +-a
  near(spectrumValue('twoexp', { alpha: 2, t0: 0 }, 2 / TAU).mag, m.peak / 2, 1e-12);
});

test('duality: x = sinc(t/T) has the rectangular spectrum T Pi(fT) (and Pi(t) <-> sinc(f))', () => {
  for (const T of [0.5, 1, 2]) {
    const p = { T, t0: 0 };
    near(spectrumValue('sinc', p, 0).mag, T);
    near(spectrumValue('sinc', p, 0.4 / T).mag, T);
    near(spectrumValue('sinc', p, 0.6 / T).mag, 0);
    near(spectrumValue('sinc', p, 0.5 / T).mag, T / 2); // midpoint at the edge
    const num = numericTransform('sinc', p, 0.25 / T, -400 * T, 400 * T, 600000);
    near(num.re, T, 2e-2 * T);
  }
  // X(t) <-> 2 pi x(-w): Pi's transform sinc, transformed again, gives 2 pi Pi(-w): |sinc| area 1 for |f| < 1/2
  near(transformMetrics('sinc', { T: 1, t0: 0 }).freqWidth, 1);
});

test('Ex 4.14: unit-area pulse of width a: X = sinc(f a) -> 1 as a -> 0 (delta <-> 1)', () => {
  for (const a of [2, 1, 0.2, 0.1]) {
    near(spectrumValue('delta', { a }, 0).mag, 1);
    near(spectrumValue('delta', { a }, 1 / a).mag, 0, 1e-12); // first zero 1/a
    near(spectrumValue('delta', { a }, 0.3).re, sinc(0.3 * a));
    near(timeSignal('delta', { a }, a * 0.2), 1 / a);
  }
  assert.ok(spectrumValue('delta', { a: 0.01 }, 3).mag > 0.998);
  near(transformMetrics('delta', { a: 0.1 }).freqWidth, 20 * 0.6035, 0.05); // widens as 1/a
});

test('modulation: x(t) cos(w0 t) has half-height copies of X at +-f0 (checked against direct integration)', () => {
  const p = { T: 2, f0: 2 };
  for (const f of [0, 1.4, 1.9, 2, 2.6, -2.2, 3.7]) {
    const spec = spectrumValue('mod', p, f);
    const num = numericTransform('mod', p, f, -1, 1, 100000);
    near(spec.re, num.re, 2e-4);
    near(spec.re, 0.5 * 2 * (sinc((f - 2) * 2) + sinc((f + 2) * 2)), 1e-12);
  }
  near(transformMetrics('mod', p).peak, spectrumValue('mod', p, 2).mag);
  assert.deepEqual(transformMetrics('mod', p).freqSpan.map((v) => Math.round((v - p.f0) * 1000) / 1000), [-transformMetrics('mod', p).freqWidth / 2, transformMetrics('mod', p).freqWidth / 2].map((v) => Math.round(v * 1000) / 1000));
});

test('cos <-> two impulses (area 1/2 in f, pi in w) and 1 <-> delta (area 1 in f, 2 pi in w)', () => {
  const frameHz = transformFrame('cos', { f0: 1, axis: 0 });
  const frameW = transformFrame('cos', { f0: 1, axis: 1 });
  assert.equal(frameHz.panes[1].segments.length, 2);
  assert.deepEqual(frameHz.panes[1].texts.map((t) => t.text), ['1/2', '1/2']);
  assert.deepEqual(frameW.panes[1].texts.map((t) => t.text), ['π', 'π']);
  near(frameW.panes[1].segments[1].x1, TAU, 1e-12); // at +w0 = 2 pi f0
  near(frameW.panes[1].segments[0].x1, -TAU, 1e-12);
  const dc = transformFrame('cos', { f0: 0, axis: 1 });
  assert.equal(dc.panes[1].segments.length, 1);
  assert.deepEqual(dc.panes[1].texts.map((t) => t.text), ['2π']);
  assert.deepEqual(transformFrame('cos', { f0: 0, axis: 0 }).panes[1].texts.map((t) => t.text), ['1']);
  assert.match(describeTransform('cos', { f0: 1, axis: 1 }), /면적 π/);
  assert.match(describeTransform('cos', { f0: 0, axis: 1 }), /2πδ\(ω\)/);
  // numerical check: cos(w0 t) has 1/2 weights: the time signal is cos
  near(timeSignal('cos', { f0: 1 }, 0.25), 0, 1e-12);
  near(timeSignal('cos', { f0: 0 }, 7), 1);
});

test('Ex 4.41: ESD of sinc(10 t): G = (1/100) Pi(f/10), E = 0.1, and 0.06 inside |f| < 3 Hz (60 %)', () => {
  const p = { T: 0.1, fB: 3, t0: 0 };
  near(spectrumValue('esd', p, 0).mag ** 2, 0.01);
  near(spectrumValue('esd', p, 4.9).mag ** 2, 0.01);
  near(spectrumValue('esd', p, 5.2).mag, 0);
  near(signalEnergy('esd', p), 0.1);
  near(bandEnergy('esd', p, 3), 0.06, 1e-6);
  near(bandEnergy('esd', p, 5), 0.1, 1e-6);
  // Parseval: time-domain energy of sinc(t/T) equals the area of |X|^2
  let e = 0;
  const n = 400000;
  const lim = 400;
  const h = (2 * lim * p.T) / n;
  for (let k = 0; k < n; k++) e += timeSignal('esd', p, -lim * p.T + (k + 0.5) * h) ** 2 * h;
  near(e, 0.1, 2e-3);
  assert.match(describeTransform('esd', { ...p, axis: 0 }), /E=0\.1, \|f\|<3 Hz 안 에너지 0\.06 \(60%\)/);
  const frame = transformFrame('esd', { ...p, axis: 0 });
  assert.match(frame.panes[1].title, /ESD G\(f\)/);
});

test('Ex 4.42: x = 5 cos(200 pi t): T0 = 0.01 s, r(tau) = (25/2) cos(200 pi tau), PSD = (25/4) delta(f -+ 100)', () => {
  const p = { A: 5, f0: 100, axis: 0 };
  near(cosineAutocorrelation(5, 100, 0), 12.5);
  // r(tau) from the time average over one period
  for (const tau of [0, 0.001, 0.0033, 0.0071]) {
    let r = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const t = -0.005 + ((i + 0.5) / n) * 0.01;
      r += (timeSignal('psd', p, t) * timeSignal('psd', p, t + tau)) / n;
    }
    near(r, cosineAutocorrelation(5, 100, tau), 1e-6);
  }
  const hz = transformFrame('psd', p);
  assert.deepEqual(hz.panes[1].texts.map((t) => t.text), ['6.25', '6.25']);
  near(hz.panes[1].segments[0].x1, -100);
  near(hz.panes[1].segments[1].x1, 100);
  const w = transformFrame('psd', { ...p, axis: 1 });
  assert.deepEqual(w.panes[1].texts.map((t) => t.text), ['39.3', '39.3']); // S(w) = 2 pi |c|^2 delta(w -+ w0) = 2 pi 6.25
  assert.ok(describeTransform('psd', p).includes('P=r(0)=12.5, S(f)=(A²/4)δ(f∓f₀) 면적 6.25씩 · 합 12.5'));
  assert.ok(describeTransform('psd', { ...p, axis: 1 }).includes('S(ω)에는 2π가 곱해져 39.3'));
  near(timeRange('psd', p).hi, 0.02);
  assert.equal(signalEnergy('psd', p), Infinity);
  assert.ok(transformLesson.formula('psd', { axis: 0 }).includes('S_x(f)=F{r}=(A²/4)'));
});

test('Parseval for the unit shapes: closed-form energy equals the area of |X(f)|^2 and of x(t)^2', () => {
  for (const family of ['rect', 'tri', 'exp', 'twoexp', 'gauss', 'sinc', 'delta', 'mod']) {
    const p = { ...defaults(family), t0: 0 };
    const tr = timeRange(family, p);
    let et = 0;
    const n = 200000;
    const dt = (tr.hi - tr.lo) / n;
    for (let k = 0; k < n; k++) et += timeSignal(family, p, tr.lo + (k + 0.5) * dt) ** 2 * dt;
    if (family !== 'sinc') near(et, signalEnergy(family, p), 2e-3 * Math.max(1, signalEnergy(family, p)));
    const half = 60;
    near(bandEnergy(family, p, half, 120000), signalEnergy(family, p), family === 'sinc' || family === 'exp' ? 2e-2 : 6e-3);
  }
  assert.equal(signalEnergy('cos', { f0: 1 }), Infinity);
});

test('axis toggle: omega mode scales the frequency axes by 2 pi and uses the omega form of the formulas', () => {
  const p = { ...defaults('rect'), axis: 0 };
  const hz = transformFrame('rect', p);
  const w = transformFrame('rect', { ...p, axis: 1 });
  near(w.panes[1].x[1] / hz.panes[1].x[1], TAU, 1e-12);
  assert.match(w.panes[1].title, /\|X\(ω\)\| · ω \[rad\/s\]/);
  assert.match(hz.panes[1].title, /\|X\(f\)\| · f \[Hz\]/);
  // the magnitude values are the same function: X(f) = X(w) at w = 2 pi f
  const a = hz.panes[1].lines[0].pts[300];
  const b = w.panes[1].lines[0].pts[300];
  near(a[1], b[1], 1e-12);
  near(b[0] / a[0], TAU, 1e-9);
  assert.match(transformLesson.formula('rect', { axis: 1 }), /X\(ω\)=A T sinc\(ωT\/2π\)/);
  assert.match(transformLesson.formula('rect', { axis: 0 }), /X\(f\)=A T sinc\(fT\)/);
  assert.match(transformLesson.formula('sinc', { axis: 1 }), /2πx\(−ω\)/);
  assert.match(transformLesson.formula('cos', { axis: 1 }), /1↔2πδ\(ω\)/);
  assert.match(describeTransform('rect', { ...p, axis: 1 }), /rad\/s/);
  assert.match(describeTransform('rect', { ...p, axis: 0 }), / Hz /);
  // the time-bandwidth product in omega is 2 pi larger
  const prodHz = /곱 ([\d.]+)/.exec(describeTransform('rect', { ...p, axis: 0 }))[1];
  const prodW = /곱 ([\d.]+)/.exec(describeTransform('rect', { ...p, axis: 1 }))[1];
  near(Number(prodW) / Number(prodHz), TAU, 0.02);
  assert.equal(transformControls('dt').some((c) => c.key === 'axis'), false);
  for (const family of TRANSFORM_FAMILIES.map((f) => f.value).filter((f) => f !== 'dt')) assert.ok(transformControls(family).some((c) => c.key === 'axis'), family);
});

test('every family draws finite frames; ranges and metrics exist', () => {
  for (const { value } of TRANSFORM_FAMILIES) {
    for (const axis of [0, 1]) {
      const p = { ...defaults(value), axis };
      const frame = transformFrame(value, p);
      assert.equal(frame.panes.length, 3);
      assert.equal(frame.split, true);
      for (const pane of frame.panes) {
        assert.ok(pane.x[1] > pane.x[0] && pane.y[1] > pane.y[0], `${value}: ${pane.title}`);
        for (const item of [...(pane.lines ?? []), ...(pane.stems ?? []), ...(pane.areas ?? [])]) {
          for (const [x, y] of item.pts) assert.ok(Number.isFinite(x), `${value} x=${x}`);
          assert.ok(item.pts.every(([, y]) => y === null || Number.isNaN(y) || Number.isFinite(y)), value);
        }
      }
      assert.doesNotMatch(describeTransform(value, p), /NaN|undefined|Infinity/);
    }
    assert.ok(timeRange(value, defaults(value)).hi > timeRange(value, defaults(value)).lo);
    assert.ok(freqRange(value, defaults(value)).hi > freqRange(value, defaults(value)).lo);
  }
});
