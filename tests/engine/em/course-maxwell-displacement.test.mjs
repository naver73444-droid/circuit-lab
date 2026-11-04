import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-maxwell-displacement.js';

const e = EXPERIMENTS[0];
const defaults = () => Object.fromEntries(e.parameters.map(p => [p.key, p.initial]));
const params = (patch = {}) => ({ ...defaults(), ...patch });
const run = (patch = {}, s = 1) => e.evaluate(params(patch), [0, 0, s]);
const val = (out, key) => out.scalars.find(s => s.key === key)?.value;
function near(actual, expected, absolute, relative = 1e-11) {
  assert.ok(Number.isFinite(actual), 'not finite: ' + actual);
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), 'actual=' + actual + ' expected=' + expected);
}
// Tolerances from the spec: C 1e-20 F, I 1e-14 A, J_d 1e-12 A/m², H 1e-12 A/m, all relTol 1e-11.
const TOL = { C: 1e-20, I: 1e-14, J: 1e-12, H: 1e-12 };
const deg = x => x * Math.PI / 180;

// Independent hand formulas (not the module): ε₀ CODATA 2022, A = πa², ω = 2πf.
const EPS0 = 8.8541878188e-12;
function hand({ a = 0.05, d = 0.001, epsilonR = 1, voltagePeak = 100, frequency = 1000, phase = 0 } = {}, s = 1) {
  const eps = EPS0 * epsilonR, w = 2 * Math.PI * frequency, A = Math.PI * a * a, C = eps * A / d;
  const I = w * C * voltagePeak * Math.cos(phase), J = eps * w * voltagePeak * Math.cos(phase) / d, rho = s * a;
  const enc = J * Math.PI * Math.min(rho, a) ** 2;
  return { C, I, J, enc, H: rho === 0 ? 0 : enc / (2 * Math.PI * rho), V: voltagePeak * Math.sin(phase) };
}

test('metadata: id, Ch.9 week 7, answers order, sweep coordinate, parameter table', () => {
  assert.equal(EXPERIMENTS.length, 1);
  assert.equal(e.id, 'maxwell-displacement');
  assert.equal(e.title, '커패시터: 변위전류');
  assert.equal(e.topic, 'maxwell');
  assert.deepEqual(e.lecture, { week: 7, sections: ['9.2', '9.3', '9.4'] });
  assert.deepEqual(e.answerKeys, ['enclosedDisplacementCurrent', 'Hphi', 'freeCurrent', 'totalDisplacementCurrent']); // 보충 2
  assert.deepEqual(e.coordinateKeys, ['radiusRatio']);
  assert.deepEqual(e.probeDefault, [0, 0, 1]);
  assert.equal(e.view.kind, 'profile');
  assert.equal(e.view.plane, 'xz');
  assert.deepEqual(e.view.probeAxes, [0, 2]);
  assert.deepEqual(e.view.coordinate, { key: 'ρ/a', unit: '1', label: '경로 반경 비', scale: 1 });
  assert.ok(e.description.startsWith('앱 검산 예시'));
  const table = { a: [0.05, 0.01, 0.1], d: [0.001, 0.0001, 0.002], epsilonR: [1, 1, 10], voltagePeak: [100, 1, 200],
    frequency: [1000, 10, 10000], phase: [0, -Math.PI, Math.PI] };
  assert.deepEqual(e.parameters.map(p => p.key), Object.keys(table));
  for (const p of e.parameters) assert.deepEqual([p.initial, p.min, p.max], table[p.key], p.key);
  assert.equal(e.parameters.find(p => p.key === 'phase').displayScale, Math.PI / 180);
  for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(e[key].length, key);
  assert.ok(e.references.some(r => r.title.includes('Ch.9 §9.2') && r.url === 'https://openlibrary.org/isbn/9780073380667'));
  assert.ok(e.references.every(r => !r.title.includes('Ch.8') && !r.url.includes('.notes')));
});

