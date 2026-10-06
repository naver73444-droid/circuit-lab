// Second review round of the course tools: stale-field errors, sequence-aware 3-phase text, notation conversions, labels and units.
// The tool controller is driven through a minimal fake DOM (no browser): only the pieces the controller and its view touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getTool } from '../../../src/circuit-course-tools.js';
import { createCourseTool } from '../../../src/circuit-course-tool-controller.js';
import { reviewDrafts, initialValues, evaluateTool, verifyPreset } from '../../../src/circuit-course-tool-common.js';
import { verificationTable } from '../../../src/circuit-course-view.js';
import { capacitanceText, COUPLING_TOOL_GUIDE } from '../../../src/circuit-course-format.js';
import { getExperiment, initialParameters, evaluateExperiment, convertCoordinateDrafts } from '../../../src/circuit-course-registry.js';
import { toolFigure } from '../../../src/circuit-course-figures.js';

// ---- fake DOM -----------------------------------------------------------------------------------------------------------------
function fakeElement(extra = {}) {
  const el = { dataset: {}, hidden: false, textContent: '', value: '', attrs: {}, children: new Map(), setAttribute(k, v) { el.attrs[k] = v; }, removeAttribute(k) { delete el.attrs[k]; },
    querySelector(sel) { return el.children.get(sel) ?? null; }, querySelectorAll() { return []; }, innerHTML: '', ...extra };
  return el;
}
function fakeHost(def) {
  const listeners = {}, rows = new Map(), status = fakeElement(), results = fakeElement();
  const host = fakeElement({ ownerDocument: { activeElement: null }, addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {}, contains: () => true, replaceChildren() {} });
  for (const f of def.fields) {
    const row = fakeElement(), label = fakeElement(), input = fakeElement({ dataset: { ccKey: f.key } }), error = fakeElement(), slider = f.slider ? fakeElement({ dataset: { ccSlider: f.key } }) : null;
    row.children.set('[data-cc-label]', label); row.children.set('[data-cc-key]', f.kind === 'heading' ? null : input); row.children.set('[data-cc-error]', error);
    if (slider) row.children.set('[data-cc-slider]', slider);
    rows.set(f.key, { row, input, error });
    host.children.set('[data-cc-field="' + f.key + '"]', row); host.children.set('[data-cc-key="' + f.key + '"]', input);
  }
  host.children.set('[data-cc-results]', results); host.children.set('[data-cc-status]', status);
  return { host, rows, status, results, fire: (type, target) => listeners[type]({ target }) };
}
function openTool(id) {
  const def = getTool(id), fake = fakeHost(def);
  const tool = createCourseTool(fake.host, def, { getBasis: () => 'rms', setBasis() {} });
  const type = (key, value) => fake.fire('input', { dataset: { ccKey: key }, value, tagName: 'INPUT' });
  const pick = (key, value) => fake.fire('input', { dataset: { ccKey: key }, value, tagName: 'SELECT' });
  return { def, tool, fake, type, pick };
}

test('[1] 한 칸이 잘못된 값인 채 다른 칸을 바꿔도 그 칸 오류가 남고 결과·계산 값은 갱신되지 않는다 (자기결합 L1=0.1 → M=2.5 는 k>1)', () => {
  const t = openTool('coupled'), before = t.tool.inspect();
  assert.equal(before.values.l1, 5);
  t.type('l1', '0.1');
  let now = t.tool.inspect();
  assert.ok(now.errors.l1 && now.errors.l1.includes('마지막 유효 값'), '조합이 안 되는 L1 은 오류');
  assert.equal(now.values.l1, 5, '계산 값은 마지막 유효 값');
  // 다른 칸(ω)을 바꿔도 오류가 사라지지 않고, 화면의 L1=0.1 이 계산에 몰래 이전 값 5 로 쓰이지도 않는다
  t.type('omega', '5');
  now = t.tool.inspect();
  assert.ok(now.errors.l1, 'L1 오류 유지');
  assert.equal(now.drafts.l1, '0.1');
  assert.equal(now.values.l1, 5);
  assert.deepEqual(now.outputs, before.outputs, '결과는 갱신하지 않는다');
  assert.equal(t.fake.status.dataset.kind, 'error');
  assert.equal(t.fake.rows.get('l1').error.textContent.includes('마지막 유효 값'), true);
  // L1 을 쓸 수 있는 값으로 고치면 ω=5 와 함께 한 번에 계산된다
  t.type('l1', '6');
  now = t.tool.inspect();
  assert.deepEqual(now.errors, {});
  assert.equal(now.values.l1, 6); assert.equal(now.values.omega, 5);
  const expected = evaluateTool(t.def, { ...initialValues(t.def), l1: 6, omega: 5 }, 'rms');
  assert.equal(expected.status, 'valid');
  assert.equal(now.outputs.I1Mag, expected.values.I1Mag);
  assert.equal(t.fake.status.dataset.kind, 'valid');
});

