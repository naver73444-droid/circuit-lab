// "내 문제" numeric solvers for Ch.12–13 homework types: coupled coils (two meshes), the ideal transformer, and the balanced three-phase
// system with a line impedance (Y–Y, Y–Δ, source Y or Δ, abc/acb). They reuse the course models (coupledCoils, idealTransformer, solveThreePhase)
// and only write the worked steps. Pure: no DOM. Result shape = solveCourseProblem's (solution { givens, steps, answers, notes } plus power/phasors/traces/checks).
import { complexPower, magnitude, rectangularPolar, add, sub, multiply, divide, conjugate } from './circuit-course-model.js';
import { coupledCoils, idealTransformer } from './circuit-course-coupled.js';
import { solveThreePhase } from './circuit-course-threephase.js';

export const CHAPTER_KINDS = Object.freeze(['coupled', 'transformer', 'threeline']);
export const CHAPTER_KIND_TITLES = Object.freeze({ coupled: '결합 코일 2루프 (Ch.13)', transformer: '이상 변압기 (Ch.13)', threeline: '균형 3상 + 선로 Zℓ (Ch.12)' });

const n = v => Number(v.toPrecision(8)).toString();
const z = v => n(v.re) + (v.im < 0 ? ' − j' : ' + j') + n(Math.abs(v.im));
const a = v => { const p = rectangularPolar(v); return n(p.magnitude) + ' ∠ ' + (p.angleDeg === null ? '미정' : n(p.angleDeg) + '°'); };
const answer = (label, value, unit) => ({ label, value, unit });
const complexAnswer = (label, value, unit) => ({ label, value: magnitude(value), complex: { ...value }, unit, text: z(value) + ' = ' + a(value) });
const step = (label, formula, substitution, result) => ({ label, formula, substitution, result });
const trace = (label, unit, phasor) => ({ label, unit, phasor });
const finite = (v, label, min = -1e12, max = 1e12) => {
  if (v === null || v === undefined || v === '') throw new RangeError('부족한 조건: ' + label + '을 입력하세요.');
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new RangeError(label + ': 단위와 허용 범위를 확인하세요.');
  return v;
};
const choices = (value, allowed, label) => { if (!allowed.includes(value)) throw new RangeError(label + ': 지원되는 선택을 확인하세요.'); };
const mapChecks = list => list.map(c => ({ label: c.label, actual: c.actual, expected: c.expected ?? 0, unit: c.unit ?? '', tolerance: c.tol ?? c.tolerance, pass: Boolean(c.pass) }));
const check = (label, actual, expected, unit, scale) => { const tolerance = 1e-8 + 1e-9 * scale; return { label, actual, expected, unit, tolerance, pass: Math.abs(actual - expected) <= tolerance }; };
const complexCheck = (label, x, y, unit) => check(label, magnitude(sub(x, y)), 0, unit, Math.max(magnitude(x), magnitude(y)));
const jOf = (w, l) => ({ re: 0, im: w * l });
const powerAnswers = (power, extra = []) => [answer('전원 유효전력 P', power.pWatts, 'W'), answer('전원 무효전력 Q', power.qVars, 'var'), answer('전원 피상전력 |S|', power.apparentVA, 'VA'), ...extra];

