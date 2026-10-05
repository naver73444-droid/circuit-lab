import test from "node:test";
import assert from "node:assert/strict";
import { applySweepValue, buildSweepCircuits, formatSIValue, mergeSweepResults, planSweep, sweepableProps, SWEEP_COLORS, SWEEP_MAX_COUNT } from "../../src/sweep-model.js";
import { measureCutoff, measureStepResponse } from "../../src/measure-model.js";
import { parseValue, simulate } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";

const near = (actual, expected, tolerance, message = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} vs ${expected} (±${tolerance})`);
const rel = (actual, expected, fraction, message = "") => near(actual, expected, Math.abs(expected) * fraction, message);

test("formatSIValue: parseValue로 다시 읽히고 'M'(메가) 모호성이 없다", () => {
  assert.equal(formatSIValue(1500), "1.5k");
  assert.equal(formatSIValue(2.2e6), "2.2meg");
  assert.equal(formatSIValue(4.7e-6), "4.7u");
  assert.equal(formatSIValue(1e-3), "1m");
  assert.equal(formatSIValue(999.96, 4), "1k");
  assert.equal(formatSIValue(0), "0");
  assert.equal(formatSIValue(-2500), "-2.5k");
  for (let exponent = -15; exponent <= 12; exponent += 1) {
    for (const mantissa of [1, 1.5, 2.2, 3.3, 4.7, 9.99]) {
      const value = mantissa * 10 ** exponent;
      rel(parseValue(formatSIValue(value, 4)), value, 1e-3, `${value}`);
    }
  }
  rel(parseValue(formatSIValue(3e-18)), 3e-18, 1e-9);
  rel(parseValue(formatSIValue(5e20)), 5e20, 1e-9);
});

test("planSweep 로그: 100 Ω – 10 kΩ 5점, 라벨과 검증", () => {
  const plan = planSweep("1k", { from: "100", to: "10k", count: 5, scale: "log" }, { type: "R", ref: "R1" });
  assert.equal(plan.ok, true);
  assert.equal(plan.values.length, 5);
  assert.deepEqual(plan.values.map((entry) => entry.text), ["100", "316", "1k", "3.16k", "10k"]);
  assert.equal(plan.values[0].label, "R1 = 100 Ω");
  assert.equal(plan.values[2].label, "R1 = 1 kΩ");
  assert.equal(plan.values[2].isBase, true);
  assert.equal(plan.values[1].isBase, false);
  for (const entry of plan.values) assert.equal(parseValue(entry.text), entry.value);
  assert.equal(new Set(plan.values.map((entry) => entry.label)).size, 5);
});

test("planSweep 선형·기본값·1점·최대 점 수", () => {
  const lin = planSweep("5", { from: "1", to: "10", count: 10, scale: "lin" }, { type: "V", ref: "V1" });
  assert.deepEqual(lin.values.map((entry) => entry.text), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.equal(lin.values[3].label, "V1 = 4 V");
  const withDefaults = planSweep("1k", {}, { type: "R" });
  assert.equal(withDefaults.ok, true);
  assert.equal(withDefaults.count, 5);
  assert.equal(withDefaults.values[0].text, "100");
  assert.equal(withDefaults.values.at(-1).text, "10k");
  const one = planSweep("1k", { from: "2.2k", to: "2.2k", count: 1 }, { type: "R" });
  assert.equal(one.ok, true);
  assert.equal(one.values[0].text, "2.2k");
  assert.equal(SWEEP_MAX_COUNT, 10);
  const fine = planSweep("1k", { from: "1000", to: "1001", count: 10, scale: "lin" }, { type: "R" });
  assert.equal(fine.ok, true);
  assert.equal(new Set(fine.values.map((entry) => entry.text)).size, 10, "가까운 값도 서로 다른 문자열");
  const negative = planSweep("0", { from: "-2", to: "2", count: 5, scale: "lin" }, { type: "V" });
  assert.deepEqual(negative.values.map((entry) => entry.value), [-2, -1, 0, 1, 2]);
});

test("planSweep 검증 오류는 ok:false + 한국어 이유", () => {
  const bad = [
    [planSweep("1k", { from: "100", to: "10k", count: 11 }), /최대 10개/],
    [planSweep("1k", { from: "100", to: "10k", count: 0 }), /1 이상/],
    [planSweep("1k", { from: "100", to: "10k", count: 2.5 }), /정수/],
    [planSweep("1k", { from: "abc", to: "10k" }), /해석할 수 없습니다/],
    [planSweep("1k", { from: "100", to: "1x2" }), /해석할 수 없습니다/],
    [planSweep("zz", { from: "1", to: "2" }), /현재 값/],
    [planSweep("1k", { from: "0", to: "10k", scale: "log" }), /로그/],
    [planSweep("1k", { from: "-5", to: "10k", scale: "lin" }, { type: "R", ref: "R1" }), /0보다 커야/],
    [planSweep("1k", { from: "5", to: "5", count: 3 }), /같아/],
    [planSweep("1k", { from: "1", to: "2", scale: "cubic" }), /선형/],
    [planSweep("", {}), /입력하세요/],
    [planSweep("0", {}, { type: "V" }), /입력하세요/],
  ];
  for (const [plan, pattern] of bad) {
    assert.equal(plan.ok, false);
    assert.match(plan.reason, pattern);
  }
});

test("sweepableProps / applySweepValue: 원본 불변, 잘못된 값 거부", () => {
  const { circuit } = cloneExample("rc-lowpass");
  const r1 = circuit.components.find((component) => component.id === "R1");
  assert.deepEqual(sweepableProps(r1), [{ key: "value", label: "저항", unit: "Ω" }]);
  const v1 = circuit.components.find((component) => component.id === "V1");
  assert.ok(sweepableProps(v1).some((prop) => prop.key === "amplitude"));
  assert.deepEqual(sweepableProps(circuit.components.find((component) => component.type === "GND")), []);
  const applied = applySweepValue(circuit, "R1", "value", "4.7k");
  assert.equal(applied.ok, true);
  assert.equal(applied.circuit.components.find((component) => component.id === "R1").props.value, "4.7k");
  assert.equal(r1.props.value, "1k", "원본은 그대로");
  assert.equal(applySweepValue(circuit, "R9", "value", "1k").ok, false);
  assert.equal(applySweepValue(circuit, "R1", "bogus", "1k").ok, false);
  assert.equal(applySweepValue(circuit, "R1", "value", "-5").ok, false);
  assert.equal(applySweepValue(circuit, "R1", "value", "five").ok, false);
});

test("AC 스윕 병합: R을 바꿔 가며 RC 저역통과를 겹쳐 그리면 fc ∝ 1/R", () => {
  const example = cloneExample("rc-lowpass");
  const plan = planSweep("1k", { from: "100", to: "10k", count: 3, scale: "log" }, { type: "R", ref: "R1" });
  const built = buildSweepCircuits(example.circuit, "R1", "value", plan);
  assert.equal(built.ok, true);
  const results = built.entries.map((entry) => simulate(entry.circuit, { ...example.settings, startFrequency: "1", endFrequency: "1meg" }));
  const probe = { key: "v-c1", kind: "voltage", componentId: "C1", pin: 0, label: "V(C1.1)", color: "#80bfff" };
  const merged = mergeSweepResults({ plan, results, probe });
  assert.equal(merged.ok, true);
  assert.equal(merged.analysis, "ac");
  assert.equal(merged.sharedX, true);
  assert.equal(merged.series.length, 3);
  assert.equal(new Set(merged.series.map((item) => item.label)).size, 3);
  assert.equal(new Set(merged.series.map((item) => item.color)).size, 3);
  assert.equal(new Set(merged.series.map((item) => item.key)).size, 3);
  assert.equal(merged.series[1].label, "V(C1.1) @ R1 = 1 kΩ");
  assert.equal(merged.series[0].quantity, "dBV");
  merged.series.forEach((item, index) => {
    const expectedFc = 1 / (2 * Math.PI * plan.values[index].value * 1e-6);
    rel(measureCutoff(item.xValues, item.values).value, expectedFc, 0.02, item.label);
  });
  const phase = mergeSweepResults({ plan, results, probe, acView: "phase" });
  assert.equal(phase.series[0].unit, "°");
  assert.ok(phase.series[0].values.at(-1) < -80, "고주파에서 위상은 -90°에 접근");
});

test("과도 스윕 병합: C를 바꿔 가며 상승시간이 RC에 비례", () => {
  const example = cloneExample("rc-charge");
  const plan = planSweep("1u", { from: "0.5u", to: "2u", count: 3, scale: "log" }, { type: "C", ref: "C1" });
  const built = buildSweepCircuits(example.circuit, "C1", "value", plan);
  const results = built.entries.map((entry) => simulate(entry.circuit, { ...example.settings, end: "20m", step: "20u" }));
  const probe = { key: "v-c", kind: "voltage", componentId: "C1", pin: 0, label: "V(C1.1)", color: "#80bfff" };
  const merged = mergeSweepResults({ plan, results, probe });
  assert.equal(merged.ok, true);
  assert.equal(merged.series[0].quantity, "V");
  merged.series.forEach((item, index) => {
    const step = measureStepResponse(item.xValues, item.values, { xUnit: "s", yUnit: "V" });
    rel(step.riseTime.value, 1e3 * plan.values[index].value * Math.log(9), 0.05, item.label);
  });
  // 전류 프로브
  const current = mergeSweepResults({ plan, results, probe: { key: "i-r1", kind: "current", componentId: "R1", label: "I(R1)", color: "#f5bc79" } });
  assert.equal(current.series[0].unit, "A");
  assert.equal(current.series[0].baseUnit, "A");
});

test("DC 스윕 병합과 실패/누락 결과 건너뛰기", () => {
  const example = cloneExample("divider");
  const plan = planSweep("1k", { from: "1k", to: "9k", count: 3, scale: "lin" }, { type: "R", ref: "R2" });
  const built = buildSweepCircuits(example.circuit, "R2", "value", plan);
  const results = built.entries.map((entry) => simulate(entry.circuit, { analysis: "dc" }));
  const probe = { key: "mid", kind: "voltage", componentId: "R1", pin: 1, label: "V(R1.2)", color: "#80bfff" };
  const merged = mergeSweepResults({ plan, results, probe });
  assert.deepEqual(merged.series.map((item) => item.values[0].toPrecision(6)), [10 * 1 / 2, 10 * 5 / 6, 10 * 9 / 10].map((value) => value.toPrecision(6)));
  const damaged = mergeSweepResults({ plan, results: [results[0], null, { ok: false, reason: "수렴하지 않음" }], probe });
  assert.equal(damaged.ok, true);
  assert.equal(damaged.series.length, 1);
  assert.deepEqual(damaged.skipped.map((item) => item.index), [1, 2]);
  assert.equal(damaged.skipped[1].reason, "수렴하지 않음");
  assert.equal(damaged.series[0].color, SWEEP_COLORS[0]);
  const allBad = mergeSweepResults({ plan, results: [null, null, null], probe });
  assert.equal(allBad.ok, false);
  const wrapped = mergeSweepResults({ plan, results: results.map((result) => ({ ok: true, result })), probe });
  assert.equal(wrapped.series.length, 3);
  assert.equal(mergeSweepResults({ plan, results, probe: { kind: "voltage", componentId: "NOPE", pin: 0, label: "x" } }).ok, false);
  assert.equal(mergeSweepResults({ plan: null, results, probe }).ok, false);
  assert.equal(buildSweepCircuits(example.circuit, "R2", "value", { ok: false, reason: "나쁜 계획" }).ok, false);
});
