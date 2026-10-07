// Hayt Ch.8 §8.8: the parallel (three-legged) magnetic circuit. Closed forms and limits are written out here with electrical-circuit arithmetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getExperiment } from '../../../src/em-course-registry.js';
import { solveLegs } from '../../../src/em-course-magnetic-parallel.js';
import { topicOf } from '../../../src/em-course-params.js';
import { MU0 } from '../../../src/em-course-constants.js';

const def = getExperiment('mcircuit-parallel');
const defaults = Object.fromEntries(def.parameters.map(p => [p.key, p.initial]));
const run = (over = {}, probe = def.probeDefault[2]) => def.evaluate({ ...defaults, ...over }, [0, 0, probe]);
const val = (result, key) => result.scalars.find(item => item.key === key).value;
const near = (actual, expected, rel, label = '') => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected) + 1e-300, `${label} ${actual} vs ${expected}`);
const statuses = rows => rows.map(row => row.status);

// The same circuit as a hand calculation: R = ℓ/(μS), series inside a leg, parallel between the outer legs, current divider for the flux.
function byHand(p) {
  const mu = MU0 * p.muR, ni = p.turns * p.current;
  const rc = p.lengthC / (mu * p.areaC);
  const rl = p.lengthL / (mu * p.areaL) + p.gapL / (MU0 * p.areaL), rr = p.lengthR / (mu * p.areaR) + p.gapR / (MU0 * p.areaR);
  const r = rc + rl * rr / (rl + rr), flux = ni / r;
  return { rc, rl, rr, r, flux, fluxL: flux * rr / (rl + rr), fluxR: flux * rl / (rl + rr) };
}

test('registered in the 자기회로 group as a Hayt 8.8 lecture experiment; answers are Φ, Φ_L, Φ_R and the sweep coordinate is the right gap', () => {
  assert.ok(def && topicOf(def.id) === '자기회로');
  assert.deepEqual(def.lecture, { week: 6, sections: ['8.8'] });
  assert.deepEqual(def.answerKeys, ['flux', 'fluxL', 'fluxR']);
  assert.deepEqual(def.coordinateKeys, ['probeGap']);
  assert.equal(def.view.coordinate.key, 'g₂');
  assert.ok(def.assumptions.some(a => a.includes('앱이 계산한 값')), 'the example numbers are labelled as the app\'s own');
  assert.ok(def.symbolic({}).steps.length >= 4 && def.symbolic({}).status === 'supported');
});

test('symmetric default (g₁ = g₂ = 1 mm): hand numbers R = 1.5915×10⁶ A·turn/Wb, Φ = 6.2832×10⁻⁵ Wb split evenly, B = 0.10472 T in every leg', () => {
  const result = run();
  assert.equal(result.status, 'valid'); assert.equal(result.region, 'symmetric');
  near(val(result, 'NI'), 100, 1e-12);
  near(val(result, 'Rtotal'), 1.59155e6, 1e-5, 'R'); near(val(result, 'flux'), 6.2832e-5, 1e-4, 'Φ');
  near(val(result, 'fluxL'), 3.1416e-5, 1e-4, 'Φ_L'); near(val(result, 'fluxR'), 3.1416e-5, 1e-4, 'Φ_R');
  assert.equal(val(result, 'fluxL'), val(result, 'fluxR'), 'a symmetric core splits the flux exactly in half');
  near(val(result, 'Bc'), 0.10472, 1e-4, 'B_c'); near(val(result, 'BL'), 0.10472, 1e-4, 'B_L'); near(val(result, 'BR'), 0.10472, 1e-4, 'B_R');
  near(val(result, 'RL'), 3.05047e6, 1e-5); near(val(result, 'Rc'), 66314.6, 1e-5); near(val(result, 'shareL'), 0.5, 1e-12);
});

test('one-sided gap (g₁ = 0, g₂ = 2 mm): Φ = 2.2818×10⁻⁴ Wb, almost all of it (93.5 %) through the gapless left leg, Φ_R = 1.4881×10⁻⁵ Wb', () => {
  const result = run({ gapL: 0, gapR: 2e-3 });
  assert.equal(result.region, 'asymmetric');
  near(val(result, 'flux'), 2.2818e-4, 2e-4, 'Φ'); near(val(result, 'fluxL'), 2.1330e-4, 2e-4, 'Φ_L'); near(val(result, 'fluxR'), 1.4881e-5, 2e-4, 'Φ_R');
  near(val(result, 'shareL'), 0.93478, 1e-4, 'share');
  near(val(result, 'fluxL') / val(result, 'fluxR'), val(result, 'RR') / val(result, 'RL'), 1e-12, 'Φ_L/Φ_R = R_R/R_L');
  assert.ok(val(result, 'BL') > val(result, 'BR'));
  assert.ok(result.notes.some(n => n.includes('Φ_L ≠ Φ_R')));
  const worked = def.assumptions.join(' ');
  assert.ok(worked.includes('g₁ = 0, g₂ = 2 mm') && worked.includes('비대칭') && worked.includes('앱이 계산한 값'), 'the asymmetric case is documented as the app\'s own numbers');
});

