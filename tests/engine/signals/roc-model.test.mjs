import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROC_FAMILIES, rocModel, rocControls, dragPole, previewSignal, previewCurve, describeRoc, rocLesson,
  PLANE_RANGE,
} from '../../../src/signals-roc-model.js';

import { controlDefaults } from '../../../src/signals-util.js';

const rocDefaults = (family) => controlDefaults(rocControls(family));
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const FAMILIES = ROC_FAMILIES.map((f) => f.value);

// complex helpers for the independent transform checks
const cdiv = (n, d) => {
  const k = d.re * d.re + d.im * d.im;
  return { re: (n.re * d.re + n.im * d.im) / k, im: (n.im * d.re - n.re * d.im) / k };
};
const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });

test('default examples are the textbook cases: ROC side, stability and causality', () => {
  const expected = {
    's-right': { roc: 'Re{s} > −1', stable: true, causal: true },
    's-left': { roc: 'Re{s} < 1', stable: true, causal: false },
    's-two': { roc: '−1 < Re{s} < 1', stable: true, causal: false },
    'z-right': { roc: '|z| > 0.6', stable: true, causal: true },
    'z-left': { roc: '|z| < 1.5', stable: true, causal: false },
    'z-two': { roc: '0.5 < |z| < 1.5', stable: true, causal: false },
  };
  for (const family of FAMILIES) {
    const m = rocModel(family, rocDefaults(family));
    assert.equal(m.inequality, expected[family].roc, family);
    assert.equal(m.stable, expected[family].stable, family);
    assert.equal(m.causal, expected[family].causal, family);
  }
});

test('stability needs the jω axis / unit circle strictly inside the ROC', () => {
  assert.equal(rocModel('s-right', { re: 0, im: 0 }).stable, false); // pole on the axis
  assert.equal(rocModel('s-right', { re: 0.5, im: 0 }).stable, false);
  assert.equal(rocModel('s-right', { re: -0.01, im: 2 }).stable, true);
  assert.equal(rocModel('s-left', { re: 1, im: 0 }).stable, true);
  assert.equal(rocModel('s-left', { re: -1, im: 0 }).stable, false);
  assert.equal(rocModel('z-right', { re: 1, im: 0 }).stable, false);
  assert.equal(rocModel('z-right', { re: 0.6, im: 0.9 }).stable, false); // |p| = 1.08
  assert.equal(rocModel('z-right', { re: 0.6, im: 0.7 }).stable, true); // |p| < 1
  assert.equal(rocModel('z-left', { re: 0.5, im: 0 }).stable, false);
  assert.equal(rocModel('z-two', { p1: 0.5, p2: 0.8 }).stable, false); // unit circle outside the annulus
  assert.equal(rocModel('s-two', { p1: 0.2, p2: 1 }).stable, false); // axis left of the strip
});

test('two-sided ROC is empty when the poles swap', () => {
  const swapped = rocModel('s-two', { p1: 1, p2: -1 });
  assert.equal(swapped.empty, true);
  assert.equal(swapped.roc.kind, 'empty');
  assert.equal(swapped.stable, false);
  assert.match(describeRoc(swapped, 's-two'), /ROC가 없어/);
  assert.equal(rocModel('s-two', { p1: 0.5, p2: 0.5 }).empty, true);
  assert.equal(rocModel('z-two', { p1: -1.2, p2: 1 }).empty, true); // |a1| >= |a2|
});

test('poles, zeros: conjugate pairs and the zero of the sum', () => {
  const pair = rocModel('s-right', { re: -1, im: 2 });
  assert.deepEqual(pair.poles.map((p) => [p.re, p.im]), [[-1, 2], [-1, -2]]);
  assert.deepEqual(pair.zeros, [{ re: -1, im: 0 }]);
  const two = rocModel('s-two', { p1: -1, p2: 3 });
  assert.deepEqual(two.zeros, [{ re: 1, im: 0 }]);
  const z = rocModel('z-right', { re: 0.6, im: 0 });
  assert.deepEqual(z.zeros, [{ re: 0, im: 0 }]);
  assert.equal(rocModel('s-left', { re: 1, im: 0 }).zeros.length, 0);
});