function coupled(p, vRms, phase, base) {
  const f = finite(p.frequencyHz, '주파수 f 또는 ω', 1e-9, 1e6);
  const z1 = { re: finite(p.z1R, '1차 직렬 Z1 실수부', 0, 1e9), im: finite(p.z1X, '1차 직렬 Z1 허수부', -1e9, 1e9) };
  const zl = { re: finite(p.zlR, '2차 부하 ZL 실수부', 0, 1e9), im: finite(p.zlX, '2차 부하 ZL 허수부', -1e9, 1e9) };
  const l1 = finite(p.l1, 'L1', 1e-15, 1e6), l2 = finite(p.l2, 'L2', 1e-15, 1e6);
  choices(p.couplingMode, ['M', 'k'], '결합 입력'); choices(p.dots, ['same', 'opposite'], '점 위치');
  const m = p.couplingMode === 'M' ? finite(p.mInd, '상호 인덕턴스 M', 0, 1e6) : undefined, k = p.couplingMode === 'k' ? finite(p.kCoupling, '결합계수 k', 0, 1) : undefined;
  const goal = p.coupledGoal; choices(goal, ['currents', 'zin', 'power'], '구할 값');
  const r = coupledCoils({ frequencyHz: f, l1, l2, couplingMode: p.couplingMode, m, k, dots: p.dots, z1, zl, voltageRms: vRms, voltageDeg: phase });
  if (r.status !== 'valid') return { status: 'invalid', reason: r.reason };
  const w = r.omega, s = r.dotSign, sign = s > 0 ? '−' : '+', jwm = jOf(w, r.M), V = r.V;
  const givens = [...base.givens, 'f=' + n(f) + ' Hz (ω=' + n(w) + ' rad/s)', 'Z1=' + z(z1) + ' Ω', 'ZL=' + z(zl) + ' Ω', 'L1=' + n(l1) + ' H, L2=' + n(l2) + ' H',
    p.couplingMode === 'M' ? 'M=' + n(r.M) + ' H (k=' + n(r.k) + ')' : 'k=' + n(r.k) + ' → M=' + n(r.M) + ' H', '점 위치: ' + (p.dots === 'same' ? '같은 쪽' : '반대쪽')];
  const steps = [...base.steps,
    step('각주파수와 코일 리액턴스', 'ω=2πf, X=ωL, X_M=ωM' + (p.couplingMode === 'k' ? ', M=k√(L1L2)' : ''), 'ω=2π×' + n(f) + '; jωL1=j' + n(w * l1) + ', jωL2=j' + n(w * l2) + ', jωM=j' + n(w * r.M), n(w) + ' rad/s'),
    step('메시 방정식 두 줄', '(Z1+jωL1) I1 ' + sign + ' jωM I2 = V,  ' + sign + ' jωM I1 + (ZL+jωL2) I2 = 0',
      '(' + z(r.z11) + ') I1 ' + sign + ' j' + n(w * r.M) + ' I2 = ' + z(V) + ',  ' + sign + ' j' + n(w * r.M) + ' I1 + (' + z(r.z22) + ') I2 = 0',
      '점 규약(두 메시 전류를 모두 시계방향으로 잡음): 점이 ' + (p.dots === 'same' ? '같은 쪽이면 상호 전압항이 −jωM (교재 예제 13.1의 배치)' : '반대쪽이면 상호 전압항이 +jωM') + '. 한 코일의 점으로 들어가는 전류가 다른 코일에서는 점에서 나오면 −jωM, 둘 다 들어가거나 둘 다 나오면 +jωM.'),
    step('2차 루프 임피던스와 반사 임피던스', 'Z22=ZL+jωL2, Z_r=(ωM)²/Z22 (점 위치와 무관: M²)', 'Z22=(' + z(zl) + ')+j' + n(w * l2) + '; Z_r=' + n((w * r.M) ** 2) + '/(' + z(r.z22) + ')', 'Z22=' + z(r.z22) + ' Ω, Z_r=' + z(r.reflected) + ' Ω'),
    step('입력 임피던스', 'Z_in=Z1+jωL1+Z_r', '(' + z(r.z11) + ')+(' + z(r.reflected) + ')', z(r.zin) + ' Ω = ' + a(r.zin) + ' Ω'),
    step('1차 전류', 'I1=V/Z_in', '(' + z(V) + ')/(' + z(r.zin) + ')', a(r.I1) + ' A RMS'),
    step('2차 전류', 'I2=' + (s > 0 ? '' : '−') + 'jωM I1/Z22 (메시 방정식의 둘째 줄)', (s > 0 ? '' : '−') + '(j' + n(w * r.M) + ')×(' + z(r.I1) + ')/(' + z(r.z22) + ')', a(r.I2) + ' A RMS (2차 메시 시계방향)'),
    step('전력', 'S=V I1*, P_Z1=|I1|² Re(Z1), P_L=|I2|² Re(ZL)', 'S=(' + z(V) + ')×(' + z(conjugate(r.I1)) + ')', z(r.Ssource) + ' VA; P_Z1=' + n(r.pZ1) + ' W, P_L=' + n(r.pLoad) + ' W')];
  const power = complexPower(V, r.I1);
  const answers = goal === 'currents' ? [complexAnswer('1차 전류 I1 RMS', r.I1, 'A'), complexAnswer('2차 전류 I2 RMS', r.I2, 'A')]
    : goal === 'zin' ? [complexAnswer('2차 루프 Z22', r.z22, 'Ω'), complexAnswer('반사 임피던스 Z_r=(ωM)²/Z22', r.reflected, 'Ω'), complexAnswer('입력 임피던스 Z_in', r.zin, 'Ω')]
      : powerAnswers(power, [answer('Z1에서 소비하는 유효전력', r.pZ1, 'W'), answer('부하 ZL에서 소비하는 유효전력', r.pLoad, 'W')]);
  const notes = [...base.notes, '이상 모델: 코일 저항은 Z1·ZL에 넣어 주세요. k ≤ 1 (M ≤ √(L1L2)). I2는 2차 메시를 시계방향으로 잡은 전류이고, 점 핀으로 들어가는 방향으로 읽으면 부호가 바뀝니다 (교재 13.5·13.6).'];
  const checks = [...mapChecks(r.checks), check('2차 루프 KVL: |−s jωM I1 + Z22 I2|', magnitude(add(multiply({ re: 0, im: -s * w * r.M }, r.I1), multiply(r.z22, r.I2))), 0, 'V', magnitude(V)),
    check('전원 유효전력 = Z1 + 부하 소비', power.pWatts, r.pZ1 + r.pLoad, 'W', power.apparentVA)];
  return { status: 'valid', goal, displayKind: 'chapter', frequencyHz: f, power, V, I: r.I1, Z: r.zin, answers, givens, steps, notes, checks,
    phasors: [{ label: 'V', unit: 'V', z: V }, { label: 'Vo (ZL 양단)', unit: 'V', z: r.Vo }, { label: 'I1', unit: 'A', z: r.I1 }, { label: 'I2', unit: 'A', z: r.I2 }],
    traces: [trace('v(t)', 'V', V), trace('i1(t)', 'A', r.I1), trace('i2(t)', 'A', r.I2)] };
}

