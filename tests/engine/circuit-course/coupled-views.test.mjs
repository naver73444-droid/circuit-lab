// Coupled-coil tool: the three views (회로 풀이 / T/π 등가 / 에너지), the reflected impedance of Ch.13.3, and the energy form with its k ≤ 1 limit.
// Numbers are derived here from the textbook formulas, not read back from the module under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coupledCoils, coupledEquivalents, coupledEnergy } from '../../../src/circuit-course-coupled.js';
import { getTool } from '../../../src/circuit-course-tools.js';
import { evaluateTool, initialValues, presetValues, verifyPreset, dataFields, isShown } from '../../../src/circuit-course-tool-common.js';
import { createCourseTool } from '../../../src/circuit-course-tool-controller.js';
import { magnitude, multiply, divide, add, sub } from '../../../src/circuit-course-model.js';

const near = (actual, expected, tolerance = 1e-9, what = '') => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, what + ' ' + actual + ' ≠ ' + expected + ' ± ' + tolerance);
const z = (re, im) => ({ re, im });
const zn = (a, b, tol = 1e-9, what = '') => { near(a.re, b.re, tol, what + ' re'); near(a.im, b.im, tol, what + ' im'); };
const ok = r => { assert.equal(r.status, 'valid', r.reason); return r; };
const def = getTool('coupled');
const shownKeys = values => dataFields(def).filter(f => isShown(f, values)).map(f => f.key);

// Zin = Z1 + jωL1 + ω²M²/Z22, with the second mesh solved by hand (Cramer on the two mesh equations) instead of the reflected-impedance route.
function textbookZin({ w, l1, l2, m, s, z1, zl }) {
  const a11 = add(z1, z(0, w * l1)), a22 = add(zl, z(0, w * l2)), a12 = z(0, -s * w * m);
  return { z22: a22, byMesh: sub(a11, divide(multiply(a12, a12), a22)), byReflection: add(add(z1, z(0, w * l1)), divide(z(w * w * m * m, 0), a22)) };
}

test('reflected impedance (13.3): example 13.1 gives Z22 = 12+j6, ZR = 0.6−j0.3, Zin = 0.6+j0.7, and Zin = Z1 + jωL1 + ZR equals the mesh-equation input impedance', () => {
  const p = { w: 1, l1: 5, l2: 6, m: 3, s: 1, z1: z(0, -4), zl: z(12, 0) };
  const hand = textbookZin(p);
  zn(hand.z22, z(12, 6), 1e-12, 'Z22'); zn(hand.byMesh, z(0.6, 0.7), 1e-12, 'Zin by the mesh equations'); zn(hand.byReflection, z(0.6, 0.7), 1e-12, 'Zin by reflection');
  const r = ok(coupledCoils({ frequencyHz: 1 / (2 * Math.PI), l1: 5, l2: 6, m: 3, dots: 'same', z1: p.z1, zl: p.zl, voltageRms: 12, voltageDeg: 0 }));
  zn(r.z22, z(12, 6), 1e-9, 'model Z22'); zn(r.reflected, z(0.6, -0.3), 1e-9, 'model ZR'); zn(r.zin, hand.byMesh, 1e-9, 'model Zin');
  near(magnitude(divide(z(12, 0), r.zin)), 13.01, 1e-2, '|I1| = |V/Zin|');
  // the tool reports the same numbers and shows them in the explicit steps table
  const preset = def.presets[0], shown = ok(evaluateTool(def, presetValues(def, preset), 'rms'));
  near(shown.values.Z22R, 12, 1e-9); near(shown.values.Z22X, 6, 1e-9); near(shown.values.ZRR, 0.6, 1e-9); near(shown.values.ZRX, -0.3, 1e-9); near(shown.values.ZinR, 0.6, 1e-9); near(shown.values.ZinX, 0.7, 1e-9);
  const steps = shown.tables.find(t => t.title === '반사 임피던스 → 입력 임피던스');
  assert.ok(steps, 'the circuit view carries the reflected-impedance steps');
  assert.deepEqual(steps.rows.map(row => row[0]).slice(0, 5), ['2차 루프 Z22', '(ωM)²', '반사 임피던스 ZR', '1차 루프 Z11', '입력 임피던스 Zin']);
  assert.ok(shown.notes.some(n => /ZR = ω²M²\/Z22/.test(n)));
  assert.ok(shown.checks.every(c => c.pass) && shown.checks.some(c => /메시 방정식/.test(c.label)), 'the mesh-equation residual check is part of the checks');
});

