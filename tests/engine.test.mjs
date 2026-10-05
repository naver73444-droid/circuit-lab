import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analyzeIdealVoltageConstraints,
  CircuitError,
  buildTopology,
  deserializeCircuit,
  parseValue,
  serializeCircuit,
  simulateAC,
  simulateACAtFrequency,
  simulateDC,
  simulateTransient,
} from "../src/circuit-engine.js";
import { describeCircuitFailure, resultAvailabilityText, runStateLabel } from "../src/analysis-diagnostics.js";
import { beginPointerSession, finishPointerSession, ownsPointer } from "../src/pointer-session.js";
import {
  acceptsRunGeneration,
  classifyNumericInput,
  cloneSelectedComponent,
  deleteJunctionFromCircuit,
  retargetWireProbes,
  splitWireAtJunction,
} from "../src/circuit-edit.js";
import { cloneExample } from "../src/examples.js";
import { acMagnitudeLevel } from "../src/measurement-format.js";
import { currentDisplayScale, dcOperatingPointModel, displayAxes } from "../src/plot-format.js";
import { deserializeProject, serializeProject } from "../src/project-format.js";
import { buildResultsCSV, parseCSV, stringifyCSV } from "../src/csv-format.js";
import {
  divideComplex,
  peakToRms,
  phasorAxis,
  phasorFromPolar,
  phasorPolar,
  phasorTimeValue,
  quantityDisplayScale,
  theoreticalImpedance,
  wrapPhaseDifference,
} from "../src/phasor-format.js";
import {
  appendFixedWaypoint,
  localPin,
  pinPosition,
  projectSplitPoint,
  routeWirePoints,
  snapPoint,
} from "../src/circuit-geometry.js";
import { classifyCircuitConnections } from "../src/circuit-status.js";
import { nextAvailableProbeColor, passiveSliderModel, probeKeysForTarget, removeProbeByKey, sourceInlineDescriptor } from "../src/ui-model.js";

function nodeFor(result, componentId, pin) {
  return result.topology.nodeIdByPin[`${componentId}:${pin}`];
}

function voltage(result, pointIndex, componentId, pin = 0) {
  return result.points[pointIndex].nodeVoltages[nodeFor(result, componentId, pin)];
}

function nearestIndex(values, target) {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) if (Math.abs(values[index] - target) < Math.abs(values[best] - target)) best = index;
  return best;
}

function seriesCircuit(parts, { magnitude = 1, phase = 0 } = {}) {
  const components = [
    { id: "V1", type: "V", props: { ref: "V1", mode: "DC", dc: "0", acMagnitude: String(magnitude), acPhase: String(phase) } },
    ...parts.map((part) => ({ id: part.id, type: part.type, props: { ref: part.id, value: String(part.value), ...(part.type === "C" || part.type === "L" ? { ic: "0" } : {}) } })),
    { id: "G1", type: "GND", props: { ref: "GND" } },
  ];
  const wires = [{ id: "W0", a: { componentId: "V1", pin: 0 }, b: { componentId: parts[0].id, pin: 0 } }];
  for (let index = 0; index < parts.length - 1; index += 1) {
    wires.push({ id: `W${index + 1}`, a: { componentId: parts[index].id, pin: 1 }, b: { componentId: parts[index + 1].id, pin: 0 } });
  }
  wires.push({ id: "WG", a: { componentId: parts.at(-1).id, pin: 1 }, b: { componentId: "G1", pin: 0 } });
  wires.push({ id: "WV", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 } });
  return { version: 1, components, wires };
}

function complexDivide(numerator, denominator) {
  return divideComplex(numerator, denominator);
}

function complexRelativeError(actual, expected) {
  const error = Math.hypot(actual.re - expected.re, actual.im - expected.im);
  const scale = Math.hypot(expected.re, expected.im);
  return scale < 1e-9 ? error : error / scale;
}

test("단위 F와 femto 접두사를 구분한다", () => {
  assert.equal(parseValue("1 F"), 1);
  assert.equal(parseValue("1F"), 1);
  assert.equal(parseValue("1 fF"), 1e-15);
  assert.equal(parseValue("1f"), 1e-15);
  assert.equal(parseValue("2.2 mF"), 2.2e-3);
  assert.equal(parseValue("10 kHz"), 10e3);
});

test("DC 분압기: 5 V와 5 mA, 상대오차 0.1% 이내", () => {
  const { circuit } = cloneExample("divider");
  const result = simulateDC(circuit);
  const middle = voltage(result, 0, "R2", 0);
  const current = result.points[0].componentCurrents.R1;
  assert.ok(Math.abs(middle - 5) / 5 <= 0.001, `middle=${middle}`);
  assert.ok(Math.abs(current - 0.005) / 0.005 <= 0.001, `current=${current}`);
});

test("RC 계단: tau 정확도와 dt 절반 수렴", () => {
  const { circuit } = cloneExample("rc-charge");
  const expected = 5 * (1 - Math.exp(-1));
  const coarse = simulateTransient(circuit, { start: 0, end: "2m", step: "10u" });
  const fine = simulateTransient(circuit, { start: 0, end: "2m", step: "5u" });
  const coarseValue = voltage(coarse, nearestIndex(coarse.xValues, 0.001), "C1", 0);
  const fineValue = voltage(fine, nearestIndex(fine.xValues, 0.001), "C1", 0);
  const coarseError = Math.abs(coarseValue - expected) / 5;
  const fineError = Math.abs(fineValue - expected) / 5;
  assert.ok(coarseError <= 0.01, `coarse=${coarseValue}, error=${coarseError}`);
  assert.ok(fineError <= 0.01, `fine=${fineValue}, error=${fineError}`);
  assert.ok(fineError < coarseError, `fineError=${fineError}, coarseError=${coarseError}`);
});

test("시간응답 t=0은 DC 전원과 저항의 제약을 만족한다", () => {
  const { circuit } = cloneExample("divider");
  const result = simulateTransient(circuit, { start: 0, end: "1m", step: "1m" });
  assert.equal(voltage(result, 0, "V1", 0), 10);
  assert.equal(voltage(result, 0, "R2", 0), 5);
  assert.equal(result.points[0].componentCurrents.R1, 0.005);
});

