import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-emf-rotating.js';

const def = EXPERIMENTS[0];
const DEG = Math.PI / 180;
const defaults = () => Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const params = (patch = {}) => ({ ...defaults(), ...patch });
const run = (patch = {}, theta = Math.PI / 6) => def.evaluate(params(patch), [0, 0, theta]);
const val = (out, key) => out.scalars.find(s => s.key === key)?.value;
function near(actual, expected, absolute = 1e-12, relative = 1e-11) {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    'actual=' + actual + ' expected=' + expected);
}
function invalid(out) {
  assert.equal(out.status, 'invalid');
  assert.ok(out.reason.length);
  assert.deepEqual(out.vectors, {});
  assert.deepEqual(out.scalars, []);
}
const emfs = out => [val(out, 'transformerEmf'), val(out, 'motionalEmf'), val(out, 'emf')];

test('emf-rotating-loop: one exact ID, week 7 metadata, preset matches probeDefault', () => {
  assert.equal(EXPERIMENTS.length, 1);
  assert.equal(def.id, 'emf-rotating-loop');
  assert.equal(def.title, '회전 루프: 두 기전력');
  assert.equal(def.topic, 'induction');
  assert.deepEqual(def.lecture, { week: 7, sections: ['9.1'] });
  assert.ok(def.description.startsWith('앱 검산 예시'));
  assert.deepEqual(def.answerKeys, ['emf', 'transformerEmf', 'motionalEmf']);
  assert.deepEqual(def.coordinateKeys, ['phase']);
  assert.deepEqual(def.probeDefault, [0, 0, Math.PI / 6]);
  assert.equal(def.view.kind, 'profile');
  assert.equal(def.view.plane, 'xz');
  assert.deepEqual(def.view.probeAxes, [0, 2]);
  assert.equal(def.view.coordinate.unit, '°');
  for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(def[key].length, key);
  assert.ok(def.references.some(r => r.title.includes('Ch.9') && r.url === 'https://openlibrary.org/isbn/9780073380667'));
  assert.deepEqual(def.parameters.map(p => [p.key, p.initial, p.min, p.max]),
    [['B0', 0.5, -2, 2], ['h', 0.2, 0.02, 0.5], ['d', 0.1, 0.01, 0.3], ['omega', 100, 1, 1000], ['alpha0', 0, -Math.PI, Math.PI]]);
  near(def.parameters.find(p => p.key === 'alpha0').displayScale, Math.PI / 180);
});

test('emf-rotating-loop: preset θ = 30° hand calculation (S = 0.02 m², K = 1 V)', () => {
  const p = defaults(), before = structuredClone(p), point = [...def.probeDefault];
  const out = def.evaluate(p, point);
  assert.equal(out.status, 'valid');
  assert.deepEqual(out.vectors, {});
  assert.deepEqual(p, before);
  assert.deepEqual(point, def.probeDefault);
  for (const s of out.scalars) assert.ok(Number.isFinite(s.value) && s.unit, s.key);
  near(val(out, 'area'), 0.02, 1e-15);                                         // 0.2 × 0.1
  near(val(out, 'time'), Math.PI / 600, 1e-15);                                // t = (π/6)/100 ≈ 5.23599 ms
  near(val(out, 'flux'), Math.sqrt(3) / 400, 1e-14);                           // 0.5×0.02×(1/2)×(√3/2)
  near(val(out, 'transformerEmf'), -0.75);                                     // −1×(√3/2)²
  near(val(out, 'motionalEmf'), 0.25);                                         // +1×(1/2)²
  near(val(out, 'emf'), -0.5);                                                 // −1×cos60°
  near(val(out, 'phase'), Math.PI / 6, 1e-15);
  // axis/normal/direction text first (amendment 4), then the substitutions Φ, ℰ_T, ℰ_M, sum with units
  assert.ok(out.notes[0].startsWith('축·법선·적분 방향') && out.notes[0].includes('Ω = −ω a_x') && out.notes[0].includes('b→a'));
  assert.ok(out.notes[1].startsWith('대입: S = h d'));
  assert.ok(out.notes[2].includes('Φ =') && out.notes[2].includes('Wb'));
  assert.ok(out.notes[3].includes('ℰ_T') && out.notes[3].includes('−750 mV'));
  assert.ok(out.notes[4].includes('ℰ_M') && out.notes[4].includes('250 mV'));
  assert.ok(out.notes[5].includes('ℰ_ab') && out.notes[5].includes('−500 mV'));
  assert.ok(out.notes.some(n => n.includes('세로축 눈금을 함께 보세요')));
});