test('reflected impedance: example 13.3 (ω=4, L1=5, L2=4, M=2.5, Z1=10, ZL=−j4): Z22 = j12, ZR = −j8.333, Zin = 10 + j11.667, |I1| = 60/|Zin| = 3.905 A (peak)', () => {
  const hand = textbookZin({ w: 4, l1: 5, l2: 4, m: 2.5, s: -1, z1: z(10, 0), zl: z(0, -4) });
  zn(hand.z22, z(0, 12), 1e-12); zn(hand.byMesh, z(10, 35 / 3), 1e-9); zn(hand.byReflection, z(10, 35 / 3), 1e-9);
  const shown = ok(evaluateTool(def, presetValues(def, def.presets[1]), 'peak'));
  near(shown.values.ZRR, 0, 1e-9); near(shown.values.ZRX, -25 / 3, 1e-9); near(shown.values.ZinR, 10, 1e-9); near(shown.values.ZinX, 35 / 3, 1e-9);
  near(shown.values.I1Mag, 60 / Math.hypot(10, 35 / 3), 1e-9, '|I1| peak');
});

test('the view decides what is shown: inputs are hidden, not dropped; each view evaluates from its own inputs only', () => {
  const base = initialValues(def);
  assert.equal(base.view, 'circuit');
  const circuit = shownKeys({ ...base, view: 'circuit' }), tpi = shownKeys({ ...base, view: 'tpi' }), direct = shownKeys({ ...base, view: 'energy', energySource: 'direct' }), fromCircuit = shownKeys({ ...base, view: 'energy', energySource: 'circuit' });
  for (const key of ['omega', 'voltage', 'voltageDeg', 'z1R', 'z1X', 'zlR', 'zlX', 'i2Ref']) assert.ok(circuit.includes(key), 'circuit view shows ' + key);
  for (const key of ['timeSec', 'i1', 'i2', 'energySource']) assert.ok(!circuit.includes(key), 'circuit view hides ' + key);
  assert.deepEqual(tpi, ['view', 'l1', 'l2', 'couplingMode', 'm', 'dots'], 'T/π view: only the coils and the dots');
  assert.deepEqual(direct, ['view', 'energySource', 'l1', 'l2', 'couplingMode', 'm', 'dots', 'i2Ref', 'i1', 'i2'], 'energy view with typed currents');
  for (const key of ['omega', 'voltage', 'z1R', 'zlX', 'timeSec']) assert.ok(fromCircuit.includes(key), 'energy-from-circuit shows ' + key);
  assert.ok(!fromCircuit.includes('i1') && !fromCircuit.includes('i2'));
  // k instead of M swaps one field in every view
  assert.ok(shownKeys({ ...base, view: 'tpi', couplingMode: 'k' }).includes('k') && !shownKeys({ ...base, view: 'tpi', couplingMode: 'k' }).includes('m'));
  // The T/π and the energy view do not need the circuit: a load that would make Z22 = 0 (ZL = −jωL2) only breaks the circuit view.
  const broken = { ...base, zlR: 0, zlX: -16, omega: 4 };
  assert.equal(evaluateTool(def, { ...broken, view: 'circuit' }).status, 'invalid');
  assert.equal(evaluateTool(def, { ...broken, view: 'tpi' }).status, 'valid');
  assert.equal(evaluateTool(def, { ...broken, view: 'energy', energySource: 'direct' }).status, 'valid');
  // what each view puts on screen
  const c = ok(evaluateTool(def, base)), t = ok(evaluateTool(def, { ...base, view: 'tpi' })), e = ok(evaluateTool(def, { ...base, view: 'energy' }));
  assert.ok(c.phasors?.length && c.traces?.length === 2 && !c.tables.some(x => /등가/.test(x.title)), 'circuit view: phasors, i1/i2 graphs, no T/π tables');
  assert.deepEqual(t.tables.map(x => x.title), ['T 등가 (La, Lb, Lc)', 'π 등가', '직렬 연결']);
  assert.ok(!t.phasors && !t.traces, 'T/π view: no graphs');
  assert.ok(!e.phasors && !e.traces && e.tables.length === 1, 'energy view with typed currents: one table, no graphs');
  const timed = ok(evaluateTool(def, { ...base, view: 'energy', energySource: 'circuit' }));
  assert.deepEqual(timed.traces.map(x => x.label), ['i1(t)', 'i2(t)', 'w(t)']);
});

