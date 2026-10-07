/**
 * Y–Δ conversion with complex impedances (textbook 9.7): the same formulas as the resistor tool, evaluated with complex numbers (DOM 없음).
 *   Y→Δ  Z_AB = S/Z_C, Z_BC = S/Z_A, Z_CA = S/Z_B   with S = Z_A·Z_B + Z_B·Z_C + Z_C·Z_A
 *   Δ→Y  Z_A = Z_AB·Z_CA/Σ, Z_B = Z_AB·Z_BC/Σ, Z_C = Z_BC·Z_CA/Σ   with Σ = Z_AB + Z_BC + Z_CA
 * Keys are the resistor tool's (RA…RCA, the arm to A, the side between A and B …) so both modes share direction, layout and toggle logic.
 * Text fields take the complex-calculator syntax ("3+j4", "5∠53.13°", "j10"). A zero denominator (Σ = 0, S = 0, a zero arm) has no equivalent network:
 * it is refused with the reason. The tool's validation runs before a state is committed (attempt), exactly like the resistor mode.
 */
import { evaluateComplexExpression } from './circuit-course-complex-expr.js';
import { add, multiply, divide, magnitude } from './circuit-course-complex.js';
import { zText, polarText, short } from './circuit-course-format.js';
import { DIRECTIONS } from './y-delta-tool-model.js';

const z = (re, im = 0) => ({ re, im });

/** Typed text → finite complex number (the complex-calculator syntax). RangeError with a Korean reason otherwise. */
export function parseImpedanceInput(text, name = 'Z') {
  const result = evaluateComplexExpression(text);
  if (result.status !== 'valid') throw new RangeError(`${name}: ${result.reason}`);
  return result.value;
}

const finite = (value, name) => {
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) throw new RangeError(`${name} 결과가 숫자 범위를 벗어납니다.`);
  return value;
};
const scaleOf = (...values) => values.reduce((sum, value) => sum + magnitude(value), 0);
const NEGLIGIBLE = 1e-12;

/** Y (Z_A, Z_B, Z_C) → equivalent Δ. */
export function convertYToDeltaZ(input) {
  const { RA, RB, RC } = input;
  const S = add(add(multiply(RA, RB), multiply(RB, RC)), multiply(RC, RA));
  for (const [name, value, opposite] of [['Z_A', RA, 'Z_BC'], ['Z_B', RB, 'Z_CA'], ['Z_C', RC, 'Z_AB']]) {
    if (magnitude(value) === 0) throw new RangeError(`${name}=0 이면 맞은편 변 ${opposite} = S/${name} 가 무한대(개방)라 등가 Δ가 없습니다.`);
  }
  if (magnitude(S) <= NEGLIGIBLE * (magnitude(RA) * magnitude(RB) + magnitude(RB) * magnitude(RC) + magnitude(RC) * magnitude(RA))) {
    throw new RangeError('S = Z_A·Z_B + Z_B·Z_C + Z_C·Z_A 가 0이라 등가 Δ가 없습니다 (세 변이 모두 0이 되어 단자 쌍을 구분할 수 없음).');
  }
  return { RAB: finite(divide(S, RC), 'Z_AB'), RBC: finite(divide(S, RA), 'Z_BC'), RCA: finite(divide(S, RB), 'Z_CA') };
}

/** Δ (Z_AB, Z_BC, Z_CA) → equivalent Y. */
export function convertDeltaToYZ(input) {
  const { RAB, RBC, RCA } = input;
  const sigma = add(add(RAB, RBC), RCA);
  if (magnitude(sigma) <= NEGLIGIBLE * scaleOf(RAB, RBC, RCA)) {
    throw new RangeError('Σ = Z_AB + Z_BC + Z_CA 가 0이라 등가 Y가 없습니다 (분모가 0: 세 변의 합이 상쇄되면 Y의 팔이 무한대).');
  }
  return { RA: finite(divide(multiply(RAB, RCA), sigma), 'Z_A'), RB: finite(divide(multiply(RAB, RBC), sigma), 'Z_B'), RC: finite(divide(multiply(RBC, RCA), sigma), 'Z_C') };
}

const parallel = (a, b) => divide(multiply(a, b), add(a, b));

/**
 * Impedance between each terminal pair with the third terminal open, seen from the Y and from the Δ.
 * Y: Z_A + Z_B …  Δ: Z_AB ∥ (Z_BC + Z_CA) … Equivalent networks give the same value for all three pairs.
 */
export function terminalPairs(y, d) {
  const pairs = [['A–B', add(y.RA, y.RB), parallel(d.RAB, add(d.RBC, d.RCA))], ['B–C', add(y.RB, y.RC), parallel(d.RBC, add(d.RCA, d.RAB))], ['C–A', add(y.RC, y.RA), parallel(d.RCA, add(d.RAB, d.RBC))]];
  return pairs.map(([pair, fromY, fromDelta]) => {
    const difference = magnitude(add(fromY, { re: -fromDelta.re, im: -fromDelta.im }));
    return { pair, fromY, fromDelta, difference, pass: difference <= 1e-9 * (Math.max(magnitude(fromY), magnitude(fromDelta)) + 1e-300) };
  });
}

export const COMPLEX_DEFAULTS = Object.freeze({
  toDelta: Object.freeze({ RA: z(3, 4), RB: z(6, -2), RC: z(4, 0) }),
  toY: Object.freeze({ RAB: z(15, 10), RBC: z(15, 10), RCA: z(15, 10) }),
});

