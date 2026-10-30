// Number/phasor text formatting shared by the course views and the tool definitions. Pure; the formatters are built once.
import { rectangularPolar } from './circuit-course-model.js';

const FORMATS = {
  scientific: new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7, notation: 'scientific' }),
  standard: new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7, notation: 'standard' })
};
export function formatNumber(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '미정';
  const key = Math.abs(n) > 0 && (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e7) ? 'scientific' : 'standard';
  return FORMATS[key].format(Object.is(n, -0) ? 0 : n);
}
export const fmt = formatNumber;
// Four significant digits with thousands separators everywhere (2,087 · 6.81 · −141.8): one style for the three-phase reading,
// metrics and tables, whose numbers used to mix 7-digit grouped and 4-digit ungrouped texts.
const FORMATS4 = {
  scientific: new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4, notation: 'scientific' }),
  standard: new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4, notation: 'standard' })
};
export function fmt4(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '미정';
  const key = Math.abs(n) > 0 && (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e7) ? 'scientific' : 'standard';
  return FORMATS4[key].format(Object.is(n, -0) ? 0 : n);
}
export const zText = z => (!z ? '유한한 값 없음' : fmt(z.re) + (z.im < 0 ? ' − j' : ' + j') + fmt(Math.abs(z.im)));
export function polarText(z) {
  const p = rectangularPolar(z);
  return fmt(p.magnitude) + ' ∠ ' + (p.angleDeg === null ? '위상 미정' : fmt(p.angleDeg) + '°');
}
export function polarText4(z) {
  const p = rectangularPolar(z);
  return fmt4(p.magnitude) + ' ∠ ' + (p.angleDeg === null ? '위상 미정' : fmt4(p.angleDeg) + '°');
}
// Textbook-style short number: 4 significant digits, used in the reading line.
export const short = n => (n === null || !Number.isFinite(n) ? '미정' : Number(n.toPrecision(4)).toString());
export const polarShort = z => {
  const p = rectangularPolar(z);
  return short(p.magnitude) + '∠' + (p.angleDeg === null ? '?' : short(p.angleDeg) + '°');
};
// One-line map between the Ch.13 course tools and the circuit editor, shown at the end of each of those tool descriptions.
export const COUPLING_TOOL_GUIDE = '어느 도구? 고정 2루프·T/π 등가 → 자기결합 도구 · 이상·정격·단권 → 변압기 도구 · 임의 배선 → 회로 편집기 예제 "결합 코일 (예제 13.1)".';
// Capacitance in the unit that keeps the number readable: F, mF, µF, nF or pF (0 stays "0 µF"). format: fmt (7 digits) or short (4 digits).
export function capacitanceText(farads, format = fmt) {
  if (!Number.isFinite(farads)) return '미정';
  const size = Math.abs(farads);
  if (size === 0) return '0 µF';
  if (size >= 1) return format(farads) + ' F';
  if (size >= 1e-3) return format(farads * 1e3) + ' mF';
  if (size >= 1e-6) return format(farads * 1e6) + ' µF';
  if (size >= 1e-9) return format(farads * 1e9) + ' nF';
  return format(farads * 1e12) + ' pF';
}
// SI prefixes a course number may end with (case matters: m = milli, M = mega; u and µ = micro).
const SI_PREFIX = Object.freeze({ p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 });
// Text field → finite number (plain decimal or e-notation), the one parser every course form uses. si: also one SI prefix at the end
// (0.4u, 11.26n, 2k) — only for fields in base units (Ω, H, F, Hz), never for a field already shown in µF or kW.
export function parseCourseNumber(text, { si = false } = {}) {
  let trimmed = String(text).trim(), factor = 1;
  const prefix = trimmed.slice(-1);
  if (si && trimmed.length > 1 && Object.hasOwn(SI_PREFIX, prefix) && /\d\.?$/.test(trimmed.slice(0, -1))) { factor = SI_PREFIX[prefix]; trimmed = trimmed.slice(0, -1); }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) throw new RangeError('유한한 숫자를 입력하세요. 예: -2.5, 3e-3' + (si ? ', 0.4u, 10m, 2k' : ''));
  const n = Number(trimmed) * factor;
  if (!Number.isFinite(n) || (n === 0 && /[1-9]/.test(trimmed.split(/e/i)[0]))) throw new RangeError('숫자가 표현 범위를 벗어났습니다.');
  return n;
}
// A value with an SI prefix and four significant digits: 1.126e-8 F → "11.26 nF", 1200 H → "1.2 kH", 0 → "0 Ω".
export function siUnit(value, unit) {
  if (!Number.isFinite(value)) return '미정';
  if (value === 0) return '0 ' + unit;
  const prefixes = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  const [scale, p] = prefixes.find(([s]) => Math.abs(value) >= s * (1 - 5e-5)) ?? prefixes[prefixes.length - 1];
  return Number((value / scale).toPrecision(4)).toString() + ' ' + p + unit;
}
