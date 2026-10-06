import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPS_FAMILIES, opsFrame, opsLesson, ex11, ex12x1, ex12x2, ampOp, sumOp, prodOp, pieceFormulas, evenPart, oddPart, pulseAt, expRight, evenOddEnergy,
  energyPower, runningPower, runningEnergy, trainPower, sinePeak, siftSignal, siftIntegral, deltaApprox, stepApprox, rampApprox, idealStep, idealRamp, dtChain, dtSinusoid, EX11,
} from '../../../src/signals-ops-model.js';
import { controlDefaults } from '../../../src/signals-util.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);
const defaults = (family) => controlDefaults(opsLesson.controls(family, {}));
const integrate = (fn, lo, hi, n = 200000) => {
  const h = (hi - lo) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += fn(lo + (i + 0.5) * h) * h;
  return sum;
};

test('Ex 1.1: g1 = 1.5x - 1 and g2 = -1.3x + 1 reproduce the lecture extremes', () => {
  // polyline through (-1,0) (0,0) (1,1) (3,-1) (4,-1) (5,0) (6,0)
  for (let i = 0; i < EX11.t.length; i++) near(ex11(EX11.t[i]), EX11.v[i]);
  near(ex11(2), 0); // midpoint of the (1,1)-(3,-1) segment
  assert.equal(ex11(7), 0);
  const g1 = (t) => ampOp(t, -1, 1.5);
  near(g1(1), 0.5); // peak 0.5
  near(g1(3), -2.5); // floor -2.5
  near(g1(-1.5), -1); // baseline A outside the support
  const g2 = (t) => ampOp(t, 1, -1.3);
  near(g2(1), -0.3); // minimum -0.3 at t = 1
  near(g2(3.5), 2.3); // maximum 2.3 on 3..4
  assert.match(opsLesson.describe({ family: 'amp', params: { B: 1.5, A: -1 } }), /최댓값 0\.5, 최솟값 −2\.5/);
  assert.match(opsLesson.describe({ family: 'amp', params: { B: -1.3, A: 1 } }), /최댓값 2\.3, 최솟값 −0\.3/);
});

test('Ex 1.2: sum and product piecewise formulas agree with the signals', () => {
  const sum = pieceFormulas('sum', 1);
  assert.deepEqual(sum.map((p) => p.text), ['[0,1) 0.5t+2', '[1,2) 0.5t+1', '[2,3) −2t+4', '[3,4) t−4']);
  const prod = pieceFormulas('prod', 1);
  assert.deepEqual(prod.map((p) => p.text), ['[0,1) t', '[1,2) 0.5t', '[2,3) 2t−5', '[3,4) 0']);
  for (const [t, expectSum, expectProd] of [[0.5, 2.25, 0.5], [1.5, 1.75, 0.75], [2.5, -1, 0], [3.5, -0.5, 0], [4.5, 0, 0]]) {
    near(sumOp(t, 1), expectSum);
    near(prodOp(t, 1), expectProd);
  }
  // another gain: the slope and intercept written in the formula are the actual values of the piece
  const double = pieceFormulas('sum', 2);
  assert.equal(double[0].text, '[0,1) t+2');
  assert.equal(double[2].text, '[2,3) −4t+9');
  near(sumOp(0.5, 2), 0.5 + 2);
  near(sumOp(2.5, 2), -4 * 2.5 + 9);
  near(ex12x1(2.5), -1);
  near(ex12x2(2.5), 0);
  near(prodOp(0.5, 2), 2 * 2 * 0.25);
});

test('Ex 1.14: x = Pi(t - 1/2): x_e = (1/2) Pi(t/2), x_o = +-1/2; x_e + x_o = x', () => {
  const x = pulseAt(0.5, 1);
  const xe = evenPart(x);
  const xo = oddPart(x);
  for (const t of [-1.5, -0.7, -0.2, 0.2, 0.7, 1.5, 3]) {
    near(xe(t), Math.abs(t) < 1 ? 0.5 : 0);
    near(xo(t), t < 0 && t > -1 ? -0.5 : t > 0 && t < 1 ? 0.5 : 0);
    near(xe(t) + xo(t), x(t));
    near(xe(t), xe(-t));
    near(xo(t), -xo(-t));
  }
  const e = expRight(1.5);
  for (const t of [-2, 0.3, 1.1]) near(evenPart(e)(t) + oddPart(e)(t), e(t));
  // Energy splits without cross term
  const ex = integrate((t) => x(t) ** 2, -4, 4);
  near(integrate((t) => xe(t) ** 2, -4, 4) + integrate((t) => xo(t) ** 2, -4, 4), ex, 2e-3);
});

