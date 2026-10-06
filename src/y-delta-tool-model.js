/**
 * State and read-outs of the "Y–Δ 변환" course tool (DOM 없음). The tool has one direction, three input resistances and recomputes the
 * other network on every change: sliders are logarithmic (10 Ω … 10 MΩ), text fields take SI values ("4.7k", "2.2meg", "330Ω").
 * A text value that cannot be used leaves the last valid state untouched and says why.
 */
import { convertDeltaToY, convertYToDelta, parseResistance, resistanceText } from "./y-delta-model.js";

export const SLIDER_MIN_OHM = 10;
export const SLIDER_MAX_OHM = 1e7;
export const SLIDER_STEPS = 1000;
const DECADES = Math.log10(SLIDER_MAX_OHM / SLIDER_MIN_OHM);

/** Slider position (0 … SLIDER_STEPS) → resistance with three significant digits (clean values such as 1.02 kΩ). */
export function sliderToResistance(position) {
  const t = Math.max(0, Math.min(SLIDER_STEPS, Number(position))) / SLIDER_STEPS;
  return Number((SLIDER_MIN_OHM * 10 ** (DECADES * t)).toPrecision(3));
}

/** Resistance → slider position; values outside 10 Ω … 10 MΩ sit at the nearest end. */
export function resistanceToSlider(resistance) {
  if (!(resistance > 0)) return 0;
  const t = Math.log10(resistance / SLIDER_MIN_OHM) / DECADES;
  return Math.round(Math.max(0, Math.min(1, t)) * SLIDER_STEPS);
}

export const DIRECTIONS = Object.freeze({
  toDelta: Object.freeze({ label: "Y → Δ", inputs: ["RA", "RB", "RC"], outputs: ["RAB", "RBC", "RCA"], inputShape: "Y", outputShape: "Δ" }),
  toY: Object.freeze({ label: "Δ → Y", inputs: ["RAB", "RBC", "RCA"], outputs: ["RA", "RB", "RC"], inputShape: "Δ", outputShape: "Y" }),
});

export const DEFAULT_VALUES = Object.freeze({ toDelta: Object.freeze({ RA: 1e3, RB: 2e3, RC: 3e3 }), toY: Object.freeze({ RAB: 3e3, RBC: 6e3, RCA: 9e3 }) });

export function createYDeltaToolState(direction = "toDelta") {
  if (!Object.hasOwn(DIRECTIONS, direction)) throw new RangeError("알 수 없는 변환 방향입니다.");
  return { direction, values: { ...DEFAULT_VALUES[direction] } };
}

/** Same network, the other way: this direction's results become the next inputs (six significant digits, so the text shown is the value used). */
export function toggleDirection(state) {
  const outputs = evaluateTool(state).outputs;
  const direction = state.direction === "toDelta" ? "toY" : "toDelta";
  const keys = DIRECTIONS[direction].inputs;
  const values = {};
  DIRECTIONS[state.direction].outputs.forEach((name, index) => { values[keys[index]] = Number(outputs[name].toPrecision(6)); });
  return { direction, values };
}

/** A new state with one input replaced by a number (slider) — validated like a typed value. */
export function withValue(state, key, resistance) {
  if (!DIRECTIONS[state.direction].inputs.includes(key)) throw new RangeError("이 방향에서는 입력할 수 없는 저항입니다.");
  return { ...state, values: { ...state.values, [key]: parseResistance(resistance, key) } };
}

/** { ok: true, state } for usable text, { ok: false, reason } (Korean) otherwise. */
export function withText(state, key, text) {
  try { return { ok: true, state: withValue(state, key, parseResistance(text, key)) }; } catch (error) { return { ok: false, reason: error.message }; }
}

const SIDES = { RA: "RBC", RB: "RCA", RC: "RAB", RAB: "RC", RBC: "RA", RCA: "RB" };

const plain = (value) => resistanceText(value).replace(" ", "");

/**
 * Everything the screen shows for a state: outputs (numbers + SI texts), the one-line read (Korean), and the math lines (course-math notation).
 * Y→Δ: R_AB = R_A + R_B + R_A·R_B/R_C; Δ→Y: R_A = R_AB·R_CA/(R_AB + R_BC + R_CA).
 */
export function evaluateTool(state) {
  const direction = DIRECTIONS[state.direction];
  const inputs = Object.fromEntries(direction.inputs.map((key) => [key, state.values[key]]));
  const converted = state.direction === "toDelta" ? convertYToDelta(inputs) : convertDeltaToY(inputs);
  const outputs = Object.fromEntries(direction.outputs.map((key) => [key, converted[key]]));
  const texts = { ...Object.fromEntries(direction.inputs.map((key) => [key, resistanceText(inputs[key])])), ...converted.text };
  const list = (keys, source) => keys.map((key) => `${key}=${texts[key]}`).join(", ");
  const values = direction.inputs.map((key) => inputs[key]);
  const equal = values.every((value) => Math.abs(value - values[0]) <= 1e-9 * values[0]);
  let remark;
  if (equal) {
    remark = state.direction === "toDelta" ? `세 저항이 같으므로 Δ의 변은 Y 팔의 3배(3R)입니다.` : `세 저항이 같으므로 Y의 팔은 Δ 변의 1/3(R/3)입니다.`;
  } else {
    const largest = direction.inputs[values.indexOf(Math.max(...values))];
    remark = state.direction === "toDelta"
      ? `가장 큰 팔 ${largest}의 맞은편 변 ${SIDES[largest]}가 가장 작은 변입니다.`
      : `가장 큰 변 ${largest}의 맞은편 팔 ${SIDES[largest]}가 가장 작은 팔입니다.`;
  }
  const read = `${direction.inputShape} (${list(direction.inputs)})와 단자 사이 저항이 같은 ${direction.outputShape}는 ${list(direction.outputs)}입니다. ${remark}`;
  const first = direction.outputs[0];
  const general = state.direction === "toDelta" ? "R_AB = R_A + R_B + R_A·R_B/R_C" : "R_A = R_AB·R_CA/(R_AB + R_BC + R_CA)";
  const [a, b, c] = direction.inputs.map((key) => plain(inputs[key]));
  const numeric = state.direction === "toDelta"
    ? `R_AB = ${a} + ${b} + (${a}·${b})/(${c}) = ${plain(outputs[first])}`
    : `R_A = (${a}·${c})/(${a} + ${b} + ${c}) = ${plain(outputs[first])}`;
  return { direction: state.direction, inputs, outputs, texts, read, math: { general, numeric } };
}

/**
 * Evaluate a candidate state completely BEFORE it is committed: { ok: true, evaluation } or { ok: false, reason } (Korean). A value can pass
 * validation and still overflow in the conversion (R_A = 1e308), so the controller only keeps a candidate that evaluates.
 */
export function attempt(candidate) {
  try { return { ok: true, evaluation: evaluateTool(candidate) }; } catch (error) { return { ok: false, reason: error instanceof RangeError ? error.message : "변환 결과를 계산하지 못했습니다." }; }
}
