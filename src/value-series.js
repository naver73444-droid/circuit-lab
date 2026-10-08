/**
 * 휠로 부품 값을 바꿀 때 쓰는 E12 표준 값 계열 (DOM 없음, 엔진 import 없음).
 *
 * 계열: 1.0 1.2 1.5 1.8 2.2 2.7 3.3 3.9 4.7 5.6 6.8 8.2 (×10^n). 예: 1k → 1.2k → 1.5k … 8.2k → 10k.
 * 현재 값이 계열 위에 없으면(예: 1.1k) 방향에 따라 가장 가까운 계열 값으로 먼저 붙는다(위 → 1.2k, 아래 → 1k).
 * 접미사(k, meg, u …)와 단위(F, H, ohm …)는 원래 표기를 유지한다. 해석할 수 없거나 0 이하이면 null.
 */

export const E12 = Object.freeze([1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]);
/** E24: 값 조절 시트에서 더 촘촘하게 고를 때. */
export const E24 = Object.freeze([1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]);
/** 전원 값(V, A)용 "보기 좋은" 계열: 5 → 6 → 7 … 10 → 12 → 15 → 20. 저항 계열과 달리 정수 전압이 나온다. */
export const NICE = Object.freeze([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9]);
export const SERIES_MIN_EXPONENT = -15;
export const SERIES_MAX_EXPONENT = 12;

const PREFIX_EXPONENT = { T: 12, G: 9, k: 3, m: -3, u: -6, n: -9, p: -12, f: -15 };
const BARE_UNITS = new Set(["v", "a", "s", "hz", "h", "ohm", "deg"]);
const NUMBER = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE]([+-]?\d+))?\s*([A-Za-z]*)$/;

/** "4.7kohm" → {value:4700, tail:"ohm", megStyle:"meg"}  — 접미사를 쪼개 읽는다. 실패하면 null. */
export function parseSeriesText(text) {
  const raw = String(text ?? "").trim().replaceAll("Ω", "ohm").replaceAll("µ", "u").replaceAll("μ", "u");
  const match = raw.match(NUMBER);
  if (!match) return null;
  let suffix = match[3];
  let exponent = 0;
  let megStyle = "meg";
  const bare = (value) => value === "F" || BARE_UNITS.has(value.toLowerCase());
  if (suffix !== "" && !bare(suffix)) {
    if (suffix.toLowerCase().startsWith("meg")) { exponent = 6; suffix = suffix.slice(3); }
    else if (suffix.startsWith("M")) { exponent = 6; megStyle = "M"; suffix = suffix.slice(1); }
    else {
      const prefix = suffix[0].toLowerCase();
      const key = prefix === "t" ? "T" : prefix === "g" ? "G" : prefix;
      if (Object.hasOwn(PREFIX_EXPONENT, key)) { exponent = PREFIX_EXPONENT[key]; suffix = suffix.slice(1); }
    }
  }
  const value = Number(`${match[1]}e${Number(match[2] ?? 0) + exponent}`);
  if (!Number.isFinite(value)) return null;
  return { value, tail: suffix, megStyle };
}

function prefixFor(exponent, megStyle) {
  if (exponent === 6) return megStyle === "M" ? "M" : "meg";
  return { 12: "T", 9: "G", 3: "k", 0: "", "-3": "m", "-6": "u", "-9": "n", "-12": "p", "-15": "f" }[exponent] ?? "";
}

/** 계열 값(가수 mantissa, 10의 exponent 승)을 "1.2k" 같은 문자열로. */
export function formatSeriesValue(mantissa, exponent, { tail = "", megStyle = "meg" } = {}) {
  const group = Math.floor(exponent / 3) * 3;
  const shift = exponent - group;
  const digits = Number(`${mantissa}e${shift}`); // 1.2e2 → 120 (부동소수 오차 없이)
  return `${digits}${prefixFor(group, megStyle)}${tail}`;
}

/** 값 하나를 계열 위/아래 한 칸으로. direction: +1(위) | -1(아래). series: E12(기본) | E24 | NICE. 반환: {text, value} | null (범위 밖/해석 불가). */
export function stepSeriesText(text, direction, series = E12) {
  if (direction !== 1 && direction !== -1) return null;
  const parsed = parseSeriesText(text);
  if (!parsed || !(parsed.value > 0)) return null;
  let exponent = Math.floor(Math.log10(parsed.value) + 1e-12);
  let mantissa = parsed.value / 10 ** exponent;
  if (mantissa >= 10 - 1e-9) { mantissa /= 10; exponent += 1; }
  const eps = 1e-6;
  let next = null;
  if (direction === 1) {
    const index = series.findIndex((entry) => entry > mantissa * (1 + eps));
    next = index >= 0 ? { mantissa: series[index], exponent } : { mantissa: series[0], exponent: exponent + 1 };
  } else {
    let index = -1;
    for (let i = series.length - 1; i >= 0; i -= 1) if (series[i] < mantissa * (1 - eps)) { index = i; break; }
    next = index >= 0 ? { mantissa: series[index], exponent } : { mantissa: series[series.length - 1], exponent: exponent - 1 };
  }
  if (next.exponent < SERIES_MIN_EXPONENT || next.exponent > SERIES_MAX_EXPONENT) return null;
  const formatted = formatSeriesValue(next.mantissa, next.exponent, parsed);
  return { text: formatted, value: Number(`${next.mantissa}e${next.exponent}`) };
}