test('even/odd energies are closed forms (not clipped by a finite window): e^(-0.25t)u(t) has E_x = 2 and E_e = E_o = 1', () => {
  const exp = evenOddEnergy('eo-exp', { alpha: 0.25 });
  near(exp.ex, 2);
  near(exp.ee, 1);
  near(exp.eo, 1);
  assert.match(opsLesson.describe({ family: 'eo-exp', params: { alpha: 0.25 } }), /E_x=2 = E_e 1 \+ E_o 1/);
  // against a window wide enough for every slider value
  for (const alpha of [0.25, 1, 2.5]) {
    const x = expRight(alpha);
    const wide = 40 / alpha;
    near(integrate((t) => evenPart(x)(t) ** 2, -wide, wide, 400000), evenOddEnergy('eo-exp', { alpha }).ee, 1e-4);
    near(integrate((t) => oddPart(x)(t) ** 2, -wide, wide, 400000), evenOddEnergy('eo-exp', { alpha }).eo, 1e-4);
  }
  // pulse of width w centered at c: the closed form agrees with direct integration for overlapping and disjoint mirror images
  for (const [c, w] of [[0.5, 1], [0, 2], [-1.2, 3], [0.3, 0.5], [2, 3]]) {
    const x = pulseAt(c, w);
    const energy = evenOddEnergy('eo-pulse', { c, w });
    near(energy.ex, w);
    near(energy.ee + energy.eo, energy.ex);
    near(integrate((t) => evenPart(x)(t) ** 2, -8, 8, 800000), energy.ee, 2e-3);
    near(integrate((t) => oddPart(x)(t) ** 2, -8, 8, 800000), energy.eo, 2e-3);
  }
});

test('energy and power: sinusoid A^2/2, A e^{-at}u(t): A^2/(2a), A u(t): A^2/2, pulse train: mean Ad and power A^2 d', () => {
  const sin = energyPower('en-sin', { A: 3 });
  assert.equal(sin.kind, 'power');
  near(sin.power, 4.5);
  near(sin.rms, 3 / Math.SQRT2);
  assert.equal(sin.energy, Infinity);
  const decay = energyPower('en-exp', { A: 2, alpha: 0.5 });
  assert.equal(decay.kind, 'energy');
  near(decay.energy, 4);
  assert.equal(decay.power, 0);
  const step = energyPower('en-exp', { A: 2, alpha: 0 });
  assert.equal(step.kind, 'power');
  near(step.power, 2);
  const train = energyPower('en-train', { A: 2, d: 0.3 });
  near(train.mean, 0.6);
  near(train.power, 1.2);
  near(train.rms, 2 * Math.sqrt(0.3));
  // numerical checks of the running quantities
  const p = { A: 2, f0: 1, theta: 0.7 };
  const w = 2 * Math.PI * p.f0;
  for (const T of [0.3, 1.25, 4]) near(runningPower('en-sin', p, T), integrate((t) => (p.A * Math.sin(w * t + p.theta)) ** 2, -T / 2, T / 2, 100000) / T, 1e-6);
  near(runningPower('en-sin', p, 400), 2, 5e-3);
  const q = { A: 2, alpha: 1 };
  near(runningEnergy(q, 3), integrate((t) => (q.A * Math.exp(-q.alpha * t)) ** 2, 0, 3, 100000), 1e-6);
  near(runningEnergy(q, 60), 2, 1e-9);
  const tr = { A: 2, d: 0.3 };
  // one lecture window for both power examples: P_T = (1/T) integral over [-T/2, T/2] (length T)
  for (const T of [0.2, 0.55, 1, 2.65, 4]) near(trainPower(tr, T), integrate((t) => ((((t % 1) + 1) % 1) < tr.d ? 4 : 0), -T / 2, T / 2, 400000) / T, 2e-3);
  near(trainPower(tr, 200), energyPower('en-train', tr).power, 1e-3); // the limit is A^2 d
  near(runningPower('en-sin', p, 4000), energyPower('en-sin', p).power, 1e-3); // the limit is A^2/2
  assert.ok(opsLesson.formula('sum').includes('B x₂') && opsLesson.formula('prod').includes('B x₂'), 'the formula line carries the B of the item name x₁+B·x₂');
  const peak = sinePeak({ A: 2, f0: 1, theta: 0.7 });
  near(2 * Math.sin(2 * Math.PI * peak.t + 0.7), 2, 1e-9);
  assert.ok(peak.t >= 0 && peak.t < 1);
  near(peak.phasorAngle, 0.7 - Math.PI / 2);
  assert.match(opsLesson.describe({ family: 'en-sin', params: { A: 2, f0: 1, theta: 0.7 } }), /첫 양의 피크 t=\(π\/2−θ\)\/\(2πf₀\)=0\.1386 s, 페이저\(cos 기준\) X=A∠/);
  assert.match(opsLesson.describe({ family: 'en-exp', params: { A: 2, alpha: 0.5 } }), /E=4, P=0 → 에너지 신호/);
  assert.match(opsLesson.describe({ family: 'en-sin', params: { A: 2, f0: 1, theta: 0 } }), /E=∞, P=2/);
});

