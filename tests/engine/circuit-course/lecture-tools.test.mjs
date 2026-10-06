// Course tools (complex calculator, 3-phase extension, parallel loads, max power, Ch.13) and their lecture presets: registry integrity,
// textbook values (0.1 %), and closed forms that do not reuse the module under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, getTool } from '../../../src/circuit-course-tools.js';
import { initialValues, dataFields, evaluateTool, verifyPreset, presetValues, validateValues, toDisplay, fromDisplay } from '../../../src/circuit-course-tool-common.js';
import { solveThreePhase, pfFromLineData } from '../../../src/circuit-course-threephase.js';
import { combineLoads, loadPower } from '../../../src/circuit-course-loads.js';
import { maxPowerTransfer, powerAt } from '../../../src/circuit-course-maxpower.js';
import { evaluateComplexExpression } from '../../../src/circuit-course-complex-expr.js';
import { magnitude, add, sub, multiply, divide } from '../../../src/circuit-course-model.js';
import { toolFigure } from '../../../src/circuit-course-figures.js';

const near = (actual, expected, tolerance = 1e-9, what = '') => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, what + ' ' + actual + ' ≠ ' + expected + ' ± ' + tolerance);
const rel = (actual, expected, r = 1e-3, what = '') => near(actual, expected, Math.abs(expected) * r, what);
const z = (re, im) => ({ re, im });
const polar = (m, deg) => z(m * Math.cos(deg * Math.PI / 180), m * Math.sin(deg * Math.PI / 180));
const ang = w => Math.atan2(w.im, w.re) * 180 / Math.PI;

test('tool registry: unique ids and keys, valid defaults, preset keys are fields, every field kind is handled', () => {
  assert.deepEqual(TOOLS.map(t => t.id), ['complex', 'three-phase-ext', 'loads', 'max-power', 'coupled', 'transformer']);
  assert.equal(new Set(TOOLS.map(t => t.title)).size, TOOLS.length);
  for (const def of TOOLS) {
    const keys = dataFields(def).map(f => f.key);
    assert.equal(new Set(keys).size, keys.length, def.id + ' field keys are unique');
    assert.ok(getTool(def.id) === def);
    const base = initialValues(def);
    validateValues(def, base);
    assert.equal(evaluateTool(def, base).status, 'valid', def.id + ' default evaluates: ' + evaluateTool(def, base).reason);
    for (const preset of def.presets) for (const key of Object.keys(preset.values)) assert.ok(keys.includes(key), def.id + ': preset key ' + key + ' is a field');
    for (const field of dataFields(def)) {
      if (field.kind === 'select') assert.ok(field.choices.some(([key]) => key === field.initial), def.id + '.' + field.key + ' initial is a choice');
      assert.ok(['number', 'select', 'text'].includes(field.kind));
    }
  }
});

test('every lecture preset reproduces its textbook numbers within its tolerance (tools)', () => {
  let rows = 0;
  for (const def of TOOLS) for (const preset of def.presets) {
    const checked = verifyPreset(def, preset);
    assert.equal(checked.status, 'valid', def.id + ' · ' + preset.label + ': ' + checked.reason);
    assert.ok(preset.expect?.length > 0, preset.label + ' has expected values');
    for (const row of checked.rows) { rows++; assert.ok(row.pass, def.id + ' · ' + preset.label + ' · ' + row.label + ': ' + row.actual + ' vs ' + row.expected); }
    for (const check of checked.result.checks ?? []) assert.ok(check.pass, preset.label + ': ' + check.label);
  }
  assert.ok(rows >= 80, 'enough expectation rows: ' + rows);
});

test('amplitude basis: the display factor is √2 and angles/powers do not change; presets are stored as RMS', () => {
  const def = getTool('three-phase-ext'), values = presetValues(def, def.presets[0]);
  const rms = evaluateTool(def, values, 'rms'), peak = evaluateTool(def, values, 'peak');
  near(peak.values.IAMag, rms.values.IAMag * Math.SQRT2, 1e-12);
  near(peak.values.IAAng, rms.values.IAAng, 1e-12);
  near(peak.values.SloadRe, rms.values.SloadRe, 1e-9, 'power does not depend on the basis');
  const field = dataFields(def).find(f => f.key === 'voltage');
  near(fromDisplay(field, toDisplay(field, 110, 'peak'), 'peak'), 110, 1e-12);
  // a peak preset (Ch.9–10 style) and its RMS twin are the same physical case
  const coupled = getTool('coupled'), p13 = coupled.presets[1];
  assert.equal(p13.basis, 'peak');
  near(presetValues(coupled, p13).voltage, 60 / Math.SQRT2, 1e-12);
});

