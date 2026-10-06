// Text of the live readouts: the sensor and the Gauss surface. Pure: no DOM.
import { norm3 } from './em-physics.js';
import { siText, siVector } from './em-format.js';
import { planeAxes } from './em-plane-geometry.js';
import { fluxAgrees, predictedFlux } from './em-gauss.js';

const MAGNETIC = new Set(['line', 'loop']);

/**
 * Sensor readout for a plane-field result.
 * Returns { valid, compact, rows: [{ label, text }] }. `compact` is the one-line text that follows the sensor.
 */
export function sensorReadout(field, result, plane) {
  if (result.status !== 'valid') return { valid: false, compact: '모델 제외영역 · 값 없음', rows: [] };
  const name = MAGNETIC.has(field.kind) ? 'B' : 'E', unit = name === 'B' ? 'T' : 'V/m';
  const [a, b] = planeAxes(plane), magnitude = norm3(result.vector);
  const angle = Math.atan2(result.vector[b], result.vector[a]) * 180 / Math.PI;
  const hasPotential = field.scalarName === 'V';
  const direction = magnitude > 0 ? ` ∠ ${Math.round(angle)}°` : '';
  const rows = [
    { label: name, text: siVector(result.vector, unit, 3) },
    { label: `|${name}|`, text: siText(magnitude, unit, 3) },
  ];
  if (hasPotential) rows.push({ label: 'V', text: siText(result.scalar, 'V', 3) });
  const compact = `${name} = ${siText(magnitude, unit, 3)}${direction}${hasPotential ? `, V = ${siText(result.scalar, 'V', 3)}` : ''}`;
  return { valid: true, compact, rows };
}

const fluxText = value => siText(value, 'V·m', 4);
const chargeText = value => siText(value, 'C', 3);

/**
 * Gauss readout lines.
 *   enclosure: gaussEnclosure() result; coarse / precise: { status, flux } or null.
 * Returns { status, lines: string[], agrees } where `agrees` compares the numeric flux with Q/eps0 (2%).
 */
export function gaussReadout({ enclosure, coarse = null, precise = null }) {
  if (enclosure.status === 'excluded') return { status: 'excluded', lines: [enclosure.reason, '면을 옮겨 전하에서 떼어 주세요.'], agrees: null };
  if (enclosure.status === 'unsupported') {
    return { status: 'unsupported', lines: [enclosure.reason, '이 경우의 수치 적분은 지원하지 않습니다.'], agrees: null };
  }
  const enclosed = enclosure.enclosedIds.length ? enclosure.enclosedIds.join(', ') : '없음';
  const expected = predictedFlux(enclosure.enclosedCharge);
  const numeric = precise?.status === 'valid' ? precise : coarse?.status === 'valid' ? coarse : null;
  const lines = [
    `Q내부 = ${enclosure.enclosedCharge === 0 ? '0 C' : chargeText(enclosure.enclosedCharge)}  (${enclosed})`,
    `Φ = Q/ε₀ = ${fluxText(expected)}`,
  ];
  let agrees = null;
  if (numeric) {
    const tag = numeric === precise ? '정밀' : '근사';
    lines.push(`수치 ∮E·dA = ${fluxText(numeric.flux)}  (${tag})`);
    agrees = fluxAgrees(numeric.flux, expected);
  } else lines.push('수치 ∮E·dA 계산 불가 (모델 제외영역 접근)');
  return { status: 'ok', lines, agrees };
}
