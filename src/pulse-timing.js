// PULSE timing typed as a frequency and a duty cycle, as a lab sheet gives it ("1 kHz square wave"). The part keeps storing period and
// width (the engine and the file format read only those); these helpers show the two derived values and turn an edit of one of them
// back into new period/width strings. Duty = width / period (the high time; rise and fall are not counted). Pure, no DOM.
import { parseValue } from "./circuit-engine.js";

/** Inspector keys that are not stored on the part: an edit is applied through pulseEdit(). */
export const PULSE_DERIVED_KEYS = ["pulseFrequency", "pulseDuty"];

const PREFIXES = [[1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "u"], [1e-9, "n"], [1e-12, "p"]];
/** A value as the editor writes it (6 significant digits and an SI letter: 1k, 333.333u). */
export function siValueText(value) {
  if (value === 0) return "0";
  const [scale, prefix] = PREFIXES.find(([size]) => Math.abs(value) >= size * (1 - 1e-9)) ?? PREFIXES[PREFIXES.length - 1];
  return String(Number((value / scale).toPrecision(6))) + prefix;
}

function timing(props) {
  try {
    const period = parseValue(props.pulsePeriod ?? 2), width = parseValue(props.pulseWidth ?? 1);
    return period > 0 && Number.isFinite(period) && Number.isFinite(width) ? { period, width } : null;
  } catch { return null; }
}

/** The shown values of the derived fields: { pulseFrequency: "1k", pulseDuty: "50" }, empty strings when period/width cannot be read. */
export function pulseDerivedValues(props) {
  const t = timing(props);
  if (!t) return { pulseFrequency: "", pulseDuty: "" };
  return { pulseFrequency: siValueText(1 / t.period), pulseDuty: String(Number((100 * t.width / t.period).toPrecision(6))) };
}

/**
 * The stored props an edit of a derived field sets: a new frequency keeps the duty (period = 1/f, width = duty·period); a new duty keeps
 * the period. null when the text is not a usable value (frequency > 0, 0 < duty < 100) or the current period/width cannot be read.
 */
export function pulseEdit(props, key, text) {
  const t = timing(props);
  let value;
  try { value = parseValue(text); } catch { return null; }
  if (!t || !Number.isFinite(value)) return null;
  if (key === "pulseFrequency") {
    if (!(value > 0)) return null;
    const period = 1 / value;
    return { pulsePeriod: siValueText(period), pulseWidth: siValueText(period * Math.min(Math.max(t.width / t.period, 0), 1)) };
  }
  if (key === "pulseDuty") {
    if (!(value > 0 && value < 100)) return null;
    return { pulseWidth: siValueText(t.period * value / 100) };
  }
  return null;
}