test('delta, step, ramp chain: areas and derivatives of the approximations, and their limits', () => {
  for (const a of [1, 0.5, 0.25, 0.05]) {
    near(integrate(deltaApprox(a), -2, 2), 1, 1e-3);
    // u_a' = q_a and r_a' = u_a away from the corners
    for (const t of [-0.6 * a, -0.2 * a, 0.3 * a, 0.7 * a, 2 * a]) {
      const h = a * 1e-4;
      near((stepApprox(a)(t + h) - stepApprox(a)(t - h)) / (2 * h), deltaApprox(a)(t), 1e-4 / a);
      near((rampApprox(a)(t + h) - rampApprox(a)(t - h)) / (2 * h), stepApprox(a)(t), 1e-3);
    }
    near(stepApprox(a)(0), 0.5);
    near(rampApprox(a)(1), 1);
  }
  near(stepApprox(0.001)(0.5), idealStep(0.5));
  near(rampApprox(0.001)(0.7), idealRamp(0.7), 1e-3);
  assert.equal(idealStep(-1), 0);
  assert.equal(idealRamp(-1), 0);
});

test('sifting: the integral of x(t) q_a(t-t1) tends to x(t1) as the pulse width a shrinks', () => {
  assert.ok(OPS_FAMILIES.some((f) => f.value === 'sift'));
  for (const t1 of [-1, -0.3, 0.6, 1]) {
    let previous = Infinity;
    for (const a of [1, 0.5, 0.2, 0.05, 0.01]) {
      const err = Math.abs(siftIntegral(siftSignal, t1, a) - siftSignal(t1));
      assert.ok(err <= previous + 1e-12, `error does not grow as a shrinks (t1=${t1}, a=${a})`);
      previous = err;
    }
    near(siftIntegral(siftSignal, t1, 0.01), siftSignal(t1), 2e-3);
  }
  // independent check against the full-line integral of x(t) q_a(t-t1)
  const a = 0.4;
  const t1 = 0.7;
  near(integrate((t) => siftSignal(t) * deltaApprox(a)(t - t1), -3, 3, 600000), siftIntegral(siftSignal, t1, a), 1e-4);
});

