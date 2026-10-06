// Regressions found by the cross review of the course tools (transformer power, max-power curves, ideal ZL=0, 3-phase resonance,
// stale example state, peak-basis range, π open branch). Closed forms are written out here, not taken from the modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getTool } from '../../../src/circuit-course-tools.js';
import { initialValues, evaluateTool, verifyPreset } from '../../../src/circuit-course-tool-common.js';
import { idealTransformer, tPiEquivalents } from '../../../src/circuit-course-coupled.js';
import { solveThreePhase } from '../../../src/circuit-course-threephase.js';
import { maxPowerTransfer, powerAt } from '../../../src/circuit-course-maxpower.js';
import { EXPERIMENTS, getExperiment, initialParameters, evaluateExperiment, verifyExample, draftsOf, exampleDrafts } from '../../../src/circuit-course-registry.js';
import { parseCourseNumber } from '../../../src/circuit-course-format.js';
import { magnitude, multiply, divide, sub } from '../../../src/circuit-course-model.js';

const near = (actual, expected, tol = 1e-9, what = '') => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tol, what + ' ' + actual + ' ≠ ' + expected + ' ± ' + tol);
const z = (re, im) => ({ re, im });
const ang = w => Math.atan2(w.im, w.re) * 180 / Math.PI;
const ok = r => { assert.equal(r.status, 'valid', r.reason); return r; };
const addAll = list => list.reduce((a, b) => ({ re: a.re + b.re, im: a.im + b.im }), z(0, 0));

test('변압기 도구: 권선 전력 S1=S2 와 전원 S 를 따로 보인다 (예제 13.8: 615.38 W vs 1331∠−33.69° VA)', () => {
  const def = getTool('transformer'), preset = def.presets.find(p => p.label.startsWith('예제 13.8'));
  const checked = verifyPreset(def, preset);
  assert.ok(checked.pass, JSON.stringify(checked.rows.filter(r => !r.pass)));
  const r = checked.result, label = text => r.metrics.find(m => m.label.includes(text));
  assert.ok(label('권선 S1=S2'), '권선 항목이 있다');
  assert.ok(label('전원 S'), '전원 S 는 별도 항목이다');
  assert.match(label('권선 S1=S2').text, /^615\.4∠0°$/);
  assert.match(label('전원 S').text, /^1331∠-33\.69°$/);
  assert.ok(!r.metrics.some(m => m.label.startsWith('S1=S2 (소스')), '옛 항목(소스 전력을 S1=S2 로 표기)이 남지 않는다');
  // closed form: S1 = |I1|² ZL/n² with I1 = 120/(9−j6), n=2, ZL=20
  const i1 = 120 / Math.hypot(9, 6);
  near(r.values.S1Mag, i1 * i1 * 5, 1e-9); near(r.values.S1Ang, 0, 1e-9); near(r.values.S2Mag, r.values.S1Mag, 1e-9);
  near(r.values.SMag, i1 * 120, 1e-9);
});

test('최대전력 곡선: 각 곡선의 최대점은 그 곡선이 고정한 변수 기준이다 (VTh=10 peak, ZTh=3+j4, ZL=5+j0)', () => {
  const r = ok(maxPowerTransfer({ source: 'direct', vthRms: 10 / Math.SQRT2, zth: z(3, 4), zl: z(5, 0) }));
  // XL=0 fixed: RL* = |ZTh+jXL| = 5, P = |VTh|²/(2(RTh+RL*)) = 50/16 = 3.125 W (rms |VTh|²=50)
  near(r.curveBestR[0], 5, 1e-12); near(r.curveBestR[1], 3.125, 1e-12);
  // RL=5 fixed: XL* = −XTh = −4, P = |VTh|² RL/(RTh+RL)² = 250/64
  near(r.curveBestX[0], -4, 1e-12); near(r.curveBestX[1], 250 / 64, 1e-12);
  // the plotted maxima really are maxima of the plotted samples, and the RL* lies inside the plotted range
  assert.ok(r.curveR.every(([, p]) => p <= r.curveBestR[1] + 1e-12) && r.curveX.every(([, p]) => p <= r.curveBestX[1] + 1e-12));
  assert.ok(r.curveR.at(-1)[0] >= 5 && r.curveX[0][0] <= -4 && r.curveX.at(-1)[0] >= -4, 'optima lie in the plotted ranges');
  const def = getTool('max-power');
  const shown = ok(evaluateTool(def, { ...initialValues(def), source: 'direct', vth: 10 / Math.SQRT2, zthR: 3, zthX: 4, loadMode: 'manual', zlR: 5, zlX: 0 }, 'rms'));
  assert.deepEqual(shown.curves.map(c => c.best.map(x => Number(x.toFixed(9)))), [[5, 3.125], [-4, 3.90625]]);
  // 켤레 정합이면 두 곡선의 최대점이 정합점과 같다
  const matched = ok(maxPowerTransfer({ source: 'direct', vthRms: 10 / Math.SQRT2, zth: z(3, 4), zl: null }));
  near(matched.curveBestR[0], 3, 1e-12); near(matched.curveBestX[0], -4, 1e-12); near(matched.curveBestR[1], matched.pmaxClosed, 1e-12); near(matched.curveBestX[1], matched.pmaxClosed, 1e-12);
  // 브루트 포스: XL=0 에서 RL 을 훑은 최대값 = 3.125 W
  const brute = Math.max(...Array.from({ length: 2001 }, (_, n) => powerAt(r.vth, r.zth, z(n * 0.01, 0)).pWatts));
  near(brute, 3.125, 1e-4);
});

