// 교재 14장 편집기 예제(14.7 직렬 공진, 14.10 2차 저역통과): MNA AC 해석이 강의 값과 닫힌 식에 맞는지 고정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { simulate, simulateACAtFrequency } from "../../../src/circuit-engine.js";
import { cloneExample, examples } from "../../../src/examples.js";
import { measureCutoff } from "../../../src/measure-model.js";

const REL = 1e-4; // 크기 상대 오차
const DEG = 1e-3; // 위상 절대 오차(도)
const mag = (z) => Math.hypot(z.re, z.im);
const deg = (z) => (Math.atan2(z.im, z.re) * 180) / Math.PI;
const sub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.abs(expected), `${label}: ${actual} vs ${expected}`);
const nearDeg = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= DEG, `${label}: ${actual}° vs ${expected}°`);
const at = (example, frequency) => simulateACAtFrequency(example.circuit, String(frequency));

test("두 예제가 목록에 있다", () => {
  assert.ok(examples.some((item) => item.id === "series-resonance" && item.name === "직렬 공진 (예제 14.7)"));
  assert.ok(examples.some((item) => item.id === "lowpass-2nd" && item.name === "2차 저역통과 (예제 14.10)"));
});

test("예제 14.7 직렬 공진: f0에서 10 A∠0°, |V_L| = |V_C| = 500 V, 반전력점에서 7.071 A∠±45°", () => {
  const example = cloneExample("series-resonance");
  const R = 2, L = 1e-3, C = 0.4e-6, Vm = 20;
  const w0 = 1 / Math.sqrt(L * C);
  near(w0, 50e3, 1e-12, "ω0");
  near(R / L, 2000, 1e-12, "B");
  near((w0 * L) / R, 25, 1e-12, "Q");
  const f0 = w0 / (2 * Math.PI);
  near(f0, 7957.747, REL, "f0 (강의 값)");
  near(Number(example.settings.phasorFrequency), f0, 1e-9, "페이저 주파수 = f0");

  const result = at(example, example.settings.phasorFrequency);
  const point = result.points[0];
  const current = point.componentCurrents.R1;
  near(mag(current), 10, REL, "|I| at f0");
  nearDeg(deg(current), 0, "∠I at f0");
  const n = result.topology.nodeIdByPin;
  near(mag(sub(point.nodeVoltages[n["L1:0"]], point.nodeVoltages[n["L1:1"]])), 25 * Vm, REL, "|V_L| = Q·Vm");
  near(mag(point.nodeVoltages[n["C1:0"]]), 25 * Vm, REL, "|V_C| = Q·Vm");

  const a = R / (2 * L);
  const w1 = -a + Math.sqrt(a * a + w0 * w0);
  const w2 = a + Math.sqrt(a * a + w0 * w0);
  near(w1, 49.01e3, REL, "ω1 (강의 값)");
  near(w1 / (2 * Math.PI), 7800.2, REL, "f1 (강의 값)");
  const lower = at(example, w1 / (2 * Math.PI)).points[0].componentCurrents.R1;
  near(mag(lower), 7.071, REL, "|I| at ω1");
  nearDeg(deg(lower), 45, "∠I at ω1");
  const upper = at(example, w2 / (2 * Math.PI)).points[0].componentCurrents.R1;
  near(mag(upper), 10 / Math.SQRT2, REL, "|I| at ω2");
  nearDeg(deg(upper), -45, "∠I at ω2");
});

test("예제 14.7 스윕: f0가 표본점이고 거기서 최대, 자동 −3 dB 대역폭은 보간 근사(설명의 316.9 Hz)", () => {
  const example = cloneExample("series-resonance");
  const result = simulate(example.circuit, example.settings);
  const f0 = 1 / (2 * Math.PI * Math.sqrt(1e-3 * 0.4e-6));
  assert.equal(result.xValues.length, 81);
  near(result.xValues[40], f0, 1e-9, "40번째 표본 = f0");
  const db = result.points.map((point) => 20 * Math.log10(mag(point.componentCurrents.R1)));
  const cutoff = measureCutoff(result.xValues, db);
  assert.equal(cutoff.type, "bandpass");
  near(cutoff.peakFrequency, f0, 1e-9, "봉우리 표본");
  near(cutoff.bandwidth, 316.93, 1e-3, "자동 대역폭(표본 보간)");
  assert.ok(Math.abs(cutoff.bandwidth - 2000 / (2 * Math.PI)) < 2, "정확값 318.3 Hz와 2 Hz 이내");
  assert.match(example.description, /316\.9 Hz/);
});

test("예제 14.10 2차 저역통과: H(0)=1, 강의 차단 ωc에서 |Vo| = 0.7071, +6.30 dB 봉우리", () => {
  const example = cloneExample("lowpass-2nd");
  const R = 2000, L = 2, C = 2e-6;
  // |H|² = R² / D(ω²), D(x) = (RLC)²x² + (L² − 2R²LC)x + R²
  const A = (R * L * C) ** 2, B = L * L - 2 * R * R * L * C, C0 = R * R;
  const wc = Math.sqrt((-B + Math.sqrt(B * B - 4 * A * (C0 - 2 * R * R))) / (2 * A));
  const wp = Math.sqrt(-B / (2 * A));
  const fc = wc / (2 * Math.PI);
  near(wc, 742.25, REL, "ωc (강의 값 742.3)");
  near(fc, 118.13, REL, "fc");
  near(Number(example.settings.phasorFrequency), fc, 1e-9, "페이저 주파수 = fc");
  const vo = (frequency) => {
    const result = at(example, frequency);
    return result.points[0].nodeVoltages[result.topology.nodeIdByPin["R1:0"]];
  };
  const atCutoff = vo(example.settings.phasorFrequency);
  near(mag(atCutoff), Math.SQRT1_2, REL, "|Vo| at fc");
  nearDeg(deg(atCutoff), -148.3416, "∠Vo at fc");
  near(mag(vo(0.01)), 1, REL, "|Vo| at 0.01 Hz ≈ H(0)");
  near(wp, 467.7, REL, "봉우리 ω");
  near(20 * Math.log10(mag(vo(wp / (2 * Math.PI)))), 6.30, 1e-3, "봉우리 dB");
});

test("예제 14.10 스윕: fc가 표본점, 자동 −3 dB는 봉우리 기준이라 대역통과 43.02 Hz로 읽는다", () => {
  const example = cloneExample("lowpass-2nd");
  const result = simulate(example.circuit, example.settings);
  assert.equal(result.xValues.length, 601);
  const node = result.topology.nodeIdByPin["R1:0"];
  near(result.xValues[400], 118.1335, 1e-6, "400번째 표본 = fc");
  near(mag(result.points[400].nodeVoltages[node]), Math.SQRT1_2, REL, "표본 fc의 |Vo|");
  const db = result.points.map((point) => 20 * Math.log10(mag(point.nodeVoltages[node])));
  const cutoff = measureCutoff(result.xValues, db);
  assert.equal(cutoff.type, "bandpass");
  near(cutoff.referenceDb, 6.30, 1e-3, "기준 = 봉우리");
  near(cutoff.bandwidth, 43.02, 1e-3, "대역폭");
  near(cutoff.lower, 49.75, 1e-3, "아래 교차");
  near(cutoff.upper, 92.77, 1e-3, "위 교차");
  assert.match(example.description, /43\.0 Hz/);
  assert.match(example.description, /118\.13 Hz/);
});
