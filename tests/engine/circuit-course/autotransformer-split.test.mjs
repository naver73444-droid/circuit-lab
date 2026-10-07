// Autotransformer power split (conducted vs magnetically coupled), common-winding current and the load power factor in the transformer tool.
// Example 13.10 numbers (240 V → 252 V, I2 = 4 A: S = 1008 VA, S_ind = 12 V × 4 A = 48 VA, 0.2 A in the common winding) are written out by hand here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autotransformer, autotransformerSplit } from '../../../src/circuit-course-coupled.js';
import { getTool } from '../../../src/circuit-course-tools.js';
import { evaluateTool, initialValues, presetValues, verifyPreset } from '../../../src/circuit-course-tool-common.js';
import { toolFigure } from '../../../src/circuit-course-figures.js';

const near = (actual, expected, tolerance = 1e-9, what = '') => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, what + ' ' + actual + ' ≠ ' + expected + ' ± ' + tolerance);
const ok = r => { assert.equal(r.status, 'valid', r.reason); return r; };
const def = getTool('transformer');
const auto = (extra = {}) => ({ ...initialValues(def), mode: 'auto', ...extra });

test('example 13.10 (step-up 240 → 252 V, I2 = 4 A): S = 1008 VA = 960 VA conducted + 48 VA coupled; common winding 0.2 A; S_ind/S = 1 − V1/V2', () => {
  const r = ok(autotransformer({ mode: 'up', turns1: 100, turns2: 5, v1Rms: 240, loadCurrentRms: 4 }));
  near(r.v2, 252); near(r.i1, 4.2); near(r.apparentVA, 1008);
  near(r.inductiveVA, 12 * 4, 1e-9, 'series winding: (252−240) V × 4 A');
  near(r.conductiveVA, 960); near(r.commonWindingCurrent, 0.2, 1e-12); near(r.seriesCurrent, 4);
  near(r.inductiveFraction, 1 - 240 / 252, 1e-12); near(r.gain, 21);
  const split = ok(autotransformerSplit(r, 1, 'lagging'));
  near(split.total.P, 1008); near(split.total.Q, 0); near(split.ind.P, 48); near(split.cond.P, 960);
  assert.ok(split.checks.every(c => c.pass));
});

test('step-down N1 = N2 (240 V → 120 V, I2 = 10 A): I1 = 5 A, S = 1200 VA, S_ind = (240−120) V × 5 A = 600 VA = S(1 − V2/V1), common winding |5 − 10| = 5 A', () => {
  const r = ok(autotransformer({ mode: 'down', turns1: 100, turns2: 100, v1Rms: 240, loadCurrentRms: 10 }));
  near(r.v2, 120); near(r.i1, 5); near(r.apparentVA, 1200);
  near(r.inductiveVA, 600); near(r.conductiveVA, 600); near(r.seriesCurrent, 5, 1e-12, 'step-down: N1 carries I1'); near(r.commonWindingCurrent, 5);
  near(r.inductiveFraction, 0.5, 1e-12);
});

test('S_cond + S_ind = S and S_ind/S = 1 − V_low/V_high over a grid of tap ratios, both connections', () => {
  for (const mode of ['up', 'down']) for (const [n1, n2] of [[100, 5], [100, 100], [10, 90], [3, 1], [1, 3], [250, 40]]) for (const v1 of [120, 240, 11000]) {
    const r = ok(autotransformer({ mode, turns1: n1, turns2: n2, v1Rms: v1, loadCurrentRms: 7.5 }));
    near(r.conductiveVA + r.inductiveVA, r.apparentVA, 1e-9 * r.apparentVA, `${mode} ${n1}:${n2}`);
    const low = Math.min(v1, r.v2), high = Math.max(v1, r.v2);
    near(r.inductiveFraction, 1 - low / high, 1e-12, `${mode} ${n1}:${n2} fraction`);
    assert.ok(r.inductiveVA >= 0 && r.conductiveVA >= -1e-9 * r.apparentVA);
    near(v1 * r.i1, r.v2 * r.i2, 1e-9 * r.apparentVA, 'V1 I1 = V2 I2');
    // V1 I1 = V2 I2 (ideal), so the common winding carries the difference of the two terminal currents
    near(r.commonWindingCurrent, Math.abs(r.i1 - r.i2), 1e-12);
    const split = ok(autotransformerSplit(r, 0.75, 'leading'));
    assert.ok(split.checks.every(c => c.pass), `${mode} ${n1}:${n2} ${v1}`);
  }
});

test('power factor: P = S·pf, Q = ±S√(1−pf²) (lagging +, leading −), the three parts share it and add up', () => {
  const r = ok(autotransformer({ mode: 'up', turns1: 100, turns2: 5, v1Rms: 240, loadCurrentRms: 4 }));
  const lag = ok(autotransformerSplit(r, 0.8, 'lagging')), lead = ok(autotransformerSplit(r, 0.8, 'leading'));
  near(lag.total.P, 806.4); near(lag.total.Q, 604.8); near(lag.ind.P, 38.4); near(lag.ind.Q, 28.8); near(lag.cond.P, 768); near(lag.cond.Q, 576);
  near(lead.total.Q, -604.8); near(lead.ind.Q, -28.8); near(lead.cond.Q, -576);
  for (const part of [lag.total, lag.ind, lag.cond]) near(part.P / part.S, 0.8, 1e-12, 'every part has the load pf');
  near(lag.cond.P + lag.ind.P, lag.total.P); near(lag.cond.Q + lag.ind.Q, lag.total.Q);
  for (const bad of [0, -0.5, 1.01, NaN]) assert.equal(autotransformerSplit(r, bad, 'lagging').status, 'invalid', 'pf ' + bad);
  assert.equal(autotransformerSplit(r, 0.8, 'sideways').status, 'invalid');
  near(ok(autotransformerSplit(r, 1, 'leading')).total.Q, 0, 1e-12, 'unity pf has no Q either way');
  near(ok(autotransformerSplit(autotransformer({ mode: 'up', turns1: 100, turns2: 5, v1Rms: 240, loadCurrentRms: 0 }), 0.9, 'lagging')).total.S, 0);
});