// ---------------------------------------------------------------------------------------------------------------------------------
const Y = (V, Zl, loads, extra = {}) => solveThreePhase({ sourceConnection: 'Y', voltageKind: 'phase', voltageRms: V, lineZ: Zl, loads, loadConnection: 'Y', neutral: 'none', ...extra });
test('three-phase: balanced Y-Y equals the single-phase equivalent and b, c lag by 120°/240° (abc) or lead (acb)', () => {
  const Z = z(10, 8), Zl = z(5, -2), r = Y(110, Zl, [Z, Z, Z]);
  const Ia = multiply(z(110, 0), z(1 / (15 ** 2 + 6 ** 2) * 15, -1 / (15 ** 2 + 6 ** 2) * 6)); // 110/(15+j6)
  near(r.lineCurrents[0].re, Ia.re, 1e-9); near(r.lineCurrents[0].im, Ia.im, 1e-9);
  near(ang(r.lineCurrents[1]), ang(Ia) - 120, 1e-9); near(ang(r.lineCurrents[2]), ang(Ia) + 120, 1e-9);
  near(magnitude(r.neutralCurrent), 0, 1e-12);
  const acb = Y(110, Zl, [Z, Z, Z], { sequence: 'acb' });
  near(ang(acb.lineCurrents[1]), ang(Ia) + 120, 1e-9);
  near(ang(acb.sourceLineVoltages[0]), -30, 1e-9, 'Vab leads by −30° in acb');
  near(ang(r.sourceLineVoltages[0]), 30, 1e-9, 'Vab = √3 Van∠+30° in abc');
  near(magnitude(r.sourceLineVoltages[0]), 110 * Math.sqrt(3), 1e-9);
});
test('three-phase: Δ source = equivalent Y source (Vp/√3 ∠−30° from Vab), Δ load = Y with ZΔ/3', () => {
  const delta = solveThreePhase({ sourceConnection: 'delta', reference: 'Vab', referenceDeg: 0, voltageRms: 330, lineZ: z(0, 0), loads: [z(20, -15), z(20, -15), z(20, -15)], loadConnection: 'delta' });
  near(ang(delta.sourceVoltages[0]), -30, 1e-9); near(magnitude(delta.sourceVoltages[0]), 330 / Math.sqrt(3), 1e-9);
  const asY = solveThreePhase({ sourceConnection: 'Y', voltageKind: 'line', reference: 'Vab', referenceDeg: 0, voltageRms: 330, lineZ: z(0, 0), loads: [z(20 / 3, -5), z(20 / 3, -5), z(20 / 3, -5)], loadConnection: 'Y' });
  for (let i = 0; i < 3; i++) { near(delta.lineCurrents[i].re, asY.lineCurrents[i].re, 1e-9); near(delta.lineCurrents[i].im, asY.lineCurrents[i].im, 1e-9); }
  // Ia = IAB − ICA and |IL| = √3 |Iφ|, 30° lag of the first
  const d = delta.loadCurrents;
  near(magnitude(delta.lineCurrents[0]), Math.sqrt(3) * magnitude(d[0]), 1e-9);
  near(ang(delta.lineCurrents[0]) - ang(d[0]), -30, 1e-9);
  near(magnitude(sub(delta.lineCurrents[0], sub(d[0], d[2]))), 0, 1e-9);
});
test('three-phase: unbalanced loads — 4-wire neutral current In=−(Ia+Ib+Ic) and KVL of the 3-wire loops', () => {
  const loads = [z(0, 5), z(10, 0), z(0, -10)];
  const four = Y(120, z(0, 0), loads, { neutral: 'ideal' });
  const [Ia, Ib, Ic] = [polar(120, 0), polar(120, -120), polar(120, 120)].map((V, i) => multiply(V, z(loads[i].re / (loads[i].re ** 2 + loads[i].im ** 2), -loads[i].im / (loads[i].re ** 2 + loads[i].im ** 2))));
  near(magnitude(sub(four.neutralCurrent, z(-(Ia.re + Ib.re + Ic.re), -(Ia.im + Ib.im + Ic.im)))), 0, 1e-9);
  const three = Y(120, z(0.5, 0.2), loads);
  const [ia, ib, ic] = three.lineCurrents, Zt = loads.map(w => add(w, z(0.5, 0.2)));
  near(magnitude(sub(sub(multiply(Zt[0], ia), multiply(Zt[1], ib)), sub(polar(120, 0), polar(120, -120)))), 0, 1e-9, 'loop a-b');
  near(magnitude(sub(sub(multiply(Zt[1], ib), multiply(Zt[2], ic)), sub(polar(120, -120), polar(120, 120)))), 0, 1e-9, 'loop b-c');
  near(magnitude(add(add(ia, ib), ic)), 0, 1e-9, 'KCL');
  const withZn = Y(120, z(0, 0), loads, { neutral: 'impedance', neutralZ: z(2, 1) });
  assert.ok(withZn.checks.every(c => c.pass) && four.checks.every(c => c.pass) && three.checks.every(c => c.pass));
  assert.ok(magnitude(withZn.neutralCurrent) < magnitude(four.neutralCurrent), 'a neutral impedance reduces In');
});
test('three-phase: source = line + load complex power; example 12.6 within 0.1 % of the lecture numbers; 12.7 pf', () => {
  const r = Y(110, z(5, -2), [z(10, 8), z(10, 8), z(10, 8)]);
  near(magnitude(sub(sub(r.power.source, r.power.line), r.power.load)), 0, 1e-9);
  rel(r.power.source.re, 2087); rel(r.power.source.im, 834.6); rel(r.power.load.re, 1392); rel(r.power.load.im, 1113); rel(r.power.line.re, 695.6); rel(r.power.line.im, -278.3);
  near(r.power.load.re, 3 * 6.8088 ** 2 * 10, 0.2, 'closed form 3|I|²R'); // exact: 1390.8
  const m = pfFromLineData({ lineVoltageRms: 220, lineCurrentRms: 18.2, pWatts: 5600 });
  rel(m.apparentVA, 6935.13); rel(m.pf, 0.8075); near(m.pf, 5600 / (Math.sqrt(3) * 220 * 18.2), 1e-12);
  assert.equal(pfFromLineData({ lineVoltageRms: 220, lineCurrentRms: 1, pWatts: 5600 }).status, 'invalid');
  assert.equal(pfFromLineData({ lineVoltageRms: 220, lineCurrentRms: 18.2, pWatts: 5600, nature: 'leading' }).qVars < 0, true);
});
test('three-phase: invalid inputs are rejected with a reason (no NaN results)', () => {
  assert.equal(solveThreePhase({ sourceConnection: 'Y', voltageRms: 0, lineZ: z(0, 0), loads: [z(1, 0), z(1, 0), z(1, 0)], loadConnection: 'Y' }).status, 'invalid');
  assert.equal(Y(100, z(0, 0), [z(0, 0), z(1, 0), z(1, 0)]).status, 'invalid');
  assert.equal(Y(100, z(0, 0), [z(-1, 0), z(1, 0), z(1, 0)]).status, 'invalid');
  assert.equal(Y(100, z(0, 0), [z(1, 0), z(1, 0), z(1, 0)], { sequence: 'xyz' }).status, 'invalid');
  assert.equal(Y(100, z(0, 0), [z(1, 0), z(1, 0), z(1, 0)], { neutral: 'impedance', neutralZ: z(0, 0) }).status, 'invalid');
});

