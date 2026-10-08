// "내 문제" Ch.12–13 types: coupled coils (two meshes), ideal transformer, balanced three-phase with a line impedance. Textbook results are fixed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBLEM_EXPERIMENT, solveCourseProblem } from '../../../src/circuit-course-problem.js';
import { evaluateExperiment, getExperiment, initialParameters } from '../../../src/circuit-course-registry.js';
import { CHAPTER_KINDS, CHAPTER_KIND_TITLES } from '../../../src/circuit-course-problem-chapters.js';

const base = () => ({ ...initialParameters(PROBLEM_EXPERIMENT), solutionMode: 'numeric', basis: 'rms', sourceAngle: 0 });
const example = label => PROBLEM_EXPERIMENT.examples.find(e => e.label.includes(label)).values;
const solve = over => solveCourseProblem({ ...base(), ...over });
const valid = over => { const r = solve(over); assert.equal(r.status, 'valid', r.reason); return r; };
const near = (actual, expected, rel, label = '') => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected) + 1e-12, `${label} ${actual} vs ${expected}`);
const nearZ = (actual, re, im, tol, label = '') => { near(actual.re, re, tol, label + ' re'); near(actual.im, im, tol, label + ' im'); };
const ang = z => Math.atan2(z.im, z.re) * 180 / Math.PI, mag = z => Math.hypot(z.re, z.im);
const phasor = (r, text) => { const item = r.solution.answers.find(x => x.label.includes(text)); assert.ok(item?.complex, `answer "${text}" in ${r.solution.answers.map(x => x.label).join(' | ')}`); return item.complex; };
const scalar = (r, text) => { const item = r.solution.answers.find(x => x.label.includes(text)); assert.ok(item && Number.isFinite(item.value), `answer "${text}" in ${r.solution.answers.map(x => x.label).join(' | ')}`); return item.value; };
const textbook = (z, m, deg, label, angleTol = 0.02) => { near(mag(z), m, 1.5e-3, label + ' |z|'); assert.ok(Math.abs(ang(z) - deg) <= angleTol, `${label} ∠ ${ang(z)} vs ${deg}`); };

test('the three new types are registered in the problem experiment with their own goal and input fields', () => {
  assert.deepEqual([...CHAPTER_KINDS], ['coupled', 'transformer', 'threeline']);
  const kinds = PROBLEM_EXPERIMENT.parameters.find(p => p.key === 'problemKind').choices.map(c => c[0]);
  for (const kind of CHAPTER_KINDS) { assert.ok(kinds.includes(kind), kind); assert.ok(CHAPTER_KIND_TITLES[kind]); }
  const keys = PROBLEM_EXPERIMENT.parameters.map(p => p.key);
  assert.equal(new Set(keys).size, keys.length, 'parameter keys are unique');
  for (const key of ['coupledGoal', 'xfmrGoal', 'z1R', 'z1X', 'zlR', 'zlX', 'l1', 'l2', 'couplingMode', 'mInd', 'kCoupling', 'dots', 'turnsRatio', 'i2Direction', 'sequence', 'sourceConnection', 'sourceVoltageKind', 'reference', 'lineR', 'lineX']) assert.ok(keys.includes(key), key);
  // each type shows only its own inputs
  const shown = over => PROBLEM_EXPERIMENT.parameters.filter(p => !p.showIf || p.showIf({ ...base(), ...over })).map(p => p.key);
  const coupled = shown({ problemKind: 'coupled' }), transformer = shown({ problemKind: 'transformer' }), line = shown({ problemKind: 'threeline' });
  assert.ok(coupled.includes('l1') && coupled.includes('mInd') && coupled.includes('frequencyHz') && !coupled.includes('turnsRatio') && !coupled.includes('lineR') && !coupled.includes('kCoupling'));
  assert.ok(shown({ problemKind: 'coupled', couplingMode: 'k' }).includes('kCoupling') && !shown({ problemKind: 'coupled', couplingMode: 'k' }).includes('mInd'));
  assert.ok(transformer.includes('turnsRatio') && transformer.includes('i2Direction') && !transformer.includes('frequencyHz') && !transformer.includes('l1'));
  assert.ok(line.includes('lineR') && line.includes('sequence') && line.includes('connection') && line.includes('threeGoal') && !line.includes('z1R') && !line.includes('turnsRatio'));
  assert.ok(!shown({ problemKind: 'single' }).some(k => ['z1R', 'lineR', 'turnsRatio', 'sequence'].includes(k)), 'the old types do not show the new inputs');
});