test('default preset: hand calculation (φ = 0, s = 1)', () => {
  const p = params(), before = structuredClone(p), point = [0, 0, 1];
  const out = e.evaluate(p, point);
  assert.equal(out.status, 'valid');
  assert.deepEqual(p, before);
  assert.deepEqual(point, [0, 0, 1]);
  assert.deepEqual(out.vectors, {});
  for (const s of out.scalars) assert.ok(Number.isFinite(s.value) && s.unit, s.key);
  // C = ε₀·π·0.05²/0.001 = 7.853981634 ε₀
  const C = EPS0 * Math.PI * 0.0025 / 0.001;
  near(val(out, 'capacitance'), C, TOL.C);
  near(val(out, 'capacitance'), 69.54063e-12, 0, 1e-5);
  // J_d = ε₀·(2000π·100)/0.001
  const J = EPS0 * 200000 * Math.PI / 0.001;
  near(val(out, 'Jd'), J, TOL.J);
  near(val(out, 'Jd'), 0.005563250, 0, 1e-5);
  // I_f = I_d,total = ωCV_m = 2000π·C·100
  const I = 2000 * Math.PI * C * 100;
  for (const key of ['freeCurrent', 'totalDisplacementCurrent', 'enclosedDisplacementCurrent']) near(val(out, key), I, TOL.I);
  near(val(out, 'freeCurrent'), 43.69367e-6, 0, 1e-5);
  // H_φ(a) = I/(2π·0.05)
  near(val(out, 'Hphi'), I / (2 * Math.PI * 0.05), TOL.H);
  near(val(out, 'Hphi'), 1.390813e-4, 0, 1e-5);
  // V = Q = D = 0 at φ = 0, finite and valid
  assert.equal(val(out, 'voltage'), 0);
  assert.equal(val(out, 'charge'), 0);
  assert.equal(val(out, 'D'), 0);
  near(val(out, 'radius'), 0.05, 1e-15);
  assert.equal(val(out, 'radiusRatio'), 1);
});

test('variant table', () => {
  const total = hand().I;
  // s = 1/2: enclosed = I/4, H = J_d a/4; totals unchanged
  let out = run({}, 0.5);
  near(val(out, 'enclosedDisplacementCurrent'), total / 4, TOL.I);
  near(val(out, 'enclosedDisplacementCurrent'), 10.92342e-6, 0, 1e-5);
  near(val(out, 'Hphi'), hand().J * 0.05 / 4, TOL.H);
  near(val(out, 'Hphi'), 6.954063e-5, 0, 1e-5);
  near(val(out, 'freeCurrent'), total, TOL.I);
  near(val(out, 'totalDisplacementCurrent'), total, TOL.I);
  // s = 2: enclosed = I, H = I/(4πa)
  out = run({}, 2);
  near(val(out, 'enclosedDisplacementCurrent'), total, TOL.I);
  near(val(out, 'Hphi'), total / (4 * Math.PI * 0.05), TOL.H);
  near(val(out, 'Hphi'), 6.954063e-5, 0, 1e-5);
  // s = 0: enclosed = H = 0, totals kept
  out = run({}, 0);
  assert.equal(out.status, 'valid');
  assert.equal(val(out, 'enclosedDisplacementCurrent'), 0);
  assert.equal(val(out, 'Hphi'), 0);
  near(val(out, 'freeCurrent'), total, TOL.I);
  // φ = 90°: V = 100 V, currents zero within absolute tolerance
  out = run({ phase: deg(90) });
  near(val(out, 'voltage'), 100, 1e-12);
  for (const [key, tol] of [['freeCurrent', TOL.I], ['totalDisplacementCurrent', TOL.I], ['enclosedDisplacementCurrent', TOL.I], ['Jd', TOL.J], ['Hphi', TOL.H]])
    near(val(out, key), 0, tol);
  // φ = 180°: total I and H(a) reverse
  out = run({ phase: Math.PI });
  near(val(out, 'freeCurrent'), -total, TOL.I);
  near(val(out, 'freeCurrent'), -43.69367e-6, 0, 1e-5);
  near(val(out, 'Hphi'), -1.390813e-4, 0, 1e-5);
  // ε_r = 2 doubles C, J_d, I, H
  const base = run(), twice = run({ epsilonR: 2 });
  for (const [key, tol] of [['capacitance', TOL.C], ['Jd', TOL.J], ['freeCurrent', TOL.I], ['Hphi', TOL.H]]) near(val(twice, key), 2 * val(base, key), tol);
  // d = 2 mm halves them (d/a = 0.04 valid)
  const wide = run({ d: 0.002 });
  assert.equal(wide.status, 'valid');
  for (const [key, tol] of [['capacitance', TOL.C], ['Jd', TOL.J], ['freeCurrent', TOL.I], ['Hphi', TOL.H]]) near(val(wide, key), val(base, key) / 2, tol);
});