// ---------------------------------------------------------------------------------------------------------------------------------
test('parallel loads: S=ΣSk (P with P, Q with Q), |S| is not additive, lag/lead signs, pf compensation reaches the target', () => {
  const loads = [{ kind: 'kw-pf', a: 24, b: 0.8, nature: 'lagging' }, { kind: 'kw-pf', a: 40, b: 0.95, nature: 'lagging' }];
  const r = combineLoads({ loads, phases: 1, voltageRms: 120, frequencyHz: 60, compensate: true, targetPF: 1 });
  near(r.P, 64000, 1e-6); near(r.Q, 24000 * 0.75 + 40000 * Math.tan(Math.acos(0.95)), 1e-6);
  assert.ok(r.sumOfApparent > r.S);
  near(r.compensation.qAfterVars, 0, 1e-6); rel(r.compensation.capacitanceF, r.Q / (2 * Math.PI * 60 * 120 * 120), 1e-12);
  assert.equal(loadPower({ kind: 'kva-pf', a: 3, b: 0.4, nature: 'leading' }).Q < 0, true);
  near(loadPower({ kind: 'kvar-pf', a: 45, b: 0.8 }).P, 60000, 1e-6);
  const three = combineLoads({ loads: [{ kind: 'kw-pf', a: 100, b: 0.8 }], phases: 3, voltageRms: 400, frequencyHz: 50, compensate: true, targetPF: 0.95, connection: 'delta' });
  rel(three.lineCurrentRms, 125000 / (Math.sqrt(3) * 400), 1e-12);
  rel(three.compensation.capacitanceF * 3 * 2 * Math.PI * 50 * 400 ** 2, 100000 * (0.75 - Math.tan(Math.acos(0.95))), 1e-9);
  const y = combineLoads({ loads: [{ kind: 'kw-pf', a: 100, b: 0.8 }], phases: 3, voltageRms: 400, frequencyHz: 50, compensate: true, targetPF: 0.95, connection: 'Y' });
  rel(y.compensation.capacitanceF, 3 * three.compensation.capacitanceF, 1e-12);
  for (const bad of [{ loads: [] }, { loads: Array(6).fill(loads[0]) }, { loads: [{ kind: 'kw-pf', a: 1, b: 0 }] }, { loads: [{ kind: 'kw-pf', a: 1, b: 1.2 }] }, { loads: [{ kind: 'kw-pf', a: 0, b: 1 }] }])
    assert.equal(combineLoads({ phases: 1, voltageRms: 120, frequencyHz: 60, ...bad }).status, 'invalid');
});

