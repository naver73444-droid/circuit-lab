import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-emf-homopolar.js';
import { answerItems } from '../../../src/em-course-ui.js';

const def = EXPERIMENTS[0];
const defaults = () => Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const params = (patch = {}) => ({ ...defaults(), ...patch });
const run = (patch = {}, eta = 1) => def.evaluate(params(patch), [0, 0, eta]);
const val = (out, key) => out.scalars.find(s => s.key === key)?.value;
function near(actual, expected, absolute = 1e-12, relative = 1e-11) {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    'actual=' + actual + ' expected=' + expected);
}
const nearV = (actual, expected) => near(actual, expected, 1e-12, 1e-11);
const nearE = (actual, expected) => near(actual, expected, 1e-11, 1e-11);
function invalid(out) {
  assert.equal(out.status, 'invalid');
  assert.ok(out.reason.length);
  assert.deepEqual(out.vectors, {});
  assert.deepEqual(out.scalars, []);
}
const polarity = out => out.notes.find(n => n.startsWith('극성:'));

test('emf-homopolar: one exact ID, week 7 metadata, preset matches probeDefault', () => {
  assert.equal(EXPERIMENTS.length, 1);
  assert.equal(def.id, 'emf-homopolar');
  assert.equal(def.title, '원판 발전기: 반경과 전압');
  assert.equal(def.topic, 'induction');
  assert.deepEqual(def.lecture, { week: 7, sections: ['9.1'] });
  assert.ok(def.description.startsWith('앱 검산 예시'));
  assert.deepEqual(def.answerKeys, ['voltageBA', 'voltageFull', 'motionalE']);
  assert.deepEqual(def.coordinateKeys, ['radiusRatio']);
  assert.deepEqual(def.probeDefault, [0, 0, 1]);
  assert.equal(def.view.kind, 'profile');
  assert.equal(def.view.plane, 'xz');
  assert.deepEqual(def.view.probeAxes, [0, 2]);
  assert.equal(def.view.coordinate.key, 'r/r₀');
  for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(def[key].length, key);
  assert.ok(def.references.some(r => r.title.includes('Ch.9') && r.url === 'https://openlibrary.org/isbn/9780073380667'));
  assert.deepEqual(def.parameters.map(p => [p.key, p.initial, p.min, p.max]),
    [['B', 0.5, -2, 2], ['omega', 100, -1000, 1000], ['r0', 0.1, 0.01, 0.3]]);
});

test('emf-homopolar: preset hand calculation (Bω = 50)', () => {
  const p = defaults(), before = structuredClone(p), point = [...def.probeDefault];
  const out = def.evaluate(p, point);
  assert.equal(out.status, 'valid');
  assert.deepEqual(out.vectors, {});
  assert.deepEqual(p, before);
  assert.deepEqual(point, def.probeDefault);
  for (const s of out.scalars) assert.ok(Number.isFinite(s.value) && s.unit, s.key);
  nearE(val(out, 'motionalE'), 5);                                             // 50 × 0.1
  nearV(val(out, 'voltageBA'), 0.25);                                          // 50 × 0.1² / 2
  nearV(val(out, 'voltageFull'), 0.25);
  nearV(val(out, 'voltageAB'), -0.25);                                         // ab = −ba
  near(val(out, 'radius'), 0.1, 1e-15);
  assert.ok(out.notes[0].startsWith('대입: r = η r₀') && out.notes[0].includes('5 V/m'));
  assert.ok(out.notes[1].includes('250 mV'));
  assert.ok(polarity(out).includes('b + / a −'));
  const half = run({}, 0.5);
  near(val(half, 'radius'), 0.05, 1e-15);                                      // η = 1/2 → r = 0.05 m
  nearE(val(half, 'motionalE'), 2.5);                                          // 50 × 0.05
  nearV(val(half, 'voltageBA'), 0.0625);                                       // 50 × 0.0025 / 2
  nearV(val(half, 'voltageFull'), 0.25);                                       // rim value unchanged
  assert.ok(half.notes[1].includes('62.5 mV'));
});

