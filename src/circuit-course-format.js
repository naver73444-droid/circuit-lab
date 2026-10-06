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
export const zText = z => (!z ? '유한한 값 없음' : fmt(z.re) + (z.im < 0 ? ' − j' : ' + j') + fmt(Math.abs(z.im)));
export function polarText(z) {
  const p = rectangularPolar(z);
  return fmt(p.magnitude) + ' ∠ ' + (p.angleDeg === null ? '위상 미정' : fmt(p.angleDeg) + '°');
}
// Textbook-style short number: 4 significant digits, used in the reading line.
export const short = n => (n === null || !Number.isFinite(n) ? '미정' : Number(n.toPrecision(4)).toString());
export const polarShort = z => {
  const p = rectangularPolar(z);
  return short(p.magnitude) + '∠' + (p.angleDeg === null ? '?' : short(p.angleDeg) + '°');
};
// Text field → finite number (plain decimal or e-notation), the one parser every course form uses.
export function parseCourseNumber(text) {
  const trimmed = String(text).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) throw new RangeError('유한한 숫자를 입력하세요. 예: -2.5, 3e-3');
  const n = Number(trimmed);
  if (!Number.isFinite(n) || (n === 0 && /[1-9]/.test(trimmed.split(/e/i)[0]))) throw new RangeError('숫자가 표현 범위를 벗어났습니다.');
  return n;
}
