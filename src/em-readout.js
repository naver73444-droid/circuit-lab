// Text of the live readouts: the sensor and the Gauss surface. Pure: no DOM.
import { MU0, norm3 } from './em-physics.js';
import { plainText, siText, siVector } from './em-format.js';
import { planeAxes } from './em-plane-geometry.js';
import { fluxAgrees, predictedFlux } from './em-gauss.js';
import { circulationAgrees, predictedBCirculation } from './em-ampere.js';

const MAGNETIC = new Set(['line', 'loop']);
// An in-plane part below this fraction of |v| is rounding noise (a vector exactly normal to the plane), not a direction.
const IN_PLANE_FLOOR = 1e-9;

/**
 * Sensor readout for a plane-field result.
 * Returns { valid, compact, rows: [{ label, text }] }. `compact` is the one-line text that follows the sensor.
 */
export function sensorReadout(field, result, plane, options = {}) {
  if (result.status !== 'valid') return { valid: false, compact: '모델 제외영역 · 값 없음', rows: [] };
  // Current sources: B in tesla (= Wb/m²) or, with showH, H = B / mu0 in A/m; the other one follows as an extra row.
  const current = field.kind === 'current', showH = current && options.showH === true;
  const name = showH ? 'H' : MAGNETIC.has(field.kind) || current ? 'B' : 'E', unit = showH ? 'A/m' : name === 'B' ? 'T' : 'V/m';
  const vector = showH ? result.vector.map(value => value / MU0) : result.vector;
  result = { ...result, vector };
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
  if (current) {
    const other = showH ? { label: 'B', text: siText(magnitude * MU0, 'T', 3) } : { label: 'H', text: siText(magnitude / MU0, 'A/m', 3) };
    rows[0].title = showH ? 'H [A/m]: 자유전류가 만드는 장 (진공에서 B = μ₀H)' : 'B [T = Wb/m²]: 자속밀도 (강의 표기 Wb/m²와 같은 단위)';
    rows.push({ ...other, label: `|${other.label}|`, title: showH ? 'B = μ₀H [T = Wb/m²]' : 'H = B/μ₀ [A/m]' });
  }
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
    // Near the boundary: one charge within NEAR_BOUNDARY * radius, or two or more charges close enough that the precise flux had
    // to be split per charge (precise.nearCount) and that split did not converge.
    const near = isPrecise && ((enclosure.boundaryGap !== undefined && enclosure.boundaryGap <= NEAR_BOUNDARY * enclosure.radius)
      || (precise.nearCount ?? 0) >= 2);
    const tag = !isPrecise ? '근사' : converged === false ? (near ? '경계 근처 · 미수렴' : '미수렴') : converged ? '정밀 · 수렴' : '정밀';
    lines.push(`수치 ∮E·dA = ${fluxText(numeric.flux)}  (${tag})`);
    agrees = converged === false ? null : fluxAgrees(numeric.flux, expected);
    stateText = converged === false ? (near ? '경계 근처 · 미수렴' : '미수렴') : agrees === null ? '' : agrees ? '가우스 법칙과 일치' : '근사 중';
  } else lines.push('수치 ∮E·dA 계산 불가 (모델 제외영역 접근)');
  return { status: 'ok', lines, agrees, converged, stateText };
}

const currentText = value => (value === 0 ? '0 A' : `${value > 0 ? '+' : '−'}${siText(Math.abs(value), 'A', 4)}`);

/**
 * Ampere-loop readout lines.
 *   enclosure: ampereEnclosure() result; sources: validated current sources; numeric: { status, circulation, maxH, minH, converged } | null
 *   precise: whether `numeric` came from the converged pass (otherwise it is the coarse one used while dragging)
 * Returns { status, lines, agrees, stateText } where `agrees` compares ∮H·dl with I_enc (1%); null when not comparable.
 */