test('the closed form equals the hand arithmetic for random leg sizes, gaps, μ_r and mirrors when the two outer legs are swapped', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647, log = (a, b) => a * (b / a) ** random();
  for (let i = 0; i < 200; i++) {
    const p = { ...defaults, turns: Math.ceil(log(1, 2000)), current: log(0.01, 10), muR: log(50, 5e4), areaC: log(1e-5, 1e-2), areaL: log(1e-5, 1e-2), areaR: log(1e-5, 1e-2),
      lengthC: log(0.02, 1), lengthL: log(0.02, 1), lengthR: log(0.02, 1), gapL: random() < 0.2 ? 0 : log(1e-5, 0.02), gapR: random() < 0.2 ? 0 : log(1e-5, 0.02) };
    const s = solveLegs(p), h = byHand(p);
    near(s.rTotal, h.r, 1e-12); near(s.flux, h.flux, 1e-12); near(s.fluxL, h.fluxL, 1e-12); near(s.fluxR, h.fluxR, 1e-12);
    near(s.fluxL + s.fluxR, s.flux, 1e-12, 'KCL');
    near(s.rC * s.flux + s.rL * s.fluxL, s.ni, 1e-11, 'left loop'); near(s.rC * s.flux + s.rR * s.fluxR, s.ni, 1e-11, 'right loop');
    const mirror = solveLegs({ ...p, areaL: p.areaR, areaR: p.areaL, lengthL: p.lengthR, lengthR: p.lengthL, gapL: p.gapR, gapR: p.gapL });
    near(mirror.flux, s.flux, 1e-12); near(mirror.fluxL, s.fluxR, 1e-12); near(mirror.fluxR, s.fluxL, 1e-12);
  }
});

test('limits: g₂ → ∞ leaves no flux in the right leg and reduces the circuit to the series gapped core R_c + R_L; both gaps zero and a very high μ_r', () => {
  const open = solveLegs({ ...defaults, gapR: Infinity });
  assert.equal(open.fluxR, 0); assert.equal(open.bR, 0);
  near(open.flux, open.ni / (open.rC + open.rL), 1e-14, 'Φ = NI/(R_c + R_L)'); near(open.fluxL, open.flux, 1e-14, 'all the flux goes through the left leg');
  const huge = solveLegs({ ...defaults, gapR: 1e12 });
  assert.ok(huge.fluxR / huge.flux < 1e-12); near(huge.flux, open.flux, 1e-9);
  // the experiment's allowed maximum (50 mm) already pushes most of the flux to the other leg
  const wide = run({ gapR: 0.05 });
  assert.ok(val(wide, 'fluxR') < 0.03 * val(wide, 'flux'), 'Φ_R is a few percent of Φ at g₂ = 50 mm');
  // no gaps, equal legs: the outer legs share, the circuit is the centre leg + half of an outer leg
  const closed = solveLegs({ ...defaults, gapL: 0, gapR: 0 });
  near(closed.rParallel, closed.rL / 2, 1e-14); near(closed.fluxL, closed.flux / 2, 1e-14);
  // μ_r → large: the reluctances of the core vanish and only the gaps decide: Φ_L/Φ_R → g₂ S_L/(g₁ S_R) inverse (R_R/R_L = g₂/g₁ for equal S)
  const iron = solveLegs({ ...defaults, muR: 1e9, gapL: 1e-3, gapR: 3e-3 });
  near(iron.fluxL / iron.fluxR, 3, 1e-5, 'Φ_L/Φ_R = g₂/g₁');
});