test('emf-homopolar: variation table', () => {
  const reversed = run({ omega: -100 });                                       // Bω = −50
  nearE(val(reversed, 'motionalE'), -5);
  nearV(val(reversed, 'voltageBA'), -0.25);
  assert.ok(polarity(reversed).includes('a + / b −'));
  const both = run({ B: -0.5, omega: -100 });                                  // Bω = +50
  nearE(val(both, 'motionalE'), 5);
  nearV(val(both, 'voltageBA'), 0.25);
  assert.ok(polarity(both).includes('b + / a −'));
  for (const [patch, eta] of [[{}, 0], [{ B: 0 }, 1], [{ omega: 0 }, 0.7]]) {  // no induction: valid zero state
    const out = run(patch, eta);
    assert.equal(out.status, 'valid');
    assert.equal(val(out, 'voltageBA'), 0);
    assert.equal(val(out, 'motionalE'), 0);
    assert.ok(polarity(out).includes('전압 0 · 극성 없음'));
  }
  for (const [omega, sign, text] of [[100, 1, 'b + / a −'], [-100, -1, 'a + / b −']]) {
    // η = 1e−6 (r = 1e−7 m): a tiny but exact product, not floating-point residue (review 4)
    // hand: E_m = 50·1e−7 = 5e−6 V/m, V_ba = 50·(1e−7)²/2 = 2.5e−13 V
    const tiny = run({ omega }, 1e-6);
    near(val(tiny, 'voltageBA'), sign * 2.5e-13, 1e-27, 1e-9);
    near(val(tiny, 'motionalE'), sign * 5e-6, 1e-20, 1e-9);
    assert.ok(polarity(tiny).includes(text), polarity(tiny));
    assert.ok(!polarity(tiny).includes('극성 없음'));
    assert.ok(!tiny.notes[0].endsWith('= 0 V/m'), tiny.notes[0]);
    assert.ok(!/Bωr²\/2 = [^=]*= 0 V /.test(tiny.notes[1]), tiny.notes[1]);
    assert.ok(tiny.scalars.every(s => s.zero === undefined), 'no "shown as 0" scale on any homopolar scalar');
    const shownV = answerItems(tiny, def).find(entry => entry.key === 'scalar:voltageBA').text;
    assert.doesNotMatch(shownV, /= ?0 V$/, shownV);
  }
  const big = run({ r0: 0.2 });                                                // 50 × 0.2 = 10, 50 × 0.04 / 2 = 1
  nearE(val(big, 'motionalE'), 10);
  nearV(val(big, 'voltageBA'), 1);
});

test('emf-homopolar: ba/ab reversal, E linear and V quadratic in the radius', () => {
  for (const patch of [{}, { B: -1.2, omega: 333, r0: 0.27 }]) {
    const k = patch.B !== undefined ? patch.B * patch.omega : 50, r0 = patch.r0 ?? 0.1;
    for (const eta of [0.1, 0.25, 0.5, 0.9]) {
      const out = run(patch, eta), r = eta * r0;
      near(val(out, 'voltageAB'), -val(out, 'voltageBA'), 0, 0);
      nearE(val(out, 'motionalE'), k * r);
      nearV(val(out, 'voltageBA'), k * r * r / 2);
      nearV(val(out, 'voltageBA') / val(out, 'voltageFull'), eta * eta);          // quadratic law
      nearE(val(out, 'motionalE') / val(run(patch, 1), 'motionalE'), eta);        // linear law
    }
  }
  const center = run({}, 0);                                                   // finite zero at the axle
  assert.equal(center.status, 'valid');
  for (const s of center.scalars) assert.ok(Number.isFinite(s.value));
});

test('emf-homopolar: invalid inputs are rejected without correction', () => {
  invalid(run({}, -0.01));
  invalid(run({}, 1.0001));
  invalid(run({}, NaN));
  invalid(run({ r0: 0 }));
  invalid(run({ r0: -0.1 }));
  invalid(run({ omega: NaN }));
  invalid(run({ B: 3 }));
  invalid(def.evaluate(params(), [0, 0]));
  assert.deepEqual(def.profile(params({ r0: 0 })), []);
  assert.equal(def.verify(params({ r0: 0 }))[0].status, 'skipped');
});

test('emf-homopolar: two finite series from axle to rim', () => {
  const list = def.profile(params());
  assert.deepEqual(list.map(s => [s.key, s.unit]), [['motionalE', 'V/m'], ['voltageBA', 'V']]);
  for (const s of list) {
    assert.equal(s.points.length, 81);
    assert.ok(s.points.every(q => Number.isFinite(q.coordinate) && Number.isFinite(q.value)));
    assert.equal(s.points[0].coordinate, 0);
    assert.equal(s.points.at(-1).coordinate, 1);
    assert.equal(s.points[0].value, 0);
  }
  nearE(list[0].points.at(-1).value, 5);
  nearV(list[1].points.at(-1).value, 0.25);
  nearV(list[1].points[40].value, 0.0625);                                     // η = 1/2 → 1/4 of the rim voltage
  assert.deepEqual(def.profile(params(), 513), []);
});

test('emf-homopolar: two verify rows at the rim', () => {
  for (const patch of [{}, { omega: -100 }, { B: -1.9, omega: 870, r0: 0.3 }, { B: 0 }]) {
    const rows = def.verify(params(patch));
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.status, 'pass', row.label + ' ' + row.actual + ' vs ' + row.expected);
      assert.ok(row.label.includes('가장자리'));
    }
  }
});

test('emf-homopolar: symbolic solution integrates from a to b and states the subscripts', () => {
  const sol = def.symbolic({});
  assert.equal(sol.status, 'supported');
  assert.equal(sol.steps.length, 4);
  assert.ok(sol.steps[0].formula.includes('rω a_φ'));
  assert.ok(sol.steps[1].formula.includes('Bωr a_r'));
  assert.ok(sol.steps[2].formula.includes('∫a→b') && sol.steps[2].formula.includes('Bωr²/2'));
  assert.ok(sol.steps[3].formula.includes('V_emf_ab = −V_emf_ba'));
  assert.deepEqual(sol.answers.map(a => a.quantity), ['브러시 전압', '가장자리 전압', '자기력']);
  assert.equal(def.symbolic({ r0: 1 }).status, 'unsupported');
});