test('T/π view: example 13.5 (L1=10, L2=4, M=2) gives T = 8·2·2 H and π = 18·4.5·18 H from the coils alone; the π check (one port shorted) passes, also with an open branch and opposite dots', () => {
  const shown = ok(evaluateTool(def, presetValues(def, def.presets[2]), 'rms'));
  near(shown.values.La, 8); near(shown.values.Lb, 2); near(shown.values.Lc, 2); near(shown.values.LA, 18); near(shown.values.LB, 4.5); near(shown.values.LC, 18);
  assert.ok(shown.checks.length === 3 && shown.checks.every(c => c.pass), shown.checks.map(c => c.label + ' ' + c.actual).join(' | '));
  for (const p of [{ l1: 4, l2: 1, m: 1, dots: 'same' }, { l1: 4, l2: 1, m: 1, dots: 'opposite' }, { l1: 5, l2: 4, m: 2.5, dots: 'opposite' }, { l1: 7, l2: 3, m: 4, dots: 'same' }]) {
    const r = ok(coupledEquivalents(p));
    assert.ok(r.checks.every(c => c.pass), JSON.stringify(p) + ' ' + r.checks.map(c => c.label + ' ' + c.actual).join(' | '));
  }
  assert.equal(ok(coupledEquivalents({ l1: 4, l2: 1, m: 1, dots: 'same' })).pi.LA, Infinity, 'open branch stays ∞');
  assert.equal(ok(coupledEquivalents({ l1: 2, l2: 2, m: 2, dots: 'same' })).pi, null, 'k = 1: no π equivalent');
  assert.equal(coupledEquivalents({ l1: 2, l2: 2, m: 3, dots: 'same' }).status, 'invalid', 'M above √(L1L2) is refused');
});

test('energy: w = ½L1 i1² + ½L2 i2² ± M i1 i2 by hand (5, 4, 2 H; 2 A, 3 A → 10 + 18 ± 12), sign set by the dots and the I2 reference', () => {
  const base = { l1: 5, l2: 4, m: 2, i1: 2, i2: 3 };
  // into the top terminals: dots same → fluxes add; dots opposite → fluxes subtract
  near(ok(coupledEnergy({ ...base, dots: 'same', i2Ref: 'into' })).w, 40);
  near(ok(coupledEnergy({ ...base, dots: 'opposite', i2Ref: 'into' })).w, 16);
  // clockwise mesh currents flip the rule
  near(ok(coupledEnergy({ ...base, dots: 'same', i2Ref: 'loop' })).w, 16);
  near(ok(coupledEnergy({ ...base, dots: 'opposite', i2Ref: 'loop' })).w, 40);
  // reversing one current is the same as the other reference
  near(ok(coupledEnergy({ ...base, dots: 'same', i2Ref: 'into' })).w, ok(coupledEnergy({ ...base, dots: 'same', i2Ref: 'loop', i2: -3 })).w);
  const r = ok(coupledEnergy({ ...base, dots: 'same', i2Ref: 'into' }));
  near(r.self1, 10); near(r.self2, 18); near(r.mutual, 12); near(r.k, 2 / Math.sqrt(20), 1e-12);
  assert.ok(r.checks.every(c => c.pass));
  assert.equal(coupledEnergy({ ...base, m: 3, dots: 'same', i2Ref: 'into' }).status, 'valid', 'M=3 < √20 ≈ 4.47 (k ≈ 0.67) is an ordinary coupling');
  assert.equal(coupledEnergy({ ...base, m: 5, dots: 'same', i2Ref: 'into' }).status, 'invalid', 'M=5 > √(L1L2) ≈ 4.47 (k > 1) would allow w < 0: refused');
  assert.equal(coupledEnergy({ ...base, dots: 'same', i2Ref: 'sideways' }).status, 'invalid');
  assert.equal(coupledEnergy({ ...base, dots: 'same', i2Ref: 'into', i1: NaN }).status, 'invalid');
});

