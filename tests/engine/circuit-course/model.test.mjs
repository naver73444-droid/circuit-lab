import test from 'node:test';
import assert from 'node:assert/strict';
import { polar, rmsPhasor, rectangularPolar, waveSample, complexPower, impedanceNetwork, balancedThreePhase, correction, magnitude, multiply, conjugate, scale, sub, add, phaseDifference, sampledPowerCheck } from '../../../src/circuit-course-model.js';
import { EXPERIMENTS, initialParameters, evaluateExperiment } from '../../../src/circuit-course-registry.js';
import { parseCourseNumber } from '../../../src/circuit-course-controller.js';
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, actual + ' ≠ ' + expected + ' ± ' + tolerance);
const zn = (actual, re, im, tol = 1e-8) => { near(actual.re, re, tol); near(actual.im, im, tol); };
const net = (branches, topology = 'series', frequencyHz = 50, voltageRms = 100) => impedanceNetwork({ branches, topology, frequencyHz, voltageRms });
const fixture = r => { assert.equal(r.status, 'valid', r.reason); return r; };
test('RMS/peak conversion, quadrant and zero-phase domain', () => {
  zn(rmsPhasor({ re: 100 * Math.SQRT2, im: 0 }, 'peak'), 100, 0);
  near(waveSample(polar(100, 0), 50, 0), 100 * Math.SQRT2);
  near(waveSample(polar(100, 90), 50, 0), 0);
  near(waveSample(polar(100, 0), 50, .005), 0);
  near(rectangularPolar({ re: -1, im: 1 }).angleDeg, 135);
  assert.equal(rectangularPolar({ re: 0, im: 0 }).angleDeg, null);
});
test('parent 3+j4 series RL fixture and KVL', () => {
  const r = fixture(net([{ kind: 'R', value: 3 }, { kind: 'L', value: .012732395447351627 }]));
  zn(r.Z, 3, 4); zn(r.I, 12, -16); near(r.power.pWatts, 1200); near(r.power.qVars, 1600); near(r.power.apparentVA, 2000); near(r.power.pf, .6);
  assert.equal(r.power.nature, 'lagging'); zn(r.branches.map(b => b.V).reduce(add, { re: 0, im: 0 }), 100, 0);
  const c = sampledPowerCheck(r.V, r.I, 50, 1200); assert.ok(c.pass); near(c.voltageRms, 100); near(c.currentRms, 20);
});
test('parent 3−j4 series RC fixture: capacitive Q and leading current', () => {
  const r = fixture(net([{ kind: 'R', value: 3 }, { kind: 'C', value: .0007957747154594767 }]));
  zn(r.Z, 3, -4); zn(r.I, 12, 16); near(r.power.qVars, -1600); assert.equal(r.power.nature, 'leading');
  near(phaseDifference(r.V, r.I), -53.13010235415598);
});
test('pure R, L, C power and PF=0 versus undefined', () => {
  const rr = fixture(net([{ kind: 'R', value: 10 }])); near(rr.power.pWatts, 1000); near(rr.power.pf, 1);
  const l = fixture(net([{ kind: 'L', value: .1 }])); zn(l.I, 0, -3.183098861837907); near(l.power.pWatts, 0); near(l.power.qVars, 318.3098861837907); near(l.power.pf, 0); assert.equal(l.power.nature, 'lagging');
  const c = fixture(net([{ kind: 'C', value: .0001 }])); near(c.power.pWatts, 0); assert.ok(c.power.qVars < 0); near(c.power.pf, 0);
  const zero = complexPower({ re: 0, im: 0 }, { re: 10, im: 0 }); assert.equal(zero.pf, null); assert.equal(zero.phaseDeg, null); assert.equal(zero.nature, 'undefined');
});
test('RLC resonance with nonzero R retains individual voltage, not just net X', () => {
  const r = fixture(net([{ kind: 'R', value: 10 }, { kind: 'L', value: .1 }, { kind: 'C', value: .00010132118364233776 }]));
  zn(r.Z, 10, 0); zn(r.I, 10, 0); near(r.power.pWatts, 1000); near(r.branches[1].V.im, 314.1592653589793); near(r.branches[2].V.im, -314.1592653589793);
});
test('parent parallel R/L/C fixture and KCL', () => {
  const r = fixture(net([{ kind: 'R', value: 100 }, { kind: 'L', value: 100 / (100 * Math.PI) }, { kind: 'C', value: 1 / (200 * 100 * Math.PI) }], 'parallel'));
  zn(r.Y, .01, -.005); zn(r.Z, 80, 40); zn(r.I, 1, -.5); zn(r.power.S, 100, 50); near(r.power.pf, .8944271909999159);
  zn(r.branches.map(b => b.I).reduce(add, { re: 0, im: 0 }), 1, -.5);
});
test('exact parallel LC resonance: circulating branches and zero source current', () => {
  const r = fixture(net([{ kind: 'L', value: 100 }, { kind: 'C', value: .01 }], 'parallel', 1 / (2 * Math.PI)));
  assert.equal(r.openCircuit, true); assert.equal(r.Z, null); zn(r.Y, 0, 0); zn(r.I, 0, 0); assert.equal(r.power.pf, null);
  zn(r.branches[0].I, 0, -1); zn(r.branches[1].I, 0, 1);
});
test('exact series LC resonance singular, zero-voltage also indeterminate; near resonance finite', () => {
  const b = [{ kind: 'L', value: 100 }, { kind: 'C', value: .01 }];
  assert.equal(net(b, 'series', 1 / (2 * Math.PI)).status, 'singular');
  assert.equal(net(b, 'series', 1 / (2 * Math.PI), 0).status, 'singular');
  const nearB = [{ kind: 'L', value: 100 }, { kind: 'C', value: .01 * (1 + 1e-12) }];
  assert.equal(net(nearB, 'series', 1 / (2 * Math.PI)).status, 'valid');
  const parallel = fixture(net(nearB, 'parallel', 1 / (2 * Math.PI))); assert.notEqual(parallel.Z, null); assert.ok(magnitude(parallel.I) > 0);
});
test('conjugate and independent phase-origin invariance; peak half factor', () => {
  const V = polar(100, 20), I = polar(20, 20 - 53.13010235415598), s = complexPower(V, I);
  zn(s.S, 1200, 1600);
  zn(scale(multiply(scale(V, Math.SQRT2), conjugate(scale(I, Math.SQRT2))), .5), 1200, 1600);
  assert.ok(Math.abs(multiply(V, I).im - 1600) > 100);
  assert.equal(complexPower(polar(100, 0), polar(10, 180)).flow, 'delivered');
});
test('parent 400V Y 8+j6 fixture, abc and +30°, independent line-power regression', () => {
  const r = fixture(balancedThreePhase({ connection: 'Y', lineVoltageRms: 400, z: { re: 8, im: 6 } }));
  near(r.power.pWatts, 12800); near(r.power.qVars, 9600); near(r.power.apparentVA, 16000); near(r.lineCurrentRms, 23.094010767585033); near(r.power.pf, .8);
  near(phaseDifference(r.lineVoltages[0], r.phaseVoltages[0]), 30);
  near(phaseDifference(r.phaseVoltages[1], r.phaseVoltages[0]), -120);
  zn(r.lineCurrents.reduce(add, { re: 0, im: 0 }), 0, 0);
  const corrected = scale(multiply(multiply(r.lineVoltages[0], conjugate(r.lineCurrents[0])), polar(1, -30)), Math.sqrt(3));
  zn(corrected, 12800, 9600); zn(r.sourceS, 12800, 9600);
  const wrong = scale(multiply(r.lineVoltages[0], conjugate(r.lineCurrents[0])), Math.sqrt(3));
  assert.ok(Math.abs(wrong.re - 12800) > 1000);
});
test('parent equivalent delta and same-Z reconnection factor 3; Ia=Iab−Ica', () => {
  const y = fixture(balancedThreePhase({ connection: 'Y', lineVoltageRms: 400, z: { re: 8, im: 6 }, phaseDeg: 17 }));
  const d = fixture(balancedThreePhase({ connection: 'delta', lineVoltageRms: 400, z: { re: 24, im: 18 }, phaseDeg: 17 }));
  zn(sub(y.lineCurrents[0], d.lineCurrents[0]), 0, 0); near(d.power.pWatts, 12800); near(d.power.qVars, 9600);
  near(phaseDifference(d.lineCurrents[0], d.loadCurrents[0]), -30); near(d.lineCurrentRms / d.loadCurrentRms, Math.sqrt(3));
  const same = fixture(balancedThreePhase({ connection: 'delta', lineVoltageRms: 400, z: { re: 8, im: 6 } }));
  near(same.power.pWatts, 38400); near(same.power.qVars, 28800); near(same.lineCurrentRms, 3 * y.lineCurrentRms);
});
test('balanced 3-phase total instantaneous power constant in independent time samples', () => {
  for (const connection of ['Y', 'delta']) {
    const r = fixture(balancedThreePhase({ connection, lineVoltageRms: 400, z: { re: 8, im: -6 }, phaseDeg: 45 }));
    for (let n = 0; n < 127; n++) {
      const t = n / (127 * 50);
      const total = r.loadVoltages.reduce((p, v, i) => p + waveSample(v, 50, t) * waveSample(r.loadCurrents[i], 50, t), 0);
      near(total, r.power.pWatts, 1e-7);
    }
  }
});
test('parent single-phase .8→1 correction fixture, source current and unchanged P', () => {
  const r = fixture(correction({ frequencyHz: 60, voltageRms: 120, pWatts: 1000, qVars: 750, targetPF: 1 }));
  near(r.recommendedCapacitanceF * 1e6, 138.15533254504802); near(r.qCapacitorVars, -750); near(r.qAfterVars, 0); near(r.after.pWatts, 1000); near(r.sourceCurrentBeforeRms, 10.416666666666667); near(r.sourceCurrentAfterRms, 8.333333333333334);
});
test('parent three-phase .8→.95 correction: Y C = 3 Δ C', () => {
  const p = { frequencyHz: 50, voltageRms: 400, pWatts: 10000, qVars: 7500, targetPF: .95, phases: 3 };
  const d = fixture(correction({ ...p, connection: 'delta' })), y = fixture(correction({ ...p, connection: 'Y' }));
  near(d.qCapacitorVars, -4213.158948211369, 1e-8); near(d.recommendedCapacitanceF * 1e6, 27.939378026777, 1e-8); near(y.recommendedCapacitanceF * 1e6, 83.818134080331, 1e-8);
  near(d.sourceCurrentBeforeRms, 18.042195912175806); near(d.sourceCurrentAfterRms, 15.1934281365691, 1e-8); near(d.after.pf, .95);
  near(y.recommendedCapacitanceF, 3 * d.recommendedCapacitanceF);
});
test('overcompensation and infeasible capacitor-only targets never yield negative C', () => {
  const p = { frequencyHz: 60, voltageRms: 120, pWatts: 1000, qVars: 750, targetPF: 1 };
  const over = fixture(correction({ ...p, capacitanceF: 300e-6 })); assert.ok(over.overcompensated); assert.equal(over.after.nature, 'leading'); assert.ok(over.warnings.length);
  for (const qVars of [-750, 0]) { const r = fixture(correction({ ...p, qVars, targetPF: .8 })); assert.equal(r.possible, false); assert.equal(r.recommendedCapacitanceF, null); near(r.selectedCapacitanceF, 0); assert.ok(r.warnings.length); }
});
test('invalid physical domains and numeric strings', () => {
  for (const value of [0, -1, NaN, Infinity]) assert.equal(net([{ kind: 'L', value }]).status, 'invalid');
  assert.equal(net([{ kind: 'R', value: 10 }], 'series', 0).status, 'invalid');
  assert.equal(balancedThreePhase({ connection: 'Y', lineVoltageRms: 400, z: { re: 0, im: 0 } }).status, 'invalid');
  assert.equal(correction({ frequencyHz: 50, voltageRms: 400, pWatts: 1000, qVars: 500, targetPF: 1.1 }).status, 'invalid');
  for (const input of ['', '  ', 'Infinity', 'NaN', '2xyz', '0x10', '1e-999']) assert.throws(() => parseCourseNumber(input));
  near(parseCourseNumber('-2.5e-3'), -.0025);
});
test('five registry default cases and all advertised example presets produce valid results', () => {
  assert.equal(EXPERIMENTS.length, 6);
  for (const e of EXPERIMENTS) {
    const p = {...initialParameters(e),presentation:'numeric',solutionMode:'numeric'}; if (e.id === 'problem') assert.equal(evaluateExperiment(e.id,p).status,'invalid'); else fixture(evaluateExperiment(e.id, p));
    for (const example of e.examples) { const r = fixture(evaluateExperiment(e.id, { ...p, ...example.values })); for (const check of r.checks ?? []) assert.ok(check.pass, e.id + ': ' + check.label); }
  }
});