test('example 13.1 (coupled coils): Z22 = 12+j6, Z_r = 0.6−j0.3, Z_in = 0.6+j0.7, I1 = 13.01∠−49.39° A, I2 = 2.91∠14.04° A', () => {
  const values = example('13.1');
  const currents = valid(values), zin = valid({ ...values, coupledGoal: 'zin' });
  textbook(phasor(currents, '1차 전류'), 13.01, -49.39, 'I1', 0.01); textbook(phasor(currents, '2차 전류'), 2.91, 14.04, 'I2', 0.01);
  nearZ(phasor(zin, 'Z22'), 12, 6, 1e-6, 'Z22'); nearZ(phasor(zin, '반사'), 0.6, -0.3, 1e-6, 'Z_r'); nearZ(phasor(zin, 'Z_in'), 0.6, 0.7, 1e-6, 'Z_in');
  assert.equal(currents.displayKind, 'chapter');
  assert.ok(currents.checks.length >= 3 && currents.checks.every(c => c.pass), currents.checks.map(c => c.label + ' ' + c.actual).join(' | '));
  const labels = currents.solution.steps.map(s => s.label);
  for (const wanted of ['전압 실효값으로 통일', '각주파수와 코일 리액턴스', '메시 방정식 두 줄', '2차 루프 임피던스와 반사 임피던스', '입력 임피던스', '1차 전류', '2차 전류', '전력', '역률과 부호']) assert.ok(labels.includes(wanted), wanted + ' in ' + labels);
  const mesh = currents.solution.steps.find(s => s.label === '메시 방정식 두 줄');
  assert.match(mesh.formula, /\) I1 − jωM I2 = V,\s+− jωM I1/, 'same side: −jωM'); assert.match(mesh.result, /같은 쪽이면 상호 전압항이 −jωM/);
  assert.ok(currents.solution.givens.some(g => g.includes('M=3 H')) && currents.solution.asked === 'currents');
  // power: the coil resistance sits in Z1 and ZL, so P_source = P_Z1 + P_L (here Z1 is a pure capacitor)
  const power = valid({ ...values, coupledGoal: 'power' });
  near(scalar(power, '부하 ZL에서'), 2.9104 ** 2 * 12, 2e-3, 'P_L'); near(scalar(power, '전원 유효전력'), scalar(power, '부하 ZL에서') + scalar(power, 'Z1에서'), 1e-9);
  assert.ok(Math.abs(scalar(power, 'Z1에서')) < 1e-9);
  near(scalar(power, '전원 유효전력'), 12 * 13.0149 * Math.cos(49.39 * Math.PI / 180), 2e-3);
});