test('arbitrary inputs match the hand formulas; total I_d = I_f; s = 0.5 separates total and enclosed', () => {
  const cases = [{ a: 0.08, d: 0.0005, epsilonR: 4.5, voltagePeak: 37, frequency: 250, phase: 0.7 },
    { a: 0.013, d: 0.0011, epsilonR: 9, voltagePeak: 200, frequency: 9000, phase: -2.4 }];
  for (const c of cases) for (const s of [0, 0.3, 0.5, 1, 1.7, 3]) {
    const out = run(c, s), h = hand(c, s);
    assert.equal(out.status, 'valid');
    near(val(out, 'capacitance'), h.C, TOL.C);
    near(val(out, 'Jd'), h.J, TOL.J);
    near(val(out, 'freeCurrent'), h.I, TOL.I);
    near(val(out, 'totalDisplacementCurrent'), val(out, 'freeCurrent'), TOL.I);
    near(val(out, 'enclosedDisplacementCurrent'), h.enc, TOL.I);
    near(val(out, 'Hphi'), h.H, TOL.H);
    near(val(out, 'voltage'), h.V, 1e-12);
  }
  const out = run({}, 0.5);
  assert.ok(Math.abs(val(out, 'enclosedDisplacementCurrent') - val(out, 'freeCurrent')) > 0.5 * Math.abs(val(out, 'freeCurrent')));
});

test('ρ = a is continuous from both sides; the axis is a finite zero', () => {
  const at = val(run({}, 1), 'Hphi'), inner = val(run({}, 1 - 1e-12), 'Hphi'), outer = val(run({}, 1 + 1e-12), 'Hphi');
  near(inner, at, TOL.H, 1e-9);
  near(outer, at, TOL.H, 1e-9);
  near(val(run({}, 1 - 1e-12), 'enclosedDisplacementCurrent'), val(run({}, 1), 'enclosedDisplacementCurrent'), TOL.I, 1e-9);
  const axis = run({}, 0);
  assert.equal(axis.status, 'valid');
  assert.equal(val(axis, 'Hphi'), 0);
  assert.ok(axis.scalars.every(s => Number.isFinite(s.value)));
  assert.ok(axis.notes.some(n => n.includes('ρ = 0') && n.includes('방향 없음')));
});

test('direction text: +z/반시계, −z/시계, and "방향 없음" for zero residues (보충 1)', () => {
  assert.ok(run().notes.some(n => n.includes('+z 변위전류') && n.includes('반시계 H')));
  assert.ok(run({ phase: Math.PI }).notes.some(n => n.includes('−z 변위전류') && n.includes('시계 H')));
  for (const phase of [Math.PI / 2, -Math.PI / 2]) {
    const out = run({ phase });
    assert.notEqual(val(out, 'freeCurrent'), undefined); // raw value is not rounded
    assert.ok(out.notes.some(n => n.includes('방향 없음')));
    assert.ok(!out.notes.some(n => n.includes('+z 변위전류') || n.includes('−z 변위전류')));
    assert.ok(out.notes.some(n => n.startsWith('전체 I_f') && n.includes('= 0 A')), out.notes.join('\n'));
  }
  // φ = 89.9°: a small but real current keeps its sign and direction
  const out = run({ phase: deg(89.9) });
  assert.ok(val(out, 'freeCurrent') > 0);
  near(val(out, 'freeCurrent'), hand({ phase: deg(89.9) }).I, TOL.I);
  assert.ok(out.notes.some(n => n.includes('+z 변위전류')));
  assert.ok(!out.notes.some(n => n.startsWith('전체 I_f') && n.includes('= 0 A')));
  assert.ok(run({ phase: -deg(89.9) }).notes.some(n => n.includes('+z 변위전류')));
  assert.ok(run({ phase: deg(90.1) }).notes.some(n => n.includes('−z 변위전류')));
});

test('direction text on the axis (ρ = 0): H is 0, so no circulation is named (review 2)', () => {
  for (const [phase, sense] of [[0, '+z'], [Math.PI, '−z']]) {
    const axis = run({ phase }, 0), line = axis.notes.find(n => n.startsWith('방향:'));
    assert.ok(val(axis, 'Hphi') === 0, 'H(0) = 0 (±0)');
    assert.ok(line.startsWith(`방향: ${sense} 변위전류 · H 0(방향 없음)`), line);
    assert.ok(!line.includes('반시계') && !line.includes('시계 H'), line);
  }
  // off the axis the circulation is named again: J_d > 0 → counter-clockwise seen from +z
  assert.ok(run({}, 0.01).notes.find(n => n.startsWith('방향:')).startsWith('방향: +z 변위전류 · +z에서 보아 반시계 H'));
});

