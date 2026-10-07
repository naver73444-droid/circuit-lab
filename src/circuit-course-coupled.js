// Chapter 13 models for the course: coupled coils with T/π equivalents, ideal transformer, autotransformer, 3-phase bank.
// RMS phasors, e^{jωt}, passive sign. Pure, no DOM. Dots: 'same' = dots on the same side (mutual term −jωM I for two clockwise meshes),
// 'opposite' = dots on opposite sides (mutual term +jωM I).
import { waveSample } from './circuit-course-model.js';
import { add, sub, multiply, divide, conjugate, magnitude, polar, scale, cz, neg } from './circuit-course-complex.js';

const jw = (w, l) => cz(0, w * l);
const sconj = (V, I) => multiply(V, conjugate(I));
function positive(v, label) {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(label + '은(는) 0보다 커야 합니다.');
  return v;
}
function nonNegative(v, label) {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(label + '은(는) 0 이상이어야 합니다.');
  return v;
}
function finiteComplex(z, label) {
  if (!z || !Number.isFinite(z.re) || !Number.isFinite(z.im)) throw new RangeError(label + ': 유한한 복소수가 필요합니다.');
  return z;
}
const dotSign = dots => {
  if (dots === 'same') return 1;
  if (dots === 'opposite') return -1;
  throw new RangeError('점 위치는 같은 쪽 또는 반대쪽이어야 합니다.');
};

// Mutual inductance from M or from the coupling coefficient k = M/√(L1 L2); both must respect 0 ≤ k ≤ 1.
export function mutualInductance({ l1, l2, couplingMode = 'M', m, k }) {
  positive(l1, 'L1'); positive(l2, 'L2');
  const root = Math.sqrt(l1 * l2);
  let M;
  if (couplingMode === 'k') {
    if (!Number.isFinite(k) || k < 0 || k > 1) throw new RangeError('결합계수 k는 0 이상 1 이하여야 합니다.');
    M = k * root;
  } else {
    nonNegative(m, 'M');
    if (m > root * (1 + 1e-12)) throw new RangeError('M은 √(L1·L2)=' + root.toPrecision(6) + ' H 를 넘을 수 없습니다 (k≤1).');
    M = Math.min(m, root);
  }
  return { M, k: M / root, root };
}

// T and π equivalents for the "both currents INTO the dotted/top terminals" convention: signed coupling m = +M (dots same) or −M (opposite).
// A π branch whose denominator (L2−m or L1−m) is zero has infinite inductance: it is an open branch and is returned as Infinity (flagged in pi.open), never as a missing number.
export function tPiEquivalents({ l1, l2, M, sigma }) {
  const m = sigma * M, det = l1 * l2 - M * M, k = M / Math.sqrt(l1 * l2);
  const T = { La: l1 - m, Lb: l2 - m, Lc: m };
  const branch = (den, ref) => (Math.abs(den) <= 1e-12 * ref ? Infinity : det / den);
  const pi = k >= 1 - 1e-12 || M === 0 ? null : { LA: branch(l2 - m, Math.max(l1, l2)), LB: branch(l1 - m, Math.max(l1, l2)), LC: det / m };
  if (pi) pi.open = { LA: pi.LA === Infinity, LB: pi.LB === Infinity };
  return { T, pi, piReason: pi ? '' : M === 0 ? 'M=0: 결합이 없어 π 등가가 없습니다.' : 'k=1: 이상 변압기 극한이라 π 등가가 없습니다.' };
}

