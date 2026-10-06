import test from 'node:test';
import assert from 'node:assert/strict';
import { rectangleConvolution, exponentialConvolution, discreteConvolution } from '../../../src/signals-course-model.js';
import { prepareCustomConvolution } from '../../../src/signals-expression.js';
import {
  CONVOLUTION_FAMILIES, DT_PRESETS, convolutionSetup, continuousFrame, convolutionFrame, flippedImpulse,
  triangleCumulative, expRectConvolution, outputCurve, describeConvolution, convolutionLesson, isDiscreteFamily,
} from '../../../src/signals-convolution-model.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const CT = ['rect-rect', 'exp-rect', 'tri-rect', 'exp-exp'];

// Independent oracle: midpoint rule over the shared axis.
function numericConvolution(setup, t, N = 60000) {
  const { lo, hi } = setup.axis;
  const d = (hi - lo) / N;
  let sum = 0;
  for (let k = 0; k < N; k++) {
    const tau = lo + (k + 0.5) * d;
    sum += setup.x(tau) * setup.h(t - tau);
  }
  return sum * d;
}

test('closed-form y(t) of every continuous family agrees with numerical integration', () => {
  for (const family of CT) {
    const setup = convolutionSetup(family);
    const { min, max } = setup.domain;
    for (const f of [0.05, 0.2, 0.37, 0.5, 0.71, 0.9]) {
      const t = min + (max - min) * f;
      near(setup.y(t), numericConvolution(setup, t), 2e-3);
    }
  }
});

test('slider values reach the setup (all widths and decays)', () => {
  const a = convolutionSetup('rect-rect', { T1: 3, T2: 0.5 });
  near(a.y(1), 0.5);
  near(a.y(3.25), 0.25);
  const b = convolutionSetup('tri-rect', { T1: 2, T2: 2 });
  near(b.y(2), 1); // rect covers the whole triangle: area = T1/2
  near(b.y(10), 0);
  const c = convolutionSetup('exp-exp', { alpha: 2, beta: 0.5 });
  near(c.y(1), exponentialConvolution(1, 2, 0.5));
});

test('triangle cumulative and exp*rect closed forms', () => {
  near(triangleCumulative(0.5, 2), 0.125);
  near(triangleCumulative(1, 2), 0.5);
  near(triangleCumulative(1.5, 2), 0.875);
  near(triangleCumulative(9, 2), 1);
  near(triangleCumulative(-1, 2), 0);
  near(expRectConvolution(0.5, 1, 1), 1 - Math.exp(-0.5));
  near(expRectConvolution(3, 1, 1), Math.exp(-2) - Math.exp(-3));
  near(expRectConvolution(-1, 1, 1), 0);
});

test('product pane area equals y(t) in every family (the picture matches the number)', () => {
  for (const family of CT) {
    const setup = convolutionSetup(family);
    const { min, max } = setup.domain;
    for (const f of [0.15, 0.4, 0.65]) {
      const t = min + (max - min) * f;
      const { product, y } = continuousFrame(setup, t, 3000);
      let area = 0;
      for (let i = 1; i < product.length; i++) area += ((product[i][1] + product[i - 1][1]) / 2) * (product[i][0] - product[i - 1][0]);
      near(area, y, 5e-3);
    }
  }
});

test('flip hint curve is h(-tau) and the moving copy is h(t-tau)', () => {
  const setup = convolutionSetup('rect-rect', { T1: 2, T2: 1 });
  const frame = continuousFrame(setup, 1.5, 400);
  const away = (tau, edges) => edges.every((edge) => Math.abs(tau - edge) > 1e-6);
  for (const [tau, value] of frame.moving) if (away(tau, [0.5, 1.5])) near(value, setup.h(1.5 - tau));
  for (const [tau, value] of frame.flipped) if (away(tau, [0, -1])) near(value, setup.h(-tau));
  // jump points are present twice so the polyline draws vertical edges
  assert.ok(frame.moving.filter(([tau]) => Math.abs(tau - 0.5) < 1e-6).length >= 2);
});