test('emf-rotating-loop: variation table', () => {
  const cases = [
    // [patch, θ, ℰ_T, ℰ_M, sum, reason]
    [{}, 0, -1, 0, -1],                                                         // −cos0
    [{}, 45 * DEG, -0.5, 0.5, 0],                                               // −cos90°
    [{}, 90 * DEG, 0, 1, 1],                                                    // −cos180°
    [{ alpha0: 30 * DEG }, 30 * DEG, -Math.sqrt(3) / 4, Math.sqrt(3) / 4, 0],   // −cos90°, cos30°cos60° = √3/4
    [{ B0: -0.5 }, 30 * DEG, 0.75, -0.25, 0.5],                                 // every term flips with B₀
  ];
  for (const [patch, theta, eT, eM, sum] of cases) {
    const [t, m, e] = emfs(run(patch, theta));
    near(t, eT); near(m, eM); near(e, sum);
  }
  for (const theta of [0, 0.7, Math.PI, 5]) {                                   // B₀ = 0: no field at any phase
    const out = run({ B0: 0 }, theta);
    assert.equal(out.status, 'valid');
    for (const v of emfs(out)) near(v, 0, 1e-15);
    assert.ok(out.notes.some(n => n.includes('합계 ℰ_ab 방향 없음')));
  }
});

test('emf-rotating-loop: sum = −K cos(2θ + α₀) for arbitrary α₀, K = ωB₀hd', () => {
  for (const [alpha0, B0, omega, h, d] of [[0.4, 0.5, 100, 0.2, 0.1], [-2.1, -1.3, 37, 0.05, 0.25], [Math.PI, 2, 1000, 0.5, 0.3]]) {
    const K = omega * B0 * h * d;
    for (const theta of [0, 0.3, 1.9, 4.4, 2 * Math.PI]) {
      const out = run({ alpha0, B0, omega, h, d }, theta);
      near(val(out, 'emf'), -K * Math.cos(2 * theta + alpha0), 1e-12 * Math.max(1, Math.abs(K)), 1e-11);
      near(val(out, 'transformerEmf') + val(out, 'motionalEmf'), val(out, 'emf'), 1e-15, 1e-14);
    }
  }
});

test('emf-rotating-loop: θ = 0 and θ = 2π give the same state (one period)', () => {
  for (const alpha0 of [0, 0.8, -1.5]) {
    const a = emfs(run({ alpha0 }, 0)), b = emfs(run({ alpha0 }, 2 * Math.PI));
    for (let i = 0; i < 3; i++) near(b[i], a[i], 1e-12);
  }
});

test('emf-rotating-loop: zero residue reads "방향 없음", a small nonzero value keeps its sign', () => {
  const zero = run({}, 45 * DEG);                                               // −cos90° = 0 (round-off only)
  assert.ok(Math.abs(val(zero, 'emf')) < 1e-12);
  assert.ok(zero.notes.some(n => n.includes('합계 ℰ_ab 방향 없음')));
  assert.ok(zero.notes[5].endsWith('= 0 V (= −K cos(2θ + α₀))'));
  const small = run({}, 44.9 * DEG);                                            // −cos89.8° ≈ −3.49 mV: real, shown with sign
  near(val(small, 'emf'), -Math.cos(89.8 * DEG));
  assert.ok(small.notes.some(n => n.includes('합계 ℰ_ab − : 양의 순환과 반대')));
});