function transformer(p, vRms, phase, base) {
  const nRatio = finite(p.turnsRatio, '권수비 n=N2/N1', 1e-9, 1e9);
  const z1 = { re: finite(p.z1R, '1차 직렬 Z1 실수부', 0, 1e9), im: finite(p.z1X, '1차 직렬 Z1 허수부', -1e9, 1e9) };
  const zl = { re: finite(p.zlR, '2차 부하 ZL 실수부', 0, 1e9), im: finite(p.zlX, '2차 부하 ZL 허수부', -1e9, 1e9) };
  choices(p.dots, ['same', 'opposite'], '점 위치'); choices(p.i2Direction, ['out', 'in'], 'I2 기준 방향');
  const goal = p.xfmrGoal; choices(goal, ['zin', 'currents', 'v2', 'power'], '구할 값');
  const r = idealTransformer({ turns1: 1, turns2: nRatio, dots: p.dots, i2Direction: p.i2Direction, z1, zl, voltageRms: vRms, voltageDeg: phase });
  if (r.status !== 'valid') return { status: 'invalid', reason: r.reason };
  const sgn = r.dotSign > 0 ? '+' : '−', cr = r.currentRatioSign > 0 ? '+' : '−', loadI = r.loadCurrent;
  const pZ1 = magnitude(r.I1) ** 2 * z1.re, pLoad = magnitude(loadI) ** 2 * zl.re, power = complexPower(r.Vs, r.I1);
  const givens = [...base.givens, 'n=N2/N1=' + n(nRatio) + ' (' + r.step + ')', 'Z1=' + z(z1) + ' Ω', 'ZL=' + z(zl) + ' Ω', '점 위치: V1·V2 점 극성이 ' + (p.dots === 'same' ? '같은 쪽' : '반대쪽'), 'I2 기준: ' + (p.i2Direction === 'out' ? '2차 + 단자에서 부하로 나감' : '2차 + 단자로 들어옴')];
  const steps = [...base.steps,
    step('부호 규약', 'V2/V1=' + sgn + 'n,  I2/I1=' + cr + '1/n', '점 ' + (p.dots === 'same' ? '같은 쪽 → V2=+nV1' : '반대쪽 → V2=−nV1') + '; I2 ' + (p.i2Direction === 'out' ? '부하로 나가는 방향' : '2차 + 단자로 들어오는 방향'),
      'V1·V2 점 극성이 같으면 +n, I1·I2가 모두 점으로 들어가거나 모두 나오면 −1/n (교재 13.5절). 전력은 부호와 무관하게 S1=S2.'),
    step('반사 임피던스', 'Z_r=ZL/n² (1차에서 본 부하)', '(' + z(zl) + ')/' + n(nRatio) + '²', z(r.zin) + ' Ω'),
    step('입력 임피던스', 'Z_in=Z1+Z_r', '(' + z(z1) + ')+(' + z(r.zin) + ')', z(r.total) + ' Ω = ' + a(r.total) + ' Ω'),
    step('1차 전류와 1차 전압', 'I1=Vs/Z_in, V1=I1 Z_r', '(' + z(r.Vs) + ')/(' + z(r.total) + ')', 'I1=' + a(r.I1) + ' A, V1=' + a(r.V1) + ' V RMS'),
    step('2차 전압·전류', 'V2=' + sgn + 'n V1,  I2=' + cr + 'I1/n', 'V2=' + sgn + n(nRatio) + '×(' + z(r.V1) + '),  I2=' + cr + '(' + z(r.I1) + ')/' + n(nRatio), 'V2=' + a(r.V2) + ' V, I2=' + a(r.I2) + ' A RMS'),
    step('전력', 'S1=V1 I1*=S2, S_전원=Vs I1*, P_L=|I_부하|² Re(ZL)', 'S1=(' + z(r.V1) + ')×(' + z(conjugate(r.I1)) + ')', 'S1=S2=' + z(r.S1) + ' VA; S_전원=' + z(r.Ssource) + ' VA; P_L=' + n(pLoad) + ' W')];
  const answers = goal === 'zin' ? [complexAnswer('반사 임피던스 Z_r=ZL/n²', r.zin, 'Ω'), complexAnswer('입력 임피던스 Z_in=Z1+ZL/n²', r.total, 'Ω')]
    : goal === 'currents' ? [complexAnswer('1차 전류 I1 RMS', r.I1, 'A'), complexAnswer('2차 전류 I2 RMS (선택한 기준 방향)', r.I2, 'A')]
      : goal === 'v2' ? [complexAnswer('1차 권선 전압 V1 RMS', r.V1, 'V'), complexAnswer('2차 전압 V2=Vo RMS', r.V2, 'V')]
        : powerAnswers(power, [answer('권선 전력 |S1|=|S2|', magnitude(r.S1), 'VA'), answer('Z1에서 소비하는 유효전력', pZ1, 'W'), answer('부하 ZL에서 소비하는 유효전력', pLoad, 'W')]);
  const notes = [...base.notes, '이상 변압기: 손실·누설·자화 전류가 없고 전력 소비도 저장도 없습니다. 선형(실제) 변압기는 결합 코일 유형으로 푸세요.'];
  const checks = [...mapChecks(r.checks), check('전원 유효전력 = Z1 + 부하 소비', power.pWatts, pZ1 + pLoad, 'W', power.apparentVA),
    complexCheck('전원 복소전력 = Z1 전력 + 부하 전력', r.Ssource, add({ re: pZ1, im: magnitude(r.I1) ** 2 * z1.im }, { re: pLoad, im: magnitude(loadI) ** 2 * zl.im }), 'VA')];
  return { status: 'valid', goal, displayKind: 'chapter', frequencyHz: null, power, V: r.Vs, I: r.I1, Z: r.total, answers, givens, steps, notes, checks,
    phasors: [{ label: 'Vs', unit: 'V', z: r.Vs }, { label: 'V1', unit: 'V', z: r.V1 }, { label: 'V2=Vo', unit: 'V', z: r.V2 }, { label: 'I1', unit: 'A', z: r.I1 }, { label: 'I2', unit: 'A', z: r.I2 }], traces: [] };
}