export function ampereReadout({ enclosure, sources = [], numeric = null, precise = false, symmetric = null }) {
  if (enclosure.status === 'excluded') return { status: 'excluded', lines: [enclosure.reason, '경로를 도선에서 떼어 주세요.'], agrees: null, stateText: '', compact: '' };
  if (enclosure.status === 'unsupported') return { status: 'unsupported', lines: [enclosure.reason, '이 경우의 수치 비교는 지원하지 않습니다 (미지원).'], agrees: null, stateText: '미지원', compact: '' };
  const enclosed = enclosure.enclosedIds.length ? enclosure.enclosedIds.join(', ') : '없음';
  const expected = enclosure.enclosedCurrent;
  const lines = [
    `I내부 = ${currentText(expected)}  (${enclosed}, ${enclosure.orientation === -1 ? '시계' : '반시계'} 경로)`,
    `∮H·dl = I내부 = ${currentText(expected)}`,
  ];
  let agrees = null, stateText = '';
  if (numeric?.status === 'valid') {
    const tag = !precise ? '근사' : numeric.converged === false ? '미수렴' : '정밀 · 수렴';
    lines.push(`수치 ∮H·dl = ${currentText(numeric.circulation)}  (${tag})`);
    lines.push(`∮B·dl = μ₀I내부 = ${plainText(predictedBCirculation(expected), 4)} T·m  (= Wb/m)`);
    agrees = precise && numeric.converged === false ? null : circulationAgrees(numeric.circulation, expected);
    stateText = precise && numeric.converged === false ? '미수렴' : agrees ? '암페어 법칙과 일치' : '근사 중';
    const ratio = numeric.minH > 0 ? numeric.maxH / numeric.minH : Infinity;
    lines.push(`|H| 경로 위: 최대 ${siText(numeric.maxH, 'A/m', 3)} · 최소 ${siText(numeric.minH, 'A/m', 3)}`);
    if (symmetric) lines.push(`대칭이면 H = I내부/(2πr) = ${siText(symmetric, 'A/m', 3)}`);
    if (expected !== 0 && ratio > 1.05) lines.push('경로 위에서 H가 일정하지 않아도 ∮H·dl = I내부 입니다. 대칭이 있어야 H를 바로 풀 수 있습니다.');
    if (expected === 0 && numeric.maxH > 0) lines.push('내부 전류가 없으면 ∮H·dl = 0 입니다. H 자체는 0이 아닐 수 있습니다.');
    if (enclosure.nearGap < 0.02) lines.push('도선이 경로에 매우 가깝습니다. 수치 오차가 커질 수 있습니다.');
  } else lines.push('수치 ∮H·dl 계산 불가 (모델 제외영역 접근)');
  const compact = numeric?.status === 'valid' ? `∮H·dl = ${currentText(numeric.circulation)}` : `I내부 = ${currentText(expected)}`;
  return { status: 'ok', lines, agrees, stateText, compact };
}

const AXIS = ['x', 'y', 'z'];

/**
 * Force readout of the selected current source (forceOnSource() result) in `plane`.
 * Returns { status, lines: string[], compact } where compact is the short canvas label.
 */
export function forceReadout(force, source, plane) {
  if (!force) return { status: 'none', lines: [], compact: '' };
  if (force.status === 'none' || force.status === 'excluded') return { status: force.status, lines: [force.reason], compact: '' };
  const [a, b] = planeAxes(plane), unitName = force.unit, vector = force.vector;
  const label = force.kind === 'perLength' ? 'F/ℓ' : force.kind === 'perArea' ? 'F/S' : 'F';
  const inPlane = Math.hypot(vector[a], vector[b]), normal = vector[3 - a - b];
  const angle = (Math.atan2(vector[b], vector[a]) * 180 / Math.PI + 360) % 360;
  const lines = [`${label} = ${siText(force.magnitude, unitName, 4)}`, `${label} = ${siVector(vector, unitName, 3)}`];
  if (force.magnitude > 0 && inPlane > 1e-9 * force.magnitude) lines.push(`방향: 평면 안 ∠ ${Math.round(angle)}°${Math.abs(normal) > 1e-9 * force.magnitude ? ` + 법선 성분 ${siText(normal, unitName, 3)}` : ''}`);
  else if (force.magnitude > 0) lines.push(`방향: 평면에 수직 (${AXIS[3 - a - b]} 방향 성분)`);
  if (force.relation) {
    lines.push(`평행 도선: ${force.relation === 'attract' ? '같은 방향 전류는 끌어당깁니다' : '반대 방향 전류는 밀어냅니다'} (d = ${siText(force.distance, 'm', 3)})`);
    lines.push(`이론 μ₀I₁I₂/(2πd) = ${siText(force.theory, unitName, 4)}`);
  } else if (force.kind === 'perLength' && !force.uniform) lines.push('다른 원천의 장이 도선을 따라 일정하지 않아 이 지점의 값입니다.');
  if (force.kind === 'perArea') lines.push('자기 자신이 만든 장은 제외하고 다른 원천의 장(양쪽 평균)을 씁니다.');
  return { status: 'ok', lines, compact: `${label} = ${siText(force.magnitude, unitName, 3)}` };
}