test('coupled coils: opposite dots flip I2 and the sign in the mesh equations but not I1, Z_r or Z_in; k instead of M and a peak voltage give the same circuit', () => {
  const values = example('13.1'), same = valid(values), opposite = valid({ ...values, dots: 'opposite' });
  nearZ(phasor(opposite, '1차 전류'), phasor(same, '1차 전류').re, phasor(same, '1차 전류').im, 1e-9, 'I1 does not depend on the dot side');
  nearZ(phasor(opposite, '2차 전류'), -phasor(same, '2차 전류').re, -phasor(same, '2차 전류').im, 1e-9, 'I2 flips');
  assert.match(opposite.solution.steps.find(s => s.label === '메시 방정식 두 줄').formula, /\) I1 \+ jωM I2 = V,\s+\+ jωM I1/);
  assert.match(opposite.solution.steps.find(s => s.label === '메시 방정식 두 줄').result, /반대쪽이면 상호 전압항이 \+jωM/);
  const viaK = valid({ ...values, couplingMode: 'k', kCoupling: 3 / Math.sqrt(30), mInd: null });
  nearZ(phasor(viaK, '1차 전류'), phasor(same, '1차 전류').re, phasor(same, '1차 전류').im, 1e-9, 'k gives M');
  const peak = valid({ ...values, basis: 'peak', voltage: 12 * Math.SQRT2 });
  nearZ(phasor(peak, '2차 전류'), phasor(same, '2차 전류').re, phasor(same, '2차 전류').im, 1e-9, 'peak 12√2 = rms 12');
  assert.ok(peak.solution.steps[0].substitution.includes('/√2'));
  // ω can be given in rad/s: parseProblemQuantity turns "1 rad/s" into Hz; the model uses ω = 2πf
  near(same.frequencyHz, 1 / (2 * Math.PI), 1e-12);
  // example 13.3's numbers (peak 60 V, ω = 4, L1 = 5, L2 = 4, M = 2.5 opposite, Z1 = 10, ZL = −j4): |I1| = 3.905 A peak = 2.761 A rms
  const e133 = valid({ ...base(), problemKind: 'coupled', basis: 'peak', voltage: 60, sourceAngle: 30, frequencyHz: 4 / (2 * Math.PI), z1R: 10, z1X: 0, zlR: 0, zlX: -4, l1: 5, l2: 4, couplingMode: 'M', mInd: 2.5, dots: 'opposite', coupledGoal: 'currents' });
  near(mag(phasor(e133, '1차 전류')) * Math.SQRT2, 3.905, 1e-3, 'example 13.3 |I1| (peak)'); assert.ok(Math.abs(ang(phasor(e133, '1차 전류')) - -19.4) < 0.05);
});

test('example 13.8 (ideal transformer 1:2, dots opposite): Z_r = 5, Z_in = 9−j6, I1 = 11.09∠33.69°, I2 = 5.545∠−146.31°, Vo = 110.9∠−146.31° (= ∠213.69°), 615.4 W in the load', () => {
  const values = example('13.8');
  const zin = valid({ ...values, xfmrGoal: 'zin' }), currents = valid(values), v2 = valid({ ...values, xfmrGoal: 'v2' }), power = valid({ ...values, xfmrGoal: 'power' });
  nearZ(phasor(zin, '반사 임피던스'), 5, 0, 1e-9, 'Z_r'); nearZ(phasor(zin, '입력 임피던스'), 9, -6, 1e-9, 'Z_in');
  textbook(phasor(currents, '1차 전류'), 11.09, 33.69, 'I1', 0.01); textbook(phasor(currents, '2차 전류'), 5.545, -146.31, 'I2', 0.01);
  textbook(phasor(v2, 'V2'), 110.9, -146.31, 'Vo', 0.01); near(mag(phasor(v2, 'V1')), 55.47, 1e-3);
  near(scalar(power, '부하 ZL에서'), 615.4, 1e-3, 'load power'); near(scalar(power, 'Z1에서'), 11.094 ** 2 * 4, 1e-3, 'Z1 loss');
  near(scalar(power, '전원 유효전력'), scalar(power, '부하 ZL에서') + scalar(power, 'Z1에서'), 1e-9);
  near(scalar(power, '전원 무효전력'), -6 * 11.094 ** 2, 1e-3, 'Q of the source (Z1 is capacitive)'); near(scalar(power, '피상전력'), 1330.8, 1e-3, '|S| = 1330.8 VA');
  near(scalar(power, '권선 전력'), 11.094 * 55.47, 2e-3, '|S1| = |S2|');
  assert.ok(currents.checks.every(c => c.pass) && power.checks.every(c => c.pass));
  const labels = currents.solution.steps.map(s => s.label);
  for (const wanted of ['부호 규약', '반사 임피던스', '입력 임피던스', '1차 전류와 1차 전압', '2차 전압·전류', '전력']) assert.ok(labels.includes(wanted), wanted);
  assert.match(currents.solution.steps.find(s => s.label === '부호 규약').formula, /V2\/V1=−n,\s+I2\/I1=−1\/n/, 'dots opposite, I2 out of the load side: −n and −1/n');
  assert.match(zin.solution.steps.find(s => s.label === '반사 임피던스').formula, /Z_r=ZL\/n²/);
  // dots on the same side: V2 = +nV1 and I2 = +I1/n; the "into the + terminal" reference flips I2 only
  const same = valid({ ...values, dots: 'same', xfmrGoal: 'currents' }), inward = valid({ ...values, i2Direction: 'in' });
  textbook(phasor(same, '2차 전류'), 5.545, 33.69, 'I2 (same side dots)', 0.01);
  nearZ(phasor(inward, '2차 전류'), -phasor(currents, '2차 전류').re, -phasor(currents, '2차 전류').im, 1e-9, 'I2 reference flipped');
  nearZ(phasor(inward, '1차 전류'), phasor(currents, '1차 전류').re, phasor(currents, '1차 전류').im, 1e-12);
  assert.match(same.solution.steps.find(s => s.label === '부호 규약').formula, /V2\/V1=\+n,\s+I2\/I1=\+1\/n/);
  // step-down check: n = 0.5 doubles the voltage ratio the other way (Z_r = ZL/n² = 80)
  nearZ(phasor(valid({ ...values, turnsRatio: 0.5, xfmrGoal: 'zin' }), '반사 임피던스'), 80, 0, 1e-9, 'Z_r for n = 1/2');
});