test('advertised RLC resonance preset cancels Q and preserves nonzero branch voltages', () => {
  const e = EXPERIMENTS.find(e => e.id === 'impedance');
  const example = e.examples[2];
  const r = fixture(evaluateExperiment(e.id, { ...initialParameters(e), presentation:'numeric', ...example.values }));
  near(r.Z.im, 0); near(r.power.qVars, 0); near(r.power.pWatts, 1000);
  near(r.branches[1].V.im, 314.1592653589793); near(r.branches[2].V.im, -314.1592653589793);
});

test('independent review: custom zero C cannot bypass finite recommended capacitance guard', () => {
  const result = correction({ frequencyHz: 50, voltageRms: 1e-150, pWatts: 1, qVars: 1e100, targetPF: 1, capacitanceF: 0 });
  assert.equal(result.status, 'invalid');
  assert.ok(result.reason);
});
test('independent review: huge base phase must preserve abc offsets before polar conversion', () => {
  for (const connection of ['Y', 'delta']) for (const phaseDeg of [1e100, -1e100]) {
    const input = { connection, lineVoltageRms: 400, z: { re: 8, im: 6 } };
    const actual = fixture(balancedThreePhase({ ...input, phaseDeg }));
    const reduced = fixture(balancedThreePhase({ ...input, phaseDeg: phaseDeg % 360 }));
    for (const key of ['phaseVoltages', 'lineVoltages', 'loadVoltages', 'loadCurrents', 'lineCurrents']) {
      for (let i = 0; i < 3; i++) zn(sub(actual[key][i], reduced[key][i]), 0, 0);
    }
    near(magnitude(actual.lineVoltages[0]), 400);
    near(phaseDifference(actual.phaseVoltages[1], actual.phaseVoltages[0]), -120);
    near(phaseDifference(actual.lineVoltages[0], actual.phaseVoltages[0]), 30);
    near(actual.power.pWatts, connection === 'Y' ? 12800 : 38400);
    near(actual.power.qVars, connection === 'Y' ? 9600 : 28800);
  }
});
