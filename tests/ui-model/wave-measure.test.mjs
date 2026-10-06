import test from "node:test";
import assert from "node:assert/strict";
import { measureTraces, summaryLine, MEASURE_MAX_ROWS } from "../../src/wave-measure-model.js";
import { describeCursorDelta, nextCursorB } from "../../src/cursor-delta-model.js";
import { measurePeriod, measureCutoff } from "../../src/measure-model.js";
import { simulate } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";

const near = (actual, expected, tolerance, message = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} vs ${expected} (±${tolerance})`);
const rel = (actual, expected, fraction, message = "") => near(actual, expected, Math.abs(expected) * fraction, message);
const sine = (count, dt, amplitude, frequency, offset = 0) => {
  const xValues = Array.from({ length: count }, (_, i) => i * dt);
  return { xValues, raw: xValues.map((t) => offset + amplitude * Math.sin(2 * Math.PI * frequency * t)) };
};
const cell = (row, id) => row.cells.find((entry) => entry.id === id);

test("측정 표: 사인파 Vpp·평균·RMS·주기·주파수는 원 표본에서 나온다", () => {
  const { xValues, raw } = sine(2001, 5e-6, 2, 1000, 1);
  const measured = measureTraces({ analysis: "transient", traces: [{ key: "v", label: "V(a)", color: "#80bfff", baseUnit: "V", raw, xValues }] });
  assert.equal(measured.ok, true);
  assert.equal(measured.domain, "time");
  assert.equal(measured.basis, "표본 기준");
  const [row] = measured.rows;
  rel(cell(row, "vpp").value, 4, 1e-3);
  rel(cell(row, "mean").value, 1, 2e-3);
  rel(cell(row, "frequency").value, 1000, 1e-3);
  rel(cell(row, "period").value, 1e-3, 1e-3);
  assert.deepEqual(row.cells.map((entry) => entry.id), ["vpp", "mean", "rms", "period", "frequency"]);
  assert.match(row.summary, /Vpp .*V/);
  assert.match(row.summary, /주파수 1 kHz/);
  assert.match(summaryLine(measured, "v"), /RMS/);
  const pure = sine(2001, 5e-6, 2, 1000);
  rel(cell(measureTraces({ analysis: "transient", traces: [{ key: "p", label: "p", color: "#fff", baseUnit: "V", ...pure }] }).rows[0], "rms").value, 2 / Math.SQRT2, 1e-3, "RMS = A/√2");
});

test("3주기 창(자동 시간축)에서도 하강 교차로 주기를 잰다", () => {
  const { xValues, raw } = sine(501, 6e-6, 1, 1000); // 정확히 3 ms = 3주기, 시작이 기준 수준
  const result = measurePeriod(xValues, raw, { xUnit: "s", yUnit: "V" });
  rel(result.period.value, 1e-3, 5e-3);
  assert.match(result.period.note, /하강 교차/);
  // 상승 교차만으로 충분하면 기존처럼 상승 교차
  const long = sine(2001, 5e-6, 1, 1000);
  assert.match(measurePeriod(long.xValues, long.raw, { xUnit: "s" }).period.note, /상승 교차/);
  // 1.5주기는 여전히 측정 불가
  const short = sine(150, 1 / 100, 1, 1);
  assert.equal(measurePeriod(short.xValues, short.raw, { xUnit: "s" }).period.value, null);
});

test("측정 불가는 '—' + 사유(note), 일정한 신호는 주기 없음", () => {
  const xValues = Array.from({ length: 50 }, (_, i) => i * 1e-3);
  const measured = measureTraces({ analysis: "transient", traces: [{ key: "c", label: "const", color: "#fff", baseUnit: "V", raw: xValues.map(() => 2), xValues }] });
  const row = measured.rows[0];
  assert.equal(cell(row, "period").text, "—");
  assert.equal(cell(row, "period").ok, false);
  assert.match(cell(row, "period").note, /일정/);
  assert.equal(cell(row, "vpp").text, "0 V");
  assert.doesNotMatch(row.summary, /주파수/, "한 줄 요약에는 측정 가능한 항목만");
});

test("DC는 측정 표가 없고, 행은 최대 3개 + 생략 개수", () => {
  assert.equal(measureTraces({ analysis: "dc", traces: [{ key: "a", raw: [1], xValues: [0] }] }).ok, false);
  const xValues = Array.from({ length: 40 }, (_, i) => i);
  const traces = Array.from({ length: 5 }, (_, i) => ({ key: `t${i}`, label: `t${i}`, color: "#fff", baseUnit: "V", raw: xValues.map((x) => Math.sin(x) + i), xValues }));
  const measured = measureTraces({ analysis: "transient", traces });
  assert.equal(measured.rows.length, MEASURE_MAX_ROWS);
  assert.equal(measured.hidden, 2);
  assert.equal(measureTraces({ analysis: "transient", traces, maxRows: 10 }).rows.length, 5);
});

test("RC 저역통과 AC: −3 dB 주파수 ≈ 1/(2πRC) (1 % 이내), 위상 보기와 무관한 원 표본", () => {
  const example = cloneExample("rc-lowpass");
  const result = simulate(example.circuit, example.settings);
  const node = result.topology.nodeIdByPin["C1:0"];
  const raw = result.points.map((point) => point.nodeVoltages[node]);
  const measured = measureTraces({ analysis: "ac", traces: [{ key: "v", label: "V(C1.1)", color: "#fff", baseUnit: "V", raw, xValues: result.xValues }] });
  assert.equal(measured.domain, "frequency");
  const row = measured.rows[0];
  const cutoff = cell(row, "cutoff");
  assert.equal(cutoff.label, "−3 dB 차단");
  rel(cutoff.value, 1 / (2 * Math.PI * 1e3 * 1e-6), 0.01);
  assert.match(cutoff.text, /Hz/);
  assert.doesNotMatch(cutoff.text, /≈/, "통과대역이 범위 안이면 ≈를 붙이지 않는다");
  assert.deepEqual(row.cells.map((entry) => entry.id), ["max", "cutoff"]);
});

test("범위 가장자리에서 이미 내려가는 곡선의 −3 dB는 '≈'와 주의 사유", () => {
  const example = cloneExample("rc-lowpass");
  example.circuit.components.find((component) => component.id === "R1").props.value = "10k"; // fc = 15.9 Hz, 시작 10 Hz
  const result = simulate(example.circuit, example.settings);
  const node = result.topology.nodeIdByPin["C1:0"];
  const raw = result.points.map((point) => point.nodeVoltages[node]);
  const cutoff = cell(measureTraces({ analysis: "ac", traces: [{ key: "v", label: "v", color: "#fff", baseUnit: "V", raw, xValues: result.xValues }] }).rows[0], "cutoff");
  assert.match(cutoff.text, /^≈ /);
  assert.match(cutoff.note, /통과대역/);
  // 평평한 통과대역은 영향 없음
  const flat = measureCutoff([1, 10, 100, 1000, 10000], [0, 0, -0.1, -3.5, -20]);
  assert.equal(flat.edgeReference, false);
});

test("A/B 차이: 시간응답 ΔT·ΔV·1/ΔT·기울기 (B−A, 원 표본)", () => {
  const { xValues, raw } = sine(1001, 1e-5, 1, 100);
  const described = describeCursorDelta({ analysis: "transient", xValues, values: raw, indexA: 100, indexB: 350, quantity: "V" });
  assert.equal(described.ok, true);
  assert.deepEqual(described.items.map((item) => item.label), ["ΔT", "ΔV", "1/ΔT", "기울기"]);
  const [dt, dv, inverse, slope] = described.items;
  assert.equal(dt.text, "2.5 ms");
  near(Number.parseFloat(dv.text), (raw[350] - raw[100]) * 1000, 0.5, "mV");
  assert.match(inverse.text, /^400 Hz$/);
  assert.match(slope.text, /V\/s$/);
  // 전류는 ΔI
  assert.equal(describeCursorDelta({ analysis: "transient", xValues, values: raw, indexA: 1, indexB: 2, quantity: "A" }).items[1].label, "ΔI");
  // 같은 인덱스: 1/ΔT·기울기는 계산 불가
  const same = describeCursorDelta({ analysis: "transient", xValues, values: raw, indexA: 5, indexB: 5, quantity: "V" });
  assert.equal(same.items[2].ok, false);
  assert.match(same.items[2].note, /0/);
  // 누락 표본/범위 밖
  const gap = raw.slice(); gap[7] = NaN;
  assert.equal(describeCursorDelta({ analysis: "transient", xValues, values: gap, indexA: 7, indexB: 9, quantity: "V" }).ok, false);
  assert.equal(describeCursorDelta({ analysis: "transient", xValues, values: raw, indexA: 0, indexB: 5000, quantity: "V" }).items[0].text, "—");
});

test("A/B 차이: AC Δf·Δ레벨·dB/dec 기울기", () => {
  const xValues = [10, 100, 1000, 10000];
  const values = [0, -0.04, -3, -20]; // dBV
  const described = describeCursorDelta({ analysis: "ac", xValues, values, indexA: 2, indexB: 3, quantity: "dBV" });
  assert.deepEqual(described.items.map((item) => item.label), ["Δf", "Δ레벨", "기울기"]);
  assert.equal(described.items[0].text, "9 kHz");
  assert.equal(described.items[1].text, "-17 dB");
  assert.equal(described.items[2].text, "-17 dB/dec");
  const phase = describeCursorDelta({ analysis: "ac", xValues, values: [0, -5, -45, -84], indexA: 1, indexB: 3, quantity: "°" });
  assert.equal(phase.items[1].label, "Δ위상");
  assert.equal(phase.items[2].text, "-39.5 °/dec");
  assert.equal(describeCursorDelta({ analysis: "ac", xValues, values, indexA: 1, indexB: 1, quantity: "dBV" }).items[2].ok, false);
});

test("B 커서 이동: 처음·끝·한 칸, 시작점이 없으면 A에서 시작하고 범위를 넘지 않는다", () => {
  assert.equal(nextCursorB(5, 1, 10), 6);
  assert.equal(nextCursorB(9, 1, 10), 9);
  assert.equal(nextCursorB(0, -1, 10), 0);
  assert.equal(nextCursorB(null, 1, 10, 4), 4);
  assert.equal(nextCursorB(3, "home", 10), 0);
  assert.equal(nextCursorB(3, "end", 10), 9);
  assert.equal(nextCursorB(3, 1, 0), null);
  assert.equal(nextCursorB(null, -1, 10, 99), 9);
});
