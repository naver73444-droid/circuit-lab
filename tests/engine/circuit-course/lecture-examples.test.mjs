// Lecture examples on the numeric experiments (1–5), the course-wide peak/RMS display basis, reference/sequence options and the display helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS, initialParameters, evaluateExperiment, verifyExample, getExperiment } from '../../../src/circuit-course-registry.js';
import { balancedThreePhase } from '../../../src/circuit-course-model.js';
import { phasorGraphs, verificationTable } from '../../../src/circuit-course-view.js';
import { parseCourseNumber } from '../../../src/circuit-course-controller.js';
import { parseCourseNumber as parseFromFormat } from '../../../src/circuit-course-format.js';

const near = (actual, expected, tolerance = 1e-9, what = '') => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, what + ' ' + actual + ' ≠ ' + expected + ' ± ' + tolerance);
const numeric = EXPERIMENTS.filter(e => e.id !== 'problem');
const ang = w => Math.atan2(w.im, w.re) * 180 / Math.PI;

test('every numeric experiment has the basis select; amplitude fields are flagged and examples name their basis', () => {
  assert.deepEqual(numeric.map(e => e.id), ['phasor-wave', 'impedance', 'power', 'three-phase', 'correction']);
  const amplitudeKeys = { 'phasor-wave': ['re', 'im', 'amplitude'], impedance: ['voltageRms'], power: ['voltage', 'current'], 'three-phase': ['lineVoltageRms'], correction: ['voltageRms'] };
  for (const e of numeric) {
    assert.ok(e.parameters.some(p => p.key === 'basis' && p.initial === 'rms'), e.id + ' has basis');
    assert.deepEqual(e.parameters.filter(p => p.amplitude).map(p => p.key), amplitudeKeys[e.id], e.id + ' amplitude fields');
    for (const ex of e.examples) { assert.ok(['peak', 'rms'].includes(ex.values.basis), e.id + ': ' + ex.label); for (const key of Object.keys(ex.values)) assert.ok(e.parameters.some(p => p.key === key), e.id + ': ' + key); }
  }
});

test('lecture presets exist on the experiments, Ch.9–10 and Ch.11 front in peak, Ch.11 back–12 in RMS', () => {
  const all = numeric.flatMap(e => e.examples.map(ex => ({ id: e.id, ...ex })));
  const need = [['9.1', 'peak'], ['9.2', 'peak'], ['9.9', 'peak'], ['11.2', 'peak'], ['11.3', 'peak'], ['11.9', 'peak'], ['11.11', 'peak'], ['11.12', 'rms'], ['11.15', 'rms'], ['12.3', 'rms'], ['12.4', 'rms'], ['12.5', 'rms'], ['12.8',
    'rms'], ['12.46', 'rms']];
  for (const [number, basis] of need) {
    const found = all.filter(ex => ex.label.includes(number + ' ') || ex.label.includes(number + '(') || ex.label.includes(number));
    assert.ok(found.length > 0, 'example ' + number);
    for (const ex of found) { assert.equal(ex.values.basis, basis, number + ' basis'); assert.ok(ex.expect?.length > 0, number + ' has expected values'); }
  }
});

test('every expected value of every lecture example is reproduced (0.1 % unless the row says otherwise)', () => {
  let rows = 0;
  for (const e of numeric) e.examples.forEach((ex, i) => {
    const checked = verifyExample(e.id, i);
    if (!ex.expect) { assert.equal(checked, null); return; }
    assert.equal(checked.status, 'valid', e.id + ' · ' + ex.label + ': ' + checked.reason);
    for (const row of checked.rows) { rows++; assert.ok(row.pass, e.id + ' · ' + ex.label + ' · ' + row.label + ': ' + row.actual + ' vs ' + row.expected); }
  });
  assert.ok(rows >= 55, 'rows ' + rows);
});

test('physical equivalence: peak input ×√2 gives the same RMS-internal result as RMS input (experiments 1–5, numeric and symbolic presentation)', () => {
  const k = Math.SQRT2;
  for (const e of numeric) {
    const rmsParams = { ...initialParameters(e), presentation: 'numeric', basis: 'rms' }, peakParams = { ...rmsParams, basis: 'peak' };
    for (const p of e.parameters) if (p.amplitude) peakParams[p.key] = rmsParams[p.key] * k;
    const a = evaluateExperiment(e.id, rmsParams), b = evaluateExperiment(e.id, peakParams);
    assert.equal(a.status, 'valid', e.id); assert.equal(b.status, 'valid', e.id + ' peak');
    for (const [pa, pb] of (a.phasors ?? []).map((p, i) => [p, b.phasors[i]])) { near(pa.z.re, pb.z.re, 1e-9 * (1 + Math.abs(pa.z.re)), e.id + ' ' + pa.label); near(pa.z.im, pb.z.im, 1e-9 * (1 + Math.abs(pa.z.im)), e.id + ' '
      + pa.label); }
    if (a.power) { near(a.power.pWatts, b.power.pWatts, 1e-9 * (1 + Math.abs(a.power.pWatts))); near(a.power.qVars, b.power.qVars, 1e-9 * (1 + Math.abs(a.power.qVars))); }
    const sym = evaluateExperiment(e.id, { ...peakParams, presentation: 'symbolic' });
    assert.notEqual(sym.status, undefined, e.id + ' symbolic with peak basis still answers');
  }
});

