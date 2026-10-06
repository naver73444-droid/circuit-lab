import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVOLUTION_FAMILIES, FLIP_OPTIONS, overlapInterval, convolutionSetup, continuousFrame, rcPulseResponse, ex222Response, ex222Slice, overlapCase, describeConvolution, convolutionLesson,
} from '../../../src/signals-convolution-model.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);

// y(t) = integral x(l) h(t-l) dl by the midpoint rule (independent of the closed forms)
function numeric(setup, t, n = 60000) {
  const { lo, hi } = setup.axis;
  const h = (hi - lo) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const l = lo + (i + 0.5) * h;
    sum += setup.x(l) * setup.h(t - l) * h;
  }
  return sum;
}

test('lecture families are listed: Ex 2.20, 2.21, 2.22', () => {
  const values = CONVOLUTION_FAMILIES.map((f) => f.value);
  for (const v of ['rc-step', 'rc-pulse', 'ex222']) assert.ok(values.includes(v), v);
});

test('Ex 2.20: x = u(t), h = 4e^{-4t}u(t) (RC = 1/4) gives y = (1 - e^{-4t})u(t)', () => {
  const setup = convolutionSetup('rc-step', { tau: 0.25 });
  for (const t of [-0.5, 0.1, 0.5, 1.2]) {
    near(setup.y(t), t <= 0 ? 0 : 1 - Math.exp(-4 * t));
    near(numeric(setup, t), setup.y(t), 3e-3);
  }
  near(setup.h(0.5), 4 * Math.exp(-2));
});

test('Ex 2.21: x = Pi(t) through the RC: maximum 1 - e^{-1/RC} at t = 1/2 (0.9817 for RC = 1/4)', () => {
  const setup = convolutionSetup('rc-pulse', { tau: 0.25 });
  near(setup.y(0.5), 1 - Math.exp(-4));
  near(setup.y(0.5), 0.9817, 1e-4);
  for (const t of [-0.8, -0.3, 0.2, 0.5, 0.9, 2]) near(numeric(setup, t), setup.y(t), 4e-3);
  // pieces: rise 1 - e^{-(t+1/2)/RC} (the slide misprints the case boundary), decay (e^{1/2RC} - e^{-1/2RC}) e^{-t/RC}
  near(rcPulseResponse(0.25, 0), 1 - Math.exp(-2));
  near(rcPulseResponse(0.25, 1), (Math.exp(2) - Math.exp(-2)) * Math.exp(-4));
  near(rcPulseResponse(0.25, -0.6), 0);
  assert.deepEqual([-0.7, -0.5, 0, 0.5, 0.6].map((t) => overlapCase('rc-pulse', t)), [1, 1, 2, 2, 3]);
});

test('Ex 2.22: h = e^{-t}[u(t)-u(t-2)] and x = Pi(t-0.5) - Pi(t-1.5): six overlap cases and the lecture values', () => {
  const setup = convolutionSetup('ex222', { alpha: 1 });
  // lecture (Fig 2.43): max 0.6321 at t=1, min -0.3996 at t=2, kink -0.2325 at t=3, 0 at t=4
  near(setup.y(1), 0.6321, 1e-4);
  near(setup.y(2), -0.3996, 1e-4);
  near(setup.y(3), -0.2325, 1e-4);
  near(setup.y(4), 0, 1e-12);
  // the six cases computed from the definition
  near(ex222Response(1, 0.5), 1 - Math.exp(-0.5)); // case 2: 1 - e^{-t}
  near(ex222Response(1, 1.5), (2 * Math.E - 1) * Math.exp(-1.5) - 1); // case 3
  near(ex222Response(1, 2.5), (2 * Math.E - Math.E ** 2) * Math.exp(-2.5) - Math.exp(-2)); // case 4
  near(ex222Response(1, 3.5), Math.exp(-2) - Math.exp(2 - 3.5)); // case 5
  assert.equal(ex222Response(1, 4.5), 0); // case 6
  assert.equal(ex222Response(1, -1), 0); // case 1
  for (const t of [0.4, 1.3, 2.2, 3.1, 3.8]) near(numeric(setup, t), setup.y(t), 4e-3);
  assert.deepEqual([-1, 0.5, 1.5, 2.5, 3.5, 4.5].map((t) => overlapCase('ex222', t)), [1, 2, 3, 4, 5, 6]);
  assert.match(describeConvolution(setup, 2.5), /\(Case 4\)/);
  // another decay rate works too
  const slow = convolutionSetup('ex222', { alpha: 0.4 });
  for (const t of [0.7, 2.4]) near(numeric(slow, t), slow.y(t), 4e-3);
});

