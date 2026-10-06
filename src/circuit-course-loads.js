// Parallel load combination (complex-power conservation S = ΣSk) with optional pf compensation. Pure, no DOM.
import { complexPower, correction } from './circuit-course-model.js';

export const LOAD_KINDS = Object.freeze({
  'kw-pf': { a: 'kW', b: 'pf' }, 'kva-pf': { a: 'kVA', b: 'pf' }, 'kvar-pf': { a: 'kvar', b: 'pf' }, 'kw-kvar': { a: 'kW', b: 'kvar' }
});
export const MAX_LOADS = 5;

// One load → P, Q in W / var. Q>0 inductive (lagging), Q<0 capacitive (leading).
export function loadPower({ kind, a, b, nature = 'lagging' }) {
  if (!Object.hasOwn(LOAD_KINDS, kind)) throw new RangeError('부하 입력 방식을 확인하세요.');
  if (nature !== 'lagging' && nature !== 'leading') throw new RangeError('lagging 또는 leading을 선택하세요.');
  if (!Number.isFinite(a) || a < 0) throw new RangeError('부하 값은 0 이상이어야 합니다.');
  if (!Number.isFinite(b) || b < 0) throw new RangeError('역률/무효전력 값은 0 이상이어야 합니다.');
  const sign = nature === 'lagging' ? 1 : -1, unit = 1000;
  let P, Q;
  if (kind === 'kw-kvar') { P = a * unit; Q = sign * b * unit; } else {
    if (b <= 0 || b > 1) throw new RangeError('역률은 0 초과 1 이하여야 합니다.');
    const sinTheta = Math.sqrt(Math.max(0, 1 - b * b));
    if (kind === 'kw-pf') { P = a * unit; Q = sign * P * sinTheta / b; } else if (kind === 'kva-pf') { P = a * unit * b; Q = sign * a * unit * sinTheta; } else {
      if (sinTheta === 0) throw new RangeError('kvar와 역률로 부하를 정하려면 역률이 1 미만이어야 합니다.');
      const S = a * unit / sinTheta; P = S * b; Q = sign * a * unit;
    }
  }
  return { P, Q, S: Math.hypot(P, Q), nature: Q === 0 ? 'unity' : sign === 1 ? 'lagging' : 'leading' };
}

export function combineLoads({ loads, phases = 1, voltageRms, frequencyHz, compensate = false, targetPF = 1, connection = 'delta' }) {
  try {
    if (!Array.isArray(loads) || loads.length < 1 || loads.length > MAX_LOADS) throw new RangeError('부하는 1~' + MAX_LOADS + '개입니다.');
    if (![1, 3].includes(phases)) throw new RangeError('단상 또는 3상을 선택하세요.');
    if (!Number.isFinite(voltageRms) || voltageRms <= 0) throw new RangeError('전압은 0보다 커야 합니다.');
    const parts = loads.map(loadPower);
    const P = parts.reduce((s, l) => s + l.P, 0), Q = parts.reduce((s, l) => s + l.Q, 0);
    if (P === 0 && Q === 0) throw new RangeError('모든 부하가 0입니다.');
    const total = complexPower({ re: 1, im: 0 }, { re: P, im: -Q });
    const divisor = phases === 3 ? Math.sqrt(3) * voltageRms : voltageRms;
    const lineCurrentRms = total.apparentVA / divisor;
    // Source phasor reference: V = voltage∠0 (single phase) or Van = V_L/√3 ∠0 (three phase) → I = S*/(3V*) per phase.
    const lineCurrentDeg = total.nature === 'unity' ? 0 : -Math.atan2(Q, P) * 180 / Math.PI;
    const result = { status: 'valid', phases, parts, P, Q, S: total.apparentVA, pf: total.pf, nature: total.nature, lineCurrentRms, lineCurrentDeg,
      sumOfApparent: parts.reduce((s, l) => s + l.S, 0), voltageRms };
    if (compensate) {
      if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) throw new RangeError('주파수는 0보다 커야 합니다.');
      if (!(targetPF > 0 && targetPF <= 1)) throw new RangeError('목표 역률은 0 초과 1 이하여야 합니다.');
      if (P <= 0) throw new RangeError('보상하려면 총 P가 0보다 커야 합니다.');
      const c = correction({ frequencyHz, voltageRms, pWatts: P, qVars: Q, targetPF, phases, connection });
      if (c.status !== 'valid') throw new RangeError(c.reason);
      result.compensation = { ...c, capacitanceF: c.recommendedCapacitanceF ?? 0, qcVars: c.recommendedCapacitanceF === null ? 0 : -c.qCapacitorVars,
        qcPerCapacitor: c.recommendedCapacitanceF === null ? 0 : -c.qCapacitorVars / (phases === 3 ? 3 : 1) };
    }
    return result;
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}