function threeLine(p, vRms, phase, base) {
  choices(p.sequence, ['abc', 'acb'], '상순서'); choices(p.sourceConnection, ['Y', 'delta'], '전원 결선'); choices(p.sourceVoltageKind, ['line', 'phase'], '주어진 전압 종류');
  choices(p.reference, ['Van', 'Vab'], '기준 페이저'); choices(p.connection, ['Y', 'delta'], '부하 결선');
  const goal = p.threeGoal; choices(goal, ['line-current', 'phase-current', 'phase-voltage', 'power', 'pf'], '구할 값');
  const zLoad = { re: finite(p.r, '부하 상 임피던스 실수부', 0, 1e9), im: finite(p.x, '부하 상 임피던스 허수부', -1e9, 1e9) };
  const zLine = { re: p.lineR === null || p.lineR === undefined ? 0 : finite(p.lineR, '선로 Zℓ 실수부', 0, 1e9), im: p.lineX === null || p.lineX === undefined ? 0 : finite(p.lineX, '선로 Zℓ 허수부', -1e9, 1e9) };
  const frequencyHz = p.frequencyHz === null || p.frequencyHz === undefined ? null : finite(p.frequencyHz, '파형 주파수', 1e-9, 1e6);
  const r = solveThreePhase({ sequence: p.sequence, reference: p.reference, referenceDeg: phase, sourceConnection: p.sourceConnection, voltageKind: p.sourceVoltageKind, voltageRms: vRms,
    lineZ: zLine, loads: [zLoad, zLoad, zLoad], loadConnection: p.connection, neutral: 'none', frequencyHz: frequencyHz ?? undefined });
  if (r.status !== 'valid') return { status: 'invalid', reason: r.reason };
  const delta = p.connection === 'delta', zY = r.equivalentY[0], vph = r.sourceLineVoltage / Math.sqrt(3), I = r.lineCurrents;
  const vanText = a(r.sourceVoltages[0]), vabText = a(r.sourceLineVoltages[0]);
  const givens = [...base.givens, '균형 ' + p.sequence + ' · ' + (p.sourceConnection === 'Y' ? 'Y' : 'Δ') + ' 전원 – ' + (delta ? 'Δ' : 'Y') + ' 부하', '주어진 전압=' + (p.sourceVoltageKind === 'line' ? '선간' : p.sourceConnection === 'Y' ? '전원 상 Van' : '전원 코일(=선간) Vab') + ', 기준 ' + p.reference + '∠' + n(phase) + '°',
    '부하 상 Z=' + z(zLoad) + ' Ω (' + (delta ? 'Δ 한 변' : 'Y 한 상') + ')', '선로 Zℓ=' + z(zLine) + ' Ω'];
  const steps = [...base.steps,
    step('선간·상전압과 기준', p.sequence === 'abc' ? 'abc: Vab=√3 Van∠+30°' : 'acb: Vab=√3 Van∠−30°', 'V상=V선/√3=' + n(vph) + ' V; ' + p.reference + '∠' + n(phase) + '°', 'Van=' + vanText + ' V RMS, Vab=' + vabText + ' V RMS'),
    ...(delta ? [step('Δ 부하를 Y로 바꾸기', 'Z_Y=Z_Δ/3', '(' + z(zLoad) + ')/3', z(zY) + ' Ω')] : []),
    step('한 상 등가회로', 'Ia=Van/(Zℓ+Z_Y)', '(' + z(r.sourceVoltages[0]) + ')/((' + z(zLine) + ')+(' + z(zY) + '))', 'Ia=' + a(I[0]) + ' A RMS'),
    step('다른 두 선전류', p.sequence === 'abc' ? 'Ib=Ia∠−120°, Ic=Ia∠+120°' : 'Ib=Ia∠+120°, Ic=Ia∠−120°', '균형이므로 크기는 같고 위상만 120° 이동', 'Ib=' + a(I[1]) + ' A, Ic=' + a(I[2]) + ' A'),
    ...(delta ? [step('Δ 부하의 상전류·상전압', 'I_AB=V_AB/Z_Δ (|I_L|=√3|I_φ|)', '(' + z(r.loadVoltages[0]) + ')/(' + z(zLoad) + ')', 'V_AB=' + a(r.loadVoltages[0]) + ' V, I_AB=' + a(r.loadCurrents[0]) + ' A RMS')]
      : [step('Y 부하의 상전류·상전압', 'I_φ=I_L, V_φ=I_L Z_Y', '(' + z(I[0]) + ')×(' + z(zLoad) + ')', 'V_an\'=' + a(r.loadVoltages[0]) + ' V, I_φ=' + a(r.loadCurrents[0]) + ' A RMS')]),
    step('전력', 'S=3 V상 I선*, 선로 손실=3|I|² Zℓ', 'S_전원=' + z(r.power.source) + ' VA', 'S_부하=' + z(r.power.load) + ' VA (P=' + n(r.power.load.re) + ' W, Q=' + n(r.power.load.im) + ' var), 선로=' + z(r.power.line) + ' VA')];
  const loadPower = r.loadPower;
  let answers;
  if (goal === 'line-current') answers = I.map((i, k) => complexAnswer(['Ia', 'Ib', 'Ic'][k] + ' 선전류 RMS', i, 'A'));
  else if (goal === 'phase-current') answers = r.loadCurrents.map((i, k) => complexAnswer('부하 ' + (delta ? ['I_AB', 'I_BC', 'I_CA'] : ['I_AN', 'I_BN', 'I_CN'])[k] + ' RMS', i, 'A'));
  else if (goal === 'phase-voltage') answers = r.loadVoltages.map((v, k) => complexAnswer('부하 ' + (delta ? ['V_AB', 'V_BC', 'V_CA'] : ['V_AN', 'V_BN', 'V_CN'])[k] + ' RMS', v, 'V'));
  else if (goal === 'power') answers = [answer('부하 총 유효전력 P', loadPower.pWatts, 'W'), answer('부하 총 무효전력 Q', loadPower.qVars, 'var'), answer('부하 총 피상전력 |S|', loadPower.apparentVA, 'VA'),
    answer('선로 손실 유효전력', r.power.line.re, 'W'), answer('전원 총 유효전력', r.power.source.re, 'W')];
  else answers = [answer('부하 역률 P/|S|', loadPower.pf, ''), answer('부하 위상차 φ=arg(Z)', Math.atan2(zLoad.im, zLoad.re) * 180 / Math.PI, '°')];
  const single = divide(r.sourceVoltages[0], add(zLine, zY));
  const checks = [...mapChecks(r.checks), complexCheck('한 상 등가회로 Ia = Van/(Zℓ+Z_Y) 대조', I[0], single, 'A'),
    check('균형 3상: |Ib|, |Ic| = |Ia|', Math.abs(magnitude(I[1]) - magnitude(I[0])) + Math.abs(magnitude(I[2]) - magnitude(I[0])), 0, 'A', magnitude(I[0]))];
  const notes = [...base.notes, '균형 부하·균형 전원의 3선식입니다. 중성선·불평형은 범위 밖이며, 전원이 Δ이면 같은 선간전압의 등가 Y 전원으로 바꿔 풉니다. 상순서는 ' + p.sequence + '.'];
  if (frequencyHz === null) notes.push('주파수가 주어지지 않아 시간파형은 생략했습니다.');
  return { status: 'valid', goal, displayKind: 'chapter', frequencyHz, power: loadPower, V: r.sourceVoltages[0], I: I[0], Z: zY, answers, givens, steps, notes, checks,
    phasors: [...r.sourceVoltages.map((v, i) => ({ label: ['Van', 'Vbn', 'Vcn'][i], unit: 'V', z: v })), ...I.map((v, i) => ({ label: ['Ia', 'Ib', 'Ic'][i], unit: 'A', z: v }))],
    traces: frequencyHz ? r.sourceVoltages.map((v, i) => trace(['van(t)', 'vbn(t)', 'vcn(t)'][i], 'V', v)) : [] };
}