test('sign reference: V = V_bottom − V_top, Q on the bottom plate, so V > 0 means D along +z (review 3)', () => {
  const first = run().notes[0];
  for (const piece of ['V = V_아래 − V_위', 'Q = 아래 극판 전하', 'I_f = 아래 극판으로 들어가는 도선 전류', '+z(아래 극판 → 위 극판)']) assert.ok(first.includes(piece), piece);
  assert.ok(e.symbolic({}).conditions[0].includes('V = V_아래 − V_위') && e.symbolic({}).conditions[0].includes('Q = 아래 극판 전하'));
  // hand: ωt = 30° → V = 100·sin30° = 50 V > 0, D = ε₀·50/0.001 = 4.4271e-7 C/m² (+z), Q = C·50 > 0;
  // dV/dt ∝ cos30° > 0 → J_d = ε₀·2000π·100·cos30°/0.001 > 0 and I_f > 0 (+z, into the bottom plate)
  const out = run({ phase: deg(30) });
  near(val(out, 'voltage'), 50, 1e-12);
  near(val(out, 'D'), EPS0 * 50 / 0.001, 1e-20);
  near(val(out, 'charge'), EPS0 * Math.PI * 0.0025 / 0.001 * 50, 1e-20);
  near(val(out, 'Jd'), EPS0 * 2000 * Math.PI * 100 * Math.cos(deg(30)) / 0.001, TOL.J);
  assert.ok(val(out, 'freeCurrent') > 0 && val(out, 'Jd') > 0);
  // ωt = −150°: V = −50 V (top plate higher), D along −z, and dV/dt ∝ cos(−150°) < 0 → J_d, I_f along −z
  const back = run({ phase: deg(-150) });
  near(val(back, 'voltage'), -50, 1e-12);
  assert.ok(val(back, 'D') < 0 && val(back, 'charge') < 0 && val(back, 'Jd') < 0 && val(back, 'freeCurrent') < 0);
});

test('profile at ωt = ±90°: both curves are flat exact zeros, the same 0 rule as the answer (review 1)', () => {
  for (const phase of [deg(90), -deg(90), Math.PI / 2]) {
    const series = e.profile(params({ phase }));
    assert.equal(series.length, 2, 'still two series (drawn flat, not dropped)');
    for (const s of series) {
      assert.equal(s.points.length, 81);
      for (const p of s.points) assert.equal(p.value, 0, `${s.key} at ρ/a = ${p.coordinate}`);
    }
  }
  // φ = 89.9°: a real current, not residue — hand: H(0.75a) = J_d·0.75a/2 with J_d = ε₀·2000π·100·cos89.9°/0.001
  const small = e.profile(params({ phase: deg(89.9) }));
  const Jd = EPS0 * 2000 * Math.PI * 100 * Math.cos(deg(89.9)) / 0.001;
  const inner = small[0].points[20];                                           // ρ/a = 3·20/80 = 0.75
  assert.equal(inner.coordinate, 0.75);
  near(inner.value, Jd * 0.05 * 0.75 / 2, 1e-18);
  assert.ok(inner.value > 0);
  near(small[1].points.at(-1).value, Jd * Math.PI * 0.0025, 1e-20);
});

test('notes: geometry first, surface choice by radius, substituted numbers', () => {
  const edge = run();
  assert.ok(edge.notes[0].includes('+z') && edge.notes[0].includes('반시계') && edge.notes[0].includes('법선'));
  assert.ok(edge.notes[1].includes('도선이 뚫고 지나는 면') && edge.notes[1].includes('극판 사이를 지나는 면') && edge.notes[1].includes('2I로 만들지 않습니다'));
  assert.ok(run({}, 2).notes[1].includes('ρ ≥ a'));
  const inside = run({}, 0.5);
  assert.ok(inside.notes[1].includes('ρ < a') && inside.notes[1].includes('ρ²/a²'));
  const text = edge.notes.join('\n');
  for (const piece of ['69.54 pF', '5.563 mA/m²', '43.69 µA', '139.1 µA/m']) assert.ok(text.includes(piece), piece + '\n' + text);
  assert.ok(run({ phase: deg(90) }).notes.some(n => n.includes('V = 100 V')));
});

