import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LTI_FAMILIES, ltiFrame, ltiLesson, stepResponse, rcImpulse, stepWindow, rlcNatural, criticalR, rootLocus, RLC_PRESETS, forcedResponse,
  hExp, hOsc, absIntegral, absIntegralTo, isCausalH, TEST_SYSTEMS, linearityTest, timeInvarianceTest, testErrors,
} from '../../../src/signals-lti-model.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const rel = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} versus ${b}`);

// RK4 integration of y'' + R y' + Cinv y = 0 (independent of the closed forms).
function rk4(R, Cinv, y0, y1, tEnd, steps = 20000) {
  const f = (y, v) => [v, -R * v - Cinv * y];
  let [y, v] = [y0, y1];
  const h = tEnd / steps;
  for (let i = 0; i < steps; i++) {
    const k1 = f(y, v);
    const k2 = f(y + (h / 2) * k1[0], v + (h / 2) * k1[1]);
    const k3 = f(y + (h / 2) * k2[0], v + (h / 2) * k2[1]);
    const k4 = f(y + h * k3[0], v + h * k3[1]);
    y += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    v += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  }
  return y;
}

test('Ex 2.8 / 2.18: RC step response is 1 - e^{-4t} (the slide prints e^{4t}); h = ds/dt = 4 e^{-4t}', () => {
  const tau = 0.25;
  for (const t of [0.05, 0.25, 0.5, 1.2]) near(stepResponse(tau, t), 1 - Math.exp(-4 * t));
  assert.equal(stepResponse(tau, -0.3), 0);
  near(stepResponse(tau, tau), 1 - Math.exp(-1)); // 63.2 % at t = tau
  near(rcImpulse(tau, 0.5), 4 * Math.exp(-2));
  assert.equal(rcImpulse(tau, -1), 0);
  // h(t) = d s / dt, for several time constants
  for (const T of [0.1, 0.25, 1.5]) {
    for (const t of [0.05, 0.3, 1]) {
      const d = 1e-6;
      rel((stepResponse(T, t + d) - stepResponse(T, t - d)) / (2 * d), rcImpulse(T, t), 1e-6);
    }
  }
  // the lecture reads h(0+) = 1/tau = 4, h(0.5) = 0.54, h(1) = 0.07
  near(rcImpulse(tau, 1e-12), 4); // h(0+) = 1/tau (h(0) itself is undefined)
  near(rcImpulse(tau, 0.5), 0.5413, 1e-3);
  near(rcImpulse(tau, 1), 0.0733, 1e-3);
  assert.deepEqual(stepWindow(0.25), { lo: -0.25, hi: 1.5 });
  assert.match(ltiLesson.describe({ family: 'step', params: { tau: 0.25 }, cursor: 0.25 }), /s=0\.6321, h=ds\/dt=1\.472/);
});

test('Ex 2.14 / 2.15a / 2.15b: RLC natural responses reproduce the lecture closed forms', () => {
  const a = rlcNatural(RLC_PRESETS['nat-a']); // R=5, L=1, C=1/6, y(0)=1.5, i(0)=2
  assert.equal(a.kind, 'over');
  near(a.roots[0][0], -2);
  near(a.roots[1][0], -3);
  near(a.coeffs[0], 16.5);
  near(a.coeffs[1], -15);
  for (const t of [0, 0.3, 1.1]) near(a.y(t), 16.5 * Math.exp(-2 * t) - 15 * Math.exp(-3 * t));
  const b = rlcNatural(RLC_PRESETS['nat-b']); // R=2, C=1/26, y(0)=2, i(0)=0.5
  assert.equal(b.kind, 'under');
  near(b.sigma, -1);
  near(b.omega, 5);
  near(b.coeffs[0], 2);
  near(b.coeffs[1], 3);
  for (const t of [0, 0.4, 2]) near(b.y(t), Math.exp(-t) * (2 * Math.cos(5 * t) + 3 * Math.sin(5 * t)));
  const c = rlcNatural(RLC_PRESETS['nat-c']); // R=6, C=1/9
  assert.equal(c.kind, 'critical');
  near(c.roots[0][0], -3);
  near(c.coeffs[0], 2);
  near(c.coeffs[1], 10.5);
  for (const t of [0, 0.4, 2]) near(c.y(t), (2 + 10.5 * t) * Math.exp(-3 * t));
  near(a.y1, 12); // y'(0) = i(0)/C
  near(b.y1, 13);
  near(c.y1, 4.5);
});

