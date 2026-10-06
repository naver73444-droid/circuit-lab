// General three-phase model for the course: Y/Δ source, line impedance, Y/Δ load with per-phase Z, optional neutral wire.
// Everything is RMS; a Δ source is replaced by its equivalent Y source (Vp/√3 ∠−30° for abc), a Δ load by its Y equivalent.
import { complexPower, waveSample, SEQUENCE_OFFSETS, vanAngleOf } from './circuit-course-model.js';
import { add, sub, multiply, divide, conjugate, magnitude, polar, sum, solveLinear, cz, neg } from './circuit-course-complex.js';

const finite = z => Number.isFinite(z.re) && Number.isFinite(z.im);
const sconj = (V, I) => multiply(V, conjugate(I));
const NEUTRALS = ['none', 'ideal', 'impedance'];

function checkImpedance(z, label, { allowZero = false } = {}) {
  if (!z || !finite(z)) throw new RangeError(label + ': 유한한 복소 임피던스가 필요합니다.');
  if (z.re < 0) throw new RangeError(label + ': 수동 소자 R은 0 이상이어야 합니다.');
  if (!allowZero && magnitude(z) === 0) throw new RangeError(label + ': |Z|=0 은 계산할 수 없습니다.');
  return z;
}

// Line voltage of the source and the equivalent Y phase voltages (a, b, c).
export function sourceVoltages({ sequence = 'abc', reference = 'Van', referenceDeg = 0, sourceConnection = 'Y', voltageKind = 'phase', voltageRms }) {
  if (!Object.hasOwn(SEQUENCE_OFFSETS, sequence)) throw new RangeError('상순서는 abc 또는 acb여야 합니다.');
  if (!['Van', 'Vab'].includes(reference)) throw new RangeError('기준은 Van 또는 Vab여야 합니다.');
  if (!['Y', 'delta'].includes(sourceConnection)) throw new RangeError('전원 결선은 Y 또는 Δ여야 합니다.');
  if (!['phase', 'line'].includes(voltageKind)) throw new RangeError('전압 종류는 상(코일) 또는 선간이어야 합니다.');
  if (!Number.isFinite(voltageRms) || voltageRms <= 0) throw new RangeError('전원 전압은 0보다 커야 합니다.');
  if (!Number.isFinite(referenceDeg)) throw new RangeError('기준 위상이 유한한 숫자가 아닙니다.');
  const line = sourceConnection === 'Y' && voltageKind === 'phase' ? Math.sqrt(3) * voltageRms : voltageRms;
  const phase = line / Math.sqrt(3), van = vanAngleOf(referenceDeg % 360, reference, sequence);
  const V = SEQUENCE_OFFSETS[sequence].map(a => polar(phase, van + a));
  return { line, phase, V, lineVoltages: V.map((v, i) => sub(v, V[(i + 1) % 3])) };
}

function deltaToY([zab, zbc, zca]) {
  const total = add(add(zab, zbc), zca);
  if (magnitude(total) === 0) throw new RangeError('Δ 부하 세 임피던스의 합이 0입니다.');
  return [divide(multiply(zab, zca), total), divide(multiply(zab, zbc), total), divide(multiply(zbc, zca), total)];
}

// Y network with optional neutral, solved as one small linear system in [Ia, Ib, Ic, VnN] so that a series-resonant phase (Zℓ+Z=0) is a normal case:
//   Zt_k I_k + VnN = V_k (k = a, b, c), and the neutral row: ΣI = 0 (no wire), VnN = 0 (ideal wire) or VnN = Zn ΣI (impedance wire).
// No branch admittance is formed, so nothing divides by Zt_k. Only a truly singular network is rejected.
function solveY(V, Zt, neutral, zn) {
  const one = cz(1, 0), zero = cz(0, 0);
  const rows = [0, 1, 2].map(k => [0, 1, 2].map(c => (c === k ? Zt[k] : zero)).concat([one]));
  rows.push(neutral === 'ideal' ? [zero, zero, zero, one] : neutral === 'impedance' ? [zn, zn, zn, neg(one)] : [one, one, one, zero]);
  const rhs = [V[0], V[1], V[2], zero];
  const singular = () => new RangeError('선로·부하·중성선 임피던스 조합이 특이해 전류를 정할 수 없습니다 (연립방정식이 풀리지 않음).');
  let x;
  try { x = solveLinear(rows, rhs); } catch { throw singular(); }
  if (!x.every(finite)) throw singular();
  // A nearly singular pivot can slip through the exact-zero test: accept the solution only if it satisfies every equation.
  const residual = Math.max(...rows.map((row, r) => magnitude(sub(sum(row.map((m, c) => multiply(m, x[c]))), rhs[r]))));
  const bound = Math.max(...V.map(magnitude)) + Math.max(...x.map(magnitude)) * Math.max(...Zt.map(magnitude), 1);
  if (!(residual <= 1e-9 * bound)) throw singular();
  return { I: [x[0], x[1], x[2]], shift: x[3] };
}

