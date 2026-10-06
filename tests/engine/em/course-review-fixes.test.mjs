// Regression tests for the cross-review of the Hayt Ch.8 lecture experiments (magnetic circuit, hysteresis, boundary, virtual work, coax).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getExperiment } from '../../../src/em-course-registry.js';
import { MU0 } from '../../../src/em-course-constants.js';

const defaults = def => Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const run = (id, over = {}, s = undefined) => {
  const def = getExperiment(id);
  return def.evaluate({ ...defaults(def), ...over }, [0, 0, s ?? def.probeDefault[2]]);
};
const verify = (id, over = {}) => { const def = getExperiment(id); return def.verify({ ...defaults(def), ...over }); };
const val = (result, key) => result.scalars.find(item => item.key === key)?.value;
const near = (actual, expected, rel, label = '') => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected) + 1e-300, `${label} ${actual} vs ${expected}`);
const statuses = rows => rows.map(row => row.status);

// ---- 1-3 magnetic circuit -------------------------------------------------------------------------------------------------------
// NI(B) of the preset table (0,0) (200 A/m, 1 T) (300 A/m, 1.13 T), slope mu0 above, l = 0.3 pi, g = 2 mm
const presetNI = (b, gap = 2e-3) => {
  const H = b <= 1 ? b * 200 : b <= 1.13 ? 200 + (b - 1) / 0.13 * 100 : 300 + (b - 1.13) / MU0;
  return H * 0.3 * Math.PI + b * gap / MU0;
};

test('saturated fixed-point iteration converges (damped) to the bisection solution instead of oscillating (N = 500, I = 6 A)', () => {
  const result = run('mcircuit-gap-core', { mode: 1, turns: 500, current: 6 });
  assert.equal(result.status, 'valid');
  near(presetNI(val(result, 'B')), 3000, 1e-9);
  assert.ok(result.notes.some(n => /회 만에 수렴/.test(n)), 'reports convergence');
  assert.ok(!result.notes.some(n => n.includes('수렴하지 않았습니다')));
  assert.ok(result.notes.some(n => n.includes('감쇠')), 'says that damping was needed');
  assert.ok(result.notes.some(n => n.startsWith('반복 1: ') && n.includes('1.6854')), 'the first undamped lecture step is still shown');
  assert.deepEqual(statuses(verify('mcircuit-gap-core', { mode: 1, turns: 500, current: 6 })), ['pass', 'pass', 'pass']);
});

test('no air gap (g = 0), NI = 300: the plain iteration cycles between two values, the damped one converges', () => {
  const over = { mode: 1, gap: 0, turns: 300, current: 1 };
  const result = run('mcircuit-gap-core', over);
  near(presetNI(val(result, 'B'), 0), 300, 1e-9);
  assert.ok(result.notes.some(n => /회 만에 수렴/.test(n)));
  assert.deepEqual(statuses(verify('mcircuit-gap-core', over)), ['pass', 'pass', 'pass']);
});

test('the lecture preset keeps its plain iteration: 1.1236 T first, converged in 23 steps, no damping note', () => {
  const result = run('mcircuit-gap-core', { mode: 1 });
  assert.ok(result.notes.some(n => n.startsWith('반복 1:') && n.includes('1.1236')));
  assert.ok(result.notes.some(n => n.includes('23회 만에 수렴')));
  assert.ok(!result.notes.some(n => n.includes('감쇠')));
});