test('energy: never negative for k ≤ 1 over a grid of currents, and exactly 0 at k = 1 when i2/i1 = −σ√(L1/L2)', () => {
  for (const [l1, l2, m] of [[5, 4, 2], [5, 4, Math.sqrt(20)], [4, 1, 2], [1, 9, 0.3]]) for (const dots of ['same', 'opposite']) for (const i2Ref of ['loop', 'into']) {
    for (let i1 = -3; i1 <= 3; i1 += 0.5) for (let i2 = -3; i2 <= 3; i2 += 0.5) {
      const r = ok(coupledEnergy({ l1, l2, m, dots, i2Ref, i1, i2 }));
      assert.ok(r.w >= -1e-12 * (r.self1 + r.self2 + 1), `w=${r.w} for L=${l1},${l2} M=${m} ${dots} ${i2Ref} i=${i1},${i2}`);
      assert.ok(r.checks.every(c => c.pass), 'checks at ' + [l1, l2, m, dots, i2Ref, i1, i2]);
    }
  }
  const unit = ok(coupledEnergy({ l1: 4, l2: 1, m: 2, dots: 'same', i2Ref: 'into', i1: 1, i2: -2 }));
  near(unit.w, 0, 1e-12); near(unit.zeroRatio, -2, 1e-12);
  assert.equal(ok(coupledEnergy({ l1: 5, l2: 4, m: 2, dots: 'same', i2Ref: 'into', i1: 1, i2: 1 })).zeroRatio, null, 'k < 1 has no zero-energy ratio');
});

test('energy from the solved circuit (w(t)) equals the typed-current formula fed with i1(t), i2(t), in both I2 references', () => {
  for (const dots of ['same', 'opposite']) {
    const r = ok(coupledCoils({ frequencyHz: 4 / (2 * Math.PI), l1: 5, l2: 4, m: 2.5, dots, z1: z(10, 0), zl: z(0, -4), voltageRms: 60 / Math.SQRT2, voltageDeg: 30 }));
    for (const t of [0, 0.123, 0.5, 1]) {
      const i1 = r.current(r.I1, t), loop = r.current(r.I2, t);
      near(ok(coupledEnergy({ l1: 5, l2: 4, m: 2.5, dots, i2Ref: 'loop', i1, i2: loop })).w, r.energy(t), 1e-9, dots + ' loop t=' + t);
      near(ok(coupledEnergy({ l1: 5, l2: 4, m: 2.5, dots, i2Ref: 'into', i1, i2: -loop })).w, r.energy(t), 1e-9, dots + ' into t=' + t);
    }
  }
  const shown = ok(evaluateTool(def, presetValues(def, def.presets[1]), 'peak')), timed = ok(evaluateTool(def, { ...presetValues(def, def.presets[1]), view: 'energy', energySource: 'circuit' }, 'peak'));
  near(timed.values.w, shown.values.w, 1e-12, 'the same w(1 s) = 20.73 J');
  near(timed.values.w, 20.73, 2e-2, 'textbook w(1 s)');
});

test('presets: each one opens its own view and passes its checks; the three energy examples reproduce 40 J, 16 J and 0 J', () => {
  const views = def.presets.map(p => p.values.view);
  assert.deepEqual(views.slice(0, 4), ['circuit', 'circuit', 'tpi', 'circuit'], '13.1 and 13.3 solve the circuit, 13.5 is the T/π view, 13.6 needs the currents');
  assert.deepEqual(views.slice(4), ['energy', 'energy', 'energy']);
  for (const preset of def.presets) {
    const checked = verifyPreset(def, preset);
    assert.equal(checked.status, 'valid', preset.label + ' ' + checked.reason);
    assert.ok(checked.rows.length > 0 && checked.rows.every(row => row.pass), preset.label + ': ' + checked.rows.filter(row => !row.pass).map(row => row.label + ' ' + row.actual).join(', '));
    assert.ok(checked.result.checks.every(c => c.pass), preset.label + ' checks');
  }
});

// ---- the segment buttons through the tool controller (minimal fake DOM, no browser) ----------------------------------------------
function fakeElement(extra = {}) {
  const el = { dataset: {}, hidden: false, textContent: '', value: '', attrs: {}, children: new Map(), setAttribute(k, v) { el.attrs[k] = v; }, removeAttribute(k) { delete el.attrs[k]; },
    querySelector(sel) { return el.children.get(sel) ?? null; }, querySelectorAll() { return []; }, innerHTML: '', ...extra };
  return el;
}
function openCoupled() {
  const listeners = {}, host = fakeElement({ ownerDocument: { activeElement: null }, addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {}, contains: () => true, replaceChildren() {} });
  for (const f of def.fields) {
    const row = fakeElement(), input = fakeElement({ dataset: { ccKey: f.key } });
    row.children.set('[data-cc-label]', fakeElement()); row.children.set('[data-cc-key]', input); row.children.set('[data-cc-error]', fakeElement());
    if (f.slider) row.children.set('[data-cc-slider]', fakeElement({ dataset: { ccSlider: f.key } }));
    host.children.set('[data-cc-field="' + f.key + '"]', row); host.children.set('[data-cc-key="' + f.key + '"]', input);
  }
  host.children.set('[data-cc-results]', fakeElement()); host.children.set('[data-cc-status]', fakeElement());
  const tool = createCourseTool(host, def, { getBasis: () => 'rms', setBasis() {} });
  const segment = (key, choice) => { const button = { dataset: { ccSegment: key, ccChoice: choice }, closest: sel => (sel === '[data-cc-segment]' ? button : null) }; listeners.click({ target: button }); };
  const type = (key, value) => listeners.input({ target: { dataset: { ccKey: key }, value, tagName: 'INPUT' } });
  return { tool, segment, type };
}