test('rectangle fixture values (moved)', () => {
  assert.deepEqual([-0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3].map((t) => rectangleConvolution(t, 2, 1).y), [0, 0, 0.5, 1, 1, 1, 0.5, 0]);
});

test('exponential integrand and exact output agree with independent contract (moved)', () => {
  near(exponentialConvolution(1, 1, 1), 1 / Math.E, 1e-12);
  near(exponentialConvolution(1, 1, 2), Math.exp(-1) - Math.exp(-2), 1e-12);
});

test('DT convolution offsets, signed/zero terms and outside support (moved)', () => {
  const frame = convolutionFrame([1, 2, -1], [2, 1], -1, 2, 2);
  assert.deepEqual(frame.output, { start: 1, values: [2, 5, 0, -1] });
  assert.deepEqual(frame.terms.map((v) => v.product), [1, 4, -0]);
  assert.equal(frame.sum, 5);
  for (const n of [0, 1, 2, 3, 4, 5]) {
    assert.equal(convolutionFrame([1, 2, -1], [2, 1], -1, 2, n).sum, { 1: 2, 2: 5, 3: 0, 4: -1 }[n] || 0);
  }
  assert.throws(() => convolutionFrame([1], [1], 0, 0, 0.5));
});

test('DT cursor domain is an integer grid and includes both zero-support ends (moved)', () => {
  const setup = convolutionSetup('custom-dt', {}, { x: [1, 2, -1], h: [2, 1], xStart: -1, hStart: 2 });
  assert.deepEqual({ min: setup.domain.min, max: setup.domain.max, step: setup.domain.step }, { min: 0, max: 5, step: 1 });
  assert.ok(Number.isInteger(setup.cursor0));
});

test('DT presets: stems of every frame sum to the output, flipped copy is h[n-k]', () => {
  for (const family of Object.keys(DT_PRESETS)) {
    const setup = convolutionSetup(family);
    const reference = discreteConvolution(setup.x, setup.h, setup.xStart, setup.hStart);
    assert.deepEqual(setup.output, reference);
    for (let n = setup.domain.min; n <= setup.domain.max; n++) {
      const frame = convolutionFrame(setup.x, setup.h, setup.xStart, setup.hStart, n);
      const expected = reference.values[n - reference.start] ?? 0;
      near(frame.sum, expected, 1e-12);
    }
    const flipped = flippedImpulse(setup.h, setup.hStart, 3);
    assert.deepEqual(flipped.map(([k]) => k), setup.h.map((_, j) => 3 - setup.hStart - j));
  }
});

test('advanced continuous input builds a setup whose y matches the rectangle fixture', () => {
  const prepared = prepareCustomConvolution('u(t)-u(t-2)', 'u(t)-u(t-1)', 4, 0.02);
  const setup = convolutionSetup('custom', {}, prepared);
  for (const [t, y] of [[-0.5, 0], [0.5, 0.5], [1.5, 1], [2.5, 0.5], [3.5, 0]]) near(setup.y(t), y, 1e-9);
  near(setup.domain.min, -8);
  near(setup.axis.hi, 8);
  assert.equal(outputCurve(setup), prepared.output);
  assert.match(describeConvolution(setup, 1.5), /y\(t\)=1/);
});

test('readout and lesson description for every family', () => {
  for (const { value } of CONVOLUTION_FAMILIES) {
    assert.ok(convolutionLesson.read(value).length > 10);
    assert.ok(convolutionLesson.formula(value).includes(isDiscreteFamily(value) ? 'Σ' : '∫'));
  }
  assert.match(describeConvolution(convolutionSetup('dt-basic'), 1), /y\[1\] = 3/);
  const spec = convolutionLesson.cursor('exp-rect', { alpha: 1, T2: 1 }, null);
  assert.ok(spec.min < 0 && spec.max > spec.initial && spec.initial >= spec.min);
  assert.equal(convolutionLesson.cursor('custom', {}, null), null);
});