test('이상 변압기: ZL=0 이어도 Z1+ZL/n² 가 0이 아니면 계산한다 (Vs=120, n=2, Z1=4 Ω → I1=30, I2=15, V1=V2=0)', () => {
  const r = ok(idealTransformer({ turns1: 1, turns2: 2, dots: 'same', i2Direction: 'out', z1: z(4, 0), zl: z(0, 0), voltageRms: 120 }));
  near(r.I1.re, 30, 1e-12); near(r.I1.im, 0, 1e-12); near(r.I2.re, 15, 1e-12); near(magnitude(r.V1), 0, 1e-12); near(magnitude(r.V2), 0, 1e-12);
  assert.ok(r.checks.every(c => c.pass));
  // 진짜 0 (Z1=0, ZL=0) 만 거부
  assert.equal(idealTransformer({ turns1: 1, turns2: 2, dots: 'same', i2Direction: 'out', z1: z(0, 0), zl: z(0, 0), voltageRms: 120 }).status, 'invalid');
  // Z1+ZL/n² = 0 (+j 와 −j 상쇄) 도 거부
  assert.equal(idealTransformer({ turns1: 1, turns2: 2, dots: 'same', i2Direction: 'out', z1: z(0, 5), zl: z(0, -20), voltageRms: 120 }).status, 'invalid');
  const def = getTool('transformer');
  const shown = ok(evaluateTool(def, { ...initialValues(def), mode: 'ideal', turns1: 1, turns2: 2, dots: 'same', voltage: 120, z1R: 4, z1X: 0, zlR: 0, zlX: 0 }, 'rms'));
  near(shown.values.I1Mag, 30, 1e-9); near(shown.values.I2Mag, 15, 1e-9); near(shown.values.VoMag, 0, 1e-9);
});

const threePhase = (extra = {}) => ({ sequence: 'abc', reference: 'Van', referenceDeg: 0, sourceConnection: 'Y', voltageKind: 'phase', voltageRms: 120, ...extra });

test('3상: 한 가지의 Zℓ+Z=0 (직렬 공진)도 유한한 해를 가진다 (Y 불평형, 중성선 없음, Zℓ=j5, 부하 [−j5,10,10])', () => {
  const r = ok(solveThreePhase(threePhase({ lineZ: z(0, 5), loads: [z(0, -5), z(10, 0), z(10, 0)], loadConnection: 'Y', neutral: 'none' })));
  // 공진한 a상은 중성점 전위가 Van 으로 묶인다: Ib=(Vb−Va)/(10+j5), Ic=(Vc−Va)/(10+j5), Ia=−(Ib+Ic)=28.8−j14.4
  near(r.lineCurrents[0].re, 28.8, 1e-9); near(r.lineCurrents[0].im, -14.4, 1e-9);
  near(magnitude(r.neutralSum), 0, 1e-9);
  assert.ok(r.checks.every(c => c.pass), JSON.stringify(r.checks.filter(c => !c.pass)));
  near(magnitude(sub(r.neutralShift, r.sourceVoltages[0])), 0, 1e-9, 'VnN = Van');
  near(magnitude(r.power.residual), 0, 1e-9);
});