test('maximum power: ZL=ZTh* beats every other load; Pmax=|VTh,peak|²/(8RTh); efficiency RL/(RTh+RL)', () => {
  const vth = polar(7.454 / Math.SQRT2, -10.3), zth = z(2.933, 4.467);
  const best = maxPowerTransfer({ source: 'direct', vthRms: 7.454 / Math.SQRT2, vthDeg: -10.3, zth, zl: null });
  rel(best.pBest, 7.454 ** 2 / (8 * 2.933), 1e-9); rel(best.pmaxClosed, best.pBest, 1e-12);
  near(best.efficiency, 0.5, 1e-12);
  let maxSeen = 0;
  for (let r = 0.2; r < 12; r += 0.2) for (let x = -12; x <= 12; x += 0.2) maxSeen = Math.max(maxSeen, powerAt(vth, zth, z(r, x)).pWatts);
  assert.ok(maxSeen <= best.pBest * (1 + 1e-12), 'no grid load exceeds Pmax');
  assert.ok(powerAt(vth, zth, z(2.933 + 0.1, -4.467)).pWatts < best.pBest);
  const divider = maxPowerTransfer({ source: 'divider', vthRms: 10 / Math.SQRT2, vthDeg: 0, zs: z(4, 0), zp: z(8, -6), zo: z(0, 5), zl: null });
  rel(divider.zth.re, 2.933, 1e-3); rel(divider.zth.im, 4.467, 1e-3); rel(magnitude(divider.vth) * Math.SQRT2, 7.454, 1e-3);
  const parallel = divide(multiply(z(4, 0), z(8, -6)), z(12, -6)); // Zs∥Zp, then + Zo = j5
  near(divider.zth.re, parallel.re, 1e-12); near(divider.zth.im, parallel.im + 5, 1e-12);
  const open = multiply(polar(10 / Math.SQRT2, 0), divide(z(8, -6), z(12, -6))); // VTh = Vs Zp/(Zs+Zp)
  near(divider.vth.re, open.re, 1e-12); near(divider.vth.im, open.im, 1e-12);
  assert.equal(maxPowerTransfer({ source: 'direct', vthRms: 1, zth: z(0, 3), zl: null }).status, 'invalid');
});

test('complex calculator: precedence, polar entry, conj/sqrt, injection and malformed text are rejected', () => {
  const ok = text => { const r = evaluateComplexExpression(text); assert.equal(r.status, 'valid', text + ': ' + r.reason); return r.value; };
  near(ok('2+3*4').re, 14); near(ok('(2+j3)*(1-j)').re, 5); near(ok('(2+j3)*(1-j)').im, 1);
  near(ok('10∠90°').im, 10, 1e-9); near(ok('10<-90').im, -10, 1e-9);
  near(ok('sqrt(-4)').im, 2, 1e-12); near(ok('conj(3+j4)').im, -4); near(ok('abs(3+j4)').re, 5);
  near(ok('1/j').im, -1); near(ok('j4').im, 4);
  const sqrt = ok('sqrt(40∠50° + 20∠-30°)');
  rel(magnitude(sqrt), 6.91, 1e-3); near(ang(sqrt), 12.81, 0.01);
  for (const bad of ['', '2+', '(1+2', '1/0', 'alert(1)', 'Math.PI', '2 $ 3', 'x', '1e999', 'a'.repeat(300), '()', 'sqrt', '1∠', '--']) assert.equal(evaluateComplexExpression(bad).status, 'invalid', JSON.stringify(bad));
  assert.equal(evaluateComplexExpression('(((((((((((((((((((((((((((1)))))))))))))))))))))))))))').status, 'invalid');
});

test('figures are plain SVG strings with theme tokens only', () => {
  for (const figure of [{ kind: 'three-phase', source: 'delta', load: 'Y', neutral: 'ideal', hasLine: true }, { kind: 'coupled', dots: 'same', i2Ref: 'loop' }, { kind: 'coupled', dots: 'opposite', i2Ref: 'into' },
    { kind: 'ideal', dots: 'same', i2Direction: 'in' }, { kind: 'auto', mode: 'up' }, { kind: 'bank', primary: 'Y', secondary: 'delta' }]) {
    const svg = toolFigure(figure);
    assert.match(svg, /^<svg /); assert.doesNotMatch(svg, /<script|#[0-9a-f]{3,6}\b|onload|javascript:/i);
  }
  assert.equal(toolFigure({ kind: 'unknown' }), ''); assert.equal(toolFigure(undefined), '');
});