test('emf-rotating-loop: invalid inputs are rejected without correction', () => {
  invalid(run({ omega: 0 }));
  invalid(run({ omega: -5 }));
  invalid(run({ omega: NaN }));
  invalid(run({ h: 0 }));
  invalid(run({ B0: 2.5 }));
  invalid(run({}, -0.01));
  invalid(run({}, 2 * Math.PI + 1e-9));
  invalid(run({}, NaN));
  invalid(def.evaluate(params(), [0, 0]));
  assert.deepEqual(def.profile(params({ omega: 0 })), []);
  assert.equal(def.verify(params({ omega: 0 }))[0].status, 'skipped');
});

test('emf-rotating-loop: three finite V series over one period, in the order T, M, sum', () => {
  const list = def.profile(params());
  assert.deepEqual(list.map(s => s.key), ['transformerEmf', 'motionalEmf', 'emf']);
  for (const s of list) {
    assert.equal(s.unit, 'V');
    assert.equal(s.points.length, 81);
    assert.ok(s.points.every(q => Number.isFinite(q.coordinate) && Number.isFinite(q.value)));
    near(s.points[0].coordinate, 0, 0);
    near(s.points.at(-1).coordinate, 2 * Math.PI, 1e-15);
  }
  near(list[2].points[0].value, -1);                                            // −K cos0
  near(list[2].points[40].value, -1);                                           // θ = π: −cos2π
  assert.deepEqual(def.profile(params(), 1), []);
  assert.equal(def.profile(params(), 512)[0].points.length, 512);
  // α₀ changes the curves immediately
  near(def.profile(params({ alpha0: 30 * DEG }))[2].points[0].value, -Math.cos(30 * DEG));
});

test('emf-rotating-loop: four sides — axial sides give ℰ_M/2 each, the others 0', () => {
  // the module's vector side sum is checked through verify(); here an independent rebuild of the side split at θ = 30°
  for (const alpha0 of [0, 0.6]) {
    const p = params({ alpha0 }), theta = Math.PI / 6, alpha = alpha0 + theta;
    const w = [0, -Math.sin(alpha), -Math.cos(alpha)], By = p.B0 * Math.sin(theta);
    // u = Ω×(x a_x + q w) = −ωq n; (u×B)·a_x = −ωqB_y sinα; dl along ±a_x on the axial sides, along ±w on the others
    const axial = q => -p.omega * q * By * Math.sin(alpha);
    const sideBottom = axial(-p.d / 2) * p.h, sideTop = axial(p.d / 2) * -p.h;
    const motional = val(run({ alpha0 }, theta), 'motionalEmf');
    near(sideBottom, motional / 2); near(sideTop, motional / 2);
    assert.equal(w[0], 0);                                                      // u×B ∥ a_x ⟂ w: the other two sides give 0
  }
  const rows = def.verify(params());
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.status, 'pass', row.label + ' ' + row.actual + ' vs ' + row.expected);
    assert.ok(row.label.includes('θ = 30°'));
    assert.ok(!row.label.includes('커서'));
  }
  for (const patch of [{ alpha0: 1.1 }, { B0: -1.7, omega: 900, h: 0.03, d: 0.29 }, { B0: 0 }]) {
    assert.ok(def.verify(params(patch)).every(r => r.status === 'pass'), JSON.stringify(patch));
  }
});

test('emf-rotating-loop: symbolic solution has the five steps and rejects options', () => {
  const sol = def.symbolic({});
  assert.equal(sol.status, 'supported');
  assert.equal(sol.steps.length, 5);
  assert.ok(sol.steps[0].formula.includes('n ='));
  assert.ok(sol.steps[1].formula.includes('∂B/∂t'));
  assert.ok(sol.steps[2].formula.includes('u×B') && sol.steps[2].formula.includes('Ω = −ω a_x'));
  assert.ok(sol.steps[3].formula.includes('−dΦ/dt'));
  assert.ok(sol.steps[4].formula.includes('cos2ωt'));
  assert.equal(sol.answers.length, 3);
  assert.ok(sol.laws.some(l => l.formula.includes('u×B')));
  assert.equal(def.symbolic({ alpha0: 1 }).status, 'unsupported');
});