test('three-phase experiment: reference Van|Vab and sequence abc|acb', () => {
  const base = { connection: 'Y', lineVoltageRms: 400, z: { re: 8, im: 6 } };
  const van = balancedThreePhase({ ...base, phaseDeg: 20, reference: 'Van' }), vab = balancedThreePhase({ ...base, phaseDeg: 20, reference: 'Vab' });
  near(ang(van.phaseVoltages[0]), 20, 1e-9); near(ang(van.lineVoltages[0]), 50, 1e-9, 'Vab leads Van by 30° (abc)');
  near(ang(vab.lineVoltages[0]), 20, 1e-9, 'Vab given'); near(ang(vab.phaseVoltages[0]), -10, 1e-9, 'Van = Vab − 30°');
  const acb = balancedThreePhase({ ...base, sequence: 'acb' }), acbVab = balancedThreePhase({ ...base, sequence: 'acb', reference: 'Vab', phaseDeg: 0 });
  near(ang(acb.phaseVoltages[1]), 120, 1e-9, 'Vbn leads in acb'); near(ang(acb.lineVoltages[0]), -30, 1e-9, 'Vab lags Van by 30° (acb)');
  near(ang(acbVab.phaseVoltages[0]), 30, 1e-9, 'acb: Van = Vab + 30°'); near(ang(acbVab.lineVoltages[0]), 0, 1e-9);
  assert.equal(balancedThreePhase({ ...base, sequence: 'bca' }).status, 'invalid'); assert.equal(balancedThreePhase({ ...base, reference: 'Vbc' }).status, 'invalid');
  // textbook 12.4: Vab = 330∠0°, abc → Van = 190.5∠−30°
  const t = balancedThreePhase({ connection: 'delta', lineVoltageRms: 330, z: { re: 20, im: -15 }, reference: 'Vab', phaseDeg: 0 });
  near(ang(t.phaseVoltages[0]), -30, 1e-9);
});

test('display helpers: phasor graphs print the display basis, verification table marks FAIL', () => {
  const phasors = [{ label: 'V', unit: 'V', z: { re: 100, im: 0 } }];
  const rms = phasorGraphs(phasors, 'rms'), peak = phasorGraphs(phasors, 'peak');
  assert.match(rms, /\(rms\)/); assert.match(rms, /100 ∠ 0°/);
  assert.match(peak, /\(peak\)/); assert.match(peak, /141\.4214 ∠ 0°/);
  assert.doesNotMatch(phasorGraphs([{ label: '결과', unit: '(단위 없음)', z: { re: 3, im: 4 }, raw: true }], 'peak'), /\(peak\)/);
  const html = verificationTable([{ label: 'a', expected: 1, actual: 1, pass: true, unit: 'V', note: '' }, { label: 'b', expected: 2, actual: 3, pass: false, unit: '', note: '반올림' }]);
  assert.match(html, /PASS/); assert.match(html, /FAIL/); assert.match(html, /불일치/); assert.match(html, /반올림/);
  assert.doesNotMatch(verificationTable([{ label: 'a', expected: 1, actual: 1, pass: true }]), /불일치/);
});

test('terminology: lagging/leading wording and uppercase load-side labels appear in the experiment output', () => {
  const power = getExperiment('power');
  const leading = evaluateExperiment('power', { ...initialParameters(power), presentation: 'numeric', currentAngle: 53.13 });
  assert.equal(leading.power.nature, 'leading');
  const three = evaluateExperiment('three-phase', { ...initialParameters(getExperiment('three-phase')), presentation: 'numeric', connection: 'delta' });
  assert.deepEqual(three.phasors.filter(p => p.unit === 'A').map(p => p.label), ['Ia', 'Ib', 'Ic', 'IAB', 'IBC', 'ICA']);
  assert.equal(parseCourseNumber, parseFromFormat, 'one number parser for the controller and the tools');
});