test('[1] 숫자가 아닌 글자(parse 오류)도 다른 칸을 바꿀 때 사라지지 않는다', () => {
  const t = openTool('coupled'), before = t.tool.inspect();
  t.type('l2', 'abc');
  assert.ok(t.tool.inspect().errors.l2);
  t.type('omega', '6');
  const now = t.tool.inspect();
  assert.ok(now.errors.l2, 'L2 오류 유지');
  assert.equal(now.values.omega, 6, '유효한 칸의 값은 보관');
  assert.deepEqual(now.outputs, before.outputs);
  t.type('l2', '4');
  assert.deepEqual(t.tool.inspect().errors, {});
  assert.equal(t.tool.inspect().values.omega, 6);
});

test('[1] reviewDrafts: 보이는 모든 숫자 칸을 다시 읽고 틀린 칸마다 메시지를 돌려준다', () => {
  const def = getTool('coupled'), values = initialValues(def);
  const drafts = { l1: '5', l2: 'x', omega: '4', m: '2.5' };
  const out = reviewDrafts(def, values, drafts, 'rms');
  assert.deepEqual(Object.keys(out.errors), ['l2']);
  assert.equal(out.candidate.l1, 5);
  const ok = reviewDrafts(def, values, { ...drafts, l2: '9' }, 'rms');
  assert.deepEqual(ok.errors, {}); assert.equal(ok.candidate.l2, 9);
  // 저장 값과 같은 글자는 저장된 정확한 값을 그대로 쓴다(10자리 반올림이 계산에 새지 않는다)
  const third = { ...values, l1: 1 / 3 };
  assert.equal(reviewDrafts(def, third, { l1: '0.3333333333' }, 'rms').candidate.l1, 1 / 3);
});

test('[4] 검산 대조표: 교재 기준(RMS)을 머리에 쓰고, 화면이 peak 면 전류·전압은 환산값을 괄호로 병기한다 (예제 13.1 |I1|=13.01 A → peak 18.4 A)', () => {
  const def = getTool('coupled'), preset = def.presets[0], checked = verifyPreset(def, preset);
  const rows = checked.rows.map(r => ({ ...r, refBasis: 'rms' }));
  const rmsView = verificationTable(rows, 'rms');
  assert.match(rmsView, /교재 기준: RMS/); assert.ok(!rmsView.includes('(peak'));
  const peakView = verificationTable(rows, 'peak');
  assert.match(peakView, /교재 기준: RMS/);
  assert.match(peakView, /\(peak 18\.4\d* A\)/, 'peak 환산 병기');
  assert.ok(!/\(peak [^)]*°\)/.test(peakView), '각도는 환산하지 않는다');
  assert.match(peakView, /지금 화면 기준\(peak\)/);
});