test('algebraic transforms printed for the examples', () => {
  assert.equal(rocModel('s-right', { re: -1, im: 0 }).transform, 'X(s)=1/(s+1)');
  assert.equal(rocModel('s-left', { re: 2, im: 0 }).transform, 'X(s)=1/(s−2)');
  assert.equal(rocModel('s-right', { re: -1, im: 2 }).transform, 'X(s)=2(s+1)/((s+1)²+4)');
  assert.equal(rocModel('z-right', { re: 0.6, im: 0 }).transform, 'X(z)=z/(z−0.6)');
  assert.equal(rocModel('z-left', { re: 1.5, im: 0 }).transform, 'X(z)=z/(z−1.5)');
  assert.equal(rocModel('s-two', { p1: -1, p2: 1 }).transform, 'X(s)=1/(s+1)+1/(s−1)');
});

test('Laplace pairs: the integral of the preview signal equals the printed transform inside the ROC', () => {
  const integralAt = (fn, s, lo, hi, N = 400000) => {
    const d = (hi - lo) / N;
    let re = 0;
    let im = 0;
    for (let k = 0; k < N; k++) {
      const t = lo + (k + 0.5) * d;
      const x = fn(t);
      const decay = Math.exp(-s.re * t);
      re += x * decay * Math.cos(s.im * t);
      im -= x * decay * Math.sin(s.im * t);
    }
    return { re: re * d, im: im * d };
  };
  const cases = [
    ['s-right', { re: -1, im: 0 }, { re: 0.4, im: 0.7 }, (s) => cdiv({ re: 1, im: 0 }, { re: s.re + 1, im: s.im })],
    ['s-left', { re: 1, im: 0 }, { re: -0.5, im: 1.1 }, (s) => cdiv({ re: 1, im: 0 }, { re: s.re - 1, im: s.im })],
    ['s-right', { re: -1, im: 2 }, { re: 0.3, im: 0.5 }, (s) => {
      const a = cdiv({ re: 1, im: 0 }, { re: s.re + 1, im: s.im - 2 });
      const b = cdiv({ re: 1, im: 0 }, { re: s.re + 1, im: s.im + 2 });
      return cadd(a, b);
    }],
    ['s-two', { p1: -1, p2: 1 }, { re: 0.2, im: 0.9 }, (s) => cadd(
      cdiv({ re: 1, im: 0 }, { re: s.re + 1, im: s.im }), cdiv({ re: 1, im: 0 }, { re: s.re - 1, im: s.im }),
    )],
  ];
  for (const [family, params, s, formula] of cases) {
    const x = previewSignal(family, params);
    const numeric = integralAt(x, s, -40, 40);
    const exact = formula(s);
    near(numeric.re, exact.re, 2e-3);
    near(numeric.im, exact.im, 2e-3);
  }
});

test('Z pairs: the sum of x[n] z^-n equals the printed transform inside the ROC', () => {
  const sumAt = (fn, z, lo, hi) => {
    let re = 0;
    let im = 0;
    const r = Math.hypot(z.re, z.im);
    const theta = Math.atan2(z.im, z.re);
    for (let n = lo; n <= hi; n++) {
      const mag = r ** -n;
      re += fn(n) * mag * Math.cos(-n * theta);
      im += fn(n) * mag * Math.sin(-n * theta);
    }
    return { re, im };
  };
  const zOver = (z, p) => cdiv(z, { re: z.re - p.re, im: z.im - p.im });
  const cases = [
    ['z-right', { re: 0.6, im: 0 }, { re: 1.7, im: 0.4 }, (z) => zOver(z, { re: 0.6, im: 0 })],
    ['z-left', { re: 1.5, im: 0 }, { re: 0.6, im: 0.5 }, (z) => zOver(z, { re: 1.5, im: 0 })],
    ['z-right', { re: 0.6, im: 0.5 }, { re: 1.4, im: 0.8 }, (z) => cadd(zOver(z, { re: 0.6, im: 0.5 }), zOver(z, { re: 0.6, im: -0.5 }))],
    ['z-two', { p1: 0.5, p2: 1.5 }, { re: 0.9, im: 0.4 }, (z) => cadd(zOver(z, { re: 0.5, im: 0 }), zOver(z, { re: 1.5, im: 0 }))],
  ];
  for (const [family, params, z, formula] of cases) {
    const x = previewSignal(family, params);
    const numeric = sumAt(x, z, -400, 400);
    const exact = formula(z);
    near(numeric.re, exact.re, 1e-6);
    near(numeric.im, exact.im, 1e-6);
  }
});