test('tool: pf and its kind are inputs of the autotransformer view only; the result carries the split table, metrics and values', () => {
  const base = initialValues(def);
  assert.equal(base.autoPF, 1); assert.equal(base.autoPFKind, 'lagging');
  const shownIn = mode => def.fields.filter(f => ['autoPF', 'autoPFKind'].includes(f.key) && (!f.showIf || f.showIf({ ...base, mode })));
  assert.equal(shownIn('auto').length, 2);
  for (const mode of ['ideal', 'rating', 'bank']) assert.equal(shownIn(mode).length, 0, mode);
  const down = ok(evaluateTool(def, auto({ autoMode: 'down', autoN1: 100, autoN2: 100, autoV1: 240, autoI2: 10, autoPF: 0.8 }), 'rms'));
  near(down.values.Scond, 600); near(down.values.Sind, 600); near(down.values.Pind, 480); near(down.values.Pcond, 480); near(down.values.Ptotal, 960); near(down.values.Qtotal, 720); near(down.values.Icommon, 5);
  const table = down.tables.find(t => /전력 분배/.test(t.title));
  assert.ok(table && /0\.8 지상/.test(table.title));
  assert.deepEqual(table.rows.map(row => row[0]), ['전도로 전달 (직접 연결)', '유도로 전달 (자기결합)', '합 = 부하']);
  assert.equal(table.rows[2][4], '100 %'); assert.equal(table.rows[0][4], '50 %');
  assert.ok(down.metrics.some(m => /S_전도/.test(m.label)) && down.metrics.some(m => /공통 권선 전류/.test(m.label)));
  assert.ok(down.notes.some(n => /1 − V작은쪽\/V큰쪽/.test(n)));
  assert.ok(down.checks.every(c => c.pass));
  const lead = ok(evaluateTool(def, auto({ autoPF: 0.6, autoPFKind: 'leading' }), 'rms'));
  assert.ok(lead.values.Qtotal < 0 && lead.values.Qind < 0 && lead.values.Qcond < 0, 'leading load: Q < 0 in all three');
  // pf is range-checked as a field: 0 and above 1 are refused by the tool
  assert.equal(evaluateTool(def, auto({ autoPF: 0 })).status, 'invalid');
  assert.equal(evaluateTool(def, auto({ autoPF: 1.2 })).status, 'invalid');
  // the peak display scales amplitude quantities (the common-winding current) but not powers
  const peak = ok(evaluateTool(def, auto({ autoMode: 'down', autoN1: 100, autoN2: 100, autoV1: 240, autoI2: 10, autoPF: 0.8 }), 'peak'));
  near(peak.values.Icommon, 5 * Math.SQRT2, 1e-12); near(peak.values.Scond, 600);
});

test('presets: 13.10 and the step-down check the split numbers (48 VA, 960 VA, 0.2 A), the pf example gives P/Q by hand, and all pass their checks', () => {
  const ex = def.presets.find(p => p.label.startsWith('예제 13.10')), down = def.presets.find(p => p.label.startsWith('단권 강압')), pf = def.presets.find(p => /pf 0\.8/.test(p.label));
  assert.ok(ex && down && pf);
  for (const preset of [ex, down, pf]) {
    const checked = verifyPreset(def, preset);
    assert.equal(checked.status, 'valid', preset.label + ' ' + checked.reason);
    assert.ok(checked.rows.every(row => row.pass), preset.label + ': ' + checked.rows.filter(row => !row.pass).map(row => row.label + ' ' + row.actual).join(', '));
    assert.ok(checked.result.checks.every(c => c.pass));
  }
  assert.ok(ex.expect.some(e => e.key === 'Icommon' && e.value === 0.2) && ex.expect.some(e => e.key === 'Sind' && e.value === 48) && ex.expect.some(e => e.key === 'Scond' && e.value === 960));
  const shown = ok(evaluateTool(def, presetValues(def, pf), 'rms'));
  near(shown.values.Pcond, 768); near(shown.values.Pind, 38.4); near(shown.values.Qtotal, 604.8);
});

test('figure: the common and series windings are named and the winding currents can be written under the coil', () => {
  const down = toolFigure({ kind: 'auto', mode: 'down', note: '공통 권선 |I1−I2| = 5 A · 직렬 권선 5 A' }), up = toolFigure({ kind: 'auto', mode: 'up' });
  assert.match(down, /N1 \(직렬 권선\)/); assert.match(down, /N2 \(공통 권선\)/); assert.match(down, /공통 권선 \|I1−I2\| = 5 A/);
  assert.match(up, /N1 \(공통 권선\)/); assert.match(up, /N2 \(직렬 권선\)/); assert.ok(!/viewBox="0 0 520 254"/.test(up), 'no extra line without a note');
  assert.match(down, /viewBox="0 0 520 254"/);
  assert.match(up, /입력 V1 \(N1\)/); assert.match(up, /출력 V2 \(N1\+N2\)/);
});
