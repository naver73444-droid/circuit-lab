// Text of the live readouts: the sensor and the Gauss surface. Pure: no DOM.
import { norm3 } from './em-physics.js';
import { siText, siVector } from './em-format.js';
import { planeAxes } from './em-plane-geometry.js';
import { fluxAgrees, predictedFlux } from './em-gauss.js';

const MAGNETIC = new Set(['line', 'loop']);
// An in-plane part below this fraction of |v| is rounding noise (a vector exactly normal to the plane), not a direction.
const IN_PLANE_FLOOR = 1e-9;

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
  // The angle is the direction of the in-plane part only. A vector that points out of the plane (B along z in the xy plane)
  // has no in-plane direction: show its normal component instead of a meaningless "∠ 0°".
  const inPlane = Math.hypot(result.vector[a], result.vector[b]), normalComponent = result.vector[3 - a - b];
  const signed = value => `${value > 0 ? '+' : ''}${siText(value, unit, 3)}`, normalText = `법선 ${signed(normalComponent)}`;
  const direction = inPlane > IN_PLANE_FLOOR * magnitude ? ` ∠ ${Math.round(angle)}°` : magnitude > 0 ? ` · ${normalText}` : '';
  const rows = [
    { label: name, text: siVector(result.vector, unit, 3) },
    { label: `|${name}|`, text: siText(magnitude, unit, 3) },
  ];
  if (magnitude > 0 && inPlane <= IN_PLANE_FLOOR * magnitude) rows.push({ label: '방향', text: `평면에 수직 (${normalText})` });
  else if (magnitude > 0 && Math.abs(normalComponent) > IN_PLANE_FLOOR * magnitude) rows.push({ label: '법선 성분', text: signed(normalComponent) });
  if (hasPotential) rows.push({ label: 'V', text: siText(result.scalar, 'V', 3) });
  const compact = `${name} = ${siText(magnitude, unit, 3)}${direction}${hasPotential ? `, V = ${siText(result.scalar, 'V', 3)}` : ''}`;
  return { valid: true, compact, rows };
}

const fluxText = value => siText(value, 'V·m', 4);
const chargeText = value => siText(value, 'C', 3);

/**
 * Gauss readout lines.
 *   enclosure: gaussEnclosure() result; coarse / precise: { status, flux } or null.
 * Returns { status, lines: string[], agrees, converged, stateText } where `agrees` compares the numeric flux with Q/eps0 (2%).
 * The precise flux carries its own convergence flag (two grids must agree): when it did not converge the line says so
 * ("미수렴", or "경계 근처 · 미수렴" when a charge sits within `NEAR_BOUNDARY` of the radius from the surface) and
 * `agrees` is null: an unconverged number is never reported as agreeing or disagreeing with Gauss's law.
 */
// A point charge closer to the surface than this fraction of the radius makes the flux integrand a sharp spike.
export const NEAR_BOUNDARY = 0.05;

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
  let agrees = null, converged = null, stateText = '';
  if (numeric) {
    const isPrecise = numeric === precise;
    converged = isPrecise ? (precise.converged ?? null) : null;
    const near = isPrecise && enclosure.boundaryGap !== undefined && enclosure.boundaryGap <= NEAR_BOUNDARY * enclosure.radius;
    const tag = !isPrecise ? '근사' : converged === false ? (near ? '경계 근처 · 미수렴' : '미수렴') : converged ? '정밀 · 수렴' : '정밀';
    lines.push(`수치 ∮E·dA = ${fluxText(numeric.flux)}  (${tag})`);
    agrees = converged === false ? null : fluxAgrees(numeric.flux, expected);
    stateText = converged === false ? (near ? '경계 근처 · 미수렴' : '미수렴') : agrees === null ? '' : agrees ? '가우스 법칙과 일치' : '근사 중';
  } else lines.push('수치 ∮E·dA 계산 불가 (모델 제외영역 접근)');
  return { status: 'ok', lines, agrees, converged, stateText };
}