test('Ex 2.22 displayed formula: the integral is taken only when the lower limit is below the upper one, otherwise F = 0', () => {
  const formula = convolutionLesson.formula('ex222');
  assert.ok(formula.includes('dλ, max(A,t−2)<min(B,t); F(A,B)=0, max(A,t−2)≥min(B,t)'));
  // the displayed formula read literally (with the guard) against the model, over the whole axis
  const shown = (alpha, t) => {
    const F = (A, B) => {
      const lo = Math.max(A, t - 2);
      const hi = Math.min(B, t);
      return lo < hi ? (Math.exp(-alpha * (t - hi)) - Math.exp(-alpha * (t - lo))) / alpha : 0;
    };
    return F(0, 1) - F(1, 2);
  };
  for (const alpha of [0.25, 1, 3]) for (let t = -1; t <= 5; t += 0.125) near(shown(alpha, t), ex222Response(alpha, t), 1e-12);
  // the reported mismatch: alpha = 1, t = 0.5, F(1,2) has no overlap (lower limit 1 > upper limit 0.5): a reversed integral would give 1.042
  near(ex222Slice(1, 0.5, 1, 2), 0, 1e-12);
  near(ex222Response(1, 0.5), 1 - Math.exp(-0.5), 1e-12);
  const reversed = (1 - Math.exp(-0.5)) - (Math.exp(-0.5 * 1 + 0) * 0 + (Math.exp(-(0.5 - 0.5)) - Math.exp(-(0.5 - 1))) / 1);
  near(reversed, 1.0420, 1e-3);
  // lecture limits: max 0.6321 at t=1, 0 outside (0, 4)
  near(ex222Response(1, 1), 0.6321, 1e-4);
  for (const t of [-0.3, 4, 4.7]) assert.equal(ex222Response(1, t), 0);
});

test('the flipped / moving copies carry their jump limits (u(0) is undefined: open circles, not a midpoint)', () => {
  const setup = convolutionSetup('rc-pulse', { tau: 0.25 });
  const frame = continuousFrame(setup, 0.3, 400);
  assert.ok(frame.movingJumps.length >= 1);
  for (const j of frame.movingJumps) assert.ok(Math.abs(j.left - j.right) > 1e-6);
  assert.ok(frame.moving.some(([, y]) => Number.isNaN(y)), 'the polyline is cut at a jump');
  assert.ok(frame.flipped.some(([, y]) => Number.isNaN(y)));
});