test('[2] 실험 4: 상순서 acb 는 공식 줄과 문자식 풀이가 ±120°, 선간 ∓30° 관계를 함께 바꾼다', () => {
  const exp = getExperiment('three-phase');
  const abc = exp.formulas({ sequence: 'abc' }).join('\n'), acb = exp.formulas({ sequence: 'acb' }).join('\n');
  assert.match(abc, /θ, θ−120°, θ\+120°/); assert.match(abc, /Vab=Van−Vbn=√3 Van∠\+30°/); assert.match(abc, /Iab∠−30°/);
  assert.match(acb, /θ, θ\+120°, θ−120°/); assert.match(acb, /Vab=Van−Vbn=√3 Van∠−30°/); assert.match(acb, /Iab∠\+30°/);
  const ang = z => Math.atan2(z.im, z.re) * 180 / Math.PI;
  for (const connection of ['Y', 'delta']) {
    const p = { ...initialParameters(exp), connection, presentation: 'numeric', sequence: 'acb' };
    const r = evaluateExperiment('three-phase', p);
    assert.equal(r.status, 'valid');
    assert.ok(Math.abs(ang(r.phaseVoltages[1]) - 120) < 1e-9 && Math.abs(ang(r.lineVoltages[0]) + 30) < 1e-9, '수치는 Vbn=+120°, Vab=−30°');
    const symbolic = evaluateExperiment('three-phase', { ...p, presentation: 'symbolic' });
    const steps = symbolic.solution.steps.map(s => s.formula + ' ' + s.substitution).join('\n');
    assert.match(steps, /Vbn=Van e\^\(j2π\/3\), Vcn=Van e\^\(−j2π\/3\)/);
    assert.match(steps, /Vab=Van−Vbn=√3 Van e\^\(−jπ\/6\)/);
    if (connection === 'delta') assert.match(steps, /Ia=Iab−Ica=√3 Iab e\^\(jπ\/6\)/);
    assert.ok(!/Vbn=Van e\^\(−j2π\/3\)/.test(steps));
  }
  // abc 는 그대로
  const abcSteps = evaluateExperiment('three-phase', { ...initialParameters(exp), presentation: 'symbolic' }).solution.steps.map(s => s.formula + ' ' + s.substitution).join('\n');
  assert.match(abcSteps, /Vbn=Van e\^\(−j2π\/3\), Vcn=Van e\^\(j2π\/3\)/);
  assert.match(abcSteps, /Vab=Van−Vbn=√3 Van e\^\(jπ\/6\)/);
});

test('[5] 단권변압기 도식: 승압은 전원이 N1 구간(위~중간 탭), 부하가 N1+N2; 강압은 전원 N1+N2, 부하 N2; 입출력 단자쌍 표시', () => {
  const up = toolFigure({ kind: 'auto', mode: 'up' }), down = toolFigure({ kind: 'auto', mode: 'down' });
  assert.match(up, /입력 V1 \(N1\)/); assert.match(up, /출력 V2 \(N1\+N2\)/);
  assert.match(down, /입력 V1 \(N1\+N2\)/); assert.match(down, /출력 V2 \(N2\)/);
  assert.match(up, /M200 108H110/, '승압 입력선은 중간 탭(y=108)에서 나온다');
  assert.ok(!/M200 108H110V186/.test(up), '승압 입력이 N2 구간(아래)으로 가지 않는다');
  assert.equal((up.match(/<circle/g) ?? []).length, 4, '단자쌍 둘 = 단자 4개'); assert.equal((down.match(/<circle/g) ?? []).length, 4);
});

test('[6] 실험 1 복소수 표현 전환은 같은 전압으로 변환한다 (100+j100 ⇄ 141.42∠45°)', () => {
  const polar = convertCoordinateDrafts({ re: '100', im: '100', amplitude: '100', angleDeg: '30' }, 'polar');
  assert.equal(polar.amplitude, '141.4213562'); assert.equal(polar.angleDeg, '45');
  const back = convertCoordinateDrafts({ ...polar }, 'rect');
  assert.ok(Math.abs(Number(back.re) - 100) < 1e-6 && Math.abs(Number(back.im) - 100) < 1e-6);
  const axis = convertCoordinateDrafts({ amplitude: '100', angleDeg: '90', re: '1', im: '1' }, 'rect');
  assert.equal(axis.re, '0'); assert.equal(axis.im, '100');
  assert.equal(convertCoordinateDrafts({ re: '', im: '3', amplitude: '7', angleDeg: '8' }, 'polar').amplitude, '7', '비어 있으면 건드리지 않는다');
  assert.equal(convertCoordinateDrafts({ re: '0', im: '0', amplitude: '7', angleDeg: '8' }, 'polar').angleDeg, '0');
});