test('segment buttons switch the view through the tool: values are shared, the T/π and energy views compute at once, the current button does nothing', () => {
  const t = openCoupled();
  assert.equal(t.tool.inspect().values.view, 'circuit');
  assert.ok('I1Mag' in t.tool.inspect().outputs);
  t.segment('view', 'tpi');
  let now = t.tool.inspect();
  assert.equal(now.values.view, 'tpi'); assert.equal(now.status, 'valid');
  near(now.outputs.La, 5 + 2.5, 1e-12, 'dots opposite by default: La = L1 + M'); near(now.outputs.Lc, -2.5, 1e-12); assert.ok(!('I1Mag' in now.outputs), 'T/π view has no currents');
  assert.equal(now.values.l1, 5, 'the coil values carry over');
  t.segment('view', 'energy');
  now = t.tool.inspect();
  assert.equal(now.values.view, 'energy'); assert.equal(now.status, 'valid');
  // defaults: L1=5, L2=4, M=2.5, i1=2, i2=3, dots opposite, clockwise mesh currents → the fluxes add (+M i1 i2 = +15 J)
  near(now.outputs.self1, 10); near(now.outputs.self2, 18); near(now.outputs.mutual, 15); near(now.outputs.w, 43);
  t.segment('view', 'nonsense');
  assert.equal(t.tool.inspect().values.view, 'energy', 'an unknown choice is refused');
  // the current button leaves a preset's verification in place; a real change drops it
  t.tool.applyPreset(4);
  assert.equal(t.tool.inspect().activePreset, 4);
  assert.equal(t.tool.inspect().values.view, 'energy');
  t.segment('view', 'energy');
  assert.equal(t.tool.inspect().activePreset, 4, 'pressing the shown view again changes nothing');
  assert.ok(t.tool.inspect().verification.every(row => row.pass));
  t.segment('view', 'circuit');
  assert.equal(t.tool.inspect().activePreset, -1);
});

test('presets switch the view by themselves: 13.5 → T/π, the energy examples → 에너지, 13.1 → 회로 풀이, and their verification passes', () => {
  const t = openCoupled();
  for (const [index, view] of [[2, 'tpi'], [4, 'energy'], [0, 'circuit'], [5, 'energy'], [6, 'energy'], [1, 'circuit'], [3, 'circuit']]) {
    t.tool.applyPreset(index);
    const now = t.tool.inspect();
    assert.equal(now.values.view, view, 'preset ' + index);
    assert.equal(now.status, 'valid');
    assert.ok(now.verification.length > 0 && now.verification.every(row => row.pass), 'preset ' + index + ' verification');
  }
});

test('a bad draft in a field that the new view hides does not block the view switch', () => {
  const t = openCoupled();
  t.type('zlR', 'abc');
  assert.ok(t.tool.inspect().errors.zlR, 'the load field complains in the circuit view');
  t.segment('view', 'tpi');
  const now = t.tool.inspect();
  assert.deepEqual(now.errors, {}, 'the T/π view does not show the load, so its error is gone');
  assert.equal(now.values.view, 'tpi'); assert.equal(now.status, 'valid'); assert.equal(now.values.zlR, 0, 'the stored value is untouched');
  assert.equal(now.drafts.zlR, '0', 'and the hidden draft is rewritten from it');
  // a bad draft in a field that stays visible still blocks
  t.type('l1', 'x');
  assert.ok(t.tool.inspect().errors.l1);
  t.segment('view', 'energy');
  assert.ok(t.tool.inspect().errors.l1, 'L1 is shown in every view, so its error stays');
  assert.equal(t.tool.inspect().values.view, 'energy');
});