test('a random sweep of cores and drives: iteration, bisection and the verify rows always agree (none unconverged or failing)', () => {
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const log = (a, b) => a * (b / a) ** random(), def = getExperiment('mcircuit-gap-core');
  let valid = 0;
  for (let i = 0; i < 800; i += 1) {
    const h1 = log(1, 5000), b1 = log(0.05, 1.5), s2 = 4e-7 * Math.PI + (b1 / h1 - 4e-7 * Math.PI) * random() ** 3, h2 = h1 * (1 + log(0.01, 20));
    const params = {
      ...defaults(def), mode: random() < 0.5 ? 0 : 1, targetB: log(0.01, 1.9), coreModel: random() < 0.15 ? 1 : 0, muR: log(1, 1e5),
      h1, b1, h2, b2: b1 + s2 * (h2 - h1), gap: random() < 0.2 ? 0 : log(1e-5, 0.1), turns: Math.round(log(1, 5000)), current: random() < 0.05 ? 0 : log(1e-3, 100),
    };
    if (def.evaluate(params, def.probeDefault).status !== 'valid') continue;
    valid += 1;
    for (const row of def.verify(params)) assert.equal(row.status, 'pass', `${JSON.stringify(params)} ${row.label}`);
  }
  assert.ok(valid > 600);
});

test('I = 0: B = 0 exactly and every check row passes (no 3e-61 residue, no zero tolerance)', () => {
  const result = run('mcircuit-gap-core', { mode: 1, current: 0 });
  assert.equal(val(result, 'B'), 0);
  assert.equal(val(result, 'NI'), 0);
  assert.deepEqual(statuses(verify('mcircuit-gap-core', { mode: 1, current: 0 })), ['pass', 'pass', 'pass']);
  assert.deepEqual(statuses(verify('mcircuit-gap-core', { mode: 1, current: 0, coreModel: 1 })), ['pass', 'pass', 'pass']);
});

test('a target B above the last table point is flagged as an extrapolation (slope μ₀); inside the table it is not', () => {
  const high = run('mcircuit-gap-core', { targetB: 1.9 });
  near(val(high, 'NI'), presetNI(1.9), 1e-12);
  assert.ok(high.notes.some(n => n.includes('표 밖 외삽') && n.includes('μ₀')), 'warns about the extrapolation');
  assert.ok(!run('mcircuit-gap-core').notes.some(n => n.includes('표 밖 외삽')));
  assert.ok(run('mcircuit-gap-core', {}, 1.5).notes.some(n => n.includes('표 밖 외삽')), 'a probe above the table is flagged too');
  assert.ok(!run('mcircuit-gap-core', { coreModel: 1, targetB: 1.9 }).notes.some(n => n.includes('표 밖 외삽')), 'the linear core has no table');
  assert.ok(getExperiment('mcircuit-gap-core').assumptions.some(text => text.includes('외삽')));
});

// ---- 4 hysteresis ----------------------------------------------------------------------------------------------------------------
test('hysteresis check rows do not fail falsely: H_c > H_max, tiny / huge H_max, loop narrower than the old grid', () => {
  const cases = [{ Hc: 100, Hmax: 50 }, { Hmax: 1 }, { Hmax: 1e6 }, { Hc: 1, Hmax: 1e5 }, { Hc: 1e5, Hmax: 1 }, { Hc: 1e5, Hmax: 1e6 }, { Bs: 3, Br: 2.9, Hc: 1, Hmax: 1000 }];
  for (const over of cases) {
    const rows = verify('mcircuit-hysteresis', over);
    assert.equal(rows.length, 3, JSON.stringify(over));
    for (const row of rows) assert.equal(row.status, 'pass', `${JSON.stringify(over)} ${row.label} ${row.actual} vs ${row.expected}`);
  }
});

test('hysteresis check rows over random B_s, B_r, H_c, H_max never fail', () => {
  let seed = 777;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const log = (a, b) => a * (b / a) ** random(), def = getExperiment('mcircuit-hysteresis');
  let valid = 0;
  for (let i = 0; i < 400; i += 1) {
    const Bs = log(0.1, 3), Br = Math.max(0.01, Math.min(2.9, Bs * (random() < 0.3 ? 1 - log(1e-9, 0.5) : random())));
    const params = { ...defaults(def), Bs, Br, Hc: log(1, 1e5), Hmax: log(1, 1e6) };
    if (def.evaluate(params, def.probeDefault).status !== 'valid') continue;
    valid += 1;
    for (const row of def.verify(params)) assert.notEqual(row.status, 'fail', `${JSON.stringify(params)} ${row.label}`);
  }
  assert.ok(valid > 300);
});