test('3상: 4선식(임피던스 중성선)에서도 공진한 가지가 있어도 풀리고, 이상 중성선·진짜 특이는 거부한다', () => {
  const r = ok(solveThreePhase(threePhase({ lineZ: z(0, 5), loads: [z(0, -5), z(10, 0), z(10, 0)], loadConnection: 'Y', neutral: 'impedance', neutralZ: z(2, 0) })));
  const Zt = [z(0, 0), z(10, 5), z(10, 5)], I = r.lineCurrents, sumI = addAll(I);
  // 각 상: V_k − Zt_k I_k = Zn (Ia+Ib+Ic)
  r.sourceVoltages.forEach((V, k) => near(magnitude(sub(sub(V, multiply(Zt[k], I[k])), multiply(z(2, 0), sumI))), 0, 1e-9, 'phase ' + k));
  assert.ok(r.checks.every(c => c.pass));
  assert.equal(solveThreePhase(threePhase({ lineZ: z(0, 5), loads: [z(0, -5), z(10, 0), z(10, 0)], loadConnection: 'Y', neutral: 'ideal' })).status, 'invalid', '이상 중성선에서 Zℓ+Z=0 은 전류가 무한대');
  const singular = solveThreePhase(threePhase({ lineZ: z(0, 5), loads: [z(0, -5), z(0, -5), z(0, -5)], loadConnection: 'Y', neutral: 'none' }));
  assert.equal(singular.status, 'invalid'); assert.match(singular.reason, /특이/);
});

test('3상: 일반 경우의 결과는 그대로다 (균형 Y 는 선전류 = Van/(Zℓ+Z), 불평형은 독립 절점식과 같다)', () => {
  const r = ok(solveThreePhase(threePhase({ lineZ: z(1, 2), loads: [z(8, 6), z(8, 6), z(8, 6)], loadConnection: 'Y', neutral: 'none' })));
  near(magnitude(sub(r.lineCurrents[0], divide(r.sourceVoltages[0], z(9, 8)))), 0, 1e-9); near(magnitude(r.neutralShift), 0, 1e-9);
  const loads = [z(10, 0), z(20, 5), z(5, -5)], unbalanced = ok(solveThreePhase(threePhase({ lineZ: z(0, 0), loads, loadConnection: 'Y', neutral: 'none' })));
  // 독립 절점식: VnN = ΣV_k Y_k / ΣY_k
  const Y = loads.map(Z => divide(z(1, 0), Z)), shift = divide(addAll(unbalanced.sourceVoltages.map((V, k) => multiply(V, Y[k]))), addAll(Y));
  near(magnitude(sub(unbalanced.neutralShift, shift)), 0, 1e-9);
});

// ---- 예제 클릭: 완전한 상태, 검산은 화면의 결과 -----------------------------------------------------------------------------

// The controller turns the draft strings back into parameters; this is the same step without the DOM.
function applyDrafts(experiment, drafts) {
  const params = {};
  for (const p of experiment.parameters) params[p.key] = p.choices || p.text ? drafts[p.key] : String(drafts[p.key]).trim() === '' ? null : parseCourseNumber(drafts[p.key]) * p.displayScale;
  return params;
}
const exampleIndex = (experiment, text) => experiment.examples.findIndex(e => e.label.includes(text));

test('예제 적용: 이전에 고른 상순서(acb)가 남지 않고, 검산은 화면에 표시된 결과를 대상으로 한다', () => {
  const experiment = getExperiment('three-phase'), defaults = draftsOf(experiment, initialParameters(experiment));
  const acb = experiment.examples[exampleIndex(experiment, '역상순')], i123 = exampleIndex(experiment, '예제 12.3'), e123 = experiment.examples[i123];
  assert.equal(exampleDrafts(experiment, acb, defaults).sequence, 'acb');
  assert.equal(exampleDrafts(experiment, e123, defaults).sequence, 'abc', '예제 12.3 은 기본값(abc)에서 시작한다');
  const fresh = ok(evaluateExperiment('three-phase', applyDrafts(experiment, exampleDrafts(experiment, e123, defaults))));
  near(ang(fresh.loadCurrents[0]), 13.435, 5e-3); near(magnitude(fresh.loadCurrents[0]), 19.36, 5e-3);
  const shown = verifyExample('three-phase', i123, fresh);
  assert.ok(shown.pass, JSON.stringify(shown.rows.filter(r => !r.pass)));
  // 화면 결과가 틀렸다면(acb 잔존) 검산은 실패한다: 거짓 PASS 가 없다
  const wrong = ok(evaluateExperiment('three-phase', { ...applyDrafts(experiment, exampleDrafts(experiment, e123, defaults)), sequence: 'acb' }));
  near(ang(wrong.loadCurrents[0]), -46.565, 5e-3);
  assert.equal(verifyExample('three-phase', i123, wrong).pass, false, '화면에 잘못된 결과가 있으면 검산이 FAIL');
  assert.equal(verifyExample('three-phase', i123).pass, true, '인자 없이 부르면 예전처럼 예제만 다시 계산한다');
});