test('natural response agrees with direct ODE integration for every damping case and initial value', () => {
  for (const [family, preset] of Object.entries(RLC_PRESETS)) {
    for (const R of [0.4, 1, 2, 4.2, criticalR(preset.Cinv), 7.5, 12, 14]) {
      for (const y0 of [-2, 0, 1.5]) {
        const sol = rlcNatural({ ...preset, R, y0 });
        const y1 = preset.i0 * preset.Cinv;
        for (const t of [0.35, 1.2, 2.5]) rel(sol.y(t), rk4(R, preset.Cinv, y0, y1, t), 2e-5);
        near(sol.y(0), y0, 1e-12);
      }
    }
    // damping case follows the sign of R^2 - 4/C, critical at R = 2 sqrt(L/C)
    const rc = criticalR(preset.Cinv);
    assert.equal(rlcNatural({ ...preset, R: rc * 0.7 }).kind, 'under', family);
    assert.equal(rlcNatural({ ...preset, R: rc }).kind, 'critical', family);
    assert.equal(rlcNatural({ ...preset, R: rc * 1.4 }).kind, 'over', family);
  }
  near(criticalR(9), 6);
  near(criticalR(26), 2 * Math.sqrt(26));
});

test('root locus: complex branches left of the critical resistance, two real branches after it', () => {
  const { upper, lower, real1, real2, rc } = rootLocus(26);
  near(rc, 2 * Math.sqrt(26));
  assert.ok(upper.every(([re, im]) => im > 0 && Math.abs(re * re + im * im - 26) < 1e-9)); // circle of radius sqrt(1/LC)
  assert.ok(lower.every(([, im]) => im < 0));
  assert.ok(real1.every(([re]) => re <= 0) && real2.every(([re]) => re <= real1[0][0] + 1e-9));
});

test('Ex 2.16: y\' + 4y = 20 cos(8t), y(0)=5 gives 4e^{-4t} + cos 8t + 2 sin 8t (transient + steady state)', () => {
  const f = forcedResponse({ a: 4, omega: 8, y0: 5 });
  near(f.k1, 1);
  near(f.k2, 2);
  near(f.c, 4);
  near(f.amplitude, Math.sqrt(5));
  for (const t of [0, 0.2, 1, 2.9]) {
    near(f.total(t), 4 * Math.exp(-4 * t) + Math.cos(8 * t) + 2 * Math.sin(8 * t));
    near(f.total(t), f.transient(t) + f.steady(t));
  }
  near(f.total(0), 5);
  assert.match(ltiLesson.describe({ family: 'forced', params: { a: 4, omega: 8, y0: 5 } }), /y=4e\^\(−4t\)\+1cos\(8t\)\+2sin\(8t\)/);
  // the ODE holds for other parameters (numerical derivative)
  for (const p of [{ a: 2, omega: 5, y0: -3 }, { a: 7, omega: 13, y0: 9 }]) {
    const g = forcedResponse(p);
    for (const t of [0.1, 0.9]) {
      const d = 1e-6;
      near((g.total(t + d) - g.total(t - d)) / (2 * d) + p.a * g.total(t), 20 * Math.cos(p.omega * t), 1e-5);
    }
    near(g.total(0), p.y0);
  }
});