test("시간응답 t=0은 비접지 커패시터 초기 전압을 만족한다", () => {
  const circuit = {
    version: 1,
    components: [
      { id: "R1", type: "R", props: { ref: "R1", value: "1k" } },
      { id: "R2", type: "R", props: { ref: "R2", value: "1k" } },
      { id: "C1", type: "C", props: { ref: "C1", value: "1uF", ic: "2V" } },
      { id: "G1", type: "GND", props: { ref: "GND" } },
    ],
    wires: [
      { id: "W1", a: { componentId: "R1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      { id: "W2", a: { componentId: "R2", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      { id: "W3", a: { componentId: "C1", pin: 0 }, b: { componentId: "R1", pin: 0 } },
      { id: "W4", a: { componentId: "C1", pin: 1 }, b: { componentId: "R2", pin: 0 } },
    ],
  };
  const result = simulateTransient(circuit, { start: 0, end: "10u", step: "10u" });
  const positive = voltage(result, 0, "C1", 0);
  const negative = voltage(result, 0, "C1", 1);
  assert.ok(Math.abs(positive - 1) < 1e-12, `positive=${positive}`);
  assert.ok(Math.abs(negative + 1) < 1e-12, `negative=${negative}`);
  assert.ok(Math.abs(positive - negative - 2) < 1e-12);
});

test("시간응답 t=0은 인덕터 초기 전류를 만족한다", () => {
  const circuit = {
    version: 1,
    components: [
      { id: "R1", type: "R", props: { ref: "R1", value: "1k" } },
      { id: "L1", type: "L", props: { ref: "L1", value: "1mH", ic: "2mA" } },
      { id: "G1", type: "GND", props: { ref: "GND" } },
    ],
    wires: [
      { id: "W1", a: { componentId: "R1", pin: 0 }, b: { componentId: "L1", pin: 0 } },
      { id: "W2", a: { componentId: "R1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      { id: "W3", a: { componentId: "L1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    ],
  };
  const result = simulateTransient(circuit, { start: 0, end: "1u", step: "1u" });
  assert.ok(Math.abs(voltage(result, 0, "L1", 0) + 2) < 1e-12);
  assert.ok(Math.abs(result.points[0].componentCurrents.L1 - 0.002) < 1e-15);
});

test("모순된 초기조건은 명시적인 오류로 중단한다", () => {
  const circuit = {
    version: 1,
    components: [
      { id: "V1", type: "V", props: { ref: "V1", mode: "DC", dc: "5" } },
      { id: "C1", type: "C", props: { ref: "C1", value: "1u", ic: "0" } },
      { id: "G1", type: "GND", props: { ref: "GND" } },
    ],
    wires: [
      { id: "W1", a: { componentId: "V1", pin: 0 }, b: { componentId: "C1", pin: 0 } },
      { id: "W2", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      { id: "W3", a: { componentId: "C1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    ],
  };
  assert.throws(
    () => simulateTransient(circuit, { start: 0, end: "10u", step: "10u" }),
    (error) => error instanceof CircuitError && error.code === "INITIAL_CONDITION_CONFLICT",
  );
});

test("RC AC: fc에서 -3.0103 dB와 -45도", () => {
  const { circuit } = cloneExample("rc-lowpass");
  const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
  const result = simulateAC(circuit, { startFrequency: fc, endFrequency: fc * 1.000001, pointsPerDecade: 10 });
  const node = nodeFor(result, "C1", 0);
  const value = result.points[0].nodeVoltages[node];
  const magnitudeDb = 20 * Math.log10(Math.hypot(value.re, value.im));
  const phase = (Math.atan2(value.im, value.re) * 180) / Math.PI;
  assert.ok(Math.abs(magnitudeDb + 3.0103) <= 0.15, `dB=${magnitudeDb}`);
  assert.ok(Math.abs(phase + 45) <= 1, `phase=${phase}`);
});

test("AC 절대 크기는 비단위 입력에서도 dBV와 전달 이득을 구분한다", () => {
  const { circuit } = cloneExample("rc-lowpass");
  circuit.components.find((component) => component.id === "V1").props.acMagnitude = "2V";
  const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
  const result = simulateAC(circuit, { startFrequency: fc, endFrequency: fc * 1.000001, pointsPerDecade: 10 });
  const value = result.points[0].nodeVoltages[nodeFor(result, "C1", 0)];
  const level = acMagnitudeLevel(value, "V");
  const transferDb = 20 * Math.log10(Math.hypot(value.re, value.im) / 2);
  assert.equal(level.unit, "dBV");
  assert.equal(acMagnitudeLevel({ re: 1, im: 0 }, "A").unit, "dBA");
  assert.ok(Math.abs(level.value - 3.0103) <= 0.0001, `level=${level.value}`);
  assert.ok(Math.abs(transferDb + 3.0103) <= 0.0001, `gain=${transferDb}`);
});

test("혼합 전압·전류 trace는 단위별 독립 축과 공통 전류 배율을 사용한다", () => {
  const currentScale = currentDisplayScale([[0, 0.005], [0, 0.000005]]);
  assert.deepEqual(currentScale, { scale: 1e3, unit: "mA" });
  assert.deepEqual(currentDisplayScale([[0.2]]), { scale: 1, unit: "A" });
  assert.deepEqual(currentDisplayScale([[0.00005]]), { scale: 1e6, unit: "µA" });
  const axes = displayAxes([
    { unit: "V", values: [0, 10] },
    { unit: "mA", values: [0, 5] },
    { unit: "mA", values: [0, 0.005] },
  ], [0, 1]);
  assert.deepEqual(axes.map((axis) => axis.unit), ["V", "mA"]);
  assert.equal(axes[0].items.length, 1);
  assert.equal(axes[1].items.length, 2);
  assert.notEqual(axes[0].minimum, axes[1].minimum);
  assert.deepEqual(displayAxes([{ unit: "dBV", values: [0] }, { unit: "dBA", values: [-60] }], [0]).map((axis) => axis.unit), ["dBV", "dBA"]);
  assert.deepEqual(displayAxes([{ unit: "°", values: [-45] }, { unit: "°", values: [-90] }], [0]).map((axis) => axis.unit), ["°"]);
});

test("혼합 프로브 검증 파일은 10 V·10 mA·10 µA를 계산한다", () => {
  const project = deserializeProject(readFileSync(new URL("./fixtures/mixed-probe-units.json", import.meta.url), "utf8"));
  const result = simulateDC(project.circuit);
  assert.equal(result.points[0].nodeVoltages[nodeFor(result, "V1", 0)], 10);
  assert.equal(result.points[0].componentCurrents.R1, 0.01);
  assert.equal(result.points[0].componentCurrents.R2, 0.00001);
  assert.deepEqual(currentDisplayScale([[result.points[0].componentCurrents.R1], [result.points[0].componentCurrents.R2]]), { scale: 1e3, unit: "mA" });
});

test("RL 계단: tau 전류가 해석해 대비 1% 이내", () => {
  const { circuit } = cloneExample("rl");
  const result = simulateTransient(circuit, { start: 0, end: "200u", step: "1u" });
  const index = nearestIndex(result.xValues, 0.0001);
  const actual = result.points[index].componentCurrents.L1;
  const expected = 0.01 * (1 - Math.exp(-1));
  assert.ok(Math.abs(actual - expected) / expected <= 0.01, `actual=${actual}, expected=${expected}`);
});

test("직렬 RLC: capacitor step response가 해석식 대비 최종값 1% 이내", () => {
  const { circuit } = cloneExample("rlc");
  const result = simulateTransient(circuit, { start: 0, end: "300u", step: "0.5u" });
  const time = 0.0001;
  const index = nearestIndex(result.xValues, time);
  const actual = voltage(result, index, "C1", 0);
  const alpha = 100 / (2 * 0.01);
  const omega0 = 1 / Math.sqrt(0.01 * 1e-6);
  const omegaD = Math.sqrt(omega0 ** 2 - alpha ** 2);
  const expected = 1 - Math.exp(-alpha * time) * (Math.cos(omegaD * time) + (alpha / omegaD) * Math.sin(omegaD * time));
  assert.ok(Math.abs(actual - expected) <= 0.01, `actual=${actual}, expected=${expected}`);
});

test("다이오드 반파 정류: 양의 peak와 음의 반주기 억제", () => {
  const { circuit } = cloneExample("diode");
  const result = simulateTransient(circuit, { start: 0, end: "20m", step: "50u" });
  const node = nodeFor(result, "R1", 0);
  const output = result.points.map((point) => point.nodeVoltages[node]);
  const positivePeak = Math.max(...output);
  const negativeHalf = result.points.filter((_, index) => result.xValues[index] >= 1 / 120 && result.xValues[index] <= 1 / 60).map((point) => Math.abs(point.nodeVoltages[node]));
  assert.ok(positivePeak > 4, `peak=${positivePeak}`);
  assert.ok(Math.max(...negativeHalf) < 0.001, `negative max=${Math.max(...negativeHalf)}`);
});

test("다이오드 표시 전류는 원 Shockley 식과 KCL을 만족한다", () => {
  const { circuit } = cloneExample("diode");
  const result = simulateTransient(circuit, { start: 0, end: "20m", step: "50u" });
  const anode = nodeFor(result, "D1", 0);
  const cathode = nodeFor(result, "D1", 1);
  let maximumModelResidual = 0;
  let maximumKclResidual = 0;
  for (const point of result.points) {
    const diodeVoltage = point.nodeVoltages[anode] - point.nodeVoltages[cathode];
    const modelCurrent = 1e-12 * Math.expm1(diodeVoltage / 0.02585);
    maximumModelResidual = Math.max(maximumModelResidual, Math.abs(point.componentCurrents.D1 - modelCurrent));
    maximumKclResidual = Math.max(maximumKclResidual, Math.abs(point.componentCurrents.D1 - point.componentCurrents.R1));
  }
  assert.ok(maximumModelResidual <= 1e-12, `model residual=${maximumModelResidual}`);
  assert.ok(maximumKclResidual <= 1e-9, `KCL residual=${maximumKclResidual}`);
});

test("0.8 V 밖에 고정된 다이오드 해는 모델 범위 오류다", () => {
  const circuit = {
    version: 1,
    components: [
      { id: "V1", type: "V", props: { ref: "V1", mode: "DC", dc: "1" } },
      { id: "D1", type: "D", props: { ref: "D1", is: "1e-12", n: "1" } },
      { id: "G1", type: "GND", props: { ref: "GND" } },
    ],
    wires: [
      { id: "W1", a: { componentId: "V1", pin: 0 }, b: { componentId: "D1", pin: 0 } },
      { id: "W2", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      { id: "W3", a: { componentId: "D1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    ],
  };
  assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "DIODE_MODEL_RANGE");
});

test("연산증폭기: 비반전 이득 10 결과가 0.2% 이내", () => {
  const { circuit } = cloneExample("opamp");
  const result = simulateDC(circuit);
  const output = voltage(result, 0, "U1", 2);
  assert.ok(Math.abs(output - 1) / 1 <= 0.002, `output=${output}`);
});

test("오류 회로는 정상 결과를 만들지 않는다", async (t) => {
  await t.test("접지 없음", () => {
    const circuit = { version: 1, components: [{ id: "R1", type: "R", props: { value: "1k", ref: "R1" } }], wires: [] };
    assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "NO_GROUND");
  });
  await t.test("떠 있는 부분 회로", () => {
    const circuit = { version: 1, components: [{ id: "G1", type: "GND", props: { ref: "GND" } }, { id: "R1", type: "R", props: { value: "1k", ref: "R1" } }], wires: [] };
    assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "FLOATING_NODE");
  });
  await t.test("잘못된 값", () => {
    const { circuit } = cloneExample("divider");
    circuit.components.find((item) => item.id === "R1").props.value = "banana";
    assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "INVALID_VALUE");
  });
  await t.test("같은 net의 비영 전압원", () => {
    const { circuit } = cloneExample("divider");
    circuit.wires.push({ id: "Wshort", a: { componentId: "V1", pin: 0 }, b: { componentId: "V1", pin: 1 } });
    assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "VOLTAGE_SOURCE_SHORT");
  });
  await t.test("singular 회로", () => {
    const circuit = {
      version: 1,
      components: [
        { id: "I1", type: "I", props: { mode: "DC", dc: "1m", ref: "I1" } },
        { id: "G1", type: "GND", props: { ref: "GND" } },
      ],
      wires: [{ id: "W1", a: { componentId: "I1", pin: 1 }, b: { componentId: "G1", pin: 0 } }],
    };
    assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "SINGULAR");
  });
});

test("JSON 저장·불러오기 round-trip", () => {
  const { circuit } = cloneExample("divider");
  const restored = deserializeCircuit(serializeCircuit(circuit));
  assert.deepEqual(restored, circuit);
});

test("프로젝트 저장 경로는 분석 설정 전체를 보존한다", () => {
  const { circuit } = cloneExample("rc-lowpass");
  const settings = {
    analysis: "ac",
    start: "125u",
    end: "9m",
    step: "7u",
    startFrequency: "37Hz",
    endFrequency: "73kHz",
    pointsPerDecade: "17",
  };
  const text = serializeProject({ title: "설정 보존", subtitle: "검증", circuit, settings, probes: [] });
  const restored = deserializeProject(text, { analysis: "dc" });
  assert.deepEqual(restored.settings, settings);
  assert.deepEqual(restored.circuit, circuit);
});

test("접지 없는 작성 중 회로도 JSON에서 다시 연다", () => {
  const circuit = { version: 1, components: [{ id: "R1", type: "R", props: { ref: "R1", value: "1k" } }], wires: [] };
  assert.deepEqual(deserializeCircuit(serializeCircuit(circuit)), circuit);
  assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "NO_GROUND");
});

test("JSON 값 검증은 해석 시점까지 유예한다", () => {
  const { circuit } = cloneExample("divider");
  circuit.components.find((component) => component.id === "R1").props.value = "banana";
  const restored = deserializeCircuit(serializeCircuit(circuit));
  assert.equal(restored.components.find((component) => component.id === "R1").props.value, "banana");
  assert.throws(() => simulateDC(restored), (error) => error instanceof CircuitError && error.code === "INVALID_VALUE");
});

test("JSON 구조 검증은 존재하지 않는 핀을 거부한다", () => {
  const malformed = {
    version: 1,
    components: [{ id: "R1", type: "R", props: { ref: "R1", value: "1k" } }],
    wires: [{ id: "W1", a: { componentId: "R1", pin: 0 }, b: { componentId: "NOPE", pin: 0 } }],
  };
  assert.throws(() => deserializeCircuit(JSON.stringify(malformed)), (error) => error instanceof CircuitError && error.code === "BAD_WIRE");
});

test("단일 주파수 AC는 지정값을 정확히 풀고 R·RC·RL·RLC 해석식과 일치한다", async (t) => {
  const cases = [
    { name: "R 동상", frequency: 731, parts: [{ id: "R1", type: "R", value: 330 }], impedance: { re: 330, im: 0 } },
    { name: "RC 전류 선행", frequency: 321, parts: [{ id: "R1", type: "R", value: 1000 }, { id: "C1", type: "C", value: 1e-6 }], impedance: { re: 1000, im: -1 / (2 * Math.PI * 321 * 1e-6) } },
    { name: "RL 전류 지상", frequency: 753, parts: [{ id: "R1", type: "R", value: 100 }, { id: "L1", type: "L", value: 0.01 }], impedance: { re: 100, im: 2 * Math.PI * 753 * 0.01 } },
    { name: "RLC 공진 아래", frequency: 500, parts: [{ id: "R1", type: "R", value: 100 }, { id: "L1", type: "L", value: 0.01 }, { id: "C1", type: "C", value: 1e-6 }], impedance: { re: 100, im: 2 * Math.PI * 500 * 0.01 - 1 / (2 * Math.PI * 500 * 1e-6) } },
    { name: "RLC 공진 위", frequency: 3000, parts: [{ id: "R1", type: "R", value: 100 }, { id: "L1", type: "L", value: 0.01 }, { id: "C1", type: "C", value: 1e-6 }], impedance: { re: 100, im: 2 * Math.PI * 3000 * 0.01 - 1 / (2 * Math.PI * 3000 * 1e-6) } },
  ];
  for (const entry of cases) await t.test(entry.name, () => {
    const source = phasorFromPolar(2.7, 37);
    const expected = complexDivide(source, entry.impedance);
    const circuit = seriesCircuit(entry.parts, { magnitude: 2.7, phase: 37 });
    const result = simulateACAtFrequency(circuit, entry.frequency);
    const actual = result.points[0].componentCurrents[entry.parts[0].id];
    assert.equal(result.frequency, entry.frequency);
    assert.equal(result.xValues[0], entry.frequency);
    assert.ok(complexRelativeError(actual, expected) <= 1e-6, `${entry.name}: actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)}`);
    const phaseError = Math.abs(wrapPhaseDifference(phasorPolar(actual).angleDegrees, phasorPolar(expected).angleDegrees));
    assert.ok(phaseError <= 0.01, `${entry.name}: phase error=${phaseError}`);
  });
});

test("RLC 공진 전후와 R/RC/RL 선행·지상 부호가 맞다", () => {
  const phase = (circuit, frequency, id) => phasorPolar(simulateACAtFrequency(circuit, frequency).points[0].componentCurrents[id]).angleDegrees;
  assert.ok(Math.abs(phase(seriesCircuit([{ id: "R1", type: "R", value: 100 }]), 1000, "R1")) <= 0.01);
  assert.ok(phase(seriesCircuit([{ id: "R1", type: "R", value: 1000 }, { id: "C1", type: "C", value: 1e-6 }]), 100, "R1") > 0);
  assert.ok(phase(seriesCircuit([{ id: "R1", type: "R", value: 100 }, { id: "L1", type: "L", value: 0.01 }]), 1000, "R1") < 0);
  const rlc = seriesCircuit([{ id: "R1", type: "R", value: 100 }, { id: "L1", type: "L", value: 0.01 }, { id: "C1", type: "C", value: 1e-6 }]);
  assert.ok(phase(rlc, 500, "R1") > 0);
  assert.ok(phase(rlc, 3000, "R1") < 0);
});

test("페이저 직교·극형, peak/RMS와 cos 시간 재구성이 일치한다", () => {
  const value = phasorFromPolar(3.5, 42);
  const polar = phasorPolar(value);
  assert.ok(Math.abs(polar.magnitude - 3.5) <= 1e-12);
  assert.ok(Math.abs(wrapPhaseDifference(polar.angleDegrees, 42)) <= 1e-12);
  assert.ok(Math.abs(peakToRms(polar.magnitude) - 3.5 / Math.sqrt(2)) <= 1e-12);
  const frequency = 123;
  const time = 0.00071;
  const expected = 3.5 * Math.cos(2 * Math.PI * frequency * time + 42 * Math.PI / 180);
  assert.ok(Math.abs(phasorTimeValue(value, frequency, time) - expected) <= 1e-12);
});

test("0 페이저 각도는 미정이며 무효 단일 주파수는 거부한다", () => {
  assert.equal(phasorPolar({ re: 0, im: 0 }).angleDegrees, null);
  const circuit = seriesCircuit([{ id: "R1", type: "R", value: 100 }]);
  for (const invalid of [0, -1, "banana", Number.POSITIVE_INFINITY]) {
    assert.throws(() => simulateACAtFrequency(circuit, invalid), (error) => error instanceof CircuitError && error.code === "INVALID_VALUE");
  }
});

test("R/L/C 이론 임피던스와 소자 양단 V/I가 일치한다", () => {
  const frequency = 777;
  for (const part of [
    { id: "R1", type: "R", value: 470 },
    { id: "L1", type: "L", value: 0.023 },
    { id: "C1", type: "C", value: 2.2e-6 },
  ]) {
    const circuit = seriesCircuit([part]);
    const result = simulateACAtFrequency(circuit, frequency);
    const node1 = result.topology.nodeIdByPin[`${part.id}:0`];
    const node2 = result.topology.nodeIdByPin[`${part.id}:1`];
    const first = result.points[0].nodeVoltages[node1];
    const second = result.points[0].nodeVoltages[node2];
    const voltageAcross = { re: first.re - second.re, im: first.im - second.im };
    const measured = divideComplex(voltageAcross, result.points[0].componentCurrents[part.id]);
    const theory = theoreticalImpedance(part.type, part.value, frequency);
    assert.ok(complexRelativeError(measured, theory) <= 1e-6, `${part.type}: ${JSON.stringify(measured)} vs ${JSON.stringify(theory)}`);
  }
});

test("페이저 평면은 물리량별 공통 배율을 사용한다", () => {
  assert.deepEqual(quantityDisplayScale([], "A"), { scale: 1, unit: "A" });
  assert.deepEqual(quantityDisplayScale([{ re: 0.01, im: 0 }, { re: 0.00001, im: 0 }], "A"), { scale: 1e3, unit: "mA" });
  assert.deepEqual(quantityDisplayScale([{ re: 5, im: 0 }, { re: 0.002, im: 0 }], "V"), { scale: 1, unit: "V" });
  assert.deepEqual(quantityDisplayScale([{ re: 0.00005, im: 0 }], "V"), { scale: 1e6, unit: "µV" });
});

test("페이저 숫자축은 물리량별 실제 범위와 같은 물리량의 상대 크기를 보존한다", () => {
  const voltage = phasorAxis([{ re: 1.2, im: 0 }, { re: 0.12, im: 0 }], "V");
  assert.deepEqual(voltage, { scale: 1, unit: "V", minimum: -2, maximum: 2, ticks: [2, 1, 0, -1, -2] });
  assert.equal((1.2 * voltage.scale / voltage.maximum) / (0.12 * voltage.scale / voltage.maximum), 10);
  const current = phasorAxis([{ re: 0.01, im: 0 }, { re: 0.00001, im: 0 }], "A");
  assert.deepEqual(current, { scale: 1e3, unit: "mA", minimum: -10, maximum: 10, ticks: [10, 5, 0, -5, -10] });
  assert.notEqual(voltage.maximum, current.maximum);
  assert.deepEqual(phasorAxis([{ re: 0, im: 0 }], "V"), { scale: 1, unit: "V", minimum: -1, maximum: 1, ticks: [1, .5, 0, -.5, -1] });
});

test("CSV는 쉼표·따옴표·줄바꿈을 escape하고 실제 parser로 같은 열을 복원한다", () => {
  const edgeRows = [["label", "value"], ["I(R1, 1→2)", 0.01], ['quote "inside"', "line1\nline2"]];
  assert.deepEqual(parseCSV(stringifyCSV(edgeRows)), edgeRows.map((row) => row.map(String)));
  const result = { analysis: "dc", xValues: [0] };
  const series = [
    { probe: { kind: "voltage", label: "V(out)" }, raw: [10], values: [10], unit: "V" },
    { probe: { kind: "current", label: "I(R1, 1→2)" }, raw: [0.01], values: [10], unit: "mA" },
    { probe: { kind: "current", label: "I(R2, 1→2)" }, raw: [0.00001], values: [0.01], unit: "mA" },
  ];
  const parsed = parseCSV(buildResultsCSV(result, series));
  assert.equal(parsed[0].length, 4);
  assert.equal(parsed[1].length, 4);
  assert.deepEqual(parsed[0], ["operating_point", "V(out)_V", "I(R1, 1→2)_A", "I(R2, 1→2)_A"]);
  assert.deepEqual(parsed[1].map(Number), [0, 10, 0.01, 0.00001]);
});

test("프로젝트는 단일 페이저 주파수와 probe 색을 저장·복원한다", () => {
  const { circuit } = cloneExample("rc-lowpass");
  const settings = { analysis: "ac", startFrequency: "10", endFrequency: "100k", pointsPerDecade: "30", phasorFrequency: "159.155Hz" };
  const probes = [{ key: "V:C1:0", kind: "voltage", componentId: "C1", pin: 0, label: "V(C1.1)", color: "#52e0b7" }];
  const restored = deserializeProject(serializeProject({ title: "phasor", subtitle: "round-trip", circuit, settings, probes }));
  assert.deepEqual(restored.settings, settings);
  assert.deepEqual(restored.probes, probes);
});

test("junction version 1 확장은 구버전을 보존하고 새 형식을 round-trip한다", () => {
  const legacy = { version: 1, components: [{ id: "G1", type: "GND", props: { ref: "GND" } }], wires: [] };
  assert.deepEqual(deserializeCircuit(serializeCircuit(legacy)), legacy);
  const extended = { ...legacy, junctions: [{ id: "J1", x: 120, y: 80 }] };
  assert.deepEqual(deserializeCircuit(serializeCircuit(extended)), extended);
});

test("junction endpoint는 혼합·dangling 참조를 거부하고 pin namespace와 충돌하지 않는다", () => {
  const base = {
    version: 1,
    components: [
      { id: "junction", type: "GND", props: { ref: "GND" } },
      { id: "R1", type: "R", props: { ref: "R1", value: "1k" } },
    ],
    junctions: [{ id: "0", x: 100, y: 100 }],
    wires: [
      { id: "W1", a: { junctionId: "0" }, b: { componentId: "R1", pin: 0 } },
      { id: "W2", a: { componentId: "R1", pin: 1 }, b: { componentId: "junction", pin: 0 } },
    ],
  };
  const topology = buildTopology(base);
  assert.equal(topology.nodeIdByJunction["0"], topology.nodeIdByPin["R1:0"]);
  assert.notEqual(topology.nodeIdByJunction["0"], 0);
  for (const endpoint of [
    { junctionId: "0", componentId: "missing" },
    { junctionId: "missing" },
    { componentId: "R1" },
  ]) {
    const malformed = structuredClone(base);
    malformed.wires[0].a = endpoint;
    assert.throws(() => deserializeCircuit(JSON.stringify(malformed)), (error) => error instanceof CircuitError && error.code === "BAD_WIRE");
  }
});

test("교차는 비접속이고 명시 junction만 net을 연결한다", () => {
  const { circuit } = cloneExample("divider");
  circuit.junctions = [{ id: "J1", x: 360, y: 225 }];
  const middleWire = circuit.wires.find((wire) => wire.id === "W2");
  middleWire.b = { junctionId: "J1" };
  circuit.wires.push({ id: "WJ", a: { junctionId: "J1" }, b: { componentId: "R2", pin: 0 } });
  const topology = buildTopology(circuit);
  assert.equal(topology.nodeIdByJunction.J1, topology.nodeIdByPin["R1:1"]);
  assert.equal(topology.nodeIdByJunction.J1, topology.nodeIdByPin["R2:0"]);
  const crossedOnly = structuredClone(circuit);
  crossedOnly.wires = crossedOnly.wires.filter((wire) => wire.id !== "WJ");
  const crossedTopology = buildTopology(crossedOnly);
  assert.notEqual(crossedTopology.nodeIdByJunction.J1, crossedTopology.nodeIdByPin["R2:0"]);
});

test("wire split junction은 원본을 보존하고 삭제는 incident wire만 끊는다", () => {
  const { circuit: original } = cloneExample("divider");
  const before = structuredClone(original);
  const split = splitWireAtJunction(original, "W2", { x: 360, y: 225 });
  assert.deepEqual(original, before);
  assert.equal(split.circuit.junctions.length, 1);
  assert.equal(split.circuit.wires.length, original.wires.length + 1);
  const probes = [{ key: "V:wire", kind: "voltage", wireId: split.splitWireIds[0] }, { key: "I:R1", kind: "current", componentId: "R1" }];
  const deleted = deleteJunctionFromCircuit(split.circuit, split.junction.id, probes);
  assert.equal(deleted.circuit.junctions.length, 0);
  assert.equal(deleted.circuit.wires.length, original.wires.length - 1);
  assert.deepEqual(deleted.probes.map((probe) => probe.key), ["I:R1"]);
  assert.ok(deleted.circuit.wires.some((wire) => wire.id === "W1"));
});

test("junction 이동·직렬화 후 net과 분압 수치는 유지된다", () => {
  const { circuit } = cloneExample("divider");
  const split = splitWireAtJunction(circuit, "W2", { x: 360, y: 225 });
  split.circuit.junctions[0].x += 120;
  split.circuit.junctions[0].y -= 70;
  const restored = deserializeCircuit(serializeCircuit(split.circuit));
  const result = simulateDC(restored);
  assert.equal(result.topology.nodeIdByJunction[split.junction.id], result.topology.nodeIdByPin["R2:0"]);
  assert.ok(Math.abs(voltage(result, 0, "R2", 0) - 5) <= 1e-12);
  assert.ok(Math.abs(result.points[0].componentCurrents.R1 - .005) <= 1e-12);
});

test("복제는 props와 회전을 복사하되 ID와 배선을 공유하지 않는다", () => {
  const { circuit } = cloneExample("divider");
  const clone = cloneSelectedComponent(circuit, "R1");
  assert.equal(clone.id, "R3");
  assert.deepEqual(clone.props, circuit.components.find((component) => component.id === "R1").props);
  assert.equal(clone.rotation, 90);
  clone.props.value = "9k";
  assert.equal(circuit.components.find((component) => component.id === "R1").props.value, "1k");
  assert.ok(circuit.wires.every((wire) => wire.a.componentId !== clone.id && wire.b.componentId !== clone.id));
});

test("학습 입력 상태와 generation latest-wins 판정을 구분한다", () => {
  for (const value of ["", "-", "1e", "1e-"]) assert.equal(classifyNumericInput(value, { positive: true }).status, "editing");
  for (const value of ["banana", "0", "-2"]) assert.equal(classifyNumericInput(value, { positive: true }).status, "invalid");
  assert.deepEqual(classifyNumericInput("2.2u", { positive: true }), { status: "valid", value: 2.2e-6 });
  assert.equal(acceptsRunGeneration(8, 8), true);
  assert.equal(acceptsRunGeneration(8, 9), false);
});

test("프로젝트 프로브는 존재하는 pin 또는 junction만 참조한다", () => {
  const { circuit } = cloneExample("divider");
  circuit.junctions = [{ id: "J1", x: 360, y: 230 }];
  const valid = { key: "V:J:J1", kind: "voltage", junctionId: "J1", label: "V(J1)", color: "#52e0b7" };
  assert.deepEqual(deserializeProject(serializeProject({ circuit, settings: {}, probes: [valid] })).probes, [valid]);
  for (const probe of [
    { ...valid, junctionId: "missing" },
    { ...valid, componentId: "R1", pin: 0 },
    { ...valid, junctionId: undefined, componentId: "R1", pin: 9 },
    { ...valid, junctionId: undefined, kind: "current", componentId: "missing" },
    { ...valid, wireId: "missing" },
  ]) {
    assert.throws(
      () => deserializeProject(serializeProject({ circuit, settings: {}, probes: [probe] })),
      (error) => error instanceof CircuitError && error.code === "INVALID_FILE",
    );
  }
});

test("20-unit 표시 격자와 새 geometry의 모든 단자가 같은 좌표 계약을 쓴다", () => {
  assert.deepEqual(snapPoint({ x: 31, y: -29 }), { x: 40, y: -20 });
  assert.deepEqual(localPin("GND", 0, 1), { x: 0, y: -28 });
  assert.deepEqual(localPin("OPAMP", 1, 1), { x: -45, y: 18 });
  for (const type of ["R", "C", "L", "V", "I", "D", "GND", "OPAMP"]) {
    const count = type === "GND" ? 1 : type === "OPAMP" ? 3 : 2;
    for (const rotation of [0, 90, 180, 270]) {
      for (let pin = 0; pin < count; pin += 1) {
        const position = pinPosition({ type, x: 100, y: 140, rotation }, pin, 2);
        assert.ok(Math.abs(position.x / 20 - Math.round(position.x / 20)) <= 1e-9, `${type}/${rotation}/${pin} x`);
        assert.ok(Math.abs(position.y / 20 - Math.round(position.y / 20)) <= 1e-9, `${type}/${rotation}/${pin} y`);
      }
    }
  }
});

test("고정 waypoint는 클릭한 점을 지나고 endpoint 이동 때 내부점이 보존된다", () => {
  const start = { x: 0, y: 0 };
  let fixed = appendFixedWaypoint(start, [], { x: 40, y: 40 });
  fixed = appendFixedWaypoint(start, fixed, { x: 80, y: 60 });
  assert.deepEqual(fixed, [{ x: 40, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 60 }]);
  const wire = { waypoints: fixed };
  assert.deepEqual(routeWirePoints(wire, start, { x: 120, y: 100 }, 2), [
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 40 },
    { x: 80, y: 60 }, { x: 120, y: 60 }, { x: 120, y: 100 },
  ]);
  const moved = routeWirePoints(wire, { x: 0, y: 20 }, { x: 140, y: 100 }, 2);
  assert.deepEqual(moved.slice(2, 6), fixed);
  assert.deepEqual(routeWirePoints({ waypoints: [] }, { x: 160, y: 200 }, { x: 360, y: 120 }, 2), [
    { x: 160, y: 200 }, { x: 260, y: 200 }, { x: 260, y: 120 }, { x: 360, y: 120 },
  ]);
});

test("split은 실제 segment에 투영하고 경로·topology·wire probe를 보존한다", () => {
  const circuit = {
    version: 1,
    geometryVersion: 2,
    components: [
      { id: "R1", type: "R", x: -40, y: 0, rotation: 0, props: { ref: "R1", value: "1k" } },
      { id: "R2", type: "R", x: 140, y: 80, rotation: 0, props: { ref: "R2", value: "1k" } },
      { id: "G1", type: "GND", x: 180, y: 160, rotation: 0, props: { ref: "GND" } },
    ],
    wires: [
      { id: "W0", a: { componentId: "R1", pin: 1 }, b: { componentId: "R2", pin: 0 }, waypoints: [{ x: 40, y: 0 }, { x: 40, y: 80 }] },
      { id: "WG", a: { componentId: "R2", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    ],
    junctions: [],
  };
  const route = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 100, y: 80 }];
  const split = splitWireAtJunction(circuit, "W0", { x: 43, y: 37 }, route);
  assert.deepEqual(split.junction, { id: "J1", x: 40, y: 40 });
  assert.deepEqual(split.circuit.wires[0].waypoints, [{ x: 40, y: 0 }]);
  assert.deepEqual(split.circuit.wires[1].waypoints, [{ x: 40, y: 80 }]);
  assert.equal(buildTopology(split.circuit).nodeIdByJunction.J1, buildTopology(split.circuit).nodeIdByPin["R1:1"]);
  const probes = retargetWireProbes([{ key: "p", wireId: "W0" }, { key: "q", wireId: "other" }], "W0", split.replacementWireId);
  assert.deepEqual(probes.map((probe) => probe.wireId), [split.replacementWireId, "other"]);
  assert.deepEqual(projectSplitPoint([{ x: 0, y: 15 }, { x: 100, y: 15 }], { x: 43, y: 31 }, 1).point, { x: 40, y: 15 });
});

test("geometryVersion과 waypoint JSON은 round-trip하고 malformed 좌표는 거부한다", () => {
  const { circuit } = cloneExample("divider");
  circuit.wires[0].waypoints = [{ x: 220, y: 120 }, { x: 280, y: 120 }];
  assert.deepEqual(deserializeCircuit(serializeCircuit(circuit)), circuit);
  for (const waypoints of ["bad", [{ x: Number.NaN, y: 20 }], [{ x: 20 }]]) {
    const malformed = structuredClone(circuit);
    malformed.wires[0].waypoints = waypoints;
    assert.throws(() => deserializeCircuit(JSON.stringify(malformed)), (error) => error instanceof CircuitError && error.code === "BAD_WIRE");
  }
  const malformed = structuredClone(circuit);
  malformed.geometryVersion = 3;
  assert.throws(() => deserializeCircuit(JSON.stringify(malformed)), (error) => error instanceof CircuitError && error.code === "INVALID_FILE");
});

test("DC plot model은 한 operating point를 상수 level과 부호 있는 실제 값으로 표현한다", () => {
  const series = [
    { probe: { label: "V(in)", color: "#1" }, unit: "V", values: [10] },
    { probe: { label: "V(out)", color: "#2" }, unit: "V", values: [5] },
    { probe: { label: "V(gnd)", color: "#3" }, unit: "V", values: [0] },
    { probe: { label: "I(V1)", color: "#4" }, unit: "mA", values: [-5] },
  ];
  const model = dcOperatingPointModel(series);
  assert.equal(model.xLabel, "DC operating point · 시간축 없음");
  assert.deepEqual(model.axes.map((axis) => axis.unit), ["V", "mA"]);
  assert.deepEqual(model.levels.map(({ label, value, unit }) => ({ label, value, unit })), [
    { label: "V(in)", value: 10, unit: "V" }, { label: "V(out)", value: 5, unit: "V" },
    { label: "V(gnd)", value: 0, unit: "V" }, { label: "I(V1)", value: -5, unit: "mA" },
  ]);
});

test("transient의 DC 전원은 10 V 상수지만 RC 상태는 다표본으로 변한다", () => {
  const circuit = {
    version: 1,
    components: [
      { id: "V1", type: "V", props: { ref: "V1", mode: "DC", dc: "10" } },
      { id: "R1", type: "R", props: { ref: "R1", value: "1k" } },
      { id: "C1", type: "C", props: { ref: "C1", value: "1u", ic: "0" } },
      { id: "G1", type: "GND", props: { ref: "GND" } },
    ],
    wires: [
      { id: "W1", a: { componentId: "V1", pin: 0 }, b: { componentId: "R1", pin: 0 } },
      { id: "W2", a: { componentId: "R1", pin: 1 }, b: { componentId: "C1", pin: 0 } },
      { id: "W3", a: { componentId: "C1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      { id: "W4", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    ],
  };
  const result = simulateTransient(circuit, { start: 0, end: "5m", step: "100u" });
  assert.ok(result.xValues.length > 2);
  for (let index = 0; index < result.xValues.length; index += 1) assert.ok(Math.abs(voltage(result, index, "V1", 0) - 10) <= 1e-9);
  assert.ok(Math.abs(voltage(result, 0, "C1", 0)) <= 1e-9);
  assert.ok(voltage(result, result.xValues.length - 1, "C1", 0) > 9.8);
});

function manualRcCircuit(sourceProps = {}) {
  return {
    version: 1,
    geometryVersion: 2,
    components: [
      { id: "source-x", type: "V", props: { ref: "VSRC", mode: "DC", dc: "10", amplitude: "2", frequency: "1k", offset: "0", phase: "0", pulseV1: "-1", pulseV2: "3", pulseDelay: "0", pulseRise: "0", pulseFall: "0", pulseWidth: "250u", pulsePeriod: "1m", acMagnitude: "1", acPhase: "0", ...sourceProps } },
      { id: "resistor-x", type: "R", props: { ref: "LOAD", value: "1k" } },
      { id: "capacitor-x", type: "C", props: { ref: "STORE", value: "1u", ic: "0" } },
      { id: "ground-x", type: "GND", props: { ref: "GND" } },
    ],
    wires: [
      { id: "input", a: { componentId: "source-x", pin: 0 }, b: { componentId: "resistor-x", pin: 0 } },
      { id: "output", a: { componentId: "resistor-x", pin: 1 }, b: { componentId: "capacitor-x", pin: 0 } },
      { id: "return-c", a: { componentId: "capacitor-x", pin: 1 }, b: { componentId: "ground-x", pin: 0 } },
      { id: "return-v", a: { componentId: "source-x", pin: 1 }, b: { componentId: "ground-x", pin: 0 } },
    ],
    junctions: [],
  };
}

test("연결 상태는 미배선·무접지·분석 floating·정상 RC를 구별한다", () => {
  const loose = { version: 1, components: [{ id: "loose", type: "R", props: { ref: "R9", value: "1k" } }], wires: [] };
  assert.equal(classifyCircuitConnections(loose).byComponent.loose.status, "unwired");

  const noGround = {
    version: 1,
    components: [
      { id: "v", type: "V", props: { ref: "Vx", mode: "DC", dc: "1" } },
      { id: "r", type: "R", props: { ref: "Rx", value: "1k" } },
    ],
    wires: [
      { id: "a", a: { componentId: "v", pin: 0 }, b: { componentId: "r", pin: 0 } },
      { id: "b", a: { componentId: "v", pin: 1 }, b: { componentId: "r", pin: 1 } },
    ],
  };
  assert.equal(classifyCircuitConnections(noGround).byComponent.r.status, "no-ground");

  const capacitorOnlyReference = {
    version: 1,
    components: [
      { id: "c", type: "C", props: { ref: "Cx", value: "1u", ic: "0" } },
      { id: "g", type: "GND", props: { ref: "GND" } },
    ],
    junctions: [{ id: "j", x: 0, y: 0 }],
    wires: [
      { id: "top", a: { componentId: "c", pin: 0 }, b: { junctionId: "j" } },
      { id: "bottom", a: { componentId: "c", pin: 1 }, b: { componentId: "g", pin: 0 } },
    ],
  };
  assert.equal(classifyCircuitConnections(capacitorOnlyReference, "dc").byComponent.c.status, "analysis-floating");
  assert.equal(classifyCircuitConnections(capacitorOnlyReference, "transient").byComponent.c.status, "referenced");
  assert.equal(classifyCircuitConnections(capacitorOnlyReference, "ac", { frequency: 1000 }).byComponent.c.status, "referenced");

  for (const analysis of ["dc", "transient", "ac"]) {
    const status = classifyCircuitConnections(manualRcCircuit(), analysis, { frequency: 159.154943 }).byComponent;
    assert.ok(Object.values(status).every((item) => item.status === "referenced"), `${analysis}: ${JSON.stringify(status)}`);
  }
});

test("source inline 의미는 분석·파형별 필드와 엔진 fallback을 따른다", () => {
  const voltage = { type: "V", props: { mode: "SIN", dc: "7", amplitude: "2", pulseV2: "3", acMagnitude: "4" } };
  assert.deepEqual(sourceInlineDescriptor(voltage, "dc"), { prop: "dc", label: "DC bias", unit: "V", value: "7" });
  assert.deepEqual(sourceInlineDescriptor(voltage, "transient"), { prop: "amplitude", label: "SIN peak", unit: "Vpk", value: "2" });
  voltage.props.mode = "PULSE";
  assert.equal(sourceInlineDescriptor(voltage, "transient").prop, "pulseV2");
  assert.deepEqual(sourceInlineDescriptor(voltage, "ac"), { prop: "acMagnitude", label: "AC peak", unit: "Vpk", value: "4" });
  assert.deepEqual(sourceInlineDescriptor({ type: "I", props: { mode: "SIN" } }, "transient"), { prop: "amplitude", label: "SIN peak", unit: "Apk", value: "0" });
  assert.equal(sourceInlineDescriptor({ type: "V", props: { mode: "PULSE" } }, "transient").value, "0");
  assert.equal(sourceInlineDescriptor({ type: "V", props: {} }, "ac").value, "0");
});

test("직접 만든 R/C/L slider는 예제 ID 없이 제공되고 범위 밖 값을 보존 표시한다", () => {
  for (const [type, value] of [["R", "1k"], ["C", "1u"], ["L", "10m"]]) {
    const slider = passiveSliderModel(type, value);
    assert.ok(slider);
    assert.equal(slider.outside, false);
    assert.ok(Number.isFinite(slider.value));
  }
  const outside = passiveSliderModel("R", "100G");
  assert.equal(outside.outside, true);
  assert.equal(outside.value, outside.max);
  assert.equal(parseValue("100G"), 100e9);
  assert.equal(passiveSliderModel("V", "5"), null);
});

test("우클릭 대상은 정확한 probe key 하나만 선택·삭제한다", () => {
  const probes = [
    { key: "V:R1:0", kind: "voltage", componentId: "R1", pin: 0, wireId: "W1" },
    { key: "V:J:J1", kind: "voltage", junctionId: "J1", wireId: "W1" },
    { key: "I:R1", kind: "current", componentId: "R1" },
  ];
  assert.deepEqual(probeKeysForTarget(probes, { kind: "pin", componentId: "R1", pin: 0 }), ["V:R1:0"]);
  assert.deepEqual(probeKeysForTarget(probes, { kind: "wire", wireId: "W1" }), ["V:R1:0", "V:J:J1"]);
  assert.deepEqual(probeKeysForTarget(probes, { kind: "component", componentId: "R1" }), ["I:R1"]);
  const remaining = removeProbeByKey(probes, "V:R1:0");
  assert.deepEqual(remaining.map((probe) => probe.key), ["V:J:J1", "I:R1"]);
  assert.equal(probes.length, 3);
  assert.equal(nextAvailableProbeColor(["green", "blue", "orange"], [{ color: "blue" }]), "green");
  assert.equal(nextAvailableProbeColor(["green", "blue"], [{ color: "green" }, { color: "blue" }]), "green");
});

test("직접 만든 RC의 DC·transient·AC 수치가 계약과 예제에 일치한다", () => {
  const circuit = manualRcCircuit();
  const dc = simulateDC(circuit);
  assert.ok(Math.abs(voltage(dc, 0, "capacitor-x", 0) - 10) < 1e-12);
  assert.ok(Math.abs(dc.points[0].componentCurrents["resistor-x"]) < 1e-12);
  assert.ok(Math.abs(dc.points[0].componentCurrents["capacitor-x"]) < 1e-12);

  const transient = simulateTransient(circuit, { start: 0, end: "5m", step: "10u" });
  const expected = 10 * (1 - Math.exp(-5));
  const final = voltage(transient, transient.points.length - 1, "capacitor-x", 0);
  assert.equal(voltage(transient, 0, "source-x", 0), 10);
  assert.ok(Math.abs(final - expected) / 10 <= 0.01, `final=${final}, expected=${expected}`);
  assert.ok(transient.points[0].componentCurrents["resistor-x"] > transient.points.at(-1).componentCurrents["resistor-x"]);

  const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
  const ac = simulateACAtFrequency(circuit, fc);
  const output = ac.points[0].nodeVoltages[nodeFor(ac, "capacitor-x", 0)];
  const polar = phasorPolar(output);
  assert.ok(Math.abs(polar.magnitude - Math.SQRT1_2) < 1e-9, `magnitude=${polar.magnitude}`);
  assert.ok(Math.abs(polar.angleDegrees + 45) < 1e-9, `phase=${polar.angleDegrees}`);
  assert.ok(ac.points[0].componentCurrents["resistor-x"].im > 0, "1→2 resistor current must lead source in RC");

  const example = cloneExample("rc-lowpass").circuit;
  const exampleAc = simulateACAtFrequency(example, fc);
  const exampleOutput = exampleAc.points[0].nodeVoltages[nodeFor(exampleAc, "C1", 0)];
  assert.ok(complexRelativeError(output, exampleOutput) < 1e-12);
});

test("SIN 시간표본과 AC 자극은 독립이며 source 필드가 보존된다", () => {
  const circuit = manualRcCircuit({ mode: "SIN", dc: "7", amplitude: "2", frequency: "1k", offset: "0", phase: "0", acMagnitude: "0.5", acPhase: "30" });
  const transient = simulateTransient(circuit, { start: 0, end: "750u", step: "250u" });
  for (const [time, expected] of [[0, 0], [0.00025, 2], [0.00075, -2]]) {
    const index = nearestIndex(transient.xValues, time);
    assert.ok(Math.abs(voltage(transient, index, "source-x", 0) - expected) <= 1e-9);
  }
  const ac = simulateACAtFrequency(circuit, 1000);
  const input = ac.points[0].nodeVoltages[nodeFor(ac, "source-x", 0)];
  assert.ok(Math.abs(phasorPolar(input).magnitude - 0.5) < 1e-12);
  assert.ok(Math.abs(phasorPolar(input).angleDegrees - 30) < 1e-12);
  const restored = deserializeProject(serializeProject({ circuit, settings: { analysis: "ac" }, probes: [] })).circuit.components.find((component) => component.id === "source-x").props;
  for (const key of ["dc", "amplitude", "frequency", "offset", "phase", "pulseV1", "pulseV2", "acMagnitude", "acPhase"]) assert.equal(restored[key], circuit.components[0].props[key]);
});

function parallelIdealCircuit({ source = {}, capacitor = null, inductor = null, duplicateSource = null, reverseSource = false } = {}) {
  const components = [
    { id: "source-x", type: "V", props: { ref: "VSUP", mode: "DC", dc: "5", ...source } },
    { id: "load-x", type: "R", props: { ref: "RLOAD", value: "1k" } },
    ...(inductor ? [{ id: "coil-x", type: "L", props: { ref: "LFAST", value: "10m", ic: "0", ...inductor } }] : []),
    ...(capacitor ? [{ id: "store-x", type: "C", props: { ref: "CSTORE", value: "1u", ic: "0", ...capacitor } }] : []),
    ...(duplicateSource ? [{ id: "source-y", type: "V", props: { ref: "VAUX", mode: "DC", dc: "5", ...duplicateSource } }] : []),
    { id: "ground-x", type: "GND", props: { ref: "GND" } },
  ];
  const wires = [];
  const addBranch = (id, index, reverse = false) => {
    wires.push({ id: `top-${index}`, a: { componentId: id, pin: reverse ? 1 : 0 }, b: { componentId: "load-x", pin: 0 } });
    wires.push({ id: `bottom-${index}`, a: { componentId: id, pin: reverse ? 0 : 1 }, b: { componentId: "ground-x", pin: 0 } });
  };
  addBranch("source-x", 0, reverseSource);
  wires.push({ id: "load-return", a: { componentId: "load-x", pin: 1 }, b: { componentId: "ground-x", pin: 0 } });
  if (inductor) addBranch("coil-x", 1);
  if (capacitor) addBranch("store-x", 2);
  if (duplicateSource) addBranch("source-y", 3);
  return { version: 1, components, wires };
}

test("이름이 바뀐 병렬 V/L의 DC 모순은 두 제약과 값을 구체적으로 반환한다", () => {
  const circuit = parallelIdealCircuit({ inductor: {} });
  const diagnostic = analyzeIdealVoltageConstraints(circuit, { analysis: "dc" });
  assert.equal(diagnostic.conflicts.length, 1);
  assert.throws(() => simulateDC(circuit), (error) => {
    assert.equal(error.code, "IDEAL_CONSTRAINT_CONFLICT");
    assert.equal(error.details.certainty, "confirmed");
    assert.deepEqual(error.details.constraints.map(({ componentId, ref, value }) => ({ componentId, ref, value })), [
      { componentId: "source-x", ref: "VSUP", value: 5 },
      { componentId: "coil-x", ref: "LFAST", value: 0 },
    ]);
    assert.deepEqual(error.details.constraints.map((item) => item.input), ["DC=5", "DC short=0 V"]);
    assert.match(error.hint, /IC.*시간 간격.*DC 모순/);
    return true;
  });
});

test("transient V/C는 IC0 충돌, IC5 성립, 비0 시작·역방향 source 성립을 구별한다", () => {
  const conflict = parallelIdealCircuit({ capacitor: { ic: "0" } });
  assert.throws(() => simulateTransient(conflict, { start: 0, end: "10u", step: "10u" }), (error) => {
    assert.equal(error.code, "INITIAL_CONDITION_CONFLICT");
    assert.deepEqual(error.details.constraints.map((item) => [item.ref, item.value]), [["VSUP", 5], ["CSTORE", 0]]);
    assert.deepEqual(error.details.constraints.map((item) => item.input), ["DC=5", "IC=0"]);
    return true;
  });

  const matching = parallelIdealCircuit({ capacitor: { ic: "5" } });
  const matched = simulateTransient(matching, { start: 0, end: "10u", step: "10u" });
  assert.equal(voltage(matched, 0, "store-x", 0), 5);
  assert.equal(matched.points[0].componentCurrents["store-x"], 0);

  const reversed = parallelIdealCircuit({
    reverseSource: true,
    source: { mode: "SIN", amplitude: "-5", frequency: "1k", offset: "0", phase: "0" },
    capacitor: { ic: "5" },
  });
  const atQuarterCycle = simulateTransient(reversed, { start: "250u", end: "260u", step: "10u" });
  assert.ok(Math.abs(voltage(atQuarterCycle, 0, "store-x", 0) - 5) < 1e-12);
});

test("동일·상이한 병렬 이상 전압원과 지원 밖 singular를 서로 다른 code로 보존한다", () => {
  const same = parallelIdealCircuit({ duplicateSource: { dc: "5" } });
  assert.throws(() => simulateDC(same), (error) => error.code === "IDEAL_CONSTRAINT_REDUNDANCY" && error.details.constraints.some((item) => item.ref === "VAUX"));
  assert.throws(() => simulateTransient(same, { start: 0, end: "1u", step: "1u" }), (error) => error.code === "IDEAL_CONSTRAINT_REDUNDANCY");

  const different = parallelIdealCircuit({ duplicateSource: { dc: "4" } });
  assert.throws(() => simulateDC(different), (error) => error.code === "IDEAL_CONSTRAINT_CONFLICT" && error.details.actual === 4);

  const unsupported = {
    version: 1,
    components: [{ id: "current-x", type: "I", props: { ref: "IWEIRD", mode: "DC", dc: "1m" } }, { id: "ground-x", type: "GND", props: { ref: "GND" } }],
    wires: [{ id: "return", a: { componentId: "current-x", pin: 1 }, b: { componentId: "ground-x", pin: 0 } }],
  };
  assert.throws(() => simulateDC(unsupported), (error) => error.code === "SINGULAR" && error.details === null);
});

test("transient 초기 solve는 다이오드 범위·invalid·floating 오류를 IC 충돌로 과분류하지 않는다", () => {
  const diode = {
    version: 1,
    components: [
      { id: "v", type: "V", props: { ref: "VHI", mode: "DC", dc: "1" } },
      { id: "d", type: "D", props: { ref: "DHI", is: "1e-12", n: "1" } },
      { id: "g", type: "GND", props: { ref: "GND" } },
    ],
    wires: [
      { id: "a", a: { componentId: "v", pin: 0 }, b: { componentId: "d", pin: 0 } },
      { id: "b", a: { componentId: "v", pin: 1 }, b: { componentId: "g", pin: 0 } },
      { id: "c", a: { componentId: "d", pin: 1 }, b: { componentId: "g", pin: 0 } },
    ],
  };
  assert.throws(() => simulateTransient(diode, { start: 0, end: "1u", step: "1u" }), (error) => error.code === "DIODE_MODEL_RANGE");
  const invalid = manualRcCircuit();
  invalid.components.find((item) => item.id === "resistor-x").props.value = "bad";
  assert.throws(() => simulateTransient(invalid, { start: 0, end: "1u", step: "1u" }), (error) => error.code === "INVALID_VALUE");
  const floating = { version: 1, components: [{ id: "g", type: "GND", props: { ref: "GND" } }, { id: "r", type: "R", props: { ref: "R", value: "1k" } }], wires: [] };
  assert.throws(() => simulateTransient(floating, { start: 0, end: "1u", step: "1u" }), (error) => error.code === "FLOATING_NODE");
});

test("run 상태와 오류 빈결과 안내는 연결 사실과 probe 보존을 분리한다", () => {
  const generation = 7;
  assert.equal(runStateLabel({ status: "not-run" }, "dc", generation), "DC 동작점 미실행");
  assert.equal(runStateLabel({ status: "success", analysis: "dc", generation }, "dc", generation), "DC 동작점 해석 성공");
  assert.match(runStateLabel({ status: "success", analysis: "dc", generation: 6 }, "dc", generation), /현재 회로\/설정과 다름/);
  assert.equal(resultAvailabilityText({ status: "error" }, "transient", 2), "시간응답 실패 · 프로브 2개 보존 · 유효 결과 없음");
  assert.equal(resultAvailabilityText({ status: "error" }, "transient", 0), "시간응답 실패 · 프로브 없음 · 유효 결과 없음");

  const circuit = parallelIdealCircuit({ inductor: {} });
  let failure;
  try { simulateDC(circuit); } catch (error) { failure = error; }
  const described = describeCircuitFailure(circuit, { analysis: "dc" }, failure);
  assert.equal(described.certaintyLabel, "확인된 원인");
  assert.deepEqual(described.relatedComponentIds, ["source-x", "coil-x"]);
  assert.match(described.constraints[0].text, /VSUP \[source-x\].*5 V/);
});

test("병렬 SIN L 학습은 IC offset·정상상태 AC 위상과 dt 수렴을 정량 보존한다", () => {
  const { circuit, settings } = cloneExample("parallel-sine");
  const omega = 2 * Math.PI * 1000;
  const amplitude = 2 / (omega * 0.01);
  const errors = [];
  for (const step of ["2.5u", "1.25u"]) {
    const result = simulateTransient(circuit, { ...settings, step });
    let maximum = 0;
    for (let index = 0; index < result.xValues.length; index += 1) {
      const expected = amplitude * (1 - Math.cos(omega * result.xValues[index]));
      maximum = Math.max(maximum, Math.abs(result.points[index].componentCurrents.L1 - expected) / amplitude);
    }
    errors.push(maximum);
  }
  assert.ok(errors[0] <= 0.01, `coarse normalized error=${errors[0]}`);
  assert.ok(errors[1] < errors[0], `fine=${errors[1]}, coarse=${errors[0]}`);

  circuit.components.find((item) => item.id === "L1").props.ic = String(-amplitude);
  const steady = simulateTransient(circuit, { ...settings, step: "1.25u" });
  assert.ok(Math.abs(steady.points[0].componentCurrents.L1 + amplitude) < 1e-12);
  const ac = simulateACAtFrequency(circuit, 1000).points[0].componentCurrents.L1;
  assert.ok(complexRelativeError(ac, { re: -amplitude, im: 0 }) <= 1e-6, `AC=${JSON.stringify(ac)}`);
  assert.ok(Math.abs(Math.abs(phasorPolar(ac).angleDegrees) - 180) <= 0.01);
});

test("pointer transaction은 단일 owner·비소유 무시·취소/commit 멱등을 보장한다", () => {
  const first = beginPointerSession(null, 11, { kind: "component", id: "R1", origin: { x: 0, y: 0 } });
  assert.ok(ownsPointer(first, 11));
  assert.equal(beginPointerSession(first, 12, { kind: "pan" }), first);
  assert.equal(ownsPointer(first, 12), false);
  const ignored = finishPointerSession(first, 12, "cancel");
  assert.equal(ignored.session, first);
  assert.equal(ignored.finished, null);
  const cancelled = finishPointerSession(first, 11, "pointercancel");
  assert.equal(cancelled.session, null);
  assert.equal(cancelled.finished.reason, "pointercancel");
  assert.equal(finishPointerSession(cancelled.session, 11, "commit").finished, null);
});

test("canvas·plot 통합 경로는 pointercancel·lost capture·blur와 안정 capture 대상을 연결한다", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /capturePointer\(elements\["circuit-canvas"\], event\.pointerId\)/);
  assert.match(source, /"circuit-canvas"\]\.addEventListener\("pointercancel"/);
  assert.match(source, /"circuit-canvas"\]\.addEventListener\("lostpointercapture"/);
  assert.match(source, /capturePointer\(elements\["wave-plot"\], event\.pointerId\)/);
  assert.match(source, /"wave-plot"\]\.addEventListener\("pointercancel"/);
  assert.match(source, /"wave-plot"\]\.addEventListener\("lostpointercapture"/);
  assert.match(source, /window\.addEventListener\("blur"/);
  assert.match(source, /if \(!ownsPointer\(state\.drag, event\.pointerId\)\) return/);
});
