/**
 * Y–Δ resistor conversion mathematics (DOM 없음, 회로 구조를 모른다).
 *
 * The formulas are evaluated in the log domain (log-sum-exp), so very different magnitudes (10 Ω … 10 MΩ and beyond) neither overflow nor
 * lose the small term:
 *   Y→Δ  R_AB = R_A + R_B + R_A·R_B/R_C   (cyclic)
 *   Δ→Y  R_A  = R_AB·R_CA / (R_AB + R_BC + R_CA)   (cyclic)
 * Inputs are numbers or SI strings ("1k", "4.7meg", "10Ω") in the circuit engine's own notation, positive and finite only. Errors are
 * RangeError with Korean messages. The circuit-level detection and rewrite live in y-delta-circuit.js.
 */
import { parseValue } from "./circuit-engine.js";
import { engineering } from "./scope-model.js";

const TOOL_PREFIX = /^(?:meg|[TGMkmunpfµμ])$/i;

/**
 * Text typed into a tool field → positive finite resistance. Like parseResistance, but the unit must be none or ohm (Ω, ohm): "5V", "10uF",
 * "1kHz" parse as numbers in the circuit engine but are not resistances, so they are refused with the reason. Numbers pass unchanged.
 * (The part value editors keep using parseResistance.)
 */
export function parseResistanceInput(value, name = "저항") {
  if (typeof value === "string") {
    const match = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*([A-Za-zΩµμ]*)\s*$/.exec(value);
    if (match) {
      const unit = match[1].replace(/(?:ohm|Ω)$/i, "");
      if (unit !== "" && (!TOOL_PREFIX.test(unit) || unit === "F")) {
        throw new RangeError(`${name}에는 저항값을 넣어야 하므로 단위는 Ω(ohm)만 쓸 수 있습니다. '${value.trim()}'의 단위 '${match[1]}'을(를) 확인하세요. 예: 4.7k, 2.2meg, 330Ω`);
      }
    }
  }
  return parseResistance(value, name);
}

/** One resistance (number or SI text) → positive finite number. `name` labels the message ("R_A"). */
export function parseResistance(value, name = "저항") {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) throw new RangeError(`${name}은 숫자나 SI 값(예: 1k, 4.7meg)으로 입력해야 합니다.`);
  let resistance;
  try { resistance = parseValue(value, name); } catch { throw new RangeError(`${name} '${value}'을(를) 해석할 수 없습니다. 예: 1k, 4.7meg, 10Ω`); }
  if (!Number.isFinite(resistance) || resistance <= 0) throw new RangeError(`${name}은 0보다 큰 유한 저항이어야 합니다.`);
  return resistance;
}

function logSumExp(values) {
  const largest = Math.max(...values);
  return largest + Math.log(values.reduce((sum, value) => sum + Math.exp(value - largest), 0));
}

function representable(logValue, name) {
  const value = Math.exp(logValue);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} 결과가 숫자 범위를 벗어납니다.`);
  return value;
}

/** SI text with a unit for display: 3000 → "3 kΩ". */
export function resistanceText(value) {
  return engineering(value, "Ω", 4);
}

const textsOf = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resistanceText(value)]));

/** Y (R_A, R_B, R_C: arm from the centre to A, B, C) → equivalent Δ. Returns numbers and display texts. */
export function convertYToDelta(input) {
  const ra = parseResistance(input?.RA, "R_A");
  const rb = parseResistance(input?.RB, "R_B");
  const rc = parseResistance(input?.RC, "R_C");
  const la = Math.log(ra), lb = Math.log(rb), lc = Math.log(rc);
  const values = {
    RAB: representable(logSumExp([la, lb, la + lb - lc]), "R_AB"),
    RBC: representable(logSumExp([lb, lc, lb + lc - la]), "R_BC"),
    RCA: representable(logSumExp([lc, la, lc + la - lb]), "R_CA"),
  };
  return { ...values, text: textsOf(values) };
}

/** Δ (R_AB, R_BC, R_CA between the corners) → equivalent Y. Returns numbers and display texts. */
export function convertDeltaToY(input) {
  const rab = parseResistance(input?.RAB, "R_AB");
  const rbc = parseResistance(input?.RBC, "R_BC");
  const rca = parseResistance(input?.RCA, "R_CA");
  const lab = Math.log(rab), lbc = Math.log(rbc), lca = Math.log(rca);
  const denominator = logSumExp([lab, lbc, lca]);
  const values = {
    RA: representable(lab + lca - denominator, "R_A"),
    RB: representable(lab + lbc - denominator, "R_B"),
    RC: representable(lbc + lca - denominator, "R_C"),
  };
  return { ...values, text: textsOf(values) };
}

const SI_SUFFIX = new Map([[-12, "p"], [-9, "n"], [-6, "u"], [-3, "m"], [0, ""], [3, "k"], [6, "meg"], [9, "g"], [12, "t"]]);

/**
 * A resistance as the text a circuit part stores ("1.33333333333k"): 12 significant digits, so each stored value is within 5e-12 relative
 * of the exact one (half a unit of the last digit, worst for a mantissa just above 1) and a converted network stays electrically
 * equivalent to that tolerance; parseValue() of the text gives the rounded number back.
 */
export function resistanceCircuitText(value) {
  if (!(value > 0) || !Number.isFinite(value)) throw new RangeError("0보다 큰 유한 저항이 필요합니다.");
  const exponent = Math.max(-12, Math.min(12, 3 * Math.floor(Math.log10(value) / 3 + 1e-12)));
  const mantissa = Number((value / 10 ** exponent).toPrecision(12));
  return `${mantissa}${SI_SUFFIX.get(exponent)}`;
}

/** The one-line rules, in the course math notation (course-math-view). */
export const Y_DELTA_FORMULAS = Object.freeze({
  toDelta: ["R_AB = R_A + R_B + R_A·R_B/R_C", "R_BC = R_B + R_C + R_B·R_C/R_A", "R_CA = R_C + R_A + R_C·R_A/R_B"],
  toY: ["R_A = R_AB·R_CA/(R_AB + R_BC + R_CA)", "R_B = R_AB·R_BC/(R_AB + R_BC + R_CA)", "R_C = R_BC·R_CA/(R_AB + R_BC + R_CA)"],
});