test('invalid inputs are rejected with a reason and never corrected', () => {
  const bad = [[{ d: 0 }, 1], [{ d: -0.001 }, 1], [{ a: 0.01, d: 0.002 }, 1], [{ a: 0.01, d: 0.0011 }, 1], [{}, -0.01], [{}, 3.01],
    [{ a: NaN }, 1], [{ frequency: Infinity }, 1], [{}, NaN], [{ phase: 4 }, 1]];
  for (const [patch, s] of bad) {
    const p = params(patch), before = structuredClone(p), out = e.evaluate(p, [0, 0, s]);
    assert.equal(out.status, 'invalid', JSON.stringify(patch) + ' s=' + s);
    assert.ok(out.reason.length);
    assert.deepEqual(out.scalars, []);
    assert.deepEqual(out.vectors, {});
    assert.deepEqual(p, before);
  }
  assert.match(run({ a: 0.01, d: 0.002 }).reason, /d\/a/);
  assert.equal(run({ a: 0.01, d: 0.001 }).status, 'valid'); // d/a = 0.1 boundary is allowed
  assert.equal(run({}, 3).status, 'valid');
  assert.deepEqual(e.profile(params({ a: 0.01, d: 0.002 })), []);
  assert.equal(e.verify(params({ d: 0 }))[0].status, 'skipped');
});

test('profile: two finite series sharing ρ/a 0…3, linear inside, 1/ρ outside, saturating current', () => {
  const series = e.profile(params());
  assert.deepEqual(series.map(s => s.key), ['Hphi', 'enclosedDisplacementCurrent']);
  assert.deepEqual(series.map(s => s.unit), ['A/m', 'A']);
  const h = hand();
  for (const s of series) {
    assert.equal(s.coordinateKey, 'ρ/a');
    assert.equal(s.coordinateUnit, '1');
    assert.equal(s.points.length, 81);
    assert.equal(s.points[0].coordinate, 0);
    assert.equal(s.points.at(-1).coordinate, 3);
    assert.ok(s.points.every(p => Number.isFinite(p.coordinate) && Number.isFinite(p.value)));
  }
  for (const { coordinate: s, value } of series[0].points) near(value, s <= 1 ? h.J * 0.05 * s / 2 : h.J * 0.05 / (2 * s), TOL.H);
  for (const { coordinate: s, value } of series[1].points) near(value, s <= 1 ? h.I * s * s : h.I, TOL.I);
  assert.equal(e.profile(params(), 2)[0].points.length, 2);
  assert.equal(e.profile(params(), 512)[0].points.length, 512);
  assert.deepEqual(e.profile(params(), 1), []);
  assert.deepEqual(e.profile(params(), 513), []);
});

test('verify: three independent rows pass at several phases and name the radius', () => {
  for (const patch of [{}, { phase: deg(90) }, { phase: 2.1 }, { a: 0.02, d: 0.0003, epsilonR: 7, frequency: 37 }]) {
    const rows = e.verify(params(patch));
    assert.equal(rows.length, 3);
    for (const r of rows) {
      assert.equal(r.status, 'pass', JSON.stringify(r));
      assert.equal(r.unit, 'A');
      for (const key of ['actual', 'expected', 'absTolerance', 'relTolerance']) assert.ok(Number.isFinite(r[key]));
    }
    assert.match(rows[1].label, /ρ = a/);
    assert.match(rows[2].label, /ρ = a\/2/);
  }
});

test('symbolic: five steps, the four point equations, J_d unit', () => {
  const sym = e.symbolic({});
  assert.equal(sym.status, 'supported');
  assert.equal(sym.steps.length, 5);
  const laws = sym.laws.map(l => l.formula);
  for (const eq of ['∇·D = ρ_f', '∇·B = 0', '∇×E = −∂B/∂t', '∇×H = J_f + ∂D/∂t']) assert.ok(laws.includes(eq), eq);
  assert.ok(laws.at(-1).includes('J = σE') && laws.at(-1).includes('σ = 0'));
  assert.ok(sym.steps[1].explanation.includes('C/(m²·s) = A/m²'));
  assert.ok(e.formulas.some(f => f.unit.includes('C/(m²·s)')));
  assert.ok(sym.steps[0].formula.includes('∂ρ_f/∂t'));
  assert.equal(sym.answers.length, 4);
  assert.equal(e.symbolic({ x: 1 }).status, 'unsupported');
});