test('example 12.3 (Y source Van = 100∠10°, Δ load 8+j4, abc): I_AB = 19.36∠13.43° A, Ia = 33.53∠−16.57° A', () => {
  const values = example('12.3');
  const phase = valid(values), line = valid({ ...values, threeGoal: 'line-current' }), voltage = valid({ ...values, threeGoal: 'phase-voltage' });
  textbook(phasor(phase, 'I_AB'), 19.36, 13.43, 'I_AB', 0.02); textbook(phasor(line, 'Ia'), 33.53, -16.57, 'Ia', 0.02);
  near(mag(phasor(voltage, 'V_AB')), 100 * Math.sqrt(3), 1e-9, 'V_AB = √3·Van'); assert.ok(Math.abs(ang(phasor(voltage, 'V_AB')) - 40) < 1e-6, 'Vab leads Van by 30°');
  near(mag(phasor(line, 'Ia')), Math.sqrt(3) * mag(phasor(phase, 'I_AB')), 1e-9, 'I_L = √3 I_φ');
  assert.equal(phase.displayKind, 'chapter'); assert.ok(phase.checks.every(c => c.pass), phase.checks.map(c => c.label + ' ' + c.actual).join(' | '));
  const labels = phase.solution.steps.map(s => s.label);
  for (const wanted of ['선간·상전압과 기준', 'Δ 부하를 Y로 바꾸기', '한 상 등가회로', '다른 두 선전류', 'Δ 부하의 상전류·상전압', '전력']) assert.ok(labels.includes(wanted), wanted + ' in ' + labels);
  assert.match(phase.solution.steps.find(s => s.label === 'Δ 부하를 Y로 바꾸기').formula, /Z_Y=Z_Δ\/3/);
});

