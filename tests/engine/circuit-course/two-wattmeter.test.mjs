// Two-wattmeter method in the extended three-phase tool: W1+W2 = P, √3(W2−W1) = Q, closed forms, negative reading below pf 0.5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getTool } from '../../../src/circuit-course-tools.js';
import { initialValues, evaluateTool, verifyPreset, presetValues } from '../../../src/circuit-course-tool-common.js';

const tool = getTool('three-phase-ext');
const run = patch => evaluateTool(tool, { ...initialValues(tool), wattmeter: 'two', ...patch });
const near = (a, b, tol, what) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, what + ' ' + a + ' ≠ ' + b);
const deg = Math.PI / 180;

test('two-wattmeter: W1+W2 = P, √3(W2−W1) = Q and the closed forms over angles, sources, line impedance and sequence', () => {
  const cases = [
    { zaR: 10, zaX: 8 }, { zaR: 10, zaX: -8 }, { zaR: 3, zaX: 0 }, { zaR: 5, zaX: 8.660254037844386 }, { zaR: 2, zaX: 10 }, { zaR: 2, zaX: -10 },
    { zaR: 12, zaX: 12, loadConnection: 'delta', lineR: 1, lineX: 2 }, { zaR: 10, zaX: 8, sequence: 'acb' }, { zaR: 2, zaX: 10, sequence: 'acb', loadConnection: 'delta' },
    { zaR: 10, zaX: 8, neutral: 'impedance', neutralZR: 1, neutralZX: 1 }, { zaR: 20, zaX: -15, sourceConnection: 'delta', reference: 'Vab', voltage: 330, loadConnection: 'delta' }
  ];
  for (const c of cases) {
    const r = run(c);
    assert.equal(r.status, 'valid', JSON.stringify(c));
    const { W1, W2, Wsum, Wq } = r.values, P = r.values.SloadRe, Q = r.values.SloadIm, theta = Math.atan2(c.zaX, c.zaR);
    const S = Math.hypot(P, Q);
    near(W1 + W2, P, 1e-9 * S, 'W1+W2=P ' + JSON.stringify(c));
    near(Math.sqrt(3) * (W2 - W1), Q, 1e-9 * S, '√3(W2−W1)=Q ' + JSON.stringify(c));
    near(Wsum, P, 1e-9 * S, 'Wsum'); near(Wq, Q, 1e-9 * S, 'Wq');
    // Closed forms from the load angle: V_L·I_L = |S_load| / √3 at the load terminals.
    const VLIL = S / Math.sqrt(3);
    near(W1, VLIL * Math.cos(theta + 30 * deg), 1e-9 * S, 'W1 closed form ' + JSON.stringify(c)); near(W2, VLIL * Math.cos(theta - 30 * deg), 1e-9 * S, 'W2 closed form ' + JSON.stringify(c));
    assert.ok(r.checks.every(k => k.pass), 'all checks pass ' + JSON.stringify(c) + ' ' + JSON.stringify(r.checks.filter(k => !k.pass)));
    assert.ok(r.checks.some(k => /W1 \+ W2 = P/.test(k.label)) && r.checks.some(k => /√3\(W2 − W1\) = Q/.test(k.label)));
  }
});

test('two-wattmeter: concrete numbers (Y load 10+j8, 110 V phase) and the ratio W1/W2 from the angle', () => {
  const r = run({ zaR: 10, zaX: 8 }), Z = Math.hypot(10, 8), I = 110 / Z, VL = 110 * Math.sqrt(3), th = Math.atan2(8, 10);
  near(r.values.W1, VL * I * Math.cos(th + 30 * deg), 1e-6, 'W1'); near(r.values.W2, VL * I * Math.cos(th - 30 * deg), 1e-6, 'W2');
  near(r.values.Wsum, 3 * I * I * 10, 1e-6, 'P = 3 I² R');
  assert.equal(r.values.W2 > r.values.W1, true, 'inductive: W2 (cos(θ−30°)) is the larger one');
  // Capacitive load swaps which one is larger.
  const c = run({ zaR: 10, zaX: -8 });
  near(c.values.W2, VL * I * Math.cos(-th - 30 * deg), 1e-6, 'W2 capacitive'); assert.ok(c.values.W1 > c.values.W2);
  assert.doesNotMatch(r.read, /음수/);
});

test('two-wattmeter: pf < 0.5 gives a negative reading and the read line says so; pf = 0.5 gives a zero reading', () => {
  const lag = run({ zaR: 2, zaX: 10 });
  assert.ok(lag.values.W1 < 0 && lag.values.W2 > 0);
  assert.match(lag.read, /계기[(]W1[)]가 음수/); assert.ok(lag.notes.some(n => /음수/.test(n)));
  const lead = run({ zaR: 2, zaX: -10 });
  assert.ok(lead.values.W2 < 0 && lead.values.W1 > 0); assert.match(lead.read, /계기[(]W2[)]가 음수/);
  const edge = run({ zaR: 5, zaX: 8.660254037844386 });
  near(edge.values.W1, 0, 1e-6, 'W1 at pf 0.5'); assert.doesNotMatch(edge.read, /음수/);
  assert.ok(lag.metrics.some(m => /^W1 \(a선/.test(m.label)) && lag.metrics.some(m => /^W2 \(c선/.test(m.label)));
  // acb swaps which physical line carries which reading.
  assert.ok(run({ zaR: 2, zaX: 10, sequence: 'acb' }).metrics.some(m => /^W1 \(c선/.test(m.label)));
});

test('two-wattmeter: off by default, hidden and ignored for an unbalanced load or the inverse problem; lecture presets verify', () => {
  const base = evaluateTool(tool, initialValues(tool));
  assert.equal(base.values.W1, undefined); assert.ok(!base.metrics.some(m => /^W[12]/.test(m.label)));
  const unbalanced = evaluateTool(tool, { ...initialValues(tool), wattmeter: 'two', balanced: 'no', zbR: 5, zbX: 3, zcR: 4, zcX: 4 });
  assert.equal(unbalanced.status, 'valid'); assert.equal(unbalanced.values.W1, undefined);
  const field = tool.fields.find(f => f.key === 'wattmeter');
  assert.equal(field.showIf({ mode: 'circuit', balanced: 'yes' }), true); assert.equal(field.showIf({ mode: 'circuit', balanced: 'no' }), false); assert.equal(field.showIf({ mode: 'inverse', balanced: 'yes' }), false);
  const wattPresets = tool.presets.filter(p => p.values.wattmeter === 'two');
  assert.equal(wattPresets.length, 2);
  for (const p of wattPresets) { const v = verifyPreset(tool, p); assert.equal(v.status, 'valid'); assert.ok(v.pass, p.label + ' ' + JSON.stringify(v.rows.filter(x => !x.pass))); }
  assert.equal(presetValues(tool, wattPresets[0]).wattmeter, 'two');
});
