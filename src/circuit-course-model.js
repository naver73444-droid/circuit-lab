// Independent undergraduate sinusoidal AC models. All phasors are RMS, e^{jωt}.
export const CONVENTION = Object.freeze({
  amplitude: 'RMS', time: 'sqrt(2) Re{X exp(j omega t)}', sequence: 'abc',
  current: 'load passive sign: current enters + voltage terminal',
  scope: 'linear ideal loads, sinusoidal steady state, balanced three-phase only'
});
const EPS = 64 * Number.EPSILON;
const finite = n => typeof n === 'number' && Number.isFinite(n);
function real(n, label, min = -1e100, max = 1e100) {
  if (!finite(n) || n < min || n > max) throw new RangeError(label + ': 허용 범위의 유한한 숫자가 필요합니다.');
  return n;
}
function positive(n, label, max = 1e100) {
  real(n, label, Number.MIN_VALUE, max); return n;
}
function complex(z) {
  if (!z) throw new RangeError('복소수가 필요합니다.');
  real(z.re, '실수부'); real(z.im, '허수부'); return z;
}
export const add = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
export const scale = (a, k) => ({ re: a.re * k, im: a.im * k });
export const conjugate = a => ({ re: a.re, im: -a.im });
export const multiply = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const magnitude = a => Math.hypot(a.re, a.im);
export function divide(a, b) {
  complex(a); complex(b);
  const m = magnitude(b);
  if (m === 0) throw new RangeError('복소수 0으로 나눌 수 없습니다.');
  const br = b.re / m, bi = b.im / m;
  return { re: (a.re / m) * br + (a.im / m) * bi, im: (a.im / m) * br - (a.re / m) * bi };
}
export function polar(m, angleDeg) {
  real(m, '크기', 0); real(angleDeg, '각도');
  const a = (angleDeg % 360) * Math.PI / 180;
  return { re: m * Math.cos(a), im: m * Math.sin(a) };
}
export function rectangularPolar(z) {
  complex(z);
  return { magnitude: magnitude(z), angleDeg: magnitude(z) === 0 ? null : Math.atan2(z.im, z.re) * 180 / Math.PI };
}
export function phaseDifference(a, b) {
  const aa = rectangularPolar(a).angleDeg, bb = rectangularPolar(b).angleDeg;
  return aa === null || bb === null ? null : ((aa - bb + 540) % 360) - 180;
}
export function rmsPhasor(value, basis = 'rms') {
  complex(value);
  if (!['rms', 'peak'].includes(basis)) throw new RangeError('RMS 또는 peak 기준을 선택하세요.');
  return scale(value, basis === 'peak' ? 1 / Math.SQRT2 : 1);
}
export function waveSample(phasorRms, frequencyHz, timeSeconds) {
  complex(phasorRms); positive(frequencyHz, 'f (Hz)', 1e9); real(timeSeconds, 't (s)', -1e8, 1e8);
  const wt = 2 * Math.PI * frequencyHz * timeSeconds;
  return Math.SQRT2 * (phasorRms.re * Math.cos(wt) - phasorRms.im * Math.sin(wt));
}
export function complexPower(V, I) {
  complex(V); complex(I);
  const S = multiply(V, conjugate(I)), apparentVA = magnitude(S);
  const threshold = EPS * apparentVA;
  const nature = apparentVA === 0 ? 'undefined' : S.im > threshold ? 'lagging' : S.im < -threshold ? 'leading' : 'unity';
  return {
    S, pWatts: S.re, qVars: S.im, apparentVA,
    pf: apparentVA === 0 ? null : Math.max(-1, Math.min(1, S.re / apparentVA)),
    phaseDeg: phaseDifference(V, I), nature,
    flow: S.re < -threshold ? 'delivered' : S.re > threshold ? 'absorbed' : 'reactive-only'
  };
}
const invalid = error => ({ status: 'invalid', reason: error.message });
export function componentImpedance(kind, value, frequencyHz) {
  positive(value, kind + ' SI 값'); positive(frequencyHz, 'f (Hz)', 1e9);
  const w = 2 * Math.PI * frequencyHz;
  if (kind === 'R') return { re: value, im: 0 };
  if (kind === 'L') return { re: 0, im: w * value };
  if (kind === 'C') return { re: 0, im: -1 / (w * value) };
  throw new RangeError('지원 소자: R, L, C.');
}
export function impedanceNetwork({ frequencyHz, topology, branches, voltageRms, voltagePhaseDeg = 0 }) {
  try {
    positive(frequencyHz, 'f (Hz)', 1e9); real(voltageRms, 'V RMS', 0); real(voltagePhaseDeg, '위상 (°)');
    if (!['series', 'parallel'].includes(topology)) throw new RangeError('직렬 또는 병렬을 선택하세요.');
    if (!Array.isArray(branches) || branches.length === 0 || branches.length > 12) throw new RangeError('소자는 1~12개가 필요합니다.');
    const parts = branches.map(b => {
      const Z = componentImpedance(b.kind, b.value, frequencyHz);
      if (!finite(magnitude(Z)) || magnitude(Z) === 0) throw new RangeError('소자 임피던스가 수치 표현 범위를 벗어났습니다.');
      return { ...b, Z, Y: divide({ re: 1, im: 0 }, Z) };
    });
    const V = polar(voltageRms, voltagePhaseDeg);
    let Z, Y, I, openCircuit = false;
    const sums = parts.map(b => topology === 'series' ? b.Z : b.Y);
    const total = sums.reduce(add, { re: 0, im: 0 });
    const termScale = sums.reduce((m, b) => m + magnitude(b), 0);
    if (total.re === 0 && total.im === 0) {
      if (topology === 'series') return { status: 'singular', reason: '이상 직렬 공진: Z≈0. 고정 전압원의 유한한 전류를 계산할 수 없습니다.', Z: null, Y: null };
      Z = null; Y = { re: 0, im: 0 }; I = { re: 0, im: 0 }; openCircuit = true;
    } else if (topology === 'series') {
      Z = total; Y = divide({ re: 1, im: 0 }, Z); I = multiply(V, Y);
    } else {
      Y = total; Z = divide({ re: 1, im: 0 }, Y); I = multiply(V, Y);
    }
    const branchResults = parts.map(b => {
      const bv = topology === 'parallel' ? V : multiply(I, b.Z);
      const bi = topology === 'series' ? I : multiply(V, b.Y);
      return { ...b, V: bv, I: bi, power: complexPower(bv, bi) };
    });
    const power = complexPower(V, I);
    if (![magnitude(I), magnitude(Y), power.apparentVA].every(finite)) throw new RangeError('계산 결과가 수치 표현 범위를 벗어났습니다.');
    const poorlyConditioned = !openCircuit && magnitude(total) / termScale < 1e-10;
    return { status: 'valid', topology, frequencyHz, omega: 2 * Math.PI * frequencyHz, V, I, Z, Y, power, branches: branchResults,
      openCircuit, poorlyConditioned, reason: openCircuit ? '이상 병렬 공진: Y≈0, 입력 전류 0. Z는 유한값이 없는 개방 등가이며 L/C 분기 전류는 존재합니다.' : poorlyConditioned ? '공진에 매우 가깝습니다. 입력 정밀도에 민감한 유한값을 그대로 계산했습니다.' : '' };
  } catch (e) { return invalid(e); }
}
// Phase-angle offsets of (a, b, c) for the two phase sequences; Vab = Van − Vbn then leads Van by +30° (abc) or −30° (acb).
export const SEQUENCE_OFFSETS = Object.freeze({ abc: [0, -120, 120], acb: [0, 120, -120] });
export const vanAngleOf = (referenceDeg, reference = 'Van', sequence = 'abc') =>
  (reference === 'Vab' ? referenceDeg - (sequence === 'abc' ? 30 : -30) : referenceDeg);