// ---- 5 boundary with B1 = 0 ------------------------------------------------------------------------------------------------------
test('boundary: B₁ = 0 and K = 0 leaves θ₂ undefined (no θ₂ or tanθ₂/tanθ₁ value) and the refraction check is skipped, not failed', () => {
  const result = run('matter-boundary', { B1: 0 }, 0.5);
  assert.equal(result.status, 'valid');
  assert.equal(val(result, 'theta2'), undefined);
  assert.equal(val(result, 'tanRatio'), undefined);
  assert.ok(result.notes.some(n => n.includes('정의되지 않습니다')));
  const rows = verify('matter-boundary', { B1: 0 });
  assert.equal(rows[0].status, 'skipped');
  assert.deepEqual(statuses(rows.slice(1)), ['pass', 'pass']);
  const def = getExperiment('matter-boundary');
  assert.ok(!def.profile({ ...defaults(def), B1: 0 }, 9).some(item => item.key === 'theta2'), 'no θ₂ curve is drawn');
});

test('boundary: B₁ = 0 with a surface current has a defined direction (θ₂ = 90°) but no tangent ratio; B₁ > 0 is unchanged', () => {
  const result = run('matter-boundary', { B1: 0, K: 5 }, 0.5);
  near(val(result, 'theta2'), 90, 1e-12);
  assert.equal(val(result, 'tanRatio'), undefined);
  const normal = run('matter-boundary', {}, 0.5);
  near(val(normal, 'tanRatio'), 1e4, 1e-12);
  assert.deepEqual(statuses(verify('matter-boundary')), ['pass', 'pass', 'pass']);
});

// ---- 6 virtual work --------------------------------------------------------------------------------------------------------------
test('virtual displacement: the energy balance approaches F·dx as dx → 0 (central difference), also for a finite dx', () => {
  const ratio = (over, x = 2e-3) => {
    const result = run('induct-virtual-gap', over, x);
    return val(result, 'mechanical') / val(result, 'Fdx');
  };
  assert.ok(Math.abs(ratio({ dx: 1e-3 }) - 1) < 0.1, `dx = 1 mm: ${ratio({ dx: 1e-3 })}`); // was 0.69 with the one-sided step
  assert.ok(Math.abs(ratio({ dx: 1e-4 }) - 1) < 2e-3);
  assert.ok(Math.abs(ratio({ dx: 1e-6 }) - 1) < 1e-6);
  for (const dx of [1e-6, 1e-4, 1e-3]) near(ratio({ dx, constraint: 1 }), 1, 1e-9, 'constant flux is exact');
  assert.ok(run('induct-virtual-gap', { dx: 1e-3 }).notes.some(n => n.includes('dx → 0')), 'the note explains finite dx');
  // near x = 0 the window is moved to [0, dx] and the note says so
  assert.ok(run('induct-virtual-gap', { dx: 1e-3 }, 0).notes.some(n => n.includes('x < dx/2')));
});

// ---- 7 coax ----------------------------------------------------------------------------------------------------------------------
test('coax: H (not B) is continuous at r = a when μ_r ≠ 1; B jumps by μ_r; the check rows say so', () => {
  const def = getExperiment('induct-coax');
  assert.ok(def.singularities.some(text => text.includes('H') && text.includes('불연속')));
  assert.ok(!def.singularities.some(text => text.includes('r = a는 연속')));
  const over = { muRg: 4 }, a = 0.01, I = 10;
  const inside = run('induct-coax', over, a * (1 - 1e-9)), outside = run('induct-coax', over, a);
  near(val(outside, 'Bphi') / val(inside, 'Bphi'), 4, 1e-6);
  const rows = verify('induct-coax', over);
  assert.ok(rows.some(row => row.label.includes('H 연속')));
  for (const row of rows) assert.equal(row.status, 'pass', row.label);
  near(I / (2 * Math.PI * a), val(outside, 'Bphi') / (MU0 * 4), 1e-12);
});