test('example 12.2 (Y–Y, Van = 110, line 5−j2, load 10+j8): Ia = 6.81∠−21.8°; example 12.5 (Δ source 210 V line, Y load 40+j25): Ia = 2.57∠−62.01°; acb swaps the 120° shifts', () => {
  const yy = { ...base(), problemKind: 'threeline', voltage: 110, sourceVoltageKind: 'phase', sourceConnection: 'Y', reference: 'Van', sequence: 'abc', connection: 'Y', r: 10, x: 8, lineR: 5, lineX: -2, threeGoal: 'line-current' };
  const r = valid(yy);
  textbook(phasor(r, 'Ia'), 6.81, -21.8, 'Ia', 0.05); textbook(phasor(r, 'Ib'), 6.81, -141.8, 'Ib', 0.05); textbook(phasor(r, 'Ic'), 6.81, 98.2, 'Ic', 0.05);
  const acb = valid({ ...yy, sequence: 'acb' });
  assert.ok(Math.abs(ang(phasor(acb, 'Ib')) - (ang(phasor(acb, 'Ia')) + 120)) < 1e-9, 'acb: Ib leads Ia by 120°');
  near(mag(phasor(acb, 'Ia')), mag(phasor(r, 'Ia')), 1e-12);
  const deltaSource = valid({ ...yy, voltage: 210, sourceVoltageKind: 'line', sourceConnection: 'delta', reference: 'Vab', connection: 'Y', r: 40, x: 25, lineR: 0, lineX: 0 });
  textbook(phasor(deltaSource, 'Ia'), 2.57, -62.01, 'Ia (12.5)', 0.05);
  // the line impedance is optional: an empty field is no line, and it equals an explicit 0
  near(mag(phasor(valid({ ...yy, lineR: null, lineX: null }), 'Ia')), mag(phasor(valid({ ...yy, lineR: 0, lineX: 0 }), 'Ia')), 1e-12);
  // power: load P = 3|I|² R_Y, source P = load + line loss, pf = cos(arg Z)
  const power = valid({ ...yy, threeGoal: 'power' }), I = 110 / Math.hypot(15, 6); // |Ia| = Van/|Zℓ + Z|
  near(scalar(power, '부하 총 유효전력'), 3 * I ** 2 * 10, 1e-9, 'P load'); near(scalar(power, '선로 손실'), 3 * I ** 2 * 5, 1e-9, 'line loss');
  near(scalar(power, '전원 총 유효전력'), scalar(power, '부하 총 유효전력') + scalar(power, '선로 손실'), 1e-9);
  near(scalar(power, '부하 총 피상전력'), 3 * I ** 2 * Math.hypot(10, 8), 1e-9);
  const pf = valid({ ...yy, threeGoal: 'pf' }); near(scalar(pf, '역률'), 10 / Math.hypot(10, 8), 1e-9); near(scalar(pf, '위상차'), Math.atan2(8, 10) * 180 / Math.PI, 1e-9);
});

test('three-phase with a line impedance equals the old three-phase type when Zℓ = 0 (same line voltage, same Vab reference)', () => {
  const old = valid({ ...base(), problemKind: 'three', voltage: 400, voltageKnown: 'line', sourceAngle: 30, r: 8, x: 6, connection: 'Y', frequencyHz: null, threeGoal: 'line-current' });
  const next = valid({ ...base(), problemKind: 'threeline', voltage: 400, sourceVoltageKind: 'line', sourceConnection: 'Y', reference: 'Vab', sourceAngle: 30, sequence: 'abc', connection: 'Y', r: 8, x: 6, lineR: 0, lineX: 0, threeGoal: 'line-current' });
  for (const name of ['Ia', 'Ib', 'Ic']) { const o = phasor(old, name), c = phasor(next, name); nearZ(c, o.re, o.im, 1e-9, name); }
  const oldDelta = valid({ ...base(), problemKind: 'three', voltage: 400, voltageKnown: 'line', sourceAngle: 30, r: 8, x: 6, connection: 'delta', frequencyHz: null, threeGoal: 'phase-current' });
  const nextDelta = valid({ ...base(), problemKind: 'threeline', voltage: 400, sourceVoltageKind: 'line', sourceConnection: 'Y', reference: 'Vab', sourceAngle: 30, sequence: 'abc', connection: 'delta', r: 8, x: 6, lineR: 0, lineX: 0, threeGoal: 'phase-current' });
  nearZ(nextDelta.solution.answers[0].complex, oldDelta.solution.answers[0].complex.re, oldDelta.solution.answers[0].complex.im, 1e-9, 'I_AB');
});