test('commutativity select: flipping x or h gives the same y(t); only the moving copy changes', () => {
  assert.deepEqual(FLIP_OPTIONS.map((o) => o.value), [0, 1]);
  for (const family of ['rect-rect', 'tri-rect', 'exp-rect', 'exp-exp', 'rc-step', 'rc-pulse', 'ex222']) {
    const base = convolutionSetup(family, { flip: 0 });
    const swapped = convolutionSetup(family, { flip: 1 });
    assert.equal(base.flip, 0);
    assert.equal(swapped.flip, 1);
    for (const f of [0.1, 0.35, 0.6, 0.85]) {
      const t = base.domain.min + (base.domain.max - base.domain.min) * f;
      near(base.y(t), swapped.y(t), 1e-12);
      const a = continuousFrame(base, t, 600);
      const b = continuousFrame(swapped, t, 600);
      near(a.y, b.y, 1e-12);
      // the area under the product is the same number whichever copy is flipped
      const area = (frame) => frame.product.reduce((s, p, i, arr) => (i && Number.isFinite(p[1]) && Number.isFinite(arr[i - 1][1]) ? s + ((p[1] + arr[i - 1][1]) / 2) * (p[0] - arr[i - 1][0]) : s), 0);
      near(area(a), area(b), 2e-2 * Math.max(1, Math.abs(a.y)));
    }
  }
  // the moving copy is x(t-lambda) in flip mode: exp(-alpha (t-lambda)) for lambda < t, zero after t
  const swapped = convolutionSetup('exp-rect', { alpha: 1, T2: 1, flip: 1 });
  const frame = continuousFrame(swapped, 2, 400);
  const before = frame.moving.find(([lambda, v]) => lambda > 1.4 && lambda < 1.6 && Number.isFinite(v));
  near(before[1], Math.exp(-(2 - before[0])), 1e-9);
  assert.ok(frame.moving.filter(([lambda, v]) => lambda > 2.05 && Number.isFinite(v)).every(([, v]) => v === 0));
});

test('commutativity reading: both selections state x*h = h*x with the same y and the overlap interval', () => {
  const params0 = { T1: 2, T2: 1, flip: 0 };
  const params1 = { T1: 2, T2: 1, flip: 1 };
  const d0 = describeConvolution(convolutionSetup('rect-rect', params0), 1.5);
  const d1 = describeConvolution(convolutionSetup('rect-rect', params1), 1.5);
  for (const d of [d0, d1]) {
    assert.match(d, /y\(t\)=1 /);
    assert.match(d, /x∗h = h∗x: 뒤집는 쪽을 바꿔도 y는 같음/);
  }
  assert.match(d0, /h\(t−λ\)를 뒤집음, 겹침 λ∈\[0\.5, 1\.5\]/);
  assert.match(d1, /x\(t−λ\)를 뒤집음, 겹침 λ∈\[0, 1\]/);
  assert.equal(overlapInterval(convolutionSetup('rect-rect', params0), 4), null);
  assert.match(describeConvolution(convolutionSetup('rect-rect', params1), -1), /겹침 없음/);
  assert.deepEqual(overlapInterval(convolutionSetup('exp-exp', { alpha: 1, beta: 2, flip: 0 }), 2), [0, 2]);
  assert.deepEqual(overlapInterval(convolutionSetup('rc-pulse', { tau: 0.25, flip: 1 }), 0.3), [0, 0.8]);
  const select = convolutionLesson.controls('rect-rect', {}).find((c) => c.key === 'flip');
  assert.deepEqual(select.options.map((o) => o.label), ['뒤집을 쪽: h(λ)', '뒤집을 쪽: x(λ)']);
  assert.equal(convolutionLesson.controls('dt-basic', {}).some((c) => c.key === 'flip'), false);
});

test('lessons text: variable lambda and the Flip-Shift-Multiply-Integrate procedure', () => {
  assert.match(convolutionLesson.formula('rc-step'), /∫ x\(λ\) h\(t−λ\) dλ/);
  assert.match(convolutionLesson.read('rect-rect'), /뒤집기→이동→곱→적분/);
  for (const family of ['rc-step', 'rc-pulse', 'ex222']) {
    const controls = convolutionLesson.controls(family, {});
    assert.equal(controls.length, 2); // the parameter slider and the flip select
    assert.ok(controls[1].options && controls[1].key === 'flip');
    const spec = convolutionLesson.cursor(family, Object.fromEntries(controls.map((c) => [c.key, c.initial])), null);
    assert.ok(spec.initial >= spec.min && spec.initial <= spec.max, family);
    assert.doesNotMatch(convolutionLesson.describe({ family, params: Object.fromEntries(controls.map((c) => [c.key, c.initial])), cursor: spec.initial, extra: {} }), /NaN/);
  }
});