test('causality and BIBO stability follow h(t): e^{-a(t-d)}u(t-d) and e^{-sigma t} sin 5t u(t)', () => {
  const integral = (fn, lo, hi, n = 400000) => {
    const h = (hi - lo) / n;
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs(fn(lo + (i + 0.5) * h)) * h;
    return s;
  };
  // Ex 2.24: a > 0 stable with integral 1/a
  near(absIntegral('bibo', { a: 2, d: 0 }), 0.5);
  near(integral(hExp(2, 0), -2, 30), 0.5, 1e-4);
  for (const a of [0, -0.5]) assert.equal(absIntegral('bibo', { a, d: 0 }), Infinity);
  assert.equal(isCausalH('bibo', { a: 1, d: 0.5 }), true);
  assert.equal(isCausalH('bibo', { a: 1, d: -0.25 }), false);
  assert.equal(isCausalH('bibo-osc', { sigma: 1 }), true);
  // oscillatory: closed form (w/(s^2+w^2)) coth(pi s / 2w) vs numeric sum
  for (const sigma of [0.25, 1, 2]) near(absIntegral('bibo-osc', { sigma }), integral(hOsc(sigma), 0, 60 / sigma), 2e-4);
  assert.equal(absIntegral('bibo-osc', { sigma: 0 }), Infinity);
  assert.equal(absIntegral('bibo-osc', { sigma: -0.5 }), Infinity);
  // the running integral approaches the total for a stable system and grows for an unstable one
  near(absIntegralTo('bibo', { a: 1, d: 0.25 }, 40), 1, 1e-9);
  assert.equal(absIntegralTo('bibo', { a: 1, d: 0.25 }, 0), 0);
  assert.ok(absIntegralTo('bibo', { a: -0.5, d: 0 }, 6) > absIntegralTo('bibo', { a: -0.5, d: 0 }, 3));
  near(absIntegralTo('bibo-osc', { sigma: 1 }, 40), absIntegral('bibo-osc', { sigma: 1 }), 1e-3);
  assert.match(ltiLesson.describe({ family: 'bibo', params: { a: 1, d: -0.5 } }), /비인과.*BIBO 안정/);
  assert.match(ltiLesson.describe({ family: 'bibo', params: { a: -1, d: 0 } }), /인과.*불안정/);
});

test('Ex 2.1 / 2.2 tests: 5x linear + time-invariant; 5x+3, 3x^2, cos x nonlinear; 3cos(t)x(t) linear but time-varying', () => {
  const verdict = TEST_SYSTEMS.map((_, i) => testErrors(i, 2, 1.25, 2));
  assert.deepEqual(verdict.map((v) => v.linear), [true, false, false, false, true]);
  assert.deepEqual(verdict.map((v) => v.timeInvariant), [true, true, true, true, false]);
  // 5x + 3: the offset 3 is counted once in the actual output but (a1 + a2) times in the expected one
  const l = linearityTest(1, 2, 1.25, 0.3);
  near(l.expected - l.actual, 3 * (2 + 1.25) - 3);
  const t = timeInvarianceTest(4, 2, 3);
  assert.notEqual(t.response, t.shifted);
  const same = timeInvarianceTest(0, 2, 3);
  near(same.response, same.shifted);
  // linearity of the TI-failing system: superposition does hold
  near(linearityTest(4, -1.5, 0.75, 1.9).expected, linearityTest(4, -1.5, 0.75, 1.9).actual);
  assert.match(ltiLesson.describe({ family: 'test', params: { a1: 2, a2: 1.25, T: 2, sys: 4 } }), /이론 판정: 선형, 시변.*선형성 일치, 시불변성 불일치/);
  assert.match(ltiLesson.describe({ family: 'test', params: { a1: 2, a2: 1.25, T: 2, sys: 1 } }), /이론 판정: 비선형, 시불변.*선형성 불일치.*시불변성 일치/);
});

test('linearity / time-invariance verdicts are fixed by the system; one matching input never turns into a pass', () => {
  // theory per system does not depend on alpha or T
  for (const [sys, linear, timeInvariant] of [[0, true, true], [1, false, true], [2, false, true], [3, false, true], [4, true, false]]) {
    for (const [a1, a2, T] of [[2, 1.25, 2], [0.5, 0.5, 0], [1, 0, 0], [0, 1, 3], [-3, 3, 1]]) {
      const e = testErrors(sys, a1, a2, T);
      assert.equal(e.linear, linear, `${sys} ${a1} ${a2}`);
      assert.equal(e.timeInvariant, timeInvariant, `${sys} T=${T}`);
      assert.equal(e.linear, TEST_SYSTEMS[sys].linear);
    }
  }
  // 5x+3 with a1 + a2 = 1 hides the offset: the curves match although the system is not linear
  const hidden = testErrors(1, 0.5, 0.5, 2);
  assert.equal(hidden.linearMatch, true);
  assert.equal(hidden.linear, false);
  assert.equal(hidden.linearHidden, true);
  assert.match(ltiLesson.describe({ family: 'test', params: { a1: 0.5, a2: 0.5, T: 2, sys: 1 } }), /이론 판정: 비선형.*선형성 일치.*드러나지 않음 — α₁, α₂를 바꿔/);
  // 3x^2 and cos(x) with one input switched off look linear in the same way (alpha = (1, 0))
  for (const sys of [2, 3]) assert.equal(testErrors(sys, 1, 0, 2).linearHidden, true, `${sys}`);
  // 3cos(t)x(t) at T = 0: no delay, nothing to see
  const tv = testErrors(4, 2, 1.25, 0);
  assert.equal(tv.timeMatch, true);
  assert.equal(tv.timeInvariant, false);
  assert.equal(tv.timeHidden, true);
  assert.match(ltiLesson.describe({ family: 'test', params: { a1: 2, a2: 1.25, T: 0, sys: 4 } }), /시변.*시불변성 일치.*드러나지 않음 — T를 바꿔/);
  // a truly linear system never gets a hint
  assert.doesNotMatch(ltiLesson.describe({ family: 'test', params: { a1: 0.5, a2: 0.5, T: 0, sys: 0 } }), /드러나지 않음/);
  // the plot titles say it is this input only
  const frame = ltiFrame('test', { sys: 1, a1: 0.5, a2: 0.5, T: 2 });
  assert.match(frame.panes[0].title, /이 입력: 일치/);
});