/** p: the "내 문제" parameter object (SI numbers, null for an empty optional field). Returns the same result shape as solveCourseProblem. */
export function solveChapterProblem(p) {
  try {
    choices(p.problemKind, CHAPTER_KINDS, '문제 유형'); choices(p.basis, ['rms', 'peak'], '진폭 기준');
    const vInput = finite(p.voltage, '주어진 전압', 1e-12, 1e6), vRms = p.basis === 'peak' ? vInput / Math.SQRT2 : vInput;
    const phase = finite(p.sourceAngle, '주어진 전압의 기준 위상', -36000, 36000);
    const base = {
      givens: ['전압 크기=' + n(vInput) + ' V ' + p.basis + ' → ' + n(vRms) + ' V RMS', '기준 위상=' + n(phase) + '°'],
      steps: [{ label: '전압 실효값으로 통일', formula: p.basis === 'peak' ? 'V_RMS=V_peak/√2' : 'V_RMS=V_given', substitution: p.basis === 'peak' ? n(vInput) + '/√2' : n(vInput), result: n(vRms) + ' V RMS' }],
      notes: ['사용자가 입력한 조건을 선택한 이상 모델에 대입했습니다. 문제 메모를 자동 해석하지 않습니다.', '정현파 정상상태, RMS 페이저, 수동부호. Q>0 지상/유도성, Q<0 진상/용량성.']
    };
    const body = p.problemKind === 'coupled' ? coupled(p, vRms, phase, base) : p.problemKind === 'transformer' ? transformer(p, vRms, phase, base) : threeLine(p, vRms, phase, base);
    if (body.status !== 'valid') return body;
    const power = body.power;
    body.steps.push({ label: '역률과 부호', formula: 'PF=P/|S|, φ=∠V−∠I', substitution: power.apparentVA === 0 ? '|S|=0이므로 나눌 수 없음' : n(power.pWatts) + '/' + n(power.apparentVA),
      result: (power.pf === null ? 'PF 미정' : 'PF=' + n(power.pf)) + ' · ' + { leading: '전류 진상 (Q<0)', lagging: '전류 지상 (Q>0)', unity: 'Q≈0', undefined: '위상/역률 미정' }[power.nature] });
    const { goal, answers, givens, steps, notes, ...rest } = body;
    return { ...rest, solution: { statement: String(p.problemText ?? ''), givens, asked: goal, answers, steps, notes, inputOrigin: 'manual-conditions' } };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}