test('sifting example: two sliders, three panes, the reading line gives the integral and x(t1), a = 0.05 is nearly x(t1)', () => {
  const controls = opsLesson.controls('sift', {});
  assert.deepEqual(controls.map((c) => c.key), ['a', 't1']);
  assert.equal(controls[1].initial, 1);
  assert.ok(controls[1].min >= -1.5 && controls[1].max <= 1.5, 't1 stays inside the plotted range');
  const params = defaults('sift');
  const frame = opsFrame('sift', params);
  assert.ok(frame.panes.length <= 3);
  const text = opsLesson.describe({ family: 'sift', params });
  assert.match(text, /∫x\(t\)q_a\(t−t₁\)dt = /);
  assert.match(text, /x\(t₁\) = 1\.995 /);
  const sharp = opsLesson.describe({ family: 'sift', params: { a: 0.05, t1: 1 } });
  const [, integral] = sharp.match(/dt = (−?[\d.]+) →/);
  near(Number(integral.replace('−', '-')), siftSignal(1), 5e-3);
});

test('DT chain: delta = u[n]-u[n-1], u = running sum of delta, r[n] = n u[n]', () => {
  for (const n0 of [-3, 0, 2]) {
    const rows = dtChain(n0, -6, 8);
    for (const { n, delta, step, ramp } of rows) {
      assert.equal(delta, n === n0 ? 1 : 0);
      assert.equal(step, n >= n0 ? 1 : 0); // u[0] = 1
      assert.equal(ramp, Math.max(0, n - n0)); // r[n] = (n-n0) u[n-n0]
    }
    for (let i = 1; i < rows.length; i++) assert.equal(rows[i].delta, rows[i].step - rows[i - 1].step);
  }
});

test('DT sinusoid periodicity: the three lecture cases and the slider families', () => {
  const a = dtSinusoid('dt-rad', { omega: 0.2 });
  assert.equal(a.periodic, false);
  const b = dtSinusoid('dt-pi', { m: 0.2, theta: 0.2 }); // cos(0.2 pi n + pi/5)
  assert.deepEqual([b.periodic, b.N, b.k], [true, 10, 1]);
  const c = dtSinusoid('dt-pi', { m: 0.3, theta: -0.1 }); // cos(0.3 pi n - pi/10)
  assert.deepEqual([c.periodic, c.N, c.k], [true, 20, 3]);
  for (const s of [b, c]) for (let n = -8; n < 40; n++) near(s.x(n + s.N), s.x(n), 1e-9);
  near(b.omega, 0.2 * Math.PI);
  near(b.F0, 0.1);
  near(b.x(0), 3 * Math.cos(Math.PI / 5));
  assert.match(opsLesson.describe({ family: 'dt-pi', params: { m: 0.3, theta: -0.1 } }), /N=k\/F₀=3\/0\.15=20/);
  assert.match(opsLesson.describe({ family: 'dt-rad', params: { omega: 0.2 } }), /무리수/);
});

test('every example draws finite frames at initial, minimum and maximum slider values', () => {
  for (const { value } of OPS_FAMILIES) {
    const controls = opsLesson.controls(value, {});
    const sets = [(c) => c.initial, (c) => c.min, (c) => c.max].map((pick) => Object.fromEntries(controls.map((c) => [c.key, pick(c)])));
    for (const params of sets) {
      const frame = opsFrame(value, params);
      assert.ok(frame.panes.length >= 1 && frame.panes.length <= 3, value);
      for (const pane of frame.panes) {
        assert.ok(pane.x[1] > pane.x[0] && pane.y[1] > pane.y[0], `${value}: ${pane.title}`);
        for (const line of [...(pane.lines ?? []), ...(pane.stems ?? [])]) {
          for (const [x, y] of line.pts) assert.ok(Number.isFinite(x) && (Number.isFinite(y) || Number.isNaN(y)), `${value} ${x} ${y}`);
        }
      }
      assert.doesNotMatch(opsLesson.describe({ family: value, params }), /NaN|undefined|Infinity/);
    }
    assert.ok(opsLesson.read(value).length > 20 && opsLesson.read(value).length < 160, value);
  }
  assert.throws(() => opsFrame('nope', {}));
});

test('controls have the defaults of the lecture examples', () => {
  assert.deepEqual(defaults('amp'), { B: 1.5, A: -1 });
  assert.deepEqual(defaults('eo-pulse'), { c: 0.5, w: 1 });
  assert.deepEqual(defaults('dt-pi'), { m: 0.2, theta: 0.2 });
});