test('step response marker at t = 0 shows the one-sided limits, not h(0)', () => {
  const at0 = ltiLesson.describe({ family: 'step', params: { tau: 0.25 }, cursor: 0 });
  assert.match(at0, /h\(0\)은 미정의.*h\(0⁻\)=0.*h\(0⁺\)=1\/τ=4/);
  assert.doesNotMatch(at0, /h=ds\/dt=0/);
  const frame = ltiFrame('step', { tau: 0.25 }, 0);
  assert.deepEqual(frame.panes[1].dots, []); // no marker dot on the jump
  const tangent = frame.panes[0].segments[0];
  near((tangent.y2 - tangent.y1) / (tangent.x2 - tangent.x1), 4, 1e-9); // right-hand slope
  assert.ok(frame.panes[1].jumps[0].list.some((j) => j.x === 0 && j.left === 0 && Math.abs(j.right - 4) < 1e-5));
  const after = ltiFrame('step', { tau: 0.25 }, 0.3);
  assert.equal(after.panes[1].dots.length, 1);
  near(after.panes[1].dots[0].y, 4 * Math.exp(-1.2));
});

test('step response panes share the same full-range ticks, tau is marked separately', () => {
  for (const tau of [0.05, 0.25, 1, 2]) {
    const [top, bottom] = ltiFrame('step', { tau }, 0.1).panes;
    assert.deepEqual(top.xTicks, bottom.xTicks);
    assert.ok(Math.max(...top.xTicks) >= top.x[1] * 0.7, `ticks reach the right edge for tau=${tau}: ${top.xTicks}`);
    assert.ok(top.vlines.some((v) => v.x === tau) && bottom.vlines.some((v) => v.x === tau));
  }
});

test('every example draws finite frames at initial / min / max sliders and has a Korean read line', () => {
  for (const { value } of LTI_FAMILIES) {
    const controls = ltiLesson.controls(value, {});
    for (const pick of [(c) => c.initial, (c) => c.min, (c) => c.max]) {
      const params = Object.fromEntries(controls.map((c) => [c.key, pick(c)]));
      const spec = ltiLesson.cursor(value, params);
      const frame = ltiFrame(value, params, spec?.initial ?? 0);
      assert.ok(frame.panes.length >= 2 && frame.legend.length >= 2, value);
      for (const pane of frame.panes) {
        assert.ok(pane.x[1] > pane.x[0] && pane.y[1] > pane.y[0], `${value}: ${pane.title}`);
        for (const line of pane.lines ?? []) for (const [x, y] of line.pts) assert.ok(Number.isFinite(x) && !(y === Infinity || y === -Infinity), `${value} ${x} ${y}`);
      }
      assert.doesNotMatch(ltiLesson.describe({ family: value, params, cursor: spec?.initial ?? 0 }), /NaN|undefined|Infinity/);
    }
    const read = ltiLesson.read(value);
    assert.ok(read.length > 20 && read.length < 160, `${value}: ${read.length}`);
  }
  assert.throws(() => ltiFrame('nope', {}));
});