// Independent mesh solution for a 3-wire Y network (two meshes through Za', Zb', Zc'); used as a cross-check.
function meshCheck(V, Zt) {
  const [ia, ib] = solveLinear(
    [[Zt[0], neg(Zt[1])], [Zt[2], add(Zt[1], Zt[2])]],
    [sub(V[0], V[1]), sub(V[1], V[2])]);
  return [ia, ib, neg(add(ia, ib))];
}

export function solveThreePhase(p) {
  try {
    const src = sourceVoltages(p);
    const zl = checkImpedance(p.lineZ ?? cz(0, 0), '선로 Zℓ', { allowZero: true });
    const loads = p.loads;
    if (!Array.isArray(loads) || loads.length !== 3) throw new RangeError('부하 임피던스 3개가 필요합니다.');
    loads.forEach((z, i) => checkImpedance(z, '부하 ' + ['a(AB)', 'b(BC)', 'c(CA)'][i]));
    if (!['Y', 'delta'].includes(p.loadConnection)) throw new RangeError('부하 결선은 Y 또는 Δ여야 합니다.');
    const neutral = p.loadConnection === 'Y' ? (p.neutral ?? 'none') : 'none';
    if (!NEUTRALS.includes(neutral)) throw new RangeError('중성선은 없음/이상/임피던스 중 하나여야 합니다.');
    const zn = neutral === 'impedance' ? checkImpedance(p.neutralZ, '중성선 Zn') : cz(0, 0);
    const delta = p.loadConnection === 'delta';
    const yLoads = delta ? deltaToY(loads) : loads;
    const Zt = yLoads.map(z => add(z, zl));
    if (neutral === 'ideal' && Zt.some(z => magnitude(z) === 0)) throw new RangeError('이상 중성선에서는 Zℓ+Z=0 인 상을 계산할 수 없습니다.');
    const { I, shift } = solveY(src.V, Zt, neutral, zn);
    const neutralSum = sum(I);
    const toLoad = I.map((i, k) => sub(src.V[k], multiply(zl, i)));
    const terminal = toLoad.map((v, k) => sub(v, toLoad[(k + 1) % 3]));
    let loadVoltages, loadCurrents, loadS;
    if (delta) {
      loadVoltages = terminal;
      loadCurrents = terminal.map((v, k) => divide(v, loads[k]));
    } else {
      loadVoltages = I.map((i, k) => multiply(loads[k], i));
      loadCurrents = I;
    }
    loadS = sum(loadVoltages.map((v, k) => sconj(v, loadCurrents[k])));
    const sourceS = sum(src.V.map((v, k) => sconj(v, I[k])));
    const lineS = sum(I.map(i => multiply(zl, cz(magnitude(i) ** 2, 0))));
    const neutralS = neutral === 'none' ? cz(0, 0) : multiply(zn, cz(magnitude(neutralSum) ** 2, 0));
    const residual = sub(sub(sub(sourceS, lineS), loadS), neutralS);
    const scaleVA = Math.max(magnitude(sourceS), 1e-12);
    const iMax = Math.max(...I.map(magnitude), 1e-12);
    const checks = [{ label: '전력 보존: S전원 − S선로 − S부하 − S중성선', actual: magnitude(residual), expected: 0, unit: 'VA', tol: 1e-9 * scaleVA + 1e-9 }];
    if (neutral === 'none') {
      const mesh = meshCheck(src.V, Zt);
      checks.push({ label: 'KCL: |Ia+Ib+Ic| (3선식)', actual: magnitude(neutralSum), expected: 0, unit: 'A', tol: 1e-9 * iMax + 1e-12 });
      checks.push({ label: '메시 해석 대조: max|I노드 − I메시|', actual: Math.max(...I.map((x, k) => magnitude(sub(x, mesh[k])))), expected: 0, unit: 'A', tol: 1e-8 * iMax + 1e-12 });
    }
    if (delta) {
      const lineFromPhase = loadCurrents.map((x, k) => sub(x, loadCurrents[(k + 2) % 3]));
      checks.push({ label: 'Δ 부하: Ia=IAB−ICA 대조', actual: Math.max(...I.map((x, k) => magnitude(sub(x, lineFromPhase[k])))), expected: 0, unit: 'A', tol: 1e-8 * iMax + 1e-12 });
    }
    for (const c of checks) c.pass = c.actual <= c.tol;
    const balanced = loads.every(z => magnitude(sub(z, loads[0])) <= 1e-12 * magnitude(loads[0]));
    return {
      status: 'valid', sequence: p.sequence ?? 'abc', sourceConnection: p.sourceConnection, loadConnection: p.loadConnection, neutral,
      sourceLineVoltage: src.line, sourceVoltages: src.V, sourceLineVoltages: src.lineVoltages,
      lineCurrents: I, neutralShift: shift, neutralCurrent: neg(neutralSum), neutralSum,
      loadVoltages, loadCurrents, terminalLineVoltages: terminal, equivalentY: yLoads,
      power: { source: sourceS, line: lineS, load: loadS, neutral: neutralS, residual }, loadPower: complexPower({ re: 1, im: 0 }, { re: loadS.re, im: -loadS.im }),
      sourceLoadSum: add(lineS, loadS), balanced, checks,
      totalPower: t => sum(loadVoltages.map((v, k) => waveSample(v, p.frequencyHz ?? 50, t) * waveSample(loadCurrents[k], p.frequencyHz ?? 50, t)).map(x => cz(x, 0))).re
    };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

// Example 12.7: V_L, I_L and P of a three-phase load give S = √3 V_L I_L and pf = P/S.
export function pfFromLineData({ lineVoltageRms, lineCurrentRms, pWatts, nature = 'lagging' }) {
  try {
    for (const [v, label] of [[lineVoltageRms, '선간 전압'], [lineCurrentRms, '선전류'], [pWatts, '유효전력 P']]) {
      if (!Number.isFinite(v) || v <= 0) throw new RangeError(label + '은(는) 0보다 커야 합니다.');
    }
    if (!['lagging', 'leading'].includes(nature)) throw new RangeError('lagging 또는 leading을 선택하세요.');
    const apparentVA = Math.sqrt(3) * lineVoltageRms * lineCurrentRms;
    if (pWatts > apparentVA * (1 + 1e-12)) throw new RangeError('P가 √3·VL·IL 보다 클 수 없습니다. 입력을 확인하세요.');
    const pf = Math.min(1, pWatts / apparentVA), theta = Math.acos(pf);
    const q = Math.sqrt(Math.max(0, apparentVA ** 2 - pWatts ** 2)) * (nature === 'lagging' ? 1 : -1);
    return { status: 'valid', apparentVA, pf, thetaDeg: theta * 180 / Math.PI * (nature === 'lagging' ? 1 : -1), pWatts, qVars: q, nature };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

// Two-wattmeter method (balanced load): meters in lines a and c, common (voltage-coil) line b, read at the load terminals.
//   meter a: Re(Vab·Ia*), meter c: Re(Vcb·Ic*). W1 is the reading V_L·I_L·cos(θ+30°), W2 the one V_L·I_L·cos(θ−30°) (θ = load impedance angle; Alexander & Sadiku §12.10 convention):
//   for abc the a meter is W1 and the c meter W2, for acb the roles swap. W1+W2 = P and √3(W2−W1) = Q (Q>0 inductive).
// The meters are computed from the solved voltages and currents; the checks compare them with the closed forms, so the two paths are independent.
export function twoWattmeter(r, loadZ) {
  const [Vab, Vbc] = r.terminalLineVoltages, Vcb = neg(Vbc), Ia = r.lineCurrents[0], Ic = r.lineCurrents[2];
  const meterA = sconj(Vab, Ia).re, meterC = sconj(Vcb, Ic).re, abc = r.sequence !== 'acb';
  const W1 = abc ? meterA : meterC, W2 = abc ? meterC : meterA;
  const thetaDeg = Math.atan2(loadZ.im, loadZ.re) * 180 / Math.PI, th = thetaDeg * Math.PI / 180, d30 = Math.PI / 6;
  const VL = magnitude(Vab), IL = (magnitude(r.lineCurrents[0]) + magnitude(r.lineCurrents[1]) + magnitude(r.lineCurrents[2])) / 3;
  const P = r.power.load.re, Q = r.power.load.im, scale = Math.max(Math.sqrt(3) * VL * IL, 1e-12), tol = 1e-9 * scale + 1e-9;
  const mk = (label, actual, expected) => ({ label, actual, expected, unit: 'W', tol, pass: Math.abs(actual - expected) <= tol });
  const checks = [
    mk('W1 = V_L·I_L·cos(θ+30°)', W1, VL * IL * Math.cos(th + d30)),
    mk('W2 = V_L·I_L·cos(θ−30°)', W2, VL * IL * Math.cos(th - d30)),
    mk('W1 + W2 = P (부하 유효전력)', W1 + W2, P),
    { ...mk('√3(W2 − W1) = Q (부하 무효전력)', Math.sqrt(3) * (W2 - W1), Q), unit: 'var' }
  ];
  const negative = thetaDeg > 60 + 1e-9 ? 'W1' : thetaDeg < -60 - 1e-9 ? 'W2' : null;
  return { W1, W2, meterA, meterC, W1Line: abc ? 'a' : 'c', W2Line: abc ? 'c' : 'a', thetaDeg, lineVoltage: VL, lineCurrent: IL, total: W1 + W2, reactive: Math.sqrt(3) * (W2 - W1), negative, checks, pass: checks.every(c => c.pass) };
}
