import { polar, rmsPhasor, magnitude, rectangularPolar, phaseDifference, add, sub, impedanceNetwork, balancedThreePhase, correction, sampledPowerCheck, waveSample } from './circuit-course-model.js';
import { solveSymbolicProblem } from './circuit-course-problem-symbolic.js';
const UNIT_MAP = {
  resistance: { ohm: 1, kohm: 1e3, Mohm: 1e6, mohm: 1e-3 },
  inductance: { H: 1, mH: 1e-3, uH: 1e-6 },
  capacitance: { F: 1, mF: 1e-3, uF: 1e-6, nF: 1e-9, pF: 1e-12 },
  voltage: { V: 1, mV: 1e-3, kV: 1e3 },
  frequency: { Hz: 1, kHz: 1e3, MHz: 1e6, 'rad/s': 1 / (2 * Math.PI) },
  power: { W: 1, kW: 1e3, MW: 1e6 }, reactive: { var: 1, kvar: 1e3, Mvar: 1e6 },
  angle: { deg: 1, '°': 1, rad: 180 / Math.PI }
};
export function parseProblemQuantity(text, quantity, defaultUnit) {
  const s = String(text).trim();
  if (!s) throw new RangeError('조건이 비어 있습니다. 문제에 주어진 값을 입력하세요.');
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:\s*([a-zA-ZµμΩ°/]+))?$/.exec(s);
  if (!match) throw new RangeError('숫자와 호환 단위를 입력하세요. 예: 10 kΩ, 20 mH, 100 µF.');
  const unit = (match[2] ?? defaultUnit).replaceAll('µ', 'u').replaceAll('μ', 'u').replaceAll('Ω', 'ohm').replaceAll('Ohm', 'ohm');
  // Own keys only: 'toString'/'constructor' etc. must not resolve through Object.prototype.
  const units = Object.hasOwn(UNIT_MAP, quantity) ? UNIT_MAP[quantity] : undefined;
  const factor = units && Object.hasOwn(units, unit) ? units[unit] : undefined;
  if (factor === undefined) throw new RangeError('단위가 맞지 않습니다: ' + unit + '. 이 항목에는 ' + Object.keys(units ?? {}).join(', ') + '를 사용할 수 있습니다.');
  const value = Number(match[1]), result = value * factor;
  if (!Number.isFinite(result) || (result === 0 && /[1-9]/.test(match[1].split(/e/i)[0]))) throw new RangeError('단위 환산값이 수치 표현 범위를 벗어났습니다.');
  return result;
}
const n = v => Number(v.toPrecision(8)).toString();
const z = v => n(v.re) + (v.im < 0 ? ' − j' : ' + j') + n(Math.abs(v.im));
const a = v => { const p = rectangularPolar(v); return n(p.magnitude) + ' ∠ ' + (p.angleDeg === null ? '미정' : n(p.angleDeg) + '°'); };
const answer = (label, value, unit) => ({ label, value, unit });
const complexAnswer = (label, value, unit) => ({ label, value: magnitude(value), complex: { ...value }, unit, text: z(value) + ' = ' + a(value) });
const step = (label, formula, substitution, result) => ({ label, formula, substitution, result });
const finite = (v, label, min = -1e12, max = 1e12) => {
  if (v === null || v === undefined || v === '') throw new RangeError('부족한 조건: ' + label + '을 입력하세요.');
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new RangeError(label + ': 단위와 허용 범위를 확인하세요.');
  return v;
};
const trace = (label, unit, phasor) => ({ label, unit, phasor });
const choices = (value, allowed, label) => { if (!allowed.includes(value)) throw new RangeError(label + ': 지원되는 선택을 확인하세요.'); };
function powerStep(V, I, p) {
  return step('복소전력 · 켤레와 RMS', 'S=V_RMS I_RMS*=P+jQ', '(' + z(V) + ')×(' + z({ re: I.re, im: -I.im }) + ')', z(p.S) + ' VA; P=' + n(p.pWatts) + ' W, Q=' + n(p.qVars) + ' var');
}
function desiredAnswers(goal, result, kind) {
  const p = result.power;
  if (goal === 'power') return [answer('유효전력 P', p.pWatts, 'W'), answer('무효전력 Q', p.qVars, 'var'), answer('피상전력 |S|', p.apparentVA, 'VA')];
  if (goal === 'pf') return [answer('역률 P/|S|', p.pf, ''), answer('위상차 φ=∠V−∠I', p.phaseDeg, '°')];
  if (kind === 'single') {
    if (goal === 'current') return [complexAnswer('전원 전류 I RMS', result.I, 'A')];
    if (goal === 'impedance') return result.Z ? [complexAnswer('등가 임피던스 Z', result.Z, 'Ω'), complexAnswer('등가 어드미턴스 Y', result.Y, 'S')] : [answer('등가 임피던스 Z', null, 'Ω'), complexAnswer('입력 어드미턴스 Y', result.Y, 'S')];
    if (goal === 'branch') return result.branches.flatMap((b, i) => [complexAnswer(b.kind + (i + 1) + ' 전압 RMS', b.V, 'V'), complexAnswer(b.kind + (i + 1) + ' 전류 RMS', b.I, 'A')]);
  }
  if (kind === 'three') {
    if (goal === 'line-current') return result.lineCurrents.map((i, k) => complexAnswer(['Ia', 'Ib', 'Ic'][k] + ' 선전류 RMS', i, 'A'));
    if (goal === 'phase-current') return result.loadCurrents.map((i, k) => complexAnswer('부하 상' + (k + 1) + ' 전류 RMS', i, 'A'));
    if (goal === 'phase-voltage') return result.loadVoltages.map((v, k) => complexAnswer('부하 상' + (k + 1) + ' 전압 RMS', v, 'V'));
  }
  if (kind === 'correction') {
    if (goal === 'capacitance') return [answer('각 커패시터 C', result.recommendedCapacitanceF * 1e6, 'µF'), answer('커패시터 총 Q', result.qCapacitorVars, 'var')];
    if (goal === 'source-current') return [answer('보상 전 공급 전류 RMS', result.sourceCurrentBeforeRms, 'A'), answer('보상 후 공급 전류 RMS', result.sourceCurrentAfterRms, 'A')];
  }
  throw new RangeError('이 문제 유형에서 구할 수 없는 값을 선택했습니다.');
}
export function solveCourseProblem(p) {
  try {
    if (p.solutionMode === 'symbolic') return solveSymbolicProblem(p);
    choices(p.problemKind, ['single', 'three', 'correction'], '문제 유형');
    choices(p.basis, ['rms', 'peak'], '진폭 기준');
    const vInput = finite(p.voltage, '주어진 전압', 1e-12, 1e6);
    const vRms = p.basis === 'peak' ? vInput / Math.SQRT2 : vInput;
    const givens = ['전압 크기=' + n(vInput) + ' V ' + p.basis + ' → ' + n(vRms) + ' V RMS'];
    const steps = [step('전압 실효값으로 통일', p.basis === 'peak' ? 'V_RMS=V_peak/√2' : 'V_RMS=V_given', p.basis === 'peak' ? n(vInput) + '/√2' : n(vInput), n(vRms) + ' V RMS')];
    const notes = ['사용자가 입력한 조건을 선택한 이상 모델에 대입했습니다. 문제 메모를 자동 해석하지 않습니다.', '정현파 정상상태, RMS 페이저, 수동부호. Q>0 지상/유도성, Q<0 진상/용량성.'];
    let r, goal, frequencyHz;
    if (p.problemKind === 'single') {
      frequencyHz = finite(p.frequencyHz, '주파수 f 또는 ω', 1e-9, 1e6);
      choices(p.elements, ['R', 'L', 'C', 'RL', 'RC', 'LC', 'RLC'], '소자 조합');
      choices(p.topology, ['series', 'parallel'], '연결');
      const phase = finite(p.sourceAngle, '주어진 전압의 기준 위상', -36000, 36000);
      const values = { R: p.r, L: p.l, C: p.c }, labels = { R: '저항 R', L: '인덕턴스 L', C: '정전용량 C' };
      const branches = [...p.elements].map(kind => ({ kind, value: finite(values[kind], labels[kind], 1e-15, 1e9) }));
      r = impedanceNetwork({ frequencyHz, topology: p.topology, branches, voltageRms: vRms, voltagePhaseDeg: phase });
      if (r.status !== 'valid') return { ...r, reason: '현재 조건의 답을 정할 수 없습니다. ' + r.reason };
      goal = p.singleGoal;
      givens.push((p.topology === 'series' ? '직렬 ' : '병렬 ') + p.elements, '전압 위상=' + n(phase) + '°', 'f=' + n(frequencyHz) + ' Hz');
      steps.push(step('각주파수', 'ω=2πf', '2π×' + n(frequencyHz), n(r.omega) + ' rad/s'));
      r.branches.forEach(b => {
        const formula = { R: 'Z_R=R', L: 'Z_L=jωL', C: 'Z_C=−j/(ωC)' }[b.kind];
        const substitution = b.kind === 'R' ? n(b.value) : b.kind === 'L' ? 'j×' + n(r.omega) + '×' + n(b.value) : '−j/(' + n(r.omega) + '×' + n(b.value) + ')';
        givens.push(b.kind + '=' + n(b.value) + ' ' + { R: 'Ω', L: 'H', C: 'F' }[b.kind]);
        steps.push(step(b.kind + ' 소자 임피던스', formula, substitution, z(b.Z) + ' Ω'));
      });
      steps.push(step('등가 회로', p.topology === 'series' ? 'Z_eq=Σ Z_k' : 'Y_eq=Σ(1/Z_k), Z_eq=1/Y_eq',
        r.branches.map(b => p.topology === 'series' ? '(' + z(b.Z) + ')' : '1/(' + z(b.Z) + ')').join(' + '),
        r.Z ? 'Z=' + z(r.Z) + ' Ω, Y=' + z(r.Y) + ' S' : 'Y=0 S: 개방 등가, Z는 유한값 없음'));
      steps.push(step('전압·전류', 'I=V_RMS Y_eq', '(' + z(r.V) + ')×(' + z(r.Y) + ')', a(r.I) + ' A RMS'));
      steps.push(powerStep(r.V, r.I, r.power));
      const balance = p.topology === 'series' ? r.branches.map(b => b.V).reduce(add, { re: 0, im: 0 }) : r.branches.map(b => b.I).reduce(add, { re: 0, im: 0 });
      const expected = p.topology === 'series' ? r.V : r.I, unit = p.topology === 'series' ? 'V' : 'A';
      r.checks = [sampledPowerCheck(r.V, r.I, frequencyHz, r.power.pWatts),
        { label: p.topology === 'series' ? 'KVL: Σ분기 V−전원 V' : 'KCL: Σ분기 I−전원 I', actual: magnitude(sub(balance, expected)), expected: 0, unit, tolerance: 1e-8 + 1e-10 * magnitude(expected), pass: magnitude(sub(balance, expected)) <= 1e-8 + 1e-10 * magnitude(expected) }];
      r.phasors = [{ label: 'V RMS', unit: 'V', z: r.V }, { label: 'I RMS', unit: 'A', z: r.I }];
      r.traces = [trace('v(t)', 'V', r.V), trace('i(t)', 'A', r.I), { label: 'p(t)=vi', unit: 'W', sample: t => waveSample(r.V, frequencyHz, t) * waveSample(r.I, frequencyHz, t) }];
    } else if (p.problemKind === 'three') {
      choices(p.connection, ['Y', 'delta'], '부하 연결'); choices(p.voltageKnown, ['line', 'phase'], '주어진 전압 종류');
      const phase = finite(p.sourceAngle, '주어진 전압 기준 위상', -36000, 36000);
      const zPhase = { re: finite(p.r, '상 임피던스 R', 0, 1e9), im: finite(p.x, '상 임피던스 X', -1e9, 1e9) };
      frequencyHz = p.frequencyHz === null || p.frequencyHz === undefined ? null : finite(p.frequencyHz, '파형 주파수', 1e-9, 1e6);
      const lineVoltageRms = p.voltageKnown === 'phase' && p.connection === 'Y' ? Math.sqrt(3) * vRms : vRms;
      const referenceIsVan = p.voltageKnown === 'phase' && p.connection === 'Y';
      const vanAngle = referenceIsVan ? phase : phase - 30;
      r = balancedThreePhase({ connection: p.connection, lineVoltageRms, z: zPhase, phaseDeg: vanAngle });
      if (r.status !== 'valid') return r;
      goal = p.threeGoal;
      givens.push('균형 abc · ' + (p.connection === 'Y' ? 'Y' : 'Δ'), '주어진 전압=' + (p.voltageKnown === 'line' ? '선간 Vab' : referenceIsVan ? '부하 상 Van' : '부하 상 Vab'), '주어진 전압 위상=' + n(phase) + '°', 'Z상=' + z(zPhase) + ' Ω');
      steps.push(step('선간/상 전압과 기준', 'abc: Vab=√3 Van∠+30°',
        p.connection === 'Y' ? (p.voltageKnown === 'line' ? 'V상=' + n(vRms) + '/√3; ∠Van=' + n(phase) + '−30°' : 'V선=√3×' + n(vRms) + '; ∠Van=' + n(phase)) : 'V상=V선=' + n(vRms) + '; ∠Van=' + n(phase) + '−30°',
        'Van=' + a(r.phaseVoltages[0]) + ' V RMS; Vab=' + a(r.lineVoltages[0]) + ' V RMS'));
      steps.push(step('부하 상전류', 'I상=V상/Z상', '(' + z(r.loadVoltages[0]) + ')/(' + z(zPhase) + ')', a(r.loadCurrents[0]) + ' A RMS'));
      steps.push(step('선전류', p.connection === 'Y' ? 'Ia=Ian' : 'Ia=Iab−Ica=√3 Iab∠−30°',
        p.connection === 'Y' ? a(r.loadCurrents[0]) : '(' + z(r.loadCurrents[0]) + ')−(' + z(r.loadCurrents[2]) + ')', a(r.lineCurrents[0]) + ' A RMS'));
      steps.push(step('3상 총 복소전력', 'S₃=Σ(V상 I상*)=3 Van Ia*',
        '3×(' + z(r.phaseVoltages[0]) + ')×(' + z({ re: r.lineCurrents[0].re, im: -r.lineCurrents[0].im }) + ')',
        z(r.power.S) + ' VA; P=' + n(r.power.pWatts) + ' W, Q=' + n(r.power.qVars) + ' var'));
      notes.push('선간 페이저를 직접 곱할 때는 √3 Vab Ia* e^(−j30°)가 필요합니다. 불평형·중성선 이동은 범위 밖입니다.');
      r.phasors = [...r.lineVoltages.map((v, i) => ({ label: ['Vab', 'Vbc', 'Vca'][i], unit: 'V', z: v })), ...r.phaseVoltages.map((v, i) => ({ label: ['Van', 'Vbn', 'Vcn'][i], unit: 'V', z: v })), ...r.lineCurrents.map((v, i) => ({ label: ['Ia', 'Ib', 'Ic'][i], unit: 'A', z: v }))];
      const residual = magnitude(r.lineCurrents.reduce(add, { re: 0, im: 0 }));
      r.checks = [{ label: '균형 KCL: |Ia+Ib+Ic|', actual: residual, expected: 0, unit: 'A', tolerance: 1e-8 + 1e-10 * r.lineCurrentRms, pass: residual <= 1e-8 + 1e-10 * r.lineCurrentRms }];
      r.traces = frequencyHz ? r.phaseVoltages.map((v, i) => trace(['van(t)', 'vbn(t)', 'vcn(t)'][i], 'V', v)) : [];
      if (frequencyHz) {
        const checks = r.loadVoltages.map((v, i) => sampledPowerCheck(v, r.loadCurrents[i], frequencyHz, r.powers[i].pWatts));
        r.checks.push(...checks.map((c, i) => ({ ...c, label: '상' + (i + 1) + ' v(t)i(t) 평균' })));
      } else notes.push('주파수가 주어지지 않아 시간파형은 생략했습니다. 주어진 Z에 대한 페이저·전력 답은 유효합니다.');
    } else {
      frequencyHz = finite(p.frequencyHz, '주파수 f 또는 ω', 1e-9, 1e6);
      const pWatts = finite(p.pWatts, '총 유효전력 P', 1e-12, 1e9), qVars = finite(p.qVars, '총 무효전력 Q', -1e9, 1e9);
      const targetPF = finite(p.targetPF, '목표 지상 역률', .001, 1);
      choices(p.phases, ['1', '3'], '전원 상수'); choices(p.connection, ['Y', 'delta'], '커패시터 뱅크 연결');
      r = correction({ frequencyHz, voltageRms: vRms, pWatts, qVars, targetPF, phases: Number(p.phases), connection: p.connection });
      if (r.status !== 'valid') return r;
      if (!r.possible) return { status: 'unsupported', reason: '커패시터만으로 지정한 목표 지상 역률을 만들 수 없습니다. 현재 P/Q와 목표를 확인하세요.' };
      goal = p.correctionGoal; r.power = r.after; r.phasors = []; r.traces = [];
      givens.push(p.phases === '3' ? '균형 3상 선간전압 · C뱅크 ' + p.connection : '단상 부하 단자전압', 'P총=' + n(pWatts) + ' W', 'Q총=' + n(qVars) + ' var', 'f=' + n(frequencyHz) + ' Hz', '목표 지상 PF=' + n(targetPF));
      steps.push(step('목표 무효전력', 'Q목표=P tan(acos(PF목표))', n(pWatts) + '×tan(acos(' + n(targetPF) + '))', n(r.desiredQ) + ' var'));
      steps.push(step('커패시터 무효전력', 'Qcap=Q목표−Q부하', n(r.desiredQ) + '−(' + n(qVars) + ')', n(r.qCapacitorVars) + ' var'));
      steps.push(step('각 커패시터', 'C_each=−Qcap/(Nω Vcap²)', '−(' + n(r.qCapacitorVars) + ')/(' + p.phases + '×2π×' + n(frequencyHz) + '×' + n(r.capacitorVoltageRms) + '²)', n(r.recommendedCapacitanceF * 1e6) + ' µF'));
      steps.push(step('보상 후 전류', p.phases === '3' ? '|I선|=√(P²+Q_after²)/(√3V선)' : '|I|=√(P²+Q_after²)/V',
        '√(' + n(pWatts) + '²+' + n(r.qAfterVars) + '²)/(' + (p.phases === '3' ? '√3×' : '') + n(vRms) + ')', n(r.sourceCurrentAfterRms) + ' A RMS'));
      notes.push('C_each는 각 소자의 값입니다. 뱅크 합계와 혼동하지 마세요. 전압은 단상 단자 또는 3상 선간 값입니다.');
      const independentQ = pWatts * Math.sqrt(1 - targetPF ** 2) / targetPF;
      r.checks = [{ label: '목표 Q 별도 삼각형식: P√(1−PF²)/PF', actual: r.qAfterVars, expected: independentQ, unit: 'var', tolerance: 1e-8 + 1e-10 * Math.abs(independentQ), pass: Math.abs(r.qAfterVars - independentQ) <= 1e-8 + 1e-10 * Math.abs(independentQ) }];
    }
    steps.push(step('역률과 부호', 'PF=P/|S|, φ=∠V−∠I', r.power.apparentVA === 0 ? '|S|=0이므로 나눌 수 없음' : n(r.power.pWatts) + '/' + n(r.power.apparentVA),
      (r.power.pf === null ? 'PF 미정' : 'PF=' + n(r.power.pf)) + ' · ' + { leading: '전류 진상 (Q<0)', lagging: '전류 지상 (Q>0)', unity: 'Q≈0', undefined: '위상/역률 미정' }[r.power.nature]));
    const answers = desiredAnswers(goal, r, p.problemKind);
    return { ...r, frequencyHz, displayKind: p.problemKind === 'single' ? 'impedance' : p.problemKind === 'three' ? 'three-phase' : 'correction',
      solution: { statement: String(p.problemText ?? ''), givens, asked: goal, answers, steps, notes, inputOrigin: 'manual-conditions' } };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}
const select = (key, label, initial, choices, showIf) => ({ key, label, initial, choices, showIf });
const quantity = (key, label, kind, unit, min, max, showIf, displayScale = 1) => ({ key, label, quantity: kind, unit, initial: null, min, max, displayScale, showIf });
const num = (key, label, initial, min, max, showIf) => ({ key, label, initial, min, max, unit: '', displayScale: 1, showIf });
const single = p => p.problemKind === 'single', three = p => p.problemKind === 'three', compensation = p => p.problemKind === 'correction';
export const PROBLEM_EXPERIMENT = {
  id: 'problem', title: '내 문제 · 문자식 → 풀이', initialNoSolve: false,
  description: '먼저 기호 조건과 구할 값을 골라 문자식 답·유도를 보세요. 숫자는 시각화 보조입니다. 메모·사진·임의 수식 자동 풀이는 지원하지 않습니다.',
  parameters: [
    select('solutionMode','풀이 방식','symbolic',[['symbolic','문자식 답·유도 (기본)'],['numeric','숫자 대입·그래프 (보조)']]),
    select('problemKind', '문제 유형', 'single', [['single', '단상 · 직렬/병렬 RLC'], ['three', '균형 abc 3상 · Y/Δ'], ['correction', '단상/균형 3상 · 역률보상']]),
    { key: 'problemText', label: '문제 메모 (선택 · 자동 해석하지 않음)', text: true, initial: '', maxLength: 4000 },
    select('singleGoal', '구할 값', 'current', [['current', '전원 복소전류 I'], ['impedance', '등가 Z와 Y'], ['branch', '소자별 전압·전류'], ['power', 'P/Q/|S|'], ['pf', '역률·위상차']], single),
    select('threeGoal', '구할 값', 'line-current', [['line-current', '선전류 Ia/Ib/Ic'], ['phase-current', '부하 상전류'], ['phase-voltage', '부하 상전압'], ['power', '총 P/Q/|S|'], ['pf', '역률·위상차']], three),
    select('correctionGoal', '구할 값', 'capacitance', [['capacitance', '각 보상 커패시터 C'], ['source-current', '보상 전후 공급전류'], ['power', '보상 후 P/Q/|S|'], ['pf', '보상 후 역률']], compensation),
    select('basis', '주어진 전압 진폭 기준', 'rms', [['rms', 'RMS 실효값'], ['peak', 'peak 최댓값']]),
    select('voltageKnown', '주어진 3상 전압', 'line', [['line', '선간 Vab'], ['phase', '부하 상전압 (Y: Van, Δ: Vab)']], three),
    quantity('voltage', '주어진 전압 크기 (V/mV/kV)', 'voltage', 'V', 1e-12, 1e6),
    { ...quantity('frequencyHz', 'f 또는 ω (Hz/kHz/rad/s) · 3상 Z 문제는 선택', 'frequency', 'Hz', 1e-9, 1e6), optionalIf: three },
    { ...quantity('sourceAngle', '주어진 전압 기준 위상 (°/deg/rad) · 기준 없으면 0', 'angle', 'deg', -36000, 36000, p => !compensation(p)), initial: 0 },
    select('topology', 'RLC 연결', 'series', [['series', '직렬'], ['parallel', '병렬']], single),
    select('elements', '실제 있는 소자', 'RL', ['R', 'L', 'C', 'RL', 'RC', 'LC', 'RLC'].map(v => [v, v]), single),
    select('connection', '3상 부하 / C뱅크 결선', 'Y', [['Y', 'Y'], ['delta', 'Δ']], p => three(p) || (compensation(p) && p.phases === '3')),
    quantity('r', 'R 또는 상 임피던스 실수부 (Ω/kΩ)', 'resistance', 'ohm', 0, 1e9, p => three(p) || (single(p) && p.elements.includes('R'))),
    quantity('l', 'L (기본 mH · H/uH도 가능)', 'inductance', 'mH', 1e-15, 1e6, p => single(p) && p.elements.includes('L'), 1e-3),
    quantity('c', 'C (기본 µF · nF/F도 가능)', 'capacitance', 'uF', 1e-15, 1e3, p => single(p) && p.elements.includes('C'), 1e-6),
    quantity('x', '상 임피던스 허수부 X (Ω/kΩ · 용량성 −)', 'resistance', 'ohm', -1e9, 1e9, three),
    select('phases', '보상 문제의 상수', '1', [['1', '단상'], ['3', '균형 3상']], compensation),
    quantity('pWatts', '보상 전 총 P (W/kW)', 'power', 'W', 1e-12, 1e9, compensation),
    quantity('qVars', '보상 전 총 Q (var/kvar · 지상 +)', 'reactive', 'var', -1e9, 1e9, compensation),
    { ...num('targetPF', '목표 지상 PF (0~1)', null, .001, 1, compensation) }
  ],
  assumptions: ['지원: 주어진 전압으로 구동하는 단상 직렬/병렬 R/L/C, 균형 abc 3상 수동 동일 부하, 병렬 커패시터 보상.',
    '임의 연결 회로, 불평형, 중성선 이동, 고조파, 과도응답은 이 문제풀이 모드에서 지원하지 않습니다.',
    '사진/PDF 자동 인식·OCR·수식 자동 해석은 미지원입니다. 문제의 수치 조건을 직접 입력하세요.',
    '주어진 위상이 없으면 입력한 0°를 기준으로 삼습니다. 3상은 주어진 Vab/부하 상전압의 위상을 뜻합니다.',
    '빈 필수 조건은 오류로 표시합니다. 3상에 Z가 직접 주어지면 주파수 없이 페이저 답을 구하고 파형을 생략합니다.'],
  formulas: ['① 주어진 조건·단위 확인 → ② RMS 환산 → ③ 복소 회로 대입 → ④ 구할 값 표시', '계산과정과 그래프는 같은 적용 입력을 사용합니다.', '새 숫자를 넣었으면 문제 풀기를 눌러야 답이 갱신됩니다.'],
  examples: [
    { label: '가상 검산문제 · RL', values: { solutionMode:'numeric', problemKind: 'single', problemText: '가상 검산문제: 100 V RMS, 50 Hz, R=3 Ω, L=12.7324 mH 직렬. I를 구하라.', basis: 'rms', singleGoal: 'current', voltage: 100, frequencyHz: 50, sourceAngle: 0, topology: 'series', elements: 'RL', r: 3, l: 4 / (100 * Math.PI) } },
    { label: '가상 검산문제 · 3상', values: { solutionMode:'numeric', problemKind: 'three', problemText: '가상 검산문제: abc, Vab=400∠30° V RMS, Y 상 Z=8+j6 Ω. 선전류를 구하라.', basis: 'rms', voltageKnown: 'line', voltage: 400, frequencyHz: 50, sourceAngle: 30, connection: 'Y', r: 8, x: 6, threeGoal: 'line-current' } }
  ], evaluate: solveCourseProblem
};

const numericProblemKeys = new Set(['voltage','frequencyHz','sourceAngle','r','l','c','x','pWatts','qVars','targetPF']);
for (const d of PROBLEM_EXPERIMENT.parameters) if (numericProblemKeys.has(d.key)) { const condition=d.showIf; d.showIf=p=>p.solutionMode==='numeric'&&(!condition||condition(p)); }
const symbolicField=(key,label,initial,showIf)=>({key,label,text:true,initial,maxLength:24,showIf:p=>p.solutionMode==='symbolic'&&(!showIf||showIf(p)),singleLine:true});
PROBLEM_EXPERIMENT.parameters.push(
 symbolicField('symbolVoltage','전압 기호 (RMS/peak는 위 선택)', 'V'),
 symbolicField('symbolOmega','각주파수 기호','ω'),
 symbolicField('symbolR','저항 기호','R',p=>single(p)&&p.elements.includes('R')),
 symbolicField('symbolL','인덕턴스 기호','L',p=>single(p)&&p.elements.includes('L')),
 symbolicField('symbolC','정전용량 기호','C',p=>single(p)&&p.elements.includes('C')),
 symbolicField('symbolZ','상 임피던스 기호','Z',three),
 symbolicField('symbolP','총 유효전력 기호','P',compensation),
 symbolicField('symbolQ','총 무효전력 기호','Q',compensation),
 symbolicField('symbolPF','목표 지상 역률 기호','pf_t',compensation)
);
