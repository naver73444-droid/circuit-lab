/**
 * 파형 패널의 자동 측정 표 (순수 함수, DOM 없음).
 * 입력은 solver가 낸 원 표본(raw)이다 — 화면 배율(mA 등)·AC 보기(크기/위상) 선택과 무관하게 같은 값이 나온다.
 *   시간응답: Vpp · 평균 · RMS · 주기 · 주파수
 *   AC      : 최대 이득 · −3 dB 주파수 (크기 dB 곡선 기준)
 *   DC      : 측정 없음
 * 계산은 measure-model.measureAll에 맡기고, 여기서는 어떤 항목을 어떤 모양으로 보일지만 정한다.
 */
import { measureAll, MEASURE_BASIS } from "./measure-model.js";
import { acMagnitudeLevel } from "./measurement-format.js";

export const MEASURE_MAX_ROWS = 3;

const TIME_CELLS = [["vpp", "Vpp"], ["mean", "평균"], ["rms", "RMS"], ["period", "주기"], ["frequency", "주파수"]];
const SUMMARY_IDS = ["vpp", "mean", "rms", "frequency"];

function cell(label, item, id) {
  const ok = Boolean(item) && item.value !== null;
  return {
    id,
    label,
    ok,
    value: ok ? item.value : null,
    // 최대값이 범위 가장자리라 기준이 불확실한 −3 dB는 ≈로 표시한다(사유는 말풍선).
    text: ok ? `${item.edgeReference ? "≈ " : ""}${item.text}` : "—",
    // 측정 불가 사유(또는 계산 방식)는 말풍선으로만 보인다.
    note: item?.note ?? "측정할 수 없습니다.",
  };
}

function cutoffLabel(item) {
  if (item?.type === "bandpass") return "−3 dB 대역폭";
  if (item?.type === "lowpass" || item?.type === "highpass") return "−3 dB 차단";
  return "−3 dB";
}

function timeRow(trace) {
  const y = trace.raw;
  const measured = measureAll(trace.xValues, y, { domain: "time", xUnit: "s", yUnit: trace.baseUnit });
  if (!measured.ok) return { cells: [], error: measured.reason };
  return { cells: TIME_CELLS.map(([id, label]) => cell(label, measured.items[id], id)), error: null };
}

function frequencyRow(trace) {
  const unit = trace.baseUnit === "A" ? "dBA" : "dBV";
  const db = trace.raw.map((value) => acMagnitudeLevel(value, trace.baseUnit === "A" ? "A" : "V").value);
  const measured = measureAll(trace.xValues, db, { domain: "frequency", xUnit: "Hz", yUnit: unit });
  if (!measured.ok) return { cells: [], error: measured.reason };
  const cutoff = measured.items.cutoff;
  return {
    cells: [cell("최대", measured.items.max, "max"), cell(cutoffLabel(cutoff), cutoff, "cutoff")],
    error: null,
  };
}

/**
 * traces: [{key, label, color, baseUnit:"V"|"A", raw:number[]|{re,im}[], xValues:number[]}]
 * 반환: {ok, domain, basis, rows:[{key,label,color,cells,summary,error}], hidden}
 *   rows는 최대 maxRows개(기본 3). summary는 한 줄 요약(측정 가능한 항목만).
 */
export function measureTraces({ analysis, traces = [], maxRows = MEASURE_MAX_ROWS } = {}) {
  if (analysis !== "transient" && analysis !== "ac") return { ok: false, domain: "none", basis: MEASURE_BASIS, rows: [], hidden: 0 };
  const domain = analysis === "ac" ? "frequency" : "time";
  const rows = traces.slice(0, maxRows).map((trace) => {
    const row = domain === "frequency" ? frequencyRow(trace) : timeRow(trace);
    const wanted = domain === "frequency" ? ["max", "cutoff"] : SUMMARY_IDS;
    const summaryCells = row.cells.filter((entry) => wanted.includes(entry.id) && entry.ok);
    return {
      key: trace.key,
      label: trace.label,
      color: trace.color,
      cells: row.cells,
      error: row.error,
      summary: summaryCells.map((entry) => `${entry.label} ${entry.text}`).join(" · "),
    };
  });
  return { ok: rows.length > 0, domain, basis: MEASURE_BASIS, rows, hidden: Math.max(0, traces.length - rows.length) };
}

/** 선택된 트레이스(없으면 첫 행)의 한 줄 요약. */
export function summaryLine(measured, activeKey = null) {
  if (!measured?.ok) return "";
  const row = measured.rows.find((item) => item.key === activeKey) ?? measured.rows[0];
  if (!row) return "";
  return row.summary || (row.error ? `측정 불가 · ${row.error}` : "측정 불가");
}
