// Readable engineering text for EM measurements: SI prefixes and ~4 significant digits instead of raw exponents.
// Prefix selection reuses the circuit scope formatter's table (scope-model.js engineering); this module only adds the
// typographic minus sign, a shared prefix for vectors/ranges/phasors and a scientific fallback.
import { engineering } from './scope-model.js';

const PREFIX = new Map([[-15, 'f'], [-12, 'p'], [-9, 'n'], [-6, 'µ'], [-3, 'm'], [0, ''], [3, 'k'], [6, 'M'], [9, 'G'], [12, 'T']]);
// Only simple units (V, V/m, C/m², Wb ...) can take an SI prefix; "1", "arb.", "V m" or lists stay unscaled.
const PREFIXABLE = /^(?:[A-Za-zΩ]{1,2})(?:\/[A-Za-zΩ]{1,2}[²³]?)?$/;
const minus = text => text.replace(/^-/, '−');
const outOfRange = value => value !== 0 && (Math.abs(value) < 1e-15 || Math.abs(value) >= 1e15);
const scientific = (value, digits) => minus(Number(value.toExponential(digits - 1)).toExponential().replace('e+', 'e'));
const withUnit = (text, unit) => (unit && unit !== '1' ? `${text} ${unit}` : text);

/** Unit-free number with ~4 significant digits (ratios, arbitrary-unit math fields). */
export function plainText(value, digits = 4) {
  if (!Number.isFinite(value)) return '미정';
  if (value === 0) return '0';
  if (Math.abs(value) < 1e-4 || Math.abs(value) >= 1e7) return scientific(value, digits);
  return minus(String(Number(value.toPrecision(digits))));
}

/** One shared prefix for several values: { parts: ['6.902', '0', '0'], unit: 'V/m' }; the unit gains the prefix. */
export function siParts(values, unit = '', digits = 4) {
  if (!values.every(Number.isFinite)) return null;
  const largest = Math.max(0, ...values.map(Math.abs));
  if (!PREFIXABLE.test(unit) || largest === 0 || outOfRange(largest)) {
    return { parts: values.map(x => (Number.isFinite(x) && outOfRange(x) ? scientific(x, digits) : plainText(x, digits))), unit };
  }
  const exponent = Math.max(-15, Math.min(12, 3 * Math.floor(Math.log10(largest) / 3 + 1e-12)));
  const parts = values.map(x => (x === 0 || Math.abs(x) < largest * 1e-9 ? '0' : minus(String(Number((x / 10 ** exponent).toPrecision(digits))))));
  return { parts, unit: `${PREFIX.get(exponent)}${unit}` };
}

/** "6.902 V/m", "1.02 kV", "−3.5 µV"; exact zero is "0 V". */
export function siText(value, unit = '', digits = 4) {
  if (!Number.isFinite(value)) return '미정';
  if (!PREFIXABLE.test(unit)) return withUnit(plainText(value, digits), unit);
  if (outOfRange(value)) return `${scientific(value, digits)} ${unit}`;
  return minus(engineering(value, unit, digits));
}

/** "(6.902, 0, 0) V/m": one prefix for the whole vector, chosen from its largest component. */
export function siVector(vector, unit = '', digits = 4) {
  const shared = Array.isArray(vector) ? siParts(vector, unit, digits) : null;
  return shared ? withUnit(`(${shared.parts.join(', ')})`, shared.unit) : '미정';
}

/** "3 + j4 = 5 ∠ 53.13° V" complex value with one shared prefix; polar:false drops the magnitude/angle part. */
export function siComplex(re, im, unit = '', { digits = 4, polar = true } = {}) {
  const magnitude = Math.hypot(re, im);
  const shared = siParts([re, Math.abs(im), magnitude], unit, digits);
  if (!shared) return '미정';
  const angle = magnitude ? `${plainText(Math.atan2(im, re) * 180 / Math.PI, 4)}°` : '위상 미정';
  const rectangular = `${shared.parts[0]} ${im < 0 ? '−' : '+'} j${shared.parts[1]}`;
  return withUnit(polar ? `${rectangular} = ${shared.parts[2]} ∠ ${angle}` : rectangular, shared.unit);
}

/** Relative tolerance below which a value is floating-point cancellation noise of its own integrand scale. */
export const NOISE_RTOL = 1e-9;
export const NOISE_ZERO_TEXT = "≈ 0 (수치 오차 이내)";

/** True when 0 < |value| <= rtol * scale: indistinguishable from round-off of the terms that were summed. Exact 0 is not noise. */
export function isNumericNoise(value, scale, rtol = NOISE_RTOL) {
  return Number.isFinite(value) && Number.isFinite(scale) && scale > 0 && value !== 0 && Math.abs(value) <= rtol * scale;
}

/**
 * Display text for a quantity whose theoretical value may be 0 (closed integral of a conservative field, div/curl of a
 * solenoidal/irrotational field). scale is the magnitude of the terms that were summed (max|F|·path length, max|dFi/dxj|).
 * Returns { text, title, noise }: noise values read "≈ 0 (수치 오차 이내)" and keep the raw number in title for a tooltip.
 */
export function noiseAwareText(value, scale, format, rtol = NOISE_RTOL) {
  if (!isNumericNoise(value, scale, rtol)) return { text: format(value), title: "", noise: false };
  return { text: NOISE_ZERO_TEXT, title: `원시값 ${format(value)} · 판정 기준 |값| ≤ ${rtol}×${format(scale)} (적분 항 크기 대비 상대 허용오차)`, noise: true };
}

/** Same rule for a vector (curl): all components must be noise relative to one scale; the title lists the raw vector. */
export function noiseAwareVectorText(vector, scale, format, rtol = NOISE_RTOL) {
  const max = Array.isArray(vector) ? Math.max(...vector.map(Math.abs)) : NaN;
  if (!(max > 0) || !isNumericNoise(max, scale, rtol)) return { text: format(vector), title: "", noise: false };
  return { text: NOISE_ZERO_TEXT, title: `원시값 ${format(vector)} · 판정 기준 |성분| ≤ ${rtol}×${scale}`, noise: true };
}