test('sweeping g₂: Φ_R falls, Φ_L rises, Φ falls, Φ_L + Φ_R = Φ at every point (flux crowds into the other leg)', () => {
  const curves = Object.fromEntries(def.profile(defaults, 81).map(item => [item.key, item]));
  assert.deepEqual(Object.keys(curves), ['flux', 'fluxL', 'fluxR']);
  for (const item of Object.values(curves)) { assert.equal(item.points.length, 81); assert.equal(item.coordinateKey, 'g₂'); assert.equal(item.unit, 'Wb'); }
  const at = (key, i) => curves[key].points[i].value;
  assert.equal(curves.flux.points[0].coordinate, 0);
  for (let i = 1; i < 81; i++) {
    assert.ok(at('fluxR', i) < at('fluxR', i - 1), 'Φ_R decreases'); assert.ok(at('fluxL', i) > at('fluxL', i - 1), 'Φ_L increases'); assert.ok(at('flux', i) < at('flux', i - 1), 'Φ decreases');
    near(at('fluxL', i) + at('fluxR', i), at('flux', i), 1e-12, 'sum');
  }
  // the probe value is the sweep point: the curve at g₂ = 1 mm (the default) is the default answer
  const result = run({}, 1e-3);
  near(val(result, 'probeFluxR'), val(result, 'fluxR'), 1e-12); near(val(result, 'probeFlux'), val(result, 'flux'), 1e-12);
  assert.ok(val(run({}, 5e-3), 'probeFluxR') < val(run({}, 1e-3), 'probeFluxR'));
  assert.equal(val(run({}, 5e-3), 'fluxR'), val(run({}, 1e-3), 'fluxR'), 'the answers use the typed g₂, the probe only moves the curve point');
});

test('verification rows: KCL, both KVL loops, Ampère loops, Cramer ×2 and symmetry pass; an asymmetric core skips the symmetry row with a reason', () => {
  const rows = def.verify(defaults);
  assert.equal(rows.length, 8);
  assert.deepEqual(statuses(rows), Array(8).fill('pass'));
  assert.ok(rows.some(r => /KCL/.test(r.label)) && rows.filter(r => /KVL/.test(r.label)).length === 2 && rows.filter(r => /암페어/.test(r.label)).length === 2 && rows.filter(r => /Cramer/.test(r.label)).length === 2);
  const asym = def.verify({ ...defaults, gapL: 0, gapR: 2e-3, lengthR: 0.25 });
  assert.deepEqual(statuses(asym), [...Array(7).fill('pass'), 'skipped']);
  assert.match(asym.at(-1).reason, /같지 않아/);
  assert.deepEqual(statuses(def.verify({ ...defaults, current: 0 })), Array(8).fill('pass'), 'NI = 0: zero flux everywhere is still consistent');
  assert.deepEqual(statuses(def.verify({ ...defaults, gapL: 0, gapR: 0, areaC: 1e-6, muR: 1 })), Array(8).fill('pass'));
  assert.equal(def.verify({ ...defaults, gapR: -1 })[0].status, 'skipped', 'invalid input: the verification is skipped, not failed');
});

test('invalid input is refused without correction: ranges, non-numbers, a negative sweep gap, a malformed probe', () => {
  for (const over of [{ gapR: -1e-3 }, { gapL: 0.06 }, { muR: 0.5 }, { areaC: 0 }, { lengthL: 0 }, { turns: 0 }, { current: -1 }, { current: NaN }, { areaR: Infinity }, { lengthC: '0.1' }]) {
    const result = run(over);
    assert.equal(result.status, 'invalid', JSON.stringify(over)); assert.equal(result.scalars.length, 0);
  }
  assert.equal(run({}, -1e-3).status, 'invalid', 'a negative probe gap is rejected');
  assert.equal(def.evaluate(defaults, [0, 0]).status, 'invalid'); assert.equal(def.evaluate(defaults, [0, 0, NaN]).status, 'invalid');
  assert.equal(def.evaluate(null, [0, 0, 0]).status, 'invalid');
  assert.deepEqual(def.profile({ ...defaults, gapR: -1 }, 81), [], 'no curve for invalid input');
  assert.equal(run({ current: 0 }).status, 'valid'); assert.equal(val(run({ current: 0 }), 'flux'), 0);
});

test('notes: the flux-crowding explanation is always there; the linear-core warning appears only when a leg passes 1.2 T', () => {
  const normal = run();
  assert.ok(normal.notes.some(n => n.includes('한쪽 공극을 넓히면')));
  assert.ok(!normal.notes.some(n => n.includes('선형 근사 한계')), 'B ≈ 0.1 T: linear is fine');
  const strong = run({ current: 5 });
  assert.ok(val(strong, 'Bc') > 1.2 && strong.notes.some(n => n.includes('선형 근사 한계')));
  assert.ok(normal.notes.some(n => n.includes('mcircuit-gap-core')), 'points to the nonlinear B–H experiment');
});

test('DOM-free pure module with the Hayt 8.8 reference', () => {
  const source = readFileSync(new URL('../../../src/em-course-magnetic-parallel.js', import.meta.url), 'utf8');
  assert.ok(!/\b(?:window|document|localStorage|sessionStorage)\b/.test(source.replace(/\/\/.*$/gm, '')));
  assert.ok(def.references.some(r => r.title.includes('Hayt') && r.title.includes('8.8') && r.url.startsWith('https://')));
});
