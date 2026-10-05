/**
 * 두 커서 A/B 사이 차이 (순수 함수, DOM 없음). 값은 모두 원 표본 기준이며 B − A 이다.
 *   시간응답 : ΔT · ΔV(또는 ΔI) · 1/ΔT · 기울기(단위/s)
 *   AC       : Δf · Δ레벨(dB) 또는 Δ위상(°) · 기울기(dB/dec 또는 °/dec)
 */
import { cursorDelta, MEASURE_BASIS } from "./measure-model.js";

const dash = (id, label, reason) => ({ id, label, ok: false, text: "—", note: reason });

/**
 * options: {analysis:"transient"|"ac", xValues, values, indexA, indexB, quantity:"V"|"A"|"dBV"|"dBA"|"°"}
 * 반환: {ok, reason, basis, items:[{id,label,ok,text,note}]}
 */
export function describeCursorDelta({ analysis, xValues, values, indexA, indexB, quantity } = {}) {
  const frequency = analysis === "ac";
  const isDb = quantity === "dBV" || quantity === "dBA";
  const yUnit = isDb ? "dB" : quantity;
  const delta = cursorDelta(xValues, values, indexA, indexB, { xUnit: frequency ? "Hz" : "s", yUnit });
  if (!delta.ok) {
    const labels = frequency ? ["Δf", isDb ? "Δ레벨" : "Δ위상"] : ["ΔT", quantity === "A" ? "ΔI" : "ΔV"];
    return { ok: false, reason: delta.note, basis: MEASURE_BASIS, items: labels.map((label, index) => dash(`d${index}`, label, delta.note)) };
  }
  const entry = (id, label, item) => ({ id, label, ok: item.value !== null, text: item.value === null ? "—" : item.text, note: item.note ?? MEASURE_BASIS });
  if (!frequency) {
    return {
      ok: true,
      reason: null,
      basis: MEASURE_BASIS,
      items: [
        entry("dx", "ΔT", delta.dx),
        entry("dy", quantity === "A" ? "ΔI" : "ΔV", delta.dy),
        entry("inverse", "1/ΔT", delta.inverse),
        entry("slope", "기울기", delta.slope),
      ],
    };
  }
  const fa = xValues[indexA];
  const fb = xValues[indexB];
  const decades = fa > 0 && fb > 0 && fa !== fb ? Math.log10(fb / fa) : null;
  const slopeUnit = isDb ? "dB/dec" : "°/dec";
  const slope = decades !== null && Number.isFinite(delta.dy.value)
    ? { id: "slope", label: "기울기", ok: true, text: `${Number((delta.dy.value / decades).toPrecision(4))} ${slopeUnit}`, note: `${MEASURE_BASIS} · Δ값 / log10(fB/fA)` }
    : dash("slope", "기울기", "두 주파수가 달라야 하며 0보다 커야 합니다.");
  return {
    ok: true,
    reason: null,
    basis: MEASURE_BASIS,
    items: [
      entry("dx", "Δf", delta.dx),
      entry("dy", isDb ? "Δ레벨" : "Δ위상", delta.dy),
      slope,
    ],
  };
}

/** 한 줄 텍스트(접근성 라벨·테스트용). */
export function deltaText(description) {
  return description.items.map((item) => `${item.label} ${item.text}`).join(" · ");
}

/** B 커서 인덱스 이동. step: ±1 / "home" / "end". current가 null이면 fallback에서 시작한다. */
export function nextCursorB(current, step, length, fallback = 0) {
  if (!Number.isInteger(length) || length < 1) return null;
  if (step === "home") return 0;
  if (step === "end") return length - 1;
  const from = Number.isInteger(current) ? current : (Number.isInteger(fallback) ? fallback : 0);
  if (!Number.isInteger(current)) return Math.max(0, Math.min(length - 1, from));
  return Math.max(0, Math.min(length - 1, from + step));
}