export function balancedThreePhase({ connection, lineVoltageRms, z, phaseDeg = 0, sequence = 'abc', reference = 'Van' }) {
  try {
    if (!['Y', 'delta'].includes(connection)) throw new RangeError('Y 또는 Δ를 선택하세요.');
    if (!Object.hasOwn(SEQUENCE_OFFSETS, sequence)) throw new RangeError('상순서는 abc 또는 acb여야 합니다.');
    if (!['Van', 'Vab'].includes(reference)) throw new RangeError('기준 위상은 Van 또는 Vab여야 합니다.');
    positive(lineVoltageRms, '선간 V RMS'); complex(z); real(phaseDeg, '기준 위상 (°)');
    if (z.re < 0 || magnitude(z) === 0) throw new RangeError('수동 부하: R≥0, |Z|>0이 필요합니다.');
    // Reduce before adding offsets: huge phases otherwise absorb ±120° in floating-point arithmetic.
    const normalizedPhaseDeg = vanAngleOf(phaseDeg % 360, reference, sequence);
    const phaseVoltages = SEQUENCE_OFFSETS[sequence].map(a => polar(lineVoltageRms / Math.sqrt(3), normalizedPhaseDeg + a));
    const lineVoltages = phaseVoltages.map((v, i) => sub(v, phaseVoltages[(i + 1) % 3]));
    const loadVoltages = connection === 'Y' ? phaseVoltages : lineVoltages;
    const loadCurrents = loadVoltages.map(v => divide(v, z));
    const lineCurrents = connection === 'Y' ? loadCurrents : loadCurrents.map((i, n) => sub(i, loadCurrents[(n + 2) % 3]));
    const powers = loadVoltages.map((v, i) => complexPower(v, loadCurrents[i]));
    const totalS = powers.map(p => p.S).reduce(add, { re: 0, im: 0 });
    const p = complexPower(phaseVoltages[0], lineCurrents[0]);
    const power = { ...p, S: totalS, pWatts: totalS.re, qVars: totalS.im, apparentVA: magnitude(totalS) };
    if (!finite(power.apparentVA)) throw new RangeError('계산 결과가 수치 표현 범위를 벗어났습니다.');
    return { status: 'valid', connection, sequence, reference, z: { ...z }, phaseVoltages, lineVoltages, loadVoltages, loadCurrents, lineCurrents, powers, power,
      lineCurrentRms: magnitude(lineCurrents[0]), loadVoltageRms: magnitude(loadVoltages[0]), loadCurrentRms: magnitude(loadCurrents[0]),
      // Deliberately use the actual matching line-neutral phasor; Vab alone has an extra +30°.
      sourceS: scale(multiply(phaseVoltages[0], conjugate(lineCurrents[0])), 3) };
  } catch (e) { return invalid(e); }
}
export function correction({ frequencyHz, voltageRms, pWatts, qVars, targetPF, capacitanceF, phases = 1, connection = 'Y' }) {
  try {
    positive(frequencyHz, 'f (Hz)', 1e9); positive(voltageRms, '전압 RMS'); positive(pWatts, 'P (W)');
    real(qVars, 'Q (var)'); positive(targetPF, '목표 PF', 1);
    if (![1, 3].includes(phases) || !['Y', 'delta'].includes(connection)) throw new RangeError('단상 또는 균형 3상 Y/Δ가 필요합니다.');
    const desiredQ = pWatts * Math.sqrt(1 / (targetPF * targetPF) - 1);
    const requiredVars = qVars - desiredQ;
    const capacitorVoltageRms = phases === 3 && connection === 'Y' ? voltageRms / Math.sqrt(3) : voltageRms;
    const factor = phases * 2 * Math.PI * frequencyHz * capacitorVoltageRms ** 2;
    const possible = requiredVars >= -EPS * Math.max(Math.abs(qVars), desiredQ);
    const recommendedCapacitanceF = possible ? Math.max(0, requiredVars / factor) : null;
    if (recommendedCapacitanceF !== null && !finite(recommendedCapacitanceF)) throw new RangeError('권장 C가 수치 표현 범위를 벗어났습니다.');
    const selectedCapacitanceF = capacitanceF === undefined ? (recommendedCapacitanceF ?? 0) : real(capacitanceF, '각 커패시터 C (F)', 0);
    const qCapacitorVars = -factor * selectedCapacitanceF, qAfterVars = qVars + qCapacitorVars;
    const before = complexPower({ re: 1, im: 0 }, { re: pWatts, im: -qVars });
    const after = complexPower({ re: 1, im: 0 }, { re: pWatts, im: -qAfterVars });
    const divisor = phases === 3 ? Math.sqrt(3) * voltageRms : voltageRms;
    const overcompensated = qAfterVars < -EPS * Math.max(Math.abs(qVars), Math.abs(qCapacitorVars));
    const warnings = [];
    if (!possible) warnings.push('목표 지상 Q가 현재 Q보다 큽니다. 커패시터만으로 이 목표를 만들 수 없습니다.');
    if (overcompensated) warnings.push('과보상: 공급원 Q<0, 전류 진상. C를 줄이세요.');
    if (![desiredQ, requiredVars, factor, capacitorVoltageRms, selectedCapacitanceF, qCapacitorVars, qAfterVars, before.apparentVA, after.apparentVA].every(finite) || factor === 0) throw new RangeError('계산 결과가 수치 표현 범위를 벗어났습니다.');
    return { status: 'valid', phases, connection, voltageRms, frequencyHz, pWatts, qVars, desiredQ, requiredVars,
      recommendedCapacitanceF, selectedCapacitanceF, capacitorVoltageRms, qCapacitorVars, qAfterVars, before, after,
      sourceCurrentBeforeRms: before.apparentVA / divisor, sourceCurrentAfterRms: after.apparentVA / divisor,
      overcompensated, possible, warnings };
  } catch (e) { return invalid(e); }
}
// Independent checks use time-domain sampling, rather than repeating the phasor power product.
export function sampledPowerCheck(V, I, frequencyHz, expected, samples = 720) {
  let p = 0, v2 = 0, i2 = 0;
  for (let n = 0; n < samples; n++) {
    const t = n / (samples * frequencyHz), v = waveSample(V, frequencyHz, t), i = waveSample(I, frequencyHz, t);
    p += v * i; v2 += v * v; i2 += i * i;
  }
  const actual = p / samples, tolerance = 1e-9 + 1e-10 * Math.max(Math.abs(expected), magnitude(V) * magnitude(I));
  return { label: '한 주기 v(t)i(t) 평균', actual, expected, unit: 'W', tolerance, pass: Math.abs(actual - expected) <= tolerance,
    voltageRms: Math.sqrt(v2 / samples), currentRms: Math.sqrt(i2 / samples), samples };
}
