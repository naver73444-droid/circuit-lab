/**
 * 값 조절 시트(폰 바텀시트 · 데스크톱 속성 카드)의 순수 모델. DOM 없음.
 *  - 어떤 속성을 조절할지 (R/C/L 값; 전원은 속성의 함수 발생기 칸에서 정함)
 *  - ◀ ▶ 한 칸: E12/E24 표준값
 *  - 접두사 칩: 숫자는 그대로 두고 접두사만 바꿈 ("4.7" + k → "4.7k")
 *  - 로그 슬라이더: 끌기 시작 값 기준 ×0.1 … ×10, 유효숫자 3자리
 * 값 문자열은 엔진 파서(parseValue)가 읽는 표기만 만든다 (마이크로는 u, 메가는 M 또는 원래의 meg).
 */
import { E12, E24, parseSeriesText, stepSeriesText } from "./value-series.js";

export const SERIES = Object.freeze({ E12, E24 });

/** [저장 표기, 칩 글자]. "—"는 접두사 없음. */
export const PREFIX_CHIPS = Object.freeze([["p", "p"], ["n", "n"], ["u", "µ"], ["m", "m"], ["", "—"], ["k", "k"], ["M", "M"]]);

const TYPE_FIELDS = {
  R: { prop: "value", unit: "Ω", label: "저항" },
  C: { prop: "value", unit: "F", label: "커패시턴스" },
  L: { prop: "value", unit: "H", label: "인덕턴스" },
};

/**
 * The one value the sheet adjusts for a part (R, C, L: must stay > 0, E-series steps), or null. Sources have no
 * slider: they are set like a function generator in the inspector (several knobs, none of them "the" value).
 */
export function primaryValueField(component) {
  return component && TYPE_FIELDS[component.type] ? { ...TYPE_FIELDS[component.type] } : null;
}

const BARE_UNITS = new Set(["v", "a", "s", "hz", "h", "ohm", "deg"]); // plus "F" (farad); a lower-case f is femto
const PREFIX_LETTERS = { t: "T", g: "G", k: "k", m: "m", u: "u", n: "n", p: "p", f: "f" };

/** "4.7kohm" → { number: "4.7", prefix: "k", tail: "ohm" }; "k" → { number: "", prefix: "k", tail: "" }. Not a value at all → null. */
export function splitValueText(text) {
  const raw = String(text ?? "").trim().replaceAll("Ω", "ohm").replaceAll("µ", "u").replaceAll("μ", "u");
  const match = raw.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?)\s*([A-Za-z]*)$/);
  if (!match) return null;
  const number = match[1];
  let suffix = match[2];
  let prefix = "";
  if (suffix && suffix !== "F" && !BARE_UNITS.has(suffix.toLowerCase())) {
    if (suffix.toLowerCase().startsWith("meg")) { prefix = "meg"; suffix = suffix.slice(3); }
    else if (suffix.startsWith("M")) { prefix = "M"; suffix = suffix.slice(1); }
    else if (Object.hasOwn(PREFIX_LETTERS, suffix[0].toLowerCase())) { prefix = PREFIX_LETTERS[suffix[0].toLowerCase()]; suffix = suffix.slice(1); }
  }
  return { number, prefix, tail: suffix };
}

/** Keep the typed number (and unit tail), replace only the prefix. An empty or sign-only number becomes 1. */
export function withPrefix(text, prefix) {
  const parts = splitValueText(text) ?? { number: "", prefix: "", tail: "" };
  const number = /\d/.test(parts.number) ? parts.number : `${parts.number === "-" ? "-" : ""}1`;
  return `${number}${prefix}${parts.tail}`;
}

/** The prefix written in a value text ("" when none or unreadable); "meg" reads as "M". */
export function prefixOf(text) {
  const prefix = splitValueText(text)?.prefix ?? "";
  return prefix === "meg" ? "M" : prefix;
}

const GROUP_PREFIX = { 12: "T", 9: "G", 6: "M", 3: "k", 0: "", "-3": "m", "-6": "u", "-9": "n", "-12": "p", "-15": "f" };

/** 4730 → "4.73k" (digits significant figures, engineering prefix, parser-readable). */
export function formatValue(value, { tail = "", megStyle = "M", digits = 3 } = {}) {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return `0${tail}`;
  const sign = value < 0 ? "-" : "";
  let magnitude = Number(Math.abs(value).toPrecision(digits));
  let group = Math.max(-15, Math.min(12, 3 * Math.floor(Math.log10(magnitude) / 3 + 1e-12)));
  let mantissa = Number((magnitude / 10 ** group).toPrecision(digits));
  if (mantissa >= 1000 && group < 12) { group += 3; mantissa = Number((mantissa / 1000).toPrecision(digits)); }
  const prefix = group === 6 && megStyle === "meg" ? "meg" : GROUP_PREFIX[group];
  return `${sign}${mantissa}${prefix}${tail}`;
}

/** One step up (+1) or down (-1) along the E12/E24 series. Returns { text, value } or null (unreadable, not positive, out of range). */
export function stepValue(text, direction, { series = "E12" } = {}) {
  if (direction !== 1 && direction !== -1) return null;
  return stepSeriesText(text, direction, SERIES[series] ?? E12);
}

/** Slider position (−1 … 1) → base × 10^position, rounded to 3 significant figures. */
export function sliderToValue(base, position) {
  if (!Number.isFinite(base) || base === 0 || !Number.isFinite(position)) return null;
  const p = Math.max(-1, Math.min(1, position));
  return Number((base * 10 ** p).toPrecision(3));
}

/** Inverse of sliderToValue, clamped to −1 … 1; 0 when the two do not share a sign. */
export function valueToSlider(base, value) {
  if (!(base * value > 0)) return 0;
  return Math.max(-1, Math.min(1, Math.log10(value / base)));
}

/** The text the slider writes at `position`, keeping the unit tail and meg style of the base text. null when the base is 0 or unreadable. */
export function slideText(baseText, position) {
  const parsed = parseSeriesText(baseText);
  if (!parsed || parsed.value === 0) return null;
  const value = sliderToValue(parsed.value, position);
  return value === null ? null : formatValue(value, { tail: parsed.tail, megStyle: /meg/i.test(String(baseText)) ? "meg" : "M" });
}

/**
 * One adjustment gesture (a slider drag, a held ◀/▶, one chip tap, one typed value) = ONE undo step. Wraps the editor session's
 * mutateGrouped/closeEditGroup: every apply() of an open gesture folds into the history entry its first apply() recorded.
 */
export function createValueGesture({ mutateGrouped, closeEditGroup, idleMs = 10 * 60 * 1000 }) {
  let serial = 0;
  let key = null;
  const end = () => { if (key !== null) closeEditGroup(key); key = null; };
  return {
    begin(id) { end(); serial += 1; key = `value-adjust:${id}:${serial}`; return key; },
    apply(change) { if (key === null) throw new Error("value gesture not started"); mutateGrouped(key, change, { idleMs }); },
    end,
    get open() { return key !== null; },
  };
}