test('preview signals have the right support: right-sided, left-sided, two-sided', () => {
  const right = previewSignal('z-right', { re: 0.5, im: 0 });
  assert.equal(right(-1), 0);
  assert.equal(right(0), 1);
  const left = previewSignal('z-left', { re: 2, im: 0 });
  near(left(0), 0);
  near(left(-1), -0.5);
  const ct = previewSignal('s-left', { re: 1, im: 0 });
  assert.equal(ct(1), 0);
  assert.ok(ct(-1) < 0);
  const two = previewSignal('s-two', { p1: -1, p2: 1 });
  assert.ok(two(1) > 0 && two(-1) < 0);
  assert.equal(previewCurve('z-right', { re: 0.6, im: 0 }).length, 17);
  assert.ok(previewCurve('s-right', { re: -1, im: 0 }).length > 100);
});

test('dragging: one-pole families snap to the real axis and clamp; two-pole stay real', () => {
  const snapped = dragPole('s-right', { re: -1, im: 1 }, 0, { re: 0.5, im: 0.1 });
  assert.deepEqual(snapped, { re: 0.5, im: 0 });
  const pair = dragPole('s-right', { re: -1, im: 0 }, 0, { re: -2, im: -1.2 });
  assert.deepEqual(pair, { re: -2, im: 1.2 }); // lower half-plane mirrors to the same pair
  assert.equal(dragPole('s-left', { re: 1, im: 0 }, 0, { re: 99, im: 99 }).re, 3);
  assert.equal(dragPole('z-right', { re: 0.5, im: 0 }, 0, { re: -5, im: 5 }).im, 1.8);
  const two = dragPole('z-two', { p1: 0.5, p2: 1.5 }, 1, { re: 1.1, im: 0.9 });
  assert.deepEqual(two, { p1: 0.5, p2: 1.1 });
  assert.equal(dragPole('s-two', { p1: -1, p2: 1 }, 0, { re: -0.3, im: 2 }).p1, -0.3);
  assert.ok(PLANE_RANGE.s > 3 && PLANE_RANGE.z > 1.8);
});

test('every family: controls inside their ranges, text and description exist', () => {
  for (const family of FAMILIES) {
    for (const c of rocControls(family)) assert.ok(c.initial >= c.min && c.initial <= c.max && c.step > 0, `${family}/${c.key}`);
    const params = rocDefaults(family);
    assert.ok(rocLesson.read(family).length > 15);
    assert.match(rocLesson.formula(family), /↔/);
    assert.match(rocLesson.describe({ family, params }), /ROC/);
  }
});

test('printed transforms omit zero coefficients and bare parentheses', () => {
  const text = (family, params) => rocModel(family, params).transform;
  assert.equal(text('z-right', { re: 0, im: 0.8 }), 'X(z)=2z²/(z²+0.64)');
  assert.equal(text('z-right', { re: 0.5, im: 0.7 }), 'X(z)=2z(z−0.5)/(z²−z+0.74)');
  assert.equal(text('z-right', { re: -1, im: 0.5 }), 'X(z)=2z(z+1)/(z²+2z+1.25)');
  assert.equal(text('s-right', { re: 0, im: 2 }), 'X(s)=2s/(s²+4)');
  assert.equal(text('s-right', { re: -1, im: 2 }), 'X(s)=2(s+1)/((s+1)²+4)');
  assert.equal(text('s-right', { re: 0, im: 0 }), 'X(s)=1/s');
  assert.equal(text('z-right', { re: 0, im: 0 }), 'X(z)=z/z=1');
  assert.equal(text('s-two', { p1: 0, p2: 1 }), 'X(s)=1/s+1/(s−1)');
  for (const family of FAMILIES) {
    for (const re of [-1, 0, 0.5]) {
      for (const im of [0, 0.8]) {
        const params = { re, im, p1: re, p2: 1.2 };
        assert.doesNotMatch(text(family, params).replace(/^X\([sz]\)=/, ''), /\((?:s|z)\)|z\(z\)|zz|\+−|−\+|−-/, `${family} ${re} ${im}`);
      }
    }
  }
});

test('left-sided z pole at 0 uses the same corrected radius in the text, the preview and the ROC', () => {
  const params = { re: 0, im: 0 };
  const model = rocModel('z-left', params);
  assert.equal(model.roc.hi, 0.05);
  assert.equal(model.transform, 'X(z)=z/(z−0.05)');
  near(previewSignal('z-left', params)(-1), -(0.05 ** -1));
  // a conjugate pair with Re = 0 keeps radius |p| = Im everywhere (no 0.05 offset in the preview)
  const pair = { re: 0, im: 0.8 };
  assert.equal(rocModel('z-left', pair).roc.hi, 0.8);
  near(previewSignal('z-left', pair)(-2), -2 * 0.8 ** -2 * Math.cos((Math.PI / 2) * -2), 1e-9);
});