/** One-press examples: texts exactly as a person would type them. */
export const COMPLEX_EXAMPLES = Object.freeze([
  Object.freeze({ label: '평형 Δ: 15+j10 Ω ×3 → Y', direction: 'toY', texts: Object.freeze(['15+j10', '15+j10', '15+j10']) }),
  Object.freeze({ label: '불평형 Δ: 10, j10, 10−j10 → Y', direction: 'toY', texts: Object.freeze(['10', 'j10', '10-j10']) }),
  Object.freeze({ label: 'Y: 3+j4, 6−j2, 4 → Δ', direction: 'toDelta', texts: Object.freeze(['3+j4', '6-j2', '4']) }),
]);

export function createComplexState(direction = 'toDelta') {
  if (!Object.hasOwn(DIRECTIONS, direction)) throw new RangeError('알 수 없는 변환 방향입니다.');
  return { direction, values: { ...COMPLEX_DEFAULTS[direction] } };
}

/** A new state with one input replaced by a complex number. */
export function withComplexValue(state, key, value) {
  if (!DIRECTIONS[state.direction].inputs.includes(key)) throw new RangeError('이 방향에서는 입력할 수 없는 임피던스입니다.');
  return { ...state, values: { ...state.values, [key]: finite(value, key) } };
}

/** { ok: true, state } for usable text, { ok: false, reason } (Korean) otherwise. */
export function withComplexText(state, key, text) {
  try { return { ok: true, state: withComplexValue(state, key, parseImpedanceInput(text, 'Z_' + key.slice(1))) }; } catch (error) { return { ok: false, reason: error.message }; }
}

/** The text a field shows for a value in use: 10 significant digits, parseable again ("5-j3.333333333"). */
export function impedanceDraft(value) {
  const part = (n) => String(Number(Math.abs(n).toPrecision(10)));
  const re = Number(value.re.toPrecision(10)), im = value.im;
  if (im === 0) return String(re);
  if (re === 0) return (im < 0 ? '-' : '') + 'j' + part(im);
  return String(re) + (im < 0 ? '-' : '+') + 'j' + part(im);
}

const zShort = (value) => short(value.re) + (value.im < 0 ? '−j' : '+j') + short(Math.abs(value.im));

/** Same network the other way round: the results become the inputs, unrounded. */
export function toggleComplexDirection(state) {
  const outputs = evaluateComplexTool(state).outputs;
  const direction = state.direction === 'toDelta' ? 'toY' : 'toDelta';
  const values = {};
  DIRECTIONS[direction].inputs.forEach((key, index) => { values[key] = outputs[DIRECTIONS[state.direction].outputs[index]]; });
  return { direction, values };
}

/** Everything the screen shows for a state (throws RangeError for a network without an equivalent): outputs, texts, the terminal-pair check, read line, math lines. */
export function evaluateComplexTool(state) {
  const direction = DIRECTIONS[state.direction];
  const inputs = Object.fromEntries(direction.inputs.map((key) => [key, state.values[key]]));
  const converted = state.direction === 'toDelta' ? convertYToDeltaZ(inputs) : convertDeltaToYZ(inputs);
  const outputs = Object.fromEntries(direction.outputs.map((key) => [key, converted[key]]));
  const all = { ...inputs, ...outputs };
  const texts = Object.fromEntries(Object.entries(all).map(([key, value]) => [key, { short: zShort(value), rect: zText(value) + ' Ω', polar: polarText(value) + ' Ω' }]));
  const pairs = state.direction === 'toDelta' ? terminalPairs(inputs, outputs) : terminalPairs(outputs, inputs);
  const first = inputs[direction.inputs[0]];
  const balanced = direction.inputs.every((key) => magnitude(add(inputs[key], { re: -first.re, im: -first.im })) <= 1e-9 * magnitude(first));
  const remark = balanced
    ? (state.direction === 'toDelta' ? '세 임피던스가 같으므로 Δ의 변은 Y 팔의 3배입니다 (Z_Δ = 3Z_Y, 위상각은 그대로).' : '세 임피던스가 같으므로 Y의 팔은 Δ 변의 1/3입니다 (Z_Y = Z_Δ/3, 위상각은 그대로).')
    : '세 값이 같지 않으면 Z_Δ = 3Z_Y 관계가 아니며, 결과 세 값의 크기와 위상이 서로 다릅니다.';
  const list = (keys) => keys.map((key) => `Z_${key.slice(1)}=${texts[key].short}`).join(', ');
  const read = `${direction.inputShape} (${list(direction.inputs)})와 단자 사이 임피던스가 같은 ${direction.outputShape}는 ${list(direction.outputs)} (Ω)입니다. ${remark}`;
  const general = state.direction === 'toDelta' ? 'Z_AB = (Z_A·Z_B + Z_B·Z_C + Z_C·Z_A)/Z_C' : 'Z_A = Z_AB·Z_CA/(Z_AB + Z_BC + Z_CA)';
  const [a, b, c] = direction.inputs.map((key) => texts[key].short);
  const numeric = state.direction === 'toDelta'
    ? `Z_AB = ((${a})(${b}) + (${b})(${c}) + (${c})(${a}))/(${c}) = ${texts[direction.outputs[0]].short} Ω`
    : `Z_A = (${a})(${c})/((${a}) + (${b}) + (${c})) = ${texts[direction.outputs[0]].short} Ω`;
  return { direction: state.direction, inputs, outputs, texts, pairs, balanced, read, math: { general, numeric } };
}

/** Evaluate a candidate completely BEFORE it is committed: { ok: true, evaluation } or { ok: false, reason }. */
export function attemptComplex(candidate) {
  try { return { ok: true, evaluation: evaluateComplexTool(candidate) }; } catch (error) { return { ok: false, reason: error instanceof RangeError ? error.message : '변환 결과를 계산하지 못했습니다.' }; }
}