test('[7] 자기결합 도구: M ⇄ k 전환은 결합을 유지한다 (L1=5, L2=4, M=2.5 → k=0.559 → M=2.5)', () => {
  const t = openTool('coupled');
  t.pick('couplingMode', 'k');
  let now = t.tool.inspect();
  assert.ok(Math.abs(now.values.k - 2.5 / Math.sqrt(20)) < 1e-12, 'k = M/√(L1L2)');
  assert.equal(now.status, 'valid');
  assert.ok(Math.abs(now.outputs.M - 2.5) < 1e-9, '결합이 그대로(M=2.5)');
  assert.ok(Math.abs(Number(now.drafts.k) - 0.5590169944) < 1e-9);
  t.pick('couplingMode', 'M');
  now = t.tool.inspect();
  assert.ok(Math.abs(now.values.m - 2.5) < 1e-9);
  // 바뀐 L 로 다시 전환해도 직전 결합을 따른다
  t.type('l1', '9');
  t.pick('couplingMode', 'k');
  assert.ok(Math.abs(t.tool.inspect().values.k - 2.5 / 6) < 1e-12);
});

test('[8] 역률 보상 표기: Qc(양수)와 커패시터 복소전력 S_C=−jQc 를 실험·부하 합성에 함께 쓴다', () => {
  const exp = getExperiment('correction');
  assert.ok(exp.formulas.some(f => f.includes('Qc=Q부하−Q목표') && f.includes('S_C=−jQc')));
  assert.ok(!exp.formulas.some(f => f.includes('Qcap')));
  const def = getTool('loads'), values = { ...initialValues(def), compensate: 'yes' };
  const r = evaluateTool(def, values, 'rms');
  assert.equal(r.status, 'valid', r.reason);
  assert.ok(r.metrics.some(m => m.label.startsWith('Qc') && m.label.includes('양수')));
  const s = r.metrics.find(m => m.label.includes('S_C'));
  assert.ok(s && s.text.startsWith('−j'), JSON.stringify(s));
  assert.ok(r.values.Qc > 0);
  const res = evaluateExperiment('correction', { ...initialParameters(exp), presentation: 'numeric' });
  assert.ok(res.qCapacitorVars < 0, '엔진의 Qcap 은 음수 그대로, 화면은 Qc=−Qcap');
});

test('[9] 정전용량 자동 단위: 0.0006357 µF 대신 635.7 pF', () => {
  assert.equal(capacitanceText(0.6357e-9), '635.7 pF');
  assert.equal(capacitanceText(138.155e-6), '138.155 µF');
  assert.equal(capacitanceText(4.7e-9), '4.7 nF');
  assert.equal(capacitanceText(0), '0 µF');
  assert.equal(capacitanceText(2e-3), '2 mF');
});

test('[10] 최대전력: 현재 효율과 켤레 정합 효율(50 %)을 따로 쓴다', () => {
  const def = getTool('max-power'), r = evaluateTool(def, { ...initialValues(def), source: 'direct', vth: 10, zthR: 3, zthX: 4, loadMode: 'manual', zlR: 5, zlX: 0 }, 'rms');
  assert.equal(r.status, 'valid', r.reason);
  const text = r.notes.join(' ');
  assert.match(text, /현재 ZL의 효율은 η=RL\/\(RTh\+RL\)=62\.5 %/); assert.match(text, /켤레 정합.*50 %/);
  assert.ok(!text.includes('정합일 때 효율은 RL'));
  assert.ok(r.metrics.some(m => m.label.startsWith('현재 효율')));
  assert.ok(r.metrics.some(m => m.label === '켤레 정합 효율' && m.text === '50'));
});

test('[11] 연결 안내: 자기결합·변압기 도구와 내 문제에 도구 선택 한 줄이 있다', () => {
  assert.match(COUPLING_TOOL_GUIDE, /고정 2루프·T\/π 등가 → 자기결합 도구/);
  assert.match(COUPLING_TOOL_GUIDE, /이상·정격·단권 → 변압기 도구/);
  assert.match(COUPLING_TOOL_GUIDE, /임의 배선 → 회로 편집기 예제 "결합 코일 \(예제 13\.1\)"/);
  assert.ok(getTool('coupled').lead.endsWith(COUPLING_TOOL_GUIDE) && getTool('transformer').lead.endsWith(COUPLING_TOOL_GUIDE));
  assert.ok(getExperiment('problem').assumptions.some(a => a.includes(COUPLING_TOOL_GUIDE)));
});