test('the textbook examples run through the experiment (evaluateExperiment validates the shown inputs) and every check passes', () => {
  for (const label of ['13.1', '13.8', '12.3']) {
    const values = example(label), r = evaluateExperiment('problem', { ...initialParameters(getExperiment('problem')), ...values });
    assert.equal(r.status, 'valid', label + ' ' + r.reason);
    assert.ok(r.solution.statement.includes('교재 예제 ' + label) && r.checks.every(c => c.pass) && r.solution.steps.length >= 6, label);
    assert.ok(r.power && r.phasors.length >= 4, label + ': power card and phasor graph data');
  }
  assert.equal(PROBLEM_EXPERIMENT.examples.length, 5);
});

test('bad input is refused with a reason (nothing is corrected): missing or out-of-range values, impossible couplings, zero impedances', () => {
  const coupled = example('13.1'), xfmr = example('13.8'), line = example('12.3');
  const refused = (over, pattern, what) => { const r = solve(over); assert.equal(r.status, 'invalid', what); assert.match(r.reason, pattern, what); };
  refused({ ...coupled, mInd: null }, /M|상호|조건/, 'M missing');
  refused({ ...coupled, mInd: 6 }, /M은 √|k≤1|√\(L1/, 'M above √(L1 L2)');
  refused({ ...coupled, couplingMode: 'k', kCoupling: 1.2 }, /결합계수|k/, 'k above 1');
  refused({ ...coupled, l1: 0 }, /L1/, 'L1 = 0');
  refused({ ...coupled, frequencyHz: null }, /주파수|f/, 'no frequency');
  refused({ ...coupled, z1R: -1 }, /Z1|허용 범위/, 'negative resistance');
  refused({ ...coupled, voltage: 0 }, /전압/, 'no source');
  refused({ ...coupled, coupledGoal: 'everything' }, /구할 값/, 'unknown goal');
  refused({ ...coupled, dots: 'sideways' }, /점 위치/, 'unknown dots');
  refused({ ...xfmr, turnsRatio: null }, /권수비/, 'n missing');
  refused({ ...xfmr, turnsRatio: 0 }, /권수비/, 'n = 0');
  refused({ ...xfmr, turnsRatio: -2 }, /권수비/, 'n < 0');
  refused({ ...xfmr, i2Direction: 'up' }, /I2 기준/, 'unknown I2 direction');
  refused({ ...xfmr, z1R: 0, z1X: 0, zlR: 0, zlX: 0 }, /0|임피던스|특이/, 'Z1 + ZL/n² = 0');
  refused({ ...line, r: 0, x: 0 }, /\|Z\|=0|부하/, 'zero load impedance');
  refused({ ...line, sequence: 'cab' }, /상순서/, 'unknown sequence');
  refused({ ...line, lineR: -1 }, /Zℓ|허용 범위/, 'negative line resistance');
  refused({ ...line, voltage: null }, /전압/, 'no voltage');
  refused({ ...line, connection: 'star' }, /부하 결선/, 'unknown connection');
  refused({ ...line, basis: 'mean' }, /진폭 기준/, 'unknown basis');
  // the symbolic method does not exist for these types: a clear message, no stack of errors
  for (const values of [coupled, xfmr, line]) { const r = solve({ ...values, solutionMode: 'symbolic' }); assert.equal(r.status, 'unsupported'); assert.match(r.reason, /문자식 풀이가 없습니다/); }
  const viaExperiment = evaluateExperiment('problem', { ...initialParameters(getExperiment('problem')), ...coupled, solutionMode: 'symbolic' });
  assert.notEqual(viaExperiment.status, 'valid');
  // the old types still say what they said
  assert.equal(solve({ problemKind: 'arbitrary' }).status, 'invalid');
});