// Coupled coils with a source, series Z1 and a load ZL on the second loop. Physical convention: both mesh currents clockwise, dots on the same ('same')
// or on opposite sides ('opposite'): V = (Z1+jωL1) I1 − s·jωM I2 ; 0 = −s·jωM I1 + (ZL+jωL2) I2, s = +1 / −1 (the textbook mesh figures 13.1, 13.3).
// I2into = −I2 is the same current drawn INTO the secondary's top terminal (figures 13.5, 13.6).
export function coupledCoils(p) {
  try {
    const f = positive(p.frequencyHz, 'f'), w = 2 * Math.PI * f, s = dotSign(p.dots);
    const { M, k } = mutualInductance(p);
    const z1 = finiteComplex(p.z1, '1차 직렬 Z1'), zl = finiteComplex(p.zl, '2차 부하 ZL');
    nonNegative(p.voltageRms, '전원 전압');
    const V = polar(p.voltageRms, p.voltageDeg ?? 0);
    const z11 = add(z1, jw(w, p.l1)), z22 = add(zl, jw(w, p.l2));
    if (magnitude(z22) === 0) throw new RangeError('2차 루프 임피던스 ZL+jωL2 가 0입니다.');
    const wm = w * M, reflected = divide(cz(wm * wm, 0), z22);
    const zin = add(z11, reflected);
    if (magnitude(zin) === 0) throw new RangeError('입력 임피던스가 0이라 전류를 정할 수 없습니다.');
    const I1 = divide(V, zin), I2 = divide(multiply(cz(0, s * wm), I1), z22), I2into = neg(I2);
    const Vo = multiply(zl, I2);
    const energySign = -s; // sign of the M i1 i2 term for the two clockwise mesh currents
    const current = (I, t) => waveSample(I, f, t);
    const energy = t => {
      const i1 = current(I1, t), i2 = current(I2, t);
      return 0.5 * p.l1 * i1 * i1 + 0.5 * p.l2 * i2 * i2 + energySign * M * i1 * i2;
    };
    const Ssource = sconj(V, I1);
    const pLoad = zl.re * magnitude(I2) ** 2, pZ1 = z1.re * magnitude(I1) ** 2;
    const eq = tPiEquivalents({ l1: p.l1, l2: p.l2, M, sigma: s });
    // Independent T-network check: coil voltages with the into-convention currents.
    const V1c = add(multiply(jw(w, p.l1), I1), multiply(cz(0, w * s * M), I2into)), V2c = add(multiply(cz(0, w * s * M), I1), multiply(jw(w, p.l2), I2into));
    const Vx = multiply(jw(w, eq.T.Lc), add(I1, I2into));
    const tDiff = Math.max(magnitude(sub(sub(V1c, Vx), multiply(jw(w, eq.T.La), I1))), magnitude(sub(sub(V2c, Vx), multiply(jw(w, eq.T.Lb), I2into))));
    const scaleV = magnitude(V) + 1e-9;
    // The two mesh equations written out again with the final currents (the reflected-impedance route and the direct route must agree).
    const jwm = cz(0, s * wm), kvl1 = magnitude(sub(V, sub(multiply(z11, I1), multiply(jwm, I2)))), kvl2 = magnitude(add(neg(multiply(jwm, I1)), multiply(z22, I2)));
    return { status: 'valid', omega: w, M, k, dotSign: s, energySign, z11, z22, reflected, zin, I1, I2, I2into, V, Vo, Ssource, pLoad, pZ1,
      V1coil: V1c, V2coil: V2c, T: eq.T, pi: eq.pi, piReason: eq.piReason, seriesAiding: p.l1 + p.l2 + 2 * M, seriesOpposing: p.l1 + p.l2 - 2 * M,
      energy, current, frequencyHz: f,
      checks: [{ label: 'P 보존: P전원 − |I1|²R1 − |I2|²R2', actual: Math.abs(Ssource.re - pLoad - pZ1), expected: 0, unit: 'W', tol: 1e-9 * (Math.abs(Ssource.re) + 1e-9) },
        { label: 'T 등가 대조: V1−Vx−jωLa·I1, V2−Vx−jωLb·I2', actual: tDiff, expected: 0, unit: 'V', tol: 1e-9 * scaleV },
        { label: '메시 방정식 대조: V − (Z11 I1 − s·jωM I2), −s·jωM I1 + Z22 I2', actual: Math.max(kvl1, kvl2), expected: 0, unit: 'V', tol: 1e-9 * scaleV }].map(c => ({ ...c, pass: c.actual <= c.tol })) };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

// T/π equivalents and the two series connections from L1, L2, M (or k) and the dots alone: no source or load is needed, so this is all the "T/π" view computes.
// Checks: the T network gives back L1, L2 (the other port open); the π network, with one port shorted, gives back L1−M²/L2 or L2−M²/L1 (an open branch counts as 1/∞ = 0).
export function coupledEquivalents(p) {
  try {
    const s = dotSign(p.dots), { M, k } = mutualInductance(p), eq = tPiEquivalents({ l1: p.l1, l2: p.l2, M, sigma: s });
    const near = (actual, expected) => ({ actual: Math.abs(actual - expected), expected: 0, unit: 'H', tol: 1e-9 * (Math.abs(expected) + 1e-12) });
    const parallel = (a, b) => 1 / (1 / a + 1 / b);
    const checks = [{ label: 'T 등가 대조: La+Lc = L1, Lb+Lc = L2 (다른 쪽 개방)', actual: Math.max(Math.abs(eq.T.La + eq.T.Lc - p.l1), Math.abs(eq.T.Lb + eq.T.Lc - p.l2)), expected: 0, unit: 'H', tol: 1e-9 * (p.l1 + p.l2) }];
    if (eq.pi) {
      checks.push({ label: 'π 등가 대조: 2차 단락 LA∥LC = L1−M²/L2', ...near(parallel(eq.pi.LA, eq.pi.LC), p.l1 - M * M / p.l2) },
        { label: 'π 등가 대조: 1차 단락 LB∥LC = L2−M²/L1', ...near(parallel(eq.pi.LB, eq.pi.LC), p.l2 - M * M / p.l1) });
    }
    return { status: 'valid', M, k, dotSign: s, T: eq.T, pi: eq.pi, piReason: eq.piReason, seriesAiding: p.l1 + p.l2 + 2 * M, seriesOpposing: p.l1 + p.l2 - 2 * M,
      checks: checks.map(c => ({ ...c, pass: c.actual <= c.tol })) };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

// Stored magnetic energy w = ½L1 i1² + ½L2 i2² + σ M i1 i2 for given instantaneous currents. σ = +1 when both currents enter the dotted terminals
// (their fluxes add), so for the two clockwise mesh currents σ = −(dot sign) and for "into the top terminals" σ = +(dot sign): the same rule as coupledCoils.
// Since M ≤ √(L1L2) (k ≤ 1) the quadratic form is never negative; at k = 1 it is exactly ½(√L1 i1 + σ√L2 i2)², zero for i2/i1 = −σ√(L1/L2).
export function coupledEnergy(p) {
  try {
    const s = dotSign(p.dots), { M, k } = mutualInductance(p);
    if (p.i2Ref !== 'loop' && p.i2Ref !== 'into') throw new RangeError('I2 기준 방향은 loop 또는 into 여야 합니다.');
    if (!Number.isFinite(p.i1) || !Number.isFinite(p.i2)) throw new RangeError('i1, i2는 유한한 수여야 합니다.');
    const sigma = p.i2Ref === 'into' ? s : -s;
    const self1 = 0.5 * p.l1 * p.i1 * p.i1, self2 = 0.5 * p.l2 * p.i2 * p.i2, mutual = sigma * M * p.i1 * p.i2, w = self1 + self2 + mutual;
    const sum = self1 + self2 + Math.abs(mutual), a = Math.sqrt(p.l1) * p.i1, b = sigma * Math.sqrt(p.l2) * p.i2;
    const square = 0.5 * (a + b) ** 2 + sigma * (M - Math.sqrt(p.l1 * p.l2)) * p.i1 * p.i2; // the same w, written as a perfect square plus the (k−1) remainder
    return { status: 'valid', M, k, dotSign: s, sigma, self1, self2, mutual, w, zeroRatio: k >= 1 - 1e-12 ? -sigma * Math.sqrt(p.l1 / p.l2) : null,
      checks: [{ label: 'w ≥ 0 (k ≤ 1 이면 어떤 i1, i2 에서도 성립)', actual: Math.max(0, -w), expected: 0, unit: 'J', tol: 1e-12 * (sum + 1e-12) },
        { label: '완전제곱 꼴 대조: w = ½(√L1 i1 + σ√L2 i2)² − (1−k)·√(L1L2)·σ i1 i2', actual: Math.abs(w - square), expected: 0, unit: 'J', tol: 1e-9 * (sum + 1e-12) }]
        .map(c => ({ ...c, pass: c.actual <= c.tol })) };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

// Ideal transformer n = N2/N1 with the load across V2 (+ at the top terminal). dots 'same': V2 = +nV1, load current = +I1/n;
// 'opposite': both signs flip. i2Direction picks the reference of the reported I2 ('out' of the secondary into the load, or 'in' to it): the four dot figures.
export function idealTransformer(p) {
  try {
    const n1 = positive(p.turns1, 'N1'), n2 = positive(p.turns2, 'N2'), n = n2 / n1, sign = dotSign(p.dots);
    if (p.i2Direction !== 'out' && p.i2Direction !== 'in') throw new RangeError('I2 기준 방향은 out 또는 in이어야 합니다.');
    const z1 = finiteComplex(p.z1, 'Z1'), zl = finiteComplex(p.zl, 'ZL');
    nonNegative(p.voltageRms, '전원 전압');
    const Vs = polar(p.voltageRms, p.voltageDeg ?? 0);
    const zin = scale(zl, 1 / (n * n)), total = add(z1, zin);
    if (magnitude(total) === 0) throw new RangeError('Z1+ZL/n²=0 이라 I1을 정할 수 없습니다 (ZL=0 이어도 Z1이 0이 아니면 계산됩니다).');
    const I1 = divide(Vs, total), V1 = multiply(I1, zin);
    const V2 = scale(V1, sign * n), loadCurrent = scale(I1, sign / n);
    const I2 = p.i2Direction === 'in' ? neg(loadCurrent) : loadCurrent;
    const S1 = sconj(V1, I1), S2 = sconj(V2, loadCurrent);
    const Ssource = sconj(Vs, I1);
    return { status: 'valid', n, zin, total, Vs, V1, I1, V2, I2, loadCurrent, S1, S2, Ssource, dotSign: sign,
      currentRatioSign: p.i2Direction === 'in' ? -sign : sign, step: n < 1 ? '강압' : n > 1 ? '승압' : '격리',
      checks: [{ label: 'S1 − S2 (이상 변압기는 전력을 소비하지 않음)', actual: magnitude(sub(S1, S2)), expected: 0, unit: 'VA', tol: 1e-9 * (magnitude(S1) + 1e-9) },
        { label: '부하: V2 − ZL·(부하 전류)', actual: magnitude(sub(V2, multiply(zl, loadCurrent))), expected: 0, unit: 'V', tol: 1e-9 * (magnitude(V2) + 1e-9) }]
        .map(c => ({ ...c, pass: c.actual <= c.tol })) };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

// Example 13.7: rated primary/secondary voltage and kVA give n, N1, I1 and I2.
export function idealRating({ v1, v2, kva, turns2 }) {
  try {
    positive(v1, 'V1'); positive(v2, 'V2'); positive(kva, '정격 kVA'); positive(turns2, 'N2');
    const n = v2 / v1, va = kva * 1000;
    return { status: 'valid', n, turns1: turns2 / n, i1: va / v1, i2: va / v2, step: n < 1 ? '강압' : n > 1 ? '승압' : '격리', va };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

// Autotransformer: 'down' = source across N1+N2, load across N2; 'up' = source across N1, load across N1+N2 (lecture figures).
export function autotransformer({ mode, turns1, turns2, v1Rms, loadCurrentRms }) {
  try {
    if (mode !== 'down' && mode !== 'up') throw new RangeError('강압 또는 승압을 선택하세요.');
    const n1 = positive(turns1, 'N1'), n2 = positive(turns2, 'N2'), total = n1 + n2;
    positive(v1Rms, 'V1'); nonNegative(loadCurrentRms, '부하전류 I2');
    const ratioV2 = mode === 'down' ? n2 / total : total / n1; // V2/V1
    const v2 = v1Rms * ratioV2, i2 = loadCurrentRms, i1 = i2 * ratioV2;
    const apparentVA = v2 * i2;
    // Same copper as a two-winding transformer: only the series winding's V·I is transformed, the rest is conducted.
    const seriesVoltage = Math.abs(v1Rms - v2), twoWindingVA = mode === 'down' ? seriesVoltage * i1 : seriesVoltage * i2;
    return { status: 'valid', mode, v2, i1, i2, ratioV1V2: 1 / ratioV2, ratioI1I2: ratioV2, apparentVA, twoWindingVA,
      gain: twoWindingVA === 0 ? null : apparentVA / twoWindingVA, commonWindingCurrent: Math.abs(i1 - i2), seriesVoltage };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}

export const BANK_CONNECTIONS = Object.freeze({
  'Y-Y': { primary: 'Y', secondary: 'Y', voltage: n => n, current: n => 1 / n, shiftDeg: 0 },
  'Y-delta': { primary: 'Y', secondary: 'delta', voltage: n => n / Math.sqrt(3), current: n => Math.sqrt(3) / n, shiftDeg: -30 },
  'delta-Y': { primary: 'delta', secondary: 'Y', voltage: n => Math.sqrt(3) * n, current: n => 1 / (Math.sqrt(3) * n), shiftDeg: 30 },
  'delta-delta': { primary: 'delta', secondary: 'delta', voltage: n => n, current: n => 1 / n, shiftDeg: 0 }
});
const windingOf = (kind, line, current) => (kind === 'Y' ? { v: line / Math.sqrt(3), i: current } : { v: line, i: current / Math.sqrt(3) });

// n = N2/N1 per phase transformer; "known" side supplies the line voltage; totalVA is the three-phase rating √3 V_L I_L.
export function threePhaseBank({ connection, n, known, lineVoltage, totalVA }) {
  try {
    const c = BANK_CONNECTIONS[connection];
    if (!c) throw new RangeError('결선은 Y-Y, Y-Δ, Δ-Y, Δ-Δ 중 하나여야 합니다.');
    if (known !== 'primary' && known !== 'secondary') throw new RangeError('알고 있는 쪽은 1차 또는 2차여야 합니다.');
    positive(n, '권수비 n=N2/N1'); positive(lineVoltage, '선간 전압'); positive(totalVA, '3상 용량');
    const vRatio = c.voltage(n), iRatio = c.current(n);
    const vp = known === 'primary' ? lineVoltage : lineVoltage / vRatio, vs = known === 'primary' ? lineVoltage * vRatio : lineVoltage;
    const ip = totalVA / (Math.sqrt(3) * vp), is = totalVA / (Math.sqrt(3) * vs);
    return { status: 'valid', connection, n, vp, vs, ip, is, perUnitVA: totalVA / 3, shiftDeg: c.shiftDeg, vRatio, iRatio,
      primaryWinding: windingOf(c.primary, vp, ip), secondaryWinding: windingOf(c.secondary, vs, is),
      primary: c.primary, secondary: c.secondary,
      checks: [{ label: '선전류 비 대조: I2선/I1선 = 공식', actual: Math.abs(is / ip - iRatio), expected: 0, unit: '', tol: 1e-12 * Math.max(1, iRatio) }]
        .map(x => ({ ...x, pass: x.actual <= x.tol })) };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}