test('예제 적용: 모든 숫자 예제는 기본값 + 예제 값만으로 완전한 상태가 되어 화면 결과로도 검산을 통과한다', () => {
  let checkedCount = 0, expected = 0;
  for (const experiment of EXPERIMENTS.filter(e => e.id !== 'problem')) {
    const defaults = draftsOf(experiment, initialParameters(experiment));
    experiment.examples.forEach((example, index) => {
      const drafts = exampleDrafts(experiment, example, defaults);
      for (const p of experiment.parameters) if (!Object.hasOwn(example.values, p.key)) assert.equal(drafts[p.key], defaults[p.key], experiment.id + '.' + p.key + ' 는 기본값 그대로');
      if (!example.expect) return;
      expected += 1;
      const result = evaluateExperiment(experiment.id, applyDrafts(experiment, drafts));
      assert.equal(result.status, 'valid', experiment.id + ' / ' + example.label + ': ' + result.reason);
      const checked = verifyExample(experiment.id, index, result);
      assert.ok(checked.pass, experiment.id + ' / ' + example.label + ' ' + JSON.stringify(checked.rows.filter(r => !r.pass)));
      checkedCount += 1;
    });
  }
  assert.equal(checkedCount, expected); assert.ok(checkedCount >= 15, 'checked ' + checkedCount);
});

test('peak 로 바꿔도 표시값이 √2배라는 이유만으로 범위 오류가 되지 않는다 (한계는 내부 RMS 값 기준)', () => {
  const rangeError = r => r.status === 'invalid' && /허용 범위/.test(r.reason);
  for (const experiment of EXPERIMENTS.filter(e => e.id !== 'problem')) {
    for (const p of experiment.parameters.filter(q => q.amplitude)) {
      let base = { ...initialParameters(experiment), presentation: 'numeric' };
      if (p.showIf && !p.showIf(base)) base = { ...base, coordinate: 'polar' }; // the polar-only field of the first experiment
      assert.ok(!p.showIf || p.showIf(base), experiment.id + '.' + p.key + ' is visible in the probe state');
      for (const edge of [p.max, p.min]) {
        const rms = evaluateExperiment(experiment.id, { ...base, basis: 'rms', [p.key]: edge });
        const peak = evaluateExperiment(experiment.id, { ...base, basis: 'peak', [p.key]: edge * Math.SQRT2 });
        assert.equal(rangeError(peak), rangeError(rms), experiment.id + '.' + p.key + ' = ' + edge + ': peak 와 RMS 의 범위 판정이 같다 (' + peak.reason + ' / ' + rms.reason + ')');
      }
      // 한계를 실제로 넘으면 peak 에서도 거부한다
      assert.ok(rangeError(evaluateExperiment(experiment.id, { ...base, basis: 'peak', [p.key]: p.max * Math.SQRT2 * 1.01 })), experiment.id + '.' + p.key + ' 상한 초과는 거부');
    }
  }
  const tp = { ...initialParameters(getExperiment('three-phase')), presentation: 'numeric' };
  assert.equal(evaluateExperiment('three-phase', { ...tp, basis: 'peak', lineVoltageRms: 1e6 * Math.SQRT2 }).status, 'valid');
});

test('π 등가: 분모가 0인 가지는 개방(∞)으로 명시한다 (L1=4, L2=1, M=1, 점 같은 쪽 → LA 개방, LB=1 H, LC=3 H)', () => {
  const eq = tPiEquivalents({ l1: 4, l2: 1, M: 1, sigma: 1 });
  assert.equal(eq.pi.LA, Infinity); near(eq.pi.LB, 1, 1e-12); near(eq.pi.LC, 3, 1e-12);
  assert.deepEqual(eq.pi.open, { LA: true, LB: false });
  const def = getTool('coupled');
  const r = ok(evaluateTool(def, { ...initialValues(def), omega: 4, l1: 4, l2: 1, couplingMode: 'M', m: 1, dots: 'same', z1R: 0, z1X: 0, zlR: 2, zlX: 0 }, 'rms'));
  const rows = r.tables.find(t => t.title === 'π 등가').rows;
  assert.match(rows[0][1], /개방/); assert.ok(!rows.some(row => /미정/.test(row[1])), '미정 H 가 나오지 않는다');
  assert.equal(rows[1][1], '1 H'); assert.equal(rows[2][1], '3 H');
  assert.ok(r.notes.some(n => /개방/.test(n)));
  // 점 반대쪽이면 분모 L2+M 이므로 개방이 없다
  const opp = tPiEquivalents({ l1: 4, l2: 1, M: 1, sigma: -1 });
  assert.ok(Number.isFinite(opp.pi.LA) && Number.isFinite(opp.pi.LB)); assert.deepEqual(opp.pi.open, { LA: false, LB: false });
  // 양쪽이 모두 개방인 점(L1=L2=M)은 k=1 이라 π 등가 자체가 없다
  assert.equal(tPiEquivalents({ l1: 2, l2: 2, M: 2, sigma: 1 }).pi, null);
});
